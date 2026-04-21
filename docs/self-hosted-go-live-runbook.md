# agent-passport 自托管上线 runbook

这份 runbook 只做一件事：

`把一台 Linux 主机收口成可运行、可观察、可回滚、可放行的 agent-passport 实例。`

不要先猜平台。先把这 4 件事做对：

- 服务能稳定常驻
- 数据不会跟着进程重启丢失
- 密钥不写死在仓库
- 放行结论能被 `smoke` 和 `verify:go-live:self-hosted` 重复验证

注意：这份 runbook 的目标机器默认是 Linux。Linux 目标机负责完成本机服务、恢复基线和公网前准备；正式上线前的最终 go-live verdict 仍需要在能跑 Safari DOM automation 的验收机上，带真实公网地址执行统一验收。

## 0. 前提

目标机器需要：

- Linux
- `node`
- `npm`
- `rsync`
- `systemd`
- 可选：`nginx`

本仓库已经提供：

- `deploy/agent-passport.service.example`
- `deploy/agent-passport.systemd.env.example`
- `deploy/bootstrap-self-hosted-systemd.example.sh`
- `deploy/nginx.agent-passport.conf.example`

## 1. 首次引导

最快路径是直接跑 bootstrap 样板：

```bash
cd /path/to/agent-passport
bash deploy/bootstrap-self-hosted-systemd.example.sh
```

这个脚本会做：

1. 建系统用户和组
2. 建 `/opt/agent-passport/releases`、`/var/lib/agent-passport`、`/etc/agent-passport`
3. 同步一份新 release 并把 `current` 指过去
4. 安装 `systemd` unit
5. 安装生产依赖
6. 启动 `agent-passport`

如果你的目录或用户名不一样，可以先覆写环境变量再跑：

```bash
APP_USER=agentpassport \
APP_GROUP=agentpassport \
APP_ROOT=/srv/agent-passport \
APP_DATA_DIR=/srv/agent-passport-data \
bash deploy/bootstrap-self-hosted-systemd.example.sh
```

## 2. 补齐密钥

首次引导后，立刻编辑：

```bash
sudo vi /etc/agent-passport/agent-passport.env
```

至少替换这 3 个值：

- `AGENT_PASSPORT_ADMIN_TOKEN`
- `AGENT_PASSPORT_STORE_KEY`
- `AGENT_PASSPORT_SIGNING_MASTER_SECRET`

改完后执行：

```bash
sudo systemctl restart agent-passport
```

## 3. 本机验活

先看服务状态：

```bash
sudo systemctl status agent-passport --no-pager
```

再看最近日志：

```bash
sudo journalctl -u agent-passport -n 100 --no-pager
```

再看本机健康检查：

```bash
APP_ENV_FILE="${APP_ENV_FILE:-/etc/agent-passport/agent-passport.env}"
set -a
source "$APP_ENV_FILE"
set +a
APP_LOCAL_BASE_URL="${AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL:-http://127.0.0.1:${PORT:-4319}}"
curl "$APP_LOCAL_BASE_URL/api/health"
curl "$APP_LOCAL_BASE_URL/api/security"
```

这里的 `APP_ENV_FILE` 只是 shell 本地 helper，方便手动 `source` 同一份配置；verify 脚本真正识别的配置文件入口是 `AGENT_PASSPORT_DEPLOY_ENV_FILE`。

这里除了看 HTTP 可达，还要确认 `/api/security` 直接带出结构化：

- `releaseReadiness.failureSemantics`
- `automaticRecovery.failureSemantics`

如果这里都不对，不要继续接公网域名。

## 4. 接公网入口

如果你走 Nginx：

1. 复制 `deploy/nginx.agent-passport.conf.example`
2. 替换域名、证书路径、上游地址
3. reload Nginx

最少确认：

- `/` 能返回 HTML
- `/api/health`
- `/api/capabilities`
- `/api/security`
- `/api/agents` 无 token 返回 `401`

## 5. 放行前验证

进入目标主机最终放行前，先确认上游代码守门已经过：

```bash
npm run test:smoke:guards
npm run smoke:all:ci
```

说明：

- `test:smoke:guards` 只守脚本、语义测试、smoke-ui-http token fallback、fetch/body 防超时、passive store read、offline-chat runtime、remote reasoner context、auto-recovery、pre-public 新鲜度回归和 clean-clone 跟踪清单是否还挂在门禁里
- `smoke:all:ci` 仍会先跑 remote reasoner preflight，但显式跳过 `smoke:browser`，并以 parallel combined 和 parallel operational leaves 收口，适合 CI 或无 Safari DOM automation 的环境
- 最终自托管放行仍以 `verify:go-live:self-hosted` 内部串起的 `smoke:all` 和公网 verdict 为准，不能只拿 `smoke:all:ci` 当正式放行
- 如果目标机器是 Linux，这里最多证明“目标机本机链路和公网前准备完成”；正式 go-live 还要在能跑 Safari DOM automation 的验收机上跑不跳过浏览器的统一 verifier
- 如果目标验收机能跑 Safari DOM automation，放行前补跑 `npm run smoke:browser`，或者直接跑不跳过浏览器的 `npm run smoke:all`

具备 Safari DOM automation 的最终验收机最短一键版：

```bash
AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名 \
AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=你的管理令牌 \
AGENT_PASSPORT_DEPLOY_ENV_FILE=/etc/agent-passport/agent-passport.env \
npm run verify:go-live:self-hosted
```

如果你是在仓库目录里直接运行，可以把这些键写进 `deploy/.env`。
如果你是按 `systemd` / 目标机 release 方式部署，默认应该写进 `/etc/agent-passport/agent-passport.env`，因为 `deploy/.env` 不会随 release 一起同步上机。
verify 脚本的有效配置优先级是：显式 shell env 值 -> `AGENT_PASSPORT_DEPLOY_ENV_FILE` 指向的文件 -> 仓库内 `deploy/.env` -> `/etc/agent-passport/agent-passport.env`。文件之间先读到的值会保留，后续文件不会覆盖同名键；所以如果 shell 里已经导出了旧 URL/token，配置文件里的新值不会覆盖它。

如果你用了别的 env 文件路径，直接改 `AGENT_PASSPORT_DEPLOY_ENV_FILE`：

```bash
AGENT_PASSPORT_DEPLOY_ENV_FILE=/绝对路径/agent-passport.env npm run verify:go-live:self-hosted
```

如果你在前面的手动 `curl` 步骤里用了 `APP_ENV_FILE` 这个 shell helper，也让它和这里的 `AGENT_PASSPORT_DEPLOY_ENV_FILE` 指向同一份文件；不要把 `APP_ENV_FILE` 当成 verify 脚本的原生命令开关。
脚本本体会把最终 verdict JSON 保留在 stdout，`smoke:all` 子流程日志统一走 stderr；如果你要把结果直接喂给 `jq`、shell wrapper 或 CI，优先用 `npm run --silent verify:go-live:self-hosted`，或者直接调用 `node scripts/verify-self-hosted-go-live.mjs`。

如果这台目标机没有 Safari DOM automation，`verify:go-live:self-hosted` 不能作为最终正式上线结论。目标机先跑到 `pre_public_ready_deploy_pending` 或本机自检通过；拿到真实公网地址后，再到 macOS/Safari 验收机执行 `AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=你的管理令牌 npm run verify:go-live`。

如果你现在还不准备接公网，只想先把“公网前准备”收口，先执行：

```bash
npm run prepare:self-hosted:pre-public
```

这条命令会串行刷新正式恢复基线：导出一份最新 recovery bundle、立刻对这份新 bundle 做持久化恢复演练、必要时先 prewarm 本地 reasoner 清掉 `local_reasoner_reachable` setup gap，再导出一份和当前恢复基线对齐的 setup package。macOS 默认会把 recovery passphrase 存进 Keychain `AgentPassport.RecoveryPassphrase/resident-default`；如果目标机器没有 Keychain，先提供 `AGENT_PASSPORT_RECOVERY_PASSPHRASE`。
这条命令的通过条件还包括 `artifactProof.ok=true`，也就是 recovery bundle、rehearsal 和 setup package 必须能证明来自同一轮新刷新。缺少真实 `AGENT_PASSPORT_DEPLOY_BASE_URL` 时，它只跑本机 loopback verifier，不触发完整 `smoke:all` / Safari DOM 门禁；即便 `ok=true` 且 `readinessClass=pre_public_ready_deploy_pending`，也只是“公网前准备完成”，不是“已经正式上线”。如果已经提供真实公网地址，它才会继续跑完整 self-hosted verifier。正式上线仍要在真实公网地址就绪后，于具备 Safari DOM automation 的验收机上跑 `verify:go-live:self-hosted` 或 `verify:go-live`。默认只会对 `http://127.0.0.1:4319` 或 `http://localhost:4319` 自动启动运行态；`http://[::1]:4319` 可复用已运行服务但不会自动拉起；非 loopback 地址需要你手动先启动服务。若现场不希望脚本自起本机服务，设置 `AGENT_PASSPORT_PRE_PUBLIC_AUTO_START=0`。
pre-public 内部 HTTP 请求默认 `45000ms` 超时，可用 `AGENT_PASSPORT_PRE_PUBLIC_FETCH_TIMEOUT_MS` 调整；setup package 默认只嵌入 1 个 local reasoner profile，可用 `AGENT_PASSPORT_PRE_PUBLIC_LOCAL_REASONER_PROFILE_LIMIT` 调整。若 `artifactProof.failedChecks` 包含 `setup_package_local_reasoner_profiles_bounded`，说明本轮 setup package 的 profile payload 超过上限，需要先缩小 profile 导出范围或明确调高上限后重跑。

上面的 `verify:go-live:self-hosted` 本机 loopback 阶段会先并行获取：

- 本机 loopback `/api/health`
- 本机 loopback `/api/security`
- 本机 `/api/security.releaseReadiness.failureSemantics`
- 本机 `/api/security.automaticRecovery.failureSemantics`
- 只有本机 loopback 真值通过后才继续跑 `smoke:all`
- 只有本机 loopback 真值通过后才继续跑统一 `verify:go-live` 子流程

如果你的本机服务不在 `http://127.0.0.1:4319`，先补：

```bash
AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL=http://127.0.0.1:9999
```

如果你只是改了 `PORT` / `HOST` 并写在 `/etc/agent-passport/agent-passport.env`，本机 loopback 检查现在也会自动跟随，不需要再额外导出。

如果你要拆层排查，再分别执行：

```bash
npm run smoke:all
npm run soak:runtime
```

这里两条命令回答的是两个不同问题：

- `npm run smoke:all`：当前这一版本地门禁是否通过
- `npm run soak:runtime`：同一条运行链连续多轮、共享状态累计、异常退出后是否仍稳定

`soak:runtime` 现在默认会按 `cold start -> shared-state -> crash restart` 顺序跑；默认不要求 Safari DOM automation，输出里的 `coverage.browserUi=skipped_by_default` 只代表运行生命线长稳，不代表浏览器页面投影真值连续稳定。如果这台验收机具备 Safari DOM automation，并且你要把 `/`、`/operator`、`/lab.html`、`/repair-hub`、`/offline-chat` 的页面投影也纳入长稳，执行 `npm run soak:runtime:browser`，通过时应看到 `coverage.browserUi=required`。如果你只是想缩回旧口径排查，再显式加 `--skip-shared-state`。

如果当前验收机具备 Safari DOM automation，再执行公网放行验证：

```bash
cd /你的项目目录
AGENT_PASSPORT_DEPLOY_ENV_FILE=/etc/agent-passport/agent-passport.env npm run verify:go-live:self-hosted
```

只有在具备 Safari DOM automation 的验收机上同时满足：

- `smoke:all` 通过
- `verify:go-live:self-hosted` 返回 `ok=true`
- `readinessClass=self_hosted_go_live_ready`

才算真正具备对外稳定放行条件。

如果这条命令失败，先按这个顺序看 JSON：

- `firstBlocker`：最先卡住放行的结构化阻塞项，现场先盯这一条
- `operatorSummary`：把最先阻塞项、原因和下一步合成一句话；现场或 agent wrapper 优先读它
- `nextAction`：当前最先该补的动作
- `errorClass` / `errorStage`：适合给 wrapper 脚本、CI 或告警分流直接机读；self-hosted verdict 现在也会稳定透出
- `preflightShortCircuited`：只表示 unified go-live 有没有在 preflight 阶段就直接短路；缺少 deploy URL 时虽然公网 deploy/runtime 检查会先挂起，但本地 `smoke:all` 仍会继续跑，所以这里仍然是 `false`
- `unifiedSkipped` / `unifiedSkipReason`：可以直接看统一 go-live 子流程这次是不是被跳过；如果是 `local_runtime_blocked`、`config_env_unreadable` 或 `local_runtime_unexpected_error`，都先修本机前置问题，不要先追 deploy
- 如果 `errorClass=config_env_unreadable`：优先检查 `AGENT_PASSPORT_DEPLOY_ENV_FILE` 指向的文件是不是路径填错、给成了目录，或者当前执行用户没有读权限
- `effectiveConfig.machineReadableCommand`：如果你要把 verdict 直接交给 `jq`、CI 或 wrapper，优先用这条命令，不要直接裸跑会带 npm banner 的 `npm run verify:go-live:self-hosted`

如果失败来自 `smoke:browser`、`soak:runtime`、admin token、read-session 或 public truth，先回到 `docs/go-live-operations-checklist.md` 的失败分流表；不要把权限边界、浏览器自动化不可用、或默认长稳缺 browser 覆盖混成同一个运行态故障。
- `deploy` / `smoke` / `runtimeReleaseReadiness`：self-hosted 顶层现在也直接透出统一 verdict 里的 deploy、smoke 和运行态摘要，不必再手动钻 `unifiedGoLive`
- `effectiveConfig.localBaseUrl` / `effectiveConfig.deployBaseUrl`：脚本这次实际拿来判定的本机和公网地址
- `effectiveConfig.configEnvFiles`：这次实际读到了哪些 env 文件；如果这里没有你以为已经生效的文件，先修配置入口

## 6. 日常运维命令

重启服务：

```bash
sudo systemctl restart agent-passport
```

看实时日志：

```bash
sudo journalctl -u agent-passport -f
```

看最近 200 行：

```bash
sudo journalctl -u agent-passport -n 200 --no-pager
```

停服务：

```bash
sudo systemctl stop agent-passport
```

## 7. 升级发布

推荐沿用 release 目录：

1. 把新代码同步到新的 `releases/<timestamp>`
2. 在新目录跑生产依赖安装
3. 把 `current` 软链接切到新 release
4. `sudo systemctl restart agent-passport`
5. 重新跑本机健康检查；Linux 目标机先跑 `prepare:self-hosted:pre-public`，最终 go-live 仍到 Safari DOM 验收机跑统一 verifier

不要直接在正在运行的 `current` 目录里原地改文件。

## 8. 回滚

如果新版本异常：

1. 找到上一个可用 release
2. 把 `current` 指回旧目录
3. 重启服务
4. 复查 `/api/health`、`/api/security`；如需最终放行结论，到 Safari DOM 验收机跑 `verify:go-live:self-hosted` 或 `verify:go-live`

示例：

```bash
sudo ln -sfn /opt/agent-passport/releases/20260416210000 /opt/agent-passport/current
sudo systemctl restart agent-passport
```

## 9. 什么时候不要继续放量

出现下面任一条，先停，再查：

- `/api/health.ok != true`
- `securityPosture.mode != normal`
- `smoke:all` 失败
- 具备 Safari DOM automation 的最终验收机上 `verify:go-live:self-hosted` / `verify:go-live` 失败
- 日志里出现连续重启、恢复链异常或受限执行层退化

## 10. 一句话收口

上线不是“进程能起来”就算完成，而是：

`服务活着 + 数据可留存 + 密钥独立 + 放行可验证 + 异常可回滚`

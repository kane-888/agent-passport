# agent-passport 自托管上线 runbook

这份 runbook 只做一件事：

`把一台 Linux 主机收口成可运行、可观察、可回滚、可放行的 agent-passport 实例。`

不要先猜平台。先把这 4 件事做对：

- 服务能稳定常驻
- 数据不会跟着进程重启丢失
- 密钥不写死在仓库
- 放行结论能被 `smoke` 和 `verify:go-live` 重复验证

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
curl http://127.0.0.1:4319/api/health
curl http://127.0.0.1:4319/api/security
```

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

最短一键版：

```bash
AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名 \
AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=你的管理令牌 \
npm run verify:go-live:self-hosted
```

如果这些键已经写进 `deploy/.env` 或 `/etc/agent-passport/agent-passport.env`，可以直接运行 `npm run verify:go-live:self-hosted`，脚本会自动复用。

这条命令会串行检查：

- 本机 loopback `/api/health`
- 本机 loopback `/api/security`
- 本机 `/api/security.releaseReadiness.failureSemantics`
- 本机 `/api/security.automaticRecovery.failureSemantics`
- `smoke:all`
- `verify:go-live`

如果你的本机服务不在 `http://127.0.0.1:4319`，先补：

```bash
AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL=http://127.0.0.1:9999
```

如果你只是改了 `PORT` / `HOST` 并写在 `/etc/agent-passport/agent-passport.env`，本机 loopback 检查现在也会自动跟随，不需要再额外导出。

如果你要拆层排查，再分别执行：

```bash
npm run smoke:all
```

再执行公网放行验证：

```bash
cd /你的项目目录
npm run verify:go-live:self-hosted
```

只有当：

- `smoke:all` 通过
- `verify:go-live:self-hosted` 返回 `ok=true`
- `readinessClass=self_hosted_go_live_ready`

才算真正具备对外稳定放行条件。

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
5. 重新跑本机健康检查和 `verify:go-live`

不要直接在正在运行的 `current` 目录里原地改文件。

## 8. 回滚

如果新版本异常：

1. 找到上一个可用 release
2. 把 `current` 指回旧目录
3. 重启服务
4. 复查 `/api/health`、`/api/security` 和 `verify:go-live`

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
- `verify:go-live` 失败
- 日志里出现连续重启、恢复链异常或受限执行层退化

## 10. 一句话收口

上线不是“进程能起来”就算完成，而是：

`服务活着 + 数据可留存 + 密钥独立 + 放行可验证 + 异常可回滚`

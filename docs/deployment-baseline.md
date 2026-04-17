# agent-passport 通用部署基线

这份基线只回答一个问题：

`怎样用最少前提，把 agent-passport 稳定部署成一个可长期运行、可恢复、可校验的服务。`

不要先问“上哪家平台”。先确认这条服务真正需要什么：

- 长驻进程
- 持久数据目录
- 显式密钥
- 可验证的公网入口

## 推荐路径

当前默认推荐的是：

`Linux 主机 + Docker Compose + 持久目录 + 反向代理或云负载均衡`

这条路径适合：

- 中国大陆云主机
- 海外 VPS
- 自建机房机器
- 任何能稳定跑 Docker 的单实例环境

它不依赖：

- Render
- Vercel serverless
- macOS keychain

## 仓库内置模板

仓库已经提供这 8 个基线文件：

- `Dockerfile`
- `deploy/docker-compose.example.yml`
- `deploy/.env.example`
- `deploy/agent-passport.service.example`
- `deploy/agent-passport.systemd.env.example`
- `deploy/bootstrap-self-hosted-systemd.example.sh`
- `deploy/nginx.agent-passport.conf.example`
- `docs/self-hosted-go-live-runbook.md`

## 最短启动步骤

1. 准备宿主持久目录，例如 `/var/lib/agent-passport`
2. 复制 `deploy/.env.example` 为 `deploy/.env`
3. 填好 `AGENT_PASSPORT_ADMIN_TOKEN`、`AGENT_PASSPORT_STORE_KEY`、`AGENT_PASSPORT_SIGNING_MASTER_SECRET`
4. 在仓库根目录执行：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.example.yml up -d --build
```

5. 本机验证：

```bash
curl http://127.0.0.1:4319/api/health
```

6. 公网验证：

```bash
cd /你的项目目录
npm run verify:go-live:self-hosted
```

前提：正式域名和管理令牌已经写进 `deploy/.env` 或 `/etc/agent-passport/agent-passport.env`。

## 非 Docker 路径

如果目标机器不想装 Docker，最小可运行路径就是：

`Node.js + systemd + 持久目录 + 反向代理`

仓库已经附了：

- `deploy/agent-passport.service.example`
- `deploy/agent-passport.systemd.env.example`

最短步骤：

1. 把代码放到例如 `/opt/agent-passport/current`
2. 确保机器上已有可用的 `node`
3. 复制 `deploy/agent-passport.systemd.env.example` 到 `/etc/agent-passport/agent-passport.env`
4. 把环境变量里的密钥替换成真实值
5. 复制 `deploy/agent-passport.service.example` 到 `/etc/systemd/system/agent-passport.service`
6. 执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now agent-passport
sudo systemctl status agent-passport
```

这条路径的本质和 Docker 版一样：

- 仍然是单实例长驻进程
- 仍然要求显式密钥
- 仍然把数据写到持久目录
- 仍然用 `verify:go-live` 做最终公网放行

## 最小环境变量

这几个变量是上线前的最小集合：

```bash
PORT=4319
HOST=0.0.0.0
AGENT_PASSPORT_USE_KEYCHAIN=0
OPENNEED_LEDGER_PATH=/var/data/ledger.json
AGENT_PASSPORT_RECOVERY_DIR=/var/data/recovery-bundles
AGENT_PASSPORT_ARCHIVE_DIR=/var/data/archives
AGENT_PASSPORT_SETUP_PACKAGE_DIR=/var/data/device-setup-packages
AGENT_PASSPORT_ADMIN_TOKEN=<secret>
AGENT_PASSPORT_STORE_KEY=<secret>
AGENT_PASSPORT_SIGNING_MASTER_SECRET=<secret>
```

含义：

- `PORT`：服务监听端口
- `HOST`：正式部署通常设成 `0.0.0.0`
- `AGENT_PASSPORT_USE_KEYCHAIN=0`：避免把宿主机系统 keychain 当成部署前提
- `/var/data` 下的几个目录：统一落到容器内持久挂载点

说明：

- 这组默认值面向 Docker / 容器部署
- 如果走 `systemd`，请直接使用 `deploy/agent-passport.systemd.env.example` 里的 `/var/lib/agent-passport/...`

## 为什么推荐这条基线

因为它直接满足了这条服务的真实约束：

- 数据不会跟着容器重建一起丢掉
- 密钥不会依赖开发机上的本地保护层
- 运行形态和本地 smoke / deploy verify 的假设一致
- 后续切换到别的云厂商时，不需要重写应用层部署逻辑

## 公网入口建议

可以用任意你熟悉的入口方式，只要满足：

- 域名最终能稳定转发到这台服务
- HTTPS 在代理层或负载均衡层终止
- `/`、`/api/health`、`/api/capabilities`、`/api/security` 可公开访问
- `/api/agents` 无 token 返回 `401`

如果你走 Nginx，仓库里已经附了 `deploy/nginx.agent-passport.conf.example`，把域名、证书路径和上游地址替换成你的真实值即可。

如果你已经准备进入实机部署和上线放行，直接看 [docs/self-hosted-go-live-runbook.md](self-hosted-go-live-runbook.md)。

如果你已经在目标主机上起好了服务，推荐直接执行：

```bash
AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名 \
AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=你的管理令牌 \
npm run verify:go-live:self-hosted
```

如果你已经把这些键写进 `deploy/.env` 或 `/etc/agent-passport/agent-passport.env`，可以直接裸跑 `npm run verify:go-live:self-hosted`，验证器会自动读取。

这条命令会把：

- 本机 loopback `/api/health`
- 本机 loopback `/api/security`
- 本机 `/api/security.releaseReadiness.failureSemantics`
- 本机 `/api/security.automaticRecovery.failureSemantics`
- `smoke:all`
- `verify:go-live`

串成一条自托管放行链。

## 如果你仍在使用 Render

仓库里仍保留 `render.yaml`，但它现在只承担两个角色：

- 给仍在使用 Render 的环境做兼容参考
- 给 deploy 校验脚本在显式开启自动发现时读取历史 service 名

注意：

- 只有显式设置 `AGENT_PASSPORT_DEPLOY_RENDER_AUTO_DISCOVERY=1` 时，deploy 校验才会用到 `render.yaml`
- 如果 `render.yaml` 里还是历史资源名，先去 Render 控制台核对真实绑定，再决定要不要改名

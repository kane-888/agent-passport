# agent-passport Alpha 0.1.0 上线记录

记录时间：2026-06-14T13:07:22Z  
本地时间：2026-06-14 06:07:22 PDT  
版本：0.1.0  
上线标签：v0.1.0-alpha.1  
上线代码提交：6aea58c  
上线记录提交：本文件所在提交  
公网域名：https://agent-passport.cn

## 上线结论

Alpha 0.1.0 当前达到可对外下载入口放行状态。

公网网站只承担下载、备案、法律与联系方式入口；身份创建、登录、恢复、运行态维护和工程操作均留在本地软件或本地维护面，不在公网域名暴露。

## 已确认范围

- 公网首页：下载入口模式。
- 公网维护面：`/operator`、`/lab.html`、`/repair-hub`、`/offline-chat` 不作为公网用户页面暴露。
- 下载包：macOS、Windows、Linux 三个平台下载地址均通过探测。
- ICP 备案：`粤ICP备2026067759号-1`。
- 公安联网备案：`粤公网安备44195502000219号`。
- 公安备案查询：https://beian.mps.gov.cn/#/query/webSearch?code=44195502000219
- 临时部署/修复 secret gist：已删除。

## 验证结果

最后一轮本地完整门禁：

```text
npm run smoke:all
fullSmokePassed=true
browserCovered=true
failedSteps=[]
gateFailures=[]
serverIsolationMode=ephemeral_loopback
serverDataIsolationMode=ephemeral_data_copy
serverSecretIsolationMode=ephemeral_secret_namespace
```

关键补充验证：

```text
node --test tests/smoke-browser-semantics.test.mjs
tests=33
pass=33
fail=0

node --check scripts/smoke-all.mjs
node --check scripts/smoke-browser.mjs
node --check scripts/smoke-ui.mjs
node --check scripts/smoke-dom-combined.mjs
passed
```

服务器 go-live 结论截图前置结果：

```text
deploy_http_ok=true
admin_token_present=true
runtime_release_ready=ready
blockedBy=[]
firstBlocker=null
```

## 备份与回滚记录

代码回滚点：

- Git tag：`v0.1.0-alpha.1`
- 上线代码提交：`6aea58c`
- 上线记录提交：本文件所在提交

服务器侧已知备份点：

- Ledger 修复脚本执行时生成：`/var/backups/agent-passport/ledger-reset-20260614T115645Z`

部署配置与运行数据仍以服务器持久化目录为准：

- 配置：`/etc/agent-passport/agent-passport.env`
- Release：`/opt/agent-passport/current`
- 数据目录：以服务器当前 systemd/env 配置为准

回滚原则：

1. 先停止公网继续变更。
2. 保留 `/etc/agent-passport/agent-passport.env` 与数据目录。
3. 回退到 `v0.1.0-alpha.1` 或提交 `6aea58c`。
4. 重启服务后重新跑 `verify:deploy:http` 和 `verify:go-live`。
5. 如果涉及身份、恢复、ledger 或 admin token，先导出事故交接包，再执行修复。

## 剩余事项

- Alpha 阶段继续收真实用户下载、安装、创建、登录/恢复反馈。
- 正式 Beta 前补安装器体验、签名、公证、自动更新与更明确的新手流程。
- 继续保持架构口径：记忆稳态引擎是模型底座；agent-passport 是连续身份、长期偏好、恢复、长期记忆与审计层；OpenNeed 只是 app 消费方。

## 2026-06-18 公网复验记录

复验命令：

```bash
AGENT_PASSPORT_DEPLOY_BASE_URL=https://agent-passport.cn \
AGENT_PASSPORT_REQUIRE_ICP_RECORD=1 \
npm run verify:deploy:http
```

用户可见公网面已通过：

- `https://agent-passport.cn/` 可达，首页为下载入口。
- 首页不暴露 `/operator?flow=*` 旧操作深链。
- `surface.mode=public`，`publicWebsite=true`，`localUiAvailable=false`。
- `/operator`、`/lab.html`、`/repair-hub`、`/offline-chat`、`/agents`、`/agents/new`、`/recovery-import.html` 等本地工作台页面在公网返回 `404`。
- macOS、Windows、Linux 三个平台下载包均返回 `200 application/gzip`。
- ICP 备案号为 `粤ICP备2026067759号-1`。
- 公安联网备案号为 `粤公网安备44195502000219号`。
- 远端 `releaseReadiness.status=ready`，`readinessClass=go_live_ready`。

当前阻塞项：

- 本机 keychain 中读取到的部署访问口令已不能通过公网管理面校验。
- `GET /api/agents` 带该口令返回 `401`，`GET /api/device/setup` 带该口令也返回 `401`。

下一步：

1. 以服务器 `/etc/agent-passport/agent-passport.env` 中当前 `AGENT_PASSPORT_ADMIN_TOKEN` 为准，用 `npm run deploy:admin-token:sync` 同步或轮换本机验收用 `AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN`。
2. 重新运行 `npm run verify:deploy:http`。
3. deploy HTTP 全绿后，再运行最终 `verify:go-live` / `verify:go-live:self-hosted`。

# Merge Prep Checklist

这份清单只回答 3 个问题：

1. 这次合并到底收了什么
2. 合并前必须再看哪些面
3. 合并后还要记住什么边界

## 这次合并的 7 段主线

不要按提交数讲，按问题本质讲。这次 PR 的主线只有 7 段：

1. `/` 收口成只回答运行态真值的公开入口，不再承载旧混合控制台。
2. 正式恢复周期、自动恢复边界、受限执行、安全路由信任边界和 operator 手册对齐成同一套运行规则。
3. proposition / 记忆语言从旧 recruitment 语义收回到 runtime 语义，同时保留旧账本可读兼容。
4. browser smoke 和首页加载链一起变成真实 gate，不再把占位文案或瞬时读取失败误判成通过。
5. 离线协作线程现在也只回答运行成员真值：`group.participants`、`threadStartup.phase_1` 和 `/api/offline-chat/thread-startup-context?phase=phase_1` 都已经是正式契约。
6. 单次 payload 的 reasoner / localReasoner 覆写现在已经端到端生效，不再让 probe/select/prewarm 和 runner 走出两套规则。
7. GitHub Actions 已切到支持 Node 24 的 action major；公开页、operator、repair-hub、lab 的对外文案也统一回到同一套中文运行规则。

最后还有一笔 housekeeping：

- 删掉已经不再代表真实运行规则的旧 demo、旧材料、旧导出脚本
- 旧 `agent-passport` 只保留在协议、存储格式和兼容入口这些必须保留的层

## 合并话术

这次不是再做一个首页，而是把 `/` 收口成只回答运行态真值的公开入口。

正式恢复周期、自动恢复边界、受限执行、安全路由信任边界和 operator 手册现在已经对齐成同一套运行规则。

旧 proposition / discourse 数据仍然可读，但对外叙事已经统一回到 memory / context 这套 runtime 语言。

browser smoke 现在会拦真实首页失败，也不会把瞬时读取波动误判成最终失败。

离线群聊 roster 和 `phase_1` startup context 现在也只回答运行成员真值。

单次 reasoner 覆写现在可以直接穿透到 runner 真执行链路，`smoke-ui` 已经覆盖这个 gate。

CI 也已经切到支持 Node 24 的 action major；公开页、operator、repair-hub 和 lab 的对外话术统一成同一套中文运行规则。

## PR 标题

收口运行态真值并补齐安全 / 恢复 / 执行 gate

## PR 最终说明

这次 PR 不是继续堆页面，而是把运行态公开入口、值班决策面、现场清理面和受保护修复入口各自收回到真实职责。

- `/` 现在只回答公开运行态真值。
- `/operator` 负责值班判断，不再把恢复、执行和切机结论散落在别处。
- `/lab.html` 只做 housekeeping 这类减旧动作，不再冒充正式恢复。
- `browser smoke`、`smoke-ui` 和 CI gate 现在会拦真实首页失败、安全边界伪造以及 runner 覆写链路偏移。

## 合并后一段话

这次合并收的不是一个新首页，而是一套更硬的运行规则：公开入口只说公开真值，值班页只做值班判断，现场清理只做减旧，受保护接口只暴露当前真实边界。正式恢复、自动恢复、受限执行和安全路由信任边界现在已经对齐成同一套可验证 gate。

## 合并前必看

### 1. Fresh smoke

- 用 fresh boot 跑 `npm run smoke:all`
- `npm run smoke:all` 默认应该自起隔离 loopback server，并同时隔离临时 data 副本、管理令牌文件回退路径、signing secret 文件回退路径和 keychain account namespace；只有显式传 `AGENT_PASSPORT_BASE_URL` 时，才允许复用现成服务
- 确认 browser smoke 不会再把首页占位文案当成功
- 确认 browser smoke 会把 Safari DOM automation 不可用直接判成失败，而不是降级跳过首页 gate
- 确认 browser smoke 会把 `/` 的 4 张卡、触发条件列表和可用入口列表，与当前 `/api/health` + `/api/security` 真值逐项比对
- 如果你显式复用了已经跑了很久的本地服务，结论只算参考，不算 merge gate

### 2. 公开运行态

- 打开 `/`
- 只应该看到 4 张卡：公开健康度、正式恢复周期、自动恢复边界、可用入口
- `runtime-home-summary` 应进入“公开运行态已加载”成功态
- 即使 URL 还带着旧 repair / credential / status-list 参数，首页也应该忽略这些上下文，只回到公开运行态真值
- 不应该再承诺消费 repair / credential / status list 上下文
- 不应该再出现旧混合控制台的主视角、证据区、状态列表面板

### 3. 恢复与安全真值

- 看 `GET /api/security`
- 确认能同时读到 `securityPosture`、`localStorageFormalFlow`、`constrainedExecution`、`automaticRecovery`
- 看 `GET /api/device/setup`
- 确认 `formalRecoveryFlow.runbook`、`formalRecoveryFlow.operationalCadence`、`setupPackages` 返回一致
- 看 `/lab.html`
- 确认 runtime housekeeping 仍然只做 read session 撤销与旧恢复包/初始化包清理，不冒充正式恢复

### 4. 深操作入口

- `/offline-chat` 继续承载离线协作与记忆主链
- `/api/offline-chat/thread-startup-context?phase=phase_1` 继续承载第一阶段线程真值
- `/repair-hub` 继续承载 repair / credential / status list 深钻
- `/repair-hub` 里的“返回公开运行态”只应该回 `/`，不再把 repair / credential query 反灌首页
- `/lab.html` 继续承载高级维护入口

## 合并后仍要记住的边界

- 自动恢复 / 续跑只是运行态接力，不是备份完成
- runtime housekeeping 只是减旧，不会生成新的恢复包、恢复演练或初始化包
- `/` 现在是公开运行态，不是可无限加功能的总控台
- 真正的 release gate 仍然是 fresh smoke 和受保护接口真值，不是“页面大概能打开”

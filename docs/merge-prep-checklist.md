# 合并前检查清单

这份清单只回答 3 个问题：

1. 这次合并到底收了什么
2. 合并前必须再看哪些面
3. 合并后还要记住什么边界

## 这次合并的 5 段主线

不要按零碎提交讲，按运行规则讲。这次 PR 的主线只有 5 段：

1. `/` 收口成只回答公开运行态真值的入口，`/operator` 收口成值班判断面，`/lab.html` 收成实验与维护页，`/repair-hub` 留在受保护深钻层。
2. 正式恢复、自动恢复、受限执行、受保护读取和安全路由信任边界对齐成同一套运行规则，不再让页面、文档和接口各说各话。
3. `/offline-chat` 和 `/repair-hub` 继续产品化：先给结论、再给证据，不再把内部字段、原始 JSON 和旧引擎名直接铺到第一屏。
4. runtime memory homeostasis 进入设备与 Agent 运行态真值；`response-verify`、`drift-check`、`verification-runs`、比较证据和 repair 路由不再信任客户端伪造上下文、签发方或探针输入。
5. browser smoke、smoke-ui、smoke-dom 和 CI 都变成真实关口，不再靠占位文案、瞬时失败态、旧本地状态或环境巧合通过。

最后还有一笔清扫：

- 删掉已经不再代表真实运行规则的旧 demo、旧材料、旧导出脚本
- 旧 `OpenNeedRuntimeLinks` 这类兼容名只保留在协议、存储格式和兼容入口这些必须保留的层

## 合并话术

这次不是再做一个首页，而是把 `/` 收口成只回答运行态真值的公开入口。

正式恢复周期、自动恢复边界、受限执行、受保护读取和 operator 手册现在已经对齐成同一套运行规则。

旧 proposition / discourse 数据仍然可读，但对外叙事已经统一回到 memory / context 这套 runtime 语言。

browser smoke 现在会拦真实首页和 `/operator` 失败，也不会把占位文案或瞬时读取波动误判成最终失败。

离线群聊成员编组和 `phase_1` 启动上下文现在也只回答运行成员真值。

repair-hub 现在默认先给修复结论、影响范围、下一步和凭证状态判断，原始 JSON 只按需展开。

runtime memory homeostasis 现在会把模型画像、记忆稳态状态和纠偏等级写进运行时真值；公开路由不会再信任客户端自带的 `contextBuilder`、`runtimePolicy` 或对抗探针输入。

单次 reasoner 覆写现在可以直接穿透到 runner 真执行链路，`smoke-ui` 已经覆盖这个关口。

CI 也已经切到支持 Node 24 的 action major；公开页、operator、repair-hub 和 lab 的对外话术统一成同一套中文运行规则。

## PR 标题

收口公开真值 / 值班判断 / 实验维护 / smoke gate

## PR 最终说明

这次 PR 不是继续堆页面，而是把运行态公开入口、值班决策面、实验与维护页和受保护修复入口各自收回到真实职责。

- `/` 现在只回答公开运行态真值。
- `/operator` 负责值班判断，不再把恢复、执行和切机结论散落在别处。
- `/lab.html` 只做边界核对和维护减旧，不再冒充正式恢复。
- `/offline-chat` 和 `/repair-hub` 先给判断面，再把原始字段折到第二层，不再把内部结构直接摊给第一眼。
- `/repair-hub` 只回答受保护修复证据，不再把深链上下文反灌回首页。
- runtime memory homeostasis 现在进入设备与 Agent 运行态真值；相关公开路由不再信任客户端伪造上下文或 issuer。
- `browser smoke`、`smoke-ui`、`smoke-dom` 和 CI 现在会拦真实首页失败、`/operator` 真值偏移、安全边界伪造以及 runner 覆写链路偏移。

## 合并后一段话

这次合并收的不是一个新首页，而是一套更硬的运行规则：公开入口只说公开真值，值班页只做值班判断，实验与维护页先看边界再做减旧，受保护接口只暴露当前真实边界。正式恢复、自动恢复、受限执行和安全路由信任边界现在已经对齐成同一套可验证关口。

## 当前 PR 栈

按现在的叠加关系，主产品最短链是：

1. `#7` `codex/operator-handoff-risk-policy` -> `main`
2. `#9` `codex/harden-route-spoofing-boundaries` -> `codex/operator-handoff-risk-policy`

公网部署链独立为：

1. `#8` `codex/public-deploy-baseline` -> `main`

旧的拆分路标保留为：

1. `#5` `codex/operator-handbook-truth`
2. `#6` `codex/security-recovery-followup`

这两条停在早期失败快照上，根因都是旧链路还没补齐 `security.localStorageFormalFlow.handoffPacket` 真值实现；它们保留作历史分层记录，不再作为主链 merge target。

当前状态一眼结论：

- `#7` 现在已经直接接 `main`，是主产品首合 PR。
- `#9` 当前所有检查已通过，继续只叠加在 `#7` 之上。
- `#8` 独立可合，不阻塞主产品链。
- `#5`、`#6` 还是旧 draft，已经从关键路径移出。

最短合并路径：

1. 先合 `#7`，把公开入口、operator、lab、正式恢复交接收口到同一份运行态真值。
2. 再合 `#9`，补上路由防伪造、运行态记忆稳态和产品化运行界面。
3. `#8` 继续独立，准备好时单独进 `main`。
4. `#7`、`#9` 合完后，再把 `#5`、`#6` 关成 superseded，避免旧栈继续制造噪音。

## 合并前必看

### 1. 全新启动验证

- 用 fresh boot 跑 `npm run smoke:all`
- `npm run smoke:all` 默认应该自起隔离 loopback server，并同时隔离临时 data 副本、管理令牌文件回退路径、signing secret 文件回退路径和 keychain account namespace；只有显式传 `AGENT_PASSPORT_BASE_URL` 时，才允许复用现成服务
- 单独跑 `npm run smoke:browser` 时，也应该默认自起隔离 loopback server，而不是隐式依赖共享 `4319`
- 确认 browser smoke 不会再把首页或 `/operator` 的占位文案当成功
- 确认 browser smoke 会把 Safari DOM automation 不可用直接判成失败，而不是降级跳过关口
- 确认 browser smoke 会把 `/` 的 4 张卡、触发条件列表和可用入口列表，与当前 `/api/health` + `/api/security` 真值逐项比对
- 确认 browser smoke 会把 `/operator` 的摘要、下一步、跨机器恢复关口和告警数量，与 `/api/security` + `/api/device/setup` 真值逐项比对
- 确认 browser smoke 日志只输出验证摘要，不会把 repair / credential 的受保护 JSON 正文原样打进终端
- 如果你显式复用了已经跑了很久的本地服务，结论只算参考，不算合并关口

### 2. 公开运行态

- 打开 `/`
- 只应该看到 4 张卡：公开健康度、正式恢复周期、自动恢复边界、可用入口
- `runtime-home-summary` 应进入“公开运行态已加载”成功态
- 即使 URL 还带着旧 repair / credential / status-list 参数，首页也应该忽略这些上下文，只回到公开运行态真值
- 不应该再承诺消费修复、凭证或状态列表上下文
- 不应该再出现旧混合控制台的主视角、证据区、状态列表面板

### 3. 恢复与安全真值

- 看 `GET /api/security`
- 确认能同时读到 `securityPosture`、`localStorageFormalFlow`、`constrainedExecution`、`automaticRecovery`
- 看 `GET /api/device/setup`
- 确认 `formalRecoveryFlow.runbook`、`formalRecoveryFlow.operationalCadence`、`setupPackages` 返回一致
- 看 `/lab.html`
- 确认 runtime housekeeping（维护减旧）仍然只做只读会话撤销与旧恢复包/初始化包清理，不冒充正式恢复

### 4. 下一层页面

- `/offline-chat` 继续承载离线协作与记忆主链
- `/api/offline-chat/thread-startup-context?phase=phase_1` 继续承载第一阶段线程真值
- `/repair-hub` 继续承载修复、凭证与状态列表证据深钻
- `/repair-hub` 里的“返回公开运行态”只应该回 `/`，不再把 repair / credential query 反灌首页
- `/lab.html` 继续承载实验与维护；只做边界核对和维护减旧

## 合并后仍要记住的边界

- 自动恢复 / 续跑只是运行态接力，不是备份完成
- runtime housekeeping 只是减旧，不会生成新的恢复包、恢复演练或初始化包
- `/` 现在是公开运行态，不是可无限加功能的万能入口
- 真正的发布关口仍然是全新启动 smoke 和受保护接口真值，不是“页面大概能打开”

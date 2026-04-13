# OpenNeed 记忆稳态引擎

这是 `OpenNeed 记忆稳态引擎` 当前对应的工程仓库。

仓库目录仍保留历史名 `agent-passport`，用来兼容现有脚本、路径和数据目录；但对外展示名称统一为 `OpenNeed 记忆稳态引擎`。

长期方向设想仍然是：

`给 Agent 建一套可校验、可分叉、可授权、可追溯的身份语义与证据约定。`

但当前第一阶段的真实产品定位已经收敛成：

`单机单 Agent、本地优先、可恢复、可审计的 Agent Runtime。`

也就是说，当前最先要做稳的不是“全球协议”，而是：

- 当前单个本地参考层默认只绑定一个 resident agent
- 身份、记忆、权限、证据在线程外、本机内持续存在
- Agent 忘了时先查本地纪要 / 决策 / 证据 / compact boundary，再恢复
- 动作按风险分级：low 保持低延迟，high 先确认，critical 才升级到多签冷路径
- 关键身份和授权事件再进入 DID / VC / 多签 / 本地记录这条冷路径

更完整的人类可读定位文档见：

- [docs/product-positioning.md](/Users/kane/Documents/agent-passport/docs/product-positioning.md)
- [docs/mvp.md](/Users/kane/Documents/agent-passport/docs/mvp.md)
- [docs/security-architecture.md](/Users/kane/Documents/agent-passport/docs/security-architecture.md)
- [docs/operator-security-handbook.md](/Users/kane/Documents/agent-passport/docs/operator-security-handbook.md)
- [docs/formal-recovery-sop.md](/Users/kane/Documents/agent-passport/docs/formal-recovery-sop.md)
- [docs/cross-device-recovery-rehearsal.md](/Users/kane/Documents/agent-passport/docs/cross-device-recovery-rehearsal.md)
- [docs/recovery-cadence-policy.md](/Users/kane/Documents/agent-passport/docs/recovery-cadence-policy.md)
- [docs/next-phase-security-checklist.md](/Users/kane/Documents/agent-passport/docs/next-phase-security-checklist.md)

当前工作区根路径以 `/Users/kane/Documents/agent-passport` 为准。
仓库目录名里的 `agent-passport` 现在只保留为兼容层：继续兼容现有脚本、协议字段和数据目录，不代表对外产品名。

第一版不直接上真实区块链，而是先做一条本地可校验完整性的链式账本：

- 每个身份事件都带 `previousHash`
- 每次注册、复制、授权都会写成一条带链式哈希的本地历史记录
- 复制体会拥有新的身份编号，并且保留“从谁分叉而来”的痕迹
- 每个 Agent 都会生成本地 DID 和钱包地址
- 授权会校验单签或多签审批人
- 资产授权不会自动继承，必须由来源身份明确授权

## 当前边界

下面这些说法在当前阶段不应该对外讲成“已经实现”：

- 不是全球唯一身份，只是当前本地命名空间内的稳定身份
- 不是第三方独立背书网络，只是本地可校验、可回放的记录体系
- 不是无限自动执行代理，只是在本地门禁通过时具备有限次、可观察、可被拦截的自动恢复/续跑闭环
- 不是可训练的类脑神经网络，只是已经具备类脑启发式记忆分层和运行态摘要层
- 不是不可篡改链上账本，只是具备本地加密、哈希链和完整性校验

## 当前能力

- 注册一个 Agent 身份
- 查询 Agent 列表与单个 Agent 详情
- 从某个 Agent 分叉出新的 Agent 身份
- 给目标 Agent 发放初始资源 / 授权资产
- 查看与更新 Agent 的 DID / 钱包 / 多签策略
- 绑定多个浏览器窗口到同一个 Agent
- 在 Agent 维度记录记忆并路由消息
- 创建、签署、执行和撤销多签授权提案
- 导出 Agent / 授权提案的本地证据包
- 比较两个 Agent，并导出本地可校验的比较审计证据包
- 导出/读取 VC 状态列表和当前账本内可校验的撤销状态证明
- 按 Agent 身份域分组管理多个状态列表
- 在前端切换并浏览不同 issuer 的状态列表
- 在前端并排对比两个状态列表的摘要、条目和证据哈希
- 发布机器可读的 OpenNeed 记忆稳态引擎产品 / 接口元描述
- 校验当前账本内本地证据包的哈希、发行者与签名
- 兼容解析 `did:openneed:` 与 `did:agentpassport:`
- 用分层记忆 + context builder + memory compactor + 回复校验器缓解身份漂移和部分上下文坍缩
- 用 agent runner 把 context builder / reasoner / 回复校验 / compactor / checkpoint 串成执行闭环
- 用 session state / compact boundary / integrity self-check run 把运行时状态、恢复点和 runtime integrity 自检显式化
- 用 runtime bootstrap 建最小冷启动包，并支持从 compact boundary 恢复上下文
- 用单机 resident agent 绑定把“当前本地参考层默认只服务一个 Agent”显式化
- 默认以 `local_only` 模式离线运行，并只在明确允许时切到 `online_enhanced`
- 服务默认只绑定到 `127.0.0.1`
- `/api` 写接口默认要求本机 `管理令牌`
- 用风险分级策略替代“所有动作都多签”，让 low risk 保持低延迟、critical 才升级到 multisig 冷路径
- 用本地对话纪要 + runtime search 让 Agent 忘了时先查本地纪要 / 决策 / 证据 / compact boundary，再重建上下文
- 默认把 runtime search 收敛成 `local_first_non_vector`，先走 lexical / tag / field 检索，不把向量库当第一阶段前提
- 本地参考层默认以加密 envelope 落盘，而不是继续把账本明文写回磁盘
- 正式恢复流程会派生出一条可执行 runbook，明确下一步、最近证据、是否可以直接跑恢复演练、是否可以导出初始化包
- 受限执行层除了 broker / worker 隔离外，还会在 macOS 上尽量落到 `sandbox-exec` 系统 sandbox，并把结果回写到运行时证据
- 自动恢复 / 续跑闭环不仅返回实时 closure，还会把收口审计落盘到 runner history 和 ledger event，便于事后追踪
- 查看完整链式事件账本
- 在浏览器里操作最小 demo 页面

## 启动

在项目根目录执行：

```bash
node src/server.js
```

或者：

```bash
npm run dev
```

如果要快速做一轮本地回归，可以在服务启动后执行：

```bash
npm run smoke:all
```

如果要分别看每一层，也可以继续单独执行：

```bash
npm run smoke:dom
npm run smoke:ui
npm run demo:context
npm run history:wording:audit
```

其中：

- `npm run smoke:dom`
  说明：不依赖浏览器、不依赖本地 HTTP，仅用 Node + 临时账本工作区 + 独立 keychain namespace + 前端共享链接模块做 agent-native UI 契约检查
  当前会覆盖公开运行态入口命名约定、`buildPublicRuntimeHref()` 固定回 `/`、runtime-home query helper 的参数 round-trip、修复中心 deep-link 契约、窗口绑定 / 引用窗口视图、repairId / credentialId / repair 分页 round-trip、status list selector / compare selector 状态保留，以及 sibling method 切换后的状态 / 时间线一致性
- `npm run smoke:ui`
  说明：连本地服务做一轮运行态契约 smoke
  当前会覆盖公开运行态 / 修复中心 / 离线线程公开入口、管理令牌与 read session 边界、本地存储加密与恢复流程、受限执行层、以及自动恢复 / 续跑闭环；脚本会显式建立它自己需要的最小 runtime 前置条件，不再依赖“之前有人跑过别的入口”。`keychain-migration` 只会在 `/api/security` 当前真值显示仍需从文件回退迁到系统保护层时才探测，不会把“已经达标”的状态误判成失败
- `npm run smoke:all`
  说明：先做 `verify:mempalace:remote-reasoner` preflight，再按 `smoke:ui -> smoke:dom -> smoke:browser` 顺序串行执行；默认会自起一个隔离的 loopback server，并同时隔离临时 data 副本、管理令牌文件回退路径、signing secret 文件回退路径和 keychain account namespace，避免多人开发时复用正在变化的本地进程，或者把 smoke 写回真实工作数据 / 真实系统保护层。这是当前推荐的默认 merge gate 入口
- `npm run smoke:all:parallel`
  说明：显式切到并行 combined 模式，回归更快，但如果你正在排查共享 device runtime 状态问题，优先还是跑默认串行入口
- `npm run demo:context`
  说明：使用临时 ledger 跑一轮“缓解上下文坍缩”最小回归，不污染你当前真实账本
  当前会验证：
  - runtime bootstrap 会先写 profile / task snapshot / runtime truth-source 约束记录
  - bootstrap 可以顺手认领当前本地参考层的 resident agent 绑定
  - profile / episodic / semantic / working / ledger 五层记忆
  - runner 先按本地参考层重建上下文，再调用 `local_mock` reasoner 生成候选回复
  - memory compactor 把多轮聊天写回结构化 memory
  - context builder 不是拼整段聊天，而是按槽位重建
  - 回复校验器能拦住错误的 `agent_id / role / name / wallet`
- `npm run history:wording:audit`
  说明：扫描 `data/` 里的历史账本、backup、setup package 和 archive，找出还没迁走的旧包装词；默认只做 dry-run，不改真实文件
- `npm run history:wording:apply`
  说明：把上面的历史措辞迁移真正写回历史文件；默认仍然跳过 `data/ledger.json`，只有显式加 `--include-live-ledger` 才会改当前真实账本
  - working memory 超阈值后会自动 rollover 成 checkpoint summary
  - compact boundary 生成后，runner / rehydrate 可以从 boundary 后继续恢复
  - 可以把本地对话纪要写进 本地参考层，并用 runtime search 把纪要 / 决策 / 证据重新搜回来
  - `openai_compatible` reasoner 会通过本地 stub 走一遍真实 LLM provider 契约
  - `local_only` 模式下，在线 provider 会自动降级到离线 provider，避免偷偷联网
  - 这条脚本主要验证身份字段和恢复链，不代表通用语义恢复已经可靠

如果你在 macOS 上，还可以直接跑 Safari 浏览器级回归：

```bash
npm run smoke:browser
```

说明：

- 这条浏览器级回归默认使用 Safari
- 这条回归会用 Safari DOM 自动化把 `/` 渲染出的 4 张卡、触发条件列表和可用入口列表，与当前 `/api/health` + `/api/security` 真值逐项比对；如果首页落到读取失败文案，会直接失败
- 首次使用前，需要在 Safari 的 Developer 设置里开启 `Allow JavaScript from Apple Events`
- 如果这项没有开启，`smoke:browser` 会明确失败并提示这是本机 Safari 设置问题；它不会再跳过首页 gate 后误判通过

默认地址：

- 首页: `http://localhost:4319`
- 高级维护: `http://localhost:4319/lab.html`
- 离线协作: `http://localhost:4319/offline-chat`
- 线程启动上下文（当前只支持 `phase_1`）: `http://localhost:4319/api/offline-chat/thread-startup-context?phase=phase_1`
- Web UI: `http://localhost:4319`
- 修复中心: `http://localhost:4319/repair-hub`
- Health: `http://localhost:4319/api/health`
- Security: `http://localhost:4319/api/security`
- Agents: `http://localhost:4319/api/agents`
- Ledger: `http://localhost:4319/api/ledger`

可选环境变量：

- `PORT`
- `OPENNEED_CHAIN_ID`
- `OPENNEED_LEDGER_PATH`
- `AGENT_PASSPORT_LLM_BASE_URL`
- `AGENT_PASSPORT_LLM_MODEL`
- `AGENT_PASSPORT_LLM_API_KEY`
- `AGENT_PASSPORT_ADMIN_TOKEN`
- `AGENT_PASSPORT_STORE_KEY`
- `HOST`

多窗口使用方式：

1. 打开这个页面的两个浏览器窗口或两个标签页。
2. 在两个窗口里都绑定到同一个 `Agent ID`。
3. 你会看到相同的身份、记忆、资产和消息上下文。
4. 每个窗口都有自己的 `windowId`，但背后共享同一个 Agent 中枢。

当前默认设备运行策略：

- 一台设备默认只绑定一个 resident agent
- 默认 resident agent 绑定到当前本地参考层的 canonical agent
- 默认 `local_only`
- 默认 `confirm_before_execute`
- 默认执行授权按风险分级：
  - `low=discuss`
  - `medium=discuss`
  - `high=confirm`
  - `critical=multisig`
- 默认检索策略是 `local_first_non_vector`
- 默认 `allowVectorIndex=false`
- 默认写接口要求本机 `管理令牌`
- 默认敏感读接口也要求本机 `管理令牌`
- 默认 本地参考层 以加密 envelope 落盘

这一步的目标不是“让模型永远不忘”，而是：

`不要让聊天记录成为身份，而是让身份决定每次该取哪些上下文。`

## API

### `GET /api/device/runtime`

读取当前这台机器的本地运行策略。

返回值会包含：

- `machineId`
- `machineLabel`
- `residentAgentId`
- `residentDidMethod`
- `residentDid`
- `residentLocked`
- `localMode`
- `allowOnlineReasoner`
- `commandPolicy`

`commandPolicy` 当前最重要的字段是：

- `negotiationMode=confirm_before_execute|discuss_first`
- `autoExecuteLowRisk`
- `riskStrategies.low|medium|high|critical`
- `requireExplicitConfirmation`

同时还会返回：

- `retrievalPolicy.strategy=local_first_non_vector`
- `retrievalPolicy.scorer=lexical_v1`
- `retrievalPolicy.allowVectorIndex=false`
- `retrievalPolicy.maxHits`
- `retrievalPolicy.externalColdMemory.enabled=false`
- `retrievalPolicy.externalColdMemory.provider=mempalace`
- `retrievalPolicy.externalColdMemory.maxHits`

`externalColdMemory` 默认关闭。开启后也只是只读冷记忆侧车，只提供候选线索，不覆盖 `ledger/profile/runtime` 本地参考层，也不会写回主记忆。

如果当前候选回复要交给远端 `http/openai_compatible` reasoner，external cold memory 也只会保留 `provider/hitCount` 这类边界信息，不会把候选原文直接发出去。

如果要接本机 `mempalace`，可以显式设置：

- `AGENT_PASSPORT_EXTERNAL_COLD_MEMORY_ENABLED=1`
- `AGENT_PASSPORT_MEMPALACE_PALACE_PATH=/absolute/path/to/palace`

如果只是想把 OpenNeed 自己的只读冷记忆侧车建起来，直接运行：

- `npm run build:mempalace:live`

这条命令会把当前工程仓库以及同级目录下的 `上下文坍缩测试工具`（如果存在）整理成 staging 语料，再 mine 到默认 sidecar palace：

- `~/.mempalace/openneed-sidecar-palace`

随后可以用下面的命令做真实命中校验：

- `npm run verify:mempalace:live -- "上下文坍缩"`

如果还要确认 sidecar 命中在远端 `http/openai_compatible` reasoner 出站时确实被脱敏，再跑：

- `npm run verify:mempalace:remote-reasoner`

这一步会明确验证：

- `externalColdMemory.hits` 不再透传空壳
- `redactedForRemoteReasoner=true`
- 出站 `payload` 不再带 `recentConversationTurns / toolResults`
- 出站 prompt 不再包含 `EXTERNAL COLD MEMORY CANDIDATES / QUERY BUDGET`

这个接口适合在 Agent 启动前先读一遍，确认这台设备到底归哪个 resident agent 使用。

### `GET /api/security`

读取当前本机安全基线摘要。

返回值会包含：

- `hostBinding`
- `authorized`
- `authorizedAs=public|admin|read_session`
- `apiWriteProtection.tokenRequired`
- `apiWriteProtection.tokenSource=env|file|keychain`
- `apiWriteProtection.keychainService`
- `apiWriteProtection.keychainAccount`
- `readProtection.sensitiveGetRequiresToken`
- `readProtection.scopedReadSessions`
- `readProtection.availableScopes`
- `localStore.encryptedAtRest`
- `localStore.encryptionSource`
- `localStore.systemProtected`
- `localStore.recoveryEnabled`
- `localStore.recoveryBaselineReady`
- `keyManagement.keychainPreferred`
- `keyManagement.keychainAvailable`
- `keyManagement.storeKey.source=env|keychain|file_record`
- `keyManagement.signingKey.source=env|keychain|file`

当前默认策略是：

- 服务只绑定 `127.0.0.1`
- `/api` 写接口默认要求 `Authorization: Bearer <token>`
- 敏感 `GET` 接口也默认要求 `Authorization: Bearer <token>`
- 读接口除了管理令牌，也支持按 scope 创建短时 read session
- read session 现在也支持 role presets、parent/child delegation 和资源绑定
- 资源绑定已经覆盖 `agents / windows / credentials / authorizations / migration repairs / status lists` 这些敏感读面
- 核心敏感读面现在也支持 endpoint-family 级别的细 scope
- 当前内置的细粒度角色还包括：
  - `authorization_observer`
  - `repair_observer`
  - `status_list_observer`
- macOS 上会优先尝试把 `管理令牌` 放进系统 Keychain，只有不可用时才回退到本地文件
- macOS 上会优先尝试把 store key 和 signing master secret 放进系统 Keychain，只有不可用时才回退到本地文件
- `localStore.encryptedAtRest` / `systemProtected` / `recoveryBaselineReady` 返回的是当前运行态真值，不是“这个功能理论上存在”
- `localStore.keyPath` 只有当前 store key 真走文件回退时才会返回，不再把默认文件位置误报成生效路径
- 未带 token 访问 `/api/security` 时，只返回 redacted 安全摘要，不再暴露本地路径

### `POST /api/security/keychain-migration`

把当前仍走文件回退的 store key / signing master secret 补齐到系统 Keychain。

这是一条迁移/补齐入口，不是每次都必须跑。先看 `GET /api/security`：

- 如果 `keyManagement.storeKey.source` 和 `keyManagement.signingKey.source` 都已经是 `keychain`，直接把当前状态视为已达标，跳过这条接口
- 只有当策略要求系统保护，而且至少一个 key material 还没进 `keychain` 时，才需要调用它

常用字段：

- `dryRun`
- `removeFile`

返回值会同时给出：

- `migration.storeKey`
- `migration.signingKey`

每一项都可能是实际迁移，也可能是 `skipped + reason`；不要把“接口存在”误当成“当前一定需要迁移”。

默认建议先用 `dryRun=true` 看迁移结果，再决定是否真的移除本地文件。

### `GET /api/security/read-sessions`

列出当前本机已签发的 scoped read sessions。

可选参数：

- `includeExpired=true|false`
- `includeRevoked=true|false`

这个接口本身是 admin-only，不接受 read session 反向读取。

### `POST /api/security/read-sessions`

创建一个短时、按 scope 限制的 read session。

常用字段：

- `label`
- `note`
- `role`
- `scopes`
- `agentIds`
- `windowIds`
- `credentialIds`
- `ttlSeconds`
- `parentReadSessionId`
- `canDelegate`
- `maxDelegationDepth`

补充约束：

- 角色化创建会先按 role preset 落默认 scopes
- 子会话的 `scopes` 不能超出父会话的范围
- 子会话的 TTL 不会超过父会话剩余寿命
- 子会话不能扩大 delegation 能力，`maxDelegationDepth` 只会更小
- 子会话不能扩大资源绑定范围，`agentIds / windowIds / credentialIds` 只能收窄
- 父会话一旦撤销或过期，整条子会话链都会失效
- 只有具备 `security` 或 `all` 范围的读会话，才允许继续派生更窄的子会话

当前内置角色：

- `all_read`
- `security_delegate`
- `runtime_observer`
- `recovery_observer`
- `agent_auditor`
- `window_observer`

当前支持的 scope：

- `security`
- `device_runtime`
- `recovery`
- `agents`
- `credentials`
- `authorizations`
- `migration_repairs`
- `status_lists`
- `windows`

补充说明：

- `/api/device/runtime/recovery` 现在单独走 `recovery` scope，不再跟 `device_runtime` 共用一档读权限
- 使用 `read_session` 读取 `/api/security` 或 recovery 列表时，默认会返回 redacted 视图，不暴露本地敏感路径
- 使用 `read_session` 读取 `agents/context/runtime/messages/memories/credentials/rehydrate/search` 时，默认只返回 redacted 观察视图：
  - 自由文本字段会被置空
  - 原始 proof / raw credential body 不再原样透出
  - prompt / local knowledge / runtime notes 只保留结构化元信息

返回值会只在创建当次返回一次明文 `token`；账本里只存哈希。响应里也会返回：

- `parentReadSessionId`
- `rootReadSessionId`
- `lineageDepth`
- `role`
- `canDelegate`
- `maxDelegationDepth`

### `POST /api/security/read-sessions/:id/revoke`

撤销一个已有的 read session。

常用字段：

- `revokedByAgentId`
- `revokedByWindowId`

如果撤销的是父会话，子会话不会被逐条重写成 `revoked`，但会通过祖先链校验统一失效。

### `POST /api/device/runtime`

更新当前这台机器的本地运行策略。

常用字段：

- `residentAgentId`
- `residentDidMethod`
- `localMode=local_only|online_enhanced`
- `allowOnlineReasoner`
- `negotiationMode=confirm_before_execute|discuss_first`
- `autoExecuteLowRisk`
- `lowRiskStrategy=auto_execute|discuss|confirm`
- `mediumRiskStrategy=discuss|confirm`
- `highRiskStrategy=confirm|multisig`
- `criticalRiskStrategy=multisig`
- `requireExplicitConfirmation`
- `retrievalStrategy=local_first_non_vector`
- `allowVectorIndex`
- `retrievalMaxHits`
- `localReasonerEnabled`
- `localReasonerProvider=local_command|local_mock|ollama_local|openai_compatible`
- `localReasonerCommand`
- `localReasonerArgs`
- `localReasonerCwd`
- `localReasonerTimeoutMs`
- `localReasonerMaxOutputBytes`
- `allowedCapabilities`
- `maxReadBytes`
- `maxListEntries`
- `maxProcessArgs`
- `maxProcessArgBytes`
- `maxUrlLength`
- `requireAbsoluteProcessCommand`
- `allowResidentRebind`
- `dryRun`

典型用途：

- 把这台设备认领为某个 canonical agent 的专属机器
- 默认离线运行，只在明确允许时切到联网增强
- 调整“低风险快执行 / 高风险先确认 / critical 才多签”的命令策略
- 明确把恢复检索固定在本地优先、非向量优先
- 给 resident agent 配置本地 `local_command` reasoner，离线时直接从本地参考层 组装上下文后再调用本地进程
- 把可执行能力收口到 allowlist，限制文件读取和目录列举预算

如果通过 `read_session` 读取这个接口，`sandboxPolicy.filesystemAllowlist / networkAllowlist / allowedCommands` 会被置空，只返回对应的 `*Count` 计数。
同时会保留 `allowedCommandsPinnedCount`，方便确认当前有多少条命令是 digest pinning。

### `GET /api/device/runtime/recovery`

读取当前本机可见的 recovery bundle 摘要列表。

可选参数：

- `limit=8`

返回值会包含：

- `bundles`
- `counts.total`
- `recoveryDir`

### `POST /api/device/runtime/recovery`

导出当前本地参考层的恢复包。

这个恢复包会：

- 用 passphrase 包装本地 store key
- 可选携带当前加密账本 envelope
- 可选保存到 `data/recovery-bundles`

常用字段：

- `passphrase`
- `note`
- `includeLedgerEnvelope`
- `saveToFile`
- `returnBundle`
- `dryRun`

### `POST /api/device/runtime/recovery/import`

导入一个恢复包，恢复本地 store key，必要时恢复账本 envelope。

常用字段：

- `passphrase`
- `bundle`
- `bundleJson`
- `bundlePath`
- `overwrite`
- `restoreLedger`
- `importStoreKeyTo=auto|keychain|file`
- `removeLegacyFile`
- `dryRun`

默认 `auto` 会优先把恢复出的 store key 导回系统 Keychain；只有 Keychain 不可用时才回退到本地文件。
`dryRun` 和正式导入现在共享同一套冲突检查：只要目标机器上已经有 store key 或 ledger envelope，且你没有显式传 `overwrite=true`，导入就会直接拒绝，不再出现“dry-run 能过、正式导入才覆盖”的分叉语义。

### `GET /api/device/runtime/recovery/rehearsals`

读取恢复演练记录。

可选参数：

- `limit=8`

返回值会包含：

- `rehearsals`
- `counts.total`
- `counts.byStatus`

这条链用于证明：

- recovery bundle 可解封
- 当前账本 envelope 可解密
- chainId / lastEventHash 能和当前本地 store 对齐

### `POST /api/device/runtime/recovery/verify`

对某个 recovery bundle 做一次显式恢复演练，不真正导入密钥。

常用字段：

- `passphrase`
- `bundle`
- `bundleJson`
- `bundlePath`
- `dryRun`
- `persist`

当前会返回：

- `rehearsal.status=passed|partial|failed`
- `rehearsal.matchSummary`
- `rehearsal.bundleLedgerSummary`
- `rehearsal.currentLedgerSummary`

### `GET /api/device/setup`

读取当前设备是否已经完成“单机单 Agent”冷启动。

返回值会包含：

- `setupComplete`
- `missingRequiredCodes`
- `residentAgentId`
- `residentDidMethod`
- `checks`
- `deviceRuntime`
- `setupPolicy`
- `bootstrapGate`
- `localReasonerDiagnostics`
- `formalRecoveryFlow`
- `automaticRecoveryReadiness`
- `recoveryBundles`
- `recoveryRehearsals`
- `latestPassedRecoveryRehearsal`
- `latestPassedRecoveryRehearsalAgeHours`
- `setupPackages`

这条接口会检查至少这些前置条件：

- resident agent 是否已绑定
- task snapshot / profile 是否已就绪
- local reasoner 是否已配置
- local reasoner 是否真实可达
- recovery export 是否可用

同时会返回：

- `formalRecoveryFlow.runbook`
- `formalRecoveryFlow.operationalCadence`
- `automaticRecoveryReadiness`

### `POST /api/device/setup`

执行一次设备初始化或 dry-run 预演。

常用字段：

- `residentAgentId`
- `residentDidMethod`
- `displayName`
- `role`
- `title`
- `currentGoal`
- `currentPlan`
- `nextAction`
- `recoveryPassphrase`
- `dryRun`

适合在一台新机器第一次承载 resident agent 时执行。

### `GET /api/device/setup/package`

预览当前这台机器的 `device setup package`。

这不是密钥导出，也不包含 recovery passphrase。它只会打包：

- resident agent / did method
- 当前 device runtime 配置
- 当前 setup 状态与缺失项
- recovery / rehearsal 摘要
- 当前设备上已保存的 local reasoner profiles 摘要

适合用来：

- 迁机前确认当前单机配置
- 重装前保存一份“不带秘密的 setup manifest”
- 在另一台机器上 dry-run 预演导入

### `POST /api/device/setup/package`

导出一个显式的 `device setup package`。

常用字段：

- `note`
- `saveToFile`
- `returnPackage`
- `dryRun`
- `includeLocalReasonerProfiles`

导出的 package 不包含：

- store key
- signing key
- 管理令牌
- recovery passphrase

### `GET /api/device/setup/packages`

列出本机当前可见的 `device setup package` 摘要。

可选参数：

- `limit=5`

返回值会包含：

- `packages`
- `counts.total`
- `packageDir`

### `GET /api/device/setup/packages/:packageId`

读取某一份已保存的 `device setup package`。

适合：

- 重装前确认某一份 package 的 resident/runtime 内容
- 导入前先做人工核对
- smoke / 运维链路里确认最近一次导出是否正确

### `POST /api/device/setup/packages/:packageId/delete`

删除一份已保存的 `device setup package`。

常用字段：

- `dryRun`

### `POST /api/device/setup/packages`

按保留策略清理一批已保存的 `device setup package`。

常用字段：

- `keepLatest`
- `residentAgentId`
- `noteIncludes`
- `dryRun`

适合：

- 保留最近 N 份 setup package
- 只清理某个 resident agent 的历史 package
- 用 `noteIncludes` 先过滤 smoke / 运维批次，避免误删别的 package

### `POST /api/device/setup/package/import`

导入一个 `device setup package`，把 resident/runtime 配置重新落到当前设备。

常用字段：

- `package`
- `packageJson`
- `packagePath`
- `allowResidentRebind`
- `dryRun`
- `importLocalReasonerProfiles`

这个导入链默认只恢复：

- resident 绑定
- device runtime policy
- local reasoner / retrieval / sandbox 配置
- 可选的 local reasoner profiles

它不会直接恢复：

- 加密账本
- store key
- signing key
- 管理令牌

### `GET /api/device/runtime/local-reasoner`

检查当前本机 local reasoner 的真实状态。

返回值会包含：

- `deviceRuntime`
- `diagnostics.provider`
- `diagnostics.configured`
- `diagnostics.reachable`
- `diagnostics.status`

其中：

- `local_command` 会检查 command / cwd / 首个脚本参数是否存在
- `ollama_local` 会探测本机 Ollama 的 `/api/tags`，并返回当前模型列表

### `GET /api/device/runtime/local-reasoner/catalog`

返回当前单机可见的本地 reasoner 目录。

当前会列出：

- `local_command`
- `ollama_local`
- `local_mock`

每个 provider 都会带：

- `selected`
- `config`
- `selection`
- `lastProbe`
- `lastWarm`
- `diagnostics`
- `availableModels`

### `POST /api/device/runtime/local-reasoner/probe`

对一组临时 local reasoner 配置执行探针，不直接改写当前 runtime。

常用字段：

- `provider`
- `command`
- `args`
- `cwd`
- `baseUrl`
- `model`

### `POST /api/device/runtime/local-reasoner/select`

把当前 device runtime 的本地 reasoner 切到指定 provider，并把选择结果持久化。

常用字段：

- `provider`
- `enabled`
- `command`
- `args`
- `cwd`
- `baseUrl`
- `model`
- `dryRun`

这个接口适合把“探针通过的配置”正式切成当前 resident runtime 的选中 provider。

### `POST /api/device/runtime/local-reasoner/prewarm`

对当前选中的本地 reasoner 执行一次真实预热，并把 `lastProbe / lastWarm` 写回 runtime。

常用字段：

- `provider`
- `baseUrl`
- `model`
- `dryRun`

预热不是只看配置字段，而是会真实走一轮本地 candidate 生成链，验证：

- provider 是否可达
- 当前模型是否可用
- 本地 Runtime 是否能拿到候选回复

### `GET /api/device/runtime/local-reasoner/profiles`

列出当前设备上已保存的 local reasoner profile 摘要。

适合：

- 查看 resident runtime 当前可复用的本地推理器配置快照
- 给不同机器或不同离线模式准备 profile 目录

返回摘要里现在还会带：

- `health.status`
- `health.restorable`
- `health.lastHealthyAt`

### `POST /api/device/runtime/local-reasoner/profiles`

把当前 local reasoner 配置保存成一个可复用 profile。

常用字段：

- `profileId`
- `label`
- `note`
- `source`
- `dryRun`

### `GET /api/device/runtime/local-reasoner/profiles/:profileId`

读取单个 local reasoner profile 的摘要和配置详情。

如果通过 `read_session` 读取这个接口，`command / cwd / args` 会被 redaction，不会直接暴露本地命令链。

### `POST /api/device/runtime/local-reasoner/profiles/:profileId/activate`

把某个已保存的 local reasoner profile 重新激活到当前 device runtime。

适合：

- 在 `local_command / ollama_local / local_mock` 之间快速切换
- 把一次 probe 成功的配置固化成 profile 再反复启用

### `POST /api/device/runtime/local-reasoner/profiles/:profileId/delete`

删除一个已保存的 local reasoner profile。

### `GET /api/device/runtime/local-reasoner/restore-candidates`

列出当前设备上可用于恢复 local reasoner 的候选 profile。

它会按下面的优先级排序：

- 是否可恢复
- 最近一次健康时间
- 最近激活时间
- 使用次数
- 最近更新时间

返回字段里会包含：

- `recommended`
- `health.status`
- `health.restorable`
- `health.lastHealthyAt`

### `POST /api/device/runtime/local-reasoner/restore`

把当前 device runtime 的 local reasoner 恢复到某个可用 profile。

常用字段：

- `profileId`
- `prewarm`
- `dryRun`

如果不传 `profileId`，系统会优先挑选当前最推荐的 restore candidate。

默认恢复链会：

- 重新激活对应 profile
- 可选执行一次 `prewarm`
- 把恢复结果重新写回当前 runtime

### `POST /api/agents/:id/runtime/actions`

在当前 runtime 的受限动作执行层里执行一个受限动作。

说明：代码字段仍沿用 `sandbox*` 命名；当前实现是“受限执行层 + broker / worker 隔离”，并且在 macOS 上会优先给 broker 落 `sandbox-exec`，但还不是完整容器级沙箱。

当前支持的能力：

- `runtime_search`
- `filesystem_list`
- `filesystem_read`
- `conversation_minute_write`

额外约束：

- `process_exec` 输入正文会受到 `maxProcessInputBytes` 预算限制
- `local_command` reasoner 也会走独立的 worker 输入预算
- 如果 `local_command` 输入超限，会显式失败，不会把 JSON 静默截断后继续执行
- `network_external`
- `process_exec`

执行前仍然会经过：

- resident gate
- bootstrap gate
- risk-tier negotiation
- capability allowlist / filesystem allowlist

补充说明：

- 就算能力、命令、URL 只写在 `sandboxAction` 里，协商层和真实执行层也会按同一套 allowlist / disable policy 重复校验
- 也就是说，`sandboxAction` 不是绕过 negotiation 的另一条入口，只是执行参数的结构化载体

常用字段：

- `interactionMode=command`
- `executionMode=execute`
- `confirmExecution=true`
- `requestedAction`
- `requestedCapability`
- `requestedActionType`
- `targetResource`
- `sandboxAction`

返回值会包含：

- `status`
- `negotiation`
- `sandboxExecution.capability`
- `sandboxExecution.executionBackend`
- `sandboxExecution.output`
- `sandboxAudit`

其中：

- `runtime_search / conversation_minute_write` 当前走 `in_process`
- `filesystem_list / filesystem_read` 当前走 `subprocess worker`
- `network_external / process_exec` 已接入 worker backend，但默认仍受风险分级、allowlist 和关闭状态约束
- `network_external` 只允许 `http/https`
- `network_external` 默认拒绝 HTTP 重定向，避免 allowlisted host 被重定向逃逸
- host allowlist 现在走精确 hostname 匹配，不再做模糊匹配
- `process_exec` 默认要求绝对路径命令，并受 `maxProcessArgs / maxProcessArgBytes` 预算约束
- `process_exec` allowlist 现在支持 `绝对路径|sha256=<digest>` 的 digest pinning
- 如果 allowlisted 命令配置了 digest，实际执行前会对真实二进制做 `sha256` 校验，不匹配就直接拒绝
- `process_exec` worker 会在隔离的 `HOME/TMPDIR` 下运行，不再继承主进程环境变量

### `GET /api/agents/:id/runtime/actions`

列出当前 Agent 最近的受限动作审计历史。

说明：返回字段仍沿用 `sandbox action` 命名，兼容现有接口。

常用查询参数：

- `limit`
- `capability`
- `status`
- `didMethod`

返回值会包含：

- `audits`
- `counts.total`
- `counts.byCapability`
- `counts.byStatus`

适合：

- 查看 resident runtime 最近做过哪些受限动作
- 区分哪些 action 成功、哪些被拒绝或失败
- 配合 `runtime_search / filesystem_* / process_exec / network_external` 做本地审计

如果通过 `read_session` 读取这个接口：

- `input` 会做字段级 redaction
- 文件路径、命令路径、URL、stdout/stderr、preview 等敏感字段不会直接透出
- `runtime_search` 和 `conversation_minute_write` 的输出也会继续走各自的 redaction 规则

### `GET /api/protocol`

读取当前 `OpenNeed 记忆稳态引擎` 的机器可读产品 / 接口元描述。

返回值会包含：

- 当前协议名、版本、链 ID
- 当前第一阶段产品定位与 MVP 叙事
- 当前人类可读文档索引
- 当前安全架构原则与已知缺口
- 下一阶段实施清单
- 当前启用的 DID method、未来计划 method、可解析 / 可签发列表与 migration 状态
- DID / VC / proof / status / evidence 的 canonical type
- 对旧 `OpenNeed*` 类型名的兼容别名
- 当前本地账本里的 agents / credentials / comparison audits 数量

这个接口主要给 agent 自己读，让它先知道“当前产品和接口怎么组织”，再去调用其它身份、比较和证据接口。

### `GET /api/roadmap`

读取精简后的产品定位、当前安全架构和下一阶段实施清单。

这个接口适合：

- 给 agent 自己读下一阶段目标
- 给前端或控制台展示当前 MVP 定位
- 给后续自动化任务读取安全与实施优先级

### `POST /api/agents`

创建新的 Agent 身份。

```json
{
  "displayName": "OpenNeed Agents",
  "role": "shared-identity",
  "controller": "Kane",
  "signers": ["Kane", "Alice"],
  "multisigThreshold": 2,
  "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "initialCredits": 100
}
```

### `POST /api/agents/:id/fork`

从已有 Agent 分叉出新的身份。

```json
{
  "displayName": "OpenNeed Agents v2",
  "role": "forked-agent",
  "controller": "OpenNeed Agents",
  "signers": ["Kane", "Alice"],
  "multisigThreshold": 2,
  "authorizedBy": "source-agent",
  "approvals": ["Kane", "Alice"]
}
```

### `PATCH /api/agents/:id/policy`

更新某个 Agent 的签名策略。

```json
{
  "signers": ["Kane", "Alice", "Bob"],
  "multisigThreshold": 2,
  "walletAddress": "0x1234567890abcdef1234567890abcdef12345678"
}
```

### `POST /api/agents/:id/grants`

给某个 Agent 授权资源。

```json
{
  "fromAgentId": "agent_xxx",
  "amount": 20,
  "assetType": "credits",
  "reason": "bootstrap",
  "authorizedBy": "agent_xxx",
  "approvals": ["agent_xxx"]
}
```

### `GET /api/agents/:id/context`

读取一个 Agent 的共享中枢上下文，包含身份、资产、窗口、记忆、消息、授权提案和该身份域下的状态列表摘要。
返回值里会同时带上 `statusList` 和 `statusLists`，前者是当前 Agent 对应的默认状态列表，后者是注册表里的状态列表集合。
现在还会带上 `credentialMethodCoverage`，用于说明这个 Agent 相关证据在 `openneed` / `agentpassport` 两条 DID method 下的覆盖情况。
其中 `credentialMethodCoverage.repairableSubjects` 会直接列出当前可以自动补齐缺失 method 的证据对象。
现在也会带上最近的 `migrationRepairs` 和 `counts.migrationRepairs`，方便 agent 不额外查 repair 接口，也能直接在共享中枢里看到最近修复历史。

如果通过 `read_session` 读取，这个接口现在默认返回 redacted 观察视图：

- `memories / inbox / outbox` 只保留元信息，不回正文
- `runtime.taskSnapshot` 的 `objective / nextAction / currentPlan` 会被置空
- `credentials` 里的 `proofValue` 会被置空
- `memoryLayers` 会收敛成计数与字段键集合，而不是整层内容回放

可选参数：

- `didMethod=openneed`
- `didMethod=agentpassport`

传 `didMethod=agentpassport` 时，共享中枢里返回的 `identity.did`、`didDocument` 和默认状态列表会切到 `did:agentpassport:` 视角。

现在这个 context 还会返回 `memoryLayers`，把 本地参考层里的五层记忆一起暴露出来：

- `ledger`
  说明：基础参考层，来自 ledger / DID / 钱包 / 授权 / 分叉 / 承诺
- `profile`
  说明：稳定身份层，记录名字、角色、长期目标、稳定偏好
- `episodic`
  说明：阶段经历层，记录任务结果、关系变化、阶段事件
- `semantic`
  说明：语义抽象层，记录从多次事件里沉淀出的 schema 和稳定规律
- `working`
  说明：工作上下文层，记录当前任务临时上下文、recent turns、tool results

这一步的核心原则是：

`聊天记录不是身份；本地参考层才是身份。`

当前 context / runtime 相关返回值里还会带：

- `deviceRuntime`
- `residentGate`

其中 `residentGate` 会明确告诉你：

- 当前 Agent 是不是这台机器的 resident agent
- 当前运行是否被 resident 锁阻止
- 当前本地模式是否允许联网增强

### `POST /api/agents/:id/memories`

给某个 Agent 写入一条共享记忆。

### `GET /api/agents/:id/memories`

读取某个 Agent 的记忆列表。

### `POST /api/agents/:id/messages`

把一条消息路由到某个 Agent 的共享收件箱。

默认只信任目标 Agent 路径参数；`fromAgentId` / `fromWindowId` 不再作为 HTTP 请求里的可信 sender 归因来源。

### `GET /api/agents/:id/messages`

读取某个 Agent 的收件箱 / 发件箱。

### `GET /api/agents/:id/passport-memory`

读取 本地参考层里的分层记忆。

可选参数：

- `layer=profile|episodic|semantic|working|ledger`
- `kind=role|result|commitment|...`
- `query=...`
- `limit=20`

### `POST /api/agents/:id/passport-memory`

直接写入一条结构化本地记忆记录。

```json
{
  "layer": "profile",
  "kind": "role",
  "summary": "CEO",
  "content": "CEO",
  "payload": {
    "field": "role",
    "value": "CEO"
  },
  "tags": ["identity"],
  "sourceWindowId": "window_demo_1",
  "recordedByAgentId": "agent_openneed_agents",
  "recordedByWindowId": "window_demo_1"
}
```

### `POST /api/agents/:id/memory-compactor`

把多轮聊天压缩成结构化 memory。

注意：

- 它不是单纯摘要聊天
- 它会把对话里的稳定身份、阶段结果、当前任务、承诺等信息写回本地参考层
- 摘要只作为辅助，结构化本地记忆记录才是本地参考层

```json
{
  "turns": [
    { "role": "user", "content": "名字：沈知远" },
    { "role": "assistant", "content": "角色：CEO" },
    { "role": "user", "content": "当前任务：推进 context builder" },
    { "role": "assistant", "content": "承诺：本地参考层才是本地参考源" }
  ],
  "writeConversationTurns": true,
  "sourceWindowId": "window_demo_1",
  "recordedByAgentId": "agent_openneed_agents",
  "recordedByWindowId": "window_demo_1"
}
```

### `POST /api/agents/:id/runtime/bootstrap`

给一个 Agent 建最小冷启动包。

这个入口会尽量复用现有 store 结构，而不是另起一套：

- 写 `profile memory`
- 写最小 `working memory`
- 可选写默认 ledger commitment
- 创建或更新 `task snapshot`
- 生成新的 `contextBuilder / rehydrate / sessionState`
- 给 `task snapshot` 写入默认 runtime budget
- 可选把当前设备认领为这个 Agent 的 resident machine

推荐在 agent 第一次进入 runner 前先走一次。

```json
{
  "displayName": "沈知远",
  "role": "CEO",
  "longTermGoal": "让 OpenNeed 记忆稳态引擎成为本地 runtime 底座",
  "stablePreferences": ["冷启动优先", "先验证再写回"],
  "title": "OpenNeed 启动准备",
  "currentGoal": "建立最小冷启动包，避免身份漂移",
  "currentPlan": ["写 profile", "写 snapshot", "验证 runner"],
  "nextAction": "执行 runtime integrity 自检",
  "constraints": ["LLM 不是本地参考源", "高风险动作需要 grounding"],
  "successCriteria": ["snapshot 可用", "profile 就绪"],
  "maxConversationTurns": 12,
  "maxContextChars": 16000,
  "maxRecentConversationTurns": 6,
  "maxToolResults": 6,
  "maxQueryIterations": 4,
  "createDefaultCommitment": true,
  "claimResidentAgent": true,
  "dryRun": false
}
```

如果只是想看“会写什么”而不真正落盘，可以传：

- `dryRun=true`

### `GET /api/agents/:id/runtime/minutes`

读取某个 Agent 的本地对话纪要列表。

可选参数：

- `limit=8`

### `POST /api/agents/:id/runtime/minutes`

写入一条本地对话纪要。

这层的目标不是“把整段聊天塞回 prompt”，而是把阶段性讨论结果落成可检索的本地纪要，后续给 `runtime search / rehydrate / context builder` 复用。

```json
{
  "title": "4 月 3 日离线运行讨论",
  "summary": "确认当前本地参考层默认只绑定一个 resident agent，忘了先查本地纪要再恢复。",
  "transcript": "结论：不要从聊天历史猜身份，要从本地参考层和本地纪要恢复。",
  "highlights": ["single resident agent", "local search", "rehydrate"],
  "actionItems": ["补本地模型 provider", "补 transcript model"],
  "tags": ["minutes", "offline", "runtime"],
  "sourceWindowId": "window_demo_1",
  "recordedByAgentId": "agent_openneed_agents",
  "recordedByWindowId": "window_demo_1"
}
```

### `GET /api/agents/:id/transcript`

读取当前 Agent 的结构化 transcript。

可选参数：

- `family=runtime|conversation|message|checkpoint`
- `limit=20`

返回值会包含：

- `transcript.entryCount`
- `transcript.entries`
- `transcript.familyCounts`
- `transcript.entryTypeCounts`
- `transcript.messageBlocks`
- `transcript.families`
- `counts.byEntryType`

这层和 conversation minutes 不同：

- minutes 是阶段性纪要
- transcript 是 runtime 真实事件轨

当前 transcript 会记录：

- `user_turn`
- `assistant_turn`
- `tool_result`
- `verification`
- `checkpoint`
- `compact_boundary`
- `message_inbox`
- `message_outbox`

### `GET /api/agents/:id/runtime/search`

在本地参考层里搜索当前 Agent 的可恢复知识。

当前会检索这些来源：

- `conversation_minute`
- `task_snapshot`
- `decision`
- `evidence`
- `passport_memory`
- `compact_boundary`
- `external_cold_memory`，但只会在显式开启 `retrievalPolicy.externalColdMemory.enabled=true` 后出现

可选参数：

- `didMethod=agentpassport|openneed`
- `query=...`
- `sourceType=conversation_minute|task_snapshot|decision|evidence|passport_memory|compact_boundary|external_cold_memory`
- `limit=8`

默认不混入外部冷记忆；只有显式传 `sourceType=external_cold_memory` 时，runtime search 才会返回 sidecar 候选。

返回值里会包含：

- `hits`
- `counts.bySource`
- `suggestedResumeBoundaryId`
- `retrieval.strategy=local_first_non_vector`
- `retrieval.scorer=lexical_v1`
- `retrieval.vectorUsed=false`
- `retrieval.externalColdMemoryEnabled`
- `retrieval.externalColdMemoryProvider`
- `retrieval.externalColdMemoryHitCount`

如果启用了 `external_cold_memory`：

- 它只是只读候选线索
- 不覆盖 `ledger/profile/runtime` 本地参考层
- `context builder` 会单独放进 `externalColdMemory`

如果通过 `read_session` 读取，`hits` 仍会保留来源类型和分数，但自由文本、URI 和原始 payload 会被 redacted。

如果外部冷记忆检索本身报错，`read_session` 也不会直接返回原始错误文本，而是改成：

- `retrieval.externalColdMemoryError=null`
- `retrieval.externalColdMemoryErrorRedacted=true`

### `GET /api/agents/:id/runtime/rehydrate`

读取当前 agent 的最小 rehydrate 包。

默认返回当前运行态下的重建包；如果要从某个 compact boundary 后继续恢复，可以传：

- `resumeFromCompactBoundaryId=cbnd_xxx`

返回值现在会额外包含：

- `resumeBoundary`
- `sources.resumeFromCompactBoundaryId`
- `deviceRuntime`
- `residentGate`
- `localKnowledgeHits`
- `externalColdMemoryHits`

如果通过 `read_session` 读取：

- `prompt` 会被置空
- `localKnowledgeHits` 的自由文本与 URI 会被 redacted
- `externalColdMemoryHits` 的自由文本与来源细节也会被 redacted
- `recentMemories / recentInbox / recentOutbox` 的正文会被 redacted
- `recentCredentials` 的 `proofValue` 会被 redacted

### `POST /api/agents/:id/context-builder`

按槽位重建上下文，而不是拼接整段聊天历史。

当前会组装这些槽位：

- `systemRules`
- `currentGoal`
- `identitySnapshot`
- `relevantLedgerFacts`
- `localKnowledgeHits`
- `externalColdMemory`
- `resumeBoundary`
- `relevantProfileMemories`
- `relevantEpisodicMemories`
- `queryBudget`
- `recentConversationTurns`
- `toolResults`

这里要注意：

- `localKnowledgeHits` 只代表本地真源命中
- `externalColdMemory` 才代表 `mempalace` 这类外部冷记忆侧车命中
- 如果当前回复要交给远端 `http/openai_compatible` reasoner，`externalColdMemory` 会只保留 `provider/hitCount/candidateOnly/hint`
- 同时会显式带上 `redactedForRemoteReasoner=true`，并从 `compiledPrompt` 里去掉 `EXTERNAL COLD MEMORY CANDIDATES / QUERY BUDGET`
- `http` provider 的出站 `payload` 不再保留空的 `recentConversationTurns / toolResults`

```json
{
  "currentGoal": "继续推进 context builder",
  "query": "identity snapshot response-check",
  "resumeFromCompactBoundaryId": "cbnd_xxx",
  "recentConversationTurns": [
    { "role": "user", "content": "不要从整段历史里猜身份" }
  ],
  "toolResults": [
    { "tool": "runtime", "result": "rehydrate ready" }
  ]
}
```

### `POST /api/agents/:id/response-verify`

在模型回复后，用本地参考层 做事实校验。

当前最小校验会检查：

- 有没有说错 `agent_id`
- 有没有说错 `parent / fork` 关系
- 有没有说错钱包地址
- 有没有和授权阈值冲突
- 有没有和 profile memory 的名字 / 角色冲突

```json
{
  "responseText": "agent_id: agent_treasury",
  "claims": {
    "agentId": "agent_treasury",
    "role": "产品总监"
  }
}
```

### `GET /api/agents/:id/runner`

读取最近的 runner 运行记录。

可选参数：

- `limit=10`
- `status=prepared|completed|blocked|rehydrate_required|needs_human_review|bootstrap_required|resident_locked|negotiation_required`

### `POST /api/agents/:id/runner`

执行一轮最小 runner 闭环。

当前流程是：

1. 先按本地参考层重建 context
2. 如果 resident agent 绑定策略不满足，则直接返回 `resident_locked`
3. 如果 bootstrap gate 不满足，则直接返回 `bootstrap_required`
4. 根据本地运行策略选择 reasoner；`local_only` 模式会优先落到离线 provider
5. 如果是命令型输入，先走 negotiation loop，必要时返回 `negotiation_required`
6. 再做 drift check
7. 如果拿到了候选回复，就做回复校验
8. 如果校验通过，再把这一轮 conversation / tool results compact 回结构化 memory
9. working memory 超阈值时自动做 checkpoint / rollover
10. 最后生成一条运行记录

```json
{
  "currentGoal": "继续推进 context builder",
  "query": "identity snapshot response-check",
  "resumeFromCompactBoundaryId": "cbnd_xxx",
  "userTurn": "请确认你是谁",
  "interactionMode": "command",
  "requestedAction": "整理本地对话纪要，并更新 working memory",
  "executionMode": "execute",
  "confirmExecution": false,
  "allowOnlineReasoner": false,
  "recentConversationTurns": [
    { "role": "assistant", "content": "应当先回本地参考层 取本地资料" }
  ],
  "toolResults": [
    { "tool": "runtime", "result": "rehydrate ready" }
  ],
  "reasonerProvider": "local_mock",
  "reasonerUrl": "http://127.0.0.1:3000",
  "reasonerModel": "gpt-4.1-mini",
  "queryIteration": 2,
  "turnCount": 3,
  "estimatedContextChars": 1600,
  "workingCheckpointThreshold": 12,
  "workingRetainCount": 6,
  "autoCompact": true,
  "storeToolResults": true,
  "persistRun": true,
  "sourceWindowId": "window_demo_1",
  "recordedByAgentId": "agent_openneed_agents",
  "recordedByWindowId": "window_demo_1"
}
```

返回值里会包含：

- `run`
- `contextBuilder`
- `reasoner`
- `reasonerPlan`
- `bootstrapGate`
- `residentGate`
- `negotiation`
- `queryState`
- `driftCheck`
- `verification`
- `compaction`
- `checkpoint`
- `compactBoundary`
- `sessionState`

如果你传了 `resumeFromCompactBoundaryId`，返回的 `run` 也会带：

- `resumeBoundaryId`

如果你已经有人工写好的候选回复，也可以继续传 `candidateResponse`，此时 runner 会自动回退到 `passthrough` 模式。

当前 reasoner provider 支持：

- `passthrough`
- `mock`
- `local_mock`
- `local_command`
- `ollama_local`
- `http`
- `openai_compatible`

其中：

- `local_mock` 代表本地离线优先的最小 provider，适合单机单 Agent 的第一阶段
- `local_command` 代表把上下文组装后交给本机命令执行器，适合离线 fixture、本地脚本和后续自托管推理器
- `ollama_local` 会向本机 Ollama 的 `/api/chat` 发请求，适合真正接入离线本地模型
- `openai_compatible` 会向兼容 `/v1/chat/completions` 的端点发起真实模型调用，适合接本地网关或兼容服务
- 如果当前设备是 `local_only`，而你又请求了在线 provider，runner 会自动降级到离线 provider，而不是偷偷联网

这个接口是当前最接近“默认执行路径”的入口，后面如果要把外部 LLM 真正接进来，最自然的做法就是把模型调用挂在这个 runner 的前后。

### `GET /api/agents/:id/session-state`

读取当前 agent 的显式运行时状态。

返回值会包含：

- 当前 DID / didMethod
- `currentGoal`
- `currentTaskSnapshotId`
- `latestRunId / latestRunStatus`
- `latestCompactBoundaryId`
- `latestResumeBoundaryId`
- `latestQueryStateId`
- `latestNegotiationId / latestNegotiationDecision`
- `queryState`
- `tokenBudgetState`
- `residentAgentId`
- `residentLockRequired`
- `localMode`
- `memoryCounts`

### `GET /api/agents/:id/query-states`

读取这个 agent 最近的显式 `QueryState` 历史。

每条 query state 会带：

- `queryStateId`
- `status`
- `currentGoal`
- `currentIteration / maxQueryIterations / remainingIterations`
- `resumeBoundaryId`
- `budget`
- `flags`
- `recommendedActions`

### `GET /api/agents/:id/compact-boundaries`

读取这个 agent 最近的 compact boundaries。

compact boundary 不是普通 summary，它代表一次明确的压缩恢复边界，里面会带：

- `compactBoundaryId`
- `runId`
- `previousCompactBoundaryId`
- `resumedFromCompactBoundaryId`
- `chainRootCompactBoundaryId`
- `resumeDepth`
- `lineageCompactBoundaryIds`
- `checkpointMemoryId`
- `contextHash`
- `archivedMemoryIds`
- `retainedMemoryIds`

### `GET /api/agents/:id/verification-runs`

读取这个 agent 最近的 runtime integrity 自检记录。

可选参数：

- `limit=10`
- `status=passed|failed|partial`

### `POST /api/agents/:id/verification-runs`

执行一轮 runtime integrity verification 自检。

这个入口的定位不是替代 runner，也不是外部独立审计，而是检查当前 runtime 是否具备：

- 稳定 identity snapshot
- task snapshot / profile bootstrap
- adversarial probe 拦截能力
- compact boundary 恢复点
- run 记录可回放性

```json
{
  "currentGoal": "检查当前 runtime 是否具备冷启动条件",
  "query": "runtime integrity compact boundary bootstrap",
  "mode": "runtime_integrity",
  "persistRun": true,
  "sourceWindowId": "window_demo_1"
}
```

返回值里会包含：

- `verificationRun`
- `sessionState`
- `contextBuilder`
- `adversarialVerification`

### `GET /api/agents/:id/authorizations`

读取某个 Agent 相关的授权提案。

返回的提案视图现在会带上 `signatures` / `signatureCount` / `latestSignatureAt` / `executionReceipt` / `timeline`，方便直接看谁签过、什么时候执行、执行结果是什么，以及整条提案路径。

### `GET /api/agents/:id/did`

读取该 Agent 的 DID 文档。

新的 DID 文档会公开一把确定性的 `#signing-1` 本地签名键，并保留钱包地址型 verification methods，方便后续接真正的 DID key 签名和 VC proof。

可选参数：

- `method=openneed`
- `method=agentpassport`

默认返回当前激活 method 的 DID 文档，同时响应里会带 `didAliases`，表示同一个 Agent 的 DID 别名集合。

### `GET /api/agents/:id/credential`

导出该 Agent 的本地证据包。

这个返回值是一个本地自签、可在当前账本内校验的 VC 风格对象，包含 DID、钱包、控制人、多签策略、窗口、记忆、授权提案和本地账本摘要，便于后续接真正的 Verifiable Credentials。

导出时会顺手在本地证据注册表里生成或复用一条快照记录，所以它不仅能被直接校验，也会出现在 `GET /api/credentials` 的状态列表里。

可选参数：

- `didMethod=openneed`
- `didMethod=agentpassport`
- `issueBothMethods=true`

这样可以显式指定这份 Agent 身份 VC 由哪条 DID method 签发；默认仍然沿用当前 active method。
传 `issueBothMethods=true` 时，响应除了主 `credential` 之外，还会返回 `alternates`，把另一条 signable DID method 视角的证据一起导出。

### `GET /api/agents/resolve`

按 `agentId`、`did`、`walletAddress` 或 `windowId` 解析一个 Agent。

这个接口适合多窗口场景里从窗口反查到共享的 Agent 身份。

现在如果传的是 `did:agentpassport:...`，也会解析回当前仍以 `did:openneed:...` 存储的同一个 Agent。

### `GET /api/agents/compare`

比较两个 Agent 的身份、钱包、多签策略、状态列表注册表和上下文计数。

可选参数：

- `leftAgentId` / `rightAgentId`
- `leftDid` / `rightDid`
- `leftWalletAddress` / `rightWalletAddress`
- `leftWindowId` / `rightWindowId`
- `messageLimit`
- `memoryLimit`
- `authorizationLimit`
- `credentialLimit`
- `summaryOnly`

默认返回两侧完整上下文；传 `summaryOnly=true` 时会压缩成快照级输出，更适合 agent 快速判断。

返回结果里的 `comparison` 现在还会带上 `migrationDiff`，可以直接判断两侧在 DID method 迁移覆盖上的差异，不需要 agent 自己再拼 sibling credentials。

### `POST /api/agents/:id/migration/repair`

对某个 Agent 相关的证据迁移缺口做自动补齐。

请求体可选字段：

- `dryRun`
- `kinds`
- `subjectIds`
- `comparisonPairs`
- `didMethods`
- `limit`
- `includeComparison`
- `receiptDidMethod`
- `issueBothMethods`

典型用途：

- 先 `dryRun=true` 看当前准备补哪些缺失 method
- 再正式执行，把缺失的 `agent_identity` / `authorization_receipt` / `agent_comparison` 证据补齐

返回结果会带：

- `plan`
- `repaired`
- `skipped`
- `beforeCoverage`
- `afterCoverage`
- `repairReceipt`

这个接口现在默认只修复当前 `:id` 作为 issuer 的证据域，不会顺手去改别的 issuer 域。
正式执行时还会额外签发一条 `migration_receipt`，把这次 repair 自身沉淀成一条可校验的本地 repair 记录。
如果传 `issueBothMethods=true`，repair receipt 会同时按两条 signable DID method 签发，响应里的 `repairReceipt` 会返回主记录和 `alternates`。

适合让 agent 做“先检查，再修复，再留记录、再复核”的闭环。

### `GET /api/agents/compare/evidence`

生成一份本地可校验的 Agent 比较审计证据包。

这个接口复用 `GET /api/agents/compare` 的输入参数，并额外支持：

- `issuerAgentId`
- `issuerDid`
- `issuerDidMethod`
- `issuerWalletAddress`
- `summaryOnly`
- `persist`
- `issueBothMethods`

传 `persist=true` 时，这份比较证据会进入本地证据注册表并拿到 `credentialRecord`，后续能直接出现在状态列表和审计流里。

如果传 `issuerDidMethod=agentpassport`，比较证据会用 `did:agentpassport:` 作为 issuer DID 重新签发，并写进对应身份域的状态列表。
如果再传 `issueBothMethods=true`，响应会保留主 `evidence`，并把另一条 DID method 视角的比较证据放进 `alternates`。

返回值里会包含 `comparison`、`comparisonDigest` 和一个 VC 风格的 `evidence.credential`，可以直接交给校验接口或 `POST /api/credentials/verify`。
现在还会带上 `repairIds` 和 `migrationRepairs`，方便 agent 直接看到这组 pair 最近做过哪些 migration repair，以及这些 repair 对应的回执聚合视图。

### `GET /api/agents/compare/audits`

读取同一对 Agent 的比较审计历史。

这个接口复用 `GET /api/agents/compare` 的定位参数，并额外支持：

- `issuerAgentId`
- `issuerDid`
- `issuerDidMethod`
- `status`
- `limit`

返回结果会带上这对 Agent 的 `pair` 摘要、匹配到的 `credentials`、聚合后的 `counts`，以及最新一条 `latest` 审计记录，适合 agent 回看同一组身份关系在不同时间点留下的比较证据。

传 `issuerDidMethod=agentpassport` 时，可以只看 `did:agentpassport:` 视角下的比较审计记录。

### `POST /api/agents/compare/migration/repair`

按 pair 粒度修复某一组 Agent 的比较审计证据。

请求体可选字段：

- `comparisonPairs`
- `leftAgentId` / `rightAgentId`
- `leftDid` / `rightDid`
- `leftWalletAddress` / `rightWalletAddress`
- `leftWindowId` / `rightWindowId`
- `issuerAgentId`
- `issuerDid`
- `issuerDidMethod`
- `issuerWalletAddress`
- `didMethods`
- `limit`
- `dryRun`
- `receiptDidMethod`
- `issueBothMethods`

这个接口和 `POST /api/agents/:id/migration/repair` 的区别是：

- 前者按 Agent 自己的 issuer 域补缺口
- 这个接口按“某一对 Agent”补 compare evidence，哪怕这条 pair 以前完全没落过盘，也能从零补出来

返回结果会带：

- `comparisonPairs`
- `plan`
- `repaired`
- `skipped`
- `repairReceipt`

如果传 `issueBothMethods=true`，这次 pair repair 的回执也会同时签发 `openneed` / `agentpassport` 两个版本。

### `GET /api/migration-repairs`

按 repair 维度查看本地迁移修复历史，可选 `agentId`、`comparisonSubjectId`、`comparisonDigest`、`issuerAgentId`、`scope`、`didMethod`、`sortBy`、`sortOrder`、`limit`、`offset` 过滤。

这个接口适合 agent 直接拉 repair 列表，不需要先查询 `credentials` 再自己归并。

返回值会带：

- `repairs`
- `counts.total`
- `counts.byScope`
- `counts.byDidMethod`
- `counts.latestIssuedAt`
- `page.total`
- `page.limit`
- `page.offset`
- `page.hasMore`
- `page.latestIssuedAt`

常用筛选示例：

- `agentId=agent_openneed_agents`
- `issuerAgentId=agent_treasury`
- `scope=comparison_pair`
- `didMethod=agentpassport`
- `sortBy=receiptCount&sortOrder=desc`
- `sortBy=repairedCount&sortOrder=desc`

### `GET /api/migration-repairs/:repairId`

按 `repairId` 读取一次 repair 的回执聚合视图。

返回结果外层会带一个 `repair` envelope，里面会包含：

- `repair`
- `receipts`
- `latestReceipt`
- `issuedDidMethods`
- `receiptCount`

这适合 agent 直接按 repairId 回看“这次修复到底做了什么、回执发了几条、分别是哪条 DID method”。

可选参数：

- `didMethod=openneed`
- `didMethod=agentpassport`

### `GET /api/migration-repairs/:repairId/credentials`

按 `repairId` 直接查看这次 repair 关联到的 credential 记录。

这个接口会把 repair receipt 和受影响 credential 分开返回，适合 agent 直接拿 repair 的影响面，不需要再自己根据 links 回拼。

返回值会带：

- `repair`
- `receipts`
- `credentials`
- `counts.byKind`
- `counts.byDidMethod`
- `page.total`
- `page.limit`
- `page.offset`
- `page.hasMore`

可选参数：

- `didMethod`
- `sortBy=latestRepairAt`
- `sortBy=repairCount`
- `sortBy=issuedAt`
- `sortOrder=desc`
- `limit`
- `offset`

### `GET /api/migration-repairs/:repairId/timeline`

按 `repairId` 读取 repair 聚合时间线。

这个接口会直接返回 repair 聚合视图字段，并额外带上 `timeline`、`timelineCount`、`latestTimelineAt`。
时间线会把 repair 本身的汇总节点，以及该 repair 下所有 sibling receipt 的签发 / 撤销时间线合并起来，适合做审计回放。

### `GET /repair-hub`

独立的修复中心页面。

这个页面是独立的修复中枢，专门用于查看 repair 列表、分页、受影响 credential、credential 深钻、状态证明和 repair 时间线。

页内 `open-main-context` 固定返回 `/`，不会再把 repair / credential / status-list 上下文反灌给首页。

支持的 query 参数包括：

- `agentId`
- `issuerAgentId`
- `scope`
- `didMethod`
- `windowId`
- `sortBy`
- `sortOrder`
- `limit`
- `offset`
- `repairId`
- `credentialId`

其中 `credentialId` 可以配合 sibling method 切换使用，让修复中心直接落到某个并行 DID method 的 credential 视角。

公开运行态 `/` 和修复中心现在共享 `public/ui-links.js` 里的入口命名约定；当前公开名是 `OpenNeedRuntimeLinks`，旧 `AgentPassportLinks` 只作为兼容别名保留。修复中心仍然保留自己的 deep-link 状态，但 `/` 本身不再承诺消费 repair / credential 上下文。

### `GET /api/offline-chat/bootstrap`

读取离线协作入口当前 runtime persona 真值。

返回值至少包含：

- `personas`
- `threads`
- `threads[group].participants`
- `threadStartup.phase_1`

其中 `group.participants` 和 `threadStartup.phase_1` 都直接来自当前 runtime persona 名单，不再依赖硬编码成员文案。

### `GET /api/offline-chat/thread-startup-context`

读取某个正式离线协作阶段的线程启动上下文。

当前只支持：

- `phase=phase_1`

返回值至少包含：

- `phaseKey`
- `threadId=group`
- `groupThread`
- `coreParticipants`
- `supportParticipants`
- `recommendedSequence`
- `rules`

如果 phase 不受支持，会返回 `404` 和 `supportedPhases`。

### `GET /`

公开运行态首页。它不再承载旧混合控制台，只回答 4 件事：服务是否活着、正式恢复是否仍在窗口内、自动恢复有没有越过 operator boundary、以及从哪里进入深操作。

它不再承诺消费 repair / credential deep-link 上下文；从修复中心返回 `/` 时，总是回到“公开运行态真值”本身。

如果 URL 还带着旧参数，首页会忽略这些 repair / credential / status-list 上下文，只回到公开运行态真值。深操作现在固定留在：

- `/repair-hub`
- `/offline-chat`
- `/lab.html`

### `POST /api/agents/compare/verify`

校验 Agent 比较审计证据包。

请求体可以直接传 `credential`，或者传整个 `evidence` 包。返回值和现有证据校验保持一致，便于 agent 自动复核。

当前校验结果除了 `hashMatches`、`issuerKnown` 之外，也会返回 `signatureRequired`、`signatureMatches` 和 `expectedVerificationMethod`。

### `GET /api/credentials`

查看本地全部证据状态，可选 `agentId`、`proposalId`、`kind`、`status`、`didMethod`、`issuerDid`、`issuerAgentId`、`repaired`、`repairId`、`sortBy`、`sortOrder`、`limit`、`repairLimit`、`repairOffset`、`repairSortBy`、`repairSortOrder` 过滤。

这个接口返回 `credentials` 和 `counts`，适合做证据中枢里的状态列表、撤销后回放和多窗口共享视图。
现在也可以直接用 `kind=migration_receipt` 查看 repair 回执历史。

列表里的每条证据现在会带 `issuerDidMethod`、`issuedByDidMethod`、`statusListDidMethod`、`repairedBy`、`repairIds`、`repairCount`、`latestRepairAt`，`counts.byDidMethod` 也会按 DID method 聚合，同时还会返回 `counts.repaired` / `counts.unrepaired` / `counts.repairGroups`。

返回值顶层现在还会带一个 `repairs` 数组，直接把当前这批证据关联到的 migration repair 聚合出来，方便 agent 不必自己二次归并：

- `repairId`
- `summary`
- `latestIssuedAt`
- `issuedDidMethods`
- `linkedCredentialCount`
- `linkedCredentialRecordIds`
- `linkedCredentialKinds`

同时还会返回一个 `repairsPage`：

- `total`
- `limit`
- `offset`
- `hasMore`
- `latestIssuedAt`

常用筛选示例：

- `repaired=true`
- `repairId=repair_xxx`
- `sortBy=latestRepairAt&sortOrder=desc`
- `sortBy=repairCount&sortOrder=desc`
- `repairLimit=5&repairOffset=0`
- `repairSortBy=linkedCredentialCount&repairSortOrder=desc`

如果通过 `read_session` 读取，列表里的 `credentialRecord.proofValue` 会被统一置空。

### `GET /api/credentials/:credentialId`

读取某条证据的详情。

可以用 `credentialId` 或 `credentialRecordId` 直接定位到本地注册表里的那条证据记录。
返回值里会附带 `siblings`，说明同一主体、同一 kind、同一 issuerAgent 下，这条证据在不同 DID method 上有哪些并行版本、缺哪些 method、是否已经齐备。
如果这条证据是被 migration repair 补出来的，详情里还会带 `repairedBy`、`repairIds`、`repairCount`、`latestRepairAt`，以及更完整的 `repairHistory`。
如果这条证据本身是 `migration_receipt`，详情里还会附带 `migrationRepairId`、`migrationSummary` 和 `migrationLinks`，把 repair 回执和被修复的 credential / compare subject / comparison pair 显式连起来。

如果通过 `read_session` 读取：

- `credentialRecord.proofValue` 会被置空
- 原始 `credential` 会收敛成摘要视图，只保留类型、issuer、status pointer 和 proof 元信息

### `GET /api/credentials/:credentialId/timeline`

读取某条证据的时间线。

返回结果会把这条证据的签发、迁移修复、撤销等节点按时间顺序展开，适合做审计回放或前端详情展示。
如果这条证据曾被 migration repair 补签，时间线里会出现 `credential_repaired` 节点。

如果通过 `read_session` 读取，timeline 会保留顺序、时间和 actor，但 `summary / details` 会做 redaction。

### `GET /api/credentials/:credentialId/status`

读取某条证据对应的状态列表快照和当前账本内可校验的撤销状态证明。

这个接口会返回该证据当前对应的状态列表、状态索引、状态证明和本地校验信息，适合做“某条证据现在是否仍然有效”的判断。

### `POST /api/credentials/:credentialId/revoke`

撤销一条本地证据记录。

请求体可以带 `reason`、`note`、`revokedByAgentId`、`revokedByWindowId`，撤销后再走 `GET /api/credentials` 或 `POST /api/credentials/verify` 就能看到状态变化。

### `POST /api/credentials/verify`

在当前本地账本上下文里校验一条证据。

新签发的本地 VC 风格对象已经开始使用 `AgentPassportEd25519Signature2026`，而且 VC body 里的 credential / evidence / status type 也开始切到 `AgentPassport*`。

因此这里除了哈希与状态列表，也会验证：

- proof 里的本地签名是否和 DID 文档里的 `#signing-1` 对得上
- proof 是否落在正确的 verification method 上
- 新旧 `AgentPassport*` / `OpenNeed*` 类型记录是否仍然兼容可验

校验一个本地证据包。

请求体可以直接传 `credential`，或者直接传整个证据对象。返回结果会说明哈希是否匹配、发行者是否存在于当前本地账本、证据里的 ledger hash 是否和当前账本一致，以及该证据在本地注册表里是否已经被撤销，并附带当前状态列表与撤销证明。

### `GET /api/status-lists`

读取当前本地状态列表摘要。

这个接口用于查看本地状态列表的整体快照，返回状态列表 ID、条目总数、活跃 / 已撤销计数以及状态列表哈希。
如果当前账本里存在多个 Agent 身份域，会返回多条状态列表摘要。

可以传 `issuerDid` 或 `issuerAgentId` 查询某个身份域对应的状态列表。

### `GET /api/status-lists/:statusListId`

读取某个状态列表的完整快照。

返回值会包含状态列表证书、摘要和每个条目的状态信息，适合做审计、调试或前端详情面板。

### `GET /api/status-lists/compare`

比较两个状态列表，并返回它们的身份域信息、DID / 钱包 / 多签策略和条目差异。

可选参数：

- `leftStatusListId` 或 `left`
- `rightStatusListId` 或 `right`
- `leftIssuerDid`
- `rightIssuerDid`
- `leftIssuerAgentId`
- `rightIssuerAgentId`

返回值会包含两侧状态列表、两侧 issuer 的身份摘要，以及 `comparison` 对象，方便 agent 做结构化判断或自动审计。

### `GET /api/agents/:id/assets`

读取该 Agent 的资产摘要。

### `GET /api/authorizations`

查看全部授权提案，可选 `agentId` 和 `limit` 过滤。

### `POST /api/authorizations`

创建一个新的授权提案。

```json
{
  "policyAgentId": "agent_openneed_agents",
  "actionType": "grant_asset",
  "title": "Bootstrap grant",
  "delaySeconds": 0,
  "expiresInSeconds": 86400,
  "approvals": ["Kane"],
  "payload": {
    "targetAgentId": "agent_xxx",
    "amount": 20,
    "reason": "bootstrap grant"
  }
}
```

### `POST /api/authorizations/:proposalId/sign`

给一个授权提案追加审批。

可选携带 `sourceWindowId`，前端会自动写入当前窗口来源；响应里会更新签名记录和最新签名时间。现在签名记录还会保留 actor 的窗口、标签和可解析身份。

### `POST /api/authorizations/:proposalId/execute`

执行一个已经满足条件的授权提案。

执行成功后会写入 `executionReceipt`，失败时也会留下失败记录和错误信息，便于回放审计。这些记录会尽量保留 actor 的身份、标签、钱包和窗口信息。

### `POST /api/authorizations/:proposalId/revoke`

撤销一个未执行的授权提案。

撤销操作也会记录发起窗口和发起者，保留完整轨迹，时间线里能直接看到撤销节点。

### `GET /api/authorizations/:proposalId/timeline`

读取某个授权提案的完整时间线。

### `GET /api/authorizations/:proposalId/credential`

导出某个授权提案的本地证据包。

这个对象会把提案状态、签名、执行记录和时间线一起封装进去，方便做审计、导出或后续升级为 VC。

可选参数：

- `didMethod=openneed`
- `didMethod=agentpassport`
- `issueBothMethods=true`

这样可以把同一条授权记录按不同 DID method 视角签发出来，便于做迁移期双 method 校验。
传 `issueBothMethods=true` 时，响应也会附带 `alternates`，便于一次拿到双 method 记录。

### `GET /api/agents/resolve`

通过 `agentId`、`did`、`walletAddress` 或 `windowId` 反查当前本地命名空间里的对应身份。

### `POST /api/windows/link`

把当前窗口绑定到某个 Agent。

### `GET /api/windows/:windowId`

读取某个窗口的绑定状态。

### `GET /api/windows`

查看所有窗口绑定。

## 下一步

如果这条原型思路成立，后续可以继续往下接：

1. 真正的链上 DID / 钱包地址
2. Verifiable Credentials
3. 多签授权撤销与时间锁
4. Agent 信誉分与可校验履历
5. openneed 主项目里的 Agent 身份接入

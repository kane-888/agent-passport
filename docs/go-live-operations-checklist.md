# agent-passport 上线前收口与值班放行清单

这份清单只回答 4 个问题：

1. 现在能不能部署或继续放量
2. 部署后靠什么看运行态是否还是真的
3. 什么时候必须暂停、回滚或切到更保守姿态
4. 谁拍板、谁执行、谁修

不要从惯例判断。只看当前运行态真值。

对外命名也只认这一条：

- `agent-passport` 是对外产品名
- `agent-passport 记忆稳态引擎` 是公开底层记忆、恢复与审计引擎名

如果页面、手册或话术把两者说反，先按命名真值修正，再继续放行判断。

## 只看这 6 个真值入口

上线前和上线后，只看这 6 个位置：

1. `GET /api/health`
2. `GET /api/security`
3. `GET /api/device/setup`
4. `/`
5. `/operator`
6. smoke / deploy 验证结果

如果这 6 个位置给出的结论不一致，先按更保守的结论执行。

真正做放行判断时，优先看这些结构化字段，不要只看摘要文案：

- `/api/security.releaseReadiness.failureSemantics`
- `/api/security.automaticRecovery.failureSemantics`
- `incident packet.snapshots.security.releaseReadiness.failureSemantics`
- `incident packet.boundaries.releaseReadiness.failureSemantics`
- `incident packet.boundaries.automaticRecovery.failureSemantics`

## 最短放行顺序

不要跳步。放行顺序固定如下：

### 1. 先确认服务真的活着

必须同时满足：

- `/api/health.ok=true`
- `/api/health.service=agent-passport`
- 当前绑定地址符合预期

当前本地默认预期是：

- `hostBinding=127.0.0.1` 或 `localhost`

如果这一步没过，后面都不用看。

### 2. 再确认安全姿态没有越界

必须确认：

- `securityPosture.mode=normal`
- 没有需要先锁边界的硬告警

如果当前不是 `normal`：

- 先去 `/operator`
- 先按当前姿态锁边界
- 不讨论继续放量

### 3. 再确认正式恢复不是假完成

必须明确区分两件事：

- “系统还能续跑”
- “正式恢复已经达标”

只有下面条件同时成立，才允许把正式恢复当成上线基线：

- `formalRecoveryFlow.durableRestoreReady=true`
- `formalRecoveryFlow.runbook.status=ready`
- 最近一次恢复演练还在窗口内
- `automaticRecovery.operatorBoundary.formalFlowReady=true`

如果自动恢复还能继续，但上面没全部满足：

- 可以继续内部排查或临时接力
- 不能把它写成“恢复已达标”
- 不能把它当成正式上线放行依据

### 4. 再确认受限执行层没有退化

必须确认：

- `constrainedExecution.status` 不在 `degraded` / `locked`
- `/operator` 没有把执行面列为当前阻塞项

如果受限执行层退化：

- 停真实执行
- 保留读、证据保全和恢复动作
- 不继续放量

### 5. 再确认值班与交接链是完整的

必须确认：

- `/operator` 的 `next action` 和 `/api/security` / `/api/device/setup` 一致
- 当前唯一阻塞原因清楚
- 事故交接包可以导出
- 最近恢复包、恢复演练、初始化包都能定位到

如果值班面说不清“现在谁拍板、先做什么、为什么还不能放行”，就不算准备好上线。

### 6. 最后再看 smoke 和部署验证

先把测试守门和运行时门禁分清楚：

门禁不是一条死线，先分成两条路径：

- 通用放行路径：`test:smoke:guards -> smoke:all:ci -> smoke:all -> verify:go-live:self-hosted / verify:go-live`
- 公网前准备路径：`prepare:self-hosted:pre-public` 可以在还没有 deploy URL 时先跑，用来刷新 recovery bundle、恢复演练和 setup package 的同轮新鲜度；它不是正式上线放行

`smoke:browser` 是 `smoke:all` 里的浏览器 leaf，也可以单独补跑定位页面真值问题。最终正式放行仍以真实公网地址下的 go-live verifier 为准。

- `npm run test:smoke:guards`：提交前轻量守门，只确认 smoke / operational / browser / runner / pre-public / smoke-ui-http / passive-store-read / offline-chat-runtime / remote reasoner context 相关脚本、语义测试、防超时回归和 clean-clone 跟踪清单没有漏入口或漏文件
- `npm run smoke:all:ci`：CI / 远端环境替身，仍会先跑 remote reasoner preflight，只跳过 `smoke:browser`，再以 parallel combined 和 parallel operational leaves 证明语义没有失败，但不能替代正式本地放行
- `npm run smoke:browser`：Safari DOM 自动化浏览器门禁，专门证明真实页面投影和 `/api/health` / `/api/security` / `/operator` 真值一致；放行时跑 wrapper 入口，跑前确认 Safari 已允许 `Allow JavaScript from Apple Events`
- `npm run smoke:all`：最终本地完整门禁，不跳过 browser 时才算覆盖完整页面真值
- `npm run prepare:self-hosted:pre-public`：不放公网时的公网前准备门禁，会刷新 recovery bundle、持久化恢复演练、必要时 prewarm 本地 reasoner 清掉 `local_reasoner_reachable` gap，并导出 setup package；`artifactProof` 证明三者同轮新鲜；缺 deploy URL 时只跑本机 loopback verifier，不触发完整 `smoke:all` / Safari DOM 门禁，本机前提通过才返回 `pre_public_ready_deploy_pending`；提供真实 `AGENT_PASSPORT_DEPLOY_BASE_URL` 后才继续跑完整 self-hosted verifier；只对 `http://127.0.0.1` / `http://localhost` 自动自起服务，`http://[::1]` 只复用已运行服务，`AGENT_PASSPORT_PRE_PUBLIC_AUTO_START=0` 可关闭自起；内部 HTTP 请求默认 `45000ms` 超时，可用 `AGENT_PASSPORT_PRE_PUBLIC_FETCH_TIMEOUT_MS` 调整；setup package 默认 profile 上限为 1，可用 `AGENT_PASSPORT_PRE_PUBLIC_LOCAL_REASONER_PROFILE_LIMIT` 调整；`artifactProof` 还会检查 `setup_package_local_reasoner_profiles_bounded`

失败先按这张表分流，不要先重跑：

| 失败面 | 先看什么 | 第一动作 |
| --- | --- | --- |
| `smoke:browser` | 输出里的 `blocker` / `failedSurface` / `nextAction` | `browser_automation_unavailable` 先修 Safari DOM automation；`runtime_home_truth_missing` / `lab_security_truth_missing` / `operator_truth_missing` 先修对应 API 真值源；`protected_surface_failed` 先直接请求 `failedSurface` |
| `soak:runtime` | `summary`、`failedRounds`、`failedSharedStateRounds`、`coverage.browserUi` | cold-start 失败先看单轮 smoke；shared-state 失败先查窗口绑定和累计计数是否倒退；crash-restart 失败先查异常退出后 `/api/health`、`/api/security` 和新写入记忆是否仍可读 |
| deploy HTTP | `checks[]`、`firstBlocker`、`agents_without_auth_error_class` | 未带 token 的 `/api/agents` 必须返回 `401` 且 `errorClass=protected_read_token_missing`；如果只有 401 没有结构化 JSON，先查反向代理或错误服务是否吞掉 agent-passport 错误体 |
| admin token | `effectiveConfig`、token 来源、401/403 的目标 surface | 先确认 env / file / keychain 哪个来源被实际读取；坏 token 先轮换，不要把 admin-only 失败当运行态坏掉 |
| read-session | HTTP 状态、scope、parent/admin session 来源 | `read_session` 读 admin-only 面被拒绝是边界，不是降级；先确认是否应换 admin token，还是修 read session 绑定范围 |
| public truth | `/api/health`、`/api/security`、`/api/device/setup` 缺字段 | 先修真值源，再修页面；禁止用页面 fallback 文案替代运行态真值 |

本地主产品链最小放行入口是：

- `npm run smoke:all`

如果只是要快速复核“运行态生命线”有没有断，先跑：

- `npm run smoke:operational`
  说明：只覆盖 operational UI / DOM 生命周期，重点验证本地 reasoner 恢复、setup package、housekeeping apply、受限执行审计、自动恢复 / 续跑闭环；它可以作为长 smoke 被外层执行器打断时的短门禁，但不能替代完整 `smoke:all`

如果要确认“这版不只是当前能起，而是连续运行也不会漂”，再补一条：

- `npm run soak:runtime`
  说明：默认会按 `cold start -> shared-state -> crash restart` 顺序跑；`shared-state` 会复用同一份隔离 data root，检查窗口绑定和累计运行痕迹不会倒退
  默认不要求 Safari DOM automation，输出里的 `coverage.browserUi=skipped_by_default` 表示它只证明运行生命线稳定，不证明浏览器页面投影真值连续稳定
  如果你只是想回到旧口径做定位，再显式加 `--skip-shared-state`
- `npm run soak:runtime:browser`
  说明：在具备 Safari DOM automation 的验收机上执行，把 browser UI 语义也纳入 cold start / shared-state 长稳；输出里的 `coverage.browserUi=required` 才能说明页面投影真值进入长稳
- `npm run soak:runtime:operational`
  说明：当完整长链容易被外层执行器打断时，用这条连续压 agent 主运行生命线；它把 cold start / shared-state 阶段切到 `smoke:operational`，但仍然强制检查 runtime evidence、令牌轮换、窗口改绑、自动恢复 / 续跑、共享态累计和异常退出恢复

要拆层排查时，再单独看：

- `npm run smoke:dom`（combined DOM 真值口径；轻量定位才用 `npm run smoke:dom:core`）
- `npm run smoke:ui`
- `npm run smoke:browser`

如果是公网部署，还要再过：

- `npm run verify:deploy:http`
- 如果你就在具备 Safari DOM automation 的自托管目标/验收机上做最终验收，优先跑 `npm run verify:go-live:self-hosted`
- 如果目标机配置文件不在默认位置，先补 `AGENT_PASSPORT_DEPLOY_ENV_FILE=/绝对路径/agent-passport.env`
- 如果目标机是 Linux 或不能跑 Safari DOM automation，不能把目标机本机验收当最终正式放行；拿到真实公网地址后，在能跑 Safari DOM automation 的验收机上跑 `npm run verify:go-live`
- 如果你不是在目标主机，而是在外部控制台做统一公网验收，也跑 `npm run verify:go-live`

公网部署默认先按通用单机长驻基线执行：

- 优先用 `Dockerfile + deploy/docker-compose.example.yml + deploy/.env`
- 必须保证数据目录落在持久盘，例如 `/var/data` 或宿主机挂载目录
- 不要把系统 keychain 当成正式部署前提
- 如果你已经准备实机部署，直接按 `docs/self-hosted-go-live-runbook.md` 执行，不要临场拼命令

如果你当前仍在用 `render.yaml`：

- 先去部署平台核对 service / disk / default domain 的真实绑定
- 没核对前，不要直接把历史 Render 资源名批量改成 `agent-passport`

结论很简单：

- 运行态真值没过，不放行
- smoke 没过，不放行
- 部署验证没过，不放行

## 监控基线

上线后最少要持续盯这 5 类信号：

1. 服务活性
2. 安全姿态
3. 正式恢复窗口
4. 自动恢复闭环
5. 受限执行边界

对应位置：

- `/api/health`：服务是否可达
- `/api/security`：当前姿态、正式恢复、自动恢复边界、受限执行摘要，以及结构化 `failureSemantics`
- `/api/device/setup`：正式恢复 runbook、最近证据、跨机器恢复关口
- `/operator`：当前下一步、硬告警、交接字段是否齐
- runner history / anomaly / incident packet：异常、续跑、证据保全和结构化 failure semantics 是否可回放

## 三档放行标准

### 1. 继续内部 Alpha

必须满足：

- 服务可达
- 安全姿态可读
- `/`、`/operator`、`/lab.html`、`/repair-hub` 职责没有串位
- `smoke:dom`（combined DOM 真值口径）、`smoke:ui`、`smoke:browser` 通过
- 如果引用 `soak:runtime` 作为稳定性证据，必须同时记录 `coverage.browserUi`；`skipped_by_default` 只能证明运行生命线，不证明浏览器页面投影真值连续稳定
- 如果要证明浏览器页面投影真值在连续运行中不漂，必须补 `npm run soak:runtime:browser`，或至少补不跳过浏览器的 `npm run smoke:all`

这档允许：

- 正式恢复还在补主线
- 自动恢复只是有限接力

这档不允许：

- 对外把系统表述成“正式恢复已达标”

### 2. 私有部署试点

在内部 Alpha 基础上，再加：

- `securityPosture.mode=normal`
- 受限执行层不退化
- operator 能稳定给出当前 next action
- 最近恢复包、恢复演练、初始化包都可定位

这档允许：

- 受控客户试点
- 小范围放量

这档不允许：

- 把跨机器恢复和正式恢复对外讲成完全封顶

### 3. 正式上线 / 对外稳定放行

在私有部署试点基础上，再加：

- `formalRecoveryFlow.durableRestoreReady=true`
- 恢复演练仍在窗口内
- `automaticRecovery.operatorBoundary.formalFlowReady=true`
- `npm run smoke:all` 通过
- 公网部署验证通过
- 如果在具备 Safari DOM automation 的目标/验收机上做最终放行，则 `npm run verify:go-live:self-hosted` 返回 `ok=true` 且 `readinessClass=self_hosted_go_live_ready`；Linux 目标机本机验收不能单独当正式放行
- 如果目标机配置文件不在默认位置，`verify:go-live:self-hosted` / `verify:go-live` / `verify:deploy:http` 都应支持 `AGENT_PASSPORT_DEPLOY_ENV_FILE`
- 如果只做统一公网 verdict，则 `npm run verify:go-live` 返回 `ok=true` 且 `readinessClass=go_live_ready`
- 无论跑哪条 verdict，现场排障都应优先看顶层 `operatorSummary`；需要机读分流时再看 `firstBlocker` 和 `blockedBy[]`
- 如果使用统一 verdict，则优先给 `AGENT_PASSPORT_DEPLOY_BASE_URL` 和 `AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN`
- 如果本机 keychain 或 `data/.admin-token` 已有管理令牌，本地运维排障时可以只补 `AGENT_PASSPORT_DEPLOY_BASE_URL`，不应再误报缺 token
- deploy HTTP 验证必须确认敏感读面返回 agent-passport 自己的结构化拒绝码；只返回裸 401 不等于受保护读取链路正确
- 如果启用了 `AGENT_PASSPORT_DEPLOY_RENDER_AUTO_DISCOVERY=1` 且 `render.yaml` 还保留历史 Render 资源名，deploy 校验应直接提醒先核对线上绑定，而不是鼓励盲改文件
- 如果 deploy 环境变量缺失，`verify:go-live` 应直接返回结构化 `blockedBy` 和 `nextAction`，而不是原始网络异常
- 如果缺少正式 deploy URL，`verify:go-live` 应继续给出本地门禁结果，并把最终状态区分成 `local_ready_deploy_pending` 或 `local_gate_blocked`
- 当前没有未解释的硬告警

readiness class 先按这张小表读，不要把阶段性状态误当成正式上线：

| readinessClass | 意义 | 能不能对外正式放行 |
| --- | --- | --- |
| `go_live_ready` | 统一公网 verdict 已通过 | 可以 |
| `self_hosted_go_live_ready` | 自托管本机 loopback、smoke 和统一公网 verdict 都通过 | 可以 |
| `private_pilot_only` | smoke 和 deploy 通过，安全姿态/受限执行主边界可做小范围试点，但完整 runtime release 仍未全绿 | 不可以正式放量 |
| `internal_alpha_only` | smoke 和 deploy 基本通过，但运行态放行前提还不完整 | 不可以正式放量 |
| `pre_public_ready_deploy_pending` / `local_ready_deploy_pending` | 本机或公网前准备已过，只差正式 deploy URL / 公网验证 | 不可以正式放量 |
| `local_gate_blocked` / `host_local_runtime_blocked` / `blocked` | 本机、smoke、deploy 或 runtime 有硬阻塞 | 不可以 |

少一条都不要写成“正式上线稳态”。

当前对 `npm run smoke:all` 的最低解释口径是：

- `offlineFanoutGate.summary` 必须是 `passed`
- 不能出现“DOM 没进 automatic_fanout”这类退化
- 不能出现“群聊调度历史不见了 / 单聊没隐藏 / 并行批次 chip 不见了 / 发送后侧栏不刷新”这类页面退化
- 不能出现“浏览器页面上下文读不到 public /api/security.failureSemantics”这类真值断链
- 不能出现“operator 导出的 incident packet 里 releaseReadiness / automaticRecovery.failureSemantics 缺失”这类交接真值断链
- `operationalFlowSemantics.status` 必须是 `passed`
- `runtimeEvidenceSemantics.status` 必须是 `passed`
- operational UI / DOM 生命周期必须覆盖本地 reasoner 恢复、setup package、housekeeping apply、受限执行审计、自动恢复 / 续跑闭环
- 如果使用 `smoke:all:ci`，必须明确记录 `browserSkipped=true`，并补跑 `smoke:browser` 或不跳过浏览器的 `smoke:all`；否则只能算 CI 替身通过，不能算正式本地放行通过

当前对 `npm run smoke:operational` 的最低解释口径是：

- `operationalFlowSemantics.status` 必须是 `passed`
- `runtimeEvidenceSemantics.status` 必须是 `passed`
- UI/DOM local reasoner lifecycle、conversation memory/runtime search、sandbox audit、execution history 都必须保留证据
- `ui_auto_recovery_resume_semantics` 和 `ui_retry_without_execution_resume_semantics` 必须同时通过
- `dom_housekeeping_apply_semantics` 必须通过，且不能触碰 live ledger

## 必须暂停或回滚的触发条件

出现下面任一条，先停，再查：

- `/api/health.ok` 不是 `true`
- `securityPosture.mode != normal`
- `formalRecoveryFlow.durableRestoreReady != true`，但业务还想按正式恢复已达标继续放量
- `constrainedExecution.status` 进入 `degraded` / `locked`
- 自动恢复出现 `loop_detected` / `failed` / `human_review_required`
- browser smoke 或 deploy HTTP 验证失败
- `smoke:all:ci` 通过但浏览器门禁未补跑，却被当成正式放行依据

## 角色分工

### 持有者 / 委托主体

- 决定是否继续业务放量
- 决定是否接受恢复结果
- 决定是否允许恢复后重新放开执行

### 运营者 / 值班操作员

- 看 `/operator` 和运行态真值
- 切安全姿态
- 导出证据
- 执行恢复包 / 演练 / 初始化包流程

### 平台 / 开发维护

- 解释为什么没过
- 修复根因
- 提供回放、迁移、回滚和验证手段

## 一句话收口

上线不是“服务能打开”就算过，而是运行态、恢复基线、执行边界、值班动作和部署验证都指向同一个结论。

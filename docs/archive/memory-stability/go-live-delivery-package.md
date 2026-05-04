# 记忆稳态引擎上线前本地交付包

这份交付包用于把当前线程里的 runtime、benchmark 证据、schema、loader、脱敏规则和纠偏审计规则打成一个供产品显式接入的最小契约闭环；当前不修改真实产品源码。

接地气说：它不是又写一份设计说明，而是上线前的“装箱单 + 使用说明 + 安全边界”。产品侧照着它接，能知道哪些文件必须带走、先验哪些契约、哪些结论不能夸大。

归档说明：本文保留的是 `ai思维模型` 线程当时的交付包口径，用来解释那一轮 runtime / benchmark / verifier 是怎么装箱的；它不是当前 `agent-passport` 仓库的可执行真值入口。本文里出现的 `runtime/*`、`benchmarks/*` 路径和命令，只能当作历史交付记录看；当前仓库是否存在对应实现、现在应该跑什么，以 `/Users/kane/Documents/agent-passport/package.json`、`/Users/kane/Documents/agent-passport/scripts/`、`/Users/kane/Documents/agent-passport/tests/` 为准。

## 当前边界

- 当前工作区：`/Users/kane/Documents/ai思维模型`
- 当前默认任务：只围绕记忆稳态引擎 runtime、benchmark、schema、样例、交付和自检继续推进。
- 不切源码仓库：除非用户明确要求，否则不进入 `/Users/kane/Documents/openneed` 或 `/Users/kane/Documents/agent-passport` 做源码修改。
- 不是新大模型：记忆稳态引擎不是 DeepSeek、Kimi、豆包、千问或 Ollama 的替代品，也不是一个会生成回答的新 LLM。
- 不调用模型：本交付包里的 loader、validator、delivery / consistency / cold-start / readiness verifier 都不请求模型、不触网、不跑 provider benchmark。
- 不自动执行纠偏：CorrectionPlan.actions 是建议动作，真正重锚、压缩、权威刷新必须由产品 adapter 显式执行并写审计事件。

## 交付文件/类别清单

说明：下面这张表包含文件、通配符样例目录和说明类类别；机器可读 `runtime/go-live-delivery-manifest.json` 固定追踪 29 个 manifest artifacts，用来做自动验收。两者不是矛盾：表格给人看全貌，manifest 给脚本做最小闭环检查。`required_commands` 也不是 artifact 清单；有些 verifier 只作为必跑命令出现，不一定计入 29 个 manifest-tracked artifacts。

| 类别 | 文件 | 作用 |
|---|---|---|
| 运行时画像 | `runtime/memory-stability-runtime-profile.json` | 机器可读策略画像，包含模型画像、阈值、managed-memory 预算、证据下限和 7 项机制覆盖。 |
| 画像说明 | `runtime/memory-stability-runtime-profile.md` | 给人看的画像解释，用来审查指标口径和证据来源。 |
| 运行时内核 | `runtime/memory-stability-engine.mjs` | 本地计算 `S_t / C_t`、纠偏等级和动态放置策略，不调用模型。 |
| 共享契约 | `runtime/validators/memory-stability-runtime-validators.mjs` | profile、snapshot、redaction、correction event 的单一判定源。 |
| fail-closed loader | `runtime/load-memory-stability-runtime.mjs` | 产品启动前加载 runtime profile；契约失败则拒绝加载，避免坏策略进入运行链。 |
| 画像 schema | `runtime/schemas/memory-stability-runtime-profile.schema.json` | 固定 `ModelProfile`、阈值、预算、证据字段。 |
| 快照 schema | `runtime/schemas/memory-stability-snapshot.schema.json` | 固定 `RuntimeMemoryState`、`MemoryAnchor`、`CorrectionPlan` 的持久化结构。 |
| 纠偏审计 schema | `runtime/schemas/memory-stability-correction-event.schema.json` | 固定产品 adapter 真正执行纠偏后的审计事件结构。 |
| adapter 契约 | `runtime/memory-stability-adapter-contract.mjs` | 把 runtime snapshot 里的纠偏建议转换成合规 execution event，不调用模型、不保存原文。 |
| adapter rehearsal | `runtime/product-adapter-rehearsal.md` | 固定产品适配器干跑验收口径，证明执行证据不是只停留在文档说明。 |
| adapter rehearsal verifier | `runtime/verify-product-adapter-rehearsal.mjs` | 干跑 product_adapter 的 none/medium/strong 执行事件，校验 provenance、preflight、placement、post runtime、idempotency、privacy 和 rollback 证据。 |
| adapter 交接清单 | `runtime/product-adapter-handoff.md` | 产品接入前的最终 handoff，固定接入顺序、审计字段、证据引用和失败处理。 |
| adapter 交接 verifier | `runtime/verify-product-adapter-handoff.mjs` | 校验 handoff 没有漂移成新模型、自动纠偏或裸模型 20000K 等错误口径。 |
| 最终验收摘要 | `runtime/final-release-notes.md` | 一页说明本线程已完成什么、不能声称什么，以及后续切仓库前提。 |
| 最终摘要 verifier | `runtime/verify-final-release-notes.mjs` | 校验 release notes 没有漂移成新模型、源码已接入或裸模型 20000K 等错误口径。 |
| 自我学习治理层 | `runtime/self-learning-governance.md` | 把 Hermes 式持久学习约束成 learning proposal、proposal admission、protected memory、skill/profile version、冲突检测、回滚和恢复机制。 |
| 自我学习 proposal schema | `runtime/schemas/self-learning-governance-learning-proposal.schema.json` | 固定 learning proposal envelope 字段，防止候选学习直接写长期真值。 |
| 自我学习 validator | `runtime/validators/self-learning-governance-validators.mjs` | 校验 proposal admission、外部 recall、protected memory、上下文注入 denylist 和 memory/profile/skill/policy 通道边界。 |
| 自我学习 verifier | `runtime/verify-self-learning-governance-learning-proposal.mjs` | 验证直接 canonical write、缺 evidence、跨 namespace、secret-like summary、未知字段、错通道、protected memory 和 reverted/quarantined 不注入等负向用例。 |
| 自我学习 dry-run schema | `runtime/schemas/self-learning-governance-dry-run.schema.json` | 固定 apply/revert dry-run 只能是预演 adapter 请求，不能伪装成真实主账本写入。 |
| 自我学习 redacted 样例 | `runtime/examples/self-learning-governance/redacted/memory-learning-proposal.redacted.json` | 给未来产品 adapter 的低风险 memory proposal 样例，只含摘要和 hash，不含原文。 |
| 自我学习 dry-run 样例 | `runtime/examples/self-learning-governance/dry-runs/*` | 展示 apply/revert 会影响哪些候选 record、checkpoint 和 context denylist；不调用 Agent Passport API、不创建 ledger event。 |
| 自我学习样例 verifier | `runtime/verify-self-learning-governance-examples.mjs` | 校验 redacted proposal 与 apply/revert dry-run 样例没有产品 API 调用、模型调用、真实 ledger 或原文持久化。 |
| 快照样例 | `runtime/examples/*-runtime-snapshot.json` | 稳定态、中风险、强风险三类可回放样例。 |
| 脱敏样例 | `runtime/examples/redacted/*` | 证明长期日志可只存 hash，不存关键记忆原文。 |
| 纠偏执行样例 | `runtime/examples/correction-events/*` | 证明 adapter 显式执行、loader 未自动执行、事件不保存原文。 |
| 自检脚本 | `benchmarks/check-go-live-readiness.mjs` | 一键本地上线前自检，不触网、不跑大模型。 |
| 交付 manifest | `runtime/go-live-delivery-manifest.json` | 机器可读交付清单，方便产品接入前做自动检查。 |
| 交付 verifier | `runtime/verify-go-live-delivery-package.mjs` | 校验这份交付包是否包含必要边界、文件、命令和反夸大口径。 |
| 一致性冻结 | `runtime/go-live-consistency-freeze.md` | 固定交付包、manifest、README、readiness report 和命令清单的对齐口径。 |
| 一致性 verifier | `runtime/verify-go-live-consistency-freeze.mjs` | 本地校验交付包是否发生文档/命令/边界漂移。 |
| 冷启动 verifier | `runtime/verify-go-live-cold-start.mjs` | 用 scrubbed env 逐条执行 manifest 必跑命令，确认不依赖外部 provider key 或源码仓库 env 默认值。 |
| 证据包索引 | `benchmarks/results/INDEX.md` | 区分受控对照报告、本地 inspect/gate、执行失败/接口上限探测和历史原始报告，防止误引旧错误报告。 |
| 本地自检报告 | `runtime/go-live-readiness-report.md` | 记录最近一次本地上线前自检结果和可复现命令。 |

## 7 项机制覆盖

| 机制 | 当前落点 | 上线含义 |
|---|---|---|
| 1. 关键记忆探针 | runtime snapshots、`memory_anchors`、`last_verified_ok` | 每轮不盲信上下文，抽样检查关键记忆是否还稳。 |
| 2. 在线量化分数 | `memory-stability-engine.mjs` | 把记忆状态算成 `V_t / L_t / R_pos_t / X_t / S_t / C_t`，不是凭感觉判断。 |
| 3. 自动纠偏触发（风险分级与建议生成） | `correction_plan`、correction thresholds | 风险升高时给出轻度、中度、强度纠偏建议。 |
| 4. 离线画像 | `ModelProfile`、`CCRS / ECL_0.85 / PR / MidDrop` | 先知道模型弱点，再决定运行时怎么压缩和放置记忆。 |
| 5. 动态放置策略 | `placement_strategy` | 中段风险高时给出减少中段放置的策略建议；负载接近上限时给出提前摘要压缩建议，执行由产品 adapter 完成。 |
| 6. 权威记忆刷新 | strong correction actions、authoritative anchors | 高风险时从权威记忆库刷新关键状态，但必须由产品 adapter 显式执行。 |
| 7. 长上下文评测到运行时闭环 | benchmark results、runtime profile、readiness gate | 测试结果进入 profile，再约束真实运行策略。 |

## 最小接入顺序

1. 产品启动前调用 `loadVerifiedMemoryStabilityRuntime()`，不要直接 `readFile` profile。
2. 每次构造 prompt 或 memoryText 前，调用 `memory-stability-engine.mjs` 计算当前 `RuntimeMemoryState`。
3. 由产品 adapter 根据 `placement_strategy` 调整关键记忆的位置、密度和重排频率。
4. 当 `C_t` 超过阈值时，产品 adapter 显式执行相应纠偏动作。
5. 执行后写 `correction execution event`，必须包含 `adapter_invocation_id`、`source_snapshot.source_snapshot_sha256`、`explicit_execution=true`、`automatic_by_loader=false`、`loader_auto_executed=false`、`model_called=false`、`raw_content_persisted=false`，并且 `event_id` / `idempotency_key` 必须绑定源快照和 adapter 调用。
6. 生产或长期日志优先写 redacted snapshot，避免保存关键记忆原文。
7. 每次产品接入前后运行本地自检，确认交付包、runtime 契约和证据下限仍然通过。

## Manifest 必跑验证命令

归档纠偏：下面这组命令是历史交付包里的必跑清单，不应直接当作当前 `agent-passport` 仓库的运行入口或门禁真值。

```bash
node runtime/verify-memory-stability-profile.mjs
node runtime/verify-memory-stability-snapshots.mjs
node runtime/verify-memory-stability-loader.mjs
node runtime/verify-memory-stability-engine.mjs
node runtime/load-memory-stability-runtime.mjs
node runtime/verify-memory-stability-correction-events.mjs
node runtime/verify-memory-stability-correction-event-negative-cases.mjs
node runtime/verify-memory-stability-adapter-contract.mjs
node runtime/verify-product-adapter-rehearsal.mjs
node runtime/verify-product-adapter-handoff.mjs
node runtime/verify-final-release-notes.mjs
node runtime/verify-self-learning-governance-learning-proposal.mjs
node runtime/verify-self-learning-governance-examples.mjs
node runtime/verify-go-live-delivery-package.mjs
node runtime/verify-go-live-consistency-freeze.mjs
node benchmarks/check-go-live-readiness.mjs
```

归档口径里，这些命令都应该是轻量本地检查。它们不调用 DeepSeek、Kimi、豆包、千问、Ollama，也不访问网络。若与当前仓库实际脚本不一致，以当前仓库 `scripts/`、`tests/`、`package.json` 为准。

## 冷启动交付复验

最终交付前还应额外运行冷启动复验；这是归档线程里的历史 gate 设计，用来确认 scrubbed env 下不依赖 provider key 或源码仓库环境，不代表当前仓库还以这条命令作为正式入口。

```bash
node runtime/verify-go-live-cold-start.mjs
```

归档设计里，这条命令会读取 `runtime/go-live-delivery-manifest.json`，用 scrubbed env 逐条执行 manifest 里的本地验证命令，并跳过 `benchmarks/check-go-live-readiness.mjs` 这个父门禁以避免递归。当前 `agent-passport` 仓库的真实验证链路，仍应回到 `scripts/`、`tests/` 和 `package.json` 核对。

## 这些证据能证明什么

- 能证明 runtime profile 字段、权重、阈值、证据预算和 7 项机制覆盖没有漂移。
- 能证明 loader 是 fail-closed：坏 profile、坏 snapshot 或越界路径不会被悄悄加载。
- 能证明在线分数、纠偏等级、放置策略在稳定态、中风险、强风险样例里可回放。
- 能证明 correction event 把“建议动作”和“实际执行”分开，且实际执行不由 loader 自动触发。
- 能证明 product adapter rehearsal 已覆盖 provenance、preflight、placement receipt、post-execution runtime、idempotency replay、privacy scan 和 rollback drill。
- 能证明 128K、20000K managed-memory 和高冲突 inspect/provider-linked 证据满足当前 profile 里的 evidence floor。

## 这些证据不能证明什么

- 不能证明裸模型有 20000K 单 prompt 能力。20000K 证据是 managed-memory 分块、压缩、召回和 provider-linked 验证，不是把 20000K 原文一次塞进模型。
- 不能证明所有线上用户数据都不会出错。它只能证明当前契约和样例能拦住已知的字段漂移、脱敏缺口和执行归因混乱。
- 不能证明 DeepSeek、Kimi、豆包、千问、Ollama 自身能力被记忆稳态引擎“增强成新模型”。引擎是记忆监控、放置、纠偏建议和审计层，不是模型训练层。
- 不能证明产品 adapter 已经接入真实源码仓库。本线程只交付引擎侧 runtime 契约；真实源码接入需要用户明确切仓库后再做。

## 隐私和审计规则

- 长期保存默认用 redacted snapshot，不保存用户原文、完整 prompt、API key、token、手机号、邮箱、证件号或外部系统密钥。
- `raw_content_persisted=false` 是上线硬规则，不是建议项。
- `model_called=false` 是 correction execution event 的默认硬规则；纠偏执行审计只记录 adapter 动作，不允许在事件构造阶段再调用模型。
- `source_snapshot.source_snapshot_sha256` 必须能和实际源快照内容复算一致；`summary` / `notes` 只能使用允许的脱敏模板。
- 纠偏执行必须有 `adapter_invocation_id`，否则无法追踪是哪次产品调用真的执行了动作。
- `event_id` 和 `idempotency_key` 必须绑定 `source_snapshot.snapshot_id + adapter_invocation_id`，否则无法证明事件和产品调用是一一对应的。
- 强纠偏如果刷新权威记忆库，event 必须能证明 `authoritative_store_mutated=true`，同时记录目标 memory ID 或 hash。

## 产品接入提示

未来明确切真实源码仓库时，接入线索仍以 `runtime/product-integration-target.md` 为准：Agent Passport 适合先接底层 runtime adapter，OpenNeed 后续作为业务消费侧读取稳态摘要。

但这只是当时的接入顺序建议，不等于当前 `agent-passport` 仓库就该继续沿用本文命令或路径。除非用户明确说“切到 Agent Passport”或“切到 OpenNeed”，否则本文继续只作为记忆稳态引擎交付物归档；当前仓库的运行和验证真值，以 `scripts/`、`tests/`、`package.json` 为准。

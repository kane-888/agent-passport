# 记忆稳态引擎产品 adapter 交接清单

这份文件是给真实产品源码接入前看的最后一张清单。它不修改 `/Users/kane/Documents/openneed` 或 `/Users/kane/Documents/agent-passport`，只说明产品 adapter 真接入时应该怎样接、必须验什么、哪些话不能说过头。

接地气说：记忆稳态引擎像“记忆安全仪表盘 + 操作建议单”。它会判断记忆稳不稳、建议要不要重锚/压缩/刷新；真正开车、踩刹车、写日志的人必须是产品 adapter。

给产品方看的三句话：

- 这不是新模型。
- 当前目录没有改 OpenNeed 或 Agent Passport 真实源码。
- 20000K 是 managed-memory 分块压缩链路证据，不是裸模型一次吃 20000K prompt。

## 先确认边界

- 不是新大模型：它不是 DeepSeek、Kimi、豆包、千问或 Ollama 的替代推理内核。
- 不调用模型：runtime engine、loader、validator、delivery/readiness/cold-start verifier 都不请求 provider。
- 不自动执行纠偏：`CorrectionPlan.actions` 只是建议动作。
- 不保存原文：长期日志默认写 redacted snapshot 或 correction execution event，只保存 ID、hash、动作状态和短摘要。
- 不表示源码已接入：当前线程只交付契约、样例、门禁和证据；真实产品源码接入必须等用户明确切仓库。

## 最小接入顺序

1. 产品启动前先调用 fail-closed loader，不要直接 `readFile` 读取 profile。
2. loader 成功后才把 `ModelProfile`、阈值、managed-memory 预算和 evidence floor 放进产品运行时。
3. 每次构造 prompt 或 memoryText 前，调用 runtime engine 计算 `S_t / C_t`、`correction_level` 和 `placement_strategy`。
4. 产品 adapter 根据 `placement_strategy` 调整关键记忆位置、密度和重排频率。
5. 当 `C_t` 超过阈值时，adapter 可以显式执行 `CorrectionPlan.actions`，但 loader、validator、engine 不能替它执行。
6. adapter 真执行后必须写 `correction execution event`。
7. 生产或长期日志只保留 redacted snapshot 和 execution event；不要落完整 prompt、用户原文、API key、token 或外部系统密钥。
8. 接入前后都跑本线程本地验证命令，失败就停止注入或回滚 adapter 接入。

## 第一小时作战清单

这份清单只在用户明确要求切到真实产品源码仓库时使用。默认候选顺序是先复核 `/Users/kane/Documents/agent-passport` 是否仍适合后台 runtime adapter；OpenNeed 只放到第二阶段做后台消费，不先碰前台展示。候选顺序不是实时源码事实，切仓库后必须复核。

### 0-15 分钟：重新确认真实仓库

- 进入 `/Users/kane/Documents/agent-passport` 后，先重新读取真实仓库的 README、脚本名、接口名和接入点，确认候选的 `memoryHomeostasis`、runtime search / context builder / memory compactor / checkpoint / recovery、read-session 审计视图是否仍然存在；不存在就更新接入点清单，不把历史线索当现状。
- 对照本线程的 `runtime/product-integration-target.md`，确认它只是接入线索，不是实时源码事实。
- 不要先切 OpenNeed；不要在 OpenNeed 前端展示 Agent Passport 或底层引擎名。
- 如果真实仓库结构已经漂移，暂停接入，先更新接入点清单，不要硬套本线程旧线索。

### 15-30 分钟：接 fail-closed 读取链

- 先接 `loadVerifiedMemoryStabilityRuntime()` 或等价 fail-closed loader；不要直接 `readFile` 读取 `memory-stability-runtime-profile.json`。
- loader 通过后，才把 `ModelProfile`、纠偏阈值、managed-memory 注入预算和 evidence floor 放进产品运行时。
- profile、schema、snapshot 任一校验失败时，拒绝加载稳态策略，不进入产品运行链。
- 这一步不调用 provider、不触网、不请求模型、不执行纠偏动作。

### 30-45 分钟：接 prompt / memoryText 前置判断

- 每次构造 prompt 或 `memoryText` 前，先调用 runtime engine 计算 `S_t / C_t`、`correction_level` 和 `placement_strategy`。
- adapter 只按 `placement_strategy` 调整关键记忆位置、密度和重排频率。
- `CorrectionPlan.actions` 仍然只是建议；只有当产品 adapter 显式执行后，才算真实纠偏。
- 如果 action 和 `correction_level` 不匹配，拒绝生成或拒绝验收执行事件。

### 45-60 分钟：接执行审计和回滚门禁

- adapter 执行任何重锚、摘要重写、压缩、权威刷新或冲突消解后，必须立即写 `correction execution event`。
- 事件必须带齐 `adapter_invocation_id`、`source_snapshot.source_snapshot_sha256`、`explicit_execution=true`、`automatic_by_loader=false`、`loader_auto_executed=false`、`model_called=false`、`raw_content_persisted=false`。
- product adapter 正式执行前后还要带齐 `product_provenance`、`preflight`、`placement_receipt`、`post_execution_runtime`、`idempotency_replay`、`privacy_rollback`，先用 `node runtime/verify-product-adapter-rehearsal.mjs` 做本地干跑。
- 长期日志优先写 redacted snapshot，并固定 `privacy.mode=redacted`、`privacy.raw_content_persisted=false`、`memory_anchors[].content_redacted=true`、`content_redaction=hash_only`。
- 如果 correction event 校验失败，不得把这次动作记为成功执行；如果发现完整 prompt、用户原文、API key、token、手机号、邮箱、证件号或外部系统密钥落盘，立即按隐私门禁失败回滚。

## 必须写入产品 adapter 的审计字段

| 字段 | 必须值 | 普通解释 |
|---|---|---|
| `adapter_invocation_id` | 非空唯一值 | 证明是哪次产品调用真的执行了动作。 |
| `source_snapshot.source_snapshot_sha256` | 源快照内容 SHA-256 | 证明事件绑定的是那份精确快照内容，不只是一个路径字符串。 |
| `explicit_execution` | `true` | 证明这是产品 adapter/operator/test fixture 明确执行。 |
| `automatic_by_loader` | `false` | 证明不是 loader 自动动手。 |
| `loader_auto_executed` | `false` | 再次锁死 loader 只校验、不执行。 |
| `model_called` | `false` | 构造纠偏执行事件时不额外调用模型。 |
| `raw_content_persisted` | `false` | 审计事件不保存关键记忆原文或完整 prompt。 |
| `product_provenance` | 非空结构 | 证明目标仓库、adapter 版本、入口、契约版本、功能开关和环境。 |
| `preflight` | 全部为 `true` | 证明执行前已通过 loader/schema/redaction 检查，并阻断模型调用、网络和原文日志。 |
| `placement_receipt` | hash + budget | 证明关键记忆执行前后怎么摆放，且没有超出注入预算。 |
| `post_execution_runtime` | hash + `final_c_t/final_s_t` | 证明执行后重新计算了运行时稳态。 |
| `idempotency_replay` | 去重命中且副作用为 0 | 证明同一次 adapter 调用重放不会重复执行。 |
| `privacy_rollback` | 扫描与回滚通过 | 证明没有原文落盘，并且失败时可以回滚。 |

## 纠偏动作执行规则

- `none`：只允许 `continue_monitoring`。
- `light`：允许重锚关键记忆、提高注入优先级。
- `medium`：允许 light 动作，并允许重写工作记忆摘要、压缩低价值历史。
- `strong`：允许 medium 动作，并允许从权威记忆库刷新、做冲突消解和状态刷新。

如果 action 和 `correction_level` 不匹配，adapter contract 必须拒绝生成合规执行事件。接地气说：轻微发烧不能直接上 ICU 方案，高风险也不能只贴创可贴。

## 必跑验证命令

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
node runtime/verify-go-live-delivery-package.mjs
node runtime/verify-go-live-consistency-freeze.mjs
node benchmarks/check-go-live-readiness.mjs
```

冷启动复验：

```bash
node runtime/verify-go-live-cold-start.mjs
```

这些验证默认不触网、不跑大模型、不切源码仓库。`check-go-live-readiness.mjs` 是父门禁；cold-start 会跳过它以避免递归。

## 证据引用口径

- 可以引用 `benchmarks/results/INDEX.md` 里的受控对照报告，但必须保留上下文规模、anchor、seed、provider 和 managed-memory 边界。
- 可以引用 128K hard / 48 anchors / 5 seeds，说明“同一模型裸用 vs 记忆稳态干预”的前后差异。
- 可以引用 20000K managed-memory / 5 seeds，但必须说明这是本地分块、抽取、压缩、重锚后的 provider 验证，不代表裸模型单次上下文窗口。
- 可以引用 high-conflict inspect/provider-linked 证据，但要说明 inspect gate 先验证本地前处理，再交给同一绑定 provider 复验。
- 不要把执行失败、接口上限拒绝、缺 key、inspect-only 当成模型能力分。

## 失败处理

- profile/schema/snapshot 校验失败：拒绝加载稳态策略。
- readiness 或 cold-start 失败：停止交付，不进入真实产品源码接入。
- correction event 校验失败：不要把这次纠偏写成成功执行。
- action 不符合 correction level：拒绝生成或拒绝验收执行事件。
- 发现 raw content、full prompt、API key、token、手机号、邮箱、证件号或外部系统密钥：立即视为隐私门禁失败。
- `execution.status=completed` 但存在未完成 action：拒绝验收执行事件，按 partial / failed / skipped 处理。
- 缺少 `product_provenance`、`preflight`、`placement_receipt`、`post_execution_runtime`、`idempotency_replay` 或 `privacy_rollback`：拒绝验收 product adapter 执行事件。
- `target_memory_refs` 中的 `memory_id + content_sha256` 不存在于源快照 `memory_anchors`：拒绝验收，防止 scope 正确但 attribution 被伪造。
- strong 纠偏缺少 `reload_authoritative_memory_store` 或 `resolve_conflicts_and_refresh_runtime_state` 完成记录：按失败处理。
- `result.after_c_t` 高于 `result.before_c_t`：视为纠偏无效，不得记为成功降险。

## 负向用例必须拒绝

- `model_called=true`
- `explicit_execution=false`
- `automatic_by_loader=true`
- `loader_auto_executed=true`
- `target_memory_refs` 为空
- `target_memory_refs` 夹带原文或额外 raw 字段
- `audit.raw_content_persisted=true`
- `execution.actions[*].raw_content_persisted=true`
- `execution.status=completed` 但任何 action 未完成
- strong 场景里 `reload_authoritative_memory_store` 未完成
- `result.after_c_t > result.before_c_t`
- 事件里出现 `full_prompt`、`raw_prompt`、`response_body` 这类原始载荷字段
- `execution.actions[*].result.summary` 或 `audit.notes` 夹带聊天原文、邮箱、密钥或 URL
- `execution.actions[*].result.summary` 或 `audit.notes` 未使用允许的脱敏模板
- 缺少 source snapshot 入参，无法证明 `snapshot_id`、`provider`、`model_name`、`S_t/C_t` 与源快照一致
- `source_snapshot.source_snapshot_sha256` 和实际源快照内容不一致
- product adapter 缺少 provenance/preflight/placement/post-runtime/idempotency/privacy-rollback 证据
- `target_memory_refs` 引用不存在的源快照记忆或 hash 不匹配
- 重复 action receipt 或 action 数量不等于 `CorrectionPlan.actions`
- snapshot 里出现额外 raw 字段、`content_redaction=raw` 或 `privacy.raw_content_persisted=true`

## 上线前验收标准

- `runtime/go-live-readiness-report.md` 总体状态为 `PASS`。
- `runtime/verify-go-live-cold-start.mjs` 在 scrubbed env 下 `ok=true`。
- `runtime/verify-memory-stability-correction-event-negative-cases.mjs` 至少拒绝 36 个坏事件。
- `runtime/verify-memory-stability-adapter-contract.mjs` 能生成 none/medium/strong 三类合规执行事件。
- `runtime/verify-product-adapter-rehearsal.mjs` 能干跑 product_adapter 的 none/medium/strong 三类事件，并验证 provenance、preflight、placement、post-runtime、idempotency、privacy 和 rollback 证据。
- `runtime/verify-product-adapter-handoff.mjs` 通过，证明本 handoff 的边界、命令和禁止事项没有漂移。
- `runtime/verify-final-release-notes.mjs` 通过，证明最终验收摘要没有漂移成新模型、源码已接入或裸模型 20000K。

## 下一步切仓库时才做

真正实现 adapter 时，优先按 `runtime/product-integration-target.md` 的顺序进入 `/Users/kane/Documents/agent-passport`，把底层 runtime adapter 接起来；OpenNeed 只作为业务侧消费者读取稳态摘要。没有用户明确要求前，本线程继续只维护记忆稳态引擎交付物。

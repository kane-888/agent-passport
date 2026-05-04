# 记忆稳态引擎自我学习治理层

更新时间：2026-04-23

本文件只从记忆稳态引擎角度承接 Hermes 式自我学习能力：把“Agent 想学到的东西”变成可审计、可拒绝、可回滚、可恢复的 learning proposal。它不重新定义 agent-passport 的身份、DID、wallet、resident lock 或主账本架构。

普通说法：Agent 不能自己偷偷把一句话写进长期记忆。它只能先交一张“我建议学这个”的申请单，记忆稳态引擎负责 proposal admission，也就是筛查、排重、查冲突、给风险分级和回滚方案；真正写入和回滚由产品主账本执行并留痕。

## 1. 稳态引擎职责边界

记忆稳态引擎负责：

- 从 session、run、minutes、tool results、recall hits 中抽取 learning candidates。
- 为候选学习内容计算 `salience`、`confidence`、`sourceType`、`epistemicStatus`、`riskLevel` 和 `consolidationState`。
- 生成 `learningProposals` 的候选字段、admission preview、冲突列表、保护记忆命中结果、压缩建议和 rollback plan 草案。
- 判断候选应进入 working、episodic、semantic、profile、skill 或 policy 的哪一层候选区。
- 给 context builder 提供稳定性信号：哪些内容可注入、哪些必须忽略、哪些需要人工复核。
- 在 apply/revert 前后提供 dry-run 校验和恢复校验，但不绕过主账本直接写 canonical state。

记忆稳态引擎不负责：

- 不创建或修改 agent identity、passport namespace、DID、wallet、授权或 resident lock。
- 不直接写 `passportMemories`、`skillRecords`、`profileVersions` 或 `stateCheckpoints` 的 canonical 结果。
- 不把外部 memory provider、mempalace、session recall 结果自动提升为 verified memory。
- 不让 LLM 输出直接成为长期真值。
- 不自动激活 skill，不自动覆盖 profile，不自动修改 policy。

共同硬边界：

- 所有学习路径必须先形成 `learningProposal`。
- `agentId + passportNamespaceId` 是所有候选、提案、写入、回滚、恢复的强隔离键。
- profile、skill、policy 类型 proposal 不能纯 auto approval。
- rollback 后，runtime search 和 context builder 必须停止注入已撤销内容。

## 2. Learning Candidate 抽取规则

候选来源：

- `session_close`：会话结束时抽取稳定事实、偏好、任务结论、流程经验。
- `run_checkpoint`：长任务阶段性完成时抽取下一步、已确认约束、失败经验。
- `tool_result`：工具返回的结构化事实只能作为 evidence，不自动成为 verified。
- `explicit_user_statement`：用户明确说“记住/以后都/这是事实”时提高 salience，但仍要 admission。
- `session_recall_hit`：跨 session 命中只能作为 candidate evidence。
- `correction_event`：纠偏后的稳定状态可作为高质量 evidence。

抽取输出最小字段：

```json
{
  "type": "memory | profile | skill | policy",
  "candidate": {},
  "sourceSessionId": "...",
  "sourceRunId": "...",
  "sourceWindowId": "...",
  "evidenceIds": ["..."],
  "sourceType": "perceived | reported | derived | verified",
  "epistemicStatus": "candidate | inferred | verified",
  "confidence": 0.0,
  "salience": 0.0,
  "riskLevel": "low | medium | high | critical",
  "rationale": "short sanitized reason"
}
```

抽取规则：

- 候选必须能追到 `evidenceIds`；人工直接创建可以例外，但必须标记 reviewer。
- 不保存完整 prompt、完整聊天原文、密钥、token、邮箱、电话、证件号或外部系统敏感载荷。
- 单次出现的临时语气、情绪、草稿想法默认不进长期候选，除非用户明确要求记住。
- 外部检索命中默认 `epistemicStatus=candidate`，不能直接 `verified`。
- 工具结果可提高 confidence，但如果工具来源不可复算或不可审计，只能 `reported`。
- 候选必须先压缩成短语义单元，避免把长会话整块塞入长期记忆。
- 候选必须标注作用域：个人偏好、项目事实、流程经验、安全约束、技能步骤、profile patch 或 policy proposal。

风险分级：

- `low`：普通偏好、低敏项目事实、可轻松回滚的非安全记忆。
- `medium`：会影响未来推荐、上下文选择、任务流程的记忆。
- `high`：会影响 profile、skill、权限、安全行为或跨 session 决策。
- `critical`：身份核心、授权、安全策略、外部执行权限、资金或不可逆动作相关内容。

## 3. Admission Policy

Admission controller 按固定顺序执行：

1. Schema gate：字段完整、类型合法、`agentId + passportNamespaceId` 存在。
2. Evidence gate：`evidenceIds` 非空，或明确是人工直接创建。
3. Privacy gate：候选内容已脱敏，无 raw prompt、密钥、PII 或敏感载荷。
4. Namespace gate：候选 evidence、recall hit、目标记录都在同一 namespace。
5. Duplicate gate：检测 exact duplicate、near duplicate、同义重复和已回滚重复。
6. Conflict gate：检测和 active/protected/canonical memory 的冲突。
7. Protected memory gate：命中保护记忆时自动拒绝直接写入，转 profileVersion/policy review 或 quarantine。
8. Risk gate：按 `type + riskLevel + confidence + epistemicStatus` 决定 auto、review、quarantine、reject。
9. Rollback gate：apply 前必须生成 rollback plan 和 checkpoint 需求。
10. Context gate：预演 apply 后 context builder 会新增、替换或停止注入哪些 slots。

Admission decision：

- `approved_auto`：只允许低风险 memory，且 `confidence >= 0.8`、`salience >= 0.6`、无冲突、非 protected、evidence 可追溯。
- `pending_review`：medium memory、所有 profile/skill/policy、低置信但高价值候选。
- `quarantined`：有冲突、来源不可信、疑似污染、跨 namespace、涉及敏感字段但仍值得人工看。
- `rejected`：无 evidence、命中安全禁区、试图绕过 proposal、包含 raw sensitive payload、来源不可追踪。

P1 默认执行边界：

- memory 类型可以在通过 admission 后向产品主账本 adapter 提交 apply 请求；真实产品接入时由 adapter 创建 `passportMemories` canonical 记录并写审计事件。
- profile、skill、policy 类型只允许生成 pending/review/version 草案，不自动 active。
- high/critical proposal 必须 human 或 multisig，不允许 auto apply。

## 4. Protected Memory 规则

以下内容属于 protected memory，不能由单次 session 或外部 recall 直接覆盖：

- agent identity、passport namespace、DID、wallet、授权边界。
- resident lock、read session、管理令牌、本机写接口保护。
- profile 核心身份字段、长期 persona、关键安全偏好。
- active skill pointer、skill trust level、allowed toolsets。
- policy、安全规则、权限规则、审计规则。
- 已人工确认的高置信长期事实。
- 被回滚或 quarantined 的污染样本。

保护规则：

- 低置信候选不能覆盖高置信 protected memory。
- 外部 provider 命中不能覆盖本地主账本。
- `candidate` 或 `inferred` 不能覆盖 `verified`，只能提出 conflict proposal。
- profile/identity/policy 只能生成 versioned patch，不能原地覆盖。
- skill 内容只能生成 `skillVersion` 草案，不能自由编辑文件或直接 active。
- 已 reverted 的记录必须进入 context builder denylist，除非新的人工审核 proposal 显式解除。

## 5. Skill / Profile 写入审核规则

Skill 写入：

- 候选来源必须是重复出现的成功流程、明确工具步骤、或人工创建的流程型知识。
- 先创建 `skillRecord` 草案，再创建 `skillVersion` 草案。
- `skillVersion` 必须有 `contentHash`、`bodyRef`、`changelog`、`evidenceIds`、`rollbackPlan`。
- `allowedToolsets` 必须白名单化，不能由候选文本自由声明。
- activation 需要 `verification.status=verified` 和 `testIds`。
- high/critical tool skill 必须 human/multisig。
- 未验证 skill 不得进入 context builder 的 active skill 注入。

Profile 写入：

- profile 变化必须是 `profileVersion.patch`，不能原地改稳定身份字段。
- 每个 patch 必须有 `diffSummary`、`evidenceIds`、`approval`、`rollbackPlan`。
- 单次 session 只能建议 profile patch，不能自动改变核心身份、授权、安全偏好。
- preference 类 profile patch 低风险也至少 pending review；identity/policy 类必须 human/multisig。
- 激活新 profile version 时，旧 active pointer 必须可恢复。

Policy 写入：

- P1 只生成 pending proposal，不自动 apply。
- 任何 policy 变更都必须经过 human/multisig 和回归测试。

## 6. 冲突检测规则

冲突检测对象：

- active memory、protected memory、pending proposal、quarantined proposal、reverted tombstone、active profile version、active skill version。

冲突类型：

- duplicate：同一事实或同义表达重复。
- contradiction：同一 subject/predicate 下结论相反。
- temporal conflict：新旧事实都可能正确，但生效时间不同。
- source conflict：外部 recall 与本地主账本不一致。
- scope conflict：候选试图跨 namespace 或跨 agent 注入。
- protection conflict：候选触碰 protected memory。
- skill conflict：skillVersion 与 active skill 的工具权限、触发条件或步骤相冲突。
- profile conflict：profile patch 与当前 active profile 或安全规则冲突。

解决策略：

- exact duplicate：标记 `duplicateOf`，不新写。
- near duplicate：合并 evidence，提高 confidence，不重复注入。
- temporal conflict：保留多版本，要求 `validFrom/validUntil` 或人工确认。
- contradiction：低风险进 pending review，高风险 quarantine。
- source conflict：本地主账本优先，外部 recall 只当 evidence。
- protected conflict：拒绝直接写入，改生成 profile/policy review。
- reverted conflict：默认拒绝，除非人工说明为什么重新引入。

## 7. Apply / Revert 流程

Apply 流程：

1. `dry-run`：admission controller 输出将写入的 record、将 supersede 的 record、影响的 context slots。
2. `checkpoint`：创建或绑定 `stateCheckpoint`，保存 memory/profile/skill/session 的 before refs。
3. `idempotency`：生成 `proposalId + checkpointId + targetRecordIds` 绑定的 idempotency key。
4. `apply memory`：向产品主账本 adapter 提交 memory proposal apply 请求；真实产品接入时由 adapter 创建 `passportMemory` active 记录，写入 proposal/evidence/source/confidence/epistemicStatus/rollbackPlan 和审计事件。
5. `apply profile`：只创建或激活 profileVersion，不原地覆盖 profile。
6. `apply skill`：只创建 skillRecord/skillVersion 或激活已验证 version。
7. `ledger`：写审计事件，记录 actor、reviewer、sourceRunId、evidenceIds、checkpointId。
8. `context refresh`：重建 context builder 索引，确认只注入 active/applied 且未 reverted 的内容。
9. `post-check`：重新计算冲突率和稳态风险，失败则转 partial 或触发 revert。

Revert 流程：

1. `rollback dry-run`：输出将撤销哪些 records、active pointers、context slots、runtime search 索引。
2. `checkpoint verify`：校验 rollbackPlan 和 checkpoint beforeRefs 完整。
3. `memory revert`：memory 记录标记 inactive/reverted，不硬删除；必要时恢复 superseded 旧记录。
4. `profile revert`：active pointer 切回 parent/previous profileVersion。
5. `skill revert`：active pointer 切回 parent/previous skillVersion，当前 version 标记 reverted/superseded。
6. `context deny`：context builder 和 runtime search 立即停止注入 reverted/quarantined 内容。
7. `ledger`：写 rollback event，绑定原 proposalId、checkpointId、targetRecordIds。
8. `recovery check`：复算 contextBuilderHash 和稳态分，确认污染内容不再出现。

Dry-run 样例边界：

- `runtime/examples/self-learning-governance/redacted/memory-learning-proposal.redacted.json` 是 redacted proposal fixture，只证明候选学习能被 proposal schema 和 admission policy 验证。
- `runtime/examples/self-learning-governance/dry-runs/memory-learning-proposal-apply-dry-run.json` 只预演 apply 会交给产品 adapter 的请求、checkpoint、候选 record 和 context slot。
- `runtime/examples/self-learning-governance/dry-runs/memory-learning-proposal-revert-dry-run.json` 只预演 revert 会撤销哪些候选 record，并把哪些 record 加入 context denylist。
- dry-run 固定 `agentPassportApiCalled=false`、`ledgerEventCreated=false`、`engineCanonicalWritePerformed=false`、`modelCalled=false`、`networkCalled=false`、`rawContentPersisted=false`。
- dry-run 不是执行收据，不代表已经写入 `passportMemories`、已经创建 ledger event，或真实 Agent Passport 主账本已经接入。

验证命令：

```bash
node runtime/verify-self-learning-governance-examples.mjs
```

## 8. 崩溃恢复流程

状态机必须可恢复：

```text
draft -> quarantined
draft -> pending_review -> approved -> applying -> applied
draft -> rejected
applied -> reverting -> reverted
applying -> apply_failed -> pending_review | reverting
reverting -> revert_failed -> recovery_required
```

恢复规则：

- 每次 apply/revert 前先写 operation journal 和 checkpoint intent。
- 如果崩溃发生在 checkpoint 前，proposal 回到 `approved` 或 `pending_review`，不得假装已应用。
- 如果崩溃发生在部分 apply 后，根据 idempotency key 继续 apply 或按 checkpoint revert。
- 如果 ledger 写成功但 context index 未刷新，启动恢复时必须重建 context builder 索引。
- 如果 record 已写入但 ledger 缺失，进入 `recovery_required`，禁止 context 注入，等待审计修复。
- 如果 revert 失败，所有目标 records 进入 quarantine denylist，直到恢复演练通过。
- 启动恢复必须扫描 `applying`、`reverting`、`apply_failed`、`revert_failed`、`recovery_required`。
- 恢复完成后必须输出 recovery rehearsal report，覆盖 memory/profile/skill/session scope。

## 9. 与 Agent-Passport API 的调用契约

记忆稳态引擎只调用 agent-passport 暴露的学习治理 API，不直接访问主账本内部表。

公共约束：

- 所有请求必须带 `agentId` 路径参数和 `passportNamespaceId` body/header。
- 所有写请求必须带 idempotency key。
- 所有候选内容必须是 redacted/sanitized payload。
- 所有 response 必须返回 ledger/event/audit 引用。
- namespace mismatch 必须 fail closed。

建议契约：

```text
POST /api/agents/:agentId/learning/proposals
GET /api/agents/:agentId/learning/proposals
POST /api/agents/:agentId/learning/proposals/:proposalId/review
POST /api/agents/:agentId/learning/proposals/:proposalId/apply
POST /api/agents/:agentId/learning/proposals/:proposalId/revert
POST /api/agents/:agentId/checkpoints
POST /api/agents/:agentId/rollback/dry-run
POST /api/agents/:agentId/rollback/apply
POST /api/agents/:agentId/skills/:skillId/versions/:versionId/activate
POST /api/agents/:agentId/profile/versions/:profileVersionId/activate
```

Context builder 契约：

- 只读取 `status=applied|active` 且未 reverted、未 quarantined、同 namespace 的内容。
- 对 `sourceType=external_recall` 或 `epistemicStatus=candidate` 的内容，只能作为 evidence 注入，不得当 canonical truth。
- 必须支持 `denyRecordIds`、`supersededBy`、`validFrom/validUntil`、`rollbackEventId`。

## 10. 验收测试清单

学习路径与写入治理：

- 任意自我学习入口不能绕过 `learningProposals` 直接写长期记忆。
- 无 `evidenceIds` 的非人工 proposal 必须被拒绝。
- memory proposal apply 后，ledger 能追到 `sourceRunId`、`sourceSessionId`、`evidenceIds`、`proposalId`。
- profile/skill/policy proposal 不能纯 auto apply。
- high/critical proposal 在 auto review 下必须失败。

污染与冲突：

- 外部 recall hit 只能生成 candidate evidence，不得自动 verified。
- 低置信候选不能覆盖 verified/protected memory。
- duplicate proposal 不产生重复注入。
- contradiction proposal 进入 pending_review 或 quarantine。
- reverted 记录再次出现时默认拒绝或进入人工复核。

Namespace 隔离：

- 两个 agent 的 runtime search 不得互相返回 memory、skill、profile。
- `passportNamespaceId` mismatch 的 proposal、apply、revert、context query 必须 fail closed。

Profile / skill：

- profile 变更必须生成 profileVersion，不能原地覆盖稳定身份字段。
- profileVersion activate 后，旧 active pointer 可恢复。
- skill 激活必须引用 skillVersion、`verification.status` 和 `testIds`。
- 未验证 skillVersion 不得 active，也不得进入 context builder。

Rollback / recovery：

- proposal revert 后，context builder 不再注入对应 memory/profile/skill。
- rollback dry-run 能列出 target records、active pointer、context slots。
- rollback apply 必须写 ledger event，不只改 UI 状态。
- crash during apply 能通过 checkpoint 继续或撤销。
- crash during revert 能把目标 records 加入 quarantine denylist。
- recovery rehearsal 覆盖 memory/profile/skill/session checkpoint。

隐私和审计：

- proposal、checkpoint、ledger 不保存完整 prompt、用户原文、API key、token、邮箱、电话、证件号。
- 所有长期快照默认 redacted。
- context builder 只注入 active/applied、同 namespace、未 reverted、未 quarantined 内容。
- 审计事件能说明是谁审核、谁执行、依据哪些 evidence、如何回滚。

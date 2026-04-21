# agent-passport 记忆稳态引擎：神经科学启发与工程差距分析

## 先说结论

我们之前的“类脑”设计只做到了一半。

这套能力现在的正式命名是 `agent-passport 记忆稳态引擎`，但这里讨论的仍然是它的神经科学启发和工程边界；OpenNeed 只作为内部/兼容层命名保留。

这里的“类脑”主要是工程启发，不代表当前实现已经达到神经科学意义上的认知建模强度。

它借鉴了：

- 感知输入
- 工作记忆
- 情节记忆
- 身份连续性

但如果按生物学里关于人脑记忆系统的主流理解，这还不够。真正更接近人脑的地方，至少还要补上：

- `情节 -> 语义` 的转化
- `显著性优先` 的保留与检索
- `来源监测`，避免把想象、推断和真实发生混在一起
- `巩固状态`，区分刚发生、正在稳定、已经固化
- `事件边界`

## 1. 为什么不能只有 episodic

经典海马体-皮层框架认为，海马体更擅长快速记住具体事件，而长期稳定的知识和 schema 更依赖皮层系统逐步形成。

对这套引擎来说，这意味着：

- `episodic` 不能等于全部长期记忆
- 必须有 `semantic` 层来存“反复出现后被抽象出的规律”

如果没有这层，系统就会：

- 只会记“发生了什么”
- 却不太会沉淀“以后应该怎么理解类似的事”

## 2. 为什么要加 salience

人脑不会平均对待所有记忆。显著、带情绪、关乎结果的内容，更容易被优先编码和优先想起。

对这套引擎来说，如果没有 `salience`：

- 检索会过度依赖词面相似
- 高价值事实和低价值噪声容易被等量对待

所以每条 Passport memory 需要有“值得被想起的强度”。

## 3. 为什么要加 sourceType

认知心理学里的 source monitoring 反复强调，人脑不仅要记“内容”，还要记“这内容来自哪里”。

否则就会出现：

- 把别人说的当成自己确认过的
- 把自己推断的当成真实发生的
- 把压缩摘要当成原始证据

对 Agent 来说，这是缓解身份漂移和上下文坍缩里非常关键的一层。

所以这次新增的 `sourceType` 不是装饰，而是要把这些来源分开：

- `perceived`
- `reported`
- `derived`
- `verified`
- `system`

## 4. 为什么要加 consolidationState

生物记忆不是一写入就“永久稳定”。

它会经历：

- 刚发生，易受干扰
- 逐步稳定
- 长期固化

所以 Passport memory 不该只有 layer，还应有成熟度：

- `hot`
- `stabilizing`
- `consolidated`

这能帮助后续做：

- replay
- reconsolidation
- selective forgetting
- confidence-aware retrieval

## 5. 为什么要加事件边界

人脑更容易按“事件段落”组织经历，而不是一条无限长的流水账。

对这套引擎来说，事件边界至少有两个价值：

- 恢复上下文时更容易按段重建
- 复盘和 resume 时不容易把不同阶段混在一起

所以 episodic memory 里加 `boundaryLabel` 是合理的最小第一步。

## 这次已经落地到代码里的补强

### 已补上的结构

- 新增 `semantic` layer
- Passport memory 新增：
  - `salience`
  - `confidence`
  - `sourceType`
  - `consolidationState`
  - `boundaryLabel`
- prompt 真实顺序改为：
  - perception
  - working
  - episodic
  - semantic
  - identity

### legacy OpenNeed 兼容层已补上的映射

- 目标上下文约束会沉淀为 `match.observation_trace` / `agent.memory_focus_schema`
- 当前记忆焦点会沉淀为 `agent.focus_city` / `agent.memory_focus_schema`
- 匹配结论会沉淀为 `match.fit_schema`

也就是说，legacy OpenNeed 兼容层不再只是往 Passport 写“发生过的事”，而是开始写“这些事抽象出来意味着什么”；公开产品叙事仍统一归到 `agent-passport`。

## 这次已经补完的三块

相比上一轮，这次已经把下面三件事落进代码：

- `replay / consolidation`
  - 不再只做一次性 promotion
  - 会按 `patternKey / boundaryLabel` 聚类 working + episodic 记忆
  - 生成 `semantic` 层的 `replay_consolidated_pattern`

- `pattern separation / completion`
  - 检索时先按 `separationKey` 去重，避免相似事件串扰
  - 再按 `patternKey / boundaryLabel` 做有限补全，恢复同类经验

- `adaptive forgetting`
  - working / episodic / semantic 三层都开始按年龄、强度、细节保留度和召回历史主动降权

这意味着系统已经从“记忆分层”推进到了“记忆会被回放、会被淘汰、也会在检索时先分离再补全”的启发式层。

## 这轮新增的 4 个工程启发字段

这次又继续补了 4 个借用神经可塑性命名的工程映射：

- `eligibility trace`
  - 新记忆不会立刻被当成长时记忆
  - 先进入一个短时可塑窗口，等待后续 capture

- `neuromodulation`
  - 明确记录 novelty / reward / threat / social
  - replay 和 consolidation 会把这些第三因素算进去

- `homeostatic scaling`
  - 不同层维持目标平均激活水平
  - 防止所有记忆都一起变强，最后失去稀疏性和辨识度

- `allocation bias`
  - 让高显著、高新奇、高社会相关的内容更容易进入长期结构

这些机制的意义，在于把系统从“会记”进一步推进到“更有选择地记”。它们仍然是打分、排序和检索权重，不是神经科学级建模。

## 还没做完的部分

这次仍然不是终局，但“缺口”已经更集中，不再是前面那种大面积空白。

- `reality monitoring`
  - 现在已经能抓“高确定性语言却没有 verified 支撑”
  - 也已经能定位到句子级的过度确定表达
  - 现在已经补上了 `sentence-level binding`，以及带显式 proposition IR 的 `proposition extraction / binding`
  - proposition 现在不只保留 `subject / predicate / object`
  - 还会显式保留 `arguments / modality / quantifier / tense / evidentiality / counterfactual / sourceSpan / epistemicStatus`
  - 但这还只是启发式 grounding，不是完整自然语言命题逻辑器
  - 还没做到更稳的 negation / quantifier / counterfactual / discourse-level proposition grounding
- `reconsolidation`
  - 现在已经有 retrieval -> destabilized -> restabilized 的状态迁移
  - 同类记忆簇会被一并激活
  - 更强的新证据已经可以重写旧记忆，并保留旧值轨迹
  - 也已经有基于 `predictionErrorScore` 的 competing-cluster 处理
  - 还没做到更复杂的上下文依赖型更新模型
- `embodied coupling`
  - 目前没有持续的身体、感觉运动闭环和激素样调制
- `sleep-like offline cycle`
  - 现在 replay 是在线维护循环，不是真正的离线“睡眠整固”

## 这轮又补了一步：来源监测显式化

前一轮我们只是把 `sourceType` 和 `consolidationState` 写进数据结构。

这还不够，因为如果 reasoner 在 prompt 里看不到“来源监测结果”，它仍然可能把：

- reported
- perceived
- derived
- inferred

混成一团来回答。

所以这轮又补了一个显式的 `SOURCE MONITORING` section：

- 列出 verified / observed / inferred 的不同簇
- 列出 hot / stabilizing memories
- 明确 trust order
- 明确 caution 语句

这一步更接近认知心理学里的 reality monitoring / source monitoring，而不只是“数据库里多几个字段”。

## 这轮继续补的 2 个机制

这次不是再画一层架构图，而是继续把两组更接近真实脑机制的约束落进代码。

### 1. working-memory gating 显式化

认知神经科学里，working memory 不是“所有近期输入一起留在前台”，而是存在类似 basal ganglia / PFC 的门控过程：

- 有些内容被允许进入当前控制回路
- 有些内容即使刚出现，也会因为任务无关或干扰太高被挡在外面
- 输出阶段还会再做一次“当前到底拿哪一条去驱动行为”的选择

这轮在这套引擎里新增了：

- `gateScore`
- `gateThreshold`
- `gateOpen`
- `gateReason`
- `goalRelevanceScore`
- `queryRelevanceScore`
- `interferenceRiskScore`

context builder 不再直接把 recent working memory 整包塞进 prompt，而是先做一次 `working-memory gate`：

- `checkpoint_summary`
- `tool_result`
- 与当前 goal / query 高相关的 working entry

更容易被保留；而低信号、低任务相关、干扰风险高的闲聊 turn 会被压到 `blocked` 集。

这一步的生物学依据主要来自 working memory input/output gating 研究；但工程上仍然只是启发式打分，不是皮层-纹状体回路的神经动力学仿真。

### 2. feature-level source / reality monitoring

经典 source monitoring framework 强调，人脑不是靠一枚抽象标签判断来源，而是依赖一组“经验特征”：

- 感知细节
- 情境细节
- 反思 / 认知操作痕迹
- 社会佐证
- 外部锚点

所以这轮不再只用 `sourceType` 做粗分类，而是给记忆补了 `sourceFeatures`：

- `modality`
- `generationMode`
- `perceptualDetailScore`
- `contextualDetailScore`
- `cognitiveOperationScore`
- `socialCorroborationScore`
- `externalAnchorCount`
- `realityMonitoringScore`
- `internalGenerationRisk`

verifier 现在不只看“有没有 verified”，还会看：

- 句子绑定到的 support 是否主要来自 `internal_inference`
- 这些 support 的 `realityMonitoringScore` 是否过低
- `internalGenerationRisk` 是否过高

如果一句话主要绑到压缩摘要、内部推断或低现实性支撑，就会触发新的问题码：

- `reality_monitoring_gap_from_internal_support`
- `sentence_reality_monitoring_gap`

这一步更接近 Johnson 系列工作里关于 reality monitoring 的核心思想：判断来源依赖多维特征，而不是只看“数据库里写的是哪种 sourceType”。

## 这轮继续补的另外 2 个机制

### 3. staged sleep-like offline cycle

前面 replay 已经在做，但更像在线 maintenance。

这轮继续往更接近生物学的方向补了一步，而且不再只写一个 replay summary，而是拆成了显式阶段：

- `nrem_prioritization`
  - 优先重放高 `prediction error`
  - 高 `salience`
  - allocation bias 高
  - 正处在 competing traces 中的痕迹
- `sws_systems_consolidation`
  - 把离散 episode 写成显式 `event graph`
  - 把 replay 结果推进到更抽象的 semantic schema
- `rem_associative_recombination`
  - 只生成低确定性的重组假设
  - 不把重组结果直接提升成 verified fact

对应到代码里，现在会生成新的 `semantic` 记录：

- `offline_replay_stage_trace`
- `offline_replay_consolidation`
- `offline_replay_event_graph`
- `offline_replay_recombination`

并把源记忆更新：

- `offlineReplayCount`
- `lastOfflineReplayedAt`
- `systemsConsolidatedAt`
- `lastOfflineReplayPriority`
- `sleepCycleCount`
- `lastSleepStageTrace`
- `nremReplayCount / swsConsolidationCount / remRecombinationCount`
- `schemaLinkCount`

这一步借用了 sleep-dependent systems consolidation 的方向，依据主要来自 Born / Rasch 的 active system consolidation 综述、Rothschild 的 cortical-hippocampal-cortical loop，以及 Rose 等人的 replay prioritization 结果。

但它仍然只是“睡眠整固启发式”：

- 没有真实 NREM/SWS/REM 生理切换
- 没有 slow oscillation / spindle / ripple 的时序耦合
- 没有皮层-海马闭环振荡控制
- 没有睡眠压力、稳态需求和内感受驱动

所以它是朝真实脑逻辑逼近了一步，不是已经等价。

### 4. cross-sentence + multi-hop causal binding

上一轮 verifier 主要看 sentence-level / proposition-level binding，但跨句因果链仍然基本空白。

这轮新增了：

- `causalBindings`
- `causalChains`
- `eventGraph`
- 对 `因为...所以...`
- 对 `A。 因此 B。`
- 对 `therefore / thus / so`

的识别与绑定。

每条 causal relation 现在不只绑定：

- `cause`
- `effect`
- `bridgeSupportIds`
- `supportSummary`

还会去本地事件图里找 path：

- `eventGraphPath.pathFound`
- `eventGraphPath.hopCount`
- `eventGraphPath.multiHop`
- `eventGraphPath.supportSummary`

并新增四类问题码：

- `causal_binding_gap`
- `causal_relation_reality_gap`
- `causal_chain_gap`
- `causal_chain_reality_gap`

也就是说，系统现在不只是问：

- “这句话有没有 support”

而是开始问：

- “这个原因有没有 support”
- “这个结果有没有 support”
- “cause 到 effect 在本地 event graph 里能不能走通”
- “这条多跳因果链是不是主要靠内部推断撑起来的”

OpenNeed 端也开始直接生成 `match.event_graph`，让上游不只输出一句 recommendation，而是输出可被 Passport 消费的节点和边。

这一步更接近 Schlichting / Preston 所说的 memory integration，也更接近 Zacks 的 event segmentation / event model 方向，但仍然只是 symbol-heavy 的工程实现：

- 还不是连续事件模型
- 还不是完整世界模型
- 还不是 hippocampal-prefrontal 联合模拟
- 还没有反事实与情景想象层

### 5. explicit proposition extraction + live E2E boundary

这一轮继续把边界收紧了两处。

- Passport verifier 不再只靠 `claimKey` 和句子相似度
  - 现在会显式抽 `subject / predicate / object`
  - 也会把 proposition 写成更完整的 IR：
    - `arguments / modality / quantifier / tense / evidentiality / counterfactual / epistemicStatus`
  - 这轮继续补了：
    - `discourseRefs`
    - pronoun 到 referent 的启发式回绑
    - 显式 `negated / counterfactual` proposition
  - 再把 proposition 绑定回：
    - `profile / semantic / episodic / working memory`
    - `match.causal_hypothesis`
    - `match.event_graph`
    - `match.decision_provenance`
- 但这仍然不是“强 proposition grounding 已经完成”
  - 仍是 pattern-heavy / field-heavy / event-graph-heavy 的工程实现
  - 还不是通用命题解析器
  - 本轮已经补上第一版 `negation / counterfactual / discourse referent` 启发式
  - 但仍不能覆盖复杂否定 scope、量词、隐含主语、省略、跨段 discourse 和反事实嵌套

legacy OpenNeed 兼容层这轮也补了真正的 live E2E：

- 启动 Passport server
- 通过 OpenNeed HTTP 写回真实 memory bundle
- 再用 Passport 的 `context-builder` 和 `response-verify` 做闭环验证

所以现在必须把两类验证分开说：

- `verify:cognitive-memory`
  - 只证明 bundle 结构、字段写回、`sourceFeatures`、`match.causal_hypothesis`、`match.event_graph`
  - 不证明 live OpenNeed -> Passport -> verifier 业务链路
- `verify:passport-e2e`
  - 证明 live 写入、live 取回、live proposition binding、live causal path binding 已经通
  - 现在会显式跑两种场景：
    - `unconfirmed recommendation`
    - `confirmed recommendation`
  - 前者应继续暴露 `proposition_reality_gap`
  - 后者只有在 `match.decision_provenance` 带外部确认、并写成 `verified + confirmed` 后才允许通过

也就是说，这一轮不是把系统说得更满，而是把“做到哪里”和“还没做到哪里”都写进了代码和验证脚本里。

### 6. discourse-grounded proposition heuristics + continuous controller proxies

这轮又补了两块，但都必须老老实实按“启发式近似”来描述。

- `discourse-grounded proposition heuristics`
  - verifier 现在会维护一个最小 `discourseState`
  - 这轮又把 proposition 归一化拆成独立模块：
    - `proposition-normalizer`
    - `discourse-graph`
  - 会把 `他 / 她 / 这个建议 / 这一步` 回绑到：
    - `当前记忆`
    - `匹配结果`
    - `流程`
  - 这轮又补了：
    - `其中一项 / 另一项 / 前者 / 后者`
    - `至少两项 / 多数 / 大多数 / 部分 / 少数`
    - 跨段落里的 `预计两小时后补确认` 这类省略主语句
  - 命题现在会显式带：
    - `discourseRefs`
    - `polarity`
    - `counterfactual`
    - `quantifier`
    - `canonicalText`
    - `subjectResolution`
    - `normalization`
  - verifier 现在还会把 proposition 和 referent 写成显式 `discourseGraph`
    - 记录 `refers_to / supports_subject_resolution / same_referent_progression`
    - 这样跨句恢复时，至少能看见“这个命题是靠哪条 referent 线索被回绑的”
  - clause-level parser 这轮又补了一层收口
    - 不再把中文里的裸 `再` 当成通用断句符
    - 避免把 `先补验证再推进` 这类 recommendation 错切成局部 proposition
  - 并且不会再把反事实 proposition 直接按“现实已证实命题”去打 `proposition_reality_gap`
  - 对 `recommendation / next_action` 这类决策命题
    - 如果 proposition 已绑定到 `confirmed + verifiedEquivalent` 支撑
    - proposition 层现在也会同步反映 `confirmed`

- `continuous controller proxies`
  - `cognitiveState` 现在不只保留 `fatigue / sleepDebt`
  - 还新增：
    - `uncertainty`
    - `rewardPredictionError`
    - `threat`
    - `novelty`
    - `socialSalience`
    - `homeostaticPressure`
    - `bodyLoop`
  - `bodyLoop` 目前来自工程代理量：
    - `taskBacklog`
    - `conflictDensity`
    - `humanVetoRate`
    - `failurePressure`
  - 这些值会进入：
    - `continuousCognitiveState`
    - `working-memory gate`
    - `offline replay` gate
    - `offline_replay_stage_trace`
  - 也就是说 replay 不再只是“被调用一次就跑”，而是开始受持续状态调制

- `stateful semantic supersession`
  - 对 `match.decision_provenance / match.action_execution / match.event_graph / match.external_confirmation` 这类当前状态语义，Passport 现在会把旧 trace 标成 superseded
  - 目的不是删除历史，而是让 verifier 在恢复“当前决策”时优先看到最新 trace，而不是被更旧的 planned trace 抢权
  - 这轮又把这个约束继续推进到 live verifier
    - 如果回复里的 `recommendation / next_action` 已经被新的 current decision 改写
    - verifier 会显式报 `proposition_superseded_by_current_decision`
    - 这比单纯报 binding gap 更接近“当前生效痕迹优先”的目标

- `live E2E beyond single request`
  - OpenNeed 现在不只跑单次 `verify:passport-e2e`
  - 还新增：
    - `verify:passport-concurrency`
    - `verify:passport-feedback`
    - `npm run soak:runtime`
    - `verify:passport-drift`
    - `verify:passport-replay`
    - `verify:passport-manual-correction`
  - 它们分别检查：
    - 并发写入后 current decision 是否仍能收敛
    - 人工反馈是否能把 recommendation / next action 改写进 confirmed 路径
    - 多轮长期写入后 confirmed trace 是否仍主导 verifier
    - drift 长跑后旧 trace 是否还会错误压过当前 confirmed state
    - offline replay 后 recommendation / event graph / verifier 是否保持稳定
    - 人工纠正后旧 recommendation 是否会被当前决策显式压制
  - 这轮又把 `confirmed` 从单源确认推进到 `multi-source confirmation`
    - `decision_provenance`
    - `external_confirmation`
    - `event_graph`
    - live verifier
    都会显式记录 `confirmationCount / confirmationMode`
  - 这轮又把 external confirmation 从“只记条数”推进到“显式仲裁”
    - 会记录 `authorityLevel / authorityScore`
    - 会记录 `observedAt / freshnessHours / stale`
    - reconciliation 会区分：
      - `high_authority_rejected`
      - `multi_system_confirmed`
      - `partially_confirmed`
      - `stale_confirmed`
      - `confirmation_timeout`
  - 这轮又把“高权威拒绝优先”从隐式权重推进成显式状态
    - 当 fresh 的高权威拒绝压过低权威 confirmed 时
    - reconciliation 会直接给出 `high_authority_rejected`
    - `decision_provenance.status` 会落到 `rejected`
    - `action_execution.status` 会落到 `blocked`
  - 这轮还补了两个会直接影响 live verifier 结果的收口：
    - event graph 的节点匹配不再把整条 `match.event_graph` 的共享 supportId 当成“节点命中”
    - 而是先看 clause / fragment 与节点文本的相似度，再把 support overlap 只当成有限 boost
    - 目的是避免 causal path 被同一张图里的无关节点抢走，导致 `pathFound=false`
  - 对于带外部 confirmation 但 confirmation 项没有显式 `status` 的情况
    - OpenNeed 现在会在 `explicitDecisionStatus=confirmed` 或 feedback override 场景下做受限继承
    - 这样 `multi-source confirmation` 不再因为缺少逐条 status 而退回 `decided`
  - live E2E 这轮又继续往生产边界推进了两条：
    - `verify:passport-restart`
      - 验证 ledger 重启后 agent / memory / current decision 是否能恢复
    - `verify:passport-fault`
      - 验证 Passport 不可达时写入不能假成功
      - 验证 `stale + low-authority` confirmation 不能伪装成 confirmed
      - 验证恢复 fresh multi-source confirmation 后 verifier 才允许重新全绿
    - `verify:passport-confirmation-precedence`
      - 验证高权威 reject 会压过低权威 confirmed
      - 验证旧 recommendation 会显式命中 `proposition_high_authority_rejection`
    - `verify:passport-adapter-lifecycle`
      - 验证 `openneed_confirmation_adapter` 已经不是附属字段，而是独立输入源
      - 验证 `match.confirmation_lifecycle` 会把 adapter request 推进到 `pending / confirmation_timeout / resolved`
      - 验证 timeout 阶段 recommendation 仍必须停在 `decided`
      - 验证 recovery 阶段只有在多系统确认补齐后才恢复 `confirmed`
    - `verify:passport-adapter-events`
      - 验证 ATS / scheduler / human_review 现在可以按“独立 event source”顺序逐条写入
      - 验证 OpenNeed 会先读 Passport 当前 state，再把单条 adapter event merge 成新的 current decision
      - 验证 `scheduler timeout + human_review pending + adapter confirmed` 仍必须停在 `confirmation_timeout`
      - 验证 `scheduler confirmed` 后只会到 `partially_confirmed`
      - 验证 `human_review confirmed` 返回后才允许进 `multi_system_confirmed`
    - `verify:passport-adapter-ingest-http`
      - 验证 OpenNeed `/api/ai/passport-adapter-ingest` 已经能作为独立 HTTP ingest 面接收 adapter request / confirmation event
      - 验证 queue 路径也会先做 remote current-state hydration，再更新 Passport 当前 decision state
      - 验证 `OpenNeed HTTP -> queue -> Passport` 的链路上，timeout / partial / recovered 三阶段都还能被 verifier 正确识别
    - `verify:passport-adapter-protocols-http`
      - 验证 OpenNeed `/api/ai/passport-adapter-ingest/ats`、`/scheduler`、`/human-review` 三条 adapter-specific route
      - 验证不同 payload 协议会被归一化成同一条 confirmation lifecycle / current decision 更新路径
      - 验证 `confirmation_timeout -> partially_confirmed -> multi_system_confirmed`
    - `verify:passport-adapter-replay-http`
      - 验证 OpenNeed `/api/ai/passport-adapter-ingest/replay` 会把乱序 adapter event 按 `occurredAt` 重放
      - 验证 replay 后 `high_authority_rejected` 仍会把 `decision_provenance.status` 压到 `rejected`
      - 验证 `action_execution.status` 也会同步落到 `blocked`
    - `verify:passport-adapter-contract-http`
      - 验证 adapter ingress 已经开始具备 route-level HMAC、event id 幂等和 journal contract metadata
      - 验证坏签名会被拒绝
      - 验证重复 `eventId` 不会再重复写 Passport current state
    - `verify:passport-adapter-recover-http`
      - 验证 OpenNeed 重启后仍能从本地 journal 取回 adapter event
      - 验证 `/api/ai/passport-adapter-ingest/recover` 可以把这些 event 重放到新的 Passport target agent
      - 验证 recover 后 `decision_provenance.status=confirmed`
    - `verify:passport-adapter-schema-http`
      - 验证 adapter-specific route 已经开始具备 schema gate，而不是只要带 token/hmac 就放行
      - 验证缺失关键时间戳、request window、verdict 时会直接 `400`
    - `verify:passport-adapter-journal-http`
      - 验证 key registry 会真实按 `key-id` 选 secret
      - 验证 `auth_rejected / schema_rejected / completed` 三类 ingress attempt 都能被 journal API 拉到
    - `verify:passport-adapter-version-http`
      - 验证 adapter-specific route 已经开始检查 `protocol / contractVersion / schemaVersion`
      - 验证错误版本会直接被拒绝
      - 验证 current exact contract 已升级到 `openneed_adapter_ingress_contract_v2`
      - 验证 legacy `v1` 会被升级进 `v2`
      - 验证成功请求的 contract 和 journal record 都会带回版本元数据
    - `verify:passport-adapter-version-compat-http`
      - 验证上一代 schema 会被迁移到当前 schema，而不是被静默放行
      - 验证 `receivedSchemaVersion / compatibilityMode / migrationApplied` 会保留下来
    - `verify:passport-adapter-journal-export-http`
      - 验证 OpenNeed `/api/ai/passport-adapter-ingest/journal/export` 会导出 `NDJSON`
      - 验证导出记录仍保留 `status / protocolName / contractVersion / schemaVersion`
    - `verify:passport-adapter-recover-partial-http`
      - 验证 recover route 已支持 `untilOccurredAt / afterOccurredAt`
      - 验证 current decision 可以先恢复到 `partially_confirmed`
      - 再在最后一跳 confirmation 补齐后恢复 `confirmed`
    - `verify:passport-adapter-recover-fault-http`
      - 验证 mixed good/bad journal stream 下 `stopOnError=true` 会在 unreplayable record 直接停下
      - 验证 `stopOnError=false` 会跳过 `auth_rejected / schema_rejected`
      - 验证剩余 completed event 仍能恢复 `confirmed + resolved`
    - `verify:passport-adapter-recover-mixed-http`
      - 验证坏记录、旧版记录、重复记录混在一起时，partial rebuild 仍能先停在 `partially_confirmed + pending`
      - 验证 final rebuild 只补最后一跳后可以恢复到 `confirmed + resolved`
    - `verify:passport-adapter-recover-cursor-http`
      - 验证 recover 已开始支持 `untilCursor / checkpointCursor`
      - 验证 partial rebuild 可以直接拿 `checkpoint.resumeAfterCursor` 继续
      - 验证 checkpoint continuation 后能恢复 `confirmed + resolved`
    - `verify:passport-adapter-recover-artifact-http`
      - 验证 `/recover/snapshot` 会校验 `manifest/checksum`
      - 验证 manifest mismatch 会显式报 `snapshot_manifest_mismatch`
      - 验证 partial recover 返回的 `checkpointArtifact` 可以直接续跑到 `confirmed + resolved`
    - `verify:passport-adapter-precedence-http`
      - 验证 older replay 不会覆盖 fresher `high_authority_rejected` current state
      - 验证 replay 会被显式标成 `target_state_precedence_guard`
    - `verify:passport-adapter-multi-instance-http`
      - 验证 shared journal path 下跨实例可见
      - 验证 isolated journal path 下仍不可见
      - 也就是现在只证明了“共享本地 journal 的跨进程可见性”，没有证明分布式一致性

但边界也同样硬：

- `discourseState` 不是通用 discourse parser
- 还不是前额叶-海马的真实 referential binding
- `quantifier / implicit subject / cross-paragraph` 仍是 pattern-heavy 启发式，不是通用 discourse semantics
- `fatigue / sleepDebt / bodyLoop` 只是工程 proxy，不是真实睡眠压力、内感受或神经调质动力学
- 这一步是在逼近“连续状态调制”，不是已经做出了真实脑振荡控制器
- 并发 / feedback / soak 证明的是 live HTTP 闭环更硬了，不等于 UI、多节点部署、长期生产漂移都已被证明
- `multi-source confirmation` 目前还是 OpenNeed 主动写回的外部确认梯子，不是真正跨系统自动校验与一致性证明
- `openneed_confirmation_adapter` 现在虽已独立于 `openneed_match_explain` 写入 lifecycle，但仍是 OpenNeed 内部写回，不是 ATS / scheduler / human review 原生事件总线
- 独立 adapter event source 这轮虽然已经能读 Passport 当前 state 再 merge，但它仍是 OpenNeed 侧的 bridge merge，不是外部系统原生 event bus / CDC / webhook ingestion
- 新增的 `/api/ai/passport-adapter-ingest` 只是 OpenNeed 暴露出来的 HTTP ingest 面，不是原生 webhook substrate，也不是外部系统自动发现 / 自动订阅
- 新增的 `/api/ai/passport-adapter-ingest/ats`、`/scheduler`、`/human-review` 只是 adapter-specific HTTP facade，不是各外部系统的原生接入栈
- `/api/ai/passport-adapter-ingest/replay` 只是按时间戳顺序的 HTTP 重放，不是 durable log replay、broker 恢复或分布式事件重演
- 这轮新增的 HMAC 签名仍是 OpenNeed 自己验签，不是外部系统原生签名基础设施或双向信任链
- `x-openneed-adapter-key-id` 虽已接入 key registry，但 registry 仍是 OpenNeed 本地配置，不是外部系统原生 key discovery / rotation service
- `eventId` 幂等现在仍是 OpenNeed 本地 journal 去重，不是跨实例幂等表或分布式 exactly-once
- `/api/ai/passport-adapter-ingest/recover` 依赖本地 JSON journal，不是 durable broker、CDC log 或生产级恢复编排
- `/api/ai/passport-adapter-ingest/journal` 只是本地 audit 视图，不是集中式审计与跨节点取证系统
- `/api/ai/passport-adapter-ingest/journal/export` 只是本地 NDJSON 导出，不是集中式审计仓库、数据湖或生产级离线分析管道
- 这轮的 schema compatibility 只是 route-level 手工迁移窗口，不是通用 schema registry、自动版本协商或统一迁移总线
- 这轮的 `contractVersion v2` 升级路径也是 route-level 手工兼容窗口，不是通用 contract negotiation、多版本双写或统一升级编排
- recover 的 `untilOccurredAt / afterOccurredAt / eventIds[]` 是工程过滤器，不是 durable log cursor 或生产级 replay checkpoint
- recover 的 `skippedCount / failedCount / partialFailure` 是工程容错摘要，不是 durable broker delivery guarantee 或 replay cursor 语义
- 新增的 `cursor/checkpoint` 只是 `sort_key + fingerprint` 工程近似，不是 durable broker offset、CDC cursor 或生产级 checkpoint substrate
- 新增的 `sequenceId checkpoint` 只是 OpenNeed journal 的稳定恢复序号，不是 durable log offset、broker sequence 或跨实例 replay cursor
- 新增的 `checkpointArtifact` 只是 HTTP recover 的 portable resume object，不是 durable checkpoint substrate、broker cursor lease 或生产级恢复控制面
- 新增的 `manifest/checksum` 只是 OpenNeed 本地 snapshot/export 校验，不是集中式审计签名链、WORM 存储或跨系统 trust chain
- 新增的 `target_state_precedence_guard` 只是 replay 前的保守工程拦截，不是分布式 current-state 仲裁、一致性协议或多节点写保护
- 新增的伪多实例验证只证明“共享本地 journal 文件”可见，不等于跨实例幂等表、durable journal 或分布式恢复已经成立
- 新增的 `snapshot recover` 只是 portable journal snapshot 重放，不是生产级 snapshot store、distributed rebuild 或 durable state transfer
- 这轮拆出来的 contract/schema registry 只是 OpenNeed 本地兼容表，不是跨系统 registry、自动协商或统一迁移控制面
- 新增的 `NDJSON export -> recover` 只是 portable export 重放，不是集中式事件仓库、append-only audit log 或 durable export/import pipeline
- 新增的 `snapshot parseSummary / tolerant recover` 只是工程化坏行容错，不是 checksum-backed audit replay、消息校验链或生产级恢复语义
- `high_authority_rejected` 目前仍建立在业务侧写回的 authority/freshness 上，不是外部系统原生仲裁总线
- event graph path binding 现在是“文本相似度优先 + support overlap 限幅”的工程修正，不是 hippocampus-PFC 的真实 relational retrieval
- `discourseGraph` 现在只是可追踪的 referent/proposition 图，不是连续的 discourse semantics 或真正的 relational episode graph
- `authority / freshness / stale` 现在仍来自业务显式写回，不是独立传感器或外部系统自动共识
- `match.confirmation_lifecycle` 是工程化异步确认生命周期，不是分布式 consensus、消息重试编排或真实生产异步状态机
- 这轮把 “current state dominance” 调成了 `lifecycle activity > old none-state`，它更接近“当前活动痕迹主导”，但仍不是人脑里的连续吸引子动力学
- 这轮把 `action_execution.status=blocked` 提升成当前动作状态的显式高优先级，只是 current-state dominance 收口，不是动作选择回路的真实皮层-纹状体门控
- 2026-04-08 这轮新增的 `durable-ingress-ledger / checkpoint-store / current-state-arbiter`
  - 只是让 OpenNeed 的 adapter ingest / recover 更接近“稳定事件流和恢复控制面”
  - 不是海马-PFC 的本体机制，更不是 distributed broker / consensus substrate
- 2026-04-08 这轮新增的 `interoceptiveState / neuromodulators / oscillationSchedule / replayOrchestration`
  - 只是 Passport 连续状态调制器的第一版
  - 它比单纯 `fatigue / sleepDebt` 更接近 neuromodulation 和 sleep-like replay gate
  - 但仍然不是真实的 dopamine / acetylcholine / norepinephrine 生理动力学，也没有真实 theta / ripple / slow oscillation 耦合
- 2026-04-08 这轮又把这套连续状态从“只暴露 hints”往前推了一步
  - offline replay 的组选择现在会直接吃 `traceClassBoost / taskSupportScore / modulationBoost`
  - reconsolidation 会把 `valueWinMargin / ambiguityMargin` 交给连续动力学调制
  - preference arbitration 也开始回看最近被 supersede 的 `stable_preferences`
  - 但这些仍然是启发式工程规则，不是可拟合的神经动力学方程
- 这轮的 `sleepPressure / dominantRhythm / replayDrive`
  - 仍是工程代理量，不是生理可测量量
  - 也没有把 body loop 接到真实感觉运动闭环或内感受输入

## 参考方向

下面这些方向，是本轮改动背后的主要神经科学依据：

- 海马体与皮层的记忆分工 / declarative memory
- episodic 与 semantic 的分化
- emotional salience / prioritization
- source monitoring
- systems consolidation / replay
- event boundaries / segmentation

建议后续优先顺序：

1. schema-sensitive reconsolidation policies
2. prediction-driven event boundary learning
3. embodied coupling
4. true oscillatory sleep controller

## 参考文献与方向

- Larry R. Squire, Stuart Zola-Morgan, `The medial temporal lobe memory system`
  - https://www.nature.com/articles/35036213
- James L. McGaugh, `The amygdala modulates the consolidation of memories of emotionally arousing experiences`
  - https://pubmed.ncbi.nlm.nih.gov/15217324/
- Jeffrey M. Zacks et al., `Event perception: a mind-brain perspective`
  - https://pubmed.ncbi.nlm.nih.gov/17338600/
- Marcia K. Johnson, Shahin Hashtroudi, D. Stephen Lindsay, `Source monitoring`
  - https://pubmed.ncbi.nlm.nih.gov/8346328/
- Christopher H. Chatham, Michael J. Frank, David Badre, `Corticostriatal output gating during selection from working memory`
  - https://pubmed.ncbi.nlm.nih.gov/24559680/
- Christopher H. Chatham, David Badre, `Multiple gates on working memory`
  - https://pubmed.ncbi.nlm.nih.gov/26719851/
- Alla K. Rothschild, Eyal Eban, Yonatan Frank, `A cortical-hippocampal-cortical loop of information processing during memory consolidation`
  - https://pubmed.ncbi.nlm.nih.gov/27941790/
- Jan Born, Ines Wilhelm, `System consolidation of memory during sleep`
  - https://pubmed.ncbi.nlm.nih.gov/21541757/
- Björn Rasch, Jan Born, `About Sleep's Role in Memory`
  - https://pmc.ncbi.nlm.nih.gov/articles/PMC3768102/
- Charlotte M. Schlichting, Alison R. Preston, `Memory integration: neural mechanisms and implications for behavior`
  - https://pubmed.ncbi.nlm.nih.gov/25750931/
- Darya L. Z. Rose et al., `Human hippocampal replay prioritizes weakly learned information and predicts memory performance`
  - https://pubmed.ncbi.nlm.nih.gov/30254219/
- David C. Plaut, James L. McClelland, Brian L. McNaughton, Randall C. O'Reilly, `Hippocampal and neocortical contributions to memory: advances in the complementary learning systems framework`
  - https://pubmed.ncbi.nlm.nih.gov/12475710/
- Sheena A. Josselyn, Paul W. Frankland, `Memory Allocation: Mechanisms and Function`
  - https://pubmed.ncbi.nlm.nih.gov/29709212/
- Gina Turrigiano, `Homeostatic synaptic plasticity: local and global mechanisms for stabilizing neuronal function`
  - https://pubmed.ncbi.nlm.nih.gov/22086977/
- Kaster et al., `Building a realistic, scalable memory model with independent engrams using a homeostatic mechanism`
  - https://pubmed.ncbi.nlm.nih.gov/38706939/
- Eric R. Kandel, `The Molecular Biology of Memory Storage: A Dialog between Genes and Synapses`
  - https://www.nobelprize.org/prizes/medicine/2000/kandel/lecture/
- Nobel Prize in Physiology or Medicine 2000 press release
  - https://www.nobelprize.org/prizes/medicine/2000/press-release/

# OpenNeed 记忆稳态引擎：类脑启发式记忆架构

## 核心结论

这套引擎不去机械复制人脑，而是借鉴人脑更有效的运行顺序：

`感知输入 -> 工作记忆 -> 情节记忆 -> 抽象经验层（semantic layer） -> 身份层`

这样做的目的，是让 Agent 的长期连续性不再依赖一整段聊天历史，而是依赖分层后的结构化、可追溯记忆。

这套能力现在的正式命名是 `OpenNeed 记忆稳态引擎`。
这份文档描述的是工程启发，不是神经科学等价实现。
当前代码里的 `cognitiveState / preference / replay` 主要是启发式状态、检索权重和恢复信号，不应解读为已经实现“持续认知网络”。

## 五层映射

### 1. 感知输入层

对应当前上下文里的最新输入：

- 用户最近几轮对话
- 最近工具结果
- 最近 conversation minutes
- 检索命中的本地知识

在系统里，这部分会先被整理成 `perceptionSnapshot`，它只代表“刚刚发生了什么”。

### 2. 工作记忆层

对应 Agent 当前正在处理的任务空间：

- 当前目标
- task snapshot
- recent conversation turns
- recent tool results
- working checkpoint

它解决的是“现在该做什么”，不是“我是谁”。

### 3. 情节记忆层

对应真实发生过的事件：

- 一次输入采集
- 一次状态写入
- 一次建议生成
- 一次确认请求
- 一次动作执行

这部分沉淀在 `episodic` layer，用来帮助 Agent 以后理解“以前发生过什么、为什么会这样”。

### 4. 抽象经验层（semantic layer）

对应从具体事件中慢慢沉淀出的 schema：

- 反复出现的上下文约束
- 当前记忆的长期关注模式
- 匹配成败的抽象规律
- 可复用的信任判断线索

这部分对应的是“发生过很多次之后，总结出了什么”，不是某一次具体事件本身。

### 5. 身份层

对应不会频繁变化的稳定事实：

- Agent ID / DID / wallet
- profile fields
- 长期目标
- 稳定偏好
- policy / authorization

这部分是 Passport 最重要的底座，因为它回答的是“这个 Agent 持续是谁”。

## 为什么这样更适合记忆稳态引擎

如果只靠长上下文，Agent 很容易：

- 忘记早期关键事实
- 把压缩摘要误当成新输入
- 把短期情绪误当成长期身份

引入类脑分层后：

- `感知输入` 只负责把最近发生的事送进来
- `工作记忆` 只负责当前任务
- `情节记忆` 负责保留事件
- `抽象经验层（semantic layer）` 负责把多次事件抽象成 schema
- `身份层` 负责保留连续性

这会让 Passport 更像“长期连续运行的状态底座”，而不是“会话窗口里的临时人格”。

## 当前代码里的落点

- `buildContextBuilderResult`
  - 新增 `perceptionSnapshot`
  - 新增 `cognitiveLoop`
  - 明确把 prompt 组装成 perception / working / episodic / semantic / identity 的顺序
  - 现在也可以把 `mempalace` 作为 `externalColdMemory` 只读侧车接进来，但结果会单独分栏，只当候选线索，不会冒充本地真源
  - 这轮又补了专用 live build 链路：OpenNeed 会把自身文档 / 代码和上下文坍缩测试工具整理成 staging 语料，再 mine 到独立的 `~/.mempalace/openneed-sidecar-palace`，避免依赖用户全局 mempalace 默认目录
  - 如果当前候选回复需要交给远端 reasoner，`externalColdMemory` 也会先脱敏，只保留 provider / hitCount 等边界信息，不把候选原文直接外发
  - 对应的操作流也已经固定成 `npm run build:mempalace:live -> npm run verify:mempalace:live -- "上下文坍缩" -> npm run verify:mempalace:remote-reasoner`，最后一步也是 `smoke:all` 的前置 preflight

- `writePassportMemory`
  - 继续作为所有分层记忆写入的统一入口
  - 外部冷记忆检索结果不会直接写回这里，避免把 sidecar 误当主记忆

- `buildAgentMemoryLayerView`
  - 继续作为 profile / episodic / semantic / working / ledger 的统一读取入口

## 与 OpenNeed 的关系

OpenNeed 更像“场景大脑前端”，负责：

- 收集用户输入
- 收集外部系统事件
- 触发匹配与确认链
- 生成原始感知信号

记忆稳态引擎更像“长期人格中枢”，负责：

- 身份连续性
- 分层记忆
- 资产与授权
- 跨窗口一致性

一句话：

`OpenNeed 负责发生，记忆稳态引擎负责记住，并把事件慢慢变成可复用的抽象经验。`

## 新增：来源监测层（source monitoring）

仅有记忆分层还不够，人脑还会区分“这件事是我亲眼感知到的、别人告诉我的、还是我后来推断出来的”。

现在 Passport 已经把这层显式写进上下文：

- `verified`
  - 可以更接近“事实层”使用
- `perceived`
  - 更像亲历观察
- `reported`
  - 更像他人陈述
- `derived / inferred`
  - 只能当推断，不应直接升级成已验证结论

同时还会把：

- `hot`
- `stabilizing`
- `consolidated`

这些巩固状态一起交给 reasoner。

这意味着 Passport 不再只是“记住什么”，而是开始把来源和成熟度提示显式提供给 reasoner 参考。

## 新增：持续运行状态层（cognitiveState）

在初始版本里，类脑架构主要体现为：

- prompt 组装顺序
- 结构化记忆分层
- context builder 的运行回路

现在系统已经进一步补出一层“持续运行状态摘要”的最小实现，代码字段仍沿用 `cognitiveState` 命名。它不是严格意义上的生物神经网络，也还不是训练意义上的可学习网络，而是一个以规则、计数、状态迁移和记忆回写为主的运行协调层。

### 边界声明

当前这层能力应该被理解为：

- 类脑启发式的上下文组织
- 持续运行状态记录
- 恢复与偏好保持的协调层

而不应该被理解为：

- 生物意义上的类人脑神经网络
- 已经具备自训练能力的学习系统
- 能完全自主恢复并稳定执行后续任务的自治体

### 现在新增了什么

- `cognitiveState`
  - 每个 Agent 都会有一份启发式运行状态摘要
  - 状态会跟随 runner / 自检更新

- `cognitiveTransitions`
  - 记录运行状态如何从一个阶段迁移到下一个阶段
  - 可用于观察状态变化、恢复信号和启发式偏好更新

- `continuousCognitiveState`
  - context builder 会把最近的运行状态摘要重新注入推理上下文
  - reasoner 仍主要看“当前 prompt”，只是多了一组运行态提示可供参考
  - 这轮继续补了 `fatigue / sleepDebt`
  - 并让离线 replay gate 和 sleep stage trace 开始读这两个状态 proxy

### 运行状态摘要里包含什么

- `mode`
  - stable
  - learning
  - self_calibrating
  - recovering
  - bootstrap_required
  - resident_locked

- `dominantStage`
  - 当前更偏感知、工作记忆、情节记忆、抽象经验层（semantic）还是身份层

- `continuityScore`
  - 当前连续性是否稳定

- `calibrationScore`
  - 当前是否需要更强自校准

- `recoveryReadinessScore`
  - 当前是否具备较好的恢复条件

- `fatigue`
  - 当前运行负荷、截断压力、校验压力累积出来的疲劳 proxy

- `sleepDebt`
  - 当前离线 replay 缺口与连续负荷累积出来的睡眠债 proxy

- `preferenceProfile`
  - 长期目标
  - 稳定偏好
  - 推断偏好
  - 偏好权重

- `adaptation`
  - learning cycle 次数
  - self calibration 次数
  - recovery 次数
  - 偏好更新次数

### 这意味着什么

这意味着这套引擎不再只是：

- “把记忆分层后塞进 prompt”

而是额外具备：

- 持续的运行态摘要
- 可追踪的状态迁移记录
- 基于规则和打分的启发式自检 / 恢复信号
- 基于任务漂移的恢复建议与恢复包生成
- 对长期偏好的逐步保持

一句话：

`它已经从单纯的记忆分层，迈向了更可观测、可恢复的运行态摘要层。`

## 这次补强了什么

相比前一版，这次不再只停留在“四层口号”，而是把几条更接近生物记忆的约束写进了底层结构：

- `semantic layer`
  - 不再只有 event 和记账事实
  - 允许把重复出现的规律沉淀成 schema

- `salience`
  - 每条记忆会带显著性
  - 检索时不只看词面匹配，也会看“这条记忆值不值得被优先想起”

- `sourceType`
  - 区分 perceived / reported / derived / verified / system
  - 避免把推断出的内容当成已经验证的事实

- `consolidationState`
  - 区分 hot / stabilizing / consolidated
  - 让工作记忆、情节记忆、长期记忆不再只有“层”的差别，也有“成熟度”的差别

- `boundaryLabel`
  - 给事件记忆打上边界标签
  - 后面做 replay、resume、失败复盘时能更像“按事件段落恢复”

## 这轮继续补完的三块

### 1. replay / consolidation

系统现在不再只靠一次性 promotion。

它会：

- 把 working + episodic 里的高价值事件按 `patternKey / boundaryLabel` 聚成 replay group
- 对重复出现、被反复召回或高显著的事件簇做回放巩固
- 生成 `semantic` 层的 `replay_consolidated_pattern`

这更接近：

- 海马体对近期经验的 replay
- 以及“从具体事件到稳定语义结构”的 systems consolidation

### 2. adaptive forgetting

系统现在不再默认“只增不减”。

它会按：

- 年龄 `ageDays`
- 强度 `strengthScore`
- 细节保留度 `detailRetentionScore`
- recall / promotion 历史

对不同层执行不同策略：

- `working`
  - 过旧、低强度、低细节的短期痕迹会被 `forgotten`
- `episodic`
  - 长期没有被召回、也没有被巩固的事件会被 `decayed`
- `semantic`
  - 长期低价值、低召回的抽象语义也会被 `decayed`

这一步不是“随便删”，而是模拟更接近人脑的有限容量与选择性保留。

### 3. pattern separation / completion

检索层现在不再简单拿最高分的几条。

而是先：

- 用 `separationKey` 做 pattern separation
- 避免高度相似、同边界的事件互相污染

再：

- 用 `patternKey / boundaryLabel` 做有限的 pattern completion
- 补回与当前问题属于同一模式、但来自不同事件段的记忆

这样能更接近：

- 不把相似事件混成一团
- 但又保留“看到线索就联想到整类经验”的能力

## 这轮新增的生物启发式工程映射

为了不只停在“记忆分层”这一层，这次又补了 4 个借用神经生物学命名的工程字段。

### 1. eligibility trace

每条新记忆现在都会带一段短时间的 `eligibility trace`：

- `eligibilityTraceScore`
- `eligibilityTraceUntil`

它对应的是：

- 突触已经被打上“可塑性标签”
- 但是否真的进入长期巩固，还要看后面有没有更强的调制信号来“捕获”它

这和 synaptic tagging and capture 的思想是同向的。

### 2. neuromodulation

每条记忆现在还会显式携带：

- `novelty`
- `reward`
- `threat`
- `social`

它不是在模拟真实神经递质浓度，而是在工程上借鉴：

- 多巴胺样的新奇/奖励调制
- 情绪与威胁对巩固的增强
- 社会相关信息对长期保留的偏置

这一步的作用，是让 replay / consolidation 不只看词面匹配和强度，还看“这件事对主体来说到底重不重要”。

### 3. homeostatic scaling

系统现在会做 `homeostatic scaling`：

- 为不同记忆层维护一个目标平均激活水平
- 避免所有记忆都越来越强，最后失去区分度

这一步对应的是：

- 人脑里防止 runaway excitation 的 homeostatic plasticity / synaptic scaling 思想

它的意义不是“让系统变弱”，而是让重要记忆凸显、噪声记忆回落。

### 4. allocation bias

每条记忆现在会计算一个 `allocationBias`。

它综合：

- salience
- confidence
- novelty
- reward
- social relevance

这个量的作用类似：

- 哪些事件更容易被分配到“会被长期记住”的那部分网络里

这和 engram allocation / excitability bias 是同方向的工程映射。

### 5. reconsolidation

系统现在开始显式处理“旧记忆被重新叫起后会暂时变得可改写”这件事。

- 记忆被检索命中后，不只增加 `recallCount`
- 还会进入一个短时 `destabilized` 窗口
- 同字段、同 pattern、同 separation 的记忆簇也会被一并激活
- 如果这段时间里存在更高可信度、更高来源等级的新证据，系统会把旧记忆直接重写
- 同时把旧值留进 `reconsolidationPreviousValues`
- maintenance cycle 最后会把这条记忆重新 `restabilized`

这一步比“被调用一次就简单加权”更接近生物学里 retrieval -> destabilization -> restabilization 的逻辑。

### 6. prediction error / competing traces

这轮又往前补了一层：  
不是只要出现新证据，旧记忆就直接改写，而是先看“预测误差够不够大、竞争值之间差距够不够明显”。

当前实现里：

- 会把同字段 / 同 pattern / 同 separation 的记忆聚成 competing clusters
- 每个 cluster 都会计算：
  - 来源可信度
  - 置信度
  - 强度
  - 显著性
  - 新奇与奖励相关性
- 如果新值明显胜出：
  - 旧记忆会被改写
  - 旧值进入 `reconsolidationPreviousValues`
- 如果多个候选值很接近：
  - 系统不会强行覆盖
  - 而是进入 `ambiguous_competition`
  - 并显式记录 `predictionErrorScore` 与候选值簇
- 2026-04-08 这轮又把连续动力学直接接进了 reconsolidation：
  - `buildPassportCognitiveBias(...)` 会调制 `valueWinMargin / ambiguityMargin`
  - 每次 restabilization 会额外写：
    - `lastReconsolidationDrivers`
    - `lastReconsolidationThresholds`
  - 里面会保留：
    - `goalSupportScore / taskSupportScore`
    - `conflictTraceScore / predictionErrorTraceScore`
    - `replayProtection / dominantRhythm / replayMode / targetMatches`

这更接近“记忆更新不是简单覆盖，而是竞争性重整固”。

### 7. reality monitoring / certainty control

当前回复校验器也开始显式检查：

- 回复是不是用了过强的确定性口吻
- 这份确定性是否真的有 `verified` 支撑
- 当前相关记忆是否还只是 `derived / inferred / perceived / reported`
- 当前相关记忆是否仍处在 `hot / stabilizing / destabilized`
- 哪一句话在过度确定、哪一句话在冒充“已证实”

这一步不是为了把回复写得更像论文，而是为了更接近现实里的来源监测：  
不要把推断说成事实，也不要把刚被重新激活、尚未稳定的记忆说成定论。

### 8. proposition-level evidence binding（当前仍是启发式实现）

这轮继续补的是“回复里的 proposition，到底被哪几条证据撑住”。

当前不是完整自然语言命题逻辑器，而是显式 proposition object 的工程版本：

- 会把回复拆成句子
- 会从句子里抽 `subject / predicate / object`
- 会补第一版 `discourseState`
  - 把 `他 / 她 / 这个建议 / 这一步` 之类的代词或指代回绑到稳定 referent
 - 这轮又把这部分拆成了更明确的工程层：
  - `proposition-normalizer`
  - `discourse-graph`
- proposition 现在会带更完整的 IR：
  - `arguments`
  - `modality`
  - `quantifier`
  - `tense`
  - `evidentiality`
  - `counterfactual`
  - `discourseRefs`
  - `canonicalText`
  - `subjectResolution`
  - `normalization`
  - `sourceSpan`
  - `epistemicStatus`
- 否定和反事实现在会被显式保留：
  - `polarity=negated`
  - `counterfactual=true`
- 这轮又补了第一版：
  - `至少两项 / 多数 / 大多数 / 部分 / 少数`
  - `其中一项 / 另一项 / 前者 / 后者`
  - 跨段里的 `预计两小时后补确认` 这类省略主语句
- 会识别结构性 claim：
  - `agentId`
  - `parentAgentId`
  - `walletAddress`
  - `did`
  - `role`
  - `displayName`
  - `authorizationThreshold`
- 会把句子和：
  - 身份事实
  - Passport memory
  - local knowledge hits
  逐条打分绑定
- 回复校验器现在不只看“全局有没有 verified”
  - 还会看“这句话绑到的支撑里有没有 verified 或 identity support”
  - 也会看“这个 proposition 本身有没有足够支撑”
  - 并且会单独报 `proposition_binding_gap / proposition_reality_gap`

所以系统已经从“整段回复大概像是有来源”推进到了：

- “这句话具体绑到了哪些支持项”
- “这句里抽出的 proposition 是什么”
- “这个 proposition 的支撑来自哪类 memory”

但这里要把边界说死：

- 这不等于通用 proposition grounding 已经完成
- 这不等于完整命题逻辑、否定 scope 处理、量词处理和 discourse grounding 已完成
- 它更接近“显式 proposition binding 第一版”，不是最终版
- clause-level parser 这轮又补了一个实际收口
  - 不再把中文里的裸 `再` 当成通用断句边界
  - 避免 `先补验证再推进` 这类 recommendation 被错误截断成局部 proposition
- recommendation 这类命题现在也会区分 `decided / confirmed`
  - 只有 `decision_provenance` 带外部确认时，才允许 recommendation proposition 进入 confirmed 路径
  - 如果 proposition 已绑定到 `confirmed + verifiedEquivalent` 支撑
  - proposition 层现在也会同步反映 `confirmed`
  - 这轮又把 confirmation 的工程约束继续收紧：
  - 会显式写 `authorityLevel / freshness / stale`
  - reconciliation 会区分 `high_authority_rejected / multi_system_confirmed / partially_confirmed / stale_confirmed / confirmation_timeout`
  - 还新增了 `match.confirmation_lifecycle`
  - 会把 adapter request 记录成 `pending / confirmation_timeout / resolved`
  - verifier 会把这层 lifecycle 当作 proposition-level support 的一部分，而不是只看最终 confirmation 条目
  - 这轮又把 ATS / scheduler / human_review 推进成了独立 adapter event source
  - OpenNeed 写入单条 adapter event 前，会先读 Passport 当前 `decision_provenance / confirmation_lifecycle / external_confirmation`
  - 然后再把单条 event merge 成新的 current state，而不是只接受一次性聚合快照
  - 这轮又新增了 OpenNeed `/api/ai/passport-adapter-ingest`
  - 外部 adapter 至少已经可以通过 HTTP ingest route 把单条 request / confirmation event 打进 queue
  - 而且 queue 路径也开始和 persist 路径一样，先做 remote current-state hydration 再写 Passport
  - 这轮又把 ingest 面往前拆成了 adapter-specific protocol route：
  - `/api/ai/passport-adapter-ingest/ats`
  - `/api/ai/passport-adapter-ingest/scheduler`
  - `/api/ai/passport-adapter-ingest/human-review`
  - 各 route 会先把 payload 归一化，再走同一条 current-state merge / verifier 更新链
  - 这轮还新增了 `/api/ai/passport-adapter-ingest/replay`
  - 用来把乱序 adapter event 按 `occurredAt` 顺序重放，检查当前 decision / action 是否会按时间线恢复
  - 这轮又新增了 ingress contract 层：
  - adapter-specific route 现在支持 HMAC 签名、timestamp 和 event id
  - `key-id` 现在也真正参与选钥匙，而不是只留在 header 里摆设
  - 各 route 还开始具备 adapter-specific schema gate
  - OpenNeed 侧也开始记录本地 adapter journal，并对 `queued / completed` 的重复 event 做幂等忽略
  - journal 这轮又开始记录 `auth_rejected / schema_rejected / invalid_json`
  - 并新增了 `/api/ai/passport-adapter-ingest/journal` 供外部拉取 ingress 审计结果
  - 这轮又把 adapter-specific version contract 接进 route-level 校验
  - `protocol / contractVersion / schemaVersion` 现在不再只是附属字段
  - 显式传错版本时会在入口直接被拒绝
  - 成功请求的 contract 和 journal record 也会带出版本元数据
  - 这轮又把 schemaVersion 做成了“受控兼容窗口”
  - 目前只兼容上一代 schema，并会显式留下 `receivedSchemaVersion / compatibilityMode / migrationApplied`
  - 这意味着旧版事件不再只是“过了就算”，而是会被标记成 legacy-migrated trace
  - 这轮又把 contractVersion 推到了 `v2`
  - `v1` 现在进入 legacy upgrade path
  - route / journal 会显式留下 `receivedContractVersion / contractCompatibilityMode / contractMigrationApplied`
  - 这轮又新增了 `/api/ai/passport-adapter-ingest/journal/export`
  - 会把筛选后的 ingress record 导成 `NDJSON`
  - 还新增了 `/api/ai/passport-adapter-ingest/recover`
  - 用来把 journal 里的 adapter event 重放到新的 target agent，恢复 downstream current state
  - recover 这轮还支持 `untilOccurredAt / afterOccurredAt / eventIds[]`
  - 也就是 current state 可以先恢复到 partial，再补最后一跳
  - recover 这轮又开始显式报告 `skippedCount / failedCount / partialFailure`
  - mixed good/bad journal stream 下，`stopOnError=false` 会跳过 unreplayable record，继续恢复剩余 completed event
  - 这轮又补了 mixed stream partial rebuild
  - 坏记录、旧版记录、重复记录可以混在一起恢复
  - `untilOccurredAt` 会先把 current state 推到 partial
  - 再由 `afterOccurredAt` 把最后一跳 confirmation 补齐
  - 这轮又给 recover 加了 `cursor/checkpoint` 近似机制
  - partial rebuild 不再只能靠时间戳
  - 而是可以拿上一次 recover 返回的 `resumeAfterCursor` 继续
  - 这轮又给 journal 加了稳定 `sequenceId`
  - recover 现在还能返回 `resumeAfterSequenceId`
  - 也就是同一批 adapter event 可以按稳定 journal sequence 续跑，不必自己外推时间戳
  - 这轮还新增了 `/api/ai/passport-adapter-ingest/journal/snapshot`
  - 以及 `/api/ai/passport-adapter-ingest/recover/snapshot`
  - 也就是 downstream current state 已经能从 portable snapshot 恢复
  - 这轮又把 `/journal/export` 产出的 `NDJSON` 也接进了 recover
  - 现在不只 JSON snapshot 可以恢复，`NDJSON export` 也可以直接恢复
  - 同时补了 `snapshot parseSummary`
  - 坏 JSON 行和重复行现在会被显式统计，而不是悄悄吞掉
  - 这轮又把 `manifest/checksum` 和 `checkpointArtifact` 接进了 `/recover/snapshot`
  - manifest hash 不匹配会直接报 `snapshot_manifest_mismatch`
  - partial recover 返回的 `checkpointArtifact` 可以直接续跑，不必再手工拼 `afterCursor / afterSequenceId`
  - 这轮同时把 contract/schema 兼容逻辑拆进了本地 registry
  - 目的是把 route-level version window 从单文件里拆开，而不是继续堆 if/else
  - 如果外部 confirmation 存在但单条 confirmation 没写 `status`
  - OpenNeed 侧这轮会在 `confirmed` / feedback override 场景下做受限继承，避免确认梯子被错误降级
  - 这轮又把“高权威拒绝优先”显式化
  - 如果高权威 fresh reject 压过低权威 confirmed
  - 当前 decision 会直接落到 `rejected`，action 落到 `blocked`
  - 这轮又给 replay 加了保守的 `target_state_precedence_guard`
  - 如果 target agent 已经有 fresher 且更强的当前状态
  - older replay 会被显式跳过，而不是继续重写 current state
  - 同时还补了伪多实例 reality check
  - shared journal path 下跨实例可见，isolated journal path 下不可见
  - 也就是说当前实现只具备“共享本地 journal 的跨进程可见性”，不是分布式恢复或跨节点一致性
- 对 `match.decision_provenance / match.action_execution / match.event_graph / match.external_confirmation` 这类当前状态语义
- 对 `match.confirmation_lifecycle` 这类当前 adapter lifecycle 状态
  - Passport 现在会把更旧的同字段 semantic trace 标成 superseded
  - 这样多轮恢复时更接近“当前活动痕迹主导”，而不是让旧 planned trace 反复抢权
  - 这轮还补了 `lifecycle activity` 权重
  - 让 `confirmation_timeout / pending / partially_confirmed` 这类当前活跃状态，能压过旧的 `none`
  - 同时把 `action_execution.status=blocked` 抬成显式当前动作优先级
  - 目的是避免已经被高权威拒绝覆盖的旧 `planned` action 继续抢 current state
  - verifier 这轮也补了当前决策覆盖规则
  - 如果旧 recommendation 已被新 decision 改写，会显式报 `proposition_superseded_by_current_decision`
 - Passport 的 event graph 路径绑定这轮也收紧了
  - 节点匹配不再由整图共享 supportId 直接主导
  - 改成文本相似度优先，support overlap 只做有限加权
  - 这样 `memory_focus -> recommendation` 这类 confirmed 因果路径才不会被图里的其他节点抢走

## 不是完全等价，但比上一轮更接近

这轮依然不能说“等于人脑”。

因为我们还没有：

- 持续身体输入
- 激素/代谢层
- 真正的睡眠期离线整固
- 连续感觉运动闭环
- 原生外部系统事件总线与分布式确认生命周期
- 原生 ATS / scheduler / human-review 入站协议和 durable replay 总线
- 原生外部签名信任链、跨实例幂等表和 durable broker 恢复编排
- 集中式 ingress audit / key rotation service / replay checkpoint substrate
- 集中式 journal export / data lake / downstream audit pipeline
- 通用 schema registry / 自动版本协商 / 统一迁移总线
- 通用 contract registry / 多版本双写 / durable replay cursor substrate
- durable sequence offset / broker cursor / distributed checkpoint substrate
- durable NDJSON import/export pipeline / checksum-backed audit replay / snapshot transfer substrate
- durable checkpoint artifact store / replay cursor lease / recovery control plane
- 分布式 current-state 仲裁 / 跨实例幂等表 / 多节点 replay precedence 协议

但和前一版相比，系统已经从：

- 只有记忆分层
- 只有单次 live 闭环

推进到了：

- 记忆会被打标签
- 会被启发式调制
- 会被启发式分配权重
- 会被稳态缩放
- 会被回放巩固
- 会在 competing traces 间根据 prediction error 选择“改写 / 保留分歧”
- 会把句子级确定性绑定回具体支持项
- 会通过 concurrency / feedback / soak 三类 live E2E 反复验证当前决策能否收敛
- 这轮又补了 `restart-recovery / fault-injection` 两条 live E2E
  - 前者验证重启后 ledger / current decision 是否还能恢复
  - 后者验证网络失败不能假成功，陈旧低权威 confirmation 不能假 confirmed
- 这轮又补了 `drift / replay-reconsolidation / manual-correction` 三条 live E2E
  - drift 验证旧 trace 不会在长跑后抢回当前 confirmed decision
  - replay 验证离线 replay 不会把当前 recommendation 错写坏
  - manual-correction 验证人工覆盖后旧 recommendation 会被显式压制
- 这轮又补了 `confirmation-precedence`
  - 验证低权威 adapter confirmed 不能压过高权威人工 reject
  - verifier 会显式报 `proposition_high_authority_rejection`
- recommendation 的 confirmed 路径也开始支持 `multi-source confirmation`
- 2026-04-08 这轮又把 Passport 的连续控制器往前推了一步
  - 新增 `interoceptive-state.js`
  - 新增 `neuromodulators.js`
  - 新增 `oscillation-scheduler.js`
  - 新增 `replay-orchestrator.js`
  - 新增 `cognitive-dynamics-controller.js`
- 它们现在会把原来的：
  - `fatigue / sleepDebt / uncertainty / rewardPredictionError`
  - 继续整合成：
  - `interoceptiveState`
  - `neuromodulators`
  - `oscillationSchedule`
  - `replayOrchestration`
- 这些结果已经进入：
  - Passport runtime `continuousCognitiveState`
  - context builder `CONTINUOUS COGNITIVE STATE`
  - reasoner 的 runtime state hints
  - sleep-like replay trace 的 `cognitiveStateSnapshot`
- 这轮又不只停在“把状态暴露出来”
  - offline replay 的组选优现在会直接吃 `traceClassBoost / modulationBoost / taskSupportScore`
  - replay 生成的 semantic record 会带 `replayDrivers`
  - 被离线回放选中的原始痕迹也会写 `lastOfflineReplayDrivers`
  - preference arbitration 现在会回看最近被 supersede 的 `stable_preferences`
  - 并在仲裁结果里留下：
    - `payload.arbitration`
    - `lastPreferenceArbitrationDrivers`
- 这部分现在主要通过回放链和 live E2E 观察：
  - `sleepPressure`
  - `dopamineRpe`
  - `acetylcholineEncodeBias`
  - `currentPhase`
  - `replayMode`
  - `reconsolidation drivers`
  - `preference arbitration`
  - `offline replay drivers`

但这里也必须收紧表述：

- 这不是生物学真实 neuromodulator 模型
- 这不是生物学真实 oscillation scheduler
- 这不是 hippocampus-PFC-basal ganglia 的连续动力学网络
- 它只是把 Passport 从“静态评分器”往“连续状态调制器”推进了一步

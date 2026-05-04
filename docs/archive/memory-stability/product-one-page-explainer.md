# 记忆稳态引擎一页说明

更新时间：2026-04-23

## 一句话

记忆稳态引擎不是一个新大模型，而是一套放在大模型和产品之间的“记忆稳定中间层”：它负责把长任务里的关键记忆钉住、监控上下文是否快坍缩、提前压缩和重锚，并要求真正纠偏动作留下审计记录。

接地气说：大模型像一个很聪明但会被长聊天挤乱笔记的人；记忆稳态引擎像旁边的项目秘书，负责把最重要的便签贴牢、把旧稿和假线索扔掉、在快乱的时候提醒整理桌面。

## 它不是哪些东西

- 它不是 DeepSeek、Kimi、豆包、千问、Ollama 的竞品或替代品。
- 它不训练或修改这些模型的参数。
- 它不证明裸模型可以一次吃下 20000K prompt。
- 它不在本地 readiness 检查里调用 provider 或联网跑大模型。
- 它目前是本线程本地交付包，不代表已经接入任何真实产品源码；产品级落地需要目标产品 adapter 显式接入并另跑产品回归。

## 解决的痛点

| 行业痛点 | 普通说法 | 本项目的解决方式 |
|---|---|---|
| 长上下文坍缩 | 聊太久以后，模型开始忘前面的关键约束。 | 用关键记忆锚点、在线稳态分和纠偏阈值持续监控。 |
| 中段遗忘 | 重要信息夹在一大段上下文中间，模型容易漏看。 | 根据模型画像调整记忆放置，避免关键记忆长期卡在中段。 |
| 旧记忆污染 | 旧版本、假候选、相似搜索结果混在一起，模型可能捡错。 | managed-memory 先本地抽取权威记忆，丢弃 legacy、decoy、stale state。 |
| 上下文太大太贵 | 不能把几十万甚至几千万 token 硬塞进模型。 | 先分块、抽取、过滤、压缩、重锚，再把小工作上下文交给模型。 |
| 纠偏不可追责 | 系统说“修了记忆”，但不知道谁修、依据哪份状态修。 | adapter 执行后必须写 correction execution event，绑定源快照 hash 和调用 ID。 |
| 证据容易被误读 | API 报错常被误写成模型能力失败。 | benchmark 把 execution failure 和 model-fail 分开统计。 |

## 已有本地数据

这些数据只代表当前本线程样本和报告，不代表所有场景、所有模型或真实线上流量。

| 测试 | 裸用模型 | 加记忆稳态干预 | 说明 |
|---|---:|---:|---|
| 128K hard / 48 anchors / n=5 受控合成样本均分 | 96% | 100% | 同一主力模型前后对照，非线上流量，不做横向模型胜负排名。 |
| 128K hard / 48 anchors / n=5 样本达到 100% 的组数 | 0/5 | 5/5 | 只表示本轮 5 组样本的评分结果，不外推到所有任务。 |
| 128K hard / 48 anchors / n=5 状态恢复均分 | 90% | 100% | 主要提升是任务状态恢复和污染控制。 |
| 20000K managed-memory / n=5 provider-scored 平均源语料 tokens（不是模型输入） | 20,049,529 | 20,049,529 | 受控合成材料规模相同，非线上流量，不代表裸模型窗口。 |
| 20000K managed-memory / n=5 平均注入工作上下文 | 不适用 | 3,490 tokens | 不是把 20000K 全塞给模型，而是压成小上下文。 |
| 20000K managed-memory / n=5 平均模型输入 | 不适用 | 4,235 tokens | provider 实际看到的是压缩后的工作上下文。 |
| 20000K managed-memory / n=5 平均压缩节省率 | 不适用 | 99.98% | 本地分块、抽取、过滤、压缩后的结果。 |
| 20000K managed-memory / n=5 评分为 100% 的样本数 | 不适用 | 5/5 | 本轮 provider scored runs 的受控样本结果，不代表裸模型窗口能力。 |
| 20000K 高冲突 managed-memory / provider-linked / n=1 | 不适用 | 本轮样本 1/1 | 192 anchors，过滤 576 个 legacy、192 个 decoy、9 个 stale state；只作小样本复验证据。 |

推荐引用入口：

- `benchmarks/results/engine-stack-vs-bare-2026-04-20T07-40-58-527Z.md`
- `benchmarks/results/managed-memory-engine-only-20000k-5seeds-auto-summary.md`
- `benchmarks/results/managed-memory-engine-only-2026-04-20T16-01-58-675Z.md`
- `benchmarks/results/INDEX.md`

## 技术路径

1. **Offline Benchmark，离线评测**
   - 先用测试脚本压模型：不同上下文长度、不同记忆位置、不同污染强度。
   - 接地气说：先别急着上线，先给模型做压力体检。

2. **ModelProfile，模型画像**
   - 生成 `CCRS / ECL_0.85 / PR / MidDrop`。
   - `CCRS` 是抗坍缩总分；`ECL_0.85` 是还能保持 85% 能力的有效上下文长度；`PR` 是位置鲁棒性；`MidDrop` 是中段塌陷程度。
   - 接地气说：这就是每个模型的“记忆体检报告”。

3. **Runtime Profile，运行时策略画像**
   - 把 benchmark 结果写进 `runtime/memory-stability-runtime-profile.json`。
   - 它记录模型弱点、纠偏阈值、managed-memory 预算、证据下限和 7 项机制覆盖。
   - 接地气说：把体检报告变成开车规则，比如“这个模型容易累，就早点休息、少装东西”。

4. **Fail-Closed Loader，失败即关闭加载器**
   - 产品启动前先校验 profile、schema、snapshot。
   - 只要字段漂移、路径越界、隐私规则失败，就拒绝加载。
   - 接地气说：刹车灯坏了就不让车上路。

5. **MemoryAnchor，关键记忆锚点**
   - 每条关键记忆都有 `memory_id`、重要性权重、来源、位置、上次验证状态。
   - 接地气说：把“绝不能忘的事”做成一颗颗钉子。

6. **RuntimeMemoryState，运行时记忆状态**
   - 每轮或按事件计算 `V_t / L_t / R_pos,t / X_t / S_t / C_t`。
   - `V_t` 看关键记忆还记不记得；`L_t` 看上下文是否快塞满；`R_pos,t` 看关键记忆是否卡在危险位置；`X_t` 看新旧记忆冲突比例；`S_t` 是稳态分；`C_t` 是坍缩风险。
   - 接地气说：仪表盘告诉你“现在记忆稳不稳、是不是快要乱了”。

7. **CorrectionPlan，纠偏建议**
   - `C_t > 0.20`：轻度，建议重锚关键记忆、提高注入优先级。
   - `C_t > 0.35`：中度，建议重写工作摘要、压缩低价值历史。
   - `C_t > 0.50`：强度，建议从权威记忆刷新、做冲突消解。
   - 接地气说：它只说“该整理桌面了”，不自己替产品动手。

8. **PlacementStrategy，动态放置策略**
   - 如果模型中段容易遗忘，就避免把关键记忆长期放中间。
   - 如果上下文接近有效上限，就提前压缩。
   - 如果模型抗坍缩分低，就减少单轮记忆密度。
   - 接地气说：重要便签不要夹在一大摞纸中间，要放到更容易被看到的位置。

9. **Managed-Memory，托管记忆链路**
   - 本地先把超大原始材料分块。
   - 抽取权威状态和关键锚点。
   - 丢弃旧版本、假候选、过期状态。
   - 压缩成小工作上下文。
   - 通过 preflight gate 后再交给 provider 验证。
   - 接地气说：不是把整个仓库扔给模型，而是先由本地秘书整理出一页靠谱提纲。

10. **Redacted Snapshot，脱敏快照**
    - 长期保存时只留 hash、状态和短摘要，不留关键记忆原文。
    - 接地气说：留指纹，不留正文。

11. **Correction Execution Event，纠偏执行事件**
    - 真正执行纠偏必须由产品 adapter 明确触发。
    - 事件必须证明 `explicit_execution=true`、`automatic_by_loader=false`、`model_called=false`、`raw_content_persisted=false`。
    - 接地气说：谁真的动手修了记忆，要开收据。

12. **Product Adapter Rehearsal，产品适配器干跑**
    - 用 product_adapter 身份干跑 none、medium、strong 三类纠偏事件。
    - 必须验证 provenance、preflight、placement、post-runtime、idempotency、privacy 和 rollback 证据。
    - 接地气说：正式装车前，先在车间演练一遍“谁执行、执行前查了什么、能不能去重、出事能不能回滚”。

13. **Readiness Gate，上线前本地门禁**
    - 一条命令检查代码语法、证据链接、runtime profile、快照、loader、纠偏事件、adapter 契约、交付包、冷启动和反夸大边界。
    - 接地气说：上线前不靠拍脑袋，而是让机器把该查的清单扫一遍。

## 当前成熟度

本线程本地交付包已经进入可封板状态：runtime、schema、loader、adapter contract、product adapter rehearsal、redaction、correction event、benchmark evidence、readiness gate 都已经闭环。

还差一步是产品级接入：未来用户明确要求切到真实产品源码时，由目标产品 adapter 读取 runtime profile、执行纠偏动作、写入审计事件并另跑产品回归；具体仓库顺序只保留在内部接入清单。

## 对外推荐说法

推荐说：

> 记忆稳态引擎是一套面向长任务和多轮上下文的记忆稳定中间层。它不替代大模型，而是通过离线画像、在线评分、关键记忆锚点、managed-memory 压缩、纠偏建议和审计事件，降低长对话里遗忘、串线、旧记忆污染和证据不可追责的风险。

禁止口径示例：

> 不要说它是新训练的大模型。
> 不要把 managed-memory 证据说成裸模型单次窗口能力。
> 不要说它已经完成真实产品接入。
> 不要做横向模型胜负叙述。

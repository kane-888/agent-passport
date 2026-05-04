# 记忆稳态引擎内部运行时策略画像

画像原始生成时间：2026-04-20T16:05:13.779Z

最近本地验证时间：2026-04-23。最近只修订人读 Markdown 表格展示和边界说明，补充 `Failure Rate`、`Scored Cases` 与防误读口径，不改变 `memory-stability-runtime-profile.json` 的原始画像生成时间。

## 作用

这份文件把 benchmark 结果转成运行时可读的内部策略画像，只用于调参、门禁和接入校验，不作为对外能力宣称。普通说法：测试报告不再只是躺在目录里，而是变成引擎运行时决定“何时建议压缩、何时建议重锚、何时建议刷新权威记忆”的依据；真正执行由产品 adapter 完成。

## 和运行时快照的关系

- `memory-stability-runtime-profile.json` 是离线画像：回答“这个模型大概能扛多长上下文、什么时候该提前压缩、风险阈值是多少”。
- `examples/*-runtime-snapshot.json` 是在线状态：回答“这一轮会话现在稳不稳、风险多少、应该触发哪级纠偏”。
- `schemas/memory-stability-runtime-profile.schema.json` 和 `verify-memory-stability-profile.mjs` 会检查画像字段、权重、阈值、预算、证据文件存在性和模型画像唯一性，防止产品接入后字段漂移。
- `memory-stability-engine.mjs` 读取 profile，再结合当前 `ctx_tokens`、关键记忆锚点和冲突数量，生成 runtime snapshot 里的 `runtime_state`、`correction_plan` 和 `placement_strategy`。

接地气说：profile 像体检报告，snapshot 像实时心电图。体检报告决定预警线，实时心电图决定这一刻要不要干预。

## 模型画像

这张表是内部运行时调参依据，不是模型榜单，也不是对外宣传结论。尤其是 `ollama:gemma4:e4b` 必须和 `Failure Rate`、`Scored Cases` 一起看。

| Provider | Model | CCRS | ECL_0.85 | PR | MidDrop | Failure Rate | Scored Cases | Hint |
|---|---|---:|---:|---:|---:|---:|---:|---|
| deepseek | deepseek-chat | 100% | 8,192 | 100% | 0% | 0% | 6/6 | standard_reanchor_policy |
| ollama:gemma4:e4b | gemma4:e4b | 100% | 2,048 | 100% | 0% | 50% | 3/6 | compress_early_and_keep_anchor_density_low |

## 内部证据摘要

下面数字只说明本线程受控样例和本地链路复验结果；引用时必须带上 raw/context 规模、anchors、seed、provider-linked/inspect 边界，不能说成裸模型窗口能力。

| Evidence | Value |
|---|---:|
| 128K / 48 anchors engine score | 100% |
| 128K / 48 anchors engine failure rate | 0% |
| 20000K managed-memory avg score | 100% |
| 20000K managed-memory pass rate | 100% |
| 20000K managed-memory avg injected tokens | 3,490 |
| High-conflict inspect pass rate | 100% |
| High-conflict provider-linked score | 100% |
| High-conflict provider linked runs | 1 |
| High-conflict provider unlinked runs | 0 |

## 7 项闭环覆盖

| Item | Status | Runtime Hook |
|---|---|---|
| 关键记忆探针 | covered | sample memory_anchors and update v_t |
| 在线量化分数 | covered-by-policy | compute S_t and C_t from V_t/L_t/R_pos_t/X_t |
| 自动纠偏触发 | covered-by-policy | emit correction plan for adapter execution: re-anchor, summary rewrite, authoritative refresh |
| 离线画像 | covered | load ModelProfile by provider/model |
| 动态放置策略 | covered-by-policy | adjust memory placement and density before prompt injection |
| 权威记忆刷新 | covered | recommend authoritative state reload when C_t > tau3 or conflict rises; adapter executes explicitly |
| 长上下文评测到运行时闭环 | covered | regenerate this file after benchmark runs and load it at startup |

## 运行时阈值

- 轻量纠偏：C_t > 0.2
- 中度纠偏：C_t > 0.35
- 强纠偏：C_t > 0.5
- managed-memory 注入预算：<= 9,000 estimated tokens

## 来源报告

- benchmarks/results/context-collapse-2026-04-19T17-22-51-450Z.rerendered.json
- benchmarks/results/internal-memory-stability-2026-04-19T18-30-40-418Z.rerendered.json
- benchmarks/results/engine-stack-vs-bare-2026-04-20T07-40-58-527Z.json
- benchmarks/results/managed-memory-engine-only-2026-04-20T08-31-43-861Z.json
- benchmarks/results/managed-memory-engine-only-2026-04-20T08-36-58-640Z.json
- benchmarks/results/managed-memory-engine-only-inspect-2026-04-20T13-02-31-652Z.json
- benchmarks/results/managed-memory-engine-only-2026-04-20T16-01-58-675Z.json

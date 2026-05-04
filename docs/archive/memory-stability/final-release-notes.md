# 记忆稳态引擎最终验收摘要

更新时间：2026-04-22

## 当前状态

本线程内的记忆稳态引擎交付包已经进入本地可封版状态。这里的“可封版”只代表 `/Users/kane/Documents/ai思维模型` 内的 runtime、schema、loader、adapter contract、product adapter rehearsal、handoff、delivery package、readiness 和 cold-start 门禁可验收，不代表已经接入 `/Users/kane/Documents/openneed` 或 `/Users/kane/Documents/agent-passport` 真实源码。

接地气说：这套东西现在像一套已经装箱、贴好安全标签、能本地复验的“记忆稳定工具包”。它还没有被安装进真实产品车里。

归档说明：本摘要保留的是 `ai思维模型` 线程封板时的状态，不是当前 `agent-passport` 仓库的运行指北。文中提到的 `runtime/*`、`benchmarks/*` 命令和门禁，应理解为历史封板记录；当前仓库的真实运行、验证和回归入口，以 `/Users/kane/Documents/agent-passport/package.json`、`/Users/kane/Documents/agent-passport/scripts/`、`/Users/kane/Documents/agent-passport/tests/` 为准。

## 2026-04-22 封板复核

本文件仍是主封板摘要；最终封板复核日志已归档到 `runtime/go-live-seal-log.md`，机器生成的当前自检结果见 `runtime/go-live-readiness-report.md`。这次复核没有新增大功能，主要确认三件事：

- 没有把记忆稳态引擎写成新大模型、模型替代品、裸模型 20000K 能力或真实产品源码已接入。
- benchmark 证据仍以 `benchmarks/results/INDEX.md` 为推荐入口，旧失败报告和接口上限探测报告只作审计留存。
- `runtime/memory-stability-runtime-profile.md` 的人读画像表已补 `Failure Rate` 和 `Scored Cases`，避免 `ollama:gemma4:e4b` 被误读成 8K 长上下文完全稳定。

## 已完成

下面的“已落地”都指本线程本地交付包内的 runtime、schema、loader、adapter contract、product adapter rehearsal、handoff、delivery 和 verifier 已补齐契约、样例和本地验证，不表示真实产品源码已经接入或线上已经启用。

- 7 项核心机制已落地为本地契约、样例和验证脚本：关键记忆探针、在线量化分数、自动纠偏触发（只做风险分级与纠偏建议生成，不自动执行产品动作）、离线画像、动态放置策略、权威记忆刷新、长上下文评测到运行时闭环。
- runtime profile 已机器可读，包含模型画像、纠偏阈值、managed-memory 预算、证据下限和 6 个上线闸门。
- fail-closed loader 已落地：profile、snapshot 或路径边界失败时拒绝加载，不继续注入坏策略。
- shared validator 已落地：profile、snapshot、redaction、correction event、loader、CLI verifier 使用同一套契约判定。
- runtime engine 已落地：本地计算 `S_t / C_t`、纠偏等级和 placement strategy，不调用模型、不自动执行纠偏。
- redacted snapshot 已落地：长期日志可以只保存 hash、短摘要和状态，不保存关键记忆原文。
- correction execution event 已落地：把“建议动作”和“实际执行”分开审计，并用 `source_snapshot.source_snapshot_sha256` 绑定源快照内容。
- adapter contract 已落地：产品 adapter 可以从 redacted snapshot 生成 none/medium/strong 三类合规执行事件，且 `model_called=false`、`raw_content_persisted=false`，`summary` / `notes` 使用允许的脱敏模板。
- product adapter rehearsal 已落地：以 product_adapter 身份干跑 none/medium/strong 三类事件，并验证 provenance、preflight、placement receipt、post runtime、idempotency replay、privacy scan 和 rollback drill。
- product adapter handoff 已落地：真实产品源码接入前的顺序、禁止事项、审计字段、证据口径和失败处理已经单独成文。
- delivery package、manifest、consistency freeze、cold-start、readiness 已串成一个本地交付闭环。

## 证据摘要

- 128K hard / 48 anchors / 5 seeds：用于说明“同一模型裸用 vs 记忆稳态干预”的前后差异。
- 20000K managed-memory / 5 seeds：用于说明本地分块、抽取、压缩、重锚后的 managed-memory 链路可以把大规模原始材料压成小工作上下文后再验证。
- 20000K high-conflict inspect/provider-linked：用于说明高冲突场景下，先本地 inspect gate，再交给同一绑定 provider 复验。
- `benchmarks/results/INDEX.md` 是唯一推荐证据入口；旧 `.md` 报告如果存在标题标签或 execution failure 历史问题，只作为审计留存，不作为首选展示材料。

## 不能声称

- 不能说这是新大模型。
- 不能说它是 DeepSeek、Kimi、豆包、千问或 Ollama 的替代品。
- 不能把 managed-memory 证据说成裸模型单 prompt 窗口能力。
- 不能说本地 readiness/cold-start 调用了 provider 或跑了大模型。
- 不能说产品源码已经接入完成。
- 不能把 DeepSeek、Kimi、豆包、千问写成横向模型胜负叙述里的对手。
- 不能把 `CorrectionPlan.actions` 当成已经执行的动作。

## 归档时的最终本地验收命令

下面是归档线程封板时记录的历史命令清单，不应直接当作当前 `agent-passport` 仓库的正式门禁入口。

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

归档线程里，这些命令默认不触网、不跑大模型、不切源码仓库。`benchmarks/check-go-live-readiness.mjs` 是父门禁；cold-start 会跳过它以避免递归。若要判断当前仓库现在该跑什么，以 `scripts/`、`tests/`、`package.json` 为准。

## 失败处理

- 任一验收命令失败：停止封版，不进入真实产品源码接入。
- release notes 或 handoff 出现反夸大边界漂移：先修文档和 verifier，再重新跑 readiness。
- profile/schema/snapshot 失败：先修 runtime 契约，不在产品侧绕过。
- correction event 失败：不能把纠偏动作记为成功执行。
- evidence floor 失败：不得对外引用为正式能力证据。

## 后续真正切仓库时

只有用户明确要求切真实源码仓库时，才进入下一阶段。推荐顺序仍然是：

1. 先切 `/Users/kane/Documents/agent-passport`，接底层 runtime adapter。
2. 让 adapter 显式执行纠偏并写合规 correction execution event。
3. 再切 `/Users/kane/Documents/openneed`，只作为业务侧消费者读取后台稳态摘要。

没有明确切仓库请求前，本线程继续只维护记忆稳态引擎交付物；本文也只作为归档封板说明，不再充当当前 `agent-passport` 仓库的直接执行真值。

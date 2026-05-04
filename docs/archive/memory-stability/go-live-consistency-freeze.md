# 记忆稳态引擎交付一致性冻结

这份文件记录当前线程内上线前交付包的冻结口径。它的作用不是新增能力，而是防止后续继续推进时出现“manifest 写一套、README 写一套、readiness 报告又是另一套”的漂移。

归档说明：这里冻结的是 `ai思维模型` 线程当时的交付包、自检命令和文档口径，不是当前 `agent-passport` 仓库的直接执行清单。若本文的历史 `runtime/*`、`benchmarks/*` 命令与当前仓库不一致，以 `/Users/kane/Documents/agent-passport/package.json`、`/Users/kane/Documents/agent-passport/scripts/`、`/Users/kane/Documents/agent-passport/tests/` 为准。

## 冻结边界

- 当前目录只维护记忆稳态引擎 runtime、benchmark、schema、样例、交付包和自检门禁。
- 当前目录不修改 `/Users/kane/Documents/openneed` 或 `/Users/kane/Documents/agent-passport` 真实源码。
- 当前 `agent-passport` 仓库的运行/测试真值不由本文定义；本文只冻结归档线程自己的历史口径。
- 记忆稳态引擎不是新大模型，也不是 DeepSeek、Kimi、豆包、千问或 Ollama 的替代品。
- loader、validator、delivery verifier、consistency verifier、cold-start verifier、readiness verifier 不触网、不跑大模型、不调用 provider。
- `CorrectionPlan.actions` 是建议动作；真实纠偏必须由产品 adapter 显式执行并写 `correction execution event`。
- `model_called=false`、`raw_content_persisted=false`、`loader_auto_executed=false`、`source_snapshot.source_snapshot_sha256` 是纠偏执行审计硬边界。

## 冻结命令

以下命令是归档线程当时要求同时出现在 `runtime/go-live-delivery-manifest.json`、`runtime/go-live-delivery-package.md` 和 `runtime/README.md` 的历史冻结清单，不应直接视为当前 `agent-passport` 仓库的正式命令真值：

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

冻结 artifact 数：manifest-tracked artifacts 固定为 29；冻结命令数：manifest required_commands 固定为 16。

## 冻结门禁

归档线程里，`benchmarks/check-go-live-readiness.mjs` 必须继续验证：

- `readiness local-only static scan`
- `runtime correction event negative cases`
- `runtime adapter contract`
- `product adapter rehearsal`
- `product adapter handoff`
- `final release notes`
- `self-learning governance proposal contract`
- `self-learning governance examples`
- `go-live delivery package`
- `go-live cold-start package check`
- `evidence floors`

cold-start 口径：声明 16 条 manifest commands，执行 15 条，跳过 `benchmarks/check-go-live-readiness.mjs` 这个父门禁以避免递归。

## 冻结验证

```bash
node runtime/verify-go-live-consistency-freeze.mjs
node benchmarks/check-go-live-readiness.mjs
```

`verify-go-live-consistency-freeze.mjs` 会结构化解析 manifest、冻结命令代码块、readiness 表格、readiness machine-readable JSON、seal log 数字摘要和 profile Markdown 表头；不是只看关键词是否出现。

同时它内置负向漂移样例，至少要能拒绝 manifest boundary/audit flag 漂移、artifact 路径或重复、命令顺序漂移、readiness PASS/表格/JSON 数字漂移、seal log 数字漂移，以及 profile Markdown 缺少 `Failure Rate` / `Scored Cases` 表头。

负向漂移检查采用常量化下限：readiness 至少要求 consistency freeze 拒绝 5 类坏样例；当前 verifier 内置 10 项 negative checks，并会把实际数量写入 readiness report 的机器可读摘要。

如果这两个命令 PASS，只能说明归档线程内的交付包、命令清单、边界文案和 readiness 报告仍然一致；不能据此推断当前 `agent-passport` 仓库仍以这些命令为执行入口。

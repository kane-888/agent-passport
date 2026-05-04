# 产品 adapter rehearsal gate

本文件固定“产品适配器干跑验收”的最小口径。它不接入真实产品源码、不触网、不调用模型，也不代表真实产品已经上线；它只证明记忆稳态引擎交给产品 adapter 的纠偏建议，可以被转换成合规的 correction execution event。

## 为什么要有这道 gate

只验证 `CorrectionPlan.actions` 还不够，因为那只是建议。真实产品上线前还必须证明：

- adapter 明确执行了动作，而不是 loader、validator 或 runtime engine 自动执行。
- 执行动作没有保存关键记忆原文、完整 prompt 或模型返回原文。
- 动作和源快照里的 `memory_id + content_sha256` 能绑定，不能伪造目标记忆。
- 同一个 `adapter_invocation_id` 重放时能命中幂等，不会重复产生副作用。
- 执行后能给出放置策略、状态重算、隐私扫描和回滚演练证据。

## 当前 rehearsal 覆盖

`node runtime/verify-product-adapter-rehearsal.mjs` 会用本线程内的 redacted snapshots 干跑三类事件：

- `none`：只记录继续监控。
- `medium`：重锚、提高注入优先级、摘要重写、压缩低价值历史。
- `strong`：在 medium 基础上增加权威记忆刷新和冲突消解。

每个 product adapter 事件必须带齐：

- `product_provenance`：目标仓库、adapter 版本、入口、契约版本、功能开关和环境。
- `preflight`：loader、profile schema、redacted snapshot、模型调用阻断、网络阻断、原文日志关闭和回滚可用性。
- `placement_receipt`：放置策略 hash、执行前后布局 hash、锚点移动量、注入 token 预算。
- `post_execution_runtime`：执行后快照 hash、计算时间、引擎版本、最终 `C_t` 和 `S_t`。
- `idempotency_replay`：重放次数、去重命中、副作用次数、第二次运行状态。
- `privacy_rollback`：隐私 sink 扫描、回滚演练、原文扫描通过和回滚通过。

## 必跑命令

```bash
node runtime/verify-product-adapter-rehearsal.mjs
```

这条命令是本地轻量 gate，只构造并校验审计事件，不写真实产品仓库，不请求 provider，不跑 benchmark。

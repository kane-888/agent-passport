# 真实产品源码接入目标

本文件仅在未来用户明确要求切到真实源码仓库时适用，不是当前线程的默认推进计划。接入线索是：优先把记忆稳态引擎核心接入 `/Users/kane/Documents/agent-passport`，OpenNeed 作为业务侧消费者接入 `/Users/kane/Documents/openneed`；当前未修改真实源码。

记忆稳态引擎不是新模型，也不是 DeepSeek、Kimi、豆包、千问或 Ollama 的替代推理内核；它只提供 runtime 策略、门禁、纠偏建议和审计契约。

本文件只回答“未来切哪个仓库、为什么先后顺序是这样”。具体 adapter 执行规则、审计字段、负向用例和验收命令以 `runtime/product-adapter-handoff.md` 为准，避免两份文档维护两套执行细则。

本文件里的 OpenNeed / Agent Passport README 说法和接入点是当前线程里的历史接入线索，不是实时源码事实。真正切仓库前必须重新读取对应真实仓库，再确认 README、脚本名、接口名和接入点没有变化；下面出现的仓库能力、命令和接口名都先按“待切仓库复核”处理。

强边界：下列候选项都是“未来切仓库后的复核线索”，不是当前源码事实；没有用户明确切仓库请求时，不得据此修改真实产品仓库。

## 未来为什么不是先接 OpenNeed

按当前线程历史记录，OpenNeed 是招聘与多 Agent 协作产品，后续可作为业务侧消费记忆稳态能力；但真实 README 是否仍保持这些约束，必须切仓库后重新复核。

接地气说：OpenNeed 是业务前台，负责招聘场景；它需要“用记忆”，但不应该把记忆底座本身长在业务页面里。

## 未来为什么核心先接 Agent Passport

按当前线程历史记录，Agent Passport 更接近运行时本地真值、记忆稳态、恢复与审计能力的底层引擎；下面这些只是未来候选接入点，必须切仓库后重新确认仍然存在：

- `npm run profile:memory-homeostasis`（待复核）
- `npm run verify:memory-homeostasis`（待复核）
- `GET /api/device/runtime`（待复核）
- `memoryHomeostasis`（待复核）
- runtime search / context builder / memory compactor / checkpoint / recovery（待复核）
- read-session 边界和审计视图（待复核）

接地气说：Agent Passport 更像“记忆和恢复中枢”；OpenNeed 更像“拿这个中枢能力去办招聘业务的应用”。

## 未来接入顺序（尚未执行）

1. **Agent Passport 核心接入**
   - 读取 `runtime/memory-stability-runtime-profile.json`
   - 启动时先走 fail-closed loader；profile 缺失、schema 校验失败、预算字段异常或快照契约失败时，停止稳态注入和纠偏建议加载
   - loader 只做本地 profile/schema/snapshot 校验，不调用 provider、不触网、不请求模型
   - 把 `ModelProfile`、纠偏阈值、managed-memory 注入预算、权威刷新策略接入切仓库后确认存在的记忆稳态模块；如果 `memoryHomeostasis` 已漂移，先更新接入点清单
   - 增加切仓库后确认存在的本地校验脚本，对 runtime profile 做 fail-closed 校验
   - 接入的是策略输入和门禁结果；loader/engine 不会执行权威刷新，`CorrectionPlan.actions` 只是建议动作，真正执行必须由 Agent Passport adapter 显式触发并记录审计事件
   - 执行细则不要在这里复制；按 `runtime/product-adapter-handoff.md` 跑 product adapter rehearsal、correction execution event 和冷启动验收
   - 最低审计边界仍必须满足：`adapter_invocation_id` 存在、`source_snapshot.source_snapshot_sha256` 可复算一致、`explicit_execution=true`、`automatic_by_loader=false`、`loader_auto_executed=false`、`model_called=false`、`raw_content_persisted=false`

2. **OpenNeed 消费接入**
   - 只通过后台 runtime / adapter 读取 Agent Passport 暴露的稳态摘要
   - 不在 OpenNeed 前端展示 Agent Passport 或底层引擎名
   - 把业务对话、招聘流程、agent-turn 的长上下文记忆请求交给后台稳态链处理

## 当前边界

本文件只确认接入目标，不直接修改两个真实源码仓库。真正切仓库实现时，应先进入：

```text
/Users/kane/Documents/agent-passport
```

然后再按需要补 OpenNeed 的后台消费层：

```text
/Users/kane/Documents/openneed
```

## 未来接入完成后的验收口径

- Agent Passport 能读取 runtime profile。
- Agent Passport 通过 fail-closed loader 读取 runtime profile，校验失败时不得继续注入或伪造成已验证状态。
- Agent Passport 的 memory homeostasis 校验能看到 7 项核心机制。
- 纠偏动作由产品 adapter 显式执行并审计，loader/engine 不自动调用模型、不自动刷新权威记忆库。
- 产品 adapter rehearsal 能在目标仓库接入前后通过，证明 provenance、preflight、placement、post-runtime、idempotency、privacy 和 rollback 证据没有丢。
- 每次真实纠偏都能追到一条 correction execution event；事件只保存 ID、源快照 hash、memory hash、动作状态和允许的脱敏模板摘要，不保存用户原文或完整 prompt。
- OpenNeed 不直接持有 managed-memory 细节，只消费稳定摘要或后台能力。
- 缺 key、不跑通 provider 的模型不得伪造成实测数据。

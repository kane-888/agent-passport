# Ledger 硬化与拆分收口报告

更新时间：2026-05-14

属性：hardening / refactor 收口记录。本文只记录当前底层线程的工程边界、已经完成的拆分、剩余风险和下一步门禁，不引入新的运行行为。

## 底层结论

当前线程的最高优先级架构事实保持不变：

1. `记忆稳态引擎` 是模型底座、本地推理、记忆压缩和稳态维持的本体。
2. `agent-passport` 是连续身份、长期偏好、恢复、长期记忆、审计和运行时门禁的本体。
3. `openneed` 只是基于 `记忆稳态引擎 + agent-passport` 构建出来的 app / bridge / legacy compatibility，不拥有底层模型 runtime、本地推理本体或连续身份本体。

本轮扫描未发现需要把 `openneed` 重新提升为底层 runtime 的依据。仓库内保留的 `OpenNeed` / `openneed` 命名主要属于历史 DID method、旧 env、旧脚本名、兼容 manifest、测试夹具和文档文件名残留。

## 已完成的硬化拆分

`src/ledger.js` 仍是 facade 和 API 壳，但已经把多类独立规则、store helper、runner helper 和 credential helper 拆到边界模块，并由 `tests/ledger-facade-refactor-boundary.test.mjs` 锁住“拆出去不能滑回 facade”的规则。

已拆出的关键模块包括：

- `ledger-runner-pipeline.js`、`ledger-runner-reasoner-plan.js`、`ledger-runner-quality-signal.js`
- `ledger-store-migration.js`、`ledger-archive-store.js`
- `ledger-local-reasoner-defaults.js`、`ledger-local-reasoner-migration.js`、`ledger-local-reasoner-orchestration.js`、`ledger-local-reasoner-profiles.js`、`ledger-local-reasoner-runtime.js`、`ledger-local-reasoner-overrides.js`
- `ledger-runtime-memory-store.js`、`ledger-runtime-memory-observations.js`、`ledger-runtime-memory-homeostasis.js`
- `ledger-passport-memory-rules.js`、`ledger-passport-memory-record.js`
- `ledger-credential-*` 系列、`ledger-agent-comparison.js`、`ledger-repair-links.js`
- `ledger-command-negotiation.js`、`ledger-sandbox-execution.js`、`ledger-sandbox-audit.js`
- `ledger-runtime-state.js`、`ledger-query-state.js`、`ledger-verification-run.js`、`ledger-agent-run.js`、`ledger-compact-boundary.js`
- `ledger-formal-recovery-flow.js`、`ledger-auto-recovery-readiness.js`

最近几刀的低风险拆分结果：

- local reasoner 默认迁移、迁移编排、in-store orchestration 已进入独立模块。
- 冷归档 helper 已进入 `ledger-archive-store.js`。
- passport memory 纯规则已进入 `ledger-passport-memory-rules.js`。
- passport memory record builder 已进入 `ledger-passport-memory-record.js`。

## 当前代码状态

当前 `src/ledger.js` 约 `23143` 行。它仍然大，但剩余大块主要是热路径：

- `executeAgentRunner`
- `buildContextBuilderResult`
- `buildResponseVerificationResult`
- `configureDeviceRuntime`
- `applyPassportMemoryReconsolidationCycle`
- `executeVerificationRun`
- `getDeviceSetupStatus`
- `migrateStore`
- recovery / archive restore / sandbox execution / authorization proposal / runtime summary 等 glue path

这些函数不是不能拆，而是不适合继续用“只为降行数”的方式拆。它们跨 store mutation、runner evidence、recovery closure、runtime policy、credential issuance、memory stability gate 等多个边界，继续拆分需要先写更细的 characterization tests，再按子域切分。

## 质量结论

当前状态不符合“乱堆屎山”的典型特征：

- 已经有明确 facade 边界测试，禁止已拆模块回流到 `ledger.js`。
- store 写路径有 `ledger-write-discipline` 守门。
- passive read、read-session、runtime evidence、security route、browser smoke、go-live verifier 都已经进入 smoke guard。
- 记忆稳态引擎 / agent-passport / openneed 三层边界有文档和测试语义双重约束。

仍然存在的工程风险是“核心 facade 仍大、热路径耦合高”。这不是立即 bug，但会增加未来修改成本。后续处理方式应该是先补 characterization tests，再拆热路径，不应直接重写。

## 验证基线

最近 pass 的本地验证基线：

- targeted runtime / write / runner / offline chat / self-learning 回归：`150 pass`
- `npm run verify:package-boundary`：通过，package entry count `332`
- `npm run test:smoke:guards`：`698 pass`
- GitHub PR #66：`Attribution Boundaries`、`Smoke Core`、`Smoke Browser` 全绿后合并

## 下一步

推荐下一步是停止大拆，进入最终审计与 release-hardening：

1. 只接受边界明确、无行为变更、可由现有测试覆盖的小拆分。
2. 对 `executeAgentRunner`、`buildContextBuilderResult`、`buildResponseVerificationResult` 这类热路径，先补 characterization tests，再按 runner / context / verification 子域切。
3. 继续保持 `openneed` 只作为 app / bridge / compatibility；新增文档、prompt、UI 文案不得把它写成底层模型或连续身份本体。
4. 合并前继续使用 `npm run test:smoke:guards`、`npm run verify:package-boundary` 和 GitHub 三项 CI 作为主门禁。
5. 进入公网部署或 go-live 前，以 `verify:go-live:self-hosted` / `verify:go-live` 作为最终发布判断，而不是单个页面或单个 API 的局部成功。

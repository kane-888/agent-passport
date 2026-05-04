# 记忆稳态引擎上线前本地自检

生成时间：2026-04-23T12:43:39.181Z
总体状态：PASS
说明：本地交付包自检 PASS 只代表本线程交付包可验收，不代表已经接入 Agent Passport/OpenNeed 真实产品源码。
归档说明：本文件是 `ai思维模型` 线程当时机器生成的自检快照，不是当前 `agent-passport` 仓库的实时门禁面板。文中 `runtime/*`、`benchmarks/*` 路径和命令只保留为历史复核线索；当前仓库是否存在对应脚本、现在该跑什么，以 `/Users/kane/Documents/agent-passport/package.json`、`/Users/kane/Documents/agent-passport/scripts/`、`/Users/kane/Documents/agent-passport/tests/` 为准。
归档复现命令：`node benchmarks/check-go-live-readiness.mjs --no-write`
更新报告：`node benchmarks/check-go-live-readiness.mjs`
入口关系：`runtime/final-release-notes.md` 是主封板摘要；`runtime/go-live-seal-log.md` 是追加/滚动复核日志；本文件是机器生成的当前自检结果。

## 检查项

归档纠偏：下表反映的是当时那套交付包的历史自检结果，不应直接当作当前 `agent-passport` 仓库仍然在线执行的 gate 清单。

| Gate | Status | Detail |
|---|---|---|
| boundary and evidence docs | PASS | 52 docs present |
| workspace boundary content | PASS | default scope stays in ai思维模型 |
| local script syntax | PASS | 33 scripts checked |
| benchmark report links | PASS | no stale public report links |
| readiness documentation content | PASS | scoring, index, inspect gate and no-fake-data wording present |
| readiness avoids provider benchmark suites | PASS | no provider benchmark suite is invoked by readiness check |
| readiness local-only static scan | PASS | 19 manifest/runtime scripts contain no provider or network primitives |
| runtime stability profile | PASS | 2 model profiles, 7 core mechanisms, 6 gates |
| runtime profile contract | PASS | 2 model profiles, 7 mechanisms, 6 gates verified; 5 profile extra-field cases rejected |
| runtime stability engine | PASS | online score, placement strategy and correction recommendation trigger verified |
| runtime stability snapshots | PASS | schema and stable/medium/strong example snapshots verified |
| runtime fail-closed loader | PASS | verified load success plus profile-contract and path-boundary failures |
| runtime shared contract validator | PASS | profile CLI, snapshot CLI and loader use one validator module |
| runtime correction execution events | PASS | none/medium/strong adapter execution events verified with no raw content; source_snapshot_sha256_verified === true |
| runtime correction event negative cases | PASS | 36 invalid correction events rejected |
| runtime adapter contract | PASS | adapter contract generated none/medium/strong execution events without model calls, raw content, or source snapshot digest drift |
| product adapter rehearsal | PASS | product_adapter none/medium/strong dry-run events verified with provenance, preflight, placement, replay, privacy and rollback evidence |
| product adapter handoff | PASS | adapter handoff boundaries, audit flags and required commands verified |
| final release notes | PASS | completion summary, evidence boundaries and next-step limits verified |
| self-learning governance proposal contract | PASS | 16 negative cases, 3 context injection checks, no canonical write bypass |
| self-learning governance examples | PASS | 10 negative cases, 2 dry-run examples, no product API calls |
| go-live delivery package | PASS | 29 artifacts, 16 validation commands, local-only boundary verified |
| go-live consistency freeze | PASS | 17 files, 16 commands and 29 artifacts aligned |
| go-live cold-start package check | PASS | 15 of 16 manifest commands executed with scrubbed env; 1 parent gate skipped |
| evidence floors | PASS | 128K, 20000K and high-conflict local evidence pass floors |

## 6 + 7 映射

- 6 个上线闸门：一键自检、轻量化预算、高冲突复验、对外证据包、产品接入确认、最终回归。
- 7 项核心机制：关键记忆探针、在线量化分数、自动纠偏触发（风险分级与纠偏建议生成，不执行产品动作）、离线画像、动态放置策略、权威记忆刷新、长上下文评测到运行时闭环。
- 这里的“自动纠偏触发”指生成纠偏计划和风险分级，不代表 loader、validator 或 engine 自动执行产品动作。
- 当前自检不触网、不跑大模型、不切源码仓库，只验证本线程资料和 benchmark 证据是否可交付。
- runtime 快照闭环：把在线分数、纠偏建议/执行事件和放置策略保存成可回放 JSON，防止产品接入时只看一次性日志。
- profile/schema/脱敏门禁：固定离线画像字段和在线快照落盘规则，避免字段漂移或把关键记忆原文误存进长期日志。
- 共享 validator + fail-closed loader：CLI 和 loader 使用同一套 profile/snapshot 校验规则，失败则拒绝加载策略，不调用模型也不自动执行纠偏。
- 共享 validator 门禁：profile、snapshot、redaction、loader 和 CLI verifier 共用同一套契约判定，避免本地验收与产品启动口径漂移。
- 纠偏执行审计门禁：CorrectionPlan 只给建议，产品 adapter 显式执行后必须写 execution event，证明不是 loader 自动执行且不保存原文。
- 纠偏负向用例门禁：`model_called=true`、空 refs、refs 夹带原文、强纠偏未完成等坏事件必须被拒绝。
- adapter 契约门禁：从 redacted snapshot 生成 execution event，证明真实产品接入时有可复用的审计事件构造边界。
- 自我学习治理门禁：Hermes 式持久学习只能形成 learning proposal，经过 proposal admission、冲突检测、回滚计划和 context 注入 denylist 后，才能交给产品 adapter 处理。
- 自我学习样例门禁：redacted proposal 与 apply/revert dry-run 只预演 adapter 请求，不调用 Agent Passport API、不创建 ledger event、不写产品仓库。
- 上线交付包门禁：交付清单、manifest 和 verifier 固定本线程边界、必跑命令、隐私规则和反夸大口径。
- 一致性冻结门禁：manifest、README、delivery package、readiness report、product target 和 benchmark index 的命令与边界口径必须一致。
- 一致性冻结负向门禁：consistency freeze 至少拒绝 5 类漂移样例；当前实际数量写入 machine-readable summary。

## Machine-readable summary

```json
{
  "runtime_profile_contract": {
    "profile_extra_field_negative_cases": 5
  },
  "runtime_stability_snapshots": {
    "snapshot_negative_cases": 10
  },
  "runtime_correction_execution_events": {
    "source_snapshot_sha256_verified": true,
    "verified_event_count": 3
  },
  "runtime_correction_event_negative_cases": {
    "invalid_correction_events_rejected": 36,
    "minimum_required": 36,
    "binding_negative_cases": [
      "reject_event_id_not_bound_to_adapter_invocation",
      "reject_idempotency_key_not_bound_to_adapter_invocation",
      "reject_source_snapshot_path_not_redacted",
      "reject_source_snapshot_object_not_redacted",
      "reject_actor_id_mismatch"
    ]
  },
  "product_adapter_rehearsal": {
    "product_adapter_rehearsal_checks": 3,
    "product_adapter_levels": [
      "none",
      "medium",
      "strong"
    ]
  },
  "self_learning_governance_learning_proposal": {
    "negative_checks": 16,
    "context_injection_checks": 3,
    "required_negative_names": [
      "reject_direct_canonical_write",
      "reject_external_recall_verified",
      "reject_profile_auto_apply",
      "reject_skill_direct_activation",
      "reject_unknown_candidate_field",
      "reject_unresolved_evidence_ref",
      "reject_memory_profile_lane_mismatch",
      "quarantine_scan_protected_memory_hit"
    ]
  },
  "self_learning_governance_examples": {
    "negative_checks": 10,
    "dry_run_examples": 2,
    "product_api_called": false,
    "ledger_event_created": false,
    "raw_content_persisted": false
  },
  "go_live_consistency_freeze": {
    "go_live_consistency_freeze_negative_check_floor": 5,
    "go_live_consistency_freeze_negative_checks": 10
  },
  "go_live_cold_start_package_check": {
    "commands_executed": 15,
    "commands_declared": 16,
    "commands_skipped": 1,
    "gate_evidence": {
      "profile_extra_field_negative_cases": 5,
      "snapshot_negative_cases": 10,
      "source_snapshot_sha256_verified": true,
      "invalid_correction_events_rejected": 36,
      "product_adapter_rehearsal_checks": 3,
      "product_adapter_rehearsal_all_safe": true
    }
  }
}
```

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalOperatorDecision,
  listCanonicalAgentRuntimeTruthMissingFields,
} from "../public/operator-decision-canonical.js";

test("listCanonicalAgentRuntimeTruthMissingFields fails closed on partial runner-guard truth", () => {
  const missingFields = listCanonicalAgentRuntimeTruthMissingFields({
    localFirst: true,
    policy: "本地优先。",
    onlineAllowed: true,
    qualityEscalationRuns: 0,
    latestRunStatus: "blocked",
    latestRunnerGuardActivated: true,
    latestRunnerGuardBlockedBy: "memory_stability_prompt_pretransform",
    latestRunnerGuardCode: "MEMORY_STABILITY_RUNTIME_LOAD_FAILED",
    latestRunnerGuardStage: null,
    latestRunnerGuardReceiptStatus: "blocked_preflight",
    latestRunnerGuardExplicitRequestKinds: [],
    latestQualityEscalationActivated: false,
    memoryStabilityStateCount: 1,
    latestMemoryStabilityCorrectionLevel: "medium",
    latestMemoryStabilityRiskScore: 0.41,
    latestMemoryStabilityStateId: "memory_state_1",
    latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
    latestMemoryStabilityObservationKind: "correction_rebuild",
    latestMemoryStabilityCorrectionActions: ["rewrite_working_memory_summary"],
    memoryStabilityRecoveryRate: 0,
  });

  assert(missingFields.includes("agentRuntime.latestRunnerGuardStage"));
  assert(missingFields.includes("agentRuntime.latestRunnerGuardExplicitRequestKinds"));
});

test("buildCanonicalOperatorDecision keeps runner guard ahead of generic release readiness text", () => {
  const decision = buildCanonicalOperatorDecision({
    security: {
      releaseReadiness: {
        status: "blocked",
        summary: "放行条件仍未满足。",
        nextAction: "先处理放行问题。",
        blockedBy: [
          {
            severity: "critical",
            label: "公网检查未通过",
            detail: "公网 health 未返回预期结果。",
          },
        ],
      },
    },
    truth: {
      posture: {
        mode: "normal",
        summary: "运行态正常。",
      },
      agentRuntime: {
        latestRunnerGuardActivated: true,
        latestRunnerGuardBlockedBy: "memory_stability_prompt_pretransform",
        latestRunnerGuardCode: "MEMORY_STABILITY_RUNTIME_LOAD_FAILED",
        latestRunnerGuardReceiptStatus: "blocked_preflight",
        latestRunnerGuardExplicitRequestKinds: ["prompt_pretransform"],
      },
    },
  });

  assert.equal(decision.summary, "当前先处理最近一次运行被记忆稳态护栏阻断。");
  assert.equal(
    decision.nextAction,
    "先修复记忆稳态护栏阻断：prompt 预变换 / MEMORY_STABILITY_RUNTIME_LOAD_FAILED。"
  );
  assert.equal(Array.isArray(decision.hardAlerts), true);
  assert.equal(decision.hardAlerts.some((entry) => entry?.title === "最近一次运行被记忆稳态护栏阻断"), true);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicAgentRuntimeTruth,
  buildUnavailablePublicAgentRuntimeTruth,
} from "../src/public-agent-runtime-truth.js";
import { listCanonicalAgentRuntimeTruthMissingFields } from "../public/operator-decision-canonical.js";

test("buildPublicAgentRuntimeTruth normalizes shared public runtime truth fields", () => {
  const truth = buildPublicAgentRuntimeTruth({
    hybridRuntime: {
      localFirst: true,
      fallback: {
        policy: "quality_gate",
        onlineAllowed: true,
      },
    },
    runner: {
      qualityEscalationRuns: 2.9,
      latest: {
        status: "blocked",
        runnerGuardActivated: true,
        runnerGuardBlockedBy: "memory_stability_prompt_preflight",
        runnerGuardCode: "MEMORY_STABILITY_RUNTIME_LOAD_FAILED",
        runnerGuardStage: "runtime_loader",
        runnerGuardReceiptStatus: "failed",
        runnerGuardExplicitRequestKinds: ["prompt_preflight", "", null, "kernel_preview"],
        qualityEscalationActivated: true,
        qualityEscalationProvider: "openai",
        qualityEscalationReason: "low_confidence",
        qualityEscalationIssueCodes: ["unsupported_local_result", "", null, "grounding_gap"],
        memoryStabilityCorrectionLevel: "strong",
        memoryStabilityRiskScore: 1.4,
        memoryStabilitySignalSource: "runtime_preflight",
        memoryStabilityPreflightStatus: "armed",
      },
    },
    memoryHomeostasis: {
      stateCount: "4.7",
      observationSummary: {
        effectiveness: {
          recoveryRate: 0.625,
        },
        latestObservation: {
          runtimeMemoryStateId: "state_123",
          observedAt: "2026-04-24T10:01:00.000Z",
          observationKind: "post_probe",
          riskTrend: "recovering",
          recoverySignal: "risk_reduced",
          correctionActions: ["reload_authoritative_window", "", null, "reanchor_to_tail"],
        },
      },
      latestState: {
        runtimeMemoryStateId: "state_123",
        updatedAt: "2026-04-24T10:00:00.000Z",
      },
    },
  });

  assert.deepEqual(truth, {
    localFirst: true,
    policy: "quality_gate",
    onlineAllowed: true,
    latestRunStatus: "blocked",
    qualityEscalationRuns: 2,
    latestFallbackActivated: false,
    latestFallbackCause: null,
    latestDegradedLocalFallback: false,
    latestDegradedLocalFallbackReason: null,
    latestRunnerGuardActivated: true,
    latestRunnerGuardBlockedBy: "memory_stability_prompt_preflight",
    latestRunnerGuardCode: "MEMORY_STABILITY_RUNTIME_LOAD_FAILED",
    latestRunnerGuardStage: "runtime_loader",
    latestRunnerGuardReceiptStatus: "failed",
    latestRunnerGuardExplicitRequestKinds: ["prompt_preflight", "kernel_preview"],
    latestQualityEscalationActivated: true,
    latestQualityEscalationProvider: "openai",
    latestQualityEscalationReason: "low_confidence",
    latestQualityEscalationIssueCodes: ["unsupported_local_result", "grounding_gap"],
    latestMemoryStabilityCorrectionLevel: "strong",
    latestMemoryStabilityRiskScore: 1,
    latestMemoryStabilitySignalSource: "runtime_preflight",
    latestMemoryStabilityPreflightStatus: "armed",
    latestMemoryStabilityStateId: "state_123",
    latestMemoryStabilityUpdatedAt: "2026-04-24T10:01:00.000Z",
    latestMemoryStabilityRiskTrend: "recovering",
    latestMemoryStabilityRecoverySignal: "risk_reduced",
    latestMemoryStabilityObservationKind: "post_probe",
    latestMemoryStabilityCorrectionActions: ["reload_authoritative_window", "reanchor_to_tail"],
    memoryStabilityRecoveryRate: 0.625,
    memoryStabilityStateCount: 4,
  });
});

test("buildPublicAgentRuntimeTruth prefers observation-backed memory stability fields over latest-state shells", () => {
  const truth = buildPublicAgentRuntimeTruth({
    memoryHomeostasis: {
      stateCount: 2,
      latestState: {
        correctionLevel: "light",
        cT: 0.18,
        runtimeMemoryStateId: "state_from_state_shell",
        updatedAt: "2026-04-24T10:00:00.000Z",
      },
      observationSummary: {
        effectiveness: {
          recoveryRate: 0.5,
        },
        latestObservation: {
          correctionLevel: "medium",
          cT: 0.41,
          runtimeMemoryStateId: "state_from_observation",
          observedAt: "2026-04-24T10:02:00.000Z",
          observationKind: "correction_rebuild",
          correctionActions: ["rewrite_working_memory_summary"],
        },
      },
    },
  });

  assert.equal(truth.latestMemoryStabilityCorrectionLevel, "medium");
  assert.equal(truth.latestMemoryStabilityRiskScore, 0.41);
  assert.equal(truth.latestMemoryStabilityStateId, "state_from_observation");
  assert.equal(truth.latestMemoryStabilityUpdatedAt, "2026-04-24T10:02:00.000Z");
  assert.equal(truth.latestMemoryStabilityObservationKind, "correction_rebuild");
  assert.deepEqual(truth.latestMemoryStabilityCorrectionActions, ["rewrite_working_memory_summary"]);
  assert.equal(truth.memoryStabilityRecoveryRate, 0.5);
});

test("buildPublicAgentRuntimeTruth falls back to latest state when observation fields are absent", () => {
  const truth = buildPublicAgentRuntimeTruth({
    memoryHomeostasis: {
      stateCount: 1,
      latestState: {
        correctionLevel: "light",
        cT: 0.18,
        runtimeMemoryStateId: "state_from_state_shell",
        updatedAt: "2026-04-24T10:00:00.000Z",
      },
      observationSummary: {
        effectiveness: {
          recoveryRate: null,
        },
        latestObservation: {
          observationKind: null,
          correctionActions: [],
        },
      },
    },
  });

  assert.equal(truth.latestMemoryStabilityCorrectionLevel, "light");
  assert.equal(truth.latestMemoryStabilityRiskScore, 0.18);
  assert.equal(truth.latestMemoryStabilityStateId, "state_from_state_shell");
  assert.equal(truth.latestMemoryStabilityUpdatedAt, "2026-04-24T10:00:00.000Z");
  assert.equal(truth.latestMemoryStabilityObservationKind, null);
});

test("buildPublicAgentRuntimeTruth exposes zero memory stability states as readable truth", () => {
  const truth = buildPublicAgentRuntimeTruth({
    hybridRuntime: {
      localFirst: true,
      fallback: {
        policy: "quality_gate",
      },
    },
    runner: {
      qualityEscalationRuns: 0,
    },
  });

  assert.equal(truth.memoryStabilityStateCount, 0);
});

test("buildPublicAgentRuntimeTruth keeps no-latest runner activation truth explicit", () => {
  const truth = buildPublicAgentRuntimeTruth({
    hybridRuntime: {
      localFirst: true,
      fallback: {
        policy: "quality_gate",
        onlineAllowed: false,
      },
    },
    runner: {
      qualityEscalationRuns: 0,
    },
    memoryHomeostasis: {
      stateCount: 0,
    },
  });

  assert.equal(truth.latestFallbackActivated, false);
  assert.equal(truth.latestDegradedLocalFallback, false);
  assert.equal(truth.latestRunnerGuardActivated, false);
  assert.equal(truth.latestQualityEscalationActivated, false);
  assert.equal(truth.latestQualityEscalationProvider, null);
  assert.equal(truth.latestQualityEscalationReason, null);
  assert.deepEqual(truth.latestQualityEscalationIssueCodes, []);
  assert.deepEqual(listCanonicalAgentRuntimeTruthMissingFields(truth), []);
});

test("buildUnavailablePublicAgentRuntimeTruth keeps missing summaries readable and fail-closed", () => {
  const truth = buildUnavailablePublicAgentRuntimeTruth({
    setup: {
      deviceRuntime: {
        localReasonerEnabled: true,
        allowOnlineReasoner: false,
      },
    },
  });

  assert.equal(truth.localFirst, true);
  assert.equal(truth.policy, "runtime_summary_unavailable");
  assert.equal(truth.onlineAllowed, false);
  assert.equal(truth.qualityEscalationRuns, 0);
  assert.equal(truth.latestRunnerGuardActivated, false);
  assert.equal(truth.latestQualityEscalationActivated, false);
  assert.equal(truth.memoryStabilityStateCount, 0);
});

test("buildPublicAgentRuntimeTruth fails closed for missing or invalid summaries", () => {
  assert.equal(buildPublicAgentRuntimeTruth(null), null);
  assert.equal(buildPublicAgentRuntimeTruth("invalid"), null);

  const truth = buildPublicAgentRuntimeTruth({
    hybridRuntime: {
      fallback: {
        policy: "  ",
        onlineAllowed: "sometimes",
      },
    },
    runner: {
      qualityEscalationRuns: "not-a-number",
      latest: {
        fallbackActivated: "yes",
        fallbackCause: "restore_local_reasoner_failed",
        degradedLocalFallback: "yes",
        degradedLocalFallbackReason: "local_mock_fallback",
        qualityEscalationActivated: "yes",
        qualityEscalationProvider: "   ",
        qualityEscalationReason: null,
        qualityEscalationIssueCodes: "not-an-array",
        memoryStabilityRiskScore: Number.NaN,
      },
    },
    memoryHomeostasis: {
      stateCount: -2,
      observationSummary: {
        effectiveness: {
          recoveryRate: Number.NaN,
        },
        latestObservation: {
          runtimeMemoryStateId: "   ",
          observedAt: "   ",
          observationKind: "   ",
          riskTrend: "   ",
          recoverySignal: null,
          correctionActions: "not-an-array",
        },
      },
      latestState: {
        correctionLevel: "medium",
        runtimeMemoryStateId: "   ",
      },
    },
  });

  assert.deepEqual(truth, {
    localFirst: false,
    policy: null,
    onlineAllowed: null,
    latestRunStatus: null,
    qualityEscalationRuns: null,
    latestFallbackActivated: false,
    latestFallbackCause: "restore_local_reasoner_failed",
    latestDegradedLocalFallback: false,
    latestDegradedLocalFallbackReason: "local_mock_fallback",
    latestRunnerGuardActivated: false,
    latestRunnerGuardBlockedBy: null,
    latestRunnerGuardCode: null,
    latestRunnerGuardStage: null,
    latestRunnerGuardReceiptStatus: null,
    latestRunnerGuardExplicitRequestKinds: [],
    latestQualityEscalationActivated: false,
    latestQualityEscalationProvider: null,
    latestQualityEscalationReason: null,
    latestQualityEscalationIssueCodes: [],
    latestMemoryStabilityCorrectionLevel: "medium",
    latestMemoryStabilityRiskScore: null,
    latestMemoryStabilitySignalSource: null,
    latestMemoryStabilityPreflightStatus: null,
    latestMemoryStabilityStateId: null,
    latestMemoryStabilityUpdatedAt: null,
    latestMemoryStabilityRiskTrend: null,
    latestMemoryStabilityRecoverySignal: null,
    latestMemoryStabilityObservationKind: null,
    latestMemoryStabilityCorrectionActions: [],
    memoryStabilityRecoveryRate: null,
    memoryStabilityStateCount: 0,
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCrashRestartChecks,
  buildRuntimeStabilityCoverage,
  buildSharedStateGrowthChecks,
  buildRuntimeStabilityVerdict,
  evaluateColdStartRound,
  evaluateSharedStateRound,
  extractSharedStateMetrics,
  isScriptProcessSignalTargetAlive,
  resolveScriptProcessSignalTarget,
  waitForScriptProcessSignalTargetExit,
} from "../scripts/soak-runtime-stability.mjs";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function isActiveCorrectionLevel(value) {
  return ["light", "mild", "medium", "strong"].includes(String(value ?? "").trim());
}

function stableOperationalUi(overrides = {}) {
  const result = {
    adminTokenRotationMode: "rotated",
    adminTokenRotationOldTokenRejected: true,
    adminTokenRotationReadSessionPreRevokeAllowed: true,
    adminTokenRotationReadSessionRevoked: true,
    adminTokenRotationAnomalyRecorded: true,
    forgedWindowRebindBlocked: true,
    forgedWindowRebindError: "already linked to agent",
    windowBindingStableAfterRebind: true,
    autoRecoveryResumed: true,
    autoRecoveryResumeStatus: "resumed",
    autoRecoveryResumeChainLength: 2,
    retryWithoutExecutionResumeStatus: "resumed",
    retryWithoutExecutionResumeChainLength: 2,
    qualityEscalationRuns: 0,
    latestQualityEscalationActivated: false,
    latestQualityEscalationProvider: null,
    latestQualityEscalationReason: null,
    latestRunMemoryStabilityCorrectionLevel: "none",
    latestRunMemoryStabilityRiskScore: 0.08,
    memoryStabilityStateCount: 4,
    latestMemoryStabilityStateId: "mhstate_1",
    latestMemoryStabilityCorrectionLevel: "none",
    latestMemoryStabilityRiskScore: 0.08,
    latestMemoryStabilityUpdatedAt: "2026-04-23T08:00:00.000Z",
    latestMemoryStabilityObservationKind: "active_probe",
    latestMemoryStabilityRecoverySignal: null,
    latestMemoryStabilityCorrectionActions: [],
    memoryStabilityRecoveryRate: null,
    runtimeStabilityStateCount: 4,
    runtimeStabilityLatestStateId: "mhstate_1",
    runtimeStabilityLatestCorrectionLevel: "none",
    runtimeStabilityLatestRiskScore: 0.08,
    ...overrides,
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, "latestMemoryStabilityObservationKind")) {
    result.latestMemoryStabilityObservationKind = result.memoryStabilityStateCount === 0 ? null : "active_probe";
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, "latestMemoryStabilityRecoverySignal")) {
    result.latestMemoryStabilityRecoverySignal = null;
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, "latestMemoryStabilityCorrectionActions")) {
    result.latestMemoryStabilityCorrectionActions = isActiveCorrectionLevel(result.latestMemoryStabilityCorrectionLevel)
      ? ["reanchor_to_tail"]
      : [];
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, "memoryStabilityRecoveryRate")) {
    result.memoryStabilityRecoveryRate = isActiveCorrectionLevel(result.latestMemoryStabilityCorrectionLevel) ? 0 : null;
  }
  return result;
}

function buildRuntimeSummaryAfterRestartFixture({
  stateCount = 1,
  stateId = "mhstate_1",
  correctionLevel = "none",
  riskScore = 0.08,
  updatedAt = "2026-04-23T08:00:00.000Z",
  observationKind,
  recoverySignal = null,
  correctionActions,
  recoveryRate,
} = {}) {
  const activeCorrection = isActiveCorrectionLevel(correctionLevel);
  return {
    summary: {
      memoryHomeostasis: {
        stateCount,
        latestState: {
          runtimeMemoryStateId: stateId,
          correctionLevel,
          cT: riskScore,
          updatedAt,
        },
        observationSummary: {
          latestObservation:
            stateCount === 0
              ? null
              : {
                  runtimeMemoryStateId: stateId,
                  correctionLevel,
                  cT: riskScore,
                  observedAt: updatedAt,
                  observationKind: observationKind ?? "active_probe",
                  recoverySignal,
                  correctionActions:
                    correctionActions ?? (activeCorrection ? ["reanchor_to_tail"] : []),
                },
          effectiveness: {
            recoveryRate: recoveryRate ?? (activeCorrection ? 0 : null),
          },
        },
      },
    },
  };
}

function buildRuntimeStabilityAfterRestartFixture({
  stateCount = 1,
  stateId = "mhstate_1",
  correctionLevel = "none",
  riskScore = 0.08,
  updatedAt = "2026-04-23T08:00:00.000Z",
  observationKind,
  recoverySignal = null,
  correctionActions,
  recoveryRate,
} = {}) {
  const activeCorrection = isActiveCorrectionLevel(correctionLevel);
  return {
    stability: {
      counts: {
        total: stateCount,
      },
      latestState: {
        runtimeMemoryStateId: stateId,
        correctionLevel,
        cT: riskScore,
        updatedAt,
      },
      observationSummary: {
        latestObservation:
          stateCount === 0
            ? null
            : {
                runtimeMemoryStateId: stateId,
                correctionLevel,
                cT: riskScore,
                observedAt: updatedAt,
                observationKind: observationKind ?? "active_probe",
                recoverySignal,
                correctionActions:
                  correctionActions ?? (activeCorrection ? ["reanchor_to_tail"] : []),
              },
        effectiveness: {
          recoveryRate: recoveryRate ?? (activeCorrection ? 0 : null),
        },
      },
    },
  };
}

test("evaluateColdStartRound accepts stable smoke-all evidence", () => {
  const evaluation = evaluateColdStartRound({
    ok: true,
    mode: "sequential_combined_with_operational",
    offlineFanoutGate: {
      status: "passed",
      summary: "fanout ok",
    },
    protectiveStateSemantics: {
      status: "passed",
      summary: "protective ok",
    },
    operationalFlowSemantics: {
      status: "passed",
      summary: "operational ok",
    },
    runtimeEvidenceSemantics: {
      status: "passed",
      summary: "runtime evidence ok",
    },
    browserUiSemantics: {
      status: "skipped",
      summary: "skipped",
    },
    steps: [
      {
        name: "smoke:ui:operational",
        result: {
          adminTokenRotationMode: "rotated",
          adminTokenRotationOldTokenRejected: true,
          adminTokenRotationReadSessionPreRevokeAllowed: true,
          adminTokenRotationReadSessionRevoked: true,
          adminTokenRotationAnomalyRecorded: true,
          forgedWindowRebindBlocked: true,
          forgedWindowRebindError: "already linked to agent",
          windowBindingStableAfterRebind: true,
          autoRecoveryResumed: true,
          autoRecoveryResumeStatus: "resumed",
          autoRecoveryResumeChainLength: 2,
          retryWithoutExecutionResumeStatus: "resumed",
          retryWithoutExecutionResumeChainLength: 2,
        },
      },
    ],
  });

  assert.equal(evaluation.ok, true);
  assert.deepEqual(
    evaluation.checks.filter((entry) => entry.passed === false),
    []
  );
});

test("evaluateColdStartRound accepts operational-only evidence without combined-only gates", () => {
  const evaluation = evaluateColdStartRound({
    ok: true,
    mode: "operational_only",
    operationalFlowSemantics: {
      status: "passed",
      summary: "operational ok",
    },
    runtimeEvidenceSemantics: {
      status: "passed",
      summary: "runtime evidence ok",
    },
    steps: [
      {
        name: "smoke:ui:operational",
        result: stableOperationalUi(),
      },
    ],
  });

  assert.equal(evaluation.ok, true);
  assert.deepEqual(
    evaluation.checks.filter((entry) => entry.passed === false),
    []
  );
  assert.equal(evaluation.checks.some((entry) => entry.id === "offline_fanout_gate"), false);
  assert.equal(evaluation.checks.some((entry) => entry.id === "protective_state_semantics"), false);
  assert.equal(evaluation.checks.some((entry) => entry.id === "browser_ui_semantics"), false);
});

test("evaluateColdStartRound keeps runtime evidence and auto-recovery mandatory in operational-only mode", () => {
  const evaluation = evaluateColdStartRound({
    ok: true,
    mode: "operational_only",
    operationalFlowSemantics: {
      status: "passed",
    },
    steps: [
      {
        name: "smoke:ui:operational",
        result: stableOperationalUi({
          autoRecoveryResumed: false,
          autoRecoveryResumeStatus: "rehydrate_required",
          autoRecoveryResumeChainLength: 1,
        }),
      },
    ],
  });

  assert.equal(evaluation.ok, false);
  assert.deepEqual(
    evaluation.checks.filter((entry) => entry.passed === false).map((entry) => entry.id),
    ["runtime_evidence_semantics", "auto_recovery_resume"]
  );
});

test("evaluateColdStartRound fails when token rotation or recovery resume drifts", () => {
  const evaluation = evaluateColdStartRound({
    ok: true,
    offlineFanoutGate: { status: "passed" },
    protectiveStateSemantics: { status: "passed" },
    operationalFlowSemantics: { status: "passed" },
    runtimeEvidenceSemantics: { status: "passed" },
    browserUiSemantics: { status: "passed" },
    steps: [
      {
        name: "smoke:ui:operational",
        result: {
          adminTokenRotationMode: "rotated",
          adminTokenRotationOldTokenRejected: false,
          adminTokenRotationReadSessionPreRevokeAllowed: true,
          adminTokenRotationReadSessionRevoked: true,
          adminTokenRotationAnomalyRecorded: true,
          forgedWindowRebindBlocked: true,
          windowBindingStableAfterRebind: true,
          autoRecoveryResumed: false,
          autoRecoveryResumeStatus: "rehydrate_required",
          autoRecoveryResumeChainLength: 1,
          retryWithoutExecutionResumeStatus: "resumed",
          retryWithoutExecutionResumeChainLength: 2,
        },
      },
    ],
  });

  assert.equal(evaluation.ok, false);
  assert.deepEqual(
    evaluation.checks.filter((entry) => entry.passed === false).map((entry) => entry.id),
    ["admin_token_rotation", "auto_recovery_resume"]
  );
});

test("evaluateColdStartRound prefers operational smoke-ui stability fields when present", () => {
  const evaluation = evaluateColdStartRound({
    ok: true,
    offlineFanoutGate: { status: "passed" },
    protectiveStateSemantics: { status: "passed" },
    operationalFlowSemantics: { status: "passed" },
    runtimeEvidenceSemantics: { status: "passed" },
    browserUiSemantics: { status: "passed" },
    steps: [
      {
        name: "smoke:ui",
        result: {},
      },
      {
        name: "smoke:ui:operational",
        result: {
          adminTokenRotationMode: "rotated",
          adminTokenRotationOldTokenRejected: true,
          adminTokenRotationReadSessionPreRevokeAllowed: true,
          adminTokenRotationReadSessionRevoked: true,
          adminTokenRotationAnomalyRecorded: true,
          forgedWindowRebindBlocked: true,
          windowBindingStableAfterRebind: true,
          autoRecoveryResumed: true,
          autoRecoveryResumeStatus: "resumed",
          autoRecoveryResumeChainLength: 2,
          retryWithoutExecutionResumeStatus: "resumed",
          retryWithoutExecutionResumeChainLength: 2,
        },
      },
    ],
  });

  assert.equal(evaluation.ok, true);
});

test("evaluateColdStartRound rejects operational-looking stability fields from combined smoke-ui", () => {
  const evaluation = evaluateColdStartRound({
    ok: true,
    offlineFanoutGate: { status: "passed" },
    protectiveStateSemantics: { status: "passed" },
    operationalFlowSemantics: { status: "passed" },
    runtimeEvidenceSemantics: { status: "passed" },
    browserUiSemantics: { status: "passed" },
    steps: [
      {
        name: "smoke:ui",
        result: {
          adminTokenRotationMode: "rotated",
          adminTokenRotationOldTokenRejected: true,
          adminTokenRotationReadSessionPreRevokeAllowed: true,
          adminTokenRotationReadSessionRevoked: true,
          adminTokenRotationAnomalyRecorded: true,
          forgedWindowRebindBlocked: true,
          windowBindingStableAfterRebind: true,
          autoRecoveryResumed: true,
          autoRecoveryResumeStatus: "resumed",
          autoRecoveryResumeChainLength: 2,
          retryWithoutExecutionResumeStatus: "resumed",
          retryWithoutExecutionResumeChainLength: 2,
        },
      },
    ],
  });

  assert.equal(evaluation.ok, false);
  assert(evaluation.checks.some((entry) => entry.id === "operational_ui_evidence" && entry.passed === false));
});

test("extractSharedStateMetrics reads cumulative counters from operational smoke-ui", () => {
  const metrics = extractSharedStateMetrics({
    steps: [
      {
        name: "smoke:ui:operational",
        result: stableOperationalUi({
          windowCount: 12,
          passportMemoryCount: 180,
          conversationMinuteCount: 240,
          runnerHistoryCount: 70,
          verificationHistoryCount: 4,
          repairCount: 7,
        }),
      },
    ],
  });

  assert.deepEqual(metrics, {
    windowCount: 12,
    passportMemoryCount: 180,
    conversationMinuteCount: 240,
    runnerHistoryCount: 70,
    verificationHistoryCount: 4,
    repairCount: 7,
    qualityEscalationRuns: 0,
    latestQualityEscalationActivated: false,
    latestQualityEscalationProvider: null,
    latestQualityEscalationReason: null,
    latestRunMemoryStabilityCorrectionLevel: "none",
    latestRunMemoryStabilityRiskScore: 0.08,
    memoryStabilityStateCount: 4,
    latestMemoryStabilityStateId: "mhstate_1",
    latestMemoryStabilityCorrectionLevel: "none",
    latestMemoryStabilityRiskScore: 0.08,
    latestMemoryStabilityUpdatedAt: "2026-04-23T08:00:00.000Z",
    latestMemoryStabilityObservationKind: "active_probe",
    latestMemoryStabilityRecoverySignal: null,
    latestMemoryStabilityCorrectionActions: [],
    memoryStabilityRecoveryRate: null,
    runtimeStabilityStateCount: 4,
    runtimeStabilityLatestStateId: "mhstate_1",
    runtimeStabilityLatestCorrectionLevel: "none",
    runtimeStabilityLatestRiskScore: 0.08,
  });
});

test("extractSharedStateMetrics ignores combined smoke-ui counters", () => {
  const metrics = extractSharedStateMetrics({
    steps: [
      {
        name: "smoke:ui",
        result: stableOperationalUi({
          windowCount: 12,
          passportMemoryCount: 180,
          conversationMinuteCount: 240,
          runnerHistoryCount: 70,
          verificationHistoryCount: 4,
          repairCount: 7,
        }),
      },
    ],
  });

  assert.deepEqual(metrics, {
    windowCount: null,
    passportMemoryCount: null,
    conversationMinuteCount: null,
    runnerHistoryCount: null,
    verificationHistoryCount: null,
    repairCount: null,
    qualityEscalationRuns: null,
    latestQualityEscalationActivated: null,
    latestQualityEscalationProvider: null,
    latestQualityEscalationReason: null,
    latestRunMemoryStabilityCorrectionLevel: null,
    latestRunMemoryStabilityRiskScore: null,
    memoryStabilityStateCount: null,
    latestMemoryStabilityStateId: null,
    latestMemoryStabilityCorrectionLevel: null,
    latestMemoryStabilityRiskScore: null,
    latestMemoryStabilityUpdatedAt: null,
    latestMemoryStabilityObservationKind: null,
    latestMemoryStabilityRecoverySignal: null,
    latestMemoryStabilityCorrectionActions: null,
    memoryStabilityRecoveryRate: null,
    runtimeStabilityStateCount: null,
    runtimeStabilityLatestStateId: null,
    runtimeStabilityLatestCorrectionLevel: null,
    runtimeStabilityLatestRiskScore: null,
  });
});

test("extractSharedStateMetrics ignores nested operational runtime truth shells", () => {
  const metrics = extractSharedStateMetrics({
    steps: [
      {
        name: "smoke:ui:operational",
        result: {
          runtimeTruth: stableOperationalUi({
            windowCount: 12,
            passportMemoryCount: 180,
            conversationMinuteCount: 240,
            runnerHistoryCount: 70,
            verificationHistoryCount: 4,
            repairCount: 7,
            qualityEscalationRuns: 1,
            latestQualityEscalationActivated: true,
            latestQualityEscalationProvider: "openai_compatible",
            latestQualityEscalationReason: "verification_invalid",
            latestRunMemoryStabilityCorrectionLevel: "medium",
            latestRunMemoryStabilityRiskScore: 0.41,
            memoryStabilityStateCount: 5,
            latestMemoryStabilityStateId: "mhstate_2",
            latestMemoryStabilityCorrectionLevel: "medium",
            latestMemoryStabilityRiskScore: 0.41,
            latestMemoryStabilityUpdatedAt: "2026-04-23T08:05:00.000Z",
          }),
        },
      },
    ],
  });

  const checks = buildSharedStateGrowthChecks({ currentMetrics: metrics });
  assert.equal(checks.find((entry) => entry.id === "shared_window_metric_present")?.passed, false);
  assert.equal(checks.find((entry) => entry.id === "shared_memory_metric_present")?.passed, false);
  assert.equal(checks.find((entry) => entry.id === "shared_memory_stability_metric_present")?.passed, false);
});

test("extractSharedStateMetrics rejects non-integer, negative, and non-finite counters", () => {
  const metrics = extractSharedStateMetrics({
    steps: [
      {
        name: "smoke:ui:operational",
        result: stableOperationalUi({
          windowCount: -1,
          passportMemoryCount: 180.5,
          conversationMinuteCount: "NaN",
          runnerHistoryCount: Infinity,
          verificationHistoryCount: "4",
          repairCount: 0,
          qualityEscalationRuns: "NaN",
          latestRunMemoryStabilityRiskScore: Infinity,
          memoryStabilityStateCount: -1,
          latestMemoryStabilityRiskScore: "NaN",
          runtimeStabilityStateCount: Infinity,
          runtimeStabilityLatestRiskScore: "NaN",
        }),
      },
    ],
  });

  assert.deepEqual(metrics, {
    windowCount: null,
    passportMemoryCount: null,
    conversationMinuteCount: null,
    runnerHistoryCount: null,
    verificationHistoryCount: 4,
    repairCount: 0,
    qualityEscalationRuns: null,
    latestQualityEscalationActivated: false,
    latestQualityEscalationProvider: null,
    latestQualityEscalationReason: null,
    latestRunMemoryStabilityCorrectionLevel: "none",
    latestRunMemoryStabilityRiskScore: null,
    memoryStabilityStateCount: null,
    latestMemoryStabilityStateId: "mhstate_1",
    latestMemoryStabilityCorrectionLevel: "none",
    latestMemoryStabilityRiskScore: null,
    latestMemoryStabilityUpdatedAt: "2026-04-23T08:00:00.000Z",
    latestMemoryStabilityObservationKind: "active_probe",
    latestMemoryStabilityRecoverySignal: null,
    latestMemoryStabilityCorrectionActions: [],
    memoryStabilityRecoveryRate: null,
    runtimeStabilityStateCount: null,
    runtimeStabilityLatestStateId: "mhstate_1",
    runtimeStabilityLatestCorrectionLevel: "none",
    runtimeStabilityLatestRiskScore: null,
  });
});

test("buildSharedStateGrowthChecks enforces stable windows and non-decreasing histories", () => {
  const checks = buildSharedStateGrowthChecks({
    previousMetrics: {
      windowCount: 12,
      passportMemoryCount: 180,
      conversationMinuteCount: 240,
      runnerHistoryCount: 70,
      verificationHistoryCount: 4,
      repairCount: 7,
      qualityEscalationRuns: 0,
      latestQualityEscalationActivated: false,
      latestQualityEscalationProvider: null,
      latestQualityEscalationReason: null,
      latestRunMemoryStabilityCorrectionLevel: "none",
      latestRunMemoryStabilityRiskScore: 0.08,
      memoryStabilityStateCount: 4,
      latestMemoryStabilityStateId: "mhstate_1",
      latestMemoryStabilityCorrectionLevel: "none",
      latestMemoryStabilityRiskScore: 0.08,
      latestMemoryStabilityUpdatedAt: "2026-04-23T08:00:00.000Z",
      latestMemoryStabilityObservationKind: "active_probe",
      latestMemoryStabilityRecoverySignal: null,
      latestMemoryStabilityCorrectionActions: [],
      memoryStabilityRecoveryRate: null,
      runtimeStabilityStateCount: 4,
      runtimeStabilityLatestStateId: "mhstate_1",
      runtimeStabilityLatestCorrectionLevel: "none",
      runtimeStabilityLatestRiskScore: 0.08,
    },
    currentMetrics: {
      windowCount: 12,
      passportMemoryCount: 192,
      conversationMinuteCount: 251,
      runnerHistoryCount: 74,
      verificationHistoryCount: 5,
      repairCount: 8,
      qualityEscalationRuns: 1,
      latestQualityEscalationActivated: true,
      latestQualityEscalationProvider: "openai_compatible",
      latestQualityEscalationReason: "verification_invalid",
      latestRunMemoryStabilityCorrectionLevel: "medium",
      latestRunMemoryStabilityRiskScore: 0.41,
      memoryStabilityStateCount: 5,
      latestMemoryStabilityStateId: "mhstate_2",
      latestMemoryStabilityCorrectionLevel: "medium",
      latestMemoryStabilityRiskScore: 0.41,
      latestMemoryStabilityUpdatedAt: "2026-04-23T08:05:00.000Z",
      latestMemoryStabilityObservationKind: "active_probe",
      latestMemoryStabilityRecoverySignal: null,
      latestMemoryStabilityCorrectionActions: ["reanchor_to_tail"],
      memoryStabilityRecoveryRate: 0,
      runtimeStabilityStateCount: 5,
      runtimeStabilityLatestStateId: "mhstate_2",
      runtimeStabilityLatestCorrectionLevel: "medium",
      runtimeStabilityLatestRiskScore: 0.41,
    },
  });

  assert.equal(checks.every((entry) => entry.passed === true), true);
});

test("buildSharedStateGrowthChecks fails when active correction lacks observation truth", () => {
  const checks = buildSharedStateGrowthChecks({
    previousMetrics: {
      windowCount: 12,
      passportMemoryCount: 180,
      conversationMinuteCount: 240,
      runnerHistoryCount: 70,
      verificationHistoryCount: 4,
      repairCount: 7,
      qualityEscalationRuns: 0,
      latestQualityEscalationActivated: false,
      latestQualityEscalationProvider: null,
      latestQualityEscalationReason: null,
      latestRunMemoryStabilityCorrectionLevel: "none",
      latestRunMemoryStabilityRiskScore: 0.08,
      memoryStabilityStateCount: 4,
      latestMemoryStabilityStateId: "mhstate_1",
      latestMemoryStabilityCorrectionLevel: "none",
      latestMemoryStabilityRiskScore: 0.08,
      latestMemoryStabilityUpdatedAt: "2026-04-23T08:00:00.000Z",
      runtimeStabilityStateCount: 4,
      runtimeStabilityLatestStateId: "mhstate_1",
      runtimeStabilityLatestCorrectionLevel: "none",
      runtimeStabilityLatestRiskScore: 0.08,
    },
    currentMetrics: {
      windowCount: 12,
      passportMemoryCount: 192,
      conversationMinuteCount: 251,
      runnerHistoryCount: 74,
      verificationHistoryCount: 5,
      repairCount: 8,
      qualityEscalationRuns: 1,
      latestQualityEscalationActivated: true,
      latestQualityEscalationProvider: "openai_compatible",
      latestQualityEscalationReason: "verification_invalid",
      latestRunMemoryStabilityCorrectionLevel: "medium",
      latestRunMemoryStabilityRiskScore: 0.41,
      memoryStabilityStateCount: 5,
      latestMemoryStabilityStateId: "mhstate_2",
      latestMemoryStabilityCorrectionLevel: "medium",
      latestMemoryStabilityRiskScore: 0.41,
      latestMemoryStabilityUpdatedAt: "2026-04-23T08:05:00.000Z",
      latestMemoryStabilityObservationKind: null,
      latestMemoryStabilityCorrectionActions: [],
      memoryStabilityRecoveryRate: null,
      runtimeStabilityStateCount: 5,
      runtimeStabilityLatestStateId: "mhstate_2",
      runtimeStabilityLatestCorrectionLevel: "medium",
      runtimeStabilityLatestRiskScore: 0.41,
    },
  });

  assert.equal(checks.find((entry) => entry.id === "shared_memory_stability_signal_coherent")?.passed, false);
});

test("evaluateSharedStateRound fails when durable shared runtime counters drift backwards or duplicate windows appear", () => {
  const evaluation = evaluateSharedStateRound(
    {
      ok: true,
      offlineFanoutGate: { status: "passed" },
      protectiveStateSemantics: { status: "passed" },
      operationalFlowSemantics: { status: "passed" },
      runtimeEvidenceSemantics: { status: "passed" },
      browserUiSemantics: { status: "skipped" },
      steps: [
        {
          name: "smoke:ui:operational",
          result: {
            adminTokenRotationMode: "rotated",
            adminTokenRotationOldTokenRejected: true,
            adminTokenRotationReadSessionPreRevokeAllowed: true,
            adminTokenRotationReadSessionRevoked: true,
            adminTokenRotationAnomalyRecorded: true,
            forgedWindowRebindBlocked: true,
            windowBindingStableAfterRebind: true,
            autoRecoveryResumed: true,
            autoRecoveryResumeStatus: "resumed",
            autoRecoveryResumeChainLength: 2,
            retryWithoutExecutionResumeStatus: "resumed",
            retryWithoutExecutionResumeChainLength: 2,
            windowCount: 13,
            passportMemoryCount: 170,
            conversationMinuteCount: 239,
            runnerHistoryCount: 69,
            verificationHistoryCount: 3,
            repairCount: 6,
            qualityEscalationRuns: 0,
            latestQualityEscalationActivated: true,
            latestQualityEscalationProvider: null,
            latestQualityEscalationReason: null,
            latestRunMemoryStabilityCorrectionLevel: "light",
            latestRunMemoryStabilityRiskScore: 0.33,
            memoryStabilityStateCount: 3,
            latestMemoryStabilityStateId: "mhstate_0",
            latestMemoryStabilityCorrectionLevel: "none",
            latestMemoryStabilityRiskScore: 0.11,
            latestMemoryStabilityUpdatedAt: "2026-04-23T07:59:00.000Z",
            runtimeStabilityStateCount: 2,
            runtimeStabilityLatestStateId: "mhstate_runtime_0",
            runtimeStabilityLatestCorrectionLevel: "light",
            runtimeStabilityLatestRiskScore: 0.19,
          },
        },
      ],
    },
    {
      previousMetrics: {
        windowCount: 12,
        passportMemoryCount: 180,
        conversationMinuteCount: 240,
        runnerHistoryCount: 70,
        verificationHistoryCount: 4,
        repairCount: 7,
        qualityEscalationRuns: 1,
        latestQualityEscalationActivated: true,
        latestQualityEscalationProvider: "openai_compatible",
        latestQualityEscalationReason: "verification_invalid",
        latestRunMemoryStabilityCorrectionLevel: "medium",
        latestRunMemoryStabilityRiskScore: 0.41,
        memoryStabilityStateCount: 4,
        latestMemoryStabilityStateId: "mhstate_1",
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityUpdatedAt: "2026-04-23T08:00:00.000Z",
        runtimeStabilityStateCount: 4,
        runtimeStabilityLatestStateId: "mhstate_1",
        runtimeStabilityLatestCorrectionLevel: "medium",
        runtimeStabilityLatestRiskScore: 0.41,
      },
    }
  );

  assert.equal(evaluation.ok, false);
  assert.deepEqual(
    evaluation.checks.filter((entry) => entry.passed === false).map((entry) => entry.id),
    [
      "shared_quality_escalation_signal_coherent",
      "shared_memory_stability_signal_coherent",
      "shared_memory_stability_summary_matches_runtime_stability",
      "shared_runner_memory_truth_consistent",
      "shared_window_count_stable",
      "shared_memory_count_non_decreasing",
      "shared_conversation_minute_non_decreasing",
      "shared_runner_history_non_decreasing",
      "shared_verification_history_non_decreasing",
      "shared_repair_count_non_decreasing",
      "shared_quality_escalation_non_decreasing",
      "shared_memory_stability_non_decreasing",
      "shared_runtime_stability_non_decreasing",
      "shared_memory_stability_updated_at_non_decreasing",
    ]
  );
});

test("evaluateSharedStateRound keeps shared metrics enforcement in operational-only mode", () => {
  const evaluation = evaluateSharedStateRound(
    {
      ok: true,
      mode: "operational_only",
      operationalFlowSemantics: { status: "passed" },
      runtimeEvidenceSemantics: { status: "passed" },
      steps: [
        {
          name: "smoke:ui:operational",
          result: stableOperationalUi({
            windowCount: 12,
            passportMemoryCount: 181,
            conversationMinuteCount: 241,
            runnerHistoryCount: 71,
            verificationHistoryCount: 5,
            repairCount: 8,
            qualityEscalationRuns: 1,
            latestQualityEscalationActivated: true,
            latestQualityEscalationProvider: "openai_compatible",
            latestQualityEscalationReason: "verification_invalid",
            latestRunMemoryStabilityCorrectionLevel: "medium",
            latestRunMemoryStabilityRiskScore: 0.41,
            memoryStabilityStateCount: 5,
            latestMemoryStabilityStateId: "mhstate_2",
            latestMemoryStabilityCorrectionLevel: "medium",
            latestMemoryStabilityRiskScore: 0.41,
            latestMemoryStabilityUpdatedAt: "2026-04-23T08:05:00.000Z",
            runtimeStabilityStateCount: 5,
            runtimeStabilityLatestStateId: "mhstate_2",
            runtimeStabilityLatestCorrectionLevel: "medium",
            runtimeStabilityLatestRiskScore: 0.41,
          }),
        },
      ],
    },
    {
      previousMetrics: {
        windowCount: 12,
        passportMemoryCount: 180,
        conversationMinuteCount: 240,
        runnerHistoryCount: 70,
        verificationHistoryCount: 4,
        repairCount: 7,
        qualityEscalationRuns: 0,
        latestQualityEscalationActivated: false,
        latestQualityEscalationProvider: null,
        latestQualityEscalationReason: null,
        latestRunMemoryStabilityCorrectionLevel: "none",
        latestRunMemoryStabilityRiskScore: 0.08,
        memoryStabilityStateCount: 4,
        latestMemoryStabilityStateId: "mhstate_1",
        latestMemoryStabilityCorrectionLevel: "none",
        latestMemoryStabilityRiskScore: 0.08,
        latestMemoryStabilityUpdatedAt: "2026-04-23T08:00:00.000Z",
        runtimeStabilityStateCount: 4,
        runtimeStabilityLatestStateId: "mhstate_1",
        runtimeStabilityLatestCorrectionLevel: "none",
        runtimeStabilityLatestRiskScore: 0.08,
      },
    }
  );

  assert.equal(evaluation.ok, true);
  assert.deepEqual(
    evaluation.checks.filter((entry) => entry.passed === false),
    []
  );
});

test("buildRuntimeStabilityVerdict reports round and crash failures together", () => {
  const verdict = buildRuntimeStabilityVerdict({
    rounds: [
      {
        round: 1,
        ok: true,
        checks: [],
      },
      {
        round: 2,
        ok: false,
        checks: [
          { id: "window_rebind_guard", passed: false },
        ],
      },
    ],
    sharedStateRounds: [
      {
        round: 1,
        ok: false,
        checks: [
          { id: "shared_window_count_stable", passed: false },
        ],
      },
    ],
    crashRestart: {
      ok: false,
      summary: "restart failed",
    },
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.coldStartRoundCount, 2);
  assert.equal(verdict.coldStartPassedCount, 1);
  assert.equal(verdict.sharedStateRoundCount, 1);
  assert.equal(verdict.sharedStatePassedCount, 0);
  assert.deepEqual(verdict.failedRounds, [{ round: 2, failedChecks: ["window_rebind_guard"] }]);
  assert.deepEqual(verdict.failedSharedStateRounds, [{ round: 1, failedChecks: ["shared_window_count_stable"] }]);
  assert.match(verdict.summary, /round_2/);
  assert.match(verdict.summary, /shared_round_1/);
  assert.match(verdict.summary, /crash_restart=restart failed/);
});

test("runtime stability coverage makes browser soak boundaries explicit", () => {
  assert.deepEqual(
    buildRuntimeStabilityCoverage({ includeBrowser: false }),
    {
      browserUi: "skipped_by_default",
      formalGoLiveMeaning: "does not replace smoke:browser, smoke:all, or go-live verifier browser coverage",
      nextAction: "For browser-projected runtime truth, run npm run soak:runtime:browser or npm run smoke:browser on a Safari DOM automation host.",
    }
  );
  assert.equal(buildRuntimeStabilityCoverage({ includeBrowser: true }).browserUi, "required");
  assert.equal(buildRuntimeStabilityCoverage({ operationalOnly: true }).browserUi, "not_applicable_operational_only");
});

test("buildCrashRestartChecks uses health ok for restart and keeps protected runtime readable as a separate gate", () => {
  const checks = buildCrashRestartChecks({
    memoryId: "memory_1",
    resumeBoundaryId: "boundary_1",
    visibleBeforeCrash: true,
    healthAfterRestart: {
      ok: true,
      service: "agent-passport",
    },
    securityAfterRestart: {
      authorized: true,
      agentRuntimeTruth: {
        localFirst: true,
        qualityEscalationRuns: 1,
      },
    },
    runtimeAfterRestart: {
      deviceRuntime: {
        deviceRuntimeId: "device_runtime_local",
      },
    },
    resumeBoundaryAvailableAfterRestart: true,
    rehydrateAfterRestart: {
      rehydrate: {
        resumeBoundary: {
          compactBoundaryId: "boundary_1",
        },
      },
    },
    resumedRunnerAfterRestart: {
      runner: {
        autoResumed: true,
        autoRecovery: {
          status: "resumed",
          finalRunId: "run_2",
          finalStatus: "completed",
        },
        run: {
          runId: "run_2",
          status: "completed",
        },
        recoveryChain: [
          { runId: "run_1", runStatus: "rehydrate_required", resumeBoundaryId: "boundary_1" },
          { runId: "run_2", runStatus: "completed", resumeBoundaryId: "boundary_1" },
        ],
      },
    },
    sessionStateAfterRestart: {
      sessionState: {
        latestResumeBoundaryId: "boundary_1",
        latestRunId: "run_2",
        latestRunStatus: "completed",
        activeWindowIds: ["window_1"],
        tokenBudgetState: {
          estimatedContextChars: 24000,
          estimatedContextTokens: 6200,
        },
      },
    },
    runtimeSummaryAfterRestart: buildRuntimeSummaryAfterRestartFixture({
      stateCount: 4,
      correctionLevel: "medium",
      riskScore: 0.41,
    }),
    runtimeStabilityAfterRestart: buildRuntimeStabilityAfterRestartFixture({
      stateCount: 4,
      correctionLevel: "medium",
      riskScore: 0.41,
    }),
    visibleAfterRestart: true,
  });

  assert.equal(checks.every((entry) => entry.passed === true), true);
  assert.equal(checks.find((entry) => entry.id === "restart_health")?.details?.service, "agent-passport");
  assert.equal(checks.find((entry) => entry.id === "restart_runtime_truth")?.details?.deviceRuntimeId, "device_runtime_local");
  assert.equal(checks.find((entry) => entry.id === "restart_public_agent_runtime_truth")?.details?.localFirst, true);
  assert.equal(checks.find((entry) => entry.id === "restart_resume_boundary_available")?.details?.resumeBoundaryId, "boundary_1");
  assert.equal(checks.find((entry) => entry.id === "restart_resume_execution")?.details?.runStatus, "completed");
  assert.equal(checks.find((entry) => entry.id === "restart_session_state_persisted")?.passed, true);
  assert.equal(checks.find((entry) => entry.id === "restart_memory_stability_summary_signal_coherent")?.passed, true);
  assert.equal(checks.find((entry) => entry.id === "restart_memory_stability_runtime_signal_coherent")?.passed, true);
});

test("buildCrashRestartChecks prefers observation-backed memory stability truth over stale latest-state shells", () => {
  const checks = buildCrashRestartChecks({
    memoryId: "memory_1",
    resumeBoundaryId: "boundary_1",
    visibleBeforeCrash: true,
    healthAfterRestart: {
      ok: true,
      service: "agent-passport",
    },
    securityAfterRestart: {
      authorized: true,
      agentRuntimeTruth: {
        localFirst: true,
        qualityEscalationRuns: 1,
      },
    },
    runtimeAfterRestart: {
      deviceRuntime: {
        deviceRuntimeId: "device_runtime_local",
      },
    },
    resumeBoundaryAvailableAfterRestart: true,
    rehydrateAfterRestart: {
      rehydrate: {
        resumeBoundary: {
          compactBoundaryId: "boundary_1",
        },
      },
    },
    resumedRunnerAfterRestart: {
      runner: {
        autoResumed: true,
        autoRecovery: {
          status: "resumed",
          finalRunId: "run_2",
          finalStatus: "completed",
        },
        run: {
          runId: "run_2",
          status: "completed",
        },
        recoveryChain: [
          { runId: "run_1", runStatus: "rehydrate_required", resumeBoundaryId: "boundary_1" },
          { runId: "run_2", runStatus: "completed", resumeBoundaryId: "boundary_1" },
        ],
      },
    },
    sessionStateAfterRestart: {
      sessionState: {
        latestResumeBoundaryId: "boundary_1",
        latestRunId: "run_2",
        latestRunStatus: "completed",
        activeWindowIds: ["window_1"],
        tokenBudgetState: {
          estimatedContextChars: 24000,
          estimatedContextTokens: 6200,
        },
      },
    },
    runtimeSummaryAfterRestart: {
      summary: {
        memoryHomeostasis: {
          stateCount: 4,
          latestState: {
            runtimeMemoryStateId: "mhstate_stale_summary",
            correctionLevel: "none",
            cT: 0.08,
            updatedAt: "2026-04-23T08:00:00.000Z",
          },
          observationSummary: {
            latestObservation: {
              runtimeMemoryStateId: "mhstate_observed",
              correctionLevel: "medium",
              cT: 0.41,
              observedAt: "2026-04-23T08:05:00.000Z",
              observationKind: "correction_rebuild",
              recoverySignal: "risk_rising",
              correctionActions: ["rewrite_working_memory_summary"],
            },
            effectiveness: {
              recoveryRate: 0,
            },
          },
        },
      },
    },
    runtimeStabilityAfterRestart: {
      stability: {
        counts: {
          total: 4,
        },
        latestState: {
          runtimeMemoryStateId: "mhstate_stale_runtime",
          correctionLevel: "light",
          cT: 0.19,
          updatedAt: "2026-04-23T08:02:00.000Z",
        },
        observationSummary: {
          latestObservation: {
            runtimeMemoryStateId: "mhstate_observed",
            correctionLevel: "medium",
            cT: 0.41,
            observedAt: "2026-04-23T08:05:00.000Z",
            observationKind: "correction_rebuild",
            recoverySignal: "risk_rising",
            correctionActions: ["rewrite_working_memory_summary"],
          },
          effectiveness: {
            recoveryRate: 0,
          },
        },
      },
    },
    visibleAfterRestart: true,
  });

  assert.equal(checks.find((entry) => entry.id === "restart_memory_stability_summary_signal_coherent")?.passed, true);
  assert.equal(checks.find((entry) => entry.id === "restart_memory_stability_runtime_signal_coherent")?.passed, true);
  assert.equal(checks.find((entry) => entry.id === "restart_memory_stability_truth_consistent")?.passed, true);
});

test("buildCrashRestartChecks fails when restart can read truth but cannot resume execution", () => {
  const checks = buildCrashRestartChecks({
    memoryId: "memory_1",
    resumeBoundaryId: "boundary_1",
    visibleBeforeCrash: true,
    healthAfterRestart: {
      ok: true,
      service: "agent-passport",
    },
    securityAfterRestart: {
      authorized: true,
      agentRuntimeTruth: {
        localFirst: true,
        qualityEscalationRuns: 0,
      },
    },
    runtimeAfterRestart: {
      deviceRuntime: {
        deviceRuntimeId: "device_runtime_local",
      },
    },
    resumeBoundaryAvailableAfterRestart: true,
    rehydrateAfterRestart: {
      rehydrate: {
        resumeBoundary: {
          compactBoundaryId: "boundary_1",
        },
      },
    },
    resumedRunnerAfterRestart: {
      runner: {
        autoResumed: false,
        autoRecovery: {
          status: "rehydrate_required",
          finalRunId: "run_2",
          finalStatus: "rehydrate_required",
        },
        run: {
          runId: "run_2",
          status: "rehydrate_required",
        },
        recoveryChain: [{ runId: "run_1", runStatus: "rehydrate_required", resumeBoundaryId: "boundary_1" }],
      },
    },
    sessionStateAfterRestart: {
      sessionState: {
        latestResumeBoundaryId: "boundary_1",
        latestRunId: "run_2",
        latestRunStatus: "rehydrate_required",
        activeWindowIds: ["window_1"],
        tokenBudgetState: {
          estimatedContextChars: 24000,
          estimatedContextTokens: 6200,
        },
      },
    },
    runtimeSummaryAfterRestart: buildRuntimeSummaryAfterRestartFixture(),
    runtimeStabilityAfterRestart: buildRuntimeStabilityAfterRestartFixture(),
    visibleAfterRestart: true,
  });

  assert.equal(checks.find((entry) => entry.id === "restart_resume_execution")?.passed, false);
});

test("buildCrashRestartChecks fails when recovery bookkeeping drifts from the requested boundary", () => {
  const checks = buildCrashRestartChecks({
    memoryId: "memory_1",
    resumeBoundaryId: "boundary_1",
    visibleBeforeCrash: true,
    healthAfterRestart: {
      ok: true,
      service: "agent-passport",
    },
    securityAfterRestart: {
      authorized: true,
      agentRuntimeTruth: {
        localFirst: true,
        qualityEscalationRuns: 0,
      },
    },
    runtimeAfterRestart: {
      deviceRuntime: {
        deviceRuntimeId: "device_runtime_local",
      },
    },
    resumeBoundaryAvailableAfterRestart: true,
    rehydrateAfterRestart: {
      rehydrate: {
        resumeBoundary: {
          compactBoundaryId: "boundary_1",
        },
      },
    },
    resumedRunnerAfterRestart: {
      runner: {
        autoResumed: true,
        autoRecovery: {
          status: "resumed",
          finalRunId: "run_9",
          finalStatus: "completed",
        },
        run: {
          runId: "run_2",
          status: "completed",
        },
        recoveryChain: [
          { runId: "run_1", runStatus: "rehydrate_required", resumeBoundaryId: "boundary_other" },
          { runId: "run_2", runStatus: "completed", resumeBoundaryId: "boundary_other" },
        ],
      },
    },
    sessionStateAfterRestart: {
      sessionState: {
        latestResumeBoundaryId: "boundary_other",
        latestRunId: "run_2",
        latestRunStatus: "completed",
        activeWindowIds: ["window_1"],
        tokenBudgetState: {
          estimatedContextChars: 24000,
          estimatedContextTokens: 6200,
        },
      },
    },
    runtimeSummaryAfterRestart: buildRuntimeSummaryAfterRestartFixture({
      correctionLevel: "light",
      riskScore: 0.18,
    }),
    runtimeStabilityAfterRestart: buildRuntimeStabilityAfterRestartFixture({
      correctionLevel: "light",
      riskScore: 0.18,
    }),
    visibleAfterRestart: true,
  });

  assert.equal(checks.find((entry) => entry.id === "restart_resume_execution")?.passed, false);
  assert.equal(checks.find((entry) => entry.id === "restart_session_state_persisted")?.passed, false);
});

test("buildCrashRestartChecks fails when projected memory stability signals are missing after restart", () => {
  const checks = buildCrashRestartChecks({
    memoryId: "memory_1",
    resumeBoundaryId: "boundary_1",
    visibleBeforeCrash: true,
    healthAfterRestart: {
      ok: true,
      service: "agent-passport",
    },
    securityAfterRestart: {
      authorized: true,
      agentRuntimeTruth: {
        localFirst: true,
        qualityEscalationRuns: 0,
      },
    },
    runtimeAfterRestart: {
      deviceRuntime: {
        deviceRuntimeId: "device_runtime_local",
      },
    },
    resumeBoundaryAvailableAfterRestart: true,
    rehydrateAfterRestart: {
      rehydrate: {
        resumeBoundary: {
          compactBoundaryId: "boundary_1",
        },
      },
    },
    resumedRunnerAfterRestart: {
      runner: {
        autoResumed: true,
        autoRecovery: {
          status: "resumed",
          finalRunId: "run_2",
          finalStatus: "completed",
        },
        run: {
          runId: "run_2",
          status: "completed",
        },
        recoveryChain: [
          { runId: "run_1", runStatus: "rehydrate_required", resumeBoundaryId: "boundary_1" },
          { runId: "run_2", runStatus: "completed", resumeBoundaryId: "boundary_1" },
        ],
      },
    },
    sessionStateAfterRestart: {
      sessionState: {
        latestResumeBoundaryId: "boundary_1",
        latestRunId: "run_2",
        latestRunStatus: "completed",
        activeWindowIds: ["window_1"],
        tokenBudgetState: {
          estimatedContextChars: 24000,
          estimatedContextTokens: 6200,
        },
      },
    },
    runtimeSummaryAfterRestart: {
      summary: {
        memoryHomeostasis: {
          stateCount: 2,
          latestState: {
            runtimeMemoryStateId: null,
            correctionLevel: null,
            cT: null,
          },
        },
      },
    },
    runtimeStabilityAfterRestart: {
      stability: {
        counts: {
          total: 2,
        },
        latestState: {
          runtimeMemoryStateId: null,
          correctionLevel: null,
          cT: null,
        },
      },
    },
    visibleAfterRestart: true,
  });

  assert.equal(checks.find((entry) => entry.id === "restart_memory_stability_summary_signal_coherent")?.passed, false);
  assert.equal(checks.find((entry) => entry.id === "restart_memory_stability_runtime_signal_coherent")?.passed, false);
  assert.equal(checks.find((entry) => entry.id === "restart_memory_stability_truth_consistent")?.passed, false);
});

test("soak script timeout targets the whole smoke-all process group on POSIX", () => {
  assert.deepEqual(resolveScriptProcessSignalTarget({ pid: 4321 }, { platform: "darwin" }), {
    mode: "process_group",
    pid: -4321,
  });
  assert.deepEqual(resolveScriptProcessSignalTarget({ pid: 4321 }, { platform: "linux" }), {
    mode: "process_group",
    pid: -4321,
  });
  assert.deepEqual(resolveScriptProcessSignalTarget({ pid: 4321 }, { platform: "win32" }), {
    mode: "child",
    pid: 4321,
  });
  assert.deepEqual(resolveScriptProcessSignalTarget(null, { platform: "darwin" }), {
    mode: "none",
    pid: null,
  });
});

test("process-tree liveness checks probe the process group on POSIX and child pid on Windows", () => {
  const posixSignals = [];
  const winSignals = [];

  assert.equal(
    isScriptProcessSignalTargetAlive(
      { pid: 4321 },
      {
        platform: "darwin",
        killImpl: (pid, signal) => {
          posixSignals.push([pid, signal]);
        },
      }
    ),
    true
  );
  assert.deepEqual(posixSignals, [[-4321, 0]]);

  assert.equal(
    isScriptProcessSignalTargetAlive(
      { pid: 8765 },
      {
        platform: "win32",
        killImpl: (pid, signal) => {
          winSignals.push([pid, signal]);
        },
      }
    ),
    true
  );
  assert.deepEqual(winSignals, [[8765, 0]]);
});

test("process-tree liveness falls back to child pid when the POSIX process group is already gone", () => {
  const seen = [];

  assert.equal(
    isScriptProcessSignalTargetAlive(
      { pid: 4321 },
      {
        platform: "linux",
        killImpl: (pid, signal) => {
          seen.push([pid, signal]);
          if (pid === -4321) {
            const error = new Error("gone");
            error.code = "ESRCH";
            throw error;
          }
        },
      }
    ),
    true
  );

  assert.deepEqual(seen, [
    [-4321, 0],
    [4321, 0],
  ]);
});

test("process-tree exit wait polls until the old process group disappears", async () => {
  let probesRemaining = 2;
  const seen = [];

  const exited = await waitForScriptProcessSignalTargetExit(
    { pid: 4321 },
    {
      platform: "linux",
      timeoutMs: 100,
      pollIntervalMs: 1,
      killImpl: (pid, signal) => {
        seen.push([pid, signal]);
        if (signal !== 0) {
          return;
        }
        if (probesRemaining > 0) {
          probesRemaining -= 1;
          return;
        }
        const error = new Error("gone");
        error.code = "ESRCH";
        throw error;
      },
    }
  );

  assert.equal(exited, true);
  assert.deepEqual(seen.slice(0, 3), [
    [-4321, 0],
    [-4321, 0],
    [-4321, 0],
  ]);
});

test("process-tree exit wait falls back to child pid when the old process group is already gone", async () => {
  let childProbesRemaining = 2;
  const seen = [];

  const exited = await waitForScriptProcessSignalTargetExit(
    { pid: 4321 },
    {
      platform: "linux",
      timeoutMs: 100,
      pollIntervalMs: 1,
      killImpl: (pid, signal) => {
        seen.push([pid, signal]);
        if (signal !== 0) {
          return;
        }
        if (pid === -4321) {
          const error = new Error("group gone");
          error.code = "ESRCH";
          throw error;
        }
        if (childProbesRemaining > 0) {
          childProbesRemaining -= 1;
          return;
        }
        const error = new Error("child gone");
        error.code = "ESRCH";
        throw error;
      },
    }
  );

  assert.equal(exited, true);
  assert.deepEqual(seen.slice(0, 6), [
    [-4321, 0],
    [4321, 0],
    [-4321, 0],
    [4321, 0],
    [-4321, 0],
    [4321, 0],
  ]);
});

test("soak runtime cleanup uses the shared wrapper cleanup helper", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts", "soak-runtime-stability.mjs"), "utf8");
  assert.match(source, /cleanupSmokeWrapperRuntime/u);
  assert.doesNotMatch(source, /await smokeServer\.stop\(\);\s*await resolvedDataRoot\.cleanup\(\);/u);
});

test("crash restart probe reuses process-tree termination and waits for old server exit before restart", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts", "soak-runtime-stability.mjs"), "utf8");
  assert.match(source, /terminateScriptProcessTree\(previousSmokeServerChild,\s*\{\s*graceMs:\s*250,\s*forceGraceMs:\s*2000,/u);
  assert.match(
    source,
    /previous smoke server process tree did not exit before restart/u
  );
  assert.match(source, /resolveScriptProcessFallbackTarget\(child\)/u);
  assert.doesNotMatch(source, /await forceKillChild\(smokeServer\.child\)/u);
});

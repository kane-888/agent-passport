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
  resolveScriptProcessSignalTarget,
} from "../scripts/soak-runtime-stability.mjs";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function stableOperationalUi(overrides = {}) {
  return {
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
    ...overrides,
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
        result: {
          windowCount: 12,
          passportMemoryCount: 180,
          conversationMinuteCount: 240,
          runnerHistoryCount: 70,
          verificationHistoryCount: 4,
          repairCount: 7,
        },
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
  });
});

test("extractSharedStateMetrics ignores combined smoke-ui counters", () => {
  const metrics = extractSharedStateMetrics({
    steps: [
      {
        name: "smoke:ui",
        result: {
          windowCount: 12,
          passportMemoryCount: 180,
          conversationMinuteCount: 240,
          runnerHistoryCount: 70,
          verificationHistoryCount: 4,
          repairCount: 7,
        },
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
  });
});

test("extractSharedStateMetrics rejects non-integer, negative, and non-finite counters", () => {
  const metrics = extractSharedStateMetrics({
    steps: [
      {
        name: "smoke:ui:operational",
        result: {
          windowCount: -1,
          passportMemoryCount: 180.5,
          conversationMinuteCount: "NaN",
          runnerHistoryCount: Infinity,
          verificationHistoryCount: "4",
          repairCount: 0,
        },
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
    },
    currentMetrics: {
      windowCount: 12,
      passportMemoryCount: 192,
      conversationMinuteCount: 251,
      runnerHistoryCount: 74,
      verificationHistoryCount: 5,
      repairCount: 8,
    },
  });

  assert.equal(checks.every((entry) => entry.passed === true), true);
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
      },
    }
  );

  assert.equal(evaluation.ok, false);
  assert.deepEqual(
    evaluation.checks.filter((entry) => entry.passed === false).map((entry) => entry.id),
    [
      "shared_window_count_stable",
      "shared_conversation_minute_non_decreasing",
      "shared_runner_history_non_decreasing",
      "shared_verification_history_non_decreasing",
      "shared_repair_count_non_decreasing",
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
    visibleBeforeCrash: true,
    healthAfterRestart: {
      ok: true,
      service: "agent-passport",
    },
    securityAfterRestart: {
      authorized: true,
    },
    runtimeAfterRestart: {
      deviceRuntime: {
        deviceRuntimeId: "device_runtime_local",
      },
    },
    visibleAfterRestart: true,
  });

  assert.equal(checks.every((entry) => entry.passed === true), true);
  assert.equal(checks.find((entry) => entry.id === "restart_health")?.details?.service, "agent-passport");
  assert.equal(checks.find((entry) => entry.id === "restart_runtime_truth")?.details?.deviceRuntimeId, "device_runtime_local");
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

test("soak runtime cleanup uses the shared wrapper cleanup helper", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts", "soak-runtime-stability.mjs"), "utf8");
  assert.match(source, /cleanupSmokeWrapperRuntime/u);
  assert.doesNotMatch(source, /await smokeServer\.stop\(\);\s*await resolvedDataRoot\.cleanup\(\);/u);
});

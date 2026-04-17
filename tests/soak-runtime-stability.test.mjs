import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrashRestartChecks,
  buildRuntimeStabilityVerdict,
  evaluateColdStartRound,
} from "../scripts/soak-runtime-stability.mjs";

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
        name: "smoke:ui",
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
        name: "smoke:ui",
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
    crashRestart: {
      ok: false,
      summary: "restart failed",
    },
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.coldStartRoundCount, 2);
  assert.equal(verdict.coldStartPassedCount, 1);
  assert.deepEqual(verdict.failedRounds, [{ round: 2, failedChecks: ["window_rebind_guard"] }]);
  assert.match(verdict.summary, /round_2/);
  assert.match(verdict.summary, /crash_restart=restart failed/);
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

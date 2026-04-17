import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeReleaseReadiness } from "../src/release-readiness.js";
import { redactAutoRecoveryAuditForReadSession } from "../src/server-agent-redaction.js";
import {
  buildAutomaticRecoveryReadinessFailureSemantics,
  buildAutoRecoveryFailureSemantics,
} from "../src/runtime-failure-semantics.js";

test("runtime release readiness exposes stable failure semantics on blocked checks", () => {
  const readiness = buildRuntimeReleaseReadiness({
    health: { ok: false, service: "legacy-passport" },
    security: {
      securityPosture: {
        mode: "panic",
        summary: "locked",
      },
      constrainedExecution: {
        status: "locked",
        summary: "locked",
      },
      automaticRecovery: {
        operatorBoundary: {
          formalFlowReady: false,
          summary: "not ready",
        },
      },
    },
    setup: {
      formalRecoveryFlow: {
        durableRestoreReady: false,
        runbook: {
          status: "draft",
          nextStepLabel: "补 runbook",
        },
        rehearsal: {
          status: "stale",
          summary: "stale",
        },
      },
    },
  });

  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.failureSemantics?.status, "present");
  assert.equal(readiness.failureSemantics?.primaryFailure?.code, "service_health_unhealthy");
  assert.equal(readiness.failureSemantics?.recommendedMachineAction, "block_release");
  assert.equal(readiness.blockedBy[0]?.failure?.code, "service_health_unhealthy");
  assert.equal(readiness.blockedBy[1]?.failure?.code, "service_identity_mismatch");
  assert.equal(readiness.blockedBy.at(-1)?.failure?.code, "constrained_execution_degraded");
});

test("automatic recovery readiness failure semantics classifies gate reasons and warnings", () => {
  const failureSemantics = buildAutomaticRecoveryReadinessFailureSemantics({
    gateReasons: ["resident_agent_bound", "security_posture_execution_locked:panic"],
    dependencyWarnings: ["formal_recovery_flow:recovery_bundle_present"],
  });

  assert.equal(failureSemantics.status, "present");
  assert.equal(failureSemantics.failureCount, 3);
  assert.equal(failureSemantics.primaryFailure?.code, "resident_agent_unbound");
  assert.equal(failureSemantics.failures[1]?.code, "security_posture_locked");
  assert.equal(failureSemantics.failures[1]?.sourceContext?.mode, "panic");
  assert.equal(failureSemantics.failures[2]?.code, "formal_recovery_incomplete");
});

test("auto recovery failure semantics classifies status and execution failures", () => {
  const failureSemantics = buildAutoRecoveryFailureSemantics({
    status: "failed",
    attempt: 2,
    maxAttempts: 3,
    gateReasons: ["local_reasoner_reachable"],
    dependencyWarnings: ["auto_recovery_plan_failed:restore_local_reasoner"],
    plan: {
      action: "restore_local_reasoner",
    },
    finalStatus: "needs_human_review",
  });

  assert.equal(failureSemantics.status, "present");
  assert.equal(failureSemantics.failureCount, 3);
  assert.equal(failureSemantics.primaryFailure?.code, "local_reasoner_unreachable");
  assert.equal(failureSemantics.failures[1]?.code, "auto_recovery_plan_failed");
  assert.equal(failureSemantics.failures[1]?.sourceContext?.action, "restore_local_reasoner");
  assert.equal(failureSemantics.failures[2]?.code, "auto_recovery_execution_failed");
});

test("read session auto recovery audit keeps machine-readable failure semantics while hiding free text", () => {
  const redacted = redactAutoRecoveryAuditForReadSession({
    status: "failed",
    summary: "自动恢复执行失败：本地 reasoner 超时",
    error: "connect ETIMEDOUT 127.0.0.1",
    gateReasons: ["local_reasoner_reachable"],
    dependencyWarnings: ["auto_recovery_plan_failed:restore_local_reasoner"],
    failureSemantics: buildAutoRecoveryFailureSemantics({
      status: "failed",
      gateReasons: ["local_reasoner_reachable"],
      dependencyWarnings: ["auto_recovery_plan_failed:restore_local_reasoner"],
      plan: {
        action: "restore_local_reasoner",
      },
    }),
    setupStatus: {
      setupComplete: false,
      missingRequiredCodes: ["resident_agent_bound"],
      automaticRecoveryReadiness: {
        status: "gated",
        ready: false,
        formalFlowReady: false,
        gateReasons: ["resident_agent_bound"],
        dependencyWarnings: ["formal_recovery_flow:bootstrap_ready"],
        failureSemantics: buildAutomaticRecoveryReadinessFailureSemantics({
          gateReasons: ["resident_agent_bound"],
          dependencyWarnings: ["formal_recovery_flow:bootstrap_ready"],
        }),
      },
      activePlanReadiness: {
        status: "gated",
        ready: false,
        formalFlowReady: false,
        gateReasons: ["resident_agent_bound"],
        dependencyWarnings: [],
        failureSemantics: buildAutomaticRecoveryReadinessFailureSemantics({
          gateReasons: ["resident_agent_bound"],
          dependencyWarnings: [],
        }),
      },
    },
    closure: {
      status: "failed",
      chainLength: 1,
      finalStatus: "needs_human_review",
      phases: [{ phaseId: "execution", status: "failed" }],
      gateReasons: ["local_reasoner_reachable"],
      dependencyWarnings: ["auto_recovery_plan_failed:restore_local_reasoner"],
      failureSemantics: buildAutoRecoveryFailureSemantics({
        status: "failed",
        gateReasons: ["local_reasoner_reachable"],
        dependencyWarnings: ["auto_recovery_plan_failed:restore_local_reasoner"],
      }),
    },
  });

  assert.equal(redacted.summary, null);
  assert.equal(redacted.error, null);
  assert.equal(redacted.failureSemantics?.primaryFailure?.code, "local_reasoner_unreachable");
  assert.equal(
    redacted.setupStatus?.automaticRecoveryReadiness?.failureSemantics?.primaryFailure?.code,
    "resident_agent_unbound"
  );
  assert.equal(redacted.closure?.failureSemantics?.failures[1]?.code, "auto_recovery_plan_failed");
});

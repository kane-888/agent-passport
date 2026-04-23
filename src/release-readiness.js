import {
  buildReleaseCheckFailureSemantics,
  buildReleaseFailureSemantics,
} from "./runtime-failure-semantics.js";

function text(value) {
  return String(value ?? "").trim();
}

function buildCheck(id, label, passed, { severity = "high", expected = null, actual = null, detail = null } = {}) {
  return {
    id,
    label,
    passed: passed === true,
    severity,
    expected,
    actual,
    detail,
  };
}

function findFirstFailedCheck(checks = []) {
  return (Array.isArray(checks) ? checks : []).find((entry) => entry?.passed === false) || null;
}

const READY_CONSTRAINED_EXECUTION_STATUSES = new Set(["restricted", "bounded", "ready"]);

export function buildRuntimeReleaseReadiness({ health = null, security = null, setup = null } = {}) {
  const posture = security?.securityPosture || null;
  const formalRecovery = setup?.formalRecoveryFlow || security?.localStorageFormalFlow || null;
  const automaticRecovery = setup?.automaticRecoveryReadiness || security?.automaticRecovery || null;
  const constrained = setup?.deviceRuntime?.constrainedExecutionSummary || security?.constrainedExecution || null;
  const runbook = formalRecovery?.runbook || null;
  const rehearsal = formalRecovery?.rehearsal || null;
  const cadence = formalRecovery?.operationalCadence || null;
  const operatorBoundary = automaticRecovery?.operatorBoundary || null;
  const constrainedStatus = text(constrained?.status);

  const rehearsalFresh = text(rehearsal?.status) === "fresh" || text(cadence?.status) === "within_window";

  const checks = [
    buildCheck("health_ok", "服务健康", health?.ok === true, {
      severity: "critical",
      expected: true,
      actual: health?.ok ?? null,
      detail: "GET /api/health.ok 必须是 true。",
    }),
    buildCheck("service_name", "服务名正确", text(health?.service) === "agent-passport", {
      severity: "high",
      expected: "agent-passport",
      actual: text(health?.service) || null,
      detail: "GET /api/health.service 必须保持 agent-passport。",
    }),
    buildCheck("security_posture_normal", "安全姿态正常", text(posture?.mode) === "normal", {
      severity: "critical",
      expected: "normal",
      actual: text(posture?.mode) || null,
      detail: text(posture?.summary) || "安全姿态不是 normal 时不讨论继续放量。",
    }),
    buildCheck("formal_recovery_ready", "正式恢复基线达标", formalRecovery?.durableRestoreReady === true, {
      severity: "critical",
      expected: true,
      actual: formalRecovery?.durableRestoreReady ?? null,
      detail: text(formalRecovery?.summary) || "formalRecoveryFlow.durableRestoreReady 必须为 true。",
    }),
    buildCheck("formal_runbook_ready", "正式恢复 runbook 已收口", text(runbook?.status) === "ready", {
      severity: "high",
      expected: "ready",
      actual: text(runbook?.status) || null,
      detail: text(runbook?.nextStepLabel) || text(runbook?.nextStepSummary) || "formalRecoveryFlow.runbook.status 必须是 ready。",
    }),
    buildCheck("recovery_rehearsal_fresh", "恢复演练仍在窗口内", rehearsalFresh, {
      severity: "high",
      expected: "fresh|within_window",
      actual: text(rehearsal?.status) || text(cadence?.status) || null,
      detail:
        text(cadence?.actionSummary) ||
        text(rehearsal?.summary) ||
        "formalRecoveryFlow.rehearsal.status 应为 fresh，或 cadence.status 应为 within_window。",
    }),
    buildCheck("automatic_recovery_boundary_ready", "自动恢复没有越位", operatorBoundary?.formalFlowReady === true, {
      severity: "critical",
      expected: true,
      actual: operatorBoundary?.formalFlowReady ?? null,
      detail:
        text(operatorBoundary?.summary) || "automaticRecovery.operatorBoundary.formalFlowReady 必须为 true。",
    }),
    buildCheck(
      "constrained_execution_ready",
      "受限执行层真值可放行",
      READY_CONSTRAINED_EXECUTION_STATUSES.has(constrainedStatus),
      {
        severity: "critical",
        expected: "restricted|bounded|ready",
        actual: constrainedStatus || null,
        detail:
          text(constrained?.summary) ||
          "constrainedExecution.status 必须明确存在，且只能是 restricted、bounded 或 ready。",
      }
    ),
  ];

  const failedChecks = checks.filter((entry) => entry.passed === false);
  const criticalFailures = failedChecks.filter((entry) => entry.severity === "critical");
  const failureSemantics = buildReleaseFailureSemantics(failedChecks);

  let nextAction =
    text(runbook?.nextStepLabel) ||
    text(cadence?.actionSummary) ||
    text(operatorBoundary?.summary) ||
    "继续结合 smoke 与 deploy 结果判断是否可以放行。";

  if (text(posture?.mode) && text(posture?.mode) !== "normal") {
    nextAction = `先按 ${text(posture.mode)} 姿态锁边界并保全 /api/security 与 /api/device/setup。`;
  } else if (!READY_CONSTRAINED_EXECUTION_STATUSES.has(constrainedStatus)) {
    nextAction = "先停真实执行，查清受限执行为什么退化。";
  } else if (formalRecovery?.durableRestoreReady !== true && text(runbook?.nextStepLabel)) {
    nextAction = `先补正式恢复主线：${text(runbook.nextStepLabel)}。`;
  } else if (!rehearsalFresh && text(cadence?.actionSummary)) {
    nextAction = text(cadence.actionSummary);
  }

  const firstFailed = findFirstFailedCheck(failedChecks);
  const status = failedChecks.length === 0 ? "ready" : "blocked";
  const readinessClass =
    failedChecks.length === 0
      ? "go_live_ready"
      : criticalFailures.length === 0
        ? "pilot_candidate"
        : checks[0]?.passed && checks[1]?.passed
          ? "alpha_candidate"
          : "blocked";

  const blockedBy = failedChecks.map((entry) => ({
    id: entry.id,
    label: entry.label,
    severity: entry.severity,
    actual: entry.actual,
    expected: entry.expected,
    detail: entry.detail,
    failure: buildReleaseCheckFailureSemantics(entry),
  }));

  return {
    status,
    readinessClass,
    checkedAt: new Date().toISOString(),
    nextAction,
    failedCheckCount: failedChecks.length,
    criticalFailureCount: criticalFailures.length,
    blockedBy,
    failureSemantics,
    checks,
    summary:
      status === "ready"
        ? "运行态正式放行前提已满足，继续结合 smoke 与 deploy 结果做最终放行判断。"
        : firstFailed?.detail || firstFailed?.label || "当前运行态还不满足正式放行前提。",
  };
}

export function formatRuntimeReleaseReadinessSummary(readiness = null) {
  if (!readiness || typeof readiness !== "object") {
    return "runtime release readiness: unavailable";
  }
  const blocked =
    Array.isArray(readiness.blockedBy) && readiness.blockedBy.length
      ? ` blocked=${readiness.blockedBy.map((entry) => entry.id).join(",")}`
      : "";
  const nextAction = text(readiness.nextAction) || "none";
  return `runtime release readiness: ${text(readiness.status) || "unknown"}${blocked}; next=${nextAction}`;
}

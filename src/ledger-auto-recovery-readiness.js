import {
  cloneJson,
  normalizeOptionalText,
  normalizeTextList,
} from "./ledger-core-utils.js";
import { buildAutomaticRecoveryReadinessFailureSemantics } from "./runtime-failure-semantics.js";

export const DEFAULT_RUNNER_AUTO_RECOVERY_MAX_ATTEMPTS = 2;

export function filterAutoRecoveryGateReasonsForAction(gateReasons = [], action = null) {
  const normalizedAction = normalizeOptionalText(action) ?? null;
  const normalized = normalizeTextList(gateReasons);
  if (normalizedAction === "bootstrap_runtime") {
    return normalized.filter((reason) => reason !== "bootstrap_ready" && reason !== "local_reasoner_reachable");
  }
  if (normalizedAction === "restore_local_reasoner") {
    return normalized.filter((reason) => reason !== "local_reasoner_reachable");
  }
  if (normalizedAction === "reload_rehydrate_pack") {
    return normalized.filter((reason) => reason !== "local_reasoner_reachable");
  }
  if (normalizedAction === "retry_without_execution") {
    return normalized.filter((reason) =>
      !["bootstrap_ready", "local_reasoner_reachable"].includes(reason)
    );
  }
  return normalized;
}

export function buildAutomaticRecoveryReadiness({
  residentAgentId = null,
  bootstrapGate = null,
  localMode = null,
  localReasonerDiagnostics = null,
  securityPosture = null,
  formalRecoveryFlow = null,
} = {}) {
  const gateReasons = [];
  if (!normalizeOptionalText(residentAgentId)) {
    gateReasons.push("resident_agent_bound");
  }
  if (bootstrapGate?.required) {
    gateReasons.push("bootstrap_ready");
  }
  if (securityPosture?.writeLocked) {
    gateReasons.push(`security_posture_write_locked:${securityPosture.mode}`);
  }
  if (securityPosture?.executionLocked) {
    gateReasons.push(`security_posture_execution_locked:${securityPosture.mode}`);
  }
  if (
    normalizeOptionalText(localMode) === "local_only" &&
    localReasonerDiagnostics &&
    localReasonerDiagnostics.reachable === false
  ) {
    gateReasons.push("local_reasoner_reachable");
  }
  const dependencyWarnings = Array.isArray(formalRecoveryFlow?.missingRequiredCodes)
    ? formalRecoveryFlow.missingRequiredCodes.map((code) => `formal_recovery_flow:${code}`)
    : [];
  const ready = gateReasons.length === 0;
  const cadenceStatus = normalizeOptionalText(formalRecoveryFlow?.operationalCadence?.status) ?? null;
  const nextFormalStepLabel = normalizeOptionalText(formalRecoveryFlow?.runbook?.nextStepLabel) ?? null;
  const actionReadiness = {
    resumeFromRehydratePack: {
      ready: filterAutoRecoveryGateReasonsForAction(gateReasons, "reload_rehydrate_pack").length === 0,
      gateReasons: filterAutoRecoveryGateReasonsForAction(gateReasons, "reload_rehydrate_pack"),
    },
    bootstrapRuntime: {
      ready: filterAutoRecoveryGateReasonsForAction(gateReasons, "bootstrap_runtime").length === 0,
      gateReasons: filterAutoRecoveryGateReasonsForAction(gateReasons, "bootstrap_runtime"),
    },
    restoreLocalReasoner: {
      ready: filterAutoRecoveryGateReasonsForAction(gateReasons, "restore_local_reasoner").length === 0,
      gateReasons: filterAutoRecoveryGateReasonsForAction(gateReasons, "restore_local_reasoner"),
    },
    retryWithoutExecution: {
      ready: filterAutoRecoveryGateReasonsForAction(gateReasons, "retry_without_execution").length === 0,
      gateReasons: filterAutoRecoveryGateReasonsForAction(gateReasons, "retry_without_execution"),
    },
  };
  const status = ready ? (dependencyWarnings.length ? "armed_with_gaps" : "armed") : "gated";
  return {
    status,
    ready,
    gateReasons,
    dependencyWarnings,
    failureSemantics: buildAutomaticRecoveryReadinessFailureSemantics({
      status,
      gateReasons,
      dependencyWarnings,
    }),
    actions: actionReadiness,
    formalFlowReady: Boolean(formalRecoveryFlow?.durableRestoreReady),
    operatorBoundary: {
      neverTreatAsBackupCompletion: true,
      formalFlowReady: Boolean(formalRecoveryFlow?.durableRestoreReady),
      cadenceStatus,
      nextFormalStepLabel,
      summary:
        Boolean(formalRecoveryFlow?.durableRestoreReady)
          ? cadenceStatus === "due_soon"
            ? "自动恢复当前可以受控续跑，但最近一次恢复演练即将到期，仍应尽快补跑正式恢复步骤 3。"
            : "自动恢复当前可以受控续跑，但它始终只是运行态接力，不替代恢复包、恢复演练和初始化包制度。"
          : nextFormalStepLabel
            ? `自动恢复即使能继续，也不能把正式恢复视为完成；当前仍需 ${nextFormalStepLabel}。`
            : "自动恢复即使能继续，也不能把正式恢复视为完成。",
    },
    maxAutomaticRecoveryAttempts: DEFAULT_RUNNER_AUTO_RECOVERY_MAX_ATTEMPTS,
    summary: ready
      ? dependencyWarnings.length
        ? "自动恢复/续跑当前可以启动，闭环能推进，但正式备份恢复流程还有缺口需要补齐。"
        : "自动恢复/续跑当前可以在受控边界内启动，并形成可观察的触发-规划-门禁-续跑闭环。"
      : "自动恢复/续跑当前被安全姿态或初始化门禁拦截。",
  };
}

export function buildPlanSpecificAutomaticRecoveryReadiness(readiness = null, action = null) {
  if (!readiness || typeof readiness !== "object") {
    return {
      ready: false,
      status: "gated",
      gateReasons: [],
      dependencyWarnings: [],
      failureSemantics: buildAutomaticRecoveryReadinessFailureSemantics({
        status: "gated",
        gateReasons: [],
        dependencyWarnings: [],
      }),
      summary: "自动恢复 readiness 不可用。",
    };
  }
  const filteredGateReasons = filterAutoRecoveryGateReasonsForAction(readiness.gateReasons, action);
  const dependencyWarnings = normalizeTextList(readiness.dependencyWarnings);
  const ready = filteredGateReasons.length === 0;
  const status = ready ? (dependencyWarnings.length ? "armed_with_gaps" : "armed") : "gated";
  return {
    ...cloneJson(readiness),
    ready,
    status,
    gateReasons: filteredGateReasons,
    failureSemantics: buildAutomaticRecoveryReadinessFailureSemantics({
      status,
      gateReasons: filteredGateReasons,
      dependencyWarnings,
    }),
    summary: ready
      ? dependencyWarnings.length
        ? "自动恢复/续跑当前可以启动，闭环能推进，但正式备份恢复流程还有缺口需要补齐。"
        : "自动恢复/续跑当前可以在受控边界内启动，并形成可观察的触发-规划-门禁-续跑闭环。"
      : "自动恢复/续跑当前被安全姿态或初始化门禁拦截。",
  };
}

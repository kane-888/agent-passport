function text(value) {
  return String(value ?? "").trim();
}

function compactContext(sourceContext = null) {
  if (!sourceContext || typeof sourceContext !== "object" || Array.isArray(sourceContext)) {
    return null;
  }
  const entries = Object.entries(sourceContext).filter(([, value]) => {
    if (value == null) {
      return false;
    }
    if (typeof value === "string") {
      return text(value).length > 0;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return true;
  });
  return entries.length ? Object.fromEntries(entries) : null;
}

function buildFailure(input = {}) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const {
    code = null,
    category = null,
    boundary = null,
    severity = null,
    machineAction = null,
    operatorAction = null,
    sourceType = null,
    sourceValue = null,
    sourceContext = null,
    summary = null,
  } = input;
  const normalizedCode = text(code) || null;
  if (!normalizedCode) {
    return null;
  }
  return {
    code: normalizedCode,
    category: text(category) || null,
    boundary: text(boundary) || null,
    severity: text(severity) || null,
    machineAction: text(machineAction) || null,
    operatorAction: text(operatorAction) || null,
    sourceType: text(sourceType) || null,
    sourceValue: text(sourceValue) || null,
    sourceContext: compactContext(sourceContext),
    summary: text(summary) || null,
  };
}

function matchPrefixedValue(rawValue, prefix) {
  const normalizedValue = text(rawValue);
  if (!normalizedValue) {
    return { matched: false, suffix: null };
  }
  if (normalizedValue === prefix) {
    return { matched: true, suffix: null };
  }
  if (normalizedValue.startsWith(`${prefix}:`)) {
    return {
      matched: true,
      suffix: text(normalizedValue.slice(prefix.length + 1)) || null,
    };
  }
  return { matched: false, suffix: null };
}

function normalizeFailures(failures = []) {
  const unique = [];
  const seen = new Set();
  for (const failure of Array.isArray(failures) ? failures : []) {
    const normalized = buildFailure(failure);
    if (!normalized) {
      continue;
    }
    const signature = JSON.stringify([
      normalized.code,
      normalized.category,
      normalized.boundary,
      normalized.severity,
      normalized.machineAction,
      normalized.operatorAction,
      normalized.sourceType,
      normalized.sourceValue,
      normalized.sourceContext,
    ]);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    unique.push(normalized);
  }
  return unique;
}

export function buildFailureSemanticsEnvelope(failures = []) {
  const normalized = normalizeFailures(failures);
  const primaryFailure = normalized[0] ?? null;
  return {
    status: normalized.length > 0 ? "present" : "clear",
    failureCount: normalized.length,
    primaryFailure,
    recommendedMachineAction: primaryFailure?.machineAction ?? null,
    recommendedOperatorAction: primaryFailure?.operatorAction ?? null,
    summary: primaryFailure?.summary ?? null,
    failures: normalized,
  };
}

export function buildReleaseCheckFailureSemantics(check = null) {
  if (!check || typeof check !== "object" || check.passed !== false) {
    return null;
  }

  const sourceContext = {
    checkId: text(check.id) || null,
    expected: check.expected ?? null,
    actual: check.actual ?? null,
  };

  switch (text(check.id)) {
    case "health_ok":
      return buildFailure({
        code: "service_health_unhealthy",
        category: "service_runtime",
        boundary: "public_release",
        severity: "critical",
        machineAction: "block_release",
        operatorAction: "restore_service_health",
        sourceType: "release_check",
        sourceValue: "health_ok",
        sourceContext,
        summary: "公开健康探针未通过，当前不能放行。",
      });
    case "service_name":
      return buildFailure({
        code: "service_identity_mismatch",
        category: "service_identity",
        boundary: "public_release",
        severity: "high",
        machineAction: "block_release",
        operatorAction: "fix_service_identity",
        sourceType: "release_check",
        sourceValue: "service_name",
        sourceContext,
        summary: "公开服务标识不是 agent-passport，当前不能放行。",
      });
    case "security_posture_normal":
      return buildFailure({
        code: "security_posture_not_normal",
        category: "security_boundary",
        boundary: "security_posture",
        severity: "critical",
        machineAction: "block_release",
        operatorAction: "normalize_security_posture",
        sourceType: "release_check",
        sourceValue: "security_posture_normal",
        sourceContext,
        summary: "安全姿态不是 normal，当前不能继续放行。",
      });
    case "formal_recovery_ready":
      return buildFailure({
        code: "formal_recovery_incomplete",
        category: "formal_recovery",
        boundary: "formal_recovery",
        severity: "critical",
        machineAction: "block_release",
        operatorAction: "complete_formal_recovery",
        sourceType: "release_check",
        sourceValue: "formal_recovery_ready",
        sourceContext,
        summary: "正式恢复基线未完成，自动恢复不能替代它。",
      });
    case "formal_runbook_ready":
      return buildFailure({
        code: "formal_runbook_unfinished",
        category: "formal_recovery",
        boundary: "formal_recovery",
        severity: "high",
        machineAction: "hold_release",
        operatorAction: "finish_formal_runbook",
        sourceType: "release_check",
        sourceValue: "formal_runbook_ready",
        sourceContext,
        summary: "正式恢复 runbook 还没有收口。",
      });
    case "recovery_rehearsal_fresh":
      return buildFailure({
        code: "recovery_rehearsal_stale",
        category: "recovery_rehearsal",
        boundary: "formal_recovery",
        severity: "high",
        machineAction: "hold_release",
        operatorAction: "refresh_recovery_rehearsal",
        sourceType: "release_check",
        sourceValue: "recovery_rehearsal_fresh",
        sourceContext,
        summary: "恢复演练已经过窗，当前不能按正式放行看待。",
      });
    case "automatic_recovery_boundary_ready":
      return buildFailure({
        code: "automatic_recovery_boundary_not_ready",
        category: "automatic_recovery",
        boundary: "automatic_recovery",
        severity: "critical",
        machineAction: "block_release",
        operatorAction: "align_auto_recovery_boundary",
        sourceType: "release_check",
        sourceValue: "automatic_recovery_boundary_ready",
        sourceContext,
        summary: "自动恢复边界还没有和正式恢复主线对齐。",
      });
    case "constrained_execution_ready":
      return buildFailure({
        code: "constrained_execution_degraded",
        category: "constrained_execution",
        boundary: "constrained_execution",
        severity: "critical",
        machineAction: "stop_execution",
        operatorAction: "repair_constrained_execution",
        sourceType: "release_check",
        sourceValue: "constrained_execution_ready",
        sourceContext,
        summary: "受限执行层已退化或锁死，当前不能放行真实执行。",
      });
    default:
      return buildFailure({
        code: "runtime_release_check_failed",
        category: "release_gate",
        boundary: "public_release",
        severity: text(check.severity) || "high",
        machineAction: "block_release",
        operatorAction: "inspect_release_gate",
        sourceType: "release_check",
        sourceValue: text(check.id) || "unknown_release_check",
        sourceContext,
        summary: text(check.label) || "运行态放行检查未通过。",
      });
  }
}

export function buildReleaseFailureSemantics(checks = []) {
  return buildFailureSemanticsEnvelope(
    (Array.isArray(checks) ? checks : []).map((check) => buildReleaseCheckFailureSemantics(check))
  );
}

function buildAutomaticRecoveryGateReasonFailure(reason = null) {
  const normalizedReason = text(reason);
  if (!normalizedReason) {
    return null;
  }

  if (normalizedReason === "resident_agent_bound") {
    return buildFailure({
      code: "resident_agent_unbound",
      category: "runtime_bootstrap",
      boundary: "automatic_recovery",
      severity: "critical",
      machineAction: "stop_auto_recovery",
      operatorAction: "bind_resident_agent",
      sourceType: "auto_recovery_gate_reason",
      sourceValue: "resident_agent_bound",
      sourceContext: {
        gateReason: "resident_agent_bound",
      },
      summary: "常驻 agent 未绑定，自动恢复没有接力对象。",
    });
  }

  if (normalizedReason === "bootstrap_ready") {
    return buildFailure({
      code: "runtime_bootstrap_incomplete",
      category: "runtime_bootstrap",
      boundary: "automatic_recovery",
      severity: "critical",
      machineAction: "stop_auto_recovery",
      operatorAction: "complete_bootstrap_runtime",
      sourceType: "auto_recovery_gate_reason",
      sourceValue: "bootstrap_ready",
      sourceContext: {
        gateReason: "bootstrap_ready",
      },
      summary: "最小 bootstrap 未完成，自动恢复不能续跑。",
    });
  }

  const writeLocked = matchPrefixedValue(normalizedReason, "security_posture_write_locked");
  if (writeLocked.matched) {
    return buildFailure({
      code: "security_posture_locked",
      category: "security_boundary",
      boundary: "automatic_recovery",
      severity: "critical",
      machineAction: "stop_auto_recovery",
      operatorAction: "normalize_security_posture",
      sourceType: "auto_recovery_gate_reason",
      sourceValue: "security_posture_write_locked",
      sourceContext: {
        gateReason: "security_posture_write_locked",
        lockType: "write",
        mode: writeLocked.suffix,
      },
      summary: "安全姿态已锁写入，自动恢复被门禁拦截。",
    });
  }

  const executionLocked = matchPrefixedValue(normalizedReason, "security_posture_execution_locked");
  if (executionLocked.matched) {
    return buildFailure({
      code: "security_posture_locked",
      category: "security_boundary",
      boundary: "automatic_recovery",
      severity: "critical",
      machineAction: "stop_auto_recovery",
      operatorAction: "normalize_security_posture",
      sourceType: "auto_recovery_gate_reason",
      sourceValue: "security_posture_execution_locked",
      sourceContext: {
        gateReason: "security_posture_execution_locked",
        lockType: "execution",
        mode: executionLocked.suffix,
      },
      summary: "安全姿态已锁执行，自动恢复被门禁拦截。",
    });
  }

  if (normalizedReason === "local_reasoner_reachable") {
    return buildFailure({
      code: "local_reasoner_unreachable",
      category: "local_reasoner",
      boundary: "automatic_recovery",
      severity: "high",
      machineAction: "hold_auto_recovery",
      operatorAction: "restore_local_reasoner",
      sourceType: "auto_recovery_gate_reason",
      sourceValue: "local_reasoner_reachable",
      sourceContext: {
        gateReason: "local_reasoner_reachable",
      },
      summary: "本地 reasoner 不可达，当前恢复动作不能依赖它。",
    });
  }

  return buildFailure({
    code: "automatic_recovery_gate_blocked",
    category: "automatic_recovery_gate",
    boundary: "automatic_recovery",
    severity: "high",
    machineAction: "hold_auto_recovery",
    operatorAction: "inspect_auto_recovery_gate",
    sourceType: "auto_recovery_gate_reason",
    sourceValue: normalizedReason,
    sourceContext: {
      gateReason: normalizedReason,
    },
    summary: "自动恢复被运行时门禁拦截。",
  });
}

function buildAutomaticRecoveryDependencyWarningFailure(warning = null) {
  const normalizedWarning = text(warning);
  if (!normalizedWarning) {
    return null;
  }

  const formalRecoveryGap = matchPrefixedValue(normalizedWarning, "formal_recovery_flow");
  if (formalRecoveryGap.matched) {
    return buildFailure({
      code: "formal_recovery_incomplete",
      category: "formal_recovery",
      boundary: "formal_recovery",
      severity: "high",
      machineAction: "continue_with_warning",
      operatorAction: "complete_formal_recovery",
      sourceType: "auto_recovery_dependency_warning",
      sourceValue: "formal_recovery_flow",
      sourceContext: {
        dependencyCode: formalRecoveryGap.suffix,
      },
      summary: "正式恢复流程还有缺口，当前自动恢复只可受控续跑。",
    });
  }

  const reasonerRestoreFailure = matchPrefixedValue(normalizedWarning, "restore_local_reasoner_failed");
  if (reasonerRestoreFailure.matched) {
    return buildFailure({
      code: "local_reasoner_restore_failed",
      category: "local_reasoner",
      boundary: "automatic_recovery",
      severity: "high",
      machineAction: "continue_with_fallback",
      operatorAction: "repair_local_reasoner",
      sourceType: "auto_recovery_dependency_warning",
      sourceValue: "restore_local_reasoner_failed",
      sourceContext: {
        attemptedAction: "restore_local_reasoner",
      },
      summary: "本地 reasoner 恢复失败，当前需要降级或排查本地推理层。",
    });
  }

  const planFailure = matchPrefixedValue(normalizedWarning, "auto_recovery_plan_failed");
  if (planFailure.matched) {
    return buildFailure({
      code: "auto_recovery_plan_failed",
      category: "automatic_recovery_execution",
      boundary: "automatic_recovery",
      severity: "critical",
      machineAction: "stop_auto_recovery",
      operatorAction: "inspect_auto_recovery_plan",
      sourceType: "auto_recovery_dependency_warning",
      sourceValue: "auto_recovery_plan_failed",
      sourceContext: {
        action: planFailure.suffix,
      },
      summary: "自动恢复计划执行失败。",
    });
  }

  return buildFailure({
    code: "automatic_recovery_dependency_warning",
    category: "automatic_recovery_dependency",
    boundary: "automatic_recovery",
    severity: "high",
    machineAction: "continue_with_warning",
    operatorAction: "inspect_auto_recovery_dependency",
    sourceType: "auto_recovery_dependency_warning",
    sourceValue: normalizedWarning,
    sourceContext: {
      warning: normalizedWarning,
    },
    summary: "自动恢复依赖面存在未收口缺口。",
  });
}

export function buildAutomaticRecoveryReadinessFailureSemantics({
  gateReasons = [],
  dependencyWarnings = [],
} = {}) {
  const failures = [
    ...(Array.isArray(gateReasons) ? gateReasons : []).map((reason) => buildAutomaticRecoveryGateReasonFailure(reason)),
    ...(Array.isArray(dependencyWarnings) ? dependencyWarnings : []).map((warning) =>
      buildAutomaticRecoveryDependencyWarningFailure(warning)
    ),
  ];
  return buildFailureSemanticsEnvelope(failures);
}

function buildAutoRecoveryStatusFailure(autoRecovery = null) {
  if (!autoRecovery || typeof autoRecovery !== "object") {
    return null;
  }

  const status = text(autoRecovery.status);
  const sourceContext = {
    status: status || null,
    action: text(autoRecovery.plan?.action) || null,
    attempt: autoRecovery.attempt == null ? null : Number(autoRecovery.attempt),
    maxAttempts: autoRecovery.maxAttempts == null ? null : Number(autoRecovery.maxAttempts),
    finalStatus: text(autoRecovery.finalStatus) || null,
  };

  switch (status) {
    case "disabled":
      return buildFailure({
        code: "auto_recovery_disabled",
        category: "automatic_recovery_configuration",
        boundary: "automatic_recovery",
        severity: "high",
        machineAction: "skip_auto_recovery",
        operatorAction: "enable_auto_recovery",
        sourceType: "auto_recovery_status",
        sourceValue: "disabled",
        sourceContext,
        summary: "自动恢复已关闭，当前不会继续。",
      });
    case "human_review_required":
      return buildFailure({
        code: "human_review_required",
        category: "operator_review",
        boundary: "automatic_recovery",
        severity: "high",
        machineAction: "await_operator_review",
        operatorAction: "review_recovery_case",
        sourceType: "auto_recovery_status",
        sourceValue: "human_review_required",
        sourceContext,
        summary: "当前恢复类型需要人工复核，自动恢复不会继续。",
      });
    case "max_attempts_reached":
      return buildFailure({
        code: "auto_recovery_max_attempts_reached",
        category: "automatic_recovery_execution",
        boundary: "automatic_recovery",
        severity: "critical",
        machineAction: "stop_auto_recovery",
        operatorAction: "inspect_auto_recovery_attempts",
        sourceType: "auto_recovery_status",
        sourceValue: "max_attempts_reached",
        sourceContext,
        summary: "自动恢复已达到最大尝试次数。",
      });
    case "resume_boundary_unavailable":
      return buildFailure({
        code: "resume_boundary_missing",
        category: "resume_boundary",
        boundary: "automatic_recovery",
        severity: "critical",
        machineAction: "stop_auto_recovery",
        operatorAction: "regenerate_resume_boundary",
        sourceType: "auto_recovery_status",
        sourceValue: "resume_boundary_unavailable",
        sourceContext,
        summary: "缺少可复用的 resume boundary，自动恢复无法续跑。",
      });
    case "loop_detected":
      return buildFailure({
        code: "resume_loop_detected",
        category: "resume_boundary",
        boundary: "automatic_recovery",
        severity: "critical",
        machineAction: "stop_auto_recovery",
        operatorAction: "inspect_resume_boundary_chain",
        sourceType: "auto_recovery_status",
        sourceValue: "loop_detected",
        sourceContext,
        summary: "检测到重复 resume boundary，已停止自动恢复以避免循环。",
      });
    case "failed":
      return buildFailure({
        code: "auto_recovery_execution_failed",
        category: "automatic_recovery_execution",
        boundary: "automatic_recovery",
        severity: "critical",
        machineAction: "stop_auto_recovery",
        operatorAction: "inspect_auto_recovery_failure",
        sourceType: "auto_recovery_status",
        sourceValue: "failed",
        sourceContext,
        summary: "自动恢复执行阶段失败。",
      });
    case "gated":
      return buildFailure({
        code: "automatic_recovery_gated",
        category: "automatic_recovery_gate",
        boundary: "automatic_recovery",
        severity: "high",
        machineAction: "hold_auto_recovery",
        operatorAction: "inspect_auto_recovery_gate",
        sourceType: "auto_recovery_status",
        sourceValue: "gated",
        sourceContext,
        summary: "自动恢复当前被门禁拦截。",
      });
    default:
      return null;
  }
}

export function buildAutoRecoveryFailureSemantics(autoRecovery = null) {
  if (!autoRecovery || typeof autoRecovery !== "object") {
    return buildFailureSemanticsEnvelope([]);
  }

  const baseFailures = buildAutomaticRecoveryReadinessFailureSemantics({
    gateReasons: autoRecovery.gateReasons,
    dependencyWarnings: autoRecovery.dependencyWarnings,
  }).failures;
  const statusFailure = buildAutoRecoveryStatusFailure(autoRecovery);
  const includeStatusFailure =
    statusFailure &&
    !(
      statusFailure.code === "automatic_recovery_gated" &&
      Array.isArray(baseFailures) &&
      baseFailures.length > 0
    );

  return buildFailureSemanticsEnvelope([
    ...baseFailures,
    includeStatusFailure ? statusFailure : null,
  ]);
}

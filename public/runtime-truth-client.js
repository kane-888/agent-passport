export function text(value, fallback = "未确认") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

const STATUS_TEXT = {
  normal: "正常",
  read_only: "只读",
  disable_exec: "禁执行",
  panic: "紧急锁定",
  ready: "已就绪",
  partial: "部分就绪",
  blocked: "被阻塞",
  missing: "缺失",
  overdue: "已过期",
  due_soon: "即将到期",
  within_window: "窗口内",
  optional_ready: "可选但已保留",
  optional_missing: "可选但缺失",
  bounded: "有界放行",
  bounded_network: "有界联网",
  restricted: "最小权限",
  degraded: "已退化",
  locked: "已锁定",
  armed: "可启动",
  armed_with_gaps: "可启动但有缺口",
  gated: "被门禁拦截",
  ready_for_rehearsal: "可开始演练",
  protected: "已受保护",
  enforced: "已强制启用",
  pending: "处理中",
  passed: "已通过",
};

export function statusLabel(value, fallback = "未确认") {
  const normalized = String(value ?? "").trim();
  return STATUS_TEXT[normalized] || (normalized ? normalized.replaceAll("_", " ") : fallback);
}

export function boolLabel(value, { trueLabel = "是", falseLabel = "否", unknownLabel = "未确认" } = {}) {
  if (value === true) {
    return trueLabel;
  }
  if (value === false) {
    return falseLabel;
  }
  return unknownLabel;
}

export function normalizeTriggerLabel(entry, fallback = "未命名触发条件") {
  if (typeof entry === "string") {
    return text(entry, fallback);
  }
  return text(entry?.label ?? entry?.summary ?? entry?.code, fallback);
}

export function normalizeTriggerLabels(entries, { limit = 3 } = {}) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.slice(0, limit).map((entry) => normalizeTriggerLabel(entry));
}

export function getOperatorHandbookSummary(security = null) {
  return text(
    security?.securityArchitecture?.operatorHandbook?.summary,
    "按固定顺序收口值班判断。"
  );
}

export function selectRuntimeTruth({ security = null, setup = null } = {}) {
  const formalRecovery = setup?.formalRecoveryFlow || security?.localStorageFormalFlow || null;
  const automaticRecovery = setup?.automaticRecoveryReadiness || security?.automaticRecovery || null;

  return {
    posture: security?.securityPosture || null,
    storeEncryption: formalRecovery?.storeEncryption || security?.localStorageFormalFlow?.storeEncryption || null,
    formalRecovery,
    cadence: formalRecovery?.operationalCadence || null,
    constrainedExecution:
      setup?.deviceRuntime?.constrainedExecutionSummary || security?.constrainedExecution || null,
    automaticRecovery,
    operatorBoundary: automaticRecovery?.operatorBoundary || null,
    crossDevice: formalRecovery?.crossDeviceRecoveryClosure || null,
  };
}

export function buildPublicRuntimeSnapshot({ health = null, security = null } = {}) {
  const truth = selectRuntimeTruth({ security });
  const postureStatusLabel = statusLabel(truth.posture?.mode);
  const formalRecoveryStatusLabel = statusLabel(truth.formalRecovery?.status);
  const automaticRecoveryStatusLabel = statusLabel(truth.automaticRecovery?.status);
  const triggerLabels = normalizeTriggerLabels(truth.cadence?.rerunTriggers);

  return {
    hostBinding: security?.hostBinding || health?.hostBinding || "127.0.0.1",
    operatorEntrySummary: getOperatorHandbookSummary(security),
    postureStatusLabel,
    formalRecoveryStatusLabel,
    automaticRecoveryStatusLabel,
    healthSummary: health?.ok
      ? `服务可达，默认绑定 ${security?.hostBinding || health?.hostBinding || "127.0.0.1"}。`
      : "健康探测未通过。",
    healthDetail: `当前安全姿态：${postureStatusLabel}。${text(truth.posture?.summary, "尚无额外摘要。")}`,
    recoverySummary: text(
      truth.cadence?.summary,
      text(truth.formalRecovery?.summary, "尚未读取正式恢复状态。")
    ),
    recoveryDetail: text(
      truth.cadence?.actionSummary,
      text(truth.formalRecovery?.runbook?.nextStepSummary, "尚未读取下一步。")
    ),
    automationSummary: text(
      truth.operatorBoundary?.summary,
      text(truth.automaticRecovery?.summary, "尚未读取自动恢复边界。")
    ),
    automationDetail: text(
      truth.automaticRecovery?.summary,
      text(truth.operatorBoundary?.summary, "当前没有额外自动化边界摘要。")
    ),
    triggerLabels,
    homeSummary: `公开运行态已加载：姿态 ${postureStatusLabel}，正式恢复 ${formalRecoveryStatusLabel}，自动恢复 ${automaticRecoveryStatusLabel}。`,
  };
}

export function buildSecurityBoundarySnapshot(security = null) {
  const truth = selectRuntimeTruth({ security });

  return {
    summary: `已读取公开安全与恢复边界：本地存储 ${statusLabel(truth.storeEncryption?.status)}，正式恢复 ${statusLabel(truth.formalRecovery?.status)}，受限执行 ${statusLabel(truth.constrainedExecution?.status)}，自动恢复 ${statusLabel(truth.automaticRecovery?.status)}。`,
    localStoreSummary:
      truth.storeEncryption?.status === "protected"
        ? truth.storeEncryption?.systemProtected === true
          ? "本地账本与密钥已进入系统保护层。"
          : "本地账本已加密，但系统保护层还没完全到位。"
        : "本地账本与密钥还没达到受保护状态。",
    localStoreDetails: [
      `状态：${statusLabel(truth.storeEncryption?.status)}`,
      `系统保护：${boolLabel(truth.storeEncryption?.systemProtected, { trueLabel: "已启用", falseLabel: "未启用" })}`,
      `恢复基线：${boolLabel(security?.localStore?.recoveryBaselineReady, { trueLabel: "已就绪", falseLabel: "未就绪" })}`,
    ],
    formalRecoverySummary: text(truth.formalRecovery?.summary, "当前没有正式恢复摘要。"),
    formalRecoveryDetails: [
      `状态：${statusLabel(truth.formalRecovery?.status)}`,
      `下一步：${text(truth.formalRecovery?.runbook?.nextStepLabel)}`,
      `周期：${statusLabel(truth.cadence?.status)}`,
    ],
    constrainedExecutionSummary: text(truth.constrainedExecution?.summary, "当前没有受限执行摘要。"),
    constrainedExecutionDetails: [
      `状态：${statusLabel(truth.constrainedExecution?.status)}`,
      `系统级调度沙箱：${statusLabel(truth.constrainedExecution?.systemBrokerSandbox?.status)}`,
      `预算/能力：${text(truth.constrainedExecution?.systemBrokerSandbox?.summary, "当前没有额外摘要。")}`,
    ],
    automaticRecoverySummary: text(truth.automaticRecovery?.summary, "当前没有自动恢复边界摘要。"),
    automaticRecoveryDetails: [
      `状态：${statusLabel(truth.automaticRecovery?.status)}`,
      `正式恢复已达标：${boolLabel(truth.operatorBoundary?.formalFlowReady, { trueLabel: "是", falseLabel: "否" })}`,
      `值班边界：${text(truth.operatorBoundary?.summary, "当前没有值班边界摘要。")}`,
    ],
  };
}

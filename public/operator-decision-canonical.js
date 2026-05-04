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
  failed: "失败",
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

export function hasFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function clampRuntimeRiskScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(1, numeric));
}

function formatRuntimeRiskScore(value) {
  const numeric = clampRuntimeRiskScore(value);
  return numeric == null ? null : numeric.toFixed(2);
}

function qualityEscalationReasonLabel(value, fallback = "未确认") {
  const normalized = text(value, "");
  if (!normalized) {
    return fallback;
  }
  const labels = {
    verification_invalid: "本地答案未通过校验",
    memory_stability_unstable: "记忆稳态风险升高",
    online_not_allowed: "当前不允许联网增强",
    verification_passed: "本地答案已通过校验",
  };
  return labels[normalized] || normalized.replaceAll("_", " ");
}

function runtimeReasonerProviderLabel(value, fallback = "未确认") {
  const normalized = text(value, "");
  if (!normalized) {
    return fallback;
  }
  const labels = {
    ollama_local: "Ollama 本地推理",
    local_command: "本地命令推理",
    openai_compatible: "联网增强",
    http: "远端推理",
    local_mock: "本地回退",
    mock: "本地回退",
  };
  return labels[normalized] || normalized.replaceAll("_", " ");
}

function memoryStabilityRunnerGuardBlockedByLabel(value, fallback = "未确认") {
  const normalized = text(value, "");
  if (!normalized) {
    return fallback;
  }
  const labels = {
    memory_stability_runtime_gate: "runtime gate",
    memory_stability_prompt_preflight: "prompt 预检",
    memory_stability_prompt_pretransform: "prompt 预变换",
  };
  return labels[normalized] || normalized.replaceAll("_", " ");
}

function memoryStabilityRunnerGuardRequestKindLabel(value, fallback = "未确认") {
  const normalized = text(value, "");
  if (!normalized) {
    return fallback;
  }
  const labels = {
    kernel_preview: "kernel 预览",
    prompt_preflight: "prompt 预检",
    prompt_pretransform: "prompt 预变换",
  };
  return labels[normalized] || normalized.replaceAll("_", " ");
}

function memoryStabilityCorrectionLabel(value, fallback = "未确认") {
  const normalized = text(value, "");
  if (!normalized) {
    return fallback;
  }
  const labels = {
    none: "稳定",
    light: "轻微纠偏",
    mild: "轻微纠偏",
    medium: "中度纠偏",
    strong: "强纠偏",
  };
  return labels[normalized] || normalized.replaceAll("_", " ");
}

function runtimePlainLabel(value, fallback = "未确认") {
  const normalized = text(value, "");
  return normalized ? normalized.replaceAll("_", " ") : fallback;
}

function formatRuntimeIssueCodes(issueCodes = []) {
  const normalized = (Array.isArray(issueCodes) ? issueCodes : [])
    .map((entry) => text(entry, ""))
    .filter(Boolean);
  return normalized.length > 0 ? normalized.map((entry) => entry.replaceAll("_", " ")).join(" / ") : "";
}

function formatMemoryStabilityRunnerGuardRequestKinds(values) {
  if (!Array.isArray(values)) {
    return "";
  }
  return values
    .map((value) => memoryStabilityRunnerGuardRequestKindLabel(value, ""))
    .filter(Boolean)
    .join(" / ");
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFallbackText(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /尚未读取|当前没有|暂无|未确认|缺失/.test(normalized);
}

export function hasTruthText(value) {
  return hasText(value) && !isFallbackText(value);
}

export function hasBoolean(value) {
  return typeof value === "boolean";
}

function hasTextList(values) {
  return Array.isArray(values) && values.some((value) => hasText(value));
}

function agentRuntimeHasMemoryAlert(agentRuntime = null) {
  return ["medium", "strong"].includes(text(agentRuntime?.latestMemoryStabilityCorrectionLevel, ""));
}

function agentRuntimeMemoryAlertTone(agentRuntime = null) {
  const correctionLevel = text(agentRuntime?.latestMemoryStabilityCorrectionLevel, "");
  const riskScore = clampRuntimeRiskScore(agentRuntime?.latestMemoryStabilityRiskScore);
  return correctionLevel === "strong" || (riskScore != null && riskScore >= 0.6) ? "danger" : "warn";
}

export function appendAgentRuntimeMemoryTruthMissingFields(missingFields = [], agentRuntime = null, prefix = "agentRuntime") {
  if (!hasFiniteNumber(agentRuntime?.memoryStabilityStateCount)) {
    missingFields.push(`${prefix}.memoryStabilityStateCount`);
    return missingFields;
  }
  if (Number(agentRuntime.memoryStabilityStateCount || 0) <= 0) {
    return missingFields;
  }
  if (!hasTruthText(agentRuntime.latestMemoryStabilityCorrectionLevel)) {
    missingFields.push(`${prefix}.latestMemoryStabilityCorrectionLevel`);
  }
  if (!hasFiniteNumber(agentRuntime.latestMemoryStabilityRiskScore)) {
    missingFields.push(`${prefix}.latestMemoryStabilityRiskScore`);
  }
  if (!hasTruthText(agentRuntime.latestMemoryStabilityStateId)) {
    missingFields.push(`${prefix}.latestMemoryStabilityStateId`);
  }
  if (!hasTruthText(agentRuntime.latestMemoryStabilityUpdatedAt)) {
    missingFields.push(`${prefix}.latestMemoryStabilityUpdatedAt`);
  }
  if (!hasTruthText(agentRuntime.latestMemoryStabilityObservationKind)) {
    missingFields.push(`${prefix}.latestMemoryStabilityObservationKind`);
  }
  if (["light", "mild", "medium", "strong"].includes(text(agentRuntime.latestMemoryStabilityCorrectionLevel, ""))) {
    if (!hasFiniteNumber(agentRuntime.memoryStabilityRecoveryRate)) {
      missingFields.push(`${prefix}.memoryStabilityRecoveryRate`);
    }
    if (!hasTextList(agentRuntime.latestMemoryStabilityCorrectionActions)) {
      missingFields.push(`${prefix}.latestMemoryStabilityCorrectionActions`);
    }
  }
  return missingFields;
}

export function appendAgentRuntimeRunnerGuardMissingFields(missingFields = [], agentRuntime = null, prefix = "agentRuntime") {
  if (agentRuntime?.latestRunnerGuardActivated !== true) {
    return missingFields;
  }
  if (!hasTruthText(agentRuntime.latestRunStatus)) {
    missingFields.push(`${prefix}.latestRunStatus`);
  }
  if (!hasTruthText(agentRuntime.latestRunnerGuardBlockedBy)) {
    missingFields.push(`${prefix}.latestRunnerGuardBlockedBy`);
  }
  if (!hasTruthText(agentRuntime.latestRunnerGuardCode)) {
    missingFields.push(`${prefix}.latestRunnerGuardCode`);
  }
  if (!hasTruthText(agentRuntime.latestRunnerGuardStage)) {
    missingFields.push(`${prefix}.latestRunnerGuardStage`);
  }
  if (!hasTruthText(agentRuntime.latestRunnerGuardReceiptStatus)) {
    missingFields.push(`${prefix}.latestRunnerGuardReceiptStatus`);
  }
  if (!hasTextList(agentRuntime.latestRunnerGuardExplicitRequestKinds)) {
    missingFields.push(`${prefix}.latestRunnerGuardExplicitRequestKinds`);
  }
  return missingFields;
}

export function listCanonicalAgentRuntimeTruthMissingFields(agentRuntime = null, prefix = "agentRuntime") {
  const missingFields = [];
  if (!agentRuntime || typeof agentRuntime !== "object") {
    missingFields.push(prefix);
    return missingFields;
  }
  if (!hasBoolean(agentRuntime.localFirst)) {
    missingFields.push(`${prefix}.localFirst`);
  }
  if (!hasTruthText(agentRuntime.policy)) {
    missingFields.push(`${prefix}.policy`);
  }
  if (!hasBoolean(agentRuntime.onlineAllowed)) {
    missingFields.push(`${prefix}.onlineAllowed`);
  }
  if (!hasFiniteNumber(agentRuntime.qualityEscalationRuns)) {
    missingFields.push(`${prefix}.qualityEscalationRuns`);
  }
  appendAgentRuntimeRunnerGuardMissingFields(missingFields, agentRuntime, prefix);
  if (!hasBoolean(agentRuntime.latestQualityEscalationActivated)) {
    missingFields.push(`${prefix}.latestQualityEscalationActivated`);
  }
  if (agentRuntime.latestQualityEscalationActivated === true) {
    if (!hasTruthText(agentRuntime.latestQualityEscalationProvider)) {
      missingFields.push(`${prefix}.latestQualityEscalationProvider`);
    }
    if (!hasTruthText(agentRuntime.latestQualityEscalationReason)) {
      missingFields.push(`${prefix}.latestQualityEscalationReason`);
    }
  }
  appendAgentRuntimeMemoryTruthMissingFields(missingFields, agentRuntime, prefix);
  return missingFields;
}

export function getReleaseReadiness(security = null) {
  const readiness = security?.releaseReadiness;
  return readiness && typeof readiness === "object" ? readiness : null;
}

export function releaseReadinessTone(severity = "") {
  if (severity === "critical") {
    return "danger";
  }
  if (severity === "high") {
    return "warn";
  }
  return "";
}

export function buildReleaseReadinessAlerts(releaseReadiness = null) {
  const blockedBy = Array.isArray(releaseReadiness?.blockedBy) ? releaseReadiness.blockedBy.filter(Boolean) : [];
  return blockedBy.map((entry) => ({
    tone: releaseReadinessTone(text(entry?.severity, "")),
    title: text(entry?.label, "未命名放行检查"),
    detail: text(entry?.detail, "当前运行态放行前提未满足。"),
    notes: [
      text(entry?.actual, "") ? `实际值：${text(entry.actual, "")}` : null,
      text(entry?.expected, "") ? `期望值：${text(entry.expected, "")}` : null,
    ].filter(Boolean),
  }));
}

export function buildCanonicalOperatorAlerts({ security = null, truth = null } = {}) {
  const releaseReadiness = getReleaseReadiness(security);
  const readinessAlerts = buildReleaseReadinessAlerts(releaseReadiness);
  const agentRuntime = truth?.agentRuntime || null;
  const alerts = [...readinessAlerts];

  if (truth?.posture?.mode && truth.posture.mode !== "normal") {
    alerts.push({
      tone: truth.posture.mode === "panic" ? "danger" : "warn",
      title: `安全姿态已提升到 ${statusLabel(truth.posture.mode)}`,
      detail: text(truth.posture.summary, "先按当前姿态保全现场，再讨论是否恢复业务。"),
    });
  }

  if (["missing", "overdue", "due_soon"].includes(truth?.cadence?.status)) {
    alerts.push({
      tone: truth.cadence.status === "due_soon" ? "warn" : "danger",
      title: `正式恢复周期 ${statusLabel(truth.cadence.status)}`,
      detail: text(
        truth.cadence.actionSummary,
        "正式恢复周期没有保持在安全窗口内，不能把自动恢复当成交付级恢复。"
      ),
    });
  }

  if (truth?.operatorBoundary?.formalFlowReady === false) {
    alerts.push({
      tone: "danger",
      title: "自动恢复不能冒充正式恢复完成",
      detail: text(
        truth.operatorBoundary.summary,
        "自动恢复即使能续跑，也不代表恢复包、恢复演练和初始化包已经收口。"
      ),
    });
  }

  if (["degraded", "locked"].includes(truth?.constrainedExecution?.status)) {
    alerts.push({
      tone: "danger",
      title: `受限执行层 ${statusLabel(truth.constrainedExecution.status)}`,
      detail: text(
        truth.constrainedExecution.summary,
        "受限执行边界已退化或被锁住，先停继续执行，再解释清楚为什么。"
      ),
      notes: Array.isArray(truth.constrainedExecution?.warnings)
        ? truth.constrainedExecution.warnings.slice(0, 3).map((entry) => `warning: ${entry}`)
        : [],
    });
  }

  if (truth?.crossDevice?.readyForCutover === false) {
    alerts.push({
      tone: truth.crossDevice?.readyForRehearsal ? "warn" : "danger",
      title: truth.crossDevice?.readyForRehearsal ? "跨机器恢复现在只能做演练" : "跨机器恢复还不能开始",
      detail: text(
        truth.crossDevice?.cutoverGate?.summary || truth.crossDevice?.summary,
        "没有目标机器通过记录前，不能把系统标成可切机。"
      ),
      notes: Array.isArray(truth.crossDevice?.sourceBlockingReasons)
        ? truth.crossDevice.sourceBlockingReasons.slice(0, 3)
        : [],
    });
  }

  if (agentRuntime?.latestRunnerGuardActivated === true) {
    const runnerGuardRequestKinds = formatMemoryStabilityRunnerGuardRequestKinds(
      agentRuntime.latestRunnerGuardExplicitRequestKinds
    );
    alerts.push({
      tone: "danger",
      title: "最近一次运行被记忆稳态护栏阻断",
      detail: `最近一次显式 memory-stability 请求在 ${memoryStabilityRunnerGuardBlockedByLabel(
        agentRuntime.latestRunnerGuardBlockedBy
      )} 被 fail-closed 拦下，先修 runtime contract 或 prompt 预处理链。`,
      notes: [
        text(agentRuntime.latestRunnerGuardCode, "")
          ? `阻断码：${text(agentRuntime.latestRunnerGuardCode)}`
          : null,
        text(agentRuntime.latestRunnerGuardReceiptStatus, "")
          ? `回执：${runtimePlainLabel(agentRuntime.latestRunnerGuardReceiptStatus)}`
          : null,
        runnerGuardRequestKinds ? `显式请求：${runnerGuardRequestKinds}` : null,
      ].filter(Boolean),
    });
  } else if (text(agentRuntime?.latestQualityEscalationReason, "") === "online_not_allowed") {
    const issueCodes = formatRuntimeIssueCodes(agentRuntime?.latestQualityEscalationIssueCodes);
    alerts.push({
      tone: "danger",
      title: "本地答案未过校验且当前不能联网补强",
      detail: `最近一次质量判定为 ${qualityEscalationReasonLabel(
        agentRuntime?.latestQualityEscalationReason
      )}，当前需要先放开允许的复核通道或改成人工复核。`,
      notes: [
        text(agentRuntime?.latestQualityEscalationProvider, "")
          ? `候选通道：${runtimeReasonerProviderLabel(agentRuntime.latestQualityEscalationProvider)}`
          : null,
        issueCodes ? `校验问题：${issueCodes}` : null,
      ].filter(Boolean),
    });
  } else if (agentRuntime?.latestQualityEscalationActivated === true) {
    const issueCodes = formatRuntimeIssueCodes(agentRuntime?.latestQualityEscalationIssueCodes);
    alerts.push({
      tone: "warn",
      title: "最近一次回答已触发质量升级",
      detail: `最近一次输出已从本地优先转入 ${runtimeReasonerProviderLabel(
        agentRuntime?.latestQualityEscalationProvider,
        "增强通道"
      )} 复核。`,
      notes: [
        text(agentRuntime?.latestQualityEscalationReason, "")
          ? `触发原因：${qualityEscalationReasonLabel(agentRuntime.latestQualityEscalationReason)}`
          : null,
        issueCodes ? `校验问题：${issueCodes}` : null,
      ].filter(Boolean),
    });
  }

  if (agentRuntimeHasMemoryAlert(agentRuntime)) {
    alerts.push({
      tone: agentRuntimeMemoryAlertTone(agentRuntime),
      title: `记忆稳态 ${memoryStabilityCorrectionLabel(agentRuntime?.latestMemoryStabilityCorrectionLevel, "未确认")}`,
      detail:
        formatRuntimeRiskScore(agentRuntime?.latestMemoryStabilityRiskScore) == null
          ? "最近一次运行已进入记忆稳态纠偏窗口，先复核当前上下文是否需要重载。"
          : `最近一次运行已进入记忆稳态纠偏窗口，风险 ${formatRuntimeRiskScore(
              agentRuntime?.latestMemoryStabilityRiskScore
            )}。`,
      notes: [
        text(agentRuntime?.latestMemoryStabilitySignalSource, "")
          ? `信号来源：${runtimePlainLabel(agentRuntime.latestMemoryStabilitySignalSource)}`
          : null,
        text(agentRuntime?.latestMemoryStabilityPreflightStatus, "")
          ? `预检状态：${runtimePlainLabel(agentRuntime.latestMemoryStabilityPreflightStatus)}`
          : null,
        text(agentRuntime?.latestMemoryStabilityStateId, "")
          ? `状态 ID：${text(agentRuntime.latestMemoryStabilityStateId)}`
          : null,
      ].filter(Boolean),
    });
  }

  return alerts;
}

export function selectCanonicalOperatorDecisionAlert(alerts = [], agentRuntime = null) {
  const normalizedAlerts = Array.isArray(alerts) ? alerts : [];
  if (agentRuntime?.latestRunnerGuardActivated === true) {
    const runnerGuardAlert = normalizedAlerts.find(
      (entry) => text(entry?.title, "") === "最近一次运行被记忆稳态护栏阻断"
    );
    if (runnerGuardAlert) {
      return runnerGuardAlert;
    }
  }
  return normalizedAlerts[0] || null;
}

export function buildCanonicalOperatorNextAction({ releaseReadiness = null, truth = null } = {}) {
  if (truth?.posture?.mode && truth.posture.mode !== "normal") {
    return `先按 ${statusLabel(truth.posture.mode)} 姿态锁边界并保全 /api/security 与 /api/device/setup。`;
  }
  if (["degraded", "locked"].includes(truth?.constrainedExecution?.status)) {
    return "先停真实执行，查清受限执行为什么退化。";
  }
  if (truth?.agentRuntime?.latestRunnerGuardActivated === true) {
    return `先修复记忆稳态护栏阻断：${memoryStabilityRunnerGuardBlockedByLabel(
      truth.agentRuntime?.latestRunnerGuardBlockedBy
    )} / ${text(truth.agentRuntime?.latestRunnerGuardCode, "未确认")}。`;
  }
  if (text(truth?.agentRuntime?.latestQualityEscalationReason, "") === "online_not_allowed") {
    return "先处理本地答案未过校验但又不能联网补强的问题，必要时改成人工复核。";
  }
  if (truth?.agentRuntime?.latestQualityEscalationActivated === true) {
    return `先复核最近一次为什么转入 ${runtimeReasonerProviderLabel(
      truth.agentRuntime?.latestQualityEscalationProvider,
      "增强通道"
    )}，确认本地答案到底错在哪。`;
  }
  if (agentRuntimeHasMemoryAlert(truth?.agentRuntime)) {
    return `先复核记忆稳态为什么进入 ${memoryStabilityCorrectionLabel(
      truth.agentRuntime?.latestMemoryStabilityCorrectionLevel,
      "未确认"
    )}，必要时重载上下文再续跑。`;
  }
  if (text(releaseReadiness?.nextAction, "")) {
    return text(releaseReadiness.nextAction);
  }
  if (truth?.formalRecovery?.runbook?.nextStepLabel && truth?.formalRecovery?.durableRestoreReady === false) {
    return `先补正式恢复主线：${truth.formalRecovery.runbook.nextStepLabel}。`;
  }
  if (truth?.crossDevice?.readyForRehearsal === false && truth?.crossDevice?.nextStepLabel) {
    return `先收口跨机器恢复前置条件：${truth.crossDevice.nextStepLabel}。`;
  }
  if (truth?.crossDevice?.readyForRehearsal) {
    return "源机器已就绪；下一步去目标机器按固定顺序导入恢复包、初始化包并核验。";
  }
  if (truth?.cadence?.actionSummary) {
    return truth.cadence.actionSummary;
  }
  return "当前没有硬阻塞；继续巡检正式恢复、受限执行和跨机器恢复。";
}

export function buildCanonicalOperatorDecisionSummary({
  releaseReadiness = null,
  readinessAlerts = [],
  priorityAlert = null,
  agentRuntime = null,
} = {}) {
  if (agentRuntime?.latestRunnerGuardActivated === true && priorityAlert) {
    return `当前先处理${priorityAlert.title}。`;
  }
  if (releaseReadiness && readinessAlerts.length > 0) {
    return text(
      releaseReadiness.summary,
      priorityAlert ? `当前先处理${priorityAlert.title}。` : "当前没有硬阻塞；以巡检和演练准备为主。"
    );
  }
  if (priorityAlert) {
    return `当前先处理${priorityAlert.title}。`;
  }
  if (releaseReadiness) {
    return text(releaseReadiness.summary, "当前没有硬阻塞；以巡检和演练准备为主。");
  }
  return "当前没有硬阻塞；以巡检和演练准备为主。";
}

export function buildCanonicalOperatorDecision({ security = null, truth = null } = {}) {
  const releaseReadiness = getReleaseReadiness(security);
  const hardAlerts = buildCanonicalOperatorAlerts({ security, truth });
  const readinessAlerts = buildReleaseReadinessAlerts(releaseReadiness);
  const priorityAlert = selectCanonicalOperatorDecisionAlert(hardAlerts, truth?.agentRuntime || null);
  return {
    summary: buildCanonicalOperatorDecisionSummary({
      releaseReadiness,
      readinessAlerts,
      priorityAlert,
      agentRuntime: truth?.agentRuntime || null,
    }),
    nextAction: buildCanonicalOperatorNextAction({ releaseReadiness, truth }),
    hardAlerts,
    source: "operator_truth_snapshot",
  };
}

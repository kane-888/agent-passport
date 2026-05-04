import {
  buildCanonicalOperatorAlerts as buildCanonicalOperatorAlertsShared,
  buildCanonicalOperatorDecision as buildCanonicalOperatorDecisionShared,
  buildCanonicalOperatorNextAction as buildCanonicalOperatorNextActionShared,
  buildReleaseReadinessAlerts as buildReleaseReadinessAlertsShared,
  getReleaseReadiness as getReleaseReadinessShared,
  listCanonicalAgentRuntimeTruthMissingFields as listCanonicalAgentRuntimeTruthMissingFieldsShared,
  selectCanonicalOperatorDecisionAlert as selectCanonicalOperatorDecisionAlertShared,
} from "./operator-decision-canonical.js";
export {
  ADMIN_TOKEN_STORAGE_KEY,
  LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY,
  LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY,
  buildAdminTokenHeaders,
  clearLegacyStoredAdminToken,
  migrateStoredAdminToken,
  readStoredAdminToken,
  writeStoredAdminToken,
} from "./admin-token-storage-compat.js";

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

export function boolLabel(value, { trueLabel = "是", falseLabel = "否", unknownLabel = "未确认" } = {}) {
  if (value === true) {
    return trueLabel;
  }
  if (value === false) {
    return falseLabel;
  }
  return unknownLabel;
}

function hasFiniteNumber(value) {
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

function formatRuntimeTextList(values) {
  if (!Array.isArray(values)) {
    return "";
  }
  return values
    .map((value) => runtimePlainLabel(value, ""))
    .filter(Boolean)
    .join(" / ");
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

function runtimeFlagLabel(value, { trueLabel = "是", falseLabel = "否", unknownLabel = "未确认" } = {}) {
  if (value === true) {
    return trueLabel;
  }
  if (value === false) {
    return falseLabel;
  }
  return unknownLabel;
}

function formatRuntimeIssueCodes(issueCodes = []) {
  const normalized = (Array.isArray(issueCodes) ? issueCodes : [])
    .map((entry) => text(entry, ""))
    .filter(Boolean);
  return normalized.length > 0 ? normalized.map((entry) => entry.replaceAll("_", " ")).join(" / ") : "";
}

function agentRuntimeHasQualityIssue(agentRuntime = null) {
  const reason = text(agentRuntime?.latestQualityEscalationReason, "");
  return agentRuntime?.latestQualityEscalationActivated === true || reason === "online_not_allowed";
}

function agentRuntimeHasMemoryAlert(agentRuntime = null) {
  return ["medium", "strong"].includes(text(agentRuntime?.latestMemoryStabilityCorrectionLevel, ""));
}

function agentRuntimeMemoryAlertTone(agentRuntime = null) {
  const correctionLevel = text(agentRuntime?.latestMemoryStabilityCorrectionLevel, "");
  const riskScore = clampRuntimeRiskScore(agentRuntime?.latestMemoryStabilityRiskScore);
  return correctionLevel === "strong" || (riskScore != null && riskScore >= 0.6) ? "danger" : "warn";
}

function buildOperatorAgentRuntimeTitle(agentRuntime = null) {
  if (!agentRuntime || typeof agentRuntime !== "object") {
    return "当前还没有 agent 运行真值";
  }
  const localFirstLabel = agentRuntime.localFirst === true ? "本地优先已启用" : "本地优先未确认";
  if (agentRuntime.latestRunnerGuardActivated === true) {
    return `${localFirstLabel} / 最近一次因记忆稳态护栏被阻断`;
  }
  const qualityReason = text(agentRuntime.latestQualityEscalationReason, "");
  if (qualityReason === "online_not_allowed") {
    return `${localFirstLabel} / 本地答案未过校验且当前不能联网补强`;
  }
  if (agentRuntime.latestQualityEscalationActivated === true) {
    return `${localFirstLabel} / 最近一次已触发质量升级`;
  }
  if (agentRuntimeHasMemoryAlert(agentRuntime)) {
    return `${localFirstLabel} / 记忆稳态${memoryStabilityCorrectionLabel(
      agentRuntime.latestMemoryStabilityCorrectionLevel,
      "未确认"
    )}`;
  }
  return `${localFirstLabel} / 最近未触发质量升级`;
}

function buildOperatorAgentRuntimeDetails(agentRuntime = null) {
  if (!agentRuntime || typeof agentRuntime !== "object") {
    return ["状态：未确认"];
  }
  const issueCodes = formatRuntimeIssueCodes(agentRuntime.latestQualityEscalationIssueCodes);
  const runnerGuardRequestKinds = formatMemoryStabilityRunnerGuardRequestKinds(
    agentRuntime.latestRunnerGuardExplicitRequestKinds
  );
  const riskScoreText = formatRuntimeRiskScore(agentRuntime.latestMemoryStabilityRiskScore);
  return [
    text(agentRuntime.policy, "当前没有公开策略摘要。"),
    `联网增强：${runtimeFlagLabel(agentRuntime.onlineAllowed, {
      trueLabel: "允许作为质量升级后备",
      falseLabel: "当前关闭",
    })}`,
    agentRuntime.latestRunnerGuardActivated === true
      ? `最近一次运行：被记忆稳态护栏阻断，状态 ${statusLabel(agentRuntime.latestRunStatus)}。`
      : null,
    agentRuntime.latestRunnerGuardActivated === true && text(agentRuntime.latestRunnerGuardBlockedBy, "")
      ? `阻断点：${memoryStabilityRunnerGuardBlockedByLabel(agentRuntime.latestRunnerGuardBlockedBy)}`
      : null,
    agentRuntime.latestRunnerGuardActivated === true && text(agentRuntime.latestRunnerGuardCode, "")
      ? `阻断码：${text(agentRuntime.latestRunnerGuardCode)}`
      : null,
    agentRuntime.latestRunnerGuardActivated === true && text(agentRuntime.latestRunnerGuardReceiptStatus, "")
      ? `阻断回执：${runtimePlainLabel(agentRuntime.latestRunnerGuardReceiptStatus)}`
      : null,
    agentRuntime.latestRunnerGuardActivated === true && runnerGuardRequestKinds
      ? `显式请求：${runnerGuardRequestKinds}`
      : null,
    hasFiniteNumber(agentRuntime.qualityEscalationRuns)
      ? `累计质量升级：${Math.max(0, Math.floor(Number(agentRuntime.qualityEscalationRuns)))} 次`
      : "累计质量升级：未确认",
    agentRuntime.latestQualityEscalationActivated === true
      ? `最近升级通道：${runtimeReasonerProviderLabel(agentRuntime.latestQualityEscalationProvider)}`
      : text(agentRuntime.latestQualityEscalationReason, "")
        ? `最近质量判定：${qualityEscalationReasonLabel(agentRuntime.latestQualityEscalationReason)}`
        : null,
    issueCodes ? `最近校验问题：${issueCodes}` : null,
    `记忆稳态：${memoryStabilityCorrectionLabel(agentRuntime.latestMemoryStabilityCorrectionLevel, "未读取")}${
      riskScoreText == null ? "" : `，风险 ${riskScoreText}`
    }`,
    text(agentRuntime.latestMemoryStabilitySignalSource, "")
      ? `信号来源：${runtimePlainLabel(agentRuntime.latestMemoryStabilitySignalSource)}`
      : null,
    text(agentRuntime.latestMemoryStabilityObservationKind, "")
      ? `观测类型：${runtimePlainLabel(agentRuntime.latestMemoryStabilityObservationKind)}`
      : null,
    text(agentRuntime.latestMemoryStabilityPreflightStatus, "")
      ? `预检状态：${runtimePlainLabel(agentRuntime.latestMemoryStabilityPreflightStatus)}`
      : null,
    hasFiniteNumber(agentRuntime.memoryStabilityStateCount)
      ? `记忆稳态状态数：${Math.max(0, Math.floor(Number(agentRuntime.memoryStabilityStateCount)))}`
      : null,
    text(agentRuntime.latestMemoryStabilityStateId, "")
      ? `最近状态 ID：${text(agentRuntime.latestMemoryStabilityStateId)}`
      : null,
    text(agentRuntime.latestMemoryStabilityUpdatedAt, "")
      ? `最近信号更新时间：${text(agentRuntime.latestMemoryStabilityUpdatedAt)}`
      : null,
    text(agentRuntime.latestMemoryStabilityRecoverySignal, "")
      ? `恢复信号：${runtimePlainLabel(agentRuntime.latestMemoryStabilityRecoverySignal)}`
      : null,
    hasTextList(agentRuntime.latestMemoryStabilityCorrectionActions)
      ? `纠偏动作：${formatRuntimeTextList(agentRuntime.latestMemoryStabilityCorrectionActions)}`
      : null,
    hasFiniteNumber(agentRuntime.memoryStabilityRecoveryRate)
      ? `近窗纠偏恢复率：${formatRuntimeRiskScore(agentRuntime.memoryStabilityRecoveryRate)}`
      : null,
  ].filter(Boolean);
}

function buildAgentRuntimeTruthCopy(agentRuntime = null) {
  if (!agentRuntime || typeof agentRuntime !== "object") {
    return {
      summary: "尚未读取 agent 运行真值。",
      detail: "会显示本地优先策略、质量升级和记忆稳态信号。",
    };
  }
  const localFirst = agentRuntime.localFirst === true;
  const qualityEscalationRuns = hasFiniteNumber(agentRuntime.qualityEscalationRuns)
    ? Math.max(0, Math.floor(Number(agentRuntime.qualityEscalationRuns)))
    : null;
  const qualityEscalationActivated = agentRuntime.latestQualityEscalationActivated === true;
  const runnerGuardRequestKinds = formatMemoryStabilityRunnerGuardRequestKinds(
    agentRuntime.latestRunnerGuardExplicitRequestKinds
  );
  const riskScoreText = formatRuntimeRiskScore(agentRuntime.latestMemoryStabilityRiskScore);
  const correctionLevelLabel = memoryStabilityCorrectionLabel(
    agentRuntime.latestMemoryStabilityCorrectionLevel,
    "未读取"
  );

  let summary = "尚未读取 agent 运行真值。";
  if (agentRuntime.latestRunnerGuardActivated === true && localFirst) {
    summary = "本地优先已启用，最近一次因记忆稳态护栏被阻断。";
  } else if (agentRuntime.latestRunnerGuardActivated === true) {
    summary = "最近一次因记忆稳态护栏被阻断。";
  } else if (localFirst && qualityEscalationRuns === 0) {
    summary = "本地优先已启用，最近未触发质量升级。";
  } else if (localFirst && qualityEscalationActivated) {
    summary = `本地优先已启用，最近一次已转入${runtimeReasonerProviderLabel(
      agentRuntime.latestQualityEscalationProvider,
      "增强通道"
    )}。`;
  } else if (localFirst && qualityEscalationRuns != null) {
    summary = `本地优先已启用，累计记录 ${qualityEscalationRuns} 次质量升级判定。`;
  } else if (localFirst) {
    summary = "本地优先已启用。";
  }

  const details = [];
  if (text(agentRuntime.policy, "")) {
    details.push(text(agentRuntime.policy));
  } else {
    details.push("当前没有公开策略摘要。");
  }
  details.push(
    `联网增强：${runtimeFlagLabel(agentRuntime.onlineAllowed, {
      trueLabel: "允许作为质量升级后备",
      falseLabel: "当前关闭",
    })}。`
  );
  if (agentRuntime.latestRunnerGuardActivated === true) {
    details.push(
      `最近一次运行已被记忆稳态护栏阻断，状态 ${statusLabel(agentRuntime.latestRunStatus)}。`
    );
    if (text(agentRuntime.latestRunnerGuardBlockedBy, "")) {
      details.push(
        `阻断点：${memoryStabilityRunnerGuardBlockedByLabel(agentRuntime.latestRunnerGuardBlockedBy)}。`
      );
    }
    if (text(agentRuntime.latestRunnerGuardCode, "")) {
      details.push(`阻断码：${text(agentRuntime.latestRunnerGuardCode)}。`);
    }
    if (text(agentRuntime.latestRunnerGuardReceiptStatus, "")) {
      details.push(`阻断回执：${runtimePlainLabel(agentRuntime.latestRunnerGuardReceiptStatus)}。`);
    }
    if (runnerGuardRequestKinds) {
      details.push(`显式请求：${runnerGuardRequestKinds}。`);
    }
  }
  if (qualityEscalationActivated) {
    details.push(
      `最近一次质量升级：${qualityEscalationReasonLabel(agentRuntime.latestQualityEscalationReason)}，通道 ${runtimeReasonerProviderLabel(
        agentRuntime.latestQualityEscalationProvider
      )}。`
    );
  } else if (text(agentRuntime.latestQualityEscalationReason, "")) {
    details.push(`最近一次质量判定：${qualityEscalationReasonLabel(agentRuntime.latestQualityEscalationReason)}。`);
  } else if (qualityEscalationRuns != null) {
    details.push(`累计质量升级：${qualityEscalationRuns} 次。`);
  }
  const issueCodes = formatRuntimeIssueCodes(agentRuntime.latestQualityEscalationIssueCodes);
  if (issueCodes) {
    details.push(`最近校验问题：${issueCodes}。`);
  }
  details.push(
    riskScoreText == null
      ? `记忆稳态：${correctionLevelLabel}。`
      : `记忆稳态：${correctionLevelLabel}，风险 ${riskScoreText}。`
  );
  if (text(agentRuntime.latestMemoryStabilitySignalSource, "")) {
    details.push(`信号来源：${runtimePlainLabel(agentRuntime.latestMemoryStabilitySignalSource)}。`);
  }
  if (text(agentRuntime.latestMemoryStabilityObservationKind, "")) {
    details.push(`观测类型：${runtimePlainLabel(agentRuntime.latestMemoryStabilityObservationKind)}。`);
  }
  if (text(agentRuntime.latestMemoryStabilityPreflightStatus, "")) {
    details.push(`预检状态：${runtimePlainLabel(agentRuntime.latestMemoryStabilityPreflightStatus)}。`);
  }
  if (hasFiniteNumber(agentRuntime.memoryStabilityStateCount)) {
    details.push(`记忆稳态状态数：${Math.max(0, Math.floor(Number(agentRuntime.memoryStabilityStateCount)))}。`);
  }
  if (text(agentRuntime.latestMemoryStabilityStateId, "")) {
    details.push(`最近状态 ID：${text(agentRuntime.latestMemoryStabilityStateId)}。`);
  }
  if (text(agentRuntime.latestMemoryStabilityUpdatedAt, "")) {
    details.push(`最近信号更新时间：${text(agentRuntime.latestMemoryStabilityUpdatedAt)}。`);
  }
  if (text(agentRuntime.latestMemoryStabilityRecoverySignal, "")) {
    details.push(`恢复信号：${runtimePlainLabel(agentRuntime.latestMemoryStabilityRecoverySignal)}。`);
  }
  if (hasTextList(agentRuntime.latestMemoryStabilityCorrectionActions)) {
    details.push(`纠偏动作：${formatRuntimeTextList(agentRuntime.latestMemoryStabilityCorrectionActions)}。`);
  }
  if (hasFiniteNumber(agentRuntime.memoryStabilityRecoveryRate)) {
    details.push(`近窗纠偏恢复率：${formatRuntimeRiskScore(agentRuntime.memoryStabilityRecoveryRate)}。`);
  }

  return {
    summary,
    detail: details.join(" "),
  };
}

export function formatProtectedReadSurface(value, fallback = "受保护接口") {
  const normalized = text(value, "");
  if (!normalized) {
    return fallback;
  }
  const [pathOnly] = normalized.split("?");
  return pathOnly || normalized;
}

export function describeProtectedReadFailure({
  surface = "",
  statusCode = 0,
  hasStoredAdminToken = false,
  operation = "读取",
  backendError = "",
  errorClass = "",
  readSessionReason = "",
  publicTruthFallback = false,
  missingTokenAction = "请先录入管理令牌。",
} = {}) {
  const readScope = formatProtectedReadSurface(surface, "受保护接口");
  const action = text(operation, "读取");
  const status = Number(statusCode || 0);
  const detail = text(backendError, "");
  const fallbackSuffix = publicTruthFallback ? "；当前继续显示公开真值" : "";
  let reason = "";
  let nextAction = "";
  let category = "protected_read_failed";
  const normalizedErrorClass = text(errorClass, "");
  const normalizedReadSessionReason = text(readSessionReason, "");
  const scopeDenied =
    status === 403 ||
    (normalizedErrorClass === "read_session_rejected" &&
      ["invalid_scope", "scope_mismatch", "ancestor_scope_mismatch"].includes(normalizedReadSessionReason));

  if (!hasStoredAdminToken) {
    category = "admin_token_missing";
    reason = `当前标签页里未保存管理令牌，无法${action} ${readScope}`;
    nextAction = missingTokenAction;
  } else if (scopeDenied) {
    category = "read_session_scope_denied";
    reason = `当前令牌或 read-session scope 不足，无法${action} ${readScope}`;
    nextAction = "如果这是 admin-only 管理面，请改用管理令牌；如果是受限 read-session，请重新派生包含该资源的读取会话。";
  } else if (status === 401) {
    category = "admin_token_rejected";
    reason = `当前标签页里的管理令牌无法${action} ${readScope}`;
    nextAction = "如令牌已轮换，请重新录入管理令牌。";
  } else {
    reason = `${action} ${readScope} 失败`;
    nextAction = detail || `HTTP ${status || "unknown"}`;
  }

  const authMessage = `${reason}${fallbackSuffix}。${nextAction}`.trim();
  const statusMessage = publicTruthFallback
    ? `受保护${action}失败：${readScope}${fallbackSuffix}。${nextAction}`
    : authMessage;

  return {
    category,
    readScope,
    statusCode: status || null,
    authMessage,
    statusMessage,
    userMessage: authMessage,
    nextAction,
  };
}

function sentence(value, fallback = "") {
  const normalized = text(value, fallback);
  return /[。！？!?]$/.test(normalized) ? normalized : `${normalized}。`;
}

export function buildAdminTokenAuthSummary({
  hasToken = false,
  tokenStoreLabel = "当前标签页会话里",
  savedDetail = "受保护读取会自动带上 Authorization。",
  missingDetail = "受保护读取需要先录入。",
} = {}) {
  const state = hasToken ? "已保存管理令牌" : "未保存管理令牌";
  const detail = hasToken ? savedDetail : missingDetail;
  return `${text(tokenStoreLabel, "当前标签页会话里")}${state}；${sentence(detail)}`;
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

// 属性：桥接。
// 这是公开运行态的浏览器桥接层：对外展示三层分工。
// OpenNeed 在浏览器侧只保留为 legacy DID / 文案兼容别名，不代表当前底层本体、属主层或模型品牌。
export const PUBLIC_RUNTIME_ENTRY_HREFS = Object.freeze([
  "/operator",
  "/offline-chat",
  "/lab.html",
  "/repair-hub",
  "/api/security",
  "/api/health",
]);

export const MEMORY_STABILITY_ENGINE_LABEL = "记忆稳态引擎";
export const MEMORY_STABILITY_LOCAL_STACK_NAME = "记忆稳态引擎本地栈";
export const MEMORY_STABILITY_LOCAL_REASONER_LABEL = "记忆稳态引擎本地推理";
export const AGENT_PASSPORT_MEMORY_ENGINE_LABEL = MEMORY_STABILITY_ENGINE_LABEL;
export const AGENT_PASSPORT_LOCAL_STACK_NAME = MEMORY_STABILITY_LOCAL_STACK_NAME;
export const AGENT_PASSPORT_LOCAL_REASONER_LABEL = MEMORY_STABILITY_LOCAL_REASONER_LABEL;

const LEGACY_OPENNEED_REASONER_BRAND = "OpenNeed";
const LEGACY_OPENNEED_MEMORY_ENGINE_ALIAS = [LEGACY_OPENNEED_REASONER_BRAND, "记忆稳态引擎"].join(" ");
const LEGACY_OPENNEED_REASONER_MODEL = ["gemma4", "e4b"].join(":");
const LEGACY_THREAD_PROTOCOL_KEY_ALIASES = Object.freeze({
  openneed_system_autonomy: "agent_passport_runtime",
});

function normalizeLegacyThreadProtocolKeyAlias(value) {
  const normalized = text(value, "");
  return normalized ? LEGACY_THREAD_PROTOCOL_KEY_ALIASES[normalized] || normalized : "";
}

export function isOpenNeedReasonerAlias(value) {
  const normalized = text(value, "");
  if (!normalized) {
    return false;
  }
  const lowered = normalized.toLowerCase();
  return (
    lowered === LEGACY_OPENNEED_REASONER_BRAND.toLowerCase() ||
    lowered === LEGACY_OPENNEED_MEMORY_ENGINE_ALIAS.toLowerCase()
  );
}

export function isAgentPassportLocalReasonerModel(value) {
  const normalized = text(value, "");
  return (
    Boolean(normalized) &&
    (isOpenNeedReasonerAlias(normalized) || normalized.toLowerCase() === LEGACY_OPENNEED_REASONER_MODEL.toLowerCase())
  );
}

export function isLegacyOpenNeedDisplayText(value) {
  const normalized = text(value, "").replace(/\s+/g, " ").toLowerCase();
  if (!normalized) {
    return false;
  }
  return new Set([
    "ollama + gemma4",
    "gemma4:e4b",
    "e4b + 类人脑神经网络",
    "类人脑神经网络",
  ]).has(normalized);
}

export function displayAgentPassportLocalReasonerModel(value, fallback = AGENT_PASSPORT_LOCAL_REASONER_LABEL) {
  const normalized = text(value, "");
  if (!normalized) {
    return fallback;
  }
  return isAgentPassportLocalReasonerModel(normalized) || isLegacyOpenNeedDisplayText(normalized)
    ? AGENT_PASSPORT_LOCAL_REASONER_LABEL
    : normalized;
}

export function isOpenNeedReasonerModel(value) {
  return isAgentPassportLocalReasonerModel(value);
}

export function displayOpenNeedReasonerModel(value, fallback = AGENT_PASSPORT_LOCAL_REASONER_LABEL) {
  return displayAgentPassportLocalReasonerModel(value, fallback);
}

function displayThreadProtocolModel(value) {
  const normalized = text(value, "");
  if (!normalized) {
    return "";
  }
  const [key, ...rest] = normalized.split(":");
  const canonicalKey = normalizeLegacyThreadProtocolKeyAlias(key);
  return [canonicalKey, ...rest].filter(Boolean).join(":");
}

export function providerLabel(provider) {
  const normalized = text(provider, "");
  const labels = {
    thread_protocol_runtime: "线程协议运行时",
    ollama_local: "Ollama 本地引擎",
    local_command: "自定义本地命令",
    openai_compatible: "OpenAI 兼容本地网关",
    local_mock: "本地兜底引擎",
    deterministic_fallback: "确定性兜底",
    passport_fast_memory: "本地参考层快答",
    unknown: "引擎状态未确认",
  };
  return labels[normalized] || normalized || "未命名来源";
}

export function formatRuntimeMessageSource(source = null) {
  if (!source) {
    return "";
  }
  if (
    isLegacyOpenNeedDisplayText(source.label) ||
    isLegacyOpenNeedDisplayText(source.provider) ||
    isLegacyOpenNeedDisplayText(source.model)
  ) {
    return `${providerLabel("ollama_local")} · ${AGENT_PASSPORT_LOCAL_REASONER_LABEL} · ${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}`;
  }
  const parts = [];
  if (text(source.label, "")) {
    parts.push(text(source.label, ""));
  } else if (text(source.provider, "")) {
    parts.push(providerLabel(source.provider));
  }
  if (text(source.provider, "") && text(source.label, "") && providerLabel(source.provider) !== text(source.label, "")) {
    parts.push(providerLabel(source.provider));
  }
  if (text(source.model, "") && text(source.provider, "") !== "local_command") {
    parts.push(
      text(source.provider, "") === "ollama_local"
        ? displayAgentPassportLocalReasonerModel(source.model)
        : text(source.provider, "") === "thread_protocol_runtime"
          ? displayThreadProtocolModel(source.model)
        : text(source.model, "")
    );
  }
  return parts.join(" · ");
}

export function formatRuntimeMessageDispatch(source = null) {
  if (!source) {
    return "";
  }
  const dispatch = source?.dispatch || null;
  const batchLabel =
    dispatch?.batchId === "merge"
      ? "fan-out 收口批"
      : Number.isFinite(Number(dispatch?.batchId))
        ? `fan-out 第${Number(dispatch.batchId)}批`
        : "";
  const modeLabel =
    text(dispatch?.executionMode, "") === "parallel"
      ? "并行"
      : text(dispatch?.executionMode, "") === "serial"
        ? "串行"
        : "";
  return [batchLabel, modeLabel].filter(Boolean).join(" · ");
}

export const OFFLINE_CHAT_HOME_COPY = Object.freeze({
  heroSummary:
    `${MEMORY_STABILITY_ENGINE_LABEL}提供底层本地推理与记忆稳态，agent-passport 提供连续身份、恢复与审计。这里主要回答 3 件事：当前在和谁协作、这次回复来自哪条链路、离线记录有没有顺利接回去。`,
});

export const PUBLIC_RUNTIME_HOME_COPY = Object.freeze({
  eyebrow: "公开运行态",
  title: "agent-passport 公开运行态",
  introSegments: Object.freeze([
    { code: "agent-passport" },
    {
      text:
        " 首页现在只回答 4 件事：服务是否活着、正式恢复周期是否仍在窗口内、自动恢复有没有越位、下一步该进哪个入口。",
    },
    { code: "记忆稳态引擎" },
    {
      text:
        " 提供底层模型与本地推理，agent-passport 提供连续身份、长期记忆、恢复与审计。值班判断先去 ",
    },
    { code: "/operator" },
    { text: "；离线协作去 " },
    { code: "/offline-chat" },
    { text: "；修复证据去 " },
    { code: "/repair-hub" },
    { text: "；实验与维护去 " },
    { code: "/lab.html" },
    { text: "。" },
  ]),
  linkSummary: "下一步去哪里",
  entries: Object.freeze([
    {
      href: "/operator",
      label: "值班决策面",
      summary: "按固定顺序收口值班判断。",
      summaryElementId: "runtime-operator-entry-summary",
    },
    {
      href: "/offline-chat",
      label: "离线线程入口",
      summary: "回答成员、来源和同步状态。",
    },
    {
      href: "/lab.html",
      label: "实验与维护页",
      summary: "查看公开安全、恢复与维护真值。",
    },
    {
      href: "/repair-hub",
      label: "受保护修复证据面",
      summary: "需要管理令牌。",
    },
    {
      href: "/api/security",
      label: "公开安全态",
      summary: "默认只返回脱敏真值。",
    },
    {
      href: "/api/health",
      label: "公开健康探测",
      summary: "确认服务是否可达。",
    },
  ]),
});

export const PUBLIC_RUNTIME_HOME_PENDING_TEXTS = Object.freeze([
  "正在加载公开运行态…",
  "公开运行态读取波动，",
  "公开健康状态读取波动，",
  "正式恢复周期读取波动，",
  "自动恢复边界读取波动，",
  "公开健康探测暂未返回，正在补拉。",
  "正式恢复周期暂未返回，正在补拉。",
  "自动恢复边界暂未返回，正在补拉。",
  "公开运行态已部分加载：",
]);

export const PUBLIC_RUNTIME_HOME_FAILURE_TEXTS = Object.freeze([
  "公开运行态加载失败",
  "公开健康状态读取失败",
  "正式恢复周期读取失败",
  "自动恢复边界读取失败",
]);

export const PUBLIC_RUNTIME_HOME_STATE_COPY = Object.freeze({
  healthPendingSummary: "公开健康探测暂未返回，正在补拉。",
  securityPendingDetail(errorSummary, retryDelaySeconds) {
    return `公开安全态暂未返回；最近一次错误：${text(errorSummary, "未知错误")}。${retryDelaySeconds} 秒后继续补拉。`;
  },
  recoveryPendingSummary: "正式恢复周期暂未返回，正在补拉。",
  recoveryPendingDetail:
    "可先查看 /api/health 的公开健康态；若要核对管理面恢复真值，请前往 /operator 并使用管理令牌。",
  automationPendingSummary: "自动恢复边界暂未返回，正在补拉。",
  automationPendingDetail:
    "公开首页会继续重试 /api/security；如需管理面细节，请前往 /operator 并使用管理令牌。",
  agentRuntimePendingSummary: "agent 运行真值暂未返回，正在补拉。",
  agentRuntimePendingDetail:
    "公开首页会继续重试 /api/security；重点核对本地优先、质量升级和记忆稳态信号。",
  triggerPendingMessage: "正在补拉正式恢复触发条件…",
  partialSecurityOnlySummary(runtimeHome = {}, retryDelaySeconds = 0) {
    return `公开运行态已部分加载：姿态 ${text(runtimeHome.postureStatusLabel)}，正式恢复 ${text(runtimeHome.formalRecoveryStatusLabel)}，自动恢复 ${text(runtimeHome.automaticRecoveryStatusLabel)}；健康探测仍在补拉，${retryDelaySeconds} 秒后重试。`;
  },
  partialHealthOnlySummary(retryDelaySeconds = 0) {
    return `公开运行态已部分加载：健康探测已确认，正式恢复与自动恢复真值仍在补拉，${retryDelaySeconds} 秒后重试。`;
  },
  healthFailureSummary: "公开健康状态读取失败。",
  healthFailureDetail(errorSummary) {
    return `最近一次错误：${text(errorSummary, "未知错误")}。请先确认 /api/health 与 /api/security 是否可达。`;
  },
  recoveryFailureSummary: "正式恢复周期读取失败。",
  recoveryFailureDetail:
    "公开首页暂时没有拿到正式恢复真值；可先查看 /api/security 的公开安全态，或到 /operator 使用管理令牌核对恢复状态。",
  automationFailureSummary: "自动恢复边界读取失败。",
  automationFailureDetail:
    "公开首页暂时没有拿到自动恢复真值；可先查看 /api/security，管理面细节请到 /operator 并使用管理令牌。",
  agentRuntimeFailureSummary: "agent 运行真值读取失败。",
  agentRuntimeFailureDetail:
    "公开首页暂时没有拿到 agent 运行真值；请先确认 /api/security 可达，再核对本地优先和质量升级策略。",
  failureHomeSummary(errorSummary, retryDelaySeconds = 0) {
    return `公开运行态加载失败：${text(errorSummary, "未知错误")}。${retryDelaySeconds} 秒后继续重试。`;
  },
  triggerFailureMessage: "公开首页暂时无法确认正式恢复重跑条件。",
  healthRetrySummary: "公开健康状态读取波动，正在重试。",
  healthRetryDetail: "公开首页正在重新确认健康状态与安全姿态。",
  recoveryRetrySummary: "正式恢复周期读取波动，正在重试。",
  recoveryRetryDetail: "公开首页正在重新确认正式恢复真值。",
  automationRetrySummary: "自动恢复边界读取波动，正在重试。",
  automationRetryDetail: "公开首页正在重新确认自动恢复边界真值。",
  retryHomeSummary(retryDelaySeconds = 0) {
    return `公开运行态读取波动，${retryDelaySeconds} 秒后重试。`;
  },
  triggerRetryMessage: "正在重新确认正式恢复重跑条件…",
});

export function containsAnyText(value, candidates = []) {
  const normalized = text(value, "");
  return Array.isArray(candidates)
    ? candidates.some((candidate) => normalized.startsWith(text(candidate, "")))
    : false;
}

export function isPublicRuntimeHomePendingText(value) {
  return containsAnyText(value, PUBLIC_RUNTIME_HOME_PENDING_TEXTS);
}

export function isPublicRuntimeHomeFailureText(value) {
  return containsAnyText(value, PUBLIC_RUNTIME_HOME_FAILURE_TEXTS);
}

export function getOperatorHandbookSummary(security = null) {
  return text(
    security?.securityArchitecture?.operatorHandbook?.summary,
    "按固定顺序收口值班判断。"
  );
}

export function selectRuntimeTruth({ security = null, setup = null } = {}) {
  const publicFormalRecovery = security?.localStorageFormalFlow || null;
  const protectedFormalRecovery = setup?.formalRecoveryFlow || null;
  const formalRecovery = protectedFormalRecovery || publicFormalRecovery;
  const publicAutomaticRecovery = security?.automaticRecovery || null;
  const protectedAutomaticRecovery = setup?.automaticRecoveryReadiness || null;
  const automaticRecovery = protectedAutomaticRecovery || publicAutomaticRecovery;

  return {
    posture: security?.securityPosture || null,
    storeEncryption: protectedFormalRecovery?.storeEncryption || publicFormalRecovery?.storeEncryption || null,
    formalRecovery,
    cadence: protectedFormalRecovery?.operationalCadence || publicFormalRecovery?.operationalCadence || null,
    constrainedExecution:
      setup?.deviceRuntime?.constrainedExecutionSummary || security?.constrainedExecution || null,
    automaticRecovery,
    operatorBoundary: protectedAutomaticRecovery?.operatorBoundary || publicAutomaticRecovery?.operatorBoundary || null,
    crossDevice: protectedFormalRecovery?.crossDeviceRecoveryClosure || publicFormalRecovery?.crossDeviceRecoveryClosure || null,
    agentRuntime: security?.agentRuntimeTruth || null,
  };
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFallbackText(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /尚未读取|当前没有|暂无|未确认|缺失/.test(normalized);
}

function hasTruthText(value) {
  return hasText(value) && !isFallbackText(value);
}

function hasBoolean(value) {
  return typeof value === "boolean";
}

function hasTextList(values) {
  return Array.isArray(values) && values.some((value) => hasText(value));
}

function appendAgentRuntimeMemoryTruthMissingFields(missingFields = [], agentRuntime = null, prefix = "agentRuntime") {
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

function appendAgentRuntimeRunnerGuardMissingFields(missingFields = [], agentRuntime = null, prefix = "agentRuntime") {
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

function selectOperatorDecisionAlert(alerts = [], agentRuntime = null) {
  return selectCanonicalOperatorDecisionAlertShared(alerts, agentRuntime);
}

export function listPublicRuntimeMissingFields({ health = null, security = null, truth = null } = {}) {
  const missingFields = [];
  if (health?.ok !== true) {
    missingFields.push("health.ok");
  }
  if (health?.service !== "agent-passport") {
    missingFields.push("health.service");
  }
  if (!hasTruthText(security?.releaseReadiness?.status)) {
    missingFields.push("releaseReadiness.status");
  }
  if (!hasTruthText(truth?.posture?.mode)) {
    missingFields.push("securityPosture.mode");
  }
  if (!hasTruthText(truth?.posture?.summary)) {
    missingFields.push("securityPosture.summary");
  }
  if (!hasTruthText(security?.securityArchitecture?.operatorHandbook?.summary)) {
    missingFields.push("securityArchitecture.operatorHandbook.summary");
  }
  if (!hasTruthText(truth?.formalRecovery?.status)) {
    missingFields.push("formalRecovery.status");
  }
  if (!hasTruthText(truth?.formalRecovery?.summary) && !hasTruthText(truth?.cadence?.summary)) {
    missingFields.push("formalRecovery.summary");
  }
  if (!hasTruthText(truth?.cadence?.actionSummary) && !hasTruthText(truth?.formalRecovery?.runbook?.nextStepSummary)) {
    missingFields.push("formalRecovery.nextStepSummary");
  }
  if (!Array.isArray(truth?.cadence?.rerunTriggers) || truth.cadence.rerunTriggers.length === 0) {
    missingFields.push("formalRecovery.operationalCadence.rerunTriggers");
  }
  if (!hasTruthText(truth?.automaticRecovery?.status)) {
    missingFields.push("automaticRecovery.status");
  }
  if (!hasTruthText(truth?.automaticRecovery?.summary) && !hasTruthText(truth?.operatorBoundary?.summary)) {
    missingFields.push("automaticRecovery.summary");
  }
  if (truth?.agentRuntime?.localFirst !== true) {
    missingFields.push("agentRuntime.localFirst");
  }
  if (!hasTruthText(truth?.agentRuntime?.policy)) {
    missingFields.push("agentRuntime.policy");
  }
  if (!hasFiniteNumber(truth?.agentRuntime?.qualityEscalationRuns)) {
    missingFields.push("agentRuntime.qualityEscalationRuns");
  }
  appendAgentRuntimeRunnerGuardMissingFields(missingFields, truth?.agentRuntime, "agentRuntime");
  appendAgentRuntimeMemoryTruthMissingFields(missingFields, truth?.agentRuntime, "agentRuntime");
  return missingFields;
}

export function buildPublicRuntimeSnapshot({ health = null, security = null } = {}) {
  const truth = selectRuntimeTruth({ security });
  const postureStatusLabel = statusLabel(truth.posture?.mode);
  const formalRecoveryStatusLabel = statusLabel(truth.formalRecovery?.status);
  const automaticRecoveryStatusLabel = statusLabel(truth.automaticRecovery?.status);
  const triggerLabels = normalizeTriggerLabels(truth.cadence?.rerunTriggers);
  const agentRuntime = buildAgentRuntimeTruthCopy(truth.agentRuntime);
  const missingFields = listPublicRuntimeMissingFields({ health, security, truth });
  const missingFieldsSummary = missingFields.length
    ? `还缺 ${missingFields.slice(0, 4).join("、")}${missingFields.length > 4 ? ` 等 ${missingFields.length} 项` : ""}。`
    : "";

  return {
    missingFields,
    firstMissingField: missingFields[0] || null,
    missingFieldsSummary,
    readyForSmoke: missingFields.length === 0,
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
    agentRuntimeSummary: agentRuntime.summary,
    agentRuntimeDetail: agentRuntime.detail,
    triggerLabels,
    homeSummary: missingFields.length
      ? `公开运行态部分加载：姿态 ${postureStatusLabel}，正式恢复 ${formalRecoveryStatusLabel}，自动恢复 ${automaticRecoveryStatusLabel}；${missingFieldsSummary}`
      : `公开运行态已加载：姿态 ${postureStatusLabel}，正式恢复 ${formalRecoveryStatusLabel}，自动恢复 ${automaticRecoveryStatusLabel}。`,
  };
}

export function buildSecurityBoundarySnapshot(security = null) {
  const truth = selectRuntimeTruth({ security });
  const missingFields = [];
  if (!hasTruthText(truth.storeEncryption?.status)) {
    missingFields.push("storeEncryption.status");
  }
  if (!hasBoolean(truth.storeEncryption?.systemProtected)) {
    missingFields.push("storeEncryption.systemProtected");
  }
  if (!hasBoolean(security?.localStore?.recoveryBaselineReady)) {
    missingFields.push("localStore.recoveryBaselineReady");
  }
  if (!hasTruthText(truth.formalRecovery?.status)) {
    missingFields.push("formalRecovery.status");
  }
  if (!hasTruthText(truth.formalRecovery?.summary)) {
    missingFields.push("formalRecovery.summary");
  }
  if (!hasTruthText(truth.formalRecovery?.runbook?.nextStepLabel)) {
    missingFields.push("formalRecovery.runbook.nextStepLabel");
  }
  if (!hasTruthText(truth.cadence?.status)) {
    missingFields.push("formalRecovery.operationalCadence.status");
  }
  if (!hasTruthText(truth.constrainedExecution?.status)) {
    missingFields.push("constrainedExecution.status");
  }
  if (!hasTruthText(truth.constrainedExecution?.summary)) {
    missingFields.push("constrainedExecution.summary");
  }
  if (!hasTruthText(truth.constrainedExecution?.systemBrokerSandbox?.status)) {
    missingFields.push("constrainedExecution.systemBrokerSandbox.status");
  }
  if (!hasTruthText(truth.constrainedExecution?.systemBrokerSandbox?.summary)) {
    missingFields.push("constrainedExecution.systemBrokerSandbox.summary");
  }
  if (!hasTruthText(truth.automaticRecovery?.status)) {
    missingFields.push("automaticRecovery.status");
  }
  if (!hasTruthText(truth.automaticRecovery?.summary)) {
    missingFields.push("automaticRecovery.summary");
  }
  if (!hasBoolean(truth.operatorBoundary?.formalFlowReady)) {
    missingFields.push("automaticRecovery.operatorBoundary.formalFlowReady");
  }
  if (!hasTruthText(truth.operatorBoundary?.summary)) {
    missingFields.push("automaticRecovery.operatorBoundary.summary");
  }

  return {
    missingFields,
    readyForSmoke: missingFields.length === 0,
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

export const OPERATOR_AUTH_SUMMARY_PROTECTED =
  buildAdminTokenAuthSummary({
    hasToken: true,
    tokenStoreLabel: "当前标签页",
    savedDetail: "operator 会自动读取受保护恢复真值。",
  });

export const OPERATOR_AUTH_SUMMARY_PUBLIC = "当前只显示公开真值；要看切机和执行细节，再录入管理令牌。";

export const OPERATOR_PROTECTED_STATUS_READY = "已读取受保护恢复真值；切机闭环、执行边界和设备细节已对齐。";

export const OPERATOR_PROTECTED_STATUS_PUBLIC = "当前只显示公开真值；受保护恢复真值尚未读取。";

export const OPERATOR_EXPORT_SUMMARY_TOKEN_REQUIRED = "事故交接包必须包含受保护恢复真值和最近审计，先录入管理令牌。";

export const OPERATOR_EXPORT_SUMMARY_SETUP_REQUIRED =
  "令牌已录入，但受保护恢复真值还没读到；先修复 /api/device/setup。";

export const OPERATOR_EXPORT_SUMMARY_READY =
  "导出动作现在由 /api/security/incident-packet/export 一次性生成，并在当前物理属主 resident agent 下留一条导出记录。";

export const OPERATOR_EXPORT_STATUS_TOKEN_REQUIRED = "当前不能导出：还没录入当前标签页管理令牌。";

export const OPERATOR_EXPORT_STATUS_SETUP_REQUIRED = "当前不能导出：受保护恢复真值尚未就绪。";

export const OPERATOR_EXPORT_STATUS_READY = "当前可以导出事故交接包。";

export function getReleaseReadiness(security = null) {
  return getReleaseReadinessShared(security);
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
  return buildReleaseReadinessAlertsShared(releaseReadiness);
}

export function buildOperatorAlerts({ security = null, setup = null, truth: truthOverride = null } = {}) {
  const truth = truthOverride || selectRuntimeTruth({ security, setup });
  return buildCanonicalOperatorAlertsShared({ security, truth });
}

export function buildOperatorNextAction({ security = null, setup = null, truth: truthOverride = null } = {}) {
  const truth = truthOverride || selectRuntimeTruth({ security, setup });
  return buildCanonicalOperatorNextActionShared({
    releaseReadiness: getReleaseReadinessShared(security),
    truth,
  });
}

export function buildOperatorTruthSnapshot({ security = null, setup = null } = {}) {
  const releaseReadiness = getReleaseReadiness(security);
  const truth = selectRuntimeTruth({ security, setup });
  const agentRuntime = truth.agentRuntime || null;
  const hasProtectedSetup = setup && typeof setup === "object";
  const posture = truth.posture || null;
  const formalRecovery = truth.formalRecovery || null;
  const cadence = truth.cadence || null;
  const constrained = truth.constrainedExecution || null;
  const commandPolicy = setup?.deviceRuntime?.commandPolicy || constrained?.commandPolicy || null;
  const crossDevice = truth.crossDevice || null;
  const handbook = security?.securityArchitecture?.operatorHandbook || null;
  const handoffFields = Array.isArray(formalRecovery?.handoffPacket?.requiredFields)
    ? formalRecovery.handoffPacket.requiredFields
    : [];
  const readinessAlerts = buildReleaseReadinessAlerts(releaseReadiness);
  const operatorDecision = buildCanonicalOperatorDecisionShared({ security, truth });
  const alerts = Array.isArray(operatorDecision?.hardAlerts) ? operatorDecision.hardAlerts : [];
  const priorityAlert = selectOperatorDecisionAlert(alerts, agentRuntime);
  const { high, critical } = riskTierSummary(constrained);
  const missingFields = [];
  if (!hasProtectedSetup) {
    missingFields.push("deviceSetup.protectedTruth");
  }
  if (!hasTruthText(handbook?.summary)) {
    missingFields.push("operatorHandbook.summary");
  }
  if (!Array.isArray(handbook?.roles) || handbook.roles.length === 0) {
    missingFields.push("operatorHandbook.roles");
  }
  if (!Array.isArray(handbook?.decisionSequence) || handbook.decisionSequence.length === 0) {
    missingFields.push("operatorHandbook.decisionSequence");
  }
  if (!Array.isArray(handbook?.standardActions) || handbook.standardActions.length === 0) {
    missingFields.push("operatorHandbook.standardActions");
  }
  if (!hasTruthText(handbook?.standardActionsSummary)) {
    missingFields.push("operatorHandbook.standardActionsSummary");
  }
  if (!hasTruthText(posture?.mode)) {
    missingFields.push("securityPosture.mode");
  }
  if (!hasTruthText(posture?.summary)) {
    missingFields.push("securityPosture.summary");
  }
  if (!hasTruthText(formalRecovery?.status)) {
    missingFields.push("formalRecovery.status");
  }
  if (!hasTruthText(formalRecovery?.summary) && !hasTruthText(cadence?.summary)) {
    missingFields.push("formalRecovery.summary");
  }
  if (!hasTruthText(formalRecovery?.runbook?.nextStepLabel)) {
    missingFields.push("formalRecovery.runbook.nextStepLabel");
  }
  if (!hasTruthText(cadence?.status)) {
    missingFields.push("formalRecovery.operationalCadence.status");
  }
  if (!hasTruthText(cadence?.actionSummary)) {
    missingFields.push("formalRecovery.operationalCadence.actionSummary");
  }
  if (!Array.isArray(cadence?.rerunTriggers) || cadence.rerunTriggers.length === 0) {
    missingFields.push("formalRecovery.operationalCadence.rerunTriggers");
  }
  if (!hasTruthText(formalRecovery?.handoffPacket?.summary)) {
    missingFields.push("formalRecovery.handoffPacket.summary");
  }
  if (handoffFields.length === 0) {
    missingFields.push("formalRecovery.handoffPacket.requiredFields");
  }
  if (!hasTruthText(constrained?.status)) {
    missingFields.push("constrainedExecution.status");
  }
  if (!hasTruthText(constrained?.summary)) {
    missingFields.push("constrainedExecution.summary");
  }
  if (!hasTruthText(constrained?.systemBrokerSandbox?.status)) {
    missingFields.push("constrainedExecution.systemBrokerSandbox.status");
  }
  if (!hasTruthText(constrained?.systemBrokerSandbox?.summary)) {
    missingFields.push("constrainedExecution.systemBrokerSandbox.summary");
  }
  if (!hasTruthText(truth.automaticRecovery?.status)) {
    missingFields.push("automaticRecovery.status");
  }
  if (!hasTruthText(truth.automaticRecovery?.summary)) {
    missingFields.push("automaticRecovery.summary");
  }
  if (!hasBoolean(truth.operatorBoundary?.formalFlowReady)) {
    missingFields.push("automaticRecovery.operatorBoundary.formalFlowReady");
  }
  if (!crossDevice || typeof crossDevice !== "object") {
    missingFields.push("crossDeviceRecoveryClosure");
  } else {
    if (!hasTruthText(crossDevice.status)) {
      missingFields.push("crossDevice.status");
    }
    if (!hasBoolean(crossDevice.readyForRehearsal)) {
      missingFields.push("crossDevice.readyForRehearsal");
    }
    if (!hasBoolean(crossDevice.readyForCutover)) {
      missingFields.push("crossDevice.readyForCutover");
    }
    if (!hasTruthText(crossDevice.nextStepLabel)) {
      missingFields.push("crossDevice.nextStepLabel");
    }
    if (!hasTruthText(crossDevice.cutoverGate?.summary)) {
      missingFields.push("crossDevice.cutoverGate.summary");
    }
  }
  if (!agentRuntime || typeof agentRuntime !== "object") {
    missingFields.push("agentRuntime");
  } else {
    missingFields.push(...listCanonicalAgentRuntimeTruthMissingFieldsShared(agentRuntime, "agentRuntime"));
  }

  return {
    missingFields,
    readyForSmoke: missingFields.length === 0,
    readyForDecision: missingFields.length === 0,
    authSummary: hasProtectedSetup ? OPERATOR_AUTH_SUMMARY_PROTECTED : OPERATOR_AUTH_SUMMARY_PUBLIC,
    protectedStatus: hasProtectedSetup ? OPERATOR_PROTECTED_STATUS_READY : OPERATOR_PROTECTED_STATUS_PUBLIC,
    exportSummary: hasProtectedSetup ? OPERATOR_EXPORT_SUMMARY_READY : OPERATOR_EXPORT_SUMMARY_SETUP_REQUIRED,
    exportStatus: hasProtectedSetup ? OPERATOR_EXPORT_STATUS_READY : OPERATOR_EXPORT_STATUS_SETUP_REQUIRED,
    formalRecovery,
    constrainedExecution: constrained,
    crossDevice,
    sequenceSummary: text(handbook?.summary, "先锁边界，再补正式恢复，再判断能不能继续执行或切机。"),
    standardActionsSummary: text(
      handbook?.standardActionsSummary,
      "遇到高风险异常时，先执行标准动作，不要临场拼流程。"
    ),
    handoffSummary: text(formalRecovery?.handoffPacket?.summary, "正在根据当前恢复真值整理交接最小信息集。"),
    decisionSummary: text(operatorDecision?.summary, "当前没有硬阻塞；以巡检和演练准备为主。"),
    nextAction: text(
      operatorDecision?.nextAction,
      buildOperatorNextAction({ security, setup, truth })
    ),
    agentRuntime,
    postureTitle: posture?.mode
      ? `${statusLabel(posture.mode)} / ${text(posture.summary, "姿态摘要缺失")}`
      : "公开姿态真值缺失",
    postureDetails: [
      `写入：${posture?.writeLocked == null ? "未确认" : posture.writeLocked ? "锁定" : "可用"}`,
      `执行：${posture?.executionLocked == null ? "未确认" : posture.executionLocked ? "锁定" : "可用"}`,
      `外网：${posture?.networkEgressLocked == null ? "未确认" : posture.networkEgressLocked ? "锁定" : "可用"}`,
      posture?.updatedAt ? `最近更新时间：${posture.updatedAt}` : null,
    ].filter(Boolean),
    recoveryTitle: `${statusLabel(formalRecovery?.status)} / ${text(
      cadence?.summary || formalRecovery?.summary,
      "暂无恢复摘要"
    )}`,
    recoveryDetails: [
      formalRecovery?.runbook?.nextStepLabel ? `下一步：${formalRecovery.runbook.nextStepLabel}` : null,
      cadence?.status ? `周期：${statusLabel(cadence.status)}` : null,
      cadence?.actionSummary || null,
      formalRecovery?.runbook?.summary || null,
    ].filter(Boolean),
    execTitle: `${statusLabel(constrained?.status)} / ${text(
      constrained?.summary,
      "暂无受限执行摘要"
    )}`,
    execDetails: constrained
      ? [
          constrained.systemBrokerSandbox?.status
            ? `系统级调度沙箱：${statusLabel(constrained.systemBrokerSandbox.status)}`
            : null,
          constrained.allowShellExecution ? "命令执行：当前仅允许放行清单内命令" : "命令执行：默认关闭或被门禁拦住",
          constrained.allowExternalNetwork ? "外网：当前仅允许放行清单内网络目标" : "外网：默认关闭或被门禁拦住",
          constrained.riskPolicy?.summary ? `风险放行：${constrained.riskPolicy.summary}` : null,
          high || critical
            ? `确认钩子：high=${executionHookLabel(high?.hook)} / critical=${executionHookLabel(critical?.hook)}`
            : null,
          Array.isArray(commandPolicy?.floorAdjustments) && commandPolicy.floorAdjustments.length > 0
            ? `策略纠偏：${commandPolicy.floorAdjustments
                .map(
                  (entry) =>
                    `${text(entry.tier, "?")}:${text(entry.requestedStrategy, "?")}→${text(entry.effectiveStrategy, "?")}`
                )
                .join("；")}`
            : null,
          Array.isArray(constrained.riskPolicy?.capabilityFloors) && constrained.riskPolicy.capabilityFloors.length > 0
            ? `能力下限：${constrained.riskPolicy.capabilityFloors
                .map((entry) => `${text(entry.capability, "?")}>=${text(entry.minimumRiskTier, "?")}`)
                .join(" / ")}`
            : null,
          Array.isArray(constrained.degradationReasons) && constrained.degradationReasons.length > 0
            ? `退化原因：${constrained.degradationReasons.join("、")}`
            : null,
          commandPolicy?.riskStrategies
            ? `命令策略：low=${text(commandPolicy.riskStrategies.low)} / medium=${text(
                commandPolicy.riskStrategies.medium
              )} / high=${text(commandPolicy.riskStrategies.high)} / critical=${text(
                commandPolicy.riskStrategies.critical
              )}`
            : null,
        ].filter(Boolean)
      : ["状态：未确认"],
    agentRuntimeTitle: buildOperatorAgentRuntimeTitle(agentRuntime),
    agentRuntimeDetails: buildOperatorAgentRuntimeDetails(agentRuntime),
    crossDeviceTitle: crossDevice
      ? `${statusLabel(crossDevice.status)} / ${text(crossDevice.summary, "暂无跨机器恢复摘要")}`
      : "当前还没有跨机器恢复闭环真值",
    crossDeviceSummary: crossDevice
      ? text(
          crossDevice.cutoverGate?.summary || crossDevice.summary,
          "跨机器恢复需要源机器就绪度、目标机固定顺序和真实切机门槛同屏呈现。"
        )
      : "只有拿到正式恢复的闭环真值，才能回答现在能不能开始演练或允许真实切机。",
    crossDeviceGate: crossDevice
      ? crossDevice.readyForRehearsal
        ? "源机器已就绪，但还不能宣称可切机"
        : `当前先 ${text(crossDevice.nextStepLabel, "补齐前置条件")}`
      : "需要受保护设备恢复真值",
    crossDeviceDetails: [
      crossDevice?.sourceReadiness?.formalFlowReady != null
        ? `源机器正式恢复：${crossDevice.sourceReadiness.formalFlowReady ? "已就绪" : "未就绪"}`
        : null,
      crossDevice?.sourceReadiness?.cadenceStatus
        ? `本机恢复周期：${statusLabel(crossDevice.sourceReadiness.cadenceStatus)}`
        : null,
      crossDevice?.latestBundle?.createdAt ? `最新恢复包：${crossDevice.latestBundle.createdAt}` : null,
      crossDevice?.latestSetupPackage?.exportedAt
        ? `最新初始化包：${crossDevice.latestSetupPackage.exportedAt}`
        : null,
      crossDevice?.latestPassedRecoveryRehearsal?.createdAt
        ? `最近本机恢复演练：${crossDevice.latestPassedRecoveryRehearsal.createdAt}`
        : null,
    ].filter(Boolean),
    crossDeviceChecks: Array.isArray(crossDevice?.targetVerificationChecks)
      ? crossDevice.targetVerificationChecks
      : ["目标机器核验项需要从 /api/device/setup 的闭环真值读取。"],
    crossDeviceStepCards: Array.isArray(crossDevice?.steps)
      ? crossDevice.steps.map((step) => ({
          tone: step.status === "ready" ? "ready" : step.status === "pending" ? "pending" : "",
          title: `${step.label} · ${statusLabel(step.status)}`,
          detail: step.summary || "暂无说明。",
          notes:
            Array.isArray(step.blockedByStepIds) && step.blockedByStepIds.length > 0
              ? [`前置阻塞：${step.blockedByStepIds.join("、")}`]
              : [],
        }))
      : [],
    rolesCount: Array.isArray(handbook?.roles) ? handbook.roles.length : 0,
    decisionSequenceCount: Array.isArray(handbook?.decisionSequence) ? handbook.decisionSequence.length : 0,
    standardActionsCount: Array.isArray(handbook?.standardActions) ? handbook.standardActions.length : 0,
    handoffFieldCount: handoffFields.length,
    handoffFieldTitles: handoffFields.map(
      (field) => `${text(field?.label, "未命名交接字段")} · ${statusLabel(field?.status)}`
    ),
    handoffFieldDetails: handoffFields.map((field) => text(field?.value, "未确认")),
    handoffCards: handoffFields.map((field) => ({
      tone:
        field?.status === "missing"
          ? "danger"
          : field?.status === "partial"
            ? "warn"
            : field?.status === "ready"
              ? "ready"
              : "",
      title: `${text(field?.label, "未命名交接字段")} · ${statusLabel(field?.status)}`,
      detail: text(field?.value, "未确认"),
      notes: [field?.summary || null].filter(Boolean),
    })),
    alertsCount: alerts.length,
    stepsCount: Array.isArray(crossDevice?.steps) ? crossDevice.steps.length : 0,
    alerts,
    alertsEmptyText: releaseReadiness ? "当前运行态没有额外阻塞。" : "当前没有额外硬告警。",
    releaseReadiness,
  };
}

function executionHookLabel(hook) {
  const normalized = text(hook, "");
  if (normalized === "create_multisig_proposal") {
    return "创建多签提案";
  }
  if (normalized === "request_explicit_confirmation") {
    return "显式确认后执行";
  }
  if (normalized === "continue_negotiation") {
    return "先协商不执行";
  }
  if (normalized === "execute_if_not_blocked") {
    return "无额外阻断时可执行";
  }
  return normalized || "未确认";
}

function riskTierSummary(constrained = null) {
  const tiers = Array.isArray(constrained?.riskPolicy?.tiers) ? constrained.riskPolicy.tiers : [];
  return {
    high: tiers.find((entry) => entry?.tierId === "high") || null,
    critical: tiers.find((entry) => entry?.tierId === "critical") || null,
  };
}

export function buildOperatorPrimaryBlockerCard({ security = null, setup = null, snapshot = null } = {}) {
  const operatorSnapshot = snapshot || buildOperatorTruthSnapshot({ security, setup });
  const readinessAlerts = buildReleaseReadinessAlerts(operatorSnapshot.releaseReadiness);
  if (operatorSnapshot.releaseReadiness) {
    if (readinessAlerts.length > 0) {
      const first = readinessAlerts[0];
      return {
        title: "当前阻塞",
        main: text(operatorSnapshot.releaseReadiness.summary, `当前先处理 ${first.title}。`),
        note: text(operatorSnapshot.releaseReadiness.nextAction, first.detail),
        tone: first.tone || "warn",
      };
    }
    if (
      text(operatorSnapshot.releaseReadiness.status, "") === "ready" &&
      (!Array.isArray(operatorSnapshot.alerts) || operatorSnapshot.alerts.length === 0)
    ) {
      return {
        title: "当前阻塞",
        main: "当前没有硬阻塞。",
        note: text(
          operatorSnapshot.releaseReadiness.summary,
          "运行态正式放行前提已满足，继续结合 smoke 与 deploy 结果做最终放行判断。"
        ),
        tone: "ready",
      };
    }
  }

  const first = Array.isArray(operatorSnapshot.alerts) ? operatorSnapshot.alerts[0] : null;
  if (!first) {
    return {
      title: "当前阻塞",
      main: "当前没有硬阻塞。",
      note: "继续按固定顺序巡检，不要跳过正式恢复、执行边界和跨机器门槛。",
      tone: "ready",
    };
  }
  return {
    title: "当前阻塞",
    main: text(first.title, "当前有未命名阻塞。"),
    note: text(first.detail, "先把这个阻塞解释清楚，再决定是否继续放行。"),
    tone: first.tone || "warn",
  };
}

export function buildOperatorExecutionBoundaryCard({ security = null, setup = null, snapshot = null } = {}) {
  const operatorSnapshot = snapshot || buildOperatorTruthSnapshot({ security, setup });
  const constrained = operatorSnapshot.constrainedExecution;
  if (!constrained) {
    return {
      title: "执行边界",
      main: "当前还没有拿到受限执行真值。",
      note: "没有执行边界真值时，不要直接放开真实执行。",
      tone: "warn",
    };
  }

  const { high, critical } = riskTierSummary(constrained);
  if (["degraded", "locked"].includes(constrained.status)) {
    return {
      title: "执行边界",
      main: "当前不能继续真实执行。",
      note: text(constrained.summary, "先查清受限执行为什么退化或被锁住。"),
      tone: "danger",
    };
  }
  if (constrained.allowShellExecution || constrained.allowExternalNetwork) {
    return {
      title: "执行边界",
      main: "当前只允许在受限执行边界内继续。",
      note:
        [
          text(constrained.riskPolicy?.summary, ""),
          high || critical
            ? `high=${executionHookLabel(high?.hook)} / critical=${executionHookLabel(critical?.hook)}`
            : "",
        ]
          .filter(Boolean)
          .join("；") || "高风险动作仍需经过确认钩子。",
      tone: "",
    };
  }
  return {
    title: "执行边界",
    main: "当前默认不放开真实执行。",
    note: text(constrained.summary, "只有满足受限执行门槛后，才讨论继续执行。"),
    tone: "warn",
  };
}

export function buildOperatorCrossDeviceDecisionCard({ security = null, setup = null, snapshot = null } = {}) {
  const operatorSnapshot = snapshot || buildOperatorTruthSnapshot({ security, setup });
  const formalRecovery = operatorSnapshot.formalRecovery;
  const crossDevice = operatorSnapshot.crossDevice;
  if (!crossDevice) {
    return {
      title: "跨机门槛",
      main: formalRecovery?.runbook?.nextStepLabel
        ? `当前先 ${formalRecovery.runbook.nextStepLabel}`
        : "当前还不能进入跨机器恢复。",
      note: "只有本机正式恢复主线收口后，跨机器恢复才有意义。",
      tone: "warn",
    };
  }
  if (crossDevice.readyForCutover) {
    return {
      title: "跨机门槛",
      main: "已满足切机前置，但仍要按固定顺序执行。",
      note: text(crossDevice.cutoverGate?.summary || crossDevice.summary, "不要跳过目标机器核验。"),
      tone: "ready",
    };
  }
  if (crossDevice.readyForRehearsal) {
    return {
      title: "跨机门槛",
      main: "源机器已就绪，现在只允许做目标机导入与演练。",
      note: text(crossDevice.cutoverGate?.summary || crossDevice.summary, "演练通过前，不要宣布可切机。"),
      tone: "warn",
    };
  }
  return {
    title: "跨机门槛",
    main: `当前先 ${text(crossDevice.nextStepLabel, "补齐前置条件")}`,
    note: text(crossDevice.cutoverGate?.summary || crossDevice.summary, "切机门槛当前仍未满足。"),
    tone: "danger",
  };
}

export function buildOperatorAgentRuntimeDecisionCard({ security = null, setup = null, snapshot = null } = {}) {
  const operatorSnapshot = snapshot || buildOperatorTruthSnapshot({ security, setup });
  const agentRuntime = operatorSnapshot.agentRuntime || null;
  if (!agentRuntime) {
    return {
      title: "Agent 运行",
      main: "当前还没有拿到 agent 运行真值。",
      note: "没有这份真值时，不要把本地优先、质量升级和记忆稳态当成已确认。",
      tone: "warn",
    };
  }
  if (agentRuntime.latestRunnerGuardActivated === true) {
    return {
      title: "Agent 运行",
      main: "最近一次运行被记忆稳态护栏阻断。",
      note: `阻断点：${memoryStabilityRunnerGuardBlockedByLabel(
        agentRuntime.latestRunnerGuardBlockedBy
      )}；阻断码：${text(agentRuntime.latestRunnerGuardCode, "未确认")}。`,
      tone: "danger",
    };
  }
  if (text(agentRuntime.latestQualityEscalationReason, "") === "online_not_allowed") {
    return {
      title: "Agent 运行",
      main: "本地答案未过校验，当前也不能联网复核。",
      note: "先决定是否允许增强复核，或者直接切人工复核，不要继续把这轮输出当真。",
      tone: "danger",
    };
  }
  if (agentRuntime.latestQualityEscalationActivated === true) {
    return {
      title: "Agent 运行",
      main: "最近一次回答已触发质量升级。",
      note: `复核通道：${runtimeReasonerProviderLabel(
        agentRuntime.latestQualityEscalationProvider,
        "增强通道"
      )}；触发原因：${qualityEscalationReasonLabel(agentRuntime.latestQualityEscalationReason)}。`,
      tone: "warn",
    };
  }
  if (agentRuntimeHasMemoryAlert(agentRuntime)) {
    return {
      title: "Agent 运行",
      main: `记忆稳态当前处于${memoryStabilityCorrectionLabel(
        agentRuntime.latestMemoryStabilityCorrectionLevel,
        "未确认"
      )}。`,
      note:
        formatRuntimeRiskScore(agentRuntime.latestMemoryStabilityRiskScore) == null
          ? "先复核上下文是否需要重载后再续跑。"
          : `当前风险 ${formatRuntimeRiskScore(agentRuntime.latestMemoryStabilityRiskScore)}，先复核上下文是否需要重载后再续跑。`,
      tone: agentRuntimeMemoryAlertTone(agentRuntime),
    };
  }
  return {
    title: "Agent 运行",
    main: "本地优先当前稳定运行。",
    note: text(agentRuntime.policy, "当前没有公开策略摘要。"),
    tone: "ready",
  };
}

export function buildOperatorDecisionCards({ security = null, setup = null, snapshot = null } = {}) {
  const operatorSnapshot = snapshot || buildOperatorTruthSnapshot({ security, setup });
  return [
    buildOperatorPrimaryBlockerCard({ security, setup, snapshot: operatorSnapshot }),
    buildOperatorExecutionBoundaryCard({ security, setup, snapshot: operatorSnapshot }),
    buildOperatorAgentRuntimeDecisionCard({ security, setup, snapshot: operatorSnapshot }),
    buildOperatorCrossDeviceDecisionCard({ security, setup, snapshot: operatorSnapshot }),
  ];
}

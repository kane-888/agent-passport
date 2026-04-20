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

export function formatProtectedReadSurface(value, fallback = "受保护接口") {
  const normalized = text(value, "");
  if (!normalized) {
    return fallback;
  }
  const [pathOnly] = normalized.split("?");
  return pathOnly || normalized;
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

export const PUBLIC_RUNTIME_ENTRY_HREFS = Object.freeze([
  "/operator",
  "/offline-chat",
  "/lab.html",
  "/repair-hub",
  "/api/security",
  "/api/health",
]);

export const AGENT_PASSPORT_MEMORY_ENGINE_LABEL = "agent-passport 记忆稳态引擎";

export const OFFLINE_CHAT_HOME_COPY = Object.freeze({
  heroSummary:
    `${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}为离线线程提供记忆连续性与恢复真值支撑。这里主要回答 3 件事：当前在和谁协作、这次回复来自哪条链路、离线记录有没有顺利接回去。`,
});

export const PUBLIC_RUNTIME_HOME_COPY = Object.freeze({
  eyebrow: "公开运行态",
  title: "agent-passport 公开运行态",
  introSegments: Object.freeze([
    { code: "agent-passport" },
    {
      text:
        " 首页不再承载旧混合控制台。公开视图现在只回答 4 件事：服务是否活着、正式恢复周期是否仍在窗口内、自动恢复有没有越位、下一步该进哪个入口。",
    },
    { code: "agent-passport" },
    {
      text: " 的底层运行时由 agent-passport 记忆稳态引擎提供。值班判断先去 ",
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

export const ADMIN_TOKEN_STORAGE_KEY = "agent-passport.admin-token-session";

export const LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY = "openneed-runtime.admin-token-session";

export const LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY = "openneed-agent-passport.admin-token";

function normalizeStoredToken(value) {
  return String(value ?? "").trim();
}

function readStorageValue(storage, key) {
  try {
    return typeof storage?.getItem === "function" ? storage.getItem(key) || "" : "";
  } catch {
    return "";
  }
}

function writeStorageValue(storage, key, value) {
  try {
    if (typeof storage?.setItem === "function") {
      storage.setItem(key, value);
      return true;
    }
  } catch {}
  return false;
}

function removeStorageValue(storage, key) {
  try {
    if (typeof storage?.removeItem === "function") {
      storage.removeItem(key);
    }
  } catch {}
}

export function clearLegacyStoredAdminToken({
  sessionStorage = globalThis?.sessionStorage,
  localStorage = globalThis?.localStorage,
} = {}) {
  removeStorageValue(sessionStorage, LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY);
  removeStorageValue(localStorage, LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY);
}

export function readStoredAdminToken({
  sessionStorage = globalThis?.sessionStorage,
  localStorage = globalThis?.localStorage,
} = {}) {
  return normalizeStoredToken(
    readStorageValue(sessionStorage, ADMIN_TOKEN_STORAGE_KEY) ||
      readStorageValue(sessionStorage, LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY) ||
      readStorageValue(localStorage, LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY)
  );
}

export function writeStoredAdminToken(
  token,
  {
    sessionStorage = globalThis?.sessionStorage,
    localStorage = globalThis?.localStorage,
  } = {}
) {
  const normalized = normalizeStoredToken(token);
  if (normalized) {
    if (writeStorageValue(sessionStorage, ADMIN_TOKEN_STORAGE_KEY, normalized)) {
      clearLegacyStoredAdminToken({ sessionStorage, localStorage });
    }
  } else {
    removeStorageValue(sessionStorage, ADMIN_TOKEN_STORAGE_KEY);
    clearLegacyStoredAdminToken({ sessionStorage, localStorage });
  }
  return readStoredAdminToken({ sessionStorage, localStorage });
}

export function migrateStoredAdminToken({
  sessionStorage = globalThis?.sessionStorage,
  localStorage = globalThis?.localStorage,
} = {}) {
  const currentToken = readStoredAdminToken({ sessionStorage, localStorage });
  const currentPrimaryToken = normalizeStoredToken(readStorageValue(sessionStorage, ADMIN_TOKEN_STORAGE_KEY));
  if (currentToken) {
    const primaryReady =
      currentToken === currentPrimaryToken ||
      writeStorageValue(sessionStorage, ADMIN_TOKEN_STORAGE_KEY, currentToken);
    if (primaryReady) {
      clearLegacyStoredAdminToken({ sessionStorage, localStorage });
    }
    return readStoredAdminToken({ sessionStorage, localStorage });
  }

  const legacyToken = normalizeStoredToken(
    readStorageValue(sessionStorage, LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY) ||
      readStorageValue(localStorage, LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY)
  );
  if (legacyToken) {
    if (writeStorageValue(sessionStorage, ADMIN_TOKEN_STORAGE_KEY, legacyToken)) {
      clearLegacyStoredAdminToken({ sessionStorage, localStorage });
    }
    return readStoredAdminToken({ sessionStorage, localStorage });
  }
  clearLegacyStoredAdminToken({ sessionStorage, localStorage });
  return readStoredAdminToken({ sessionStorage, localStorage });
}

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

export const OPERATOR_AUTH_SUMMARY_PROTECTED =
  "当前标签页已保存管理令牌；operator 会自动读取受保护恢复真值。";

export const OPERATOR_AUTH_SUMMARY_PUBLIC = "当前只显示公开真值；要看切机和执行细节，再录入管理令牌。";

export const OPERATOR_PROTECTED_STATUS_READY = "已读取受保护恢复真值；切机闭环、执行边界和设备细节已对齐。";

export const OPERATOR_PROTECTED_STATUS_PUBLIC = "当前只显示公开真值；受保护恢复真值尚未读取。";

export const OPERATOR_EXPORT_SUMMARY_TOKEN_REQUIRED = "事故交接包必须包含受保护恢复真值和最近审计，先录入管理令牌。";

export const OPERATOR_EXPORT_SUMMARY_SETUP_REQUIRED =
  "令牌已录入，但受保护恢复真值还没读到；先修复 /api/device/setup。";

export const OPERATOR_EXPORT_SUMMARY_READY =
  "导出动作现在由 /api/security/incident-packet/export 一次性生成，并在 resident agent 下留一条导出记录。";

export const OPERATOR_EXPORT_STATUS_TOKEN_REQUIRED = "当前不能导出：还没录入当前标签页管理令牌。";

export const OPERATOR_EXPORT_STATUS_SETUP_REQUIRED = "当前不能导出：受保护恢复真值尚未就绪。";

export const OPERATOR_EXPORT_STATUS_READY = "当前可以导出事故交接包。";

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

export function buildOperatorAlerts({ security = null, setup = null, truth: truthOverride = null } = {}) {
  const releaseReadiness = getReleaseReadiness(security);
  const readinessAlerts = buildReleaseReadinessAlerts(releaseReadiness);
  if (readinessAlerts.length > 0) {
    return readinessAlerts;
  }

  const truth = truthOverride || selectRuntimeTruth({ security, setup });
  const alerts = [];

  if (truth.posture?.mode && truth.posture.mode !== "normal") {
    alerts.push({
      tone: truth.posture.mode === "panic" ? "danger" : "warn",
      title: `安全姿态已提升到 ${statusLabel(truth.posture.mode)}`,
      detail: text(truth.posture.summary, "先按当前姿态保全现场，再讨论是否恢复业务。"),
    });
  }

  if (["missing", "overdue", "due_soon"].includes(truth.cadence?.status)) {
    alerts.push({
      tone: truth.cadence.status === "due_soon" ? "warn" : "danger",
      title: `正式恢复周期 ${statusLabel(truth.cadence.status)}`,
      detail: text(
        truth.cadence.actionSummary,
        "正式恢复周期没有保持在安全窗口内，不能把自动恢复当成交付级恢复。"
      ),
    });
  }

  if (truth.operatorBoundary?.formalFlowReady === false) {
    alerts.push({
      tone: "danger",
      title: "自动恢复不能冒充正式恢复完成",
      detail: text(
        truth.operatorBoundary.summary,
        "自动恢复即使能续跑，也不代表恢复包、恢复演练和初始化包已经收口。"
      ),
    });
  }

  if (["degraded", "locked"].includes(truth.constrainedExecution?.status)) {
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

  if (truth.crossDevice?.readyForCutover === false) {
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

  return alerts;
}

export function buildOperatorNextAction({ security = null, setup = null, truth: truthOverride = null } = {}) {
  const releaseReadiness = getReleaseReadiness(security);
  if (text(releaseReadiness?.nextAction, "")) {
    return text(releaseReadiness.nextAction);
  }

  const truth = truthOverride || selectRuntimeTruth({ security, setup });

  if (truth.posture?.mode && truth.posture.mode !== "normal") {
    return `先按 ${statusLabel(truth.posture.mode)} 姿态锁边界并保全 /api/security 与 /api/device/setup。`;
  }
  if (["degraded", "locked"].includes(truth.constrainedExecution?.status)) {
    return "先停真实执行，查清受限执行为什么退化。";
  }
  if (truth.formalRecovery?.runbook?.nextStepLabel && truth.formalRecovery?.durableRestoreReady === false) {
    return `先补正式恢复主线：${truth.formalRecovery.runbook.nextStepLabel}。`;
  }
  if (truth.crossDevice?.readyForRehearsal === false && truth.crossDevice?.nextStepLabel) {
    return `先收口跨机器恢复前置条件：${truth.crossDevice.nextStepLabel}。`;
  }
  if (truth.crossDevice?.readyForRehearsal) {
    return "源机器已就绪；下一步去目标机器按固定顺序导入恢复包、初始化包并核验。";
  }
  if (truth.cadence?.actionSummary) {
    return truth.cadence.actionSummary;
  }
  return "当前没有硬阻塞；继续巡检正式恢复、受限执行和跨机器恢复。";
}

export function buildOperatorTruthSnapshot({ security = null, setup = null } = {}) {
  const releaseReadiness = getReleaseReadiness(security);
  const truth = selectRuntimeTruth({ security, setup });
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
  const alerts = buildOperatorAlerts({ security, setup, truth });
  const { high, critical } = riskTierSummary(constrained);

  return {
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
    decisionSummary: releaseReadiness
      ? text(
          releaseReadiness.summary,
          alerts.length > 0 ? `当前先处理 ${alerts[0].title}。` : "当前没有硬阻塞；以巡检和演练准备为主。"
        )
      : alerts.length > 0
        ? `当前先处理 ${alerts[0].title}。`
        : "当前没有硬阻塞；以巡检和演练准备为主。",
    nextAction: buildOperatorNextAction({ security, setup, truth }),
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
    if (readinessAlerts.length === 0 && text(operatorSnapshot.releaseReadiness.status, "") === "ready") {
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
    if (readinessAlerts.length > 0) {
      const first = readinessAlerts[0];
      return {
        title: "当前阻塞",
        main: text(operatorSnapshot.releaseReadiness.summary, `当前先处理 ${first.title}。`),
        note: text(operatorSnapshot.releaseReadiness.nextAction, first.detail),
        tone: first.tone || "warn",
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

export function buildOperatorDecisionCards({ security = null, setup = null, snapshot = null } = {}) {
  const operatorSnapshot = snapshot || buildOperatorTruthSnapshot({ security, setup });
  return [
    buildOperatorPrimaryBlockerCard({ security, setup, snapshot: operatorSnapshot }),
    buildOperatorExecutionBoundaryCard({ security, setup, snapshot: operatorSnapshot }),
    buildOperatorCrossDeviceDecisionCard({ security, setup, snapshot: operatorSnapshot }),
  ];
}

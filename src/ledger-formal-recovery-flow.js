import {
  addSeconds,
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
} from "./ledger-core-utils.js";
import { normalizeDidMethod } from "./protocol.js";

export function labelRecoveryRehearsalStatus(status) {
  const normalized = normalizeOptionalText(status) ?? null;
  return {
    passed: "已通过",
    partial: "部分失败",
    failed: "失败",
    fresh: "窗口内",
    stale: "已过期",
    missing: "缺失",
    optional: "可选",
  }[normalized] ?? (normalized ? normalized.replaceAll("_", " ") : "未确认");
}

export function summarizeRecoveryBundleForFormalStatus(bundle = null) {
  if (!bundle || typeof bundle !== "object") {
    return null;
  }
  return {
    bundleId: normalizeOptionalText(bundle.bundleId) ?? null,
    format: normalizeOptionalText(bundle.format) ?? null,
    createdAt: normalizeOptionalText(bundle.createdAt) ?? null,
    machineId: normalizeOptionalText(bundle.machineId) ?? null,
    machineLabel: normalizeOptionalText(bundle.machineLabel) ?? null,
    residentAgentId: normalizeOptionalText(bundle.residentAgentId) ?? null,
    wrappedKeyMode: normalizeOptionalText(bundle.wrappedKeyMode) ?? null,
    includesLedgerEnvelope: Boolean(bundle.includesLedgerEnvelope),
    lastEventHash: normalizeOptionalText(bundle.lastEventHash) ?? null,
    chainId: normalizeOptionalText(bundle.chainId) ?? null,
  };
}

export function buildFormalRecoveryRunbook({
  setupPolicy = {},
  keychainIsolationRequired = false,
  storeEncryption = null,
  signingKey = null,
  backupBundle = null,
  rehearsal = null,
  setupPackage = null,
  latestBundle = null,
  latestRecoveryRehearsal = null,
  latestRecoveryRehearsalAgeHours = null,
  latestRecoveryRehearsalBlocksFreshness = false,
  latestPassedRecoveryRehearsal = null,
  latestPassedRecoveryRehearsalAgeHours = null,
  latestSetupPackage = null,
} = {}) {
  const keyProtectionMissing = normalizeTextList([
    storeEncryption?.status !== "protected" ? "store_key_protected" : null,
    keychainIsolationRequired && storeEncryption?.systemProtected !== true ? "store_key_system_protected" : null,
    signingKey?.status !== "ready" ? "signing_key_ready" : null,
    keychainIsolationRequired && signingKey?.systemProtected !== true ? "signing_key_system_protected" : null,
  ]);
  const keyProtectionCompleted = keyProtectionMissing.length === 0;
  const bundleCompleted = backupBundle?.status && backupBundle.status !== "missing";
  const rehearsalFresh = rehearsal?.status === "fresh";
  const rehearsalCompleted = setupPolicy.requireRecentRecoveryRehearsal
    ? rehearsalFresh
    : Number(rehearsal?.passed || 0) > 0 && !latestRecoveryRehearsalBlocksFreshness;
  const setupPackageCompleted = setupPackage?.status === "present";

  const steps = [
    {
      stepId: "protect_local_store",
      label: keychainIsolationRequired ? "把账本与签名密钥放进系统保护层" : "配置账本与签名密钥",
      primaryCode: keyProtectionMissing[0] ?? "store_key_protected",
      required: true,
      completed: keyProtectionCompleted,
      available: true,
      missingCodes: keyProtectionMissing,
      summary:
        keyProtectionCompleted
          ? keychainIsolationRequired
            ? "账本与签名密钥已进入系统保护层。"
            : "账本与签名密钥已准备完成。"
          : keychainIsolationRequired
            ? "先把存储主密钥和签名密钥放进系统保护层，再继续正式恢复主流程。"
            : "先准备存储主密钥和签名密钥，再继续正式恢复主流程。",
      evidence: {
        storeKeySource: storeEncryption?.source ?? null,
        signingKeySource: signingKey?.source ?? null,
        keychainIsolationRequired,
      },
    },
    {
      stepId: "export_recovery_bundle",
      label: "导出恢复包",
      primaryCode: "recovery_bundle_present",
      required: true,
      completed: bundleCompleted,
      available: keyProtectionCompleted,
      missingCodes: bundleCompleted ? [] : ["recovery_bundle_present"],
      summary:
        bundleCompleted
          ? latestBundle?.createdAt
            ? `最近恢复包创建于 ${latestBundle.createdAt}。`
            : "恢复包已导出。"
          : !keyProtectionCompleted
            ? "先补齐本地密钥保护，再导出恢复包。"
            : "导出至少一份恢复包，确保正式恢复有可携带基线。",
      evidence: {
        status: backupBundle?.status ?? "missing",
        createdAt: latestBundle?.createdAt ?? null,
        includesLedgerEnvelope: Boolean(latestBundle?.includesLedgerEnvelope),
      },
    },
    {
      stepId: "run_recovery_rehearsal",
      label: "执行恢复演练",
      primaryCode: "recovery_rehearsal_recent",
      required: Boolean(setupPolicy.requireRecentRecoveryRehearsal),
      completed: rehearsalCompleted,
      available: keyProtectionCompleted && bundleCompleted,
      missingCodes: rehearsalCompleted ? [] : ["recovery_rehearsal_recent"],
      summary:
        rehearsalCompleted
          ? setupPolicy.requireRecentRecoveryRehearsal
            ? latestPassedRecoveryRehearsalAgeHours != null
              ? `最近一次通过的恢复演练距今 ${Math.round(Number(latestPassedRecoveryRehearsalAgeHours))} 小时。`
              : "恢复演练已通过。"
            : "已保留恢复演练记录。"
          : !bundleCompleted
            ? "先导出恢复包，再执行恢复演练。"
            : setupPolicy.requireRecentRecoveryRehearsal
              ? latestRecoveryRehearsalBlocksFreshness
                ? `最近一次恢复演练为${labelRecoveryRehearsalStatus(latestRecoveryRehearsal?.status)}，不能用更早的通过记录抵消，需要重跑。`
                : latestPassedRecoveryRehearsal
                ? `最近一次通过的恢复演练已超过 ${rehearsal?.maxAgeHours || 0} 小时窗口，需要重跑。`
                : "还没有通过的恢复演练记录。"
              : "当前策略未强制要求恢复演练，但建议至少跑一轮。",
      evidence: {
        status: rehearsal?.status ?? null,
        latestRecoveryRehearsalStatus: normalizeOptionalText(latestRecoveryRehearsal?.status) ?? null,
        latestRecoveryRehearsalCreatedAt: normalizeOptionalText(latestRecoveryRehearsal?.createdAt) ?? null,
        latestRecoveryRehearsalAgeHours:
          latestRecoveryRehearsalAgeHours != null
            ? Math.round(Number(latestRecoveryRehearsalAgeHours))
            : null,
        latestRecoveryRehearsalBlocksFreshness: Boolean(latestRecoveryRehearsalBlocksFreshness),
        createdAt: normalizeOptionalText(latestPassedRecoveryRehearsal?.createdAt) ?? null,
        latestAgeHours:
          latestPassedRecoveryRehearsalAgeHours != null
            ? Math.round(Number(latestPassedRecoveryRehearsalAgeHours))
            : null,
      },
    },
    {
      stepId: "export_setup_package",
      label: "导出初始化包",
      primaryCode: "setup_package_present",
      required: Boolean(setupPolicy.requireSetupPackage),
      completed: setupPackageCompleted,
      available:
        keyProtectionCompleted &&
        bundleCompleted &&
        (!setupPolicy.requireRecentRecoveryRehearsal || rehearsalFresh),
      missingCodes: setupPackageCompleted ? [] : ["setup_package_present"],
      summary:
        setupPackageCompleted
          ? latestSetupPackage?.exportedAt
            ? `最近初始化包导出于 ${latestSetupPackage.exportedAt}。`
            : "初始化包已导出。"
          : !bundleCompleted
            ? "先导出恢复包，再生成初始化包。"
            : setupPolicy.requireRecentRecoveryRehearsal && !rehearsalFresh
              ? "先补齐最新恢复演练，再导出初始化包。"
              : "保留一份初始化包，便于正式恢复和冷启动接管。",
      evidence: {
        status: setupPackage?.status ?? null,
        exportedAt: latestSetupPackage?.exportedAt ?? null,
      },
    },
  ].map((step, index, allSteps) => ({
    ...step,
    status: step.completed ? "ready" : step.available ? "pending" : "blocked",
    blockedByStepIds:
      step.completed || step.available
        ? []
        : allSteps.slice(0, index).filter((entry) => !entry.completed).map((entry) => entry.stepId),
  }));

  const remainingRequiredSteps = steps.filter((step) => step.required && !step.completed);
  const remainingRecommendedSteps = steps.filter((step) => !step.required && !step.completed);
  const nextStep = remainingRequiredSteps[0] ?? remainingRecommendedSteps[0] ?? null;

  return {
    status:
      remainingRequiredSteps.length === 0
        ? "ready"
        : remainingRequiredSteps.some((step) => step.status === "blocked")
          ? "blocked"
          : "partial",
    nextStepId: nextStep?.stepId ?? null,
    nextStepCode: nextStep?.primaryCode ?? null,
    nextStepLabel: nextStep?.label ?? null,
    nextStepSummary: nextStep?.summary ?? null,
    nextStepRequired: nextStep ? Boolean(nextStep.required) : null,
    completedStepCount: steps.filter((step) => step.completed).length,
    totalStepCount: steps.length,
    readyToRehearse: keyProtectionCompleted && bundleCompleted,
    readyToExportSetupPackage:
      keyProtectionCompleted &&
      bundleCompleted &&
      (!setupPolicy.requireRecentRecoveryRehearsal || rehearsalFresh),
    latestEvidence: {
      recoveryBundleCreatedAt: latestBundle?.createdAt ?? null,
      latestRecoveryRehearsalCreatedAt: normalizeOptionalText(latestRecoveryRehearsal?.createdAt) ?? null,
      latestRecoveryRehearsalStatus: normalizeOptionalText(latestRecoveryRehearsal?.status) ?? null,
      latestRecoveryRehearsalBlocksFreshness: Boolean(latestRecoveryRehearsalBlocksFreshness),
      recoveryRehearsalCreatedAt: normalizeOptionalText(latestPassedRecoveryRehearsal?.createdAt) ?? null,
      recoveryRehearsalAgeHours:
        latestPassedRecoveryRehearsalAgeHours != null
          ? Math.round(Number(latestPassedRecoveryRehearsalAgeHours))
          : null,
      setupPackageExportedAt: latestSetupPackage?.exportedAt ?? null,
    },
    blockingSteps: remainingRequiredSteps.map((step) => ({
      stepId: step.stepId,
      label: step.label,
      code: step.primaryCode,
      summary: step.summary,
      status: step.status,
    })),
    recommendedSteps: remainingRecommendedSteps.map((step) => ({
      stepId: step.stepId,
      label: step.label,
      code: step.primaryCode,
      summary: step.summary,
      status: step.status,
    })),
    steps,
    summary:
      remainingRequiredSteps.length === 0
        ? nextStep
          ? `正式恢复基线已满足，当前建议补做：${nextStep.label}。`
          : "正式恢复主流程已全部完成。"
        : nextStep
          ? `正式恢复下一步：${nextStep.label}。`
          : "正式恢复主流程还有未完成步骤。",
  };
}

export function buildFormalRecoveryOperationalCadence({
  setupPolicy = {},
  rehearsal = null,
  latestRecoveryRehearsal = null,
  latestRecoveryRehearsalAgeHours = null,
  latestRecoveryRehearsalBlocksFreshness = false,
  latestPassedRecoveryRehearsal = null,
  latestPassedRecoveryRehearsalAgeHours = null,
  runbook = null,
  durableRestoreReady = false,
} = {}) {
  const rehearsalRequired = Boolean(setupPolicy.requireRecentRecoveryRehearsal);
  const rehearsalWindowHours = Number(setupPolicy.recoveryRehearsalMaxAgeHours || 0);
  const latestPassedAt = normalizeOptionalText(latestPassedRecoveryRehearsal?.createdAt) ?? null;
  const normalizedAgeHours = Number.isFinite(Number(latestPassedRecoveryRehearsalAgeHours))
    ? Number(latestPassedRecoveryRehearsalAgeHours)
    : null;
  const nextRequiredAt =
    latestPassedAt && rehearsalRequired && rehearsalWindowHours > 0
      ? addSeconds(latestPassedAt, rehearsalWindowHours * 60 * 60)
      : null;
  const dueInHours =
    latestPassedAt && rehearsalRequired && normalizedAgeHours != null && rehearsalWindowHours > 0
      ? Math.max(0, Math.round(rehearsalWindowHours - normalizedAgeHours))
      : null;
  const overdueByHours =
    latestPassedAt &&
    rehearsalRequired &&
    normalizedAgeHours != null &&
    rehearsalWindowHours > 0 &&
    normalizedAgeHours > rehearsalWindowHours
      ? Math.round(normalizedAgeHours - rehearsalWindowHours)
      : null;
  const dueSoonThresholdHours =
    rehearsalRequired && rehearsalWindowHours > 0
      ? Math.min(24, Math.max(1, Math.round(rehearsalWindowHours / 4)))
      : null;
  const dueSoon = dueInHours != null && dueSoonThresholdHours != null && dueInHours <= dueSoonThresholdHours;
  const latestRehearsalStatus = normalizeOptionalText(latestRecoveryRehearsal?.status) ?? null;
  const cadenceStatus =
    latestRecoveryRehearsalBlocksFreshness && latestRehearsalStatus === "failed"
      ? "failed"
      : latestRecoveryRehearsalBlocksFreshness
        ? "partial"
        : !rehearsalRequired
          ? latestPassedAt
            ? "optional_ready"
            : "optional_missing"
          : rehearsal?.status === "missing"
            ? "missing"
            : rehearsal?.status === "stale"
              ? "overdue"
              : dueSoon
                ? "due_soon"
                : rehearsal?.status === "fresh"
                  ? "within_window"
                  : "unknown";
  const nextFormalStepLabel = normalizeOptionalText(runbook?.nextStepLabel) ?? null;
  const actionSummary =
    cadenceStatus === "missing"
      ? "现在补跑恢复演练；没有最近一次通过的恢复演练，就不能把正式恢复当成可交付基线。"
      : cadenceStatus === "failed" || cadenceStatus === "partial"
        ? `最近一次恢复演练为${labelRecoveryRehearsalStatus(latestRehearsalStatus)}，先按最新失败事实重跑恢复演练，不能用更早的通过记录继续放行。`
      : cadenceStatus === "overdue"
        ? `最近一次通过的恢复演练已超出 ${rehearsalWindowHours} 小时窗口，先重跑步骤 3，必要时再补步骤 4。`
        : cadenceStatus === "due_soon"
          ? `距离恢复演练窗口到期还剩约 ${dueInHours} 小时，先安排下一轮演练，避免自动恢复还能继续但正式恢复已过期。`
          : !durableRestoreReady && nextFormalStepLabel
            ? `正式恢复当前下一步仍是 ${nextFormalStepLabel}；自动恢复不能替代这条主线。`
            : !rehearsalRequired
              ? "当前策略不强制要求最近一次通过的恢复演练，但每次轮换或交接前都应至少重跑一次。"
              : "当前恢复演练仍在窗口内；保持巡检，并在轮换或交接前重跑。";
  return {
    status: cadenceStatus,
    rehearsalRequired,
    rehearsalWindowHours: rehearsalRequired ? rehearsalWindowHours : null,
    latestPassedAt,
    latestRecoveryRehearsalStatus: latestRehearsalStatus,
    latestRecoveryRehearsalAt: normalizeOptionalText(latestRecoveryRehearsal?.createdAt) ?? null,
    latestRecoveryRehearsalAgeHours:
      latestRecoveryRehearsalAgeHours != null ? Math.round(Number(latestRecoveryRehearsalAgeHours)) : null,
    latestRecoveryRehearsalBlocksFreshness: Boolean(latestRecoveryRehearsalBlocksFreshness),
    nextRequiredAt,
    dueInHours,
    overdueByHours,
    dueSoonThresholdHours,
    actionSummary,
    rerunTriggers: [
      {
        code: "store_key_rotated",
        label: "存储主密钥轮换后重跑 1 -> 2 -> 3 -> 4",
      },
      {
        code: "signing_key_rotated",
        label: "签名密钥轮换后重跑 1 -> 2 -> 3 -> 4",
      },
      {
        code: "recovery_bundle_rotated",
        label: "恢复包重导或轮换后至少重跑 3 -> 4",
      },
      {
        code: "before_cross_device_cutover",
        label: "真实切机前先补一次跨机器恢复演练",
      },
      {
        code: "before_handoff_or_resume",
        label: "事故交接、恢复复机或重新放开执行前确认最近一次恢复演练仍在窗口内",
      },
    ],
    retentionAutomation: {
      available: true,
      endpoint: "/api/security/runtime-housekeeping",
      mode: "audit_or_apply",
      keepLatestRecoveryDefault: 3,
      keepLatestSetupDefault: 3,
      summary: "现场清理只负责撤销只读会话，并按保留窗口清理旧恢复包与旧初始化包，不会替代恢复演练，也不会把正式恢复直接判成已就绪。",
    },
    summary:
      cadenceStatus === "missing"
        ? "当前没有通过的恢复演练记录。"
        : cadenceStatus === "failed" || cadenceStatus === "partial"
          ? `最近一次恢复演练为${labelRecoveryRehearsalStatus(latestRehearsalStatus)}；最新失败事实必须先处理。`
        : cadenceStatus === "overdue"
          ? `最近一次通过的恢复演练已超出 ${rehearsalWindowHours} 小时窗口。`
          : cadenceStatus === "due_soon"
            ? `最近一次通过的恢复演练仍有效，但距离窗口到期只剩约 ${dueInHours} 小时。`
            : cadenceStatus === "optional_missing"
              ? "当前策略不强制要求最近一次通过的恢复演练，但仍建议保留至少一条通过记录。"
              : cadenceStatus === "optional_ready"
                ? "当前策略不强制要求最近一次通过的恢复演练，且已保留通过记录。"
                : "当前恢复演练仍在策略窗口内。",
  };
}

export function buildFormalRecoveryHandoffPacket({
  formalRecoveryFlow = null,
  latestBundle = null,
  latestSetupPackage = null,
  latestPassedRecoveryRehearsal = null,
  latestPassedRecoveryRehearsalAgeHours = null,
  securityPosture = null,
} = {}) {
  const postureMode = normalizeOptionalText(securityPosture?.mode) ?? null;
  const postureSummary = normalizeOptionalText(securityPosture?.summary) ?? null;
  const runbook = formalRecoveryFlow?.runbook ?? null;
  const cadence = formalRecoveryFlow?.operationalCadence ?? null;
  const crossDevice = formalRecoveryFlow?.crossDeviceRecoveryClosure ?? null;
  const nextStepCode = normalizeOptionalText(runbook?.nextStepCode) ?? null;
  const nextStepLabel = normalizeOptionalText(runbook?.nextStepLabel) ?? null;
  const nextStepSummary = normalizeOptionalText(runbook?.nextStepSummary) ?? null;
  const cadenceStatus = normalizeOptionalText(cadence?.status) ?? null;
  const setupPackageAlignment = crossDevice?.setupPackageAlignment ?? null;
  const latestRehearsalCreatedAt = normalizeOptionalText(latestPassedRecoveryRehearsal?.createdAt) ?? null;
  const latestBundleCreatedAt = normalizeOptionalText(latestBundle?.createdAt) ?? null;
  const latestSetupPackageExportedAt =
    normalizeOptionalText(latestSetupPackage?.exportedAt || latestSetupPackage?.createdAt) ?? null;
  const latestRehearsalAgeHours =
    latestPassedRecoveryRehearsalAgeHours != null
      ? Math.round(Number(latestPassedRecoveryRehearsalAgeHours))
      : null;
  const statusText = {
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
    protected: "已受保护",
    enforced: "已强制启用",
    bounded: "有界放行",
    bounded_network: "有界联网",
    restricted: "最小权限",
    degraded: "已退化",
    locked: "已锁定",
    armed: "可启动",
    armed_with_gaps: "可启动但有缺口",
    gated: "被门禁拦截",
    ready_for_rehearsal: "可开始演练",
    pending: "处理中",
    passed: "已通过",
  };
  const labelStatus = (value, fallback = "未确认") => {
    const normalized = normalizeOptionalText(value) ?? null;
    return normalized ? statusText[normalized] || normalized.replaceAll("_", " ") : fallback;
  };
  const latestBundlePortable = Boolean(latestBundle?.includesLedgerEnvelope);
  const latestSetupPackageAligned = latestSetupPackage
    ? setupPackageAlignment && typeof setupPackageAlignment === "object"
      ? Boolean(setupPackageAlignment.ready)
      : !Array.isArray(crossDevice?.sourceBlockingReasons)
        ? Boolean(latestSetupPackage)
        : !crossDevice.sourceBlockingReasons.some((reason) => String(reason || "").startsWith("setup_package_"))
    : false;

  let uniqueBlockingReason = null;
  if (postureMode && postureMode !== "normal") {
    uniqueBlockingReason = {
      code: `security_posture:${postureMode}`,
      label: `当前安全姿态仍是 ${labelStatus(postureMode)}`,
      summary: postureSummary || "姿态还没回到正常，当前先锁边界，不讨论恢复正常。",
    };
  } else if (!Boolean(formalRecoveryFlow?.durableRestoreReady)) {
    uniqueBlockingReason = {
      code: nextStepCode ? `formal_recovery:${nextStepCode}` : "formal_recovery:not_ready",
      label: nextStepLabel ? `正式恢复当前仍需 ${nextStepLabel}` : "正式恢复尚未达标",
      summary:
        nextStepSummary ||
        normalizeOptionalText(formalRecoveryFlow?.summary) ||
        "正式恢复主线还没收口，当前不能把系统交给下一位操作员继续放行。",
    };
  } else if (["missing", "overdue", "partial", "failed"].includes(cadenceStatus)) {
    uniqueBlockingReason = {
      code: `operational_cadence:${cadenceStatus}`,
      label:
        cadenceStatus === "missing"
          ? "当前没有最近一次通过的恢复演练记录"
          : cadenceStatus === "overdue"
            ? "最近一次通过的恢复演练已过期"
            : "最近一次恢复演练未通过",
      summary:
        normalizeOptionalText(cadence?.actionSummary) ||
        normalizeOptionalText(cadence?.summary) ||
        "正式恢复周期不在安全窗口内，交接或复机前先补恢复演练。",
    };
  } else if (!latestBundle) {
    uniqueBlockingReason = {
      code: "recovery_bundle:missing",
      label: "当前没有可交接的恢复包",
      summary: "没有恢复包时，下一位操作员拿不到稳定恢复基线，先导出最新恢复包。",
    };
  } else if (!latestSetupPackage) {
    uniqueBlockingReason = {
      code: "setup_package:missing",
      label: "当前没有可交接的初始化包",
      summary: "没有初始化包时，目标机器仍要靠人工补配置，先导出最新初始化包。",
    };
  }

  const requiredFields = [
    {
      fieldId: "security_posture",
      label: "当前安全姿态",
      status: postureMode ? "ready" : "missing",
      value: postureMode ? `${labelStatus(postureMode)} / ${postureSummary || "当前姿态已记录"}` : "当前没有安全姿态真值",
      summary: postureSummary || "交接时先说明当前是否还在只读、禁执行或紧急锁定。",
    },
    {
      fieldId: "formal_recovery_next_step",
      label: "当前正式恢复下一步",
      status: nextStepLabel || normalizeOptionalText(runbook?.status) === "ready" ? "ready" : "missing",
      value:
        normalizeOptionalText(runbook?.status) === "ready"
          ? "正式恢复已就绪"
          : nextStepLabel || "当前没有正式恢复下一步真值",
      summary:
        nextStepSummary ||
        (normalizeOptionalText(runbook?.status) === "ready"
          ? "正式恢复主线已经收口，交接时只需要说明最近证据和当前周期。"
          : "交接时不要只说“还差一点”，要明确下一步到底做什么。"),
    },
    {
      fieldId: "latest_passed_rehearsal",
      label: "最近一次通过的恢复演练",
      status: !latestRehearsalCreatedAt ? "missing" : cadenceStatus === "due_soon" ? "partial" : "ready",
      value: latestRehearsalCreatedAt
        ? `${latestRehearsalCreatedAt} / ${labelStatus(latestPassedRecoveryRehearsal?.status, "已通过")}`
        : "当前没有通过的恢复演练记录",
      summary:
        cadenceStatus === "due_soon"
          ? cadence?.actionSummary || "最近一次恢复演练即将到期，交接后尽快补跑。"
          : latestRehearsalAgeHours != null
            ? `最近一次通过记录距今约 ${latestRehearsalAgeHours} 小时。`
            : normalizeOptionalText(cadence?.summary) || "交接前要先确认最近一次恢复演练是否仍在窗口内。",
    },
    {
      fieldId: "latest_recovery_bundle",
      label: "最近恢复包",
      status: !latestBundle ? "missing" : latestBundlePortable ? "ready" : "partial",
      value: latestBundle
        ? latestBundleCreatedAt
          ? `${latestBundleCreatedAt} / ${latestBundlePortable ? "可跨机器恢复包" : "仅密钥恢复包"}`
          : latestBundlePortable
            ? "已存在可跨机器恢复包"
            : "已存在仅密钥恢复包"
        : "当前没有恢复包记录",
      summary:
        latestBundle && !latestBundlePortable
          ? "当前最新恢复包不含账本封套，跨机器前先重导一份可跨机器恢复包。"
          : "交接时至少说明最近恢复包时间，以及它能不能直接跨机器导入。",
    },
    {
      fieldId: "latest_setup_package",
      label: "最近初始化包",
      status: !latestSetupPackage ? "missing" : latestSetupPackageAligned ? "ready" : "partial",
      value: latestSetupPackage
        ? latestSetupPackageExportedAt
          ? `${latestSetupPackageExportedAt} / ${latestSetupPackageAligned ? "已对齐当前恢复基线" : "未对齐当前恢复基线"}`
          : latestSetupPackageAligned
            ? "已存在对齐当前恢复基线的初始化包"
            : "已存在初始化包，但还没对齐当前恢复基线"
        : "当前没有初始化包记录",
      summary:
        latestSetupPackageAligned
          ? "交接时至少说明最近初始化包时间，以及它是否仍与当前恢复基线对齐。"
          : "当前初始化包没有对齐当前恢复基线，交接后先重导一份。",
    },
    {
      fieldId: "single_blocker",
      label: "当前唯一阻塞原因",
      status: uniqueBlockingReason || formalRecoveryFlow ? "ready" : "missing",
      value: uniqueBlockingReason?.label || "当前没有唯一阻塞原因",
      summary:
        uniqueBlockingReason?.summary ||
        "当前没有单一阻塞；交接后按周期巡检、恢复演练窗口和标准动作继续推进。",
    },
  ];

  const missingFieldIds = requiredFields
    .filter((entry) => entry.status === "missing")
    .map((entry) => entry.fieldId);
  const unreadyFields = requiredFields.filter((entry) => entry.status !== "ready");
  const unreadyLabels = unreadyFields.map((entry) => entry.label);
  const missingLabels = unreadyFields
    .filter((entry) => entry.status === "missing")
    .map((entry) => entry.label);
  const partialLabels = unreadyFields
    .filter((entry) => entry.status === "partial")
    .map((entry) => entry.label);

  return {
    status: unreadyFields.length === 0 ? "ready" : "partial",
    readyToHandoff: unreadyFields.length === 0,
    readyFieldCount: requiredFields.filter((entry) => entry.status === "ready").length,
    totalFieldCount: requiredFields.length,
    missingFieldIds,
    nextReviewAt: normalizeOptionalText(cadence?.nextRequiredAt) ?? null,
    summary:
      unreadyLabels.length === 0
        ? "恢复交接最小信息集已齐；下一位操作员可以直接按当前真值继续。"
        : missingLabels.length > 0 && partialLabels.length > 0
          ? `恢复交接最小信息集还缺 ${missingLabels.join("、")}，且 ${partialLabels.join("、")} 仍未对齐。先处理这些项，再交接。`
          : missingLabels.length > 0
            ? `恢复交接最小信息集还缺 ${missingLabels.join("、")}。先补齐这些字段，再交接。`
            : `恢复交接最小信息集已在场，但 ${partialLabels.join("、")} 仍未对齐。先处理这些项，再交接。`,
    uniqueBlockingReason: uniqueBlockingReason || {
      code: "none",
      label: "当前没有唯一阻塞原因",
      summary: "当前没有单一阻塞；继续按正式恢复周期巡检即可。",
    },
    requiredFields,
  };
}

export function buildCrossDeviceRecoveryClosure({
  formalRecoveryFlow = null,
  latestBundle = null,
  latestSetupPackage = null,
  latestSetupPackageResidentBinding = null,
  latestPassedRecoveryRehearsal = null,
  latestPassedRecoveryRehearsalAgeHours = null,
  latestPassedRecoveryRehearsalView = null,
  residentAgentId = null,
  residentDidMethod = null,
  securityPosture = null,
} = {}) {
  const postureMode = normalizeOptionalText(securityPosture?.mode) ?? null;
  const cadenceStatus = normalizeOptionalText(formalRecoveryFlow?.operationalCadence?.status) ?? null;
  const sourceBaselineReady = Boolean(formalRecoveryFlow?.durableRestoreReady);
  const latestRehearsalView =
    latestPassedRecoveryRehearsalView && typeof latestPassedRecoveryRehearsalView === "object"
      ? latestPassedRecoveryRehearsalView
      : null;
  const normalizedLatestSetupPackageResidentBinding =
    latestSetupPackageResidentBinding && typeof latestSetupPackageResidentBinding === "object"
      ? latestSetupPackageResidentBinding
      : {};
  const normalizedResidentAgentId = normalizeOptionalText(residentAgentId) ?? null;
  const normalizedSetupPackageResidentAgentId =
    normalizeOptionalText(
      normalizedLatestSetupPackageResidentBinding.effectiveResolvedResidentAgentId ||
        normalizedLatestSetupPackageResidentBinding.effectivePhysicalResidentAgentId
    ) ?? null;
  const normalizedResidentDidMethod = normalizeDidMethod(residentDidMethod) || null;
  const bundlePortable = Boolean(latestBundle?.includesLedgerEnvelope);
  const bundleReady = Boolean(latestBundle && bundlePortable);
  const packageReferencesLatestBundle =
    Boolean(latestSetupPackage) &&
    Boolean(latestBundle) &&
    normalizeOptionalText(latestSetupPackage?.latestRecoveryBundleId) != null &&
    normalizeOptionalText(latestSetupPackage?.latestRecoveryBundleId) ===
      normalizeOptionalText(latestBundle?.bundleId);
  const packageResidentAligned =
    Boolean(latestSetupPackage) &&
    Boolean(normalizedResidentAgentId) &&
    normalizedSetupPackageResidentAgentId === normalizedResidentAgentId;
  const packageDidMethodAligned =
    Boolean(latestSetupPackage) &&
    Boolean(normalizedResidentDidMethod) &&
    (normalizeDidMethod(latestSetupPackage.residentDidMethod) || null) === normalizedResidentDidMethod;
  const setupPackageReady =
    Boolean(latestSetupPackage) &&
    packageReferencesLatestBundle &&
    packageResidentAligned &&
    packageDidMethodAligned;
  const setupPackageAlignment = {
    present: Boolean(latestSetupPackage),
    referencesLatestBundle: latestSetupPackage && latestBundle ? packageReferencesLatestBundle : null,
    residentAgentAligned: latestSetupPackage && normalizedResidentAgentId ? packageResidentAligned : null,
    residentDidMethodAligned: latestSetupPackage && normalizedResidentDidMethod ? packageDidMethodAligned : null,
    ready: setupPackageReady,
    blockingReasons: normalizeTextList([
      latestSetupPackage && latestBundle && !packageReferencesLatestBundle ? "latest_bundle_mismatch" : null,
      latestSetupPackage && normalizedResidentAgentId && !packageResidentAligned ? "resident_agent_mismatch" : null,
      latestSetupPackage && normalizedResidentDidMethod && !packageDidMethodAligned
        ? "resident_did_method_mismatch"
        : null,
    ]),
  };
  const sourceBlockingReasons = normalizeTextList([
    postureMode === "panic" ? "security_posture:panic" : null,
    ...(Array.isArray(formalRecoveryFlow?.missingRequiredCodes)
      ? formalRecoveryFlow.missingRequiredCodes.map((code) => `formal_recovery_flow:${code}`)
      : []),
    ["missing", "overdue", "partial", "failed"].includes(cadenceStatus)
      ? `operational_cadence:${cadenceStatus}`
      : null,
    latestBundle ? null : "recovery_bundle_missing",
    latestBundle && !bundlePortable ? "recovery_bundle_not_portable" : null,
    normalizedResidentAgentId ? null : "resident_agent_missing",
    normalizedResidentDidMethod ? null : "resident_did_method_missing",
    latestSetupPackage ? null : "setup_package_missing",
    latestSetupPackage && latestBundle && !packageReferencesLatestBundle
      ? "setup_package_not_aligned_with_latest_bundle"
      : null,
    latestSetupPackage && normalizedResidentAgentId && !packageResidentAligned
      ? "setup_package_resident_agent_mismatch"
      : null,
    latestSetupPackage && normalizedResidentDidMethod && !packageDidMethodAligned
      ? "setup_package_resident_did_method_mismatch"
      : null,
  ]);
  const readyForRehearsal = sourceBlockingReasons.length === 0;
  const warnings = normalizeTextList([
    postureMode && postureMode !== "normal" && postureMode !== "panic" ? `security_posture:${postureMode}` : null,
    cadenceStatus === "due_soon" ? "operational_cadence:due_soon" : null,
    latestSetupPackage && !normalizeBooleanFlag(latestSetupPackage.setupComplete, false)
      ? "setup_package_reports_incomplete_source_state"
      : null,
  ]);
  const rawSteps = [
    {
      stepId: "confirm_source_formal_flow",
      label: "确认源机器正式恢复主线",
      required: true,
      completed: sourceBaselineReady,
      available: true,
      summary:
        sourceBaselineReady
          ? "源机器正式恢复主线已达到可交付基线。"
          : formalRecoveryFlow?.runbook?.nextStepLabel
            ? `源机器正式恢复还没收口，当前先补 ${formalRecoveryFlow.runbook.nextStepLabel}。`
            : "先把源机器正式恢复主线补齐，再开始跨机器恢复。",
    },
    {
      stepId: "export_fresh_recovery_bundle",
      label: "导出最新恢复包",
      required: true,
      completed: bundleReady,
      available: true,
      summary:
        bundleReady
          ? latestBundle?.createdAt
            ? `最新可跨机器恢复包创建于 ${latestBundle.createdAt}。`
            : "已具备可跨机器恢复包。"
          : latestBundle
            ? "当前最新恢复包没有账本封套，先重导一份可跨机器导入的恢复包。"
            : "先导出最新恢复包，并保留独立恢复口令。",
    },
    {
      stepId: "export_fresh_setup_package",
      label: "导出最新初始化包",
      required: true,
      completed: setupPackageReady,
      available: sourceBaselineReady && bundleReady,
      summary:
        setupPackageReady
          ? latestSetupPackage?.exportedAt
            ? `最新初始化包已与当前恢复包、常驻 Agent 和 DID 方法对齐，导出时间 ${latestSetupPackage.exportedAt}。`
            : "已具备与当前恢复包、常驻 Agent 和 DID 方法对齐的初始化包。"
          : !bundleReady
            ? "先准备好可跨机器恢复包，再立刻导出与之对齐的初始化包。"
            : !normalizedResidentAgentId
              ? "当前还没有常驻 Agent 绑定真值，先绑定常驻 Agent，再重导一份初始化包。"
              : !normalizedResidentDidMethod
                ? "当前还没有常驻 DID 方法真值，先补齐 DID 方法，再重导一份初始化包。"
                : latestSetupPackage && !packageReferencesLatestBundle
                  ? "当前初始化包没有对齐最新恢复包，先重导一份。"
                  : latestSetupPackage && !packageResidentAligned
                    ? "当前初始化包没有对齐当前常驻 Agent，先重导一份。"
                    : latestSetupPackage && !packageDidMethodAligned
                      ? "当前初始化包没有对齐当前常驻 DID 方法，先重导一份。"
                      : latestSetupPackage
                        ? "当前初始化包还没达到跨机器恢复要求，先重导一份。"
                        : "在恢复包导出后立刻导出最新初始化包。",
    },
    {
      stepId: "import_recovery_bundle_on_target",
      label: "在目标机器导入恢复包",
      required: true,
      completed: false,
      available: readyForRehearsal,
      summary: "目标机器先做预演导入；如果已经存在存储主密钥或账本封套，必须显式确认覆盖。",
    },
    {
      stepId: "import_setup_package_on_target",
      label: "在目标机器导入初始化包",
      required: true,
      completed: false,
      available: false,
      summary: "恢复常驻 Agent、DID 方法与最小运行配置，不靠手工拼 JSON 接回。",
    },
    {
      stepId: "verify_target_runtime",
      label: "在目标机器做一致性核验",
      required: true,
      completed: false,
      available: false,
      summary: "核对 health、security、device setup、常驻 Agent、chainId、受限执行与本地推理引擎。",
    },
    {
      stepId: "record_outcome_and_decide_cutover",
      label: "记录结果并决定是否允许真实切机",
      required: true,
      completed: false,
      available: false,
      summary: "记录唯一阻塞原因，并由持有者 / 委托主体决定是否允许真实切机。",
    },
  ];
  const steps = rawSteps.map((step, index, allSteps) => ({
    ...step,
    status: step.completed ? "ready" : step.available ? "pending" : "blocked",
    blockedByStepIds:
      step.completed || step.available
        ? []
        : allSteps.slice(0, index).filter((entry) => !entry.completed).map((entry) => entry.stepId),
  }));
  const nextStep =
    postureMode === "panic"
      ? {
          stepId: "stabilize_security_posture",
          label: "先处理紧急锁定姿态",
          summary: "当前安全姿态是紧急锁定；先保全现场并解释根因，再继续跨机器恢复。",
        }
      : steps.find((step) => !step.completed && step.available) ?? steps.find((step) => !step.completed) ?? null;
  const cutoverGateReasons = normalizeTextList([
    ...(!readyForRehearsal ? sourceBlockingReasons : []),
    "cross_device_rehearsal_result_missing",
  ]);

  return {
    status: readyForRehearsal ? "ready_for_rehearsal" : "blocked",
    readyForRehearsal,
    readyForCutover: false,
    sourceBlockingReasons,
    warnings,
    nextStepId: nextStep?.stepId ?? null,
    nextStepLabel: nextStep?.label ?? null,
    nextStepSummary: nextStep?.summary ?? null,
    sourceReadiness: {
      formalFlowReady: sourceBaselineReady,
      securityPostureMode: postureMode,
      cadenceStatus,
      residentAgentBound: Boolean(normalizedResidentAgentId),
      residentDidMethod: normalizedResidentDidMethod,
    },
    setupPackageAlignment,
    latestBundle,
    latestSetupPackage,
    latestPassedRecoveryRehearsal: latestRehearsalView,
    latestPassedRecoveryRehearsalAgeHours:
      latestPassedRecoveryRehearsalAgeHours != null
        ? Math.round(Number(latestPassedRecoveryRehearsalAgeHours))
        : null,
    targetVerificationChecks: [
      "GET /api/health",
      "GET /api/security",
      "GET /api/device/setup",
      "常驻 Agent 一致",
      "chainId 一致",
      "正式恢复状态合理",
      "受限执行仍受控",
      "本地推理引擎可探测 / 可预热",
    ],
    cutoverGate: {
      ready: false,
      decisionOwner: "holder_or_principal",
      gateReasons: cutoverGateReasons,
      summary:
        readyForRehearsal
          ? "源机器已经具备跨机器恢复演练前置条件，但没有目标机器通过记录前，不能批准真实切机。"
          : "先把源机器前置条件补齐，再谈真实切机。",
    },
    steps,
    summary:
      readyForRehearsal
        ? "源机器已经具备跨机器恢复演练前置条件，但还没有目标机器通过记录，所以现在只能开始演练，不能宣称可切机。"
        : nextStep
          ? `跨机器恢复还没收口，当前先 ${nextStep.label}。`
          : "跨机器恢复还没收口。",
  };
}

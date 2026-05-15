import {
  cloneJson,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  DEFAULT_RUNNER_AUTO_RECOVERY_MAX_ATTEMPTS,
} from "./ledger-auto-recovery-readiness.js";
import {
  buildAutoRecoveryFailureSemantics,
} from "./runtime-failure-semantics.js";

export function buildAutoRecoveryAttemptRecord({
  attempt = 0,
  run = null,
  recoveryAction = null,
} = {}) {
  return {
    attempt,
    runId: run?.runId ?? null,
    runStatus: normalizeOptionalText(run?.status) ?? null,
    recoveryAction: normalizeOptionalText(recoveryAction?.action) ?? null,
    recoveryActionId: normalizeOptionalText(recoveryAction?.recoveryActionId) ?? null,
    resumeBoundaryId:
      normalizeOptionalText(recoveryAction?.followup?.resumeBoundaryId) ??
      normalizeOptionalText(recoveryAction?.compactBoundaryId) ??
      normalizeOptionalText(run?.resumeBoundaryId) ??
      null,
    createdAt: now(),
  };
}

export function buildAutoRecoveryClosure(autoRecovery = null) {
  if (!autoRecovery || typeof autoRecovery !== "object") {
    return null;
  }
  const chain = Array.isArray(autoRecovery.chain) ? autoRecovery.chain : [];
  const gateReasons = normalizeTextList(autoRecovery.gateReasons);
  const dependencyWarnings = normalizeTextList(autoRecovery.dependencyWarnings);
  const failureSemantics =
    autoRecovery.failureSemantics && typeof autoRecovery.failureSemantics === "object"
      ? cloneJson(autoRecovery.failureSemantics)
      : buildAutoRecoveryFailureSemantics(autoRecovery);
  const verification =
    autoRecovery.finalVerification && typeof autoRecovery.finalVerification === "object"
      ? autoRecovery.finalVerification
      : null;
  const triggerStatus = autoRecovery.requested
    ? autoRecovery.triggerRunId || autoRecovery.initialRunId || autoRecovery.initialRecoveryAction
      ? "triggered"
      : "armed"
    : "not_requested";
  const planStatus = autoRecovery.plan
    ? "planned"
    : autoRecovery.status === "not_needed"
      ? "not_needed"
      : autoRecovery.status === "disabled"
        ? "disabled"
        : autoRecovery.status === "human_review_required"
          ? "manual_only"
          : "unplanned";
  const gateStatus = autoRecovery.enabled === false
    ? "disabled"
    : autoRecovery.ready === true
      ? "passed"
      : autoRecovery.ready === false
        ? "blocked"
        : "pending";
  const executionStatus = autoRecovery.resumed
    ? "resumed"
    : autoRecovery.error
      ? "failed"
      : autoRecovery.plan
        ? "pending"
        : autoRecovery.status ?? "idle";
  const verificationStatus = verification == null
    ? autoRecovery.resumed
      ? "not_reported"
      : "not_run"
    : verification.valid === false
      ? "needs_review"
      : "passed";
  const outcomeStatus = normalizeOptionalText(autoRecovery.finalStatus) ?? normalizeOptionalText(autoRecovery.status) ?? "unknown";

  return {
    status: normalizeOptionalText(autoRecovery.status) ?? null,
    summary: normalizeOptionalText(autoRecovery.summary) ?? null,
    chainLength: chain.length,
    finalStatus: normalizeOptionalText(autoRecovery.finalStatus) ?? null,
    finalRunId: normalizeOptionalText(autoRecovery.finalRunId) ?? null,
    failureSemantics,
    phases: [
      {
        phaseId: "trigger",
        status: triggerStatus,
        summary:
          triggerStatus === "triggered"
            ? `由运行 ${autoRecovery.triggerRunId || autoRecovery.initialRunId || "unknown"} 触发自动恢复。`
            : triggerStatus === "armed"
              ? "自动恢复已打开，但本轮还没有触发条件。"
              : "当前响应未请求自动恢复。",
      },
      {
        phaseId: "plan",
        status: planStatus,
        summary:
          autoRecovery.plan?.summary ||
          (planStatus === "not_needed"
            ? "本轮没有生成新的自动恢复计划。"
            : planStatus === "disabled"
              ? "自动恢复已关闭，不会继续规划。"
              : planStatus === "manual_only"
                ? "当前恢复类型需要人工复核，自动续跑不会自动推进。"
                : "自动恢复计划尚未生成。"),
      },
      {
        phaseId: "gate",
        status: gateStatus,
        summary:
          gateStatus === "passed"
            ? "自动恢复门禁已通过。"
            : gateStatus === "blocked"
              ? `自动恢复被门禁拦截：${gateReasons.join(", ") || "unknown"}.`
              : gateStatus === "disabled"
                ? "自动恢复门禁未启用，因为自动恢复整体已关闭。"
                : "自动恢复门禁等待判定。",
      },
      {
        phaseId: "execution",
        status: executionStatus,
        summary:
          autoRecovery.resumed
            ? `自动恢复已实际续跑，共串起 ${chain.length} 步恢复链。`
            : autoRecovery.error
              ? `自动恢复执行失败：${autoRecovery.error}`
              : autoRecovery.plan
                ? "自动恢复已完成规划，等待或准备进入下一次续跑。"
                : "自动恢复本轮没有进入执行阶段。",
      },
      {
        phaseId: "verification",
        status: verificationStatus,
        summary:
          verification == null
            ? autoRecovery.resumed
              ? "续跑结果未附带新的本地校验结论。"
              : "本轮没有新的自动恢复校验结果。"
            : verification.valid === false
              ? "自动恢复后的本地校验提示需要进一步复核。"
              : "自动恢复后的本地校验通过。",
      },
      {
        phaseId: "outcome",
        status: outcomeStatus,
        summary:
          normalizeOptionalText(autoRecovery.summary) ??
          `自动恢复当前收口到 ${normalizeOptionalText(autoRecovery.finalStatus) ?? normalizeOptionalText(autoRecovery.status) ?? "unknown"}。`,
      },
    ],
    gateReasons,
    dependencyWarnings,
  };
}

export function buildDisabledAutoRecoveryState({
  recoveryAttempt = 0,
  maxRecoveryAttempts = 0,
  chain = [],
  finalRunId = null,
  finalStatus = null,
  finalVerification = null,
} = {}) {
  return {
    requested: false,
    enabled: false,
    resumed: false,
    ready: false,
    attempt: Math.max(0, Math.floor(toFiniteNumber(recoveryAttempt, 0))),
    maxAttempts: Math.max(0, Math.floor(toFiniteNumber(maxRecoveryAttempts, 0))),
    plan: null,
    status: "disabled",
    summary: "自动恢复已关闭。",
    gateReasons: [],
    dependencyWarnings: [],
    chain: cloneJson(Array.isArray(chain) ? chain : []) ?? [],
    finalRunId: normalizeOptionalText(finalRunId) ?? null,
    finalStatus: normalizeOptionalText(finalStatus) ?? null,
    finalVerification: cloneJson(finalVerification) ?? null,
  };
}

export function attachAutoRecoveryState(result = {}, autoRecovery = null) {
  const normalizedAutoRecovery =
    autoRecovery && typeof autoRecovery === "object"
      ? cloneJson(autoRecovery)
      : null;
  if (normalizedAutoRecovery) {
    normalizedAutoRecovery.failureSemantics = buildAutoRecoveryFailureSemantics(normalizedAutoRecovery);
  }
  const closure = buildAutoRecoveryClosure(normalizedAutoRecovery);
  if (normalizedAutoRecovery) {
    normalizedAutoRecovery.closure = closure;
  }
  const chain = Array.isArray(normalizedAutoRecovery?.chain) ? normalizedAutoRecovery.chain : [];
  return {
    ...result,
    autoRecovery: normalizedAutoRecovery,
    autoResumed: Boolean(normalizedAutoRecovery?.resumed),
    autoResumeAttemptCount: Math.max(0, chain.length - 1),
    recoveryChain: chain,
    capabilityBoundarySummary: normalizedAutoRecovery
      ? {
          ...(cloneJson(result.capabilityBoundarySummary) ?? {}),
          autoRecovery: {
            status: normalizedAutoRecovery.status ?? null,
            summary: normalizedAutoRecovery.summary ?? null,
            ready: normalizedAutoRecovery.ready ?? null,
            attemptCount: chain.length,
            gateReasons: cloneJson(normalizedAutoRecovery.gateReasons) ?? [],
            dependencyWarnings: cloneJson(normalizedAutoRecovery.dependencyWarnings) ?? [],
            failureSemantics: cloneJson(normalizedAutoRecovery.failureSemantics) ?? null,
            finalStatus: normalizedAutoRecovery.finalStatus ?? null,
            closure,
          },
        }
      : result.capabilityBoundarySummary,
  };
}

export function mergeResumedAutoRecoveryResult(
  resumedRunner,
  {
    recursiveAutoRecovery = null,
    fallbackAutoRecovery = null,
    run = null,
    recoveryAction = null,
    readiness = null,
    inheritedRecoveryChain = [],
    recoveryAttempt = 0,
    maxRecoveryAttempts = DEFAULT_RUNNER_AUTO_RECOVERY_MAX_ATTEMPTS,
    extra = {},
  } = {}
) {
  const recursiveChain = Array.isArray(recursiveAutoRecovery?.chain) && recursiveAutoRecovery.chain.length > 0
    ? recursiveAutoRecovery.chain
    : Array.isArray(fallbackAutoRecovery?.chain)
      ? fallbackAutoRecovery.chain
      : [];
  const mergedDependencyWarnings = normalizeTextList([
    ...(fallbackAutoRecovery?.dependencyWarnings || []),
    ...(Array.isArray(recursiveAutoRecovery?.dependencyWarnings) ? recursiveAutoRecovery.dependencyWarnings : []),
  ]);
  const recursiveStatus = normalizeOptionalText(recursiveAutoRecovery?.status) ?? null;
  const mergedStatus =
    recursiveStatus && !["not_needed", "not_requested"].includes(recursiveStatus)
      ? recursiveStatus
      : resumedRunner.run?.status && resumedRunner.run.status !== "rehydrate_required"
        ? "resumed"
        : "resumed_with_followup";
  const recursiveSummary = normalizeOptionalText(recursiveAutoRecovery?.summary) ?? null;
  const recursiveSummaryUsable =
    recursiveSummary &&
    recursiveStatus &&
    !["not_needed", "not_requested"].includes(recursiveStatus);
  const fallbackSummary = normalizeOptionalText(fallbackAutoRecovery?.summary) ?? null;
  const mergedSummary =
    mergedStatus === "resumed"
      ? recursiveSummaryUsable
        ? recursiveSummary
        : `自动恢复已续跑到 ${resumedRunner.run?.status || "next_stage"}。`
      : recursiveSummaryUsable
        ? recursiveSummary
        : fallbackSummary || "自动恢复已继续推进，但仍需后续动作。";
  return attachAutoRecoveryState(resumedRunner, {
    ...(cloneJson(recursiveAutoRecovery) ?? {}),
    ...(cloneJson(fallbackAutoRecovery) ?? {}),
    requested: true,
    enabled: true,
    resumed: true,
    ready: readiness?.ready ?? fallbackAutoRecovery?.ready ?? true,
    attempt: recoveryAttempt,
    maxAttempts: maxRecoveryAttempts,
    status: mergedStatus,
    summary: mergedSummary,
    gateReasons: cloneJson(recursiveAutoRecovery?.gateReasons) ?? cloneJson(fallbackAutoRecovery?.gateReasons) ?? [],
    dependencyWarnings: mergedDependencyWarnings,
    triggerRunId: run?.runId ?? null,
    triggerRecoveryActionId: recoveryAction?.recoveryActionId ?? null,
    initialRunId: inheritedRecoveryChain[0]?.runId ?? run?.runId ?? null,
    initialStatus: inheritedRecoveryChain[0]?.runStatus ?? run?.status ?? null,
    initialRecoveryAction: cloneJson(recoveryAction) ?? null,
    chain: recursiveChain.length > 0 ? recursiveChain : cloneJson(fallbackAutoRecovery?.chain) ?? [],
    finalRunId: resumedRunner.run?.runId ?? recursiveAutoRecovery?.finalRunId ?? fallbackAutoRecovery?.finalRunId ?? null,
    finalStatus: resumedRunner.run?.status ?? recursiveAutoRecovery?.finalStatus ?? fallbackAutoRecovery?.finalStatus ?? null,
    finalVerification:
      cloneJson(resumedRunner.verification) ??
      cloneJson(recursiveAutoRecovery?.finalVerification) ??
      cloneJson(fallbackAutoRecovery?.finalVerification) ??
      null,
    ...extra,
  });
}

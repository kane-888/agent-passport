import {
  cloneJson,
  normalizeBooleanFlag,
  normalizeOptionalText,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  isRuntimeLocalReasonerConfigured,
  normalizeDeviceRuntime,
  normalizeRuntimeLocalReasonerConfig,
  normalizeRuntimeReasonerProvider,
} from "./ledger-device-runtime.js";

const DEFAULT_RUNNER_LOCAL_REASONER_FAILURE_FRESHNESS_MS = Math.max(
  1000,
  Math.floor(
    toFiniteNumber(process.env.AGENT_PASSPORT_RUNNER_LOCAL_REASONER_FAILURE_FRESHNESS_MS, 5 * 60 * 1000)
  )
);

function isRunnerHealthGatedLocalReasonerProvider(provider) {
  return ["ollama_local", "local_command"].includes(normalizeRuntimeReasonerProvider(provider) ?? "");
}

function parseRunnerReasonerTimestampMs(value) {
  const parsed = new Date(normalizeOptionalText(value) || "").getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function hasExplicitRunnerLocalReasonerOverride(payload = {}) {
  const base = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const topLevelLocalFields = [
    "localReasoner",
    "localReasonerProvider",
    "localReasonerCommand",
    "localReasonerArgs",
    "localReasonerCwd",
    "localReasonerBaseUrl",
    "localReasonerPath",
    "localReasonerTimeoutMs",
    "localReasonerModel",
    "localReasonerFormat",
    "localReasonerMaxInputBytes",
    "localReasonerMaxOutputBytes",
    "localReasonerSelection",
  ];
  if (topLevelLocalFields.some((key) => Object.prototype.hasOwnProperty.call(base, key))) {
    return true;
  }

  const explicitProvider =
    normalizeRuntimeReasonerProvider(base.reasonerProvider) ??
    normalizeRuntimeReasonerProvider(base.provider) ??
    null;
  if (isRunnerHealthGatedLocalReasonerProvider(explicitProvider) || explicitProvider === "local_mock") {
    return true;
  }

  const reasonerConfig =
    base.reasoner && typeof base.reasoner === "object" && !Array.isArray(base.reasoner)
      ? base.reasoner
      : null;
  const reasonerProvider = normalizeRuntimeReasonerProvider(reasonerConfig?.provider) ?? null;
  return isRunnerHealthGatedLocalReasonerProvider(reasonerProvider) || reasonerProvider === "local_mock";
}

export function isRunnerOnlineReasonerProvider(provider) {
  return ["http", "openai_compatible"].includes(normalizeRuntimeReasonerProvider(provider) ?? "");
}

export function isRunnerQualityEscalationLocalReasonerProvider(provider) {
  return ["ollama_local", "local_command", "local_mock"].includes(normalizeRuntimeReasonerProvider(provider) ?? "");
}

export function buildRunnerReasonerDegradationMetadata(provider = null) {
  const normalizedProvider = normalizeRuntimeReasonerProvider(provider) ?? null;
  const degradedLocalFallback = normalizedProvider === "local_mock";
  return {
    degradedLocalFallback,
    degradedLocalFallbackReason: degradedLocalFallback ? "local_mock_fallback" : null,
  };
}

export function buildRunnerAutoRecoveryFallbackMetadata(payload = {}, provider = null) {
  const action = normalizeOptionalText(payload?.autoRecoveryResumeAction) ?? null;
  const fallbackActivated = normalizeBooleanFlag(payload?.autoRecoveryFallbackActivated, false);
  if (!fallbackActivated) {
    return {};
  }
  const fallbackProvider =
    normalizeRuntimeReasonerProvider(payload?.autoRecoveryFallbackProvider) ??
    normalizeRuntimeReasonerProvider(provider) ??
    null;
  return {
    fallbackProvider,
    fallbackActivated: true,
    fallbackCause:
      normalizeOptionalText(payload?.autoRecoveryFallbackCause) ??
      (action === "restore_local_reasoner" && fallbackProvider === "local_mock"
        ? "restore_local_reasoner_failed"
        : null),
  };
}

function resolveRunnerReasonerPayloadConfig(payload = {}) {
  return payload?.reasoner && typeof payload.reasoner === "object" && !Array.isArray(payload.reasoner)
    ? payload.reasoner
    : {};
}

function hasRunnerHttpReasonerConfig(payload = {}) {
  const reasonerConfig = resolveRunnerReasonerPayloadConfig(payload);
  const reasonerUrl =
    normalizeOptionalText(payload.reasonerUrl) ??
    normalizeOptionalText(reasonerConfig.url) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_REASONER_URL) ??
    null;
  return Boolean(reasonerUrl);
}

function hasRunnerOpenAICompatibleReasonerConfig(payload = {}) {
  const reasonerConfig = resolveRunnerReasonerPayloadConfig(payload);
  const baseUrl =
    normalizeOptionalText(payload.reasonerUrl) ??
    normalizeOptionalText(payload.reasonerBaseUrl) ??
    normalizeOptionalText(reasonerConfig.url) ??
    normalizeOptionalText(reasonerConfig.baseUrl) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_REASONER_URL) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_LLM_BASE_URL) ??
    null;
  const model =
    normalizeOptionalText(payload.reasonerModel) ??
    normalizeOptionalText(reasonerConfig.model) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_REASONER_MODEL) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_LLM_MODEL) ??
    null;
  return Boolean(baseUrl && model);
}

function resolveRunnerQualityEscalationProvider(payload = {}, { requestedProvider = null, onlineAllowed = false } = {}) {
  if (!onlineAllowed) {
    return null;
  }
  const normalizedRequestedProvider = normalizeRuntimeReasonerProvider(requestedProvider) ?? null;
  if (normalizedRequestedProvider === "openai_compatible") {
    return hasRunnerOpenAICompatibleReasonerConfig(payload) ? "openai_compatible" : null;
  }
  if (normalizedRequestedProvider === "http") {
    return hasRunnerHttpReasonerConfig(payload) ? "http" : null;
  }
  if (hasRunnerOpenAICompatibleReasonerConfig(payload)) {
    return "openai_compatible";
  }
  if (hasRunnerHttpReasonerConfig(payload)) {
    return "http";
  }
  return null;
}

export function buildRunnerReasonerPlanMetadata(reasonerPlan = null) {
  return {
    requestedProvider: reasonerPlan?.requestedProvider ?? null,
    effectiveProvider: reasonerPlan?.effectiveProvider ?? null,
    downgradedToLocal: Boolean(reasonerPlan?.downgradedToLocal),
    localMode: reasonerPlan?.localMode ?? null,
    onlineAllowed: Boolean(reasonerPlan?.onlineAllowed),
    skippedLocalReasonerProvider: reasonerPlan?.skippedLocalReasoner?.provider ?? null,
    skippedLocalReasonerReason: reasonerPlan?.skippedLocalReasoner?.reason ?? null,
    skippedLocalReasonerFailedAt: reasonerPlan?.skippedLocalReasoner?.failedAt ?? null,
    qualityEscalationProvider: reasonerPlan?.qualityEscalationProvider ?? null,
  };
}

function resolveRunnerLocalReasonerHealthGate(localReasoner = null, provider = null) {
  const normalizedProvider = normalizeRuntimeReasonerProvider(provider) ?? null;
  if (!isRunnerHealthGatedLocalReasonerProvider(normalizedProvider)) {
    return {
      skip: false,
      provider: normalizedProvider,
      reason: null,
      failedAt: null,
      source: null,
      lastHealthyAt: null,
    };
  }

  const normalized = normalizeRuntimeLocalReasonerConfig(localReasoner || {});
  if (!normalized.enabled || !isRuntimeLocalReasonerConfigured(normalized)) {
    return {
      skip: false,
      provider: normalizedProvider,
      reason: null,
      failedAt: null,
      source: null,
      lastHealthyAt: null,
    };
  }

  const lastProbe =
    normalizeRuntimeReasonerProvider(normalized.lastProbe?.provider) === normalizedProvider
      ? normalized.lastProbe
      : null;
  const lastWarm =
    normalizeRuntimeReasonerProvider(normalized.lastWarm?.provider) === normalizedProvider
      ? normalized.lastWarm
      : null;
  const lastHealthyAt =
    (lastWarm?.status === "ready" ? normalizeOptionalText(lastWarm.warmedAt) : null) ??
    (lastProbe?.reachable ? normalizeOptionalText(lastProbe.checkedAt) : null) ??
    null;
  const lastHealthyMs = parseRunnerReasonerTimestampMs(lastHealthyAt);
  const failureCandidates = [];

  if (lastWarm?.status && lastWarm.status !== "ready") {
    const warmedAt = normalizeOptionalText(lastWarm.warmedAt) ?? null;
    const warmedAtMs = parseRunnerReasonerTimestampMs(warmedAt);
    if (warmedAtMs != null) {
      failureCandidates.push({
        provider: normalizedProvider,
        reason: normalizeOptionalText(lastWarm.error) ?? lastWarm.status,
        failedAt: warmedAt,
        failedAtMs: warmedAtMs,
        source: "warm",
        lastHealthyAt,
      });
    }
  }

  if (lastProbe?.status && !lastProbe.reachable) {
    const checkedAt = normalizeOptionalText(lastProbe.checkedAt) ?? null;
    const checkedAtMs = parseRunnerReasonerTimestampMs(checkedAt);
    if (checkedAtMs != null) {
      failureCandidates.push({
        provider: normalizedProvider,
        reason: normalizeOptionalText(lastProbe.error) ?? lastProbe.status,
        failedAt: checkedAt,
        failedAtMs: checkedAtMs,
        source: "probe",
        lastHealthyAt,
      });
    }
  }

  const latestFailure = failureCandidates.sort((left, right) => right.failedAtMs - left.failedAtMs)[0] ?? null;
  if (!latestFailure) {
    return {
      skip: false,
      provider: normalizedProvider,
      reason: null,
      failedAt: null,
      source: null,
      lastHealthyAt,
    };
  }

  const freshnessBoundary = Date.now() - DEFAULT_RUNNER_LOCAL_REASONER_FAILURE_FRESHNESS_MS;
  if (latestFailure.failedAtMs < freshnessBoundary) {
    return {
      skip: false,
      provider: normalizedProvider,
      reason: latestFailure.reason,
      failedAt: latestFailure.failedAt,
      source: latestFailure.source,
      lastHealthyAt,
    };
  }

  if (lastHealthyMs != null && lastHealthyMs >= latestFailure.failedAtMs) {
    return {
      skip: false,
      provider: normalizedProvider,
      reason: latestFailure.reason,
      failedAt: latestFailure.failedAt,
      source: latestFailure.source,
      lastHealthyAt,
    };
  }

  return {
    skip: true,
    provider: normalizedProvider,
    reason: latestFailure.reason,
    failedAt: latestFailure.failedAt,
    source: latestFailure.source,
    lastHealthyAt,
  };
}

function resolveRunnerFallbackProvider(
  effectiveProvider,
  { localReasonerReady = false, localReasonerProvider = null, blockedProviders = null } = {}
) {
  const blocked = blockedProviders instanceof Set ? blockedProviders : new Set();
  const normalizedEffectiveProvider = normalizeRuntimeReasonerProvider(effectiveProvider) ?? null;
  const normalizedLocalReasonerProvider = normalizeRuntimeReasonerProvider(localReasonerProvider) ?? null;
  let fallbackProvider = null;

  if (
    ["http", "openai_compatible"].includes(normalizedEffectiveProvider || "") &&
    localReasonerReady &&
    normalizedLocalReasonerProvider &&
    !blocked.has(normalizedLocalReasonerProvider)
  ) {
    fallbackProvider = normalizedLocalReasonerProvider;
  } else if (normalizedEffectiveProvider && normalizedEffectiveProvider !== "local_mock") {
    fallbackProvider = "local_mock";
  } else if (!normalizedEffectiveProvider && localReasonerReady) {
    fallbackProvider = "local_mock";
  }

  if (fallbackProvider && blocked.has(fallbackProvider)) {
    fallbackProvider = fallbackProvider === "local_mock" ? null : "local_mock";
  }
  if (fallbackProvider === normalizedEffectiveProvider) {
    fallbackProvider = normalizedEffectiveProvider === "local_mock" ? null : "local_mock";
  }
  return fallbackProvider;
}

export function resolveRunnerReasonerPlan(payload = {}, deviceRuntime = null) {
  const runtime = normalizeDeviceRuntime(deviceRuntime);
  const localReasoner = normalizeRuntimeLocalReasonerConfig(runtime.localReasoner);
  const localReasonerReady = isRuntimeLocalReasonerConfigured(localReasoner);
  const localReasonerProvider = localReasoner.provider || DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER;
  const manualCandidate =
    normalizeOptionalText(payload.candidateResponse || payload.responseText || payload.assistantResponse) ?? null;
  const requestedProvider =
    normalizeRuntimeReasonerProvider(payload.reasonerProvider) ??
    normalizeRuntimeReasonerProvider(payload.reasoner?.provider) ??
    null;
  const onlineAllowed = runtime.localMode === "online_enhanced" && (
    runtime.allowOnlineReasoner ||
    normalizeBooleanFlag(payload.allowOnlineReasoner, false)
  );
  let effectiveProvider = requestedProvider;
  let downgradedToLocal = false;
  let fallbackProvider = null;
  const forceLocalReasonerAttempt = hasExplicitRunnerLocalReasonerOverride(payload);

  if (!effectiveProvider && !manualCandidate) {
    effectiveProvider = localReasonerReady ? localReasoner.provider || DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER : "local_mock";
  }

  if (runtime.localMode === "local_only" && ["http", "openai_compatible"].includes(effectiveProvider || "")) {
    effectiveProvider = manualCandidate ? null : localReasonerReady ? localReasoner.provider || DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER : "local_mock";
    downgradedToLocal = true;
  }

  if (!onlineAllowed && runtime.localMode === "local_only" && !effectiveProvider && !manualCandidate) {
    effectiveProvider = localReasonerReady ? localReasoner.provider || DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER : "local_mock";
  }

  const blockedProviders = new Set();
  let skippedLocalReasoner = null;

  if (!manualCandidate && !forceLocalReasonerAttempt) {
    const effectiveHealth = resolveRunnerLocalReasonerHealthGate(
      resolveRunnerLocalReasonerConfig(null, deviceRuntime, effectiveProvider),
      effectiveProvider
    );
    if (effectiveHealth.skip) {
      blockedProviders.add(effectiveHealth.provider);
      skippedLocalReasoner = effectiveHealth;
      effectiveProvider = resolveRunnerFallbackProvider(effectiveProvider, {
        localReasonerReady,
        localReasonerProvider,
        blockedProviders,
      });
    }
  }

  fallbackProvider = resolveRunnerFallbackProvider(effectiveProvider, {
    localReasonerReady,
    localReasonerProvider,
    blockedProviders,
  });

  if (!manualCandidate && !forceLocalReasonerAttempt) {
    const fallbackHealth = resolveRunnerLocalReasonerHealthGate(
      resolveRunnerLocalReasonerConfig(null, deviceRuntime, fallbackProvider),
      fallbackProvider
    );
    if (fallbackHealth.skip) {
      blockedProviders.add(fallbackHealth.provider);
      skippedLocalReasoner = skippedLocalReasoner ?? fallbackHealth;
      fallbackProvider = resolveRunnerFallbackProvider(effectiveProvider, {
        localReasonerReady,
        localReasonerProvider,
        blockedProviders,
      });
    }
  }
  const qualityEscalationProvider = manualCandidate
    ? null
    : resolveRunnerQualityEscalationProvider(payload, {
        requestedProvider,
        onlineAllowed,
      });

  return {
    requestedProvider,
    effectiveProvider,
    onlineAllowed,
    downgradedToLocal,
    localMode: runtime.localMode,
    localReasonerReady,
    fallbackProvider,
    skippedLocalReasoner,
    forceLocalReasonerAttempt,
    qualityEscalationProvider,
  };
}

export function resolveRunnerLocalReasonerConfig(store, deviceRuntime = null, requestedProvider = null) {
  const runtime = normalizeDeviceRuntime(deviceRuntime);
  const currentConfig = normalizeRuntimeLocalReasonerConfig(runtime.localReasoner);
  const normalizedRequestedProvider = normalizeRuntimeReasonerProvider(requestedProvider) ?? null;

  if (!normalizedRequestedProvider || normalizedRequestedProvider === currentConfig.provider) {
    return currentConfig;
  }

  const profiles = Array.isArray(store?.localReasonerProfiles) ? store.localReasonerProfiles : [];
  const matchingProfile = [...profiles]
    .filter((entry) => {
      const entryProvider =
        normalizeRuntimeReasonerProvider(entry?.provider) ??
        normalizeRuntimeReasonerProvider(entry?.config?.provider) ??
        null;
      return entryProvider === normalizedRequestedProvider;
    })
    .sort((left, right) =>
      String(right?.lastActivatedAt || right?.lastHealthyAt || right?.updatedAt || "").localeCompare(
        String(left?.lastActivatedAt || left?.lastHealthyAt || left?.updatedAt || "")
      )
    )[0];

  if (!matchingProfile?.config || typeof matchingProfile.config !== "object") {
    return normalizeRuntimeLocalReasonerConfig({
      ...currentConfig,
      provider: normalizedRequestedProvider,
    });
  }

  return normalizeRuntimeLocalReasonerConfig({
    ...currentConfig,
    ...cloneJson(matchingProfile.config),
    provider: normalizedRequestedProvider,
    selection:
      currentConfig.selection && currentConfig.selection.provider === normalizedRequestedProvider
        ? currentConfig.selection
        : matchingProfile.selection ?? currentConfig.selection ?? null,
    lastProbe:
      normalizeRuntimeReasonerProvider(currentConfig.lastProbe?.provider) === normalizedRequestedProvider
        ? currentConfig.lastProbe
        : matchingProfile.lastProbe ?? currentConfig.lastProbe ?? null,
    lastWarm:
      normalizeRuntimeReasonerProvider(currentConfig.lastWarm?.provider) === normalizedRequestedProvider
        ? currentConfig.lastWarm
        : matchingProfile.lastWarm ?? currentConfig.lastWarm ?? null,
  });
}

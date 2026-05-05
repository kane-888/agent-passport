import { normalizeOptionalText } from "./server-base-helpers.js";

function clampPublicRiskScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(1, numeric));
}

function toPublicCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.floor(numeric));
}

function toPublicTextList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => normalizeOptionalText(value))
    .filter(Boolean);
}

export function buildPublicAgentRuntimeTruth(summary = null) {
  if (!summary || typeof summary !== "object") {
    return null;
  }
  const latestRun = summary.runner?.latest || null;
  const memoryHomeostasis =
    summary.memoryHomeostasis && typeof summary.memoryHomeostasis === "object"
      ? summary.memoryHomeostasis
      : null;
  const latestState = memoryHomeostasis?.latestState || null;
  const latestObservation = memoryHomeostasis?.observationSummary?.latestObservation || null;
  const observationEffectiveness = memoryHomeostasis?.observationSummary?.effectiveness || null;
  return {
    localFirst: summary.hybridRuntime?.localFirst === true,
    policy: normalizeOptionalText(summary.hybridRuntime?.fallback?.policy) ?? null,
    onlineAllowed:
      typeof summary.hybridRuntime?.fallback?.onlineAllowed === "boolean"
        ? summary.hybridRuntime.fallback.onlineAllowed
        : null,
    memoryStabilityIntegrationStatus: memoryHomeostasis
      ? "merged_into_agent_passport_runtime"
      : "not_reported",
    memoryStabilityEngineOwner: "memory_stability_engine",
    memoryStabilityRuntimeHost: "agent_passport",
    openneedRuntimeBoundary: "app_bridge_compat_only",
    latestRunStatus: normalizeOptionalText(latestRun?.status) ?? null,
    qualityEscalationRuns: toPublicCount(summary.runner?.qualityEscalationRuns),
    latestFallbackActivated: latestRun?.fallbackActivated === true,
    latestFallbackCause: normalizeOptionalText(latestRun?.fallbackCause) ?? null,
    latestDegradedLocalFallback: latestRun?.degradedLocalFallback === true,
    latestDegradedLocalFallbackReason:
      normalizeOptionalText(latestRun?.degradedLocalFallbackReason) ?? null,
    latestRunnerGuardActivated: latestRun?.runnerGuardActivated === true,
    latestRunnerGuardBlockedBy: normalizeOptionalText(latestRun?.runnerGuardBlockedBy) ?? null,
    latestRunnerGuardCode: normalizeOptionalText(latestRun?.runnerGuardCode) ?? null,
    latestRunnerGuardStage: normalizeOptionalText(latestRun?.runnerGuardStage) ?? null,
    latestRunnerGuardReceiptStatus: normalizeOptionalText(latestRun?.runnerGuardReceiptStatus) ?? null,
    latestRunnerGuardExplicitRequestKinds: toPublicTextList(latestRun?.runnerGuardExplicitRequestKinds),
    latestQualityEscalationActivated: latestRun?.qualityEscalationActivated === true,
    latestQualityEscalationProvider: normalizeOptionalText(latestRun?.qualityEscalationProvider) ?? null,
    latestQualityEscalationReason: normalizeOptionalText(latestRun?.qualityEscalationReason) ?? null,
    latestQualityEscalationIssueCodes: Array.isArray(latestRun?.qualityEscalationIssueCodes)
      ? latestRun.qualityEscalationIssueCodes.filter(Boolean)
      : [],
    latestMemoryStabilityCorrectionLevel:
      normalizeOptionalText(
        latestRun?.memoryStabilityCorrectionLevel ||
          latestObservation?.correctionLevel ||
          latestState?.correctionLevel
      ) ?? null,
    latestMemoryStabilityRiskScore: clampPublicRiskScore(
      latestRun?.memoryStabilityRiskScore ?? latestObservation?.cT ?? latestState?.cT
    ),
    latestMemoryStabilitySignalSource: normalizeOptionalText(latestRun?.memoryStabilitySignalSource) ?? null,
    latestMemoryStabilityPreflightStatus:
      normalizeOptionalText(latestRun?.memoryStabilityPreflightStatus) ?? null,
    latestMemoryStabilityStateId:
      normalizeOptionalText(latestObservation?.runtimeMemoryStateId || latestState?.runtimeMemoryStateId) ?? null,
    latestMemoryStabilityUpdatedAt:
      normalizeOptionalText(latestObservation?.observedAt || latestState?.updatedAt) ?? null,
    latestMemoryStabilityRiskTrend: normalizeOptionalText(latestObservation?.riskTrend) ?? null,
    latestMemoryStabilityRecoverySignal: normalizeOptionalText(latestObservation?.recoverySignal) ?? null,
    latestMemoryStabilityObservationKind: normalizeOptionalText(latestObservation?.observationKind) ?? null,
    latestMemoryStabilityCorrectionActions: toPublicTextList(latestObservation?.correctionActions),
    memoryStabilityRecoveryRate: clampPublicRiskScore(observationEffectiveness?.recoveryRate),
    memoryStabilityStateCount: toPublicCount(memoryHomeostasis?.stateCount ?? 0),
  };
}

export function buildUnavailablePublicAgentRuntimeTruth({ setup = null } = {}) {
  const deviceRuntime = setup?.deviceRuntime && typeof setup.deviceRuntime === "object" ? setup.deviceRuntime : null;
  return buildPublicAgentRuntimeTruth({
    hybridRuntime: {
      localFirst: deviceRuntime?.localReasonerEnabled === true,
      fallback: {
        policy: "runtime_summary_unavailable",
        onlineAllowed: deviceRuntime?.allowOnlineReasoner === true,
      },
    },
    runner: {
      qualityEscalationRuns: 0,
      latest: {
        fallbackActivated: false,
        degradedLocalFallback: false,
        runnerGuardActivated: false,
        qualityEscalationActivated: false,
      },
    },
    memoryHomeostasis: {
      stateCount: 0,
    },
  });
}

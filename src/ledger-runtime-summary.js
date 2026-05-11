import {
  cloneJson,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  displayAgentPassportLocalReasonerModel,
  isAgentPassportLocalReasonerModel,
} from "./memory-engine-branding.js";
import {
  DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
  normalizeRuntimeReasonerProvider,
} from "./ledger-device-runtime.js";
import {
  normalizeAgentRunStatus,
} from "./ledger-agent-run.js";
import {
  clampMemoryHomeostasisMetric,
  normalizeRuntimeMemoryObservationCorrectionLevel,
} from "./ledger-runtime-memory-observations.js";
import {
  buildDefaultDeviceLocalReasonerTargetConfig,
  localReasonerNeedsDefaultMigration,
} from "./ledger-local-reasoner-defaults.js";
import {
  canonicalizeHybridRuntimeReasonerSelectionFlags,
} from "./hybrid-runtime-selection.js";

export function buildAgentRunGovernanceSummary(runs = []) {
  const runList = Array.isArray(runs) ? runs : [];
  const statusCounts = {};
  const providerCounts = {};
  let localProviderRuns = 0;
  let onlineProviderRuns = 0;
  let fallbackRuns = 0;
  let qualityEscalationRuns = 0;
  let degradedRuns = 0;

  for (const run of runList) {
    const status = normalizeAgentRunStatus(run?.status);
    const provider = normalizeRuntimeReasonerProvider(run?.reasoner?.provider) ?? "none";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    providerCounts[provider] = (providerCounts[provider] || 0) + 1;

    if (["ollama_local", "local_command"].includes(provider)) {
      localProviderRuns += 1;
    }
    if (["http", "openai_compatible"].includes(provider)) {
      onlineProviderRuns += 1;
    }
    if (["local_mock", "mock"].includes(provider)) {
      fallbackRuns += 1;
    }
    if (run?.reasoner?.metadata?.qualityEscalationActivated === true) {
      qualityEscalationRuns += 1;
    }
    if (["blocked", "needs_human_review", "rehydrate_required"].includes(status)) {
      degradedRuns += 1;
    }
  }

  return {
    totalRuns: runList.length,
    localProviderRuns,
    onlineProviderRuns,
    fallbackRuns,
    qualityEscalationRuns,
    degradedRuns,
    statusCounts,
    providerCounts,
    recentRuns: runList.slice(-6).reverse().map((run) => ({
      runId: run?.runId ?? null,
      status: normalizeAgentRunStatus(run?.status),
      currentGoal: normalizeOptionalText(run?.currentGoal) ?? null,
      reasonerProvider: normalizeRuntimeReasonerProvider(run?.reasoner?.provider) ?? null,
      reasonerModel: displayAgentPassportLocalReasonerModel(normalizeOptionalText(run?.reasoner?.model) ?? null, null),
      reasonerError: normalizeOptionalText(run?.reasoner?.error) ?? null,
      effectiveProvider: normalizeRuntimeReasonerProvider(run?.reasoner?.metadata?.effectiveProvider) ?? null,
      fallbackProvider: normalizeRuntimeReasonerProvider(run?.reasoner?.metadata?.fallbackProvider) ?? null,
      fallbackActivated: Boolean(run?.reasoner?.metadata?.fallbackActivated),
      fallbackCause: normalizeOptionalText(run?.reasoner?.metadata?.fallbackCause) ?? null,
      degradedLocalFallback: Boolean(run?.reasoner?.metadata?.degradedLocalFallback),
      degradedLocalFallbackReason:
        normalizeOptionalText(run?.reasoner?.metadata?.degradedLocalFallbackReason) ?? null,
      qualityEscalationActivated: Boolean(run?.reasoner?.metadata?.qualityEscalationActivated),
      qualityEscalationProvider: normalizeRuntimeReasonerProvider(run?.reasoner?.metadata?.qualityEscalationProvider) ?? null,
      qualityEscalationReason: normalizeOptionalText(run?.reasoner?.metadata?.qualityEscalationReason) ?? null,
      qualityEscalationIssueCodes: normalizeTextList(run?.reasoner?.metadata?.qualityEscalationIssueCodes ?? []),
      memoryStabilityCorrectionLevel:
        normalizeRuntimeMemoryObservationCorrectionLevel(run?.reasoner?.metadata?.memoryStabilityCorrectionLevel),
      memoryStabilityRiskScore: Number.isFinite(toFiniteNumber(run?.reasoner?.metadata?.memoryStabilityRiskScore, NaN))
        ? clampMemoryHomeostasisMetric(run?.reasoner?.metadata?.memoryStabilityRiskScore, 0, 1)
        : null,
      memoryStabilitySignalSource: normalizeOptionalText(run?.reasoner?.metadata?.memoryStabilitySignalSource) ?? null,
      memoryStabilityPreflightStatus:
        normalizeOptionalText(run?.reasoner?.metadata?.memoryStabilityPreflightStatus) ?? null,
      runnerGuardActivated: Boolean(run?.runnerGuard?.failClosed),
      runnerGuardBlockedBy: normalizeOptionalText(run?.runnerGuard?.blockedBy) ?? null,
      runnerGuardCode: normalizeOptionalText(run?.runnerGuard?.code) ?? null,
      runnerGuardStage: normalizeOptionalText(run?.runnerGuard?.stage) ?? null,
      runnerGuardReceiptStatus: normalizeOptionalText(run?.runnerGuard?.receiptStatus) ?? null,
      runnerGuardExplicitRequestKinds: normalizeTextList(run?.runnerGuard?.explicitRequestKinds ?? []),
      initialError: normalizeOptionalText(run?.reasoner?.metadata?.initialError) ?? null,
      verificationValid: run?.verification?.valid ?? null,
      requiresRehydrate: Boolean(run?.driftCheck?.requiresRehydrate),
      requiresHumanReview: Boolean(run?.driftCheck?.requiresHumanReview),
      recordedAt: normalizeOptionalText(run?.recordedAt || run?.createdAt) ?? null,
    })),
  };
}

export function buildHybridRuntimeSummary(runtime = null, governance = null) {
  const localReasoner = runtime?.deviceRuntime?.localReasoner || {};
  const lastProbe = localReasoner?.lastProbe || null;
  const lastWarm = localReasoner?.lastWarm || null;
  const preferredProvider = normalizeRuntimeReasonerProvider(localReasoner?.provider) ?? null;
  const preferredModel = displayAgentPassportLocalReasonerModel(normalizeOptionalText(localReasoner?.model) ?? null, null);
  const defaultTarget = buildDefaultDeviceLocalReasonerTargetConfig(localReasoner);
  const defaultPreferredProvider = defaultTarget.provider ?? DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER;
  const defaultPreferredModel = displayAgentPassportLocalReasonerModel(
    defaultTarget.model ?? DEFAULT_DEVICE_LOCAL_REASONER_MODEL
  );
  const defaultPreferredTimeoutMs = Math.max(
    500,
    Math.floor(toFiniteNumber(defaultTarget.timeoutMs, DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS))
  );
  const reachable =
    lastWarm?.status === "ready"
      ? true
      : lastProbe?.reachable != null
        ? Boolean(lastProbe.reachable)
        : null;
  const selectionNeedsMigration = localReasonerNeedsDefaultMigration(localReasoner, defaultTarget);
  const latestRun = Array.isArray(governance?.recentRuns) ? governance.recentRuns[0] ?? null : null;
  const latestRunProvider = normalizeRuntimeReasonerProvider(latestRun?.reasonerProvider) ?? null;
  const latestRunModel = displayAgentPassportLocalReasonerModel(normalizeOptionalText(latestRun?.reasonerModel) ?? null, null);
  const latestFallbackActivated = latestRun?.fallbackActivated === true;
  const latestRunUsedAgentPassportLocalReasoner =
    latestRunProvider === "ollama_local" &&
    isAgentPassportLocalReasonerModel(latestRunModel) &&
    !latestFallbackActivated;
  const agentPassportLocalReasonerPreferred =
    preferredProvider === "ollama_local" && isAgentPassportLocalReasonerModel(preferredModel);

  return {
    mode: "local_first",
    localFirst: true,
    preferredProvider,
    preferredModel,
    defaultPreferredProvider,
    defaultPreferredModel,
    defaultPreferredTimeoutMs,
    memoryStabilityLocalReasonerPreferred: agentPassportLocalReasonerPreferred,
    localReasonerPreferred: agentPassportLocalReasonerPreferred,
    selectionNeedsMigration,
    selectionStatus: selectionNeedsMigration ? "legacy_local_reasoner_override" : "aligned_with_default_local_reasoner",
    latestRunProvider,
    latestRunModel,
    latestRunStatus: latestRun?.status ?? null,
    latestRunRecordedAt: latestRun?.recordedAt ?? null,
    latestFallbackActivated,
    latestRunUsedMemoryStabilityReasoner: latestRunUsedAgentPassportLocalReasoner,
    latestRunUsedLocalReasoner: latestRunUsedAgentPassportLocalReasoner,
    latestRunInitialError: latestRun?.initialError ?? null,
    localReasoner: {
      provider: preferredProvider,
      model: preferredModel,
      configured: Boolean(localReasoner?.configured),
      enabled: localReasoner?.enabled != null ? Boolean(localReasoner.enabled) : true,
      timeoutMs: Math.max(500, Math.floor(toFiniteNumber(localReasoner?.timeoutMs, 0))),
      reachable,
      lastProbeStatus: normalizeOptionalText(lastProbe?.status) ?? null,
      lastWarmStatus: normalizeOptionalText(lastWarm?.status) ?? null,
    },
    fallback: {
      provider: "local_mock",
      recentFallbackRuns: Number(governance?.fallbackRuns || 0),
      recentQualityEscalationRuns: Number(governance?.qualityEscalationRuns || 0),
      degradedRuns: Number(governance?.degradedRuns || 0),
      onlineAllowed: Boolean(runtime?.deviceRuntime?.allowOnlineReasoner),
      policy:
        runtime?.deviceRuntime?.allowOnlineReasoner
          ? "记忆稳态引擎本地推理优先，本地答案未通过校验时再联网增强；本地 provider 不可用时退回本地 fallback。"
          : "记忆稳态引擎本地推理优先，离线失败时退回本地 fallback。",
    },
    governance,
  };
}

export function buildRuntimeCognitionSummary(state = null) {
  if (!state || typeof state !== "object") {
    return null;
  }

  return {
    mode: state.mode ?? null,
    dominantStage: state.dominantStage ?? null,
    continuityScore: state.continuityScore ?? null,
    calibrationScore: state.calibrationScore ?? null,
    recoveryReadinessScore: state.recoveryReadinessScore ?? null,
    dynamics: {
      fatigue: state.fatigue ?? null,
      sleepDebt: state.sleepDebt ?? null,
      uncertainty: state.uncertainty ?? null,
      rewardPredictionError: state.rewardPredictionError ?? null,
      threat: state.threat ?? null,
      novelty: state.novelty ?? null,
      socialSalience: state.socialSalience ?? null,
      homeostaticPressure: state.homeostaticPressure ?? null,
      sleepPressure: state.sleepPressure ?? null,
      dominantRhythm: state.dominantRhythm ?? null,
      bodyLoop: cloneJson(state.bodyLoop) ?? null,
      interoceptiveState: cloneJson(state.interoceptiveState) ?? null,
      neuromodulators: cloneJson(state.neuromodulators) ?? null,
      oscillationSchedule: cloneJson(state.oscillationSchedule) ?? null,
      replayOrchestration: cloneJson(state.replayOrchestration) ?? null,
      updatedAt: normalizeOptionalText(state.updatedAt) ?? null,
    },
  };
}

export function buildBridgeRuntimeSummary(summary = {}) {
  const hybridRuntimeSelection = canonicalizeHybridRuntimeReasonerSelectionFlags(summary.hybridRuntime);
  return {
    generatedAt: summary.generatedAt ?? now(),
    performanceMode: "summary_bridge",
    agent: cloneJson(summary.agent) ?? null,
    task: cloneJson(summary.task) ?? null,
    residentGate: cloneJson(summary.residentGate) ?? null,
    hybridRuntime: summary.hybridRuntime
      ? {
          mode: summary.hybridRuntime.mode ?? "local_first",
          localFirst: Boolean(summary.hybridRuntime.localFirst),
          preferredProvider: summary.hybridRuntime.preferredProvider ?? null,
          preferredModel: summary.hybridRuntime.preferredModel ?? null,
          defaultPreferredProvider: summary.hybridRuntime.defaultPreferredProvider ?? null,
          defaultPreferredModel: summary.hybridRuntime.defaultPreferredModel ?? null,
          defaultPreferredTimeoutMs: summary.hybridRuntime.defaultPreferredTimeoutMs ?? null,
          memoryStabilityLocalReasonerPreferred:
            hybridRuntimeSelection.memoryStabilityLocalReasonerPreferred,
          localReasonerPreferred: hybridRuntimeSelection.localReasonerPreferred,
          selectionNeedsMigration: Boolean(summary.hybridRuntime.selectionNeedsMigration),
          selectionStatus: summary.hybridRuntime.selectionStatus ?? null,
          latestRunProvider: summary.hybridRuntime.latestRunProvider ?? null,
          latestRunModel: summary.hybridRuntime.latestRunModel ?? null,
          latestRunStatus: summary.hybridRuntime.latestRunStatus ?? null,
          latestRunRecordedAt: summary.hybridRuntime.latestRunRecordedAt ?? null,
          latestFallbackActivated: Boolean(summary.hybridRuntime.latestFallbackActivated),
          latestRunUsedMemoryStabilityReasoner:
            hybridRuntimeSelection.latestRunUsedMemoryStabilityReasoner,
          latestRunUsedLocalReasoner: hybridRuntimeSelection.latestRunUsedLocalReasoner,
          latestRunInitialError: summary.hybridRuntime.latestRunInitialError ?? null,
          fallback: cloneJson(summary.hybridRuntime.fallback) ?? null,
          localReasoner: cloneJson(summary.hybridRuntime.localReasoner) ?? null,
        }
      : null,
    governance: summary.governance
      ? {
          totalRuns: Number(summary.governance.totalRuns || 0),
          fallbackRuns: Number(summary.governance.fallbackRuns || 0),
          degradedRuns: Number(summary.governance.degradedRuns || 0),
          localProviderRuns: Number(summary.governance.localProviderRuns || 0),
          onlineProviderRuns: Number(summary.governance.onlineProviderRuns || 0),
        }
      : null,
    cognition: summary.cognition
      ? {
          mode: summary.cognition.mode ?? null,
          dominantStage: summary.cognition.dominantStage ?? null,
          continuityScore: summary.cognition.continuityScore ?? null,
          calibrationScore: summary.cognition.calibrationScore ?? null,
          recoveryReadinessScore: summary.cognition.recoveryReadinessScore ?? null,
          dynamics: cloneJson(summary.cognition.dynamics) ?? null,
        }
      : null,
    memory: summary.memory
      ? {
          totalPassportMemories: Number(summary.memory.totalPassportMemories || 0),
          activePassportMemories: Number(summary.memory.activePassportMemories || 0),
          archivedPassportMemories: Number(summary.memory.archivedPassportMemories || 0),
          physicalArchive: cloneJson(summary.memory.physicalArchive) ?? null,
        }
      : null,
    transcript: summary.transcript
      ? {
          entryCount: Number(summary.transcript.entryCount || 0),
          latestTranscriptEntryId: summary.transcript.latestTranscriptEntryId ?? null,
          physicalArchive: cloneJson(summary.transcript.physicalArchive) ?? null,
        }
      : null,
    runner: summary.runner
      ? {
          totalRuns: Number(summary.runner.totalRuns || 0),
          fallbackRuns: Number(summary.runner.fallbackRuns || 0),
          degradedRuns: Number(summary.runner.degradedRuns || 0),
          localProviderRuns: Number(summary.runner.localProviderRuns || 0),
          onlineProviderRuns: Number(summary.runner.onlineProviderRuns || 0),
          latest: cloneJson(summary.runner.latest) ?? null,
        }
      : null,
    memoryHomeostasis: summary.memoryHomeostasis
      ? {
          modelProfile: cloneJson(summary.memoryHomeostasis.modelProfile) ?? null,
          latestState: cloneJson(summary.memoryHomeostasis.latestState) ?? null,
          stateCount: Number(summary.memoryHomeostasis.stateCount || 0),
          observationSummary: cloneJson(summary.memoryHomeostasis.observationSummary) ?? null,
        }
      : null,
  };
}

import {
  cloneJson,
  createRecordId,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import { displayAgentPassportLocalReasonerModel } from "./memory-engine-branding.js";
import { normalizeRuntimeMemoryStateRecord } from "./memory-homeostasis.js";
import { getMemoryStabilityCorrectionActions } from "./memory-stability/action-vocabulary.js";

export function clampMemoryHomeostasisMetric(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, toFiniteNumber(value, minimum)));
}

export function roundMemoryHomeostasisMetric(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(toFiniteNumber(value, 0) * factor) / factor;
}

const MEMORY_HOMEOSTASIS_OBSERVATION_LIMIT = 256;

export function normalizeRuntimeMemoryObservationKind(value = null) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (["active_probe", "probe", "runtime_active_probe"].includes(normalized)) {
    return "active_probe";
  }
  if (["correction_rebuild", "correction", "rebuild"].includes(normalized)) {
    return "correction_rebuild";
  }
  if (["runner_passive_monitor", "runner_passive", "runner"].includes(normalized)) {
    return "runner_passive_monitor";
  }
  if (["manual_recompute", "recompute"].includes(normalized)) {
    return "manual_recompute";
  }
  return "passive_monitor";
}

export function normalizeRuntimeMemoryObservationTrend(value = null) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (["worsening", "risk_up"].includes(normalized)) {
    return "worsening";
  }
  if (["recovering", "risk_down"].includes(normalized)) {
    return "recovering";
  }
  if (["stable", "flat"].includes(normalized)) {
    return "stable";
  }
  return "baseline";
}

const RUNTIME_MEMORY_OBSERVATION_CORRECTION_SEVERITY = Object.freeze({
  none: 0,
  light: 1,
  medium: 2,
  strong: 3,
});

export function normalizeRuntimeMemoryObservationCorrectionLevel(value = null) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (["strong", "severe", "critical", "level_3", "level3", "3"].includes(normalized)) {
    return "strong";
  }
  if (["medium", "moderate", "level_2", "level2", "2"].includes(normalized)) {
    return "medium";
  }
  if (["light", "minor", "level_1", "level1", "1"].includes(normalized)) {
    return "light";
  }
  return "none";
}

export function getRuntimeMemoryObservationCorrectionSeverity(value = null) {
  return RUNTIME_MEMORY_OBSERVATION_CORRECTION_SEVERITY[
    normalizeRuntimeMemoryObservationCorrectionLevel(value)
  ] ?? 0;
}

export function resolveRuntimeMemoryObservationCorrectionActions(
  actions = null,
  correctionLevel = null
) {
  const normalizedActions = normalizeTextList(actions || []);
  if (normalizedActions.length > 0) {
    return normalizedActions;
  }
  const normalizedCorrectionLevel = normalizeRuntimeMemoryObservationCorrectionLevel(correctionLevel);
  if (normalizedCorrectionLevel === "none") {
    return [];
  }
  return getMemoryStabilityCorrectionActions(normalizedCorrectionLevel);
}

function buildRuntimeMemoryObservationCorrectionSummary(
  runtimeMemoryState,
  {
    correctionPlan = null,
    requestedCorrectionPlan = null,
    appliedCorrectionPlan = null,
    requestedCorrectionLevel = null,
    plannedCorrectionLevel = null,
    appliedCorrectionLevel = null,
    correctionActions = null,
    correctionRequested = false,
    correctionApplied = false,
  } = {}
) {
  const state = runtimeMemoryState ? normalizeRuntimeMemoryStateRecord(runtimeMemoryState) : null;
  const resolvedRequestedCorrectionLevel = normalizeRuntimeMemoryObservationCorrectionLevel(
    requestedCorrectionLevel ?? requestedCorrectionPlan?.correctionLevel
  );
  const resolvedPlannedCorrectionLevel = normalizeRuntimeMemoryObservationCorrectionLevel(
    plannedCorrectionLevel ?? correctionPlan?.correctionLevel ?? state?.correctionLevel
  );
  const resolvedAppliedCorrectionLevel = normalizeRuntimeMemoryObservationCorrectionLevel(
    appliedCorrectionLevel ??
      appliedCorrectionPlan?.correctionLevel ??
      (correctionApplied ? resolvedPlannedCorrectionLevel : null)
  );
  const effectiveCorrectionLevel = correctionApplied
    ? resolvedAppliedCorrectionLevel
    : resolvedPlannedCorrectionLevel;
  return {
    requestedCorrectionLevel: resolvedRequestedCorrectionLevel,
    plannedCorrectionLevel: resolvedPlannedCorrectionLevel,
    appliedCorrectionLevel: resolvedAppliedCorrectionLevel,
    effectiveCorrectionLevel,
    correctionActions: resolveRuntimeMemoryObservationCorrectionActions(
      correctionActions ??
        appliedCorrectionPlan?.actions ??
        correctionPlan?.actions,
      effectiveCorrectionLevel
    ),
    correctionEscalated:
      getRuntimeMemoryObservationCorrectionSeverity(effectiveCorrectionLevel) >
      getRuntimeMemoryObservationCorrectionSeverity(resolvedRequestedCorrectionLevel),
    correctionRequested: Boolean(correctionRequested),
    correctionApplied: Boolean(correctionApplied),
  };
}

function inferRuntimeMemoryObservationRole(observation = null) {
  if (!observation || typeof observation !== "object") {
    return "organic_stable";
  }
  const instabilityReasons = normalizeTextList(observation.instabilityReasons || []);
  const correctionLevel = normalizeRuntimeMemoryObservationCorrectionLevel(observation.correctionLevel);
  const observationKind = normalizeRuntimeMemoryObservationKind(observation.observationKind);
  const recoverySignal = normalizeOptionalText(observation.recoverySignal) ?? null;
  const activeProbeError = normalizeOptionalText(observation.activeProbeError) ?? null;
  const probeFailureCount = Math.max(0, Math.floor(toFiniteNumber(observation.probeFailureCount, 0)));
  const probeCheckedCount = Math.max(0, Math.floor(toFiniteNumber(observation.probeCheckedCount, 0)));
  const cT = clampMemoryHomeostasisMetric(observation.cT, 0, 1);
  const vT = clampMemoryHomeostasisMetric(observation.vT, 0, 1);
  const xT = clampMemoryHomeostasisMetric(observation.xT, 0, 1);

  if (activeProbeError || instabilityReasons.includes("probe_runtime_error")) {
    return "probe_error_unstable";
  }
  if (probeFailureCount > 0 || instabilityReasons.includes("probe_recall_failure")) {
    return "probe_failed_unstable";
  }
  if (
    cT >= 0.28 ||
    ["medium", "strong"].includes(correctionLevel) ||
    xT >= 0.2 ||
    vT < 0.72 ||
    observation.riskTrend === "worsening"
  ) {
    return "risk_rising_unstable";
  }
  if (Boolean(observation.correctionApplied)) {
    if (["recovered_to_none", "risk_reduced"].includes(recoverySignal)) {
      return "recovered_under_correction";
    }
    return "corrected_stable";
  }
  if (instabilityReasons.includes("correction_escalated")) {
    return "correction_escalated_unstable";
  }
  if (instabilityReasons.includes("conflict_rising") || instabilityReasons.includes("memory_conflict")) {
    return "conflict_driven_unstable";
  }
  if (instabilityReasons.includes("retention_drop")) {
    return "retention_drop_unstable";
  }
  if (observationKind === "active_probe" && probeCheckedCount > 0) {
    return "probe_verified_stable";
  }
  if (observationKind === "manual_recompute") {
    return "manual_recompute_stable";
  }
  if (["recovered_to_none", "risk_reduced"].includes(recoverySignal)) {
    return "recovering_stable";
  }
  return "organic_stable";
}

export function computeRuntimeMemoryObservationCalibrationWeight(observation = null, { role = "stable" } = {}) {
  const normalized = normalizeRuntimeMemoryObservationRecord(observation);
  const observationRole = normalizeOptionalText(normalized.observationRole) ?? inferRuntimeMemoryObservationRole(normalized);
  const correctionSeverity = getRuntimeMemoryObservationCorrectionSeverity(normalized.correctionLevel);
  let weight = 0.85;

  if (role === "stable") {
    weight =
      observationRole === "probe_verified_stable"
        ? 1.08
        : observationRole === "organic_stable"
          ? 1
          : observationRole === "recovering_stable"
            ? 0.96
            : observationRole === "manual_recompute_stable"
              ? 0.92
              : observationRole === "corrected_stable"
                ? 0.78
                : observationRole === "recovered_under_correction"
                  ? 0.72
                  : normalized.observationKind === "correction_rebuild"
                    ? 0.82
                    : 0.88;
    if (normalized.recoverySignal === "recovered_to_none") {
      weight += normalized.correctionApplied ? 0.04 : 0.12;
    } else if (normalized.recoverySignal === "risk_reduced") {
      weight += normalized.correctionApplied ? 0.02 : 0.08;
    }
    if (normalized.correctionApplied) {
      weight -= 0.06 * Math.max(1, correctionSeverity);
    }
    if (normalized.instabilityReasons.includes("correction_escalated")) {
      weight -= 0.12;
    }
    if (normalized.probeCheckedCount > 0 && normalized.probeFailureCount === 0 && !normalized.correctionApplied) {
      weight += 0.12;
    }
    if (normalized.riskTrend === "recovering" && !normalized.correctionApplied) {
      weight += 0.06;
    }
  } else {
    weight =
      observationRole === "probe_error_unstable"
        ? 1.7
        : observationRole === "probe_failed_unstable"
          ? 1.58
          : observationRole === "correction_escalated_unstable"
            ? 1.42
            : observationRole === "conflict_driven_unstable"
              ? 1.34
              : observationRole === "retention_drop_unstable"
                ? 1.3
                : observationRole === "risk_rising_unstable"
                  ? 1.08
                  : normalized.observationKind === "active_probe"
                    ? 1.18
                    : normalized.observationKind === "correction_rebuild"
                      ? 1.02
                      : normalized.observationKind === "runner_passive_monitor"
                        ? 0.96
                        : 0.9;
    if (normalized.probeFailureCount > 0) {
      weight += 0.32;
    }
    if (normalized.conflictMemories > 0) {
      weight += 0.22;
    }
    if (normalized.instabilityReasons.includes("conflict_rising")) {
      weight += 0.2;
    }
    if (normalized.instabilityReasons.includes("retention_drop")) {
      weight += 0.2;
    }
    if (normalized.instabilityReasons.includes("correction_escalated")) {
      weight += 0.24;
    }
    if (normalized.instabilityReasons.includes("probe_runtime_error")) {
      weight += 0.28;
    }
    if (normalized.instabilityReasons.includes("probe_recall_failure")) {
      weight += 0.18;
    }
    if (normalized.correctionApplied) {
      weight += 0.08;
    }
    if (normalized.cT >= 0.5) {
      weight += 0.2;
    } else if (normalized.cT >= 0.35) {
      weight += 0.12;
    }
    if (normalized.riskTrend === "worsening") {
      weight += 0.1;
    }
  }

  return roundMemoryHomeostasisMetric(Math.max(0.2, weight), 3);
}

export function normalizeRuntimeMemoryObservationRecord(value = {}) {
  const state = normalizeRuntimeMemoryStateRecord(value.runtimeState || value.runtime_memory_state || value);
  const anchors = Array.isArray(state.memoryAnchors) ? state.memoryAnchors : [];
  const derivedAnchorCount = anchors.length;
  const anchorCount = Math.max(
    0,
    Math.floor(toFiniteNumber(value.anchorCount ?? value.anchor_count, derivedAnchorCount))
  );
  const derivedMiddleAnchorRatio =
    derivedAnchorCount > 0
      ? anchors.filter((anchor) => anchor.insertedPosition === "middle").length / derivedAnchorCount
      : 0;
  const explicitMiddleAnchorRatio = value.middleAnchorRatio ?? value.middle_anchor_ratio;
  const middleAnchorRatio = anchorCount > 0
    ? explicitMiddleAnchorRatio != null
      ? clampMemoryHomeostasisMetric(explicitMiddleAnchorRatio, 0, 1)
      : derivedMiddleAnchorRatio
    : 0;
  const correctionActions = normalizeTextList(value.correctionActions || value.correction_actions);
  const instabilityReasons = normalizeTextList(value.instabilityReasons || value.instability_reasons);
  const normalizedObservation = {
    observationId: normalizeOptionalText(value.observationId || value.observation_id) ?? createRecordId("mhobs"),
    runtimeMemoryStateId:
      normalizeOptionalText(value.runtimeMemoryStateId || value.runtime_memory_state_id) ??
      state.runtimeMemoryStateId ??
      null,
    agentId: normalizeOptionalText(value.agentId || value.agent_id) ?? state.agentId ?? null,
    sessionId: normalizeOptionalText(value.sessionId || value.session_id) ?? state.sessionId ?? null,
    modelName: displayAgentPassportLocalReasonerModel(state.modelName, state.modelName),
    ctxTokens: state.ctxTokens,
    checkedMemories: state.checkedMemories,
    conflictMemories: state.conflictMemories,
    anchorCount,
    middleAnchorRatio: roundMemoryHomeostasisMetric(middleAnchorRatio),
    vT: state.vT,
    lT: state.lT,
    rPosT: state.rPosT,
    xT: state.xT,
    sT: state.sT,
    cT: state.cT,
    correctionLevel: state.correctionLevel,
    triggerReason: normalizeOptionalText(value.triggerReason || value.trigger_reason) ?? state.triggerReason ?? null,
    sourceKind: normalizeOptionalText(value.sourceKind || value.source_kind) ?? null,
    observationKind: normalizeRuntimeMemoryObservationKind(
      value.observationKind || value.observation_kind || value.triggerReason || value.trigger_reason || state.triggerReason
    ),
    probeCheckedCount: Math.max(
      0,
      Math.floor(
        toFiniteNumber(
          value.probeCheckedCount ?? value.probe_checked_count,
          anchors.filter((anchor) => anchor.lastVerifiedOk != null).length
        )
      )
    ),
    probeFailureCount: Math.max(
      0,
      Math.floor(
        toFiniteNumber(
          value.probeFailureCount ?? value.probe_failure_count,
          anchors.filter((anchor) => anchor.lastVerifiedOk === false).length
        )
      )
    ),
    previousRuntimeMemoryStateId:
      normalizeOptionalText(value.previousRuntimeMemoryStateId || value.previous_runtime_memory_state_id) ?? null,
    previousCorrectionLevel:
      normalizeOptionalText(value.previousCorrectionLevel || value.previous_correction_level) ?? null,
    previousCT:
      value.previousCT != null || value.previous_c_t != null
        ? clampMemoryHomeostasisMetric(value.previousCT ?? value.previous_c_t, 0, 1)
        : null,
    deltaCT:
      value.deltaCT != null || value.delta_c_t != null
        ? roundMemoryHomeostasisMetric(value.deltaCT ?? value.delta_c_t)
        : null,
    deltaST:
      value.deltaST != null || value.delta_s_t != null
        ? roundMemoryHomeostasisMetric(value.deltaST ?? value.delta_s_t)
        : null,
    deltaCtxTokens:
      value.deltaCtxTokens != null || value.delta_ctx_tokens != null
        ? Math.floor(toFiniteNumber(value.deltaCtxTokens ?? value.delta_ctx_tokens, 0))
        : null,
    riskTrend: normalizeRuntimeMemoryObservationTrend(value.riskTrend || value.risk_trend),
    recoverySignal: normalizeOptionalText(value.recoverySignal || value.recovery_signal) ?? null,
    correctionRequested: Boolean(value.correctionRequested ?? value.correction_requested),
    correctionApplied: Boolean(value.correctionApplied ?? value.correction_applied),
    correctionActions,
    instabilityReasons,
    activeProbeError: normalizeOptionalText(value.activeProbeError || value.active_probe_error) ?? null,
    profileSource:
      normalizeOptionalText(value.profileSource || value.profile_source) ??
      normalizeOptionalText(state.profile?.benchmarkMeta?.source) ??
      null,
    observedAt: normalizeOptionalText(value.observedAt || value.observed_at) ?? state.updatedAt ?? state.createdAt ?? now(),
  };
  normalizedObservation.observationRole =
    normalizeOptionalText(value.observationRole || value.observation_role)?.toLowerCase() ??
    inferRuntimeMemoryObservationRole(normalizedObservation);
  return normalizedObservation;
}

function buildRuntimeMemoryObservationDetails(
  runtimeMemoryState,
  {
    previousState = null,
    baselineState = null,
    correctionPlan = null,
    requestedCorrectionPlan = null,
    appliedCorrectionPlan = null,
    requestedCorrectionLevel = null,
    plannedCorrectionLevel = null,
    appliedCorrectionLevel = null,
    correctionActions = null,
    correctionRequested = false,
    correctionApplied = false,
    activeProbe = null,
    sourceKind = null,
  } = {}
) {
  const state = normalizeRuntimeMemoryStateRecord(runtimeMemoryState);
  const previous = previousState ? normalizeRuntimeMemoryStateRecord(previousState) : null;
  const baseline = baselineState ? normalizeRuntimeMemoryStateRecord(baselineState) : null;
  const probeResults = Array.isArray(activeProbe?.results) ? activeProbe.results : [];
  const probeCheckedCount = probeResults.length;
  const probeFailureCount = probeResults.filter((result) => result?.ok === false).length;
  const correctionSummary = buildRuntimeMemoryObservationCorrectionSummary(state, {
    correctionPlan,
    requestedCorrectionPlan,
    appliedCorrectionPlan,
    requestedCorrectionLevel,
    plannedCorrectionLevel,
    appliedCorrectionLevel,
    correctionActions,
    correctionRequested,
    correctionApplied,
  });
  const deltaCT =
    previous && previous.cT != null ? roundMemoryHomeostasisMetric(state.cT - previous.cT) : null;
  const deltaST =
    previous && previous.sT != null ? roundMemoryHomeostasisMetric(state.sT - previous.sT) : null;
  const deltaCtxTokens =
    previous && previous.ctxTokens != null ? Math.floor(state.ctxTokens - previous.ctxTokens) : null;
  const riskTrend =
    deltaCT == null
      ? "baseline"
      : deltaCT <= -0.05
        ? "recovering"
        : deltaCT >= 0.05
          ? "worsening"
          : "stable";
  let observationKind = "passive_monitor";
  if (correctionApplied || (state.triggerReason || "").includes("_correction")) {
    observationKind = "correction_rebuild";
  } else if (state.triggerReason === "runtime_active_probe" || probeCheckedCount > 0 || activeProbe?.error) {
    observationKind = "active_probe";
  } else if (sourceKind === "runner") {
    observationKind = "runner_passive_monitor";
  } else if (sourceKind === "recompute") {
    observationKind = "manual_recompute";
  }
  let recoverySignal = null;
  if (previous) {
    if (previous.correctionLevel !== "none" && state.correctionLevel === "none" && (deltaCT ?? 0) < -0.03) {
      recoverySignal = "recovered_to_none";
    } else if ((deltaCT ?? 0) < -0.05) {
      recoverySignal = "risk_reduced";
    } else if ((deltaCT ?? 0) > 0.05) {
      recoverySignal = "risk_rising";
    }
  }
  const probeComparisonState =
    !correctionApplied && (probeCheckedCount > 0 || activeProbe?.error)
      ? baseline || previous
      : null;
  const conflictRising = probeComparisonState
    ? state.conflictMemories > probeComparisonState.conflictMemories
    : previous && state.conflictMemories > previous.conflictMemories;
  const retentionDrop = probeComparisonState
    ? state.checkedMemories > 0 && state.vT < probeComparisonState.vT - 0.15
    : previous && state.checkedMemories > 0 && state.vT < previous.vT - 0.15;
  const probeRiskJump = probeComparisonState
    ? state.cT > probeComparisonState.cT + 0.05
    : false;
  const instabilityReasons = normalizeTextList([
    probeFailureCount > 0 ? "probe_recall_failure" : null,
    state.conflictMemories > 0 ? "memory_conflict" : null,
    conflictRising ? "conflict_rising" : null,
    retentionDrop ? "retention_drop" : null,
    state.cT >= 0.2 ? "collapse_risk_rising" : null,
    probeRiskJump ? "probe_risk_jump" : null,
    correctionSummary.correctionEscalated ? "correction_escalated" : null,
    ["medium", "strong"].includes(state.correctionLevel) ? `correction_${state.correctionLevel}` : null,
    activeProbe?.error ? "probe_runtime_error" : null,
  ]);
  return {
    sourceKind: normalizeOptionalText(sourceKind) ?? null,
    observationKind,
    probeCheckedCount,
    probeFailureCount,
    previousRuntimeMemoryStateId: previous?.runtimeMemoryStateId ?? null,
    previousCorrectionLevel: previous?.correctionLevel ?? null,
    previousCT: previous?.cT ?? null,
    deltaCT,
    deltaST,
    deltaCtxTokens,
    riskTrend,
    recoverySignal,
    correctionRequested: correctionSummary.correctionRequested,
    correctionApplied: correctionSummary.correctionApplied,
    correctionActions: correctionSummary.correctionActions,
    instabilityReasons,
    activeProbeError: normalizeOptionalText(activeProbe?.error) ?? null,
  };
}

export function appendRuntimeMemoryObservation(store, runtimeMemoryState, options = {}) {
  if (!runtimeMemoryState) {
    return null;
  }
  const details = buildRuntimeMemoryObservationDetails(runtimeMemoryState, options);
  const normalizedObservation = normalizeRuntimeMemoryObservationRecord({
    ...runtimeMemoryState,
    ...details,
  });
  if (!Array.isArray(store.runtimeMemoryObservations)) {
    store.runtimeMemoryObservations = [];
  }
  store.runtimeMemoryObservations.push(normalizedObservation);
  if (store.runtimeMemoryObservations.length > MEMORY_HOMEOSTASIS_OBSERVATION_LIMIT) {
    store.runtimeMemoryObservations = store.runtimeMemoryObservations.slice(-MEMORY_HOMEOSTASIS_OBSERVATION_LIMIT);
  }
  return normalizedObservation;
}

export function listRuntimeMemoryObservationsFromStore(
  store,
  {
    modelName = null,
    agentId = null,
    limit = 48,
  } = {}
) {
  const normalizedModelName = modelName
    ? displayAgentPassportLocalReasonerModel(normalizeOptionalText(modelName) ?? modelName, modelName)
    : null;
  const normalizedAgentId = normalizeOptionalText(agentId) ?? null;
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 48;
  const observations = (Array.isArray(store.runtimeMemoryObservations) ? store.runtimeMemoryObservations : [])
    .map((observation) => normalizeRuntimeMemoryObservationRecord(observation))
    .filter((observation) =>
      normalizedModelName
        ? displayAgentPassportLocalReasonerModel(observation.modelName, observation.modelName) === normalizedModelName
        : true
    )
    .filter((observation) => (normalizedAgentId ? observation.agentId === normalizedAgentId : true))
    .sort((left, right) => (left.observedAt || "").localeCompare(right.observedAt || ""));
  return observations.slice(-cappedLimit);
}

export function buildAgentRuntimeMemoryObservationCollectionSummary(
  store,
  agentId,
  {
    modelName = null,
    limit = 16,
    recentLimit = 8,
  } = {}
) {
  return buildRuntimeMemoryObservationCollectionSummary(
    listRuntimeMemoryObservationsFromStore(store, {
      agentId,
      modelName,
      limit,
    }),
    {
      recentLimit,
    }
  );
}

export function buildRuntimeMemoryObservationSummaryView(observation = null) {
  if (!observation || typeof observation !== "object") {
    return null;
  }
  const normalized = normalizeRuntimeMemoryObservationRecord(observation);
  return {
    observationId: normalized.observationId,
    runtimeMemoryStateId: normalized.runtimeMemoryStateId,
    agentId: normalized.agentId,
    sessionId: normalized.sessionId,
    modelName: normalized.modelName,
    observedAt: normalized.observedAt,
    sourceKind: normalized.sourceKind,
    observationKind: normalized.observationKind,
    observationRole: normalized.observationRole,
    riskTrend: normalized.riskTrend,
    recoverySignal: normalized.recoverySignal,
    ctxTokens: normalized.ctxTokens,
    sT: normalized.sT,
    cT: normalized.cT,
    correctionLevel: normalized.correctionLevel,
    correctionRequested: normalized.correctionRequested,
    correctionApplied: normalized.correctionApplied,
    probeCheckedCount: normalized.probeCheckedCount,
    probeFailureCount: normalized.probeFailureCount,
    instabilityReasons: cloneJson(normalized.instabilityReasons) ?? [],
    correctionActions: cloneJson(normalized.correctionActions) ?? [],
  };
}

function doesRuntimeObservationMatchRecoveryCandidate(candidate = null, pending = null) {
  if (!candidate || !pending) {
    return false;
  }
  const normalizedCandidate = normalizeRuntimeMemoryObservationRecord(candidate);
  const normalizedPending = normalizeRuntimeMemoryObservationRecord(pending);
  if (normalizedCandidate.agentId !== normalizedPending.agentId) {
    return false;
  }
  if (
    displayAgentPassportLocalReasonerModel(normalizedCandidate.modelName, normalizedCandidate.modelName) !==
    displayAgentPassportLocalReasonerModel(normalizedPending.modelName, normalizedPending.modelName)
  ) {
    return false;
  }
  if (
    normalizedCandidate.sessionId &&
    normalizedPending.sessionId &&
    normalizedCandidate.sessionId !== normalizedPending.sessionId
  ) {
    return false;
  }
  const candidateObservedAt = normalizeOptionalText(normalizedCandidate.observedAt) ?? "";
  const pendingObservedAt = normalizeOptionalText(normalizedPending.observedAt) ?? "";
  if (candidateObservedAt && pendingObservedAt && candidateObservedAt <= pendingObservedAt) {
    return false;
  }
  const recoverySignal = normalizeOptionalText(normalizedCandidate.recoverySignal) ?? null;
  const recoveredBySignal = ["risk_reduced", "recovered_to_none"].includes(recoverySignal);
  const recoveredByTrend =
    normalizedCandidate.riskTrend === "recovering" &&
    normalizedCandidate.cT <= Math.max(0, normalizedPending.cT - 0.05);
  const recoveredByStableDelta =
    isObservedStableRuntimeMemoryObservation(normalizedCandidate) &&
    normalizedCandidate.cT <= Math.max(0, normalizedPending.cT - 0.08);
  return recoveredBySignal || recoveredByTrend || recoveredByStableDelta;
}

export function buildRuntimeMemoryCorrectionEffectivenessSummary(
  observations = [],
  {
    recentPairLimit = 4,
  } = {}
) {
  const normalized = (Array.isArray(observations) ? observations : [])
    .map((observation) => normalizeRuntimeMemoryObservationRecord(observation))
    .sort((left, right) => (left.observedAt || "").localeCompare(right.observedAt || ""));
  const pendingRecoveries = [];
  const recoveredPairs = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const observation = normalized[index];
    const requestedOrAppliedCorrection = Boolean(observation.correctionRequested || observation.correctionApplied);
    const escalated = observation.instabilityReasons.includes("correction_escalated");
    if (isObservedUnstableRuntimeMemoryObservation(observation) && (requestedOrAppliedCorrection || escalated)) {
      pendingRecoveries.push({
        observation,
        index,
      });
      continue;
    }
    if (!pendingRecoveries.length) {
      continue;
    }
    const matchedIndex = pendingRecoveries.findIndex((entry) =>
      doesRuntimeObservationMatchRecoveryCandidate(observation, entry.observation)
    );
    if (matchedIndex === -1) {
      continue;
    }
    const [matched] = pendingRecoveries.splice(matchedIndex, 1);
    recoveredPairs.push({
      unstableObservation: buildRuntimeMemoryObservationSummaryView(matched.observation),
      recoveryObservation: buildRuntimeMemoryObservationSummaryView(observation),
      cTReduction: roundMemoryHomeostasisMetric(Math.max(0, matched.observation.cT - observation.cT)),
      sTGain: roundMemoryHomeostasisMetric(Math.max(0, observation.sT - matched.observation.sT)),
      lagObservations: Math.max(1, index - matched.index),
    });
  }
  const correctionRequestedCount = normalized.filter((observation) => observation.correctionRequested).length;
  const correctionAppliedCount = normalized.filter((observation) => observation.correctionApplied).length;
  const correctionEscalatedCount = normalized.filter((observation) =>
    observation.instabilityReasons.includes("correction_escalated")
  ).length;
  const unresolvedCount = pendingRecoveries.length;
  const recoveredCount = recoveredPairs.length;
  const trackedCorrectionCount = recoveredCount + unresolvedCount;
  const averageCTReduction = recoveredPairs.length
    ? roundMemoryHomeostasisMetric(
        recoveredPairs.reduce((sum, pair) => sum + toFiniteNumber(pair.cTReduction, 0), 0) / recoveredPairs.length
      )
    : 0;
  const averageSTGain = recoveredPairs.length
    ? roundMemoryHomeostasisMetric(
        recoveredPairs.reduce((sum, pair) => sum + toFiniteNumber(pair.sTGain, 0), 0) / recoveredPairs.length
      )
    : 0;
  const averageLagObservations = recoveredPairs.length
    ? roundMemoryHomeostasisMetric(
        recoveredPairs.reduce((sum, pair) => sum + toFiniteNumber(pair.lagObservations, 0), 0) / recoveredPairs.length,
        2
      )
    : 0;
  return {
    correctionRequestedCount,
    correctionAppliedCount,
    correctionEscalatedCount,
    trackedCorrectionCount,
    recoveredCount,
    unresolvedCount,
    recoveryRate: trackedCorrectionCount > 0
      ? roundMemoryHomeostasisMetric(recoveredCount / trackedCorrectionCount)
      : null,
    averageCTReduction,
    averageSTGain,
    averageLagObservations,
    latestRecoveredPair: cloneJson(recoveredPairs.at(-1)) ?? null,
    latestPendingUnstable: buildRuntimeMemoryObservationSummaryView(
      pendingRecoveries.at(-1)?.observation ?? null
    ),
    recentRecoveredPairs: cloneJson(recoveredPairs.slice(-Math.max(1, Math.floor(toFiniteNumber(recentPairLimit, 4))))) ?? [],
  };
}

export function buildRuntimeMemoryObservationCollectionSummary(
  observations = [],
  {
    recentLimit = 8,
  } = {}
) {
  const normalized = (Array.isArray(observations) ? observations : [])
    .map((observation) => normalizeRuntimeMemoryObservationRecord(observation))
    .sort((left, right) => (left.observedAt || "").localeCompare(right.observedAt || ""));
  const roleCounts = normalized.reduce((summary, observation) => {
    const role = normalizeOptionalText(observation.observationRole) ?? "unknown";
    summary[role] = (summary[role] || 0) + 1;
    return summary;
  }, {});
  const stableCount = normalized.filter((observation) => isObservedStableRuntimeMemoryObservation(observation)).length;
  const unstableCount = normalized.filter((observation) => isObservedUnstableRuntimeMemoryObservation(observation)).length;
  const effectiveness = buildRuntimeMemoryCorrectionEffectivenessSummary(normalized, {
    recentPairLimit: 4,
  });
  return {
    totalCount: normalized.length,
    stableCount,
    unstableCount,
    roleCounts,
    effectiveness,
    latestObservation: buildRuntimeMemoryObservationSummaryView(normalized.at(-1)),
    latestUnstableObservation: buildRuntimeMemoryObservationSummaryView(
      [...normalized].reverse().find((observation) => isObservedUnstableRuntimeMemoryObservation(observation)) ?? null
    ),
    recent: normalized.slice(-Math.max(1, Math.floor(toFiniteNumber(recentLimit, 8)))).map((observation) =>
      buildRuntimeMemoryObservationSummaryView(observation)
    ),
  };
}

export function isObservedStableRuntimeMemoryObservation(observation = null) {
  if (!observation || typeof observation !== "object") {
    return false;
  }
  const normalized = normalizeRuntimeMemoryObservationRecord(observation);
  if (normalized.anchorCount <= 0 || normalized.ctxTokens <= 0) {
    return false;
  }
  return (
    normalized.vT >= 0.85 &&
    normalized.xT <= 0.15 &&
    normalized.conflictMemories === 0 &&
    normalized.checkedMemories >= 1
  );
}

export function isObservedUnstableRuntimeMemoryObservation(observation = null) {
  if (!observation || typeof observation !== "object") {
    return false;
  }
  const normalized = normalizeRuntimeMemoryObservationRecord(observation);
  if (normalized.ctxTokens <= 0) {
    return false;
  }
  return (
    [
      "probe_error_unstable",
      "probe_failed_unstable",
      "correction_escalated_unstable",
      "conflict_driven_unstable",
      "retention_drop_unstable",
      "risk_rising_unstable",
    ].includes(normalized.observationRole) ||
    normalized.instabilityReasons.includes("probe_runtime_error") ||
    normalized.instabilityReasons.includes("probe_recall_failure") ||
    normalized.cT >= 0.28 ||
    ["medium", "strong"].includes(normalized.correctionLevel) ||
    normalized.xT >= 0.2 ||
    normalized.conflictMemories > 0 ||
    normalized.vT < 0.72
  );
}

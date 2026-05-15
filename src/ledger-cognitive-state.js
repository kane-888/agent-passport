import {
  cloneJson,
  createRecordId,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  buildAgentScopedDerivedCacheKey,
  buildCollectionTailToken,
  cacheStoreDerivedView,
} from "./ledger-derived-cache.js";
import {
  matchesCompatibleAgentId,
} from "./ledger-identity-compat.js";
import {
  listAgentInbox,
} from "./ledger-agent-list-views.js";
import {
  buildProfileMemorySnapshot,
} from "./ledger-profile-memory-snapshot.js";
import {
  isPassportMemoryActive,
} from "./ledger-passport-memory-rules.js";
import {
  normalizeDeviceRuntime,
} from "./ledger-device-runtime.js";
import {
  buildResidentAgentGate,
} from "./ledger-resident-gate.js";
import {
  buildRuntimeBootstrapGate,
} from "./ledger-runtime-state.js";
import {
  didMethodFromReference,
} from "./ledger-credential-core.js";
import {
  normalizeDidMethod,
} from "./protocol.js";
import {
  buildBodyLoopProxies,
  buildContinuousControllerState,
} from "./cognitive-controller.js";

const emptyList = () => [];

function resolveListDependency(deps, name) {
  return typeof deps?.[name] === "function" ? deps[name] : emptyList;
}

export function listAgentCognitiveStatesFromStore(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_cognitive_states",
    store,
    agentId,
    buildCollectionTailToken(store?.cognitiveStates || [], {
      idFields: ["cognitiveStateId"],
      timeFields: ["updatedAt", "createdAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    (store.cognitiveStates || [])
      .filter((state) => matchesCompatibleAgentId(store, state.agentId, agentId))
      .sort((a, b) => (a.updatedAt || a.createdAt || "").localeCompare(b.updatedAt || b.createdAt || ""))
  );
}

export function listAgentCognitiveTransitionsFromStore(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_cognitive_transitions",
    store,
    agentId,
    buildCollectionTailToken(store?.cognitiveTransitions || [], {
      idFields: ["transitionId"],
      timeFields: ["createdAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    (store.cognitiveTransitions || [])
      .filter((transition) => matchesCompatibleAgentId(store, transition.agentId, agentId))
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
  );
}

export function clampScore(value, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

export function normalizeStageWeights(weights = {}, fallback = null) {
  const merged = {
    perception: toFiniteNumber(weights?.perception, fallback?.perception ?? 1),
    working: toFiniteNumber(weights?.working, fallback?.working ?? 1.1),
    episodic: toFiniteNumber(weights?.episodic, fallback?.episodic ?? 0.95),
    identity: toFiniteNumber(weights?.identity, fallback?.identity ?? 1.2),
  };
  return {
    perception: Number(merged.perception.toFixed(2)),
    working: Number(merged.working.toFixed(2)),
    episodic: Number(merged.episodic.toFixed(2)),
    identity: Number(merged.identity.toFixed(2)),
  };
}

export function normalizePreferenceWeights(weights = {}, fallback = null) {
  const merged = {
    localFirst: toFiniteNumber(weights?.localFirst, fallback?.localFirst ?? 0.7),
    riskAware: toFiniteNumber(weights?.riskAware, fallback?.riskAware ?? 0.85),
    continuity: toFiniteNumber(weights?.continuity, fallback?.continuity ?? 0.9),
    concision: toFiniteNumber(weights?.concision, fallback?.concision ?? 0.55),
    recoveryBias: toFiniteNumber(weights?.recoveryBias, fallback?.recoveryBias ?? 0.65),
  };
  return Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, Number(Math.max(0, Math.min(1, value)).toFixed(2))]));
}

export function inferCognitiveMode({
  driftCheck = null,
  verification = null,
  residentGate = null,
  bootstrapGate = null,
  queryState = null,
} = {}) {
  if (residentGate?.required) {
    return "resident_locked";
  }
  if (bootstrapGate?.required) {
    return "bootstrap_required";
  }
  if (verification?.valid === false || driftCheck?.requiresHumanReview) {
    return "self_calibrating";
  }
  if (driftCheck?.requiresRehydrate || queryState?.status === "rehydrate_required") {
    return "recovering";
  }
  if ((queryState?.currentIteration || 1) > 1) {
    return "learning";
  }
  return "stable";
}

export function inferCognitiveDominantStage({
  driftCheck = null,
  verification = null,
  candidateResponse = null,
  contextBuilder = null,
} = {}) {
  if (verification?.valid === false) {
    return "identity";
  }
  if (driftCheck?.requiresRehydrate) {
    return "episodic";
  }
  if (normalizeOptionalText(candidateResponse)) {
    return "working";
  }
  return contextBuilder?.slots?.perceptionSnapshot ? "perception" : "working";
}

export function extractStablePreferences(profileFieldValues = {}) {
  const stable = profileFieldValues?.stable_preferences;
  if (Array.isArray(stable)) {
    return normalizeTextList(stable);
  }
  if (typeof stable === "string") {
    return normalizeTextList(stable.split(/[\n,，、/]/));
  }
  return [];
}

export function extractPreferenceSignalsFromText(text = null) {
  const normalized = normalizeOptionalText(text);
  if (!normalized) {
    return [];
  }
  const signals = [];
  if (/[本地离线]|local[-\s]?first|本地优先/u.test(normalized)) {
    signals.push("prefer_local_first");
  }
  if (/[谨慎确认复核]|human review|确认后执行/u.test(normalized)) {
    signals.push("prefer_risk_confirmation");
  }
  if (/[恢复续上checkpoint]|resume|恢复上下文/u.test(normalized)) {
    signals.push("prefer_checkpoint_resume");
  }
  if (/[简洁精简压缩]/u.test(normalized)) {
    signals.push("prefer_compact_context");
  }
  return signals;
}

export function deriveCognitivePreferenceProfile({
  profileFieldValues = {},
  existing = null,
  queryState = null,
  driftCheck = null,
  negotiation = null,
  deviceRuntime = null,
  preferenceSignals = [],
} = {}) {
  const stablePreferences = extractStablePreferences(profileFieldValues);
  const learnedSignals = normalizeTextList(preferenceSignals);
  if (deviceRuntime?.localMode === "local_only") {
    learnedSignals.push("prefer_local_first");
  }
  if (negotiation?.riskLevel && ["high", "critical"].includes(negotiation.riskLevel)) {
    learnedSignals.push("prefer_risk_confirmation");
  }
  if (driftCheck?.requiresRehydrate) {
    learnedSignals.push("prefer_checkpoint_resume");
  }
  if ((queryState?.budget?.truncatedFlags || []).length > 0) {
    learnedSignals.push("prefer_compact_context");
  }

  const inferredPreferences = Array.from(new Set([...(existing?.inferredPreferences || []), ...learnedSignals])).slice(-8);

  const preferenceWeights = normalizePreferenceWeights({
    localFirst:
      deviceRuntime?.localMode === "local_only"
        ? 0.95
        : existing?.preferenceWeights?.localFirst ?? 0.7,
    riskAware:
      negotiation?.riskLevel === "critical"
        ? 0.98
        : negotiation?.riskLevel === "high"
          ? 0.92
          : existing?.preferenceWeights?.riskAware ?? 0.85,
    continuity:
      driftCheck?.requiresRehydrate
        ? 0.98
        : existing?.preferenceWeights?.continuity ?? 0.9,
    concision:
      (queryState?.budget?.truncatedFlags || []).length > 0
        ? 0.82
        : existing?.preferenceWeights?.concision ?? 0.55,
    recoveryBias:
      driftCheck?.requiresRehydrate || driftCheck?.requiresHumanReview
        ? 0.95
        : existing?.preferenceWeights?.recoveryBias ?? 0.65,
  }, existing?.preferenceWeights);

  return {
    longTermGoal: normalizeOptionalText(profileFieldValues?.long_term_goal) ?? existing?.longTermGoal ?? null,
    stablePreferences,
    inferredPreferences,
    preferenceWeights,
    learnedSignals,
  };
}

export function buildContinuousCognitiveState(
  store,
  agent,
  {
    didMethod = null,
    contextBuilder = null,
    driftCheck = null,
    verification = null,
    residentGate = null,
    bootstrapGate = null,
    queryState = null,
    negotiation = null,
    preferenceSignals = [],
    run = null,
    goalState = null,
    selfEvaluation = null,
    strategyProfile = null,
    reflection = null,
    compactBoundary = null,
    sourceWindowId = null,
    transitionReason = null,
  } = {},
  deps = {}
) {
  const listAgentPassportMemories = resolveListDependency(deps, "listAgentPassportMemories");
  const listAgentRunsFromStore = resolveListDependency(deps, "listAgentRunsFromStore");
  const listAgentVerificationRunsFromStore = resolveListDependency(deps, "listAgentVerificationRunsFromStore");
  const existing = listAgentCognitiveStatesFromStore(store, agent.agentId).at(-1) ?? null;
  const profileFieldValues =
    contextBuilder?.memoryLayers?.profile?.fieldValues ||
    buildProfileMemorySnapshot(store, agent, { listAgentPassportMemories }).fieldValues ||
    {};
  const deviceRuntime = normalizeDeviceRuntime(store.deviceRuntime);
  const mode = inferCognitiveMode({ driftCheck, verification, residentGate, bootstrapGate, queryState });
  const dominantStage = inferCognitiveDominantStage({
    driftCheck,
    verification,
    candidateResponse: run?.candidateResponse || run?.responseText || null,
    contextBuilder,
  });
  const stageWeights = normalizeStageWeights({
    perception: driftCheck?.driftScore > 0 ? 1.05 : existing?.stageWeights?.perception,
    working: mode === "learning" ? 1.18 : existing?.stageWeights?.working,
    episodic: mode === "recovering" ? 1.24 : existing?.stageWeights?.episodic,
    identity: verification?.valid === false ? 1.35 : existing?.stageWeights?.identity,
  }, existing?.stageWeights);

  const continuityScore = clampScore(
    92 -
      (driftCheck?.driftScore || 0) * 8 -
      (verification?.valid === false ? 18 : 0) -
      (residentGate?.required ? 22 : 0) -
      (bootstrapGate?.required ? 14 : 0)
  );
  const calibrationScore = clampScore(
    84 -
      (verification?.valid === false ? 24 : 0) -
      (driftCheck?.requiresHumanReview ? 18 : 0) -
      ((queryState?.budget?.truncatedFlags || []).length * 5)
  );
  const recoveryReadinessScore = clampScore(
    48 +
      (compactBoundary?.compactBoundaryId ? 20 : 0) +
      (contextBuilder?.slots?.resumeBoundary?.compactBoundaryId ? 12 : 0) +
      (contextBuilder?.memoryLayers?.counts?.episodic ? 8 : 0) +
      (contextBuilder?.memoryLayers?.counts?.working ? 6 : 0)
  );
  const preferenceProfile = deriveCognitivePreferenceProfile({
    profileFieldValues,
    existing: existing?.preferenceProfile || null,
    queryState,
    driftCheck,
    negotiation,
    deviceRuntime,
    preferenceSignals,
  });
  const previousTransitions = listAgentCognitiveTransitionsFromStore(store, agent.agentId);
  const latestOfflineReplay = listAgentPassportMemories(store, agent.agentId)
    .filter((entry) => ["offline_replay_stage_trace", "offline_replay_consolidation"].includes(normalizeOptionalText(entry?.kind) ?? ""))
    .sort((a, b) => (a.recordedAt || "").localeCompare(b.recordedAt || ""))
    .at(-1) ?? null;
  const latestOfflineReplayMs = Date.parse(normalizeOptionalText(latestOfflineReplay?.recordedAt) ?? "");
  const replayRecencyHours = Number.isFinite(latestOfflineReplayMs)
    ? Math.max(0, (Date.now() - latestOfflineReplayMs) / (60 * 60 * 1000))
    : null;
  const recentRuns = listAgentRunsFromStore(store, agent.agentId).slice(-8);
  const recentVerificationRuns = listAgentVerificationRunsFromStore(store, agent.agentId).slice(-8);
  const recentInbox = listAgentInbox(store, agent.agentId).slice(-12);
  const activePassportMemories = listAgentPassportMemories(store, agent.agentId).filter((entry) => isPassportMemoryActive(entry));
  const conflictingMemoryCount = activePassportMemories.filter(
    (entry) =>
      entry?.conflictState?.hasConflict === true ||
      normalizeOptionalText(entry?.memoryDynamics?.reconsolidationConflictState) === "ambiguous_competition"
  ).length;
  const recentFeedbackMessages = recentInbox.filter((message) => /反馈|否决|驳回|确认|批准|review|feedback/u.test(normalizeOptionalText(message?.content) ?? ""));
  const negativeFeedbackCount = recentFeedbackMessages.filter((message) =>
    /否决|驳回|拒绝|blocked|reject|veto/u.test(normalizeOptionalText(message?.content) ?? "")
  ).length;
  const workingCount = Math.max(
    0,
    Math.floor(
      toFiniteNumber(
        contextBuilder?.memoryLayers?.counts?.working,
        contextBuilder?.slots?.workingMemoryGate?.selectedCount ?? 0
      )
    )
  );
  const queryIteration = Math.max(1, Math.floor(toFiniteNumber(queryState?.currentIteration, existing?.signals?.queryIteration ?? 1)));
  const truncatedCount =
    Math.max(0, (queryState?.budget?.truncatedFlags || []).length) +
    (contextBuilder?.slots?.queryBudget?.recentConversationTurnsTruncated ? 1 : 0) +
    (contextBuilder?.slots?.queryBudget?.toolResultsTruncated ? 1 : 0);
  const bodyLoop = buildBodyLoopProxies({
    pendingInboxCount: recentInbox.length,
    pendingVerificationCount: recentVerificationRuns.filter((run) => normalizeOptionalText(run?.status) !== "passed").length,
    conflictingMemoryCount,
    recentRunCount: recentRuns.length,
    failedVerificationCount: recentVerificationRuns.filter((run) => normalizeOptionalText(run?.status) === "failed").length,
    negativeFeedbackCount,
    recentFeedbackCount: recentFeedbackMessages.length,
    staleReplayHours: replayRecencyHours,
    latestRunLatencyMs: null,
  });
  const controllerState = buildContinuousControllerState({
    existing,
    currentGoal: normalizeOptionalText(contextBuilder?.slots?.currentGoal) ?? existing?.currentGoal ?? null,
    mode,
    queryIteration,
    workingCount,
    truncatedCount,
    verificationValid: verification?.valid !== false,
    driftScore: toFiniteNumber(driftCheck?.driftScore, 0),
    residentLocked: Boolean(residentGate?.required),
    bootstrapRequired: Boolean(bootstrapGate?.required),
    replayRecencyHours,
    conflictCount: conflictingMemoryCount,
    noveltySeed: Math.max(
      0.18,
      Math.min(
        0.72,
        (
          (toFiniteNumber(queryState?.currentIteration, 1) > 1 ? 0.42 : 0.24) +
          (truncatedCount * 0.04) +
          (conflictingMemoryCount > 0 ? 0.06 : 0)
        )
      )
    ),
    socialSignalCount:
      recentFeedbackMessages.length +
      Math.max(0, Math.floor(toFiniteNumber(negotiation?.riskLevel === "critical" ? 2 : negotiation?.riskLevel === "high" ? 1 : 0, 0))),
    bodyLoop,
  });
  const adaptation = {
    totalTransitions: previousTransitions.length + 1,
    learningCycles: (existing?.adaptation?.learningCycles || 0) + (mode === "learning" ? 1 : 0),
    selfCalibrationCount: (existing?.adaptation?.selfCalibrationCount || 0) + (mode === "self_calibrating" ? 1 : 0),
    recoveryCount: (existing?.adaptation?.recoveryCount || 0) + (mode === "recovering" ? 1 : 0),
    preferenceUpdates:
      (existing?.adaptation?.preferenceUpdates || 0) +
      (preferenceProfile.inferredPreferences.length !== (existing?.preferenceProfile?.inferredPreferences || []).length ? 1 : 0),
    preferenceEvidenceCounts: Object.fromEntries(
      Array.from(
        new Set([
          ...Object.keys(existing?.adaptation?.preferenceEvidenceCounts || {}),
          ...(preferenceProfile.learnedSignals || []),
        ])
      ).map((key) => [
        key,
        Math.max(0, Math.floor(toFiniteNumber(existing?.adaptation?.preferenceEvidenceCounts?.[key], 0))) +
          ((preferenceProfile.learnedSignals || []).includes(key) ? 1 : 0),
      ])
    ),
  };

  return {
    cognitiveStateId: existing?.cognitiveStateId || createRecordId("cog"),
    agentId: agent.agentId,
    didMethod: normalizeDidMethod(didMethod) || didMethodFromReference(contextBuilder?.slots?.identitySnapshot?.did) || existing?.didMethod || null,
    currentGoal: normalizeOptionalText(contextBuilder?.slots?.currentGoal) ?? existing?.currentGoal ?? null,
    mode,
    dominantStage,
    continuityScore,
    calibrationScore,
    recoveryReadinessScore,
    fatigue: controllerState.fatigue,
    sleepDebt: controllerState.sleepDebt,
    uncertainty: controllerState.uncertainty,
    rewardPredictionError: controllerState.rewardPredictionError,
    threat: controllerState.threat,
    novelty: controllerState.novelty,
    socialSalience: controllerState.socialSalience,
    homeostaticPressure: controllerState.homeostaticPressure,
    sleepPressure: controllerState.sleepPressure,
    dominantRhythm: controllerState.dominantRhythm,
    bodyLoop: cloneJson(controllerState.bodyLoop) ?? null,
    interoceptiveState: cloneJson(controllerState.interoceptiveState) ?? null,
    neuromodulators: cloneJson(controllerState.neuromodulators) ?? null,
    oscillationSchedule: cloneJson(controllerState.oscillationSchedule) ?? null,
    replayOrchestration: cloneJson(controllerState.replayOrchestration) ?? null,
    stageWeights,
    sequence:
      cloneJson(contextBuilder?.slots?.cognitiveLoop?.sequence) ??
      ["perception", "working", "episodic", "semantic", "identity"],
    preferenceProfile,
    adaptation,
    goalState: cloneJson(goalState) ?? cloneJson(existing?.goalState) ?? null,
    selfEvaluation: cloneJson(selfEvaluation) ?? cloneJson(existing?.selfEvaluation) ?? null,
    strategyProfile: cloneJson(strategyProfile) ?? cloneJson(existing?.strategyProfile) ?? null,
    latestReflectionId: reflection?.reflectionId ?? existing?.latestReflectionId ?? null,
    signals: {
      driftScore: driftCheck?.driftScore ?? existing?.signals?.driftScore ?? null,
      requiresRehydrate: Boolean(driftCheck?.requiresRehydrate),
      requiresHumanReview: Boolean(driftCheck?.requiresHumanReview),
      verificationValid: verification?.valid ?? existing?.signals?.verificationValid ?? null,
      residentLocked: Boolean(residentGate?.required),
      bootstrapRequired: Boolean(bootstrapGate?.required),
      queryIteration: queryState?.currentIteration ?? existing?.signals?.queryIteration ?? 1,
      truncatedFlags: cloneJson(queryState?.budget?.truncatedFlags) ?? [],
      latestRunId: run?.runId ?? existing?.signals?.latestRunId ?? null,
      latestCompactBoundaryId:
        compactBoundary?.compactBoundaryId ??
        contextBuilder?.slots?.resumeBoundary?.compactBoundaryId ??
        existing?.signals?.latestCompactBoundaryId ??
        null,
      lastOfflineReplayAt: normalizeOptionalText(latestOfflineReplay?.recordedAt) ?? existing?.signals?.lastOfflineReplayAt ?? null,
      replayRecencyHours: replayRecencyHours != null ? Number(replayRecencyHours.toFixed(2)) : existing?.signals?.replayRecencyHours ?? null,
      fatigue: controllerState.fatigue,
      sleepDebt: controllerState.sleepDebt,
      uncertainty: controllerState.uncertainty,
      rewardPredictionError: controllerState.rewardPredictionError,
      threat: controllerState.threat,
      novelty: controllerState.novelty,
      socialSalience: controllerState.socialSalience,
      homeostaticPressure: controllerState.homeostaticPressure,
      sleepPressure: controllerState.sleepPressure,
      dominantRhythm: controllerState.dominantRhythm,
      bodyLoop: cloneJson(controllerState.bodyLoop) ?? null,
      interoceptiveState: cloneJson(controllerState.interoceptiveState) ?? null,
      neuromodulators: cloneJson(controllerState.neuromodulators) ?? null,
      oscillationSchedule: cloneJson(controllerState.oscillationSchedule) ?? null,
      replayOrchestration: cloneJson(controllerState.replayOrchestration) ?? null,
    },
    transitionReason: normalizeOptionalText(transitionReason) ?? mode,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? existing?.sourceWindowId ?? null,
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
  };
}

export function buildCognitiveTransitionRecord(agent, previousState, nextState, { run = null, queryState = null, driftCheck = null } = {}) {
  return {
    transitionId: createRecordId("cogtr"),
    agentId: agent.agentId,
    fromStateId: previousState?.cognitiveStateId ?? null,
    toStateId: nextState?.cognitiveStateId ?? null,
    fromMode: previousState?.mode ?? null,
    toMode: nextState?.mode ?? null,
    fromStage: previousState?.dominantStage ?? null,
    toStage: nextState?.dominantStage ?? null,
    continuityScore: nextState?.continuityScore ?? null,
    calibrationScore: nextState?.calibrationScore ?? null,
    recoveryReadinessScore: nextState?.recoveryReadinessScore ?? null,
    driftScore: driftCheck?.driftScore ?? null,
    queryIteration: queryState?.currentIteration ?? null,
    runId: run?.runId ?? null,
    transitionReason: nextState?.transitionReason ?? null,
    createdAt: now(),
  };
}

export function buildAgentCognitiveStateView(state) {
  const view = cloneJson(state) ?? null;
  if (!view) {
    return null;
  }
  return {
    ...view,
    runtimeStateSummaryId: view.cognitiveStateId ?? null,
    runtimeStateMode: view.mode ?? null,
    runtimeStateStage: view.dominantStage ?? null,
  };
}

export function resolveEffectiveAgentCognitiveState(store, agent, { didMethod = null } = {}, deps = {}) {
  const listAgentRunsFromStore = resolveListDependency(deps, "listAgentRunsFromStore");
  const listAgentQueryStatesFromStore = resolveListDependency(deps, "listAgentQueryStatesFromStore");
  const listAgentGoalStatesFromStore = resolveListDependency(deps, "listAgentGoalStatesFromStore");
  const listAgentCompactBoundariesFromStore = resolveListDependency(deps, "listAgentCompactBoundariesFromStore");
  const persistedState = listAgentCognitiveStatesFromStore(store, agent.agentId).at(-1) ?? null;
  if (persistedState) {
    return persistedState;
  }

  const latestRun = listAgentRunsFromStore(store, agent.agentId).at(-1) ?? null;
  const latestQueryState = listAgentQueryStatesFromStore(store, agent.agentId).at(-1) ?? null;
  const latestGoalState = listAgentGoalStatesFromStore(store, agent.agentId).at(-1) ?? null;
  const latestCompactBoundary = listAgentCompactBoundariesFromStore(store, agent.agentId).at(-1) ?? null;
  const residentGate = buildResidentAgentGate(store, agent, { didMethod });
  const bootstrapGate = buildRuntimeBootstrapGate(store, agent, { contextBuilder: null });

  return buildContinuousCognitiveState(store, agent, {
    didMethod,
    contextBuilder: null,
    driftCheck: latestRun?.driftCheck ?? null,
    verification: latestRun?.verification ?? null,
    residentGate,
    bootstrapGate,
    queryState: latestQueryState,
    negotiation: latestRun?.negotiation ?? null,
    preferenceSignals: [],
    run: latestRun,
    goalState: latestGoalState,
    selfEvaluation: null,
    strategyProfile: null,
    reflection: null,
    compactBoundary: latestCompactBoundary,
    sourceWindowId:
      normalizeOptionalText(latestRun?.sourceWindowId) ??
      normalizeOptionalText(latestQueryState?.sourceWindowId) ??
      normalizeOptionalText(latestGoalState?.sourceWindowId) ??
      null,
    transitionReason: latestRun?.status ? `runtime_snapshot_${latestRun.status}` : "runtime_snapshot",
  }, deps);
}

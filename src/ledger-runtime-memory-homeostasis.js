import {
  cloneJson,
  normalizeOptionalText,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import { normalizeRuntimeReasonerProvider } from "./ledger-device-runtime.js";
import {
  AGENT_PASSPORT_LOCAL_REASONER_LABEL,
  displayAgentPassportLocalReasonerModel,
} from "./memory-engine-branding.js";
import {
  buildMemoryCorrectionPlan,
  buildMemoryHomeostasisPromptSummary,
  buildModelProfileView,
  buildRuntimeMemoryStateView,
  normalizeModelProfileRecord,
  normalizeRuntimeMemoryStateRecord,
} from "./memory-homeostasis.js";
import {
  clampMemoryHomeostasisMetric,
  computeRuntimeMemoryObservationCalibrationWeight,
  isObservedStableRuntimeMemoryObservation,
  isObservedUnstableRuntimeMemoryObservation,
  listRuntimeMemoryObservationsFromStore,
  normalizeRuntimeMemoryObservationRecord,
  roundMemoryHomeostasisMetric,
} from "./ledger-runtime-memory-observations.js";

export const DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT = 4000;

export function listModelProfilesFromStore(store, { modelName = null } = {}) {
  const normalizedModelName = normalizeOptionalText(modelName) ?? null;
  return (store.modelProfiles || [])
    .map((profile) => normalizeModelProfileRecord(profile))
    .filter((profile) =>
      normalizedModelName
        ? displayAgentPassportLocalReasonerModel(profile.modelName, profile.modelName) ===
            displayAgentPassportLocalReasonerModel(normalizedModelName, normalizedModelName)
        : true
    )
    .sort((left, right) => (left.createdAt || "").localeCompare(right.createdAt || ""));
}

export function isOperationalMemoryHomeostasisProfile(profile = null) {
  if (!profile || typeof profile !== "object") {
    return false;
  }
  const normalized = normalizeModelProfileRecord(profile);
  const plan = normalized.benchmarkMeta?.plan;
  const lengths = Array.isArray(plan?.lengths)
    ? plan.lengths
        .map((value) => Math.max(0, Math.floor(toFiniteNumber(value, 0))))
        .filter((value) => value > 0)
    : [];
  const positions = Array.isArray(plan?.positions)
    ? plan.positions.map((value) => normalizeOptionalText(value)?.toLowerCase()).filter(Boolean)
    : [];
  const requiredPositions = ["front", "middle", "tail"];
  const hasAllPositions = requiredPositions.every((position) => positions.includes(position));
  return lengths.length >= 4 && hasAllPositions;
}

export function computeMemoryHomeostasisQuantile(values = [], quantile = 0.5, fallback = 0) {
  const sorted = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!sorted.length) {
    return fallback;
  }
  const position = clampMemoryHomeostasisMetric(quantile, 0, 1) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }
  const lowerValue = sorted[lowerIndex];
  const upperValue = sorted[upperIndex];
  return lowerValue + ((upperValue - lowerValue) * (position - lowerIndex));
}

export function computeWeightedMemoryHomeostasisQuantile(
  items = [],
  valueSelector = (item) => item,
  weightSelector = () => 1,
  quantile = 0.5,
  fallback = 0
) {
  const pairs = (Array.isArray(items) ? items : [])
    .map((item) => ({
      value: Number(valueSelector(item)),
      weight: Math.max(0, Number(weightSelector(item))),
    }))
    .filter((item) => Number.isFinite(item.value) && item.weight > 0)
    .sort((left, right) => left.value - right.value);
  if (!pairs.length) {
    return fallback;
  }
  const totalWeight = pairs.reduce((sum, item) => sum + item.weight, 0);
  if (!(totalWeight > 0)) {
    return fallback;
  }
  const targetWeight = clampMemoryHomeostasisMetric(quantile, 0, 1) * totalWeight;
  let cumulativeWeight = 0;
  for (const pair of pairs) {
    cumulativeWeight += pair.weight;
    if (cumulativeWeight >= targetWeight) {
      return pair.value;
    }
  }
  return pairs.at(-1)?.value ?? fallback;
}

export function isTrustedRuntimeMemoryHomeostasisProfile(profile = null) {
  if (!isOperationalMemoryHomeostasisProfile(profile)) {
    return false;
  }
  const normalized = normalizeModelProfileRecord(profile);
  const benchmarkMeta = normalized.benchmarkMeta && typeof normalized.benchmarkMeta === "object"
    ? normalized.benchmarkMeta
    : {};
  const provider =
    normalizeRuntimeReasonerProvider(benchmarkMeta.provider) ??
    normalizeRuntimeReasonerProvider(benchmarkMeta.localReasoner?.provider) ??
    null;
  const rawScenarios = Array.isArray(benchmarkMeta.rawScenarios) ? benchmarkMeta.rawScenarios : [];
  const hasSimulatedScenario = rawScenarios.some((scenario) => scenario?.simulation === true);
  return !benchmarkMeta.fallback && provider !== "local_mock" && provider !== "mock" && !hasSimulatedScenario;
}

export function estimateObservedRuntimeMidDrop(observations = [], fallback = 0.22) {
  const samples = (Array.isArray(observations) ? observations : [])
    .map((observation) => {
      const normalized = normalizeRuntimeMemoryObservationRecord(observation);
      if (normalized.middleAnchorRatio <= 0) {
        return null;
      }
      return clampMemoryHomeostasisMetric(normalized.rPosT / normalized.middleAnchorRatio, 0, 1);
    })
    .filter((value) => value != null);
  if (!samples.length) {
    return fallback;
  }
  return computeMemoryHomeostasisQuantile(samples, 0.5, fallback);
}

export function buildObservedRuntimeMemoryHomeostasisProfile(
  store,
  {
    modelName = AGENT_PASSPORT_LOCAL_REASONER_LABEL,
    runtimePolicy = null,
    contractProfile = null,
  } = {}
) {
  const defaultProfile = contractProfile
    ? normalizeModelProfileRecord(contractProfile)
    : buildFallbackMemoryHomeostasisModelProfile({
        modelName,
        runtimePolicy,
      });
  const recentObservations = listRuntimeMemoryObservationsFromStore(store, {
    modelName,
    limit: 48,
  }).map((observation) => normalizeRuntimeMemoryObservationRecord(observation));
  const stableObservations = recentObservations.filter((observation) =>
    isObservedStableRuntimeMemoryObservation(observation)
  );
  const unstableObservations = recentObservations.filter((observation) =>
    isObservedUnstableRuntimeMemoryObservation(observation)
  );
  if (!stableObservations.length && !unstableObservations.length) {
    return null;
  }
  const defaultMaxContextTokens = Math.max(
    1024,
    Math.floor(
      toFiniteNumber(
        defaultProfile.benchmarkMeta?.maxContextTokens ?? runtimePolicy?.maxContextTokens,
        DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT
      )
    )
  );
  const stableCtxTokens = stableObservations.map((observation) => observation.ctxTokens).filter((value) => value > 0);
  const unstableCtxTokens = unstableObservations.map((observation) => observation.ctxTokens).filter((value) => value > 0);
  const stableSampleCount = stableObservations.length;
  const unstableSampleCount = unstableObservations.length;
  const stableWeightTotal = roundMemoryHomeostasisMetric(
    stableObservations.reduce(
      (sum, observation) => sum + computeRuntimeMemoryObservationCalibrationWeight(observation, { role: "stable" }),
      0
    ),
    3
  );
  const unstableWeightTotal = roundMemoryHomeostasisMetric(
    unstableObservations.reduce(
      (sum, observation) => sum + computeRuntimeMemoryObservationCalibrationWeight(observation, { role: "unstable" }),
      0
    ),
    3
  );
  const positiveConfidence = stableSampleCount > 0
    ? clampMemoryHomeostasisMetric(0.16 + (stableWeightTotal * 0.14), 0.16, 0.88)
    : 0;
  const negativeConfidence = unstableSampleCount > 0
    ? clampMemoryHomeostasisMetric(0.12 + (unstableWeightTotal * 0.16), 0.12, 0.92)
    : 0;
  const observedStableCtxP75 = stableCtxTokens.length
    ? computeWeightedMemoryHomeostasisQuantile(
        stableObservations,
        (observation) => observation.ctxTokens,
        (observation) => computeRuntimeMemoryObservationCalibrationWeight(observation, { role: "stable" }),
        0.75,
        stableCtxTokens[stableCtxTokens.length - 1]
      )
    : null;
  const observedStableCtxMax = stableCtxTokens.length
    ? computeWeightedMemoryHomeostasisQuantile(
        stableObservations,
        (observation) => observation.ctxTokens,
        (observation) => computeRuntimeMemoryObservationCalibrationWeight(observation, { role: "stable" }),
        1,
        observedStableCtxP75 ?? stableCtxTokens[stableCtxTokens.length - 1]
      )
    : null;
  const observedUnstableCtxP25 = unstableCtxTokens.length
    ? computeWeightedMemoryHomeostasisQuantile(
        unstableObservations,
        (observation) => observation.ctxTokens,
        (observation) => computeRuntimeMemoryObservationCalibrationWeight(observation, { role: "unstable" }),
        0.25,
        unstableCtxTokens[0]
      )
    : null;
  let calibratedEcl085 = defaultProfile.ecl085;
  if (observedStableCtxP75 != null) {
    const observedPositiveEcl = Math.max(1024, Math.floor(observedStableCtxP75 / 0.78));
    calibratedEcl085 = Math.max(
      defaultProfile.ecl085,
      Math.floor((defaultProfile.ecl085 * (1 - positiveConfidence)) + (observedPositiveEcl * positiveConfidence))
    );
  }
  if (observedUnstableCtxP25 != null) {
    const unstableCeilingEcl = Math.max(1024, Math.floor(observedUnstableCtxP25 / 0.82));
    const downwardTargetEcl = Math.min(calibratedEcl085, unstableCeilingEcl);
    calibratedEcl085 = Math.max(
      1024,
      Math.floor((calibratedEcl085 * (1 - negativeConfidence)) + (downwardTargetEcl * negativeConfidence))
    );
  }
  const defaultLoadRatio = clampMemoryHomeostasisMetric(
    defaultProfile.ecl085 / Math.max(1, defaultMaxContextTokens),
    0,
    1.2
  );
  const observedLoadRatio = clampMemoryHomeostasisMetric(
    calibratedEcl085 / Math.max(1, defaultMaxContextTokens),
    0,
    1.2
  );
  const calibratedCcrs = roundMemoryHomeostasisMetric(
    clampMemoryHomeostasisMetric(
      defaultProfile.ccrs +
        Math.max(0, observedLoadRatio - defaultLoadRatio) * 0.35 * positiveConfidence -
        (unstableSampleCount
          ? computeWeightedMemoryHomeostasisQuantile(
              unstableObservations,
              (observation) => observation.cT,
              (observation) => computeRuntimeMemoryObservationCalibrationWeight(observation, { role: "unstable" }),
              0.5,
              0
            ) * 0.2 * negativeConfidence
          : 0),
      0.2,
      0.95
    )
  );
  const observedMidDrop = estimateObservedRuntimeMidDrop(recentObservations, defaultProfile.midDrop);
  const calibratedMidDrop = roundMemoryHomeostasisMetric(
    clampMemoryHomeostasisMetric(
      (defaultProfile.midDrop * (1 - Math.max(positiveConfidence, negativeConfidence))) +
        (observedMidDrop * Math.max(positiveConfidence, negativeConfidence)),
      0,
      1
    )
  );
  return normalizeModelProfileRecord({
    modelName,
    ccrs: calibratedCcrs,
    ecl085: calibratedEcl085,
    pr: defaultProfile.pr,
    midDrop: calibratedMidDrop,
    benchmarkMeta: {
      fallback: true,
      source: "runtime_observed_calibration",
      maxContextTokens: defaultMaxContextTokens,
      sampleCount: recentObservations.length,
      stableSampleCount,
      unstableSampleCount,
      stableWeightTotal,
      unstableWeightTotal,
      positiveConfidence: roundMemoryHomeostasisMetric(positiveConfidence),
      negativeConfidence: roundMemoryHomeostasisMetric(negativeConfidence),
      observedStableCtxP75: observedStableCtxP75 != null ? roundMemoryHomeostasisMetric(observedStableCtxP75, 2) : null,
      observedStableCtxMax: observedStableCtxMax != null ? roundMemoryHomeostasisMetric(observedStableCtxMax, 2) : null,
      observedUnstableCtxP25: observedUnstableCtxP25 != null
        ? roundMemoryHomeostasisMetric(observedUnstableCtxP25, 2)
        : null,
      defaultProfile: {
        ccrs: defaultProfile.ccrs,
        ecl085: defaultProfile.ecl085,
        pr: defaultProfile.pr,
        midDrop: defaultProfile.midDrop,
      },
      recentObservationIds: recentObservations.slice(-8).map((observation) => observation.observationId),
      recentStateIds: recentObservations.slice(-8).map((observation) => observation.runtimeMemoryStateId).filter(Boolean),
    },
  });
}

export function resolveActiveMemoryHomeostasisModelName(
  store,
  {
    run = null,
    reasoner = null,
    localReasoner = null,
  } = {}
) {
  const explicitModel =
    normalizeOptionalText(run?.reasoner?.model) ??
    normalizeOptionalText(reasoner?.model) ??
    normalizeOptionalText(reasoner?.metadata?.model) ??
    normalizeOptionalText(localReasoner?.model) ??
    normalizeOptionalText(store.deviceRuntime?.localReasoner?.model) ??
    null;
  if (explicitModel) {
    return displayAgentPassportLocalReasonerModel(explicitModel, explicitModel);
  }
  const provider =
    normalizeRuntimeReasonerProvider(run?.reasoner?.provider) ??
    normalizeRuntimeReasonerProvider(reasoner?.provider) ??
    normalizeRuntimeReasonerProvider(localReasoner?.provider) ??
    normalizeRuntimeReasonerProvider(store.deviceRuntime?.localReasoner?.provider) ??
    null;
  if (["ollama_local", "local_command", "local_mock"].includes(provider)) {
    return AGENT_PASSPORT_LOCAL_REASONER_LABEL;
  }
  return provider || AGENT_PASSPORT_LOCAL_REASONER_LABEL;
}

export function buildFallbackMemoryHomeostasisModelProfile({
  modelName = AGENT_PASSPORT_LOCAL_REASONER_LABEL,
  runtimePolicy = null,
} = {}) {
  const maxContextTokens = Math.max(
    1024,
    Math.floor(toFiniteNumber(runtimePolicy?.maxContextTokens, DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT))
  );
  return normalizeModelProfileRecord({
    modelName,
    ccrs: 0.58,
    ecl085: Math.max(1024, Math.floor(maxContextTokens * 0.7)),
    pr: 0.62,
    midDrop: 0.22,
    benchmarkMeta: {
      fallback: true,
      source: "runtime_policy_default",
      maxContextTokens,
    },
  });
}

export function resolveRuntimeMemoryHomeostasisProfile(
  store,
  {
    modelName = null,
    runtimePolicy = null,
    contractProfile = null,
  } = {}
) {
  const normalizedModelName = normalizeOptionalText(modelName) ?? AGENT_PASSPORT_LOCAL_REASONER_LABEL;
  const profile =
    listModelProfilesFromStore(store, {
      modelName: normalizedModelName,
    })
      .filter((candidate) => isTrustedRuntimeMemoryHomeostasisProfile(candidate))
      .at(-1) ?? null;
  if (profile) {
    return profile;
  }
  const observedProfile = buildObservedRuntimeMemoryHomeostasisProfile(store, {
    modelName: normalizedModelName,
    runtimePolicy,
    contractProfile,
  });
  if (observedProfile) {
    return observedProfile;
  }
  if (contractProfile) {
    return normalizeModelProfileRecord(contractProfile);
  }
  return buildFallbackMemoryHomeostasisModelProfile({
    modelName: normalizedModelName,
    runtimePolicy,
  });
}

export function summarizeMemoryHomeostasisText(value, maxChars = 180) {
  const normalized = normalizeOptionalText(value) ?? null;
  if (!normalized) {
    return null;
  }
  return normalized.length > maxChars ? `${normalized.slice(0, Math.max(0, maxChars - 3))}...` : normalized;
}

export function buildMemoryHomeostasisPromptAnchorEntries(anchors = [], limit = 6) {
  return (anchors || [])
    .slice(0, Math.max(1, Math.floor(toFiniteNumber(limit, 6))))
    .map((anchor) => ({
      memoryId: anchor.memoryId,
      source: anchor.source,
      insertedPosition: anchor.insertedPosition,
      importanceWeight: anchor.importanceWeight,
      content: summarizeMemoryHomeostasisText(anchor.content, 140),
    }));
}

export function syncContextBuilderMemoryHomeostasisDerivedViews(
  contextBuilder,
  {
    runtimeState = null,
    modelProfile = null,
  } = {}
) {
  if (!contextBuilder || typeof contextBuilder !== "object" || !runtimeState) {
    return null;
  }

  const normalizedRuntimeState = normalizeRuntimeMemoryStateRecord(runtimeState);
  const resolvedModelProfile =
    modelProfile ??
    normalizedRuntimeState?.profile ??
    contextBuilder?.memoryHomeostasis?.modelProfile ??
    contextBuilder?.slots?.memoryHomeostasis?.modelProfile ??
    null;
  const resolvedRuntimeState = normalizeRuntimeMemoryStateRecord({
    ...cloneJson(normalizedRuntimeState),
    profile: resolvedModelProfile ?? normalizedRuntimeState?.profile ?? null,
    modelProfile: resolvedModelProfile ?? normalizedRuntimeState?.profile ?? null,
  });
  const correctionPlan = buildMemoryCorrectionPlan({
    runtimeState: resolvedRuntimeState,
    modelProfile: resolvedModelProfile,
  });
  const runtimeStateView = buildRuntimeMemoryStateView(resolvedRuntimeState);
  const modelProfileView = buildModelProfileView(resolvedModelProfile);
  const summary = buildMemoryHomeostasisPromptSummary(resolvedRuntimeState);
  const slotMemoryHomeostasis =
    contextBuilder?.slots?.memoryHomeostasis && typeof contextBuilder.slots.memoryHomeostasis === "object"
      ? contextBuilder.slots.memoryHomeostasis
      : {};
  const anchorLimit =
    correctionPlan?.placementStrategy?.maxTailAnchors ??
    resolvedRuntimeState?.placementStrategy?.maxTailAnchors ??
    6;
  const anchors = buildMemoryHomeostasisPromptAnchorEntries(resolvedRuntimeState.memoryAnchors, anchorLimit);
  const resolvedModelName =
    normalizeOptionalText(resolvedRuntimeState.modelName) ??
    normalizeOptionalText(modelProfileView?.modelName) ??
    normalizeOptionalText(slotMemoryHomeostasis.modelName) ??
    null;

  if (!contextBuilder.memoryHomeostasis || typeof contextBuilder.memoryHomeostasis !== "object") {
    contextBuilder.memoryHomeostasis = {};
  }
  if (!contextBuilder.slots || typeof contextBuilder.slots !== "object") {
    contextBuilder.slots = {};
  }

  contextBuilder.memoryHomeostasis = {
    ...contextBuilder.memoryHomeostasis,
    modelName: resolvedModelName,
    modelProfile: modelProfileView,
    runtimeState: runtimeStateView,
    correctionPlan,
    anchors,
  };
  contextBuilder.slots.memoryHomeostasis = {
    ...slotMemoryHomeostasis,
    modelName: resolvedModelName,
    modelProfile: modelProfileView,
    correctionLevel: correctionPlan?.correctionLevel ?? null,
    compressHistory: Boolean(correctionPlan?.compressHistory),
    authoritativeReload: Boolean(correctionPlan?.authoritativeReload),
    anchors,
    summary,
    runtimeState: runtimeStateView,
    correctionPlan,
    authoritativeReloadSnapshot:
      correctionPlan?.authoritativeReload === true ? slotMemoryHomeostasis.authoritativeReloadSnapshot ?? null : null,
  };

  return {
    runtimeState: resolvedRuntimeState,
    modelProfile: resolvedModelProfile,
    correctionPlan,
  };
}

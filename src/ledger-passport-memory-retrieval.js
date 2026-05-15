import {
  normalizeOptionalText,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  compareTextSimilarity,
} from "./ledger-text-similarity.js";
import {
  normalizePassportMemoryUnitScore,
} from "./ledger-passport-memory-rules.js";

const DEFAULT_MEMORY_PATTERN_COMPLETION_EXTRA = 2;
const DEFAULT_PASSPORT_MEMORY_LIMIT = 20;

function clampUnitInterval(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number(Math.max(0, Math.min(1, fallback)).toFixed(2));
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(2));
}

export function computePassportMemoryAgeDays(entry, referenceTime = now()) {
  const recordedAt = normalizeOptionalText(entry?.recordedAt) ?? null;
  if (!recordedAt) {
    return 0;
  }
  const createdMs = Date.parse(recordedAt);
  const referenceMs = Date.parse(referenceTime);
  if (!Number.isFinite(createdMs) || !Number.isFinite(referenceMs) || referenceMs <= createdMs) {
    return 0;
  }
  return (referenceMs - createdMs) / (1000 * 60 * 60 * 24);
}

export function buildPassportMemorySearchText(entry) {
  const detailRetentionScore = toFiniteNumber(entry?.memoryDynamics?.detailRetentionScore, 1);
  const parts = [
    entry?.summary,
    entry?.kind,
    entry?.layer,
    ...(Array.isArray(entry?.tags) ? entry.tags : []),
    normalizeOptionalText(entry?.payload?.field),
  ].filter(Boolean);

  if (detailRetentionScore > 0.35) {
    parts.push(entry?.content);
    parts.push(
      ...Object.values(entry?.payload || {}).filter((value) => typeof value === "string")
    );
  }

  return parts.filter(Boolean).join(" ");
}

export function buildPassportCognitiveBias(
  entry = {},
  {
    currentGoal = null,
    queryText = null,
    cognitiveState = null,
    referenceTime = now(),
  } = {}
) {
  const layer = normalizeOptionalText(entry?.layer) ?? null;
  const kind = normalizeOptionalText(entry?.kind) ?? null;
  const field = normalizeOptionalText(entry?.payload?.field) ?? null;
  const searchText = buildPassportMemorySearchText(entry);
  const goalSupportScore = Math.max(
    compareTextSimilarity(searchText, currentGoal),
    compareTextSimilarity(field, currentGoal)
  );
  const querySupportScore = Math.max(
    compareTextSimilarity(searchText, queryText),
    compareTextSimilarity(field, queryText)
  );
  const taskSupportScore = Math.max(goalSupportScore, querySupportScore);
  const strengthScore = toFiniteNumber(entry?.memoryDynamics?.strengthScore, toFiniteNumber(entry?.salience, 0.5));
  const detailRetentionScore = toFiniteNumber(entry?.memoryDynamics?.detailRetentionScore, 1);
  const staleTraceScore = clampUnitInterval(
    (Math.min(1.5, computePassportMemoryAgeDays(entry, referenceTime)) * 0.24) +
      ((1 - detailRetentionScore) * 0.5) +
      ((1 - strengthScore) * 0.26),
    0
  );
  const conflictTraceScore =
    normalizeOptionalText(entry?.memoryDynamics?.reconsolidationConflictState) === "ambiguous_competition"
      ? clampUnitInterval(0.52 + (toFiniteNumber(entry?.salience, 0.5) * 0.2), 0.52)
      : 0;
  const predictionErrorTraceScore = clampUnitInterval(
    toFiniteNumber(entry?.memoryDynamics?.lastPredictionErrorScore, 0) +
      ((kind === "next_action" || field === "next_action") ? 0.16 : 0),
    0
  );
  const salientAllocatedTraceScore = clampUnitInterval(
    (toFiniteNumber(entry?.memoryDynamics?.allocationBias, 0.5) * 0.54) +
      (toFiniteNumber(entry?.salience, 0.5) * 0.28) +
      (toFiniteNumber(entry?.neuromodulation?.novelty, 0.2) * 0.18),
    0
  );

  const replayTargets = new Set(
    Array.isArray(cognitiveState?.replayOrchestration?.targetTraceClasses)
      ? cognitiveState.replayOrchestration.targetTraceClasses.map((item) => normalizeOptionalText(item)).filter(Boolean)
      : []
  );
  const targetMatches = [];
  let traceClassBoost = 0;

  if (replayTargets.has("conflicting_traces") && conflictTraceScore > 0) {
    traceClassBoost += conflictTraceScore * 0.2;
    targetMatches.push("conflicting_traces");
  }
  if (replayTargets.has("high_prediction_error_traces") && predictionErrorTraceScore > 0) {
    traceClassBoost += predictionErrorTraceScore * 0.18;
    targetMatches.push("high_prediction_error_traces");
  }
  if (replayTargets.has("weak_or_stale_traces") && staleTraceScore > 0) {
    traceClassBoost += staleTraceScore * 0.16;
    targetMatches.push("weak_or_stale_traces");
  }
  if (replayTargets.has("salient_allocated_traces") && salientAllocatedTraceScore > 0) {
    traceClassBoost += salientAllocatedTraceScore * 0.14;
    targetMatches.push("salient_allocated_traces");
  }
  if (replayTargets.has("goal_supporting_traces") && taskSupportScore > 0) {
    traceClassBoost += taskSupportScore * 0.18;
    targetMatches.push("goal_supporting_traces");
  }

  const acetylcholineEncodeBias = clampUnitInterval(cognitiveState?.neuromodulators?.acetylcholineEncodeBias, 0);
  const dopamineRpe = clampUnitInterval(cognitiveState?.neuromodulators?.dopamineRpe, 0);
  const norepinephrineSurprise = clampUnitInterval(cognitiveState?.neuromodulators?.norepinephrineSurprise, 0);
  const serotoninStability = clampUnitInterval(cognitiveState?.neuromodulators?.serotoninStability, 0);
  let modulationBoost = 0;
  if (layer === "working" || layer === "episodic") {
    modulationBoost += acetylcholineEncodeBias * 0.12;
  }
  if (kind === "next_action" || field === "next_action") {
    modulationBoost += dopamineRpe * 0.1;
  }
  if (conflictTraceScore > 0 || predictionErrorTraceScore > 0) {
    modulationBoost += norepinephrineSurprise * 0.08;
  }
  if (layer === "semantic" || normalizeOptionalText(entry?.sourceType) === "verified") {
    modulationBoost += serotoninStability * 0.08;
  }

  const dominantRhythm = normalizeOptionalText(cognitiveState?.oscillationSchedule?.dominantRhythm) ?? null;
  const replayMode = normalizeOptionalText(cognitiveState?.replayOrchestration?.replayMode) ?? null;
  let rhythmBoost = 0;
  if (dominantRhythm === "sharp_wave_ripple_like") {
    rhythmBoost += layer === "working" || layer === "episodic" ? 0.12 : 0.04;
  } else if (dominantRhythm === "theta_like") {
    rhythmBoost += layer === "working" ? 0.1 : field === "next_action" ? 0.06 : 0.03;
  } else if (dominantRhythm === "slow_homeostatic_scaling_like") {
    rhythmBoost += layer === "semantic" ? 0.1 : 0.02;
  }

  let replayModeBoost = 0;
  if (replayMode === "hippocampal_trace_replay") {
    replayModeBoost += layer === "working" || layer === "episodic" ? 0.14 : 0.04;
  } else if (replayMode === "interleaved_theta_ripple") {
    replayModeBoost += layer === "working" || field === "next_action" ? 0.1 : 0.04;
  } else if (replayMode === "homeostatic_down_selection") {
    replayModeBoost += layer === "semantic" ? 0.08 : -0.02;
  }

  const replayProtection = clampUnitInterval(
    traceClassBoost +
      (replayMode === "hippocampal_trace_replay" && (layer === "working" || layer === "episodic") ? 0.12 : 0) +
      (replayMode === "homeostatic_down_selection" && layer === "semantic" ? 0.1 : 0) +
      (serotoninStability * (layer === "semantic" ? 0.16 : 0.06)),
    0
  );
  const forgettingPressure = clampUnitInterval(
    (clampUnitInterval(cognitiveState?.interoceptiveState?.sleepPressure ?? cognitiveState?.sleepPressure, 0) * 0.22) +
      (clampUnitInterval(cognitiveState?.homeostaticPressure, 0) * 0.18) +
      (dominantRhythm === "slow_homeostatic_scaling_like" ? 0.14 : dominantRhythm === "sharp_wave_ripple_like" ? 0.08 : 0.04) +
      (staleTraceScore * 0.16) -
      (replayProtection * 0.22),
    0
  );

  return {
    goalSupportScore: Number(goalSupportScore.toFixed(2)),
    querySupportScore: Number(querySupportScore.toFixed(2)),
    taskSupportScore: Number(taskSupportScore.toFixed(2)),
    staleTraceScore: Number(staleTraceScore.toFixed(2)),
    conflictTraceScore: Number(conflictTraceScore.toFixed(2)),
    predictionErrorTraceScore: Number(predictionErrorTraceScore.toFixed(2)),
    salientAllocatedTraceScore: Number(salientAllocatedTraceScore.toFixed(2)),
    traceClassBoost: Number(traceClassBoost.toFixed(2)),
    modulationBoost: Number(modulationBoost.toFixed(2)),
    rhythmBoost: Number(rhythmBoost.toFixed(2)),
    replayModeBoost: Number(replayModeBoost.toFixed(2)),
    replayProtection: Number(replayProtection.toFixed(2)),
    forgettingPressure: Number(forgettingPressure.toFixed(2)),
    dominantRhythm,
    replayMode,
    targetMatches,
  };
}

export function scorePassportMemoryRelevance(entry, queryText, { currentGoal = null, cognitiveState = null } = {}) {
  if (!queryText) {
    return 0;
  }

  const text = buildPassportMemorySearchText(entry);

  const baseScore = compareTextSimilarity(text, queryText);
  const salienceBoost = (normalizePassportMemoryUnitScore(entry.salience, 0.5) ?? 0.5) * 0.25;
  const confidenceBoost = (normalizePassportMemoryUnitScore(entry.confidence, 0.5) ?? 0.5) * 0.1;
  const detailRetentionScore = Math.max(0.15, toFiniteNumber(entry?.memoryDynamics?.detailRetentionScore, 1));
  const cognitiveBias = buildPassportCognitiveBias(entry, {
    currentGoal,
    queryText,
    cognitiveState,
  });
  return Number(
    (
      baseScore *
      (
        1 +
        salienceBoost +
        confidenceBoost +
        (cognitiveBias.taskSupportScore * 0.12) +
        cognitiveBias.traceClassBoost +
        cognitiveBias.modulationBoost +
        cognitiveBias.rhythmBoost +
        cognitiveBias.replayModeBoost
      ) *
      detailRetentionScore
    ).toFixed(4)
  );
}

export function getPassportMemoryPatternKey(entry) {
  return (
    normalizeOptionalText(entry?.patternKey) ??
    normalizeOptionalText(entry?.payload?.patternKey) ??
    null
  );
}

export function getPassportMemorySeparationKey(entry) {
  return (
    normalizeOptionalText(entry?.separationKey) ??
    normalizeOptionalText(entry?.payload?.separationKey) ??
    getPassportMemoryPatternKey(entry) ??
    null
  );
}

export function selectPatternSeparatedPassportMemories(entries = [], limit = 6) {
  const selected = [];
  const selectedIds = new Set();
  const seenSeparationKeys = new Set();

  for (const entry of entries) {
    if (!entry?.passportMemoryId || selectedIds.has(entry.passportMemoryId)) {
      continue;
    }
    const separationKey = getPassportMemorySeparationKey(entry);
    if (separationKey && seenSeparationKeys.has(separationKey)) {
      continue;
    }
    selected.push(entry);
    selectedIds.add(entry.passportMemoryId);
    if (separationKey) {
      seenSeparationKeys.add(separationKey);
    }
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const entry of entries) {
    if (!entry?.passportMemoryId || selectedIds.has(entry.passportMemoryId)) {
      continue;
    }
    selected.push(entry);
    selectedIds.add(entry.passportMemoryId);
    if (selected.length >= limit) {
      return selected;
    }
  }

  return selected;
}

export function completePassportMemoryPatterns(
  allEntries = [],
  seedEntries = [],
  { maxExtra = DEFAULT_MEMORY_PATTERN_COMPLETION_EXTRA } = {}
) {
  const seedIds = new Set(seedEntries.map((entry) => entry?.passportMemoryId).filter(Boolean));
  const seedPatternKeys = new Set(seedEntries.map((entry) => getPassportMemoryPatternKey(entry)).filter(Boolean));
  const seedBoundaryLabels = new Set(seedEntries.map((entry) => normalizeOptionalText(entry?.boundaryLabel)).filter(Boolean));

  return allEntries
    .filter((entry) => entry?.passportMemoryId && !seedIds.has(entry.passportMemoryId))
    .filter((entry) => {
      const patternKey = getPassportMemoryPatternKey(entry);
      const boundaryLabel = normalizeOptionalText(entry?.boundaryLabel) ?? null;
      return (patternKey && seedPatternKeys.has(patternKey)) || (boundaryLabel && seedBoundaryLabels.has(boundaryLabel));
    })
    .sort((left, right) => {
      const leftScore =
        (toFiniteNumber(left?.salience, 0.5) * 0.45) +
        (toFiniteNumber(left?.confidence, 0.5) * 0.25) +
        (toFiniteNumber(left?.memoryDynamics?.strengthScore, 0.5) * 0.3);
      const rightScore =
        (toFiniteNumber(right?.salience, 0.5) * 0.45) +
        (toFiniteNumber(right?.confidence, 0.5) * 0.25) +
        (toFiniteNumber(right?.memoryDynamics?.strengthScore, 0.5) * 0.3);
      return rightScore - leftScore || (right?.recordedAt || "").localeCompare(left?.recordedAt || "");
    })
    .slice(0, Math.max(0, Math.floor(toFiniteNumber(maxExtra, DEFAULT_MEMORY_PATTERN_COMPLETION_EXTRA))));
}

export function mergeUniquePassportMemories(entries = [], limit = DEFAULT_PASSPORT_MEMORY_LIMIT) {
  const merged = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry?.passportMemoryId || seen.has(entry.passportMemoryId)) {
      continue;
    }
    merged.push(entry);
    seen.add(entry.passportMemoryId);
    if (merged.length >= limit) {
      break;
    }
  }
  return merged;
}

export function buildPassportMemoryRetrievalCandidates(
  entries = [],
  queryText = null,
  fallbackLimit = 8,
  { currentGoal = null, cognitiveState = null } = {}
) {
  const normalizedQuery = normalizeOptionalText(queryText) ?? null;
  if (normalizedQuery) {
    return entries
      .map((entry) => ({ entry, score: scorePassportMemoryRelevance(entry, normalizedQuery, { currentGoal, cognitiveState }) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        const strengthDelta =
          toFiniteNumber(right?.entry?.memoryDynamics?.strengthScore, 0.5) -
          toFiniteNumber(left?.entry?.memoryDynamics?.strengthScore, 0.5);
        return right.score - left.score || strengthDelta || (right.entry?.recordedAt || "").localeCompare(left.entry?.recordedAt || "");
      })
      .map((item) => item.entry);
  }

  return [...entries]
    .sort((left, right) => (right.recordedAt || "").localeCompare(left.recordedAt || ""))
    .slice(0, Math.max(1, Math.floor(toFiniteNumber(fallbackLimit, 8))));
}

import {
  cloneJson,
  normalizeComparableText,
  normalizeOptionalText,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  buildPassportCognitiveBias,
  computePassportMemoryAgeDays,
} from "./ledger-passport-memory-retrieval.js";
import {
  computePassportSourceTrustScore,
  extractPassportMemoryComparableValue,
  inferPassportReconsolidationWindowHours,
  isPassportMemoryActive,
  isPassportMemoryDestabilized,
  normalizePassportMemoryLayer,
} from "./ledger-passport-memory-rules.js";
import {
  normalizePassportMemoryRecord,
} from "./ledger-passport-memory-record.js";
import {
  runPassportReplayConsolidationCycle,
} from "./ledger-passport-memory-replay.js";
import {
  normalizeVerificationBindingValue,
} from "./proposition-graph.js";

const DEFAULT_MEMORY_FORGETTING_RETAIN_COUNT = 8;
const DEFAULT_WORKING_MEMORY_FORGET_AGE_DAYS = 2;
const DEFAULT_EPISODIC_MEMORY_FORGET_AGE_DAYS = 30;
const DEFAULT_SEMANTIC_MEMORY_FORGET_AGE_DAYS = 180;
const DEFAULT_LAYER_HOMEOSTATIC_TARGETS = {
  working: 0.48,
  episodic: 0.58,
  semantic: 0.68,
  profile: 0.74,
  ledger: 0.8,
};
const DEFAULT_RECONSOLIDATION_VALUE_WIN_MARGIN = 0.12;
const DEFAULT_RECONSOLIDATION_AMBIGUITY_MARGIN = 0.06;

function requireDependency(deps = {}, name) {
  const dependency = deps?.[name];
  if (typeof dependency !== "function") {
    throw new TypeError(`${name} dependency is required`);
  }
  return dependency;
}

export function computeTemporalDecayMetrics(entry, referenceTime = now(), { cognitiveState = null } = {}) {
  const ageDays = computePassportMemoryAgeDays(entry, referenceTime);
  const salienceScore = toFiniteNumber(entry?.memoryDynamics?.salienceScore, entry?.salience ?? 0.5);
  const confidenceScore = toFiniteNumber(entry?.memoryDynamics?.confidenceScore, entry?.confidence ?? 0.5);
  const baseStrength = toFiniteNumber(entry?.memoryDynamics?.strengthScore, (salienceScore * 0.6) + (confidenceScore * 0.4));
  const cognitiveBias = buildPassportCognitiveBias(entry, {
    cognitiveState,
    referenceTime,
  });
  const decayRate = Math.max(
    0.01,
    toFiniteNumber(entry?.memoryDynamics?.decayRate, 0.08) +
      (cognitiveBias.forgettingPressure * 0.06) -
      (cognitiveBias.replayProtection * 0.05)
  );
  const recallBoost = Math.min(0.35, Math.floor(toFiniteNumber(entry?.memoryDynamics?.recallCount, 0)) * 0.04);
  const recallSuccessBoost = Math.min(0.2, Math.floor(toFiniteNumber(entry?.memoryDynamics?.recallSuccessCount, 0)) * 0.03);
  const decayedStrength = Math.max(0.02, Math.min(1, (baseStrength * Math.exp(-decayRate * ageDays)) + recallBoost + recallSuccessBoost));
  const detailDecayMultiplier =
    entry?.layer === "working"
      ? 1.8
      : entry?.layer === "episodic"
        ? 1.25
        : entry?.layer === "semantic"
          ? 0.65
          : 0.45;
  const tunedDetailDecayMultiplier = Math.max(
    0.28,
    detailDecayMultiplier * (1 + (cognitiveBias.forgettingPressure * 0.4) - (cognitiveBias.replayProtection * 0.24))
  );
  const detailRetentionScore = Math.max(
    0.05,
    Math.min(1, Math.exp(-(decayRate * tunedDetailDecayMultiplier) * ageDays) + (recallSuccessBoost * 0.5))
  );
  const retentionBand =
    detailRetentionScore > 0.8
      ? "vivid"
      : detailRetentionScore > 0.58
        ? "clear"
        : detailRetentionScore > 0.34
          ? "gist_only"
          : "faded";
  return {
    ageDays: Number(ageDays.toFixed(2)),
    decayedStrength: Number(decayedStrength.toFixed(2)),
    detailRetentionScore: Number(detailRetentionScore.toFixed(2)),
    retentionBand,
    cognitiveDecayBias: {
      forgettingPressure: cognitiveBias.forgettingPressure,
      replayProtection: cognitiveBias.replayProtection,
      dominantRhythm: cognitiveBias.dominantRhythm,
      replayMode: cognitiveBias.replayMode,
      targetMatches: cognitiveBias.targetMatches,
    },
  };
}

export function applyTemporalDecayToPassportMemories(
  store,
  agentId,
  { sourceWindowId = null, referenceTime = now(), cognitiveState = null } = {},
  deps = {}
) {
  const appendEvent = requireDependency(deps, "appendEvent");
  const affectedMemoryIds = [];
  for (const entry of store.passportMemories || []) {
    const normalizedStatus = normalizeOptionalText(entry?.status) ?? "";
    const decayedBookkeepingGap =
      normalizedStatus === "decayed" &&
      (!normalizeOptionalText(entry?.memoryDynamics?.forgettingReason) || !entry?.memoryDynamics?.lastForgettingThresholds);
    if (entry.agentId !== agentId || (!isPassportMemoryActive(entry) && !decayedBookkeepingGap)) {
      continue;
    }
    if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
      entry.memoryDynamics = {};
    }
    const decay = computeTemporalDecayMetrics(entry, referenceTime, { cognitiveState });
    entry.memoryDynamics.ageDays = decay.ageDays;
    entry.memoryDynamics.strengthScore = decay.decayedStrength;
    entry.memoryDynamics.detailRetentionScore = decay.detailRetentionScore;
    entry.memoryDynamics.retentionBand = decay.retentionBand;
    entry.memoryDynamics.lastForgettingSignal = decay.cognitiveDecayBias;
    entry.memoryDynamics.lastDecayAppliedAt = referenceTime;
    if (decay.decayedStrength < 0.12 && entry.layer === "working") {
      entry.memoryDynamics.decaySuggestedStatus = "decayed";
      entry.memoryDynamics.decaySuggestedAt = referenceTime;
    } else {
      delete entry.memoryDynamics.decaySuggestedStatus;
      delete entry.memoryDynamics.decaySuggestedAt;
    }
    affectedMemoryIds.push(entry.passportMemoryId);
  }

  appendEvent(store, "passport_memory_decay_applied", {
    agentId,
    affectedCount: affectedMemoryIds.length,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
  });

  return {
    affectedMemoryIds,
    affectedCount: affectedMemoryIds.length,
    referenceTime,
  };
}

export function applyPassportMemoryHomeostaticScaling(store, agentId, deps = {}) {
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const scaledMemoryIds = [];

  for (const [layer, targetMean] of Object.entries(DEFAULT_LAYER_HOMEOSTATIC_TARGETS)) {
    const entries = listAgentPassportMemories(store, agentId, { layer }).filter((entry) => isPassportMemoryActive(entry));
    if (entries.length === 0) {
      continue;
    }
    const currentMean =
      entries.reduce((sum, entry) => sum + toFiniteNumber(entry?.memoryDynamics?.strengthScore, toFiniteNumber(entry?.salience, 0.5)), 0) /
      entries.length;
    if (!Number.isFinite(currentMean) || currentMean <= 0) {
      continue;
    }
    const rawScale = targetMean / currentMean;
    const clampedScale = Math.max(0.82, Math.min(1.18, rawScale));

    for (const entry of entries) {
      if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
        entry.memoryDynamics = {};
      }
      entry.memoryDynamics.homeostaticScale = Number(clampedScale.toFixed(2));
      entry.memoryDynamics.strengthScore = Number(
        Math.max(0, Math.min(1, toFiniteNumber(entry.memoryDynamics.strengthScore, toFiniteNumber(entry.salience, 0.5)) * clampedScale)).toFixed(2)
      );
      entry.memoryDynamics.salienceScore = Number(
        Math.max(0, Math.min(1, toFiniteNumber(entry.memoryDynamics.salienceScore, toFiniteNumber(entry.salience, 0.5)) * ((clampedScale + 1) / 2))).toFixed(2)
      );
      scaledMemoryIds.push(entry.passportMemoryId);
    }
  }

  return {
    scaledMemoryIds,
    scaledCount: scaledMemoryIds.length,
  };
}

export function applyAdaptivePassportMemoryForgetting(
  store,
  agentId,
  {
    referenceTime = now(),
    cognitiveState = null,
  } = {},
  deps = {}
) {
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const forgottenMemoryIds = [];
  const decayedMemoryIds = [];
  const protectedWorkingIds = new Set(
    listAgentPassportMemories(store, agentId, { layer: "working" })
      .filter((entry) => isPassportMemoryActive(entry))
      .slice(-DEFAULT_MEMORY_FORGETTING_RETAIN_COUNT)
      .map((entry) => entry.passportMemoryId)
      .filter(Boolean)
  );

  for (const entry of store.passportMemories || []) {
    const normalizedStatus = normalizeOptionalText(entry?.status) ?? "";
    const decayedBookkeepingGap =
      normalizedStatus === "decayed" &&
      (!normalizeOptionalText(entry?.memoryDynamics?.forgettingReason) || !entry?.memoryDynamics?.lastForgettingThresholds);
    if (entry.agentId !== agentId || (!isPassportMemoryActive(entry) && !decayedBookkeepingGap)) {
      continue;
    }
    const ageDays = toFiniteNumber(entry?.memoryDynamics?.ageDays, 0);
    const detailRetentionScore = toFiniteNumber(entry?.memoryDynamics?.detailRetentionScore, 1);
    const strengthScore = toFiniteNumber(entry?.memoryDynamics?.strengthScore, 1);
    const recallCount = Math.floor(toFiniteNumber(entry?.memoryDynamics?.recallCount, 0));
    const promotionCount = Math.floor(toFiniteNumber(entry?.memoryDynamics?.promotionCount, 0));
    const cognitiveBias = buildPassportCognitiveBias(entry, {
      cognitiveState,
      referenceTime,
    });
    const detailThresholdShift = (cognitiveBias.forgettingPressure * 0.08) - (cognitiveBias.replayProtection * 0.12);
    const strengthThresholdShift = (cognitiveBias.forgettingPressure * 0.06) - (cognitiveBias.replayProtection * 0.1);
    const workingDetailThreshold = 0.42 + detailThresholdShift;
    const workingStrengthThreshold = 0.34 + strengthThresholdShift;
    const episodicDetailThreshold = 0.32 + detailThresholdShift;
    const episodicStrengthThreshold = 0.28 + strengthThresholdShift;
    const semanticDetailThreshold = 0.24 + detailThresholdShift;
    const semanticStrengthThreshold = 0.22 + strengthThresholdShift;
    const decaySuggested =
      entry.layer === "working" && normalizeOptionalText(entry?.memoryDynamics?.decaySuggestedStatus) === "decayed";

    let nextStatus = null;
    let forgettingReason = "adaptive_forgetting";
    if (
      entry.layer === "working" &&
      !protectedWorkingIds.has(entry.passportMemoryId) &&
      ageDays >= DEFAULT_WORKING_MEMORY_FORGET_AGE_DAYS &&
      detailRetentionScore < workingDetailThreshold &&
      strengthScore < workingStrengthThreshold &&
      !["checkpoint_summary", "openneed_flow_checkpoint"].includes(normalizeOptionalText(entry.kind) ?? "")
    ) {
      nextStatus = "forgotten";
      forgettingReason = "adaptive_forgetting";
    } else if (
      entry.layer === "episodic" &&
      ageDays >= DEFAULT_EPISODIC_MEMORY_FORGET_AGE_DAYS &&
      detailRetentionScore < episodicDetailThreshold &&
      strengthScore < episodicStrengthThreshold &&
      recallCount === 0 &&
      promotionCount === 0
    ) {
      nextStatus = "decayed";
      forgettingReason = "adaptive_forgetting";
    } else if (
      entry.layer === "semantic" &&
      ageDays >= DEFAULT_SEMANTIC_MEMORY_FORGET_AGE_DAYS &&
      detailRetentionScore < semanticDetailThreshold &&
      strengthScore < semanticStrengthThreshold &&
      recallCount === 0 &&
      normalizeOptionalText(entry.sourceType) !== "verified"
    ) {
      nextStatus = "decayed";
      forgettingReason = "adaptive_forgetting";
    } else if (decaySuggested || decayedBookkeepingGap) {
      nextStatus = "decayed";
      forgettingReason = "temporal_decay";
    }

    if (!nextStatus) {
      continue;
    }
    entry.status = nextStatus;
    if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
      entry.memoryDynamics = {};
    }
    entry.memoryDynamics.forgottenAt = referenceTime;
    entry.memoryDynamics.forgettingReason = forgettingReason;
    entry.memoryDynamics.lastForgettingSignal = {
      forgettingPressure: cognitiveBias.forgettingPressure,
      replayProtection: cognitiveBias.replayProtection,
      dominantRhythm: cognitiveBias.dominantRhythm,
      replayMode: cognitiveBias.replayMode,
      targetMatches: cognitiveBias.targetMatches,
    };
    entry.memoryDynamics.lastForgettingThresholds = {
      detailRetention: Number(
        (entry.layer === "working"
          ? workingDetailThreshold
          : entry.layer === "episodic"
            ? episodicDetailThreshold
            : semanticDetailThreshold).toFixed(2)
      ),
      strength: Number(
        (entry.layer === "working"
          ? workingStrengthThreshold
          : entry.layer === "episodic"
            ? episodicStrengthThreshold
          : semanticStrengthThreshold).toFixed(2)
      ),
    };
    delete entry.memoryDynamics.decaySuggestedStatus;
    delete entry.memoryDynamics.decaySuggestedAt;
    if (nextStatus === "forgotten") {
      forgottenMemoryIds.push(entry.passportMemoryId);
    } else {
      decayedMemoryIds.push(entry.passportMemoryId);
    }
  }

  return {
    forgottenMemoryIds,
    decayedMemoryIds,
  };
}

export function computePassportEvidenceCandidateScore(entry, referenceTime = now()) {
  const sourceTrust = computePassportSourceTrustScore(entry?.sourceType);
  const confidence = toFiniteNumber(entry?.confidence, 0.5);
  const strength = toFiniteNumber(entry?.memoryDynamics?.strengthScore, entry?.salience ?? 0.5);
  const salience = toFiniteNumber(entry?.salience, entry?.memoryDynamics?.salienceScore ?? 0.5);
  const novelty = toFiniteNumber(entry?.neuromodulation?.novelty, 0.3);
  const reward = toFiniteNumber(entry?.neuromodulation?.reward, 0.3);
  const social = toFiniteNumber(entry?.neuromodulation?.social, 0.3);
  const ageDays = computePassportMemoryAgeDays(entry, referenceTime);
  const recencyScore = Math.max(0.08, Math.exp(-0.035 * Math.max(0, ageDays)));
  const destabilizedPenalty =
    normalizeOptionalText(entry?.memoryDynamics?.reconsolidationState) === "destabilized"
      ? 0.04
      : 0;
  return Number(
    Math.max(
      0,
      Math.min(
        1.6,
        (
          sourceTrust * 0.3 +
          confidence * 0.24 +
          strength * 0.18 +
          salience * 0.12 +
          recencyScore * 0.08 +
          novelty * 0.04 +
          reward * 0.03 +
          social * 0.03 -
          destabilizedPenalty
        ).toFixed(4)
      )
    )
  );
}

export function buildAgedMemoryAbstraction(entry, { sourceWindowId = null } = {}) {
  if (!entry?.passportMemoryId) {
    return null;
  }
  const retentionBand = normalizeOptionalText(entry?.memoryDynamics?.retentionBand) ?? null;
  if (!["gist_only", "faded"].includes(retentionBand)) {
    return null;
  }
  if (normalizeOptionalText(entry?.memoryDynamics?.abstractedAt)) {
    return null;
  }

  const gistSummary =
    normalizeOptionalText(entry?.summary) ??
    normalizeOptionalText(entry?.payload?.field) ??
    normalizeOptionalText(entry?.kind) ??
    "older memory";
  const abstractedContent = [
    `原始记忆 ${entry.passportMemoryId} 已进入 ${retentionBand} 状态。`,
    `保留概要：${gistSummary}`,
    entry?.layer ? `来源层：${entry.layer}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return normalizePassportMemoryRecord(entry.agentId, {
    layer: entry.layer === "working" ? "episodic" : "semantic",
    kind: "abstracted_memory",
    summary: `抽象记忆：${gistSummary}`,
    content: abstractedContent,
    payload: {
      field: "abstracted_memory",
      sourcePassportMemoryId: entry.passportMemoryId,
      originalKind: entry.kind,
      originalLayer: entry.layer,
      retentionBand,
      gistSummary,
    },
    tags: ["abstracted", "memory_decay", retentionBand],
    sourceWindowId,
    salience: Math.max(0.45, toFiniteNumber(entry?.memoryDynamics?.salienceScore, entry?.salience ?? 0.5)),
    confidence: Math.max(0.62, toFiniteNumber(entry?.memoryDynamics?.confidenceScore, entry?.confidence ?? 0.5)),
    memoryDynamics: {
      decayRate: entry?.layer === "working" ? 0.06 : 0.03,
      consolidationTier: entry?.layer === "working" ? "mid_term" : "long_term",
      strengthScore: Math.max(0.4, toFiniteNumber(entry?.memoryDynamics?.strengthScore, 0.5)),
      promotionRule: "retain_gist",
    },
  });
}

export function deduplicateAbstractedMemories(store, agentId, deps = {}) {
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const activeAbstracted = listAgentPassportMemories(store, agentId)
    .filter((entry) => isPassportMemoryActive(entry))
    .filter((entry) => entry.kind === "abstracted_memory");
  const groups = new Map();
  for (const entry of activeAbstracted) {
    const gist = normalizeOptionalText(entry?.payload?.gistSummary) ?? normalizeOptionalText(entry?.summary) ?? "older memory";
    const originalLayer = normalizeOptionalText(entry?.payload?.originalLayer) ?? normalizeOptionalText(entry?.layer) ?? "semantic";
    const groupKey = `${originalLayer}:${gist}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(entry);
  }

  const mergedMemoryIds = [];
  const retiredMemoryIds = [];
  for (const entries of groups.values()) {
    if (entries.length <= 1) {
      continue;
    }
    entries.sort((left, right) => {
      const leftCount = Array.isArray(left?.payload?.sourcePassportMemoryIds) ? left.payload.sourcePassportMemoryIds.length : 0;
      const rightCount = Array.isArray(right?.payload?.sourcePassportMemoryIds) ? right.payload.sourcePassportMemoryIds.length : 0;
      return rightCount - leftCount || (right.recordedAt || "").localeCompare(left.recordedAt || "");
    });
    const primary = entries[0];
    const mergedSourceIds = new Set([
      normalizeOptionalText(primary?.payload?.sourcePassportMemoryId),
      ...(Array.isArray(primary?.payload?.sourcePassportMemoryIds) ? primary.payload.sourcePassportMemoryIds : []),
    ].filter(Boolean));
    for (const duplicate of entries.slice(1)) {
      mergedMemoryIds.push(duplicate.passportMemoryId);
      duplicate.status = "superseded";
      retiredMemoryIds.push(duplicate.passportMemoryId);
      const duplicateSources = [
        normalizeOptionalText(duplicate?.payload?.sourcePassportMemoryId),
        ...(Array.isArray(duplicate?.payload?.sourcePassportMemoryIds) ? duplicate.payload.sourcePassportMemoryIds : []),
      ].filter(Boolean);
      for (const sourceId of duplicateSources) {
        mergedSourceIds.add(sourceId);
      }
    }
    primary.payload.sourcePassportMemoryIds = Array.from(mergedSourceIds);
    primary.content = [
      `原始记忆已进入 ${normalizeOptionalText(primary?.payload?.retentionBand) ?? "aged"} 状态。`,
      `保留概要：${normalizeOptionalText(primary?.payload?.gistSummary) ?? normalizeOptionalText(primary?.summary) ?? "older memory"}`,
      `聚合来源：${mergedSourceIds.size} 条`,
      normalizeOptionalText(primary?.payload?.originalLayer) ? `来源层：${primary.payload.originalLayer}` : null,
    ].filter(Boolean).join("\n");
  }

  return {
    mergedMemoryIds,
    retiredMemoryIds,
  };
}

export function applyPassportMemoryReconsolidationCycle(
  store,
  agentId,
  {
    referenceTime = now(),
    currentGoal = null,
    cognitiveState = null,
  } = {},
  deps = {}
) {
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const buildPassportMemoryConflictKey = requireDependency(deps, "buildPassportMemoryConflictKey");
  const restabilizedMemoryIds = [];
  const updatedMemoryIds = [];
  const linkCountByMemory = {};
  const activeEntries = listAgentPassportMemories(store, agentId).filter((entry) => isPassportMemoryActive(entry));

  for (const entry of activeEntries) {
    if (!isPassportMemoryDestabilized(entry, referenceTime)) {
      continue;
    }

    const reactivatedAt =
      normalizeOptionalText(entry?.memoryDynamics?.destabilizedAt) ??
      normalizeOptionalText(entry?.memoryDynamics?.lastReactivatedAt) ??
      normalizeOptionalText(entry?.memoryDynamics?.lastRecalledAt) ??
      normalizeOptionalText(entry?.recordedAt) ??
      referenceTime;
    const reactivatedMs = Date.parse(reactivatedAt);
    const recordedMs = Date.parse(normalizeOptionalText(entry?.recordedAt) ?? "");
    const reconWindowHours = inferPassportReconsolidationWindowHours(entry);
    const evidenceLookbackMs = Math.max(
      Number.isFinite(recordedMs) ? recordedMs : 0,
      Number.isFinite(reactivatedMs)
        ? reactivatedMs - (Math.max(1, reconWindowHours) * 60 * 60 * 1000)
        : 0
    );
    const relatedEvidence = activeEntries
      .filter((candidate) => candidate.passportMemoryId !== entry.passportMemoryId)
      .filter((candidate) => {
        const candidateRecordedMs = Date.parse(candidate.recordedAt || "");
        if (!Number.isFinite(candidateRecordedMs) || candidateRecordedMs < evidenceLookbackMs) {
          return false;
        }
        const sameField =
          normalizeOptionalText(candidate?.payload?.field) &&
          normalizeOptionalText(candidate?.payload?.field) === normalizeOptionalText(entry?.payload?.field);
        const samePattern =
          normalizeOptionalText(candidate?.patternKey) &&
          normalizeOptionalText(candidate?.patternKey) === normalizeOptionalText(entry?.patternKey);
        const sameSeparation =
          normalizeOptionalText(candidate?.separationKey) &&
          normalizeOptionalText(candidate?.separationKey) === normalizeOptionalText(entry?.separationKey);
        return sameField || samePattern || sameSeparation;
      })
      .sort((left, right) => {
        const confidenceDelta = toFiniteNumber(right?.confidence, 0.5) - toFiniteNumber(left?.confidence, 0.5);
        if (confidenceDelta !== 0) {
          return confidenceDelta;
        }
        return (right.recordedAt || "").localeCompare(left.recordedAt || "");
      })
      .slice(0, 4);

    const evidenceIds = relatedEvidence.map((candidate) => candidate.passportMemoryId).filter(Boolean);
    const evidenceConfidence =
      relatedEvidence.length > 0
        ? relatedEvidence.reduce((sum, candidate) => sum + toFiniteNumber(candidate?.confidence, 0.5), 0) / relatedEvidence.length
        : null;
    const evidenceStrength =
      relatedEvidence.length > 0
        ? relatedEvidence.reduce((sum, candidate) => sum + toFiniteNumber(candidate?.memoryDynamics?.strengthScore, 0.5), 0) /
          relatedEvidence.length
        : null;
    const currentComparableValue = extractPassportMemoryComparableValue(entry);
    const normalizedCurrentComparableValue = normalizeComparableText(
      normalizeVerificationBindingValue(currentComparableValue)
    );
    const currentTrustScore =
      (computePassportSourceTrustScore(entry.sourceType) * 0.55) +
      (toFiniteNumber(entry.confidence, 0.5) * 0.45);
    const currentSupportScore = computePassportEvidenceCandidateScore(entry, referenceTime);
    const evidenceClusters = new Map();
    const registerEvidenceCluster = (candidate, { includesCurrent = false, supportScore = 0 } = {}) => {
      const comparableValue = includesCurrent ? currentComparableValue : extractPassportMemoryComparableValue(candidate);
      const normalizedComparableValue = normalizeComparableText(
        normalizeVerificationBindingValue(comparableValue)
      );
      const clusterKey =
        normalizedComparableValue ||
        (includesCurrent ? `current:${entry.passportMemoryId}` : `memory:${candidate?.passportMemoryId}`);
      if (!evidenceClusters.has(clusterKey)) {
        evidenceClusters.set(clusterKey, {
          clusterKey,
          comparableValue: cloneJson(comparableValue),
          normalizedComparableValue,
          includesCurrent: false,
          supportScoreSum: 0,
          sourceTrustScoreSum: 0,
          confidenceSum: 0,
          count: 0,
          entries: [],
        });
      }
      const cluster = evidenceClusters.get(clusterKey);
      cluster.includesCurrent = cluster.includesCurrent || includesCurrent;
      cluster.supportScoreSum += supportScore;
      cluster.sourceTrustScoreSum += computePassportSourceTrustScore(
        includesCurrent ? entry.sourceType : candidate?.sourceType
      );
      cluster.confidenceSum += toFiniteNumber(includesCurrent ? entry.confidence : candidate?.confidence, 0.5);
      cluster.count += 1;
      cluster.entries.push({
        passportMemoryId: includesCurrent ? entry.passportMemoryId : candidate?.passportMemoryId,
        summary: includesCurrent ? entry.summary : candidate?.summary,
        content: includesCurrent ? entry.content : candidate?.content,
        sourceType: includesCurrent ? entry.sourceType : candidate?.sourceType,
        confidence: includesCurrent ? entry.confidence : candidate?.confidence,
        supportScore,
      });
    };

    registerEvidenceCluster(entry, { includesCurrent: true, supportScore: currentSupportScore });
    for (const candidate of relatedEvidence) {
      registerEvidenceCluster(candidate, {
        includesCurrent: false,
        supportScore: computePassportEvidenceCandidateScore(candidate, referenceTime),
      });
    }

    const rankedClusters = Array.from(evidenceClusters.values())
      .map((cluster) => {
        const supportScore = Number(
          (
            cluster.supportScoreSum +
            Math.min(0.18, Math.log1p(cluster.count) * 0.07)
          ).toFixed(4)
        );
        const averageTrustScore =
          cluster.count > 0 ? Number((cluster.sourceTrustScoreSum / cluster.count).toFixed(4)) : 0;
        const averageConfidence =
          cluster.count > 0 ? Number((cluster.confidenceSum / cluster.count).toFixed(4)) : 0;
        const representative = [...cluster.entries].sort(
          (left, right) => right.supportScore - left.supportScore || (toFiniteNumber(right.confidence, 0.5) - toFiniteNumber(left.confidence, 0.5))
        )[0] ?? null;
        return {
          ...cluster,
          aggregateScore: supportScore,
          dominantTrustScore: Number(((averageTrustScore * 0.58) + (averageConfidence * 0.42)).toFixed(4)),
          representative,
        };
      })
      .sort((left, right) => right.aggregateScore - left.aggregateScore || right.dominantTrustScore - left.dominantTrustScore);

    const topCluster = rankedClusters[0] ?? null;
    const secondCluster = rankedClusters[1] ?? null;
    const currentCluster =
      rankedClusters.find((cluster) => cluster.includesCurrent) ??
      topCluster;
    const bestAlternativeCluster =
      rankedClusters.find((cluster) => !cluster.includesCurrent) ?? null;
    const currentClusterScore = currentCluster?.aggregateScore ?? currentSupportScore;
    const topMargin = topCluster ? topCluster.aggregateScore - (secondCluster?.aggregateScore ?? 0) : 0;
    const alternativeMargin =
      currentCluster && bestAlternativeCluster
        ? currentCluster.aggregateScore - bestAlternativeCluster.aggregateScore
        : null;
    const topClusterDiffers =
      Boolean(topCluster) &&
      !topCluster.includesCurrent &&
      Boolean(topCluster.normalizedComparableValue) &&
      Boolean(normalizedCurrentComparableValue) &&
      topCluster.normalizedComparableValue !== normalizedCurrentComparableValue;
    const predictionErrorScore = topClusterDiffers
      ? Number(
          Math.max(
            0,
            Math.min(
              1,
              (
                ((topCluster.aggregateScore - currentClusterScore) * 0.72) +
                (Math.max(0, topMargin) * 0.28) +
                0.12
              ).toFixed(4)
            )
          )
        )
      : Number(
          Math.max(
            0,
            Math.min(
              1,
              ((Math.max(0, (bestAlternativeCluster?.aggregateScore ?? 0) - (currentCluster?.aggregateScore ?? 0)) * 0.4)).toFixed(4)
            )
          )
        );
    const cognitiveBias = buildPassportCognitiveBias(entry, {
      currentGoal,
      cognitiveState,
      referenceTime,
    });
    const dynamicValueWinMargin = Number(
      Math.max(
        0.05,
        Math.min(
          0.2,
          (
            DEFAULT_RECONSOLIDATION_VALUE_WIN_MARGIN -
            (cognitiveBias.conflictTraceScore * 0.04) -
            (cognitiveBias.predictionErrorTraceScore * 0.03) +
            (cognitiveBias.replayProtection * 0.02)
          )
        )
      ).toFixed(4)
    );
    const dynamicAmbiguityMargin = Number(
      Math.max(
        0.03,
        Math.min(
          0.14,
          (
            DEFAULT_RECONSOLIDATION_AMBIGUITY_MARGIN -
            (cognitiveBias.conflictTraceScore * 0.02) -
            (cognitiveBias.predictionErrorTraceScore * 0.01) +
            (cognitiveBias.goalSupportScore * 0.01)
          )
        )
      ).toFixed(4)
    );
    const shouldRewriteFromEvidence =
      Boolean(topCluster) &&
      topClusterDiffers &&
      topCluster.aggregateScore >= currentClusterScore + dynamicValueWinMargin &&
      topMargin >= dynamicAmbiguityMargin &&
      topCluster.dominantTrustScore >= currentTrustScore + 0.05 &&
      normalizePassportMemoryLayer(entry.layer) !== "ledger";
    const ambiguousCompetition =
      Boolean(bestAlternativeCluster) &&
      !shouldRewriteFromEvidence &&
      (
        (topClusterDiffers && topCluster && topCluster.aggregateScore > currentClusterScore) ||
        (alternativeMargin != null && alternativeMargin < dynamicAmbiguityMargin) ||
        topMargin < dynamicAmbiguityMargin
      );
    const strongestEvidence = topCluster?.representative
      ? relatedEvidence.find((candidate) => candidate.passportMemoryId === topCluster.representative.passportMemoryId) ?? null
      : null;

    if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
      entry.memoryDynamics = {};
    }
    entry.memoryDynamics.reconsolidationCount =
      Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.reconsolidationCount, 0))) + 1;
    entry.memoryDynamics.lastReconsolidatedAt = referenceTime;
    entry.memoryDynamics.reconsolidationState = "restabilized";
    entry.memoryDynamics.destabilizedUntil = null;
    entry.memoryDynamics.reconsolidationEvidenceIds = evidenceIds;
    entry.memoryDynamics.lastPredictionErrorScore = predictionErrorScore;
    entry.memoryDynamics.lastPredictionErrorAt = referenceTime;
    entry.memoryDynamics.lastReconsolidationDrivers = {
      goalSupportScore: cognitiveBias.goalSupportScore,
      taskSupportScore: cognitiveBias.taskSupportScore,
      conflictTraceScore: cognitiveBias.conflictTraceScore,
      predictionErrorTraceScore: cognitiveBias.predictionErrorTraceScore,
      replayProtection: cognitiveBias.replayProtection,
      dominantRhythm: cognitiveBias.dominantRhythm,
      replayMode: cognitiveBias.replayMode,
      targetMatches: cognitiveBias.targetMatches,
    };
    entry.memoryDynamics.lastReconsolidationThresholds = {
      valueWinMargin: dynamicValueWinMargin,
      ambiguityMargin: dynamicAmbiguityMargin,
    };
    entry.memoryDynamics.reconsolidationCandidateValues = rankedClusters.slice(0, 4).map((cluster) => ({
      value: cloneJson(cluster.comparableValue),
      aggregateScore: cluster.aggregateScore,
      dominantTrustScore: cluster.dominantTrustScore,
      count: cluster.count,
      includesCurrent: cluster.includesCurrent,
      memoryIds: cluster.entries.map((item) => item.passportMemoryId).filter(Boolean),
    }));
    entry.memoryDynamics.reconsolidationConflictState = ambiguousCompetition ? "ambiguous_competition" : null;
    entry.memoryDynamics.lastReconsolidationOutcome =
      evidenceIds.length > 0 ? "updated_from_linked_evidence" : "restabilized_without_update";

    if (evidenceIds.length > 0) {
      entry.confidence = Number(
        Math.max(
          0,
          Math.min(
            1,
            ((toFiniteNumber(entry.confidence, 0.5) * 0.84) + (toFiniteNumber(evidenceConfidence, 0.5) * 0.16)).toFixed(2)
          )
        )
      );
      entry.memoryDynamics.confidenceScore = entry.confidence;
      entry.memoryDynamics.strengthScore = Number(
        Math.max(
          0,
          Math.min(
            1,
            (
              (toFiniteNumber(entry.memoryDynamics.strengthScore, entry.salience ?? 0.5) * 0.86) +
              (toFiniteNumber(evidenceStrength, 0.5) * 0.14) +
              0.04
            ).toFixed(2)
          )
        )
      );
      if (ambiguousCompetition) {
        entry.confidence = Number(Math.max(0.22, Math.min(1, (entry.confidence - 0.04).toFixed(2))));
        entry.memoryDynamics.confidenceScore = entry.confidence;
        entry.memoryDynamics.lastReconsolidationOutcome = "restabilized_with_competing_evidence";
        if (!entry.payload || typeof entry.payload !== "object") {
          entry.payload = {};
        }
        entry.payload.reconsolidationConflict = {
          recordedAt: referenceTime,
          candidateValues: rankedClusters.slice(0, 4).map((cluster) => ({
            value: cloneJson(cluster.comparableValue),
            aggregateScore: cluster.aggregateScore,
            dominantTrustScore: cluster.dominantTrustScore,
            count: cluster.count,
            includesCurrent: cluster.includesCurrent,
          })),
          predictionErrorScore,
        };
        entry.conflictKey = buildPassportMemoryConflictKey(entry) || entry.conflictKey || null;
        entry.conflictState = {
          conflictId: normalizeOptionalText(entry?.conflictState?.conflictId) ?? null,
          hasConflict: true,
          conflictingMemoryIds: rankedClusters
            .flatMap((cluster) => cluster.entries.map((item) => item.passportMemoryId))
            .filter((memoryId) => memoryId && memoryId !== entry.passportMemoryId)
            .slice(0, 8),
          resolution: "ambiguous_competition",
        };
      }
      if (shouldRewriteFromEvidence) {
        if (!entry.payload || typeof entry.payload !== "object") {
          entry.payload = {};
        }
        const previousComparableValue =
          entry.payload.value ?? entry.content ?? entry.summary ?? null;
        const previousVersions = Array.isArray(entry.payload.reconsolidationPreviousValues)
          ? entry.payload.reconsolidationPreviousValues
          : [];
        previousVersions.push({
          recordedAt: referenceTime,
          value: previousComparableValue,
          sourceType: entry.sourceType || null,
          confidence: entry.confidence ?? null,
        });
        entry.payload.reconsolidationPreviousValues = previousVersions.slice(-6);
        if (strongestEvidence?.payload && Object.prototype.hasOwnProperty.call(strongestEvidence.payload, "value")) {
          entry.payload.value = cloneJson(strongestEvidence.payload.value);
        }
        if (normalizeOptionalText(strongestEvidence?.summary)) {
          entry.summary = normalizeOptionalText(strongestEvidence.summary);
        }
        if (normalizeOptionalText(strongestEvidence?.content)) {
          entry.content = normalizeOptionalText(strongestEvidence.content);
        }
        entry.sourceType = strongestEvidence.sourceType || entry.sourceType;
        entry.memoryDynamics.lastReconsolidationOutcome = "rewritten_from_stronger_evidence";
        entry.memoryDynamics.lastReconsolidatedFromMemoryId = strongestEvidence.passportMemoryId || null;
        entry.memoryDynamics.reconsolidationConflictState = "resolved_by_rewrite";
        entry.conflictState = {
          conflictId: normalizeOptionalText(entry?.conflictState?.conflictId) ?? null,
          hasConflict: false,
          conflictingMemoryIds: [],
          resolution: "rewritten_from_stronger_evidence",
        };
        if (entry.payload && typeof entry.payload === "object") {
          entry.payload.reconsolidationConflict = null;
        }
      }
      updatedMemoryIds.push(entry.passportMemoryId);
    }

    restabilizedMemoryIds.push(entry.passportMemoryId);
    linkCountByMemory[entry.passportMemoryId] = evidenceIds.length;
  }

  return {
    restabilizedMemoryIds,
    updatedMemoryIds,
    linkCountByMemory,
  };
}

export function runPassportMemoryMaintenanceCycle(
  store,
  agent,
  {
    currentGoal = null,
    cognitiveState = null,
    sourceWindowId = null,
    offlineReplayRequested = false,
  } = {},
  deps = {}
) {
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const runPassportOfflineReplayCycle = requireDependency(deps, "runPassportOfflineReplayCycle");
  const decay = applyTemporalDecayToPassportMemories(store, agent.agentId, { sourceWindowId, cognitiveState }, deps);
  const adaptiveForgetting = applyAdaptivePassportMemoryForgetting(store, agent.agentId, { cognitiveState }, deps);
  const homeostaticScaling = applyPassportMemoryHomeostaticScaling(store, agent.agentId, deps);
  const reconsolidation = applyPassportMemoryReconsolidationCycle(store, agent.agentId, {
    currentGoal,
    cognitiveState,
  }, deps);
  const activeWorking = listAgentPassportMemories(store, agent.agentId, { layer: "working" }).filter((entry) => isPassportMemoryActive(entry));
  const activeEpisodic = listAgentPassportMemories(store, agent.agentId, { layer: "episodic" }).filter((entry) => isPassportMemoryActive(entry));
  const activeAbstracted = listAgentPassportMemories(store, agent.agentId)
    .filter((entry) => isPassportMemoryActive(entry))
    .filter((entry) => entry.kind === "abstracted_memory");
  const abstractions = [];

  for (const entry of [...activeWorking, ...activeEpisodic]) {
    const abstraction = buildAgedMemoryAbstraction(entry, { sourceWindowId });
    if (!abstraction) {
      continue;
    }
    const existingAbstraction = activeAbstracted.find((candidate) =>
      normalizeOptionalText(candidate?.payload?.gistSummary) === normalizeOptionalText(abstraction?.payload?.gistSummary) &&
      normalizeOptionalText(candidate?.payload?.originalLayer) === normalizeOptionalText(abstraction?.payload?.originalLayer)
    );
    entry.status = "abstracted";
    entry.memoryDynamics.abstractedAt = now();
    if (existingAbstraction) {
      const sourceIds = new Set([
        normalizeOptionalText(existingAbstraction?.payload?.sourcePassportMemoryId),
        ...(Array.isArray(existingAbstraction?.payload?.sourcePassportMemoryIds)
          ? existingAbstraction.payload.sourcePassportMemoryIds
          : []),
        entry.passportMemoryId,
      ].filter(Boolean));
      existingAbstraction.payload.sourcePassportMemoryIds = Array.from(sourceIds);
      existingAbstraction.content = [
        `原始记忆已进入 ${normalizeOptionalText(existingAbstraction?.payload?.retentionBand) ?? normalizeOptionalText(abstraction?.payload?.retentionBand) ?? "aged"} 状态。`,
        `保留概要：${normalizeOptionalText(existingAbstraction?.payload?.gistSummary) ?? normalizeOptionalText(abstraction?.payload?.gistSummary) ?? "older memory"}`,
        `聚合来源：${sourceIds.size} 条`,
        normalizeOptionalText(existingAbstraction?.payload?.originalLayer)
          ? `来源层：${existingAbstraction.payload.originalLayer}`
          : null,
      ].filter(Boolean).join("\n");
      entry.memoryDynamics.abstractedMemoryId = existingAbstraction.passportMemoryId;
      abstractions.push(existingAbstraction.passportMemoryId);
      continue;
    }
    abstraction.payload.sourcePassportMemoryIds = [entry.passportMemoryId];
    entry.memoryDynamics.abstractedMemoryId = abstraction.passportMemoryId;
    store.passportMemories.push(abstraction);
    activeAbstracted.push(abstraction);
    abstractions.push(abstraction.passportMemoryId);
  }

  const replay = runPassportReplayConsolidationCycle(store, agent, {
    sourceWindowId,
    currentGoal,
    activeWorking,
    activeEpisodic,
  });
  const offlineReplay = runPassportOfflineReplayCycle(store, agent, {
    sourceWindowId,
    currentGoal,
    cognitiveState,
    activeWorking,
    activeEpisodic,
    offlineReplayRequested,
  });
  const abstractedDeduplication = deduplicateAbstractedMemories(store, agent.agentId, deps);

  return {
    decay,
    adaptiveForgetting,
    homeostaticScaling,
    reconsolidation,
    replay,
    offlineReplay,
    abstractedDeduplication,
    forgottenMemoryIds: adaptiveForgetting.forgottenMemoryIds,
    promotedMemoryIds: replay.replayedMemoryIds,
    offlineReplayedMemoryIds: offlineReplay.replayedMemoryIds,
    abstractedMemoryIds: abstractions,
  };
}

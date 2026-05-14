import {
  cloneJson,
  createRecordId,
  normalizeComparableText,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import { inferEpistemicStatus } from "./epistemic-status.js";
import {
  buildPassportEligibilityTrace,
  computePassportAllocationBias,
  defaultPassportMemoryConfidence,
  defaultPassportMemorySalience,
  inferPassportMemoryConsolidationState,
  inferPassportMemorySourceType,
  inferPassportReconsolidationWindowHours,
  normalizePassportMemoryLayer,
  normalizePassportMemoryUnitScore,
  normalizePassportNeuromodulation,
  normalizePassportSourceFeatures,
} from "./ledger-passport-memory-rules.js";

export function derivePassportMemoryPatternKey(layer, payload = {}) {
  const explicit =
    normalizeOptionalText(payload.patternKey) ??
    normalizeOptionalText(payload.payload?.patternKey) ??
    null;
  if (explicit) {
    return explicit;
  }

  const field = normalizeOptionalText(payload.payload?.field) ?? null;
  if (field) {
    return `field:${field}`;
  }

  const boundaryLabel =
    normalizeOptionalText(payload.boundaryLabel) ??
    normalizeOptionalText(payload.payload?.boundaryLabel) ??
    null;
  if (boundaryLabel) {
    return `boundary:${normalizeComparableText(boundaryLabel).slice(0, 96)}`;
  }

  const currentGoal =
    normalizeOptionalText(payload.payload?.currentGoal) ??
    normalizeOptionalText(payload.payload?.goal) ??
    null;
  if (currentGoal) {
    return `goal:${normalizeComparableText(currentGoal).slice(0, 96)}`;
  }

  const tags = normalizeTextList(payload.tags);
  if (tags.length > 0) {
    return `tag:${normalizeComparableText(tags[0]).slice(0, 64)}`;
  }

  const kind = normalizeOptionalText(payload.kind) ?? null;
  return kind ? `kind:${normalizeComparableText(kind).slice(0, 64)}` : `${layer}:generic`;
}

export function derivePassportMemorySeparationKey(layer, payload = {}) {
  const explicit =
    normalizeOptionalText(payload.separationKey) ??
    normalizeOptionalText(payload.payload?.separationKey) ??
    null;
  if (explicit) {
    return explicit;
  }

  const field = normalizeOptionalText(payload.payload?.field) ?? null;
  if (field) {
    return `${layer}:field:${field}`;
  }

  const boundaryLabel =
    normalizeOptionalText(payload.boundaryLabel) ??
    normalizeOptionalText(payload.payload?.boundaryLabel) ??
    null;
  if (boundaryLabel) {
    return `${layer}:boundary:${normalizeComparableText(boundaryLabel).slice(0, 96)}`;
  }

  const sourceWindowId =
    normalizeOptionalText(payload.sourceWindowId) ??
    normalizeOptionalText(payload.recordedByWindowId) ??
    null;
  const kind = normalizeOptionalText(payload.kind) ?? "note";
  if (sourceWindowId) {
    return `${layer}:window:${normalizeComparableText(sourceWindowId).slice(0, 48)}:${normalizeComparableText(kind).slice(0, 48)}`;
  }

  return `${layer}:kind:${normalizeComparableText(kind).slice(0, 64)}`;
}

export function normalizePassportMemoryRecord(agentId, payload = {}) {
  const layer = normalizePassportMemoryLayer(payload.layer);
  const normalizedRecordedAt = normalizeOptionalText(payload.recordedAt) ?? null;
  const parsedRecordedAt = normalizedRecordedAt ? Date.parse(normalizedRecordedAt) : Number.NaN;
  const salience = normalizePassportMemoryUnitScore(payload.salience, defaultPassportMemorySalience(layer, payload));
  const confidence = normalizePassportMemoryUnitScore(payload.confidence, defaultPassportMemoryConfidence(layer, payload));
  const sourceType = inferPassportMemorySourceType(layer, payload);
  const neuromodulation = normalizePassportNeuromodulation(payload);
  const sourceFeatures = normalizePassportSourceFeatures({
    layer,
    payload,
    sourceType,
  });
  const epistemicStatus = inferEpistemicStatus({
    epistemicStatus:
      payload.epistemicStatus ??
      payload.payload?.epistemicStatus ??
      payload.payload?.value?.epistemicStatus ??
      payload.payload?.value?.status ??
      payload.payload?.value?.decisionStatus,
    sourceType,
    field: payload.payload?.field,
    kind: payload.kind,
    verifiedEquivalent: sourceType === "verified",
    value: payload.payload?.value,
    payload,
  });
  const eligibilityTrace = buildPassportEligibilityTrace({
    layer,
    payload,
    salience,
    confidence,
    neuromodulation,
  });
  return {
    passportMemoryId: normalizeOptionalText(payload.passportMemoryId) || createRecordId("pmem"),
    agentId,
    layer,
    kind: normalizeOptionalText(payload.kind) ?? "note",
    summary: normalizeOptionalText(payload.summary) ?? null,
    content: normalizeOptionalText(payload.content) ?? null,
    payload: cloneJson(payload.payload) ?? {},
    tags: normalizeTextList(payload.tags),
    salience,
    confidence,
    sourceType,
    epistemicStatus,
    sourceFeatures,
    consolidationState: inferPassportMemoryConsolidationState(layer, payload),
    neuromodulation,
    boundaryLabel: normalizeOptionalText(payload.boundaryLabel || payload.payload?.boundaryLabel) ?? null,
    patternKey: derivePassportMemoryPatternKey(layer, payload),
    separationKey: derivePassportMemorySeparationKey(layer, payload),
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId || payload.recordedByWindowId) ?? null,
    sourceMessageId: normalizeOptionalText(payload.sourceMessageId) ?? null,
    conflictKey: normalizeOptionalText(payload.conflictKey) ?? null,
    conflictState: cloneJson(payload.conflictState) ?? null,
    memoryDynamics: {
      salienceScore: salience,
      confidenceScore: confidence,
      decayRate: Number(
        Math.max(
          0.01,
          Math.min(
            0.35,
            toFiniteNumber(
              payload.memoryDynamics?.decayRate,
              layer === "working" ? 0.18 : layer === "episodic" ? 0.08 : layer === "semantic" ? 0.04 : 0.02
            )
          )
        ).toFixed(2)
      ),
      recallCount: Math.max(0, Math.floor(toFiniteNumber(payload.memoryDynamics?.recallCount, 0))),
      recallSuccessCount: Math.max(0, Math.floor(toFiniteNumber(payload.memoryDynamics?.recallSuccessCount, 0))),
      lastRecalledAt: normalizeOptionalText(payload.memoryDynamics?.lastRecalledAt) ?? null,
      promotionRule:
        normalizeOptionalText(payload.memoryDynamics?.promotionRule) ??
        (layer === "working"
          ? "promote_to_episodic_or_semantic"
          : layer === "episodic"
            ? "promote_to_semantic"
            : layer === "profile" || layer === "ledger"
              ? "retain_long_term"
              : "observe"),
      consolidationTier:
        normalizeOptionalText(payload.memoryDynamics?.consolidationTier) ??
        (layer === "working" ? "short_term" : layer === "episodic" || layer === "semantic" ? "mid_term" : "long_term"),
      strengthScore: Number(
        Math.max(
          0,
          Math.min(
            1,
            toFiniteNumber(
              payload.memoryDynamics?.strengthScore,
              ((salience ?? 0.5) * 0.6) + ((confidence ?? 0.5) * 0.4)
            )
          )
        ).toFixed(2)
      ),
      promotionCount: Math.max(0, Math.floor(toFiniteNumber(payload.memoryDynamics?.promotionCount, 0))),
      lastConsolidatedAt: normalizeOptionalText(payload.memoryDynamics?.lastConsolidatedAt) ?? null,
      forgottenAt: normalizeOptionalText(payload.memoryDynamics?.forgottenAt) ?? null,
      reactivationCount: Math.max(0, Math.floor(toFiniteNumber(payload.memoryDynamics?.reactivationCount, 0))),
      lastReactivatedAt: normalizeOptionalText(payload.memoryDynamics?.lastReactivatedAt) ?? null,
      destabilizedAt: normalizeOptionalText(payload.memoryDynamics?.destabilizedAt) ?? null,
      destabilizedUntil: normalizeOptionalText(payload.memoryDynamics?.destabilizedUntil) ?? null,
      reconsolidationWindowHours: inferPassportReconsolidationWindowHours({
        layer,
        memoryDynamics: payload.memoryDynamics,
      }),
      reconsolidationCount: Math.max(0, Math.floor(toFiniteNumber(payload.memoryDynamics?.reconsolidationCount, 0))),
      lastReconsolidatedAt: normalizeOptionalText(payload.memoryDynamics?.lastReconsolidatedAt) ?? null,
      reconsolidationState: normalizeOptionalText(payload.memoryDynamics?.reconsolidationState) ?? null,
      lastReconsolidationOutcome: normalizeOptionalText(payload.memoryDynamics?.lastReconsolidationOutcome) ?? null,
      reconsolidationEvidenceIds: normalizeTextList(payload.memoryDynamics?.reconsolidationEvidenceIds),
      lastPredictionErrorScore: toFiniteNumber(payload.memoryDynamics?.lastPredictionErrorScore, null),
      lastPredictionErrorAt: normalizeOptionalText(payload.memoryDynamics?.lastPredictionErrorAt) ?? null,
      reconsolidationConflictState: normalizeOptionalText(payload.memoryDynamics?.reconsolidationConflictState) ?? null,
      reconsolidationCandidateValues: cloneJson(payload.memoryDynamics?.reconsolidationCandidateValues || []),
      lastReconsolidationDrivers: cloneJson(payload.memoryDynamics?.lastReconsolidationDrivers || null),
      lastReconsolidationThresholds: cloneJson(payload.memoryDynamics?.lastReconsolidationThresholds || null),
      lastPreferenceArbitrationDrivers: cloneJson(payload.memoryDynamics?.lastPreferenceArbitrationDrivers || null),
      lastOfflineReplayDrivers: cloneJson(payload.memoryDynamics?.lastOfflineReplayDrivers || null),
      eligibilityTraceScore: eligibilityTrace.eligibilityTraceScore,
      eligibilityTraceUntil: eligibilityTrace.eligibilityTraceUntil,
      eligibilityWindowHours: eligibilityTrace.eligibilityWindowHours,
      allocationBias: computePassportAllocationBias({ salience, confidence, neuromodulation }),
      realityMonitoringScore: sourceFeatures.realityMonitoringScore,
      internalGenerationRisk: sourceFeatures.internalGenerationRisk,
      homeostaticScale: Number(toFiniteNumber(payload.memoryDynamics?.homeostaticScale, 1).toFixed(2)),
    },
    recordedByAgentId: normalizeOptionalText(payload.recordedByAgentId) ?? agentId,
    recordedByWindowId: normalizeOptionalText(payload.recordedByWindowId || payload.sourceWindowId) ?? null,
    status: normalizeOptionalText(payload.status) ?? "active",
    recordedAt: Number.isFinite(parsedRecordedAt) ? new Date(parsedRecordedAt).toISOString() : now(),
  };
}

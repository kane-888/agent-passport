import {
  normalizeOptionalText,
  normalizeTextList,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  countRuntimeSearchHitsBySource,
  normalizeRuntimeSearchSourceType,
  summarizePromptKnowledgeHit,
} from "./ledger-runtime-search.js";

export function buildContextLocalKnowledgeView(runtimeKnowledge = {}, localKnowledgeHits = [], externalColdMemoryHits = []) {
  const counts = runtimeKnowledge?.counts && typeof runtimeKnowledge.counts === "object" ? runtimeKnowledge.counts : {};
  const retrieval = runtimeKnowledge?.retrieval && typeof runtimeKnowledge.retrieval === "object" ? runtimeKnowledge.retrieval : {};
  const summarizedHits = Array.isArray(localKnowledgeHits)
    ? localKnowledgeHits.map((entry) => summarizePromptKnowledgeHit(entry))
    : [];
  return {
    query: normalizeOptionalText(runtimeKnowledge?.query) ?? null,
    sourceType: normalizeRuntimeSearchSourceType(runtimeKnowledge?.sourceType),
    hits: summarizedHits,
    counts: {
      total: counts.localCorpusTotal ?? summarizedHits.length,
      matched: summarizedHits.length,
      bySource: countRuntimeSearchHitsBySource(summarizedHits),
      localCorpusTotal: counts.localCorpusTotal ?? summarizedHits.length,
      externalCandidateTotal: counts.externalCandidateTotal ?? externalColdMemoryHits.length,
      localMatched: summarizedHits.length,
      externalMatched: externalColdMemoryHits.length,
    },
    suggestedResumeBoundaryId: normalizeOptionalText(runtimeKnowledge?.suggestedResumeBoundaryId) ?? null,
    retrieval: {
      strategy: normalizeOptionalText(retrieval.strategy) ?? null,
      scorer: normalizeOptionalText(retrieval.scorer) ?? null,
      localFirst: retrieval.localFirst ?? true,
      vectorIndexEnabled: retrieval.vectorIndexEnabled ?? null,
      vectorUsed: retrieval.vectorUsed ?? null,
      preferStructuredMemory: retrieval.preferStructuredMemory ?? null,
      preferConversationMinutes: retrieval.preferConversationMinutes ?? null,
      preferCompactBoundaries: retrieval.preferCompactBoundaries ?? null,
      hitCount: summarizedHits.length,
      externalColdMemoryHitCount: externalColdMemoryHits.length,
      maxHits: Number.isFinite(Number(retrieval.maxHits)) ? Math.max(0, Math.floor(Number(retrieval.maxHits))) : null,
    },
  };
}

export function buildContextExternalColdMemoryView(runtimeKnowledge = {}, externalColdMemoryHits = []) {
  const counts = runtimeKnowledge?.counts && typeof runtimeKnowledge.counts === "object" ? runtimeKnowledge.counts : {};
  const retrieval = runtimeKnowledge?.retrieval && typeof runtimeKnowledge.retrieval === "object" ? runtimeKnowledge.retrieval : {};
  const summarizedHits = Array.isArray(externalColdMemoryHits)
    ? externalColdMemoryHits.map((entry) => summarizePromptKnowledgeHit(entry))
    : [];
  return {
    enabled: Boolean(retrieval.externalColdMemoryEnabled),
    provider: normalizeOptionalText(retrieval.externalColdMemoryProvider) ?? null,
    used: Boolean(retrieval.externalColdMemoryUsed),
    method: normalizeOptionalText(retrieval.externalColdMemoryMethod) ?? null,
    candidateOnly: true,
    hitCount: summarizedHits.length,
    error: normalizeOptionalText(retrieval.externalColdMemoryError) ?? null,
    hits: summarizedHits,
    counts: {
      total: counts.externalCandidateTotal ?? summarizedHits.length,
      matched: summarizedHits.length,
      bySource: countRuntimeSearchHitsBySource(summarizedHits),
    },
    hint: "只作候选线索，不覆盖 ledger/profile/runtime 本地参考层，也不写回主记忆。",
  };
}

export function buildContextContinuousCognitiveStateView(cognitiveState = null) {
  if (!cognitiveState || typeof cognitiveState !== "object") {
    return null;
  }
  const bodyLoop =
    cognitiveState.bodyLoop && typeof cognitiveState.bodyLoop === "object"
      ? {
          taskBacklog: toFiniteNumber(cognitiveState.bodyLoop.taskBacklog, null),
          conflictDensity: toFiniteNumber(cognitiveState.bodyLoop.conflictDensity, null),
          humanVetoRate: toFiniteNumber(cognitiveState.bodyLoop.humanVetoRate, null),
          overallLoad: toFiniteNumber(cognitiveState.bodyLoop.overallLoad, null),
        }
      : null;
  const interoceptiveState =
    cognitiveState.interoceptiveState && typeof cognitiveState.interoceptiveState === "object"
      ? {
          sleepPressure: toFiniteNumber(cognitiveState.interoceptiveState.sleepPressure, null),
          allostaticLoad: toFiniteNumber(cognitiveState.interoceptiveState.allostaticLoad, null),
          metabolicStress: toFiniteNumber(cognitiveState.interoceptiveState.metabolicStress, null),
          interoceptivePredictionError: toFiniteNumber(
            cognitiveState.interoceptiveState.interoceptivePredictionError,
            null
          ),
          bodyBudget: toFiniteNumber(cognitiveState.interoceptiveState.bodyBudget, null),
        }
      : null;
  const neuromodulators =
    cognitiveState.neuromodulators && typeof cognitiveState.neuromodulators === "object"
      ? {
          dopamineRpe: toFiniteNumber(cognitiveState.neuromodulators.dopamineRpe, null),
          acetylcholineEncodeBias: toFiniteNumber(cognitiveState.neuromodulators.acetylcholineEncodeBias, null),
          norepinephrineSurprise: toFiniteNumber(cognitiveState.neuromodulators.norepinephrineSurprise, null),
          serotoninStability: toFiniteNumber(cognitiveState.neuromodulators.serotoninStability, null),
          dopaminergicAllocationBias: toFiniteNumber(cognitiveState.neuromodulators.dopaminergicAllocationBias, null),
        }
      : null;
  const oscillationSchedule =
    cognitiveState.oscillationSchedule && typeof cognitiveState.oscillationSchedule === "object"
      ? {
          currentPhase: normalizeOptionalText(cognitiveState.oscillationSchedule.currentPhase) ?? null,
          dominantRhythm: normalizeOptionalText(cognitiveState.oscillationSchedule.dominantRhythm) ?? null,
          nextPhase: normalizeOptionalText(cognitiveState.oscillationSchedule.nextPhase) ?? null,
          transitionReason: normalizeOptionalText(cognitiveState.oscillationSchedule.transitionReason) ?? null,
          replayEligible: cognitiveState.oscillationSchedule.replayEligible ?? null,
          phaseWeights:
            cognitiveState.oscillationSchedule.phaseWeights &&
            typeof cognitiveState.oscillationSchedule.phaseWeights === "object"
              ? {
                  online_theta_like: toFiniteNumber(
                    cognitiveState.oscillationSchedule.phaseWeights.online_theta_like,
                    null
                  ),
                  offline_ripple_like: toFiniteNumber(
                    cognitiveState.oscillationSchedule.phaseWeights.offline_ripple_like,
                    null
                  ),
                  offline_homeostatic: toFiniteNumber(
                    cognitiveState.oscillationSchedule.phaseWeights.offline_homeostatic,
                    null
                  ),
                }
              : null,
        }
      : null;
  const replayOrchestration =
    cognitiveState.replayOrchestration && typeof cognitiveState.replayOrchestration === "object"
      ? {
          shouldReplay: cognitiveState.replayOrchestration.shouldReplay ?? null,
          replayMode: normalizeOptionalText(cognitiveState.replayOrchestration.replayMode) ?? null,
          replayDrive: toFiniteNumber(cognitiveState.replayOrchestration.replayDrive, null),
          consolidationBias: normalizeOptionalText(cognitiveState.replayOrchestration.consolidationBias) ?? null,
          replayWindowHours: toFiniteNumber(cognitiveState.replayOrchestration.replayWindowHours, null),
          gatingReason: normalizeOptionalText(cognitiveState.replayOrchestration.gatingReason) ?? null,
          targetTraceClasses: normalizeTextList(cognitiveState.replayOrchestration.targetTraceClasses).slice(0, 6),
        }
      : null;
  const updatedAt = normalizeOptionalText(cognitiveState.updatedAt || cognitiveState.lastUpdatedAt) ?? null;
  return {
    mode: normalizeOptionalText(cognitiveState.mode) ?? null,
    dominantStage: normalizeOptionalText(cognitiveState.dominantStage) ?? null,
    continuityScore: toFiniteNumber(cognitiveState.continuityScore, null),
    calibrationScore: toFiniteNumber(cognitiveState.calibrationScore, null),
    recoveryReadinessScore: toFiniteNumber(cognitiveState.recoveryReadinessScore, null),
    fatigue: toFiniteNumber(cognitiveState.fatigue, null),
    sleepDebt: toFiniteNumber(cognitiveState.sleepDebt, null),
    uncertainty: toFiniteNumber(cognitiveState.uncertainty, null),
    rewardPredictionError: toFiniteNumber(cognitiveState.rewardPredictionError, null),
    threat: toFiniteNumber(cognitiveState.threat, null),
    novelty: toFiniteNumber(cognitiveState.novelty, null),
    socialSalience: toFiniteNumber(cognitiveState.socialSalience, null),
    homeostaticPressure: toFiniteNumber(cognitiveState.homeostaticPressure, null),
    sleepPressure: toFiniteNumber(cognitiveState.sleepPressure, null),
    dominantRhythm: normalizeOptionalText(cognitiveState.dominantRhythm) ?? null,
    transitionReason: normalizeOptionalText(cognitiveState.transitionReason) ?? null,
    bodyLoop,
    interoceptiveState,
    neuromodulators,
    oscillationSchedule,
    replayOrchestration,
    updatedAt,
    lastUpdatedAt: updatedAt,
  };
}

export function summarizePromptToolResult(entry = {}) {
  return {
    tool: normalizeOptionalText(entry.tool || entry.name) ?? "tool",
    result: normalizeOptionalText(entry.result || entry.output || entry.content || entry.summary) ?? null,
  };
}

export function summarizePromptTranscriptEntry(entry = {}) {
  return {
    transcriptEntryId: entry.transcriptEntryId || null,
    entryType: entry.entryType || null,
    family: entry.family || null,
    role: entry.role || null,
    title: normalizeOptionalText(entry.title) ?? null,
    summary: normalizeOptionalText(entry.summary || entry.content)?.slice(0, 280) ?? null,
    recordedAt: entry.recordedAt || null,
    relatedRunId: entry.relatedRunId || null,
    relatedCompactBoundaryId: entry.relatedCompactBoundaryId || null,
  };
}

import {
  cloneJson,
  normalizeOptionalText,
  normalizeTextList,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  buildEpistemicStatusCounts,
} from "./epistemic-status.js";
import {
  normalizePassportMemoryUnitScore,
  normalizePassportSourceFeatures,
} from "./ledger-passport-memory-rules.js";
import {
  summarizePromptToolResult,
} from "./ledger-context-prompt-views.js";
import {
  summarizePromptKnowledgeHit,
} from "./ledger-runtime-search.js";

export const DEFAULT_REALITY_MONITORING_STRONG_THRESHOLD = 0.62;
export const DEFAULT_REALITY_MONITORING_LOW_THRESHOLD = 0.4;
export const DEFAULT_INTERNAL_GENERATION_RISK_HIGH_THRESHOLD = 0.58;

export function resolvePassportSourceFeatures(candidate = {}) {
  return (
    cloneJson(candidate?.sourceFeatures) ??
    normalizePassportSourceFeatures({
      layer: candidate?.layer,
      payload: candidate,
      sourceType: candidate?.sourceType,
    })
  );
}

export function isExternalLikeSupport(candidate = {}) {
  const sourceFeatures = resolvePassportSourceFeatures(candidate);
  return (
    toFiniteNumber(sourceFeatures?.realityMonitoringScore, candidate?.realityMonitoringScore ?? 0) >=
      DEFAULT_REALITY_MONITORING_STRONG_THRESHOLD &&
    toFiniteNumber(sourceFeatures?.internalGenerationRisk, candidate?.internalGenerationRisk ?? 1) <=
      DEFAULT_INTERNAL_GENERATION_RISK_HIGH_THRESHOLD
  );
}

export function isLowRealitySupport(candidate = {}) {
  const sourceFeatures = resolvePassportSourceFeatures(candidate);
  return (
    toFiniteNumber(sourceFeatures?.realityMonitoringScore, candidate?.realityMonitoringScore ?? 0) <
      DEFAULT_REALITY_MONITORING_LOW_THRESHOLD ||
    toFiniteNumber(sourceFeatures?.internalGenerationRisk, candidate?.internalGenerationRisk ?? 0) >
      DEFAULT_INTERNAL_GENERATION_RISK_HIGH_THRESHOLD
  );
}

export function summarizePromptMemoryEntry(entry = {}) {
  const sourceFeatures = resolvePassportSourceFeatures(entry);
  return {
    id: entry.memoryId || entry.snapshotId || entry.minuteId || entry.decisionId || entry.evidenceRefId || null,
    kind: entry.kind || entry.sourceType || null,
    summary: normalizeOptionalText(entry.summary || entry.content || entry.title || entry.text) ?? null,
    tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 4) : [],
    sourceType: normalizeOptionalText(entry.sourceType) ?? null,
    consolidationState: normalizeOptionalText(entry.consolidationState) ?? null,
    salience: normalizePassportMemoryUnitScore(entry.salience, null),
    confidence: normalizePassportMemoryUnitScore(entry.confidence, null),
    boundaryLabel: normalizeOptionalText(entry.boundaryLabel) ?? null,
    patternKey: normalizeOptionalText(entry.patternKey || entry.payload?.patternKey) ?? null,
    separationKey: normalizeOptionalText(entry.separationKey || entry.payload?.separationKey) ?? null,
    neuromodulation: cloneJson(entry.neuromodulation || null),
    sourceFeatures,
    realityMonitoringScore: toFiniteNumber(sourceFeatures?.realityMonitoringScore, entry?.memoryDynamics?.realityMonitoringScore ?? null),
    internalGenerationRisk: toFiniteNumber(sourceFeatures?.internalGenerationRisk, entry?.memoryDynamics?.internalGenerationRisk ?? null),
    eligibilityTraceScore: toFiniteNumber(entry?.memoryDynamics?.eligibilityTraceScore, null),
    allocationBias: toFiniteNumber(entry?.memoryDynamics?.allocationBias, null),
    gateScore: toFiniteNumber(entry?.memoryDynamics?.gateScore, null),
    gateOpen: entry?.memoryDynamics?.gateOpen ?? null,
    gateReason: normalizeTextList(entry?.memoryDynamics?.gateReason || []),
    goalRelevanceScore: toFiniteNumber(entry?.memoryDynamics?.goalRelevanceScore, null),
    queryRelevanceScore: toFiniteNumber(entry?.memoryDynamics?.queryRelevanceScore, null),
    interferenceRiskScore: toFiniteNumber(entry?.memoryDynamics?.interferenceRiskScore, null),
    reconsolidationState: normalizeOptionalText(entry?.memoryDynamics?.reconsolidationState) ?? null,
    destabilizedUntil: normalizeOptionalText(entry?.memoryDynamics?.destabilizedUntil) ?? null,
    reconsolidationOutcome: normalizeOptionalText(entry?.memoryDynamics?.lastReconsolidationOutcome) ?? null,
    predictionErrorScore: toFiniteNumber(entry?.memoryDynamics?.lastPredictionErrorScore, null),
    reconsolidationConflictState: normalizeOptionalText(entry?.memoryDynamics?.reconsolidationConflictState) ?? null,
    recordedAt: entry.recordedAt || entry.updatedAt || entry.createdAt || null,
  };
}

export function buildPerceptionSnapshot({
  query = null,
  recentConversationTurns = [],
  toolResults = [],
  knowledgeHits = [],
  conversationMinutes = [],
} = {}) {
  return {
    query: normalizeOptionalText(query) ?? null,
    incomingTurns: (Array.isArray(recentConversationTurns) ? recentConversationTurns : [])
      .slice(-3)
      .map((turn) => ({
        role: normalizeOptionalText(turn?.role) ?? "unknown",
        content: normalizeOptionalText(turn?.content)?.slice(0, 240) ?? null,
      })),
    toolSignals: (Array.isArray(toolResults) ? toolResults : [])
      .slice(-3)
      .map((result) => summarizePromptToolResult(result)),
    knowledgeSignals: (Array.isArray(knowledgeHits) ? knowledgeHits : [])
      .slice(0, 3)
      .map((entry) => summarizePromptKnowledgeHit(entry)),
    minuteSignals: (Array.isArray(conversationMinutes) ? conversationMinutes : [])
      .slice(-2)
      .map((item) => ({
        minuteId: item.minuteId || null,
        summary: normalizeOptionalText(item.summary || item.title || item.transcript)?.slice(0, 240) ?? null,
      })),
  };
}

export function buildSourceMonitoringSnapshot({
  profile = [],
  episodic = [],
  semantic = [],
  working = [],
} = {}) {
  const records = [...profile, ...episodic, ...semantic, ...working].filter(Boolean);
  const countBy = (predicate) => records.filter(predicate).length;
  const summarize = (entry) => {
    const sourceFeatures = resolvePassportSourceFeatures(entry);
    return {
      id: entry.passportMemoryId || null,
      layer: entry.layer || null,
      kind: entry.kind || null,
      summary: normalizeOptionalText(entry.summary || entry.content)?.slice(0, 180) ?? null,
      sourceType: entry.sourceType || null,
      epistemicStatus: entry.epistemicStatus ?? null,
      consolidationState: entry.consolidationState || null,
      salience: entry.salience ?? null,
      confidence: entry.confidence ?? null,
      boundaryLabel: normalizeOptionalText(entry.boundaryLabel) ?? null,
      neuromodulation: cloneJson(entry.neuromodulation || null),
      eligibilityTraceScore: toFiniteNumber(entry?.memoryDynamics?.eligibilityTraceScore, null),
      allocationBias: toFiniteNumber(entry?.memoryDynamics?.allocationBias, null),
      reconsolidationState: normalizeOptionalText(entry?.memoryDynamics?.reconsolidationState) ?? null,
      destabilizedUntil: normalizeOptionalText(entry?.memoryDynamics?.destabilizedUntil) ?? null,
      reconsolidationOutcome: normalizeOptionalText(entry?.memoryDynamics?.lastReconsolidationOutcome) ?? null,
      predictionErrorScore: toFiniteNumber(entry?.memoryDynamics?.lastPredictionErrorScore, null),
      reconsolidationConflictState: normalizeOptionalText(entry?.memoryDynamics?.reconsolidationConflictState) ?? null,
      sourceFeatures,
      realityMonitoringScore: toFiniteNumber(sourceFeatures?.realityMonitoringScore, entry?.memoryDynamics?.realityMonitoringScore ?? null),
      internalGenerationRisk: toFiniteNumber(sourceFeatures?.internalGenerationRisk, entry?.memoryDynamics?.internalGenerationRisk ?? null),
    };
  };

  const verifiedFacts = records
    .filter((entry) => entry.sourceType === "verified")
    .slice(0, 4)
    .map(summarize);
  const observedFacts = records
    .filter((entry) => entry.sourceType === "perceived" || entry.sourceType === "reported")
    .slice(0, 4)
    .map(summarize);
  const inferredFacts = records
    .filter((entry) => entry.sourceType === "inferred" || entry.sourceType === "derived")
    .slice(0, 4)
    .map(summarize);
  const hotMemories = records
    .filter((entry) => entry.consolidationState === "hot" || entry.consolidationState === "stabilizing")
    .slice(0, 4)
    .map(summarize);
  const destabilizedMemories = records
    .filter((entry) => normalizeOptionalText(entry?.memoryDynamics?.reconsolidationState) === "destabilized")
    .slice(0, 4)
    .map(summarize);
  const contestedMemories = records
    .filter((entry) => normalizeOptionalText(entry?.memoryDynamics?.reconsolidationConflictState) === "ambiguous_competition")
    .slice(0, 4)
    .map(summarize);
  const externalLikeMemories = records
    .filter((entry) => isExternalLikeSupport(entry))
    .slice(0, 4)
    .map(summarize);
  const internallyGeneratedMemories = records
    .filter(
      (entry) =>
        toFiniteNumber(resolvePassportSourceFeatures(entry)?.internalGenerationRisk, entry?.memoryDynamics?.internalGenerationRisk ?? 0) >
        DEFAULT_INTERNAL_GENERATION_RISK_HIGH_THRESHOLD
    )
    .slice(0, 4)
    .map(summarize);
  const lowRealityMemories = records
    .filter((entry) => isLowRealitySupport(entry))
    .slice(0, 4)
    .map(summarize);

  const cautions = [];
  if (inferredFacts.length > 0) {
    cautions.push("derived / inferred memories 只能作为推断或候选解释，不要表述成已验证事实。");
  }
  if (hotMemories.length > 0) {
    cautions.push("hot / stabilizing memories 代表刚发生或仍在巩固中的内容，优先保守表述。");
  }
  if (destabilizedMemories.length > 0) {
    cautions.push("destabilized memories 代表刚被重新激活、仍可能被改写的内容，避免下结论式表述。");
  }
  if (contestedMemories.length > 0) {
    cautions.push("部分记忆簇存在 competing evidence，当前更适合保留分歧，不要过早收束成唯一结论。");
  }
  if (lowRealityMemories.length > 0) {
    cautions.push("部分支撑更像压缩摘要或内部推断，现实性线索偏弱，回答时要明确这是推断而不是观察。");
  }
  if (internallyGeneratedMemories.length > 0) {
    cautions.push("internal-generation risk 较高的内容更可能来自推理、压缩或联想，不应升级成 confirmed fact。");
  }
  if (observedFacts.length > 0 && verifiedFacts.length === 0) {
    cautions.push("当前更多是 perceived / reported 内容，若涉及关键结论应回到 本地参考层 或 evidence 做确认。");
  }
  if (cautions.length === 0) {
    cautions.push("优先用 verified memory 和 identity / ledger facts 收束回答。");
  }

  return {
    trustOrder: [
      "verified",
      "perceived",
      "reported",
      "system",
      "derived",
      "inferred",
    ],
    counts: {
      total: records.length,
      verified: countBy((entry) => entry.sourceType === "verified"),
      perceived: countBy((entry) => entry.sourceType === "perceived"),
      reported: countBy((entry) => entry.sourceType === "reported"),
      system: countBy((entry) => entry.sourceType === "system"),
      derived: countBy((entry) => entry.sourceType === "derived"),
      inferred: countBy((entry) => entry.sourceType === "inferred"),
      hot: countBy((entry) => entry.consolidationState === "hot"),
      stabilizing: countBy((entry) => entry.consolidationState === "stabilizing"),
      consolidated: countBy((entry) => entry.consolidationState === "consolidated"),
      destabilized: countBy((entry) => normalizeOptionalText(entry?.memoryDynamics?.reconsolidationState) === "destabilized"),
      contested: countBy((entry) => normalizeOptionalText(entry?.memoryDynamics?.reconsolidationConflictState) === "ambiguous_competition"),
      externalLike: countBy((entry) => isExternalLikeSupport(entry)),
      lowReality: countBy((entry) => isLowRealitySupport(entry)),
      internallyGenerated: countBy(
        (entry) =>
          toFiniteNumber(resolvePassportSourceFeatures(entry)?.internalGenerationRisk, entry?.memoryDynamics?.internalGenerationRisk ?? 0) >
          DEFAULT_INTERNAL_GENERATION_RISK_HIGH_THRESHOLD
      ),
      ...buildEpistemicStatusCounts(records, (entry) => entry?.epistemicStatus ?? null),
    },
    verifiedFacts,
    observedFacts,
    inferredFacts,
    hotMemories,
    destabilizedMemories,
    contestedMemories,
    externalLikeMemories,
    internallyGeneratedMemories,
    lowRealityMemories,
    cautions,
  };
}

export function buildCognitiveLoopSnapshot({
  currentGoal = null,
  identitySnapshot = null,
  working = null,
  episodic = null,
  semantic = null,
  ledgerFacts = null,
  perception = null,
} = {}) {
  return {
    sequence: ["perception", "working", "episodic", "semantic", "identity"],
    currentGoal: normalizeOptionalText(currentGoal) ?? null,
    perceptionSummary: {
      incomingTurnCount: Array.isArray(perception?.incomingTurns) ? perception.incomingTurns.length : 0,
      toolSignalCount: Array.isArray(perception?.toolSignals) ? perception.toolSignals.length : 0,
      knowledgeSignalCount: Array.isArray(perception?.knowledgeSignals) ? perception.knowledgeSignals.length : 0,
    },
    workingSummary: {
      taskSnapshotId: working?.taskSnapshot?.snapshotId ?? null,
      recentTurnCount: Array.isArray(working?.recentConversationTurns) ? working.recentConversationTurns.length : 0,
      checkpointCount: Array.isArray(working?.checkpoints) ? working.checkpoints.length : 0,
    },
    episodicSummary: {
      relevantEventCount: Array.isArray(episodic) ? episodic.length : 0,
      latestEvent: episodic?.at?.(-1)?.summary ?? null,
    },
    semanticSummary: {
      relevantSchemaCount: Array.isArray(semantic) ? semantic.length : 0,
      latestSchema: semantic?.at?.(-1)?.summary ?? null,
    },
    identitySummary: {
      agentId: identitySnapshot?.agentId ?? null,
      did: identitySnapshot?.did ?? null,
      profileFieldCount: Object.keys(identitySnapshot?.profile || {}).length,
      ledgerFactCount: Array.isArray(ledgerFacts?.facts) ? ledgerFacts.facts.length : 0,
    },
  };
}

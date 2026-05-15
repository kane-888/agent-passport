import {
  cloneJson,
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
  toFiniteNumber,
} from "./ledger-core-utils.js";

const RUNTIME_SEARCH_SOURCE_TYPES = new Set([
  "conversation_minute",
  "task_snapshot",
  "decision",
  "evidence",
  "passport_memory",
  "compact_boundary",
  "external_cold_memory",
]);

export function normalizeRuntimeSearchSourceType(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  return normalized && RUNTIME_SEARCH_SOURCE_TYPES.has(normalized) ? normalized : null;
}

export function buildRuntimeSearchHit({
  sourceType,
  sourceId,
  title = null,
  summary = null,
  excerpt = null,
  text = "",
  score = 0,
  providerScore = null,
  candidateOnly = false,
  recordedAt = null,
  tags = [],
  linked = {},
} = {}) {
  return {
    sourceType,
    sourceId,
    title: normalizeOptionalText(title) ?? null,
    summary: normalizeOptionalText(summary) ?? null,
    excerpt: normalizeOptionalText(excerpt) ?? null,
    score,
    providerScore: toFiniteNumber(providerScore, null),
    candidateOnly: normalizeBooleanFlag(candidateOnly, false),
    recordedAt: normalizeOptionalText(recordedAt) ?? null,
    tags: normalizeTextList(tags),
    linked: cloneJson(linked) ?? {},
    text,
  };
}

export function buildRuntimeSearchSourceWeight(sourceType, retrievalPolicy = {}) {
  const preferStructuredMemory = retrievalPolicy.preferStructuredMemory !== false;
  const preferConversationMinutes = retrievalPolicy.preferConversationMinutes !== false;
  const preferCompactBoundaries = retrievalPolicy.preferCompactBoundaries !== false;

  if (sourceType === "task_snapshot") {
    return preferStructuredMemory ? 1.28 : 1.12;
  }
  if (sourceType === "decision") {
    return preferStructuredMemory ? 1.24 : 1.1;
  }
  if (sourceType === "evidence") {
    return preferStructuredMemory ? 1.18 : 1.08;
  }
  if (sourceType === "passport_memory") {
    return preferStructuredMemory ? 1.2 : 1.05;
  }
  if (sourceType === "compact_boundary") {
    return preferCompactBoundaries ? 1.22 : 1.08;
  }
  if (sourceType === "conversation_minute") {
    return preferConversationMinutes ? 1.16 : 1.02;
  }
  if (sourceType === "external_cold_memory") {
    return 0.96;
  }
  return 1;
}

export function summarizePromptKnowledgeHit(entry = {}) {
  const linked = entry.linked && typeof entry.linked === "object" ? entry.linked : {};
  return {
    sourceType: entry.sourceType || null,
    sourceId: entry.sourceId || null,
    title: normalizeOptionalText(entry.title) ?? null,
    summary: normalizeOptionalText(entry.summary || entry.snippet || entry.text) ?? null,
    score: entry.score ?? null,
    providerScore: toFiniteNumber(entry.providerScore, null),
    candidateOnly: entry.candidateOnly === true,
    provenance:
      entry.sourceType === "external_cold_memory"
        ? {
            provider: normalizeOptionalText(linked.provider) ?? null,
            sourceFile: normalizeOptionalText(linked.sourceFile) ?? null,
            wing: normalizeOptionalText(linked.wing) ?? null,
            room: normalizeOptionalText(linked.room) ?? null,
          }
        : null,
    recordedAt: entry.recordedAt || null,
  };
}

export function splitRuntimeSearchHits(entries = []) {
  const localHits = [];
  const externalColdMemoryHits = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.sourceType === "external_cold_memory") {
      externalColdMemoryHits.push(entry);
    } else {
      localHits.push(entry);
    }
  }
  return {
    localHits,
    externalColdMemoryHits,
  };
}

export function countRuntimeSearchHitsBySource(entries = []) {
  return (Array.isArray(entries) ? entries : []).reduce((acc, entry) => {
    const sourceType = normalizeOptionalText(entry?.sourceType) ?? "unknown";
    acc[sourceType] = (acc[sourceType] || 0) + 1;
    return acc;
  }, {});
}

import {
  cloneJson,
  createRecordId,
  hashJson,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import {
  matchesCompatibleAgentId,
} from "./ledger-identity-compat.js";
import {
  getCachedTranscriptEntryList,
  setCachedTranscriptEntryList,
} from "./ledger-runtime-caches.js";
import {
  DEFAULT_TRANSCRIPT_LIMIT,
} from "./ledger-transcript-model.js";
import {
  normalizeDidMethod,
} from "./protocol.js";

const TRANSCRIPT_ENTRY_TYPES = new Set([
  "user_turn",
  "assistant_turn",
  "tool_result",
  "message_inbox",
  "message_outbox",
  "negotiation",
  "verification",
  "checkpoint",
  "compact_boundary",
  "recovery_rehearsal",
  "system_note",
]);

export function normalizeTranscriptEntryType(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  return normalized && TRANSCRIPT_ENTRY_TYPES.has(normalized) ? normalized : "system_note";
}

export function normalizeTranscriptFamily(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  return normalized || "runtime";
}

export function normalizeTranscriptEntryRecord(agentId, payload = {}) {
  const entryType = normalizeTranscriptEntryType(payload.entryType || payload.type);
  return {
    transcriptEntryId: normalizeOptionalText(payload.transcriptEntryId) || createRecordId("trn"),
    agentId,
    didMethod: normalizeDidMethod(payload.didMethod, null),
    entryType,
    family: normalizeTranscriptFamily(
      payload.family ||
        (entryType === "user_turn" || entryType === "assistant_turn" ? "conversation" : null)
    ),
    role: normalizeOptionalText(payload.role) ?? null,
    title: normalizeOptionalText(payload.title) ?? null,
    summary: normalizeOptionalText(payload.summary) ?? null,
    content: normalizeOptionalText(payload.content) ?? null,
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId || payload.recordedByWindowId) ?? null,
    sourceMessageId: normalizeOptionalText(payload.sourceMessageId) ?? null,
    relatedRunId: normalizeOptionalText(payload.relatedRunId || payload.runId) ?? null,
    relatedQueryStateId: normalizeOptionalText(payload.relatedQueryStateId || payload.queryStateId) ?? null,
    relatedCompactBoundaryId: normalizeOptionalText(payload.relatedCompactBoundaryId || payload.compactBoundaryId) ?? null,
    relatedVerificationRunId: normalizeOptionalText(payload.relatedVerificationRunId || payload.verificationRunId) ?? null,
    metadata: cloneJson(payload.metadata) ?? {},
    recordedAt: normalizeOptionalText(payload.recordedAt) ?? now(),
  };
}

export function listAgentTranscriptEntries(store, agentId, { family = null, limit = DEFAULT_TRANSCRIPT_LIMIT } = {}) {
  const normalizedFamily = normalizeTranscriptFamily(family);
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_TRANSCRIPT_LIMIT;
  const cacheKey = hashJson({
    kind: "transcript_entry_list",
    agentId,
    family: normalizedFamily,
    limit: cappedLimit,
    total: (store.transcriptEntries || []).length,
    lastTranscriptEntryId: store.transcriptEntries?.at(-1)?.transcriptEntryId ?? null,
  });
  const cached = getCachedTranscriptEntryList(cacheKey);
  if (cached) {
    return cached;
  }
  const records = (store.transcriptEntries || [])
    .filter((entry) => matchesCompatibleAgentId(store, entry.agentId, agentId))
    .filter((entry) => (family ? normalizeTranscriptFamily(entry.family) === normalizedFamily : true))
    .sort((a, b) => (a.recordedAt || "").localeCompare(b.recordedAt || ""));
  const result = records.slice(-cappedLimit).map((entry) => cloneJson(entry));
  setCachedTranscriptEntryList(cacheKey, result);
  return result;
}

export function appendTranscriptEntries(store, agentId, entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  if (!Array.isArray(store.transcriptEntries)) {
    store.transcriptEntries = [];
  }
  const normalized = entries
    .map((entry) => normalizeTranscriptEntryRecord(agentId, entry))
    .filter(Boolean);
  store.transcriptEntries.push(...normalized);
  return normalized;
}

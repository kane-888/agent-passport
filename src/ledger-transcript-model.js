import { hashEvent } from "./ledger-core-utils.js";
import {
  buildAgentScopedDerivedCacheKey,
  buildCollectionTailToken,
  cacheStoreDerivedView,
} from "./ledger-derived-cache.js";

export const DEFAULT_TRANSCRIPT_LIMIT = 20;

function requireTranscriptModelDependency(deps, name) {
  const value = deps?.[name];
  if (typeof value !== "function") {
    throw new Error(`Missing transcript model dependency: ${name}`);
  }
  return value;
}

export function buildTranscriptMessageBlocks(entries = []) {
  const blocks = [];
  let current = null;

  for (const entry of entries) {
    const blockKey = [
      entry.family || "unknown",
      entry.relatedRunId || "no-run",
      entry.relatedQueryStateId || "no-query",
      entry.role || "no-role",
    ].join(":");
    if (!current || current.blockKey !== blockKey) {
      current = {
        blockKey,
        blockId: null,
        family: entry.family || null,
        role: entry.role || null,
        relatedRunId: entry.relatedRunId || null,
        relatedQueryStateId: entry.relatedQueryStateId || null,
        relatedCompactBoundaryId: entry.relatedCompactBoundaryId || null,
        relatedVerificationRunId: entry.relatedVerificationRunId || null,
        entryCount: 0,
        entryTypeCounts: {},
        latestRecordedAt: entry.recordedAt || null,
        summary: entry.summary || entry.title || entry.transcriptEntryId || null,
        transcriptEntryIds: [],
        previews: [],
      };
      blocks.push(current);
    }
    current.entryCount += 1;
    current.entryTypeCounts[entry.entryType || "unknown"] =
      Number(current.entryTypeCounts[entry.entryType || "unknown"] || 0) + 1;
    current.latestRecordedAt = entry.recordedAt || current.latestRecordedAt || null;
    current.summary = current.summary || entry.summary || entry.title || entry.transcriptEntryId || null;
    current.transcriptEntryIds.push(entry.transcriptEntryId);
    if (current.previews.length < 3) {
      current.previews.push({
        transcriptEntryId: entry.transcriptEntryId || null,
        entryType: entry.entryType || null,
        title: entry.title || null,
        summary: entry.summary || null,
      });
    }
  }

  return blocks.map((block) => ({
    blockId:
      block.blockId ||
      `tblk_${hashEvent({
        family: block.family,
        role: block.role,
        relatedRunId: block.relatedRunId,
        relatedQueryStateId: block.relatedQueryStateId,
        transcriptEntryIds: block.transcriptEntryIds,
      }).slice(0, 8)}`,
    family: block.family,
    role: block.role,
    relatedRunId: block.relatedRunId,
    relatedQueryStateId: block.relatedQueryStateId,
    relatedCompactBoundaryId: block.relatedCompactBoundaryId,
    relatedVerificationRunId: block.relatedVerificationRunId,
    entryCount: block.entryCount,
    entryTypeCounts: block.entryTypeCounts,
    latestRecordedAt: block.latestRecordedAt,
    summary: block.summary,
    transcriptEntryIds: block.transcriptEntryIds,
    previews: block.previews,
  }));
}

export function buildTranscriptModelSnapshot(
  store,
  agent,
  { limit = DEFAULT_TRANSCRIPT_LIMIT } = {},
  deps = {}
) {
  const listAgentTranscriptEntries = requireTranscriptModelDependency(deps, "listAgentTranscriptEntries");
  const resolvedLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_TRANSCRIPT_LIMIT;
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "transcript_model_snapshot",
    store,
    agent.agentId,
    [
      buildCollectionTailToken(store?.transcriptEntries || [], {
        idFields: ["transcriptEntryId"],
        timeFields: ["recordedAt"],
      }),
      `${resolvedLimit}`,
    ].join(":")
  );
  return cacheStoreDerivedView(store, cacheKey, () => {
    const entries = listAgentTranscriptEntries(store, agent.agentId, { limit: resolvedLimit });
    const familyCounts = entries.reduce((acc, entry) => {
      const key = entry.family || "unknown";
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {});
    const entryTypeCounts = entries.reduce((acc, entry) => {
      const key = entry.entryType || "unknown";
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {});
    return {
      entryCount: entries.length,
      latestTranscriptEntryId: entries.at(-1)?.transcriptEntryId ?? null,
      families: [...new Set(entries.map((entry) => entry.family).filter(Boolean))],
      familyCounts,
      entryTypeCounts,
      messageBlocks: buildTranscriptMessageBlocks(entries),
      entries,
    };
  });
}

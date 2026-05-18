import {
  cloneJson,
  normalizeOptionalText,
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

export function listAgentCompactBoundariesFromStore(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_compact_boundaries",
    store,
    agentId,
    buildCollectionTailToken(store?.compactBoundaries || [], {
      idFields: ["compactBoundaryId"],
      timeFields: ["createdAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    (store.compactBoundaries || [])
      .filter((boundary) => matchesCompatibleAgentId(store, boundary.agentId, agentId))
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
  );
}

export function findPassportMemoryRecord(store, passportMemoryId) {
  const normalizedPassportMemoryId = normalizeOptionalText(passportMemoryId) ?? null;
  if (!normalizedPassportMemoryId) {
    return null;
  }

  return (store.passportMemories || []).find((entry) => entry.passportMemoryId === normalizedPassportMemoryId) ?? null;
}

export function findCompactBoundaryRecord(store, agentId, compactBoundaryId) {
  const normalizedCompactBoundaryId = normalizeOptionalText(compactBoundaryId) ?? null;
  if (!normalizedCompactBoundaryId) {
    return null;
  }

  return (
    (store.compactBoundaries || []).find(
      (boundary) =>
        matchesCompatibleAgentId(store, boundary.agentId, agentId) &&
        boundary.compactBoundaryId === normalizedCompactBoundaryId
    ) ?? null
  );
}

export function buildCompactBoundaryResumeView(store, agent, compactBoundaryId) {
  const boundary = findCompactBoundaryRecord(store, agent.agentId, compactBoundaryId);
  if (!boundary) {
    return null;
  }

  const checkpointMemory = findPassportMemoryRecord(store, boundary.checkpointMemoryId);
  const archivedEntries = (boundary.archivedMemoryIds || [])
    .map((memoryId) => findPassportMemoryRecord(store, memoryId))
    .filter(Boolean);
  const retainedEntries = (boundary.retainedMemoryIds || [])
    .map((memoryId) => findPassportMemoryRecord(store, memoryId))
    .filter(Boolean);
  const archivedConversationTurns = archivedEntries
    .filter((entry) => entry.kind === "conversation_turn")
    .slice(-6)
    .map((entry) => ({
      passportMemoryId: entry.passportMemoryId,
      role: normalizeOptionalText(entry.payload?.role) ?? "unknown",
      content: entry.content || entry.summary || "",
    }));
  const archivedToolResults = archivedEntries
    .filter((entry) => entry.kind === "tool_result")
    .slice(-6)
    .map((entry) => ({
      passportMemoryId: entry.passportMemoryId,
      tool: normalizeOptionalText(entry.payload?.tool) ?? entry.summary ?? "tool",
      result: entry.content || entry.summary || "",
    }));
  const retainedConversationTurns = retainedEntries
    .filter((entry) => entry.kind === "conversation_turn")
    .slice(-6)
    .map((entry) => ({
      passportMemoryId: entry.passportMemoryId,
      role: normalizeOptionalText(entry.payload?.role) ?? "unknown",
      content: entry.content || entry.summary || "",
    }));
  const retainedToolResults = retainedEntries
    .filter((entry) => entry.kind === "tool_result")
    .slice(-6)
    .map((entry) => ({
      passportMemoryId: entry.passportMemoryId,
      tool: normalizeOptionalText(entry.payload?.tool) ?? entry.summary ?? "tool",
      result: entry.content || entry.summary || "",
    }));

  return {
    compactBoundaryId: boundary.compactBoundaryId,
    didMethod: boundary.didMethod || null,
    runId: boundary.runId || null,
    previousCompactBoundaryId: boundary.previousCompactBoundaryId || null,
    resumedFromCompactBoundaryId: boundary.resumedFromCompactBoundaryId || null,
    chainRootCompactBoundaryId: boundary.chainRootCompactBoundaryId || boundary.compactBoundaryId || null,
    resumeDepth: Math.max(0, Math.floor(toFiniteNumber(boundary.resumeDepth, 0))),
    lineageCompactBoundaryIds: cloneJson(boundary.lineageCompactBoundaryIds) ?? [boundary.compactBoundaryId],
    checkpointMemoryId: boundary.checkpointMemoryId || null,
    currentGoal: boundary.currentGoal || null,
    summary: boundary.summary || checkpointMemory?.summary || null,
    checkpointSummary: checkpointMemory?.content || boundary.summary || null,
    archivedCount: boundary.archivedCount || archivedEntries.length,
    retainedCount: boundary.retainedCount || retainedEntries.length,
    archivedKinds: cloneJson(boundary.archivedKinds) ?? [],
    archivedMemoryIds: cloneJson(boundary.archivedMemoryIds) ?? [],
    retainedMemoryIds: cloneJson(boundary.retainedMemoryIds) ?? [],
    archivedConversationTurns,
    archivedToolResults,
    retainedConversationTurns,
    retainedToolResults,
    recoveryPrompt: [
      `Resume from compact boundary ${boundary.compactBoundaryId}.`,
      boundary.summary ? `Checkpoint: ${boundary.summary}` : null,
      checkpointMemory?.content ? checkpointMemory.content : null,
      boundary.resumedFromCompactBoundaryId ? `This boundary continues from ${boundary.resumedFromCompactBoundaryId}.` : null,
      archivedConversationTurns.length
        ? `Archived conversation: ${archivedConversationTurns.map((entry) => `${entry.role}: ${entry.content}`).join(" | ")}`
        : null,
      archivedToolResults.length
        ? `Archived tools: ${archivedToolResults.map((entry) => `${entry.tool}: ${entry.result}`).join(" | ")}`
        : null,
      "Continue directly from this boundary without recap or extra continuation chatter.",
    ]
      .filter(Boolean)
      .join("\n"),
    sourceWindowId: boundary.sourceWindowId || null,
    createdAt: boundary.createdAt || null,
  };
}

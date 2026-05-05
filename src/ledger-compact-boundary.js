import {
  cloneJson,
  createRecordId,
  normalizeOptionalText,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import { normalizeDidMethod } from "./protocol.js";

export function buildCompactBoundaryView(boundary) {
  return cloneJson(boundary) ?? null;
}

export function buildCompactBoundaryRecord(
  _store,
  agent,
  {
    didMethod = null,
    currentDidMethod = null,
    runId = null,
    checkpoint = null,
    contextBuilder = null,
    resumeBoundaryId = null,
    previousCompactBoundary = null,
    sourceWindowId = null,
  } = {}
) {
  if (!checkpoint?.triggered || !checkpoint?.checkpointMemoryId) {
    return null;
  }

  const compactBoundaryId = createRecordId("cbnd");
  const explicitPreviousBoundary =
    previousCompactBoundary && typeof previousCompactBoundary === "object" ? previousCompactBoundary : null;
  const previousCompactBoundaryId = explicitPreviousBoundary?.compactBoundaryId ?? null;
  const chainRootCompactBoundaryId =
    explicitPreviousBoundary?.chainRootCompactBoundaryId ??
    explicitPreviousBoundary?.compactBoundaryId ??
    compactBoundaryId;
  const resumeDepth = explicitPreviousBoundary
    ? Math.max(0, Math.floor(toFiniteNumber(explicitPreviousBoundary.resumeDepth, 0))) + 1
    : 0;
  const lineageCompactBoundaryIds = explicitPreviousBoundary
    ? [
        ...(Array.isArray(explicitPreviousBoundary.lineageCompactBoundaryIds)
          ? explicitPreviousBoundary.lineageCompactBoundaryIds
          : [explicitPreviousBoundary.compactBoundaryId]),
        compactBoundaryId,
      ].filter(Boolean)
    : [compactBoundaryId];

  return {
    compactBoundaryId,
    agentId: agent.agentId,
    didMethod:
      normalizeDidMethod(didMethod) ||
      normalizeOptionalText(currentDidMethod) ||
      null,
    runId: normalizeOptionalText(runId) ?? null,
    previousCompactBoundaryId,
    resumedFromCompactBoundaryId: normalizeOptionalText(resumeBoundaryId) ?? null,
    chainRootCompactBoundaryId,
    resumeDepth,
    lineageCompactBoundaryIds,
    checkpointMemoryId: checkpoint.checkpointMemoryId,
    contextHash: contextBuilder?.contextHash ?? null,
    currentGoal: normalizeOptionalText(checkpoint.checkpoint?.payload?.currentGoal) ?? null,
    summary: normalizeOptionalText(checkpoint.checkpoint?.summary || checkpoint.checkpoint?.content) ?? null,
    archivedCount: checkpoint.archivedCount ?? 0,
    retainedCount: checkpoint.retainedCount ?? 0,
    archivedKinds: cloneJson(checkpoint.archivedKinds) ?? [],
    archivedMemoryIds: cloneJson(checkpoint.archivedMemoryIds) ?? [],
    retainedMemoryIds: cloneJson(checkpoint.retainedMemoryIds) ?? [],
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
    createdAt: now(),
  };
}

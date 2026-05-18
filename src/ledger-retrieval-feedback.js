import {
  createRecordId,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import {
  destabilizePassportMemoryRecord,
  reinforcePassportMemoryRecord,
} from "./ledger-passport-memory-dynamics.js";
import {
  isPassportMemoryActive,
} from "./ledger-passport-memory-rules.js";

export function recordRetrievalFeedbackInStore(
  store,
  agent,
  {
    query = null,
    contextBuilder = null,
    sourceWindowId = null,
    persist = true,
  } = {}
) {
  const continuousCognitiveState =
    contextBuilder?.slots?.continuousCognitiveState && typeof contextBuilder.slots.continuousCognitiveState === "object"
      ? contextBuilder.slots.continuousCognitiveState
      : null;
  const recalledIds = new Set();
  const reactivatedNeighborIds = new Set();
  const recalledEntries = [
    ...(contextBuilder?.memoryLayers?.relevant?.profile || []),
    ...(contextBuilder?.memoryLayers?.relevant?.episodic || []),
    ...(contextBuilder?.memoryLayers?.relevant?.semantic || []),
    ...(contextBuilder?.memoryLayers?.working?.entries || []).slice(-3),
  ].filter((entry) => entry?.passportMemoryId);

  for (const entry of recalledEntries) {
    const liveEntry = (store.passportMemories || []).find((item) => item.passportMemoryId === entry.passportMemoryId);
    if (!liveEntry) {
      continue;
    }
    if (persist) {
      reinforcePassportMemoryRecord(liveEntry, {
        useful: true,
        currentGoal: contextBuilder?.slots?.currentGoal ?? null,
        queryText: query,
        cognitiveState: continuousCognitiveState,
      });
    }
    recalledIds.add(liveEntry.passportMemoryId);

    for (const neighbor of store.passportMemories || []) {
      if (
        neighbor.agentId !== agent.agentId ||
        neighbor.passportMemoryId === liveEntry.passportMemoryId ||
        !isPassportMemoryActive(neighbor)
      ) {
        continue;
      }
      const sameField =
        normalizeOptionalText(neighbor?.payload?.field) &&
        normalizeOptionalText(neighbor?.payload?.field) === normalizeOptionalText(liveEntry?.payload?.field);
      const samePattern =
        normalizeOptionalText(neighbor?.patternKey) &&
        normalizeOptionalText(neighbor?.patternKey) === normalizeOptionalText(liveEntry?.patternKey);
      const sameSeparation =
        normalizeOptionalText(neighbor?.separationKey) &&
        normalizeOptionalText(neighbor?.separationKey) === normalizeOptionalText(liveEntry?.separationKey);
      if (!sameField && !samePattern && !sameSeparation) {
        continue;
      }
      if (persist) {
        destabilizePassportMemoryRecord(neighbor, {
          recalledAt: now(),
          clusterCue: true,
        });
      }
      reactivatedNeighborIds.add(neighbor.passportMemoryId);
    }
  }

  const feedback = {
    feedbackId: createRecordId("rtfb"),
    agentId: agent.agentId,
    query: normalizeOptionalText(query) ?? null,
    recalledMemoryIds: Array.from(recalledIds),
    reactivatedNeighborIds: Array.from(reactivatedNeighborIds),
    hitCount: recalledIds.size,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
    createdAt: now(),
  };
  if (persist) {
    if (!Array.isArray(store.retrievalFeedback)) {
      store.retrievalFeedback = [];
    }
    store.retrievalFeedback.push(feedback);
  }
  return feedback;
}

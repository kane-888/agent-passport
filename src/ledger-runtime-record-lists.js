import {
  buildAgentScopedDerivedCacheKey,
  buildCollectionTailToken,
  cacheStoreDerivedView,
} from "./ledger-derived-cache.js";
import {
  matchesCompatibleAgentId,
} from "./ledger-identity-compat.js";

export function listAgentTaskSnapshots(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_task_snapshots",
    store,
    agentId,
    buildCollectionTailToken(store?.taskSnapshots || [], {
      idFields: ["snapshotId"],
      timeFields: ["updatedAt", "createdAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    (store.taskSnapshots || [])
      .filter((snapshot) => matchesCompatibleAgentId(store, snapshot.agentId, agentId))
      .sort((a, b) => (a.updatedAt || a.createdAt || "").localeCompare(b.updatedAt || b.createdAt || ""))
  );
}

export function latestAgentTaskSnapshot(store, agentId) {
  return listAgentTaskSnapshots(store, agentId).at(-1) ?? null;
}

export function listAgentDecisionLogs(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_decision_logs",
    store,
    agentId,
    buildCollectionTailToken(store?.decisionLogs || [], {
      idFields: ["decisionId"],
      timeFields: ["recordedAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    (store.decisionLogs || [])
      .filter((decision) => matchesCompatibleAgentId(store, decision.agentId, agentId))
      .sort((a, b) => (a.recordedAt || "").localeCompare(b.recordedAt || ""))
  );
}

export function listAgentConversationMinutes(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_conversation_minutes",
    store,
    agentId,
    buildCollectionTailToken(store?.conversationMinutes || [], {
      idFields: ["minuteId"],
      timeFields: ["recordedAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    (store.conversationMinutes || [])
      .filter((minute) => matchesCompatibleAgentId(store, minute.agentId, agentId))
      .sort((a, b) => (a.recordedAt || "").localeCompare(b.recordedAt || ""))
  );
}

export function listAgentEvidenceRefs(store, agentId) {
  return (store.evidenceRefs || [])
    .filter((entry) => matchesCompatibleAgentId(store, entry.agentId, agentId))
    .sort((a, b) => (a.recordedAt || "").localeCompare(b.recordedAt || ""));
}

import {
  buildAgentScopedDerivedCacheKey,
  buildCollectionTailToken,
  cacheStoreDerivedView,
} from "./ledger-derived-cache.js";
import { matchesCompatibleAgentId } from "./ledger-identity-compat.js";

export function listAgentWindows(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_windows",
    store,
    agentId,
    `${Object.keys(store?.windows || {}).length}`
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    Object.values(store.windows)
      .filter((window) => matchesCompatibleAgentId(store, window.agentId, agentId))
      .sort((a, b) => a.linkedAt.localeCompare(b.linkedAt))
  );
}

export function listAgentMemories(store, agentId) {
  const memories = Array.isArray(store?.memories)
    ? store.memories.filter((memory) => memory && typeof memory === "object")
    : [];
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_memories",
    store,
    agentId,
    buildCollectionTailToken(memories, {
      idFields: ["memoryId"],
      timeFields: ["createdAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    memories
      .filter((memory) => matchesCompatibleAgentId(store, memory.agentId, agentId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  );
}

export function listAgentInbox(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_inbox",
    store,
    agentId,
    buildCollectionTailToken(store?.messages || [], {
      idFields: ["messageId"],
      timeFields: ["createdAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    store.messages
      .filter((message) => matchesCompatibleAgentId(store, message.toAgentId, agentId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  );
}

export function listAgentOutbox(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_outbox",
    store,
    agentId,
    buildCollectionTailToken(store?.messages || [], {
      idFields: ["messageId"],
      timeFields: ["createdAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    store.messages
      .filter((message) => matchesCompatibleAgentId(store, message.fromAgentId, agentId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  );
}

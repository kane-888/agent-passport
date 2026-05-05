import {
  cloneJson,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import { normalizeRuntimeMemoryStateRecord } from "./memory-homeostasis.js";
import { appendRuntimeMemoryObservation } from "./ledger-runtime-memory-observations.js";

function callAdapter(adapter, name, ...args) {
  const fn = adapter?.[name];
  return typeof fn === "function" ? fn(...args) : null;
}

function matchesRuntimeMemoryStateAgent(store, state, agentId, adapter = {}) {
  const matches = adapter?.matchesCompatibleAgentId;
  if (typeof matches === "function") {
    return matches(store, state.agentId, agentId);
  }
  const normalizedAgentId = normalizeOptionalText(agentId) ?? null;
  if (!normalizedAgentId) {
    return true;
  }
  return normalizeOptionalText(state.agentId) === normalizedAgentId;
}

export function listRuntimeMemoryStatesFromStore(store, agentId, adapter = {}) {
  const buildValue = () =>
    (store.runtimeMemoryStates || [])
      .map((state) => normalizeRuntimeMemoryStateRecord(state))
      .filter((state) => (agentId ? matchesRuntimeMemoryStateAgent(store, state, agentId, adapter) : true))
      .sort((left, right) =>
        (left.updatedAt || left.createdAt || "").localeCompare(right.updatedAt || right.createdAt || "")
      );
  const collectionToken = callAdapter(adapter, "buildCollectionTailToken", store?.runtimeMemoryStates || [], {
    idFields: ["runtimeMemoryStateId"],
    timeFields: ["updatedAt", "createdAt"],
  });
  const cacheKey = collectionToken
    ? callAdapter(
        adapter,
        "buildAgentScopedDerivedCacheKey",
        "runtime_memory_states",
        store,
        normalizeOptionalText(agentId) ?? "all_agents",
        collectionToken
      )
    : null;
  return cacheKey && typeof adapter?.cacheStoreDerivedView === "function"
    ? adapter.cacheStoreDerivedView(store, cacheKey, buildValue)
    : buildValue();
}

export function upsertRuntimeMemoryState(
  store,
  agent,
  runtimeMemoryState,
  {
    sessionId = null,
    runId = null,
    sourceWindowId = null,
    persist = true,
    observationContext = null,
  } = {},
  adapter = {}
) {
  if (!runtimeMemoryState) {
    return null;
  }
  const normalized = normalizeRuntimeMemoryStateRecord({
    ...runtimeMemoryState,
    agentId: agent.agentId,
    sessionId: normalizeOptionalText(sessionId) ?? runtimeMemoryState.sessionId ?? null,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? runtimeMemoryState.sourceWindowId ?? null,
    metadata: {
      ...(runtimeMemoryState.metadata && typeof runtimeMemoryState.metadata === "object"
        ? cloneJson(runtimeMemoryState.metadata)
        : {}),
      runId: normalizeOptionalText(runId) ?? null,
    },
    updatedAt: now(),
  });
  if (!persist) {
    return normalized;
  }
  if (!Array.isArray(store.runtimeMemoryStates)) {
    store.runtimeMemoryStates = [];
  }
  const previousPersistedState =
    listRuntimeMemoryStatesFromStore(store, agent.agentId, adapter).at(-1) ?? null;
  const existingIndex = store.runtimeMemoryStates.findIndex(
    (state) => state.agentId === agent.agentId && state.sessionId === normalized.sessionId
  );
  if (existingIndex >= 0) {
    const existing = normalizeRuntimeMemoryStateRecord(store.runtimeMemoryStates[existingIndex]);
    store.runtimeMemoryStates[existingIndex] = {
      ...normalized,
      runtimeMemoryStateId: normalized.runtimeMemoryStateId || existing.runtimeMemoryStateId,
      createdAt: existing.createdAt,
    };
  } else {
    store.runtimeMemoryStates.push(normalized);
  }
  appendRuntimeMemoryObservation(store, normalized, {
    previousState: previousPersistedState,
    ...(observationContext && typeof observationContext === "object" ? cloneJson(observationContext) : {}),
  });
  return normalized;
}

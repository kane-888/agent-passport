import { normalizeOptionalText } from "./ledger-core-utils.js";

const STORE_DERIVED_VIEW_CACHE = new WeakMap();

function getStoreDerivedViewCache(store) {
  if (!store || typeof store !== "object") {
    return null;
  }
  let cache = STORE_DERIVED_VIEW_CACHE.get(store) ?? null;
  if (!cache) {
    cache = new Map();
    STORE_DERIVED_VIEW_CACHE.set(store, cache);
  }
  return cache;
}

function getCachedStoreDerivedView(store, cacheKey) {
  const cache = getStoreDerivedViewCache(store);
  return cache ? cache.get(cacheKey) ?? null : null;
}

function setCachedStoreDerivedView(store, cacheKey, value) {
  const cache = getStoreDerivedViewCache(store);
  if (!cache) {
    return value;
  }
  cache.set(cacheKey, value);
  return value;
}

export function cacheStoreDerivedView(store, cacheKey, buildValue) {
  const cached = getCachedStoreDerivedView(store, cacheKey);
  if (cached != null) {
    return cached;
  }
  return setCachedStoreDerivedView(store, cacheKey, buildValue());
}

export function buildCollectionTailToken(entries = [], { idFields = [], timeFields = [] } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const last = list.length > 0 ? list.at(-1) : null;
  const lastId =
    idFields
      .map((field) => normalizeOptionalText(last?.[field]) ?? null)
      .find(Boolean) ?? null;
  const lastTime =
    timeFields
      .map((field) => normalizeOptionalText(last?.[field]) ?? null)
      .find(Boolean) ?? null;
  return `${list.length}:${lastId || ""}:${lastTime || ""}`;
}

export function buildAgentScopedDerivedCacheKey(kind, store, agentId, collectionToken) {
  return [
    kind,
    normalizeOptionalText(agentId) ?? "unknown",
    collectionToken,
    Array.isArray(store?.events) ? store.events.length : 0,
    normalizeOptionalText(store?.events?.at(-1)?.eventId) ?? "",
    normalizeOptionalText(store?.lastEventHash) ?? "",
  ].join(":");
}

export function buildStoreScopedDerivedCacheKey(kind, store, collectionToken, scope = null) {
  return [
    kind,
    normalizeOptionalText(scope) ?? "all",
    collectionToken,
    Array.isArray(store?.events) ? store.events.length : 0,
    normalizeOptionalText(store?.events?.at(-1)?.eventId) ?? "",
    normalizeOptionalText(store?.lastEventHash) ?? "",
  ].join(":");
}

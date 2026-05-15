import {
  cloneJson,
} from "./ledger-core-utils.js";

export const DEFAULT_REHYDRATE_CACHE_MAX_ENTRIES = 32;

const REHYDRATE_PACK_CACHE = new Map();
const RUNTIME_SNAPSHOT_CACHE = new Map();
const PASSPORT_MEMORY_LIST_CACHE = new Map();
const TRANSCRIPT_ENTRY_LIST_CACHE = new Map();

export const RUNTIME_SUMMARY_CACHE = new Map();
export const AGENT_CONTEXT_CACHE = new Map();
export const AGENT_CREDENTIAL_CACHE = new Map();
export const ARCHIVED_RECORDS_CACHE = new Map();
export const ARCHIVE_RESTORE_EVENTS_CACHE = new Map();

function evictOldestCacheEntry(cache, maxEntries) {
  if (cache.size <= maxEntries) {
    return;
  }
  const oldestKey = cache.keys().next().value;
  if (oldestKey) {
    cache.delete(oldestKey);
  }
}

export function getCachedRehydratePack(cacheKey) {
  const hit = REHYDRATE_PACK_CACHE.get(cacheKey) ?? null;
  return hit ? cloneJson(hit) : null;
}

export function setCachedRehydratePack(cacheKey, value) {
  REHYDRATE_PACK_CACHE.set(cacheKey, cloneJson(value));
  evictOldestCacheEntry(REHYDRATE_PACK_CACHE, DEFAULT_REHYDRATE_CACHE_MAX_ENTRIES);
}

export function getCachedRuntimeSnapshot(cacheKey) {
  const hit = RUNTIME_SNAPSHOT_CACHE.get(cacheKey) ?? null;
  return hit ? cloneJson(hit) : null;
}

export function setCachedRuntimeSnapshot(cacheKey, value) {
  RUNTIME_SNAPSHOT_CACHE.set(cacheKey, cloneJson(value));
  evictOldestCacheEntry(RUNTIME_SNAPSHOT_CACHE, DEFAULT_REHYDRATE_CACHE_MAX_ENTRIES);
}

export function getCachedPassportMemoryList(cacheKey) {
  return PASSPORT_MEMORY_LIST_CACHE.get(cacheKey) ?? null;
}

export function setCachedPassportMemoryList(cacheKey, value) {
  PASSPORT_MEMORY_LIST_CACHE.set(cacheKey, value);
  evictOldestCacheEntry(PASSPORT_MEMORY_LIST_CACHE, DEFAULT_REHYDRATE_CACHE_MAX_ENTRIES * 4);
}

export function getCachedTimedSnapshot(cache, cacheKey, ttlMs) {
  const hit = cache.get(cacheKey) ?? null;
  if (!hit) {
    return null;
  }
  if (Date.now() - hit.createdAt > ttlMs) {
    cache.delete(cacheKey);
    return null;
  }
  return cloneJson(hit.value);
}

export function setCachedTimedSnapshot(cache, cacheKey, value, maxEntries = DEFAULT_REHYDRATE_CACHE_MAX_ENTRIES) {
  cache.set(cacheKey, {
    createdAt: Date.now(),
    value: cloneJson(value),
  });
  evictOldestCacheEntry(cache, maxEntries);
}

export function getCachedTranscriptEntryList(cacheKey) {
  return TRANSCRIPT_ENTRY_LIST_CACHE.get(cacheKey) ?? null;
}

export function setCachedTranscriptEntryList(cacheKey, value) {
  TRANSCRIPT_ENTRY_LIST_CACHE.set(cacheKey, value);
  evictOldestCacheEntry(TRANSCRIPT_ENTRY_LIST_CACHE, DEFAULT_REHYDRATE_CACHE_MAX_ENTRIES * 2);
}

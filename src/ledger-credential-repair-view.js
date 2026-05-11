import { normalizeOptionalText } from "./ledger-core-utils.js";
import {
  buildCredentialDerivedCollectionToken,
  buildCredentialRecordCacheScope,
} from "./ledger-credential-cache.js";
import {
  buildStoreScopedDerivedCacheKey,
  cacheStoreDerivedView,
} from "./ledger-derived-cache.js";
import {
  buildCredentialRepairAggregatesInStore,
  listCredentialRepairHistoryInStore,
  listMigrationRepairViewsInStore,
  summarizeCredentialTimelineTimingInStore,
} from "./ledger-records.js";

export function summarizeCredentialTimelineTimingWithDeps(deps, record, repairHistory = []) {
  return summarizeCredentialTimelineTimingInStore(deps, record, repairHistory);
}

export function listMigrationRepairViewsWithDeps(deps, store, options = {}) {
  return listMigrationRepairViewsInStore(deps, store, options);
}

export function listCredentialRepairHistoryWithCache(
  deps,
  store,
  record,
  { didMethod = null, limit = 10, detailed = false } = {}
) {
  const normalizedRecord = deps.normalizeCredentialRecord(record);
  if (!normalizedRecord) {
    return [];
  }
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 10;
  const cacheLimit = Math.max(10, cappedLimit);
  const cacheKey = buildStoreScopedDerivedCacheKey(
    "credential_repair_history",
    store,
    buildCredentialDerivedCollectionToken(store),
    buildCredentialRecordCacheScope(
      normalizedRecord,
      [
        normalizeOptionalText(didMethod)?.toLowerCase() ?? "all_methods",
        detailed ? "detailed" : "summary",
      ].join(":")
    )
  );
  const cachedHistory = cacheStoreDerivedView(store, cacheKey, () =>
    listCredentialRepairHistoryInStore(deps, store, normalizedRecord, {
      didMethod,
      limit: cacheLimit,
      detailed,
    })
  );
  return cachedHistory.slice(0, cappedLimit);
}

export function buildCredentialRepairAggregatesWithDeps(deps, store, credentials = [], options = {}) {
  return buildCredentialRepairAggregatesInStore(deps, store, credentials, options);
}

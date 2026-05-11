import { normalizeOptionalText } from "./ledger-core-utils.js";
import { buildCollectionTailToken } from "./ledger-derived-cache.js";
import { normalizeCredentialRecord } from "./ledger-credential-core.js";

export function buildCredentialDerivedCollectionToken(store) {
  return [
    buildCollectionTailToken(store?.credentials || [], {
      idFields: ["credentialRecordId", "credentialId"],
      timeFields: ["updatedAt", "issuedAt"],
    }),
    `${Object.keys(store?.agents || {}).length}`,
    `${Array.isArray(store?.proposals) ? store.proposals.length : 0}`,
  ].join(":");
}

export function buildCredentialRecordCacheScope(record, suffix = null) {
  const normalizedRecord = normalizeCredentialRecord(record);
  const baseScope =
    normalizeOptionalText(normalizedRecord?.credentialRecordId) ??
    normalizeOptionalText(normalizedRecord?.credentialId) ??
    normalizeOptionalText(normalizedRecord?.statusListEntryId) ??
    normalizeOptionalText(normalizedRecord?.statusListId) ??
    normalizeOptionalText(normalizedRecord?.subjectId) ??
    "unknown";
  return suffix ? `${baseScope}:${suffix}` : baseScope;
}

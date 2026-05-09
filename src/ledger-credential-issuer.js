import {
  cloneJson,
  createRecordId,
  hashJson,
  normalizeOptionalText,
  normalizeTextList,
  now,
} from "./ledger-core-utils.js";
import {
  buildAgentComparisonSubjectId,
  buildAgentComparisonSubjectLabel,
} from "./ledger-agent-comparison.js";
import { buildCredentialDerivedCollectionToken } from "./ledger-credential-cache.js";
import {
  DEFAULT_CREDENTIAL_STATUS_PURPOSE,
  createCredentialRecord,
  formatCredentialExportVariants,
  listRequestedDidMethods,
  normalizeCredentialRecord,
  normalizeCredentialStatus,
  normalizeCredentialTimelineEntry,
  resolveAgentDidForMethod,
} from "./ledger-credential-core.js";
import {
  findCredentialRecordById,
  findLatestCredentialRecordForSubject,
} from "./ledger-credential-record-view.js";
import { allocateCredentialStatusPointer } from "./ledger-credential-status-list.js";
import {
  credentialRecordHasValidProof,
  credentialRecordUsesIssuerDid,
  credentialUsesAgentPassportSignature,
  credentialUsesCanonicalAgentPassportTypes,
} from "./ledger-credential-validation.js";
import {
  buildMigrationRepairSummary,
  collectMigrationRepairRelatedAgentIds,
} from "./ledger-repair-links.js";
import { AGENT_PASSPORT_MAIN_AGENT_ID } from "./main-agent-compat.js";
import { normalizeDidMethod } from "./protocol.js";

function requireCredentialIssuerDep(deps, name) {
  const value = deps?.[name];
  if (typeof value !== "function") {
    throw new Error(`credential issuer dependency is required: ${name}`);
  }
  return value;
}

function resolveAgentCredentialCacheDeps(deps = {}) {
  if (
    !deps.agentCredentialCache ||
    typeof deps.getCachedTimedSnapshot !== "function" ||
    typeof deps.setCachedTimedSnapshot !== "function" ||
    !Number.isFinite(Number(deps.cacheTtlMs))
  ) {
    return null;
  }

  return {
    cache: deps.agentCredentialCache,
    ttlMs: Number(deps.cacheTtlMs),
    getCachedTimedSnapshot: deps.getCachedTimedSnapshot,
    setCachedTimedSnapshot: deps.setCachedTimedSnapshot,
  };
}

function buildAgentCredentialPerformanceFingerprint(store, agent) {
  return hashJson({
    agentId: agent?.agentId ?? null,
    agentDid: normalizeOptionalText(agent?.identity?.did) ?? null,
    agentOriginDid: normalizeOptionalText(agent?.identity?.originDid) ?? null,
    credentials: buildCredentialDerivedCollectionToken(store),
  });
}

function buildAgentCredentialExportCacheKey(store, agent, { didMethod = null, issueBothMethods = false } = {}) {
  return hashJson({
    kind: "agent_credential",
    fingerprint: buildAgentCredentialPerformanceFingerprint(store, agent),
    agentId: agent.agentId,
    didMethod: normalizeDidMethod(didMethod) || null,
    issueBothMethods: Boolean(issueBothMethods),
  });
}

function buildCredentialExportVariant(store, method, credentialRecord, deps = {}) {
  const buildCredentialRecordView = requireCredentialIssuerDep(deps, "buildCredentialRecordView");
  return {
    didMethod: method,
    credential: credentialRecord ? cloneJson(normalizeCredentialRecord(credentialRecord)?.credential) : null,
    credentialRecord: credentialRecord ? buildCredentialRecordView(store, credentialRecord) : null,
    missing: !credentialRecord,
    persistent: Boolean(credentialRecord),
  };
}

export function ensureCredentialSnapshotRecord(
  store,
  { kind, subjectType, subjectId, issuerAgentId, issuerDid = null, buildCredential, source, note = null, extraRecord = {}, reuseMatcher = null }
) {
  const issuerAgent = issuerAgentId ? store.agents?.[issuerAgentId] ?? null : null;
  const resolvedIssuerDid = normalizeOptionalText(issuerDid) ?? issuerAgent?.identity?.did ?? null;
  const latest = findLatestCredentialRecordForSubject(store, {
    kind,
    subjectType,
    subjectId,
    issuerDid: resolvedIssuerDid,
    status: "active",
  });
  const currentLedgerHash = store.lastEventHash ?? null;

  if (
    latest &&
    normalizeOptionalText(latest.ledgerHash) === normalizeOptionalText(currentLedgerHash) &&
    credentialRecordHasValidProof(latest)
  ) {
    if (!reuseMatcher || reuseMatcher(latest)) {
      return { credentialRecord: latest, created: false };
    }
  }

  const statusPointer = allocateCredentialStatusPointer(store, {
    issuerAgentId,
    issuerDid: resolvedIssuerDid,
    statusPurpose: DEFAULT_CREDENTIAL_STATUS_PURPOSE,
  });
  const credential = buildCredential(statusPointer);
  const record = createCredentialRecord({
    credential,
    kind,
    subjectType,
    subjectId,
    issuerAgentId,
    relatedAgentIds: extraRecord.relatedAgentIds,
    comparisonDigest: extraRecord.comparisonDigest,
    comparisonLeftAgentId: extraRecord.comparisonLeftAgentId,
    comparisonRightAgentId: extraRecord.comparisonRightAgentId,
    comparisonLeftDid: extraRecord.comparisonLeftDid,
    comparisonRightDid: extraRecord.comparisonRightDid,
    comparisonLabel: extraRecord.comparisonLabel,
    statusListId: statusPointer.statusListId,
    statusListIndex: statusPointer.statusListIndex,
    statusPurpose: statusPointer.statusPurpose,
    issuedByAgentId: issuerAgentId,
    issuedByLabel: issuerAgent?.displayName ?? resolvedIssuerDid,
    issuedByDid: resolvedIssuerDid,
    issuedByWalletAddress: issuerAgent?.identity?.walletAddress ?? null,
    source,
    note,
  });

  if (!Array.isArray(store.credentials)) {
    store.credentials = [];
  }

  store.credentials.push(record);
  return { credentialRecord: record, created: true };
}

export function revokeCredentialRecord(record, payload = {}) {
  if (!record) {
    throw new Error("Credential not found");
  }

  const normalizedStatus = normalizeCredentialStatus(record.status);
  if (normalizedStatus === "revoked") {
    throw new Error(`Credential already revoked: ${record.credentialId}`);
  }

  const revokedByWindowId = normalizeOptionalText(payload.revokedByWindowId) ?? null;
  const revokedBy = {
    agentId: normalizeOptionalText(payload.revokedByAgentId) ?? null,
    label: normalizeOptionalText(payload.revokedByLabel) ?? null,
    did: normalizeOptionalText(payload.revokedByDid) ?? null,
    walletAddress: normalizeOptionalText(payload.revokedByWalletAddress)?.toLowerCase() ?? null,
    windowId: revokedByWindowId,
  };

  record.status = "revoked";
  record.revokedAt = now();
  record.updatedAt = record.revokedAt;
  record.revokedByAgentId = revokedBy.agentId;
  record.revokedByLabel = revokedBy.label;
  record.revokedByDid = revokedBy.did;
  record.revokedByWalletAddress = revokedBy.walletAddress;
  record.revokedByWindowId = revokedBy.windowId;
  record.revocationReason = normalizeOptionalText(payload.reason) ?? null;
  record.revocationNote = normalizeOptionalText(payload.note) ?? null;
  if (!Array.isArray(record.timeline)) {
    record.timeline = [];
  }
  record.timeline.push(
    normalizeCredentialTimelineEntry(
      {
        timelineId: createRecordId("credtl"),
        credentialRecordId: record.credentialRecordId,
        credentialId: record.credentialId,
        kind: "credential_revoked",
        timestamp: record.revokedAt,
        actorAgentId: revokedBy.agentId,
        actorLabel: revokedBy.label,
        actorDid: revokedBy.did,
        actorWalletAddress: revokedBy.walletAddress,
        actorWindowId: revokedBy.windowId,
        summary: `证据撤销：${record.subjectLabel || record.subjectId || record.credentialId}`,
        details: {
          credentialRecordId: record.credentialRecordId,
          credentialId: record.credentialId,
          statusListId: record.statusListId,
          statusListIndex: record.statusListIndex,
          statusPurpose: record.statusPurpose,
          reason: record.revocationReason,
          note: record.revocationNote,
          status: record.status,
        },
        source: "credential_revoke",
        order: 20,
      },
      {
        credentialRecordId: record.credentialRecordId,
        credentialId: record.credentialId,
        kind: "credential_revoked",
        timestamp: record.revokedAt,
        source: "credential_revoke",
      }
    )
  );

  return record;
}

export function ensureAgentCredentialSnapshot(store, agent, { didMethod = null } = {}, deps = {}) {
  const buildAgentCredential = requireCredentialIssuerDep(deps, "buildAgentCredential");
  const issuerDid = resolveAgentDidForMethod(store, agent, didMethod);
  return ensureCredentialSnapshotRecord(store, {
    kind: "agent_identity",
    subjectType: "agent",
    subjectId: agent.agentId,
    issuerAgentId: agent.agentId,
    issuerDid,
    buildCredential: (statusPointer) => buildAgentCredential(store, agent, statusPointer, { didMethod }),
    source: "agent_credential",
    note: `snapshot for ${agent.agentId}`,
    reuseMatcher: (latestRecord) =>
      credentialUsesAgentPassportSignature(latestRecord) &&
      credentialUsesCanonicalAgentPassportTypes(latestRecord) &&
      credentialRecordUsesIssuerDid(latestRecord, issuerDid),
  });
}

export function ensureAuthorizationCredentialSnapshot(store, proposal, { didMethod = null } = {}, deps = {}) {
  const ensureAgent = requireCredentialIssuerDep(deps, "ensureAgent");
  const buildAuthorizationProposalCredential = requireCredentialIssuerDep(deps, "buildAuthorizationProposalCredential");
  const policyAgent = ensureAgent(store, proposal.policyAgentId);
  const issuerDid = resolveAgentDidForMethod(store, policyAgent, didMethod);
  return ensureCredentialSnapshotRecord(store, {
    kind: "authorization_receipt",
    subjectType: "proposal",
    subjectId: proposal.proposalId,
    issuerAgentId: policyAgent.agentId,
    issuerDid,
    buildCredential: (statusPointer) => buildAuthorizationProposalCredential(store, proposal, statusPointer, { didMethod }),
    source: "proposal_credential",
    note: proposal.title ?? proposal.proposalId,
    reuseMatcher: (latestRecord) =>
      credentialUsesAgentPassportSignature(latestRecord) &&
      credentialUsesCanonicalAgentPassportTypes(latestRecord) &&
      credentialRecordUsesIssuerDid(latestRecord, issuerDid),
  });
}

export function findReusableAgentCredentialSnapshot(store, agent, { didMethod = null } = {}) {
  const issuerDid = resolveAgentDidForMethod(store, agent, didMethod);
  const latestRecord = findLatestCredentialRecordForSubject(store, {
    kind: "agent_identity",
    subjectType: "agent",
    subjectId: agent.agentId,
    issuerDid,
    status: "active",
  });
  return latestRecord &&
    credentialUsesAgentPassportSignature(latestRecord) &&
    credentialUsesCanonicalAgentPassportTypes(latestRecord) &&
    credentialRecordUsesIssuerDid(latestRecord, issuerDid)
    ? latestRecord
    : null;
}

export function findReusableAuthorizationCredentialSnapshot(store, proposal, { didMethod = null } = {}, deps = {}) {
  const ensureAgent = requireCredentialIssuerDep(deps, "ensureAgent");
  const policyAgent = ensureAgent(store, proposal.policyAgentId);
  const issuerDid = resolveAgentDidForMethod(store, policyAgent, didMethod);
  const latestRecord = findLatestCredentialRecordForSubject(store, {
    kind: "authorization_receipt",
    subjectType: "proposal",
    subjectId: proposal.proposalId,
    issuerDid,
    status: "active",
  });
  return latestRecord &&
    credentialUsesAgentPassportSignature(latestRecord) &&
    credentialUsesCanonicalAgentPassportTypes(latestRecord) &&
    credentialRecordUsesIssuerDid(latestRecord, issuerDid)
    ? latestRecord
    : null;
}

export function buildAgentCredentialExport(store, agent, { didMethod = null, issueBothMethods = false, persist = true } = {}, deps = {}) {
  const cacheDeps = resolveAgentCredentialCacheDeps(deps);
  const cacheKey = cacheDeps ? buildAgentCredentialExportCacheKey(store, agent, { didMethod, issueBothMethods }) : null;
  const cachedCredential = cacheDeps ? cacheDeps.getCachedTimedSnapshot(cacheDeps.cache, cacheKey, cacheDeps.ttlMs) : null;
  if (cachedCredential) {
    return {
      result: cachedCredential,
      createdAny: false,
      fromCache: true,
      commitCache: null,
    };
  }

  const methods = listRequestedDidMethods({ didMethod, issueBothMethods });
  const variants = [];
  let createdAny = false;

  for (const method of methods) {
    const credentialResult = persist
      ? ensureAgentCredentialSnapshot(store, agent, { didMethod: method }, deps)
      : {
          credentialRecord: findReusableAgentCredentialSnapshot(store, agent, { didMethod: method }, deps),
          created: false,
        };
    const { credentialRecord, created } = credentialResult;
    if (created) {
      createdAny = true;
    }

    variants.push(buildCredentialExportVariant(store, method, credentialRecord, deps));
  }

  const result = formatCredentialExportVariants(variants);
  const commitCache = cacheDeps
    ? () => {
        const nextCacheKey = buildAgentCredentialExportCacheKey(store, agent, { didMethod, issueBothMethods });
        cacheDeps.setCachedTimedSnapshot(cacheDeps.cache, nextCacheKey, result);
      }
    : null;

  return {
    result,
    createdAny,
    fromCache: false,
    commitCache,
  };
}

export function buildAuthorizationProposalCredentialExport(
  store,
  proposal,
  { didMethod = null, issueBothMethods = false, persist = true } = {},
  deps = {}
) {
  const methods = listRequestedDidMethods({ didMethod, issueBothMethods });
  const variants = [];
  let createdAny = false;

  for (const method of methods) {
    const credentialResult = persist
      ? ensureAuthorizationCredentialSnapshot(store, proposal, { didMethod: method }, deps)
      : {
          credentialRecord: findReusableAuthorizationCredentialSnapshot(store, proposal, { didMethod: method }, deps),
          created: false,
        };
    const { credentialRecord, created } = credentialResult;
    if (created) {
      createdAny = true;
    }

    variants.push(buildCredentialExportVariant(store, method, credentialRecord, deps));
  }

  return {
    result: formatCredentialExportVariants(variants),
    createdAny,
  };
}

export function exportAgentCredentialInStore(
  store,
  agentId,
  { didMethod = null, issueBothMethods = false, persist = true } = {},
  deps = {}
) {
  const ensureAgent = requireCredentialIssuerDep(deps, "ensureAgent");
  const agent = ensureAgent(store, agentId);
  return buildAgentCredentialExport(store, agent, {
    didMethod,
    issueBothMethods,
    persist,
  }, deps);
}

export function exportAuthorizationProposalCredentialInStore(
  store,
  proposalId,
  { didMethod = null, issueBothMethods = false, persist = true } = {},
  deps = {}
) {
  const ensureAuthorizationProposal = requireCredentialIssuerDep(deps, "ensureAuthorizationProposal");
  const proposal = ensureAuthorizationProposal(store, proposalId);
  return buildAuthorizationProposalCredentialExport(store, proposal, {
    didMethod,
    issueBothMethods,
    persist,
  }, deps);
}

export function revokeCredentialInStore(store, credentialId, payload = {}, deps = {}) {
  const buildCredentialRecordView = requireCredentialIssuerDep(deps, "buildCredentialRecordView");
  const record = findCredentialRecordById(store, credentialId);
  if (!record) {
    throw new Error(`Credential not found: ${credentialId}`);
  }

  revokeCredentialRecord(record, payload);
  return {
    credentialRecord: buildCredentialRecordView(store, record),
    credential: cloneJson(normalizeCredentialRecord(record)?.credential),
  };
}

export function issueMigrationRepairReceipt(
  store,
  repair,
  { issuerAgentId = null, receiptDidMethod = null, issueBothMethods = false } = {},
  deps = {}
) {
  const ensureAgent = requireCredentialIssuerDep(deps, "ensureAgent");
  const resolveDefaultResidentAgentId = requireCredentialIssuerDep(deps, "resolveDefaultResidentAgentId");
  const buildCredentialRecordView = requireCredentialIssuerDep(deps, "buildCredentialRecordView");
  const buildMigrationRepairReceiptCredential = requireCredentialIssuerDep(deps, "buildMigrationRepairReceiptCredential");
  const resolvedIssuerAgent = ensureAgent(
    store,
    normalizeOptionalText(issuerAgentId) || repair.agentId || repair.issuerAgentId || resolveDefaultResidentAgentId(store)
  );
  const repairId = normalizeOptionalText(repair.repairId) || createRecordId("repair");
  const summary = normalizeOptionalText(repair.summary) || buildMigrationRepairSummary(repair);
  const requestedMethods = listRequestedDidMethods({
    didMethod: receiptDidMethod || normalizeTextList(repair.requestedDidMethods)[0] || undefined,
    issueBothMethods,
    allowCompatibilityIssue: true,
  });
  const issuedAt = now();
  const variants = [];

  if (!Array.isArray(store.credentials)) {
    store.credentials = [];
  }

  for (const method of requestedMethods) {
    const resolvedIssuerDid = resolveAgentDidForMethod(store, resolvedIssuerAgent, method);
    const statusPointer = allocateCredentialStatusPointer(store, {
      issuerAgentId: resolvedIssuerAgent.agentId,
      issuerDid: resolvedIssuerDid,
      statusPurpose: DEFAULT_CREDENTIAL_STATUS_PURPOSE,
    });
    const credential = buildMigrationRepairReceiptCredential(
      store,
      {
        ...repair,
        repairId,
        summary,
      },
      {
        issuerAgentId: resolvedIssuerAgent.agentId,
        issuerDid: resolvedIssuerDid,
        issuerDidMethod: method,
        statusPointer,
        issuanceDate: issuedAt,
      }
    );
    const record = createCredentialRecord({
      credential,
      kind: "migration_receipt",
      subjectType: "repair",
      subjectId: repairId,
      issuerAgentId: resolvedIssuerAgent.agentId,
      relatedAgentIds: collectMigrationRepairRelatedAgentIds(repair, resolvedIssuerAgent.agentId),
      statusListId: statusPointer.statusListId,
      statusListIndex: statusPointer.statusListIndex,
      statusPurpose: statusPointer.statusPurpose,
      issuedByAgentId: resolvedIssuerAgent.agentId,
      issuedByLabel: resolvedIssuerAgent.displayName ?? resolvedIssuerDid,
      issuedByDid: resolvedIssuerDid,
      issuedByWalletAddress: resolvedIssuerAgent.identity?.walletAddress ?? null,
      source: "migration_repair",
      note: summary,
    });
    store.credentials.push(record);
    variants.push({
      didMethod: method,
      credential: cloneJson(record.credential) ?? null,
      credentialRecord: buildCredentialRecordView(store, record),
    });
  }

  return formatCredentialExportVariants(variants);
}

export function ensureAgentComparisonCredentialSnapshot(
  store,
  comparisonResult,
  { issuerAgentId = AGENT_PASSPORT_MAIN_AGENT_ID, issuerDid = null, issuerDidMethod = null, issuerWalletAddress = null } = {},
  deps = {}
) {
  const resolveAgentReferenceFromStore = requireCredentialIssuerDep(deps, "resolveAgentReferenceFromStore");
  const buildAgentComparisonEvidenceCredential = requireCredentialIssuerDep(deps, "buildAgentComparisonEvidenceCredential");
  const resolvedIssuerAgentId = normalizeOptionalText(issuerAgentId);
  const requestedIssuerDid = normalizeOptionalText(issuerDid) ?? null;
  const issuerResolution = resolveAgentReferenceFromStore(store, {
    agentId: resolvedIssuerAgentId || (!requestedIssuerDid && !normalizeOptionalText(issuerWalletAddress) ? AGENT_PASSPORT_MAIN_AGENT_ID : null),
    did: requestedIssuerDid,
    walletAddress: normalizeOptionalText(issuerWalletAddress) ?? null,
  });
  const issuerAgent = issuerResolution.agent;
  const resolvedIssuerDid = requestedIssuerDid || resolveAgentDidForMethod(store, issuerAgent, issuerDidMethod);
  const subjectId = buildAgentComparisonSubjectId(comparisonResult);
  const subjectLabel = buildAgentComparisonSubjectLabel(comparisonResult);
  const leftSnapshot = comparisonResult?.left?.snapshot ?? null;
  const rightSnapshot = comparisonResult?.right?.snapshot ?? null;
  const relatedAgentIds = [
    issuerAgent.agentId,
    leftSnapshot?.agentId,
    rightSnapshot?.agentId,
  ].filter(Boolean);

  return ensureCredentialSnapshotRecord(store, {
    kind: "agent_comparison",
    subjectType: "comparison",
    subjectId,
    issuerAgentId: issuerAgent.agentId,
    issuerDid: resolvedIssuerDid,
    buildCredential: (statusPointer) =>
      buildAgentComparisonEvidenceCredential(store, comparisonResult, {
        issuerAgentId: issuerAgent.agentId,
        issuerDid: resolvedIssuerDid,
        issuerDidMethod,
        statusPointer,
      }).credential,
    source: "comparison_evidence",
    note: subjectLabel,
    extraRecord: {
      relatedAgentIds,
      comparisonDigest: comparisonResult?.comparisonDigest ?? null,
      comparisonLeftAgentId: leftSnapshot?.agentId ?? null,
      comparisonRightAgentId: rightSnapshot?.agentId ?? null,
      comparisonLeftDid: leftSnapshot?.did ?? null,
      comparisonRightDid: rightSnapshot?.did ?? null,
      comparisonLabel: comparisonResult?.comparison?.summary ?? subjectLabel,
    },
    reuseMatcher: (latestRecord) =>
      credentialUsesAgentPassportSignature(latestRecord) &&
      credentialUsesCanonicalAgentPassportTypes(latestRecord) &&
      credentialRecordUsesIssuerDid(latestRecord, resolvedIssuerDid) &&
      normalizeOptionalText(latestRecord?.comparisonDigest) === normalizeOptionalText(comparisonResult?.comparisonDigest),
  });
}

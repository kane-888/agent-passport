import {
  buildDidDocument,
  buildDidSigningKeyId,
  deriveDid,
  inferDidAliases,
  parseDidReference,
} from "./identity.js";
import {
  cloneJson,
  hashJson,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import {
  DEFAULT_CREDENTIAL_STATUS_ENTRY_TYPE,
  DEFAULT_CREDENTIAL_STATUS_PURPOSE,
  buildLocalCredential,
  compareCredentialIds,
  credentialSnapshotPurpose,
  credentialStatusListIssuerDidFromId,
  normalizeCredentialRecord,
  normalizeCredentialStatus,
  normalizeCredentialStatusListReference,
} from "./ledger-credential-core.js";
import {
  buildCredentialDerivedCollectionToken,
  buildCredentialRecordCacheScope,
} from "./ledger-credential-cache.js";
import { credentialSubjectLabel } from "./ledger-credential-labels.js";
import {
  buildCollectionTailToken,
  buildStoreScopedDerivedCacheKey,
  cacheStoreDerivedView,
} from "./ledger-derived-cache.js";
import {
  compareSignedSet,
  findAgentByDid,
  resolveDefaultResidentAgent,
  resolveDefaultResidentAgentId,
  resolveStoredAgent,
} from "./ledger-identity-compat.js";
import {
  STATUS_LIST_CREDENTIAL_TYPE,
  STATUS_LIST_EVIDENCE_TYPE,
  STATUS_LIST_PROOF_TYPE,
  STATUS_LIST_SUBJECT_TYPE,
} from "./protocol.js";
import { resolveAgentPassportChainId } from "./runtime-path-config.js";

const DEFAULT_CHAIN_ID = resolveAgentPassportChainId({ fallback: "agent-passport-alpha" });
const DEFAULT_CREDENTIAL_STATUS_LIST_TYPE = STATUS_LIST_CREDENTIAL_TYPE;

export function credentialStatusListIssuerAgent(store, issuerDid = null) {
  const normalizedIssuerDid = normalizeOptionalText(issuerDid) ?? null;
  if (normalizedIssuerDid) {
    return findAgentByDid(store, normalizedIssuerDid) ?? resolveDefaultResidentAgent(store);
  }

  return resolveDefaultResidentAgent(store);
}

export function credentialStatusListIssuerDid(store, issuerDid = null) {
  const normalizedIssuerDid = normalizeOptionalText(issuerDid) ?? null;
  if (normalizedIssuerDid) {
    return normalizedIssuerDid;
  }

  return (
    credentialStatusListIssuerAgent(store)?.identity?.did ??
    deriveDid(store?.chainId || DEFAULT_CHAIN_ID, resolveDefaultResidentAgentId(store))
  );
}

export function credentialStatusListId(store, issuerDid = null) {
  return `${credentialStatusListIssuerDid(store, issuerDid)}#status-list-${DEFAULT_CREDENTIAL_STATUS_PURPOSE}`;
}

export function resolveCredentialStatusListReference(store, { issuerAgentId = null, issuerDid = null, statusListId = null } = {}) {
  const normalizedStatusListId = normalizeCredentialStatusListReference(statusListId) ?? null;
  const derivedIssuerDid = credentialStatusListIssuerDidFromId(normalizedStatusListId);
  const normalizedIssuerDid = normalizeOptionalText(issuerDid) ?? derivedIssuerDid ?? null;
  const issuerAgent = normalizedIssuerDid
    ? credentialStatusListIssuerAgent(store, normalizedIssuerDid)
    : issuerAgentId
      ? resolveStoredAgent(store, issuerAgentId) ?? null
      : credentialStatusListIssuerAgent(store);
  const resolvedIssuerDid =
    normalizedIssuerDid ??
    issuerAgent?.identity?.did ??
    deriveDid(store?.chainId || DEFAULT_CHAIN_ID, resolveDefaultResidentAgentId(store));
  const resolvedStatusListId = normalizedStatusListId ?? credentialStatusListId(store, resolvedIssuerDid);

  return {
    issuerAgent,
    issuerDid: resolvedIssuerDid,
    statusListId: resolvedStatusListId,
  };
}

export function getCredentialStatusIndexMap(store) {
  const value = store?.nextCredentialStatusIndices;
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.entries(value).reduce((acc, [key, nextIndex]) => {
    const normalizedKey = normalizeCredentialStatusListReference(key) ?? null;
    if (!normalizedKey) {
      return acc;
    }

    acc[normalizedKey] = Number.isFinite(Number(nextIndex)) ? Math.max(0, Math.floor(Number(nextIndex))) : 0;
    return acc;
  }, {});
}

export function setCredentialStatusIndexMap(store, nextIndices = {}) {
  if (!store) {
    return;
  }

  store.nextCredentialStatusIndices = Object.entries(nextIndices).reduce((acc, [key, nextIndex]) => {
    const normalizedKey = normalizeCredentialStatusListReference(key) ?? null;
    if (!normalizedKey) {
      return acc;
    }

    acc[normalizedKey] = Number.isFinite(Number(nextIndex)) ? Math.max(0, Math.floor(Number(nextIndex))) : 0;
    return acc;
  }, {});
  const values = Object.values(store.nextCredentialStatusIndices);
  store.nextCredentialStatusIndex = values.length > 0 ? Math.max(...values) : 0;
}

export function getNextCredentialStatusIndex(store, statusListId) {
  const normalizedStatusListId = normalizeCredentialStatusListReference(statusListId) ?? null;
  if (!normalizedStatusListId) {
    return 0;
  }

  const indexMap = getCredentialStatusIndexMap(store);
  if (Number.isFinite(Number(indexMap[normalizedStatusListId]))) {
    return Math.max(0, Math.floor(Number(indexMap[normalizedStatusListId])));
  }

  return normalizedStatusListId === credentialStatusListId(store)
    ? Number.isFinite(Number(store?.nextCredentialStatusIndex))
      ? Math.max(0, Math.floor(Number(store.nextCredentialStatusIndex)))
      : 0
    : 0;
}

export function allocateCredentialStatusPointer(store, record = {}) {
  const { statusListId, issuerDid } = resolveCredentialStatusListReference(store, record);
  const indexMap = getCredentialStatusIndexMap(store);
  const resolvedIndex = getNextCredentialStatusIndex(store, statusListId);
  const statusListIndex = Number.isFinite(Number(record.statusListIndex))
    ? Math.max(0, Math.floor(Number(record.statusListIndex)))
    : resolvedIndex;
  const statusPurpose = normalizeOptionalText(record.statusPurpose) ?? DEFAULT_CREDENTIAL_STATUS_PURPOSE;

  const nextIndex = Math.max(indexMap[statusListId] ?? 0, statusListIndex + 1);
  indexMap[statusListId] = nextIndex;
  setCredentialStatusIndexMap(store, indexMap);

  return {
    statusListId,
    issuerDid,
    statusListIndex,
    statusPurpose,
    statusListCredentialId: `${statusListId}#credential`,
    statusListEntryId: `${statusListId}#entry-${statusListIndex}`,
  };
}

export function collectCredentialStatusIssuerDids(store) {
  const issuerDids = new Set();
  for (const agent of Object.values(store?.agents || {})) {
    const agentDid = normalizeOptionalText(agent?.identity?.did) ?? null;
    if (agentDid) {
      issuerDids.add(agentDid);
    }
  }

  for (const record of store?.credentials || []) {
    const issuerDid =
      normalizeOptionalText(record?.issuerDid) ??
      credentialStatusListIssuerDidFromId(record?.statusListId) ??
      null;
    if (issuerDid) {
      issuerDids.add(issuerDid);
    }
  }

  if (!issuerDids.size) {
    issuerDids.add(credentialStatusListIssuerDid(store));
  }

  return [...issuerDids];
}

export function buildCredentialStatusLists(store, { issuerDid = null } = {}) {
  const normalizedIssuerDid = normalizeOptionalText(issuerDid) ?? null;
  const cacheKey = buildStoreScopedDerivedCacheKey(
    "credential_status_lists",
    store,
    [
      buildCollectionTailToken(store?.credentials || [], {
        idFields: ["credentialRecordId", "credentialId"],
        timeFields: ["updatedAt", "issuedAt"],
      }),
      `${Object.keys(store?.agents || {}).length}`,
    ].join(":"),
    normalizedIssuerDid || "all"
  );
  return cacheStoreDerivedView(store, cacheKey, () => {
    const issuerDids = normalizedIssuerDid ? [normalizedIssuerDid] : collectCredentialStatusIssuerDids(store);
    return issuerDids.map((did) => buildCredentialStatusList(store, did));
  });
}

export function buildCredentialStatusList(store, issuerDid = null) {
  const resolvedIssuerDid = credentialStatusListIssuerDid(store, issuerDid);
  const cacheKey = buildStoreScopedDerivedCacheKey(
    "credential_status_list",
    store,
    [
      buildCollectionTailToken(store?.credentials || [], {
        idFields: ["credentialRecordId", "credentialId"],
        timeFields: ["updatedAt", "issuedAt"],
      }),
      `${Object.keys(store?.agents || {}).length}`,
    ].join(":"),
    resolvedIssuerDid
  );
  return cacheStoreDerivedView(store, cacheKey, () => {
    const issuerAgent = credentialStatusListIssuerAgent(store, resolvedIssuerDid);
    const statusListId = credentialStatusListId(store, resolvedIssuerDid);
    const sourceRecords = (store?.credentials || [])
      .filter((record) => {
        const recordIssuerDid =
          normalizeOptionalText(record?.issuerDid) ??
          credentialStatusListIssuerDidFromId(record?.statusListId) ??
          null;
        const recordStatusListId = normalizeCredentialStatusListReference(record?.statusListId) ?? null;
        return recordIssuerDid === resolvedIssuerDid || recordStatusListId === statusListId;
      })
      .map((record) =>
        normalizeCredentialRecord(record, {
          chainId: store.chainId,
          statusListId,
          statusPurpose: DEFAULT_CREDENTIAL_STATUS_PURPOSE,
          issuerDid: resolvedIssuerDid,
          agentId: record?.subjectType === "agent" ? record?.subjectId : record?.issuerAgentId ?? null,
          proposalId: record?.subjectType === "proposal" ? record?.subjectId : null,
        })
      )
      .filter(Boolean)
      .sort((a, b) => {
        const indexA = Number.isFinite(Number(a.statusListIndex)) ? Math.max(0, Math.floor(Number(a.statusListIndex))) : Number.POSITIVE_INFINITY;
        const indexB = Number.isFinite(Number(b.statusListIndex)) ? Math.max(0, Math.floor(Number(b.statusListIndex))) : Number.POSITIVE_INFINITY;
        if (indexA !== indexB) {
          return indexA - indexB;
        }

        return compareCredentialIds(a.credentialRecordId || a.credentialId, b.credentialRecordId || b.credentialId);
      });

    const entries = sourceRecords
      .map((record) => {
        const statusListIndex = Number.isFinite(Number(record.statusListIndex)) ? Math.max(0, Math.floor(Number(record.statusListIndex))) : null;
        if (statusListIndex == null) {
          return null;
        }

        const status = normalizeCredentialStatus(record.status);
        const statusBit = status === "revoked" ? 1 : 0;

        return {
          statusListIndex,
          statusBit,
          credentialRecordId: record.credentialRecordId,
          credentialId: record.credentialId,
          statusListEntryId: record.statusListEntryId || `${statusListId}#entry-${statusListIndex}`,
          statusListId,
          statusListCredentialId: record.statusListCredentialId || `${statusListId}#credential`,
          statusPurpose: record.statusPurpose || DEFAULT_CREDENTIAL_STATUS_PURPOSE,
          status,
          subjectType: record.subjectType,
          subjectId: record.subjectId,
          subjectLabel: credentialSubjectLabel(store, record),
          issuerAgentId: record.issuerAgentId,
          issuerDid: record.issuerDid,
          issuedAt: record.issuedAt,
          updatedAt: record.updatedAt,
          revokedAt: record.revokedAt,
          revocationReason: record.revocationReason,
          revocationNote: record.revocationNote,
          ledgerHash: record.ledgerHash,
          proofValue: record.proofValue,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.statusListIndex - b.statusListIndex);

    const bitstring = entries.map((entry) => String(entry.statusBit)).join("");
    const activeCount = entries.filter((entry) => entry.status === "active").length;
    const revokedCount = entries.filter((entry) => entry.status === "revoked").length;
    const issuedAt = store?.createdAt || now();
    const updatedAt = now();
    const statusListCredential = buildLocalCredential({
      issuerDid: resolvedIssuerDid,
      verificationMethod: buildDidSigningKeyId(resolvedIssuerDid),
      credentialType: DEFAULT_CREDENTIAL_STATUS_LIST_TYPE,
      issuanceDate: updatedAt,
      chainId: store.chainId,
      ledgerHash: store.lastEventHash ?? null,
      credentialSubject: {
        id: statusListId,
        type: STATUS_LIST_SUBJECT_TYPE,
        statusPurpose: DEFAULT_CREDENTIAL_STATUS_PURPOSE,
        chainId: store.chainId,
        issuerAgentId: issuerAgent?.agentId ?? null,
        issuerDid: resolvedIssuerDid,
        ledgerHash: store.lastEventHash ?? null,
        issuedAt,
        updatedAt,
        totalEntries: entries.length,
        activeCount,
        revokedCount,
        bitstring,
        entries,
      },
      evidence: {
        type: STATUS_LIST_EVIDENCE_TYPE,
        statusPurpose: DEFAULT_CREDENTIAL_STATUS_PURPOSE,
        statusListId,
        entryCount: entries.length,
        bitstring,
      },
    });
    statusListCredential.id = `${statusListId}#credential`;

    return {
      statusListId,
      issuerAgentId: issuerAgent?.agentId ?? null,
      issuerLabel: issuerAgent?.displayName ?? resolvedIssuerDid,
      issuerDid: resolvedIssuerDid,
      statusPurpose: DEFAULT_CREDENTIAL_STATUS_PURPOSE,
      credential: statusListCredential,
      summary: {
        statusListId,
        statusListCredentialId: statusListCredential.id,
        issuerAgentId: issuerAgent?.agentId ?? null,
        issuerLabel: issuerAgent?.displayName ?? resolvedIssuerDid,
        issuerDid: resolvedIssuerDid,
        statusPurpose: DEFAULT_CREDENTIAL_STATUS_PURPOSE,
        chainId: store.chainId,
        ledgerHash: store.lastEventHash ?? null,
        issuedAt,
        updatedAt,
        totalEntries: entries.length,
        activeCount,
        revokedCount,
        bitstring,
        proofValue: statusListCredential.proof?.proofValue ?? null,
      },
      entries,
    };
  });
}

export function buildCredentialStatusListIssuerProfile(store, statusList) {
  const issuerAgent =
    statusList?.issuerAgentId
      ? store?.agents?.[statusList.issuerAgentId] ?? findAgentByDid(store, statusList.issuerDid)
      : findAgentByDid(store, statusList?.issuerDid);
  const preferredDid = normalizeOptionalText(statusList?.issuerDid) ?? issuerAgent?.identity?.did ?? null;
  const preferredDidRef = parseDidReference(preferredDid);
  const identity = issuerAgent?.identity || null;
  const signers = Array.isArray(identity?.authorizationPolicy?.signers)
    ? identity.authorizationPolicy.signers.map((signer) => cloneJson(signer))
    : [];
  const controllers = Array.isArray(identity?.controllers)
    ? identity.controllers.map((controller) => cloneJson(controller))
    : [];

  return {
    agentId: issuerAgent?.agentId ?? null,
    displayName: issuerAgent?.displayName ?? null,
    role: issuerAgent?.role ?? null,
    controller: issuerAgent?.controller ?? null,
    did: preferredDid,
    walletAddress: identity?.walletAddress ?? null,
    walletScheme: identity?.walletScheme ?? null,
    originDid: identity?.originDid ?? null,
    policyType: identity?.authorizationPolicy?.type ?? null,
    threshold: identity?.authorizationPolicy?.threshold ?? null,
    signerCount: signers.length,
    controllers,
    signers,
    didAliases: preferredDid ? inferDidAliases(preferredDid, issuerAgent?.agentId ?? null) : [],
    didDocument: issuerAgent ? buildDidDocument(issuerAgent, { method: preferredDidRef?.method ?? null }) : null,
  };
}

export function buildCredentialStatusListComparison(store, leftStatusList, rightStatusList) {
  const leftProfile = buildCredentialStatusListIssuerProfile(store, leftStatusList);
  const rightProfile = buildCredentialStatusListIssuerProfile(store, rightStatusList);
  const sameChainId = Boolean(leftStatusList?.summary?.chainId && leftStatusList.summary.chainId === rightStatusList?.summary?.chainId);
  const sameIssuerDid = Boolean(leftProfile.did && leftProfile.did === rightProfile.did);
  const sameIssuerAgentId = Boolean(leftProfile.agentId && leftProfile.agentId === rightProfile.agentId);
  const sameWalletAddress = Boolean(leftProfile.walletAddress && leftProfile.walletAddress === rightProfile.walletAddress);
  const samePolicyType = Boolean(leftProfile.policyType && leftProfile.policyType === rightProfile.policyType);
  const sameThreshold = Boolean(
    Number.isFinite(Number(leftProfile.threshold)) &&
      Number.isFinite(Number(rightProfile.threshold)) &&
      Number(leftProfile.threshold) === Number(rightProfile.threshold)
  );
  const signerComparison = compareSignedSet(leftProfile.signers, rightProfile.signers);
  const controllerComparison = compareSignedSet(leftProfile.controllers, rightProfile.controllers);
  const sameLedgerHash = Boolean(leftStatusList?.summary?.ledgerHash && leftStatusList.summary.ledgerHash === rightStatusList?.summary?.ledgerHash);
  const sameProofValue = Boolean(leftStatusList?.summary?.proofValue && leftStatusList.summary.proofValue === rightStatusList?.summary?.proofValue);
  const samePurpose = Boolean(leftStatusList?.statusPurpose && leftStatusList.statusPurpose === rightStatusList?.statusPurpose);

  const leftEntries = Array.isArray(leftStatusList?.entries) ? leftStatusList.entries : [];
  const rightEntries = Array.isArray(rightStatusList?.entries) ? rightStatusList.entries : [];
  const leftEntryMap = new Map();
  for (const entry of leftEntries) {
    const key = entry?.credentialRecordId || entry?.credentialId || entry?.statusListEntryId || null;
    if (key && !leftEntryMap.has(key)) {
      leftEntryMap.set(key, entry);
    }
  }

  const rightEntryMap = new Map();
  for (const entry of rightEntries) {
    const key = entry?.credentialRecordId || entry?.credentialId || entry?.statusListEntryId || null;
    if (key && !rightEntryMap.has(key)) {
      rightEntryMap.set(key, entry);
    }
  }

  const sharedEntries = [];
  const leftOnlyEntries = [];
  for (const [key, entry] of leftEntryMap.entries()) {
    if (rightEntryMap.has(key)) {
      sharedEntries.push(entry);
    } else {
      leftOnlyEntries.push(entry);
    }
  }

  const rightOnlyEntries = [];
  for (const [key, entry] of rightEntryMap.entries()) {
    if (!leftEntryMap.has(key)) {
      rightOnlyEntries.push(entry);
    }
  }

  return {
    left: {
      ...leftStatusList,
      issuerIdentity: leftProfile,
    },
    right: {
      ...rightStatusList,
      issuerIdentity: rightProfile,
    },
    comparison: {
      sameChainId,
      sameIssuerDid,
      sameIssuerAgentId,
      sameWalletAddress,
      samePolicyType,
      sameThreshold,
      sameSignerSet: signerComparison.same,
      sameControllerSet: controllerComparison.same,
      sameLedgerHash,
      sameProofValue,
      samePurpose,
      leftEntryCount: leftEntries.length,
      rightEntryCount: rightEntries.length,
      sharedCount: sharedEntries.length,
      leftOnlyCount: leftOnlyEntries.length,
      rightOnlyCount: rightOnlyEntries.length,
      leftEntrySummary: leftEntries.slice(0, 10),
      rightEntrySummary: rightEntries.slice(0, 10),
      sharedEntrySummary: sharedEntries.slice(0, 10),
      leftOnlyEntrySummary: leftOnlyEntries.slice(0, 10),
      rightOnlyEntrySummary: rightOnlyEntries.slice(0, 10),
      issuerSummary: {
        left: leftProfile,
        right: rightProfile,
      },
      signerComparison,
      controllerComparison,
      summary: [
        sameIssuerDid ? "同一 DID" : "不同 DID",
        sameWalletAddress ? "同一钱包" : "不同钱包",
        samePolicyType ? `policy ${leftProfile.policyType || "unknown"}` : "policy 不同",
        sameThreshold ? `threshold ${leftProfile.threshold ?? "unknown"}` : "threshold 不同",
        signerComparison.same ? "签名者集合一致" : "签名者集合不同",
        controllerComparison.same ? "控制人集合一致" : "控制人集合不同",
        sameChainId ? "同一 chain" : "chain 不同",
        samePurpose ? `purpose ${leftStatusList?.statusPurpose || "unknown"}` : "purpose 不同",
      ]
        .filter(Boolean)
        .join(" · "),
    },
  };
}

export function buildCredentialStatusProof(store, record) {
  const resolvedStatusListId =
    normalizeCredentialStatusListReference(record?.statusListId) ??
    credentialStatusListId(store, normalizeOptionalText(record?.issuerDid) ?? null);
  const resolvedIssuerDid =
    credentialStatusListIssuerDidFromId(resolvedStatusListId) ??
    normalizeOptionalText(record?.issuerDid) ??
    credentialStatusListIssuerDid(store);
  const normalizedRecord = normalizeCredentialRecord(record, {
    chainId: store.chainId,
    statusListId: resolvedStatusListId,
    statusPurpose: DEFAULT_CREDENTIAL_STATUS_PURPOSE,
    issuerDid: resolvedIssuerDid,
    agentId: record?.subjectType === "agent" ? record?.subjectId : record?.issuerAgentId ?? null,
    proposalId: record?.subjectType === "proposal" ? record?.subjectId : null,
  });

  if (!normalizedRecord) {
    return null;
  }
  const cacheKey = buildStoreScopedDerivedCacheKey(
    "credential_status_proof",
    store,
    buildCredentialDerivedCollectionToken(store),
    buildCredentialRecordCacheScope(normalizedRecord)
  );
  return cacheStoreDerivedView(store, cacheKey, () => {
    const statusList = buildCredentialStatusList(store, resolvedIssuerDid);
    const statusEntry =
      statusList.entries.find((entry) => entry.credentialRecordId === normalizedRecord.credentialRecordId) ||
      statusList.entries.find((entry) => entry.credentialId === normalizedRecord.credentialId) ||
      statusList.entries.find((entry) => entry.statusListIndex === normalizedRecord.statusListIndex) ||
      null;
    const status = normalizeCredentialStatus(normalizedRecord.status);
    const statusBit = status === "revoked" ? 1 : 0;
    const statusListIndex = Number.isFinite(Number(normalizedRecord.statusListIndex))
      ? Math.max(0, Math.floor(Number(normalizedRecord.statusListIndex)))
      : statusEntry?.statusListIndex ?? null;
    const statusListCredentialId = statusList.summary.statusListCredentialId;
    const statusSnapshot = {
      credentialRecordId: normalizedRecord.credentialRecordId,
      credentialId: normalizedRecord.credentialId,
      statusListId: statusList.statusListId,
      statusListCredentialId,
      statusListIndex,
      statusPurpose: normalizedRecord.statusPurpose || DEFAULT_CREDENTIAL_STATUS_PURPOSE,
      status,
      statusBit,
      statusListHash: statusList.summary.proofValue,
      statusListLedgerHash: statusList.summary.ledgerHash,
      registryKnown: Boolean(statusEntry),
      registryStatus: statusEntry?.status ?? status,
      registryFresh: statusList.summary.ledgerHash === (store.lastEventHash ?? null),
      statusMatchesRegistry: statusEntry ? statusEntry.status === status && statusEntry.statusBit === statusBit : false,
      revokedAt: normalizedRecord.revokedAt ?? null,
      revocationReason: normalizedRecord.revocationReason ?? null,
      revocationNote: normalizedRecord.revocationNote ?? null,
      updatedAt: normalizedRecord.updatedAt ?? null,
      issuedAt: normalizedRecord.issuedAt ?? null,
    };

    const proof = {
      type: STATUS_LIST_PROOF_TYPE,
      created: now(),
      proofPurpose: "revocation",
      verificationMethod: buildDidSigningKeyId(statusList.issuerDid),
      proofValue: hashJson(statusSnapshot),
      hashAlgorithm: "sha256",
    };

    return {
      credentialRecordId: normalizedRecord.credentialRecordId,
      credentialId: normalizedRecord.credentialId,
      credentialStatus: {
        id: normalizedRecord.statusListEntryId || `${statusList.statusListId}#entry-${statusListIndex ?? 0}`,
        type: DEFAULT_CREDENTIAL_STATUS_ENTRY_TYPE,
        statusPurpose: normalizedRecord.statusPurpose || DEFAULT_CREDENTIAL_STATUS_PURPOSE,
        statusListIndex,
        statusListCredential: statusListCredentialId,
        statusListId: statusList.statusListId,
        chainId: store.chainId,
        ledgerHash: store.lastEventHash ?? null,
        agentId: normalizedRecord.subjectType === "agent" ? normalizedRecord.subjectId : normalizedRecord.issuerAgentId ?? null,
        proposalId: normalizedRecord.subjectType === "proposal" ? normalizedRecord.subjectId : null,
        snapshotPurpose: credentialSnapshotPurpose(normalizedRecord),
      },
      status,
      statusBit,
      statusProof: {
        ...statusSnapshot,
        proof,
      },
      statusList: {
        credential: statusList.credential,
        summary: statusList.summary,
        entries: statusList.entries,
      },
      statusListCredential: statusList.credential,
      statusListSummary: statusList.summary,
      statusEntry,
    };
  });
}

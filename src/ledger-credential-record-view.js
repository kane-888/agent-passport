import {
  cloneJson,
  createRecordId,
  hashJson,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import {
  buildCredentialDerivedCollectionToken,
  buildCredentialRecordCacheScope,
} from "./ledger-credential-cache.js";
import {
  buildCredentialDidMethodAvailability,
  compareCredentialIds,
  compareCredentialTimelineEntries,
  credentialStatusListIssuerDidFromId,
  didMethodFromReference,
  normalizeCredentialKind,
  normalizeCredentialRecord,
  normalizeCredentialStatus,
  normalizeCredentialTimelineEntry,
  normalizeCredentialTimelineRecords,
  resolveAgentDidForMethod,
} from "./ledger-credential-core.js";
import {
  credentialIssuerLabel,
  credentialSubjectLabel,
} from "./ledger-credential-labels.js";
import {
  buildCollectionTailToken,
  buildStoreScopedDerivedCacheKey,
  cacheStoreDerivedView,
} from "./ledger-derived-cache.js";
import { matchesCompatibleAgentId, resolveStoredAgent } from "./ledger-identity-compat.js";
import { SIGNABLE_DID_METHODS } from "./protocol.js";

function normalizeRecordViewDeps(deps = {}) {
  return {
    isProposalRelatedToAgent:
      typeof deps.isProposalRelatedToAgent === "function" ? deps.isProposalRelatedToAgent : () => false,
    listCredentialRepairHistory:
      typeof deps.listCredentialRepairHistory === "function" ? deps.listCredentialRepairHistory : () => [],
    resolveActorContext:
      typeof deps.resolveActorContext === "function"
        ? deps.resolveActorContext
        : (_store, value = {}) => ({
            agentId: normalizeOptionalText(value.agentId) ?? null,
            label: normalizeOptionalText(value.label || value.fallbackText || value.agentId || value.did) ?? null,
            did: normalizeOptionalText(value.did) ?? null,
            walletAddress: normalizeOptionalText(value.walletAddress)?.toLowerCase() ?? null,
            windowId: normalizeOptionalText(value.windowId) ?? null,
          }),
    summarizeCredentialTimelineTiming:
      typeof deps.summarizeCredentialTimelineTiming === "function"
        ? deps.summarizeCredentialTimelineTiming
        : (record, repairHistory = []) => ({
            timelineCount: Array.isArray(record?.timeline) ? record.timeline.length : 0,
            latestTimelineAt:
              repairHistory[0]?.latestIssuedAt ??
              record?.revokedAt ??
              record?.updatedAt ??
              record?.issuedAt ??
              null,
          }),
  };
}

export function buildCredentialTimeline(store, record, deps = {}) {
  const resolvedDeps = normalizeRecordViewDeps(deps);
  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord) {
    return [];
  }
  const cacheKey = buildStoreScopedDerivedCacheKey(
    "credential_timeline",
    store,
    buildCredentialDerivedCollectionToken(store),
    buildCredentialRecordCacheScope(normalizedRecord)
  );
  return cacheStoreDerivedView(store, cacheKey, () => {
    const timelineFallback = {
      credentialRecordId: normalizedRecord.credentialRecordId,
      credentialId: normalizedRecord.credentialId,
      kind: normalizedRecord.kind,
      subjectType: normalizedRecord.subjectType,
      subjectId: normalizedRecord.subjectId,
      issuerAgentId: normalizedRecord.issuerAgentId,
      issuerLabel: normalizedRecord.issuerLabel,
      issuerDid: normalizedRecord.issuerDid,
      statusListId: normalizedRecord.statusListId,
      statusListIndex: normalizedRecord.statusListIndex,
      statusPurpose: normalizedRecord.statusPurpose,
      issuedByAgentId: normalizedRecord.issuedByAgentId,
      issuedByLabel: normalizedRecord.issuedByLabel,
      issuedByDid: normalizedRecord.issuedByDid,
      issuedByWalletAddress: normalizedRecord.issuedByWalletAddress,
      issuedByWindowId: normalizedRecord.issuedByWindowId,
      revokedByAgentId: normalizedRecord.revokedByAgentId,
      revokedByLabel: normalizedRecord.revokedByLabel,
      revokedByDid: normalizedRecord.revokedByDid,
      revokedByWalletAddress: normalizedRecord.revokedByWalletAddress,
      revokedByWindowId: normalizedRecord.revokedByWindowId,
      source: normalizedRecord.source,
    };

    const timeline = normalizeCredentialTimelineRecords(normalizedRecord.timeline, timelineFallback);
    const kinds = new Set(timeline.map((entry) => entry.kind));
    const subjectLabel = credentialSubjectLabel(store, normalizedRecord) || normalizedRecord.subjectId || normalizedRecord.credentialId;
    const repairHistory = normalizeCredentialKind(normalizedRecord.kind) === "migration_receipt"
      ? []
      : resolvedDeps.listCredentialRepairHistory(store, normalizedRecord, {
          didMethod: didMethodFromReference(normalizedRecord.issuerDid),
          limit: 10,
        });

    if (!kinds.has("credential_issued")) {
      const issuedActor = resolvedDeps.resolveActorContext(store, {
        agentId: normalizedRecord.issuedByAgentId || normalizedRecord.issuerAgentId,
        did: normalizedRecord.issuedByDid || normalizedRecord.issuerDid,
        walletAddress: normalizedRecord.issuedByWalletAddress,
        label: normalizedRecord.issuedByLabel || normalizedRecord.issuerLabel,
        windowId: normalizedRecord.issuedByWindowId,
        fallbackText: normalizedRecord.issuedByLabel || normalizedRecord.issuerLabel || normalizedRecord.issuerAgentId || normalizedRecord.issuerDid,
      });

      timeline.push(
        normalizeCredentialTimelineEntry(
          {
            timelineId: createRecordId("credtl"),
            credentialRecordId: normalizedRecord.credentialRecordId,
            credentialId: normalizedRecord.credentialId,
            kind: "credential_issued",
            timestamp: normalizedRecord.issuedAt,
            actorAgentId: issuedActor.agentId,
            actorLabel: issuedActor.label,
            actorDid: issuedActor.did,
            actorWalletAddress: issuedActor.walletAddress,
            actorWindowId: issuedActor.windowId,
            summary: `证据签发：${subjectLabel}`,
            details: {
              credentialRecordId: normalizedRecord.credentialRecordId,
              credentialId: normalizedRecord.credentialId,
              kind: normalizedRecord.kind,
              subjectType: normalizedRecord.subjectType,
              subjectId: normalizedRecord.subjectId,
              issuerAgentId: normalizedRecord.issuerAgentId,
              issuerDid: normalizedRecord.issuerDid,
              statusListId: normalizedRecord.statusListId,
              statusListIndex: normalizedRecord.statusListIndex,
              statusPurpose: normalizedRecord.statusPurpose,
              ledgerHash: normalizedRecord.ledgerHash,
              proofValue: normalizedRecord.proofValue,
              status: normalizedRecord.status,
            },
            source: normalizedRecord.source || "credential_issue",
            order: 10,
          },
          timelineFallback
        )
      );
    }

    for (const repair of repairHistory) {
      const repairId = normalizeOptionalText(repair?.repairId) ?? null;
      const hasRepairEvent = timeline.some(
        (entry) => entry.kind === "credential_repaired" && normalizeOptionalText(entry.details?.repairId) === repairId
      );
      if (hasRepairEvent) {
        continue;
      }

      const repairActor = resolvedDeps.resolveActorContext(store, {
        agentId: repair?.issuerAgentId,
        did: repair?.issuerDid,
        label: repair?.issuerAgentId || repair?.issuerDid,
        fallbackText: repair?.issuerAgentId || repair?.issuerDid || repairId,
      });

      timeline.push(
        normalizeCredentialTimelineEntry(
          {
            timelineId: createRecordId("credtl"),
            credentialRecordId: normalizedRecord.credentialRecordId,
            credentialId: normalizedRecord.credentialId,
            kind: "credential_repaired",
            timestamp: repair?.latestIssuedAt || repair?.generatedAt || normalizedRecord.updatedAt || normalizedRecord.issuedAt || now(),
            actorAgentId: repairActor.agentId,
            actorLabel: repairActor.label,
            actorDid: normalizeOptionalText(repair?.issuerDid) ?? repairActor.did,
            actorWalletAddress: repairActor.walletAddress,
            actorWindowId: repairActor.windowId,
            summary: `证据迁移修复：${subjectLabel}`,
            details: {
              credentialRecordId: normalizedRecord.credentialRecordId,
              credentialId: normalizedRecord.credentialId,
              repairId,
              scope: repair?.scope ?? null,
              summary: repair?.summary ?? null,
              issuerAgentId: repair?.issuerAgentId ?? null,
              issuerDid: repair?.issuerDid ?? null,
              targetAgentId: repair?.targetAgentId ?? null,
              repairedCount: repair?.repairedCount ?? null,
              plannedRepairCount: repair?.plannedRepairCount ?? null,
              receiptCount: repair?.receiptCount ?? null,
              requestedKinds: cloneJson(repair?.requestedKinds) ?? [],
              requestedDidMethods: cloneJson(repair?.requestedDidMethods) ?? [],
              issuedDidMethods: cloneJson(repair?.issuedDidMethods) ?? [],
              linkedCredentialRecordIds: cloneJson(repair?.linkedCredentialRecordIds) ?? [],
              linkedCredentialIds: cloneJson(repair?.linkedCredentialIds) ?? [],
              linkedSubjects: cloneJson(repair?.linkedSubjects) ?? [],
              linkedComparisons: cloneJson(repair?.linkedComparisons) ?? [],
            },
            source: "migration_repair_link",
            order: 15,
          },
          timelineFallback
        )
      );
    }

    if ((normalizedRecord.status === "revoked" || normalizedRecord.revokedAt) && !kinds.has("credential_revoked")) {
      const revokedActor = resolvedDeps.resolveActorContext(store, {
        agentId: normalizedRecord.revokedByAgentId,
        did: normalizedRecord.revokedByDid,
        walletAddress: normalizedRecord.revokedByWalletAddress,
        label: normalizedRecord.revokedByLabel,
        windowId: normalizedRecord.revokedByWindowId,
        fallbackText: normalizedRecord.revokedByLabel || normalizedRecord.revokedByAgentId || normalizedRecord.revokedByWindowId,
      });

      timeline.push(
        normalizeCredentialTimelineEntry(
          {
            timelineId: createRecordId("credtl"),
            credentialRecordId: normalizedRecord.credentialRecordId,
            credentialId: normalizedRecord.credentialId,
            kind: "credential_revoked",
            timestamp: normalizedRecord.revokedAt || normalizedRecord.updatedAt || now(),
            actorAgentId: revokedActor.agentId,
            actorLabel: revokedActor.label,
            actorDid: revokedActor.did,
            actorWalletAddress: revokedActor.walletAddress,
            actorWindowId: revokedActor.windowId,
            summary: `证据撤销：${subjectLabel}`,
            details: {
              credentialRecordId: normalizedRecord.credentialRecordId,
              credentialId: normalizedRecord.credentialId,
              statusListId: normalizedRecord.statusListId,
              statusListIndex: normalizedRecord.statusListIndex,
              statusPurpose: normalizedRecord.statusPurpose,
              reason: normalizedRecord.revocationReason,
              note: normalizedRecord.revocationNote,
              status: normalizedRecord.status,
            },
            source: normalizedRecord.source || "credential_revoke",
            order: 20,
          },
          timelineFallback
        )
      );
    }

    return timeline
      .sort(compareCredentialTimelineEntries)
      .map(({ order, ...entry }) => entry);
  });
}

export function isCredentialRelatedToAgent(record, agentId, store = null, deps = {}) {
  const resolvedDeps = normalizeRecordViewDeps(deps);
  if (!record || !agentId) {
    return false;
  }

  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord) {
    return false;
  }

  if (
    Array.isArray(normalizedRecord.relatedAgentIds) &&
    normalizedRecord.relatedAgentIds.some((value) => matchesCompatibleAgentId(store, value, agentId))
  ) {
    return true;
  }

  if (normalizedRecord.subjectType === "agent" && matchesCompatibleAgentId(store, normalizedRecord.subjectId, agentId)) {
    return true;
  }

  if (
    matchesCompatibleAgentId(store, normalizedRecord.issuerAgentId, agentId) ||
    matchesCompatibleAgentId(store, normalizedRecord.issuedByAgentId, agentId) ||
    matchesCompatibleAgentId(store, normalizedRecord.revokedByAgentId, agentId)
  ) {
    return true;
  }

  if (normalizedRecord.subjectType === "proposal" && store) {
    const proposal = store.proposals.find((entry) => entry.proposalId === normalizedRecord.subjectId);
    if (proposal && resolvedDeps.isProposalRelatedToAgent(proposal, agentId, store)) {
      return true;
    }
  }

  return false;
}

export function buildCredentialRecordView(
  store,
  record,
  { includeTimeline = false, includeRepairHistory = false, detailLevel = null } = {},
  deps = {}
) {
  const resolvedDeps = normalizeRecordViewDeps(deps);
  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord) {
    return null;
  }

  const currentLedgerHash = store?.lastEventHash ?? null;
  const credential = normalizedRecord.credential;
  const credentialTypes = Array.isArray(credential?.type)
    ? credential.type
    : [credential?.type].filter(Boolean);
  const normalizedDetailLevel = normalizeOptionalText(detailLevel)?.toLowerCase() ?? null;
  const resolvedDetailLevel =
    normalizedDetailLevel === "preview"
      ? "preview"
      : normalizedDetailLevel === "detail" || includeTimeline || includeRepairHistory
        ? "detail"
        : "list";
  const issuerDidMethod = didMethodFromReference(normalizedRecord.issuerDid);
  const issuedByDidMethod = didMethodFromReference(normalizedRecord.issuedByDid);
  const statusListDidMethod = didMethodFromReference(
    credentialStatusListIssuerDidFromId(normalizedRecord.statusListId) ?? normalizedRecord.issuerDid
  );
  const repairHistoryLimit = resolvedDetailLevel === "preview" ? 0 : includeRepairHistory ? 10 : 3;
  let repairHistory = [];
  if (repairHistoryLimit > 0) {
    repairHistory = resolvedDeps.listCredentialRepairHistory(store, normalizedRecord, {
      didMethod: issuerDidMethod,
      limit: repairHistoryLimit,
      detailed: resolvedDetailLevel === "detail" && includeRepairHistory,
    });
    if (!repairHistory.length && issuerDidMethod) {
      repairHistory = resolvedDeps.listCredentialRepairHistory(store, normalizedRecord, {
        limit: repairHistoryLimit,
        detailed: resolvedDetailLevel === "detail" && includeRepairHistory,
      });
    }
  }
  const timeline = resolvedDetailLevel === "detail" ? buildCredentialTimeline(store, normalizedRecord, resolvedDeps) : null;
  const siblingMethods = resolvedDetailLevel === "detail" ? buildCredentialSiblingSummary(store, normalizedRecord) : null;
  const timelineSummary =
    resolvedDetailLevel === "preview"
      ? {
          timelineCount: 0,
          latestTimelineAt: null,
        }
      : resolvedDetailLevel === "detail"
      ? {
          timelineCount: timeline.length,
          latestTimelineAt: timeline.at(-1)?.timestamp ?? null,
        }
      : resolvedDeps.summarizeCredentialTimelineTiming(normalizedRecord, repairHistory);
  const repairedBy = repairHistory[0]
    ? {
        repairId: repairHistory[0].repairId,
        scope: repairHistory[0].scope,
        summary: repairHistory[0].summary,
        issuerAgentId: repairHistory[0].issuerAgentId,
        issuerDid: repairHistory[0].issuerDid,
        publicIssuerDid: repairHistory[0].publicIssuerDid ?? null,
        compatibilityIssuerDid: repairHistory[0].compatibilityIssuerDid ?? null,
        latestIssuedAt: repairHistory[0].latestIssuedAt,
        issuedDidMethods: cloneJson(repairHistory[0].issuedDidMethods) ?? [],
        allIssuedDidMethods: cloneJson(repairHistory[0].allIssuedDidMethods) ?? [],
        publicIssuedDidMethods: cloneJson(repairHistory[0].publicIssuedDidMethods) ?? [],
        compatibilityIssuedDidMethods: cloneJson(repairHistory[0].compatibilityIssuedDidMethods) ?? [],
        repairIssuedDidMethods: cloneJson(repairHistory[0].repairIssuedDidMethods) ?? [],
        receiptCount: repairHistory[0].receiptCount ?? 0,
        allReceiptCount: repairHistory[0].allReceiptCount ?? repairHistory[0].receiptCount ?? 0,
        repairedCount: repairHistory[0].repairedCount ?? 0,
      }
    : null;

  const view = {
    credentialRecordId: normalizedRecord.credentialRecordId,
    credentialId: normalizedRecord.credentialId,
    kind: normalizedRecord.kind,
    subjectType: normalizedRecord.subjectType,
    subjectId: normalizedRecord.subjectId,
    subjectLabel: credentialSubjectLabel(store, normalizedRecord),
    relatedAgentIds: normalizedRecord.relatedAgentIds,
    comparisonDigest: normalizedRecord.comparisonDigest,
    comparisonLeftAgentId: normalizedRecord.comparisonLeftAgentId,
    comparisonRightAgentId: normalizedRecord.comparisonRightAgentId,
    comparisonLeftDid: normalizedRecord.comparisonLeftDid,
    comparisonRightDid: normalizedRecord.comparisonRightDid,
    comparisonLabel: normalizedRecord.comparisonLabel,
    migrationRepairId: normalizedRecord.migrationRepairId,
    migrationRepairScope: normalizedRecord.migrationRepairScope,
    migrationTargetAgentId: normalizedRecord.migrationTargetAgentId,
    migrationSummary: normalizedRecord.migrationSummary,
    migrationLinks: cloneJson(normalizedRecord.migrationLinks) ?? null,
    issuerAgentId: normalizedRecord.issuerAgentId,
    issuerLabel: credentialIssuerLabel(store, normalizedRecord),
    issuerDid: normalizedRecord.issuerDid,
    issuerDidMethod,
    status: normalizedRecord.status,
    issuedAt: normalizedRecord.issuedAt,
    updatedAt: normalizedRecord.updatedAt,
    revokedAt: normalizedRecord.revokedAt,
    revokedByAgentId: normalizedRecord.revokedByAgentId,
    revokedByLabel: normalizedRecord.revokedByLabel,
    revokedByDid: normalizedRecord.revokedByDid,
    revokedByWalletAddress: normalizedRecord.revokedByWalletAddress,
    revokedByWindowId: normalizedRecord.revokedByWindowId,
    revocationReason: normalizedRecord.revocationReason,
    revocationNote: normalizedRecord.revocationNote,
    issuedByAgentId: normalizedRecord.issuedByAgentId,
    issuedByLabel: normalizedRecord.issuedByLabel,
    issuedByDid: normalizedRecord.issuedByDid,
    issuedByDidMethod,
    issuedByWalletAddress: normalizedRecord.issuedByWalletAddress,
    issuedByWindowId: normalizedRecord.issuedByWindowId,
    source: normalizedRecord.source,
    note: normalizedRecord.note,
    ledgerHash: normalizedRecord.ledgerHash,
    proofValue: normalizedRecord.proofValue,
    proofMethod: normalizedRecord.proofMethod,
    statusListId: normalizedRecord.statusListId,
    statusListIndex: normalizedRecord.statusListIndex,
    statusPurpose: normalizedRecord.statusPurpose,
    statusListCredentialId: normalizedRecord.statusListCredentialId,
    statusListEntryId: normalizedRecord.statusListEntryId,
    statusListDidMethod,
    siblingMethods,
    repairedBy,
    repairIds: repairHistory.map((entry) => entry.repairId).filter(Boolean),
    repairCount: repairHistory.length,
    latestRepairAt: repairHistory[0]?.latestIssuedAt ?? null,
    credentialType: credentialTypes,
    snapshotFresh: normalizedRecord.ledgerHash ? normalizedRecord.ledgerHash === currentLedgerHash : null,
    ageSeconds: Math.max(0, Math.floor((Date.now() - new Date(normalizedRecord.issuedAt).getTime()) / 1000)),
    revocationAgeSeconds: normalizedRecord.revokedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(normalizedRecord.revokedAt).getTime()) / 1000))
      : null,
    isRevoked: normalizedRecord.status === "revoked",
    isActive: normalizedRecord.status === "active",
    timelineCount: timelineSummary.timelineCount,
    latestTimelineAt: timelineSummary.latestTimelineAt,
  };

  if (includeTimeline && timeline) {
    view.timeline = timeline;
  }

  if (includeRepairHistory) {
    view.repairHistory = repairHistory;
  }

  return view;
}

export function credentialSiblingGroupKey(record) {
  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord) {
    return null;
  }

  return hashJson({
    kind: normalizeCredentialKind(normalizedRecord.kind),
    subjectType: normalizedRecord.subjectType ?? null,
    subjectId: normalizedRecord.subjectId ?? null,
    issuerAgentId: normalizedRecord.issuerAgentId ?? null,
  });
}

export function listSiblingCredentialRecords(store, record, { activeOnly = false } = {}) {
  const normalizedRecord = normalizeCredentialRecord(record);
  const siblingKey = credentialSiblingGroupKey(normalizedRecord);
  if (!normalizedRecord || !siblingKey) {
    return [];
  }

  return (store.credentials || [])
    .map((entry) => normalizeCredentialRecord(entry))
    .filter(Boolean)
    .filter((entry) => credentialSiblingGroupKey(entry) === siblingKey)
    .filter((entry) => !activeOnly || normalizeCredentialStatus(entry.status) === "active")
    .sort((a, b) => {
      const issuedDiff = new Date(b.issuedAt || b.updatedAt || 0).getTime() - new Date(a.issuedAt || a.updatedAt || 0).getTime();
      if (issuedDiff !== 0) {
        return issuedDiff;
      }

      return compareCredentialIds(b.credentialRecordId || b.credentialId, a.credentialRecordId || a.credentialId);
    });
}

export function summarizeSiblingCredentialRecord(store, record, currentCredentialRecordId = null) {
  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord) {
    return null;
  }

  return {
    credentialRecordId: normalizedRecord.credentialRecordId,
    credentialId: normalizedRecord.credentialId,
    issuerDid: normalizedRecord.issuerDid,
    issuerDidMethod: didMethodFromReference(normalizedRecord.issuerDid),
    status: normalizedRecord.status,
    issuedAt: normalizedRecord.issuedAt,
    updatedAt: normalizedRecord.updatedAt,
    statusListId: normalizedRecord.statusListId,
    snapshotFresh: normalizedRecord.ledgerHash ? normalizedRecord.ledgerHash === (store?.lastEventHash ?? null) : null,
    isCurrent: normalizeOptionalText(normalizedRecord.credentialRecordId) === normalizeOptionalText(currentCredentialRecordId),
  };
}

export function buildCredentialSiblingSummary(store, record, { activeOnly = false } = {}) {
  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord) {
    return null;
  }
  const cacheKey = buildStoreScopedDerivedCacheKey(
    "credential_sibling_summary",
    store,
    buildCredentialDerivedCollectionToken(store),
    buildCredentialRecordCacheScope(normalizedRecord, activeOnly ? "active" : "all")
  );
  return cacheStoreDerivedView(store, cacheKey, () => {
    const siblingRecords = listSiblingCredentialRecords(store, normalizedRecord, { activeOnly });
    return buildCredentialSiblingSummaryFromRecords(store, normalizedRecord, siblingRecords);
  });
}

export function buildCredentialSiblingSummaryFromRecords(store, record, siblingRecords = []) {
  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord) {
    return null;
  }

  const recordsByMethod = new Map();
  for (const siblingRecord of siblingRecords) {
    const didMethod = didMethodFromReference(siblingRecord.issuerDid) || "unknown";
    if (!recordsByMethod.has(didMethod)) {
      recordsByMethod.set(didMethod, siblingRecord);
    }
  }

  const orderedMethods = [
    ...SIGNABLE_DID_METHODS,
    ...[...recordsByMethod.keys()].filter((method) => !SIGNABLE_DID_METHODS.includes(method)),
  ];
  const records = orderedMethods
    .map((method) => recordsByMethod.get(method))
    .filter(Boolean)
    .map((siblingRecord) => summarizeSiblingCredentialRecord(store, siblingRecord, normalizedRecord.credentialRecordId))
    .filter(Boolean);
  const availableDidMethods = records.map((entry) => entry.issuerDidMethod).filter(Boolean);
  const didMethodAvailability = buildCredentialDidMethodAvailability(availableDidMethods);

  return {
    ...didMethodAvailability,
    groupKey: credentialSiblingGroupKey(normalizedRecord),
    kind: normalizedRecord.kind,
    subjectType: normalizedRecord.subjectType,
    subjectId: normalizedRecord.subjectId,
    issuerAgentId: normalizedRecord.issuerAgentId,
    signableDidMethods: [...didMethodAvailability.publicSignableDidMethods],
    currentDidMethod: didMethodFromReference(normalizedRecord.issuerDid),
    availableDidMethods,
    missingDidMethods: [...didMethodAvailability.publicMissingDidMethods],
    complete: didMethodAvailability.publicComplete,
    siblingCount: records.filter((entry) => !entry.isCurrent).length,
    records,
  };
}

export function listCredentialRecordViews(
  store,
  {
    agentId = null,
    proposalId = null,
    kind = null,
    status = null,
    limit = 50,
    didMethod = null,
    issuerDid = null,
    issuerAgentId = null,
    repaired = undefined,
    repairId = null,
    sortBy = null,
    sortOrder = "desc",
    detailLevel = null,
  } = {},
  deps = {}
) {
  const resolvedDeps = normalizeRecordViewDeps(deps);
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 50;
  const normalizedStatus = normalizeOptionalText(status)?.toLowerCase() ?? null;
  const normalizedKind = normalizeOptionalText(kind) ?? null;
  const normalizedDidMethod = normalizeOptionalText(didMethod)?.toLowerCase() ?? null;
  const normalizedIssuerDid = normalizeOptionalText(issuerDid) ?? null;
  const normalizedIssuerAgentId = normalizeOptionalText(issuerAgentId) ?? null;
  const normalizedRepairId = normalizeOptionalText(repairId) ?? null;
  const normalizedSortBy = normalizeOptionalText(sortBy)?.toLowerCase() ?? null;
  const normalizedSortOrder = normalizeOptionalText(sortOrder)?.toLowerCase() === "asc" ? "asc" : "desc";
  const issuerAgent = normalizedIssuerAgentId ? resolveStoredAgent(store, normalizedIssuerAgentId) : null;
  const resolvedIssuerDid =
    normalizedIssuerDid ??
    (issuerAgent && normalizedDidMethod ? resolveAgentDidForMethod(store, issuerAgent, normalizedDidMethod) : null);
  const filteredEntries = (store.credentials || [])
    .map((record) => ({
      record,
      normalizedRecord: normalizeCredentialRecord(record),
    }))
    .filter(({ record, normalizedRecord }) => {
      if (!normalizedRecord) {
        return false;
      }

      if (agentId && !isCredentialRelatedToAgent(record, agentId, store, resolvedDeps)) {
        return false;
      }

      if (proposalId && record.subjectType !== "proposal") {
        return false;
      }

      if (proposalId && record.subjectId !== proposalId) {
        return false;
      }

      if (normalizedKind && normalizeCredentialKind(record.kind) !== normalizeCredentialKind(normalizedKind)) {
        return false;
      }

      if (normalizedStatus && normalizeCredentialStatus(record.status) !== normalizedStatus) {
        return false;
      }

      if (
        normalizedIssuerAgentId &&
        !matchesCompatibleAgentId(store, normalizedRecord.issuerAgentId, normalizedIssuerAgentId)
      ) {
        return false;
      }

      if (resolvedIssuerDid && normalizeOptionalText(normalizedRecord.issuerDid) !== resolvedIssuerDid) {
        return false;
      }

      if (normalizedDidMethod && didMethodFromReference(normalizedRecord.issuerDid) !== normalizedDidMethod) {
        return false;
      }

      return true;
    });
  const direction = normalizedSortOrder === "asc" ? 1 : -1;
  const canPreLimitBeforeViewBuild =
    !normalizedRepairId &&
    repaired === undefined &&
    normalizedSortBy !== "latestrepairat" &&
    normalizedSortBy !== "repaircount";

  if (canPreLimitBeforeViewBuild) {
    filteredEntries.sort((left, right) => {
      if (normalizedSortBy === "updatedat") {
        const updatedDiff =
          new Date(left.normalizedRecord.updatedAt || left.normalizedRecord.issuedAt || 0).getTime() -
          new Date(right.normalizedRecord.updatedAt || right.normalizedRecord.issuedAt || 0).getTime();
        if (updatedDiff !== 0) {
          return updatedDiff * direction;
        }
      }

      const issuedDiff =
        new Date(left.normalizedRecord.issuedAt || left.normalizedRecord.updatedAt || 0).getTime() -
        new Date(right.normalizedRecord.issuedAt || right.normalizedRecord.updatedAt || 0).getTime();
      if (issuedDiff !== 0) {
        return issuedDiff * direction;
      }

      return (
        compareCredentialIds(
          left.normalizedRecord.credentialRecordId || left.normalizedRecord.credentialId,
          right.normalizedRecord.credentialRecordId || right.normalizedRecord.credentialId
        ) * direction
      );
    });

    return filteredEntries
      .slice(0, cappedLimit)
      .map(({ record }) => buildCredentialRecordView(store, record, { detailLevel }, resolvedDeps))
      .filter(Boolean);
  }

  let records = filteredEntries
    .map(({ record }) => buildCredentialRecordView(store, record, { detailLevel }, resolvedDeps))
    .filter(Boolean);

  if (normalizedRepairId) {
    records = records.filter(
      (record) =>
        record.migrationRepairId === normalizedRepairId ||
        (Array.isArray(record.repairIds) && record.repairIds.includes(normalizedRepairId))
    );
  }

  if (repaired !== undefined) {
    records = records.filter((record) => {
      const hasRepairHistory = Number(record.repairCount || 0) > 0;
      return repaired ? hasRepairHistory : !hasRepairHistory;
    });
  }

  records.sort((a, b) => {
    if (normalizedSortBy === "latestrepairat") {
      const timeA = new Date(a.latestRepairAt || 0).getTime();
      const timeB = new Date(b.latestRepairAt || 0).getTime();
      if (timeA !== timeB) {
        return (timeA - timeB) * direction;
      }
    }

    if (normalizedSortBy === "repaircount") {
      const countDiff = Number(a.repairCount || 0) - Number(b.repairCount || 0);
      if (countDiff !== 0) {
        return countDiff * direction;
      }
    }

    if (normalizedSortBy === "updatedat") {
      const updatedDiff = new Date(a.updatedAt || a.issuedAt || 0).getTime() - new Date(b.updatedAt || b.issuedAt || 0).getTime();
      if (updatedDiff !== 0) {
        return updatedDiff * direction;
      }
    }

    const issuedDiff = new Date(a.issuedAt || a.updatedAt || 0).getTime() - new Date(b.issuedAt || b.updatedAt || 0).getTime();
    if (issuedDiff !== 0) {
      return issuedDiff * direction;
    }

    return compareCredentialIds(a.credentialRecordId || a.credentialId, b.credentialRecordId || b.credentialId) * direction;
  });

  return records.slice(0, cappedLimit);
}

export function findCredentialRecordBySiblingGroupKey(store, groupKey) {
  const normalizedGroupKey = normalizeOptionalText(groupKey) ?? null;
  if (!normalizedGroupKey) {
    return null;
  }

  return (
    (store.credentials || [])
      .map((record) => normalizeCredentialRecord(record))
      .filter(Boolean)
      .find((record) => credentialSiblingGroupKey(record) === normalizedGroupKey) ?? null
  );
}

export function findCredentialRecordById(store, credentialId) {
  const normalizedCredentialId = normalizeOptionalText(credentialId) ?? null;
  if (!normalizedCredentialId) {
    return null;
  }

  return (store.credentials || []).find(
    (record) =>
      normalizeOptionalText(record.credentialRecordId) === normalizedCredentialId ||
      normalizeOptionalText(record.credentialId) === normalizedCredentialId
  ) ?? null;
}

export function findCredentialRecordByCredential(store, credential) {
  if (!credential || typeof credential !== "object") {
    return null;
  }

  const credentialId = normalizeOptionalText(credential.id) ?? null;
  const proofValue = normalizeOptionalText(credential.proof?.proofValue) ?? null;
  return (
    (credentialId ? findCredentialRecordById(store, credentialId) : null) ||
    (proofValue ? (store.credentials || []).find((record) => normalizeOptionalText(record.proofValue) === proofValue) : null) ||
    null
  );
}

export function findLatestCredentialRecordForSubject(store, { kind = null, subjectType = null, subjectId = null, issuerDid = null, status = "active" } = {}) {
  const normalizedStatus = normalizeOptionalText(status)?.toLowerCase() ?? null;
  const candidates = (store.credentials || [])
    .filter((record) => {
      if (kind && normalizeCredentialKind(record.kind) !== normalizeCredentialKind(kind)) {
        return false;
      }

      if (subjectType && normalizeOptionalText(record.subjectType) !== normalizeOptionalText(subjectType)) {
        return false;
      }

      if (subjectId && normalizeOptionalText(record.subjectId) !== normalizeOptionalText(subjectId)) {
        return false;
      }

      if (issuerDid && normalizeOptionalText(record.issuerDid) !== normalizeOptionalText(issuerDid)) {
        return false;
      }

      if (normalizedStatus && normalizeCredentialStatus(record.status) !== normalizedStatus) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      const issuedDiff = new Date(b.issuedAt || b.updatedAt || 0).getTime() - new Date(a.issuedAt || a.updatedAt || 0).getTime();
      if (issuedDiff !== 0) {
        return issuedDiff;
      }

      return compareCredentialIds(b.credentialRecordId || b.credentialId, a.credentialRecordId || a.credentialId);
    });

  return candidates[0] ?? null;
}

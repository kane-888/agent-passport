import {
  cloneJson,
  createRecordId,
  normalizeOptionalText,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";

function listUniqueIssuedDidMethodsFromRecords(deps, records = []) {
  return [
    ...new Set(
      (Array.isArray(records) ? records : [])
        .map((record) => deps.didMethodFromReference(record?.issuerDid))
        .filter(Boolean)
    ),
  ];
}

function buildRepairIssuerDidByMethod(deps, records = []) {
  const issuerDidByMethod = {};
  for (const record of Array.isArray(records) ? records : []) {
    const method = deps.didMethodFromReference(record?.issuerDid);
    if (!method || issuerDidByMethod[method]) {
      continue;
    }
    issuerDidByMethod[method] = record?.issuerDid ?? null;
  }
  return issuerDidByMethod;
}

function buildRepairDidMethodView(deps, visibleRecords = [], allRecords = visibleRecords) {
  const issuedDidMethods = listUniqueIssuedDidMethodsFromRecords(deps, visibleRecords);
  const allIssuedDidMethods = listUniqueIssuedDidMethodsFromRecords(deps, allRecords);
  const publicDidMethods = Array.isArray(deps.PUBLIC_SIGNABLE_DID_METHODS) ? deps.PUBLIC_SIGNABLE_DID_METHODS : [];
  const publicIssuedDidMethods = allIssuedDidMethods.filter((method) => publicDidMethods.includes(method));
  const compatibilityIssuedDidMethods = allIssuedDidMethods.filter((method) => !publicDidMethods.includes(method));
  const issuerDidByMethod = buildRepairIssuerDidByMethod(deps, allRecords);
  const publicIssuerDid =
    publicDidMethods.map((method) => issuerDidByMethod[method]).find(Boolean) ?? null;
  const compatibilityIssuerDid =
    compatibilityIssuedDidMethods.map((method) => issuerDidByMethod[method]).find(Boolean) ?? null;

  return {
    issuedDidMethods,
    receiptCount: Array.isArray(visibleRecords) ? visibleRecords.length : 0,
    allIssuedDidMethods,
    allReceiptCount: Array.isArray(allRecords) ? allRecords.length : 0,
    publicIssuedDidMethods,
    compatibilityIssuedDidMethods,
    repairIssuedDidMethods: allIssuedDidMethods,
    issuerDidByMethod,
    publicIssuerDid,
    compatibilityIssuerDid,
  };
}

function selectPreferredRepairIssuerDid(deps, methodView, visibleRecords = []) {
  const visibleIssuerDidByMethod = buildRepairIssuerDidByMethod(deps, visibleRecords);
  for (const method of Array.isArray(methodView?.issuedDidMethods) ? methodView.issuedDidMethods : []) {
    const issuerDid = visibleIssuerDidByMethod[method];
    if (issuerDid) {
      return issuerDid;
    }
  }
  const latestVisibleRecord = Array.isArray(visibleRecords) ? visibleRecords[0] : null;
  return (
    normalizeOptionalText(latestVisibleRecord?.issuedByDid || latestVisibleRecord?.issuerDid) ??
    methodView?.publicIssuerDid ??
    methodView?.compatibilityIssuerDid ??
    null
  );
}

function listMigrationRepairReceiptRecords(deps, store, repairId, { didMethod = null } = {}) {
  const {
    normalizeCredentialRecord,
    normalizeCredentialKind,
    didMethodFromReference,
    compareCredentialIds,
  } = deps;
  const normalizedRepairId = normalizeOptionalText(repairId) ?? null;
  const normalizedDidMethod = normalizeOptionalText(didMethod)?.toLowerCase() ?? null;
  if (!normalizedRepairId) {
    return [];
  }

  return (store.credentials || [])
    .map((record) => normalizeCredentialRecord(record))
    .filter(Boolean)
    .filter((record) => normalizeCredentialKind(record.kind) === "migration_receipt")
    .filter(
      (record) =>
        normalizeOptionalText(record.subjectId) === normalizedRepairId ||
        normalizeOptionalText(record.migrationRepairId) === normalizedRepairId
    )
    .filter((record) => !normalizedDidMethod || didMethodFromReference(record.issuerDid) === normalizedDidMethod)
    .sort((a, b) => {
      const issuedDiff = new Date(b.issuedAt || b.updatedAt || 0).getTime() - new Date(a.issuedAt || a.updatedAt || 0).getTime();
      if (issuedDiff !== 0) {
        return issuedDiff;
      }

      return compareCredentialIds(b.credentialRecordId || b.credentialId, a.credentialRecordId || a.credentialId);
    });
}

function extractMigrationRepairPayload(deps, record) {
  const { normalizeCredentialRecord, normalizeCredentialKind } = deps;
  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord || normalizeCredentialKind(normalizedRecord.kind) !== "migration_receipt") {
    return null;
  }

  const credential = normalizedRecord.credential && typeof normalizedRecord.credential === "object" ? normalizedRecord.credential : {};
  const subject = credential.credentialSubject && typeof credential.credentialSubject === "object" ? credential.credentialSubject : {};
  const evidence = credential.evidence && typeof credential.evidence === "object" ? credential.evidence : {};

  return {
    repairId: normalizeOptionalText(subject.repairId || evidence.repairId || normalizedRecord.migrationRepairId || normalizedRecord.subjectId) ?? null,
    scope: normalizeOptionalText(subject.scope || evidence.scope || normalizedRecord.migrationRepairScope) ?? "agent",
    summary: normalizeOptionalText(subject.summary || evidence.summary || normalizedRecord.migrationSummary || normalizedRecord.note) ?? null,
    issuerAgentId: normalizeOptionalText(subject.issuerAgentId || normalizedRecord.issuerAgentId) ?? null,
    issuerDid: normalizeOptionalText(subject.issuerDid || normalizedRecord.issuerDid) ?? null,
    targetAgentId: normalizeOptionalText(subject.targetAgentId || evidence.targetAgentId || normalizedRecord.migrationTargetAgentId) ?? null,
    generatedAt: normalizeOptionalText(subject.generatedAt || normalizedRecord.issuedAt) ?? normalizedRecord.issuedAt,
    requestedKinds: cloneJson(subject.requestedKinds ?? evidence.requestedKinds) ?? [],
    requestedSubjectIds: cloneJson(subject.requestedSubjectIds ?? evidence.requestedSubjectIds) ?? [],
    requestedDidMethods: cloneJson(subject.requestedDidMethods ?? evidence.requestedDidMethods) ?? [],
    selectedSubjectCount: subject.selectedSubjectCount ?? null,
    selectedPairCount: subject.selectedPairCount ?? null,
    plannedRepairCount: subject.plannedRepairCount ?? null,
    repairedCount: subject.repairedCount ?? null,
    skippedCount: subject.skippedCount ?? null,
    comparisonPairs: cloneJson(evidence.comparisonPairs) ?? [],
    plan: cloneJson(evidence.plan) ?? [],
    repaired: cloneJson(evidence.repaired) ?? [],
    skipped: cloneJson(evidence.skipped) ?? [],
    beforeCoverage: cloneJson(evidence.beforeCoverage) ?? null,
    afterCoverage: cloneJson(evidence.afterCoverage) ?? null,
    links: cloneJson(subject.links ?? evidence.links) ?? null,
  };
}

function buildMigrationRepairTimeline(deps, store, repairRecords = [], allRepairRecords = repairRecords) {
  const {
    normalizeCredentialRecord,
    createRecordId: createRecordIdImpl,
    normalizeCredentialTimelineEntry,
    buildCredentialTimeline,
    compareCredentialTimelineEntries,
  } = deps;
  const normalizedRecords = repairRecords.map((record) => normalizeCredentialRecord(record)).filter(Boolean);
  if (!normalizedRecords.length) {
    return [];
  }

  const latestRecord = normalizedRecords[0];
  const normalizedAllRecords = allRepairRecords.map((record) => normalizeCredentialRecord(record)).filter(Boolean);
  const methodView = buildRepairDidMethodView(deps, normalizedRecords, normalizedAllRecords);
  const preferredIssuerDid = selectPreferredRepairIssuerDid(deps, methodView, normalizedRecords);
  const canonicalIssuerRecord =
    normalizedAllRecords.find((record) => methodView.publicIssuedDidMethods.includes(deps.didMethodFromReference(record?.issuerDid))) ??
    normalizedAllRecords[0] ??
    latestRecord;
  const payload = extractMigrationRepairPayload(deps, latestRecord);
  const timeline = [];

  if (payload) {
    timeline.push(
      normalizeCredentialTimelineEntry(
        {
          timelineId: createRecordIdImpl("credtl"),
          credentialRecordId: latestRecord.credentialRecordId,
          credentialId: latestRecord.credentialId,
          kind: "migration_repair_recorded",
          timestamp: payload.generatedAt || latestRecord.issuedAt,
          actorAgentId: latestRecord.issuedByAgentId || latestRecord.issuerAgentId,
          actorLabel: latestRecord.issuedByLabel || latestRecord.issuerLabel || latestRecord.issuerAgentId,
          actorDid:
            preferredIssuerDid ||
            canonicalIssuerRecord?.issuedByDid ||
            methodView.publicIssuerDid ||
            latestRecord.issuedByDid ||
            latestRecord.issuerDid,
          actorWalletAddress: latestRecord.issuedByWalletAddress,
          actorWindowId: latestRecord.issuedByWindowId,
          summary: payload.summary || `迁移修复：${payload.repairId || latestRecord.subjectId}`,
          details: {
            repairId: payload.repairId,
            scope: payload.scope,
            targetAgentId: payload.targetAgentId,
            requestedKinds: payload.requestedKinds,
            requestedSubjectIds: payload.requestedSubjectIds,
            requestedDidMethods: payload.requestedDidMethods,
            selectedSubjectCount: payload.selectedSubjectCount,
            selectedPairCount: payload.selectedPairCount,
            plannedRepairCount: payload.plannedRepairCount,
            repairedCount: payload.repairedCount,
            skippedCount: payload.skippedCount,
            issuedDidMethods: methodView.issuedDidMethods,
            allIssuedDidMethods: methodView.allIssuedDidMethods,
            publicIssuedDidMethods: methodView.publicIssuedDidMethods,
            compatibilityIssuedDidMethods: methodView.compatibilityIssuedDidMethods,
            repairIssuedDidMethods: methodView.repairIssuedDidMethods,
            visibleReceiptCount: methodView.receiptCount,
            receiptCount: methodView.allReceiptCount,
          },
          source: "migration_repair_view",
          order: -10,
        },
        {
          credentialRecordId: latestRecord.credentialRecordId,
          credentialId: latestRecord.credentialId,
          kind: "migration_repair_recorded",
          timestamp: payload.generatedAt || latestRecord.issuedAt,
          source: "migration_repair_view",
        }
      )
    );
  }

  for (const record of normalizedRecords) {
    for (const entry of buildCredentialTimeline(store, record)) {
      timeline.push(
        normalizeCredentialTimelineEntry(
          {
            ...entry,
            details: {
              ...(cloneJson(entry.details) ?? {}),
              repairId: payload?.repairId ?? normalizeOptionalText(record.subjectId) ?? null,
              repairScope: payload?.scope ?? record.migrationRepairScope ?? null,
            },
          },
          entry
        )
      );
    }
  }

  return timeline.sort(compareCredentialTimelineEntries);
}

export function summarizeCredentialTimelineTimingInStore(deps, record, repairHistory = []) {
  const { normalizeCredentialRecord, normalizeCredentialTimelineRecords } = deps;
  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord) {
    return {
      timelineCount: 0,
      latestTimelineAt: null,
    };
  }

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
  const baseTimeline = normalizeCredentialTimelineRecords(normalizedRecord.timeline, timelineFallback);
  const existingKinds = new Set(baseTimeline.map((entry) => entry.kind));
  const repairIds = new Set(
    baseTimeline
      .filter((entry) => entry.kind === "credential_repaired")
      .map((entry) => normalizeOptionalText(entry.details?.repairId))
      .filter(Boolean)
  );
  let timelineCount = baseTimeline.length;
  let latestTimelineAt = baseTimeline.at(-1)?.timestamp ?? null;

  const applyTimestamp = (timestamp) => {
    const timeMs = new Date(timestamp || 0).getTime();
    const currentMs = new Date(latestTimelineAt || 0).getTime();
    if (!Number.isFinite(timeMs)) {
      return;
    }
    if (!latestTimelineAt || !Number.isFinite(currentMs) || timeMs > currentMs) {
      latestTimelineAt = timestamp;
    }
  };

  if (!existingKinds.has("credential_issued") && normalizedRecord.issuedAt) {
    timelineCount += 1;
    applyTimestamp(normalizedRecord.issuedAt);
  }

  for (const repair of repairHistory) {
    const repairId = normalizeOptionalText(repair?.repairId) ?? null;
    if (repairId && repairIds.has(repairId)) {
      continue;
    }
    timelineCount += 1;
    applyTimestamp(repair?.latestIssuedAt || repair?.generatedAt || normalizedRecord.updatedAt || normalizedRecord.issuedAt || now());
  }

  if ((normalizedRecord.status === "revoked" || normalizedRecord.revokedAt) && !existingKinds.has("credential_revoked")) {
    timelineCount += 1;
    applyTimestamp(normalizedRecord.revokedAt || normalizedRecord.updatedAt || now());
  }

  return {
    timelineCount,
    latestTimelineAt,
  };
}

function buildMigrationRepairView(deps, store, repairId, { didMethod = null, includeTimeline = false } = {}) {
  const { buildCredentialRecordView } = deps;
  const repairRecords = listMigrationRepairReceiptRecords(deps, store, repairId, { didMethod });
  if (!repairRecords.length) {
    throw new Error(`Migration repair not found: ${repairId}`);
  }

  const latestRecord = repairRecords[0];
  const allRepairRecords = didMethod ? listMigrationRepairReceiptRecords(deps, store, repairId) : repairRecords;
  const methodView = buildRepairDidMethodView(deps, repairRecords, allRepairRecords);
  const preferredIssuerDid = selectPreferredRepairIssuerDid(deps, methodView, repairRecords);
  const canonicalPayloadRecord =
    allRepairRecords.find((record) => methodView.publicIssuedDidMethods.includes(deps.didMethodFromReference(record?.issuerDid))) ??
    allRepairRecords[0] ??
    latestRecord;
  const payload = extractMigrationRepairPayload(deps, canonicalPayloadRecord);
  const receipts = repairRecords.map((record) => buildCredentialRecordView(store, record)).filter(Boolean);
  const timeline = includeTimeline ? buildMigrationRepairTimeline(deps, store, repairRecords, allRepairRecords) : null;

  return {
    repairId: payload?.repairId ?? normalizeOptionalText(latestRecord.subjectId) ?? null,
    repair: {
      ...(cloneJson(payload) ?? {}),
      issuerDid: preferredIssuerDid ?? payload?.issuerDid ?? latestRecord?.issuerDid ?? null,
      issuedDidMethods: methodView.issuedDidMethods,
      allIssuedDidMethods: methodView.allIssuedDidMethods,
      publicIssuedDidMethods: methodView.publicIssuedDidMethods,
      compatibilityIssuedDidMethods: methodView.compatibilityIssuedDidMethods,
      repairIssuedDidMethods: methodView.repairIssuedDidMethods,
      issuerDidByMethod: methodView.issuerDidByMethod,
      publicIssuerDid: methodView.publicIssuerDid,
      compatibilityIssuerDid: methodView.compatibilityIssuerDid,
      receiptCount: methodView.receiptCount,
      allReceiptCount: methodView.allReceiptCount,
      latestIssuedAt: latestRecord.issuedAt,
    },
    receipts,
    latestReceipt: receipts[0] ?? null,
    issuedDidMethods: methodView.issuedDidMethods,
    allIssuedDidMethods: methodView.allIssuedDidMethods,
    publicIssuedDidMethods: methodView.publicIssuedDidMethods,
    compatibilityIssuedDidMethods: methodView.compatibilityIssuedDidMethods,
    repairIssuedDidMethods: methodView.repairIssuedDidMethods,
    issuerDidByMethod: methodView.issuerDidByMethod,
    publicIssuerDid: methodView.publicIssuerDid,
    compatibilityIssuerDid: methodView.compatibilityIssuerDid,
    receiptCount: methodView.receiptCount,
    allReceiptCount: methodView.allReceiptCount,
    latestIssuedAt: latestRecord.issuedAt,
    timeline: includeTimeline ? timeline : undefined,
    timelineCount: includeTimeline ? timeline.length : undefined,
    latestTimelineAt: includeTimeline ? timeline.at(-1)?.timestamp ?? null : undefined,
  };
}

function repairLinksReferenceCredential(deps, links, normalizedRecord) {
  const { normalizeCredentialKind } = deps;
  if (!links || !normalizedRecord) {
    return false;
  }

  const normalizedKind = normalizeCredentialKind(normalizedRecord.kind);
  const normalizedSubjectId = normalizeOptionalText(normalizedRecord.subjectId) ?? null;
  const normalizedIssuerAgentId = normalizeOptionalText(normalizedRecord.issuerAgentId) ?? null;
  const normalizedCredentialRecordId = normalizeOptionalText(normalizedRecord.credentialRecordId) ?? null;
  const normalizedCredentialId = normalizeOptionalText(normalizedRecord.credentialId) ?? null;
  const normalizedComparisonDigest = normalizeOptionalText(normalizedRecord.comparisonDigest) ?? null;

  if (
    (normalizedCredentialRecordId && links.repairedCredentialRecordIds?.includes(normalizedCredentialRecordId)) ||
    (normalizedCredentialId && links.repairedCredentialIds?.includes(normalizedCredentialId))
  ) {
    return true;
  }

  if (
    Array.isArray(links.repairedCredentials) &&
    links.repairedCredentials.some(
      (entry) =>
        (normalizedCredentialRecordId && normalizeOptionalText(entry?.credentialRecordId) === normalizedCredentialRecordId) ||
        (normalizedCredentialId && normalizeOptionalText(entry?.credentialId) === normalizedCredentialId)
    )
  ) {
    return true;
  }

  if (normalizedCredentialRecordId || normalizedCredentialId) {
    return false;
  }

  if (
    normalizedSubjectId &&
    Array.isArray(links.repairedSubjects) &&
    links.repairedSubjects.some((entry) => {
      const sameKind = normalizeCredentialKind(entry?.kind) === normalizedKind;
      const sameSubjectId = normalizeOptionalText(entry?.subjectId) === normalizedSubjectId;
      const sameIssuerAgent =
        !normalizeOptionalText(entry?.issuerAgentId) ||
        normalizeOptionalText(entry?.issuerAgentId) === normalizedIssuerAgentId;
      return sameKind && sameSubjectId && sameIssuerAgent;
    })
  ) {
    return true;
  }

  if (
    normalizedKind === "agent_comparison" &&
    Array.isArray(links.repairedComparisons) &&
    links.repairedComparisons.some(
      (entry) =>
        (normalizedSubjectId && normalizeOptionalText(entry?.subjectId) === normalizedSubjectId) ||
        (normalizedComparisonDigest && normalizeOptionalText(entry?.comparisonDigest) === normalizedComparisonDigest)
    )
  ) {
    return true;
  }

  return false;
}

function buildMigrationRepairHistoryEntry(repairView) {
  const repair = repairView?.repair || {};
  const links = repair.links || null;
  return {
    repairId: repairView?.repairId ?? repair.repairId ?? null,
    scope: repair.scope ?? null,
    summary: repair.summary ?? null,
    issuerAgentId: repair.issuerAgentId ?? null,
    issuerDid: repair.issuerDid ?? null,
    issuerDidByMethod: cloneJson(repair.issuerDidByMethod ?? repairView?.issuerDidByMethod) ?? {},
    publicIssuerDid: repair.publicIssuerDid ?? repairView?.publicIssuerDid ?? null,
    compatibilityIssuerDid: repair.compatibilityIssuerDid ?? repairView?.compatibilityIssuerDid ?? null,
    targetAgentId: repair.targetAgentId ?? null,
    generatedAt: repair.generatedAt ?? null,
    latestIssuedAt: repairView?.latestIssuedAt ?? null,
    issuedDidMethods: cloneJson(repairView?.issuedDidMethods) ?? [],
    allIssuedDidMethods: cloneJson(repair.allIssuedDidMethods ?? repairView?.allIssuedDidMethods) ?? [],
    publicIssuedDidMethods: cloneJson(repair.publicIssuedDidMethods ?? repairView?.publicIssuedDidMethods) ?? [],
    compatibilityIssuedDidMethods: cloneJson(repair.compatibilityIssuedDidMethods ?? repairView?.compatibilityIssuedDidMethods) ?? [],
    repairIssuedDidMethods: cloneJson(repair.repairIssuedDidMethods ?? repairView?.repairIssuedDidMethods) ?? [],
    receiptCount: repairView?.receiptCount ?? 0,
    allReceiptCount: repair.allReceiptCount ?? repairView?.allReceiptCount ?? repairView?.receiptCount ?? 0,
    repairedCount: repair.repairedCount ?? 0,
    skippedCount: repair.skippedCount ?? 0,
    plannedRepairCount: repair.plannedRepairCount ?? 0,
    requestedKinds: cloneJson(repair.requestedKinds) ?? [],
    requestedDidMethods: cloneJson(repair.requestedDidMethods) ?? [],
    linkedCredentialRecordIds: cloneJson(links?.repairedCredentialRecordIds) ?? [],
    linkedCredentialIds: cloneJson(links?.repairedCredentialIds) ?? [],
    linkedSubjects: cloneJson(links?.repairedSubjects) ?? [],
    linkedComparisons: cloneJson(links?.repairedComparisons) ?? [],
  };
}

function listMigrationRepairLinkedCredentialViews(
  deps,
  store,
  repairView,
  { didMethod = null, includeRepairHistory = true } = {}
) {
  const { normalizeCredentialRecord, normalizeCredentialKind, didMethodFromReference, buildCredentialRecordView } = deps;
  const normalizedDidMethod = normalizeOptionalText(didMethod)?.toLowerCase() ?? null;
  const links = repairView?.repair?.links ?? null;
  if (!links) {
    return [];
  }

  return (store.credentials || [])
    .map((record) => normalizeCredentialRecord(record))
    .filter(Boolean)
    .filter((record) => normalizeCredentialKind(record.kind) !== "migration_receipt")
    .filter((record) => !normalizedDidMethod || didMethodFromReference(record.issuerDid) === normalizedDidMethod)
    .filter((record) => repairLinksReferenceCredential(deps, links, record))
    .map((record) => buildCredentialRecordView(store, record, { includeRepairHistory }))
    .filter(Boolean);
}

export function listMigrationRepairViewsInStore(
  deps,
  store,
  {
    agentId = null,
    comparisonSubjectId = null,
    comparisonDigest = null,
    issuerAgentId = null,
    scope = null,
    didMethod = null,
    offset = 0,
    sortBy = "latestIssuedAt",
    sortOrder = "desc",
    limit = deps.DEFAULT_CREDENTIAL_LIMIT,
  } = {}
) {
  const {
    normalizeCredentialRecord,
    normalizeCredentialKind,
    didMethodFromReference,
    compareCredentialIds,
    matchesCompatibleAgentId,
  } = deps;
  const normalizedAgentId = normalizeOptionalText(agentId) ?? null;
  const normalizedComparisonSubjectId = normalizeOptionalText(comparisonSubjectId) ?? null;
  const normalizedComparisonDigest = normalizeOptionalText(comparisonDigest) ?? null;
  const normalizedIssuerAgentId = normalizeOptionalText(issuerAgentId) ?? null;
  const requestedScope = normalizeOptionalText(scope)?.toLowerCase() ?? null;
  const normalizedScope =
    requestedScope === "agent_comparison" || requestedScope === "comparisonpair"
      ? "comparison_pair"
      : requestedScope;
  const normalizedDidMethod = normalizeOptionalText(didMethod)?.toLowerCase() ?? null;
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : deps.DEFAULT_CREDENTIAL_LIMIT;
  const cappedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
  const normalizedSortBy = normalizeOptionalText(sortBy)?.toLowerCase() ?? "latestissuedat";
  const normalizedSortOrder = normalizeOptionalText(sortOrder)?.toLowerCase() === "asc" ? "asc" : "desc";
  const direction = normalizedSortOrder === "asc" ? 1 : -1;
  const repairIds = new Set();

  for (const record of store.credentials || []) {
    const normalizedRecord = normalizeCredentialRecord(record);
    if (!normalizedRecord || normalizeCredentialKind(normalizedRecord.kind) !== "migration_receipt") {
      continue;
    }
    if (normalizedDidMethod && didMethodFromReference(normalizedRecord.issuerDid) !== normalizedDidMethod) {
      continue;
    }

    const payload = extractMigrationRepairPayload(deps, normalizedRecord);
    const links = payload?.links ?? null;
    const relatedAgentCandidates = [
      ...(Array.isArray(normalizedRecord.relatedAgentIds) ? normalizedRecord.relatedAgentIds : []),
      payload?.issuerAgentId,
      payload?.targetAgentId,
      ...(Array.isArray(links?.agentIds) ? links.agentIds : []),
    ].filter(Boolean);
    const matchesAgent =
      !normalizedAgentId ||
      relatedAgentCandidates.some((candidate) =>
        typeof matchesCompatibleAgentId === "function"
          ? matchesCompatibleAgentId(store, candidate, normalizedAgentId)
          : normalizeOptionalText(candidate) === normalizedAgentId
      );
    const matchesComparison = (!normalizedComparisonSubjectId && !normalizedComparisonDigest) || Boolean(
      links?.repairedComparisons?.some(
        (entry) =>
          (normalizedComparisonSubjectId && normalizeOptionalText(entry?.subjectId) === normalizedComparisonSubjectId) ||
          (normalizedComparisonDigest && normalizeOptionalText(entry?.comparisonDigest) === normalizedComparisonDigest)
      ) ||
        payload?.comparisonPairs?.some(
          (entry) =>
            (normalizedComparisonSubjectId && normalizeOptionalText(entry?.subjectId) === normalizedComparisonSubjectId) ||
            (normalizedComparisonDigest && normalizeOptionalText(entry?.comparisonDigest) === normalizedComparisonDigest)
        ) ||
        links?.repairedCredentials?.some(
          (entry) =>
            (normalizedComparisonSubjectId && normalizeOptionalText(entry?.subjectId) === normalizedComparisonSubjectId) ||
            (normalizedComparisonDigest && normalizeOptionalText(entry?.comparisonDigest) === normalizedComparisonDigest)
        )
    );

    if (!matchesAgent || !matchesComparison) {
      continue;
    }

    const repairId = payload?.repairId ?? normalizeOptionalText(normalizedRecord.subjectId) ?? null;
    if (repairId) {
      repairIds.add(repairId);
    }
  }

  return [...repairIds]
    .map((repairId) => buildMigrationRepairView(deps, store, repairId, { didMethod: normalizedDidMethod, includeTimeline: false }))
    .filter((repairView) => {
      if (
        normalizedIssuerAgentId &&
        !(typeof matchesCompatibleAgentId === "function"
          ? matchesCompatibleAgentId(store, repairView?.repair?.issuerAgentId, normalizedIssuerAgentId)
          : normalizeOptionalText(repairView?.repair?.issuerAgentId) === normalizedIssuerAgentId)
      ) {
        return false;
      }
      if (normalizedScope && normalizeOptionalText(repairView?.repair?.scope)?.toLowerCase() !== normalizedScope) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (normalizedSortBy === "receiptcount") {
        const receiptDiff = Number(a.receiptCount || 0) - Number(b.receiptCount || 0);
        if (receiptDiff !== 0) {
          return receiptDiff * direction;
        }
      }

      if (normalizedSortBy === "repairedcount") {
        const repairedDiff = Number(a.repair?.repairedCount || 0) - Number(b.repair?.repairedCount || 0);
        if (repairedDiff !== 0) {
          return repairedDiff * direction;
        }
      }

      if (normalizedSortBy === "plannedrepaircount") {
        const plannedDiff = Number(a.repair?.plannedRepairCount || 0) - Number(b.repair?.plannedRepairCount || 0);
        if (plannedDiff !== 0) {
          return plannedDiff * direction;
        }
      }

      const issuedDiff = new Date(a.latestIssuedAt || 0).getTime() - new Date(b.latestIssuedAt || 0).getTime();
      if (issuedDiff !== 0) {
        return issuedDiff * direction;
      }

      return compareCredentialIds(a.repairId, b.repairId) * direction;
    })
    .slice(cappedOffset, cappedOffset + cappedLimit);
}

function summarizeMigrationRepairHistoryFromRecords(deps, repairId, repairRecords = [], allRepairRecords = repairRecords) {
  const normalizedRepairId = normalizeOptionalText(repairId) ?? null;
  if (!normalizedRepairId || !Array.isArray(repairRecords) || !repairRecords.length) {
    return null;
  }

  const sortedRecords = [...repairRecords].sort(
    (a, b) => new Date(b?.issuedAt || 0).getTime() - new Date(a?.issuedAt || 0).getTime()
  );
  const sortedAllRecords = [...(Array.isArray(allRepairRecords) ? allRepairRecords : repairRecords)].sort(
    (a, b) => new Date(b?.issuedAt || 0).getTime() - new Date(a?.issuedAt || 0).getTime()
  );
  const latestRecord = sortedRecords[0];
  const methodView = buildRepairDidMethodView(deps, sortedRecords, sortedAllRecords);
  const preferredIssuerDid = selectPreferredRepairIssuerDid(deps, methodView, sortedRecords);
  const canonicalPayloadRecord =
    sortedAllRecords.find((record) => methodView.publicIssuedDidMethods.includes(deps.didMethodFromReference(record?.issuerDid))) ??
    sortedAllRecords[0] ??
    latestRecord;
  const payload = extractMigrationRepairPayload(deps, canonicalPayloadRecord);
  const links = payload?.links ?? latestRecord?.migrationLinks ?? null;

  return {
    repairId: payload?.repairId ?? normalizedRepairId,
    scope: payload?.scope ?? null,
    summary: payload?.summary ?? null,
    issuerAgentId: payload?.issuerAgentId ?? latestRecord?.issuerAgentId ?? null,
    issuerDid: preferredIssuerDid ?? payload?.issuerDid ?? latestRecord?.issuerDid ?? null,
    issuerDidByMethod: methodView.issuerDidByMethod,
    publicIssuerDid: methodView.publicIssuerDid,
    compatibilityIssuerDid: methodView.compatibilityIssuerDid,
    targetAgentId: payload?.targetAgentId ?? null,
    generatedAt: payload?.generatedAt ?? latestRecord?.issuedAt ?? null,
    latestIssuedAt: latestRecord?.issuedAt ?? null,
    issuedDidMethods: methodView.issuedDidMethods,
    allIssuedDidMethods: methodView.allIssuedDidMethods,
    publicIssuedDidMethods: methodView.publicIssuedDidMethods,
    compatibilityIssuedDidMethods: methodView.compatibilityIssuedDidMethods,
    repairIssuedDidMethods: methodView.repairIssuedDidMethods,
    receiptCount: methodView.receiptCount,
    allReceiptCount: methodView.allReceiptCount,
    repairedCount: payload?.repairedCount ?? 0,
    skippedCount: payload?.skippedCount ?? 0,
    plannedRepairCount: payload?.plannedRepairCount ?? 0,
    requestedKinds: cloneJson(payload?.requestedKinds) ?? [],
    requestedDidMethods: cloneJson(payload?.requestedDidMethods) ?? [],
    linkedCredentialRecordIds: cloneJson(links?.repairedCredentialRecordIds) ?? [],
    linkedCredentialIds: cloneJson(links?.repairedCredentialIds) ?? [],
    linkedSubjects: cloneJson(links?.repairedSubjects) ?? [],
    linkedComparisons: cloneJson(links?.repairedComparisons) ?? [],
  };
}

export function listCredentialRepairHistoryInStore(deps, store, record, { didMethod = null, limit = 10, detailed = false } = {}) {
  const { normalizeCredentialRecord, normalizeCredentialKind } = deps;
  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord || normalizeCredentialKind(normalizedRecord.kind) === "migration_receipt") {
    return [];
  }

  const normalizedDidMethod = normalizeOptionalText(didMethod)?.toLowerCase() ?? null;
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 10;
  const repairRecordsById = new Map();
  const allRepairRecordsById = new Map();

  for (const recordEntry of store.credentials || []) {
    const normalizedEntry = normalizeCredentialRecord(recordEntry);
    if (!normalizedEntry || normalizeCredentialKind(normalizedEntry.kind) !== "migration_receipt") {
      continue;
    }

    const payload = extractMigrationRepairPayload(deps, normalizedEntry);
    const links = payload?.links ?? normalizedEntry.migrationLinks ?? null;
    if (!repairLinksReferenceCredential(deps, links, normalizedRecord)) {
      continue;
    }

    const repairId = payload?.repairId ?? normalizeOptionalText(normalizedEntry.subjectId) ?? null;
    if (!repairId) {
      continue;
    }
    if (!allRepairRecordsById.has(repairId)) {
      allRepairRecordsById.set(repairId, []);
    }
    allRepairRecordsById.get(repairId).push(normalizedEntry);
    if (normalizedDidMethod && deps.didMethodFromReference(normalizedEntry.issuerDid) !== normalizedDidMethod) {
      continue;
    }
    if (!repairRecordsById.has(repairId)) {
      repairRecordsById.set(repairId, []);
    }
    repairRecordsById.get(repairId).push(normalizedEntry);
  }

  return [...repairRecordsById.entries()]
    .map(([repairId, repairRecords]) =>
      detailed
        ? buildMigrationRepairHistoryEntry(
            buildMigrationRepairView(deps, store, repairId, { didMethod: normalizedDidMethod, includeTimeline: false })
          )
        : summarizeMigrationRepairHistoryFromRecords(
            deps,
            repairId,
            repairRecords,
            allRepairRecordsById.get(repairId) ?? repairRecords
          )
    )
    .filter(Boolean)
    .sort((a, b) => new Date(b.latestIssuedAt || 0).getTime() - new Date(a.latestIssuedAt || 0).getTime())
    .slice(0, cappedLimit)
    .map((entry) => cloneJson(entry));
}

export function buildCredentialRepairAggregatesInStore(
  deps,
  store,
  credentials = [],
  { limit = 10, offset = 0, sortBy = "latestIssuedAt", sortOrder = "desc" } = {}
) {
  const { compareCredentialIds } = deps;
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 10;
  const cappedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
  const normalizedSortBy = normalizeOptionalText(sortBy)?.toLowerCase() ?? "latestissuedat";
  const normalizedSortOrder = normalizeOptionalText(sortOrder)?.toLowerCase() === "asc" ? "asc" : "desc";
  const direction = normalizedSortOrder === "asc" ? 1 : -1;
  const repairIds = new Set();

  for (const credential of credentials) {
    if (credential?.migrationRepairId) {
      repairIds.add(credential.migrationRepairId);
    }
    for (const repairId of credential?.repairIds || []) {
      if (repairId) {
        repairIds.add(repairId);
      }
    }
  }

  const aggregates = [...repairIds]
    .map((repairId) => {
      const repairView = buildMigrationRepairView(deps, store, repairId, { includeTimeline: false });
      const summary = buildMigrationRepairHistoryEntry(repairView);
      const relatedCredentials = credentials.filter(
        (credential) =>
          credential?.migrationRepairId === repairId ||
          (Array.isArray(credential?.repairIds) && credential.repairIds.includes(repairId))
      );

      return {
        ...summary,
        linkedCredentialCount: relatedCredentials.length,
        linkedCredentialRecordIds: relatedCredentials.map((credential) => credential.credentialRecordId).filter(Boolean),
        linkedCredentialIds: relatedCredentials.map((credential) => credential.credentialId).filter(Boolean),
        linkedCredentialKinds: [...new Set(relatedCredentials.map((credential) => credential.kind).filter(Boolean))],
        linkedCredentialSubjects: relatedCredentials.map((credential) => ({
          credentialRecordId: credential.credentialRecordId,
          credentialId: credential.credentialId,
          kind: credential.kind,
          subjectType: credential.subjectType,
          subjectId: credential.subjectId,
          subjectLabel: credential.subjectLabel,
        })),
      };
    })
    .sort((a, b) => {
      if (normalizedSortBy === "linkedcredentialcount") {
        const countDiff = Number(a.linkedCredentialCount || 0) - Number(b.linkedCredentialCount || 0);
        if (countDiff !== 0) {
          return countDiff * direction;
        }
      }

      if (normalizedSortBy === "repairedcount") {
        const repairedDiff = Number(a.repairedCount || 0) - Number(b.repairedCount || 0);
        if (repairedDiff !== 0) {
          return repairedDiff * direction;
        }
      }

      const timeDiff = new Date(a.latestIssuedAt || 0).getTime() - new Date(b.latestIssuedAt || 0).getTime();
      if (timeDiff !== 0) {
        return timeDiff * direction;
      }

      return compareCredentialIds(a.repairId, b.repairId) * direction;
    });

  const total = aggregates.length;
  const repairs = aggregates.slice(cappedOffset, cappedOffset + cappedLimit);

  return {
    repairs,
    total,
    limit: cappedLimit,
    offset: cappedOffset,
    hasMore: cappedOffset + repairs.length < total,
    latestIssuedAt: aggregates[0]?.latestIssuedAt ?? null,
  };
}

export async function listCredentialsApi(deps, options = {}) {
  const store = await deps.loadStore();
  const credentials = deps.listCredentialRecordViews(store, options);
  const repairs = buildCredentialRepairAggregatesInStore(deps, store, credentials, {
    limit: options.repairLimit,
    offset: options.repairOffset,
    sortBy: options.repairSortBy,
    sortOrder: options.repairSortOrder,
  });
  const counts = credentials.reduce(
    (acc, credential) => {
      acc.total += 1;
      if (credential.status === "active") acc.active += 1;
      if (credential.status === "revoked") acc.revoked += 1;
      if (credential.snapshotFresh === true) acc.fresh += 1;
      if (credential.snapshotFresh === false) acc.stale += 1;
      if (Number(credential.repairCount || 0) > 0) {
        acc.repaired += 1;
      } else {
        acc.unrepaired += 1;
      }
      const methodKey = credential.issuerDidMethod || "unknown";
      acc.byDidMethod[methodKey] = (acc.byDidMethod[methodKey] || 0) + 1;
      return acc;
    },
    { total: 0, active: 0, revoked: 0, fresh: 0, stale: 0, repaired: 0, unrepaired: 0, repairGroups: repairs.total, byDidMethod: {} }
  );
  counts.latestRepairAt = repairs.latestIssuedAt ?? null;

  return {
    credentials,
    counts,
    repairs: repairs.repairs,
    repairsPage: {
      total: repairs.total,
      limit: repairs.limit,
      offset: repairs.offset,
      hasMore: repairs.hasMore,
      latestIssuedAt: repairs.latestIssuedAt,
    },
  };
}

export async function getCredentialApi(deps, credentialId) {
  const store = await deps.loadStore();
  const record = deps.findCredentialRecordById(store, credentialId);
  if (!record) {
    throw new Error(`Credential not found: ${credentialId}`);
  }

  const credentialRecord = deps.buildCredentialRecordView(store, record, { includeRepairHistory: true });
  return {
    credentialRecord,
    credential: cloneJson(deps.normalizeCredentialRecord(record)?.credential),
    siblings: credentialRecord?.siblingMethods ?? null,
  };
}

export async function getCredentialTimelineApi(deps, credentialId) {
  const store = await deps.loadStore();
  const record = deps.findCredentialRecordById(store, credentialId);
  if (!record) {
    throw new Error(`Credential not found: ${credentialId}`);
  }
  const timeline = deps.buildCredentialTimeline(store, record);
  return {
    credentialId: record.credentialId,
    credentialRecord: deps.buildCredentialRecordView(store, record),
    timeline,
    timelineCount: timeline.length,
    latestTimelineAt: timeline.at(-1)?.timestamp ?? null,
  };
}

export async function getMigrationRepairApi(deps, repairId, { didMethod = null } = {}) {
  const store = await deps.loadStore();
  return buildMigrationRepairView(deps, store, repairId, { didMethod, includeTimeline: false });
}

export async function getMigrationRepairTimelineApi(deps, repairId, { didMethod = null } = {}) {
  const store = await deps.loadStore();
  return buildMigrationRepairView(deps, store, repairId, { didMethod, includeTimeline: true });
}

export async function getMigrationRepairCredentialsApi(
  deps,
  repairId,
  { didMethod = null, limit = 20, offset = 0, sortBy = "latestRepairAt", sortOrder = "desc" } = {}
) {
  const store = await deps.loadStore();
  const repairView = buildMigrationRepairView(deps, store, repairId, { didMethod, includeTimeline: false });
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 20;
  const cappedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
  const normalizedSortBy = normalizeOptionalText(sortBy)?.toLowerCase() ?? "latestrepairat";
  const normalizedSortOrder = normalizeOptionalText(sortOrder)?.toLowerCase() === "asc" ? "asc" : "desc";
  const direction = normalizedSortOrder === "asc" ? 1 : -1;
  const linkedCredentials = listMigrationRepairLinkedCredentialViews(deps, store, repairView, { didMethod, includeRepairHistory: true })
    .sort((a, b) => {
      if (normalizedSortBy === "repaircount") {
        const repairDiff = Number(a.repairCount || 0) - Number(b.repairCount || 0);
        if (repairDiff !== 0) return repairDiff * direction;
      }
      if (normalizedSortBy === "issuedat") {
        const issuedDiff = new Date(a.issuedAt || 0).getTime() - new Date(b.issuedAt || 0).getTime();
        if (issuedDiff !== 0) return issuedDiff * direction;
      }
      const latestRepairDiff = new Date(a.latestRepairAt || 0).getTime() - new Date(b.latestRepairAt || 0).getTime();
      if (latestRepairDiff !== 0) return latestRepairDiff * direction;
      return deps.compareCredentialIds(a.credentialRecordId, b.credentialRecordId) * direction;
    });
  const credentials = linkedCredentials.slice(cappedOffset, cappedOffset + cappedLimit);
  const counts = linkedCredentials.reduce(
    (acc, credential) => {
      acc.total += 1;
      const kindKey = credential.kind || "unknown";
      const methodKey = credential.issuerDidMethod || "unknown";
      acc.byKind[kindKey] = (acc.byKind[kindKey] || 0) + 1;
      acc.byDidMethod[methodKey] = (acc.byDidMethod[methodKey] || 0) + 1;
      return acc;
    },
    { total: 0, byKind: {}, byDidMethod: {}, latestRepairAt: linkedCredentials[0]?.latestRepairAt ?? null }
  );

  return {
    repairId: repairView.repairId,
    repair: buildMigrationRepairHistoryEntry(repairView),
    receipts: repairView.receipts,
    credentials,
    counts,
    page: {
      total: linkedCredentials.length,
      limit: cappedLimit,
      offset: cappedOffset,
      hasMore: cappedOffset + credentials.length < linkedCredentials.length,
      latestRepairAt: linkedCredentials[0]?.latestRepairAt ?? null,
    },
  };
}

export async function listMigrationRepairsApi(deps, options = {}) {
  const store = await deps.loadStore();
  const cappedLimit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Math.floor(Number(options.limit)) : 10;
  const cappedOffset = Number.isFinite(Number(options.offset)) && Number(options.offset) >= 0 ? Math.floor(Number(options.offset)) : 0;
  const allRepairs = listMigrationRepairViewsInStore(deps, store, {
    ...options,
    limit: Math.max(deps.DEFAULT_CREDENTIAL_LIMIT, (store.credentials || []).length || deps.DEFAULT_CREDENTIAL_LIMIT),
  });
  const pagedRepairs = allRepairs.slice(cappedOffset, cappedOffset + cappedLimit);
  const summaries = pagedRepairs.map((repairView) => buildMigrationRepairHistoryEntry(repairView));
  const counts = allRepairs.reduce(
    (acc, repairView) => {
      acc.total += 1;
      const scopeKey = repairView?.repair?.scope || "unknown";
      acc.byScope[scopeKey] = (acc.byScope[scopeKey] || 0) + 1;
      for (const method of repairView?.issuedDidMethods || []) {
        if (!method) continue;
        acc.byDidMethod[method] = (acc.byDidMethod[method] || 0) + 1;
      }
      return acc;
    },
    { total: 0, byScope: {}, byDidMethod: {}, latestIssuedAt: allRepairs[0]?.latestIssuedAt ?? null }
  );

  return {
    repairs: summaries,
    counts,
    page: {
      total: allRepairs.length,
      limit: cappedLimit,
      offset: cappedOffset,
      hasMore: cappedOffset + summaries.length < allRepairs.length,
      latestIssuedAt: allRepairs[0]?.latestIssuedAt ?? null,
    },
  };
}

export async function listCredentialStatusListsApi(deps, { issuerDid = null, issuerAgentId = null } = {}) {
  const store = await deps.loadStore();
  const resolvedIssuerDid =
    normalizeOptionalText(issuerDid) ??
    (issuerAgentId ? store.agents?.[issuerAgentId]?.identity?.did ?? null : null);
  const statusLists = deps.buildCredentialStatusLists(store, { issuerDid: resolvedIssuerDid });
  return {
    issuerDid: resolvedIssuerDid,
    count: statusLists.length,
    statusLists: statusLists.map((statusList) => statusList.summary),
  };
}

export async function compareCredentialStatusListsApi(deps, options = {}) {
  const store = await deps.loadStore();
  const leftResolved = deps.resolveCredentialStatusListReference(store, {
    statusListId: options.leftStatusListId,
    issuerDid: options.leftIssuerDid,
    issuerAgentId: options.leftIssuerAgentId,
  });
  const rightResolved = deps.resolveCredentialStatusListReference(store, {
    statusListId: options.rightStatusListId,
    issuerDid: options.rightIssuerDid,
    issuerAgentId: options.rightIssuerAgentId,
  });
  const leftStatusList = deps.buildCredentialStatusList(store, leftResolved.issuerDid);
  const rightStatusList = deps.buildCredentialStatusList(store, rightResolved.issuerDid);

  return {
    leftStatusListId: leftStatusList.statusListId,
    rightStatusListId: rightStatusList.statusListId,
    leftIssuerDid: leftStatusList.issuerDid,
    rightIssuerDid: rightStatusList.issuerDid,
    ...deps.buildCredentialStatusListComparison(store, leftStatusList, rightStatusList),
  };
}

export async function getCredentialStatusListApi(deps, statusListId = null) {
  const store = await deps.loadStore();
  const normalizedStatusListId = deps.normalizeCredentialStatusListReference(statusListId) ?? null;
  const requestedIssuerDid = deps.credentialStatusListIssuerDidFromId(normalizedStatusListId) ?? null;
  const statusLists = deps.buildCredentialStatusLists(store);
  const statusList =
    (normalizedStatusListId
      ? statusLists.find(
          (item) =>
            item.statusListId === normalizedStatusListId ||
            item.summary.statusListCredentialId === normalizedStatusListId
        )
      : null) ??
    (requestedIssuerDid ? deps.buildCredentialStatusList(store, requestedIssuerDid) : deps.buildCredentialStatusList(store));

  if (
    normalizedStatusListId &&
    statusList.statusListId !== normalizedStatusListId &&
    statusList.summary.statusListCredentialId !== normalizedStatusListId
  ) {
    throw new Error(`Status list not found: ${statusListId}`);
  }

  return {
    statusListId: statusList.statusListId,
    summary: statusList.summary,
    statusList: statusList.credential,
    entries: statusList.entries,
  };
}

export async function getCredentialStatusApi(deps, credentialId) {
  const store = await deps.loadStore();
  const record = deps.findCredentialRecordById(store, credentialId);
  if (!record) {
    throw new Error(`Credential not found: ${credentialId}`);
  }
  const status = deps.buildCredentialStatusProof(store, record);
  return {
    credentialId: record.credentialId,
    credentialRecord: deps.buildCredentialRecordView(store, record),
    credential: cloneJson(deps.normalizeCredentialRecord(record)?.credential),
    ...status,
  };
}

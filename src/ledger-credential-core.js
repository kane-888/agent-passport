import {
  buildDidSigningKeyId,
  deriveDid,
  parseDidReference,
  signCredentialHash,
} from "./identity.js";
import {
  cloneJson,
  createRecordId,
  hashJson,
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
  now,
} from "./ledger-core-utils.js";
import {
  ISSUE_BOTH_METHODS_REPAIR_ONLY_ERROR,
  LEGACY_STATUS_AUTHORIZATION_TYPE,
  LEGACY_STATUS_LEDGER_TYPE,
  PUBLIC_SIGNABLE_DID_METHODS,
  SIGNABLE_DID_METHODS,
  STATUS_ENTRY_TYPE,
  normalizeDidMethod,
} from "./protocol.js";
import { resolveAgentPassportChainId } from "./runtime-path-config.js";

const DEFAULT_CHAIN_ID = resolveAgentPassportChainId({ fallback: "agent-passport-alpha" });

export const CREDENTIAL_KINDS = new Set(["agent_identity", "authorization_receipt", "agent_comparison"]);
export const CREDENTIAL_STATUSES = new Set(["active", "revoked"]);
export const DEFAULT_CREDENTIAL_STATUS_PURPOSE = "revocation";
export const DEFAULT_CREDENTIAL_STATUS_ENTRY_TYPE = STATUS_ENTRY_TYPE;

export function buildLocalCredential({
  issuerDid,
  verificationMethod,
  credentialType,
  credentialSubject,
  credentialStatus = null,
  evidence = null,
  issuanceDate = now(),
  proofPurpose = "assertionMethod",
  chainId = DEFAULT_CHAIN_ID,
  ledgerHash = null,
}) {
  if (!issuerDid) {
    throw new Error("issuerDid is required");
  }

  const baseCredential = {
    "@context": ["https://www.w3.org/2018/credentials/v1", "https://www.w3.org/ns/did/v1"],
    type: ["VerifiableCredential", credentialType],
    issuer: issuerDid,
    issuanceDate,
    credentialSubject: cloneJson(credentialSubject) ?? null,
  };

  if (credentialStatus) {
    baseCredential.credentialStatus = cloneJson(credentialStatus);
  }

  if (evidence) {
    baseCredential.evidence = cloneJson(evidence);
  }

  const proofValue = hashJson(baseCredential);
  const signingProof = signCredentialHash({
    did: issuerDid,
    verificationMethod: normalizeOptionalText(verificationMethod) || buildDidSigningKeyId(issuerDid),
    credentialHash: proofValue,
  });

  return {
    id: `${issuerDid}#credential-${proofValue.slice(0, 12)}`,
    ...baseCredential,
    proof: {
      type: signingProof.type,
      created: issuanceDate,
      proofPurpose,
      verificationMethod: signingProof.verificationMethod,
      proofValue,
      signatureValue: signingProof.signatureValue,
      signatureAlgorithm: "ed25519",
      publicKeyHex: signingProof.publicKeyHex,
      hashAlgorithm: "sha256",
      chainId,
      ledgerHash: normalizeOptionalText(ledgerHash) ?? null,
    },
    evidenceHash: proofValue,
  };
}

export function stripLocalCredential(credential) {
  if (!credential || typeof credential !== "object") {
    return null;
  }

  const stripped = cloneJson(credential);
  if (!stripped || typeof stripped !== "object") {
    return null;
  }

  delete stripped.id;
  delete stripped.proof;
  delete stripped.evidenceHash;
  return stripped;
}

export function normalizeCredentialStatus(value) {
  const text = normalizeOptionalText(value)?.toLowerCase();
  if (!text) {
    return "active";
  }

  return CREDENTIAL_STATUSES.has(text) ? text : "active";
}

export function credentialSnapshotPurpose(record = {}) {
  const kind = normalizeCredentialKind(record.kind);
  const subjectType = normalizeOptionalText(record.subjectType) ?? null;

  if (kind === "agent_identity" || subjectType === "agent") {
    return "agentSnapshot";
  }

  if (kind === "authorization_receipt" || subjectType === "proposal") {
    return "proposalLifecycle";
  }

  if (kind === "agent_comparison" || subjectType === "comparison") {
    return "comparisonAudit";
  }

  if (kind === "migration_receipt" || subjectType === "repair") {
    return "migrationRepair";
  }

  return "credentialSnapshot";
}

export function restoreLegacyCredentialBody(record, credential) {
  if (!record || !credential || typeof credential !== "object") {
    return null;
  }

  const restored = cloneJson(credential);
  if (!restored || typeof restored !== "object") {
    return null;
  }

  const currentCredentialStatus = restored.credentialStatus && typeof restored.credentialStatus === "object" ? restored.credentialStatus : {};

  if (record.kind === "agent_identity" || record.subjectType === "agent") {
    restored.credentialStatus = {
      id: `${restored.issuer || record.issuerDid || record.issuedByDid || record.credentialId || record.subjectId || "credential"}#state`,
      type: LEGACY_STATUS_LEDGER_TYPE,
      statusPurpose: "agentSnapshot",
      chainId: currentCredentialStatus.chainId ?? null,
      ledgerHash: currentCredentialStatus.ledgerHash ?? null,
      agentId: currentCredentialStatus.agentId ?? record.subjectId ?? record.issuerAgentId ?? null,
    };
  } else if (record.kind === "authorization_receipt" || record.subjectType === "proposal") {
    restored.credentialStatus = {
      id: `${record.subjectId || currentCredentialStatus.proposalId || restored.credentialId || "proposal"}#state`,
      type: LEGACY_STATUS_AUTHORIZATION_TYPE,
      statusPurpose: "proposalLifecycle",
      chainId: currentCredentialStatus.chainId ?? null,
      ledgerHash: currentCredentialStatus.ledgerHash ?? null,
      proposalStatus: currentCredentialStatus.proposalStatus ?? record.status ?? null,
      proposalId: currentCredentialStatus.proposalId ?? record.subjectId ?? null,
    };
  } else if (record.kind === "agent_comparison" || record.subjectType === "comparison") {
    restored.credentialStatus = {
      id: `${record.subjectId || record.credentialId || "comparison"}#state`,
      type: LEGACY_STATUS_LEDGER_TYPE,
      statusPurpose: "comparisonAudit",
      chainId: currentCredentialStatus.chainId ?? null,
      ledgerHash: currentCredentialStatus.ledgerHash ?? null,
      comparisonDigest: currentCredentialStatus.comparisonDigest ?? record.comparisonDigest ?? null,
    };
  } else if (record.kind === "migration_receipt" || record.subjectType === "repair") {
    restored.credentialStatus = {
      id: `${record.subjectId || record.credentialId || "repair"}#state`,
      type: LEGACY_STATUS_LEDGER_TYPE,
      statusPurpose: "migrationRepair",
      chainId: currentCredentialStatus.chainId ?? null,
      ledgerHash: currentCredentialStatus.ledgerHash ?? null,
      repairId: currentCredentialStatus.repairId ?? record.migrationRepairId ?? record.subjectId ?? null,
    };
  } else {
    return null;
  }

  return restored;
}

export function normalizeCredentialStatusListReference(value) {
  const normalized = normalizeOptionalText(value) ?? null;
  if (!normalized) {
    return null;
  }

  return normalized
    .replace(/#credential$/, "")
    .replace(/#entry-\d+$/, "");
}

export function credentialStatusListIssuerDidFromId(statusListId) {
  const normalizedStatusListId = normalizeCredentialStatusListReference(statusListId) ?? null;
  if (!normalizedStatusListId) {
    return null;
  }

  const suffix = `#status-list-${DEFAULT_CREDENTIAL_STATUS_PURPOSE}`;
  if (!normalizedStatusListId.endsWith(suffix)) {
    return null;
  }

  return normalizedStatusListId.slice(0, -suffix.length);
}


export function resolveAgentDidForMethod(store, agent, didMethod = null) {
  const currentDid = normalizeOptionalText(agent?.identity?.did) ?? null;
  const parsedDid = parseDidReference(currentDid);
  if (!parsedDid?.chainId || !agent?.agentId) {
    return currentDid;
  }

  if (!normalizeOptionalText(didMethod)) {
    return currentDid;
  }

  return deriveDid(parsedDid.chainId, agent.agentId, didMethod);
}

export function didMethodFromReference(value) {
  return normalizeOptionalText(parseDidReference(value)?.method) ?? null;
}

export function listRequestedDidMethods({
  didMethod = null,
  issueBothMethods = false,
  allowCompatibilityIssue = false,
} = {}) {
  const methods = [normalizeDidMethod(didMethod)];
  if (normalizeBooleanFlag(issueBothMethods, false)) {
    if (!allowCompatibilityIssue) {
      throw new Error(ISSUE_BOTH_METHODS_REPAIR_ONLY_ERROR);
    }
    for (const method of SIGNABLE_DID_METHODS) {
      const normalizedMethod = normalizeDidMethod(method, method);
      if (!methods.includes(normalizedMethod)) {
        methods.push(normalizedMethod);
      }
    }
  }

  return methods;
}

export function buildCredentialDidMethodScopeDescriptor() {
  const compatibilitySignableDidMethods = SIGNABLE_DID_METHODS.filter(
    (method) => !PUBLIC_SIGNABLE_DID_METHODS.includes(method)
  );
  return {
    publicSignableDidMethods: [...PUBLIC_SIGNABLE_DID_METHODS],
    compatibilitySignableDidMethods,
    repairSignableDidMethods: [...SIGNABLE_DID_METHODS],
  };
}

export function buildCredentialDidMethodAvailability(availableDidMethods = []) {
  const normalizedAvailableDidMethods = [...new Set((availableDidMethods || []).filter(Boolean))];
  const scope = buildCredentialDidMethodScopeDescriptor();
  const publicAvailableDidMethods = scope.publicSignableDidMethods.filter((method) =>
    normalizedAvailableDidMethods.includes(method)
  );
  const compatibilityAvailableDidMethods = scope.compatibilitySignableDidMethods.filter((method) =>
    normalizedAvailableDidMethods.includes(method)
  );
  const repairAvailableDidMethods = scope.repairSignableDidMethods.filter((method) =>
    normalizedAvailableDidMethods.includes(method)
  );
  const publicMissingDidMethods = scope.publicSignableDidMethods.filter(
    (method) => !publicAvailableDidMethods.includes(method)
  );
  const compatibilityMissingDidMethods = scope.compatibilitySignableDidMethods.filter(
    (method) => !compatibilityAvailableDidMethods.includes(method)
  );
  const repairMissingDidMethods = scope.repairSignableDidMethods.filter(
    (method) => !repairAvailableDidMethods.includes(method)
  );

  return {
    ...scope,
    publicAvailableDidMethods,
    compatibilityAvailableDidMethods,
    repairAvailableDidMethods,
    publicMissingDidMethods,
    compatibilityMissingDidMethods,
    repairMissingDidMethods,
    publicComplete: scope.publicSignableDidMethods.length > 0 && publicMissingDidMethods.length === 0,
    compatibilityComplete:
      scope.compatibilitySignableDidMethods.length > 0 && compatibilityMissingDidMethods.length === 0,
    repairComplete: scope.repairSignableDidMethods.length > 0 && repairMissingDidMethods.length === 0,
  };
}

export function formatCredentialExportVariants(variants = []) {
  const [primary, ...alternates] = variants;
  return {
    didMethod: primary?.didMethod ?? null,
    issuedDidMethods: variants.map((variant) => variant.didMethod).filter(Boolean),
    credential: primary?.credential ?? null,
    credentialRecord: primary?.credentialRecord ?? null,
    alternates,
  };
}

export function formatComparisonEvidenceVariants(variants = []) {
  const [primary, ...alternates] = variants;
  return {
    didMethod: primary?.didMethod ?? null,
    issuedDidMethods: variants.map((variant) => variant.didMethod).filter(Boolean),
    comparison: primary?.comparison ?? null,
    comparisonDigest: primary?.comparisonDigest ?? null,
    repairIds: primary?.repairIds ?? [],
    migrationRepairs: primary?.migrationRepairs ?? [],
    evidence: primary?.evidence ?? null,
    alternates,
  };
}

export function normalizeCredentialKind(value) {
  const text = normalizeOptionalText(value);
  if (!text) {
    return "agent_identity";
  }

  return text;
}

export function normalizeCredentialRecord(record, fallback = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }

  let credential = record.credential && typeof record.credential === "object" ? cloneJson(record.credential) : null;
  const credentialStatus = credential?.credentialStatus && typeof credential.credentialStatus === "object" ? cloneJson(credential.credentialStatus) : null;
  const credentialRecordId = normalizeOptionalText(record.credentialRecordId || fallback.credentialRecordId) || createRecordId("credrec");
  const credentialId = normalizeOptionalText(record.credentialId || credential?.id || fallback.credentialId) ?? null;
  const kind = normalizeCredentialKind(record.kind || fallback.kind);
  const subjectType = normalizeOptionalText(record.subjectType || fallback.subjectType) ?? null;
  const subjectId = normalizeOptionalText(record.subjectId || fallback.subjectId) ?? null;
  const issuerDid = normalizeOptionalText(record.issuerDid || credential?.issuer || fallback.issuerDid) ?? null;
  const issuerAgentId = normalizeOptionalText(record.issuerAgentId || fallback.issuerAgentId) ?? null;
  const issuerLabel = normalizeOptionalText(record.issuerLabel || fallback.issuerLabel) ?? null;
  const issuedAt = normalizeOptionalText(record.issuedAt || credential?.issuanceDate || fallback.issuedAt) || now();
  const updatedAt = normalizeOptionalText(record.updatedAt || fallback.updatedAt) ?? issuedAt;
  const status = normalizeCredentialStatus(record.status || fallback.status);
  const ledgerHash = normalizeOptionalText(record.ledgerHash || credential?.proof?.ledgerHash || fallback.ledgerHash) ?? null;
  const proofValue = normalizeOptionalText(record.proofValue || credential?.proof?.proofValue || fallback.proofValue) ?? null;
  const proofMethod = normalizeOptionalText(record.proofMethod || credential?.proof?.verificationMethod || fallback.proofMethod) ?? null;
  const credentialHash = credential ? hashJson(stripLocalCredential(credential)) : null;
  if (credential && proofValue && credentialHash !== proofValue) {
    const legacyCredential = restoreLegacyCredentialBody(record, credential);
    if (legacyCredential) {
      const legacyHash = hashJson(stripLocalCredential(legacyCredential));
      if (legacyHash === proofValue) {
        credential = legacyCredential;
      }
    }
  }
  const statusListId = normalizeOptionalText(
    record.statusListId ||
      credentialStatus?.statusListId ||
      credentialStatus?.statusListCredential?.replace(/#credential$/, "") ||
      fallback.statusListId
  ) ?? null;
  const statusListIndex = Number.isFinite(Number(record.statusListIndex ?? credentialStatus?.statusListIndex ?? fallback.statusListIndex))
    ? Math.max(0, Math.floor(Number(record.statusListIndex ?? credentialStatus?.statusListIndex ?? fallback.statusListIndex)))
    : null;
  const statusPurpose = normalizeOptionalText(
    record.statusPurpose || credentialStatus?.statusPurpose || fallback.statusPurpose
  ) ?? DEFAULT_CREDENTIAL_STATUS_PURPOSE;
  const statusListCredentialId = normalizeOptionalText(
    record.statusListCredentialId ||
      credentialStatus?.statusListCredential ||
      fallback.statusListCredentialId
  ) ?? (statusListId ? `${statusListId}#credential` : null);
  const statusListEntryId = normalizeOptionalText(
    record.statusListEntryId ||
      credentialStatus?.id ||
      fallback.statusListEntryId
  ) ?? (statusListId && statusListIndex != null ? `${statusListId}#entry-${statusListIndex}` : null);
  const relatedAgentIds = normalizeTextList(record.relatedAgentIds || fallback.relatedAgentIds);
  const comparisonDigest = normalizeOptionalText(
    record.comparisonDigest ||
      credential?.credentialSubject?.comparisonDigest ||
      credential?.evidence?.comparisonDigest ||
      fallback.comparisonDigest
  ) ?? null;
  const comparisonLeftAgentId = normalizeOptionalText(
    record.comparisonLeftAgentId ||
      credential?.credentialSubject?.leftAgentId ||
      credential?.evidence?.left?.agentId ||
      fallback.comparisonLeftAgentId
  ) ?? null;
  const comparisonRightAgentId = normalizeOptionalText(
    record.comparisonRightAgentId ||
      credential?.credentialSubject?.rightAgentId ||
      credential?.evidence?.right?.agentId ||
      fallback.comparisonRightAgentId
  ) ?? null;
  const comparisonLeftDid = normalizeOptionalText(
    record.comparisonLeftDid ||
      credential?.credentialSubject?.leftDid ||
      credential?.evidence?.left?.did ||
      fallback.comparisonLeftDid
  ) ?? null;
  const comparisonRightDid = normalizeOptionalText(
    record.comparisonRightDid ||
      credential?.credentialSubject?.rightDid ||
      credential?.evidence?.right?.did ||
      fallback.comparisonRightDid
  ) ?? null;
  const comparisonLabel = normalizeOptionalText(
    record.comparisonLabel ||
      credential?.credentialSubject?.summary ||
      credential?.evidence?.comparison?.summary ||
      fallback.comparisonLabel
  ) ?? null;
  const migrationRepairId = normalizeOptionalText(
    record.migrationRepairId ||
      credential?.credentialSubject?.repairId ||
      credential?.evidence?.repairId ||
      fallback.migrationRepairId
  ) ?? null;
  const migrationRepairScope = normalizeOptionalText(
    record.migrationRepairScope ||
      credential?.credentialSubject?.scope ||
      credential?.evidence?.scope ||
      fallback.migrationRepairScope
  ) ?? null;
  const migrationTargetAgentId = normalizeOptionalText(
    record.migrationTargetAgentId ||
      credential?.credentialSubject?.targetAgentId ||
      credential?.evidence?.targetAgentId ||
      fallback.migrationTargetAgentId
  ) ?? null;
  const migrationSummary = normalizeOptionalText(
    record.migrationSummary ||
      credential?.credentialSubject?.summary ||
      credential?.evidence?.summary ||
      fallback.migrationSummary
  ) ?? null;
  const migrationLinks = cloneJson(
    record.migrationLinks ||
      credential?.credentialSubject?.links ||
      credential?.evidence?.links ||
      fallback.migrationLinks
  ) ?? null;
  const timeline = normalizeCredentialTimelineRecords(record.timeline || fallback.timeline || [], {
    credentialRecordId,
    credentialId,
    kind,
    subjectType,
    subjectId,
    issuerAgentId,
    issuerLabel,
    issuerDid,
    issuedByAgentId: record.issuedByAgentId || fallback.issuedByAgentId || null,
    issuedByLabel: record.issuedByLabel || fallback.issuedByLabel || null,
    issuedByDid: record.issuedByDid || fallback.issuedByDid || null,
    issuedByWalletAddress: record.issuedByWalletAddress || fallback.issuedByWalletAddress || null,
    issuedByWindowId: record.issuedByWindowId || fallback.issuedByWindowId || null,
    source: normalizeOptionalText(record.source || fallback.source) ?? "credential_issue",
  });

  return {
    credentialRecordId,
    credentialId,
    kind,
    subjectType,
    subjectId,
    issuerAgentId,
    issuerLabel,
    issuerDid,
    issuedAt,
    updatedAt,
    status,
    ledgerHash,
    proofValue,
    proofMethod,
    statusListId,
    statusListIndex,
    statusPurpose,
    statusListCredentialId,
    statusListEntryId,
    relatedAgentIds,
    comparisonDigest,
    comparisonLeftAgentId,
    comparisonRightAgentId,
    comparisonLeftDid,
    comparisonRightDid,
    comparisonLabel,
    migrationRepairId,
    migrationRepairScope,
    migrationTargetAgentId,
    migrationSummary,
    migrationLinks,
    source: normalizeOptionalText(record.source || fallback.source) ?? "credential_issue",
    note: normalizeOptionalText(record.note || fallback.note) ?? null,
    issuedByAgentId: normalizeOptionalText(record.issuedByAgentId || fallback.issuedByAgentId) ?? null,
    issuedByLabel: normalizeOptionalText(record.issuedByLabel || fallback.issuedByLabel) ?? null,
    issuedByDid: normalizeOptionalText(record.issuedByDid || fallback.issuedByDid) ?? null,
    issuedByWalletAddress: normalizeOptionalText(record.issuedByWalletAddress || fallback.issuedByWalletAddress)?.toLowerCase() ?? null,
    issuedByWindowId: normalizeOptionalText(record.issuedByWindowId || fallback.issuedByWindowId) ?? null,
    revokedAt: normalizeOptionalText(record.revokedAt || fallback.revokedAt) ?? null,
    revokedByAgentId: normalizeOptionalText(record.revokedByAgentId || fallback.revokedByAgentId) ?? null,
    revokedByLabel: normalizeOptionalText(record.revokedByLabel || fallback.revokedByLabel) ?? null,
    revokedByDid: normalizeOptionalText(record.revokedByDid || fallback.revokedByDid) ?? null,
    revokedByWalletAddress: normalizeOptionalText(record.revokedByWalletAddress || fallback.revokedByWalletAddress)?.toLowerCase() ?? null,
    revokedByWindowId: normalizeOptionalText(record.revokedByWindowId || fallback.revokedByWindowId) ?? null,
    revocationReason: normalizeOptionalText(record.revocationReason || fallback.revocationReason) ?? null,
    revocationNote: normalizeOptionalText(record.revocationNote || fallback.revocationNote) ?? null,
    timeline,
    credential,
  };
}

export function normalizeCredentialTimelineEntry(entry, fallback = {}) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    timelineId: normalizeOptionalText(entry.timelineId || fallback.timelineId) || createRecordId("credtl"),
    credentialRecordId: normalizeOptionalText(entry.credentialRecordId || fallback.credentialRecordId) ?? null,
    credentialId: normalizeOptionalText(entry.credentialId || fallback.credentialId) ?? null,
    kind: normalizeOptionalText(entry.kind || fallback.kind) ?? "credential_event",
    timestamp: normalizeOptionalText(entry.timestamp || fallback.timestamp) || now(),
    actorAgentId: normalizeOptionalText(entry.actorAgentId || fallback.actorAgentId) ?? null,
    actorLabel: normalizeOptionalText(entry.actorLabel || fallback.actorLabel) ?? null,
    actorDid: normalizeOptionalText(entry.actorDid || fallback.actorDid) ?? null,
    actorWalletAddress: normalizeOptionalText(entry.actorWalletAddress || fallback.actorWalletAddress)?.toLowerCase() ?? null,
    actorWindowId: normalizeOptionalText(entry.actorWindowId || fallback.actorWindowId) ?? null,
    summary: normalizeOptionalText(entry.summary || fallback.summary) ?? null,
    details: cloneJson(entry.details ?? fallback.details) ?? null,
    eventHash: normalizeOptionalText(entry.eventHash || fallback.eventHash) ?? null,
    eventIndex: Number.isFinite(Number(entry.eventIndex ?? fallback.eventIndex))
      ? Math.floor(Number(entry.eventIndex ?? fallback.eventIndex))
      : null,
    source: normalizeOptionalText(entry.source || fallback.source) ?? "credential",
    order: Number.isFinite(Number(entry.order ?? fallback.order)) ? Math.floor(Number(entry.order ?? fallback.order)) : 0,
  };
}

export function normalizeCredentialTimelineRecords(records, fallback = {}) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map((entry) => normalizeCredentialTimelineEntry(entry, fallback)).filter(Boolean);
}

export function compareCredentialTimelineEntries(a, b) {
  const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }

  const orderDiff = (a.order ?? 0) - (b.order ?? 0);
  if (orderDiff !== 0) {
    return orderDiff;
  }

  const indexA = a.eventIndex ?? Number.POSITIVE_INFINITY;
  const indexB = b.eventIndex ?? Number.POSITIVE_INFINITY;
  if (indexA !== indexB) {
    return indexA - indexB;
  }

  return a.timelineId.localeCompare(b.timelineId);
}


export function compareCredentialIds(a, b) {
  const textA = normalizeOptionalText(a) ?? "";
  const textB = normalizeOptionalText(b) ?? "";
  return textA.localeCompare(textB);
}


export function createCredentialRecord({
  credential,
  kind,
  subjectType,
  subjectId,
  issuerAgentId,
  relatedAgentIds = [],
  comparisonDigest = null,
  comparisonLeftAgentId = null,
  comparisonRightAgentId = null,
  comparisonLeftDid = null,
  comparisonRightDid = null,
  comparisonLabel = null,
  statusListId = null,
  statusListIndex = null,
  statusPurpose = DEFAULT_CREDENTIAL_STATUS_PURPOSE,
  issuedByAgentId = null,
  issuedByLabel = null,
  issuedByDid = null,
  issuedByWalletAddress = null,
  issuedByWindowId = null,
  source = "credential_issue",
  note = null,
}) {
  const normalizedCredential = cloneJson(credential);
  if (!normalizedCredential || typeof normalizedCredential !== "object") {
    throw new Error("credential is required");
  }

  const credentialRecordId = createRecordId("credrec");
  const issuedAt = normalizedCredential.issuanceDate || now();
  const subjectLabel = normalizeOptionalText(comparisonLabel || note || subjectId) ?? normalizedCredential.id;
  const issueTimelineEntry = normalizeCredentialTimelineEntry(
    {
      timelineId: createRecordId("credtl"),
      credentialRecordId,
      credentialId: normalizedCredential.id,
      kind: "credential_issued",
      timestamp: issuedAt,
      actorAgentId: issuedByAgentId ?? issuerAgentId ?? null,
      actorLabel: issuedByLabel ?? issuerAgentId ?? normalizedCredential.issuer ?? null,
      actorDid: issuedByDid ?? normalizedCredential.issuer ?? null,
      actorWalletAddress: issuedByWalletAddress ?? null,
      actorWindowId: issuedByWindowId ?? null,
      summary: `证据签发：${subjectLabel}`,
      details: {
        credentialRecordId,
        credentialId: normalizedCredential.id,
        kind,
        subjectType,
        subjectId,
        issuerAgentId,
        issuerDid: normalizedCredential.issuer,
        statusListId,
        statusListIndex,
        statusPurpose,
        ledgerHash: normalizedCredential.proof?.ledgerHash ?? null,
        proofValue: normalizedCredential.proof?.proofValue ?? null,
        status: "active",
      },
      source,
      order: 10,
    },
    {
      credentialRecordId,
      credentialId: normalizedCredential.id,
      kind: "credential_issued",
      timestamp: issuedAt,
      source,
    }
  );

  return normalizeCredentialRecord(
    {
      credentialRecordId,
      credentialId: normalizedCredential.id,
      kind,
      subjectType,
      subjectId,
      issuerAgentId,
      relatedAgentIds,
      comparisonDigest,
      comparisonLeftAgentId,
      comparisonRightAgentId,
      comparisonLeftDid,
      comparisonRightDid,
      comparisonLabel,
      issuerDid: normalizedCredential.issuer,
      issuedAt,
      updatedAt: issuedAt,
      status: "active",
      ledgerHash: normalizedCredential.proof?.ledgerHash ?? null,
      proofValue: normalizedCredential.proof?.proofValue ?? null,
      proofMethod: normalizedCredential.proof?.verificationMethod ?? null,
      statusListId,
      statusListIndex,
      statusPurpose,
      statusListCredentialId: statusListId ? `${statusListId}#credential` : null,
      statusListEntryId: statusListId != null && statusListIndex != null ? `${statusListId}#entry-${statusListIndex}` : null,
      issuedByAgentId,
      issuedByLabel,
      issuedByDid,
      issuedByWalletAddress,
      issuedByWindowId,
      source,
      note,
      timeline: [issueTimelineEntry],
      credential: normalizedCredential,
    },
    {
      credentialRecordId,
      kind,
      subjectType,
      subjectId,
      issuerAgentId,
      relatedAgentIds,
      comparisonDigest,
      comparisonLeftAgentId,
      comparisonRightAgentId,
      comparisonLeftDid,
      comparisonRightDid,
      comparisonLabel,
      issuedByAgentId,
      issuedByLabel,
      issuedByDid,
      issuedByWalletAddress,
      issuedByWindowId,
      source,
      note,
      status: "active",
      timeline: [issueTimelineEntry],
      credential: normalizedCredential,
    }
  );
}

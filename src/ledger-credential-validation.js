import {
  verifyCredentialHashSignature,
} from "./identity.js";
import {
  hashJson,
  normalizeOptionalText,
} from "./ledger-core-utils.js";
import {
  normalizeCredentialRecord,
  normalizeCredentialStatus,
  stripLocalCredential,
} from "./ledger-credential-core.js";
import {
  findCredentialRecordByCredential,
} from "./ledger-credential-record-view.js";
import {
  buildCredentialStatusProof,
} from "./ledger-credential-status-list.js";
import {
  findAgentByDid,
} from "./ledger-identity-compat.js";
import {
  AGENT_IDENTITY_CREDENTIAL_TYPE,
  AGENT_SNAPSHOT_EVIDENCE_TYPE,
  AUTHORIZATION_RECEIPT_CREDENTIAL_TYPE,
  AUTHORIZATION_TIMELINE_EVIDENCE_TYPE,
  COMPARISON_EVIDENCE_CREDENTIAL_TYPE,
  COMPARISON_EVIDENCE_TYPE,
  LEGACY_AGENT_IDENTITY_CREDENTIAL_TYPE,
  LEGACY_AUTHORIZATION_RECEIPT_CREDENTIAL_TYPE,
  LEGACY_COMPARISON_EVIDENCE_CREDENTIAL_TYPE,
  LEGACY_MIGRATION_RECEIPT_CREDENTIAL_TYPE,
  MIGRATION_RECEIPT_CREDENTIAL_TYPE,
  MIGRATION_REPAIR_EVIDENCE_TYPE,
  STATUS_ENTRY_TYPE,
  VC_SIGNATURE_PROOF_TYPE,
} from "./protocol.js";

export function credentialRecordHasValidProof(record) {
  const normalizedRecord = normalizeCredentialRecord(record);
  const credential = normalizedRecord?.credential;
  const proofValue = normalizeOptionalText(normalizedRecord?.proofValue || credential?.proof?.proofValue) ?? null;
  if (!credential || !proofValue) {
    return false;
  }

  return hashJson(stripLocalCredential(credential)) === proofValue;
}

export function verifyCredentialInStore(store, credential = null) {
  const inputCredential = credential?.credential ?? credential;
  if (!inputCredential || typeof inputCredential !== "object") {
    throw new Error("credential is required");
  }

  const issuerDid = normalizeOptionalText(inputCredential.issuer) ?? null;
  const proof = inputCredential.proof && typeof inputCredential.proof === "object" ? inputCredential.proof : null;
  const proofType = normalizeOptionalText(proof?.type) ?? null;
  const proofValue = normalizeOptionalText(proof?.proofValue) ?? null;
  const proofMethod = normalizeOptionalText(proof?.verificationMethod) ?? null;
  const credentialHash = hashJson(stripLocalCredential(inputCredential));
  const hashMatches = proofValue ? credentialHash === proofValue : false;
  const signatureVerification = verifyCredentialHashSignature({
    did: issuerDid,
    verificationMethod: proofMethod,
    credentialHash: credentialHash,
    signatureValue: proof?.signatureValue,
    publicKeyHex: proof?.publicKeyHex,
  });
  const signatureRequired = Boolean(
    signatureVerification.signaturePresent ||
      proofType === VC_SIGNATURE_PROOF_TYPE ||
      (proofMethod && proofMethod.includes("#signing-"))
  );
  const signatureMatches = signatureRequired ? signatureVerification.signatureMatches === true : null;
  const issuerKnown = issuerDid ? Boolean(findAgentByDid(store, issuerDid)) : false;
  const currentLedgerHash = store.lastEventHash ?? null;
  const proofLedgerHash = normalizeOptionalText(proof?.ledgerHash) ?? null;
  const registryRecord = findCredentialRecordByCredential(store, inputCredential);
  const registryStatus = registryRecord ? normalizeCredentialStatus(registryRecord.status) : null;
  const isRevoked = registryStatus === "revoked";
  const statusList = registryRecord ? buildCredentialStatusProof(store, registryRecord) : null;
  const statusListStatus = statusList?.status ?? null;
  const statusListIndex = statusList?.credentialStatus?.statusListIndex ?? null;
  const statusListKnown = Boolean(statusList?.statusEntry);
  const statusListMatches = statusList ? Boolean(statusList.statusProof.statusMatchesRegistry && statusList.statusProof.registryStatus === registryStatus) : null;

  return {
    valid: Boolean(
      hashMatches &&
        issuerKnown &&
        !isRevoked &&
        (statusListMatches === null || statusListMatches === true) &&
        (!signatureRequired || signatureMatches === true)
    ),
    hashMatches,
    signatureRequired,
    signaturePresent: signatureVerification.signaturePresent,
    signatureMatches,
    signaturePublicKeyMatches: signatureVerification.publicKeyMatches,
    issuerKnown,
    issuerDid,
    proofType,
    proofMethod,
    credentialHash,
    proofValue,
    signatureValue: normalizeOptionalText(proof?.signatureValue) ?? null,
    expectedVerificationMethod: signatureVerification.expectedVerificationMethod ?? null,
    expectedPublicKeyHex: signatureVerification.publicKeyHex ?? null,
    currentLedgerHash,
    proofLedgerHash,
    snapshotFresh: proofLedgerHash ? proofLedgerHash === currentLedgerHash : null,
    registryStatus,
    registryKnown: Boolean(registryRecord),
    isRevoked,
    statusListKnown,
    statusListId: statusList?.credentialStatus?.statusListId ?? registryRecord?.statusListId ?? null,
    statusListCredentialId: statusList?.credentialStatus?.statusListCredential ?? registryRecord?.statusListCredentialId ?? null,
    statusListIndex: statusListIndex ?? registryRecord?.statusListIndex ?? null,
    statusListStatus,
    statusListHash: statusList?.statusProof?.statusListHash ?? null,
    statusListLedgerHash: statusList?.statusProof?.statusListLedgerHash ?? null,
    statusListMatches,
    statusProof: statusList?.statusProof ?? null,
    statusList: statusList
      ? {
          credential: statusList.statusList?.credential ?? null,
          summary: statusList.statusList?.summary ?? null,
          entries: statusList.statusList?.entries ?? [],
        }
      : null,
    revokedAt: registryRecord?.revokedAt ?? null,
    revokedByAgentId: registryRecord?.revokedByAgentId ?? null,
    revokedByLabel: registryRecord?.revokedByLabel ?? null,
    revocationReason: registryRecord?.revocationReason ?? null,
    credentialRecordId: registryRecord?.credentialRecordId ?? null,
    type: Array.isArray(inputCredential.type) ? inputCredential.type : [inputCredential.type].filter(Boolean),
    credentialId: normalizeOptionalText(inputCredential.id) ?? null,
    reason: !hashMatches
      ? "credential hash mismatch"
      : signatureRequired && signatureMatches !== true
        ? "credential signature mismatch"
        : !issuerKnown
          ? "issuer unknown"
          : isRevoked
            ? "credential revoked"
            : statusListMatches === false
              ? "status list mismatch"
          : null,
  };
}

function typeListIncludes(value, canonicalType, legacyTypes = []) {
  const normalizedTypes = (Array.isArray(value) ? value : [value])
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean);
  return [canonicalType, ...legacyTypes].some((candidate) => normalizedTypes.includes(candidate));
}

export function credentialUsesAgentPassportSignature(record) {
  const proof = normalizeCredentialRecord(record)?.credential?.proof;
  return Boolean(
    normalizeOptionalText(proof?.type) === VC_SIGNATURE_PROOF_TYPE &&
      normalizeOptionalText(proof?.signatureValue)
  );
}

export function credentialUsesCanonicalAgentPassportTypes(record) {
  const normalizedRecord = normalizeCredentialRecord(record);
  const credential = normalizedRecord?.credential;
  if (!credential || typeof credential !== "object") {
    return false;
  }

  const credentialStatusType = normalizeOptionalText(credential?.credentialStatus?.type) ?? null;
  if (credentialStatusType !== STATUS_ENTRY_TYPE) {
    return false;
  }

  if (normalizedRecord.kind === "agent_identity") {
    return (
      typeListIncludes(credential.type, AGENT_IDENTITY_CREDENTIAL_TYPE, [LEGACY_AGENT_IDENTITY_CREDENTIAL_TYPE]) &&
      normalizeOptionalText(credential?.evidence?.type) === AGENT_SNAPSHOT_EVIDENCE_TYPE
    );
  }

  if (normalizedRecord.kind === "authorization_receipt") {
    return (
      typeListIncludes(credential.type, AUTHORIZATION_RECEIPT_CREDENTIAL_TYPE, [LEGACY_AUTHORIZATION_RECEIPT_CREDENTIAL_TYPE]) &&
      normalizeOptionalText(credential?.evidence?.type) === AUTHORIZATION_TIMELINE_EVIDENCE_TYPE
    );
  }

  if (normalizedRecord.kind === "agent_comparison") {
    return (
      typeListIncludes(credential.type, COMPARISON_EVIDENCE_CREDENTIAL_TYPE, [LEGACY_COMPARISON_EVIDENCE_CREDENTIAL_TYPE]) &&
      normalizeOptionalText(credential?.evidence?.type) === COMPARISON_EVIDENCE_TYPE
    );
  }

  if (normalizedRecord.kind === "migration_receipt") {
    return (
      typeListIncludes(credential.type, MIGRATION_RECEIPT_CREDENTIAL_TYPE, [LEGACY_MIGRATION_RECEIPT_CREDENTIAL_TYPE]) &&
      normalizeOptionalText(credential?.evidence?.type) === MIGRATION_REPAIR_EVIDENCE_TYPE
    );
  }

  return true;
}

export function credentialRecordUsesIssuerDid(record, issuerDid) {
  return normalizeOptionalText(normalizeCredentialRecord(record)?.issuerDid) === normalizeOptionalText(issuerDid);
}

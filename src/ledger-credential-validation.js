import {
  hashJson,
  normalizeOptionalText,
} from "./ledger-core-utils.js";
import {
  normalizeCredentialRecord,
  stripLocalCredential,
} from "./ledger-credential-core.js";
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

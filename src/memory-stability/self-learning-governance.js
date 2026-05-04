import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_MEMORY_STABILITY_REPO_ROOT, resolveMemoryStabilityPathInsideRoot } from "./contract-loader.js";

export const SELF_LEARNING_PROPOSAL_SCHEMA_ID = "self-learning-governance-learning-proposal.schema.json";
export const SELF_LEARNING_PROPOSAL_ENVELOPE_SCHEMA_VERSION =
  "self-learning-governance-learning-proposal-envelope/v1";
export const SELF_LEARNING_DRY_RUN_SCHEMA_ID = "self-learning-governance-dry-run.schema.json";
export const SELF_LEARNING_DRY_RUN_SCHEMA_VERSION = "self-learning-governance-dry-run/v1";
export const SELF_LEARNING_RECOVERY_REPORT_SCHEMA_ID = "self-learning-governance-recovery-report.schema.json";
export const SELF_LEARNING_RECOVERY_REPORT_SCHEMA_VERSION = "self-learning-governance-recovery-report/v1";

export const DEFAULT_SELF_LEARNING_PROPOSAL_SCHEMA_PATH =
  "contracts/memory-stability/schemas/self-learning-governance-learning-proposal.schema.json";
export const DEFAULT_SELF_LEARNING_DRY_RUN_SCHEMA_PATH =
  "contracts/memory-stability/schemas/self-learning-governance-dry-run.schema.json";
export const DEFAULT_SELF_LEARNING_RECOVERY_REPORT_SCHEMA_PATH =
  "contracts/memory-stability/schemas/self-learning-governance-recovery-report.schema.json";
export const DEFAULT_SELF_LEARNING_PROPOSAL_FIXTURE_PATH =
  "tests/fixtures/memory-stability/self-learning/redacted/memory-learning-proposal.redacted.json";
export const DEFAULT_SELF_LEARNING_APPLY_DRY_RUN_FIXTURE_PATH =
  "tests/fixtures/memory-stability/self-learning/dry-runs/memory-learning-proposal-apply-dry-run.json";
export const DEFAULT_SELF_LEARNING_REVERT_DRY_RUN_FIXTURE_PATH =
  "tests/fixtures/memory-stability/self-learning/dry-runs/memory-learning-proposal-revert-dry-run.json";
export const DEFAULT_SELF_LEARNING_RECOVERY_REPORT_FIXTURE_PATH =
  "tests/fixtures/memory-stability/self-learning/recovery/memory-learning-proposal-recovery-required-report.json";

const PROPOSAL_TYPES = new Set(["memory", "profile", "skill", "policy"]);
const SOURCE_TYPES = new Set(["perceived", "reported", "derived", "verified"]);
const EPISTEMIC_STATUSES = new Set(["candidate", "inferred", "verified"]);
const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const STATUSES = new Set([
  "draft",
  "quarantined",
  "pending_review",
  "approved",
  "applying",
  "applied",
  "apply_failed",
  "rejected",
  "reverting",
  "reverted",
  "revert_failed",
  "recovery_required",
]);
const REVIEW_MODES = new Set(["auto", "human", "multisig"]);
const TARGET_LAYERS = new Set(["working", "episodic", "semantic", "profile", "skill", "policy"]);
const EVIDENCE_KINDS = new Set(["session", "tool_result", "correction_event", "external_recall", "human_direct"]);
const REQUESTED_OPERATIONS = new Set([
  "propose_memory",
  "propose_profile_patch",
  "propose_skill_version",
  "propose_policy_change",
  "direct_canonical_write",
  "activate_profile",
  "activate_skill",
]);
const APPLY_STATUSES = new Set(["approved", "applying", "applied"]);
const CONTEXT_INJECTABLE_STATUSES = new Set(["applied", "active"]);
const ADMISSION_DECISIONS = new Set(["draft", "approved_auto", "pending_review", "quarantined", "rejected"]);
const ROLLBACK_STRATEGIES = new Set([
  "mark_inactive",
  "restore_previous_version",
  "deny_context_injection",
  "checkpoint_restore",
]);
const DRY_RUN_MODES = new Set(["apply", "revert"]);
const DRY_RUN_SCOPE_VALUES = new Set(["memory", "profile", "skill", "session"]);
const RECORD_TYPES = new Set(["passportMemory", "profileVersion", "skillVersion"]);
const RECORD_TYPE_TO_SCOPE = Object.freeze({
  passportMemory: "memory",
  profileVersion: "profile",
  skillVersion: "skill",
});
const RECOVERY_MATCHED_OPERATION_STATES = new Set(["apply_failed", "revert_failed", "recovery_required"]);
const RECOVERY_SCAN_OPERATION_STATES = Object.freeze([
  "applying",
  "reverting",
  "apply_failed",
  "revert_failed",
  "recovery_required",
]);
const RECOVERY_RESUME_ACTIONS = new Set([
  "repair_ledger_then_rebuild_context",
  "resume_apply_from_idempotency_key",
  "restore_from_checkpoint_then_retry",
]);

const ENVELOPE_KEYS = new Set(["schema_version", "learningProposal"]);
const PROPOSAL_KEYS = new Set([
  "proposalId",
  "agentId",
  "canonicalAgentId",
  "namespaceScopeId",
  "passportNamespaceId",
  "type",
  "sourceSessionId",
  "sourceRunId",
  "sourceWindowId",
  "evidenceIds",
  "candidate",
  "rationale",
  "sourceType",
  "epistemicStatus",
  "confidence",
  "salience",
  "riskLevel",
  "admission",
  "status",
  "reviewer",
  "appliedRecordIds",
  "rollbackPlan",
  "createdAt",
  "appliedAt",
  "revertedAt",
]);
const CANDIDATE_KEYS = new Set([
  "targetLayer",
  "summary",
  "contentSha256",
  "evidenceKind",
  "requestedOperation",
  "targetRecordIds",
  "protectedTarget",
  "conflictRecordIds",
]);
const ADMISSION_KEYS = new Set(["duplicateOf", "conflicts", "scanResult", "decision"]);
const SCAN_RESULT_KEYS = new Set(["privacyPassed", "namespacePassed", "protectedMemoryHit", "externalRecallOnly"]);
const REVIEWER_KEYS = new Set(["actorId", "mode", "reviewedAt"]);
const ROLLBACK_PLAN_KEYS = new Set(["strategy", "targetRecordIds", "checkpointId"]);
const DRY_RUN_KEYS = new Set([
  "schema_version",
  "dryRunId",
  "mode",
  "proposalId",
  "agentId",
  "canonicalAgentId",
  "namespaceScopeId",
  "passportNamespaceId",
  "sourceRunId",
  "evidenceIds",
  "adapterExecutionRequired",
  "engineCanonicalWritePerformed",
  "adapterApiCalled",
  "bridgeAdapterApiCalled",
  "agentPassportApiCalled",
  "ledgerEventCreated",
  "modelCalled",
  "networkCalled",
  "authoritativeStoreMutated",
  "writesProductRepo",
  "rawContentPersisted",
  "preflight",
  "idempotency",
  "checkpoint",
  "plannedAdapterRequest",
  "contextEffects",
  "privacyRollback",
]);
const PREFLIGHT_KEYS = new Set([
  "proposalSchemaVerified",
  "admissionVerified",
  "namespaceVerified",
  "rollbackPlanVerified",
  "redactionVerified",
]);
const IDEMPOTENCY_KEYS = new Set(["idempotencyKey", "dedupeScope"]);
const CHECKPOINT_KEYS = new Set(["checkpointId", "scope", "beforeRefs", "afterRefs"]);
const PLANNED_REQUEST_KEYS = new Set([
  "method",
  "pathTemplate",
  "expectedEventType",
  "wouldCreateRecords",
  "wouldMarkRecordsInactive",
]);
const RECORD_EFFECT_KEYS = new Set([
  "recordId",
  "recordClass",
  "compatibilityRecordType",
  "status",
  "contentSha256",
  "sourceProposalId",
  "evidenceIds",
]);
const CONTEXT_EFFECT_KEYS = new Set([
  "injectRecordIds",
  "denyRecordIds",
  "runtimeSearchRefreshRequired",
  "contextBuilderRefreshRequired",
]);
const PRIVACY_ROLLBACK_KEYS = new Set([
  "sanitizedSummaryOnly",
  "contentHashOnly",
  "rollbackDryRunAvailable",
  "revertedRecordsDeniedFromContext",
]);
const RECOVERY_REPORT_KEYS = new Set([
  "schema_version",
  "reportId",
  "mode",
  "proposalId",
  "agentId",
  "canonicalAgentId",
  "namespaceScopeId",
  "passportNamespaceId",
  "sourceRunId",
  "checkpointId",
  "scannedOperationStates",
  "matchedOperationState",
  "bridgeExecutionRequired",
  "adapterExecutionRequired",
  "adapterApiCalled",
  "bridgeAdapterApiCalled",
  "agentPassportApiCalled",
  "ledgerEventCreated",
  "modelCalled",
  "networkCalled",
  "rawContentPersisted",
  "preflight",
  "checkpoint",
  "detectedState",
  "recoveryPlan",
  "privacy",
]);
const RECOVERY_PREFLIGHT_KEYS = new Set([
  "namespaceVerified",
  "checkpointIntentVerified",
  "idempotencyVerified",
  "operationJournalVerified",
  "redactionVerified",
]);
const RECOVERY_DETECTED_STATE_KEYS = new Set([
  "operationType",
  "writtenRecordIds",
  "contextDenyRecordIds",
  "missingLedgerReceipt",
  "runtimeSearchRefreshRequired",
  "contextBuilderRefreshRequired",
]);
const RECOVERY_PLAN_KEYS = new Set([
  "resumeAction",
  "bridgeRepairRequired",
  "adapterRepairRequired",
  "checkpointRestoreAvailable",
  "quarantineDenyApplied",
  "recoveryScope",
]);
const RECOVERY_PRIVACY_KEYS = new Set([
  "sanitizedSummaryOnly",
  "contentHashOnly",
]);
const TYPE_RULES = {
  memory: { targetLayers: new Set(["working", "episodic", "semantic"]), operations: new Set(["propose_memory"]) },
  profile: { targetLayers: new Set(["profile"]), operations: new Set(["propose_profile_patch"]) },
  skill: { targetLayers: new Set(["skill"]), operations: new Set(["propose_skill_version"]) },
  policy: { targetLayers: new Set(["policy"]), operations: new Set(["propose_policy_change"]) },
};

const TERMINAL_REJECT_STATUSES = new Set(["rejected", "revert_failed", "recovery_required"]);
const REVERT_STATUSES = new Set(["reverting", "reverted", "revert_failed"]);

const DRY_RUN_REQUIRED_FLAGS = Object.freeze([
  ["adapterExecutionRequired", true],
  ["engineCanonicalWritePerformed", false],
  ["adapterApiCalled", false],
  ["ledgerEventCreated", false],
  ["modelCalled", false],
  ["networkCalled", false],
  ["authoritativeStoreMutated", false],
  ["writesProductRepo", false],
  ["rawContentPersisted", false],
]);

const ADAPTER_API_COMPATIBILITY_FLAG_KEYS = Object.freeze(["bridgeAdapterApiCalled", "agentPassportApiCalled"]);
const RECORD_CLASSES = new Set(["memory", "profile_version", "skill_version"]);
const RECORD_CLASS_TO_SCOPE = Object.freeze({
  memory: "memory",
  profile_version: "profile",
  skill_version: "skill",
});
const RECORD_CLASS_TO_COMPATIBILITY_TYPE = Object.freeze({
  memory: "passportMemory",
  profile_version: "profileVersion",
  skill_version: "skillVersion",
});
const COMPATIBILITY_RECORD_TYPE_TO_CLASS = Object.freeze(
  Object.fromEntries(
    Object.entries(RECORD_CLASS_TO_COMPATIBILITY_TYPE).map(([recordClass, compatibilityRecordType]) => [
      compatibilityRecordType,
      recordClass,
    ])
  )
);

const RAW_FIELD_EXCEPTIONS = new Set([
  "content_sha256",
  "contentsha256",
  "contenthash",
  "content_hash",
  "rawcontentpersisted",
  "raw_content_persisted",
]);
const RAW_FIELD_EXACT = new Set([
  "content",
  "full_content",
  "full_prompt",
  "full_chat",
  "message",
  "messages",
  "prompt",
  "raw_content",
  "raw_memory",
  "raw_message",
  "raw_prompt",
  "request_body",
  "response_body",
  "text",
]);

export class MemoryStabilitySelfLearningGovernanceError extends Error {
  constructor(message, { stage = "unknown", cause = null, detail = "" } = {}) {
    super(message);
    this.name = "MemoryStabilitySelfLearningGovernanceError";
    this.code = "MEMORY_STABILITY_SELF_LEARNING_GOVERNANCE_FAILED";
    this.stage = stage;
    this.detail = detail;
    if (cause) this.cause = cause;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, label) {
  assert.equal(isObject(value), true, `${label} must be an object`);
  return value;
}

function requireString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.equal(value.length > 0, true, `${label} must not be empty`);
}

function resolveCanonicalAgentId(value, legacyValue, label) {
  if (value !== undefined) {
    requireString(value, label);
  }
  if (legacyValue !== undefined) {
    requireString(legacyValue, `${label} (legacy agentId)`);
  }
  const canonicalAgentId = typeof value === "string" && value.length > 0 ? value : typeof legacyValue === "string" && legacyValue.length > 0 ? legacyValue : null;
  assert.equal(Boolean(canonicalAgentId), true, `${label} must be present`);
  if (value !== undefined && legacyValue !== undefined) {
    assert.equal(legacyValue, canonicalAgentId, `${label} must match legacy agentId when both are present`);
  }
  return canonicalAgentId;
}

function readPrimaryAgentId(value = null, label = "agentId", { allowCompatOnly = true } = {}) {
  const primary = typeof value?.agentId === "string" && value.agentId.length > 0 ? value.agentId : null;
  const compat = typeof value?.canonicalAgentId === "string" && value.canonicalAgentId.length > 0
    ? value.canonicalAgentId
    : null;
  const agentId = primary ?? compat;
  assert.equal(Boolean(agentId), true, `${label} must be present`);
  if (primary && compat) {
    assert.equal(compat, primary, `${label} must match compatibility canonicalAgentId when both are present`);
  }
  if (allowCompatOnly !== true) {
    assert.notEqual(primary, null, `${label} must be present as the canonical primary field`);
  }
  return agentId;
}

function readNamespaceScopeId(value = null, label = "namespaceScopeId", { allowCompatOnly = true } = {}) {
  const primary = typeof value?.namespaceScopeId === "string" && value.namespaceScopeId.length > 0
    ? value.namespaceScopeId
    : null;
  const compat = typeof value?.passportNamespaceId === "string" && value.passportNamespaceId.length > 0
    ? value.passportNamespaceId
    : null;
  const namespaceScopeId = primary ?? compat;
  assert.equal(Boolean(namespaceScopeId), true, `${label} must be present`);
  if (primary && compat) {
    assert.equal(compat, primary, `${label} must match compatibility passportNamespaceId when both are present`);
  }
  if (allowCompatOnly !== true) {
    assert.notEqual(primary, null, `${label} must be present as the canonical primary field`);
  }
  return namespaceScopeId;
}

function readLooseNamespaceScopeId(value = null) {
  const primary = typeof value?.namespaceScopeId === "string" && value.namespaceScopeId.length > 0
    ? value.namespaceScopeId
    : null;
  const compat = typeof value?.passportNamespaceId === "string" && value.passportNamespaceId.length > 0
    ? value.passportNamespaceId
    : null;
  if (primary && compat && primary !== compat) {
    return null;
  }
  return primary ?? compat ?? null;
}

function requireBoolean(value, label) {
  assert.equal(typeof value, "boolean", `${label} must be boolean`);
}

function requireEnum(value, allowed, label) {
  assert.equal(allowed.has(value), true, `${label} invalid: ${value}`);
}

function requireScore(value, label) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.equal(Number.isFinite(value), true, `${label} must be finite`);
  assert.equal(value >= 0 && value <= 1, true, `${label} must be in [0,1]`);
}

function requireArray(value, label) {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  return value;
}

function requireSha256(value, label) {
  requireString(value, label);
  assert.match(value, /^[a-f0-9]{64}$/u, `${label} must be sha256 hex`);
}

function requireAllowedKeys(value, allowed, label) {
  requireObject(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) && hasRawPayloadField({ [key]: value[key] })) {
      assert.fail(`${label} raw payload fields are not allowed`);
    }
    assert.equal(allowed.has(key), true, `${label} unexpected field: ${key}`);
  }
}

function normalizeKey(key) {
  return String(key).replace(/[-\s]/gu, "_").toLowerCase();
}

function hasRawPayloadField(value) {
  if (Array.isArray(value)) return value.some(hasRawPayloadField);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalized = normalizeKey(key);
    if (RAW_FIELD_EXCEPTIONS.has(normalized)) return hasRawPayloadField(nested);
    return RAW_FIELD_EXACT.has(normalized) || (/raw/u.test(normalized) && /(content|memory|message|prompt|request|response|text)/u.test(normalized)) || hasRawPayloadField(nested);
  });
}

function assertNoRawPayloadFields(value, label) {
  assert.equal(hasRawPayloadField(value), false, `${label} raw payload fields are not allowed`);
}

function hasSensitiveString(value) {
  if (Array.isArray(value)) return value.some(hasSensitiveString);
  if (isObject(value)) return Object.values(value).some(hasSensitiveString);
  if (typeof value !== "string") return false;
  return /\b(?:api[\s_-]?key|secret|password|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{12,})\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\u624b\u673a\u53f7|\u8bc1\u4ef6/iu.test(value);
}

function assertNoSensitiveStrings(value, label) {
  assert.equal(hasSensitiveString(value), false, `${label} sensitive strings are not allowed`);
}

function containsLineBreak(value) {
  if (Array.isArray(value)) return value.some(containsLineBreak);
  if (isObject(value)) return Object.values(value).some(containsLineBreak);
  return typeof value === "string" && /[\r\n]/u.test(value);
}

function uniqueStrings(value, label) {
  const entries = requireArray(value, label);
  for (const entry of entries) requireString(entry, `${label}[]`);
  assert.equal(new Set(entries).size, entries.length, `${label} must not contain duplicates`);
  return entries;
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((entry) => right.includes(entry));
}

function expectedCheckpointScopeForProposal(proposal) {
  if (proposal?.type === "memory") return ["memory", "session"];
  if (proposal?.type === "profile") return ["profile", "session"];
  if (proposal?.type === "skill") return ["skill", "session"];
  return ["session"];
}

function validateCandidate(candidate) {
  requireAllowedKeys(candidate, CANDIDATE_KEYS, "learningProposal.candidate");
  requireEnum(candidate.targetLayer, TARGET_LAYERS, "learningProposal.candidate.targetLayer");
  requireString(candidate.summary, "learningProposal.candidate.summary");
  assert.equal(candidate.summary.length <= 512, true, "learningProposal.candidate.summary must be short");
  requireSha256(candidate.contentSha256, "learningProposal.candidate.contentSha256");
  requireEnum(candidate.evidenceKind, EVIDENCE_KINDS, "learningProposal.candidate.evidenceKind");
  requireEnum(candidate.requestedOperation, REQUESTED_OPERATIONS, "learningProposal.candidate.requestedOperation");
  if (candidate.targetRecordIds !== undefined) uniqueStrings(candidate.targetRecordIds, "learningProposal.candidate.targetRecordIds");
  if (candidate.conflictRecordIds !== undefined) uniqueStrings(candidate.conflictRecordIds, "learningProposal.candidate.conflictRecordIds");
  if (candidate.protectedTarget !== undefined) requireBoolean(candidate.protectedTarget, "learningProposal.candidate.protectedTarget");
}

export function validateLearningProposalSchemaFile(schema) {
  requireObject(schema, "learning proposal schema");
  assert.equal(schema.$id, SELF_LEARNING_PROPOSAL_SCHEMA_ID);
  assert.equal(schema.additionalProperties, false, "learning proposal schema top-level must reject additional properties");
  assert.equal(schema.properties?.schema_version?.const, SELF_LEARNING_PROPOSAL_ENVELOPE_SCHEMA_VERSION);
  assert.equal(schema.properties?.learningProposal?.$ref, "#/$defs/LearningProposal");
  assert.equal(schema.required?.includes("learningProposal"), true, "schema must require single learningProposal object");
  assert.equal(schema.required?.includes("learningProposals"), false, "schema must not use plural learningProposals root");
  const proposalDef = schema.$defs?.LearningProposal;
  assert.equal(proposalDef?.additionalProperties, false, "schema LearningProposal must reject additional properties");
  assert.equal(proposalDef?.required?.includes("agentId"), true, "schema must require agentId");
  assert.equal(proposalDef?.required?.includes("namespaceScopeId"), true, "schema must require namespaceScopeId");
  assert.equal(proposalDef?.required?.includes("passportNamespaceId"), false, "schema must not require compatibility namespace field");
  assert.equal(proposalDef?.properties?.candidate?.additionalProperties, false, "schema candidate must reject additional properties");
  assert.equal(proposalDef?.properties?.admission?.additionalProperties, false, "schema admission must reject additional properties");
  assert.equal(proposalDef?.properties?.rollbackPlan?.additionalProperties, false, "schema rollbackPlan must reject additional properties");
  return schema;
}

export function validateSelfLearningDryRunSchemaFile(schema) {
  requireObject(schema, "self-learning dry-run schema");
  assert.equal(schema.$id, SELF_LEARNING_DRY_RUN_SCHEMA_ID);
  assert.equal(schema.additionalProperties, false, "dry-run schema top-level must reject additional properties");
  assert.equal(schema.properties?.schema_version?.const, SELF_LEARNING_DRY_RUN_SCHEMA_VERSION);
  assert.equal(schema.required?.includes("agentId"), true, "dry-run schema must require agentId");
  assert.equal(schema.required?.includes("namespaceScopeId"), true, "dry-run schema must require namespaceScopeId");
  assert.equal(schema.required?.includes("passportNamespaceId"), false, "dry-run schema must not require compatibility namespace field");
  assert.equal(schema.required?.includes("adapterApiCalled"), true, "dry-run schema must require adapterApiCalled");
  assert.equal(schema.required?.includes("bridgeAdapterApiCalled"), false, "dry-run schema must not require compatibility adapter flag");
  for (const [field, expected] of DRY_RUN_REQUIRED_FLAGS) {
    assert.equal(schema.properties?.[field]?.const, expected, `dry-run schema must force ${field}=${expected}`);
  }
  assert.deepEqual(
    schema.$defs?.RecordEffect?.required,
    ["recordId", "recordClass", "status", "contentSha256", "sourceProposalId", "evidenceIds"],
    "record effect must use recordClass as the primary field"
  );
  assert.equal(schema.$defs?.PlannedAdapterRequest?.additionalProperties, false, "planned adapter request must reject additional properties");
  assert.equal(schema.$defs?.ContextEffects?.additionalProperties, false, "context effects must reject additional properties");
  assert.equal(schema.$defs?.PrivacyRollback?.additionalProperties, false, "privacy rollback must reject additional properties");
  return schema;
}

export function validateSelfLearningRecoveryReportSchemaFile(schema) {
  requireObject(schema, "self-learning recovery report schema");
  assert.equal(schema.$id, SELF_LEARNING_RECOVERY_REPORT_SCHEMA_ID);
  assert.equal(schema.additionalProperties, false, "recovery report schema top-level must reject additional properties");
  assert.equal(schema.properties?.schema_version?.const, SELF_LEARNING_RECOVERY_REPORT_SCHEMA_VERSION);
  assert.equal(schema.properties?.mode?.const, "recovery_rehearsal", "recovery report schema must force recovery_rehearsal mode");
  assert.equal(schema.required?.includes("agentId"), true, "recovery report schema must require agentId");
  assert.equal(schema.required?.includes("namespaceScopeId"), true, "recovery report schema must require namespaceScopeId");
  assert.equal(schema.required?.includes("passportNamespaceId"), false, "recovery report schema must not require compatibility namespace field");
  for (const [field, expected] of [
    ["bridgeExecutionRequired", true],
    ["adapterApiCalled", false],
    ["ledgerEventCreated", false],
    ["modelCalled", false],
    ["networkCalled", false],
    ["rawContentPersisted", false],
  ]) {
    assert.equal(schema.properties?.[field]?.const, expected, `recovery report schema must force ${field}=${expected}`);
  }
  assert.deepEqual(
    schema.properties?.matchedOperationState?.enum,
    [...RECOVERY_MATCHED_OPERATION_STATES],
    "recovery report schema matchedOperationState enum mismatch"
  );
  assert.deepEqual(
    schema.properties?.scannedOperationStates?.items?.enum,
    [...RECOVERY_SCAN_OPERATION_STATES],
    "recovery report schema scannedOperationStates enum mismatch"
  );
  assert.equal(schema.properties?.scannedOperationStates?.uniqueItems, true, "recovery report schema scannedOperationStates must reject duplicates");
  assert.equal(schema.properties?.checkpoint?.additionalProperties, false, "recovery report checkpoint must reject additional properties");
  assert.equal(schema.properties?.detectedState?.additionalProperties, false, "recovery report detectedState must reject additional properties");
  assert.equal(schema.properties?.recoveryPlan?.additionalProperties, false, "recovery report recoveryPlan must reject additional properties");
  assert.equal(schema.properties?.privacy?.additionalProperties, false, "recovery report privacy must reject additional properties");
  return schema;
}

export function validateLearningProposalEnvelope(envelope) {
  requireAllowedKeys(envelope, ENVELOPE_KEYS, "envelope");
  assert.equal(envelope.schema_version, SELF_LEARNING_PROPOSAL_ENVELOPE_SCHEMA_VERSION, "envelope.schema_version mismatch");
  assert.equal(Object.hasOwn(envelope, "learningProposals"), false, "envelope must not contain plural learningProposals");
  const proposal = requireObject(envelope.learningProposal, "learningProposal");
  requireAllowedKeys(proposal, PROPOSAL_KEYS, "learningProposal");
  requireString(proposal.proposalId, "learningProposal.proposalId");
  assert.match(proposal.proposalId, /^lp-[A-Za-z0-9._-]+$/u, "learningProposal.proposalId must start with lp-");
  const agentId = readPrimaryAgentId(proposal, "learningProposal.agentId");
  const namespaceScopeId = readNamespaceScopeId(proposal, "learningProposal.namespaceScopeId");
  requireEnum(proposal.type, PROPOSAL_TYPES, "learningProposal.type");
  requireString(proposal.sourceSessionId, "learningProposal.sourceSessionId");
  requireString(proposal.sourceRunId, "learningProposal.sourceRunId");
  requireString(proposal.sourceWindowId, "learningProposal.sourceWindowId");
  uniqueStrings(proposal.evidenceIds, "learningProposal.evidenceIds");
  validateCandidate(proposal.candidate);
  requireString(proposal.rationale, "learningProposal.rationale");
  assert.equal(proposal.rationale.length <= 512, true, "learningProposal.rationale must be short");
  requireEnum(proposal.sourceType, SOURCE_TYPES, "learningProposal.sourceType");
  requireEnum(proposal.epistemicStatus, EPISTEMIC_STATUSES, "learningProposal.epistemicStatus");
  requireScore(proposal.confidence, "learningProposal.confidence");
  requireScore(proposal.salience, "learningProposal.salience");
  requireEnum(proposal.riskLevel, RISK_LEVELS, "learningProposal.riskLevel");
  requireEnum(proposal.status, STATUSES, "learningProposal.status");

  requireAllowedKeys(proposal.admission, ADMISSION_KEYS, "learningProposal.admission");
  if (proposal.admission.duplicateOf !== null) requireString(proposal.admission.duplicateOf, "learningProposal.admission.duplicateOf");
  uniqueStrings(proposal.admission.conflicts, "learningProposal.admission.conflicts");
  requireAllowedKeys(proposal.admission.scanResult, SCAN_RESULT_KEYS, "learningProposal.admission.scanResult");
  for (const field of SCAN_RESULT_KEYS) requireBoolean(proposal.admission.scanResult[field], `learningProposal.admission.scanResult.${field}`);
  requireEnum(proposal.admission.decision, ADMISSION_DECISIONS, "learningProposal.admission.decision");

  requireAllowedKeys(proposal.rollbackPlan, ROLLBACK_PLAN_KEYS, "learningProposal.rollbackPlan");
  requireEnum(proposal.rollbackPlan.strategy, ROLLBACK_STRATEGIES, "learningProposal.rollbackPlan.strategy");
  uniqueStrings(proposal.rollbackPlan.targetRecordIds, "learningProposal.rollbackPlan.targetRecordIds");
  if (proposal.rollbackPlan.checkpointId !== null) requireString(proposal.rollbackPlan.checkpointId, "learningProposal.rollbackPlan.checkpointId");

  if (proposal.reviewer !== undefined) {
    requireAllowedKeys(proposal.reviewer, REVIEWER_KEYS, "learningProposal.reviewer");
    requireString(proposal.reviewer.actorId, "learningProposal.reviewer.actorId");
    requireEnum(proposal.reviewer.mode, REVIEW_MODES, "learningProposal.reviewer.mode");
  }
  if (proposal.appliedRecordIds !== undefined) uniqueStrings(proposal.appliedRecordIds, "learningProposal.appliedRecordIds");
  if (proposal.createdAt !== undefined) requireString(proposal.createdAt, "learningProposal.createdAt");
  if (proposal.appliedAt !== undefined) requireString(proposal.appliedAt, "learningProposal.appliedAt");
  if (proposal.revertedAt !== undefined) requireString(proposal.revertedAt, "learningProposal.revertedAt");
  return {
    ...proposal,
    agentId,
    canonicalAgentId: typeof proposal.canonicalAgentId === "string" && proposal.canonicalAgentId.length > 0
      ? proposal.canonicalAgentId
      : agentId,
    namespaceScopeId,
    passportNamespaceId:
      typeof proposal.passportNamespaceId === "string" && proposal.passportNamespaceId.length > 0
        ? proposal.passportNamespaceId
        : namespaceScopeId,
  };
}

function collectLearningProposalStateMachineReasons(proposal) {
  const reasons = [];
  const appliedRecordIds = Array.isArray(proposal.appliedRecordIds) ? proposal.appliedRecordIds : [];
  const hasAppliedRecords = appliedRecordIds.length > 0;
  const hasAppliedAt = typeof proposal.appliedAt === "string" && proposal.appliedAt.length > 0;
  const hasRevertedAt = typeof proposal.revertedAt === "string" && proposal.revertedAt.length > 0;

  if (proposal.status === "draft" && proposal.admission.decision !== "draft") {
    reasons.push("draft proposals must keep admission.decision=draft until an admission controller evaluates them");
  }
  if (proposal.admission.decision === "rejected" && proposal.status !== "rejected") {
    reasons.push("rejected admission decisions must use status=rejected");
  }
  if (proposal.admission.decision === "quarantined" && !["quarantined", "rejected", "recovery_required"].includes(proposal.status)) {
    reasons.push("quarantined admission decisions must not advance to apply-capable statuses");
  }
  if (["draft", "quarantined", "pending_review", "approved", "rejected"].includes(proposal.status)) {
    if (hasAppliedAt || hasRevertedAt) reasons.push(`${proposal.status} proposals must not contain appliedAt or revertedAt`);
  }
  if (["draft", "quarantined", "pending_review", "rejected"].includes(proposal.status) && hasAppliedRecords) {
    reasons.push(`${proposal.status} proposals must not contain appliedRecordIds`);
  }
  if (["applying", "applied"].includes(proposal.status)) {
    if (!hasAppliedRecords) reasons.push(`${proposal.status} proposals must bind appliedRecordIds`);
    if (proposal.status === "applied" && !hasAppliedAt) reasons.push("applied proposals must bind appliedAt");
  }
  if (REVERT_STATUSES.has(proposal.status)) {
    if (!hasAppliedRecords) reasons.push(`${proposal.status} proposals must bind appliedRecordIds before revert`);
    if (proposal.status === "reverted" && !hasRevertedAt) reasons.push("reverted proposals must bind revertedAt");
  }
  if (TERMINAL_REJECT_STATUSES.has(proposal.status) && proposal.admission.decision === "approved_auto") {
    reasons.push(`${proposal.status} proposals must not keep admission.decision=approved_auto`);
  }
  return reasons;
}

function makeAdmissionResult(decision, reasons, proposal, extra = {}) {
  return {
    decision,
    reasons,
    requiredReviewMode:
      ["high", "critical"].includes(proposal.riskLevel) || proposal.type !== "memory" ? "human_or_multisig" : "auto_allowed",
    normalizedEpistemicStatus:
      proposal.candidate.evidenceKind === "external_recall" && proposal.epistemicStatus === "verified"
        ? "candidate"
        : proposal.epistemicStatus,
    duplicateOf: extra.duplicateOf || null,
    conflicts: extra.conflicts || [],
    contextInjectionAllowed: decision === "approved_auto" && proposal.type === "memory",
  };
}

export function evaluateLearningProposalEnvelope(envelope, context = {}) {
  const proposal = validateLearningProposalEnvelope(envelope);
  const reasons = [];
  const evidenceRefs = Array.isArray(context.evidenceRefs) ? context.evidenceRefs : [];
  const activeRecords = Array.isArray(context.activeRecords) ? context.activeRecords : [];
  const protectedRecordIds = new Set(context.protectedRecordIds || []);
  const evidenceRefById = new Map(evidenceRefs.map((entry) => [entry?.evidenceId, entry]));
  const typeRule = TYPE_RULES[proposal.type];

  if (hasRawPayloadField(proposal)) reasons.push("raw payload fields are not allowed in learning proposals");
  if (hasSensitiveString(proposal)) reasons.push("sensitive strings are not allowed in learning proposals");
  if (containsLineBreak(proposal.candidate.summary) || containsLineBreak(proposal.rationale)) {
    reasons.push("proposal free text must be single-line sanitized summaries");
  }
  if (proposal.evidenceIds.length === 0) reasons.push("evidenceIds must not be empty");
  for (const evidenceId of proposal.evidenceIds) {
    const evidenceRef = evidenceRefById.get(evidenceId);
    if (!evidenceRef) {
      reasons.push("evidenceRefs must resolve every evidenceId before admission");
      continue;
    }
    if (
      readPrimaryAgentId(evidenceRef, "evidenceRefs[].agentId") !== proposal.agentId ||
      readLooseNamespaceScopeId(evidenceRef) !== proposal.namespaceScopeId
    ) {
      reasons.push("evidence namespace must match proposal agentId and namespaceScopeId");
    }
  }
  if (!typeRule?.targetLayers.has(proposal.candidate.targetLayer) || !typeRule?.operations.has(proposal.candidate.requestedOperation)) {
    reasons.push("proposal type, targetLayer and requestedOperation must match one governance lane");
  }
  if (proposal.candidate.evidenceKind === "external_recall" && proposal.epistemicStatus === "verified") {
    reasons.push("external recall evidence cannot be marked verified or canonical");
  }
  const scanResult = proposal.admission.scanResult;
  if (scanResult.privacyPassed !== true) reasons.push("admission scanResult.privacyPassed must be true before admission");
  if (scanResult.namespacePassed !== true) reasons.push("admission scanResult.namespacePassed must be true before admission");
  if (scanResult.externalRecallOnly === true && proposal.epistemicStatus === "verified") {
    reasons.push("external recall evidence cannot be marked verified or canonical");
  }
  if (["direct_canonical_write", "activate_profile", "activate_skill"].includes(proposal.candidate.requestedOperation)) {
    reasons.push("learning proposals cannot request direct canonical writes or direct activation");
  }
  reasons.push(...collectLearningProposalStateMachineReasons(proposal));
  if (APPLY_STATUSES.has(proposal.status) && !proposal.rollbackPlan.checkpointId) {
    reasons.push("apply-capable proposals must bind a checkpointId before apply");
  }
  if (["high", "critical"].includes(proposal.riskLevel) && proposal.reviewer?.mode === "auto" && APPLY_STATUSES.has(proposal.status)) {
    reasons.push("high or critical proposals cannot be auto-approved or auto-applied");
  }
  if (proposal.type !== "memory" && proposal.reviewer?.mode === "auto" && APPLY_STATUSES.has(proposal.status)) {
    reasons.push("profile, skill and policy proposals cannot use pure auto approval");
  }
  if (reasons.length) return makeAdmissionResult("rejected", reasons, proposal);

  const targetRecordIds = proposal.candidate.targetRecordIds || [];
  if (proposal.candidate.protectedTarget || proposal.admission.scanResult.protectedMemoryHit || targetRecordIds.some((id) => protectedRecordIds.has(id))) {
    return makeAdmissionResult("quarantined", ["candidate touches protected memory or protected state"], proposal, {
      conflicts: targetRecordIds,
    });
  }
  if ((proposal.candidate.conflictRecordIds || []).length > 0) {
    return makeAdmissionResult("quarantined", ["candidate conflicts with active or pending state"], proposal, {
      conflicts: proposal.candidate.conflictRecordIds,
    });
  }
  const duplicate = activeRecords.find(
    (record) =>
      readPrimaryAgentId(record, "activeRecords[].agentId") === proposal.agentId &&
      readLooseNamespaceScopeId(record) === proposal.namespaceScopeId &&
      record?.status === "active" &&
      record?.contentSha256 === proposal.candidate.contentSha256
  );
  if (duplicate) return makeAdmissionResult("rejected", ["duplicate active memory candidate"], proposal, { duplicateOf: duplicate.recordId });
  if (proposal.type !== "memory") {
    return makeAdmissionResult("pending_review", ["profile, skill and policy proposals require review and versioning"], proposal);
  }
  if (["high", "critical"].includes(proposal.riskLevel) || proposal.confidence < 0.8 || proposal.salience < 0.6) {
    return makeAdmissionResult(
      "pending_review",
      ["memory proposal requires review because risk, confidence or salience is outside auto-admission bounds"],
      proposal
    );
  }
  return makeAdmissionResult("approved_auto", ["low-risk memory proposal passed admission gates"], proposal);
}

export function contextBuilderCanInjectLearningRecord(record, scope) {
  if (!record || !scope) return false;
  if (
    readPrimaryAgentId(record, "record.agentId") !== readPrimaryAgentId(scope, "scope.agentId") ||
    readLooseNamespaceScopeId(record) !== readLooseNamespaceScopeId(scope)
  ) return false;
  if (!CONTEXT_INJECTABLE_STATUSES.has(record.status)) return false;
  if (record.revertedAt || record.quarantinedAt || record.deniedAt) return false;
  if (record.epistemicStatus === "candidate" && record.sourceType === "external_recall") return false;
  return true;
}

function validateRecordEffect(record, index, label, proposal) {
  requireAllowedKeys(record, RECORD_EFFECT_KEYS, `${label}[${index}]`);
  requireString(record.recordId, `${label}[${index}].recordId`);
  requireEnum(record.recordClass, RECORD_CLASSES, `${label}[${index}].recordClass`);
  if (record.compatibilityRecordType !== undefined) {
    requireString(record.compatibilityRecordType, `${label}[${index}].compatibilityRecordType`);
    assert.equal(
      COMPATIBILITY_RECORD_TYPE_TO_CLASS[record.compatibilityRecordType],
      record.recordClass,
      `${label}[${index}].compatibilityRecordType must mirror recordClass`
    );
  }
  requireString(record.status, `${label}[${index}].status`);
  requireSha256(record.contentSha256, `${label}[${index}].contentSha256`);
  assert.equal(record.contentSha256, proposal.candidate.contentSha256, `${label}[${index}].contentSha256 must match proposal candidate`);
  assert.equal(record.sourceProposalId, proposal.proposalId, `${label}[${index}].sourceProposalId must match proposalId`);
  assert.deepEqual(record.evidenceIds, proposal.evidenceIds, `${label}[${index}].evidenceIds must match proposal evidenceIds`);
}

function validateDryRunCommon(dryRun, proposal, expectedMode) {
  requireAllowedKeys(dryRun, DRY_RUN_KEYS, `${expectedMode}DryRun`);
  assertNoRawPayloadFields(dryRun, `${expectedMode}DryRun`);
  assertNoSensitiveStrings(dryRun, `${expectedMode}DryRun`);
  assert.equal(dryRun.schema_version, SELF_LEARNING_DRY_RUN_SCHEMA_VERSION, `${expectedMode} dry-run schema_version mismatch`);
  requireEnum(dryRun.mode, DRY_RUN_MODES, `${expectedMode}DryRun.mode`);
  assert.equal(dryRun.mode, expectedMode, `${expectedMode} dry-run mode mismatch`);
  assert.equal(dryRun.proposalId, proposal.proposalId, `${expectedMode} dry-run proposalId mismatch`);
  const dryRunAgentId = readPrimaryAgentId(dryRun, `${expectedMode}DryRun.agentId`);
  assert.equal(dryRunAgentId, proposal.agentId, `${expectedMode} dry-run agentId mismatch`);
  const dryRunNamespaceScopeId = readNamespaceScopeId(dryRun, `${expectedMode}DryRun.namespaceScopeId`);
  assert.equal(dryRunNamespaceScopeId, proposal.namespaceScopeId, `${expectedMode} dry-run namespace mismatch`);
  assert.equal(dryRun.sourceRunId, proposal.sourceRunId, `${expectedMode} dry-run sourceRunId mismatch`);
  assert.deepEqual(dryRun.evidenceIds, proposal.evidenceIds, `${expectedMode} dry-run evidenceIds mismatch`);
  for (const [key, expected] of DRY_RUN_REQUIRED_FLAGS) {
    assert.equal(dryRun[key], expected, `${expectedMode} dry-run ${key} expected ${expected}`);
  }
  for (const compatibilityKey of ADAPTER_API_COMPATIBILITY_FLAG_KEYS) {
    if (Object.hasOwn(dryRun, compatibilityKey)) {
      assert.equal(
        dryRun[compatibilityKey],
        dryRun.adapterApiCalled,
        `${expectedMode} dry-run ${compatibilityKey} must mirror adapterApiCalled when present`
      );
    }
  }

  requireAllowedKeys(dryRun.preflight, PREFLIGHT_KEYS, `${expectedMode}DryRun.preflight`);
  for (const key of PREFLIGHT_KEYS) assert.equal(dryRun.preflight[key], true, `${expectedMode} dry-run preflight.${key} must be true`);

  requireAllowedKeys(dryRun.idempotency, IDEMPOTENCY_KEYS, `${expectedMode}DryRun.idempotency`);
  requireString(dryRun.idempotency.idempotencyKey, `${expectedMode}DryRun.idempotency.idempotencyKey`);
  assert.equal(
    dryRun.idempotency.idempotencyKey.includes(proposal.proposalId),
    true,
    `${expectedMode} dry-run idempotencyKey must bind proposalId`
  );
  assert.equal(
    dryRun.idempotency.idempotencyKey.includes(proposal.rollbackPlan.checkpointId),
    true,
    `${expectedMode} dry-run idempotencyKey must bind checkpointId`
  );
  assert.equal(dryRun.idempotency.dedupeScope, "proposal-checkpoint-targets", `${expectedMode} dry-run idempotency scope mismatch`);

  requireAllowedKeys(dryRun.checkpoint, CHECKPOINT_KEYS, `${expectedMode}DryRun.checkpoint`);
  assert.equal(dryRun.checkpoint.checkpointId, proposal.rollbackPlan.checkpointId, `${expectedMode} dry-run checkpoint must match proposal rollback plan`);
  for (const entry of requireArray(dryRun.checkpoint.scope, `${expectedMode}DryRun.checkpoint.scope`)) {
    requireEnum(entry, DRY_RUN_SCOPE_VALUES, `${expectedMode}DryRun.checkpoint.scope[]`);
  }
  const checkpointScope = uniqueStrings(dryRun.checkpoint.scope, `${expectedMode}DryRun.checkpoint.scope`);
  uniqueStrings(dryRun.checkpoint.beforeRefs, `${expectedMode}DryRun.checkpoint.beforeRefs`);
  uniqueStrings(dryRun.checkpoint.afterRefs, `${expectedMode}DryRun.checkpoint.afterRefs`);

  requireAllowedKeys(dryRun.plannedAdapterRequest, PLANNED_REQUEST_KEYS, `${expectedMode}DryRun.plannedAdapterRequest`);
  assert.equal(dryRun.plannedAdapterRequest.method, "POST", `${expectedMode} dry-run method mismatch`);
  const wouldCreateRecords = requireArray(
    dryRun.plannedAdapterRequest.wouldCreateRecords,
    `${expectedMode}DryRun.plannedAdapterRequest.wouldCreateRecords`
  );
  wouldCreateRecords.forEach((record, index) =>
    validateRecordEffect(record, index, `${expectedMode}DryRun.plannedAdapterRequest.wouldCreateRecords`, proposal)
  );
  const wouldMarkRecordsInactive = requireArray(
    dryRun.plannedAdapterRequest.wouldMarkRecordsInactive,
    `${expectedMode}DryRun.plannedAdapterRequest.wouldMarkRecordsInactive`
  );
  wouldMarkRecordsInactive.forEach((record, index) =>
    validateRecordEffect(record, index, `${expectedMode}DryRun.plannedAdapterRequest.wouldMarkRecordsInactive`, proposal)
  );
  const expectedCheckpointScope = expectedCheckpointScopeForProposal(proposal);
  assert.equal(
    sameStringSet(checkpointScope, expectedCheckpointScope),
    true,
    `${expectedMode}DryRun.checkpoint.scope must cover ${expectedCheckpointScope.join("/")}`
  );
  const previewedRecords = expectedMode === "apply" ? wouldCreateRecords : wouldMarkRecordsInactive;
  for (const record of previewedRecords) {
    const expectedScope = RECORD_CLASS_TO_SCOPE[record.recordClass];
    assert.equal(Boolean(expectedScope), true, `${expectedMode} dry-run has unsupported recordClass: ${record.recordClass}`);
    assert.equal(
      checkpointScope.includes(expectedScope),
      true,
      `${expectedMode}DryRun.checkpoint.scope must include ${expectedScope}`
    );
    assert.equal(
      dryRun.idempotency.idempotencyKey.includes(record.recordId),
      true,
      `${expectedMode} dry-run idempotencyKey must bind target record ${record.recordId}`
    );
  }

  requireAllowedKeys(dryRun.contextEffects, CONTEXT_EFFECT_KEYS, `${expectedMode}DryRun.contextEffects`);
  uniqueStrings(dryRun.contextEffects.injectRecordIds, `${expectedMode}DryRun.contextEffects.injectRecordIds`);
  uniqueStrings(dryRun.contextEffects.denyRecordIds, `${expectedMode}DryRun.contextEffects.denyRecordIds`);
  assert.equal(dryRun.contextEffects.runtimeSearchRefreshRequired, true, `${expectedMode} dry-run must refresh runtime search`);
  assert.equal(dryRun.contextEffects.contextBuilderRefreshRequired, true, `${expectedMode} dry-run must refresh context builder`);

  requireAllowedKeys(dryRun.privacyRollback, PRIVACY_ROLLBACK_KEYS, `${expectedMode}DryRun.privacyRollback`);
  assert.equal(dryRun.privacyRollback.sanitizedSummaryOnly, true, `${expectedMode} dry-run must use sanitized summaries only`);
  assert.equal(dryRun.privacyRollback.contentHashOnly, true, `${expectedMode} dry-run must use hash-only content refs`);
  assert.equal(dryRun.privacyRollback.rollbackDryRunAvailable, true, `${expectedMode} dry-run must keep rollback dry-run available`);
  requireBoolean(dryRun.privacyRollback.revertedRecordsDeniedFromContext, `${expectedMode}DryRun.privacyRollback.revertedRecordsDeniedFromContext`);
}

export function validateSelfLearningApplyDryRun(dryRun, proposal) {
  validateDryRunCommon(dryRun, proposal, "apply");
  const targetRecordIds = proposal.candidate.targetRecordIds || [];
  assert.equal(dryRun.plannedAdapterRequest.pathTemplate, "/api/agents/:agentId/learning/proposals/:proposalId/apply", "apply dry-run path mismatch");
  assert.equal(dryRun.plannedAdapterRequest.expectedEventType, "learning_proposal_apply_requested", "apply dry-run event type mismatch");
  assert.equal(dryRun.plannedAdapterRequest.wouldCreateRecords.length > 0, true, "apply dry-run must preview created records");
  assert.deepEqual(dryRun.plannedAdapterRequest.wouldMarkRecordsInactive, [], "apply dry-run must not preview inactive records");
  for (const targetId of targetRecordIds) {
    assert.equal(
      dryRun.plannedAdapterRequest.wouldCreateRecords.some((record) => record.recordId === targetId),
      true,
      "apply dry-run must preview proposal target record"
    );
    assert.equal(dryRun.contextEffects.injectRecordIds.includes(targetId), true, "apply dry-run must preview context injection target");
  }
  assert.deepEqual(dryRun.contextEffects.denyRecordIds, [], "apply dry-run must not deny records");
  assert.equal(dryRun.privacyRollback.revertedRecordsDeniedFromContext, false, "apply dry-run must not claim reverted records were denied");
  return dryRun;
}

export function validateSelfLearningRevertDryRun(dryRun, proposal) {
  validateDryRunCommon(dryRun, proposal, "revert");
  const targetRecordIds = proposal.candidate.targetRecordIds || [];
  assert.equal(dryRun.plannedAdapterRequest.pathTemplate, "/api/agents/:agentId/learning/proposals/:proposalId/revert", "revert dry-run path mismatch");
  assert.equal(dryRun.plannedAdapterRequest.expectedEventType, "learning_proposal_revert_requested", "revert dry-run event type mismatch");
  assert.equal(dryRun.plannedAdapterRequest.wouldMarkRecordsInactive.length > 0, true, "revert dry-run must preview inactive records");
  assert.deepEqual(dryRun.plannedAdapterRequest.wouldCreateRecords, [], "revert dry-run must not preview created records");
  for (const targetId of targetRecordIds) {
    assert.equal(
      dryRun.plannedAdapterRequest.wouldMarkRecordsInactive.some((record) => record.recordId === targetId),
      true,
      "revert dry-run must preview proposal target record"
    );
    assert.equal(dryRun.contextEffects.denyRecordIds.includes(targetId), true, "revert dry-run must deny reverted record from context");
  }
  assert.deepEqual(dryRun.contextEffects.injectRecordIds, [], "revert dry-run must not inject records");
  assert.equal(dryRun.privacyRollback.revertedRecordsDeniedFromContext, true, "revert dry-run must prove reverted records are denied");
  return dryRun;
}

export function validateSelfLearningRecoveryReport(recoveryReport, proposal) {
  requireAllowedKeys(recoveryReport, RECOVERY_REPORT_KEYS, "recoveryReport");
  assertNoRawPayloadFields(recoveryReport, "recoveryReport");
  assertNoSensitiveStrings(recoveryReport, "recoveryReport");
  assert.equal(
    recoveryReport.schema_version,
    SELF_LEARNING_RECOVERY_REPORT_SCHEMA_VERSION,
    "recoveryReport schema_version mismatch"
  );
  assert.equal(recoveryReport.mode, "recovery_rehearsal", "recoveryReport mode mismatch");
  requireString(recoveryReport.reportId, "recoveryReport.reportId");
  assert.equal(recoveryReport.proposalId, proposal.proposalId, "recoveryReport proposalId mismatch");
  const recoveryCanonicalAgentId = resolveCanonicalAgentId(
    recoveryReport.canonicalAgentId,
    recoveryReport.agentId,
    "recoveryReport.agentId"
  );
  assert.equal(recoveryCanonicalAgentId, proposal.agentId, "recoveryReport agentId mismatch");
  const recoveryNamespaceScopeId = readNamespaceScopeId(recoveryReport, "recoveryReport.namespaceScopeId");
  assert.equal(recoveryNamespaceScopeId, proposal.namespaceScopeId, "recoveryReport namespaceScopeId mismatch");
  assert.equal(recoveryReport.sourceRunId, proposal.sourceRunId, "recoveryReport sourceRunId mismatch");
  assert.equal(recoveryReport.checkpointId, proposal.rollbackPlan.checkpointId, "recoveryReport checkpointId mismatch");
  assert.equal(recoveryReport.bridgeExecutionRequired, true, "recoveryReport must require bridge execution");
  if (Object.hasOwn(recoveryReport, "adapterExecutionRequired")) {
    assert.equal(
      recoveryReport.adapterExecutionRequired,
      recoveryReport.bridgeExecutionRequired,
      "recoveryReport adapterExecutionRequired must mirror bridgeExecutionRequired when present"
    );
  }
  assert.equal(recoveryReport.adapterApiCalled, false, "recoveryReport must not call bridge adapter");
  for (const compatibilityKey of ADAPTER_API_COMPATIBILITY_FLAG_KEYS) {
    if (Object.hasOwn(recoveryReport, compatibilityKey)) {
      assert.equal(
        recoveryReport[compatibilityKey],
        recoveryReport.adapterApiCalled,
        `recoveryReport ${compatibilityKey} must mirror adapterApiCalled when present`
      );
    }
  }
  assert.equal(recoveryReport.ledgerEventCreated, false, "recoveryReport must not create ledger events");
  assert.equal(recoveryReport.modelCalled, false, "recoveryReport must not call models");
  assert.equal(recoveryReport.networkCalled, false, "recoveryReport must not call network");
  assert.equal(recoveryReport.rawContentPersisted, false, "recoveryReport must not persist raw content");

  const scannedOperationStates = uniqueStrings(recoveryReport.scannedOperationStates, "recoveryReport.scannedOperationStates");
  assert.deepEqual(
    scannedOperationStates,
    [...RECOVERY_SCAN_OPERATION_STATES],
    "recoveryReport scannedOperationStates mismatch"
  );
  requireEnum(
    recoveryReport.matchedOperationState,
    RECOVERY_MATCHED_OPERATION_STATES,
    "recoveryReport.matchedOperationState"
  );

  requireAllowedKeys(recoveryReport.preflight, RECOVERY_PREFLIGHT_KEYS, "recoveryReport.preflight");
  for (const key of RECOVERY_PREFLIGHT_KEYS) {
    assert.equal(recoveryReport.preflight[key], true, `recoveryReport.preflight.${key} must be true`);
  }

  requireAllowedKeys(recoveryReport.checkpoint, CHECKPOINT_KEYS, "recoveryReport.checkpoint");
  assert.equal(
    recoveryReport.checkpoint.checkpointId,
    proposal.rollbackPlan.checkpointId,
    "recoveryReport.checkpoint.checkpointId must match proposal rollback plan"
  );
  const checkpointScope = uniqueStrings(recoveryReport.checkpoint.scope, "recoveryReport.checkpoint.scope");
  for (const entry of checkpointScope) {
    requireEnum(entry, DRY_RUN_SCOPE_VALUES, "recoveryReport.checkpoint.scope[]");
  }
  const expectedRecoveryScope = expectedCheckpointScopeForProposal(proposal);
  assert.equal(
    sameStringSet(checkpointScope, expectedRecoveryScope),
    true,
    `recoveryReport.checkpoint.scope must cover ${expectedRecoveryScope.join("/")}`
  );
  uniqueStrings(recoveryReport.checkpoint.beforeRefs, "recoveryReport.checkpoint.beforeRefs");
  uniqueStrings(recoveryReport.checkpoint.afterRefs, "recoveryReport.checkpoint.afterRefs");

  requireAllowedKeys(recoveryReport.detectedState, RECOVERY_DETECTED_STATE_KEYS, "recoveryReport.detectedState");
  requireEnum(recoveryReport.detectedState.operationType, DRY_RUN_MODES, "recoveryReport.detectedState.operationType");
  const writtenRecordIds = uniqueStrings(recoveryReport.detectedState.writtenRecordIds, "recoveryReport.detectedState.writtenRecordIds");
  const contextDenyRecordIds = uniqueStrings(
    recoveryReport.detectedState.contextDenyRecordIds,
    "recoveryReport.detectedState.contextDenyRecordIds"
  );
  assert.equal(
    recoveryReport.detectedState.missingLedgerReceipt,
    true,
    "recoveryReport.detectedState.missingLedgerReceipt must be true"
  );
  assert.equal(
    recoveryReport.detectedState.runtimeSearchRefreshRequired,
    true,
    "recoveryReport.detectedState.runtimeSearchRefreshRequired must be true"
  );
  assert.equal(
    recoveryReport.detectedState.contextBuilderRefreshRequired,
    true,
    "recoveryReport.detectedState.contextBuilderRefreshRequired must be true"
  );

  requireAllowedKeys(recoveryReport.recoveryPlan, RECOVERY_PLAN_KEYS, "recoveryReport.recoveryPlan");
  requireEnum(recoveryReport.recoveryPlan.resumeAction, RECOVERY_RESUME_ACTIONS, "recoveryReport.recoveryPlan.resumeAction");
  requireBoolean(recoveryReport.recoveryPlan.bridgeRepairRequired, "recoveryReport.recoveryPlan.bridgeRepairRequired");
  if (Object.hasOwn(recoveryReport.recoveryPlan, "adapterRepairRequired")) {
    assert.equal(
      recoveryReport.recoveryPlan.adapterRepairRequired,
      recoveryReport.recoveryPlan.bridgeRepairRequired,
      "recoveryReport.recoveryPlan.adapterRepairRequired must mirror bridgeRepairRequired when present"
    );
  }
  assert.equal(
    recoveryReport.recoveryPlan.checkpointRestoreAvailable,
    true,
    "recoveryReport.recoveryPlan.checkpointRestoreAvailable must be true"
  );
  assert.equal(
    recoveryReport.recoveryPlan.quarantineDenyApplied,
    true,
    "recoveryReport.recoveryPlan.quarantineDenyApplied must be true"
  );
  const recoveryScope = uniqueStrings(recoveryReport.recoveryPlan.recoveryScope, "recoveryReport.recoveryPlan.recoveryScope");
  for (const entry of recoveryScope) {
    requireEnum(entry, DRY_RUN_SCOPE_VALUES, "recoveryReport.recoveryPlan.recoveryScope[]");
  }
  assert.equal(
    sameStringSet(recoveryScope, expectedRecoveryScope),
    true,
    `recoveryReport.recoveryPlan.recoveryScope must cover ${expectedRecoveryScope.join("/")}`
  );

  requireAllowedKeys(recoveryReport.privacy, RECOVERY_PRIVACY_KEYS, "recoveryReport.privacy");
  assert.equal(recoveryReport.privacy.sanitizedSummaryOnly, true, "recoveryReport.privacy.sanitizedSummaryOnly must be true");
  assert.equal(recoveryReport.privacy.contentHashOnly, true, "recoveryReport.privacy.contentHashOnly must be true");

  if (recoveryReport.detectedState.operationType === "apply") {
    assert.deepEqual(recoveryReport.checkpoint.beforeRefs, [], "apply recovery checkpoint beforeRefs must remain empty");
    assert.deepEqual(
      recoveryReport.checkpoint.afterRefs,
      proposal.rollbackPlan.targetRecordIds,
      "apply recovery checkpoint afterRefs must match targetRecordIds"
    );
    assert.deepEqual(
      writtenRecordIds,
      proposal.rollbackPlan.targetRecordIds,
      "apply recovery writtenRecordIds must match targetRecordIds"
    );
    assert.deepEqual(
      contextDenyRecordIds,
      proposal.rollbackPlan.targetRecordIds,
      "apply recovery contextDenyRecordIds must match targetRecordIds"
    );
  }

  return recoveryReport;
}

export async function loadVerifiedSelfLearningGovernanceContract({
  rootDir = DEFAULT_MEMORY_STABILITY_REPO_ROOT,
  proposalSchemaPath = DEFAULT_SELF_LEARNING_PROPOSAL_SCHEMA_PATH,
  dryRunSchemaPath = DEFAULT_SELF_LEARNING_DRY_RUN_SCHEMA_PATH,
  recoveryReportSchemaPath = DEFAULT_SELF_LEARNING_RECOVERY_REPORT_SCHEMA_PATH,
  proposalFixturePath = DEFAULT_SELF_LEARNING_PROPOSAL_FIXTURE_PATH,
  applyDryRunFixturePath = DEFAULT_SELF_LEARNING_APPLY_DRY_RUN_FIXTURE_PATH,
  revertDryRunFixturePath = DEFAULT_SELF_LEARNING_REVERT_DRY_RUN_FIXTURE_PATH,
  recoveryReportFixturePath = DEFAULT_SELF_LEARNING_RECOVERY_REPORT_FIXTURE_PATH,
} = {}) {
  try {
    const resolvedRootDir = path.resolve(rootDir);
    const resolvedProposalSchemaPath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, proposalSchemaPath);
    const resolvedDryRunSchemaPath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, dryRunSchemaPath);
    const resolvedRecoveryReportSchemaPath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, recoveryReportSchemaPath);
    const resolvedProposalFixturePath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, proposalFixturePath);
    const resolvedApplyDryRunFixturePath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, applyDryRunFixturePath);
    const resolvedRevertDryRunFixturePath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, revertDryRunFixturePath);
    const resolvedRecoveryReportFixturePath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, recoveryReportFixturePath);

    validateLearningProposalSchemaFile(await readJson(resolvedProposalSchemaPath));
    validateSelfLearningDryRunSchemaFile(await readJson(resolvedDryRunSchemaPath));
    validateSelfLearningRecoveryReportSchemaFile(await readJson(resolvedRecoveryReportSchemaPath));
    const proposalEnvelope = await readJson(resolvedProposalFixturePath);
    assertNoRawPayloadFields(proposalEnvelope, "self-learning proposal fixture");
    assertNoSensitiveStrings(proposalEnvelope, "self-learning proposal fixture");
    const proposal = validateLearningProposalEnvelope(proposalEnvelope);
    const evidenceRefs = proposal.evidenceIds.map((evidenceId) => ({
      evidenceId,
      agentId: proposal.agentId,
      namespaceScopeId: proposal.namespaceScopeId,
      kind: proposal.candidate.evidenceKind,
      contentSha256: "b".repeat(64),
    }));
    const admission = evaluateLearningProposalEnvelope(proposalEnvelope, {
      evidenceRefs,
      activeRecords: [],
      protectedRecordIds: ["memory-protected-001"],
    });
    assert.equal(admission.decision, "approved_auto", "redacted proposal fixture must auto-admit as low-risk memory");
    validateSelfLearningApplyDryRun(await readJson(resolvedApplyDryRunFixturePath), proposal);
    validateSelfLearningRevertDryRun(await readJson(resolvedRevertDryRunFixturePath), proposal);
    const recoveryReport = await readJson(resolvedRecoveryReportFixturePath);
    validateSelfLearningRecoveryReport(recoveryReport, proposal);

    return {
      ok: true,
      failClosed: true,
      contract: {
        proposalSchemaPath,
        dryRunSchemaPath,
        recoveryReportSchemaPath,
        proposalFixturePath,
        applyDryRunFixturePath,
        revertDryRunFixturePath,
        recoveryReportFixturePath,
        boundary: {
          adapterApiCalled: false,
          ledgerEventCreated: false,
          engineCanonicalWritePerformed: false,
          modelCalled: false,
          networkCalled: false,
          rawContentPersisted: false,
          checkpointRestoreAvailable: true,
        },
      },
      verifierReports: {
        proposal: {
          decision: admission.decision,
          contextInjectionAllowed: admission.contextInjectionAllowed,
          requiredReviewMode: admission.requiredReviewMode,
        },
        dryRuns: {
          modes: ["apply", "revert"],
          adapterExecutionRequired: true,
          adapterApiCalled: false,
          engineCanonicalWritePerformed: false,
          authoritativeStoreMutated: false,
        },
        recoveryReport: {
          mode: recoveryReport.mode,
          matchedOperationState: recoveryReport.matchedOperationState,
          checkpointRestoreAvailable: recoveryReport.recoveryPlan.checkpointRestoreAvailable,
          bridgeRepairRequired: recoveryReport.recoveryPlan.bridgeRepairRequired,
        },
      },
    };
  } catch (error) {
    if (error instanceof MemoryStabilitySelfLearningGovernanceError) {
      throw error;
    }
    throw new MemoryStabilitySelfLearningGovernanceError("Fail-closed self-learning governance verification failed", {
      stage: "self_learning_governance_validation",
      cause: error,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

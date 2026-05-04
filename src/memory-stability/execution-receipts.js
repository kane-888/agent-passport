import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  getMemoryStabilityActionInputContentPolicy,
  memoryStabilityActionRequiresMemoryRefs,
} from "./action-vocabulary.js";
import { memoryStabilitySnapshotSha256 } from "./adapter-contract.js";

export const MEMORY_STABILITY_FORMAL_EXECUTION_REQUEST_SCHEMA_VERSION =
  "memory-stability-formal-execution-request/v1";
export const MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_SCHEMA_VERSION =
  "memory-stability-formal-execution-receipt/v1";
export const MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES = Object.freeze({
  authoritativeStoreReload: "authoritative_store_reload",
  conflictResolutionRefresh: "conflict_resolution_refresh",
});

const FORMAL_EXECUTION_ACTION_TO_RECEIPT_TYPE = Object.freeze({
  reload_authoritative_memory_store: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
  resolve_conflicts_and_refresh_runtime_state: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh,
});
const FORMAL_EXECUTION_RECEIPT_TYPE_TO_ACTION = Object.freeze(
  Object.fromEntries(
    Object.entries(FORMAL_EXECUTION_ACTION_TO_RECEIPT_TYPE).map(([action, receiptType]) => [receiptType, action])
  )
);
const FORMAL_EXECUTION_ACTIONS = new Set(Object.keys(FORMAL_EXECUTION_ACTION_TO_RECEIPT_TYPE));
const FORMAL_EXECUTION_RECEIPT_TYPES = new Set(Object.values(MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES));
const REQUEST_ALLOWED_KEYS = new Set([
  "schema_version",
  "request_id",
  "mode",
  "status",
  "created_at",
  "summary",
  "next_action",
  "source_snapshot",
  "execution",
  "rollback",
  "privacy",
]);
const REQUEST_SOURCE_KEYS = new Set([
  "path",
  "snapshot_id",
  "source_snapshot_sha256",
  "correction_level",
  "c_t",
  "s_t",
]);
const REQUEST_EXECUTION_KEYS = new Set([
  "adapter_invocation_id",
  "checkpoint_id",
  "completed_safe_actions",
  "pending_formal_actions",
  "required_receipts",
]);
const REQUEST_PENDING_ACTION_KEYS = new Set([
  "action",
  "receipt_type",
  "target_memory_refs",
  "input_content_policy",
]);
const REQUEST_RECEIPT_REQUIREMENT_KEYS = new Set([
  "receipt_type",
  "checkpoint_id",
  "dedupe_key",
  "before_hash",
  "rollback_ready_required",
  "post_reload_runtime_required",
]);
const REQUEST_ROLLBACK_KEYS = new Set([
  "strategy",
  "checkpoint_restore_required",
  "quarantine_context_injection_until_completed",
]);
const REQUEST_PRIVACY_KEYS = new Set([
  "model_called",
  "network_called",
  "raw_content_persisted",
]);
const RECEIPT_ALLOWED_KEYS = new Set([
  "schema_version",
  "receipt_id",
  "receipt_type",
  "snapshot_id",
  "source_snapshot_sha256",
  "adapter_invocation_id",
  "checkpoint_id",
  "dedupe_key",
  "before_hash",
  "after_hash",
  "authoritative_store_version",
  "created_at",
  "status",
  "rollback_ready",
  "post_reload_runtime_required",
  "mutated",
  "resolved",
  "notes",
]);
const RAW_FIELD_EXACT = new Set([
  "content",
  "full_content",
  "full_prompt",
  "full_text",
  "memory_content",
  "memory_text",
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
const RAW_FIELD_EXCEPTIONS = new Set(["content_sha256", "input_content_policy", "raw_content_persisted"]);

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function nonEmptyString(value, fallback = null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, label) {
  assert.equal(isObject(value), true, `${label} must be an object`);
  return value;
}

function requireAllowedKeys(value, allowed, label) {
  requireObject(value, label);
  for (const key of Object.keys(value)) {
    assert.equal(allowed.has(key), true, `${label} unexpected field: ${key}`);
  }
}

function requireString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.equal(value.trim().length > 0, true, `${label} must not be empty`);
}

function requireBoolean(value, label) {
  assert.equal(typeof value, "boolean", `${label} must be boolean`);
}

function requireSha256(value, label) {
  requireString(value, label);
  assert.match(value, /^[a-f0-9]{64}$/u, `${label} must be sha256 hex`);
}

function clampScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, Math.round(number * 10000) / 10000));
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
    if (RAW_FIELD_EXACT.has(normalized)) return true;
    return (/raw/u.test(normalized) && /(content|memory|message|prompt|request|response|text)/u.test(normalized)) || hasRawPayloadField(nested);
  });
}

function assertNoRawPayloadFields(value, label) {
  assert.equal(hasRawPayloadField(value), false, `${label} raw payload fields are not allowed`);
}

function assertSanitizedLine(value, label) {
  requireString(value, label);
  assert.equal(/[\r\n]/u.test(value), false, `${label} must be a single sanitized line`);
  assert.equal(/(?:api[\s_-]?key|secret|password|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{12,})/iu.test(value), false, `${label} must not contain sensitive text`);
}

function anchors(snapshot) {
  return Array.isArray(snapshot?.runtime_state?.memory_anchors) ? snapshot.runtime_state.memory_anchors : [];
}

function refsForAction(action, sourceAnchors) {
  if (!memoryStabilityActionRequiresMemoryRefs(action)) {
    return [];
  }
  return sourceAnchors.map((anchor) => ({
    memory_id: anchor.memory_id,
    content_sha256: anchor.content_sha256,
  }));
}

function expectedBeforeHash(snapshot) {
  return sha256(
    stableJsonStringify(
      anchors(snapshot).map((anchor) => ({
        memory_id: anchor.memory_id,
        content_sha256: anchor.content_sha256,
        inserted_position: anchor.inserted_position,
        importance_weight: anchor.importance_weight,
        authoritative: Boolean(anchor.authoritative),
        conflict: Boolean(anchor.conflict),
      }))
    )
  );
}

function requestedFormalActions(snapshot) {
  const planActions = Array.isArray(snapshot?.correction_plan?.actions) ? snapshot.correction_plan.actions : [];
  return planActions.filter((action) => FORMAL_EXECUTION_ACTIONS.has(action));
}

function validateMemoryRefs(targetMemoryRefs, snapshot, label) {
  assert.equal(Array.isArray(targetMemoryRefs), true, `${label} must be an array`);
  const sourceAnchors = new Map(anchors(snapshot).map((anchor) => [anchor.memory_id, anchor.content_sha256]));
  for (const [index, ref] of targetMemoryRefs.entries()) {
    requireObject(ref, `${label}[${index}]`);
    requireAllowedKeys(ref, new Set(["memory_id", "content_sha256"]), `${label}[${index}]`);
    requireString(ref.memory_id, `${label}[${index}].memory_id`);
    requireSha256(ref.content_sha256, `${label}[${index}].content_sha256`);
    assert.equal(sourceAnchors.has(ref.memory_id), true, `${label}[${index}].memory_id must exist in source snapshot`);
    assert.equal(ref.content_sha256, sourceAnchors.get(ref.memory_id), `${label}[${index}].content_sha256 must match source snapshot`);
  }
}

export function isMemoryStabilityFormalExecutionAction(action) {
  return FORMAL_EXECUTION_ACTIONS.has(action);
}

export function formalExecutionReceiptTypeForAction(action) {
  return FORMAL_EXECUTION_ACTION_TO_RECEIPT_TYPE[action] || null;
}

export function memoryStabilityFormalExecutionCheckpointId(snapshotId, adapterInvocationId) {
  return `msexec-checkpoint-${sha256(`${snapshotId}:${adapterInvocationId}`).slice(0, 16)}`;
}

export function memoryStabilityFormalExecutionRequestId(snapshotId, adapterInvocationId) {
  return `msexec-request-${sha256(`${snapshotId}:${adapterInvocationId}`).slice(0, 16)}`;
}

export function memoryStabilityFormalExecutionReceiptId(snapshotId, adapterInvocationId, receiptType) {
  return `msexec-receipt-${sha256(`${snapshotId}:${adapterInvocationId}:${receiptType}`).slice(0, 16)}`;
}

export function memoryStabilityFormalExecutionDedupeKey(snapshotId, adapterInvocationId, receiptType) {
  return `msexec:${snapshotId}:${adapterInvocationId}:${receiptType}`;
}

export function buildMemoryStabilityFormalExecutionRequest({
  snapshot,
  sourceSnapshotPath,
  adapterInvocationId,
  createdAt = new Date().toISOString(),
  executedActions = [],
} = {}) {
  requireObject(snapshot, "snapshot");
  if (snapshot?.runtime_state?.correction_level !== "strong") {
    return null;
  }
  const pendingFormalActions = requestedFormalActions(snapshot)
    .filter((action) => {
      const executed = (Array.isArray(executedActions) ? executedActions : []).find((entry) => entry?.action === action);
      return executed?.status !== "completed";
    })
    .map((action) => ({
      action,
      receipt_type: formalExecutionReceiptTypeForAction(action),
      target_memory_refs: refsForAction(action, anchors(snapshot)),
      input_content_policy: getMemoryStabilityActionInputContentPolicy(action),
    }));

  if (pendingFormalActions.length === 0) {
    return null;
  }

  const snapshotId = nonEmptyString(snapshot?.snapshot_id);
  requireString(snapshotId, "snapshot.snapshot_id");
  requireString(adapterInvocationId, "adapterInvocationId");
  const checkpointId = memoryStabilityFormalExecutionCheckpointId(snapshotId, adapterInvocationId);
  const beforeHash = expectedBeforeHash(snapshot);

  return {
    schema_version: MEMORY_STABILITY_FORMAL_EXECUTION_REQUEST_SCHEMA_VERSION,
    request_id: memoryStabilityFormalExecutionRequestId(snapshotId, adapterInvocationId),
    mode: "formal_execution_required",
    status: "blocked_authoritative_reload",
    created_at: createdAt,
    summary: "Strong correction requires explicit authoritative reload receipts before runtime may claim convergence.",
    next_action: "Provide formal execution receipts for authoritative reload and conflict refresh, then recompute runtime state.",
    source_snapshot: {
      path: sourceSnapshotPath,
      snapshot_id: snapshotId,
      source_snapshot_sha256: memoryStabilitySnapshotSha256(snapshot),
      correction_level: snapshot.runtime_state.correction_level,
      c_t: clampScore(snapshot.runtime_state.c_t, 0),
      s_t: clampScore(snapshot.runtime_state.s_t, 0),
    },
    execution: {
      adapter_invocation_id: adapterInvocationId,
      checkpoint_id: checkpointId,
      completed_safe_actions: (Array.isArray(executedActions) ? executedActions : [])
        .filter((entry) => entry?.status === "completed" && !FORMAL_EXECUTION_ACTIONS.has(entry?.action))
        .map((entry) => entry.action),
      pending_formal_actions: pendingFormalActions,
      required_receipts: pendingFormalActions.map((entry) => ({
        receipt_type: entry.receipt_type,
        checkpoint_id: checkpointId,
        dedupe_key: memoryStabilityFormalExecutionDedupeKey(snapshotId, adapterInvocationId, entry.receipt_type),
        before_hash: beforeHash,
        rollback_ready_required: true,
        post_reload_runtime_required: true,
      })),
    },
    rollback: {
      strategy: "checkpoint_restore",
      checkpoint_restore_required: true,
      quarantine_context_injection_until_completed: true,
    },
    privacy: {
      model_called: false,
      network_called: false,
      raw_content_persisted: false,
    },
  };
}

export function validateMemoryStabilityFormalExecutionRequest(request, snapshot) {
  requireAllowedKeys(request, REQUEST_ALLOWED_KEYS, "formalExecutionRequest");
  assertNoRawPayloadFields(request, "formalExecutionRequest");
  assert.equal(
    request.schema_version,
    MEMORY_STABILITY_FORMAL_EXECUTION_REQUEST_SCHEMA_VERSION,
    "formalExecutionRequest.schema_version mismatch"
  );
  assert.equal(
    request.request_id,
    memoryStabilityFormalExecutionRequestId(snapshot.snapshot_id, request.execution?.adapter_invocation_id),
    "formalExecutionRequest.request_id mismatch"
  );
  assert.equal(request.mode, "formal_execution_required", "formalExecutionRequest.mode mismatch");
  assert.equal(request.status, "blocked_authoritative_reload", "formalExecutionRequest.status mismatch");
  assertSanitizedLine(request.summary, "formalExecutionRequest.summary");
  assertSanitizedLine(request.next_action, "formalExecutionRequest.next_action");

  requireAllowedKeys(request.source_snapshot, REQUEST_SOURCE_KEYS, "formalExecutionRequest.source_snapshot");
  requireString(request.source_snapshot.path, "formalExecutionRequest.source_snapshot.path");
  assert.equal(
    request.source_snapshot.snapshot_id,
    snapshot.snapshot_id,
    "formalExecutionRequest.source_snapshot.snapshot_id mismatch"
  );
  assert.equal(
    request.source_snapshot.source_snapshot_sha256,
    memoryStabilitySnapshotSha256(snapshot),
    "formalExecutionRequest.source_snapshot.source_snapshot_sha256 mismatch"
  );
  assert.equal(
    request.source_snapshot.correction_level,
    snapshot.runtime_state.correction_level,
    "formalExecutionRequest.source_snapshot.correction_level mismatch"
  );

  requireAllowedKeys(request.execution, REQUEST_EXECUTION_KEYS, "formalExecutionRequest.execution");
  requireString(request.execution.adapter_invocation_id, "formalExecutionRequest.execution.adapter_invocation_id");
  const checkpointId = memoryStabilityFormalExecutionCheckpointId(
    snapshot.snapshot_id,
    request.execution.adapter_invocation_id
  );
  assert.equal(
    request.execution.checkpoint_id,
    checkpointId,
    "formalExecutionRequest.execution.checkpoint_id mismatch"
  );
  assert.equal(Array.isArray(request.execution.completed_safe_actions), true, "formalExecutionRequest.execution.completed_safe_actions must be an array");
  assert.equal(Array.isArray(request.execution.pending_formal_actions), true, "formalExecutionRequest.execution.pending_formal_actions must be an array");
  assert.equal(request.execution.pending_formal_actions.length > 0, true, "formalExecutionRequest.execution.pending_formal_actions must not be empty");
  for (const [index, action] of request.execution.pending_formal_actions.entries()) {
    requireAllowedKeys(action, REQUEST_PENDING_ACTION_KEYS, `formalExecutionRequest.execution.pending_formal_actions[${index}]`);
    assert.equal(
      requestedFormalActions(snapshot).includes(action.action),
      true,
      `formalExecutionRequest.execution.pending_formal_actions[${index}].action must exist in source snapshot`
    );
    assert.equal(
      action.receipt_type,
      formalExecutionReceiptTypeForAction(action.action),
      `formalExecutionRequest.execution.pending_formal_actions[${index}].receipt_type mismatch`
    );
    assert.equal(
      action.input_content_policy,
      getMemoryStabilityActionInputContentPolicy(action.action),
      `formalExecutionRequest.execution.pending_formal_actions[${index}].input_content_policy mismatch`
    );
    validateMemoryRefs(action.target_memory_refs, snapshot, `formalExecutionRequest.execution.pending_formal_actions[${index}].target_memory_refs`);
  }
  assert.equal(Array.isArray(request.execution.required_receipts), true, "formalExecutionRequest.execution.required_receipts must be an array");
  assert.equal(
    request.execution.required_receipts.length,
    request.execution.pending_formal_actions.length,
    "formalExecutionRequest.execution.required_receipts length mismatch"
  );
  for (const [index, requirement] of request.execution.required_receipts.entries()) {
    requireAllowedKeys(requirement, REQUEST_RECEIPT_REQUIREMENT_KEYS, `formalExecutionRequest.execution.required_receipts[${index}]`);
    assert.equal(
      FORMAL_EXECUTION_RECEIPT_TYPES.has(requirement.receipt_type),
      true,
      `formalExecutionRequest.execution.required_receipts[${index}].receipt_type invalid`
    );
    assert.equal(
      requirement.checkpoint_id,
      checkpointId,
      `formalExecutionRequest.execution.required_receipts[${index}].checkpoint_id mismatch`
    );
    assert.equal(
      requirement.dedupe_key,
      memoryStabilityFormalExecutionDedupeKey(snapshot.snapshot_id, request.execution.adapter_invocation_id, requirement.receipt_type),
      `formalExecutionRequest.execution.required_receipts[${index}].dedupe_key mismatch`
    );
    assert.equal(
      requirement.before_hash,
      expectedBeforeHash(snapshot),
      `formalExecutionRequest.execution.required_receipts[${index}].before_hash mismatch`
    );
    assert.equal(
      requirement.rollback_ready_required,
      true,
      `formalExecutionRequest.execution.required_receipts[${index}].rollback_ready_required must be true`
    );
    assert.equal(
      requirement.post_reload_runtime_required,
      true,
      `formalExecutionRequest.execution.required_receipts[${index}].post_reload_runtime_required must be true`
    );
  }

  requireAllowedKeys(request.rollback, REQUEST_ROLLBACK_KEYS, "formalExecutionRequest.rollback");
  assert.equal(request.rollback.strategy, "checkpoint_restore", "formalExecutionRequest.rollback.strategy mismatch");
  assert.equal(request.rollback.checkpoint_restore_required, true, "formalExecutionRequest.rollback.checkpoint_restore_required must be true");
  assert.equal(
    request.rollback.quarantine_context_injection_until_completed,
    true,
    "formalExecutionRequest.rollback.quarantine_context_injection_until_completed must be true"
  );
  requireAllowedKeys(request.privacy, REQUEST_PRIVACY_KEYS, "formalExecutionRequest.privacy");
  assert.equal(request.privacy.model_called, false, "formalExecutionRequest.privacy.model_called must be false");
  assert.equal(request.privacy.network_called, false, "formalExecutionRequest.privacy.network_called must be false");
  assert.equal(request.privacy.raw_content_persisted, false, "formalExecutionRequest.privacy.raw_content_persisted must be false");
  return request;
}

export function buildMemoryStabilityFormalExecutionReceipt({
  snapshot,
  adapterInvocationId,
  receiptType,
  authoritativeStoreVersion,
  createdAt = new Date().toISOString(),
  afterHash = null,
  notes = null,
} = {}) {
  requireObject(snapshot, "snapshot");
  requireString(adapterInvocationId, "adapterInvocationId");
  assert.equal(FORMAL_EXECUTION_RECEIPT_TYPES.has(receiptType), true, "receiptType invalid");
  const snapshotId = snapshot.snapshot_id;
  requireString(snapshotId, "snapshot.snapshot_id");
  const beforeHash = expectedBeforeHash(snapshot);
  const normalizedAfterHash = nonEmptyString(afterHash, sha256(`${beforeHash}:${receiptType}:after`));
  requireSha256(normalizedAfterHash, "afterHash");
  requireString(authoritativeStoreVersion, "authoritativeStoreVersion");

  return {
    schema_version: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_SCHEMA_VERSION,
    receipt_id: memoryStabilityFormalExecutionReceiptId(snapshotId, adapterInvocationId, receiptType),
    receipt_type: receiptType,
    snapshot_id: snapshotId,
    source_snapshot_sha256: memoryStabilitySnapshotSha256(snapshot),
    adapter_invocation_id: adapterInvocationId,
    checkpoint_id: memoryStabilityFormalExecutionCheckpointId(snapshotId, adapterInvocationId),
    dedupe_key: memoryStabilityFormalExecutionDedupeKey(snapshotId, adapterInvocationId, receiptType),
    before_hash: beforeHash,
    after_hash: normalizedAfterHash,
    authoritative_store_version: authoritativeStoreVersion,
    created_at: createdAt,
    status: "completed",
    rollback_ready: true,
    post_reload_runtime_required: true,
    ...(receiptType === MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload
      ? { mutated: true }
      : { resolved: true }),
    notes:
      notes ||
      (receiptType === MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload
        ? "Authoritative reload receipt bound to the current strong snapshot."
        : "Conflict resolution receipt bound to the current strong snapshot."),
  };
}

export function validateMemoryStabilityFormalExecutionReceipt(
  receipt,
  { snapshot, adapterInvocationId = null, expectedAction = null } = {}
) {
  requireAllowedKeys(receipt, RECEIPT_ALLOWED_KEYS, "formalExecutionReceipt");
  assertNoRawPayloadFields(receipt, "formalExecutionReceipt");
  assert.equal(
    receipt.schema_version,
    MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_SCHEMA_VERSION,
    "formalExecutionReceipt.schema_version mismatch"
  );
  assert.equal(
    receipt.receipt_id,
    memoryStabilityFormalExecutionReceiptId(receipt.snapshot_id, receipt.adapter_invocation_id, receipt.receipt_type),
    "formalExecutionReceipt.receipt_id mismatch"
  );
  assert.equal(FORMAL_EXECUTION_RECEIPT_TYPES.has(receipt.receipt_type), true, "formalExecutionReceipt.receipt_type invalid");
  assert.equal(receipt.status, "completed", "formalExecutionReceipt.status must be completed");
  requireString(receipt.snapshot_id, "formalExecutionReceipt.snapshot_id");
  requireSha256(receipt.source_snapshot_sha256, "formalExecutionReceipt.source_snapshot_sha256");
  requireString(receipt.adapter_invocation_id, "formalExecutionReceipt.adapter_invocation_id");
  requireString(receipt.checkpoint_id, "formalExecutionReceipt.checkpoint_id");
  requireString(receipt.dedupe_key, "formalExecutionReceipt.dedupe_key");
  requireSha256(receipt.before_hash, "formalExecutionReceipt.before_hash");
  requireSha256(receipt.after_hash, "formalExecutionReceipt.after_hash");
  requireString(receipt.authoritative_store_version, "formalExecutionReceipt.authoritative_store_version");
  requireString(receipt.created_at, "formalExecutionReceipt.created_at");
  requireBoolean(receipt.rollback_ready, "formalExecutionReceipt.rollback_ready");
  requireBoolean(receipt.post_reload_runtime_required, "formalExecutionReceipt.post_reload_runtime_required");
  assertSanitizedLine(receipt.notes, "formalExecutionReceipt.notes");
  assert.equal(receipt.rollback_ready, true, "formalExecutionReceipt.rollback_ready must be true");
  assert.equal(receipt.post_reload_runtime_required, true, "formalExecutionReceipt.post_reload_runtime_required must be true");

  if (snapshot) {
    assert.equal(receipt.snapshot_id, snapshot.snapshot_id, "formalExecutionReceipt.snapshot_id mismatch");
    assert.equal(
      receipt.source_snapshot_sha256,
      memoryStabilitySnapshotSha256(snapshot),
      "formalExecutionReceipt.source_snapshot_sha256 mismatch"
    );
    assert.equal(
      receipt.checkpoint_id,
      memoryStabilityFormalExecutionCheckpointId(snapshot.snapshot_id, receipt.adapter_invocation_id),
      "formalExecutionReceipt.checkpoint_id mismatch"
    );
    assert.equal(
      receipt.dedupe_key,
      memoryStabilityFormalExecutionDedupeKey(snapshot.snapshot_id, receipt.adapter_invocation_id, receipt.receipt_type),
      "formalExecutionReceipt.dedupe_key mismatch"
    );
    assert.equal(
      receipt.before_hash,
      expectedBeforeHash(snapshot),
      "formalExecutionReceipt.before_hash mismatch"
    );
  }
  if (adapterInvocationId !== null) {
    assert.equal(
      receipt.adapter_invocation_id,
      adapterInvocationId,
      "formalExecutionReceipt.adapter_invocation_id mismatch"
    );
  }
  if (expectedAction !== null) {
    assert.equal(
      FORMAL_EXECUTION_RECEIPT_TYPE_TO_ACTION[receipt.receipt_type],
      expectedAction,
      "formalExecutionReceipt.receipt_type does not match expected action"
    );
  }
  if (receipt.receipt_type === MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload) {
    assert.equal(receipt.mutated, true, "formalExecutionReceipt.mutated must be true");
    assert.equal(Object.hasOwn(receipt, "resolved"), false, "formalExecutionReceipt.resolved must not be present for reload receipts");
  }
  if (receipt.receipt_type === MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh) {
    assert.equal(receipt.resolved, true, "formalExecutionReceipt.resolved must be true");
    assert.equal(Object.hasOwn(receipt, "mutated"), false, "formalExecutionReceipt.mutated must not be present for conflict receipts");
  }
  return receipt;
}

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  compactMemoryStabilityPath,
  DEFAULT_MEMORY_STABILITY_REDACTED_FIXTURES_DIR,
  DEFAULT_MEMORY_STABILITY_REPO_ROOT,
  loadVerifiedMemoryStabilityContract,
  MEMORY_STABILITY_SNAPSHOT_SCHEMA_VERSION,
  resolveMemoryStabilityPathInsideRoot,
} from "./contract-loader.js";
import {
  getMemoryStabilityActionInputContentPolicy,
  memoryStabilityActionRequiresMemoryRefs,
  MEMORY_STABILITY_CORRECTION_ACTIONS_BY_LEVEL,
} from "./action-vocabulary.js";

export const MEMORY_STABILITY_CORRECTION_EVENT_SCHEMA_VERSION = "memory-stability-correction-event/v1";
export const DEFAULT_MEMORY_STABILITY_CORRECTION_EVENT_SCHEMA_PATH =
  "contracts/memory-stability/schemas/memory-stability-correction-event.schema.json";
export const DEFAULT_MEMORY_STABILITY_CORRECTION_EVENTS_DIR =
  "tests/fixtures/memory-stability/correction-events";

export const EXPECTED_MEMORY_STABILITY_CORRECTION_EVENT_LEVELS = Object.freeze(
  new Map([
    ["none-correction-execution-event.json", "none"],
    ["medium-correction-execution-event.json", "medium"],
    ["strong-correction-execution-event.json", "strong"],
  ])
);

const ALLOWED_ACTOR_TYPES = new Set(["product_adapter", "operator", "test_fixture"]);
const ALLOWED_CONTENT_POLICIES = new Set(["hash_only", "sanitized_summary_only"]);
const ALLOWED_ACTION_STATUSES = new Set(["completed", "failed", "skipped"]);
const ALLOWED_EXECUTION_STATUSES = new Set(["completed", "partial", "failed", "skipped"]);
const ALLOWED_ACTIONS_BY_CORRECTION_LEVEL = Object.freeze(
  Object.fromEntries(
    Object.entries(MEMORY_STABILITY_CORRECTION_ACTIONS_BY_LEVEL).map(([level, actions]) => [level, new Set(actions)])
  )
);

const RAW_PAYLOAD_FIELD_EXCEPTIONS = new Set([
  "content_policy",
  "content_sha256",
  "input_content_policy",
  "raw_content_persisted",
]);

const RAW_PAYLOAD_FIELD_EXACT = new Set([
  "answer",
  "completion",
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

const UNSAFE_FREE_TEXT_PATTERNS = Object.freeze([
  { pattern: /\b(?:system|developer|user|assistant)\s*:/iu, reason: "chat transcript role marker" },
  { pattern: /\bBEGIN\s+(?:PROMPT|SYSTEM|USER|ASSISTANT|RAW)\b/iu, reason: "raw prompt boundary marker" },
  { pattern: /```[\s\S]*```/u, reason: "fenced raw block" },
  { pattern: /\b(?:full|raw)\s+(?:prompt|message|response|request)\b/iu, reason: "raw payload wording" },
  { pattern: /\b(?:api[_-]?key|secret|password|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{12,})\b/iu, reason: "secret-like text" },
  { pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu, reason: "email-like text" },
  { pattern: /https?:\/\//iu, reason: "url-like text" },
]);

export class MemoryStabilityAdapterContractError extends Error {
  constructor(message, { stage = "unknown", cause = null, detail = "" } = {}) {
    super(message);
    this.name = "MemoryStabilityAdapterContractError";
    this.code = "MEMORY_STABILITY_ADAPTER_CONTRACT_FAILED";
    this.stage = stage;
    this.detail = detail;
    if (cause) {
      this.cause = cause;
    }
  }
}

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

export function memoryStabilitySnapshotSha256(snapshot) {
  return crypto.createHash("sha256").update(stableJsonStringify(snapshot)).digest("hex");
}

export function memoryStabilityCorrectionEventIdFor(snapshotId, adapterInvocationId) {
  return `correction-event-${crypto.createHash("sha256").update(`${snapshotId}:${adapterInvocationId}`).digest("hex").slice(0, 16)}`;
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

function requireFields(object, fields, label) {
  for (const field of fields) {
    assert.equal(Object.hasOwn(object, field), true, `${label} missing required field: ${field}`);
  }
}

function assertAllowedKeys(object, allowedKeys, label) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(object || {})) {
    assert.equal(allowed.has(key), true, `${label} unexpected field: ${key}`);
  }
}

function requireNonEmptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.equal(value.trim().length > 0, true, `${label} must not be empty`);
}

function requireBoolean(value, label) {
  assert.equal(typeof value, "boolean", `${label} must be a boolean`);
}

function requireInteger(value, label) {
  assert.equal(Number.isInteger(value), true, `${label} must be an integer`);
}

function requireNumber(value, label) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.equal(Number.isFinite(value), true, `${label} must be finite`);
}

function requireScore(value, label) {
  requireNumber(value, label);
  assert.equal(value >= 0 && value <= 1, true, `${label} must be within [0, 1]`);
}

function requireSha256(value, label) {
  requireNonEmptyString(value, label);
  assert.match(value, /^[a-f0-9]{64}$/u, `${label} must be sha256 hex`);
}

function requireEnum(value, allowed, label) {
  requireNonEmptyString(value, label);
  assert.equal(allowed.has(value), true, `${label} must be one of: ${Array.from(allowed).join(", ")}`);
}

function isForbiddenRawPayloadField(key) {
  const normalized = String(key).replace(/[-\s]/gu, "_").toLowerCase();
  if (RAW_PAYLOAD_FIELD_EXCEPTIONS.has(normalized)) {
    return false;
  }
  if (RAW_PAYLOAD_FIELD_EXACT.has(normalized)) {
    return true;
  }
  return /raw/u.test(normalized) && /(answer|completion|content|memory|message|prompt|request|response|text)/u.test(normalized);
}

function assertNoRawPayloadFields(value, label) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRawPayloadFields(entry, `${label}[${index}]`));
    return;
  }
  if (!isObject(value)) {
    return;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    assert.equal(isForbiddenRawPayloadField(key), false, `${label} must not include raw content field: ${key}`);
    assertNoRawPayloadFields(nestedValue, `${label}.${key}`);
  }
}

function assertSanitizedFreeText(value, label, { maxLength = 512 } = {}) {
  requireNonEmptyString(value, label);
  assert.equal(value.length <= maxLength, true, `${label} must be short and sanitized`);
  assert.equal(/[\r\n]/u.test(value), false, `${label} must be a single sanitized line`);
  for (const { pattern, reason } of UNSAFE_FREE_TEXT_PATTERNS) {
    assert.equal(pattern.test(value), false, `${label} must not include ${reason}`);
  }
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.min(1, Math.max(0, number));
}

function refsForAction(action, anchors) {
  if (!memoryStabilityActionRequiresMemoryRefs(action)) {
    return [];
  }
  return anchors.map((anchor) => ({
    memory_id: anchor.memory_id,
    content_sha256: anchor.content_sha256,
  }));
}

function policyForAction(action) {
  return getMemoryStabilityActionInputContentPolicy(action);
}

function summaryForAction(action) {
  return (
    {
      continue_monitoring: "Adapter recorded stable runtime state and continued monitoring.",
      reanchor_key_memories_near_prompt_end: "Adapter reanchored key memory refs near prompt end using hash-only references.",
      raise_memory_injection_priority: "Adapter raised injection priority for selected key memory refs.",
      rewrite_working_memory_summary: "Adapter rewrote working memory summary from sanitized runtime state.",
      compress_low_value_history: "Adapter compressed low-value history and kept audited summary metadata.",
      reload_authoritative_memory_store: "Adapter refreshed authoritative memory state by memory refs.",
      resolve_conflicts_and_refresh_runtime_state: "Adapter resolved conflicting memory refs and refreshed runtime state.",
    }[action] || `Adapter executed ${action}.`
  );
}

function validateActionsForCorrectionLevel(actions, correctionLevel, label) {
  const allowed = ALLOWED_ACTIONS_BY_CORRECTION_LEVEL[correctionLevel];
  assert.equal(Boolean(allowed), true, `${label} correction_level must be one of: ${Object.keys(ALLOWED_ACTIONS_BY_CORRECTION_LEVEL).join(", ")}`);
  for (const [index, action] of actions.entries()) {
    requireNonEmptyString(action, `${label}.actions[${index}]`);
    assert.equal(allowed.has(action), true, `${label}.actions[${index}] action is not allowed for ${correctionLevel}: ${action}`);
  }
}

function assertSameActionSequence(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} must execute every source snapshot correction_plan.action exactly once`);
  assert.equal(new Set(actual).size, actual.length, `${label} must not contain duplicate action receipts`);
  assert.deepEqual(actual, expected, `${label} must exactly match source snapshot correction_plan.actions`);
}

function deriveExecutionStatus(actions) {
  if (actions.every((action) => action.status === "completed")) {
    return "completed";
  }
  if (actions.every((action) => action.status === "skipped")) {
    return "skipped";
  }
  if (actions.every((action) => action.status === "failed")) {
    return "failed";
  }
  return "partial";
}

function buildFixtureExecutedActions({ snapshot, actions, afterCTByAction = {} }) {
  const runtimeState = requireObject(snapshot.runtime_state, "snapshot.runtime_state");
  const anchors = Array.isArray(runtimeState.memory_anchors) ? runtimeState.memory_anchors : [];
  let currentCT = clampScore(runtimeState.c_t);
  return actions.map((action) => {
    const beforeCT = currentCT;
    const afterCT = afterCTByAction[action] === undefined ? beforeCT : clampScore(afterCTByAction[action]);
    currentCT = afterCT;
    return {
      action,
      requested_by_plan: true,
      status: "completed",
      target_memory_refs: refsForAction(action, anchors),
      input_content_policy: policyForAction(action),
      raw_content_persisted: false,
      result: {
        before_c_t: beforeCT,
        after_c_t: afterCT,
        summary: summaryForAction(action),
      },
    };
  });
}

function validateProductAdapterEvidence(value, label, sourceSnapshot = null) {
  const evidence = requireObject(value, label);
  for (const field of ["product_provenance", "preflight", "placement_receipt", "post_execution_runtime", "idempotency_replay", "privacy_rollback"]) {
    requireObject(evidence[field], `${label}.${field}`);
  }
  assert.equal(evidence.preflight.loader_verified, true, `${label}.preflight.loader_verified must be true`);
  assert.equal(evidence.preflight.profile_schema_verified, true, `${label}.preflight.profile_schema_verified must be true`);
  assert.equal(evidence.preflight.snapshot_redacted, true, `${label}.preflight.snapshot_redacted must be true`);
  assert.equal(evidence.preflight.model_call_blocked, true, `${label}.preflight.model_call_blocked must be true`);
  assert.equal(evidence.preflight.network_blocked, true, `${label}.preflight.network_blocked must be true`);
  assert.equal(evidence.preflight.raw_log_sinks_disabled, true, `${label}.preflight.raw_log_sinks_disabled must be true`);
  assert.equal(evidence.preflight.rollback_available, true, `${label}.preflight.rollback_available must be true`);
  assert.equal(evidence.idempotency_replay.dedupe_hit, true, `${label}.idempotency_replay.dedupe_hit must be true`);
  assert.equal(evidence.idempotency_replay.side_effect_count, 0, `${label}.idempotency_replay.side_effect_count must be 0`);
  assert.equal(evidence.privacy_rollback.raw_payload_scan_passed, true, `${label}.privacy_rollback.raw_payload_scan_passed must be true`);
  assert.equal(evidence.privacy_rollback.rollback_verified, true, `${label}.privacy_rollback.rollback_verified must be true`);

  if (Object.hasOwn(evidence.placement_receipt, "injected_estimated_tokens")) {
    requireInteger(evidence.placement_receipt.injected_estimated_tokens, `${label}.placement_receipt.injected_estimated_tokens`);
    assert.equal(evidence.placement_receipt.injected_estimated_tokens >= 0, true, `${label}.placement_receipt.injected_estimated_tokens must be non-negative`);
    const maxBudget = sourceSnapshot?.placement_strategy?.max_injected_estimated_tokens;
    if (Number.isFinite(Number(maxBudget))) {
      assert.equal(
        evidence.placement_receipt.injected_estimated_tokens <= Number(maxBudget),
        true,
        `${label}.placement_receipt.injected_estimated_tokens must respect source snapshot placement budget`
      );
    }
  }
  if (Object.hasOwn(evidence.placement_receipt, "max_budget_respected")) {
    assert.equal(evidence.placement_receipt.max_budget_respected, true, `${label}.placement_receipt.max_budget_respected must be true`);
  }
  if (Object.hasOwn(evidence.post_execution_runtime, "final_c_t")) {
    requireScore(evidence.post_execution_runtime.final_c_t, `${label}.post_execution_runtime.final_c_t`);
    assert.equal(
      evidence.post_execution_runtime.final_c_t <= clampScore(sourceSnapshot?.runtime_state?.c_t ?? 1),
      true,
      `${label}.post_execution_runtime.final_c_t must not exceed source snapshot c_t`
    );
  }
  if (Object.hasOwn(evidence.post_execution_runtime, "final_s_t")) {
    requireScore(evidence.post_execution_runtime.final_s_t, `${label}.post_execution_runtime.final_s_t`);
    assert.equal(
      evidence.post_execution_runtime.final_s_t >= clampScore(sourceSnapshot?.runtime_state?.s_t ?? 0),
      true,
      `${label}.post_execution_runtime.final_s_t must not be lower than source snapshot s_t`
    );
  }
  return evidence;
}

export function buildMemoryStabilityCorrectionExecutionEvent({
  snapshot,
  sourceSnapshotPath,
  adapter = "agent-passport-memory-stability-adapter-contract",
  adapterInvocationId,
  actorType = "test_fixture",
  actorId = "agent-passport-memory-stability-contract",
  createdAt = new Date().toISOString(),
  startedAt = createdAt,
  completedAt = createdAt,
  afterCTByAction = {},
  executedActions = null,
  executionStatus = null,
  productAdapterEvidence = null,
  contentPolicy = "hash_only",
  auditNotes = null,
} = {}) {
  requireObject(snapshot, "snapshot");
  const runtimeState = requireObject(snapshot.runtime_state, "snapshot.runtime_state");
  const correctionPlan = requireObject(snapshot.correction_plan, "snapshot.correction_plan");
  const actions = Array.isArray(correctionPlan.actions) && correctionPlan.actions.length ? correctionPlan.actions : ["continue_monitoring"];
  const correctionLevel = runtimeState.correction_level;
  validateActionsForCorrectionLevel(actions, correctionLevel, "snapshot.correction_plan");
  requireEnum(actorType, ALLOWED_ACTOR_TYPES, "actorType");
  requireEnum(contentPolicy, ALLOWED_CONTENT_POLICIES, "contentPolicy");
  if (actorType !== "test_fixture" && !Array.isArray(executedActions)) {
    throw new TypeError("executedActions receipt array is required for non-fixture correction execution events");
  }
  const productEvidence = actorType === "product_adapter" ? validateProductAdapterEvidence(productAdapterEvidence, "productAdapterEvidence", snapshot) : null;
  const executionActions = Array.isArray(executedActions) ? executedActions : buildFixtureExecutedActions({ snapshot, actions, afterCTByAction });
  validateActionsForCorrectionLevel(
    executionActions.map((action) => action?.action),
    correctionLevel,
    "execution"
  );
  const authoritativeStoreMutated = executionActions.some(
    (action) => action?.action === "reload_authoritative_memory_store" && action?.status === "completed"
  );
  const snapshotId = snapshot.snapshot_id;
  requireNonEmptyString(snapshotId, "snapshot.snapshot_id");
  requireNonEmptyString(adapterInvocationId, "adapterInvocationId");
  const status = executionStatus || deriveExecutionStatus(executionActions);

  return {
    schema_version: MEMORY_STABILITY_CORRECTION_EVENT_SCHEMA_VERSION,
    event_type: "correction_action_executed",
    event_id: memoryStabilityCorrectionEventIdFor(snapshotId, adapterInvocationId),
    created_at: createdAt,
    session_id: runtimeState.session_id,
    provider: runtimeState.provider,
    model_name: runtimeState.model_name,
    source_snapshot: {
      path: sourceSnapshotPath,
      snapshot_id: snapshotId,
      source_snapshot_sha256: memoryStabilitySnapshotSha256(snapshot),
      schema_version: MEMORY_STABILITY_SNAPSHOT_SCHEMA_VERSION,
      correction_level: correctionLevel,
      c_t: clampScore(runtimeState.c_t),
      s_t: clampScore(runtimeState.s_t),
    },
    execution: {
      adapter,
      adapter_invocation_id: adapterInvocationId,
      actor_type: actorType,
      actor_id: actorId,
      explicit_execution: true,
      automatic_by_loader: false,
      loader_auto_executed: false,
      model_called: false,
      authoritative_store_mutated: authoritativeStoreMutated,
      status,
      started_at: startedAt,
      completed_at: completedAt,
      actions: executionActions,
      ...(productEvidence || {}),
    },
    audit: {
      event_type: "correction_execution",
      raw_content_persisted: false,
      content_policy: contentPolicy,
      idempotency_key: `${snapshotId}:${adapterInvocationId}`,
      notes:
        auditNotes ||
        (actorType === "test_fixture"
          ? "Test fixture generated a correction execution event from explicit fixture receipts."
          : "Product adapter explicitly executed correction actions from the runtime correction plan."),
    },
  };
}

export function validateMemoryStabilityCorrectionEventSchema(schema, { expectedRedactedDir = DEFAULT_MEMORY_STABILITY_REDACTED_FIXTURES_DIR } = {}) {
  requireObject(schema, "correction event schema");
  assert.equal(schema.$id, "memory-stability-correction-event.schema.json");
  assert.equal(schema.properties?.schema_version?.const, MEMORY_STABILITY_CORRECTION_EVENT_SCHEMA_VERSION);
  assert.equal(schema.properties?.execution?.properties?.explicit_execution?.const, true);
  assert.equal(schema.properties?.execution?.properties?.automatic_by_loader?.const, false);
  assert.equal(schema.properties?.execution?.properties?.loader_auto_executed?.const, false);
  assert.equal(schema.properties?.execution?.properties?.model_called?.const, false);
  assert.equal(schema.properties?.audit?.properties?.raw_content_persisted?.const, false);
  assert.equal(schema.$defs?.ExecutedAction?.properties?.raw_content_persisted?.const, false);
  assert.equal(schema.properties?.source_snapshot?.properties?.path?.pattern, `^${expectedRedactedDir}/[A-Za-z0-9._-]+-runtime-snapshot\\.redacted\\.json$`);
  assert.equal(schema.additionalProperties, false, "correction event schema top-level must reject additional properties");
  for (const field of ["schema_version", "event_type", "event_id", "created_at", "session_id", "provider", "model_name", "source_snapshot", "execution", "audit"]) {
    assert.equal(schema.required?.includes(field), true, `correction event schema missing required field: ${field}`);
  }
  return schema;
}

function buildSourceAnchorHashes(sourceSnapshot, label) {
  const anchors = sourceSnapshot?.runtime_state?.memory_anchors;
  assert.equal(Array.isArray(anchors), true, `${label}.source_snapshot.runtime_state.memory_anchors must be an array`);
  const anchorHashes = new Map();
  for (const [index, anchor] of anchors.entries()) {
    requireNonEmptyString(anchor.memory_id, `${label}.source_snapshot.memory_anchors[${index}].memory_id`);
    requireSha256(anchor.content_sha256, `${label}.source_snapshot.memory_anchors[${index}].content_sha256`);
    anchorHashes.set(anchor.memory_id, anchor.content_sha256);
  }
  return anchorHashes;
}

function validateMemoryRef(ref, index, label, sourceAnchorHashes) {
  requireObject(ref, `${label}.target_memory_refs[${index}]`);
  assertAllowedKeys(ref, ["memory_id", "content_sha256"], `${label}.target_memory_refs[${index}]`);
  requireNonEmptyString(ref.memory_id, `${label}.target_memory_refs[${index}].memory_id`);
  requireSha256(ref.content_sha256, `${label}.target_memory_refs[${index}].content_sha256`);
  assert.equal(sourceAnchorHashes.has(ref.memory_id), true, `${label}.target_memory_refs[${index}] memory_id must exist in source snapshot`);
  assert.equal(ref.content_sha256, sourceAnchorHashes.get(ref.memory_id), `${label}.target_memory_refs[${index}] content_sha256 must match source snapshot`);
}

function validateExecutedAction(action, index, { correctionLevel, sourceAnchorHashes, label }) {
  const actionLabel = `${label}.execution.actions[${index}]`;
  requireObject(action, actionLabel);
  assertAllowedKeys(action, ["action", "requested_by_plan", "status", "target_memory_refs", "input_content_policy", "raw_content_persisted", "result"], actionLabel);
  requireFields(action, ["action", "requested_by_plan", "status", "target_memory_refs", "input_content_policy", "raw_content_persisted", "result"], actionLabel);
  requireEnum(action.action, ALLOWED_ACTIONS_BY_CORRECTION_LEVEL[correctionLevel], `${actionLabel}.action`);
  requireBoolean(action.requested_by_plan, `${actionLabel}.requested_by_plan`);
  requireEnum(action.status, ALLOWED_ACTION_STATUSES, `${actionLabel}.status`);
  assert.equal(Array.isArray(action.target_memory_refs), true, `${actionLabel}.target_memory_refs must be an array`);
  if (memoryStabilityActionRequiresMemoryRefs(action.action)) {
    assert.equal(action.target_memory_refs.length > 0, true, `${actionLabel}.target_memory_refs must not be empty for ${action.action}`);
    assert.equal(action.input_content_policy, "hash_only", `${actionLabel}.input_content_policy must be hash_only`);
  } else {
    assert.equal(action.target_memory_refs.length, 0, `${actionLabel}.target_memory_refs must be empty for ${action.action}`);
  }
  action.target_memory_refs.forEach((ref, refIndex) => validateMemoryRef(ref, refIndex, actionLabel, sourceAnchorHashes));
  assert.equal(["hash_only", "sanitized_summary_only", "none"].includes(action.input_content_policy), true, `${actionLabel}.input_content_policy invalid`);
  assert.equal(action.raw_content_persisted, false, `${actionLabel}.raw_content_persisted must be false`);

  const result = requireObject(action.result, `${actionLabel}.result`);
  assertAllowedKeys(result, ["before_c_t", "after_c_t", "summary"], `${actionLabel}.result`);
  requireScore(result.before_c_t, `${actionLabel}.result.before_c_t`);
  requireScore(result.after_c_t, `${actionLabel}.result.after_c_t`);
  assertSanitizedFreeText(result.summary, `${actionLabel}.result.summary`);
}

export function validateMemoryStabilityCorrectionEvent(event, label, sourceSnapshot) {
  requireObject(event, label);
  assertNoRawPayloadFields(event, label);
  assertAllowedKeys(event, ["schema_version", "event_type", "event_id", "created_at", "session_id", "provider", "model_name", "source_snapshot", "execution", "audit"], label);
  requireFields(event, ["schema_version", "event_type", "event_id", "created_at", "session_id", "provider", "model_name", "source_snapshot", "execution", "audit"], label);
  assert.equal(event.schema_version, MEMORY_STABILITY_CORRECTION_EVENT_SCHEMA_VERSION, `${label}.schema_version mismatch`);
  assert.equal(event.event_type, "correction_action_executed", `${label}.event_type mismatch`);
  requireNonEmptyString(event.created_at, `${label}.created_at`);

  const source = requireObject(event.source_snapshot, `${label}.source_snapshot`);
  assertAllowedKeys(source, ["path", "snapshot_id", "source_snapshot_sha256", "schema_version", "correction_level", "c_t", "s_t"], `${label}.source_snapshot`);
  requireFields(source, ["path", "snapshot_id", "source_snapshot_sha256", "schema_version", "correction_level", "c_t", "s_t"], `${label}.source_snapshot`);
  assert.equal(source.path.startsWith(`${DEFAULT_MEMORY_STABILITY_REDACTED_FIXTURES_DIR}/`), true, `${label}.source_snapshot.path must point to redacted fixtures`);
  assert.equal(source.path.endsWith(".redacted.json"), true, `${label}.source_snapshot.path must point to a redacted snapshot`);
  assert.equal(source.schema_version, MEMORY_STABILITY_SNAPSHOT_SCHEMA_VERSION, `${label}.source_snapshot.schema_version mismatch`);
  assert.equal(source.source_snapshot_sha256, memoryStabilitySnapshotSha256(sourceSnapshot), `${label}.source_snapshot.source_snapshot_sha256 mismatch`);
  assert.equal(source.snapshot_id, sourceSnapshot.snapshot_id, `${label}.source_snapshot.snapshot_id mismatch`);
  assert.equal(source.correction_level, sourceSnapshot.runtime_state.correction_level, `${label}.source_snapshot.correction_level mismatch`);
  assert.equal(source.c_t, sourceSnapshot.runtime_state.c_t, `${label}.source_snapshot.c_t mismatch`);
  assert.equal(source.s_t, sourceSnapshot.runtime_state.s_t, `${label}.source_snapshot.s_t mismatch`);
  assert.equal(sourceSnapshot.privacy?.mode, "redacted", `${label} source snapshot must be redacted`);
  assert.equal(sourceSnapshot.privacy?.raw_content_persisted, false, `${label} source snapshot must not persist raw content`);

  const execution = requireObject(event.execution, `${label}.execution`);
  assertAllowedKeys(
    execution,
    [
      "adapter",
      "adapter_invocation_id",
      "actor_type",
      "actor_id",
      "explicit_execution",
      "automatic_by_loader",
      "loader_auto_executed",
      "model_called",
      "authoritative_store_mutated",
      "status",
      "started_at",
      "completed_at",
      "actions",
      "product_provenance",
      "preflight",
      "placement_receipt",
      "post_execution_runtime",
      "idempotency_replay",
      "privacy_rollback",
    ],
    `${label}.execution`
  );
  requireFields(
    execution,
    [
      "adapter",
      "adapter_invocation_id",
      "actor_type",
      "actor_id",
      "explicit_execution",
      "automatic_by_loader",
      "loader_auto_executed",
      "model_called",
      "authoritative_store_mutated",
      "status",
      "started_at",
      "completed_at",
      "actions",
    ],
    `${label}.execution`
  );
  requireNonEmptyString(execution.adapter, `${label}.execution.adapter`);
  requireNonEmptyString(execution.adapter_invocation_id, `${label}.execution.adapter_invocation_id`);
  requireEnum(execution.actor_type, ALLOWED_ACTOR_TYPES, `${label}.execution.actor_type`);
  requireNonEmptyString(execution.actor_id, `${label}.execution.actor_id`);
  assert.equal(execution.explicit_execution, true, `${label}.execution.explicit_execution must be true`);
  assert.equal(execution.automatic_by_loader, false, `${label}.execution.automatic_by_loader must be false`);
  assert.equal(execution.loader_auto_executed, false, `${label}.execution.loader_auto_executed must be false`);
  assert.equal(execution.model_called, false, `${label}.execution.model_called must be false`);
  requireEnum(execution.status, ALLOWED_EXECUTION_STATUSES, `${label}.execution.status`);
  assert.equal(event.event_id, memoryStabilityCorrectionEventIdFor(source.snapshot_id, execution.adapter_invocation_id), `${label}.event_id mismatch`);
  assert.equal(event.session_id, sourceSnapshot.runtime_state.session_id, `${label}.session_id mismatch`);
  assert.equal(event.provider, sourceSnapshot.runtime_state.provider, `${label}.provider mismatch`);
  assert.equal(event.model_name, sourceSnapshot.runtime_state.model_name, `${label}.model_name mismatch`);

  const sourceAnchorHashes = buildSourceAnchorHashes(sourceSnapshot, label);
  assert.equal(Array.isArray(execution.actions), true, `${label}.execution.actions must be an array`);
  assert.equal(execution.actions.length > 0, true, `${label}.execution.actions must not be empty`);
  validateActionsForCorrectionLevel(
    execution.actions.map((action) => action?.action),
    source.correction_level,
    `${label}.execution`
  );
  assertSameActionSequence(
    execution.actions.map((action) => action.action),
    sourceSnapshot.correction_plan.actions,
    `${label}.execution.actions`
  );
  execution.actions.forEach((action, index) =>
    validateExecutedAction(action, index, {
      correctionLevel: source.correction_level,
      sourceAnchorHashes,
      label,
    })
  );
  assert.equal(execution.status, deriveExecutionStatus(execution.actions), `${label}.execution.status must match action receipt statuses exactly`);
  assert.equal(
    execution.authoritative_store_mutated,
    execution.actions.some((action) => action.action === "reload_authoritative_memory_store" && action.status === "completed"),
    `${label}.execution.authoritative_store_mutated must match completed reload_authoritative_memory_store`
  );
  if (execution.actor_type === "product_adapter") {
    validateProductAdapterEvidence(execution, `${label}.execution`, sourceSnapshot);
  }

  const audit = requireObject(event.audit, `${label}.audit`);
  assertAllowedKeys(audit, ["event_type", "raw_content_persisted", "content_policy", "idempotency_key", "notes"], `${label}.audit`);
  requireFields(audit, ["event_type", "raw_content_persisted", "content_policy", "idempotency_key", "notes"], `${label}.audit`);
  assert.equal(audit.event_type, "correction_execution", `${label}.audit.event_type mismatch`);
  assert.equal(audit.raw_content_persisted, false, `${label}.audit.raw_content_persisted must be false`);
  requireEnum(audit.content_policy, ALLOWED_CONTENT_POLICIES, `${label}.audit.content_policy`);
  assert.equal(audit.idempotency_key, `${source.snapshot_id}:${execution.adapter_invocation_id}`, `${label}.audit.idempotency_key mismatch`);
  assertSanitizedFreeText(audit.notes, `${label}.audit.notes`);
  return event;
}

export async function verifyMemoryStabilityAdapterContract({
  rootDir = DEFAULT_MEMORY_STABILITY_REPO_ROOT,
  correctionEventSchemaPath = DEFAULT_MEMORY_STABILITY_CORRECTION_EVENT_SCHEMA_PATH,
  correctionEventsDir = DEFAULT_MEMORY_STABILITY_CORRECTION_EVENTS_DIR,
  redactedFixturesDir = DEFAULT_MEMORY_STABILITY_REDACTED_FIXTURES_DIR,
} = {}) {
  try {
    const resolvedRootDir = path.resolve(rootDir);
    const baseContract = await loadVerifiedMemoryStabilityContract({
      rootDir: resolvedRootDir,
      redactedFixturesDir,
    });
    const resolvedSchemaPath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, correctionEventSchemaPath);
    const resolvedEventsDir = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, correctionEventsDir);
    const schema = validateMemoryStabilityCorrectionEventSchema(await readJson(resolvedSchemaPath), {
      expectedRedactedDir: redactedFixturesDir,
    });
    const eventFiles = (await readdir(resolvedEventsDir))
      .filter((file) => file.endsWith("-correction-execution-event.json"))
      .sort();
    assert.equal(
      eventFiles.length,
      EXPECTED_MEMORY_STABILITY_CORRECTION_EVENT_LEVELS.size,
      `expected ${EXPECTED_MEMORY_STABILITY_CORRECTION_EVENT_LEVELS.size} correction execution events`
    );

    const checks = [];
    for (const file of eventFiles) {
      const eventPath = path.join(resolvedEventsDir, file);
      const event = await readJson(eventPath);
      const sourceSnapshotPath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, event?.source_snapshot?.path);
      const sourceSnapshot = await readJson(sourceSnapshotPath);
      validateMemoryStabilityCorrectionEvent(event, file, sourceSnapshot);
      const expectedLevel = EXPECTED_MEMORY_STABILITY_CORRECTION_EVENT_LEVELS.get(file);
      if (expectedLevel) {
        assert.equal(event.source_snapshot.correction_level, expectedLevel, `${file} expected correction level ${expectedLevel}`);
      }
      checks.push({
        file: compactMemoryStabilityPath(resolvedRootDir, eventPath),
        sourceSnapshot: event.source_snapshot.path,
        correctionLevel: event.source_snapshot.correction_level,
        actions: event.execution.actions.length,
        explicitExecution: event.execution.explicit_execution,
        automaticByLoader: event.execution.automatic_by_loader,
        loaderAutoExecuted: event.execution.loader_auto_executed,
        modelCalled: event.execution.model_called,
        authoritativeStoreMutated: event.execution.authoritative_store_mutated,
        rawContentPersisted: event.audit.raw_content_persisted,
        sourceSnapshotSha256Verified:
          event.source_snapshot.source_snapshot_sha256 === memoryStabilitySnapshotSha256(sourceSnapshot),
      });
    }

    return {
      ok: true,
      failClosed: true,
      loadedAt: new Date().toISOString(),
      contract: {
        adapterContract: "staged_adapter_contract",
        correctionEventSchemaPath: compactMemoryStabilityPath(resolvedRootDir, resolvedSchemaPath),
        correctionEventsDir: compactMemoryStabilityPath(resolvedRootDir, resolvedEventsDir),
        correctionEvents: checks.length,
        baseContract: baseContract.contract,
      },
      verifierReports: {
        correctionEvents: {
          ok: true,
          schema: compactMemoryStabilityPath(resolvedRootDir, resolvedSchemaPath),
          checks,
        },
        schemas: {
          correctionEventSchemaId: schema.$id,
        },
      },
    };
  } catch (error) {
    if (error instanceof MemoryStabilityAdapterContractError) {
      throw error;
    }
    throw new MemoryStabilityAdapterContractError("Fail-closed memory stability adapter contract verification failed", {
      stage: "adapter_contract_validation",
      cause: error,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

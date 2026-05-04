import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MEMORY_STABILITY_PROFILE_SCHEMA_VERSION = "memory-stability-runtime-profile/v1";
export const MEMORY_STABILITY_SNAPSHOT_SCHEMA_VERSION = "memory-stability-runtime-snapshot/v1";

export const REQUIRED_MEMORY_STABILITY_COVERAGE = Object.freeze([
  "关键记忆探针",
  "在线量化分数",
  "自动纠偏触发",
  "离线画像",
  "动态放置策略",
  "权威记忆刷新",
  "长上下文评测到运行时闭环",
]);

export const REQUIRED_MEMORY_STABILITY_GATES = Object.freeze([
  "一键自检",
  "轻量化预算",
  "高冲突复验",
  "对外证据包",
  "产品接入确认",
  "最终回归",
]);

export const EXPECTED_MEMORY_STABILITY_REDACTED_SNAPSHOT_LEVELS = Object.freeze(
  new Map([
    ["stable-runtime-snapshot.redacted.json", "none"],
    ["medium-risk-runtime-snapshot.redacted.json", "medium"],
    ["strong-risk-runtime-snapshot.redacted.json", "strong"],
  ])
);

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MEMORY_STABILITY_REPO_ROOT = path.resolve(moduleDir, "..", "..");
export const DEFAULT_MEMORY_STABILITY_PROFILE_PATH =
  "contracts/memory-stability/profile/memory-stability-runtime-profile.json";
export const DEFAULT_MEMORY_STABILITY_PROFILE_SCHEMA_PATH =
  "contracts/memory-stability/schemas/memory-stability-runtime-profile.schema.json";
export const DEFAULT_MEMORY_STABILITY_SNAPSHOT_SCHEMA_PATH =
  "contracts/memory-stability/schemas/memory-stability-snapshot.schema.json";
export const DEFAULT_MEMORY_STABILITY_REDACTED_FIXTURES_DIR =
  "tests/fixtures/memory-stability/redacted";

const RAW_PAYLOAD_FIELD_EXCEPTIONS = new Set([
  "content_policy",
  "content_sha256",
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

export class MemoryStabilityContractLoadError extends Error {
  constructor(message, { stage = "unknown", cause = null, detail = "" } = {}) {
    super(message);
    this.name = "MemoryStabilityContractLoadError";
    this.code = "MEMORY_STABILITY_CONTRACT_LOAD_FAILED";
    this.stage = stage;
    this.detail = detail;
    if (cause) {
      this.cause = cause;
    }
  }
}

export function compactMemoryStabilityPath(rootDir, filePath) {
  requireMemoryStabilityPathString(rootDir, "memory stability rootDir");
  requireMemoryStabilityPathString(filePath, "memory stability filePath");
  return path.relative(path.resolve(rootDir), path.resolve(filePath));
}

export function resolveMemoryStabilityPathInsideRoot(rootDir, filePath) {
  requireMemoryStabilityPathString(rootDir, "memory stability rootDir");
  requireMemoryStabilityPathString(filePath, "memory stability filePath");
  const resolvedRootDir = path.resolve(rootDir);
  const resolved = path.resolve(resolvedRootDir, filePath);
  const relative = path.relative(resolvedRootDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new MemoryStabilityContractLoadError(`Refusing to load memory stability file outside root: ${filePath}`, {
      stage: "path_boundary",
    });
  }
  return resolved;
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

function requireMemoryStabilityPathString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MemoryStabilityContractLoadError(`${label} must be a non-empty string`, {
      stage: "path_boundary",
    });
  }
}

function requireNonEmptyArray(value, label) {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  assert.equal(value.length > 0, true, `${label} must not be empty`);
}

function requireNumber(value, label) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.equal(Number.isFinite(value), true, `${label} must be finite`);
}

function requireScore(value, label) {
  requireNumber(value, label);
  assert.equal(value >= 0 && value <= 1, true, `${label} must be within [0, 1]`);
}

function requirePositiveNumber(value, label) {
  requireNumber(value, label);
  assert.equal(value > 0, true, `${label} must be positive`);
}

function requireNonNegativeNumber(value, label) {
  requireNumber(value, label);
  assert.equal(value >= 0, true, `${label} must be non-negative`);
}

function requireSha256(value, label) {
  requireNonEmptyString(value, label);
  assert.match(value, /^[a-f0-9]{64}$/u, `${label} must be sha256 hex`);
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

function validateMemoryStabilityProfileSchema(schema) {
  requireObject(schema, "profile schema");
  assert.equal(schema.$id, "memory-stability-runtime-profile.schema.json");
  assert.equal(schema.properties?.schema_version?.const, MEMORY_STABILITY_PROFILE_SCHEMA_VERSION);
  assert.equal(schema.additionalProperties, false, "profile schema top-level must reject additional properties");
  for (const field of [
    "schema_version",
    "created_at",
    "source_reports",
    "model_profiles",
    "runtime_policy",
    "evidence",
    "core_mechanism_coverage",
    "go_live_gate_mapping",
    "limits",
  ]) {
    assert.equal(schema.required?.includes(field), true, `profile schema missing required field: ${field}`);
  }
  return schema;
}

function validateMemoryStabilitySnapshotSchema(schema, { expectedProfilePath }) {
  requireObject(schema, "snapshot schema");
  assert.equal(schema.$id, "memory-stability-runtime-snapshot.schema.json");
  assert.equal(schema.properties?.schema_version?.const, MEMORY_STABILITY_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(schema.additionalProperties, false, "snapshot schema top-level must reject additional properties");
  assert.equal(schema.properties?.privacy?.properties?.raw_content_persisted?.const, false);
  assert.equal(schema.properties?.source_profile?.properties?.path?.const, expectedProfilePath);
  for (const field of ["schema_version", "created_at", "source_profile", "runtime_state", "correction_plan", "placement_strategy"]) {
    assert.equal(schema.required?.includes(field), true, `snapshot schema missing required field: ${field}`);
  }
  return schema;
}

function validateModelProfiles(modelProfiles) {
  requireNonEmptyArray(modelProfiles, "model_profiles");
  const seen = new Set();
  for (const [index, profile] of modelProfiles.entries()) {
    const label = `model_profiles[${index}]`;
    requireObject(profile, label);
    assertAllowedKeys(profile, ["model_name", "provider", "ccrs", "ecl_085", "pr", "mid_drop", "created_at", "benchmark_meta"], label);
    requireFields(profile, ["model_name", "provider", "ccrs", "ecl_085", "pr", "mid_drop", "created_at", "benchmark_meta"], label);
    requireNonEmptyString(profile.model_name, `${label}.model_name`);
    requireNonEmptyString(profile.provider, `${label}.provider`);
    requireScore(profile.ccrs, `${label}.ccrs`);
    requirePositiveNumber(profile.ecl_085, `${label}.ecl_085`);
    requireScore(profile.pr, `${label}.pr`);
    requireScore(profile.mid_drop, `${label}.mid_drop`);
    requireNonEmptyString(profile.created_at, `${label}.created_at`);

    const key = `${profile.provider}::${profile.model_name}`.toLowerCase();
    assert.equal(seen.has(key), false, `duplicate model profile: ${key}`);
    seen.add(key);

    const meta = requireObject(profile.benchmark_meta, `${label}.benchmark_meta`);
    assertAllowedKeys(meta, ["source", "mode", "total_case_count", "scored_case_count", "execution_failure_rate", "avg_latency_ms", "internal_stability"], `${label}.benchmark_meta`);
    requireFields(meta, ["source", "mode", "total_case_count", "scored_case_count", "execution_failure_rate"], `${label}.benchmark_meta`);
    requireNonEmptyString(meta.source, `${label}.benchmark_meta.source`);
    requireNonEmptyString(meta.mode, `${label}.benchmark_meta.mode`);
    requireNonNegativeNumber(meta.total_case_count, `${label}.benchmark_meta.total_case_count`);
    requireNonNegativeNumber(meta.scored_case_count, `${label}.benchmark_meta.scored_case_count`);
    assert.equal(meta.scored_case_count <= meta.total_case_count, true, `${label}.benchmark_meta.scored_case_count cannot exceed total_case_count`);
    requireScore(meta.execution_failure_rate, `${label}.benchmark_meta.execution_failure_rate`);
  }
}

function validateRuntimePolicy(policy) {
  requireObject(policy, "runtime_policy");
  assertAllowedKeys(
    policy,
    ["online_score_weights", "correction_thresholds", "placement_strategy", "managed_memory_budget", "runtime_loop", "model_specific_notes", "evidence_floor"],
    "runtime_policy"
  );
  requireFields(
    policy,
    ["online_score_weights", "correction_thresholds", "placement_strategy", "managed_memory_budget", "runtime_loop", "model_specific_notes", "evidence_floor"],
    "runtime_policy"
  );

  const weights = requireObject(policy.online_score_weights, "runtime_policy.online_score_weights");
  for (const field of ["alpha_v_t", "beta_context_load", "gamma_position_risk", "delta_conflict_rate"]) {
    requireScore(weights[field], `runtime_policy.online_score_weights.${field}`);
  }
  const weightSum = weights.alpha_v_t + weights.beta_context_load + weights.gamma_position_risk + weights.delta_conflict_rate;
  assert.equal(Math.abs(weightSum - 1) < 0.0001, true, `runtime_policy.online_score_weights must sum to 1, got ${weightSum}`);

  const thresholds = requireObject(policy.correction_thresholds, "runtime_policy.correction_thresholds");
  for (const field of ["tau1_light", "tau2_medium", "tau3_strong"]) {
    requireScore(thresholds[field], `runtime_policy.correction_thresholds.${field}`);
  }
  assert.equal(thresholds.tau1_light < thresholds.tau2_medium, true, "tau1_light must be lower than tau2_medium");
  assert.equal(thresholds.tau2_medium < thresholds.tau3_strong, true, "tau2_medium must be lower than tau3_strong");

  const budget = requireObject(policy.managed_memory_budget, "runtime_policy.managed_memory_budget");
  for (const field of [
    "max_injected_estimated_tokens",
    "observed_high_conflict_max_injected_tokens",
    "observed_high_conflict_provider_prompt_tokens",
    "observed_high_conflict_provider_total_tokens",
    "observed_20m_avg_injected_tokens",
    "observed_20m_avg_provider_prompt_tokens",
    "observed_20m_max_provider_total_tokens",
  ]) {
    requirePositiveNumber(budget[field], `runtime_policy.managed_memory_budget.${field}`);
  }
  requireScore(budget.min_required_compression_rate, "runtime_policy.managed_memory_budget.min_required_compression_rate");
  requireScore(budget.observed_20m_compression_rate, "runtime_policy.managed_memory_budget.observed_20m_compression_rate");
  assert.equal(
    budget.observed_high_conflict_max_injected_tokens <= budget.max_injected_estimated_tokens,
    true,
    "observed_high_conflict_max_injected_tokens must not exceed max_injected_estimated_tokens"
  );

  const runtimeLoop = requireObject(policy.runtime_loop, "runtime_policy.runtime_loop");
  for (const field of ["offline_profile_source", "online_monitor", "correction", "feedback"]) {
    assertSanitizedFreeText(runtimeLoop[field], `runtime_policy.runtime_loop.${field}`);
  }
}

function validateEvidence(evidence) {
  requireObject(evidence, "evidence");
  assertAllowedKeys(evidence, ["engine_stack_128k", "managed_memory_20m", "high_conflict_inspect", "high_conflict_provider"], "evidence");
  requireFields(evidence, ["engine_stack_128k", "managed_memory_20m", "high_conflict_inspect", "high_conflict_provider"], "evidence");
  requirePositiveNumber(evidence.engine_stack_128k?.context_tokens_target, "evidence.engine_stack_128k.context_tokens_target");
  requireScore(evidence.engine_stack_128k?.engine?.score, "evidence.engine_stack_128k.engine.score");
  requireScore(evidence.engine_stack_128k?.engine?.failure_rate, "evidence.engine_stack_128k.engine.failure_rate");
  requirePositiveNumber(evidence.managed_memory_20m?.raw_token_target, "evidence.managed_memory_20m.raw_token_target");
  requireScore(evidence.managed_memory_20m?.pass_rate, "evidence.managed_memory_20m.pass_rate");
  assert.equal(evidence.high_conflict_inspect?.inspect_only, true, "evidence.high_conflict_inspect.inspect_only must be true");
  assert.equal(evidence.high_conflict_provider?.inspect_report_passed, true, "evidence.high_conflict_provider.inspect_report_passed must be true");
}

function validateCoverageAndGates(profile) {
  requireNonEmptyArray(profile.core_mechanism_coverage, "core_mechanism_coverage");
  const coverageItems = new Set(profile.core_mechanism_coverage.map((item) => item.item));
  for (const item of REQUIRED_MEMORY_STABILITY_COVERAGE) {
    assert.equal(coverageItems.has(item), true, `core_mechanism_coverage missing item: ${item}`);
  }

  requireNonEmptyArray(profile.go_live_gate_mapping, "go_live_gate_mapping");
  const gates = new Set(profile.go_live_gate_mapping.map((item) => item.gate));
  for (const gate of REQUIRED_MEMORY_STABILITY_GATES) {
    assert.equal(gates.has(gate), true, `go_live_gate_mapping missing gate: ${gate}`);
  }
}

function validateLimits(limits) {
  requireObject(limits, "limits");
  requireNonEmptyArray(limits.not_a_claim, "limits.not_a_claim");
  const text = limits.not_a_claim.join("\n").toLowerCase();
  for (const phrase of ["20000k", "execution failures", "synthetic benchmark data"]) {
    assert.equal(text.includes(phrase.toLowerCase()), true, `limits.not_a_claim should include anti-overclaim phrase: ${phrase}`);
  }
}

export async function validateMemoryStabilityRuntimeProfile(profile) {
  requireObject(profile, "profile");
  assertNoRawPayloadFields(profile, "profile");
  assertAllowedKeys(profile, ["schema_version", "created_at", "source_reports", "model_profiles", "runtime_policy", "evidence", "core_mechanism_coverage", "go_live_gate_mapping", "limits"], "profile");
  requireFields(profile, ["schema_version", "created_at", "source_reports", "model_profiles", "runtime_policy", "evidence", "core_mechanism_coverage", "go_live_gate_mapping", "limits"], "profile");
  assert.equal(profile.schema_version, MEMORY_STABILITY_PROFILE_SCHEMA_VERSION);
  requireNonEmptyString(profile.created_at, "profile.created_at");
  requireNonEmptyArray(profile.source_reports, "profile.source_reports");
  profile.source_reports.forEach((entry, index) => requireNonEmptyString(entry, `profile.source_reports[${index}]`));
  validateModelProfiles(profile.model_profiles);
  validateRuntimePolicy(profile.runtime_policy);
  validateEvidence(profile.evidence);
  validateCoverageAndGates(profile);
  validateLimits(profile.limits);
  return profile;
}

function validateMemoryAnchor(anchor, index, file) {
  const label = `${file}.runtime_state.memory_anchors[${index}]`;
  requireObject(anchor, label);
  assertAllowedKeys(
    anchor,
    [
      "memory_id",
      "content",
      "importance_weight",
      "source",
      "inserted_position",
      "last_verified_at",
      "last_verified_ok",
      "conflict",
      "authoritative",
      "content_redaction",
      "sensitivity",
      "content_sha256",
      "content_length",
      "content_redacted",
    ],
    label
  );
  requireNonEmptyString(anchor.memory_id, `${label}.memory_id`);
  requireNonEmptyString(anchor.content, `${label}.content`);
  assert.match(anchor.content, /^\[redacted:[a-f0-9]{12}\]$/u, `${label}.content must be a redacted marker`);
  requireNonNegativeNumber(anchor.importance_weight, `${label}.importance_weight`);
  assert.equal(["string", "number"].includes(typeof anchor.inserted_position), true, `${label}.inserted_position must be string or number`);
  assert.equal(anchor.last_verified_ok === null || typeof anchor.last_verified_ok === "boolean", true, `${label}.last_verified_ok must be boolean or null`);
  assert.equal(typeof anchor.conflict, "boolean", `${label}.conflict must be boolean`);
  assert.equal(typeof anchor.authoritative, "boolean", `${label}.authoritative must be boolean`);
  assert.equal(anchor.content_redaction, "hash_only", `${label}.content_redaction must be hash_only`);
  assert.equal(anchor.content_redacted, true, `${label}.content_redacted must be true`);
  requireSha256(anchor.content_sha256, `${label}.content_sha256`);
}

export function validateMemoryStabilityRedactedSnapshot(snapshot, file, { runtimeProfile, expectedProfilePath }) {
  requireObject(snapshot, file);
  assertAllowedKeys(snapshot, ["schema_version", "snapshot_id", "description", "created_at", "source_profile", "model_profile", "runtime_state", "correction_plan", "placement_strategy", "privacy"], file);
  requireFields(snapshot, ["schema_version", "created_at", "source_profile", "runtime_state", "correction_plan", "placement_strategy", "privacy"], file);
  assert.equal(snapshot.schema_version, MEMORY_STABILITY_SNAPSHOT_SCHEMA_VERSION, `${file}.schema_version mismatch`);
  if (snapshot.description) {
    assertSanitizedFreeText(snapshot.description, `${file}.description`);
  }

  const privacy = requireObject(snapshot.privacy, `${file}.privacy`);
  assert.equal(privacy.mode, "redacted", `${file}.privacy.mode must be redacted`);
  assert.equal(privacy.raw_content_persisted, false, `${file}.privacy.raw_content_persisted must be false`);

  const sourceProfile = requireObject(snapshot.source_profile, `${file}.source_profile`);
  assert.equal(sourceProfile.path, expectedProfilePath, `${file}.source_profile.path mismatch`);
  assert.equal(sourceProfile.schema_version, runtimeProfile.schema_version, `${file}.source_profile.schema_version mismatch`);
  assert.equal(sourceProfile.created_at, runtimeProfile.created_at, `${file}.source_profile.created_at mismatch`);
  assert.equal(sourceProfile.model_profile_count, runtimeProfile.model_profiles.length, `${file}.source_profile.model_profile_count mismatch`);

  const runtimeState = requireObject(snapshot.runtime_state, `${file}.runtime_state`);
  for (const score of ["v_t", "l_t", "m_t", "r_pos_t", "x_t", "s_t", "c_t"]) {
    requireScore(runtimeState[score], `${file}.runtime_state.${score}`);
  }
  assert.equal(["none", "light", "medium", "strong"].includes(runtimeState.correction_level), true, `${file}.runtime_state.correction_level invalid`);
  requireNonNegativeNumber(runtimeState.ctx_tokens, `${file}.runtime_state.ctx_tokens`);
  requireNonNegativeNumber(runtimeState.checked_memories, `${file}.runtime_state.checked_memories`);
  requireNonNegativeNumber(runtimeState.conflict_memories, `${file}.runtime_state.conflict_memories`);
  assert.equal(runtimeState.conflict_memories <= runtimeState.checked_memories, true, `${file}.runtime_state conflict_memories cannot exceed checked_memories`);
  requireNonEmptyArray(runtimeState.memory_anchors, `${file}.runtime_state.memory_anchors`);
  assert.equal(runtimeState.checked_memories <= runtimeState.memory_anchors.length, true, `${file}.runtime_state checked_memories cannot exceed memory_anchors.length`);
  runtimeState.memory_anchors.forEach((anchor, index) => validateMemoryAnchor(anchor, index, file));

  const correctionPlan = requireObject(snapshot.correction_plan, `${file}.correction_plan`);
  assert.equal(correctionPlan.level, runtimeState.correction_level, `${file}.correction_plan.level must match runtime state`);
  requireNonEmptyArray(correctionPlan.actions, `${file}.correction_plan.actions`);
  const expectedLevel = EXPECTED_MEMORY_STABILITY_REDACTED_SNAPSHOT_LEVELS.get(file);
  if (expectedLevel) {
    assert.equal(runtimeState.correction_level, expectedLevel, `${file} expected correction level ${expectedLevel}`);
  }
  if (runtimeState.correction_level === "medium") {
    assert.equal(correctionPlan.actions.includes("rewrite_working_memory_summary"), true, `${file} medium snapshot should rewrite working memory summary`);
  }
  if (runtimeState.correction_level === "strong") {
    assert.equal(correctionPlan.actions.includes("reload_authoritative_memory_store"), true, `${file} strong snapshot should reload authoritative memory`);
    assert.equal(correctionPlan.actions.includes("resolve_conflicts_and_refresh_runtime_state"), true, `${file} strong snapshot should resolve conflicts`);
  }
  return snapshot;
}

export async function loadVerifiedMemoryStabilityContract({
  rootDir = DEFAULT_MEMORY_STABILITY_REPO_ROOT,
  profilePath = DEFAULT_MEMORY_STABILITY_PROFILE_PATH,
  profileSchemaPath = DEFAULT_MEMORY_STABILITY_PROFILE_SCHEMA_PATH,
  snapshotSchemaPath = DEFAULT_MEMORY_STABILITY_SNAPSHOT_SCHEMA_PATH,
  redactedFixturesDir = DEFAULT_MEMORY_STABILITY_REDACTED_FIXTURES_DIR,
} = {}) {
  requireMemoryStabilityPathString(rootDir, "memory stability rootDir");
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedProfilePath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, profilePath);
  const resolvedProfileSchemaPath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, profileSchemaPath);
  const resolvedSnapshotSchemaPath = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, snapshotSchemaPath);
  const resolvedRedactedFixturesDir = resolveMemoryStabilityPathInsideRoot(resolvedRootDir, redactedFixturesDir);
  const compactProfilePath = compactMemoryStabilityPath(resolvedRootDir, resolvedProfilePath);

  try {
    const profileSchema = validateMemoryStabilityProfileSchema(await readJson(resolvedProfileSchemaPath));
    const snapshotSchema = validateMemoryStabilitySnapshotSchema(await readJson(resolvedSnapshotSchemaPath), {
      expectedProfilePath: compactProfilePath,
    });
    const profile = await validateMemoryStabilityRuntimeProfile(await readJson(resolvedProfilePath));
    const redactedFiles = (await readdir(resolvedRedactedFixturesDir))
      .filter((file) => file.endsWith("-runtime-snapshot.redacted.json"))
      .sort();
    assert.equal(
      redactedFiles.length,
      EXPECTED_MEMORY_STABILITY_REDACTED_SNAPSHOT_LEVELS.size,
      `expected ${EXPECTED_MEMORY_STABILITY_REDACTED_SNAPSHOT_LEVELS.size} redacted runtime snapshots`
    );

    const redactedSnapshots = [];
    for (const file of redactedFiles) {
      const snapshotPath = path.join(resolvedRedactedFixturesDir, file);
      const snapshot = validateMemoryStabilityRedactedSnapshot(await readJson(snapshotPath), file, {
        runtimeProfile: profile,
        expectedProfilePath: compactProfilePath,
      });
      redactedSnapshots.push({
        file: compactMemoryStabilityPath(resolvedRootDir, snapshotPath),
        correctionLevel: snapshot.runtime_state.correction_level,
        cT: snapshot.runtime_state.c_t,
        sT: snapshot.runtime_state.s_t,
        anchorCount: snapshot.runtime_state.memory_anchors.length,
        rawContentPersisted: snapshot.privacy.raw_content_persisted,
      });
    }

    return {
      ok: true,
      failClosed: true,
      loadedAt: new Date().toISOString(),
      rootDir: resolvedRootDir,
      profile,
      contract: {
        profilePath: compactProfilePath,
        profileSchemaPath: compactMemoryStabilityPath(resolvedRootDir, resolvedProfileSchemaPath),
        snapshotSchemaPath: compactMemoryStabilityPath(resolvedRootDir, resolvedSnapshotSchemaPath),
        redactedFixturesDir: compactMemoryStabilityPath(resolvedRootDir, resolvedRedactedFixturesDir),
        modelProfiles: profile.model_profiles.length,
        coreMechanisms: profile.core_mechanism_coverage.length,
        goLiveGates: profile.go_live_gate_mapping.length,
        redactedSnapshots: redactedSnapshots.length,
        correctionThresholds: profile.runtime_policy.correction_thresholds,
      },
      verifierReports: {
        profile: {
          ok: true,
          schema: compactMemoryStabilityPath(resolvedRootDir, resolvedProfileSchemaPath),
          profile: compactProfilePath,
          modelProfiles: profile.model_profiles.length,
          coreMechanisms: profile.core_mechanism_coverage.length,
          goLiveGates: profile.go_live_gate_mapping.length,
        },
        snapshots: {
          ok: true,
          schema: compactMemoryStabilityPath(resolvedRootDir, resolvedSnapshotSchemaPath),
          redactedChecks: redactedSnapshots,
        },
        schemas: {
          profileSchemaId: profileSchema.$id,
          snapshotSchemaId: snapshotSchema.$id,
        },
      },
    };
  } catch (error) {
    if (error instanceof MemoryStabilityContractLoadError) {
      throw error;
    }
    throw new MemoryStabilityContractLoadError("Fail-closed memory stability contract verification failed", {
      stage: "contract_validation",
      cause: error,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function loadVerifiedMemoryStabilityProfile(options = {}) {
  const contract = await loadVerifiedMemoryStabilityContract(options);
  return contract.profile;
}

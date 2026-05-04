import crypto from "node:crypto";

import {
  getMemoryStabilityCorrectionActions,
  MEMORY_STABILITY_PLACEMENT_ACTION_VALUES,
  normalizeMemoryStabilityCorrectionLevel,
} from "./action-vocabulary.js";

export const MEMORY_STABILITY_ENGINE_MODE = "memory-stability-engine/v1";

export const DEFAULT_MEMORY_STABILITY_SCORE_WEIGHTS = Object.freeze({
  alpha_v_t: 0.4,
  beta_context_load: 0.25,
  gamma_position_risk: 0.2,
  delta_conflict_rate: 0.15,
});

export const DEFAULT_MEMORY_STABILITY_CORRECTION_THRESHOLDS = Object.freeze({
  tau1_light: 0.2,
  tau2_medium: 0.35,
  tau3_strong: 0.5,
});

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

class MemoryStabilityEngineError extends Error {
  constructor(message, { code = "memory_stability_engine_error", stage = "compute" } = {}) {
    super(message);
    this.name = "MemoryStabilityEngineError";
    this.code = code;
    this.stage = stage;
  }
}

function buildNoEffectReport() {
  return {
    modelCalled: false,
    networkCalled: false,
    ledgerWritten: false,
    storeWritten: false,
    promptMutated: false,
    correctionExecuted: false,
  };
}

function safeError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    code: error?.code ?? "memory_stability_engine_error",
    stage: error?.stage ?? "compute",
  };
}

function roundScore(value) {
  return Math.round(clamp01(value) * 10000) / 10000;
}

function nonEmptyString(value, fallback = null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(1, number));
}

export function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function hashMemoryStabilityContent(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function redactedMemoryStabilityMarker(contentSha256) {
  const hash = SHA256_HEX_PATTERN.test(String(contentSha256 || "")) ? String(contentSha256) : hashMemoryStabilityContent("");
  return `[redacted:${hash.slice(0, 12)}]`;
}

export function findMemoryStabilityModelProfile(runtimeProfile, { provider = null, modelName = null } = {}) {
  const profiles = Array.isArray(runtimeProfile?.model_profiles) ? runtimeProfile.model_profiles : [];
  const normalizedProvider = nonEmptyString(provider, "")?.toLowerCase() ?? "";
  const normalizedModel = nonEmptyString(modelName, "")?.toLowerCase() ?? "";

  if (!normalizedModel) {
    throw new MemoryStabilityEngineError("Memory stability model_name is required.", {
      code: "memory_stability_model_name_required",
      stage: "model_profile_lookup",
    });
  }

  const profile = profiles.find((candidate) => {
    const candidateProvider = nonEmptyString(candidate?.provider, "")?.toLowerCase() ?? "";
    const candidateModel = nonEmptyString(candidate?.model_name, "")?.toLowerCase() ?? "";
    if (normalizedProvider) {
      return candidateProvider === normalizedProvider && candidateModel === normalizedModel;
    }
    return candidateModel === normalizedModel;
  });

  if (!profile) {
    throw new MemoryStabilityEngineError(
      `Memory stability model profile not found for provider=${provider || "unspecified"} model=${modelName || "unspecified"}.`,
      {
        code: "memory_stability_model_profile_not_found",
        stage: "model_profile_lookup",
      }
    );
  }

  return {
    provider: nonEmptyString(profile.provider, normalizedProvider || "unknown"),
    model_name: nonEmptyString(profile.model_name, modelName),
    ccrs: roundScore(toFiniteNumber(profile.ccrs, 1)),
    ecl_085: Math.max(1, Math.floor(toFiniteNumber(profile.ecl_085 ?? profile.ecl085, 8192))),
    pr: roundScore(toFiniteNumber(profile.pr, 1)),
    mid_drop: roundScore(toFiniteNumber(profile.mid_drop ?? profile.midDrop, 0)),
  };
}

export function normalizeMemoryStabilityPositionBand(insertedPosition) {
  if (typeof insertedPosition === "number") {
    if (insertedPosition < 0.33) {
      return "front";
    }
    if (insertedPosition <= 0.66) {
      return "middle";
    }
    return "tail";
  }
  const normalized = nonEmptyString(insertedPosition, "middle").toLowerCase();
  if (["front", "head", "beginning", "start"].includes(normalized)) {
    return "front";
  }
  if (["tail", "back", "end", "near_end", "prompt_end"].includes(normalized)) {
    return "tail";
  }
  return "middle";
}

export function normalizeMemoryStabilityAnchor(anchor = {}, index = 0, { defaultSource = "agent-passport" } = {}) {
  const memoryId = nonEmptyString(anchor.memory_id ?? anchor.memoryId, `memory-${index + 1}`);
  const rawContent = typeof anchor.content === "string" ? anchor.content : null;
  const providedHash = nonEmptyString(anchor.content_sha256 ?? anchor.contentSha256, null);
  const contentSha256 = SHA256_HEX_PATTERN.test(providedHash || "")
    ? providedHash
    : hashMemoryStabilityContent(rawContent ?? memoryId);
  const lastVerifiedOk =
    typeof anchor.last_verified_ok === "boolean"
      ? anchor.last_verified_ok
      : typeof anchor.lastVerifiedOk === "boolean"
        ? anchor.lastVerifiedOk
        : null;
  const conflict = Boolean(anchor.conflict ?? anchor.hasConflict ?? anchor.conflictState?.hasConflict ?? lastVerifiedOk === false);
  const importance = Math.max(0, toFiniteNumber(anchor.importance_weight ?? anchor.importanceWeight, 1));
  const authorityRank = toFiniteNumber(anchor.authorityRank ?? anchor.authority_rank, null);
  const authoritative =
    typeof anchor.authoritative === "boolean" ? anchor.authoritative : authorityRank !== null && authorityRank >= 0.75;

  return {
    memory_id: memoryId,
    content: redactedMemoryStabilityMarker(contentSha256),
    importance_weight: importance,
    source: nonEmptyString(anchor.source, defaultSource),
    inserted_position: normalizeMemoryStabilityPositionBand(anchor.inserted_position ?? anchor.insertedPosition),
    last_verified_at: nonEmptyString(anchor.last_verified_at ?? anchor.lastVerifiedAt, null),
    last_verified_ok: lastVerifiedOk,
    conflict,
    authoritative,
    content_redaction: "hash_only",
    sensitivity: nonEmptyString(anchor.sensitivity, "internal"),
    content_sha256: contentSha256,
    content_length: Math.max(0, Math.floor(toFiniteNumber(anchor.content_length ?? anchor.contentLength, rawContent?.length ?? 0))),
    content_redacted: true,
  };
}

export function computeMemoryStabilityVerificationScore(memoryAnchors = []) {
  const checked = memoryAnchors.filter((anchor) => typeof anchor.last_verified_ok === "boolean");
  if (checked.length === 0) {
    return memoryAnchors.length > 0 ? 0 : 1;
  }
  const totalWeight = checked.reduce((sum, anchor) => sum + Math.max(0, toFiniteNumber(anchor.importance_weight, 0)), 0);
  if (totalWeight <= 0) {
    return 0;
  }
  const okWeight = checked
    .filter((anchor) => anchor.last_verified_ok)
    .reduce((sum, anchor) => sum + Math.max(0, toFiniteNumber(anchor.importance_weight, 0)), 0);
  return roundScore(okWeight / totalWeight);
}

export function computeMemoryStabilityMiddleMemoryRatio(memoryAnchors = []) {
  if (memoryAnchors.length === 0) {
    return 0;
  }
  return roundScore(
    memoryAnchors.filter((anchor) => normalizeMemoryStabilityPositionBand(anchor.inserted_position) === "middle").length /
      memoryAnchors.length
  );
}

export function computeMemoryStabilityConflictRate({ checkedMemories = null, conflictMemories = null, memoryAnchors = [] } = {}) {
  const checked = toFiniteNumber(checkedMemories, null);
  const conflicts = toFiniteNumber(conflictMemories, null);
  if (checked !== null && checked > 0 && conflicts !== null) {
    const maxChecked = memoryAnchors.length > 0 ? memoryAnchors.length : checked;
    const checkedCount = Math.min(maxChecked, Math.max(0, Math.floor(checked)));
    const conflictCount = Math.min(checkedCount, Math.max(0, Math.floor(conflicts)));
    return checkedCount > 0 ? roundScore(conflictCount / checkedCount) : 0;
  }
  if (memoryAnchors.length === 0) {
    return 0;
  }
  return roundScore(memoryAnchors.filter((anchor) => anchor.conflict).length / memoryAnchors.length);
}

export function computeMemoryStabilityCorrectionLevel(
  collapseRisk,
  thresholds = DEFAULT_MEMORY_STABILITY_CORRECTION_THRESHOLDS
) {
  const risk = clamp01(collapseRisk);
  if (risk > toFiniteNumber(thresholds.tau3_strong, DEFAULT_MEMORY_STABILITY_CORRECTION_THRESHOLDS.tau3_strong)) {
    return "strong";
  }
  if (risk > toFiniteNumber(thresholds.tau2_medium, DEFAULT_MEMORY_STABILITY_CORRECTION_THRESHOLDS.tau2_medium)) {
    return "medium";
  }
  if (risk > toFiniteNumber(thresholds.tau1_light, DEFAULT_MEMORY_STABILITY_CORRECTION_THRESHOLDS.tau1_light)) {
    return "light";
  }
  return "none";
}

export function buildMemoryStabilityCorrectionPlan({ correctionLevel = null, runtimeState = null } = {}) {
  const level = normalizeMemoryStabilityCorrectionLevel(correctionLevel ?? runtimeState?.correction_level);
  const actions = getMemoryStabilityCorrectionActions(level);
  return {
    level,
    actions,
    reason: {
      c_t: roundScore(runtimeState?.c_t ?? 0),
      s_t: roundScore(runtimeState?.s_t ?? 1),
      v_t: roundScore(runtimeState?.v_t ?? 1),
      l_t: roundScore(runtimeState?.l_t ?? 0),
      r_pos_t: roundScore(runtimeState?.r_pos_t ?? 0),
      x_t: roundScore(runtimeState?.x_t ?? 0),
    },
  };
}

function addKnownPlacementAction(actions, action) {
  if (MEMORY_STABILITY_PLACEMENT_ACTION_VALUES.includes(action)) {
    actions.push(action);
  }
}

export function buildMemoryStabilityPlacementStrategy({ modelProfile = {}, runtimeProfile = {}, runtimeState = {} } = {}) {
  const policy = runtimeProfile?.runtime_policy?.placement_strategy || {};
  const budget = runtimeProfile?.runtime_policy?.managed_memory_budget || {};
  const notes = Array.isArray(runtimeProfile?.runtime_policy?.model_specific_notes)
    ? runtimeProfile.runtime_policy.model_specific_notes
    : [];
  const note =
    notes.find((entry) => entry?.provider === modelProfile.provider && entry?.model_name === modelProfile.model_name) ||
    notes.find((entry) => entry?.model_name === modelProfile.model_name) ||
    null;
  const actions = [];

  if (toFiniteNumber(modelProfile.mid_drop, 0) > toFiniteNumber(policy.if_mid_drop_above, 0.1)) {
    addKnownPlacementAction(actions, "avoid_middle_placement");
  }
  if (toFiniteNumber(modelProfile.pr, 1) < toFiniteNumber(policy.if_position_robustness_below, 0.85)) {
    addKnownPlacementAction(actions, "increase_reorder_frequency");
  }
  if (toFiniteNumber(runtimeState.l_t, 0) > toFiniteNumber(policy.if_context_load_above, 0.85)) {
    addKnownPlacementAction(actions, "compress_before_next_turn");
  }
  if (toFiniteNumber(modelProfile.ccrs, 1) < toFiniteNumber(policy.if_ccrs_below, 0.85)) {
    addKnownPlacementAction(actions, "reduce_memory_density");
  }
  if (note?.placement_hint) {
    addKnownPlacementAction(actions, note.placement_hint);
  }
  if (actions.length === 0) {
    actions.push("standard_reanchor_policy");
  }

  return {
    actions: [...new Set(actions)],
    max_injected_estimated_tokens: Math.max(1, Math.floor(toFiniteNumber(budget.max_injected_estimated_tokens, 9000))),
    model_hint: note?.placement_hint || "standard_reanchor_policy",
  };
}

function computeRuntimeStateStrict({
  runtimeProfile,
  sessionId = "session",
  provider = null,
  modelName = null,
  ctxTokens = 0,
  memoryAnchors = [],
  checkedMemories = null,
  conflictMemories = null,
  now = new Date().toISOString(),
  defaultSource = "agent-passport",
} = {}) {
  const modelProfile = findMemoryStabilityModelProfile(runtimeProfile, { provider, modelName });
  const anchors = (Array.isArray(memoryAnchors) ? memoryAnchors : []).map((anchor, index) =>
    normalizeMemoryStabilityAnchor(anchor, index, { defaultSource })
  );
  if (anchors.length === 0) {
    throw new MemoryStabilityEngineError("Memory stability runtime state requires at least one memory anchor.", {
      code: "memory_stability_memory_anchors_empty",
      stage: "runtime_state",
    });
  }

  const weights = {
    ...DEFAULT_MEMORY_STABILITY_SCORE_WEIGHTS,
    ...(runtimeProfile?.runtime_policy?.online_score_weights || {}),
  };
  const thresholds = {
    ...DEFAULT_MEMORY_STABILITY_CORRECTION_THRESHOLDS,
    ...(runtimeProfile?.runtime_policy?.correction_thresholds || {}),
  };
  const ecl085 = Math.max(1, toFiniteNumber(modelProfile.ecl_085, 8192));
  const vT = computeMemoryStabilityVerificationScore(anchors);
  const lT = roundScore(toFiniteNumber(ctxTokens, 0) / ecl085);
  const mT = computeMemoryStabilityMiddleMemoryRatio(anchors);
  const rPosT = roundScore(toFiniteNumber(modelProfile.mid_drop, 0) * mT);
  const checkedCount = Math.min(
    anchors.length,
    Math.max(0, Math.floor(toFiniteNumber(checkedMemories, anchors.filter((anchor) => typeof anchor.last_verified_ok === "boolean").length)))
  );
  const conflictCount = Math.min(
    checkedCount,
    Math.max(0, Math.floor(toFiniteNumber(conflictMemories, anchors.filter((anchor) => anchor.conflict).length)))
  );
  const xT = computeMemoryStabilityConflictRate({ checkedMemories: checkedCount, conflictMemories: conflictCount, memoryAnchors: anchors });
  const sT = roundScore(
    toFiniteNumber(weights.alpha_v_t, DEFAULT_MEMORY_STABILITY_SCORE_WEIGHTS.alpha_v_t) * vT +
      toFiniteNumber(weights.beta_context_load, DEFAULT_MEMORY_STABILITY_SCORE_WEIGHTS.beta_context_load) * (1 - lT) +
      toFiniteNumber(weights.gamma_position_risk, DEFAULT_MEMORY_STABILITY_SCORE_WEIGHTS.gamma_position_risk) * (1 - rPosT) +
      toFiniteNumber(weights.delta_conflict_rate, DEFAULT_MEMORY_STABILITY_SCORE_WEIGHTS.delta_conflict_rate) * (1 - xT)
  );
  const cT = roundScore(1 - sT);
  const correctionLevel = computeMemoryStabilityCorrectionLevel(cT, thresholds);
  const runtimeState = {
    session_id: nonEmptyString(sessionId, "session"),
    provider: modelProfile.provider,
    model_name: modelProfile.model_name,
    ctx_tokens: Math.max(0, toFiniteNumber(ctxTokens, 0)),
    memory_anchors: anchors,
    checked_memories: checkedCount,
    conflict_memories: conflictCount,
    v_t: vT,
    l_t: lT,
    m_t: mT,
    r_pos_t: rPosT,
    x_t: xT,
    s_t: sT,
    c_t: cT,
    correction_level: correctionLevel,
    computed_at: nonEmptyString(now, new Date().toISOString()),
  };

  return {
    modelProfile,
    runtimeState,
    correctionPlan: buildMemoryStabilityCorrectionPlan({ correctionLevel, runtimeState }),
    placementStrategy: buildMemoryStabilityPlacementStrategy({ modelProfile, runtimeProfile, runtimeState }),
  };
}

export function computeMemoryStabilityRuntimeState(options = {}) {
  try {
    const result = computeRuntimeStateStrict(options);
    return {
      ok: true,
      status: "ready",
      mode: MEMORY_STABILITY_ENGINE_MODE,
      failClosed: true,
      effects: buildNoEffectReport(),
      model_profile: result.modelProfile,
      runtime_state: result.runtimeState,
      correction_plan: result.correctionPlan,
      placement_strategy: result.placementStrategy,
      privacy: {
        mode: "redacted",
        anchor_content_policy: "hash_only",
        raw_content_persisted: false,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      mode: MEMORY_STABILITY_ENGINE_MODE,
      failClosed: true,
      effects: buildNoEffectReport(),
      error: safeError(error),
    };
  }
}

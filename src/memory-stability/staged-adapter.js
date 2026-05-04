import crypto from "node:crypto";

import { computeMemoryStabilityRuntimeState } from "./engine.js";
import {
  DEFAULT_MEMORY_STABILITY_PROFILE_PATH,
  loadVerifiedMemoryStabilityContract,
  MEMORY_STABILITY_PROFILE_SCHEMA_VERSION,
  MEMORY_STABILITY_SNAPSHOT_SCHEMA_VERSION,
  validateMemoryStabilityRedactedSnapshot,
} from "./contract-loader.js";

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
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

function nonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function clampScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, Math.round(number * 10000) / 10000));
}

function inferProvider({ provider = null, modelName = null, profile = null, contractProfile = null } = {}) {
  const explicit = nonEmptyString(provider, null) || nonEmptyString(profile?.provider, null);
  if (explicit) {
    return explicit;
  }
  const normalizedModelName = nonEmptyString(modelName, null);
  const exactContractMatch = Array.isArray(contractProfile?.model_profiles)
    ? contractProfile.model_profiles.find((candidate) => candidate?.model_name === normalizedModelName)
    : null;
  if (exactContractMatch?.provider) {
    return exactContractMatch.provider;
  }
  const model = nonEmptyString(modelName, "");
  if (model.startsWith("agent-passport-local") || model.includes("本地推理")) {
    return "agent-passport-local";
  }
  if (model.includes(":")) {
    return model.split(":").slice(0, -1).join(":") || "agent-passport-local";
  }
  if (model.startsWith("deepseek")) {
    return "deepseek";
  }
  return "agent-passport-local";
}

function normalizeLegacyModelProfile(profile, { provider, modelName, createdAt } = {}) {
  const source = profile && typeof profile === "object" ? profile : {};
  return {
    provider,
    model_name: modelName,
    ccrs: clampScore(source.ccrs, 1),
    ecl_085: Math.max(1, Math.floor(Number(source.ecl_085 ?? source.ecl085 ?? 8192) || 8192)),
    pr: clampScore(source.pr, 1),
    mid_drop: clampScore(source.mid_drop ?? source.midDrop, 0),
    created_at: nonEmptyString(source.created_at ?? source.createdAt, createdAt),
  };
}

function ensureEngineRuntimeProfile(contractProfile, { provider, modelName, runtimeState, createdAt }) {
  const matched = Array.isArray(contractProfile?.model_profiles)
    ? contractProfile.model_profiles.find(
        (profile) => profile?.provider === provider && profile?.model_name === modelName
      )
    : null;
  if (matched) {
    return contractProfile;
  }
  const fallbackProfile = normalizeLegacyModelProfile(runtimeState?.profile, {
    provider,
    modelName,
    createdAt,
  });
  return {
    ...contractProfile,
    model_profiles: [...(Array.isArray(contractProfile?.model_profiles) ? contractProfile.model_profiles : []), fallbackProfile],
  };
}

function toArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function inferModelName(runtimeState, contractProfile) {
  return (
    nonEmptyString(runtimeState?.modelName ?? runtimeState?.model_name, null) ||
    nonEmptyString(runtimeState?.profile?.model_name ?? runtimeState?.profile?.modelName, null) ||
    nonEmptyString(contractProfile?.model_profiles?.[0]?.model_name, "agent-passport-local-reasoner")
  );
}

function summarizeCorrectionLevel(level) {
  if (level === "light") {
    return "memory collapse risk rising: light correction";
  }
  if (level === "medium") {
    return "memory collapse risk elevated: moderate correction";
  }
  if (level === "strong") {
    return "memory collapse risk high: strong correction";
  }
  return "memory stability healthy";
}

function buildEngineSnapshotSource({
  runtimeState,
  contractProfile,
  provider,
  createdAt,
}) {
  const modelName = inferModelName(runtimeState, contractProfile);
  const inferredProvider = inferProvider({
    provider,
    modelName,
    profile: runtimeState?.profile,
    contractProfile,
  });
  const engineRuntimeProfile = ensureEngineRuntimeProfile(contractProfile, {
    provider: inferredProvider,
    modelName,
    runtimeState,
    createdAt,
  });
  return {
    provider: inferredProvider,
    modelName,
    engineRuntimeProfile,
    engineInput: {
      runtimeProfile: engineRuntimeProfile,
      sessionId: nonEmptyString(runtimeState?.sessionId ?? runtimeState?.session_id, "session"),
      provider: inferredProvider,
      modelName,
      ctxTokens: Math.max(0, Number(runtimeState?.ctxTokens ?? runtimeState?.ctx_tokens ?? 0) || 0),
      checkedMemories: runtimeState?.checkedMemories ?? runtimeState?.checked_memories ?? null,
      conflictMemories: runtimeState?.conflictMemories ?? runtimeState?.conflict_memories ?? null,
      now: createdAt,
      memoryAnchors: toArray(runtimeState?.memoryAnchors ?? runtimeState?.memory_anchors),
    },
  };
}

export async function buildStagedMemoryStabilitySnapshot({
  runtimeState,
  provider = null,
  createdAt = null,
  description = "agent-passport staged adapter converted runtime memory state into a hash-only memory-stability snapshot.",
  snapshotId = null,
  contract = null,
} = {}) {
  const baseContract = contract || (await loadVerifiedMemoryStabilityContract());
  const contractProfile = baseContract.profile;
  const normalizedRuntimeState = runtimeState && typeof runtimeState === "object" ? runtimeState : {};
  const timestamp = nonEmptyString(
    createdAt,
    normalizedRuntimeState.updatedAt ??
      normalizedRuntimeState.updated_at ??
      normalizedRuntimeState.createdAt ??
      normalizedRuntimeState.created_at ??
      new Date().toISOString()
  );
  const memoryAnchors = toArray(normalizedRuntimeState.memoryAnchors ?? normalizedRuntimeState.memory_anchors);
  if (memoryAnchors.length === 0) {
    throw new Error("memory_anchors must not be empty");
  }

  const {
    provider: inferredProvider,
    modelName,
    engineInput,
  } = buildEngineSnapshotSource({
    runtimeState: normalizedRuntimeState,
    contractProfile,
    provider,
    createdAt: timestamp,
  });
  const engineResult = computeMemoryStabilityRuntimeState(engineInput);
  if (!engineResult.ok) {
    throw new Error(engineResult.error?.message || "memory stability engine failed closed");
  }

  const state = engineResult.runtime_state;
  const modelProfile = engineResult.model_profile;
  const correctionPlan = engineResult.correction_plan;
  const generatedSnapshotId =
    snapshotId ||
    `staged-memory-stability-${sha256(stableJsonStringify({
      sessionId: state.session_id,
      modelName: state.model_name,
      createdAt: timestamp,
      cT: state.c_t,
      correctionLevel: correctionPlan.level,
    })).slice(0, 16)}`;
  const snapshot = {
    schema_version: MEMORY_STABILITY_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: generatedSnapshotId,
    description,
    created_at: timestamp,
    source_profile: {
      path: baseContract.contract?.profilePath || DEFAULT_MEMORY_STABILITY_PROFILE_PATH,
      schema_version: MEMORY_STABILITY_PROFILE_SCHEMA_VERSION,
      created_at: contractProfile.created_at,
      model_profile_count: contractProfile.model_profiles.length,
    },
    model_profile: modelProfile,
    runtime_state: {
      session_id: nonEmptyString(state.session_id, generatedSnapshotId),
      model_name: modelName,
      provider: inferredProvider,
      ctx_tokens: state.ctx_tokens,
      memory_anchors: state.memory_anchors,
      checked_memories: state.checked_memories,
      conflict_memories: state.conflict_memories,
      v_t: state.v_t,
      l_t: state.l_t,
      m_t: clampScore(state.m_t, 0),
      r_pos_t: state.r_pos_t,
      x_t: state.x_t,
      s_t: state.s_t,
      c_t: state.c_t,
      correction_level: correctionPlan.level,
      computed_at: state.computed_at || timestamp,
    },
    correction_plan: {
      level: correctionPlan.level,
      actions: correctionPlan.actions,
      reason: correctionPlan.reason,
    },
    placement_strategy: engineResult.placement_strategy,
    privacy: {
      mode: "redacted",
      anchor_content_policy: "hash_only",
      redacted_at: timestamp,
      raw_content_persisted: false,
      note: "Staged adapter stores only redacted markers and sha256 memory refs; raw memory text is never persisted.",
    },
  };

  validateMemoryStabilityRedactedSnapshot(snapshot, `${generatedSnapshotId}.redacted.json`, {
    runtimeProfile: contractProfile,
    expectedProfilePath: snapshot.source_profile.path,
  });
  return {
    ok: true,
    failClosed: true,
    snapshot,
    adapter: {
      mode: "staged",
      explicitExecutionRequired: true,
      automaticByLoader: false,
      modelCalled: false,
      networkCalled: false,
      ledgerWritten: false,
      sourceCorrectionPlanSummary: summarizeCorrectionLevel(correctionPlan.level),
    },
  };
}

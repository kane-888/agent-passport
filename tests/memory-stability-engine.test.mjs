import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertUniqueMemoryStabilityActionVocabulary,
  getMemoryStabilityCorrectionActions,
  MEMORY_STABILITY_ACTIONS,
  MEMORY_STABILITY_CORRECTION_ACTIONS_BY_LEVEL,
} from "../src/memory-stability/action-vocabulary.js";
import {
  buildMemoryStabilityCorrectionPlan,
  buildMemoryStabilityPlacementStrategy,
  computeMemoryStabilityRuntimeState,
} from "../src/memory-stability/engine.js";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const runtimeProfile = JSON.parse(
  fs.readFileSync(
    path.join(rootDir, "contracts", "memory-stability", "profile", "memory-stability-runtime-profile.json"),
    "utf8"
  )
);

function anchor(overrides = {}) {
  return {
    memory_id: overrides.memory_id || "memory-anchor",
    content: overrides.content || "private memory fixture that must not leak",
    importance_weight: overrides.importance_weight ?? 1,
    inserted_position: overrides.inserted_position || "tail",
    last_verified_ok: overrides.last_verified_ok ?? true,
    conflict: overrides.conflict ?? false,
    authoritative: overrides.authoritative ?? true,
  };
}

function compute(overrides = {}) {
  return computeMemoryStabilityRuntimeState({
    runtimeProfile,
    sessionId: overrides.sessionId || "memory-stability-engine-test",
    provider: overrides.provider || "deepseek",
    modelName: overrides.modelName || "deepseek-chat",
    ctxTokens: overrides.ctxTokens ?? 1024,
    checkedMemories: overrides.checkedMemories,
    conflictMemories: overrides.conflictMemories,
    now: "2026-04-23T17:00:00.000Z",
    memoryAnchors: overrides.memoryAnchors || [
      anchor({ memory_id: "stable-front", content: "front private fact", inserted_position: "front" }),
      anchor({ memory_id: "stable-tail", content: "tail private fact", inserted_position: "tail" }),
    ],
  });
}

test("memory stability engine computes stable runtime state with unified none actions", () => {
  const result = compute();

  assert.equal(result.ok, true);
  assert.equal(result.effects.modelCalled, false);
  assert.equal(result.effects.networkCalled, false);
  assert.equal(result.effects.ledgerWritten, false);
  assert.equal(result.runtime_state.correction_level, "none");
  assert.equal(result.runtime_state.v_t, 1);
  assert.equal(result.runtime_state.c_t < 0.2, true);
  assert.deepEqual(result.correction_plan.actions, ["continue_monitoring"]);
  assert.deepEqual(getMemoryStabilityCorrectionActions("none"), ["continue_monitoring"]);
});

test("memory stability engine computes medium correction from verification, load, and conflict risk", () => {
  const result = compute({
    ctxTokens: 6144,
    checkedMemories: 2,
    conflictMemories: 1,
    memoryAnchors: [
      anchor({
        memory_id: "medium-ok",
        content: "medium private ok fact",
        inserted_position: "tail",
        importance_weight: 1,
        last_verified_ok: true,
      }),
      anchor({
        memory_id: "medium-conflict",
        content: "medium private conflict fact",
        inserted_position: "middle",
        importance_weight: 1,
        last_verified_ok: false,
        conflict: true,
      }),
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.runtime_state.correction_level, "medium");
  assert.equal(result.runtime_state.v_t, 0.5);
  assert.equal(result.runtime_state.x_t, 0.5);
  assert.deepEqual(result.correction_plan.actions, [
    "reanchor_key_memories_near_prompt_end",
    "raise_memory_injection_priority",
    "rewrite_working_memory_summary",
    "compress_low_value_history",
  ]);
});

test("memory stability engine computes strong correction and placement pressure", () => {
  const result = compute({
    provider: "ollama:gemma4:e4b",
    modelName: "gemma4:e4b",
    ctxTokens: 2048,
    checkedMemories: 2,
    conflictMemories: 2,
    memoryAnchors: [
      anchor({
        memory_id: "strong-conflict-a",
        content: "strong private conflict alpha",
        inserted_position: "middle",
        last_verified_ok: false,
        conflict: true,
      }),
      anchor({
        memory_id: "strong-conflict-b",
        content: "strong private conflict beta",
        inserted_position: "middle",
        last_verified_ok: false,
        conflict: true,
      }),
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.runtime_state.correction_level, "strong");
  assert.equal(result.runtime_state.c_t > 0.5, true);
  assert.deepEqual(result.correction_plan.actions, [
    "reanchor_key_memories_near_prompt_end",
    "raise_memory_injection_priority",
    "rewrite_working_memory_summary",
    "compress_low_value_history",
    "reload_authoritative_memory_store",
    "resolve_conflicts_and_refresh_runtime_state",
  ]);
  assert.equal(result.placement_strategy.actions.includes("compress_before_next_turn"), true);
  assert.equal(result.placement_strategy.actions.includes("compress_early_and_keep_anchor_density_low"), true);
});

test("memory stability engine emits hash-only anchors and never returns raw memory content", () => {
  const rawSecret = "PRIVATE RAW MEMORY: signing key rotation must stay local";
  const result = compute({
    memoryAnchors: [
      anchor({
        memory_id: "hash-only-anchor",
        content: rawSecret,
        inserted_position: "middle",
      }),
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.privacy.raw_content_persisted, false);
  assert.equal(result.runtime_state.memory_anchors.length, 1);
  const [redacted] = result.runtime_state.memory_anchors;
  assert.equal(redacted.content_redaction, "hash_only");
  assert.equal(redacted.content_redacted, true);
  assert.match(redacted.content, /^\[redacted:[a-f0-9]{12}\]$/u);
  assert.match(redacted.content_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result).includes(rawSecret), false);
});

test("memory stability engine clamps caller-supplied counts before risk scoring", () => {
  const result = compute({
    checkedMemories: 100,
    conflictMemories: 1,
    memoryAnchors: [
      anchor({
        memory_id: "count-ok",
        content: "private checked fact",
        last_verified_ok: true,
        conflict: false,
      }),
      anchor({
        memory_id: "count-conflict",
        content: "private conflicting fact",
        last_verified_ok: false,
        conflict: true,
      }),
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.runtime_state.checked_memories, 2);
  assert.equal(result.runtime_state.conflict_memories, 1);
  assert.equal(result.runtime_state.x_t, 0.5);
});

test("memory stability engine does not treat missing authority evidence as authoritative", () => {
  const result = compute({
    memoryAnchors: [
      {
        memory_id: "no-authority-evidence",
        content: "private fact without authority evidence",
        inserted_position: "tail",
        last_verified_ok: true,
      },
      {
        memory_id: "ranked-authority",
        content: "private fact with authority rank",
        inserted_position: "tail",
        last_verified_ok: true,
        authorityRank: 0.9,
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.runtime_state.memory_anchors[0].authoritative, false);
  assert.equal(result.runtime_state.memory_anchors[1].authoritative, true);
});

test("memory stability engine fails closed for unknown model profiles", () => {
  const result = compute({
    provider: "deepseek",
    modelName: "unknown-model",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.failClosed, true);
  assert.equal(result.effects.modelCalled, false);
  assert.equal(result.effects.networkCalled, false);
  assert.equal(result.effects.ledgerWritten, false);
  assert.equal(result.error.code, "memory_stability_model_profile_not_found");
});

test("memory stability action vocabulary is unique and level mappings are canonical", () => {
  const vocabulary = assertUniqueMemoryStabilityActionVocabulary();

  assert.equal(vocabulary.ok, true);
  assert.equal(new Set(MEMORY_STABILITY_ACTIONS).size, MEMORY_STABILITY_ACTIONS.length);
  assert.deepEqual(MEMORY_STABILITY_CORRECTION_ACTIONS_BY_LEVEL.light, [
    "reanchor_key_memories_near_prompt_end",
    "raise_memory_injection_priority",
  ]);
  assert.equal(
    MEMORY_STABILITY_CORRECTION_ACTIONS_BY_LEVEL.strong.includes("reload_authoritative_memory_store"),
    true
  );
});

test("memory stability plan and placement builders consume productized engine state", () => {
  const runtimeState = {
    c_t: 0.44,
    s_t: 0.56,
    v_t: 0.5,
    l_t: 0.75,
    r_pos_t: 0,
    x_t: 0.5,
    correction_level: "medium",
  };
  const plan = buildMemoryStabilityCorrectionPlan({ runtimeState });
  const placement = buildMemoryStabilityPlacementStrategy({
    runtimeProfile,
    runtimeState,
    modelProfile: {
      provider: "deepseek",
      model_name: "deepseek-chat",
      ccrs: 1,
      ecl_085: 8192,
      pr: 1,
      mid_drop: 0,
    },
  });

  assert.deepEqual(plan.actions, [
    "reanchor_key_memories_near_prompt_end",
    "raise_memory_injection_priority",
    "rewrite_working_memory_summary",
    "compress_low_value_history",
  ]);
  assert.deepEqual(placement.actions, ["standard_reanchor_policy"]);
});

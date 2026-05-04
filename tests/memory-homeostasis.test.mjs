import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMemoryCorrectionPlan,
  buildRuntimeMemoryStateView,
  buildMemoryHomeostasisBenchmarkPlan,
  computeRuntimeMemoryHomeostasis,
  MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS,
  normalizeMemoryAnchorRecord,
  normalizeModelProfileRecord,
  normalizeRuntimeMemoryStateRecord,
} from "../src/memory-homeostasis.js";
import { AGENT_PASSPORT_LOCAL_REASONER_LABEL } from "../src/memory-engine-branding.js";

test("memory homeostasis benchmark plan clamps oversized profiling requests", () => {
  const plan = buildMemoryHomeostasisBenchmarkPlan({
    baselineLength: 1_000_000,
    lengths: Array.from({ length: 50 }, (_, index) => 512 * (index + 1)),
    positions: ["front", "middle", "tail", "front", "middle", "tail", "unknown"],
    factCount: 999,
  });

  assert.equal(plan.baselineLength, MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxContextLength);
  assert.equal(plan.factCount, MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxFactCount);
  assert.equal(plan.lengths.length <= MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxLengthCount, true);
  assert.equal(plan.positions.length <= MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxPositionCount, true);
  assert.equal(
    plan.lengths.every((length) => length <= MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxContextLength),
    true
  );
  assert.equal(
    plan.scenarios.length,
    plan.lengths.length * plan.positions.length * MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxFactCount
  );
});

test("memory homeostasis anchor normalization tolerates empty clean-run anchors", () => {
  const normalizedNull = normalizeMemoryAnchorRecord(null);
  const normalizedString = normalizeMemoryAnchorRecord("invalid");

  assert.match(normalizedNull.memoryId, /^anchor_/);
  assert.equal(normalizedNull.source, "unknown");
  assert.equal(normalizedNull.content, null);
  assert.match(normalizedString.memoryId, /^anchor_/);
  assert.equal(normalizedString.source, "unknown");
});

test("memory homeostasis defaults use agent-passport public model naming", () => {
  const profile = normalizeModelProfileRecord({});
  const state = normalizeRuntimeMemoryStateRecord({});
  const view = buildRuntimeMemoryStateView({});

  assert.equal(profile.modelName, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
  assert.equal(state.modelName, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
  assert.equal(view.modelName, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
  assert.equal(view.model_name, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
});

test("memory homeostasis runtime state uses memory-stability engine truth but keeps raw anchors", () => {
  const state = computeRuntimeMemoryHomeostasis({
    sessionId: "mh-engine-truth",
    modelName: "deepseek-chat",
    ctxTokens: 1600,
    correctionLevel: "strong",
    modelProfile: {
      modelName: "deepseek-chat",
      ccrs: 1,
      ecl085: 2048,
      pr: 1,
      midDrop: 0,
    },
    memoryAnchors: [
      {
        memoryId: "verified-tail",
        content: "raw anchor text must remain available to product runtime.",
        importanceWeight: 3,
        insertedPosition: "tail",
        lastVerifiedOk: true,
        authorityRank: 0.9,
      },
      {
        memoryId: "conflicting-middle",
        content: "raw conflicting anchor text must not be redacted in runtime state.",
        importanceWeight: 2,
        insertedPosition: "middle",
        lastVerifiedOk: false,
        conflictState: {
          hasConflict: true,
        },
        authorityRank: 0.8,
      },
    ],
  });

  assert.equal(state.correctionLevel, "medium");
  assert.equal(state.cT > 0.35, true);
  assert.equal(state.cT < 0.5, true);
  assert.equal(state.memoryAnchors[0].content, "raw anchor text must remain available to product runtime.");
  assert.equal(state.memoryAnchors[1].content, "raw conflicting anchor text must not be redacted in runtime state.");
  assert.equal(state.scoreBreakdown?.middleAnchorRatio, 0.5);
});

test("memory homeostasis can adapt contract-backed runtime policy onto the public local reasoner model name", () => {
  const state = computeRuntimeMemoryHomeostasis({
    sessionId: "mh-contract-runtime-profile",
    modelName: AGENT_PASSPORT_LOCAL_REASONER_LABEL,
    ctxTokens: 1900,
    modelProfile: {
      modelName: AGENT_PASSPORT_LOCAL_REASONER_LABEL,
      ccrs: 0.3,
      ecl085: 4096,
      pr: 0.4,
      midDrop: 0.4,
    },
    contractRuntimeProfile: {
      schema_version: "memory-stability-runtime-profile/v1",
      created_at: "2026-04-24T00:00:00.000Z",
      model_profiles: [
        {
          model_name: "gemma4:e4b",
          provider: "ollama:gemma4:e4b",
          ccrs: 1,
          ecl_085: 2048,
          pr: 1,
          mid_drop: 0,
          created_at: "2026-04-24T00:00:00.000Z",
        },
      ],
      runtime_policy: {
        online_score_weights: {
          alpha_v_t: 0.4,
          beta_context_load: 0.25,
          gamma_position_risk: 0.2,
          delta_conflict_rate: 0.15,
        },
        correction_thresholds: {
          tau1_light: 0.05,
          tau2_medium: 0.1,
          tau3_strong: 0.45,
        },
        managed_memory_budget: {
          max_injected_estimated_tokens: 2048,
        },
        model_specific_notes: [
          {
            provider: "ollama:gemma4:e4b",
            model_name: "gemma4:e4b",
            placement_hint: "compress_early_and_keep_anchor_density_low",
          },
        ],
      },
    },
    memoryAnchors: [
      {
        memoryId: "verified-tail",
        content: "contract-backed runtime profiles should keep raw anchors local.",
        importanceWeight: 3,
        insertedPosition: "tail",
        lastVerifiedOk: true,
        authorityRank: 0.9,
      },
      {
        memoryId: "conflicting-middle",
        content: "contract-backed runtime policy should still see local conflict pressure.",
        importanceWeight: 2,
        insertedPosition: "middle",
        lastVerifiedOk: false,
        conflictState: {
          hasConflict: true,
        },
        authorityRank: 0.8,
      },
    ],
  });

  assert.equal(state.profile?.modelName, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
  assert.equal(state.profile?.ecl085, 2048);
  assert.equal(state.thresholds?.tau2, 0.1);
  assert.equal(state.thresholds?.tau3, 0.45);
  assert.equal(state.correctionLevel, "strong");
  assert.equal(state.placementStrategy?.modelHint, "compress_early_and_keep_anchor_density_low");
});

test("memory correction plan reuses runtime truth instead of recomputing a parallel placement view", () => {
  const state = computeRuntimeMemoryHomeostasis({
    sessionId: "mh-engine-plan",
    modelName: "deepseek-chat",
    ctxTokens: 1600,
    modelProfile: {
      modelName: "deepseek-chat",
      ccrs: 1,
      ecl085: 2048,
      pr: 1,
      midDrop: 0,
    },
    memoryAnchors: [
      {
        memoryId: "verified-tail",
        content: "raw anchor text must remain available to product runtime.",
        importanceWeight: 3,
        insertedPosition: "tail",
        lastVerifiedOk: true,
        authorityRank: 0.9,
      },
      {
        memoryId: "conflicting-middle",
        content: "raw conflicting anchor text must not be redacted in runtime state.",
        importanceWeight: 2,
        insertedPosition: "middle",
        lastVerifiedOk: false,
        conflictState: {
          hasConflict: true,
        },
        authorityRank: 0.8,
      },
    ],
  });

  const correctionPlan = buildMemoryCorrectionPlan({
    runtimeState: state,
    modelProfile: state.profile,
  });

  assert.deepEqual(correctionPlan.placementStrategy, state.placementStrategy);
  assert.equal(correctionPlan.riskScore, state.cT);
  assert.equal(correctionPlan.stabilityScore, state.sT);
  assert.equal(correctionPlan.checkedMemories, state.checkedMemories);
  assert.equal(correctionPlan.conflictMemories, state.conflictMemories);
  assert.equal(correctionPlan.observedAnchorCount, state.memoryAnchors.length);
  assert.deepEqual(correctionPlan.scoreBreakdown, state.scoreBreakdown);
  assert.equal(correctionPlan.actions.includes("reanchor_key_memories_near_prompt_end"), true);
  assert.equal(correctionPlan.actions.includes("reanchor_critical_memories_to_tail"), false);
});

test("memory homeostasis runtime state falls back without anchors instead of failing closed", () => {
  const state = computeRuntimeMemoryHomeostasis({
    sessionId: "mh-legacy-fallback",
    modelName: "deepseek-chat",
    ctxTokens: 0,
    memoryAnchors: [],
  });

  assert.equal(Array.isArray(state.memoryAnchors), true);
  assert.equal(state.memoryAnchors.length, 0);
  assert.equal(state.vT, 1);
  assert.equal(state.correctionLevel, "none");
});

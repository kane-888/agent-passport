import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeMemoryStateView,
  buildMemoryHomeostasisBenchmarkPlan,
  MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS,
  normalizeMemoryAnchorRecord,
  normalizeModelProfileRecord,
  normalizeRuntimeMemoryStateRecord,
} from "../src/memory-homeostasis.js";
import { AGENT_PASSPORT_LOCAL_REASONER_LABEL } from "../src/openneed-memory-engine.js";

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

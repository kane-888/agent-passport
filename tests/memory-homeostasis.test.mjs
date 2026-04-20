import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMemoryHomeostasisBenchmarkPlan,
  MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS,
} from "../src/memory-homeostasis.js";

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

#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertUniqueMemoryStabilityActionVocabulary,
} from "../src/memory-stability/action-vocabulary.js";
import { computeMemoryStabilityRuntimeState } from "../src/memory-stability/engine.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = JSON.parse(
  await readFile(
    path.join(rootDir, "contracts", "memory-stability", "profile", "memory-stability-runtime-profile.json"),
    "utf8"
  )
);

const stable = computeMemoryStabilityRuntimeState({
  runtimeProfile: profile,
  provider: "deepseek",
  modelName: "deepseek-chat",
  sessionId: "verify-memory-stability-engine-stable",
  ctxTokens: 1024,
  now: "2026-04-23T18:20:00.000Z",
  memoryAnchors: [
    {
      memory_id: "stable-fact",
      content: "This raw verifier memory must be redacted.",
      inserted_position: "tail",
      last_verified_ok: true,
      importance_weight: 1,
    },
  ],
});

const strong = computeMemoryStabilityRuntimeState({
  runtimeProfile: profile,
  provider: "ollama:gemma4:e4b",
  modelName: "gemma4:e4b",
  sessionId: "verify-memory-stability-engine-strong",
  ctxTokens: 2048,
  checkedMemories: 2,
  conflictMemories: 2,
  now: "2026-04-23T18:21:00.000Z",
  memoryAnchors: [
    {
      memory_id: "strong-a",
      content: "Strong raw verifier memory A must be redacted.",
      inserted_position: "middle",
      last_verified_ok: false,
      conflict: true,
    },
    {
      memory_id: "strong-b",
      content: "Strong raw verifier memory B must be redacted.",
      inserted_position: "middle",
      last_verified_ok: false,
      conflict: true,
    },
  ],
});

assert.equal(assertUniqueMemoryStabilityActionVocabulary().ok, true);
assert.equal(stable.ok, true);
assert.equal(stable.runtime_state.correction_level, "none");
assert.equal(strong.ok, true);
assert.equal(strong.runtime_state.correction_level, "strong");
assert.equal(strong.correction_plan.actions.includes("reload_authoritative_memory_store"), true);
assert.equal(JSON.stringify(stable).includes("raw verifier memory"), false);
assert.equal(JSON.stringify(strong).includes("Strong raw verifier memory"), false);

console.log(JSON.stringify({
  ok: true,
  verifier: "memory-stability-engine",
  stableLevel: stable.runtime_state.correction_level,
  strongLevel: strong.runtime_state.correction_level,
  actionVocabulary: assertUniqueMemoryStabilityActionVocabulary().actionCount,
}));

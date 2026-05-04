#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  buildMemoryStabilityKernelPreview,
  buildMemoryStabilityPromptPreflight,
  isMemoryStabilityKernelEnabled,
  isMemoryStabilityPromptPreflightEnabled,
} from "../src/memory-stability/internal-kernel.js";

const runtimeState = {
  sessionId: "verify-kernel-session",
  modelName: "agent-passport-local-reasoner",
  ctxTokens: 4096,
  checkedMemories: 2,
  conflictMemories: 1,
  vT: 0.5,
  lT: 0.35,
  rPosT: 0.12,
  xT: 0.5,
  sT: 0.62,
  cT: 0.38,
  correctionLevel: "medium",
  scoreBreakdown: {
    middleAnchorRatio: 0.5,
  },
  memoryAnchors: [
    {
      memoryId: "verify-kernel-boundary",
      content: "This verifier raw text must be hashed before leaving the kernel.",
      importanceWeight: 3,
      insertedPosition: "tail",
      lastVerifiedOk: true,
      authorityRank: 0.9,
    },
    {
      memoryId: "verify-kernel-scope",
      content: "The verifier must never write product stores or execute corrections.",
      importanceWeight: 2,
      insertedPosition: "middle",
      lastVerifiedOk: false,
      authorityRank: 0.8,
      conflictState: {
        hasConflict: true,
      },
    },
  ],
};

assert.equal(isMemoryStabilityKernelEnabled({}), false);
assert.equal(isMemoryStabilityKernelEnabled({ memoryStabilityKernelPreview: "1" }), true);
assert.equal(isMemoryStabilityPromptPreflightEnabled({}), false);
assert.equal(isMemoryStabilityPromptPreflightEnabled({ memoryStability: { promptPreflight: "1" } }), true);

const preview = await buildMemoryStabilityKernelPreview({
  runtimeState,
  provider: "agent-passport-local",
  createdAt: "2026-04-23T16:30:00.000Z",
  runId: "verify-memory-stability-kernel",
  enabled: true,
});
const preflight = await buildMemoryStabilityPromptPreflight({
  runtimeState,
  provider: "agent-passport-local",
  createdAt: "2026-04-23T16:29:00.000Z",
  runId: "verify-memory-stability-preflight",
  enabled: true,
});

assert.equal(preview.ok, true);
assert.equal(preview.status, "ready");
assert.equal(preflight.ok, true);
assert.equal(preflight.status, "ready");
assert.equal(preflight.mode, "memory-stability-prompt-preflight/v1");
assert.equal(preflight.effects.promptMutated, false);
assert.equal(preflight.effects.ledgerWritten, false);
assert.equal(preview.effects.modelCalled, false);
assert.equal(preview.effects.networkCalled, false);
assert.equal(preview.effects.ledgerWritten, false);
assert.equal(preview.effects.promptMutated, false);
assert.equal(preview.snapshot.privacy.raw_content_persisted, false);
assert.equal(JSON.stringify(preview).includes("verifier raw text"), false);
assert.equal(JSON.stringify(preview).includes("never write product stores"), false);
assert.equal(JSON.stringify(preflight).includes("verifier raw text"), false);
assert.equal(JSON.stringify(preflight).includes("never write product stores"), false);

console.log(JSON.stringify({
  ok: true,
  verifier: "memory-stability-internal-kernel",
  status: preview.status,
  mode: preview.mode,
  preflightStatus: preflight.status,
  snapshotId: preview.snapshot.snapshot_id,
}));

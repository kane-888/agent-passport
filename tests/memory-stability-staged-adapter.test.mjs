import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildMemoryStabilityCorrectionExecutionEvent, validateMemoryStabilityCorrectionEvent } from "../src/memory-stability/adapter-contract.js";
import { buildStagedMemoryStabilitySnapshot } from "../src/memory-stability/staged-adapter.js";

test("memory stability staged adapter converts runtime memory state into a hash-only redacted snapshot", async () => {
  const result = await buildStagedMemoryStabilitySnapshot({
    createdAt: "2026-04-23T14:40:00.000Z",
    provider: "agent-passport-local",
    runtimeState: {
      sessionId: "staged-session-001",
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
          memoryId: "project-boundary",
          content: "Keep agent-passport as the public product name.",
          importanceWeight: 3,
          insertedPosition: "tail",
          lastVerifiedAt: "2026-04-23T14:39:00.000Z",
          lastVerifiedOk: true,
          authorityRank: 0.9,
        },
        {
          memoryId: "migration-scope",
          content: "Do not touch OpenNeed frontend during memory stability migration.",
          importanceWeight: 2,
          insertedPosition: "middle",
          lastVerifiedAt: "2026-04-23T14:39:30.000Z",
          lastVerifiedOk: false,
          authorityRank: 0.8,
          conflictState: {
            hasConflict: true,
          },
        },
      ],
    },
  });

  const snapshot = result.snapshot;
  assert.equal(result.ok, true);
  assert.equal(result.failClosed, true);
  assert.equal(result.adapter.mode, "staged");
  assert.equal(result.adapter.automaticByLoader, false);
  assert.equal(result.adapter.modelCalled, false);
  assert.equal(result.adapter.networkCalled, false);
  assert.equal(result.adapter.ledgerWritten, false);
  assert.equal(snapshot.privacy.raw_content_persisted, false);
  assert.equal(snapshot.runtime_state.memory_anchors.length, 2);
  assert.equal(snapshot.runtime_state.memory_anchors.every((anchor) => anchor.content_redaction === "hash_only"), true);
  assert.equal(snapshot.runtime_state.memory_anchors.every((anchor) => /^\[redacted:[a-f0-9]{12}\]$/u.test(anchor.content)), true);
  assert.equal(JSON.stringify(snapshot).includes("Keep agent-passport as the public product name."), false);
  assert.equal(JSON.stringify(snapshot).includes("Do not touch OpenNeed frontend"), false);
  assert.deepEqual(snapshot.correction_plan.actions, [
    "reanchor_key_memories_near_prompt_end",
    "raise_memory_injection_priority",
    "rewrite_working_memory_summary",
    "compress_low_value_history",
  ]);
  assert.equal(snapshot.correction_plan.actions.includes("increase_memory_reorder_frequency"), false);
});

test("memory stability staged adapter output can feed the explicit correction event contract", async () => {
  const { snapshot } = await buildStagedMemoryStabilitySnapshot({
    createdAt: "2026-04-23T14:41:00.000Z",
    provider: "agent-passport-local",
    runtimeState: {
      sessionId: "staged-session-strong",
      modelName: "agent-passport-local-reasoner",
      ctxTokens: 8192,
      checkedMemories: 2,
      conflictMemories: 2,
      vT: 0.2,
      lT: 0.72,
      rPosT: 0.2,
      xT: 1,
      sT: 0.3,
      cT: 0.7,
      correctionLevel: "strong",
      memoryAnchors: [
        {
          memoryId: "authority",
          content: "Refresh only by explicit staged adapter receipt.",
          importanceWeight: 3,
          insertedPosition: "tail",
          lastVerifiedOk: false,
          authorityRank: 0.95,
        },
        {
          memoryId: "conflict",
          content: "Resolve conflicting memory refs before continuing.",
          importanceWeight: 2,
          insertedPosition: "middle",
          lastVerifiedOk: false,
          authorityRank: 0.85,
          conflictState: {
            hasConflict: true,
          },
        },
      ],
    },
  });
  const event = buildMemoryStabilityCorrectionExecutionEvent({
    snapshot,
    sourceSnapshotPath: "tests/fixtures/memory-stability/redacted/generated-staged-runtime-snapshot.redacted.json",
    adapterInvocationId: "staged-adapter-strong-001",
    createdAt: "2026-04-23T14:41:01.000Z",
    startedAt: "2026-04-23T14:41:02.000Z",
    completedAt: "2026-04-23T14:41:03.000Z",
  });

  assert.equal(event.execution.authoritative_store_mutated, true);
  assert.equal(event.execution.model_called, false);
  assert.equal(event.execution.loader_auto_executed, false);
  validateMemoryStabilityCorrectionEvent(event, "generated-staged-event", snapshot);
});

test("memory stability staged adapter recomputes canonical risk instead of trusting caller-supplied scores", async () => {
  const { snapshot } = await buildStagedMemoryStabilitySnapshot({
    createdAt: "2026-04-23T14:41:30.000Z",
    provider: "agent-passport-local",
    runtimeState: {
      sessionId: "staged-session-canonical-truth",
      modelName: "agent-passport-local-reasoner",
      ctxTokens: 4096,
      checkedMemories: 2,
      conflictMemories: 1,
      vT: 0.1,
      lT: 0.95,
      rPosT: 0.5,
      xT: 1,
      sT: 0.2,
      cT: 0.8,
      correctionLevel: "strong",
      memoryAnchors: [
        {
          memoryId: "canonical-medium-ok",
          content: "This anchor still verifies correctly.",
          importanceWeight: 3,
          insertedPosition: "tail",
          lastVerifiedOk: true,
          authorityRank: 0.95,
        },
        {
          memoryId: "canonical-medium-conflict",
          content: "This anchor is stale and conflicting.",
          importanceWeight: 2,
          insertedPosition: "middle",
          lastVerifiedOk: false,
          authorityRank: 0.8,
          conflictState: {
            hasConflict: true,
          },
        },
      ],
    },
  });

  assert.equal(snapshot.runtime_state.correction_level, "medium");
  assert.equal(snapshot.runtime_state.c_t < 0.5, true);
  assert.equal(snapshot.correction_plan.actions.includes("reload_authoritative_memory_store"), false);
});

test("memory stability staged adapter fails closed when no memory anchors can be redacted", async () => {
  await assert.rejects(
    () =>
      buildStagedMemoryStabilitySnapshot({
        runtimeState: {
          sessionId: "empty-staged-session",
          memoryAnchors: [],
        },
      }),
    /memory_anchors must not be empty/u
  );
});

test("memory stability staged adapter stays passive and does not materialize product stores", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-memory-stability-staged-passive-"));
  const previous = {
    AGENT_PASSPORT_LEDGER_PATH: process.env.AGENT_PASSPORT_LEDGER_PATH,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH,
    AGENT_PASSPORT_STORE_KEY_PATH: process.env.AGENT_PASSPORT_STORE_KEY_PATH,
  };
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");

  try {
    process.env.AGENT_PASSPORT_LEDGER_PATH = ledgerPath;
    process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = readSessionStorePath;
    process.env.AGENT_PASSPORT_STORE_KEY_PATH = storeKeyPath;

    const result = await buildStagedMemoryStabilitySnapshot({
      runtimeState: {
        sessionId: "passive-staged-session",
        memoryAnchors: [
          {
            memoryId: "passive",
            content: "This raw fixture text must be hashed and then discarded.",
            lastVerifiedOk: true,
          },
        ],
      },
    });

    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(ledgerPath), false);
    assert.equal(fs.existsSync(readSessionStorePath), false);
    assert.equal(fs.existsSync(storeKeyPath), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

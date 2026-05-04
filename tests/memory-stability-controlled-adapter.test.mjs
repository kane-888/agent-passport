import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { executeMemoryStabilityControlledAdapter } from "../src/memory-stability/controlled-adapter.js";
import {
  buildMemoryStabilityFormalExecutionReceipt,
  MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES,
} from "../src/memory-stability/execution-receipts.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("controlled adapter dry-run writes an explicit skipped receipt without product side effects", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/medium-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const result = executeMemoryStabilityControlledAdapter({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId: "controlled-adapter-dry-run-medium",
    createdAt: "2026-04-23T18:00:00.000Z",
    execute: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.execute, false);
  assert.equal(result.completedActionCount, 0);
  assert.equal(result.skippedActionCount, snapshot.correction_plan.actions.length);
  assert.equal(result.effects.modelCalled, false);
  assert.equal(result.effects.networkCalled, false);
  assert.equal(result.effects.ledgerWritten, false);
  assert.equal(result.effects.rawContentPersisted, false);
  assert.equal(result.event.execution.status, "skipped");
  assert.equal(result.event.execution.actor_type, "product_adapter");
  assert.equal(result.event.execution.actions.every((action) => action.status === "skipped"), true);
  assert.equal(result.event.execution.preflight.snapshot_redacted, true);
  assert.equal(result.event.execution.idempotency_replay.side_effect_count, 0);
});

test("controlled adapter can execute safe non-store correction actions", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/medium-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const result = executeMemoryStabilityControlledAdapter({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId: "controlled-adapter-execute-medium",
    createdAt: "2026-04-23T18:01:00.000Z",
    execute: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.event.execution.status, "completed");
  assert.equal(result.event.execution.actions.every((action) => action.status === "completed"), true);
  assert.equal(result.completedActionCount, snapshot.correction_plan.actions.length);
  assert.equal(result.effects.authoritativeStoreMutated, false);
  assert.equal(result.event.execution.authoritative_store_mutated, false);
  const first = result.event.execution.actions[0];
  assert.equal(first.target_memory_refs.length > 0, true);
  assert.deepEqual(Object.keys(first.target_memory_refs[0]).sort(), ["content_sha256", "memory_id"]);
});

test("controlled adapter refuses to claim strong authoritative reload without mutation receipts", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/strong-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const result = executeMemoryStabilityControlledAdapter({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId: "controlled-adapter-strong-no-store-receipt",
    createdAt: "2026-04-23T18:02:00.000Z",
    execute: true,
  });

  const reload = result.event.execution.actions.find((action) => action.action === "reload_authoritative_memory_store");
  const resolve = result.event.execution.actions.find((action) => action.action === "resolve_conflicts_and_refresh_runtime_state");
  assert.equal(reload.status, "skipped");
  assert.equal(resolve.status, "skipped");
  assert.equal(result.event.execution.status, "partial");
  assert.equal(result.event.execution.authoritative_store_mutated, false);
  assert.equal(result.effects.authoritativeStoreMutated, false);
  assert.equal(result.formalExecutionRequest?.status, "blocked_authoritative_reload");
  assert.deepEqual(
    result.formalExecutionRequest?.execution?.pending_formal_actions?.map((action) => action.action),
    ["reload_authoritative_memory_store", "resolve_conflicts_and_refresh_runtime_state"]
  );
});

test("controlled adapter marks strong store actions completed only with explicit receipts", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/strong-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const result = executeMemoryStabilityControlledAdapter({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId: "controlled-adapter-strong-with-store-receipt",
    createdAt: "2026-04-23T18:03:00.000Z",
    execute: true,
    authoritativeStoreMutationReceipt: buildMemoryStabilityFormalExecutionReceipt({
      snapshot,
      adapterInvocationId: "controlled-adapter-strong-with-store-receipt",
      receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
      authoritativeStoreVersion: "store-version-strong-001",
      createdAt: "2026-04-23T18:03:00.000Z",
    }),
    conflictResolutionReceipt: buildMemoryStabilityFormalExecutionReceipt({
      snapshot,
      adapterInvocationId: "controlled-adapter-strong-with-store-receipt",
      receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh,
      authoritativeStoreVersion: "store-version-strong-001",
      createdAt: "2026-04-23T18:03:01.000Z",
    }),
  });

  assert.equal(result.event.execution.status, "completed");
  assert.equal(result.event.execution.authoritative_store_mutated, true);
  assert.equal(result.effects.authoritativeStoreMutated, true);
  assert.equal(result.effects.conflictsResolved, true);
  assert.equal(result.formalExecutionRequest, null);
});

test("controlled adapter rejects formal receipts that are not bound to the current invocation", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/strong-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const driftedReceipt = buildMemoryStabilityFormalExecutionReceipt({
    snapshot,
    adapterInvocationId: "other-invocation",
    receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
    authoritativeStoreVersion: "store-version-strong-002",
    createdAt: "2026-04-23T18:03:02.000Z",
  });

  assert.throws(
    () =>
      executeMemoryStabilityControlledAdapter({
        snapshot,
        sourceSnapshotPath,
        adapterInvocationId: "controlled-adapter-receipt-binding-check",
        createdAt: "2026-04-23T18:03:03.000Z",
        execute: true,
        authoritativeStoreMutationReceipt: driftedReceipt,
      }),
    /adapter_invocation_id mismatch/u
  );
});

test("controlled adapter stays passive and does not materialize product stores", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/medium-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-memory-stability-controlled-adapter-"));
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
    const result = executeMemoryStabilityControlledAdapter({
      snapshot,
      sourceSnapshotPath,
      adapterInvocationId: "controlled-adapter-passive",
      execute: true,
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

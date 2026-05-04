import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { executeMemoryStabilityControlledAdapter } from "../src/memory-stability/controlled-adapter.js";
import {
  buildMemoryStabilityFormalExecutionReceipt,
  buildMemoryStabilityFormalExecutionRequest,
  MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES,
  validateMemoryStabilityFormalExecutionReceipt,
  validateMemoryStabilityFormalExecutionRequest,
} from "../src/memory-stability/execution-receipts.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("formal execution request isolates pending strong actions after safe local actions complete", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/strong-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const adapterResult = executeMemoryStabilityControlledAdapter({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId: "formal-execution-request-strong-001",
    createdAt: "2026-05-02T00:00:00.000Z",
    execute: true,
  });

  const request = buildMemoryStabilityFormalExecutionRequest({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId: "formal-execution-request-strong-001",
    createdAt: "2026-05-02T00:00:00.000Z",
    executedActions: adapterResult.event.execution.actions,
  });

  assert.equal(request.status, "blocked_authoritative_reload");
  assert.deepEqual(request.execution.completed_safe_actions, [
    "reanchor_key_memories_near_prompt_end",
    "raise_memory_injection_priority",
    "rewrite_working_memory_summary",
    "compress_low_value_history",
  ]);
  assert.deepEqual(
    request.execution.pending_formal_actions.map((entry) => entry.action),
    ["reload_authoritative_memory_store", "resolve_conflicts_and_refresh_runtime_state"]
  );
  assert.deepEqual(
    request.execution.required_receipts.map((entry) => entry.receipt_type),
    [
      MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
      MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh,
    ]
  );
  validateMemoryStabilityFormalExecutionRequest(request, snapshot);
});

test("formal execution receipts bind to snapshot, invocation, and receipt type", () => {
  const snapshot = readJson(
    path.join(rootDir, "tests/fixtures/memory-stability/redacted/strong-risk-runtime-snapshot.redacted.json")
  );
  const reloadReceipt = buildMemoryStabilityFormalExecutionReceipt({
    snapshot,
    adapterInvocationId: "formal-execution-receipt-001",
    receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
    authoritativeStoreVersion: "store-version-001",
    createdAt: "2026-05-02T00:01:00.000Z",
  });
  const conflictReceipt = buildMemoryStabilityFormalExecutionReceipt({
    snapshot,
    adapterInvocationId: "formal-execution-receipt-001",
    receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh,
    authoritativeStoreVersion: "store-version-001",
    createdAt: "2026-05-02T00:01:05.000Z",
  });

  assert.equal(reloadReceipt.mutated, true);
  assert.equal(Object.hasOwn(reloadReceipt, "resolved"), false);
  assert.equal(conflictReceipt.resolved, true);
  assert.equal(Object.hasOwn(conflictReceipt, "mutated"), false);
  validateMemoryStabilityFormalExecutionReceipt(reloadReceipt, {
    snapshot,
    adapterInvocationId: "formal-execution-receipt-001",
    expectedAction: "reload_authoritative_memory_store",
  });
  validateMemoryStabilityFormalExecutionReceipt(conflictReceipt, {
    snapshot,
    adapterInvocationId: "formal-execution-receipt-001",
    expectedAction: "resolve_conflicts_and_refresh_runtime_state",
  });
});

test("formal execution receipts fail closed when snapshot binding drifts", () => {
  const snapshot = readJson(
    path.join(rootDir, "tests/fixtures/memory-stability/redacted/strong-risk-runtime-snapshot.redacted.json")
  );
  const receipt = buildMemoryStabilityFormalExecutionReceipt({
    snapshot,
    adapterInvocationId: "formal-execution-receipt-drift-001",
    receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
    authoritativeStoreVersion: "store-version-002",
    createdAt: "2026-05-02T00:02:00.000Z",
  });

  const drifted = {
    ...receipt,
    checkpoint_id: "wrong-checkpoint",
  };

  assert.throws(
    () =>
      validateMemoryStabilityFormalExecutionReceipt(drifted, {
        snapshot,
        adapterInvocationId: "formal-execution-receipt-drift-001",
        expectedAction: "reload_authoritative_memory_store",
      }),
    /checkpoint_id mismatch/u
  );
});

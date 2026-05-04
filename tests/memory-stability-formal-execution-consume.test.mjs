import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { executeMemoryStabilityControlledAdapter } from "../src/memory-stability/controlled-adapter.js";
import {
  buildMemoryStabilityFormalExecutionReceipt,
  MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES,
} from "../src/memory-stability/execution-receipts.js";
import { consumeMemoryStabilityFormalExecutionReceipts } from "../src/memory-stability/formal-execution-consume.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildBlockedStrongPreview({
  snapshot,
  sourceSnapshotPath,
  adapterInvocationId,
  createdAt,
}) {
  const controlledAdapter = executeMemoryStabilityControlledAdapter({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId,
    createdAt,
    execute: true,
  });
  return {
    ok: true,
    status: "ready",
    failClosed: true,
    snapshot,
    boundaries: {
      correctionExecution: controlledAdapter.formalExecutionRequest?.status ?? "not_started",
    },
    effects: {
      modelCalled: false,
      networkCalled: false,
      ledgerWritten: false,
      storeWritten: false,
      promptMutated: false,
      correctionExecuted: controlledAdapter.completedActionCount > 0,
    },
    controlledAdapter: {
      ok: controlledAdapter.ok,
      failClosed: controlledAdapter.failClosed,
      mode: controlledAdapter.mode,
      execute: controlledAdapter.execute,
      completedActionCount: controlledAdapter.completedActionCount,
      skippedActionCount: controlledAdapter.skippedActionCount,
      pendingFormalActionCount:
        controlledAdapter.formalExecutionRequest?.execution?.pending_formal_actions?.length ?? 0,
      executionStatus: controlledAdapter.event?.execution?.status ?? null,
      effects: controlledAdapter.effects,
    },
    correctionEventPreview: controlledAdapter.event,
    formalExecutionRequest: controlledAdapter.formalExecutionRequest,
  };
}

test("formal execution consume completes strong correction when matching receipts are supplied", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/strong-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const preview = buildBlockedStrongPreview({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId: "formal-execution-consume-success-001",
    createdAt: "2026-05-02T01:00:00.000Z",
  });
  const receipts = [
    buildMemoryStabilityFormalExecutionReceipt({
      snapshot,
      adapterInvocationId: "formal-execution-consume-success-001",
      receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
      authoritativeStoreVersion: "store-version-strong-100",
      createdAt: "2026-05-02T01:00:10.000Z",
    }),
    buildMemoryStabilityFormalExecutionReceipt({
      snapshot,
      adapterInvocationId: "formal-execution-consume-success-001",
      receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh,
      authoritativeStoreVersion: "store-version-strong-100",
      createdAt: "2026-05-02T01:00:11.000Z",
    }),
  ];

  const result = consumeMemoryStabilityFormalExecutionReceipts({
    preview,
    receipts,
    consumedAt: "2026-05-02T01:00:12.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.completed, true);
  assert.equal(result.status, "completed");
  assert.equal(result.summary.receiptCount, 2);
  assert.equal(result.previewAfterConsume.formalExecutionRequest, null);
  assert.equal(result.previewAfterConsume.boundaries.correctionExecution, "formal_execution_completed");
  assert.equal(result.previewAfterConsume.controlledAdapter?.pendingFormalActionCount, 0);
  assert.equal(result.previewAfterConsume.controlledAdapter?.executionStatus, "completed");
  assert.equal(result.previewAfterConsume.correctionEventPreview?.execution?.status, "completed");
  assert.equal(result.previewAfterConsume.correctionEventPreview?.execution?.authoritative_store_mutated, true);
});

test("formal execution consume stays blocked when a required receipt is missing", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/strong-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const preview = buildBlockedStrongPreview({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId: "formal-execution-consume-missing-001",
    createdAt: "2026-05-02T01:01:00.000Z",
  });
  const receipts = [
    buildMemoryStabilityFormalExecutionReceipt({
      snapshot,
      adapterInvocationId: "formal-execution-consume-missing-001",
      receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
      authoritativeStoreVersion: "store-version-strong-101",
      createdAt: "2026-05-02T01:01:10.000Z",
    }),
  ];

  const result = consumeMemoryStabilityFormalExecutionReceipts({
    preview,
    receipts,
    consumedAt: "2026-05-02T01:01:11.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.completed, false);
  assert.equal(result.status, "blocked_authoritative_reload");
  assert.deepEqual(result.summary.missingReceiptTypes, [
    MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh,
  ]);
  assert.equal(result.previewAfterConsume.formalExecutionRequest?.status, "blocked_authoritative_reload");
  assert.equal(result.previewAfterConsume.boundaries.correctionExecution, "blocked_authoritative_reload");
  assert.match(result.recoverySummary?.nextAction || "", /Provide exactly one receipt/u);
});

test("formal execution consume fails closed when a receipt drifts from the expected checkpoint binding", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/strong-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const preview = buildBlockedStrongPreview({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId: "formal-execution-consume-drift-001",
    createdAt: "2026-05-02T01:02:00.000Z",
  });
  const driftedConflictReceipt = {
    ...buildMemoryStabilityFormalExecutionReceipt({
      snapshot,
      adapterInvocationId: "formal-execution-consume-drift-001",
      receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh,
      authoritativeStoreVersion: "store-version-strong-102",
      createdAt: "2026-05-02T01:02:11.000Z",
    }),
    checkpoint_id: "wrong-checkpoint",
  };
  const receipts = [
    buildMemoryStabilityFormalExecutionReceipt({
      snapshot,
      adapterInvocationId: "formal-execution-consume-drift-001",
      receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
      authoritativeStoreVersion: "store-version-strong-102",
      createdAt: "2026-05-02T01:02:10.000Z",
    }),
    driftedConflictReceipt,
  ];

  const result = consumeMemoryStabilityFormalExecutionReceipts({
    preview,
    receipts,
    consumedAt: "2026-05-02T01:02:12.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.completed, false);
  assert.equal(result.status, "blocked_authoritative_reload");
  assert.equal(result.summary.invalidReceiptIssues.length, 1);
  assert.equal(
    result.summary.invalidReceiptIssues[0]?.receiptType,
    MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh
  );
  assert.match(result.summary.invalidReceiptIssues[0]?.reason || "", /checkpoint_id mismatch/u);
  assert.equal(result.previewAfterConsume.formalExecutionRequest?.status, "blocked_authoritative_reload");
});

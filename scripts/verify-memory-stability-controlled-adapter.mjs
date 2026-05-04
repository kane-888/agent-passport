#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { executeMemoryStabilityControlledAdapter } from "../src/memory-stability/controlled-adapter.js";
import {
  buildMemoryStabilityFormalExecutionReceipt,
  MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES,
} from "../src/memory-stability/execution-receipts.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(rootDir, relativePath), "utf8"));
}

const mediumSnapshotPath = "tests/fixtures/memory-stability/redacted/medium-risk-runtime-snapshot.redacted.json";
const strongSnapshotPath = "tests/fixtures/memory-stability/redacted/strong-risk-runtime-snapshot.redacted.json";
const mediumSnapshot = await readJson(mediumSnapshotPath);
const strongSnapshot = await readJson(strongSnapshotPath);

const medium = executeMemoryStabilityControlledAdapter({
  snapshot: mediumSnapshot,
  sourceSnapshotPath: mediumSnapshotPath,
  adapterInvocationId: "verify-controlled-adapter-medium",
  createdAt: "2026-04-23T18:10:00.000Z",
  execute: true,
});

const strongDry = executeMemoryStabilityControlledAdapter({
  snapshot: strongSnapshot,
  sourceSnapshotPath: strongSnapshotPath,
  adapterInvocationId: "verify-controlled-adapter-strong-dry",
  createdAt: "2026-04-23T18:11:00.000Z",
  execute: true,
});

const strongCommitted = executeMemoryStabilityControlledAdapter({
  snapshot: strongSnapshot,
  sourceSnapshotPath: strongSnapshotPath,
  adapterInvocationId: "verify-controlled-adapter-strong-committed",
  createdAt: "2026-04-23T18:12:00.000Z",
  execute: true,
  authoritativeStoreMutationReceipt: buildMemoryStabilityFormalExecutionReceipt({
    snapshot: strongSnapshot,
    adapterInvocationId: "verify-controlled-adapter-strong-committed",
    receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
    authoritativeStoreVersion: "verify-authoritative-reload-v1",
    createdAt: "2026-04-23T18:12:01.000Z",
  }),
  conflictResolutionReceipt: buildMemoryStabilityFormalExecutionReceipt({
    snapshot: strongSnapshot,
    adapterInvocationId: "verify-controlled-adapter-strong-committed",
    receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh,
    authoritativeStoreVersion: "verify-conflict-resolution-v1",
    createdAt: "2026-04-23T18:12:02.000Z",
  }),
});

assert.equal(medium.event.execution.status, "completed");
assert.equal(strongDry.event.execution.status, "partial");
assert.equal(strongDry.event.execution.authoritative_store_mutated, false);
assert.equal(strongCommitted.event.execution.status, "completed");
assert.equal(strongCommitted.event.execution.authoritative_store_mutated, true);
assert.equal(JSON.stringify(strongCommitted).includes("raw memory"), false);

console.log(JSON.stringify({
  ok: true,
  verifier: "memory-stability-controlled-adapter",
  mediumStatus: medium.event.execution.status,
  strongWithoutStoreReceipt: strongDry.event.execution.status,
  strongWithStoreReceipt: strongCommitted.event.execution.status,
  authoritativeStoreMutated: strongCommitted.event.execution.authoritative_store_mutated,
}));

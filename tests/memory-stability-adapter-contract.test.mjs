import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildMemoryStabilityCorrectionExecutionEvent,
  memoryStabilitySnapshotSha256,
  MemoryStabilityAdapterContractError,
  validateMemoryStabilityCorrectionEvent,
  verifyMemoryStabilityAdapterContract,
} from "../src/memory-stability/adapter-contract.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function copyMemoryStabilityTreeToTempRoot(tmpRoot) {
  fs.mkdirSync(path.join(tmpRoot, "contracts"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "tests", "fixtures"), { recursive: true });
  fs.cpSync(
    path.join(rootDir, "contracts", "memory-stability"),
    path.join(tmpRoot, "contracts", "memory-stability"),
    { recursive: true }
  );
  fs.cpSync(
    path.join(rootDir, "tests", "fixtures", "memory-stability"),
    path.join(tmpRoot, "tests", "fixtures", "memory-stability"),
    { recursive: true }
  );
}

test("memory stability adapter contract verifies correction event schema, fixtures, and source hashes", async () => {
  const contract = await verifyMemoryStabilityAdapterContract();

  assert.equal(contract.ok, true);
  assert.equal(contract.failClosed, true);
  assert.equal(
    contract.contract.correctionEventSchemaPath,
    "contracts/memory-stability/schemas/memory-stability-correction-event.schema.json"
  );
  assert.equal(contract.contract.correctionEvents, 3);
  assert.deepEqual(
    contract.verifierReports.correctionEvents.checks.map((entry) => [entry.correctionLevel, entry.actions]),
    [
      ["medium", 4],
      ["none", 1],
      ["strong", 6],
    ]
  );
  assert.equal(contract.verifierReports.correctionEvents.checks.every((entry) => entry.explicitExecution === true), true);
  assert.equal(contract.verifierReports.correctionEvents.checks.every((entry) => entry.automaticByLoader === false), true);
  assert.equal(contract.verifierReports.correctionEvents.checks.every((entry) => entry.loaderAutoExecuted === false), true);
  assert.equal(contract.verifierReports.correctionEvents.checks.every((entry) => entry.modelCalled === false), true);
  assert.equal(contract.verifierReports.correctionEvents.checks.every((entry) => entry.rawContentPersisted === false), true);
  assert.equal(contract.verifierReports.correctionEvents.checks.every((entry) => entry.sourceSnapshotSha256Verified === true), true);
});

test("memory stability adapter builder emits staged explicit events without executing loader-side correction", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/medium-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const event = buildMemoryStabilityCorrectionExecutionEvent({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId: "agent-passport-adapter-contract-medium-generated",
    createdAt: "2026-04-21T04:45:00.000Z",
    startedAt: "2026-04-21T04:45:01.000Z",
    completedAt: "2026-04-21T04:45:02.000Z",
  });

  assert.equal(event.source_snapshot.source_snapshot_sha256, memoryStabilitySnapshotSha256(snapshot));
  assert.equal(event.execution.explicit_execution, true);
  assert.equal(event.execution.automatic_by_loader, false);
  assert.equal(event.execution.loader_auto_executed, false);
  assert.equal(event.execution.model_called, false);
  assert.equal(event.audit.raw_content_persisted, false);
  validateMemoryStabilityCorrectionEvent(event, "generated-medium-event", snapshot);
});

test("memory stability adapter contract rejects loader execution, model calls, raw persistence, and stale hashes", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/stable-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const baseEvent = readJson(path.join(rootDir, "tests", "fixtures", "memory-stability", "correction-events", "none-correction-execution-event.json"));

  for (const [label, mutate, pattern] of [
    [
      "automatic_by_loader",
      (event) => {
        event.execution.automatic_by_loader = true;
      },
      /automatic_by_loader must be false/u,
    ],
    [
      "loader_auto_executed",
      (event) => {
        event.execution.loader_auto_executed = true;
      },
      /loader_auto_executed must be false/u,
    ],
    [
      "model_called",
      (event) => {
        event.execution.model_called = true;
      },
      /model_called must be false/u,
    ],
    [
      "raw_persisted",
      (event) => {
        event.audit.raw_content_persisted = true;
      },
      /raw_content_persisted must be false/u,
    ],
    [
      "stale_hash",
      (event) => {
        event.source_snapshot.source_snapshot_sha256 = "0".repeat(64);
      },
      /source_snapshot_sha256 mismatch/u,
    ],
  ]) {
    const event = structuredClone(baseEvent);
    mutate(event);
    assert.throws(() => validateMemoryStabilityCorrectionEvent(event, label, snapshot), pattern);
  }
});

test("memory stability adapter contract rejects raw fields and mismatched memory refs", () => {
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/medium-risk-runtime-snapshot.redacted.json";
  const snapshot = readJson(path.join(rootDir, sourceSnapshotPath));
  const baseEvent = readJson(path.join(rootDir, "tests", "fixtures", "memory-stability", "correction-events", "medium-correction-execution-event.json"));

  const rawFieldEvent = structuredClone(baseEvent);
  rawFieldEvent.execution.actions[0].target_memory_refs[0].content = "raw memory text";
  assert.throws(
    () => validateMemoryStabilityCorrectionEvent(rawFieldEvent, "raw-field-event", snapshot),
    /raw content field: content/u
  );

  const mismatchedRefEvent = structuredClone(baseEvent);
  mismatchedRefEvent.execution.actions[0].target_memory_refs[0].content_sha256 = "f".repeat(64);
  assert.throws(
    () => validateMemoryStabilityCorrectionEvent(mismatchedRefEvent, "mismatched-ref-event", snapshot),
    /content_sha256 must match source snapshot/u
  );
});

test("memory stability adapter contract stays passive and does not materialize product stores", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-memory-stability-adapter-passive-"));
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

    const contract = await verifyMemoryStabilityAdapterContract();
    assert.equal(contract.ok, true);
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

test("memory stability adapter verifier fails closed for invalid correction event fixtures", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-memory-stability-adapter-"));
  try {
    copyMemoryStabilityTreeToTempRoot(tmpRoot);
    const eventPath = path.join(
      tmpRoot,
      "tests",
      "fixtures",
      "memory-stability",
      "correction-events",
      "strong-correction-execution-event.json"
    );
    const event = readJson(eventPath);
    event.execution.model_called = true;
    fs.writeFileSync(eventPath, JSON.stringify(event, null, 2), "utf8");

    await assert.rejects(
      () => verifyMemoryStabilityAdapterContract({ rootDir: tmpRoot }),
      (error) =>
        error instanceof MemoryStabilityAdapterContractError &&
        error.code === "MEMORY_STABILITY_ADAPTER_CONTRACT_FAILED" &&
        error.stage === "adapter_contract_validation" &&
        /model_called must be false/u.test(error.detail)
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("memory stability adapter contract scripts are wired and CLI loads default paths", () => {
  const packageJson = readJson(path.join(rootDir, "package.json"));

  assert.equal(
    packageJson.scripts?.["verify:memory-stability:adapter"],
    "node scripts/verify-memory-stability-adapter-contract.mjs"
  );
  assert.equal(
    packageJson.scripts?.["test:memory-stability:adapter"],
    "node --test tests/memory-stability-adapter-contract.test.mjs"
  );
  execFileSync(process.execPath, ["--check", path.join(rootDir, "src", "memory-stability", "adapter-contract.js")], {
    cwd: rootDir,
    stdio: "pipe",
  });
  execFileSync(process.execPath, ["--check", path.join(rootDir, "scripts", "verify-memory-stability-adapter-contract.mjs")], {
    cwd: rootDir,
    stdio: "pipe",
  });

  const output = execFileSync(process.execPath, [path.join(rootDir, "scripts", "verify-memory-stability-adapter-contract.mjs")], {
    cwd: rootDir,
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  assert.equal(result.contract.correctionEvents, 3);
});

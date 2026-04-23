import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listDeviceSetupPackages,
  listStoreRecoveryBundles,
} from "../src/ledger-recovery-setup.js";
import { runRuntimeHousekeeping } from "../src/runtime-housekeeping.js";
import { redactRuntimeHousekeepingForReadSession } from "../src/server-security-redaction.js";

function writeJsonPreservingTimestamp(filePath, value, timestamp) {
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
  fs.utimesSync(filePath, timestamp, timestamp);
  return fs.statSync(filePath);
}

test("recovery bundle summaries refresh after same-size same-mtime replacement", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-recovery-cache-"));
  const bundlePath = path.join(tmpDir, "bundle.json");
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  try {
    const firstStats = writeJsonPreservingTimestamp(
      bundlePath,
      {
        format: "test-recovery-format",
        bundleId: "bundle_a",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      timestamp
    );
    const first = await listStoreRecoveryBundles({
      storeRecoveryDir: tmpDir,
      storeRecoveryFormat: "test-recovery-format",
    });

    const secondStats = writeJsonPreservingTimestamp(
      bundlePath,
      {
        format: "test-recovery-format",
        bundleId: "bundle_b",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      timestamp
    );
    const second = await listStoreRecoveryBundles({
      storeRecoveryDir: tmpDir,
      storeRecoveryFormat: "test-recovery-format",
    });

    assert.equal(first.bundles[0].bundleId, "bundle_a");
    assert.equal(second.bundles[0].bundleId, "bundle_b");
    assert.equal(secondStats.size, firstStats.size);
    assert.equal(secondStats.mtimeMs, firstStats.mtimeMs);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("device setup package summaries refresh after same-size same-mtime replacement", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-setup-cache-"));
  const packagePath = path.join(tmpDir, "setup.json");
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  try {
    const firstStats = writeJsonPreservingTimestamp(
      packagePath,
      {
        format: "test-setup-format",
        packageId: "setup_a",
        exportedAt: "2026-01-01T00:00:00.000Z",
      },
      timestamp
    );
    const first = await listDeviceSetupPackages({
      deviceSetupPackageDir: tmpDir,
      deviceSetupPackageFormat: "test-setup-format",
    });

    const secondStats = writeJsonPreservingTimestamp(
      packagePath,
      {
        format: "test-setup-format",
        packageId: "setup_b",
        exportedAt: "2026-01-01T00:00:00.000Z",
      },
      timestamp
    );
    const second = await listDeviceSetupPackages({
      deviceSetupPackageDir: tmpDir,
      deviceSetupPackageFormat: "test-setup-format",
    });

    assert.equal(first.packages[0].packageId, "setup_a");
    assert.equal(second.packages[0].packageId, "setup_b");
    assert.equal(secondStats.size, firstStats.size);
    assert.equal(secondStats.mtimeMs, firstStats.mtimeMs);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("recovery and setup package listings degrade when configured directories are files", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-recovery-dir-file-"));
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupDir = path.join(tmpDir, "setup-packages");
  try {
    fs.writeFileSync(recoveryDir, "not a directory", "utf8");
    fs.writeFileSync(setupDir, "not a directory", "utf8");

    const recovery = await listStoreRecoveryBundles({
      storeRecoveryDir: recoveryDir,
      storeRecoveryFormat: "test-recovery-format",
    });
    const setup = await listDeviceSetupPackages({
      deviceSetupPackageDir: setupDir,
      deviceSetupPackageFormat: "test-setup-format",
    });

    assert.deepEqual(recovery.bundles, []);
    assert.deepEqual(recovery.counts, { total: 0 });
    assert.equal(recovery.unavailable, true);
    assert.equal(recovery.unavailableReason, "ENOTDIR");
    assert.deepEqual(setup.packages, []);
    assert.deepEqual(setup.counts, { total: 0 });
    assert.equal(setup.unavailable, true);
    assert.equal(setup.unavailableReason, "ENOTDIR");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("recovery and setup package listings surface malformed JSON artifacts", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-invalid-artifacts-"));
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupDir = path.join(tmpDir, "setup-packages");
  try {
    fs.mkdirSync(recoveryDir, { recursive: true });
    fs.mkdirSync(setupDir, { recursive: true });
    fs.writeFileSync(path.join(recoveryDir, "broken-recovery.json"), "{", "utf8");
    fs.writeFileSync(path.join(setupDir, "broken-setup.json"), "{", "utf8");

    const recovery = await listStoreRecoveryBundles({
      storeRecoveryDir: recoveryDir,
      storeRecoveryFormat: "test-recovery-format",
    });
    const setup = await listDeviceSetupPackages({
      deviceSetupPackageDir: setupDir,
      deviceSetupPackageFormat: "test-setup-format",
    });

    assert.equal(recovery.counts.invalid, 1);
    assert.equal(recovery.invalidBundles[0].invalidJson, true);
    assert.equal(recovery.invalidBundles[0].bundleId, "broken-recovery");
    assert.equal(recovery.invalidBundles[0].bundlePath, path.join(recoveryDir, "broken-recovery.json"));
    assert.equal(setup.counts.invalid, 1);
    assert.equal(setup.invalidPackages[0].invalidJson, true);
    assert.equal(setup.invalidPackages[0].packageId, "broken-setup");
    assert.equal(setup.invalidPackages[0].packagePath, path.join(setupDir, "broken-setup.json"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("runtime housekeeping audit keeps malformed recovery and setup artifacts visible", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-housekeeping-invalid-"));
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupDir = path.join(tmpDir, "setup-packages");
  const archiveDir = path.join(tmpDir, "archives");
  const readSessionPath = path.join(tmpDir, "read-sessions.json");
  const previousReadSessionPath = process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH;
  try {
    process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = readSessionPath;
    fs.mkdirSync(recoveryDir, { recursive: true });
    fs.mkdirSync(setupDir, { recursive: true });
    fs.writeFileSync(path.join(recoveryDir, "broken-recovery.json"), "{", "utf8");
    fs.writeFileSync(path.join(setupDir, "broken-setup.json"), "{", "utf8");

    const report = await runRuntimeHousekeeping({
      apply: false,
      keepRecovery: 5,
      keepSetup: 5,
      recoveryDir,
      setupPackageDir: setupDir,
      archiveDir,
      liveLedgerPath: path.join(tmpDir, "ledger.json"),
    });

    assert.equal(report.recoveryBundles.invalidCount, 1);
    assert.equal(report.recoveryBundles.kept[0].invalidJson, true);
    assert.equal(report.recoveryBundles.invalid[0].bundlePath, path.join(recoveryDir, "broken-recovery.json"));
    assert.equal(report.setupPackages.invalidCount, 1);
    assert.equal(report.setupPackages.kept[0].invalidJson, true);
    assert.equal(report.setupPackages.invalid[0].packagePath, path.join(setupDir, "broken-setup.json"));

    const redacted = redactRuntimeHousekeepingForReadSession(report, {
      redactionTemplate: "metadata_only",
    });
    assert.equal(redacted.recoveryBundles.kept[0].bundlePath, null);
    assert.equal(redacted.recoveryBundles.kept[0].errorMessage, null);
    assert.equal(redacted.recoveryBundles.invalid[0].bundlePath, null);
    assert.equal(redacted.recoveryBundles.invalid[0].errorMessage, null);
    assert.equal(redacted.setupPackages.kept[0].packagePath, null);
    assert.equal(redacted.setupPackages.kept[0].errorMessage, null);
    assert.equal(redacted.setupPackages.invalid[0].packagePath, null);
    assert.equal(redacted.setupPackages.invalid[0].errorMessage, null);

    const summaryOnly = redactRuntimeHousekeepingForReadSession(report, {
      redactionTemplate: "summary_only",
    });
    assert.equal(summaryOnly.recoveryBundles.invalidCount, undefined);
    assert.equal(summaryOnly.recoveryBundles.keptCount, undefined);
    assert.equal(summaryOnly.recoveryBundles.candidateCount, undefined);
    assert.equal(summaryOnly.recoveryBundles.deletedCount, undefined);
    assert.equal(summaryOnly.recoveryBundles.countsHidden, true);
    assert.equal(summaryOnly.setupPackages.invalidCount, undefined);
    assert.equal(summaryOnly.setupPackages.counts, undefined);
    assert.equal(summaryOnly.setupPackages.countsHidden, true);
  } finally {
    if (previousReadSessionPath == null) {
      delete process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH;
    } else {
      process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = previousReadSessionPath;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listDeviceSetupPackages,
  listStoreRecoveryBundles,
} from "../src/ledger-recovery-setup.js";

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

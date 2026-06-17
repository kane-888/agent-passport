import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let importCounter = 0;

function uniqueImportSuffix(label) {
  importCounter += 1;
  return `${label}-${process.pid}-${Date.now()}-${importCounter}`;
}

function createIsolatedEnv(label) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-passport-${label}-`));
  return {
    tmpDir,
    env: {
      AGENT_PASSPORT_LEDGER_PATH: path.join(tmpDir, "ledger.json"),
      AGENT_PASSPORT_READ_SESSION_STORE_PATH: path.join(tmpDir, "read-sessions.json"),
      AGENT_PASSPORT_STORE_KEY_PATH: path.join(tmpDir, ".ledger-key"),
      AGENT_PASSPORT_SIGNING_SECRET_PATH: path.join(tmpDir, ".did-signing-master-secret"),
      AGENT_PASSPORT_RECOVERY_DIR: path.join(tmpDir, "recovery-bundles"),
      AGENT_PASSPORT_SETUP_PACKAGE_DIR: path.join(tmpDir, "device-setup-packages"),
      AGENT_PASSPORT_ARCHIVE_DIR: path.join(tmpDir, "archives"),
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(tmpDir, ".admin-token"),
      AGENT_PASSPORT_ADMIN_TOKEN: "admin-token-sentinel-for-setup-package",
      AGENT_PASSPORT_SIGNING_MASTER_SECRET: "signing-secret-sentinel-for-setup-package",
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
    },
  };
}

async function withEnv(overrides, operation) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = overrides[key];
  }
  try {
    return await operation();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function importLedger(label) {
  const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
  return import(`${ledgerUrl}?${uniqueImportSuffix(label)}`);
}

test("formal device setup requires a user-held recovery passphrase before creating Passport artifacts", async () => {
  const isolated = createIsolatedEnv("setup-backup-required");
  try {
    await withEnv(isolated.env, async () => {
      const ledger = await importLedger("setup-backup-required");

      await assert.rejects(
        () =>
          ledger.runDeviceSetup({
            residentAgentId: "agent_main",
            residentDidMethod: "agentpassport",
          }),
        (error) => {
          assert.equal(error.code, "recovery_passphrase_missing");
          assert.match(error.message, /用户自持恢复资料/u);
          assert.match(error.message, /丢失后无法恢复原 Agent/u);
          return true;
        }
      );
      await assert.rejects(
        () => ledger.exportStoreRecoveryBundle({ saveToFile: false, returnBundle: true }),
        { code: "recovery_passphrase_missing" }
      );
      assert.equal(
        fs.existsSync(isolated.env.AGENT_PASSPORT_LEDGER_PATH),
        false,
        "missing recovery passphrase must not initialize the ledger"
      );
    });
  } finally {
    fs.rmSync(isolated.tmpDir, { recursive: true, force: true });
  }
});

test("formal device setup exports recovery bundle, verifies it, exports setup package, and keeps secrets out", async () => {
  const source = createIsolatedEnv("setup-backup-source");
  const target = createIsolatedEnv("setup-backup-target");
  const passphrase = "correct horse battery staple";

  try {
    let bundle = null;
    await withEnv(source.env, async () => {
      const ledger = await importLedger("setup-backup-source");
      const setup = await ledger.runDeviceSetup({
        residentAgentId: "agent_main",
        residentDidMethod: "agentpassport",
        displayName: "Backup Closure Agent",
        role: "tester",
        currentGoal: "prove user-held recovery closure",
        stablePreferences: "local first",
        recoveryPassphrase: passphrase,
      });

      bundle = setup.recoveryExport?.bundle;
      assert.equal(setup.setup?.requireRecoveryBackup, true);
      assert.equal(setup.setup?.recoveryBackup?.status, "backup_artifacts_ready");
      assert.ok(setup.recoveryExport?.summary?.bundleId, "setup should return a recovery bundle id");
      assert.ok(setup.recoveryExport?.summary?.bundlePath, "setup should persist a recovery bundle");
      assert.equal(setup.recoveryRehearsal?.status, "passed");
      assert.ok(setup.setupPackageExport?.summary?.packageId, "setup should return a setup package id");
      assert.ok(setup.setupPackageExport?.summary?.packagePath, "setup should persist a setup package");
      assert.equal(setup.status?.setupPolicy?.requireRecoveryBundle, true);
      assert.equal(setup.status?.setupPolicy?.requireRecentRecoveryRehearsal, true);
      assert.equal(setup.status?.setupPolicy?.requireSetupPackage, true);

      const agentAfterSetup = await ledger.getAgent("agent_main");
      assert.equal(agentAfterSetup.recoveryBackup?.status, "backup_artifacts_ready");
      assert.equal(agentAfterSetup.recoveryBackup?.recoveryBundleId, setup.recoveryExport.summary.bundleId);
      assert.equal(agentAfterSetup.recoveryBackup?.setupPackageId, setup.setupPackageExport.summary.packageId);
      assert.equal(JSON.stringify(agentAfterSetup.recoveryBackup).includes(passphrase), false);

      const confirmed = await ledger.updateAgentRecoveryBackupStatus("agent_main", {
        status: "backup_completed",
        recoveryBundleId: setup.recoveryExport.summary.bundleId,
        setupPackageId: setup.setupPackageExport.summary.packageId,
        rehearsalStatus: "passed",
        confirmations: {
          savedRecoveryBundle: true,
          savedSetupPackage: true,
          savedRecoveryPassphrase: true,
          understandsLoss: true,
        },
      });
      assert.equal(confirmed.recoveryBackup?.status, "backup_completed");
      assert.equal(confirmed.recoveryBackup?.confirmations?.savedRecoveryBundle, true);
      assert.equal(JSON.stringify(confirmed.recoveryBackup).includes(passphrase), false);

      await assert.rejects(
        () =>
          ledger.rehearseStoreRecoveryBundle({
            passphrase: "wrong horse battery staple",
            bundle,
            dryRun: true,
            persist: false,
          }),
        /authenticate|decrypt|Unsupported state/u
      );
      await assert.rejects(
        () =>
          ledger.importStoreRecoveryBundle({
            passphrase: "wrong horse battery staple",
            bundle,
            dryRun: true,
            overwrite: true,
          }),
        /authenticate|decrypt|Unsupported state/u
      );

      const setupPackageJson = JSON.stringify(setup.setupPackageExport?.package || {});
      const storeKeyRecord = JSON.parse(fs.readFileSync(source.env.AGENT_PASSPORT_STORE_KEY_PATH, "utf8"));
      const signingSecret = fs.existsSync(source.env.AGENT_PASSPORT_SIGNING_SECRET_PATH)
        ? fs.readFileSync(source.env.AGENT_PASSPORT_SIGNING_SECRET_PATH, "utf8").trim()
        : source.env.AGENT_PASSPORT_SIGNING_MASTER_SECRET;
      const forbiddenStrings = [
        passphrase,
        storeKeyRecord.keyBase64,
        signingSecret,
        source.env.AGENT_PASSPORT_ADMIN_TOKEN,
        "keyBase64",
      ].filter(Boolean);
      for (const forbidden of forbiddenStrings) {
        assert.equal(
          setupPackageJson.includes(forbidden),
          false,
          `setup package must not contain secret material: ${forbidden}`
        );
      }
    });

    await withEnv(target.env, async () => {
      const ledger = await importLedger("setup-backup-target");
      const imported = await ledger.importStoreRecoveryBundle({
        passphrase,
        bundle,
        dryRun: false,
        overwrite: false,
        restoreLedger: true,
        importStoreKeyTo: "file",
      });
      const status = await ledger.getDeviceSetupStatus({ passive: true });

      assert.equal(imported.summary?.residentAgentId, "agent_main");
      assert.equal(status.residentAgentId, "agent_main");
      assert.equal(status.residentAgentReference, "agent_main");
    });
  } finally {
    fs.rmSync(source.tmpDir, { recursive: true, force: true });
    fs.rmSync(target.tmpDir, { recursive: true, force: true });
  }
});

test("agent recovery backup status is queryable and cannot be completed before artifacts are ready", async () => {
  const isolated = createIsolatedEnv("agent-backup-status");
  try {
    await withEnv(isolated.env, async () => {
      const ledger = await importLedger("agent-backup-status");
      const agent = await ledger.registerAgent({
        displayName: "Backup Status Agent",
        role: "tester",
        controller: "Kane",
      });

      assert.equal(agent.recoveryBackup?.status, "backup_pending");
      assert.equal(agent.recoveryBackup?.required, true);
      await assert.rejects(
        () =>
          ledger.updateAgentRecoveryBackupStatus(agent.agentId, {
            status: "backup_completed",
            confirmations: {
              savedRecoveryBundle: true,
              savedSetupPackage: true,
              savedRecoveryPassphrase: true,
              understandsLoss: true,
            },
          }),
        { code: "recovery_backup_artifacts_missing" }
      );

      const setup = await ledger.runDeviceSetup({
        residentAgentId: agent.agentId,
        residentDidMethod: "agentpassport",
        recoveryPassphrase: "backup status passphrase",
        requireRecoveryBackup: true,
      });
      const afterSetup = await ledger.getAgent(agent.agentId);
      assert.equal(afterSetup.recoveryBackup?.status, "backup_artifacts_ready");
      assert.equal(afterSetup.recoveryBackup?.recoveryBundleId, setup.recoveryExport.summary.bundleId);

      await assert.rejects(
        () =>
          ledger.updateAgentRecoveryBackupStatus(agent.agentId, {
            status: "backup_completed",
            confirmations: {
              savedRecoveryBundle: true,
              savedSetupPackage: true,
              savedRecoveryPassphrase: false,
              understandsLoss: true,
            },
          }),
        { code: "recovery_backup_confirmation_missing" }
      );
    });
  } finally {
    fs.rmSync(isolated.tmpDir, { recursive: true, force: true });
  }
});

test("real recovery bundle plus setup package restores original Agent, memory, and resident binding on a new device", async () => {
  const source = createIsolatedEnv("cross-device-source");
  const target = createIsolatedEnv("cross-device-target");
  const passphrase = "cross device recovery passphrase";

  try {
    let agentId = null;
    let bundle = null;
    let setupPackage = null;
    let sourceDid = null;
    let memoryId = null;

    await withEnv(source.env, async () => {
      const ledger = await importLedger("cross-device-source");
      const agent = await ledger.registerAgent({
        displayName: "Cross Device Agent",
        role: "recovery-e2e-agent",
        controller: "Kane",
      });
      agentId = agent.agentId;
      sourceDid = agent.identity.did;
      const memory = await ledger.writePassportMemory(agentId, {
        layer: "profile",
        kind: "recovery_e2e_marker",
        summary: "Cross-device recovery memory marker",
        content: "This memory must survive recovery bundle import.",
        payload: {
          field: "recovery_e2e_marker",
          value: "survived",
        },
        tags: ["recovery-e2e"],
        recordedByAgentId: agentId,
      });
      memoryId = memory.passportMemoryId;

      const setup = await ledger.runDeviceSetup({
        residentAgentId: agentId,
        residentDidMethod: "agentpassport",
        recoveryPassphrase: passphrase,
        requireRecoveryBackup: true,
        includeLocalReasonerProfiles: false,
        recoveryNote: "cross-device e2e recovery bundle",
        setupPackageNote: "cross-device e2e setup package",
      });

      bundle = setup.recoveryExport?.bundle;
      setupPackage = setup.setupPackageExport?.package;
      assert.equal(setup.recoveryRehearsal?.status, "passed");
      assert.ok(bundle, "source setup should return recovery bundle");
      assert.ok(setupPackage, "source setup should return setup package");
      await ledger.updateAgentRecoveryBackupStatus(agentId, {
        status: "backup_completed",
        recoveryBundleId: setup.recoveryExport.summary.bundleId,
        setupPackageId: setup.setupPackageExport.summary.packageId,
        rehearsalStatus: "passed",
        confirmations: {
          savedRecoveryBundle: true,
          savedSetupPackage: true,
          savedRecoveryPassphrase: true,
          understandsLoss: true,
        },
      });
      const completedAgent = await ledger.getAgent(agentId);
      assert.equal(completedAgent.recoveryBackup?.status, "backup_completed");
    });

    await withEnv(target.env, async () => {
      const ledger = await importLedger("cross-device-target");
      await assert.rejects(
        () =>
          ledger.importStoreRecoveryBundle({
            passphrase: "wrong cross device recovery passphrase",
            bundle,
            dryRun: true,
            overwrite: true,
            restoreLedger: true,
          }),
        /authenticate|decrypt|Unsupported state/u
      );

      const importedRecovery = await ledger.importStoreRecoveryBundle({
        passphrase,
        bundle,
        dryRun: false,
        overwrite: false,
        restoreLedger: true,
        importStoreKeyTo: "file",
      });
      assert.equal(importedRecovery.summary?.residentAgentId, agentId);

      const importedSetup = await ledger.importDeviceSetupPackage({
        package: setupPackage,
        allowResidentRebind: true,
        importLocalReasonerProfiles: false,
        dryRun: false,
      });
      assert.equal(importedSetup.runtime?.deviceRuntime?.residentAgentId, agentId);

      const restoredAgent = await ledger.getAgent(agentId);
      assert.equal(restoredAgent.identity?.did, sourceDid);
      assert.equal(
        restoredAgent.recoveryBackup?.status,
        "backup_pending",
        "restored bundle should not falsely claim the source-side user confirmation happened on the new device"
      );

      const memories = await ledger.listPassportMemories(agentId, {
        kind: "recovery_e2e_marker",
        includeInactive: true,
      });
      assert.equal(memories.counts?.total, 1);
      assert.equal(memories.memories?.[0]?.passportMemoryId, memoryId);
      assert.equal(memories.memories?.[0]?.payload?.value, "survived");

      const status = await ledger.getDeviceSetupStatus({ passive: true });
      assert.equal(status.residentAgentId, agentId);
      assert.equal(status.residentAgentReference, agentId);
    });
  } finally {
    fs.rmSync(source.tmpDir, { recursive: true, force: true });
    fs.rmSync(target.tmpDir, { recursive: true, force: true });
  }
});

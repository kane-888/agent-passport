import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  calculateAgeHours,
  recoveryRehearsalSupersedesPassed,
  summarizeLatestPassedRecoveryRehearsal,
  summarizeLatestRecoveryRehearsal,
} from "../src/ledger-formal-recovery-flow.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let importCounter = 0;

function uniqueImportSuffix(label) {
  importCounter += 1;
  return `${label}-${process.pid}-${Date.now()}-${importCounter}`;
}

function withEnv(overrides, operation) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = overrides[key];
  }
  return Promise.resolve()
    .then(operation)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value == null) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

test("formal recovery recency helpers keep newest rehearsal semantics stable", () => {
  const rehearsals = {
    rehearsals: [
      {
        rehearsalId: "rhr_new_fail",
        createdAt: "2026-04-23T00:00:00.000Z",
        status: "failed",
      },
      {
        rehearsalId: "rhr_old_pass",
        createdAt: "2026-04-22T00:00:00.000Z",
        status: "passed",
      },
    ],
  };

  const latestRecoveryRehearsal = summarizeLatestRecoveryRehearsal(rehearsals);
  const latestPassedRecoveryRehearsal = summarizeLatestPassedRecoveryRehearsal(rehearsals);

  assert.equal(calculateAgeHours("2026-04-23T00:00:00.000Z", "2026-04-23T06:30:00.000Z"), 6.5);
  assert.equal(calculateAgeHours("not-a-time", "2026-04-23T06:30:00.000Z"), null);
  assert.equal(latestRecoveryRehearsal.rehearsalId, "rhr_new_fail");
  assert.equal(latestPassedRecoveryRehearsal.rehearsalId, "rhr_old_pass");
  assert.equal(recoveryRehearsalSupersedesPassed(latestRecoveryRehearsal, latestPassedRecoveryRehearsal), true);
  assert.equal(recoveryRehearsalSupersedesPassed(latestPassedRecoveryRehearsal, latestPassedRecoveryRehearsal), false);
});

test("formal recovery treats the newest recovery rehearsal as authoritative", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-formal-rehearsal-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");
  const archiveDir = path.join(tmpDir, "archives");

  try {
    await withEnv(
      {
        AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_ARCHIVE_DIR: archiveDir,
        AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("formal-rehearsal-recency")}`);
        const store = {
          chainId: "agent-passport-rehearsal-recency",
          lastEventHash: null,
          agents: {},
          credentials: [],
          events: [],
          windows: {},
          memories: [],
          messages: [],
          passportMemories: [],
          conversationMinutes: [],
          taskSnapshots: [],
          transcriptEntries: [],
          recoveryRehearsals: [
            {
              rehearsalId: "rhr_old_pass",
              bundleId: "bundle_a",
              createdAt: "2026-04-22T00:00:00.000Z",
              status: "passed",
              checkCount: 4,
              passedCount: 4,
              failedCount: 0,
              summary: "older pass",
            },
            {
              rehearsalId: "rhr_new_fail",
              bundleId: "bundle_a",
              createdAt: "2026-04-23T00:00:00.000Z",
              status: "failed",
              checkCount: 4,
              passedCount: 0,
              failedCount: 4,
              summary: "newer failure",
            },
          ],
          readSessions: [],
          securityAnomalies: [],
          localReasonerProfiles: [],
          sandboxActionAudits: [],
          modelProfiles: [],
          runtimeMemoryStates: [],
          runtimeMemoryObservations: [],
          agentRuns: [],
          agentQueryStates: [],
          agentSessionStates: [],
          compactBoundaries: [],
          verificationRuns: [],
          deviceRuntime: {
            localMode: "online_enhanced",
            setupPolicy: {
              requireRecoveryBundle: false,
              requireSetupPackage: false,
              requireRecentRecoveryRehearsal: true,
              recoveryRehearsalMaxAgeHours: 168,
              requireKeychainWhenAvailable: false,
            },
          },
        };

        const setup = await ledger.getDeviceSetupStatus({ passive: true, store });
        const rehearsalCheck = setup.checks.find((entry) => entry.code === "recovery_rehearsal_recent");

        assert.equal(setup.latestRecoveryRehearsal.rehearsalId, "rhr_new_fail");
        assert.equal(setup.latestRecoveryRehearsalBlocksFreshness, true);
        assert.equal(rehearsalCheck.passed, false);
        assert.equal(rehearsalCheck.evidence.latestRecoveryRehearsal.rehearsalId, "rhr_new_fail");
        assert.equal(setup.formalRecoveryFlow.rehearsal.status, "failed");
        assert.equal(setup.formalRecoveryFlow.rehearsal.latestRecoveryRehearsal.rehearsalId, "rhr_new_fail");
        assert.equal(setup.formalRecoveryFlow.rehearsal.latestPassedRecoveryRehearsal.rehearsalId, "rhr_old_pass");
        assert.equal(setup.formalRecoveryFlow.operationalCadence.status, "failed");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("formal recovery keeps setup package raw resident fields while carrying effective owner truth into cross-device closure", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-formal-setup-binding-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");
  const archiveDir = path.join(tmpDir, "archives");

  try {
    fs.mkdirSync(recoveryDir, { recursive: true });
    fs.mkdirSync(setupPackageDir, { recursive: true });
    fs.writeFileSync(
      path.join(recoveryDir, "bundle_formal_binding.json"),
      JSON.stringify(
        {
          format: "agent-passport-store-recovery-v1",
          bundleId: "bundle_formal_binding",
          createdAt: "2026-04-24T00:00:00.000Z",
          machineId: "device_binding_machine",
          machineLabel: "Binding Machine",
          residentAgentId: "agent_openneed_agents",
          ledger: {
            envelope: {
              encrypted: true,
            },
          },
          storeKey: {
            mode: "wrapped_file",
          },
          metadata: {
            lastEventHash: "hash_binding_bundle",
            chainId: "agent-passport-formal-binding",
          },
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(setupPackageDir, "setup_formal_binding.json"),
      JSON.stringify(
        {
          format: "agent-passport-device-setup-v1",
          packageId: "setup_formal_binding",
          exportedAt: "2026-04-24T01:00:00.000Z",
          machineId: "device_binding_machine",
          machineLabel: "Binding Machine",
          residentAgentId: "agent_main",
          residentAgentReference: "agent_main",
          residentDidMethod: "agentpassport",
          setupStatus: {
            setupComplete: true,
            missingRequiredCodes: [],
          },
          recovery: {
            bundleCount: 1,
            latestBundle: {
              bundleId: "bundle_formal_binding",
            },
          },
        },
        null,
        2
      )
    );

    await withEnv(
      {
        AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_ARCHIVE_DIR: archiveDir,
        AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("formal-setup-binding")}`);
        const store = await ledger.loadStore();
        store.chainId = "agent-passport-formal-binding";
        store.agents = {
          agent_openneed_agents: {
            agentId: "agent_openneed_agents",
            displayName: "Main Agent",
          },
        };
        store.deviceRuntime = {
          ...store.deviceRuntime,
          residentAgentId: "agent_openneed_agents",
          residentDidMethod: "agentpassport",
          localMode: "online_enhanced",
          setupPolicy: {
            requireRecoveryBundle: false,
            requireSetupPackage: true,
            requireRecentRecoveryRehearsal: false,
            recoveryRehearsalMaxAgeHours: 168,
            requireKeychainWhenAvailable: false,
          },
        };

        const setup = await ledger.getDeviceSetupStatus({ passive: true, store });
        const latestPackage = setup.formalRecoveryFlow.setupPackage.latestPackage;
        const crossDevicePackage = setup.formalRecoveryFlow.crossDeviceRecoveryClosure.latestSetupPackage;

        assert.equal(latestPackage.residentAgentId, "agent_main");
        assert.equal(latestPackage.residentAgentReference, "agent_main");
        assert.equal(latestPackage.resolvedResidentAgentId, null);
        assert.equal(latestPackage.effectivePhysicalResidentAgentId, "agent_openneed_agents");
        assert.equal(latestPackage.effectiveResidentAgentReference, "agent_main");
        assert.equal(latestPackage.effectiveResolvedResidentAgentId, "agent_openneed_agents");
        assert.equal(latestPackage.canonicalResidentBinding?.residentAgentId, "agent_main");
        assert.equal(latestPackage.canonicalResidentBinding?.resolvedResidentAgentId, null);
        assert.equal(latestPackage.resolvedResidentBinding?.effectivePhysicalResidentAgentId, "agent_openneed_agents");
        assert.equal(latestPackage.resolvedResidentBinding?.effectiveResolvedResidentAgentId, "agent_openneed_agents");
        assert.equal("note" in latestPackage, false);
        assert.equal("packagePath" in latestPackage, false);
        assert.equal("recoveryBundleCount" in latestPackage, false);
        assert.equal("localReasonerProfileCount" in latestPackage, false);
        assert.equal(crossDevicePackage.residentAgentId, "agent_main");
        assert.equal(crossDevicePackage.effectivePhysicalResidentAgentId, "agent_openneed_agents");
        assert.equal(crossDevicePackage.effectiveResolvedResidentAgentId, "agent_openneed_agents");
        assert.equal(crossDevicePackage.resolvedResidentBinding?.effectivePhysicalResidentAgentId, "agent_openneed_agents");
        assert.equal(crossDevicePackage.resolvedResidentBinding?.effectiveResolvedResidentAgentId, "agent_openneed_agents");
        assert.equal(
          setup.formalRecoveryFlow.crossDeviceRecoveryClosure.setupPackageAlignment?.referencesLatestBundle,
          true
        );
        assert.equal(
          setup.formalRecoveryFlow.crossDeviceRecoveryClosure.setupPackageAlignment?.residentAgentAligned,
          true
        );
        assert.equal(
          setup.formalRecoveryFlow.crossDeviceRecoveryClosure.setupPackageAlignment?.residentDidMethodAligned,
          true
        );
        assert.equal(setup.formalRecoveryFlow.crossDeviceRecoveryClosure.setupPackageAlignment?.ready, true);
        assert.equal(
          setup.formalRecoveryFlow.crossDeviceRecoveryClosure.sourceBlockingReasons.includes(
            "setup_package_resident_agent_mismatch"
          ),
          false
        );
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

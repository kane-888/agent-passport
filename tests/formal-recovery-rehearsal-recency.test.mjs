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
        OPENNEED_LEDGER_PATH: ledgerPath,
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

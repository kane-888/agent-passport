import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

function writeRawPreservingTimestamp(filePath, raw, timestamp) {
  fs.writeFileSync(filePath, raw, "utf8");
  fs.utimesSync(filePath, timestamp, timestamp);
  return fs.statSync(filePath);
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

test("passive store reads do not materialize ledger, read-session store, or store key", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-passive-read-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const archiveDir = path.join(tmpDir, "archives");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");

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
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("passive-store-read")}`);

        const capabilities = await ledger.runWithPassiveStoreAccess(() => ledger.getCapabilities());
        assert.equal(capabilities.product?.name, "agent-passport");

        const inMemoryStore = await ledger.runWithPassiveStoreAccess(() => ledger.loadStore());
        assert.equal(typeof inMemoryStore.chainId, "string");
        assert.ok(inMemoryStore.chainId.length > 0, "passive in-memory store should keep a chain id");

        assert.equal(fs.existsSync(ledgerPath), false, "passive read must not create ledger.json");
        assert.equal(
          fs.existsSync(readSessionStorePath),
          false,
          "passive read must not create read-sessions.json"
        );
        assert.equal(fs.existsSync(storeKeyPath), false, "passive read must not create a store key");
        assert.equal(fs.existsSync(signingSecretPath), false, "passive read must not create a signing secret");
        assert.equal(fs.existsSync(recoveryDir), false, "passive read must not create recovery bundle directory");
        assert.equal(fs.existsSync(archiveDir), false, "passive read must not create archive directory");
        assert.equal(fs.existsSync(setupPackageDir), false, "passive read must not create setup package directory");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("invalid read-session validation does not materialize stores before denial", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-invalid-read-session-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("invalid-read-session-denial")}`);
        const validation = await ledger.validateReadSessionToken("not-a-real-token", {
          scope: "offline_chat",
          touch: true,
        });

        assert.equal(validation.valid, false);
        assert.equal(fs.existsSync(readSessionStorePath), false, "invalid validation must not create read-sessions.json");
        assert.equal(fs.existsSync(ledgerPath), false, "invalid validation must not create ledger.json");
        assert.equal(fs.existsSync(storeKeyPath), false, "invalid validation must not create a store key");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("passive store encryption peek reports unavailable without creating a key", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-passive-encryption-status-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_STORE_KEY: "",
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("passive-encryption-status")}`);

        const status = await ledger.peekStoreEncryptionStatus();
        assert.equal(status.ready, false);
        assert.equal(status.available, false);
        assert.equal(status.source, null);
        assert.equal(status.keyPath, null);
        assert.equal(fs.existsSync(storeKeyPath), false, "passive encryption peek must not create a store key");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("passive store reads distinguish missing ledger from missing store key", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-passive-missing-key-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const archiveDir = path.join(tmpDir, "archives");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");

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
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("passive-store-missing-key")}`);

        const initialized = await ledger.loadStore();
        assert.ok(initialized.chainId);
        assert.equal(fs.existsSync(ledgerPath), true, "setup should create encrypted ledger.json");
        assert.equal(fs.existsSync(storeKeyPath), true, "setup should create the encryption key");

        fs.rmSync(storeKeyPath, { force: true });

        const status = await ledger.runWithPassiveStoreAccess(() =>
          ledger.loadStoreIfPresentStatus({ migrate: false, createKey: false })
        );
        assert.equal(status.store, null);
        assert.equal(status.present, true);
        assert.equal(status.missingLedger, false);
        assert.equal(status.missingKey, true);
        assert.equal(status.code, "store_key_unavailable");

        const setup = await ledger.getDeviceSetupStatus({ passive: true });
        assert.equal(setup.initialized, false);
        assert.equal(setup.storePresent, true);
        assert.equal(setup.missingLedger, false);
        assert.equal(setup.missingStoreKey, true);
        assert.equal(setup.recoveryRequired, true);
        assert.deepEqual(setup.missingRequiredCodes, ["store_key_unavailable"]);

        assert.equal(fs.existsSync(storeKeyPath), false, "passive missing-key read must not recreate store key");
        assert.equal(
          fs.existsSync(signingSecretPath),
          false,
          "passive missing-key read must not create a signing secret"
        );
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("active store initialization regenerates key only after ledger and key are both removed", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-active-reset-key-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("active-reset-key")}`);

        await ledger.loadStore();
        assert.equal(fs.existsSync(ledgerPath), true, "setup should create encrypted ledger.json");
        assert.equal(fs.existsSync(storeKeyPath), true, "setup should create the encryption key");

        fs.rmSync(ledgerPath, { force: true });
        fs.rmSync(storeKeyPath, { force: true });

        const resetStore = await ledger.loadStore();
        assert.equal(typeof resetStore.chainId, "string");
        assert.equal(fs.existsSync(ledgerPath), true, "active reset should recreate ledger.json");
        assert.equal(fs.existsSync(storeKeyPath), true, "active reset should recreate the missing store key");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("active store load does not create a replacement key for an encrypted ledger with a missing key", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-active-missing-key-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
  const childEnv = {
    ...process.env,
    OPENNEED_LEDGER_PATH: ledgerPath,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
    AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
    AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
  };

  try {
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { loadStore } from ${JSON.stringify(ledgerUrl)}; await loadStore();`,
      ],
      {
        cwd: rootDir,
        env: childEnv,
        stdio: "pipe",
      }
    );
    assert.equal(fs.existsSync(ledgerPath), true, "setup should create encrypted ledger.json");
    assert.equal(fs.existsSync(storeKeyPath), true, "setup should create the encryption key");

    fs.rmSync(storeKeyPath, { force: true });

    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          `import { loadStore } from ${JSON.stringify(ledgerUrl)};`,
          "let code = null;",
          "try {",
          "  await loadStore();",
          "} catch (error) {",
          "  code = error?.code || error?.message || null;",
          "}",
          "console.log(JSON.stringify({ code }));",
        ].join("\n"),
      ],
      {
        cwd: rootDir,
        env: childEnv,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    const result = JSON.parse(output);

    assert.equal(result.code, "STORE_KEY_NOT_FOUND");
    assert.equal(fs.existsSync(storeKeyPath), false, "active missing-key load must not create a replacement key");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("active store load rejects corrupted file-record store keys instead of migrating them as legacy", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-invalid-store-key-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(
          storeKeyPath,
          `${JSON.stringify({
            format: "agent-passport-store-key-v1",
            createdAt: "2026-04-19T00:00:00.000Z",
            keyBase64: Buffer.alloc(8, 1).toString("base64"),
          })}\n`,
          "utf8"
        );
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("invalid-store-key")}`);

        await assert.rejects(() => ledger.loadStore(), { code: "STORE_KEY_INVALID" });
        const keyRecord = JSON.parse(fs.readFileSync(storeKeyPath, "utf8"));
        assert.equal(keyRecord.source, undefined, "corrupted v1 key must not be rewritten as legacy_file_migrated");
        assert.equal(fs.existsSync(ledgerPath), false, "invalid key must block active ledger creation");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("active store load rejects unknown JSON store key formats instead of replacing them", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-unknown-json-store-key-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(
          storeKeyPath,
          `${JSON.stringify({
            format: "agent-passport-store-key-v2",
            createdAt: "2026-04-19T00:00:00.000Z",
            keyBase64: Buffer.alloc(32, 3).toString("base64"),
          })}\n`,
          "utf8"
        );
        const originalKeyFile = fs.readFileSync(storeKeyPath, "utf8");
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("unknown-json-store-key")}`);

        await assert.rejects(() => ledger.loadStore(), { code: "STORE_KEY_INVALID" });
        assert.equal(fs.readFileSync(storeKeyPath, "utf8"), originalKeyFile);
        assert.equal(fs.existsSync(ledgerPath), false, "unknown JSON key format must block active ledger creation");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("same-process store reads invalidate cached plaintext when the file key identity changes", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-store-key-rotation-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("store-key-rotation")}`);

        await ledger.loadStore();
        fs.writeFileSync(
          storeKeyPath,
          `${JSON.stringify({
            format: "agent-passport-store-key-v1",
            createdAt: "2026-04-19T00:00:00.000Z",
            source: "test_rotation",
            keyBase64: Buffer.alloc(32, 7).toString("base64"),
          })}\n`,
          "utf8"
        );

        await assert.rejects(
          () => ledger.loadStore(),
          (error) => error instanceof Error,
          "same-process load must not return cached plaintext after key identity changes"
        );
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("same-process ledger cache refreshes after same-size same-mtime replacement", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-ledger-cache-refresh-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const timestamp = new Date("2026-01-01T00:00:00.000Z");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const childEnv = {
          ...process.env,
          OPENNEED_LEDGER_PATH: ledgerPath,
          AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
          AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
          AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
          AGENT_PASSPORT_USE_KEYCHAIN: "0",
        };
        const generateRawLedger = (modelName) => {
          fs.rmSync(ledgerPath, { force: true });
          execFileSync(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              [
                `import { configureDeviceRuntime } from ${JSON.stringify(ledgerUrl)};`,
                "await configureDeviceRuntime({",
                '  residentAgentId: "agent_openneed_agents",',
                '  residentDidMethod: "agentpassport",',
                "  localReasonerEnabled: true,",
                '  localReasonerProvider: "local_command",',
                `  localReasonerModel: ${JSON.stringify(modelName)},`,
                "});",
              ].join("\n"),
            ],
            {
              cwd: rootDir,
              env: childEnv,
              stdio: "pipe",
            }
          );
          return fs.readFileSync(ledgerPath, "utf8");
        };
        const rawA = generateRawLedger("model_a");
        const rawB = generateRawLedger("model_b");
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("ledger-cache-refresh")}`);

        const firstStats = writeRawPreservingTimestamp(ledgerPath, rawA, timestamp);
        const first = await ledger.loadStore();

        const secondStats = writeRawPreservingTimestamp(ledgerPath, rawB, timestamp);
        const second = await ledger.loadStore();

        assert.equal(first.deviceRuntime?.localReasoner?.model, "model_a");
        assert.equal(second.deviceRuntime?.localReasoner?.model, "model_b");
        assert.equal(secondStats.size, firstStats.size);
        assert.equal(secondStats.mtimeMs, firstStats.mtimeMs);
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("same-process read-session cache refreshes after same-size same-mtime replacement", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-read-session-cache-refresh-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const timestamp = new Date("2026-01-01T00:00:00.000Z");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("read-session-cache-refresh")}`);

        await ledger.createReadSession({
          label: "cache-a",
          role: "runtime_observer",
          scopes: ["device_runtime"],
        });
        const rawA = fs.readFileSync(readSessionStorePath, "utf8");
        const firstStats = writeRawPreservingTimestamp(readSessionStorePath, rawA, timestamp);
        const first = await ledger.listReadSessions();

        const replacement = JSON.parse(rawA);
        replacement.readSessions[0].label = "cache-b";
        const rawB = JSON.stringify(replacement, null, 2);
        const secondStats = writeRawPreservingTimestamp(readSessionStorePath, rawB, timestamp);
        const second = await ledger.listReadSessions();

        assert.equal(first.sessions[0]?.label, "cache-a");
        assert.equal(second.sessions[0]?.label, "cache-b");
        assert.equal(secondStats.size, firstStats.size);
        assert.equal(secondStats.mtimeMs, firstStats.mtimeMs);
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("passive device setup status does not initialize signing master secret", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-passive-signing-secret-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const archiveDir = path.join(tmpDir, "archives");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");

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
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("passive-signing-secret")}`);

        await ledger.loadStore();
        assert.equal(fs.existsSync(ledgerPath), true, "setup should create encrypted ledger.json");
        fs.rmSync(signingSecretPath, { force: true });

        const setup = await ledger.getDeviceSetupStatus({ passive: true });
        assert.equal(setup.setupComplete, false);
        assert.ok(setup.missingRequiredCodes.includes("signing_key_ready"));
        const signingCheck = setup.checks.find((item) => item.code === "signing_key_ready");
        assert.equal(signingCheck?.passed, false);
        assert.equal(signingCheck?.evidence?.ready, false);
        assert.equal(signingCheck?.evidence?.source, null);
        assert.equal(fs.existsSync(signingSecretPath), false, "passive setup status must not create signing secret");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("passive setup package dry-run does not initialize signing master secret", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-passive-setup-package-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const archiveDir = path.join(tmpDir, "archives");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_SIGNING_MASTER_SECRET: "",
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_ARCHIVE_DIR: archiveDir,
        AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("passive-setup-package")}`);

        await ledger.loadStore();
        fs.rmSync(signingSecretPath, { force: true });

        const exported = await ledger.runWithPassiveStoreAccess(() =>
          ledger.exportDeviceSetupPackage({
            dryRun: true,
            saveToFile: false,
            returnPackage: true,
          })
        );

        assert.equal(exported.dryRun, true);
        assert.equal(exported.package?.format, "agent-passport-device-setup-v1");
        assert.equal(fs.existsSync(signingSecretPath), false, "passive setup package preview must not create signing secret");
        assert.equal(fs.existsSync(setupPackageDir), false, "dry-run setup package preview must not create package dir");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("setup package dry-run preview does not initialize ledger, store key, signing secret, or package dir", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-setup-package-preview-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const archiveDir = path.join(tmpDir, "archives");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_SIGNING_MASTER_SECRET: "",
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_ARCHIVE_DIR: archiveDir,
        AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("setup-package-preview")}`);

        const exported = await ledger.exportDeviceSetupPackage({
          dryRun: true,
          saveToFile: false,
          returnPackage: true,
        });

        assert.equal(exported.dryRun, true);
        assert.equal(exported.package?.format, "agent-passport-device-setup-v1");
        assert.equal(fs.existsSync(ledgerPath), false, "setup package dry-run preview must not create ledger.json");
        assert.equal(
          fs.existsSync(readSessionStorePath),
          false,
          "setup package dry-run preview must not create read-sessions.json"
        );
        assert.equal(fs.existsSync(storeKeyPath), false, "setup package dry-run preview must not create a store key");
        assert.equal(
          fs.existsSync(signingSecretPath),
          false,
          "setup package dry-run preview must not create a signing secret"
        );
        assert.equal(fs.existsSync(recoveryDir), false, "setup package dry-run preview must not create recovery dir");
        assert.equal(fs.existsSync(archiveDir), false, "setup package dry-run preview must not create archive dir");
        assert.equal(
          fs.existsSync(setupPackageDir),
          false,
          "setup package dry-run preview must not create package dir"
        );
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("device setup dry-run preview with recovery passphrase does not initialize ledger, read-session store, or store key", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-device-setup-preview-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const archiveDir = path.join(tmpDir, "archives");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_SIGNING_MASTER_SECRET: "",
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_ARCHIVE_DIR: archiveDir,
        AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("device-setup-preview")}`);

        const setup = await ledger.runDeviceSetup({
          dryRun: true,
          residentAgentId: "agent_openneed_agents",
          residentDidMethod: "agentpassport",
          recoveryPassphrase: "dry-run-recovery-preview-only",
        });

        assert.equal(setup.status?.setupComplete, false);
        assert.equal(setup.recoveryExport?.skipped, true);
        assert.equal(setup.recoveryExport?.reason, "encrypted_ledger_envelope_missing");
        assert.equal(setup.recoveryRehearsal?.skipped, true);
        assert.equal(fs.existsSync(ledgerPath), false, "device setup dry-run preview must not create ledger.json");
        assert.equal(
          fs.existsSync(readSessionStorePath),
          false,
          "device setup dry-run preview must not create read-sessions.json"
        );
        assert.equal(fs.existsSync(storeKeyPath), false, "device setup dry-run preview must not create a store key");
        assert.equal(
          fs.existsSync(signingSecretPath),
          false,
          "device setup dry-run preview must not create a signing secret"
        );
        assert.equal(fs.existsSync(recoveryDir), false, "device setup dry-run preview must not create recovery dir");
        assert.equal(fs.existsSync(archiveDir), false, "device setup dry-run preview must not create archive dir");
        assert.equal(
          fs.existsSync(setupPackageDir),
          false,
          "device setup dry-run preview must not create package dir"
        );
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("agent runtime bootstrap dry-run does not initialize ledger or store key", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-bootstrap-dry-run-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("bootstrap-dry-run")}`);

        const bootstrap = await ledger.bootstrapAgentRuntime("agent_openneed_agents", {
          dryRun: true,
          currentGoal: "preview bootstrap only",
        });

        assert.equal(bootstrap.bootstrap?.dryRun, true);
        assert.equal(bootstrap.persisted?.bootstrap, false);
        assert.equal(fs.existsSync(ledgerPath), false, "bootstrap dry-run must not create ledger.json");
        assert.equal(fs.existsSync(readSessionStorePath), false, "bootstrap dry-run must not create read-sessions.json");
        assert.equal(fs.existsSync(storeKeyPath), false, "bootstrap dry-run must not create a store key");
        assert.equal(fs.existsSync(signingSecretPath), false, "bootstrap dry-run must not create a signing secret");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("recovery export dry-run skips empty stores without initializing ledger or store key", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-recovery-export-dry-run-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("recovery-export-dry-run")}`);

        const recovery = await ledger.exportStoreRecoveryBundle({
          passphrase: "preview-only-passphrase",
          dryRun: true,
          saveToFile: false,
          returnBundle: true,
        });

        assert.equal(recovery.dryRun, true);
        assert.equal(recovery.skipped, true);
        assert.equal(recovery.reason, "encrypted_ledger_envelope_missing");
        assert.equal(fs.existsSync(ledgerPath), false, "recovery export dry-run must not create ledger.json");
        assert.equal(fs.existsSync(readSessionStorePath), false, "recovery export dry-run must not create read-sessions.json");
        assert.equal(fs.existsSync(storeKeyPath), false, "recovery export dry-run must not create a store key");
        assert.equal(fs.existsSync(signingSecretPath), false, "recovery export dry-run must not create a signing secret");
        assert.equal(fs.existsSync(recoveryDir), false, "recovery export dry-run must not create recovery dir");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("recovery export dry-run reports missing store key without recreating it", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-recovery-export-missing-key-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("recovery-export-missing-key")}`);

        await ledger.loadStore();
        assert.equal(fs.existsSync(ledgerPath), true, "setup should create an encrypted ledger fixture");
        assert.equal(fs.existsSync(storeKeyPath), true, "setup should create a store key fixture");
        fs.rmSync(storeKeyPath, { force: true });

        const recovery = await ledger.exportStoreRecoveryBundle({
          passphrase: "preview-only-passphrase",
          dryRun: true,
          saveToFile: false,
          returnBundle: true,
        });

        assert.equal(recovery.dryRun, true);
        assert.equal(recovery.skipped, true);
        assert.equal(recovery.reason, "store_key_unavailable");
        assert.equal(fs.existsSync(ledgerPath), true, "dry-run should leave the existing ledger fixture in place");
        assert.equal(fs.existsSync(readSessionStorePath), false, "recovery export dry-run must not create read-sessions.json");
        assert.equal(fs.existsSync(storeKeyPath), false, "recovery export dry-run must not recreate a store key");
        assert.equal(fs.existsSync(recoveryDir), false, "recovery export dry-run must not create recovery dir");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("recovery rehearsal dry-run reads missing current store passively", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-recovery-rehearsal-dry-run-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("recovery-rehearsal-dry-run")}`);
        const passphrase = "preview-rehearsal-passphrase";

        await ledger.loadStore();
        const recovery = await ledger.exportStoreRecoveryBundle({
          passphrase,
          dryRun: false,
          saveToFile: false,
          returnBundle: true,
        });
        fs.rmSync(ledgerPath, { force: true });
        fs.rmSync(storeKeyPath, { force: true });

        const rehearsal = await ledger.rehearseStoreRecoveryBundle({
          passphrase,
          bundle: recovery.bundle,
          dryRun: true,
          persist: false,
        });

        assert.equal(rehearsal.rehearsal?.dryRun, true);
        assert.equal(rehearsal.rehearsal?.persisted, false);
        assert.ok(
          rehearsal.rehearsal?.checks?.some(
            (entry) => entry.code === "current_store_loaded" && entry.passed === false
          ),
          "recovery rehearsal dry-run should report missing current store instead of creating one"
        );
        assert.equal(fs.existsSync(ledgerPath), false, "recovery rehearsal dry-run must not recreate ledger.json");
        assert.equal(fs.existsSync(readSessionStorePath), false, "recovery rehearsal dry-run must not create read-sessions.json");
        assert.equal(fs.existsSync(storeKeyPath), false, "recovery rehearsal dry-run must not recreate a store key");
        assert.equal(fs.existsSync(signingSecretPath), false, "recovery rehearsal dry-run must not create a signing secret");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("passive read-session listing skips legacy ledger migration", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-passive-read-sessions-"));
  const ledgerPath = path.join(tmpDir, "ledger-as-directory");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    fs.mkdirSync(ledgerPath);
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("passive-read-sessions")}`);

        const sessions = await ledger.runWithPassiveStoreAccess(() => ledger.peekReadSessions());
        assert.deepEqual(sessions, { count: 0, sessions: [] });
        assert.equal(fs.existsSync(readSessionStorePath), false, "passive read-session GET must not create a store");
        assert.equal(fs.existsSync(storeKeyPath), false, "passive read-session GET must not create a store key");
        assert.equal(fs.existsSync(signingSecretPath), false, "passive read-session GET must not create a signing secret");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("passive protocol truth uses peeked read-session counts without legacy ledger migration", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-passive-protocol-"));
  const ledgerPath = path.join(tmpDir, "ledger-as-directory");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    fs.mkdirSync(ledgerPath);
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("passive-protocol")}`);

        const protocol = await ledger.runWithPassiveStoreAccess(() =>
          ledger.getProtocol({
            store: {
              chainId: "agent-passport-passive-test",
              agents: {},
              credentials: [],
            },
          })
        );
        assert.equal(protocol.protocol?.chainId, "agent-passport-passive-test");
        assert.equal(protocol.counts?.readSessions, 0);
        assert.equal(fs.existsSync(readSessionStorePath), false, "passive protocol GET must not create read-session store");
        assert.equal(fs.existsSync(storeKeyPath), false, "passive protocol GET must not create a store key");
        assert.equal(fs.existsSync(signingSecretPath), false, "passive protocol GET must not create a signing secret");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("passive device runtime state uses peeked read-session counts without legacy ledger migration", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-passive-device-runtime-"));
  const ledgerPath = path.join(tmpDir, "ledger-as-directory");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    fs.mkdirSync(ledgerPath);
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("passive-device-runtime")}`);

        const runtimeState = await ledger.runWithPassiveStoreAccess(() =>
          ledger.getDeviceRuntimeState({
            store: {
              chainId: "agent-passport-passive-test",
              agents: {},
              credentials: [],
              deviceRuntime: {},
            },
          })
        );
        assert.equal(runtimeState.counts?.readSessions, 0);
        assert.equal(fs.existsSync(readSessionStorePath), false, "passive device runtime GET must not create read-session store");
        assert.equal(fs.existsSync(storeKeyPath), false, "passive device runtime GET must not create a store key");
        assert.equal(fs.existsSync(signingSecretPath), false, "passive device runtime GET must not create a signing secret");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

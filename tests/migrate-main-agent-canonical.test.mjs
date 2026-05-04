import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile, spawn } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootDir, "scripts", "migrate-main-agent-canonical.mjs");
const CANONICAL_MAIN_AGENT_ID = "agent_main";
const LEGACY_MAIN_AGENT_ID = "agent_openneed_agents";
const STORE_KEY_RECORD_FORMAT = "agent-passport-store-key-v1";
const STORE_ENVELOPE_FORMAT = "agent-passport-ledger-encrypted-v1";
const STORE_ENVELOPE_ALGORITHM = "aes-256-gcm";
let importCounter = 0;

function uniqueImportSuffix(label) {
  importCounter += 1;
  return `${label}-${process.pid}-${Date.now()}-${importCounter}`;
}

function withEnv(overrides, operation) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
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

async function importLedgerModule() {
  const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
  return import(`${ledgerUrl}?${uniqueImportSuffix("main-agent-migration")}`);
}

async function importMigrationModule() {
  const migrationUrl = pathToFileURL(
    path.join(rootDir, "src", "main-agent-canonical-migration.js")
  ).href;
  return import(`${migrationUrl}?${uniqueImportSuffix("main-agent-migration-fixture")}`);
}

async function runMigrationScript(args, env) {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    env: {
      ...process.env,
      ...env,
    },
  });
  return JSON.parse(stdout);
}

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!Number.isFinite(port)) {
    throw new Error("Unable to resolve a free HTTP port for migration route verification");
  }
  return port;
}

async function waitForServer(baseUrl, output, { timeoutMs = 10000 } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/security`, {
        headers: {
          Connection: "close",
        },
      });
      if (response.ok) {
        await response.text().catch(() => {});
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
      await response.text().catch(() => {});
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const details = [output?.stdout?.trim(), output?.stderr?.trim()].filter(Boolean).join("\n");
  throw new Error(
    `Timed out waiting for migration verification server at ${baseUrl}${
      details ? `\n${details}` : ""
    }${lastError?.message ? `\n${lastError.message}` : ""}`
  );
}

async function withMigrationVerificationServer(env, operation) {
  const port = await getAvailablePort();
  const adminToken = `main-agent-migration-admin-${process.pid}-${Date.now()}`;
  const output = {
    stdout: "",
    stderr: "",
  };
  const child = spawn(process.execPath, [path.join(rootDir, "src", "server.js")], {
    cwd: rootDir,
    env: {
      ...process.env,
      ...env,
      HOST: "127.0.0.1",
      PORT: String(port),
      AGENT_PASSPORT_ADMIN_TOKEN: adminToken,
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => {
    output.stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output.stderr += String(chunk);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(baseUrl, output);
    return await operation({ baseUrl, adminToken });
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("close", resolve);
        setTimeout(resolve, 1000);
      });
    }
  }
}

async function fetchAdminJson(baseUrl, adminToken, resourcePath, options = {}) {
  const response = await fetch(`${baseUrl}${resourcePath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Connection: "close",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  return {
    status: response.status,
    payload: raw ? JSON.parse(raw) : null,
  };
}

function resolvePolicyApprovalInputs(agentPayload = null, { requestedAgentId = null } = {}) {
  const signers = Array.isArray(agentPayload?.agent?.identity?.authorizationPolicy?.signers)
    ? agentPayload.agent.identity.authorizationPolicy.signers
    : [];
  const thresholdValue = Number(agentPayload?.agent?.identity?.authorizationPolicy?.threshold);
  const threshold = Number.isFinite(thresholdValue) && thresholdValue > 0 ? Math.floor(thresholdValue) : 1;
  return signers
    .map((signer) => {
      const signerLabel =
        typeof signer?.label === "string" && signer.label.trim() ? signer.label.trim() : null;
      const walletAddress =
        typeof signer?.walletAddress === "string" && signer.walletAddress.trim()
          ? signer.walletAddress.trim().toLowerCase()
          : null;
      return walletAddress || signerLabel;
    })
    .filter(Boolean)
    .slice(0, threshold);
}

function extractCredentialIdentity(evidencePayload = null) {
  const primaryRecord = evidencePayload?.evidence?.credentialRecord || null;
  if (primaryRecord?.credentialId || primaryRecord?.credentialRecordId) {
    return primaryRecord;
  }
  const firstVariantRecord =
    Array.isArray(evidencePayload?.variants) &&
    evidencePayload.variants.find((entry) => entry?.evidence?.credentialRecord)?.evidence?.credentialRecord;
  return firstVariantRecord || null;
}

function encodeBase64(value) {
  return Buffer.from(value).toString("base64");
}

function readStoreKeyFromFile(storeKeyPath) {
  const parsed = JSON.parse(fs.readFileSync(storeKeyPath, "utf8"));
  assert.equal(parsed?.format, STORE_KEY_RECORD_FORMAT);
  return Buffer.from(parsed.keyBase64, "base64");
}

function encryptStoreFixture(store, storeKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(STORE_ENVELOPE_ALGORITHM, storeKey, iv);
  const plaintext = Buffer.from(JSON.stringify(store, null, 2), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: STORE_ENVELOPE_FORMAT,
    algorithm: STORE_ENVELOPE_ALGORITHM,
    keyMode: "file_record",
    createdAt: new Date().toISOString(),
    iv: encodeBase64(iv),
    tag: encodeBase64(cipher.getAuthTag()),
    ciphertext: encodeBase64(ciphertext),
  };
}

async function seedLegacyMainAgentPhysicalStore({
  env,
  ledgerPath,
  storeKeyPath,
}) {
  await withEnv(env, async () => {
    const ledger = await importLedgerModule();
    const migration = await importMigrationModule();
    await ledger.loadStore();
    await ledger.configureDeviceRuntime({
      residentAgentId: CANONICAL_MAIN_AGENT_ID,
      residentLocked: false,
    });
    const store = await ledger.loadStore();
    const rewritten = migration.rewriteStructuredAgentReferencesInValue(store, {
      fromAgentId: CANONICAL_MAIN_AGENT_ID,
      toAgentId: LEGACY_MAIN_AGENT_ID,
    }).value;
    const canonicalAgent = store?.agents?.[CANONICAL_MAIN_AGENT_ID];
    assert.equal(Boolean(canonicalAgent), true);
    const migratedLegacyAgent = rewritten?.agents?.[LEGACY_MAIN_AGENT_ID] || {};
    rewritten.agents = {
      ...(rewritten.agents || {}),
      [LEGACY_MAIN_AGENT_ID]: {
        ...canonicalAgent,
        ...migratedLegacyAgent,
        agentId: LEGACY_MAIN_AGENT_ID,
      },
    };
    delete rewritten.agents[CANONICAL_MAIN_AGENT_ID];

    const storeKey = readStoreKeyFromFile(storeKeyPath);
    const envelope = encryptStoreFixture(rewritten, storeKey);
    fs.writeFileSync(ledgerPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  });
}

async function assertCanonicalRouteVerification({
  baseUrl,
  adminToken,
  requestedAgentId = CANONICAL_MAIN_AGENT_ID,
  expectedPhysicalOwnerAgentId,
}) {
  const agentResponse = await fetchAdminJson(
    baseUrl,
    adminToken,
    `/api/agents/${encodeURIComponent(requestedAgentId)}`
  );
  assert.equal(agentResponse.status, 200);
  assert.equal(agentResponse.payload?.agent?.agentId, expectedPhysicalOwnerAgentId);

  const legacyAliasResponse = await fetchAdminJson(
    baseUrl,
    adminToken,
    `/api/agents/${encodeURIComponent(LEGACY_MAIN_AGENT_ID)}`
  );
  assert.equal(legacyAliasResponse.status, 200);
  assert.equal(legacyAliasResponse.payload?.agent?.agentId, expectedPhysicalOwnerAgentId);

  const authorizationResponse = await fetchAdminJson(baseUrl, adminToken, "/api/authorizations", {
    method: "POST",
    body: JSON.stringify({
      policyAgentId: requestedAgentId,
      actionType: "grant_asset",
      title: `migration-route-${expectedPhysicalOwnerAgentId}`,
      description: "main-agent canonical migration route verification",
      payload: {
        fromAgentId: requestedAgentId,
        targetAgentId: "agent_treasury",
        amount: 1,
        assetType: "credits",
        reason: "canonical route verification",
      },
      approvals: resolvePolicyApprovalInputs(agentResponse.payload, { requestedAgentId }),
      delaySeconds: 0,
      expiresInSeconds: 600,
    }),
  });
  assert.equal(authorizationResponse.status, 201);
  assert.equal(authorizationResponse.payload?.authorization?.policyAgentId, expectedPhysicalOwnerAgentId);
  assert.equal(
    Array.isArray(authorizationResponse.payload?.authorization?.signatureRecords),
    true
  );
  assert.equal(
    authorizationResponse.payload.authorization.signatureRecords.every(
      (record) => record?.recordedByAgentId === expectedPhysicalOwnerAgentId
    ),
    true
  );

  const compareEvidenceResponse = await fetchAdminJson(
    baseUrl,
    adminToken,
    "/api/agents/compare/evidence",
    {
      method: "POST",
      body: JSON.stringify({
        leftAgentId: requestedAgentId,
        rightAgentId: "agent_treasury",
        issuerAgentId: requestedAgentId,
        issuerDidMethod: "agentpassport",
        persist: true,
      }),
    }
  );
  assert.equal(compareEvidenceResponse.status, 200);
  const credentialRecord = extractCredentialIdentity(compareEvidenceResponse.payload);
  assert.equal(Boolean(credentialRecord?.credentialId || credentialRecord?.credentialRecordId), true);
  assert.equal(credentialRecord?.issuerAgentId, expectedPhysicalOwnerAgentId);

  const createdCredentialId = credentialRecord?.credentialId || null;
  const createdCredentialRecordId = credentialRecord?.credentialRecordId || null;

  const credentialsResponse = await fetchAdminJson(
    baseUrl,
    adminToken,
    `/api/credentials?agentId=${encodeURIComponent(requestedAgentId)}&limit=20`
  );
  assert.equal(credentialsResponse.status, 200);
  assert.equal(Array.isArray(credentialsResponse.payload?.credentials), true);
  assert.equal(
    credentialsResponse.payload.credentials.some(
      (entry) =>
        entry?.issuerAgentId === expectedPhysicalOwnerAgentId &&
        (entry?.credentialId === createdCredentialId ||
          entry?.credentialRecordId === createdCredentialRecordId)
    ),
    true
  );

  const legacyCredentialsResponse = await fetchAdminJson(
    baseUrl,
    adminToken,
    `/api/credentials?agentId=${encodeURIComponent(LEGACY_MAIN_AGENT_ID)}&limit=20`
  );
  assert.equal(legacyCredentialsResponse.status, 200);
  assert.equal(Array.isArray(legacyCredentialsResponse.payload?.credentials), true);
  assert.equal(
    legacyCredentialsResponse.payload.credentials.some(
      (entry) =>
        entry?.credentialId === createdCredentialId ||
        entry?.credentialRecordId === createdCredentialRecordId
    ),
    true
  );
}

function assertIdentityOwnerBinding(binding, currentPhysicalAgentId) {
  assert.equal(binding?.currentPhysicalAgentId, currentPhysicalAgentId);
  assert.deepEqual(binding?.requestedAgentIds, [CANONICAL_MAIN_AGENT_ID, LEGACY_MAIN_AGENT_ID]);
  assert.equal(binding?.allResolvedToCurrentPhysicalOwner, true);
  assert.equal(
    binding?.resolutionByRequestedAgentId?.[CANONICAL_MAIN_AGENT_ID]?.resolvedAgentId,
    currentPhysicalAgentId
  );
  assert.equal(
    binding?.resolutionByRequestedAgentId?.[LEGACY_MAIN_AGENT_ID]?.resolvedAgentId,
    currentPhysicalAgentId
  );
}

test("main-agent migration script previews, applies, and rolls back the physical main-agent id", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-main-agent-migration-"));
  const ledgerPath = path.join(tempDir, "ledger.json");
  const archiveRoot = path.join(tempDir, "archives");
  const legacyArchiveDir = path.join(archiveRoot, "agent_openneed_agents");
  const canonicalArchiveDir = path.join(archiveRoot, "agent_main");
  const readSessionStorePath = path.join(tempDir, "read-sessions.json");
  const storeKeyPath = path.join(tempDir, ".ledger-key");
  const signingSecretPath = path.join(tempDir, ".did-signing-master-secret");
  const passphrase = "main-agent-canonical-test-passphrase";
  const env = {
    AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
    AGENT_PASSPORT_ARCHIVE_DIR: archiveRoot,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
    AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
    AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
  };

  try {
    await seedLegacyMainAgentPhysicalStore({
      env,
      ledgerPath,
      storeKeyPath,
    });
    fs.mkdirSync(legacyArchiveDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyArchiveDir, "passport-memory.jsonl"),
      `${JSON.stringify({
        kind: "passport_memory",
        agentId: "agent_openneed_agents",
        record: {
          agentId: "agent_openneed_agents",
          passportMemoryId: "pmem_test_1",
          recordedByAgentId: "agent_openneed_agents",
          payload: {
            sourceAgentId: "agent_openneed_agents",
          },
        },
      })}\n`,
      "utf8"
    );

    const dryRun = await runMigrationScript(["--dry-run"], env);
    assert.equal(dryRun.mode, "dry_run");
    assert.equal(dryRun.preview.status, "ready");
    assert.equal(dryRun.preview.readyToApply, true);
    assert.equal(dryRun.archiveContentRewriteMode, "directory_rename_only_jsonl_not_rewritten");
    assert.equal(dryRun.targetPaths?.legacyArchiveDir, legacyArchiveDir);
    assert.equal(dryRun.targetPaths?.canonicalArchiveDir, canonicalArchiveDir);
    assert.equal(dryRun.preflightVerification?.archiveDirState, "legacy_only");
    assert.equal(dryRun.preflightVerification?.archivePathAlignedWithCurrentPhysicalId, true);
    assert.equal(dryRun.preview.archiveJsonlStructuredAudit?.physical?.activeArchiveDirKey, "legacy");
    assert.equal(
      dryRun.preview.archiveJsonlStructuredAudit?.directories?.legacy?.archiveDir,
      legacyArchiveDir
    );
    assert.equal(
      dryRun.preview.archiveJsonlStructuredAudit?.directories?.legacy?.counts?.scannedFileCount,
      1
    );
    assert.equal(dryRun.preflightVerification?.archiveJsonlStructuredAuditTarget, "legacy");
    assert.equal(dryRun.preflightVerification?.archiveJsonlStructuredAuditComplete, true);
    assert.equal(dryRun.preflightVerification?.archiveJsonlStructuredAuditLegacyResidueDetected, true);
    assert.equal(
      dryRun.preview.archiveJsonlStructuredAudit?.directories?.legacy?.counts?.legacyReferenceCount,
      4
    );
    assert.equal(dryRun.preview.archiveJsonlStructuredAudit?.byField?.agentId?.legacy, 2);
    assert.equal(dryRun.preview.archiveJsonlStructuredAudit?.byField?.recordedByAgentId?.legacy, 1);
    assert.equal(dryRun.preview.archiveJsonlStructuredAudit?.byField?.sourceAgentId?.legacy, 1);
    assertIdentityOwnerBinding(
      dryRun.preflightVerification?.identityOwnerBinding,
      "agent_openneed_agents"
    );

    const apply = await runMigrationScript(["--apply", `--passphrase=${passphrase}`], env);
    assert.equal(apply.mode, "apply");
    assert.equal(apply.ok, true);
    assert.equal(apply.receipt.applied.applied, true);
    assert.equal(Boolean(apply.receipt.applied.recoveryBundle?.summary?.bundleId), true);
    assert.equal(fs.existsSync(apply.receiptPath), true);
    assert.equal(apply.receipt.rollbackAvailability?.canRollback, true);
    assert.equal(apply.receipt.postApplyVerification?.ok, true);
    assert.equal(apply.receipt.bundleIntegrity?.present, true);
    assert.equal(apply.receipt.targetPaths?.legacyArchiveDir, legacyArchiveDir);
    assert.equal(apply.receipt.targetPaths?.canonicalArchiveDir, canonicalArchiveDir);
    assert.equal(
      apply.receipt.rollback?.archiveJsonlStructuredAuditMode,
      "read_only_structured_agent_reference_audit"
    );
    assert.equal(
      apply.receipt.rollback?.archiveJsonlStructuredAuditRollbackContract,
      "physical_directory_restore_only_raw_archive_jsonl_not_rewound"
    );
    assert.equal(
      apply.receipt.rollback?.compareArchiveJsonlStructuredAuditAgainstApplyReceipt,
      true
    );
    assert.equal(apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditRequired, true);
    assert.equal(apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditTarget, "canonical");
    assert.equal(
      apply.receipt.postApplyVerification?.archiveJsonlStructuredAudit?.physical?.activeArchiveDirKey,
      "canonical"
    );
    assert.equal(
      apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditDirectory?.archiveDir,
      canonicalArchiveDir
    );
    assert.equal(
      apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditDirectory?.counts?.scannedFileCount,
      1
    );
    assert.equal(
      apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditDirectory?.counts?.legacyReferenceCount,
      4
    );
    assert.equal(
      apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditDirectory?.counts?.canonicalReferenceCount,
      0
    );
    assert.equal(
      apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditDirectory?.byField?.agentId?.legacy,
      2
    );
    assert.equal(
      apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditDirectory?.byField?.recordedByAgentId?.legacy,
      1
    );
    assert.equal(
      apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditDirectory?.byField?.sourceAgentId?.legacy,
      1
    );
    assert.equal(apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditComplete, true);
    assert.equal(apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditLegacyResidueDetected, true);
    assertIdentityOwnerBinding(
      apply.receipt.postApplyVerification?.identityOwnerBinding,
      CANONICAL_MAIN_AGENT_ID
    );
    assert.equal(fs.existsSync(legacyArchiveDir), false);
    assert.equal(fs.existsSync(canonicalArchiveDir), true);

    await withMigrationVerificationServer(env, async ({ baseUrl, adminToken }) => {
      await assertCanonicalRouteVerification({
        baseUrl,
        adminToken,
        expectedPhysicalOwnerAgentId:
          apply.receipt.postApplyVerification?.identityOwnerBinding?.currentPhysicalAgentId ||
          CANONICAL_MAIN_AGENT_ID,
      });
    });

    await withEnv(env, async () => {
      const ledger = await importLedgerModule();
      const store = await ledger.loadStore();
      const canonicalAgent = await ledger.resolveAgentIdentity({ agentId: CANONICAL_MAIN_AGENT_ID });
      const legacyAliasAgent = await ledger.resolveAgentIdentity({ agentId: LEGACY_MAIN_AGENT_ID });

      assert.equal(Boolean(store.agents[CANONICAL_MAIN_AGENT_ID]), true);
      assert.equal(Boolean(store.agents[LEGACY_MAIN_AGENT_ID]), false);
      assert.equal(store.deviceRuntime?.residentAgentId, CANONICAL_MAIN_AGENT_ID);
      assert.equal(store.deviceRuntime?.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
      assert.equal(store.deviceRuntime?.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
      assert.equal(canonicalAgent.agentId, CANONICAL_MAIN_AGENT_ID);
      assert.equal(legacyAliasAgent.agentId, CANONICAL_MAIN_AGENT_ID);

      const archived = await ledger.listAgentArchivedRecords(CANONICAL_MAIN_AGENT_ID, {
        kind: "passport-memory",
      });
      assert.equal(
        archived.archiveIdentityViewMode,
        "canonical_read_view_raw_archive_preserved_on_disk"
      );
      assert.equal(archived.rawArchiveCompatibilityResidueDetected, true);
      assert.equal(archived.records.length, 1);
      assert.equal(archived.records[0]?.agentId, "agent_main");
      assert.equal(archived.records[0]?.record?.agentId, "agent_main");
      assert.equal(archived.records[0]?.record?.recordedByAgentId, "agent_main");
      assert.equal(archived.records[0]?.record?.payload?.sourceAgentId, "agent_main");
      assert.equal(
        archived.records[0]?.archiveIdentityCompatibility?.rawCompatibilityResidueDetected,
        true
      );
      assert.equal(
        archived.records[0]?.archiveIdentityCompatibility?.rawCompatibleAgentIds?.includes(
          LEGACY_MAIN_AGENT_ID
        ),
        true
      );
    });

    const rollback = await runMigrationScript(
      ["--rollback-from", apply.receiptPath, `--passphrase=${passphrase}`],
      env
    );
    assert.equal(rollback.mode, "rollback");
    assert.equal(rollback.ok, true);
    assert.equal(rollback.preview.status, "ready");
    assert.equal(rollback.verification?.ok, true);
    assert.equal(rollback.archiveRestore?.required, true);
    assert.equal(rollback.verification?.archiveJsonlStructuredAuditRequired, true);
    assert.equal(rollback.verification?.archiveJsonlStructuredAuditTarget, "legacy");
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAudit?.physical?.activeArchiveDirKey,
      "legacy"
    );
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditDirectory?.archiveDir,
      legacyArchiveDir
    );
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditDirectory?.counts?.scannedFileCount,
      1
    );
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditDirectory?.counts?.legacyReferenceCount,
      4
    );
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditDirectory?.byField?.agentId?.legacy,
      2
    );
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditDirectory?.byField?.recordedByAgentId?.legacy,
      1
    );
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditDirectory?.byField?.sourceAgentId?.legacy,
      1
    );
    assert.equal(rollback.verification?.archiveJsonlStructuredAuditMatchesApplyReceipt, true);
    assert.equal(rollback.verification?.archiveJsonlStructuredAuditApplyReceiptFreshness, "fresh");
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditRollbackContract,
      "physical_directory_restore_only_raw_archive_jsonl_not_rewound"
    );
    assert.equal(rollback.verification?.archiveJsonlStructuredAuditMatchesRollbackExpectation, true);
    assertIdentityOwnerBinding(rollback.verification?.identityOwnerBinding, LEGACY_MAIN_AGENT_ID);
    assert.equal(fs.existsSync(legacyArchiveDir), true);
    assert.equal(fs.existsSync(canonicalArchiveDir), false);

    await withMigrationVerificationServer(env, async ({ baseUrl, adminToken }) => {
      await assertCanonicalRouteVerification({
        baseUrl,
        adminToken,
        expectedPhysicalOwnerAgentId:
          rollback.verification?.identityOwnerBinding?.currentPhysicalAgentId ||
          LEGACY_MAIN_AGENT_ID,
      });
    });

    await withEnv(env, async () => {
      const ledger = await importLedgerModule();
      const store = await ledger.loadStore();
      const canonicalAliasAgent = await ledger.resolveAgentIdentity({ agentId: CANONICAL_MAIN_AGENT_ID });
      const legacyAgent = await ledger.resolveAgentIdentity({ agentId: LEGACY_MAIN_AGENT_ID });

      assert.equal(Boolean(store.agents[CANONICAL_MAIN_AGENT_ID]), false);
      assert.equal(Boolean(store.agents[LEGACY_MAIN_AGENT_ID]), true);
      assert.equal(canonicalAliasAgent.agentId, LEGACY_MAIN_AGENT_ID);
      assert.equal(legacyAgent.agentId, LEGACY_MAIN_AGENT_ID);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("main-agent migration script can rewrite archive JSONL structured refs and reverse them on rollback", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-main-agent-migration-archive-rewrite-"));
  const ledgerPath = path.join(tempDir, "ledger.json");
  const archiveRoot = path.join(tempDir, "archives");
  const legacyArchiveDir = path.join(archiveRoot, "agent_openneed_agents");
  const canonicalArchiveDir = path.join(archiveRoot, "agent_main");
  const readSessionStorePath = path.join(tempDir, "read-sessions.json");
  const storeKeyPath = path.join(tempDir, ".ledger-key");
  const signingSecretPath = path.join(tempDir, ".did-signing-master-secret");
  const passphrase = "main-agent-canonical-archive-rewrite-passphrase";
  const env = {
    AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
    AGENT_PASSPORT_ARCHIVE_DIR: archiveRoot,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
    AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
    AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
  };

  try {
    await seedLegacyMainAgentPhysicalStore({
      env,
      ledgerPath,
      storeKeyPath,
    });
    fs.mkdirSync(legacyArchiveDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyArchiveDir, "passport-memory.jsonl"),
      `${JSON.stringify({
        kind: "passport_memory",
        agentId: "agent_openneed_agents",
        record: {
          agentId: "agent_openneed_agents",
          passportMemoryId: "pmem_rewrite_1",
          recordedByAgentId: "agent_openneed_agents",
          payload: {
            sourceAgentId: "agent_openneed_agents",
          },
        },
      })}\n`,
      "utf8"
    );

    const apply = await runMigrationScript(
      ["--apply", "--rewrite-archive-jsonl", `--passphrase=${passphrase}`],
      env
    );
    assert.equal(apply.mode, "apply");
    assert.equal(apply.ok, true);
    assert.equal(apply.receipt.archiveContentRewriteMode, "directory_rename_and_structured_jsonl_rewrite");
    assert.equal(apply.receipt.applied?.archiveJsonlRewrite?.rewritten, true);
    assert.equal(apply.receipt.applied?.archiveJsonlRewrite?.counts?.rewrittenFileCount, 1);
    assert.equal(apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditTarget, "canonical");
    assert.equal(
      apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditDirectory?.counts?.legacyReferenceCount,
      0
    );
    assert.equal(
      apply.receipt.postApplyVerification?.archiveJsonlStructuredAuditDirectory?.counts?.canonicalReferenceCount > 0,
      true
    );
    assert.equal(
      apply.receipt.rollback?.archiveJsonlStructuredAuditRollbackContract,
      "physical_directory_restore_and_structured_agent_reference_rewrite"
    );
    assert.equal(fs.existsSync(legacyArchiveDir), false);
    assert.equal(fs.existsSync(canonicalArchiveDir), true);

    await withEnv(env, async () => {
      const ledger = await importLedgerModule();
      const archived = await ledger.listAgentArchivedRecords("agent_main", {
        kind: "passport-memory",
      });
      assert.equal(archived.rawArchiveCompatibilityResidueDetected, false);
      assert.equal(archived.records.length, 1);
      assert.equal(
        archived.records[0]?.archiveIdentityCompatibility?.rawCompatibilityResidueDetected,
        false
      );
      assert.equal(archived.records[0]?.record?.agentId, "agent_main");
      assert.equal(archived.records[0]?.record?.recordedByAgentId, "agent_main");
      assert.equal(archived.records[0]?.record?.payload?.sourceAgentId, "agent_main");
    });

    const rollback = await runMigrationScript(
      ["--rollback-from", apply.receiptPath, `--passphrase=${passphrase}`],
      env
    );
    assert.equal(rollback.mode, "rollback");
    assert.equal(rollback.ok, true);
    assert.equal(rollback.archiveContentRewriteMode, "directory_rename_and_structured_jsonl_rewrite");
    assert.equal(rollback.archiveJsonlRewrite?.rewritten, true);
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditRollbackContract,
      "physical_directory_restore_and_structured_agent_reference_rewrite"
    );
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditDirectory?.counts?.legacyReferenceCount > 0,
      true
    );
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditDirectory?.counts?.canonicalReferenceCount,
      0
    );
    assert.equal(fs.existsSync(legacyArchiveDir), true);
    assert.equal(fs.existsSync(canonicalArchiveDir), false);

    await withEnv(env, async () => {
      const ledger = await importLedgerModule();
      const archived = await ledger.listAgentArchivedRecords("agent_main", {
        kind: "passport-memory",
      });
      assert.equal(archived.rawArchiveCompatibilityResidueDetected, false);
      assert.equal(
        archived.records[0]?.archiveIdentityCompatibility?.rawCompatibilityResidueDetected,
        false
      );
      assert.equal(archived.records[0]?.record?.agentId, "agent_openneed_agents");
      assert.equal(archived.records[0]?.record?.recordedByAgentId, "agent_openneed_agents");
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("main-agent migration rollback stays valid when post-apply archive activity makes the apply receipt stale", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-main-agent-migration-stale-receipt-"));
  const ledgerPath = path.join(tempDir, "ledger.json");
  const archiveRoot = path.join(tempDir, "archives");
  const legacyArchiveDir = path.join(archiveRoot, "agent_openneed_agents");
  const canonicalArchiveDir = path.join(archiveRoot, "agent_main");
  const readSessionStorePath = path.join(tempDir, "read-sessions.json");
  const storeKeyPath = path.join(tempDir, ".ledger-key");
  const signingSecretPath = path.join(tempDir, ".did-signing-master-secret");
  const passphrase = "main-agent-canonical-stale-receipt-passphrase";
  const env = {
    AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
    AGENT_PASSPORT_ARCHIVE_DIR: archiveRoot,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
    AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
    AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
  };

  try {
    await seedLegacyMainAgentPhysicalStore({
      env,
      ledgerPath,
      storeKeyPath,
    });
    fs.mkdirSync(legacyArchiveDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyArchiveDir, "passport-memory.jsonl"),
      `${JSON.stringify({
        kind: "passport_memory",
        agentId: "agent_openneed_agents",
        archivedAt: "2026-01-01T00:00:00.000Z",
        record: {
          agentId: "agent_openneed_agents",
          passportMemoryId: "pmem_stale_receipt_1",
          recordedByAgentId: "agent_openneed_agents",
        },
      })}\n`,
      "utf8"
    );

    const apply = await runMigrationScript(["--apply", `--passphrase=${passphrase}`], env);
    assert.equal(apply.mode, "apply");
    assert.equal(apply.ok, true);

    await withEnv(env, async () => {
      const ledger = await importLedgerModule();
      const restored = await ledger.restoreAgentArchivedRecord("agent_main", {
        kind: "passport-memory",
        archiveIndex: 0,
      });
      assert.equal(restored.originalRecord?.agentId, "agent_main");
      assert.equal(
        restored.originalRecordIdentityCompatibility?.rawCompatibilityResidueDetected,
        true
      );

      const reverted = await ledger.revertAgentArchiveRestore("agent_main", {
        restoredRecordId: restored.restoredRecord?.passportMemoryId,
        archiveKind: "passport-memory",
      });
      assert.equal(reverted.ok, true);
      await assert.rejects(
        ledger.revertAgentArchiveRestore("agent_main", {
          restoredRecordId: restored.restoredRecord?.passportMemoryId,
          archiveKind: "passport-memory",
        }),
        /already reverted/
      );
    });

    const rollback = await runMigrationScript(
      ["--rollback-from", apply.receiptPath, `--passphrase=${passphrase}`],
      env
    );
    assert.equal(rollback.mode, "rollback");
    assert.equal(rollback.ok, true);
    assert.equal(rollback.verification?.ok, true);
    assert.equal(rollback.verification?.archiveJsonlStructuredAuditMatchesApplyReceipt, false);
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditApplyReceiptFreshness,
      "stale_after_apply_archive_activity"
    );
    assert.equal(rollback.verification?.archiveJsonlStructuredAuditMatchesRollbackExpectation, true);
    assert.equal(
      rollback.verification?.archiveJsonlStructuredAuditDirectory?.counts?.canonicalReferenceCount > 0,
      true
    );
    assert.equal(fs.existsSync(legacyArchiveDir), true);
    assert.equal(fs.existsSync(canonicalArchiveDir), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("main-agent migration rollback rejects receipts whose archive paths do not match the current environment", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-main-agent-migration-path-mismatch-"));
  const ledgerPath = path.join(tempDir, "ledger.json");
  const archiveRoot = path.join(tempDir, "archives");
  const legacyArchiveDir = path.join(archiveRoot, "agent_openneed_agents");
  const readSessionStorePath = path.join(tempDir, "read-sessions.json");
  const storeKeyPath = path.join(tempDir, ".ledger-key");
  const signingSecretPath = path.join(tempDir, ".did-signing-master-secret");
  const passphrase = "main-agent-canonical-path-mismatch-passphrase";
  const env = {
    AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
    AGENT_PASSPORT_ARCHIVE_DIR: archiveRoot,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
    AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
    AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
  };

  try {
    await withEnv(env, async () => {
      const ledger = await importLedgerModule();
      await ledger.loadStore();
    });
    fs.mkdirSync(legacyArchiveDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyArchiveDir, "passport-memory.jsonl"),
      `${JSON.stringify({
        kind: "passport_memory",
        agentId: "agent_openneed_agents",
        record: {
          passportMemoryId: "pmem_path_mismatch_1",
          recordedByAgentId: "agent_openneed_agents",
        },
      })}\n`,
      "utf8"
    );

    const apply = await runMigrationScript(["--apply", `--passphrase=${passphrase}`], env);
    assert.equal(apply.mode, "apply");
    assert.equal(apply.ok, true);

    const tamperedReceiptPath = path.join(tempDir, "tampered-receipt.json");
    const tamperedReceipt = JSON.parse(fs.readFileSync(apply.receiptPath, "utf8"));
    tamperedReceipt.targetPaths.archiveRoot = path.join(tempDir, "foreign-archives");
    tamperedReceipt.targetPaths.legacyArchiveDir = path.join(
      tamperedReceipt.targetPaths.archiveRoot,
      "agent_openneed_agents"
    );
    fs.writeFileSync(tamperedReceiptPath, `${JSON.stringify(tamperedReceipt, null, 2)}\n`, "utf8");

    await assert.rejects(
      runMigrationScript(
        ["--rollback-from", tamperedReceiptPath, `--passphrase=${passphrase}`],
        env
      ),
      /Receipt targetPaths\.archiveRoot does not match current environment/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("main-agent migration script fails closed when archive JSONL contains invalid records", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-main-agent-migration-invalid-jsonl-"));
  const ledgerPath = path.join(tempDir, "ledger.json");
  const archiveRoot = path.join(tempDir, "archives");
  const legacyArchiveDir = path.join(archiveRoot, "agent_openneed_agents");
  const canonicalArchiveDir = path.join(archiveRoot, "agent_main");
  const readSessionStorePath = path.join(tempDir, "read-sessions.json");
  const storeKeyPath = path.join(tempDir, ".ledger-key");
  const signingSecretPath = path.join(tempDir, ".did-signing-master-secret");
  const passphrase = "main-agent-canonical-invalid-jsonl-passphrase";
  const env = {
    AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
    AGENT_PASSPORT_ARCHIVE_DIR: archiveRoot,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
    AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
    AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
  };

  try {
    await withEnv(env, async () => {
      const ledger = await importLedgerModule();
      await ledger.loadStore();
    });
    fs.mkdirSync(legacyArchiveDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyArchiveDir, "passport-memory.jsonl"),
      `${JSON.stringify({
        kind: "passport_memory",
        agentId: "agent_openneed_agents",
      })}\n{"broken":\n`,
      "utf8"
    );

    const dryRun = await runMigrationScript(["--dry-run"], env);
    assert.equal(dryRun.mode, "dry_run");
    assert.equal(dryRun.preflightVerification?.archiveDirState, "legacy_only");
    assert.equal(dryRun.preflightVerification?.archiveJsonlStructuredAuditTarget, "legacy");
    assert.equal(
      dryRun.preflightVerification?.archiveJsonlStructuredAuditDirectory?.counts?.scannedFileCount,
      1
    );
    assert.equal(
      dryRun.preflightVerification?.archiveJsonlStructuredAuditDirectory?.counts?.invalidLineCount,
      1
    );
    assert.equal(
      dryRun.preflightVerification?.archiveJsonlStructuredAuditDirectory?.scanCompleted,
      false
    );
    assert.equal(
      dryRun.preflightVerification?.archiveJsonlStructuredAuditDirectory?.status,
      "invalid_jsonl"
    );

    const apply = await runMigrationScript(["--apply", `--passphrase=${passphrase}`], env);
    assert.equal(apply.mode, "apply");
    assert.equal(apply.ok, false);
    assert.equal(apply.blocked, true);
    assert.equal(apply.blockedReason, "archive_jsonl_structured_audit_incomplete");
    assert.equal(apply.receiptPath, null);
    assert.equal(apply.receipt, null);
    assert.equal(fs.existsSync(legacyArchiveDir), true);
    assert.equal(fs.existsSync(canonicalArchiveDir), false);
    assert.equal(
      apply.preflightVerification?.archiveJsonlStructuredAuditDirectory?.archiveDir,
      legacyArchiveDir
    );
    assert.equal(
      apply.preflightVerification?.archiveJsonlStructuredAuditDirectory?.counts?.scannedFileCount,
      1
    );
    assert.equal(
      apply.preflightVerification?.archiveJsonlStructuredAuditDirectory?.counts?.invalidLineCount,
      1
    );
    assert.equal(
      apply.preflightVerification?.archiveJsonlStructuredAuditDirectory?.scanCompleted,
      false
    );
    assert.equal(
      apply.preflightVerification?.archiveJsonlStructuredAuditDirectory?.status,
      "invalid_jsonl"
    );
    assert.equal(
      apply.preflightVerification?.archiveJsonlStructuredAuditDirectory?.counts?.legacyReferenceCount,
      1
    );
    assert.equal(apply.preflightVerification?.archiveJsonlStructuredAuditComplete, false);
    assert.equal(
      apply.preflightVerification?.archiveJsonlStructuredAuditLegacyResidueDetected,
      true
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

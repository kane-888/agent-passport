import path from "node:path";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  deleteGenericPasswordFromKeychain,
  getSystemKeychainStatus,
  readGenericPasswordFromKeychainResult,
  writeGenericPasswordToKeychain,
} from "../src/local-secrets.js";
import { createTracer } from "./smoke-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const rootDir = path.join(__dirname, "..");
export const liveDataDir = path.join(rootDir, "data");
export const localReasonerFixturePath = path.join(rootDir, "scripts", "local-reasoner-fixture.mjs");
export const smokeTraceEnabled = process.env.SMOKE_TRACE === "1";
const DEFAULT_KEYCHAIN_ACCOUNT = "resident-default";
const STORE_KEY_KEYCHAIN_SERVICE = "AgentPassport.StoreKey";
const SIGNING_MASTER_SECRET_SERVICE = "AgentPassport.SigningMasterSecret";
const ADMIN_TOKEN_KEYCHAIN_SERVICE = "AgentPassport.AdminToken";
const execFileAsync = promisify(execFile);

export function createSmokeLogger(name, enabled = smokeTraceEnabled) {
  return createTracer(name, enabled);
}

export function resolveBaseUrl() {
  return process.env.AGENT_PASSPORT_BASE_URL || "http://127.0.0.1:4319";
}

export function resolveLiveRuntimePaths() {
  return {
    ledgerPath: process.env.OPENNEED_LEDGER_PATH || path.join(liveDataDir, "ledger.json"),
    storeKeyPath: process.env.AGENT_PASSPORT_STORE_KEY_PATH || path.join(liveDataDir, ".ledger-key"),
    recoveryDir: process.env.AGENT_PASSPORT_RECOVERY_DIR || path.join(liveDataDir, "recovery-bundles"),
    setupPackageDir: process.env.AGENT_PASSPORT_SETUP_PACKAGE_DIR || path.join(liveDataDir, "device-setup-packages"),
    archiveDir: process.env.AGENT_PASSPORT_ARCHIVE_DIR || path.join(liveDataDir, "archives"),
    signingSecretPath:
      process.env.AGENT_PASSPORT_SIGNING_SECRET_PATH || path.join(liveDataDir, ".did-signing-master-secret"),
    adminTokenPath: process.env.AGENT_PASSPORT_ADMIN_TOKEN_PATH || path.join(liveDataDir, ".admin-token"),
    adminTokenAccount: process.env.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT || DEFAULT_KEYCHAIN_ACCOUNT,
    keychainAccount: process.env.AGENT_PASSPORT_KEYCHAIN_ACCOUNT || DEFAULT_KEYCHAIN_ACCOUNT,
  };
}

function isMissingKeychainEntry(result) {
  return /could not be found|item not found|specified item could not be found/i.test(String(result?.reason || ""));
}

async function copyPathIfExists(sourcePath, targetPath) {
  try {
    await copyFile(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function cloneKeychainSecret(service, sourceAccount, targetAccount) {
  if (!targetAccount) {
    return;
  }

  const result = readGenericPasswordFromKeychainResult(service, sourceAccount);
  if (result.found) {
    const stored = writeGenericPasswordToKeychain(service, targetAccount, result.value);
    if (!stored.ok) {
      throw new Error(
        `Unable to seed ${service} into isolated keychain account ${targetAccount}: ${stored.reason || "keychain_write_failed"}`
      );
    }
    return;
  }
  if (result.ok && result.code === "not_found") {
    return;
  }
  throw new Error(
    `Unable to read ${service} from live keychain account ${sourceAccount}: ${result.reason || result.code || "unknown_error"}`
  );
}

async function seedAdminTokenIsolation({ dataDir, adminTokenAccount, liveRuntime = resolveLiveRuntimePaths() }) {
  const explicitToken = process.env.AGENT_PASSPORT_ADMIN_TOKEN || process.env.AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN;
  let token = explicitToken || null;
  if (!token && getSystemKeychainStatus().available) {
    const keychainToken = readGenericPasswordFromKeychainResult(ADMIN_TOKEN_KEYCHAIN_SERVICE, liveRuntime.adminTokenAccount);
    if (keychainToken.found) {
      token = keychainToken.value;
    } else if (!(keychainToken.ok && keychainToken.code === "not_found")) {
      throw new Error(
        `Unable to read ${ADMIN_TOKEN_KEYCHAIN_SERVICE} from live keychain account ${liveRuntime.adminTokenAccount}: ${
          keychainToken.reason || keychainToken.code || "unknown_error"
        }`
      );
    }
  }

  if (!token) {
    try {
      token = (await readFile(liveRuntime.adminTokenPath, "utf8")).trim();
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  const isolatedToken = token || `${randomBytes(16).toString("hex")}.${randomBytes(16).toString("hex")}`;
  const isolatedTokenPath = path.join(dataDir, ".admin-token");
  await mkdir(path.dirname(isolatedTokenPath), { recursive: true });
  await writeFile(isolatedTokenPath, `${isolatedToken}\n`, { encoding: "utf8", mode: 0o600 });

  if (getSystemKeychainStatus().available && adminTokenAccount) {
    const stored = writeGenericPasswordToKeychain(ADMIN_TOKEN_KEYCHAIN_SERVICE, adminTokenAccount, isolatedToken);
    if (!stored.ok) {
      throw new Error(
        `Unable to seed ${ADMIN_TOKEN_KEYCHAIN_SERVICE} into isolated keychain account ${adminTokenAccount}: ${
          stored.reason || "keychain_write_failed"
        }`
      );
    }
  }
}

export async function seedSmokeSecretIsolation({ dataDir, keychainAccount, liveRuntime = resolveLiveRuntimePaths() }) {
  await copyPathIfExists(liveRuntime.signingSecretPath, path.join(dataDir, ".did-signing-master-secret"));
  await seedAdminTokenIsolation({
    dataDir,
    adminTokenAccount: keychainAccount,
    liveRuntime,
  });

  if (!getSystemKeychainStatus().available) {
    return;
  }

  cloneKeychainSecret(STORE_KEY_KEYCHAIN_SERVICE, liveRuntime.keychainAccount, keychainAccount);
  cloneKeychainSecret(SIGNING_MASTER_SECRET_SERVICE, liveRuntime.keychainAccount, keychainAccount);
}

export async function cleanupSmokeSecretIsolation({
  keychainAccount = null,
  adminTokenAccount = null,
  cleanupRoot = null,
} = {}) {
  if (getSystemKeychainStatus().available) {
    const deletionResults = [
      keychainAccount ? deleteGenericPasswordFromKeychain(STORE_KEY_KEYCHAIN_SERVICE, keychainAccount) : null,
      keychainAccount ? deleteGenericPasswordFromKeychain(SIGNING_MASTER_SECRET_SERVICE, keychainAccount) : null,
      adminTokenAccount ? deleteGenericPasswordFromKeychain(ADMIN_TOKEN_KEYCHAIN_SERVICE, adminTokenAccount) : null,
    ].filter(Boolean);
    const failures = deletionResults.filter((result) => !result.ok && !isMissingKeychainEntry(result));
    if (failures.length) {
      throw new Error(
        `smoke secret cleanup failed: ${failures.map((result) => result.reason || "unknown_error").join("; ")}`
      );
    }
  }

  if (cleanupRoot) {
    await rm(cleanupRoot, { recursive: true, force: true });
  }
}

export async function ensureSmokeLedgerInitialized(isolationEnv = {}) {
  const initEnv = {
    ...process.env,
    ...(isolationEnv || {}),
    AGENT_PASSPORT_USE_KEYCHAIN: String(isolationEnv?.AGENT_PASSPORT_USE_KEYCHAIN ?? "0"),
  };
  const initScript = path.join(rootDir, "scripts", "init-smoke-ledger.mjs");
  await execFileAsync(process.execPath, [initScript], {
    cwd: rootDir,
    env: initEnv,
    maxBuffer: 1024 * 1024,
  });
}

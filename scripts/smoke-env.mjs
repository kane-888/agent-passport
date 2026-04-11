import path from "node:path";
import { copyFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

export function createSmokeLogger(name) {
  return createTracer(name, smokeTraceEnabled);
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

export async function seedSmokeSecretIsolation({ dataDir, keychainAccount, liveRuntime = resolveLiveRuntimePaths() }) {
  await copyPathIfExists(liveRuntime.signingSecretPath, path.join(dataDir, ".did-signing-master-secret"));

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

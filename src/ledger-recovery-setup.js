import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";

import {
  cloneJson,
  createRecordId,
  decodeBase64,
  encodeBase64,
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";

const RECOVERY_BUNDLE_SUMMARY_CACHE = new Map();
const DEVICE_SETUP_PACKAGE_SUMMARY_CACHE = new Map();

function buildSummaryCacheFingerprint(rawJson = "") {
  return createHash("sha256").update(String(rawJson)).digest("hex");
}

function pruneSummaryCache(cache, livePaths = []) {
  const livePathSet = new Set(livePaths);
  for (const cacheKey of cache.keys()) {
    if (!livePathSet.has(cacheKey)) {
      cache.delete(cacheKey);
    }
  }
}

async function readCachedJsonSummary(filePath, cache, buildSummary) {
  const rawJson = await readFile(filePath, "utf8");
  const fingerprint = buildSummaryCacheFingerprint(rawJson);
  const cached = cache.get(filePath);
  if (cached?.fingerprint === fingerprint) {
    return cached.summary;
  }
  const parsed = JSON.parse(rawJson);
  const summary = buildSummary(parsed);
  if (summary) {
    cache.set(filePath, {
      fingerprint,
      summary,
    });
  } else {
    cache.delete(filePath);
  }
  return summary;
}

export function buildStoreRecoveryBundleSummary(bundle, bundlePath = null) {
  if (!bundle || typeof bundle !== "object") {
    return null;
  }

  return {
    bundleId: normalizeOptionalText(bundle.bundleId) ?? null,
    format: normalizeOptionalText(bundle.format) ?? null,
    createdAt: normalizeOptionalText(bundle.createdAt) ?? null,
    machineId: normalizeOptionalText(bundle.machineId) ?? null,
    machineLabel: normalizeOptionalText(bundle.machineLabel) ?? null,
    residentAgentId: normalizeOptionalText(bundle.residentAgentId) ?? null,
    note: normalizeOptionalText(bundle.note) ?? null,
    bundlePath,
    includesLedgerEnvelope: Boolean(bundle.ledger?.envelope),
    wrappedKeyMode: normalizeOptionalText(bundle.storeKey?.mode) ?? null,
    lastEventHash: normalizeOptionalText(bundle.metadata?.lastEventHash) ?? null,
    chainId: normalizeOptionalText(bundle.metadata?.chainId) ?? null,
  };
}

export function buildDeviceSetupPackageSummary(setupPackage, packagePath = null) {
  if (!setupPackage || typeof setupPackage !== "object") {
    return null;
  }

  return {
    packageId: normalizeOptionalText(setupPackage.packageId) ?? null,
    format: normalizeOptionalText(setupPackage.format) ?? null,
    exportedAt: normalizeOptionalText(setupPackage.exportedAt) ?? null,
    machineId: normalizeOptionalText(setupPackage.machineId) ?? null,
    machineLabel: normalizeOptionalText(setupPackage.machineLabel) ?? null,
    residentAgentId: normalizeOptionalText(setupPackage.residentAgentId) ?? null,
    residentDidMethod: normalizeOptionalText(setupPackage.residentDidMethod) ?? null,
    note: normalizeOptionalText(setupPackage.note) ?? null,
    setupComplete: normalizeBooleanFlag(setupPackage.setupStatus?.setupComplete, false),
    missingRequiredCodes: normalizeTextList(setupPackage.setupStatus?.missingRequiredCodes),
    recoveryBundleCount: Number(setupPackage.recovery?.bundleCount || 0),
    latestRecoveryBundleId: normalizeOptionalText(setupPackage.recovery?.latestBundle?.bundleId) ?? null,
    latestRecoveryRehearsalId: normalizeOptionalText(setupPackage.recovery?.latestPassedRehearsal?.rehearsalId) ?? null,
    localReasonerProfileCount: Array.isArray(setupPackage.localReasonerProfiles) ? setupPackage.localReasonerProfiles.length : 0,
    packagePath,
  };
}

function selectSetupPackageLocalReasonerProfiles(profiles = [], payload = {}) {
  const sourceProfiles = Array.isArray(profiles) ? profiles : [];
  const requestedProfileIds = normalizeTextList(payload.localReasonerProfileIds);
  const requestedProfileIdSet = requestedProfileIds.length > 0 ? new Set(requestedProfileIds) : null;
  const requestedProfileRank = new Map(requestedProfileIds.map((profileId, index) => [profileId, index]));
  const hasProfileLimit = payload.localReasonerProfileLimit != null;
  const profileLimit = hasProfileLimit
    ? Math.max(1, Math.floor(toFiniteNumber(payload.localReasonerProfileLimit, 1)))
    : null;
  const scopedProfiles = requestedProfileIdSet
    ? sourceProfiles.filter((profile) => requestedProfileIdSet.has(normalizeOptionalText(profile?.profileId) ?? ""))
    : [...sourceProfiles];
  const sortedProfiles = scopedProfiles.sort((left, right) => {
    if (requestedProfileIdSet) {
      return (
        (requestedProfileRank.get(normalizeOptionalText(left?.profileId) ?? "") ?? Number.MAX_SAFE_INTEGER) -
        (requestedProfileRank.get(normalizeOptionalText(right?.profileId) ?? "") ?? Number.MAX_SAFE_INTEGER)
      );
    }
    const byUpdatedAt = (right?.updatedAt || "").localeCompare(left?.updatedAt || "");
    if (byUpdatedAt !== 0) {
      return byUpdatedAt;
    }
    const byActivatedAt = (right?.lastActivatedAt || "").localeCompare(left?.lastActivatedAt || "");
    if (byActivatedAt !== 0) {
      return byActivatedAt;
    }
    return (right?.createdAt || "").localeCompare(left?.createdAt || "");
  });
  const selectedProfiles = profileLimit == null ? sortedProfiles : sortedProfiles.slice(0, profileLimit);
  return selectedProfiles.map((profile) => cloneJson(profile));
}

export async function resolveDeviceSetupPackageInput(payload = {}, { deviceSetupPackageFormat } = {}) {
  const packagePath = normalizeOptionalText(payload.packagePath) ?? null;
  let setupPackage = payload.package && typeof payload.package === "object" ? cloneJson(payload.package) : null;
  if (!setupPackage && normalizeOptionalText(payload.packageJson)) {
    setupPackage = JSON.parse(payload.packageJson);
  }
  if (!setupPackage && packagePath) {
    setupPackage = JSON.parse(await readFile(packagePath, "utf8"));
  }
  if (!setupPackage || setupPackage.format !== deviceSetupPackageFormat) {
    throw new Error("Invalid device setup package");
  }
  return {
    setupPackage,
    packagePath,
  };
}

export async function resolveRecoveryBundleInput(payload = {}, { storeRecoveryFormat } = {}) {
  const bundlePath = normalizeOptionalText(payload.bundlePath) ?? null;
  let bundle = payload.bundle && typeof payload.bundle === "object" ? cloneJson(payload.bundle) : null;
  if (!bundle && normalizeOptionalText(payload.bundleJson)) {
    bundle = JSON.parse(payload.bundleJson);
  }
  if (!bundle && bundlePath) {
    bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  }
  if (!bundle || bundle.format !== storeRecoveryFormat) {
    throw new Error("Invalid recovery bundle");
  }
  return {
    bundle,
    bundlePath,
  };
}

export function unwrapStoreRecoveryKey(bundle, passphrase, { deriveRecoveryWrapKey, decryptBufferWithKey } = {}) {
  const wrappedKey = bundle.storeKey?.wrap;
  if (!wrappedKey?.salt || !wrappedKey?.iv || !wrappedKey?.tag || !wrappedKey?.ciphertext) {
    throw new Error("Recovery bundle missing wrapped store key");
  }
  const wrapKey = deriveRecoveryWrapKey(passphrase, decodeBase64(wrappedKey.salt));
  const restoredStoreKey = decryptBufferWithKey(wrapKey, wrappedKey);
  if (restoredStoreKey.length !== 32) {
    throw new Error("Recovered store key has invalid length");
  }
  return restoredStoreKey;
}

async function pathExists(targetPath) {
  try {
    await readFile(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "unknown_error");
}

async function loadStoreForRecoveryRehearsal(loadStore) {
  try {
    return {
      ok: true,
      store: await loadStore(),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      store: null,
      error: toErrorMessage(error),
    };
  }
}

async function readStoreEnvelopeForRecoveryRehearsal(storePath) {
  try {
    const raw = await readFile(storePath, "utf8");
    try {
      return {
        present: true,
        readable: true,
        envelope: JSON.parse(raw),
        error: null,
      };
    } catch (error) {
      return {
        present: true,
        readable: false,
        envelope: null,
        error: `invalid_json:${toErrorMessage(error)}`,
      };
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        present: false,
        readable: false,
        envelope: null,
        error: "store_envelope_missing",
      };
    }
    return {
      present: false,
      readable: false,
      envelope: null,
      error: toErrorMessage(error),
    };
  }
}

function findDuplicateTextValues(values = []) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      duplicates.add(normalized);
      continue;
    }
    seen.add(normalized);
  }
  return Array.from(duplicates).sort((left, right) => left.localeCompare(right));
}

export function buildRecoveryRehearsalView(record = null) {
  return record ? cloneJson(record) : null;
}

export async function readEncryptedStoreEnvelope({
  loadStore,
  readStorePath,
  isEncryptedStoreEnvelope,
  writeStore,
  persistEncryptedEnvelope = true,
} = {}) {
  const store = await loadStore();
  let raw = null;
  try {
    raw = await readFile(readStorePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return {
      store,
      envelope: null,
      missingLedger: true,
      persisted: false,
    };
  }
  const parsed = JSON.parse(raw);
  if (!isEncryptedStoreEnvelope(parsed)) {
    if (!persistEncryptedEnvelope) {
      return {
        store,
        envelope: parsed,
        encrypted: false,
        persisted: false,
      };
    }
    await writeStore(store);
    const refreshed = JSON.parse(await readFile(readStorePath, "utf8"));
    return { store, envelope: refreshed, encrypted: true, persisted: true };
  }
  return { store, envelope: parsed, encrypted: true, persisted: false };
}

export async function listStoreRecoveryBundles({
  limit = 10,
  storeRecoveryDir,
  storeRecoveryFormat,
} = {}) {
  try {
    const entries = await readdir(storeRecoveryDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const bundlePaths = files.map((entry) => path.join(storeRecoveryDir, entry.name));
    pruneSummaryCache(RECOVERY_BUNDLE_SUMMARY_CACHE, bundlePaths);
    const bundles = (
      await Promise.all(
        bundlePaths.map(async (bundlePath) => {
          try {
            return await readCachedJsonSummary(bundlePath, RECOVERY_BUNDLE_SUMMARY_CACHE, (parsed) =>
              parsed?.format === storeRecoveryFormat ? buildStoreRecoveryBundleSummary(parsed, bundlePath) : null
            );
          } catch {
            RECOVERY_BUNDLE_SUMMARY_CACHE.delete(bundlePath);
            return null;
          }
        })
      )
    ).filter(Boolean);

    const cappedLimit = Math.max(1, Math.floor(toFiniteNumber(limit, 10)));
    bundles.sort((left, right) => (right?.createdAt || "").localeCompare(left?.createdAt || ""));
    return {
      bundles: bundles.slice(0, cappedLimit),
      counts: {
        total: bundles.length,
      },
      recoveryDir: storeRecoveryDir,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        bundles: [],
        counts: { total: 0 },
        recoveryDir: storeRecoveryDir,
      };
    }
    throw error;
  }
}

export async function listDeviceSetupPackages({
  limit = 10,
  deviceSetupPackageDir,
  deviceSetupPackageFormat,
} = {}) {
  try {
    const entries = await readdir(deviceSetupPackageDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const packagePaths = files.map((entry) => path.join(deviceSetupPackageDir, entry.name));
    pruneSummaryCache(DEVICE_SETUP_PACKAGE_SUMMARY_CACHE, packagePaths);
    const packages = (
      await Promise.all(
        packagePaths.map(async (packagePath) => {
          try {
            return await readCachedJsonSummary(packagePath, DEVICE_SETUP_PACKAGE_SUMMARY_CACHE, (parsed) =>
              parsed?.format === deviceSetupPackageFormat ? buildDeviceSetupPackageSummary(parsed, packagePath) : null
            );
          } catch {
            DEVICE_SETUP_PACKAGE_SUMMARY_CACHE.delete(packagePath);
            return null;
          }
        })
      )
    ).filter(Boolean);

    const cappedLimit = Math.max(1, Math.floor(toFiniteNumber(limit, 10)));
    packages.sort((left, right) => (right?.exportedAt || "").localeCompare(left?.exportedAt || ""));
    return {
      packages: packages.slice(0, cappedLimit),
      counts: {
        total: packages.length,
      },
      packageDir: deviceSetupPackageDir,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        packages: [],
        counts: { total: 0 },
        packageDir: deviceSetupPackageDir,
      };
    }
    throw error;
  }
}

export async function readDeviceSetupPackageFile(packagePath, { deviceSetupPackageFormat } = {}) {
  const parsed = JSON.parse(await readFile(packagePath, "utf8"));
  if (parsed?.format !== deviceSetupPackageFormat) {
    throw new Error(`Invalid device setup package file: ${packagePath}`);
  }
  return parsed;
}

export function resolveDeviceSetupPackagePath(packageId, { deviceSetupPackageDir } = {}) {
  const normalizedId = normalizeOptionalText(packageId);
  if (!normalizedId) {
    throw new Error("packageId is required");
  }
  return path.join(deviceSetupPackageDir, `${normalizedId}.json`);
}

export async function getDeviceSetupPackage(
  packageId,
  { includePackage = true, deviceSetupPackageDir, deviceSetupPackageFormat } = {}
) {
  const packagePath = resolveDeviceSetupPackagePath(packageId, { deviceSetupPackageDir });
  const setupPackage = await readDeviceSetupPackageFile(packagePath, { deviceSetupPackageFormat });
  return {
    loadedAt: now(),
    summary: buildDeviceSetupPackageSummary(setupPackage, packagePath),
    package: includePackage ? setupPackage : null,
  };
}

export async function deleteDeviceSetupPackage(
  packageId,
  payload = {},
  { loadStore, appendEvent, writeStore, deviceSetupPackageDir, deviceSetupPackageFormat } = {}
) {
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const packagePath = resolveDeviceSetupPackagePath(packageId, { deviceSetupPackageDir });
  const setupPackage = await readDeviceSetupPackageFile(packagePath, { deviceSetupPackageFormat });
  const summary = buildDeviceSetupPackageSummary(setupPackage, packagePath);

  if (!dryRun) {
    const store = await loadStore();
    await unlink(packagePath);
    appendEvent(store, "device_setup_package_deleted", {
      packageId: summary?.packageId ?? normalizeOptionalText(packageId) ?? null,
      residentAgentId: summary?.residentAgentId ?? null,
      residentDidMethod: summary?.residentDidMethod ?? null,
    });
    await writeStore(store);
  }

  return {
    deletedAt: now(),
    dryRun,
    summary,
  };
}

export async function exportStoreRecoveryBundle(
  payload = {},
  {
    loadOrCreateStoreEncryptionKey,
    readEncryptedStoreEnvelopeImpl,
    deriveRecoveryWrapKey,
    encryptBufferWithKey,
    createMachineIdImpl,
    storeRecoveryDir,
    storeRecoveryFormat,
    storePathBasename,
  } = {}
) {
  const passphrase = normalizeOptionalText(payload.passphrase);
  const note = normalizeOptionalText(payload.note) ?? null;
  const includeLedgerEnvelope = normalizeBooleanFlag(payload.includeLedgerEnvelope, true);
  const saveToFile = normalizeBooleanFlag(payload.saveToFile, true);
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const returnBundle = normalizeBooleanFlag(payload.returnBundle, true);
  const { store, envelope } = await readEncryptedStoreEnvelopeImpl();
  const encryption = await loadOrCreateStoreEncryptionKey();
  const salt = randomBytes(16);
  const wrapKey = deriveRecoveryWrapKey(passphrase, salt);
  const wrappedKey = encryptBufferWithKey(wrapKey, encryption.key);
  const bundle = {
    format: storeRecoveryFormat,
    bundleId: createRecordId("recovery"),
    createdAt: now(),
    machineId: normalizeOptionalText(store.deviceRuntime?.machineId) ?? createMachineIdImpl(),
    machineLabel: normalizeOptionalText(store.deviceRuntime?.machineLabel) ?? normalizeOptionalText(store.deviceRuntime?.machineId) ?? null,
    residentAgentId: normalizeOptionalText(store.deviceRuntime?.residentAgentId) ?? null,
    note,
    storeKey: {
      mode: encryption.mode,
      wrap: {
        kdf: "scrypt",
        salt: encodeBase64(salt),
        ...wrappedKey,
      },
    },
    ledger: includeLedgerEnvelope
      ? {
          pathBasename: storePathBasename,
          envelope,
        }
      : null,
    metadata: {
      chainId: store.chainId,
      lastEventHash: store.lastEventHash ?? null,
      credentialCount: Array.isArray(store.credentials) ? store.credentials.length : 0,
      eventCount: Array.isArray(store.events) ? store.events.length : 0,
    },
  };

  let bundlePath = null;
  if (saveToFile && !dryRun) {
    await mkdir(storeRecoveryDir, { recursive: true });
    bundlePath = path.join(storeRecoveryDir, `${bundle.bundleId}.json`);
    await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  }

  return {
    exportedAt: now(),
    dryRun,
    recoveryDir: storeRecoveryDir,
    bundle: returnBundle ? bundle : null,
    summary: buildStoreRecoveryBundleSummary(bundle, bundlePath),
  };
}

export async function importStoreRecoveryBundle(
  payload = {},
  {
    resolveRecoveryBundleInputImpl,
    unwrapStoreRecoveryKeyImpl,
    getSystemKeychainStatusImpl,
    shouldPreferSystemKeychainImpl,
    readGenericPasswordFromKeychainImpl,
    writeGenericPasswordToKeychainImpl,
    storeKeyKeychainService,
    storeKeyKeychainAccount,
    storeKeyPath,
    storeKeyRecordFormat,
    storePath,
    loadStore,
    resetStoreEncryptionKey,
  } = {}
) {
  const passphrase = normalizeOptionalText(payload.passphrase);
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const overwrite = normalizeBooleanFlag(payload.overwrite, false);
  const restoreLedger = normalizeBooleanFlag(payload.restoreLedger, true);
  const importStoreKeyTo = normalizeOptionalText(payload.importStoreKeyTo)?.toLowerCase() ?? "auto";
  const removeLegacyFile = normalizeBooleanFlag(payload.removeLegacyFile, importStoreKeyTo !== "file");

  const { bundle, bundlePath } = await resolveRecoveryBundleInputImpl(payload);
  const restoredStoreKey = unwrapStoreRecoveryKeyImpl(bundle, passphrase);
  const bundleHasLedgerEnvelope = Boolean(bundle.ledger?.envelope);
  if (restoreLedger && !bundleHasLedgerEnvelope) {
    throw new Error("Recovery bundle does not include a ledger envelope; set restoreLedger=false to import only the store key");
  }

  const keychainStatus = getSystemKeychainStatusImpl();
  const targetStoreKeyMode =
    importStoreKeyTo === "keychain"
      ? "keychain"
      : importStoreKeyTo === "file"
        ? "file"
        : shouldPreferSystemKeychainImpl() && keychainStatus.available
          ? "keychain"
          : "file";
  const keychainPreferred = shouldPreferSystemKeychainImpl() && keychainStatus.available;
  const existingKeychainSecret = keychainStatus.available
    ? readGenericPasswordFromKeychainImpl(storeKeyKeychainService, storeKeyKeychainAccount)
    : null;
  const existingStoreKeyFile = await pathExists(storeKeyPath);
  const existingLedgerEnvelope = await pathExists(storePath);
  const storeKeyWillOverwrite =
    (targetStoreKeyMode === "keychain" && Boolean(existingKeychainSecret)) ||
    (targetStoreKeyMode === "keychain" && existingStoreKeyFile) ||
    (targetStoreKeyMode === "file" && existingStoreKeyFile);
  const ledgerWillOverwrite = restoreLedger && existingLedgerEnvelope;
  const importPlan = {
    importMode: restoreLedger ? "store_key_and_ledger" : "store_key_only",
    restoreLedgerRequested: restoreLedger,
    bundleLedgerEnvelopeAvailable: bundleHasLedgerEnvelope,
    targetStoreKeyMode,
    current: {
      keychainAvailable: keychainStatus.available,
      keychainStoreKeyPresent: Boolean(existingKeychainSecret),
      fileStoreKeyPresent: existingStoreKeyFile,
      ledgerEnvelopePresent: existingLedgerEnvelope,
    },
    plannedChanges: {
      storeKeyWillOverwrite,
      ledgerWillOverwrite,
      legacyFileRemovalRequested: targetStoreKeyMode === "keychain" ? removeLegacyFile : false,
    },
  };

  if (targetStoreKeyMode === "file" && keychainPreferred && existingKeychainSecret) {
    throw new Error("Preferred Keychain store key already exists; import to keychain or clear the Keychain key first");
  }
  if (targetStoreKeyMode === "keychain" && existingStoreKeyFile && !removeLegacyFile) {
    throw new Error("Importing the store key into Keychain while keeping the existing file-based store key would leave ambiguous key material; clear the file or set removeLegacyFile=true");
  }
  if (!overwrite) {
    if (targetStoreKeyMode === "keychain" && existingKeychainSecret) {
      throw new Error("Store key already exists in Keychain; set overwrite=true to replace it");
    }
    if (targetStoreKeyMode === "keychain" && existingStoreKeyFile) {
      throw new Error("Store key already exists in file; set overwrite=true to replace it");
    }
    if (targetStoreKeyMode === "file" && existingStoreKeyFile) {
      throw new Error("Store key already exists; set overwrite=true to replace it");
    }
    if (restoreLedger && existingLedgerEnvelope) {
      throw new Error("Ledger envelope already exists; set overwrite=true to replace it");
    }
  }

  if (!dryRun) {
    if (targetStoreKeyMode === "keychain") {
      if (!keychainStatus.available) {
        throw new Error("System Keychain is unavailable for recovery import");
      }

      const stored = writeGenericPasswordToKeychainImpl(
        storeKeyKeychainService,
        storeKeyKeychainAccount,
        encodeBase64(restoredStoreKey)
      );
      if (!stored.ok) {
        throw new Error(`Unable to import store key into Keychain: ${stored.reason || "unknown_error"}`);
      }

      if (removeLegacyFile) {
        try {
          await unlink(storeKeyPath);
        } catch (error) {
          if (error?.code !== "ENOENT") {
            throw error;
          }
        }
      }
    } else {
      await mkdir(path.dirname(storeKeyPath), { recursive: true });
      const keyRecord = {
        format: storeKeyRecordFormat,
        createdAt: now(),
        source: "recovery_import",
        importedFromBundleId: bundle.bundleId,
        keyBase64: encodeBase64(restoredStoreKey),
      };
      await writeFile(storeKeyPath, `${JSON.stringify(keyRecord, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }

    if (restoreLedger) {
      await mkdir(path.dirname(storePath), { recursive: true });
      await writeFile(storePath, `${JSON.stringify(bundle.ledger.envelope, null, 2)}\n`, "utf8");
    }

    resetStoreEncryptionKey?.();
  }

  let restoredStore = null;
  if (!dryRun && restoreLedger) {
    const store = await loadStore();
    restoredStore = {
      chainId: store.chainId,
      lastEventHash: store.lastEventHash ?? null,
      counts: {
        agents: Object.keys(store.agents || {}).length,
        credentials: Array.isArray(store.credentials) ? store.credentials.length : 0,
        events: Array.isArray(store.events) ? store.events.length : 0,
      },
    };
  }

  return {
    importedAt: now(),
    dryRun,
    overwrite,
    restoredLedger: Boolean(!dryRun && restoreLedger),
    restoreLedgerRequested: restoreLedger,
    storeKeyImportTarget: targetStoreKeyMode,
    legacyFileRemoved: Boolean(!dryRun && targetStoreKeyMode === "keychain" && removeLegacyFile),
    summary: buildStoreRecoveryBundleSummary(bundle, bundlePath),
    importPlan,
    storeKeyPath: targetStoreKeyMode === "file" ? storeKeyPath : null,
    storeKeyKeychainService: targetStoreKeyMode === "keychain" ? storeKeyKeychainService : null,
    storeKeyKeychainAccount: targetStoreKeyMode === "keychain" ? storeKeyKeychainAccount : null,
    storePath,
    restoredStore,
  };
}

export async function listRecoveryRehearsals({ limit = 10, loadStore } = {}) {
  const store = await loadStore();
  const cappedLimit = Math.max(1, Math.floor(toFiniteNumber(limit, 10)));
  const rehearsals = (Array.isArray(store.recoveryRehearsals) ? store.recoveryRehearsals : [])
    .slice()
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  return {
    rehearsals: rehearsals.slice(0, cappedLimit).map((record) => buildRecoveryRehearsalView(record)),
    counts: {
      total: rehearsals.length,
      passed: rehearsals.filter((record) => record?.status === "passed").length,
      partial: rehearsals.filter((record) => record?.status === "partial").length,
      failed: rehearsals.filter((record) => record?.status === "failed").length,
    },
  };
}

export async function rehearseStoreRecoveryBundle(
  payload = {},
  {
    resolveRecoveryBundleInputImpl,
    unwrapStoreRecoveryKeyImpl,
    loadStore,
    storePath,
    readCurrentStoreState = null,
    readCurrentEnvelopeState = null,
    decryptBufferWithKey,
    isEncryptedStoreEnvelope,
    appendTranscriptEntries,
    truncatePromptSection,
    appendEvent,
    writeStore,
  } = {}
) {
  const passphrase = normalizeOptionalText(payload.passphrase);
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const persist = normalizeBooleanFlag(payload.persist, !dryRun);
  const note = normalizeOptionalText(payload.note) ?? null;
  const { bundle, bundlePath } = await resolveRecoveryBundleInputImpl(payload);
  const restoredStoreKey = unwrapStoreRecoveryKeyImpl(bundle, passphrase);
  const currentStoreState = readCurrentStoreState
    ? await readCurrentStoreState()
    : await loadStoreForRecoveryRehearsal(loadStore);
  const currentStore = currentStoreState.store;
  const currentEnvelopeState = readCurrentEnvelopeState
    ? await readCurrentEnvelopeState()
    : await readStoreEnvelopeForRecoveryRehearsal(storePath);

  const checks = [];
  const errors = [];
  let restoredLedger = null;
  if (!currentStoreState.ok && currentStoreState.error) {
    errors.push(currentStoreState.error);
  }
  if (!currentEnvelopeState.readable && currentEnvelopeState.error) {
    errors.push(currentEnvelopeState.error);
  }

  checks.push({
    code: "wrapped_store_key_recovered",
    passed: restoredStoreKey.length === 32,
    evidence: {
      length: restoredStoreKey.length,
    },
  });

  if (bundle.ledger?.envelope) {
    try {
      restoredLedger = JSON.parse(decryptBufferWithKey(restoredStoreKey, bundle.ledger.envelope).toString("utf8"));
      checks.push({
        code: "ledger_envelope_decrypted",
        passed: true,
        evidence: {
          chainId: normalizeOptionalText(restoredLedger?.chainId) ?? null,
          lastEventHash: normalizeOptionalText(restoredLedger?.lastEventHash) ?? null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        code: "ledger_envelope_decrypted",
        passed: false,
        evidence: {
          error: message,
        },
      });
      errors.push(message);
    }
  } else {
    checks.push({
      code: "ledger_envelope_present",
      passed: false,
      evidence: {
        reason: "bundle_missing_ledger_envelope",
      },
    });
  }

  checks.push({
    code: "current_store_loaded",
    passed: currentStoreState.ok,
    evidence: {
      error: currentStoreState.error,
    },
  });
  checks.push({
    code: "bundle_chain_matches_current",
    passed:
      Boolean(restoredLedger) &&
      Boolean(currentStoreState.ok) &&
      normalizeOptionalText(restoredLedger?.chainId) === normalizeOptionalText(currentStore?.chainId),
    evidence: {
      bundleChainId: normalizeOptionalText(restoredLedger?.chainId) ?? normalizeOptionalText(bundle.metadata?.chainId) ?? null,
      currentChainId: normalizeOptionalText(currentStore?.chainId) ?? null,
      comparisonAvailable: Boolean(restoredLedger) && Boolean(currentStoreState.ok),
      reason:
        restoredLedger
          ? currentStoreState.ok
            ? null
            : "current_store_unavailable"
          : "restored_ledger_unavailable",
    },
  });
  checks.push({
    code: "bundle_last_event_matches_current",
    passed:
      Boolean(restoredLedger) &&
      Boolean(currentStoreState.ok) &&
      normalizeOptionalText(restoredLedger?.lastEventHash) === normalizeOptionalText(currentStore?.lastEventHash),
    evidence: {
      bundleLastEventHash:
        normalizeOptionalText(restoredLedger?.lastEventHash) ?? normalizeOptionalText(bundle.metadata?.lastEventHash) ?? null,
      currentLastEventHash: normalizeOptionalText(currentStore?.lastEventHash) ?? null,
      comparisonAvailable: Boolean(restoredLedger) && Boolean(currentStoreState.ok),
      reason:
        restoredLedger
          ? currentStoreState.ok
            ? null
            : "current_store_unavailable"
          : "restored_ledger_unavailable",
    },
  });
  checks.push({
    code: "current_store_envelope_encrypted",
    passed: currentEnvelopeState.readable && isEncryptedStoreEnvelope(currentEnvelopeState.envelope),
    evidence: {
      present: currentEnvelopeState.present,
      readable: currentEnvelopeState.readable,
      format: normalizeOptionalText(currentEnvelopeState.envelope?.format) ?? null,
      error: currentEnvelopeState.error,
    },
  });

  const passedCount = checks.filter((entry) => entry.passed).length;
  const failedCount = checks.filter((entry) => !entry.passed).length;
  const status = failedCount === 0 ? "passed" : passedCount > 0 ? "partial" : "failed";
  const rehearsal = {
    rehearsalId: createRecordId("rhr"),
    bundleId: normalizeOptionalText(bundle.bundleId) ?? null,
    createdAt: now(),
    dryRun,
    persistRequested: Boolean(persist && !dryRun),
    persisted: Boolean(persist && !dryRun && currentStoreState.ok),
    persistSkippedReason: persist && !dryRun && !currentStoreState.ok ? "current_store_unavailable" : null,
    note,
    status,
    checkCount: checks.length,
    passedCount,
    failedCount,
    summary:
      status === "passed"
        ? "recovery rehearsal passed"
        : status === "partial"
          ? "recovery rehearsal partial"
          : "recovery rehearsal failed",
    bundle: buildStoreRecoveryBundleSummary(bundle, bundlePath),
    checks,
    errors,
  };

  if (persist && !dryRun && currentStoreState.ok) {
    if (!Array.isArray(currentStore.recoveryRehearsals)) {
      currentStore.recoveryRehearsals = [];
    }
    currentStore.recoveryRehearsals.push(rehearsal);
    if (normalizeOptionalText(currentStore.deviceRuntime?.residentAgentId)) {
      appendTranscriptEntries(currentStore, currentStore.deviceRuntime.residentAgentId, [
        {
          entryType: "recovery_rehearsal",
          family: "runtime",
          role: "system",
          title: "Recovery Rehearsal",
          summary: rehearsal.summary,
          content: truncatePromptSection(rehearsal, { maxChars: 1200, maxTokens: 180 }),
          relatedVerificationRunId: rehearsal.rehearsalId,
        },
      ]);
    }
    appendEvent(currentStore, "store_recovery_rehearsed", {
      rehearsalId: rehearsal.rehearsalId,
      bundleId: rehearsal.bundleId,
      status: rehearsal.status,
      failedCount: rehearsal.failedCount,
    });
    await writeStore(currentStore);
  }

  return {
    rehearsal: buildRecoveryRehearsalView(rehearsal),
  };
}

export async function exportDeviceSetupPackage(
  payload = {},
  {
    loadStore,
    getDeviceSetupStatus,
    normalizeDeviceRuntime,
    protocolName,
    chainIdFromStore,
    deviceSetupPackageFormat,
    deviceSetupPackageDir,
    appendEvent,
    writeStore,
  } = {}
) {
  const store = await loadStore();
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const saveToFile = normalizeBooleanFlag(payload.saveToFile, true);
  const returnPackage = normalizeBooleanFlag(payload.returnPackage, true);
  const includeLocalReasonerProfiles = normalizeBooleanFlag(payload.includeLocalReasonerProfiles, true);
  const note = normalizeOptionalText(payload.note) ?? null;
  const setupStatus = await getDeviceSetupStatus({
    passive: dryRun,
    store,
  });
  const latestPassedRehearsal = Array.isArray(setupStatus.recoveryRehearsals?.rehearsals)
    ? setupStatus.recoveryRehearsals.rehearsals.find((item) => item?.status === "passed") ?? null
    : null;
  const runtimeConfig = cloneJson(normalizeDeviceRuntime(store.deviceRuntime));
  const setupPackage = {
    format: deviceSetupPackageFormat,
    packageId: createRecordId("setup"),
    exportedAt: now(),
    machineId: normalizeOptionalText(runtimeConfig.machineId) ?? null,
    machineLabel: normalizeOptionalText(runtimeConfig.machineLabel) ?? null,
    residentAgentId: normalizeOptionalText(runtimeConfig.residentAgentId) ?? null,
    residentDidMethod: normalizeOptionalText(runtimeConfig.residentDidMethod) ?? null,
    note,
    protocol: {
      name: protocolName,
      chainId: chainIdFromStore(store),
    },
    runtimeConfig,
    setupStatus: {
      setupComplete: Boolean(setupStatus.setupComplete),
      missingRequiredCodes: normalizeTextList(setupStatus.missingRequiredCodes),
      checks: Array.isArray(setupStatus.checks) ? cloneJson(setupStatus.checks) : [],
    },
    bootstrapGate: setupStatus.bootstrapGate
      ? {
          required: Boolean(setupStatus.bootstrapGate.required),
          missingRequiredCodes: normalizeTextList(setupStatus.bootstrapGate.missingRequiredCodes),
          summary: normalizeOptionalText(setupStatus.bootstrapGate.summary) ?? null,
        }
      : null,
    recovery: {
      bundleCount: Number(setupStatus.recoveryBundles?.counts?.total || 0),
      latestBundle: setupStatus.recoveryBundles?.bundles?.[0]
        ? {
            ...cloneJson(setupStatus.recoveryBundles.bundles[0]),
            bundlePath: null,
          }
        : null,
      passedRehearsalCount: Number(setupStatus.recoveryRehearsals?.counts?.passed || 0),
      latestPassedRehearsal: latestPassedRehearsal
        ? {
            rehearsalId: latestPassedRehearsal.rehearsalId,
            createdAt: latestPassedRehearsal.createdAt,
            status: latestPassedRehearsal.status,
            summary: latestPassedRehearsal.summary,
          }
        : null,
    },
    localReasonerProfiles: includeLocalReasonerProfiles
      ? selectSetupPackageLocalReasonerProfiles(store.localReasonerProfiles, payload)
      : [],
  };

  let packagePath = null;
  if (saveToFile && !dryRun) {
    await mkdir(deviceSetupPackageDir, { recursive: true });
    packagePath = path.join(deviceSetupPackageDir, `${setupPackage.packageId}.json`);
    await writeFile(packagePath, `${JSON.stringify(setupPackage, null, 2)}\n`, "utf8");
  }

  if (!dryRun) {
    appendEvent(store, "device_setup_package_exported", {
      packageId: setupPackage.packageId,
      residentAgentId: setupPackage.residentAgentId,
      residentDidMethod: setupPackage.residentDidMethod,
      savedToFile: Boolean(packagePath),
      setupComplete: Boolean(setupPackage.setupStatus?.setupComplete),
      localReasonerProfileCount: Array.isArray(setupPackage.localReasonerProfiles)
        ? setupPackage.localReasonerProfiles.length
        : 0,
    });
    await writeStore(store);
  }

  return {
    exportedAt: now(),
    dryRun,
    setupPackageDir: deviceSetupPackageDir,
    package: returnPackage ? setupPackage : null,
    summary: buildDeviceSetupPackageSummary(setupPackage, packagePath),
  };
}

export async function importDeviceSetupPackage(
  payload = {},
  {
    resolveDeviceSetupPackageInputImpl,
    normalizeDeviceRuntime,
    normalizeDidMethodImpl,
    configureDeviceRuntime,
    normalizeLocalReasonerProfileRecord,
    loadStore,
    appendEvent,
    writeStore,
    getDeviceSetupStatus,
  } = {}
) {
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const allowResidentRebind = normalizeBooleanFlag(payload.allowResidentRebind, false);
  const importLocalReasonerProfiles = normalizeBooleanFlag(payload.importLocalReasonerProfiles, true);
  const overwriteLocalReasonerProfiles = normalizeBooleanFlag(payload.overwriteLocalReasonerProfiles, false);
  const { setupPackage, packagePath } = await resolveDeviceSetupPackageInputImpl(payload);
  const runtimeConfig = normalizeDeviceRuntime(setupPackage.runtimeConfig || {});
  const residentAgentId =
    normalizeOptionalText(payload.residentAgentId || setupPackage.residentAgentId || runtimeConfig.residentAgentId) ?? null;
  const residentDidMethod =
    normalizeDidMethodImpl(payload.residentDidMethod || setupPackage.residentDidMethod || runtimeConfig.residentDidMethod) ||
    "agentpassport";

  const runtime = await configureDeviceRuntime({
    residentAgentId,
    residentDidMethod,
    residentLocked: runtimeConfig.residentLocked,
    localMode: runtimeConfig.localMode,
    allowOnlineReasoner: runtimeConfig.allowOnlineReasoner,
    commandPolicy: cloneJson(runtimeConfig.commandPolicy) ?? {},
    retrievalPolicy: cloneJson(runtimeConfig.retrievalPolicy) ?? {},
    setupPolicy: cloneJson(runtimeConfig.setupPolicy) ?? {},
    localReasoner: cloneJson(runtimeConfig.localReasoner) ?? {},
    sandboxPolicy: cloneJson(runtimeConfig.sandboxPolicy) ?? {},
    allowResidentRebind,
    dryRun,
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId) ?? null,
    updatedByWindowId: normalizeOptionalText(payload.updatedByWindowId) ?? null,
    updatedByAgentId: normalizeOptionalText(payload.updatedByAgentId) ?? residentAgentId,
  });

  const importedProfiles = Array.isArray(setupPackage.localReasonerProfiles)
    ? setupPackage.localReasonerProfiles.map((profile) => normalizeLocalReasonerProfileRecord(profile))
    : [];
  const duplicateImportedProfileIds = findDuplicateTextValues(importedProfiles.map((profile) => profile?.profileId));
  if (duplicateImportedProfileIds.length > 0) {
    throw new Error(
      `Device setup package contains duplicate local reasoner profile IDs: ${duplicateImportedProfileIds.join(", ")}`
    );
  }
  const currentStore =
    importLocalReasonerProfiles && importedProfiles.length > 0
      ? await loadStore()
      : null;
  const existingProfileIds = new Set(
    (Array.isArray(currentStore?.localReasonerProfiles) ? currentStore.localReasonerProfiles : [])
      .map((profile) => normalizeOptionalText(profile?.profileId))
      .filter(Boolean)
  );
  const collidingProfileIds = importedProfiles
    .map((profile) => normalizeOptionalText(profile?.profileId))
    .filter((profileId) => profileId && existingProfileIds.has(profileId));
  const uniqueCollidingProfileIds = Array.from(new Set(collidingProfileIds)).sort((left, right) => left.localeCompare(right));
  if (importLocalReasonerProfiles && uniqueCollidingProfileIds.length > 0 && !overwriteLocalReasonerProfiles && !dryRun) {
    throw new Error(
      `Local reasoner profiles already exist and would be overwritten: ${uniqueCollidingProfileIds.join(", ")}; set overwriteLocalReasonerProfiles=true to replace them`
    );
  }
  let profileImport = {
    imported: false,
    importedCount: 0,
    updatedCount: 0,
    createdCount: 0,
    skippedCount: importedProfiles.length,
    totalProfiles: importedProfiles.length,
    overwriteEnabled: overwriteLocalReasonerProfiles,
    collidingProfileIds: uniqueCollidingProfileIds,
    wouldOverwriteExistingProfiles: uniqueCollidingProfileIds.length > 0,
    requiresExplicitOverwrite: uniqueCollidingProfileIds.length > 0 && !overwriteLocalReasonerProfiles,
  };
  if (importLocalReasonerProfiles && importedProfiles.length > 0) {
    if (dryRun) {
      const updatedCount = importedProfiles.filter((profile) => existingProfileIds.has(profile.profileId)).length;
      const createdCount = importedProfiles.length - updatedCount;
      profileImport = {
        imported: false,
        importedCount: 0,
        updatedCount,
        createdCount,
        skippedCount: 0,
        totalProfiles: importedProfiles.length,
        overwriteEnabled: overwriteLocalReasonerProfiles,
        collidingProfileIds: uniqueCollidingProfileIds,
        wouldOverwriteExistingProfiles: uniqueCollidingProfileIds.length > 0,
        requiresExplicitOverwrite: uniqueCollidingProfileIds.length > 0 && !overwriteLocalReasonerProfiles,
      };
    } else {
      const latestStore = await loadStore();
      if (!Array.isArray(latestStore.localReasonerProfiles)) {
        latestStore.localReasonerProfiles = [];
      }
      let updatedCount = 0;
      let createdCount = 0;
      for (const profile of importedProfiles) {
        const index = latestStore.localReasonerProfiles.findIndex((entry) => entry?.profileId === profile.profileId);
        if (index >= 0) {
          latestStore.localReasonerProfiles[index] = profile;
          updatedCount += 1;
        } else {
          latestStore.localReasonerProfiles.push(profile);
          createdCount += 1;
        }
      }
      appendEvent(latestStore, "device_setup_package_imported", {
        packageId: normalizeOptionalText(setupPackage.packageId) ?? null,
        residentAgentId,
        residentDidMethod,
        importedLocalReasonerProfiles: importedProfiles.length,
        overwrittenLocalReasonerProfiles: updatedCount,
        createdLocalReasonerProfiles: createdCount,
      });
      await writeStore(latestStore);
      profileImport = {
        imported: true,
        importedCount: importedProfiles.length,
        updatedCount,
        createdCount,
        skippedCount: 0,
        totalProfiles: importedProfiles.length,
        overwriteEnabled: overwriteLocalReasonerProfiles,
        collidingProfileIds: uniqueCollidingProfileIds,
        wouldOverwriteExistingProfiles: uniqueCollidingProfileIds.length > 0,
        requiresExplicitOverwrite: uniqueCollidingProfileIds.length > 0 && !overwriteLocalReasonerProfiles,
      };
    }
  }
  const status = await getDeviceSetupStatus();
  return {
    importedAt: now(),
    dryRun,
    allowResidentRebind,
    importLocalReasonerProfiles,
    overwriteLocalReasonerProfiles,
    summary: buildDeviceSetupPackageSummary(setupPackage, packagePath),
    runtime,
    localReasonerProfiles: profileImport,
    status,
  };
}

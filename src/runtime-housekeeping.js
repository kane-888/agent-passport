import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  listDeviceSetupPackages,
  listReadSessions,
  listStoreRecoveryBundles,
  pruneDeviceSetupPackages,
  revokeAllReadSessions,
} from "./ledger.js";
import {
  buildDeviceSetupPackageSummary,
  buildStoreRecoveryBundleSummary,
} from "./ledger-recovery-setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const defaultArchiveDir = path.join(dataDir, "archives");
const defaultLiveLedgerPath = process.env.OPENNEED_LEDGER_PATH || path.join(dataDir, "ledger.json");
const defaultRecoveryDir = process.env.AGENT_PASSPORT_RECOVERY_DIR || path.join(dataDir, "recovery-bundles");
const defaultSetupPackageDir =
  process.env.AGENT_PASSPORT_SETUP_PACKAGE_DIR || path.join(dataDir, "device-setup-packages");

function normalizeKeepCount(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function summarizeRecoveryBundle(entry = null) {
  return entry
    ? {
        bundleId: entry.bundleId || null,
        createdAt: entry.createdAt || null,
        residentAgentId: entry.residentAgentId || null,
        note: entry.note || null,
        bundlePath: entry.bundlePath || null,
      }
    : null;
}

function summarizeSetupPackage(entry = null) {
  return entry
    ? {
        packageId: entry.packageId || null,
        exportedAt: entry.exportedAt || null,
        residentAgentId: entry.residentAgentId || null,
        note: entry.note || null,
        packagePath: entry.packagePath || null,
      }
    : null;
}

async function safeStat(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function countFilesRecursively(targetPath) {
  try {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    let fileCount = 0;
    for (const entry of entries) {
      const nextPath = path.join(targetPath, entry.name);
      if (entry.isDirectory()) {
        fileCount += await countFilesRecursively(nextPath);
      } else if (entry.isFile()) {
        fileCount += 1;
      }
    }
    return fileCount;
  } catch (error) {
    if (error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function summarizeArchiveDirectories(targetDir) {
  try {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const directories = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const nextPath = path.join(targetDir, entry.name);
      directories.push({
        name: entry.name,
        path: nextPath,
        fileCount: null,
        updatedAt: null,
      });
    }
    directories.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
    return directories;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readJsonFileIfPresent(targetPath) {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

function deriveJsonRecordId(fileName = "") {
  return fileName.endsWith(".json") ? fileName.slice(0, -5) : fileName;
}

async function listJsonFileSnapshots(targetDir) {
  try {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const filePath = path.join(targetDir, entry.name);
          const stat = await safeStat(filePath);
          return {
            name: entry.name,
            filePath,
            updatedAt: stat?.mtime?.toISOString?.() || null,
          };
        })
    );
    files.sort(
      (left, right) =>
        String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")) ||
        String(right.name || "").localeCompare(String(left.name || ""))
    );
    return files;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function buildRecoveryBundleAuditSummary(file = null, { parse = false } = {}) {
  if (!file) {
    return null;
  }
  if (parse) {
    const parsed = await readJsonFileIfPresent(file.filePath);
    if (parsed && typeof parsed === "object") {
      return summarizeRecoveryBundle(buildStoreRecoveryBundleSummary(parsed, file.filePath));
    }
  }
  return {
    bundleId: deriveJsonRecordId(file.name),
    createdAt: file.updatedAt,
    residentAgentId: null,
    note: null,
    bundlePath: file.filePath,
  };
}

async function buildSetupPackageAuditSummary(file = null, { parse = false } = {}) {
  if (!file) {
    return null;
  }
  if (parse) {
    const parsed = await readJsonFileIfPresent(file.filePath);
    if (parsed && typeof parsed === "object") {
      return summarizeSetupPackage(buildDeviceSetupPackageSummary(parsed, file.filePath));
    }
  }
  return {
    packageId: deriveJsonRecordId(file.name),
    exportedAt: file.updatedAt,
    residentAgentId: null,
    note: null,
    packagePath: file.filePath,
  };
}

async function buildAuditRecoveryInventory({ keepLatest = 3, recoveryDir = defaultRecoveryDir } = {}) {
  const files = await listJsonFileSnapshots(recoveryDir);
  return {
    bundles: await Promise.all(
      files.slice(0, keepLatest).map((entry) => buildRecoveryBundleAuditSummary(entry, { parse: true }))
    ),
    candidates: await Promise.all(
      files.slice(keepLatest).map((entry) => buildRecoveryBundleAuditSummary(entry))
    ),
    counts: {
      total: files.length,
    },
    recoveryDir,
  };
}

async function buildAuditSetupMaintenance({ keepLatest = 3, packageDir = defaultSetupPackageDir } = {}) {
  const files = await listJsonFileSnapshots(packageDir);
  const kept = await Promise.all(
    files.slice(0, keepLatest).map((entry) => buildSetupPackageAuditSummary(entry, { parse: true }))
  );
  const deleted = await Promise.all(files.slice(keepLatest).map((entry) => buildSetupPackageAuditSummary(entry)));
  return {
    dryRun: true,
    keepLatest,
    counts: {
      matched: files.length,
      kept: kept.length,
      deleted: deleted.length,
    },
    kept,
    deleted,
    packageDir,
    total: files.length,
  };
}

export async function runRuntimeHousekeeping({
  apply = false,
  keepRecovery = 3,
  keepSetup = 3,
  archiveDir = defaultArchiveDir,
  recoveryDir = defaultRecoveryDir,
  setupPackageDir = defaultSetupPackageDir,
  liveLedgerPath = defaultLiveLedgerPath,
  revokedByAgentId = null,
  revokedByReadSessionId = null,
  revokedByWindowId = null,
} = {}) {
  const resolvedApply = Boolean(apply);
  const resolvedKeepRecovery = normalizeKeepCount(keepRecovery, 3);
  const resolvedKeepSetup = normalizeKeepCount(keepSetup, 3);

  const [allReadSessions, activeReadSessions, recoveryBundles, setupPackages, archiveDirectories, liveLedgerStat] =
    await Promise.all([
      listReadSessions({ includeExpired: true, includeRevoked: true }),
      listReadSessions({ includeExpired: false, includeRevoked: false }),
      resolvedApply
        ? listStoreRecoveryBundles({ limit: Number.MAX_SAFE_INTEGER })
        : buildAuditRecoveryInventory({
            keepLatest: resolvedKeepRecovery,
            recoveryDir,
          }),
      resolvedApply
        ? listDeviceSetupPackages({ limit: Number.MAX_SAFE_INTEGER })
        : buildAuditSetupMaintenance({
            keepLatest: resolvedKeepSetup,
            packageDir: setupPackageDir,
          }),
      summarizeArchiveDirectories(archiveDir),
      safeStat(liveLedgerPath),
    ]);

  const recoveryList = Array.isArray(recoveryBundles.bundles) ? recoveryBundles.bundles : [];
  const recoveryKept = Array.isArray(recoveryBundles.candidates)
    ? recoveryList
    : recoveryList.slice(0, resolvedKeepRecovery);
  const recoveryCandidates = Array.isArray(recoveryBundles.candidates)
    ? recoveryBundles.candidates.filter((entry) => entry?.bundlePath)
    : recoveryList.slice(resolvedKeepRecovery).filter((entry) => entry?.bundlePath);
  const deletedRecovery = [];
  if (resolvedApply) {
    for (const entry of recoveryCandidates) {
      try {
        await fs.unlink(entry.bundlePath);
        deletedRecovery.push(summarizeRecoveryBundle(entry));
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  const setupMaintenance = resolvedApply
    ? await pruneDeviceSetupPackages({
        keepLatest: resolvedKeepSetup,
        dryRun: false,
      })
    : setupPackages;

  const readSessionMaintenance = resolvedApply
    ? await revokeAllReadSessions({
        dryRun: false,
        note: "runtime_housekeeping_apply",
        revokedByAgentId,
        revokedByReadSessionId,
        revokedByWindowId: revokedByWindowId || "window_runtime_housekeeping",
      })
    : {
        revokedCount: Number(activeReadSessions.count || 0),
        dryRun: true,
      };

  const activeReadSessionsAfter = resolvedApply
    ? await listReadSessions({ includeExpired: false, includeRevoked: false })
    : activeReadSessions;

  return {
    ok: true,
    mode: resolvedApply ? "apply" : "audit",
    rootDir,
    paths: {
      dataDir,
      liveLedgerPath,
      archiveDir,
      recoveryDir: recoveryBundles.recoveryDir || recoveryDir || path.join(dataDir, "recovery-bundles"),
      setupPackageDir: setupPackages.packageDir || setupPackageDir || path.join(dataDir, "device-setup-packages"),
    },
    liveLedger: {
      exists: Boolean(liveLedgerStat),
      sizeBytes: liveLedgerStat?.size || 0,
      updatedAt: liveLedgerStat?.mtime?.toISOString?.() || null,
      touched: false,
      note: "这个流程不会修改当前 ledger.json，只会清理读会话和旧恢复产物。",
    },
    readSessions: {
      totalBefore: Number(allReadSessions.count || 0),
      activeBefore: Number(activeReadSessions.count || 0),
      activeAfter: Number(activeReadSessionsAfter.count || 0),
      revokedCount: Number(readSessionMaintenance.revokedCount || 0),
      dryRun: Boolean(readSessionMaintenance.dryRun),
    },
    recoveryBundles: {
      total: Number(recoveryBundles.counts?.total || recoveryList.length || 0),
      keepLatest: resolvedKeepRecovery,
      kept: recoveryKept.map(summarizeRecoveryBundle),
      candidates: recoveryCandidates.map(summarizeRecoveryBundle),
      deleted: deletedRecovery,
      deletedCount: deletedRecovery.length,
    },
    setupPackages: {
      total: Number(setupPackages.counts?.total || setupPackages.total || 0),
      keepLatest: resolvedKeepSetup,
      counts: setupMaintenance.counts || {
        matched: 0,
        kept: 0,
        deleted: 0,
      },
      kept: Array.isArray(setupMaintenance.kept) ? setupMaintenance.kept.map(summarizeSetupPackage) : [],
      candidates: Array.isArray(setupMaintenance.deleted) ? setupMaintenance.deleted.map(summarizeSetupPackage) : [],
      dryRun: Boolean(setupMaintenance.dryRun),
    },
    archives: {
      reportOnly: true,
      directoryCount: archiveDirectories.length,
      directories: archiveDirectories,
    },
    note: resolvedApply
      ? "已应用安全清理：读会话已撤销，旧恢复包和旧初始化包已按保留窗口处理。"
      : "这是审计模式，不会改 live ledger；切到 apply 才会真正执行清理。",
  };
}

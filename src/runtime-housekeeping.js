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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const defaultArchiveDir = path.join(dataDir, "archives");
const defaultLiveLedgerPath = process.env.OPENNEED_LEDGER_PATH || path.join(dataDir, "ledger.json");

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
      const stat = await safeStat(nextPath);
      directories.push({
        name: entry.name,
        path: nextPath,
        fileCount: await countFilesRecursively(nextPath),
        updatedAt: stat?.mtime?.toISOString?.() || null,
      });
    }
    directories.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
    return directories;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function runRuntimeHousekeeping({
  apply = false,
  keepRecovery = 3,
  keepSetup = 3,
  archiveDir = defaultArchiveDir,
  liveLedgerPath = defaultLiveLedgerPath,
} = {}) {
  const resolvedApply = Boolean(apply);
  const resolvedKeepRecovery = normalizeKeepCount(keepRecovery, 3);
  const resolvedKeepSetup = normalizeKeepCount(keepSetup, 3);

  const [allReadSessions, activeReadSessions, recoveryBundles, setupPackages, archiveDirectories, liveLedgerStat] =
    await Promise.all([
      listReadSessions({ includeExpired: true, includeRevoked: true }),
      listReadSessions({ includeExpired: false, includeRevoked: false }),
      listStoreRecoveryBundles({ limit: Number.MAX_SAFE_INTEGER }),
      listDeviceSetupPackages({ limit: Number.MAX_SAFE_INTEGER }),
      summarizeArchiveDirectories(archiveDir),
      safeStat(liveLedgerPath),
    ]);

  const recoveryList = Array.isArray(recoveryBundles.bundles) ? recoveryBundles.bundles : [];
  const recoveryCandidates = recoveryList.slice(resolvedKeepRecovery).filter((entry) => entry?.bundlePath);
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

  const setupMaintenance = await pruneDeviceSetupPackages({
    keepLatest: resolvedKeepSetup,
    dryRun: !resolvedApply,
  });

  const readSessionMaintenance = await revokeAllReadSessions({
    dryRun: !resolvedApply,
    note: resolvedApply ? "runtime_housekeeping_apply" : "runtime_housekeeping_audit",
    revokedByWindowId: "window_runtime_housekeeping",
  });

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
      recoveryDir: recoveryBundles.recoveryDir || path.join(dataDir, "recovery-bundles"),
      setupPackageDir: setupPackages.packageDir || path.join(dataDir, "device-setup-packages"),
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
      kept: recoveryList.slice(0, resolvedKeepRecovery).map(summarizeRecoveryBundle),
      candidates: recoveryCandidates.map(summarizeRecoveryBundle),
      deleted: deletedRecovery,
      deletedCount: deletedRecovery.length,
    },
    setupPackages: {
      total: Number(setupPackages.counts?.total || 0),
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

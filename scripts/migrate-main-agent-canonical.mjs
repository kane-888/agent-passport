import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  AGENT_PASSPORT_MAIN_AGENT_ID,
  LEGACY_OPENNEED_AGENT_ID,
  applyMainAgentCanonicalPhysicalMigration,
  importStoreRecoveryBundle,
  previewMainAgentCanonicalPhysicalMigration,
  resolveAgentIdentity,
} from "../src/ledger.js";
import { rewriteMainAgentArchiveJsonlStructuredReferences } from "../src/main-agent-canonical-migration.js";
import { resolveAgentPassportLedgerPath } from "../src/runtime-path-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const RECEIPT_FORMAT = "agent-passport-main-agent-canonical-migration-receipt-v1";
const ARCHIVE_CONTENT_REWRITE_MODE_RENAME_ONLY = "directory_rename_only_jsonl_not_rewritten";
const ARCHIVE_CONTENT_REWRITE_MODE_STRUCTURED = "directory_rename_and_structured_jsonl_rewrite";
const IDENTITY_OWNER_BINDING_REQUESTED_AGENT_IDS = [
  AGENT_PASSPORT_MAIN_AGENT_ID,
  LEGACY_OPENNEED_AGENT_ID,
];

function text(value) {
  return String(value ?? "").trim();
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function wantsArchiveJsonlRewrite() {
  return hasFlag("--rewrite-archive-jsonl");
}

function resolveArchiveContentRewriteMode({ rewriteArchiveJsonl = false } = {}) {
  return rewriteArchiveJsonl ? ARCHIVE_CONTENT_REWRITE_MODE_STRUCTURED : ARCHIVE_CONTENT_REWRITE_MODE_RENAME_ONLY;
}

function readArgValue(name) {
  const prefix = `${name}=`;
  const entryIndex = process.argv.findIndex((value) => value === name || value.startsWith(prefix));
  if (entryIndex === -1) {
    return "";
  }
  const entry = process.argv[entryIndex];
  if (entry === name) {
    return process.argv[entryIndex + 1] || "";
  }
  return entry.slice(prefix.length);
}

function buildDefaultReceiptPath() {
  const ledgerPath = resolveLedgerPath();
  const receiptDir = path.join(path.dirname(ledgerPath), "migration-receipts");
  const receiptName = `main-agent-canonical-${Date.now()}.json`;
  return path.join(receiptDir, receiptName);
}

function resolveLedgerPath() {
  return path.resolve(resolveAgentPassportLedgerPath({ dataDir: path.join(rootDir, "data") }));
}

function resolveArchiveRoot() {
  return path.resolve(
    text(process.env.AGENT_PASSPORT_ARCHIVE_DIR) ||
      path.join(path.dirname(resolveLedgerPath()), "archives")
  );
}

function resolveOptionalPath(value) {
  const normalizedValue = text(value);
  return normalizedValue ? path.resolve(normalizedValue) : null;
}

function assertReceiptPathMatchesCurrentEnvironment(label, receiptPath, currentPath) {
  const resolvedReceiptPath = resolveOptionalPath(receiptPath);
  if (!resolvedReceiptPath) {
    return;
  }
  const resolvedCurrentPath = path.resolve(currentPath);
  if (resolvedReceiptPath !== resolvedCurrentPath) {
    throw new Error(`Receipt ${label} does not match current environment`);
  }
}

async function pathInfo(targetPath) {
  try {
    return await stat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function directoryExists(targetPath) {
  const info = await pathInfo(targetPath);
  return Boolean(info?.isDirectory?.());
}

async function countDirectoryEntries(targetPath) {
  if (!(await directoryExists(targetPath))) {
    return 0;
  }
  const entries = await readdir(targetPath, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      total += await countDirectoryEntries(entryPath);
      continue;
    }
    total += 1;
  }
  return total;
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])])
  );
}

function buildComparableArchiveJsonlStructuredAudit(directoryAudit = null) {
  if (!directoryAudit) {
    return null;
  }
  return sortJson({
    status: directoryAudit.status || null,
    scanCompleted: directoryAudit.scanCompleted === true,
    counts: {
      scannedFileCount: Number(directoryAudit?.counts?.scannedFileCount) || 0,
      nonEmptyLineCount: Number(directoryAudit?.counts?.nonEmptyLineCount) || 0,
      parsedRecordCount: Number(directoryAudit?.counts?.parsedRecordCount) || 0,
      invalidLineCount: Number(directoryAudit?.counts?.invalidLineCount) || 0,
      filesWithLegacyRefs: Number(directoryAudit?.counts?.filesWithLegacyRefs) || 0,
      filesWithCanonicalRefs: Number(directoryAudit?.counts?.filesWithCanonicalRefs) || 0,
      recordsWithLegacyRefs: Number(directoryAudit?.counts?.recordsWithLegacyRefs) || 0,
      recordsWithCanonicalRefs: Number(directoryAudit?.counts?.recordsWithCanonicalRefs) || 0,
      legacyReferenceCount: Number(directoryAudit?.counts?.legacyReferenceCount) || 0,
      canonicalReferenceCount: Number(directoryAudit?.counts?.canonicalReferenceCount) || 0,
    },
    byField: sortJson(directoryAudit?.byField || {}),
    byKind: sortJson(directoryAudit?.byKind || {}),
  });
}

function archiveJsonlStructuredAuditMatches(left = null, right = null) {
  const comparableLeft = buildComparableArchiveJsonlStructuredAudit(left);
  const comparableRight = buildComparableArchiveJsonlStructuredAudit(right);
  if (!comparableLeft || !comparableRight) {
    return null;
  }
  return JSON.stringify(comparableLeft) === JSON.stringify(comparableRight);
}

async function summarizeBundleIntegrity(bundlePath) {
  const resolvedPath = path.resolve(bundlePath);
  const info = await stat(resolvedPath);
  const content = await readFile(resolvedPath);
  return {
    present: true,
    bundlePath: resolvedPath,
    bundleSha256: createHash("sha256").update(content).digest("hex"),
    bundleSizeBytes: info.size,
    bundleCreatedAt:
      Number.isFinite(info.birthtimeMs) && info.birthtimeMs > 0
        ? info.birthtime.toISOString()
        : info.mtime.toISOString(),
  };
}

function buildTargetPaths(applied = null) {
  const ledgerPath = resolveLedgerPath();
  const archiveRoot = resolveArchiveRoot();
  return {
    ledgerPath,
    archiveRoot,
    legacyArchiveDir:
      text(applied?.archiveArtifacts?.legacyArchiveDir) ||
      path.join(archiveRoot, LEGACY_OPENNEED_AGENT_ID),
    canonicalArchiveDir:
      text(applied?.archiveArtifacts?.canonicalArchiveDir) ||
      path.join(archiveRoot, AGENT_PASSPORT_MAIN_AGENT_ID),
  };
}

async function validateRollbackReceiptAgainstCurrentEnvironment(receipt = {}) {
  const currentTargetPaths = buildTargetPaths();
  assertReceiptPathMatchesCurrentEnvironment("targetPaths.ledgerPath", receipt?.targetPaths?.ledgerPath, currentTargetPaths.ledgerPath);
  assertReceiptPathMatchesCurrentEnvironment("targetPaths.archiveRoot", receipt?.targetPaths?.archiveRoot, currentTargetPaths.archiveRoot);
  assertReceiptPathMatchesCurrentEnvironment(
    "targetPaths.legacyArchiveDir",
    receipt?.targetPaths?.legacyArchiveDir,
    currentTargetPaths.legacyArchiveDir
  );
  assertReceiptPathMatchesCurrentEnvironment(
    "targetPaths.canonicalArchiveDir",
    receipt?.targetPaths?.canonicalArchiveDir,
    currentTargetPaths.canonicalArchiveDir
  );
  assertReceiptPathMatchesCurrentEnvironment(
    "applied.archiveArtifacts.legacyArchiveDir",
    receipt?.applied?.archiveArtifacts?.legacyArchiveDir,
    currentTargetPaths.legacyArchiveDir
  );
  assertReceiptPathMatchesCurrentEnvironment(
    "applied.archiveArtifacts.canonicalArchiveDir",
    receipt?.applied?.archiveArtifacts?.canonicalArchiveDir,
    currentTargetPaths.canonicalArchiveDir
  );
  if (text(receipt?.legacyAgentId) && text(receipt?.legacyAgentId) !== LEGACY_OPENNEED_AGENT_ID) {
    throw new Error("Receipt legacyAgentId does not match the current migration contract");
  }
  if (text(receipt?.canonicalAgentId) && text(receipt?.canonicalAgentId) !== AGENT_PASSPORT_MAIN_AGENT_ID) {
    throw new Error("Receipt canonicalAgentId does not match the current migration contract");
  }

  const bundlePath = resolveOptionalPath(receipt?.rollback?.bundlePath);
  if (!bundlePath) {
    throw new Error("Receipt does not contain a recovery bundle path");
  }
  const expectedBundlePath = resolveOptionalPath(receipt?.bundleIntegrity?.bundlePath);
  if (expectedBundlePath && bundlePath !== expectedBundlePath) {
    throw new Error("Receipt rollback bundle path does not match recorded bundle integrity");
  }

  const currentBundleIntegrity = await summarizeBundleIntegrity(bundlePath);
  if (receipt?.bundleIntegrity?.present === true) {
    const expectedBundleSha256 = text(receipt?.bundleIntegrity?.bundleSha256) || null;
    const expectedBundleSizeBytes = Number(receipt?.bundleIntegrity?.bundleSizeBytes || 0);
    if (expectedBundleSha256 && currentBundleIntegrity.bundleSha256 !== expectedBundleSha256) {
      throw new Error("Receipt rollback bundle integrity hash mismatch");
    }
    if (expectedBundleSizeBytes > 0 && currentBundleIntegrity.bundleSizeBytes !== expectedBundleSizeBytes) {
      throw new Error("Receipt rollback bundle integrity size mismatch");
    }
  }

  return {
    currentTargetPaths,
    bundlePath,
    bundleIntegrity: currentBundleIntegrity,
  };
}

async function buildIdentityOwnerBinding({ currentPhysicalAgentId = null } = {}) {
  const normalizedCurrentPhysicalAgentId = text(currentPhysicalAgentId) || null;
  const resolutions = await Promise.all(
    IDENTITY_OWNER_BINDING_REQUESTED_AGENT_IDS.map(async (requestedAgentId) => {
      const resolvedAgent = await resolveAgentIdentity({ agentId: requestedAgentId });
      return {
        requestedAgentId,
        resolvedAgentId: text(resolvedAgent?.agentId) || null,
        resolvedAgentDid: text(resolvedAgent?.identity?.did) || null,
        resolvedDisplayName: text(resolvedAgent?.displayName) || null,
      };
    })
  );
  return {
    currentPhysicalAgentId: normalizedCurrentPhysicalAgentId,
    requestedAgentIds: [...IDENTITY_OWNER_BINDING_REQUESTED_AGENT_IDS],
    resolutions,
    resolutionByRequestedAgentId: Object.fromEntries(
      resolutions.map((entry) => [
        entry.requestedAgentId,
        {
          resolvedAgentId: entry.resolvedAgentId,
          resolvedAgentDid: entry.resolvedAgentDid,
          resolvedDisplayName: entry.resolvedDisplayName,
        },
      ])
    ),
    allResolvedToCurrentPhysicalOwner:
      Boolean(normalizedCurrentPhysicalAgentId) &&
      resolutions.every((entry) => entry.resolvedAgentId === normalizedCurrentPhysicalAgentId),
  };
}

function describeArchiveDirState({ archiveLegacyExists = false, archiveCanonicalExists = false } = {}) {
  if (archiveLegacyExists && archiveCanonicalExists) {
    return "both_present";
  }
  if (archiveLegacyExists) {
    return "legacy_only";
  }
  if (archiveCanonicalExists) {
    return "canonical_only";
  }
  return "missing";
}

function resolveArchiveJsonlStructuredAuditTarget({
  archiveLegacyExists = false,
  archiveCanonicalExists = false,
  fallback = null,
} = {}) {
  if (archiveLegacyExists && !archiveCanonicalExists) {
    return "legacy";
  }
  if (archiveCanonicalExists && !archiveLegacyExists) {
    return "canonical";
  }
  if (archiveCanonicalExists) {
    return "canonical";
  }
  if (archiveLegacyExists) {
    return "legacy";
  }
  return fallback;
}

function selectArchiveJsonlStructuredAuditDirectory(archiveAudit = null, target = null) {
  const normalizedTarget = text(target) || null;
  if (!normalizedTarget) {
    return null;
  }
  return archiveAudit?.directories?.[normalizedTarget] || null;
}

async function buildPreflightArchiveVerification(
  preview = null,
  targetPaths = buildTargetPaths(),
  { rewriteArchiveJsonl = false } = {}
) {
  const archiveLegacyExists = await directoryExists(targetPaths.legacyArchiveDir);
  const archiveCanonicalExists = await directoryExists(targetPaths.canonicalArchiveDir);
  const archiveDirState = describeArchiveDirState({
    archiveLegacyExists,
    archiveCanonicalExists,
  });
  const currentPhysicalAgentId = text(preview?.currentPhysicalAgentId) || null;
  const preferredArchiveDir =
    currentPhysicalAgentId === AGENT_PASSPORT_MAIN_AGENT_ID
      ? targetPaths.canonicalArchiveDir
      : currentPhysicalAgentId === LEGACY_OPENNEED_AGENT_ID
        ? targetPaths.legacyArchiveDir
        : null;
  const fallbackAuditTarget =
    currentPhysicalAgentId === AGENT_PASSPORT_MAIN_AGENT_ID
      ? "canonical"
      : currentPhysicalAgentId === LEGACY_OPENNEED_AGENT_ID
        ? "legacy"
        : null;
  const archiveJsonlStructuredAuditRequired = archiveLegacyExists || archiveCanonicalExists;
  const archiveJsonlStructuredAuditTarget = resolveArchiveJsonlStructuredAuditTarget({
    archiveLegacyExists,
    archiveCanonicalExists,
    fallback: fallbackAuditTarget,
  });
  const archiveJsonlStructuredAudit = preview?.archiveJsonlStructuredAudit || null;
  const archiveJsonlStructuredAuditDirectory = selectArchiveJsonlStructuredAuditDirectory(
    archiveJsonlStructuredAudit,
    archiveJsonlStructuredAuditTarget
  );
  const archivePathAlignedWithCurrentPhysicalId =
    !currentPhysicalAgentId
      ? null
      : currentPhysicalAgentId === AGENT_PASSPORT_MAIN_AGENT_ID
        ? archiveCanonicalExists && !archiveLegacyExists
        : currentPhysicalAgentId === LEGACY_OPENNEED_AGENT_ID
          ? archiveLegacyExists && !archiveCanonicalExists
          : null;
  const identityOwnerBinding = await buildIdentityOwnerBinding({ currentPhysicalAgentId });
  return {
    checkedAt: new Date().toISOString(),
    status: preview?.status || null,
    currentPhysicalAgentId,
    identityOwnerBinding,
    readyToApply: preview?.readyToApply === true,
    targetPaths,
    archiveLegacyExists,
    archiveCanonicalExists,
    archiveDirState,
    archivePathAlignedWithCurrentPhysicalId,
    archiveContentRewriteMode: resolveArchiveContentRewriteMode({ rewriteArchiveJsonl }),
    archiveJsonlStructuredAuditRequired,
    archiveJsonlStructuredAuditTarget,
    archiveJsonlStructuredAudit,
    archiveJsonlStructuredAuditDirectory,
    archiveJsonlStructuredAuditComplete:
      !archiveJsonlStructuredAuditRequired || archiveJsonlStructuredAuditDirectory?.scanCompleted === true,
    archiveJsonlStructuredAuditLegacyResidueDetected:
      Number(archiveJsonlStructuredAuditDirectory?.counts?.legacyReferenceCount || 0) > 0,
    archiveJsonlStructuredAuditCanonicalRefsDetected:
      Number(archiveJsonlStructuredAuditDirectory?.counts?.canonicalReferenceCount || 0) > 0,
    preferredArchiveDir,
  };
}

async function buildPostApplyVerification(applied = null, targetPaths = buildTargetPaths(applied)) {
  const preview = await previewMainAgentCanonicalPhysicalMigration();
  const archiveLegacyExists = await directoryExists(targetPaths.legacyArchiveDir);
  const archiveCanonicalExists = await directoryExists(targetPaths.canonicalArchiveDir);
  const archiveJsonlStructuredAuditRequired =
    applied?.archiveArtifacts?.migrated === true || archiveCanonicalExists || archiveLegacyExists;
  const archiveJsonlStructuredAuditTarget = resolveArchiveJsonlStructuredAuditTarget({
    archiveLegacyExists,
    archiveCanonicalExists,
    fallback: "canonical",
  });
  const archiveJsonlStructuredAudit = preview?.archiveJsonlStructuredAudit || null;
  const archiveJsonlStructuredAuditDirectory = selectArchiveJsonlStructuredAuditDirectory(
    archiveJsonlStructuredAudit,
    archiveJsonlStructuredAuditTarget
  );
  const archiveFilesFound = archiveJsonlStructuredAuditDirectory?.exists
    ? await countDirectoryEntries(archiveJsonlStructuredAuditDirectory.archiveDir)
    : 0;
  const reloadedStoreHash = text(preview?.beforeHash) || null;
  const expectedStoreHash = text(applied?.afterHash) || null;
  const archiveDirMatchesExpected =
    applied?.archiveArtifacts?.migrated === true
      ? archiveCanonicalExists && !archiveLegacyExists
      : true;
  const currentPhysicalAgentId = text(preview?.currentPhysicalAgentId) || null;
  const identityOwnerBinding = await buildIdentityOwnerBinding({ currentPhysicalAgentId });
  return {
    checkedAt: new Date().toISOString(),
    status: preview?.status || null,
    currentPhysicalAgentId,
    identityOwnerBinding,
    reloadedStoreHash,
    expectedStoreHash,
    matchesExpectedAfterHash: Boolean(reloadedStoreHash) && reloadedStoreHash === expectedStoreHash,
    archiveMigrationRequired: applied?.archiveArtifacts?.migrated === true,
    archiveLegacyExists,
    archiveCanonicalExists,
    archiveDirMatchesExpected,
    archiveFilesFound,
    archiveJsonlStructuredAuditRequired,
    archiveJsonlStructuredAuditTarget,
    archiveJsonlStructuredAudit,
    archiveJsonlStructuredAuditDirectory,
    archiveJsonlStructuredAuditComplete:
      !archiveJsonlStructuredAuditRequired || archiveJsonlStructuredAuditDirectory?.scanCompleted === true,
    archiveJsonlStructuredAuditLegacyResidueDetected:
      Number(archiveJsonlStructuredAuditDirectory?.counts?.legacyReferenceCount || 0) > 0,
    archiveJsonlStructuredAuditCanonicalRefsDetected:
      Number(archiveJsonlStructuredAuditDirectory?.counts?.canonicalReferenceCount || 0) > 0,
    archiveContentRewriteMode: resolveArchiveContentRewriteMode({
      rewriteArchiveJsonl: applied?.archiveJsonlRewrite?.scanCompleted === true,
    }),
    archiveJsonlRewrite: applied?.archiveJsonlRewrite || null,
    readyToApplyAgain: preview?.readyToApply === true,
    ok:
      Boolean(reloadedStoreHash) &&
      reloadedStoreHash === expectedStoreHash &&
      preview?.currentPhysicalAgentId === AGENT_PASSPORT_MAIN_AGENT_ID &&
      archiveDirMatchesExpected &&
      (!archiveJsonlStructuredAuditRequired || archiveJsonlStructuredAuditDirectory?.scanCompleted === true),
  };
}

async function restoreArchiveDirectoryFromReceipt(receipt = {}, targetPaths = buildTargetPaths()) {
  const required =
    receipt?.rollback?.archivePhysicalRestoreRequired === true ||
    receipt?.applied?.archiveArtifacts?.migrated === true;
  if (!required) {
    return {
      required: false,
      restored: false,
      status: "not_required",
      ...targetPaths,
    };
  }

  const legacyExists = await directoryExists(targetPaths.legacyArchiveDir);
  const canonicalExists = await directoryExists(targetPaths.canonicalArchiveDir);
  if (legacyExists && canonicalExists) {
    throw new Error("Archive rollback is ambiguous: both legacy and canonical archive directories exist");
  }
  if (legacyExists && !canonicalExists) {
    return {
      required: true,
      restored: false,
      status: "already_restored",
      ...targetPaths,
    };
  }
  if (!legacyExists && !canonicalExists) {
    return {
      required: true,
      restored: false,
      status: "archive_directory_missing",
      ...targetPaths,
    };
  }

  await rename(targetPaths.canonicalArchiveDir, targetPaths.legacyArchiveDir);
  return {
    required: true,
    restored: true,
    status: "restored",
    ...targetPaths,
  };
}

async function buildPostRollbackVerification(receipt = {}, archiveRestore = null, targetPaths = buildTargetPaths()) {
  const preview = await previewMainAgentCanonicalPhysicalMigration();
  const archiveLegacyExists = await directoryExists(targetPaths.legacyArchiveDir);
  const archiveCanonicalExists = await directoryExists(targetPaths.canonicalArchiveDir);
  const expectedStoreHash =
    text(receipt?.rollback?.expectedStoreHashAfterRollback) ||
    text(receipt?.applied?.beforeHash) ||
    null;
  const currentStoreHash = text(preview?.beforeHash) || null;
  const archiveRestoreRequired = archiveRestore?.required === true;
  const archivePathMatchesExpected = archiveRestoreRequired
    ? archiveLegacyExists && !archiveCanonicalExists
    : true;
  const applyArchiveJsonlStructuredAuditTarget = text(receipt?.postApplyVerification?.archiveJsonlStructuredAuditTarget) || null;
  const applyArchiveJsonlStructuredAudit = selectArchiveJsonlStructuredAuditDirectory(
    receipt?.postApplyVerification?.archiveJsonlStructuredAudit || null,
    applyArchiveJsonlStructuredAuditTarget
  );
  const archiveJsonlStructuredAuditRequired =
    archiveRestoreRequired || archiveLegacyExists || archiveCanonicalExists || Boolean(applyArchiveJsonlStructuredAudit);
  const archiveJsonlStructuredAuditTarget = resolveArchiveJsonlStructuredAuditTarget({
    archiveLegacyExists,
    archiveCanonicalExists,
    fallback: "legacy",
  });
  const archiveJsonlStructuredAudit = preview?.archiveJsonlStructuredAudit || null;
  const archiveJsonlStructuredAuditDirectory = selectArchiveJsonlStructuredAuditDirectory(
    archiveJsonlStructuredAudit,
    archiveJsonlStructuredAuditTarget
  );
  const archiveJsonlStructuredAuditMatchesApplyReceipt =
    applyArchiveJsonlStructuredAudit && archiveJsonlStructuredAuditDirectory
      ? archiveJsonlStructuredAuditMatches(applyArchiveJsonlStructuredAudit, archiveJsonlStructuredAuditDirectory)
      : null;
  const archiveJsonlStructuredAuditApplyReceiptFreshness =
    archiveJsonlStructuredAuditMatchesApplyReceipt == null
      ? "not_available"
      : archiveJsonlStructuredAuditMatchesApplyReceipt
        ? "fresh"
        : "stale_after_apply_archive_activity";
  const archiveContentRewriteMode =
    text(receipt?.archiveContentRewriteMode) || ARCHIVE_CONTENT_REWRITE_MODE_RENAME_ONLY;
  const archiveJsonlStructuredAuditRollbackContract =
    archiveContentRewriteMode === ARCHIVE_CONTENT_REWRITE_MODE_STRUCTURED
      ? "physical_directory_restore_and_structured_agent_reference_rewrite"
      : "physical_directory_restore_only_raw_archive_jsonl_not_rewound";
  const archiveJsonlStructuredAuditMatchesRollbackExpectation = !archiveJsonlStructuredAuditRequired
    ? true
    : archiveLegacyExists && archiveJsonlStructuredAuditDirectory?.scanCompleted === true;
  const currentPhysicalAgentId = text(preview?.currentPhysicalAgentId) || null;
  const identityOwnerBinding = await buildIdentityOwnerBinding({ currentPhysicalAgentId });
  return {
    checkedAt: new Date().toISOString(),
    status: preview?.status || null,
    currentPhysicalAgentId,
    identityOwnerBinding,
    currentStoreHash,
    expectedStoreHash,
    matchesExpectedRollbackHash: Boolean(currentStoreHash) && currentStoreHash === expectedStoreHash,
    readyToReapply: preview?.readyToApply === true,
    archiveRestore,
    archiveLegacyExists,
    archiveCanonicalExists,
    archivePathMatchesExpected,
    archiveJsonlStructuredAuditRequired,
    archiveJsonlStructuredAuditTarget,
    archiveJsonlStructuredAudit,
    archiveJsonlStructuredAuditDirectory,
    archiveJsonlStructuredAuditComplete:
      !archiveJsonlStructuredAuditRequired || archiveJsonlStructuredAuditDirectory?.scanCompleted === true,
    archiveJsonlStructuredAuditLegacyResidueDetected:
      Number(archiveJsonlStructuredAuditDirectory?.counts?.legacyReferenceCount || 0) > 0,
    archiveJsonlStructuredAuditCanonicalRefsDetected:
      Number(archiveJsonlStructuredAuditDirectory?.counts?.canonicalReferenceCount || 0) > 0,
    archiveContentRewriteMode,
    archiveJsonlStructuredAuditRollbackContract,
    archiveJsonlStructuredAuditMatchesRollbackExpectation,
    archiveJsonlStructuredAuditMatchesApplyReceipt,
    archiveJsonlStructuredAuditApplyReceiptFreshness,
    ok:
      Boolean(currentStoreHash) &&
      currentStoreHash === expectedStoreHash &&
      preview?.currentPhysicalAgentId === LEGACY_OPENNEED_AGENT_ID &&
      archivePathMatchesExpected &&
      archiveJsonlStructuredAuditMatchesRollbackExpectation &&
      (!archiveJsonlStructuredAuditRequired || archiveJsonlStructuredAuditDirectory?.scanCompleted === true),
  };
}

async function writeReceipt(receiptPath, receipt) {
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

async function readReceipt(receiptPath) {
  const parsed = JSON.parse(await readFile(receiptPath, "utf8"));
  if (parsed?.format !== RECEIPT_FORMAT) {
    throw new Error("Invalid main-agent migration receipt");
  }
  return parsed;
}

async function runDryRun() {
  const rewriteArchiveJsonl = wantsArchiveJsonlRewrite();
  const preview = await previewMainAgentCanonicalPhysicalMigration();
  const targetPaths = buildTargetPaths();
  const preflightVerification = await buildPreflightArchiveVerification(preview, targetPaths, { rewriteArchiveJsonl });
  return {
    mode: "dry_run",
    ok: true,
    preview,
    targetPaths,
    archiveContentRewriteMode: resolveArchiveContentRewriteMode({ rewriteArchiveJsonl }),
    preflightVerification,
  };
}

async function runApply() {
  const passphrase = text(readArgValue("--passphrase"));
  const rewriteArchiveJsonl = wantsArchiveJsonlRewrite();
  if (!passphrase) {
    throw new Error("--passphrase is required with --apply");
  }

  const preview = await previewMainAgentCanonicalPhysicalMigration();
  const targetPaths = buildTargetPaths();
  const preflightVerification = await buildPreflightArchiveVerification(preview, targetPaths, { rewriteArchiveJsonl });
  if (
    preflightVerification.archiveJsonlStructuredAuditRequired &&
    preflightVerification.archiveJsonlStructuredAuditComplete !== true
  ) {
    return {
      mode: "apply",
      ok: false,
      blocked: true,
      blockedReason: "archive_jsonl_structured_audit_incomplete",
      preview,
      targetPaths,
      archiveContentRewriteMode: resolveArchiveContentRewriteMode({ rewriteArchiveJsonl }),
      preflightVerification,
      receiptPath: null,
      receipt: null,
    };
  }

  const receiptPath = path.resolve(readArgValue("--receipt-path") || buildDefaultReceiptPath());
  const note = text(readArgValue("--note")) || "main agent canonical physical migration";
  const applied = await applyMainAgentCanonicalPhysicalMigration({
    passphrase,
    note,
    rewriteArchiveJsonl,
  });
  const appliedTargetPaths = buildTargetPaths(applied);
  const bundlePath = applied?.recoveryBundle?.summary?.bundlePath || null;
  const bundleIntegrity = bundlePath ? await summarizeBundleIntegrity(bundlePath) : null;
  const postApplyVerification = await buildPostApplyVerification(applied, appliedTargetPaths);
  const rollbackAvailable = Boolean(applied?.applied && bundlePath);
  const receipt = {
    format: RECEIPT_FORMAT,
    migrationId: `main-agent-canonical-${Date.now()}`,
    createdAt: new Date().toISOString(),
    script: {
      path: __filename,
      version: 1,
    },
    legacyAgentId: LEGACY_OPENNEED_AGENT_ID,
    canonicalAgentId: AGENT_PASSPORT_MAIN_AGENT_ID,
    note,
    targetPaths: appliedTargetPaths,
    bundleIntegrity,
    rollbackAvailability: {
      canRollback: rollbackAvailable,
      appliedSuccessfully: applied?.applied === true,
      bundlePresent: Boolean(bundlePath),
    },
    archiveContentRewriteMode: resolveArchiveContentRewriteMode({ rewriteArchiveJsonl }),
    postApplyVerification,
    applied,
    rollback: {
      strategy: "import_store_recovery_bundle",
      requiresPassphrase: true,
      bundlePath,
      receiptPath,
      archivePhysicalRestoreRequired: applied?.archiveArtifacts?.migrated === true,
      archiveJsonlStructuredAuditMode: "read_only_structured_agent_reference_audit",
      archiveJsonlStructuredAuditRollbackContract:
        resolveArchiveContentRewriteMode({ rewriteArchiveJsonl }) === ARCHIVE_CONTENT_REWRITE_MODE_STRUCTURED
          ? "physical_directory_restore_and_structured_agent_reference_rewrite"
          : "physical_directory_restore_only_raw_archive_jsonl_not_rewound",
      compareArchiveJsonlStructuredAuditAgainstApplyReceipt:
        Boolean(postApplyVerification?.archiveJsonlStructuredAuditDirectory),
      expectedStoreHashAfterRollback: applied?.beforeHash || null,
      expectedPhysicalAgentIdAfterRollback: LEGACY_OPENNEED_AGENT_ID,
      expectedArchiveDirAfterRollback: appliedTargetPaths.legacyArchiveDir,
    },
  };

  await writeReceipt(receiptPath, receipt);
  return {
    mode: "apply",
    ok: postApplyVerification?.ok === true,
    receiptPath,
    receipt,
  };
}

async function runRollback() {
  const receiptPath = text(readArgValue("--rollback-from"));
  const passphrase = text(readArgValue("--passphrase"));
  if (!receiptPath) {
    throw new Error("--rollback-from is required for rollback");
  }
  if (!passphrase) {
    throw new Error("--passphrase is required with --rollback-from");
  }

  const resolvedReceiptPath = path.resolve(receiptPath);
  const receipt = await readReceipt(resolvedReceiptPath);
  const validatedReceipt = await validateRollbackReceiptAgainstCurrentEnvironment(receipt);
  const bundlePath = validatedReceipt.bundlePath;

  const restored = await importStoreRecoveryBundle({
    bundlePath,
    passphrase,
    overwrite: true,
  });
  const archiveRestore = await restoreArchiveDirectoryFromReceipt(receipt, validatedReceipt.currentTargetPaths);
  const archiveJsonlRewrite =
    (text(receipt?.archiveContentRewriteMode) || ARCHIVE_CONTENT_REWRITE_MODE_RENAME_ONLY) ===
    ARCHIVE_CONTENT_REWRITE_MODE_STRUCTURED
      ? await rewriteMainAgentArchiveJsonlStructuredReferences({
          archiveDir: validatedReceipt.currentTargetPaths.legacyArchiveDir,
          fromAgentId: AGENT_PASSPORT_MAIN_AGENT_ID,
          toAgentId: LEGACY_OPENNEED_AGENT_ID,
        })
      : null;
  const preview = await previewMainAgentCanonicalPhysicalMigration();
  const verification = await buildPostRollbackVerification(
    receipt,
    archiveRestore,
    validatedReceipt.currentTargetPaths
  );
  return {
    mode: "rollback",
    ok: verification.ok === true,
    archiveContentRewriteMode: text(receipt?.archiveContentRewriteMode) || ARCHIVE_CONTENT_REWRITE_MODE_RENAME_ONLY,
    receiptPath: resolvedReceiptPath,
    restored,
    archiveRestore,
    archiveJsonlRewrite,
    verification,
    preview,
  };
}

async function main() {
  const wantsApply = hasFlag("--apply");
  const rollbackFrom = text(readArgValue("--rollback-from"));
  const wantsDryRun = hasFlag("--dry-run") || (!wantsApply && !rollbackFrom);

  if (wantsApply && rollbackFrom) {
    throw new Error("--apply and --rollback-from cannot be used together");
  }

  const result = rollbackFrom ? await runRollback() : wantsApply ? await runApply() : await runDryRun();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});

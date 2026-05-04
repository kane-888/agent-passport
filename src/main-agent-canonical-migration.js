import path from "node:path";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";

import {
  cloneJson,
  hashJson,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import {
  AGENT_PASSPORT_MAIN_AGENT_ID,
  LEGACY_OPENNEED_AGENT_ID,
} from "./main-agent-compat.js";

export const MAIN_AGENT_CANONICAL_MIGRATION_FORMAT = "agent-passport-main-agent-canonical-migration-v1";
export const MAIN_AGENT_CANONICAL_ARCHIVE_AUDIT_FORMAT = "agent-passport-main-agent-canonical-archive-audit-v1";

const AGENT_REFERENCE_KEYS = new Set([
  "acknowledgedByAgentId",
  "activatedByAgentId",
  "actorAgentId",
  "agentId",
  "byAgentId",
  "candidateAgentId",
  "canonicalAgentId",
  "comparisonLeftAgentId",
  "comparisonRightAgentId",
  "createdByAgentId",
  "currentResidentAgentId",
  "deletedByAgentId",
  "deliveredAgentId",
  "deliveryAgentId",
  "executedByAgentId",
  "executorAgentId",
  "fromAgentId",
  "groupAgentId",
  "issuedByAgentId",
  "issuerAgentId",
  "lastSignedByAgentId",
  "leftAgentId",
  "leftIssuerAgentId",
  "linkedAgentId",
  "migrationTargetAgentId",
  "newAgentId",
  "ownerAgentId",
  "parentAgentId",
  "policyAgentId",
  "primaryAgentId",
  "receiptAgentId",
  "recordedByAgentId",
  "referenceAgentId",
  "relatedAgentId",
  "requestedResidentAgentId",
  "residentAgentId",
  "residentAgentReference",
  "resolvedResidentAgentId",
  "restoredByAgentId",
  "revertedByAgentId",
  "revokedByAgentId",
  "rightAgentId",
  "rightIssuerAgentId",
  "rotatedByAgentId",
  "securityPostureUpdatedByAgentId",
  "selectedByAgentId",
  "signedByAgentId",
  "signerAgentId",
  "sourceAgentId",
  "successfulLedgerAgentId",
  "targetAgentId",
  "threadAgentId",
  "toAgentId",
  "updatedByAgentId",
  "windowAgentId",
]);

const AGENT_REFERENCE_ARRAY_KEYS = new Set([
  "agentIds",
  "agents",
  "participantAgentIds",
  "relatedAgentIds",
]);
const MAX_ARCHIVE_AUDIT_SAMPLES = 20;
const MAX_ARCHIVE_INVALID_LINE_SAMPLES = 10;

function createEmptyChangeSummary() {
  return {
    totalRewrites: 0,
    renamedAgentRecords: 0,
    byField: {},
    byCollection: {},
    pathSamples: [],
  };
}

function mergeChangeSummary(target, source) {
  if (!target || !source) {
    return target;
  }
  target.totalRewrites += Number(source.totalRewrites || 0);
  target.renamedAgentRecords += Number(source.renamedAgentRecords || 0);
  for (const [fieldName, count] of Object.entries(source.byField || {})) {
    target.byField[fieldName] = Number(target.byField[fieldName] || 0) + Number(count || 0);
  }
  for (const [collectionName, count] of Object.entries(source.byCollection || {})) {
    target.byCollection[collectionName] =
      Number(target.byCollection[collectionName] || 0) + Number(count || 0);
  }
  for (const sample of source.pathSamples || []) {
    if (target.pathSamples.length < 20) {
      target.pathSamples.push(sample);
    }
  }
  return target;
}

function resolveCollectionName(pathSegments = []) {
  return pathSegments.length > 0 ? String(pathSegments[0]) : "root";
}

function recordChange(summary, pathSegments, fieldName) {
  summary.totalRewrites += 1;
  summary.byField[fieldName] = (summary.byField[fieldName] || 0) + 1;
  const collectionName = resolveCollectionName(pathSegments);
  summary.byCollection[collectionName] = (summary.byCollection[collectionName] || 0) + 1;
  if (summary.pathSamples.length < 20) {
    summary.pathSamples.push([...pathSegments, fieldName].join("."));
  }
}

function rewriteDeviceRuntimeResidentBinding(store, canonicalAgentId, summary) {
  const deviceRuntime = store?.deviceRuntime;
  if (!deviceRuntime || typeof deviceRuntime !== "object") {
    return;
  }
  const residentAgentId = normalizeOptionalText(deviceRuntime.residentAgentId) ?? null;
  const residentAgentReference = normalizeOptionalText(deviceRuntime.residentAgentReference) ?? null;
  const resolvedResidentAgentId = normalizeOptionalText(deviceRuntime.resolvedResidentAgentId) ?? null;
  if (!residentAgentId && !residentAgentReference && !resolvedResidentAgentId) {
    return;
  }
  const nextResidentAgentReference = residentAgentId ? canonicalAgentId : residentAgentReference;
  const nextResolvedResidentAgentId = residentAgentId || resolvedResidentAgentId || null;
  if (residentAgentReference !== nextResidentAgentReference) {
    deviceRuntime.residentAgentReference = nextResidentAgentReference;
    recordChange(summary, ["deviceRuntime"], "residentAgentReference");
  }
  if (resolvedResidentAgentId !== nextResolvedResidentAgentId) {
    deviceRuntime.resolvedResidentAgentId = nextResolvedResidentAgentId;
    recordChange(summary, ["deviceRuntime"], "resolvedResidentAgentId");
  }
}

function rewriteAgentReferenceArray(values, legacyAgentId, canonicalAgentId, summary, pathSegments, fieldName) {
  let changed = false;
  const nextValues = values.map((value) => {
    if (normalizeOptionalText(value) === legacyAgentId) {
      changed = true;
      return canonicalAgentId;
    }
    return value;
  });
  if (changed) {
    recordChange(summary, pathSegments, fieldName);
  }
  return nextValues;
}

function rewriteStructuredAgentReferenceNode(node, pathSegments, fromAgentId, toAgentId, summary) {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const child = node[index];
      if (child && typeof child === "object") {
        rewriteStructuredAgentReferenceNode(child, [...pathSegments, index], fromAgentId, toAgentId, summary);
      }
    }
    return;
  }

  if (!node || typeof node !== "object") {
    return;
  }

  for (const [fieldName, currentValue] of Object.entries(node)) {
    if (typeof currentValue === "string") {
      const shouldRewriteSubjectId =
        fieldName === "subjectId" && normalizeOptionalText(node.subjectType)?.toLowerCase() === "agent";
      const shouldRewriteArchiveFilePath = fieldName === "filePath" && currentValue.includes(`/${fromAgentId}/`);
      if ((AGENT_REFERENCE_KEYS.has(fieldName) || shouldRewriteSubjectId) && normalizeOptionalText(currentValue) === fromAgentId) {
        node[fieldName] = toAgentId;
        recordChange(summary, pathSegments, fieldName);
      } else if (shouldRewriteArchiveFilePath) {
        node[fieldName] = currentValue.split(`/${fromAgentId}/`).join(`/${toAgentId}/`);
        recordChange(summary, pathSegments, fieldName);
      }
      continue;
    }

    if (Array.isArray(currentValue)) {
      if (AGENT_REFERENCE_ARRAY_KEYS.has(fieldName)) {
        node[fieldName] = rewriteAgentReferenceArray(
          currentValue,
          fromAgentId,
          toAgentId,
          summary,
          pathSegments,
          fieldName
        );
      }
      rewriteStructuredAgentReferenceNode(node[fieldName], [...pathSegments, fieldName], fromAgentId, toAgentId, summary);
      continue;
    }

    if (currentValue && typeof currentValue === "object") {
      rewriteStructuredAgentReferenceNode(currentValue, [...pathSegments, fieldName], fromAgentId, toAgentId, summary);
    }
  }
}

function createEmptyArchiveAuditCounts() {
  return {
    filesDiscoveredCount: 0,
    scannedFileCount: 0,
    skippedNonJsonlFileCount: 0,
    nonEmptyLineCount: 0,
    blankLineCount: 0,
    parsedRecordCount: 0,
    invalidLineCount: 0,
    filesWithLegacyRefs: 0,
    filesWithCanonicalRefs: 0,
    recordsWithLegacyRefs: 0,
    recordsWithCanonicalRefs: 0,
    legacyReferenceCount: 0,
    canonicalReferenceCount: 0,
  };
}

function createEmptyArchiveAuditByFieldEntry() {
  return {
    legacy: 0,
    canonical: 0,
    total: 0,
  };
}

function createEmptyArchiveAuditByKindEntry() {
  return {
    records: 0,
    legacyReferenceCount: 0,
    canonicalReferenceCount: 0,
  };
}

function createArchiveDirectoryAudit({ label, archiveAgentId, archiveDir, legacyAgentId, canonicalAgentId }) {
  return {
    archiveLabel: label,
    archiveAgentId,
    archiveDir,
    legacyAgentId,
    canonicalAgentId,
    exists: false,
    scanCompleted: false,
    status: "directory_missing",
    counts: createEmptyArchiveAuditCounts(),
    byField: {},
    byKind: {},
    samples: [],
    invalidLineSamples: [],
    legacyReferenceDetected: false,
    canonicalReferenceDetected: false,
  };
}

function ensureArchiveAuditByFieldEntry(summary, fieldName) {
  if (!summary[fieldName]) {
    summary[fieldName] = createEmptyArchiveAuditByFieldEntry();
  }
  return summary[fieldName];
}

function ensureArchiveAuditByKindEntry(summary, kind) {
  if (!summary[kind]) {
    summary[kind] = createEmptyArchiveAuditByKindEntry();
  }
  return summary[kind];
}

function pushLimited(list, value, limit) {
  if (list.length < limit) {
    list.push(value);
  }
}

function formatAuditPath(pathSegments = []) {
  return pathSegments.reduce((text, segment, index) => {
    if (typeof segment === "number") {
      return `${text}[${segment}]`;
    }
    if (index === 0) {
      return String(segment);
    }
    return `${text}.${segment}`;
  }, "");
}

function recordArchiveAuditMatch(directoryAudit, { matchedAgentId, fieldName, kind, relativePath, lineNumber, pathSegments }) {
  const normalizedMatch = normalizeOptionalText(matchedAgentId);
  const matchKey =
    normalizedMatch === directoryAudit.legacyAgentId
      ? "legacy"
      : normalizedMatch === directoryAudit.canonicalAgentId
        ? "canonical"
        : null;
  if (!matchKey) {
    return;
  }

  const countKey = matchKey === "legacy" ? "legacyReferenceCount" : "canonicalReferenceCount";
  directoryAudit.counts[countKey] += 1;
  const byFieldEntry = ensureArchiveAuditByFieldEntry(directoryAudit.byField, fieldName);
  byFieldEntry[matchKey] += 1;
  byFieldEntry.total += 1;
  const byKindEntry = ensureArchiveAuditByKindEntry(directoryAudit.byKind, kind);
  byKindEntry[countKey] += 1;
  pushLimited(
    directoryAudit.samples,
    {
      relativePath,
      lineNumber,
      kind,
      fieldName,
      scope: pathSegments[0] === "record" ? "record" : "top_level",
      path: formatAuditPath(pathSegments),
      matchedAgentId: normalizedMatch,
    },
    MAX_ARCHIVE_AUDIT_SAMPLES
  );
}

function auditStructuredAgentReferences(node, pathSegments, options) {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const value = node[index];
      if (value && typeof value === "object") {
        auditStructuredAgentReferences(value, [...pathSegments, index], options);
      }
    }
    return;
  }

  if (!node || typeof node !== "object") {
    return;
  }

  const { legacyAgentId, canonicalAgentId, onMatch } = options;
  for (const [fieldName, currentValue] of Object.entries(node)) {
    if (typeof currentValue === "string") {
      const shouldAuditSubjectId =
        fieldName === "subjectId" && normalizeOptionalText(node.subjectType)?.toLowerCase() === "agent";
      if (AGENT_REFERENCE_KEYS.has(fieldName) || shouldAuditSubjectId) {
        const normalizedValue = normalizeOptionalText(currentValue);
        if (normalizedValue === legacyAgentId || normalizedValue === canonicalAgentId) {
          onMatch({
            fieldName,
            matchedAgentId: normalizedValue,
            pathSegments: [...pathSegments, fieldName],
          });
        }
      }
      continue;
    }

    if (Array.isArray(currentValue)) {
      if (AGENT_REFERENCE_ARRAY_KEYS.has(fieldName)) {
        for (let index = 0; index < currentValue.length; index += 1) {
          const item = currentValue[index];
          if (typeof item === "string") {
            const normalizedValue = normalizeOptionalText(item);
            if (normalizedValue === legacyAgentId || normalizedValue === canonicalAgentId) {
              onMatch({
                fieldName,
                matchedAgentId: normalizedValue,
                pathSegments: [...pathSegments, fieldName, index],
              });
            }
            continue;
          }
          if (item && typeof item === "object") {
            auditStructuredAgentReferences(item, [...pathSegments, fieldName, index], options);
          }
        }
        continue;
      }
      auditStructuredAgentReferences(currentValue, [...pathSegments, fieldName], options);
      continue;
    }

    if (currentValue && typeof currentValue === "object") {
      auditStructuredAgentReferences(currentValue, [...pathSegments, fieldName], options);
    }
  }
}

function mergeArchiveAuditCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = Number(target[key] || 0) + (Number(value) || 0);
  }
}

function mergeArchiveAuditByField(target, source) {
  for (const [fieldName, entry] of Object.entries(source || {})) {
    const targetEntry = ensureArchiveAuditByFieldEntry(target, fieldName);
    targetEntry.legacy += Number(entry?.legacy) || 0;
    targetEntry.canonical += Number(entry?.canonical) || 0;
    targetEntry.total += Number(entry?.total) || 0;
  }
}

function mergeArchiveAuditByKind(target, source) {
  for (const [kind, entry] of Object.entries(source || {})) {
    const targetEntry = ensureArchiveAuditByKindEntry(target, kind);
    targetEntry.records += Number(entry?.records) || 0;
    targetEntry.legacyReferenceCount += Number(entry?.legacyReferenceCount) || 0;
    targetEntry.canonicalReferenceCount += Number(entry?.canonicalReferenceCount) || 0;
  }
}

function finalizeArchiveDirectoryAudit(directoryAudit) {
  const invalidLineCount = Number(directoryAudit?.counts?.invalidLineCount) || 0;
  const scannedFileCount = Number(directoryAudit?.counts?.scannedFileCount) || 0;
  directoryAudit.scanCompleted = invalidLineCount === 0;
  directoryAudit.status = !directoryAudit.exists
    ? "directory_missing"
    : invalidLineCount > 0
      ? "invalid_jsonl"
      : scannedFileCount === 0
        ? "no_jsonl_files"
        : "ok";
  directoryAudit.legacyReferenceDetected = Number(directoryAudit?.counts?.legacyReferenceCount) > 0;
  directoryAudit.canonicalReferenceDetected = Number(directoryAudit?.counts?.canonicalReferenceCount) > 0;
  return directoryAudit;
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
  if (!targetPath) {
    return false;
  }
  const info = await pathInfo(targetPath);
  return Boolean(info?.isDirectory?.());
}

async function listFilesRecursively(targetPath) {
  if (!(await directoryExists(targetPath))) {
    return [];
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function scanArchiveDirectory(directoryAudit) {
  const resolvedArchiveDir = normalizeOptionalText(directoryAudit.archiveDir) ?? null;
  directoryAudit.exists = await directoryExists(resolvedArchiveDir);
  if (!directoryAudit.exists) {
    return finalizeArchiveDirectoryAudit(directoryAudit);
  }

  const files = await listFilesRecursively(resolvedArchiveDir);
  directoryAudit.counts.filesDiscoveredCount = files.length;

  for (const filePath of files) {
    if (!filePath.toLowerCase().endsWith(".jsonl")) {
      directoryAudit.counts.skippedNonJsonlFileCount += 1;
      continue;
    }

    directoryAudit.counts.scannedFileCount += 1;
    const raw = await readFile(filePath, "utf8");
    const lines = raw.split("\n");
    let fileLegacyReferenceCount = 0;
    let fileCanonicalReferenceCount = 0;
    const relativePath = path.relative(resolvedArchiveDir, filePath) || path.basename(filePath);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex].trim();
      if (!line) {
        directoryAudit.counts.blankLineCount += 1;
        continue;
      }

      directoryAudit.counts.nonEmptyLineCount += 1;
      let parsedRecord = null;
      try {
        parsedRecord = JSON.parse(line);
      } catch {
        directoryAudit.counts.invalidLineCount += 1;
        pushLimited(
          directoryAudit.invalidLineSamples,
          {
            relativePath,
            lineNumber: lineIndex + 1,
          },
          MAX_ARCHIVE_INVALID_LINE_SAMPLES
        );
        continue;
      }

      directoryAudit.counts.parsedRecordCount += 1;
      const recordKind = normalizeOptionalText(parsedRecord?.kind) ?? "unknown";
      ensureArchiveAuditByKindEntry(directoryAudit.byKind, recordKind).records += 1;
      let recordLegacyReferenceCount = 0;
      let recordCanonicalReferenceCount = 0;
      auditStructuredAgentReferences(parsedRecord, [], {
        legacyAgentId: directoryAudit.legacyAgentId,
        canonicalAgentId: directoryAudit.canonicalAgentId,
        onMatch: ({ fieldName, matchedAgentId, pathSegments }) => {
          recordArchiveAuditMatch(directoryAudit, {
            matchedAgentId,
            fieldName,
            kind: recordKind,
            relativePath,
            lineNumber: lineIndex + 1,
            pathSegments,
          });
          if (matchedAgentId === directoryAudit.legacyAgentId) {
            recordLegacyReferenceCount += 1;
          } else if (matchedAgentId === directoryAudit.canonicalAgentId) {
            recordCanonicalReferenceCount += 1;
          }
        },
      });

      if (recordLegacyReferenceCount > 0) {
        directoryAudit.counts.recordsWithLegacyRefs += 1;
        fileLegacyReferenceCount += recordLegacyReferenceCount;
      }
      if (recordCanonicalReferenceCount > 0) {
        directoryAudit.counts.recordsWithCanonicalRefs += 1;
        fileCanonicalReferenceCount += recordCanonicalReferenceCount;
      }
    }

    if (fileLegacyReferenceCount > 0) {
      directoryAudit.counts.filesWithLegacyRefs += 1;
    }
    if (fileCanonicalReferenceCount > 0) {
      directoryAudit.counts.filesWithCanonicalRefs += 1;
    }
  }

  return finalizeArchiveDirectoryAudit(directoryAudit);
}

function resolveActiveArchiveDirKey(directories) {
  const legacyExists = directories?.legacy?.exists === true;
  const canonicalExists = directories?.canonical?.exists === true;
  if (legacyExists && !canonicalExists) {
    return "legacy";
  }
  if (canonicalExists && !legacyExists) {
    return "canonical";
  }
  if (canonicalExists) {
    return "canonical";
  }
  if (legacyExists) {
    return "legacy";
  }
  return null;
}

export async function auditMainAgentCanonicalArchiveDirectories(
  {
    archiveRoot = null,
    legacyAgentId = LEGACY_OPENNEED_AGENT_ID,
    canonicalAgentId = AGENT_PASSPORT_MAIN_AGENT_ID,
  } = {}
) {
  const resolvedArchiveRoot = normalizeOptionalText(archiveRoot) ? path.resolve(archiveRoot) : null;
  const legacyArchiveDir = resolvedArchiveRoot ? path.join(resolvedArchiveRoot, legacyAgentId) : null;
  const canonicalArchiveDir = resolvedArchiveRoot ? path.join(resolvedArchiveRoot, canonicalAgentId) : null;
  const directories = {
    legacy: await scanArchiveDirectory(
      createArchiveDirectoryAudit({
        label: "legacy",
        archiveAgentId: legacyAgentId,
        archiveDir: legacyArchiveDir,
        legacyAgentId,
        canonicalAgentId,
      })
    ),
    canonical: await scanArchiveDirectory(
      createArchiveDirectoryAudit({
        label: "canonical",
        archiveAgentId: canonicalAgentId,
        archiveDir: canonicalArchiveDir,
        legacyAgentId,
        canonicalAgentId,
      })
    ),
  };
  const aggregateCounts = createEmptyArchiveAuditCounts();
  const aggregateByField = {};
  const aggregateByKind = {};
  const aggregateSamples = [];
  const aggregateInvalidLineSamples = [];

  for (const directoryAudit of Object.values(directories)) {
    mergeArchiveAuditCounts(aggregateCounts, directoryAudit.counts);
    mergeArchiveAuditByField(aggregateByField, directoryAudit.byField);
    mergeArchiveAuditByKind(aggregateByKind, directoryAudit.byKind);
    for (const sample of directoryAudit.samples || []) {
      pushLimited(aggregateSamples, { archiveLabel: directoryAudit.archiveLabel, ...sample }, MAX_ARCHIVE_AUDIT_SAMPLES);
    }
    for (const invalidLineSample of directoryAudit.invalidLineSamples || []) {
      pushLimited(
        aggregateInvalidLineSamples,
        { archiveLabel: directoryAudit.archiveLabel, ...invalidLineSample },
        MAX_ARCHIVE_INVALID_LINE_SAMPLES
      );
    }
  }

  const directoriesPresent = Object.values(directories).filter((directoryAudit) => directoryAudit.exists).length;
  const activeArchiveDirKey = resolveActiveArchiveDirKey(directories);
  const activeArchiveDir = activeArchiveDirKey ? directories[activeArchiveDirKey]?.archiveDir ?? null : null;

  return {
    format: MAIN_AGENT_CANONICAL_ARCHIVE_AUDIT_FORMAT,
    auditedAt: now(),
    scanMode: "read_only_structured_agent_reference_audit",
    structuredReferenceOnly: true,
    legacyAgentId,
    canonicalAgentId,
    archiveRoot: resolvedArchiveRoot,
    physical: {
      legacyArchiveDir,
      canonicalArchiveDir,
      legacyExists: directories.legacy.exists === true,
      canonicalExists: directories.canonical.exists === true,
      activeArchiveDirKey,
      activeArchiveDir,
    },
    directories,
    directoriesPresent,
    directoriesScanned: Object.keys(directories).length,
    counts: aggregateCounts,
    byField: aggregateByField,
    byKind: aggregateByKind,
    samples: aggregateSamples,
    invalidLineSamples: aggregateInvalidLineSamples,
    scanCompleted: Number(aggregateCounts.invalidLineCount) === 0,
    status:
      Number(aggregateCounts.invalidLineCount) > 0
        ? "invalid_jsonl"
        : Number(aggregateCounts.scannedFileCount) === 0
          ? directoriesPresent > 0
            ? "no_jsonl_files"
            : "directory_missing"
          : "ok",
    legacyReferenceDetected: Number(aggregateCounts.legacyReferenceCount) > 0,
    canonicalReferenceDetected: Number(aggregateCounts.canonicalReferenceCount) > 0,
  };
}

function rewriteStoreNode(node, pathSegments, legacyAgentId, canonicalAgentId, summary) {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const child = node[index];
      if (child && typeof child === "object") {
        rewriteStoreNode(child, [...pathSegments, index], legacyAgentId, canonicalAgentId, summary);
      }
    }
    return;
  }

  if (!node || typeof node !== "object") {
    return;
  }

  if (pathSegments.length === 1 && pathSegments[0] === "agents") {
    const legacyAgent = node[legacyAgentId];
    const canonicalAgent = node[canonicalAgentId];
    if (legacyAgent && !canonicalAgent) {
      node[canonicalAgentId] = legacyAgent;
      delete node[legacyAgentId];
      summary.renamedAgentRecords += 1;
      recordChange(summary, pathSegments, "agents");
    }
  }

  if (
    pathSegments.length === 2 &&
    pathSegments[0] === "archives" &&
    ["transcript", "passportMemory"].includes(String(pathSegments[1]))
  ) {
    const legacyArchiveMeta = node[legacyAgentId];
    const canonicalArchiveMeta = node[canonicalAgentId];
    if (legacyArchiveMeta && !canonicalArchiveMeta) {
      node[canonicalAgentId] = legacyArchiveMeta;
      delete node[legacyAgentId];
      recordChange(summary, pathSegments, "archiveBucket");
    }
  }

  for (const [fieldName, currentValue] of Object.entries(node)) {
    if (typeof currentValue === "string") {
      const shouldRewriteSubjectId =
        fieldName === "subjectId" && normalizeOptionalText(node.subjectType)?.toLowerCase() === "agent";
      const shouldRewriteArchiveFilePath =
        fieldName === "filePath" && currentValue.includes(`/${legacyAgentId}/`);
      if ((AGENT_REFERENCE_KEYS.has(fieldName) || shouldRewriteSubjectId) && normalizeOptionalText(currentValue) === legacyAgentId) {
        node[fieldName] = canonicalAgentId;
        recordChange(summary, pathSegments, fieldName);
      } else if (shouldRewriteArchiveFilePath) {
        node[fieldName] = currentValue.replace(`/${legacyAgentId}/`, `/${canonicalAgentId}/`);
        recordChange(summary, pathSegments, fieldName);
      }
      continue;
    }

    if (Array.isArray(currentValue)) {
      if (AGENT_REFERENCE_ARRAY_KEYS.has(fieldName)) {
        node[fieldName] = rewriteAgentReferenceArray(
          currentValue,
          legacyAgentId,
          canonicalAgentId,
          summary,
          pathSegments,
          fieldName
        );
      }
      rewriteStoreNode(node[fieldName], [...pathSegments, fieldName], legacyAgentId, canonicalAgentId, summary);
      continue;
    }

    if (currentValue && typeof currentValue === "object") {
      rewriteStoreNode(currentValue, [...pathSegments, fieldName], legacyAgentId, canonicalAgentId, summary);
    }
  }
}

export function rewriteMainAgentReferencesInValue(
  value,
  {
    legacyAgentId = LEGACY_OPENNEED_AGENT_ID,
    canonicalAgentId = AGENT_PASSPORT_MAIN_AGENT_ID,
  } = {}
) {
  const clonedValue = cloneJson(value);
  const changeSummary = createEmptyChangeSummary();
  rewriteStoreNode(clonedValue, [], legacyAgentId, canonicalAgentId, changeSummary);
  return {
    value: clonedValue,
    changeSummary,
  };
}

export function rewriteStructuredAgentReferencesInValue(
  value,
  {
    fromAgentId = LEGACY_OPENNEED_AGENT_ID,
    toAgentId = AGENT_PASSPORT_MAIN_AGENT_ID,
  } = {}
) {
  const clonedValue = cloneJson(value);
  const changeSummary = createEmptyChangeSummary();
  rewriteStructuredAgentReferenceNode(clonedValue, [], fromAgentId, toAgentId, changeSummary);
  return {
    value: clonedValue,
    changeSummary,
  };
}

export async function rewriteMainAgentArchiveJsonlStructuredReferences({
  archiveDir = null,
  fromAgentId = LEGACY_OPENNEED_AGENT_ID,
  toAgentId = AGENT_PASSPORT_MAIN_AGENT_ID,
} = {}) {
  const resolvedArchiveDir = normalizeOptionalText(archiveDir) ? path.resolve(archiveDir) : null;
  const exists = await directoryExists(resolvedArchiveDir);
  const summary = {
    archiveDir: resolvedArchiveDir,
    fromAgentId,
    toAgentId,
    exists,
    scanCompleted: false,
    rewritten: false,
    counts: {
      filesDiscoveredCount: 0,
      scannedFileCount: 0,
      skippedNonJsonlFileCount: 0,
      rewrittenFileCount: 0,
      rewrittenRecordCount: 0,
    },
    changeSummary: createEmptyChangeSummary(),
    fileSamples: [],
    status: exists ? "pending" : "directory_missing",
  };

  if (!exists) {
    summary.scanCompleted = true;
    return summary;
  }

  const files = await listFilesRecursively(resolvedArchiveDir);
  summary.counts.filesDiscoveredCount = files.length;
  const rewrites = [];

  for (const filePath of files) {
    if (!filePath.toLowerCase().endsWith(".jsonl")) {
      summary.counts.skippedNonJsonlFileCount += 1;
      continue;
    }
    summary.counts.scannedFileCount += 1;
    const raw = await readFile(filePath, "utf8");
    const trailingNewline = raw.endsWith("\n");
    const lines = raw.split("\n");
    const nextLines = [...lines];
    let rewrittenRecordCount = 0;
    const fileChangeSummary = createEmptyChangeSummary();

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const originalLine = lines[lineIndex];
      const trimmedLine = originalLine.trim();
      if (!trimmedLine) {
        continue;
      }
      let parsedRecord = null;
      try {
        parsedRecord = JSON.parse(trimmedLine);
      } catch {
        throw new Error(
          `Archive JSONL rewrite failed closed: invalid JSON at ${path.relative(resolvedArchiveDir, filePath)}:${lineIndex + 1}`
        );
      }
      const rewritten = rewriteStructuredAgentReferencesInValue(parsedRecord, {
        fromAgentId,
        toAgentId,
      });
      if (rewritten.changeSummary.totalRewrites > 0) {
        rewrittenRecordCount += 1;
        nextLines[lineIndex] = JSON.stringify(rewritten.value);
        mergeChangeSummary(fileChangeSummary, rewritten.changeSummary);
      }
    }

    if (rewrittenRecordCount > 0) {
      summary.counts.rewrittenFileCount += 1;
      summary.counts.rewrittenRecordCount += rewrittenRecordCount;
      mergeChangeSummary(summary.changeSummary, fileChangeSummary);
      const nextContent = `${nextLines.join("\n")}${trailingNewline ? "\n" : ""}`;
      rewrites.push({
        filePath,
        content: nextContent,
      });
      if (summary.fileSamples.length < 20) {
        summary.fileSamples.push({
          relativePath: path.relative(resolvedArchiveDir, filePath) || path.basename(filePath),
          rewrittenRecordCount,
        });
      }
    }
  }

  for (const rewrite of rewrites) {
    await writeFile(rewrite.filePath, rewrite.content, "utf8");
  }

  summary.scanCompleted = true;
  summary.rewritten = rewrites.length > 0;
  summary.status = "ok";
  return summary;
}

export function previewMainAgentCanonicalPhysicalMigrationStore(
  store,
  {
    legacyAgentId = LEGACY_OPENNEED_AGENT_ID,
    canonicalAgentId = AGENT_PASSPORT_MAIN_AGENT_ID,
  } = {}
) {
  const sourceStore = cloneJson(store) ?? {};
  const hasLegacyMainAgent = Boolean(sourceStore?.agents?.[legacyAgentId]);
  const hasCanonicalMainAgent = Boolean(sourceStore?.agents?.[canonicalAgentId]);
  const currentPhysicalAgentId =
    hasLegacyMainAgent && !hasCanonicalMainAgent
      ? legacyAgentId
      : hasCanonicalMainAgent && !hasLegacyMainAgent
        ? canonicalAgentId
        : null;
  const basePreview = {
    format: MAIN_AGENT_CANONICAL_MIGRATION_FORMAT,
    previewedAt: now(),
    legacyAgentId,
    canonicalAgentId,
    currentPhysicalAgentId,
    nextPhysicalAgentId: canonicalAgentId,
    beforeHash: hashJson(sourceStore),
    afterHash: hashJson(sourceStore),
    changed: false,
    readyToApply: false,
    status: "blocked",
    warnings: [
      "identity.did is preserved for backward compatibility",
      "walletAddress is preserved for backward compatibility",
    ],
    changeSummary: createEmptyChangeSummary(),
    store: sourceStore,
  };

  if (hasLegacyMainAgent && hasCanonicalMainAgent) {
    return {
      ...basePreview,
      status: "split_main_agent_state",
      warnings: [...basePreview.warnings, "Both legacy and canonical physical main-agent records already exist"],
    };
  }

  if (!hasLegacyMainAgent && hasCanonicalMainAgent) {
    return {
      ...basePreview,
      status: "already_canonical",
      currentPhysicalAgentId: canonicalAgentId,
    };
  }

  if (!hasLegacyMainAgent) {
    return {
      ...basePreview,
      status: "legacy_main_agent_missing",
      warnings: [...basePreview.warnings, "Legacy physical main-agent record was not found"],
    };
  }

  const { value: migratedStore, changeSummary } = rewriteMainAgentReferencesInValue(sourceStore, {
    legacyAgentId,
    canonicalAgentId,
  });
  rewriteDeviceRuntimeResidentBinding(migratedStore, canonicalAgentId, changeSummary);
  const afterHash = hashJson(migratedStore);

  return {
    ...basePreview,
    afterHash,
    changed: afterHash !== basePreview.beforeHash,
    readyToApply: afterHash !== basePreview.beforeHash,
    status: "ready",
    changeSummary,
    store: migratedStore,
  };
}

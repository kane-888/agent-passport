import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  now,
} from "./ledger-core-utils.js";

export const DEFAULT_TRANSCRIPT_ARCHIVE_KEEP_COUNT = 240;
export const DEFAULT_PASSPORT_INACTIVE_ARCHIVE_KEEP_COUNT = 48;

export function ensureArchiveStoreState(store) {
  if (!store.archives || typeof store.archives !== "object") {
    store.archives = {
      transcript: {},
      passportMemory: {},
    };
  }
  if (!store.archives.transcript || typeof store.archives.transcript !== "object") {
    store.archives.transcript = {};
  }
  if (!store.archives.passportMemory || typeof store.archives.passportMemory !== "object") {
    store.archives.passportMemory = {};
  }
  return store.archives;
}

export function buildAgentArchiveFilePath(archiveRoot, agentId, kind) {
  return path.join(archiveRoot, agentId, `${kind}.jsonl`);
}

export async function appendArchiveJsonl(filePath, records = []) {
  if (!Array.isArray(records) || records.length === 0) {
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(filePath, `${lines}\n`, { encoding: "utf8", flag: "a" });
}

export function collectProtectedPassportMemoryIds(
  store,
  {
    isPassportMemoryActive = (entry) => Boolean(entry),
  } = {}
) {
  const protectedIds = new Set();
  for (const boundary of store.compactBoundaries || []) {
    for (const id of boundary?.archivedMemoryIds || []) {
      if (id) {
        protectedIds.add(id);
      }
    }
    if (boundary?.checkpointMemoryId) {
      protectedIds.add(boundary.checkpointMemoryId);
    }
  }
  for (const entry of store.passportMemories || []) {
    if (!isPassportMemoryActive(entry)) {
      continue;
    }
    for (const id of entry?.payload?.sourcePassportMemoryIds || []) {
      if (id) {
        protectedIds.add(id);
      }
    }
    if (entry?.payload?.sourcePassportMemoryId) {
      protectedIds.add(entry.payload.sourcePassportMemoryId);
    }
  }
  return protectedIds;
}

export async function archiveStoreColdDataIfNeeded(
  store,
  {
    archiveRoot,
    appendArchiveJsonlImpl = appendArchiveJsonl,
    isPassportMemoryActive = (entry) => Boolean(entry),
    nowImpl = now,
  } = {}
) {
  ensureArchiveStoreState(store);
  const nowIso = nowImpl();
  const agentIds = Object.keys(store.agents || {});

  for (const agentId of agentIds) {
    const transcriptEntries = (store.transcriptEntries || [])
      .filter((entry) => entry.agentId === agentId)
      .sort((a, b) => (a.recordedAt || "").localeCompare(b.recordedAt || ""));
    const transcriptOverflow = Math.max(0, transcriptEntries.length - DEFAULT_TRANSCRIPT_ARCHIVE_KEEP_COUNT);
    if (transcriptOverflow > 0) {
      const transcriptToArchive = transcriptEntries.slice(0, transcriptOverflow);
      const transcriptIds = new Set(transcriptToArchive.map((entry) => entry.transcriptEntryId).filter(Boolean));
      await appendArchiveJsonlImpl(
        buildAgentArchiveFilePath(archiveRoot, agentId, "transcript"),
        transcriptToArchive.map((entry) => ({
          archivedAt: nowIso,
          kind: "transcript",
          agentId,
          record: entry,
        }))
      );
      store.transcriptEntries = (store.transcriptEntries || []).filter(
        (entry) => !transcriptIds.has(entry.transcriptEntryId)
      );
      const transcriptMeta = store.archives.transcript[agentId] || {
        count: 0,
        latestArchivedAt: null,
        filePath: buildAgentArchiveFilePath(archiveRoot, agentId, "transcript"),
      };
      transcriptMeta.count = Number(transcriptMeta.count || 0) + transcriptToArchive.length;
      transcriptMeta.latestArchivedAt = nowIso;
      transcriptMeta.filePath = buildAgentArchiveFilePath(archiveRoot, agentId, "transcript");
      store.archives.transcript[agentId] = transcriptMeta;
    }

    const protectedMemoryIds = collectProtectedPassportMemoryIds(store, { isPassportMemoryActive });
    const inactiveMemories = (store.passportMemories || [])
      .filter((entry) => entry.agentId === agentId)
      .filter((entry) => !isPassportMemoryActive(entry))
      .filter((entry) => !protectedMemoryIds.has(entry.passportMemoryId))
      .sort((a, b) => (a.recordedAt || "").localeCompare(b.recordedAt || ""));
    const inactiveOverflow = Math.max(0, inactiveMemories.length - DEFAULT_PASSPORT_INACTIVE_ARCHIVE_KEEP_COUNT);
    if (inactiveOverflow > 0) {
      const memoriesToArchive = inactiveMemories.slice(0, inactiveOverflow);
      const memoryIds = new Set(memoriesToArchive.map((entry) => entry.passportMemoryId).filter(Boolean));
      await appendArchiveJsonlImpl(
        buildAgentArchiveFilePath(archiveRoot, agentId, "passport-memory"),
        memoriesToArchive.map((entry) => ({
          archivedAt: nowIso,
          kind: "passport_memory",
          agentId,
          record: entry,
        }))
      );
      store.passportMemories = (store.passportMemories || []).filter(
        (entry) => !memoryIds.has(entry.passportMemoryId)
      );
      const memoryMeta = store.archives.passportMemory[agentId] || {
        count: 0,
        latestArchivedAt: null,
        filePath: buildAgentArchiveFilePath(archiveRoot, agentId, "passport-memory"),
      };
      memoryMeta.count = Number(memoryMeta.count || 0) + memoriesToArchive.length;
      memoryMeta.latestArchivedAt = nowIso;
      memoryMeta.filePath = buildAgentArchiveFilePath(archiveRoot, agentId, "passport-memory");
      store.archives.passportMemory[agentId] = memoryMeta;
    }
  }
}

export async function rewriteArchiveJsonl(filePath, records = []) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const normalized = Array.isArray(records) ? records.filter(Boolean) : [];
  const payload = normalized.length
    ? `${normalized.map((record) => JSON.stringify(record)).join("\n")}\n`
    : "";
  await writeFile(filePath, payload, { encoding: "utf8" });
}

export async function readArchiveJsonl(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function archiveDirectoryExists(targetPath) {
  try {
    const info = await stat(targetPath);
    return info.isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function migrateMainAgentArchiveDirectory({ archiveRoot, legacyAgentId, canonicalAgentId }) {
  const legacyArchiveDir = path.join(archiveRoot, legacyAgentId);
  const canonicalArchiveDir = path.join(archiveRoot, canonicalAgentId);
  const legacyExists = await archiveDirectoryExists(legacyArchiveDir);
  if (!legacyExists) {
    return {
      migrated: false,
      legacyArchiveDir,
      canonicalArchiveDir,
      skipped: true,
      reason: "legacy_archive_directory_missing",
    };
  }

  if (await archiveDirectoryExists(canonicalArchiveDir)) {
    throw new Error(`Canonical archive directory already exists: ${canonicalArchiveDir}`);
  }

  await mkdir(archiveRoot, { recursive: true });
  await rename(legacyArchiveDir, canonicalArchiveDir);
  return {
    migrated: true,
    legacyArchiveDir,
    canonicalArchiveDir,
    skipped: false,
    reason: null,
  };
}

export async function rollbackMainAgentArchiveDirectory({ archiveRoot, legacyAgentId, canonicalAgentId }) {
  const legacyArchiveDir = path.join(archiveRoot, legacyAgentId);
  const canonicalArchiveDir = path.join(archiveRoot, canonicalAgentId);
  const canonicalExists = await archiveDirectoryExists(canonicalArchiveDir);
  if (!canonicalExists || await archiveDirectoryExists(legacyArchiveDir)) {
    return false;
  }
  await rename(canonicalArchiveDir, legacyArchiveDir);
  return true;
}

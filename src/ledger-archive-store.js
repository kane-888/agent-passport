import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

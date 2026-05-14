import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_PASSPORT_INACTIVE_ARCHIVE_KEEP_COUNT,
  DEFAULT_TRANSCRIPT_ARCHIVE_KEEP_COUNT,
  archiveStoreColdDataIfNeeded,
  collectProtectedPassportMemoryIds,
  readArchiveJsonl,
} from "../src/ledger-archive-store.js";

function isPassportMemoryActive(entry) {
  return entry?.status === "active";
}

test("archive store cold-data helper archives overflow while preserving protected memories", async () => {
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), "agent-passport-archive-store-"));
  const transcriptEntries = Array.from(
    { length: DEFAULT_TRANSCRIPT_ARCHIVE_KEEP_COUNT + 2 },
    (_, index) => ({
      transcriptEntryId: `transcript-${String(index).padStart(3, "0")}`,
      agentId: "agent-1",
      recordedAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
      content: `turn ${index}`,
    })
  );
  const inactiveMemories = Array.from(
    { length: DEFAULT_PASSPORT_INACTIVE_ARCHIVE_KEEP_COUNT + 3 },
    (_, index) => ({
      passportMemoryId: `memory-${String(index).padStart(3, "0")}`,
      agentId: "agent-1",
      status: "forgotten",
      recordedAt: `2026-01-02T00:${String(index).padStart(2, "0")}:00.000Z`,
      payload: {
        value: `memory ${index}`,
      },
    })
  );
  const store = {
    agents: {
      "agent-1": {
        agentId: "agent-1",
      },
    },
    transcriptEntries,
    compactBoundaries: [],
    passportMemories: [
      ...inactiveMemories,
      {
        passportMemoryId: "memory-active-source",
        agentId: "agent-1",
        status: "active",
        recordedAt: "2026-01-03T00:00:00.000Z",
        payload: {
          sourcePassportMemoryId: "memory-000",
        },
      },
    ],
  };

  await archiveStoreColdDataIfNeeded(store, {
    archiveRoot,
    isPassportMemoryActive,
    nowImpl: () => "2026-01-04T00:00:00.000Z",
  });

  assert.equal(store.transcriptEntries.length, DEFAULT_TRANSCRIPT_ARCHIVE_KEEP_COUNT);
  assert.deepEqual(
    store.transcriptEntries.slice(0, 2).map((entry) => entry.transcriptEntryId),
    ["transcript-002", "transcript-003"]
  );
  assert.equal(store.archives.transcript["agent-1"].count, 2);
  assert.equal(store.archives.transcript["agent-1"].latestArchivedAt, "2026-01-04T00:00:00.000Z");

  const transcriptArchive = await readArchiveJsonl(store.archives.transcript["agent-1"].filePath);
  assert.deepEqual(
    transcriptArchive.map((entry) => entry.record.transcriptEntryId),
    ["transcript-000", "transcript-001"]
  );
  assert.equal(transcriptArchive[0].kind, "transcript");
  assert.equal(transcriptArchive[0].archivedAt, "2026-01-04T00:00:00.000Z");

  assert.equal(store.passportMemories.some((entry) => entry.passportMemoryId === "memory-000"), true);
  assert.equal(store.passportMemories.some((entry) => entry.passportMemoryId === "memory-001"), false);
  assert.equal(store.passportMemories.some((entry) => entry.passportMemoryId === "memory-002"), false);
  assert.equal(store.archives.passportMemory["agent-1"].count, 2);
  assert.equal(store.archives.passportMemory["agent-1"].latestArchivedAt, "2026-01-04T00:00:00.000Z");

  const memoryArchive = await readArchiveJsonl(store.archives.passportMemory["agent-1"].filePath);
  assert.deepEqual(
    memoryArchive.map((entry) => entry.record.passportMemoryId),
    ["memory-001", "memory-002"]
  );
  assert.equal(memoryArchive[0].kind, "passport_memory");
});

test("archive store protected memory collection includes compact boundaries and active source links", () => {
  const protectedIds = collectProtectedPassportMemoryIds(
    {
      compactBoundaries: [
        {
          archivedMemoryIds: ["memory-1", "memory-2"],
          checkpointMemoryId: "memory-checkpoint",
        },
      ],
      passportMemories: [
        {
          passportMemoryId: "memory-active",
          status: "active",
          payload: {
            sourcePassportMemoryId: "memory-source",
            sourcePassportMemoryIds: ["memory-source-a", "memory-source-b"],
          },
        },
        {
          passportMemoryId: "memory-inactive",
          status: "forgotten",
          payload: {
            sourcePassportMemoryId: "memory-ignored",
          },
        },
      ],
    },
    { isPassportMemoryActive }
  );

  assert.deepEqual([...protectedIds].sort(), [
    "memory-1",
    "memory-2",
    "memory-checkpoint",
    "memory-source",
    "memory-source-a",
    "memory-source-b",
  ]);
});

import {
  createRecordId,
  hashJson,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import {
  matchesCompatibleAgentId,
} from "./ledger-identity-compat.js";
import {
  getCachedPassportMemoryList,
  setCachedPassportMemoryList,
} from "./ledger-runtime-caches.js";
import {
  extractPassportMemoryComparableValue,
  isPassportMemoryActive,
  normalizePassportMemoryLayer,
} from "./ledger-passport-memory-rules.js";
import {
  findDominantStatefulSemanticRecord,
  shouldSupersedePassportField,
} from "./ledger-passport-memory-supersession.js";

function requireDependency(deps = {}, name) {
  const dependency = deps?.[name];
  if (typeof dependency !== "function") {
    throw new TypeError(`${name} dependency is required`);
  }
  return dependency;
}

export function listAgentPassportMemories(store, agentId, { layer = null, kind = null } = {}) {
  const normalizedLayer = layer ? normalizePassportMemoryLayer(layer) : null;
  const normalizedKind = kind ? normalizeOptionalText(kind) : null;
  const cacheKey = hashJson({
    kind: "passport_memory_list",
    agentId,
    layer: normalizedLayer,
    memoryKind: normalizedKind,
    total: (store.passportMemories || []).length,
    lastPassportMemoryId: store.passportMemories?.at(-1)?.passportMemoryId ?? null,
    lastEventHash: store.lastEventHash ?? null,
  });
  const cached = getCachedPassportMemoryList(cacheKey);
  if (cached) {
    return cached;
  }
  const records = (store.passportMemories || [])
    .filter((entry) => matchesCompatibleAgentId(store, entry.agentId, agentId))
    .filter((entry) => (normalizedLayer ? entry.layer === normalizedLayer : true))
    .filter((entry) => (normalizedKind ? entry.kind === normalizedKind : true))
    .sort((a, b) => (a.recordedAt || "").localeCompare(b.recordedAt || ""));
  setCachedPassportMemoryList(cacheKey, records);
  return records;
}

export function buildPassportMemoryConflictKey(entry) {
  const field = normalizeOptionalText(entry?.payload?.field) ?? null;
  if (!field) {
    return null;
  }
  return `${normalizePassportMemoryLayer(entry?.layer)}:${field}`;
}

export function applyPassportMemoryConflictTracking(store, agentId, record) {
  const conflictKey = buildPassportMemoryConflictKey(record);
  if (!conflictKey) {
    return null;
  }

  const nextValue = extractPassportMemoryComparableValue(record);
  const conflictingEntries = (store.passportMemories || []).filter((entry) => {
    if (entry.agentId !== agentId || !isPassportMemoryActive(entry)) {
      return false;
    }
    if (buildPassportMemoryConflictKey(entry) !== conflictKey) {
      return false;
    }
    return extractPassportMemoryComparableValue(entry) !== nextValue;
  });

  if (!conflictingEntries.length) {
    return null;
  }

  if (!Array.isArray(store.memoryConflicts)) {
    store.memoryConflicts = [];
  }

  const conflict = {
    conflictId: createRecordId("mconf"),
    agentId,
    conflictKey,
    layer: record.layer,
    field: normalizeOptionalText(record.payload?.field) ?? null,
    incomingMemoryId: record.passportMemoryId,
    conflictingMemoryIds: conflictingEntries.map((entry) => entry.passportMemoryId),
    previousValues: conflictingEntries.map((entry) => ({
      passportMemoryId: entry.passportMemoryId,
      summary: entry.summary || null,
      value: entry.payload?.value ?? entry.content ?? entry.summary ?? null,
      recordedAt: entry.recordedAt || null,
    })),
    incomingValue: record.payload?.value ?? record.content ?? record.summary ?? null,
    resolution: "pending_supersession",
    createdAt: now(),
  };
  store.memoryConflicts.push(conflict);
  record.conflictKey = conflictKey;
  record.conflictState = {
    conflictId: conflict.conflictId,
    hasConflict: true,
    conflictingMemoryIds: conflict.conflictingMemoryIds,
    resolution: conflict.resolution,
  };
  return conflict;
}

export function appendPassportMemoryRecord(store, agentId, record, deps = {}) {
  const appendEvent = requireDependency(deps, "appendEvent");
  if (shouldSupersedePassportField(record)) {
    const activeSameFieldRecords = (store.passportMemories || []).filter(
      (entry) =>
        matchesCompatibleAgentId(store, entry.agentId, agentId) &&
        entry.layer === record.layer &&
        normalizeOptionalText(entry.payload?.field) === normalizeOptionalText(record.payload?.field) &&
        entry.status !== "superseded"
    );
    const dominantRecord = findDominantStatefulSemanticRecord(activeSameFieldRecords, record);

    if (dominantRecord) {
      record.status = "superseded";
      record.memoryDynamics = {
        ...(record.memoryDynamics && typeof record.memoryDynamics === "object" ? record.memoryDynamics : {}),
        supersededAt: record.recordedAt || now(),
        supersededBy: dominantRecord.passportMemoryId,
        supersedeReason: "lower_state_priority",
      };
    } else {
      for (const entry of activeSameFieldRecords) {
        entry.status = "superseded";
      }
    }
  }

  const conflict = applyPassportMemoryConflictTracking(store, agentId, record);
  store.passportMemories.push(record);
  appendEvent(store, "passport_memory_recorded", {
    passportMemoryId: record.passportMemoryId,
    agentId,
    layer: record.layer,
    kind: record.kind,
    conflictId: conflict?.conflictId ?? null,
    sourceWindowId: record.sourceWindowId,
  });
  return record;
}

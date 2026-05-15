import {
  normalizeOptionalText,
} from "./ledger-core-utils.js";
import {
  isPassportMemoryActive,
} from "./ledger-passport-memory-rules.js";

const DEFAULT_HOT_PROFILE_MEMORY_LIMIT = 12;

export function buildProfileMemorySnapshot(store, agent, { listAgentPassportMemories } = {}) {
  if (typeof listAgentPassportMemories !== "function") {
    throw new TypeError("listAgentPassportMemories dependency is required");
  }
  const entries = listAgentPassportMemories(store, agent.agentId, { layer: "profile" });
  const activeEntries = entries.filter((entry) => isPassportMemoryActive(entry));
  const hotEntries = activeEntries.slice(-DEFAULT_HOT_PROFILE_MEMORY_LIMIT);
  const coldEntries = activeEntries.slice(0, Math.max(0, activeEntries.length - hotEntries.length));
  const byField = new Map();
  for (const entry of hotEntries) {
    const field = normalizeOptionalText(entry.payload?.field || entry.kind || entry.summary) ?? entry.passportMemoryId;
    byField.set(field, entry);
  }

  const fieldValues = Object.fromEntries(
    [...byField.entries()].map(([field, entry]) => [field, entry.payload?.value ?? entry.content ?? entry.summary ?? null])
  );

  return {
    entries: hotEntries,
    hotEntries,
    coldSummary: {
      coldCount: coldEntries.length,
      archivedCount: Math.max(0, entries.length - activeEntries.length),
      latestColdAt: coldEntries.at(-1)?.recordedAt ?? null,
    },
    fieldValues,
  };
}

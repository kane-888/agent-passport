import {
  isPassportMemoryActive,
} from "./ledger-passport-memory-rules.js";

export function buildAgentMemoryCountSummary(store, agentId) {
  const counts = {
    profile: 0,
    episodic: 0,
    working: 0,
    ledgerCommitments: 0,
  };
  for (const entry of store.passportMemories || []) {
    if (entry?.agentId !== agentId) {
      continue;
    }
    if (entry.layer === "ledger") {
      counts.ledgerCommitments += 1;
      continue;
    }
    if (!isPassportMemoryActive(entry)) {
      continue;
    }
    if (entry.layer === "profile") {
      counts.profile += 1;
    } else if (entry.layer === "episodic") {
      counts.episodic += 1;
    } else if (entry.layer === "working") {
      counts.working += 1;
    }
  }
  return counts;
}

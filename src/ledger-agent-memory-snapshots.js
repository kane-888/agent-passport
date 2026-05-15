import {
  cloneJson,
  normalizeOptionalText,
} from "./ledger-core-utils.js";
import {
  isPassportMemoryActive,
} from "./ledger-passport-memory-rules.js";

const DEFAULT_HOT_WORKING_MEMORY_LIMIT = 16;
const DEFAULT_HOT_EPISODIC_MEMORY_LIMIT = 14;
const DEFAULT_HOT_SEMANTIC_MEMORY_LIMIT = 14;
const DEFAULT_HOT_LEDGER_MEMORY_LIMIT = 10;

function requireDependency(deps = {}, name) {
  const dependency = deps?.[name];
  if (typeof dependency !== "function") {
    throw new TypeError(`${name} dependency is required`);
  }
  return dependency;
}

export function buildLedgerMemorySnapshot(store, agent, deps = {}) {
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const inferDidAliases = requireDependency(deps, "inferDidAliases");
  const listAgentWindows = requireDependency(deps, "listAgentWindows");
  const listAuthorizationProposalViews = requireDependency(deps, "listAuthorizationProposalViews");
  const allEntries = listAgentPassportMemories(store, agent.agentId, { layer: "ledger" });
  const ledgerEntries = allEntries.slice(-DEFAULT_HOT_LEDGER_MEMORY_LIMIT);
  return {
    facts: {
      agentId: agent.agentId,
      did: agent.identity?.did ?? null,
      didAliases: inferDidAliases(agent.identity?.did ?? null, agent.agentId),
      walletAddress: agent.identity?.walletAddress ?? null,
      parentAgentId: agent.parentAgentId ?? null,
      controller: agent.controller ?? null,
      authorizationPolicy: cloneJson(agent.identity?.authorizationPolicy || null),
      balances: cloneJson(agent.balances || {}),
      windows: listAgentWindows(store, agent.agentId).map((item) => item.windowId),
      latestAuthorizations: listAuthorizationProposalViews(store, { agentId: agent.agentId, limit: 5 }).map((item) => ({
        proposalId: item.proposalId,
        actionType: item.actionType,
        status: item.status,
      })),
    },
    commitments: ledgerEntries,
    coldSummary: {
      coldCount: Math.max(0, allEntries.length - ledgerEntries.length),
      archivedCount: 0,
      latestColdAt: allEntries.at(Math.max(0, allEntries.length - ledgerEntries.length) - 1)?.recordedAt ?? null,
    },
  };
}

export function buildWorkingMemorySnapshot(store, agent, deps = {}) {
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const latestAgentTaskSnapshot = requireDependency(deps, "latestAgentTaskSnapshot");
  const workingEntries = listAgentPassportMemories(store, agent.agentId, { layer: "working" });
  const activeEntries = workingEntries.filter((entry) => isPassportMemoryActive(entry));
  const hotEntries = activeEntries.slice(-DEFAULT_HOT_WORKING_MEMORY_LIMIT);
  const coldEntries = activeEntries.slice(0, Math.max(0, activeEntries.length - hotEntries.length));
  return {
    taskSnapshot: latestAgentTaskSnapshot(store, agent.agentId),
    entries: hotEntries,
    hotEntries,
    recentConversationTurns: hotEntries.filter((entry) => entry.kind === "conversation_turn").slice(-6),
    toolResults: hotEntries.filter((entry) => entry.kind === "tool_result").slice(-6),
    checkpoints: hotEntries.filter((entry) => entry.kind === "checkpoint_summary").slice(-3),
    coldSummary: {
      coldCount: coldEntries.length,
      archivedCount: Math.max(0, workingEntries.length - activeEntries.length),
      latestColdAt: coldEntries.at(-1)?.recordedAt ?? null,
    },
  };
}

export function buildEpisodicMemorySnapshot(store, agent, deps = {}) {
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const entries = listAgentPassportMemories(store, agent.agentId, { layer: "episodic" });
  const activeEntries = entries.filter((entry) => isPassportMemoryActive(entry));
  const hotEntries = activeEntries.slice(-DEFAULT_HOT_EPISODIC_MEMORY_LIMIT);
  const coldEntries = activeEntries.slice(0, Math.max(0, activeEntries.length - hotEntries.length));
  return {
    entries: hotEntries,
    hotEntries,
    coldSummary: {
      coldCount: coldEntries.length,
      archivedCount: Math.max(0, entries.length - activeEntries.length),
      latestColdAt: coldEntries.at(-1)?.recordedAt ?? null,
    },
  };
}

export function buildSemanticMemorySnapshot(store, agent, deps = {}) {
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const entries = listAgentPassportMemories(store, agent.agentId, { layer: "semantic" });
  const activeEntries = entries.filter((entry) => isPassportMemoryActive(entry));
  const hotEntries = activeEntries.slice(-DEFAULT_HOT_SEMANTIC_MEMORY_LIMIT);
  const coldEntries = activeEntries.slice(0, Math.max(0, activeEntries.length - hotEntries.length));
  const byField = new Map();
  for (const entry of hotEntries) {
    const field =
      normalizeOptionalText(entry.payload?.field || entry.kind || entry.summary) ?? entry.passportMemoryId;
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

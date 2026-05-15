import { randomUUID } from "node:crypto";

import {
  normalizeOptionalText,
} from "./ledger-core-utils.js";
import {
  findAgentByDid,
  findAgentByWalletAddress,
  resolveStoredAgent,
} from "./ledger-identity-compat.js";

export function normalizeWindowId(value) {
  return normalizeOptionalText(value) ?? `window_${randomUUID().slice(0, 8)}`;
}

export function resolveAgentReferenceFromStore(
  store,
  { agentId = null, did = null, walletAddress = null, windowId = null } = {}
) {
  const normalizedAgentId = normalizeOptionalText(agentId) ?? null;
  const normalizedDid = normalizeOptionalText(did) ?? null;
  const normalizedWalletAddress = normalizeOptionalText(walletAddress)?.toLowerCase() ?? null;
  const normalizedWindowId = normalizeOptionalText(windowId) ?? null;
  const windowAgentId = normalizedWindowId ? store.windows?.[normalizedWindowId]?.agentId ?? null : null;
  const candidate =
    (normalizedAgentId && resolveStoredAgent(store, normalizedAgentId)) ||
    findAgentByDid(store, normalizedDid) ||
    findAgentByWalletAddress(store, normalizedWalletAddress) ||
    (windowAgentId ? resolveStoredAgent(store, windowAgentId) ?? null : null);

  if (!candidate) {
    throw new Error("Agent not found");
  }

  return {
    agent: candidate,
    reference: {
      agentId: candidate.agentId,
      did: candidate.identity?.did ?? normalizedDid ?? null,
      walletAddress: candidate.identity?.walletAddress ?? normalizedWalletAddress ?? null,
      windowId: normalizedWindowId,
      resolvedBy: normalizedAgentId
        ? "agentId"
        : normalizedDid
          ? "did"
          : normalizedWalletAddress
            ? "walletAddress"
            : normalizedWindowId
              ? "windowId"
              : "unknown",
    },
  };
}

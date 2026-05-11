import { normalizeOptionalText } from "./ledger-core-utils.js";
import {
  buildAgentScopedDerivedCacheKey,
  buildCollectionTailToken,
  cacheStoreDerivedView,
} from "./ledger-derived-cache.js";

function requireAuthorizationProposalViewDep(deps, name) {
  const value = deps?.[name];
  if (typeof value !== "function") {
    throw new Error(`Missing authorization proposal view dependency: ${name}`);
  }
  return value;
}

export function listAuthorizationProposalViews(
  store,
  { agentId = null, limit = null } = {},
  deps = {}
) {
  const buildAuthorizationProposalView = requireAuthorizationProposalViewDep(deps, "buildAuthorizationProposalView");
  const isProposalRelatedToAgent = requireAuthorizationProposalViewDep(deps, "isProposalRelatedToAgent");
  const defaultAuthorizationLimit =
    Number.isFinite(Number(deps.defaultAuthorizationLimit)) && Number(deps.defaultAuthorizationLimit) > 0
      ? Math.floor(Number(deps.defaultAuthorizationLimit))
      : 50;
  const cappedLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : defaultAuthorizationLimit;
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "authorization_proposal_views",
    store,
    normalizeOptionalText(agentId) ?? "all_agents",
    [
      buildCollectionTailToken(store?.proposals || [], {
        idFields: ["proposalId"],
        timeFields: ["updatedAt", "createdAt"],
      }),
      `${cappedLimit}`,
      `${Object.keys(store?.agents || {}).length}`,
    ].join(":")
  );
  return cacheStoreDerivedView(store, cacheKey, () => {
    const proposals = store.proposals
      .filter((proposal) => (agentId ? isProposalRelatedToAgent(proposal, agentId, store) : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((proposal) => buildAuthorizationProposalView(store, proposal));

    return proposals.slice(-cappedLimit);
  });
}

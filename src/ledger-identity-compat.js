import {
  AGENT_PASSPORT_MAIN_AGENT_ID,
  LEGACY_OPENNEED_AGENT_ID,
  canonicalizeMainAgentReference,
  isMainAgentCompatibleId,
  listMainAgentCompatibleIds,
} from "./main-agent-compat.js";
import { inferDidAliases } from "./identity.js";
import {
  cloneJson,
  normalizeOptionalText,
} from "./ledger-core-utils.js";

export function listCompatibleAgentIds(agentId) {
  const normalizedAgentId = normalizeOptionalText(agentId) ?? null;
  if (!normalizedAgentId) {
    return [];
  }
  return listMainAgentCompatibleIds(normalizedAgentId);
}

export function resolveStoredAgent(store, agentId) {
  for (const candidateAgentId of listCompatibleAgentIds(agentId)) {
    const candidate = store?.agents?.[candidateAgentId];
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

export function resolveStoredAgentId(store, agentId) {
  return resolveStoredAgent(store, agentId)?.agentId ?? (normalizeOptionalText(agentId) ?? null);
}

export function canonicalizeResidentAgentReference(agentId) {
  return canonicalizeMainAgentReference(agentId);
}

export function resolveDefaultResidentAgent(store) {
  return resolveStoredAgent(store, AGENT_PASSPORT_MAIN_AGENT_ID) ?? Object.values(store?.agents || {})[0] ?? null;
}

export function resolveDefaultResidentAgentId(store) {
  return resolveDefaultResidentAgent(store)?.agentId ?? AGENT_PASSPORT_MAIN_AGENT_ID;
}

export function buildMainAgentIdentityOwnerBinding(store) {
  const requestedAgentIds = [AGENT_PASSPORT_MAIN_AGENT_ID, LEGACY_OPENNEED_AGENT_ID];
  const resolutionByRequestedAgentId = Object.fromEntries(
    requestedAgentIds.map((agentId) => {
      const resolvedAgentId = resolveStoredAgentId(store, agentId);
      return [
        agentId,
        {
          requestedAgentId: agentId,
          resolvedAgentId,
          matchesRequested: resolvedAgentId === agentId,
          usesCompatibilityAlias: resolvedAgentId != null && resolvedAgentId !== agentId,
        },
      ];
    })
  );
  const resolvedAgentIds = requestedAgentIds
    .map((agentId) => resolutionByRequestedAgentId[agentId]?.resolvedAgentId ?? null)
    .filter(Boolean);
  const currentPhysicalAgentId = resolvedAgentIds[0] ?? null;
  return {
    requestedAgentIds,
    currentPhysicalAgentId,
    canonicalAgentId: AGENT_PASSPORT_MAIN_AGENT_ID,
    legacyCompatibleAgentId: LEGACY_OPENNEED_AGENT_ID,
    allResolvedToCurrentPhysicalOwner:
      Boolean(currentPhysicalAgentId) && resolvedAgentIds.every((agentId) => agentId === currentPhysicalAgentId),
    resolutionByRequestedAgentId,
  };
}

export function buildCompatibleAgentIdSet(store, agentId) {
  const compatibleIds = new Set(listCompatibleAgentIds(agentId));
  const resolvedAgentId = resolveStoredAgentId(store, agentId);
  if (resolvedAgentId) {
    compatibleIds.add(resolvedAgentId);
    if (isMainAgentCompatibleId(resolvedAgentId)) {
      compatibleIds.add(AGENT_PASSPORT_MAIN_AGENT_ID);
      compatibleIds.add(LEGACY_OPENNEED_AGENT_ID);
    }
  }
  return compatibleIds;
}

export function matchesCompatibleAgentId(store, candidateAgentId, agentId) {
  const normalizedCandidateAgentId = normalizeOptionalText(candidateAgentId) ?? null;
  const normalizedAgentId = normalizeOptionalText(agentId) ?? null;
  if (!normalizedAgentId) {
    return true;
  }
  if (!normalizedCandidateAgentId) {
    return false;
  }
  return buildCompatibleAgentIdSet(store, normalizedAgentId).has(normalizedCandidateAgentId);
}

export function findAgentByDid(store, did) {
  if (!did) {
    return null;
  }

  const normalizedDid = normalizeOptionalText(did) ?? null;
  if (!normalizedDid) {
    return null;
  }

  return (
    Object.values(store?.agents || {}).find((agent) => {
      const aliases = new Set([
        normalizeOptionalText(agent.identity?.did) ?? null,
        ...inferDidAliases(agent.identity?.did, agent.agentId),
      ]);
      return aliases.has(normalizedDid);
    }) ?? null
  );
}

export function findAgentByWalletAddress(store, walletAddress) {
  const normalizedWalletAddress = normalizeOptionalText(walletAddress)?.toLowerCase();
  if (!normalizedWalletAddress) {
    return null;
  }

  return (
    Object.values(store?.agents || {}).find((agent) => {
      const identityWallet = agent.identity?.walletAddress?.toLowerCase();
      if (identityWallet === normalizedWalletAddress) {
        return true;
      }

      return (agent.identity?.authorizationPolicy?.signers || []).some(
        (signer) => signer.walletAddress?.toLowerCase() === normalizedWalletAddress
      );
    }) ?? null
  );
}

export function normalizeSignerFingerprint(signer) {
  if (!signer) {
    return null;
  }

  const label = normalizeOptionalText(signer.label || signer.name || signer.controller || signer.agentId || signer.walletAddress) ?? null;
  const walletAddress = normalizeOptionalText(signer.walletAddress || signer.address)?.toLowerCase() ?? null;

  if (!label && !walletAddress) {
    return null;
  }

  return walletAddress || `label:${label || "unknown"}`;
}

export function compareSignedSet(leftItems = [], rightItems = []) {
  const leftNormalized = leftItems.map((item) => normalizeSignerFingerprint(item)).filter(Boolean);
  const rightNormalized = rightItems.map((item) => normalizeSignerFingerprint(item)).filter(Boolean);
  const leftSet = new Set(leftNormalized);
  const rightSet = new Set(rightNormalized);
  const shared = leftNormalized.filter((item) => rightSet.has(item));
  const leftOnly = leftNormalized.filter((item) => !rightSet.has(item));
  const rightOnly = rightNormalized.filter((item) => !leftSet.has(item));

  return {
    same: leftNormalized.length === rightNormalized.length && shared.length === leftNormalized.length && shared.length === rightNormalized.length,
    left: leftNormalized,
    right: rightNormalized,
    shared,
    leftOnly,
    rightOnly,
  };
}

const ARCHIVE_CANONICAL_AGENT_REFERENCE_KEYS = new Set([
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

const ARCHIVE_CANONICAL_AGENT_REFERENCE_ARRAY_KEYS = new Set([
  "agentIds",
  "agents",
  "participantAgentIds",
  "relatedAgentIds",
]);

const ARCHIVE_CANONICAL_VIEW_REWRITE_SAMPLE_LIMIT = 12;

function createArchiveCanonicalViewSummary() {
  return {
    rewrittenFieldCount: 0,
    rewrittenPaths: [],
    rawCompatibleAgentIds: new Set(),
  };
}

function recordArchiveCanonicalViewRewrite(summary, pathSegments, rawAgentId) {
  summary.rewrittenFieldCount += 1;
  if (summary.rewrittenPaths.length < ARCHIVE_CANONICAL_VIEW_REWRITE_SAMPLE_LIMIT) {
    summary.rewrittenPaths.push(pathSegments.join("."));
  }
  const normalizedRawAgentId = normalizeOptionalText(rawAgentId) ?? null;
  if (normalizedRawAgentId) {
    summary.rawCompatibleAgentIds.add(normalizedRawAgentId);
  }
}

function rewriteArchiveCanonicalAgentReferenceValue(store, agentId, value, summary, pathSegments) {
  const normalizedValue = normalizeOptionalText(value) ?? null;
  const normalizedAgentId = normalizeOptionalText(agentId) ?? null;
  if (!normalizedValue || !normalizedAgentId) {
    return value;
  }
  if (!matchesCompatibleAgentId(store, normalizedValue, normalizedAgentId) || normalizedValue === normalizedAgentId) {
    return value;
  }
  recordArchiveCanonicalViewRewrite(summary, pathSegments, normalizedValue);
  return normalizedAgentId;
}

function rewriteArchiveCanonicalAgentReferenceArray(store, agentId, values, summary, pathSegments) {
  let changed = false;
  const nextValues = values.map((value, index) => {
    const nextValue = rewriteArchiveCanonicalAgentReferenceValue(
      store,
      agentId,
      value,
      summary,
      [...pathSegments, index]
    );
    if (nextValue !== value) {
      changed = true;
    }
    return nextValue;
  });
  return changed ? nextValues : values;
}

function canonicalizeArchiveIdentityViewNode(store, agentId, node, pathSegments, summary) {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const currentValue = node[index];
      if (currentValue && typeof currentValue === "object") {
        canonicalizeArchiveIdentityViewNode(store, agentId, currentValue, [...pathSegments, index], summary);
      }
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }

  for (const [fieldName, currentValue] of Object.entries(node)) {
    const nextPathSegments = [...pathSegments, fieldName];
    if (ARCHIVE_CANONICAL_AGENT_REFERENCE_KEYS.has(fieldName)) {
      const nextValue = rewriteArchiveCanonicalAgentReferenceValue(
        store,
        agentId,
        currentValue,
        summary,
        nextPathSegments
      );
      if (nextValue !== currentValue) {
        node[fieldName] = nextValue;
      }
      continue;
    }
    if (ARCHIVE_CANONICAL_AGENT_REFERENCE_ARRAY_KEYS.has(fieldName) && Array.isArray(currentValue)) {
      const nextValue = rewriteArchiveCanonicalAgentReferenceArray(
        store,
        agentId,
        currentValue,
        summary,
        nextPathSegments
      );
      if (nextValue !== currentValue) {
        node[fieldName] = nextValue;
      }
      continue;
    }
    if (currentValue && typeof currentValue === "object") {
      canonicalizeArchiveIdentityViewNode(store, agentId, currentValue, nextPathSegments, summary);
    }
  }
}

function buildArchiveCanonicalIdentityCompatibility(summary) {
  const rewrittenFieldCount = Number(summary?.rewrittenFieldCount || 0);
  return {
    viewMode:
      rewrittenFieldCount > 0
        ? "canonical_read_view_raw_archive_preserved_on_disk"
        : "canonical_read_view_no_compat_rewrite_needed",
    rawCompatibilityResidueDetected: rewrittenFieldCount > 0,
    rewrittenFieldCount,
    rewrittenPaths: Array.isArray(summary?.rewrittenPaths) ? summary.rewrittenPaths.slice() : [],
    rawCompatibleAgentIds: summary?.rawCompatibleAgentIds instanceof Set
      ? [...summary.rawCompatibleAgentIds]
      : Array.isArray(summary?.rawCompatibleAgentIds)
        ? summary.rawCompatibleAgentIds.slice()
        : [],
  };
}

export function canonicalizeArchiveIdentityView(store, agentId, value) {
  const summary = createArchiveCanonicalViewSummary();
  const clonedValue = cloneJson(value);
  canonicalizeArchiveIdentityViewNode(store, agentId, clonedValue, [], summary);
  return {
    value: clonedValue,
    compatibility: buildArchiveCanonicalIdentityCompatibility(summary),
  };
}

import {
  cloneJson,
  normalizeOptionalText,
  normalizeTextList,
} from "./ledger-core-utils.js";
import {
  buildAgentComparisonSubjectId,
  buildAgentComparisonSubjectLabel,
} from "./ledger-agent-comparison.js";
import {
  CREDENTIAL_KINDS,
  buildCredentialDidMethodAvailability,
  buildCredentialDidMethodScopeDescriptor,
  compareCredentialIds,
  didMethodFromReference,
  normalizeCredentialKind,
  normalizeCredentialRecord,
  normalizeCredentialStatus,
  resolveAgentDidForMethod,
} from "./ledger-credential-core.js";
import { credentialSubjectLabel } from "./ledger-credential-labels.js";
import {
  buildCredentialSiblingSummary,
  buildCredentialSiblingSummaryFromRecords,
  credentialSiblingGroupKey,
  findLatestCredentialRecordForSubject,
  isCredentialRelatedToAgent as isCredentialRelatedToAgentImpl,
} from "./ledger-credential-record-view.js";
import {
  credentialRecordHasValidProof,
  credentialRecordUsesIssuerDid,
  credentialUsesAgentPassportSignature,
  credentialUsesCanonicalAgentPassportTypes,
} from "./ledger-credential-validation.js";
import {
  buildAgentScopedDerivedCacheKey,
  buildCollectionTailToken,
  cacheStoreDerivedView,
} from "./ledger-derived-cache.js";
import { PUBLIC_SIGNABLE_DID_METHODS } from "./protocol.js";

function normalizeCredentialRepairCoverageDeps(deps = {}) {
  return {
    isCredentialRelatedToAgent:
      typeof deps.isCredentialRelatedToAgent === "function"
        ? deps.isCredentialRelatedToAgent
        : isCredentialRelatedToAgentImpl,
    resolveAgentComparisonAuditPair:
      typeof deps.resolveAgentComparisonAuditPair === "function"
        ? deps.resolveAgentComparisonAuditPair
        : null,
  };
}

export function buildComparisonRepairReferences(record) {
  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord || normalizeCredentialKind(normalizedRecord.kind) !== "agent_comparison") {
    return null;
  }

  const leftReference = {
    agentId: normalizeOptionalText(normalizedRecord.comparisonLeftAgentId) ?? null,
    did: normalizeOptionalText(normalizedRecord.comparisonLeftDid) ?? null,
  };
  const rightReference = {
    agentId: normalizeOptionalText(normalizedRecord.comparisonRightAgentId) ?? null,
    did: normalizeOptionalText(normalizedRecord.comparisonRightDid) ?? null,
  };
  const hasLeft = Boolean(leftReference.agentId || leftReference.did);
  const hasRight = Boolean(rightReference.agentId || rightReference.did);

  return hasLeft && hasRight ? { leftReference, rightReference } : null;
}

export function normalizeComparisonRepairPairInput(value = null) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const leftSource = value.left && typeof value.left === "object" ? value.left : value;
  const rightSource = value.right && typeof value.right === "object" ? value.right : value;
  const left = {
    agentId: normalizeOptionalText(leftSource.agentId || value.leftAgentId) ?? null,
    did: normalizeOptionalText(leftSource.did || value.leftDid) ?? null,
    walletAddress: normalizeOptionalText(leftSource.walletAddress || value.leftWalletAddress)?.toLowerCase() ?? null,
    windowId: normalizeOptionalText(leftSource.windowId || value.leftWindowId) ?? null,
  };
  const right = {
    agentId: normalizeOptionalText(rightSource.agentId || value.rightAgentId) ?? null,
    did: normalizeOptionalText(rightSource.did || value.rightDid) ?? null,
    walletAddress: normalizeOptionalText(rightSource.walletAddress || value.rightWalletAddress)?.toLowerCase() ?? null,
    windowId: normalizeOptionalText(rightSource.windowId || value.rightWindowId) ?? null,
  };
  const hasLeft = Object.values(left).some(Boolean);
  const hasRight = Object.values(right).some(Boolean);
  if (!hasLeft || !hasRight) {
    return null;
  }

  return {
    left,
    right,
    label: normalizeOptionalText(value.label) ?? null,
  };
}

export function normalizeComparisonRepairPairList(value = null, fallbackPair = null) {
  const items = Array.isArray(value) ? value : value ? [value] : fallbackPair ? [fallbackPair] : [];
  return items.map((entry) => normalizeComparisonRepairPairInput(entry)).filter(Boolean);
}

export function resolveComparisonRepairPairSubjects(store, comparisonPairs = [], fallbackPair = null, deps = {}) {
  const { resolveAgentComparisonAuditPair } = normalizeCredentialRepairCoverageDeps(deps);
  if (typeof resolveAgentComparisonAuditPair !== "function") {
    throw new Error("resolveAgentComparisonAuditPair dependency is required");
  }
  const targets = normalizeComparisonRepairPairList(comparisonPairs, fallbackPair);
  const subjectIds = new Set();
  const pairs = [];
  const invalid = [];

  for (const target of targets) {
    try {
      const pair = resolveAgentComparisonAuditPair(store, {
        leftAgentId: target.left.agentId,
        rightAgentId: target.right.agentId,
        leftDid: target.left.did,
        rightDid: target.right.did,
        leftWalletAddress: target.left.walletAddress,
        rightWalletAddress: target.right.walletAddress,
        leftWindowId: target.left.windowId,
        rightWindowId: target.right.windowId,
      });
      subjectIds.add(pair.subjectId);
      pairs.push({
        label: target.label,
        ...pair,
      });
    } catch (error) {
      invalid.push({
        pair: cloneJson(target),
        reason: error.message || "comparison pair could not be resolved",
      });
    }
  }

  return {
    targets,
    subjectIds,
    pairs,
    invalid,
  };
}

export function isReusableComparisonCredentialSnapshot(store, record, { issuerDid = null, comparisonDigest = null } = {}) {
  return Boolean(
    record &&
      normalizeOptionalText(record.ledgerHash) === normalizeOptionalText(store?.lastEventHash ?? null) &&
      credentialRecordHasValidProof(record) &&
      credentialUsesAgentPassportSignature(record) &&
      credentialUsesCanonicalAgentPassportTypes(record) &&
      credentialRecordUsesIssuerDid(record, issuerDid) &&
      normalizeOptionalText(record.comparisonDigest) === normalizeOptionalText(comparisonDigest)
  );
}

export function buildComparisonRepairPairState(
  store,
  comparisonResult,
  issuerAgent,
  requestedDidMethods = PUBLIC_SIGNABLE_DID_METHODS
) {
  const subjectId = buildAgentComparisonSubjectId(comparisonResult);
  const subjectLabel = buildAgentComparisonSubjectLabel(comparisonResult);
  const methods = requestedDidMethods.length > 0 ? requestedDidMethods : [...PUBLIC_SIGNABLE_DID_METHODS];
  const methodStates = methods.map((didMethod) => {
    const issuerDid = resolveAgentDidForMethod(store, issuerAgent, didMethod);
    const latestRecord = findLatestCredentialRecordForSubject(store, {
      kind: "agent_comparison",
      subjectType: "comparison",
      subjectId,
      issuerDid,
      status: "active",
    });
    const isCurrent = isReusableComparisonCredentialSnapshot(store, latestRecord, {
      issuerDid,
      comparisonDigest: comparisonResult?.comparisonDigest ?? null,
    });

    return {
      didMethod,
      issuerDid,
      state: isCurrent ? "current" : latestRecord ? "stale" : "missing",
      credentialRecordId: latestRecord?.credentialRecordId ?? null,
      credentialId: latestRecord?.credentialId ?? null,
      snapshotFresh: latestRecord?.ledgerHash ? latestRecord.ledgerHash === (store?.lastEventHash ?? null) : null,
    };
  });

  return {
    subjectId,
    subjectLabel,
    comparisonDigest: comparisonResult?.comparisonDigest ?? null,
    label: comparisonResult?.comparison?.summary ?? subjectLabel,
    left: cloneJson(comparisonResult?.left?.resolvedFrom || comparisonResult?.left?.snapshot) ?? null,
    right: cloneJson(comparisonResult?.right?.resolvedFrom || comparisonResult?.right?.snapshot) ?? null,
    requestedDidMethods: [...methods],
    availableDidMethods: methodStates.filter((entry) => entry.state === "current").map((entry) => entry.didMethod),
    missingDidMethods: methodStates.filter((entry) => entry.state === "missing").map((entry) => entry.didMethod),
    staleDidMethods: methodStates.filter((entry) => entry.state === "stale").map((entry) => entry.didMethod),
    plannedDidMethods: methodStates.filter((entry) => entry.state !== "current").map((entry) => entry.didMethod),
    complete: methodStates.every((entry) => entry.state === "current"),
    methodStates,
  };
}

export function buildCredentialRepairTarget(store, record, precomputedSiblingMethods = null) {
  const normalizedRecord = normalizeCredentialRecord(record);
  if (!normalizedRecord) {
    return null;
  }

  const siblingMethods = precomputedSiblingMethods ?? buildCredentialSiblingSummary(store, normalizedRecord, { activeOnly: true });
  const missingDidMethods = siblingMethods?.repairMissingDidMethods || siblingMethods?.missingDidMethods || [];
  if (!missingDidMethods.length) {
    return null;
  }

  const kind = normalizeCredentialKind(normalizedRecord.kind);
  const base = {
    groupKey: credentialSiblingGroupKey(normalizedRecord),
    kind,
    subjectType: normalizedRecord.subjectType,
    subjectId: normalizedRecord.subjectId,
    subjectLabel: credentialSubjectLabel(store, normalizedRecord),
    issuerAgentId: normalizedRecord.issuerAgentId,
    availableDidMethods: siblingMethods?.availableDidMethods || [],
    missingDidMethods,
    publicMissingDidMethods: siblingMethods?.publicMissingDidMethods || [],
    repairMissingDidMethods: siblingMethods?.repairMissingDidMethods || missingDidMethods,
    currentDidMethod: siblingMethods?.currentDidMethod ?? didMethodFromReference(normalizedRecord.issuerDid),
  };

  if (kind === "agent_identity") {
    const agent = normalizedRecord.subjectId ? store.agents?.[normalizedRecord.subjectId] ?? null : null;
    return {
      ...base,
      repairable: Boolean(agent),
      repairStrategy: "ensure_agent_identity",
      repairReason: agent ? "missing DID method snapshots can be issued from the current agent identity" : "agent subject not found",
    };
  }

  if (kind === "authorization_receipt") {
    const proposal = normalizedRecord.subjectId ? store.proposals?.find((entry) => entry.proposalId === normalizedRecord.subjectId) ?? null : null;
    return {
      ...base,
      repairable: Boolean(proposal),
      repairStrategy: "ensure_authorization_receipt",
      repairReason: proposal ? "missing DID method receipts can be re-issued from the stored proposal" : "authorization proposal not found",
    };
  }

  if (kind === "agent_comparison") {
    const references = buildComparisonRepairReferences(normalizedRecord);
    return {
      ...base,
      repairable: Boolean(references),
      repairStrategy: "ensure_agent_comparison",
      repairReason: references ? "missing DID method comparison audits can be rebuilt from stored left/right references" : "comparison references are incomplete",
    };
  }

  return {
    ...base,
    repairable: false,
    repairStrategy: "unsupported",
    repairReason: "credential kind is not repairable in the current prototype",
  };
}

export function buildAgentCredentialMethodCoverage(store, agentId, deps = {}) {
  const { isCredentialRelatedToAgent } = normalizeCredentialRepairCoverageDeps(deps);
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_credential_method_coverage",
    store,
    agentId,
    [
      buildCollectionTailToken(store?.credentials || [], {
        idFields: ["credentialRecordId", "credentialId"],
        timeFields: ["updatedAt", "issuedAt"],
      }),
      `${Array.isArray(store?.proposals) ? store.proposals.length : 0}`,
      `${Object.keys(store?.agents || {}).length}`,
    ].join(":")
  );
  return cacheStoreDerivedView(store, cacheKey, () => {
    const activeRecords = (store.credentials || [])
      .map((record) => normalizeCredentialRecord(record))
      .filter(Boolean)
      .filter((record) => normalizeCredentialStatus(record.status) === "active")
      .filter((record) => CREDENTIAL_KINDS.has(normalizeCredentialKind(record.kind)))
      .filter((record) => isCredentialRelatedToAgent(record, agentId, store));

    const subjectGroups = new Map();
    for (const record of activeRecords) {
      const groupKey = credentialSiblingGroupKey(record);
      if (!groupKey) {
        continue;
      }

      const bucket = subjectGroups.get(groupKey) || [];
      bucket.push(record);
      subjectGroups.set(groupKey, bucket);
    }

    const subjects = [...subjectGroups.values()]
      .map((group) => {
        const sample = group[0];
        const siblingMethods = buildCredentialSiblingSummaryFromRecords(store, sample, group);
        const repair = buildCredentialRepairTarget(store, sample, siblingMethods);
        const latestIssuedAt = group
          .map((record) => record.issuedAt || record.updatedAt || null)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;

        return {
          groupKey: credentialSiblingGroupKey(sample),
          kind: sample.kind,
          subjectType: sample.subjectType,
          subjectId: sample.subjectId,
          subjectLabel: credentialSubjectLabel(store, sample),
          issuerAgentId: sample.issuerAgentId,
          latestIssuedAt,
          siblingMethods,
          repair,
        };
      })
      .sort((a, b) => {
        const issuedDiff = new Date(b.latestIssuedAt || 0).getTime() - new Date(a.latestIssuedAt || 0).getTime();
        if (issuedDiff !== 0) {
          return issuedDiff;
        }

        return compareCredentialIds(b.subjectId || b.groupKey, a.subjectId || a.groupKey);
      });

    const kinds = {};
    for (const subject of subjects) {
      const kind = normalizeCredentialKind(subject.kind);
      if (!kinds[kind]) {
        kinds[kind] = {
          ...buildCredentialDidMethodScopeDescriptor(),
          signableDidMethods: [...PUBLIC_SIGNABLE_DID_METHODS],
          subjectCount: 0,
          completeSubjectCount: 0,
          partialSubjectCount: 0,
          repairCompleteSubjectCount: 0,
          repairPartialSubjectCount: 0,
          byDidMethod: {},
          availableDidMethods: [],
          missingDidMethods: [],
          publicMissingDidMethods: [],
          compatibilityMissingDidMethods: [],
          repairMissingDidMethods: [],
          latestSubjects: [],
        };
      }

      const bucket = kinds[kind];
      bucket.subjectCount += 1;
      if (subject.siblingMethods?.publicComplete) {
        bucket.completeSubjectCount += 1;
      } else {
        bucket.partialSubjectCount += 1;
      }
      if (subject.siblingMethods?.repairComplete) {
        bucket.repairCompleteSubjectCount += 1;
      } else {
        bucket.repairPartialSubjectCount += 1;
      }

      for (const method of subject.siblingMethods?.availableDidMethods || []) {
        bucket.byDidMethod[method] = (bucket.byDidMethod[method] || 0) + 1;
      }

      bucket.availableDidMethods = [...new Set([...bucket.availableDidMethods, ...(subject.siblingMethods?.availableDidMethods || [])])];
      bucket.publicMissingDidMethods = [
        ...new Set([
          ...bucket.publicMissingDidMethods,
          ...(subject.siblingMethods?.publicMissingDidMethods || subject.siblingMethods?.missingDidMethods || []),
        ]),
      ];
      bucket.compatibilityMissingDidMethods = [
        ...new Set([
          ...bucket.compatibilityMissingDidMethods,
          ...(subject.siblingMethods?.compatibilityMissingDidMethods || []),
        ]),
      ];
      bucket.repairMissingDidMethods = [
        ...new Set([
          ...bucket.repairMissingDidMethods,
          ...(subject.siblingMethods?.repairMissingDidMethods || subject.siblingMethods?.missingDidMethods || []),
        ]),
      ];
      bucket.missingDidMethods = [...bucket.publicMissingDidMethods];
      bucket.latestSubjects.push(subject);
      bucket.latestSubjects.sort((a, b) => new Date(b.latestIssuedAt || 0).getTime() - new Date(a.latestIssuedAt || 0).getTime());
      bucket.latestSubjects = bucket.latestSubjects.slice(0, 5);
    }

    const completeSubjectCount = subjects.filter((subject) => subject.siblingMethods?.publicComplete).length;
    const partialSubjectCount = Math.max(0, subjects.length - completeSubjectCount);
    const repairCompleteSubjectCount = subjects.filter((subject) => subject.siblingMethods?.repairComplete).length;
    const repairPartialSubjectCount = Math.max(0, subjects.length - repairCompleteSubjectCount);
    const availableDidMethods = [...new Set(subjects.flatMap((subject) => subject.siblingMethods?.availableDidMethods || []))];
    const didMethodAvailability = buildCredentialDidMethodAvailability(availableDidMethods);
    const repairableSubjects = subjects
      .filter(
        (subject) =>
          subject.repair?.repairable &&
          (subject.repair?.repairMissingDidMethods?.length || subject.repair?.missingDidMethods?.length || 0) > 0
      )
      .map((subject) => ({
        groupKey: subject.groupKey,
        kind: subject.kind,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        subjectLabel: subject.subjectLabel,
        issuerAgentId: subject.issuerAgentId,
        latestIssuedAt: subject.latestIssuedAt,
        availableDidMethods: subject.repair?.availableDidMethods || [],
        missingDidMethods: subject.repair?.repairMissingDidMethods || subject.repair?.missingDidMethods || [],
        publicMissingDidMethods: subject.repair?.publicMissingDidMethods || [],
        repairMissingDidMethods: subject.repair?.repairMissingDidMethods || subject.repair?.missingDidMethods || [],
        repairStrategy: subject.repair?.repairStrategy || null,
        repairReason: subject.repair?.repairReason || null,
      }));

    return {
      ...didMethodAvailability,
      signableDidMethods: [...didMethodAvailability.publicSignableDidMethods],
      totalSubjects: subjects.length,
      completeSubjectCount,
      partialSubjectCount,
      repairCompleteSubjectCount,
      repairPartialSubjectCount,
      complete: subjects.length > 0 && partialSubjectCount === 0,
      publicComplete: subjects.length > 0 && partialSubjectCount === 0,
      repairComplete: subjects.length > 0 && repairPartialSubjectCount === 0,
      availableDidMethods,
      missingDidMethods: [...didMethodAvailability.publicMissingDidMethods],
      publicMissingDidMethods: [...didMethodAvailability.publicMissingDidMethods],
      compatibilityMissingDidMethods: [...didMethodAvailability.compatibilityMissingDidMethods],
      repairMissingDidMethods: [...didMethodAvailability.repairMissingDidMethods],
      repairableSubjectCount: repairableSubjects.length,
      repairableSubjects,
      kinds,
      subjects,
    };
  });
}

export function summarizeCredentialMethodCoverage(coverage = null) {
  if (!coverage) {
    return null;
  }

  return {
    publicSignableDidMethods: cloneJson(coverage.publicSignableDidMethods) ?? [],
    compatibilitySignableDidMethods: cloneJson(coverage.compatibilitySignableDidMethods) ?? [],
    repairSignableDidMethods: cloneJson(coverage.repairSignableDidMethods) ?? [],
    signableDidMethods: cloneJson(coverage.signableDidMethods) ?? [],
    totalSubjects: coverage.totalSubjects ?? 0,
    completeSubjectCount: coverage.completeSubjectCount ?? 0,
    partialSubjectCount: coverage.partialSubjectCount ?? 0,
    complete: Boolean(coverage.complete),
    publicComplete: Boolean(coverage.publicComplete ?? coverage.complete),
    repairComplete: Boolean(coverage.repairComplete),
    repairCompleteSubjectCount: coverage.repairCompleteSubjectCount ?? 0,
    repairPartialSubjectCount: coverage.repairPartialSubjectCount ?? 0,
    availableDidMethods: cloneJson(coverage.availableDidMethods) ?? [],
    missingDidMethods: cloneJson(coverage.missingDidMethods) ?? [],
    publicMissingDidMethods: cloneJson(coverage.publicMissingDidMethods) ?? [],
    compatibilityMissingDidMethods: cloneJson(coverage.compatibilityMissingDidMethods) ?? [],
    repairMissingDidMethods: cloneJson(coverage.repairMissingDidMethods) ?? [],
    repairableSubjectCount: coverage.repairableSubjectCount ?? 0,
    repairableSubjects: cloneJson(coverage.repairableSubjects) ?? [],
  };
}

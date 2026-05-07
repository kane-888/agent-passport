import {
  cloneJson,
  hashJson,
  normalizeOptionalText,
} from "./ledger-core-utils.js";
import {
  buildCredentialDidMethodScopeDescriptor,
  normalizeCredentialKind,
} from "./ledger-credential-core.js";
import { compareSignedSet } from "./ledger-identity-compat.js";
import {
  PUBLIC_SIGNABLE_DID_METHODS,
  SIGNABLE_DID_METHODS,
} from "./protocol.js";

function requireAgentComparisonDep(deps, name) {
  const value = deps?.[name];
  if (typeof value !== "function") {
    throw new Error(`agent comparison dependency is required: ${name}`);
  }
  return value;
}

export function compareTextSet(leftItems = [], rightItems = []) {
  const left = leftItems.map((item) => normalizeOptionalText(item)).filter(Boolean);
  const right = rightItems.map((item) => normalizeOptionalText(item)).filter(Boolean);
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const shared = left.filter((item) => rightSet.has(item));
  const leftOnly = left.filter((item) => !rightSet.has(item));
  const rightOnly = right.filter((item) => !leftSet.has(item));

  return {
    same: left.length === right.length && shared.length === left.length && shared.length === right.length,
    left,
    right,
    shared,
    leftOnly,
    rightOnly,
  };
}

export function buildAgentMigrationDiff(leftCoverage = null, rightCoverage = null) {
  const normalizedLeft = cloneJson(leftCoverage) ?? {
    ...buildCredentialDidMethodScopeDescriptor(),
    signableDidMethods: [...PUBLIC_SIGNABLE_DID_METHODS],
    totalSubjects: 0,
    completeSubjectCount: 0,
    partialSubjectCount: 0,
    complete: false,
    publicComplete: false,
    repairComplete: false,
    availableDidMethods: [],
    missingDidMethods: [...PUBLIC_SIGNABLE_DID_METHODS],
    publicMissingDidMethods: [...PUBLIC_SIGNABLE_DID_METHODS],
    compatibilityMissingDidMethods: SIGNABLE_DID_METHODS.filter((method) => !PUBLIC_SIGNABLE_DID_METHODS.includes(method)),
    repairMissingDidMethods: [...SIGNABLE_DID_METHODS],
    kinds: {},
  };
  const normalizedRight = cloneJson(rightCoverage) ?? {
    ...buildCredentialDidMethodScopeDescriptor(),
    signableDidMethods: [...PUBLIC_SIGNABLE_DID_METHODS],
    totalSubjects: 0,
    completeSubjectCount: 0,
    partialSubjectCount: 0,
    complete: false,
    publicComplete: false,
    repairComplete: false,
    availableDidMethods: [],
    missingDidMethods: [...PUBLIC_SIGNABLE_DID_METHODS],
    publicMissingDidMethods: [...PUBLIC_SIGNABLE_DID_METHODS],
    compatibilityMissingDidMethods: SIGNABLE_DID_METHODS.filter((method) => !PUBLIC_SIGNABLE_DID_METHODS.includes(method)),
    repairMissingDidMethods: [...SIGNABLE_DID_METHODS],
    kinds: {},
  };
  const kindNames = [...new Set([...Object.keys(normalizedLeft.kinds || {}), ...Object.keys(normalizedRight.kinds || {})])].sort();
  const kindDiffs = kindNames.map((kind) => {
    const leftKind = normalizedLeft.kinds?.[kind] ?? null;
    const rightKind = normalizedRight.kinds?.[kind] ?? null;
    const leftAvailable = leftKind?.availableDidMethods || [];
    const rightAvailable = rightKind?.availableDidMethods || [];
    const leftMissing = leftKind?.missingDidMethods || [];
    const rightMissing = rightKind?.missingDidMethods || [];
    const leftRepairMissing = leftKind?.repairMissingDidMethods || leftMissing;
    const rightRepairMissing = rightKind?.repairMissingDidMethods || rightMissing;
    const availableComparison = compareTextSet(leftAvailable, rightAvailable);
    const missingComparison = compareTextSet(leftMissing, rightMissing);
    const repairMissingComparison = compareTextSet(leftRepairMissing, rightRepairMissing);
    const sameSubjectCount = Number(leftKind?.subjectCount || 0) === Number(rightKind?.subjectCount || 0);
    const sameCompleteSubjectCount = Number(leftKind?.completeSubjectCount || 0) === Number(rightKind?.completeSubjectCount || 0);
    const sameRepairCompleteSubjectCount =
      Number(leftKind?.repairCompleteSubjectCount || 0) === Number(rightKind?.repairCompleteSubjectCount || 0);

    return {
      kind,
      leftSubjectCount: Number(leftKind?.subjectCount || 0),
      rightSubjectCount: Number(rightKind?.subjectCount || 0),
      leftCompleteSubjectCount: Number(leftKind?.completeSubjectCount || 0),
      rightCompleteSubjectCount: Number(rightKind?.completeSubjectCount || 0),
      leftPartialSubjectCount: Number(leftKind?.partialSubjectCount || 0),
      rightPartialSubjectCount: Number(rightKind?.partialSubjectCount || 0),
      leftRepairCompleteSubjectCount: Number(leftKind?.repairCompleteSubjectCount || 0),
      rightRepairCompleteSubjectCount: Number(rightKind?.repairCompleteSubjectCount || 0),
      leftRepairPartialSubjectCount: Number(leftKind?.repairPartialSubjectCount || 0),
      rightRepairPartialSubjectCount: Number(rightKind?.repairPartialSubjectCount || 0),
      leftAvailableDidMethods: leftAvailable,
      rightAvailableDidMethods: rightAvailable,
      leftMissingDidMethods: leftMissing,
      rightMissingDidMethods: rightMissing,
      leftRepairMissingDidMethods: leftRepairMissing,
      rightRepairMissingDidMethods: rightRepairMissing,
      sameCoverage: availableComparison.same && missingComparison.same && sameSubjectCount && sameCompleteSubjectCount,
      sameRepairCoverage: repairMissingComparison.same && sameSubjectCount && sameRepairCompleteSubjectCount,
    };
  });
  const availableComparison = compareTextSet(normalizedLeft.availableDidMethods || [], normalizedRight.availableDidMethods || []);
  const missingComparison = compareTextSet(normalizedLeft.missingDidMethods || [], normalizedRight.missingDidMethods || []);
  const repairMissingComparison = compareTextSet(
    normalizedLeft.repairMissingDidMethods || normalizedLeft.missingDidMethods || [],
    normalizedRight.repairMissingDidMethods || normalizedRight.missingDidMethods || []
  );
  const sameTotalSubjects = Number(normalizedLeft.totalSubjects || 0) === Number(normalizedRight.totalSubjects || 0);
  const sameCompleteState = Boolean(normalizedLeft.complete) === Boolean(normalizedRight.complete);
  const sameRepairCompleteState = Boolean(normalizedLeft.repairComplete) === Boolean(normalizedRight.repairComplete);

  return {
    ...buildCredentialDidMethodScopeDescriptor(),
    signableDidMethods: [...PUBLIC_SIGNABLE_DID_METHODS],
    sameCoverage:
      availableComparison.same &&
      missingComparison.same &&
      sameTotalSubjects &&
      sameCompleteState &&
      kindDiffs.every((item) => item.sameCoverage),
    sameRepairCoverage:
      repairMissingComparison.same &&
      sameTotalSubjects &&
      sameRepairCompleteState &&
      kindDiffs.every((item) => item.sameRepairCoverage),
    sameCompleteState,
    sameRepairCompleteState,
    left: {
      totalSubjects: normalizedLeft.totalSubjects || 0,
      completeSubjectCount: normalizedLeft.completeSubjectCount || 0,
      partialSubjectCount: normalizedLeft.partialSubjectCount || 0,
      complete: Boolean(normalizedLeft.complete),
      publicComplete: Boolean(normalizedLeft.publicComplete ?? normalizedLeft.complete),
      repairComplete: Boolean(normalizedLeft.repairComplete),
      repairCompleteSubjectCount: normalizedLeft.repairCompleteSubjectCount || 0,
      repairPartialSubjectCount: normalizedLeft.repairPartialSubjectCount || 0,
      availableDidMethods: normalizedLeft.availableDidMethods || [],
      missingDidMethods: normalizedLeft.missingDidMethods || [],
      publicMissingDidMethods: normalizedLeft.publicMissingDidMethods || normalizedLeft.missingDidMethods || [],
      compatibilityMissingDidMethods: normalizedLeft.compatibilityMissingDidMethods || [],
      repairMissingDidMethods: normalizedLeft.repairMissingDidMethods || normalizedLeft.missingDidMethods || [],
      repairableSubjectCount: normalizedLeft.repairableSubjectCount || 0,
    },
    right: {
      totalSubjects: normalizedRight.totalSubjects || 0,
      completeSubjectCount: normalizedRight.completeSubjectCount || 0,
      partialSubjectCount: normalizedRight.partialSubjectCount || 0,
      complete: Boolean(normalizedRight.complete),
      publicComplete: Boolean(normalizedRight.publicComplete ?? normalizedRight.complete),
      repairComplete: Boolean(normalizedRight.repairComplete),
      repairCompleteSubjectCount: normalizedRight.repairCompleteSubjectCount || 0,
      repairPartialSubjectCount: normalizedRight.repairPartialSubjectCount || 0,
      availableDidMethods: normalizedRight.availableDidMethods || [],
      missingDidMethods: normalizedRight.missingDidMethods || [],
      publicMissingDidMethods: normalizedRight.publicMissingDidMethods || normalizedRight.missingDidMethods || [],
      compatibilityMissingDidMethods: normalizedRight.compatibilityMissingDidMethods || [],
      repairMissingDidMethods: normalizedRight.repairMissingDidMethods || normalizedRight.missingDidMethods || [],
      repairableSubjectCount: normalizedRight.repairableSubjectCount || 0,
    },
    kindDiffs,
    summary: [
      normalizedLeft.complete ? "left public migration 完整" : "left public migration 未齐",
      normalizedRight.complete ? "right public migration 完整" : "right public migration 未齐",
      availableComparison.same && missingComparison.same && sameTotalSubjects && sameCompleteState && kindDiffs.every((item) => item.sameCoverage)
        ? "公开迁移覆盖一致"
        : "公开迁移覆盖不同",
      sameRepairCompleteState && repairMissingComparison.same && kindDiffs.every((item) => item.sameRepairCoverage)
        ? "兼容补签覆盖一致"
        : "兼容补签覆盖不同",
    ].join(" · "),
  };
}

export function buildAgentComparisonSnapshot(context, resolvedFrom = null) {
  const identity = context?.identity ?? {};
  const comparisonCredentials = Array.isArray(context?.credentials)
    ? context.credentials.filter((credential) => normalizeCredentialKind(credential?.kind) !== "agent_comparison")
    : [];
  const recentWindowIds = Array.isArray(context?.windows) ? context.windows.slice(-5).map((window) => window.windowId).filter(Boolean) : [];
  const recentMemoryIds = Array.isArray(context?.memories) ? context.memories.slice(-5).map((memory) => memory.memoryId).filter(Boolean) : [];
  const recentAuthorizationIds = Array.isArray(context?.authorizations)
    ? context.authorizations.slice(-5).map((authorization) => authorization.proposalId).filter(Boolean)
    : [];
  const recentCredentialIds = comparisonCredentials.slice(-5).map((credential) => credential.credentialRecordId).filter(Boolean);
  const statusListIds = Array.isArray(context?.statusLists) ? context.statusLists.map((statusList) => statusList.statusListId).filter(Boolean) : [];
  const counts = cloneJson(context?.counts) ?? {};
  counts.credentials = comparisonCredentials.length;

  return {
    resolvedFrom: cloneJson(resolvedFrom) ?? null,
    agentId: context?.agent?.agentId ?? null,
    displayName: context?.agent?.displayName ?? null,
    role: context?.agent?.role ?? null,
    controller: context?.agent?.controller ?? null,
    did: identity.did ?? null,
    walletAddress: identity.walletAddress ?? null,
    walletScheme: identity.walletScheme ?? null,
    originDid: identity.originDid ?? null,
    policyType: identity.authorizationPolicy?.type ?? null,
    threshold: identity.authorizationPolicy?.threshold ?? null,
    assets: cloneJson(context?.assets) ?? null,
    counts,
    statusListId: context?.statusList?.statusListId ?? null,
    statusListCredentialId: context?.statusList?.statusListCredentialId ?? null,
    statusListIssuerDid: context?.statusList?.issuerDid ?? null,
    statusListIssuerAgentId: context?.statusList?.issuerAgentId ?? null,
    statusListIds,
    statusListCount: statusListIds.length,
    didDocumentId: context?.didDocument?.id ?? null,
    recentWindowIds,
    recentMemoryIds,
    recentAuthorizationIds,
    recentCredentialIds,
  };
}

export function buildAgentComparisonSubjectId(comparisonResult) {
  const leftReference =
    comparisonResult?.left?.snapshot?.agentId ||
    comparisonResult?.left?.snapshot?.did ||
    comparisonResult?.left?.resolvedFrom?.agentId ||
    comparisonResult?.left?.resolvedFrom?.did ||
    comparisonResult?.left?.resolvedFrom?.walletAddress ||
    "left";
  const rightReference =
    comparisonResult?.right?.snapshot?.agentId ||
    comparisonResult?.right?.snapshot?.did ||
    comparisonResult?.right?.resolvedFrom?.agentId ||
    comparisonResult?.right?.resolvedFrom?.did ||
    comparisonResult?.right?.resolvedFrom?.walletAddress ||
    "right";

  return `agent_comparison_${hashJson({ left: leftReference, right: rightReference }).slice(0, 16)}`;
}

export function buildAgentComparisonSubjectLabel(comparisonResult) {
  const leftLabel =
    comparisonResult?.left?.snapshot?.displayName ||
    comparisonResult?.left?.snapshot?.agentId ||
    comparisonResult?.left?.snapshot?.did ||
    "left";
  const rightLabel =
    comparisonResult?.right?.snapshot?.displayName ||
    comparisonResult?.right?.snapshot?.agentId ||
    comparisonResult?.right?.snapshot?.did ||
    "right";

  return `${leftLabel} vs ${rightLabel}`;
}

export function buildAgentComparisonView(store, leftReference = {}, rightReference = {}, options = {}, deps = {}) {
  const resolveAgentReferenceFromStore = requireAgentComparisonDep(deps, "resolveAgentReferenceFromStore");
  const buildAgentContextSnapshot = requireAgentComparisonDep(deps, "buildAgentContextSnapshot");
  const leftResolution = resolveAgentReferenceFromStore(store, leftReference);
  const rightResolution = resolveAgentReferenceFromStore(store, rightReference);
  const leftContext = buildAgentContextSnapshot(store, leftResolution.agent, options);
  const rightContext = buildAgentContextSnapshot(store, rightResolution.agent, options);
  const leftSnapshot = buildAgentComparisonSnapshot(leftContext, leftResolution.reference);
  const rightSnapshot = buildAgentComparisonSnapshot(rightContext, rightResolution.reference);
  const migrationDiff = buildAgentMigrationDiff(leftContext.credentialMethodCoverage, rightContext.credentialMethodCoverage);
  const leftIdentity = leftContext.identity || {};
  const rightIdentity = rightContext.identity || {};
  const leftCounts = cloneJson(leftSnapshot.counts) ?? cloneJson(leftContext.counts) ?? {};
  const rightCounts = cloneJson(rightSnapshot.counts) ?? cloneJson(rightContext.counts) ?? {};
  const sameAgentId = Boolean(leftContext.agent?.agentId && leftContext.agent.agentId === rightContext.agent?.agentId);
  const sameDid = Boolean(leftIdentity.did && leftIdentity.did === rightIdentity.did);
  const sameWalletAddress = Boolean(leftIdentity.walletAddress && leftIdentity.walletAddress === rightIdentity.walletAddress);
  const sameOriginDid = Boolean(leftIdentity.originDid && leftIdentity.originDid === rightIdentity.originDid);
  const sameRole = Boolean(leftContext.agent?.role && leftContext.agent.role === rightContext.agent?.role);
  const samePolicyType = Boolean(leftIdentity.authorizationPolicy?.type && leftIdentity.authorizationPolicy.type === rightIdentity.authorizationPolicy?.type);
  const sameThreshold = Boolean(
    Number.isFinite(Number(leftIdentity.authorizationPolicy?.threshold)) &&
      Number.isFinite(Number(rightIdentity.authorizationPolicy?.threshold)) &&
      Number(leftIdentity.authorizationPolicy.threshold) === Number(rightIdentity.authorizationPolicy.threshold)
  );
  const signerComparison = compareSignedSet(leftIdentity.authorizationPolicy?.signers || [], rightIdentity.authorizationPolicy?.signers || []);
  const controllerComparison = compareSignedSet(leftIdentity.controllers || [], rightIdentity.controllers || []);
  const statusListComparison = compareTextSet(leftSnapshot.statusListIds, rightSnapshot.statusListIds);
  const samePrimaryStatusListId = Boolean(leftSnapshot.statusListId && leftSnapshot.statusListId === rightSnapshot.statusListId);
  const samePrimaryStatusListCredentialId = Boolean(
    leftSnapshot.statusListCredentialId && leftSnapshot.statusListCredentialId === rightSnapshot.statusListCredentialId
  );
  const sameStatusListCount = Boolean(leftSnapshot.statusListCount === rightSnapshot.statusListCount);
  const sameAssetCredits = Number(leftContext.assets?.credits ?? 0) === Number(rightContext.assets?.credits ?? 0);
  const sameWindowCount = Boolean(leftCounts.windows === rightCounts.windows);
  const sameMemoryCount = Boolean(leftCounts.memories === rightCounts.memories);
  const sameInboxCount = Boolean(leftCounts.inbox === rightCounts.inbox);
  const sameOutboxCount = Boolean(leftCounts.outbox === rightCounts.outbox);
  const sameAuthorizationCount = Boolean(leftCounts.authorizations === rightCounts.authorizations);
  const sameCredentialCount = Boolean(leftCounts.credentials === rightCounts.credentials);
  const sameChainId = true;
  const summaryParts = [
    sameAgentId ? "同一 Agent" : "不同 Agent",
    sameDid ? "同一 DID" : "不同 DID",
    sameWalletAddress ? "同一钱包" : "不同钱包",
    sameOriginDid ? "同一 origin DID" : "origin DID 不同",
    sameRole ? `role ${leftContext.agent?.role || "unknown"}` : "role 不同",
    samePolicyType ? `policy ${leftIdentity.authorizationPolicy?.type || "unknown"}` : "policy 不同",
    sameThreshold ? `threshold ${leftIdentity.authorizationPolicy?.threshold ?? "unknown"}` : "threshold 不同",
    signerComparison.same ? "签名者集合一致" : "签名者集合不同",
    controllerComparison.same ? "控制人集合一致" : "控制人集合不同",
    samePrimaryStatusListId ? "主状态列表一致" : "主状态列表不同",
    statusListComparison.same ? "状态列表注册表一致" : "状态列表注册表不同",
    sameAssetCredits ? `credits ${leftContext.assets?.credits ?? 0}` : "credits 不同",
    migrationDiff.summary,
    sameChainId ? `chain ${store.chainId}` : "chain 不同",
  ].filter(Boolean);

  const comparison = {
    chainId: store.chainId,
    sameChainId,
    sameAgentId,
    sameDid,
    sameWalletAddress,
    sameOriginDid,
    sameRole,
    samePolicyType,
    sameThreshold,
    sameSignerSet: signerComparison.same,
    sameControllerSet: controllerComparison.same,
    samePrimaryStatusListId,
    samePrimaryStatusListCredentialId,
    sameStatusListRegistry: statusListComparison.same,
    sameStatusListCount,
    sameAssetCredits,
    sameWindowCount,
    sameMemoryCount,
    sameInboxCount,
    sameOutboxCount,
    sameAuthorizationCount,
    sameCredentialCount,
    leftCounts,
    rightCounts,
    leftStatusListIds: leftSnapshot.statusListIds,
    rightStatusListIds: rightSnapshot.statusListIds,
    sharedStatusListIds: statusListComparison.shared,
    leftOnlyStatusListIds: statusListComparison.leftOnly,
    rightOnlyStatusListIds: statusListComparison.rightOnly,
    signerComparison,
    controllerComparison,
    statusListComparison,
    migrationDiff,
    summary: summaryParts.join(" · "),
  };
  const comparisonDigest = hashJson({
    chainId: store.chainId,
    left: leftSnapshot,
    right: rightSnapshot,
    comparison: {
      summary: comparison.summary,
      sameAgentId,
      sameDid,
      sameWalletAddress,
      sameOriginDid,
      sameRole,
      samePolicyType,
      sameThreshold,
      sameSignerSet: signerComparison.same,
      sameControllerSet: controllerComparison.same,
      samePrimaryStatusListId,
      samePrimaryStatusListCredentialId,
      sameStatusListRegistry: statusListComparison.same,
      sameStatusListCount,
      sameAssetCredits,
      sameWindowCount,
      sameMemoryCount,
      sameInboxCount,
      sameOutboxCount,
      sameAuthorizationCount,
      sameCredentialCount,
      migrationDiff: {
        sameCoverage: migrationDiff.sameCoverage,
        sameCompleteState: migrationDiff.sameCompleteState,
        left: migrationDiff.left,
        right: migrationDiff.right,
        kindDiffs: migrationDiff.kindDiffs,
        summary: migrationDiff.summary,
      },
    },
  });

  comparison.comparisonDigest = comparisonDigest;

  return {
    left: {
      resolvedFrom: leftResolution.reference,
      context: leftContext,
      snapshot: leftSnapshot,
    },
    right: {
      resolvedFrom: rightResolution.reference,
      context: rightContext,
      snapshot: rightSnapshot,
    },
    comparison,
    comparisonDigest,
  };
}

export function formatAgentComparisonView(comparisonResult, { summaryOnly = false } = {}) {
  if (!summaryOnly) {
    return comparisonResult;
  }

  return {
    left: {
      resolvedFrom: comparisonResult?.left?.resolvedFrom ?? null,
      snapshot: comparisonResult?.left?.snapshot ?? null,
    },
    right: {
      resolvedFrom: comparisonResult?.right?.resolvedFrom ?? null,
      snapshot: comparisonResult?.right?.snapshot ?? null,
    },
    comparison: comparisonResult?.comparison ?? null,
    comparisonDigest: comparisonResult?.comparisonDigest ?? null,
  };
}

export function formatAgentComparisonEvidenceResponse(
  comparisonResult,
  evidenceResult,
  { summaryOnly = false, credentialRecord = null, migrationRepairs = [] } = {}
) {
  if (!summaryOnly) {
    return {
      comparison: comparisonResult?.comparison ?? null,
      comparisonDigest: comparisonResult?.comparisonDigest ?? null,
      repairIds: migrationRepairs.map((repair) => repair.repairId).filter(Boolean),
      migrationRepairs,
      evidence: {
        credential: evidenceResult?.credential ?? null,
        credentialRecord,
        comparisonDigest: evidenceResult?.comparisonDigest ?? null,
        issuer: evidenceResult?.issuer ?? null,
        resolvedFrom: evidenceResult?.resolvedFrom ?? null,
        left: evidenceResult?.left ?? null,
        right: evidenceResult?.right ?? null,
        comparison: evidenceResult?.comparison ?? null,
      },
    };
  }

  return {
    comparison: {
      summary: comparisonResult?.comparison?.summary ?? null,
      comparisonDigest: comparisonResult?.comparisonDigest ?? null,
      migrationDiff: cloneJson(comparisonResult?.comparison?.migrationDiff) ?? null,
      sameAgentId: comparisonResult?.comparison?.sameAgentId ?? null,
      sameDid: comparisonResult?.comparison?.sameDid ?? null,
      sameWalletAddress: comparisonResult?.comparison?.sameWalletAddress ?? null,
      samePolicyType: comparisonResult?.comparison?.samePolicyType ?? null,
      sameThreshold: comparisonResult?.comparison?.sameThreshold ?? null,
      sameSignerSet: comparisonResult?.comparison?.sameSignerSet ?? null,
      sameControllerSet: comparisonResult?.comparison?.sameControllerSet ?? null,
      samePrimaryStatusListId: comparisonResult?.comparison?.samePrimaryStatusListId ?? null,
      sameStatusListRegistry: comparisonResult?.comparison?.sameStatusListRegistry ?? null,
      sameAssetCredits: comparisonResult?.comparison?.sameAssetCredits ?? null,
    },
    comparisonDigest: comparisonResult?.comparisonDigest ?? null,
    repairIds: migrationRepairs.map((repair) => repair.repairId).filter(Boolean),
    migrationRepairs,
    evidence: {
      credential: evidenceResult?.credential ?? null,
      credentialRecord,
      issuer: evidenceResult?.issuer ?? null,
    },
  };
}

export function resolveAgentComparisonAuditPair(
  store,
  {
    leftAgentId = null,
    rightAgentId = null,
    leftDid = null,
    rightDid = null,
    leftWalletAddress = null,
    rightWalletAddress = null,
    leftWindowId = null,
    rightWindowId = null,
  } = {},
  deps = {}
) {
  const resolveAgentReferenceFromStore = requireAgentComparisonDep(deps, "resolveAgentReferenceFromStore");
  const leftResolution = resolveAgentReferenceFromStore(store, {
    agentId: leftAgentId,
    did: leftDid,
    walletAddress: leftWalletAddress,
    windowId: leftWindowId,
  });
  const rightResolution = resolveAgentReferenceFromStore(store, {
    agentId: rightAgentId,
    did: rightDid,
    walletAddress: rightWalletAddress,
    windowId: rightWindowId,
  });

  const comparisonSeed = {
    left: {
      resolvedFrom: leftResolution.reference,
      snapshot: {
        agentId: leftResolution.agent?.agentId ?? null,
        displayName: leftResolution.agent?.displayName ?? null,
        did: leftResolution.agent?.identity?.did ?? null,
      },
    },
    right: {
      resolvedFrom: rightResolution.reference,
      snapshot: {
        agentId: rightResolution.agent?.agentId ?? null,
        displayName: rightResolution.agent?.displayName ?? null,
        did: rightResolution.agent?.identity?.did ?? null,
      },
    },
  };

  return {
    subjectId: buildAgentComparisonSubjectId(comparisonSeed),
    subjectLabel: buildAgentComparisonSubjectLabel(comparisonSeed),
    left: {
      agentId: leftResolution.agent?.agentId ?? null,
      displayName: leftResolution.agent?.displayName ?? null,
      did: leftResolution.agent?.identity?.did ?? null,
      walletAddress: leftResolution.agent?.identity?.walletAddress ?? null,
      resolvedFrom: cloneJson(leftResolution.reference) ?? null,
    },
    right: {
      agentId: rightResolution.agent?.agentId ?? null,
      displayName: rightResolution.agent?.displayName ?? null,
      did: rightResolution.agent?.identity?.did ?? null,
      walletAddress: rightResolution.agent?.identity?.walletAddress ?? null,
      resolvedFrom: cloneJson(rightResolution.reference) ?? null,
    },
  };
}

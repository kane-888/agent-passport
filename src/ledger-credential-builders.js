import {
  buildDidSigningKeyId,
  inferDidAliases,
} from "./identity.js";
import {
  cloneJson,
  createRecordId,
  hashJson,
  normalizeOptionalText,
  normalizeTextList,
  now,
} from "./ledger-core-utils.js";
import {
  DEFAULT_CREDENTIAL_STATUS_ENTRY_TYPE,
  DEFAULT_CREDENTIAL_STATUS_PURPOSE,
  buildLocalCredential,
  resolveAgentDidForMethod,
} from "./ledger-credential-core.js";
import { credentialStatusListId } from "./ledger-credential-status-list.js";
import {
  buildMigrationRepairLinks,
  buildMigrationRepairSummary,
} from "./ledger-repair-links.js";
import { AGENT_PASSPORT_MAIN_AGENT_ID } from "./main-agent-compat.js";
import {
  AGENT_IDENTITY_CREDENTIAL_TYPE,
  AGENT_SNAPSHOT_EVIDENCE_TYPE,
  AUTHORIZATION_RECEIPT_CREDENTIAL_TYPE,
  AUTHORIZATION_TIMELINE_EVIDENCE_TYPE,
  COMPARISON_EVIDENCE_CREDENTIAL_TYPE,
  COMPARISON_EVIDENCE_TYPE,
  MIGRATION_RECEIPT_CREDENTIAL_TYPE,
  MIGRATION_REPAIR_EVIDENCE_TYPE,
} from "./protocol.js";

const DEFAULT_AUTHORIZATION_LIMIT = 50;

function requireCredentialBuilderDep(deps, name) {
  const value = deps?.[name];
  if (typeof value !== "function") {
    throw new Error(`credential builder dependency is required: ${name}`);
  }
  return value;
}

export function buildAgentCredential(store, agent, statusPointer = null, { didMethod = null } = {}, deps = {}) {
  const issuerDid = resolveAgentDidForMethod(store, agent, didMethod);
  if (!issuerDid) {
    throw new Error(`Agent ${agent.agentId} is missing DID`);
  }

  const windows = requireCredentialBuilderDep(deps, "listAgentWindows")(store, agent.agentId);
  const memories = requireCredentialBuilderDep(deps, "listAgentMemories")(store, agent.agentId);
  const inbox = requireCredentialBuilderDep(deps, "listAgentInbox")(store, agent.agentId);
  const outbox = requireCredentialBuilderDep(deps, "listAgentOutbox")(store, agent.agentId);
  const authorizations = requireCredentialBuilderDep(deps, "listAuthorizationProposalViews")(store, {
    agentId: agent.agentId,
    limit: deps.defaultAuthorizationLimit ?? DEFAULT_AUTHORIZATION_LIMIT,
  });
  const issuedAt = now();

  return buildLocalCredential({
    issuerDid,
    verificationMethod: buildDidSigningKeyId(issuerDid),
    credentialType: AGENT_IDENTITY_CREDENTIAL_TYPE,
    issuanceDate: issuedAt,
    chainId: store.chainId,
    ledgerHash: store.lastEventHash ?? null,
    credentialSubject: {
      id: issuerDid,
      agentId: agent.agentId,
      displayName: agent.displayName,
      role: agent.role,
      controller: agent.controller,
      parentAgentId: agent.parentAgentId,
      status: agent.status,
      createdAt: agent.createdAt,
      createdByEventHash: agent.createdByEventHash,
      identity: {
        did: issuerDid,
        didAliases: inferDidAliases(issuerDid, agent.agentId),
        primaryDid: agent.identity?.did ?? issuerDid,
        walletAddress: agent.identity?.walletAddress ?? null,
        walletScheme: agent.identity?.walletScheme ?? null,
        originDid: agent.identity?.originDid ?? null,
        controllers: cloneJson(agent.identity?.controllers || []),
        authorizationPolicy: cloneJson(agent.identity?.authorizationPolicy || null),
      },
      assets: {
        credits: agent.balances?.credits ?? 0,
      },
      snapshot: {
        windowCount: windows.length,
        memoryCount: memories.length,
        inboxCount: inbox.length,
        outboxCount: outbox.length,
        authorizationCount: authorizations.length,
        latestEventHash: store.lastEventHash ?? null,
      },
      related: {
        windows: windows.slice(-5).map((window) => window.windowId),
        memories: memories.slice(-5).map((memory) => memory.memoryId),
        authorizations: authorizations.slice(-5).map((proposal) => proposal.proposalId),
      },
    },
    credentialStatus: {
      id: statusPointer?.statusListEntryId || `${issuerDid}#state`,
      type: DEFAULT_CREDENTIAL_STATUS_ENTRY_TYPE,
      statusPurpose: statusPointer?.statusPurpose || DEFAULT_CREDENTIAL_STATUS_PURPOSE,
      statusListIndex: statusPointer?.statusListIndex ?? null,
      statusListCredential:
        statusPointer?.statusListCredentialId || (statusPointer?.statusListId ? `${statusPointer.statusListId}#credential` : null),
      statusListId: statusPointer?.statusListId || credentialStatusListId(store, issuerDid),
      chainId: store.chainId,
      ledgerHash: store.lastEventHash ?? null,
      agentId: agent.agentId,
      snapshotPurpose: "agentSnapshot",
    },
    evidence: {
      type: AGENT_SNAPSHOT_EVIDENCE_TYPE,
      capturedAt: issuedAt,
      windowIds: windows.map((window) => window.windowId),
      memoryIds: memories.map((memory) => memory.memoryId),
      authorizationIds: authorizations.map((proposal) => proposal.proposalId),
      eventCount: store.events.length,
    },
  });
}

export function buildAuthorizationProposalCredential(store, proposal, statusPointer = null, { didMethod = null } = {}, deps = {}) {
  const authorization = requireCredentialBuilderDep(deps, "buildAuthorizationProposalView")(store, proposal);
  const policyAgent = requireCredentialBuilderDep(deps, "ensureAgent")(store, authorization.policyAgentId);
  const issuerDid = resolveAgentDidForMethod(store, policyAgent, didMethod);
  if (!issuerDid) {
    throw new Error(`Policy agent ${policyAgent.agentId} is missing DID`);
  }

  const issuedAt = authorization.updatedAt || authorization.createdAt || now();

  return buildLocalCredential({
    issuerDid,
    verificationMethod: buildDidSigningKeyId(issuerDid),
    credentialType: AUTHORIZATION_RECEIPT_CREDENTIAL_TYPE,
    issuanceDate: issuedAt,
    chainId: store.chainId,
    ledgerHash: store.lastEventHash ?? null,
    credentialSubject: {
      id: authorization.proposalId,
      proposalId: authorization.proposalId,
      policyAgentId: authorization.policyAgentId,
      policyDid: issuerDid,
      policyDidAliases: inferDidAliases(issuerDid, policyAgent.agentId),
      actionType: authorization.actionType,
      title: authorization.title,
      description: authorization.description,
      status: authorization.status,
      createdAt: authorization.createdAt,
      updatedAt: authorization.updatedAt,
      availableAt: authorization.availableAt,
      expiresAt: authorization.expiresAt,
      createdBy: {
        agentId: authorization.createdByAgentId ?? null,
        label: authorization.createdByLabel ?? null,
        did: authorization.createdByDid ?? null,
        walletAddress: authorization.createdByWalletAddress ?? null,
        windowId: authorization.createdByWindowId ?? null,
      },
      executedBy: {
        agentId: authorization.executedByAgentId ?? null,
        label: authorization.executedByLabel ?? null,
        did: authorization.executedByDid ?? null,
        walletAddress: authorization.executedByWalletAddress ?? null,
        windowId: authorization.executedByWindowId ?? null,
      },
      revokedBy: {
        agentId: authorization.revokedByAgentId ?? null,
        label: authorization.revokedByLabel ?? null,
        did: authorization.revokedByDid ?? null,
        walletAddress: authorization.revokedByWalletAddress ?? null,
        windowId: authorization.revokedByWindowId ?? null,
      },
      threshold: authorization.threshold,
      signerCount: authorization.signerCount,
      approvalCount: authorization.approvalCount,
      signatureCount: authorization.signatureCount,
      latestSignatureAt: authorization.latestSignatureAt,
      timelineCount: authorization.timelineCount,
      latestTimelineAt: authorization.latestTimelineAt,
      executionResult: cloneJson(authorization.executionResult),
      executionReceipt: cloneJson(authorization.executionReceipt),
      relatedAgentIds: cloneJson(authorization.relatedAgentIds || []),
    },
    credentialStatus: {
      id: statusPointer?.statusListEntryId || `${authorization.proposalId}#state`,
      type: DEFAULT_CREDENTIAL_STATUS_ENTRY_TYPE,
      statusPurpose: statusPointer?.statusPurpose || DEFAULT_CREDENTIAL_STATUS_PURPOSE,
      statusListIndex: statusPointer?.statusListIndex ?? null,
      statusListCredential:
        statusPointer?.statusListCredentialId || (statusPointer?.statusListId ? `${statusPointer.statusListId}#credential` : null),
      statusListId: statusPointer?.statusListId || credentialStatusListId(store, issuerDid),
      chainId: store.chainId,
      ledgerHash: store.lastEventHash ?? null,
      proposalStatus: authorization.status,
      proposalId: authorization.proposalId,
      snapshotPurpose: "proposalLifecycle",
    },
    evidence: {
      type: AUTHORIZATION_TIMELINE_EVIDENCE_TYPE,
      timeline: cloneJson(authorization.timeline || []),
      signatures: cloneJson(authorization.signatures || []),
      executionReceipt: cloneJson(authorization.executionReceipt || null),
    },
  });
}

export function buildAgentComparisonEvidenceCredential(
  store,
  comparisonResult,
  {
    issuerAgentId = AGENT_PASSPORT_MAIN_AGENT_ID,
    issuerDid = null,
    issuerDidMethod = null,
    issuerWalletAddress = null,
    statusPointer = null,
  } = {},
  deps = {}
) {
  const resolvedIssuerAgentId = normalizeOptionalText(issuerAgentId);
  const requestedIssuerDid = normalizeOptionalText(issuerDid) ?? null;
  const issuerResolution = requireCredentialBuilderDep(deps, "resolveAgentReferenceFromStore")(store, {
    agentId: resolvedIssuerAgentId || (!requestedIssuerDid && !normalizeOptionalText(issuerWalletAddress) ? AGENT_PASSPORT_MAIN_AGENT_ID : null),
    did: requestedIssuerDid,
    walletAddress: normalizeOptionalText(issuerWalletAddress) ?? null,
  });
  const issuerAgent = issuerResolution.agent;
  const resolvedIssuerDid = requestedIssuerDid || resolveAgentDidForMethod(store, issuerAgent, issuerDidMethod);
  const issuedAt = now();
  const comparisonDigest =
    comparisonResult?.comparisonDigest ||
    hashJson({
      chainId: store.chainId,
      left: comparisonResult?.left?.snapshot ?? null,
      right: comparisonResult?.right?.snapshot ?? null,
      comparison: comparisonResult?.comparison ?? null,
    });
  const evidence = {
    type: COMPARISON_EVIDENCE_TYPE,
    chainId: store.chainId,
    issuerAgentId: issuerAgent.agentId,
    issuerDid: resolvedIssuerDid,
    issuedAt,
    comparisonDigest,
    left: comparisonResult?.left?.snapshot ?? null,
    right: comparisonResult?.right?.snapshot ?? null,
    comparison: {
      summary: comparisonResult?.comparison?.summary ?? null,
      migrationDiff: cloneJson(comparisonResult?.comparison?.migrationDiff) ?? null,
      sameAgentId: comparisonResult?.comparison?.sameAgentId ?? null,
      sameDid: comparisonResult?.comparison?.sameDid ?? null,
      sameWalletAddress: comparisonResult?.comparison?.sameWalletAddress ?? null,
      sameOriginDid: comparisonResult?.comparison?.sameOriginDid ?? null,
      sameRole: comparisonResult?.comparison?.sameRole ?? null,
      samePolicyType: comparisonResult?.comparison?.samePolicyType ?? null,
      sameThreshold: comparisonResult?.comparison?.sameThreshold ?? null,
      sameSignerSet: comparisonResult?.comparison?.sameSignerSet ?? null,
      sameControllerSet: comparisonResult?.comparison?.sameControllerSet ?? null,
      samePrimaryStatusListId: comparisonResult?.comparison?.samePrimaryStatusListId ?? null,
      samePrimaryStatusListCredentialId: comparisonResult?.comparison?.samePrimaryStatusListCredentialId ?? null,
      sameStatusListRegistry: comparisonResult?.comparison?.sameStatusListRegistry ?? null,
      sameStatusListCount: comparisonResult?.comparison?.sameStatusListCount ?? null,
      sameAssetCredits: comparisonResult?.comparison?.sameAssetCredits ?? null,
      sameWindowCount: comparisonResult?.comparison?.sameWindowCount ?? null,
      sameMemoryCount: comparisonResult?.comparison?.sameMemoryCount ?? null,
      sameInboxCount: comparisonResult?.comparison?.sameInboxCount ?? null,
      sameOutboxCount: comparisonResult?.comparison?.sameOutboxCount ?? null,
      sameAuthorizationCount: comparisonResult?.comparison?.sameAuthorizationCount ?? null,
      sameCredentialCount: comparisonResult?.comparison?.sameCredentialCount ?? null,
      leftCounts: cloneJson(comparisonResult?.comparison?.leftCounts) ?? null,
      rightCounts: cloneJson(comparisonResult?.comparison?.rightCounts) ?? null,
      leftStatusListIds: cloneJson(comparisonResult?.comparison?.leftStatusListIds) ?? [],
      rightStatusListIds: cloneJson(comparisonResult?.comparison?.rightStatusListIds) ?? [],
      sharedStatusListIds: cloneJson(comparisonResult?.comparison?.sharedStatusListIds) ?? [],
      leftOnlyStatusListIds: cloneJson(comparisonResult?.comparison?.leftOnlyStatusListIds) ?? [],
      rightOnlyStatusListIds: cloneJson(comparisonResult?.comparison?.rightOnlyStatusListIds) ?? [],
    },
    resolvedFrom: {
      left: cloneJson(comparisonResult?.left?.resolvedFrom) ?? null,
      right: cloneJson(comparisonResult?.right?.resolvedFrom) ?? null,
    },
  };

  const credential = buildLocalCredential({
    issuerDid: resolvedIssuerDid,
    verificationMethod: buildDidSigningKeyId(resolvedIssuerDid),
    credentialType: COMPARISON_EVIDENCE_CREDENTIAL_TYPE,
    issuanceDate: issuedAt,
    chainId: store.chainId,
    ledgerHash: store.lastEventHash ?? null,
    credentialSubject: {
      id: `urn:agentpassport:agent-comparison:${comparisonDigest.slice(0, 16)}`,
      comparisonId: comparisonDigest.slice(0, 16),
      comparisonDigest,
      issuerAgentId: issuerAgent.agentId,
      issuerDid: resolvedIssuerDid,
      issuerDidAliases: inferDidAliases(resolvedIssuerDid, issuerAgent.agentId),
      generatedAt: issuedAt,
      leftAgentId: comparisonResult?.left?.context?.agent?.agentId ?? null,
      rightAgentId: comparisonResult?.right?.context?.agent?.agentId ?? null,
      leftDid: comparisonResult?.left?.context?.identity?.did ?? null,
      rightDid: comparisonResult?.right?.context?.identity?.did ?? null,
      leftWalletAddress: comparisonResult?.left?.context?.identity?.walletAddress ?? null,
      rightWalletAddress: comparisonResult?.right?.context?.identity?.walletAddress ?? null,
      summary: comparisonResult?.comparison?.summary ?? null,
    },
    credentialStatus: {
      id: statusPointer?.statusListEntryId || `urn:agentpassport:agent-comparison:${comparisonDigest.slice(0, 16)}#state`,
      type: DEFAULT_CREDENTIAL_STATUS_ENTRY_TYPE,
      statusPurpose: statusPointer?.statusPurpose || DEFAULT_CREDENTIAL_STATUS_PURPOSE,
      statusListIndex: statusPointer?.statusListIndex ?? null,
      statusListCredential:
        statusPointer?.statusListCredentialId || (statusPointer?.statusListId ? `${statusPointer.statusListId}#credential` : null),
      statusListId: statusPointer?.statusListId || credentialStatusListId(store, resolvedIssuerDid),
      chainId: store.chainId,
      ledgerHash: store.lastEventHash ?? null,
      agentId: issuerAgent.agentId,
      comparisonDigest,
      snapshotPurpose: "comparisonAudit",
    },
    evidence,
  });

  return {
    credential,
    comparisonDigest,
    issuer: {
      agentId: issuerAgent.agentId,
      displayName: issuerAgent.displayName,
      did: resolvedIssuerDid,
      walletAddress: issuerAgent.identity?.walletAddress ?? null,
    },
    left: comparisonResult?.left?.snapshot ?? null,
    right: comparisonResult?.right?.snapshot ?? null,
    comparison: comparisonResult?.comparison ?? null,
    resolvedFrom: evidence.resolvedFrom,
  };
}

export function buildMigrationRepairReceiptCredential(
  store,
  repair,
  { issuerAgentId = null, issuerDid = null, issuerDidMethod = null, statusPointer = null, issuanceDate = null } = {},
  deps = {}
) {
  const resolveDefaultResidentAgentId = requireCredentialBuilderDep(deps, "resolveDefaultResidentAgentId");
  const resolvedIssuerAgent = requireCredentialBuilderDep(deps, "ensureAgent")(
    store,
    normalizeOptionalText(issuerAgentId) || repair.agentId || repair.issuerAgentId || resolveDefaultResidentAgentId(store)
  );
  const resolvedIssuerDid = normalizeOptionalText(issuerDid) || resolveAgentDidForMethod(store, resolvedIssuerAgent, issuerDidMethod);
  const issuedAt = normalizeOptionalText(issuanceDate) || now();
  const repairId = normalizeOptionalText(repair.repairId) || createRecordId("repair");
  const summary = normalizeOptionalText(repair.summary) || buildMigrationRepairSummary(repair);
  const links = buildMigrationRepairLinks(repair);

  return buildLocalCredential({
    issuerDid: resolvedIssuerDid,
    verificationMethod: buildDidSigningKeyId(resolvedIssuerDid),
    credentialType: MIGRATION_RECEIPT_CREDENTIAL_TYPE,
    issuanceDate: issuedAt,
    chainId: store.chainId,
    ledgerHash: store.lastEventHash ?? null,
    credentialSubject: {
      id: `urn:agentpassport:migration-repair:${repairId}`,
      repairId,
      scope: normalizeOptionalText(repair.scope) ?? "agent",
      issuerAgentId: resolvedIssuerAgent.agentId,
      issuerDid: resolvedIssuerDid,
      issuerDidAliases: inferDidAliases(resolvedIssuerDid, resolvedIssuerAgent.agentId),
      targetAgentId: normalizeOptionalText(repair.agentId) ?? null,
      generatedAt: issuedAt,
      summary,
      requestedKinds: normalizeTextList(repair.requestedKinds),
      requestedSubjectIds: normalizeTextList(repair.requestedSubjectIds),
      requestedDidMethods: normalizeTextList(repair.requestedDidMethods),
      selectedSubjectCount: repair.selectedSubjectCount ?? 0,
      selectedPairCount: repair.selectedPairCount ?? 0,
      plannedRepairCount: repair.plannedRepairCount ?? 0,
      repairedCount: repair.repairedCount ?? 0,
      skippedCount: repair.skippedCount ?? 0,
      links,
    },
    credentialStatus: {
      id: statusPointer?.statusListEntryId || `urn:agentpassport:migration-repair:${repairId}#state`,
      type: DEFAULT_CREDENTIAL_STATUS_ENTRY_TYPE,
      statusPurpose: statusPointer?.statusPurpose || DEFAULT_CREDENTIAL_STATUS_PURPOSE,
      statusListIndex: statusPointer?.statusListIndex ?? null,
      statusListCredential:
        statusPointer?.statusListCredentialId || (statusPointer?.statusListId ? `${statusPointer.statusListId}#credential` : null),
      statusListId: statusPointer?.statusListId || credentialStatusListId(store, resolvedIssuerDid),
      chainId: store.chainId,
      ledgerHash: store.lastEventHash ?? null,
      agentId: resolvedIssuerAgent.agentId,
      repairId,
      snapshotPurpose: "migrationRepair",
    },
    evidence: {
      type: MIGRATION_REPAIR_EVIDENCE_TYPE,
      repairId,
      scope: normalizeOptionalText(repair.scope) ?? "agent",
      summary,
      requestedKinds: cloneJson(repair.requestedKinds) ?? [],
      requestedSubjectIds: cloneJson(repair.requestedSubjectIds) ?? [],
      requestedDidMethods: cloneJson(repair.requestedDidMethods) ?? [],
      comparisonPairs: cloneJson(repair.comparisonPairs) ?? [],
      plan: cloneJson(repair.plan) ?? [],
      repaired: cloneJson(repair.repaired) ?? [],
      skipped: cloneJson(repair.skipped) ?? [],
      beforeCoverage: cloneJson(repair.beforeCoverage) ?? null,
      afterCoverage: cloneJson(repair.afterCoverage) ?? null,
      links,
    },
  });
}

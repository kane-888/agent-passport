import {
  createAttributionHttpProbe,
  getJson,
  postJson,
  shutdownAttributionProbeServer,
} from "./attribution-http-probe-shared.mjs";
import { assert } from "./smoke-shared.mjs";
import {
  AGENT_PASSPORT_MAIN_AGENT_ID,
  LEGACY_OPENNEED_AGENT_ID,
} from "../src/main-agent-compat.js";

function latestTimelineEntry(timeline = [], kind) {
  return Array.isArray(timeline)
    ? timeline.filter((entry) => entry?.kind === kind).at(-1) || null
    : null;
}

function findActiveCredential(credentialsPayload = null) {
  return Array.isArray(credentialsPayload?.credentials)
    ? credentialsPayload.credentials.find((entry) => entry?.status === "active" && entry?.credentialId) || null
    : null;
}

function resolvePolicyApprovalInputs(agentPayload = null, { requestedAgentId = null } = {}) {
  const signers = Array.isArray(agentPayload?.agent?.identity?.authorizationPolicy?.signers)
    ? agentPayload.agent.identity.authorizationPolicy.signers
    : [];
  const thresholdValue = Number(agentPayload?.agent?.identity?.authorizationPolicy?.threshold);
  const threshold = Number.isFinite(thresholdValue) && thresholdValue > 0 ? Math.floor(thresholdValue) : 1;
  const resolvedSigners = signers
    .map((signer) => {
      const signerLabel = typeof signer?.label === "string" && signer.label.trim()
        ? signer.label.trim()
        : null;
      const walletAddress = typeof signer?.walletAddress === "string" && signer.walletAddress.trim()
        ? signer.walletAddress.trim().toLowerCase()
        : null;
      const approvalInput = walletAddress || signerLabel;
      return approvalInput
        ? {
            approvalInput,
            signerLabel: signerLabel || walletAddress,
            walletAddress,
          }
        : null;
    })
    .filter(Boolean);
  const policyAgentId = agentPayload?.agent?.agentId || requestedAgentId || AGENT_PASSPORT_MAIN_AGENT_ID;
  assert(
    resolvedSigners.length >= threshold,
    `${requestedAgentId || AGENT_PASSPORT_MAIN_AGENT_ID} -> ${policyAgentId} policy signers 不足以满足 threshold=${threshold}`
  );
  return {
    threshold,
    requiredSigners: resolvedSigners.slice(0, threshold),
  };
}

function assertNullAttribution(value, label) {
  assert(value == null, `${label} 应该为空，但收到 ${JSON.stringify(value)}`);
}

const probe = await createAttributionHttpProbe("record-route-attribution-http");
const {
  baseUrl,
  ledgerPath,
  storeKeyPath,
  signingSecretPath,
  recoveryDir,
  archiveDir,
  setupPackageDir,
} = probe;
let server = null;

try {
  server = await probe.startServer();
  const adminFetch = probe.adminFetch;
  const requestedAgentId = AGENT_PASSPORT_MAIN_AGENT_ID;
  const agentProfile = await getJson(
    adminFetch,
    `/api/agents/${requestedAgentId}`
  );
  const physicalOwnerAgentId = agentProfile?.agent?.agentId || requestedAgentId;
  const legacyAgentProfile = await getJson(
    adminFetch,
    `/api/agents/${LEGACY_OPENNEED_AGENT_ID}`
  );
  assert(
    legacyAgentProfile?.agent?.agentId === physicalOwnerAgentId,
    "legacy main-agent alias 应继续解析到当前 physical owner"
  );
  const policyApprovals = resolvePolicyApprovalInputs(agentProfile, { requestedAgentId });
  const requiredApprovalInputs = policyApprovals.requiredSigners.map((entry) => entry.approvalInput);
  const primaryApproval = policyApprovals.requiredSigners[0];
  const remainingApprovalInputs = policyApprovals.requiredSigners
    .slice(1)
    .map((entry) => entry.approvalInput);

  const credentials = await getJson(
    adminFetch,
    `/api/credentials?agentId=${encodeURIComponent(requestedAgentId)}&limit=20`
  );
  let activeCredential = findActiveCredential(credentials);
  if (!activeCredential) {
    const seededComparison = await postJson(
      adminFetch,
      "/api/agents/compare/evidence"
        + `?leftAgentId=${encodeURIComponent(requestedAgentId)}`
        + "&rightAgentId=agent_treasury"
        + `&issuerAgentId=${encodeURIComponent(requestedAgentId)}`
        + "&issuerDidMethod=agentpassport",
      {
        persist: true,
        issuerDidMethod: "agentpassport",
      },
      200
    );
    assert(
      seededComparison?.evidence?.credentialRecord?.credentialId ||
        seededComparison?.variants?.some((entry) => entry?.evidence?.credentialRecord?.credentialId),
      "compare evidence persist 未生成可用 credential"
    );
    const reseededCredentials = await getJson(
      adminFetch,
      `/api/credentials?agentId=${encodeURIComponent(requestedAgentId)}&limit=20`
    );
    activeCredential = findActiveCredential(reseededCredentials);
  }
  assert(activeCredential?.credentialId, "缺少可用的 active credential 用于 revoke 验证");

  const revokedCredential = await postJson(
    adminFetch,
    `/api/credentials/${encodeURIComponent(activeCredential.credentialId)}/revoke`,
    {
      reason: "record-route-actor-attribution-probe",
      note: "credential revoke should ignore forged actor fields",
      revokedBy: "Mallory",
      revokedByAgentId: "agent_treasury",
      revokedByDid: "did:agentpassport:forged:mallory",
      revokedByWalletAddress: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      revokedByWindowId: "window_record_route_forged_credential_revoke",
    },
    200
  );
  assertNullAttribution(
    revokedCredential.credentialRecord?.revokedByAgentId,
    "credential revoke response.revokedByAgentId"
  );
  assertNullAttribution(
    revokedCredential.credentialRecord?.revokedByWindowId,
    "credential revoke response.revokedByWindowId"
  );
  const revokedCredentialTimeline = await getJson(
    adminFetch,
    `/api/credentials/${encodeURIComponent(activeCredential.credentialId)}/timeline`
  );
  const credentialRevokedEntry = latestTimelineEntry(
    revokedCredentialTimeline.timeline,
    "credential_revoked"
  );
  assertNullAttribution(
    credentialRevokedEntry?.actorAgentId,
    "credential revoke timeline.actorAgentId"
  );
  assertNullAttribution(
    credentialRevokedEntry?.actorWindowId,
    "credential revoke timeline.actorWindowId"
  );

  const createdAuthorizationEnvelope = await postJson(
    adminFetch,
    "/api/authorizations",
    {
      policyAgentId: requestedAgentId,
      actionType: "grant_asset",
      title: "record-route-create-attribution-probe",
      description: "authorization create should keep approvals while dropping forged actor attribution",
      payload: {
        fromAgentId: requestedAgentId,
        targetAgentId: "agent_treasury",
        amount: 1,
        assetType: "credits",
        reason: "create route attribution probe",
      },
      approvals: requiredApprovalInputs,
      delaySeconds: 0,
      expiresInSeconds: 600,
      createdBy: "Mallory",
      createdByAgentId: "agent_treasury",
      createdByWindowId: "window_record_route_forged_authorization_create",
      createdByDid: "did:agentpassport:forged:mallory",
      createdByWalletAddress: "0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed",
      sourceWindowId: "window_record_route_source_create",
    },
    201
  );
  const createdAuthorization = createdAuthorizationEnvelope.authorization;
  assert(createdAuthorization?.proposalId, "authorization create 缺少 proposalId");
  assert(
    createdAuthorization.approvalCount === requiredApprovalInputs.length,
    "authorization create 应保留基于当前 policy 的 approvals 语义"
  );
  assert(
    createdAuthorization.canExecute === true && createdAuthorization.status === "ready",
    "authorization create 应在 delaySeconds=0 且满足当前 threshold 后进入 ready"
  );
  assertNullAttribution(
    createdAuthorization.createdByAgentId,
    "authorization create response.createdByAgentId"
  );
  assertNullAttribution(
    createdAuthorization.createdByLabel,
    "authorization create response.createdByLabel"
  );
  assertNullAttribution(
    createdAuthorization.createdByWindowId,
    "authorization create response.createdByWindowId"
  );
  assert(
    Array.isArray(createdAuthorization.signatureRecords) &&
      createdAuthorization.signatureRecords.length === requiredApprovalInputs.length,
    "authorization create 应写入与有效 approvals 数量一致的签名记录"
  );
  assert(
    createdAuthorization.signatureRecords.every(
      (record) => record?.recordedByAgentId === physicalOwnerAgentId
    ),
    "authorization create 的签名记录 recordedByAgentId 应回退为当前 physical owner，而不是 body 伪造值"
  );
  assert(
    createdAuthorization.signatureRecords.every(
      (record) => record?.recordedByWindowId == null
    ),
    "authorization create 的签名记录不应保留 body 伪造 recordedByWindowId"
  );
  const createdAuthorizationTimeline = await getJson(
    adminFetch,
    `/api/authorizations/${encodeURIComponent(createdAuthorization.proposalId)}/timeline`
  );
  const proposalCreatedEntry = latestTimelineEntry(
    createdAuthorizationTimeline.timeline,
    "proposal_created"
  );
  assertNullAttribution(
    proposalCreatedEntry?.actorAgentId,
    "authorization create timeline.actorAgentId"
  );
  assertNullAttribution(
    proposalCreatedEntry?.actorWindowId,
    "authorization create timeline.actorWindowId"
  );

  const signProbeEnvelope = await postJson(
    adminFetch,
    "/api/authorizations",
    {
      policyAgentId: requestedAgentId,
      actionType: "grant_asset",
      title: "record-route-sign-execute-probe",
      description: "authorization sign/execute should keep approvals while dropping forged actor attribution",
      payload: {
        fromAgentId: requestedAgentId,
        targetAgentId: "agent_treasury",
        amount: 1,
        assetType: "credits",
        reason: "sign execute attribution probe",
      },
      delaySeconds: 0,
      expiresInSeconds: 600,
    },
    201
  );
  const signProbeId = signProbeEnvelope.authorization?.proposalId;
  assert(signProbeId, "authorization sign probe 创建失败");

  const signedAuthorizationEnvelope = await postJson(
    adminFetch,
    `/api/authorizations/${encodeURIComponent(signProbeId)}/sign`,
    {
      approvedBy: primaryApproval.approvalInput,
      signedBy: "Mallory",
      recordedByAgentId: "agent_treasury",
      recordedByLabel: "Mallory",
      recordedByDid: "did:agentpassport:forged:mallory",
      recordedByWalletAddress: "0x1111111111111111111111111111111111111111",
      recordedByWindowId: "window_record_route_forged_authorization_sign",
      signedWindowId: "window_record_route_forged_authorization_sign_alias",
    },
    200
  );
  const signedAuthorization = signedAuthorizationEnvelope.authorization;
  assert(signedAuthorization.approvalCount === 1, "authorization sign 应保留首个有效 approval");
  assertNullAttribution(
    signedAuthorization.lastSignedByAgentId,
    "authorization sign response.lastSignedByAgentId"
  );
  assertNullAttribution(
    signedAuthorization.lastSignedByLabel,
    "authorization sign response.lastSignedByLabel"
  );
  assertNullAttribution(
    signedAuthorization.lastSignedWindowId,
    "authorization sign response.lastSignedWindowId"
  );
  const latestSignedRecord = Array.isArray(signedAuthorization.signatureRecords)
    ? signedAuthorization.signatureRecords.at(-1)
    : null;
  assert(latestSignedRecord?.signerLabel === primaryApproval.signerLabel, "authorization sign 应保留 signerLabel");
  assertNullAttribution(
    latestSignedRecord?.recordedByAgentId,
    "authorization sign signature.recordedByAgentId"
  );
  assertNullAttribution(
    latestSignedRecord?.recordedByWindowId,
    "authorization sign signature.recordedByWindowId"
  );
  const signedAuthorizationTimeline = await getJson(
    adminFetch,
    `/api/authorizations/${encodeURIComponent(signProbeId)}/timeline`
  );
  const proposalSignatureEntry = latestTimelineEntry(
    signedAuthorizationTimeline.timeline,
    "proposal_signature"
  );
  assert(proposalSignatureEntry?.actorLabel === "Kane", "authorization sign timeline 应显示真实 signer");
  assertNullAttribution(
    proposalSignatureEntry?.actorAgentId,
    "authorization sign timeline.actorAgentId"
  );
  assertNullAttribution(
    proposalSignatureEntry?.actorWindowId,
    "authorization sign timeline.actorWindowId"
  );

  const executedAuthorizationEnvelope = await postJson(
    adminFetch,
    `/api/authorizations/${encodeURIComponent(signProbeId)}/execute`,
    {
      approvals: remainingApprovalInputs,
      executedBy: "Mallory",
      executedByAgentId: "agent_treasury",
      executedByLabel: "Mallory",
      executedByWindowId: "window_record_route_forged_authorization_execute",
      executedWindowId: "window_record_route_forged_authorization_execute_alias",
    },
    200
  );
  const executedProposal = executedAuthorizationEnvelope.proposal;
  assert(executedProposal?.status === "executed", "authorization execute 应成功落账");
  assert(
    executedProposal.approvalCount === requiredApprovalInputs.length,
    "authorization execute 应保留满足当前 threshold 的 approvals"
  );
  assertNullAttribution(
    executedProposal.executedByAgentId,
    "authorization execute response.executedByAgentId"
  );
  assertNullAttribution(
    executedProposal.executedByLabel,
    "authorization execute response.executedByLabel"
  );
  assertNullAttribution(
    executedProposal.executedByWindowId,
    "authorization execute response.executedByWindowId"
  );
  assertNullAttribution(
    executedProposal.executionReceipt?.executorAgentId,
    "authorization execute receipt.executorAgentId"
  );
  assertNullAttribution(
    executedProposal.executionReceipt?.executorWindowId,
    "authorization execute receipt.executorWindowId"
  );
  const executedAuthorizationTimeline = await getJson(
    adminFetch,
    `/api/authorizations/${encodeURIComponent(signProbeId)}/timeline`
  );
  const proposalExecutedEntry = latestTimelineEntry(
    executedAuthorizationTimeline.timeline,
    "proposal_executed"
  );
  assertNullAttribution(
    proposalExecutedEntry?.actorAgentId,
    "authorization execute timeline.actorAgentId"
  );
  assertNullAttribution(
    proposalExecutedEntry?.actorWindowId,
    "authorization execute timeline.actorWindowId"
  );

  const revokeProbeEnvelope = await postJson(
    adminFetch,
    "/api/authorizations",
    {
      policyAgentId: requestedAgentId,
      actionType: "grant_asset",
      title: "record-route-revoke-probe",
      description: "authorization revoke should keep approvals while dropping forged actor attribution",
      payload: {
        fromAgentId: requestedAgentId,
        targetAgentId: "agent_treasury",
        amount: 1,
        assetType: "credits",
        reason: "revoke attribution probe",
      },
      delaySeconds: 0,
      expiresInSeconds: 600,
    },
    201
  );
  const revokeProbeId = revokeProbeEnvelope.authorization?.proposalId;
  assert(revokeProbeId, "authorization revoke probe 创建失败");

  const revokedAuthorizationEnvelope = await postJson(
    adminFetch,
    `/api/authorizations/${encodeURIComponent(revokeProbeId)}/revoke`,
    {
      approvals: requiredApprovalInputs,
      revokedBy: "Mallory",
      revokedByAgentId: "agent_treasury",
      revokedByLabel: "Mallory",
      revokedByDid: "did:agentpassport:forged:mallory",
      revokedByWalletAddress: "0x2222222222222222222222222222222222222222",
      revokedByWindowId: "window_record_route_forged_authorization_revoke",
    },
    200
  );
  const revokedAuthorization = revokedAuthorizationEnvelope.authorization;
  assert(revokedAuthorization?.status === "revoked", "authorization revoke 应成功");
  assert(
    revokedAuthorization.approvalCount === requiredApprovalInputs.length,
    "authorization revoke 应保留满足当前 threshold 的 approvals"
  );
  assertNullAttribution(
    revokedAuthorization.revokedByAgentId,
    "authorization revoke response.revokedByAgentId"
  );
  assertNullAttribution(
    revokedAuthorization.revokedByLabel,
    "authorization revoke response.revokedByLabel"
  );
  assertNullAttribution(
    revokedAuthorization.revokedByWindowId,
    "authorization revoke response.revokedByWindowId"
  );
  const revokedAuthorizationTimeline = await getJson(
    adminFetch,
    `/api/authorizations/${encodeURIComponent(revokeProbeId)}/timeline`
  );
  const proposalRevokedEntry = latestTimelineEntry(
    revokedAuthorizationTimeline.timeline,
    "proposal_revoked"
  );
  assertNullAttribution(
    proposalRevokedEntry?.actorAgentId,
    "authorization revoke timeline.actorAgentId"
  );
  assertNullAttribution(
    proposalRevokedEntry?.actorWindowId,
    "authorization revoke timeline.actorWindowId"
  );

  await shutdownAttributionProbeServer(server);
  server = null;
  Object.assign(process.env, probe.serverEnv);
  const {
    createAuthorizationProposal,
    getAgentComparisonEvidence,
    getAuthorizationProposal,
    getAuthorizationProposalTimeline,
    revokeAuthorizationProposal,
    revokeCredential,
    signAuthorizationProposal,
    executeAuthorizationProposal,
    listCredentials,
  } = await import("../src/ledger.js");

  const reloadedCreatedAuthorization = await getAuthorizationProposal(createdAuthorization.proposalId);
  assertNullAttribution(
    reloadedCreatedAuthorization?.createdByAgentId,
    "authorization create reload.createdByAgentId"
  );
  assertNullAttribution(
    reloadedCreatedAuthorization?.createdByLabel,
    "authorization create reload.createdByLabel"
  );
  assertNullAttribution(
    reloadedCreatedAuthorization?.createdByWindowId,
    "authorization create reload.createdByWindowId"
  );
  const reloadedCreatedTimeline = await getAuthorizationProposalTimeline(createdAuthorization.proposalId);
  const reloadedCreatedEntry = latestTimelineEntry(reloadedCreatedTimeline.timeline, "proposal_created");
  assertNullAttribution(
    reloadedCreatedEntry?.actorAgentId,
    "authorization create reload timeline.actorAgentId"
  );
  assertNullAttribution(
    reloadedCreatedEntry?.actorWindowId,
    "authorization create reload timeline.actorWindowId"
  );

  const reloadedExecutedAuthorization = await getAuthorizationProposal(signProbeId);
  assertNullAttribution(
    reloadedExecutedAuthorization?.executedByAgentId,
    "authorization execute reload.executedByAgentId"
  );
  assertNullAttribution(
    reloadedExecutedAuthorization?.executionReceipt?.executorAgentId,
    "authorization execute reload receipt.executorAgentId"
  );
  assertNullAttribution(
    reloadedExecutedAuthorization?.executionReceipt?.executorWindowId,
    "authorization execute reload receipt.executorWindowId"
  );
  const reloadedExecutedTimeline = await getAuthorizationProposalTimeline(signProbeId);
  const reloadedExecutedEntry = latestTimelineEntry(reloadedExecutedTimeline.timeline, "proposal_executed");
  assertNullAttribution(
    reloadedExecutedEntry?.actorAgentId,
    "authorization execute reload timeline.actorAgentId"
  );
  assertNullAttribution(
    reloadedExecutedEntry?.actorWindowId,
    "authorization execute reload timeline.actorWindowId"
  );

  const reloadedRevokedAuthorization = await getAuthorizationProposal(revokeProbeId);
  assertNullAttribution(
    reloadedRevokedAuthorization?.revokedByAgentId,
    "authorization revoke reload.revokedByAgentId"
  );
  assertNullAttribution(
    reloadedRevokedAuthorization?.revokedByWindowId,
    "authorization revoke reload.revokedByWindowId"
  );
  const reloadedRevokedTimeline = await getAuthorizationProposalTimeline(revokeProbeId);
  const reloadedRevokedEntry = latestTimelineEntry(reloadedRevokedTimeline.timeline, "proposal_revoked");
  assertNullAttribution(
    reloadedRevokedEntry?.actorAgentId,
    "authorization revoke reload timeline.actorAgentId"
  );
  assertNullAttribution(
    reloadedRevokedEntry?.actorWindowId,
    "authorization revoke reload timeline.actorWindowId"
  );

  const coreCreateProbe = await createAuthorizationProposal({
    policyAgentId: requestedAgentId,
    actionType: "grant_asset",
    title: "record-route-direct-core-create-probe",
    payload: {
      fromAgentId: requestedAgentId,
      targetAgentId: requestedAgentId,
      amount: 1,
      assetType: "credits",
      reason: "direct core create probe",
    },
    approvals: requiredApprovalInputs,
    delaySeconds: 0,
    expiresInSeconds: 600,
    createdBy: "agent_treasury",
  });
  assertNullAttribution(
    coreCreateProbe?.createdByAgentId,
    "authorization direct core create.createdByAgentId"
  );
  assertNullAttribution(
    coreCreateProbe?.createdByLabel,
    "authorization direct core create.createdByLabel"
  );
  assert(
    !Array.isArray(coreCreateProbe?.relatedAgentIds) ||
      !coreCreateProbe.relatedAgentIds.includes("agent_treasury"),
    "authorization direct core create 不应因 createdBy 自由文本把 agent_treasury 加入 relatedAgentIds"
  );

  const coreSignBase = await createAuthorizationProposal({
    policyAgentId: requestedAgentId,
    actionType: "grant_asset",
    title: "record-route-direct-core-sign-probe",
    payload: {
      fromAgentId: requestedAgentId,
      targetAgentId: requestedAgentId,
      amount: 1,
      assetType: "credits",
      reason: "direct core sign probe",
    },
    delaySeconds: 0,
    expiresInSeconds: 600,
  });
  const coreSigned = await signAuthorizationProposal(coreSignBase.proposalId, {
    approvedBy: primaryApproval.approvalInput,
    signedBy: "agent_treasury",
  });
  assertNullAttribution(
    coreSigned?.lastSignedByAgentId,
    "authorization direct core sign.lastSignedByAgentId"
  );
  assertNullAttribution(
    coreSigned?.lastSignedByLabel,
    "authorization direct core sign.lastSignedByLabel"
  );

  const coreExecuteBase = await createAuthorizationProposal({
    policyAgentId: requestedAgentId,
    actionType: "grant_asset",
    title: "record-route-direct-core-execute-probe",
    payload: {
      fromAgentId: requestedAgentId,
      targetAgentId: requestedAgentId,
      amount: 1,
      assetType: "credits",
      reason: "direct core execute probe",
    },
    delaySeconds: 0,
    expiresInSeconds: 600,
  });
  await signAuthorizationProposal(coreExecuteBase.proposalId, {
    approvedBy: primaryApproval.approvalInput,
  });
  const coreExecuted = await executeAuthorizationProposal(coreExecuteBase.proposalId, {
    approvals: remainingApprovalInputs,
    executedBy: "agent_treasury",
  });
  assertNullAttribution(
    coreExecuted?.proposal?.executedByAgentId,
    "authorization direct core execute.executedByAgentId"
  );
  assertNullAttribution(
    coreExecuted?.proposal?.executionReceipt?.executorAgentId,
    "authorization direct core execute receipt.executorAgentId"
  );

  const coreRevokeBase = await createAuthorizationProposal({
    policyAgentId: requestedAgentId,
    actionType: "grant_asset",
    title: "record-route-direct-core-revoke-probe",
    payload: {
      fromAgentId: requestedAgentId,
      targetAgentId: requestedAgentId,
      amount: 1,
      assetType: "credits",
      reason: "direct core revoke probe",
    },
    delaySeconds: 0,
    expiresInSeconds: 600,
  });
  const coreRevoked = await revokeAuthorizationProposal(coreRevokeBase.proposalId, {
    approvals: requiredApprovalInputs,
    revokedBy: "agent_treasury",
  });
  assertNullAttribution(
    coreRevoked?.revokedByAgentId,
    "authorization direct core revoke.revokedByAgentId"
  );
  assertNullAttribution(
    coreRevoked?.revokedByLabel,
    "authorization direct core revoke.revokedByLabel"
  );

  const coreCredentialList = await listCredentials({
    agentId: requestedAgentId,
    limit: 20,
  });
  let coreCredential = findActiveCredential(coreCredentialList);
  if (!coreCredential) {
    const seededCoreComparison = await getAgentComparisonEvidence({
      leftAgentId: requestedAgentId,
      rightAgentId: "agent_treasury",
      issuerAgentId: requestedAgentId,
      issuerDidMethod: "agentpassport",
      persist: true,
    });
    assert(
      seededCoreComparison?.evidence?.credentialRecord?.credentialId ||
        seededCoreComparison?.variants?.some((entry) => entry?.evidence?.credentialRecord?.credentialId),
      "direct core compare evidence persist 未生成可用 credential"
    );
    const reseededCoreCredentialList = await listCredentials({
      agentId: requestedAgentId,
      limit: 20,
    });
    coreCredential = findActiveCredential(reseededCoreCredentialList);
  }
  assert(coreCredential?.credentialId, "缺少 direct core revokeCredential probe 可用 credential");
  const coreRevokedCredential = await revokeCredential(coreCredential.credentialId, {
    reason: "direct core revoke credential probe",
    revokedBy: "agent_treasury",
  });
  assertNullAttribution(
    coreRevokedCredential?.credentialRecord?.revokedByAgentId,
    "credential direct core revoke.revokedByAgentId"
  );
  assertNullAttribution(
    coreRevokedCredential?.credentialRecord?.revokedByLabel,
    "credential direct core revoke.revokedByLabel"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        requestedAgentId,
        physicalOwnerAgentId,
        verified: [
          "canonical main-agent route resolves onto the current physical owner",
          "POST /api/credentials/:id/revoke",
          "POST /api/authorizations",
          "POST /api/authorizations/:id/sign",
          "POST /api/authorizations/:id/execute",
          "POST /api/authorizations/:id/revoke",
          "authorization views stay clean after reload",
          "direct ledger calls ignore free-text createdBy/signedBy/executedBy/revokedBy",
        ],
        proposals: {
          create: createdAuthorization.proposalId,
          signExecute: signProbeId,
          revoke: revokeProbeId,
        },
        credentialId: activeCredential.credentialId,
      },
      null,
      2
    )
  );
} catch (error) {
  probe.logServerOutput();
  throw error;
} finally {
  await probe.cleanup(server);
}

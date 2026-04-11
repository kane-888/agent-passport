import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assert, fetchWithRetry, sleep } from "./smoke-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const liveDataDir = path.join(rootDir, "data");

async function copyIfExists(sourcePath, targetPath) {
  try {
    await fs.copyFile(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!Number.isFinite(port)) {
          reject(new Error("Unable to resolve free port"));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServer(baseUrl) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetchWithRetry(
        fetch,
        `${baseUrl}/api/security`,
        {
          headers: {
            Connection: "close",
          },
        },
        "GET /api/security"
      );
      if (response.ok) {
        await response.text();
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
      await response.text().catch(() => {});
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw lastError || new Error("Timed out waiting for server");
}

function buildAdminFetch(baseUrl, adminToken) {
  return async function adminFetch(resourcePath, options = {}) {
    const headers = {
      Connection: "close",
      ...(options.headers || {}),
      Authorization: `Bearer ${adminToken}`,
    };
    return fetchWithRetry(
      fetch,
      `${baseUrl}${resourcePath}`,
      {
        ...options,
        headers,
      },
      `${options.method || "GET"} ${resourcePath}`
    );
  };
}

async function getJson(adminFetch, resourcePath) {
  const response = await adminFetch(resourcePath);
  if (!response.ok) {
    throw new Error(`${resourcePath} -> HTTP ${response.status}`);
  }
  return response.json();
}

async function postJson(adminFetch, resourcePath, payload, expectedStatus) {
  const response = await adminFetch(resourcePath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (response.status !== expectedStatus) {
    const body = await response.text().catch(() => "");
    throw new Error(`${resourcePath} -> expected HTTP ${expectedStatus}, received ${response.status}: ${body}`);
  }
  return response.json();
}

function latestTimelineEntry(timeline = [], kind) {
  return Array.isArray(timeline)
    ? timeline.filter((entry) => entry?.kind === kind).at(-1) || null
    : null;
}

function assertNullAttribution(value, label) {
  assert(value == null, `${label} 应该为空，但收到 ${JSON.stringify(value)}`);
}

async function shutdownServer(server) {
  if (!server || server.exitCode !== null) {
    return;
  }
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    server.once("exit", () => resolve());
    setTimeout(resolve, 1000);
  });
}

const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openneed-record-route-attribution-http-"));
const dataDir = path.join(probeRoot, "data");
const ledgerPath = path.join(dataDir, "ledger.json");
const storeKeyPath = path.join(dataDir, ".ledger-key");
const signingSecretPath = path.join(dataDir, ".did-signing-master-secret");
const recoveryDir = path.join(dataDir, "recovery-bundles");
const archiveDir = path.join(dataDir, "archives");
const setupPackageDir = path.join(dataDir, "device-setup-packages");
const port = await getFreePort();
const adminToken = `probe-${randomBytes(12).toString("hex")}`;
const baseUrl = `http://127.0.0.1:${port}`;

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(recoveryDir, { recursive: true });
await fs.mkdir(archiveDir, { recursive: true });
await fs.mkdir(setupPackageDir, { recursive: true });
await copyIfExists(path.join(liveDataDir, "ledger.json"), ledgerPath);
await copyIfExists(path.join(liveDataDir, ".ledger-key"), storeKeyPath);
await copyIfExists(path.join(liveDataDir, ".did-signing-master-secret"), signingSecretPath);

const serverEnv = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: String(port),
  OPENNEED_LEDGER_PATH: ledgerPath,
  AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
  AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
  AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
  AGENT_PASSPORT_ARCHIVE_DIR: archiveDir,
  AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
  AGENT_PASSPORT_USE_KEYCHAIN: "0",
  AGENT_PASSPORT_ADMIN_TOKEN: adminToken,
};

let serverStdout = "";
let serverStderr = "";
let server = spawn("node", ["src/server.js"], {
  cwd: rootDir,
  env: serverEnv,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout?.on("data", (chunk) => {
  serverStdout += String(chunk);
});
server.stderr?.on("data", (chunk) => {
  serverStderr += String(chunk);
});

try {
  await waitForServer(baseUrl);
  const adminFetch = buildAdminFetch(baseUrl, adminToken);

  const credentials = await getJson(
    adminFetch,
    "/api/credentials?agentId=agent_openneed_agents&limit=20"
  );
  const activeCredential = Array.isArray(credentials.credentials)
    ? credentials.credentials.find((entry) => entry?.status === "active" && entry?.credentialId)
    : null;
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
      policyAgentId: "agent_openneed_agents",
      actionType: "grant_asset",
      title: "record-route-create-attribution-probe",
      description: "authorization create should keep approvals while dropping forged actor attribution",
      payload: {
        fromAgentId: "agent_openneed_agents",
        targetAgentId: "agent_treasury",
        amount: 1,
        assetType: "credits",
        reason: "create route attribution probe",
      },
      approvals: ["Kane", "Alice"],
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
  assert(createdAuthorization.approvalCount === 2, "authorization create 应保留 approvals 语义");
  assert(createdAuthorization.canExecute === true, "authorization create 应在 delaySeconds=0 且双签后进入 ready");
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
      createdAuthorization.signatureRecords.length === 2,
    "authorization create 应写入两条签名记录"
  );
  assert(
    createdAuthorization.signatureRecords.every(
      (record) => record?.recordedByAgentId === "agent_openneed_agents"
    ),
    "authorization create 的签名记录 recordedByAgentId 应回退为 policy agent，而不是 body 伪造值"
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
      policyAgentId: "agent_openneed_agents",
      actionType: "grant_asset",
      title: "record-route-sign-execute-probe",
      description: "authorization sign/execute should keep approvals while dropping forged actor attribution",
      payload: {
        fromAgentId: "agent_openneed_agents",
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
      approvedBy: "Kane",
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
  assert(signedAuthorization.approvalCount === 1, "authorization sign 应保留 approvedBy 语义");
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
  assert(latestSignedRecord?.signerLabel === "Kane", "authorization sign 应保留 signerLabel");
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
      approvedBy: "Alice",
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
  assert(executedProposal.approvalCount === 2, "authorization execute 应保留第二个 approval");
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
      policyAgentId: "agent_openneed_agents",
      actionType: "grant_asset",
      title: "record-route-revoke-probe",
      description: "authorization revoke should keep approvals while dropping forged actor attribution",
      payload: {
        fromAgentId: "agent_openneed_agents",
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
      approvals: ["Kane", "Alice"],
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
  assert(revokedAuthorization.approvalCount === 2, "authorization revoke 应保留 approvals 语义");
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

  await shutdownServer(server);
  server = null;
  Object.assign(process.env, {
    OPENNEED_LEDGER_PATH: ledgerPath,
    AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
    AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
    AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
    AGENT_PASSPORT_ARCHIVE_DIR: archiveDir,
    AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
  });
  const {
    createAuthorizationProposal,
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
    policyAgentId: "agent_openneed_agents",
    actionType: "grant_asset",
    title: "record-route-direct-core-create-probe",
    payload: {
      fromAgentId: "agent_openneed_agents",
      targetAgentId: "agent_openneed_agents",
      amount: 1,
      assetType: "credits",
      reason: "direct core create probe",
    },
    approvals: ["Kane", "Alice"],
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
    policyAgentId: "agent_openneed_agents",
    actionType: "grant_asset",
    title: "record-route-direct-core-sign-probe",
    payload: {
      fromAgentId: "agent_openneed_agents",
      targetAgentId: "agent_openneed_agents",
      amount: 1,
      assetType: "credits",
      reason: "direct core sign probe",
    },
    delaySeconds: 0,
    expiresInSeconds: 600,
  });
  const coreSigned = await signAuthorizationProposal(coreSignBase.proposalId, {
    approvedBy: "Kane",
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
    policyAgentId: "agent_openneed_agents",
    actionType: "grant_asset",
    title: "record-route-direct-core-execute-probe",
    payload: {
      fromAgentId: "agent_openneed_agents",
      targetAgentId: "agent_openneed_agents",
      amount: 1,
      assetType: "credits",
      reason: "direct core execute probe",
    },
    delaySeconds: 0,
    expiresInSeconds: 600,
  });
  await signAuthorizationProposal(coreExecuteBase.proposalId, {
    approvedBy: "Kane",
  });
  const coreExecuted = await executeAuthorizationProposal(coreExecuteBase.proposalId, {
    approvedBy: "Alice",
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
    policyAgentId: "agent_openneed_agents",
    actionType: "grant_asset",
    title: "record-route-direct-core-revoke-probe",
    payload: {
      fromAgentId: "agent_openneed_agents",
      targetAgentId: "agent_openneed_agents",
      amount: 1,
      assetType: "credits",
      reason: "direct core revoke probe",
    },
    delaySeconds: 0,
    expiresInSeconds: 600,
  });
  const coreRevoked = await revokeAuthorizationProposal(coreRevokeBase.proposalId, {
    approvals: ["Kane", "Alice"],
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
    agentId: "agent_openneed_agents",
    limit: 20,
  });
  const coreCredential = Array.isArray(coreCredentialList.credentials)
    ? coreCredentialList.credentials.find((entry) => entry?.status === "active" && entry?.credentialId)
    : null;
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
        verified: [
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
  if (serverStdout.trim()) {
    console.error(serverStdout.trim());
  }
  if (serverStderr.trim()) {
    console.error(serverStderr.trim());
  }
  throw error;
} finally {
  await shutdownServer(server);
  await fs.rm(probeRoot, { recursive: true, force: true });
}

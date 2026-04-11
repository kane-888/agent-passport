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

function listTranscriptEntries(transcriptPayload = null) {
  if (Array.isArray(transcriptPayload?.entries)) {
    return transcriptPayload.entries;
  }
  if (Array.isArray(transcriptPayload?.transcript?.entries)) {
    return transcriptPayload.transcript.entries;
  }
  return [];
}

const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openneed-agent-message-attribution-http-"));
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
const server = spawn("node", ["src/server.js"], {
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
  const windowsPayload = await getJson(adminFetch, "/api/windows");
  const forgedWindow = Array.isArray(windowsPayload.windows)
    ? windowsPayload.windows.find(
        (entry) => entry?.agentId && entry.agentId !== "agent_openneed_agents" && entry?.windowId
      ) || null
    : null;
  const forgedFromAgentId = forgedWindow?.agentId || "agent_treasury";
  const forgedFromWindowId = forgedWindow?.windowId || "window_forged_message_sender";
  const probeToken = `message-probe-${Date.now()}`;

  const delivered = await postJson(
    adminFetch,
    "/api/agents/agent_openneed_agents/messages",
    {
      kind: "message",
      subject: "message attribution probe",
      content: `shared inbox should ignore forged sender ${probeToken}`,
      tags: ["probe", "message-attribution"],
      metadata: {
        probeToken,
      },
      fromAgentId: forgedFromAgentId,
      fromWindowId: forgedFromWindowId,
    },
    201
  );

  assert(delivered.message?.messageId, "message route response 缺少 messageId");
  assert(delivered.message.toAgentId === "agent_openneed_agents", "message route 应仍然投递到目标 agent");
  assert(delivered.message.fromAgentId == null, "message route 不应保留 body 伪造 fromAgentId");
  assert(delivered.message.fromWindowId == null, "message route 不应保留 body 伪造 fromWindowId");

  const targetMessages = await getJson(
    adminFetch,
    "/api/agents/agent_openneed_agents/messages?limit=20"
  );
  const inboxMessage = Array.isArray(targetMessages.inbox)
    ? targetMessages.inbox.find((entry) => entry?.messageId === delivered.message.messageId)
    : null;
  assert(inboxMessage, "目标 agent inbox 应包含新消息");
  assert(inboxMessage.fromAgentId == null, "inbox 视图不应保留 body 伪造 fromAgentId");
  assert(inboxMessage.fromWindowId == null, "inbox 视图不应保留 body 伪造 fromWindowId");

  const forgedSenderMessages = await getJson(
    adminFetch,
    `/api/agents/${encodeURIComponent(forgedFromAgentId)}/messages?limit=20`
  );
  const forgedOutboxHit = Array.isArray(forgedSenderMessages.outbox)
    ? forgedSenderMessages.outbox.find((entry) => entry?.messageId === delivered.message.messageId)
    : null;
  assert(!forgedOutboxHit, "伪造 sender agent 的 outbox 不应出现这条消息");

  const targetTranscript = await getJson(
    adminFetch,
    "/api/agents/agent_openneed_agents/transcript?family=conversation&limit=20"
  );
  const targetTranscriptEntry = listTranscriptEntries(targetTranscript).find(
    (entry) => entry?.sourceMessageId === delivered.message.messageId
  );
  assert(targetTranscriptEntry, "目标 agent transcript 应记录 inbox message");
  assert(
    targetTranscriptEntry.entryType === "message_inbox",
    "目标 agent transcript 应写成 message_inbox"
  );
  assert(
    targetTranscriptEntry.sourceWindowId == null,
    "目标 agent transcript 不应保留 body 伪造 sourceWindowId"
  );

  const forgedSenderTranscript = await getJson(
    adminFetch,
    `/api/agents/${encodeURIComponent(forgedFromAgentId)}/transcript?family=conversation&limit=20`
  );
  const forgedOutboxEntry = listTranscriptEntries(forgedSenderTranscript).find(
    (entry) => entry?.sourceMessageId === delivered.message.messageId
  );
  assert(!forgedOutboxEntry, "伪造 sender agent transcript 不应出现 message_outbox");

  console.log(
    JSON.stringify(
      {
        ok: true,
        verified: [
          "POST /api/agents/:id/messages ignores forged fromAgentId/fromWindowId",
          "target inbox keeps delivery",
          "forged sender outbox/transcript stay clean",
        ],
        messageId: delivered.message.messageId,
        forgedFromAgentId,
        forgedFromWindowId,
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
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    server.once("exit", () => resolve());
    setTimeout(resolve, 1000);
  });
  await fs.rm(probeRoot, { recursive: true, force: true });
}

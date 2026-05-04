import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { toSyncFlushResponse } from "../src/server-offline-chat-routes.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function createIsolatedOfflineChatRouteEnv(label) {
  const isolatedDir = await mkdtemp(path.join(os.tmpdir(), `agent-passport-${label}-`));
  return {
    isolatedDir,
    env: {
      ...process.env,
      AGENT_PASSPORT_LEDGER_PATH: path.join(isolatedDir, "ledger.json"),
      AGENT_PASSPORT_STORE_KEY_PATH: path.join(isolatedDir, ".ledger-key"),
      AGENT_PASSPORT_READ_SESSION_STORE_PATH: path.join(isolatedDir, "read-sessions.json"),
      AGENT_PASSPORT_OFFLINE_SYNC_DIR: path.join(isolatedDir, "offline-sync"),
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_ONLINE_SYNC_ENDPOINT: "",
      AGENT_PASSPORT_OFFLINE_CHAT_PERSONA_READY_CONCURRENCY: "2",
    },
  };
}

function runIsolatedOfflineChatRouteScript(script, env) {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: rootDir,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

test("sync flush route response preserves single-flight and idempotency metadata", () => {
  const response = toSyncFlushResponse({
    status: "delivered",
    pendingCount: 0,
    endpoint: "https://sync.example.test/ingest",
    endpointConfigured: true,
    viewLines: ["最近一次同步已成功送达在线入口。"],
    deliveredCount: 1,
    localReceiptStatus: "recorded",
    localReceiptWarnings: [],
    flushExecution: {
      mode: "shared_inflight",
      joinedInflight: true,
      joinCount: 2,
      startedAt: "2026-04-27T12:00:00.000Z",
      remoteIdempotencyKey: "offline-chat-sync:test-key",
      remoteFetchTimeoutMs: 2500,
      bundleId: "offline_sync_fixture",
    },
    duplicateSyncRisk: false,
    responseStatus: 202,
  });

  assert.deepEqual(response.flushExecution, {
    mode: "shared_inflight",
    joinedInflight: true,
    joinCount: 2,
    startedAt: "2026-04-27T12:00:00.000Z",
    remoteIdempotencyKey: "offline-chat-sync:test-key",
    remoteFetchTimeoutMs: 2500,
    bundleId: "offline_sync_fixture",
  });
});

test("offline chat routes accept canonical direct thread ids and keep runtime ownership truth aligned", async () => {
  const { isolatedDir, env } = await createIsolatedOfflineChatRouteEnv("offline-chat-route");
  try {
    const result = runIsolatedOfflineChatRouteScript(
      `
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = ${JSON.stringify(rootDir)};
const ledger = await import(pathToFileURL(path.join(rootDir, "src", "ledger.js")).href);
const { handleOfflineChatRoutes } = await import(pathToFileURL(path.join(rootDir, "src", "server-offline-chat-routes.js")).href);
const originalFetch = globalThis.fetch;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return "http://127.0.0.1:" + address.port;
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (url.endsWith("/api/tags")) {
    return new Response(JSON.stringify({ models: [{ name: "gemma4:e4b" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.endsWith("/api/chat")) {
    return new Response(JSON.stringify({ message: { content: "ready" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return originalFetch(input, init);
};

try {
  await ledger.loadStore();
  await ledger.configureDeviceRuntime({
    residentAgentId: "agent_openneed_agents",
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });
  await ledger.bootstrapAgentRuntime(
    "agent_openneed_agents",
    {
      displayName: "Legacy Main Route Test",
      role: "runtime agent",
      longTermGoal: "verify canonical offline-chat route contracts",
      currentGoal: "serve direct-thread canonical requests onto one runtime owner",
      currentPlan: ["configure resident owner", "post through canonical route", "read back history"],
      nextAction: "verify route contract",
      claimResidentAgent: true,
      allowResidentRebind: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );
  const runtimeState = await ledger.getDeviceRuntimeState();
  const physicalOwnerId =
    text(runtimeState?.deviceRuntime?.residentAgent?.agentId) ||
    text(runtimeState?.deviceRuntime?.resolvedResidentAgentId) ||
    text(runtimeState?.deviceRuntime?.residentAgentId) ||
    null;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      await handleOfflineChatRoutes({
        req,
        res,
        url,
        pathname: url.pathname,
        segments: url.pathname.split("/").filter(Boolean),
        parseBody: () => parseBody(req),
      });
      if (!res.writableEnded) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
      }
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message || String(error) }));
    }
  });
  const baseUrl = await listen(server);
  try {
    const token = "canonical-route-" + Date.now();
    const postResponse = await fetch(baseUrl + "/api/offline-chat/threads/agent_main/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: token }),
    });
    const postBody = await postResponse.json();
    const historyResponse = await fetch(baseUrl + "/api/offline-chat/threads/agent_main/messages?limit=12");
    const historyBody = await historyResponse.json();
    console.log(JSON.stringify({
      physicalOwnerId,
      postStatus: postResponse.status,
      postThreadId: text(postBody?.threadId),
      postRouteThreadId: text(postBody?.threadView?.routeThreadId),
      postThreadViewThreadId: text(postBody?.threadView?.threadId),
      historyStatus: historyResponse.status,
      historyThreadId: text(historyBody?.threadId),
      historyRouteThreadId: text(historyBody?.threadView?.routeThreadId),
      historyThreadViewThreadId: text(historyBody?.threadView?.threadId),
      historyPersonaAgentId: text(historyBody?.persona?.agent?.agentId),
      historyContainsToken:
        Array.isArray(historyBody?.messages) &&
        historyBody.messages.some((entry) => String(entry?.content || "").includes(token)),
    }));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
} finally {
  globalThis.fetch = originalFetch;
}
      `,
      env
    );

    assert.equal(result.postStatus, 200);
    assert.equal(result.historyStatus, 200);
    assert.equal(result.postRouteThreadId, "agent_main");
    assert.equal(result.historyRouteThreadId, "agent_main");
    assert.equal(result.postThreadId, result.physicalOwnerId);
    assert.equal(result.postThreadViewThreadId, result.physicalOwnerId);
    assert.equal(result.historyThreadId, result.physicalOwnerId);
    assert.equal(result.historyThreadViewThreadId, result.physicalOwnerId);
    assert.equal(result.historyPersonaAgentId, result.physicalOwnerId);
    assert.equal(result.historyContainsToken, true);
  } finally {
    await rm(isolatedDir, { recursive: true, force: true });
  }
});

test("offline chat routes do not auto-claim resident truth after a master orchestrator direct send without a resident binding", async () => {
  const { isolatedDir, env } = await createIsolatedOfflineChatRouteEnv("offline-chat-route-no-resident");
  try {
    const result = runIsolatedOfflineChatRouteScript(
      `
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = ${JSON.stringify(rootDir)};
const ledger = await import(pathToFileURL(path.join(rootDir, "src", "ledger.js")).href);
const offlineChatRuntime = await import(pathToFileURL(path.join(rootDir, "src", "offline-chat-runtime.js")).href);
const { handleOfflineChatRoutes } = await import(pathToFileURL(path.join(rootDir, "src", "server-offline-chat-routes.js")).href);
const originalFetch = globalThis.fetch;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return "http://127.0.0.1:" + address.port;
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (url.endsWith("/api/tags")) {
    return new Response(JSON.stringify({ models: [{ name: "gemma4:e4b" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.endsWith("/api/chat")) {
    return new Response(JSON.stringify({ message: { content: "ready" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return originalFetch(input, init);
};

try {
  await ledger.loadStore();
  const bootstrap = await offlineChatRuntime.getOfflineChatBootstrapPayload({ passive: false });
  const directThread = (bootstrap?.threads || []).find((entry) => entry?.role === "master-orchestrator-agent") || null;
  const beforeRuntime = await ledger.getDeviceRuntimeState();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      await handleOfflineChatRoutes({
        req,
        res,
        url,
        pathname: url.pathname,
        segments: url.pathname.split("/").filter(Boolean),
        parseBody: () => parseBody(req),
      });
      if (!res.writableEnded) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
      }
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message || String(error) }));
    }
  });
  const baseUrl = await listen(server);
  try {
    const token = "no-resident-route-" + Date.now();
    const postResponse = await fetch(baseUrl + "/api/offline-chat/threads/" + encodeURIComponent(directThread.threadId) + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: token }),
    });
    const postBody = await postResponse.json();
    const historyResponse = await fetch(baseUrl + "/api/offline-chat/threads/" + encodeURIComponent(directThread.threadId) + "/messages?limit=12");
    const historyBody = await historyResponse.json();
    const afterRuntime = await ledger.getDeviceRuntimeState();
    console.log(JSON.stringify({
      directThreadId: text(directThread?.threadId),
      directRouteThreadId: text(directThread?.routeThreadId),
      beforeResidentAgentId: text(beforeRuntime?.deviceRuntime?.residentAgentId),
      beforeResidentAgentReference: text(beforeRuntime?.deviceRuntime?.residentAgentReference),
      beforeResolvedResidentAgentId: text(beforeRuntime?.deviceRuntime?.resolvedResidentAgentId),
      postStatus: postResponse.status,
      postThreadId: text(postBody?.threadId),
      postRouteThreadId: text(postBody?.threadView?.routeThreadId),
      postReferenceAgentId: text(postBody?.persona?.agent?.referenceAgentId),
      postResolvedResidentAgentId: text(postBody?.persona?.agent?.resolvedResidentAgentId),
      historyStatus: historyResponse.status,
      historyThreadId: text(historyBody?.threadId),
      historyRouteThreadId: text(historyBody?.threadView?.routeThreadId),
      historyReferenceAgentId: text(historyBody?.persona?.agent?.referenceAgentId),
      historyResolvedResidentAgentId: text(historyBody?.persona?.agent?.resolvedResidentAgentId),
      afterResidentAgentId: text(afterRuntime?.deviceRuntime?.residentAgentId),
      afterResidentAgentReference: text(afterRuntime?.deviceRuntime?.residentAgentReference),
      afterResolvedResidentAgentId: text(afterRuntime?.deviceRuntime?.resolvedResidentAgentId),
      historyContainsToken:
        Array.isArray(historyBody?.messages) &&
        historyBody.messages.some((entry) => String(entry?.content || "").includes(token)),
    }));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
} finally {
  globalThis.fetch = originalFetch;
}
      `,
      env
    );

    assert.equal(result.directRouteThreadId, "");
    assert.equal(result.beforeResidentAgentId, "");
    assert.equal(result.beforeResidentAgentReference, "");
    assert.equal(result.beforeResolvedResidentAgentId, "");
    assert.equal(result.postStatus, 200);
    assert.equal(result.postThreadId, result.directThreadId);
    assert.equal(result.postRouteThreadId, "");
    assert.equal(result.postReferenceAgentId, "");
    assert.equal(result.postResolvedResidentAgentId, "");
    assert.equal(result.historyStatus, 200);
    assert.equal(result.historyThreadId, result.directThreadId);
    assert.equal(result.historyRouteThreadId, "");
    assert.equal(result.historyReferenceAgentId, "");
    assert.equal(result.historyResolvedResidentAgentId, "");
    assert.equal(result.afterResidentAgentId, "");
    assert.equal(result.afterResidentAgentReference, "");
    assert.equal(result.afterResolvedResidentAgentId, "");
    assert.equal(result.historyContainsToken, true);
  } finally {
    await rm(isolatedDir, { recursive: true, force: true });
  }
});

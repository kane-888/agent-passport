import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function createIsolatedLearningRouteEnv(label) {
  const isolatedDir = await mkdtemp(path.join(os.tmpdir(), `agent-passport-${label}-`));
  return {
    isolatedDir,
    env: {
      ...process.env,
      AGENT_PASSPORT_LEDGER_PATH: path.join(isolatedDir, "ledger.json"),
      AGENT_PASSPORT_STORE_KEY_PATH: path.join(isolatedDir, ".ledger-key"),
      AGENT_PASSPORT_READ_SESSION_STORE_PATH: path.join(isolatedDir, "read-sessions.json"),
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
    },
  };
}

function runIsolatedLearningRouteScript(script, env) {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: rootDir,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

test("agent self-learning routes keep preview fail-closed and require explicit execute for apply and revert", async () => {
  const { isolatedDir, env } = await createIsolatedLearningRouteEnv("agent-learning-route");
  try {
    const result = runIsolatedLearningRouteScript(
      `
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = ${JSON.stringify(rootDir)};
const ledger = await import(pathToFileURL(path.join(rootDir, "src", "ledger.js")).href);
const { handleAgentRoutes } = await import(pathToFileURL(path.join(rootDir, "src", "server-agent-routes.js")).href);

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

const agent = await ledger.registerAgent({ displayName: "Learning Route Test" });
const evidenceRef = await ledger.recordEvidenceRef(agent.agentId, {
  kind: "session",
  title: "Grounded session evidence",
  summary: "The user explicitly confirmed this preference in the current session.",
  linkedWindowId: "window-learning-route-001",
  sourceWindowId: "window-learning-route-001",
});

const proposalEnvelope = {
  schema_version: "self-learning-governance-learning-proposal-envelope/v1",
  learningProposal: {
    proposalId: "lp-learning-route-001",
    agentId: agent.agentId,
    namespaceScopeId: "namespace-learning-route-001",
    type: "memory",
    sourceSessionId: "session-learning-route-001",
    sourceRunId: "run-learning-route-001",
    sourceWindowId: "window-learning-route-001",
    evidenceIds: [evidenceRef.evidenceRefId],
    candidate: {
      targetLayer: "semantic",
      summary: "User prefers concise progress updates with explicit next step notes.",
      contentSha256: ${JSON.stringify("a".repeat(64))},
      evidenceKind: "session",
      requestedOperation: "propose_memory",
      targetRecordIds: ["memory-learning-route-001"],
      protectedTarget: false,
      conflictRecordIds: [],
    },
    rationale: "Repeated explicit preference is useful for future context building.",
    sourceType: "reported",
    epistemicStatus: "candidate",
    confidence: 0.88,
    salience: 0.76,
    riskLevel: "low",
    admission: {
      duplicateOf: null,
      conflicts: [],
      scanResult: {
        privacyPassed: true,
        namespacePassed: true,
        protectedMemoryHit: false,
        externalRecallOnly: false,
      },
      decision: "draft",
    },
    status: "draft",
    reviewer: {
      actorId: "admission-controller",
      mode: "auto",
      reviewedAt: "2026-05-02T00:00:00.000Z",
    },
    appliedRecordIds: [],
    rollbackPlan: {
      strategy: "mark_inactive",
      targetRecordIds: ["memory-learning-route-001"],
      checkpointId: "checkpoint-learning-route-001",
    },
    createdAt: "2026-05-02T00:00:00.000Z",
  },
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    await handleAgentRoutes({
      req,
      res,
      url,
      pathname: url.pathname,
      segments: url.pathname.split("/").filter(Boolean),
      parseBody: () => parseBody(req),
      jsonForReadSession: (_res, _access, status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      },
    });
    if (!res.writableEnded) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    }
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

const baseUrl = await listen(server);
try {
  const applyPath = "/api/agents/" + agent.agentId + "/learning/proposals/lp-learning-route-001/apply";
  const revertPath = "/api/agents/" + agent.agentId + "/learning/proposals/lp-learning-route-001/revert";
  const mismatchPath = "/api/agents/" + agent.agentId + "/learning/proposals/lp-route-mismatch/apply";

  const previewResponse = await fetch(baseUrl + applyPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proposalEnvelope }),
  });
  const previewBody = await previewResponse.json();

  const applyResponse = await fetch(baseUrl + applyPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proposalEnvelope, execute: true }),
  });
  const applyBody = await applyResponse.json();

  const revertResponse = await fetch(baseUrl + revertPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proposalEnvelope, execute: true }),
  });
  const revertBody = await revertResponse.json();

  const mismatchResponse = await fetch(baseUrl + mismatchPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proposalEnvelope, execute: true }),
  });
  const mismatchBody = await mismatchResponse.json();

  const finalMemories = await ledger.listPassportMemories(agent.agentId, {
    includeInactive: true,
  });

  console.log(JSON.stringify({
    previewStatus: previewResponse.status,
    previewOnly: previewBody?.learning?.previewOnly === true,
    previewNotCompleted: previewBody?.learning?.completed === false,
    applyStatus: applyResponse.status,
    applyCompleted: applyBody?.learning?.completed === true,
    applyWrittenRecordIds: applyBody?.learning?.records?.writtenRecordIds ?? [],
    revertStatus: revertResponse.status,
    revertCompleted: revertBody?.learning?.completed === true,
    revertRecordIds: revertBody?.learning?.records?.revertedRecordIds ?? [],
    mismatchStatus: mismatchResponse.status,
    mismatchError: text(mismatchBody?.error),
    finalMemoryStatus: finalMemories?.memories?.[0]?.status ?? null,
    finalMemoryId: finalMemories?.memories?.[0]?.passportMemoryId ?? null,
  }));
} finally {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
      `,
      env
    );

    assert.equal(result.previewStatus, 200);
    assert.equal(result.previewOnly, true);
    assert.equal(result.previewNotCompleted, true);
    assert.equal(result.applyStatus, 200);
    assert.equal(result.applyCompleted, true);
    assert.deepEqual(result.applyWrittenRecordIds, ["memory-learning-route-001"]);
    assert.equal(result.revertStatus, 200);
    assert.equal(result.revertCompleted, true);
    assert.deepEqual(result.revertRecordIds, ["memory-learning-route-001"]);
    assert.equal(result.mismatchStatus, 400);
    assert.match(result.mismatchError || "", /proposalId mismatch/u);
    assert.equal(result.finalMemoryStatus, "reverted");
    assert.equal(result.finalMemoryId, "memory-learning-route-001");
  } finally {
    await rm(isolatedDir, { recursive: true, force: true });
  }
});

test("agent self-learning routes fail closed when authoritative protected memory truth blocks the target record", async () => {
  const { isolatedDir, env } = await createIsolatedLearningRouteEnv("agent-learning-route-protected");
  try {
    const result = runIsolatedLearningRouteScript(
      `
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = ${JSON.stringify(rootDir)};
const ledger = await import(pathToFileURL(path.join(rootDir, "src", "ledger.js")).href);
const { handleAgentRoutes } = await import(pathToFileURL(path.join(rootDir, "src", "server-agent-routes.js")).href);

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

const agent = await ledger.registerAgent({ displayName: "Learning Route Protected Test" });
const evidenceRef = await ledger.recordEvidenceRef(agent.agentId, {
  kind: "session",
  title: "Protected memory evidence",
  summary: "The target record is referenced by a protected active anchor.",
  linkedWindowId: "window-learning-route-protected-001",
  sourceWindowId: "window-learning-route-protected-001",
});

await ledger.writePassportMemory(agent.agentId, {
  layer: "semantic",
  kind: "protection_anchor",
  summary: "Protected anchor",
  payload: {
    field: "protection.anchor",
    sourcePassportMemoryId: "memory-learning-route-protected-001",
  },
});

const proposalEnvelope = {
  schema_version: "self-learning-governance-learning-proposal-envelope/v1",
  learningProposal: {
    proposalId: "lp-learning-route-protected-001",
    agentId: agent.agentId,
    namespaceScopeId: "namespace-learning-route-protected-001",
    type: "memory",
    sourceSessionId: "session-learning-route-protected-001",
    sourceRunId: "run-learning-route-protected-001",
    sourceWindowId: "window-learning-route-protected-001",
    evidenceIds: [evidenceRef.evidenceRefId],
    candidate: {
      targetLayer: "semantic",
      summary: "Candidate write should be blocked by protected memory truth.",
      contentSha256: ${JSON.stringify("b".repeat(64))},
      evidenceKind: "session",
      requestedOperation: "propose_memory",
      targetRecordIds: ["memory-learning-route-protected-001"],
      protectedTarget: false,
      conflictRecordIds: [],
    },
    rationale: "This write is intentionally aimed at a protected record id.",
    sourceType: "reported",
    epistemicStatus: "candidate",
    confidence: 0.9,
    salience: 0.8,
    riskLevel: "low",
    admission: {
      duplicateOf: null,
      conflicts: [],
      scanResult: {
        privacyPassed: true,
        namespacePassed: true,
        protectedMemoryHit: false,
        externalRecallOnly: false,
      },
      decision: "draft",
    },
    status: "draft",
    reviewer: {
      actorId: "admission-controller",
      mode: "auto",
      reviewedAt: "2026-05-02T00:00:00.000Z",
    },
    appliedRecordIds: [],
    rollbackPlan: {
      strategy: "mark_inactive",
      targetRecordIds: ["memory-learning-route-protected-001"],
      checkpointId: "checkpoint-learning-route-protected-001",
    },
    createdAt: "2026-05-02T00:00:00.000Z",
  },
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    await handleAgentRoutes({
      req,
      res,
      url,
      pathname: url.pathname,
      segments: url.pathname.split("/").filter(Boolean),
      parseBody: () => parseBody(req),
      jsonForReadSession: (_res, _access, status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      },
    });
    if (!res.writableEnded) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    }
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

const baseUrl = await listen(server);
try {
  const applyPath = "/api/agents/" + agent.agentId + "/learning/proposals/lp-learning-route-protected-001/apply";
  const response = await fetch(baseUrl + applyPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proposalEnvelope, execute: true }),
  });
  const body = await response.json();
  const finalMemories = await ledger.listPassportMemories(agent.agentId, {
    includeInactive: true,
  });

  console.log(JSON.stringify({
    status: response.status,
    blocked: body?.learning?.blocked === true,
    notCompleted: body?.learning?.completed === false,
    decision: body?.learning?.decision ?? null,
    reason: typeof body?.learning?.reason === "string" ? body.learning.reason : "",
    targetRecordPresent: finalMemories?.memories?.some((entry) => entry.passportMemoryId === "memory-learning-route-protected-001") ?? false,
    totalMemoryCount: finalMemories?.memories?.length ?? 0,
  }));
} finally {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
      `,
      env
    );

    assert.equal(result.status, 200);
    assert.equal(result.blocked, true);
    assert.equal(result.notCompleted, true);
    assert.equal(result.decision, "quarantined");
    assert.match(result.reason || "", /protected memory or protected state/u);
    assert.equal(result.targetRecordPresent, false);
    assert.equal(result.totalMemoryCount, 1);
  } finally {
    await rm(isolatedDir, { recursive: true, force: true });
  }
});

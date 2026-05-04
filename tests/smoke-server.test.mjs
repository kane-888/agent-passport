import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  allocateEphemeralLoopbackBaseUrl,
  ensureSmokeServer,
  prepareSmokeDataRoot,
  probeHealth,
} from "../scripts/smoke-server.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForJson(url, { timeoutMs = 5000 } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function withHealthServer(payload, callback) {
  const server = createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("probeHealth can require the owned smoke server id", async () => {
  await withHealthServer({ ok: true, smokeServerId: "owned-smoke" }, async (baseUrl) => {
    assert.equal(await probeHealth(baseUrl), true);
    assert.equal(await probeHealth(baseUrl, { expectedSmokeServerId: "owned-smoke" }), true);
    assert.equal(await probeHealth(baseUrl, { expectedSmokeServerId: "other-smoke" }), false);
  });
});

test("public API HEAD probes use the same route truth as GET without response bodies", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-head-api-test-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    for (const route of ["/api/health", "/api/security"]) {
      const response = await fetch(`${baseUrl}${route}`, { method: "HEAD" });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /application\/json/u);
      assert.equal(body, "");
    }
    const adminToken = fs.readFileSync(prepared.isolationEnv.AGENT_PASSPORT_ADMIN_TOKEN_PATH, "utf8").trim();
    for (const route of ["/api/agents", "/api/device/setup"]) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /application\/json/u);
      assert.equal(body, "");
    }
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("public JavaScript modules are served with module-compatible content type", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-public-js-assets-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    for (const route of [
      "/admin-token-storage-compat.js",
      "/offline-chat-app.js",
      "/operator-decision-canonical.js",
      "/runtime-housekeeping-storage-compat.js",
      "/runtime-truth-client.js",
      "/ui-links.js",
    ]) {
      const response = await fetch(`${baseUrl}${route}`);
      const body = await response.text();

      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type") || "", /application\/javascript/u, route);
      assert.match(body, /\S/u, route);
    }
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("server prefers canonical admin header while keeping legacy header as compatibility fallback", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-admin-header-precedence-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    const adminToken = fs.readFileSync(prepared.isolationEnv.AGENT_PASSPORT_ADMIN_TOKEN_PATH, "utf8").trim();

    const canonicalPreferredResponse = await fetch(`${baseUrl}/api/agents`, {
      headers: {
        "x-agent-passport-admin-token": adminToken,
        "x-openneed-admin-token": "invalid-legacy-token",
      },
    });
    assert.equal(canonicalPreferredResponse.status, 200);

    const legacyFallbackResponse = await fetch(`${baseUrl}/api/agents`, {
      headers: {
        "x-openneed-admin-token": adminToken,
      },
    });
    assert.equal(legacyFallbackResponse.status, 200);
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("isolated smoke data root includes read-session store isolation", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-smoke-server-test-",
  });
  try {
    assert.match(prepared.isolationEnv.AGENT_PASSPORT_LEDGER_PATH, /ledger\.json$/);
    assert.match(prepared.isolationEnv.AGENT_PASSPORT_READ_SESSION_STORE_PATH, /read-sessions\.json$/);
    assert.equal(
      prepared.isolationEnv.AGENT_PASSPORT_READ_SESSION_STORE_PATH.startsWith(
        prepared.isolationEnv.AGENT_PASSPORT_LEDGER_PATH.replace(/ledger\.json$/u, "")
      ),
      true
    );
  } finally {
    await prepared.cleanup();
  }
});

test("health reports an uninitialized local store as not ready", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-health-empty-"));
  const port = await getAvailablePort();
  const child = spawn(process.execPath, [path.join(rootDir, "src", "server.js")], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      AGENT_PASSPORT_LEDGER_PATH: path.join(tmpDir, "ledger.json"),
      AGENT_PASSPORT_READ_SESSION_STORE_PATH: path.join(tmpDir, "read-sessions.json"),
      AGENT_PASSPORT_STORE_KEY_PATH: path.join(tmpDir, ".ledger-key"),
      AGENT_PASSPORT_SIGNING_SECRET_PATH: path.join(tmpDir, ".did-signing-master-secret"),
      AGENT_PASSPORT_RECOVERY_DIR: path.join(tmpDir, "recovery-bundles"),
      AGENT_PASSPORT_SETUP_PACKAGE_DIR: path.join(tmpDir, "device-setup-packages"),
      AGENT_PASSPORT_ARCHIVE_DIR: path.join(tmpDir, "archives"),
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(tmpDir, ".admin-token"),
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
    },
  });
  try {
    const health = await waitForJson(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.ok, false);
    assert.equal(health.ready, false);
    assert.equal(health.localStore?.missingLedger, true);
    assert.equal(fs.existsSync(path.join(tmpDir, "ledger.json")), false, "health must not initialize the ledger");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("close", resolve);
      setTimeout(resolve, 1000);
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("server protected access denials expose stable error classes", () => {
  const source = fs.readFileSync(path.join(rootDir, "src/server.js"), "utf8");
  assert.match(source, /function apiAccessDeniedErrorClass/u);
  assert.match(source, /function apiAccessDeniedStatusCode/u);
  assert.match(source, /scope_mismatch/u);
  assert.match(source, /errorClass:\s*apiAccessDeniedErrorClass\(access,\s*\{\s*needsWriteToken\s*\}\)/u);
  assert.match(source, /errorClass:\s*"write_blocked_by_security_posture"/u);
  assert.match(source, /errorClass:\s*"execution_blocked_by_security_posture"/u);
});

test("server rejects unsupported didMethod inputs instead of coercing them into canonical issuance", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-unsupported-did-method-test-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    const adminToken = fs.readFileSync(prepared.isolationEnv.AGENT_PASSPORT_ADMIN_TOKEN_PATH, "utf8").trim();
    const adminHeaders = {
      Authorization: `Bearer ${adminToken}`,
    };

    const invalidContextResponse = await fetch(`${baseUrl}/api/agents/agent_main/context?didMethod=did:key`, {
      headers: adminHeaders,
    });
    assert.equal(invalidContextResponse.status, 400);
    assert.deepEqual(await invalidContextResponse.json(), {
      error: "Unsupported didMethod: did:key",
    });

    const invalidCompareEvidenceResponse = await fetch(`${baseUrl}/api/agents/compare/evidence`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        leftAgentId: "agent_main",
        rightAgentId: "agent_treasury",
        issuerDidMethod: "did:key",
        persist: false,
      }),
    });
    assert.equal(invalidCompareEvidenceResponse.status, 400);
    assert.deepEqual(await invalidCompareEvidenceResponse.json(), {
      error: "Unsupported issuerDidMethod: did:key",
    });

    const invalidAgentCredentialResponse = await fetch(
      `${baseUrl}/api/agents/agent_main/credential?issueBothMethods=true`,
      {
        headers: adminHeaders,
      }
    );
    assert.equal(invalidAgentCredentialResponse.status, 400);
    assert.deepEqual(await invalidAgentCredentialResponse.json(), {
      error: "issueBothMethods is only available for compatibility repair and migration backfill",
    });

    const authorizationCreateResponse = await fetch(`${baseUrl}/api/authorizations`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policyAgentId: "agent_main",
        actionType: "grant_asset",
        title: "unsupported did method credential boundary probe",
        payload: {
          fromAgentId: "agent_main",
          targetAgentId: "agent_treasury",
          amount: 1,
          assetType: "credits",
          reason: "credential boundary probe",
        },
        delaySeconds: 0,
        expiresInSeconds: 600,
      }),
    });
    assert.equal(authorizationCreateResponse.status, 201);
    const authorizationCreatePayload = await authorizationCreateResponse.json();
    const proposalId = authorizationCreatePayload.authorization?.proposalId;
    assert.ok(proposalId, "expected created authorization proposal for credential boundary test");

    const invalidAuthorizationCredentialResponse = await fetch(
      `${baseUrl}/api/authorizations/${proposalId}/credential?issueBothMethods=true`,
      {
        headers: adminHeaders,
      }
    );
    assert.equal(invalidAuthorizationCredentialResponse.status, 400);
    assert.deepEqual(await invalidAuthorizationCredentialResponse.json(), {
      error: "issueBothMethods is only available for compatibility repair and migration backfill",
    });

    const invalidCompatibilityCompareEvidenceResponse = await fetch(`${baseUrl}/api/agents/compare/evidence`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        leftAgentId: "agent_main",
        rightAgentId: "agent_treasury",
        issuerDidMethod: "agentpassport",
        issueBothMethods: true,
        persist: false,
      }),
    });
    assert.equal(invalidCompatibilityCompareEvidenceResponse.status, 400);
    assert.deepEqual(await invalidCompatibilityCompareEvidenceResponse.json(), {
      error: "issueBothMethods is only available for compatibility repair and migration backfill",
    });

    const legacyContextResponse = await fetch(`${baseUrl}/api/agents/agent_main/context?didMethod=openneed`, {
      headers: adminHeaders,
    });
    assert.equal(legacyContextResponse.status, 200);
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("device and security routes use the shared read-session JSON outlet", () => {
  for (const filename of ["server-device-routes.js", "server-security-routes.js"]) {
    const source = fs.readFileSync(path.join(rootDir, "src", filename), "utf8");

    assert.match(source, /jsonForReadSession/u, filename);
    assert.doesNotMatch(source, /shouldRedactReadSessionPayload\s*\(/u, filename);
  }
});

test("runtime attribution verifier keeps canonical route ids separate from physical owner writes", () => {
  const source = fs.readFileSync(
    path.join(rootDir, "scripts", "verify-agent-runtime-attribution-http.mjs"),
    "utf8"
  );

  assert.match(source, /AGENT_PASSPORT_MAIN_AGENT_ID as CANONICAL_MAIN_AGENT_ID/u);
  assert.match(source, /residentAgentId:\s*CANONICAL_MAIN_AGENT_ID/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/runtime\/bootstrap\?didMethod=agentpassport`/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/runtime\/actions\?didMethod=agentpassport`/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/runner\?didMethod=agentpassport`/u);
  assert.match(source, /const resolvedMainAgentId = bootstrap\.bootstrap\.agentId;/u);
  assert.match(source, /runtimeActionMinute\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /sandboxAudit\?\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /latestRuntimeActionAudit\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /persistedRuntimeActionMinute\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /runnerEnvelope\?\.runner\?\.run\?\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /runnerMinute\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /persistedRunnerMinute\.recordedByAgentId === resolvedMainAgentId/u);
});

test("message attribution verifier keeps canonical route ids separate from physical owner delivery", () => {
  const source = fs.readFileSync(
    path.join(rootDir, "scripts", "verify-agent-message-attribution-http.mjs"),
    "utf8"
  );

  assert.match(source, /AGENT_PASSPORT_MAIN_AGENT_ID as CANONICAL_MAIN_AGENT_ID/u);
  assert.match(source, /const resolvedMainAgentId = bootstrap\.bootstrap\.agentId;/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/messages`/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/messages\?limit=20`/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/transcript\?family=conversation&limit=20`/u);
  assert.match(source, /delivered\.message\.toAgentId === resolvedMainAgentId/u);
  assert.match(source, /inboxMessage\.toAgentId === resolvedMainAgentId/u);
  assert.match(source, /delivered\.message\.fromAgentId == null/u);
  assert.match(source, /delivered\.message\.fromWindowId == null/u);
});

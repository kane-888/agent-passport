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
    assert.match(prepared.isolationEnv.OPENNEED_LEDGER_PATH, /ledger\.json$/);
    assert.match(prepared.isolationEnv.AGENT_PASSPORT_READ_SESSION_STORE_PATH, /read-sessions\.json$/);
    assert.equal(
      prepared.isolationEnv.AGENT_PASSPORT_READ_SESSION_STORE_PATH.startsWith(
        prepared.isolationEnv.OPENNEED_LEDGER_PATH.replace(/ledger\.json$/u, "")
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
      OPENNEED_LEDGER_PATH: path.join(tmpDir, "ledger.json"),
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

test("device and security routes use the shared read-session JSON outlet", () => {
  for (const filename of ["server-device-routes.js", "server-security-routes.js"]) {
    const source = fs.readFileSync(path.join(rootDir, "src", filename), "utf8");

    assert.match(source, /jsonForReadSession/u, filename);
    assert.doesNotMatch(source, /shouldRedactReadSessionPayload\s*\(/u, filename);
  }
});

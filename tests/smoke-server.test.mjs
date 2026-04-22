import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { prepareSmokeDataRoot, probeHealth } from "../scripts/smoke-server.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("server protected access denials expose stable error classes", () => {
  const source = fs.readFileSync(path.join(rootDir, "src/server.js"), "utf8");
  assert.match(source, /function apiAccessDeniedErrorClass/u);
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

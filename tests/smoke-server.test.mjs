import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { prepareSmokeDataRoot, probeHealth } from "../scripts/smoke-server.mjs";

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

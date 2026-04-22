import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildSmokeHttpHeaders, createSmokeHttpClient } from "../scripts/smoke-ui-http.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("smoke http client accepts deploy admin token as an explicit fallback", async () => {
  const snapshot = {
    AGENT_PASSPORT_ADMIN_TOKEN: process.env.AGENT_PASSPORT_ADMIN_TOKEN,
    AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: process.env.AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN,
  };
  delete process.env.AGENT_PASSPORT_ADMIN_TOKEN;
  process.env.AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN = "deploy-smoke-token";
  try {
    const client = createSmokeHttpClient({
      baseUrl: "http://127.0.0.1:9",
      rootDir: process.cwd(),
    });
    assert.equal(await client.getAdminToken(), "deploy-smoke-token");
  } finally {
    restoreEnv(snapshot);
  }
});

test("smoke http client keeps AGENT_PASSPORT_ADMIN_TOKEN above deploy token", async () => {
  const snapshot = {
    AGENT_PASSPORT_ADMIN_TOKEN: process.env.AGENT_PASSPORT_ADMIN_TOKEN,
    AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: process.env.AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN,
  };
  process.env.AGENT_PASSPORT_ADMIN_TOKEN = "direct-smoke-token";
  process.env.AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN = "deploy-smoke-token";
  try {
    const client = createSmokeHttpClient({
      baseUrl: "http://127.0.0.1:9",
      rootDir: process.cwd(),
    });
    assert.equal(await client.getAdminToken(), "direct-smoke-token");
  } finally {
    restoreEnv(snapshot);
  }
});

test("smoke http client uses shared admin-token header construction", () => {
  assert.deepEqual(buildSmokeHttpHeaders({ token: " smoke-token " }), {
    Connection: "close",
    Authorization: "Bearer smoke-token",
  });
  assert.deepEqual(
    buildSmokeHttpHeaders({
      token: "",
      headers: {
        "X-Smoke": "trace",
      },
      includeJsonContentType: true,
    }),
    {
      "Content-Type": "application/json",
      Connection: "close",
      "X-Smoke": "trace",
    }
  );

  const source = fs.readFileSync(path.join(rootDir, "scripts", "smoke-ui-http.mjs"), "utf8");
  assert.match(source, /buildAdminTokenHeaders/u);
  assert.doesNotMatch(source, /headers\.Authorization/u);
  assert.doesNotMatch(source, /Authorization:\s*`Bearer/u);
});

test("attribution HTTP probes share admin-token header construction", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts", "attribution-http-probe-shared.mjs"), "utf8");

  assert.match(source, /buildAdminTokenHeaders/u);
  assert.doesNotMatch(source, /headers\.Authorization/u);
  assert.doesNotMatch(source, /Authorization:\s*`Bearer/u);
});

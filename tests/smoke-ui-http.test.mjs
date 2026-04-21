import assert from "node:assert/strict";
import test from "node:test";

import { createSmokeHttpClient } from "../scripts/smoke-ui-http.mjs";

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

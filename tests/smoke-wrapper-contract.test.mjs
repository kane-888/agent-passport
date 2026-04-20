import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_BROWSER_SMOKE_FETCH_TIMEOUT_MS } from "../scripts/smoke-shared.mjs";
import { buildSmokeBrowserChildEnv } from "../scripts/run-smoke-browser.mjs";
import { buildSmokeUiChildEnv } from "../scripts/run-smoke-ui.mjs";

test("smoke UI wrapper forces the resolved server URL after isolation env is applied", () => {
  const env = buildSmokeUiChildEnv({
    baseUrl: "http://127.0.0.1:4319",
    baseEnv: {
      AGENT_PASSPORT_BASE_URL: "https://stale.example.com",
      KEEP_ME: "yes",
    },
    isolationEnv: {
      AGENT_PASSPORT_BASE_URL: "https://isolation-should-not-win.example.com",
      OPENNEED_LEDGER_PATH: "/tmp/ledger.json",
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: "/tmp/.admin-token",
    },
  });

  assert.equal(env.AGENT_PASSPORT_BASE_URL, "http://127.0.0.1:4319");
  assert.equal(env.OPENNEED_LEDGER_PATH, "/tmp/ledger.json");
  assert.equal(env.AGENT_PASSPORT_ADMIN_TOKEN_PATH, "/tmp/.admin-token");
  assert.equal(env.KEEP_ME, "yes");
});

test("smoke browser wrapper pins URL and uses the browser-safe fetch timeout by default", () => {
  const env = buildSmokeBrowserChildEnv({
    baseUrl: "http://127.0.0.1:4319",
    baseEnv: {
      AGENT_PASSPORT_BASE_URL: "https://stale.example.com",
    },
    isolationEnv: {
      AGENT_PASSPORT_BASE_URL: "https://isolation-should-not-win.example.com",
      SMOKE_FETCH_TIMEOUT_MS: "1",
      AGENT_PASSPORT_KEYCHAIN_ACCOUNT: "isolated-account",
    },
  });

  assert.equal(env.AGENT_PASSPORT_BASE_URL, "http://127.0.0.1:4319");
  assert.equal(env.SMOKE_FETCH_TIMEOUT_MS, String(DEFAULT_BROWSER_SMOKE_FETCH_TIMEOUT_MS));
  assert.equal(env.AGENT_PASSPORT_KEYCHAIN_ACCOUNT, "isolated-account");
});

test("smoke browser wrapper preserves an explicit operator fetch timeout", () => {
  const env = buildSmokeBrowserChildEnv({
    baseUrl: "http://127.0.0.1:4319",
    baseEnv: {
      SMOKE_FETCH_TIMEOUT_MS: "90000",
    },
    isolationEnv: {
      SMOKE_FETCH_TIMEOUT_MS: "1",
    },
  });

  assert.equal(env.SMOKE_FETCH_TIMEOUT_MS, "90000");
});

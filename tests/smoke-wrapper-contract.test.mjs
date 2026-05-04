import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_BROWSER_SMOKE_FETCH_TIMEOUT_MS } from "../scripts/smoke-shared.mjs";
import { buildSmokeBrowserChildEnv, runSmokeBrowserWrapper } from "../scripts/run-smoke-browser.mjs";
import { buildSmokeUiChildEnv, runSmokeUiWrapper } from "../scripts/run-smoke-ui.mjs";

function buildWrapperHarness({ reuseExisting = false, childExitCode = 0 } = {}) {
  const calls = [];
  const isolationEnv = {
    AGENT_PASSPORT_LEDGER_PATH: "/tmp/isolated-ledger.json",
    AGENT_PASSPORT_ADMIN_TOKEN_PATH: "/tmp/isolated-admin-token",
  };
  return {
    calls,
    resolveBaseUrl: async () => {
      calls.push("resolveBaseUrl");
      return {
        baseUrl: "http://127.0.0.1:4101",
        reuseExisting,
      };
    },
    prepareDataRoot: async (options) => {
      calls.push(["prepareDataRoot", options]);
      return {
        isolationEnv,
        cleanup: async () => {
          calls.push("cleanup");
        },
      };
    },
    ensureServer: async (baseUrl, options) => {
      calls.push(["ensureServer", baseUrl, options]);
      return {
        baseUrl: "http://127.0.0.1:5099",
        stop: async () => {
          calls.push("stop");
        },
      };
    },
    runStep: async (env) => {
      calls.push(["runStep", env]);
      return childExitCode;
    },
    isolationEnv,
  };
}

test("smoke UI wrapper forces the resolved server URL after isolation env is applied", () => {
  const env = buildSmokeUiChildEnv({
    baseUrl: "http://127.0.0.1:4319",
    baseEnv: {
      AGENT_PASSPORT_BASE_URL: "https://stale.example.com",
      KEEP_ME: "yes",
    },
    isolationEnv: {
      AGENT_PASSPORT_BASE_URL: "https://isolation-should-not-win.example.com",
      AGENT_PASSPORT_LEDGER_PATH: "/tmp/ledger.json",
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: "/tmp/.admin-token",
    },
  });

  assert.equal(env.AGENT_PASSPORT_BASE_URL, "http://127.0.0.1:4319");
  assert.equal(env.AGENT_PASSPORT_LEDGER_PATH, "/tmp/ledger.json");
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

test("smoke UI wrapper orchestrates server startup, child env, and cleanup", async () => {
  const harness = buildWrapperHarness({ childExitCode: 7 });
  const exitCode = await runSmokeUiWrapper(harness);

  assert.equal(exitCode, 7);
  assert.deepEqual(harness.calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
    "resolveBaseUrl",
    "prepareDataRoot",
    "ensureServer",
    "runStep",
    "stop",
    "cleanup",
  ]);
  assert.deepEqual(harness.calls[1][1], {
    isolated: true,
    tempPrefix: "agent-passport-smoke-ui-",
  });
  assert.equal(harness.calls[2][1], "http://127.0.0.1:4101");
  assert.deepEqual(harness.calls[2][2], {
    reuseExisting: false,
    extraEnv: harness.isolationEnv,
  });
  assert.equal(harness.calls[3][1].AGENT_PASSPORT_BASE_URL, "http://127.0.0.1:5099");
  assert.equal(harness.calls[3][1].AGENT_PASSPORT_LEDGER_PATH, "/tmp/isolated-ledger.json");
});

test("smoke browser wrapper preserves cleanup when child smoke fails", async () => {
  const harness = buildWrapperHarness({ reuseExisting: true });
  const failure = new Error("browser smoke failed");
  harness.runStep = async (env) => {
    harness.calls.push(["runStep", env]);
    throw failure;
  };

  await assert.rejects(() => runSmokeBrowserWrapper(harness), /browser smoke failed/);
  assert.deepEqual(harness.calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
    "resolveBaseUrl",
    "prepareDataRoot",
    "ensureServer",
    "runStep",
    "stop",
    "cleanup",
  ]);
  assert.deepEqual(harness.calls[1][1], {
    isolated: false,
    tempPrefix: "agent-passport-smoke-browser-",
  });
  assert.equal(harness.calls[3][1].AGENT_PASSPORT_BASE_URL, "http://127.0.0.1:5099");
  assert.equal(harness.calls[3][1].SMOKE_FETCH_TIMEOUT_MS, String(DEFAULT_BROWSER_SMOKE_FETCH_TIMEOUT_MS));
});

test("smoke wrappers cleanup isolated data roots when server startup fails", async () => {
  for (const [label, runWrapper] of [
    ["ui", runSmokeUiWrapper],
    ["browser", runSmokeBrowserWrapper],
  ]) {
    const harness = buildWrapperHarness();
    harness.ensureServer = async (baseUrl, options) => {
      harness.calls.push(["ensureServer", baseUrl, options]);
      throw new Error(`${label} server failed`);
    };

    await assert.rejects(() => runWrapper(harness), new RegExp(`${label} server failed`));
    assert.deepEqual(harness.calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
      "resolveBaseUrl",
      "prepareDataRoot",
      "ensureServer",
      "cleanup",
    ]);
  }
});

test("smoke wrappers still cleanup isolated data roots when server stop fails", async () => {
  for (const [label, runWrapper] of [
    ["ui", runSmokeUiWrapper],
    ["browser", runSmokeBrowserWrapper],
  ]) {
    const harness = buildWrapperHarness();
    harness.ensureServer = async (baseUrl, options) => {
      harness.calls.push(["ensureServer", baseUrl, options]);
      return {
        baseUrl: "http://127.0.0.1:5099",
        stop: async () => {
          harness.calls.push("stop");
          throw new Error(`${label} stop failed`);
        },
      };
    };

    await assert.rejects(() => runWrapper(harness), new RegExp(`${label} stop failed`));
    assert.deepEqual(harness.calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
      "resolveBaseUrl",
      "prepareDataRoot",
      "ensureServer",
      "runStep",
      "stop",
      "cleanup",
    ]);
  }
});

test("smoke wrappers preserve the primary smoke failure when cleanup also fails", async () => {
  for (const [label, runWrapper] of [
    ["ui", runSmokeUiWrapper],
    ["browser", runSmokeBrowserWrapper],
  ]) {
    const harness = buildWrapperHarness();
    harness.runStep = async (env) => {
      harness.calls.push(["runStep", env]);
      throw new Error(`${label} smoke failed`);
    };
    harness.ensureServer = async (baseUrl, options) => {
      harness.calls.push(["ensureServer", baseUrl, options]);
      return {
        baseUrl: "http://127.0.0.1:5099",
        stop: async () => {
          harness.calls.push("stop");
          throw new Error(`${label} stop failed`);
        },
      };
    };

    await assert.rejects(() => runWrapper(harness), (error) => {
      assert.match(error.message, new RegExp(`${label} smoke failed`));
      assert.equal(error.cleanupErrors.length, 1);
      assert.match(error.cleanupErrors[0].message, new RegExp(`${label} stop failed`));
      return true;
    });
    assert.deepEqual(harness.calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
      "resolveBaseUrl",
      "prepareDataRoot",
      "ensureServer",
      "runStep",
      "stop",
      "cleanup",
    ]);
  }
});

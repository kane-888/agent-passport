import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultDeviceLocalReasonerTargetConfig,
  localReasonerNeedsDefaultMigration,
} from "../src/ledger-local-reasoner-defaults.js";
import {
  DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL,
  DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
} from "../src/ledger-device-runtime.js";

test("default local reasoner target config rewrites runtime fields to canonical memory stability engine defaults", () => {
  const target = buildDefaultDeviceLocalReasonerTargetConfig(
    {
      enabled: false,
      provider: "local_mock",
      model: "old-model",
      command: "run-mock",
      args: ["--json"],
      cwd: "/tmp",
    },
    {
      localReasonerTimeoutMs: 1234,
    }
  );

  assert.equal(target.enabled, false);
  assert.equal(target.provider, DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER);
  assert.equal(target.model, DEFAULT_DEVICE_LOCAL_REASONER_MODEL);
  assert.equal(target.baseUrl, DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL);
  assert.equal(target.path, "/api/chat");
  assert.equal(target.timeoutMs, 1234);
  assert.equal(target.command, null);
  assert.deepEqual(target.args, []);
  assert.equal(target.cwd, null);
  assert.equal(localReasonerNeedsDefaultMigration({ provider: "local_mock", model: "old-model" }, target), true);
  assert.equal(localReasonerNeedsDefaultMigration(target, target), false);
});

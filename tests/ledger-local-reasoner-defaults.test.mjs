import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultDeviceLocalReasonerMigrationResult,
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

test("default local reasoner migration result preserves public response shape", () => {
  const selection = {
    provider: "local_mock",
    model: "old-model",
  };
  const migration = {
    selectedAt: "2026-01-01T00:00:00.000Z",
  };
  const prewarmResult = {
    checkedAt: "2026-01-01T00:00:01.000Z",
  };
  const profileMigration = {
    migratedAt: "2026-01-01T00:00:02.000Z",
  };
  const result = buildDefaultDeviceLocalReasonerMigrationResult({
    currentConfig: {
      enabled: true,
      provider: "local_mock",
      model: "old-model",
      baseUrl: "http://127.0.0.1:9999",
      selection,
    },
    targetConfig: buildDefaultDeviceLocalReasonerTargetConfig({}, {}),
    migration,
    prewarmResult,
    profileMigration,
    dryRun: false,
    prewarm: true,
    includeProfiles: true,
    selectionNeedsMigration: true,
    nowImpl: () => "2026-01-01T00:00:03.000Z",
  });

  assert.equal(result.migratedAt, "2026-01-01T00:00:03.000Z");
  assert.equal(result.dryRun, false);
  assert.equal(result.prewarm, true);
  assert.equal(result.includeProfiles, true);
  assert.equal(result.selectionNeedsMigration, true);
  assert.deepEqual(result.before, {
    provider: "local_mock",
    model: "old-model",
    baseUrl: "http://127.0.0.1:9999",
    enabled: true,
    selection,
  });
  assert.notEqual(result.before.selection, selection);
  assert.equal(result.target.provider, DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER);
  assert.equal(result.target.model, DEFAULT_DEVICE_LOCAL_REASONER_MODEL);
  assert.equal(result.target.baseUrl, DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL);
  assert.equal(result.target.path, "/api/chat");
  assert.equal(result.target.enabled, true);
  assert.equal(result.migration, migration);
  assert.equal(result.prewarmResult, prewarmResult);
  assert.equal(result.profileMigration, profileMigration);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL,
  DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
} from "../src/ledger-device-runtime.js";
import {
  runDefaultDeviceLocalReasonerMigration,
} from "../src/ledger-local-reasoner-migration.js";

test("default local reasoner migration orchestration preserves call order and result shape", async () => {
  const calls = [];
  const migration = {
    selectedAt: "2026-01-01T00:00:00.000Z",
    dryRun: false,
  };
  const prewarmResult = {
    checkedAt: "2026-01-01T00:00:01.000Z",
    dryRun: false,
  };
  const profileMigration = {
    migratedAt: "2026-01-01T00:00:02.000Z",
    dryRun: false,
  };
  const result = await runDefaultDeviceLocalReasonerMigration(
    {
      localReasonerTimeoutMs: 1234,
      includeProfiles: true,
      sourceWindowId: "window-1",
    },
    {
      store: {
        deviceRuntime: {
          localReasoner: {
            enabled: true,
            provider: "local_mock",
            model: "old-model",
            baseUrl: "http://127.0.0.1:9999",
            selection: {
              provider: "local_mock",
              model: "old-model",
            },
          },
        },
      },
      selectDeviceLocalReasoner: async (payload) => {
        calls.push(["select", payload]);
        return migration;
      },
      prewarmDeviceLocalReasoner: async (payload) => {
        calls.push(["prewarm", payload]);
        return prewarmResult;
      },
      migrateDeviceLocalReasonerProfilesToDefault: async (payload) => {
        calls.push(["profiles", payload]);
        return profileMigration;
      },
    }
  );

  assert.deepEqual(calls.map(([name]) => name), ["select", "prewarm", "profiles"]);
  assert.equal(calls[0][1].dryRun, false);
  assert.equal(calls[0][1].sourceWindowId, "window-1");
  assert.equal(calls[0][1].localReasoner.provider, DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER);
  assert.equal(calls[0][1].localReasoner.model, DEFAULT_DEVICE_LOCAL_REASONER_MODEL);
  assert.equal(calls[0][1].localReasoner.baseUrl, DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL);
  assert.equal(calls[0][1].localReasoner.path, "/api/chat");
  assert.equal(calls[0][1].localReasoner.timeoutMs, 1234);
  assert.equal(calls[1][1].dryRun, false);
  assert.deepEqual(calls[1][1].localReasoner, calls[0][1].localReasoner);
  assert.equal(calls[2][1].dryRun, false);
  assert.equal(result.dryRun, false);
  assert.equal(result.prewarm, true);
  assert.equal(result.includeProfiles, true);
  assert.equal(result.selectionNeedsMigration, true);
  assert.equal(result.before.provider, "local_mock");
  assert.equal(result.target.provider, DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER);
  assert.equal(result.migration, migration);
  assert.equal(result.prewarmResult, prewarmResult);
  assert.equal(result.profileMigration, profileMigration);
});

test("default local reasoner migration skips prewarm and profiles for dry run defaults", async () => {
  const calls = [];
  const result = await runDefaultDeviceLocalReasonerMigration(
    {
      dryRun: true,
      prewarm: true,
      deviceRuntime: {
        localReasoner: {
          enabled: true,
          provider: DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
          model: DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
          baseUrl: DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL,
          path: "/api/chat",
          timeoutMs: DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
        },
      },
    },
    {
      store: {
        deviceRuntime: {
          localReasoner: {},
        },
      },
      selectDeviceLocalReasoner: async (payload) => {
        calls.push(["select", payload]);
        return {
          selectedAt: "2026-01-01T00:00:00.000Z",
          dryRun: true,
        };
      },
      prewarmDeviceLocalReasoner: async () => {
        calls.push(["prewarm"]);
        return null;
      },
      migrateDeviceLocalReasonerProfilesToDefault: async () => {
        calls.push(["profiles"]);
        return null;
      },
    }
  );

  assert.deepEqual(calls.map(([name]) => name), ["select"]);
  assert.equal(calls[0][1].dryRun, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.prewarm, true);
  assert.equal(result.includeProfiles, false);
  assert.equal(result.selectionNeedsMigration, false);
  assert.equal(result.prewarmResult, null);
  assert.deepEqual(result.profileMigration, {
    skipped: true,
    reason: "profiles_not_requested",
  });
});

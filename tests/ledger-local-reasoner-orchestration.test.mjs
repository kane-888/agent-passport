import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeDeviceRuntime,
} from "../src/ledger-device-runtime.js";
import {
  activateDeviceLocalReasonerProfileInStore,
  prewarmDeviceLocalReasonerInStore,
  restoreDeviceLocalReasonerInStore,
  selectDeviceLocalReasonerInStore,
} from "../src/ledger-local-reasoner-orchestration.js";

function resolveResidentAgentBinding() {
  return {
    residentAgentId: "agent-1",
    residentAgentReference: "agent-passport:agent-1",
    resolvedResidentAgentId: "agent-1",
  };
}

function createStore() {
  return {
    agents: {
      "agent-1": {
        agentId: "agent-1",
      },
    },
    deviceRuntime: normalizeDeviceRuntime({
      residentAgentId: "agent-1",
      localReasoner: {
        enabled: false,
        provider: "local_mock",
      },
    }),
    localReasonerProfiles: [
      {
        profileId: "ready-profile",
        label: "Ready Profile",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "ready-model",
        },
        lastWarm: {
          warmedAt: "2026-01-01T00:00:00.000Z",
          status: "ready",
          provider: "local_mock",
          model: "ready-model",
        },
      },
    ],
  };
}

test("local reasoner selection orchestration mutates runtime through injected ledger boundaries", () => {
  const appended = [];
  const timestamps = [
    "2026-01-01T00:00:01.000Z",
    "2026-01-01T00:00:02.000Z",
  ];
  const store = createStore();
  const selected = selectDeviceLocalReasonerInStore(
    store,
    {
      dryRun: true,
      localReasoner: {
        enabled: true,
        provider: "local_mock",
        model: "selected-model",
      },
      sourceWindowId: "window-1",
    },
    {
      appendEvent: (targetStore, type, payload) => appended.push({ targetStore, type, payload }),
      nowImpl: () => timestamps.shift(),
      resolveResidentAgentBinding,
    }
  );

  assert.equal(store.deviceRuntime.localReasoner.model, "selected-model");
  assert.equal(appended.length, 1);
  assert.equal(appended[0].type, "device_runtime_configured");
  assert.equal(appended[0].payload.dryRun, true);
  assert.equal(appended[0].payload.sourceWindowId, "window-1");
  assert.equal(selected.selectedAt, "2026-01-01T00:00:01.000Z");
  assert.equal(selected.runtime.configuredAt, "2026-01-01T00:00:02.000Z");
  assert.equal(selected.runtime.deviceRuntime.localReasoner.model, "selected-model");
});

test("local reasoner profile activation orchestration updates runtime and profile health", () => {
  const appended = [];
  const timestamps = [
    "2026-01-01T00:00:03.000Z",
    "2026-01-01T00:00:04.000Z",
    "2026-01-01T00:00:05.000Z",
  ];
  const store = createStore();
  const activated = activateDeviceLocalReasonerProfileInStore(
    store,
    "ready-profile",
    {
      sourceWindowId: "window-1",
    },
    {
      appendEvent: (targetStore, type, payload) => appended.push({ targetStore, type, payload }),
      nowImpl: () => timestamps.shift(),
      resolveResidentAgentBinding,
    }
  );

  assert.deepEqual(appended.map((entry) => entry.type), [
    "device_runtime_configured",
    "device_local_reasoner_profile_activated",
  ]);
  assert.equal(store.deviceRuntime.localReasoner.model, "ready-model");
  assert.equal(activated.activatedAt, "2026-01-01T00:00:03.000Z");
  assert.equal(activated.summary.profileId, "ready-profile");
  assert.equal(activated.summary.enabled, true);
  assert.equal(activated.summary.lastActivatedAt, "2026-01-01T00:00:03.000Z");
  assert.equal(activated.runtime.deviceRuntime.localReasoner.model, "ready-model");
});

test("local reasoner prewarm orchestration writes probe warm state and scoped profile sync", async () => {
  const appended = [];
  const synced = [];
  const store = createStore();
  const result = await prewarmDeviceLocalReasonerInStore(
    store,
    {
      profileId: "ready-profile",
      localReasoner: {
        enabled: true,
        provider: "local_mock",
        model: "warm-model",
      },
      sourceWindowId: "window-1",
    },
    {
      appendEvent: (targetStore, type, payload) => appended.push({ targetStore, type, payload }),
      generateAgentRunnerCandidateResponse: async () => ({
        provider: "local_mock",
        responseText: "ready",
        metadata: {
          warmed: true,
        },
      }),
      inspectRuntimeLocalReasoner: async () => ({
        checkedAt: "2026-01-01T00:00:06.000Z",
        configured: true,
        reachable: true,
        status: "ready",
        provider: "local_mock",
        model: "warm-model",
      }),
      resolveResidentAgentBinding,
      syncLocalReasonerProfileRuntimeStateInStoreImpl: (targetStore, profileId, localReasoner) => {
        synced.push({ targetStore, profileId, localReasoner });
      },
    }
  );

  assert.equal(appended.length, 1);
  assert.equal(appended[0].type, "device_runtime_configured");
  assert.equal(synced.length, 1);
  assert.equal(synced[0].profileId, "ready-profile");
  assert.equal(synced[0].localReasoner.model, "warm-model");
  assert.equal(store.deviceRuntime.localReasoner.lastWarm.status, "ready");
  assert.equal(result.dryRun, false);
  assert.equal(result.candidate.responseText, "ready");
  assert.equal(result.warmState.status, "ready");
});

test("local reasoner restore orchestration reuses ready warm proof without probing", async () => {
  const appended = [];
  const store = createStore();
  const restored = await restoreDeviceLocalReasonerInStore(
    store,
    {
      profileId: "ready-profile",
      prewarmMode: "reuse",
    },
    {
      appendEvent: (targetStore, type, payload) => appended.push({ targetStore, type, payload }),
      generateAgentRunnerCandidateResponse: async () => {
        throw new Error("prewarm should be reused");
      },
      inspectRuntimeLocalReasoner: async () => {
        throw new Error("prewarm should be reused");
      },
      resolveResidentAgentBinding,
    }
  );

  assert.deepEqual(appended.map((entry) => entry.type), [
    "device_runtime_configured",
    "device_local_reasoner_profile_activated",
  ]);
  assert.equal(restored.restoredProfileId, "ready-profile");
  assert.equal(restored.activation.summary.profileId, "ready-profile");
  assert.equal(restored.prewarmResult.reusedWarmState, true);
  assert.equal(restored.prewarmResult.warmProofSource, "profile_last_warm");
  assert.equal(restored.deviceRuntime.localReasoner.model, "ready-model");
});

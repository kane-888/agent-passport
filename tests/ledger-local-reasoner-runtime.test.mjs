import assert from "node:assert/strict";
import test from "node:test";

import {
  appendDeviceLocalReasonerRuntimeConfiguredEvent,
  applyDeviceLocalReasonerConfigToStore,
  buildDeviceLocalReasonerPrewarmResult,
  buildDeviceLocalReasonerRuntimeConfiguredEventPayload,
  buildReusableLocalReasonerPrewarmResult,
} from "../src/ledger-local-reasoner-runtime.js";
import {
  normalizeDeviceRuntime,
} from "../src/ledger-device-runtime.js";

function resolveResidentAgentBinding() {
  return {
    residentAgentId: "agent-1",
    residentAgentReference: "agent-passport:agent-1",
    resolvedResidentAgentId: "agent-1",
  };
}

test("local reasoner runtime config apply updates normalized runtime attribution", () => {
  const store = {
    agents: {
      "agent-1": {
        agentId: "agent-1",
      },
    },
    deviceRuntime: {
      residentAgentId: "agent-1",
      localReasoner: {
        enabled: false,
        provider: "local_mock",
      },
    },
  };

  const runtime = applyDeviceLocalReasonerConfigToStore(
    store,
    {
      enabled: true,
      provider: "local_mock",
      model: "runtime-model",
    },
    {
      recordedByAgentId: "recording-agent",
      updatedByWindowId: "window-1",
      sourceWindowId: "source-1",
    },
    {
      nowImpl: () => "2026-01-01T00:00:00.000Z",
      resolveResidentAgentBinding,
    }
  );

  assert.equal(runtime, store.deviceRuntime);
  assert.equal(runtime.localReasoner.enabled, true);
  assert.equal(runtime.localReasoner.provider, "local_mock");
  assert.equal(runtime.localReasoner.model, "runtime-model");
  assert.equal(runtime.updatedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(runtime.updatedByAgentId, "recording-agent");
  assert.equal(runtime.updatedByWindowId, "window-1");
  assert.equal(runtime.sourceWindowId, "source-1");
});

test("local reasoner runtime config apply rejects missing resident agents", () => {
  assert.throws(
    () =>
      applyDeviceLocalReasonerConfigToStore(
        {
          agents: {},
          deviceRuntime: {},
        },
        {
          enabled: true,
          provider: "local_mock",
        },
        {},
        {
          resolveResidentAgentBinding: () => ({
            residentAgentId: "missing-agent",
          }),
        }
      ),
    /Resident agent not found: missing-agent/
  );
});

test("local reasoner runtime configured event payload preserves runtime boundary truth", () => {
  const store = {
    deviceRuntime: normalizeDeviceRuntime({
      residentAgentId: "agent-1",
      residentAgentReference: "agent-passport:agent-1",
      resolvedResidentAgentId: "agent-1",
      residentDidMethod: "agentpassport",
      residentLocked: true,
      localMode: "local_only",
      allowOnlineReasoner: false,
      commandPolicy: {
        negotiationMode: "confirm_before_execute",
        riskStrategies: {
          low: "auto_execute",
          medium: "discuss",
          high: "confirm",
          critical: "multisig",
        },
      },
      securityPosture: {
        mode: "hardened",
        reason: "test",
      },
      retrievalPolicy: {
        strategy: "local_first_non_vector",
      },
      setupPolicy: {
        requireSetupPackage: true,
      },
      sandboxPolicy: {
        allowShellExecution: false,
      },
    }),
  };

  const payload = buildDeviceLocalReasonerRuntimeConfiguredEventPayload(
    store,
    {
      sourceWindowId: "source-1",
    },
    true,
    {
      resolveResidentAgentBinding,
    }
  );

  assert.equal(payload.dryRun, true);
  assert.equal(payload.residentAgentId, "agent-1");
  assert.equal(payload.residentAgentReference, "agent-passport:agent-1");
  assert.equal(payload.resolvedResidentAgentId, "agent-1");
  assert.equal(payload.residentDidMethod, "agentpassport");
  assert.equal(payload.residentLocked, true);
  assert.equal(payload.localMode, "local_only");
  assert.equal(payload.allowOnlineReasoner, false);
  assert.equal(payload.negotiationMode, "confirm_before_execute");
  assert.equal(payload.sourceWindowId, "source-1");
  assert.equal(payload.riskStrategies.low, "auto_execute");

  store.deviceRuntime.commandPolicy.riskStrategies.low = "confirm";
  assert.equal(payload.riskStrategies.low, "auto_execute");
});

test("local reasoner runtime configured event appends through injected ledger event writer", () => {
  const appended = [];
  const store = {
    deviceRuntime: normalizeDeviceRuntime({
      residentAgentId: "agent-1",
    }),
  };

  appendDeviceLocalReasonerRuntimeConfiguredEvent(
    store,
    {
      sourceWindowId: "source-1",
    },
    false,
    {
      appendEvent: (targetStore, type, payload) => {
        appended.push({
          targetStore,
          type,
          payload,
        });
      },
      resolveResidentAgentBinding,
    }
  );

  assert.equal(appended.length, 1);
  assert.equal(appended[0].targetStore, store);
  assert.equal(appended[0].type, "device_runtime_configured");
  assert.equal(appended[0].payload.dryRun, false);
  assert.equal(appended[0].payload.sourceWindowId, "source-1");
});

test("local reasoner prewarm result shapes dry-run runtime and candidate evidence", () => {
  const result = buildDeviceLocalReasonerPrewarmResult({
    targetStore: {
      deviceRuntime: normalizeDeviceRuntime({
        localReasoner: {
          enabled: false,
          provider: "local_mock",
        },
      }),
    },
    runtime: normalizeDeviceRuntime({
      localReasoner: {
        enabled: false,
        provider: "local_mock",
      },
    }),
    nextLocalReasoner: {
      enabled: true,
      provider: "local_mock",
      model: "warm-model",
    },
    prewarmed: {
      diagnostics: {
        checkedAt: "2026-01-01T00:00:00.000Z",
        status: "ready",
        configured: true,
        reachable: true,
        provider: "local_mock",
        model: "warm-model",
      },
      warmState: {
        warmedAt: "2026-01-01T00:00:01.000Z",
        provider: "local_mock",
        status: "ready",
        reachable: true,
        model: "warm-model",
      },
      candidate: {
        provider: "local_mock",
        responseText: "  ready  ",
        metadata: {
          source: "test",
        },
      },
    },
    dryRun: true,
    nowImpl: () => "2026-01-01T00:00:02.000Z",
  });

  assert.equal(result.checkedAt, "2026-01-01T00:00:02.000Z");
  assert.equal(result.dryRun, true);
  assert.equal(result.deviceRuntime.localReasoner.enabled, true);
  assert.equal(result.deviceRuntime.localReasoner.model, "warm-model");
  assert.equal(result.diagnostics.status, "ready");
  assert.equal(result.rawDiagnostics.model, "warm-model");
  assert.equal(result.warmState.status, "ready");
  assert.deepEqual(result.candidate, {
    provider: "local_mock",
    responseText: "ready",
    metadata: {
      source: "test",
    },
  });
});

test("reusable local reasoner prewarm result prefers runtime warm proof", () => {
  const warmState = {
    warmedAt: "2026-01-02T00:00:00.000Z",
    provider: "local_mock",
    status: "ready",
    reachable: true,
    model: "runtime-model",
  };
  const result = buildReusableLocalReasonerPrewarmResult(
    {
      deviceRuntime: normalizeDeviceRuntime({
        localReasoner: {
          enabled: true,
          provider: "local_mock",
          model: "runtime-model",
          lastWarm: warmState,
        },
      }),
    },
    {
      provider: "local_mock",
      config: {
        enabled: true,
        provider: "local_mock",
        model: "profile-model",
      },
      lastWarm: {
        warmedAt: "2026-01-01T00:00:00.000Z",
        provider: "local_mock",
        status: "ready",
        reachable: true,
        model: "profile-model",
      },
    },
    null,
    {
      dryRun: true,
    },
    {
      nowImpl: () => "2026-01-02T00:00:01.000Z",
    }
  );

  assert.equal(result.reusedWarmState, true);
  assert.equal(result.warmProofSource, "runtime_last_warm");
  assert.equal(result.dryRun, true);
  assert.equal(result.diagnostics.checkedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(result.diagnostics.model, "runtime-model");
  assert.equal(result.checkedAt, "2026-01-02T00:00:01.000Z");
  warmState.status = "mutated";
  assert.equal(result.warmState.status, "ready");
});

test("reusable local reasoner prewarm result returns null without ready warm proof", () => {
  const result = buildReusableLocalReasonerPrewarmResult(
    {
      deviceRuntime: normalizeDeviceRuntime({
        localReasoner: {
          enabled: true,
          provider: "local_mock",
        },
      }),
    },
    {
      provider: "local_mock",
      config: {
        enabled: true,
        provider: "local_mock",
      },
    }
  );

  assert.equal(result, null);
});

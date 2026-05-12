import assert from "node:assert/strict";
import test from "node:test";

import {
  appendDeviceLocalReasonerRuntimeConfiguredEvent,
  applyDeviceLocalReasonerConfigToStore,
  buildDeviceLocalReasonerCatalogProviderEntry,
  buildDeviceLocalReasonerCatalogResult,
  buildDeviceLocalReasonerProbeResult,
  buildDeviceLocalReasonerPrewarmResult,
  buildDeviceLocalReasonerRuntimeConfiguredEventPayload,
  buildPassiveLocalReasonerDiagnostics,
  buildReusableLocalReasonerPrewarmResult,
  buildRuntimeLocalReasonerPrewarmCandidatePayload,
  buildRuntimeLocalReasonerPrewarmContextBuilder,
  buildRuntimeLocalReasonerPrewarmStateResult,
  LOCAL_REASONER_CATALOG_PROVIDER_ORDER,
  resolveDeviceLocalReasonerCatalogSelectedProvider,
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

test("passive local reasoner diagnostics summarize saved runtime state without probing", () => {
  const diagnostics = buildPassiveLocalReasonerDiagnostics(
    {
      enabled: true,
      provider: "local_mock",
      model: "saved-model",
      lastProbe: {
        checkedAt: "2026-01-01T00:00:00.000Z",
        provider: "local_mock",
        status: "ready",
        reachable: true,
        model: "probe-model",
        modelCount: 3,
        selectedModelPresent: true,
      },
      lastWarm: {
        warmedAt: "2026-01-01T00:00:01.000Z",
        provider: "local_mock",
        status: "ready",
        reachable: true,
        model: "warm-model",
      },
    },
    {
      nowImpl: () => "2026-01-01T00:00:02.000Z",
    }
  );

  assert.equal(diagnostics.checkedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(diagnostics.provider, "local_mock");
  assert.equal(diagnostics.configured, true);
  assert.equal(diagnostics.reachable, true);
  assert.equal(diagnostics.status, "ready");
  assert.equal(diagnostics.model, "warm-model");
  assert.equal(diagnostics.modelCount, 3);
  assert.equal(diagnostics.selectedModelPresent, true);
});

test("local reasoner catalog provider entries expose selected runtime evidence only for the selected provider", () => {
  const selection = {
    provider: "local_mock",
    model: "catalog-model",
  };
  const runtimeLocalReasoner = {
    selection,
    lastProbe: {
      checkedAt: "2026-01-01T00:00:00.000Z",
      provider: "local_mock",
      status: "ready",
      reachable: true,
    },
    lastWarm: {
      warmedAt: "2026-01-01T00:00:01.000Z",
      provider: "local_mock",
      status: "ready",
      reachable: true,
    },
  };
  const diagnostics = {
    checkedAt: "2026-01-01T00:00:00.000Z",
    status: "ready",
    configured: true,
    reachable: true,
    provider: "local_mock",
    model: "catalog-model",
    models: ["catalog-model", "other-model"],
  };
  const selectedEntry = buildDeviceLocalReasonerCatalogProviderEntry({
    provider: "local_mock",
    selectedProvider: "local_mock",
    probeConfig: {
      enabled: true,
      provider: "local_mock",
      command: null,
      args: [],
      cwd: null,
      baseUrl: null,
      model: "catalog-model",
    },
    diagnostics,
    runtimeLocalReasoner,
  });
  const passiveEntry = buildDeviceLocalReasonerCatalogProviderEntry({
    provider: "local_command",
    selectedProvider: "local_mock",
    probeConfig: {
      enabled: false,
      provider: "local_command",
      command: "run-local",
      args: ["--json"],
      cwd: "/tmp",
      baseUrl: null,
      model: null,
    },
    diagnostics,
    passive: true,
    runtimeLocalReasoner,
  });

  assert.deepEqual(LOCAL_REASONER_CATALOG_PROVIDER_ORDER, ["ollama_local", "local_command", "local_mock"]);
  assert.equal(selectedEntry.selected, true);
  assert.equal(selectedEntry.selection.model, "catalog-model");
  assert.equal(selectedEntry.lastProbe.status, "ready");
  assert.equal(selectedEntry.lastWarm.status, "ready");
  assert.equal(selectedEntry.rawDiagnostics, diagnostics);
  assert.deepEqual(selectedEntry.availableModels, ["catalog-model", "other-model"]);
  selection.model = "mutated";
  diagnostics.models.push("mutated");
  assert.equal(selectedEntry.selection.model, "catalog-model");
  assert.deepEqual(selectedEntry.availableModels, ["catalog-model", "other-model"]);
  assert.equal(passiveEntry.selected, false);
  assert.equal(passiveEntry.selection, null);
  assert.equal(passiveEntry.lastProbe, null);
  assert.equal(passiveEntry.rawDiagnostics, null);
  assert.deepEqual(passiveEntry.config.args, ["--json"]);
});

test("local reasoner catalog and probe results preserve runtime view shape", () => {
  const store = {
    deviceRuntime: normalizeDeviceRuntime({
      residentAgentId: "agent-1",
      localReasoner: {
        enabled: true,
        provider: "local_mock",
        model: "runtime-model",
      },
    }),
    agents: {
      "agent-1": {
        agentId: "agent-1",
      },
    },
  };
  const runtime = normalizeDeviceRuntime(store.deviceRuntime);
  const selectedProvider = resolveDeviceLocalReasonerCatalogSelectedProvider(runtime);
  const catalog = buildDeviceLocalReasonerCatalogResult({
    store,
    storeStatus: {
      present: true,
      missingKey: false,
    },
    runtime,
    selectedProvider,
    providers: [
      {
        provider: "local_mock",
      },
    ],
    passive: true,
    nowImpl: () => "2026-01-01T00:00:00.000Z",
  });
  const probe = buildDeviceLocalReasonerProbeResult({
    store,
    runtime,
    candidateConfig: {
      enabled: true,
      provider: "local_mock",
      model: "probe-model",
    },
    diagnostics: {
      checkedAt: "2026-01-01T00:00:01.000Z",
      status: "ready",
      configured: true,
      reachable: true,
      provider: "local_mock",
      model: "probe-model",
    },
    nowImpl: () => "2026-01-01T00:00:02.000Z",
  });

  assert.equal(selectedProvider, "local_mock");
  assert.equal(catalog.checkedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(catalog.initialized, true);
  assert.equal(catalog.storePresent, true);
  assert.equal(catalog.missingStoreKey, false);
  assert.equal(catalog.deviceRuntime.localReasoner.model, "runtime-model");
  assert.equal(probe.checkedAt, "2026-01-01T00:00:02.000Z");
  assert.equal(probe.deviceRuntime.localReasoner.model, "probe-model");
  assert.equal(probe.diagnostics.status, "ready");
  assert.equal(probe.rawDiagnostics.model, "probe-model");
});

test("runtime local reasoner prewarm context builder keeps the warmup prompt boundary stable", () => {
  const contextBuilder = buildRuntimeLocalReasonerPrewarmContextBuilder({
    residentAgentId: "agent-runtime",
    residentDidMethod: "agentpassport",
  });

  assert.equal(
    contextBuilder.compiledPrompt,
    [
      "Warm local reasoner runtime.",
      "Verify the selected offline provider can return a grounded response.",
    ].join("\n")
  );
  assert.equal(contextBuilder.slots.currentGoal, "预热本地 reasoner 并验证单机 Runtime 可继续运行。");
  assert.equal(contextBuilder.slots.identitySnapshot.agentId, "agent-runtime");
  assert.equal(contextBuilder.slots.identitySnapshot.didMethod, "agentpassport");
  assert.equal(contextBuilder.slots.identitySnapshot.taskSnapshot.nextAction, "等待下一轮真实推理");
  assert.deepEqual(contextBuilder.localKnowledge.hits, []);
});

test("runtime local reasoner prewarm candidate payload uses normalized local config", () => {
  const payload = buildRuntimeLocalReasonerPrewarmCandidatePayload({
    enabled: true,
    provider: "local_mock",
    model: "warm-model",
  });

  assert.equal(payload.reasonerProvider, "local_mock");
  assert.equal(payload.localReasoner.enabled, true);
  assert.equal(payload.localReasoner.provider, "local_mock");
  assert.equal(payload.localReasoner.model, "warm-model");
  assert.equal(payload.currentGoal, "预热本地 reasoner");
  assert.equal(payload.userTurn, "请返回一段简短 ready 响应，说明当前 provider 已可用。");
  assert.deepEqual(payload.recentConversationTurns, []);
  assert.deepEqual(payload.toolResults, []);
});

test("runtime local reasoner prewarm state result shapes probe warm and failure evidence", () => {
  const diagnostics = {
    checkedAt: "2026-01-01T00:00:00.000Z",
    status: "ready",
    configured: true,
    reachable: true,
    provider: "local_mock",
    model: "warm-model",
  };
  const ready = buildRuntimeLocalReasonerPrewarmStateResult(
    {
      enabled: true,
      provider: "local_mock",
      model: "warm-model",
    },
    diagnostics,
    {
      candidate: {
        provider: "local_mock",
        responseText: "  ready  ",
        metadata: {
          executionBackend: "local",
        },
      },
    }
  );
  const unreachable = buildRuntimeLocalReasonerPrewarmStateResult(
    {
      enabled: true,
      provider: "local_mock",
      model: "warm-model",
    },
    {
      checkedAt: "2026-01-01T00:00:01.000Z",
      status: "unconfigured",
      configured: false,
      reachable: false,
      provider: "local_mock",
      model: "warm-model",
    }
  );
  const failed = buildRuntimeLocalReasonerPrewarmStateResult(
    {
      enabled: true,
      provider: "local_mock",
      model: "warm-model",
    },
    diagnostics,
    {
      error: new Error("warm failed"),
    }
  );

  assert.equal(ready.diagnostics, diagnostics);
  assert.equal(ready.probeState.checkedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(ready.probeState.status, "ready");
  assert.equal(ready.warmState.status, "ready");
  assert.equal(ready.warmState.responsePreview, "ready");
  assert.equal(ready.warmState.responseBytes, 5);
  assert.equal(ready.warmState.executionBackend, "local");
  assert.equal(ready.candidate.responseText, "  ready  ");
  assert.equal(unreachable.warmState.status, "unconfigured");
  assert.equal(unreachable.candidate, null);
  assert.equal(failed.warmState.status, "failed");
  assert.equal(failed.warmState.error, "warm failed");
  assert.equal(failed.candidate, null);
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

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocalReasonerProbeConfig,
  buildPrewarmDeviceLocalReasonerConfig,
  buildSelectedDeviceLocalReasonerConfig,
  mergeRunnerLocalReasonerOverride,
  resolveLocalReasonerPayloadOverride,
} from "../src/ledger-local-reasoner-overrides.js";

test("local reasoner payload overrides prefer explicit top-level local reasoner fields", () => {
  const nestedArgs = ["nested"];
  const override = resolveLocalReasonerPayloadOverride({
    localReasoner: {
      enabled: true,
      provider: "ollama_local",
      args: nestedArgs,
      timeoutMs: 2000,
      model: "nested-model",
    },
    localReasonerEnabled: false,
    localReasonerProvider: "local_command",
    localReasonerArgs: ["top"],
    localReasonerTimeoutMs: 4500,
    localReasonerModel: "top-model",
  });

  assert.equal(override.enabled, false);
  assert.equal(override.provider, "local_command");
  assert.deepEqual(override.args, ["top"]);
  assert.equal(override.timeoutMs, 4500);
  assert.equal(override.model, "top-model");

  nestedArgs.push("mutated");
  assert.deepEqual(override.args, ["top"]);
});

test("runner local reasoner merge keeps current config without overrides", () => {
  const merged = mergeRunnerLocalReasonerOverride({
    enabled: false,
    provider: "local_mock",
    model: "mock-model",
    timeoutMs: 1600,
  });

  assert.equal(merged.enabled, false);
  assert.equal(merged.provider, "local_mock");
  assert.equal(merged.model, "mock-model");
  assert.equal(merged.timeoutMs, 1600);
});

test("runner local reasoner merge honors requested provider over payload provider", () => {
  const merged = mergeRunnerLocalReasonerOverride(
    {
      enabled: true,
      provider: "ollama_local",
      model: "base-model",
      timeoutMs: 2000,
    },
    {
      localReasonerEnabled: false,
      localReasonerProvider: "ollama_local",
      localReasonerModel: "payload-model",
      localReasonerTimeoutMs: 6000,
    },
    "local_mock"
  );

  assert.equal(merged.enabled, false);
  assert.equal(merged.provider, "local_mock");
  assert.equal(merged.model, "payload-model");
  assert.equal(merged.timeoutMs, 6000);
});

test("local reasoner probe config enables the requested provider", () => {
  const ollama = buildLocalReasonerProbeConfig(
    {
      localReasoner: {
        enabled: false,
        provider: "local_mock",
      },
    },
    "ollama_local"
  );
  assert.equal(ollama.enabled, true);
  assert.equal(ollama.provider, "ollama_local");
  assert.equal(ollama.baseUrl, "http://127.0.0.1:11434");

  const mock = buildLocalReasonerProbeConfig(
    {
      localReasoner: {
        enabled: false,
        provider: "local_mock",
      },
    },
    "local_mock"
  );
  assert.equal(mock.enabled, true);
  assert.equal(mock.provider, "local_mock");
  assert.equal(mock.model, "agent-passport-local-mock");
});

test("selected local reasoner config applies overrides and clears stale health state", () => {
  const selected = buildSelectedDeviceLocalReasonerConfig(
    {
      localReasoner: {
        enabled: false,
        provider: "ollama_local",
        model: "old-model",
        lastProbe: {
          checkedAt: "2026-01-01T00:00:00.000Z",
          provider: "ollama_local",
          status: "ready",
          reachable: true,
        },
        lastWarm: {
          warmedAt: "2026-01-01T00:00:01.000Z",
          provider: "ollama_local",
          status: "ready",
          reachable: true,
        },
      },
    },
    {
      localReasonerProvider: "local_mock",
      localReasonerModel: "selected-model",
      selectedByAgentId: "agent-1",
      selectedByWindowId: "window-1",
      sourceWindowId: "source-1",
    }
  );

  assert.equal(selected.enabled, true);
  assert.equal(selected.provider, "local_mock");
  assert.equal(selected.model, "selected-model");
  assert.equal(selected.lastProbe, null);
  assert.equal(selected.lastWarm, null);
  assert.equal(selected.selection.provider, "local_mock");
  assert.equal(selected.selection.model, "selected-model");
  assert.equal(selected.selection.selectedByAgentId, "agent-1");
  assert.equal(selected.selection.selectedByWindowId, "window-1");
  assert.equal(selected.selection.sourceWindowId, "source-1");
});

test("prewarm local reasoner config preserves current enabled state without an override", () => {
  const prewarm = buildPrewarmDeviceLocalReasonerConfig(
    {
      localReasoner: {
        enabled: false,
        provider: "ollama_local",
      },
    },
    {
      localReasonerProvider: "local_mock",
    }
  );

  assert.equal(prewarm.enabled, false);
  assert.equal(prewarm.provider, "local_mock");
  assert.equal(prewarm.model, "agent-passport-local-mock");
});

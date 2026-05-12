import assert from "node:assert/strict";
import test from "node:test";

import {
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

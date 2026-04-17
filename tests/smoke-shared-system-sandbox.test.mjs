import assert from "node:assert/strict";
import test from "node:test";

import { assertBrokerSystemSandboxTruth } from "../scripts/smoke-shared.mjs";

test("assertBrokerSystemSandboxTruth accepts enforced system sandbox state", () => {
  const status = assertBrokerSystemSandboxTruth(
    {
      requested: true,
      available: true,
      enabled: true,
      backend: "sandbox_exec",
      status: "enforced",
      platform: "darwin",
      fallbackReason: null,
    },
    "sandbox filesystem_list"
  );

  assert.equal(status, "enforced");
});

test("assertBrokerSystemSandboxTruth accepts broker-only fallback when system sandbox is unavailable", () => {
  const status = assertBrokerSystemSandboxTruth(
    {
      requested: true,
      available: false,
      enabled: false,
      backend: "broker_only",
      status: "unavailable",
      platform: "linux",
      fallbackReason: "unsupported_platform:linux",
    },
    "sandbox filesystem_list"
  );

  assert.equal(status, "unavailable");
});

test("assertBrokerSystemSandboxTruth accepts broker-only policy disabled state", () => {
  const status = assertBrokerSystemSandboxTruth(
    {
      requested: false,
      available: true,
      enabled: false,
      backend: "broker_only",
      status: "disabled",
      platform: "darwin",
      fallbackReason: "disabled_by_policy",
    },
    "sandbox filesystem_list",
    { requested: false }
  );

  assert.equal(status, "disabled");
});

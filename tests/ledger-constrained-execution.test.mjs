import assert from "node:assert/strict";
import test from "node:test";

import { buildConstrainedExecutionSummary } from "../src/ledger-device-runtime.js";

const restrictedSandboxPolicy = {
  allowShellExecution: false,
  allowExternalNetwork: false,
  brokerIsolationEnabled: true,
  systemBrokerSandboxEnabled: true,
  workerIsolationEnabled: true,
  allowedCapabilities: ["runtime_search", "filesystem_list", "filesystem_read", "conversation_minute_write"],
  blockedCapabilities: ["process_exec", "identity_change", "asset_transfer", "key_management", "filesystem_delete"],
  networkAllowlist: ["127.0.0.1", "localhost"],
  allowedCommands: [],
  requireAbsoluteProcessCommand: true,
};

test("constrained execution treats Linux broker fallback as restricted when execution remains closed", () => {
  const summary = buildConstrainedExecutionSummary(
    {
      sandboxPolicy: restrictedSandboxPolicy,
    },
    {
      platform: "linux",
      systemSandboxExists: () => false,
    }
  );

  assert.equal(summary.status, "restricted");
  assert.equal(summary.systemBrokerSandbox.status, "unavailable");
  assert.equal(summary.systemBrokerSandbox.enabled, false);
  assert.equal(summary.warnings.includes("system_broker_sandbox_unavailable"), true);
  assert.equal(summary.degradationReasons.includes("system_broker_sandbox_unavailable"), false);
  assert.equal(summary.allowShellExecution, false);
  assert.equal(summary.allowExternalNetwork, false);
});

test("constrained execution still degrades on macOS when requested system sandbox is unavailable", () => {
  const summary = buildConstrainedExecutionSummary(
    {
      sandboxPolicy: restrictedSandboxPolicy,
    },
    {
      platform: "darwin",
      systemSandboxExists: () => false,
    }
  );

  assert.equal(summary.status, "degraded");
  assert.equal(summary.systemBrokerSandbox.status, "unavailable");
  assert.equal(summary.degradationReasons.includes("system_broker_sandbox_unavailable"), true);
});

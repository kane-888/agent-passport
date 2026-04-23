import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertBrokerSystemSandboxTruth } from "../scripts/smoke-shared.mjs";
import {
  buildBrokerWorkerEnv,
  buildSystemSandboxPlan,
  buildSystemSandboxProfile,
} from "../src/runtime-sandbox-broker.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("system sandbox broker keeps write roots scoped to the ephemeral workspace", () => {
  const workspace = { root: "/var/folders/agent-passport/agent-passport-broker-test" };
  const plan = buildSystemSandboxPlan({ capability: "filesystem_list" }, workspace);
  const profile = buildSystemSandboxProfile(plan);

  assert.deepEqual(plan.writeRoots, [workspace.root]);
  assert.doesNotMatch(profile, /\(subpath "\/tmp"\)|\(subpath "\/private\/tmp"\)/u);
});

test("system sandbox broker canonicalizes and reuses its ephemeral workspace for child temp files", () => {
  const workspace = { root: "/var/folders/agent-passport/agent-passport-broker-test" };
  const plan = buildSystemSandboxPlan({ capability: "filesystem_list" }, workspace);

  assert.ok(plan.readRoots.includes(workspace.root));
  assert.deepEqual(buildBrokerWorkerEnv(workspace), {
    TMPDIR: workspace.root,
    TMP: workspace.root,
    TEMP: workspace.root,
  });
});

test("system sandbox broker does not widen absolute argument paths to parent directories", () => {
  const plan = buildSystemSandboxPlan(
    {
      capability: "filesystem_read",
      args: ["/sensitive/credential.json"],
    },
    { root: "/var/folders/agent-passport/agent-passport-broker-test" }
  );

  assert.ok(plan.readRoots.includes("/sensitive/credential.json"));
  assert.equal(plan.readRoots.includes("/sensitive"), false);
});

test("system sandbox broker import does not execute the CLI main loop", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "await import('./src/runtime-sandbox-broker.js'); console.log('imported');",
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      timeout: 2000,
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "imported\n");
  assert.equal(result.stderr, "");
});

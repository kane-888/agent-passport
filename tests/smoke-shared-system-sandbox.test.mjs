import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertBrokerSystemSandboxTruth } from "../scripts/smoke-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeSandboxBrokerSource = readFileSync(
  path.join(__dirname, "..", "src", "runtime-sandbox-broker.js"),
  "utf8"
);

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
  assert.doesNotMatch(
    runtimeSandboxBrokerSource,
    /SANDBOX_TEMP_ROOTS|["']\/tmp["']|["']\/private\/tmp["']/,
    "system sandbox profiles must not grant global temp roots as reusable read/write surfaces"
  );
  assert.match(
    runtimeSandboxBrokerSource,
    /const writeRoots = uniquePaths\(\[\s*workspace\?\.root \?\? null,\s*\]\);/s,
    "system sandbox writes should stay limited to the broker-owned ephemeral workspace"
  );
});

test("system sandbox broker canonicalizes and reuses its ephemeral workspace for child temp files", () => {
  assert.match(
    runtimeSandboxBrokerSource,
    /const root = await realpath\(await mkdtemp\(path\.join\(tmpdir\(\), ["']openneed-memory-broker-["']\)\)\);/,
    "system sandbox workspace should be canonicalized before being written into a macOS seatbelt profile"
  );
  assert.match(
    runtimeSandboxBrokerSource,
    /env:\s*\{\s*TMPDIR: workspace\.root,\s*TMP: workspace\.root,\s*TEMP: workspace\.root,\s*\}/s,
    "sandbox workers should use the broker-owned workspace for temp files instead of global /tmp"
  );
});

test("system sandbox broker does not widen absolute argument paths to parent directories", () => {
  const argumentPathHelper = runtimeSandboxBrokerSource.match(
    /function listAbsoluteArgumentPaths[\s\S]*?\n}\n/
  )?.[0] ?? "";

  assert.ok(argumentPathHelper, "argument path helper should stay present");
  assert.doesNotMatch(
    argumentPathHelper,
    /path\.dirname\(entry\)/,
    "an absolute file argument should not automatically grant sibling file reads through its parent directory"
  );
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSmokeAllResultEnvelope,
  extractStepExternalWaitMs,
  formatProtectiveStateSemanticsSummary,
  resolveSmokeAllMode,
  summarizeProtectiveStateSemantics,
} from "../scripts/smoke-all.mjs";
import { buildSmokeAllChildEnv, resolveSmokeAllTimeoutMs } from "../scripts/verify-go-live-readiness.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collectNodeTargets(command = "") {
  const targets = [];
  const nodeCommandPattern = /\bnode\s+([^;&|\n]+)/g;
  let match;
  while ((match = nodeCommandPattern.exec(command))) {
    const parts = String(match[1] || "")
      .split(/\s+/)
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
    targets.push(...parts.filter((part) => /\.(?:js|mjs)$/.test(part)));
  }
  return targets;
}

function collectLocalImportSpecifiers(source = "") {
  const specs = [];
  const importPattern = /\bimport\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = importPattern.exec(source))) {
    const spec = match[1] || match[2] || "";
    if (spec.startsWith(".")) {
      specs.push(spec);
    }
  }
  return specs;
}

function resolveLocalImportTarget(fromPath, specifier) {
  const resolved = path.resolve(path.dirname(fromPath), specifier);
  for (const candidate of [
    resolved,
    `${resolved}.mjs`,
    `${resolved}.js`,
    `${resolved}.cjs`,
    `${resolved}.json`,
    path.join(resolved, "index.mjs"),
    path.join(resolved, "index.js"),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function assertLocalImportsResolvable(entryTargets) {
  const missing = [];
  const visited = new Set();
  const scan = (targetPath) => {
    if (visited.has(targetPath)) {
      return;
    }
    visited.add(targetPath);
    const source = fs.readFileSync(targetPath, "utf8");
    for (const specifier of collectLocalImportSpecifiers(source)) {
      const importTarget = resolveLocalImportTarget(targetPath, specifier);
      if (!importTarget) {
        missing.push(`${path.relative(rootDir, targetPath)} -> ${specifier}`);
        continue;
      }
      if (/\.(?:mjs|js|cjs)$/u.test(importTarget)) {
        scan(importTarget);
      }
    }
  };
  for (const entryTarget of entryTargets) {
    scan(path.join(rootDir, entryTarget));
  }
  assert.deepEqual(missing, []);
}

function isGitTracked(target) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", target], {
      cwd: rootDir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function hasGitMetadata() {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: rootDir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

test("package smoke:dom defaults to combined truth while core remains explicit", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

  assert.match(packageJson.scripts?.["smoke:dom"] || "", /smoke-dom-combined\.mjs/);
  assert.match(packageJson.scripts?.["smoke:dom:core"] || "", /smoke-dom\.mjs/);
  assert.match(packageJson.scripts?.["smoke:dom:combined"] || "", /smoke-dom-combined\.mjs/);
  assert.match(packageJson.scripts?.["smoke:dom:operational"] || "", /smoke-dom-operational\.mjs/);
});

test("package exposes a short operational-only smoke gate", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const operationalGate = fs.readFileSync(path.join(rootDir, "scripts", "smoke-operational-gate.mjs"), "utf8");

  assert.match(packageJson.scripts?.["smoke:operational"] || "", /smoke-operational-gate\.mjs/);
  assert.match(operationalGate, /smoke-ui-operational\.mjs/);
  assert.match(operationalGate, /smoke-dom-operational\.mjs/);
  assert.match(operationalGate, /runStepDefsOutcomes/);
  assert.match(operationalGate, /parallel:\s*true/);
  assert.match(operationalGate, /failedSteps/);
  assert.doesNotMatch(operationalGate, /smoke-dom-combined\.mjs/);
  assert.doesNotMatch(operationalGate, /SMOKE_COMBINED/);
});

test("package exposes explicit runtime soak tiers", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

  assert.match(packageJson.scripts?.["soak:runtime"] || "", /soak-runtime-stability\.mjs/);
  assert.doesNotMatch(packageJson.scripts?.["soak:runtime"] || "", /--browser/);
  assert.match(packageJson.scripts?.["soak:runtime:browser"] || "", /soak-runtime-stability\.mjs --browser/);
  assert.match(packageJson.scripts?.["soak:runtime:operational"] || "", /soak-runtime-stability\.mjs --operational-only/);
});

test("package and smoke orchestration local script targets exist", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const missingPackageTargets = [];
  for (const [scriptName, command] of Object.entries(packageJson.scripts || {})) {
    for (const target of collectNodeTargets(command)) {
      const targetPath = path.join(rootDir, target);
      if (!fs.existsSync(targetPath)) {
        missingPackageTargets.push(`${scriptName}:${target}`);
      }
    }
  }

  assert.deepEqual(missingPackageTargets, []);

  const smokeAll = fs.readFileSync(path.join(rootDir, "scripts", "smoke-all.mjs"), "utf8");
  const operationalGate = fs.readFileSync(path.join(rootDir, "scripts", "smoke-operational-gate.mjs"), "utf8");
  for (const scriptName of [
    "smoke-ui-operational.mjs",
    "smoke-dom-operational.mjs",
    "smoke-dom-combined.mjs",
    "smoke-ui.mjs",
  ]) {
    assert(fs.existsSync(path.join(rootDir, "scripts", scriptName)), `${scriptName} should exist`);
    assert(
      smokeAll.includes(scriptName) || operationalGate.includes(scriptName),
      `${scriptName} should be referenced by smoke orchestration`
    );
  }
});

test("pre-public and smoke runtime helper files stay present", () => {
  for (const target of [
    "scripts/prepare-self-hosted-pre-public.mjs",
    "scripts/self-hosted-config.mjs",
    "scripts/structured-cli-output.mjs",
    "scripts/verifier-outcome-shared.mjs",
    "scripts/smoke-dom-combined.mjs",
    "scripts/smoke-dom-operational.mjs",
    "scripts/smoke-operational-gate.mjs",
    "scripts/smoke-server.mjs",
    "scripts/smoke-ui-http.mjs",
    "scripts/smoke-ui-operational.mjs",
    "scripts/verify-package-boundary.mjs",
    "tests/prepare-self-hosted-pre-public.test.mjs",
    "tests/runner-auto-recovery.test.mjs",
    "tests/smoke-server.test.mjs",
    "tests/smoke-shared-fetch-timeout.test.mjs",
    "tests/smoke-wrapper-contract.test.mjs",
    "tests/passive-store-read.test.mjs",
    "tests/offline-chat-runtime.test.mjs",
    "tests/reasoner-remote-context.test.mjs",
    "tests/smoke-ui-http.test.mjs",
    "tests/ledger-write-discipline.test.mjs",
    "tests/package-boundary.test.mjs",
  ]) {
    assert(fs.existsSync(path.join(rootDir, target)), `${target} should exist`);
  }
});

test("pre-public and smoke runtime helper files stay tracked for clean clones", () => {
  if (!hasGitMetadata()) {
    return;
  }
  const requiredTrackedTargets = [
    "scripts/prepare-self-hosted-pre-public.mjs",
    "scripts/self-hosted-config.mjs",
    "scripts/structured-cli-output.mjs",
    "scripts/verifier-outcome-shared.mjs",
    "scripts/smoke-dom-combined.mjs",
    "scripts/smoke-dom-operational.mjs",
    "scripts/smoke-operational-gate.mjs",
    "scripts/smoke-ui-operational.mjs",
    "scripts/verify-package-boundary.mjs",
    "tests/prepare-self-hosted-pre-public.test.mjs",
    "tests/runner-auto-recovery.test.mjs",
    "tests/smoke-server.test.mjs",
    "tests/smoke-shared-fetch-timeout.test.mjs",
    "tests/passive-store-read.test.mjs",
    "tests/offline-chat-runtime.test.mjs",
    "tests/reasoner-remote-context.test.mjs",
    "tests/smoke-ui-http.test.mjs",
    "tests/ledger-write-discipline.test.mjs",
    "tests/package-boundary.test.mjs",
  ];
  const missing = requiredTrackedTargets.filter((target) => !isGitTracked(target));

  assert.deepEqual(missing, []);
});

test("operational and pre-public smoke scripts stay syntax-checkable", () => {
  for (const scriptName of [
    "prepare-self-hosted-pre-public.mjs",
    "self-hosted-config.mjs",
    "smoke-dom-combined.mjs",
    "smoke-server.mjs",
    "smoke-operational-gate.mjs",
    "smoke-ui-operational.mjs",
    "smoke-dom-operational.mjs",
    "structured-cli-output.mjs",
    "verifier-outcome-shared.mjs",
    "verify-package-boundary.mjs",
  ]) {
    execFileSync(process.execPath, ["--check", path.join(rootDir, "scripts", scriptName)], {
      cwd: rootDir,
      stdio: "pipe",
    });
  }
});

test("operational smoke entry local imports stay resolvable", () => {
  assertLocalImportsResolvable([
    "scripts/smoke-ui-operational.mjs",
    "scripts/smoke-dom-operational.mjs",
    "scripts/smoke-operational-gate.mjs",
  ]);
});

test("standalone DOM smoke scripts isolate read-session stores with ledger data", () => {
  for (const scriptName of [
    "smoke-dom.mjs",
    "smoke-dom-combined.mjs",
    "smoke-dom-operational.mjs",
  ]) {
    const source = fs.readFileSync(path.join(rootDir, "scripts", scriptName), "utf8");
    assert.match(
      source,
      /process\.env\.AGENT_PASSPORT_READ_SESSION_STORE_PATH\s*=\s*path\.join\(dataDir,\s*"read-sessions\.json"\)/,
      `${scriptName} should keep read sessions inside its isolated smoke data dir`
    );
  }
});

test("smoke guard test bundle includes operational and runner guard files", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const smokeGuardScript = packageJson.scripts?.["test:smoke:guards"] || "";

  assert.match(
    smokeGuardScript,
    /--test-concurrency=1/,
    "smoke guard tests mutate isolated env paths and must not run files concurrently"
  );
  for (const testTarget of [
    "tests/smoke-all-semantics.test.mjs",
    "tests/smoke-operational-semantics.test.mjs",
    "tests/smoke-runtime-evidence-semantics.test.mjs",
    "tests/smoke-browser-semantics.test.mjs",
    "tests/smoke-server.test.mjs",
    "tests/smoke-shared-fetch-timeout.test.mjs",
    "tests/smoke-shared-system-sandbox.test.mjs",
    "tests/smoke-wrapper-contract.test.mjs",
    "tests/passive-store-read.test.mjs",
    "tests/read-session-access-policy.test.mjs",
    "tests/offline-chat-runtime.test.mjs",
    "tests/reasoner-remote-context.test.mjs",
    "tests/runtime-truth-client.test.mjs",
    "tests/runner-auto-recovery.test.mjs",
    "tests/ledger-write-discipline.test.mjs",
    "tests/prepare-self-hosted-pre-public.test.mjs",
    "tests/memory-homeostasis.test.mjs",
    "tests/smoke-ui-http.test.mjs",
    "tests/package-boundary.test.mjs",
  ]) {
    assert.match(smokeGuardScript, new RegExp(testTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert(fs.existsSync(path.join(rootDir, testTarget)), `${testTarget} should exist`);
  }
});

test("isolated smoke strips direct admin token env after seeding secret fallbacks", () => {
  const smokeServerScript = fs.readFileSync(path.join(rootDir, "scripts", "smoke-server.mjs"), "utf8");

  assert.match(smokeServerScript, /AGENT_PASSPORT_ADMIN_TOKEN:\s*""/);
  assert.match(smokeServerScript, /AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN:\s*""/);
  assert.match(smokeServerScript, /AGENT_PASSPORT_ADMIN_TOKEN_PATH/);
  assert.match(smokeServerScript, /AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT/);
});

test("verify go-live smoke gate strips direct admin token env before spawning smoke:all", () => {
  const env = buildSmokeAllChildEnv({
    AGENT_PASSPORT_ADMIN_TOKEN: "direct-admin-token",
    AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: "deploy-admin-token",
    AGENT_PASSPORT_ADMIN_TOKEN_PATH: "/tmp/admin-token",
    AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT: "resident-test",
    KEEP_ME: "yes",
  });

  assert.equal(env.AGENT_PASSPORT_ADMIN_TOKEN, "");
  assert.equal(env.AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN, "");
  assert.equal(env.AGENT_PASSPORT_ADMIN_TOKEN_PATH, "/tmp/admin-token");
  assert.equal(env.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT, "resident-test");
  assert.equal(env.AGENT_PASSPORT_BASE_URL, "");
  assert.equal(env.SMOKE_ALL_SKIP_BROWSER, "0");
  assert.equal(env.SMOKE_ALL_REQUIRE_BROWSER, "1");
  assert.equal(env.KEEP_ME, "yes");
});

test("verify go-live smoke gate default timeout covers full browser smoke", () => {
  const previousTimeout = process.env.AGENT_PASSPORT_SMOKE_ALL_TIMEOUT_MS;
  try {
    delete process.env.AGENT_PASSPORT_SMOKE_ALL_TIMEOUT_MS;
    assert.equal(resolveSmokeAllTimeoutMs(), 360000);

    process.env.AGENT_PASSPORT_SMOKE_ALL_TIMEOUT_MS = "12345";
    assert.equal(resolveSmokeAllTimeoutMs(), 12345);
  } finally {
    if (previousTimeout == null) {
      delete process.env.AGENT_PASSPORT_SMOKE_ALL_TIMEOUT_MS;
    } else {
      process.env.AGENT_PASSPORT_SMOKE_ALL_TIMEOUT_MS = previousTimeout;
    }
  }
});

test("package smoke:all:ci defaults to parallel combined operational mode", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const smokeAllCi = packageJson.scripts?.["smoke:all:ci"] || "";
  const smokeAll = fs.readFileSync(path.join(rootDir, "scripts", "smoke-all.mjs"), "utf8");

  assert.match(smokeAllCi, /SMOKE_ALL_SKIP_BROWSER=1/);
  assert.match(smokeAllCi, /SMOKE_ALL_PARALLEL=1/);
  assert.match(smokeAllCi, /smoke-all\.mjs/);
  assert.equal(resolveSmokeAllMode({ parallel: true }), "parallel_combined_with_operational");
  assert.equal(resolveSmokeAllMode({ parallel: false }), "sequential_combined_with_operational");
  assert.equal(
    buildSmokeAllResultEnvelope({ parallel: true, totalDurationMs: 1 }).mode,
    "parallel_combined_with_operational"
  );
  assert.equal(buildSmokeAllResultEnvelope({ parallel: true, ok: false, error: "x" }).ok, false);
  assert.match(smokeAll, /runStepDefsOutcomes\(operationalStepDefs/);
  assert.match(smokeAll, /parallel:\s*runInParallel/);
  assert.match(smokeAll, /failedSteps/);
});

test("smoke:all treats missing runtime evidence as a hard gate", () => {
  const smokeAllScript = fs.readFileSync(path.join(rootDir, "scripts", "smoke-all.mjs"), "utf8");

  assert.match(smokeAllScript, /runtimeEvidenceSemantics\.status !== "passed"/);
  assert.doesNotMatch(smokeAllScript, /runtimeEvidenceSemantics\.status === "failed"/);
});

test("server awaits async route dispatch so expected route errors become HTTP responses", () => {
  const serverScript = fs.readFileSync(path.join(rootDir, "src", "server.js"), "utf8");

  assert.match(serverScript, /return await runWithPassiveStoreAccess\(dispatchApiRoutes\)/);
  assert.match(serverScript, /return await dispatchApiRoutes\(\)/);
});

test("extractStepExternalWaitMs only attributes browser automation lock waits", () => {
  assert.equal(
    extractStepExternalWaitMs("smoke:browser", {
      timing: {
        browserAutomationLockWaitMs: 42123.4,
      },
    }),
    42123
  );
  assert.equal(extractStepExternalWaitMs("smoke:browser", { browserAutomationLockWaitMs: 1200 }), 1200);
  assert.equal(extractStepExternalWaitMs("smoke:ui", { timing: { browserAutomationLockWaitMs: 1200 } }), 0);
  assert.equal(extractStepExternalWaitMs("smoke:browser", { timing: { browserAutomationLockWaitMs: -10 } }), 0);
});

test("protective-state semantics accepts expected guarded and dry-run states", () => {
  const gate = summarizeProtectiveStateSemantics(
    [
      {
        name: "smoke:ui",
        result: {
          runnerStatus: "blocked",
          runnerStatusExpected: true,
          runnerStatusMeaning: "combined smoke intentionally exercises mismatched-identity runner guard",
          bootstrapDryRun: true,
          bootstrapProfileWrites: 3,
          bootstrapApplyExpected: false,
          bootstrapMeaning: "smoke intentionally previews bootstrap and does not persist minimal runtime state",
          bootstrapGateState: {
            runMode: "dry_run_preview",
            dryRun: true,
            profileWrites: 3,
          },
          keychainMigrationApplyExpected: false,
          keychainMigrationMeaning: "combined smoke skips keychain migration because key material is already system protected or keychain is unavailable",
          keychainMigrationGateState: {
            runMode: "not_applicable_skip",
            dryRun: false,
            skipped: true,
          },
          housekeepingApplyExpected: false,
          housekeepingMeaning: "smoke intentionally audits housekeeping impact and only reports would-delete / would-revoke counts",
          housekeepingGateState: {
            runMode: "audit",
            liveLedgerTouched: false,
          },
          runnerGateState: {
            status: "blocked",
          },
        },
      },
      {
        name: "smoke:dom",
        result: {
          deviceSetupComplete: false,
          deviceSetupRunComplete: false,
          deviceSetupCompletionExpected: false,
          deviceSetupCompletionMeaning: "smoke intentionally validates device setup via dry-run/preview and does not finalize setup",
          deviceSetupGateState: {
            runMode: "dry_run_preview",
            statusComplete: false,
            runComplete: false,
          },
          recoveryBundlePersistenceExpected: false,
          recoveryBundleMeaning: "smoke previews recovery bundle export/import and does not persist bundle files",
          recoveryBundleGateState: {
            runMode: "dry_run_preview",
          },
          recoveryRehearsalPersistenceExpected: false,
          recoveryRehearsalMeaning: "smoke runs an inline recovery rehearsal and does not persist rehearsal history",
          recoveryRehearsalGateState: {
            runMode: "inline_preview",
          },
          setupPackagePersistenceExpected: false,
          setupPackageMeaning: "smoke previews setup package shape and does not persist package files",
          setupPackageGateState: {
            runMode: "dry_run_preview",
          },
        },
      },
    ],
    { browserSkipped: true }
  );

  assert.equal(gate.status, "passed");
  assert.deepEqual(gate.failedChecks, []);
  assert.equal(gate.passedChecks, 9);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /RunnerGuard=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /Bootstrap=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /KeychainMigration=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /Housekeeping=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /RecoveryBundle=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /RecoveryRehearsal=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /SetupPackage=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /DeviceSetupPreview=pass/);
});

test("protective-state semantics fails when DOM dry-run expectation metadata is missing", () => {
  const gate = summarizeProtectiveStateSemantics(
    [
      {
        name: "smoke:ui",
        result: {
          runnerStatus: "blocked",
          runnerStatusExpected: true,
          runnerStatusMeaning: "combined smoke intentionally exercises mismatched-identity runner guard",
          bootstrapDryRun: true,
          bootstrapProfileWrites: 3,
          bootstrapApplyExpected: false,
          bootstrapMeaning: "smoke intentionally previews bootstrap and does not persist minimal runtime state",
          bootstrapGateState: {
            runMode: "dry_run_preview",
            dryRun: true,
            profileWrites: 3,
          },
          keychainMigrationApplyExpected: false,
          keychainMigrationMeaning: "combined smoke skips keychain migration because key material is already system protected or keychain is unavailable",
          keychainMigrationGateState: {
            runMode: "not_applicable_skip",
            dryRun: false,
            skipped: true,
          },
          housekeepingApplyExpected: false,
          housekeepingMeaning: "smoke intentionally audits housekeeping impact and only reports would-delete / would-revoke counts",
          housekeepingGateState: {
            runMode: "audit",
            liveLedgerTouched: false,
          },
          runnerGateState: {
            status: "blocked",
          },
        },
      },
      {
        name: "smoke:dom",
        result: {
          deviceSetupComplete: false,
          deviceSetupRunComplete: false,
        },
      },
    ],
    { browserSkipped: true }
  );

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("dom_device_setup_preview_semantics"));
});

test("protective-state semantics fails when browser is expected but missing", () => {
  const gate = summarizeProtectiveStateSemantics([], { browserSkipped: false });

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_skip_semantics"));
});

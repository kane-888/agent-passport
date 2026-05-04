import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  browserUiSemanticsBlocksRelease,
  buildSmokeAllResultEnvelope,
  extractStepExternalWaitMs,
  formatBrowserUiSemanticsSummary,
  formatProtectiveStateSemanticsSummary,
  resolveSmokeAllMode,
  summarizeBrowserUiSemantics,
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

test("smoke orchestration cleanup uses the shared wrapper cleanup helper", () => {
  for (const scriptName of [
    "smoke-all.mjs",
    "smoke-operational-gate.mjs",
    "soak-runtime-stability.mjs",
  ]) {
    const source = fs.readFileSync(path.join(rootDir, "scripts", scriptName), "utf8");
    assert.match(source, /cleanupSmokeWrapperRuntime/u, `${scriptName} should use shared cleanup helper`);
    assert.doesNotMatch(
      source,
      /await smokeServer\.stop\(\);\s*await resolvedDataRoot\.cleanup\(\);/u,
      `${scriptName} should not skip data-root cleanup when server stop fails`
    );
  }
});

test("standalone smoke setup cleans ephemeral roots when initialization fails", () => {
  for (const scriptName of [
    "smoke-dom-combined.mjs",
    "smoke-dom-operational.mjs",
    "smoke-server.mjs",
  ]) {
    const source = fs.readFileSync(path.join(rootDir, "scripts", scriptName), "utf8");
    assert.match(source, /catch\s*\(error\)\s*\{[\s\S]*cleanupSmokeSecretIsolation/u);
    assert.match(source, /cleanupRoot:\s*(smokeRoot|tempRoot)/u);
  }
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

test("smoke-ui keeps runtime observation read-session redaction probes wired", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts", "smoke-ui.mjs"), "utf8");

  assert.match(source, /runtime_summary_observer runtime-summary/u);
  assert.match(source, /runtime_summary_observer runtime-stability/u);
  assert.match(source, /agent_auditor 应允许读取 runtime-summary/u);
  assert.match(source, /agent_auditor 应允许读取 runtime-stability/u);
  assert.match(source, /agents_context 不应读取 runtime-stability/u);
  assert.match(source, /summary-only runtime-summary 不应暴露 correctionActions/u);
  assert.match(source, /summary-only runtime-stability 不应暴露 recent observation 明细/u);
  assert.match(source, /metadata-only runtime-summary recent 不应暴露 correctionActions/u);
});

test("smoke-ui keeps canonical main-agent routes as the default truth for primary agent probes", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts", "smoke-ui.mjs"), "utf8");

  assert.match(source, /mainAgentApiPath\("/u);
  assert.match(source, /let resolvedMainAgentPhysicalId = null;/u);
  assert.match(source, /normalized === MAIN_AGENT_ID && resolvedMainAgentPhysicalId/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/context/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/session-state/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/cognitive-state/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/messages/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/runtime\/search/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/runtime\/rehydrate/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/runtime-summary/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/runtime\/stability/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/credential/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/archives(?:\/restore)?/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/archive-restores(?:\/revert)?/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/passport-memory/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/migration\/repair/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/runtime\/actions/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/verification-runs/u);
  assert.doesNotMatch(source, /\/api\/agents\/agent_openneed_agents\/runner/u);
  assert.doesNotMatch(source, /leftAgentId=agent_openneed_agents/u);
  assert.doesNotMatch(source, /rightAgentId=agent_openneed_agents/u);
  assert.doesNotMatch(source, /policyAgentId:\s*"agent_openneed_agents"/u);
  assert.doesNotMatch(source, /targetAgentId:\s*"agent_openneed_agents"/u);
});

test("smoke-dom keeps canonical main-agent operands as the default truth for primary runtime flows", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts", "smoke-dom.mjs"), "utf8");

  assert.match(source, /listPassportMemories\(MAIN_AGENT_ID/u);
  assert.match(source, /getAgentRuntime\(MAIN_AGENT_ID/u);
  assert.match(source, /getAgentRehydratePack\(MAIN_AGENT_ID/u);
  assert.match(source, /bootstrapAgentRuntime\(\s*MAIN_AGENT_ID/u);
  assert.match(source, /buildAgentContextBundle\(\s*MAIN_AGENT_ID/u);
  assert.match(source, /listAgentTranscript\(MAIN_AGENT_ID/u);
  assert.match(source, /listConversationMinutes\(MAIN_AGENT_ID/u);
  assert.match(source, /searchAgentRuntimeKnowledge\(MAIN_AGENT_ID/u);
  assert.match(source, /executeAgentSandboxAction\(\s*MAIN_AGENT_ID/u);
  assert.match(source, /listAgentSandboxActionAudits\(MAIN_AGENT_ID/u);
  assert.match(source, /getAgentSessionState\(MAIN_AGENT_ID/u);
  assert.match(source, /listCompactBoundaries\(MAIN_AGENT_ID/u);
  assert.match(source, /executeAgentRunner\(\s*MAIN_AGENT_ID/u);
  assert.match(source, /listAgentRuns\(MAIN_AGENT_ID/u);
  assert.match(source, /executeVerificationRun\(\s*MAIN_AGENT_ID/u);
  assert.match(source, /listVerificationRuns\(MAIN_AGENT_ID/u);
  assert.match(source, /checkAgentContextDrift\(\s*MAIN_AGENT_ID/u);
  assert.match(source, /getAgentCredential\(MAIN_AGENT_ID/u);
  assert.doesNotMatch(source, /listPassportMemories\("agent_openneed_agents"/u);
  assert.doesNotMatch(source, /getAgentRuntime\("agent_openneed_agents"/u);
  assert.doesNotMatch(source, /getAgentRehydratePack\("agent_openneed_agents"/u);
  assert.doesNotMatch(source, /bootstrapAgentRuntime\(\s*"agent_openneed_agents"/u);
  assert.doesNotMatch(source, /buildAgentContextBundle\(\s*"agent_openneed_agents"/u);
  assert.doesNotMatch(source, /listAgentTranscript\("agent_openneed_agents"/u);
  assert.doesNotMatch(source, /listConversationMinutes\("agent_openneed_agents"/u);
  assert.doesNotMatch(source, /searchAgentRuntimeKnowledge\("agent_openneed_agents"/u);
  assert.doesNotMatch(source, /executeAgentSandboxAction\(\s*"agent_openneed_agents"/u);
  assert.doesNotMatch(source, /listAgentSandboxActionAudits\("agent_openneed_agents"/u);
  assert.doesNotMatch(source, /getAgentSessionState\("agent_openneed_agents"/u);
  assert.doesNotMatch(source, /listCompactBoundaries\("agent_openneed_agents"/u);
  assert.doesNotMatch(source, /executeAgentRunner\(\s*"agent_openneed_agents"/u);
  assert.doesNotMatch(source, /listAgentRuns\("agent_openneed_agents"/u);
  assert.doesNotMatch(source, /executeVerificationRun\(\s*"agent_openneed_agents"/u);
  assert.doesNotMatch(source, /listVerificationRuns\("agent_openneed_agents"/u);
  assert.doesNotMatch(source, /checkAgentContextDrift\(\s*"agent_openneed_agents"/u);
  assert.doesNotMatch(source, /getAgentCredential\("agent_openneed_agents"/u);
});

test("operational smoke projects memory stability truth from shared public truth before raw state fallback", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts", "smoke-ui-operational.mjs"), "utf8");

  assert.match(source, /\[runtimeSummaryFinal,\s*runtimeStability,\s*securityFinal\]\s*=\s*await Promise\.all/u);
  assert.match(source, /const latestPublicAgentRuntimeTruth = securityFinal\.agentRuntimeTruth \|\| null;/u);
  assert.match(
    source,
    /latestMemoryStabilityStateId:\s*[\s\S]*latestPublicAgentRuntimeTruth\?\.latestMemoryStabilityStateId[\s\S]*latestRuntimeObservation\?\.runtimeMemoryStateId[\s\S]*latestRuntimeMemoryState\?\.runtimeMemoryStateId/u
  );
  assert.match(
    source,
    /latestMemoryStabilityUpdatedAt:\s*[\s\S]*latestPublicAgentRuntimeTruth\?\.latestMemoryStabilityUpdatedAt[\s\S]*latestRuntimeObservation\?\.observedAt[\s\S]*latestRuntimeMemoryState\?\.updatedAt/u
  );
  assert.match(
    source,
    /latestMemoryStabilityCorrectionLevel:\s*[\s\S]*latestPublicAgentRuntimeTruth\?\.latestMemoryStabilityCorrectionLevel[\s\S]*latestRuntimeObservation\?\.correctionLevel[\s\S]*latestRuntimeMemoryState\?\.correctionLevel/u
  );
});

test("operational smoke projects runtime stability comparison fields from observations before latest-state fallback", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts", "smoke-ui-operational.mjs"), "utf8");

  assert.match(
    source,
    /runtimeStabilityLatestStateId:\s*[\s\S]*latestRuntimeStabilityObservation\?\.runtimeMemoryStateId[\s\S]*latestRuntimeStabilityState\?\.runtimeMemoryStateId/u
  );
  assert.match(
    source,
    /runtimeStabilityLatestCorrectionLevel:\s*[\s\S]*latestRuntimeStabilityObservation\?\.correctionLevel[\s\S]*latestRuntimeStabilityState\?\.correctionLevel/u
  );
  assert.match(
    source,
    /runtimeStabilityLatestRiskScore:\s*[\s\S]*latestRuntimeStabilityObservation\?\.cT[\s\S]*latestRuntimeStabilityState\?\.cT/u
  );
});

test("pre-public and smoke runtime helper files stay present", () => {
  for (const target of [
    "scripts/prepare-self-hosted-pre-public.mjs",
    "scripts/self-hosted-config.mjs",
    "scripts/structured-cli-output.mjs",
    "scripts/verifier-outcome-shared.mjs",
    "scripts/smoke-dom-combined.mjs",
    "scripts/smoke-dom-operational.mjs",
    "scripts/smoke-expectations.mjs",
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
    "scripts/smoke-expectations.mjs",
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
    "smoke-expectations.mjs",
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

test("UI smokes promote successful auto-recovery fallback into the asserted result", () => {
  for (const scriptName of ["smoke-ui.mjs", "smoke-ui-operational.mjs"]) {
    const source = fs.readFileSync(path.join(rootDir, "scripts", scriptName), "utf8");
    assert.match(source, /fallbackAutoRecoveredRunner/u, `${scriptName} should keep a fallback auto-recovery branch`);
    assert.match(
      source,
      /autoRecoveredRunner\s*=\s*fallbackAutoRecoveredRunner/u,
      `${scriptName} should assert against the fallback runner when fallback auto-recovery succeeds`
    );
  }
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
    "tests/server-untrusted-route-input.test.mjs",
    "tests/offline-chat-runtime.test.mjs",
    "tests/reasoner-remote-context.test.mjs",
    "tests/runtime-truth-client.test.mjs",
    "tests/runner-auto-recovery.test.mjs",
    "tests/ledger-write-discipline.test.mjs",
    "tests/ledger-recovery-setup-cache.test.mjs",
    "tests/formal-recovery-rehearsal-recency.test.mjs",
    "tests/security-housekeeping-route-redaction.test.mjs",
    "tests/security-incident-packet-route.test.mjs",
    "tests/prepare-self-hosted-pre-public.test.mjs",
    "tests/memory-homeostasis.test.mjs",
    "tests/memory-stability-contract.test.mjs",
    "tests/memory-stability-engine.test.mjs",
    "tests/memory-stability-adapter-contract.test.mjs",
    "tests/memory-stability-staged-adapter.test.mjs",
    "tests/memory-stability-internal-kernel.test.mjs",
    "tests/memory-stability-controlled-adapter.test.mjs",
    "tests/memory-stability-self-learning-governance.test.mjs",
    "tests/memory-stability-negative-cases.test.mjs",
    "tests/memory-stability-runtime-loader.test.mjs",
    "tests/memory-stability-snapshot-tools.test.mjs",
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
  assert.match(smokeAll, /verify-memory-stability-contract\.mjs/);
  assert.match(smokeAll, /verify-memory-stability-engine\.mjs/);
  assert.match(smokeAll, /verify-memory-stability-adapter-contract\.mjs/);
  assert.match(smokeAll, /verify-memory-stability-internal-kernel\.mjs/);
  assert.match(smokeAll, /verify-memory-stability-controlled-adapter\.mjs/);
  assert.match(smokeAll, /verify-memory-stability-self-learning-governance\.mjs/);
  assert.match(smokeAll, /verify-memory-stability-runtime-loader\.mjs/);
  assert.match(smokeAll, /verify-memory-stability-snapshots\.mjs/);
  assert.match(smokeAll, /parallel:\s*runInParallel/);
  assert.match(smokeAll, /failedSteps/);
});

test("smoke:all envelope separates ok status from browser coverage", () => {
  const skippedEnvelope = buildSmokeAllResultEnvelope({
    parallel: true,
    ok: true,
    browserSkipped: true,
    totalDurationMs: 1,
  });

  assert.equal(skippedEnvelope.ok, true);
  assert.equal(skippedEnvelope.browserSkipped, true);
  assert.equal(skippedEnvelope.browserCovered, false);
  assert.equal(skippedEnvelope.fullSmokePassed, false);

  const coveredEnvelope = buildSmokeAllResultEnvelope({
    parallel: true,
    ok: true,
    browserSkipped: false,
    totalDurationMs: 1,
  });

  assert.equal(coveredEnvelope.ok, true);
  assert.equal(coveredEnvelope.browserSkipped, false);
  assert.equal(coveredEnvelope.browserCovered, true);
  assert.equal(coveredEnvelope.fullSmokePassed, true);

  const failedCoveredEnvelope = buildSmokeAllResultEnvelope({
    parallel: true,
    ok: false,
    browserSkipped: false,
    error: "x",
  });

  assert.equal(failedCoveredEnvelope.browserCovered, true);
  assert.equal(failedCoveredEnvelope.fullSmokePassed, false);
});

test("smoke:all treats missing browser semantics as a full browser gate failure", () => {
  const browserGate = summarizeBrowserUiSemantics([], { browserSkipped: false });
  browserGate.summary = formatBrowserUiSemanticsSummary(browserGate);
  const gateFailures = [];

  if (browserUiSemanticsBlocksRelease(browserGate, { browserSkipped: false })) {
    gateFailures.push(browserGate.summary);
  }

  const envelope = buildSmokeAllResultEnvelope({
    parallel: false,
    ok: gateFailures.length === 0,
    browserSkipped: false,
    gateFailures,
    browserUiSemantics: browserGate,
  });

  assert.equal(browserGate.status, "unavailable");
  assert.equal(envelope.ok, false);
  assert.equal(envelope.fullSmokePassed, false);
  assert.match(envelope.gateFailures[0] || "", /browser-ui semantics: unavailable/u);
});

test("smoke:all promotes repair hub legacy main-agent self-heal into a dedicated browser gate", () => {
  const makeBrowserResult = (legacySummary) => ({
    repairId: "repair_123",
    repairHubLegacyCanonicalSummary: legacySummary,
  });
  const passingGate = summarizeBrowserUiSemantics(
    [
      {
        name: "smoke:browser",
        result: makeBrowserResult({
          locationSearch: "?repairId=repair_123&didMethod=agentpassport",
          selectedAgentId: "",
          selectedIssuerAgentId: "",
          selectedDidMethodFilter: "agentpassport",
          selectedRepairId: "repair_123",
        }),
      },
    ],
    { browserSkipped: false }
  );
  const failingGate = summarizeBrowserUiSemantics(
    [
      {
        name: "smoke:browser",
        result: makeBrowserResult({
          locationSearch: "?repairId=repair_123&didMethod=agentpassport&agentId=agent_openneed_agents",
          selectedAgentId: "agent_openneed_agents",
          selectedIssuerAgentId: "",
          selectedDidMethodFilter: "agentpassport",
          selectedRepairId: "repair_123",
        }),
      },
    ],
    { browserSkipped: false }
  );

  assert.equal(
    passingGate.failedChecks.includes("browser_repair_hub_legacy_canonicalization_semantics"),
    false
  );
  assert.equal(
    failingGate.failedChecks.includes("browser_repair_hub_legacy_canonicalization_semantics"),
    true
  );
  assert.match(formatBrowserUiSemanticsSummary(passingGate), /RepairHubLegacy=/u);
});

test("smoke:all keeps repair hub compat evidence in a dedicated browser gate instead of the canonical mainline gate", () => {
  const gate = summarizeBrowserUiSemantics(
    [
      {
        name: "smoke:browser",
        result: {
          baseUrl: "http://127.0.0.1:4319",
          repairId: "repair_1",
          credentialId: "credential_1",
          compatCredentialId: "credential_compat_1",
          repairHubSummary: {
            tokenInputPresent: true,
            mainLinkHref: "http://127.0.0.1:4319/",
            selectedCredentialJsonLength: 120,
            selectedCredentialContainsId: true,
            selectedDidMethodFilter: "agentpassport",
            selectedCredentialParsed: {
              ok: true,
              credentialRecordId: "credential_1",
              issuerDidMethod: "agentpassport",
              repairId: "repair_1",
            },
            statusCards: [
              {
                cardKind: "risk",
                tone: "ready",
                riskState: "active",
                status: "active",
                registryKnown: "true",
                statusMatchesRegistry: "true",
                statusListId: "status_list_1",
                statusListIndex: "3",
                activeEntryId: "status_entry_credential_1",
                missingDidMethodCount: "0",
              },
              {
                cardKind: "evidence",
                tone: "neutral",
                riskState: "active",
                status: "active",
                registryKnown: "true",
                statusMatchesRegistry: "true",
                statusListId: "status_list_1",
                statusListIndex: "3",
                activeEntryId: "status_entry_credential_1",
                missingDidMethodCount: "0",
              },
              {
                cardKind: "action",
                tone: "neutral",
                riskState: "active",
                status: "active",
                registryKnown: "true",
                statusMatchesRegistry: "true",
                statusListId: "status_list_1",
                statusListIndex: "3",
                activeEntryId: "status_entry_credential_1",
                missingDidMethodCount: "0",
              },
            ],
            repairSummaryCards: [
              {
                summaryKind: "repair-verdict",
                repairVerdictState: "public_complete_backlog",
                repairImpactState: "",
                repairNextStepState: "",
                totalSubjects: 0,
                currentViewCredentialCount: 0,
              },
              {
                summaryKind: "repair-impact",
                repairVerdictState: "",
                repairImpactState: "coverage_truth",
                repairNextStepState: "",
                totalSubjects: 1,
                currentViewCredentialCount: 1,
              },
              {
                summaryKind: "repair-next-step",
                repairVerdictState: "",
                repairImpactState: "",
                repairNextStepState: "finish_compatibility_backlog",
                totalSubjects: 0,
                currentViewCredentialCount: 0,
              },
            ],
            repairTruthCard: {
              visibleIssuedDidMethods: ["agentpassport"],
              allIssuedDidMethods: ["agentpassport", "openneed"],
              publicIssuedDidMethods: ["agentpassport"],
              compatibilityIssuedDidMethods: ["openneed"],
              visibleReceiptCount: 1,
              allReceiptCount: 2,
              publicIssuerDid: "did:agentpassport:agent_main",
              compatibilityIssuerDid: "did:openneed:agent_main",
              coverageSource: "after",
              totalSubjects: 1,
              completeSubjectCount: 1,
              publicComplete: true,
              repairComplete: false,
              repairCompleteSubjectCount: 0,
              repairPartialSubjectCount: 1,
              repairableSubjectCount: 1,
              publicMissingDidMethods: [],
              repairMissingDidMethods: ["openneed"],
            },
            selectedRepairId: "repair_1",
          },
          repairHubCompatSummary: {
            tokenInputPresent: true,
            mainLinkHref: "http://127.0.0.1:4319/",
            selectedCredentialJsonLength: 120,
            selectedCredentialContainsId: true,
            selectedDidMethodFilter: "openneed",
            selectedCredentialParsed: {
              ok: true,
              credentialRecordId: "credential_compat_1",
              issuerDidMethod: "openneed",
              repairId: "repair_1",
            },
            statusCards: [
              {
                cardKind: "risk",
                tone: "ready",
                riskState: "active",
                status: "active",
                registryKnown: "true",
                statusMatchesRegistry: "true",
                statusListId: "status_list_1",
                statusListIndex: "3",
                activeEntryId: "status_entry_credential_1",
                missingDidMethodCount: "0",
              },
            ],
            repairSummaryCards: [],
            repairTruthCard: null,
            selectedRepairId: "repair_1",
          },
        },
      },
    ],
    { browserSkipped: false }
  );

  assert.equal(gate.failedChecks.includes("browser_repair_hub_semantics"), false);
  assert.equal(gate.failedChecks.includes("browser_repair_hub_compat_semantics"), true);
  assert.match(formatBrowserUiSemanticsSummary(gate), /RepairHubCompat=fail/u);
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

test("protective-state semantics fails closed when nested UI gate state is missing", () => {
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
          keychainMigrationMeaning:
            "combined smoke skips keychain migration because key material is already system protected or keychain is unavailable",
          housekeepingApplyExpected: false,
          housekeepingMeaning:
            "smoke intentionally audits housekeeping impact and only reports would-delete / would-revoke counts",
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
          deviceSetupCompletionMeaning:
            "smoke intentionally validates device setup via dry-run/preview and does not finalize setup",
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

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("ui_keychain_migration_semantics"));
});

test("protective-state semantics fails when UI and DOM steps are missing even if browser is intentionally skipped", () => {
  const gate = summarizeProtectiveStateSemantics([], { browserSkipped: true });

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("ui_runner_guard_semantics"));
  assert(gate.failedChecks.includes("dom_device_setup_preview_semantics"));
});

test("protective-state semantics fails when browser is expected but missing", () => {
  const gate = summarizeProtectiveStateSemantics([], { browserSkipped: false });

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_skip_semantics"));
});

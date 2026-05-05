import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(rootDir, "src");
const ledgerSource = readFileSync(path.join(srcDir, "ledger.js"), "utf8");
const commandNegotiationSource = readFileSync(path.join(srcDir, "ledger-command-negotiation.js"), "utf8");
const sandboxExecutionSource = readFileSync(path.join(srcDir, "ledger-sandbox-execution.js"), "utf8");
const sandboxAuditSource = readFileSync(path.join(srcDir, "ledger-sandbox-audit.js"), "utf8");
const runtimeStateSource = readFileSync(path.join(srcDir, "ledger-runtime-state.js"), "utf8");
const queryStateSource = readFileSync(path.join(srcDir, "ledger-query-state.js"), "utf8");
const verificationRunSource = readFileSync(path.join(srcDir, "ledger-verification-run.js"), "utf8");
const agentRunSource = readFileSync(path.join(srcDir, "ledger-agent-run.js"), "utf8");
const runnerPipelineSource = readFileSync(path.join(srcDir, "ledger-runner-pipeline.js"), "utf8");
const runnerReasonerPlanSource = readFileSync(path.join(srcDir, "ledger-runner-reasoner-plan.js"), "utf8");
const storeMigrationSource = readFileSync(path.join(srcDir, "ledger-store-migration.js"), "utf8");

test("ledger facade imports runner pipeline, reasoner plan, and store migration seams", () => {
  assert.match(ledgerSource, /from "\.\/ledger-command-negotiation\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-sandbox-execution\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-sandbox-audit\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runtime-state\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-query-state\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-verification-run\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-agent-run\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runner-pipeline\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runner-reasoner-plan\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-store-migration\.js";/);
});

test("command negotiation helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildCommandNegotiationResult",
    "normalizeSandboxProcessArgs",
    "parseSandboxUrl",
    "shouldEnforceSandboxCapabilityAllowlist",
    "isSandboxCapabilityAllowlisted",
    "isLoopbackSandboxHost",
    "sandboxRequestHasProtectedControlPlaneHeaders",
    "sandboxHostMatchesAllowlist",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-command-negotiation.js`
    );
    assert.match(
      commandNegotiationSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-command-negotiation.js`
    );
  }
});

test("sandbox execution helpers stay outside ledger facade", () => {
  for (const functionName of [
    "truncateUtf8TextToByteBudget",
    "resolveSandboxFilesystemPathStrict",
    "resolveSandboxProcessCommandStrict",
    "executeSandboxWorker",
    "attachSandboxBrokerOutput",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?(?:async\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-sandbox-execution.js`
    );
    assert.match(
      sandboxExecutionSource,
      new RegExp(`export (?:async\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-sandbox-execution.js`
    );
  }

  for (const privateHelperName of [
    "isPathWithinRoot",
    "resolveCanonicalExistingPath",
    "computeFileSha256",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:async\\s+)?function ${privateHelperName}\\s*\\(`),
      `${privateHelperName} should remain private to src/ledger-sandbox-execution.js`
    );
    assert.match(
      sandboxExecutionSource,
      new RegExp(`\\n(?:async\\s+)?function ${privateHelperName}\\s*\\(`),
      `${privateHelperName} must be defined in src/ledger-sandbox-execution.js`
    );
  }
});

test("sandbox audit shape helpers stay outside ledger facade", () => {
  for (const functionName of [
    "normalizeSandboxActionAuditStatus",
    "sanitizeSandboxActionInputForAudit",
    "normalizeSandboxActionAuditRecord",
    "buildSandboxActionAuditView",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-sandbox-audit.js`
    );
    assert.match(
      sandboxAuditSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-sandbox-audit.js`
    );
  }
  assert.doesNotMatch(
    ledgerSource,
    /\nconst DEFAULT_SANDBOX_ACTION_AUDIT_LIMIT\s*=/,
    "DEFAULT_SANDBOX_ACTION_AUDIT_LIMIT should remain in src/ledger-sandbox-audit.js"
  );
  assert.match(
    sandboxAuditSource,
    /export const DEFAULT_SANDBOX_ACTION_AUDIT_LIMIT\s*=/,
    "DEFAULT_SANDBOX_ACTION_AUDIT_LIMIT must be exported by src/ledger-sandbox-audit.js"
  );
});

test("runtime bootstrap and session view helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildRuntimeBootstrapGate",
    "buildRuntimeBootstrapGatePreview",
    "buildAgentSessionStateRecord",
    "buildAgentSessionStateView",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-runtime-state.js`
    );
    assert.match(
      runtimeStateSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-runtime-state.js`
    );
  }
});

test("query state shape helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildAgentQueryStateRecord",
    "buildAgentQueryStateView",
    "inferAgentQueryIteration",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-query-state.js`
    );
    assert.match(
      queryStateSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-query-state.js`
    );
  }
});

test("verification run shape helpers stay outside ledger facade", () => {
  for (const functionName of [
    "normalizeVerificationRunStatus",
    "buildVerificationRunRecord",
    "buildVerificationRunView",
    "summarizeVerificationChecks",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-verification-run.js`
    );
    assert.match(
      verificationRunSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-verification-run.js`
    );
  }
});

test("agent run shape helpers stay outside ledger facade", () => {
  for (const functionName of [
    "normalizeAgentRunStatus",
    "buildStoredRunnerReasonerMetadata",
    "buildAgentRunView",
    "buildAgentRunnerRecord",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-agent-run.js`
    );
    assert.match(
      agentRunSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-agent-run.js`
    );
  }
});

test("runner pipeline helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildAutoRecoveryResumePayload",
    "buildBlockedRunnerSandboxExecution",
    "normalizeRunnerConversationTurns",
    "normalizeRunnerToolResults",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\nfunction ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-runner-pipeline.js`
    );
    assert.match(
      runnerPipelineSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-runner-pipeline.js`
    );
  }
});

test("runner reasoner planning helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildRunnerAutoRecoveryFallbackMetadata",
    "buildRunnerReasonerDegradationMetadata",
    "buildRunnerReasonerPlanMetadata",
    "isRunnerOnlineReasonerProvider",
    "isRunnerQualityEscalationLocalReasonerProvider",
    "resolveRunnerLocalReasonerConfig",
    "resolveRunnerReasonerPlan",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-runner-reasoner-plan.js`
    );
    assert.match(
      runnerReasonerPlanSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-runner-reasoner-plan.js`
    );
  }
});

test("store migration shell stays outside ledger facade", () => {
  for (const functionName of [
    "buildMigratedStoreShell",
    "createInitialStoreShell",
    "didStoreShellChange",
  ]) {
    assert.match(
      storeMigrationSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-store-migration.js`
    );
  }
});

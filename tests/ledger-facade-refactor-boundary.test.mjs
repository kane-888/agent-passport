import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
const agentListViewsSource = readFileSync(path.join(srcDir, "ledger-agent-list-views.js"), "utf8");
const compactBoundarySource = readFileSync(path.join(srcDir, "ledger-compact-boundary.js"), "utf8");
const runnerPipelineSource = readFileSync(path.join(srcDir, "ledger-runner-pipeline.js"), "utf8");
const runnerReasonerPlanSource = readFileSync(path.join(srcDir, "ledger-runner-reasoner-plan.js"), "utf8");
const runnerQualitySignalSource = readFileSync(path.join(srcDir, "ledger-runner-quality-signal.js"), "utf8");
const storeMigrationSource = readFileSync(path.join(srcDir, "ledger-store-migration.js"), "utf8");
const autoRecoveryReadinessSource = readFileSync(path.join(srcDir, "ledger-auto-recovery-readiness.js"), "utf8");
const autoRecoveryStateSource = readFileSync(path.join(srcDir, "ledger-auto-recovery-state.js"), "utf8");
const formalRecoveryFlowSource = readFileSync(path.join(srcDir, "ledger-formal-recovery-flow.js"), "utf8");
const archiveStoreSource = readFileSync(path.join(srcDir, "ledger-archive-store.js"), "utf8");
const authorizationProposalViewSource = readFileSync(path.join(srcDir, "ledger-authorization-proposal-view.js"), "utf8");
const runtimeMemoryObservationsSource = readFileSync(path.join(srcDir, "ledger-runtime-memory-observations.js"), "utf8");
const runtimeMemoryHomeostasisSource = readFileSync(path.join(srcDir, "ledger-runtime-memory-homeostasis.js"), "utf8");
const runtimeMemoryStoreSource = readFileSync(path.join(srcDir, "ledger-runtime-memory-store.js"), "utf8");
const promptBudgetSource = readFileSync(path.join(srcDir, "ledger-prompt-budget.js"), "utf8");
const contextBuilderHashSource = readFileSync(path.join(srcDir, "ledger-context-builder-hash.js"), "utf8");
const runtimeBriefingSource = readFileSync(path.join(srcDir, "ledger-runtime-briefing.js"), "utf8");
const localReasonerDefaultsSource = readFileSync(path.join(srcDir, "ledger-local-reasoner-defaults.js"), "utf8");
const localReasonerMigrationSource = readFileSync(path.join(srcDir, "ledger-local-reasoner-migration.js"), "utf8");
const localReasonerOrchestrationSource = readFileSync(path.join(srcDir, "ledger-local-reasoner-orchestration.js"), "utf8");
const localReasonerProfilesSource = readFileSync(path.join(srcDir, "ledger-local-reasoner-profiles.js"), "utf8");
const localReasonerRuntimeSource = readFileSync(path.join(srcDir, "ledger-local-reasoner-runtime.js"), "utf8");
const localReasonerOverridesSource = readFileSync(path.join(srcDir, "ledger-local-reasoner-overrides.js"), "utf8");
const residentGateSource = readFileSync(path.join(srcDir, "ledger-resident-gate.js"), "utf8");
const runtimeSummarySource = readFileSync(path.join(srcDir, "ledger-runtime-summary.js"), "utf8");
const responseCertaintySource = readFileSync(path.join(srcDir, "ledger-response-certainty.js"), "utf8");
const claimExtractionSource = readFileSync(path.join(srcDir, "ledger-claim-extraction.js"), "utf8");
const passportMemoryRulesSource = readFileSync(path.join(srcDir, "ledger-passport-memory-rules.js"), "utf8");
const passportMemoryRecordSource = readFileSync(path.join(srcDir, "ledger-passport-memory-record.js"), "utf8");
const profileMemorySnapshotSource = readFileSync(path.join(srcDir, "ledger-profile-memory-snapshot.js"), "utf8");
const agentMemorySnapshotsSource = readFileSync(path.join(srcDir, "ledger-agent-memory-snapshots.js"), "utf8");
const workingMemoryGateSource = readFileSync(path.join(srcDir, "ledger-working-memory-gate.js"), "utf8");
const passportMemorySupersessionSource = readFileSync(path.join(srcDir, "ledger-passport-memory-supersession.js"), "utf8");
const bootstrapMemoryWritesSource = readFileSync(path.join(srcDir, "ledger-bootstrap-memory-writes.js"), "utf8");
const derivedCacheSource = readFileSync(path.join(srcDir, "ledger-derived-cache.js"), "utf8");
const transcriptModelSource = readFileSync(path.join(srcDir, "ledger-transcript-model.js"), "utf8");
const executionCapabilityBoundarySource = readFileSync(path.join(srcDir, "ledger-execution-capability-boundary.js"), "utf8");
const performanceFingerprintSource = readFileSync(path.join(srcDir, "ledger-performance-fingerprint.js"), "utf8");
const runtimeCachesSource = readFileSync(path.join(srcDir, "ledger-runtime-caches.js"), "utf8");
const agentReferenceSource = readFileSync(path.join(srcDir, "ledger-agent-reference.js"), "utf8");
const identityCompatSource = readFileSync(path.join(srcDir, "ledger-identity-compat.js"), "utf8");
const credentialCacheSource = readFileSync(path.join(srcDir, "ledger-credential-cache.js"), "utf8");
const credentialLabelsSource = readFileSync(path.join(srcDir, "ledger-credential-labels.js"), "utf8");
const credentialCoreSource = readFileSync(path.join(srcDir, "ledger-credential-core.js"), "utf8");
const credentialStatusListSource = readFileSync(path.join(srcDir, "ledger-credential-status-list.js"), "utf8");
const credentialRecordViewSource = readFileSync(path.join(srcDir, "ledger-credential-record-view.js"), "utf8");
const credentialValidationSource = readFileSync(path.join(srcDir, "ledger-credential-validation.js"), "utf8");
const credentialBuildersSource = readFileSync(path.join(srcDir, "ledger-credential-builders.js"), "utf8");
const credentialIssuerSource = readFileSync(path.join(srcDir, "ledger-credential-issuer.js"), "utf8");
const repairLinksSource = readFileSync(path.join(srcDir, "ledger-repair-links.js"), "utf8");
const credentialRepairCoverageSource = readFileSync(path.join(srcDir, "ledger-credential-repair-coverage.js"), "utf8");
const credentialRepairViewSource = readFileSync(path.join(srcDir, "ledger-credential-repair-view.js"), "utf8");
const credentialRepairRunnerSource = readFileSync(path.join(srcDir, "ledger-credential-repair-runner.js"), "utf8");
const agentComparisonSource = readFileSync(path.join(srcDir, "ledger-agent-comparison.js"), "utf8");

test("ledger facade imports runner pipeline, reasoner plan, and store migration seams", () => {
  assert.match(ledgerSource, /from "\.\/ledger-command-negotiation\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-sandbox-execution\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-sandbox-audit\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runtime-state\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-query-state\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-verification-run\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-agent-run\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-agent-list-views\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-compact-boundary\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runner-pipeline\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runner-reasoner-plan\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runner-quality-signal\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-store-migration\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-auto-recovery-readiness\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-auto-recovery-state\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-formal-recovery-flow\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-archive-store\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runtime-memory-observations\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runtime-memory-homeostasis\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runtime-memory-store\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-prompt-budget\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-context-builder-hash\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runtime-briefing\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-local-reasoner-migration\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-local-reasoner-orchestration\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-local-reasoner-profiles\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-local-reasoner-runtime\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-local-reasoner-overrides\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-resident-gate\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runtime-summary\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-response-certainty\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-claim-extraction\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-passport-memory-rules\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-passport-memory-record\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-profile-memory-snapshot\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-agent-memory-snapshots\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-working-memory-gate\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-passport-memory-supersession\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-bootstrap-memory-writes\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-derived-cache\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-transcript-model\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-execution-capability-boundary\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-performance-fingerprint\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runtime-caches\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-agent-reference\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-authorization-proposal-view\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-identity-compat\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-labels\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-core\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-status-list\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-record-view\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-validation\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-builders\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-issuer\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-repair-coverage\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-repair-view\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-repair-runner\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-agent-comparison\.js";/);
});

test("extracted ledger modules do not import the ledger facade", () => {
  const extractedModules = readdirSync(srcDir).filter((filename) =>
    /^ledger-.+\.js$/u.test(filename)
  );
  assert.equal(extractedModules.length > 0, true);
  for (const filename of extractedModules) {
    const source = readFileSync(path.join(srcDir, filename), "utf8");
    assert.doesNotMatch(source, /from ["']\.\/ledger\.js["']/u, `${filename} must not import ledger.js`);
    assert.doesNotMatch(source, /from ["']\.\.\/src\/ledger\.js["']/u, `${filename} must not import ledger.js`);
  }
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

test("agent list view helpers stay outside ledger facade", () => {
  for (const functionName of [
    "listAgentWindows",
    "listAgentMemories",
    "listAgentInbox",
    "listAgentOutbox",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-agent-list-views.js`
    );
    assert.match(
      agentListViewsSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-agent-list-views.js`
    );
  }
});

test("compact boundary shape helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildCompactBoundaryView",
    "buildCompactBoundaryRecord",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-compact-boundary.js`
    );
    assert.match(
      compactBoundarySource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-compact-boundary.js`
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

test("runner quality signal helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildRunnerVerificationIssueCodes",
    "isVerifiedMemoryStabilityPromptPreflightForQualitySignal",
    "buildRunnerMemoryStabilityQualitySignal",
    "buildRunnerReasonerQualityEscalationDecision",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-runner-quality-signal.js`
    );
    assert.match(
      runnerQualitySignalSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-runner-quality-signal.js`
    );
  }
});

test("auto recovery state helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildAutoRecoveryAttemptRecord",
    "buildAutoRecoveryClosure",
    "buildDisabledAutoRecoveryState",
    "attachAutoRecoveryState",
    "mergeResumedAutoRecoveryResult",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-auto-recovery-state.js`
    );
    assert.match(
      autoRecoveryStateSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-auto-recovery-state.js`
    );
  }
});

test("runtime memory observation helpers stay outside ledger facade", () => {
  for (const functionName of [
    "clampMemoryHomeostasisMetric",
    "roundMemoryHomeostasisMetric",
    "normalizeRuntimeMemoryObservationKind",
    "normalizeRuntimeMemoryObservationTrend",
    "normalizeRuntimeMemoryObservationCorrectionLevel",
    "getRuntimeMemoryObservationCorrectionSeverity",
    "resolveRuntimeMemoryObservationCorrectionActions",
    "computeRuntimeMemoryObservationCalibrationWeight",
    "normalizeRuntimeMemoryObservationRecord",
    "appendRuntimeMemoryObservation",
    "listRuntimeMemoryObservationsFromStore",
    "buildAgentRuntimeMemoryObservationCollectionSummary",
    "buildRuntimeMemoryObservationSummaryView",
    "buildRuntimeMemoryCorrectionEffectivenessSummary",
    "buildRuntimeMemoryObservationCollectionSummary",
    "isObservedStableRuntimeMemoryObservation",
    "isObservedUnstableRuntimeMemoryObservation",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-runtime-memory-observations.js`
    );
    assert.match(
      runtimeMemoryObservationsSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-runtime-memory-observations.js`
    );
  }
});

test("runtime memory homeostasis helpers stay outside ledger facade", () => {
  for (const functionName of [
    "listModelProfilesFromStore",
    "isOperationalMemoryHomeostasisProfile",
    "computeMemoryHomeostasisQuantile",
    "computeWeightedMemoryHomeostasisQuantile",
    "isTrustedRuntimeMemoryHomeostasisProfile",
    "estimateObservedRuntimeMidDrop",
    "buildObservedRuntimeMemoryHomeostasisProfile",
    "resolveActiveMemoryHomeostasisModelName",
    "buildFallbackMemoryHomeostasisModelProfile",
    "resolveRuntimeMemoryHomeostasisProfile",
    "summarizeMemoryHomeostasisText",
    "buildMemoryHomeostasisPromptAnchorEntries",
    "syncContextBuilderMemoryHomeostasisDerivedViews",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-runtime-memory-homeostasis.js`
    );
    assert.match(
      runtimeMemoryHomeostasisSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-runtime-memory-homeostasis.js`
    );
  }
  assert.match(
    runtimeMemoryHomeostasisSource,
    /export const DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT/u,
    "runtime context token limit must be owned by the runtime memory homeostasis adapter"
  );
});

test("runtime memory store adapter helpers stay outside ledger facade", () => {
  for (const functionName of [
    "listRuntimeMemoryStatesFromStore",
    "upsertRuntimeMemoryState",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-runtime-memory-store.js`
    );
    assert.match(
      runtimeMemoryStoreSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-runtime-memory-store.js`
    );
  }
  assert.doesNotMatch(
    runtimeMemoryStoreSource,
    /from ["']\.\/ledger\.js["']/u,
    "runtime memory store adapter must not import the ledger facade"
  );
});

test("prompt budget helpers stay outside ledger facade", () => {
  for (const functionName of [
    "stringifyPromptSection",
    "estimatePromptTokens",
    "truncatePromptTextByTokenBudget",
    "truncatePromptSection",
    "buildBudgetedPromptSections",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-prompt-budget.js`
    );
    assert.match(
      promptBudgetSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-prompt-budget.js`
    );
  }
  assert.doesNotMatch(
    ledgerSource,
    /\nconst DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT\s*=/u,
    "DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT should remain in src/ledger-prompt-budget.js"
  );
  assert.match(
    promptBudgetSource,
    /export const DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT\s*=/u,
    "DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT must be exported by src/ledger-prompt-budget.js"
  );
});

test("context builder hash helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildContextBuilderHash",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-context-builder-hash.js`
    );
    assert.match(
      contextBuilderHashSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-context-builder-hash.js`
    );
  }
});

test("runtime briefing helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildRuntimeBriefing",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-runtime-briefing.js`
    );
    assert.match(
      runtimeBriefingSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-runtime-briefing.js`
    );
  }
});

test("local reasoner default helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildDefaultDeviceLocalReasonerMigrationResult",
    "buildDefaultDeviceLocalReasonerTargetConfig",
    "localReasonerNeedsDefaultMigration",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-local-reasoner-defaults.js`
    );
    assert.match(
      localReasonerDefaultsSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-local-reasoner-defaults.js`
    );
  }
});

test("local reasoner migration orchestration stays outside ledger facade", () => {
  for (const functionName of [
    "runDefaultDeviceLocalReasonerMigration",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?(?:async\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-local-reasoner-migration.js`
    );
    assert.match(
      localReasonerMigrationSource,
      new RegExp(`export (?:async\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-local-reasoner-migration.js`
    );
  }
});

test("local reasoner in-store orchestration helpers stay outside ledger facade", () => {
  for (const functionName of [
    "activateDeviceLocalReasonerProfileInStore",
    "prewarmDeviceLocalReasonerInStore",
    "restoreDeviceLocalReasonerInStore",
    "selectDeviceLocalReasonerInStore",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?(?:async\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-local-reasoner-orchestration.js`
    );
    assert.match(
      localReasonerOrchestrationSource,
      new RegExp(`export (?:async\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-local-reasoner-orchestration.js`
    );
  }
});

test("local reasoner profile helpers stay outside ledger facade", () => {
  for (const functionName of [
    "applyDefaultLocalReasonerProfileMigrationToStore",
    "applyLocalReasonerProfileActivationToStore",
    "applyLocalReasonerProfileDeleteToStore",
    "applyLocalReasonerProfileSaveToStore",
    "buildDefaultLocalReasonerProfileMigrationEventPayload",
    "buildDefaultLocalReasonerProfileMigrationPlan",
    "buildDefaultLocalReasonerProfileMigrationResult",
    "buildDefaultMigratedLocalReasonerProfile",
    "buildDryRunActivatedLocalReasonerProfile",
    "buildLocalReasonerProfileActivatedEventPayload",
    "buildLocalReasonerProfileActivationPayload",
    "buildLocalReasonerProfileActivationResult",
    "buildLocalReasonerProfileDeletedEventPayload",
    "buildLocalReasonerProfileDeletePlan",
    "buildLocalReasonerProfileDeleteResult",
    "buildLocalReasonerProfileList",
    "buildLocalReasonerProfileLoadResult",
    "buildLocalReasonerProfileSavePlan",
    "buildLocalReasonerProfileSavedEventPayload",
    "buildLocalReasonerProfileSaveResult",
    "buildLocalReasonerRestoreActivationPayload",
    "buildLocalReasonerRestoreCandidatesFromProfiles",
    "buildLocalReasonerRestorePrewarmPayload",
    "buildLocalReasonerRestoreResult",
    "resolveLocalReasonerProfileRecord",
    "resolveLocalReasonerRestoreTarget",
    "shouldReuseLocalReasonerRestorePrewarm",
    "syncLocalReasonerProfileRuntimeStateInStore",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-local-reasoner-profiles.js`
    );
    assert.match(
      localReasonerProfilesSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-local-reasoner-profiles.js`
    );
  }
});

test("local reasoner runtime helpers stay outside ledger facade", () => {
  for (const functionName of [
    "applyDeviceLocalReasonerConfigToStore",
    "applyDeviceLocalReasonerPrewarmToStore",
    "applyDeviceLocalReasonerSelectionToStore",
    "buildDeviceLocalReasonerInspectionResult",
    "buildDeviceLocalReasonerCatalogProviderEntry",
    "buildDeviceLocalReasonerCatalogProviders",
    "buildDeviceLocalReasonerCatalogResult",
    "buildDeviceLocalReasonerProbeResult",
    "buildDeviceLocalReasonerRuntimeConfiguredEventPayload",
    "appendDeviceLocalReasonerRuntimeConfiguredEvent",
    "buildPassiveLocalReasonerDiagnostics",
    "buildRuntimeLocalReasonerPrewarmCandidatePayload",
    "buildRuntimeLocalReasonerPrewarmContextBuilder",
    "buildRuntimeLocalReasonerPrewarmStateResult",
    "buildDeviceLocalReasonerPrewarmResult",
    "buildReusableLocalReasonerPrewarmResult",
    "prewarmRuntimeLocalReasoner",
    "resolveDeviceLocalReasonerCatalogSelectedProvider",
    "resolveDeviceLocalReasonerInspectionDiagnostics",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-local-reasoner-runtime.js`
    );
    assert.match(
      localReasonerRuntimeSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-local-reasoner-runtime.js`
    );
  }
});

test("local reasoner override helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildDeviceLocalReasonerProbeCandidateConfig",
    "buildLocalReasonerProbeConfig",
    "buildSelectedDeviceLocalReasonerConfig",
    "buildPrewarmDeviceLocalReasonerConfig",
    "resolveLocalReasonerPayloadOverride",
    "mergeRunnerLocalReasonerOverride",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-local-reasoner-overrides.js`
    );
    assert.match(
      localReasonerOverridesSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-local-reasoner-overrides.js`
    );
  }
});

test("resident gate helpers stay outside ledger facade", () => {
  for (const functionName of [
    "resolveResidentAgentBinding",
    "buildResidentAgentGate",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-resident-gate.js`
    );
    assert.match(
      residentGateSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-resident-gate.js`
    );
  }
});

test("runtime summary helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildAgentRunGovernanceSummary",
    "buildHybridRuntimeSummary",
    "buildRuntimeCognitionSummary",
    "buildBridgeRuntimeSummary",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-runtime-summary.js`
    );
    assert.match(
      runtimeSummarySource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-runtime-summary.js`
    );
  }
});

test("response certainty helpers stay outside ledger facade", () => {
  for (const functionName of [
    "collectResponseCertaintyHits",
    "buildResponseCertaintySignal",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-response-certainty.js`
    );
    assert.match(
      responseCertaintySource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-response-certainty.js`
    );
  }
  assert.doesNotMatch(
    ledgerSource,
    /\nconst DEFAULT_RESPONSE_(?:STRONG|HEDGED)_CERTAINTY_PATTERNS\s*=/u,
    "response certainty pattern constants should remain in src/ledger-response-certainty.js"
  );
});

test("claim extraction helpers stay outside ledger facade", () => {
  for (const functionName of [
    "extractClaimValueFromText",
    "splitResponseIntoSentences",
    "mapPassportFieldToClaimKey",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-claim-extraction.js`
    );
    assert.match(
      claimExtractionSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-claim-extraction.js`
    );
  }
});

test("passport memory rule helpers stay outside ledger facade", () => {
  for (const functionName of [
    "normalizeTaskSnapshotStatus",
    "normalizeDecisionLogStatus",
    "normalizeEvidenceRefKind",
    "normalizePassportMemoryLayer",
    "normalizePassportMemorySourceType",
    "normalizePassportMemoryConsolidationState",
    "normalizePassportMemoryUnitScore",
    "inferPassportMemorySourceType",
    "inferPassportMemoryConsolidationState",
    "normalizePassportNeuromodulation",
    "inferPassportSourceFeatureDefaults",
    "computePassportSourceTrustScore",
    "computePassportRealityMonitoringScore",
    "computePassportInternalGenerationRisk",
    "normalizePassportSourceFeatures",
    "inferPassportEligibilityWindowHours",
    "buildPassportEligibilityTrace",
    "computePassportAllocationBias",
    "inferPassportReconsolidationWindowHours",
    "isPassportMemoryActive",
    "isPassportMemoryDestabilized",
    "extractPassportMemoryComparableValue",
    "defaultPassportMemorySalience",
    "defaultPassportMemoryConfidence",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-passport-memory-rules.js`
    );
    assert.match(
      passportMemoryRulesSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-passport-memory-rules.js`
    );
  }

  for (const constantName of [
    "TASK_SNAPSHOT_STATUSES",
    "DECISION_LOG_STATUSES",
    "EVIDENCE_REF_KINDS",
    "PASSPORT_MEMORY_LAYERS",
    "PASSPORT_MEMORY_SOURCE_TYPES",
    "PASSPORT_MEMORY_CONSOLIDATION_STATES",
    "DEFAULT_LAYER_RECONSOLIDATION_WINDOW_HOURS",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\nconst ${constantName}\\s*=`),
      `${constantName} should remain private to src/ledger-passport-memory-rules.js`
    );
    assert.match(
      passportMemoryRulesSource,
      new RegExp(`\\nconst ${constantName}\\s*=`),
      `${constantName} must be defined in src/ledger-passport-memory-rules.js`
    );
  }
});

test("passport memory record helpers stay outside ledger facade", () => {
  for (const functionName of [
    "derivePassportMemoryPatternKey",
    "derivePassportMemorySeparationKey",
    "normalizePassportMemoryRecord",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-passport-memory-record.js`
    );
    assert.match(
      passportMemoryRecordSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-passport-memory-record.js`
    );
  }
});

test("profile memory snapshot helpers stay outside ledger facade", () => {
  assert.doesNotMatch(
    ledgerSource,
    /\n(?:export\s+)?function buildProfileMemorySnapshot\s*\(/,
    "buildProfileMemorySnapshot should remain in src/ledger-profile-memory-snapshot.js"
  );
  assert.match(
    profileMemorySnapshotSource,
    /export function buildProfileMemorySnapshot\s*\(/,
    "buildProfileMemorySnapshot must be exported by src/ledger-profile-memory-snapshot.js"
  );
  assert.doesNotMatch(
    ledgerSource,
    /\nconst DEFAULT_HOT_PROFILE_MEMORY_LIMIT\s*=/,
    "DEFAULT_HOT_PROFILE_MEMORY_LIMIT should remain private to src/ledger-profile-memory-snapshot.js"
  );
  assert.match(
    profileMemorySnapshotSource,
    /\nconst DEFAULT_HOT_PROFILE_MEMORY_LIMIT\s*=/,
    "DEFAULT_HOT_PROFILE_MEMORY_LIMIT must be defined in src/ledger-profile-memory-snapshot.js"
  );
});

test("agent memory layer snapshot helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildLedgerMemorySnapshot",
    "buildWorkingMemorySnapshot",
    "buildEpisodicMemorySnapshot",
    "buildSemanticMemorySnapshot",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-agent-memory-snapshots.js`
    );
    assert.match(
      agentMemorySnapshotsSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-agent-memory-snapshots.js`
    );
  }

  for (const constantName of [
    "DEFAULT_HOT_WORKING_MEMORY_LIMIT",
    "DEFAULT_HOT_EPISODIC_MEMORY_LIMIT",
    "DEFAULT_HOT_SEMANTIC_MEMORY_LIMIT",
    "DEFAULT_HOT_LEDGER_MEMORY_LIMIT",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\nconst ${constantName}\\s*=`),
      `${constantName} should remain private to src/ledger-agent-memory-snapshots.js`
    );
    assert.match(
      agentMemorySnapshotsSource,
      new RegExp(`\\nconst ${constantName}\\s*=`),
      `${constantName} must be defined in src/ledger-agent-memory-snapshots.js`
    );
  }
});

test("working memory gate helpers stay outside ledger facade", () => {
  for (const functionName of [
    "annotateWorkingMemoryEntryWithGate",
    "buildWorkingMemoryGateDecision",
    "selectGatedWorkingMemories",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-working-memory-gate.js`
    );
    assert.match(
      workingMemoryGateSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-working-memory-gate.js`
    );
  }

  for (const constantName of [
    "DEFAULT_WORKING_MEMORY_GATE_OPEN_THRESHOLD",
    "DEFAULT_WORKING_MEMORY_GATE_MAX_SELECTION",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\nconst ${constantName}\\s*=`),
      `${constantName} should remain private to src/ledger-working-memory-gate.js`
    );
    assert.match(
      workingMemoryGateSource,
      new RegExp(`\\nconst ${constantName}\\s*=`),
      `${constantName} must be defined in src/ledger-working-memory-gate.js`
    );
  }
});

test("passport memory supersession helpers stay outside ledger facade", () => {
  for (const functionName of [
    "shouldSupersedePassportField",
    "scoreStatefulSemanticRecord",
    "findDominantStatefulSemanticRecord",
    "applyPassportMemorySupersession",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-passport-memory-supersession.js`
    );
    assert.match(
      passportMemorySupersessionSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-passport-memory-supersession.js`
    );
  }

  for (const privateHelperName of [
    "getStatefulSemanticValue",
    "getStatefulSemanticLadderStageStatus",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\nfunction ${privateHelperName}\\s*\\(`),
      `${privateHelperName} should remain private to src/ledger-passport-memory-supersession.js`
    );
    assert.match(
      passportMemorySupersessionSource,
      new RegExp(`\\nfunction ${privateHelperName}\\s*\\(`),
      `${privateHelperName} must be defined in src/ledger-passport-memory-supersession.js`
    );
  }

  for (const constantName of [
    "STATEFUL_SEMANTIC_SUPERSEDED_FIELDS",
    "STATEFUL_SEMANTIC_DECISION_STATUS_PRIORITIES",
    "STATEFUL_SEMANTIC_CONFIRMATION_PRIORITIES",
    "STATEFUL_SEMANTIC_SOURCE_PRIORITIES",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\nconst ${constantName}\\s*=`),
      `${constantName} should remain private to src/ledger-passport-memory-supersession.js`
    );
    assert.match(
      passportMemorySupersessionSource,
      new RegExp(`\\nconst ${constantName}\\s*=`),
      `${constantName} must be defined in src/ledger-passport-memory-supersession.js`
    );
  }
});

test("bootstrap memory write helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildBootstrapProfileMemoryWrites",
    "buildBootstrapWorkingMemoryWrites",
    "buildBootstrapLedgerMemoryWrites",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-bootstrap-memory-writes.js`
    );
    assert.match(
      bootstrapMemoryWritesSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-bootstrap-memory-writes.js`
    );
  }
});

test("derived cache helpers stay outside ledger facade", () => {
  for (const functionName of [
    "cacheStoreDerivedView",
    "buildCollectionTailToken",
    "buildAgentScopedDerivedCacheKey",
    "buildStoreScopedDerivedCacheKey",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-derived-cache.js`
    );
    assert.match(
      derivedCacheSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-derived-cache.js`
    );
  }
});

test("transcript model helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildTranscriptMessageBlocks",
    "buildTranscriptModelSnapshot",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-transcript-model.js`
    );
    assert.match(
      transcriptModelSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-transcript-model.js`
    );
  }
  assert.doesNotMatch(
    ledgerSource,
    /\nconst DEFAULT_TRANSCRIPT_LIMIT\s*=/u,
    "DEFAULT_TRANSCRIPT_LIMIT should remain in src/ledger-transcript-model.js"
  );
  assert.match(
    transcriptModelSource,
    /export const DEFAULT_TRANSCRIPT_LIMIT\s*=/u,
    "DEFAULT_TRANSCRIPT_LIMIT must be exported by src/ledger-transcript-model.js"
  );
});

test("execution capability boundary helper stays outside ledger facade", () => {
  for (const functionName of [
    "buildExecutionCapabilityBoundarySummary",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-execution-capability-boundary.js`
    );
    assert.match(
      executionCapabilityBoundarySource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-execution-capability-boundary.js`
    );
  }
});

test("performance fingerprint helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildStorePerformanceFingerprint",
    "buildAgentContextPerformanceFingerprint",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-performance-fingerprint.js`
    );
    assert.match(
      performanceFingerprintSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-performance-fingerprint.js`
    );
  }
});

test("runtime cache helpers stay outside ledger facade", () => {
  for (const functionName of [
    "getCachedRehydratePack",
    "setCachedRehydratePack",
    "getCachedRuntimeSnapshot",
    "setCachedRuntimeSnapshot",
    "getCachedPassportMemoryList",
    "setCachedPassportMemoryList",
    "getCachedTimedSnapshot",
    "setCachedTimedSnapshot",
    "getCachedTranscriptEntryList",
    "setCachedTranscriptEntryList",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-runtime-caches.js`
    );
    assert.match(
      runtimeCachesSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-runtime-caches.js`
    );
  }

  for (const constantName of [
    "DEFAULT_REHYDRATE_CACHE_MAX_ENTRIES",
    "RUNTIME_SUMMARY_CACHE",
    "AGENT_CONTEXT_CACHE",
    "AGENT_CREDENTIAL_CACHE",
    "ARCHIVED_RECORDS_CACHE",
    "ARCHIVE_RESTORE_EVENTS_CACHE",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?const ${constantName}\\s*=`),
      `${constantName} should remain in src/ledger-runtime-caches.js`
    );
    assert.match(
      runtimeCachesSource,
      new RegExp(`export const ${constantName}\\s*=`),
      `${constantName} must be exported by src/ledger-runtime-caches.js`
    );
  }
});

test("agent reference helpers stay outside ledger facade", () => {
  for (const functionName of [
    "normalizeWindowId",
    "resolveAgentReferenceFromStore",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-agent-reference.js`
    );
    assert.match(
      agentReferenceSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-agent-reference.js`
    );
  }
});

test("authorization proposal view helpers stay outside ledger facade", () => {
  for (const functionName of [
    "listAuthorizationProposalViews",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-authorization-proposal-view.js`
    );
    assert.match(
      authorizationProposalViewSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-authorization-proposal-view.js`
    );
  }
});

test("identity compatibility helpers stay outside ledger facade", () => {
  for (const functionName of [
    "listCompatibleAgentIds",
    "resolveStoredAgent",
    "resolveStoredAgentId",
    "canonicalizeResidentAgentReference",
    "resolveDefaultResidentAgent",
    "resolveDefaultResidentAgentId",
    "buildMainAgentIdentityOwnerBinding",
    "buildCompatibleAgentIdSet",
    "matchesCompatibleAgentId",
    "findAgentByDid",
    "findAgentByWalletAddress",
    "normalizeSignerFingerprint",
    "compareSignedSet",
    "canonicalizeArchiveIdentityView",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-identity-compat.js`
    );
    assert.match(
      identityCompatSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-identity-compat.js`
    );
  }
});

test("credential cache and label helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildCredentialDerivedCollectionToken",
    "buildCredentialRecordCacheScope",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-credential-cache.js`
    );
    assert.match(
      credentialCacheSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-credential-cache.js`
    );
  }

  for (const functionName of [
    "credentialSubjectLabel",
    "credentialIssuerLabel",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-credential-labels.js`
    );
    assert.match(
      credentialLabelsSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-credential-labels.js`
    );
  }
});

test("credential core helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildLocalCredential",
    "normalizeCredentialRecord",
    "createCredentialRecord",
    "normalizeCredentialStatusListReference",
    "credentialStatusListIssuerDidFromId",
    "resolveAgentDidForMethod",
    "didMethodFromReference",
    "listRequestedDidMethods",
    "buildCredentialDidMethodAvailability",
    "formatCredentialExportVariants",
    "compareCredentialIds",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-credential-core.js`
    );
    assert.match(
      credentialCoreSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-credential-core.js`
    );
  }
});

test("credential status list helpers stay outside ledger facade", () => {
  for (const functionName of [
    "credentialStatusListIssuerAgent",
    "credentialStatusListIssuerDid",
    "credentialStatusListId",
    "resolveCredentialStatusListReference",
    "getCredentialStatusIndexMap",
    "setCredentialStatusIndexMap",
    "getNextCredentialStatusIndex",
    "allocateCredentialStatusPointer",
    "collectCredentialStatusIssuerDids",
    "buildCredentialStatusLists",
    "buildCredentialStatusList",
    "buildCredentialStatusListIssuerProfile",
    "buildCredentialStatusListComparison",
    "buildCredentialStatusProof",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-credential-status-list.js`
    );
    assert.match(
      credentialStatusListSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-credential-status-list.js`
    );
  }
});

test("credential record view helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildCredentialTimeline",
    "isCredentialRelatedToAgent",
    "buildCredentialRecordView",
    "credentialSiblingGroupKey",
    "listSiblingCredentialRecords",
    "summarizeSiblingCredentialRecord",
    "buildCredentialSiblingSummary",
    "buildCredentialSiblingSummaryFromRecords",
    "listCredentialRecordViews",
    "findCredentialRecordBySiblingGroupKey",
    "findCredentialRecordById",
    "findCredentialRecordByCredential",
    "findLatestCredentialRecordForSubject",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-credential-record-view.js`
    );
    assert.match(
      credentialRecordViewSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-credential-record-view.js`
    );
  }
});

test("credential validation helpers stay outside ledger facade", () => {
  for (const functionName of [
    "credentialRecordHasValidProof",
    "verifyCredentialInStore",
    "credentialUsesAgentPassportSignature",
    "credentialUsesCanonicalAgentPassportTypes",
    "credentialRecordUsesIssuerDid",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-credential-validation.js`
    );
    assert.match(
      credentialValidationSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-credential-validation.js`
    );
  }
});

test("credential builder helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildAgentCredential",
    "buildAuthorizationProposalCredential",
    "buildAgentComparisonEvidenceCredential",
    "buildMigrationRepairReceiptCredential",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-credential-builders.js`
    );
    assert.match(
      credentialBuildersSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-credential-builders.js`
    );
  }
});

test("credential issuer helpers stay outside ledger facade", () => {
  for (const functionName of [
    "ensureCredentialSnapshotRecord",
    "revokeCredentialRecord",
    "ensureAgentCredentialSnapshot",
    "ensureAuthorizationCredentialSnapshot",
    "findReusableAgentCredentialSnapshot",
    "findReusableAuthorizationCredentialSnapshot",
    "buildAgentCredentialExport",
    "buildAuthorizationProposalCredentialExport",
    "exportAgentCredentialInStore",
    "exportAuthorizationProposalCredentialInStore",
    "revokeCredentialInStore",
    "issueMigrationRepairReceipt",
    "ensureAgentComparisonCredentialSnapshot",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-credential-issuer.js`
    );
    assert.match(
      credentialIssuerSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-credential-issuer.js`
    );
  }
  assert.doesNotMatch(
    ledgerSource,
    /\nfunction buildAgentCredentialPerformanceFingerprint\s*\(/,
    "buildAgentCredentialPerformanceFingerprint should remain private to src/ledger-credential-issuer.js"
  );
  assert.match(
    credentialIssuerSource,
    /\nfunction buildAgentCredentialPerformanceFingerprint\s*\(/,
    "buildAgentCredentialPerformanceFingerprint must be defined in src/ledger-credential-issuer.js"
  );
});

test("agent comparison view helpers stay outside ledger facade", () => {
  for (const functionName of [
    "compareTextSet",
    "buildAgentMigrationDiff",
    "buildAgentComparisonSnapshot",
    "buildAgentComparisonSubjectId",
    "buildAgentComparisonSubjectLabel",
    "buildAgentComparisonView",
    "formatAgentComparisonView",
    "buildAgentComparisonExport",
    "formatAgentComparisonEvidenceResponse",
    "buildAgentComparisonEvidenceExport",
    "resolveAgentComparisonAuditPair",
    "listAgentComparisonAuditViews",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-agent-comparison.js`
    );
    assert.match(
      agentComparisonSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-agent-comparison.js`
    );
  }
});

test("migration repair link helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildMigrationRepairSummary",
    "collectMigrationRepairRelatedAgentIds",
    "buildMigrationRepairLinks",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-repair-links.js`
    );
    assert.match(
      repairLinksSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-repair-links.js`
    );
  }
});

test("credential repair coverage helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildComparisonRepairReferences",
    "normalizeComparisonRepairPairInput",
    "normalizeComparisonRepairPairList",
    "resolveComparisonRepairPairSubjects",
    "isReusableComparisonCredentialSnapshot",
    "buildComparisonRepairPairState",
    "buildCredentialRepairTarget",
    "buildAgentCredentialMethodCoverage",
    "summarizeCredentialMethodCoverage",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-credential-repair-coverage.js`
    );
    assert.match(
      credentialRepairCoverageSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-credential-repair-coverage.js`
    );
  }
});

test("credential repair runner helpers stay outside ledger facade", () => {
  for (const functionName of [
    "runAgentComparisonMigrationRepair",
    "runAgentCredentialMigrationRepair",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-credential-repair-runner.js`
    );
    assert.match(
      credentialRepairRunnerSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-credential-repair-runner.js`
    );
  }
});

test("credential repair view glue stays outside ledger facade", () => {
  for (const functionName of [
    "summarizeCredentialTimelineTimingWithDeps",
    "listMigrationRepairViewsWithDeps",
    "listCredentialRepairHistoryWithCache",
    "buildCredentialRepairAggregatesWithDeps",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-credential-repair-view.js`
    );
    assert.match(
      credentialRepairViewSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-credential-repair-view.js`
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

test("auto recovery readiness helpers stay outside ledger facade", () => {
  for (const functionName of [
    "filterAutoRecoveryGateReasonsForAction",
    "buildAutomaticRecoveryReadiness",
    "buildPlanSpecificAutomaticRecoveryReadiness",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-auto-recovery-readiness.js`
    );
    assert.match(
      autoRecoveryReadinessSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-auto-recovery-readiness.js`
    );
  }

  assert.doesNotMatch(
    ledgerSource,
    /\nconst DEFAULT_RUNNER_AUTO_RECOVERY_MAX_ATTEMPTS\s*=/,
    "DEFAULT_RUNNER_AUTO_RECOVERY_MAX_ATTEMPTS should remain in src/ledger-auto-recovery-readiness.js"
  );
  assert.match(
    autoRecoveryReadinessSource,
    /export const DEFAULT_RUNNER_AUTO_RECOVERY_MAX_ATTEMPTS\s*=/,
    "DEFAULT_RUNNER_AUTO_RECOVERY_MAX_ATTEMPTS must be exported by src/ledger-auto-recovery-readiness.js"
  );
});

test("formal recovery flow helpers stay outside ledger facade", () => {
  for (const functionName of [
    "labelRecoveryRehearsalStatus",
    "summarizeRecoveryBundleForFormalStatus",
    "summarizeSetupPackageForFormalStatus",
    "buildFormalRecoveryFlowStatus",
    "buildFormalRecoveryRunbook",
    "buildFormalRecoveryOperationalCadence",
    "buildFormalRecoveryHandoffPacket",
    "buildCrossDeviceRecoveryClosure",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-formal-recovery-flow.js`
    );
    assert.match(
      formalRecoveryFlowSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-formal-recovery-flow.js`
    );
  }
});

test("archive store helpers stay outside ledger facade", () => {
  for (const functionName of [
    "archiveStoreColdDataIfNeeded",
    "collectProtectedPassportMemoryIds",
    "ensureArchiveStoreState",
    "appendArchiveJsonl",
    "rewriteArchiveJsonl",
    "readArchiveJsonl",
    "archiveDirectoryExists",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\n(?:export\\s+)?(?:async\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-archive-store.js`
    );
    assert.match(
      archiveStoreSource,
      new RegExp(`export (?:async\\s+)?function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-archive-store.js`
    );
  }

  for (const functionName of [
    "migrateMainAgentArchiveDirectory",
    "rollbackMainAgentArchiveDirectory",
  ]) {
    assert.match(
      archiveStoreSource,
      new RegExp(`export async function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-archive-store.js`
    );
  }

  for (const constantName of [
    "DEFAULT_TRANSCRIPT_ARCHIVE_KEEP_COUNT",
    "DEFAULT_PASSPORT_INACTIVE_ARCHIVE_KEEP_COUNT",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\nconst ${constantName}\\s*=`),
      `${constantName} should remain in src/ledger-archive-store.js`
    );
    assert.match(
      archiveStoreSource,
      new RegExp(`export const ${constantName}\\s*=`),
      `${constantName} must be exported by src/ledger-archive-store.js`
    );
  }
});

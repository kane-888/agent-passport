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
const compactBoundarySource = readFileSync(path.join(srcDir, "ledger-compact-boundary.js"), "utf8");
const runnerPipelineSource = readFileSync(path.join(srcDir, "ledger-runner-pipeline.js"), "utf8");
const runnerReasonerPlanSource = readFileSync(path.join(srcDir, "ledger-runner-reasoner-plan.js"), "utf8");
const storeMigrationSource = readFileSync(path.join(srcDir, "ledger-store-migration.js"), "utf8");
const autoRecoveryReadinessSource = readFileSync(path.join(srcDir, "ledger-auto-recovery-readiness.js"), "utf8");
const formalRecoveryFlowSource = readFileSync(path.join(srcDir, "ledger-formal-recovery-flow.js"), "utf8");
const archiveStoreSource = readFileSync(path.join(srcDir, "ledger-archive-store.js"), "utf8");
const runtimeMemoryObservationsSource = readFileSync(path.join(srcDir, "ledger-runtime-memory-observations.js"), "utf8");
const runtimeMemoryHomeostasisSource = readFileSync(path.join(srcDir, "ledger-runtime-memory-homeostasis.js"), "utf8");
const runtimeMemoryStoreSource = readFileSync(path.join(srcDir, "ledger-runtime-memory-store.js"), "utf8");
const derivedCacheSource = readFileSync(path.join(srcDir, "ledger-derived-cache.js"), "utf8");
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
  assert.match(ledgerSource, /from "\.\/ledger-compact-boundary\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runner-pipeline\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runner-reasoner-plan\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-store-migration\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-auto-recovery-readiness\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-formal-recovery-flow\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-archive-store\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runtime-memory-observations\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runtime-memory-homeostasis\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-runtime-memory-store\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-derived-cache\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-identity-compat\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-cache\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-labels\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-core\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-status-list\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-record-view\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-builders\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-issuer\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-credential-repair-coverage\.js";/);
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
    "formatAgentComparisonEvidenceResponse",
    "resolveAgentComparisonAuditPair",
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

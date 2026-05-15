import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, randomBytes, createCipheriv, createDecipheriv, createHash, scryptSync } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIdentityProfile,
  buildDidDocument,
  collectApprovalInputs,
  inferDidAliases,
  summarizeApprovals,
  validateApprovals,
  getSigningMasterSecretStatus,
  peekSigningMasterSecretStatus,
  migrateSigningMasterSecretToKeychain,
} from "./identity.js";
import {
  getSystemKeychainStatus,
  readGenericPasswordFromKeychainResult,
  readGenericPasswordFromKeychain,
  shouldPreferSystemKeychain,
  writeGenericPasswordToKeychain,
} from "./local-secrets.js";
import {
  addSeconds,
  agentIdFromName,
  canonicalizeJson,
  cloneJson,
  createMachineId,
  createRecordId,
  decodeBase64,
  decodeUtf8Base64,
  encodeBase64,
  encodeUtf8Base64,
  hashAccessToken,
  hashEvent,
  hashJson,
  normalizeBooleanFlag,
  normalizeComparableText,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  compareTextSimilarity,
} from "./ledger-text-similarity.js";
import {
  AGENT_PASSPORT_LOCAL_REASONER_LABEL,
  displayAgentPassportLocalReasonerModel,
  isAgentPassportLocalReasonerModel,
} from "./memory-engine-branding.js";
import {
  AGENT_PASSPORT_MAIN_AGENT_ID,
  LEGACY_OPENNEED_AGENT_ID,
} from "./main-agent-compat.js";
import {
  buildMainAgentIdentityOwnerBinding,
  canonicalizeArchiveIdentityView,
  canonicalizeResidentAgentReference,
  findAgentByDid,
  findAgentByWalletAddress,
  matchesCompatibleAgentId,
  resolveDefaultResidentAgent,
  resolveDefaultResidentAgentId,
  resolveStoredAgent,
  resolveStoredAgentId,
} from "./ledger-identity-compat.js";
import {
  buildAgentScopedDerivedCacheKey,
  buildCollectionTailToken,
  buildStoreScopedDerivedCacheKey,
  cacheStoreDerivedView,
} from "./ledger-derived-cache.js";
import {
  DEFAULT_TRANSCRIPT_LIMIT,
  buildTranscriptModelSnapshot,
} from "./ledger-transcript-model.js";
import {
  appendTranscriptEntries,
  listAgentTranscriptEntries,
  normalizeTranscriptEntryRecord,
} from "./ledger-transcript-records.js";
import {
  buildExecutionCapabilityBoundarySummary,
} from "./ledger-execution-capability-boundary.js";
import {
  buildAgentContextPerformanceFingerprint,
  buildStorePerformanceFingerprint,
} from "./ledger-performance-fingerprint.js";
import {
  AGENT_CONTEXT_CACHE,
  AGENT_CREDENTIAL_CACHE,
  ARCHIVED_RECORDS_CACHE,
  ARCHIVE_RESTORE_EVENTS_CACHE,
  DEFAULT_REHYDRATE_CACHE_MAX_ENTRIES,
  RUNTIME_SUMMARY_CACHE,
  getCachedPassportMemoryList,
  getCachedRehydratePack,
  getCachedRuntimeSnapshot,
  getCachedTimedSnapshot,
  setCachedPassportMemoryList,
  setCachedRehydratePack,
  setCachedRuntimeSnapshot,
  setCachedTimedSnapshot,
} from "./ledger-runtime-caches.js";
import {
  normalizeWindowId,
  resolveAgentReferenceFromStore,
} from "./ledger-agent-reference.js";
import {
  listAuthorizationProposalViews as listAuthorizationProposalViewsImpl,
} from "./ledger-authorization-proposal-view.js";
import {
  listAgentInbox,
  listAgentMemories,
  listAgentOutbox,
  listAgentWindows,
} from "./ledger-agent-list-views.js";
import {
  auditMainAgentCanonicalArchiveDirectories,
  previewMainAgentCanonicalPhysicalMigrationStore,
  rewriteMainAgentArchiveJsonlStructuredReferences,
} from "./main-agent-canonical-migration.js";
import {
  MEMORY_HOMEOSTASIS_DEFAULT_BENCHMARK,
  applyMemoryProbeResults,
  buildMemoryCorrectionPlan,
  buildMemoryHomeostasisBenchmarkPlan,
  buildMemoryHomeostasisPromptSummary,
  buildModelProfileView,
  buildRuntimeMemoryStateView,
  computeMemoryHomeostasisModelProfile,
  computeRuntimeMemoryHomeostasis,
  normalizeModelProfileRecord,
  normalizeRuntimeMemoryStateRecord,
  selectMemoryProbeAnchors,
} from "./memory-homeostasis.js";
import {
  appendRuntimeMemoryObservation,
  buildAgentRuntimeMemoryObservationCollectionSummary,
  buildRuntimeMemoryObservationCollectionSummary,
  clampMemoryHomeostasisMetric,
  getRuntimeMemoryObservationCorrectionSeverity,
  listRuntimeMemoryObservationsFromStore,
  normalizeRuntimeMemoryObservationCorrectionLevel,
  normalizeRuntimeMemoryObservationRecord,
  resolveRuntimeMemoryObservationCorrectionActions,
} from "./ledger-runtime-memory-observations.js";
import {
  DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT,
  isOperationalMemoryHomeostasisProfile,
  listModelProfilesFromStore,
  resolveActiveMemoryHomeostasisModelName,
  resolveRuntimeMemoryHomeostasisProfile,
  syncContextBuilderMemoryHomeostasisDerivedViews,
} from "./ledger-runtime-memory-homeostasis.js";
import {
  DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT,
  estimatePromptTokens,
  truncatePromptSection,
} from "./ledger-prompt-budget.js";
import {
  DEFAULT_RUNTIME_QUERY_ITERATION_LIMIT,
  DEFAULT_RUNTIME_RECENT_TURN_LIMIT,
  DEFAULT_RUNTIME_TOOL_RESULT_LIMIT,
  normalizeRuntimeDriftPolicy,
} from "./ledger-runtime-drift-policy.js";
import {
  buildContextBuilderResult,
} from "./ledger-context-builder.js";
import {
  buildRuntimeBriefing,
} from "./ledger-runtime-briefing.js";
import {
  buildAgentRuntimeSnapshot as buildAgentRuntimeSnapshotImpl,
  buildLightweightContextRuntimeSnapshot as buildLightweightContextRuntimeSnapshotImpl,
  resolveRuntimePolicy,
} from "./ledger-agent-runtime-snapshot.js";
import {
  buildAgentMemoryLayerView as buildAgentMemoryLayerViewImpl,
} from "./ledger-agent-memory-layer-view.js";
import {
  runDefaultDeviceLocalReasonerMigration,
} from "./ledger-local-reasoner-migration.js";
import {
  activateDeviceLocalReasonerProfileInStore,
  prewarmDeviceLocalReasonerInStore,
  restoreDeviceLocalReasonerInStore,
  selectDeviceLocalReasonerInStore,
} from "./ledger-local-reasoner-orchestration.js";
import {
  applyDefaultLocalReasonerProfileMigrationToStore,
  applyLocalReasonerProfileDeleteToStore,
  applyLocalReasonerProfileSaveToStore,
  buildDefaultLocalReasonerProfileMigrationResult,
  buildLocalReasonerProfileDeleteResult,
  buildLocalReasonerProfileList,
  buildLocalReasonerProfileLoadResult,
  buildLocalReasonerProfileSaveResult,
  buildLocalReasonerRestoreCandidatesFromProfiles,
  DEFAULT_LOCAL_REASONER_PROFILE_LIMIT,
  resolveLocalReasonerProfileRecord,
} from "./ledger-local-reasoner-profiles.js";
import {
  buildDeviceLocalReasonerCatalogProviders,
  buildDeviceLocalReasonerCatalogResult,
  buildDeviceLocalReasonerProbeResult,
  buildPassiveLocalReasonerDiagnostics,
  buildDeviceLocalReasonerInspectionResult,
  resolveDeviceLocalReasonerCatalogSelectedProvider,
  resolveDeviceLocalReasonerInspectionDiagnostics,
} from "./ledger-local-reasoner-runtime.js";
import {
  buildDeviceLocalReasonerProbeCandidateConfig,
  buildLocalReasonerProbeConfig,
  mergeRunnerLocalReasonerOverride,
} from "./ledger-local-reasoner-overrides.js";
import {
  buildAgentRunGovernanceSummary,
  buildBridgeRuntimeSummary,
  buildHybridRuntimeSummary,
  buildRuntimeCognitionSummary,
} from "./ledger-runtime-summary.js";
import {
  extractClaimValueFromText,
} from "./ledger-claim-extraction.js";
import {
  computePassportSourceTrustScore,
  extractPassportMemoryComparableValue,
  inferPassportReconsolidationWindowHours,
  isPassportMemoryActive,
  isPassportMemoryDestabilized,
  normalizePassportMemoryLayer,
} from "./ledger-passport-memory-rules.js";
import {
  normalizePassportMemoryRecord,
} from "./ledger-passport-memory-record.js";
import {
  buildPassportCognitiveBias,
  buildPassportMemoryRetrievalCandidates,
  buildPassportMemorySearchText,
  completePassportMemoryPatterns,
  computePassportMemoryAgeDays,
  getPassportMemoryPatternKey,
  getPassportMemorySeparationKey,
  mergeUniquePassportMemories,
  scorePassportMemoryRelevance,
  selectPatternSeparatedPassportMemories,
} from "./ledger-passport-memory-retrieval.js";
import {
  buildProfileMemorySnapshot,
} from "./ledger-profile-memory-snapshot.js";
import {
  buildAgentMemoryCountSummary,
} from "./ledger-agent-memory-summary.js";
import {
  normalizeConversationMinuteRecord,
  normalizeDecisionLogRecord,
  normalizeEvidenceRefRecord,
  normalizeTaskSnapshotRecord,
} from "./ledger-runtime-records.js";
import {
  latestAgentTaskSnapshot,
  listAgentConversationMinutes,
  listAgentDecisionLogs,
  listAgentEvidenceRefs,
  listAgentTaskSnapshots,
} from "./ledger-runtime-record-lists.js";
import {
  buildRuntimeSearchHit,
  normalizeRuntimeSearchSourceType,
  scoreRuntimeSearchCorpus,
  splitRuntimeSearchHits,
  takeRecentEntries,
} from "./ledger-runtime-search.js";
import {
  buildPassportEventGraphNodeText,
  buildPassportEventGraphSnapshot,
  buildResponseVerificationResult,
  extractPassportEventGraphValue,
} from "./ledger-response-verification.js";
import {
  buildAgentCognitiveStateView,
  buildCognitiveTransitionRecord,
  buildContinuousCognitiveState,
  clampScore,
  extractPreferenceSignalsFromText,
  extractStablePreferences,
  inferCognitiveMode,
  listAgentCognitiveStatesFromStore,
  listAgentCognitiveTransitionsFromStore,
  resolveEffectiveAgentCognitiveState,
} from "./ledger-cognitive-state.js";
import {
  applyPassportMemorySupersession,
  findDominantStatefulSemanticRecord,
  shouldSupersedePassportField,
} from "./ledger-passport-memory-supersession.js";
import {
  buildBootstrapLedgerMemoryWrites,
  buildBootstrapProfileMemoryWrites,
  buildBootstrapWorkingMemoryWrites,
} from "./ledger-bootstrap-memory-writes.js";
import {
  listRuntimeMemoryStatesFromStore,
  upsertRuntimeMemoryState,
} from "./ledger-runtime-memory-store.js";
import {
  attachMemoryStabilityKernelPreview,
  loadMemoryStabilityRuntimeGateRaw,
  prepareMemoryStabilityPromptContext,
  resolveExplicitMemoryStabilityRunnerGuard,
  resolveMemoryStabilityRuntimeContractModelProfile,
  resolvePayloadMemoryStabilityFormalExecutionReceipts,
  resolvePayloadMemoryStabilityPreviewCreatedAt,
  resolvePayloadOnlyMemoryStabilityExplicitRequest,
  shouldAttachMemoryStabilityKernelPreview,
} from "./ledger-memory-stability-runtime.js";
export { resolveExplicitMemoryStabilityRunnerGuard } from "./ledger-memory-stability-runtime.js";
import { searchMempalaceColdMemory } from "./mempalace-runtime.js";
import {
  resolveAgentPassportChainId,
  resolveAgentPassportLedgerPath,
} from "./runtime-path-config.js";
import {
  countReadSessionsInStore,
  createReadSessionInStore,
  listReadSessionRoles as listReadSessionRolesImpl,
  listReadSessionScopes as listReadSessionScopesImpl,
  listReadSessionsInStore,
  revokeAllReadSessionsInStore,
  revokeReadSessionInStore,
  validateReadSessionTokenInStore,
} from "./ledger-read-sessions.js";
import {
  listSecurityAnomaliesInStore,
  recordSecurityAnomalyInStore,
} from "./ledger-security-anomalies.js";
import {
  buildDefaultDeviceRuntime,
  buildDeviceRuntimeView,
  buildDeviceSecurityPostureState,
  DEFAULT_DEVICE_LOCAL_MODE,
  DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL,
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
  DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
  DEFAULT_DEVICE_NEGOTIATION_MODE,
  DEFAULT_DEVICE_RETRIEVAL_SCORER,
  DEFAULT_DEVICE_RETRIEVAL_STRATEGY,
  DEFAULT_LOCAL_REASONER_MAX_INPUT_BYTES,
  DEFAULT_RUNTIME_SEARCH_LIMIT,
  inspectRuntimeLocalReasoner,
  isRuntimeLocalReasonerConfigured,
  normalizeDeviceAuthorizationStrategy,
  normalizeDeviceLocalMode,
  normalizeDeviceNegotiationMode,
  normalizeDeviceSecurityPosture,
  normalizeDeviceRuntime,
  normalizeLocalReasonerProfileRecord,
  normalizeRuntimeActionType,
  normalizeRuntimeCapability,
  normalizeRuntimeLocalReasonerConfig,
  normalizeRuntimeRetrievalPolicy,
  normalizeRuntimeReasonerProvider,
  normalizeRuntimeSandboxPolicy,
  resolveResidentBindingFields,
  resolveDisplayedRuntimeLocalReasonerProvider,
  resolveInspectableRuntimeLocalReasonerConfig,
  summarizeLocalReasonerDiagnostics,
} from "./ledger-device-runtime.js";
import {
  buildResidentAgentGate,
  resolveResidentAgentBinding,
} from "./ledger-resident-gate.js";
import {
  buildCommandNegotiationResult,
  isLoopbackSandboxHost,
  isSandboxCapabilityAllowlisted,
  normalizeSandboxProcessArgs,
  parseSandboxUrl,
  sandboxHostMatchesAllowlist,
  sandboxRequestHasProtectedControlPlaneHeaders,
  shouldEnforceSandboxCapabilityAllowlist,
} from "./ledger-command-negotiation.js";
import {
  attachSandboxBrokerOutput,
  executeSandboxWorker,
  resolveSandboxFilesystemPathStrict,
  resolveSandboxProcessCommandStrict,
  truncateUtf8TextToByteBudget,
} from "./ledger-sandbox-execution.js";
import {
  DEFAULT_SANDBOX_ACTION_AUDIT_LIMIT,
  buildSandboxActionAuditView,
  normalizeSandboxActionAuditRecord,
  normalizeSandboxActionAuditStatus,
} from "./ledger-sandbox-audit.js";
import {
  buildAgentSessionStateRecord,
  buildAgentSessionStateView,
  buildRuntimeBootstrapGate,
  buildRuntimeBootstrapGatePreview,
} from "./ledger-runtime-state.js";
import {
  buildAgentQueryStateRecord,
  buildAgentQueryStateView,
} from "./ledger-query-state.js";
import {
  buildVerificationRunRecord,
  buildVerificationRunView,
  normalizeVerificationRunStatus,
} from "./ledger-verification-run.js";
import {
  buildAgentRunView,
  buildAgentRunnerRecord,
  normalizeAgentRunStatus,
} from "./ledger-agent-run.js";
import {
  buildCompactBoundaryRecord,
  buildCompactBoundaryView,
} from "./ledger-compact-boundary.js";
import {
  buildAutoRecoveryResumePayload,
  buildBlockedRunnerSandboxExecution,
  normalizeRunnerConversationTurns,
  normalizeRunnerToolResults,
} from "./ledger-runner-pipeline.js";
import {
  buildRunnerAutoRecoveryFallbackMetadata,
  buildRunnerReasonerDegradationMetadata,
  buildRunnerReasonerPlanMetadata,
  resolveRunnerLocalReasonerConfig,
  resolveRunnerReasonerPlan,
} from "./ledger-runner-reasoner-plan.js";
import {
  buildRunnerReasonerQualityEscalationDecision,
} from "./ledger-runner-quality-signal.js";
export {
  buildRunnerReasonerQualityEscalationDecision,
} from "./ledger-runner-quality-signal.js";
import {
  buildMigratedStoreShell,
  createInitialStoreShell,
  didStoreShellChange,
} from "./ledger-store-migration.js";
import {
  DEFAULT_RUNNER_AUTO_RECOVERY_MAX_ATTEMPTS,
  buildAutomaticRecoveryReadiness,
  buildPlanSpecificAutomaticRecoveryReadiness,
} from "./ledger-auto-recovery-readiness.js";
import {
  attachAutoRecoveryState,
  buildAutoRecoveryAttemptRecord,
  buildAutoRecoveryClosure,
  buildDisabledAutoRecoveryState,
  mergeResumedAutoRecoveryResult,
} from "./ledger-auto-recovery-state.js";
import {
  calculateAgeHours,
  buildFormalRecoveryFlowStatus,
  labelRecoveryRehearsalStatus,
  recoveryRehearsalSupersedesPassed,
  summarizeLatestPassedRecoveryRehearsal,
  summarizeLatestRecoveryRehearsal,
  summarizeSetupPackageForFormalStatus,
} from "./ledger-formal-recovery-flow.js";
import {
  appendArchiveJsonl,
  archiveStoreColdDataIfNeeded,
  buildAgentArchiveFilePath as buildAgentArchiveFilePathImpl,
  ensureArchiveStoreState,
  migrateMainAgentArchiveDirectory as migrateMainAgentArchiveDirectoryImpl,
  readArchiveJsonl,
  rewriteArchiveJsonl,
  rollbackMainAgentArchiveDirectory as rollbackMainAgentArchiveDirectoryImpl,
} from "./ledger-archive-store.js";
import {
  buildDeviceSetupPackageSummary,
  readDeviceSetupPackageSummaryContract,
  buildSetupPackageResidentEventPayload,
  readSetupPackageResidentBindingContract,
  buildSetupPackageResidentBindingView,
  buildRecoveryRehearsalView as buildRecoveryRehearsalViewImpl,
  buildStoreRecoveryBundleSummary,
  deleteDeviceSetupPackage as deleteDeviceSetupPackageImpl,
  exportDeviceSetupPackage as exportDeviceSetupPackageImpl,
  exportStoreRecoveryBundle as exportStoreRecoveryBundleImpl,
  getDeviceSetupPackage as getDeviceSetupPackageImpl,
  importStoreRecoveryBundle as importStoreRecoveryBundleImpl,
  importDeviceSetupPackage as importDeviceSetupPackageImpl,
  listDeviceSetupPackages as listDeviceSetupPackagesImpl,
  listRecoveryRehearsals as listRecoveryRehearsalsImpl,
  listStoreRecoveryBundles as listStoreRecoveryBundlesImpl,
  readDeviceSetupPackageFile as readDeviceSetupPackageFileImpl,
  readEncryptedStoreEnvelope as readEncryptedStoreEnvelopeImpl,
  rehearseStoreRecoveryBundle as rehearseStoreRecoveryBundleImpl,
  resolveDeviceSetupPackageInput as resolveDeviceSetupPackageInputImpl,
  resolveDeviceSetupPackagePath as resolveDeviceSetupPackagePathImpl,
  resolveRecoveryBundleInput as resolveRecoveryBundleInputImpl,
  unwrapStoreRecoveryKey as unwrapStoreRecoveryKeyImpl,
} from "./ledger-recovery-setup.js";
import {
  DEFAULT_CREDENTIAL_STATUS_ENTRY_TYPE,
  DEFAULT_CREDENTIAL_STATUS_PURPOSE,
  compareCredentialIds,
  compareCredentialTimelineEntries,
  credentialSnapshotPurpose,
  credentialStatusListIssuerDidFromId,
  didMethodFromReference,
  normalizeCredentialKind,
  normalizeCredentialRecord,
  normalizeCredentialStatusListReference,
  normalizeCredentialTimelineEntry,
  normalizeCredentialTimelineRecords,
  resolveAgentDidForMethod,
} from "./ledger-credential-core.js";
import {
  buildCredentialStatusList,
  buildCredentialStatusListComparison,
  buildCredentialStatusLists,
  buildCredentialStatusProof,
  credentialStatusListId,
  credentialStatusListIssuerDid,
  resolveCredentialStatusListReference,
  setCredentialStatusIndexMap,
} from "./ledger-credential-status-list.js";
import {
  credentialIssuerLabel,
  credentialSubjectLabel,
} from "./ledger-credential-labels.js";
import {
  buildCredentialRecordView as buildCredentialRecordViewImpl,
  buildCredentialTimeline as buildCredentialTimelineImpl,
  findCredentialRecordById,
  isCredentialRelatedToAgent as isCredentialRelatedToAgentImpl,
  listCredentialRecordViews as listCredentialRecordViewsImpl,
} from "./ledger-credential-record-view.js";
import {
  verifyCredentialInStore,
} from "./ledger-credential-validation.js";
import {
  buildAgentComparisonEvidenceCredential as buildAgentComparisonEvidenceCredentialImpl,
  buildAgentCredential as buildAgentCredentialImpl,
  buildAuthorizationProposalCredential as buildAuthorizationProposalCredentialImpl,
  buildMigrationRepairReceiptCredential as buildMigrationRepairReceiptCredentialImpl,
} from "./ledger-credential-builders.js";
import {
  ensureAgentComparisonCredentialSnapshot as ensureAgentComparisonCredentialSnapshotImpl,
  ensureAgentCredentialSnapshot as ensureAgentCredentialSnapshotImpl,
  ensureAuthorizationCredentialSnapshot as ensureAuthorizationCredentialSnapshotImpl,
  exportAgentCredentialInStore as exportAgentCredentialInStoreImpl,
  exportAuthorizationProposalCredentialInStore as exportAuthorizationProposalCredentialInStoreImpl,
  issueMigrationRepairReceipt as issueMigrationRepairReceiptImpl,
  revokeCredentialInStore as revokeCredentialInStoreImpl,
} from "./ledger-credential-issuer.js";
import {
  buildAgentCredentialMethodCoverage as buildAgentCredentialMethodCoverageImpl,
} from "./ledger-credential-repair-coverage.js";
import {
  listCredentialRepairHistoryWithCache,
  listMigrationRepairViewsWithDeps,
  summarizeCredentialTimelineTimingWithDeps,
} from "./ledger-credential-repair-view.js";
import {
  runAgentComparisonMigrationRepair,
  runAgentCredentialMigrationRepair,
} from "./ledger-credential-repair-runner.js";
import {
  buildAgentComparisonSubjectId,
  buildAgentComparisonExport as buildAgentComparisonExportImpl,
  buildAgentComparisonEvidenceExport as buildAgentComparisonEvidenceExportImpl,
  buildAgentComparisonView as buildAgentComparisonViewImpl,
  listAgentComparisonAuditViews as listAgentComparisonAuditViewsImpl,
  resolveAgentComparisonAuditPair as resolveAgentComparisonAuditPairImpl,
} from "./ledger-agent-comparison.js";
import {
  compareCredentialStatusListsApi,
  getCredentialApi,
  getCredentialStatusApi,
  getCredentialStatusListApi,
  getCredentialTimelineApi,
  getMigrationRepairApi,
  getMigrationRepairCredentialsApi,
  getMigrationRepairTimelineApi,
  listCredentialsApi,
  listCredentialStatusListsApi,
  listMigrationRepairsApi,
} from "./ledger-records.js";
import {
  buildAutomaticRecoveryReadinessFailureSemantics,
  buildAutoRecoveryFailureSemantics,
} from "./runtime-failure-semantics.js";
import {
  buildProtocolDescriptor,
  normalizeDidMethod,
  PROTOCOL_NAME,
  PUBLIC_SIGNABLE_DID_METHODS,
  SIGNABLE_DID_METHODS,
} from "./protocol.js";
import {
  normalizeVerificationBindingValue,
} from "./proposition-graph.js";
import { generateAgentRunnerCandidateResponse } from "./reasoner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_CHAIN_ID = resolveAgentPassportChainId({ fallback: "agent-passport-alpha" });
const STORE_PATH = resolveAgentPassportLedgerPath({ dataDir: DATA_DIR });
const READ_SESSION_STORE_PATH =
  process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH || path.join(DATA_DIR, "read-sessions.json");
const STORE_KEY_PATH = process.env.AGENT_PASSPORT_STORE_KEY_PATH || path.join(DATA_DIR, ".ledger-key");
const STORE_RECOVERY_DIR = process.env.AGENT_PASSPORT_RECOVERY_DIR || path.join(DATA_DIR, "recovery-bundles");
const STORE_ARCHIVE_DIR = process.env.AGENT_PASSPORT_ARCHIVE_DIR || path.join(DATA_DIR, "archives");
const DEVICE_SETUP_PACKAGE_DIR =
  process.env.AGENT_PASSPORT_SETUP_PACKAGE_DIR || path.join(DATA_DIR, "device-setup-packages");
const STORE_KEY_KEYCHAIN_SERVICE = "AgentPassport.StoreKey";
const STORE_KEY_KEYCHAIN_ACCOUNT = process.env.AGENT_PASSPORT_KEYCHAIN_ACCOUNT || "resident-default";
const STORE_KEY_RECORD_FORMAT = "agent-passport-store-key-v1";
const STORE_ENVELOPE_FORMAT = "agent-passport-ledger-encrypted-v1";
const STORE_ENVELOPE_ALGORITHM = "aes-256-gcm";
const READ_SESSION_STORE_FORMAT = "agent-passport-read-sessions-v1";
const STORE_RECOVERY_FORMAT = "agent-passport-store-recovery-v1";
const DEVICE_SETUP_PACKAGE_FORMAT = "agent-passport-device-setup-v1";
const RUNNER_DEBUG_TIMING_ENABLED = process.env.AGENT_PASSPORT_RUNNER_DEBUG_TIMING === "1";

const TREASURY_AGENT_ID = "agent_treasury";
export { AGENT_PASSPORT_MAIN_AGENT_ID, LEGACY_OPENNEED_AGENT_ID };
const DEFAULT_WINDOW_LABEL = "browser-window";
const DEFAULT_MESSAGE_LIMIT = 50;
const DEFAULT_MEMORY_LIMIT = 50;
const DEFAULT_AUTHORIZATION_LIMIT = 50;
const DEFAULT_CREDENTIAL_LIMIT = 50;
const DEFAULT_RUNTIME_LIMIT = 10;
const DEFAULT_PASSPORT_MEMORY_LIMIT = 20;
const DEFAULT_RUNTIME_REHYDRATE_MEMORY_LIMIT = 6;
const DEFAULT_RUNTIME_REHYDRATE_MESSAGE_LIMIT = 4;
const DEFAULT_RUNTIME_REHYDRATE_CREDENTIAL_LIMIT = 4;
const DEFAULT_RUNTIME_REHYDRATE_AUTHORIZATION_LIMIT = 4;
const DEFAULT_CONVERSATION_MINUTE_LIMIT = 12;
const DEFAULT_WORKING_MEMORY_CHECKPOINT_THRESHOLD = 12;
const DEFAULT_WORKING_MEMORY_RECENT_WINDOW = 6;
const AGENT_RUN_CHECKPOINT_DEFAULTS = Object.freeze({
  threshold: DEFAULT_WORKING_MEMORY_CHECKPOINT_THRESHOLD,
  retainCount: DEFAULT_WORKING_MEMORY_RECENT_WINDOW,
});
const DEFAULT_AUTHORIZATION_DELAY_SECONDS = 0;
const DEFAULT_AUTHORIZATION_TTL_SECONDS = 60 * 60 * 24;

function emitRunnerTiming(step, startedAt, details = null) {
  if (!RUNNER_DEBUG_TIMING_ENABLED) {
    return;
  }
  const elapsedMs = Date.now() - startedAt;
  if (details && typeof details === "object") {
    console.error(`[runner-timing] ${step} +${elapsedMs}ms ${JSON.stringify(details)}`);
    return;
  }
  console.error(`[runner-timing] ${step} +${elapsedMs}ms`);
}
const DEFAULT_DEVICE_SETUP_PACKAGE_KEEP_LATEST = 5;
const DEFAULT_LIGHTWEIGHT_TRANSCRIPT_LIMIT = 8;
const DEFAULT_RUNTIME_KNOWLEDGE_WINDOW_LIMIT = 48;
const DEFAULT_RUNTIME_PASSPORT_MEMORY_WINDOW_LIMIT = 80;
const DEFAULT_RUNTIME_COMPACT_BOUNDARY_WINDOW_LIMIT = 16;
const DEFAULT_RUNTIME_SUMMARY_CACHE_TTL_MS = 15000;
const DEFAULT_ARCHIVE_QUERY_CACHE_TTL_MS = 8000;
const DEFAULT_MEMORY_PROMOTION_RECALL_THRESHOLD = 2;
const DEFAULT_MEMORY_PROMOTION_SALIENCE_THRESHOLD = 0.72;
const DEFAULT_MEMORY_FORGETTING_RETAIN_COUNT = 8;
const DEFAULT_MEMORY_REPLAY_CLUSTER_MIN_SIZE = 2;
const DEFAULT_MEMORY_REPLAY_MAX_PATTERNS = 3;
const DEFAULT_MEMORY_PATTERN_COMPLETION_EXTRA = 2;
const DEFAULT_WORKING_MEMORY_FORGET_AGE_DAYS = 2;
const DEFAULT_EPISODIC_MEMORY_FORGET_AGE_DAYS = 30;
const DEFAULT_SEMANTIC_MEMORY_FORGET_AGE_DAYS = 180;
const DEFAULT_OFFLINE_REPLAY_CLUSTER_MIN_SIZE = 2;
const DEFAULT_OFFLINE_REPLAY_MAX_PATTERNS = 2;
const DEFAULT_LAYER_HOMEOSTATIC_TARGETS = {
  working: 0.48,
  episodic: 0.58,
  semantic: 0.68,
  profile: 0.74,
  ledger: 0.8,
};
const DEFAULT_SLEEP_STAGE_SEQUENCE = [
  "nrem_prioritization",
  "sws_systems_consolidation",
  "rem_associative_recombination",
];

const DEFAULT_RECONSOLIDATION_VALUE_WIN_MARGIN = 0.12;
const DEFAULT_RECONSOLIDATION_AMBIGUITY_MARGIN = 0.06;
const DEFAULT_PREFERENCE_STABILIZATION_THRESHOLD = 2;
const AUTHORIZATION_ACTION_TYPES = new Set(["grant_asset", "fork_agent", "update_policy"]);
const DEVICE_SECURITY_POSTURE_MODES = new Set(["normal", "read_only", "disable_exec", "panic"]);
let storeEncryptionKeyPromise = null;
let storeCache = {
  store: null,
  fingerprint: null,
};
let storeMutationQueue = Promise.resolve();
const storeMutationContext = new AsyncLocalStorage();
const passiveStoreAccessContext = new AsyncLocalStorage();
let readSessionStoreCache = {
  store: null,
  fingerprint: null,
};
let readSessionMutationQueue = Promise.resolve();
const readSessionMutationContext = new AsyncLocalStorage();

function clearStoreCache() {
  storeCache = {
    store: null,
    fingerprint: null,
  };
}

function clearReadSessionStoreCache() {
  readSessionStoreCache = {
    store: null,
    fingerprint: null,
  };
}

function buildStoreFileFingerprint(raw = "") {
  return createHash("sha256").update(String(raw)).digest("hex");
}

function storeCacheMatchesFingerprint(fingerprint = null) {
  return Boolean(
    storeCache.store &&
    storeCache.fingerprint &&
    fingerprint &&
    fingerprint === storeCache.fingerprint
  );
}

function readSessionStoreCacheMatchesFingerprint(fingerprint = null) {
  return Boolean(
    readSessionStoreCache.store &&
    readSessionStoreCache.fingerprint &&
    fingerprint &&
    fingerprint === readSessionStoreCache.fingerprint
  );
}

function primeStoreCache(store, fingerprint = null) {
  storeCache = {
    store: cloneJson(store),
    fingerprint,
  };
}

function primeReadSessionStoreCache(store, fingerprint = null) {
  readSessionStoreCache = {
    store: cloneJson(store),
    fingerprint,
  };
}

function queueStoreMutation(operation) {
  if (storeMutationContext.getStore()?.active) {
    return Promise.resolve().then(() => operation());
  }
  const run = storeMutationQueue.then(
    () => storeMutationContext.run({ active: true }, operation),
    () => storeMutationContext.run({ active: true }, operation)
  );
  storeMutationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function runWithStoreMutation(operation) {
  return queueStoreMutation(operation);
}

function queueReadSessionMutation(operation) {
  if (readSessionMutationContext.getStore()?.active) {
    return Promise.resolve().then(() => operation());
  }
  const run = readSessionMutationQueue.then(
    () => readSessionMutationContext.run({ active: true }, operation),
    () => readSessionMutationContext.run({ active: true }, operation)
  );
  readSessionMutationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function runWithPassiveStoreAccess(operation) {
  return passiveStoreAccessContext.run({ active: true }, operation);
}

function isPassiveStoreAccess() {
  return Boolean(passiveStoreAccessContext.getStore()?.active);
}

function createInitialReadSessionStore() {
  return {
    format: READ_SESSION_STORE_FORMAT,
    readSessions: [],
    events: [],
    lastEventHash: null,
    updatedAt: now(),
  };
}

function normalizeReadSessionStoreState(value = null) {
  const base = value && typeof value === "object" ? value : {};
  return {
    format: READ_SESSION_STORE_FORMAT,
    readSessions: Array.isArray(base.readSessions)
      ? (cloneJson(base.readSessions) ?? []).filter((record) => record && typeof record === "object")
      : [],
    events: Array.isArray(base.events)
      ? (cloneJson(base.events) ?? []).filter((record) => record && typeof record === "object")
      : [],
    lastEventHash: normalizeOptionalText(base.lastEventHash) ?? null,
    updatedAt: normalizeOptionalText(base.updatedAt) ?? now(),
  };
}

function buildAgentArchiveFilePath(agentId, kind) {
  return buildAgentArchiveFilePathImpl(STORE_ARCHIVE_DIR, agentId, kind);
}

async function migrateMainAgentArchiveDirectory({ legacyAgentId, canonicalAgentId }) {
  return migrateMainAgentArchiveDirectoryImpl({
    archiveRoot: STORE_ARCHIVE_DIR,
    legacyAgentId,
    canonicalAgentId,
  });
}

async function rollbackMainAgentArchiveDirectory({ legacyAgentId, canonicalAgentId }) {
  return rollbackMainAgentArchiveDirectoryImpl({
    archiveRoot: STORE_ARCHIVE_DIR,
    legacyAgentId,
    canonicalAgentId,
  });
}

function createStoreKeyInvalidError(message = "Store key file is invalid") {
  const error = new Error(message);
  error.code = "STORE_KEY_INVALID";
  return error;
}

function sameStoreKeyBytes(left = null, right = null) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === right.length && left.equals(right);
}

function decodeStoreKeyRecordKey(keyBase64) {
  const key = decodeBase64(keyBase64);
  if (key.length !== 32) {
    throw createStoreKeyInvalidError("Invalid store key length");
  }
  return key;
}

function parseStoreKeyMaterial(raw, { keyPath = STORE_KEY_PATH, allowLegacy = true } = {}) {
  const normalized = normalizeOptionalText(raw);
  if (!normalized) {
    return null;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    if (!allowLegacy) {
      return null;
    }
    return {
      key: createHash("sha256").update(normalized).digest(),
      mode: "legacy_file",
      keyPath,
      createdAt: null,
      service: null,
      account: null,
    };
  }
  if (parsed?.format === STORE_KEY_RECORD_FORMAT) {
    if (typeof parsed.keyBase64 !== "string") {
      throw createStoreKeyInvalidError("Store key record is missing keyBase64");
    }
    return {
      key: decodeStoreKeyRecordKey(parsed.keyBase64),
      mode: "file_record",
      keyPath,
      createdAt: parsed.createdAt || null,
      service: null,
      account: null,
    };
  }
  throw createStoreKeyInvalidError("Unsupported JSON store key format");
}

async function loadOrCreateStoreEncryptionKey() {
  if (storeEncryptionKeyPromise) {
    const cached = await storeEncryptionKeyPromise;
    if (await cachedStoreEncryptionKeyStillPresent(cached)) {
      return cached;
    }
    storeEncryptionKeyPromise = null;
  }

  storeEncryptionKeyPromise = (async () => {
    const envSecret = normalizeOptionalText(process.env.AGENT_PASSPORT_STORE_KEY);
    if (envSecret) {
      return {
        key: createHash("sha256").update(envSecret).digest(),
        mode: "env",
        keyPath: null,
        service: null,
        account: null,
      };
    }

    const keychainStatus = getSystemKeychainStatus();
    if (shouldPreferSystemKeychain() && keychainStatus.available) {
      const keychainSecretResult = readGenericPasswordFromKeychainResult(
        STORE_KEY_KEYCHAIN_SERVICE,
        STORE_KEY_KEYCHAIN_ACCOUNT
      );
      if (keychainSecretResult.found) {
        const key = decodeBase64(keychainSecretResult.value);
        if (key.length !== 32) {
          throw new Error("Invalid keychain store key length");
        }
        return {
          key,
          mode: "keychain",
          keyPath: null,
          service: STORE_KEY_KEYCHAIN_SERVICE,
          account: STORE_KEY_KEYCHAIN_ACCOUNT,
        };
      }
      if (!(keychainSecretResult.ok && keychainSecretResult.code === "not_found")) {
        throw new Error(
          `System keychain store key read failed: ${keychainSecretResult.reason || keychainSecretResult.code}`
        );
      }
    }

    await mkdir(path.dirname(STORE_KEY_PATH), { recursive: true });
    try {
      const raw = normalizeOptionalText(await readFile(STORE_KEY_PATH, "utf8"));
      if (raw) {
        const keyMaterial = parseStoreKeyMaterial(raw);
        if (keyMaterial?.mode === "file_record") {
          return keyMaterial;
        }
        if (keyMaterial?.mode === "legacy_file") {
          const migratedRecord = {
            format: STORE_KEY_RECORD_FORMAT,
            createdAt: now(),
            source: "legacy_file_migrated",
            keyBase64: encodeBase64(keyMaterial.key),
          };
          await writeFile(STORE_KEY_PATH, `${JSON.stringify(migratedRecord, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
          });
          return {
            key: keyMaterial.key,
            mode: "file_record",
            keyPath: STORE_KEY_PATH,
            createdAt: migratedRecord.createdAt,
            migratedLegacy: true,
            service: null,
            account: null,
          };
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    const generatedKey = randomBytes(32);
    if (shouldPreferSystemKeychain() && keychainStatus.available) {
      const stored = writeGenericPasswordToKeychain(
        STORE_KEY_KEYCHAIN_SERVICE,
        STORE_KEY_KEYCHAIN_ACCOUNT,
        encodeBase64(generatedKey)
      );
      if (!stored.ok) {
        throw new Error(`Unable to persist store key into keychain: ${stored.reason || "keychain_write_failed"}`);
      }
      return {
        key: generatedKey,
        mode: "keychain",
        keyPath: null,
        service: STORE_KEY_KEYCHAIN_SERVICE,
        account: STORE_KEY_KEYCHAIN_ACCOUNT,
        createdAt: now(),
      };
    }

    const generatedRecord = {
      format: STORE_KEY_RECORD_FORMAT,
      createdAt: now(),
      source: "generated_local_file",
      keyBase64: encodeBase64(generatedKey),
    };
    await writeFile(STORE_KEY_PATH, `${JSON.stringify(generatedRecord, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return {
      key: generatedKey,
      mode: "file_record",
      keyPath: STORE_KEY_PATH,
      createdAt: generatedRecord.createdAt,
      service: null,
      account: null,
    };
  })().catch((error) => {
    storeEncryptionKeyPromise = null;
    throw error;
  });

  return storeEncryptionKeyPromise;
}

async function loadStoreEncryptionKeyIfPresent() {
  if (storeEncryptionKeyPromise) {
    const cached = await storeEncryptionKeyPromise;
    if (await cachedStoreEncryptionKeyStillPresent(cached)) {
      return cached;
    }
    storeEncryptionKeyPromise = null;
  }

  const envSecret = normalizeOptionalText(process.env.AGENT_PASSPORT_STORE_KEY);
  if (envSecret) {
    return {
      key: createHash("sha256").update(envSecret).digest(),
      mode: "env",
      keyPath: null,
      service: null,
      account: null,
    };
  }

  const keychainStatus = getSystemKeychainStatus();
  if (shouldPreferSystemKeychain() && keychainStatus.available) {
    const keychainSecretResult = readGenericPasswordFromKeychainResult(
      STORE_KEY_KEYCHAIN_SERVICE,
      STORE_KEY_KEYCHAIN_ACCOUNT
    );
    if (keychainSecretResult.found) {
      const key = decodeBase64(keychainSecretResult.value);
      if (key.length !== 32) {
        throw new Error("Invalid keychain store key length");
      }
      return {
        key,
        mode: "keychain",
        keyPath: null,
        service: STORE_KEY_KEYCHAIN_SERVICE,
        account: STORE_KEY_KEYCHAIN_ACCOUNT,
      };
    }
    if (!(keychainSecretResult.ok && keychainSecretResult.code === "not_found")) {
      throw new Error(
        `System keychain store key read failed: ${keychainSecretResult.reason || keychainSecretResult.code}`
      );
    }
  }

  try {
    const raw = normalizeOptionalText(await readFile(STORE_KEY_PATH, "utf8"));
    if (!raw) {
      return null;
    }
    return parseStoreKeyMaterial(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function cachedStoreEncryptionKeyStillPresent(cached = null) {
  if (cached?.mode === "env") {
    const envSecret = normalizeOptionalText(process.env.AGENT_PASSPORT_STORE_KEY);
    return Boolean(envSecret) && sameStoreKeyBytes(cached.key, createHash("sha256").update(envSecret).digest());
  }
  if (cached?.mode === "keychain") {
    const keychainSecretResult = readGenericPasswordFromKeychainResult(
      STORE_KEY_KEYCHAIN_SERVICE,
      STORE_KEY_KEYCHAIN_ACCOUNT
    );
    if (!keychainSecretResult.found) {
      return false;
    }
    return sameStoreKeyBytes(cached.key, decodeStoreKeyRecordKey(keychainSecretResult.value));
  }
  if (!cached?.keyPath) {
    return false;
  }
  try {
    const current = parseStoreKeyMaterial(await readFile(cached.keyPath, "utf8"), {
      keyPath: cached.keyPath,
    });
    return sameStoreKeyBytes(cached.key, current?.key);
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function buildStoreEncryptionStatus(encryption = null) {
  const keychain = getSystemKeychainStatus();
  const keyReady = Boolean(encryption?.mode);
  return {
    preferred: shouldPreferSystemKeychain(),
    ready: keyReady,
    available: keyReady,
    systemAvailable: keychain.available,
    reason: keyReady ? "ready" : keychain.reason,
    source: encryption?.mode || null,
    keyPath: encryption?.keyPath || null,
    service: encryption?.service || null,
    account: encryption?.account || null,
    createdAt: encryption?.createdAt || null,
  };
}

export async function getStoreEncryptionStatus() {
  return buildStoreEncryptionStatus(await loadOrCreateStoreEncryptionKey());
}

export async function peekStoreEncryptionStatus() {
  const envSecret = normalizeOptionalText(process.env.AGENT_PASSPORT_STORE_KEY);
  if (envSecret) {
    return buildStoreEncryptionStatus({
      mode: "env",
      keyPath: null,
      service: null,
      account: null,
      createdAt: null,
    });
  }

  const keychainStatus = getSystemKeychainStatus();
  if (shouldPreferSystemKeychain() && keychainStatus.available) {
    const keychainSecretResult = readGenericPasswordFromKeychainResult(
      STORE_KEY_KEYCHAIN_SERVICE,
      STORE_KEY_KEYCHAIN_ACCOUNT
    );
    if (keychainSecretResult.found) {
      return buildStoreEncryptionStatus({
        mode: "keychain",
        keyPath: null,
        service: STORE_KEY_KEYCHAIN_SERVICE,
        account: STORE_KEY_KEYCHAIN_ACCOUNT,
        createdAt: null,
      });
    }
    if (!(keychainSecretResult.ok && keychainSecretResult.code === "not_found")) {
      throw new Error(
        `System keychain store key read failed: ${keychainSecretResult.reason || keychainSecretResult.code}`
      );
    }
  }

  try {
    const raw = normalizeOptionalText(await readFile(STORE_KEY_PATH, "utf8"));
    if (!raw) {
      return buildStoreEncryptionStatus(null);
    }
    const keyMaterial = parseStoreKeyMaterial(raw);
    if (keyMaterial) {
      return buildStoreEncryptionStatus(keyMaterial);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  return buildStoreEncryptionStatus(null);
}

export async function migrateStoreKeyToKeychain({ dryRun = true, removeFile = false } = {}) {
  const envSecret = normalizeOptionalText(process.env.AGENT_PASSPORT_STORE_KEY);
  if (envSecret) {
    return {
      migrated: false,
      skipped: true,
      dryRun,
      reason: "env_managed",
      source: "env",
      target: "keychain",
    };
  }

  const keychain = getSystemKeychainStatus();
  if (!shouldPreferSystemKeychain() || !keychain.available) {
    return {
      migrated: false,
      skipped: true,
      dryRun,
      reason: keychain.reason || "keychain_unavailable",
      source: (await getStoreEncryptionStatus()).source || "unknown",
      target: "keychain",
    };
  }

  const current = await loadOrCreateStoreEncryptionKey();
  if (current.mode === "keychain") {
    return {
      migrated: false,
      skipped: true,
      dryRun,
      reason: "already_keychain",
      source: "keychain",
      target: "keychain",
      service: STORE_KEY_KEYCHAIN_SERVICE,
      account: STORE_KEY_KEYCHAIN_ACCOUNT,
    };
  }

  if (!current.key || current.key.length !== 32) {
    throw new Error("Current store key is unavailable or invalid");
  }

  if (dryRun) {
    return {
      migrated: false,
      skipped: false,
      dryRun: true,
      source: current.mode || "file_record",
      target: "keychain",
      keyPath: current.keyPath || STORE_KEY_PATH,
      service: STORE_KEY_KEYCHAIN_SERVICE,
      account: STORE_KEY_KEYCHAIN_ACCOUNT,
      removeFile,
    };
  }

  const stored = writeGenericPasswordToKeychain(
    STORE_KEY_KEYCHAIN_SERVICE,
    STORE_KEY_KEYCHAIN_ACCOUNT,
    encodeBase64(current.key)
  );
  if (!stored.ok) {
    throw new Error(`Unable to migrate store key to keychain: ${stored.reason || "keychain_write_failed"}`);
  }

  if (removeFile && current.keyPath) {
    try {
      await unlink(current.keyPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  storeEncryptionKeyPromise = null;

  return {
    migrated: true,
    skipped: false,
    dryRun: false,
    source: current.mode || "file_record",
    target: "keychain",
    removedFile: Boolean(removeFile && current.keyPath),
    keyPath: removeFile ? null : current.keyPath || STORE_KEY_PATH,
    service: STORE_KEY_KEYCHAIN_SERVICE,
    account: STORE_KEY_KEYCHAIN_ACCOUNT,
  };
}

export async function migrateLocalKeyMaterialToKeychain({ dryRun = true, removeFile = false } = {}) {
  const [storeKey, signingKey] = await Promise.all([
    migrateStoreKeyToKeychain({ dryRun, removeFile }),
    Promise.resolve(migrateSigningMasterSecretToKeychain({ dryRun, removeFile })),
  ]);

  return {
    migratedAt: now(),
    dryRun,
    removeFile,
    storeKey,
    signingKey,
  };
}

function deriveRecoveryWrapKey(passphrase, salt) {
  const normalizedPassphrase = normalizeOptionalText(passphrase);
  if (!normalizedPassphrase || normalizedPassphrase.length < 12) {
    throw new Error("Recovery passphrase must be at least 12 characters");
  }
  return scryptSync(normalizedPassphrase, salt, 32);
}

function encryptBufferWithKey(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(STORE_ENVELOPE_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return {
    algorithm: STORE_ENVELOPE_ALGORITHM,
    iv: encodeBase64(iv),
    tag: encodeBase64(cipher.getAuthTag()),
    ciphertext: encodeBase64(ciphertext),
  };
}

function decryptBufferWithKey(key, envelope) {
  const decipher = createDecipheriv(STORE_ENVELOPE_ALGORITHM, key, decodeBase64(envelope.iv));
  decipher.setAuthTag(decodeBase64(envelope.tag));
  return Buffer.concat([
    decipher.update(decodeBase64(envelope.ciphertext)),
    decipher.final(),
  ]);
}

function isEncryptedStoreEnvelope(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.format === STORE_ENVELOPE_FORMAT &&
      value.algorithm === STORE_ENVELOPE_ALGORITHM &&
      value.iv &&
      value.tag &&
      value.ciphertext
  );
}

async function encryptStorePayload(store) {
  const encryption = await loadOrCreateStoreEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(STORE_ENVELOPE_ALGORITHM, encryption.key, iv);
  const plaintext = Buffer.from(JSON.stringify(store, null, 2), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: STORE_ENVELOPE_FORMAT,
    algorithm: STORE_ENVELOPE_ALGORITHM,
    keyMode: encryption.mode,
    createdAt: now(),
    iv: encodeBase64(iv),
    tag: encodeBase64(tag),
    ciphertext: encodeBase64(ciphertext),
  };
}

async function decryptStoreEnvelope(envelope, { createKey = false } = {}) {
  const encryption = createKey
    ? await loadOrCreateStoreEncryptionKey()
    : await loadStoreEncryptionKeyIfPresent();
  if (!encryption?.key) {
    const error = new Error("Store encryption key is not available");
    error.code = "STORE_KEY_NOT_FOUND";
    throw error;
  }
  const decipher = createDecipheriv(
    STORE_ENVELOPE_ALGORITHM,
    encryption.key,
    decodeBase64(envelope.iv)
  );
  decipher.setAuthTag(decodeBase64(envelope.tag));
  const plaintext = Buffer.concat([
    decipher.update(decodeBase64(envelope.ciphertext)),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function baseAgentRecord({
  agentId,
  displayName,
  role,
  controller,
  parentAgentId = null,
  createdByEventHash = null,
  identity,
}) {
  return {
    agentId,
    displayName,
    role,
    controller,
    parentAgentId,
    createdAt: now(),
    createdByEventHash,
    status: "active",
    balances: {
      credits: 0,
    },
    identity,
  };
}

function appendEvent(store, type, payload) {
  const previousHash = store.events.at(-1)?.hash ?? null;
  const event = {
    index: store.events.length,
    type,
    timestamp: now(),
    previousHash,
    payload,
  };
  event.hash = hashEvent(event);
  store.events.push(event);
  store.lastEventHash = event.hash;
  return event;
}

function resolveAgentScopedQueryAgentId(store, agentId) {
  return resolveStoredAgentId(store, agentId) ?? (normalizeOptionalText(agentId) ?? null);
}

function buildAnnotatedSetupPackageResidentBindings(store, setupPackageSummary = null) {
  const summary = readDeviceSetupPackageSummaryContract(setupPackageSummary);
  const canonicalResidentBindingSource =
    setupPackageSummary?.canonicalResidentBinding && typeof setupPackageSummary.canonicalResidentBinding === "object"
      ? setupPackageSummary.canonicalResidentBinding
      : setupPackageSummary;
  const canonicalResidentBinding = readSetupPackageResidentBindingContract(canonicalResidentBindingSource);
  const canonicalSummary = summary
    ? {
        ...summary,
        residentAgentId: canonicalResidentBinding.residentAgentId,
        residentAgentReference: canonicalResidentBinding.residentAgentReference,
        resolvedResidentAgentId: canonicalResidentBinding.resolvedResidentAgentId,
        effectivePhysicalResidentAgentId: canonicalResidentBinding.effectivePhysicalResidentAgentId,
        effectiveResidentAgentReference: canonicalResidentBinding.effectiveResidentAgentReference,
        effectiveResolvedResidentAgentId: canonicalResidentBinding.effectiveResolvedResidentAgentId,
        residentBindingMismatch: canonicalResidentBinding.residentBindingMismatch,
      }
    : summary;
  if (!canonicalSummary || typeof canonicalSummary !== "object") {
    return {
      canonicalSummary,
      canonicalResidentBinding: null,
      resolvedResidentBinding: null,
      residentBindingMismatch: false,
    };
  }
  const resolvedResidentBinding = buildSetupPackageResidentBindingView(canonicalSummary, { store });
  const residentBindingMismatch =
    canonicalResidentBinding.residentBindingMismatch === true || resolvedResidentBinding.residentBindingMismatch === true;
  return {
    canonicalSummary,
    canonicalResidentBinding,
    resolvedResidentBinding: {
      ...resolvedResidentBinding,
      residentBindingMismatch,
    },
    residentBindingMismatch,
  };
}

function annotateSetupPackageResidentBinding(store, setupPackageSummary = null) {
  const {
    canonicalSummary,
    canonicalResidentBinding,
    resolvedResidentBinding,
    residentBindingMismatch,
  } = buildAnnotatedSetupPackageResidentBindings(store, setupPackageSummary);
  if (!canonicalSummary || typeof canonicalSummary !== "object") {
    return canonicalSummary ? cloneJson(canonicalSummary) : canonicalSummary;
  }
  return {
    ...canonicalSummary,
    canonicalResidentBinding,
    resolvedResidentBinding,
    ...resolvedResidentBinding,
    residentBindingMismatch,
  };
}

function annotateDeviceSetupPackageListing(store, listing = null) {
  if (!listing || typeof listing !== "object") {
    return listing ? cloneJson(listing) : listing;
  }
  const annotated = cloneJson(listing) ?? {};
  return {
    ...annotated,
    packages: Array.isArray(listing.packages)
      ? listing.packages.map((entry) => annotateSetupPackageResidentBinding(store, entry))
      : [],
  };
}

function normalizeReadSessionAgentBindingIds(store, value) {
  return [...new Set(
    normalizeTextList(value)
      .map((agentId) => resolveStoredAgentId(store, agentId) ?? (normalizeOptionalText(agentId) ?? null))
      .filter(Boolean)
  )];
}

function normalizeReadSessionPayloadForStore(store, payload = {}) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const normalizedPayload = cloneJson(payload) ?? {};
  if (payload.agentIds != null) {
    normalizedPayload.agentIds = normalizeReadSessionAgentBindingIds(store, payload.agentIds);
  }
  if (payload.resourceBindings && typeof payload.resourceBindings === "object") {
    normalizedPayload.resourceBindings = {
      ...cloneJson(payload.resourceBindings),
    };
    if (payload.resourceBindings.agentIds != null) {
      normalizedPayload.resourceBindings.agentIds = normalizeReadSessionAgentBindingIds(
        store,
        payload.resourceBindings.agentIds
      );
    }
  }
  return normalizedPayload;
}

function ensureAgent(store, agentId) {
  const agent = resolveStoredAgent(store, agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return agent;
}

function ensureCredits(agent, amount) {
  if ((agent.balances.credits ?? 0) < amount) {
    throw new Error(`${agent.displayName} credits not enough`);
  }
}

const CREDENTIAL_RECORD_VIEW_DEPS = {
  isProposalRelatedToAgent,
  listCredentialRepairHistory,
  resolveActorContext,
  summarizeCredentialTimelineTiming,
};

const buildCredentialTimeline = (store, record) =>
  buildCredentialTimelineImpl(store, record, CREDENTIAL_RECORD_VIEW_DEPS);

const isCredentialRelatedToAgent = (record, agentId, store = null) =>
  isCredentialRelatedToAgentImpl(record, agentId, store, CREDENTIAL_RECORD_VIEW_DEPS);

const buildCredentialRecordView = (store, record, options = {}) =>
  buildCredentialRecordViewImpl(store, record, options, CREDENTIAL_RECORD_VIEW_DEPS);

const listCredentialRecordViews = (store, options = {}) =>
  listCredentialRecordViewsImpl(store, options, CREDENTIAL_RECORD_VIEW_DEPS);

const AUTHORIZATION_PROPOSAL_VIEW_DEPS = {
  buildAuthorizationProposalView,
  defaultAuthorizationLimit: DEFAULT_AUTHORIZATION_LIMIT,
  isProposalRelatedToAgent,
};

const listAuthorizationProposalViews = (store, options = {}) =>
  listAuthorizationProposalViewsImpl(store, options, AUTHORIZATION_PROPOSAL_VIEW_DEPS);

const CREDENTIAL_BUILDER_DEPS = {
  buildAuthorizationProposalView,
  defaultAuthorizationLimit: DEFAULT_AUTHORIZATION_LIMIT,
  ensureAgent,
  listAgentInbox,
  listAgentMemories,
  listAgentOutbox,
  listAgentWindows,
  listAuthorizationProposalViews,
  resolveAgentReferenceFromStore,
  resolveDefaultResidentAgentId,
};

const buildAgentCredential = (store, agent, statusPointer = null, options = {}) =>
  buildAgentCredentialImpl(store, agent, statusPointer, options, CREDENTIAL_BUILDER_DEPS);

const buildAuthorizationProposalCredential = (store, proposal, statusPointer = null, options = {}) =>
  buildAuthorizationProposalCredentialImpl(store, proposal, statusPointer, options, CREDENTIAL_BUILDER_DEPS);

const buildAgentComparisonEvidenceCredential = (store, comparisonResult, options = {}) =>
  buildAgentComparisonEvidenceCredentialImpl(store, comparisonResult, options, CREDENTIAL_BUILDER_DEPS);

const buildMigrationRepairReceiptCredential = (store, repair, options = {}) =>
  buildMigrationRepairReceiptCredentialImpl(store, repair, options, CREDENTIAL_BUILDER_DEPS);

const CREDENTIAL_ISSUER_DEPS = {
  agentCredentialCache: AGENT_CREDENTIAL_CACHE,
  buildAgentComparisonEvidenceCredential,
  buildAgentCredential,
  buildAuthorizationProposalCredential,
  buildCredentialRecordView,
  buildMigrationRepairReceiptCredential,
  cacheTtlMs: DEFAULT_RUNTIME_SUMMARY_CACHE_TTL_MS,
  ensureAgent,
  ensureAuthorizationProposal,
  getCachedTimedSnapshot,
  resolveAgentReferenceFromStore,
  resolveDefaultResidentAgentId,
  setCachedTimedSnapshot,
};

const ensureAgentCredentialSnapshot = (store, agent, options = {}) =>
  ensureAgentCredentialSnapshotImpl(store, agent, options, CREDENTIAL_ISSUER_DEPS);

const ensureAuthorizationCredentialSnapshot = (store, proposal, options = {}) =>
  ensureAuthorizationCredentialSnapshotImpl(store, proposal, options, CREDENTIAL_ISSUER_DEPS);

const exportAgentCredentialInStore = (store, agentId, options = {}) =>
  exportAgentCredentialInStoreImpl(store, agentId, options, CREDENTIAL_ISSUER_DEPS);

const exportAuthorizationProposalCredentialInStore = (store, proposalId, options = {}) =>
  exportAuthorizationProposalCredentialInStoreImpl(store, proposalId, options, CREDENTIAL_ISSUER_DEPS);

const revokeCredentialInStore = (store, credentialId, payload = {}) =>
  revokeCredentialInStoreImpl(store, credentialId, payload, CREDENTIAL_ISSUER_DEPS);

const issueMigrationRepairReceipt = (store, repair, options = {}) =>
  issueMigrationRepairReceiptImpl(store, repair, options, CREDENTIAL_ISSUER_DEPS);

const ensureAgentComparisonCredentialSnapshot = (store, comparisonResult, options = {}) =>
  ensureAgentComparisonCredentialSnapshotImpl(store, comparisonResult, options, CREDENTIAL_ISSUER_DEPS);

const AGENT_COMPARISON_DEPS = {
  buildAgentContextSnapshot,
  resolveAgentReferenceFromStore,
};

const buildAgentComparisonView = (store, leftReference = {}, rightReference = {}, options = {}) =>
  buildAgentComparisonViewImpl(store, leftReference, rightReference, options, AGENT_COMPARISON_DEPS);

const buildAgentComparisonExport = (store, options = {}) =>
  buildAgentComparisonExportImpl(store, options, AGENT_COMPARISON_DEPS);

const resolveAgentComparisonAuditPair = (store, options = {}) =>
  resolveAgentComparisonAuditPairImpl(store, options, AGENT_COMPARISON_DEPS);

const AGENT_COMPARISON_EVIDENCE_DEPS = {
  ...AGENT_COMPARISON_DEPS,
  buildAgentComparisonEvidenceCredential,
  buildCredentialRecordView,
  ensureAgentComparisonCredentialSnapshot,
  listMigrationRepairViews,
};

const buildAgentComparisonEvidenceExport = (store, options = {}) =>
  buildAgentComparisonEvidenceExportImpl(store, options, AGENT_COMPARISON_EVIDENCE_DEPS);

const AGENT_COMPARISON_AUDIT_DEPS = {
  ...AGENT_COMPARISON_DEPS,
  buildCredentialRecordView,
  defaultCredentialLimit: DEFAULT_CREDENTIAL_LIMIT,
};

const listAgentComparisonAuditViews = (store, options = {}) =>
  listAgentComparisonAuditViewsImpl(store, options, AGENT_COMPARISON_AUDIT_DEPS);

const CREDENTIAL_REPAIR_COVERAGE_DEPS = {
  isCredentialRelatedToAgent,
  resolveAgentComparisonAuditPair,
};

const buildAgentCredentialMethodCoverage = (store, agentId) =>
  buildAgentCredentialMethodCoverageImpl(store, agentId, CREDENTIAL_REPAIR_COVERAGE_DEPS);

function buildCognitiveStateDeps() {
  return {
    listAgentCompactBoundariesFromStore,
    listAgentGoalStatesFromStore,
    listAgentPassportMemories,
    listAgentQueryStatesFromStore,
    listAgentRunsFromStore,
    listAgentVerificationRunsFromStore,
  };
}

function buildResponseVerificationDeps() {
  return {
    buildAgentMemoryLayerView,
    latestAgentTaskSnapshot,
  };
}

function buildContextBuilderDeps() {
  return {
    buildAgentMemoryLayerView,
    buildCompactBoundaryResumeView,
    buildLightweightContextRuntimeSnapshot,
    defaultLightweightTranscriptLimit: DEFAULT_LIGHTWEIGHT_TRANSCRIPT_LIMIT,
    runtimeMemoryStoreAdapter: RUNTIME_MEMORY_STORE_ADAPTER,
    searchAgentRuntimeKnowledgeFromStore,
    transcriptModelDeps: TRANSCRIPT_MODEL_DEPS,
  };
}

function buildAgentRuntimeSnapshotDeps() {
  return {
    buildAgentCognitiveStateView,
    buildDeviceRuntimeView,
    buildModelProfileView,
    buildProtocolDescriptor,
    buildResidentAgentGate,
    buildRuntimeBriefing,
    buildRuntimeMemoryStateView,
    defaultChainId: DEFAULT_CHAIN_ID,
    defaultLightweightTranscriptLimit: DEFAULT_LIGHTWEIGHT_TRANSCRIPT_LIMIT,
    listAgentConversationMinutes,
    listAgentDecisionLogs,
    listAgentEvidenceRefs,
    listAgentMemories,
    listAgentTaskSnapshots,
    listAgentTranscriptEntries,
    listAgentWindows,
    listAuthorizationProposalViews,
    listCredentialRecordViews,
    listRuntimeMemoryStatesFromStore,
    resolveActiveMemoryHomeostasisModelName,
    resolveEffectiveAgentCognitiveState: (store, agent, options = {}) =>
      resolveEffectiveAgentCognitiveState(store, agent, options, buildCognitiveStateDeps()),
    resolveMemoryStabilityRuntimeContractModelProfile,
    resolveRuntimeMemoryHomeostasisProfile,
    runtimeMemoryStoreAdapter: RUNTIME_MEMORY_STORE_ADAPTER,
  };
}

function buildAgentMemoryLayerViewDeps() {
  return {
    buildPassportEventGraphSnapshot,
    buildPassportMemoryRetrievalCandidates,
    buildPassportMemorySearchText,
    completePassportMemoryPatterns,
    computePassportMemoryAgeDays,
    defaultMemoryPatternCompletionExtra: DEFAULT_MEMORY_PATTERN_COMPLETION_EXTRA,
    extractPassportEventGraphValue,
    getPassportMemorySeparationKey,
    inferDidAliases,
    latestAgentTaskSnapshot,
    listAgentCognitiveStatesFromStore,
    listAgentPassportMemories,
    listAgentWindows,
    listAuthorizationProposalViews,
    mergeUniquePassportMemories,
    selectPatternSeparatedPassportMemories,
  };
}

const buildAgentRuntimeSnapshot = (store, agent, options = {}) =>
  buildAgentRuntimeSnapshotImpl(store, agent, options, buildAgentRuntimeSnapshotDeps());

const buildLightweightContextRuntimeSnapshot = (store, agent, options = {}) =>
  buildLightweightContextRuntimeSnapshotImpl(store, agent, options, buildAgentRuntimeSnapshotDeps());

const buildAgentMemoryLayerView = (store, agent, options = {}) =>
  buildAgentMemoryLayerViewImpl(store, agent, options, buildAgentMemoryLayerViewDeps());

const CREDENTIAL_REPAIR_RUNNER_DEPS = {
  buildAgentComparisonView,
  buildAgentCredentialMethodCoverage,
  defaultCredentialLimit: DEFAULT_CREDENTIAL_LIMIT,
  ensureAgent,
  ensureAgentComparisonCredentialSnapshot,
  ensureAgentCredentialSnapshot,
  ensureAuthorizationCredentialSnapshot,
  ensureAuthorizationProposal,
  issueMigrationRepairReceipt,
  resolveAgentComparisonAuditPair,
  resolveAgentReferenceFromStore,
};

function buildLedgerRecordsDeps() {
  return {
    DEFAULT_CREDENTIAL_LIMIT,
    PUBLIC_SIGNABLE_DID_METHODS,
    SIGNABLE_DID_METHODS,
    loadStore,
    cloneJson,
    normalizeOptionalText,
    normalizeCredentialRecord,
    normalizeCredentialKind,
    didMethodFromReference,
    compareCredentialIds,
    createRecordId,
    normalizeCredentialTimelineEntry,
    compareCredentialTimelineEntries,
    buildCredentialTimeline,
    buildCredentialRecordView,
    listCredentialRecordViews,
    findCredentialRecordById,
    resolveCredentialStatusListReference,
    buildCredentialStatusLists,
    buildCredentialStatusList,
    buildCredentialStatusListComparison,
    normalizeCredentialStatusListReference,
    credentialStatusListIssuerDidFromId,
    buildCredentialStatusProof,
    normalizeCredentialTimelineRecords,
    toFiniteNumber,
    matchesCompatibleAgentId,
  };
}

export {
  listReadSessionRolesImpl as listReadSessionRoles,
  listReadSessionScopesImpl as listReadSessionScopes,
};

function normalizeAuthorizationActionType(value) {
  const text = normalizeOptionalText(value)
    ?.toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!text) {
    throw new Error("actionType is required");
  }

  if (["grant", "grant_asset", "asset_grant", "grantasset"].includes(text)) {
    return "grant_asset";
  }

  if (["fork", "fork_agent", "agent_fork", "forkagent"].includes(text)) {
    return "fork_agent";
  }

  if (["policy", "update_policy", "policy_update", "updatepolicy"].includes(text)) {
    return "update_policy";
  }

  if (!AUTHORIZATION_ACTION_TYPES.has(text)) {
    throw new Error(`Unsupported authorization actionType: ${value}`);
  }

  return text;
}

function mergeRawApprovalInputs(existing = [], incoming = []) {
  const merged = [];
  const seen = new Set();

  for (const raw of [...existing, ...incoming]) {
    if (raw == null) {
      continue;
    }

    const key = typeof raw === "string" ? raw.trim() : JSON.stringify(raw);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(raw);
  }

  return merged;
}

function proposalRelatedAgentIds(proposal, store = null) {
  const payload = proposal?.payload || {};
  const relatedAgentIds = new Set();

  const add = (value) => {
    const text = normalizeOptionalText(value);
    if (text) {
      relatedAgentIds.add(text);
    }
  };

  [
    proposal?.policyAgentId,
    payload.agentId,
    payload.targetAgentId,
    payload.toAgentId,
    payload.fromAgentId,
    payload.sourceAgentId,
    proposal?.createdByAgentId,
    proposal?.executedByAgentId,
    proposal?.revokedByAgentId,
    proposal?.lastSignedByAgentId,
    proposal?.executionReceipt?.executorAgentId,
  ].forEach(add);

  if (store && Array.isArray(proposal?.signatureRecords)) {
    for (const record of proposal.signatureRecords) {
      add(record?.recordedByAgentId);
      add(record?.signerAgentId);
      const signerWalletAddress = normalizeOptionalText(record?.signerWalletAddress)?.toLowerCase();
      if (!signerWalletAddress) {
        continue;
      }

      const signerAgent = findAgentByWalletAddress(store, signerWalletAddress);
      add(signerAgent?.agentId);
    }
  }

  return [...relatedAgentIds];
}

function isProposalRelatedToAgent(proposal, agentId, store = null) {
  if (!proposal || !agentId) {
    return false;
  }

  return proposalRelatedAgentIds(proposal, store).some((value) => matchesCompatibleAgentId(store, value, agentId));
}

function normalizeProposalSignatureRecord(record, fallback = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const signerWalletAddress = normalizeOptionalText(record.signerWalletAddress || record.walletAddress || fallback.signerWalletAddress);
  const signerLabel = normalizeOptionalText(
    record.signerLabel || record.label || fallback.signerLabel || record.approval || signerWalletAddress
  );

  return {
    signatureId: normalizeOptionalText(record.signatureId) || createRecordId("sig"),
    proposalId: normalizeOptionalText(record.proposalId || fallback.proposalId) ?? null,
    policyAgentId: normalizeOptionalText(record.policyAgentId || fallback.policyAgentId) ?? null,
    actionType: normalizeOptionalText(record.actionType || fallback.actionType) ?? null,
    signerLabel: signerLabel || signerWalletAddress || "signer",
    signerWalletAddress: signerWalletAddress ? signerWalletAddress.toLowerCase() : null,
    approval: normalizeOptionalText(record.approval) ?? signerLabel ?? signerWalletAddress ?? null,
    recordedAt: normalizeOptionalText(record.recordedAt) || fallback.recordedAt || now(),
    recordedByAgentId: normalizeOptionalText(record.recordedByAgentId || fallback.recordedByAgentId) ?? null,
    recordedByLabel: normalizeOptionalText(record.recordedByLabel || fallback.recordedByLabel) ?? null,
    recordedByDid: normalizeOptionalText(record.recordedByDid || fallback.recordedByDid) ?? null,
    recordedByWalletAddress:
      normalizeOptionalText(record.recordedByWalletAddress || fallback.recordedByWalletAddress)?.toLowerCase() ?? null,
    recordedByWindowId: normalizeOptionalText(record.recordedByWindowId || fallback.recordedByWindowId) ?? null,
    source: normalizeOptionalText(record.source || fallback.source) ?? "proposal",
    note: normalizeOptionalText(record.note || fallback.note) ?? null,
  };
}

function resolveActorContext(store, { agentId = null, did = null, walletAddress = null, label = null, windowId = null, fallbackText = null } = {}) {
  const normalizedWindowId = normalizeOptionalText(windowId) ?? null;
  const windowAgentId = normalizedWindowId ? store?.windows?.[normalizedWindowId]?.agentId ?? null : null;
  const windowAgent = windowAgentId ? store?.agents?.[windowAgentId] ?? null : null;
  const explicitAgent = normalizeOptionalText(agentId) ? store?.agents?.[normalizeOptionalText(agentId)] ?? null : null;
  const didAgent = normalizeOptionalText(did) ? findAgentByDid(store, did) : null;
  const walletAgent = normalizeOptionalText(walletAddress) ? findAgentByWalletAddress(store, walletAddress) : null;
  const resolvedAgent = windowAgent || explicitAgent || didAgent || walletAgent || null;

  return {
    agentId: resolvedAgent?.agentId ?? null,
    did: resolvedAgent?.identity?.did ?? normalizeOptionalText(did) ?? null,
    walletAddress: resolvedAgent?.identity?.walletAddress ?? normalizeOptionalText(walletAddress)?.toLowerCase() ?? null,
    label: resolvedAgent?.displayName ?? resolvedAgent?.controller ?? normalizeOptionalText(label) ?? normalizeOptionalText(fallbackText) ?? null,
    windowId: normalizedWindowId,
    resolved: Boolean(resolvedAgent),
  };
}

function normalizeProposalSignatureRecords(records, fallback = {}) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map((record) => normalizeProposalSignatureRecord(record, fallback)).filter(Boolean);
}

function normalizeProposalExecutionReceipt(record, fallback = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }

  return {
    receiptId: normalizeOptionalText(record.receiptId) || createRecordId("rcpt"),
    proposalId: normalizeOptionalText(record.proposalId || fallback.proposalId) ?? null,
    policyAgentId: normalizeOptionalText(record.policyAgentId || fallback.policyAgentId) ?? null,
    actionType: normalizeOptionalText(record.actionType || fallback.actionType) ?? null,
    status: normalizeOptionalText(record.status) || "succeeded",
    executedAt: normalizeOptionalText(record.executedAt) || fallback.executedAt || now(),
    executorAgentId: normalizeOptionalText(record.executorAgentId || fallback.executorAgentId) ?? null,
    executorLabel: normalizeOptionalText(record.executorLabel || fallback.executorLabel) ?? null,
    executorDid: normalizeOptionalText(record.executorDid || fallback.executorDid) ?? null,
    executorWalletAddress:
      normalizeOptionalText(record.executorWalletAddress || fallback.executorWalletAddress)?.toLowerCase() ?? null,
    executorWindowId: normalizeOptionalText(record.executorWindowId || fallback.executorWindowId) ?? null,
    approvalCount: toFiniteNumber(record.approvalCount ?? fallback.approvalCount, 0),
    threshold: toFiniteNumber(record.threshold ?? fallback.threshold, 0),
    approvalSigners: Array.isArray(record.approvalSigners) ? record.approvalSigners : [],
    resultSummary: cloneJson(record.resultSummary ?? fallback.resultSummary) ?? null,
    eventHash: normalizeOptionalText(record.eventHash || fallback.eventHash) ?? null,
    error: normalizeOptionalText(record.error || fallback.error) ?? null,
    source: normalizeOptionalText(record.source || fallback.source) ?? "proposal_execution",
    note: normalizeOptionalText(record.note || fallback.note) ?? null,
  };
}

function buildSignatureRecordFromApproval({
  proposal,
  approval,
  recordedByAgentId,
  recordedByLabel,
  recordedByDid,
  recordedByWalletAddress,
  recordedByWindowId,
  source,
  note,
  recordedAt,
}) {
  if (!proposal || !approval) {
    return null;
  }

  const signerWalletAddress = normalizeOptionalText(approval.signerWalletAddress)?.toLowerCase();
  if (!signerWalletAddress) {
    return null;
  }

  return normalizeProposalSignatureRecord(
    {
      signatureId: createRecordId("sig"),
      proposalId: proposal.proposalId,
      policyAgentId: proposal.policyAgentId,
      actionType: proposal.actionType,
      signerLabel: approval.signerLabel,
      signerWalletAddress,
      approval: approval.approval,
      recordedAt: recordedAt || now(),
      recordedByAgentId,
      recordedByLabel,
      recordedByDid,
      recordedByWalletAddress,
      recordedByWindowId,
      source,
      note,
    },
    {
      proposalId: proposal.proposalId,
      policyAgentId: proposal.policyAgentId,
      actionType: proposal.actionType,
      recordedByAgentId,
      recordedByLabel,
      recordedByDid,
      recordedByWalletAddress,
      recordedByWindowId,
      source,
      note,
      recordedAt,
    }
  );
}

function appendProposalSignatureRecords(proposal, approvals = [], metadata = {}) {
  if (!proposal) {
    return [];
  }

  if (!Array.isArray(proposal.signatureRecords)) {
    proposal.signatureRecords = [];
  }

  const existingWallets = new Set(
    proposal.signatureRecords
      .map((record) => normalizeOptionalText(record?.signerWalletAddress)?.toLowerCase())
      .filter(Boolean)
  );
  const added = [];

  for (const approval of approvals) {
    const record = buildSignatureRecordFromApproval({
      proposal,
      approval,
      recordedByAgentId: metadata.recordedByAgentId ?? null,
      recordedByLabel: metadata.recordedByLabel ?? null,
      recordedByDid: metadata.recordedByDid ?? null,
      recordedByWalletAddress: metadata.recordedByWalletAddress ?? null,
      recordedByWindowId: metadata.recordedByWindowId ?? null,
      source: metadata.source ?? "proposal_sign",
      note: metadata.note ?? null,
      recordedAt: metadata.recordedAt ?? now(),
    });

    if (!record || !record.signerWalletAddress) {
      continue;
    }

    if (existingWallets.has(record.signerWalletAddress)) {
      continue;
    }

    proposal.signatureRecords.push(record);
    existingWallets.add(record.signerWalletAddress);
    added.push(record);
  }

  if (added.length > 0) {
    proposal.approvals = mergeRawApprovalInputs(
      Array.isArray(proposal.approvals) ? proposal.approvals : [],
      added.map((record) => record.approval)
    );
  }

  return added;
}

async function writeStore(store, { archiveColdData = true } = {}) {
  if (isPassiveStoreAccess()) {
    const error = new Error("Passive store access cannot write the local ledger");
    error.code = "PASSIVE_STORE_WRITE";
    throw error;
  }
  const storeDir = path.dirname(STORE_PATH);
  await mkdir(storeDir, { recursive: true });
  if (archiveColdData) {
    await archiveStoreColdDataIfNeeded(store, {
      archiveRoot: STORE_ARCHIVE_DIR,
      isPassportMemoryActive,
    });
  }
  const tempPath = path.join(
    storeDir,
    `.${path.basename(STORE_PATH)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );
  const encryptedEnvelope = await encryptStorePayload(store);
  const persistedPayload = JSON.stringify(encryptedEnvelope, null, 2);
  await writeFile(tempPath, persistedPayload, "utf-8");
  await rename(tempPath, STORE_PATH);
  primeStoreCache(store, buildStoreFileFingerprint(persistedPayload));
}

async function writeReadSessionStore(store) {
  if (isPassiveStoreAccess()) {
    const error = new Error("Passive store access cannot write the read-session ledger");
    error.code = "PASSIVE_READ_SESSION_STORE_WRITE";
    throw error;
  }
  const normalizedStore = normalizeReadSessionStoreState(store);
  normalizedStore.updatedAt = now();
  const storeDir = path.dirname(READ_SESSION_STORE_PATH);
  await mkdir(storeDir, { recursive: true });
  const tempPath = path.join(
    storeDir,
    `.${path.basename(READ_SESSION_STORE_PATH)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );
  const persistedPayload = JSON.stringify(normalizedStore, null, 2);
  await writeFile(tempPath, persistedPayload, "utf-8");
  await rename(tempPath, READ_SESSION_STORE_PATH);
  primeReadSessionStoreCache(normalizedStore, buildStoreFileFingerprint(persistedPayload));
  return cloneJson(normalizedStore);
}

async function loadLegacyReadSessionStoreSnapshot() {
  const mainStore = await loadStoreIfPresent({ migrate: true, createKey: false });
  const legacySessions = Array.isArray(mainStore?.readSessions)
    ? mainStore.readSessions.filter((record) => record && typeof record === "object")
    : [];
  if (legacySessions.length <= 0) {
    return null;
  }
  const migratedStore = createInitialReadSessionStore();
  migratedStore.readSessions = cloneJson(legacySessions) ?? [];
  return migratedStore;
}

async function loadReadSessionStore({ migrateLegacy = true, createIfMissing = true } = {}) {
  const passive = isPassiveStoreAccess();
  try {
    const raw = await readFile(READ_SESSION_STORE_PATH, "utf-8");
    const fingerprint = buildStoreFileFingerprint(raw);
    if (readSessionStoreCacheMatchesFingerprint(fingerprint)) {
      return cloneJson(readSessionStoreCache.store);
    }
    const normalizedStore = normalizeReadSessionStoreState(JSON.parse(raw));
    primeReadSessionStoreCache(normalizedStore, fingerprint);
    return cloneJson(normalizedStore);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    clearReadSessionStoreCache();
    if (!createIfMissing) {
      if (migrateLegacy) {
        const legacyStore = await loadLegacyReadSessionStoreSnapshot();
        if (legacyStore) {
          return cloneJson(legacyStore);
        }
      }
      return createInitialReadSessionStore();
    }
    if (passive) {
      if (migrateLegacy) {
        const legacyStore = await loadLegacyReadSessionStoreSnapshot();
        if (legacyStore) {
          return cloneJson(legacyStore);
        }
      }
      return createInitialReadSessionStore();
    }
    if (migrateLegacy) {
      const legacyStore = await loadLegacyReadSessionStoreSnapshot();
      if (legacyStore) {
        await writeReadSessionStore(legacyStore);
        return cloneJson(legacyStore);
      }
    }
    const freshStore = createInitialReadSessionStore();
    await writeReadSessionStore(freshStore);
    return cloneJson(freshStore);
  }
}

function normalizeAgentRecord(agent, chainId) {
  const normalized = {
    ...agent,
    agentId: agent.agentId,
    displayName: agent.displayName || agent.agentId,
    role: agent.role || "individual-agent",
    controller: agent.controller || "unknown",
    parentAgentId: agent.parentAgentId ?? null,
    createdAt: agent.createdAt || now(),
    createdByEventHash: agent.createdByEventHash ?? null,
    status: agent.status || "active",
    balances: {
      credits: toFiniteNumber(agent.balances?.credits, 0),
    },
  };

  const identity = buildIdentityProfile({
    chainId,
    agentId: normalized.agentId,
    displayName: normalized.displayName,
    controller: normalized.controller,
    controllers: agent.identity?.controllers?.length ? agent.identity.controllers : undefined,
    signers: agent.identity?.authorizationPolicy?.signers?.length ? agent.identity.authorizationPolicy.signers : undefined,
    walletAddress: agent.identity?.walletAddress,
    threshold: agent.identity?.authorizationPolicy?.threshold,
    existingIdentity: agent.identity,
    preserveDid: Boolean(agent.identity?.did),
    originDid: agent.identity?.originDid ?? null,
  });

  normalized.identity = {
    ...identity,
    originDid: agent.identity?.originDid ?? identity.originDid ?? null,
  };

  if (!normalized.controller || normalized.controller === "unknown") {
    normalized.controller = normalized.identity.controllers.map((signer) => signer.label).join(", ");
  }

  return normalized;
}

function migrateStore(store) {
  const migrated = buildMigratedStoreShell(store, {
    defaultChainId: DEFAULT_CHAIN_ID,
    normalizeDeviceRuntime,
  });

  let changed = didStoreShellChange(store, migrated);

  for (const [agentId, agent] of Object.entries(migrated.agents)) {
    const normalized = normalizeAgentRecord({ ...agent, agentId }, migrated.chainId);
    if (JSON.stringify(normalized) !== JSON.stringify(agent)) {
      changed = true;
    }
    migrated.agents[agentId] = normalized;
  }

  migrated.localReasonerProfiles = migrated.localReasonerProfiles.map((profile) => {
    if (!profile || typeof profile !== "object") {
      changed = true;
      return normalizeLocalReasonerProfileRecord({});
    }
    const normalizedProfile = normalizeLocalReasonerProfileRecord(profile);
    if (JSON.stringify(normalizedProfile) !== JSON.stringify(profile)) {
      changed = true;
    }
    return normalizedProfile;
  });

  migrated.sandboxActionAudits = migrated.sandboxActionAudits.map((audit) => {
    if (!audit || typeof audit !== "object") {
      changed = true;
      return normalizeSandboxActionAuditRecord({});
    }
    const normalizedAudit = normalizeSandboxActionAuditRecord(audit);
    if (JSON.stringify(normalizedAudit) !== JSON.stringify(audit)) {
      changed = true;
    }
    return normalizedAudit;
  });

  migrated.runtimeMemoryObservations = migrated.runtimeMemoryObservations.map((observation) => {
    if (!observation || typeof observation !== "object") {
      changed = true;
      return normalizeRuntimeMemoryObservationRecord({});
    }
    const normalizedObservation = normalizeRuntimeMemoryObservationRecord(observation);
    if (JSON.stringify(normalizedObservation) !== JSON.stringify(observation)) {
      changed = true;
    }
    return normalizedObservation;
  });

  migrated.proposals = migrated.proposals.map((proposal) => {
    if (!proposal || typeof proposal !== "object") {
      changed = true;
      return proposal;
    }

    const normalizedProposal = { ...proposal };
    const proposalId = normalizeOptionalText(normalizedProposal.proposalId) || createRecordId("prop");
    if (proposalId !== normalizedProposal.proposalId) {
      normalizedProposal.proposalId = proposalId;
      changed = true;
    }

    const policyAgentId = normalizeOptionalText(normalizedProposal.policyAgentId) || resolveDefaultResidentAgentId(migrated);
    if (policyAgentId !== normalizedProposal.policyAgentId) {
      normalizedProposal.policyAgentId = policyAgentId;
      changed = true;
    }

    const actionType = normalizeAuthorizationActionType(normalizedProposal.actionType || "grant_asset");
    if (actionType !== normalizedProposal.actionType) {
      normalizedProposal.actionType = actionType;
      changed = true;
    }

    if (!Array.isArray(normalizedProposal.approvals)) {
      normalizedProposal.approvals = [];
      changed = true;
    } else {
      normalizedProposal.approvals = [...normalizedProposal.approvals];
    }

    const proposalFallback = {
      proposalId: normalizedProposal.proposalId,
      policyAgentId: normalizedProposal.policyAgentId,
      actionType: normalizedProposal.actionType,
      recordedByAgentId: normalizeOptionalText(normalizedProposal.createdByAgentId) || normalizedProposal.policyAgentId,
      recordedByLabel: normalizeOptionalText(normalizedProposal.createdByLabel || normalizedProposal.createdByAgentId) ?? null,
      recordedByDid: normalizeOptionalText(normalizedProposal.createdByDid) ?? null,
      recordedByWalletAddress: normalizeOptionalText(normalizedProposal.createdByWalletAddress)?.toLowerCase() ?? null,
      recordedByWindowId: normalizeOptionalText(normalizedProposal.createdByWindowId) ?? null,
      source: "migration",
      recordedAt: normalizedProposal.updatedAt || normalizedProposal.createdAt || migrated.createdAt,
      executedAt: normalizedProposal.executedAt || normalizedProposal.updatedAt || normalizedProposal.createdAt || migrated.createdAt,
      executorAgentId: normalizeOptionalText(normalizedProposal.executedByAgentId) ?? null,
      executorLabel: normalizeOptionalText(normalizedProposal.executedByLabel || normalizedProposal.executedByAgentId) ?? null,
      executorDid: normalizeOptionalText(normalizedProposal.executedByDid) ?? null,
      executorWalletAddress: normalizeOptionalText(normalizedProposal.executedByWalletAddress)?.toLowerCase() ?? null,
      executorWindowId: normalizeOptionalText(normalizedProposal.executedByWindowId) ?? null,
      approvalCount: normalizedProposal.approvals.length,
      threshold: 0,
      resultSummary: normalizedProposal.executionResult ?? null,
      eventHash: normalizedProposal.executionResult?.eventHash ?? null,
    };

    const normalizedSignatures = normalizeProposalSignatureRecords(
      normalizedProposal.signatureRecords || normalizedProposal.signatures || [],
      proposalFallback
    );

    const policyAgent = migrated.agents[normalizedProposal.policyAgentId];
    let signatureRecords = normalizedSignatures;
    if (signatureRecords.length === 0 && normalizedProposal.approvals.length > 0 && policyAgent) {
      try {
        const approvalSummary = summarizeApprovals({
          store: migrated,
          policyAgent,
          rawApprovals: normalizedProposal.approvals,
        });

        signatureRecords = approvalSummary.approvals.map((approval) =>
          buildSignatureRecordFromApproval({
            proposal: normalizedProposal,
            approval,
            recordedByAgentId: proposalFallback.recordedByAgentId,
            recordedByLabel: proposalFallback.recordedByLabel,
            recordedByDid: proposalFallback.recordedByDid,
            recordedByWalletAddress: proposalFallback.recordedByWalletAddress,
            recordedByWindowId: proposalFallback.recordedByWindowId,
            source: "migration",
            note: "backfilled from approvals",
            recordedAt: proposalFallback.recordedAt,
          })
        );
        changed = true;
      } catch {
        signatureRecords = [];
      }
    }

    normalizedProposal.signatureRecords = signatureRecords;
    delete normalizedProposal.signatures;

    if (normalizedProposal.executionReceipt) {
      normalizedProposal.executionReceipt = normalizeProposalExecutionReceipt(normalizedProposal.executionReceipt, proposalFallback);
    } else if (normalizedProposal.status === "executed") {
      normalizedProposal.executionReceipt = normalizeProposalExecutionReceipt(
        {
          status: "succeeded",
          executedAt: proposalFallback.executedAt,
          executorAgentId: proposalFallback.executorAgentId,
          executorLabel: proposalFallback.executorLabel,
          executorDid: proposalFallback.executorDid,
          executorWalletAddress: proposalFallback.executorWalletAddress,
          executorWindowId: proposalFallback.executorWindowId,
          approvalCount: normalizedProposal.approvals.length,
          threshold: policyAgent?.identity?.authorizationPolicy?.threshold ?? 0,
          approvalSigners: signatureRecords,
          resultSummary: normalizedProposal.executionResult ?? null,
          eventHash: normalizedProposal.executionResult?.eventHash ?? null,
          source: "migration",
          note: "backfilled from executed proposal",
        },
        proposalFallback
      );
      changed = true;
    }

    if (normalizedProposal.status === "executed" && !normalizedProposal.executionResult && normalizedProposal.executionReceipt) {
      normalizedProposal.executionResult = cloneJson(normalizedProposal.executionReceipt.resultSummary) ?? normalizedProposal.executionResult ?? null;
    }

    normalizedProposal.signatureRecords = normalizedProposal.signatureRecords.map((record) =>
      normalizeProposalSignatureRecord(record, proposalFallback)
    );

    const proposalChanged = JSON.stringify(normalizedProposal) !== JSON.stringify(proposal);
    if (proposalChanged) {
      changed = true;
    }

    return normalizedProposal;
  });

  const usedStatusIndicesByList = new Map();
  const nextStatusIndicesByList = new Map();
  const defaultIssuerDid = credentialStatusListIssuerDid(migrated);

  migrated.credentials = migrated.credentials.map((record) => {
    if (!record || typeof record !== "object") {
      changed = true;
      return record;
    }

    const recordIssuerDid =
      normalizeOptionalText(record.issuerDid) ??
      credentialStatusListIssuerDidFromId(record.statusListId) ??
      defaultIssuerDid;
    const normalizedStatusListId =
      normalizeCredentialStatusListReference(record.statusListId) ??
      credentialStatusListId(migrated, recordIssuerDid);
    const usedStatusIndices = usedStatusIndicesByList.get(normalizedStatusListId) ?? new Set();
    usedStatusIndicesByList.set(normalizedStatusListId, usedStatusIndices);

    const normalizedRecord = normalizeCredentialRecord(record, {
      chainId: migrated.chainId,
      statusListId: normalizedStatusListId,
      statusPurpose: DEFAULT_CREDENTIAL_STATUS_PURPOSE,
      issuerDid: recordIssuerDid,
      agentId: record?.subjectType === "agent" ? record?.subjectId : record?.issuerAgentId ?? null,
      proposalId: record?.subjectType === "proposal" ? record?.subjectId : null,
    });

    if (!normalizedRecord) {
      changed = true;
      return normalizedRecord;
    }

    const desiredIndex = Number.isFinite(Number(normalizedRecord.statusListIndex))
      ? Math.max(0, Math.floor(Number(normalizedRecord.statusListIndex)))
      : null;
    let statusListIndex = desiredIndex;
    if (statusListIndex == null || usedStatusIndices.has(statusListIndex)) {
      let nextStatusIndex = nextStatusIndicesByList.get(normalizedStatusListId) ?? 0;
      while (usedStatusIndices.has(nextStatusIndex)) {
        nextStatusIndex += 1;
      }
      statusListIndex = nextStatusIndex;
      nextStatusIndex += 1;
      nextStatusIndicesByList.set(normalizedStatusListId, nextStatusIndex);
      changed = true;
    } else {
      const nextStatusIndex = nextStatusIndicesByList.get(normalizedStatusListId) ?? 0;
      if (statusListIndex >= nextStatusIndex) {
        nextStatusIndicesByList.set(normalizedStatusListId, statusListIndex + 1);
      }
    }
    usedStatusIndices.add(statusListIndex);

    if (
      normalizedRecord.statusListId !== normalizedStatusListId ||
      normalizedRecord.statusListIndex !== statusListIndex ||
      normalizedRecord.statusPurpose !== DEFAULT_CREDENTIAL_STATUS_PURPOSE
    ) {
      changed = true;
    }
    normalizedRecord.statusListId = normalizedStatusListId;
    normalizedRecord.statusListIndex = statusListIndex;
    normalizedRecord.statusPurpose = DEFAULT_CREDENTIAL_STATUS_PURPOSE;
    normalizedRecord.statusListCredentialId = `${normalizedStatusListId}#credential`;
    normalizedRecord.statusListEntryId = `${normalizedStatusListId}#entry-${statusListIndex}`;

    if (normalizedRecord.credential && typeof normalizedRecord.credential === "object") {
      const nextCredentialStatus = {
        ...(normalizedRecord.credential.credentialStatus && typeof normalizedRecord.credential.credentialStatus === "object"
          ? normalizedRecord.credential.credentialStatus
          : {}),
        id: normalizedRecord.statusListEntryId,
        type:
          normalizeOptionalText(
            normalizedRecord.credential.credentialStatus && typeof normalizedRecord.credential.credentialStatus === "object"
              ? normalizedRecord.credential.credentialStatus.type
              : null
          ) ?? DEFAULT_CREDENTIAL_STATUS_ENTRY_TYPE,
        statusPurpose: DEFAULT_CREDENTIAL_STATUS_PURPOSE,
        statusListIndex,
        statusListCredential: normalizedRecord.statusListCredentialId,
        statusListId: normalizedStatusListId,
        chainId: migrated.chainId,
        ledgerHash: normalizedRecord.ledgerHash,
        snapshotPurpose: credentialSnapshotPurpose(normalizedRecord),
      };
      const relatedAgentId =
        normalizedRecord.subjectType === "agent" ? normalizedRecord.subjectId : normalizedRecord.issuerAgentId ?? null;
      const proposalId = normalizedRecord.subjectType === "proposal" ? normalizedRecord.subjectId : null;
      const comparisonDigest =
        normalizedRecord.kind === "agent_comparison" || normalizedRecord.subjectType === "comparison"
          ? normalizedRecord.comparisonDigest ??
            (normalizedRecord.credential.credentialStatus && typeof normalizedRecord.credential.credentialStatus === "object"
              ? normalizedRecord.credential.credentialStatus.comparisonDigest
              : null)
          : null;

      if (relatedAgentId) {
        nextCredentialStatus.agentId = relatedAgentId;
      } else {
        delete nextCredentialStatus.agentId;
      }

      if (proposalId) {
        nextCredentialStatus.proposalId = proposalId;
      } else {
        delete nextCredentialStatus.proposalId;
        delete nextCredentialStatus.proposalStatus;
      }

      if (comparisonDigest) {
        nextCredentialStatus.comparisonDigest = comparisonDigest;
      } else {
        delete nextCredentialStatus.comparisonDigest;
      }

      normalizedRecord.credential.credentialStatus = nextCredentialStatus;
    }

    if (JSON.stringify(normalizedRecord) !== JSON.stringify(record)) {
      changed = true;
    }

    return normalizedRecord;
  }).filter(Boolean);

  setCredentialStatusIndexMap(migrated, Object.fromEntries(nextStatusIndicesByList.entries()));

  const recalculatedLastEventHash = migrated.events.at(-1)?.hash ?? null;
  if (migrated.lastEventHash !== recalculatedLastEventHash) {
    migrated.lastEventHash = recalculatedLastEventHash;
    changed = true;
  }

  if (JSON.stringify(migrated.deviceRuntime) !== JSON.stringify(store.deviceRuntime || null)) {
    changed = true;
  }

  return { store: migrated, changed };
}

function createInitialStore() {
  const store = createInitialStoreShell({
    chainId: DEFAULT_CHAIN_ID,
    deviceRuntime: buildDefaultDeviceRuntime(),
  });

  const genesisEvent = appendEvent(store, "genesis", {
    chainId: DEFAULT_CHAIN_ID,
    note: `${PROTOCOL_NAME} local chain initialized`,
  });

  const treasuryIdentity = buildIdentityProfile({
    chainId: store.chainId,
    agentId: TREASURY_AGENT_ID,
    displayName: "agent-passport Treasury",
    controller: "system",
  });
  const treasury = baseAgentRecord({
    agentId: TREASURY_AGENT_ID,
    displayName: "agent-passport Treasury",
    role: "system-treasury",
    controller: "system",
    createdByEventHash: genesisEvent.hash,
    identity: treasuryIdentity,
  });
  treasury.balances.credits = 1000000;
  store.agents[treasury.agentId] = treasury;

  const physicalMainAgentIdentity = buildIdentityProfile({
    chainId: store.chainId,
    agentId: AGENT_PASSPORT_MAIN_AGENT_ID,
    displayName: "agent-passport Main Agent",
    controller: "Kane",
  });
  const physicalMainAgent = baseAgentRecord({
    agentId: AGENT_PASSPORT_MAIN_AGENT_ID,
    displayName: "agent-passport Main Agent",
    role: "shared-identity",
    controller: "Kane",
    createdByEventHash: genesisEvent.hash,
    identity: physicalMainAgentIdentity,
  });
  physicalMainAgent.balances.credits = 100;
  store.agents[physicalMainAgent.agentId] = physicalMainAgent;
  const mainAgentIdentityOwnerBinding = buildMainAgentIdentityOwnerBinding(store);

  appendEvent(store, "bootstrap_agents", {
    agents: [TREASURY_AGENT_ID, mainAgentIdentityOwnerBinding.currentPhysicalAgentId],
    canonicalMainAgentId: AGENT_PASSPORT_MAIN_AGENT_ID,
    currentPhysicalMainAgentId: mainAgentIdentityOwnerBinding.currentPhysicalAgentId,
    legacyCompatibleMainAgentId: LEGACY_OPENNEED_AGENT_ID,
    mainAgentIdentityOwnerBinding,
    treasuryGrantedCredits: 100,
    treasuryDid: treasury.identity.did,
    mainAgentDid: physicalMainAgent.identity.did,
  });

  return store;
}

export async function loadStore() {
  const passive = isPassiveStoreAccess();
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    const fingerprint = buildStoreFileFingerprint(raw);
    if (storeCacheMatchesFingerprint(fingerprint)) {
      if (storeEncryptionKeyPromise) {
        const cachedKey = await storeEncryptionKeyPromise;
        if (!(await cachedStoreEncryptionKeyStillPresent(cachedKey))) {
          clearStoreCache();
        } else {
          return cloneJson(storeCache.store);
        }
      } else {
        return cloneJson(storeCache.store);
      }
    }
    clearStoreCache();
    const parsed = JSON.parse(raw);
    const encrypted = isEncryptedStoreEnvelope(parsed);
    const decrypted = encrypted
      ? await decryptStoreEnvelope(parsed, { createKey: false })
      : parsed;
    const migrated = migrateStore(decrypted);
    if (migrated.changed) {
      if (passive) {
        clearStoreCache();
        return cloneJson(migrated.store);
      }
      await writeStore(migrated.store);
      return cloneJson(migrated.store);
    } else if (!encrypted) {
      if (passive) {
        clearStoreCache();
        return cloneJson(migrated.store);
      }
      await writeStore(migrated.store);
      return cloneJson(migrated.store);
    }
    primeStoreCache(migrated.store, fingerprint);
    return cloneJson(migrated.store);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    clearStoreCache();
    const fresh = createInitialStore();
    if (passive) {
      return cloneJson(fresh);
    }
    await writeStore(fresh);
    return cloneJson(fresh);
  }
}

export async function loadStoreIfPresent({ migrate = true, createKey = false } = {}) {
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const decrypted = isEncryptedStoreEnvelope(parsed)
      ? await decryptStoreEnvelope(parsed, { createKey: createKey && !isPassiveStoreAccess() })
      : parsed;
    if (!migrate) {
      return cloneJson(decrypted);
    }
    const migrated = migrateStore(decrypted);
    return cloneJson(migrated.store);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function sanitizeMainAgentCanonicalMigrationResult(result, { includeStore = false } = {}) {
  if (includeStore) {
    return result;
  }
  const { store, ...sanitized } = result || {};
  return sanitized;
}

async function attachMainAgentCanonicalArchiveAudit(result, { includeArchiveAudit = true } = {}) {
  if (!includeArchiveAudit) {
    return result;
  }
  return {
    ...(result || {}),
    archiveJsonlStructuredAudit: await auditMainAgentCanonicalArchiveDirectories({
      archiveRoot: STORE_ARCHIVE_DIR,
      legacyAgentId: LEGACY_OPENNEED_AGENT_ID,
      canonicalAgentId: AGENT_PASSPORT_MAIN_AGENT_ID,
    }),
  };
}

export async function previewMainAgentCanonicalPhysicalMigration({ includeStore = false, includeArchiveAudit = true } = {}) {
  const store = await loadStore();
  const preview = await attachMainAgentCanonicalArchiveAudit(
    previewMainAgentCanonicalPhysicalMigrationStore(store, {
      legacyAgentId: LEGACY_OPENNEED_AGENT_ID,
      canonicalAgentId: AGENT_PASSPORT_MAIN_AGENT_ID,
    }),
    { includeArchiveAudit }
  );
  return sanitizeMainAgentCanonicalMigrationResult(preview, { includeStore });
}

export async function applyMainAgentCanonicalPhysicalMigration({
  passphrase,
  note = null,
  includeStore = false,
  includeArchiveAudit = true,
  rewriteArchiveJsonl = false,
} = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const preview = await attachMainAgentCanonicalArchiveAudit(
      previewMainAgentCanonicalPhysicalMigrationStore(store, {
        legacyAgentId: LEGACY_OPENNEED_AGENT_ID,
        canonicalAgentId: AGENT_PASSPORT_MAIN_AGENT_ID,
      }),
      { includeArchiveAudit }
    );
    if (!preview.readyToApply) {
      return sanitizeMainAgentCanonicalMigrationResult(
        {
          ...preview,
          applied: false,
          appliedAt: null,
          recoveryBundle: null,
        },
        { includeStore }
      );
    }

    const recoveryBundle = await exportStoreRecoveryBundle({
      passphrase,
      note: normalizeOptionalText(note) ?? "main agent canonical physical migration backup",
    });
    let archiveArtifacts = null;
    let archiveJsonlRewrite = null;
    try {
      archiveArtifacts = await migrateMainAgentArchiveDirectory({
        legacyAgentId: LEGACY_OPENNEED_AGENT_ID,
        canonicalAgentId: AGENT_PASSPORT_MAIN_AGENT_ID,
      });
      if (rewriteArchiveJsonl) {
        archiveJsonlRewrite = await rewriteMainAgentArchiveJsonlStructuredReferences({
          archiveDir: archiveArtifacts?.canonicalArchiveDir,
          fromAgentId: LEGACY_OPENNEED_AGENT_ID,
          toAgentId: AGENT_PASSPORT_MAIN_AGENT_ID,
        });
      }
      await writeStore(preview.store, { archiveColdData: false });
    } catch (error) {
      if (archiveArtifacts?.migrated) {
        try {
          if (rewriteArchiveJsonl && archiveJsonlRewrite?.rewritten === true) {
            await rewriteMainAgentArchiveJsonlStructuredReferences({
              archiveDir: archiveArtifacts?.canonicalArchiveDir,
              fromAgentId: AGENT_PASSPORT_MAIN_AGENT_ID,
              toAgentId: LEGACY_OPENNEED_AGENT_ID,
            });
          }
        } catch {}
        try {
          await rollbackMainAgentArchiveDirectory({
            legacyAgentId: LEGACY_OPENNEED_AGENT_ID,
            canonicalAgentId: AGENT_PASSPORT_MAIN_AGENT_ID,
          });
        } catch {}
      }
      throw error;
    }
    return sanitizeMainAgentCanonicalMigrationResult(
      {
        ...preview,
        applied: true,
        appliedAt: now(),
        recoveryBundle,
        archiveArtifacts,
        archiveJsonlRewrite,
      },
      { includeStore }
    );
  });
}

export async function loadStoreIfPresentStatus({ migrate = true, createKey = true } = {}) {
  try {
    const store = await loadStoreIfPresent({ migrate, createKey });
    return {
      store,
      present: Boolean(store),
      available: Boolean(store),
      missingLedger: !store,
      missingKey: false,
      code: store ? "available" : "not_initialized",
    };
  } catch (error) {
    if (error.code === "STORE_KEY_NOT_FOUND") {
      return {
        store: null,
        present: true,
        available: false,
        missingLedger: false,
        missingKey: true,
        code: "store_key_unavailable",
        error,
      };
    }
    throw error;
  }
}

async function loadStoreForDeviceSetupPackageExport(payload = {}) {
  if (!normalizeBooleanFlag(payload.dryRun, false)) {
    return loadStore();
  }
  return (await loadStoreIfPresent({ migrate: true, createKey: false })) || createInitialStore();
}

async function resolveOptionalPassiveStore(explicitStore = null) {
  if (explicitStore) {
    return {
      store: explicitStore,
      present: true,
      available: true,
      missingLedger: false,
      missingKey: false,
      code: "available",
    };
  }
  return loadStoreIfPresentStatus({ migrate: false, createKey: false });
}

async function resolveDeviceSetupPackageInput(payload = {}) {
  return resolveDeviceSetupPackageInputImpl(payload, {
    deviceSetupPackageFormat: DEVICE_SETUP_PACKAGE_FORMAT,
  });
}

async function resolveRecoveryBundleInput(payload = {}) {
  return resolveRecoveryBundleInputImpl(payload, {
    storeRecoveryFormat: STORE_RECOVERY_FORMAT,
  });
}

function unwrapStoreRecoveryKey(bundle, passphrase) {
  return unwrapStoreRecoveryKeyImpl(bundle, passphrase, {
    deriveRecoveryWrapKey,
    decryptBufferWithKey,
  });
}

function buildRecoveryRehearsalView(record = null) {
  return buildRecoveryRehearsalViewImpl(record);
}

async function readEncryptedStoreEnvelope({ passive = false } = {}) {
  return readEncryptedStoreEnvelopeImpl({
    loadStore: passive ? () => runWithPassiveStoreAccess(loadStore) : loadStore,
    readStorePath: STORE_PATH,
    isEncryptedStoreEnvelope,
    writeStore,
    persistEncryptedEnvelope: !passive,
  });
}

async function readPassiveStoreEnvelopeState() {
  try {
    const envelope = JSON.parse(await readFile(STORE_PATH, "utf-8"));
    return {
      present: true,
      missingLedger: false,
      encrypted: isEncryptedStoreEnvelope(envelope),
      envelope,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        present: false,
        missingLedger: true,
        encrypted: false,
        envelope: null,
      };
    }
    throw error;
  }
}

export async function listStoreRecoveryBundles({ limit = 10 } = {}) {
  return listStoreRecoveryBundlesImpl({
    limit,
    storeRecoveryDir: STORE_RECOVERY_DIR,
    storeRecoveryFormat: STORE_RECOVERY_FORMAT,
  });
}

export async function listDeviceSetupPackages({ limit = 10, store = null } = {}) {
  const listed = await listDeviceSetupPackagesImpl({
    limit,
    deviceSetupPackageDir: DEVICE_SETUP_PACKAGE_DIR,
    deviceSetupPackageFormat: DEVICE_SETUP_PACKAGE_FORMAT,
  });
  const storeStatus = await resolveOptionalPassiveStore(store);
  return annotateDeviceSetupPackageListing(storeStatus.store, listed);
}

async function readDeviceSetupPackageFile(packagePath) {
  return readDeviceSetupPackageFileImpl(packagePath, {
    deviceSetupPackageFormat: DEVICE_SETUP_PACKAGE_FORMAT,
  });
}

function resolveDeviceSetupPackagePath(packageId) {
  return resolveDeviceSetupPackagePathImpl(packageId, {
    deviceSetupPackageDir: DEVICE_SETUP_PACKAGE_DIR,
  });
}

export async function getDeviceSetupPackage(packageId, { includePackage = true, store = null } = {}) {
  const loaded = await getDeviceSetupPackageImpl(packageId, {
    includePackage,
    deviceSetupPackageDir: DEVICE_SETUP_PACKAGE_DIR,
    deviceSetupPackageFormat: DEVICE_SETUP_PACKAGE_FORMAT,
  });
  const storeStatus = await resolveOptionalPassiveStore(store);
  return {
    ...loaded,
    summary: annotateSetupPackageResidentBinding(storeStatus.store, loaded.summary),
  };
}

export async function deleteDeviceSetupPackage(packageId, payload = {}) {
  return queueStoreMutation(async () => {
    const deleted = await deleteDeviceSetupPackageImpl(packageId, payload, {
      loadStore,
      appendEvent,
      writeStore,
      deviceSetupPackageDir: DEVICE_SETUP_PACKAGE_DIR,
      deviceSetupPackageFormat: DEVICE_SETUP_PACKAGE_FORMAT,
    });
    const storeStatus = await resolveOptionalPassiveStore();
    return {
      ...deleted,
      summary: annotateSetupPackageResidentBinding(storeStatus.store, deleted.summary),
    };
  });
}

export async function exportStoreRecoveryBundle(payload = {}, options = {}) {
  const storeOverride = options?.store ?? null;
  const envelopeOverride = options?.envelope ?? null;
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  if ((storeOverride || envelopeOverride) && !dryRun) {
    throw new Error("exportStoreRecoveryBundle store override requires dryRun");
  }
  const passiveEnvelopeState = dryRun && !(storeOverride && envelopeOverride)
    ? await readPassiveStoreEnvelopeState()
    : null;
  if (dryRun && !((storeOverride && envelopeOverride) || passiveEnvelopeState?.encrypted === true)) {
    return {
      exportedAt: now(),
      dryRun: true,
      skipped: true,
      reason: "encrypted_ledger_envelope_missing",
      recoveryDir: STORE_RECOVERY_DIR,
      bundle: null,
      summary: null,
    };
  }
  const passiveEncryption = dryRun ? await loadStoreEncryptionKeyIfPresent() : null;
  if (dryRun && !passiveEncryption?.key) {
    return {
      exportedAt: now(),
      dryRun: true,
      skipped: true,
      reason: "store_key_unavailable",
      recoveryDir: STORE_RECOVERY_DIR,
      bundle: null,
      summary: null,
    };
  }
  const passiveEnvelope = dryRun && !(storeOverride && envelopeOverride)
    ? await readEncryptedStoreEnvelope({ passive: true })
    : null;
  return exportStoreRecoveryBundleImpl(payload, {
    loadOrCreateStoreEncryptionKey: dryRun ? async () => passiveEncryption : loadOrCreateStoreEncryptionKey,
    readEncryptedStoreEnvelopeImpl:
      storeOverride && envelopeOverride
        ? async () => ({
            store: storeOverride,
            envelope: envelopeOverride,
          })
        : dryRun
          ? async () => passiveEnvelope
        : readEncryptedStoreEnvelope,
    deriveRecoveryWrapKey,
    encryptBufferWithKey,
    createMachineIdImpl: createMachineId,
    storeRecoveryDir: STORE_RECOVERY_DIR,
    storeRecoveryFormat: STORE_RECOVERY_FORMAT,
    storePathBasename: path.basename(STORE_PATH),
  });
}

export async function importStoreRecoveryBundle(payload = {}) {
  return queueStoreMutation(async () =>
    importStoreRecoveryBundleImpl(payload, {
      resolveRecoveryBundleInputImpl: resolveRecoveryBundleInput,
      unwrapStoreRecoveryKeyImpl: unwrapStoreRecoveryKey,
      getSystemKeychainStatusImpl: getSystemKeychainStatus,
      shouldPreferSystemKeychainImpl: shouldPreferSystemKeychain,
      readGenericPasswordFromKeychainImpl: readGenericPasswordFromKeychain,
      writeGenericPasswordToKeychainImpl: writeGenericPasswordToKeychain,
      storeKeyKeychainService: STORE_KEY_KEYCHAIN_SERVICE,
      storeKeyKeychainAccount: STORE_KEY_KEYCHAIN_ACCOUNT,
      storeKeyPath: STORE_KEY_PATH,
      storeKeyRecordFormat: STORE_KEY_RECORD_FORMAT,
      storePath: STORE_PATH,
      loadStore,
      resetStoreEncryptionKey: () => {
        storeEncryptionKeyPromise = null;
      },
    })
  );
}

export async function listRecoveryRehearsals({ limit = 10, store = null } = {}) {
  if (store) {
    return listRecoveryRehearsalsImpl({ limit, loadStore: async () => store });
  }
  return listRecoveryRehearsalsImpl({ limit, loadStore });
}

export async function rehearseStoreRecoveryBundle(payload = {}, options = {}) {
  const storeOverride = options?.store ?? null;
  const envelopeStateOverride = options?.envelopeState ?? null;
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  if ((storeOverride || envelopeStateOverride) && !dryRun) {
    throw new Error("rehearseStoreRecoveryBundle store override requires dryRun");
  }
  const execute = async () =>
    rehearseStoreRecoveryBundleImpl(payload, {
      resolveRecoveryBundleInputImpl: resolveRecoveryBundleInput,
      unwrapStoreRecoveryKeyImpl: unwrapStoreRecoveryKey,
      loadStore,
      storePath: STORE_PATH,
      readCurrentStoreState:
        storeOverride
          ? async () => ({
              ok: true,
              store: storeOverride,
              error: null,
            })
          : dryRun
            ? async () => {
                const status = await loadStoreIfPresentStatus({ migrate: true, createKey: false });
                return {
                  ok: Boolean(status.store),
                  store: status.store ?? null,
                  error: status.store
                    ? null
                    : status.missingKey
                      ? "store_key_unavailable"
                      : "ledger_not_initialized",
                };
              }
          : null,
      readCurrentEnvelopeState:
        envelopeStateOverride
          ? async () => envelopeStateOverride
          : null,
      decryptBufferWithKey,
      isEncryptedStoreEnvelope,
      appendTranscriptEntries,
      truncatePromptSection,
      appendEvent,
      writeStore,
    });
  if (storeOverride || envelopeStateOverride) {
    return execute();
  }
  return queueStoreMutation(execute);
}

export async function listAgents() {
  const store = await loadStore();
  return Object.values(store.agents).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getAgent(agentId) {
  const store = await loadStore();
  return ensureAgent(store, agentId);
}

export async function getLedger() {
  return loadStore();
}

export async function getProtocol(options = {}) {
  const store = options?.store || (await loadStore());
  const readSessionCounts =
    options?.readSessionCounts && typeof options.readSessionCounts === "object"
      ? options.readSessionCounts
      : isPassiveStoreAccess()
        ? await peekReadSessionCounts({ includeExpired: true, includeRevoked: true })
        : countReadSessionsInStore(await loadReadSessionStore(), {
            includeExpired: true,
            includeRevoked: true,
          });
  const comparisonAuditCount = (store.credentials || []).filter((record) => normalizeCredentialKind(record?.kind) === "agent_comparison").length;

  return buildProtocolDescriptor({
    chainId: store.chainId,
    apiBase: "/api",
    counts: {
      agents: Object.keys(store.agents || {}).length,
      windows: Object.keys(store.windows || {}).length,
      memories: Array.isArray(store.memories) ? store.memories.length : 0,
      messages: Array.isArray(store.messages) ? store.messages.length : 0,
      passportMemories: Array.isArray(store.passportMemories) ? store.passportMemories.length : 0,
      conversationMinutes: Array.isArray(store.conversationMinutes) ? store.conversationMinutes.length : 0,
      taskSnapshots: Array.isArray(store.taskSnapshots) ? store.taskSnapshots.length : 0,
      decisionLogs: Array.isArray(store.decisionLogs) ? store.decisionLogs.length : 0,
      evidenceRefs: Array.isArray(store.evidenceRefs) ? store.evidenceRefs.length : 0,
      readSessions: readSessionCounts.count,
      modelProfiles: Array.isArray(store.modelProfiles) ? store.modelProfiles.length : 0,
      runtimeMemoryStates: Array.isArray(store.runtimeMemoryStates) ? store.runtimeMemoryStates.length : 0,
      agentRuns: Array.isArray(store.agentRuns) ? store.agentRuns.length : 0,
      agentQueryStates: Array.isArray(store.agentQueryStates) ? store.agentQueryStates.length : 0,
      agentSessionStates: Array.isArray(store.agentSessionStates) ? store.agentSessionStates.length : 0,
      compactBoundaries: Array.isArray(store.compactBoundaries) ? store.compactBoundaries.length : 0,
      verificationRuns: Array.isArray(store.verificationRuns) ? store.verificationRuns.length : 0,
      authorizations: Array.isArray(store.proposals) ? store.proposals.length : 0,
      credentials: Array.isArray(store.credentials) ? store.credentials.length : 0,
      residentAgentBound: Boolean(store.deviceRuntime?.residentAgentId),
      comparisonAudits: comparisonAuditCount,
      events: Array.isArray(store.events) ? store.events.length : 0,
    },
    deviceRuntime: buildDeviceRuntimeView(store.deviceRuntime, store),
  });
}

export async function getRoadmap(options = {}) {
  const protocol = await getProtocol(options);
  return {
    protocol: {
      name: protocol.protocol?.name,
      version: protocol.protocol?.version,
      chainId: protocol.protocol?.chainId,
    },
    productPositioning: protocol.productPositioning,
    mvp: protocol.mvp,
    capabilityBoundary: protocol.capabilityBoundary,
    securityArchitecture: protocol.securityArchitecture,
    documentation: protocol.documentation,
    roadmap: protocol.roadmap,
  };
}

export async function getCapabilities(options = {}) {
  const protocol = await getProtocol(options);
  return {
    product: {
      name: protocol.protocol?.name ?? null,
      version: protocol.protocol?.version ?? null,
      phase: protocol.roadmap?.phase ?? null,
      headline: protocol.roadmap?.headline ?? null,
    },
    positioning: {
      tagline: protocol.productPositioning?.tagline ?? null,
      oneLiner: protocol.productPositioning?.oneLiner ?? null,
      positioning: protocol.productPositioning?.positioning ?? null,
    },
    capabilityBoundary: protocol.capabilityBoundary ?? null,
    retrieval: {
      strategy: protocol.securityArchitecture?.trustModel?.retrieval ?? null,
      hotPath: protocol.productPositioning?.operatingModel?.hotPath ?? null,
      coldPath: protocol.productPositioning?.operatingModel?.coldPath ?? null,
    },
  };
}

export async function createReadSession(payload = {}) {
  return queueReadSessionMutation(async () => {
    const agentStore = await loadStore();
    const normalizedPayload = normalizeReadSessionPayloadForStore(agentStore, payload);
    const store = await loadReadSessionStore();
    const result = createReadSessionInStore(store, normalizedPayload, { appendEvent });
    await writeReadSessionStore(store);
    return result;
  });
}

export async function listReadSessions({ includeExpired = true, includeRevoked = true } = {}) {
  const store = await loadReadSessionStore();
  return listReadSessionsInStore(store, { includeExpired, includeRevoked });
}

export async function peekReadSessions({ includeExpired = true, includeRevoked = true } = {}) {
  const store = await loadReadSessionStore({
    migrateLegacy: false,
    createIfMissing: false,
  });
  return listReadSessionsInStore(store, { includeExpired, includeRevoked });
}

export async function countReadSessions({ includeExpired = true, includeRevoked = true } = {}) {
  const store = await loadReadSessionStore();
  return countReadSessionsInStore(store, { includeExpired, includeRevoked });
}

export async function revokeReadSession(readSessionId, payload = {}) {
  return queueReadSessionMutation(async () => {
    const store = await loadReadSessionStore();
    const result = revokeReadSessionInStore(store, readSessionId, payload, { appendEvent });
    await writeReadSessionStore(store);
    return result;
  });
}

export async function revokeAllReadSessions(payload = {}) {
  return queueReadSessionMutation(async () => {
    const store = await loadReadSessionStore();
    const result = revokeAllReadSessionsInStore(store, payload, { appendEvent });
    if (!normalizeBooleanFlag(payload.dryRun, false)) {
      await writeReadSessionStore(store);
    }
    return result;
  });
}

export async function recordSecurityAnomaly(payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const anomaly = recordSecurityAnomalyInStore(store, payload, { appendEvent });
    await writeStore(store, { archiveColdData: false });
    return anomaly;
  });
}

export async function listSecurityAnomalies({
  limit = DEFAULT_SECURITY_ANOMALY_LIMIT,
  category = null,
  severity = null,
  includeAcknowledged = true,
  createdAfter = null,
  createdBefore = null,
  store = null,
} = {}) {
  const sourceStore = store || (await loadStore());
  return listSecurityAnomaliesInStore(sourceStore, {
    limit,
    category,
    severity,
    includeAcknowledged,
    createdAfter,
    createdBefore,
  });
}

export async function validateReadSessionToken(token, { scope = null, touch = true } = {}) {
  const validatedAt = now();
  const touchValidation = () =>
    queueReadSessionMutation(async () => {
      const store = await loadReadSessionStore({ migrateLegacy: true });
      const validation = validateReadSessionTokenInStore(store, token, {
        scope,
        touchValidatedAt: true,
        validatedAt,
      });
      if (validation.valid && validation.touched) {
        await writeReadSessionStore(store);
      }
      return validation;
    });
  const previewStore = await loadReadSessionStore({
    migrateLegacy: false,
    createIfMissing: false,
  });
  const previewValidation = validateReadSessionTokenInStore(previewStore, token, {
    scope,
    touchValidatedAt: false,
    validatedAt,
  });
  if (previewValidation.valid) {
    if (!touch || !previewValidation.shouldTouchValidation) {
      return previewValidation;
    }
    return touchValidation();
  }
  if (previewValidation.reason !== "session_not_found") {
    return previewValidation;
  }
  const legacyStore = await loadReadSessionStore({
    migrateLegacy: true,
    createIfMissing: false,
  });
  const legacyValidation = validateReadSessionTokenInStore(legacyStore, token, {
    scope,
    touchValidatedAt: false,
    validatedAt,
  });
  if (!legacyValidation.valid) {
    return legacyValidation;
  }
  if (!touch || !legacyValidation.shouldTouchValidation) {
    return legacyValidation;
  }
  return touchValidation();
}

export async function peekReadSessionCounts({
  includeExpired = true,
  includeRevoked = true,
} = {}) {
  const store = await loadReadSessionStore({
    migrateLegacy: false,
    createIfMissing: false,
  });
  return countReadSessionsInStore(store, {
    includeExpired,
    includeRevoked,
  });
}

export async function getDeviceRuntimeState(options = {}) {
  const store = options?.store || (await loadStore());
  const memoryStabilityRuntime = await loadMemoryStabilityRuntimeGateRaw(process.env);
  const readSessionCounts =
    options?.readSessionCounts && typeof options.readSessionCounts === "object"
      ? options.readSessionCounts
      : isPassiveStoreAccess()
        ? await peekReadSessionCounts({ includeExpired: true, includeRevoked: true })
        : countReadSessionsInStore(await loadReadSessionStore(), {
            includeExpired: true,
            includeRevoked: true,
          });
  const securityPosture = buildDeviceSecurityPostureState(store.deviceRuntime);
  const modelProfiles = listModelProfilesFromStore(store);
  const activeModelName = resolveActiveMemoryHomeostasisModelName(store, {
    localReasoner: store.deviceRuntime?.localReasoner,
  });
  const contractProfile = resolveMemoryStabilityRuntimeContractModelProfile(memoryStabilityRuntime, activeModelName);
  const resolvedRuntimeProfile = resolveRuntimeMemoryHomeostasisProfile(store, {
    modelName: activeModelName,
    runtimePolicy: store.deviceRuntime?.policy,
    contractProfile,
  });
  const runtimeObservationSummary = buildRuntimeMemoryObservationCollectionSummary(
    listRuntimeMemoryObservationsFromStore(store, {
      modelName: activeModelName,
      limit: 16,
    }),
    {
      recentLimit: 8,
    }
  );
  return {
    counts: {
      readSessions: readSessionCounts.count,
      recoveryRehearsals: Array.isArray(store.recoveryRehearsals) ? store.recoveryRehearsals.length : 0,
      transcriptEntries: Array.isArray(store.transcriptEntries) ? store.transcriptEntries.length : 0,
      securityAnomalies: Array.isArray(store.securityAnomalies) ? store.securityAnomalies.length : 0,
      modelProfiles: modelProfiles.length,
      runtimeMemoryStates: Array.isArray(store.runtimeMemoryStates) ? store.runtimeMemoryStates.length : 0,
      runtimeMemoryObservations: Array.isArray(store.runtimeMemoryObservations) ? store.runtimeMemoryObservations.length : 0,
    },
    securityPosture,
    deviceRuntime: buildDeviceRuntimeView(store.deviceRuntime, store),
    memoryHomeostasis: {
      activeModelName,
      latestModelProfile: modelProfiles.length ? buildModelProfileView(modelProfiles.at(-1)) : null,
      resolvedRuntimeProfile: buildModelProfileView(resolvedRuntimeProfile),
      modelProfileCount: modelProfiles.length,
      observationSummary: runtimeObservationSummary,
    },
  };
}

export async function previewRuntimeMemoryHomeostasisCalibration(payload = {}) {
  const store = await loadStore();
  const memoryStabilityRuntime = await loadMemoryStabilityRuntimeGateRaw(process.env);
  const activeModelName = resolveActiveMemoryHomeostasisModelName(store, {
    localReasoner: store.deviceRuntime?.localReasoner,
  });
  const modelName = normalizeOptionalText(payload.modelName) ?? activeModelName;
  const includeStoredObservations = normalizeBooleanFlag(payload.includeStoredObservations, false);
  const previewObservations = (Array.isArray(payload.observations) ? payload.observations : []).map((observation) =>
    normalizeRuntimeMemoryObservationRecord(observation)
  );
  const previewStore = {
    ...cloneJson(store),
    runtimeMemoryObservations: includeStoredObservations
      ? [
          ...(Array.isArray(store.runtimeMemoryObservations) ? store.runtimeMemoryObservations : []).map((observation) =>
            normalizeRuntimeMemoryObservationRecord(observation)
          ),
          ...previewObservations,
        ]
      : previewObservations,
  };
  const resolvedProfile = resolveRuntimeMemoryHomeostasisProfile(previewStore, {
    modelName,
    runtimePolicy:
      payload.runtimePolicy && typeof payload.runtimePolicy === "object"
        ? cloneJson(payload.runtimePolicy)
        : store.deviceRuntime?.policy,
    contractProfile: resolveMemoryStabilityRuntimeContractModelProfile(memoryStabilityRuntime, modelName),
  });
  const previewObservationSummary = buildRuntimeMemoryObservationCollectionSummary(
    listRuntimeMemoryObservationsFromStore(previewStore, {
      modelName,
      limit: Math.max(8, previewObservations.length || 0),
    }),
    {
      recentLimit: Math.max(4, Math.min(8, previewObservations.length || 8)),
    }
  );
  return {
    modelName,
    profile: buildModelProfileView(resolvedProfile),
    counts: {
      previewObservations: previewObservations.length,
      totalObservations: Array.isArray(previewStore.runtimeMemoryObservations)
        ? previewStore.runtimeMemoryObservations.length
        : 0,
    },
    observationSummary: previewObservationSummary,
  };
}

function buildMemoryHomeostasisBenchmarkFact(modelName, scenario = {}) {
  const contextLength = Math.max(32, Math.floor(toFiniteNumber(scenario.contextLength, 512)));
  const position = normalizeOptionalText(scenario.position) ?? "middle";
  const factIndex = Math.max(0, Math.floor(toFiniteNumber(scenario.factIndex, 0)));
  const answer = `ON-${contextLength}-${position.toUpperCase()}-${factIndex + 1}`;
  return {
    label: `记忆槽 ${factIndex + 1}`,
    answer,
    question: `只返回 ${modelName} 在 ${position} 位置的 ${factIndex + 1} 号校验码，不要解释。`,
    statement: `关键事实：${modelName} 在 ${position} 位置的 ${factIndex + 1} 号校验码是 ${answer}。`,
  };
}

function buildMemoryHomeostasisBenchmarkFiller(label, approximateTokens = 0) {
  const normalizedLabel = normalizeOptionalText(label) ?? "背景";
  const targetTokens = Math.max(0, Math.floor(toFiniteNumber(approximateTokens, 0)));
  if (targetTokens <= 0) {
    return "";
  }
  const chunk = `${normalizedLabel} 背景填充数据用于测试长上下文稳定性，不包含关键答案。`;
  const repetitions = Math.max(1, Math.ceil(targetTokens / Math.max(1, estimatePromptTokens(chunk))));
  return Array.from({ length: repetitions }, (_, index) => `${chunk}片段${index + 1}。`).join(" ");
}

function buildMemoryHomeostasisBenchmarkContext(modelName, scenario = {}) {
  const fact = buildMemoryHomeostasisBenchmarkFact(modelName, scenario);
  const targetTokens = Math.max(96, Math.floor(toFiniteNumber(scenario.contextLength, 512)));
  const factTokens = Math.max(12, estimatePromptTokens(fact.statement));
  const fillerBudget = Math.max(0, targetTokens - factTokens - 24);
  const splits =
    normalizeOptionalText(scenario.position) === "front"
      ? [0.12, 0.88]
      : normalizeOptionalText(scenario.position) === "tail"
        ? [0.88, 0.12]
        : [0.45, 0.55];
  const leadingTokens = Math.floor(fillerBudget * splits[0]);
  const trailingTokens = Math.max(0, fillerBudget - leadingTokens);
  return {
    ...fact,
    context: [
      "以下是上下文记忆稳态测试材料。",
      buildMemoryHomeostasisBenchmarkFiller("前置", leadingTokens),
      fact.statement,
      buildMemoryHomeostasisBenchmarkFiller("后置", trailingTokens),
      "测试要求：请根据上下文精确回忆关键事实。",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function simulateMemoryHomeostasisBenchmarkScenario(modelName, scenario = {}) {
  const benchmark = buildMemoryHomeostasisBenchmarkContext(modelName, scenario);
  const baselineLength = MEMORY_HOMEOSTASIS_DEFAULT_BENCHMARK.baselineLength;
  const lengthPenalty = Math.max(
    0,
    Math.min(
      0.28,
      (scenario.contextLength - baselineLength) / Math.max(1, baselineLength * 10)
    )
  );
  const positionPenalty =
    scenario.position === "middle" ? 0.18 : scenario.position === "front" || scenario.position === "tail" ? 0.04 : 0.12;
  const accuracy = Math.max(0, Math.min(1, 1 - lengthPenalty - positionPenalty));
  return {
    ...scenario,
    question: benchmark.question,
    expectedAnswer: benchmark.answer,
    answer: accuracy >= 0.75 ? benchmark.answer : `${benchmark.answer}-drift`,
    accuracy: accuracy >= 0.75 ? 1 : 0,
    measuredAt: now(),
    simulation: true,
  };
}

async function executeMemoryHomeostasisBenchmarkScenario(
  modelName,
  scenario,
  {
    reasonerProvider = null,
    localReasoner = null,
  } = {}
) {
  const provider =
    normalizeRuntimeReasonerProvider(reasonerProvider) ??
    normalizeRuntimeReasonerProvider(localReasoner?.provider) ??
    DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER;
  if (provider === "mock" || provider === "local_mock") {
    return simulateMemoryHomeostasisBenchmarkScenario(modelName, scenario);
  }
  const benchmark = buildMemoryHomeostasisBenchmarkContext(modelName, scenario);
  const contextBuilder = {
    compiledPrompt: benchmark.context,
    contextHash: hashJson({
      modelName,
      scenarioId: scenario.scenarioId,
      contextLength: scenario.contextLength,
      position: scenario.position,
      expectedAnswer: benchmark.answer,
    }),
    slots: {
      currentGoal: "执行长上下文记忆稳态画像测试",
      queryBudget: {
        estimatedContextTokens: Math.max(
          scenario.contextLength,
          estimatePromptTokens(benchmark.context)
        ),
      },
      memoryHomeostasis: {
        benchmark: true,
      },
    },
  };
  const result = await generateAgentRunnerCandidateResponse({
    contextBuilder,
    payload: {
      currentGoal: "执行长上下文记忆稳态画像测试",
      userTurn: benchmark.question,
      reasonerProvider: provider,
      localReasoner: cloneJson(localReasoner) ?? null,
      localReasonerModel: modelName,
    },
  });
  const answer = normalizeOptionalText(result?.responseText) ?? null;
  return {
    ...scenario,
    question: benchmark.question,
    expectedAnswer: benchmark.answer,
    answer,
    accuracy: compareMemoryHomeostasisRecall(benchmark.answer, answer) ? 1 : 0,
    measuredAt: now(),
    provider: normalizeOptionalText(result?.provider) ?? provider,
    model: normalizeOptionalText(result?.metadata?.model || result?.model) ?? modelName,
  };
}

export async function listModelMemoryHomeostasisProfiles({ modelName = null, limit = 10 } = {}) {
  const store = await loadStore();
  const records = listModelProfilesFromStore(store, { modelName }).filter((profile) =>
    isOperationalMemoryHomeostasisProfile(profile)
  );
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 10;
  const profiles = records.slice(-cappedLimit).map((profile) => buildModelProfileView(profile));
  return {
    profiles,
    counts: {
      total: records.length,
      filtered: profiles.length,
    },
  };
}

export async function profileModelMemoryHomeostasis(payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const deviceRuntime = buildDeviceRuntimeView(store.deviceRuntime, store);
    const effectiveProvider =
      normalizeRuntimeReasonerProvider(payload.reasonerProvider) ??
      normalizeRuntimeReasonerProvider(deviceRuntime?.localReasoner?.provider) ??
      DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER;
    const effectiveLocalReasoner = mergeRunnerLocalReasonerOverride(
      resolveRunnerLocalReasonerConfig(store, deviceRuntime, effectiveProvider),
      payload,
      effectiveProvider
    );
    const modelName = resolveActiveMemoryHomeostasisModelName(store, {
      localReasoner: {
        ...deviceRuntime?.localReasoner,
        ...effectiveLocalReasoner,
        model:
          normalizeOptionalText(payload.modelName) ??
          normalizeOptionalText(payload.localReasonerModel) ??
          effectiveLocalReasoner?.model ??
          deviceRuntime?.localReasoner?.model ??
          null,
      },
    });
    const plan = buildMemoryHomeostasisBenchmarkPlan({
      baselineLength: payload.baselineLength,
      lengths: payload.lengths,
      positions: payload.positions,
      factCount: payload.factCount,
    });
    const scenarios = [];
    for (const scenario of plan.scenarios) {
      scenarios.push(
        await executeMemoryHomeostasisBenchmarkScenario(modelName, scenario, {
          reasonerProvider: effectiveProvider,
          localReasoner: effectiveLocalReasoner,
        })
      );
    }
    const profile = computeMemoryHomeostasisModelProfile({
      modelName,
      benchmark: {
        ...plan,
        scenarios,
        retentionFloor: payload.retentionFloor,
      },
      benchmarkMeta: {
        provider: effectiveProvider,
        localReasoner: {
          provider: effectiveLocalReasoner?.provider ?? effectiveProvider,
          model: displayAgentPassportLocalReasonerModel(effectiveLocalReasoner?.model, null),
        },
      },
    });
    if (!Array.isArray(store.modelProfiles)) {
      store.modelProfiles = [];
    }
    store.modelProfiles.push(profile);
    const prunedProfiles = pruneObsoleteModelProfiles(store, profile);
    appendEvent(store, "model_memory_homeostasis_profiled", {
      modelProfileId: profile.modelProfileId,
      modelName: profile.modelName,
      ccrs: profile.ccrs,
      ecl085: profile.ecl085,
      pr: profile.pr,
      midDrop: profile.midDrop,
      provider: effectiveProvider,
      scenarioCount: scenarios.length,
      prunedProfiles,
    });
    await writeStore(store);
    return {
      profile: buildModelProfileView(profile),
      benchmark: {
        scenarioCount: scenarios.length,
        baselineLength: plan.baselineLength,
        lengths: plan.lengths,
        positions: plan.positions,
        prunedProfiles,
      },
    };
  });
}

export async function getAgentRuntimeStability(agentId, { limit = 10 } = {}) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const records = listRuntimeMemoryStatesFromStore(store, agent.agentId, RUNTIME_MEMORY_STORE_ADAPTER);
  const latest = records.at(-1) ?? null;
  const memoryStabilityRuntime = await loadMemoryStabilityRuntimeGateRaw(process.env);
  const resolvedModelName =
    latest?.modelName ??
    resolveActiveMemoryHomeostasisModelName(store, {
      localReasoner: store.deviceRuntime?.localReasoner,
    });
  const modelProfile = resolveRuntimeMemoryHomeostasisProfile(store, {
    modelName: resolvedModelName,
    contractProfile: resolveMemoryStabilityRuntimeContractModelProfile(memoryStabilityRuntime, resolvedModelName),
  });
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 10;
  const observationSummary = buildAgentRuntimeMemoryObservationCollectionSummary(store, agent.agentId, {
    modelName: latest?.modelName ?? modelProfile?.modelName ?? resolvedModelName,
    limit: Math.max(16, cappedLimit),
    recentLimit: Math.max(4, Math.min(8, cappedLimit)),
  });
  return {
    latestState: latest ? buildRuntimeMemoryStateView(latest) : null,
    states: records.slice(-cappedLimit).map((state) => buildRuntimeMemoryStateView(state)),
    modelProfile: buildModelProfileView(modelProfile),
    observationSummary,
    counts: {
      total: records.length,
      filtered: Math.min(records.length, cappedLimit),
    },
  };
}

export async function recomputeAgentRuntimeStability(agentId, payload = {}, { didMethod = null } = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const memoryStabilityRuntime = await loadMemoryStabilityRuntimeGateRaw(process.env);
    const contextStore = await runWithPassiveStoreAccess(() => loadStore());
    const contextAgent = ensureAgent(contextStore, agentId);
    const currentGoal =
      normalizeOptionalText(payload.currentGoal) ??
      latestAgentTaskSnapshot(store, agent.agentId)?.objective ??
      latestAgentTaskSnapshot(store, agent.agentId)?.title ??
      null;
    const recomputeQuery = payload.query ?? currentGoal ?? payload.userTurn ?? null;
    let contextBuilder = await buildAgentContextBundle(
      contextAgent.agentId,
      {
        currentGoal,
        recentConversationTurns: normalizeRunnerConversationTurns(payload),
        toolResults: normalizeRunnerToolResults(payload),
        query: recomputeQuery,
      },
      {
        didMethod,
        store: contextStore,
      }
    );
    const resolvedRuntimeModelProfile =
      contextBuilder?.memoryHomeostasis?.modelProfile && typeof contextBuilder.memoryHomeostasis.modelProfile === "object"
        ? normalizeModelProfileRecord(contextBuilder.memoryHomeostasis.modelProfile)
        : null;
    contextBuilder = buildContextBuilderResult(contextStore, contextAgent, {
      didMethod,
      currentGoal,
      recentConversationTurns: normalizeRunnerConversationTurns(payload),
      toolResults: normalizeRunnerToolResults(payload),
      query: recomputeQuery,
      memoryStabilityRuntime,
      runtimeModelProfileOverride: resolvedRuntimeModelProfile,
    }, buildContextBuilderDeps());
    let runtimeState = contextBuilder?.memoryHomeostasis?.runtimeState
      ? normalizeRuntimeMemoryStateRecord(contextBuilder.memoryHomeostasis.runtimeState)
      : null;
    let correctionPlan =
      contextBuilder?.memoryHomeostasis?.correctionPlan && typeof contextBuilder.memoryHomeostasis.correctionPlan === "object"
        ? cloneJson(contextBuilder.memoryHomeostasis.correctionPlan)
        : null;
    const requestedCorrectionPlan = correctionPlan ? cloneJson(correctionPlan) : null;
    const baselineRuntimeState = runtimeState ? normalizeRuntimeMemoryStateRecord(runtimeState) : null;
    const applyCorrection = normalizeBooleanFlag(payload.applyCorrection, true);
    const correctionRequested =
      Boolean(applyCorrection && requestedCorrectionPlan?.correctionLevel && requestedCorrectionPlan.correctionLevel !== "none");
    let correctionApplied = false;
    if (correctionRequested) {
      correctionApplied = true;
      contextBuilder = buildContextBuilderResult(contextStore, contextAgent, {
        didMethod,
        currentGoal,
        recentConversationTurns: normalizeRunnerConversationTurns(payload),
        toolResults: normalizeRunnerToolResults(payload),
        query: recomputeQuery,
        memoryHomeostasisPolicy: correctionPlan,
        memoryStabilityRuntime,
        runtimeModelProfileOverride: resolvedRuntimeModelProfile,
      }, buildContextBuilderDeps());
      runtimeState = contextBuilder?.memoryHomeostasis?.runtimeState
        ? normalizeRuntimeMemoryStateRecord(contextBuilder.memoryHomeostasis.runtimeState)
        : runtimeState;
      correctionPlan =
        contextBuilder?.memoryHomeostasis?.correctionPlan && typeof contextBuilder.memoryHomeostasis.correctionPlan === "object"
          ? cloneJson(contextBuilder.memoryHomeostasis.correctionPlan)
          : correctionPlan;
    }
    const persistState = normalizeBooleanFlag(payload.persistState, true);
    const sessionState = listAgentSessionStatesFromStore(store, agent.agentId).at(-1) ?? null;
    let persisted = null;
    if (persistState && runtimeState) {
      const plannedCorrectionLevel =
        correctionPlan?.correctionLevel ?? runtimeState?.correctionLevel ?? null;
      const effectiveCorrectionLevel =
        correctionApplied
          ? correctionPlan?.correctionLevel ?? runtimeState?.correctionLevel ?? null
          : plannedCorrectionLevel;
      persisted = upsertRuntimeMemoryState(
        store,
        agent,
        runtimeState,
        {
          sessionId: sessionState?.sessionStateId ?? null,
          sourceWindowId: normalizeOptionalText(payload.sourceWindowId || payload.recordedByWindowId) ?? null,
          observationContext: {
            sourceKind: "recompute",
            baselineState: baselineRuntimeState,
            requestedCorrectionLevel: requestedCorrectionPlan?.correctionLevel ?? null,
            plannedCorrectionLevel,
            appliedCorrectionLevel: correctionApplied ? effectiveCorrectionLevel : null,
            correctionActions: resolveRuntimeMemoryObservationCorrectionActions(
              correctionPlan?.actions,
              effectiveCorrectionLevel
            ),
            correctionRequested,
            correctionApplied,
          },
        },
        RUNTIME_MEMORY_STORE_ADAPTER
      );
      appendEvent(store, "runtime_memory_homeostasis_recomputed", {
        runtimeMemoryStateId: persisted.runtimeMemoryStateId,
        agentId: agent.agentId,
        correctionLevel: persisted.correctionLevel,
        ctxTokens: persisted.ctxTokens,
        sT: persisted.sT,
        cT: persisted.cT,
      });
      await writeStore(store);
    }
    return {
      runtimeState: buildRuntimeMemoryStateView(persisted || runtimeState),
      modelProfile: contextBuilder?.memoryHomeostasis?.modelProfile ?? null,
      correctionPlan,
      correctionApplied,
      contextSummary: {
        estimatedContextTokens: contextBuilder?.slots?.queryBudget?.estimatedContextTokens ?? null,
        promptChars: contextBuilder?.compiledPrompt?.length ?? 0,
      },
    };
  });
}

export async function getCurrentSecurityPostureState(options = {}) {
  const store = options?.store || (await loadStore());
  return buildDeviceSecurityPostureState(store.deviceRuntime);
}

function buildFormalRecoverySetupPackageSummary(store = null, setupPackage = null) {
  const summary = store
    ? annotateSetupPackageResidentBinding(store, setupPackage)
    : readDeviceSetupPackageSummaryContract(setupPackage);
  return summarizeSetupPackageForFormalStatus(summary);
}

function resolveFormalRecoverySetupPackageResidentBinding(store = null, latestSetupPackage = null) {
  const { resolvedResidentBinding } = buildAnnotatedSetupPackageResidentBindings(store, latestSetupPackage);
  return resolvedResidentBinding || readSetupPackageResidentBindingContract(latestSetupPackage);
}

export async function configureSecurityPosture(payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const dryRun = normalizeBooleanFlag(payload.dryRun, false);
    const targetStore = dryRun ? cloneJson(store) : store;
    targetStore.deviceRuntime = normalizeDeviceRuntime(targetStore.deviceRuntime);
    const previousPosture = buildDeviceSecurityPostureState(targetStore.deviceRuntime);
    targetStore.deviceRuntime = normalizeDeviceRuntime({
      ...targetStore.deviceRuntime,
      securityPostureMode: payload.mode ?? payload.securityPostureMode ?? targetStore.deviceRuntime.securityPosture?.mode,
      securityPostureReason:
        payload.reason ?? payload.securityPostureReason ?? targetStore.deviceRuntime.securityPosture?.reason,
      securityPostureNote:
        payload.note ?? payload.securityPostureNote ?? targetStore.deviceRuntime.securityPosture?.note,
      securityPostureUpdatedAt: now(),
      securityPostureUpdatedByAgentId:
        normalizeOptionalText(payload.updatedByAgentId || payload.recordedByAgentId) ?? null,
      securityPostureUpdatedByWindowId:
        normalizeOptionalText(payload.updatedByWindowId || payload.recordedByWindowId) ?? null,
      securityPostureSourceWindowId:
        normalizeOptionalText(payload.sourceWindowId || payload.updatedByWindowId || payload.recordedByWindowId) ?? null,
      updatedAt: now(),
      updatedByAgentId: normalizeOptionalText(payload.updatedByAgentId || payload.recordedByAgentId) ?? null,
      updatedByWindowId: normalizeOptionalText(payload.updatedByWindowId || payload.recordedByWindowId) ?? null,
      sourceWindowId:
        normalizeOptionalText(payload.sourceWindowId || payload.updatedByWindowId || payload.recordedByWindowId) ?? null,
    });
    const securityPosture = buildDeviceSecurityPostureState(targetStore.deviceRuntime);
    appendEvent(targetStore, "device_security_posture_configured", {
      dryRun,
      previousMode: previousPosture.mode,
      mode: securityPosture.mode,
      reason: securityPosture.reason,
      note: securityPosture.note,
      updatedByAgentId: securityPosture.updatedByAgentId,
      updatedByWindowId: securityPosture.updatedByWindowId,
      sourceWindowId: securityPosture.sourceWindowId,
    });
    if (!dryRun) {
      recordSecurityAnomalyInStore(targetStore, {
        category: "security",
        severity: securityPosture.mode === "panic" ? "critical" : "high",
        code: "security_posture_changed",
        message: `Security posture changed to ${securityPosture.mode}`,
        details: {
          previousMode: previousPosture.mode,
          mode: securityPosture.mode,
        },
        actorAgentId: securityPosture.updatedByAgentId,
        actorWindowId: securityPosture.updatedByWindowId,
        reason: securityPosture.reason,
      }, { appendEvent });
      await writeStore(targetStore);
    }
    return {
      configuredAt: now(),
      dryRun,
      securityPosture,
      deviceRuntime: buildDeviceRuntimeView(targetStore.deviceRuntime, targetStore),
    };
  });
}

export async function getDeviceSetupStatus(options = {}) {
  const passive = normalizeBooleanFlag(options.passive, false);
  const storeStatus = passive
    ? await resolveOptionalPassiveStore(options?.store || null)
    : {
        store: options?.store || await loadStore(),
        missingKey: false,
        code: "available",
      };
  const store = storeStatus.store;
  if (!store) {
    const missingKey = storeStatus.missingKey === true;
    return {
      setupComplete: false,
      missingRequiredCodes: [missingKey ? "store_key_unavailable" : "ledger_not_initialized"],
      residentAgentId: null,
      residentAgentReference: null,
      resolvedResidentAgentId: null,
      residentDidMethod: null,
      deviceRuntime: null,
      setupPolicy: {},
      bootstrapGate: null,
      checks: [
        {
          code: missingKey ? "store_key_unavailable" : "ledger_not_initialized",
          status: "blocked",
          summary: missingKey
            ? "本地账本存在，但存储密钥不可用；被动读取不会创建替代密钥，请先走恢复或密钥导入。"
            : "本地账本尚未初始化；被动读取不会创建账本、密钥或恢复包。",
        },
      ],
      localReasonerDiagnostics: null,
      formalRecoveryFlow: null,
      automaticRecoveryReadiness: null,
      recoveryBundles: { bundles: [], counts: { total: 0 } },
      recoveryRehearsals: { rehearsals: [], counts: { total: 0 } },
      latestRecoveryRehearsal: null,
      latestRecoveryRehearsalAgeHours: null,
      latestRecoveryRehearsalBlocksFreshness: false,
      latestPassedRecoveryRehearsal: null,
      latestPassedRecoveryRehearsalAgeHours: null,
      setupPackages: { packages: [], counts: { total: 0 } },
      initialized: false,
      storePresent: storeStatus.present === true,
      missingLedger: storeStatus.missingLedger === true,
      missingStoreKey: missingKey,
      recoveryRequired: missingKey,
    };
  }
  const deviceRuntime = normalizeDeviceRuntime(store.deviceRuntime);
  const deviceRuntimeView = buildDeviceRuntimeView(deviceRuntime, store);
  const setupPolicy = cloneJson(deviceRuntime.setupPolicy) ?? {};
  const { residentAgentReference, residentAgentId, residentAgent } = resolveResidentAgentBinding(store, deviceRuntime);
  const requestedDidMethod = deviceRuntime.residentDidMethod || "agentpassport";
  const latestTaskSnapshot = residentAgent ? latestAgentTaskSnapshot(store, residentAgent.agentId) ?? null : null;
  const contextBuilder = residentAgent
    ? buildContextBuilderResult(store, residentAgent, {
        didMethod: requestedDidMethod,
        currentGoal: latestTaskSnapshot?.objective ?? latestTaskSnapshot?.title ?? null,
      }, buildContextBuilderDeps())
    : null;
  const bootstrapGate = residentAgent ? buildRuntimeBootstrapGate(store, residentAgent, { contextBuilder }) : null;
  const signingStatus = passive ? peekSigningMasterSecretStatus() : getSigningMasterSecretStatus();
  const localReasoner = normalizeRuntimeLocalReasonerConfig(deviceRuntime.localReasoner);
  const inspectableLocalReasoner = resolveInspectableRuntimeLocalReasonerConfig(localReasoner);
  const localReasonerRequired = deviceRuntime.localMode === "local_only";
  const localReasonerConfigured = isRuntimeLocalReasonerConfigured(localReasoner);
  const localReasonerDiagnosticsPromise = passive
    ? Promise.resolve(buildPassiveLocalReasonerDiagnostics(localReasoner))
    : localReasonerConfigured || localReasoner.enabled
    ? inspectRuntimeLocalReasoner(inspectableLocalReasoner)
    : Promise.resolve(
        summarizeLocalReasonerDiagnostics({
          checkedAt: now(),
          provider: resolveDisplayedRuntimeLocalReasonerProvider(localReasoner),
          enabled: localReasoner.enabled,
          configured: false,
          reachable: false,
          status: localReasoner.enabled ? "unconfigured" : "disabled",
          error: null,
        })
      );
  const [encryptionStatus, recoveryBundles, recoveryRehearsals, setupPackages, localReasonerDiagnostics] = await Promise.all([
    passive ? peekStoreEncryptionStatus() : getStoreEncryptionStatus(),
    listStoreRecoveryBundles({ limit: 5 }),
    listRecoveryRehearsals({ limit: 5, store }),
    listDeviceSetupPackages({ limit: 5, store }),
    localReasonerDiagnosticsPromise,
  ]);
  const latestRecoveryRehearsal = summarizeLatestRecoveryRehearsal(recoveryRehearsals);
  const latestRecoveryRehearsalAgeHours = latestRecoveryRehearsal?.createdAt
    ? calculateAgeHours(latestRecoveryRehearsal.createdAt)
    : null;
  const latestPassedRecoveryRehearsal = summarizeLatestPassedRecoveryRehearsal(recoveryRehearsals);
  const latestPassedRecoveryRehearsalAgeHours = latestPassedRecoveryRehearsal?.createdAt
    ? calculateAgeHours(latestPassedRecoveryRehearsal.createdAt)
    : null;
  const latestRecoveryRehearsalBlocksFreshness = recoveryRehearsalSupersedesPassed(
    latestRecoveryRehearsal,
    latestPassedRecoveryRehearsal
  );
  const recoveryRehearsalFresh =
    Boolean(latestPassedRecoveryRehearsal) &&
    !latestRecoveryRehearsalBlocksFreshness &&
    latestPassedRecoveryRehearsalAgeHours != null &&
    latestPassedRecoveryRehearsalAgeHours <= Number(setupPolicy.recoveryRehearsalMaxAgeHours || 0);
  const keychainIsolationRequired = Boolean(
    setupPolicy.requireKeychainWhenAvailable &&
      encryptionStatus.preferred &&
      encryptionStatus.systemAvailable
  );
  const checks = [
    {
      code: "resident_agent_bound",
      required: true,
      passed: Boolean(residentAgentId && residentAgent),
      message:
        residentAgentId && residentAgent
          ? "常驻 Agent 绑定已就绪（当前本地参考层）。"
          : "缺少常驻 Agent 绑定。",
      evidence: {
        residentAgentId,
      },
    },
    {
      code: "bootstrap_ready",
      required: true,
      passed: residentAgent ? !bootstrapGate?.required : false,
      message:
        residentAgent
          ? (!bootstrapGate?.required ? "冷启动包已就绪。" : "当前常驻 Agent 仍缺最小冷启动包。")
          : "当前本地参考层尚未绑定常驻 Agent。",
      evidence: {
        missingRequiredCodes: bootstrapGate?.missingRequiredCodes ?? [],
      },
    },
    {
      code: "store_key_protected",
      required: true,
      passed: Boolean(encryptionStatus.source),
      message: encryptionStatus.source ? `存储主密钥来源：${encryptionStatus.source}` : "存储主密钥不可用。",
      evidence: encryptionStatus,
    },
    {
      code: "store_key_system_protected",
      required: keychainIsolationRequired,
      passed: !keychainIsolationRequired || encryptionStatus.source === "keychain",
      message:
        !keychainIsolationRequired
          ? "当前环境不强制要求系统级存储主密钥隔离。"
          : encryptionStatus.source === "keychain"
            ? "存储主密钥已使用系统钥匙串保护。"
            : "当前环境可用系统钥匙串，建议先把存储主密钥迁到系统钥匙串。",
      evidence: {
        preferred: encryptionStatus.preferred,
        ready: encryptionStatus.ready,
        systemAvailable: encryptionStatus.systemAvailable,
        source: encryptionStatus.source,
        service: encryptionStatus.service,
        account: encryptionStatus.account,
      },
    },
    {
      code: "signing_key_ready",
      required: true,
      passed: Boolean(signingStatus.ready),
      message: signingStatus.ready ? `签名密钥来源：${signingStatus.source || "未确认"}` : "签名密钥不可用。",
      evidence: signingStatus,
    },
    {
      code: "signing_key_system_protected",
      required: keychainIsolationRequired,
      passed: !keychainIsolationRequired || signingStatus.source === "keychain",
      message:
        !keychainIsolationRequired
          ? "当前环境不强制要求系统级签名密钥隔离。"
          : signingStatus.source === "keychain"
            ? "签名密钥已使用系统钥匙串保护。"
            : "当前环境可用系统钥匙串，建议先把签名密钥迁到系统钥匙串。",
      evidence: {
        preferred: signingStatus.preferred,
        ready: signingStatus.ready,
        systemAvailable: signingStatus.systemAvailable,
        source: signingStatus.source,
        service: signingStatus.service,
        account: signingStatus.account,
      },
    },
    {
      code: "local_reasoner_ready",
      required: localReasonerRequired,
      passed: !localReasonerRequired || localReasonerConfigured,
      message:
        !localReasonerRequired
          ? "当前设备允许联网增强，本地推理引擎不是硬性要求。"
          : localReasonerConfigured
            ? "本地推理引擎已配置。"
            : "当前设备为本地模式，但尚未配置本地推理引擎。",
      evidence: {
        localMode: deviceRuntime.localMode,
        enabled: localReasoner.enabled,
        provider: localReasoner.provider,
        configured: localReasonerConfigured,
        baseUrl: localReasoner.baseUrl,
        model: localReasoner.model,
      },
    },
    {
      code: "local_reasoner_reachable",
      required: localReasonerRequired,
      passed: !localReasonerRequired || Boolean(localReasonerDiagnostics?.reachable),
      message:
        !localReasonerRequired
          ? "当前设备允许联网增强，本地推理引擎可达性不是硬性要求。"
          : localReasonerDiagnostics?.reachable
            ? "本地推理引擎可达。"
            : `本地推理引擎尚不可达${localReasonerDiagnostics?.error ? `：${localReasonerDiagnostics.error}` : "。"}`,
      evidence: localReasonerDiagnostics,
    },
    {
      code: "recovery_bundle_present",
      required: Boolean(setupPolicy.requireRecoveryBundle),
      passed: Number(recoveryBundles.counts?.total || 0) > 0,
      message:
        Number(recoveryBundles.counts?.total || 0) > 0
          ? "已存在恢复包。"
          : setupPolicy.requireRecoveryBundle
            ? "尚未导出恢复包。"
            : "当前策略未强制要求恢复包。",
      evidence: {
        total: recoveryBundles.counts?.total || 0,
      },
    },
    {
      code: "recovery_rehearsal_recent",
      required: Boolean(setupPolicy.requireRecentRecoveryRehearsal),
      passed: recoveryRehearsalFresh,
      message:
        recoveryRehearsalFresh
          ? `最近一次通过的恢复演练距今 ${Math.round(latestPassedRecoveryRehearsalAgeHours || 0)} 小时。`
          : latestRecoveryRehearsalBlocksFreshness
            ? `最近一次恢复演练为${labelRecoveryRehearsalStatus(latestRecoveryRehearsal?.status)}，不能用更早的通过记录抵消。`
          : latestPassedRecoveryRehearsal
            ? `最近一次通过的恢复演练已超过 ${setupPolicy.recoveryRehearsalMaxAgeHours} 小时窗口。`
            : setupPolicy.requireRecentRecoveryRehearsal
              ? "尚未发现通过的恢复演练。"
              : "当前策略未强制要求最近一次恢复演练。",
      evidence: {
        ...recoveryRehearsals.counts,
        latestRecoveryRehearsal,
        latestRecoveryRehearsalAgeHours,
        latestRecoveryRehearsalBlocksFreshness,
        latestPassedRecoveryRehearsal,
        latestPassedRecoveryRehearsalAgeHours,
        recoveryRehearsalMaxAgeHours: setupPolicy.recoveryRehearsalMaxAgeHours,
      },
    },
    {
      code: "setup_package_present",
      required: Boolean(setupPolicy.requireSetupPackage),
      passed: Number(setupPackages.counts?.total || 0) > 0,
      message:
        Number(setupPackages.counts?.total || 0) > 0
          ? "已存在 device setup package。"
          : setupPolicy.requireSetupPackage
            ? "当前策略要求至少保留一份 device setup package。"
            : "建议导出至少一份 device setup package。",
      evidence: {
        total: setupPackages.counts?.total || 0,
      },
    },
  ];
  const missingRequiredCodes = checks.filter((item) => item.required && !item.passed).map((item) => item.code);
  const latestSetupPackageSource = Array.isArray(setupPackages.packages) ? setupPackages.packages[0] : null;
  const latestSetupPackage = buildFormalRecoverySetupPackageSummary(store, latestSetupPackageSource);
  const latestSetupPackageResidentBinding = resolveFormalRecoverySetupPackageResidentBinding(store, latestSetupPackage);
  const formalRecoveryFlow = buildFormalRecoveryFlowStatus({
    setupPolicy,
    encryptionStatus,
    signingStatus,
    recoveryBundles,
    recoveryRehearsals,
    latestRecoveryRehearsal,
    latestRecoveryRehearsalView: buildRecoveryRehearsalViewImpl(latestRecoveryRehearsal),
    latestRecoveryRehearsalAgeHours,
    latestRecoveryRehearsalBlocksFreshness,
    latestPassedRecoveryRehearsal,
    latestPassedRecoveryRehearsalView: buildRecoveryRehearsalViewImpl(latestPassedRecoveryRehearsal),
    latestPassedRecoveryRehearsalAgeHours,
    setupPackages,
    latestSetupPackage,
    latestSetupPackageResidentBinding,
    checks,
    residentAgentId,
    residentDidMethod: requestedDidMethod,
    securityPosture: deviceRuntimeView.securityPosture,
  });
  const automaticRecoveryReadiness = buildAutomaticRecoveryReadiness({
    residentAgentId,
    bootstrapGate,
    localMode: deviceRuntime.localMode,
    localReasonerDiagnostics,
    securityPosture: deviceRuntimeView.securityPosture,
    formalRecoveryFlow,
  });
  return {
    setupComplete: missingRequiredCodes.length === 0,
    missingRequiredCodes,
    initialized: true,
    storePresent: true,
    missingLedger: false,
    missingStoreKey: false,
    recoveryRequired: false,
    residentAgentId,
    residentAgentReference,
    resolvedResidentAgentId: residentAgentId,
    residentDidMethod: requestedDidMethod,
    deviceRuntime: deviceRuntimeView,
    setupPolicy,
    bootstrapGate,
    checks,
    localReasonerDiagnostics,
    formalRecoveryFlow,
    automaticRecoveryReadiness,
    recoveryBundles,
    recoveryRehearsals,
    latestRecoveryRehearsal,
    latestRecoveryRehearsalAgeHours,
    latestRecoveryRehearsalBlocksFreshness,
    latestPassedRecoveryRehearsal,
    latestPassedRecoveryRehearsalAgeHours,
    setupPackages,
  };
}

export async function runDeviceSetup(payload = {}) {
  return queueStoreMutation(async () => {
    const dryRun = normalizeBooleanFlag(payload.dryRun, false);
    const encryptedStoreEnvelope = dryRun ? await readEncryptedStoreEnvelope({ passive: true }) : null;
    const previewStore = dryRun ? cloneJson(encryptedStoreEnvelope?.store) ?? null : null;
    const previewResidentBinding = previewStore ? resolveResidentAgentBinding(previewStore, previewStore.deviceRuntime) : null;
    const currentRuntimeState = dryRun
      ? (await runWithPassiveStoreAccess(() => getDeviceRuntimeState({ store: previewStore }))).deviceRuntime
      : (await getDeviceRuntimeState()).deviceRuntime;
    const requestedResidentAgentReference = canonicalizeResidentAgentReference(
      normalizeOptionalText(payload.residentAgentReference || payload.residentAgentId) ??
        previewResidentBinding?.residentAgentReference ??
        normalizeOptionalText(currentRuntimeState?.residentAgentReference || currentRuntimeState?.residentAgentId) ??
        null
    );
    if (!requestedResidentAgentReference) {
      throw new Error("residentAgentId is required for device setup");
    }

    const didMethod = normalizeDidMethod(payload.didMethod || payload.residentDidMethod) || "agentpassport";
    const runtimeResult = await configureDeviceRuntime({
      ...payload,
      residentAgentId: requestedResidentAgentReference,
      residentDidMethod: didMethod,
      dryRun,
    }, previewStore ? { store: previewStore } : {});
    const resolvedResidentAgentId =
      normalizeOptionalText(runtimeResult?.deviceRuntime?.resolvedResidentAgentId) ||
      normalizeOptionalText(runtimeResult?.deviceRuntime?.residentAgentId) ||
      requestedResidentAgentReference;
    const bootstrapResult = await bootstrapAgentRuntime(
      requestedResidentAgentReference,
      {
        ...payload,
        claimResidentAgent: true,
        didMethod,
        dryRun,
      },
      previewStore ? { didMethod, store: previewStore } : { didMethod }
    );

    let recoveryExport = {
      skipped: true,
      reason: "passphrase_missing",
    };
    let recoveryRehearsal = {
      skipped: true,
      reason: "bundle_missing",
    };
    const recoveryPassphrase = normalizeOptionalText(payload.recoveryPassphrase || payload.passphrase) ?? null;
    const recoveryPreviewContext =
      previewStore && encryptedStoreEnvelope?.envelope
        ? {
            exportOptions: {
              store: previewStore,
              envelope: encryptedStoreEnvelope.envelope,
            },
            rehearsalOptions: {
              store: previewStore,
              envelopeState: {
                present: true,
                readable: true,
                envelope: encryptedStoreEnvelope.envelope,
                error: null,
              },
            },
          }
        : null;
    const canPreviewRecoveryBundle =
      !dryRun || Boolean(recoveryPreviewContext && encryptedStoreEnvelope?.encrypted === true);
    if (recoveryPassphrase && canPreviewRecoveryBundle) {
      recoveryExport = await exportStoreRecoveryBundle({
        passphrase: recoveryPassphrase,
        note: normalizeOptionalText(payload.recoveryNote) ?? "device setup recovery bundle",
        dryRun,
        saveToFile: !dryRun,
        returnBundle: true,
      }, recoveryPreviewContext?.exportOptions ?? {});
      recoveryRehearsal = await rehearseStoreRecoveryBundle({
        passphrase: recoveryPassphrase,
        bundle: recoveryExport.bundle,
        dryRun,
        persist: !dryRun,
        note: "device setup rehearsal",
      }, recoveryPreviewContext?.rehearsalOptions ?? {});
    } else if (recoveryPassphrase && dryRun) {
      recoveryExport = {
        skipped: true,
        reason: "encrypted_ledger_envelope_missing",
      };
      recoveryRehearsal = {
        skipped: true,
        reason: "bundle_missing",
      };
    }

    const status = await getDeviceSetupStatus(previewStore ? { store: previewStore, passive: dryRun } : {});
    return {
      setup: {
        completedAt: now(),
        dryRun,
        residentAgentId: resolvedResidentAgentId,
        residentAgentReference: requestedResidentAgentReference,
        resolvedResidentAgentId,
        residentDidMethod: didMethod,
      },
      runtime: runtimeResult,
      bootstrap: bootstrapResult,
      recoveryExport,
      recoveryRehearsal,
      status,
    };
  });
}

export async function exportDeviceSetupPackage(payload = {}) {
  return queueStoreMutation(async () => {
    const exported = await exportDeviceSetupPackageImpl(payload, {
      loadStore: () => loadStoreForDeviceSetupPackageExport(payload),
      getDeviceSetupStatus,
      normalizeDeviceRuntime,
      protocolName: PROTOCOL_NAME,
      chainIdFromStore: (store) => store.chainId,
      deviceSetupPackageFormat: DEVICE_SETUP_PACKAGE_FORMAT,
      deviceSetupPackageDir: DEVICE_SETUP_PACKAGE_DIR,
      appendEvent,
      writeStore,
    });
    const storeStatus = await resolveOptionalPassiveStore();
    return {
      ...exported,
      summary: annotateSetupPackageResidentBinding(storeStatus.store, exported.summary),
    };
  });
}

export async function importDeviceSetupPackage(payload = {}) {
  return queueStoreMutation(async () => {
    const imported = await importDeviceSetupPackageImpl(payload, {
      resolveDeviceSetupPackageInputImpl: resolveDeviceSetupPackageInput,
      normalizeDeviceRuntime,
      normalizeDidMethodImpl: normalizeDidMethod,
      configureDeviceRuntime,
      normalizeLocalReasonerProfileRecord,
      loadStore,
      appendEvent,
      writeStore,
      getDeviceSetupStatus,
    });
    const storeStatus = await resolveOptionalPassiveStore();
    return {
      ...imported,
      summary: annotateSetupPackageResidentBinding(storeStatus.store, imported.summary),
    };
  });
}

export async function inspectDeviceLocalReasoner(payload = {}) {
  const passive = normalizeBooleanFlag(payload.passive, false);
  const storeStatus = passive
    ? await resolveOptionalPassiveStore(payload.store || null)
    : {
        store: payload.store || await loadStore(),
        missingKey: false,
      };
  const store = storeStatus.store;
  const runtime = normalizeDeviceRuntime(payload.deviceRuntime || store?.deviceRuntime);
  const { diagnostics, rawDiagnostics } = await resolveDeviceLocalReasonerInspectionDiagnostics(runtime, {
    passive,
    inspectRuntimeLocalReasoner,
  });
  return buildDeviceLocalReasonerInspectionResult({
    store,
    storeStatus,
    runtime,
    diagnostics,
    rawDiagnostics,
    passive,
  });
}

export async function listDeviceLocalReasonerProfiles({
  limit = DEFAULT_LOCAL_REASONER_PROFILE_LIMIT,
  profileId = null,
  profileIds = [],
} = {}) {
  const store = await loadStore();
  return buildLocalReasonerProfileList(store.localReasonerProfiles, {
    limit,
    profileId,
    profileIds,
  });
}

export async function getDeviceLocalReasonerProfile(profileId, { includeProfile = true } = {}) {
  const store = await loadStore();
  const { profile } = resolveLocalReasonerProfileRecord(store.localReasonerProfiles, profileId);
  return buildLocalReasonerProfileLoadResult(profile, { includeProfile });
}

export async function saveDeviceLocalReasonerProfile(payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const dryRun = normalizeBooleanFlag(payload.dryRun, false);
    const targetStore = dryRun ? cloneJson(store) : store;
    const savePlan = applyLocalReasonerProfileSaveToStore(targetStore, payload, {
      appendEvent,
      dryRun,
    });

    if (!dryRun) {
      await writeStore(targetStore);
    }

    return buildLocalReasonerProfileSaveResult(savePlan.nextProfile, { dryRun });
  });
}

export async function activateDeviceLocalReasonerProfile(profileId, payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const dryRun = normalizeBooleanFlag(payload.dryRun, false);
    const targetStore = dryRun ? cloneJson(store) : store;
    const activated = activateDeviceLocalReasonerProfileInStore(targetStore, profileId, payload, {
      appendEvent,
      resolveResidentAgentBinding,
    });
    if (!dryRun) {
      await writeStore(targetStore, { archiveColdData: false });
    }
    return activated;
  });
}

export async function deleteDeviceLocalReasonerProfile(profileId, payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const dryRun = normalizeBooleanFlag(payload.dryRun, false);
    const deletePlan = applyLocalReasonerProfileDeleteToStore(store, profileId, {
      appendEvent,
      dryRun,
    });

    if (!dryRun) {
      await writeStore(store);
    }

    return buildLocalReasonerProfileDeleteResult(deletePlan.profile, { dryRun });
  });
}

export async function listDeviceLocalReasonerRestoreCandidates({
  limit = DEFAULT_LOCAL_REASONER_PROFILE_LIMIT,
  profileId = null,
  profileIds = [],
} = {}) {
  const store = await loadStore();
  return buildLocalReasonerRestoreCandidatesFromProfiles(store.localReasonerProfiles, {
    limit,
    profileId,
    profileIds,
  });
}

export async function restoreDeviceLocalReasoner(payload = {}) {
  return restoreDeviceLocalReasonerWithStore(payload);
}

async function restoreDeviceLocalReasonerWithStore(payload = {}, { store: storeOverride = null } = {}) {
  if (storeOverride && !normalizeBooleanFlag(payload.dryRun, false) && !storeMutationContext.getStore()?.active) {
    throw new Error("restoreDeviceLocalReasoner store override requires an active store mutation");
  }
  return queueStoreMutation(async () => {
    const store = storeOverride || await loadStore();
    const dryRun = normalizeBooleanFlag(payload.dryRun, false);
    const targetStore = storeOverride ? store : dryRun ? cloneJson(store) : store;
    const restored = await restoreDeviceLocalReasonerInStore(targetStore, payload, {
      appendEvent,
      generateAgentRunnerCandidateResponse,
      inspectRuntimeLocalReasoner,
      resolveResidentAgentBinding,
    });
    if (!dryRun && !storeOverride) {
      await writeStore(targetStore, { archiveColdData: false });
    }
    return restored;
  });
}

export async function getDeviceLocalReasonerCatalog(payload = {}) {
  const passive = normalizeBooleanFlag(payload.passive, false);
  const storeStatus = passive
    ? await resolveOptionalPassiveStore(payload.store || null)
    : {
        store: payload.store || await loadStore(),
        missingKey: false,
      };
  const store = storeStatus.store;
  const runtime = normalizeDeviceRuntime(payload.deviceRuntime || store?.deviceRuntime);
  const selectedProvider = resolveDeviceLocalReasonerCatalogSelectedProvider(runtime);
  const providers = await buildDeviceLocalReasonerCatalogProviders({
    runtime,
    selectedProvider,
    passive,
    buildLocalReasonerProbeConfig,
    inspectRuntimeLocalReasoner,
  });

  return buildDeviceLocalReasonerCatalogResult({
    store,
    storeStatus,
    runtime,
    selectedProvider,
    providers,
    passive,
  });
}

export async function probeDeviceLocalReasoner(payload = {}) {
  const store = await loadStore();
  const runtime = normalizeDeviceRuntime(payload.deviceRuntime || store.deviceRuntime);
  const candidateConfig = buildDeviceLocalReasonerProbeCandidateConfig(runtime, payload);
  const diagnostics = await inspectRuntimeLocalReasoner(candidateConfig);
  return buildDeviceLocalReasonerProbeResult({
    store,
    runtime,
    candidateConfig,
    diagnostics,
  });
}

export async function selectDeviceLocalReasoner(payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const dryRun = normalizeBooleanFlag(payload.dryRun, false);
    const targetStore = dryRun ? cloneJson(store) : store;
    const selected = selectDeviceLocalReasonerInStore(targetStore, payload, {
      appendEvent,
      resolveResidentAgentBinding,
    });
    if (!dryRun) {
      await writeStore(targetStore, { archiveColdData: false });
    }
    return selected;
  });
}

export async function migrateDeviceLocalReasonerProfilesToDefault(payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const dryRun = normalizeBooleanFlag(payload.dryRun, false);
    const targetStore = dryRun ? cloneJson(store) : store;
    const migrationPlan = applyDefaultLocalReasonerProfileMigrationToStore(targetStore, payload, {
      appendEvent,
      dryRun,
    });

    if (!dryRun && migrationPlan.counts.needsMigration > 0) {
      await writeStore(targetStore);
    }

    return buildDefaultLocalReasonerProfileMigrationResult(migrationPlan, { dryRun });
  });
}

export async function migrateDeviceLocalReasonerToDefault(payload = {}) {
  const store = await loadStore();
  return runDefaultDeviceLocalReasonerMigration(payload, {
    store,
    selectDeviceLocalReasoner,
    prewarmDeviceLocalReasoner,
    migrateDeviceLocalReasonerProfilesToDefault,
  });
}

export async function prewarmDeviceLocalReasoner(payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const dryRun = normalizeBooleanFlag(payload.dryRun, false);
    const targetStore = dryRun ? cloneJson(store) : store;
    const prewarmed = await prewarmDeviceLocalReasonerInStore(targetStore, payload, {
      appendEvent,
      generateAgentRunnerCandidateResponse,
      inspectRuntimeLocalReasoner,
      resolveResidentAgentBinding,
    });
    if (!dryRun) {
      await writeStore(targetStore, { archiveColdData: false });
    }
    return prewarmed;
  });
}

export async function pruneDeviceSetupPackages(payload = {}) {
  return queueStoreMutation(async () => {
    const keepLatest = Math.max(0, Math.floor(toFiniteNumber(payload.keepLatest, DEFAULT_DEVICE_SETUP_PACKAGE_KEEP_LATEST)));
    const store = await loadStore();
    const residentAgentReference = canonicalizeResidentAgentReference(payload.residentAgentId);
    const residentAgentId = residentAgentReference
      ? resolveStoredAgentId(store, residentAgentReference) ?? residentAgentReference
      : null;
    const noteIncludes = normalizeOptionalText(payload.noteIncludes) ?? null;
    const dryRun = normalizeBooleanFlag(payload.dryRun, false);
    const listed = await listDeviceSetupPackages({ limit: Number.MAX_SAFE_INTEGER, store });
    const packages = Array.isArray(listed.packages) ? listed.packages : [];
    const matched = packages.filter((entry) => {
      const { resolvedResidentBinding } = buildAnnotatedSetupPackageResidentBindings(store, entry);
      const entryResidentBinding = resolvedResidentBinding || buildSetupPackageResidentBindingView(entry, { store });
      const entryResidentAgentId =
        normalizeOptionalText(
          entryResidentBinding.effectiveResolvedResidentAgentId ||
            entryResidentBinding.effectivePhysicalResidentAgentId
        ) ?? null;
      if (residentAgentId && entryResidentAgentId !== residentAgentId) {
        return false;
      }
      if (noteIncludes && !String(entry?.note || "").includes(noteIncludes)) {
        return false;
      }
      return true;
    });
    const kept = matched.slice(0, keepLatest);
    const deleted = matched.slice(keepLatest);
    const prunedResidentBinding = buildSetupPackageResidentBindingView({
      residentAgentId,
      residentAgentReference,
      resolvedResidentAgentId: residentAgentId,
    });
    const prunedResidentProjection = buildSetupPackageResidentEventPayload(prunedResidentBinding, {
      topLevelResidentBinding: "effective",
    });

    if (!dryRun && deleted.length > 0) {
      for (const entry of deleted) {
        if (entry?.packagePath) {
          await unlink(entry.packagePath);
        }
      }
      appendEvent(store, "device_setup_packages_pruned", {
        keepLatest,
        ...prunedResidentProjection,
        noteIncludes,
        deletedCount: deleted.length,
        keptCount: kept.length,
      });
      await writeStore(store);
    }

    return {
      prunedAt: now(),
      dryRun,
      keepLatest,
      ...prunedResidentProjection,
      noteIncludes,
      counts: {
        matched: matched.length,
        kept: kept.length,
        deleted: deleted.length,
      },
      kept,
      deleted,
    };
  });
}

export async function configureDeviceRuntime(payload = {}, options = {}) {
  const storeOverride = options?.store ?? null;
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  if (storeOverride && !dryRun) {
    throw new Error("configureDeviceRuntime store override requires dryRun");
  }
  const execute = async () => {
    const store = storeOverride || (dryRun ? await runWithPassiveStoreAccess(() => loadStore()) : await loadStore());
    const targetStore = storeOverride ? store : dryRun ? cloneJson(store) : store;
    targetStore.deviceRuntime = normalizeDeviceRuntime(targetStore.deviceRuntime);

    const currentResidentBinding = resolveResidentAgentBinding(targetStore, targetStore.deviceRuntime);
    const requestedResidentAgentReference = canonicalizeResidentAgentReference(
      normalizeOptionalText(payload.residentAgentReference || payload.residentAgentId) ?? null
    );
    const currentResidentReference = currentResidentBinding.residentAgentReference ?? null;
    const requestedResidentAgentId = requestedResidentAgentReference
      ? resolveStoredAgentId(targetStore, requestedResidentAgentReference) ?? requestedResidentAgentReference
      : currentResidentBinding.residentAgentId
        ? currentResidentBinding.residentAgentId
        : currentResidentReference
          ? resolveStoredAgentId(targetStore, currentResidentReference) ?? currentResidentReference
          : null;
    const currentResidentAgentId = currentResidentBinding.residentAgentId
      ? currentResidentBinding.residentAgentId
      : null;
    const allowResidentRebind = normalizeBooleanFlag(payload.allowResidentRebind, false);
    const localReasonerPayload =
      payload.localReasoner && typeof payload.localReasoner === "object" ? payload.localReasoner : null;
    const retrievalPolicyPayload =
      payload.retrievalPolicy && typeof payload.retrievalPolicy === "object" ? payload.retrievalPolicy : null;
    const externalColdMemoryPayload =
      retrievalPolicyPayload?.externalColdMemory && typeof retrievalPolicyPayload.externalColdMemory === "object"
        ? retrievalPolicyPayload.externalColdMemory
        : null;
    const payloadHas = (key) => Object.prototype.hasOwnProperty.call(payload, key);
    const localReasonerPayloadHas = (key) =>
      Boolean(localReasonerPayload) && Object.prototype.hasOwnProperty.call(localReasonerPayload, key);
    const retrievalPolicyPayloadHas = (key) =>
      Boolean(retrievalPolicyPayload) && Object.prototype.hasOwnProperty.call(retrievalPolicyPayload, key);
    const externalColdMemoryPayloadHas = (key) =>
      Boolean(externalColdMemoryPayload) && Object.prototype.hasOwnProperty.call(externalColdMemoryPayload, key);
    const resolveLocalReasonerField = (topLevelKey, nestedKey, fallback) => {
      if (payloadHas(topLevelKey)) {
        return payload[topLevelKey];
      }
      if (localReasonerPayloadHas(nestedKey)) {
        return localReasonerPayload[nestedKey];
      }
      return fallback;
    };
    const resolveRetrievalField = (topLevelKey, nestedKey, externalKey, fallback) => {
      if (payloadHas(topLevelKey)) {
        return payload[topLevelKey];
      }
      if (nestedKey && retrievalPolicyPayloadHas(nestedKey)) {
        return retrievalPolicyPayload[nestedKey];
      }
      if (externalKey && externalColdMemoryPayloadHas(externalKey)) {
        return externalColdMemoryPayload[externalKey];
      }
      return fallback;
    };

    if (requestedResidentAgentId && !targetStore.agents?.[requestedResidentAgentId]) {
      throw new Error(`Resident agent not found: ${requestedResidentAgentReference || requestedResidentAgentId}`);
    }

    if (
      currentResidentAgentId &&
      requestedResidentAgentId &&
      currentResidentAgentId !== requestedResidentAgentId &&
      normalizeBooleanFlag(targetStore.deviceRuntime.residentLocked, true) &&
      !allowResidentRebind
    ) {
      throw new Error(`本地参考层 resident agent binding is locked to ${currentResidentAgentId}`);
    }

    targetStore.deviceRuntime = normalizeDeviceRuntime({
      ...targetStore.deviceRuntime,
      residentAgentId: requestedResidentAgentId,
      residentAgentReference:
        requestedResidentAgentReference ??
        currentResidentReference ??
        canonicalizeResidentAgentReference(requestedResidentAgentId) ??
        null,
      resolvedResidentAgentId: requestedResidentAgentId,
      residentDidMethod:
        normalizeDidMethod(payload.residentDidMethod) ||
        normalizeDidMethod(payload.didMethod) ||
        targetStore.deviceRuntime.residentDidMethod,
      residentLocked: payload.residentLocked != null
        ? normalizeBooleanFlag(payload.residentLocked, true)
        : targetStore.deviceRuntime.residentLocked,
      localMode: payload.localMode ?? targetStore.deviceRuntime.localMode,
      allowOnlineReasoner:
        payload.allowOnlineReasoner != null
          ? normalizeBooleanFlag(payload.allowOnlineReasoner, targetStore.deviceRuntime.allowOnlineReasoner)
          : targetStore.deviceRuntime.allowOnlineReasoner,
    negotiationMode: payload.negotiationMode ?? targetStore.deviceRuntime.commandPolicy?.negotiationMode,
    autoExecuteLowRisk:
      payload.autoExecuteLowRisk != null
        ? normalizeBooleanFlag(payload.autoExecuteLowRisk, false)
        : targetStore.deviceRuntime.commandPolicy?.autoExecuteLowRisk,
    lowRiskStrategy:
      payload.lowRiskStrategy ??
      payload.commandPolicy?.lowRiskStrategy ??
      payload.commandPolicy?.riskStrategies?.low,
    mediumRiskStrategy:
      payload.mediumRiskStrategy ??
      payload.commandPolicy?.mediumRiskStrategy ??
      payload.commandPolicy?.riskStrategies?.medium,
    highRiskStrategy:
      payload.highRiskStrategy ??
      payload.commandPolicy?.highRiskStrategy ??
      payload.commandPolicy?.riskStrategies?.high,
    criticalRiskStrategy:
      payload.criticalRiskStrategy ??
      payload.commandPolicy?.criticalRiskStrategy ??
      payload.commandPolicy?.riskStrategies?.critical,
    requireExplicitConfirmation:
      payload.requireExplicitConfirmation != null
        ? normalizeBooleanFlag(payload.requireExplicitConfirmation, true)
        : targetStore.deviceRuntime.commandPolicy?.requireExplicitConfirmation,
    securityPostureMode:
      payload.securityPostureMode ??
      payload.securityPosture?.mode ??
      targetStore.deviceRuntime.securityPosture?.mode,
    securityPostureReason:
      payload.securityPostureReason ??
      payload.securityPosture?.reason ??
      targetStore.deviceRuntime.securityPosture?.reason,
    securityPostureNote:
      payload.securityPostureNote ??
      payload.securityPosture?.note ??
      targetStore.deviceRuntime.securityPosture?.note,
    securityPostureUpdatedAt:
      payload.securityPostureUpdatedAt ??
      payload.securityPosture?.updatedAt ??
      targetStore.deviceRuntime.securityPosture?.updatedAt,
    securityPostureUpdatedByAgentId:
      payload.securityPostureUpdatedByAgentId ??
      payload.securityPosture?.updatedByAgentId ??
      targetStore.deviceRuntime.securityPosture?.updatedByAgentId,
    securityPostureUpdatedByWindowId:
      payload.securityPostureUpdatedByWindowId ??
      payload.securityPosture?.updatedByWindowId ??
      targetStore.deviceRuntime.securityPosture?.updatedByWindowId,
    securityPostureSourceWindowId:
      payload.securityPostureSourceWindowId ??
      payload.securityPosture?.sourceWindowId ??
      targetStore.deviceRuntime.securityPosture?.sourceWindowId,
    lowRiskActionKeywords:
      payload.lowRiskActionKeywords ?? payload.commandPolicy?.lowRiskActionKeywords,
    highRiskActionKeywords:
      payload.highRiskActionKeywords ?? payload.commandPolicy?.highRiskActionKeywords,
    criticalRiskActionKeywords:
      payload.criticalRiskActionKeywords ?? payload.commandPolicy?.criticalRiskActionKeywords,
    retrievalStrategy:
      payload.retrievalStrategy ??
      payload.retrievalPolicy?.strategy ??
      targetStore.deviceRuntime.retrievalPolicy?.strategy,
    preferStructuredMemory:
      payload.preferStructuredMemory ??
      payload.retrievalPolicy?.preferStructuredMemory ??
      targetStore.deviceRuntime.retrievalPolicy?.preferStructuredMemory,
    preferConversationMinutes:
      payload.preferConversationMinutes ??
      payload.retrievalPolicy?.preferConversationMinutes ??
      targetStore.deviceRuntime.retrievalPolicy?.preferConversationMinutes,
    preferCompactBoundaries:
      payload.preferCompactBoundaries ??
      payload.retrievalPolicy?.preferCompactBoundaries ??
      targetStore.deviceRuntime.retrievalPolicy?.preferCompactBoundaries,
    requireRecoveryBundle:
      payload.requireRecoveryBundle ??
      payload.setupPolicy?.requireRecoveryBundle ??
      targetStore.deviceRuntime.setupPolicy?.requireRecoveryBundle,
    requireSetupPackage:
      payload.requireSetupPackage ??
      payload.setupPolicy?.requireSetupPackage ??
      targetStore.deviceRuntime.setupPolicy?.requireSetupPackage,
    requireRecentRecoveryRehearsal:
      payload.requireRecentRecoveryRehearsal ??
      payload.setupPolicy?.requireRecentRecoveryRehearsal ??
      targetStore.deviceRuntime.setupPolicy?.requireRecentRecoveryRehearsal,
    recoveryRehearsalMaxAgeHours:
      payload.recoveryRehearsalMaxAgeHours ??
      payload.setupPolicy?.recoveryRehearsalMaxAgeHours ??
      targetStore.deviceRuntime.setupPolicy?.recoveryRehearsalMaxAgeHours,
    requireKeychainWhenAvailable:
      payload.requireKeychainWhenAvailable ??
      payload.requireSystemKeyIsolationWhenAvailable ??
      payload.setupPolicy?.requireKeychainWhenAvailable ??
      payload.setupPolicy?.requireSystemKeyIsolationWhenAvailable ??
      targetStore.deviceRuntime.setupPolicy?.requireKeychainWhenAvailable,
    allowVectorIndex:
      payload.allowVectorIndex ??
      payload.retrievalPolicy?.allowVectorIndex ??
      targetStore.deviceRuntime.retrievalPolicy?.allowVectorIndex,
    retrievalMaxHits:
      payload.retrievalMaxHits ??
      payload.retrievalPolicy?.maxHits ??
      targetStore.deviceRuntime.retrievalPolicy?.maxHits,
    externalColdMemoryEnabled: resolveRetrievalField(
      "externalColdMemoryEnabled",
      "externalColdMemoryEnabled",
      "enabled",
      targetStore.deviceRuntime.retrievalPolicy?.externalColdMemory?.enabled
    ),
    externalColdMemoryProvider: resolveRetrievalField(
      "externalColdMemoryProvider",
      "externalColdMemoryProvider",
      "provider",
      targetStore.deviceRuntime.retrievalPolicy?.externalColdMemory?.provider
    ),
    externalColdMemoryMaxHits: resolveRetrievalField(
      "externalColdMemoryMaxHits",
      "externalColdMemoryMaxHits",
      "maxHits",
      targetStore.deviceRuntime.retrievalPolicy?.externalColdMemory?.maxHits
    ),
    externalColdMemoryTimeoutMs: resolveRetrievalField(
      "externalColdMemoryTimeoutMs",
      "externalColdMemoryTimeoutMs",
      "timeoutMs",
      targetStore.deviceRuntime.retrievalPolicy?.externalColdMemory?.timeoutMs
    ),
    mempalaceCommand: resolveRetrievalField(
      "mempalaceCommand",
      "mempalaceCommand",
      "command",
      targetStore.deviceRuntime.retrievalPolicy?.externalColdMemory?.command
    ),
    mempalacePalacePath: resolveRetrievalField(
      "mempalacePalacePath",
      "mempalacePalacePath",
      "palacePath",
      targetStore.deviceRuntime.retrievalPolicy?.externalColdMemory?.palacePath
    ),
    mempalaceWing: resolveRetrievalField(
      "mempalaceWing",
      "mempalaceWing",
      "wing",
      targetStore.deviceRuntime.retrievalPolicy?.externalColdMemory?.wing
    ),
    mempalaceRoom: resolveRetrievalField(
      "mempalaceRoom",
      "mempalaceRoom",
      "room",
      targetStore.deviceRuntime.retrievalPolicy?.externalColdMemory?.room
    ),
    localReasonerEnabled: resolveLocalReasonerField(
      "localReasonerEnabled",
      "enabled",
      targetStore.deviceRuntime.localReasoner?.enabled
    ),
    localReasonerProvider: resolveLocalReasonerField(
      "localReasonerProvider",
      "provider",
      targetStore.deviceRuntime.localReasoner?.provider
    ),
    localReasonerCommand: resolveLocalReasonerField(
      "localReasonerCommand",
      "command",
      targetStore.deviceRuntime.localReasoner?.command
    ),
    localReasonerArgs: resolveLocalReasonerField(
      "localReasonerArgs",
      "args",
      targetStore.deviceRuntime.localReasoner?.args
    ),
    localReasonerCwd: resolveLocalReasonerField(
      "localReasonerCwd",
      "cwd",
      targetStore.deviceRuntime.localReasoner?.cwd
    ),
    localReasonerTimeoutMs: resolveLocalReasonerField(
      "localReasonerTimeoutMs",
      "timeoutMs",
      targetStore.deviceRuntime.localReasoner?.timeoutMs
    ),
    localReasonerMaxOutputBytes: resolveLocalReasonerField(
      "localReasonerMaxOutputBytes",
      "maxOutputBytes",
      targetStore.deviceRuntime.localReasoner?.maxOutputBytes
    ),
    localReasonerMaxInputBytes: resolveLocalReasonerField(
      "localReasonerMaxInputBytes",
      "maxInputBytes",
      targetStore.deviceRuntime.localReasoner?.maxInputBytes
    ),
    localReasonerFormat: resolveLocalReasonerField(
      "localReasonerFormat",
      "format",
      targetStore.deviceRuntime.localReasoner?.format
    ),
    localReasonerBaseUrl: resolveLocalReasonerField(
      "localReasonerBaseUrl",
      "baseUrl",
      targetStore.deviceRuntime.localReasoner?.baseUrl
    ),
    localReasonerPath: resolveLocalReasonerField(
      "localReasonerPath",
      "path",
      targetStore.deviceRuntime.localReasoner?.path
    ),
    localReasonerModel: resolveLocalReasonerField(
      "localReasonerModel",
      "model",
      targetStore.deviceRuntime.localReasoner?.model
    ),
    localReasonerSelection: resolveLocalReasonerField(
      "localReasonerSelection",
      "selection",
      targetStore.deviceRuntime.localReasoner?.selection
    ),
    localReasonerLastProbe: resolveLocalReasonerField(
      "localReasonerLastProbe",
      "lastProbe",
      targetStore.deviceRuntime.localReasoner?.lastProbe
    ),
    localReasonerLastWarm: resolveLocalReasonerField(
      "localReasonerLastWarm",
      "lastWarm",
      targetStore.deviceRuntime.localReasoner?.lastWarm
    ),
    allowedCapabilities:
      payload.allowedCapabilities ??
      payload.sandboxPolicy?.allowedCapabilities ??
      targetStore.deviceRuntime.sandboxPolicy?.allowedCapabilities,
    allowShellExecution:
      payload.allowShellExecution ??
      payload.sandboxPolicy?.allowShellExecution ??
      targetStore.deviceRuntime.sandboxPolicy?.allowShellExecution,
    allowExternalNetwork:
      payload.allowExternalNetwork ??
      payload.sandboxPolicy?.allowExternalNetwork ??
      targetStore.deviceRuntime.sandboxPolicy?.allowExternalNetwork,
    filesystemAllowlist:
      payload.filesystemAllowlist ??
      payload.sandboxPolicy?.filesystemAllowlist ??
      targetStore.deviceRuntime.sandboxPolicy?.filesystemAllowlist,
    networkAllowlist:
      payload.networkAllowlist ??
      payload.sandboxPolicy?.networkAllowlist ??
      targetStore.deviceRuntime.sandboxPolicy?.networkAllowlist,
    blockedCapabilities:
      payload.blockedCapabilities ??
      payload.sandboxPolicy?.blockedCapabilities ??
      targetStore.deviceRuntime.sandboxPolicy?.blockedCapabilities,
    allowedCommands:
      payload.allowedCommands ??
      payload.sandboxPolicy?.allowedCommands ??
      targetStore.deviceRuntime.sandboxPolicy?.allowedCommands,
    systemBrokerSandboxEnabled:
      payload.systemBrokerSandboxEnabled ??
      payload.sandboxPolicy?.systemBrokerSandboxEnabled ??
      targetStore.deviceRuntime.sandboxPolicy?.systemBrokerSandboxEnabled,
    workerIsolationEnabled:
      payload.workerIsolationEnabled ??
      payload.sandboxPolicy?.workerIsolationEnabled ??
      targetStore.deviceRuntime.sandboxPolicy?.workerIsolationEnabled,
    workerTimeoutMs:
      payload.workerTimeoutMs ??
      payload.sandboxPolicy?.workerTimeoutMs ??
      targetStore.deviceRuntime.sandboxPolicy?.workerTimeoutMs,
    maxNetworkBytes:
      payload.maxNetworkBytes ??
      payload.sandboxPolicy?.maxNetworkBytes ??
      targetStore.deviceRuntime.sandboxPolicy?.maxNetworkBytes,
    maxProcessOutputBytes:
      payload.maxProcessOutputBytes ??
      payload.sandboxPolicy?.maxProcessOutputBytes ??
      targetStore.deviceRuntime.sandboxPolicy?.maxProcessOutputBytes,
    maxProcessArgs:
      payload.maxProcessArgs ??
      payload.sandboxPolicy?.maxProcessArgs ??
      targetStore.deviceRuntime.sandboxPolicy?.maxProcessArgs,
    maxProcessArgBytes:
      payload.maxProcessArgBytes ??
      payload.sandboxPolicy?.maxProcessArgBytes ??
      targetStore.deviceRuntime.sandboxPolicy?.maxProcessArgBytes,
    maxProcessInputBytes:
      payload.maxProcessInputBytes ??
      payload.sandboxPolicy?.maxProcessInputBytes ??
      targetStore.deviceRuntime.sandboxPolicy?.maxProcessInputBytes,
    maxUrlLength:
      payload.maxUrlLength ??
      payload.sandboxPolicy?.maxUrlLength ??
      targetStore.deviceRuntime.sandboxPolicy?.maxUrlLength,
    requireAbsoluteProcessCommand:
      payload.requireAbsoluteProcessCommand ??
      payload.sandboxPolicy?.requireAbsoluteProcessCommand ??
      targetStore.deviceRuntime.sandboxPolicy?.requireAbsoluteProcessCommand,
    maxReadBytes:
      payload.maxReadBytes ??
      payload.sandboxPolicy?.maxReadBytes ??
      targetStore.deviceRuntime.sandboxPolicy?.maxReadBytes,
    maxListEntries:
      payload.maxListEntries ??
      payload.sandboxPolicy?.maxListEntries ??
      targetStore.deviceRuntime.sandboxPolicy?.maxListEntries,
    updatedAt: now(),
    updatedByAgentId: normalizeOptionalText(payload.updatedByAgentId || payload.recordedByAgentId) ?? requestedResidentAgentId ?? null,
    updatedByWindowId: normalizeOptionalText(payload.updatedByWindowId || payload.recordedByWindowId) ?? null,
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId) ?? null,
  });

    const configuredResidentBinding = resolveResidentAgentBinding(targetStore, targetStore.deviceRuntime);
    appendEvent(targetStore, "device_runtime_configured", {
      dryRun,
      residentAgentId: configuredResidentBinding.residentAgentId ?? null,
      residentAgentReference: configuredResidentBinding.residentAgentReference ?? null,
      resolvedResidentAgentId: configuredResidentBinding.resolvedResidentAgentId ?? null,
      residentDidMethod: targetStore.deviceRuntime.residentDidMethod,
      residentLocked: targetStore.deviceRuntime.residentLocked,
      localMode: targetStore.deviceRuntime.localMode,
      allowOnlineReasoner: targetStore.deviceRuntime.allowOnlineReasoner,
      negotiationMode: targetStore.deviceRuntime.commandPolicy?.negotiationMode ?? DEFAULT_DEVICE_NEGOTIATION_MODE,
      sourceWindowId: normalizeOptionalText(payload.sourceWindowId) ?? null,
      riskStrategies: cloneJson(targetStore.deviceRuntime.commandPolicy?.riskStrategies) ?? {},
      securityPosture: cloneJson(targetStore.deviceRuntime.securityPosture) ?? {},
      retrievalPolicy: cloneJson(targetStore.deviceRuntime.retrievalPolicy) ?? {},
      setupPolicy: cloneJson(targetStore.deviceRuntime.setupPolicy) ?? {},
      sandboxPolicy: cloneJson(targetStore.deviceRuntime.sandboxPolicy) ?? {},
    });

    if (!dryRun) {
      await writeStore(targetStore, { archiveColdData: false });
    }

    return {
      configuredAt: now(),
      dryRun,
      deviceRuntime: buildDeviceRuntimeView(targetStore.deviceRuntime, targetStore),
    };
  };
  if (storeOverride) {
    return execute();
  }
  return queueStoreMutation(execute);
}

export async function registerAgent({
  displayName,
  role = "individual-agent",
  controller = "unknown",
  controllers,
  signers,
  walletAddress,
  multisigThreshold,
  threshold,
  initialCredits = 0,
} = {}) {
  return queueStoreMutation(async () => {
  if (!displayName?.trim()) {
    throw new Error("displayName is required");
  }

  const store = await loadStore();
  const normalizedRole = normalizeOptionalText(role) ?? "individual-agent";
  const normalizedController = normalizeOptionalText(controller) ?? "unknown";
  const agentId = agentIdFromName(displayName);
  const identity = buildIdentityProfile({
    chainId: store.chainId,
    agentId,
    displayName,
    controller: normalizedController,
    controllers: normalizeOptionalText(controllers),
    signers: normalizeOptionalText(signers),
    walletAddress: normalizeOptionalText(walletAddress),
    threshold: multisigThreshold ?? threshold,
  });
  const createdEvent = appendEvent(store, "agent_registered", {
    agentId,
    did: identity.did,
    walletAddress: identity.walletAddress,
    displayName,
    role: normalizedRole,
    controller: identity.controllers.map((signer) => signer.label).join(", "),
    threshold: identity.authorizationPolicy.threshold,
    signerCount: identity.authorizationPolicy.signers.length,
  });

  const agent = baseAgentRecord({
    agentId,
    displayName,
    role: normalizedRole,
    controller: identity.controllers.map((signer) => signer.label).join(", "),
    createdByEventHash: createdEvent.hash,
    identity,
  });
  store.agents[agentId] = agent;

  const bootstrapCredits = toFiniteNumber(initialCredits, 0);
  if (bootstrapCredits > 0) {
    const treasury = ensureAgent(store, TREASURY_AGENT_ID);
    ensureCredits(treasury, bootstrapCredits);
    treasury.balances.credits -= bootstrapCredits;
    agent.balances.credits += bootstrapCredits;
    appendEvent(store, "asset_granted", {
      fromAgentId: TREASURY_AGENT_ID,
      toAgentId: agentId,
      assetType: "credits",
      amount: bootstrapCredits,
      reason: "initial bootstrap",
      authorizedBy: "system",
    });
  }

  await writeStore(store);
  return agent;
  });
}

export async function forkAgent(sourceAgentId, payload = {}) {
  return queueStoreMutation(async () => {
  const {
    displayName,
    role = "forked-agent",
    controller = "unknown",
    controllers,
    signers,
    walletAddress,
    multisigThreshold,
    threshold,
    authorizedBy = sourceAgentId,
  } = payload;

  if (!displayName?.trim()) {
    throw new Error("displayName is required");
  }

  const store = await loadStore();
  const source = ensureAgent(store, sourceAgentId);
  const normalizedRole = normalizeOptionalText(role) ?? "forked-agent";
  const normalizedController = normalizeOptionalText(controller) ?? source.controller;
  const normalizedWalletAddress = normalizeOptionalText(walletAddress);
  const normalizedControllers = normalizeOptionalText(controllers);
  const normalizedSigners = normalizeOptionalText(signers);
  const normalizedAuthorizedBy = normalizeOptionalText(authorizedBy) ?? sourceAgentId;
  const approvals = collectApprovalInputs({
    approvals: payload.approvals,
    approvedBy: payload.approvedBy,
    authorizedBy: normalizedAuthorizedBy,
  });
  const authorization = validateApprovals({ store, policyAgent: source, rawApprovals: approvals });
  const newAgentId = agentIdFromName(displayName);
  const identity = buildIdentityProfile({
    chainId: store.chainId,
    agentId: newAgentId,
    displayName,
    controller: normalizedController === "unknown" ? source.controller : normalizedController,
    controllers: normalizedControllers ?? normalizedSigners ?? source.identity.controllers,
    walletAddress: normalizedWalletAddress,
    threshold: multisigThreshold ?? threshold ?? source.identity.authorizationPolicy.threshold,
    originDid: source.identity.did,
  });

  const event = appendEvent(store, "agent_forked", {
    sourceAgentId,
    sourceDid: source.identity.did,
    newAgentId,
    newDid: identity.did,
    displayName,
    role: normalizedRole,
    controller: identity.controllers.map((signer) => signer.label).join(", "),
    approvals: authorization.approvals,
    threshold: identity.authorizationPolicy.threshold,
  });

  const forked = baseAgentRecord({
    agentId: newAgentId,
    displayName,
    role: normalizedRole,
    controller: identity.controllers.map((signer) => signer.label).join(", "),
    parentAgentId: source.agentId,
    createdByEventHash: event.hash,
    identity,
  });
  forked.identity.originDid = source.identity.did;
  store.agents[newAgentId] = forked;

  await writeStore(store);
  return forked;
  });
}

export async function grantAsset(targetAgentId, payload = {}) {
  return queueStoreMutation(async () => {
  const {
    fromAgentId = TREASURY_AGENT_ID,
    amount = 0,
    assetType = "credits",
    reason = "manual grant",
    authorizedBy = fromAgentId,
  } = payload;

  const normalizedFromAgentId = normalizeOptionalText(fromAgentId) ?? TREASURY_AGENT_ID;
  const normalizedAssetType = normalizeOptionalText(assetType) ?? "credits";
  const normalizedReason = normalizeOptionalText(reason) ?? "manual grant";
  const normalizedAuthorizedBy = normalizeOptionalText(authorizedBy) ?? normalizedFromAgentId;

  if (normalizedAssetType !== "credits") {
    throw new Error("Only credits are supported in this prototype");
  }

  const numericAmount = toFiniteNumber(amount, 0);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("amount must be greater than 0");
  }

  const store = await loadStore();
  const target = ensureAgent(store, targetAgentId);
  const source = ensureAgent(store, normalizedFromAgentId);
  const approvals = collectApprovalInputs({
    approvals: payload.approvals,
    approvedBy: payload.approvedBy,
    authorizedBy: normalizedAuthorizedBy,
  });
  const authorization = validateApprovals({ store, policyAgent: source, rawApprovals: approvals });

  ensureCredits(source, numericAmount);
  source.balances.credits -= numericAmount;
  target.balances.credits += numericAmount;

  const event = appendEvent(store, "asset_granted", {
    fromAgentId: normalizedFromAgentId,
    toAgentId: targetAgentId,
    assetType: normalizedAssetType,
    amount: numericAmount,
    reason: normalizedReason,
    authorization: {
      policyAgentId: source.agentId,
      policyDid: source.identity.did,
      policyType: source.identity.authorizationPolicy.type,
      threshold: source.identity.authorizationPolicy.threshold,
      approvals: authorization.approvals,
    },
  });

  await writeStore(store);
  return { event, target };
  });
}

export async function updateAgentPolicy(agentId, payload = {}) {
  return queueStoreMutation(async () => {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const nextIdentity = buildIdentityProfile({
    chainId: store.chainId,
    agentId: agent.agentId,
    displayName: agent.displayName,
    controller: normalizeOptionalText(payload.controller) ?? agent.controller,
    controllers: normalizeOptionalText(payload.controllers),
    signers: normalizeOptionalText(payload.signers),
    walletAddress: normalizeOptionalText(payload.walletAddress) ?? agent.identity.walletAddress,
    threshold: normalizeOptionalText(payload.multisigThreshold ?? payload.threshold),
    existingIdentity: agent.identity,
    preserveDid: true,
    originDid: agent.identity.originDid ?? null,
  });

  const event = appendEvent(store, "agent_policy_updated", {
    agentId,
    did: agent.identity.did,
    previousPolicy: agent.identity.authorizationPolicy,
    nextPolicy: nextIdentity.authorizationPolicy,
  });

  agent.identity = {
    ...nextIdentity,
    originDid: agent.identity.originDid ?? null,
  };
  agent.controller = nextIdentity.controllers.map((signer) => signer.label).join(", ");
  agent.createdByEventHash = agent.createdByEventHash ?? event.hash;

  await writeStore(store);
  return agent;
  });
}

function ensureAuthorizationProposal(store, proposalId) {
  const proposal = store.proposals.find((entry) => entry.proposalId === proposalId);
  if (!proposal) {
    throw new Error(`Authorization proposal not found: ${proposalId}`);
  }

  return proposal;
}

function summarizeAuthorizationExecutionResult(actionType, result) {
  if (!result) {
    return null;
  }

  if (actionType === "grant_asset") {
    return {
      eventHash: result.event?.hash ?? null,
      targetAgentId: result.target?.agentId ?? null,
      targetCredits: result.target?.balances?.credits ?? null,
    };
  }

  if (actionType === "fork_agent") {
    return {
      agentId: result.agentId ?? null,
      did: result.identity?.did ?? null,
      parentAgentId: result.parentAgentId ?? null,
    };
  }

  if (actionType === "update_policy") {
    return {
      agentId: result.agentId ?? null,
      did: result.identity?.did ?? null,
      threshold: result.identity?.authorizationPolicy?.threshold ?? null,
    };
  }

  return cloneJson(result);
}

function buildAuthorizationProposalView(store, proposal) {
  const policyAgent = ensureAgent(store, proposal.policyAgentId);
  const { policy, approvals } = summarizeApprovals({
    store,
    policyAgent,
    rawApprovals: proposal.approvals || [],
  });
  const nowIso = now();
  const nowMs = Date.now();
  const availableAt = proposal.availableAt || proposal.createdAt;
  const availableAtMs = new Date(availableAt).getTime();
  const expiresAt = proposal.expiresAt ?? null;
  const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : null;
  const baseStatus = proposal.status || "pending";
  const isTerminal = ["executed", "revoked", "failed", "executing"].includes(baseStatus);
  const isExpired = !isTerminal && expiresAtMs != null && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
  const approvalsMet = approvals.length >= policy.threshold;
  const isUnlocked = Number.isFinite(availableAtMs) ? nowMs >= availableAtMs : true;
  const createdByAgentId = normalizeOptionalText(proposal.createdByAgentId) ?? null;
  const createdByLabel = normalizeOptionalText(
    proposal.createdByLabel || proposal.createdByAgentId
  ) ?? null;
  const createdByDid = normalizeOptionalText(proposal.createdByDid || proposal.executionReceipt?.creatorDid) ?? null;
  const createdByWalletAddress =
    normalizeOptionalText(proposal.createdByWalletAddress || proposal.executionReceipt?.creatorWalletAddress)?.toLowerCase() ?? null;
  const createdByWindowId = normalizeOptionalText(proposal.createdByWindowId) ?? null;
  const executedByAgentId =
    normalizeOptionalText(proposal.executedByAgentId || proposal.executionReceipt?.executorAgentId) ?? null;
  const executedByLabel = normalizeOptionalText(
    proposal.executedByLabel || proposal.executionReceipt?.executorLabel || proposal.executedByAgentId || proposal.executedByWindowId
  ) ?? null;
  const executedByDid = normalizeOptionalText(proposal.executedByDid || proposal.executionReceipt?.executorDid) ?? null;
  const executedByWalletAddress =
    normalizeOptionalText(proposal.executedByWalletAddress || proposal.executionReceipt?.executorWalletAddress)?.toLowerCase() ?? null;
  const executedByWindowId =
    normalizeOptionalText(proposal.executedByWindowId || proposal.executionReceipt?.executorWindowId) ?? null;
  const revokedByAgentId = normalizeOptionalText(proposal.revokedByAgentId) ?? null;
  const revokedByLabel = normalizeOptionalText(
    proposal.revokedByLabel || proposal.revokedByAgentId
  ) ?? null;
  const revokedByDid = normalizeOptionalText(proposal.revokedByDid) ?? null;
  const revokedByWalletAddress =
    normalizeOptionalText(proposal.revokedByWalletAddress)?.toLowerCase() ?? null;
  const revokedByWindowId = normalizeOptionalText(proposal.revokedByWindowId) ?? null;
  const signatureRecords = normalizeProposalSignatureRecords(proposal.signatureRecords || proposal.signatures || [], {
    proposalId: proposal.proposalId,
    policyAgentId: proposal.policyAgentId,
    actionType: proposal.actionType,
    source: "proposal_view",
  });
  const latestSignatureAt =
    signatureRecords.reduce((latest, record) => {
      const recordedAtMs = new Date(record.recordedAt).getTime();
      if (!Number.isFinite(recordedAtMs)) {
        return latest;
      }

      return !latest || recordedAtMs > new Date(latest).getTime() ? record.recordedAt : latest;
    }, null) ?? null;
  const executionReceipt =
    proposal.executionReceipt ||
    (proposal.status === "executed"
      ? {
          status: "succeeded",
          executedAt: proposal.executedAt || proposal.updatedAt || proposal.createdAt,
          executorAgentId: executedByAgentId,
          executorLabel: executedByLabel,
          executorDid: executedByDid,
          executorWalletAddress: executedByWalletAddress,
          executorWindowId: executedByWindowId,
          approvalCount: approvals.length,
          threshold: policy.threshold,
          approvalSigners: signatureRecords,
          resultSummary: proposal.executionResult ?? null,
          eventHash: proposal.executionResult?.eventHash ?? null,
          source: "proposal_view",
          note: "synthesized from executed proposal",
        }
      : proposal.status === "failed"
        ? {
            status: "failed",
            executedAt: proposal.updatedAt || proposal.createdAt,
            executorAgentId: executedByAgentId,
            executorWindowId: executedByWindowId,
            approvalCount: approvals.length,
            threshold: policy.threshold,
            approvalSigners: signatureRecords,
            error: proposal.lastError ?? null,
            source: "proposal_view",
            note: "synthesized from failed proposal",
          }
      : null);
  const normalizedExecutionReceipt = executionReceipt
      ? normalizeProposalExecutionReceipt(executionReceipt, {
          proposalId: proposal.proposalId,
          policyAgentId: proposal.policyAgentId,
          actionType: proposal.actionType,
          executedAt: proposal.executedAt || proposal.updatedAt || proposal.createdAt,
          executorAgentId: executedByAgentId,
          executorLabel: executedByLabel,
          executorDid: executedByDid,
          executorWalletAddress: executedByWalletAddress,
          executorWindowId: executedByWindowId,
          approvalCount: approvals.length,
          threshold: policy.threshold,
          resultSummary: proposal.executionResult ?? null,
          eventHash: proposal.executionResult?.eventHash ?? null,
        })
    : null;
  const status =
    baseStatus === "executed" || baseStatus === "revoked" || baseStatus === "failed" || baseStatus === "executing"
      ? baseStatus
      : isExpired
        ? "expired"
          : approvalsMet && isUnlocked
          ? "ready"
          : approvalsMet
            ? "approved"
            : "pending";
  const timeline = buildAuthorizationProposalTimeline(store, {
    ...proposal,
    status,
    createdByAgentId,
    createdByLabel,
    createdByDid,
    createdByWalletAddress,
    createdByWindowId,
    executedByAgentId,
    executedByLabel,
    executedByDid,
    executedByWalletAddress,
    executedByWindowId,
    revokedByAgentId,
    revokedByLabel,
    revokedByDid,
    revokedByWalletAddress,
    revokedByWindowId,
    signatures: signatureRecords,
    signatureRecords,
    executionReceipt: normalizedExecutionReceipt,
  });

  return {
    ...cloneJson(proposal),
    status,
    createdByAgentId,
    createdByLabel,
    createdByDid,
    createdByWalletAddress,
    createdByWindowId,
    executedByAgentId,
    executedByLabel,
    executedByDid,
    executedByWalletAddress,
    executedByWindowId,
    revokedByAgentId,
    revokedByLabel,
    revokedByDid,
    revokedByWalletAddress,
    revokedByWindowId,
    lastSignedByAgentId: normalizeOptionalText(proposal.lastSignedByAgentId) ?? null,
    lastSignedByLabel: normalizeOptionalText(proposal.lastSignedByLabel) ?? null,
    lastSignedByDid: normalizeOptionalText(proposal.lastSignedByDid) ?? null,
    lastSignedByWalletAddress: normalizeOptionalText(proposal.lastSignedByWalletAddress)?.toLowerCase() ?? null,
    lastSignedWindowId: normalizeOptionalText(proposal.lastSignedWindowId) ?? null,
    signatures: signatureRecords,
    signatureRecords,
    signatureCount: signatureRecords.length,
    latestSignatureAt,
    executionReceipt: normalizedExecutionReceipt,
    executionRecord: cloneJson(normalizedExecutionReceipt),
    timeline,
    timelineCount: timeline.length,
    latestTimelineAt: timeline.at(-1)?.timestamp ?? null,
    policyAgent: {
      agentId: policyAgent.agentId,
      displayName: policyAgent.displayName,
      did: policyAgent.identity?.did,
      walletAddress: policyAgent.identity?.walletAddress,
    },
    threshold: policy.threshold,
    signerCount: policy.signers.length,
    approvalCount: approvals.length,
    approvals,
    availableAt,
    expiresAt,
    isUnlocked,
    isExpired,
    canExecute: status === "ready",
    relatedAgentIds: proposalRelatedAgentIds(proposal, store),
    ageSeconds: Math.max(0, Math.floor((nowMs - new Date(proposal.createdAt).getTime()) / 1000)),
    updatedAgeSeconds: Math.max(0, Math.floor((nowMs - new Date(proposal.updatedAt || proposal.createdAt).getTime()) / 1000)),
    policyStatus: {
      type: policy.type,
      threshold: policy.threshold,
      signerCount: policy.signers.length,
    },
  };
}

function buildAuthorizationProposalTimeline(store, proposal) {
  const proposalId = proposal?.proposalId ?? null;
  if (!proposalId) {
    return [];
  }

  const timeline = [];
  const pushEntry = (entry) => {
    timeline.push({
      timelineId: normalizeOptionalText(entry.timelineId) || createRecordId("tl"),
      proposalId,
      kind: normalizeOptionalText(entry.kind) || "event",
      timestamp: normalizeOptionalText(entry.timestamp) || proposal.createdAt || now(),
      actorAgentId: normalizeOptionalText(entry.actorAgentId) ?? null,
      actorLabel: normalizeOptionalText(entry.actorLabel) ?? null,
      actorDid: normalizeOptionalText(entry.actorDid) ?? null,
      actorWalletAddress: normalizeOptionalText(entry.actorWalletAddress)?.toLowerCase() ?? null,
      actorWindowId: normalizeOptionalText(entry.actorWindowId) ?? null,
      summary: normalizeOptionalText(entry.summary) ?? null,
      details: cloneJson(entry.details) ?? null,
      eventHash: normalizeOptionalText(entry.eventHash) ?? null,
      eventIndex: Number.isFinite(Number(entry.eventIndex)) ? Math.floor(Number(entry.eventIndex)) : null,
      order: Number.isFinite(Number(entry.order)) ? Math.floor(Number(entry.order)) : 0,
      source: normalizeOptionalText(entry.source) ?? "proposal",
    });
  };

  const createdActor = resolveActorContext(store, {
    agentId: proposal.createdByAgentId,
    did: proposal.createdByDid,
    walletAddress: proposal.createdByWalletAddress,
    label: proposal.createdByLabel,
    windowId: proposal.createdByWindowId,
    fallbackText: proposal.createdByLabel,
  });

  pushEntry({
    kind: "proposal_created",
    timestamp: proposal.createdAt,
    actorAgentId: createdActor.agentId,
    actorLabel: createdActor.label,
    actorDid: createdActor.did,
    actorWalletAddress: createdActor.walletAddress,
    actorWindowId: createdActor.windowId,
    summary: `提案创建：${proposal.title || proposal.proposalId}`,
    details: {
      title: proposal.title,
      description: proposal.description,
      policyAgentId: proposal.policyAgentId,
      actionType: proposal.actionType,
      availableAt: proposal.availableAt,
      expiresAt: proposal.expiresAt,
    },
    source: "proposal_view",
    order: 10,
  });

  const signatureRecords = Array.isArray(proposal.signatureRecords) ? proposal.signatureRecords : [];
  signatureRecords.forEach((record, index) => {
    const actor = resolveActorContext(store, {
      agentId: record?.recordedByAgentId,
      did: record?.recordedByDid,
      walletAddress: record?.recordedByWalletAddress,
      label: record?.recordedByLabel || record?.signerLabel,
      windowId: record?.recordedByWindowId,
      fallbackText: record?.recordedByLabel || record?.signerLabel || record?.approval,
    });

    pushEntry({
      kind: "proposal_signature",
      timestamp: record?.recordedAt,
      actorAgentId: actor.agentId,
      actorLabel: actor.label,
      actorDid: actor.did,
      actorWalletAddress: actor.walletAddress,
      actorWindowId: actor.windowId,
      summary: `签名：${record?.signerLabel || record?.approval || record?.signerWalletAddress || "signer"}`,
      details: {
        signatureId: record?.signatureId ?? null,
        signerLabel: record?.signerLabel ?? null,
        signerWalletAddress: record?.signerWalletAddress ?? null,
        approval: record?.approval ?? null,
        recordedByAgentId: record?.recordedByAgentId ?? null,
        recordedByLabel: record?.recordedByLabel ?? null,
        recordedByWindowId: record?.recordedByWindowId ?? null,
        source: record?.source ?? null,
        note: record?.note ?? null,
      },
      source: "signature_record",
      order: 20 + index,
    });
  });

  const relevantEvents = Array.isArray(store?.events)
    ? store.events.filter((event) => event?.payload?.proposalId === proposalId && typeof event.type === "string")
    : [];
  const eventKinds = new Set(relevantEvents.map((event) => event.type));

  for (const event of relevantEvents) {
    const payload = event.payload || {};

    if (event.type === "authorization_proposal_created" || event.type === "authorization_proposal_signed") {
      continue;
    }

    if (event.type === "authorization_proposal_executing") {
      const actor = resolveActorContext(store, {
        agentId: payload.executedByAgentId,
        label: payload.executedByLabel,
        windowId: payload.executedByWindowId,
        fallbackText: payload.executedByAgentId || payload.executedByWindowId,
      });

      pushEntry({
        kind: "proposal_executing",
        timestamp: event.timestamp,
        actorAgentId: actor.agentId,
        actorLabel: actor.label,
        actorDid: actor.did,
        actorWalletAddress: actor.walletAddress,
        actorWindowId: actor.windowId,
        summary: "执行中",
        details: {
          approvalCount: payload.approvalCount ?? null,
          signatureCount: payload.signatureCount ?? null,
          addedSignatures: payload.addedSignatures ?? [],
        },
        eventHash: event.hash,
        eventIndex: event.index,
        source: "ledger_event",
        order: 30,
      });
      continue;
    }

    if (event.type === "authorization_proposal_executed") {
      const actor = resolveActorContext(store, {
        agentId: payload.executedByAgentId,
        label: payload.executedByLabel,
        windowId: payload.executedByWindowId,
        fallbackText: payload.executedByAgentId || payload.executedByWindowId,
      });

      pushEntry({
        kind: "proposal_executed",
        timestamp: event.timestamp,
        actorAgentId: actor.agentId,
        actorLabel: actor.label,
        actorDid: actor.did,
        actorWalletAddress: actor.walletAddress,
        actorWindowId: actor.windowId,
        summary: "执行完成",
        details: {
          approvalCount: payload.approvalCount ?? null,
          signatureCount: payload.signatureCount ?? null,
          executionReceipt: payload.executionReceipt ?? null,
          executionResult: payload.executionResult ?? null,
        },
        eventHash: event.hash,
        eventIndex: event.index,
        source: "ledger_event",
        order: 40,
      });
      continue;
    }

    if (event.type === "authorization_proposal_failed") {
      const actor = resolveActorContext(store, {
        agentId: payload.executedByAgentId,
        label: payload.executedByLabel,
        windowId: payload.executedByWindowId,
        fallbackText: payload.executedByAgentId || payload.executedByWindowId,
      });

      pushEntry({
        kind: "proposal_failed",
        timestamp: event.timestamp,
        actorAgentId: actor.agentId,
        actorLabel: actor.label,
        actorDid: actor.did,
        actorWalletAddress: actor.walletAddress,
        actorWindowId: actor.windowId,
        summary: "执行失败",
        details: {
          approvalCount: payload.approvalCount ?? null,
          signatureCount: payload.signatureCount ?? null,
          executionReceipt: payload.executionReceipt ?? null,
          error: payload.error ?? null,
        },
        eventHash: event.hash,
        eventIndex: event.index,
        source: "ledger_event",
        order: 50,
      });
      continue;
    }

    if (event.type === "authorization_proposal_revoked") {
      const actor = resolveActorContext(store, {
        agentId: payload.revokedByAgentId,
        label: payload.revokedByLabel,
        windowId: payload.revokedByWindowId,
        fallbackText: payload.revokedByAgentId || payload.revokedByWindowId,
      });

      pushEntry({
        kind: "proposal_revoked",
        timestamp: event.timestamp,
        actorAgentId: actor.agentId,
        actorLabel: actor.label,
        actorDid: actor.did,
        actorWalletAddress: actor.walletAddress,
        actorWindowId: actor.windowId,
        summary: "提案撤销",
        details: {
          approvalCount: payload.approvalCount ?? null,
          signatureCount: payload.signatureCount ?? null,
        },
        eventHash: event.hash,
        eventIndex: event.index,
        source: "ledger_event",
        order: 60,
      });
    }
  }

  if (proposal.status === "executed" && !eventKinds.has("authorization_proposal_executed")) {
    pushEntry({
      kind: "proposal_executed",
      timestamp: proposal.executedAt || proposal.updatedAt || proposal.createdAt,
      actorAgentId: proposal.executedByAgentId ?? null,
      actorLabel: proposal.executedByLabel ?? null,
      actorDid: proposal.executedByDid ?? null,
      actorWalletAddress: proposal.executedByWalletAddress ?? null,
      actorWindowId: proposal.executedByWindowId ?? null,
      summary: "执行完成",
      details: {
        executionReceipt: proposal.executionReceipt ?? null,
        executionResult: proposal.executionResult ?? null,
      },
      source: "proposal_view",
      order: 41,
    });
  }

  if (proposal.status === "failed" && !eventKinds.has("authorization_proposal_failed")) {
    pushEntry({
      kind: "proposal_failed",
      timestamp: proposal.updatedAt || proposal.createdAt,
      actorAgentId: proposal.executedByAgentId ?? null,
      actorLabel: proposal.executedByLabel ?? null,
      actorDid: proposal.executedByDid ?? null,
      actorWalletAddress: proposal.executedByWalletAddress ?? null,
      actorWindowId: proposal.executedByWindowId ?? null,
      summary: "执行失败",
      details: {
        executionReceipt: proposal.executionReceipt ?? null,
        error: proposal.lastError ?? null,
      },
      source: "proposal_view",
      order: 51,
    });
  }

  if (proposal.status === "revoked" && !eventKinds.has("authorization_proposal_revoked")) {
    pushEntry({
      kind: "proposal_revoked",
      timestamp: proposal.revokedAt || proposal.updatedAt || proposal.createdAt,
      actorAgentId: proposal.revokedByAgentId ?? null,
      actorLabel: proposal.revokedByLabel ?? null,
      actorDid: proposal.revokedByDid ?? null,
      actorWalletAddress: proposal.revokedByWalletAddress ?? null,
      actorWindowId: proposal.revokedByWindowId ?? null,
      summary: "提案撤销",
      details: null,
      source: "proposal_view",
      order: 61,
    });
  }

  return timeline
    .sort((a, b) => {
      const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }

      const orderDiff = (a.order ?? 0) - (b.order ?? 0);
      if (orderDiff !== 0) {
        return orderDiff;
      }

      const indexA = a.eventIndex ?? Number.POSITIVE_INFINITY;
      const indexB = b.eventIndex ?? Number.POSITIVE_INFINITY;
      if (indexA !== indexB) {
        return indexA - indexB;
      }

      return a.timelineId.localeCompare(b.timelineId);
    })
    .map(({ order, ...entry }) => entry);
}

function runAuthorizationProposalAction(proposal, executionApprovals = []) {
  const payload = {
    ...(cloneJson(proposal.payload) ?? {}),
    approvals: mergeRawApprovalInputs(proposal.approvals, executionApprovals),
    authorizedBy: proposal.payload?.authorizedBy ?? proposal.policyAgentId,
    approvedBy: proposal.payload?.approvedBy ?? proposal.policyAgentId,
  };

  if (proposal.actionType === "grant_asset") {
    const targetAgentId = normalizeOptionalText(payload.targetAgentId ?? payload.toAgentId);
    if (!targetAgentId) {
      throw new Error("grant_asset proposal payload requires targetAgentId or toAgentId");
    }
    return grantAsset(targetAgentId, payload);
  }

  if (proposal.actionType === "fork_agent") {
    const sourceAgentId = normalizeOptionalText(payload.sourceAgentId);
    if (!sourceAgentId) {
      throw new Error("fork_agent proposal payload requires sourceAgentId");
    }
    return forkAgent(sourceAgentId, payload);
  }

  if (proposal.actionType === "update_policy") {
    const agentId = normalizeOptionalText(payload.agentId);
    if (!agentId) {
      throw new Error("update_policy proposal payload requires agentId");
    }
    return updateAgentPolicy(agentId, payload);
  }

  throw new Error(`Unsupported authorization actionType: ${proposal.actionType}`);
}

function validateProposalCanSign(proposalView) {
  if (["executed", "revoked", "expired", "failed", "executing"].includes(proposalView.status)) {
    throw new Error(`Authorization proposal cannot be signed in state: ${proposalView.status}`);
  }
}

function validateProposalCanExecute(proposalView) {
  if (proposalView.status === "executed") {
    throw new Error(`Authorization proposal already executed: ${proposalView.proposalId}`);
  }

  if (proposalView.status === "revoked") {
    throw new Error(`Authorization proposal already revoked: ${proposalView.proposalId}`);
  }

  if (proposalView.status === "expired") {
    throw new Error(`Authorization proposal expired: ${proposalView.proposalId}`);
  }

  if (proposalView.status === "failed") {
    throw new Error(`Authorization proposal previously failed: ${proposalView.proposalId}`);
  }

  if (!proposalView.canExecute) {
    throw new Error(
      `Authorization proposal not ready: requires ${proposalView.threshold} approvals and release at ${proposalView.availableAt}`
    );
  }
}

export async function createAuthorizationProposal(payload = {}) {
  return queueStoreMutation(async () => {
  const {
    policyAgentId,
    actionType,
    title,
    description,
    payload: proposalPayload = {},
    approvals,
    approvedBy,
    authorizedBy,
    createdBy,
    createdByLabel,
    createdByAgentId,
    createdByDid,
    createdByWalletAddress,
    createdByWindowId,
    sourceWindowId,
    delaySeconds = DEFAULT_AUTHORIZATION_DELAY_SECONDS,
    expiresInSeconds = DEFAULT_AUTHORIZATION_TTL_SECONDS,
  } = payload;

  const store = await loadStore();
  const policyAgent = ensureAgent(store, policyAgentId);
  const canonicalActionType = normalizeAuthorizationActionType(actionType);
  const nowIso = now();
  const creationActor = resolveActorContext(store, {
    agentId: createdByAgentId,
    did: createdByDid,
    walletAddress: createdByWalletAddress,
    label: createdByLabel,
    windowId: createdByWindowId,
    fallbackText: createdByLabel,
  });
  const normalizedProposalPayload = cloneJson(proposalPayload);
  if (!normalizedProposalPayload || typeof normalizedProposalPayload !== "object" || Array.isArray(normalizedProposalPayload)) {
    throw new Error("payload must be an object");
  }
  const initialApprovals = mergeRawApprovalInputs(
    [],
    collectApprovalInputs({
      approvals,
      approvedBy,
      authorizedBy,
    })
  );
  const initialApprovalSummary = summarizeApprovals({
    store,
    policyAgent,
    rawApprovals: initialApprovals,
  });
  const proposal = {
    proposalId: createRecordId("prop"),
    policyAgentId: policyAgent.agentId,
    actionType: canonicalActionType,
    title: normalizeOptionalText(title) ?? `${canonicalActionType} proposal`,
    description: normalizeOptionalText(description) ?? null,
    payload: normalizedProposalPayload,
    approvals: [],
    signatureRecords: [],
    status: "pending",
    createdAt: nowIso,
    updatedAt: nowIso,
    createdByAgentId: creationActor.agentId,
    createdByLabel: creationActor.label,
    createdByDid: creationActor.did,
    createdByWalletAddress: creationActor.walletAddress,
    createdByWindowId: creationActor.windowId,
    availableAt: addSeconds(nowIso, delaySeconds),
    expiresAt:
      expiresInSeconds === null || expiresInSeconds === undefined
        ? null
        : Number.isFinite(Number(expiresInSeconds)) && Number(expiresInSeconds) > 0
          ? addSeconds(nowIso, expiresInSeconds)
          : null,
    createdBy: normalizeOptionalText(createdBy) ?? null,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
    executedAt: null,
    revokedAt: null,
    executionResult: null,
    lastError: null,
  };

  appendProposalSignatureRecords(proposal, initialApprovalSummary.approvals, {
    recordedByAgentId: creationActor.agentId ?? policyAgent.agentId,
    recordedByLabel: creationActor.label,
    recordedByDid: creationActor.did,
    recordedByWalletAddress: creationActor.walletAddress,
    recordedByWindowId: creationActor.windowId,
    source: "proposal_create",
    note: normalizeOptionalText(description) ?? null,
    recordedAt: nowIso,
  });

  const view = buildAuthorizationProposalView(store, proposal);
  proposal.status = view.status;
  store.proposals.push(proposal);

  appendEvent(store, "authorization_proposal_created", {
    proposalId: proposal.proposalId,
    policyAgentId: proposal.policyAgentId,
    actionType: proposal.actionType,
    title: proposal.title,
    status: proposal.status,
    approvalCount: view.approvalCount,
    signatureCount: view.signatureCount,
    latestSignatureAt: view.latestSignatureAt,
    threshold: view.threshold,
    availableAt: proposal.availableAt,
    expiresAt: proposal.expiresAt,
    createdByAgentId: proposal.createdByAgentId,
    createdByLabel: proposal.createdByLabel,
    createdByDid: proposal.createdByDid,
    createdByWalletAddress: proposal.createdByWalletAddress,
    createdByWindowId: proposal.createdByWindowId,
  });

  await writeStore(store);
  return buildAuthorizationProposalView(store, proposal);
  });
}

export async function listAuthorizationProposals({ agentId = null, limit = DEFAULT_AUTHORIZATION_LIMIT } = {}) {
  const store = await loadStore();
  return listAuthorizationProposalViews(store, { agentId, limit });
}

export async function getAuthorizationProposal(proposalId) {
  const store = await loadStore();
  const proposal = ensureAuthorizationProposal(store, proposalId);
  return buildAuthorizationProposalView(store, proposal);
}

export async function signAuthorizationProposal(proposalId, payload = {}) {
  return queueStoreMutation(async () => {
  const store = await loadStore();
  const proposal = ensureAuthorizationProposal(store, proposalId);
  const currentView = buildAuthorizationProposalView(store, proposal);
  validateProposalCanSign(currentView);
  const nowIso = now();
  const recordedByWindowId =
    normalizeOptionalText(payload.recordedByWindowId || payload.signedWindowId) ?? null;
  const recordedBy = resolveActorContext(store, {
    agentId: payload.recordedByAgentId,
    did: payload.recordedByDid,
    walletAddress: payload.recordedByWalletAddress,
    label: payload.recordedByLabel,
    windowId: recordedByWindowId,
    fallbackText: payload.recordedByLabel,
  });
  const note = normalizeOptionalText(payload.note) ?? null;

  const incomingApprovals = collectApprovalInputs({
    approvals: payload.approvals,
    approvedBy: payload.approvedBy,
    authorizedBy: payload.authorizedBy,
  });
  proposal.approvals = mergeRawApprovalInputs(proposal.approvals, incomingApprovals);
  const approvalSummary = summarizeApprovals({
    store,
    policyAgent: ensureAgent(store, proposal.policyAgentId),
    rawApprovals: proposal.approvals,
  });
  const addedSignatures = appendProposalSignatureRecords(proposal, approvalSummary.approvals, {
    recordedByAgentId: recordedBy.agentId,
    recordedByLabel: recordedBy.label,
    recordedByDid: recordedBy.did,
    recordedByWalletAddress: recordedBy.walletAddress,
    recordedByWindowId: recordedBy.windowId,
    source: "proposal_sign",
    note,
    recordedAt: nowIso,
  });
  proposal.updatedAt = nowIso;
  proposal.lastError = null;
  proposal.lastSignedAt = nowIso;
  proposal.lastSignedByAgentId = recordedBy.agentId;
  proposal.lastSignedByLabel = recordedBy.label;
  proposal.lastSignedByDid = recordedBy.did;
  proposal.lastSignedByWalletAddress = recordedBy.walletAddress;
  proposal.lastSignedWindowId = recordedBy.windowId;
  const nextView = buildAuthorizationProposalView(store, proposal);
  proposal.status = nextView.status;

  appendEvent(store, "authorization_proposal_signed", {
    proposalId: proposal.proposalId,
    policyAgentId: proposal.policyAgentId,
    actionType: proposal.actionType,
    approvalCount: nextView.approvalCount,
    signatureCount: nextView.signatureCount,
    threshold: nextView.threshold,
    status: proposal.status,
    lastSignedAt: nextView.latestSignatureAt || nowIso,
    signedByAgentId: recordedBy.agentId,
    signedByLabel: recordedBy.label,
    signedByDid: recordedBy.did,
    signedByWalletAddress: recordedBy.walletAddress,
    signedWindowId: recordedBy.windowId,
    addedSignatures: addedSignatures.map((record) => ({
      signatureId: record.signatureId,
      signerLabel: record.signerLabel,
      signerWalletAddress: record.signerWalletAddress,
    })),
  });

  await writeStore(store);
  return buildAuthorizationProposalView(store, proposal);
  });
}

export async function executeAuthorizationProposal(proposalId, payload = {}) {
  return queueStoreMutation(async () => {
  const store = await loadStore();
  const proposal = ensureAuthorizationProposal(store, proposalId);
  const executionApprovals = collectApprovalInputs({
    approvals: payload.approvals,
    approvedBy: payload.approvedBy,
    authorizedBy: payload.authorizedBy,
  });
  const executedByWindowId = normalizeOptionalText(
    payload.executedByWindowId || payload.executedWindowId
  ) ?? null;
  const executedBy = resolveActorContext(store, {
    agentId: payload.executedByAgentId,
    did: payload.executedByDid,
    walletAddress: payload.executedByWalletAddress,
    label: payload.executedByLabel,
    windowId: executedByWindowId,
    fallbackText: payload.executedByLabel,
  });
  const note = normalizeOptionalText(payload.note) ?? null;

  if (executionApprovals.length > 0) {
    proposal.approvals = mergeRawApprovalInputs(proposal.approvals, executionApprovals);
    proposal.updatedAt = now();
  }

  const currentView = buildAuthorizationProposalView(store, proposal);
  validateProposalCanExecute(currentView);

  const nowIso = now();
  const executionSummary = summarizeApprovals({
    store,
    policyAgent: ensureAgent(store, proposal.policyAgentId),
    rawApprovals: proposal.approvals,
  });
  const addedSignatures = appendProposalSignatureRecords(proposal, executionSummary.approvals, {
    recordedByAgentId: executedBy.agentId,
    recordedByLabel: executedBy.label,
    recordedByDid: executedBy.did,
    recordedByWalletAddress: executedBy.walletAddress,
    recordedByWindowId: executedBy.windowId,
    source: "proposal_execute",
    note,
    recordedAt: nowIso,
  });

  proposal.status = "executing";
  proposal.updatedAt = nowIso;
  proposal.executedByAgentId = executedBy.agentId;
  proposal.executedByLabel = executedBy.label;
  proposal.executedByDid = executedBy.did;
  proposal.executedByWalletAddress = executedBy.walletAddress;
  proposal.executedByWindowId = executedBy.windowId;
  proposal.lastError = null;
  const executionView = buildAuthorizationProposalView(store, proposal);
  appendEvent(store, "authorization_proposal_executing", {
    proposalId: proposal.proposalId,
    policyAgentId: proposal.policyAgentId,
    actionType: proposal.actionType,
    approvalCount: executionView.approvalCount,
    signatureCount: executionView.signatureCount,
    executedByAgentId: executedBy.agentId,
    executedByLabel: executedBy.label,
    executedByDid: executedBy.did,
    executedByWalletAddress: executedBy.walletAddress,
    executedByWindowId: executedBy.windowId,
    addedSignatures: addedSignatures.map((record) => ({
      signatureId: record.signatureId,
      signerLabel: record.signerLabel,
      signerWalletAddress: record.signerWalletAddress,
    })),
  });
  await writeStore(store);

  try {
    const result = await runAuthorizationProposalAction(proposal, executionApprovals);
    const latestStore = await loadStore();
    const latestProposal = ensureAuthorizationProposal(latestStore, proposalId);
    latestProposal.status = "executed";
    latestProposal.executedAt = now();
    latestProposal.updatedAt = latestProposal.executedAt;
    latestProposal.executedByAgentId = executedBy.agentId;
    latestProposal.executedByLabel = executedBy.label;
    latestProposal.executedByDid = executedBy.did;
    latestProposal.executedByWalletAddress = executedBy.walletAddress;
    latestProposal.executedByWindowId = executedBy.windowId;
    latestProposal.executionResult = summarizeAuthorizationExecutionResult(proposal.actionType, result);
    latestProposal.executionReceipt = normalizeProposalExecutionReceipt(
      {
        status: "succeeded",
        executedAt: latestProposal.executedAt,
        executorAgentId: executedBy.agentId,
        executorLabel: executedBy.label,
        executorDid: executedBy.did,
        executorWalletAddress: executedBy.walletAddress,
        executorWindowId: executedBy.windowId,
        approvalCount: executionView.approvalCount,
        threshold: executionView.threshold,
        approvalSigners: executionView.signatures,
        resultSummary: latestProposal.executionResult,
        eventHash: latestProposal.executionResult?.eventHash ?? null,
        source: "proposal_execute",
        note,
      },
      {
        proposalId: latestProposal.proposalId,
        policyAgentId: latestProposal.policyAgentId,
        actionType: latestProposal.actionType,
        executedAt: latestProposal.executedAt,
        executorAgentId: executedBy.agentId,
        executorLabel: executedBy.label,
        executorDid: executedBy.did,
        executorWalletAddress: executedBy.walletAddress,
        executorWindowId: executedBy.windowId,
        approvalCount: executionView.approvalCount,
        threshold: executionView.threshold,
        resultSummary: latestProposal.executionResult,
        eventHash: latestProposal.executionResult?.eventHash ?? null,
        source: "proposal_execute",
        note,
      }
    );
    latestProposal.lastError = null;

    appendEvent(latestStore, "authorization_proposal_executed", {
      proposalId: latestProposal.proposalId,
      policyAgentId: latestProposal.policyAgentId,
      actionType: latestProposal.actionType,
      approvalCount: executionView.approvalCount,
      signatureCount: executionView.signatureCount,
      executedByAgentId: executedBy.agentId,
      executedByLabel: executedBy.label,
      executedByDid: executedBy.did,
      executedByWalletAddress: executedBy.walletAddress,
      executedByWindowId: executedBy.windowId,
      executionReceipt: latestProposal.executionReceipt,
      executionResult: latestProposal.executionResult,
    });

    await writeStore(latestStore);
    return {
      proposal: buildAuthorizationProposalView(latestStore, latestProposal),
      result,
    };
  } catch (error) {
    const failedStore = await loadStore();
    const failedProposal = ensureAuthorizationProposal(failedStore, proposalId);
    failedProposal.status = "failed";
    failedProposal.updatedAt = now();
    failedProposal.executedByAgentId = executedBy.agentId;
    failedProposal.executedByLabel = executedBy.label;
    failedProposal.executedByDid = executedBy.did;
    failedProposal.executedByWalletAddress = executedBy.walletAddress;
    failedProposal.executedByWindowId = executedBy.windowId;
    failedProposal.lastError = error.message;
    const failedView = buildAuthorizationProposalView(failedStore, failedProposal);
    failedProposal.executionReceipt = normalizeProposalExecutionReceipt(
      {
        status: "failed",
        executedAt: failedProposal.updatedAt,
        executorAgentId: executedBy.agentId,
        executorLabel: executedBy.label,
        executorDid: executedBy.did,
        executorWalletAddress: executedBy.walletAddress,
        executorWindowId: executedByWindowId,
        approvalCount: failedView.approvalCount,
        threshold: failedView.threshold,
        approvalSigners: failedView.signatures,
        error: error.message,
        source: "proposal_execute",
        note: "execution failed",
      },
      {
        proposalId: failedProposal.proposalId,
        policyAgentId: failedProposal.policyAgentId,
        actionType: failedProposal.actionType,
        executedAt: failedProposal.updatedAt,
        executorAgentId: executedBy.agentId,
        executorLabel: executedBy.label,
        executorDid: executedBy.did,
        executorWalletAddress: executedBy.walletAddress,
        executorWindowId: executedByWindowId,
        approvalCount: failedView.approvalCount,
        threshold: failedView.threshold,
        error: error.message,
        source: "proposal_execute",
        note: "execution failed",
      }
    );

    appendEvent(failedStore, "authorization_proposal_failed", {
      proposalId: failedProposal.proposalId,
      policyAgentId: failedProposal.policyAgentId,
      actionType: failedProposal.actionType,
      approvalCount: failedView.approvalCount,
      signatureCount: failedView.signatureCount,
      executedByAgentId: executedBy.agentId,
      executedByLabel: executedBy.label,
      executedByDid: executedBy.did,
      executedByWalletAddress: executedBy.walletAddress,
      executedByWindowId: executedByWindowId,
      executionReceipt: failedProposal.executionReceipt,
      error: error.message,
    });

    await writeStore(failedStore);
    throw error;
  }
  });
}

export async function revokeAuthorizationProposal(proposalId, payload = {}) {
  return queueStoreMutation(async () => {
  const store = await loadStore();
  const proposal = ensureAuthorizationProposal(store, proposalId);
  const currentView = buildAuthorizationProposalView(store, proposal);
  const revokedByWindowId = normalizeOptionalText(payload.revokedByWindowId) ?? null;
  const revokedBy = resolveActorContext(store, {
    agentId: payload.revokedByAgentId,
    did: payload.revokedByDid,
    walletAddress: payload.revokedByWalletAddress,
    label: payload.revokedByLabel,
    windowId: revokedByWindowId,
    fallbackText: payload.revokedByLabel,
  });

  if (["executed", "revoked", "failed", "executing"].includes(currentView.status)) {
    throw new Error(`Authorization proposal cannot be revoked in state: ${currentView.status}`);
  }

  const approvals = collectApprovalInputs({
    approvals: payload.approvals,
    approvedBy: payload.approvedBy,
    authorizedBy: payload.authorizedBy,
  });
  if (approvals.length > 0) {
    proposal.approvals = mergeRawApprovalInputs(proposal.approvals, approvals);
  }

  const updatedView = buildAuthorizationProposalView(store, proposal);
  if (updatedView.approvalCount < updatedView.threshold) {
    throw new Error(`Revoke requires the proposal policy threshold for ${proposal.proposalId}`);
  }

  proposal.status = "revoked";
  proposal.revokedAt = now();
  proposal.updatedAt = proposal.revokedAt;
  proposal.revokedByAgentId = revokedBy.agentId;
  proposal.revokedByLabel = revokedBy.label;
  proposal.revokedByDid = revokedBy.did;
  proposal.revokedByWalletAddress = revokedBy.walletAddress;
  proposal.revokedByWindowId = revokedBy.windowId;
  proposal.lastError = null;

  appendEvent(store, "authorization_proposal_revoked", {
    proposalId: proposal.proposalId,
    policyAgentId: proposal.policyAgentId,
    actionType: proposal.actionType,
    approvalCount: updatedView.approvalCount,
    signatureCount: updatedView.signatureCount,
    revokedByAgentId: revokedBy.agentId,
    revokedByLabel: revokedBy.label,
    revokedByDid: revokedBy.did,
    revokedByWalletAddress: revokedBy.walletAddress,
    revokedByWindowId: revokedBy.windowId,
  });

  await writeStore(store);
  return buildAuthorizationProposalView(store, proposal);
  });
}

export async function listAuthorizationProposalsByAgent(agentId, limit = DEFAULT_AUTHORIZATION_LIMIT) {
  const store = await loadStore();
  return listAuthorizationProposalViews(store, { agentId, limit });
}

export async function getAgentAuthorizations(agentId, limit = DEFAULT_AUTHORIZATION_LIMIT) {
  return listAuthorizationProposalsByAgent(agentId, limit);
}

export async function getAgentCredential(agentId, { didMethod = null, issueBothMethods = false, persist = true } = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const { result, createdAny, commitCache } = exportAgentCredentialInStore(store, agentId, {
      didMethod,
      issueBothMethods,
      persist,
    });
    if (createdAny) {
      await writeStore(store);
    }
    commitCache?.();
    return result;
  });
}

export async function getAuthorizationProposalTimeline(proposalId) {
  const store = await loadStore();
  const proposal = ensureAuthorizationProposal(store, proposalId);
  const authorization = buildAuthorizationProposalView(store, proposal);
  return {
    proposalId: authorization.proposalId,
    authorization,
    timeline: authorization.timeline,
    timelineCount: authorization.timelineCount,
    latestTimelineAt: authorization.latestTimelineAt,
  };
}

export async function getAuthorizationProposalCredential(proposalId, { didMethod = null, issueBothMethods = false, persist = true } = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const { result, createdAny } = exportAuthorizationProposalCredentialInStore(store, proposalId, {
      didMethod,
      issueBothMethods,
      persist,
    });
    if (createdAny) {
      await writeStore(store);
    }
    return result;
  });
}

export async function listCredentials({
  agentId = null,
  proposalId = null,
  kind = null,
  status = null,
  limit = DEFAULT_CREDENTIAL_LIMIT,
  didMethod = null,
  issuerDid = null,
  issuerAgentId = null,
  repaired = undefined,
  repairId = null,
  sortBy = null,
  sortOrder = "desc",
  repairLimit = 6,
  repairOffset = 0,
  repairSortBy = "latestIssuedAt",
  repairSortOrder = "desc",
} = {}) {
  return listCredentialsApi(buildLedgerRecordsDeps(), {
    agentId,
    proposalId,
    kind,
    status,
    limit,
    didMethod,
    issuerDid,
    issuerAgentId,
    repaired,
    repairId,
    sortBy,
    sortOrder,
    repairLimit,
    repairOffset,
    repairSortBy,
    repairSortOrder,
  });
}

export async function getCredential(credentialId) {
  return getCredentialApi(buildLedgerRecordsDeps(), credentialId);
}

export async function getCredentialTimeline(credentialId) {
  return getCredentialTimelineApi(buildLedgerRecordsDeps(), credentialId);
}

function summarizeCredentialTimelineTiming(record, repairHistory = []) {
  return summarizeCredentialTimelineTimingWithDeps(buildLedgerRecordsDeps(), record, repairHistory);
}

function listMigrationRepairViews(store, options = {}) {
  return listMigrationRepairViewsWithDeps(buildLedgerRecordsDeps(), store, options);
}

function listCredentialRepairHistory(store, record, { didMethod = null, limit = 10, detailed = false } = {}) {
  return listCredentialRepairHistoryWithCache(buildLedgerRecordsDeps(), store, record, {
    didMethod,
    limit,
    detailed,
  });
}

export async function getMigrationRepair(repairId, { didMethod = null } = {}) {
  return getMigrationRepairApi(buildLedgerRecordsDeps(), repairId, { didMethod });
}

export async function getMigrationRepairTimeline(repairId, { didMethod = null } = {}) {
  return getMigrationRepairTimelineApi(buildLedgerRecordsDeps(), repairId, { didMethod });
}

export async function getMigrationRepairCredentials(
  repairId,
  { didMethod = null, limit = 20, offset = 0, sortBy = "latestRepairAt", sortOrder = "desc" } = {}
) {
  return getMigrationRepairCredentialsApi(buildLedgerRecordsDeps(), repairId, {
    didMethod,
    limit,
    offset,
    sortBy,
    sortOrder,
  });
}

export async function listMigrationRepairs({
  agentId = null,
  comparisonSubjectId = null,
  comparisonDigest = null,
  issuerAgentId = null,
  scope = null,
  didMethod = null,
  limit = 10,
  offset = 0,
  sortBy = "latestIssuedAt",
  sortOrder = "desc",
} = {}) {
  return listMigrationRepairsApi(buildLedgerRecordsDeps(), {
    agentId,
    comparisonSubjectId,
    comparisonDigest,
    issuerAgentId,
    scope,
    didMethod,
    limit,
    offset,
    sortBy,
    sortOrder,
  });
}

export async function listCredentialStatusLists({ issuerDid = null, issuerAgentId = null } = {}) {
  return listCredentialStatusListsApi(buildLedgerRecordsDeps(), { issuerDid, issuerAgentId });
}

export async function compareCredentialStatusLists({
  leftStatusListId = null,
  rightStatusListId = null,
  leftIssuerDid = null,
  rightIssuerDid = null,
  leftIssuerAgentId = null,
  rightIssuerAgentId = null,
} = {}) {
  return compareCredentialStatusListsApi(buildLedgerRecordsDeps(), {
    leftStatusListId,
    rightStatusListId,
    leftIssuerDid,
    rightIssuerDid,
    leftIssuerAgentId,
    rightIssuerAgentId,
  });
}

export async function getCredentialStatusList(statusListId = null) {
  return getCredentialStatusListApi(buildLedgerRecordsDeps(), statusListId);
}

export async function getCredentialStatus(credentialId) {
  return getCredentialStatusApi(buildLedgerRecordsDeps(), credentialId);
}

export async function revokeCredential(credentialId, payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const result = revokeCredentialInStore(store, credentialId, payload);
    await writeStore(store);
    return result;
  });
}

export async function verifyCredential(credential = null) {
  const store = await loadStore();
  return verifyCredentialInStore(store, credential);
}

function listAgentPassportMemories(store, agentId, { layer = null, kind = null } = {}) {
  const normalizedLayer = layer ? normalizePassportMemoryLayer(layer) : null;
  const normalizedKind = kind ? normalizeOptionalText(kind) : null;
  const cacheKey = hashJson({
    kind: "passport_memory_list",
    agentId,
    layer: normalizedLayer,
    memoryKind: normalizedKind,
    total: (store.passportMemories || []).length,
    lastPassportMemoryId: store.passportMemories?.at(-1)?.passportMemoryId ?? null,
    lastEventHash: store.lastEventHash ?? null,
  });
  const cached = getCachedPassportMemoryList(cacheKey);
  if (cached) {
    return cached;
  }
  const records = (store.passportMemories || [])
    .filter((entry) => matchesCompatibleAgentId(store, entry.agentId, agentId))
    .filter((entry) => (normalizedLayer ? entry.layer === normalizedLayer : true))
    .filter((entry) => (normalizedKind ? entry.kind === normalizedKind : true))
    .sort((a, b) => (a.recordedAt || "").localeCompare(b.recordedAt || ""));
  setCachedPassportMemoryList(cacheKey, records);
  return records;
}

function buildPassportMemoryConflictKey(entry) {
  const field = normalizeOptionalText(entry?.payload?.field) ?? null;
  if (!field) {
    return null;
  }
  return `${normalizePassportMemoryLayer(entry?.layer)}:${field}`;
}

function applyPassportMemoryConflictTracking(store, agentId, record) {
  const conflictKey = buildPassportMemoryConflictKey(record);
  if (!conflictKey) {
    return null;
  }

  const nextValue = extractPassportMemoryComparableValue(record);
  const conflictingEntries = (store.passportMemories || []).filter((entry) => {
    if (entry.agentId !== agentId || !isPassportMemoryActive(entry)) {
      return false;
    }
    if (buildPassportMemoryConflictKey(entry) !== conflictKey) {
      return false;
    }
    return extractPassportMemoryComparableValue(entry) !== nextValue;
  });

  if (!conflictingEntries.length) {
    return null;
  }

  if (!Array.isArray(store.memoryConflicts)) {
    store.memoryConflicts = [];
  }

  const conflict = {
    conflictId: createRecordId("mconf"),
    agentId,
    conflictKey,
    layer: record.layer,
    field: normalizeOptionalText(record.payload?.field) ?? null,
    incomingMemoryId: record.passportMemoryId,
    conflictingMemoryIds: conflictingEntries.map((entry) => entry.passportMemoryId),
    previousValues: conflictingEntries.map((entry) => ({
      passportMemoryId: entry.passportMemoryId,
      summary: entry.summary || null,
      value: entry.payload?.value ?? entry.content ?? entry.summary ?? null,
      recordedAt: entry.recordedAt || null,
    })),
    incomingValue: record.payload?.value ?? record.content ?? record.summary ?? null,
    resolution: "pending_supersession",
    createdAt: now(),
  };
  store.memoryConflicts.push(conflict);
  record.conflictKey = conflictKey;
  record.conflictState = {
    conflictId: conflict.conflictId,
    hasConflict: true,
    conflictingMemoryIds: conflict.conflictingMemoryIds,
    resolution: conflict.resolution,
  };
  return conflict;
}

function reinforcePassportMemoryRecord(
  entry,
  {
    useful = true,
    recalledAt = now(),
    currentGoal = null,
    queryText = null,
    cognitiveState = null,
  } = {}
) {
  if (!entry) {
    return entry;
  }
  if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
    entry.memoryDynamics = {};
  }
  destabilizePassportMemoryRecord(entry, { recalledAt });
  const cognitiveBias = buildPassportCognitiveBias(entry, {
    currentGoal,
    queryText,
    cognitiveState,
    referenceTime: recalledAt,
  });
  const reinforcementDelta = useful
    ? 0.06 + (cognitiveBias.modulationBoost * 0.24) + (cognitiveBias.traceClassBoost * 0.18) + (cognitiveBias.replayModeBoost * 0.12)
    : 0.02 + (cognitiveBias.modulationBoost * 0.1);
  entry.memoryDynamics.recallCount = Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.recallCount, 0))) + 1;
  entry.memoryDynamics.recallSuccessCount =
    Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.recallSuccessCount, 0))) + (useful ? 1 : 0);
  entry.memoryDynamics.lastRecalledAt = recalledAt;
  entry.memoryDynamics.strengthScore = Number(
    Math.max(
      0,
      Math.min(1, toFiniteNumber(entry.memoryDynamics.strengthScore, entry.salience ?? 0.5) + reinforcementDelta)
    ).toFixed(2)
  );
  entry.memoryDynamics.lastReinforcementDelta = Number(reinforcementDelta.toFixed(2));
  entry.memoryDynamics.lastReinforcementDrivers = {
    useful,
    goalSupportScore: cognitiveBias.goalSupportScore,
    querySupportScore: cognitiveBias.querySupportScore,
    taskSupportScore: cognitiveBias.taskSupportScore,
    traceClassBoost: cognitiveBias.traceClassBoost,
    modulationBoost: cognitiveBias.modulationBoost,
    replayModeBoost: cognitiveBias.replayModeBoost,
    dominantRhythm: cognitiveBias.dominantRhythm,
    replayMode: cognitiveBias.replayMode,
    targetMatches: cognitiveBias.targetMatches,
  };
  return entry;
}

function destabilizePassportMemoryRecord(entry, { recalledAt = now(), clusterCue = false } = {}) {
  if (!entry || normalizePassportMemoryLayer(entry.layer) === "ledger") {
    return entry;
  }
  if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
    entry.memoryDynamics = {};
  }
  const reconsolidationWindowHours = inferPassportReconsolidationWindowHours(entry);
  if (reconsolidationWindowHours <= 0) {
    return entry;
  }
  entry.memoryDynamics.reactivationCount =
    Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.reactivationCount, 0))) + 1;
  entry.memoryDynamics.lastReactivatedAt = recalledAt;
  entry.memoryDynamics.destabilizedAt = recalledAt;
  entry.memoryDynamics.destabilizedUntil = addSeconds(recalledAt, reconsolidationWindowHours * 60 * 60);
  entry.memoryDynamics.reconsolidationWindowHours = reconsolidationWindowHours;
  entry.memoryDynamics.reconsolidationState = "destabilized";
  if (clusterCue) {
    entry.memoryDynamics.lastReactivationCause = "cluster_cue";
    entry.memoryDynamics.clusterCueCount =
      Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.clusterCueCount, 0))) + 1;
  } else {
    entry.memoryDynamics.lastReactivationCause = "direct_retrieval";
  }
  return entry;
}

function computeTemporalDecayMetrics(entry, referenceTime = now(), { cognitiveState = null } = {}) {
  const ageDays = computePassportMemoryAgeDays(entry, referenceTime);
  const salienceScore = toFiniteNumber(entry?.memoryDynamics?.salienceScore, entry?.salience ?? 0.5);
  const confidenceScore = toFiniteNumber(entry?.memoryDynamics?.confidenceScore, entry?.confidence ?? 0.5);
  const baseStrength = toFiniteNumber(entry?.memoryDynamics?.strengthScore, (salienceScore * 0.6) + (confidenceScore * 0.4));
  const cognitiveBias = buildPassportCognitiveBias(entry, {
    cognitiveState,
    referenceTime,
  });
  const decayRate = Math.max(
    0.01,
    toFiniteNumber(entry?.memoryDynamics?.decayRate, 0.08) +
      (cognitiveBias.forgettingPressure * 0.06) -
      (cognitiveBias.replayProtection * 0.05)
  );
  const recallBoost = Math.min(0.35, Math.floor(toFiniteNumber(entry?.memoryDynamics?.recallCount, 0)) * 0.04);
  const recallSuccessBoost = Math.min(0.2, Math.floor(toFiniteNumber(entry?.memoryDynamics?.recallSuccessCount, 0)) * 0.03);
  const decayedStrength = Math.max(0.02, Math.min(1, (baseStrength * Math.exp(-decayRate * ageDays)) + recallBoost + recallSuccessBoost));
  const detailDecayMultiplier =
    entry?.layer === "working"
      ? 1.8
      : entry?.layer === "episodic"
        ? 1.25
        : entry?.layer === "semantic"
          ? 0.65
          : 0.45;
  const tunedDetailDecayMultiplier = Math.max(
    0.28,
    detailDecayMultiplier * (1 + (cognitiveBias.forgettingPressure * 0.4) - (cognitiveBias.replayProtection * 0.24))
  );
  const detailRetentionScore = Math.max(
    0.05,
    Math.min(1, Math.exp(-(decayRate * tunedDetailDecayMultiplier) * ageDays) + (recallSuccessBoost * 0.5))
  );
  const retentionBand =
    detailRetentionScore > 0.8
      ? "vivid"
      : detailRetentionScore > 0.58
        ? "clear"
        : detailRetentionScore > 0.34
          ? "gist_only"
          : "faded";
  return {
    ageDays: Number(ageDays.toFixed(2)),
    decayedStrength: Number(decayedStrength.toFixed(2)),
    detailRetentionScore: Number(detailRetentionScore.toFixed(2)),
    retentionBand,
    cognitiveDecayBias: {
      forgettingPressure: cognitiveBias.forgettingPressure,
      replayProtection: cognitiveBias.replayProtection,
      dominantRhythm: cognitiveBias.dominantRhythm,
      replayMode: cognitiveBias.replayMode,
      targetMatches: cognitiveBias.targetMatches,
    },
  };
}

function computePassportEvidenceCandidateScore(entry, referenceTime = now()) {
  const sourceTrust = computePassportSourceTrustScore(entry?.sourceType);
  const confidence = toFiniteNumber(entry?.confidence, 0.5);
  const strength = toFiniteNumber(entry?.memoryDynamics?.strengthScore, entry?.salience ?? 0.5);
  const salience = toFiniteNumber(entry?.salience, entry?.memoryDynamics?.salienceScore ?? 0.5);
  const novelty = toFiniteNumber(entry?.neuromodulation?.novelty, 0.3);
  const reward = toFiniteNumber(entry?.neuromodulation?.reward, 0.3);
  const social = toFiniteNumber(entry?.neuromodulation?.social, 0.3);
  const ageDays = computePassportMemoryAgeDays(entry, referenceTime);
  const recencyScore = Math.max(0.08, Math.exp(-0.035 * Math.max(0, ageDays)));
  const destabilizedPenalty =
    normalizeOptionalText(entry?.memoryDynamics?.reconsolidationState) === "destabilized"
      ? 0.04
      : 0;
  return Number(
    Math.max(
      0,
      Math.min(
        1.6,
        (
          sourceTrust * 0.3 +
          confidence * 0.24 +
          strength * 0.18 +
          salience * 0.12 +
          recencyScore * 0.08 +
          novelty * 0.04 +
          reward * 0.03 +
          social * 0.03 -
          destabilizedPenalty
        ).toFixed(4)
      )
    )
  );
}

function applyTemporalDecayToPassportMemories(store, agentId, { sourceWindowId = null, referenceTime = now(), cognitiveState = null } = {}) {
  const affectedMemoryIds = [];
  for (const entry of store.passportMemories || []) {
    const normalizedStatus = normalizeOptionalText(entry?.status) ?? "";
    const decayedBookkeepingGap =
      normalizedStatus === "decayed" &&
      (!normalizeOptionalText(entry?.memoryDynamics?.forgettingReason) || !entry?.memoryDynamics?.lastForgettingThresholds);
    if (entry.agentId !== agentId || (!isPassportMemoryActive(entry) && !decayedBookkeepingGap)) {
      continue;
    }
    if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
      entry.memoryDynamics = {};
    }
    const decay = computeTemporalDecayMetrics(entry, referenceTime, { cognitiveState });
    entry.memoryDynamics.ageDays = decay.ageDays;
    entry.memoryDynamics.strengthScore = decay.decayedStrength;
    entry.memoryDynamics.detailRetentionScore = decay.detailRetentionScore;
    entry.memoryDynamics.retentionBand = decay.retentionBand;
    entry.memoryDynamics.lastForgettingSignal = decay.cognitiveDecayBias;
    entry.memoryDynamics.lastDecayAppliedAt = referenceTime;
    if (decay.decayedStrength < 0.12 && entry.layer === "working") {
      entry.memoryDynamics.decaySuggestedStatus = "decayed";
      entry.memoryDynamics.decaySuggestedAt = referenceTime;
    } else {
      delete entry.memoryDynamics.decaySuggestedStatus;
      delete entry.memoryDynamics.decaySuggestedAt;
    }
    affectedMemoryIds.push(entry.passportMemoryId);
  }

  appendEvent(store, "passport_memory_decay_applied", {
    agentId,
    affectedCount: affectedMemoryIds.length,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
  });

  return {
    affectedMemoryIds,
    affectedCount: affectedMemoryIds.length,
    referenceTime,
  };
}

function buildAgedMemoryAbstraction(entry, { sourceWindowId = null } = {}) {
  if (!entry?.passportMemoryId) {
    return null;
  }
  const retentionBand = normalizeOptionalText(entry?.memoryDynamics?.retentionBand) ?? null;
  if (!["gist_only", "faded"].includes(retentionBand)) {
    return null;
  }
  if (normalizeOptionalText(entry?.memoryDynamics?.abstractedAt)) {
    return null;
  }

  const gistSummary =
    normalizeOptionalText(entry?.summary) ??
    normalizeOptionalText(entry?.payload?.field) ??
    normalizeOptionalText(entry?.kind) ??
    "older memory";
  const abstractedContent = [
    `原始记忆 ${entry.passportMemoryId} 已进入 ${retentionBand} 状态。`,
    `保留概要：${gistSummary}`,
    entry?.layer ? `来源层：${entry.layer}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return normalizePassportMemoryRecord(entry.agentId, {
    layer: entry.layer === "working" ? "episodic" : "semantic",
    kind: "abstracted_memory",
    summary: `抽象记忆：${gistSummary}`,
    content: abstractedContent,
    payload: {
      field: "abstracted_memory",
      sourcePassportMemoryId: entry.passportMemoryId,
      originalKind: entry.kind,
      originalLayer: entry.layer,
      retentionBand,
      gistSummary,
    },
    tags: ["abstracted", "memory_decay", retentionBand],
    sourceWindowId,
    salience: Math.max(0.45, toFiniteNumber(entry?.memoryDynamics?.salienceScore, entry?.salience ?? 0.5)),
    confidence: Math.max(0.62, toFiniteNumber(entry?.memoryDynamics?.confidenceScore, entry?.confidence ?? 0.5)),
    memoryDynamics: {
      decayRate: entry?.layer === "working" ? 0.06 : 0.03,
      consolidationTier: entry?.layer === "working" ? "mid_term" : "long_term",
      strengthScore: Math.max(0.4, toFiniteNumber(entry?.memoryDynamics?.strengthScore, 0.5)),
      promotionRule: "retain_gist",
    },
  });
}

function extractExplicitPreferencesFromText(text = null) {
  const normalized = normalizeOptionalText(text);
  if (!normalized) {
    return {
      preferenceKeys: [],
      explicitRules: [],
    };
  }

  const rules = [];
  const addRule = (key, statement) => {
    if (!key || !statement) return;
    rules.push({ key, statement });
  };

  const directPatterns = [
    { key: "prefer_local_first", regex: /(优先|尽量|最好).{0,8}(本地优先|本地|离线)/u },
    { key: "prefer_risk_confirmation", regex: /(先确认|确认后执行|先复核|谨慎处理)/u },
    { key: "prefer_checkpoint_resume", regex: /(先恢复上下文|恢复后再|先续上|checkpoint|resume)/iu },
    { key: "prefer_compact_context", regex: /(简洁|精简|压缩|不要太长)/u },
  ];
  for (const pattern of directPatterns) {
    if (pattern.regex.test(normalized)) {
      addRule(pattern.key, normalized);
    }
  }

  const explicitRules = rules.slice(0, 6);
  return {
    preferenceKeys: Array.from(new Set(explicitRules.map((item) => item.key))),
    explicitRules,
  };
}

function writeExplicitPreferenceMemories(store, agent, explicitPreferences, { sourceWindowId = null } = {}) {
  const keys = normalizeTextList(explicitPreferences?.preferenceKeys || []);
  if (!keys.length) {
    return [];
  }
  const profileSnapshot = buildProfileMemorySnapshot(store, agent, { listAgentPassportMemories });
  const currentStable = extractStablePreferences(profileSnapshot.fieldValues);
  const merged = Array.from(new Set([...currentStable, ...keys])).slice(-12);
  const record = normalizePassportMemoryRecord(agent.agentId, {
    layer: "profile",
    kind: "preference",
    summary: `显式偏好 ${keys.length} 条`,
    content: merged.join("\n"),
    payload: {
      field: "stable_preferences",
      value: merged,
      explicitRules: cloneJson(explicitPreferences?.explicitRules) ?? [],
      source: "explicit_user_signal",
    },
    tags: ["profile", "preference", "explicit_signal"],
    sourceWindowId,
    confidence: 0.92,
    salience: 0.88,
  });
  applyPassportMemoryConflictTracking(store, agent.agentId, record);
  applyPassportMemorySupersession(store, agent.agentId, record);
  store.passportMemories.push(record);
  return [record];
}

function getPassportNeuromodulationWeight(entry = {}) {
  const modulation = entry?.neuromodulation || {};
  return (
    (toFiniteNumber(modulation.novelty, 0.2) * 0.35) +
    (toFiniteNumber(modulation.reward, 0.15) * 0.25) +
    (toFiniteNumber(modulation.threat, 0.1) * 0.15) +
    (toFiniteNumber(modulation.social, 0.25) * 0.25)
  );
}

function isPassportEligibilityTraceActive(entry = {}, referenceTime = now()) {
  const until = normalizeOptionalText(entry?.memoryDynamics?.eligibilityTraceUntil) ?? null;
  if (!until) {
    return false;
  }
  const untilTs = Date.parse(until);
  const referenceTs = Date.parse(referenceTime);
  if (!Number.isFinite(untilTs) || !Number.isFinite(referenceTs)) {
    return false;
  }
  return untilTs >= referenceTs && toFiniteNumber(entry?.memoryDynamics?.eligibilityTraceScore, 0) >= 0.32;
}

function applyPassportMemoryHomeostaticScaling(store, agentId) {
  const scaledMemoryIds = [];

  for (const [layer, targetMean] of Object.entries(DEFAULT_LAYER_HOMEOSTATIC_TARGETS)) {
    const entries = listAgentPassportMemories(store, agentId, { layer }).filter((entry) => isPassportMemoryActive(entry));
    if (entries.length === 0) {
      continue;
    }
    const currentMean =
      entries.reduce((sum, entry) => sum + toFiniteNumber(entry?.memoryDynamics?.strengthScore, toFiniteNumber(entry?.salience, 0.5)), 0) /
      entries.length;
    if (!Number.isFinite(currentMean) || currentMean <= 0) {
      continue;
    }
    const rawScale = targetMean / currentMean;
    const clampedScale = Math.max(0.82, Math.min(1.18, rawScale));

    for (const entry of entries) {
      if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
        entry.memoryDynamics = {};
      }
      entry.memoryDynamics.homeostaticScale = Number(clampedScale.toFixed(2));
      entry.memoryDynamics.strengthScore = Number(
        Math.max(0, Math.min(1, toFiniteNumber(entry.memoryDynamics.strengthScore, toFiniteNumber(entry.salience, 0.5)) * clampedScale)).toFixed(2)
      );
      entry.memoryDynamics.salienceScore = Number(
        Math.max(0, Math.min(1, toFiniteNumber(entry.memoryDynamics.salienceScore, toFiniteNumber(entry.salience, 0.5)) * ((clampedScale + 1) / 2))).toFixed(2)
      );
      scaledMemoryIds.push(entry.passportMemoryId);
    }
  }

  return {
    scaledMemoryIds,
    scaledCount: scaledMemoryIds.length,
  };
}

function scorePassportMemoryReplayValue(entry = {}) {
  return (
    (toFiniteNumber(entry?.salience, 0.5) * 0.28) +
    (toFiniteNumber(entry?.confidence, 0.5) * 0.16) +
    (toFiniteNumber(entry?.memoryDynamics?.strengthScore, 0.5) * 0.24) +
    (Math.min(4, Math.floor(toFiniteNumber(entry?.memoryDynamics?.recallCount, 0))) * 0.08) +
    (normalizeOptionalText(entry?.consolidationState) === "stabilizing" ? 0.12 : 0) +
    (normalizeOptionalText(entry?.sourceType) === "verified" ? 0.1 : 0) +
    (getPassportNeuromodulationWeight(entry) * 0.28) +
    (isPassportEligibilityTraceActive(entry) ? 0.12 : 0) +
    (toFiniteNumber(entry?.memoryDynamics?.allocationBias, 0.5) * 0.18)
  );
}

function buildPassportMemoryReplayGroups(entries = []) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry?.passportMemoryId) {
      continue;
    }
    const baseKey =
      getPassportMemoryPatternKey(entry) ??
      normalizeOptionalText(entry?.boundaryLabel) ??
      `${entry.layer}:${entry.kind}:${normalizeComparableText(entry.summary || entry.content || entry.passportMemoryId).slice(0, 48)}`;
    if (!groups.has(baseKey)) {
      groups.set(baseKey, []);
    }
    groups.get(baseKey).push(entry);
  }

  return [...groups.entries()].map(([groupKey, groupEntries]) => {
    const sortedEntries = [...groupEntries].sort((left, right) => {
      const valueDelta = scorePassportMemoryReplayValue(right) - scorePassportMemoryReplayValue(left);
      return valueDelta || (right.recordedAt || "").localeCompare(left.recordedAt || "");
    });
    const score = sortedEntries.reduce((sum, entry) => sum + scorePassportMemoryReplayValue(entry), 0) / Math.max(1, sortedEntries.length);
    return {
      groupKey,
      entries: sortedEntries,
      score,
      boundaryLabels: Array.from(
        new Set(sortedEntries.map((entry) => normalizeOptionalText(entry?.boundaryLabel)).filter(Boolean))
      ),
      sourceTypes: Array.from(new Set(sortedEntries.map((entry) => normalizeOptionalText(entry?.sourceType)).filter(Boolean))),
    };
  });
}

function buildPassportReplaySummary(group) {
  const lines = [];
  for (const entry of group?.entries || []) {
    const line = normalizeOptionalText(entry.summary || entry.content || entry.kind);
    if (line && !lines.includes(line)) {
      lines.push(line);
    }
    if (lines.length >= 5) {
      break;
    }
  }
  return lines;
}

function scorePassportOfflineReplayPriority(entry = {}, { currentGoal = null, cognitiveState = null } = {}) {
  const searchText = buildPassportMemorySearchText(entry);
  const goalRelevance = compareTextSimilarity(searchText, currentGoal);
  const predictionError = toFiniteNumber(entry?.memoryDynamics?.lastPredictionErrorScore, 0);
  const salience = toFiniteNumber(entry?.salience, 0.5);
  const strength = toFiniteNumber(entry?.memoryDynamics?.strengthScore, salience);
  const allocationBias = toFiniteNumber(entry?.memoryDynamics?.allocationBias, 0.5);
  const novelty = toFiniteNumber(entry?.neuromodulation?.novelty, 0.2);
  const threat = toFiniteNumber(entry?.neuromodulation?.threat, 0.1);
  const isContested = normalizeOptionalText(entry?.memoryDynamics?.reconsolidationConflictState) === "ambiguous_competition" ? 0.16 : 0;
  const isDestabilized = normalizeOptionalText(entry?.memoryDynamics?.reconsolidationState) === "destabilized" ? 0.14 : 0;
  const controllerPredictionError = toFiniteNumber(cognitiveState?.rewardPredictionError, 0) * 0.08;
  const controllerUncertainty = toFiniteNumber(cognitiveState?.uncertainty, 0) * 0.06;
  const homeostaticPressure = toFiniteNumber(cognitiveState?.homeostaticPressure, 0) * 0.08;
  const socialSalience = toFiniteNumber(cognitiveState?.socialSalience, 0) * 0.04;
  const cognitiveBias = buildPassportCognitiveBias(entry, {
    currentGoal,
    cognitiveState,
  });
  const modeBoost =
    ["recovering", "self_calibrating"].includes(normalizeOptionalText(cognitiveState?.mode) ?? "")
      ? 0.08
      : 0;
  return Number(
    Math.max(
      0,
      Math.min(
        1.4,
        (
          (predictionError * 0.24) +
          (salience * 0.2) +
          (strength * 0.16) +
          (allocationBias * 0.12) +
          (goalRelevance * 0.08) +
          (novelty * 0.08) +
          (threat * 0.06) +
          controllerPredictionError +
          controllerUncertainty +
          homeostaticPressure +
          socialSalience +
          (cognitiveBias.goalSupportScore * 0.08) +
          (cognitiveBias.traceClassBoost * 0.2) +
          (cognitiveBias.modulationBoost * 0.14) +
          (cognitiveBias.replayModeBoost * 0.08) +
          (cognitiveBias.rhythmBoost * 0.06) +
          isContested +
          isDestabilized +
          modeBoost
        ).toFixed(4)
      )
    )
  );
}

function buildPassportReplayGroupDrivers(group = {}, { currentGoal = null, cognitiveState = null } = {}) {
  const entries = Array.isArray(group?.entries) ? group.entries : [];
  const biases = entries.map((entry) => buildPassportCognitiveBias(entry, {
    currentGoal,
    cognitiveState,
  }));
  const average = (key) =>
    Number(
      (
        biases.reduce((sum, bias) => sum + toFiniteNumber(bias?.[key], 0), 0) /
        Math.max(1, biases.length)
      ).toFixed(2)
    );

  return {
    goalSupportScore: average("goalSupportScore"),
    taskSupportScore: average("taskSupportScore"),
    conflictTraceScore: average("conflictTraceScore"),
    predictionErrorTraceScore: average("predictionErrorTraceScore"),
    traceClassBoost: average("traceClassBoost"),
    modulationBoost: average("modulationBoost"),
    replayModeBoost: average("replayModeBoost"),
    replayProtection: average("replayProtection"),
    dominantRhythm:
      normalizeOptionalText(cognitiveState?.oscillationSchedule?.dominantRhythm) ??
      normalizeOptionalText(cognitiveState?.dominantRhythm) ??
      null,
    replayMode: normalizeOptionalText(cognitiveState?.replayOrchestration?.replayMode) ?? null,
    targetMatches: Array.from(
      new Set(
        biases.flatMap((bias) => Array.isArray(bias?.targetMatches) ? bias.targetMatches : [])
      )
    ).slice(0, 6),
    preferenceSignals: normalizeTextList([
      ...(cognitiveState?.preferenceProfile?.stablePreferences || []),
      ...(cognitiveState?.preferenceProfile?.inferredPreferences || []),
      ...(cognitiveState?.preferenceProfile?.learnedSignals || []),
    ]).slice(0, 6),
  };
}

function shouldRunPassportOfflineReplay({
  offlineReplayRequested = false,
  activeWorking = [],
  activeEpisodic = [],
  cognitiveState = null,
  currentGoal = null,
} = {}) {
  if (offlineReplayRequested) {
    return true;
  }
  if (activeEpisodic.length < DEFAULT_OFFLINE_REPLAY_CLUSTER_MIN_SIZE) {
    return false;
  }
  const normalizedMode = normalizeOptionalText(cognitiveState?.mode) ?? null;
  if (["recovering", "self_calibrating"].includes(normalizedMode)) {
    return true;
  }
  if (cognitiveState?.replayOrchestration?.shouldReplay === true) {
    return true;
  }
  const fatigue = toFiniteNumber(cognitiveState?.fatigue, 0);
  const sleepDebt = toFiniteNumber(cognitiveState?.sleepDebt, 0);
  const homeostaticPressure = toFiniteNumber(cognitiveState?.homeostaticPressure, 0);
  const sleepPressure = toFiniteNumber(cognitiveState?.sleepPressure ?? cognitiveState?.interoceptiveState?.sleepPressure, 0);
  if (fatigue >= 0.58 || sleepDebt >= 0.52 || homeostaticPressure >= 0.56 || sleepPressure >= 0.5) {
    return true;
  }
  return !normalizeOptionalText(currentGoal) && activeWorking.length <= 3;
}

function buildPassportOfflineReplayEventGraph(group = {}) {
  const nodes = [];
  const nodeIndex = new Map();
  const edges = [];
  const sortedEntries = [...(group.entries || [])].sort((left, right) => (left.recordedAt || "").localeCompare(right.recordedAt || ""));

  const addNode = (textValue, { type = "event", entry = null } = {}) => {
    const text = normalizeOptionalText(textValue) ?? null;
    if (!text) {
      return null;
    }
    const key = normalizeComparableText(text).slice(0, 96) || null;
    if (!key) {
      return null;
    }
    if (!nodeIndex.has(key)) {
      const node = {
        id: `node_${key.slice(0, 48)}`,
        text,
        type,
        sourcePassportMemoryIds: [],
      };
      nodes.push(node);
      nodeIndex.set(key, node);
    }
    const node = nodeIndex.get(key);
    if (entry?.passportMemoryId && !node.sourcePassportMemoryIds.includes(entry.passportMemoryId)) {
      node.sourcePassportMemoryIds.push(entry.passportMemoryId);
    }
    return node;
  };

  for (const entry of sortedEntries) {
    addNode(buildPassportEventGraphNodeText(entry), {
      type:
        normalizeOptionalText(entry?.payload?.field) === "next_action" || normalizeOptionalText(entry?.kind) === "next_action"
          ? "action"
          : entry?.layer === "semantic"
            ? "schema"
            : "event",
      entry,
    });
  }

  for (let index = 0; index < sortedEntries.length - 1; index += 1) {
    const current = sortedEntries[index];
    const next = sortedEntries[index + 1];
    const currentNode = addNode(buildPassportEventGraphNodeText(current), { entry: current });
    const nextNode = addNode(buildPassportEventGraphNodeText(next), { entry: next });
    if (!currentNode || !nextNode || currentNode.id === nextNode.id) {
      continue;
    }
    const relation =
      normalizeOptionalText(next?.payload?.field) === "next_action" || normalizeOptionalText(next?.kind) === "next_action"
        ? "supports_next_step"
        : "temporal_successor";
    edges.push({
      from: currentNode.id,
      to: nextNode.id,
      fromText: currentNode.text,
      toText: nextNode.text,
      relation,
      supportIds: [current?.passportMemoryId, next?.passportMemoryId].filter(Boolean),
    });
  }

  return {
    nodes,
    edges,
    focusPath: nodes.slice(0, 4).map((node) => node.id),
  };
}

function buildPassportSleepStageTrace(group = {}, { currentGoal = null, cognitiveState = null } = {}) {
  const replaySummary = Array.isArray(group.replaySummary) ? group.replaySummary : [];
  const prioritizedEntries = [...(group.entries || [])].sort((left, right) => {
    const priorityDelta = toFiniteNumber(right?.offlineReplayPriority, 0) - toFiniteNumber(left?.offlineReplayPriority, 0);
    return priorityDelta || (right?.recordedAt || "").localeCompare(left?.recordedAt || "");
  });
  const weakestEntries = [...(group.entries || [])].sort((left, right) => {
    const leftStrength = toFiniteNumber(left?.memoryDynamics?.strengthScore, toFiniteNumber(left?.confidence, 0.5));
    const rightStrength = toFiniteNumber(right?.memoryDynamics?.strengthScore, toFiniteNumber(right?.confidence, 0.5));
    return leftStrength - rightStrength || (left?.recordedAt || "").localeCompare(right?.recordedAt || "");
  });
  const replayEventGraph = buildPassportOfflineReplayEventGraph(group);
  const nextActionEntry = prioritizedEntries.find(
    (entry) => normalizeOptionalText(entry?.payload?.field) === "next_action" || normalizeOptionalText(entry?.kind) === "next_action"
  );
  const recombinationHypotheses = [];
  if (nextActionEntry) {
    recombinationHypotheses.push(`假设：如果当前推进链持续成立，下一步优先 ${nextActionEntry.summary || nextActionEntry.content || "继续推进"}`);
  }
  if ((group.competingValues || []).length >= 2) {
    recombinationHypotheses.push(`假设：需要在 ${group.competingValues.slice(0, 3).join(" / ")} 之间继续做 competing traces 校验`);
  } else if (replaySummary.length >= 2) {
    recombinationHypotheses.push(`假设：${replaySummary[0]} 之后可自然过渡到 ${replaySummary.at(-1)}`);
  }
  const fatigue = clampUnitInterval(cognitiveState?.fatigue, 0);
  const sleepDebt = clampUnitInterval(cognitiveState?.sleepDebt, 0);
  const sleepPressure = clampUnitInterval(
    cognitiveState?.interoceptiveState?.sleepPressure ?? ((fatigue * 0.46) + (sleepDebt * 0.54)),
    0
  );
  const sleepPressurePrefix =
    sleepPressure >= 0.6
      ? "当前 sleep pressure 较高，"
      : sleepPressure >= 0.35
        ? "当前存在轻中度 sleep pressure，"
        : "";

  return {
    eventGraph: replayEventGraph,
    recombinationHypotheses,
    replayDrivers: cloneJson(group.replayDrivers || null),
    sleepPressure,
    cognitiveStateSnapshot: {
      mode: normalizeOptionalText(cognitiveState?.mode) ?? null,
      dominantRhythm: normalizeOptionalText(cognitiveState?.dominantRhythm) ?? null,
      fatigue,
      sleepDebt,
      uncertainty: clampUnitInterval(cognitiveState?.uncertainty, 0),
      rewardPredictionError: clampUnitInterval(cognitiveState?.rewardPredictionError, 0),
      homeostaticPressure: clampUnitInterval(cognitiveState?.homeostaticPressure, 0),
      bodyLoop: cloneJson(cognitiveState?.bodyLoop || null),
      interoceptiveState: cloneJson(cognitiveState?.interoceptiveState || null),
      neuromodulators: cloneJson(cognitiveState?.neuromodulators || null),
      oscillationSchedule: cloneJson(cognitiveState?.oscillationSchedule || null),
      replayOrchestration: cloneJson(cognitiveState?.replayOrchestration || null),
    },
    stages: [
      {
        stage: "nrem_prioritization",
        summary: `${sleepPressurePrefix}优先重放 ${group.groupKey || replaySummary[0] || "当前模式"}，并补强弱痕迹与高优先级痕迹。`,
        prioritizedMemoryIds: prioritizedEntries.slice(0, 3).map((entry) => entry.passportMemoryId).filter(Boolean),
        weakTraceMemoryIds: weakestEntries.slice(0, 2).map((entry) => entry.passportMemoryId).filter(Boolean),
        currentGoal: normalizeOptionalText(currentGoal) ?? null,
        fatigue,
        sleepDebt,
      },
      {
        stage: "sws_systems_consolidation",
        summary: `把 ${group.groupKey || "当前模式"} 从离散片段整合成事件链与 schema。`,
        nodeCount: replayEventGraph.nodes.length,
        edgeCount: replayEventGraph.edges.length,
        focusPath: replayEventGraph.focusPath,
        fatigue,
        sleepDebt,
      },
      {
        stage: "rem_associative_recombination",
        summary:
          recombinationHypotheses[0] ??
          `把 ${group.groupKey || "当前模式"} 与下一步候选动作做低确定性重组。`,
        hypothesisCount: recombinationHypotheses.length,
        hypotheses: recombinationHypotheses,
        fatigue,
        sleepDebt,
      },
    ],
  };
}

function buildPassportOfflineReplayNarrative(group = {}, { currentGoal = null, sleepStages = [] } = {}) {
  const lines = [];
  if (currentGoal) {
    lines.push(`离线回放目标：${currentGoal}`);
  }
  lines.push(`回放模式：sleep_like_offline`);
  if (group.groupKey) {
    lines.push(`模式线索：${group.groupKey}`);
  }
  if (group.boundaryLabels?.length) {
    lines.push(`事件边界：${group.boundaryLabels.join(" / ")}`);
  }
  if (group.competingValues?.length) {
    lines.push(`竞争痕迹：${group.competingValues.join(" / ")}`);
  }
  if (group.replaySummary?.length) {
    lines.push(...group.replaySummary.map((item, index) => `回放片段 ${index + 1}：${item}`));
  }
  for (const stage of sleepStages) {
    if (normalizeOptionalText(stage?.summary)) {
      lines.push(`睡眠阶段 ${stage.stage}：${stage.summary}`);
    }
  }
  return lines;
}

function runPassportOfflineReplayCycle(
  store,
  agent,
  {
    sourceWindowId = null,
    currentGoal = null,
    cognitiveState = null,
    activeWorking = [],
    activeEpisodic = [],
    offlineReplayRequested = false,
  } = {}
) {
  if (
    !shouldRunPassportOfflineReplay({
      offlineReplayRequested,
      activeWorking,
      activeEpisodic,
      cognitiveState,
      currentGoal,
    })
  ) {
    return {
      triggered: false,
      reason: "offline_replay_gate_closed",
      replayedPatternCount: 0,
      replayedMemoryIds: [],
      selectedGroupKeys: [],
    };
  }

  const candidates = [...activeWorking, ...activeEpisodic]
    .filter((entry) => isPassportMemoryActive(entry))
    .map((entry) => ({
      ...entry,
      offlineReplayPriority: scorePassportOfflineReplayPriority(entry, { currentGoal, cognitiveState }),
    }));
  const groups = buildPassportMemoryReplayGroups(candidates)
    .map((group) => {
      const averagePriority =
        group.entries.reduce((sum, entry) => sum + toFiniteNumber(entry?.offlineReplayPriority, 0), 0) /
        Math.max(1, group.entries.length);
      const competingValues = Array.from(
        new Set(group.entries.map((entry) => normalizeOptionalText(extractPassportMemoryComparableValue(entry))).filter(Boolean))
      ).slice(0, 4);
      return {
        ...group,
        averagePriority: Number(averagePriority.toFixed(4)),
        replaySummary: buildPassportReplaySummary(group),
        competingValues,
        replayDrivers: buildPassportReplayGroupDrivers(group, {
          currentGoal,
          cognitiveState,
        }),
      };
    })
    .filter((group) => {
      const hasCluster = group.entries.length >= DEFAULT_OFFLINE_REPLAY_CLUSTER_MIN_SIZE;
      const highPriority =
        group.averagePriority >= 0.54 ||
        toFiniteNumber(group?.replayDrivers?.traceClassBoost, 0) >= 0.18 ||
        toFiniteNumber(group?.replayDrivers?.predictionErrorTraceScore, 0) >= 0.24;
      const hasConflict = group.competingValues.length >= 2;
      return hasCluster || highPriority || hasConflict;
    })
    .sort((left, right) => {
      const leftPriority =
        toFiniteNumber(left?.averagePriority, 0) +
        (toFiniteNumber(left?.replayDrivers?.traceClassBoost, 0) * 0.18) +
        (toFiniteNumber(left?.replayDrivers?.taskSupportScore, 0) * 0.08);
      const rightPriority =
        toFiniteNumber(right?.averagePriority, 0) +
        (toFiniteNumber(right?.replayDrivers?.traceClassBoost, 0) * 0.18) +
        (toFiniteNumber(right?.replayDrivers?.taskSupportScore, 0) * 0.08);
      return rightPriority - leftPriority || right.score - left.score;
    })
    .slice(0, DEFAULT_OFFLINE_REPLAY_MAX_PATTERNS);

  const writes = [];
  for (const group of groups) {
    const sleepTrace = buildPassportSleepStageTrace(group, { currentGoal, cognitiveState });
    const normalizedPatternKey = normalizeComparableText(group.groupKey).slice(0, 72) || "pattern";
    const stageTraceRecord = normalizePassportMemoryRecord(agent.agentId, {
      layer: "semantic",
      kind: "offline_replay_stage_trace",
      summary: `睡眠阶段轨迹：${group.replaySummary?.[0] || group.groupKey}`,
      content: sleepTrace.stages.map((stage) => `${stage.stage}: ${stage.summary}`).join("\n"),
      payload: {
        field: `offline_replay_stage:${normalizedPatternKey}`,
        replayMode: "sleep_like_offline",
        currentGoal: normalizeOptionalText(currentGoal) ?? null,
        patternKey: group.groupKey,
        stageSequence: DEFAULT_SLEEP_STAGE_SEQUENCE,
        sleepPressure: sleepTrace.sleepPressure,
        cognitiveStateSnapshot: sleepTrace.cognitiveStateSnapshot,
        replayDrivers: sleepTrace.replayDrivers,
        stages: sleepTrace.stages,
      },
      tags: ["semantic", "offline_replay", "sleep_stage_trace", ...group.boundaryLabels.slice(0, 2)],
      sourceWindowId,
      salience: Math.max(0.66, Math.min(0.88, Number(group.averagePriority.toFixed(2)))),
      confidence: 0.74,
      sourceType: "system",
      consolidationState: "consolidated",
      boundaryLabel: group.boundaryLabels[0] ?? null,
      patternKey: group.groupKey,
      separationKey: `semantic:offline-stage:${normalizedPatternKey}`,
      sourceFeatures: {
        modality: "sleep_stage_trace",
        generationMode: "system_trace",
        perceptualDetailScore: 0.12,
        contextualDetailScore: 0.88,
        cognitiveOperationScore: 0.38,
        socialCorroborationScore: 0.18,
        externalAnchorCount: Math.min(4, group.entries.length),
      },
    });
    applyPassportMemorySupersession(store, agent.agentId, stageTraceRecord);
    store.passportMemories.push(stageTraceRecord);
    writes.push(stageTraceRecord);

    const eventGraphRecord = normalizePassportMemoryRecord(agent.agentId, {
      layer: "semantic",
      kind: "offline_replay_event_graph",
      summary: `离线回放事件图：${group.replaySummary?.[0] || group.groupKey}`,
      content: JSON.stringify(sleepTrace.eventGraph, null, 2),
      payload: {
        field: `offline_replay_event_graph:${normalizedPatternKey}`,
        replayMode: "sleep_like_offline",
        currentGoal: normalizeOptionalText(currentGoal) ?? null,
        patternKey: group.groupKey,
        sleepStage: "sws_systems_consolidation",
        replayDrivers: sleepTrace.replayDrivers,
        value: sleepTrace.eventGraph,
      },
      tags: ["semantic", "offline_replay", "event_graph", ...group.boundaryLabels.slice(0, 2)],
      sourceWindowId,
      salience: Math.max(0.68, Math.min(0.9, Number(group.averagePriority.toFixed(2)))),
      confidence: 0.72,
      sourceType: "derived",
      consolidationState: "consolidated",
      boundaryLabel: group.boundaryLabels[0] ?? null,
      patternKey: group.groupKey,
      separationKey: `semantic:offline-event-graph:${normalizedPatternKey}`,
      sourceFeatures: {
        modality: "abstract_schema",
        generationMode: "internal_inference",
        perceptualDetailScore: 0.08,
        contextualDetailScore: 0.82,
        cognitiveOperationScore: 0.74,
        socialCorroborationScore: 0.18,
        externalAnchorCount: Math.min(4, group.entries.length),
      },
    });
    applyPassportMemorySupersession(store, agent.agentId, eventGraphRecord);
    store.passportMemories.push(eventGraphRecord);
    writes.push(eventGraphRecord);

    const record = normalizePassportMemoryRecord(agent.agentId, {
      layer: "semantic",
      kind: "offline_replay_consolidation",
      summary: `离线回放整固：${group.replaySummary?.[0] || group.groupKey}`,
      content: buildPassportOfflineReplayNarrative(group, { currentGoal, sleepStages: sleepTrace.stages }).join("\n"),
      payload: {
        field: `offline_replay:${normalizedPatternKey}`,
        replayMode: "sleep_like_offline",
        currentGoal: normalizeOptionalText(currentGoal) ?? null,
        sourcePassportMemoryIds: group.entries.map((entry) => entry.passportMemoryId),
        patternKey: group.groupKey,
        boundaryLabels: group.boundaryLabels,
        replaySummary: group.replaySummary,
        competingValues: group.competingValues,
        averagePriority: group.averagePriority,
        sleepPressure: sleepTrace.sleepPressure,
        cognitiveStateSnapshot: sleepTrace.cognitiveStateSnapshot,
        replayDrivers: sleepTrace.replayDrivers,
        sleepStages: sleepTrace.stages,
        eventGraphField: eventGraphRecord.payload?.field ?? null,
        stageTraceField: stageTraceRecord.payload?.field ?? null,
      },
      tags: ["semantic", "offline_replay", "sleep_like", ...group.boundaryLabels.slice(0, 2)],
      sourceWindowId,
      salience: Math.max(0.7, Math.min(0.95, Number(group.averagePriority.toFixed(2)))),
      confidence: Math.max(0.66, Math.min(0.9, Number((group.averagePriority * 0.88).toFixed(2)))),
      sourceType: "derived",
      consolidationState: "consolidated",
      boundaryLabel: group.boundaryLabels[0] ?? null,
      patternKey: group.groupKey,
      separationKey: `semantic:offline:${normalizeComparableText(group.groupKey).slice(0, 72) || "pattern"}`,
      sourceFeatures: {
        modality: "offline_replay_summary",
        generationMode: "compressed_summary",
        perceptualDetailScore: 0.12,
        contextualDetailScore: 0.84,
        cognitiveOperationScore: 0.68,
        socialCorroborationScore: 0.22,
        externalAnchorCount: Math.min(4, group.entries.length),
      },
      memoryDynamics: {
        consolidationTier: "long_term",
        promotionCount: 1,
        recallCount: group.entries.reduce((sum, entry) => sum + Math.floor(toFiniteNumber(entry?.memoryDynamics?.recallCount, 0)), 0),
        strengthScore: Math.max(0.7, Math.min(0.94, Number(group.averagePriority.toFixed(2)))),
        salienceScore: Math.max(0.72, Math.min(0.95, Number(group.averagePriority.toFixed(2)))),
      },
    });
    applyPassportMemorySupersession(store, agent.agentId, record);
    store.passportMemories.push(record);
    writes.push(record);

    if (sleepTrace.recombinationHypotheses.length > 0) {
      const recombinationRecord = normalizePassportMemoryRecord(agent.agentId, {
        layer: "semantic",
        kind: "offline_replay_recombination",
        summary: `离线回放重组：${sleepTrace.recombinationHypotheses[0]}`,
        content: sleepTrace.recombinationHypotheses.join("\n"),
        payload: {
          field: `offline_replay_recombination:${normalizedPatternKey}`,
          replayMode: "sleep_like_offline",
          currentGoal: normalizeOptionalText(currentGoal) ?? null,
          patternKey: group.groupKey,
          sleepStage: "rem_associative_recombination",
          replayDrivers: sleepTrace.replayDrivers,
          value: {
            cause: group.replaySummary.slice(0, 2),
            effect: sleepTrace.recombinationHypotheses,
            connector: "sleep_recombination",
          },
        },
        tags: ["semantic", "offline_replay", "recombination", ...group.boundaryLabels.slice(0, 2)],
        sourceWindowId,
        salience: Math.max(0.62, Math.min(0.84, Number((group.averagePriority * 0.9).toFixed(2)))),
        confidence: 0.58,
        sourceType: "derived",
        consolidationState: "stabilizing",
        boundaryLabel: group.boundaryLabels[0] ?? null,
        patternKey: group.groupKey,
        separationKey: `semantic:offline-recombination:${normalizedPatternKey}`,
        sourceFeatures: {
          modality: "abstract_schema",
          generationMode: "internal_inference",
          perceptualDetailScore: 0.06,
          contextualDetailScore: 0.72,
          cognitiveOperationScore: 0.82,
          socialCorroborationScore: 0.16,
          externalAnchorCount: Math.min(4, group.entries.length),
        },
      });
      applyPassportMemorySupersession(store, agent.agentId, recombinationRecord);
      store.passportMemories.push(recombinationRecord);
      writes.push(recombinationRecord);
    }

    for (const entry of group.entries) {
      if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
        entry.memoryDynamics = {};
      }
      entry.memoryDynamics.offlineReplayCount = Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.offlineReplayCount, 0))) + 1;
      entry.memoryDynamics.lastOfflineReplayedAt = now();
      entry.memoryDynamics.systemsConsolidatedAt = now();
      entry.memoryDynamics.lastOfflineReplayPriority = group.averagePriority;
      entry.memoryDynamics.lastOfflineReplayDrivers = {
        groupKey: group.groupKey,
        averagePriority: group.averagePriority,
        goalSupportScore: group.replayDrivers?.goalSupportScore ?? 0,
        taskSupportScore: group.replayDrivers?.taskSupportScore ?? 0,
        traceClassBoost: group.replayDrivers?.traceClassBoost ?? 0,
        modulationBoost: group.replayDrivers?.modulationBoost ?? 0,
        replayModeBoost: group.replayDrivers?.replayModeBoost ?? 0,
        targetMatches: group.replayDrivers?.targetMatches ?? [],
        dominantRhythm: group.replayDrivers?.dominantRhythm ?? null,
        replayMode: group.replayDrivers?.replayMode ?? null,
      };
      entry.memoryDynamics.sleepCycleCount = Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.sleepCycleCount, 0))) + 1;
      entry.memoryDynamics.lastSleepCycleAt = now();
      entry.memoryDynamics.lastSleepStageTrace = DEFAULT_SLEEP_STAGE_SEQUENCE.slice();
      entry.memoryDynamics.nremReplayCount = Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.nremReplayCount, 0))) + 1;
      entry.memoryDynamics.swsConsolidationCount = Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.swsConsolidationCount, 0))) + 1;
      entry.memoryDynamics.remRecombinationCount = Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.remRecombinationCount, 0))) + 1;
      entry.memoryDynamics.schemaLinkCount = Math.max(
        0,
        Math.floor(toFiniteNumber(entry.memoryDynamics.schemaLinkCount, 0))
      ) + sleepTrace.eventGraph.edges.length;
    }
  }

  if (writes.length > 0) {
    const replaySleepPressure = Math.max(...groups.map((group) => buildPassportSleepStageTrace(group, { currentGoal, cognitiveState }).sleepPressure), 0);
    appendEvent(store, "passport_memory_offline_replayed", {
      agentId: agent.agentId,
      sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
      replayedPatternCount: writes.length,
      replayedMemoryIds: writes.map((entry) => entry.passportMemoryId),
      stageSequence: DEFAULT_SLEEP_STAGE_SEQUENCE,
      sleepPressure: replaySleepPressure,
    });
  }

  const replaySleepPressure = Math.max(...groups.map((group) => buildPassportSleepStageTrace(group, { currentGoal, cognitiveState }).sleepPressure), 0);
  return {
    triggered: writes.length > 0,
    reason: writes.length > 0 ? "offline_replay_completed" : "offline_replay_no_groups",
    replayedPatternCount: writes.length,
    replayedMemoryIds: writes.map((entry) => entry.passportMemoryId),
    selectedGroupKeys: groups.map((group) => group.groupKey),
    stageSequence: DEFAULT_SLEEP_STAGE_SEQUENCE,
    sleepPressure: replaySleepPressure,
    cognitiveStateSnapshot: groups[0]
      ? buildPassportSleepStageTrace(groups[0], { currentGoal, cognitiveState }).cognitiveStateSnapshot
      : {
          mode: normalizeOptionalText(cognitiveState?.mode) ?? null,
          fatigue: clampUnitInterval(cognitiveState?.fatigue, 0),
          sleepDebt: clampUnitInterval(cognitiveState?.sleepDebt, 0),
        },
  };
}

function runPassportReplayConsolidationCycle(
  store,
  agent,
  {
    sourceWindowId = null,
    currentGoal = null,
    activeWorking = [],
    activeEpisodic = [],
  } = {}
) {
  const replayCandidates = [
    ...activeWorking.filter((entry) => normalizeOptionalText(entry?.kind) !== "sensory_snapshot"),
    ...activeEpisodic,
  ].filter((entry) => isPassportMemoryActive(entry));
  const groups = buildPassportMemoryReplayGroups(replayCandidates)
    .filter((group) => {
      const hasCluster = group.entries.length >= DEFAULT_MEMORY_REPLAY_CLUSTER_MIN_SIZE;
      const strongest = group.entries[0];
      const highSalience = toFiniteNumber(strongest?.salience, 0) >= DEFAULT_MEMORY_PROMOTION_SALIENCE_THRESHOLD;
      const frequentlyRecalled = Math.floor(toFiniteNumber(strongest?.memoryDynamics?.recallCount, 0)) >= DEFAULT_MEMORY_PROMOTION_RECALL_THRESHOLD;
      return hasCluster || highSalience || frequentlyRecalled;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, DEFAULT_MEMORY_REPLAY_MAX_PATTERNS);

  const writes = [];
  for (const group of groups) {
    const replaySummary = buildPassportReplaySummary(group);
    const fieldKey = `replay:${normalizeComparableText(group.groupKey).slice(0, 72) || "pattern"}`;
    const record = normalizePassportMemoryRecord(agent.agentId, {
      layer: "semantic",
      kind: "replay_consolidated_pattern",
      summary: `回放巩固：${replaySummary[0] || group.groupKey}`,
      content: replaySummary.join("\n"),
      payload: {
        field: fieldKey,
        currentGoal: normalizeOptionalText(currentGoal) ?? null,
        sourcePassportMemoryIds: group.entries.map((entry) => entry.passportMemoryId),
        replaySummary,
        patternKey: group.groupKey,
        boundaryLabels: group.boundaryLabels,
        sourceTypes: group.sourceTypes,
      },
      tags: ["semantic", "replay", "consolidated", ...group.boundaryLabels.slice(0, 2)],
      sourceWindowId,
      salience: Math.max(0.72, Math.min(0.96, Number(group.score.toFixed(2)))),
      confidence: Math.max(
        0.68,
        Math.min(
          0.94,
          Number(
            (
              group.entries.reduce((sum, entry) => sum + toFiniteNumber(entry?.confidence, 0.5), 0) /
              Math.max(1, group.entries.length)
            ).toFixed(2)
          )
        )
      ),
      sourceType: "derived",
      consolidationState: "consolidated",
      boundaryLabel: group.boundaryLabels[0] ?? null,
      patternKey: group.groupKey,
      separationKey: `semantic:${normalizeComparableText(group.groupKey).slice(0, 72) || "pattern"}`,
      memoryDynamics: {
        consolidationTier: "long_term",
        promotionCount: 1,
        recallCount: group.entries.reduce((sum, entry) => sum + Math.floor(toFiniteNumber(entry?.memoryDynamics?.recallCount, 0)), 0),
        strengthScore: Math.max(0.72, Math.min(0.95, Number(group.score.toFixed(2)))),
        salienceScore: Math.max(0.74, Math.min(0.96, Number(group.score.toFixed(2)))),
      },
    });
    applyPassportMemorySupersession(store, agent.agentId, record);
    store.passportMemories.push(record);
    writes.push(record);

    for (const entry of group.entries) {
      if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
        entry.memoryDynamics = {};
      }
      entry.memoryDynamics.consolidationTier = entry.layer === "working" ? "mid_term" : "long_term";
      entry.memoryDynamics.promotionCount = Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.promotionCount, 0))) + 1;
      entry.memoryDynamics.lastConsolidatedAt = now();
      entry.memoryDynamics.lastReplayedAt = now();
    }
  }

  return {
    replayedPatternCount: writes.length,
    replayedMemoryIds: writes.map((entry) => entry.passportMemoryId),
  };
}

function applyAdaptivePassportMemoryForgetting(
  store,
  agentId,
  {
    referenceTime = now(),
    cognitiveState = null,
  } = {}
) {
  const forgottenMemoryIds = [];
  const decayedMemoryIds = [];
  const protectedWorkingIds = new Set(
    listAgentPassportMemories(store, agentId, { layer: "working" })
      .filter((entry) => isPassportMemoryActive(entry))
      .slice(-DEFAULT_MEMORY_FORGETTING_RETAIN_COUNT)
      .map((entry) => entry.passportMemoryId)
      .filter(Boolean)
  );

  for (const entry of store.passportMemories || []) {
    const normalizedStatus = normalizeOptionalText(entry?.status) ?? "";
    const decayedBookkeepingGap =
      normalizedStatus === "decayed" &&
      (!normalizeOptionalText(entry?.memoryDynamics?.forgettingReason) || !entry?.memoryDynamics?.lastForgettingThresholds);
    if (entry.agentId !== agentId || (!isPassportMemoryActive(entry) && !decayedBookkeepingGap)) {
      continue;
    }
    const ageDays = toFiniteNumber(entry?.memoryDynamics?.ageDays, 0);
    const detailRetentionScore = toFiniteNumber(entry?.memoryDynamics?.detailRetentionScore, 1);
    const strengthScore = toFiniteNumber(entry?.memoryDynamics?.strengthScore, 1);
    const recallCount = Math.floor(toFiniteNumber(entry?.memoryDynamics?.recallCount, 0));
    const promotionCount = Math.floor(toFiniteNumber(entry?.memoryDynamics?.promotionCount, 0));
    const cognitiveBias = buildPassportCognitiveBias(entry, {
      cognitiveState,
      referenceTime,
    });
    const detailThresholdShift = (cognitiveBias.forgettingPressure * 0.08) - (cognitiveBias.replayProtection * 0.12);
    const strengthThresholdShift = (cognitiveBias.forgettingPressure * 0.06) - (cognitiveBias.replayProtection * 0.1);
    const workingDetailThreshold = 0.42 + detailThresholdShift;
    const workingStrengthThreshold = 0.34 + strengthThresholdShift;
    const episodicDetailThreshold = 0.32 + detailThresholdShift;
    const episodicStrengthThreshold = 0.28 + strengthThresholdShift;
    const semanticDetailThreshold = 0.24 + detailThresholdShift;
    const semanticStrengthThreshold = 0.22 + strengthThresholdShift;
    const decaySuggested =
      entry.layer === "working" && normalizeOptionalText(entry?.memoryDynamics?.decaySuggestedStatus) === "decayed";

    let nextStatus = null;
    let forgettingReason = "adaptive_forgetting";
    if (
      entry.layer === "working" &&
      !protectedWorkingIds.has(entry.passportMemoryId) &&
      ageDays >= DEFAULT_WORKING_MEMORY_FORGET_AGE_DAYS &&
      detailRetentionScore < workingDetailThreshold &&
      strengthScore < workingStrengthThreshold &&
      !["checkpoint_summary", "openneed_flow_checkpoint"].includes(normalizeOptionalText(entry.kind) ?? "")
    ) {
      nextStatus = "forgotten";
      forgettingReason = "adaptive_forgetting";
    } else if (
      entry.layer === "episodic" &&
      ageDays >= DEFAULT_EPISODIC_MEMORY_FORGET_AGE_DAYS &&
      detailRetentionScore < episodicDetailThreshold &&
      strengthScore < episodicStrengthThreshold &&
      recallCount === 0 &&
      promotionCount === 0
    ) {
      nextStatus = "decayed";
      forgettingReason = "adaptive_forgetting";
    } else if (
      entry.layer === "semantic" &&
      ageDays >= DEFAULT_SEMANTIC_MEMORY_FORGET_AGE_DAYS &&
      detailRetentionScore < semanticDetailThreshold &&
      strengthScore < semanticStrengthThreshold &&
      recallCount === 0 &&
      normalizeOptionalText(entry.sourceType) !== "verified"
    ) {
      nextStatus = "decayed";
      forgettingReason = "adaptive_forgetting";
    } else if (decaySuggested || decayedBookkeepingGap) {
      nextStatus = "decayed";
      forgettingReason = "temporal_decay";
    }

    if (!nextStatus) {
      continue;
    }
    entry.status = nextStatus;
    if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
      entry.memoryDynamics = {};
    }
    entry.memoryDynamics.forgottenAt = referenceTime;
    entry.memoryDynamics.forgettingReason = forgettingReason;
    entry.memoryDynamics.lastForgettingSignal = {
      forgettingPressure: cognitiveBias.forgettingPressure,
      replayProtection: cognitiveBias.replayProtection,
      dominantRhythm: cognitiveBias.dominantRhythm,
      replayMode: cognitiveBias.replayMode,
      targetMatches: cognitiveBias.targetMatches,
    };
    entry.memoryDynamics.lastForgettingThresholds = {
      detailRetention: Number(
        (entry.layer === "working"
          ? workingDetailThreshold
          : entry.layer === "episodic"
            ? episodicDetailThreshold
            : semanticDetailThreshold).toFixed(2)
      ),
      strength: Number(
        (entry.layer === "working"
          ? workingStrengthThreshold
          : entry.layer === "episodic"
            ? episodicStrengthThreshold
          : semanticStrengthThreshold).toFixed(2)
      ),
    };
    delete entry.memoryDynamics.decaySuggestedStatus;
    delete entry.memoryDynamics.decaySuggestedAt;
    if (nextStatus === "forgotten") {
      forgottenMemoryIds.push(entry.passportMemoryId);
    } else {
      decayedMemoryIds.push(entry.passportMemoryId);
    }
  }

  return {
    forgottenMemoryIds,
    decayedMemoryIds,
  };
}

const TRANSCRIPT_MODEL_DEPS = Object.freeze({
  listAgentTranscriptEntries,
});

function pruneObsoleteModelProfiles(store, profile = null) {
  if (!Array.isArray(store.modelProfiles) || !isOperationalMemoryHomeostasisProfile(profile)) {
    return 0;
  }
  const normalizedProfile = normalizeModelProfileRecord(profile);
  const normalizedModelName = displayAgentPassportLocalReasonerModel(
    normalizedProfile.modelName,
    normalizedProfile.modelName
  );
  const beforeCount = store.modelProfiles.length;
  store.modelProfiles = store.modelProfiles.filter((candidate) => {
    const normalizedCandidate = normalizeModelProfileRecord(candidate);
    if (normalizedCandidate.modelProfileId === normalizedProfile.modelProfileId) {
      return true;
    }
    const candidateModelName = displayAgentPassportLocalReasonerModel(
      normalizedCandidate.modelName,
      normalizedCandidate.modelName
    );
    if (candidateModelName !== normalizedModelName) {
      return true;
    }
    return isOperationalMemoryHomeostasisProfile(normalizedCandidate);
  });
  return Math.max(0, beforeCount - store.modelProfiles.length);
}

const RUNTIME_MEMORY_STORE_ADAPTER = Object.freeze({
  buildAgentScopedDerivedCacheKey,
  buildCollectionTailToken,
  cacheStoreDerivedView,
  matchesCompatibleAgentId,
});

function buildRuntimeSearchCorpus(
  store,
  agent,
  {
    didMethod = null,
    recentOnly = true,
    knowledgeWindowLimit = DEFAULT_RUNTIME_KNOWLEDGE_WINDOW_LIMIT,
    passportMemoryWindowLimit = DEFAULT_RUNTIME_PASSPORT_MEMORY_WINDOW_LIMIT,
    compactBoundaryWindowLimit = DEFAULT_RUNTIME_COMPACT_BOUNDARY_WINDOW_LIMIT,
  } = {}
) {
  const normalizedDidMethod = normalizeDidMethod(didMethod, null);
  const cacheToken = hashJson({
    didMethod: normalizedDidMethod,
    recentOnly: Boolean(recentOnly),
    knowledgeWindowLimit,
    passportMemoryWindowLimit,
    compactBoundaryWindowLimit,
    compactBoundaries: buildCollectionTailToken(store?.compactBoundaries || [], {
      idFields: ["compactBoundaryId"],
      timeFields: ["createdAt"],
    }),
    passportMemories: buildCollectionTailToken(store?.passportMemories || [], {
      idFields: ["passportMemoryId"],
      timeFields: ["recordedAt"],
    }),
    conversationMinutes: buildCollectionTailToken(store?.conversationMinutes || [], {
      idFields: ["minuteId"],
      timeFields: ["recordedAt"],
    }),
    taskSnapshots: buildCollectionTailToken(store?.taskSnapshots || [], {
      idFields: ["snapshotId"],
      timeFields: ["updatedAt", "createdAt"],
    }),
    decisionLogs: buildCollectionTailToken(store?.decisionLogs || [], {
      idFields: ["decisionId"],
      timeFields: ["recordedAt"],
    }),
    evidenceRefs: buildCollectionTailToken(store?.evidenceRefs || [], {
      idFields: ["evidenceRefId"],
      timeFields: ["recordedAt"],
    }),
  });
  const cacheKey = buildAgentScopedDerivedCacheKey("runtime_search_corpus", store, agent.agentId, cacheToken);
  return cacheStoreDerivedView(store, cacheKey, () => {
    const compactBoundaries = takeRecentEntries(
      listAgentCompactBoundariesFromStore(store, agent.agentId),
      recentOnly ? compactBoundaryWindowLimit : null
    );
    const passportMemories = takeRecentEntries(
      listAgentPassportMemories(store, agent.agentId).filter((entry) => isPassportMemoryActive(entry)),
      recentOnly ? passportMemoryWindowLimit : null
    );
    const conversationMinutes = takeRecentEntries(
      listAgentConversationMinutes(store, agent.agentId),
      recentOnly ? knowledgeWindowLimit : null
    );
    const taskSnapshots = takeRecentEntries(
      listAgentTaskSnapshots(store, agent.agentId),
      recentOnly ? knowledgeWindowLimit : null
    );
    const decisions = takeRecentEntries(
      listAgentDecisionLogs(store, agent.agentId),
      recentOnly ? knowledgeWindowLimit : null
    );
    const evidenceRefs = takeRecentEntries(
      listAgentEvidenceRefs(store, agent.agentId),
      recentOnly ? knowledgeWindowLimit : null
    );

    return [
      ...conversationMinutes.map((minute) =>
        buildRuntimeSearchHit({
          sourceType: "conversation_minute",
          sourceId: minute.minuteId,
          title: minute.title || minute.summary || minute.minuteId,
          summary: minute.summary || minute.title,
          excerpt: minute.transcript || minute.summary || minute.title,
          text: [
            minute.title,
            minute.summary,
            minute.transcript,
            ...(minute.highlights || []),
            ...(minute.actionItems || []),
            ...(minute.tags || []),
          ]
            .filter(Boolean)
            .join(" "),
          score: 0,
          recordedAt: minute.recordedAt,
          tags: minute.tags,
          linked: {
            minuteId: minute.minuteId,
            sourceWindowId: minute.sourceWindowId,
            linkedTaskSnapshotId: minute.linkedTaskSnapshotId,
            linkedDecisionIds: minute.linkedDecisionIds,
            linkedEvidenceRefIds: minute.linkedEvidenceRefIds,
          },
        })
      ),
      ...taskSnapshots.map((snapshot) =>
        buildRuntimeSearchHit({
          sourceType: "task_snapshot",
          sourceId: snapshot.snapshotId,
          title: snapshot.title || snapshot.objective || snapshot.snapshotId,
          summary: snapshot.objective || snapshot.nextAction || snapshot.checkpointSummary,
          excerpt: snapshot.checkpointSummary || snapshot.nextAction || snapshot.objective,
          text: [
            snapshot.title,
            snapshot.objective,
            snapshot.status,
            ...(snapshot.currentPlan || []),
            snapshot.nextAction,
            ...(snapshot.constraints || []),
            ...(snapshot.successCriteria || []),
            snapshot.checkpointSummary,
            ...(snapshot.tags || []),
          ]
            .filter(Boolean)
            .join(" "),
          score: 0,
          recordedAt: snapshot.updatedAt || snapshot.createdAt,
          tags: snapshot.tags,
          linked: {
            snapshotId: snapshot.snapshotId,
            sourceWindowId: snapshot.sourceWindowId,
          },
        })
      ),
      ...decisions.map((decision) =>
        buildRuntimeSearchHit({
          sourceType: "decision",
          sourceId: decision.decisionId,
          title: decision.summary || decision.decisionId,
          summary: decision.rationale || decision.summary,
          excerpt: decision.rationale || decision.summary,
          text: [
            decision.summary,
            decision.rationale,
            decision.scope,
            ...(decision.tags || []),
            ...(decision.relatedEvidenceRefIds || []),
          ]
            .filter(Boolean)
            .join(" "),
          score: 0,
          recordedAt: decision.recordedAt,
          tags: decision.tags,
          linked: {
            decisionId: decision.decisionId,
            relatedSnapshotId: decision.relatedSnapshotId,
            relatedEvidenceRefIds: decision.relatedEvidenceRefIds,
            sourceWindowId: decision.sourceWindowId,
          },
        })
      ),
      ...evidenceRefs.map((evidenceRef) =>
        buildRuntimeSearchHit({
          sourceType: "evidence",
          sourceId: evidenceRef.evidenceRefId,
          title: evidenceRef.title || evidenceRef.uri || evidenceRef.evidenceRefId,
          summary: evidenceRef.summary || evidenceRef.uri || evidenceRef.title,
          excerpt: evidenceRef.summary || evidenceRef.uri || evidenceRef.title,
          text: [
            evidenceRef.kind,
            evidenceRef.title,
            evidenceRef.summary,
            evidenceRef.uri,
            ...(evidenceRef.tags || []),
          ]
            .filter(Boolean)
            .join(" "),
          score: 0,
          recordedAt: evidenceRef.recordedAt,
          tags: evidenceRef.tags,
          linked: {
            evidenceRefId: evidenceRef.evidenceRefId,
            linkedCredentialId: evidenceRef.linkedCredentialId,
            linkedProposalId: evidenceRef.linkedProposalId,
            linkedWindowId: evidenceRef.linkedWindowId,
            sourceWindowId: evidenceRef.sourceWindowId,
          },
        })
      ),
      ...passportMemories.map((memory) =>
        buildRuntimeSearchHit({
          sourceType: "passport_memory",
          sourceId: memory.passportMemoryId,
          title: memory.summary || memory.kind || memory.passportMemoryId,
          summary: memory.content || memory.summary || memory.kind,
          excerpt: memory.content || memory.summary || memory.kind,
          text: [
            memory.layer,
            memory.kind,
            memory.summary,
            memory.content,
            memory.sourceType,
            memory.consolidationState,
            memory.boundaryLabel,
            ...(memory.tags || []),
            ...Object.values(memory.payload || {}).filter((value) => typeof value === "string"),
          ]
            .filter(Boolean)
            .join(" "),
          score: 0,
          recordedAt: memory.recordedAt,
          tags: memory.tags,
          linked: {
            passportMemoryId: memory.passportMemoryId,
            layer: memory.layer,
            kind: memory.kind,
            sourceType: memory.sourceType,
            sourceWindowId: memory.sourceWindowId,
          },
        })
      ),
      ...compactBoundaries.map((boundary) => {
        const resumeView = buildCompactBoundaryResumeView(store, agent, boundary.compactBoundaryId);
        return buildRuntimeSearchHit({
          sourceType: "compact_boundary",
          sourceId: boundary.compactBoundaryId,
          title: boundary.summary || boundary.compactBoundaryId,
          summary: boundary.currentGoal || boundary.summary || boundary.compactBoundaryId,
          excerpt: resumeView?.checkpointSummary || boundary.summary || boundary.currentGoal,
          text: [
            boundary.compactBoundaryId,
            boundary.summary,
            boundary.currentGoal,
            resumeView?.checkpointSummary,
            resumeView?.recoveryPrompt,
            boundary.didMethod || normalizedDidMethod,
          ]
            .filter(Boolean)
            .join(" "),
          score: 0,
          recordedAt: boundary.createdAt,
          tags: ["compact_boundary", boundary.didMethod || normalizedDidMethod || "unknown"],
          linked: {
            compactBoundaryId: boundary.compactBoundaryId,
            previousCompactBoundaryId: boundary.previousCompactBoundaryId,
            resumedFromCompactBoundaryId: boundary.resumedFromCompactBoundaryId,
            checkpointMemoryId: boundary.checkpointMemoryId,
            sourceWindowId: boundary.sourceWindowId,
          },
        });
      }),
    ];
  });
}

function searchAgentRuntimeKnowledgeFromStore(
  store,
  agent,
  {
    didMethod = null,
    query = null,
    limit = DEFAULT_RUNTIME_SEARCH_LIMIT,
    sourceType = null,
    includeExternalColdMemory = false,
    recentOnly = true,
    knowledgeWindowLimit = DEFAULT_RUNTIME_KNOWLEDGE_WINDOW_LIMIT,
    passportMemoryWindowLimit = DEFAULT_RUNTIME_PASSPORT_MEMORY_WINDOW_LIMIT,
    compactBoundaryWindowLimit = DEFAULT_RUNTIME_COMPACT_BOUNDARY_WINDOW_LIMIT,
  } = {}
) {
  const queryText = normalizeOptionalText(query) ?? null;
  const normalizedSourceType = normalizeRuntimeSearchSourceType(sourceType);
  const deviceRuntime = normalizeDeviceRuntime(store.deviceRuntime);
  const retrievalPolicy = normalizeRuntimeRetrievalPolicy(deviceRuntime.retrievalPolicy);
  const cappedLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.floor(Number(limit))
      : retrievalPolicy.maxHits || DEFAULT_RUNTIME_SEARCH_LIMIT;
  const localCorpus = buildRuntimeSearchCorpus(store, agent, {
    didMethod,
    recentOnly,
    knowledgeWindowLimit,
    passportMemoryWindowLimit,
    compactBoundaryWindowLimit,
  }).filter((entry) =>
    normalizedSourceType ? entry.sourceType === normalizedSourceType : true
  );
  const shouldSearchExternal =
    Boolean(includeExternalColdMemory) || normalizedSourceType === "external_cold_memory";
  const externalColdMemorySearch =
    !queryText || !shouldSearchExternal
      ? {
          enabled: Boolean(retrievalPolicy.externalColdMemory?.enabled),
          used: false,
          provider: retrievalPolicy.externalColdMemory?.provider ?? null,
          method: null,
          hits: [],
          error: null,
        }
      : searchMempalaceColdMemory(queryText, retrievalPolicy.externalColdMemory);
  const externalCorpus = Array.isArray(externalColdMemorySearch.hits)
    ? externalColdMemorySearch.hits.map((entry) =>
        buildRuntimeSearchHit({
          sourceType: "external_cold_memory",
          sourceId: entry.sourceId,
          title: entry.title,
          summary: entry.summary,
          excerpt: entry.excerpt,
          text: entry.text,
          providerScore: entry.providerScore,
          candidateOnly: entry.candidateOnly,
          tags: entry.tags,
          linked: entry.linked,
        })
      )
    : [];
  const scoredLocal = scoreRuntimeSearchCorpus(localCorpus, queryText, retrievalPolicy, cappedLimit);
  const scoredExternal = scoreRuntimeSearchCorpus(
    externalCorpus,
    queryText,
    retrievalPolicy,
    normalizedSourceType === "external_cold_memory" ? cappedLimit : externalCorpus.length
  );
  const scored =
    normalizedSourceType === "external_cold_memory"
      ? scoredExternal
      : includeExternalColdMemory
        ? [...scoredLocal, ...scoredExternal]
        : scoredLocal;

  const counts = scored.reduce(
    (acc, entry) => {
      acc.bySource[entry.sourceType] = (acc.bySource[entry.sourceType] || 0) + 1;
      if (entry.sourceType === "external_cold_memory") {
        acc.externalMatched += 1;
      } else {
        acc.localMatched += 1;
      }
      return acc;
    },
    {
      total: localCorpus.length + externalCorpus.length,
      matched: scored.length,
      bySource: {},
      localCorpusTotal: localCorpus.length,
      externalCandidateTotal: externalCorpus.length,
      localMatched: 0,
      externalMatched: 0,
    }
  );

  const suggestedResumeBoundaryId =
    scored.find((entry) => entry.sourceType === "compact_boundary")?.linked?.compactBoundaryId ?? null;

  return {
    query: queryText,
    sourceType: normalizedSourceType,
    hits: scored,
    counts,
    suggestedResumeBoundaryId,
    retrieval: {
      strategy: retrievalPolicy.strategy,
      scorer: retrievalPolicy.scorer,
      localFirst: true,
      vectorIndexEnabled: Boolean(retrievalPolicy.allowVectorIndex),
      vectorUsed: false,
      preferStructuredMemory: Boolean(retrievalPolicy.preferStructuredMemory),
      preferConversationMinutes: Boolean(retrievalPolicy.preferConversationMinutes),
      preferCompactBoundaries: Boolean(retrievalPolicy.preferCompactBoundaries),
      externalColdMemoryEnabled: Boolean(retrievalPolicy.externalColdMemory?.enabled),
      externalColdMemoryProvider: retrievalPolicy.externalColdMemory?.provider ?? null,
      externalColdMemoryUsed: Boolean(externalColdMemorySearch.used),
      externalColdMemoryMethod: externalColdMemorySearch.method ?? null,
      externalColdMemoryHitCount: counts.externalMatched,
      externalColdMemoryCandidateCount: externalCorpus.length,
      externalColdMemoryError: externalColdMemorySearch.error ?? null,
      hitCount: scored.length,
      maxHits: cappedLimit,
    },
  };
}

function clampUnitInterval(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number(Math.max(0, Math.min(1, fallback)).toFixed(2));
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(2));
}

function listAgentGoalStatesFromStore(store, agentId) {
  return (store.goalStates || [])
    .filter((state) => matchesCompatibleAgentId(store, state.agentId, agentId))
    .sort((a, b) => (a.updatedAt || a.createdAt || "").localeCompare(b.updatedAt || b.createdAt || ""));
}

function upsertAgentGoalState(store, goalState, { persist = true } = {}) {
  if (!goalState) {
    return null;
  }
  if (!persist) {
    return goalState;
  }
  if (!Array.isArray(store.goalStates)) {
    store.goalStates = [];
  }
  const existingIndex = store.goalStates.findIndex((state) => state.agentId === goalState.agentId);
  if (existingIndex >= 0) {
    store.goalStates[existingIndex] = goalState;
  } else {
    store.goalStates.push(goalState);
  }
  return goalState;
}

function buildGoalKeeperState(
  store,
  agent,
  {
    currentGoal = null,
    contextBuilder = null,
    queryState = null,
    driftCheck = null,
    negotiation = null,
    run = null,
    sourceWindowId = null,
  } = {}
) {
  const existing = listAgentGoalStatesFromStore(store, agent.agentId).at(-1) ?? null;
  const taskSnapshot = contextBuilder?.slots?.identitySnapshot?.taskSnapshot ?? latestAgentTaskSnapshot(store, agent.agentId) ?? null;
  const goalText =
    normalizeOptionalText(currentGoal) ??
    normalizeOptionalText(queryState?.currentGoal) ??
    normalizeOptionalText(taskSnapshot?.objective) ??
    normalizeOptionalText(taskSnapshot?.title) ??
    existing?.primaryGoal ??
    null;
  const blockers = [];
  if (driftCheck?.requiresRehydrate) blockers.push("needs_rehydrate");
  if (driftCheck?.requiresHumanReview) blockers.push("needs_human_review");
  if (negotiation?.decision && !["execute", "continue"].includes(negotiation.decision)) blockers.push(`negotiation_${negotiation.decision}`);
  if (run?.status && !["completed", "prepared"].includes(run.status)) blockers.push(`run_${run.status}`);
  const subgoals = normalizeTextList([
    taskSnapshot?.nextAction,
    queryState?.recommendedActions?.[0],
    negotiation?.recommendedNextStep,
  ]).slice(0, 4);

  return {
    goalStateId: existing?.goalStateId || createRecordId("goal"),
    agentId: agent.agentId,
    primaryGoal: goalText,
    subgoals,
    blockers,
    priority: blockers.length > 0 ? "high" : "normal",
    completionSignal:
      run?.status === "completed"
        ? "run_completed"
        : driftCheck?.requiresRehydrate
          ? "resume_required"
          : queryState?.status || existing?.completionSignal || "in_progress",
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? existing?.sourceWindowId ?? null,
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
  };
}

function buildSelfEvaluation({
  run = null,
  driftCheck = null,
  verification = null,
  negotiation = null,
  contextBuilder = null,
} = {}) {
  const budget = contextBuilder?.slots?.queryBudget || {};
  const informationSufficiency = clampScore(
    85 -
      (driftCheck?.requiresRehydrate ? 22 : 0) -
      (driftCheck?.requiresHumanReview ? 18 : 0) -
      ((budget.recentConversationTurnsTruncated ? 1 : 0) * 8) -
      ((budget.toolResultsTruncated ? 1 : 0) * 6)
  );
  const confidence = clampScore(
    82 -
      (verification?.valid === false ? 30 : 0) -
      (driftCheck?.driftScore || 0) * 6 -
      (negotiation?.riskTier === "critical" ? 12 : negotiation?.riskTier === "high" ? 8 : 0)
  );
  const shouldPause =
    verification?.valid === false ||
    driftCheck?.requiresHumanReview ||
    Boolean(negotiation?.decision && ["confirm", "multisig", "blocked"].includes(negotiation.decision));
  const continuationDecision = shouldPause
    ? "pause_and_review"
    : driftCheck?.requiresRehydrate
      ? "recover_context_first"
      : "continue";

  return {
    informationSufficiency,
    confidence,
    shouldPause,
    continuationDecision,
    consistencyWithIdentity:
      verification?.valid === false ? "identity_conflict" : driftCheck?.requiresRehydrate ? "needs_context_restore" : "consistent",
    checkedAt: now(),
  };
}

function resolveCognitiveStrategy({
  cognitiveMode = "stable",
  selfEvaluation = null,
  negotiation = null,
  driftCheck = null,
  goalState = null,
} = {}) {
  const strategyName =
    cognitiveMode === "recovering"
      ? "recovery_first"
      : cognitiveMode === "self_calibrating"
        ? "conservative_identity_guard"
        : cognitiveMode === "learning"
          ? "observe_and_update"
          : cognitiveMode === "bootstrap_required" || cognitiveMode === "resident_locked"
            ? "gated_bootstrap"
            : "goal_execution";
  return {
    strategyName,
    priorities:
      strategyName === "recovery_first"
        ? ["restore_context", "preserve_identity", "resume_goal"]
        : strategyName === "conservative_identity_guard"
          ? ["verify_identity", "avoid_overclaiming", "ask_for_grounding"]
          : strategyName === "observe_and_update"
            ? ["advance_goal", "learn_preferences", "compress_trace"]
            : strategyName === "gated_bootstrap"
              ? ["satisfy_gate", "bind_resident", "load_bootstrap_pack"]
              : ["advance_goal", "preserve_continuity", "minimize_drift"],
    answerPolicy: selfEvaluation?.shouldPause ? "conservative" : "grounded",
    recoveryPolicy: driftCheck?.requiresRehydrate ? "resume_from_boundary" : "continue_with_snapshot",
    negotiationPolicy: negotiation?.decision || "continue",
    goalPriority: goalState?.priority || "normal",
  };
}

function buildThoughtTraceRecord(
  agent,
  {
    goalState = null,
    run = null,
    queryState = null,
    cognitiveState = null,
    selfEvaluation = null,
    strategyProfile = null,
    sourceWindowId = null,
  } = {}
) {
  return {
    reflectionId: createRecordId("trace"),
    reflectionType: "thought_trace",
    agentId: agent.agentId,
    goalStateId: goalState?.goalStateId ?? null,
    runId: run?.runId ?? null,
    queryStateId: queryState?.queryStateId ?? null,
    cognitiveStateId: cognitiveState?.cognitiveStateId ?? null,
    summary: `${strategyProfile?.strategyName || "goal_execution"} -> ${run?.status || "prepared"}`,
    compressedTrace: {
      primaryGoal: goalState?.primaryGoal ?? null,
      mode: cognitiveState?.mode ?? null,
      dominantStage: cognitiveState?.dominantStage ?? null,
      strategy: strategyProfile?.strategyName ?? null,
      continuationDecision: selfEvaluation?.continuationDecision ?? null,
      outcome: run?.status ?? null,
    },
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
    createdAt: now(),
  };
}

function buildFailureReflection(
  agent,
  {
    goalState = null,
    run = null,
    driftCheck = null,
    verification = null,
    negotiation = null,
    bootstrapGate = null,
    reasoner = null,
    sandboxExecution = null,
    strategyProfile = null,
    sourceWindowId = null,
  } = {}
) {
  const failing =
    verification?.valid === false ||
    driftCheck?.requiresRehydrate ||
    driftCheck?.requiresHumanReview ||
    Boolean(run?.status && ["blocked", "needs_human_review", "rehydrate_required"].includes(run.status));
  if (!failing) {
    return null;
  }

  const reasonerError = normalizeOptionalText(reasoner?.error) ?? null;
  const sandboxError = normalizeOptionalText(sandboxExecution?.error) ?? null;
  const sandboxBlocked = Array.isArray(negotiation?.sandboxBlockedReasons) && negotiation.sandboxBlockedReasons.length > 0;

  let failureReason = run?.status || "unknown";
  let wrongAssumption = "current plan could execute without extra review";
  let missingMemory = null;
  let nextRecoveryAction =
    driftCheck?.recommendedActions?.[0] ??
    negotiation?.recommendedNextStep ??
    "request_human_review";
  let preventionHint = "verify identity and evidence before high confidence output";

  if (verification?.valid === false) {
    failureReason = "verification_failed";
    wrongAssumption = "identity grounding was insufficient";
    missingMemory = "identity or ledger grounding";
  } else if (driftCheck?.requiresRehydrate) {
    failureReason = "context_drift";
    wrongAssumption = "current snapshot was enough to continue";
    missingMemory = "compact boundary or relevant episodic memory";
    nextRecoveryAction = "reload_rehydrate_pack";
  } else if (bootstrapGate?.required) {
    failureReason = "bootstrap_required";
    wrongAssumption = "the runtime already had a minimum bootstrap pack";
    missingMemory = "minimum runtime bootstrap pack";
    nextRecoveryAction = "bootstrap_runtime";
    preventionHint = "keep a resident bootstrap pack fresh before long runs";
  } else if (reasonerError) {
    failureReason = "reasoner_unavailable";
    wrongAssumption = "the selected local reasoner path was ready for execution";
    missingMemory = "healthy local reasoner runtime";
    nextRecoveryAction = "restore_local_reasoner";
    preventionHint = "probe or prewarm the selected local reasoner before relying on it";
  } else if (sandboxError || sandboxBlocked) {
    failureReason = sandboxError ? "sandbox_execution_failed" : "sandbox_execution_blocked";
    wrongAssumption = "the constrained execution path could run directly";
    missingMemory = "safe non-executing fallback path";
    nextRecoveryAction = "retry_without_execution";
    preventionHint = "prepare a discuss-first path before attempting constrained execution";
  } else if (driftCheck?.requiresHumanReview) {
    failureReason = "human_review_required";
  } else if (strategyProfile?.strategyName === "recovery_first") {
    preventionHint = "increase checkpoint usage and resume earlier";
  }

  return {
    reflectionId: createRecordId("refl"),
    reflectionType: "failure_reflection",
    agentId: agent.agentId,
    goalStateId: goalState?.goalStateId ?? null,
    runId: run?.runId ?? null,
    summary: `failure loop: ${run?.status || "unknown"}`,
    failureReason,
    wrongAssumption,
    missingMemory,
    nextRecoveryAction,
    preventionHint,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
    createdAt: now(),
  };
}

function appendCognitiveReflections(store, reflections = []) {
  if (!Array.isArray(store.cognitiveReflections)) {
    store.cognitiveReflections = [];
  }
  const normalized = reflections.filter(Boolean);
  if (normalized.length > 0) {
    store.cognitiveReflections.push(...normalized);
  }
  return normalized;
}

function recordRetrievalFeedbackInStore(
  store,
  agent,
  {
    query = null,
    contextBuilder = null,
    sourceWindowId = null,
    persist = true,
  } = {}
) {
  const continuousCognitiveState =
    contextBuilder?.slots?.continuousCognitiveState && typeof contextBuilder.slots.continuousCognitiveState === "object"
      ? contextBuilder.slots.continuousCognitiveState
      : null;
  const recalledIds = new Set();
  const reactivatedNeighborIds = new Set();
  const recalledEntries = [
    ...(contextBuilder?.memoryLayers?.relevant?.profile || []),
    ...(contextBuilder?.memoryLayers?.relevant?.episodic || []),
    ...(contextBuilder?.memoryLayers?.relevant?.semantic || []),
    ...(contextBuilder?.memoryLayers?.working?.entries || []).slice(-3),
  ].filter((entry) => entry?.passportMemoryId);

  for (const entry of recalledEntries) {
    const liveEntry = (store.passportMemories || []).find((item) => item.passportMemoryId === entry.passportMemoryId);
    if (!liveEntry) {
      continue;
    }
    if (persist) {
      reinforcePassportMemoryRecord(liveEntry, {
        useful: true,
        currentGoal: contextBuilder?.slots?.currentGoal ?? null,
        queryText: query,
        cognitiveState: continuousCognitiveState,
      });
    }
    recalledIds.add(liveEntry.passportMemoryId);

    for (const neighbor of store.passportMemories || []) {
      if (
        neighbor.agentId !== agent.agentId ||
        neighbor.passportMemoryId === liveEntry.passportMemoryId ||
        !isPassportMemoryActive(neighbor)
      ) {
        continue;
      }
      const sameField =
        normalizeOptionalText(neighbor?.payload?.field) &&
        normalizeOptionalText(neighbor?.payload?.field) === normalizeOptionalText(liveEntry?.payload?.field);
      const samePattern =
        normalizeOptionalText(neighbor?.patternKey) &&
        normalizeOptionalText(neighbor?.patternKey) === normalizeOptionalText(liveEntry?.patternKey);
      const sameSeparation =
        normalizeOptionalText(neighbor?.separationKey) &&
        normalizeOptionalText(neighbor?.separationKey) === normalizeOptionalText(liveEntry?.separationKey);
      if (!sameField && !samePattern && !sameSeparation) {
        continue;
      }
      if (persist) {
        destabilizePassportMemoryRecord(neighbor, {
          recalledAt: now(),
          clusterCue: true,
        });
      }
      reactivatedNeighborIds.add(neighbor.passportMemoryId);
    }
  }

  const feedback = {
    feedbackId: createRecordId("rtfb"),
    agentId: agent.agentId,
    query: normalizeOptionalText(query) ?? null,
    recalledMemoryIds: Array.from(recalledIds),
    reactivatedNeighborIds: Array.from(reactivatedNeighborIds),
    hitCount: recalledIds.size,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
    createdAt: now(),
  };
  if (persist) {
    if (!Array.isArray(store.retrievalFeedback)) {
      store.retrievalFeedback = [];
    }
    store.retrievalFeedback.push(feedback);
  }
  return feedback;
}

function scoreRecoveryCompactBoundaryLink(boundary, { run = null, currentGoal = null } = {}) {
  if (!boundary || typeof boundary !== "object") {
    return 0;
  }

  let score = 0;
  const normalizedRunId = normalizeOptionalText(run?.runId) ?? null;
  const normalizedResumeBoundaryId = normalizeOptionalText(run?.resumeBoundaryId) ?? null;
  const normalizedContextHash = normalizeOptionalText(run?.contextHash) ?? null;
  const normalizedSourceWindowId = normalizeOptionalText(run?.sourceWindowId) ?? null;
  const normalizedBoundaryId = normalizeOptionalText(boundary?.compactBoundaryId) ?? null;
  const normalizedBoundaryRunId = normalizeOptionalText(boundary?.runId) ?? null;
  const normalizedBoundaryContextHash = normalizeOptionalText(boundary?.contextHash) ?? null;
  const normalizedBoundarySourceWindowId = normalizeOptionalText(boundary?.sourceWindowId) ?? null;
  const normalizedGoal = normalizeOptionalText(currentGoal || run?.currentGoal) ?? null;
  const normalizedBoundaryGoal = normalizeOptionalText(boundary?.currentGoal) ?? null;

  if (normalizedRunId && normalizedBoundaryRunId === normalizedRunId) {
    score += 120;
  }
  if (normalizedResumeBoundaryId && normalizedBoundaryId === normalizedResumeBoundaryId) {
    score += 110;
  }
  if (normalizedContextHash && normalizedBoundaryContextHash === normalizedContextHash) {
    score += 90;
  }
  if (normalizedSourceWindowId && normalizedBoundarySourceWindowId === normalizedSourceWindowId) {
    score += 12;
  }
  if (normalizedGoal && normalizedBoundaryGoal) {
    const similarity = compareTextSimilarity(normalizedGoal, normalizedBoundaryGoal);
    if (similarity >= 0.55) {
      score += Math.round(similarity * 80);
    }
  }

  return score;
}

function resolveRecoveryLinkedCompactBoundary(
  store,
  agent,
  {
    run = null,
    currentGoal = null,
    compactBoundary = null,
    contextBuilder = null,
    resumeBoundaryId = null,
  } = {}
) {
  const directBoundaryIds = normalizeTextList([
    compactBoundary?.compactBoundaryId,
    resumeBoundaryId,
    run?.resumeBoundaryId,
    contextBuilder?.slots?.resumeBoundary?.compactBoundaryId,
  ]);
  for (const boundaryId of directBoundaryIds) {
    const directBoundary = findCompactBoundaryRecord(store, agent.agentId, boundaryId);
    if (directBoundary) {
      return directBoundary;
    }
  }

  const linkedBoundaries = listAgentCompactBoundariesFromStore(store, agent.agentId)
    .map((boundary) => ({
      boundary,
      score: scoreRecoveryCompactBoundaryLink(boundary, { run, currentGoal }),
    }))
    .filter((entry) => entry.score >= 40)
    .sort(
      (left, right) =>
        right.score - left.score ||
        String(right.boundary?.createdAt || "").localeCompare(String(left.boundary?.createdAt || ""))
    );

  return linkedBoundaries[0]?.boundary ?? null;
}

function executeRecoveryActionFromFailureReflection(
  store,
  agent,
  reflection,
  {
    didMethod = null,
    currentGoal = null,
    sourceWindowId = null,
    includeRehydratePack = false,
    run = null,
    contextBuilder = null,
    compactBoundary = null,
    resumeBoundaryId = null,
    persist = true,
  } = {}
) {
  if (!reflection) {
    return null;
  }
  const persistRecoveryArtifacts = normalizeBooleanFlag(persist, true);
  const persistRecoveryPlanArtifacts = ({
    summary,
    contentLines = [],
    action,
    payloadExtras = {},
    tags = [],
    salience = 0.8,
    confidence = 0.86,
    goalText = null,
    queryStatus = null,
    runStatus = null,
    recommendedActions = [],
  } = {}) => {
    if (!persistRecoveryArtifacts) {
      return {
        recoveryNoteMemoryId: null,
        followupGoalStateId: null,
      };
    }

    const recoveryNote = normalizePassportMemoryRecord(agent.agentId, {
      layer: "working",
      kind: "recovery_plan",
      summary,
      content: contentLines.filter(Boolean).join("\n"),
      payload: {
        field: "recovery_plan",
        action,
        relatedReflectionId: reflection.reflectionId,
        ...(cloneJson(payloadExtras) ?? {}),
      },
      tags,
      sourceWindowId,
      salience,
      confidence,
    });
    applyPassportMemorySupersession(store, agent.agentId, recoveryNote);
    applyPassportMemoryConflictTracking(store, agent.agentId, recoveryNote);
    store.passportMemories.push(recoveryNote);
    const followupGoal = upsertAgentGoalState(
      store,
      buildGoalKeeperState(store, agent, {
        currentGoal: goalText,
        queryState: {
          currentGoal: goalText,
          status: queryStatus,
          recommendedActions,
        },
        run: {
          status: runStatus,
        },
        sourceWindowId,
      }),
      { persist: true }
    );
    return {
      recoveryNoteMemoryId: recoveryNote.passportMemoryId,
      followupGoalStateId: followupGoal?.goalStateId ?? null,
    };
  };
  const linkedCompactBoundary = resolveRecoveryLinkedCompactBoundary(store, agent, {
    run,
    currentGoal,
    compactBoundary,
    contextBuilder,
    resumeBoundaryId,
  });
  const capabilityBoundary = {
    status: "bounded_auto_recovery",
    summary: "当前恢复链会生成恢复包、恢复计划和下一步建议；当存在关联 resume boundary 且本地门禁通过时，可进入有限次自动恢复/续跑。",
    guaranteed: [
      "rehydrate pack generation",
      "resume boundary suggestion",
      "follow-up recovery planning",
      "bounded automatic resume from linked compact boundary",
    ],
    notYet: [
      "guaranteed autonomous resume from unrelated failures",
      "cross-device disaster-recovery orchestration",
    ],
  };

  const compactBoundaryId = linkedCompactBoundary?.compactBoundaryId ?? null;

  if (reflection.nextRecoveryAction === "reload_rehydrate_pack") {
    const latestSnapshot = latestAgentTaskSnapshot(store, agent.agentId) ?? null;
    const resolvedGoal =
      normalizeOptionalText(currentGoal) ??
      normalizeOptionalText(latestSnapshot?.objective) ??
      normalizeOptionalText(latestSnapshot?.title) ??
      null;
    const rehydratePack = includeRehydratePack
      ? buildAgentRehydratePack(store, agent, {
          didMethod,
          resumeFromCompactBoundaryId: compactBoundaryId,
          currentGoal: resolvedGoal,
        })
      : null;
    const rehydratePath = (() => {
      const search = new URLSearchParams();
      if (normalizeDidMethod(didMethod)) {
        search.set("didMethod", normalizeDidMethod(didMethod));
      }
      if (compactBoundaryId) {
        search.set("resumeFromCompactBoundaryId", compactBoundaryId);
      }
      const query = search.toString();
      return `/api/agents/${agent.agentId}/runtime/rehydrate${query ? `?${query}` : ""}`;
    })();
    const recoveryArtifacts = persistRecoveryPlanArtifacts({
      summary: "自动恢复计划：重载 rehydrate pack",
      contentLines: [
        resolvedGoal ? `目标：${resolvedGoal}` : null,
        compactBoundaryId ? `优先恢复 boundary：${compactBoundaryId}` : null,
        "动作：加载 rehydrate pack，并按恢复包继续。",
      ],
      action: "reload_rehydrate_pack",
      payloadExtras: {
        compactBoundaryId,
      },
      tags: ["working", "recovery", "auto_recovery"],
      salience: 0.82,
      confidence: 0.86,
      goalText: resolvedGoal,
      queryStatus: "resume_ready",
      runStatus: "resume_ready",
      recommendedActions: ["resume_from_rehydrate_pack"],
    });
    return {
      recoveryActionId: createRecordId("recv"),
      action: "reload_rehydrate_pack",
      executed: true,
      capabilityBoundary,
      compactBoundaryId,
      relatedReflectionId: reflection.reflectionId,
      rehydratePack,
      recoveryNoteMemoryId: recoveryArtifacts.recoveryNoteMemoryId,
      followupGoalStateId: recoveryArtifacts.followupGoalStateId,
      followup: {
        nextStep: "resume_from_rehydrate_pack",
        resumeBoundaryId: compactBoundaryId,
        suggestedQuery: resolvedGoal,
        rehydratePath,
      },
      createdAt: now(),
    };
  }

  if (reflection.nextRecoveryAction === "bootstrap_runtime") {
    const resolvedGoal =
      normalizeOptionalText(currentGoal) ??
      normalizeOptionalText(run?.currentGoal) ??
      normalizeOptionalText(latestAgentTaskSnapshot(store, agent.agentId)?.objective) ??
      normalizeOptionalText(latestAgentTaskSnapshot(store, agent.agentId)?.title) ??
      null;
    const recoveryArtifacts = persistRecoveryPlanArtifacts({
      summary: "自动恢复计划：补齐 bootstrap",
      contentLines: [
        resolvedGoal ? `目标：${resolvedGoal}` : null,
        "动作：补齐最小 runtime bootstrap，再按原目标继续。",
      ],
      action: "bootstrap_runtime",
      tags: ["working", "recovery", "bootstrap"],
      salience: 0.8,
      confidence: 0.86,
      goalText: resolvedGoal,
      queryStatus: "bootstrap_recovery_ready",
      runStatus: "bootstrap_required",
      recommendedActions: ["bootstrap_runtime"],
    });
    return {
      recoveryActionId: createRecordId("recv"),
      action: "bootstrap_runtime",
      executed: true,
      capabilityBoundary,
      compactBoundaryId,
      relatedReflectionId: reflection.reflectionId,
      rehydratePack: null,
      recoveryNoteMemoryId: recoveryArtifacts.recoveryNoteMemoryId,
      followupGoalStateId: recoveryArtifacts.followupGoalStateId,
      followup: {
        nextStep: "bootstrap_runtime",
        resumeBoundaryId: compactBoundaryId,
        suggestedQuery: resolvedGoal,
      },
      createdAt: now(),
    };
  }

  if (reflection.nextRecoveryAction === "restore_local_reasoner") {
    const resolvedGoal =
      normalizeOptionalText(currentGoal) ??
      normalizeOptionalText(run?.currentGoal) ??
      null;
    const recoveryArtifacts = persistRecoveryPlanArtifacts({
      summary: "自动恢复计划：恢复本地回答引擎",
      contentLines: [
        resolvedGoal ? `目标：${resolvedGoal}` : null,
        "动作：尝试恢复或切换本地 reasoner，再继续当前任务。",
      ],
      action: "restore_local_reasoner",
      tags: ["working", "recovery", "local_reasoner"],
      salience: 0.78,
      confidence: 0.84,
      goalText: resolvedGoal,
      queryStatus: "local_reasoner_recovery_ready",
      runStatus: "needs_human_review",
      recommendedActions: ["restore_local_reasoner"],
    });
    return {
      recoveryActionId: createRecordId("recv"),
      action: "restore_local_reasoner",
      executed: true,
      capabilityBoundary,
      compactBoundaryId,
      relatedReflectionId: reflection.reflectionId,
      rehydratePack: null,
      recoveryNoteMemoryId: recoveryArtifacts.recoveryNoteMemoryId,
      followupGoalStateId: recoveryArtifacts.followupGoalStateId,
      followup: {
        nextStep: "restore_local_reasoner",
        resumeBoundaryId: compactBoundaryId,
        suggestedQuery: resolvedGoal,
      },
      createdAt: now(),
    };
  }

  if (reflection.nextRecoveryAction === "retry_without_execution") {
    const resolvedGoal =
      normalizeOptionalText(currentGoal) ??
      normalizeOptionalText(run?.currentGoal) ??
      null;
    const recoveryArtifacts = persistRecoveryPlanArtifacts({
      summary: "自动恢复计划：转入非执行续跑",
      contentLines: [
        resolvedGoal ? `目标：${resolvedGoal}` : null,
        "动作：停止直接执行，先总结受限执行阻断原因并给出下一步。",
      ],
      action: "retry_without_execution",
      tags: ["working", "recovery", "sandbox"],
      salience: 0.78,
      confidence: 0.83,
      goalText: resolvedGoal,
      queryStatus: "non_executing_resume_ready",
      runStatus: "resume_ready",
      recommendedActions: ["retry_without_execution"],
    });
    return {
      recoveryActionId: createRecordId("recv"),
      action: "retry_without_execution",
      executed: true,
      capabilityBoundary,
      compactBoundaryId,
      relatedReflectionId: reflection.reflectionId,
      rehydratePack: null,
      recoveryNoteMemoryId: recoveryArtifacts.recoveryNoteMemoryId,
      followupGoalStateId: recoveryArtifacts.followupGoalStateId,
      followup: {
        nextStep: "retry_without_execution",
        resumeBoundaryId: compactBoundaryId,
        suggestedQuery: resolvedGoal,
      },
      createdAt: now(),
    };
  }

  const recoveryArtifacts = persistRecoveryPlanArtifacts({
    summary: "自动恢复计划：请求人工复核",
    contentLines: ["当前失败反思建议先暂停并请求人工复核。"],
    action: "request_human_review",
    tags: ["working", "recovery", "human_review"],
    salience: 0.8,
    confidence: 0.88,
    goalText: currentGoal ?? null,
    queryStatus: "human_review_pending",
    runStatus: "needs_human_review",
    recommendedActions: ["request_human_review"],
  });
  return {
    recoveryActionId: createRecordId("recv"),
    action: "request_human_review",
    executed: true,
    capabilityBoundary,
    compactBoundaryId,
    relatedReflectionId: reflection.reflectionId,
    rehydratePack: null,
    recoveryNoteMemoryId: recoveryArtifacts.recoveryNoteMemoryId,
    followupGoalStateId: recoveryArtifacts.followupGoalStateId,
    followup: {
      nextStep: "request_human_review",
      resumeBoundaryId: compactBoundaryId,
      suggestedQuery: currentGoal ?? null,
    },
    createdAt: now(),
  };
}

function summarizeFormalRecoveryRunbookForAudit(runbook = null) {
  if (!runbook || typeof runbook !== "object") {
    return null;
  }

  return {
    status: normalizeOptionalText(runbook.status) ?? null,
    summary: normalizeOptionalText(runbook.summary) ?? null,
    nextStepId: normalizeOptionalText(runbook.nextStepId) ?? null,
    nextStepCode: normalizeOptionalText(runbook.nextStepCode) ?? null,
    nextStepLabel: normalizeOptionalText(runbook.nextStepLabel) ?? null,
    nextStepSummary: normalizeOptionalText(runbook.nextStepSummary) ?? null,
    nextStepRequired:
      runbook.nextStepRequired == null ? null : Boolean(runbook.nextStepRequired),
    completedStepCount: Number(runbook.completedStepCount || 0),
    totalStepCount: Number(runbook.totalStepCount || 0),
    readyToRehearse: Boolean(runbook.readyToRehearse),
    readyToExportSetupPackage: Boolean(runbook.readyToExportSetupPackage),
    latestEvidence: cloneJson(runbook.latestEvidence) ?? null,
    blockingSteps: Array.isArray(runbook.blockingSteps) ? cloneJson(runbook.blockingSteps) : [],
    recommendedSteps: Array.isArray(runbook.recommendedSteps) ? cloneJson(runbook.recommendedSteps) : [],
  };
}

function summarizeFormalRecoveryFlowForAudit(formalRecoveryFlow = null) {
  if (!formalRecoveryFlow || typeof formalRecoveryFlow !== "object") {
    return null;
  }

  return {
    status: normalizeOptionalText(formalRecoveryFlow.status) ?? null,
    summary: normalizeOptionalText(formalRecoveryFlow.summary) ?? null,
    durableRestoreReady: Boolean(formalRecoveryFlow.durableRestoreReady),
    missingRequiredCodes: normalizeTextList(formalRecoveryFlow.missingRequiredCodes),
    runbook: summarizeFormalRecoveryRunbookForAudit(formalRecoveryFlow.runbook),
    handoffPacket: formalRecoveryFlow.handoffPacket
      ? {
          status: normalizeOptionalText(formalRecoveryFlow.handoffPacket.status) ?? null,
          readyToHandoff: Boolean(formalRecoveryFlow.handoffPacket.readyToHandoff),
          missingFieldIds: normalizeTextList(formalRecoveryFlow.handoffPacket.missingFieldIds),
          uniqueBlockingReason: formalRecoveryFlow.handoffPacket.uniqueBlockingReason
            ? {
                code:
                  normalizeOptionalText(formalRecoveryFlow.handoffPacket.uniqueBlockingReason.code) ?? null,
                label:
                  normalizeOptionalText(formalRecoveryFlow.handoffPacket.uniqueBlockingReason.label) ?? null,
              }
            : null,
        }
      : null,
    crossDeviceRecoveryClosure: formalRecoveryFlow.crossDeviceRecoveryClosure
      ? {
          status: normalizeOptionalText(formalRecoveryFlow.crossDeviceRecoveryClosure.status) ?? null,
          readyForRehearsal: Boolean(formalRecoveryFlow.crossDeviceRecoveryClosure.readyForRehearsal),
          readyForCutover: Boolean(formalRecoveryFlow.crossDeviceRecoveryClosure.readyForCutover),
          nextStepLabel:
            normalizeOptionalText(formalRecoveryFlow.crossDeviceRecoveryClosure.nextStepLabel) ?? null,
          sourceBlockingReasons: normalizeTextList(
            formalRecoveryFlow.crossDeviceRecoveryClosure.sourceBlockingReasons
          ),
          cutoverGateReasons: normalizeTextList(
            formalRecoveryFlow.crossDeviceRecoveryClosure.cutoverGate?.gateReasons
          ),
        }
      : null,
  };
}

function summarizeAutomaticRecoveryReadinessForAudit(readiness = null) {
  if (!readiness || typeof readiness !== "object") {
    return null;
  }

  const actions =
    readiness.actions && typeof readiness.actions === "object"
      ? Object.fromEntries(
          Object.entries(readiness.actions).map(([key, value]) => [
            key,
            {
              ready: Boolean(value?.ready),
              gateReasons: normalizeTextList(value?.gateReasons),
            },
          ])
        )
      : null;

  return {
    status: normalizeOptionalText(readiness.status) ?? null,
    summary: normalizeOptionalText(readiness.summary) ?? null,
    ready: readiness.ready == null ? null : Boolean(readiness.ready),
    formalFlowReady: readiness.formalFlowReady == null ? null : Boolean(readiness.formalFlowReady),
    gateReasons: normalizeTextList(readiness.gateReasons),
    dependencyWarnings: normalizeTextList(readiness.dependencyWarnings),
    failureSemantics:
      cloneJson(readiness.failureSemantics) ??
      buildAutomaticRecoveryReadinessFailureSemantics(readiness),
    maxAutomaticRecoveryAttempts: Number(readiness.maxAutomaticRecoveryAttempts || 0),
    actions,
  };
}

function summarizeAutoRecoveryVerificationForAudit(verification = null) {
  if (!verification || typeof verification !== "object") {
    return null;
  }

  const issues = Array.isArray(verification.issues)
    ? verification.issues.map((item) => normalizeOptionalText(item?.code ?? item)).filter(Boolean)
    : [];
  return {
    valid: verification.valid == null ? null : Boolean(verification.valid),
    issueCount:
      verification.issueCount != null
        ? Number(verification.issueCount || 0)
        : issues.length,
    issues,
  };
}

function buildAutoRecoveryAuditSnapshot(autoRecovery = null, { agentId = null, runId = null, sourceWindowId = null } = {}) {
  if (!autoRecovery || typeof autoRecovery !== "object") {
    return null;
  }
  if (autoRecovery.requested !== true) {
    return null;
  }

  const failureSemantics =
    autoRecovery.failureSemantics && typeof autoRecovery.failureSemantics === "object"
      ? cloneJson(autoRecovery.failureSemantics)
      : buildAutoRecoveryFailureSemantics(autoRecovery);
  const closure =
    autoRecovery.closure && typeof autoRecovery.closure === "object"
      ? cloneJson(autoRecovery.closure)
      : buildAutoRecoveryClosure(autoRecovery);
  const chain = Array.isArray(autoRecovery.chain)
    ? autoRecovery.chain.map((entry) => ({
        attempt: Number(entry?.attempt || 0),
        runId: normalizeOptionalText(entry?.runId) ?? null,
        runStatus: normalizeOptionalText(entry?.runStatus) ?? null,
        recoveryAction: normalizeOptionalText(entry?.recoveryAction) ?? null,
        recoveryActionId: normalizeOptionalText(entry?.recoveryActionId) ?? null,
        resumeBoundaryId: normalizeOptionalText(entry?.resumeBoundaryId) ?? null,
        createdAt: normalizeOptionalText(entry?.createdAt) ?? null,
      }))
    : [];

  return {
    agentId: normalizeOptionalText(agentId) ?? null,
    runId: normalizeOptionalText(runId) ?? normalizeOptionalText(autoRecovery.finalRunId) ?? null,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
    requested: Boolean(autoRecovery.requested),
    enabled: autoRecovery.enabled == null ? null : Boolean(autoRecovery.enabled),
    ready: autoRecovery.ready == null ? null : Boolean(autoRecovery.ready),
    resumed: Boolean(autoRecovery.resumed),
    attempt: autoRecovery.attempt == null ? null : Number(autoRecovery.attempt),
    maxAttempts: autoRecovery.maxAttempts == null ? null : Number(autoRecovery.maxAttempts),
    status: normalizeOptionalText(autoRecovery.status) ?? null,
    summary: normalizeOptionalText(autoRecovery.summary) ?? null,
    error: normalizeOptionalText(autoRecovery.error) ?? null,
    initialRunId: normalizeOptionalText(autoRecovery.initialRunId) ?? null,
    triggerRunId: normalizeOptionalText(autoRecovery.triggerRunId) ?? null,
    triggerRecoveryActionId: normalizeOptionalText(autoRecovery.triggerRecoveryActionId) ?? null,
    finalRunId: normalizeOptionalText(autoRecovery.finalRunId) ?? null,
    finalStatus: normalizeOptionalText(autoRecovery.finalStatus) ?? null,
    gateReasons: normalizeTextList(autoRecovery.gateReasons),
    dependencyWarnings: normalizeTextList(autoRecovery.dependencyWarnings),
    failureSemantics,
    chain,
    plan: autoRecovery.plan
      ? {
          action: normalizeOptionalText(autoRecovery.plan.action) ?? null,
          mode: normalizeOptionalText(autoRecovery.plan.mode) ?? null,
          summary: normalizeOptionalText(autoRecovery.plan.summary) ?? null,
        }
      : null,
    setupStatus: autoRecovery.setupStatus
      ? {
          setupComplete: Boolean(autoRecovery.setupStatus.setupComplete),
          missingRequiredCodes: normalizeTextList(autoRecovery.setupStatus.missingRequiredCodes),
          formalRecoveryFlow: summarizeFormalRecoveryFlowForAudit(autoRecovery.setupStatus.formalRecoveryFlow),
          automaticRecoveryReadiness: summarizeAutomaticRecoveryReadinessForAudit(
            autoRecovery.setupStatus.automaticRecoveryReadiness
          ),
          activePlanReadiness: summarizeAutomaticRecoveryReadinessForAudit(
            autoRecovery.setupStatus.activePlanReadiness
          ),
        }
      : null,
    finalVerification: summarizeAutoRecoveryVerificationForAudit(autoRecovery.finalVerification),
    closure,
  };
}

function buildAutoRecoveryAuditViewFromEvent(event = null) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const autoRecovery = payload.autoRecovery && typeof payload.autoRecovery === "object"
    ? cloneJson(payload.autoRecovery)
    : null;
  return autoRecovery
    ? {
        auditEventId: event.hash ?? `event_${event.index}`,
        eventIndex: event.index ?? null,
        eventHash: event.hash ?? null,
        timestamp: event.timestamp ?? null,
        ...autoRecovery,
      }
    : null;
}

function listAgentAutoRecoveryAuditsFromStore(store, agentId) {
  const normalizedAgentId = normalizeOptionalText(agentId) ?? null;
  return (store.events || [])
    .filter((event) => event?.type === "agent_runner_auto_recovery_closed")
    .map((event) => buildAutoRecoveryAuditViewFromEvent(event))
    .filter((audit) =>
      normalizedAgentId
        ? matchesCompatibleAgentId(store, audit?.agentId, normalizedAgentId)
        : true
    )
    .filter(Boolean)
    .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
}

function applyAgentRunnerAutoRecoveryAuditToStore(
  store,
  {
    agentId = null,
    runId = null,
    autoRecovery = null,
    sourceWindowId = null,
  } = {}
) {
  const normalizedRunId = normalizeOptionalText(runId) ?? null;
  const auditSnapshot = buildAutoRecoveryAuditSnapshot(autoRecovery, {
    agentId,
    runId: normalizedRunId,
    sourceWindowId,
  });
  if (!normalizedRunId || !auditSnapshot) {
    return null;
  }

  const runIndex = Array.isArray(store.agentRuns)
    ? store.agentRuns.findIndex((entry) => normalizeOptionalText(entry?.runId) === normalizedRunId)
    : -1;
  if (runIndex < 0) {
    return null;
  }

  const runRecord = store.agentRuns[runIndex];
  runRecord.autoRecovery = cloneJson(auditSnapshot);
  runRecord.updatedAt = now();
  const event = appendEvent(store, "agent_runner_auto_recovery_closed", {
    runId: normalizedRunId,
    agentId: normalizeOptionalText(agentId) ?? normalizeOptionalText(runRecord.agentId) ?? null,
    sourceWindowId:
      normalizeOptionalText(sourceWindowId) ??
      normalizeOptionalText(runRecord.sourceWindowId) ??
      null,
    autoRecovery: cloneJson(auditSnapshot),
  });
  return {
    run: buildAgentRunView(runRecord),
    audit: buildAutoRecoveryAuditViewFromEvent(event),
  };
}

async function persistAgentRunnerAutoRecoveryAudit({
  agentId = null,
  runId = null,
  autoRecovery = null,
  sourceWindowId = null,
} = {}) {
  const normalizedRunId = normalizeOptionalText(runId) ?? null;
  const auditSnapshot = buildAutoRecoveryAuditSnapshot(autoRecovery, {
    agentId,
    runId: normalizedRunId,
    sourceWindowId,
  });
  if (!normalizedRunId || !auditSnapshot) {
    return null;
  }

  return queueStoreMutation(async () => {
    const store = await loadStore();
    const persisted = applyAgentRunnerAutoRecoveryAuditToStore(store, {
      agentId,
      runId: normalizedRunId,
      autoRecovery,
      sourceWindowId,
    });
    if (!persisted) {
      return null;
    }
    await writeStore(store);
    return persisted;
  });
}

function buildRunnerAutoRecoverySetupStatusSnapshot({
  deviceRuntime = null,
  bootstrapGate = null,
  securityPosture = null,
  formalRecoveryFlow = null,
  action = null,
} = {}) {
  const runtime = normalizeDeviceRuntime(deviceRuntime);
  const automaticRecoveryReadiness = buildAutomaticRecoveryReadiness({
    residentAgentId: runtime.residentAgentId,
    bootstrapGate,
    localMode: runtime.localMode,
    localReasonerDiagnostics: buildPassiveLocalReasonerDiagnostics(runtime.localReasoner),
    securityPosture,
    formalRecoveryFlow,
  });
  const activePlanReadiness = buildPlanSpecificAutomaticRecoveryReadiness(automaticRecoveryReadiness, action);
  const formalMissingRequiredCodes =
    formalRecoveryFlow && Array.isArray(formalRecoveryFlow.missingRequiredCodes)
      ? normalizeTextList(formalRecoveryFlow.missingRequiredCodes)
      : [];
  const activePlanMissingRequiredCodes = normalizeTextList(activePlanReadiness.gateReasons);
  const missingRequiredCodes = normalizeTextList([
    ...formalMissingRequiredCodes,
    ...activePlanMissingRequiredCodes,
  ]);
  return {
    setupComplete: missingRequiredCodes.length === 0 && Boolean(activePlanReadiness.ready),
    missingRequiredCodes,
    formalRecoveryFlow: formalRecoveryFlow ? cloneJson(formalRecoveryFlow) ?? null : null,
    automaticRecoveryReadiness,
    activePlanReadiness,
    source: formalRecoveryFlow ? "setup_status" : "runner_runtime_snapshot",
  };
}

function resolveAutomaticRecoveryPlan({
  run = null,
  recoveryAction = null,
  bootstrapGate = null,
  residentGate = null,
  reasoner = null,
  reasonerPlan = null,
  sandboxExecution = null,
  negotiation = null,
} = {}) {
  if (recoveryAction?.action === "reload_rehydrate_pack" && run?.status === "rehydrate_required") {
    return {
      action: "reload_rehydrate_pack",
      mode: "resume_from_rehydrate_pack",
      summary: "从关联 compact boundary 自动续跑。",
    };
  }
  if (bootstrapGate?.required && run?.status === "bootstrap_required" && !residentGate?.required) {
    return {
      action: "bootstrap_runtime",
      mode: "bootstrap_and_retry",
      summary: "先补齐最小 bootstrap，再按原目标续跑。",
    };
  }
  const effectiveProvider =
    normalizeRuntimeReasonerProvider(reasoner?.provider) ??
    normalizeRuntimeReasonerProvider(reasonerPlan?.effectiveProvider) ??
    null;
  if (
    normalizeOptionalText(reasoner?.error) &&
    run?.status === "needs_human_review" &&
    effectiveProvider &&
    effectiveProvider !== "local_mock"
  ) {
    return {
      action: "restore_local_reasoner",
      mode: "restore_reasoner_and_retry",
      summary: "尝试恢复本地 reasoner，再按原目标续跑。",
    };
  }
  if (
    (normalizeOptionalText(sandboxExecution?.error) ||
      (run?.status === "blocked" && Array.isArray(negotiation?.sandboxBlockedReasons) && negotiation.sandboxBlockedReasons.length > 0)) &&
    run?.status === "blocked"
  ) {
    return {
      action: "retry_without_execution",
      mode: "retry_without_execution",
      summary: "停止直接执行，转为非执行说明与下一步建议。",
    };
  }
  return null;
}

function stabilizeLongTermPreferences(store, agent, cognitiveState, { sourceWindowId = null } = {}) {
  const profileSnapshot = buildProfileMemorySnapshot(store, agent, { listAgentPassportMemories });
  const currentStable = extractStablePreferences(profileSnapshot.fieldValues);
  const evidenceCounts = cognitiveState?.adaptation?.preferenceEvidenceCounts || {};
  const promotable = Object.entries(evidenceCounts)
    .filter(([, count]) => Math.floor(toFiniteNumber(count, 0)) >= DEFAULT_PREFERENCE_STABILIZATION_THRESHOLD)
    .map(([key]) => key)
    .filter((key) => key.startsWith("prefer_"))
    .filter((key) => !currentStable.includes(key));

  if (!promotable.length) {
    return [];
  }

  const merged = Array.from(new Set([...currentStable, ...promotable])).slice(-12);
  const record = normalizePassportMemoryRecord(agent.agentId, {
    layer: "profile",
    kind: "preference",
    summary: `稳定偏好 ${merged.length} 条`,
    content: merged.join("\n"),
    payload: {
      field: "stable_preferences",
      value: merged,
      source: "continuous_cognition",
    },
    tags: ["profile", "preference", "long_term", "stabilized"],
    sourceWindowId,
  });
  applyPassportMemoryConflictTracking(store, agent.agentId, record);
  applyPassportMemorySupersession(store, agent.agentId, record);
  store.passportMemories.push(record);
  return [record];
}

function arbitratePreferenceConflicts(
  store,
  agent,
  {
    sourceWindowId = null,
    currentGoal = null,
    cognitiveState = null,
  } = {}
) {
  const conflicts = (store.memoryConflicts || []).filter(
    (item) =>
      item.agentId === agent.agentId &&
      item.conflictKey === "profile:stable_preferences" &&
      normalizeOptionalText(item.resolution) === "pending_supersession"
  );
  const allStablePreferenceEntries = listAgentPassportMemories(store, agent.agentId, { layer: "profile", kind: "preference" })
    .filter((entry) => normalizeOptionalText(entry?.payload?.field) === "stable_preferences");
  const latestArbitratedEntry = [...allStablePreferenceEntries]
    .filter((entry) => entry?.payload?.arbitration)
    .sort((left, right) => (right.recordedAt || "").localeCompare(left.recordedAt || ""))[0] ?? null;
  const shadowConflictCandidates = allStablePreferenceEntries
    .filter((entry) => !entry?.payload?.arbitration)
    .filter((entry) =>
      latestArbitratedEntry
        ? (entry.recordedAt || "").localeCompare(latestArbitratedEntry.recordedAt || "") > 0
        : true
    );
  const hasShadowConflict = conflicts.length === 0 && shadowConflictCandidates.length >= 2;
  if (!conflicts.length && !hasShadowConflict) {
    return {
      resolvedConflictIds: [],
      reconciledWrites: [],
    };
  }

  const profileSnapshot = buildProfileMemorySnapshot(store, agent, { listAgentPassportMemories });
  const currentStable = extractStablePreferences(profileSnapshot.fieldValues);
  const candidateMemoryIds = new Set(
    [
      ...conflicts.flatMap((item) => [item.incomingMemoryId, ...(item.conflictingMemoryIds || [])]),
      ...(hasShadowConflict ? shadowConflictCandidates.map((entry) => entry.passportMemoryId) : []),
    ].filter(Boolean)
  );
  const currentEntries = allStablePreferenceEntries
    .filter((entry) => candidateMemoryIds.size === 0 || candidateMemoryIds.has(entry.passportMemoryId) || isPassportMemoryActive(entry));
  const arbitrationSignals = new Set(
    normalizeTextList([
      ...currentStable,
      ...(cognitiveState?.preferenceProfile?.stablePreferences || []),
      ...(cognitiveState?.preferenceProfile?.inferredPreferences || []),
      ...(cognitiveState?.preferenceProfile?.learnedSignals || []),
    ])
  );
  const arbitrationScores = currentEntries.map((entry) => {
    const entryValues = normalizeTextList(entry?.payload?.value);
    const cognitiveBias = buildPassportCognitiveBias(entry, {
      currentGoal,
      queryText: entryValues.join(" "),
      cognitiveState,
    });
    const alignedSignals = entryValues.filter((value) => arbitrationSignals.has(value)).slice(0, 6);
    const directAlignment = alignedSignals.length > 0 ? alignedSignals.length / Math.max(1, entryValues.length) : 0;
    const goalAlignment = Math.max(
      compareTextSimilarity(buildPassportMemorySearchText(entry), currentGoal),
      compareTextSimilarity(entryValues.join(" "), currentGoal)
    );
    const continuityWeight = toFiniteNumber(cognitiveState?.preferenceProfile?.preferenceWeights?.continuity, 0.5);
    const recoveryBias = toFiniteNumber(cognitiveState?.preferenceProfile?.preferenceWeights?.recoveryBias, 0.5);
    return {
      entry,
      score:
        (toFiniteNumber(entry?.confidence, 0.5) * 0.36) +
        (toFiniteNumber(entry?.salience, 0.5) * 0.2) +
        (Math.min(1, Math.floor(toFiniteNumber(entry?.memoryDynamics?.recallCount, 0)) * 0.08)) +
        (Math.min(1, Math.floor(toFiniteNumber(entry?.memoryDynamics?.recallSuccessCount, 0)) * 0.12)) +
        (directAlignment * 0.12) +
        (goalAlignment * 0.08) +
        (continuityWeight * 0.06) +
        (recoveryBias * 0.04) +
        (cognitiveBias.taskSupportScore * 0.06) +
        (cognitiveBias.modulationBoost * 0.05) +
        (cognitiveBias.replayProtection * 0.05),
      drivers: {
        alignedSignals,
        directAlignment: Number(directAlignment.toFixed(2)),
        goalAlignment: Number(goalAlignment.toFixed(2)),
        continuityWeight: Number(continuityWeight.toFixed(2)),
        recoveryBias: Number(recoveryBias.toFixed(2)),
        taskSupportScore: cognitiveBias.taskSupportScore,
        modulationBoost: cognitiveBias.modulationBoost,
        replayProtection: cognitiveBias.replayProtection,
        dominantRhythm: cognitiveBias.dominantRhythm,
        replayMode: cognitiveBias.replayMode,
        targetMatches: cognitiveBias.targetMatches,
      },
    };
  });
  arbitrationScores.sort((left, right) => right.score - left.score);
  const dominant = arbitrationScores.at(0)?.entry ?? null;
  const dominantDrivers = arbitrationScores.at(0)?.drivers ?? null;
  const merged = Array.from(
    new Set([
      ...currentStable,
      ...arbitrationScores.flatMap((item) => normalizeTextList(item.entry?.payload?.value)),
    ])
  ).slice(-12);

  const reconciledWrites = [];
  if (dominant && merged.length > 0) {
    const record = normalizePassportMemoryRecord(agent.agentId, {
      layer: "profile",
      kind: "preference",
      summary: `偏好仲裁 ${merged.length} 条`,
      content: merged.join("\n"),
      payload: {
        field: "stable_preferences",
        value: merged,
        arbitration: {
          dominantMemoryId: dominant.passportMemoryId,
          candidateCount: arbitrationScores.length,
          dominantScore: Number(toFiniteNumber(arbitrationScores.at(0)?.score, 0).toFixed(2)),
          alignedSignals: dominantDrivers?.alignedSignals ?? [],
          goalAlignment: dominantDrivers?.goalAlignment ?? 0,
          continuityWeight: dominantDrivers?.continuityWeight ?? 0,
          recoveryBias: dominantDrivers?.recoveryBias ?? 0,
          taskSupportScore: dominantDrivers?.taskSupportScore ?? 0,
          dominantRhythm: dominantDrivers?.dominantRhythm ?? null,
          replayMode: dominantDrivers?.replayMode ?? null,
          targetMatches: dominantDrivers?.targetMatches ?? [],
        },
      },
      tags: ["profile", "preference", "arbitrated"],
      sourceWindowId,
      confidence: Math.max(0.9, toFiniteNumber(dominant.confidence, 0.9)),
      salience: Math.max(0.88, toFiniteNumber(dominant.salience, 0.88)),
      memoryDynamics: {
        lastPreferenceArbitrationDrivers: dominantDrivers ? cloneJson(dominantDrivers) : null,
      },
    });
    applyPassportMemorySupersession(store, agent.agentId, record);
    applyPassportMemoryConflictTracking(store, agent.agentId, record);
    store.passportMemories.push(record);
    reconciledWrites.push(record);
  }

  for (const conflict of conflicts) {
    conflict.resolution = "arbitrated";
    conflict.resolvedAt = now();
    conflict.resolvedBy = "preference_conflict_arbitrator";
    conflict.reconciledMemoryId = reconciledWrites.at(-1)?.passportMemoryId ?? null;
  }

  return {
    resolvedConflictIds: conflicts.length > 0
      ? conflicts.map((item) => item.conflictId)
      : shadowConflictCandidates.map((entry) => entry.passportMemoryId),
    reconciledWrites,
  };
}

function deduplicateAbstractedMemories(store, agentId) {
  const activeAbstracted = listAgentPassportMemories(store, agentId)
    .filter((entry) => isPassportMemoryActive(entry))
    .filter((entry) => entry.kind === "abstracted_memory");
  const groups = new Map();
  for (const entry of activeAbstracted) {
    const gist = normalizeOptionalText(entry?.payload?.gistSummary) ?? normalizeOptionalText(entry?.summary) ?? "older memory";
    const originalLayer = normalizeOptionalText(entry?.payload?.originalLayer) ?? normalizeOptionalText(entry?.layer) ?? "semantic";
    const groupKey = `${originalLayer}:${gist}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(entry);
  }

  const mergedMemoryIds = [];
  const retiredMemoryIds = [];
  for (const entries of groups.values()) {
    if (entries.length <= 1) {
      continue;
    }
    entries.sort((left, right) => {
      const leftCount = Array.isArray(left?.payload?.sourcePassportMemoryIds) ? left.payload.sourcePassportMemoryIds.length : 0;
      const rightCount = Array.isArray(right?.payload?.sourcePassportMemoryIds) ? right.payload.sourcePassportMemoryIds.length : 0;
      return rightCount - leftCount || (right.recordedAt || "").localeCompare(left.recordedAt || "");
    });
    const primary = entries[0];
    const mergedSourceIds = new Set([
      normalizeOptionalText(primary?.payload?.sourcePassportMemoryId),
      ...(Array.isArray(primary?.payload?.sourcePassportMemoryIds) ? primary.payload.sourcePassportMemoryIds : []),
    ].filter(Boolean));
    for (const duplicate of entries.slice(1)) {
      mergedMemoryIds.push(duplicate.passportMemoryId);
      duplicate.status = "superseded";
      retiredMemoryIds.push(duplicate.passportMemoryId);
      const duplicateSources = [
        normalizeOptionalText(duplicate?.payload?.sourcePassportMemoryId),
        ...(Array.isArray(duplicate?.payload?.sourcePassportMemoryIds) ? duplicate.payload.sourcePassportMemoryIds : []),
      ].filter(Boolean);
      for (const sourceId of duplicateSources) {
        mergedSourceIds.add(sourceId);
      }
    }
    primary.payload.sourcePassportMemoryIds = Array.from(mergedSourceIds);
    primary.content = [
      `原始记忆已进入 ${normalizeOptionalText(primary?.payload?.retentionBand) ?? "aged"} 状态。`,
      `保留概要：${normalizeOptionalText(primary?.payload?.gistSummary) ?? normalizeOptionalText(primary?.summary) ?? "older memory"}`,
      `聚合来源：${mergedSourceIds.size} 条`,
      normalizeOptionalText(primary?.payload?.originalLayer) ? `来源层：${primary.payload.originalLayer}` : null,
    ].filter(Boolean).join("\n");
  }

  return {
    mergedMemoryIds,
    retiredMemoryIds,
  };
}

function applyPassportMemoryReconsolidationCycle(
  store,
  agentId,
  {
    referenceTime = now(),
    currentGoal = null,
    cognitiveState = null,
  } = {}
) {
  const restabilizedMemoryIds = [];
  const updatedMemoryIds = [];
  const linkCountByMemory = {};
  const activeEntries = listAgentPassportMemories(store, agentId).filter((entry) => isPassportMemoryActive(entry));

  for (const entry of activeEntries) {
    if (!isPassportMemoryDestabilized(entry, referenceTime)) {
      continue;
    }

    const reactivatedAt =
      normalizeOptionalText(entry?.memoryDynamics?.destabilizedAt) ??
      normalizeOptionalText(entry?.memoryDynamics?.lastReactivatedAt) ??
      normalizeOptionalText(entry?.memoryDynamics?.lastRecalledAt) ??
      normalizeOptionalText(entry?.recordedAt) ??
      referenceTime;
    const reactivatedMs = Date.parse(reactivatedAt);
    const recordedMs = Date.parse(normalizeOptionalText(entry?.recordedAt) ?? "");
    const reconWindowHours = inferPassportReconsolidationWindowHours(entry);
    const evidenceLookbackMs = Math.max(
      Number.isFinite(recordedMs) ? recordedMs : 0,
      Number.isFinite(reactivatedMs)
        ? reactivatedMs - (Math.max(1, reconWindowHours) * 60 * 60 * 1000)
        : 0
    );
    const relatedEvidence = activeEntries
      .filter((candidate) => candidate.passportMemoryId !== entry.passportMemoryId)
      .filter((candidate) => {
        const candidateRecordedMs = Date.parse(candidate.recordedAt || "");
        if (!Number.isFinite(candidateRecordedMs) || candidateRecordedMs < evidenceLookbackMs) {
          return false;
        }
        const sameField =
          normalizeOptionalText(candidate?.payload?.field) &&
          normalizeOptionalText(candidate?.payload?.field) === normalizeOptionalText(entry?.payload?.field);
        const samePattern =
          normalizeOptionalText(candidate?.patternKey) &&
          normalizeOptionalText(candidate?.patternKey) === normalizeOptionalText(entry?.patternKey);
        const sameSeparation =
          normalizeOptionalText(candidate?.separationKey) &&
          normalizeOptionalText(candidate?.separationKey) === normalizeOptionalText(entry?.separationKey);
        return sameField || samePattern || sameSeparation;
      })
      .sort((left, right) => {
        const confidenceDelta = toFiniteNumber(right?.confidence, 0.5) - toFiniteNumber(left?.confidence, 0.5);
        if (confidenceDelta !== 0) {
          return confidenceDelta;
        }
        return (right.recordedAt || "").localeCompare(left.recordedAt || "");
      })
      .slice(0, 4);

    const evidenceIds = relatedEvidence.map((candidate) => candidate.passportMemoryId).filter(Boolean);
    const evidenceConfidence =
      relatedEvidence.length > 0
        ? relatedEvidence.reduce((sum, candidate) => sum + toFiniteNumber(candidate?.confidence, 0.5), 0) / relatedEvidence.length
        : null;
    const evidenceStrength =
      relatedEvidence.length > 0
        ? relatedEvidence.reduce((sum, candidate) => sum + toFiniteNumber(candidate?.memoryDynamics?.strengthScore, 0.5), 0) /
          relatedEvidence.length
        : null;
    const currentComparableValue = extractPassportMemoryComparableValue(entry);
    const normalizedCurrentComparableValue = normalizeComparableText(
      normalizeVerificationBindingValue(currentComparableValue)
    );
    const currentTrustScore =
      (computePassportSourceTrustScore(entry.sourceType) * 0.55) +
      (toFiniteNumber(entry.confidence, 0.5) * 0.45);
    const currentSupportScore = computePassportEvidenceCandidateScore(entry, referenceTime);
    const evidenceClusters = new Map();
    const registerEvidenceCluster = (candidate, { includesCurrent = false, supportScore = 0 } = {}) => {
      const comparableValue = includesCurrent ? currentComparableValue : extractPassportMemoryComparableValue(candidate);
      const normalizedComparableValue = normalizeComparableText(
        normalizeVerificationBindingValue(comparableValue)
      );
      const clusterKey =
        normalizedComparableValue ||
        (includesCurrent ? `current:${entry.passportMemoryId}` : `memory:${candidate?.passportMemoryId}`);
      if (!evidenceClusters.has(clusterKey)) {
        evidenceClusters.set(clusterKey, {
          clusterKey,
          comparableValue: cloneJson(comparableValue),
          normalizedComparableValue,
          includesCurrent: false,
          supportScoreSum: 0,
          sourceTrustScoreSum: 0,
          confidenceSum: 0,
          count: 0,
          entries: [],
        });
      }
      const cluster = evidenceClusters.get(clusterKey);
      cluster.includesCurrent = cluster.includesCurrent || includesCurrent;
      cluster.supportScoreSum += supportScore;
      cluster.sourceTrustScoreSum += computePassportSourceTrustScore(
        includesCurrent ? entry.sourceType : candidate?.sourceType
      );
      cluster.confidenceSum += toFiniteNumber(includesCurrent ? entry.confidence : candidate?.confidence, 0.5);
      cluster.count += 1;
      cluster.entries.push({
        passportMemoryId: includesCurrent ? entry.passportMemoryId : candidate?.passportMemoryId,
        summary: includesCurrent ? entry.summary : candidate?.summary,
        content: includesCurrent ? entry.content : candidate?.content,
        sourceType: includesCurrent ? entry.sourceType : candidate?.sourceType,
        confidence: includesCurrent ? entry.confidence : candidate?.confidence,
        supportScore,
      });
    };

    registerEvidenceCluster(entry, { includesCurrent: true, supportScore: currentSupportScore });
    for (const candidate of relatedEvidence) {
      registerEvidenceCluster(candidate, {
        includesCurrent: false,
        supportScore: computePassportEvidenceCandidateScore(candidate, referenceTime),
      });
    }

    const rankedClusters = Array.from(evidenceClusters.values())
      .map((cluster) => {
        const supportScore = Number(
          (
            cluster.supportScoreSum +
            Math.min(0.18, Math.log1p(cluster.count) * 0.07)
          ).toFixed(4)
        );
        const averageTrustScore =
          cluster.count > 0 ? Number((cluster.sourceTrustScoreSum / cluster.count).toFixed(4)) : 0;
        const averageConfidence =
          cluster.count > 0 ? Number((cluster.confidenceSum / cluster.count).toFixed(4)) : 0;
        const representative = [...cluster.entries].sort(
          (left, right) => right.supportScore - left.supportScore || (toFiniteNumber(right.confidence, 0.5) - toFiniteNumber(left.confidence, 0.5))
        )[0] ?? null;
        return {
          ...cluster,
          aggregateScore: supportScore,
          dominantTrustScore: Number(((averageTrustScore * 0.58) + (averageConfidence * 0.42)).toFixed(4)),
          representative,
        };
      })
      .sort((left, right) => right.aggregateScore - left.aggregateScore || right.dominantTrustScore - left.dominantTrustScore);

    const topCluster = rankedClusters[0] ?? null;
    const secondCluster = rankedClusters[1] ?? null;
    const currentCluster =
      rankedClusters.find((cluster) => cluster.includesCurrent) ??
      topCluster;
    const bestAlternativeCluster =
      rankedClusters.find((cluster) => !cluster.includesCurrent) ?? null;
    const currentClusterScore = currentCluster?.aggregateScore ?? currentSupportScore;
    const topMargin = topCluster ? topCluster.aggregateScore - (secondCluster?.aggregateScore ?? 0) : 0;
    const alternativeMargin =
      currentCluster && bestAlternativeCluster
        ? currentCluster.aggregateScore - bestAlternativeCluster.aggregateScore
        : null;
    const topClusterDiffers =
      Boolean(topCluster) &&
      !topCluster.includesCurrent &&
      Boolean(topCluster.normalizedComparableValue) &&
      Boolean(normalizedCurrentComparableValue) &&
      topCluster.normalizedComparableValue !== normalizedCurrentComparableValue;
    const predictionErrorScore = topClusterDiffers
      ? Number(
          Math.max(
            0,
            Math.min(
              1,
              (
                ((topCluster.aggregateScore - currentClusterScore) * 0.72) +
                (Math.max(0, topMargin) * 0.28) +
                0.12
              ).toFixed(4)
            )
          )
        )
      : Number(
          Math.max(
            0,
            Math.min(
              1,
              ((Math.max(0, (bestAlternativeCluster?.aggregateScore ?? 0) - (currentCluster?.aggregateScore ?? 0)) * 0.4)).toFixed(4)
            )
          )
        );
    const cognitiveBias = buildPassportCognitiveBias(entry, {
      currentGoal,
      cognitiveState,
      referenceTime,
    });
    const dynamicValueWinMargin = Number(
      Math.max(
        0.05,
        Math.min(
          0.2,
          (
            DEFAULT_RECONSOLIDATION_VALUE_WIN_MARGIN -
            (cognitiveBias.conflictTraceScore * 0.04) -
            (cognitiveBias.predictionErrorTraceScore * 0.03) +
            (cognitiveBias.replayProtection * 0.02)
          )
        )
      ).toFixed(4)
    );
    const dynamicAmbiguityMargin = Number(
      Math.max(
        0.03,
        Math.min(
          0.14,
          (
            DEFAULT_RECONSOLIDATION_AMBIGUITY_MARGIN -
            (cognitiveBias.conflictTraceScore * 0.02) -
            (cognitiveBias.predictionErrorTraceScore * 0.01) +
            (cognitiveBias.goalSupportScore * 0.01)
          )
        )
      ).toFixed(4)
    );
    const shouldRewriteFromEvidence =
      Boolean(topCluster) &&
      topClusterDiffers &&
      topCluster.aggregateScore >= currentClusterScore + dynamicValueWinMargin &&
      topMargin >= dynamicAmbiguityMargin &&
      topCluster.dominantTrustScore >= currentTrustScore + 0.05 &&
      normalizePassportMemoryLayer(entry.layer) !== "ledger";
    const ambiguousCompetition =
      Boolean(bestAlternativeCluster) &&
      !shouldRewriteFromEvidence &&
      (
        (topClusterDiffers && topCluster && topCluster.aggregateScore > currentClusterScore) ||
        (alternativeMargin != null && alternativeMargin < dynamicAmbiguityMargin) ||
        topMargin < dynamicAmbiguityMargin
      );
    const strongestEvidence = topCluster?.representative
      ? relatedEvidence.find((candidate) => candidate.passportMemoryId === topCluster.representative.passportMemoryId) ?? null
      : null;

    if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
      entry.memoryDynamics = {};
    }
    entry.memoryDynamics.reconsolidationCount =
      Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.reconsolidationCount, 0))) + 1;
    entry.memoryDynamics.lastReconsolidatedAt = referenceTime;
    entry.memoryDynamics.reconsolidationState = "restabilized";
    entry.memoryDynamics.destabilizedUntil = null;
    entry.memoryDynamics.reconsolidationEvidenceIds = evidenceIds;
    entry.memoryDynamics.lastPredictionErrorScore = predictionErrorScore;
    entry.memoryDynamics.lastPredictionErrorAt = referenceTime;
    entry.memoryDynamics.lastReconsolidationDrivers = {
      goalSupportScore: cognitiveBias.goalSupportScore,
      taskSupportScore: cognitiveBias.taskSupportScore,
      conflictTraceScore: cognitiveBias.conflictTraceScore,
      predictionErrorTraceScore: cognitiveBias.predictionErrorTraceScore,
      replayProtection: cognitiveBias.replayProtection,
      dominantRhythm: cognitiveBias.dominantRhythm,
      replayMode: cognitiveBias.replayMode,
      targetMatches: cognitiveBias.targetMatches,
    };
    entry.memoryDynamics.lastReconsolidationThresholds = {
      valueWinMargin: dynamicValueWinMargin,
      ambiguityMargin: dynamicAmbiguityMargin,
    };
    entry.memoryDynamics.reconsolidationCandidateValues = rankedClusters.slice(0, 4).map((cluster) => ({
      value: cloneJson(cluster.comparableValue),
      aggregateScore: cluster.aggregateScore,
      dominantTrustScore: cluster.dominantTrustScore,
      count: cluster.count,
      includesCurrent: cluster.includesCurrent,
      memoryIds: cluster.entries.map((item) => item.passportMemoryId).filter(Boolean),
    }));
    entry.memoryDynamics.reconsolidationConflictState = ambiguousCompetition ? "ambiguous_competition" : null;
    entry.memoryDynamics.lastReconsolidationOutcome =
      evidenceIds.length > 0 ? "updated_from_linked_evidence" : "restabilized_without_update";

    if (evidenceIds.length > 0) {
      entry.confidence = Number(
        Math.max(
          0,
          Math.min(
            1,
            ((toFiniteNumber(entry.confidence, 0.5) * 0.84) + (toFiniteNumber(evidenceConfidence, 0.5) * 0.16)).toFixed(2)
          )
        )
      );
      entry.memoryDynamics.confidenceScore = entry.confidence;
      entry.memoryDynamics.strengthScore = Number(
        Math.max(
          0,
          Math.min(
            1,
            (
              (toFiniteNumber(entry.memoryDynamics.strengthScore, entry.salience ?? 0.5) * 0.86) +
              (toFiniteNumber(evidenceStrength, 0.5) * 0.14) +
              0.04
            ).toFixed(2)
          )
        )
      );
      if (ambiguousCompetition) {
        entry.confidence = Number(Math.max(0.22, Math.min(1, (entry.confidence - 0.04).toFixed(2))));
        entry.memoryDynamics.confidenceScore = entry.confidence;
        entry.memoryDynamics.lastReconsolidationOutcome = "restabilized_with_competing_evidence";
        if (!entry.payload || typeof entry.payload !== "object") {
          entry.payload = {};
        }
        entry.payload.reconsolidationConflict = {
          recordedAt: referenceTime,
          candidateValues: rankedClusters.slice(0, 4).map((cluster) => ({
            value: cloneJson(cluster.comparableValue),
            aggregateScore: cluster.aggregateScore,
            dominantTrustScore: cluster.dominantTrustScore,
            count: cluster.count,
            includesCurrent: cluster.includesCurrent,
          })),
          predictionErrorScore,
        };
        entry.conflictKey = buildPassportMemoryConflictKey(entry) || entry.conflictKey || null;
        entry.conflictState = {
          conflictId: normalizeOptionalText(entry?.conflictState?.conflictId) ?? null,
          hasConflict: true,
          conflictingMemoryIds: rankedClusters
            .flatMap((cluster) => cluster.entries.map((item) => item.passportMemoryId))
            .filter((memoryId) => memoryId && memoryId !== entry.passportMemoryId)
            .slice(0, 8),
          resolution: "ambiguous_competition",
        };
      }
      if (shouldRewriteFromEvidence) {
        if (!entry.payload || typeof entry.payload !== "object") {
          entry.payload = {};
        }
        const previousComparableValue =
          entry.payload.value ?? entry.content ?? entry.summary ?? null;
        const previousVersions = Array.isArray(entry.payload.reconsolidationPreviousValues)
          ? entry.payload.reconsolidationPreviousValues
          : [];
        previousVersions.push({
          recordedAt: referenceTime,
          value: previousComparableValue,
          sourceType: entry.sourceType || null,
          confidence: entry.confidence ?? null,
        });
        entry.payload.reconsolidationPreviousValues = previousVersions.slice(-6);
        if (strongestEvidence?.payload && Object.prototype.hasOwnProperty.call(strongestEvidence.payload, "value")) {
          entry.payload.value = cloneJson(strongestEvidence.payload.value);
        }
        if (normalizeOptionalText(strongestEvidence?.summary)) {
          entry.summary = normalizeOptionalText(strongestEvidence.summary);
        }
        if (normalizeOptionalText(strongestEvidence?.content)) {
          entry.content = normalizeOptionalText(strongestEvidence.content);
        }
        entry.sourceType = strongestEvidence.sourceType || entry.sourceType;
        entry.memoryDynamics.lastReconsolidationOutcome = "rewritten_from_stronger_evidence";
        entry.memoryDynamics.lastReconsolidatedFromMemoryId = strongestEvidence.passportMemoryId || null;
        entry.memoryDynamics.reconsolidationConflictState = "resolved_by_rewrite";
        entry.conflictState = {
          conflictId: normalizeOptionalText(entry?.conflictState?.conflictId) ?? null,
          hasConflict: false,
          conflictingMemoryIds: [],
          resolution: "rewritten_from_stronger_evidence",
        };
        if (entry.payload && typeof entry.payload === "object") {
          entry.payload.reconsolidationConflict = null;
        }
      }
      updatedMemoryIds.push(entry.passportMemoryId);
    }

    restabilizedMemoryIds.push(entry.passportMemoryId);
    linkCountByMemory[entry.passportMemoryId] = evidenceIds.length;
  }

  return {
    restabilizedMemoryIds,
    updatedMemoryIds,
    linkCountByMemory,
  };
}

function runPassportMemoryMaintenanceCycle(
  store,
  agent,
  {
    currentGoal = null,
    cognitiveState = null,
    sourceWindowId = null,
    offlineReplayRequested = false,
  } = {}
) {
  const decay = applyTemporalDecayToPassportMemories(store, agent.agentId, { sourceWindowId, cognitiveState });
  const adaptiveForgetting = applyAdaptivePassportMemoryForgetting(store, agent.agentId, { cognitiveState });
  const homeostaticScaling = applyPassportMemoryHomeostaticScaling(store, agent.agentId);
  const reconsolidation = applyPassportMemoryReconsolidationCycle(store, agent.agentId, {
    currentGoal,
    cognitiveState,
  });
  const activeWorking = listAgentPassportMemories(store, agent.agentId, { layer: "working" }).filter((entry) => isPassportMemoryActive(entry));
  const activeEpisodic = listAgentPassportMemories(store, agent.agentId, { layer: "episodic" }).filter((entry) => isPassportMemoryActive(entry));
  const activeAbstracted = listAgentPassportMemories(store, agent.agentId)
    .filter((entry) => isPassportMemoryActive(entry))
    .filter((entry) => entry.kind === "abstracted_memory");
  const abstractions = [];

  for (const entry of [...activeWorking, ...activeEpisodic]) {
    const abstraction = buildAgedMemoryAbstraction(entry, { sourceWindowId });
    if (!abstraction) {
      continue;
    }
    const existingAbstraction = activeAbstracted.find((candidate) =>
      normalizeOptionalText(candidate?.payload?.gistSummary) === normalizeOptionalText(abstraction?.payload?.gistSummary) &&
      normalizeOptionalText(candidate?.payload?.originalLayer) === normalizeOptionalText(abstraction?.payload?.originalLayer)
    );
    entry.status = "abstracted";
    entry.memoryDynamics.abstractedAt = now();
    if (existingAbstraction) {
      const sourceIds = new Set([
        normalizeOptionalText(existingAbstraction?.payload?.sourcePassportMemoryId),
        ...(Array.isArray(existingAbstraction?.payload?.sourcePassportMemoryIds)
          ? existingAbstraction.payload.sourcePassportMemoryIds
          : []),
        entry.passportMemoryId,
      ].filter(Boolean));
      existingAbstraction.payload.sourcePassportMemoryIds = Array.from(sourceIds);
      existingAbstraction.content = [
        `原始记忆已进入 ${normalizeOptionalText(existingAbstraction?.payload?.retentionBand) ?? normalizeOptionalText(abstraction?.payload?.retentionBand) ?? "aged"} 状态。`,
        `保留概要：${normalizeOptionalText(existingAbstraction?.payload?.gistSummary) ?? normalizeOptionalText(abstraction?.payload?.gistSummary) ?? "older memory"}`,
        `聚合来源：${sourceIds.size} 条`,
        normalizeOptionalText(existingAbstraction?.payload?.originalLayer)
          ? `来源层：${existingAbstraction.payload.originalLayer}`
          : null,
      ].filter(Boolean).join("\n");
      entry.memoryDynamics.abstractedMemoryId = existingAbstraction.passportMemoryId;
      abstractions.push(existingAbstraction.passportMemoryId);
      continue;
    }
    abstraction.payload.sourcePassportMemoryIds = [entry.passportMemoryId];
    entry.memoryDynamics.abstractedMemoryId = abstraction.passportMemoryId;
    store.passportMemories.push(abstraction);
    activeAbstracted.push(abstraction);
    abstractions.push(abstraction.passportMemoryId);
  }

  const replay = runPassportReplayConsolidationCycle(store, agent, {
    sourceWindowId,
    currentGoal,
    activeWorking,
    activeEpisodic,
  });
  const offlineReplay = runPassportOfflineReplayCycle(store, agent, {
    sourceWindowId,
    currentGoal,
    cognitiveState,
    activeWorking,
    activeEpisodic,
    offlineReplayRequested,
  });
  const abstractedDeduplication = deduplicateAbstractedMemories(store, agent.agentId);

  return {
    decay,
    adaptiveForgetting,
    homeostaticScaling,
    reconsolidation,
    replay,
    offlineReplay,
    abstractedDeduplication,
    forgottenMemoryIds: adaptiveForgetting.forgottenMemoryIds,
    promotedMemoryIds: replay.replayedMemoryIds,
    offlineReplayedMemoryIds: offlineReplay.replayedMemoryIds,
    abstractedMemoryIds: abstractions,
  };
}

function extractMemoryHomeostasisProbeJson(text) {
  const normalized = normalizeOptionalText(text) ?? null;
  if (!normalized) {
    return null;
  }
  const candidates = normalized.match(/\[[\s\S]*\]|\{[\s\S]*\}/g) || [];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

function compareMemoryHomeostasisRecall(expected = null, recalled = null) {
  const normalizedExpected = normalizeComparableText(expected);
  const normalizedRecalled = normalizeComparableText(recalled);
  if (!normalizedExpected || !normalizedRecalled) {
    return false;
  }
  return (
    normalizedExpected === normalizedRecalled ||
    normalizedExpected.includes(normalizedRecalled) ||
    normalizedRecalled.includes(normalizedExpected)
  );
}

function shouldRunMemoryHomeostasisActiveProbe(runtimeState = null, previousRuntimeState = null) {
  const currentRisk = toFiniteNumber(runtimeState?.cT ?? runtimeState?.c_t, 0);
  const previousRisk = toFiniteNumber(previousRuntimeState?.cT ?? previousRuntimeState?.c_t, 0);
  const ctxTokens = Math.max(0, Math.floor(toFiniteNumber(runtimeState?.ctxTokens ?? runtimeState?.ctx_tokens, 0)));
  const effectiveLength =
    Math.max(
      1,
      Math.floor(
        toFiniteNumber(
          runtimeState?.profile?.ecl085 ??
            runtimeState?.profile?.ecl_085 ??
            runtimeState?.modelProfile?.ecl085 ??
            runtimeState?.modelProfile?.ecl_085,
          1
        )
      )
    );
  return currentRisk >= 0.2 || currentRisk > previousRisk + 0.05 || ctxTokens / effectiveLength >= 0.82;
}

async function runMemoryHomeostasisActiveProbe(
  contextBuilder,
  {
    deviceRuntime = null,
    reasonerProvider = null,
    localReasoner = null,
    anchors = [],
  } = {}
) {
  const probeAnchors = selectMemoryProbeAnchors(anchors, {
    maxAnchors: 2,
  });
  if (!probeAnchors.length) {
    return null;
  }
  const prompt = [
    "你正在执行 agent-passport 记忆稳态轻量探针。",
    "只根据上面的 Context Slots 回忆下列关键记忆。",
    "只返回 JSON 数组，不要解释。",
    "格式: [{\"memory_id\":\"...\",\"recalled\":\"...\"}]",
    ...probeAnchors.map((anchor) => `- memory_id=${anchor.memoryId}; question=${anchor.probeQuestion || anchor.content}`),
  ].join("\n");
  const effectiveLocalReasoner = normalizeRuntimeLocalReasonerConfig(
    localReasoner ?? deviceRuntime?.localReasoner ?? {}
  );
  const reasonerResult = await generateAgentRunnerCandidateResponse({
    contextBuilder,
    payload: {
      currentGoal: "执行记忆稳态轻量探针",
      userTurn: prompt,
      reasonerProvider:
        normalizeRuntimeReasonerProvider(reasonerProvider) ??
        normalizeRuntimeReasonerProvider(effectiveLocalReasoner?.provider) ??
        DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
      localReasoner: cloneJson(effectiveLocalReasoner) ?? null,
      localReasonerTimeoutMs: effectiveLocalReasoner?.timeoutMs ?? DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
    },
  });
  const parsed = extractMemoryHomeostasisProbeJson(reasonerResult?.responseText) ?? [];
  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.entries(parsed).map(([memoryId, recalled]) => ({
          memory_id: memoryId,
          recalled,
        }))
      : [];
  const evaluatedResults = probeAnchors.map((anchor) => {
    const item = items.find(
      (candidate) =>
        normalizeOptionalText(candidate?.memory_id || candidate?.memoryId) === anchor.memoryId
    );
    const recalled = normalizeOptionalText(item?.recalled) ?? null;
    return {
      memoryId: anchor.memoryId,
      recalled,
      ok: compareMemoryHomeostasisRecall(anchor.expectedValue || anchor.content, recalled),
    };
  });
  return {
    checkedAt: now(),
    probeAnchors,
    results: evaluatedResults,
    reasoner: {
      provider: normalizeOptionalText(reasonerResult?.provider) ?? null,
      model:
        normalizeOptionalText(reasonerResult?.metadata?.model) ??
        normalizeOptionalText(reasonerResult?.model) ??
        null,
    },
    rawResponseText: normalizeOptionalText(reasonerResult?.responseText) ?? null,
  };
}

function compactConversationToPassportMemories(store, agent, payload = {}) {
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  const writes = [];
  const writeConversationTurns = normalizeBooleanFlag(payload.writeConversationTurns, true);

  for (const [index, turn] of turns.entries()) {
    const role = normalizeOptionalText(turn?.role) ?? "unknown";
    const content = normalizeOptionalText(turn?.content) ?? "";
    if (!content) {
      continue;
    }

    if (writeConversationTurns) {
      writes.push(
        normalizePassportMemoryRecord(agent.agentId, {
          layer: "working",
          kind: "conversation_turn",
          summary: `${role} turn ${index + 1}`,
          content,
          payload: { role, turnIndex: index },
          tags: ["conversation", role],
          sourceWindowId: payload.sourceWindowId,
          recordedByAgentId: payload.recordedByAgentId || agent.agentId,
          recordedByWindowId: payload.recordedByWindowId || payload.sourceWindowId,
        })
      );
    }

    for (const rawLine of content.split(/\n+/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const mappings = [
        { layer: "profile", kind: "name", field: "name", patterns: [/^(?:名字|name)[:：]\s*(.+)$/i] },
        { layer: "profile", kind: "role", field: "role", patterns: [/^(?:角色|role)[:：]\s*(.+)$/i] },
        { layer: "profile", kind: "long_term_goal", field: "long_term_goal", patterns: [/^(?:长期目标|goal)[:：]\s*(.+)$/i] },
        { layer: "profile", kind: "preference", field: "preference", patterns: [/^(?:偏好|preference)[:：]\s*(.+)$/i] },
        { layer: "working", kind: "current_task", field: "current_task", patterns: [/^(?:当前任务|task)[:：]\s*(.+)$/i] },
        { layer: "working", kind: "next_action", field: "next_action", patterns: [/^(?:下一步|next)[:：]\s*(.+)$/i] },
        { layer: "episodic", kind: "result", field: "result", patterns: [/^(?:结果|完成|outcome)[:：]\s*(.+)$/i] },
        { layer: "episodic", kind: "relationship", field: "relationship", patterns: [/^(?:关系变化|relationship)[:：]\s*(.+)$/i] },
        { layer: "ledger", kind: "commitment", field: "commitment", patterns: [/^(?:承诺|commitment)[:：]\s*(.+)$/i] },
      ];

      for (const mapping of mappings) {
        const matched = extractClaimValueFromText(line, mapping.patterns);
        if (!matched) {
          continue;
        }

        writes.push(
          normalizePassportMemoryRecord(agent.agentId, {
            layer: mapping.layer,
            kind: mapping.kind,
            summary: matched,
            content: matched,
            payload: { field: mapping.field, value: matched, compactedFromRole: role, line },
            tags: ["compacted", mapping.layer, mapping.kind],
            sourceWindowId: payload.sourceWindowId,
            recordedByAgentId: payload.recordedByAgentId || agent.agentId,
            recordedByWindowId: payload.recordedByWindowId || payload.sourceWindowId,
          })
        );
      }
    }
  }

  return writes;
}

function buildToolResultPassportMemories(agentId, toolResults = [], payload = {}) {
  if (!Array.isArray(toolResults)) {
    return [];
  }

  return toolResults
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const tool = normalizeOptionalText(entry.tool || entry.name) ?? "tool";
      const result = normalizeOptionalText(entry.result || entry.output || entry.summary) ?? null;
      if (!tool && !result) {
        return null;
      }

      return normalizePassportMemoryRecord(agentId, {
        layer: "working",
        kind: "tool_result",
        summary: `${tool} result`,
        content: result,
        payload: {
          tool,
          turnIndex: index,
        },
        tags: ["tool_result", tool],
        sourceWindowId: payload.sourceWindowId,
        recordedByAgentId: payload.recordedByAgentId || agentId,
        recordedByWindowId: payload.recordedByWindowId || payload.sourceWindowId,
      });
    })
    .filter(Boolean);
}

function summarizePassportMemoryWrites(writes = []) {
  const byLayer = {};
  const byKind = {};
  for (const record of writes) {
    const layer = normalizePassportMemoryLayer(record?.layer);
    const kind = normalizeOptionalText(record?.kind) ?? "note";
    byLayer[layer] = (byLayer[layer] || 0) + 1;
    byKind[kind] = (byKind[kind] || 0) + 1;
  }

  return {
    writeCount: writes.length,
    byLayer,
    byKind,
    passportMemoryIds: writes.map((item) => item.passportMemoryId).filter(Boolean),
  };
}

function buildWorkingMemoryCheckpoint(
  store,
  agent,
  {
    currentGoal = null,
    sourceWindowId = null,
    recordedByAgentId = null,
    recordedByWindowId = null,
    threshold = DEFAULT_WORKING_MEMORY_CHECKPOINT_THRESHOLD,
    retainCount = DEFAULT_WORKING_MEMORY_RECENT_WINDOW,
  } = {}
) {
  const normalizedThreshold = Math.max(1, Math.floor(toFiniteNumber(threshold, DEFAULT_WORKING_MEMORY_CHECKPOINT_THRESHOLD)));
  const normalizedRetainCount = Math.max(1, Math.floor(toFiniteNumber(retainCount, DEFAULT_WORKING_MEMORY_RECENT_WINDOW)));
  const activeWorkingEntries = listAgentPassportMemories(store, agent.agentId, { layer: "working" }).filter(
    (entry) => isPassportMemoryActive(entry)
  );
  const rolloverCandidates = activeWorkingEntries.filter((entry) => ["conversation_turn", "tool_result"].includes(entry.kind));
  const effectiveRetainCount = Math.min(normalizedRetainCount, rolloverCandidates.length || normalizedRetainCount);

  if (rolloverCandidates.length <= normalizedThreshold) {
    return {
      triggered: false,
      threshold: normalizedThreshold,
      retainCount: effectiveRetainCount,
      candidateCount: rolloverCandidates.length,
      activeWorkingCount: activeWorkingEntries.length,
    };
  }

  const archivedEntries = rolloverCandidates.slice(0, Math.max(0, rolloverCandidates.length - effectiveRetainCount));
  const retainedEntries = rolloverCandidates.slice(-effectiveRetainCount);
  if (archivedEntries.length === 0) {
    return {
      triggered: false,
      threshold: normalizedThreshold,
      retainCount: effectiveRetainCount,
      candidateCount: rolloverCandidates.length,
      activeWorkingCount: activeWorkingEntries.length,
    };
  }

  for (const entry of archivedEntries) {
    entry.status = "superseded";
  }

  const archivedKinds = [...new Set(archivedEntries.map((entry) => entry.kind).filter(Boolean))];
  const checkpointRecord = normalizePassportMemoryRecord(agent.agentId, {
    layer: "working",
    kind: "checkpoint_summary",
    summary: `working checkpoint：归档 ${archivedEntries.length} 条`,
    content: [
      currentGoal ? `当前目标：${currentGoal}` : null,
      `已归档 ${archivedEntries.length} 条 working entries`,
      retainedEntries.length > 0 ? `保留最近 ${retainedEntries.length} 条` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    payload: {
      currentGoal: normalizeOptionalText(currentGoal) ?? null,
      archivedCount: archivedEntries.length,
      retainedCount: retainedEntries.length,
      archivedMemoryIds: archivedEntries.map((entry) => entry.passportMemoryId),
      retainedMemoryIds: retainedEntries.map((entry) => entry.passportMemoryId),
      archivedKinds,
      threshold: normalizedThreshold,
      retainCount: effectiveRetainCount,
    },
    tags: ["checkpoint", "working", "rollover", ...archivedKinds],
    sourceWindowId,
    recordedByAgentId: normalizeOptionalText(recordedByAgentId) ?? agent.agentId,
    recordedByWindowId: normalizeOptionalText(recordedByWindowId || sourceWindowId) ?? null,
  });
  store.passportMemories.push(checkpointRecord);

  appendEvent(store, "working_memory_checkpointed", {
    agentId: agent.agentId,
    checkpointMemoryId: checkpointRecord.passportMemoryId,
    archivedCount: archivedEntries.length,
    retainedCount: retainedEntries.length,
    threshold: normalizedThreshold,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
  });

  const activeWorkingCountAfter = listAgentPassportMemories(store, agent.agentId, { layer: "working" }).filter(
    (entry) => isPassportMemoryActive(entry)
  ).length;

  return {
    triggered: true,
    threshold: normalizedThreshold,
    retainCount: effectiveRetainCount,
    candidateCount: rolloverCandidates.length,
    archivedCount: archivedEntries.length,
    retainedCount: retainedEntries.length,
    archivedMemoryIds: archivedEntries.map((entry) => entry.passportMemoryId),
    retainedMemoryIds: retainedEntries.map((entry) => entry.passportMemoryId),
    archivedKinds,
    checkpointMemoryId: checkpointRecord.passportMemoryId,
    checkpoint: cloneJson(checkpointRecord) ?? null,
    activeWorkingCount: activeWorkingEntries.length,
    activeWorkingCountAfter,
  };
}

function listAgentCompactBoundariesFromStore(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_compact_boundaries",
    store,
    agentId,
    buildCollectionTailToken(store?.compactBoundaries || [], {
      idFields: ["compactBoundaryId"],
      timeFields: ["createdAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    (store.compactBoundaries || [])
      .filter((boundary) => matchesCompatibleAgentId(store, boundary.agentId, agentId))
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
  );
}

function findPassportMemoryRecord(store, passportMemoryId) {
  const normalizedPassportMemoryId = normalizeOptionalText(passportMemoryId) ?? null;
  if (!normalizedPassportMemoryId) {
    return null;
  }

  return (store.passportMemories || []).find((entry) => entry.passportMemoryId === normalizedPassportMemoryId) ?? null;
}

function findCompactBoundaryRecord(store, agentId, compactBoundaryId) {
  const normalizedCompactBoundaryId = normalizeOptionalText(compactBoundaryId) ?? null;
  if (!normalizedCompactBoundaryId) {
    return null;
  }

  return (
    (store.compactBoundaries || []).find(
      (boundary) =>
        matchesCompatibleAgentId(store, boundary.agentId, agentId) &&
        boundary.compactBoundaryId === normalizedCompactBoundaryId
    ) ?? null
  );
}

function buildCompactBoundaryResumeView(store, agent, compactBoundaryId) {
  const boundary = findCompactBoundaryRecord(store, agent.agentId, compactBoundaryId);
  if (!boundary) {
    return null;
  }

  const checkpointMemory = findPassportMemoryRecord(store, boundary.checkpointMemoryId);
  const archivedEntries = (boundary.archivedMemoryIds || [])
    .map((memoryId) => findPassportMemoryRecord(store, memoryId))
    .filter(Boolean);
  const retainedEntries = (boundary.retainedMemoryIds || [])
    .map((memoryId) => findPassportMemoryRecord(store, memoryId))
    .filter(Boolean);
  const archivedConversationTurns = archivedEntries
    .filter((entry) => entry.kind === "conversation_turn")
    .slice(-6)
    .map((entry) => ({
      passportMemoryId: entry.passportMemoryId,
      role: normalizeOptionalText(entry.payload?.role) ?? "unknown",
      content: entry.content || entry.summary || "",
    }));
  const archivedToolResults = archivedEntries
    .filter((entry) => entry.kind === "tool_result")
    .slice(-6)
    .map((entry) => ({
      passportMemoryId: entry.passportMemoryId,
      tool: normalizeOptionalText(entry.payload?.tool) ?? entry.summary ?? "tool",
      result: entry.content || entry.summary || "",
    }));
  const retainedConversationTurns = retainedEntries
    .filter((entry) => entry.kind === "conversation_turn")
    .slice(-6)
    .map((entry) => ({
      passportMemoryId: entry.passportMemoryId,
      role: normalizeOptionalText(entry.payload?.role) ?? "unknown",
      content: entry.content || entry.summary || "",
    }));
  const retainedToolResults = retainedEntries
    .filter((entry) => entry.kind === "tool_result")
    .slice(-6)
    .map((entry) => ({
      passportMemoryId: entry.passportMemoryId,
      tool: normalizeOptionalText(entry.payload?.tool) ?? entry.summary ?? "tool",
      result: entry.content || entry.summary || "",
    }));

  return {
    compactBoundaryId: boundary.compactBoundaryId,
    didMethod: boundary.didMethod || null,
    runId: boundary.runId || null,
    previousCompactBoundaryId: boundary.previousCompactBoundaryId || null,
    resumedFromCompactBoundaryId: boundary.resumedFromCompactBoundaryId || null,
    chainRootCompactBoundaryId: boundary.chainRootCompactBoundaryId || boundary.compactBoundaryId || null,
    resumeDepth: Math.max(0, Math.floor(toFiniteNumber(boundary.resumeDepth, 0))),
    lineageCompactBoundaryIds: cloneJson(boundary.lineageCompactBoundaryIds) ?? [boundary.compactBoundaryId],
    checkpointMemoryId: boundary.checkpointMemoryId || null,
    currentGoal: boundary.currentGoal || null,
    summary: boundary.summary || checkpointMemory?.summary || null,
    checkpointSummary: checkpointMemory?.content || boundary.summary || null,
    archivedCount: boundary.archivedCount || archivedEntries.length,
    retainedCount: boundary.retainedCount || retainedEntries.length,
    archivedKinds: cloneJson(boundary.archivedKinds) ?? [],
    archivedMemoryIds: cloneJson(boundary.archivedMemoryIds) ?? [],
    retainedMemoryIds: cloneJson(boundary.retainedMemoryIds) ?? [],
    archivedConversationTurns,
    archivedToolResults,
    retainedConversationTurns,
    retainedToolResults,
    recoveryPrompt: [
      `Resume from compact boundary ${boundary.compactBoundaryId}.`,
      boundary.summary ? `Checkpoint: ${boundary.summary}` : null,
      checkpointMemory?.content ? checkpointMemory.content : null,
      boundary.resumedFromCompactBoundaryId ? `This boundary continues from ${boundary.resumedFromCompactBoundaryId}.` : null,
      archivedConversationTurns.length
        ? `Archived conversation: ${archivedConversationTurns.map((entry) => `${entry.role}: ${entry.content}`).join(" | ")}`
        : null,
      archivedToolResults.length
        ? `Archived tools: ${archivedToolResults.map((entry) => `${entry.tool}: ${entry.result}`).join(" | ")}`
        : null,
      "Continue directly from this boundary without recap or extra continuation chatter.",
    ]
      .filter(Boolean)
      .join("\n"),
    sourceWindowId: boundary.sourceWindowId || null,
    createdAt: boundary.createdAt || null,
  };
}

function listAgentSessionStatesFromStore(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_session_states",
    store,
    agentId,
    buildCollectionTailToken(store?.agentSessionStates || [], {
      idFields: ["sessionStateId"],
      timeFields: ["updatedAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    (store.agentSessionStates || [])
      .filter((state) => matchesCompatibleAgentId(store, state.agentId, agentId))
      .sort((a, b) => (a.updatedAt || "").localeCompare(b.updatedAt || ""))
  );
}

function upsertAgentSessionState(
  store,
  agent,
  {
    didMethod = null,
    currentGoal = null,
    contextBuilder = null,
    driftCheck = null,
    run = null,
    queryState = null,
    negotiation = null,
    cognitiveState = null,
    compactBoundary = null,
    runtimeMemoryState = null,
    resumeBoundaryId = null,
    sourceWindowId = null,
    transitionReason = null,
    persist = true,
  } = {}
) {
  const existing = listAgentSessionStatesFromStore(store, agent.agentId).at(-1) ?? null;
  const runtimeFromContext =
    contextBuilder?.slots?.identitySnapshot?.taskSnapshot || contextBuilder?.runtimePolicy
      ? {
          taskSnapshot: contextBuilder?.slots?.identitySnapshot?.taskSnapshot ?? latestAgentTaskSnapshot(store, agent.agentId) ?? null,
          policy: normalizeRuntimeDriftPolicy(
            contextBuilder?.runtimePolicy ||
              contextBuilder?.slots?.identitySnapshot?.taskSnapshot?.driftPolicy ||
              {}
          ),
        }
      : null;
  const runtime =
    runtimeFromContext ||
    buildAgentRuntimeSnapshot(store, agent, {
      didMethod,
      lightweight: true,
      includeRehydratePreview: false,
      transcriptEntryLimit: DEFAULT_LIGHTWEIGHT_TRANSCRIPT_LIMIT,
    });
  const memoryCounts =
    contextBuilder?.memoryLayers?.counts && typeof contextBuilder.memoryLayers.counts === "object"
      ? {
          profile: contextBuilder.memoryLayers.counts.profile ?? 0,
          episodic: contextBuilder.memoryLayers.counts.episodic ?? 0,
          working: contextBuilder.memoryLayers.counts.working ?? 0,
          ledgerCommitments: contextBuilder.memoryLayers.counts.ledgerCommitments ?? 0,
        }
      : buildAgentMemoryCountSummary(store, agent.agentId);
  const compactBoundaries = listAgentCompactBoundariesFromStore(store, agent.agentId);
  const currentDid = resolveAgentDidForMethod(store, agent, didMethod) || agent.identity?.did || null;
  const residentGate = buildResidentAgentGate(store, agent, { didMethod });
  const deviceRuntime = normalizeDeviceRuntime(store.deviceRuntime);
  const nextState = buildAgentSessionStateRecord(agent, {
    existing,
    didMethod,
    currentDid,
    currentDidMethod: didMethodFromReference(currentDid),
    currentGoal,
    contextBuilder,
    driftCheck,
    run,
    queryState,
    negotiation,
    cognitiveState,
    compactBoundary,
    compactBoundaries,
    runtime,
    memoryCounts,
    residentGate,
    deviceRuntime,
    activeWindowIds: listAgentWindows(store, agent.agentId).map((window) => window.windowId),
    runtimeMemoryState,
    resumeBoundaryId,
    sourceWindowId,
    transitionReason,
  });

  if (!persist) {
    return nextState;
  }
  if (!Array.isArray(store.agentSessionStates)) {
    store.agentSessionStates = [];
  }
  const existingIndex = store.agentSessionStates.findIndex((state) => state.agentId === agent.agentId);
  if (existingIndex >= 0) {
    store.agentSessionStates[existingIndex] = nextState;
  } else {
    store.agentSessionStates.push(nextState);
  }

  return nextState;
}

function listAgentVerificationRunsFromStore(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_verification_runs",
    store,
    agentId,
    buildCollectionTailToken(store?.verificationRuns || [], {
      idFields: ["verificationRunId"],
      timeFields: ["createdAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    (store.verificationRuns || [])
      .filter((run) => matchesCompatibleAgentId(store, run.agentId, agentId))
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
  );
}

function listAgentRunsFromStore(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_runs",
    store,
    agentId,
    buildCollectionTailToken(store?.agentRuns || [], {
      idFields: ["runId"],
      timeFields: ["executedAt", "createdAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    (store.agentRuns || [])
      .filter((run) => matchesCompatibleAgentId(store, run.agentId, agentId))
      .sort((a, b) => (a.executedAt || a.createdAt || "").localeCompare(b.executedAt || b.createdAt || ""))
  );
}

function listAgentQueryStatesFromStore(store, agentId) {
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_query_states",
    store,
    agentId,
    buildCollectionTailToken(store?.agentQueryStates || [], {
      idFields: ["queryStateId"],
      timeFields: ["createdAt"],
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () =>
    (store.agentQueryStates || [])
      .filter((state) => matchesCompatibleAgentId(store, state.agentId, agentId))
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
  );
}

function buildAgentContextSnapshot(
  store,
  agent,
  {
    didMethod = null,
    runtimeLimit = DEFAULT_RUNTIME_LIMIT,
    messageLimit = DEFAULT_MESSAGE_LIMIT,
    memoryLimit = DEFAULT_MEMORY_LIMIT,
    authorizationLimit = DEFAULT_AUTHORIZATION_LIMIT,
    credentialLimit = DEFAULT_CREDENTIAL_LIMIT,
    lightweight = false,
    comparisonOnly = false,
    includeRehydratePreview = !lightweight,
  } = {}
) {
  const resolvedRuntimeLimit = Math.max(1, Math.min(runtimeLimit, DEFAULT_RUNTIME_LIMIT));
  const windows = lightweight
    ? listAgentWindows(store, agent.agentId).slice(-resolvedRuntimeLimit)
    : listAgentWindows(store, agent.agentId);
  const memories = listAgentMemories(store, agent.agentId).slice(-memoryLimit);
  const inbox = listAgentInbox(store, agent.agentId).slice(-messageLimit);
  const outbox = listAgentOutbox(store, agent.agentId).slice(-messageLimit);
  const authorizations = listAuthorizationProposalViews(store, { agentId: agent.agentId, limit: authorizationLimit });
  const credentials = listCredentialRecordViews(store, {
    agentId: agent.agentId,
    limit: credentialLimit,
    detailLevel: comparisonOnly ? "preview" : null,
  });
  const previewLimit = Math.max(1, Math.min(credentialLimit, 10));
  const migrationRepairs = comparisonOnly
    ? []
    : listMigrationRepairViews(store, {
        agentId: agent.agentId,
        limit: previewLimit,
      });
  const compactBoundaries = comparisonOnly
    ? []
    : listAgentCompactBoundariesFromStore(store, agent.agentId)
        .slice(-previewLimit)
        .map((boundary) => buildCompactBoundaryView(boundary));
  const agentQueryStates = comparisonOnly
    ? []
    : listAgentQueryStatesFromStore(store, agent.agentId)
        .slice(-previewLimit)
        .map((state) => buildAgentQueryStateView(state));
  const runtime = comparisonOnly
    ? null
    : buildAgentRuntimeSnapshot(store, agent, {
        didMethod,
        runtimeLimit: resolvedRuntimeLimit,
        memoryLimit: Math.min(memoryLimit, DEFAULT_RUNTIME_REHYDRATE_MEMORY_LIMIT),
        messageLimit: Math.min(messageLimit, DEFAULT_RUNTIME_REHYDRATE_MESSAGE_LIMIT),
        authorizationLimit: Math.min(authorizationLimit, DEFAULT_RUNTIME_REHYDRATE_AUTHORIZATION_LIMIT),
        credentialLimit: Math.min(credentialLimit, DEFAULT_RUNTIME_REHYDRATE_CREDENTIAL_LIMIT),
        lightweight,
        includeRehydratePreview,
      });
  const rawSessionState = comparisonOnly ? null : listAgentSessionStatesFromStore(store, agent.agentId).at(-1) ?? null;
  const sessionState = rawSessionState
    ? {
        ...(buildAgentSessionStateView(rawSessionState) ?? {}),
        residentAgentId: rawSessionState.residentAgentId ?? runtime?.residentGate?.residentAgentId ?? null,
        residentLockRequired:
          rawSessionState.residentLockRequired != null
            ? Boolean(rawSessionState.residentLockRequired)
            : Boolean(runtime?.residentGate?.required),
        localMode: rawSessionState.localMode ?? runtime?.deviceRuntime?.localMode ?? null,
      }
    : null;
  const agentRuns = comparisonOnly
    ? []
    : listAgentRunsFromStore(store, agent.agentId)
        .slice(-previewLimit)
        .map((run) => buildAgentRunView(run));
  const verificationRuns = comparisonOnly
    ? []
    : listAgentVerificationRunsFromStore(store, agent.agentId)
        .slice(-previewLimit)
        .map((run) => buildVerificationRunView(run));
  const memoryLayers = comparisonOnly
    ? null
    : buildAgentMemoryLayerView(store, agent, {
        query: runtime?.taskSnapshot?.objective || runtime?.taskSnapshot?.title || null,
        currentGoal: runtime?.taskSnapshot?.objective || runtime?.taskSnapshot?.title || null,
        lightweight,
      });
  const credentialMethodCoverage = buildAgentCredentialMethodCoverage(store, agent.agentId);
  const preferredDid = resolveAgentDidForMethod(store, agent, didMethod);
  const statusListRegistry = new Map();
  for (const statusList of buildCredentialStatusLists(store)) {
    statusListRegistry.set(statusList.statusListId, statusList);
  }

  const agentStatusList = buildCredentialStatusList(store, preferredDid);
  statusListRegistry.set(agentStatusList.statusListId, agentStatusList);

  const statusLists = [...statusListRegistry.values()].sort((a, b) => {
    const labelDiff = (a.issuerLabel || a.issuerDid || "").localeCompare(b.issuerLabel || b.issuerDid || "");
    if (labelDiff !== 0) {
      return labelDiff;
    }

    return (a.statusListId || "").localeCompare(b.statusListId || "");
  });
  const statusList =
    statusLists.find((item) => item.issuerDid === preferredDid || item.issuerAgentId === agent.agentId) ??
    agentStatusList ??
    statusLists[0] ??
    null;
  const resolvedIdentity = {
    ...(cloneJson(agent.identity) ?? {}),
    did: preferredDid,
    didAliases: inferDidAliases(preferredDid, agent.agentId),
    primaryDid: agent.identity?.did ?? preferredDid,
  };

  return {
    agent,
    identity: resolvedIdentity,
    deviceRuntime: runtime?.deviceRuntime ?? null,
    residentGate: runtime?.residentGate ?? null,
    didAliases: resolvedIdentity.didAliases,
    didDocument: buildDidDocument(agent, { method: didMethod }),
    assets: {
      credits: agent.balances.credits ?? 0,
    },
    windows,
    memories,
    inbox,
    outbox,
    authorizations,
    credentials,
    migrationRepairs,
    compactBoundaries,
    agentQueryStates,
    sessionState,
    agentRuns,
    verificationRuns,
    integrityRuns: cloneJson(verificationRuns),
    runtime,
    memoryLayers,
    credentialMethodCoverage,
    statusLists: statusLists.map((item) => item.summary),
    statusList: statusList.summary,
    counts: {
      windows: windows.length,
      memories: memories.length,
      inbox: inbox.length,
      outbox: outbox.length,
      authorizations: authorizations.length,
      credentials: credentials.length,
      migrationRepairs: migrationRepairs.length,
      compactBoundaries: compactBoundaries.length,
      agentQueryStates: agentQueryStates.length,
      verificationRuns: verificationRuns.length,
      integrityRuns: verificationRuns.length,
      agentRuns: agentRuns.length,
      taskSnapshots: runtime?.counts?.taskSnapshots ?? 0,
      conversationMinutes: runtime?.counts?.conversationMinutes ?? 0,
      decisionLogs: runtime?.counts?.decisionLogs ?? 0,
      evidenceRefs: runtime?.counts?.evidenceRefs ?? 0,
      profileMemories: memoryLayers?.counts?.profile ?? 0,
      episodicMemories: memoryLayers?.counts?.episodic ?? 0,
      workingMemories: memoryLayers?.counts?.working ?? 0,
      ledgerCommitments: memoryLayers?.counts?.ledgerCommitments ?? 0,
      statusLists: statusLists.length,
    },
  };
}

export async function resolveAgentIdentity({ agentId, did, walletAddress, windowId } = {}) {
  const store = await loadStore();
  const { agent } = resolveAgentReferenceFromStore(store, { agentId, did, walletAddress, windowId });
  return agent;
}

export async function listWindows() {
  const store = await loadStore();
  return Object.values(store.windows).sort((a, b) => a.linkedAt.localeCompare(b.linkedAt));
}

export async function getWindow(windowId) {
  const store = await loadStore();
  const resolvedWindowId = normalizeWindowId(windowId);
  const window = store.windows[resolvedWindowId];
  if (!window) {
    throw new Error(`Window not found: ${resolvedWindowId}`);
  }

  return window;
}

export async function linkWindow({ windowId, agentId, label = DEFAULT_WINDOW_LABEL } = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const resolvedWindowId = normalizeWindowId(windowId);
    const existing = store.windows[resolvedWindowId];
    if (existing?.agentId && existing.agentId !== agent.agentId) {
      throw new Error(`Window ${resolvedWindowId} is already linked to agent ${existing.agentId}`);
    }
    const nowIso = now();
    const binding = {
      windowId: resolvedWindowId,
      agentId: agent.agentId,
      label: normalizeOptionalText(label) ?? existing?.label ?? DEFAULT_WINDOW_LABEL,
      createdAt: existing?.createdAt ?? nowIso,
      linkedAt: nowIso,
      lastSeenAt: nowIso,
    };

    store.windows[resolvedWindowId] = binding;
    appendEvent(store, existing ? "window_relinked" : "window_linked", {
      windowId: binding.windowId,
      agentId: binding.agentId,
      label: binding.label,
    });

    await writeStore(store, { archiveColdData: false });
    return binding;
  });
}

export async function recordMemory(agentId, payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const content = normalizeOptionalText(payload.content);
    if (!content) {
      throw new Error("content is required");
    }

    const memory = {
      memoryId: createRecordId("mem"),
      agentId: agent.agentId,
      kind: normalizeOptionalText(payload.kind) ?? "note",
      content,
      tags: normalizeTextList(payload.tags),
      importance: toFiniteNumber(payload.importance, 0.5),
      sourceWindowId: normalizeOptionalText(payload.sourceWindowId) ?? null,
      sourceMessageId: normalizeOptionalText(payload.sourceMessageId) ?? null,
      createdAt: now(),
    };

    store.memories.push(memory);
    appendEvent(store, "memory_recorded", {
      memoryId: memory.memoryId,
      agentId: memory.agentId,
      kind: memory.kind,
      sourceWindowId: memory.sourceWindowId,
    });

    await writeStore(store);
    return memory;
  });
}

export async function listMemories(agentId, limit = DEFAULT_MEMORY_LIMIT) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const memories = listAgentMemories(store, agent.agentId);
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_MEMORY_LIMIT;
  return memories.slice(-cappedLimit);
}

function buildAgentRehydratePack(
  store,
  agent,
  {
    didMethod = null,
    resumeFromCompactBoundaryId = null,
    runtimeLimit = DEFAULT_RUNTIME_LIMIT,
    memoryLimit = DEFAULT_RUNTIME_REHYDRATE_MEMORY_LIMIT,
    messageLimit = DEFAULT_RUNTIME_REHYDRATE_MESSAGE_LIMIT,
    authorizationLimit = DEFAULT_RUNTIME_REHYDRATE_AUTHORIZATION_LIMIT,
    credentialLimit = DEFAULT_RUNTIME_REHYDRATE_CREDENTIAL_LIMIT,
  } = {}
) {
  const cacheKey = hashJson({
    kind: "rehydrate_pack",
    fingerprint: buildStorePerformanceFingerprint(store, agent.agentId),
    agentId: agent.agentId,
    didMethod: normalizeDidMethod(didMethod) || null,
    resumeFromCompactBoundaryId: normalizeOptionalText(resumeFromCompactBoundaryId) ?? null,
    runtimeLimit,
    memoryLimit,
    messageLimit,
    authorizationLimit,
    credentialLimit,
  });
  const cachedPack = getCachedRehydratePack(cacheKey);
  if (cachedPack) {
    return cachedPack;
  }

  const runtime = buildAgentRuntimeSnapshot(store, agent, {
    didMethod,
    runtimeLimit,
    memoryLimit,
    messageLimit,
    authorizationLimit,
    credentialLimit,
    lightweight: true,
    includeRehydratePreview: false,
    transcriptEntryLimit: Math.max(DEFAULT_LIGHTWEIGHT_TRANSCRIPT_LIMIT, messageLimit * 2),
  });
  const resolvedDid = resolveAgentDidForMethod(store, agent, didMethod);
  const inbox = listAgentInbox(store, agent.agentId).slice(-messageLimit);
  const outbox = listAgentOutbox(store, agent.agentId).slice(-messageLimit);
  const memories = listAgentMemories(store, agent.agentId).slice(-memoryLimit);
  const authorizations = listAuthorizationProposalViews(store, { agentId: agent.agentId, limit: authorizationLimit });
  const credentials = listCredentialRecordViews(store, { agentId: agent.agentId, limit: credentialLimit });
  const resumeBoundary = buildCompactBoundaryResumeView(store, agent, resumeFromCompactBoundaryId);
  const latestQueryState = buildAgentQueryStateView(listAgentQueryStatesFromStore(store, agent.agentId).at(-1) ?? null);
  const transcriptModel = buildTranscriptModelSnapshot(store, agent, {
    limit: Math.max(DEFAULT_LIGHTWEIGHT_TRANSCRIPT_LIMIT, messageLimit * 2),
  }, TRANSCRIPT_MODEL_DEPS);
  const runtimeKnowledge = searchAgentRuntimeKnowledgeFromStore(store, agent, {
    didMethod,
    query:
      normalizeOptionalText(runtime.taskSnapshot?.objective) ??
      normalizeOptionalText(runtime.taskSnapshot?.title) ??
      normalizeOptionalText(resumeBoundary?.summary) ??
      null,
    limit: runtime.deviceRuntime?.retrievalPolicy?.maxHits ?? DEFAULT_RUNTIME_SEARCH_LIMIT,
    includeExternalColdMemory: true,
    recentOnly: true,
  });
  const { localHits: localKnowledgeHits, externalColdMemoryHits } = splitRuntimeSearchHits(
    runtimeKnowledge.hits
  );
  if (resumeFromCompactBoundaryId && !resumeBoundary) {
    throw new Error(`Compact boundary not found: ${resumeFromCompactBoundaryId}`);
  }
  const prompt = buildRuntimeBriefing({
    agent,
    snapshot: runtime.taskSnapshot,
    decisions: runtime.activeDecisions.slice(-5),
    minutes: runtime.conversationMinutes?.slice?.(-5) || [],
    transcriptEntries: runtime.transcript?.entries?.slice?.(-5) || [],
    evidenceRefs: runtime.evidenceRefs.slice(-5),
    memories: memories.slice(-3),
    authorizations: authorizations.slice(-3),
    credentials: credentials.slice(-3),
    windows: listAgentWindows(store, agent.agentId).slice(-3),
    didMethod,
    deviceRuntime: runtime.deviceRuntime,
    resumeBoundary,
    defaultChainId: DEFAULT_CHAIN_ID,
  });
  const pack = {
    generatedAt: now(),
    agentId: agent.agentId,
    didMethod: normalizeDidMethod(didMethod) || didMethodFromReference(resolvedDid) || null,
    identity: {
      agentId: agent.agentId,
      displayName: agent.displayName,
      role: agent.role,
      did: resolvedDid,
      walletAddress: agent.identity?.walletAddress ?? null,
      controller: agent.controller,
    },
    taskSnapshot: runtime.taskSnapshot,
    activeDecisions: runtime.activeDecisions.slice(-5),
    evidenceRefs: runtime.evidenceRefs.slice(-5),
    recentMemories: memories.slice(-5),
    recentInbox: inbox.slice(-3),
    recentOutbox: outbox.slice(-3),
    recentAuthorizations: authorizations.slice(-3),
    recentCredentials: credentials.slice(-3),
    transcriptModel,
    localKnowledgeHits,
    externalColdMemoryHits,
    deviceRuntime: runtime.deviceRuntime,
    residentGate: runtime.residentGate,
    resumeBoundary,
    queryState: latestQueryState,
    policy: runtime.policy,
    prompt,
    sources: {
      taskSnapshotId: runtime.taskSnapshot?.snapshotId ?? null,
      minuteIds: (runtime.conversationMinutes || []).map((item) => item.minuteId),
      decisionIds: runtime.activeDecisions.map((item) => item.decisionId),
      evidenceRefIds: runtime.evidenceRefs.map((item) => item.evidenceRefId),
      transcriptEntryIds: transcriptModel.entries.map((item) => item.transcriptEntryId),
      resumeFromCompactBoundaryId: resumeBoundary?.compactBoundaryId ?? null,
    },
  };

  const result = {
    ...pack,
    packHash: hashJson(pack),
    capabilityBoundarySummary: buildExecutionCapabilityBoundarySummary({
      executionKind: "rehydrate",
    }),
  };
  setCachedRehydratePack(cacheKey, result);
  return result;
}

function buildAgentDriftCheck(store, agent, payload = {}, { didMethod = null } = {}) {
  const resumeFromCompactBoundaryId = normalizeOptionalText(payload.resumeFromCompactBoundaryId) ?? null;
  const currentGoal = normalizeOptionalText(payload.currentGoal || payload.goal) ?? null;
  const workingSummary = normalizeOptionalText(payload.workingSummary || payload.summary) ?? null;
  const nextAction = normalizeOptionalText(payload.nextAction) ?? null;
  const referencedDecisionIds = normalizeTextList(payload.referencedDecisionIds);
  const referencedEvidenceRefIds = normalizeTextList(payload.referencedEvidenceRefIds);
  const runtimeFromPayload =
    payload.runtimeSnapshot && typeof payload.runtimeSnapshot === "object" ? payload.runtimeSnapshot : null;
  const snapshotFromPayload =
    payload.taskSnapshot && typeof payload.taskSnapshot === "object" ? payload.taskSnapshot : null;
  const policyFromPayload =
    payload.runtimePolicy && typeof payload.runtimePolicy === "object"
      ? normalizeRuntimeDriftPolicy(payload.runtimePolicy)
      : null;
  const needsRuntimeCollections = referencedDecisionIds.length > 0 || referencedEvidenceRefIds.length > 0;
  const runtime =
    runtimeFromPayload ||
    (snapshotFromPayload && policyFromPayload && !needsRuntimeCollections
      ? {
          taskSnapshot: snapshotFromPayload,
          policy: policyFromPayload,
          decisionLogs: [],
          evidenceRefs: [],
        }
      : buildAgentRuntimeSnapshot(store, agent, {
          didMethod,
          lightweight: true,
          includeRehydratePreview: false,
          transcriptEntryLimit: DEFAULT_LIGHTWEIGHT_TRANSCRIPT_LIMIT,
        }));
  const snapshot = runtime.taskSnapshot;
  const policy = normalizeRuntimeDriftPolicy(runtime.policy || snapshot?.driftPolicy || {});
  const turnCount = Math.max(0, Math.floor(toFiniteNumber(payload.turnCount, 0)));
  const estimatedContextChars = Math.max(0, Math.floor(toFiniteNumber(payload.estimatedContextChars, 0)));
  const estimatedContextTokens = Math.max(0, Math.floor(toFiniteNumber(payload.estimatedContextTokens, 0)));
  const recentConversationTurnCount = Math.max(0, Math.floor(toFiniteNumber(payload.recentConversationTurnCount, 0)));
  const toolResultCount = Math.max(0, Math.floor(toFiniteNumber(payload.toolResultCount, 0)));
  const queryIteration = Math.max(1, Math.floor(toFiniteNumber(payload.queryIteration, 1)));
  const flags = [];
  let driftScore = 0;

  if (!snapshot) {
    flags.push({
      code: "missing_task_snapshot",
      severity: "warn",
      message: "当前没有 task snapshot，建议先做冷启动快照。",
    });
    driftScore += 2;
  }

  if (turnCount >= policy.maxConversationTurns) {
    flags.push({
      code: "turn_budget_exceeded",
      severity: "warn",
      message: `当前对话轮次 ${turnCount} 已超过建议阈值 ${policy.maxConversationTurns}。`,
    });
    driftScore += 2;
  }

  if (estimatedContextChars >= policy.maxContextChars) {
    flags.push({
      code: "context_budget_exceeded",
      severity: "warn",
      message: `当前上下文字符 ${estimatedContextChars} 已超过建议阈值 ${policy.maxContextChars}。`,
    });
    driftScore += 2;
  }

  if (estimatedContextTokens >= policy.maxContextTokens) {
    flags.push({
      code: "context_token_budget_exceeded",
      severity: "warn",
      message: `当前上下文 token 估算 ${estimatedContextTokens} 已超过建议阈值 ${policy.maxContextTokens}。`,
    });
    driftScore += 2;
  }

  if (recentConversationTurnCount > policy.maxRecentConversationTurns) {
    flags.push({
      code: "recent_turn_budget_exceeded",
      severity: "info",
      message: `最近对话条目 ${recentConversationTurnCount} 已超过窗口上限 ${policy.maxRecentConversationTurns}。`,
    });
    driftScore += 1;
  }

  if (toolResultCount > policy.maxToolResults) {
    flags.push({
      code: "tool_budget_exceeded",
      severity: "info",
      message: `工具结果条目 ${toolResultCount} 已超过窗口上限 ${policy.maxToolResults}。`,
    });
    driftScore += 1;
  }

  if (queryIteration > policy.maxQueryIterations) {
    flags.push({
      code: "query_iteration_budget_exceeded",
      severity: "warn",
      message: `当前 query iteration ${queryIteration} 已超过上限 ${policy.maxQueryIterations}。`,
    });
    driftScore += 2;
  }

  if (snapshot?.objective && currentGoal) {
    const similarity = compareTextSimilarity(snapshot.objective, currentGoal);
    if (similarity < 0.35) {
      flags.push({
        code: "goal_drift",
        severity: "warn",
        message: "当前目标与 task snapshot 的 objective 差异较大。",
        similarity,
      });
      driftScore += 2;
    }
  }

  if (snapshot?.nextAction && nextAction) {
    const similarity = compareTextSimilarity(snapshot.nextAction, nextAction);
    if (similarity < 0.25) {
      flags.push({
        code: "next_action_drift",
        severity: "info",
        message: "当前 nextAction 与最近 checkpoint 的 nextAction 偏差较大。",
        similarity,
      });
      driftScore += 1;
    }
  }

  const knownDecisionIds = new Set(runtime.decisionLogs.map((item) => item.decisionId));
  const unknownDecisionIds = referencedDecisionIds.filter((item) => !knownDecisionIds.has(item));
  if (unknownDecisionIds.length > 0) {
    flags.push({
      code: "unknown_decision_refs",
      severity: "warn",
      message: `存在未知 decision 引用：${unknownDecisionIds.join(", ")}`,
      decisionIds: unknownDecisionIds,
    });
    driftScore += 1;
  }

  const knownEvidenceIds = new Set(runtime.evidenceRefs.map((item) => item.evidenceRefId));
  const unknownEvidenceIds = referencedEvidenceRefIds.filter((item) => !knownEvidenceIds.has(item));
  if (unknownEvidenceIds.length > 0) {
    flags.push({
      code: "unknown_evidence_refs",
      severity: "warn",
      message: `存在未知 evidence 引用：${unknownEvidenceIds.join(", ")}`,
      evidenceRefIds: unknownEvidenceIds,
    });
    driftScore += 1;
  }

  const highRiskAction = normalizeComparableText(nextAction || workingSummary)
    ? policy.highRiskActionKeywords.find((keyword) =>
        normalizeComparableText(nextAction || workingSummary).includes(normalizeComparableText(keyword))
      ) ?? null
    : null;
  if (highRiskAction && referencedDecisionIds.length === 0 && referencedEvidenceRefIds.length === 0) {
    flags.push({
      code: "ungrounded_high_risk_action",
      severity: "warn",
      message: `检测到高风险动作关键词 ${highRiskAction}，但没有 decision / evidence grounding。`,
      keyword: highRiskAction,
    });
    driftScore += 2;
  }

  const requiresRehydrate =
    driftScore >= policy.driftScoreLimit ||
    turnCount >= policy.maxConversationTurns ||
    estimatedContextTokens >= policy.maxContextTokens ||
    estimatedContextChars >= policy.maxContextChars ||
    !snapshot;
  const requiresHumanReview =
    queryIteration > policy.maxQueryIterations ||
    Boolean(highRiskAction) && (requiresRehydrate || unknownDecisionIds.length > 0 || unknownEvidenceIds.length > 0);
  const recommendedActions = [];
  if (requiresRehydrate) {
    recommendedActions.push("reload_rehydrate_pack");
  }
  if (recentConversationTurnCount > policy.maxRecentConversationTurns || toolResultCount > policy.maxToolResults) {
    recommendedActions.push("checkpoint_and_resume");
  }
  if (requiresHumanReview) {
    recommendedActions.push("request_human_review");
  }
  if (!recommendedActions.length) {
    recommendedActions.push("continue_with_current_snapshot");
  }

  return {
    checkedAt: now(),
    agentId: agent.agentId,
    didMethod: normalizeDidMethod(didMethod) || didMethodFromReference(resolveAgentDidForMethod(store, agent, didMethod)) || null,
    taskSnapshotId: snapshot?.snapshotId ?? null,
    policy,
    input: {
      resumeFromCompactBoundaryId,
      currentGoal,
      workingSummary,
      nextAction,
      turnCount,
      estimatedContextChars,
      estimatedContextTokens,
      recentConversationTurnCount,
      toolResultCount,
      queryIteration,
      referencedDecisionIds,
      referencedEvidenceRefIds,
    },
    driftScore,
    flags,
    requiresRehydrate,
    requiresHumanReview,
    recommendedActions,
    rehydratePath: (() => {
      const search = new URLSearchParams();
      if (normalizeDidMethod(didMethod)) {
        search.set("didMethod", normalizeDidMethod(didMethod));
      }
      if (resumeFromCompactBoundaryId) {
        search.set("resumeFromCompactBoundaryId", resumeFromCompactBoundaryId);
      }
      const query = search.toString();
      return `/api/agents/${agent.agentId}/runtime/rehydrate${query ? `?${query}` : ""}`;
    })(),
  };
}

export async function getAgentRuntime(
  agentId,
  {
    didMethod = null,
    runtimeLimit = DEFAULT_RUNTIME_LIMIT,
    memoryLimit = DEFAULT_RUNTIME_REHYDRATE_MEMORY_LIMIT,
    messageLimit = DEFAULT_RUNTIME_REHYDRATE_MESSAGE_LIMIT,
    authorizationLimit = DEFAULT_RUNTIME_REHYDRATE_AUTHORIZATION_LIMIT,
    credentialLimit = DEFAULT_RUNTIME_REHYDRATE_CREDENTIAL_LIMIT,
    lightweight = true,
  } = {}
) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const cacheKey = hashJson({
    kind: "runtime_snapshot",
    fingerprint: buildStorePerformanceFingerprint(store, agent.agentId),
    agentId: agent.agentId,
    didMethod: normalizeDidMethod(didMethod) || null,
    runtimeLimit,
    memoryLimit,
    messageLimit,
    authorizationLimit,
    credentialLimit,
    lightweight,
  });
  const cachedRuntime = getCachedRuntimeSnapshot(cacheKey);
  if (cachedRuntime) {
    return cachedRuntime;
  }
  const runtime = buildAgentRuntimeSnapshot(store, agent, {
    didMethod,
    runtimeLimit,
    memoryLimit,
    messageLimit,
    authorizationLimit,
    credentialLimit,
    lightweight,
    includeRehydratePreview: !lightweight,
    transcriptEntryLimit: lightweight
      ? Math.max(DEFAULT_LIGHTWEIGHT_TRANSCRIPT_LIMIT, runtimeLimit)
      : null,
  });
  setCachedRuntimeSnapshot(cacheKey, runtime);
  return runtime;
}

export async function getAgentRuntimeSummary(
  agentId,
  {
    didMethod = null,
    profile = "default",
  } = {}
) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const cacheKey = hashJson({
    kind: "runtime_summary",
    fingerprint: buildStorePerformanceFingerprint(store, agent.agentId),
    agentId: agent.agentId,
    didMethod: normalizeDidMethod(didMethod) || null,
    profile: normalizeOptionalText(profile) || "default",
  });
  const cachedSummary = getCachedTimedSnapshot(
    RUNTIME_SUMMARY_CACHE,
    cacheKey,
    DEFAULT_RUNTIME_SUMMARY_CACHE_TTL_MS
  );
  if (cachedSummary) {
    return cachedSummary;
  }
  const normalizedProfile = normalizeOptionalText(profile) || "default";
  const runtime = await getAgentRuntime(agentId, {
    didMethod,
    lightweight: true,
  });
  const archives = ensureArchiveStoreState(store);
  const transcriptArchiveMeta = archives.transcript?.[agent.agentId] ?? null;
  const passportMemoryArchiveMeta = archives.passportMemory?.[agent.agentId] ?? null;
  const passportMemories = listAgentPassportMemories(store, agent.agentId);
  const activePassportMemoryCount = passportMemories.filter((entry) => isPassportMemoryActive(entry)).length;
  const totalPassportMemoryCount = passportMemories.length;
  const runGovernance = buildAgentRunGovernanceSummary(listAgentRunsFromStore(store, agent.agentId));
  const hybridRuntime = buildHybridRuntimeSummary(runtime, runGovernance);
  const effectiveCognitiveState = resolveEffectiveAgentCognitiveState(store, agent, { didMethod }, buildCognitiveStateDeps());
  const cognitionSummary = buildRuntimeCognitionSummary(effectiveCognitiveState);
  const runtimeMemoryStates = listRuntimeMemoryStatesFromStore(
    store,
    agent.agentId,
    RUNTIME_MEMORY_STORE_ADAPTER
  );
  const latestRuntimeMemoryState = runtimeMemoryStates.at(-1) ?? null;
  const runtimeMemoryStateCount = runtimeMemoryStates.length;
  const runtimeModelProfile = resolveRuntimeMemoryHomeostasisProfile(store, {
    modelName:
      latestRuntimeMemoryState?.modelName ??
      resolveActiveMemoryHomeostasisModelName(store, {
        localReasoner: runtime.deviceRuntime?.localReasoner,
      }),
    runtimePolicy: runtime.policy,
  });
  const runtimeObservationSummary = buildAgentRuntimeMemoryObservationCollectionSummary(store, agent.agentId, {
    modelName:
      latestRuntimeMemoryState?.modelName ??
      runtimeModelProfile?.modelName ??
      resolveActiveMemoryHomeostasisModelName(store, {
        localReasoner: runtime.deviceRuntime?.localReasoner,
      }),
    limit: 16,
    recentLimit: 8,
  });

  if (normalizedProfile === "bridge") {
    const response = buildBridgeRuntimeSummary({
      generatedAt: now(),
      agent: {
        agentId: agent.agentId,
        displayName: agent.displayName,
        role: agent.role,
      },
      task: runtime.taskSnapshot
        ? {
            snapshotId: runtime.taskSnapshot.snapshotId ?? null,
            title: runtime.taskSnapshot.title ?? null,
            objective: runtime.taskSnapshot.objective ?? null,
            status: runtime.taskSnapshot.status ?? null,
            nextAction: runtime.taskSnapshot.nextAction ?? null,
          }
        : null,
      residentGate: runtime.residentGate ?? null,
      hybridRuntime,
      cognition: cognitionSummary,
      governance: runGovernance,
      memory: {
        totalPassportMemories: totalPassportMemoryCount,
        activePassportMemories: activePassportMemoryCount,
        archivedPassportMemories: Math.max(0, totalPassportMemoryCount - activePassportMemoryCount),
        physicalArchive: {
          passportMemoryCount: Number(passportMemoryArchiveMeta?.count || 0),
          latestArchivedAt: passportMemoryArchiveMeta?.latestArchivedAt ?? null,
        },
      },
      transcript: {
        entryCount: runtime.transcript?.entryCount ?? 0,
        latestTranscriptEntryId: runtime.transcript?.latestTranscriptEntryId ?? null,
        physicalArchive: {
          transcriptCount: Number(transcriptArchiveMeta?.count || 0),
          latestArchivedAt: transcriptArchiveMeta?.latestArchivedAt ?? null,
        },
      },
      runner: {
        totalRuns: runGovernance.totalRuns,
        fallbackRuns: runGovernance.fallbackRuns,
        qualityEscalationRuns: runGovernance.qualityEscalationRuns,
        degradedRuns: runGovernance.degradedRuns,
        localProviderRuns: runGovernance.localProviderRuns,
        onlineProviderRuns: runGovernance.onlineProviderRuns,
        latest: runGovernance.recentRuns?.[0] ?? null,
      },
      memoryHomeostasis: latestRuntimeMemoryState
        ? {
            modelProfile: buildModelProfileView(runtimeModelProfile),
            latestState: buildRuntimeMemoryStateView(latestRuntimeMemoryState),
            stateCount: runtimeMemoryStateCount,
            observationSummary: runtimeObservationSummary,
          }
        : {
            modelProfile: buildModelProfileView(runtimeModelProfile),
            latestState: null,
            stateCount: 0,
            observationSummary: runtimeObservationSummary,
          },
    });
    setCachedTimedSnapshot(RUNTIME_SUMMARY_CACHE, cacheKey, response);
    return response;
  }
  const memoryLayers = buildAgentMemoryLayerView(store, agent, {
    query: runtime.taskSnapshot?.objective ?? runtime.taskSnapshot?.title ?? null,
    lightweight: true,
  });

  const summary = {
    generatedAt: now(),
    performanceMode: "summary",
    agent: {
      agentId: agent.agentId,
      displayName: agent.displayName,
      role: agent.role,
    },
    task: runtime.taskSnapshot
      ? {
          snapshotId: runtime.taskSnapshot.snapshotId ?? null,
          title: runtime.taskSnapshot.title ?? null,
          objective: runtime.taskSnapshot.objective ?? null,
          status: runtime.taskSnapshot.status ?? null,
          nextAction: runtime.taskSnapshot.nextAction ?? null,
        }
      : null,
    residentGate: runtime.residentGate ?? null,
    capabilityBoundary: runtime.capabilityBoundary ?? null,
    hybridRuntime,
    governance: runGovernance,
    cognition: cognitionSummary,
    memory: {
      performanceMode: memoryLayers.performanceMode,
      hotCounts: cloneJson(memoryLayers.counts) ?? {},
      coldCounts: cloneJson(memoryLayers.coldCounts) ?? {},
      totalPassportMemories: totalPassportMemoryCount,
      activePassportMemories: activePassportMemoryCount,
      archivedPassportMemories: Math.max(0, totalPassportMemoryCount - activePassportMemoryCount),
      physicalArchive: {
        passportMemoryCount: Number(passportMemoryArchiveMeta?.count || 0),
        latestArchivedAt: passportMemoryArchiveMeta?.latestArchivedAt ?? null,
      },
    },
    transcript: {
      entryCount: runtime.transcript?.entryCount ?? 0,
      latestTranscriptEntryId: runtime.transcript?.latestTranscriptEntryId ?? null,
      physicalArchive: {
        transcriptCount: Number(transcriptArchiveMeta?.count || 0),
        latestArchivedAt: transcriptArchiveMeta?.latestArchivedAt ?? null,
      },
    },
    compactBoundaries: {
      count: (store.compactBoundaries || []).filter((entry) => entry.agentId === agent.agentId).length,
      latestCompactBoundaryId:
        listAgentCompactBoundariesFromStore(store, agent.agentId).at(-1)?.compactBoundaryId ?? null,
    },
    runner: {
      totalRuns: runGovernance.totalRuns,
      fallbackRuns: runGovernance.fallbackRuns,
      qualityEscalationRuns: runGovernance.qualityEscalationRuns,
      degradedRuns: runGovernance.degradedRuns,
      localProviderRuns: runGovernance.localProviderRuns,
      onlineProviderRuns: runGovernance.onlineProviderRuns,
      statusCounts: cloneJson(runGovernance.statusCounts) ?? {},
      providerCounts: cloneJson(runGovernance.providerCounts) ?? {},
      latest: runGovernance.recentRuns?.[0] ?? null,
    },
    memoryHomeostasis: {
      modelProfile: buildModelProfileView(runtimeModelProfile),
      latestState: latestRuntimeMemoryState ? buildRuntimeMemoryStateView(latestRuntimeMemoryState) : null,
      stateCount: runtimeMemoryStateCount,
      observationSummary: runtimeObservationSummary,
    },
  };
  setCachedTimedSnapshot(RUNTIME_SUMMARY_CACHE, cacheKey, summary);
  return summary;
}

export async function recordTaskSnapshot(agentId, payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const previousSnapshot = latestAgentTaskSnapshot(store, agent.agentId);
    const snapshot = normalizeTaskSnapshotRecord(agent.agentId, payload, previousSnapshot, {
      normalizeRuntimeDriftPolicy,
    });
    if (!snapshot.title && !snapshot.objective) {
      throw new Error("title or objective is required");
    }

    store.taskSnapshots.push(snapshot);
    appendEvent(store, "task_snapshot_recorded", {
      snapshotId: snapshot.snapshotId,
      agentId: agent.agentId,
      status: snapshot.status,
      revision: snapshot.revision,
      sourceWindowId: snapshot.sourceWindowId,
    });
    await writeStore(store);
    return snapshot;
  });
}

export async function recordDecisionLog(agentId, payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const decision = normalizeDecisionLogRecord(agent.agentId, payload);
    if (!decision.summary) {
      throw new Error("summary is required");
    }

    if (Array.isArray(payload.supersededDecisionIds)) {
      const superseded = new Set(normalizeTextList(payload.supersededDecisionIds));
      for (const item of store.decisionLogs || []) {
        if (matchesCompatibleAgentId(store, item.agentId, agent.agentId) && superseded.has(item.decisionId)) {
          item.status = "superseded";
        }
      }
    }

    store.decisionLogs.push(decision);
    appendEvent(store, "decision_logged", {
      decisionId: decision.decisionId,
      agentId: agent.agentId,
      scope: decision.scope,
      status: decision.status,
      sourceWindowId: decision.sourceWindowId,
    });
    await writeStore(store);
    return decision;
  });
}

export async function listConversationMinutes(agentId, { limit = DEFAULT_CONVERSATION_MINUTE_LIMIT } = {}) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const cappedLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_CONVERSATION_MINUTE_LIMIT;
  const minutes = listAgentConversationMinutes(store, agent.agentId);
  return {
    minutes: minutes.slice(-cappedLimit),
    counts: {
      total: minutes.length,
    },
  };
}

export async function listAgentTranscript(agentId, { family = null, limit = DEFAULT_TRANSCRIPT_LIMIT } = {}) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const entries = listAgentTranscriptEntries(store, agent.agentId, { family, limit });
  return {
    transcript: buildTranscriptModelSnapshot(store, agent, { limit }, TRANSCRIPT_MODEL_DEPS),
    entries,
    counts: {
      total: (store.transcriptEntries || []).filter((entry) => matchesCompatibleAgentId(store, entry.agentId, agent.agentId)).length,
      filtered: entries.length,
    },
  };
}

export async function listAgentArchivedRecords(
  agentId,
  {
    kind = "transcript",
    limit = 20,
    offset = 0,
    query = null,
    archivedFrom = null,
    archivedTo = null,
  } = {}
) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const resolvedAgentId = agent.agentId;
  const cacheKey = hashJson({
    kind: "archived_records",
    fingerprint: buildStorePerformanceFingerprint(store, resolvedAgentId),
    agentId: resolvedAgentId,
    archiveKind: kind,
    limit,
    offset,
    query: normalizeOptionalText(query) ?? null,
    archivedFrom: normalizeOptionalText(archivedFrom) ?? null,
    archivedTo: normalizeOptionalText(archivedTo) ?? null,
  });
  const cachedArchivedRecords = getCachedTimedSnapshot(
    ARCHIVED_RECORDS_CACHE,
    cacheKey,
    DEFAULT_ARCHIVE_QUERY_CACHE_TTL_MS
  );
  if (cachedArchivedRecords) {
    return cachedArchivedRecords;
  }
  const archives = ensureArchiveStoreState(store);
  const normalizedKind = normalizeOptionalText(kind)?.toLowerCase();
  const archiveKind = normalizedKind === "passport-memory" || normalizedKind === "passport_memory"
    ? "passport-memory"
    : "transcript";
  const archiveBucket = archiveKind === "transcript" ? archives.transcript : archives.passportMemory;
  const archiveMeta = archiveBucket?.[resolvedAgentId] ?? {
    count: 0,
    latestArchivedAt: null,
    filePath: buildAgentArchiveFilePath(resolvedAgentId, archiveKind),
  };
  const records = await readArchiveJsonl(archiveMeta.filePath || buildAgentArchiveFilePath(resolvedAgentId, archiveKind));
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 20;
  const cappedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0;
  const normalizedQuery = normalizeComparableText(query);
  const normalizedArchivedFrom = normalizeOptionalText(archivedFrom) ?? null;
  const normalizedArchivedTo = normalizeOptionalText(archivedTo) ?? null;
  const filtered = records
    .filter((entry) => matchesCompatibleAgentId(store, entry.agentId, resolvedAgentId))
    .filter((entry) => entry.kind === (archiveKind === "transcript" ? "transcript" : "passport_memory"))
    .filter((entry) => {
      if (!normalizedQuery) {
        return true;
      }
      const record = entry?.record || {};
      const haystack = normalizeComparableText([
        record.passportMemoryId,
        record.transcriptEntryId,
        record.title,
        record.summary,
        record.content,
        record.layer,
        record.kind,
        record.entryType,
        record.family,
      ].filter(Boolean).join(" "));
      return haystack.includes(normalizedQuery);
    })
    .filter((entry) => {
      const archivedAt = normalizeOptionalText(entry?.archivedAt) ?? null;
      if (!archivedAt) {
        return !normalizedArchivedFrom && !normalizedArchivedTo;
      }
      if (normalizedArchivedFrom && archivedAt < normalizedArchivedFrom) {
        return false;
      }
      if (normalizedArchivedTo && archivedAt > normalizedArchivedTo) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (b.archivedAt || "").localeCompare(a.archivedAt || ""));
  const sliced = filtered.slice(cappedOffset, cappedOffset + cappedLimit);
  const canonicalizedRecords = sliced.map((entry) => {
    const canonicalized = canonicalizeArchiveIdentityView(store, resolvedAgentId, entry);
    return {
      ...canonicalized.value,
      archiveIdentityCompatibility: canonicalized.compatibility,
    };
  });
  const rawArchiveCompatibilityResidueDetected = canonicalizedRecords.some(
    (entry) => entry?.archiveIdentityCompatibility?.rawCompatibilityResidueDetected === true
  );

  const result = {
    kind: archiveKind,
    query: normalizeOptionalText(query) ?? null,
    archivedFrom: normalizedArchivedFrom,
    archivedTo: normalizedArchivedTo,
    archiveIdentityViewMode: rawArchiveCompatibilityResidueDetected
      ? "canonical_read_view_raw_archive_preserved_on_disk"
      : "canonical_read_view_no_compat_rewrite_needed",
    rawArchiveCompatibilityResidueDetected,
    archive: {
      count: Number(archiveMeta.count || 0),
      latestArchivedAt: archiveMeta.latestArchivedAt ?? null,
      filePath: archiveMeta.filePath ?? buildAgentArchiveFilePath(resolvedAgentId, archiveKind),
    },
    records: canonicalizedRecords,
    counts: {
      total: filtered.length,
      filtered: canonicalizedRecords.length,
      offset: cappedOffset,
      limit: cappedLimit,
    },
  };
  setCachedTimedSnapshot(ARCHIVED_RECORDS_CACHE, cacheKey, result, DEFAULT_REHYDRATE_CACHE_MAX_ENTRIES * 2);
  return result;
}

export async function listAgentArchiveRestoreEvents(
  agentId,
  {
    limit = 20,
    kind = null,
    restoredFrom = null,
    restoredTo = null,
  } = {}
) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const resolvedAgentId = agent.agentId;
  const cacheKey = hashJson({
    kind: "archive_restore_events",
    fingerprint: buildStorePerformanceFingerprint(store, resolvedAgentId),
    agentId: resolvedAgentId,
    limit,
    restoreKind: normalizeOptionalText(kind)?.toLowerCase() ?? null,
    restoredFrom: normalizeOptionalText(restoredFrom) ?? null,
    restoredTo: normalizeOptionalText(restoredTo) ?? null,
  });
  const cachedRestoreEvents = getCachedTimedSnapshot(
    ARCHIVE_RESTORE_EVENTS_CACHE,
    cacheKey,
    DEFAULT_ARCHIVE_QUERY_CACHE_TTL_MS
  );
  if (cachedRestoreEvents) {
    return cachedRestoreEvents;
  }
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 20;
  const normalizedKind = normalizeOptionalText(kind)?.toLowerCase() ?? null;
  const normalizedRestoredFrom = normalizeOptionalText(restoredFrom) ?? null;
  const normalizedRestoredTo = normalizeOptionalText(restoredTo) ?? null;
  const events = (store.events || [])
    .filter((event) => event?.type === "archived_record_restored")
    .filter((event) => matchesCompatibleAgentId(store, event?.payload?.agentId, resolvedAgentId))
    .filter((event) => {
      if (!normalizedKind || normalizedKind === "all") {
        return true;
      }
      return normalizeOptionalText(event?.payload?.archiveKind)?.toLowerCase() === normalizedKind;
    })
    .filter((event) => {
      const timestamp = normalizeOptionalText(event?.timestamp) ?? null;
      if (!timestamp) {
        return !normalizedRestoredFrom && !normalizedRestoredTo;
      }
      if (normalizedRestoredFrom && timestamp < normalizedRestoredFrom) {
        return false;
      }
      if (normalizedRestoredTo && timestamp > normalizedRestoredTo) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
    .slice(0, cappedLimit)
    .map((event) => cloneJson(event));

  const result = {
    events,
    latest: events[0] || null,
    kind: normalizedKind || "all",
    restoredFrom: normalizedRestoredFrom,
    restoredTo: normalizedRestoredTo,
    counts: {
      total: events.length,
      limit: cappedLimit,
    },
  };
  setCachedTimedSnapshot(
    ARCHIVE_RESTORE_EVENTS_CACHE,
    cacheKey,
    result,
    DEFAULT_REHYDRATE_CACHE_MAX_ENTRIES * 2
  );
  return result;
}

export async function revertAgentArchiveRestore(
  agentId,
  {
    restoredRecordId = null,
    restoreEventHash = null,
    archiveKind = null,
    revertedByAgentId = null,
    revertedByWindowId = null,
    sourceWindowId = null,
  } = {}
) {
  return queueStoreMutation(async () => {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const resolvedAgentId = agent.agentId;
  const archives = ensureArchiveStoreState(store);
  const targetEvent = (store.events || [])
    .filter((event) => event?.type === "archived_record_restored")
    .filter((event) => matchesCompatibleAgentId(store, event?.payload?.agentId, resolvedAgentId))
    .find((event) => {
      if (restoreEventHash && event.hash === restoreEventHash) {
        return true;
      }
      if (restoredRecordId && event?.payload?.restoredRecordId === restoredRecordId) {
        return true;
      }
      return false;
    });

  if (!targetEvent?.payload) {
    throw new Error(`Restore event not found for ${resolvedAgentId}`);
  }
  const alreadyReverted = (store.events || []).some(
    (event) =>
      event?.type === "archived_restore_reverted" &&
      matchesCompatibleAgentId(store, event?.payload?.agentId, resolvedAgentId) &&
      event?.payload?.restoreEventHash === targetEvent.hash
  );
  if (alreadyReverted) {
    throw new Error(`Restore event already reverted: ${targetEvent.hash}`);
  }

  const resolvedKind = normalizeOptionalText(archiveKind || targetEvent.payload.archiveKind)?.toLowerCase() === "transcript"
    ? "transcript"
    : "passport-memory";
  const archiveBucket = resolvedKind === "transcript" ? archives.transcript : archives.passportMemory;
  const archiveFilePath =
    archiveBucket?.[resolvedAgentId]?.filePath ||
    buildAgentArchiveFilePath(resolvedAgentId, resolvedKind);
  const revertedAt = now();
  let revertedRecord = null;

  if (resolvedKind === "transcript") {
    const index = (store.transcriptEntries || []).findIndex(
      (entry) =>
        matchesCompatibleAgentId(store, entry?.agentId, resolvedAgentId) &&
        entry?.transcriptEntryId === targetEvent.payload.restoredRecordId
    );
    if (index < 0) {
      throw new Error(`Restored transcript not found: ${targetEvent.payload.restoredRecordId}`);
    }
    const [entry] = store.transcriptEntries.splice(index, 1);
    revertedRecord = entry;
    await appendArchiveJsonl(archiveFilePath, [{
      kind: "transcript",
      agentId: resolvedAgentId,
      archivedAt: revertedAt,
      record: cloneJson(entry),
      revertedFromRestore: true,
      restoreEventHash: targetEvent.hash,
    }]);
  } else {
    const entry = (store.passportMemories || []).find(
      (memory) =>
        matchesCompatibleAgentId(store, memory?.agentId, resolvedAgentId) &&
        memory?.passportMemoryId === targetEvent.payload.restoredRecordId
    );
    if (!entry) {
      throw new Error(`Restored passport memory not found: ${targetEvent.payload.restoredRecordId}`);
    }
    if (entry.status === "reverted") {
      throw new Error(`Restored passport memory already reverted: ${targetEvent.payload.restoredRecordId}`);
    }
    entry.status = "reverted";
    entry.memoryDynamics = {
      ...(cloneJson(entry.memoryDynamics) || {}),
      forgottenAt: revertedAt,
      lastReactivatedAt: entry?.memoryDynamics?.lastReactivatedAt || null,
    };
    revertedRecord = cloneJson(entry);
    await appendArchiveJsonl(archiveFilePath, [{
      kind: "passport_memory",
      agentId: resolvedAgentId,
      archivedAt: revertedAt,
      record: revertedRecord,
      revertedFromRestore: true,
      restoreEventHash: targetEvent.hash,
    }]);
  }

  const currentCount = Number(archiveBucket?.[resolvedAgentId]?.count || 0);
  archiveBucket[resolvedAgentId] = {
    count: currentCount + 1,
    latestArchivedAt: revertedAt,
    filePath: archiveFilePath,
  };

  appendEvent(store, "archived_restore_reverted", {
    agentId: resolvedAgentId,
    archiveKind: resolvedKind,
    revertedAt,
    restoredRecordId: targetEvent.payload.restoredRecordId || null,
    restoreEventHash: targetEvent.hash,
    revertedByAgentId: resolvedAgentId,
    revertedByWindowId: normalizeOptionalText(revertedByWindowId) ?? null,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? normalizeOptionalText(revertedByWindowId) ?? null,
  });

  await writeStore(store);

  return {
    ok: true,
    archiveKind: resolvedKind,
    revertedAt,
    revertedRecord,
    restoreEvent: cloneJson(targetEvent),
    archive: archiveBucket[resolvedAgentId],
  };
  });
}

export async function restoreAgentArchivedRecord(
  agentId,
  {
    kind = "passport-memory",
    archiveIndex = null,
    passportMemoryId = null,
    transcriptEntryId = null,
    restoredByAgentId = null,
    restoredByWindowId = null,
    sourceWindowId = null,
  } = {}
) {
  return queueStoreMutation(async () => {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const resolvedAgentId = agent.agentId;
  const archives = ensureArchiveStoreState(store);
  const normalizedKind = normalizeOptionalText(kind)?.toLowerCase();
  const archiveKind = normalizedKind === "transcript" ? "transcript" : "passport-memory";
  const archiveBucket = archiveKind === "transcript" ? archives.transcript : archives.passportMemory;
  const archiveMeta = archiveBucket?.[resolvedAgentId] ?? {
    count: 0,
    latestArchivedAt: null,
    filePath: buildAgentArchiveFilePath(resolvedAgentId, archiveKind),
  };
  const archiveFilePath = archiveMeta.filePath || buildAgentArchiveFilePath(resolvedAgentId, archiveKind);
  const records = await readArchiveJsonl(archiveFilePath);
  const filtered = records
    .filter((entry) => matchesCompatibleAgentId(store, entry.agentId, resolvedAgentId))
    .filter((entry) => entry.kind === (archiveKind === "transcript" ? "transcript" : "passport_memory"))
    .sort((a, b) => (b.archivedAt || "").localeCompare(a.archivedAt || ""));

  let selected = null;
  if (Number.isFinite(Number(archiveIndex)) && Number(archiveIndex) >= 0) {
    selected = filtered[Math.floor(Number(archiveIndex))] ?? null;
  } else if (archiveKind === "transcript" && transcriptEntryId) {
    selected = filtered.find((entry) => entry?.record?.transcriptEntryId === transcriptEntryId) ?? null;
  } else if (archiveKind === "passport-memory" && passportMemoryId) {
    selected = filtered.find((entry) => entry?.record?.passportMemoryId === passportMemoryId) ?? null;
  }

  if (!selected?.record) {
    throw new Error(`Archived ${archiveKind} record not found for ${resolvedAgentId}`);
  }

  const restoredAt = now();
  let restoredRecord = null;

  if (archiveKind === "transcript") {
    const original = selected.record;
    const restoredEntry = normalizeTranscriptEntryRecord(resolvedAgentId, {
      ...cloneJson(original),
      transcriptEntryId: null,
      recordedAt: restoredAt,
      title: original.title || original.summary || "已从归档恢复的对话记录",
      metadata: {
        ...(cloneJson(original.metadata) || {}),
        restoredFromArchive: true,
        archivedAt: selected.archivedAt || null,
        originalTranscriptEntryId: original.transcriptEntryId || null,
        originalRecordedAt: original.recordedAt || null,
      },
      sourceWindowId: sourceWindowId || restoredByWindowId || original.sourceWindowId || null,
    });
    appendTranscriptEntries(store, resolvedAgentId, [restoredEntry]);
    restoredRecord = restoredEntry;
  } else {
    const original = selected.record;
    const restoredMemory = normalizePassportMemoryRecord(resolvedAgentId, {
      ...cloneJson(original),
      passportMemoryId: null,
      status: "active",
      recordedAt: restoredAt,
      sourceWindowId: sourceWindowId || restoredByWindowId || original.sourceWindowId || null,
      recordedByAgentId: resolvedAgentId,
      recordedByWindowId: restoredByWindowId || original.recordedByWindowId || null,
      payload: {
        ...(cloneJson(original.payload) || {}),
        restoredFromArchive: true,
        archivedAt: selected.archivedAt || null,
        originalPassportMemoryId: original.passportMemoryId || null,
        originalRecordedAt: original.recordedAt || null,
      },
      memoryDynamics: {
        ...(cloneJson(original.memoryDynamics) || {}),
        reactivationCount: Math.max(0, Math.floor(toFiniteNumber(original?.memoryDynamics?.reactivationCount, 0))) + 1,
        lastReactivatedAt: restoredAt,
        forgottenAt: null,
        strengthScore: Number(
          Math.max(
            0.35,
            Math.min(1, toFiniteNumber(original?.memoryDynamics?.strengthScore, 0.5))
          ).toFixed(2)
        ),
      },
    });
    store.passportMemories.push(restoredMemory);
    restoredRecord = restoredMemory;
  }

  const remaining = records.filter((entry) => {
    if (entry !== selected) {
      return true;
    }
    return false;
  });
  await rewriteArchiveJsonl(archiveFilePath, remaining);

  const remainingForAgent = remaining
    .filter((entry) => matchesCompatibleAgentId(store, entry.agentId, resolvedAgentId))
    .filter((entry) => entry.kind === (archiveKind === "transcript" ? "transcript" : "passport_memory"))
    .sort((a, b) => (b.archivedAt || "").localeCompare(a.archivedAt || ""));

  archiveBucket[resolvedAgentId] = {
    count: remainingForAgent.length,
    latestArchivedAt: remainingForAgent[0]?.archivedAt ?? null,
    filePath: archiveFilePath,
  };

  appendEvent(store, "archived_record_restored", {
    agentId: resolvedAgentId,
    archiveKind,
    restoredAt,
    archivedAt: selected.archivedAt || null,
    restoredRecordId:
      restoredRecord?.passportMemoryId ||
      restoredRecord?.transcriptEntryId ||
      null,
    originalRecordId:
      selected.record?.passportMemoryId ||
      selected.record?.transcriptEntryId ||
      null,
    restoredByAgentId: resolvedAgentId,
    restoredByWindowId: normalizeOptionalText(restoredByWindowId) ?? null,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? normalizeOptionalText(restoredByWindowId) ?? null,
  });

  await writeStore(store);

  const canonicalizedOriginalRecord = canonicalizeArchiveIdentityView(store, resolvedAgentId, selected.record);

  return {
    ok: true,
    kind: archiveKind,
    restoredAt,
    archive: archiveBucket[resolvedAgentId],
    restoredRecord,
    archiveIdentityViewMode: canonicalizedOriginalRecord.compatibility.viewMode,
    originalRecord: canonicalizedOriginalRecord.value,
    originalRecordIdentityCompatibility: canonicalizedOriginalRecord.compatibility,
  };
  });
}

function recordConversationMinuteInStore(store, agentId, payload = {}) {
  const agent = ensureAgent(store, agentId);
  const minute = normalizeConversationMinuteRecord(agent.agentId, payload);
  if (!minute.title && !minute.summary && !minute.transcript) {
    throw new Error("title, summary or transcript is required");
  }

  if (!Array.isArray(store.conversationMinutes)) {
    store.conversationMinutes = [];
  }
  store.conversationMinutes.push(minute);
  appendEvent(store, "conversation_minute_recorded", {
    minuteId: minute.minuteId,
    agentId: agent.agentId,
    sourceWindowId: minute.sourceWindowId,
    linkedTaskSnapshotId: minute.linkedTaskSnapshotId,
  });
  return minute;
}

export async function recordConversationMinute(agentId, payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const minute = recordConversationMinuteInStore(store, agentId, payload);
    await writeStore(store);
    return minute;
  });
}

export async function recordEvidenceRef(agentId, payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const evidenceRef = normalizeEvidenceRefRecord(agent.agentId, payload);
    if (!evidenceRef.title && !evidenceRef.uri && !evidenceRef.summary) {
      throw new Error("title, uri or summary is required");
    }

    store.evidenceRefs.push(evidenceRef);
    appendEvent(store, "evidence_ref_recorded", {
      evidenceRefId: evidenceRef.evidenceRefId,
      agentId: agent.agentId,
      kind: evidenceRef.kind,
      sourceWindowId: evidenceRef.sourceWindowId,
    });
    await writeStore(store);
    return evidenceRef;
  });
}

export async function listEvidenceRefs(
  agentId,
  {
    kind = null,
    tag = null,
    limit = DEFAULT_RUNTIME_LIMIT,
  } = {}
) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const cappedLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_RUNTIME_LIMIT;
  const normalizedKind = normalizeOptionalText(kind)?.toLowerCase() ?? null;
  const normalizedTag = normalizeOptionalText(tag)?.toLowerCase() ?? null;
  const records = listAgentEvidenceRefs(store, agent.agentId).filter((entry) => {
    if (normalizedKind && normalizeOptionalText(entry?.kind)?.toLowerCase() !== normalizedKind) {
      return false;
    }
    if (
      normalizedTag &&
      !normalizeTextList(entry?.tags).some((candidate) => normalizeOptionalText(candidate)?.toLowerCase() === normalizedTag)
    ) {
      return false;
    }
    return true;
  });
  return {
    evidenceRefs: records.slice(-cappedLimit),
    counts: {
      total: records.length,
      filtered: records.length,
    },
  };
}

function buildSelfLearningAdmissionEvidenceRefs(proposal, evidenceRefs = []) {
  const targetEvidenceIds = new Set(
    normalizeTextList(proposal?.evidenceIds).filter(Boolean)
  );
  return (Array.isArray(evidenceRefs) ? evidenceRefs : [])
    .filter((entry) => targetEvidenceIds.has(entry?.evidenceRefId))
    .map((entry) => ({
      evidenceId: entry.evidenceRefId,
      agentId: proposal.agentId,
      canonicalAgentId: proposal.agentId,
      namespaceScopeId: proposal.namespaceScopeId,
      passportNamespaceId: proposal.namespaceScopeId,
      linkedProposalId: normalizeOptionalText(entry.linkedProposalId) ?? null,
      linkedWindowId: normalizeOptionalText(entry.linkedWindowId) ?? null,
      sourceWindowId: normalizeOptionalText(entry.sourceWindowId) ?? null,
    }));
}

function buildSelfLearningAdmissionActiveRecords(store, agentId) {
  return listAgentPassportMemories(store, agentId)
    .filter((entry) => isPassportMemoryActive(entry))
    .map((entry) => {
      const namespaceScopeId =
        normalizeOptionalText(entry?.payload?.namespaceScopeId) ??
        normalizeOptionalText(entry?.payload?.passportNamespaceId) ??
        null;
      return {
        recordId: normalizeOptionalText(entry?.passportMemoryId) ?? null,
        agentId,
        canonicalAgentId: agentId,
        namespaceScopeId,
        passportNamespaceId: namespaceScopeId,
        status: normalizeOptionalText(entry?.status) ?? null,
        contentSha256:
          normalizeOptionalText(entry?.payload?.contentSha256) ??
          normalizeOptionalText(entry?.payload?.value?.contentSha256) ??
          null,
        sourceProposalId: normalizeOptionalText(entry?.payload?.proposalId) ?? null,
      };
    })
    .filter((entry) => entry.recordId && entry.status);
}

function buildSelfLearningAdmissionProtectedRecordIds(store, agentId) {
  const protectedRecordIds = new Set();
  for (const boundary of store.compactBoundaries || []) {
    if (!matchesCompatibleAgentId(store, boundary?.agentId, agentId)) {
      continue;
    }
    for (const recordId of boundary?.archivedMemoryIds || []) {
      if (recordId) {
        protectedRecordIds.add(recordId);
      }
    }
    if (boundary?.checkpointMemoryId) {
      protectedRecordIds.add(boundary.checkpointMemoryId);
    }
  }
  for (const entry of store.passportMemories || []) {
    if (!matchesCompatibleAgentId(store, entry?.agentId, agentId) || !isPassportMemoryActive(entry)) {
      continue;
    }
    for (const recordId of entry?.payload?.sourcePassportMemoryIds || []) {
      if (recordId) {
        protectedRecordIds.add(recordId);
      }
    }
    if (entry?.payload?.sourcePassportMemoryId) {
      protectedRecordIds.add(entry.payload.sourcePassportMemoryId);
    }
  }
  return Array.from(protectedRecordIds);
}

function buildSelfLearningAdmissionContext(store, proposal, evidenceRefs = []) {
  return {
    evidenceRefs: buildSelfLearningAdmissionEvidenceRefs(proposal, evidenceRefs),
    activeRecords: buildSelfLearningAdmissionActiveRecords(store, proposal.agentId),
    protectedRecordIds: buildSelfLearningAdmissionProtectedRecordIds(store, proposal.agentId),
  };
}

export async function runAgentSelfLearningBridge(
  agentId,
  payload = {},
  {
    operation = "apply",
  } = {}
) {
  const {
    executeSelfLearningBridge,
    MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS,
  } = await import("./memory-stability/self-learning-bridge.js");
  const {
    validateLearningProposalEnvelope,
  } = await import("./memory-stability/self-learning-governance.js");

  const proposalEnvelope =
    payload?.proposalEnvelope ??
    payload?.learningProposalEnvelope ??
    payload?.envelope ??
    payload;
  const routeProposalId =
    normalizeOptionalText(payload?.routeProposalId) ??
    normalizeOptionalText(payload?.proposalId) ??
    null;
  const requestedOperation = normalizeOptionalText(operation) ?? "apply";
  if (
    !Object.values(MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS).includes(
      requestedOperation
    )
  ) {
    throw new Error(`Unsupported self-learning bridge operation: ${requestedOperation}`);
  }

  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const proposal = validateLearningProposalEnvelope(proposalEnvelope);

  if (!matchesCompatibleAgentId(store, proposal.agentId, agent.agentId)) {
    throw new Error(
      `self-learning proposal agentId mismatch: route ${agent.agentId} vs proposal ${proposal.agentId}`
    );
  }
  if (routeProposalId && routeProposalId !== proposal.proposalId) {
    throw new Error(
      `self-learning proposalId mismatch: route ${routeProposalId} vs proposal ${proposal.proposalId}`
    );
  }

  return executeSelfLearningBridge({
    proposalEnvelope,
    operation: requestedOperation,
    execute: normalizeBooleanFlag(payload?.execute, false),
    createdAt: normalizeOptionalText(payload?.createdAt) ?? now(),
    actorId: "agent-passport-self-learning-bridge",
    admissionContext: buildSelfLearningAdmissionContext(
      store,
      proposal,
      listAgentEvidenceRefs(store, agent.agentId)
    ),
  });
}

export async function searchAgentRuntimeKnowledge(
  agentId,
  {
    didMethod = null,
    query = null,
    limit = DEFAULT_RUNTIME_SEARCH_LIMIT,
    sourceType = null,
  } = {}
) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const normalizedSourceType = normalizeRuntimeSearchSourceType(sourceType);
  return searchAgentRuntimeKnowledgeFromStore(store, agent, {
    didMethod,
    query,
    limit,
    sourceType: normalizedSourceType,
    includeExternalColdMemory: normalizedSourceType === "external_cold_memory",
  });
}

function listAgentSandboxActionAuditsFromStore(store, agentId) {
  return (store.sandboxActionAudits || [])
    .filter((audit) => matchesCompatibleAgentId(store, audit.agentId, agentId))
    .sort((left, right) => (left?.createdAt || "").localeCompare(right?.createdAt || ""));
}

function recordSandboxActionAuditInStore(
  store,
  agent,
  {
    didMethod = null,
    capability = null,
    rawAction = null,
    requestedAction = null,
    requestedActionType = null,
    sourceWindowId = null,
    recordedByAgentId = null,
    recordedByWindowId = null,
    status = null,
    executed = null,
    summary = null,
    gateReasons = [],
    negotiation = null,
    execution = null,
    error = null,
  } = {}
) {
  const normalizedStatus = normalizeSandboxActionAuditStatus(
    status ?? (error ? "failed" : execution?.executed ? "completed" : "blocked")
  );
  const audit = normalizeSandboxActionAuditRecord({
    agentId: agent.agentId,
    didMethod,
    capability,
    requestedAction,
    requestedActionType,
    sourceWindowId,
    recordedByAgentId,
    recordedByWindowId,
    status: normalizedStatus,
    executed: typeof executed === "boolean" ? executed : Boolean(execution?.executed),
    input: rawAction,
    executionBackend: execution?.executionBackend ?? null,
    writeCount: execution?.writeCount ?? 0,
    summary: normalizeOptionalText(summary) ?? execution?.summary ?? error?.message ?? null,
    gateReasons,
    negotiation,
    output: execution?.output ?? null,
    error: error
      ? {
          name: normalizeOptionalText(error.name) ?? "Error",
          message: normalizeOptionalText(error.message) ?? String(error),
        }
      : null,
  });
  if (!Array.isArray(store.sandboxActionAudits)) {
    store.sandboxActionAudits = [];
  }
  store.sandboxActionAudits.push(audit);
  appendEvent(store, "runtime_sandbox_action_audited", {
    auditId: audit.auditId,
    agentId: audit.agentId,
    capability: audit.capability,
    status: audit.status,
    sourceWindowId: audit.sourceWindowId,
    executed: audit.executed,
    writeCount: audit.writeCount,
    gateReasonCount: audit.gateReasons.length,
  });
  return audit;
}

export async function listAgentSandboxActionAudits(
  agentId,
  {
    limit = DEFAULT_SANDBOX_ACTION_AUDIT_LIMIT,
    capability = null,
    status = null,
  } = {}
) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const cappedLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_SANDBOX_ACTION_AUDIT_LIMIT;
  const normalizedCapability = normalizeRuntimeCapability(capability);
  const normalizedStatus = normalizeSandboxActionAuditStatus(status);
  const hasStatusFilter = normalizeOptionalText(status) != null;
  const audits = listAgentSandboxActionAuditsFromStore(store, agent.agentId).filter((audit) => {
    if (normalizedCapability && audit.capability !== normalizedCapability) {
      return false;
    }
    if (hasStatusFilter && audit.status !== normalizedStatus) {
      return false;
    }
    return true;
  });
  return {
    audits: audits.slice(-cappedLimit).map((audit) => buildSandboxActionAuditView(audit)),
    counts: {
      total: audits.length,
      filtered: audits.length,
    },
  };
}

async function executeRuntimeSandboxActionFromStore(
  store,
  agent,
  payload = {},
  {
    didMethod = null,
    sourceWindowId = null,
    recordedByAgentId = null,
    recordedByWindowId = null,
  } = {}
) {
  const sandboxPolicy = normalizeRuntimeSandboxPolicy(store.deviceRuntime?.sandboxPolicy);
  const securityPosture = buildDeviceSecurityPostureState(store.deviceRuntime);
  const rawAction =
    payload.sandboxAction && typeof payload.sandboxAction === "object"
      ? payload.sandboxAction
      : payload;
  const requestedCapability = normalizeRuntimeCapability(payload.requestedCapability || payload.capability);
  const capability = normalizeRuntimeCapability(
    rawAction.capability || payload.requestedCapability || payload.capability
  );
  if (!capability) {
    return null;
  }
  if (requestedCapability && rawAction !== payload && requestedCapability !== capability) {
    throw new Error(`Sandbox capability mismatch: ${requestedCapability} -> ${capability}`);
  }
  if (securityPosture.executionLocked) {
    throw new Error(`Security posture blocks execution: ${securityPosture.mode}`);
  }
  if (capability === "network_external" && securityPosture.networkEgressLocked) {
    throw new Error(`Security posture blocks network egress: ${securityPosture.mode}`);
  }

  if (shouldEnforceSandboxCapabilityAllowlist(sandboxPolicy) && !isSandboxCapabilityAllowlisted(capability, sandboxPolicy)) {
    throw new Error(`Sandbox capability not allowlisted: ${capability}`);
  }
  if (Array.isArray(sandboxPolicy.blockedCapabilities) && sandboxPolicy.blockedCapabilities.includes(capability)) {
    throw new Error(`Sandbox capability blocked: ${capability}`);
  }

  let result = null;
  let writeCount = 0;

  if (capability === "runtime_search") {
    const requestedSourceType = normalizeRuntimeSearchSourceType(rawAction.sourceType ?? null);
    const search = searchAgentRuntimeKnowledgeFromStore(store, agent, {
      didMethod,
      query:
        normalizeOptionalText(rawAction.query) ??
        normalizeOptionalText(rawAction.targetResource) ??
        normalizeOptionalText(payload.requestedAction) ??
        normalizeOptionalText(payload.userTurn) ??
        null,
      limit: rawAction.limit ?? store.deviceRuntime?.retrievalPolicy?.maxHits ?? DEFAULT_RUNTIME_SEARCH_LIMIT,
      sourceType: requestedSourceType,
      includeExternalColdMemory: requestedSourceType === "external_cold_memory",
    });
    result = {
      capability,
      executed: true,
      executionBackend: "in_process",
      writeCount,
      summary:
        search.retrieval?.externalColdMemoryHitCount > 0
          ? `命中 ${search.hits.length} 条运行时知识（含 ${search.retrieval.externalColdMemoryHitCount} 条外部冷记忆候选）`
          : `命中 ${search.hits.length} 条运行时知识`,
      output: search,
    };
  } else if (capability === "filesystem_list") {
    const resolved = await resolveSandboxFilesystemPathStrict(
      rawAction.path || rawAction.targetResource || rawAction.directory,
      sandboxPolicy
    );
    const workerResult = sandboxPolicy.workerIsolationEnabled
      ? await executeSandboxWorker(
          {
            capability,
            resolvedPath: resolved.resolvedPath,
            allowlistedRoot: resolved.matchedRoot,
            maxListEntries: sandboxPolicy.maxListEntries,
            systemSandboxEnabled: sandboxPolicy.systemBrokerSandboxEnabled,
          },
          { timeoutMs: sandboxPolicy.workerTimeoutMs }
        )
      : null;
    const output = workerResult
      ? attachSandboxBrokerOutput(workerResult.output, workerResult.broker)
      : null;
    const entries = output?.entries || [];
    result = {
      capability,
      executed: true,
      executionBackend: sandboxPolicy.workerIsolationEnabled ? "subprocess" : "in_process",
      writeCount,
      summary: `列出 ${entries.length} 个条目`,
      output:
        output ||
        {
          path: resolved.resolvedPath,
          allowlistedRoot: resolved.matchedRoot,
          entries: [],
          truncated: false,
        },
    };
  } else if (capability === "filesystem_read") {
    const resolved = await resolveSandboxFilesystemPathStrict(
      rawAction.path || rawAction.targetResource || rawAction.file,
      sandboxPolicy
    );
    const workerResult = sandboxPolicy.workerIsolationEnabled
      ? await executeSandboxWorker(
          {
            capability,
            resolvedPath: resolved.resolvedPath,
            allowlistedRoot: resolved.matchedRoot,
            maxReadBytes: sandboxPolicy.maxReadBytes,
            systemSandboxEnabled: sandboxPolicy.systemBrokerSandboxEnabled,
          },
          { timeoutMs: sandboxPolicy.workerTimeoutMs }
        )
      : null;
    let output = workerResult
      ? attachSandboxBrokerOutput(workerResult.output, workerResult.broker)
      : null;
    if (!output) {
      const targetStat = await stat(resolved.resolvedPath);
      if (!targetStat.isFile()) {
        throw new Error(`Sandbox read target is not a file: ${resolved.resolvedPath}`);
      }
      const raw = await readFile(resolved.resolvedPath, "utf8");
      const preview = truncateUtf8TextToByteBudget(raw, sandboxPolicy.maxReadBytes);
      output = {
        path: resolved.resolvedPath,
        allowlistedRoot: resolved.matchedRoot,
        bytesRead: preview.bytesRead,
        truncated: preview.truncated,
        preview: preview.text,
      };
    }
    result = {
      capability,
      executed: true,
      executionBackend: sandboxPolicy.workerIsolationEnabled ? "subprocess" : "in_process",
      writeCount,
      summary: `读取 ${output.bytesRead || 0} 字符预览`,
      output,
    };
  } else if (capability === "network_external") {
    if (sandboxPolicy.allowExternalNetwork === false) {
      throw new Error("Sandbox external network is disabled by policy");
    }
    const targetUrl =
      normalizeOptionalText(rawAction.url || rawAction.targetUrl) ??
      normalizeOptionalText(rawAction.targetResource) ??
      normalizeOptionalText(payload.targetResource) ??
      null;
    if (!targetUrl) {
      throw new Error("Sandbox network target URL is required");
    }
    const parsedTargetUrl = parseSandboxUrl(targetUrl, {
      maxUrlLength: sandboxPolicy.maxUrlLength,
    });
    const requestHeaders =
      rawAction.headers && typeof rawAction.headers === "object" && !Array.isArray(rawAction.headers)
        ? rawAction.headers
        : null;
    if (isLoopbackSandboxHost(parsedTargetUrl.hostname) && sandboxRequestHasProtectedControlPlaneHeaders(requestHeaders)) {
      throw new Error("Sandbox loopback requests cannot forward control-plane auth headers");
    }
    if (!sandboxHostMatchesAllowlist(parsedTargetUrl.hostname, sandboxPolicy.networkAllowlist)) {
      throw new Error(`Sandbox host not allowlisted: ${parsedTargetUrl.hostname || "unknown"}`);
    }
    const workerResult = await executeSandboxWorker(
      {
        capability,
        url: parsedTargetUrl.toString(),
        method: normalizeOptionalText(rawAction.method) || "GET",
        headers: requestHeaders || undefined,
        timeoutMs: sandboxPolicy.workerTimeoutMs,
        maxResponseBytes: sandboxPolicy.maxNetworkBytes,
        systemSandboxEnabled: sandboxPolicy.systemBrokerSandboxEnabled,
      },
      { timeoutMs: sandboxPolicy.workerTimeoutMs }
    );
    result = {
      capability,
      executed: true,
      executionBackend: "subprocess",
      writeCount,
      summary: `网络请求 ${workerResult.output?.status || "unknown"}`,
      output: attachSandboxBrokerOutput(workerResult.output, workerResult.broker),
    };
  } else if (capability === "process_exec") {
    const command =
      normalizeOptionalText(rawAction.command) ??
      normalizeOptionalText(rawAction.targetResource) ??
      null;
    if (!command) {
      throw new Error("Sandbox process command is required");
    }
    if (sandboxPolicy.allowShellExecution === false) {
      throw new Error("Sandbox shell execution is disabled by policy");
    }
    const resolvedCommand = await resolveSandboxProcessCommandStrict(command, sandboxPolicy);
    const safeArgs = normalizeSandboxProcessArgs(rawAction.args, {
      maxArgs: sandboxPolicy.maxProcessArgs,
      maxArgBytes: sandboxPolicy.maxProcessArgBytes,
    });
    let resolvedCwd = null;
    let allowlistedRoot = null;
    if (normalizeOptionalText(rawAction.cwd)) {
      const resolved = await resolveSandboxFilesystemPathStrict(rawAction.cwd, sandboxPolicy);
      resolvedCwd = resolved.resolvedPath;
      allowlistedRoot = resolved.matchedRoot;
    }
    const workerResult = await executeSandboxWorker(
      {
        capability,
        command: resolvedCommand.commandPath,
        args: safeArgs,
        cwd: resolvedCwd,
        allowlistedRoot,
        timeoutMs: sandboxPolicy.workerTimeoutMs,
        maxOutputBytes: sandboxPolicy.maxProcessOutputBytes,
        isolatedEnv: true,
        systemSandboxEnabled: sandboxPolicy.systemBrokerSandboxEnabled,
      },
      { timeoutMs: sandboxPolicy.workerTimeoutMs }
    );
    result = {
      capability,
      executed: true,
      executionBackend: "subprocess",
      writeCount,
      summary: `执行命令退出码 ${workerResult.output?.code ?? "unknown"}`,
      output: workerResult.output
        ? {
            ...attachSandboxBrokerOutput(workerResult.output, workerResult.broker),
            commandPath: resolvedCommand.commandPath,
            commandDigestPinned: Boolean(resolvedCommand.pinnedDigest),
            commandDigest: resolvedCommand.pinnedDigest ?? null,
          }
        : null,
    };
  } else if (capability === "conversation_minute_write") {
    const minute = recordConversationMinuteInStore(store, agent.agentId, {
      title: rawAction.title || rawAction.subject || null,
      summary: rawAction.summary || rawAction.note || null,
      transcript: rawAction.transcript || rawAction.content || payload.userTurn || null,
      highlights: rawAction.highlights || [],
      actionItems: rawAction.actionItems || [],
      tags: rawAction.tags || [],
      linkedTaskSnapshotId: rawAction.linkedTaskSnapshotId || latestAgentTaskSnapshot(store, agent.agentId)?.snapshotId || null,
      sourceWindowId,
      recordedByAgentId: recordedByAgentId ?? agent.agentId,
      recordedByWindowId: recordedByWindowId ?? sourceWindowId,
    });
    writeCount = 1;
    result = {
      capability,
      executed: true,
      executionBackend: "in_process",
      writeCount,
      summary: `已写入本地纪要 ${minute.minuteId}`,
      output: {
        minute,
      },
    };
  } else {
    throw new Error(`Unsupported sandbox capability: ${capability}`);
  }

  appendEvent(store, "runtime_sandbox_action_executed", {
    agentId: agent.agentId,
    capability,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
    writeCount,
    summary: result.summary,
  });

  return {
    capability,
    executed: true,
    executionBackend: result.executionBackend || "in_process",
    writeCount,
    summary: result.summary,
    output: result.output,
  };
}

export async function executeAgentSandboxAction(agentId, payload = {}, { didMethod = null } = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const requestedDidMethod = normalizeDidMethod(didMethod || payload.didMethod) || null;
    const rawAction =
      payload.sandboxAction && typeof payload.sandboxAction === "object"
        ? payload.sandboxAction
        : payload;
    const capability = normalizeRuntimeCapability(
      rawAction.capability || payload.requestedCapability || payload.capability
    );
    const sourceWindowId = normalizeOptionalText(payload.sourceWindowId || payload.recordedByWindowId) ?? null;
    const recordedByAgentId = agent.agentId;
    const recordedByWindowId = normalizeOptionalText(payload.recordedByWindowId || payload.sourceWindowId) ?? null;
    const requestedAction = normalizeOptionalText(payload.requestedAction) ?? null;
    const requestedActionType = normalizeRuntimeActionType(payload.requestedActionType) ?? null;
    const persistSandboxAudit = ({
      status = null,
      executed = null,
      summary = null,
      gateReasons = [],
      negotiation = null,
      execution = null,
      error = null,
    } = {}) =>
      recordSandboxActionAuditInStore(store, agent, {
        didMethod: requestedDidMethod,
        capability,
        rawAction,
        requestedAction,
        requestedActionType,
        sourceWindowId,
        recordedByAgentId,
        recordedByWindowId,
        status,
        executed,
        summary,
        gateReasons,
        negotiation,
        execution,
        error,
      });
    const securityPosture = buildDeviceSecurityPostureState(store.deviceRuntime);
    if (securityPosture.executionLocked) {
      const anomaly = recordSecurityAnomalyInStore(store, {
        category: "sandbox",
        severity: securityPosture.mode === "panic" ? "critical" : "high",
        code: "sandbox_execution_blocked_by_posture",
        message: `Sandbox execution blocked by security posture ${securityPosture.mode}`,
        actorAgentId: agent.agentId,
        actorWindowId: sourceWindowId,
        details: {
          capability,
          mode: securityPosture.mode,
        },
      }, { appendEvent });
      const sandboxAudit = persistSandboxAudit({
        status: "blocked",
        executed: false,
        summary: `Sandbox execution blocked by security posture ${securityPosture.mode}`,
        gateReasons: [`security_posture_execution_locked:${securityPosture.mode}`],
      });
      await writeStore(store);
      return {
        executed: false,
        status: "security_locked",
        securityPosture,
        anomaly,
        sandboxExecution: null,
        sandboxAudit: buildSandboxActionAuditView(sandboxAudit),
      };
    }
    const residentGate = buildResidentAgentGate(store, agent, { didMethod: requestedDidMethod });
    if (residentGate.required) {
      const sandboxAudit = persistSandboxAudit({
        status: "blocked",
        executed: false,
        summary: residentGate.message,
        gateReasons: [residentGate.code ? `resident_gate:${residentGate.code}` : "resident_gate:required"],
      });
      await writeStore(store);
      return {
        executed: false,
        status: "resident_locked",
        residentGate,
        sandboxExecution: null,
        sandboxAudit: buildSandboxActionAuditView(sandboxAudit),
      };
    }

    const contextBuilder = buildContextBuilderResult(store, agent, {
      didMethod: requestedDidMethod,
      currentGoal: normalizeOptionalText(payload.currentGoal) ?? latestAgentTaskSnapshot(store, agent.agentId)?.objective ?? null,
      query: normalizeOptionalText(payload.query) ?? normalizeOptionalText(payload.userTurn) ?? null,
    }, buildContextBuilderDeps());
    const bootstrapGate = buildRuntimeBootstrapGate(store, agent, { contextBuilder });
    if (bootstrapGate.required && !normalizeBooleanFlag(payload.allowBootstrapBypass, false)) {
      const sandboxAudit = persistSandboxAudit({
        status: "blocked",
        executed: false,
        summary: "Sandbox execution blocked until runtime bootstrap completes",
        gateReasons:
          bootstrapGate.missingRequiredCodes.length > 0
            ? bootstrapGate.missingRequiredCodes.map((code) => `bootstrap_missing:${code}`)
            : ["bootstrap_required"],
      });
      await writeStore(store);
      return {
        executed: false,
        status: "bootstrap_required",
        bootstrapGate,
        sandboxExecution: null,
        sandboxAudit: buildSandboxActionAuditView(sandboxAudit),
      };
    }

    const negotiation = buildCommandNegotiationResult(store, agent, payload, {
      deviceRuntime: normalizeDeviceRuntime(store.deviceRuntime),
      residentGate,
      currentGoal: normalizeOptionalText(payload.currentGoal) ?? null,
      userTurn: normalizeOptionalText(payload.userTurn) ?? null,
    });
    if (!negotiation.shouldExecute) {
      const negotiationGateReasons = Array.from(new Set([
        ...(Array.isArray(negotiation.sandboxBlockedReasons) ? negotiation.sandboxBlockedReasons : []),
        `negotiation_required:${negotiation.decision || "continue"}`,
      ]));
      const sandboxAudit = persistSandboxAudit({
        status: "blocked",
        executed: false,
        summary:
          negotiation.decision === "blocked"
            ? "Sandbox execution blocked by constrained execution policy"
            : `Sandbox execution paused for negotiation: ${negotiation.decision || "continue"}`,
        gateReasons: negotiationGateReasons,
        negotiation,
      });
      await writeStore(store);
      return {
        executed: false,
        status: negotiation.decision === "blocked" ? "blocked" : "negotiation_required",
        negotiation,
        sandboxExecution: null,
        sandboxAudit: buildSandboxActionAuditView(sandboxAudit),
      };
    }

    try {
      const sandboxExecution = await executeRuntimeSandboxActionFromStore(store, agent, payload, {
        didMethod: requestedDidMethod,
        sourceWindowId,
        recordedByAgentId,
        recordedByWindowId,
      });
      const sandboxAudit = persistSandboxAudit({
        execution: sandboxExecution,
        negotiation,
      });
      await writeStore(store);

      return {
        executed: true,
        status: "completed",
        negotiation,
        sandboxExecution,
        sandboxAudit: buildSandboxActionAuditView(sandboxAudit),
      };
    } catch (error) {
      const sandboxAudit = persistSandboxAudit({
        status: "failed",
        error,
        negotiation,
      });
      await writeStore(store);
      error.sandboxAudit = buildSandboxActionAuditView(sandboxAudit);
      error.sandboxAuditId = sandboxAudit.auditId;
      throw error;
    }
  });
}

function appendPassportMemoryRecord(store, agentId, record) {
  if (shouldSupersedePassportField(record)) {
    const activeSameFieldRecords = (store.passportMemories || []).filter(
      (entry) =>
        matchesCompatibleAgentId(store, entry.agentId, agentId) &&
        entry.layer === record.layer &&
        normalizeOptionalText(entry.payload?.field) === normalizeOptionalText(record.payload?.field) &&
        entry.status !== "superseded"
    );
    const dominantRecord = findDominantStatefulSemanticRecord(activeSameFieldRecords, record);

    if (dominantRecord) {
      record.status = "superseded";
      record.memoryDynamics = {
        ...(record.memoryDynamics && typeof record.memoryDynamics === "object" ? record.memoryDynamics : {}),
        supersededAt: record.recordedAt || now(),
        supersededBy: dominantRecord.passportMemoryId,
        supersedeReason: "lower_state_priority",
      };
    } else {
      for (const entry of activeSameFieldRecords) {
        entry.status = "superseded";
      }
    }
  }

  const conflict = applyPassportMemoryConflictTracking(store, agentId, record);
  store.passportMemories.push(record);
  appendEvent(store, "passport_memory_recorded", {
    passportMemoryId: record.passportMemoryId,
    agentId,
    layer: record.layer,
    kind: record.kind,
    conflictId: conflict?.conflictId ?? null,
    sourceWindowId: record.sourceWindowId,
  });
  return record;
}

export async function writePassportMemories(agentId, payloads = []) {
  const normalizedPayloads = (Array.isArray(payloads) ? payloads : []).filter(Boolean);
  if (normalizedPayloads.length === 0) {
    return [];
  }
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const records = [];
    for (const payload of normalizedPayloads) {
      const record = normalizePassportMemoryRecord(agent.agentId, payload);
      if (!record.summary && !record.content && Object.keys(record.payload || {}).length === 0) {
        throw new Error("summary, content or payload is required");
      }
      records.push(appendPassportMemoryRecord(store, agent.agentId, record));
    }
    await writeStore(store);
    return records;
  });
}

export async function markPassportMemoriesReverted(
  agentId,
  passportMemoryIds = [],
  {
    sourceWindowId = null,
    proposalId = null,
    checkpointId = null,
    revertedByAgentId = null,
    revertedByWindowId = null,
    reason = null,
    revertedAt = null,
  } = {}
) {
  const targetMemoryIds = normalizeTextList(passportMemoryIds);
  if (targetMemoryIds.length === 0) {
    return {
      ok: true,
      agentId: normalizeOptionalText(agentId) ?? null,
      revertedAt: normalizeOptionalText(revertedAt) ?? null,
      revertedMemoryIds: [],
      revertedRecords: [],
    };
  }

  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const resolvedAgentId = agent.agentId;
    const targetIdSet = new Set(targetMemoryIds);
    const effectiveRevertedAt = normalizeOptionalText(revertedAt) ?? now();
    const revertedRecords = [];

    for (const entry of store.passportMemories || []) {
      if (
        !matchesCompatibleAgentId(store, entry?.agentId, resolvedAgentId) ||
        !targetIdSet.has(entry?.passportMemoryId) ||
        entry?.status === "reverted"
      ) {
        continue;
      }
      entry.status = "reverted";
      entry.revertedAt = effectiveRevertedAt;
      entry.memoryDynamics = {
        ...(cloneJson(entry.memoryDynamics) || {}),
        forgottenAt: effectiveRevertedAt,
        lastReactivatedAt: entry?.memoryDynamics?.lastReactivatedAt || null,
      };
      revertedRecords.push(cloneJson(entry));
    }

    const revertedMemoryIds = revertedRecords.map((entry) => entry.passportMemoryId).filter(Boolean);
    if (revertedMemoryIds.length > 0) {
      appendEvent(store, "passport_memory_reverted", {
        agentId: resolvedAgentId,
        revertedAt: effectiveRevertedAt,
        revertedMemoryIds,
        proposalId: normalizeOptionalText(proposalId) ?? null,
        checkpointId: normalizeOptionalText(checkpointId) ?? null,
        revertedByAgentId: normalizeOptionalText(revertedByAgentId) ?? resolvedAgentId,
        revertedByWindowId: normalizeOptionalText(revertedByWindowId) ?? null,
        sourceWindowId: normalizeOptionalText(sourceWindowId) ?? normalizeOptionalText(revertedByWindowId) ?? null,
        reason: normalizeOptionalText(reason) ?? null,
      });
      await writeStore(store);
    }

    return {
      ok: true,
      agentId: resolvedAgentId,
      revertedAt: effectiveRevertedAt,
      revertedMemoryIds,
      revertedRecords,
    };
  });
}

export async function writePassportMemory(agentId, payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const record = normalizePassportMemoryRecord(agent.agentId, payload);
    if (!record.summary && !record.content && Object.keys(record.payload || {}).length === 0) {
      throw new Error("summary, content or payload is required");
    }
    appendPassportMemoryRecord(store, agent.agentId, record);
    await writeStore(store);
    return record;
  });
}

export async function listPassportMemories(
  agentId,
  {
    layer = null,
    kind = null,
    query = null,
    limit = DEFAULT_PASSPORT_MEMORY_LIMIT,
    includeInactive = false,
    store: storeOverride = null,
  } = {}
) {
  const store = storeOverride || (await loadStore());
  const agent = ensureAgent(store, agentId);
  const latestCognitiveState = listAgentCognitiveStatesFromStore(store, agent.agentId).at(-1) ?? null;
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_PASSPORT_MEMORY_LIMIT;
  const records = listAgentPassportMemories(store, agent.agentId, { layer, kind })
    .filter((entry) => includeInactive || isPassportMemoryActive(entry));
  const queryText = normalizeOptionalText(query) ?? null;
  const filtered = queryText
    ? records
        .map((entry) => ({ entry, score: scorePassportMemoryRelevance(entry, queryText, { cognitiveState: latestCognitiveState }) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || (a.entry.recordedAt || "").localeCompare(b.entry.recordedAt || ""))
        .map((item) => item.entry)
    : records;

  return {
    memories: queryText ? filtered.slice(0, cappedLimit) : filtered.slice(-cappedLimit),
    counts: {
      total: records.length,
      filtered: filtered.length,
    },
  };
}

export async function compactAgentMemory(agentId, payload = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const writes = compactConversationToPassportMemories(store, agent, payload);
    for (const record of writes) {
      if (shouldSupersedePassportField(record)) {
        for (const entry of store.passportMemories || []) {
          if (
            matchesCompatibleAgentId(store, entry.agentId, agent.agentId) &&
            entry.layer === record.layer &&
            normalizeOptionalText(entry.payload?.field) === normalizeOptionalText(record.payload?.field) &&
            entry.status !== "superseded"
          ) {
            entry.status = "superseded";
          }
        }
      }
      applyPassportMemoryConflictTracking(store, agent.agentId, record);
      store.passportMemories.push(record);
    }

    appendEvent(store, "passport_memory_compacted", {
      agentId: agent.agentId,
      writeCount: writes.length,
      sourceWindowId: normalizeOptionalText(payload.sourceWindowId) ?? null,
    });
    await writeStore(store);
    return {
      compactedAt: now(),
      agentId: agent.agentId,
      writeCount: writes.length,
      writes,
    };
  });
}

export async function bootstrapAgentRuntime(agentId, payload = {}, { didMethod = null, store = null } = {}) {
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  if (store && !dryRun && !storeMutationContext.getStore()?.active) {
    throw new Error("bootstrapAgentRuntime store override requires dryRun or an active store mutation");
  }
  const execute = async () => {
    const loadedStore = store || (dryRun ? await runWithPassiveStoreAccess(() => loadStore()) : await loadStore());
    const targetStore = store ? store : dryRun ? cloneJson(loadedStore) : loadedStore;
    const agent = ensureAgent(targetStore, agentId);
    const requestedDidMethod = normalizeDidMethod(didMethod || payload.didMethod) || null;
    const sourceWindowId = normalizeOptionalText(payload.sourceWindowId || payload.updatedByWindowId) ?? null;
    const recordedByAgentId = agent.agentId;
    const recordedByWindowId = normalizeOptionalText(payload.recordedByWindowId || payload.updatedByWindowId || payload.sourceWindowId) ?? null;

  const requestedDisplayName = normalizeOptionalText(payload.displayName || payload.name) ?? null;
  const requestedRole = normalizeOptionalText(payload.role) ?? null;
  const autoClaimResidentAgent = payload.autoClaimResidentAgent == null
    ? true
    : normalizeBooleanFlag(payload.autoClaimResidentAgent, true);
  const shouldClaimResidentAgent =
    normalizeBooleanFlag(payload.claimResidentAgent, false) ||
    (autoClaimResidentAgent && !dryRun && !normalizeOptionalText(targetStore.deviceRuntime?.residentAgentId));
  const allowResidentRebind = normalizeBooleanFlag(payload.allowResidentRebind, false);
  if (requestedDisplayName) {
    agent.displayName = requestedDisplayName;
  }
  if (requestedRole) {
    agent.role = requestedRole;
  }

  if (shouldClaimResidentAgent) {
    const currentResidentBinding = resolveResidentAgentBinding(targetStore, targetStore.deviceRuntime);
    const currentResidentReference = currentResidentBinding.residentAgentReference ?? null;
    const currentResidentAgentId = currentResidentBinding.residentAgentId ?? null;
    if (
      currentResidentAgentId &&
      currentResidentAgentId !== agent.agentId &&
      normalizeBooleanFlag(targetStore.deviceRuntime?.residentLocked, true) &&
      !allowResidentRebind
    ) {
      throw new Error(`本地参考层 resident agent binding is locked to ${currentResidentAgentId}`);
    }
    targetStore.deviceRuntime = normalizeDeviceRuntime({
      ...targetStore.deviceRuntime,
      residentAgentId: agent.agentId,
      residentAgentReference:
        canonicalizeResidentAgentReference(agent.agentId) ??
        currentResidentReference ??
        null,
      resolvedResidentAgentId: agent.agentId,
      residentDidMethod: requestedDidMethod || targetStore.deviceRuntime?.residentDidMethod || "agentpassport",
      updatedAt: now(),
      updatedByAgentId: recordedByAgentId,
      updatedByWindowId: recordedByWindowId,
      sourceWindowId,
    });
  }

  const bootstrapMemoryPayload = {
    ...payload,
    sourceWindowId,
    recordedByAgentId,
    recordedByWindowId,
  };
  const profileWrites = buildBootstrapProfileMemoryWrites(agent, bootstrapMemoryPayload, {
    profileSnapshot: buildProfileMemorySnapshot(targetStore, agent, { listAgentPassportMemories }),
  });
  const workingWrites = buildBootstrapWorkingMemoryWrites(agent, bootstrapMemoryPayload);
  const ledgerWrites = buildBootstrapLedgerMemoryWrites(agent, bootstrapMemoryPayload, {
    existingCommitments: listAgentPassportMemories(targetStore, agent.agentId, { layer: "ledger" }),
  });

  const allMemoryWrites = [...profileWrites, ...workingWrites, ...ledgerWrites];
  for (const record of allMemoryWrites) {
    applyPassportMemorySupersession(targetStore, agent.agentId, record);
    if (!Array.isArray(targetStore.passportMemories)) {
      targetStore.passportMemories = [];
    }
    targetStore.passportMemories.push(record);
  }

  const previousSnapshot = latestAgentTaskSnapshot(targetStore, agent.agentId);
  const shouldCreateSnapshot =
    !previousSnapshot ||
    [
      payload.title,
      payload.objective,
      payload.currentGoal,
      payload.currentPlan,
      payload.plan,
      payload.nextAction,
      payload.constraints,
      payload.successCriteria,
      payload.checkpointSummary,
      payload.maxConversationTurns,
      payload.maxContextChars,
    ].some((value) => (Array.isArray(value) ? value.length > 0 : normalizeOptionalText(value) != null || Number.isFinite(Number(value))));

  let snapshot = null;
  if (shouldCreateSnapshot) {
    snapshot = normalizeTaskSnapshotRecord(
      agent.agentId,
      {
        title:
          normalizeOptionalText(payload.title) ??
          previousSnapshot?.title ??
          `${agent.displayName || agent.agentId} Runtime Bootstrap`,
        objective:
          normalizeOptionalText(payload.objective || payload.currentGoal) ??
          previousSnapshot?.objective ??
          "建立最小冷启动包，避免聊天历史承担身份参考。",
        status: normalizeOptionalText(payload.status) ?? previousSnapshot?.status ?? "active",
        currentPlan: normalizeTextList(payload.currentPlan || payload.plan),
        nextAction:
          normalizeOptionalText(payload.nextAction) ??
          previousSnapshot?.nextAction ??
          "运行 context builder / verifier，确认身份与上下文恢复可用",
        constraints: normalizeTextList(payload.constraints),
        successCriteria: normalizeTextList(payload.successCriteria),
        checkpointSummary:
          normalizeOptionalText(payload.checkpointSummary) ??
          previousSnapshot?.checkpointSummary ??
          "Bootstrap 完成：本地参考层 成为冷启动参考源。",
        driftPolicy: {
          maxConversationTurns: toFiniteNumber(payload.maxConversationTurns, previousSnapshot?.driftPolicy?.maxConversationTurns || 12),
          maxContextChars: toFiniteNumber(payload.maxContextChars, previousSnapshot?.driftPolicy?.maxContextChars || 16000),
          maxRecentConversationTurns: toFiniteNumber(
            payload.maxRecentConversationTurns,
            previousSnapshot?.driftPolicy?.maxRecentConversationTurns || DEFAULT_RUNTIME_RECENT_TURN_LIMIT
          ),
          maxToolResults: toFiniteNumber(
            payload.maxToolResults,
            previousSnapshot?.driftPolicy?.maxToolResults || DEFAULT_RUNTIME_TOOL_RESULT_LIMIT
          ),
          maxQueryIterations: toFiniteNumber(
            payload.maxQueryIterations,
            previousSnapshot?.driftPolicy?.maxQueryIterations || DEFAULT_RUNTIME_QUERY_ITERATION_LIMIT
          ),
        },
        sourceWindowId,
        updatedByAgentId: recordedByAgentId,
        updatedByWindowId: recordedByWindowId,
      },
      previousSnapshot,
      {
        normalizeRuntimeDriftPolicy,
      }
    );
    if (!Array.isArray(targetStore.taskSnapshots)) {
      targetStore.taskSnapshots = [];
    }
    targetStore.taskSnapshots.push(snapshot);
  } else {
    snapshot = previousSnapshot;
  }

  appendEvent(targetStore, "agent_runtime_bootstrapped", {
    agentId: agent.agentId,
    dryRun,
    profileWriteCount: profileWrites.length,
    workingWriteCount: workingWrites.length,
    ledgerWriteCount: ledgerWrites.length,
    snapshotId: snapshot?.snapshotId ?? null,
    sourceWindowId,
  });

  const currentGoal =
    normalizeOptionalText(payload.currentGoal || payload.objective) ??
    snapshot?.objective ??
    snapshot?.title ??
    null;
  const contextBuilder = buildContextBuilderResult(targetStore, agent, {
    didMethod: requestedDidMethod,
    currentGoal,
    query: normalizeOptionalText(payload.query) ?? currentGoal ?? null,
  }, buildContextBuilderDeps());
  const rehydrate = buildAgentRehydratePack(targetStore, agent, {
    didMethod: requestedDidMethod,
  });
  const sessionState = upsertAgentSessionState(targetStore, agent, {
    didMethod: requestedDidMethod,
    currentGoal,
    contextBuilder,
    sourceWindowId,
    transitionReason: dryRun ? "bootstrap_preview" : "bootstrap_initialized",
  });

    if (!dryRun && !store) {
      await writeStore(targetStore);
    }

    return {
      bootstrap: {
        bootstrappedAt: now(),
        dryRun,
        agentId: agent.agentId,
        didMethod: requestedDidMethod,
        updatedIdentity: {
          displayName: agent.displayName,
          role: agent.role,
        },
        profileWrites: cloneJson(profileWrites) ?? [],
        workingWrites: cloneJson(workingWrites) ?? [],
        ledgerWrites: cloneJson(ledgerWrites) ?? [],
        snapshot: cloneJson(snapshot) ?? null,
        summary: {
          profileWriteCount: profileWrites.length,
          workingWriteCount: workingWrites.length,
          ledgerWriteCount: ledgerWrites.length,
          snapshotCreated: Boolean(shouldCreateSnapshot && snapshot),
          claimedResidentAgent: shouldClaimResidentAgent,
        },
      },
      contextBuilder,
      rehydrate,
      deviceRuntime: buildDeviceRuntimeView(targetStore.deviceRuntime, targetStore),
      sessionState: buildAgentSessionStateView(sessionState),
      persisted: {
        bootstrap: !dryRun,
      },
    };
  };
  if (store) {
    return execute();
  }
  return queueStoreMutation(execute);
}

export async function buildAgentContextBundle(agentId, payload = {}, { didMethod = null, store: storeOverride = null } = {}) {
  const store = storeOverride || (await loadStore());
  const agent = ensureAgent(store, agentId);
  const memoryStabilityRuntime = await loadMemoryStabilityRuntimeGateRaw(process.env);
  const contextBuilder = buildContextBuilderResult(store, agent, {
    didMethod,
    resumeFromCompactBoundaryId: payload.resumeFromCompactBoundaryId ?? null,
    currentGoal: payload.currentGoal ?? null,
    recentConversationTurns: payload.recentConversationTurns ?? [],
    toolResults: payload.toolResults ?? [],
    query: payload.query ?? null,
    memoryStabilityRuntime,
  }, buildContextBuilderDeps());
  return prepareMemoryStabilityPromptContext(contextBuilder, payload, {
    provider: payload.reasonerProvider ?? payload.provider ?? null,
  });
}

export async function runAgentOfflineReplay(agentId, payload = {}, { didMethod = null } = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const agent = ensureAgent(store, agentId);
    const requestedDidMethod = normalizeDidMethod(didMethod || payload.didMethod) || null;
    const currentGoal =
      normalizeOptionalText(payload.currentGoal) ??
      latestAgentTaskSnapshot(store, agent.agentId)?.objective ??
      latestAgentTaskSnapshot(store, agent.agentId)?.title ??
      null;
    const sourceWindowId = normalizeOptionalText(payload.sourceWindowId || payload.recordedByWindowId) ?? null;
    const cognitiveState = listAgentCognitiveStatesFromStore(store, agent.agentId).at(-1) ?? null;
    const maintenance = runPassportMemoryMaintenanceCycle(store, agent, {
      currentGoal,
      cognitiveState,
      sourceWindowId,
      offlineReplayRequested: true,
    });
    await writeStore(store);
    return {
      generatedAt: now(),
      agentId: agent.agentId,
      didMethod: requestedDidMethod,
      currentGoal,
      maintenance: {
        replay: cloneJson(maintenance.replay) ?? null,
        offlineReplay: cloneJson(maintenance.offlineReplay) ?? null,
        reconsolidation: cloneJson(maintenance.reconsolidation) ?? null,
      },
      memoryLayers: buildAgentMemoryLayerView(store, agent, {
        query: currentGoal,
        currentGoal,
        lightweight: true,
      }),
    };
  });
}

export async function verifyAgentResponse(agentId, payload = {}, { didMethod = null } = {}) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  return buildResponseVerificationResult(store, agent, payload, { didMethod }, buildResponseVerificationDeps());
}

export async function listAgentRuns(agentId, { limit = 10, status = null } = {}) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 10;
  const normalizedStatus = normalizeOptionalText(status)?.toLowerCase() ?? null;
  const records = listAgentRunsFromStore(store, agent.agentId)
    .filter((run) => (normalizedStatus ? normalizeAgentRunStatus(run.status) === normalizedStatus : true));
  const autoRecoveryAudits = listAgentAutoRecoveryAuditsFromStore(store, agent.agentId);

  return {
    runs: records.slice(-cappedLimit).map((run) => buildAgentRunView(run)),
    autoRecoveryAudits: autoRecoveryAudits.slice(-cappedLimit),
    counts: {
      total: records.length,
      filtered: records.length,
      autoRecoveryAudits: autoRecoveryAudits.length,
    },
  };
}

export async function listAgentQueryStates(agentId, { limit = 10, status = null } = {}) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 10;
  const normalizedStatus = normalizeOptionalText(status)?.toLowerCase() ?? null;
  const records = listAgentQueryStatesFromStore(store, agent.agentId).filter((state) =>
    normalizedStatus ? normalizeOptionalText(state.status)?.toLowerCase() === normalizedStatus : true
  );

  return {
    queryStates: records.slice(-cappedLimit).map((state) => buildAgentQueryStateView(state)),
    counts: {
      total: records.length,
      filtered: records.length,
    },
  };
}

export async function getAgentCognitiveState(agentId, { didMethod = null } = {}) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const state = resolveEffectiveAgentCognitiveState(store, agent, { didMethod }, buildCognitiveStateDeps());
  return buildAgentCognitiveStateView(state);
}

export async function listAgentCognitiveTransitions(agentId, { limit = 12 } = {}) {
  const store = await loadStore();
  ensureAgent(store, agentId);
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 12;
  const records = listAgentCognitiveTransitionsFromStore(store, agentId);
  return {
    transitions: records.slice(-cappedLimit).map((transition) => cloneJson(transition) ?? null).filter(Boolean),
    counts: {
      total: records.length,
      filtered: Math.min(records.length, cappedLimit),
    },
  };
}

export async function getAgentSessionState(agentId, { didMethod = null, persist = true } = {}) {
  if (persist && !storeMutationContext.getStore()?.active) {
    return queueStoreMutation(() => getAgentSessionState(agentId, { didMethod, persist }));
  }
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const state = listAgentSessionStatesFromStore(store, agentId).at(-1) ?? null;
  const currentGoal =
    latestAgentTaskSnapshot(store, agent.agentId)?.objective ??
    latestAgentTaskSnapshot(store, agent.agentId)?.title ??
    null;
  const shouldRefresh =
    !state ||
    state.localMode == null ||
    state.residentAgentId == null ||
    (state.queryState && state.queryState.agentId == null) ||
    state.memoryHomeostasis == null;
  if (state && (!shouldRefresh || !persist)) {
    const view = buildAgentSessionStateView(state);
    return shouldRefresh
      ? {
          ...view,
          refreshRequired: true,
          persisted: false,
        }
      : view;
  }
  if (!persist) {
    return {
      agentId: agent.agentId,
      didMethod: normalizeDidMethod(didMethod) || null,
      currentGoal,
      refreshRequired: true,
      persisted: false,
      sessionState: null,
      updatedAt: null,
    };
  }

  const nextState = upsertAgentSessionState(store, agent, {
    didMethod,
    currentGoal,
    contextBuilder: buildContextBuilderResult(store, agent, {
      didMethod,
      currentGoal,
    }, buildContextBuilderDeps()),
    cognitiveState: listAgentCognitiveStatesFromStore(store, agent.agentId).at(-1) ?? null,
    sourceWindowId: listAgentWindows(store, agent.agentId).at(-1)?.windowId ?? null,
    transitionReason: state ? "session_refreshed" : "session_initialized",
  });
  await writeStore(store);
  return buildAgentSessionStateView(nextState);
}

export async function listCompactBoundaries(agentId, { limit = 10 } = {}) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 10;
  const records = listAgentCompactBoundariesFromStore(store, agent.agentId);
  return {
    compactBoundaries: records.slice(-cappedLimit).map((boundary) => buildCompactBoundaryView(boundary)),
    counts: {
      total: records.length,
      filtered: records.length,
    },
  };
}

export async function listVerificationRuns(agentId, { limit = 10, status = null } = {}) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 10;
  const normalizedStatus = normalizeOptionalText(status)?.toLowerCase() ?? null;
  const records = listAgentVerificationRunsFromStore(store, agent.agentId).filter((run) =>
    normalizedStatus ? normalizeVerificationRunStatus(run.status) === normalizedStatus : true
  );
  const verificationRuns = records.slice(-cappedLimit).map((run) => buildVerificationRunView(run));
  return {
    verificationRuns,
    integrityRuns: verificationRuns.slice(),
    counts: {
      total: records.length,
      filtered: records.length,
    },
  };
}

export async function executeVerificationRun(agentId, payload = {}, { didMethod = null } = {}) {
  return queueStoreMutation(async () => {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const memoryStabilityRuntime = await loadMemoryStabilityRuntimeGateRaw(process.env);
  const requestedDidMethod = normalizeDidMethod(didMethod || payload.didMethod) || null;
  const resumeFromCompactBoundaryId = normalizeOptionalText(payload.resumeFromCompactBoundaryId) ?? null;
  const currentGoal =
    normalizeOptionalText(payload.currentGoal) ??
    latestAgentTaskSnapshot(store, agent.agentId)?.objective ??
    latestAgentTaskSnapshot(store, agent.agentId)?.title ??
    null;
  const sourceWindowId = normalizeOptionalText(payload.sourceWindowId || payload.recordedByWindowId) ?? null;
  const verificationRuntimeSnapshot = buildLightweightContextRuntimeSnapshot(store, agent, {
    didMethod: requestedDidMethod,
    memoryStabilityRuntime,
  });
  const contextBuilder = buildContextBuilderResult(store, agent, {
    didMethod: requestedDidMethod,
    resumeFromCompactBoundaryId,
    currentGoal,
    recentConversationTurns: normalizeRunnerConversationTurns(payload),
    toolResults: normalizeRunnerToolResults(payload),
    query: payload.query ?? currentGoal ?? payload.userTurn ?? null,
    runtimeSnapshot: verificationRuntimeSnapshot,
    memoryStabilityRuntime,
  }, buildContextBuilderDeps());
  const latestRun = listAgentRunsFromStore(store, agent.agentId).at(-1) ?? null;
  const latestBoundary = listAgentCompactBoundariesFromStore(store, agent.agentId).at(-1) ?? null;
  const bootstrapGate = buildRuntimeBootstrapGate(store, agent, { contextBuilder });
  const adversarialVerification = buildResponseVerificationResult(
    store,
    agent,
    {
      responseText: normalizeOptionalText(payload.adversarialResponseText) ?? "agent_id: agent_treasury",
      claims: cloneJson(payload.adversarialClaims) ?? { agentId: "agent_treasury" },
      contextBuilder,
    },
    { didMethod: requestedDidMethod },
    buildResponseVerificationDeps()
  );

  const checks = [
    {
      code: "bootstrap_gate_readiness",
      status: bootstrapGate.required ? "partial" : "passed",
      message: bootstrapGate.required
        ? "当前 agent 还缺最小冷启动包，建议先执行 runtime bootstrap。"
        : "当前 agent 已满足最小 bootstrap gate。",
      evidence: {
        missingRequiredCodes: cloneJson(bootstrapGate.missingRequiredCodes) ?? [],
      },
    },
    {
      code: "identity_snapshot_integrity",
      status:
        contextBuilder.slots?.identitySnapshot?.agentId === agent.agentId &&
        normalizeOptionalText(contextBuilder.slots?.identitySnapshot?.did)
          ? "passed"
          : "failed",
      message: "context builder 必须提供稳定的 identity snapshot。",
      evidence: {
        agentId: contextBuilder.slots?.identitySnapshot?.agentId ?? null,
        did: contextBuilder.slots?.identitySnapshot?.did ?? null,
      },
    },
    {
      code: "task_snapshot_bootstrap",
      status: verificationRuntimeSnapshot.taskSnapshot ? "passed" : "partial",
      message: verificationRuntimeSnapshot.taskSnapshot
        ? "当前 agent 已具备 task snapshot，可支持更稳的冷启动。"
        : "当前 agent 还缺 task snapshot，运行时会更容易进入 rehydrate_required。",
      evidence: {
        taskSnapshotId: verificationRuntimeSnapshot.taskSnapshot?.snapshotId ?? null,
      },
    },
    {
      code: "profile_memory_bootstrap",
      status: Object.keys(contextBuilder.slots?.identitySnapshot?.profile || {}).length > 0 ? "passed" : "partial",
      message: "profile memory 应至少提供名字、角色、长期目标等稳定字段。",
      evidence: {
        profileFieldCount: Object.keys(contextBuilder.slots?.identitySnapshot?.profile || {}).length,
      },
    },
    {
      code: "adversarial_identity_probe",
      status:
        adversarialVerification.valid === false &&
        adversarialVerification.issues?.some((issue) => issue.code === "agent_id_mismatch")
          ? "passed"
          : "failed",
      message: "runtime integrity 自检至少要能拦住错误的 agent_id 冒充。",
      evidence: {
        valid: adversarialVerification.valid,
        issues: adversarialVerification.issues?.map((issue) => issue.code) || [],
      },
    },
    {
      code: "compact_boundary_recoverability",
      status: latestBoundary ? "passed" : "partial",
      message: latestBoundary
        ? "当前 agent 已具备 compact boundary，可用于 resume / 恢复。"
        : "当前 agent 还没有 compact boundary，长任务恢复能力仍偏弱。",
      evidence: {
        compactBoundaryId: latestBoundary?.compactBoundaryId ?? null,
      },
    },
    {
      code: "run_receipt_presence",
      status: latestRun ? "passed" : "partial",
      message: "运行链应留下可追溯的运行记录。",
      evidence: {
        runId: latestRun?.runId ?? null,
        runStatus: latestRun?.status ?? null,
      },
    },
  ];

  const verificationRun = buildVerificationRunRecord(store, agent, {
    didMethod: requestedDidMethod,
    currentDidMethod: didMethodFromReference(contextBuilder?.slots?.identitySnapshot?.did),
    mode: normalizeOptionalText(payload.mode) ?? "runtime_integrity",
    checks,
    contextBuilder,
    sourceWindowId,
    relatedRunId: latestRun?.runId ?? null,
    relatedCompactBoundaryId: resumeFromCompactBoundaryId ?? latestBoundary?.compactBoundaryId ?? null,
  });
  const verificationRunView = buildVerificationRunView(verificationRun);

  const persist = normalizeBooleanFlag(payload.persistRun, true);
  if (!persist) {
    const sessionState = listAgentSessionStatesFromStore(store, agent.agentId).at(-1) ?? null;
    const effectiveCognitiveState = resolveEffectiveAgentCognitiveState(store, agent, {
      didMethod: requestedDidMethod,
    }, buildCognitiveStateDeps());
    const goalState = listAgentGoalStatesFromStore(store, agent.agentId).at(-1) ?? null;
    const selfEvaluation = buildSelfEvaluation({
      run: latestRun,
      driftCheck: null,
      verification: adversarialVerification,
      negotiation: null,
      contextBuilder,
    });
    const capabilityBoundarySummary = buildExecutionCapabilityBoundarySummary({
      verification: adversarialVerification,
      executionKind: "verification",
    });
    return {
      verificationRun: verificationRunView,
      integrityRun: verificationRunView,
      sessionState: buildAgentSessionStateView(sessionState),
      cognitiveState: buildAgentCognitiveStateView(effectiveCognitiveState),
      runtimeStateSummary: buildAgentCognitiveStateView(effectiveCognitiveState),
      cognitiveTransition: null,
      goalState: cloneJson(goalState) ?? null,
      selfEvaluation: cloneJson(selfEvaluation) ?? null,
      strategyProfile: cloneJson(effectiveCognitiveState?.strategyProfile) ?? null,
      retrievalFeedback: null,
      maintenance: {
        explicitPreferenceWriteCount: 0,
        stabilizedPreferenceWriteCount: 0,
        preferenceArbitrationCount: 0,
        recoveryActionId: null,
        reflectionCount: 0,
      },
      recoveryAction: null,
      reflections: [],
      capabilityBoundarySummary,
      contextBuilder,
      adversarialVerification,
      persisted: {
        verificationRun: false,
      },
    };
  }
  if (!Array.isArray(store.verificationRuns)) {
    store.verificationRuns = [];
  }
  if (persist) {
    store.verificationRuns.push(verificationRun);
  }

  appendEvent(store, "verification_run_executed", {
    verificationRunId: verificationRun.verificationRunId,
    agentId: agent.agentId,
    didMethod: verificationRun.didMethod,
    status: verificationRun.status,
    sourceWindowId,
  });

  const goalState = upsertAgentGoalState(
    store,
    buildGoalKeeperState(store, agent, {
      currentGoal,
      contextBuilder,
      driftCheck: null,
      negotiation: null,
      run: latestRun,
      sourceWindowId,
    })
  );
  const selfEvaluation = buildSelfEvaluation({
    run: latestRun,
    driftCheck: null,
    verification: adversarialVerification,
    negotiation: null,
    contextBuilder,
  });
  const strategyProfile = resolveCognitiveStrategy({
    cognitiveMode: inferCognitiveMode({
      verification: adversarialVerification,
      residentGate: verificationRuntimeSnapshot.residentGate,
      bootstrapGate,
      queryState: null,
    }),
    selfEvaluation,
    goalState,
  });
  const retrievalFeedback = recordRetrievalFeedbackInStore(store, agent, {
    query: payload.query ?? currentGoal ?? payload.userTurn ?? null,
    contextBuilder,
    sourceWindowId,
  });
  const explicitPreferences = extractExplicitPreferencesFromText(
    [payload.userTurn, currentGoal].filter(Boolean).join("\n")
  );
  const explicitPreferenceWrites = writeExplicitPreferenceMemories(store, agent, explicitPreferences, {
    sourceWindowId,
  });
  const thoughtTrace = buildThoughtTraceRecord(agent, {
    goalState,
    run: latestRun,
    queryState: null,
    cognitiveState: null,
    selfEvaluation,
    strategyProfile,
    sourceWindowId,
  });
  const failureReflection = buildFailureReflection(agent, {
    goalState,
    run: latestRun,
    driftCheck: null,
    verification: adversarialVerification,
    negotiation: null,
    bootstrapGate,
    reasoner: null,
    sandboxExecution: null,
    strategyProfile,
    sourceWindowId,
  });
  const preferenceSignals = normalizeTextList([
    ...extractPreferenceSignalsFromText(payload.userTurn),
    ...extractPreferenceSignalsFromText(currentGoal),
  ]);

  const previousCognitiveState = listAgentCognitiveStatesFromStore(store, agent.agentId).at(-1) ?? null;
  const cognitiveState = buildContinuousCognitiveState(store, agent, {
    didMethod: requestedDidMethod,
    contextBuilder,
    driftCheck: null,
    verification: adversarialVerification,
    residentGate: verificationRuntimeSnapshot.residentGate,
    bootstrapGate,
    queryState: null,
    negotiation: null,
    preferenceSignals,
    run: latestRun,
    goalState,
    selfEvaluation,
    strategyProfile,
    reflection: failureReflection ?? thoughtTrace,
    compactBoundary: latestBoundary,
    sourceWindowId,
    transitionReason: resumeFromCompactBoundaryId ? "verification_resume_boundary" : "verification_runtime_integrity",
  }, buildCognitiveStateDeps());
  const cognitiveTransition = buildCognitiveTransitionRecord(agent, previousCognitiveState, cognitiveState, {
    run: latestRun,
    queryState: null,
    driftCheck: null,
  });
  thoughtTrace.cognitiveStateId = cognitiveState.cognitiveStateId;
  thoughtTrace.compressedTrace.mode = cognitiveState.mode;
  thoughtTrace.compressedTrace.dominantStage = cognitiveState.dominantStage;
  const maintenance = runPassportMemoryMaintenanceCycle(store, agent, {
    currentGoal,
    cognitiveState,
    sourceWindowId,
    offlineReplayRequested: normalizeBooleanFlag(payload.offlineReplayRequested, false),
  });
  const stabilizedPreferenceWrites = stabilizeLongTermPreferences(store, agent, cognitiveState, {
    sourceWindowId,
  });
  const preferenceArbitration = arbitratePreferenceConflicts(store, agent, {
    sourceWindowId,
    currentGoal,
    cognitiveState,
  });
  const reflections = appendCognitiveReflections(store, [thoughtTrace, failureReflection]);
  const recoveryAction = executeRecoveryActionFromFailureReflection(store, agent, failureReflection, {
    didMethod: requestedDidMethod,
    currentGoal,
    sourceWindowId,
    run: latestRun,
    contextBuilder,
    resumeBoundaryId: resumeFromCompactBoundaryId,
  });
  if (!Array.isArray(store.cognitiveStates)) {
    store.cognitiveStates = [];
  }
  const existingCognitiveStateIndex = store.cognitiveStates.findIndex((state) => state.agentId === agent.agentId);
  if (existingCognitiveStateIndex >= 0) {
    store.cognitiveStates[existingCognitiveStateIndex] = cognitiveState;
  } else {
    store.cognitiveStates.push(cognitiveState);
  }
  if (!Array.isArray(store.cognitiveTransitions)) {
    store.cognitiveTransitions = [];
  }
  if (persist) {
    store.cognitiveTransitions.push(cognitiveTransition);
  }
  appendEvent(store, "cognitive_state_updated", {
    cognitiveStateId: cognitiveState.cognitiveStateId,
    transitionId: cognitiveTransition.transitionId,
    agentId: agent.agentId,
    mode: cognitiveState.mode,
    dominantStage: cognitiveState.dominantStage,
    transitionReason: cognitiveState.transitionReason,
    goalStateId: goalState?.goalStateId ?? null,
    retrievalFeedbackId: retrievalFeedback?.feedbackId ?? null,
    recoveryActionId: recoveryAction?.recoveryActionId ?? null,
    sourceWindowId,
  });

  const sessionState = upsertAgentSessionState(store, agent, {
    didMethod: requestedDidMethod,
    currentGoal,
    contextBuilder,
    run: latestRun,
    cognitiveState,
    compactBoundary: latestBoundary,
    resumeBoundaryId: resumeFromCompactBoundaryId,
    sourceWindowId,
    transitionReason: resumeFromCompactBoundaryId ? "verification_resume_boundary" : "verification_runtime_integrity",
  });

  if (persist) {
    await writeStore(store);
  }

  const capabilityBoundarySummary = buildExecutionCapabilityBoundarySummary({
    verification: adversarialVerification,
    recoveryAction,
    executionKind: "verification",
  });

  return {
    verificationRun: verificationRunView,
    integrityRun: verificationRunView,
    sessionState: buildAgentSessionStateView(sessionState),
    cognitiveState: buildAgentCognitiveStateView(cognitiveState),
    runtimeStateSummary: buildAgentCognitiveStateView(cognitiveState),
    cognitiveTransition: cloneJson(cognitiveTransition) ?? null,
    goalState: cloneJson(goalState) ?? null,
    selfEvaluation: cloneJson(selfEvaluation) ?? null,
    strategyProfile: cloneJson(strategyProfile) ?? null,
    retrievalFeedback: cloneJson(retrievalFeedback) ?? null,
    maintenance: {
      ...(cloneJson(maintenance) ?? {}),
      explicitPreferenceWriteCount: explicitPreferenceWrites.length,
      stabilizedPreferenceWriteCount: stabilizedPreferenceWrites.length,
      preferenceArbitrationCount: preferenceArbitration.resolvedConflictIds.length,
      recoveryActionId: recoveryAction?.recoveryActionId ?? null,
      reflectionCount: reflections.length,
    },
    recoveryAction: cloneJson(recoveryAction) ?? null,
    reflections: cloneJson(reflections) ?? [],
    capabilityBoundarySummary,
    contextBuilder,
    adversarialVerification,
    persisted: {
      verificationRun: persist,
    },
  };
  });
}

export async function executeAgentRunner(agentId, payload = {}, { didMethod = null, storeOverride = null } = {}) {
  if (!storeOverride && !storeMutationContext.getStore()?.active) {
    return queueStoreMutation(() => executeAgentRunner(agentId, payload, { didMethod, storeOverride: null }));
  }
  const runnerStartedAt = Date.now();
  const store =
    storeOverride && typeof storeOverride === "object"
      ? storeOverride
      : await loadStore();
  const agent = ensureAgent(store, agentId);
  const requestedDidMethod = normalizeDidMethod(didMethod || payload.didMethod) || null;
  const deviceRuntime = normalizeDeviceRuntime(store.deviceRuntime);
  const securityPosture = buildDeviceSecurityPostureState(deviceRuntime);
  const residentGate = buildResidentAgentGate(store, agent, { didMethod: requestedDidMethod });
  const previousSessionState = listAgentSessionStatesFromStore(store, agent.agentId).at(-1) ?? null;
  const previousRuntimeMemoryState =
    listRuntimeMemoryStatesFromStore(store, agent.agentId, RUNTIME_MEMORY_STORE_ADAPTER).at(-1) ?? null;
  const resumeFromCompactBoundaryId = normalizeOptionalText(payload.resumeFromCompactBoundaryId) ?? null;
  const allowBootstrapBypass = normalizeBooleanFlag(payload.allowBootstrapBypass, false);
  const recentConversationTurns = normalizeRunnerConversationTurns(payload);
  const toolResults = normalizeRunnerToolResults(payload);
  const userTurn = normalizeOptionalText(payload.userTurn || payload.input || payload.message) ?? null;
  const currentGoal =
    normalizeOptionalText(payload.currentGoal) ??
    latestAgentTaskSnapshot(store, agent.agentId)?.objective ??
    latestAgentTaskSnapshot(store, agent.agentId)?.title ??
    null;
  const sourceWindowId = normalizeOptionalText(payload.sourceWindowId || payload.recordedByWindowId) ?? null;
  const recordedByAgentId = agent.agentId;
  const recordedByWindowId = normalizeOptionalText(payload.recordedByWindowId || payload.sourceWindowId) ?? null;
  const autoCompact = normalizeBooleanFlag(payload.autoCompact, true);
  const persistRun = normalizeBooleanFlag(payload.persistRun, true);
  const writeConversationTurns = normalizeBooleanFlag(payload.writeConversationTurns, true);
  const storeToolResults = normalizeBooleanFlag(payload.storeToolResults, true);
  const memoryStabilityExplicitRequest = resolvePayloadOnlyMemoryStabilityExplicitRequest(payload);
  const memoryStabilityFormalExecutionReceipts = resolvePayloadMemoryStabilityFormalExecutionReceipts(payload);
  const memoryStabilityPreviewCreatedAt = resolvePayloadMemoryStabilityPreviewCreatedAt(payload);
  const autoRecoverRequested = normalizeBooleanFlag(payload.autoRecover, false);
  const recoveryAttempt = Math.max(0, Math.floor(toFiniteNumber(payload.recoveryAttempt, 0)));
  const maxRecoveryAttempts = Math.max(
    0,
    Math.min(4, Math.floor(toFiniteNumber(payload.maxRecoveryAttempts, DEFAULT_RUNNER_AUTO_RECOVERY_MAX_ATTEMPTS)))
  );
  const inheritedRecoveryChain = Array.isArray(payload.recoveryChain)
    ? (cloneJson(payload.recoveryChain) ?? []).filter(Boolean)
    : [];
  const recoveryVisitedBoundaryIds = normalizeTextList(payload.recoveryVisitedBoundaryIds);
  const willPersistRunnerState = persistRun || autoCompact || writeConversationTurns || storeToolResults;
  if (securityPosture.writeLocked && willPersistRunnerState) {
    const anomaly = recordSecurityAnomalyInStore(store, {
      category: "runtime",
      severity: securityPosture.mode === "panic" ? "critical" : "high",
      code: "runner_blocked_by_read_only_posture",
      message: `Runner blocked by security posture ${securityPosture.mode}`,
      actorAgentId: agent.agentId,
      actorWindowId: normalizeOptionalText(payload.sourceWindowId || payload.recordedByWindowId) ?? null,
      details: {
        persistRun,
        autoCompact,
        writeConversationTurns,
        storeToolResults,
        mode: securityPosture.mode,
      },
    }, { appendEvent });
    await writeStore(store);
    return attachAutoRecoveryState({
      run: null,
      status: "security_locked",
      securityPosture,
      anomaly,
      persisted: {
        run: false,
      },
    }, autoRecoverRequested
      ? {
          requested: true,
          enabled: maxRecoveryAttempts > 0,
          resumed: false,
          ready: false,
          attempt: recoveryAttempt,
          maxAttempts: maxRecoveryAttempts,
          status: "gated",
          summary: `自动恢复被安全姿态 ${securityPosture.mode} 拦截。`,
          gateReasons: [`security_posture_write_locked:${securityPosture.mode}`],
          dependencyWarnings: [],
          chain: inheritedRecoveryChain,
          finalRunId: null,
          finalStatus: "security_locked",
        }
      : buildDisabledAutoRecoveryState({
          recoveryAttempt,
          maxRecoveryAttempts,
          chain: inheritedRecoveryChain,
          finalStatus: "security_locked",
        }));
  }
  const negotiation = buildCommandNegotiationResult(store, agent, payload, {
    deviceRuntime,
    residentGate,
    currentGoal,
    userTurn,
  });
  emitRunnerTiming("negotiation_ready", runnerStartedAt, {
    decision: negotiation?.decision ?? null,
    riskTier: negotiation?.riskTier ?? null,
  });
  const bootstrapGatePreview =
    autoRecoverRequested && recoveryAttempt < maxRecoveryAttempts && !residentGate.required
      ? buildRuntimeBootstrapGatePreview(store, agent, { latestAgentTaskSnapshot })
      : null;
  const retryWithoutExecutionFastPathEligible =
    autoRecoverRequested &&
    recoveryAttempt < maxRecoveryAttempts &&
    !residentGate.required &&
    !bootstrapGatePreview?.required &&
    negotiation?.actionable &&
    negotiation?.decision === "blocked" &&
    Array.isArray(negotiation?.sandboxBlockedReasons) &&
    negotiation.sandboxBlockedReasons.length > 0;
  if (retryWithoutExecutionFastPathEligible) {
    const blockedRun = buildAgentRunnerRecord(store, agent, {
      didMethod: requestedDidMethod,
      currentDidMethod: null,
      resumeBoundaryId: resumeFromCompactBoundaryId,
      bootstrapGate: null,
      currentGoal,
      userTurn,
      candidateResponse: null,
      recentConversationTurns,
      toolResults,
      contextBuilder: null,
      driftCheck: null,
      verification: null,
      residentGate,
      negotiation,
      compaction: null,
      reasoner: null,
      sandboxExecution: buildBlockedRunnerSandboxExecution(payload, negotiation, null),
      checkpoint: null,
      sourceWindowId,
      recordedByAgentId,
      recordedByWindowId,
      checkpointDefaults: AGENT_RUN_CHECKPOINT_DEFAULTS,
    });
    const recoveryPlan = {
      action: "retry_without_execution",
      mode: "retry_without_execution",
      summary: "停止直接执行，转为非执行说明与下一步建议。",
    };
    const setupStatus = buildRunnerAutoRecoverySetupStatusSnapshot({
      deviceRuntime,
      bootstrapGate: null,
      securityPosture,
      formalRecoveryFlow: null,
      action: recoveryPlan.action,
    });
    const readiness = cloneJson(setupStatus.activePlanReadiness) ?? null;
    if (readiness?.ready) {
      const autoRecoveryGoal =
        currentGoal ??
        normalizeOptionalText(payload.query) ??
        userTurn ??
        null;
      const fallbackAutoRecovery = {
        requested: true,
        enabled: true,
        resumed: false,
        ready: true,
        attempt: recoveryAttempt,
        maxAttempts: maxRecoveryAttempts,
        plan: cloneJson(recoveryPlan),
        status: "planned",
        summary: recoveryPlan.summary,
        gateReasons: cloneJson(readiness.gateReasons) ?? [],
        dependencyWarnings: cloneJson(readiness.dependencyWarnings) ?? [],
        chain: [
          ...inheritedRecoveryChain,
          buildAutoRecoveryAttemptRecord({
            attempt: recoveryAttempt,
            run: blockedRun,
            recoveryAction: null,
          }),
        ],
        finalRunId: blockedRun.runId,
        finalStatus: blockedRun.status,
        finalVerification: null,
        setupStatus: {
          setupComplete: Boolean(setupStatus.setupComplete),
          missingRequiredCodes: cloneJson(setupStatus.missingRequiredCodes) ?? [],
          formalRecoveryFlow: null,
          automaticRecoveryReadiness: cloneJson(setupStatus.automaticRecoveryReadiness) ?? null,
          activePlanReadiness: cloneJson(setupStatus.activePlanReadiness) ?? null,
          source: setupStatus.source,
        },
      };
      const resumedRunner = await executeAgentRunner(
        agentId,
        buildAutoRecoveryResumePayload(payload, {
          autoRecover: true,
          recoveryAttempt: recoveryAttempt + 1,
          maxRecoveryAttempts,
          recoveryChain: fallbackAutoRecovery.chain,
          recoveryVisitedBoundaryIds,
          recoveryTriggeredByRunId: blockedRun.runId,
          recoveryTriggeredByActionId: null,
          currentGoal: autoRecoveryGoal,
          query: autoRecoveryGoal,
          autoCompact: false,
          persistRun: false,
          writeConversationTurns: false,
          storeToolResults: false,
          interactionMode: "conversation",
          executionMode: "discuss",
          requestedAction: null,
          commandText: null,
          requestedActionType: null,
          actionType: null,
          requestedCapability: null,
          capability: null,
          sandboxAction: null,
          targetResource: null,
          resource: null,
          resourceType: null,
          path: null,
          url: null,
          targetUrl: null,
          targetHost: null,
          host: null,
          networkHost: null,
          command: null,
          args: [],
          external: false,
          destructive: false,
          confirmExecution: false,
        }),
        { didMethod: requestedDidMethod, storeOverride: store }
      );
      const recursiveAutoRecovery =
        resumedRunner.autoRecovery && typeof resumedRunner.autoRecovery === "object"
          ? resumedRunner.autoRecovery
          : null;
      return mergeResumedAutoRecoveryResult(resumedRunner, {
        recursiveAutoRecovery,
        fallbackAutoRecovery,
        run: blockedRun,
        recoveryAction: null,
        readiness,
        inheritedRecoveryChain,
        recoveryAttempt,
        maxRecoveryAttempts,
        extra: {
          plan: cloneJson(recoveryPlan),
          setupStatus: cloneJson(fallbackAutoRecovery.setupStatus) ?? null,
        },
      });
    }
  }
  const memoryStabilityRuntime = await loadMemoryStabilityRuntimeGateRaw(process.env);
  const runnerRuntimeSnapshot = buildLightweightContextRuntimeSnapshot(store, agent, {
    didMethod: requestedDidMethod,
    memoryStabilityRuntime,
  });
  let contextBuilder = buildContextBuilderResult(store, agent, {
    didMethod: requestedDidMethod,
    resumeFromCompactBoundaryId,
    currentGoal,
    recentConversationTurns,
    toolResults,
    query: payload.query ?? currentGoal ?? userTurn ?? null,
    runtimeSnapshot: runnerRuntimeSnapshot,
    memoryStabilityRuntime,
  }, buildContextBuilderDeps());
  let runtimeMemoryState = contextBuilder?.memoryHomeostasis?.runtimeState
    ? normalizeRuntimeMemoryStateRecord(contextBuilder.memoryHomeostasis.runtimeState)
    : null;
  let runtimeMemoryCorrectionPlan =
    contextBuilder?.memoryHomeostasis?.correctionPlan && typeof contextBuilder.memoryHomeostasis.correctionPlan === "object"
      ? cloneJson(contextBuilder.memoryHomeostasis.correctionPlan)
      : null;
  const requestedRuntimeMemoryCorrectionPlan = runtimeMemoryCorrectionPlan
    ? cloneJson(runtimeMemoryCorrectionPlan)
    : null;
  let runtimeMemoryCorrectionApplied = false;
  let runtimeMemoryAppliedCorrectionPlan = null;
  let pendingProbeRuntimeMemoryObservation = null;
  let runtimeMemoryProbeBaselineState = runtimeMemoryState
    ? normalizeRuntimeMemoryStateRecord(runtimeMemoryState)
    : null;
  if (runtimeMemoryCorrectionPlan?.correctionLevel && runtimeMemoryCorrectionPlan.correctionLevel !== "none") {
    runtimeMemoryCorrectionApplied = true;
    runtimeMemoryAppliedCorrectionPlan = cloneJson(runtimeMemoryCorrectionPlan);
    contextBuilder = buildContextBuilderResult(store, agent, {
      didMethod: requestedDidMethod,
      resumeFromCompactBoundaryId,
      currentGoal,
      recentConversationTurns,
      toolResults,
      query: payload.query ?? currentGoal ?? userTurn ?? null,
      memoryHomeostasisPolicy: runtimeMemoryCorrectionPlan,
      runtimeSnapshot: runnerRuntimeSnapshot,
      memoryStabilityRuntime,
    }, buildContextBuilderDeps());
    runtimeMemoryState = contextBuilder?.memoryHomeostasis?.runtimeState
      ? normalizeRuntimeMemoryStateRecord(contextBuilder.memoryHomeostasis.runtimeState)
      : runtimeMemoryState;
    runtimeMemoryCorrectionPlan =
      contextBuilder?.memoryHomeostasis?.correctionPlan && typeof contextBuilder.memoryHomeostasis.correctionPlan === "object"
        ? cloneJson(contextBuilder.memoryHomeostasis.correctionPlan)
        : runtimeMemoryCorrectionPlan;
  }
  emitRunnerTiming("context_builder_ready", runnerStartedAt, {
    agentId: agent.agentId,
    promptChars: contextBuilder?.compiledPrompt?.length ?? 0,
  });
  const bootstrapGate = buildRuntimeBootstrapGate(store, agent, { contextBuilder });
  const reasonerPlan = resolveRunnerReasonerPlan(payload, deviceRuntime);
  const runnerLocalReasoner = mergeRunnerLocalReasonerOverride(
    resolveRunnerLocalReasonerConfig(store, deviceRuntime, reasonerPlan.effectiveProvider),
    payload,
    reasonerPlan.effectiveProvider
  );
  contextBuilder = await prepareMemoryStabilityPromptContext(contextBuilder, payload, {
    provider: reasonerPlan.effectiveProvider,
  });
  let memoryActiveProbe = null;
  if (runtimeMemoryState && shouldRunMemoryHomeostasisActiveProbe(runtimeMemoryState, previousRuntimeMemoryState)) {
    runtimeMemoryProbeBaselineState = normalizeRuntimeMemoryStateRecord(runtimeMemoryState);
    try {
      memoryActiveProbe = await runMemoryHomeostasisActiveProbe(contextBuilder, {
        deviceRuntime,
        reasonerProvider: reasonerPlan.effectiveProvider,
        localReasoner: runnerLocalReasoner,
        anchors: runtimeMemoryState.memoryAnchors,
      });
      if (memoryActiveProbe?.results?.length) {
        const probedAnchors = applyMemoryProbeResults(
          runtimeMemoryState.memoryAnchors,
          memoryActiveProbe.results,
          {
            verifiedAt: memoryActiveProbe.checkedAt,
          }
        );
        runtimeMemoryState = computeRuntimeMemoryHomeostasis({
          ...runtimeMemoryState,
          agentId: agent.agentId,
          modelName: runtimeMemoryState.modelName,
          memoryAnchors: probedAnchors,
          checkedMemories: probedAnchors.filter((anchor) => anchor.lastVerifiedOk != null).length,
          conflictMemories: probedAnchors.filter((anchor) => anchor.conflictState?.hasConflict === true).length,
          modelProfile: runtimeMemoryState.profile,
          contractRuntimeProfile: memoryStabilityRuntime?.ok === true ? memoryStabilityRuntime.profile : null,
          previousState: previousRuntimeMemoryState,
          triggerReason: "runtime_active_probe",
        });
        const syncedPostProbeMemoryHomeostasis = syncContextBuilderMemoryHomeostasisDerivedViews(contextBuilder, {
          runtimeState: runtimeMemoryState,
          modelProfile: runtimeMemoryState.profile,
        });
        runtimeMemoryState = syncedPostProbeMemoryHomeostasis?.runtimeState ?? runtimeMemoryState;
        const postProbeCorrectionPlan =
          syncedPostProbeMemoryHomeostasis?.correctionPlan ??
          buildMemoryCorrectionPlan({
            runtimeState: runtimeMemoryState,
            modelProfile: runtimeMemoryState.profile,
          });
        runtimeMemoryCorrectionPlan = cloneJson(postProbeCorrectionPlan);
        const appliedCorrectionSeverity = Math.max(
          getRuntimeMemoryObservationCorrectionSeverity(requestedRuntimeMemoryCorrectionPlan?.correctionLevel),
          getRuntimeMemoryObservationCorrectionSeverity(runtimeMemoryAppliedCorrectionPlan?.correctionLevel)
        );
        const postProbeCorrectionSeverity = getRuntimeMemoryObservationCorrectionSeverity(
          postProbeCorrectionPlan?.correctionLevel
        );
        const needsPostProbeCorrectionPass =
          postProbeCorrectionSeverity > 0 &&
          postProbeCorrectionSeverity > appliedCorrectionSeverity;
        if (needsPostProbeCorrectionPass) {
          pendingProbeRuntimeMemoryObservation = {
            runtimeState: cloneJson(runtimeMemoryState) ?? null,
            baselineState: cloneJson(runtimeMemoryProbeBaselineState) ?? null,
            plannedCorrectionLevel: postProbeCorrectionPlan?.correctionLevel ?? runtimeMemoryState?.correctionLevel ?? null,
            correctionActions: resolveRuntimeMemoryObservationCorrectionActions(
              postProbeCorrectionPlan?.actions,
              postProbeCorrectionPlan?.correctionLevel ?? runtimeMemoryState?.correctionLevel ?? null
            ),
            activeProbe: cloneJson(memoryActiveProbe) ?? null,
          };
          const appliedProbeCorrectionPlan = cloneJson(postProbeCorrectionPlan);
          contextBuilder = buildContextBuilderResult(store, agent, {
            didMethod: requestedDidMethod,
            resumeFromCompactBoundaryId,
            currentGoal,
            recentConversationTurns,
            toolResults,
            query: payload.query ?? currentGoal ?? userTurn ?? null,
            memoryHomeostasisPolicy: appliedProbeCorrectionPlan,
            runtimeSnapshot: runnerRuntimeSnapshot,
            memoryStabilityRuntime,
          }, buildContextBuilderDeps());
          runtimeMemoryState = contextBuilder?.memoryHomeostasis?.runtimeState
            ? normalizeRuntimeMemoryStateRecord(contextBuilder.memoryHomeostasis.runtimeState)
            : runtimeMemoryState;
          const syncedAppliedProbeMemoryHomeostasis = runtimeMemoryState
            ? syncContextBuilderMemoryHomeostasisDerivedViews(contextBuilder, {
                runtimeState: runtimeMemoryState,
                modelProfile: runtimeMemoryState.profile,
              })
            : null;
          runtimeMemoryState = syncedAppliedProbeMemoryHomeostasis?.runtimeState ?? runtimeMemoryState;
          runtimeMemoryCorrectionPlan = syncedAppliedProbeMemoryHomeostasis?.correctionPlan
            ? cloneJson(syncedAppliedProbeMemoryHomeostasis.correctionPlan)
            : contextBuilder?.memoryHomeostasis?.correctionPlan && typeof contextBuilder.memoryHomeostasis.correctionPlan === "object"
              ? cloneJson(contextBuilder.memoryHomeostasis.correctionPlan)
              : appliedProbeCorrectionPlan;
          runtimeMemoryCorrectionApplied = true;
          runtimeMemoryAppliedCorrectionPlan = appliedProbeCorrectionPlan;
        }
      }
    } catch (error) {
      memoryActiveProbe = {
        checkedAt: now(),
        error: error instanceof Error ? error.message : String(error),
        results: [],
      };
    }
  }
  contextBuilder = await prepareMemoryStabilityPromptContext(contextBuilder, payload, {
    provider: reasonerPlan.effectiveProvider,
  });
  const memoryStabilityRunnerGuard = await resolveExplicitMemoryStabilityRunnerGuard({
    contextBuilder,
    explicitRequest: memoryStabilityExplicitRequest,
    memoryStabilityRuntime,
    formalExecutionReceipts: memoryStabilityFormalExecutionReceipts,
    previewCreatedAt: memoryStabilityPreviewCreatedAt,
  });
  let reasoner = null;
  let candidateResponse = normalizeOptionalText(payload.candidateResponse || payload.responseText || payload.assistantResponse) ?? null;
  let verification = null;
  if (memoryStabilityRunnerGuard) {
    candidateResponse = null;
  } else if (!residentGate.required && (!bootstrapGate.required || allowBootstrapBypass)) {
    try {
      const reasonerResult = await generateAgentRunnerCandidateResponse({
        contextBuilder,
        payload: {
          ...payload,
          reasonerProvider: reasonerPlan.effectiveProvider ?? payload.reasonerProvider,
          localReasoner: cloneJson(runnerLocalReasoner) ?? null,
        },
      });
      reasoner = {
        provider: normalizeOptionalText(reasonerResult?.provider) ?? reasonerPlan.effectiveProvider ?? null,
        model: normalizeOptionalText(reasonerResult?.metadata?.model || reasonerResult?.model) ?? null,
        responseGenerated: (normalizeOptionalText(reasonerResult?.provider) ?? "passthrough") !== "passthrough",
        responseText: normalizeOptionalText(reasonerResult?.responseText) ?? null,
        metadata: {
          ...(cloneJson(reasonerResult?.metadata) ?? {}),
          ...buildRunnerReasonerPlanMetadata(reasonerPlan),
          ...buildRunnerReasonerDegradationMetadata(
            normalizeOptionalText(reasonerResult?.provider) ?? reasonerPlan.effectiveProvider ?? null
          ),
          ...buildRunnerAutoRecoveryFallbackMetadata(
            payload,
            normalizeOptionalText(reasonerResult?.provider) ?? reasonerPlan.effectiveProvider ?? null
          ),
        },
        error: null,
      };
      candidateResponse = reasoner.responseText ?? candidateResponse;
    } catch (error) {
      const initialError = error instanceof Error ? error.message : String(error);
      const fallbackProvider = normalizeOptionalText(reasonerPlan.fallbackProvider) ?? null;
      let fallbackResult = null;

      if (fallbackProvider) {
        const fallbackLocalReasoner = mergeRunnerLocalReasonerOverride(
          resolveRunnerLocalReasonerConfig(store, deviceRuntime, fallbackProvider),
          payload,
          fallbackProvider
        );
        try {
          fallbackResult = await generateAgentRunnerCandidateResponse({
            contextBuilder,
            payload: {
              ...payload,
              reasonerProvider: fallbackProvider,
              reasoner: {
                ...(cloneJson(payload.reasoner) ?? {}),
                provider: fallbackProvider,
              },
              localReasoner: cloneJson(fallbackLocalReasoner) ?? null,
            },
          });
        } catch (fallbackError) {
          reasoner = {
            provider:
              normalizeOptionalText(payload.reasonerProvider || payload.reasoner?.provider) ??
              (candidateResponse ? "passthrough" : null),
            model: null,
            responseGenerated: false,
            responseText: null,
          metadata: {
            ...buildRunnerReasonerPlanMetadata(reasonerPlan),
            ...buildRunnerReasonerDegradationMetadata(
              normalizeOptionalText(payload.reasonerProvider || payload.reasoner?.provider) ??
                (candidateResponse ? "passthrough" : null)
            ),
            ...buildRunnerAutoRecoveryFallbackMetadata(
              payload,
              normalizeOptionalText(payload.reasonerProvider || payload.reasoner?.provider) ??
                (candidateResponse ? "passthrough" : null)
            ),
            fallbackProvider,
            initialError,
            fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          },
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          };
        }
      } else {
        reasoner = {
          provider:
            normalizeOptionalText(payload.reasonerProvider || payload.reasoner?.provider) ??
            (candidateResponse ? "passthrough" : null),
          model: null,
          responseGenerated: false,
          responseText: null,
          metadata: {
            ...buildRunnerReasonerPlanMetadata(reasonerPlan),
            ...buildRunnerReasonerDegradationMetadata(
              normalizeOptionalText(payload.reasonerProvider || payload.reasoner?.provider) ??
                (candidateResponse ? "passthrough" : null)
            ),
            ...buildRunnerAutoRecoveryFallbackMetadata(
              payload,
              normalizeOptionalText(payload.reasonerProvider || payload.reasoner?.provider) ??
                (candidateResponse ? "passthrough" : null)
            ),
            fallbackProvider: null,
            initialError,
          },
          error: initialError,
        };
      }

      if (fallbackResult) {
        reasoner = {
          provider: normalizeOptionalText(fallbackResult?.provider) ?? fallbackProvider ?? DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
          model: normalizeOptionalText(fallbackResult?.metadata?.model || fallbackResult?.model) ?? null,
          responseGenerated: (normalizeOptionalText(fallbackResult?.provider) ?? "passthrough") !== "passthrough",
          responseText: normalizeOptionalText(fallbackResult?.responseText) ?? null,
          metadata: {
            ...(cloneJson(fallbackResult?.metadata) ?? {}),
            ...buildRunnerReasonerPlanMetadata(reasonerPlan),
            ...buildRunnerReasonerDegradationMetadata(
              normalizeOptionalText(fallbackResult?.provider) ?? fallbackProvider ?? DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER
            ),
            ...buildRunnerAutoRecoveryFallbackMetadata(
              payload,
              normalizeOptionalText(fallbackResult?.provider) ?? fallbackProvider ?? DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER
            ),
            fallbackProvider,
            fallbackActivated: true,
            initialError,
          },
          error: null,
        };
        candidateResponse = reasoner.responseText ?? candidateResponse;
      } else if (normalizeOptionalText(reasoner?.error)) {
        candidateResponse = null;
      }
    }
  } else {
    candidateResponse = null;
  }
  if (candidateResponse && reasoner && !normalizeOptionalText(reasoner?.error)) {
    const localVerification = buildResponseVerificationResult(
      store,
      agent,
      {
        responseText: candidateResponse,
        claims: cloneJson(payload.claims || {}),
        contextBuilder,
      },
      { didMethod: requestedDidMethod },
      buildResponseVerificationDeps()
    );
    const qualityEscalation = buildRunnerReasonerQualityEscalationDecision({
      reasonerPlan,
      reasoner,
      verification: localVerification,
      candidateResponse,
      runtimeMemoryState,
      runtimeMemoryCorrectionPlan,
      promptPreflight: contextBuilder?.memoryHomeostasis?.memoryStabilityPromptPreflight ?? null,
    });
    if (qualityEscalation.shouldEscalate) {
      try {
        const escalatedResult = await generateAgentRunnerCandidateResponse({
          contextBuilder,
          payload: {
            ...payload,
            reasonerProvider: qualityEscalation.provider,
            reasoner: {
              ...(cloneJson(payload.reasoner) ?? {}),
              provider: qualityEscalation.provider,
            },
            localReasoner: cloneJson(runnerLocalReasoner) ?? null,
          },
        });
        reasoner = {
          provider: normalizeOptionalText(escalatedResult?.provider) ?? qualityEscalation.provider,
          model: normalizeOptionalText(escalatedResult?.metadata?.model || escalatedResult?.model) ?? null,
          responseGenerated: (normalizeOptionalText(escalatedResult?.provider) ?? "passthrough") !== "passthrough",
          responseText: normalizeOptionalText(escalatedResult?.responseText) ?? null,
          metadata: {
            ...(cloneJson(escalatedResult?.metadata) ?? {}),
            ...buildRunnerReasonerPlanMetadata(reasonerPlan),
            ...buildRunnerReasonerDegradationMetadata(
              normalizeOptionalText(escalatedResult?.provider) ?? qualityEscalation.provider
            ),
            fallbackProvider: null,
            fallbackActivated: false,
            fallbackCause: null,
            qualityEscalationAttempted: true,
            qualityEscalationActivated: true,
            qualityEscalationProvider: qualityEscalation.provider,
            qualityEscalationReason: qualityEscalation.reason,
            qualityEscalationIssueCodes: qualityEscalation.issueCodes,
            qualityEscalationInitialProvider: qualityEscalation.initialProvider,
            qualityEscalationInitialModel:
              normalizeOptionalText(reasoner?.model || reasoner?.metadata?.model) ?? null,
            qualityEscalationInitialVerificationValid: localVerification.valid,
            memoryStabilityCorrectionLevel: qualityEscalation.memoryStability?.correctionLevel ?? null,
            memoryStabilityRiskScore: qualityEscalation.memoryStability?.cT ?? null,
            memoryStabilitySignalSource: qualityEscalation.memoryStability?.signalSource ?? null,
            memoryStabilityPreflightStatus: qualityEscalation.memoryStability?.preflightStatus ?? null,
          },
          error: null,
        };
        candidateResponse = reasoner.responseText ?? candidateResponse;
        verification = null;
      } catch (qualityEscalationError) {
        reasoner = {
          ...reasoner,
          metadata: {
            ...(cloneJson(reasoner?.metadata) ?? {}),
            ...buildRunnerReasonerPlanMetadata(reasonerPlan),
            ...buildRunnerReasonerDegradationMetadata(reasoner?.provider),
            qualityEscalationAttempted: true,
            qualityEscalationActivated: false,
            qualityEscalationProvider: qualityEscalation.provider,
            qualityEscalationReason: qualityEscalation.reason,
            qualityEscalationIssueCodes: qualityEscalation.issueCodes,
            qualityEscalationInitialProvider: qualityEscalation.initialProvider,
            qualityEscalationInitialModel:
              normalizeOptionalText(reasoner?.model || reasoner?.metadata?.model) ?? null,
            qualityEscalationInitialVerificationValid: localVerification.valid,
            memoryStabilityCorrectionLevel: qualityEscalation.memoryStability?.correctionLevel ?? null,
            memoryStabilityRiskScore: qualityEscalation.memoryStability?.cT ?? null,
            memoryStabilitySignalSource: qualityEscalation.memoryStability?.signalSource ?? null,
            memoryStabilityPreflightStatus: qualityEscalation.memoryStability?.preflightStatus ?? null,
            qualityEscalationError:
              qualityEscalationError instanceof Error
                ? qualityEscalationError.message
                : String(qualityEscalationError),
          },
        };
        verification = localVerification;
      }
    } else if (localVerification.valid === false) {
      reasoner = {
        ...reasoner,
        metadata: {
          ...(cloneJson(reasoner?.metadata) ?? {}),
          ...buildRunnerReasonerPlanMetadata(reasonerPlan),
          ...buildRunnerReasonerDegradationMetadata(reasoner?.provider),
          qualityEscalationAttempted: false,
          qualityEscalationActivated: false,
          qualityEscalationProvider: qualityEscalation.provider,
          qualityEscalationReason: qualityEscalation.reason,
          qualityEscalationIssueCodes: qualityEscalation.issueCodes,
          qualityEscalationInitialProvider: qualityEscalation.initialProvider,
          qualityEscalationInitialModel:
            normalizeOptionalText(reasoner?.model || reasoner?.metadata?.model) ?? null,
          qualityEscalationInitialVerificationValid: localVerification.valid,
          memoryStabilityCorrectionLevel: qualityEscalation.memoryStability?.correctionLevel ?? null,
          memoryStabilityRiskScore: qualityEscalation.memoryStability?.cT ?? null,
          memoryStabilitySignalSource: qualityEscalation.memoryStability?.signalSource ?? null,
          memoryStabilityPreflightStatus: qualityEscalation.memoryStability?.preflightStatus ?? null,
        },
      };
      verification = localVerification;
    } else {
      if (
        qualityEscalation.memoryStability?.correctionSeverity > 0 ||
        qualityEscalation.reason !== "verification_passed"
      ) {
        reasoner = {
          ...reasoner,
          metadata: {
            ...(cloneJson(reasoner?.metadata) ?? {}),
            ...buildRunnerReasonerPlanMetadata(reasonerPlan),
            ...buildRunnerReasonerDegradationMetadata(reasoner?.provider),
            qualityEscalationAttempted: false,
            qualityEscalationActivated: false,
            qualityEscalationProvider: qualityEscalation.provider,
            qualityEscalationReason: qualityEscalation.reason,
            qualityEscalationIssueCodes: qualityEscalation.issueCodes,
            qualityEscalationInitialProvider: qualityEscalation.initialProvider,
            qualityEscalationInitialModel:
              normalizeOptionalText(reasoner?.model || reasoner?.metadata?.model) ?? null,
            qualityEscalationInitialVerificationValid: localVerification.valid,
            memoryStabilityCorrectionLevel: qualityEscalation.memoryStability?.correctionLevel ?? null,
            memoryStabilityRiskScore: qualityEscalation.memoryStability?.cT ?? null,
            memoryStabilitySignalSource: qualityEscalation.memoryStability?.signalSource ?? null,
            memoryStabilityPreflightStatus: qualityEscalation.memoryStability?.preflightStatus ?? null,
          },
        };
      }
      verification = localVerification;
    }
  }
  emitRunnerTiming("reasoner_ready", runnerStartedAt, {
    provider: reasoner?.provider ?? null,
    hasCandidate: Boolean(candidateResponse),
    error: normalizeOptionalText(memoryStabilityRunnerGuard?.message) ?? normalizeOptionalText(reasoner?.error) ?? null,
  });
  if (runtimeMemoryState) {
    const resolvedRuntimeModelName = resolveActiveMemoryHomeostasisModelName(store, {
      reasoner,
      localReasoner: runnerLocalReasoner,
    });
    const resolvedContractRuntimeModelProfile = resolveMemoryStabilityRuntimeContractModelProfile(
      memoryStabilityRuntime,
      resolvedRuntimeModelName
    );
    const resolvedRuntimeModelProfile = resolveRuntimeMemoryHomeostasisProfile(store, {
      modelName: resolvedRuntimeModelName,
      runtimePolicy: contextBuilder?.runtimePolicy ?? null,
      contractProfile: resolvedContractRuntimeModelProfile,
    });
    runtimeMemoryState = computeRuntimeMemoryHomeostasis({
      ...runtimeMemoryState,
      agentId: agent.agentId,
      modelName: resolvedRuntimeModelName,
      modelProfile: resolvedRuntimeModelProfile,
      contractRuntimeProfile: memoryStabilityRuntime?.ok === true ? memoryStabilityRuntime.profile : null,
      previousState: previousRuntimeMemoryState,
      triggerReason:
        runtimeMemoryState?.triggerReason ??
        (runtimeMemoryCorrectionPlan?.correctionLevel && runtimeMemoryCorrectionPlan.correctionLevel !== "none"
        ? `runner_${runtimeMemoryCorrectionPlan.correctionLevel}_correction`
        : "runner_passive_monitor"),
    });
    const syncedResolvedMemoryHomeostasis = syncContextBuilderMemoryHomeostasisDerivedViews(contextBuilder, {
      runtimeState: runtimeMemoryState,
      modelProfile: resolvedRuntimeModelProfile,
    });
    runtimeMemoryState = syncedResolvedMemoryHomeostasis?.runtimeState ?? runtimeMemoryState;
    runtimeMemoryCorrectionPlan = syncedResolvedMemoryHomeostasis?.correctionPlan
      ? cloneJson(syncedResolvedMemoryHomeostasis.correctionPlan)
      : runtimeMemoryCorrectionPlan;
  }
  const driftCheck = buildAgentDriftCheck(
    store,
    agent,
    {
      currentGoal,
      workingSummary: normalizeOptionalText(payload.workingSummary) ?? candidateResponse ?? userTurn ?? null,
      nextAction: normalizeOptionalText(payload.nextAction) ?? null,
      turnCount:
        payload.turnCount != null
          ? Math.max(0, Math.floor(toFiniteNumber(payload.turnCount, 0)))
          : recentConversationTurns.length,
      estimatedContextChars:
        payload.estimatedContextChars != null
          ? Math.max(0, Math.floor(toFiniteNumber(payload.estimatedContextChars, 0)))
          : contextBuilder.compiledPrompt.length + (candidateResponse?.length || 0),
      estimatedContextTokens:
        payload.estimatedContextTokens != null
          ? Math.max(0, Math.floor(toFiniteNumber(payload.estimatedContextTokens, 0)))
          : (contextBuilder?.slots?.queryBudget?.estimatedContextTokens ?? estimatePromptTokens(contextBuilder.compiledPrompt)) +
            estimatePromptTokens(candidateResponse || ""),
      recentConversationTurnCount: recentConversationTurns.length,
      toolResultCount: toolResults.length,
      queryIteration: payload.queryIteration,
      referencedDecisionIds: payload.referencedDecisionIds ?? [],
      referencedEvidenceRefIds: payload.referencedEvidenceRefIds ?? [],
      resumeFromCompactBoundaryId,
      runtimeSnapshot: runnerRuntimeSnapshot,
      taskSnapshot: contextBuilder?.slots?.identitySnapshot?.taskSnapshot ?? null,
      runtimePolicy: contextBuilder?.runtimePolicy ?? null,
    },
    { didMethod: requestedDidMethod }
  );
  emitRunnerTiming("drift_check_ready", runnerStartedAt, {
    driftScore: driftCheck?.driftScore ?? null,
    requiresRehydrate: Boolean(driftCheck?.requiresRehydrate),
    requiresHumanReview: Boolean(driftCheck?.requiresHumanReview),
  });
  verification = candidateResponse
    ? verification ??
      buildResponseVerificationResult(
        store,
        agent,
        {
          responseText: candidateResponse,
          claims: cloneJson(payload.claims || {}),
          contextBuilder,
        },
        { didMethod: requestedDidMethod },
        buildResponseVerificationDeps()
      )
    : null;
  emitRunnerTiming("verification_ready", runnerStartedAt, {
    valid: verification?.valid ?? null,
  });

  let sandboxExecution = null;
  const runnerRequestedSandboxCapability =
    normalizeRuntimeCapability(payload?.sandboxAction?.capability) ??
    negotiation?.requestedCapability ??
    null;
  const sandboxEligible =
    !memoryStabilityRunnerGuard &&
    negotiation?.shouldExecute &&
    !residentGate.required &&
    (!bootstrapGate.required || allowBootstrapBypass) &&
    Boolean(runnerRequestedSandboxCapability);
  const driftBlocksSandbox =
    sandboxEligible &&
    (driftCheck?.requiresRehydrate || driftCheck?.requiresHumanReview);
  if (driftBlocksSandbox) {
    sandboxExecution = buildBlockedRunnerSandboxExecution(payload, negotiation, driftCheck);
  } else if (sandboxEligible) {
    try {
      sandboxExecution = await executeRuntimeSandboxActionFromStore(store, agent, payload, {
        didMethod: requestedDidMethod,
        sourceWindowId,
        recordedByAgentId,
        recordedByWindowId,
      });
    } catch (error) {
      sandboxExecution = {
        capability:
          normalizeRuntimeCapability(payload?.sandboxAction?.capability) ??
          negotiation?.requestedCapability ??
          null,
        executed: false,
        writeCount: 0,
        summary: "sandbox action failed",
        error: error instanceof Error ? error.message : String(error),
        output: null,
      };
    }
  }
  emitRunnerTiming("sandbox_ready", runnerStartedAt, {
    executed: Boolean(sandboxExecution?.executed),
    error: normalizeOptionalText(sandboxExecution?.error) ?? null,
  });

  const shouldCompact =
    autoCompact &&
    !memoryStabilityRunnerGuard &&
    !residentGate.required &&
    (!bootstrapGate.required || allowBootstrapBypass) &&
    !normalizeOptionalText(reasoner?.error) &&
    !normalizeOptionalText(sandboxExecution?.error) &&
    !driftCheck.requiresHumanReview &&
    (!candidateResponse || verification?.valid !== false);

  let compaction = null;
  let checkpoint = null;
  let compactBoundary = null;
  if (shouldCompact) {
    const writes = [];
    if (storeToolResults && toolResults.length > 0) {
      writes.push(
        ...buildToolResultPassportMemories(agent.agentId, toolResults, {
          sourceWindowId,
          recordedByAgentId,
          recordedByWindowId,
        })
      );
    }

    if (userTurn || candidateResponse) {
      writes.push(
        ...compactConversationToPassportMemories(store, agent, {
          turns: [
            ...(userTurn ? [{ role: "user", content: userTurn }] : []),
            ...(candidateResponse ? [{ role: "assistant", content: candidateResponse }] : []),
          ],
          writeConversationTurns,
          sourceWindowId,
          recordedByAgentId,
          recordedByWindowId,
        })
      );
    }

    for (const record of writes) {
      applyPassportMemorySupersession(store, agent.agentId, record);
      applyPassportMemoryConflictTracking(store, agent.agentId, record);
      store.passportMemories.push(record);
    }

    compaction = {
      compactedAt: now(),
      ...summarizePassportMemoryWrites(writes),
      writes: cloneJson(writes) ?? [],
    };

    if (writes.length > 0) {
      appendEvent(store, "agent_runner_compacted", {
        agentId: agent.agentId,
        writeCount: writes.length,
        sourceWindowId,
      });
    }

    checkpoint = buildWorkingMemoryCheckpoint(store, agent, {
      currentGoal,
      sourceWindowId,
      recordedByAgentId,
      recordedByWindowId,
      threshold: payload.workingCheckpointThreshold,
      retainCount: payload.workingRetainCount,
    });
  }
  emitRunnerTiming("compaction_ready", runnerStartedAt, {
    compacted: Boolean(compaction),
    checkpointTriggered: Boolean(checkpoint?.triggered),
  });

  const provisionalRun = buildAgentRunnerRecord(store, agent, {
    didMethod: requestedDidMethod,
    currentDidMethod: didMethodFromReference(contextBuilder?.slots?.identitySnapshot?.did),
    resumeBoundaryId: resumeFromCompactBoundaryId,
    bootstrapGate,
    currentGoal,
    userTurn,
    candidateResponse,
    recentConversationTurns,
    toolResults,
    contextBuilder,
    driftCheck,
    verification,
    residentGate,
    negotiation,
    compaction,
    reasoner,
    runnerGuard: memoryStabilityRunnerGuard,
    sandboxExecution,
    checkpoint,
    sourceWindowId,
    recordedByAgentId,
    recordedByWindowId,
    securityPosture,
    allowBootstrapBypass,
    checkpointDefaults: AGENT_RUN_CHECKPOINT_DEFAULTS,
  });
  const shouldPersistRunnerArtifacts =
    persistRun ||
    Number(compaction?.writeCount || 0) > 0 ||
    Number(sandboxExecution?.writeCount || 0) > 0 ||
    Boolean(checkpoint?.triggered);
  const queryState = buildAgentQueryStateRecord(store, agent, {
    didMethod: requestedDidMethod,
    currentDidMethod: didMethodFromReference(contextBuilder?.slots?.identitySnapshot?.did),
    currentGoal,
    userTurn,
    recentConversationTurns,
    toolResults,
    contextBuilder,
    driftCheck,
    bootstrapGate,
    residentGate,
    run: provisionalRun,
    negotiation,
    resumeBoundaryId: resumeFromCompactBoundaryId,
    sourceWindowId,
    previousQueryState: previousSessionState?.queryState ?? null,
    queryIteration: payload.queryIteration,
    allowBootstrapBypass,
    defaultMaxQueryIterations: DEFAULT_RUNTIME_QUERY_ITERATION_LIMIT,
  });
  const goalState = upsertAgentGoalState(
    store,
    buildGoalKeeperState(store, agent, {
      currentGoal,
      contextBuilder,
      queryState,
      driftCheck,
      negotiation,
      run: provisionalRun,
      sourceWindowId,
    }),
    { persist: shouldPersistRunnerArtifacts }
  );
  const selfEvaluation = buildSelfEvaluation({
    run: provisionalRun,
    driftCheck,
    verification,
    negotiation,
    contextBuilder,
  });
  const strategyProfile = resolveCognitiveStrategy({
    cognitiveMode: inferCognitiveMode({
      driftCheck,
      verification,
      residentGate,
      bootstrapGate,
      queryState,
    }),
    selfEvaluation,
    negotiation,
    driftCheck,
    goalState,
  });
  emitRunnerTiming("strategy_ready", runnerStartedAt, {
    strategyName: strategyProfile?.strategyName ?? null,
  });
  const retrievalFeedback = recordRetrievalFeedbackInStore(store, agent, {
    query: payload.query ?? currentGoal ?? userTurn ?? null,
    contextBuilder,
    sourceWindowId,
    persist: shouldPersistRunnerArtifacts,
  });
  emitRunnerTiming("retrieval_feedback_ready", runnerStartedAt, {
    hitCount: retrievalFeedback?.hitCount ?? null,
    recalledCount: retrievalFeedback?.recalledMemoryIds?.length ?? 0,
  });
  const explicitPreferences = extractExplicitPreferencesFromText(
    [userTurn, currentGoal].filter(Boolean).join("\n")
  );
  const explicitPreferenceWrites = shouldPersistRunnerArtifacts
    ? writeExplicitPreferenceMemories(store, agent, explicitPreferences, {
        sourceWindowId,
      })
    : [];
  emitRunnerTiming("explicit_preferences_ready", runnerStartedAt, {
    writeCount: explicitPreferenceWrites.length,
  });
  const run = buildAgentRunnerRecord(store, agent, {
    didMethod: requestedDidMethod,
    currentDidMethod: didMethodFromReference(contextBuilder?.slots?.identitySnapshot?.did),
    resumeBoundaryId: resumeFromCompactBoundaryId,
    bootstrapGate,
    currentGoal,
    userTurn,
    candidateResponse,
    recentConversationTurns,
    toolResults,
    contextBuilder,
    driftCheck,
    verification,
    queryState,
    residentGate,
    negotiation,
    compaction,
    reasoner,
    runnerGuard: memoryStabilityRunnerGuard,
    sandboxExecution,
    checkpoint,
    goalState,
    selfEvaluation,
    strategyProfile,
    sourceWindowId,
    recordedByAgentId,
    recordedByWindowId,
    allowBootstrapBypass,
    checkpointDefaults: AGENT_RUN_CHECKPOINT_DEFAULTS,
  });
  const shouldAttachRunnerMemoryStabilityPreview = shouldAttachMemoryStabilityKernelPreview(payload);
  let attachedMemoryStabilityPreview = null;
  let attachedMemoryStabilityRuntimeLoader = null;

  if (checkpoint?.triggered) {
    const previousCompactBoundary =
      findCompactBoundaryRecord(store, agent.agentId, resumeFromCompactBoundaryId) ??
      listAgentCompactBoundariesFromStore(store, agent.agentId).at(-1) ??
      null;
    compactBoundary = buildCompactBoundaryRecord(store, agent, {
      didMethod: requestedDidMethod,
      currentDidMethod: didMethodFromReference(contextBuilder?.slots?.identitySnapshot?.did),
      runId: run.runId,
      checkpoint,
      contextBuilder,
      resumeBoundaryId: resumeFromCompactBoundaryId,
      previousCompactBoundary,
      sourceWindowId,
    });
    if (compactBoundary) {
      if (!Array.isArray(store.compactBoundaries)) {
        store.compactBoundaries = [];
      }
      store.compactBoundaries.push(compactBoundary);
      appendEvent(store, "compact_boundary_created", {
        compactBoundaryId: compactBoundary.compactBoundaryId,
        previousCompactBoundaryId: compactBoundary.previousCompactBoundaryId,
        resumedFromCompactBoundaryId: compactBoundary.resumedFromCompactBoundaryId,
        checkpointMemoryId: compactBoundary.checkpointMemoryId,
        runId: run.runId,
        agentId: agent.agentId,
        sourceWindowId,
      });
    }
  }

  if (!Array.isArray(store.agentRuns)) {
    store.agentRuns = [];
  }
  if (!Array.isArray(store.agentQueryStates)) {
    store.agentQueryStates = [];
  }
  if (persistRun) {
    store.agentRuns.push(run);
    store.agentQueryStates.push(queryState);
  }

  const thoughtTrace = buildThoughtTraceRecord(agent, {
    goalState,
    run,
    queryState,
    cognitiveState: null,
    selfEvaluation,
    strategyProfile,
    sourceWindowId,
  });
  const failureReflection = buildFailureReflection(agent, {
    goalState,
    run,
    driftCheck,
    verification,
    negotiation,
    bootstrapGate,
    reasoner,
    sandboxExecution,
    strategyProfile,
    sourceWindowId,
  });
  const preferenceSignals = normalizeTextList([
    ...extractPreferenceSignalsFromText(userTurn),
    ...extractPreferenceSignalsFromText(currentGoal),
  ]);

  const previousCognitiveState = listAgentCognitiveStatesFromStore(store, agent.agentId).at(-1) ?? null;
  const cognitiveState = buildContinuousCognitiveState(store, agent, {
    didMethod: requestedDidMethod,
    contextBuilder,
    driftCheck,
    verification,
    residentGate,
    bootstrapGate,
    queryState,
    negotiation,
    preferenceSignals,
    run,
    goalState,
    selfEvaluation,
    strategyProfile,
    reflection: failureReflection ?? thoughtTrace,
    compactBoundary,
    sourceWindowId,
    transitionReason:
      bootstrapGate.required && !allowBootstrapBypass
        ? "runner_bootstrap_required"
        : resumeFromCompactBoundaryId
          ? `runner_resume_${run.status}`
          : `runner_${run.status}`,
  }, buildCognitiveStateDeps());
  emitRunnerTiming("cognitive_state_ready", runnerStartedAt, {
    mode: cognitiveState?.mode ?? null,
    dominantStage: cognitiveState?.dominantStage ?? null,
  });
  const cognitiveTransition = buildCognitiveTransitionRecord(agent, previousCognitiveState, cognitiveState, {
    run,
    queryState,
    driftCheck,
  });
  thoughtTrace.cognitiveStateId = cognitiveState.cognitiveStateId;
  thoughtTrace.compressedTrace.mode = cognitiveState.mode;
  thoughtTrace.compressedTrace.dominantStage = cognitiveState.dominantStage;
  const maintenance = shouldPersistRunnerArtifacts
    ? runPassportMemoryMaintenanceCycle(store, agent, {
        currentGoal,
        cognitiveState,
        sourceWindowId,
        offlineReplayRequested: normalizeBooleanFlag(payload.offlineReplayRequested, false),
      })
    : {};
  emitRunnerTiming("maintenance_ready", runnerStartedAt, {
    abstractedCount: maintenance?.abstractedMemoryIds?.length ?? 0,
    replayedCount: maintenance?.promotedMemoryIds?.length ?? 0,
  });
  const stabilizedPreferenceWrites = shouldPersistRunnerArtifacts
    ? stabilizeLongTermPreferences(store, agent, cognitiveState, {
        sourceWindowId,
      })
    : [];
  emitRunnerTiming("stabilized_preferences_ready", runnerStartedAt, {
    writeCount: stabilizedPreferenceWrites.length,
  });
  const preferenceArbitration = shouldPersistRunnerArtifacts
    ? arbitratePreferenceConflicts(store, agent, {
        sourceWindowId,
        currentGoal,
        cognitiveState,
      })
    : {
        resolvedConflictIds: [],
        reconciledWrites: [],
      };
  emitRunnerTiming("preference_arbitration_ready", runnerStartedAt, {
    resolvedCount: preferenceArbitration?.resolvedConflictIds?.length ?? 0,
  });
  const reflections = shouldPersistRunnerArtifacts
    ? appendCognitiveReflections(store, [thoughtTrace, failureReflection])
    : [thoughtTrace, failureReflection].filter(Boolean);
  emitRunnerTiming("reflections_ready", runnerStartedAt, {
    reflectionCount: reflections.length,
  });
  const recoveryAction = executeRecoveryActionFromFailureReflection(store, agent, failureReflection, {
    didMethod: requestedDidMethod,
    currentGoal,
    sourceWindowId,
    run,
    contextBuilder,
    compactBoundary,
    resumeBoundaryId: resumeFromCompactBoundaryId,
    persist: shouldPersistRunnerArtifacts,
  });
  emitRunnerTiming("recovery_action_ready", runnerStartedAt, {
    action: recoveryAction?.action ?? null,
  });
  const resolvedRuntimeMemoryCorrectionApplied = Boolean(
    runtimeMemoryCorrectionApplied ||
    contextBuilder?.memoryHomeostasis?.correctionApplied ||
    ((runtimeMemoryState?.triggerReason || "").includes("_correction"))
  );
  run.goalState = cloneJson(goalState) ?? null;
  run.selfEvaluation = cloneJson(selfEvaluation) ?? null;
  run.strategyProfile = cloneJson(strategyProfile) ?? null;
  run.memoryHomeostasis = {
    runtimeState: runtimeMemoryState ? buildRuntimeMemoryStateView(runtimeMemoryState) : null,
    correctionPlan: cloneJson(runtimeMemoryCorrectionPlan) ?? null,
    correctionApplied: resolvedRuntimeMemoryCorrectionApplied,
    probeObservationCaptured: Boolean(pendingProbeRuntimeMemoryObservation?.runtimeState),
    activeProbe: cloneJson(memoryActiveProbe) ?? null,
  };
  run.maintenance = {
    ...(cloneJson(maintenance) ?? {}),
    retrievalFeedbackId: retrievalFeedback?.feedbackId ?? null,
    explicitPreferenceWriteCount: explicitPreferenceWrites.length,
    stabilizedPreferenceWriteCount: stabilizedPreferenceWrites.length,
    preferenceArbitrationCount: preferenceArbitration.resolvedConflictIds.length,
    recoveryActionId: recoveryAction?.recoveryActionId ?? null,
    reflectionCount: reflections.length,
  };
  if (shouldPersistRunnerArtifacts) {
    if (!Array.isArray(store.cognitiveStates)) {
      store.cognitiveStates = [];
    }
    const existingCognitiveStateIndex = store.cognitiveStates.findIndex((state) => state.agentId === agent.agentId);
    if (existingCognitiveStateIndex >= 0) {
      store.cognitiveStates[existingCognitiveStateIndex] = cognitiveState;
    } else {
      store.cognitiveStates.push(cognitiveState);
    }
    if (!Array.isArray(store.cognitiveTransitions)) {
      store.cognitiveTransitions = [];
    }
    if (persistRun) {
      store.cognitiveTransitions.push(cognitiveTransition);
    }
    appendEvent(store, "cognitive_state_updated", {
      cognitiveStateId: cognitiveState.cognitiveStateId,
      transitionId: cognitiveTransition.transitionId,
      agentId: agent.agentId,
      mode: cognitiveState.mode,
      dominantStage: cognitiveState.dominantStage,
      continuityScore: cognitiveState.continuityScore,
      calibrationScore: cognitiveState.calibrationScore,
      recoveryReadinessScore: cognitiveState.recoveryReadinessScore,
      goalStateId: goalState?.goalStateId ?? null,
      retrievalFeedbackId: retrievalFeedback?.feedbackId ?? null,
      recoveryActionId: recoveryAction?.recoveryActionId ?? null,
      transitionReason: cognitiveState.transitionReason,
      sourceWindowId,
    });
  }

  const sessionState = upsertAgentSessionState(store, agent, {
    didMethod: requestedDidMethod,
    currentGoal,
    contextBuilder,
    driftCheck,
    run,
    queryState,
    negotiation,
    cognitiveState,
    compactBoundary,
    runtimeMemoryState,
    resumeBoundaryId: resumeFromCompactBoundaryId,
    sourceWindowId,
    transitionReason: bootstrapGate.required && !allowBootstrapBypass
      ? "runner_bootstrap_required"
      : resumeFromCompactBoundaryId
        ? `runner_resume_${run.status}`
        : null,
    persist: shouldPersistRunnerArtifacts,
  });
  emitRunnerTiming("session_state_ready", runnerStartedAt, {
    sessionStateId: sessionState?.sessionStateId ?? null,
  });
  if (shouldPersistRunnerArtifacts && pendingProbeRuntimeMemoryObservation?.runtimeState) {
    appendRuntimeMemoryObservation(store, pendingProbeRuntimeMemoryObservation.runtimeState, {
      previousState: previousRuntimeMemoryState,
      baselineState: pendingProbeRuntimeMemoryObservation.baselineState,
      sourceKind: "runner",
      requestedCorrectionLevel: requestedRuntimeMemoryCorrectionPlan?.correctionLevel ?? null,
      plannedCorrectionLevel:
        pendingProbeRuntimeMemoryObservation.plannedCorrectionLevel ??
        pendingProbeRuntimeMemoryObservation.runtimeState?.correctionLevel ??
        null,
      correctionActions:
        pendingProbeRuntimeMemoryObservation.correctionActions ??
        null,
      correctionRequested: true,
      correctionApplied: false,
      activeProbe: pendingProbeRuntimeMemoryObservation.activeProbe,
    });
  }
  const persistedRuntimeMemoryState = upsertRuntimeMemoryState(
    store,
    agent,
    runtimeMemoryState,
    {
      sessionId: sessionState?.sessionStateId ?? null,
      runId: run?.runId ?? null,
      sourceWindowId,
      persist: shouldPersistRunnerArtifacts,
      observationContext: {
        sourceKind: "runner",
        baselineState: runtimeMemoryProbeBaselineState,
        requestedCorrectionLevel: requestedRuntimeMemoryCorrectionPlan?.correctionLevel ?? null,
        plannedCorrectionLevel:
          runtimeMemoryCorrectionPlan?.correctionLevel ?? runtimeMemoryState?.correctionLevel ?? null,
        appliedCorrectionLevel: resolvedRuntimeMemoryCorrectionApplied
          ? runtimeMemoryAppliedCorrectionPlan?.correctionLevel ??
            runtimeMemoryCorrectionPlan?.correctionLevel ??
            runtimeMemoryState?.correctionLevel ??
            null
          : null,
        correctionActions: resolveRuntimeMemoryObservationCorrectionActions(
          runtimeMemoryAppliedCorrectionPlan?.actions ??
            runtimeMemoryCorrectionPlan?.actions,
          resolvedRuntimeMemoryCorrectionApplied
            ? runtimeMemoryAppliedCorrectionPlan?.correctionLevel ??
              runtimeMemoryCorrectionPlan?.correctionLevel ??
              runtimeMemoryState?.correctionLevel ??
              null
            : runtimeMemoryCorrectionPlan?.correctionLevel ?? runtimeMemoryState?.correctionLevel ?? null
        ),
        correctionRequested: Boolean(
          (requestedRuntimeMemoryCorrectionPlan?.correctionLevel && requestedRuntimeMemoryCorrectionPlan.correctionLevel !== "none") ||
          (runtimeMemoryAppliedCorrectionPlan?.correctionLevel && runtimeMemoryAppliedCorrectionPlan.correctionLevel !== "none") ||
          (runtimeMemoryCorrectionPlan?.correctionLevel && runtimeMemoryCorrectionPlan.correctionLevel !== "none")
        ),
        correctionApplied: resolvedRuntimeMemoryCorrectionApplied,
        activeProbe: memoryActiveProbe,
      },
    },
    RUNTIME_MEMORY_STORE_ADAPTER
  );
  if (persistedRuntimeMemoryState) {
    run.memoryHomeostasis.runtimeState = buildRuntimeMemoryStateView(persistedRuntimeMemoryState);
    if (shouldPersistRunnerArtifacts) {
      appendEvent(store, "runtime_memory_homeostasis_updated", {
        runtimeMemoryStateId: persistedRuntimeMemoryState.runtimeMemoryStateId,
        agentId: agent.agentId,
        sessionStateId: sessionState?.sessionStateId ?? null,
        runId: run?.runId ?? null,
        modelName: persistedRuntimeMemoryState.modelName,
        ctxTokens: persistedRuntimeMemoryState.ctxTokens,
        sT: persistedRuntimeMemoryState.sT,
        cT: persistedRuntimeMemoryState.cT,
        correctionLevel: persistedRuntimeMemoryState.correctionLevel,
        checkedMemories: persistedRuntimeMemoryState.checkedMemories,
        conflictMemories: persistedRuntimeMemoryState.conflictMemories,
        sourceWindowId,
      });
    }
  }

  if (shouldAttachRunnerMemoryStabilityPreview) {
    const attachedMemoryStability = await attachMemoryStabilityKernelPreview({
      payload,
      runtimeState: persistedRuntimeMemoryState || runtimeMemoryState,
      provider:
        reasonerPlan?.effectiveProvider ??
        reasoner?.provider ??
        deviceRuntime?.localReasoner?.activeProvider ??
        deviceRuntime?.localReasoner?.provider ??
        null,
      runId: run?.runId ?? null,
      generatedAt: memoryStabilityPreviewCreatedAt || run?.executedAt || now(),
      formalExecutionReceipts: memoryStabilityFormalExecutionReceipts,
    });
    attachedMemoryStabilityPreview = attachedMemoryStability.preview;
    attachedMemoryStabilityRuntimeLoader = attachedMemoryStability.runtimeLoader;
  }

  if (shouldPersistRunnerArtifacts) {
    appendEvent(store, "agent_runner_executed", {
      runId: run.runId,
      queryStateId: queryState.queryStateId,
      agentId: agent.agentId,
      didMethod: run.didMethod,
      status: run.status,
      resumeBoundaryId: resumeFromCompactBoundaryId,
      bootstrapRequired: bootstrapGate.required,
      residentLocked: residentGate.required,
      valid: verification?.valid ?? null,
      negotiationDecision: negotiation?.decision ?? null,
      shouldExecute: negotiation?.shouldExecute ?? null,
      sandboxCapability: sandboxExecution?.capability ?? null,
      sandboxExecuted: sandboxExecution?.executed ?? null,
      sandboxError: normalizeOptionalText(sandboxExecution?.error) ?? null,
      securityPostureMode: securityPosture.mode,
      reasonerProvider: reasoner?.provider ?? null,
      reasonerModel: reasoner?.model ?? null,
      reasonerError: normalizeOptionalText(reasoner?.error) ?? null,
      runnerGuardCode: memoryStabilityRunnerGuard?.code ?? null,
      runnerGuardBlockedBy: memoryStabilityRunnerGuard?.blockedBy ?? null,
      requiresRehydrate: driftCheck.requiresRehydrate,
      requiresHumanReview: driftCheck.requiresHumanReview,
      checkpointTriggered: Boolean(checkpoint?.triggered),
      memoryStabilityFormalExecutionStatus:
        normalizeOptionalText(attachedMemoryStabilityPreview?.formalExecutionConsume?.status) ??
        normalizeOptionalText(attachedMemoryStabilityPreview?.formalExecutionRequest?.status) ??
        null,
      memoryStabilityFormalExecutionReceiptCount:
        Math.max(
          0,
          Math.floor(
            toFiniteNumber(attachedMemoryStabilityPreview?.formalExecutionConsume?.receiptCount, 0)
          )
        ) || null,
      memoryStabilityFormalExecutionCheckpointId:
        normalizeOptionalText(attachedMemoryStabilityPreview?.formalExecutionConsume?.checkpointId) ??
        normalizeOptionalText(attachedMemoryStabilityPreview?.formalExecutionRequest?.execution?.checkpoint_id) ??
        null,
      sourceWindowId,
    });
  }

  if (persistRun) {
    const transcriptEntries = [];
    if (userTurn) {
      transcriptEntries.push({
        entryType: "user_turn",
        family: "conversation",
        role: "user",
        title: "Runner User Turn",
        summary: userTurn,
        content: userTurn,
        sourceWindowId,
        relatedRunId: run.runId,
        relatedQueryStateId: queryState.queryStateId,
      });
    }
    for (const toolResult of toolResults.slice(-4)) {
      transcriptEntries.push({
        entryType: "tool_result",
        family: "runtime",
        role: "tool",
        title: normalizeOptionalText(toolResult?.tool || toolResult?.name) ?? "Tool Result",
        summary: normalizeOptionalText(toolResult?.result || toolResult?.output || toolResult?.content || toolResult?.summary) ?? null,
        content: truncatePromptSection(toolResult, { maxChars: 1200, maxTokens: 180 }),
        sourceWindowId,
        relatedRunId: run.runId,
        relatedQueryStateId: queryState.queryStateId,
      });
    }
    transcriptEntries.push({
      entryType: "negotiation",
      family: "runtime",
      role: "system",
      title: "Runner Negotiation",
      summary: normalizeOptionalText(negotiation?.summary || negotiation?.decision || run.status) ?? run.status,
      content: truncatePromptSection(negotiation, { maxChars: 1200, maxTokens: 180 }),
      sourceWindowId,
      relatedRunId: run.runId,
      relatedQueryStateId: queryState.queryStateId,
    });
    if (candidateResponse) {
      transcriptEntries.push({
        entryType: "assistant_turn",
        family: "conversation",
        role: "assistant",
        title: "Runner Assistant Turn",
        summary: candidateResponse,
        content: candidateResponse,
        sourceWindowId,
        relatedRunId: run.runId,
        relatedQueryStateId: queryState.queryStateId,
      });
    }
    if (verification) {
      transcriptEntries.push({
        entryType: "verification",
        family: "runtime",
        role: "system",
        title: "Runner Verification",
        summary: verification.valid ? "verification passed" : "verification failed",
        content: truncatePromptSection(verification, { maxChars: 1200, maxTokens: 180 }),
        sourceWindowId,
        relatedRunId: run.runId,
        relatedQueryStateId: queryState.queryStateId,
        relatedVerificationRunId: verification.verificationRunId || null,
      });
    }
    if (checkpoint?.triggered) {
      transcriptEntries.push({
        entryType: "checkpoint",
        family: "runtime",
        role: "system",
        title: "Working Memory Checkpoint",
        summary: normalizeOptionalText(checkpoint?.summary) ?? "working memory checkpoint",
        content: truncatePromptSection(checkpoint, { maxChars: 1200, maxTokens: 180 }),
        sourceWindowId,
        relatedRunId: run.runId,
        relatedQueryStateId: queryState.queryStateId,
      });
    }
    if (compactBoundary) {
      transcriptEntries.push({
        entryType: "compact_boundary",
        family: "runtime",
        role: "system",
        title: "Compact Boundary",
        summary: normalizeOptionalText(compactBoundary.summary) ?? compactBoundary.compactBoundaryId,
        content: truncatePromptSection(compactBoundary, { maxChars: 1200, maxTokens: 180 }),
        sourceWindowId,
        relatedRunId: run.runId,
        relatedQueryStateId: queryState.queryStateId,
        relatedCompactBoundaryId: compactBoundary.compactBoundaryId,
      });
    }
    appendTranscriptEntries(store, agent.agentId, transcriptEntries);
    emitRunnerTiming("transcript_ready", runnerStartedAt, {
      entryCount: transcriptEntries.length,
    });
  }

  emitRunnerTiming("runner_complete", runnerStartedAt, {
    status: run?.status ?? null,
  });

  const capabilityBoundarySummary = buildExecutionCapabilityBoundarySummary({
    verification,
    recoveryAction,
    executionKind: "runtime",
  });
  const currentAttemptRecord = buildAutoRecoveryAttemptRecord({
    attempt: recoveryAttempt,
    run,
    recoveryAction,
  });
  const recoveryPlan = resolveAutomaticRecoveryPlan({
    run,
    recoveryAction,
    bootstrapGate,
    residentGate,
    reasoner,
    reasonerPlan,
    sandboxExecution,
    negotiation,
  });
  const baseResult = {
    run: buildAgentRunView(run),
    queryState: buildAgentQueryStateView(queryState),
    contextBuilder,
    reasoner,
    reasonerPlan,
    deviceRuntime: buildDeviceRuntimeView(deviceRuntime, store),
    residentGate,
    negotiation,
    driftCheck,
    bootstrapGate,
    verification,
    runtimeIntegrity: cloneJson(verification) ?? null,
    sandboxExecution,
    constrainedExecution: cloneJson(sandboxExecution) ?? null,
    compaction,
    checkpoint,
    compactBoundary: buildCompactBoundaryView(compactBoundary),
    sessionState: buildAgentSessionStateView(sessionState),
    cognitiveState: buildAgentCognitiveStateView(cognitiveState),
    runtimeStateSummary: buildAgentCognitiveStateView(cognitiveState),
    cognitiveTransition: cloneJson(cognitiveTransition) ?? null,
    goalState: cloneJson(goalState) ?? null,
    selfEvaluation: cloneJson(selfEvaluation) ?? null,
    strategyProfile: cloneJson(strategyProfile) ?? null,
    retrievalFeedback: cloneJson(retrievalFeedback) ?? null,
    maintenance: cloneJson(run.maintenance) ?? null,
    recoveryAction: cloneJson(recoveryAction) ?? null,
    reflections: cloneJson(reflections) ?? [],
    capabilityBoundarySummary,
    persisted: {
      run: persistRun,
      memoryWriteCount: shouldPersistRunnerArtifacts
        ? (
            (compaction?.writeCount ?? 0) +
            stabilizedPreferenceWrites.length +
            explicitPreferenceWrites.length +
            preferenceArbitration.reconciledWrites.length +
            (recoveryAction ? 1 : 0)
          )
        : 0,
    },
  };
  if (shouldAttachRunnerMemoryStabilityPreview) {
    if (baseResult.run && (!baseResult.run.memoryHomeostasis || typeof baseResult.run.memoryHomeostasis !== "object")) {
      baseResult.run.memoryHomeostasis = {};
    }
    if (baseResult.run?.memoryHomeostasis) {
      baseResult.run.memoryHomeostasis.memoryStabilityPreview = attachedMemoryStabilityPreview;
      baseResult.run.memoryHomeostasis.memoryStabilityFormalExecution =
        cloneJson(attachedMemoryStabilityPreview?.formalExecutionConsume) ??
        (
          attachedMemoryStabilityPreview?.formalExecutionRequest
            ? {
                completed: false,
                status: normalizeOptionalText(attachedMemoryStabilityPreview.formalExecutionRequest?.status) ?? null,
                requestId: normalizeOptionalText(attachedMemoryStabilityPreview.formalExecutionRequest?.request_id) ?? null,
                checkpointId:
                  normalizeOptionalText(
                    attachedMemoryStabilityPreview.formalExecutionRequest?.execution?.checkpoint_id
                  ) ?? null,
                adapterInvocationId:
                  normalizeOptionalText(
                    attachedMemoryStabilityPreview.formalExecutionRequest?.execution?.adapter_invocation_id
                  ) ?? null,
                receiptCount: 0,
              }
            : null
        );
    }
  }
  let autoRecovery = autoRecoverRequested
    ? {
        requested: true,
        enabled: maxRecoveryAttempts > 0,
        resumed: false,
        ready: null,
        attempt: recoveryAttempt,
        maxAttempts: maxRecoveryAttempts,
        plan: cloneJson(recoveryPlan) ?? null,
        status:
          recoveryAction?.action === "request_human_review"
            ? "human_review_required"
            : maxRecoveryAttempts === 0
              ? "disabled"
              : recoveryPlan
                ? "planned"
                : "not_needed",
        summary:
          recoveryAction?.action === "request_human_review"
            ? "当前恢复类型需要人工复核，自动恢复不会继续。"
            : maxRecoveryAttempts === 0
              ? "自动恢复已关闭。"
              : recoveryPlan
                ? (recoveryPlan.summary || "自动恢复已规划下一步。")
                : "本轮未触发自动恢复。",
        gateReasons: [],
        dependencyWarnings: [],
        chain: [...inheritedRecoveryChain, currentAttemptRecord],
        finalRunId: run?.runId ?? null,
        finalStatus: run?.status ?? null,
        finalVerification: cloneJson(verification) ?? null,
      }
    : buildDisabledAutoRecoveryState({
        recoveryAttempt,
        maxRecoveryAttempts,
        chain: [...inheritedRecoveryChain, currentAttemptRecord],
        finalRunId: run?.runId,
        finalStatus: run?.status,
        finalVerification: verification,
      });

  if (autoRecoverRequested && recoveryPlan) {
    const setupStatus = buildRunnerAutoRecoverySetupStatusSnapshot({
      deviceRuntime,
      bootstrapGate,
      securityPosture,
      formalRecoveryFlow: null,
      action: recoveryPlan.action,
    });
    const baseReadiness = cloneJson(setupStatus?.automaticRecoveryReadiness) ?? null;
    const readiness =
      cloneJson(setupStatus?.activePlanReadiness) ??
      buildPlanSpecificAutomaticRecoveryReadiness(baseReadiness, recoveryPlan.action);
    const autoRecoveryGoal =
      recoveryAction?.followup?.suggestedQuery ??
      currentGoal ??
      normalizeOptionalText(payload.query) ??
      userTurn ??
      null;
    const nextResumeBoundaryId =
      recoveryPlan.action === "reload_rehydrate_pack"
        ? (
            normalizeOptionalText(recoveryAction?.followup?.resumeBoundaryId) ??
            normalizeOptionalText(recoveryAction?.compactBoundaryId) ??
            normalizeOptionalText(compactBoundary?.compactBoundaryId) ??
            null
          )
        : null;
    autoRecovery = {
      ...autoRecovery,
      ready: readiness?.ready ?? false,
      gateReasons: cloneJson(readiness?.gateReasons) ?? [],
      dependencyWarnings: cloneJson(readiness?.dependencyWarnings) ?? [],
      setupStatus: {
        setupComplete: Boolean(setupStatus?.setupComplete),
        missingRequiredCodes: cloneJson(setupStatus?.missingRequiredCodes) ?? [],
        formalRecoveryFlow: cloneJson(setupStatus?.formalRecoveryFlow) ?? null,
        automaticRecoveryReadiness: baseReadiness,
        activePlanReadiness: readiness,
      },
    };

    if (!autoRecovery.enabled) {
      autoRecovery.status = "disabled";
      autoRecovery.summary = "自动恢复已关闭。";
    } else if (!readiness?.ready) {
      autoRecovery.status = "gated";
      autoRecovery.summary = readiness?.summary || "自动恢复当前被运行时门禁拦截。";
    } else if (recoveryAttempt >= maxRecoveryAttempts) {
      autoRecovery.status = "max_attempts_reached";
      autoRecovery.summary = `自动恢复已达到最大尝试次数 ${maxRecoveryAttempts}。`;
    } else if (recoveryPlan.action === "reload_rehydrate_pack" && !nextResumeBoundaryId) {
      autoRecovery.status = "resume_boundary_unavailable";
      autoRecovery.summary = "当前缺少可复用的 compact boundary，无法自动续跑。";
    } else if (
      recoveryPlan.action === "reload_rehydrate_pack" &&
      nextResumeBoundaryId &&
      recoveryVisitedBoundaryIds.includes(nextResumeBoundaryId)
    ) {
      autoRecovery.status = "loop_detected";
      autoRecovery.summary = "检测到重复 resume boundary，已停止自动续跑以避免循环。";
      autoRecovery.gateReasons = [...autoRecovery.gateReasons, `resume_boundary_reused:${nextResumeBoundaryId}`];
    } else {
      let resumedRunner = null;
      let planExtra = {
        plan: cloneJson(recoveryPlan) ?? null,
        setupStatus: cloneJson(autoRecovery.setupStatus) ?? null,
      };
      let planDependencyWarnings = [...(autoRecovery.dependencyWarnings || [])];

      try {
        if (recoveryPlan.action === "reload_rehydrate_pack") {
          resumedRunner = await executeAgentRunner(
            agentId,
            buildAutoRecoveryResumePayload(payload, {
              autoRecover: true,
              recoveryAttempt: recoveryAttempt + 1,
              maxRecoveryAttempts,
              recoveryChain: autoRecovery.chain,
              recoveryVisitedBoundaryIds: Array.from(
                new Set([...recoveryVisitedBoundaryIds, nextResumeBoundaryId].filter(Boolean))
              ),
              recoveryTriggeredByRunId: run?.runId ?? null,
              recoveryTriggeredByActionId: recoveryAction?.recoveryActionId ?? null,
              resumeFromCompactBoundaryId: nextResumeBoundaryId,
              currentGoal: autoRecoveryGoal,
              query: autoRecoveryGoal,
            }),
            { didMethod: requestedDidMethod, storeOverride: store }
          );
        } else if (recoveryPlan.action === "bootstrap_runtime") {
          const bootstrapResult = await bootstrapAgentRuntime(
            agentId,
            {
              currentGoal: autoRecoveryGoal,
              objective: autoRecoveryGoal,
              query: autoRecoveryGoal,
              sourceWindowId,
              updatedByAgentId: recordedByAgentId,
              updatedByWindowId: recordedByWindowId,
              recordedByAgentId,
              recordedByWindowId,
            },
            { didMethod: requestedDidMethod, store }
          );
          planExtra = {
            ...planExtra,
            bootstrap: cloneJson(bootstrapResult?.bootstrap) ?? null,
          };
          resumedRunner = await executeAgentRunner(
            agentId,
            buildAutoRecoveryResumePayload(payload, {
              autoRecover: true,
              recoveryAttempt: recoveryAttempt + 1,
              maxRecoveryAttempts,
              recoveryChain: autoRecovery.chain,
              recoveryVisitedBoundaryIds,
              recoveryTriggeredByRunId: run?.runId ?? null,
              recoveryTriggeredByActionId: recoveryAction?.recoveryActionId ?? null,
              currentGoal: autoRecoveryGoal,
              query: autoRecoveryGoal,
            }),
            { didMethod: requestedDidMethod, storeOverride: store }
          );
        } else if (recoveryPlan.action === "restore_local_reasoner") {
          let restoreResult = null;
          let fallbackToLocalMock = false;

          try {
            restoreResult = await restoreDeviceLocalReasonerWithStore(
              {
                dryRun: false,
                prewarm: true,
                sourceWindowId,
                recordedByAgentId,
                recordedByWindowId,
              },
              { store }
            );
          } catch (error) {
            fallbackToLocalMock = true;
            planDependencyWarnings = normalizeTextList([
              ...planDependencyWarnings,
              `restore_local_reasoner_failed:${error instanceof Error ? error.message : String(error)}`,
            ]);
          }

          const restoredProvider =
            normalizeRuntimeReasonerProvider(
              restoreResult?.deviceRuntime?.localReasoner?.activeProvider ||
              restoreResult?.deviceRuntime?.localReasoner?.provider
            ) ?? null;
          planExtra = {
            ...planExtra,
            reasonerRestore: cloneJson(restoreResult) ?? null,
            reasonerFallbackProvider: fallbackToLocalMock ? "local_mock" : restoredProvider,
          };
          resumedRunner = await executeAgentRunner(
            agentId,
            buildAutoRecoveryResumePayload(payload, {
              autoRecover: true,
              recoveryAttempt: recoveryAttempt + 1,
              maxRecoveryAttempts,
              recoveryChain: autoRecovery.chain,
              recoveryVisitedBoundaryIds,
              recoveryTriggeredByRunId: run?.runId ?? null,
              recoveryTriggeredByActionId: recoveryAction?.recoveryActionId ?? null,
              currentGoal: autoRecoveryGoal,
              query: autoRecoveryGoal,
              reasonerProvider:
                fallbackToLocalMock
                  ? "local_mock"
                  : restoredProvider ?? reasonerPlan?.effectiveProvider ?? payload.reasonerProvider,
              autoRecoveryResumeAction: "restore_local_reasoner",
              autoRecoveryFallbackActivated: fallbackToLocalMock,
              autoRecoveryFallbackProvider: fallbackToLocalMock ? "local_mock" : null,
              autoRecoveryFallbackCause: fallbackToLocalMock ? "restore_local_reasoner_failed" : null,
              reasoner:
                fallbackToLocalMock
                  ? {
                      ...(cloneJson(payload.reasoner) ?? {}),
                      provider: "local_mock",
                    }
                  : payload.reasoner,
              localReasoner:
                fallbackToLocalMock
                  ? {
                      enabled: true,
                      provider: "local_mock",
                      model: "agent-passport-local-mock",
                    }
                  : undefined,
            }),
            { didMethod: requestedDidMethod, storeOverride: store }
          );
        } else if (recoveryPlan.action === "retry_without_execution") {
          resumedRunner = await executeAgentRunner(
            agentId,
            buildAutoRecoveryResumePayload(payload, {
              autoRecover: true,
              recoveryAttempt: recoveryAttempt + 1,
              maxRecoveryAttempts,
              recoveryChain: autoRecovery.chain,
              recoveryVisitedBoundaryIds,
              recoveryTriggeredByRunId: run?.runId ?? null,
              recoveryTriggeredByActionId: recoveryAction?.recoveryActionId ?? null,
              currentGoal: autoRecoveryGoal,
              query: autoRecoveryGoal,
              autoCompact: false,
              persistRun: false,
              writeConversationTurns: false,
              storeToolResults: false,
              interactionMode: "conversation",
              executionMode: "discuss",
              requestedAction: null,
              commandText: null,
              requestedActionType: null,
              actionType: null,
              requestedCapability: null,
              capability: null,
              sandboxAction: null,
              targetResource: null,
              resource: null,
              resourceType: null,
              path: null,
              url: null,
              targetUrl: null,
              targetHost: null,
              host: null,
              networkHost: null,
              command: null,
              args: [],
              external: false,
              destructive: false,
              confirmExecution: false,
            }),
            { didMethod: requestedDidMethod, storeOverride: store }
          );
        }
      } catch (error) {
        autoRecovery.status = "failed";
        autoRecovery.summary = `自动恢复执行失败：${error instanceof Error ? error.message : String(error)}`;
        autoRecovery.error = error instanceof Error ? error.message : String(error);
        autoRecovery.dependencyWarnings = normalizeTextList([
          ...planDependencyWarnings,
          `auto_recovery_plan_failed:${recoveryPlan.action}`,
        ]);
      }

      if (resumedRunner) {
        const recursiveAutoRecovery =
          resumedRunner.autoRecovery && typeof resumedRunner.autoRecovery === "object"
            ? resumedRunner.autoRecovery
            : null;
        const fallbackAutoRecovery = {
          ...(cloneJson(autoRecovery) ?? {}),
          dependencyWarnings: normalizeTextList(planDependencyWarnings),
        };
        const finalResult = mergeResumedAutoRecoveryResult(resumedRunner, {
          recursiveAutoRecovery,
          fallbackAutoRecovery,
          run,
          recoveryAction,
          readiness,
          inheritedRecoveryChain,
          recoveryAttempt,
          maxRecoveryAttempts,
          extra: planExtra,
        });
        const inlineAutoRecoveryAudit =
          persistRun &&
          normalizeOptionalText(finalResult?.run?.runId) === normalizeOptionalText(run.runId)
            ? applyAgentRunnerAutoRecoveryAuditToStore(store, {
                agentId: agent.agentId,
                runId: run.runId,
                autoRecovery: finalResult.autoRecovery,
                sourceWindowId,
              })
            : null;
        if (inlineAutoRecoveryAudit?.run) {
          finalResult.run = inlineAutoRecoveryAudit.run;
        }
        if (
          persistRun &&
          normalizeOptionalText(finalResult?.run?.runId) === normalizeOptionalText(run.runId) &&
          !inlineAutoRecoveryAudit
        ) {
          await persistAgentRunnerAutoRecoveryAudit({
            agentId: agent.agentId,
            runId: run.runId,
            autoRecovery: finalResult.autoRecovery,
            sourceWindowId,
          });
        }
        return finalResult;
      }
    }
  }

  const finalResult = attachAutoRecoveryState(baseResult, autoRecovery);
  const inlineAutoRecoveryAudit = persistRun
    ? applyAgentRunnerAutoRecoveryAuditToStore(store, {
        agentId: agent.agentId,
        runId: run.runId,
        autoRecovery: finalResult.autoRecovery,
        sourceWindowId,
      })
    : null;
  if (inlineAutoRecoveryAudit?.run) {
    finalResult.run = inlineAutoRecoveryAudit.run;
  }
  if (shouldPersistRunnerArtifacts) {
    await writeStore(store, { archiveColdData: false });
    emitRunnerTiming("store_written", runnerStartedAt, {
      persistRun,
      cognitiveStatePersisted: shouldPersistRunnerArtifacts,
      compactionWriteCount: Number(compaction?.writeCount || 0),
      sandboxWriteCount: Number(sandboxExecution?.writeCount || 0),
      checkpointTriggered: Boolean(checkpoint?.triggered),
    });
  }
  if (persistRun && !inlineAutoRecoveryAudit) {
    await persistAgentRunnerAutoRecoveryAudit({
      agentId: agent.agentId,
      runId: run.runId,
      autoRecovery: finalResult.autoRecovery,
      sourceWindowId,
    });
  }
  return finalResult;
}

export async function getAgentRehydratePack(agentId, options = {}) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  return buildAgentRehydratePack(store, agent, options);
}

export async function checkAgentContextDrift(agentId, payload = {}, { didMethod = null } = {}) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  return buildAgentDriftCheck(store, agent, payload, { didMethod });
}

export async function routeMessage(toAgentId, payload = {}, { trustExplicitSender = false } = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const target = ensureAgent(store, toAgentId);
    const fromWindowId = trustExplicitSender
      ? normalizeOptionalText(payload.fromWindowId) ?? null
      : null;
    const fromAgentId = trustExplicitSender
      ? normalizeOptionalText(payload.fromAgentId) ?? null
      : null;
    const content = normalizeOptionalText(payload.content);
    if (!content) {
      throw new Error("content is required");
    }

    const sourceWindow = fromWindowId ? store.windows[fromWindowId] : null;
    const resolvedFromAgentId = fromAgentId ?? sourceWindow?.agentId ?? null;
    if (trustExplicitSender && fromWindowId && !sourceWindow) {
      throw new Error(`Unknown window ${fromWindowId}`);
    }
    if (trustExplicitSender && !resolvedFromAgentId) {
      throw new Error("fromAgentId or fromWindowId is required");
    }
    const sender = resolvedFromAgentId ? ensureAgent(store, resolvedFromAgentId) : null;
    if (fromWindowId && sourceWindow && sender && sourceWindow.agentId !== sender.agentId) {
      throw new Error(`Window ${fromWindowId} is not linked to agent ${sender.agentId}`);
    }

    const nowIso = now();
    const message = {
      messageId: createRecordId("msg"),
      kind: normalizeOptionalText(payload.kind) ?? "message",
      fromWindowId: sender ? fromWindowId ?? sourceWindow?.windowId ?? null : null,
      fromAgentId: sender?.agentId ?? null,
      toAgentId: target.agentId,
      subject: normalizeOptionalText(payload.subject) ?? null,
      content,
      tags: normalizeTextList(payload.tags),
      metadata: cloneJson(payload.metadata) ?? {},
      status: "delivered",
      createdAt: nowIso,
      deliveredAt: nowIso,
      readAt: null,
    };

    store.messages.push(message);
    if (sender) {
      appendTranscriptEntries(store, sender.agentId, [
        {
          entryType: "message_outbox",
          family: "conversation",
          role: "assistant",
          title: normalizeOptionalText(message.subject) ?? "Outbound Message",
          summary: message.content,
          content: message.content,
          sourceWindowId: message.fromWindowId,
          sourceMessageId: message.messageId,
        },
      ]);
    }
    appendTranscriptEntries(store, target.agentId, [
      {
        entryType: "message_inbox",
        family: "conversation",
        role: "user",
        title: normalizeOptionalText(message.subject) ?? "Inbound Message",
        summary: message.content,
        content: message.content,
        sourceWindowId: message.fromWindowId,
        sourceMessageId: message.messageId,
      },
    ]);
    if (message.fromWindowId && store.windows[message.fromWindowId]) {
      store.windows[message.fromWindowId].lastSeenAt = nowIso;
    }

    appendEvent(store, "message_routed", {
      messageId: message.messageId,
      fromWindowId: message.fromWindowId,
      fromAgentId: message.fromAgentId,
      toAgentId: message.toAgentId,
      kind: message.kind,
    });

    await writeStore(store);
    return message;
  });
}

export async function listMessages(agentId, limit = DEFAULT_MESSAGE_LIMIT) {
  const store = await loadStore();
  ensureAgent(store, agentId);
  const inbox = listAgentInbox(store, agentId);
  const outbox = listAgentOutbox(store, agentId);
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_MESSAGE_LIMIT;

  return {
    inbox: inbox.slice(-cappedLimit),
    outbox: outbox.slice(-cappedLimit),
  };
}

export async function compareAgents({
  leftAgentId = null,
  rightAgentId = null,
  leftDid = null,
  rightDid = null,
  leftWalletAddress = null,
  rightWalletAddress = null,
  leftWindowId = null,
  rightWindowId = null,
  messageLimit = DEFAULT_MESSAGE_LIMIT,
  memoryLimit = DEFAULT_MEMORY_LIMIT,
  authorizationLimit = DEFAULT_AUTHORIZATION_LIMIT,
  credentialLimit = DEFAULT_CREDENTIAL_LIMIT,
  summaryOnly = false,
} = {}) {
  const store = await loadStore();
  return buildAgentComparisonExport(store, {
    leftAgentId,
    rightAgentId,
    leftDid,
    rightDid,
    leftWalletAddress,
    rightWalletAddress,
    leftWindowId,
    rightWindowId,
    messageLimit,
    memoryLimit,
    authorizationLimit,
    credentialLimit,
    summaryOnly,
  });
}

export async function getAgentComparisonEvidence({
  leftAgentId = null,
  rightAgentId = null,
  leftDid = null,
  rightDid = null,
  leftWalletAddress = null,
  rightWalletAddress = null,
  leftWindowId = null,
  rightWindowId = null,
  issuerAgentId = AGENT_PASSPORT_MAIN_AGENT_ID,
  issuerDid = null,
  issuerDidMethod = null,
  issuerWalletAddress = null,
  messageLimit = DEFAULT_MESSAGE_LIMIT,
  memoryLimit = DEFAULT_MEMORY_LIMIT,
  authorizationLimit = DEFAULT_AUTHORIZATION_LIMIT,
  credentialLimit = DEFAULT_CREDENTIAL_LIMIT,
  summaryOnly = false,
  persist = false,
  issueBothMethods = false,
} = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const { result, createdAny } = buildAgentComparisonEvidenceExport(store, {
      leftAgentId,
      rightAgentId,
      leftDid,
      rightDid,
      leftWalletAddress,
      rightWalletAddress,
      leftWindowId,
      rightWindowId,
      issuerAgentId,
      issuerDid,
      issuerDidMethod,
      issuerWalletAddress,
      messageLimit,
      memoryLimit,
      authorizationLimit,
      credentialLimit,
      summaryOnly,
      persist,
      issueBothMethods,
    });
    if (createdAny) {
      await writeStore(store);
    }
    return result;
  });
}

export async function listAgentComparisonAudits({
  leftAgentId = null,
  rightAgentId = null,
  leftDid = null,
  rightDid = null,
  leftWalletAddress = null,
  rightWalletAddress = null,
  leftWindowId = null,
  rightWindowId = null,
  issuerAgentId = null,
  issuerDid = null,
  didMethod = null,
  status = null,
  limit = DEFAULT_CREDENTIAL_LIMIT,
} = {}) {
  const store = await loadStore();
  return listAgentComparisonAuditViews(store, {
    leftAgentId,
    rightAgentId,
    leftDid,
    rightDid,
    leftWalletAddress,
    rightWalletAddress,
    leftWindowId,
    rightWindowId,
    issuerAgentId,
    issuerDid,
    didMethod,
    status,
    limit,
  });
}

export async function repairAgentComparisonMigration({
  comparisonPairs = null,
  leftAgentId = null,
  rightAgentId = null,
  leftDid = null,
  rightDid = null,
  leftWalletAddress = null,
  rightWalletAddress = null,
  leftWindowId = null,
  rightWindowId = null,
  issuerAgentId = AGENT_PASSPORT_MAIN_AGENT_ID,
  issuerDid = null,
  issuerDidMethod = null,
  issuerWalletAddress = null,
  didMethods = null,
  limit = DEFAULT_CREDENTIAL_LIMIT,
  dryRun = false,
  receiptDidMethod = null,
  issueBothMethods = false,
} = {}) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const { repair, createdAny } = runAgentComparisonMigrationRepair(store, {
      comparisonPairs,
      leftAgentId,
      rightAgentId,
      leftDid,
      rightDid,
      leftWalletAddress,
      rightWalletAddress,
      leftWindowId,
      rightWindowId,
      issuerAgentId,
      issuerDid,
      issuerDidMethod,
      issuerWalletAddress,
      didMethods,
      limit,
      dryRun,
      receiptDidMethod,
      issueBothMethods,
    }, CREDENTIAL_REPAIR_RUNNER_DEPS);
    if (createdAny) {
      await writeStore(store);
    }
    return repair;
  });
}

export async function getAgentContext(
  agentId,
  {
    didMethod = null,
    runtimeLimit = DEFAULT_RUNTIME_LIMIT,
    messageLimit = DEFAULT_MESSAGE_LIMIT,
    memoryLimit = DEFAULT_MEMORY_LIMIT,
    authorizationLimit = DEFAULT_AUTHORIZATION_LIMIT,
    credentialLimit = DEFAULT_CREDENTIAL_LIMIT,
    lightweight = false,
    includeRehydratePreview = !lightweight,
  } = {}
) {
  const store = await loadStore();
  const agent = ensureAgent(store, agentId);
  const normalizedDidMethod = normalizeDidMethod(didMethod) || null;
  const cacheKey = hashJson({
    kind: "agent_context",
    fingerprint: buildAgentContextPerformanceFingerprint(store, agent.agentId),
    agentId: agent.agentId,
    didMethod: normalizedDidMethod,
    runtimeLimit,
    messageLimit,
    memoryLimit,
    authorizationLimit,
    credentialLimit,
    lightweight: Boolean(lightweight),
    includeRehydratePreview: Boolean(includeRehydratePreview),
  });
  const cachedContext = getCachedTimedSnapshot(
    AGENT_CONTEXT_CACHE,
    cacheKey,
    DEFAULT_RUNTIME_SUMMARY_CACHE_TTL_MS
  );
  if (cachedContext) {
    return cachedContext;
  }
  const context = buildAgentContextSnapshot(store, agent, {
    didMethod,
    runtimeLimit,
    messageLimit,
    memoryLimit,
    authorizationLimit,
    credentialLimit,
    lightweight,
    includeRehydratePreview,
  });
  setCachedTimedSnapshot(AGENT_CONTEXT_CACHE, cacheKey, context);
  return context;
}

export async function repairAgentCredentialMigration(
  agentId,
  {
    dryRun = false,
    kinds = null,
    subjectIds = null,
    comparisonPairs = null,
    didMethods = null,
    limit = DEFAULT_CREDENTIAL_LIMIT,
    includeComparison = true,
    receiptDidMethod = null,
    issueBothMethods = false,
  } = {}
) {
  return queueStoreMutation(async () => {
    const store = await loadStore();
    const { repair, createdAny } = runAgentCredentialMigrationRepair(store, agentId, {
      dryRun,
      kinds,
      subjectIds,
      comparisonPairs,
      didMethods,
      limit,
      includeComparison,
      receiptDidMethod,
      issueBothMethods,
    }, CREDENTIAL_REPAIR_RUNNER_DEPS);
    if (createdAny) {
      await writeStore(store);
    }
    return repair;
  });
}

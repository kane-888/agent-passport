import {
  cloneJson,
  createRecordId,
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import { normalizeRuntimeReasonerProvider } from "./ledger-device-runtime.js";
import { normalizeDidMethod } from "./protocol.js";

const AGENT_RUN_STATUSES = new Set([
  "prepared",
  "completed",
  "blocked",
  "rehydrate_required",
  "needs_human_review",
  "bootstrap_required",
  "resident_locked",
  "negotiation_required",
]);

const DEFAULT_CHECKPOINT_THRESHOLD = 12;
const DEFAULT_CHECKPOINT_RETAIN_COUNT = 6;

function clampMemoryHomeostasisMetric(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, toFiniteNumber(value, minimum)));
}

function normalizeRuntimeMemoryObservationCorrectionLevel(value = null) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (["strong", "severe", "critical", "level_3", "level3", "3"].includes(normalized)) {
    return "strong";
  }
  if (["medium", "moderate", "level_2", "level2", "2"].includes(normalized)) {
    return "medium";
  }
  if (["light", "minor", "level_1", "level1", "1"].includes(normalized)) {
    return "light";
  }
  return "none";
}

function resolveCheckpointDefaults(checkpointDefaults = null) {
  return {
    threshold: checkpointDefaults?.threshold ?? DEFAULT_CHECKPOINT_THRESHOLD,
    retainCount: checkpointDefaults?.retainCount ?? DEFAULT_CHECKPOINT_RETAIN_COUNT,
  };
}

export function normalizeAgentRunStatus(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  return normalized && AGENT_RUN_STATUSES.has(normalized) ? normalized : "prepared";
}

export function buildAgentRunView(run) {
  return cloneJson(run) ?? null;
}

export function buildStoredRunnerReasonerMetadata(metadata = null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const stored = {
    requestedProvider: normalizeRuntimeReasonerProvider(metadata.requestedProvider) ?? null,
    effectiveProvider: normalizeRuntimeReasonerProvider(metadata.effectiveProvider) ?? null,
    fallbackProvider: normalizeRuntimeReasonerProvider(metadata.fallbackProvider) ?? null,
    fallbackActivated:
      metadata.fallbackActivated == null ? null : normalizeBooleanFlag(metadata.fallbackActivated, false),
    fallbackCause: normalizeOptionalText(metadata.fallbackCause) ?? null,
    degradedLocalFallback:
      metadata.degradedLocalFallback == null
        ? null
        : normalizeBooleanFlag(metadata.degradedLocalFallback, false),
    degradedLocalFallbackReason: normalizeOptionalText(metadata.degradedLocalFallbackReason) ?? null,
    initialError: normalizeOptionalText(metadata.initialError) ?? null,
    downgradedToLocal:
      metadata.downgradedToLocal == null ? null : normalizeBooleanFlag(metadata.downgradedToLocal, false),
    localMode: normalizeOptionalText(metadata.localMode) ?? null,
    onlineAllowed:
      metadata.onlineAllowed == null ? null : normalizeBooleanFlag(metadata.onlineAllowed, false),
    skippedLocalReasonerProvider: normalizeRuntimeReasonerProvider(metadata.skippedLocalReasonerProvider) ?? null,
    skippedLocalReasonerReason: normalizeOptionalText(metadata.skippedLocalReasonerReason) ?? null,
    skippedLocalReasonerFailedAt: normalizeOptionalText(metadata.skippedLocalReasonerFailedAt) ?? null,
    qualityEscalationAttempted:
      metadata.qualityEscalationAttempted == null
        ? null
        : normalizeBooleanFlag(metadata.qualityEscalationAttempted, false),
    qualityEscalationActivated:
      metadata.qualityEscalationActivated == null
        ? null
        : normalizeBooleanFlag(metadata.qualityEscalationActivated, false),
    qualityEscalationProvider: normalizeRuntimeReasonerProvider(metadata.qualityEscalationProvider) ?? null,
    qualityEscalationReason: normalizeOptionalText(metadata.qualityEscalationReason) ?? null,
    qualityEscalationError: normalizeOptionalText(metadata.qualityEscalationError) ?? null,
    qualityEscalationIssueCodes: normalizeTextList(metadata.qualityEscalationIssueCodes ?? []),
    qualityEscalationInitialProvider:
      normalizeRuntimeReasonerProvider(metadata.qualityEscalationInitialProvider) ?? null,
    qualityEscalationInitialModel: normalizeOptionalText(metadata.qualityEscalationInitialModel) ?? null,
    qualityEscalationInitialVerificationValid:
      metadata.qualityEscalationInitialVerificationValid == null
        ? null
        : normalizeBooleanFlag(metadata.qualityEscalationInitialVerificationValid, false),
    memoryStabilityCorrectionLevel:
      metadata.memoryStabilityCorrectionLevel == null
        ? null
        : normalizeRuntimeMemoryObservationCorrectionLevel(metadata.memoryStabilityCorrectionLevel),
    memoryStabilityRiskScore: Number.isFinite(toFiniteNumber(metadata.memoryStabilityRiskScore, NaN))
      ? clampMemoryHomeostasisMetric(metadata.memoryStabilityRiskScore, 0, 1)
      : null,
    memoryStabilitySignalSource: normalizeOptionalText(metadata.memoryStabilitySignalSource) ?? null,
    memoryStabilityPreflightStatus: normalizeOptionalText(metadata.memoryStabilityPreflightStatus) ?? null,
  };
  return Object.entries(stored).some(([, value]) => (Array.isArray(value) ? value.length > 0 : value != null))
    ? stored
    : null;
}

export function buildAgentRunnerRecord(
  _store,
  agent,
  {
    didMethod = null,
    currentDidMethod = null,
    resumeBoundaryId = null,
    bootstrapGate = null,
    currentGoal = null,
    userTurn = null,
    candidateResponse = null,
    recentConversationTurns = [],
    toolResults = [],
    contextBuilder = null,
    driftCheck = null,
    verification = null,
    queryState = null,
    residentGate = null,
    negotiation = null,
    compaction = null,
    reasoner = null,
    sandboxExecution = null,
    checkpoint = null,
    checkpointDefaults = null,
    goalState = null,
    selfEvaluation = null,
    strategyProfile = null,
    maintenance = null,
    sourceWindowId = null,
    recordedByAgentId = null,
    recordedByWindowId = null,
    runnerGuard = null,
    allowBootstrapBypass = false,
  } = {}
) {
  const reasonerError = normalizeOptionalText(reasoner?.error) ?? null;
  const negotiationDecision = normalizeOptionalText(negotiation?.decision) ?? null;
  const negotiationBlocksRun = negotiation?.actionable && negotiationDecision === "blocked";
  const negotiationRequiresPause =
    negotiation?.actionable &&
    Boolean(negotiationDecision) &&
    !["execute", "continue", "blocked"].includes(negotiationDecision);
  const runnerGuardBlocksRun = normalizeBooleanFlag(runnerGuard?.failClosed, false);
  const status = residentGate?.required
    ? "resident_locked"
    : bootstrapGate?.required && !allowBootstrapBypass
      ? "bootstrap_required"
      : runnerGuardBlocksRun
        ? "blocked"
        : negotiationBlocksRun
          ? "blocked"
          : negotiationRequiresPause
            ? "negotiation_required"
            : reasonerError
              ? "needs_human_review"
              : sandboxExecution?.error
                ? "blocked"
                : !candidateResponse
                  ? "prepared"
                  : verification && verification.valid === false
                    ? "blocked"
                    : driftCheck?.requiresHumanReview
                      ? "needs_human_review"
                      : driftCheck?.requiresRehydrate
                        ? "rehydrate_required"
                        : "completed";
  const profile = contextBuilder?.slots?.identitySnapshot?.profile || {};
  const resolvedCheckpointDefaults = resolveCheckpointDefaults(checkpointDefaults);

  return {
    runId: createRecordId("run"),
    agentId: agent.agentId,
    didMethod:
      normalizeDidMethod(didMethod) ||
      normalizeOptionalText(currentDidMethod) ||
      null,
    status: normalizeAgentRunStatus(status),
    currentGoal: normalizeOptionalText(currentGoal) ?? null,
    resumeBoundaryId: normalizeOptionalText(resumeBoundaryId) ?? contextBuilder?.slots?.resumeBoundary?.compactBoundaryId ?? null,
    userTurn: normalizeOptionalText(userTurn) ?? null,
    candidateResponse: normalizeOptionalText(candidateResponse) ?? null,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
    recordedByAgentId: normalizeOptionalText(recordedByAgentId) ?? agent.agentId,
    recordedByWindowId: normalizeOptionalText(recordedByWindowId) ?? normalizeOptionalText(sourceWindowId) ?? null,
    contextHash: contextBuilder?.contextHash ?? null,
    contextSummary: {
      did: contextBuilder?.slots?.identitySnapshot?.did ?? null,
      taskSnapshotId: contextBuilder?.slots?.identitySnapshot?.taskSnapshot?.snapshotId ?? null,
      resumeBoundaryId: normalizeOptionalText(resumeBoundaryId) ?? contextBuilder?.slots?.resumeBoundary?.compactBoundaryId ?? null,
      profileName: profile.name ?? null,
      profileRole: profile.role ?? null,
      profileFieldCount: Object.keys(profile || {}).length,
      episodicCount: contextBuilder?.memoryLayers?.counts?.episodic ?? 0,
      workingCount: contextBuilder?.memoryLayers?.counts?.working ?? 0,
      ledgerCommitmentCount: contextBuilder?.memoryLayers?.counts?.ledgerCommitments ?? 0,
      recentConversationTurnCount: Array.isArray(recentConversationTurns) ? recentConversationTurns.length : 0,
      toolResultCount: Array.isArray(toolResults) ? toolResults.length : 0,
      queryStateId: queryState?.queryStateId ?? null,
      negotiationId: negotiation?.negotiationId ?? null,
    },
    driftCheck: driftCheck
      ? {
          driftScore: driftCheck.driftScore ?? 0,
          requiresRehydrate: Boolean(driftCheck.requiresRehydrate),
          requiresHumanReview: Boolean(driftCheck.requiresHumanReview),
          recommendedActions: cloneJson(driftCheck.recommendedActions) ?? [],
          flags: Array.isArray(driftCheck.flags) ? driftCheck.flags.map((item) => item.code).filter(Boolean) : [],
        }
      : null,
    reasoner: reasoner
      ? {
          provider: normalizeOptionalText(reasoner.provider) ?? null,
          model: normalizeOptionalText(reasoner.model || reasoner.metadata?.model) ?? null,
          responseGenerated: Boolean(reasoner.responseGenerated),
          error: reasonerError,
          metadata: buildStoredRunnerReasonerMetadata(reasoner.metadata),
        }
      : null,
    verification: verification
      ? {
          valid: Boolean(verification.valid),
          issueCount: Array.isArray(verification.issues) ? verification.issues.length : 0,
          issues: Array.isArray(verification.issues) ? verification.issues.map((item) => item.code).filter(Boolean) : [],
        }
      : null,
    bootstrapGate: bootstrapGate
      ? {
          required: Boolean(bootstrapGate.required),
          recommendation: bootstrapGate.recommendation || null,
          missingRequiredCodes: cloneJson(bootstrapGate.missingRequiredCodes) ?? [],
        }
      : null,
    residentGate: residentGate
      ? {
          required: Boolean(residentGate.required),
          code: residentGate.code || null,
          residentAgentId: residentGate.residentAgentId || null,
          localMode: residentGate.localMode || null,
          allowOnlineReasoner: Boolean(residentGate.allowOnlineReasoner),
        }
      : null,
    queryState: queryState
      ? {
          queryStateId: queryState.queryStateId || null,
          status: queryState.status || null,
          currentIteration: queryState.currentIteration ?? null,
          maxQueryIterations: queryState.maxQueryIterations ?? null,
          remainingIterations: queryState.remainingIterations ?? null,
          flags: cloneJson(queryState.flags) ?? [],
          recommendedActions: cloneJson(queryState.recommendedActions) ?? [],
          budget: cloneJson(queryState.budget) ?? null,
          riskTier: negotiation?.riskTier ?? null,
          authorizationStrategy: negotiation?.authorizationStrategy ?? null,
        }
      : null,
    negotiation: negotiation
      ? {
          negotiationId: negotiation.negotiationId || null,
          interactionMode: negotiation.interactionMode || null,
          executionMode: negotiation.executionMode || null,
          requestedAction: negotiation.requestedAction || null,
          actionable: Boolean(negotiation.actionable),
          decision: negotiation.decision || null,
          shouldExecute: Boolean(negotiation.shouldExecute),
          requiresMultisig: Boolean(negotiation.requiresMultisig),
          shouldUseOnlineReasoner: Boolean(negotiation.shouldUseOnlineReasoner),
          riskLevel: negotiation.riskLevel || null,
          riskTier: negotiation.riskTier || negotiation.riskLevel || null,
          riskKeywords: cloneJson(negotiation.riskKeywords) ?? [],
          matchedKeywordGroups: cloneJson(negotiation.matchedKeywordGroups) ?? {},
          authorizationStrategy: negotiation.authorizationStrategy || null,
          recommendedNextStep: negotiation.recommendedNextStep || null,
          notes: cloneJson(negotiation.notes) ?? [],
        }
      : null,
    checkpoint: checkpoint
      ? {
          triggered: Boolean(checkpoint.triggered),
          threshold: checkpoint.threshold ?? resolvedCheckpointDefaults.threshold,
          retainCount: checkpoint.retainCount ?? resolvedCheckpointDefaults.retainCount,
          archivedCount: checkpoint.archivedCount ?? 0,
          retainedCount: checkpoint.retainedCount ?? 0,
          candidateCount: checkpoint.candidateCount ?? 0,
          checkpointMemoryId: checkpoint.checkpointMemoryId ?? null,
          archivedKinds: cloneJson(checkpoint.archivedKinds) ?? [],
          activeWorkingCount: checkpoint.activeWorkingCount ?? 0,
          activeWorkingCountAfter: checkpoint.activeWorkingCountAfter ?? checkpoint.activeWorkingCount ?? 0,
        }
      : null,
    goalState: cloneJson(goalState) ?? null,
    selfEvaluation: cloneJson(selfEvaluation) ?? null,
    strategyProfile: cloneJson(strategyProfile) ?? null,
    maintenance: cloneJson(maintenance) ?? null,
    runnerGuard: runnerGuard
      ? {
          failClosed: normalizeBooleanFlag(runnerGuard.failClosed, false),
          blockedBy: normalizeOptionalText(runnerGuard.blockedBy) ?? null,
          code: normalizeOptionalText(runnerGuard.code) ?? null,
          stage: normalizeOptionalText(runnerGuard.stage) ?? null,
          message: normalizeOptionalText(runnerGuard.message) ?? null,
          receiptStatus: normalizeOptionalText(runnerGuard.receiptStatus) ?? null,
          explicitRequestKinds: normalizeTextList(runnerGuard.explicitRequestKinds),
        }
      : null,
    sandboxExecution: sandboxExecution
      ? {
          capability: sandboxExecution.capability || null,
          status: normalizeOptionalText(sandboxExecution.status) ?? null,
          blockedBy: normalizeOptionalText(sandboxExecution.blockedBy) ?? null,
          executed: Boolean(sandboxExecution.executed),
          writeCount: sandboxExecution.writeCount ?? 0,
          summary: sandboxExecution.summary || null,
          error: normalizeOptionalText(sandboxExecution.error) ?? null,
          output: cloneJson(sandboxExecution.output) ?? null,
        }
      : null,
    compaction: compaction
      ? {
          writeCount: compaction.writeCount ?? 0,
          byLayer: cloneJson(compaction.byLayer) ?? {},
          byKind: cloneJson(compaction.byKind) ?? {},
          passportMemoryIds: cloneJson(compaction.passportMemoryIds) ?? [],
        }
      : null,
    toolResults: cloneJson(toolResults) ?? [],
    recentConversationTurns: cloneJson(recentConversationTurns) ?? [],
    references: {
      did: contextBuilder?.slots?.identitySnapshot?.did ?? null,
      parentAgentId: agent.parentAgentId ?? null,
      authorizationThreshold: Math.floor(toFiniteNumber(agent.identity?.authorizationPolicy?.threshold, 1)),
    },
    executedAt: now(),
  };
}

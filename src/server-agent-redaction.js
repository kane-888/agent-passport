import { cloneJson } from "./ledger-core-utils.js";
import { normalizeOptionalText } from "./server-base-helpers.js";
import { getReadSessionViewTemplate } from "./server-read-access.js";
import {
  redactFormalRecoveryFlowForReadSession,
  redactRecoveryListingForReadSession,
  redactSetupPackageListingForReadSession,
} from "./server-security-redaction.js";

export function redactShallowFields(record, { textFields = [], arrayFields = [], objectFields = [] } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return record;
  }

  const next = { ...record };
  for (const field of textFields) {
    const value = next[field];
    if (typeof value === "string") {
      next[`${field}Redacted`] = true;
      next[`${field}Length`] = value.length;
      next[field] = null;
      continue;
    }
    if (value != null) {
      next[`${field}Redacted`] = true;
      next[field] = null;
    }
  }

  for (const field of arrayFields) {
    if (Array.isArray(next[field])) {
      next[`${field}Count`] = next[field].length;
      next[field] = [];
    }
  }

  for (const field of objectFields) {
    if (next[field] && typeof next[field] === "object") {
      next[`${field}Redacted`] = true;
      next[field] = null;
    }
  }

  return next;
}

export function redactAuthorizationPolicyForReadSession(policy = null) {
  if (!policy || typeof policy !== "object") {
    return null;
  }

  return {
    type: normalizeOptionalText(policy.type) ?? null,
    threshold: Number.isFinite(Number(policy.threshold)) ? Math.floor(Number(policy.threshold)) : null,
    signerCount: Array.isArray(policy.signers) ? policy.signers.length : 0,
    signerDetailsRedacted: true,
  };
}

function redactRetrievalPolicyForReadSession(retrievalPolicy = null) {
  if (!retrievalPolicy || typeof retrievalPolicy !== "object") {
    return retrievalPolicy;
  }

  const externalColdMemory =
    retrievalPolicy.externalColdMemory && typeof retrievalPolicy.externalColdMemory === "object"
      ? retrievalPolicy.externalColdMemory
      : null;

  return {
    ...retrievalPolicy,
    externalColdMemory: externalColdMemory
      ? {
          enabled: externalColdMemory.enabled ?? null,
          provider: externalColdMemory.provider ?? null,
          maxHits: externalColdMemory.maxHits ?? null,
          timeoutMs: externalColdMemory.timeoutMs ?? null,
          commandConfigured: Boolean(externalColdMemory.command),
          palacePathConfigured: Boolean(externalColdMemory.palacePath),
        }
      : null,
  };
}

export function redactIdentityForReadSession(identity = null) {
  if (!identity || typeof identity !== "object") {
    return identity;
  }

  return {
    ...identity,
    controllers: [],
    controllerCount: Array.isArray(identity.controllers) ? identity.controllers.length : 0,
    authorizationPolicy: redactAuthorizationPolicyForReadSession(identity.authorizationPolicy),
  };
}

export function redactAgentRecordForReadSession(agent = null) {
  if (!agent || typeof agent !== "object") {
    return agent;
  }

  return {
    ...agent,
    identity: redactIdentityForReadSession(agent.identity),
    balances: agent.balances
      ? {
          credits: Number.isFinite(Number(agent.balances.credits)) ? Number(agent.balances.credits) : 0,
        }
      : null,
  };
}

export function redactMessageForReadSession(message = null) {
  return redactShallowFields(message, {
    textFields: ["subject", "content"],
    objectFields: ["metadata"],
  });
}

export function redactMemoryForReadSession(memory = null) {
  return redactShallowFields(memory, {
    textFields: ["content", "summary", "title", "note"],
    objectFields: ["metadata", "payload"],
  });
}

export function redactTaskSnapshotForReadSession(snapshot = null) {
  return redactShallowFields(snapshot, {
    textFields: ["title", "objective", "nextAction", "checkpointSummary"],
    arrayFields: ["currentPlan", "constraints", "successCriteria"],
  });
}

export function redactDecisionLogForReadSession(decision = null) {
  return redactShallowFields(decision, {
    textFields: ["summary", "detail", "rationale", "nextAction", "note"],
    objectFields: ["metadata"],
  });
}

export function redactConversationMinuteForReadSession(minute = null) {
  return redactShallowFields(minute, {
    textFields: ["title", "summary", "transcript", "note"],
    objectFields: ["metadata"],
  });
}

export function redactEvidenceRefForReadSession(evidenceRef = null) {
  return redactShallowFields(evidenceRef, {
    textFields: ["title", "summary", "uri", "note"],
    objectFields: ["metadata"],
  });
}

export function redactPassportMemoryForReadSession(memory = null) {
  return redactShallowFields(memory, {
    textFields: ["summary", "content", "title", "objective", "nextAction", "uri", "transcript", "note"],
    arrayFields: ["currentPlan", "constraints", "successCriteria"],
    objectFields: ["payload", "metadata"],
  });
}

export function redactAgentArchiveListingForReadSession(listing = null) {
  if (!listing || typeof listing !== "object") {
    return listing;
  }

  return {
    ...listing,
    archive: listing.archive
      ? {
          ...listing.archive,
          filePath: null,
          filePathRedacted: Boolean(listing.archive.filePath),
        }
      : null,
  };
}

export function redactArchiveRestoreEventForReadSession(event = null) {
  if (!event || typeof event !== "object") {
    return event;
  }

  const payload = event.payload && typeof event.payload === "object" ? event.payload : null;
  return {
    hash: event.hash ?? null,
    index: event.index ?? null,
    type: event.type ?? null,
    timestamp: event.timestamp ?? null,
    payload: payload
      ? {
          agentId: payload.agentId ?? null,
          archiveKind: payload.archiveKind ?? null,
          restoredAt: payload.restoredAt ?? null,
          archivedAt: payload.archivedAt ?? null,
          restoredRecordId: payload.restoredRecordId ?? null,
          originalRecordId: payload.originalRecordId ?? null,
          restoredByAgentId: payload.restoredByAgentId ?? null,
          restoredByWindowId: null,
          restoredByWindowIdRedacted: payload.restoredByWindowId != null,
          sourceWindowId: null,
          sourceWindowIdRedacted: payload.sourceWindowId != null,
        }
      : null,
  };
}

export function redactWindowBindingForReadSession(window = null) {
  if (!window || typeof window !== "object") {
    return window;
  }

  return {
    windowId: window.windowId ?? null,
    agentId: window.agentId ?? null,
    label: window.label ?? null,
    createdAt: window.createdAt ?? null,
    linkedAt: window.linkedAt ?? null,
    lastSeenAt: window.lastSeenAt ?? null,
  };
}

export function redactRuntimeSearchHitForReadSession(hit = null) {
  const redacted = redactShallowFields(hit, {
    textFields: ["title", "summary", "content", "uri", "transcript", "excerpt", "note"],
    objectFields: ["payload", "metadata", "details"],
  });
  if (redacted?.sourceType === "external_cold_memory") {
    const linked = redacted?.linked && typeof redacted.linked === "object" ? redacted.linked : {};
    const originalSourceId = redacted.sourceId;
    const originalTags = Array.isArray(redacted.tags) ? redacted.tags.slice() : [];
    const provenance =
      redacted.provenance && typeof redacted.provenance === "object" ? redacted.provenance : null;
    redacted.sourceId = null;
    redacted.sourceIdRedacted = Boolean(originalSourceId);
    redacted.tags = [];
    redacted.tagsCount = originalTags.length;
    redacted.provenance = {
      provider: provenance?.provider ?? linked.provider ?? null,
      candidateOnly: redacted.candidateOnly ?? null,
      sourceFileRedacted: Boolean(provenance?.sourceFile ?? linked.sourceFile),
      wingRedacted: Boolean(provenance?.wing ?? linked.wing),
      roomRedacted: Boolean(provenance?.room ?? linked.room),
    };
    redacted.linked = {
      provider: linked.provider ?? null,
      candidateOnly: linked.candidateOnly ?? null,
      sourceFileRedacted: Boolean(linked.sourceFile),
      wingRedacted: Boolean(linked.wing),
      roomRedacted: Boolean(linked.room),
    };
  }
  return redacted;
}

export function redactRuntimeSearchResultForReadSession(search = null) {
  if (!search || typeof search !== "object") {
    return search;
  }

  const retrieval = search.retrieval && typeof search.retrieval === "object" ? search.retrieval : null;
  return {
    ...search,
    retrieval: retrieval
      ? {
          ...retrieval,
          externalColdMemoryError: retrieval.externalColdMemoryError ? null : retrieval.externalColdMemoryError,
          externalColdMemoryErrorRedacted: Boolean(retrieval.externalColdMemoryError),
        }
      : null,
    hits: Array.isArray(search.hits) ? search.hits.map(redactRuntimeSearchHitForReadSession) : [],
  };
}

export function redactSandboxActionAuditForReadSession(audit = null, accessOrSession = null) {
  if (!audit || typeof audit !== "object") {
    return audit;
  }
  if (getReadSessionViewTemplate(accessOrSession, "sandboxAudits", "metadata_only") === "summary_only") {
    return {
      auditId: audit.auditId ?? null,
      capability: audit.capability ?? null,
      status: audit.status ?? null,
      executed: audit.executed ?? null,
      executionBackend: audit.executionBackend ?? null,
      writeCount: audit.writeCount ?? null,
      createdAt: audit.createdAt ?? null,
      error: audit.error ?? null,
    };
  }
  const output = audit.output && typeof audit.output === "object" ? audit.output : null;
  let redactedOutput = output;
  if (output) {
    if (audit.capability === "runtime_search") {
      redactedOutput = {
        ...output,
        hits: Array.isArray(output.hits) ? output.hits.map(redactRuntimeSearchHitForReadSession) : [],
      };
    } else if (audit.capability === "conversation_minute_write") {
      redactedOutput = {
        ...output,
        minute: redactConversationMinuteForReadSession(output.minute),
      };
    } else if (audit.capability === "filesystem_list") {
      redactedOutput = {
        ...output,
        path: null,
        allowlistedRoot: null,
        entries: Array.isArray(output.entries)
          ? output.entries.map((entry) => ({
              name: entry?.name ?? null,
              type: entry?.type ?? null,
            }))
          : [],
      };
    } else if (audit.capability === "filesystem_read") {
      redactedOutput = {
        ...output,
        path: null,
        allowlistedRoot: null,
        preview: null,
      };
    } else if (audit.capability === "network_external") {
      redactedOutput = {
        ...output,
        url: null,
        headers: null,
        bodyPreview: null,
      };
    } else if (audit.capability === "process_exec") {
      redactedOutput = {
        ...output,
        stdout: null,
        stderr: null,
        commandPath: null,
      };
    }
  }
  return {
    ...audit,
    requestedAction: null,
    input: audit.input
      ? {
          ...audit.input,
          targetResource: null,
          query: null,
          title: null,
          url: null,
          path: null,
          command: null,
          args: [],
          cwd: null,
        }
      : null,
    output: redactedOutput,
  };
}

export function redactCompactBoundaryForReadSession(boundary = null) {
  return redactShallowFields(boundary, {
    textFields: ["summary", "recoveryPrompt", "checkpointSummary"],
    objectFields: ["sources"],
  });
}

export function redactAgentRunForReadSession(run = null) {
  const redacted = redactShallowFields(run, {
    textFields: ["currentGoal", "userTurn", "candidateResponse"],
    objectFields: ["toolResults", "recentConversationTurns"],
  });
  if (redacted?.autoRecovery) {
    redacted.autoRecovery = redactAutoRecoveryAuditForReadSession(redacted.autoRecovery);
  }
  return redacted;
}

export function redactAutoRecoveryAuditForReadSession(audit = null) {
  if (!audit || typeof audit !== "object") {
    return audit;
  }

  return {
    auditEventId: audit.auditEventId ?? null,
    eventIndex: audit.eventIndex ?? null,
    eventHash: audit.eventHash ?? null,
    timestamp: audit.timestamp ?? null,
    agentId: audit.agentId ?? null,
    runId: audit.runId ?? null,
    sourceWindowId: audit.sourceWindowId ?? null,
    requested: audit.requested ?? null,
    enabled: audit.enabled ?? null,
    ready: audit.ready ?? null,
    resumed: audit.resumed ?? null,
    attempt: audit.attempt ?? null,
    maxAttempts: audit.maxAttempts ?? null,
    status: audit.status ?? null,
    summary: null,
    summaryRedacted: audit.summary != null,
    error: null,
    errorRedacted: audit.error != null,
    initialRunId: audit.initialRunId ?? null,
    triggerRunId: audit.triggerRunId ?? null,
    triggerRecoveryActionId: audit.triggerRecoveryActionId ?? null,
    finalRunId: audit.finalRunId ?? null,
    finalStatus: audit.finalStatus ?? null,
    gateReasons: cloneJson(audit.gateReasons) ?? [],
    dependencyWarnings: cloneJson(audit.dependencyWarnings) ?? [],
    chainLength: Array.isArray(audit.chain) ? audit.chain.length : 0,
    plan: audit.plan
      ? {
          action: audit.plan.action ?? null,
          mode: audit.plan.mode ?? null,
        }
      : null,
    setupStatus: audit.setupStatus
      ? {
          setupComplete: audit.setupStatus.setupComplete ?? null,
          missingRequiredCodes: cloneJson(audit.setupStatus.missingRequiredCodes) ?? [],
          formalRecoveryFlow: audit.setupStatus.formalRecoveryFlow
            ? {
                status: audit.setupStatus.formalRecoveryFlow.status ?? null,
                durableRestoreReady: audit.setupStatus.formalRecoveryFlow.durableRestoreReady ?? null,
                missingRequiredCodes: cloneJson(audit.setupStatus.formalRecoveryFlow.missingRequiredCodes) ?? [],
                runbook: audit.setupStatus.formalRecoveryFlow.runbook
                  ? {
                      status: audit.setupStatus.formalRecoveryFlow.runbook.status ?? null,
                      nextStepCode: audit.setupStatus.formalRecoveryFlow.runbook.nextStepCode ?? null,
                      nextStepLabel: audit.setupStatus.formalRecoveryFlow.runbook.nextStepLabel ?? null,
                      completedStepCount: audit.setupStatus.formalRecoveryFlow.runbook.completedStepCount ?? 0,
                      totalStepCount: audit.setupStatus.formalRecoveryFlow.runbook.totalStepCount ?? 0,
                    }
                  : null,
              }
            : null,
          automaticRecoveryReadiness: audit.setupStatus.automaticRecoveryReadiness
            ? {
                status: audit.setupStatus.automaticRecoveryReadiness.status ?? null,
                ready: audit.setupStatus.automaticRecoveryReadiness.ready ?? null,
                formalFlowReady: audit.setupStatus.automaticRecoveryReadiness.formalFlowReady ?? null,
                gateReasons: cloneJson(audit.setupStatus.automaticRecoveryReadiness.gateReasons) ?? [],
                dependencyWarnings: cloneJson(audit.setupStatus.automaticRecoveryReadiness.dependencyWarnings) ?? [],
              }
            : null,
          activePlanReadiness: audit.setupStatus.activePlanReadiness
            ? {
                status: audit.setupStatus.activePlanReadiness.status ?? null,
                ready: audit.setupStatus.activePlanReadiness.ready ?? null,
                formalFlowReady: audit.setupStatus.activePlanReadiness.formalFlowReady ?? null,
                gateReasons: cloneJson(audit.setupStatus.activePlanReadiness.gateReasons) ?? [],
                dependencyWarnings: cloneJson(audit.setupStatus.activePlanReadiness.dependencyWarnings) ?? [],
              }
            : null,
        }
      : null,
    finalVerification: audit.finalVerification
      ? {
          valid: audit.finalVerification.valid ?? null,
          issueCount: audit.finalVerification.issueCount ?? 0,
          issues: cloneJson(audit.finalVerification.issues) ?? [],
        }
      : null,
    closure: audit.closure
      ? {
          status: audit.closure.status ?? null,
          chainLength: audit.closure.chainLength ?? 0,
          finalStatus: audit.closure.finalStatus ?? null,
          phases: Array.isArray(audit.closure.phases)
            ? audit.closure.phases.map((entry) => ({
                phaseId: entry?.phaseId ?? null,
                status: entry?.status ?? null,
              }))
            : [],
          gateReasons: cloneJson(audit.closure.gateReasons) ?? [],
          dependencyWarnings: cloneJson(audit.closure.dependencyWarnings) ?? [],
        }
      : null,
  };
}

export function redactQueryStateForReadSession(queryState = null) {
  return redactShallowFields(queryState, {
    textFields: ["currentGoal", "userTurn"],
  });
}

export function redactTranscriptEntryForReadSession(entry = null, accessOrSession = null) {
  const redacted = redactShallowFields(entry, {
    textFields: ["title", "summary", "content"],
    objectFields: ["metadata"],
  });
  if (getReadSessionViewTemplate(accessOrSession, "transcript", "metadata_only") !== "summary_only") {
    return redacted;
  }
  return {
    transcriptEntryId: redacted?.transcriptEntryId ?? redacted?.entryId ?? null,
    entryType: redacted?.entryType ?? null,
    family: redacted?.family ?? null,
    role: redacted?.role ?? null,
    createdAt: redacted?.createdAt ?? null,
    sourceWindowId: redacted?.sourceWindowId ?? null,
    titleRedacted: Boolean(redacted?.titleRedacted),
    summaryRedacted: Boolean(redacted?.summaryRedacted),
    contentRedacted: Boolean(redacted?.contentRedacted),
  };
}

export function redactSessionStateForReadSession(sessionState = null, accessOrSession = null) {
  if (!sessionState || typeof sessionState !== "object") {
    return sessionState;
  }

  const template = getReadSessionViewTemplate(accessOrSession, "agentRuntime", "metadata_only");
  const queryState =
    sessionState.queryState && typeof sessionState.queryState === "object"
      ? sessionState.queryState
      : null;
  const negotiation =
    sessionState.negotiation && typeof sessionState.negotiation === "object"
      ? sessionState.negotiation
      : null;
  const cognitiveState =
    sessionState.cognitiveState && typeof sessionState.cognitiveState === "object"
      ? sessionState.cognitiveState
      : null;
  const redacted = {
    ...redactShallowFields(sessionState, {
      textFields: ["currentGoal", "summary", "recoveryPrompt", "transitionReason"],
    }),
    queryState: queryState ? redactQueryStateForReadSession(queryState) : null,
    negotiation: negotiation
      ? redactShallowFields(negotiation, {
          textFields: ["requestedAction"],
        })
      : null,
    cognitiveState: cognitiveState
      ? redactAgentCognitiveStateForReadSession(cognitiveState, accessOrSession)
      : null,
    sourceWindowId: null,
    sourceWindowIdRedacted: sessionState.sourceWindowId != null,
  };

  if (template !== "summary_only") {
    return redacted;
  }

  const activeWindowIds = Array.isArray(sessionState.activeWindowIds) ? sessionState.activeWindowIds : [];
  const recommendedActions = Array.isArray(queryState?.recommendedActions)
    ? queryState.recommendedActions
    : [];

  return {
    sessionStateId: redacted.sessionStateId ?? null,
    agentId: redacted.agentId ?? null,
    didMethod: redacted.didMethod ?? null,
    currentTaskSnapshotId: redacted.currentTaskSnapshotId ?? null,
    latestRunId: redacted.latestRunId ?? null,
    latestRunStatus: redacted.latestRunStatus ?? null,
    latestVerificationValid: redacted.latestVerificationValid ?? null,
    latestDriftScore: redacted.latestDriftScore ?? null,
    latestCompactBoundaryId: redacted.latestCompactBoundaryId ?? null,
    latestResumeBoundaryId: redacted.latestResumeBoundaryId ?? null,
    latestQueryStateId: redacted.latestQueryStateId ?? null,
    latestNegotiationId: redacted.latestNegotiationId ?? null,
    latestNegotiationDecision: redacted.latestNegotiationDecision ?? null,
    compactBoundaryCount: redacted.compactBoundaryCount ?? 0,
    activeWindowCount: activeWindowIds.length,
    currentPermissionMode: redacted.currentPermissionMode ?? null,
    residentAgentId: redacted.residentAgentId ?? null,
    residentLockRequired: redacted.residentLockRequired ?? null,
    localMode: redacted.localMode ?? null,
    tokenBudgetState: redacted.tokenBudgetState
      ? {
          estimatedContextChars: redacted.tokenBudgetState.estimatedContextChars ?? null,
          estimatedContextTokens: redacted.tokenBudgetState.estimatedContextTokens ?? null,
          maxConversationTurns: redacted.tokenBudgetState.maxConversationTurns ?? null,
          maxContextChars: redacted.tokenBudgetState.maxContextChars ?? null,
          maxContextTokens: redacted.tokenBudgetState.maxContextTokens ?? null,
          maxRecentConversationTurns: redacted.tokenBudgetState.maxRecentConversationTurns ?? null,
          maxToolResults: redacted.tokenBudgetState.maxToolResults ?? null,
          maxQueryIterations: redacted.tokenBudgetState.maxQueryIterations ?? null,
          driftScoreLimit: redacted.tokenBudgetState.driftScoreLimit ?? null,
        }
      : null,
    memoryCounts: cloneJson(redacted.memoryCounts) ?? {},
    queryState: redacted.queryState
      ? {
          agentId: redacted.queryState.agentId ?? null,
          didMethod: redacted.queryState.didMethod ?? null,
          queryStateId: redacted.queryState.queryStateId ?? null,
          status: redacted.queryState.status ?? null,
          currentIteration: redacted.queryState.currentIteration ?? null,
          maxQueryIterations: redacted.queryState.maxQueryIterations ?? null,
          remainingIterations: redacted.queryState.remainingIterations ?? null,
          flagCount: Array.isArray(redacted.queryState.flags) ? redacted.queryState.flags.length : 0,
          recommendedActionCount: recommendedActions.length,
        }
      : null,
    negotiation: redacted.negotiation
      ? {
          negotiationId: redacted.negotiation.negotiationId ?? null,
          interactionMode: redacted.negotiation.interactionMode ?? null,
          executionMode: redacted.negotiation.executionMode ?? null,
          decision: redacted.negotiation.decision ?? null,
          shouldExecute: redacted.negotiation.shouldExecute ?? null,
          riskLevel: redacted.negotiation.riskLevel ?? null,
          requestedActionRedacted: Boolean(redacted.negotiation.requestedActionRedacted),
        }
      : null,
    cognitiveState: redacted.cognitiveState,
    updatedAt: redacted.updatedAt ?? null,
    currentGoalRedacted: Boolean(redacted.currentGoalRedacted),
    summaryRedacted: Boolean(redacted.summaryRedacted),
    recoveryPromptRedacted: Boolean(redacted.recoveryPromptRedacted),
    transitionReasonRedacted: Boolean(redacted.transitionReasonRedacted),
    sourceWindowIdRedacted: Boolean(redacted.sourceWindowIdRedacted),
  };
}

export function redactAgentCognitiveStateForReadSession(state = null, accessOrSession = null) {
  if (!state || typeof state !== "object") {
    return state;
  }

  const template = getReadSessionViewTemplate(accessOrSession, "agentRuntime", "metadata_only");
  const interoceptiveState =
    state.interoceptiveState && typeof state.interoceptiveState === "object"
      ? {
          sleepPressure: state.interoceptiveState.sleepPressure ?? null,
          allostaticLoad: state.interoceptiveState.allostaticLoad ?? null,
          bodyBudget: state.interoceptiveState.bodyBudget ?? null,
          updatedAt: state.interoceptiveState.updatedAt ?? null,
        }
      : null;
  const replayOrchestration =
    state.replayOrchestration && typeof state.replayOrchestration === "object"
      ? {
          shouldReplay: state.replayOrchestration.shouldReplay ?? null,
          replayMode: state.replayOrchestration.replayMode ?? null,
          replayDrive: state.replayOrchestration.replayDrive ?? null,
          gatingReason: state.replayOrchestration.gatingReason ?? null,
          updatedAt: state.replayOrchestration.updatedAt ?? null,
        }
      : null;
  const signals =
    state.signals && typeof state.signals === "object"
      ? {
          requiresRehydrate: state.signals.requiresRehydrate ?? null,
          requiresHumanReview: state.signals.requiresHumanReview ?? null,
          residentLocked: state.signals.residentLocked ?? null,
          bootstrapRequired: state.signals.bootstrapRequired ?? null,
          queryIteration: state.signals.queryIteration ?? null,
          latestCompactBoundaryId: state.signals.latestCompactBoundaryId ?? null,
        }
      : null;
  const redacted = {
    ...state,
    currentGoal: null,
    currentGoalRedacted: state.currentGoal != null,
    transitionReason: null,
    transitionReasonRedacted: state.transitionReason != null,
    preferenceProfile: null,
    preferenceProfileRedacted: state.preferenceProfile != null,
    adaptation: null,
    adaptationRedacted: state.adaptation != null,
    goalState: null,
    goalStateRedacted: state.goalState != null,
    selfEvaluation: null,
    selfEvaluationRedacted: state.selfEvaluation != null,
    strategyProfile: null,
    strategyProfileRedacted: state.strategyProfile != null,
    bodyLoop: cloneJson(state.bodyLoop) ?? null,
    interoceptiveState,
    neuromodulators: null,
    neuromodulatorsRedacted: state.neuromodulators != null,
    oscillationSchedule: null,
    oscillationScheduleRedacted: state.oscillationSchedule != null,
    replayOrchestration,
    signals,
  };
  if (template !== "summary_only") {
    return redacted;
  }
  return {
    cognitiveStateId: redacted.cognitiveStateId ?? null,
    agentId: redacted.agentId ?? null,
    didMethod: redacted.didMethod ?? null,
    mode: redacted.mode ?? null,
    dominantStage: redacted.dominantStage ?? null,
    continuityScore: redacted.continuityScore ?? null,
    calibrationScore: redacted.calibrationScore ?? null,
    recoveryReadinessScore: redacted.recoveryReadinessScore ?? null,
    sleepPressure: redacted.sleepPressure ?? null,
    homeostaticPressure: redacted.homeostaticPressure ?? null,
    dominantRhythm: redacted.dominantRhythm ?? null,
    bodyLoop: cloneJson(redacted.bodyLoop) ?? null,
    interoceptiveState: redacted.interoceptiveState,
    replayOrchestration: redacted.replayOrchestration,
    signals: redacted.signals,
    runtimeStateSummaryId: redacted.runtimeStateSummaryId ?? redacted.cognitiveStateId ?? null,
    runtimeStateMode: redacted.runtimeStateMode ?? redacted.mode ?? null,
    runtimeStateStage: redacted.runtimeStateStage ?? redacted.dominantStage ?? null,
  };
}

export function redactCognitiveTransitionForReadSession(transition = null, accessOrSession = null) {
  const redacted = redactShallowFields(transition, {
    textFields: ["transitionReason"],
  });
  if (getReadSessionViewTemplate(accessOrSession, "agentRuntime", "metadata_only") !== "summary_only") {
    return redacted;
  }
  return {
    transitionId: redacted?.transitionId ?? null,
    agentId: redacted?.agentId ?? null,
    fromStateId: redacted?.fromStateId ?? null,
    toStateId: redacted?.toStateId ?? null,
    fromMode: redacted?.fromMode ?? null,
    toMode: redacted?.toMode ?? null,
    fromStage: redacted?.fromStage ?? null,
    toStage: redacted?.toStage ?? null,
    continuityScore: redacted?.continuityScore ?? null,
    calibrationScore: redacted?.calibrationScore ?? null,
    recoveryReadinessScore: redacted?.recoveryReadinessScore ?? null,
    driftScore: redacted?.driftScore ?? null,
    queryIteration: redacted?.queryIteration ?? null,
    runId: redacted?.runId ?? null,
    createdAt: redacted?.createdAt ?? null,
    transitionReasonRedacted: Boolean(redacted?.transitionReasonRedacted),
  };
}

export function redactVerificationRunForReadSession(run = null, accessOrSession = null) {
  if (!run || typeof run !== "object") {
    return run;
  }

  const checks = Array.isArray(run.checks) ? run.checks : [];
  const redacted = {
    verificationRunId: run.verificationRunId ?? null,
    integrityRunId: run.integrityRunId ?? run.verificationRunId ?? null,
    agentId: run.agentId ?? null,
    didMethod: run.didMethod ?? null,
    mode: run.mode ?? null,
    integrityMode: run.integrityMode ?? run.mode ?? null,
    status: run.status ?? null,
    summary: cloneJson(run.summary) ?? null,
    integritySummary: cloneJson(run.integritySummary ?? run.summary) ?? null,
    checkCount: checks.length,
    checks: null,
    checksRedacted: checks.length > 0,
    relatedRunId: run.relatedRunId ?? null,
    relatedCompactBoundaryId: run.relatedCompactBoundaryId ?? null,
    relatedResumeBoundaryId: run.relatedResumeBoundaryId ?? run.relatedCompactBoundaryId ?? null,
    contextHash: null,
    contextHashRedacted: run.contextHash != null,
    sourceWindowId: null,
    sourceWindowIdRedacted: run.sourceWindowId != null,
    createdAt: run.createdAt ?? null,
  };
  if (getReadSessionViewTemplate(accessOrSession, "agentRuntime", "metadata_only") !== "summary_only") {
    return redacted;
  }
  return redacted;
}

export function redactRecoveryRehearsalForReadSession(rehearsal = null, accessOrSession = null) {
  const redacted = redactShallowFields(rehearsal, {
    textFields: ["summary", "note"],
    objectFields: ["checks", "errors", "bundle"],
  });
  if (getReadSessionViewTemplate(accessOrSession, "recovery", "metadata_only") !== "summary_only") {
    return redacted;
  }
  return {
    rehearsalId: rehearsal?.rehearsalId ?? null,
    bundleId: rehearsal?.bundleId ?? null,
    createdAt: rehearsal?.createdAt ?? null,
    status: rehearsal?.status ?? null,
    checkCount: rehearsal?.checkCount ?? null,
    passedCount: rehearsal?.passedCount ?? null,
    failedCount: rehearsal?.failedCount ?? null,
    summary: rehearsal?.summary ?? null,
  };
}

export function redactCredentialRecordForReadSession(record = null) {
  return redactShallowFields(record, {
    textFields: ["proofValue", "proofMethod", "note", "revocationNote"],
    objectFields: ["migrationLinks"],
  });
}

export function redactAuthorizationViewForReadSession(authorization = null) {
  return redactShallowFields(authorization, {
    textFields: ["title", "description", "note", "summary", "revocationReason", "revocationNote", "lastError"],
    objectFields: ["payload", "executionResult", "executionReceipt", "executionRecord"],
  });
}

export function redactMigrationRepairViewForReadSession(repair = null) {
  return redactShallowFields(repair, {
    textFields: ["summary"],
    objectFields: [
      "comparisonPairs",
      "plan",
      "repaired",
      "skipped",
      "beforeCoverage",
      "afterCoverage",
      "repairReceipt",
      "repairRecord",
    ],
  });
}

export function redactStatusListSummaryForReadSession(summary = null) {
  if (!summary || typeof summary !== "object") {
    return summary;
  }

  return {
    statusListId: summary.statusListId ?? null,
    statusListCredentialId: summary.statusListCredentialId ?? null,
    issuerAgentId: summary.issuerAgentId ?? null,
    issuerLabel: summary.issuerLabel ?? null,
    issuerDid: summary.issuerDid ?? null,
    statusPurpose: summary.statusPurpose ?? null,
    chainId: summary.chainId ?? null,
    issuedAt: summary.issuedAt ?? null,
    updatedAt: summary.updatedAt ?? null,
    totalEntries: summary.totalEntries ?? 0,
    activeCount: summary.activeCount ?? 0,
    revokedCount: summary.revokedCount ?? 0,
    proofValue: null,
    proofValueRedacted: summary.proofValue != null,
    ledgerHash: null,
    ledgerHashRedacted: summary.ledgerHash != null,
    bitstring: null,
    bitstringRedacted: summary.bitstring != null,
    bitstringLength: typeof summary.bitstring === "string" ? summary.bitstring.length : null,
  };
}

export function redactStatusListEntryForReadSession(entry = null) {
  return redactShallowFields(entry, {
    textFields: ["proofValue", "ledgerHash", "revocationReason", "revocationNote"],
  });
}

export function redactStatusListIssuerProfileForReadSession(profile = null) {
  if (!profile || typeof profile !== "object") {
    return profile;
  }

  return {
    ...profile,
    controllers: [],
    controllerCount: Array.isArray(profile.controllers) ? profile.controllers.length : profile.controllerCount ?? 0,
    signers: [],
    signerCount: Array.isArray(profile.signers) ? profile.signers.length : profile.signerCount ?? 0,
    didDocument: null,
    didDocumentRedacted: Boolean(profile.didDocument),
  };
}

export function redactStatusListDetailForReadSession(statusList = null) {
  if (!statusList || typeof statusList !== "object") {
    return statusList;
  }

  return {
    statusListId: statusList.statusListId ?? null,
    summary: redactStatusListSummaryForReadSession(statusList.summary),
    statusList: summarizeCredentialDocumentForReadSession(statusList.statusList),
    entries: Array.isArray(statusList.entries) ? statusList.entries.map(redactStatusListEntryForReadSession) : [],
  };
}

export function redactStatusListComparisonForReadSession(comparison = null) {
  if (!comparison || typeof comparison !== "object") {
    return comparison;
  }

  const redactSide = (side = null) => {
    if (!side || typeof side !== "object") {
      return side;
    }
    return {
      ...side,
      credential: summarizeCredentialDocumentForReadSession(side.credential),
      summary: redactStatusListSummaryForReadSession(side.summary),
      entries: Array.isArray(side.entries) ? side.entries.map(redactStatusListEntryForReadSession) : [],
      issuerIdentity: redactStatusListIssuerProfileForReadSession(side.issuerIdentity),
    };
  };

  return {
    ...comparison,
    left: redactSide(comparison.left),
    right: redactSide(comparison.right),
    comparison: comparison.comparison
      ? {
          ...comparison.comparison,
          leftEntrySummary: Array.isArray(comparison.comparison.leftEntrySummary)
            ? comparison.comparison.leftEntrySummary.map(redactStatusListEntryForReadSession)
            : [],
          rightEntrySummary: Array.isArray(comparison.comparison.rightEntrySummary)
            ? comparison.comparison.rightEntrySummary.map(redactStatusListEntryForReadSession)
            : [],
          sharedEntrySummary: Array.isArray(comparison.comparison.sharedEntrySummary)
            ? comparison.comparison.sharedEntrySummary.map(redactStatusListEntryForReadSession)
            : [],
          leftOnlyEntrySummary: Array.isArray(comparison.comparison.leftOnlyEntrySummary)
            ? comparison.comparison.leftOnlyEntrySummary.map(redactStatusListEntryForReadSession)
            : [],
          rightOnlyEntrySummary: Array.isArray(comparison.comparison.rightOnlyEntrySummary)
            ? comparison.comparison.rightOnlyEntrySummary.map(redactStatusListEntryForReadSession)
            : [],
          issuerSummary: comparison.comparison.issuerSummary
            ? {
                left: redactStatusListIssuerProfileForReadSession(comparison.comparison.issuerSummary.left),
                right: redactStatusListIssuerProfileForReadSession(comparison.comparison.issuerSummary.right),
              }
            : null,
          signerComparison: comparison.comparison.signerComparison
            ? {
                ...comparison.comparison.signerComparison,
                left: [],
                right: [],
                shared: [],
                leftOnly: [],
                rightOnly: [],
              }
            : null,
          controllerComparison: comparison.comparison.controllerComparison
            ? {
                ...comparison.comparison.controllerComparison,
                left: [],
                right: [],
                shared: [],
                leftOnly: [],
                rightOnly: [],
              }
            : null,
        }
      : null,
  };
}

export function redactCredentialExportForReadSession(payload = null) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  return {
    ...payload,
    credential: summarizeCredentialDocumentForReadSession(payload.credential),
    credentialRecord: redactCredentialRecordForReadSession(payload.credentialRecord),
    alternates: Array.isArray(payload.alternates)
      ? payload.alternates.map((entry) => ({
          ...entry,
          credential: summarizeCredentialDocumentForReadSession(entry?.credential),
          credentialRecord: redactCredentialRecordForReadSession(entry?.credentialRecord),
        }))
      : [],
  };
}

export function redactCredentialStatusForReadSession(status = null, accessOrSession = null) {
  if (!status || typeof status !== "object") {
    return status;
  }

  const statusProof =
    status.statusProof && typeof status.statusProof === "object"
      ? status.statusProof
      : null;
  const statusProofProof =
    statusProof?.proof && typeof statusProof.proof === "object"
      ? statusProof.proof
      : null;
  const credentialStatus =
    status.credentialStatus && typeof status.credentialStatus === "object"
      ? {
          id: status.credentialStatus.id ?? null,
          type: status.credentialStatus.type ?? null,
          statusPurpose: status.credentialStatus.statusPurpose ?? null,
          statusListIndex: status.credentialStatus.statusListIndex ?? null,
          statusListCredential: status.credentialStatus.statusListCredential ?? null,
          statusListId: status.credentialStatus.statusListId ?? null,
          chainId: status.credentialStatus.chainId ?? null,
          snapshotPurpose: status.credentialStatus.snapshotPurpose ?? null,
        }
      : null;

  return {
    credentialId: status.credentialId ?? status.credential?.id ?? null,
    credentialRecordId: status.credentialRecordId ?? status.credentialRecord?.credentialRecordId ?? null,
    credentialRecord: redactCredentialRecordForReadSession(status.credentialRecord),
    credential: summarizeCredentialDocumentForReadSession(status.credential),
    credentialStatus,
    status: status.status ?? null,
    statusBit: status.statusBit ?? null,
    statusProof: statusProof
      ? {
          credentialRecordId: statusProof.credentialRecordId ?? null,
          credentialId: statusProof.credentialId ?? null,
          statusListId: statusProof.statusListId ?? null,
          statusListCredentialId: statusProof.statusListCredentialId ?? null,
          statusListIndex: statusProof.statusListIndex ?? null,
          statusPurpose: statusProof.statusPurpose ?? null,
          status: statusProof.status ?? null,
          statusBit: statusProof.statusBit ?? null,
          registryKnown: statusProof.registryKnown ?? null,
          registryStatus: statusProof.registryStatus ?? null,
          registryFresh: statusProof.registryFresh ?? null,
          statusMatchesRegistry: statusProof.statusMatchesRegistry ?? null,
          statusListHash: null,
          statusListHashRedacted: statusProof.statusListHash != null,
          statusListLedgerHash: null,
          statusListLedgerHashRedacted: statusProof.statusListLedgerHash != null,
          revokedAt: statusProof.revokedAt ?? null,
          revocationReason: null,
          revocationReasonRedacted: statusProof.revocationReason != null,
          revocationNote: null,
          revocationNoteRedacted: statusProof.revocationNote != null,
          updatedAt: statusProof.updatedAt ?? null,
          issuedAt: statusProof.issuedAt ?? null,
          proof: statusProofProof
            ? {
                type: statusProofProof.type ?? null,
                created: statusProofProof.created ?? null,
                proofPurpose: statusProofProof.proofPurpose ?? null,
                verificationMethod: statusProofProof.verificationMethod ?? null,
                hashAlgorithm: statusProofProof.hashAlgorithm ?? null,
                proofValue: null,
                proofValueRedacted: statusProofProof.proofValue != null,
              }
            : null,
        }
      : null,
    statusList: status.statusList
      ? {
          credential: summarizeCredentialDocumentForReadSession(status.statusList.credential),
          summary: redactStatusListSummaryForReadSession(status.statusList.summary),
          entries: Array.isArray(status.statusList.entries)
            ? status.statusList.entries.map(redactStatusListEntryForReadSession)
            : [],
        }
      : null,
    statusListCredential: summarizeCredentialDocumentForReadSession(status.statusListCredential),
    statusListSummary: redactStatusListSummaryForReadSession(status.statusListSummary),
    statusEntry: redactStatusListEntryForReadSession(status.statusEntry),
  };
}

export function summarizeCredentialDocumentForReadSession(credential = null) {
  if (!credential || typeof credential !== "object") {
    return credential;
  }

  const subject = credential.credentialSubject && typeof credential.credentialSubject === "object"
    ? credential.credentialSubject
    : {};
  const proof = credential.proof && typeof credential.proof === "object" ? credential.proof : null;
  const credentialStatus = credential.credentialStatus && typeof credential.credentialStatus === "object"
    ? credential.credentialStatus
    : null;
  const evidence = credential.evidence && typeof credential.evidence === "object" ? credential.evidence : null;

  return {
    id: credential.id ?? null,
    type: Array.isArray(credential.type) ? credential.type : [credential.type].filter(Boolean),
    issuer: credential.issuer ?? null,
    issuanceDate: credential.issuanceDate ?? null,
    credentialSubject: {
      id: subject.id ?? null,
      agentId: subject.agentId ?? null,
      proposalId: subject.proposalId ?? null,
      repairId: subject.repairId ?? null,
      status: subject.status ?? null,
    },
    credentialStatus: credentialStatus
      ? {
          id: credentialStatus.id ?? null,
          type: credentialStatus.type ?? null,
          statusPurpose: credentialStatus.statusPurpose ?? null,
          statusListId: credentialStatus.statusListId ?? null,
          statusListIndex: credentialStatus.statusListIndex ?? null,
        }
      : null,
    evidence: evidence
      ? {
          type: evidence.type ?? null,
          redacted: true,
        }
      : null,
    proof: proof
      ? {
          type: proof.type ?? null,
          created: proof.created ?? null,
          proofPurpose: proof.proofPurpose ?? null,
          verificationMethod: proof.verificationMethod ?? null,
          proofValue: null,
          proofValueRedacted: true,
        }
      : null,
    redacted: true,
  };
}

export function redactTimelineEntryForReadSession(entry = null) {
  return redactShallowFields(entry, {
    textFields: ["summary"],
    objectFields: ["details"],
  });
}

export function redactMemoryLayerViewForReadSession(memoryLayers = null) {
  if (!memoryLayers || typeof memoryLayers !== "object") {
    return memoryLayers;
  }

  return {
    counts: memoryLayers.counts ?? {},
    ledger: {
      commitmentCount: Array.isArray(memoryLayers.ledger?.commitments) ? memoryLayers.ledger.commitments.length : 0,
    },
    profile: {
      entryCount: Array.isArray(memoryLayers.profile?.entries) ? memoryLayers.profile.entries.length : 0,
      fieldKeys: Object.keys(memoryLayers.profile?.fieldValues || {}),
    },
    episodic: {
      entryCount: Array.isArray(memoryLayers.episodic?.entries) ? memoryLayers.episodic.entries.length : 0,
    },
    working: {
      entryCount: Array.isArray(memoryLayers.working?.entries) ? memoryLayers.working.entries.length : 0,
    },
    relevant: {
      profileCount: Array.isArray(memoryLayers.relevant?.profile) ? memoryLayers.relevant.profile.length : 0,
      episodicCount: Array.isArray(memoryLayers.relevant?.episodic) ? memoryLayers.relevant.episodic.length : 0,
      workingCount: Array.isArray(memoryLayers.relevant?.working) ? memoryLayers.relevant.working.length : 0,
      ledgerCommitmentCount: Array.isArray(memoryLayers.relevant?.ledgerCommitments)
        ? memoryLayers.relevant.ledgerCommitments.length
        : 0,
      redacted: true,
    },
  };
}

export function redactDeviceRuntimeForReadSession(deviceRuntime = null, accessOrSession = null) {
  if (!deviceRuntime || typeof deviceRuntime !== "object") {
    return deviceRuntime;
  }

  const sandboxPolicy = deviceRuntime.sandboxPolicy && typeof deviceRuntime.sandboxPolicy === "object"
    ? deviceRuntime.sandboxPolicy
    : {};

  const redacted = {
    ...deviceRuntime,
    retrievalPolicy: redactRetrievalPolicyForReadSession(deviceRuntime.retrievalPolicy),
    sandboxPolicy: {
      ...sandboxPolicy,
      filesystemAllowlistCount: Array.isArray(sandboxPolicy.filesystemAllowlist) ? sandboxPolicy.filesystemAllowlist.length : 0,
      networkAllowlistCount: Array.isArray(sandboxPolicy.networkAllowlist) ? sandboxPolicy.networkAllowlist.length : 0,
      allowedCommandsCount: Array.isArray(sandboxPolicy.allowedCommands) ? sandboxPolicy.allowedCommands.length : 0,
      filesystemAllowlist: [],
      networkAllowlist: [],
      allowedCommands: [],
    },
  };
  redacted.constrainedExecutionPolicy = cloneJson(redacted.sandboxPolicy);
  if (getReadSessionViewTemplate(accessOrSession, "deviceRuntime", "metadata_only") !== "summary_only") {
    return redacted;
  }
  return {
    deviceRuntimeId: redacted.deviceRuntimeId ?? null,
    machineId: redacted.machineId ?? null,
    machineLabel: redacted.machineLabel ?? null,
    residentAgentId: redacted.residentAgentId ?? null,
    residentDidMethod: redacted.residentDidMethod ?? null,
    residentLocked: redacted.residentLocked ?? null,
    localMode: redacted.localMode ?? null,
    allowOnlineReasoner: redacted.allowOnlineReasoner ?? null,
    securityPosture: redacted.securityPosture
      ? {
          mode: redacted.securityPosture.mode ?? null,
          summary: redacted.securityPosture.summary ?? null,
          writeLocked: redacted.securityPosture.writeLocked ?? null,
          executionLocked: redacted.securityPosture.executionLocked ?? null,
          networkEgressLocked: redacted.securityPosture.networkEgressLocked ?? null,
        }
      : null,
    commandPolicy: redacted.commandPolicy
      ? {
          negotiationMode: redacted.commandPolicy.negotiationMode ?? null,
          riskStrategies: redacted.commandPolicy.riskStrategies ?? {},
          requireExplicitConfirmation: redacted.commandPolicy.requireExplicitConfirmation ?? null,
        }
      : null,
    retrievalPolicy: redacted.retrievalPolicy
      ? {
          strategy: redacted.retrievalPolicy.strategy ?? null,
          allowVectorIndex: redacted.retrievalPolicy.allowVectorIndex ?? null,
          maxHits: redacted.retrievalPolicy.maxHits ?? null,
          externalColdMemory: redacted.retrievalPolicy.externalColdMemory
            ? {
                enabled: redacted.retrievalPolicy.externalColdMemory.enabled ?? null,
                provider: redacted.retrievalPolicy.externalColdMemory.provider ?? null,
                maxHits: redacted.retrievalPolicy.externalColdMemory.maxHits ?? null,
                timeoutMs: redacted.retrievalPolicy.externalColdMemory.timeoutMs ?? null,
                commandConfigured: redacted.retrievalPolicy.externalColdMemory.commandConfigured ?? null,
                palacePathConfigured: redacted.retrievalPolicy.externalColdMemory.palacePathConfigured ?? null,
              }
            : null,
        }
      : null,
    setupPolicy: redacted.setupPolicy
      ? {
          requireRecoveryBundle: redacted.setupPolicy.requireRecoveryBundle ?? null,
          requireSetupPackage: redacted.setupPolicy.requireSetupPackage ?? null,
          requireRecentRecoveryRehearsal: redacted.setupPolicy.requireRecentRecoveryRehearsal ?? null,
          recoveryRehearsalMaxAgeHours: redacted.setupPolicy.recoveryRehearsalMaxAgeHours ?? null,
          requireKeychainWhenAvailable: redacted.setupPolicy.requireKeychainWhenAvailable ?? null,
        }
      : null,
    localReasoner: redacted.localReasoner
      ? {
          enabled: redacted.localReasoner.enabled ?? null,
          provider: redacted.localReasoner.provider ?? null,
          configured: redacted.localReasoner.configured ?? null,
          model: redacted.localReasoner.model ?? null,
          format: redacted.localReasoner.format ?? null,
          lastProbe: redacted.localReasoner.lastProbe
            ? {
                checkedAt: redacted.localReasoner.lastProbe.checkedAt ?? null,
                status: redacted.localReasoner.lastProbe.status ?? null,
                reachable: redacted.localReasoner.lastProbe.reachable ?? null,
              }
            : null,
          lastWarm: redacted.localReasoner.lastWarm
            ? {
                warmedAt: redacted.localReasoner.lastWarm.warmedAt ?? null,
                status: redacted.localReasoner.lastWarm.status ?? null,
                reachable: redacted.localReasoner.lastWarm.reachable ?? null,
              }
            : null,
        }
      : null,
    sandboxPolicy: {
      allowedCapabilities: Array.isArray(redacted.sandboxPolicy?.allowedCapabilities)
        ? redacted.sandboxPolicy.allowedCapabilities
        : [],
      filesystemAllowlist: [],
      networkAllowlist: [],
      allowedCommands: [],
      filesystemAllowlistCount: redacted.sandboxPolicy?.filesystemAllowlistCount ?? 0,
      networkAllowlistCount: redacted.sandboxPolicy?.networkAllowlistCount ?? 0,
      allowedCommandsCount: redacted.sandboxPolicy?.allowedCommandsCount ?? 0,
      maxReadBytes: redacted.sandboxPolicy?.maxReadBytes ?? null,
      maxListEntries: redacted.sandboxPolicy?.maxListEntries ?? null,
      brokerIsolationEnabled: redacted.sandboxPolicy?.brokerIsolationEnabled ?? null,
      systemBrokerSandboxEnabled: redacted.sandboxPolicy?.systemBrokerSandboxEnabled ?? null,
      workerIsolationEnabled: redacted.sandboxPolicy?.workerIsolationEnabled ?? null,
      allowShellExecution: redacted.sandboxPolicy?.allowShellExecution ?? null,
      allowExternalNetwork: redacted.sandboxPolicy?.allowExternalNetwork ?? null,
    },
    constrainedExecutionPolicy: {
      allowedCapabilities: Array.isArray(redacted.sandboxPolicy?.allowedCapabilities)
        ? redacted.sandboxPolicy.allowedCapabilities
        : [],
      filesystemAllowlist: [],
      networkAllowlist: [],
      allowedCommands: [],
      filesystemAllowlistCount: redacted.sandboxPolicy?.filesystemAllowlistCount ?? 0,
      networkAllowlistCount: redacted.sandboxPolicy?.networkAllowlistCount ?? 0,
      allowedCommandsCount: redacted.sandboxPolicy?.allowedCommandsCount ?? 0,
      maxReadBytes: redacted.sandboxPolicy?.maxReadBytes ?? null,
      maxListEntries: redacted.sandboxPolicy?.maxListEntries ?? null,
      brokerIsolationEnabled: redacted.sandboxPolicy?.brokerIsolationEnabled ?? null,
      systemBrokerSandboxEnabled: redacted.sandboxPolicy?.systemBrokerSandboxEnabled ?? null,
      workerIsolationEnabled: redacted.sandboxPolicy?.workerIsolationEnabled ?? null,
      allowShellExecution: redacted.sandboxPolicy?.allowShellExecution ?? null,
      allowExternalNetwork: redacted.sandboxPolicy?.allowExternalNetwork ?? null,
    },
  };
}

export function redactDeviceRuntimeStateForReadSession(payload = null, accessOrSession = null) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  return {
    ...payload,
    deviceRuntime: redactDeviceRuntimeForReadSession(payload.deviceRuntime, accessOrSession),
  };
}

export function redactDeviceSetupStatusForReadSession(payload = null, accessOrSession = null) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const template = getReadSessionViewTemplate(accessOrSession, "deviceSetup", "metadata_only");
  const redacted = {
    ...payload,
    formalRecoveryFlow: redactFormalRecoveryFlowForReadSession(payload.formalRecoveryFlow),
    deviceRuntime: redactDeviceRuntimeForReadSession(payload.deviceRuntime, accessOrSession),
    recoveryBundles: payload.recoveryBundles
      ? redactRecoveryListingForReadSession(payload.recoveryBundles, accessOrSession)
      : null,
    recoveryRehearsals: payload.recoveryRehearsals
      ? {
          ...payload.recoveryRehearsals,
          rehearsals: Array.isArray(payload.recoveryRehearsals.rehearsals)
            ? payload.recoveryRehearsals.rehearsals.map((entry) =>
                redactRecoveryRehearsalForReadSession(entry, accessOrSession)
              )
            : [],
        }
      : null,
    setupPackages: payload.setupPackages
      ? redactSetupPackageListingForReadSession(payload.setupPackages, accessOrSession)
      : null,
  };
  if (template !== "summary_only") {
    return redacted;
  }
  return {
    setupComplete: redacted.setupComplete ?? null,
    missingRequiredCodes: Array.isArray(redacted.missingRequiredCodes) ? redacted.missingRequiredCodes : [],
    residentAgentId: redacted.residentAgentId ?? null,
    residentDidMethod: redacted.residentDidMethod ?? null,
    setupPolicy: redacted.setupPolicy ?? null,
    latestPassedRecoveryRehearsal: redacted.latestPassedRecoveryRehearsal
      ? {
          rehearsalId: redacted.latestPassedRecoveryRehearsal.rehearsalId ?? null,
          createdAt: redacted.latestPassedRecoveryRehearsal.createdAt ?? null,
          status: redacted.latestPassedRecoveryRehearsal.status ?? null,
          summary: redacted.latestPassedRecoveryRehearsal.summary ?? null,
        }
      : null,
    latestPassedRecoveryRehearsalAgeHours: redacted.latestPassedRecoveryRehearsalAgeHours ?? null,
    localReasonerDiagnostics: redacted.localReasonerDiagnostics
      ? {
          provider: redacted.localReasonerDiagnostics.provider ?? null,
          status: redacted.localReasonerDiagnostics.status ?? null,
          reachable: redacted.localReasonerDiagnostics.reachable ?? null,
          configured: redacted.localReasonerDiagnostics.configured ?? null,
          error: redacted.localReasonerDiagnostics.error ?? null,
        }
      : null,
    checks: Array.isArray(redacted.checks)
      ? redacted.checks.map((entry) => ({
          code: entry?.code ?? null,
          required: entry?.required ?? null,
          passed: entry?.passed ?? null,
          message: entry?.message ?? null,
        }))
      : [],
    formalRecoveryFlow: redacted.formalRecoveryFlow
      ? {
          status: redacted.formalRecoveryFlow.status ?? null,
          durableRestoreReady: redacted.formalRecoveryFlow.durableRestoreReady ?? null,
          missingRequiredCodes: Array.isArray(redacted.formalRecoveryFlow.missingRequiredCodes)
            ? redacted.formalRecoveryFlow.missingRequiredCodes
            : [],
          runbook: redacted.formalRecoveryFlow.runbook
            ? {
                status: redacted.formalRecoveryFlow.runbook.status ?? null,
                nextStepLabel: redacted.formalRecoveryFlow.runbook.nextStepLabel ?? null,
                nextStepSummary: redacted.formalRecoveryFlow.runbook.nextStepSummary ?? null,
              }
            : null,
          operationalCadence: redacted.formalRecoveryFlow.operationalCadence
            ? {
                status: redacted.formalRecoveryFlow.operationalCadence.status ?? null,
                actionSummary: redacted.formalRecoveryFlow.operationalCadence.actionSummary ?? null,
                summary: redacted.formalRecoveryFlow.operationalCadence.summary ?? null,
              }
            : null,
          crossDeviceRecoveryClosure: redacted.formalRecoveryFlow.crossDeviceRecoveryClosure
            ? {
                status: redacted.formalRecoveryFlow.crossDeviceRecoveryClosure.status ?? null,
                readyForRehearsal:
                  redacted.formalRecoveryFlow.crossDeviceRecoveryClosure.readyForRehearsal ?? null,
                readyForCutover:
                  redacted.formalRecoveryFlow.crossDeviceRecoveryClosure.readyForCutover ?? null,
                nextStepLabel: redacted.formalRecoveryFlow.crossDeviceRecoveryClosure.nextStepLabel ?? null,
                summary: redacted.formalRecoveryFlow.crossDeviceRecoveryClosure.summary ?? null,
                sourceBlockingReasons: Array.isArray(
                  redacted.formalRecoveryFlow.crossDeviceRecoveryClosure.sourceBlockingReasons
                )
                  ? redacted.formalRecoveryFlow.crossDeviceRecoveryClosure.sourceBlockingReasons
                  : [],
              }
            : null,
        }
      : null,
    recoveryBundles: redacted.recoveryBundles?.counts ? { counts: redacted.recoveryBundles.counts } : null,
    recoveryRehearsals: redacted.recoveryRehearsals?.counts
      ? { counts: redacted.recoveryRehearsals.counts, rehearsals: redacted.recoveryRehearsals.rehearsals }
      : null,
    setupPackages: redacted.setupPackages?.counts ? { counts: redacted.setupPackages.counts } : null,
    deviceRuntime: redacted.deviceRuntime,
  };
}

export function redactAgentRuntimeForReadSession(runtime = null, accessOrSession = null) {
  if (!runtime || typeof runtime !== "object") {
    return runtime;
  }
  const template = getReadSessionViewTemplate(accessOrSession, "agentRuntime", "metadata_only");
  const redacted = {
    ...runtime,
    taskSnapshot: redactTaskSnapshotForReadSession(runtime.taskSnapshot),
    taskSnapshots: Array.isArray(runtime.taskSnapshots) ? runtime.taskSnapshots.map(redactTaskSnapshotForReadSession) : [],
    decisionLogs: Array.isArray(runtime.decisionLogs) ? runtime.decisionLogs.map(redactDecisionLogForReadSession) : [],
    activeDecisions: Array.isArray(runtime.activeDecisions) ? runtime.activeDecisions.map(redactDecisionLogForReadSession) : [],
    conversationMinutes: Array.isArray(runtime.conversationMinutes)
      ? runtime.conversationMinutes.map(redactConversationMinuteForReadSession)
      : [],
    transcript: runtime.transcript
      ? {
          entryCount: runtime.transcript.entryCount ?? 0,
          latestTranscriptEntryId: runtime.transcript.latestTranscriptEntryId ?? null,
          entries: Array.isArray(runtime.transcript.entries)
            ? runtime.transcript.entries.map((entry) =>
                redactTranscriptEntryForReadSession(entry, accessOrSession)
              )
            : [],
        }
      : null,
    evidenceRefs: Array.isArray(runtime.evidenceRefs) ? runtime.evidenceRefs.map(redactEvidenceRefForReadSession) : [],
    deviceRuntime: redactDeviceRuntimeForReadSession(runtime.deviceRuntime, accessOrSession),
    retrievalPolicy: redactRetrievalPolicyForReadSession(runtime.retrievalPolicy),
    rehydratePreview: runtime.rehydratePreview
      ? redactShallowFields(runtime.rehydratePreview, {
          textFields: ["prompt"],
          objectFields: ["sources"],
        })
      : null,
  };
  if (template !== "summary_only") {
    return redacted;
  }
  return {
    counts: redacted.counts ?? {},
    taskSnapshot: redacted.taskSnapshot
      ? {
          snapshotId: redacted.taskSnapshot.snapshotId ?? null,
          status: redacted.taskSnapshot.status ?? null,
          updatedAt: redacted.taskSnapshot.updatedAt ?? null,
        }
      : null,
    transcript: redacted.transcript
      ? {
          entryCount: redacted.transcript.entryCount ?? 0,
          latestTranscriptEntryId: redacted.transcript.latestTranscriptEntryId ?? null,
          entries: [],
        }
      : null,
    retrievalPolicy: redacted.retrievalPolicy
      ? {
          strategy: redacted.retrievalPolicy.strategy ?? null,
          allowVectorIndex: redacted.retrievalPolicy.allowVectorIndex ?? null,
          maxHits: redacted.retrievalPolicy.maxHits ?? null,
          externalColdMemory: redacted.retrievalPolicy.externalColdMemory
            ? {
                enabled: redacted.retrievalPolicy.externalColdMemory.enabled ?? null,
                provider: redacted.retrievalPolicy.externalColdMemory.provider ?? null,
                maxHits: redacted.retrievalPolicy.externalColdMemory.maxHits ?? null,
                timeoutMs: redacted.retrievalPolicy.externalColdMemory.timeoutMs ?? null,
                commandConfigured: redacted.retrievalPolicy.externalColdMemory.commandConfigured ?? null,
                palacePathConfigured: redacted.retrievalPolicy.externalColdMemory.palacePathConfigured ?? null,
              }
            : null,
        }
      : null,
    deviceRuntime: redacted.deviceRuntime,
    rehydratePreview: redacted.rehydratePreview
      ? {
          promptRedacted: Boolean(redacted.rehydratePreview.promptRedacted),
          promptLength: redacted.rehydratePreview.promptLength ?? 0,
          sourcesRedacted: Boolean(redacted.rehydratePreview.sourcesRedacted),
        }
      : null,
  };
}

export function redactAgentContextForReadSession(context = null, accessOrSession = null) {
  if (!context || typeof context !== "object") {
    return context;
  }

  return {
    ...context,
    agent: redactAgentRecordForReadSession(context.agent),
    identity: redactIdentityForReadSession(context.identity),
    memories: Array.isArray(context.memories) ? context.memories.map(redactMemoryForReadSession) : [],
    inbox: Array.isArray(context.inbox) ? context.inbox.map(redactMessageForReadSession) : [],
    outbox: Array.isArray(context.outbox) ? context.outbox.map(redactMessageForReadSession) : [],
    authorizations: Array.isArray(context.authorizations)
      ? context.authorizations.map(redactAuthorizationViewForReadSession)
      : [],
    credentials: Array.isArray(context.credentials) ? context.credentials.map(redactCredentialRecordForReadSession) : [],
    migrationRepairs: Array.isArray(context.migrationRepairs)
      ? context.migrationRepairs.map(redactMigrationRepairViewForReadSession)
      : [],
    runtime: redactAgentRuntimeForReadSession(context.runtime, accessOrSession),
    memoryLayers: redactMemoryLayerViewForReadSession(context.memoryLayers),
    compactBoundaries: Array.isArray(context.compactBoundaries)
      ? context.compactBoundaries.map(redactCompactBoundaryForReadSession)
      : [],
    agentRuns: Array.isArray(context.agentRuns) ? context.agentRuns.map(redactAgentRunForReadSession) : [],
    agentQueryStates: Array.isArray(context.agentQueryStates)
      ? context.agentQueryStates.map(redactQueryStateForReadSession)
      : [],
    sessionState: redactSessionStateForReadSession(context.sessionState, accessOrSession),
  };
}

export function redactAgentRehydratePackForReadSession(rehydrate = null, accessOrSession = null) {
  if (!rehydrate || typeof rehydrate !== "object") {
    return rehydrate;
  }

  return {
    ...rehydrate,
    taskSnapshot: redactTaskSnapshotForReadSession(rehydrate.taskSnapshot),
    activeDecisions: Array.isArray(rehydrate.activeDecisions)
      ? rehydrate.activeDecisions.map(redactDecisionLogForReadSession)
      : [],
    evidenceRefs: Array.isArray(rehydrate.evidenceRefs)
      ? rehydrate.evidenceRefs.map(redactEvidenceRefForReadSession)
      : [],
    recentMemories: Array.isArray(rehydrate.recentMemories)
      ? rehydrate.recentMemories.map(redactMemoryForReadSession)
      : [],
    recentInbox: Array.isArray(rehydrate.recentInbox)
      ? rehydrate.recentInbox.map(redactMessageForReadSession)
      : [],
    recentOutbox: Array.isArray(rehydrate.recentOutbox)
      ? rehydrate.recentOutbox.map(redactMessageForReadSession)
      : [],
    recentAuthorizations: Array.isArray(rehydrate.recentAuthorizations)
      ? rehydrate.recentAuthorizations.map(redactAuthorizationViewForReadSession)
      : [],
    recentCredentials: Array.isArray(rehydrate.recentCredentials)
      ? rehydrate.recentCredentials.map(redactCredentialRecordForReadSession)
      : [],
    transcriptModel: rehydrate.transcriptModel
      ? {
          ...rehydrate.transcriptModel,
          entries: Array.isArray(rehydrate.transcriptModel.entries)
            ? rehydrate.transcriptModel.entries.map((entry) =>
                redactTranscriptEntryForReadSession(entry, accessOrSession)
              )
            : [],
        }
      : null,
    localKnowledgeHits: Array.isArray(rehydrate.localKnowledgeHits)
      ? rehydrate.localKnowledgeHits.map(redactRuntimeSearchHitForReadSession)
      : [],
    externalColdMemoryHits: Array.isArray(rehydrate.externalColdMemoryHits)
      ? rehydrate.externalColdMemoryHits.map(redactRuntimeSearchHitForReadSession)
      : [],
    deviceRuntime: redactDeviceRuntimeForReadSession(rehydrate.deviceRuntime, accessOrSession),
    resumeBoundary: redactCompactBoundaryForReadSession(rehydrate.resumeBoundary),
    queryState: redactQueryStateForReadSession(rehydrate.queryState),
    prompt: null,
    promptRedacted: Boolean(normalizeOptionalText(rehydrate.prompt)),
    promptLength: typeof rehydrate.prompt === "string" ? rehydrate.prompt.length : 0,
  };
}

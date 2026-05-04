import { cloneJson } from "./ledger-core-utils.js";
import { normalizeOptionalText } from "./server-base-helpers.js";
import { resolveResidentBindingSnapshot } from "./ledger-device-runtime.js";
import {
  authorizationMatchesReadSession,
  credentialMatchesReadSession,
  getReadSessionViewTemplate,
  migrationRepairMatchesReadSession,
  statusListMatchesReadSession,
  windowMatchesReadSession,
} from "./server-read-access.js";
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

function normalizeResidentBindingForReadSession(record = null, { fallbackRecord = null } = {}) {
  return resolveResidentBindingSnapshot(record, { fallbackRecord });
}

export function redactEvidenceRefForReadSession(evidenceRef = null) {
  const redacted = redactShallowFields(evidenceRef, {
    textFields: ["title", "summary", "uri", "note"],
    objectFields: ["metadata"],
  });
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) {
    return redacted;
  }
  const binding = normalizeResidentBindingForReadSession(redacted);
  return {
    ...redacted,
    ...binding,
  };
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

function pickDefinedReadSessionValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

function normalizeModelProfileForReadSession(profile = null) {
  if (!profile || typeof profile !== "object") {
    return profile;
  }
  return {
    ...profile,
    modelName: pickDefinedReadSessionValue(profile.modelName, profile.model_name),
    ecl085: pickDefinedReadSessionValue(profile.ecl085, profile.ecl_085),
    midDrop: pickDefinedReadSessionValue(profile.midDrop, profile.mid_drop),
    createdAt: pickDefinedReadSessionValue(profile.createdAt, profile.created_at),
  };
}

export function redactModelProfileForReadSession(profile = null, accessOrSession = null) {
  if (!profile || typeof profile !== "object") {
    return profile;
  }
  const template = getReadSessionViewTemplate(accessOrSession, "agentRuntime", "metadata_only");
  const normalized = normalizeModelProfileForReadSession(profile);
  const benchmarkMeta =
    normalized.benchmarkMeta && typeof normalized.benchmarkMeta === "object" ? normalized.benchmarkMeta : null;
  const redacted = {
    ...normalized,
    benchmarkMeta: benchmarkMeta
      ? {
          ...benchmarkMeta,
          rawScenarios: [],
          rawScenarioCount: Array.isArray(benchmarkMeta.rawScenarios) ? benchmarkMeta.rawScenarios.length : 0,
        }
      : null,
  };
  if (template !== "summary_only") {
    return redacted;
  }
  return {
    modelName: redacted.modelName ?? null,
    ccrs: redacted.ccrs ?? null,
    ecl085: redacted.ecl085 ?? null,
    pr: redacted.pr ?? null,
    midDrop: redacted.midDrop ?? null,
    createdAt: redacted.createdAt ?? null,
  };
}

function normalizeMemoryAnchorForReadSession(anchor = null) {
  if (!anchor || typeof anchor !== "object") {
    return anchor;
  }
  return {
    ...anchor,
    memoryId: pickDefinedReadSessionValue(anchor.memoryId, anchor.memory_id),
    insertedPosition: pickDefinedReadSessionValue(anchor.insertedPosition, anchor.inserted_position),
    importanceWeight: pickDefinedReadSessionValue(anchor.importanceWeight, anchor.importance_weight),
    lastVerifiedAt: pickDefinedReadSessionValue(anchor.lastVerifiedAt, anchor.last_verified_at),
    lastVerifiedOk: pickDefinedReadSessionValue(anchor.lastVerifiedOk, anchor.last_verified_ok),
  };
}

export function redactMemoryAnchorForReadSession(anchor = null, accessOrSession = null) {
  if (!anchor || typeof anchor !== "object") {
    return anchor;
  }
  const template = getReadSessionViewTemplate(accessOrSession, "agentRuntime", "metadata_only");
  const redacted = redactShallowFields(normalizeMemoryAnchorForReadSession(anchor), {
    textFields: ["content", "expectedValue", "probeQuestion"],
    objectFields: ["metadata", "conflictState"],
  });
  if (template !== "summary_only") {
    return redacted;
  }
  return {
    memoryId: redacted.memoryId ?? null,
    source: redacted.source ?? null,
    insertedPosition: redacted.insertedPosition ?? null,
    importanceWeight: redacted.importanceWeight ?? null,
    lastVerifiedAt: redacted.lastVerifiedAt ?? null,
    lastVerifiedOk: redacted.lastVerifiedOk ?? null,
    conflictStateRedacted: Boolean(redacted.conflictStateRedacted),
  };
}

function normalizeRuntimeMemoryStateForReadSession(state = null) {
  if (!state || typeof state !== "object") {
    return state;
  }
  return {
    ...state,
    sessionId: pickDefinedReadSessionValue(state.sessionId, state.session_id),
    agentId: pickDefinedReadSessionValue(state.agentId, state.agent_id),
    modelName: pickDefinedReadSessionValue(state.modelName, state.model_name),
    ctxTokens: pickDefinedReadSessionValue(state.ctxTokens, state.ctx_tokens),
    checkedMemories: pickDefinedReadSessionValue(state.checkedMemories, state.checked_memories),
    conflictMemories: pickDefinedReadSessionValue(state.conflictMemories, state.conflict_memories),
    vT: pickDefinedReadSessionValue(state.vT, state.v_t),
    lT: pickDefinedReadSessionValue(state.lT, state.l_t),
    rPosT: pickDefinedReadSessionValue(state.rPosT, state.r_pos_t),
    xT: pickDefinedReadSessionValue(state.xT, state.x_t),
    sT: pickDefinedReadSessionValue(state.sT, state.s_t),
    cT: pickDefinedReadSessionValue(state.cT, state.c_t),
    correctionLevel: pickDefinedReadSessionValue(state.correctionLevel, state.correction_level),
    updatedAt: pickDefinedReadSessionValue(state.updatedAt, state.updated_at),
    memoryAnchors: Array.isArray(state.memoryAnchors || state.memory_anchors)
      ? (state.memoryAnchors || state.memory_anchors).map((anchor) =>
          normalizeMemoryAnchorForReadSession(anchor)
        )
      : [],
    profile: normalizeModelProfileForReadSession(state.profile || state.modelProfile),
  };
}

export function redactRuntimeMemoryStateForReadSession(state = null, accessOrSession = null) {
  if (!state || typeof state !== "object") {
    return state;
  }
  const template = getReadSessionViewTemplate(accessOrSession, "agentRuntime", "metadata_only");
  const normalized = normalizeRuntimeMemoryStateForReadSession(state);
  const redacted = {
    ...normalized,
    memoryAnchors: Array.isArray(normalized.memoryAnchors)
      ? normalized.memoryAnchors.map((anchor) =>
          redactMemoryAnchorForReadSession(anchor, accessOrSession)
        )
      : [],
    profile: redactModelProfileForReadSession(normalized.profile, accessOrSession),
  };
  if (template !== "summary_only") {
    return redacted;
  }
  return {
    runtimeMemoryStateId: redacted.runtimeMemoryStateId ?? null,
    sessionId: redacted.sessionId ?? null,
    agentId: redacted.agentId ?? null,
    modelName: redacted.modelName ?? null,
    ctxTokens: redacted.ctxTokens ?? null,
    memoryAnchorCount: Array.isArray(redacted.memoryAnchors) ? redacted.memoryAnchors.length : 0,
    checkedMemories: redacted.checkedMemories ?? 0,
    conflictMemories: redacted.conflictMemories ?? 0,
    vT: redacted.vT ?? null,
    lT: redacted.lT ?? null,
    rPosT: redacted.rPosT ?? null,
    xT: redacted.xT ?? null,
    sT: redacted.sT ?? null,
    cT: redacted.cT ?? null,
    correctionLevel: redacted.correctionLevel ?? null,
    updatedAt: redacted.updatedAt ?? null,
    profile: redactModelProfileForReadSession(normalized.profile, accessOrSession),
  };
}

function normalizeRuntimeMemoryObservationForReadSession(observation = null) {
  if (!observation || typeof observation !== "object") {
    return observation;
  }
  return {
    ...observation,
    observationId: pickDefinedReadSessionValue(observation.observationId, observation.observation_id),
    runtimeMemoryStateId: pickDefinedReadSessionValue(
      observation.runtimeMemoryStateId,
      observation.runtime_memory_state_id
    ),
    agentId: pickDefinedReadSessionValue(observation.agentId, observation.agent_id),
    modelName: pickDefinedReadSessionValue(observation.modelName, observation.model_name),
    observedAt: pickDefinedReadSessionValue(observation.observedAt, observation.observed_at),
    sourceKind: pickDefinedReadSessionValue(observation.sourceKind, observation.source_kind),
    observationKind: pickDefinedReadSessionValue(observation.observationKind, observation.observation_kind),
    observationRole: pickDefinedReadSessionValue(observation.observationRole, observation.observation_role),
    riskTrend: pickDefinedReadSessionValue(observation.riskTrend, observation.risk_trend),
    recoverySignal: pickDefinedReadSessionValue(observation.recoverySignal, observation.recovery_signal),
    ctxTokens: pickDefinedReadSessionValue(observation.ctxTokens, observation.ctx_tokens),
    sT: pickDefinedReadSessionValue(observation.sT, observation.s_t),
    cT: pickDefinedReadSessionValue(observation.cT, observation.c_t),
    correctionLevel: pickDefinedReadSessionValue(observation.correctionLevel, observation.correction_level),
    correctionRequested: pickDefinedReadSessionValue(
      observation.correctionRequested,
      observation.correction_requested
    ),
    correctionApplied: pickDefinedReadSessionValue(observation.correctionApplied, observation.correction_applied),
    probeCheckedCount: pickDefinedReadSessionValue(observation.probeCheckedCount, observation.probe_checked_count),
    probeFailureCount: pickDefinedReadSessionValue(observation.probeFailureCount, observation.probe_failure_count),
    sessionId: pickDefinedReadSessionValue(observation.sessionId, observation.session_id),
    correctionActions: Array.isArray(observation.correctionActions || observation.correction_actions)
      ? (observation.correctionActions || observation.correction_actions).filter(Boolean)
      : [],
    instabilityReasons: Array.isArray(observation.instabilityReasons || observation.instability_reasons)
      ? (observation.instabilityReasons || observation.instability_reasons).filter(Boolean)
      : [],
  };
}

export function redactRuntimeMemoryObservationForReadSession(observation = null, accessOrSession = null) {
  if (!observation || typeof observation !== "object") {
    return observation;
  }
  const template = getReadSessionViewTemplate(accessOrSession, "agentRuntime", "metadata_only");
  const normalized = normalizeRuntimeMemoryObservationForReadSession(observation);
  if (template === "standard_read") {
    return cloneJson(normalized) ?? null;
  }
  const correctionActions = Array.isArray(normalized.correctionActions) ? normalized.correctionActions : [];
  const instabilityReasons = Array.isArray(normalized.instabilityReasons) ? normalized.instabilityReasons : [];
  return {
    observationId: normalized.observationId ?? null,
    runtimeMemoryStateId: normalized.runtimeMemoryStateId ?? null,
    agentId: normalized.agentId ?? null,
    modelName: normalized.modelName ?? null,
    observedAt: normalized.observedAt ?? null,
    sourceKind: normalized.sourceKind ?? null,
    observationKind: normalized.observationKind ?? null,
    observationRole: normalized.observationRole ?? null,
    riskTrend: normalized.riskTrend ?? null,
    recoverySignal: normalized.recoverySignal ?? null,
    ctxTokens: normalized.ctxTokens ?? null,
    sT: normalized.sT ?? null,
    cT: normalized.cT ?? null,
    correctionLevel: normalized.correctionLevel ?? null,
    correctionRequested: normalized.correctionRequested ?? null,
    correctionApplied: normalized.correctionApplied ?? null,
    probeCheckedCount: normalized.probeCheckedCount ?? null,
    probeFailureCount: normalized.probeFailureCount ?? null,
    sessionId: null,
    sessionIdRedacted: normalized.sessionId != null,
    correctionActionCount: correctionActions.length,
    instabilityReasonCount: instabilityReasons.length,
  };
}

function normalizeRuntimeMemoryObservationEffectivenessForReadSession(effectiveness = null) {
  if (!effectiveness || typeof effectiveness !== "object") {
    return effectiveness;
  }
  return {
    ...effectiveness,
    correctionRequestedCount: pickDefinedReadSessionValue(
      effectiveness.correctionRequestedCount,
      effectiveness.correction_requested_count
    ),
    correctionAppliedCount: pickDefinedReadSessionValue(
      effectiveness.correctionAppliedCount,
      effectiveness.correction_applied_count
    ),
    correctionEscalatedCount: pickDefinedReadSessionValue(
      effectiveness.correctionEscalatedCount,
      effectiveness.correction_escalated_count
    ),
    trackedCorrectionCount: pickDefinedReadSessionValue(
      effectiveness.trackedCorrectionCount,
      effectiveness.tracked_correction_count
    ),
    recoveredCount: pickDefinedReadSessionValue(effectiveness.recoveredCount, effectiveness.recovered_count),
    unresolvedCount: pickDefinedReadSessionValue(effectiveness.unresolvedCount, effectiveness.unresolved_count),
    recoveryRate: pickDefinedReadSessionValue(effectiveness.recoveryRate, effectiveness.recovery_rate),
    averageCTReduction: pickDefinedReadSessionValue(
      effectiveness.averageCTReduction,
      effectiveness.average_c_t_reduction
    ),
    averageSTGain: pickDefinedReadSessionValue(effectiveness.averageSTGain, effectiveness.average_s_t_gain),
    averageLagObservations: pickDefinedReadSessionValue(
      effectiveness.averageLagObservations,
      effectiveness.average_lag_observations
    ),
    latestRecoveredPair: pickDefinedReadSessionValue(
      effectiveness.latestRecoveredPair,
      effectiveness.latest_recovered_pair
    ),
    latestPendingUnstable: pickDefinedReadSessionValue(
      effectiveness.latestPendingUnstable,
      effectiveness.latest_pending_unstable
    ),
    recentRecoveredPairs: pickDefinedReadSessionValue(
      effectiveness.recentRecoveredPairs,
      effectiveness.recent_recovered_pairs
    ),
  };
}

function redactRuntimeMemoryObservationEffectivenessForReadSession(effectiveness = null, accessOrSession = null) {
  if (!effectiveness || typeof effectiveness !== "object") {
    return effectiveness;
  }
  const normalized = normalizeRuntimeMemoryObservationEffectivenessForReadSession(effectiveness);
  return {
    correctionRequestedCount: Number(normalized.correctionRequestedCount || 0),
    correctionAppliedCount: Number(normalized.correctionAppliedCount || 0),
    correctionEscalatedCount: Number(normalized.correctionEscalatedCount || 0),
    trackedCorrectionCount: Number(normalized.trackedCorrectionCount || 0),
    recoveredCount: Number(normalized.recoveredCount || 0),
    unresolvedCount: Number(normalized.unresolvedCount || 0),
    recoveryRate: normalized.recoveryRate ?? null,
    averageCTReduction: normalized.averageCTReduction ?? null,
    averageSTGain: normalized.averageSTGain ?? null,
    averageLagObservations: normalized.averageLagObservations ?? null,
    latestRecoveredPair: null,
    latestPendingUnstable: null,
    recentRecoveredPairs: [],
    recoveryDetailsRedacted: Boolean(
      normalized.latestRecoveredPair != null ||
      normalized.latestPendingUnstable != null ||
      (Array.isArray(normalized.recentRecoveredPairs) && normalized.recentRecoveredPairs.length > 0)
    ),
  };
}

function normalizeRuntimeMemoryObservationCollectionSummaryForReadSession(summary = null) {
  if (!summary || typeof summary !== "object") {
    return summary;
  }
  return {
    ...summary,
    totalCount: pickDefinedReadSessionValue(summary.totalCount, summary.total_count),
    stableCount: pickDefinedReadSessionValue(summary.stableCount, summary.stable_count),
    unstableCount: pickDefinedReadSessionValue(summary.unstableCount, summary.unstable_count),
    roleCounts: pickDefinedReadSessionValue(summary.roleCounts, summary.role_counts) ?? {},
    effectiveness: normalizeRuntimeMemoryObservationEffectivenessForReadSession(summary.effectiveness),
    latestObservation: normalizeRuntimeMemoryObservationForReadSession(
      summary.latestObservation || summary.latest_observation
    ),
    latestUnstableObservation: normalizeRuntimeMemoryObservationForReadSession(
      summary.latestUnstableObservation || summary.latest_unstable_observation
    ),
    recent: Array.isArray(summary.recent || summary.recent_observations)
      ? (summary.recent || summary.recent_observations).map((entry) =>
          normalizeRuntimeMemoryObservationForReadSession(entry)
        )
      : [],
  };
}

export function redactRuntimeMemoryObservationCollectionSummaryForReadSession(summary = null, accessOrSession = null) {
  if (!summary || typeof summary !== "object") {
    return summary;
  }
  const template = getReadSessionViewTemplate(accessOrSession, "agentRuntime", "metadata_only");
  const normalized = normalizeRuntimeMemoryObservationCollectionSummaryForReadSession(summary);
  return {
    totalCount: Number(normalized.totalCount || 0),
    stableCount: Number(normalized.stableCount || 0),
    unstableCount: Number(normalized.unstableCount || 0),
    roleCounts: cloneJson(normalized.roleCounts) ?? {},
    effectiveness: redactRuntimeMemoryObservationEffectivenessForReadSession(normalized.effectiveness, accessOrSession),
    latestObservation: redactRuntimeMemoryObservationForReadSession(normalized.latestObservation, accessOrSession),
    latestUnstableObservation: redactRuntimeMemoryObservationForReadSession(
      normalized.latestUnstableObservation,
      accessOrSession
    ),
    recentCount: Array.isArray(normalized.recent) ? normalized.recent.length : 0,
    recent: template === "summary_only"
      ? []
      : Array.isArray(normalized.recent)
        ? normalized.recent.map((entry) => redactRuntimeMemoryObservationForReadSession(entry, accessOrSession))
        : [],
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
    failureSemantics: cloneJson(audit.failureSemantics) ?? null,
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
                handoffPacket: audit.setupStatus.formalRecoveryFlow.handoffPacket
                  ? {
                      status: audit.setupStatus.formalRecoveryFlow.handoffPacket.status ?? null,
                      readyToHandoff: audit.setupStatus.formalRecoveryFlow.handoffPacket.readyToHandoff ?? null,
                      missingFieldIds: cloneJson(audit.setupStatus.formalRecoveryFlow.handoffPacket.missingFieldIds) ?? [],
                      uniqueBlockingReason: audit.setupStatus.formalRecoveryFlow.handoffPacket.uniqueBlockingReason
                        ? {
                            code:
                              audit.setupStatus.formalRecoveryFlow.handoffPacket.uniqueBlockingReason.code ?? null,
                            label:
                              audit.setupStatus.formalRecoveryFlow.handoffPacket.uniqueBlockingReason.label ?? null,
                          }
                        : null,
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
                failureSemantics: cloneJson(audit.setupStatus.automaticRecoveryReadiness.failureSemantics) ?? null,
              }
            : null,
          activePlanReadiness: audit.setupStatus.activePlanReadiness
            ? {
                status: audit.setupStatus.activePlanReadiness.status ?? null,
                ready: audit.setupStatus.activePlanReadiness.ready ?? null,
                formalFlowReady: audit.setupStatus.activePlanReadiness.formalFlowReady ?? null,
                gateReasons: cloneJson(audit.setupStatus.activePlanReadiness.gateReasons) ?? [],
                dependencyWarnings: cloneJson(audit.setupStatus.activePlanReadiness.dependencyWarnings) ?? [],
                failureSemantics: cloneJson(audit.setupStatus.activePlanReadiness.failureSemantics) ?? null,
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
          failureSemantics: cloneJson(audit.closure.failureSemantics) ?? null,
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
  const memoryHomeostasis =
    sessionState.memoryHomeostasis && typeof sessionState.memoryHomeostasis === "object"
      ? sessionState.memoryHomeostasis
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
    memoryHomeostasis: memoryHomeostasis
      ? redactRuntimeMemoryStateForReadSession(memoryHomeostasis, accessOrSession)
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
    memoryHomeostasis: redacted.memoryHomeostasis
      ? {
          runtimeMemoryStateId: redacted.memoryHomeostasis.runtimeMemoryStateId ?? null,
          modelName: redacted.memoryHomeostasis.modelName ?? null,
          checkedMemories: redacted.memoryHomeostasis.checkedMemories ?? 0,
          conflictMemories: redacted.memoryHomeostasis.conflictMemories ?? 0,
          sT: redacted.memoryHomeostasis.sT ?? null,
          cT: redacted.memoryHomeostasis.cT ?? null,
          correctionLevel: redacted.memoryHomeostasis.correctionLevel ?? null,
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
    arrayFields: ["alternates", "repairHistory", "siblings", "siblingMethods"],
    objectFields: ["migrationLinks", "statusList", "statusProof"],
  });
}

export function redactAuthorizationViewForReadSession(authorization = null) {
  if (!authorization || typeof authorization !== "object") {
    return authorization;
  }

  const approvals = Array.isArray(authorization.approvals) ? authorization.approvals : [];
  const signatures = Array.isArray(authorization.signatures) ? authorization.signatures : [];
  const signatureRecords = Array.isArray(authorization.signatureRecords) ? authorization.signatureRecords : [];
  const timeline = Array.isArray(authorization.timeline) ? authorization.timeline : [];
  const relatedAgentIds = Array.isArray(authorization.relatedAgentIds) ? authorization.relatedAgentIds : [];
  const relatedWindowIds = Array.isArray(authorization.relatedWindowIds) ? authorization.relatedWindowIds : [];

  return {
    proposalId: authorization.proposalId ?? authorization.authorizationId ?? null,
    authorizationId: authorization.authorizationId ?? authorization.proposalId ?? null,
    policyAgentId: authorization.policyAgentId ?? authorization.policyAgent?.agentId ?? null,
    actionType: authorization.actionType ?? null,
    status: authorization.status ?? null,
    approvalCount: authorization.approvalCount ?? approvals.length,
    signatureCount: authorization.signatureCount ?? signatures.length,
    signatureRecordCount: authorization.signatureRecordCount ?? signatureRecords.length,
    timelineCount: authorization.timelineCount ?? timeline.length,
    relatedAgentCount: authorization.relatedAgentCount ?? relatedAgentIds.length,
    relatedWindowCount: authorization.relatedWindowCount ?? relatedWindowIds.length,
    threshold: authorization.threshold ?? authorization.policy?.threshold ?? null,
    availableAt: authorization.availableAt ?? null,
    expiresAt: authorization.expiresAt ?? null,
    createdAt: authorization.createdAt ?? null,
    updatedAt: authorization.updatedAt ?? null,
    executedAt: authorization.executedAt ?? null,
    revokedAt: authorization.revokedAt ?? null,
    latestSignatureAt: authorization.latestSignatureAt ?? authorization.lastSignedAt ?? null,
    createdByAgentId: authorization.createdByAgentId ?? null,
    createdByWindowId: authorization.createdByWindowId ?? authorization.sourceWindowId ?? null,
    lastSignedByAgentId: authorization.lastSignedByAgentId ?? null,
    lastSignedWindowId: authorization.lastSignedWindowId ?? null,
    title: null,
    titleRedacted: authorization.title != null,
    titleLength: typeof authorization.title === "string" ? authorization.title.length : null,
    description: null,
    descriptionRedacted: authorization.description != null,
    descriptionLength: typeof authorization.description === "string" ? authorization.description.length : null,
    summary: null,
    summaryRedacted: authorization.summary != null,
    note: null,
    noteRedacted: authorization.note != null,
    lastError: null,
    lastErrorRedacted: authorization.lastError != null,
    payload: null,
    payloadRedacted: authorization.payload != null,
    executionResult: null,
    executionResultRedacted: authorization.executionResult != null,
    executionReceipt: null,
    executionReceiptRedacted: authorization.executionReceipt != null,
    executionRecord: null,
    executionRecordRedacted: authorization.executionRecord != null,
    approvals: [],
    signatures: [],
    signatureRecords: [],
    timeline: [],
    relatedAgentIds: [],
    relatedWindowIds: [],
    redacted: true,
  };
}

export function redactMigrationRepairViewForReadSession(repair = null) {
  return redactShallowFields(repair, {
    textFields: ["summary"],
    arrayFields: [
      "linkedCredentialRecordIds",
      "linkedCredentialIds",
      "linkedSubjects",
      "linkedComparisons",
    ],
    objectFields: [
      "links",
      "issuerDidByMethod",
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

  const entries = Array.isArray(statusList.entries) ? statusList.entries : [];
  return {
    statusListId: statusList.statusListId ?? null,
    summary: redactStatusListSummaryForReadSession(statusList.summary),
    statusList: summarizeCredentialDocumentForReadSession(statusList.statusList),
    entryCount: entries.length,
    entries: [],
    entriesRedacted: entries.length > 0,
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
      entryCount: Array.isArray(side.entries) ? side.entries.length : side.entryCount ?? 0,
      entries: [],
      entriesRedacted: Array.isArray(side.entries) && side.entries.length > 0,
      issuerIdentity: redactStatusListIssuerProfileForReadSession(side.issuerIdentity),
    };
  };
  const countEntrySummary = (entries = []) => (Array.isArray(entries) ? entries.length : 0);

  return {
    ...comparison,
    left: redactSide(comparison.left),
    right: redactSide(comparison.right),
    comparison: comparison.comparison
      ? {
          ...comparison.comparison,
          leftEntrySummary: [],
          leftEntrySummaryCount: countEntrySummary(comparison.comparison.leftEntrySummary),
          leftEntrySummaryRedacted: countEntrySummary(comparison.comparison.leftEntrySummary) > 0,
          rightEntrySummary: [],
          rightEntrySummaryCount: countEntrySummary(comparison.comparison.rightEntrySummary),
          rightEntrySummaryRedacted: countEntrySummary(comparison.comparison.rightEntrySummary) > 0,
          sharedEntrySummary: [],
          sharedEntrySummaryCount: countEntrySummary(comparison.comparison.sharedEntrySummary),
          sharedEntrySummaryRedacted: countEntrySummary(comparison.comparison.sharedEntrySummary) > 0,
          leftOnlyEntrySummary: [],
          leftOnlyEntrySummaryCount: countEntrySummary(comparison.comparison.leftOnlyEntrySummary),
          leftOnlyEntrySummaryRedacted: countEntrySummary(comparison.comparison.leftOnlyEntrySummary) > 0,
          rightOnlyEntrySummary: [],
          rightOnlyEntrySummaryCount: countEntrySummary(comparison.comparison.rightOnlyEntrySummary),
          rightOnlyEntrySummaryRedacted: countEntrySummary(comparison.comparison.rightOnlyEntrySummary) > 0,
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

  const alternates = Array.isArray(payload.alternates) ? payload.alternates : [];
  return {
    ...payload,
    credential: summarizeCredentialDocumentForReadSession(payload.credential),
    credentialRecord: redactCredentialRecordForReadSession(payload.credentialRecord),
    alternateCount: payload.alternateCount ?? alternates.length,
    alternates: [],
    alternatesRedacted: alternates.length > 0,
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
  const authorizedCredentialIds = new Set(
    [
      status.credentialRecordId,
      status.credentialId,
      status.credentialRecord?.credentialRecordId,
      status.credentialRecord?.credentialId,
      status.credential?.id,
      status.statusEntry?.credentialRecordId,
      status.statusEntry?.credentialId,
      statusProof?.credentialRecordId,
      statusProof?.credentialId,
    ]
      .map((item) => normalizeOptionalText(item))
      .filter(Boolean)
  );
  const statusListEntries = Array.isArray(status.statusList?.entries)
    ? status.statusList.entries.filter((entry) => {
        const entryCredentialIds = [
          entry?.credentialRecordId,
          entry?.credentialId,
        ]
          .map((item) => normalizeOptionalText(item))
          .filter(Boolean);
        return entryCredentialIds.some((credentialId) => authorizedCredentialIds.has(credentialId));
      })
    : [];

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
          entries: statusListEntries.map(redactStatusListEntryForReadSession),
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
  const residentBinding = normalizeResidentBindingForReadSession(deviceRuntime);
  redacted.physicalResidentAgentId = residentBinding.physicalResidentAgentId;
  redacted.residentAgentId = residentBinding.residentAgentId;
  redacted.residentAgentReference = residentBinding.residentAgentReference;
  redacted.resolvedResidentAgentId = residentBinding.resolvedResidentAgentId;
  redacted.constrainedExecutionPolicy = cloneJson(redacted.sandboxPolicy);
  if (getReadSessionViewTemplate(accessOrSession, "deviceRuntime", "metadata_only") !== "summary_only") {
    return redacted;
  }
  return {
    deviceRuntimeId: redacted.deviceRuntimeId ?? null,
    machineId: redacted.machineId ?? null,
    machineLabel: redacted.machineLabel ?? null,
    physicalResidentAgentId: redacted.physicalResidentAgentId ?? null,
    residentAgentId: redacted.residentAgentId ?? null,
    residentAgentReference: redacted.residentAgentReference ?? null,
    resolvedResidentAgentId: redacted.resolvedResidentAgentId ?? null,
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

  const template = getReadSessionViewTemplate(accessOrSession, "deviceRuntime", "metadata_only");
  const redacted = {
    ...payload,
    deviceRuntime: redactDeviceRuntimeForReadSession(payload.deviceRuntime, accessOrSession),
    memoryHomeostasis: payload.memoryHomeostasis
      ? {
          ...payload.memoryHomeostasis,
          latestModelProfile: redactModelProfileForReadSession(
            payload.memoryHomeostasis.latestModelProfile,
            accessOrSession
          ),
        }
      : null,
  };
  if (template !== "summary_only") {
    return redacted;
  }
  return {
    counts: cloneJson(redacted.counts) ?? {},
    deviceRuntime: redacted.deviceRuntime,
    memoryHomeostasis: redacted.memoryHomeostasis
      ? {
          activeModelName: redacted.memoryHomeostasis.activeModelName ?? null,
          modelProfileCount: redacted.memoryHomeostasis.modelProfileCount ?? 0,
          latestModelProfile: redacted.memoryHomeostasis.latestModelProfile ?? null,
        }
      : null,
  };
}

export function redactDeviceSetupStatusForReadSession(payload = null, accessOrSession = null) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const residentBinding = normalizeResidentBindingForReadSession(payload, {
    fallbackRecord: payload.deviceRuntime,
  });
  const template = getReadSessionViewTemplate(accessOrSession, "deviceSetup", "metadata_only");
  const redacted = {
    ...payload,
    ...residentBinding,
    formalRecoveryFlow: redactFormalRecoveryFlowForReadSession(payload.formalRecoveryFlow, accessOrSession),
    deviceRuntime: redactDeviceRuntimeForReadSession(payload.deviceRuntime, accessOrSession),
    latestRecoveryRehearsal: redactRecoveryRehearsalForReadSession(
      payload.latestRecoveryRehearsal,
      accessOrSession
    ),
    latestPassedRecoveryRehearsal: redactRecoveryRehearsalForReadSession(
      payload.latestPassedRecoveryRehearsal,
      accessOrSession
    ),
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
    physicalResidentAgentId: redacted.physicalResidentAgentId ?? null,
    residentAgentId: redacted.residentAgentId ?? null,
    residentAgentReference: redacted.residentAgentReference ?? null,
    resolvedResidentAgentId: redacted.resolvedResidentAgentId ?? null,
    residentDidMethod: redacted.residentDidMethod ?? null,
    setupPolicy: redacted.setupPolicy ?? null,
    latestRecoveryRehearsal: redacted.latestRecoveryRehearsal
      ? {
          rehearsalId: redacted.latestRecoveryRehearsal.rehearsalId ?? null,
          createdAt: redacted.latestRecoveryRehearsal.createdAt ?? null,
          status: redacted.latestRecoveryRehearsal.status ?? null,
          summary: redacted.latestRecoveryRehearsal.summary ?? null,
        }
      : null,
    latestRecoveryRehearsalAgeHours: redacted.latestRecoveryRehearsalAgeHours ?? null,
    latestRecoveryRehearsalBlocksFreshness: redacted.latestRecoveryRehearsalBlocksFreshness ?? null,
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
          handoffPacket: redacted.formalRecoveryFlow.handoffPacket
            ? {
                status: redacted.formalRecoveryFlow.handoffPacket.status ?? null,
                readyToHandoff: redacted.formalRecoveryFlow.handoffPacket.readyToHandoff ?? null,
                readyFieldCount: redacted.formalRecoveryFlow.handoffPacket.readyFieldCount ?? 0,
                totalFieldCount: redacted.formalRecoveryFlow.handoffPacket.totalFieldCount ?? 0,
                missingFieldIds: Array.isArray(redacted.formalRecoveryFlow.handoffPacket.missingFieldIds)
                  ? redacted.formalRecoveryFlow.handoffPacket.missingFieldIds
                  : [],
                summary: redacted.formalRecoveryFlow.handoffPacket.summary ?? null,
                uniqueBlockingReason: redacted.formalRecoveryFlow.handoffPacket.uniqueBlockingReason
                  ? {
                      code: redacted.formalRecoveryFlow.handoffPacket.uniqueBlockingReason.code ?? null,
                      label: redacted.formalRecoveryFlow.handoffPacket.uniqueBlockingReason.label ?? null,
                      summary: redacted.formalRecoveryFlow.handoffPacket.uniqueBlockingReason.summary ?? null,
                    }
                  : null,
                requiredFields: Array.isArray(redacted.formalRecoveryFlow.handoffPacket.requiredFields)
                  ? redacted.formalRecoveryFlow.handoffPacket.requiredFields.map((entry) => ({
                      fieldId: entry?.fieldId ?? null,
                      label: entry?.label ?? null,
                      status: entry?.status ?? null,
                      value: entry?.value ?? null,
                      summary: entry?.summary ?? null,
                    }))
                  : [],
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
    memoryHomeostasis: runtime.memoryHomeostasis
      ? {
          modelName: runtime.memoryHomeostasis.modelName ?? null,
          modelProfile: redactModelProfileForReadSession(runtime.memoryHomeostasis.modelProfile, accessOrSession),
          latestState: redactRuntimeMemoryStateForReadSession(runtime.memoryHomeostasis.latestState, accessOrSession),
          stateCount: runtime.memoryHomeostasis.stateCount ?? 0,
        }
      : null,
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
    memoryHomeostasis: redacted.memoryHomeostasis
      ? {
          modelName: redacted.memoryHomeostasis.modelName ?? null,
          modelProfile: redacted.memoryHomeostasis.modelProfile ?? null,
          latestState: redacted.memoryHomeostasis.latestState ?? null,
          stateCount: redacted.memoryHomeostasis.stateCount ?? 0,
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
  const credentials = Array.isArray(context.credentials)
    ? context.credentials.filter((entry) => credentialMatchesReadSession(accessOrSession, entry))
    : [];
  const authorizations = Array.isArray(context.authorizations)
    ? context.authorizations.filter((entry) => authorizationMatchesReadSession(accessOrSession, entry))
    : [];
  const statusLists = Array.isArray(context.statusLists)
    ? context.statusLists.filter((entry) => statusListMatchesReadSession(accessOrSession, entry))
    : [];
  const windows = Array.isArray(context.windows)
    ? context.windows.filter((entry) => windowMatchesReadSession(accessOrSession, entry))
    : [];
  const migrationRepairs = Array.isArray(context.migrationRepairs)
    ? context.migrationRepairs.filter((entry) => migrationRepairMatchesReadSession(accessOrSession, entry))
    : [];

  return {
    agent: redactAgentRecordForReadSession(context.agent),
    identity: redactIdentityForReadSession(context.identity),
    deviceRuntime: redactDeviceRuntimeForReadSession(context.deviceRuntime, accessOrSession),
    residentGate: context.residentGate ?? null,
    didAliases: Array.isArray(context.didAliases) ? context.didAliases : [],
    didDocument: summarizeCredentialDocumentForReadSession(context.didDocument),
    assets: context.assets
      ? {
          credits: Number.isFinite(Number(context.assets.credits)) ? Number(context.assets.credits) : 0,
        }
      : null,
    windows: windows.map(redactWindowBindingForReadSession),
    memories: Array.isArray(context.memories) ? context.memories.map(redactMemoryForReadSession) : [],
    inbox: Array.isArray(context.inbox) ? context.inbox.map(redactMessageForReadSession) : [],
    outbox: Array.isArray(context.outbox) ? context.outbox.map(redactMessageForReadSession) : [],
    authorizations: authorizations.map(redactAuthorizationViewForReadSession),
    credentials: credentials.map(redactCredentialRecordForReadSession),
    migrationRepairs: migrationRepairs.map(redactMigrationRepairViewForReadSession),
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
    verificationRuns: Array.isArray(context.verificationRuns)
      ? context.verificationRuns.map(redactVerificationRunForReadSession)
      : [],
    integrityRuns: Array.isArray(context.integrityRuns)
      ? context.integrityRuns.map(redactVerificationRunForReadSession)
      : [],
    credentialMethodCoverage: context.credentialMethodCoverage
        ? {
          publicSignableDidMethods: Array.isArray(context.credentialMethodCoverage.publicSignableDidMethods)
            ? context.credentialMethodCoverage.publicSignableDidMethods
            : [],
          compatibilitySignableDidMethods: Array.isArray(context.credentialMethodCoverage.compatibilitySignableDidMethods)
            ? context.credentialMethodCoverage.compatibilitySignableDidMethods
            : [],
          repairSignableDidMethods: Array.isArray(context.credentialMethodCoverage.repairSignableDidMethods)
            ? context.credentialMethodCoverage.repairSignableDidMethods
            : [],
          totalSubjects: context.credentialMethodCoverage.totalSubjects ?? null,
          completeSubjectCount: context.credentialMethodCoverage.completeSubjectCount ?? null,
          partialSubjectCount: context.credentialMethodCoverage.partialSubjectCount ?? null,
          complete: context.credentialMethodCoverage.complete ?? null,
          publicComplete: context.credentialMethodCoverage.publicComplete ?? null,
          repairComplete: context.credentialMethodCoverage.repairComplete ?? null,
          repairCompleteSubjectCount: context.credentialMethodCoverage.repairCompleteSubjectCount ?? null,
          repairPartialSubjectCount: context.credentialMethodCoverage.repairPartialSubjectCount ?? null,
          availableDidMethods: Array.isArray(context.credentialMethodCoverage.availableDidMethods)
            ? context.credentialMethodCoverage.availableDidMethods
            : [],
          missingDidMethods: Array.isArray(context.credentialMethodCoverage.missingDidMethods)
            ? context.credentialMethodCoverage.missingDidMethods
            : [],
          publicMissingDidMethods: Array.isArray(context.credentialMethodCoverage.publicMissingDidMethods)
            ? context.credentialMethodCoverage.publicMissingDidMethods
            : [],
          compatibilityMissingDidMethods: Array.isArray(context.credentialMethodCoverage.compatibilityMissingDidMethods)
            ? context.credentialMethodCoverage.compatibilityMissingDidMethods
            : [],
          repairMissingDidMethods: Array.isArray(context.credentialMethodCoverage.repairMissingDidMethods)
            ? context.credentialMethodCoverage.repairMissingDidMethods
            : [],
        }
      : null,
    statusLists: statusLists.map(redactStatusListSummaryForReadSession),
    statusList:
      context.statusList && statusListMatchesReadSession(accessOrSession, context.statusList)
        ? redactStatusListSummaryForReadSession(context.statusList)
        : null,
    counts: {
      ...(context.counts && typeof context.counts === "object" ? context.counts : {}),
      authorizations: authorizations.length,
      credentials: credentials.length,
      windows: windows.length,
      migrationRepairs: migrationRepairs.length,
      statusLists: statusLists.length,
    },
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

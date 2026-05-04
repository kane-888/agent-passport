import {
  configureSecurityPosture,
  createReadSession,
  getCurrentSecurityPostureState,
  getDeviceSetupStatus,
  getAgentRuntimeSummary,
  listAgentRuns,
  listAgentSandboxActionAudits,
  listEvidenceRefs,
  listSecurityAnomalies,
  migrateLocalKeyMaterialToKeychain,
  peekReadSessions,
  recordEvidenceRef,
  recordSecurityAnomaly,
  revokeAllReadSessions,
  revokeReadSession,
} from "./ledger.js";
import { runRuntimeHousekeeping } from "./runtime-housekeeping.js";
import { json, normalizeOptionalText, toBooleanParam } from "./server-base-helpers.js";
import { jsonForReadSession } from "./server-read-access.js";
import {
  redactSecurityPostureForReadSession,
  redactRuntimeHousekeepingForReadSession,
  redactSecurityAnomalyForReadSession,
} from "./server-security-redaction.js";
import { buildSecurityRuntimeContext } from "./security-runtime-context.js";
import { selectRuntimeTruth } from "../public/runtime-truth-client.js";
import {
  buildCanonicalOperatorDecision,
  listCanonicalAgentRuntimeTruthMissingFields,
} from "../public/operator-decision-canonical.js";
import {
  canonicalizeIncidentPacketEvidenceRef,
  canonicalizeIncidentPacketSetupSnapshot,
  resolveIncidentPacketResidentBinding,
  resolveIncidentPacketResidentDidMethod,
} from "./security-incident-packet-canonical.js";
import {
  SECURITY_ROUTE_ATTRIBUTION_FIELDS,
  stripUntrustedRouteFields,
} from "./server-untrusted-route-input.js";

function stripUntrustedSecurityRouteAttribution(payload = {}) {
  return stripUntrustedRouteFields(payload, SECURITY_ROUTE_ATTRIBUTION_FIELDS);
}

function getIncidentPacketResidentAgentId(setup = null) {
  return resolveIncidentPacketResidentBinding(setup).physicalResidentAgentId;
}

function reverseRecentEntries(entries = []) {
  return Array.isArray(entries) ? [...entries].reverse() : [];
}

const INCIDENT_PACKET_TEXT_LIMIT = 240;
const INCIDENT_PACKET_NOTE_LIMIT = 160;
const INCIDENT_PACKET_LIST_LIMIT = 4;
const INCIDENT_PACKET_OBJECT_KEY_LIMIT = 8;

function truncateIncidentText(value, limit = INCIDENT_PACKET_TEXT_LIMIT) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function summarizeIncidentTextList(values = [], { limit = INCIDENT_PACKET_LIST_LIMIT, maxLength = 120 } = {}) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => truncateIncidentText(value, maxLength)).filter(Boolean).slice(0, limit);
}

function summarizeIncidentStructuredValue(value, depth = 0) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return truncateIncidentText(value, depth === 0 ? INCIDENT_PACKET_NOTE_LIMIT : 96);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      itemCount: value.length,
      sample: value
        .slice(0, Math.max(1, INCIDENT_PACKET_LIST_LIMIT - 1))
        .map((entry) =>
          depth >= 1 && entry && typeof entry === "object"
            ? {
                type: Array.isArray(entry) ? "array" : "object",
                keyCount: Array.isArray(entry) ? entry.length : Object.keys(entry).length,
                keys: Array.isArray(entry) ? [] : Object.keys(entry).slice(0, INCIDENT_PACKET_OBJECT_KEY_LIMIT),
              }
            : summarizeIncidentStructuredValue(entry, depth + 1)
        ),
    };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    const summary = {
      type: "object",
      keyCount: keys.length,
      keys: keys.slice(0, INCIDENT_PACKET_OBJECT_KEY_LIMIT),
    };
    const status = truncateIncidentText(value.status, 96);
    const code = truncateIncidentText(value.code, 96);
    const message = truncateIncidentText(value.message, INCIDENT_PACKET_NOTE_LIMIT);
    const detail = truncateIncidentText(value.summary || value.detail, INCIDENT_PACKET_NOTE_LIMIT);
    if (status) {
      summary.status = status;
    }
    if (code) {
      summary.code = code;
    }
    if (message) {
      summary.message = message;
    }
    if (detail) {
      summary.summary = detail;
    }
    return summary;
  }
  return truncateIncidentText(String(value), 96);
}

function summarizeIncidentNoteEntry(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return (
      normalizeOptionalText(value.summary) ||
      normalizeOptionalText(value.detail) ||
      normalizeOptionalText(value.message) ||
      normalizeOptionalText(value.code) ||
      Object.keys(value).slice(0, INCIDENT_PACKET_OBJECT_KEY_LIMIT).join(", ")
    );
  }
  return String(value);
}

function summarizeIncidentAnomaly(entry = null) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  return {
    anomalyId: normalizeOptionalText(entry.anomalyId) ?? null,
    category: normalizeOptionalText(entry.category) ?? null,
    severity: normalizeOptionalText(entry.severity) ?? null,
    code: normalizeOptionalText(entry.code) ?? null,
    status: normalizeOptionalText(entry.status) ?? null,
    summary:
      truncateIncidentText(entry.summary) ||
      truncateIncidentText(entry.detail) ||
      truncateIncidentText(entry.message),
    acknowledgedAt: normalizeOptionalText(entry.acknowledgedAt) ?? null,
    createdAt: normalizeOptionalText(entry.createdAt) ?? null,
  };
}

function summarizeIncidentAutoRecoveryAudit(audit = null) {
  if (!audit || typeof audit !== "object") {
    return null;
  }
  return {
    auditEventId: normalizeOptionalText(audit.auditEventId) ?? null,
    eventIndex: Number.isFinite(Number(audit.eventIndex)) ? Number(audit.eventIndex) : null,
    timestamp: normalizeOptionalText(audit.timestamp) ?? null,
    agentId: normalizeOptionalText(audit.agentId) ?? null,
    runId: normalizeOptionalText(audit.runId) ?? null,
    status: normalizeOptionalText(audit.status) ?? null,
    summary: truncateIncidentText(audit.summary),
    error: truncateIncidentText(audit.error),
    requested: typeof audit.requested === "boolean" ? audit.requested : null,
    enabled: typeof audit.enabled === "boolean" ? audit.enabled : null,
    ready: typeof audit.ready === "boolean" ? audit.ready : null,
    resumed: typeof audit.resumed === "boolean" ? audit.resumed : null,
    attempt: Number.isFinite(Number(audit.attempt)) ? Number(audit.attempt) : null,
    maxAttempts: Number.isFinite(Number(audit.maxAttempts)) ? Number(audit.maxAttempts) : null,
    initialRunId: normalizeOptionalText(audit.initialRunId) ?? null,
    triggerRunId: normalizeOptionalText(audit.triggerRunId) ?? null,
    triggerRecoveryActionId: normalizeOptionalText(audit.triggerRecoveryActionId) ?? null,
    finalRunId: normalizeOptionalText(audit.finalRunId) ?? null,
    finalStatus: normalizeOptionalText(audit.finalStatus) ?? null,
    gateReasons: summarizeIncidentTextList(audit.gateReasons),
    dependencyWarnings: summarizeIncidentTextList(audit.dependencyWarnings),
    plan: audit.plan
      ? {
          action: normalizeOptionalText(audit.plan.action) ?? null,
          mode: normalizeOptionalText(audit.plan.mode) ?? null,
          summary: truncateIncidentText(audit.plan.summary),
        }
      : null,
    chain: Array.isArray(audit.chain)
      ? audit.chain.slice(-INCIDENT_PACKET_LIST_LIMIT).map((entry) => ({
          attempt: Number.isFinite(Number(entry?.attempt)) ? Number(entry.attempt) : null,
          runId: normalizeOptionalText(entry?.runId) ?? null,
          runStatus: normalizeOptionalText(entry?.runStatus) ?? null,
          recoveryAction: normalizeOptionalText(entry?.recoveryAction) ?? null,
          recoveryActionId: normalizeOptionalText(entry?.recoveryActionId) ?? null,
          resumeBoundaryId: normalizeOptionalText(entry?.resumeBoundaryId) ?? null,
          createdAt: normalizeOptionalText(entry?.createdAt) ?? null,
        }))
      : [],
    setupStatus: summarizeIncidentStructuredValue(audit.setupStatus),
    finalVerification: summarizeIncidentStructuredValue(audit.finalVerification),
    closure: summarizeIncidentStructuredValue(audit.closure),
  };
}

function summarizeIncidentRun(run = null) {
  if (!run || typeof run !== "object") {
    return null;
  }
  const reasonerMetadata =
    run.reasoner?.metadata && typeof run.reasoner.metadata === "object" ? run.reasoner.metadata : null;
  const runnerGuard = run.runnerGuard && typeof run.runnerGuard === "object" ? run.runnerGuard : null;
  return {
    runId: normalizeOptionalText(run.runId) ?? null,
    agentId: normalizeOptionalText(run.agentId) ?? null,
    status: normalizeOptionalText(run.status) ?? null,
    currentGoal: truncateIncidentText(run.currentGoal),
    candidateResponsePreview: truncateIncidentText(run.candidateResponse),
    resumeBoundaryId: normalizeOptionalText(run.resumeBoundaryId) ?? null,
    sourceWindowId: normalizeOptionalText(run.sourceWindowId) ?? null,
    executedAt: normalizeOptionalText(run.executedAt || run.updatedAt || run.createdAt) ?? null,
    contextSummary: run.contextSummary
      ? {
          did: normalizeOptionalText(run.contextSummary.did) ?? null,
          taskSnapshotId: normalizeOptionalText(run.contextSummary.taskSnapshotId) ?? null,
          profileName: normalizeOptionalText(run.contextSummary.profileName) ?? null,
          profileRole: normalizeOptionalText(run.contextSummary.profileRole) ?? null,
          profileFieldCount: Number(run.contextSummary.profileFieldCount || 0),
          episodicCount: Number(run.contextSummary.episodicCount || 0),
          workingCount: Number(run.contextSummary.workingCount || 0),
          ledgerCommitmentCount: Number(run.contextSummary.ledgerCommitmentCount || 0),
          recentConversationTurnCount: Number(run.contextSummary.recentConversationTurnCount || 0),
          toolResultCount: Number(run.contextSummary.toolResultCount || 0),
          queryStateId: normalizeOptionalText(run.contextSummary.queryStateId) ?? null,
          negotiationId: normalizeOptionalText(run.contextSummary.negotiationId) ?? null,
        }
      : null,
    driftCheck: run.driftCheck
      ? {
          driftScore: run.driftCheck.driftScore ?? 0,
          requiresRehydrate: Boolean(run.driftCheck.requiresRehydrate),
          requiresHumanReview: Boolean(run.driftCheck.requiresHumanReview),
          recommendedActions: summarizeIncidentTextList(run.driftCheck.recommendedActions),
          flags: summarizeIncidentTextList(run.driftCheck.flags),
        }
      : null,
    reasoner: run.reasoner
      ? {
          provider: normalizeOptionalText(run.reasoner.provider) ?? null,
          model: normalizeOptionalText(run.reasoner.model) ?? null,
        responseGenerated: Boolean(run.reasoner.responseGenerated),
        error: truncateIncidentText(run.reasoner.error),
        fallbackActivated:
          typeof reasonerMetadata?.fallbackActivated === "boolean"
            ? reasonerMetadata.fallbackActivated
            : null,
        fallbackCause: normalizeOptionalText(reasonerMetadata?.fallbackCause) ?? null,
        degradedLocalFallback:
          typeof reasonerMetadata?.degradedLocalFallback === "boolean"
            ? reasonerMetadata.degradedLocalFallback
            : null,
        degradedLocalFallbackReason:
          normalizeOptionalText(reasonerMetadata?.degradedLocalFallbackReason) ?? null,
        qualityEscalationActivated:
          typeof reasonerMetadata?.qualityEscalationActivated === "boolean"
            ? reasonerMetadata.qualityEscalationActivated
            : null,
          qualityEscalationProvider: normalizeOptionalText(reasonerMetadata?.qualityEscalationProvider) ?? null,
          qualityEscalationInitialProvider:
            normalizeOptionalText(reasonerMetadata?.qualityEscalationInitialProvider) ?? null,
          qualityEscalationReason: normalizeOptionalText(reasonerMetadata?.qualityEscalationReason) ?? null,
          qualityEscalationIssueCodes: summarizeIncidentTextList(reasonerMetadata?.qualityEscalationIssueCodes),
          memoryStabilityCorrectionLevel:
            normalizeOptionalText(reasonerMetadata?.memoryStabilityCorrectionLevel) ?? null,
          memoryStabilityRiskScore:
            Number.isFinite(Number(reasonerMetadata?.memoryStabilityRiskScore))
              ? Number(reasonerMetadata.memoryStabilityRiskScore)
              : null,
          memoryStabilitySignalSource:
            normalizeOptionalText(reasonerMetadata?.memoryStabilitySignalSource) ?? null,
          memoryStabilityPreflightStatus:
            normalizeOptionalText(reasonerMetadata?.memoryStabilityPreflightStatus) ?? null,
        }
      : null,
    verification: run.verification
      ? {
          valid: typeof run.verification.valid === "boolean" ? run.verification.valid : null,
          issueCount: Number(run.verification.issueCount || 0),
          issues: summarizeIncidentTextList(run.verification.issues),
        }
      : null,
    bootstrapGate: run.bootstrapGate
      ? {
          required: Boolean(run.bootstrapGate.required),
          recommendation: truncateIncidentText(run.bootstrapGate.recommendation),
          missingRequiredCodes: summarizeIncidentTextList(run.bootstrapGate.missingRequiredCodes),
        }
      : null,
    residentGate: run.residentGate
      ? {
          required: Boolean(run.residentGate.required),
          code: normalizeOptionalText(run.residentGate.code) ?? null,
          residentAgentId: normalizeOptionalText(run.residentGate.residentAgentId) ?? null,
          localMode: normalizeOptionalText(run.residentGate.localMode) ?? null,
          allowOnlineReasoner: Boolean(run.residentGate.allowOnlineReasoner),
        }
      : null,
    runnerGuard: runnerGuard
      ? {
          activated: runnerGuard.failClosed === true,
          blockedBy: normalizeOptionalText(runnerGuard.blockedBy) ?? null,
          code: normalizeOptionalText(runnerGuard.code) ?? null,
          stage: normalizeOptionalText(runnerGuard.stage) ?? null,
          receiptStatus: normalizeOptionalText(runnerGuard.receiptStatus) ?? null,
          explicitRequestKinds: summarizeIncidentTextList(runnerGuard.explicitRequestKinds),
        }
      : null,
    queryState: run.queryState
      ? {
          queryStateId: normalizeOptionalText(run.queryState.queryStateId) ?? null,
          status: normalizeOptionalText(run.queryState.status) ?? null,
          currentIteration: Number.isFinite(Number(run.queryState.currentIteration))
            ? Number(run.queryState.currentIteration)
            : null,
          maxQueryIterations: Number.isFinite(Number(run.queryState.maxQueryIterations))
            ? Number(run.queryState.maxQueryIterations)
            : null,
          remainingIterations: Number.isFinite(Number(run.queryState.remainingIterations))
            ? Number(run.queryState.remainingIterations)
            : null,
          flags: summarizeIncidentTextList(run.queryState.flags),
          recommendedActions: summarizeIncidentTextList(run.queryState.recommendedActions),
          budget: run.queryState.budget
            ? {
                maxConversationTurns: run.queryState.budget.maxConversationTurns ?? null,
                maxContextChars: run.queryState.budget.maxContextChars ?? null,
                maxContextTokens: run.queryState.budget.maxContextTokens ?? null,
                maxRecentConversationTurns: run.queryState.budget.maxRecentConversationTurns ?? null,
                maxToolResults: run.queryState.budget.maxToolResults ?? null,
                maxQueryIterations: run.queryState.budget.maxQueryIterations ?? null,
                usedRecentConversationTurnCount: run.queryState.budget.usedRecentConversationTurnCount ?? 0,
                usedToolResultCount: run.queryState.budget.usedToolResultCount ?? 0,
                truncatedFlags: summarizeIncidentTextList(run.queryState.budget.truncatedFlags),
              }
            : null,
          riskTier: normalizeOptionalText(run.queryState.riskTier) ?? null,
          authorizationStrategy: normalizeOptionalText(run.queryState.authorizationStrategy) ?? null,
        }
      : null,
    negotiation: run.negotiation
      ? {
          negotiationId: normalizeOptionalText(run.negotiation.negotiationId) ?? null,
          interactionMode: normalizeOptionalText(run.negotiation.interactionMode) ?? null,
          executionMode: normalizeOptionalText(run.negotiation.executionMode) ?? null,
          requestedAction: truncateIncidentText(run.negotiation.requestedAction),
          actionable: Boolean(run.negotiation.actionable),
          decision: normalizeOptionalText(run.negotiation.decision) ?? null,
          shouldExecute: Boolean(run.negotiation.shouldExecute),
          requiresMultisig: Boolean(run.negotiation.requiresMultisig),
          shouldUseOnlineReasoner: Boolean(run.negotiation.shouldUseOnlineReasoner),
          riskLevel: normalizeOptionalText(run.negotiation.riskLevel) ?? null,
          riskTier: normalizeOptionalText(run.negotiation.riskTier) ?? null,
          riskKeywords: summarizeIncidentTextList(run.negotiation.riskKeywords),
          authorizationStrategy: normalizeOptionalText(run.negotiation.authorizationStrategy) ?? null,
          recommendedNextStep: truncateIncidentText(run.negotiation.recommendedNextStep),
          notes: summarizeIncidentTextList(
            Array.isArray(run.negotiation.notes)
              ? run.negotiation.notes.map((entry) => summarizeIncidentNoteEntry(entry))
              : [],
            { maxLength: INCIDENT_PACKET_NOTE_LIMIT }
          ),
        }
      : null,
    checkpoint: run.checkpoint
      ? {
          triggered: Boolean(run.checkpoint.triggered),
          threshold: run.checkpoint.threshold ?? null,
          retainCount: run.checkpoint.retainCount ?? null,
          archivedCount: run.checkpoint.archivedCount ?? 0,
          retainedCount: run.checkpoint.retainedCount ?? 0,
          candidateCount: run.checkpoint.candidateCount ?? 0,
          checkpointMemoryId: normalizeOptionalText(run.checkpoint.checkpointMemoryId) ?? null,
          archivedKinds: summarizeIncidentTextList(run.checkpoint.archivedKinds),
          activeWorkingCount: run.checkpoint.activeWorkingCount ?? 0,
          activeWorkingCountAfter: run.checkpoint.activeWorkingCountAfter ?? run.checkpoint.activeWorkingCount ?? 0,
        }
      : null,
    goalState: summarizeIncidentStructuredValue(run.goalState),
    selfEvaluation: summarizeIncidentStructuredValue(run.selfEvaluation),
    strategyProfile: summarizeIncidentStructuredValue(run.strategyProfile),
    maintenance: summarizeIncidentStructuredValue(run.maintenance),
    sandboxExecution: run.sandboxExecution
      ? {
          capability: normalizeOptionalText(run.sandboxExecution.capability) ?? null,
          status: normalizeOptionalText(run.sandboxExecution.status) ?? null,
          blockedBy: normalizeOptionalText(run.sandboxExecution.blockedBy) ?? null,
          executed: Boolean(run.sandboxExecution.executed),
          writeCount: run.sandboxExecution.writeCount ?? 0,
          summary: truncateIncidentText(run.sandboxExecution.summary),
          error: truncateIncidentText(run.sandboxExecution.error),
          output: summarizeIncidentStructuredValue(run.sandboxExecution.output),
        }
      : null,
    compaction: run.compaction
      ? {
          writeCount: run.compaction.writeCount ?? 0,
          byLayer: run.compaction.byLayer && typeof run.compaction.byLayer === "object" ? run.compaction.byLayer : {},
          byKind: run.compaction.byKind && typeof run.compaction.byKind === "object" ? run.compaction.byKind : {},
          passportMemoryCount: Array.isArray(run.compaction.passportMemoryIds) ? run.compaction.passportMemoryIds.length : 0,
        }
      : null,
    toolResultCount: Array.isArray(run.toolResults)
      ? run.toolResults.length
      : Number(run.contextSummary?.toolResultCount || 0),
    recentConversationTurnCount: Array.isArray(run.recentConversationTurns)
      ? run.recentConversationTurns.length
      : Number(run.contextSummary?.recentConversationTurnCount || 0),
    references: run.references
      ? {
          did: normalizeOptionalText(run.references.did) ?? null,
          parentAgentId: normalizeOptionalText(run.references.parentAgentId) ?? null,
          authorizationThreshold: run.references.authorizationThreshold ?? null,
        }
      : null,
  };
}

function summarizeIncidentSandboxAudit(audit = null) {
  if (!audit || typeof audit !== "object") {
    return null;
  }
  return {
    auditId: normalizeOptionalText(audit.auditId) ?? null,
    agentId: normalizeOptionalText(audit.agentId) ?? null,
    didMethod: normalizeOptionalText(audit.didMethod) ?? null,
    capability: normalizeOptionalText(audit.capability) ?? null,
    status: normalizeOptionalText(audit.status) ?? null,
    executed: typeof audit.executed === "boolean" ? audit.executed : null,
    requestedAction: truncateIncidentText(audit.requestedAction),
    requestedActionType: normalizeOptionalText(audit.requestedActionType) ?? null,
    sourceWindowId: normalizeOptionalText(audit.sourceWindowId) ?? null,
    executionBackend: normalizeOptionalText(audit.executionBackend) ?? null,
    writeCount: Number(audit.writeCount || 0),
    summary: truncateIncidentText(audit.summary),
    gateReasons: summarizeIncidentTextList(audit.gateReasons),
    negotiation: summarizeIncidentStructuredValue(audit.negotiation),
    input: summarizeIncidentStructuredValue(audit.input),
    output: summarizeIncidentStructuredValue(audit.output),
    error: audit.error
      ? {
          name: normalizeOptionalText(audit.error.name) ?? "Error",
          message: truncateIncidentText(audit.error.message),
        }
      : null,
    createdAt: normalizeOptionalText(audit.createdAt) ?? null,
  };
}

function buildIncidentPacketPayload({
  security = null,
  setup = null,
  anomalies = null,
  runner = null,
  sandboxAudits = null,
  sourceSurface = "/api/security/incident-packet",
  exportRecord = null,
  exportedAt = null,
} = {}) {
  const runtimeTruth = selectRuntimeTruth({ security, setup });
  const formalRecovery = runtimeTruth.formalRecovery || null;
  const constrained = runtimeTruth.constrainedExecution || null;
  const automaticRecovery = runtimeTruth.automaticRecovery || null;
  const agentRuntime = runtimeTruth.agentRuntime || null;
  const residentBinding = resolveIncidentPacketResidentBinding(setup);
  const operatorDecision = buildCanonicalOperatorDecision({ security, truth: runtimeTruth });
  const effectiveExportedAt = normalizeOptionalText(exportedAt) || new Date().toISOString();
  const agentRuntimeMissingFields = listCanonicalAgentRuntimeTruthMissingFields(agentRuntime, "agentRuntime");
  return {
    format: "agent-passport-incident-packet-v1",
    exportedAt: effectiveExportedAt,
    product: "agent-passport",
    sourceSurface,
    ...residentBinding,
    operatorDecision,
    handoff: {
      summary:
        normalizeOptionalText(formalRecovery?.handoffPacket?.summary) ||
        "当前没有恢复交接真值。",
      packet: formalRecovery?.handoffPacket || null,
    },
    snapshots: {
      security,
      deviceSetup: canonicalizeIncidentPacketSetupSnapshot(setup),
    },
    boundaries: {
      securityPosture: security?.securityPosture || null,
      formalRecovery,
      constrainedExecution: constrained,
      automaticRecovery,
      agentRuntime,
      releaseReadiness: security?.releaseReadiness || null,
      crossDeviceRecovery: formalRecovery?.crossDeviceRecoveryClosure || null,
    },
    recentEvidence: {
      securityAnomalies: {
        fetchedAt: effectiveExportedAt,
        error: anomalies?.error || null,
        counts: anomalies?.counts || null,
        anomalies: reverseRecentEntries(anomalies?.anomalies).map((entry) => summarizeIncidentAnomaly(entry)).filter(Boolean),
      },
      autoRecovery: {
        fetchedAt: effectiveExportedAt,
        error: runner?.error || null,
        counts: runner?.counts || null,
        recentRuns: reverseRecentEntries(runner?.runs).map((entry) => summarizeIncidentRun(entry)).filter(Boolean),
        audits: reverseRecentEntries(runner?.autoRecoveryAudits)
          .map((entry) => summarizeIncidentAutoRecoveryAudit(entry))
          .filter(Boolean),
      },
      constrainedExecution: {
        fetchedAt: effectiveExportedAt,
        error: sandboxAudits?.error || null,
        counts: sandboxAudits?.counts || null,
        audits: reverseRecentEntries(sandboxAudits?.audits)
          .map((entry) => summarizeIncidentSandboxAudit(entry))
          .filter(Boolean),
      },
    },
    exportCoverage: {
      protectedRead: true,
      residentAgentBound: Boolean(residentBinding.physicalResidentAgentId),
      includedSections: [
        "current_decision",
        "security_snapshot",
        "device_setup_snapshot",
        "agent_runtime_truth",
        "formal_recovery_handoff",
        "cross_device_gate",
        "security_anomalies",
        "auto_recovery_audits",
        "constrained_execution_audits",
      ],
      missingSections: [
        anomalies?.error ? "security_anomalies" : null,
        runner?.error ? "auto_recovery_audits" : null,
        sandboxAudits?.error ? "constrained_execution_audits" : null,
        agentRuntimeMissingFields.length === 0 ? null : "agent_runtime_truth",
        residentBinding.physicalResidentAgentId ? null : "resident_agent_binding",
      ].filter(Boolean),
    },
    exportRecord: canonicalizeIncidentPacketEvidenceRef(exportRecord, residentBinding),
  };
}

async function collectIncidentPacketState() {
  const [securityPosture, setup, anomalies] = await Promise.all([
    getCurrentSecurityPostureState(),
    getDeviceSetupStatus({ passive: true }),
    listSecurityAnomalies({
      limit: 5,
      includeAcknowledged: true,
    }),
  ]);
  const residentAgentId = getIncidentPacketResidentAgentId(setup);
  const residentDidMethod = resolveIncidentPacketResidentDidMethod(setup);
  const [runtimeSummary, runner, sandboxAudits] = await Promise.all([
    residentAgentId
      ? getAgentRuntimeSummary(residentAgentId, {
          didMethod: residentDidMethod,
        })
      : null,
    residentAgentId
      ? listAgentRuns(residentAgentId, { limit: 5 })
      : {
          error: "resident agent missing",
          runs: [],
          autoRecoveryAudits: [],
          counts: null,
        },
    residentAgentId
      ? listAgentSandboxActionAudits(residentAgentId, { limit: 5 })
      : {
          error: "resident agent missing",
          audits: [],
          counts: null,
        },
  ]);
  const {
    security,
    releaseReadiness,
  } = buildSecurityRuntimeContext({
    securityPosture,
    setup,
    runtimeSummary,
    health: {
      ok: null,
      service: null,
      source: "incident_packet_not_probed",
    },
  });
  return {
    security,
    setup: canonicalizeIncidentPacketSetupSnapshot(setup),
    anomalies,
    runner,
    sandboxAudits,
    residentAgentId,
  };
}

async function recordIncidentPacketExport({
  residentAgentId = null,
  residentAgentReference = null,
  resolvedResidentAgentId = null,
  packet = null,
  note = null,
  sourceWindowId = null,
} = {}) {
  if (!residentAgentId || !packet) {
    return null;
  }
  return recordEvidenceRef(residentAgentId, {
    kind: "note",
    title: "事故交接包导出",
    uri: `incident-packet://export/${encodeURIComponent(packet.exportedAt || new Date().toISOString())}`,
    summary:
      normalizeOptionalText(packet?.operatorDecision?.summary) ||
      normalizeOptionalText(note) ||
      "已导出事故交接包。",
    residentAgentReference:
      normalizeOptionalText(packet?.residentAgentReference) || normalizeOptionalText(residentAgentReference) || null,
    resolvedResidentAgentId:
      normalizeOptionalText(packet?.resolvedResidentAgentId) ||
      normalizeOptionalText(resolvedResidentAgentId) ||
      null,
    tags: ["incident-packet-export", "operator", "security"],
    sourceWindowId,
    recordedByWindowId: sourceWindowId,
  });
}

export async function handleSecurityRoutes({
  req,
  res,
  url,
  pathname,
  segments,
  parseBody,
  rotateAdminToken,
}) {
  if (pathname === "/api/security/posture") {
    if (req.method === "GET") {
      const access = req.agentPassportAccess || null;
      const posture = await getCurrentSecurityPostureState();
      return jsonForReadSession(res, access, 200, { securityPosture: posture }, (payload) => ({
        securityPosture: redactSecurityPostureForReadSession(payload.securityPosture, access),
      }));
    }
    if (req.method === "POST") {
      const body = await parseBody(req);
      const posture = await configureSecurityPosture(stripUntrustedSecurityRouteAttribution(body));
      return json(res, 200, posture);
    }
  }

  if (req.method === "GET" && pathname === "/api/security/anomalies") {
    const anomalies = await listSecurityAnomalies({
      limit: url.searchParams.get("limit") || undefined,
      category: url.searchParams.get("category") || undefined,
      severity: url.searchParams.get("severity") || undefined,
      includeAcknowledged: toBooleanParam(url.searchParams.get("includeAcknowledged")) ?? true,
      createdAfter: url.searchParams.get("createdAfter") || undefined,
      createdBefore: url.searchParams.get("createdBefore") || undefined,
    });
    const access = req.agentPassportAccess || null;
    return jsonForReadSession(res, access, 200, anomalies, (payload) => ({
      ...payload,
      anomalies: Array.isArray(payload.anomalies)
        ? payload.anomalies.map((entry) => redactSecurityAnomalyForReadSession(entry, access))
        : [],
    }));
  }

  if (req.method === "GET" && pathname === "/api/security/incident-packet") {
    const packetState = await collectIncidentPacketState();
    return json(
      res,
      200,
      buildIncidentPacketPayload({
        security: packetState.security,
        setup: packetState.setup,
        anomalies: packetState.anomalies,
        runner: packetState.runner,
        sandboxAudits: packetState.sandboxAudits,
      })
    );
  }

  if (req.method === "GET" && pathname === "/api/security/incident-packet/history") {
    const setup = await getDeviceSetupStatus({ passive: true });
    const residentBinding = resolveIncidentPacketResidentBinding(setup);
    const residentAgentId = residentBinding.physicalResidentAgentId;
    if (!residentAgentId) {
      return json(res, 200, {
        ...residentBinding,
        history: [],
        counts: {
          total: 0,
          filtered: 0,
        },
      });
    }
    const history = await listEvidenceRefs(residentAgentId, {
      tag: "incident-packet-export",
      limit: url.searchParams.get("limit") || undefined,
    });
    return json(res, 200, {
      ...residentBinding,
      history: reverseRecentEntries(history.evidenceRefs).map((entry) =>
        canonicalizeIncidentPacketEvidenceRef(entry, residentBinding)
      ),
      counts: history.counts,
    });
  }

  if (req.method === "POST" && pathname === "/api/security/incident-packet/export") {
    const body = await parseBody(req);
    const trustedBody = stripUntrustedSecurityRouteAttribution(body);
    const packetState = await collectIncidentPacketState();
    const exportedAt = new Date().toISOString();
    const previewPacket = buildIncidentPacketPayload({
      security: packetState.security,
      setup: packetState.setup,
      anomalies: packetState.anomalies,
      runner: packetState.runner,
      sandboxAudits: packetState.sandboxAudits,
      sourceSurface: "/api/security/incident-packet/export",
      exportedAt,
    });
    const exportRecord = await recordIncidentPacketExport({
      residentAgentId: packetState.residentAgentId,
      residentAgentReference: previewPacket.residentAgentReference,
      resolvedResidentAgentId: previewPacket.resolvedResidentAgentId,
      packet: previewPacket,
      note: trustedBody.note,
      sourceWindowId:
        normalizeOptionalText(trustedBody.sourceWindowId) ||
        normalizeOptionalText(trustedBody.recordedByWindowId) ||
        null,
    });
    return json(
      res,
      200,
      buildIncidentPacketPayload({
        security: packetState.security,
        setup: packetState.setup,
        anomalies: packetState.anomalies,
        runner: packetState.runner,
        sandboxAudits: packetState.sandboxAudits,
        sourceSurface: "/api/security/incident-packet/export",
        exportRecord,
        exportedAt,
      })
    );
  }

  if (req.method === "POST" && pathname === "/api/security/keychain-migration") {
    const body = await parseBody(req);
    const migration = await migrateLocalKeyMaterialToKeychain({
      dryRun: toBooleanParam(body.dryRun) ?? true,
      removeFile: toBooleanParam(body.removeFile) ?? false,
    });
    return json(res, 200, { migration });
  }

  if (pathname === "/api/security/runtime-housekeeping") {
    const access = req.agentPassportAccess || null;
    if (req.method === "GET") {
      const housekeeping = await runRuntimeHousekeeping({
        apply: false,
        keepRecovery: url.searchParams.get("keepRecovery"),
        keepSetup: url.searchParams.get("keepSetup"),
      });
      return jsonForReadSession(res, access, 200, housekeeping, (payload) =>
        redactRuntimeHousekeepingForReadSession(payload, access)
      );
    }
    if (req.method === "POST") {
      const body = await parseBody(req);
      const trustedBody = stripUntrustedSecurityRouteAttribution(body);
      const housekeeping = await runRuntimeHousekeeping({
        apply: toBooleanParam(trustedBody.apply) ?? false,
        keepRecovery: trustedBody.keepRecovery ?? url.searchParams.get("keepRecovery"),
        keepSetup: trustedBody.keepSetup ?? url.searchParams.get("keepSetup"),
        revokedByReadSessionId: access?.mode === "read_session" ? access.session?.readSessionId : null,
      });
      return jsonForReadSession(res, access, 200, housekeeping, (payload) =>
        redactRuntimeHousekeepingForReadSession(payload, access)
      );
    }
  }

  if (req.method === "POST" && pathname === "/api/security/admin-token/rotate") {
    const body = await parseBody(req);
    const trustedBody = stripUntrustedSecurityRouteAttribution(body);
    const rotation = await rotateAdminToken({
      dryRun: toBooleanParam(trustedBody.dryRun) ?? false,
      revokeReadSessions: toBooleanParam(trustedBody.revokeReadSessions) ?? true,
      note: trustedBody.note,
      rotatedByReadSessionId: req.agentPassportAccess?.session?.readSessionId || null,
    });
    return json(res, 200, { rotation });
  }

  if (pathname === "/api/security/read-sessions") {
    if (req.method === "GET") {
      return json(
        res,
        200,
        await peekReadSessions({
          includeExpired: toBooleanParam(url.searchParams.get("includeExpired")) ?? true,
          includeRevoked: toBooleanParam(url.searchParams.get("includeRevoked")) ?? true,
        })
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const trustedBody = stripUntrustedSecurityRouteAttribution(body);
      const access = req.agentPassportAccess || null;
      const parentReadSessionId =
        access?.mode === "read_session"
          ? access.session?.readSessionId || null
          : trustedBody.parentReadSessionId;
      if (
        access?.mode === "read_session" &&
        trustedBody.parentReadSessionId &&
        trustedBody.parentReadSessionId !== parentReadSessionId
      ) {
        return json(res, 403, {
          errorClass: "read_session_parent_mismatch",
          error: "Delegated read session can only derive a child session from itself",
          resource: {
            kind: "read_session_parent",
            value: trustedBody.parentReadSessionId,
          },
        });
      }
      return json(
        res,
        200,
        await createReadSession({
          label: trustedBody.label,
          note: trustedBody.note,
          role: trustedBody.role,
          scopes: trustedBody.scopes,
          resourceBindings: trustedBody.resourceBindings,
          agentIds: trustedBody.agentIds,
          windowIds: trustedBody.windowIds,
          credentialIds: trustedBody.credentialIds,
          viewTemplates: trustedBody.viewTemplates,
          objectTemplates: trustedBody.objectTemplates,
          fieldTemplates: trustedBody.fieldTemplates,
          ttlSeconds: trustedBody.ttlSeconds,
          canDelegate: trustedBody.canDelegate,
          maxDelegationDepth: trustedBody.maxDelegationDepth,
          parentReadSessionId,
          createdByReadSessionId:
            access?.mode === "read_session" ? access.session?.readSessionId : null,
        })
      );
    }
  }

  if (req.method === "POST" && pathname === "/api/security/read-sessions/revoke-all") {
    const body = await parseBody(req);
    const trustedBody = stripUntrustedSecurityRouteAttribution(body);
    const access = req.agentPassportAccess || null;
    const revoked = await revokeAllReadSessions({
      dryRun: toBooleanParam(trustedBody.dryRun) ?? false,
      note: trustedBody.note,
      revokedByReadSessionId: access?.mode === "read_session" ? access.session?.readSessionId : null,
    });
    if (!revoked.dryRun) {
      await recordSecurityAnomaly({
        category: "auth",
        severity: "high",
        code: "read_sessions_revoked_all",
        message: "All read sessions revoked",
        actorReadSessionId: access?.mode === "read_session" ? access.session?.readSessionId : null,
        details: {
          dryRun: false,
          revokedCount: revoked.revokedCount || 0,
        },
        reason: normalizeOptionalText(trustedBody.note) || null,
      });
    }
    return json(res, 200, revoked);
  }

  if (
    req.method === "POST" &&
    segments[0] === "api" &&
    segments[1] === "security" &&
    segments[2] === "read-sessions" &&
    segments[4] === "revoke"
  ) {
    await parseBody(req);
    return json(
      res,
      200,
      await revokeReadSession(segments[3], {
        revokedByReadSessionId: req.agentPassportAccess?.session?.readSessionId || null,
      })
    );
  }

  return null;
}

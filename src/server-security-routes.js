import {
  configureSecurityPosture,
  createReadSession,
  getCurrentSecurityPostureState,
  getDeviceSetupStatus,
  listAgentRuns,
  listAgentSandboxActionAudits,
  listEvidenceRefs,
  listReadSessions,
  listSecurityAnomalies,
  migrateLocalKeyMaterialToKeychain,
  recordEvidenceRef,
  recordSecurityAnomaly,
  revokeAllReadSessions,
  revokeReadSession,
} from "./ledger.js";
import { runRuntimeHousekeeping } from "./runtime-housekeeping.js";
import { json, normalizeOptionalText, toBooleanParam } from "./server-base-helpers.js";
import { shouldRedactReadSessionPayload } from "./server-read-access.js";
import {
  redactSecurityPostureForReadSession,
  redactRuntimeHousekeepingForReadSession,
  redactSecurityAnomalyForReadSession,
} from "./server-security-redaction.js";
import { buildRuntimeReleaseReadiness } from "./release-readiness.js";

function stripUntrustedSecurityRouteAttribution(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const {
    sourceWindowId,
    updatedByAgentId,
    updatedByWindowId,
    recordedByAgentId,
    recordedByWindowId,
    createdByAgentId,
    createdByWindowId,
    createdByReadSessionId,
    revokedByAgentId,
    revokedByWindowId,
    revokedByReadSessionId,
    rotatedByAgentId,
    rotatedByWindowId,
    rotatedByReadSessionId,
    ...rest
  } = payload;

  return rest;
}

function getIncidentPacketResidentAgentId(setup = null) {
  return (
    normalizeOptionalText(setup?.residentAgentId) ||
    normalizeOptionalText(setup?.deviceRuntime?.residentAgentId) ||
    null
  );
}

function buildIncidentAlerts(security = null, setup = null) {
  const alerts = [];
  const posture = security?.securityPosture || null;
  const formalRecovery = setup?.formalRecoveryFlow || security?.localStorageFormalFlow || null;
  const cadence = formalRecovery?.operationalCadence || null;
  const automaticBoundary =
    setup?.automaticRecoveryReadiness?.operatorBoundary ||
    security?.automaticRecovery?.operatorBoundary ||
    null;
  const constrained =
    setup?.deviceRuntime?.constrainedExecutionSummary ||
    security?.constrainedExecution ||
    null;
  const crossDevice = formalRecovery?.crossDeviceRecoveryClosure || null;

  if (posture?.mode && posture.mode !== "normal") {
    alerts.push({
      tone: posture.mode === "panic" ? "danger" : "warn",
      title: `安全姿态已提升到 ${posture.mode}`,
      detail: normalizeOptionalText(posture.summary) || "先按当前姿态保全现场，再讨论是否恢复业务。",
    });
  }

  if (["missing", "overdue", "due_soon"].includes(cadence?.status)) {
    alerts.push({
      tone: cadence.status === "due_soon" ? "warn" : "danger",
      title: `正式恢复周期 ${normalizeOptionalText(cadence?.status) || "unknown"}`,
      detail:
        normalizeOptionalText(cadence?.actionSummary) ||
        "正式恢复周期没有保持在安全窗口内，不能把自动恢复当成交付级恢复。",
    });
  }

  if (automaticBoundary?.formalFlowReady === false) {
    alerts.push({
      tone: "danger",
      title: "自动恢复不能冒充正式恢复完成",
      detail:
        normalizeOptionalText(automaticBoundary.summary) ||
        "自动恢复即使能续跑，也不代表恢复包、恢复演练和初始化包已经收口。",
    });
  }

  if (["degraded", "locked"].includes(constrained?.status)) {
    alerts.push({
      tone: "danger",
      title: `受限执行层 ${normalizeOptionalText(constrained?.status) || "unknown"}`,
      detail:
        normalizeOptionalText(constrained.summary) ||
        "受限执行边界已退化或被锁住，先停继续执行，再解释清楚为什么。",
      notes: Array.isArray(constrained?.warnings) ? constrained.warnings.slice(0, 3) : [],
    });
  }

  if (crossDevice?.readyForCutover === false) {
    alerts.push({
      tone: crossDevice?.readyForRehearsal ? "warn" : "danger",
      title: crossDevice?.readyForRehearsal ? "跨机器恢复现在只能做演练" : "跨机器恢复还不能开始",
      detail:
        normalizeOptionalText(crossDevice?.cutoverGate?.summary) ||
        normalizeOptionalText(crossDevice?.summary) ||
        "没有目标机器通过记录前，不能把系统标成可切机。",
      notes: Array.isArray(crossDevice?.sourceBlockingReasons) ? crossDevice.sourceBlockingReasons.slice(0, 3) : [],
    });
  }

  return alerts;
}

function deriveIncidentNextAction(security = null, setup = null) {
  const posture = security?.securityPosture || null;
  const constrained =
    setup?.deviceRuntime?.constrainedExecutionSummary ||
    security?.constrainedExecution ||
    null;
  const formalRecovery = setup?.formalRecoveryFlow || security?.localStorageFormalFlow || null;
  const crossDevice = formalRecovery?.crossDeviceRecoveryClosure || null;
  const cadence = formalRecovery?.operationalCadence || null;

  if (posture?.mode && posture.mode !== "normal") {
    return `先按 ${posture.mode} 姿态锁边界并保全 /api/security 与 /api/device/setup。`;
  }
  if (["degraded", "locked"].includes(constrained?.status)) {
    return "先停真实执行，查清受限执行为什么退化。";
  }
  if (formalRecovery?.runbook?.nextStepLabel && formalRecovery?.durableRestoreReady === false) {
    return `先补正式恢复主线：${formalRecovery.runbook.nextStepLabel}。`;
  }
  if (crossDevice?.readyForRehearsal === false && crossDevice?.nextStepLabel) {
    return `先收口跨机器恢复前置条件：${crossDevice.nextStepLabel}。`;
  }
  if (crossDevice?.readyForRehearsal) {
    return "源机器已就绪；下一步去目标机器按固定顺序导入恢复包、初始化包并核验。";
  }
  if (cadence?.actionSummary) {
    return cadence.actionSummary;
  }
  return "当前没有硬阻塞；继续巡检正式恢复、受限执行和跨机器恢复。";
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
  const formalRecovery = setup?.formalRecoveryFlow || security?.localStorageFormalFlow || null;
  const constrained =
    setup?.deviceRuntime?.constrainedExecutionSummary ||
    security?.constrainedExecution ||
    null;
  const automaticRecovery =
    setup?.automaticRecoveryReadiness ||
    security?.automaticRecovery ||
    null;
  const residentAgentId = getIncidentPacketResidentAgentId(setup);
  const alerts = buildIncidentAlerts(security, setup);
  const effectiveExportedAt = normalizeOptionalText(exportedAt) || new Date().toISOString();
  return {
    format: "agent-passport-incident-packet-v1",
    exportedAt: effectiveExportedAt,
    product: "agent-passport",
    sourceSurface,
    residentAgentId,
    operatorDecision: {
      summary:
        alerts.length > 0
          ? `当前先处理 ${normalizeOptionalText(alerts[0]?.title) || "未命名阻塞"}。`
          : "当前没有硬阻塞；以巡检和演练准备为主。",
      nextAction: deriveIncidentNextAction(security, setup),
      hardAlerts: alerts,
    },
    handoff: {
      summary:
        normalizeOptionalText(formalRecovery?.handoffPacket?.summary) ||
        "当前没有恢复交接真值。",
      packet: formalRecovery?.handoffPacket || null,
    },
    snapshots: {
      security,
      deviceSetup: setup,
    },
    boundaries: {
      securityPosture: security?.securityPosture || null,
      formalRecovery,
      constrainedExecution: constrained,
      automaticRecovery,
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
      residentAgentBound: Boolean(residentAgentId),
      includedSections: [
        "current_decision",
        "security_snapshot",
        "device_setup_snapshot",
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
        residentAgentId ? null : "resident_agent_binding",
      ].filter(Boolean),
    },
    exportRecord,
  };
}

async function collectIncidentPacketState() {
  const [securityPosture, setup, anomalies] = await Promise.all([
    getCurrentSecurityPostureState(),
    getDeviceSetupStatus(),
    listSecurityAnomalies({
      limit: 5,
      includeAcknowledged: true,
    }),
  ]);
  const residentAgentId = getIncidentPacketResidentAgentId(setup);
  const releaseReadiness = buildRuntimeReleaseReadiness({
    health: {
      ok: true,
      service: "agent-passport",
    },
    security: {
      securityPosture,
      localStorageFormalFlow: setup?.formalRecoveryFlow || null,
      constrainedExecution: setup?.deviceRuntime?.constrainedExecutionSummary || null,
      automaticRecovery: setup?.automaticRecoveryReadiness || null,
    },
    setup,
  });
  const security = {
    securityPosture,
    localStorageFormalFlow: setup?.formalRecoveryFlow || null,
    constrainedExecution: setup?.deviceRuntime?.constrainedExecutionSummary || null,
    automaticRecovery: setup?.automaticRecoveryReadiness || null,
    releaseReadiness,
  };
  const runner = residentAgentId
    ? await listAgentRuns(residentAgentId, { limit: 5 })
    : {
        error: "resident agent missing",
        runs: [],
        autoRecoveryAudits: [],
        counts: null,
      };
  const sandboxAudits = residentAgentId
    ? await listAgentSandboxActionAudits(residentAgentId, { limit: 5 })
    : {
        error: "resident agent missing",
        audits: [],
        counts: null,
      };
  return {
    security,
    setup,
    anomalies,
    runner,
    sandboxAudits,
    residentAgentId,
  };
}

async function recordIncidentPacketExport({
  residentAgentId = null,
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
      normalizeOptionalText(note) ||
      normalizeOptionalText(packet?.operatorDecision?.summary) ||
      "已导出事故交接包。",
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
      return json(res, 200, {
        securityPosture: shouldRedactReadSessionPayload(access)
          ? redactSecurityPostureForReadSession(posture, access)
          : posture,
      });
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
    return json(
      res,
      200,
      shouldRedactReadSessionPayload(access)
        ? {
            ...anomalies,
            anomalies: Array.isArray(anomalies.anomalies)
              ? anomalies.anomalies.map((entry) => redactSecurityAnomalyForReadSession(entry, access))
              : [],
          }
        : anomalies
    );
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
    const setup = await getDeviceSetupStatus();
    const residentAgentId = getIncidentPacketResidentAgentId(setup);
    if (!residentAgentId) {
      return json(res, 200, {
        residentAgentId: null,
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
      residentAgentId,
      history: reverseRecentEntries(history.evidenceRefs),
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
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactRuntimeHousekeepingForReadSession(housekeeping, access)
          : housekeeping
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
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactRuntimeHousekeepingForReadSession(housekeeping, access)
          : housekeeping
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
        await listReadSessions({
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
          error: "Delegated read session can only derive a child session from itself",
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

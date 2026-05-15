import {
  cloneJson,
  createRecordId,
  hashJson,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  normalizeDecisionLogStatus,
  normalizeEvidenceRefKind,
  normalizeTaskSnapshotStatus,
} from "./ledger-passport-memory-rules.js";

function requireDependency(deps = {}, name) {
  const dependency = deps?.[name];
  if (typeof dependency !== "function") {
    throw new TypeError(`${name} dependency is required`);
  }
  return dependency;
}

export function normalizeTaskSnapshotRecord(agentId, payload = {}, previousSnapshot = null, deps = {}) {
  const normalizeRuntimeDriftPolicy = requireDependency(deps, "normalizeRuntimeDriftPolicy");
  const nowIso = now();
  const createdAt = previousSnapshot?.createdAt || nowIso;
  const currentPlan = normalizeTextList(payload.currentPlan || payload.plan);
  const successCriteria = normalizeTextList(payload.successCriteria);
  const constraints = normalizeTextList(payload.constraints);
  const driftPolicy = normalizeRuntimeDriftPolicy(payload.driftPolicy || previousSnapshot?.driftPolicy || {});
  const baseRecord = {
    snapshotId: normalizeOptionalText(payload.snapshotId) || createRecordId("snap"),
    agentId,
    title: normalizeOptionalText(payload.title) ?? previousSnapshot?.title ?? null,
    objective: normalizeOptionalText(payload.objective) ?? previousSnapshot?.objective ?? null,
    status: normalizeTaskSnapshotStatus(payload.status || previousSnapshot?.status),
    currentPlan: currentPlan.length > 0 ? currentPlan : cloneJson(previousSnapshot?.currentPlan || []),
    nextAction: normalizeOptionalText(payload.nextAction) ?? previousSnapshot?.nextAction ?? null,
    constraints: constraints.length > 0 ? constraints : cloneJson(previousSnapshot?.constraints || []),
    successCriteria: successCriteria.length > 0 ? successCriteria : cloneJson(previousSnapshot?.successCriteria || []),
    checkpointSummary: normalizeOptionalText(payload.checkpointSummary) ?? previousSnapshot?.checkpointSummary ?? null,
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId || payload.updatedByWindowId) ?? previousSnapshot?.sourceWindowId ?? null,
    sourceMessageId: normalizeOptionalText(payload.sourceMessageId) ?? previousSnapshot?.sourceMessageId ?? null,
    updatedByAgentId: normalizeOptionalText(payload.updatedByAgentId || payload.recordedByAgentId) ?? agentId,
    updatedByWindowId: normalizeOptionalText(payload.updatedByWindowId || payload.sourceWindowId) ?? previousSnapshot?.updatedByWindowId ?? null,
    tags: normalizeTextList(payload.tags).length > 0 ? normalizeTextList(payload.tags) : cloneJson(previousSnapshot?.tags || []),
    driftPolicy,
    revision: Math.max(1, Math.floor(toFiniteNumber(payload.revision, (previousSnapshot?.revision || 0) + 1))),
    createdAt,
    updatedAt: nowIso,
  };

  baseRecord.checkpointHash = hashJson({
    agentId: baseRecord.agentId,
    title: baseRecord.title,
    objective: baseRecord.objective,
    status: baseRecord.status,
    currentPlan: baseRecord.currentPlan,
    nextAction: baseRecord.nextAction,
    constraints: baseRecord.constraints,
    successCriteria: baseRecord.successCriteria,
    checkpointSummary: baseRecord.checkpointSummary,
    revision: baseRecord.revision,
  });

  return baseRecord;
}

export function normalizeDecisionLogRecord(agentId, payload = {}) {
  return {
    decisionId: normalizeOptionalText(payload.decisionId) || createRecordId("dec"),
    agentId,
    summary: normalizeOptionalText(payload.summary) ?? null,
    rationale: normalizeOptionalText(payload.rationale) ?? null,
    scope: normalizeOptionalText(payload.scope) ?? "task",
    status: normalizeDecisionLogStatus(payload.status),
    relatedSnapshotId: normalizeOptionalText(payload.relatedSnapshotId) ?? null,
    relatedEvidenceRefIds: normalizeTextList(payload.relatedEvidenceRefIds),
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId || payload.recordedByWindowId) ?? null,
    sourceMessageId: normalizeOptionalText(payload.sourceMessageId) ?? null,
    recordedByAgentId: normalizeOptionalText(payload.recordedByAgentId) ?? agentId,
    recordedByWindowId: normalizeOptionalText(payload.recordedByWindowId || payload.sourceWindowId) ?? null,
    tags: normalizeTextList(payload.tags),
    recordedAt: now(),
  };
}

export function normalizeConversationMinuteRecord(agentId, payload = {}) {
  return {
    minuteId: normalizeOptionalText(payload.minuteId) || createRecordId("minute"),
    agentId,
    title: normalizeOptionalText(payload.title) ?? null,
    summary: normalizeOptionalText(payload.summary) ?? null,
    transcript: normalizeOptionalText(payload.transcript || payload.content) ?? null,
    highlights: normalizeTextList(payload.highlights),
    actionItems: normalizeTextList(payload.actionItems),
    linkedMemoryIds: normalizeTextList(payload.linkedMemoryIds),
    linkedDecisionIds: normalizeTextList(payload.linkedDecisionIds),
    linkedEvidenceRefIds: normalizeTextList(payload.linkedEvidenceRefIds),
    linkedTaskSnapshotId: normalizeOptionalText(payload.linkedTaskSnapshotId) ?? null,
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId || payload.recordedByWindowId) ?? null,
    sourceMessageId: normalizeOptionalText(payload.sourceMessageId) ?? null,
    recordedByAgentId: normalizeOptionalText(payload.recordedByAgentId) ?? agentId,
    recordedByWindowId: normalizeOptionalText(payload.recordedByWindowId || payload.sourceWindowId) ?? null,
    tags: normalizeTextList(payload.tags),
    recordedAt: now(),
  };
}

export function normalizeEvidenceRefRecord(agentId, payload = {}) {
  return {
    evidenceRefId: normalizeOptionalText(payload.evidenceRefId) || createRecordId("evid"),
    agentId,
    kind: normalizeEvidenceRefKind(payload.kind),
    title: normalizeOptionalText(payload.title) ?? null,
    uri: normalizeOptionalText(payload.uri) ?? null,
    summary: normalizeOptionalText(payload.summary) ?? null,
    residentAgentReference: normalizeOptionalText(payload.residentAgentReference) ?? null,
    resolvedResidentAgentId: normalizeOptionalText(payload.resolvedResidentAgentId) ?? null,
    linkedMemoryId: normalizeOptionalText(payload.linkedMemoryId) ?? null,
    linkedCredentialId: normalizeOptionalText(payload.linkedCredentialId) ?? null,
    linkedProposalId: normalizeOptionalText(payload.linkedProposalId) ?? null,
    linkedWindowId: normalizeOptionalText(payload.linkedWindowId) ?? null,
    tags: normalizeTextList(payload.tags),
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId || payload.recordedByWindowId) ?? null,
    sourceMessageId: normalizeOptionalText(payload.sourceMessageId) ?? null,
    recordedByAgentId: normalizeOptionalText(payload.recordedByAgentId) ?? agentId,
    recordedByWindowId: normalizeOptionalText(payload.recordedByWindowId || payload.sourceWindowId) ?? null,
    recordedAt: now(),
  };
}

import {
  normalizeBooleanFlag,
  normalizeOptionalText,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  matchesCompatibleAgentId,
} from "./ledger-identity-compat.js";

const STATEFUL_SEMANTIC_SUPERSEDED_FIELDS = new Set([
  "match.observation_trace",
  "match.policy_trace",
  "match.confirmation_lifecycle",
  "match.decision_provenance",
  "match.action_execution",
  "match.external_confirmation",
  "match.feedback_trace",
  "match.event_graph",
]);

const STATEFUL_SEMANTIC_DECISION_STATUS_PRIORITIES = new Map([
  ["confirmed", 9],
  ["blocked", 8],
  ["rejected", 8],
  ["contested", 7],
  ["decided", 5],
  ["planned", 4],
  ["reported", 3],
  ["pending", 2],
  ["missing", 1],
  ["none", 0],
]);

const STATEFUL_SEMANTIC_CONFIRMATION_PRIORITIES = new Map([
  ["multi_system_confirmed", 8],
  ["single_source_confirmed", 7],
  ["partially_confirmed", 6],
  ["stale_confirmed", 4],
  ["stale_conflicted", 3],
  ["high_authority_rejected", 9],
  ["single_source_rejected", 7],
  ["multi_system_rejected", 8],
  ["contested", 6],
  ["confirmation_timeout", 2],
  ["pending", 1],
  ["reported", 1],
  ["none", 0],
]);

const STATEFUL_SEMANTIC_SOURCE_PRIORITIES = new Map([
  ["verified", 4],
  ["perceived", 3],
  ["system", 2],
  ["reported", 1],
  ["derived", 0],
]);

export function shouldSupersedePassportField(record = {}) {
  const field = normalizeOptionalText(record?.payload?.field) ?? null;
  if (!field) {
    return false;
  }
  if (record.layer === "profile" || record.layer === "working") {
    return true;
  }
  return record.layer === "semantic" && STATEFUL_SEMANTIC_SUPERSEDED_FIELDS.has(field);
}

function getStatefulSemanticValue(record = {}) {
  return record?.payload?.value && typeof record.payload.value === "object" ? record.payload.value : {};
}

function getStatefulSemanticLadderStageStatus(record = {}, targetStage = "") {
  const value = getStatefulSemanticValue(record);
  const stage = Array.isArray(value.decisionLadder)
    ? value.decisionLadder.find((item) => normalizeOptionalText(item?.stage) === normalizeOptionalText(targetStage))
    : null;
  return normalizeOptionalText(stage?.status) ?? null;
}

export function scoreStatefulSemanticRecord(record = {}) {
  const field = normalizeOptionalText(record?.payload?.field) ?? null;
  if (!field || record?.layer !== "semantic" || !STATEFUL_SEMANTIC_SUPERSEDED_FIELDS.has(field)) {
    return 0;
  }

  const value = getStatefulSemanticValue(record);
  const decisionStatus =
    normalizeOptionalText(
      value.status ??
        value.decisionStatus ??
        value.reconciliation?.effectiveDecisionStatus ??
        getStatefulSemanticLadderStageStatus(record, "decision") ??
        record?.payload?.epistemicStatus
    ) ?? "none";
  const confirmationStatus =
    normalizeOptionalText(
      value.reconciliation?.agreementStatus ??
        value.confirmationHealth?.agreementStatus ??
        getStatefulSemanticLadderStageStatus(record, "confirmation")
    ) ?? "none";
  const sourceType = normalizeOptionalText(record?.sourceType)?.toLowerCase() ?? "derived";
  const confirmationCount = Math.max(
    0,
    Math.floor(
      toFiniteNumber(
        value.confirmationCount ??
          value.sourceCount ??
          value.confirmationHealth?.confirmationCount ??
          value.confirmationHealth?.sourceCount,
        0
      )
    )
  );
  const lifecycleActivityCount = Math.max(
    0,
    Math.floor(
      toFiniteNumber(
        value.confirmationHealth?.pendingRequestCount ??
          value.pendingRequestCount,
        0
      )
    )
  ) +
    Math.max(
      0,
      Math.floor(
        toFiniteNumber(
          value.confirmationHealth?.timedOutRequestCount ??
            value.timedOutRequestCount,
          0
        )
      )
    ) +
    Math.max(
      0,
      Math.floor(
        toFiniteNumber(
          value.confirmationHealth?.resolvedRequestCount ??
            value.resolvedRequestCount,
          0
        )
      )
    );
  const highAuthoritySupportingCount = Math.max(
    0,
    Math.floor(
      toFiniteNumber(
        value.confirmationHealth?.highAuthoritySupportingCount ??
          value.highAuthoritySupportingCount,
        0
      )
    )
  );
  const requiresHumanResolution = normalizeBooleanFlag(value.confirmationHealth?.requiresHumanResolution, false);
  const humanFeedbackOverride =
    normalizeOptionalText(value.policy) === "human_feedback_override" ||
    field === "match.feedback_trace";

  let score = 0;
  score += STATEFUL_SEMANTIC_DECISION_STATUS_PRIORITIES.get(decisionStatus) ?? 0;
  score += STATEFUL_SEMANTIC_CONFIRMATION_PRIORITIES.get(confirmationStatus) ?? 0;
  score += STATEFUL_SEMANTIC_SOURCE_PRIORITIES.get(sourceType) ?? 0;
  score += Math.min(4, confirmationCount);
  score += Math.min(4, lifecycleActivityCount * 2);
  score += Math.min(3, highAuthoritySupportingCount * 2);
  if (humanFeedbackOverride) {
    score += 3;
  }
  if (requiresHumanResolution) {
    score -= 3;
  }
  if (confirmationStatus === "stale_conflicted" || confirmationStatus === "confirmation_timeout") {
    score -= 1;
  }
  return score;
}

export function findDominantStatefulSemanticRecord(activeRecords = [], incomingRecord = {}) {
  if (incomingRecord?.layer !== "semantic") {
    return null;
  }
  const incomingScore = scoreStatefulSemanticRecord(incomingRecord);
  let strongest = null;
  let strongestScore = -Infinity;

  for (const entry of activeRecords) {
    const score = scoreStatefulSemanticRecord(entry);
    if (score > strongestScore) {
      strongest = entry;
      strongestScore = score;
    }
  }

  return incomingScore < strongestScore ? strongest : null;
}

export function applyPassportMemorySupersession(store, agentId, record) {
  const supersedable =
    (record.layer === "profile" || record.layer === "working" || record.layer === "semantic") &&
    normalizeOptionalText(record.payload?.field);
  if (!supersedable) {
    return;
  }

  for (const entry of store.passportMemories || []) {
    if (
      matchesCompatibleAgentId(store, entry.agentId, agentId) &&
      entry.layer === record.layer &&
      normalizeOptionalText(entry.payload?.field) === normalizeOptionalText(record.payload?.field) &&
      entry.status !== "superseded"
    ) {
      entry.status = "superseded";
      if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
        entry.memoryDynamics = {};
      }
      entry.memoryDynamics.supersededAt = now();
      entry.memoryDynamics.supersededBy = record.passportMemoryId;
    }
  }
}

import {
  cloneJson,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  computePassportSourceTrustScore,
} from "./ledger-passport-memory-rules.js";

const DEFAULT_WORKING_MEMORY_GATE_OPEN_THRESHOLD = 0.56;
const DEFAULT_WORKING_MEMORY_GATE_MAX_SELECTION = 6;

function requireDependency(deps = {}, name) {
  const dependency = deps?.[name];
  if (typeof dependency !== "function") {
    throw new TypeError(`${name} dependency is required`);
  }
  return dependency;
}

export function annotateWorkingMemoryEntryWithGate(entry, decision = {}) {
  const clone = cloneJson(entry) ?? {};
  if (!clone.memoryDynamics || typeof clone.memoryDynamics !== "object") {
    clone.memoryDynamics = {};
  }
  clone.memoryDynamics.gateScore = toFiniteNumber(decision.gateScore, null);
  clone.memoryDynamics.gateThreshold = toFiniteNumber(decision.threshold, null);
  clone.memoryDynamics.gateOpen = decision.gateOpen ?? null;
  clone.memoryDynamics.gateReason = normalizeTextList(decision.gateReason || []);
  clone.memoryDynamics.goalRelevanceScore = toFiniteNumber(decision.goalRelevanceScore, null);
  clone.memoryDynamics.queryRelevanceScore = toFiniteNumber(decision.queryRelevanceScore, null);
  clone.memoryDynamics.interferenceRiskScore = toFiniteNumber(decision.interferenceRiskScore, null);
  clone.memoryDynamics.gateRecencyScore = toFiniteNumber(decision.recencyScore, null);
  return clone;
}

export function buildWorkingMemoryGateDecision(
  entry,
  workingEntries = [],
  {
    queryText = null,
    currentGoal = null,
    referenceTime = now(),
  } = {},
  deps = {}
) {
  const buildPassportMemorySearchText = requireDependency(deps, "buildPassportMemorySearchText");
  const compareTextSimilarity = requireDependency(deps, "compareTextSimilarity");
  const computePassportMemoryAgeDays = requireDependency(deps, "computePassportMemoryAgeDays");
  const getPassportMemorySeparationKey = requireDependency(deps, "getPassportMemorySeparationKey");
  const searchText = buildPassportMemorySearchText(entry);
  const goalRelevanceScore = Math.max(
    compareTextSimilarity(searchText, currentGoal),
    compareTextSimilarity(normalizeOptionalText(entry?.payload?.field), currentGoal)
  );
  const queryRelevanceScore = Math.max(
    compareTextSimilarity(searchText, queryText),
    compareTextSimilarity(normalizeOptionalText(entry?.summary), queryText)
  );
  const ageDays = computePassportMemoryAgeDays(entry, referenceTime);
  const recencyScore = Number(Math.max(0.06, Math.exp(-0.32 * Math.max(0, ageDays * 24))).toFixed(2));
  const salienceScore = toFiniteNumber(entry?.salience, entry?.memoryDynamics?.salienceScore ?? 0.5);
  const confidenceScore = toFiniteNumber(entry?.confidence, entry?.memoryDynamics?.confidenceScore ?? 0.5);
  const sourceTrust = computePassportSourceTrustScore(entry?.sourceType);
  const sameKindCount = workingEntries.filter((candidate) => candidate?.kind === entry?.kind).length - 1;
  const sameSeparationCount = workingEntries.filter(
    (candidate) =>
      candidate?.passportMemoryId !== entry?.passportMemoryId &&
      getPassportMemorySeparationKey(candidate) &&
      getPassportMemorySeparationKey(candidate) === getPassportMemorySeparationKey(entry)
  ).length;
  const lowSignalConversationPenalty =
    entry?.kind === "conversation_turn" && goalRelevanceScore < 0.14 && queryRelevanceScore < 0.14
      ? 0.14
      : 0;
  const forceBlockLowSignalConversation =
    entry?.kind === "conversation_turn" &&
    goalRelevanceScore < 0.18 &&
    queryRelevanceScore < 0.18 &&
    salienceScore < 0.72;
  const internalGenerationPenalty =
    toFiniteNumber(entry?.sourceFeatures?.internalGenerationRisk, entry?.memoryDynamics?.internalGenerationRisk ?? 0) * 0.08;
  const checkpointBoost = entry?.kind === "checkpoint_summary" ? 0.18 : 0;
  const taskFieldBoost =
    ["current_task", "next_action"].includes(normalizeOptionalText(entry?.payload?.field) ?? "")
      ? 0.14
      : 0;
  const interferenceRiskScore = Number(
    Math.max(
      0,
      Math.min(
        1,
        (
          (Math.max(0, sameKindCount) * 0.06) +
          (Math.max(0, sameSeparationCount) * 0.14) +
          lowSignalConversationPenalty +
          internalGenerationPenalty
        ).toFixed(2)
      )
    )
  );
  const gateScore = Number(
    Math.max(
      0,
      Math.min(
        1,
        (
          (goalRelevanceScore * 0.28) +
          (queryRelevanceScore * 0.22) +
          (recencyScore * 0.18) +
          (salienceScore * 0.12) +
          (confidenceScore * 0.08) +
          (sourceTrust * 0.08) +
          checkpointBoost +
          taskFieldBoost -
          (interferenceRiskScore * 0.2)
        ).toFixed(2)
      )
    )
  );
  const threshold =
    entry?.kind === "checkpoint_summary"
      ? 0.36
      : entry?.kind === "tool_result"
        ? 0.48
        : DEFAULT_WORKING_MEMORY_GATE_OPEN_THRESHOLD;
  const gateReason = [];
  if (goalRelevanceScore >= 0.24) {
    gateReason.push("goal_relevant");
  }
  if (queryRelevanceScore >= 0.2) {
    gateReason.push("query_relevant");
  }
  if (recencyScore >= 0.72) {
    gateReason.push("recent");
  }
  if (checkpointBoost > 0) {
    gateReason.push("checkpoint_anchor");
  }
  if (taskFieldBoost > 0) {
    gateReason.push("task_anchor");
  }
  if (interferenceRiskScore >= 0.28) {
    gateReason.push("high_interference");
  }
  if (forceBlockLowSignalConversation) {
    gateReason.push("low_signal_conversation");
  }
  return {
    gateScore,
    threshold,
    gateOpen: !forceBlockLowSignalConversation && gateScore >= threshold,
    gateReason,
    goalRelevanceScore: Number(goalRelevanceScore.toFixed(2)),
    queryRelevanceScore: Number(queryRelevanceScore.toFixed(2)),
    recencyScore,
    interferenceRiskScore,
  };
}

export function selectGatedWorkingMemories(
  entries = [],
  {
    queryText = null,
    currentGoal = null,
    limit = DEFAULT_WORKING_MEMORY_GATE_MAX_SELECTION,
  } = {},
  deps = {}
) {
  const decisions = entries.map((entry) => ({
    entry,
    decision: buildWorkingMemoryGateDecision(entry, entries, { queryText, currentGoal }, deps),
  }));
  const normalizedLimit = Math.max(1, Math.floor(toFiniteNumber(limit, DEFAULT_WORKING_MEMORY_GATE_MAX_SELECTION)));
  const sortedOpen = decisions
    .filter((item) => item.decision.gateOpen)
    .sort((left, right) => {
      const gateDelta = right.decision.gateScore - left.decision.gateScore;
      return gateDelta || (right.entry?.recordedAt || "").localeCompare(left.entry?.recordedAt || "");
    });
  const selected = sortedOpen.slice(0, normalizedLimit);
  const selectedIds = new Set(selected.map((item) => item.entry?.passportMemoryId).filter(Boolean));
  const latestCheckpoint = decisions
    .filter((item) => item.entry?.kind === "checkpoint_summary")
    .sort((left, right) => (right.entry?.recordedAt || "").localeCompare(left.entry?.recordedAt || ""))[0] ?? null;
  if (latestCheckpoint?.entry?.passportMemoryId && !selectedIds.has(latestCheckpoint.entry.passportMemoryId) && selected.length < normalizedLimit) {
    selected.push(latestCheckpoint);
    selectedIds.add(latestCheckpoint.entry.passportMemoryId);
  }
  const latestConversation = decisions
    .filter((item) => item.entry?.kind === "conversation_turn")
    .sort((left, right) => (right.entry?.recordedAt || "").localeCompare(left.entry?.recordedAt || ""))[0] ?? null;
  if (latestConversation?.entry?.passportMemoryId && !selectedIds.has(latestConversation.entry.passportMemoryId) && selected.length < normalizedLimit) {
    selected.push(latestConversation);
    selectedIds.add(latestConversation.entry.passportMemoryId);
  }

  const selectedEntries = decisions
    .filter((item) => selectedIds.has(item.entry?.passportMemoryId))
    .sort((left, right) => (left.entry?.recordedAt || "").localeCompare(right.entry?.recordedAt || ""))
    .map((item) => annotateWorkingMemoryEntryWithGate(item.entry, item.decision));
  const blockedEntries = decisions
    .filter((item) => !selectedIds.has(item.entry?.passportMemoryId))
    .sort((left, right) => right.decision.gateScore - left.decision.gateScore)
    .slice(0, 6)
    .map((item) => annotateWorkingMemoryEntryWithGate(item.entry, item.decision));

  return {
    selectedEntries,
    blockedEntries,
    selectedCount: selectedEntries.length,
    blockedCount: Math.max(0, entries.length - selectedEntries.length),
    averageGateScore:
      decisions.length > 0
        ? Number((decisions.reduce((sum, item) => sum + toFiniteNumber(item.decision.gateScore, 0), 0) / decisions.length).toFixed(2))
        : 0,
    maxSelection: normalizedLimit,
  };
}

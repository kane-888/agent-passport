import {
  cloneJson,
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
  buildPassportCognitiveBias,
  buildPassportMemorySearchText,
  getPassportMemoryPatternKey,
} from "./ledger-passport-memory-retrieval.js";
import {
  extractPassportMemoryComparableValue,
  isPassportMemoryActive,
} from "./ledger-passport-memory-rules.js";
import {
  normalizePassportMemoryRecord,
} from "./ledger-passport-memory-record.js";
import {
  applyPassportMemorySupersession,
} from "./ledger-passport-memory-supersession.js";
import {
  buildPassportEventGraphNodeText,
} from "./ledger-response-verification.js";

const DEFAULT_MEMORY_PROMOTION_RECALL_THRESHOLD = 2;
const DEFAULT_MEMORY_PROMOTION_SALIENCE_THRESHOLD = 0.72;
const DEFAULT_MEMORY_REPLAY_CLUSTER_MIN_SIZE = 2;
const DEFAULT_MEMORY_REPLAY_MAX_PATTERNS = 3;
const DEFAULT_OFFLINE_REPLAY_CLUSTER_MIN_SIZE = 2;
const DEFAULT_OFFLINE_REPLAY_MAX_PATTERNS = 2;
const DEFAULT_SLEEP_STAGE_SEQUENCE = [
  "nrem_prioritization",
  "sws_systems_consolidation",
  "rem_associative_recombination",
];

function requireDependency(deps = {}, name) {
  const dependency = deps?.[name];
  if (typeof dependency !== "function") {
    throw new TypeError(`${name} dependency is required`);
  }
  return dependency;
}

function clampUnitInterval(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number(Math.max(0, Math.min(1, fallback)).toFixed(2));
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(2));
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

export function scorePassportMemoryReplayValue(entry = {}) {
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

export function buildPassportMemoryReplayGroups(entries = []) {
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

export function buildPassportReplaySummary(group) {
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

export function scorePassportOfflineReplayPriority(entry = {}, { currentGoal = null, cognitiveState = null } = {}) {
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

export function buildPassportReplayGroupDrivers(group = {}, { currentGoal = null, cognitiveState = null } = {}) {
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

export function shouldRunPassportOfflineReplay({
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

export function buildPassportOfflineReplayEventGraph(group = {}) {
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

export function buildPassportSleepStageTrace(group = {}, { currentGoal = null, cognitiveState = null } = {}) {
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

export function buildPassportOfflineReplayNarrative(group = {}, { currentGoal = null, sleepStages = [] } = {}) {
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

export function runPassportOfflineReplayCycle(
  store,
  agent,
  {
    sourceWindowId = null,
    currentGoal = null,
    cognitiveState = null,
    activeWorking = [],
    activeEpisodic = [],
    offlineReplayRequested = false,
  } = {},
  deps = {}
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
    const appendEvent = requireDependency(deps, "appendEvent");
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

export function runPassportReplayConsolidationCycle(
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

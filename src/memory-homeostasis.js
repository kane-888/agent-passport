import {
  cloneJson,
  createRecordId,
  normalizeOptionalText,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import { AGENT_PASSPORT_LOCAL_REASONER_LABEL } from "./openneed-memory-engine.js";

export const MEMORY_HOMEOSTASIS_DEFAULT_WEIGHTS = Object.freeze({
  alpha: 0.4,
  beta: 0.25,
  gamma: 0.2,
  delta: 0.15,
});

export const MEMORY_HOMEOSTASIS_DEFAULT_THRESHOLDS = Object.freeze({
  tau1: 0.2,
  tau2: 0.35,
  tau3: 0.5,
});

export const MEMORY_HOMEOSTASIS_DEFAULT_BENCHMARK = Object.freeze({
  baselineLength: 512,
  lengths: [1024, 4096, 8192],
  positions: ["front", "middle", "tail"],
  factCount: 2,
  retentionFloor: 0.85,
});

export const MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS = Object.freeze({
  maxContextLength: 32768,
  maxLengthCount: 6,
  maxFactCount: 4,
  maxPositionCount: 3,
});

function clip(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value, digits = 4) {
  const numeric = toFiniteNumber(value, 0);
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function normalizeUnit(value, fallback = 0) {
  return round(clip(toFiniteNumber(value, fallback), 0, 1));
}

function normalizePositiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.min(maximum, Math.max(minimum, Math.floor(fallback)));
  }
  return Math.min(maximum, Math.max(minimum, Math.floor(numeric)));
}

function normalizePosition(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (["front", "head", "start"].includes(normalized)) {
    return "front";
  }
  if (["middle", "mid", "center", "centre"].includes(normalized)) {
    return "middle";
  }
  if (["tail", "back", "end"].includes(normalized)) {
    return "tail";
  }
  return "middle";
}

function normalizeCorrectionLevel(value) {
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

function compareScenario(left, right) {
  const lengthDelta = toFiniteNumber(left?.contextLength, 0) - toFiniteNumber(right?.contextLength, 0);
  if (lengthDelta !== 0) {
    return lengthDelta;
  }
  const order = {
    front: 0,
    middle: 1,
    tail: 2,
  };
  const positionDelta = (order[normalizePosition(left?.position)] ?? 9) - (order[normalizePosition(right?.position)] ?? 9);
  if (positionDelta !== 0) {
    return positionDelta;
  }
  return String(left?.scenarioId || "").localeCompare(String(right?.scenarioId || ""));
}

function normalizeBenchmarkScenario(scenario = {}) {
  return {
    scenarioId: normalizeOptionalText(scenario.scenarioId) ?? createRecordId("mhbench"),
    contextLength: normalizePositiveInteger(
      scenario.contextLength ?? scenario.length,
      MEMORY_HOMEOSTASIS_DEFAULT_BENCHMARK.baselineLength,
      32
    ),
    position: normalizePosition(scenario.position),
    factIndex: Math.max(0, Math.floor(toFiniteNumber(scenario.factIndex, 0))),
    question: normalizeOptionalText(scenario.question) ?? null,
    expectedAnswer: normalizeOptionalText(scenario.expectedAnswer) ?? null,
    answer: normalizeOptionalText(scenario.answer) ?? null,
    accuracy: normalizeUnit(
      scenario.accuracy ??
        scenario.score ??
        (scenario.correct === true ? 1 : scenario.correct === false ? 0 : 0),
      0
    ),
    error: normalizeOptionalText(scenario.error) ?? null,
    measuredAt: normalizeOptionalText(scenario.measuredAt) ?? null,
  };
}

function average(values = [], fallback = 0) {
  const valid = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (valid.length === 0) {
    return fallback;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function logLength(value) {
  return Math.log(Math.max(1, toFiniteNumber(value, 1)));
}

export function buildMemoryHomeostasisBenchmarkPlan(options = {}) {
  const baselineLength = normalizePositiveInteger(
    options.baselineLength,
    MEMORY_HOMEOSTASIS_DEFAULT_BENCHMARK.baselineLength,
    32,
    MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxContextLength
  );
  const requestedLengths = (
    Array.isArray(options.lengths) ? options.lengths : MEMORY_HOMEOSTASIS_DEFAULT_BENCHMARK.lengths
  ).slice(0, MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxLengthCount * 2);
  const uniqueLengths = Array.from(
    new Set(
      requestedLengths
        .map((value) =>
          normalizePositiveInteger(value, baselineLength, 32, MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxContextLength)
        )
        .concat([baselineLength])
    )
  ).sort((left, right) => left - right);
  const lengths = [
    baselineLength,
    ...uniqueLengths.filter((length) => length !== baselineLength),
  ]
    .slice(0, MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxLengthCount)
    .sort((left, right) => left - right);
  const requestedPositions = (
    Array.isArray(options.positions) ? options.positions : MEMORY_HOMEOSTASIS_DEFAULT_BENCHMARK.positions
  ).slice(0, MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxPositionCount * 2);
  const positions = Array.from(
    new Set(requestedPositions.map(normalizePosition))
  ).slice(0, MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxPositionCount);
  const factCount = normalizePositiveInteger(
    options.factCount,
    MEMORY_HOMEOSTASIS_DEFAULT_BENCHMARK.factCount,
    1,
    MEMORY_HOMEOSTASIS_BENCHMARK_LIMITS.maxFactCount
  );
  const scenarios = [];
  for (const length of lengths) {
    for (const position of positions) {
      for (let factIndex = 0; factIndex < factCount; factIndex += 1) {
        scenarios.push({
          scenarioId: `mh_${length}_${position}_${factIndex + 1}`,
          contextLength: length,
          position,
          factIndex,
          baseline: length === baselineLength,
        });
      }
    }
  }
  return {
    baselineLength,
    lengths,
    positions,
    factCount,
    scenarios,
  };
}

export function computeMemoryHomeostasisModelProfile({
  modelName = null,
  benchmark = {},
  createdAt = now(),
  benchmarkMeta = null,
} = {}) {
  const plan = buildMemoryHomeostasisBenchmarkPlan(benchmark);
  const retentionFloor = clip(
    toFiniteNumber(
      benchmark.retentionFloor ??
        benchmarkMeta?.retentionFloor ??
        MEMORY_HOMEOSTASIS_DEFAULT_BENCHMARK.retentionFloor,
      MEMORY_HOMEOSTASIS_DEFAULT_BENCHMARK.retentionFloor
    ),
    0.1,
    1
  );
  const normalizedScenarios = Array.isArray(benchmark.scenarios)
    ? benchmark.scenarios.map(normalizeBenchmarkScenario).sort(compareScenario)
    : [];
  const cells = new Map();
  for (const scenario of normalizedScenarios) {
    const key = `${scenario.contextLength}:${scenario.position}`;
    const entry = cells.get(key) || {
      contextLength: scenario.contextLength,
      position: scenario.position,
      accuracies: [],
      scenarios: [],
      errorCount: 0,
    };
    entry.accuracies.push(scenario.accuracy);
    entry.scenarios.push(cloneJson(scenario));
    if (scenario.error) {
      entry.errorCount += 1;
    }
    cells.set(key, entry);
  }

  const cellResults = [];
  for (const length of plan.lengths) {
    for (const position of plan.positions) {
      const key = `${length}:${position}`;
      const entry = cells.get(key) || {
        contextLength: length,
        position,
        accuracies: [],
        scenarios: [],
        errorCount: 0,
      };
      const accuracy = normalizeUnit(average(entry.accuracies, 0), 0);
      cellResults.push({
        contextLength: length,
        position,
        accuracy,
        scenarioCount: entry.scenarios.length,
        errorCount: entry.errorCount,
        scenarios: cloneJson(entry.scenarios) ?? [],
      });
    }
  }

  const baselineCells = cellResults.filter((cell) => cell.contextLength === plan.baselineLength);
  const baselineAccuracy = Math.max(
    0.0001,
    average(
      baselineCells.map((cell) => cell.accuracy),
      average(cellResults.map((cell) => cell.accuracy), 0.0001)
    )
  );

  const retainedCells = cellResults.map((cell) => ({
    ...cell,
    retention: normalizeUnit(cell.accuracy / baselineAccuracy, 0),
  }));

  const retentionByLength = new Map();
  for (const length of plan.lengths) {
    retentionByLength.set(
      length,
      retainedCells.filter((cell) => cell.contextLength === length)
    );
  }

  const logLengths = plan.lengths.map(logLength);
  const minLog = Math.min(...logLengths);
  const maxLog = Math.max(...logLengths);
  const spanLog = Math.max(maxLog - minLog, 1);
  const ccrsByPosition = [];
  for (const position of plan.positions) {
    const points = plan.lengths.map((length) => {
      const cell = retainedCells.find(
        (item) => item.contextLength === length && item.position === position
      );
      return {
        x: spanLog > 0 ? (logLength(length) - minLog) / spanLog : 0,
        y: normalizeUnit(cell?.retention ?? 0, 0),
      };
    });
    if (points.length === 1) {
      ccrsByPosition.push(points[0]?.y ?? 0);
      continue;
    }
    let area = 0;
    for (let index = 1; index < points.length; index += 1) {
      const left = points[index - 1];
      const right = points[index];
      area += (right.x - left.x) * ((left.y + right.y) / 2);
    }
    ccrsByPosition.push(clip(area, 0, 1));
  }
  const ccrs = normalizeUnit(average(ccrsByPosition, average(retainedCells.map((cell) => cell.retention), 0)), 0);

  const averageRetentionByLength = plan.lengths.map((length) => ({
    length,
    retention: normalizeUnit(
      average((retentionByLength.get(length) || []).map((cell) => cell.retention), 0),
      0
    ),
  }));

  const ecl085 =
    averageRetentionByLength
      .filter((item) => item.retention >= retentionFloor)
      .sort((left, right) => right.length - left.length)[0]?.length ?? plan.baselineLength;

  const positionGaps = plan.lengths.map((length) => {
    const items = retentionByLength.get(length) || [];
    const retentions = items.map((item) => item.retention);
    if (retentions.length === 0) {
      return 1;
    }
    return clip(Math.max(...retentions) - Math.min(...retentions), 0, 1);
  });
  const pr = normalizeUnit(1 - average(positionGaps, 1), 0);

  const midDrops = plan.lengths.map((length) => {
    const front = retainedCells.find((item) => item.contextLength === length && item.position === "front")?.retention ?? 0;
    const middle = retainedCells.find((item) => item.contextLength === length && item.position === "middle")?.retention ?? 0;
    const tail = retainedCells.find((item) => item.contextLength === length && item.position === "tail")?.retention ?? 0;
    return clip(((front + tail) / 2) - middle, 0, 1);
  });
  const midDrop = normalizeUnit(average(midDrops, 0), 0);

  return normalizeModelProfileRecord({
    modelName,
    ccrs,
    ecl085,
    pr,
    midDrop,
    createdAt,
    benchmarkMeta: {
      plan,
      baselineAccuracy: round(baselineAccuracy),
      retentionFloor: round(retentionFloor),
      averageRetentionByLength,
      cci: round(1 - ccrs),
      ccrsByPosition: plan.positions.map((position, index) => ({
        position,
        ccrs: round(ccrsByPosition[index] ?? 0),
      })),
      cellResults: retainedCells.map((cell) => ({
        contextLength: cell.contextLength,
        position: cell.position,
        accuracy: cell.accuracy,
        retention: cell.retention,
        scenarioCount: cell.scenarioCount,
        errorCount: cell.errorCount,
      })),
      rawScenarios: normalizedScenarios,
      ...(benchmarkMeta && typeof benchmarkMeta === "object" ? cloneJson(benchmarkMeta) : {}),
    },
  });
}

export function normalizeModelProfileRecord(value = {}) {
  const modelName = normalizeOptionalText(value.modelName || value.model_name) ?? AGENT_PASSPORT_LOCAL_REASONER_LABEL;
  const benchmarkMeta =
    value.benchmarkMeta && typeof value.benchmarkMeta === "object" ? cloneJson(value.benchmarkMeta) : {};
  return {
    modelProfileId: normalizeOptionalText(value.modelProfileId) ?? createRecordId("mprof"),
    modelName,
    ccrs: normalizeUnit(value.ccrs, 0.5),
    ecl085: normalizePositiveInteger(value.ecl085 ?? value.ecl_085, MEMORY_HOMEOSTASIS_DEFAULT_BENCHMARK.baselineLength, 32),
    pr: normalizeUnit(value.pr, 0.5),
    midDrop: normalizeUnit(value.midDrop ?? value.mid_drop, 0.25),
    createdAt: normalizeOptionalText(value.createdAt || value.created_at) ?? now(),
    benchmarkMeta,
  };
}

export function buildModelProfileView(profile = null) {
  const normalized = profile ? normalizeModelProfileRecord(profile) : null;
  if (!normalized) {
    return null;
  }
  return {
    ...cloneJson(normalized),
    model_name: normalized.modelName,
    ecl_085: normalized.ecl085,
    mid_drop: normalized.midDrop,
    created_at: normalized.createdAt,
  };
}

export function normalizeMemoryAnchorRecord(value = {}) {
  const record = value && typeof value === "object" ? value : {};
  return {
    memoryId: normalizeOptionalText(record.memoryId || record.memory_id) ?? createRecordId("anchor"),
    content: normalizeOptionalText(record.content) ?? null,
    importanceWeight: round(
      Math.max(0.05, toFiniteNumber(record.importanceWeight ?? record.importance_weight, 1)),
      3
    ),
    source: normalizeOptionalText(record.source) ?? "unknown",
    insertedPosition: normalizePosition(record.insertedPosition ?? record.inserted_position),
    lastVerifiedAt: normalizeOptionalText(record.lastVerifiedAt || record.last_verified_at) ?? null,
    lastVerifiedOk:
      record.lastVerifiedOk != null || record.last_verified_ok != null
        ? Boolean(record.lastVerifiedOk ?? record.last_verified_ok)
        : null,
    expectedValue: normalizeOptionalText(record.expectedValue || record.expected_value) ?? null,
    probeQuestion: normalizeOptionalText(record.probeQuestion || record.probe_question) ?? null,
    authorityRank: round(Math.max(0, toFiniteNumber(record.authorityRank ?? record.authority_rank, 0.5)), 3),
    conflictState: record.conflictState && typeof record.conflictState === "object" ? cloneJson(record.conflictState) : null,
    metadata: record.metadata && typeof record.metadata === "object" ? cloneJson(record.metadata) : null,
  };
}

function normalizeWeights(weights = null) {
  return {
    alpha: normalizeUnit(weights?.alpha, MEMORY_HOMEOSTASIS_DEFAULT_WEIGHTS.alpha),
    beta: normalizeUnit(weights?.beta, MEMORY_HOMEOSTASIS_DEFAULT_WEIGHTS.beta),
    gamma: normalizeUnit(weights?.gamma, MEMORY_HOMEOSTASIS_DEFAULT_WEIGHTS.gamma),
    delta: normalizeUnit(weights?.delta, MEMORY_HOMEOSTASIS_DEFAULT_WEIGHTS.delta),
  };
}

function normalizeThresholds(thresholds = null) {
  return {
    tau1: normalizeUnit(thresholds?.tau1, MEMORY_HOMEOSTASIS_DEFAULT_THRESHOLDS.tau1),
    tau2: normalizeUnit(thresholds?.tau2, MEMORY_HOMEOSTASIS_DEFAULT_THRESHOLDS.tau2),
    tau3: normalizeUnit(thresholds?.tau3, MEMORY_HOMEOSTASIS_DEFAULT_THRESHOLDS.tau3),
  };
}

export function buildMemoryPlacementStrategy({
  modelProfile = null,
  ctxTokens = 0,
  maxContextTokens = 0,
  anchorCount = 0,
  previousState = null,
  correctionLevel = "none",
} = {}) {
  const profile = normalizeModelProfileRecord(modelProfile || {});
  const normalizedCorrectionLevel = normalizeCorrectionLevel(correctionLevel);
  const loadRatio = clip(
    toFiniteNumber(ctxTokens, 0) / Math.max(1, toFiniteNumber(profile.ecl085, 1)),
    0,
    2
  );
  const nearEffectiveLimit = loadRatio >= 0.8;
  const elevatedRisk = toFiniteNumber(previousState?.cT ?? previousState?.c_t, 0) >= MEMORY_HOMEOSTASIS_DEFAULT_THRESHOLDS.tau1;
  const lowerDensity = profile.ccrs < 0.55;
  const avoidMiddle = profile.midDrop >= 0.12 || normalizedCorrectionLevel !== "none";
  const increaseReorderFrequency = profile.pr < 0.65 || elevatedRisk;
  const anchorTailBias = avoidMiddle || nearEffectiveLimit;
  const preemptiveCompression =
    nearEffectiveLimit ||
    normalizedCorrectionLevel === "medium" ||
    normalizedCorrectionLevel === "strong";
  return {
    avoidMiddle,
    increaseReorderFrequency,
    preemptiveCompression,
    lowerMemoryDensity: lowerDensity,
    authoritativeReloadPreferred: normalizedCorrectionLevel === "strong",
    anchorTailBias,
    reorderCadence: increaseReorderFrequency ? "high" : "normal",
    maxTailAnchors: lowerDensity ? 4 : Math.max(4, Math.min(8, anchorCount || 4)),
    workingMemorySelectionLimit: lowerDensity ? 3 : 4,
    projectedLoadRatio: round(loadRatio),
    maxContextTokens: Math.max(0, Math.floor(toFiniteNumber(maxContextTokens, 0))),
    modelSignals: {
      ccrs: profile.ccrs,
      ecl085: profile.ecl085,
      pr: profile.pr,
      midDrop: profile.midDrop,
    },
  };
}

export function selectMemoryProbeAnchors(anchors = [], { maxAnchors = 3 } = {}) {
  const normalizedAnchors = (Array.isArray(anchors) ? anchors : [])
    .map((anchor) => normalizeMemoryAnchorRecord(anchor))
    .sort((left, right) => {
      const leftPriority =
        left.importanceWeight +
        (left.insertedPosition === "middle" ? 0.25 : 0) +
        (left.lastVerifiedOk === false ? 0.2 : 0);
      const rightPriority =
        right.importanceWeight +
        (right.insertedPosition === "middle" ? 0.25 : 0) +
        (right.lastVerifiedOk === false ? 0.2 : 0);
      return rightPriority - leftPriority;
    });
  return normalizedAnchors.slice(0, Math.max(1, normalizePositiveInteger(maxAnchors, 3, 1)));
}

export function applyMemoryProbeResults(anchors = [], probeResults = [], { verifiedAt = now() } = {}) {
  const resultMap = new Map(
    (Array.isArray(probeResults) ? probeResults : [])
      .map((item) => ({
        memoryId: normalizeOptionalText(item?.memoryId || item?.memory_id) ?? null,
        ok: item?.ok != null ? Boolean(item.ok) : null,
        recalled: normalizeOptionalText(item?.recalled) ?? null,
      }))
      .filter((item) => item.memoryId)
      .map((item) => [item.memoryId, item])
  );

  return (Array.isArray(anchors) ? anchors : []).map((anchor) => {
    const normalized = normalizeMemoryAnchorRecord(anchor);
    const probe = resultMap.get(normalized.memoryId);
    if (!probe) {
      return normalized;
    }
    return {
      ...normalized,
      lastVerifiedAt: verifiedAt,
      lastVerifiedOk: probe.ok,
      metadata: {
        ...(normalized.metadata && typeof normalized.metadata === "object" ? normalized.metadata : {}),
        recalled: probe.recalled,
      },
    };
  });
}

export function computeRuntimeMemoryHomeostasis({
  sessionId = null,
  agentId = null,
  modelName = null,
  ctxTokens = 0,
  memoryAnchors = [],
  checkedMemories = null,
  conflictMemories = null,
  modelProfile = null,
  weights = null,
  thresholds = null,
  correctionLevel = null,
  triggerReason = null,
  sourceWindowId = null,
  createdAt = now(),
  updatedAt = createdAt,
  previousState = null,
} = {}) {
  const normalizedAnchors = (Array.isArray(memoryAnchors) ? memoryAnchors : []).map((anchor) =>
    normalizeMemoryAnchorRecord(anchor)
  );
  const profile = normalizeModelProfileRecord(modelProfile || { modelName });
  const effectiveWeights = normalizeWeights(weights);
  const effectiveThresholds = normalizeThresholds(thresholds);
  const verifiedWeight = normalizedAnchors
    .filter((anchor) => anchor.lastVerifiedOk === true)
    .reduce((sum, anchor) => sum + anchor.importanceWeight, 0);
  const totalWeight = normalizedAnchors.reduce((sum, anchor) => sum + anchor.importanceWeight, 0);
  const vt = totalWeight > 0 ? normalizeUnit(verifiedWeight / totalWeight, 0) : 1;
  const checkedMemoryCount =
    checkedMemories != null
      ? Math.max(0, Math.floor(toFiniteNumber(checkedMemories, 0)))
      : normalizedAnchors.filter((anchor) => anchor.lastVerifiedOk != null).length;
  const inferredConflictCount = normalizedAnchors.filter(
    (anchor) => anchor.conflictState?.hasConflict === true
  ).length;
  const conflictMemoryCount =
    conflictMemories != null
      ? Math.max(0, Math.floor(toFiniteNumber(conflictMemories, 0)))
      : inferredConflictCount;
  const lt = normalizeUnit(
    toFiniteNumber(ctxTokens, 0) / Math.max(1, toFiniteNumber(profile.ecl085, 1)),
    0
  );
  const middleAnchorRatio =
    normalizedAnchors.length > 0
      ? normalizedAnchors.filter((anchor) => anchor.insertedPosition === "middle").length /
        normalizedAnchors.length
      : 0;
  const rPosT = normalizeUnit(profile.midDrop * middleAnchorRatio, 0);
  const xT = checkedMemoryCount > 0 ? normalizeUnit(conflictMemoryCount / checkedMemoryCount, 0) : 0;
  const sT = normalizeUnit(
    (effectiveWeights.alpha * vt) +
      (effectiveWeights.beta * (1 - lt)) +
      (effectiveWeights.gamma * (1 - rPosT)) +
      (effectiveWeights.delta * (1 - xT)),
    0
  );
  const cT = normalizeUnit(1 - sT, 0);
  const resolvedCorrectionLevel =
    normalizeCorrectionLevel(correctionLevel) !== "none"
      ? normalizeCorrectionLevel(correctionLevel)
      : cT > effectiveThresholds.tau3
        ? "strong"
        : cT > effectiveThresholds.tau2
          ? "medium"
          : cT > effectiveThresholds.tau1
            ? "light"
            : "none";
  const placementStrategy = buildMemoryPlacementStrategy({
    modelProfile: profile,
    ctxTokens,
    previousState,
    correctionLevel: resolvedCorrectionLevel,
    anchorCount: normalizedAnchors.length,
  });

  return normalizeRuntimeMemoryStateRecord({
    runtimeMemoryStateId: createRecordId("mhstate"),
    sessionId,
    agentId,
    modelName: normalizeOptionalText(modelName) ?? profile.modelName,
    ctxTokens,
    memoryAnchors: normalizedAnchors,
    checkedMemories: checkedMemoryCount,
    conflictMemories: conflictMemoryCount,
    vT: vt,
    lT: lt,
    rPosT,
    xT,
    sT,
    cT,
    correctionLevel: resolvedCorrectionLevel,
    triggerReason,
    sourceWindowId,
    placementStrategy,
    thresholds: effectiveThresholds,
    weights: effectiveWeights,
    profile: buildModelProfileView(profile),
    scoreBreakdown: {
      vt,
      lt,
      rPosT,
      xT,
      middleAnchorRatio: round(middleAnchorRatio),
      totalAnchorWeight: round(totalWeight),
      verifiedAnchorWeight: round(verifiedWeight),
    },
    createdAt,
    updatedAt,
  });
}

export function normalizeRuntimeMemoryStateRecord(value = {}) {
  const anchors = Array.isArray(value.memoryAnchors || value.memory_anchors)
    ? (value.memoryAnchors || value.memory_anchors).map((anchor) => normalizeMemoryAnchorRecord(anchor))
    : [];
  return {
    runtimeMemoryStateId: normalizeOptionalText(value.runtimeMemoryStateId) ?? createRecordId("mhstate"),
    sessionId: normalizeOptionalText(value.sessionId || value.session_id) ?? null,
    agentId: normalizeOptionalText(value.agentId || value.agent_id) ?? null,
    modelName: normalizeOptionalText(value.modelName || value.model_name) ?? AGENT_PASSPORT_LOCAL_REASONER_LABEL,
    ctxTokens: Math.max(0, Math.floor(toFiniteNumber(value.ctxTokens ?? value.ctx_tokens, 0))),
    memoryAnchors: anchors,
    checkedMemories: Math.max(0, Math.floor(toFiniteNumber(value.checkedMemories ?? value.checked_memories, 0))),
    conflictMemories: Math.max(0, Math.floor(toFiniteNumber(value.conflictMemories ?? value.conflict_memories, 0))),
    vT: normalizeUnit(value.vT ?? value.v_t, 1),
    lT: normalizeUnit(value.lT ?? value.l_t, 0),
    rPosT: normalizeUnit(value.rPosT ?? value.r_pos_t, 0),
    xT: normalizeUnit(value.xT ?? value.x_t, 0),
    sT: normalizeUnit(value.sT ?? value.s_t, 1),
    cT: normalizeUnit(value.cT ?? value.c_t, 0),
    correctionLevel: normalizeCorrectionLevel(value.correctionLevel ?? value.correction_level),
    triggerReason: normalizeOptionalText(value.triggerReason || value.trigger_reason) ?? null,
    sourceWindowId: normalizeOptionalText(value.sourceWindowId || value.source_window_id) ?? null,
    placementStrategy:
      value.placementStrategy && typeof value.placementStrategy === "object"
        ? cloneJson(value.placementStrategy)
        : null,
    thresholds: value.thresholds && typeof value.thresholds === "object" ? cloneJson(value.thresholds) : null,
    weights: value.weights && typeof value.weights === "object" ? cloneJson(value.weights) : null,
    profile: value.profile && typeof value.profile === "object" ? cloneJson(value.profile) : null,
    scoreBreakdown:
      value.scoreBreakdown && typeof value.scoreBreakdown === "object"
        ? cloneJson(value.scoreBreakdown)
        : null,
    createdAt: normalizeOptionalText(value.createdAt || value.created_at) ?? now(),
    updatedAt: normalizeOptionalText(value.updatedAt || value.updated_at) ?? now(),
  };
}

export function buildRuntimeMemoryStateView(state = null) {
  const normalized = state ? normalizeRuntimeMemoryStateRecord(state) : null;
  if (!normalized) {
    return null;
  }
  return {
    ...cloneJson(normalized),
    session_id: normalized.sessionId,
    model_name: normalized.modelName,
    ctx_tokens: normalized.ctxTokens,
    memory_anchors: normalized.memoryAnchors.map((anchor) => ({
      ...cloneJson(anchor),
      memory_id: anchor.memoryId,
      importance_weight: anchor.importanceWeight,
      inserted_position: anchor.insertedPosition,
      last_verified_at: anchor.lastVerifiedAt,
      last_verified_ok: anchor.lastVerifiedOk,
    })),
    checked_memories: normalized.checkedMemories,
    conflict_memories: normalized.conflictMemories,
    v_t: normalized.vT,
    l_t: normalized.lT,
    r_pos_t: normalized.rPosT,
    x_t: normalized.xT,
    s_t: normalized.sT,
    c_t: normalized.cT,
    correction_level: normalized.correctionLevel,
  };
}

export function buildMemoryCorrectionPlan({
  runtimeState = null,
  modelProfile = null,
} = {}) {
  const state = runtimeState ? normalizeRuntimeMemoryStateRecord(runtimeState) : null;
  const profile = normalizeModelProfileRecord(modelProfile || state?.profile || {});
  const correctionLevel = normalizeCorrectionLevel(state?.correctionLevel);
  const actions = [];
  let summary = "memory stability healthy";
  if (correctionLevel === "light") {
    summary = "memory collapse risk rising: light correction";
    actions.push("reanchor_critical_memories_to_tail");
    actions.push("raise_memory_injection_priority");
  } else if (correctionLevel === "medium") {
    summary = "memory collapse risk elevated: moderate correction";
    actions.push("rewrite_working_memory_summary");
    actions.push("compress_low_value_history");
    actions.push("increase_memory_reorder_frequency");
  } else if (correctionLevel === "strong") {
    summary = "memory collapse risk high: strong correction";
    actions.push("reload_authoritative_memory");
    actions.push("resolve_memory_conflicts");
    actions.push("refresh_runtime_state");
    actions.push("rewrite_working_memory_summary");
    actions.push("compress_low_value_history");
  }
  const placementStrategy = buildMemoryPlacementStrategy({
    modelProfile: profile,
    ctxTokens: state?.ctxTokens ?? 0,
    previousState: state,
    correctionLevel,
    anchorCount: state?.memoryAnchors?.length ?? 0,
  });
  return {
    correctionLevel,
    summary,
    actions,
    reanchorToTail: correctionLevel !== "none",
    raiseInjectionPriority: correctionLevel === "light" || correctionLevel === "medium" || correctionLevel === "strong",
    rewriteWorkingSummary: correctionLevel === "medium" || correctionLevel === "strong",
    compressHistory: correctionLevel === "medium" || correctionLevel === "strong",
    authoritativeReload: correctionLevel === "strong",
    conflictResolution: correctionLevel === "strong",
    placementStrategy,
  };
}

export function buildMemoryHomeostasisPromptSummary(runtimeState = null) {
  const state = runtimeState ? normalizeRuntimeMemoryStateRecord(runtimeState) : null;
  if (!state) {
    return null;
  }
  return {
    modelName: state.modelName,
    ctxTokens: state.ctxTokens,
    checkedMemories: state.checkedMemories,
    conflictMemories: state.conflictMemories,
    vt: state.vT,
    lt: state.lT,
    rPosT: state.rPosT,
    xT: state.xT,
    sT: state.sT,
    cT: state.cT,
    correctionLevel: state.correctionLevel,
    placementStrategy: cloneJson(state.placementStrategy) ?? null,
  };
}

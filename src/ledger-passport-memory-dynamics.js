import {
  addSeconds,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  buildPassportCognitiveBias,
} from "./ledger-passport-memory-retrieval.js";
import {
  inferPassportReconsolidationWindowHours,
  normalizePassportMemoryLayer,
} from "./ledger-passport-memory-rules.js";

export function reinforcePassportMemoryRecord(
  entry,
  {
    useful = true,
    recalledAt = now(),
    currentGoal = null,
    queryText = null,
    cognitiveState = null,
  } = {}
) {
  if (!entry) {
    return entry;
  }
  if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
    entry.memoryDynamics = {};
  }
  destabilizePassportMemoryRecord(entry, { recalledAt });
  const cognitiveBias = buildPassportCognitiveBias(entry, {
    currentGoal,
    queryText,
    cognitiveState,
    referenceTime: recalledAt,
  });
  const reinforcementDelta = useful
    ? 0.06 + (cognitiveBias.modulationBoost * 0.24) + (cognitiveBias.traceClassBoost * 0.18) + (cognitiveBias.replayModeBoost * 0.12)
    : 0.02 + (cognitiveBias.modulationBoost * 0.1);
  entry.memoryDynamics.recallCount = Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.recallCount, 0))) + 1;
  entry.memoryDynamics.recallSuccessCount =
    Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.recallSuccessCount, 0))) + (useful ? 1 : 0);
  entry.memoryDynamics.lastRecalledAt = recalledAt;
  entry.memoryDynamics.strengthScore = Number(
    Math.max(
      0,
      Math.min(1, toFiniteNumber(entry.memoryDynamics.strengthScore, entry.salience ?? 0.5) + reinforcementDelta)
    ).toFixed(2)
  );
  entry.memoryDynamics.lastReinforcementDelta = Number(reinforcementDelta.toFixed(2));
  entry.memoryDynamics.lastReinforcementDrivers = {
    useful,
    goalSupportScore: cognitiveBias.goalSupportScore,
    querySupportScore: cognitiveBias.querySupportScore,
    taskSupportScore: cognitiveBias.taskSupportScore,
    traceClassBoost: cognitiveBias.traceClassBoost,
    modulationBoost: cognitiveBias.modulationBoost,
    replayModeBoost: cognitiveBias.replayModeBoost,
    dominantRhythm: cognitiveBias.dominantRhythm,
    replayMode: cognitiveBias.replayMode,
    targetMatches: cognitiveBias.targetMatches,
  };
  return entry;
}

export function destabilizePassportMemoryRecord(entry, { recalledAt = now(), clusterCue = false } = {}) {
  if (!entry || normalizePassportMemoryLayer(entry.layer) === "ledger") {
    return entry;
  }
  if (!entry.memoryDynamics || typeof entry.memoryDynamics !== "object") {
    entry.memoryDynamics = {};
  }
  const reconsolidationWindowHours = inferPassportReconsolidationWindowHours(entry);
  if (reconsolidationWindowHours <= 0) {
    return entry;
  }
  entry.memoryDynamics.reactivationCount =
    Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.reactivationCount, 0))) + 1;
  entry.memoryDynamics.lastReactivatedAt = recalledAt;
  entry.memoryDynamics.destabilizedAt = recalledAt;
  entry.memoryDynamics.destabilizedUntil = addSeconds(recalledAt, reconsolidationWindowHours * 60 * 60);
  entry.memoryDynamics.reconsolidationWindowHours = reconsolidationWindowHours;
  entry.memoryDynamics.reconsolidationState = "destabilized";
  if (clusterCue) {
    entry.memoryDynamics.lastReactivationCause = "cluster_cue";
    entry.memoryDynamics.clusterCueCount =
      Math.max(0, Math.floor(toFiniteNumber(entry.memoryDynamics.clusterCueCount, 0))) + 1;
  } else {
    entry.memoryDynamics.lastReactivationCause = "direct_retrieval";
  }
  return entry;
}

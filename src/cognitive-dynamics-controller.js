import { buildInteroceptiveState } from "./interoceptive-state.js";
import { buildNeuromodulatorState } from "./neuromodulators.js";
import { buildOscillationSchedule } from "./oscillation-scheduler.js";
import { buildReplayOrchestration } from "./replay-orchestrator.js";

export function buildCognitiveDynamicsState({
  existing = null,
  currentGoal = null,
  mode = null,
  workingCount = 0,
  replayRecencyHours = null,
  conflictCount = 0,
  verificationValid = true,
  bodyLoop = null,
  fatigue = 0,
  sleepDebt = 0,
  uncertainty = 0,
  rewardPredictionError = 0,
  threat = 0,
  novelty = 0,
  socialSalience = 0,
  homeostaticPressure = 0,
} = {}) {
  const interoceptiveState = buildInteroceptiveState({
    existing: existing?.interoceptiveState || null,
    bodyLoop,
    fatigue,
    sleepDebt,
    uncertainty,
    threat,
    homeostaticPressure,
    socialSalience,
    replayRecencyHours,
    verificationValid,
  });
  const neuromodulators = buildNeuromodulatorState({
    existing: existing?.neuromodulators || null,
    novelty,
    rewardPredictionError,
    uncertainty,
    threat,
    socialSalience,
    verificationValid,
    interoceptiveState,
  });
  const oscillationSchedule = buildOscillationSchedule({
    existing: existing?.oscillationSchedule || null,
    mode,
    currentGoal,
    workingCount,
    fatigue,
    sleepDebt,
    homeostaticPressure,
    replayRecencyHours,
    interoceptiveState,
    neuromodulators,
  });
  const replayOrchestration = buildReplayOrchestration({
    currentGoal,
    verificationValid,
    conflictCount,
    replayRecencyHours,
    bodyLoop,
    interoceptiveState,
    neuromodulators,
    oscillationSchedule,
  });

  return {
    interoceptiveState,
    neuromodulators,
    oscillationSchedule,
    replayOrchestration,
    sleepPressure: interoceptiveState.sleepPressure,
    dominantRhythm: oscillationSchedule.dominantRhythm,
    updatedAt: new Date().toISOString(),
  };
}

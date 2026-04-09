function clampUnitInterval(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number(Math.max(0, Math.min(1, fallback)).toFixed(2));
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(2));
}

export function buildReplayOrchestration({
  currentGoal = null,
  verificationValid = true,
  conflictCount = 0,
  replayRecencyHours = null,
  bodyLoop = null,
  interoceptiveState = null,
  neuromodulators = null,
  oscillationSchedule = null,
} = {}) {
  const normalizedBodyLoop = bodyLoop && typeof bodyLoop === "object" ? bodyLoop : {};
  const interoception = interoceptiveState && typeof interoceptiveState === "object" ? interoceptiveState : {};
  const modulators = neuromodulators && typeof neuromodulators === "object" ? neuromodulators : {};
  const schedule = oscillationSchedule && typeof oscillationSchedule === "object" ? oscillationSchedule : {};
  const staleReplayBoost =
    replayRecencyHours == null ? 0.14 : replayRecencyHours > 18 ? 0.24 : replayRecencyHours > 8 ? 0.12 : 0.04;
  const replayDrive = clampUnitInterval(
    (clampUnitInterval(interoception.sleepPressure, 0.2) * 0.24) +
      (clampUnitInterval(interoception.interoceptivePredictionError, 0.18) * 0.18) +
      (clampUnitInterval(modulators.dopamineRpe, 0.18) * 0.16) +
      (clampUnitInterval(modulators.norepinephrineSurprise, 0.16) * 0.12) +
      (Math.max(0, Number(conflictCount) || 0) * 0.08) +
      (verificationValid === false ? 0.12 : 0.03) +
      (clampUnitInterval(normalizedBodyLoop.staleReplayPressure, 0.16) * 0.1) +
      staleReplayBoost,
    0.22
  );
  const shouldReplay =
    Boolean(schedule.replayEligible) ||
    replayDrive >= 0.42 ||
    (!currentGoal && clampUnitInterval(interoception.sleepPressure, 0.2) >= 0.34);
  const replayMode =
    schedule.currentPhase === "offline_homeostatic"
      ? "homeostatic_down_selection"
      : schedule.currentPhase === "offline_ripple_like"
        ? "hippocampal_trace_replay"
        : shouldReplay
          ? "interleaved_theta_ripple"
          : "goal_maintenance_only";
  const targetTraceClasses = [];
  if (Math.max(0, Number(conflictCount) || 0) > 0) {
    targetTraceClasses.push("conflicting_traces");
  }
  if (clampUnitInterval(modulators.dopamineRpe, 0.18) >= 0.26) {
    targetTraceClasses.push("high_prediction_error_traces");
  }
  if (clampUnitInterval(interoception.sleepPressure, 0.2) >= 0.34) {
    targetTraceClasses.push("weak_or_stale_traces");
  }
  if (clampUnitInterval(modulators.dopaminergicAllocationBias, 0.24) >= 0.26) {
    targetTraceClasses.push("salient_allocated_traces");
  }
  if (targetTraceClasses.length === 0) {
    targetTraceClasses.push("goal_supporting_traces");
  }
  const consolidationBias =
    replayMode === "homeostatic_down_selection"
      ? "synaptic_renormalization_bias"
      : replayMode === "hippocampal_trace_replay"
        ? "episodic_to_schema_bias"
        : "working_memory_stabilization_bias";

  return {
    shouldReplay,
    replayMode,
    replayDrive,
    consolidationBias,
    targetTraceClasses,
    replayWindowHours:
      replayRecencyHours == null ? 12 : replayRecencyHours > 24 ? 24 : replayRecencyHours > 8 ? 12 : 6,
    gatingReason: shouldReplay ? "replay_drive_threshold" : "online_goal_maintenance",
    updatedAt: new Date().toISOString(),
  };
}

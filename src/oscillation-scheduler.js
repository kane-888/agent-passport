function clampUnitInterval(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number(Math.max(0, Math.min(1, fallback)).toFixed(2));
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(2));
}

function normalizeWeights(weights = {}) {
  const entries = Object.entries(weights).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) {
    return Object.fromEntries(entries.map(([key]) => [key, 0]));
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, Number((value / total).toFixed(2))]));
}

export function buildOscillationSchedule({
  existing = null,
  mode = null,
  currentGoal = null,
  workingCount = 0,
  fatigue = 0,
  sleepDebt = 0,
  homeostaticPressure = 0,
  replayRecencyHours = null,
  interoceptiveState = null,
  neuromodulators = null,
} = {}) {
  const interoception = interoceptiveState && typeof interoceptiveState === "object" ? interoceptiveState : {};
  const modulators = neuromodulators && typeof neuromodulators === "object" ? neuromodulators : {};
  const thetaWeight = clampUnitInterval(
    (currentGoal ? 0.34 : 0.12) +
      (Math.min(Math.max(Number(workingCount) || 0, 0), 6) * 0.06) +
      (clampUnitInterval(interoception.bodyBudget, 0.6) * 0.22) +
      (clampUnitInterval(modulators.acetylcholineEncodeBias, 0.24) * 0.18) -
      (clampUnitInterval(interoception.sleepPressure, 0.2) * 0.16),
    0.34
  );
  const rippleWeight = clampUnitInterval(
    (clampUnitInterval(interoception.sleepPressure, 0.2) * 0.24) +
      (clampUnitInterval(modulators.dopamineRpe, 0.18) * 0.14) +
      (clampUnitInterval(modulators.norepinephrineSurprise, 0.16) * 0.1) +
      (replayRecencyHours == null ? 0.12 : replayRecencyHours > 12 ? 0.22 : replayRecencyHours > 4 ? 0.14 : 0.06) +
      (currentGoal ? 0.04 : 0.1),
    0.2
  );
  const homeostaticWeight = clampUnitInterval(
    (clampUnitInterval(homeostaticPressure, 0.18) * 0.28) +
      (clampUnitInterval(interoception.allostaticLoad, 0.22) * 0.24) +
      (clampUnitInterval(interoception.metabolicStress, 0.18) * 0.18) +
      (clampUnitInterval(fatigue, 0.18) * 0.16) +
      (clampUnitInterval(sleepDebt, 0.14) * 0.14),
    0.18
  );
  const phaseWeights = normalizeWeights({
    online_theta_like: thetaWeight,
    offline_ripple_like: rippleWeight,
    offline_homeostatic: homeostaticWeight,
  });
  const dominantEntry = Object.entries(phaseWeights).sort((left, right) => right[1] - left[1])[0] || ["online_theta_like", 1];
  const currentPhase = dominantEntry[0];
  const dominantRhythm =
    currentPhase === "offline_ripple_like"
      ? "sharp_wave_ripple_like"
      : currentPhase === "offline_homeostatic"
        ? "slow_homeostatic_scaling_like"
        : "theta_like";
  const nextPhase =
    currentPhase === "online_theta_like"
      ? phaseWeights.offline_ripple_like >= 0.3
        ? "offline_ripple_like"
        : "online_theta_like"
      : currentPhase === "offline_ripple_like"
        ? "offline_homeostatic"
        : "online_theta_like";
  const transitionReason =
    ["recovering", "self_calibrating"].includes(String(mode || "").trim())
      ? "runtime_recovery_bias"
      : currentPhase === "offline_homeostatic"
        ? "homeostatic_pressure_bias"
        : currentPhase === "offline_ripple_like"
          ? "replay_window_bias"
          : "goal_maintenance_bias";

  return {
    currentPhase,
    dominantRhythm,
    nextPhase,
    transitionReason,
    phaseWeights,
    replayEligible: phaseWeights.offline_ripple_like >= 0.28 || phaseWeights.offline_homeostatic >= 0.32,
    updatedAt: new Date().toISOString(),
  };
}

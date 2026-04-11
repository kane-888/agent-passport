function clampUnitInterval(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number(Math.max(0, Math.min(1, fallback)).toFixed(2));
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(2));
}

export function buildNeuromodulatorState({
  existing = null,
  novelty = 0,
  rewardPredictionError = 0,
  uncertainty = 0,
  threat = 0,
  socialSalience = 0,
  verificationValid = true,
  interoceptiveState = null,
} = {}) {
  const interoception = interoceptiveState && typeof interoceptiveState === "object" ? interoceptiveState : {};
  const dopamineRpe = clampUnitInterval(
    (Number(existing?.dopamineRpe || 0.18) * 0.22) +
      (clampUnitInterval(rewardPredictionError, 0.16) * 0.42) +
      (clampUnitInterval(novelty, 0.24) * 0.22) +
      (clampUnitInterval(interoception.interoceptivePredictionError, 0.18) * 0.14),
    0.18
  );
  const acetylcholineEncodeBias = clampUnitInterval(
    (Number(existing?.acetylcholineEncodeBias || 0.24) * 0.2) +
      (clampUnitInterval(novelty, 0.24) * 0.32) +
      (clampUnitInterval(uncertainty, 0.22) * 0.26) +
      (verificationValid === false ? 0.12 : 0.04) +
      (clampUnitInterval(interoception.bodyBudget, 0.6) * 0.1),
    0.24
  );
  const norepinephrineSurprise = clampUnitInterval(
    (Number(existing?.norepinephrineSurprise || 0.16) * 0.2) +
      (clampUnitInterval(novelty, 0.24) * 0.18) +
      (clampUnitInterval(threat, 0.12) * 0.26) +
      (clampUnitInterval(uncertainty, 0.22) * 0.18) +
      (clampUnitInterval(interoception.interoceptivePredictionError, 0.18) * 0.18),
    0.16
  );
  const serotoninStability = clampUnitInterval(
    1 -
      (
        (clampUnitInterval(threat, 0.12) * 0.28) +
        (clampUnitInterval(uncertainty, 0.22) * 0.18) +
        (clampUnitInterval(interoception.allostaticLoad, 0.22) * 0.24) +
        (clampUnitInterval(interoception.metabolicStress, 0.18) * 0.18) +
        (clampUnitInterval(socialSalience, 0.24) * 0.12)
      ),
    0.56
  );
  const dopaminergicAllocationBias = clampUnitInterval(
    (dopamineRpe * 0.42) +
      (acetylcholineEncodeBias * 0.16) +
      (clampUnitInterval(socialSalience, 0.24) * 0.18) +
      (clampUnitInterval(novelty, 0.24) * 0.14) +
      (clampUnitInterval(interoception.bodyBudget, 0.6) * 0.1),
    0.24
  );

  return {
    dopamineRpe,
    acetylcholineEncodeBias,
    norepinephrineSurprise,
    serotoninStability,
    dopaminergicAllocationBias,
    updatedAt: new Date().toISOString(),
  };
}

function clampUnitInterval(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number(Math.max(0, Math.min(1, fallback)).toFixed(2));
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(2));
}

export function buildInteroceptiveState({
  existing = null,
  bodyLoop = null,
  fatigue = 0,
  sleepDebt = 0,
  uncertainty = 0,
  threat = 0,
  homeostaticPressure = 0,
  socialSalience = 0,
  replayRecencyHours = null,
  verificationValid = true,
} = {}) {
  const normalizedBodyLoop = bodyLoop && typeof bodyLoop === "object" ? bodyLoop : {};
  const sleepPressure = clampUnitInterval(
    (Number(existing?.sleepPressure || 0.2) * 0.24) +
      (clampUnitInterval(fatigue, 0.18) * 0.34) +
      (clampUnitInterval(sleepDebt, 0.14) * 0.38) +
      (clampUnitInterval(homeostaticPressure, 0.18) * 0.18),
    0.2
  );
  const allostaticLoad = clampUnitInterval(
    (Number(existing?.allostaticLoad || 0.22) * 0.28) +
      (clampUnitInterval(normalizedBodyLoop.overallLoad, 0.2) * 0.32) +
      (clampUnitInterval(uncertainty, 0.22) * 0.14) +
      (clampUnitInterval(threat, 0.12) * 0.14) +
      (clampUnitInterval(normalizedBodyLoop.verificationPressure, 0.12) * 0.08) +
      (clampUnitInterval(socialSalience, 0.24) * 0.04),
    0.22
  );
  const metabolicStress = clampUnitInterval(
    (Number(existing?.metabolicStress || 0.18) * 0.32) +
      (clampUnitInterval(fatigue, 0.18) * 0.24) +
      (sleepPressure * 0.24) +
      (clampUnitInterval(normalizedBodyLoop.responseLatencyPressure, 0.12) * 0.1) +
      (clampUnitInterval(normalizedBodyLoop.taskBacklog, 0.12) * 0.06) +
      (
        replayRecencyHours == null
          ? 0.08
          : replayRecencyHours > 18
            ? 0.16
            : replayRecencyHours > 8
              ? 0.1
              : 0.02
      ),
    0.18
  );
  const interoceptivePredictionError = clampUnitInterval(
    (Number(existing?.interoceptivePredictionError || 0.18) * 0.24) +
      (verificationValid === false ? 0.18 : 0.04) +
      (clampUnitInterval(normalizedBodyLoop.conflictDensity, 0.1) * 0.16) +
      (clampUnitInterval(normalizedBodyLoop.humanVetoRate, 0.08) * 0.12) +
      (Math.abs(allostaticLoad - Number(existing?.allostaticLoad || 0.22)) * 0.2) +
      (Math.abs(sleepPressure - Number(existing?.sleepPressure || 0.2)) * 0.12),
    0.18
  );
  const bodyBudget = clampUnitInterval(
    1 -
      (
        (sleepPressure * 0.34) +
        (allostaticLoad * 0.32) +
        (metabolicStress * 0.24) +
        (interoceptivePredictionError * 0.1)
      ),
    0.62
  );

  return {
    sleepPressure,
    allostaticLoad,
    metabolicStress,
    interoceptivePredictionError,
    bodyBudget,
    updatedAt: new Date().toISOString(),
  };
}

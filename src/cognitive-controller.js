function clampUnitInterval(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number(Math.max(0, Math.min(1, fallback)).toFixed(2));
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(2));
}

export function buildBodyLoopProxies({
  pendingInboxCount = 0,
  pendingVerificationCount = 0,
  conflictingMemoryCount = 0,
  recentRunCount = 0,
  failedVerificationCount = 0,
  negativeFeedbackCount = 0,
  recentFeedbackCount = 0,
  staleReplayHours = null,
  latestRunLatencyMs = null,
} = {}) {
  const safeRunCount = Math.max(1, Math.floor(Number(recentRunCount) || 0));
  const safeFeedbackCount = Math.max(1, Math.floor(Number(recentFeedbackCount) || 0));
  const taskBacklog = clampUnitInterval(
    (Math.max(0, Number(pendingInboxCount) || 0) * 0.12) +
      (Math.max(0, Number(pendingVerificationCount) || 0) * 0.18)
  );
  const conflictDensity = clampUnitInterval((Math.max(0, Number(conflictingMemoryCount) || 0) * 1.2) / (safeRunCount + 4));
  const humanVetoRate = clampUnitInterval((Math.max(0, Number(negativeFeedbackCount) || 0) * 1.0) / safeFeedbackCount, 0);
  const verificationPressure = clampUnitInterval((Math.max(0, Number(failedVerificationCount) || 0) * 1.0) / safeRunCount, 0);
  const responseLatencyPressure = clampUnitInterval(
    Number.isFinite(Number(latestRunLatencyMs)) ? Number(latestRunLatencyMs) / 12000 : 0.12,
    0.12
  );
  const staleReplayPressure = clampUnitInterval(
    staleReplayHours == null ? 0.16 : Number(staleReplayHours) > 24 ? 0.84 : Number(staleReplayHours) / 30,
    0.16
  );
  const overallLoad = clampUnitInterval(
    (taskBacklog * 0.28) +
      (conflictDensity * 0.2) +
      (humanVetoRate * 0.12) +
      (verificationPressure * 0.18) +
      (responseLatencyPressure * 0.08) +
      (staleReplayPressure * 0.14),
    0.2
  );

  return {
    taskBacklog,
    conflictDensity,
    humanVetoRate,
    verificationPressure,
    responseLatencyPressure,
    staleReplayPressure,
    overallLoad,
  };
}

export function buildContinuousControllerState({
  existing = null,
  mode = null,
  queryIteration = 1,
  workingCount = 0,
  truncatedCount = 0,
  verificationValid = true,
  driftScore = 0,
  residentLocked = false,
  bootstrapRequired = false,
  replayRecencyHours = null,
  conflictCount = 0,
  noveltySeed = 0.24,
  socialSignalCount = 0,
  bodyLoop = null,
} = {}) {
  const normalizedBodyLoop = bodyLoop && typeof bodyLoop === "object" ? bodyLoop : buildBodyLoopProxies();
  const fatigue = clampUnitInterval(
    (Number(existing?.fatigue || 0.18) * 0.58) +
      (Math.max(0, Number(queryIteration) - 1) * 0.04) +
      (Math.max(0, Number(workingCount) - 3) * 0.03) +
      (Math.max(0, Number(truncatedCount) || 0) * 0.05) +
      (verificationValid === false ? 0.16 : 0) +
      (Math.max(0, Number(driftScore) || 0) * 0.05) +
      (residentLocked ? 0.06 : 0) +
      (bootstrapRequired ? 0.04 : 0) +
      (normalizedBodyLoop.overallLoad * 0.16) -
      (replayRecencyHours == null ? 0 : replayRecencyHours <= 3 ? 0.18 : replayRecencyHours <= 12 ? 0.08 : 0) -
      (["recovering", "self_calibrating"].includes(mode) ? 0.04 : 0),
    0.18
  );
  const sleepDebt = clampUnitInterval(
    (Number(existing?.sleepDebt || 0.14) * 0.74) +
      (fatigue * 0.24) +
      (Math.max(0, Number(truncatedCount) || 0) * 0.03) +
      (normalizedBodyLoop.staleReplayPressure * 0.18) +
      (replayRecencyHours == null ? 0.1 : replayRecencyHours > 18 ? 0.18 : replayRecencyHours > 6 ? 0.08 : -0.06),
    0.14
  );
  const uncertainty = clampUnitInterval(
    (Number(existing?.uncertainty || 0.22) * 0.46) +
      (verificationValid === false ? 0.26 : 0.04) +
      (Math.max(0, Number(driftScore) || 0) * 0.08) +
      (normalizedBodyLoop.verificationPressure * 0.22) +
      (normalizedBodyLoop.conflictDensity * 0.18),
    0.22
  );
  const rewardPredictionError = clampUnitInterval(
    (Number(existing?.rewardPredictionError || 0.16) * 0.42) +
      (Math.max(0, Number(conflictCount) || 0) * 0.08) +
      (verificationValid === false ? 0.14 : 0.04) +
      (normalizedBodyLoop.conflictDensity * 0.24) +
      (normalizedBodyLoop.humanVetoRate * 0.12),
    0.16
  );
  const threat = clampUnitInterval(
    (Number(existing?.threat || 0.12) * 0.46) +
      (residentLocked ? 0.12 : 0) +
      (bootstrapRequired ? 0.08 : 0) +
      (normalizedBodyLoop.humanVetoRate * 0.26) +
      (normalizedBodyLoop.verificationPressure * 0.2) +
      (normalizedBodyLoop.conflictDensity * 0.16),
    0.12
  );
  const novelty = clampUnitInterval(
    (Number(existing?.novelty || noveltySeed) * 0.34) +
      noveltySeed +
      (Math.max(0, Number(queryIteration) - 1) * 0.03) +
      (normalizedBodyLoop.taskBacklog * 0.08),
    noveltySeed
  );
  const socialSalience = clampUnitInterval(
    (Number(existing?.socialSalience || 0.34) * 0.4) +
      (Math.max(0, Number(socialSignalCount) || 0) * 0.08) +
      (normalizedBodyLoop.humanVetoRate * 0.22) +
      (normalizedBodyLoop.taskBacklog * 0.12) +
      0.14,
    0.34
  );
  const homeostaticPressure = clampUnitInterval(
    (fatigue * 0.36) +
      (sleepDebt * 0.28) +
      (uncertainty * 0.08) +
      (threat * 0.08) +
      (normalizedBodyLoop.overallLoad * 0.2),
    0.18
  );

  return {
    fatigue,
    sleepDebt,
    uncertainty,
    rewardPredictionError,
    threat,
    novelty,
    socialSalience,
    homeostaticPressure,
    bodyLoop: normalizedBodyLoop,
  };
}

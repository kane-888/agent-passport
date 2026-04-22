export function summarizeHousekeepingExpectation(housekeeping = null) {
  const apply = housekeeping?.mode === "apply";
  return {
    housekeepingApplyExpected: apply,
    housekeepingMeaning: apply
      ? "smoke intentionally applies housekeeping and prunes old recovery/setup artifacts while revoking live read sessions"
      : "smoke intentionally audits housekeeping impact and only reports would-delete / would-revoke counts",
    housekeepingGateState: {
      runMode: housekeeping?.mode ?? null,
      liveLedgerTouched: housekeeping?.liveLedger?.touched ?? null,
      previewOnly: !apply,
      recoveryDeleteCount: apply
        ? Number(housekeeping?.recoveryBundles?.deletedCount || 0)
        : Array.isArray(housekeeping?.recoveryBundles?.candidates)
          ? housekeeping.recoveryBundles.candidates.length
          : 0,
      setupDeleteCount: Number(housekeeping?.setupPackages?.counts?.deleted || 0),
      readSessionRevokeCount: Number(housekeeping?.readSessions?.revokedCount || 0),
    },
  };
}

export function summarizeSetupPackageExpectation({
  previewPackageId = null,
  persistedPackageId = null,
  observedPersistedPackageCount = null,
  embeddedProfileCount = null,
  prunedDeletedCount = 0,
} = {}) {
  const persisted = Boolean(persistedPackageId);
  return {
    setupPackagePersistenceExpected: persisted,
    setupPackageMeaning: persisted
      ? "smoke explicitly saves setup packages, validates embedded local reasoner profiles, and prunes stale packages"
      : "smoke previews setup package shape and does not persist package files",
    setupPackageGateState: {
      runMode: persisted ? "persist_and_prune" : "dry_run_preview",
      previewPackageId,
      persistedPackageId: persisted ? persistedPackageId : null,
      observedPersistedPackageCount:
        observedPersistedPackageCount != null ? Number(observedPersistedPackageCount) : null,
      embeddedProfileCount: embeddedProfileCount != null ? Number(embeddedProfileCount) : null,
      prunedDeletedCount: Number(prunedDeletedCount || 0),
    },
  };
}

export function summarizeLocalReasonerRestoreExpectation({
  candidateCount = 0,
  restoredProfileId = null,
  warmStatus = null,
} = {}) {
  const restored = Boolean(restoredProfileId);
  return {
    localReasonerRestoreExpected: restored,
    localReasonerRestoreMeaning: restored
      ? "smoke restores a saved local reasoner profile and prewarms it back to ready"
      : "this smoke path does not execute local reasoner restore",
    localReasonerRestoreGateState: {
      runMode: restored ? "restore_and_prewarm" : "not_executed",
      candidateCount: Number(candidateCount || 0),
      restoredProfileId: restored ? restoredProfileId : null,
      warmStatus: warmStatus ?? null,
    },
  };
}

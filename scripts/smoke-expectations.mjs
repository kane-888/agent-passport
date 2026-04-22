export function summarizeDeviceSetupExpectation(setupStatus, setupRun, setupPackageSummary = null) {
  const runDryRun = setupRun?.bootstrap?.bootstrap?.dryRun === true;
  return {
    deviceSetupCompletionExpected: runDryRun ? false : true,
    deviceSetupCompletionMeaning: runDryRun
      ? "smoke intentionally validates device setup via dry-run/preview and does not finalize setup"
      : "device setup run is expected to finalize setup state",
    deviceSetupGateState: {
      runMode: runDryRun ? "dry_run_preview" : "finalize",
      statusComplete: setupStatus?.setupComplete ?? null,
      runComplete: setupRun?.status?.setupComplete ?? null,
      previewPackageId: setupPackageSummary?.packageId ?? null,
    },
  };
}

export function summarizeBootstrapExpectation(bootstrapEnvelope = null) {
  const dryRun = bootstrapEnvelope?.bootstrap?.dryRun === true;
  return {
    bootstrapApplyExpected: dryRun ? false : true,
    bootstrapMeaning: dryRun
      ? "smoke intentionally previews bootstrap and does not persist minimal runtime state"
      : "bootstrap run is expected to persist minimal runtime state",
    bootstrapGateState: {
      runMode: dryRun ? "dry_run_preview" : "finalize",
      dryRun,
      profileWrites: Number(bootstrapEnvelope?.bootstrap?.summary?.profileWriteCount || 0),
      sessionStateId: bootstrapEnvelope?.sessionState?.sessionStateId ?? null,
    },
  };
}

export function summarizeRecoveryBundleExpectation({
  previewBundleId = null,
  persistedBundleId = null,
  persistedBundleCount = null,
} = {}) {
  const persisted = Boolean(persistedBundleId);
  return {
    recoveryBundlePersistenceExpected: persisted,
    recoveryBundleMeaning: persisted
      ? "smoke explicitly saves one recovery bundle to verify durable export persistence"
      : "smoke previews recovery bundle export/import and does not persist bundle files",
    recoveryBundleGateState: {
      runMode: persisted ? "persist_bundle" : "dry_run_preview",
      previewBundleId,
      persistedBundleId: persisted ? persistedBundleId : null,
      observedPersistedBundleCount: persistedBundleCount != null ? Number(persistedBundleCount) : null,
    },
  };
}

export function summarizeRecoveryRehearsalExpectation({
  rehearsal = null,
  rehearsalCount = null,
  persist = false,
} = {}) {
  return {
    recoveryRehearsalPersistenceExpected: persist === true,
    recoveryRehearsalMeaning: persist === true
      ? "smoke persists recovery rehearsal history for later setup/readiness checks"
      : "smoke runs an inline recovery rehearsal and does not persist rehearsal history",
    recoveryRehearsalGateState: {
      runMode: persist === true ? "persist_history" : "inline_preview",
      rehearsalStatus: rehearsal?.status ?? null,
      observedPersistedRehearsalCount: rehearsalCount != null ? Number(rehearsalCount) : null,
    },
  };
}

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

export function summarizeLocalReasonerLifecycleExpectation({
  configuredStatus = null,
  catalogProviderCount = 0,
  probeStatus = null,
  selectedProvider = null,
  prewarmStatus = null,
  profileCount = null,
  restoreCandidateCount = null,
} = {}) {
  return {
    localReasonerLifecycleExpected: true,
    localReasonerLifecycleMeaning:
      "smoke exercises local reasoner catalog/probe/prewarm plus saved profile lifecycle so readiness is explicit instead of inferred from raw counters",
    localReasonerLifecycleGateState: {
      runMode: "configure_probe_profile",
      configuredStatus: configuredStatus ?? null,
      catalogProviderCount: Number(catalogProviderCount || 0),
      probeStatus: probeStatus ?? null,
      selectedProvider: selectedProvider ?? null,
      prewarmStatus: prewarmStatus ?? null,
      observedProfileCount: profileCount != null ? Number(profileCount) : null,
      observedRestoreCandidateCount: restoreCandidateCount != null ? Number(restoreCandidateCount) : null,
    },
  };
}

export function summarizeConversationMemoryExpectation({
  minuteId = null,
  minuteCount = null,
  transcriptEntryCount = null,
  transcriptBlockCount = null,
  runtimeSearchHits = null,
} = {}) {
  return {
    conversationMemoryExpected: true,
    conversationMemoryMeaning:
      "smoke expects conversation-minute and transcript evidence to remain queryable for runtime retrieval instead of being interpreted from bare counts",
    conversationMemoryGateState: {
      runMode: minuteId ? "persist_and_retrieve" : "retrieve_existing_memory",
      minuteId: minuteId ?? null,
      observedMinuteCount: minuteCount != null ? Number(minuteCount) : null,
      transcriptEntryCount: transcriptEntryCount != null ? Number(transcriptEntryCount) : null,
      transcriptBlockCount: transcriptBlockCount != null ? Number(transcriptBlockCount) : null,
      runtimeSearchHits: runtimeSearchHits != null ? Number(runtimeSearchHits) : null,
    },
  };
}

export function summarizeSandboxAuditExpectation({
  auditCount = null,
  sandboxSearchHits = null,
  sandboxListEntries = null,
} = {}) {
  return {
    sandboxAuditEvidenceExpected: true,
    sandboxAuditMeaning:
      "smoke expects audited sandbox probes to leave explicit runtime_search/filesystem_list evidence rather than relying on side effects alone",
    sandboxAuditGateState: {
      runMode: "audit_trail_expected",
      observedAuditCount: auditCount != null ? Number(auditCount) : null,
      sandboxSearchHits: sandboxSearchHits != null ? Number(sandboxSearchHits) : null,
      sandboxListEntries: sandboxListEntries != null ? Number(sandboxListEntries) : null,
    },
  };
}

export function summarizeExecutionHistoryExpectation({
  verificationStatus = null,
  verificationHistoryCount = null,
  runnerStatus = null,
  runnerHistoryCount = null,
} = {}) {
  const executed = Boolean(verificationStatus || runnerStatus);
  return {
    executionHistoryExpected: executed,
    executionHistoryMeaning: executed
      ? "smoke executes verification and runner flows and expects both histories to retain explicit evidence"
      : "this smoke path does not execute verification or runner persistence flows",
    executionHistoryGateState: {
      runMode: executed ? "persist_history" : "not_executed",
      verificationStatus: verificationStatus ?? null,
      observedVerificationHistoryCount: verificationHistoryCount != null ? Number(verificationHistoryCount) : null,
      runnerStatus: runnerStatus ?? null,
      observedRunnerHistoryCount: runnerHistoryCount != null ? Number(runnerHistoryCount) : null,
    },
  };
}

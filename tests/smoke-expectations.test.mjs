import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeBootstrapExpectation,
  summarizeConversationMemoryExpectation,
  summarizeDeviceSetupExpectation,
  summarizeExecutionHistoryExpectation,
  summarizeHousekeepingExpectation,
  summarizeLocalReasonerLifecycleExpectation,
  summarizeLocalReasonerRestoreExpectation,
  summarizeRecoveryBundleExpectation,
  summarizeRecoveryRehearsalExpectation,
  summarizeSandboxAuditExpectation,
  summarizeSetupPackageExpectation,
} from "../scripts/smoke-expectations.mjs";

test("smoke expectation builders keep setup and recovery preview/finalize shapes stable", () => {
  assert.equal(
    summarizeDeviceSetupExpectation(
      { setupComplete: false },
      { bootstrap: { bootstrap: { dryRun: true } }, status: { setupComplete: false } },
      { packageId: "setup_preview" }
    ).deviceSetupGateState.runMode,
    "dry_run_preview"
  );
  assert.equal(
    summarizeDeviceSetupExpectation({ setupComplete: true }, { status: { setupComplete: true } })
      .deviceSetupGateState.runMode,
    "finalize"
  );
  assert.equal(summarizeBootstrapExpectation({ bootstrap: { dryRun: true } }).bootstrapGateState.runMode, "dry_run_preview");
  assert.equal(summarizeBootstrapExpectation({ bootstrap: { dryRun: false } }).bootstrapGateState.runMode, "finalize");
  assert.equal(summarizeRecoveryBundleExpectation({ previewBundleId: "recovery_preview" }).recoveryBundleGateState.runMode, "dry_run_preview");
  assert.equal(
    summarizeRecoveryBundleExpectation({ persistedBundleId: "recovery_saved" }).recoveryBundleGateState.runMode,
    "persist_bundle"
  );
  assert.equal(summarizeRecoveryRehearsalExpectation({ persist: false }).recoveryRehearsalGateState.runMode, "inline_preview");
  assert.equal(summarizeRecoveryRehearsalExpectation({ persist: true }).recoveryRehearsalGateState.runMode, "persist_history");
});

test("smoke expectation builders keep dry-run and persist setup package shapes stable", () => {
  assert.deepEqual(
    summarizeSetupPackageExpectation({
      previewPackageId: "setup_preview",
      observedPersistedPackageCount: 0,
    }),
    {
      setupPackagePersistenceExpected: false,
      setupPackageMeaning: "smoke previews setup package shape and does not persist package files",
      setupPackageGateState: {
        runMode: "dry_run_preview",
        previewPackageId: "setup_preview",
        persistedPackageId: null,
        observedPersistedPackageCount: 0,
        embeddedProfileCount: null,
        prunedDeletedCount: 0,
      },
    }
  );

  assert.deepEqual(
    summarizeSetupPackageExpectation({
      previewPackageId: "setup_preview",
      persistedPackageId: "setup_saved",
      observedPersistedPackageCount: 1,
      embeddedProfileCount: 2,
      prunedDeletedCount: 3,
    }),
    {
      setupPackagePersistenceExpected: true,
      setupPackageMeaning:
        "smoke explicitly saves setup packages, validates embedded local reasoner profiles, and prunes stale packages",
      setupPackageGateState: {
        runMode: "persist_and_prune",
        previewPackageId: "setup_preview",
        persistedPackageId: "setup_saved",
        observedPersistedPackageCount: 1,
        embeddedProfileCount: 2,
        prunedDeletedCount: 3,
      },
    }
  );
});

test("smoke expectation builders keep local reasoner restore shape stable", () => {
  assert.deepEqual(summarizeLocalReasonerRestoreExpectation(), {
    localReasonerRestoreExpected: false,
    localReasonerRestoreMeaning: "this smoke path does not execute local reasoner restore",
    localReasonerRestoreGateState: {
      runMode: "not_executed",
      candidateCount: 0,
      restoredProfileId: null,
      warmStatus: null,
    },
  });

  assert.deepEqual(
    summarizeLocalReasonerRestoreExpectation({
      candidateCount: 2,
      restoredProfileId: "profile_restored",
      warmStatus: "ready",
    }),
    {
      localReasonerRestoreExpected: true,
      localReasonerRestoreMeaning: "smoke restores a saved local reasoner profile and prewarms it back to ready",
      localReasonerRestoreGateState: {
        runMode: "restore_and_prewarm",
        candidateCount: 2,
        restoredProfileId: "profile_restored",
        warmStatus: "ready",
      },
    }
  );
});

test("smoke expectation builders keep housekeeping audit and apply shapes stable", () => {
  assert.deepEqual(
    summarizeHousekeepingExpectation({
      mode: "audit",
      liveLedger: { touched: false },
      recoveryBundles: { candidates: [{ id: "recovery_a" }, { id: "recovery_b" }] },
      setupPackages: { counts: { deleted: 0 } },
      readSessions: { revokedCount: 0 },
    }),
    {
      housekeepingApplyExpected: false,
      housekeepingMeaning:
        "smoke intentionally audits housekeeping impact and only reports would-delete / would-revoke counts",
      housekeepingGateState: {
        runMode: "audit",
        liveLedgerTouched: false,
        previewOnly: true,
        recoveryDeleteCount: 2,
        setupDeleteCount: 0,
        readSessionRevokeCount: 0,
      },
    }
  );

  assert.deepEqual(
    summarizeHousekeepingExpectation({
      mode: "apply",
      liveLedger: { touched: false },
      recoveryBundles: { deletedCount: 1 },
      setupPackages: { counts: { deleted: 2 } },
      readSessions: { revokedCount: 3 },
    }),
    {
      housekeepingApplyExpected: true,
      housekeepingMeaning:
        "smoke intentionally applies housekeeping and prunes old recovery/setup artifacts while revoking live read sessions",
      housekeepingGateState: {
        runMode: "apply",
        liveLedgerTouched: false,
        previewOnly: false,
        recoveryDeleteCount: 1,
        setupDeleteCount: 2,
        readSessionRevokeCount: 3,
      },
    }
  );
});

test("smoke expectation builders keep runtime evidence shapes stable", () => {
  assert.deepEqual(
    summarizeLocalReasonerLifecycleExpectation({
      configuredStatus: "ready",
      catalogProviderCount: 3,
      probeStatus: "ready",
      selectedProvider: "local_command",
      prewarmStatus: "ready",
      profileCount: 1,
      restoreCandidateCount: 2,
    }).localReasonerLifecycleGateState,
    {
      runMode: "configure_probe_profile",
      configuredStatus: "ready",
      catalogProviderCount: 3,
      probeStatus: "ready",
      selectedProvider: "local_command",
      prewarmStatus: "ready",
      observedProfileCount: 1,
      observedRestoreCandidateCount: 2,
    }
  );

  assert.deepEqual(
    summarizeConversationMemoryExpectation({
      minuteId: "minute_1",
      minuteCount: 4,
      transcriptEntryCount: 5,
      transcriptBlockCount: 2,
      runtimeSearchHits: 6,
    }).conversationMemoryGateState,
    {
      runMode: "persist_and_retrieve",
      minuteId: "minute_1",
      observedMinuteCount: 4,
      transcriptEntryCount: 5,
      transcriptBlockCount: 2,
      runtimeSearchHits: 6,
    }
  );

  assert.deepEqual(
    summarizeSandboxAuditExpectation({
      auditCount: 7,
      sandboxSearchHits: 8,
      sandboxListEntries: 9,
    }).sandboxAuditGateState,
    {
      runMode: "audit_trail_expected",
      observedAuditCount: 7,
      sandboxSearchHits: 8,
      sandboxListEntries: 9,
    }
  );

  assert.deepEqual(
    summarizeExecutionHistoryExpectation({
      verificationStatus: "passed",
      verificationHistoryCount: 10,
      runnerStatus: "blocked",
      runnerHistoryCount: 11,
    }).executionHistoryGateState,
    {
      runMode: "persist_history",
      verificationStatus: "passed",
      observedVerificationHistoryCount: 10,
      runnerStatus: "blocked",
      observedRunnerHistoryCount: 11,
    }
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeHousekeepingExpectation,
  summarizeLocalReasonerRestoreExpectation,
  summarizeSetupPackageExpectation,
} from "../scripts/smoke-expectations.mjs";

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

import assert from "node:assert/strict";
import test from "node:test";

import {
  formatOperationalFlowSemanticsSummary,
  summarizeOperationalFlowSemantics,
} from "../scripts/smoke-all.mjs";

test("operational-flow semantics accepts persisted setup package, restore, and housekeeping apply states", () => {
  const gate = summarizeOperationalFlowSemantics([
    {
      name: "smoke:ui:operational",
      result: {
        savedSetupPackageId: "setup_saved_ui",
        setupPackagePersistenceExpected: true,
        setupPackageMeaning: "smoke explicitly saves setup packages, validates embedded local reasoner profiles, and prunes stale packages",
        setupPackageGateState: {
          runMode: "persist_and_prune",
          persistedPackageId: "setup_saved_ui",
          embeddedProfileCount: 1,
          prunedDeletedCount: 1,
        },
        localReasonerRestoreProfileId: "profile_ui",
        localReasonerRestoreExpected: true,
        localReasonerRestoreMeaning: "smoke restores a saved local reasoner profile and prewarms it back to ready",
        localReasonerRestoreGateState: {
          runMode: "restore_and_prewarm",
          restoredProfileId: "profile_ui",
          warmStatus: "ready",
        },
      },
    },
    {
      name: "smoke:dom:operational",
      result: {
        smokeDomStage: "operational",
        savedSetupPackageId: "setup_saved_dom",
        setupPackagePersistenceExpected: true,
        setupPackageMeaning: "smoke explicitly saves setup packages, validates embedded local reasoner profiles, and prunes stale packages",
        setupPackageGateState: {
          runMode: "persist_and_prune",
          persistedPackageId: "setup_saved_dom",
          embeddedProfileCount: 2,
          prunedDeletedCount: 1,
        },
        localReasonerRestoreProfileId: "profile_dom",
        localReasonerRestoreExpected: true,
        localReasonerRestoreMeaning: "smoke restores a saved local reasoner profile and prewarms it back to ready",
        localReasonerRestoreGateState: {
          runMode: "restore_and_prewarm",
          restoredProfileId: "profile_dom",
          warmStatus: "ready",
        },
        housekeepingApplyExpected: true,
        housekeepingMeaning: "smoke intentionally applies housekeeping and prunes old recovery/setup artifacts while revoking live read sessions",
        housekeepingGateState: {
          runMode: "apply",
          liveLedgerTouched: false,
          recoveryDeleteCount: 1,
          readSessionRevokeCount: 2,
          setupDeleteCount: 1,
        },
      },
    },
  ]);

  assert.equal(gate.status, "passed");
  assert.equal(gate.passedChecks, 5);
  assert.deepEqual(gate.failedChecks, []);
  assert.match(formatOperationalFlowSemanticsSummary(gate), /UISetupPackage=pass/);
  assert.match(formatOperationalFlowSemanticsSummary(gate), /UIRestore=pass/);
  assert.match(formatOperationalFlowSemanticsSummary(gate), /DOMSetupPackage=pass/);
  assert.match(formatOperationalFlowSemanticsSummary(gate), /DOMRestore=pass/);
  assert.match(formatOperationalFlowSemanticsSummary(gate), /DOMHousekeeping=pass/);
});

test("operational-flow semantics fails when DOM housekeeping apply evidence is incomplete", () => {
  const gate = summarizeOperationalFlowSemantics([
    {
      name: "smoke:dom:operational",
      result: {
        smokeDomStage: "operational",
        housekeepingApplyExpected: true,
        housekeepingMeaning: "smoke intentionally applies housekeeping and prunes old recovery/setup artifacts while revoking live read sessions",
        housekeepingGateState: {
          runMode: "apply",
          liveLedgerTouched: false,
          recoveryDeleteCount: 0,
          readSessionRevokeCount: 0,
          setupDeleteCount: 0,
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("dom_housekeeping_apply_semantics"));
});

test("operational-flow semantics stays unavailable when only combined DOM evidence is present", () => {
  const gate = summarizeOperationalFlowSemantics([
    {
      name: "smoke:dom",
      result: {
        smokeDomStage: "combined",
        setupPackageGateState: {
          runMode: "dry_run_preview",
        },
        housekeepingGateState: {
          runMode: "audit",
        },
      },
    },
  ]);

  assert.equal(gate.status, "unavailable");
  assert.equal(gate.totalChecks, 0);
});

test("operational-flow semantics rejects operational-looking evidence under combined step names", () => {
  const gate = summarizeOperationalFlowSemantics([
    {
      name: "smoke:ui",
      result: {
        savedSetupPackageId: "setup_saved_ui",
        setupPackagePersistenceExpected: true,
        setupPackageMeaning: "smoke explicitly saves setup packages",
        setupPackageGateState: {
          runMode: "persist_and_prune",
          persistedPackageId: "setup_saved_ui",
          embeddedProfileCount: 1,
        },
      },
    },
    {
      name: "smoke:dom",
      result: {
        savedSetupPackageId: "setup_saved_dom",
        setupPackagePersistenceExpected: true,
        setupPackageMeaning: "smoke explicitly saves setup packages",
        setupPackageGateState: {
          runMode: "persist_and_prune",
          persistedPackageId: "setup_saved_dom",
          embeddedProfileCount: 1,
          prunedDeletedCount: 1,
        },
        housekeepingApplyExpected: true,
        housekeepingMeaning: "smoke intentionally applies housekeeping",
        housekeepingGateState: {
          runMode: "apply",
          liveLedgerTouched: false,
          recoveryDeleteCount: 1,
          readSessionRevokeCount: 1,
          setupDeleteCount: 1,
        },
      },
    },
  ]);

  assert.equal(gate.status, "unavailable");
  assert.equal(gate.totalChecks, 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  formatProtectiveStateSemanticsSummary,
  summarizeProtectiveStateSemantics,
} from "../scripts/smoke-all.mjs";

test("protective-state semantics accepts expected guarded and dry-run states", () => {
  const gate = summarizeProtectiveStateSemantics(
    [
      {
        name: "smoke:ui",
        result: {
          runnerStatus: "blocked",
          runnerStatusExpected: true,
          runnerStatusMeaning: "combined smoke intentionally exercises mismatched-identity runner guard",
          bootstrapDryRun: true,
          bootstrapProfileWrites: 3,
          bootstrapApplyExpected: false,
          bootstrapMeaning: "smoke intentionally previews bootstrap and does not persist minimal runtime state",
          bootstrapGateState: {
            runMode: "dry_run_preview",
            dryRun: true,
            profileWrites: 3,
          },
          keychainMigrationApplyExpected: false,
          keychainMigrationMeaning: "combined smoke skips keychain migration because key material is already system protected or keychain is unavailable",
          keychainMigrationGateState: {
            runMode: "not_applicable_skip",
            dryRun: false,
            skipped: true,
          },
          housekeepingApplyExpected: false,
          housekeepingMeaning: "smoke intentionally audits housekeeping impact and only reports would-delete / would-revoke counts",
          housekeepingGateState: {
            runMode: "audit",
            liveLedgerTouched: false,
          },
          runnerGateState: {
            status: "blocked",
          },
        },
      },
      {
        name: "smoke:dom",
        result: {
          deviceSetupComplete: false,
          deviceSetupRunComplete: false,
          deviceSetupCompletionExpected: false,
          deviceSetupCompletionMeaning: "smoke intentionally validates device setup via dry-run/preview and does not finalize setup",
          deviceSetupGateState: {
            runMode: "dry_run_preview",
            statusComplete: false,
            runComplete: false,
          },
          recoveryBundlePersistenceExpected: false,
          recoveryBundleMeaning: "smoke previews recovery bundle export/import and does not persist bundle files",
          recoveryBundleGateState: {
            runMode: "dry_run_preview",
          },
          recoveryRehearsalPersistenceExpected: false,
          recoveryRehearsalMeaning: "smoke runs an inline recovery rehearsal and does not persist rehearsal history",
          recoveryRehearsalGateState: {
            runMode: "inline_preview",
          },
          setupPackagePersistenceExpected: false,
          setupPackageMeaning: "smoke previews setup package shape and does not persist package files",
          setupPackageGateState: {
            runMode: "dry_run_preview",
          },
        },
      },
    ],
    { browserSkipped: true }
  );

  assert.equal(gate.status, "passed");
  assert.deepEqual(gate.failedChecks, []);
  assert.equal(gate.passedChecks, 9);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /RunnerGuard=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /Bootstrap=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /KeychainMigration=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /Housekeeping=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /RecoveryBundle=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /RecoveryRehearsal=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /SetupPackage=pass/);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /DeviceSetupPreview=pass/);
});

test("protective-state semantics fails when DOM dry-run expectation metadata is missing", () => {
  const gate = summarizeProtectiveStateSemantics(
    [
      {
        name: "smoke:ui",
        result: {
          runnerStatus: "blocked",
          runnerStatusExpected: true,
          runnerStatusMeaning: "combined smoke intentionally exercises mismatched-identity runner guard",
          bootstrapDryRun: true,
          bootstrapProfileWrites: 3,
          bootstrapApplyExpected: false,
          bootstrapMeaning: "smoke intentionally previews bootstrap and does not persist minimal runtime state",
          bootstrapGateState: {
            runMode: "dry_run_preview",
            dryRun: true,
            profileWrites: 3,
          },
          keychainMigrationApplyExpected: false,
          keychainMigrationMeaning: "combined smoke skips keychain migration because key material is already system protected or keychain is unavailable",
          keychainMigrationGateState: {
            runMode: "not_applicable_skip",
            dryRun: false,
            skipped: true,
          },
          housekeepingApplyExpected: false,
          housekeepingMeaning: "smoke intentionally audits housekeeping impact and only reports would-delete / would-revoke counts",
          housekeepingGateState: {
            runMode: "audit",
            liveLedgerTouched: false,
          },
          runnerGateState: {
            status: "blocked",
          },
        },
      },
      {
        name: "smoke:dom",
        result: {
          deviceSetupComplete: false,
          deviceSetupRunComplete: false,
        },
      },
    ],
    { browserSkipped: true }
  );

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("dom_device_setup_preview_semantics"));
});

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
        },
      },
    ],
    { browserSkipped: true }
  );

  assert.equal(gate.status, "passed");
  assert.deepEqual(gate.failedChecks, []);
  assert.equal(gate.passedChecks, 3);
  assert.match(formatProtectiveStateSemanticsSummary(gate), /RunnerGuard=pass/);
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

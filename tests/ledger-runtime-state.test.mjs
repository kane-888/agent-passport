import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentSessionStateView,
  buildRuntimeBootstrapGate,
  buildRuntimeBootstrapGatePreview,
} from "../src/ledger-runtime-state.js";

test("runtime bootstrap gate fails closed when minimum context is missing", () => {
  const gate = buildRuntimeBootstrapGate(null, null);

  assert.equal(gate.required, true);
  assert.deepEqual(gate.missingRequiredCodes, [
    "task_snapshot_present",
    "profile_name_present",
    "profile_role_present",
  ]);
  assert.equal(gate.recommendation, "run_bootstrap");
  assert.equal(gate.checks.find((check) => check.code === "runtime_truth_source_commitment").passed, false);
});

test("runtime bootstrap gate passes required checks and reports truth-source commitments", () => {
  const gate = buildRuntimeBootstrapGate(null, null, {
    contextBuilder: {
      slots: {
        identitySnapshot: {
          taskSnapshot: { snapshotId: "snap_1" },
          profile: {
            name: "Kane",
            role: "owner",
          },
        },
      },
      memoryLayers: {
        ledger: {
          commitments: [
            { status: "active", payload: { field: "runtime_truth_source" } },
            { status: "superseded", payload: { field: "runtime_truth_source" } },
          ],
        },
      },
    },
  });

  assert.equal(gate.required, false);
  assert.deepEqual(gate.missingRequiredCodes, []);
  assert.equal(gate.recommendation, "continue");
  assert.equal(gate.checks.find((check) => check.code === "runtime_truth_source_commitment").passed, true);
  assert.deepEqual(gate.checks.find((check) => check.code === "runtime_truth_source_commitment").evidence, {
    commitmentCount: 2,
  });
});

test("runtime bootstrap preview uses injected task snapshot lookup and does not scan commitments", () => {
  const agent = {
    agentId: "agent_1",
    displayName: "Kane",
    role: "owner",
    identity: {
      profile: {
        name: "Fallback",
        role: "Fallback Role",
      },
    },
  };
  const gate = buildRuntimeBootstrapGatePreview(
    {},
    agent,
    {
      latestAgentTaskSnapshot: (_store, agentId) => ({ snapshotId: `snap_for_${agentId}` }),
    }
  );

  assert.equal(gate.required, false);
  assert.deepEqual(gate.missingRequiredCodes, []);
  assert.equal(gate.recommendation, "continue");
  assert.deepEqual(gate.checks.map((check) => [check.code, check.passed]), [
    ["task_snapshot_present", true],
    ["profile_name_present", true],
    ["profile_role_present", true],
    ["runtime_truth_source_commitment", false],
  ]);
  assert.deepEqual(gate.checks.find((check) => check.code === "runtime_truth_source_commitment").evidence, {
    previewOnly: true,
  });
});

test("agent session state views are detached clones", () => {
  const state = {
    sessionStateId: "sess_1",
    agentId: "agent_1",
    queryState: {
      flags: ["runtime"],
    },
    negotiation: {
      decision: "discuss",
    },
    memoryHomeostasis: {
      memoryAnchors: [{ id: "anchor_1" }],
    },
  };

  const view = buildAgentSessionStateView(state);
  assert.deepEqual(view, state);

  view.queryState.flags.push("mutated");
  view.negotiation.decision = "execute";
  view.memoryHomeostasis.memoryAnchors[0].id = "anchor_2";

  assert.deepEqual(state.queryState.flags, ["runtime"]);
  assert.equal(state.negotiation.decision, "discuss");
  assert.equal(state.memoryHomeostasis.memoryAnchors[0].id, "anchor_1");
});

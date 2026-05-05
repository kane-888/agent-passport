import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVerificationRunRecord,
  buildVerificationRunView,
  normalizeVerificationRunStatus,
  summarizeVerificationChecks,
} from "../src/ledger-verification-run.js";

test("verification run statuses normalize fail closed to partial", () => {
  assert.equal(normalizeVerificationRunStatus("passed"), "passed");
  assert.equal(normalizeVerificationRunStatus("FAILED"), "failed");
  assert.equal(normalizeVerificationRunStatus("partial"), "partial");
  assert.equal(normalizeVerificationRunStatus("unknown"), "partial");
  assert.equal(normalizeVerificationRunStatus(null), "partial");
});

test("verification check summaries count passed failed and partial statuses", () => {
  assert.deepEqual(
    summarizeVerificationChecks([
      { status: "passed" },
      { status: "failed" },
      { status: "partial" },
      { status: "unknown" },
      {},
    ]),
    {
      pass: 1,
      fail: 1,
      partial: 3,
    }
  );
});

test("verification run views expose integrity aliases and clone nested state", () => {
  const run = {
    verificationRunId: "vrun_1",
    mode: "runtime_integrity",
    status: "passed",
    checks: [{ code: "identity_snapshot_integrity", status: "passed" }],
    summary: { pass: 1, fail: 0, partial: 0 },
    relatedCompactBoundaryId: "cbnd_1",
  };

  const view = buildVerificationRunView(run);
  assert.deepEqual(view, {
    ...run,
    integrityRunId: "vrun_1",
    integrityMode: "runtime_integrity",
    integrityChecks: [{ code: "identity_snapshot_integrity", status: "passed" }],
    integritySummary: { pass: 1, fail: 0, partial: 0 },
    relatedResumeBoundaryId: "cbnd_1",
  });

  view.integrityChecks[0].status = "failed";
  view.integritySummary.fail = 1;
  assert.equal(run.checks[0].status, "passed");
  assert.equal(run.summary.fail, 0);
});

test("verification run records preserve shape and clone checks", () => {
  const checks = [
    {
      code: "bootstrap_gate_readiness",
      status: "passed",
      evidence: {
        missingRequiredCodes: [],
      },
    },
    {
      code: "task_snapshot_bootstrap",
      status: "partial",
      evidence: {
        taskSnapshotId: null,
      },
    },
  ];
  const record = buildVerificationRunRecord(
    {},
    { agentId: "agent_1" },
    {
      didMethod: "openneed",
      currentDidMethod: "agentpassport",
      mode: " runtime_integrity ",
      checks,
      contextBuilder: {
        contextHash: "ctx_1",
      },
      sourceWindowId: " window_1 ",
      relatedRunId: " run_1 ",
      relatedCompactBoundaryId: " cbnd_1 ",
    }
  );

  assert.match(record.verificationRunId, /^vrun_/);
  assert.equal(record.agentId, "agent_1");
  assert.equal(record.didMethod, "openneed");
  assert.equal(record.mode, "runtime_integrity");
  assert.equal(record.status, "partial");
  assert.deepEqual(record.summary, {
    pass: 1,
    fail: 0,
    partial: 1,
  });
  assert.deepEqual(record.checks, checks);
  assert.equal(record.contextHash, "ctx_1");
  assert.equal(record.sourceWindowId, "window_1");
  assert.equal(record.relatedRunId, "run_1");
  assert.equal(record.relatedCompactBoundaryId, "cbnd_1");
  assert.match(record.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  checks[0].evidence.missingRequiredCodes.push("mutated");
  assert.deepEqual(record.checks[0].evidence.missingRequiredCodes, []);
});

test("verification run records fail when any check fails and keep default method behavior", () => {
  const record = buildVerificationRunRecord(
    {},
    { agentId: "agent_1" },
    {
      currentDidMethod: "openneed",
      checks: [
        { status: "passed" },
        { status: "failed" },
      ],
    }
  );

  assert.equal(record.didMethod, "agentpassport");
  assert.equal(record.mode, "runtime_integrity");
  assert.equal(record.status, "failed");
  assert.deepEqual(record.summary, {
    pass: 1,
    fail: 1,
    partial: 0,
  });
});

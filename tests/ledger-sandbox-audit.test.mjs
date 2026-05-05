import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SANDBOX_ACTION_AUDIT_LIMIT,
  buildSandboxActionAuditView,
  normalizeSandboxActionAuditRecord,
  normalizeSandboxActionAuditStatus,
  sanitizeSandboxActionInputForAudit,
} from "../src/ledger-sandbox-audit.js";

test("sandbox audit statuses and defaults stay stable", () => {
  assert.equal(DEFAULT_SANDBOX_ACTION_AUDIT_LIMIT, 12);
  assert.equal(normalizeSandboxActionAuditStatus("BLOCKED"), "blocked");
  assert.equal(normalizeSandboxActionAuditStatus("failed"), "failed");
  assert.equal(normalizeSandboxActionAuditStatus("unknown"), "completed");
  assert.equal(normalizeSandboxActionAuditStatus(null), "completed");
});

test("sandbox audit input snapshots keep only the public action shape", () => {
  const sanitized = sanitizeSandboxActionInputForAudit(
    {
      capability: "filesystem-read",
      actionType: "View File",
      path: "/tmp/report.txt",
      url: "https://example.test/report",
      command: "/bin/cat",
      query: "report",
      title: "Report",
      args: [1, "two"],
      cwd: "/tmp",
      headers: { authorization: "secret" },
    },
    "process-exec"
  );

  assert.deepEqual(sanitized, {
    capability: "process_exec",
    actionType: "view_file",
    targetResource: "/tmp/report.txt",
    query: "report",
    title: "Report",
    url: "https://example.test/report",
    path: "/tmp/report.txt",
    command: "/bin/cat",
    args: ["1", "two"],
    cwd: "/tmp",
  });
});

test("sandbox audit records clamp counts, normalize gates, and clone payloads", () => {
  const negotiation = { policy: { mode: "confirm" }, notes: ["original"] };
  const output = { result: { ok: true }, writes: [{ path: "/tmp/a" }] };
  const record = normalizeSandboxActionAuditRecord({
    auditId: "audit-1",
    agentId: "agent-1",
    didMethod: "agentpassport",
    capability: "network-external",
    status: "unexpected",
    executed: true,
    requestedAction: "Fetch public page",
    requestedActionType: "FETCH URL",
    sourceWindowId: "window-1",
    recordedByAgentId: "agent-2",
    recordedByWindowId: "window-2",
    input: {
      capability: "filesystem-read",
      actionType: "read",
      url: "https://example.test/page",
      targetUrl: "https://fallback.test/page",
      headers: { authorization: "secret" },
    },
    executionBackend: "broker",
    writeCount: -5,
    summary: "done",
    gateReasons: ["policy", null, "owner-confirmed"],
    negotiation,
    output,
    error: { name: "TypeError", message: "boom", stack: "hidden" },
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(record.status, "completed");
  assert.equal(record.capability, "network_external");
  assert.equal(record.requestedActionType, "fetch_url");
  assert.equal(record.input.capability, "network_external");
  assert.equal(record.input.url, "https://example.test/page");
  assert.equal(Object.hasOwn(record.input, "headers"), false);
  assert.equal(record.writeCount, 0);
  assert.deepEqual(record.gateReasons, ["policy", "owner-confirmed"]);
  assert.deepEqual(record.error, { name: "TypeError", message: "boom" });

  negotiation.policy.mode = "mutated";
  output.result.ok = false;
  assert.equal(record.negotiation.policy.mode, "confirm");
  assert.equal(record.output.result.ok, true);

  const view = buildSandboxActionAuditView(record);
  view.output.result.ok = false;
  view.gateReasons.push("mutated");
  assert.equal(record.output.result.ok, true);
  assert.deepEqual(record.gateReasons, ["policy", "owner-confirmed"]);
});

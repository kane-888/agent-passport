import {
  cloneJson,
  createRecordId,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import { normalizeDidMethod } from "./protocol.js";

const VERIFICATION_RUN_STATUSES = new Set(["passed", "failed", "partial"]);

export function normalizeVerificationRunStatus(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? "partial";
  return VERIFICATION_RUN_STATUSES.has(normalized) ? normalized : "partial";
}

export function buildVerificationRunView(run) {
  const view = cloneJson(run) ?? null;
  if (!view) {
    return null;
  }
  return {
    ...view,
    integrityRunId: view.verificationRunId ?? null,
    integrityMode: view.mode ?? null,
    integrityChecks: cloneJson(view.checks) ?? [],
    integritySummary: cloneJson(view.summary) ?? null,
    relatedResumeBoundaryId: view.relatedCompactBoundaryId ?? null,
  };
}

export function summarizeVerificationChecks(checks = []) {
  const summary = {
    pass: 0,
    fail: 0,
    partial: 0,
  };
  for (const check of checks) {
    const status = normalizeVerificationRunStatus(check?.status);
    if (status === "passed") {
      summary.pass += 1;
    } else if (status === "failed") {
      summary.fail += 1;
    } else {
      summary.partial += 1;
    }
  }
  return summary;
}

export function buildVerificationRunRecord(
  _store,
  agent,
  {
    didMethod = null,
    currentDidMethod = null,
    mode = "runtime_integrity",
    checks = [],
    contextBuilder = null,
    sourceWindowId = null,
    relatedRunId = null,
    relatedCompactBoundaryId = null,
  } = {}
) {
  const summary = summarizeVerificationChecks(checks);
  const status = summary.fail > 0 ? "failed" : summary.partial > 0 ? "partial" : "passed";
  return {
    verificationRunId: createRecordId("vrun"),
    agentId: agent.agentId,
    didMethod:
      normalizeDidMethod(didMethod) ||
      normalizeOptionalText(currentDidMethod) ||
      null,
    mode: normalizeOptionalText(mode) ?? "runtime_integrity",
    status: normalizeVerificationRunStatus(status),
    checks: cloneJson(checks) ?? [],
    summary,
    contextHash: contextBuilder?.contextHash ?? null,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
    relatedRunId: normalizeOptionalText(relatedRunId) ?? null,
    relatedCompactBoundaryId: normalizeOptionalText(relatedCompactBoundaryId) ?? null,
    createdAt: now(),
  };
}

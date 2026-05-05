import {
  cloneJson,
  createRecordId,
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  normalizeRuntimeActionType,
  normalizeRuntimeCapability,
} from "./ledger-device-runtime.js";
import { normalizeDidMethod } from "./protocol.js";

export const DEFAULT_SANDBOX_ACTION_AUDIT_LIMIT = 12;

export function normalizeSandboxActionAuditStatus(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  return normalized && ["completed", "failed", "blocked"].includes(normalized) ? normalized : "completed";
}

export function sanitizeSandboxActionInputForAudit(rawAction = {}, capability = null) {
  const base = rawAction && typeof rawAction === "object" ? rawAction : {};
  return {
    capability: normalizeRuntimeCapability(capability || base.capability) ?? null,
    actionType: normalizeRuntimeActionType(base.actionType) ?? null,
    targetResource:
      normalizeOptionalText(base.targetResource || base.path || base.url || base.command || base.file || base.directory) ?? null,
    query: normalizeOptionalText(base.query) ?? null,
    title: normalizeOptionalText(base.title) ?? null,
    url: normalizeOptionalText(base.url || base.targetUrl) ?? null,
    path: normalizeOptionalText(base.path || base.file || base.directory) ?? null,
    command: normalizeOptionalText(base.command) ?? null,
    args: Array.isArray(base.args) ? base.args.map((item) => String(item)) : [],
    cwd: normalizeOptionalText(base.cwd) ?? null,
  };
}

export function normalizeSandboxActionAuditRecord(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  return {
    auditId: normalizeOptionalText(base.auditId) || createRecordId("saudit"),
    agentId: normalizeOptionalText(base.agentId) ?? null,
    didMethod: normalizeDidMethod(base.didMethod) || null,
    capability: normalizeRuntimeCapability(base.capability) ?? null,
    status: normalizeSandboxActionAuditStatus(base.status),
    executed: normalizeBooleanFlag(base.executed, false),
    requestedAction: normalizeOptionalText(base.requestedAction) ?? null,
    requestedActionType: normalizeRuntimeActionType(base.requestedActionType) ?? null,
    sourceWindowId: normalizeOptionalText(base.sourceWindowId) ?? null,
    recordedByAgentId: normalizeOptionalText(base.recordedByAgentId) ?? null,
    recordedByWindowId: normalizeOptionalText(base.recordedByWindowId) ?? null,
    input: sanitizeSandboxActionInputForAudit(base.input || {}, base.capability),
    executionBackend: normalizeOptionalText(base.executionBackend) ?? null,
    writeCount: Math.max(0, Math.floor(toFiniteNumber(base.writeCount, 0))),
    summary: normalizeOptionalText(base.summary) ?? null,
    gateReasons: normalizeTextList(base.gateReasons),
    negotiation: base.negotiation && typeof base.negotiation === "object" ? cloneJson(base.negotiation) : null,
    output: base.output && typeof base.output === "object" ? cloneJson(base.output) : null,
    error:
      base.error && typeof base.error === "object"
        ? {
            name: normalizeOptionalText(base.error.name) ?? "Error",
            message: normalizeOptionalText(base.error.message) ?? null,
          }
        : null,
    createdAt: normalizeOptionalText(base.createdAt) ?? now(),
  };
}

export function buildSandboxActionAuditView(audit) {
  return cloneJson(audit) ?? null;
}

import {
  cloneJson,
  createRecordId,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";

const DEFAULT_SECURITY_ANOMALY_LIMIT = 20;
const SECURITY_ANOMALY_CATEGORIES = new Set([
  "auth",
  "runtime",
  "sandbox",
  "network",
  "key_management",
  "recovery",
  "security",
]);
const SECURITY_ANOMALY_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function normalizeSecurityAnomalyCategory(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "security";
  return SECURITY_ANOMALY_CATEGORIES.has(normalized) ? normalized : "security";
}

function normalizeSecurityAnomalySeverity(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? "medium";
  return SECURITY_ANOMALY_SEVERITIES.has(normalized) ? normalized : "medium";
}

function normalizeSecurityAnomalyRecord(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  return {
    anomalyId: normalizeOptionalText(base.anomalyId) || createRecordId("sanom"),
    category: normalizeSecurityAnomalyCategory(base.category),
    severity: normalizeSecurityAnomalySeverity(base.severity),
    code: normalizeOptionalText(base.code) ?? "security_event",
    message: normalizeOptionalText(base.message) ?? null,
    path: normalizeOptionalText(base.path) ?? null,
    method: normalizeOptionalText(base.method)?.toUpperCase() ?? null,
    scope: normalizeOptionalText(base.scope) ?? null,
    reason: normalizeOptionalText(base.reason) ?? null,
    actorAgentId: normalizeOptionalText(base.actorAgentId) ?? null,
    actorReadSessionId: normalizeOptionalText(base.actorReadSessionId) ?? null,
    actorWindowId: normalizeOptionalText(base.actorWindowId) ?? null,
    relatedReadSessionId: normalizeOptionalText(base.relatedReadSessionId) ?? null,
    relatedRunId: normalizeOptionalText(base.relatedRunId) ?? null,
    details: cloneJson(base.details) ?? {},
    createdAt: normalizeOptionalText(base.createdAt) ?? now(),
    acknowledgedAt: normalizeOptionalText(base.acknowledgedAt) ?? null,
    acknowledgedByAgentId: normalizeOptionalText(base.acknowledgedByAgentId) ?? null,
  };
}

export function recordSecurityAnomalyInStore(store, payload = {}, { appendEvent }) {
  const anomaly = normalizeSecurityAnomalyRecord(payload);
  if (!Array.isArray(store.securityAnomalies)) {
    store.securityAnomalies = [];
  }
  store.securityAnomalies.push(anomaly);
  appendEvent(store, "security_anomaly_recorded", {
    anomalyId: anomaly.anomalyId,
    category: anomaly.category,
    severity: anomaly.severity,
    code: anomaly.code,
    path: anomaly.path,
    method: anomaly.method,
    scope: anomaly.scope,
    reason: anomaly.reason,
  });
  return anomaly;
}

export function listSecurityAnomaliesInStore(
  store,
  {
    limit = DEFAULT_SECURITY_ANOMALY_LIMIT,
    category = null,
    severity = null,
    includeAcknowledged = true,
    createdAfter = null,
    createdBefore = null,
  } = {}
) {
  const cappedLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_SECURITY_ANOMALY_LIMIT;
  const normalizedCategory = normalizeOptionalText(category) ? normalizeSecurityAnomalyCategory(category) : null;
  const normalizedSeverity = normalizeOptionalText(severity) ? normalizeSecurityAnomalySeverity(severity) : null;
  const normalizedCreatedAfter = normalizeOptionalText(createdAfter) ?? null;
  const normalizedCreatedBefore = normalizeOptionalText(createdBefore) ?? null;
  const anomalies = (Array.isArray(store.securityAnomalies) ? store.securityAnomalies : [])
    .filter((record) => {
      if (!includeAcknowledged && normalizeOptionalText(record?.acknowledgedAt)) {
        return false;
      }
      if (normalizedCategory && record.category !== normalizedCategory) {
        return false;
      }
      if (normalizedSeverity && record.severity !== normalizedSeverity) {
        return false;
      }
      if (normalizedCreatedAfter && String(record.createdAt || "") <= normalizedCreatedAfter) {
        return false;
      }
      if (normalizedCreatedBefore && String(record.createdAt || "") >= normalizedCreatedBefore) {
        return false;
      }
      return true;
    })
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  return {
    anomalies: anomalies.slice(0, cappedLimit).map((record) => cloneJson(record)),
    counts: {
      total: anomalies.length,
      filtered: anomalies.length,
      critical: anomalies.filter((record) => record.severity === "critical").length,
      unacknowledged: anomalies.filter((record) => !normalizeOptionalText(record.acknowledgedAt)).length,
    },
  };
}

import { json, normalizeOptionalText } from "./server-base-helpers.js";

const READ_SESSION_VIEW_TEMPLATE_LEVELS = Object.freeze({
  summary_only: 0,
  metadata_only: 1,
  standard_read: 2,
});

const READ_SESSION_VIEW_TEMPLATE_KEYS = Object.freeze([
  "deviceRuntime",
  "deviceSetup",
  "recovery",
  "agentRuntime",
  "transcript",
  "sandboxAudits",
  "security",
]);

const READ_SESSION_VIEW_TEMPLATE_ALIASES = Object.freeze({
  device_runtime: "deviceRuntime",
  runtime_state: "deviceRuntime",
  device_setup: "deviceSetup",
  setup_status: "deviceSetup",
  recovery_rehearsal: "recovery",
  agent_runtime: "agentRuntime",
  runtime: "agentRuntime",
  transcript_entries: "transcript",
  sandbox: "sandboxAudits",
  sandbox_audits: "sandboxAudits",
  security_state: "security",
});

export function hasReadSessionAccess(access) {
  return access?.mode === "read_session";
}

export function hasAdminAccess(access) {
  return access?.mode === "admin";
}

export function hasAllReadRole(access) {
  return hasReadSessionAccess(access) && normalizeOptionalText(access?.session?.role) === "all_read";
}

export function shouldRedactReadSessionPayload(access) {
  return hasReadSessionAccess(access) && !hasAllReadRole(access);
}

function resolveReadSession(accessOrSession = null) {
  if (!accessOrSession || typeof accessOrSession !== "object") {
    return null;
  }
  if (accessOrSession.mode === "read_session") {
    return accessOrSession.session ?? null;
  }
  return accessOrSession;
}

function normalizeReadSessionViewTemplateKey(value) {
  const raw = normalizeOptionalText(value);
  if (!raw) {
    return null;
  }
  if (READ_SESSION_VIEW_TEMPLATE_KEYS.includes(raw)) {
    return raw;
  }
  const normalized = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return READ_SESSION_VIEW_TEMPLATE_ALIASES[normalized] ?? null;
}

function normalizeReadSessionViewTemplateLevel(value, fallback = "metadata_only") {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? fallback;
  return Object.prototype.hasOwnProperty.call(READ_SESSION_VIEW_TEMPLATE_LEVELS, normalized)
    ? normalized
    : fallback;
}

function buildDefaultReadSessionViewTemplates(redactionTemplate = "metadata_only") {
  const defaultLevel =
    normalizeOptionalText(redactionTemplate) === "summary_only"
      ? "summary_only"
      : normalizeOptionalText(redactionTemplate) === "full"
        ? "standard_read"
        : "metadata_only";
  return READ_SESSION_VIEW_TEMPLATE_KEYS.reduce((accumulator, key) => {
    accumulator[key] = defaultLevel;
    return accumulator;
  }, {});
}

export function getReadSessionViewTemplates(accessOrSession = null) {
  const session = resolveReadSession(accessOrSession);
  const base = buildDefaultReadSessionViewTemplates(session?.redactionTemplate);
  const templates =
    session?.viewTemplates && typeof session.viewTemplates === "object"
      ? session.viewTemplates
      : session?.objectTemplates && typeof session.objectTemplates === "object"
        ? session.objectTemplates
        : session?.fieldTemplates && typeof session.fieldTemplates === "object"
          ? session.fieldTemplates
          : {};
  for (const [rawKey, rawValue] of Object.entries(templates)) {
    const normalizedKey = normalizeReadSessionViewTemplateKey(rawKey);
    if (!normalizedKey) {
      continue;
    }
    base[normalizedKey] = normalizeReadSessionViewTemplateLevel(rawValue, base[normalizedKey]);
  }
  return base;
}

export function getReadSessionViewTemplate(accessOrSession = null, domain, fallback = "metadata_only") {
  const normalizedDomain = normalizeReadSessionViewTemplateKey(domain);
  if (!normalizedDomain) {
    return normalizeReadSessionViewTemplateLevel(fallback, "metadata_only");
  }
  const templates = getReadSessionViewTemplates(accessOrSession);
  return normalizeReadSessionViewTemplateLevel(templates[normalizedDomain], fallback);
}

export function readSessionAllowsTemplateLevel(accessOrSession = null, domain, minimumLevel = "metadata_only") {
  const currentLevel = getReadSessionViewTemplate(accessOrSession, domain, "metadata_only");
  const requiredLevel = normalizeReadSessionViewTemplateLevel(minimumLevel, "metadata_only");
  return (
    (READ_SESSION_VIEW_TEMPLATE_LEVELS[currentLevel] ?? 0) >=
    (READ_SESSION_VIEW_TEMPLATE_LEVELS[requiredLevel] ?? 0)
  );
}

export function getReadSessionResourceBindings(session = null) {
  const bindings = session?.resourceBindings && typeof session.resourceBindings === "object"
    ? session.resourceBindings
    : {};
  const normalizeList = (value) =>
    Array.isArray(value)
      ? [...new Set(value.map((item) => normalizeOptionalText(item)).filter(Boolean))]
      : [];
  return {
    agentIds: normalizeList(bindings.agentIds),
    windowIds: normalizeList(bindings.windowIds),
    credentialIds: normalizeList(bindings.credentialIds),
  };
}

function readSessionAllowsBoundValue(boundValues = [], targetValue) {
  if (!Array.isArray(boundValues) || boundValues.length === 0) {
    return true;
  }
  const normalizedTarget = normalizeOptionalText(targetValue);
  if (!normalizedTarget) {
    return false;
  }
  return boundValues.includes(normalizedTarget);
}

function readSessionMatchesAnyBoundValues(boundValues = [], targetValues = []) {
  if (!Array.isArray(boundValues) || boundValues.length === 0) {
    return true;
  }
  const normalizedTargets = [...new Set(targetValues.map((item) => normalizeOptionalText(item)).filter(Boolean))];
  if (normalizedTargets.length === 0) {
    return false;
  }
  return normalizedTargets.some((value) => boundValues.includes(value));
}

function readSessionHasAnyResourceBinding(bindings = {}) {
  return (
    (Array.isArray(bindings.agentIds) && bindings.agentIds.length > 0) ||
    (Array.isArray(bindings.windowIds) && bindings.windowIds.length > 0) ||
    (Array.isArray(bindings.credentialIds) && bindings.credentialIds.length > 0)
  );
}

function getCredentialBindingAgentIds(record = null) {
  if (!record || typeof record !== "object") {
    return [];
  }
  const relatedAgentIds = Array.isArray(record.relatedAgentIds)
    ? record.relatedAgentIds.map((item) => normalizeOptionalText(item)).filter(Boolean)
    : [];
  const directAgentIds = [
    record.agentId,
    record.subjectType === "agent" ? record.subjectId : null,
    record.issuerAgentId,
    record.issuedByAgentId,
    record.revokedByAgentId,
  ]
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean);
  return [...new Set([...relatedAgentIds, ...directAgentIds])];
}

function getCredentialBindingWindowIds(record = null) {
  if (!record || typeof record !== "object") {
    return [];
  }
  const timeline = Array.isArray(record.timeline) ? record.timeline : [];
  return [
    record.windowId,
    record.actorWindowId,
    record.createdByWindowId,
    record.updatedByWindowId,
    record.issuedByWindowId,
    record.revokedByWindowId,
    ...(Array.isArray(record.relatedWindowIds) ? record.relatedWindowIds : []),
    ...timeline.flatMap((entry) => [
      entry?.windowId,
      entry?.actorWindowId,
      entry?.recordedByWindowId,
      entry?.issuedByWindowId,
      entry?.revokedByWindowId,
    ]),
  ]
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index);
}

function getAuthorizationBindingAgentIds(authorization = null) {
  if (!authorization || typeof authorization !== "object") {
    return [];
  }
  const signatureRecords = Array.isArray(authorization.signatureRecords)
    ? authorization.signatureRecords
    : Array.isArray(authorization.signatures)
      ? authorization.signatures
      : [];
  return [
    authorization.policyAgentId,
    authorization.policyAgent?.agentId,
    authorization.createdByAgentId,
    authorization.executedByAgentId,
    authorization.revokedByAgentId,
    authorization.lastSignedByAgentId,
    ...(Array.isArray(authorization.relatedAgentIds) ? authorization.relatedAgentIds : []),
    ...signatureRecords.flatMap((entry) => [
      entry?.agentId,
      entry?.recordedByAgentId,
      entry?.signerAgentId,
    ]),
  ]
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index);
}

function getAuthorizationBindingWindowIds(authorization = null) {
  if (!authorization || typeof authorization !== "object") {
    return [];
  }
  const signatureRecords = Array.isArray(authorization.signatureRecords)
    ? authorization.signatureRecords
    : Array.isArray(authorization.signatures)
      ? authorization.signatures
      : [];
  return [
    authorization.createdByWindowId,
    authorization.executedByWindowId,
    authorization.revokedByWindowId,
    authorization.lastSignedWindowId,
    ...signatureRecords.flatMap((entry) => [
      entry?.windowId,
      entry?.recordedByWindowId,
      entry?.signerWindowId,
    ]),
  ]
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index);
}

function getMigrationRepairBindingAgentIds(repairValue = null) {
  const repair =
    repairValue?.repair && typeof repairValue.repair === "object"
      ? repairValue.repair
      : repairValue && typeof repairValue === "object"
        ? repairValue
        : {};
  const links = repair.links && typeof repair.links === "object" ? repair.links : {};
  const linkedSubjects = Array.isArray(repair.linkedSubjects)
    ? repair.linkedSubjects
    : Array.isArray(links.repairedSubjects)
      ? links.repairedSubjects
      : [];
  const linkedComparisons = Array.isArray(repair.linkedComparisons)
    ? repair.linkedComparisons
    : Array.isArray(links.repairedComparisons)
      ? links.repairedComparisons
      : [];
  const linkedAgentIds = Array.isArray(links.agentIds) ? links.agentIds : [];

  return [
    repair.issuerAgentId,
    repair.targetAgentId,
    ...linkedAgentIds,
    ...linkedSubjects.flatMap((entry) => [
      entry?.issuerAgentId,
      normalizeOptionalText(entry?.kind) === "agent_identity" ? entry?.subjectId : null,
    ]),
    ...linkedComparisons.flatMap((entry) => [entry?.leftAgentId, entry?.rightAgentId]),
  ]
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index);
}

function getMigrationRepairBindingCredentialIds(repairValue = null) {
  const repair =
    repairValue?.repair && typeof repairValue.repair === "object"
      ? repairValue.repair
      : repairValue && typeof repairValue === "object"
        ? repairValue
        : {};
  const links = repair.links && typeof repair.links === "object" ? repair.links : {};
  return [
    ...(Array.isArray(repair.linkedCredentialRecordIds) ? repair.linkedCredentialRecordIds : []),
    ...(Array.isArray(repair.linkedCredentialIds) ? repair.linkedCredentialIds : []),
    ...(Array.isArray(links.repairedCredentialRecordIds) ? links.repairedCredentialRecordIds : []),
    ...(Array.isArray(links.repairedCredentialIds) ? links.repairedCredentialIds : []),
  ]
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index);
}

function getStatusListBindingAgentIds(statusListValue = null) {
  const summary =
    statusListValue?.summary && typeof statusListValue.summary === "object"
      ? statusListValue.summary
      : statusListValue && typeof statusListValue === "object"
        ? statusListValue
        : {};
  const left = statusListValue?.left && typeof statusListValue.left === "object" ? statusListValue.left : null;
  const right = statusListValue?.right && typeof statusListValue.right === "object" ? statusListValue.right : null;
  return [
    summary.issuerAgentId,
    left?.summary?.issuerAgentId,
    right?.summary?.issuerAgentId,
  ]
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index);
}

export function windowMatchesReadSession(access, windowRecord = null) {
  if (hasAdminAccess(access) || hasAllReadRole(access)) {
    return true;
  }
  if (!hasReadSessionAccess(access)) {
    return false;
  }
  const bindings = getReadSessionResourceBindings(access.session);
  if (!readSessionHasAnyResourceBinding(bindings)) {
    return false;
  }
  return (
    (bindings.windowIds.length > 0 && readSessionAllowsBoundValue(bindings.windowIds, windowRecord?.windowId)) ||
    (bindings.agentIds.length > 0 && readSessionAllowsBoundValue(bindings.agentIds, windowRecord?.agentId))
  );
}

export function credentialMatchesReadSession(access, credentialRecord = null) {
  if (hasAdminAccess(access) || hasAllReadRole(access)) {
    return true;
  }
  if (!hasReadSessionAccess(access)) {
    return false;
  }
  const bindings = getReadSessionResourceBindings(access.session);
  if (!readSessionHasAnyResourceBinding(bindings)) {
    return false;
  }
  const credentialId =
    normalizeOptionalText(credentialRecord?.credentialRecordId) ??
    normalizeOptionalText(credentialRecord?.credentialId) ??
    null;
  if (!readSessionAllowsBoundValue(bindings.credentialIds, credentialId)) {
    return false;
  }
  if (!readSessionMatchesAnyBoundValues(bindings.windowIds, getCredentialBindingWindowIds(credentialRecord))) {
    return false;
  }
  if (bindings.agentIds.length > 0) {
    const relatedAgentIds = getCredentialBindingAgentIds(credentialRecord);
    return relatedAgentIds.some((agentId) => bindings.agentIds.includes(agentId));
  }
  return true;
}

export function agentMatchesReadSession(access, agentRecord = null) {
  if (hasAdminAccess(access) || hasAllReadRole(access)) {
    return true;
  }
  if (!hasReadSessionAccess(access)) {
    return false;
  }
  const bindings = getReadSessionResourceBindings(access.session);
  if (bindings.agentIds.length === 0) {
    return false;
  }
  return readSessionAllowsBoundValue(bindings.agentIds, agentRecord?.agentId);
}

export function authorizationMatchesReadSession(access, authorization = null) {
  if (hasAdminAccess(access) || hasAllReadRole(access)) {
    return true;
  }
  if (!hasReadSessionAccess(access)) {
    return false;
  }
  const bindings = getReadSessionResourceBindings(access.session);
  if (!readSessionHasAnyResourceBinding(bindings)) {
    return false;
  }
  if (!readSessionMatchesAnyBoundValues(bindings.agentIds, getAuthorizationBindingAgentIds(authorization))) {
    return false;
  }
  if (!readSessionMatchesAnyBoundValues(bindings.windowIds, getAuthorizationBindingWindowIds(authorization))) {
    return false;
  }
  if (bindings.credentialIds.length > 0) {
    return false;
  }
  return true;
}

export function migrationRepairMatchesReadSession(access, repairValue = null) {
  if (hasAdminAccess(access) || hasAllReadRole(access)) {
    return true;
  }
  if (!hasReadSessionAccess(access)) {
    return false;
  }
  const bindings = getReadSessionResourceBindings(access.session);
  if (!readSessionHasAnyResourceBinding(bindings)) {
    return false;
  }
  if (bindings.windowIds.length > 0) {
    return false;
  }
  if (!readSessionMatchesAnyBoundValues(bindings.agentIds, getMigrationRepairBindingAgentIds(repairValue))) {
    return false;
  }
  if (!readSessionMatchesAnyBoundValues(bindings.credentialIds, getMigrationRepairBindingCredentialIds(repairValue))) {
    return false;
  }
  return true;
}

export function statusListMatchesReadSession(access, statusListValue = null) {
  if (hasAdminAccess(access) || hasAllReadRole(access)) {
    return true;
  }
  if (!hasReadSessionAccess(access)) {
    return false;
  }
  const bindings = getReadSessionResourceBindings(access.session);
  if (bindings.agentIds.length === 0) {
    return false;
  }
  if (bindings.windowIds.length > 0) {
    return false;
  }
  if (!readSessionMatchesAnyBoundValues(bindings.agentIds, getStatusListBindingAgentIds(statusListValue))) {
    return false;
  }
  if (bindings.credentialIds.length > 0) {
    return false;
  }
  return true;
}

export function denyReadSessionResource(res, kind, value) {
  return json(res, 403, {
    error: `Read session is not allowed to access this ${kind}`,
    resource: {
      kind,
      value: normalizeOptionalText(value),
    },
  });
}

export function ensureReadSessionResource(res, allowed, kind, value) {
  if (allowed) {
    return true;
  }
  denyReadSessionResource(res, kind, value);
  return false;
}

export function ensureAgentReadAccess(res, access, agentId) {
  return ensureReadSessionResource(res, agentMatchesReadSession(access, { agentId }), "agent", agentId);
}

import { randomBytes } from "node:crypto";
import {
  addSeconds,
  cloneJson,
  createRecordId,
  hashAccessToken,
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";

const READ_SESSION_SCOPES = new Set([
  "all",
  "security",
  "device_runtime",
  "recovery",
  "agents",
  "agents_catalog",
  "agents_identity",
  "agents_assets",
  "agents_context",
  "agents_runtime",
  "agents_runtime_minutes",
  "agents_runtime_search",
  "agents_runtime_actions",
  "agents_rehydrate",
  "agents_memories",
  "agents_runner",
  "agents_query_states",
  "agents_session_state",
  "agents_compact_boundaries",
  "agents_verification_runs",
  "agents_transcript",
  "agents_messages",
  "agents_authorizations",
  "credentials",
  "credentials_catalog",
  "credentials_detail",
  "credentials_timeline",
  "credentials_status",
  "authorizations",
  "authorizations_catalog",
  "authorizations_detail",
  "authorizations_timeline",
  "authorizations_credential",
  "migration_repairs",
  "migration_repairs_catalog",
  "migration_repairs_detail",
  "migration_repairs_timeline",
  "migration_repairs_credentials",
  "status_lists",
  "status_lists_catalog",
  "status_lists_detail",
  "status_lists_compare",
  "windows",
  "windows_catalog",
  "windows_detail",
]);

const READ_SESSION_SCOPE_GROUPS = Object.freeze({
  agents: [
    "agents_catalog",
    "agents_identity",
    "agents_assets",
    "agents_context",
    "agents_runtime",
    "agents_runtime_minutes",
    "agents_runtime_search",
    "agents_runtime_actions",
    "agents_rehydrate",
    "agents_memories",
    "agents_runner",
    "agents_query_states",
    "agents_session_state",
    "agents_compact_boundaries",
    "agents_verification_runs",
    "agents_transcript",
    "agents_messages",
    "agents_authorizations",
  ],
  credentials: ["credentials_catalog", "credentials_detail", "credentials_timeline", "credentials_status"],
  authorizations: [
    "authorizations_catalog",
    "authorizations_detail",
    "authorizations_timeline",
    "authorizations_credential",
  ],
  migration_repairs: [
    "migration_repairs_catalog",
    "migration_repairs_detail",
    "migration_repairs_timeline",
    "migration_repairs_credentials",
  ],
  status_lists: ["status_lists_catalog", "status_lists_detail", "status_lists_compare"],
  windows: ["windows_catalog", "windows_detail"],
});
const READ_SESSION_VALIDATION_TOUCH_INTERVAL_MS = 30 * 1000;

const READ_SESSION_ROLE_PRESETS = Object.freeze({
  all_read: {
    role: "all_read",
    label: "全量只读",
    scopes: ["all"],
    canDelegate: true,
    maxDelegationDepth: 2,
    redactionTemplate: "full",
    viewTemplates: {
      deviceRuntime: "standard_read",
      deviceSetup: "standard_read",
      recovery: "standard_read",
      agentRuntime: "standard_read",
      transcript: "standard_read",
      sandboxAudits: "standard_read",
      security: "standard_read",
    },
  },
  security_delegate: {
    role: "security_delegate",
    label: "安全委托",
    scopes: ["security", "device_runtime", "recovery"],
    canDelegate: true,
    maxDelegationDepth: 1,
    redactionTemplate: "metadata_only",
    viewTemplates: {
      deviceRuntime: "metadata_only",
      deviceSetup: "metadata_only",
      recovery: "metadata_only",
      security: "metadata_only",
    },
  },
  runtime_observer: {
    role: "runtime_observer",
    label: "运行态观察",
    scopes: ["device_runtime"],
    canDelegate: false,
    maxDelegationDepth: 0,
    redactionTemplate: "summary_only",
    viewTemplates: {
      deviceRuntime: "summary_only",
      agentRuntime: "summary_only",
      transcript: "summary_only",
      sandboxAudits: "summary_only",
    },
  },
  recovery_observer: {
    role: "recovery_observer",
    label: "恢复观察",
    scopes: ["recovery"],
    canDelegate: false,
    maxDelegationDepth: 0,
    redactionTemplate: "summary_only",
    viewTemplates: {
      deviceSetup: "summary_only",
      recovery: "summary_only",
    },
  },
  agent_auditor: {
    role: "agent_auditor",
    label: "Agent 审计",
    scopes: ["agents", "credentials", "authorizations", "migration_repairs", "status_lists"],
    canDelegate: false,
    maxDelegationDepth: 0,
    redactionTemplate: "metadata_only",
    viewTemplates: {
      agentRuntime: "metadata_only",
      transcript: "metadata_only",
      sandboxAudits: "metadata_only",
    },
  },
  authorization_observer: {
    role: "authorization_observer",
    label: "授权观察",
    scopes: ["authorizations_catalog", "authorizations_detail", "authorizations_timeline", "authorizations_credential"],
    canDelegate: false,
    maxDelegationDepth: 0,
    redactionTemplate: "metadata_only",
  },
  repair_observer: {
    role: "repair_observer",
    label: "修复观察",
    scopes: ["migration_repairs_catalog", "migration_repairs_detail", "migration_repairs_timeline", "migration_repairs_credentials"],
    canDelegate: false,
    maxDelegationDepth: 0,
    redactionTemplate: "metadata_only",
  },
  status_list_observer: {
    role: "status_list_observer",
    label: "状态列表观察",
    scopes: ["status_lists_catalog", "status_lists_detail", "status_lists_compare"],
    canDelegate: false,
    maxDelegationDepth: 0,
    redactionTemplate: "metadata_only",
  },
  runtime_summary_observer: {
    role: "runtime_summary_observer",
    label: "运行摘要观察",
    scopes: [
      "agents_runtime",
      "agents_runtime_actions",
      "agents_session_state",
      "agents_compact_boundaries",
      "agents_verification_runs",
      "agents_transcript",
    ],
    canDelegate: false,
    maxDelegationDepth: 0,
    redactionTemplate: "summary_only",
    viewTemplates: {
      agentRuntime: "summary_only",
      transcript: "summary_only",
      sandboxAudits: "summary_only",
    },
  },
  agent_metadata_observer: {
    role: "agent_metadata_observer",
    label: "Agent 元数据观察",
    scopes: ["agents_catalog", "agents_identity", "agents_context", "agents_runtime", "agents_transcript"],
    canDelegate: false,
    maxDelegationDepth: 0,
    redactionTemplate: "metadata_only",
    viewTemplates: {
      agentRuntime: "metadata_only",
      transcript: "metadata_only",
    },
  },
  credential_metadata_observer: {
    role: "credential_metadata_observer",
    label: "证据元数据观察",
    scopes: ["credentials_catalog", "credentials_detail", "credentials_timeline", "credentials_status"],
    canDelegate: false,
    maxDelegationDepth: 0,
    redactionTemplate: "metadata_only",
  },
  transcript_observer: {
    role: "transcript_observer",
    label: "转录轨观察",
    scopes: ["agents_transcript", "agents_session_state", "agents_compact_boundaries"],
    canDelegate: false,
    maxDelegationDepth: 0,
    redactionTemplate: "summary_only",
    viewTemplates: {
      transcript: "summary_only",
      agentRuntime: "summary_only",
    },
  },
  window_observer: {
    role: "window_observer",
    label: "窗口观察",
    scopes: ["windows", "agents"],
    canDelegate: false,
    maxDelegationDepth: 0,
    redactionTemplate: "metadata_only",
  },
});

const READ_SESSION_VIEW_TEMPLATE_LEVELS = Object.freeze([
  "summary_only",
  "metadata_only",
  "standard_read",
]);

const READ_SESSION_VIEW_TEMPLATE_LEVEL_INDEX = Object.freeze(
  READ_SESSION_VIEW_TEMPLATE_LEVELS.reduce((accumulator, level, index) => {
    accumulator[level] = index;
    return accumulator;
  }, {})
);

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
  agent_runtime: "agentRuntime",
  runtime: "agentRuntime",
  transcript_entries: "transcript",
  sandbox: "sandboxAudits",
  sandbox_audits: "sandboxAudits",
  security_state: "security",
});

export function normalizeReadSessionScope(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? null;
  return normalized && READ_SESSION_SCOPES.has(normalized) ? normalized : null;
}

export function normalizeReadSessionRole(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? null;
  return normalized && READ_SESSION_ROLE_PRESETS[normalized] ? normalized : null;
}

export function normalizeReadSessionRedactionTemplate(value, fallback = "metadata_only") {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? fallback;
  return ["full", "metadata_only", "summary_only"].includes(normalized) ? normalized : fallback;
}

export function getReadSessionRolePreset(role) {
  const normalized = normalizeReadSessionRole(role);
  return normalized ? cloneJson(READ_SESSION_ROLE_PRESETS[normalized]) : null;
}

function buildDefaultReadSessionViewTemplates(redactionTemplate = "metadata_only") {
  const normalizedTemplate = normalizeReadSessionRedactionTemplate(redactionTemplate, "metadata_only");
  const defaultLevel =
    normalizedTemplate === "summary_only"
      ? "summary_only"
      : normalizedTemplate === "full"
        ? "standard_read"
        : "metadata_only";
  return READ_SESSION_VIEW_TEMPLATE_KEYS.reduce((accumulator, key) => {
    accumulator[key] = defaultLevel;
    return accumulator;
  }, {});
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

export function normalizeReadSessionViewTemplateLevel(value, fallback = "metadata_only") {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? fallback;
  return READ_SESSION_VIEW_TEMPLATE_LEVELS.includes(normalized) ? normalized : fallback;
}

export function normalizeReadSessionViewTemplates(value = {}, fallbackTemplates = null) {
  const base = value && typeof value === "object" ? value : {};
  const fallback =
    fallbackTemplates && typeof fallbackTemplates === "object"
      ? fallbackTemplates
      : buildDefaultReadSessionViewTemplates("metadata_only");
  const next = { ...buildDefaultReadSessionViewTemplates("metadata_only"), ...cloneJson(fallback) };
  for (const [rawKey, rawValue] of Object.entries(base)) {
    const normalizedKey = normalizeReadSessionViewTemplateKey(rawKey);
    if (!normalizedKey) {
      continue;
    }
    next[normalizedKey] = normalizeReadSessionViewTemplateLevel(rawValue, next[normalizedKey]);
  }
  return next;
}

function readSessionViewTemplatesAreSubset(candidateTemplates = {}, parentTemplates = {}) {
  const candidate = normalizeReadSessionViewTemplates(candidateTemplates);
  const parent = normalizeReadSessionViewTemplates(parentTemplates);
  return READ_SESSION_VIEW_TEMPLATE_KEYS.every((key) => {
    const candidateIndex = READ_SESSION_VIEW_TEMPLATE_LEVEL_INDEX[candidate[key]] ?? 0;
    const parentIndex = READ_SESSION_VIEW_TEMPLATE_LEVEL_INDEX[parent[key]] ?? 0;
    return candidateIndex <= parentIndex;
  });
}

export async function listReadSessionRoles() {
  return {
    count: Object.keys(READ_SESSION_ROLE_PRESETS).length,
    roles: Object.values(READ_SESSION_ROLE_PRESETS).map((entry) => ({
      role: entry.role,
      label: entry.label,
      scopes: [...entry.scopes],
      canDelegate: Boolean(entry.canDelegate),
      maxDelegationDepth: Math.max(0, Math.floor(toFiniteNumber(entry.maxDelegationDepth, 0))),
      redactionTemplate: normalizeReadSessionRedactionTemplate(entry.redactionTemplate, "metadata_only"),
      viewTemplates: normalizeReadSessionViewTemplates(
        entry.viewTemplates,
        buildDefaultReadSessionViewTemplates(entry.redactionTemplate)
      ),
    })),
  };
}

export async function listReadSessionScopes() {
  return {
    count: READ_SESSION_SCOPES.size,
    scopes: [...READ_SESSION_SCOPES].sort(),
  };
}

export function normalizeReadSessionScopes(value) {
  const scopes = normalizeTextList(value)
    .map((item) => normalizeReadSessionScope(item))
    .filter(Boolean);
  if (scopes.length === 0) {
    return ["agents"];
  }
  return [...new Set(scopes)];
}

function getExpandedReadSessionScopeSet(value) {
  const normalizedScope = normalizeReadSessionScope(value);
  if (!normalizedScope) {
    return new Set();
  }
  const expanded = new Set([normalizedScope]);
  const children = READ_SESSION_SCOPE_GROUPS[normalizedScope] || [];
  for (const child of children) {
    expanded.add(child);
  }
  return expanded;
}

function readSessionScopeSatisfies(grantedScope, requiredScope) {
  const normalizedGranted = normalizeReadSessionScope(grantedScope);
  const normalizedRequired = normalizeReadSessionScope(requiredScope);
  if (!normalizedGranted || !normalizedRequired) {
    return false;
  }
  if (normalizedGranted === "all") {
    return true;
  }
  if (normalizedGranted === normalizedRequired) {
    return true;
  }
  return getExpandedReadSessionScopeSet(normalizedGranted).has(normalizedRequired);
}

function normalizeReadSessionResourceIds(value) {
  return [...new Set(normalizeTextList(value))];
}

export function normalizeReadSessionResourceBindings(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  return {
    agentIds: normalizeReadSessionResourceIds(base.agentIds),
    windowIds: normalizeReadSessionResourceIds(base.windowIds),
    credentialIds: normalizeReadSessionResourceIds(base.credentialIds),
  };
}

function readSessionResourceBindingsAreSubset(candidateBindings = {}, parentBindings = {}) {
  const candidate = normalizeReadSessionResourceBindings(candidateBindings);
  const parent = normalizeReadSessionResourceBindings(parentBindings);
  return ["agentIds", "windowIds", "credentialIds"].every((field) => {
    if (parent[field].length === 0) {
      return true;
    }
    if (candidate[field].length === 0) {
      return false;
    }
    return candidate[field].every((value) => parent[field].includes(value));
  });
}

function readSessionHasResourceBindings(record) {
  const bindings = normalizeReadSessionResourceBindings(record?.resourceBindings);
  return bindings.agentIds.length > 0 || bindings.windowIds.length > 0 || bindings.credentialIds.length > 0;
}

function buildReadSessionView(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const resourceBindings = normalizeReadSessionResourceBindings(record.resourceBindings);
  const viewTemplates = normalizeReadSessionViewTemplates(
    record.viewTemplates || record.objectTemplates || record.fieldTemplates,
    buildDefaultReadSessionViewTemplates(record.redactionTemplate)
  );
  return {
    readSessionId: normalizeOptionalText(record.readSessionId) ?? null,
    parentReadSessionId: normalizeOptionalText(record.parentReadSessionId) ?? null,
    rootReadSessionId:
      normalizeOptionalText(record.rootReadSessionId) ??
      normalizeOptionalText(record.readSessionId) ??
      null,
    lineageDepth: Math.max(0, Math.floor(toFiniteNumber(record.lineageDepth, 0))),
    role: normalizeReadSessionRole(record.role) ?? null,
    roleLabel: getReadSessionRolePreset(record.role)?.label ?? null,
    label: normalizeOptionalText(record.label) ?? null,
    scopes: normalizeReadSessionScopes(record.scopes),
    note: normalizeOptionalText(record.note) ?? null,
    canDelegate: normalizeBooleanFlag(record.canDelegate, false),
    maxDelegationDepth: Math.max(0, Math.floor(toFiniteNumber(record.maxDelegationDepth, 0))),
    createdAt: normalizeOptionalText(record.createdAt) ?? null,
    expiresAt: normalizeOptionalText(record.expiresAt) ?? null,
    revokedAt: normalizeOptionalText(record.revokedAt) ?? null,
    createdByAgentId: normalizeOptionalText(record.createdByAgentId) ?? null,
    createdByReadSessionId: normalizeOptionalText(record.createdByReadSessionId) ?? null,
    createdByWindowId: normalizeOptionalText(record.createdByWindowId) ?? null,
    revokedByAncestorReadSessionId: normalizeOptionalText(record.revokedByAncestorReadSessionId) ?? null,
    revocationCascadeRootReadSessionId:
      normalizeOptionalText(record.revocationCascadeRootReadSessionId) ?? null,
    lastValidatedAt: normalizeOptionalText(record.lastValidatedAt) ?? null,
    redactionTemplate: normalizeReadSessionRedactionTemplate(
      record.redactionTemplate,
      "metadata_only"
    ),
    viewTemplates,
    resourceBindings,
    resourceBound: readSessionHasResourceBindings(record),
  };
}

function isReadSessionExpired(record, referenceTime = now()) {
  const expiresAt = normalizeOptionalText(record?.expiresAt);
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() <= new Date(referenceTime).getTime();
}

function shouldTouchReadSessionValidation(record, validatedAt) {
  const validatedTime = new Date(validatedAt).getTime();
  if (!Number.isFinite(validatedTime)) {
    return false;
  }
  const lastValidatedTime = new Date(normalizeOptionalText(record?.lastValidatedAt) || "").getTime();
  if (!Number.isFinite(lastValidatedTime)) {
    return true;
  }
  return validatedTime - lastValidatedTime >= READ_SESSION_VALIDATION_TOUCH_INTERVAL_MS;
}

function readSessionMatchesScope(record, requiredScope) {
  const scope = normalizeReadSessionScope(requiredScope);
  if (!scope) {
    return false;
  }
  const scopes = normalizeReadSessionScopes(record?.scopes);
  return scopes.some((grantedScope) => readSessionScopeSatisfies(grantedScope, scope));
}

function readSessionScopesAreSubset(candidateScopes, parentScopes) {
  const normalizedCandidateScopes = normalizeReadSessionScopes(candidateScopes);
  const normalizedParentScopes = normalizeReadSessionScopes(parentScopes);
  if (normalizedParentScopes.includes("all")) {
    return true;
  }
  if (normalizedCandidateScopes.includes("all")) {
    return false;
  }
  return normalizedCandidateScopes.every((scope) =>
    normalizedParentScopes.some((parentScope) => readSessionScopeSatisfies(parentScope, scope))
  );
}

function buildReadSessionLookup(store) {
  const records = Array.isArray(store?.readSessions)
    ? store.readSessions.filter((record) => record && typeof record === "object")
    : [];
  const recordById = new Map();
  const recordByTokenHash = new Map();
  const childrenByParentId = new Map();

  for (const record of records) {
    const readSessionId = normalizeOptionalText(record?.readSessionId);
    if (readSessionId) {
      recordById.set(readSessionId, record);
    }
    const tokenHash = normalizeOptionalText(record?.tokenHash);
    if (tokenHash) {
      recordByTokenHash.set(tokenHash, record);
    }
  }

  for (const record of records) {
    const parentReadSessionId = normalizeOptionalText(record?.parentReadSessionId);
    const readSessionId = normalizeOptionalText(record?.readSessionId);
    if (!parentReadSessionId || !readSessionId) {
      continue;
    }
    if (!childrenByParentId.has(parentReadSessionId)) {
      childrenByParentId.set(parentReadSessionId, []);
    }
    childrenByParentId.get(parentReadSessionId).push(record);
  }

  return {
    records,
    recordById,
    recordByTokenHash,
    childrenByParentId,
    lineageCache: new Map(),
    descendantCountCache: new Map(),
    descendantListCache: new Map(),
  };
}

function findReadSessionByTokenHash(store, tokenHash, lookup = null) {
  if (!tokenHash) {
    return null;
  }
  if (lookup?.recordByTokenHash instanceof Map) {
    return lookup.recordByTokenHash.get(tokenHash) ?? null;
  }
  if (!Array.isArray(store?.readSessions)) {
    return null;
  }
  return store.readSessions.find((record) => normalizeOptionalText(record?.tokenHash) === tokenHash) ?? null;
}

function findReadSessionById(store, readSessionId, lookup = null) {
  const normalizedId = normalizeOptionalText(readSessionId);
  if (!normalizedId) {
    return null;
  }
  if (lookup?.recordById instanceof Map) {
    return lookup.recordById.get(normalizedId) ?? null;
  }
  if (!Array.isArray(store?.readSessions)) {
    return null;
  }
  return store.readSessions.find(
    (record) => normalizeOptionalText(record?.readSessionId) === normalizedId
  ) ?? null;
}

function collectReadSessionLineage(store, record, lookup = null) {
  const recordId = normalizeOptionalText(record?.readSessionId);
  if (recordId && lookup?.lineageCache?.has(recordId)) {
    return lookup.lineageCache.get(recordId);
  }
  const lineage = [];
  const seen = new Set();
  let current = record;
  let missingParentId = null;
  let cycleDetected = false;
  while (current && current.readSessionId && !seen.has(current.readSessionId)) {
    lineage.push(current);
    seen.add(current.readSessionId);
    const parentReadSessionId = normalizeOptionalText(current.parentReadSessionId);
    if (!parentReadSessionId) {
      current = null;
      continue;
    }
    const parent = findReadSessionById(store, parentReadSessionId, lookup);
    if (!parent) {
      missingParentId = parentReadSessionId;
      current = null;
      continue;
    }
    current = parent;
  }
  if (current?.readSessionId && seen.has(current.readSessionId)) {
    cycleDetected = true;
  }
  const result = {
    records: lineage,
    missingParentId,
    cycleDetected,
  };
  if (recordId && lookup?.lineageCache) {
    lookup.lineageCache.set(recordId, result);
  }
  return result;
}

function countReadSessionDescendants(store, readSessionId, lookup = null) {
  const normalizedId = normalizeOptionalText(readSessionId);
  if (!normalizedId) {
    return 0;
  }
  if (lookup?.descendantCountCache?.has(normalizedId)) {
    return lookup.descendantCountCache.get(normalizedId) ?? 0;
  }
  if (lookup?.childrenByParentId instanceof Map) {
    const seen = new Set([normalizedId]);
    const stack = [...(lookup.childrenByParentId.get(normalizedId) ?? [])];
    let count = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      const currentId = normalizeOptionalText(current?.readSessionId);
      if (!currentId || seen.has(currentId)) {
        continue;
      }
      seen.add(currentId);
      count += 1;
      const children = lookup.childrenByParentId.get(currentId);
      if (Array.isArray(children) && children.length > 0) {
        stack.push(...children);
      }
    }
    lookup.descendantCountCache?.set(normalizedId, count);
    return count;
  }
  if (!Array.isArray(store?.readSessions)) {
    return 0;
  }
  return store.readSessions.filter((record) => {
    if (!record || normalizeOptionalText(record.readSessionId) === normalizedId) {
      return false;
    }
    const lineage = collectReadSessionLineage(store, record, lookup);
    return lineage.records.some((entry) => normalizeOptionalText(entry?.readSessionId) === normalizedId);
  }).length;
}

function collectReadSessionDescendants(store, readSessionId, lookup = null) {
  const normalizedId = normalizeOptionalText(readSessionId);
  if (!normalizedId) {
    return [];
  }
  if (lookup?.descendantListCache?.has(normalizedId)) {
    return lookup.descendantListCache.get(normalizedId) ?? [];
  }
  if (lookup?.childrenByParentId instanceof Map) {
    const descendants = [];
    const seen = new Set([normalizedId]);
    const stack = [...(lookup.childrenByParentId.get(normalizedId) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop();
      const currentId = normalizeOptionalText(current?.readSessionId);
      if (!currentId || seen.has(currentId)) {
        continue;
      }
      seen.add(currentId);
      descendants.push(current);
      const children = lookup.childrenByParentId.get(currentId);
      if (Array.isArray(children) && children.length > 0) {
        stack.push(...children);
      }
    }
    descendants.sort(
      (left, right) =>
        Math.floor(toFiniteNumber(left?.lineageDepth, 0)) - Math.floor(toFiniteNumber(right?.lineageDepth, 0)) ||
        String(left?.createdAt || "").localeCompare(String(right?.createdAt || ""))
    );
    lookup.descendantListCache?.set(normalizedId, descendants);
    return descendants;
  }
  if (!Array.isArray(store?.readSessions)) {
    return [];
  }
  return store.readSessions
    .filter((record) => {
      if (!record || normalizeOptionalText(record.readSessionId) === normalizedId) {
        return false;
      }
      const lineage = collectReadSessionLineage(store, record, lookup);
      return lineage.records.some((entry) => normalizeOptionalText(entry?.readSessionId) === normalizedId);
    })
    .sort(
      (left, right) =>
        Math.floor(toFiniteNumber(left?.lineageDepth, 0)) - Math.floor(toFiniteNumber(right?.lineageDepth, 0)) ||
        String(left?.createdAt || "").localeCompare(String(right?.createdAt || ""))
    );
}

function evaluateReadSessionState(
  store,
  record,
  { scope = null, referenceTime = now(), includeLineageDetails = true, lookup = null } = {}
) {
  const view = buildReadSessionView(record);
  if (!view) {
    return {
      valid: false,
      reason: "session_not_found",
      session: null,
    };
  }

  const lineage = collectReadSessionLineage(store, record, lookup);
  const lineageViews = includeLineageDetails
    ? lineage.records.map((entry) => buildReadSessionView(entry)).filter(Boolean)
    : [];
  let reason = null;
  let invalidatedByReadSessionId = null;

  if (lineage.cycleDetected) {
    reason = "session_lineage_cycle";
  } else if (lineage.missingParentId) {
    reason = "ancestor_session_missing";
  } else {
    for (let index = 0; index < lineage.records.length; index += 1) {
      const current = lineage.records[index];
      if (normalizeOptionalText(current?.revokedAt)) {
        const revokedByAncestorReadSessionId =
          normalizeOptionalText(current?.revokedByAncestorReadSessionId) ?? null;
        reason =
          index === 0
            ? revokedByAncestorReadSessionId
              ? "ancestor_session_revoked"
              : "session_revoked"
            : "ancestor_session_revoked";
        invalidatedByReadSessionId =
          revokedByAncestorReadSessionId ??
          normalizeOptionalText(current?.readSessionId) ??
          null;
        break;
      }
      if (isReadSessionExpired(current, referenceTime)) {
        reason = index === 0 ? "session_expired" : "ancestor_session_expired";
        invalidatedByReadSessionId = normalizeOptionalText(current?.readSessionId) ?? null;
        break;
      }
    }
    if (!reason) {
      const normalizedScope = normalizeReadSessionScope(scope);
      if (normalizedScope) {
        const scopeMismatch = lineage.records.find((entry) => !readSessionMatchesScope(entry, normalizedScope));
        if (scopeMismatch) {
          reason =
            normalizeOptionalText(scopeMismatch?.readSessionId) === normalizeOptionalText(record?.readSessionId)
              ? "scope_mismatch"
              : "ancestor_scope_mismatch";
          invalidatedByReadSessionId = normalizeOptionalText(scopeMismatch?.readSessionId) ?? null;
        }
      }
    }
  }

  const rootRecord = lineage.records.at(-1) || record;
  const descendantSessionCount = includeLineageDetails
    ? countReadSessionDescendants(store, view.readSessionId, lookup)
    : 0;

  return {
    valid: !reason,
    reason,
    invalidatedByReadSessionId,
    session: {
      ...view,
      rootReadSessionId:
        view.rootReadSessionId ||
        normalizeOptionalText(rootRecord?.readSessionId) ||
        view.readSessionId,
      lineageDepth: Math.max(view.lineageDepth, lineage.records.length - 1, 0),
      lineageBroken: Boolean(lineage.cycleDetected || lineage.missingParentId),
      lineageMissingParentId: lineage.missingParentId,
      expired: isReadSessionExpired(record, referenceTime),
      active: !reason,
      descendantSessionCount,
      remainingDelegationDepth: Math.max(0, Math.floor(toFiniteNumber(record?.maxDelegationDepth, 0))),
      lineage: includeLineageDetails ? lineageViews : [],
    },
  };
}

export function createReadSessionInStore(store, payload = {}, { appendEvent }) {
  const createdAt = now();
  const readSessionId = createRecordId("rdsess");
  const token = `${readSessionId}.${randomBytes(18).toString("hex")}`;
  const parentReadSessionId = normalizeOptionalText(payload.parentReadSessionId) ?? null;
  const lookup = buildReadSessionLookup(store);
  const parentReadSession = parentReadSessionId ? findReadSessionById(store, parentReadSessionId, lookup) : null;
  if (parentReadSessionId && !parentReadSession) {
    throw new Error(`Parent read session not found: ${parentReadSessionId}`);
  }
  if (parentReadSession) {
    const parentState = evaluateReadSessionState(store, parentReadSession, {
      includeLineageDetails: false,
      lookup,
    });
    if (!parentState.valid) {
      throw new Error(`Parent read session is not active: ${parentState.reason}`);
    }
  }

  const requestedRole = normalizeReadSessionRole(payload.role || payload.readSessionRole) ?? null;
  const rolePreset = getReadSessionRolePreset(requestedRole);
  if ((payload.role || payload.readSessionRole) && !rolePreset) {
    throw new Error(`Unsupported read session role: ${payload.role || payload.readSessionRole}`);
  }

  const requestedScopes =
    payload.scopes != null
      ? normalizeReadSessionScopes(payload.scopes)
      : rolePreset
        ? normalizeReadSessionScopes(rolePreset.scopes)
        : parentReadSession
          ? normalizeReadSessionScopes(parentReadSession.scopes)
          : normalizeReadSessionScopes(undefined);
  if (rolePreset && payload.scopes != null && !readSessionScopesAreSubset(requestedScopes, rolePreset.scopes)) {
    throw new Error(`Read session scopes must stay within the selected role preset: ${rolePreset.role}`);
  }
  if (parentReadSession && !readSessionScopesAreSubset(requestedScopes, parentReadSession.scopes)) {
    throw new Error("Child read session scopes must stay within the parent read session scope boundary");
  }

  const requestedResourceBindings =
    payload.resourceBindings != null ||
    payload.agentIds != null ||
    payload.windowIds != null ||
    payload.credentialIds != null
      ? normalizeReadSessionResourceBindings({
          ...(payload.resourceBindings || {}),
          agentIds: payload.agentIds,
          windowIds: payload.windowIds,
          credentialIds: payload.credentialIds,
        })
      : parentReadSession
        ? normalizeReadSessionResourceBindings(parentReadSession.resourceBindings)
        : normalizeReadSessionResourceBindings();
  if (
    parentReadSession &&
    !readSessionResourceBindingsAreSubset(
      requestedResourceBindings,
      parentReadSession.resourceBindings
    )
  ) {
    throw new Error("Child read session resources must stay within the parent read session resource boundary");
  }

  let ttlSeconds = Math.max(60, Math.floor(toFiniteNumber(payload.ttlSeconds, 60 * 60 * 8)));
  if (parentReadSession?.expiresAt) {
    const remainingParentSeconds = Math.max(
      1,
      Math.floor((new Date(parentReadSession.expiresAt).getTime() - new Date(createdAt).getTime()) / 1000)
    );
    ttlSeconds = Math.min(ttlSeconds, remainingParentSeconds);
  }

  const requestedCanDelegate =
    payload.canDelegate != null
      ? normalizeBooleanFlag(payload.canDelegate, false)
      : rolePreset?.canDelegate ?? false;
  let maxDelegationDepth = Math.max(
    0,
    Math.floor(
      toFiniteNumber(
        payload.maxDelegationDepth,
        requestedCanDelegate ? rolePreset?.maxDelegationDepth ?? 1 : 0
      )
    )
  );
  if (parentReadSession) {
    const parentCanDelegate = normalizeBooleanFlag(parentReadSession.canDelegate, false);
    const parentRemainingDelegationDepth = Math.max(
      0,
      Math.floor(toFiniteNumber(parentReadSession.maxDelegationDepth, 0)) - 1
    );
    if (!parentCanDelegate) {
      throw new Error("Parent read session is not allowed to delegate child sessions");
    }
    if (parentRemainingDelegationDepth < 0 || Math.floor(toFiniteNumber(parentReadSession.maxDelegationDepth, 0)) <= 0) {
      throw new Error("Parent read session delegation depth is exhausted");
    }
    if (requestedCanDelegate && parentRemainingDelegationDepth <= 0) {
      throw new Error("Child read session cannot keep delegation because parent delegation depth is exhausted");
    }
    maxDelegationDepth = requestedCanDelegate
      ? Math.min(maxDelegationDepth, parentRemainingDelegationDepth)
      : 0;
  }
  const canDelegate = requestedCanDelegate && maxDelegationDepth > 0;
  const requestedRedactionTemplate = normalizeReadSessionRedactionTemplate(
    payload.redactionTemplate,
    rolePreset?.redactionTemplate ??
      parentReadSession?.redactionTemplate ??
      "metadata_only"
  );
  const requestedViewTemplates =
    payload.viewTemplates != null ||
    payload.objectTemplates != null ||
    payload.fieldTemplates != null
      ? normalizeReadSessionViewTemplates(
          {
            ...(payload.viewTemplates || {}),
            ...(payload.objectTemplates || {}),
            ...(payload.fieldTemplates || {}),
          },
          rolePreset
            ? normalizeReadSessionViewTemplates(
                rolePreset.viewTemplates,
                buildDefaultReadSessionViewTemplates(requestedRedactionTemplate)
              )
            : parentReadSession
              ? normalizeReadSessionViewTemplates(
                  parentReadSession.viewTemplates,
                  buildDefaultReadSessionViewTemplates(parentReadSession.redactionTemplate)
                )
              : buildDefaultReadSessionViewTemplates(requestedRedactionTemplate)
        )
      : rolePreset
        ? normalizeReadSessionViewTemplates(
            rolePreset.viewTemplates,
            buildDefaultReadSessionViewTemplates(requestedRedactionTemplate)
          )
        : parentReadSession
          ? normalizeReadSessionViewTemplates(
              parentReadSession.viewTemplates,
              buildDefaultReadSessionViewTemplates(parentReadSession.redactionTemplate)
            )
          : buildDefaultReadSessionViewTemplates(requestedRedactionTemplate);

  if (
    rolePreset &&
    (payload.viewTemplates != null || payload.objectTemplates != null || payload.fieldTemplates != null) &&
    !readSessionViewTemplatesAreSubset(
      requestedViewTemplates,
      normalizeReadSessionViewTemplates(
        rolePreset.viewTemplates,
        buildDefaultReadSessionViewTemplates(requestedRedactionTemplate)
      )
    )
  ) {
    throw new Error(`Read session view templates must stay within the selected role preset: ${rolePreset.role}`);
  }
  if (
    parentReadSession &&
    !readSessionViewTemplatesAreSubset(
      requestedViewTemplates,
      normalizeReadSessionViewTemplates(
        parentReadSession.viewTemplates,
        buildDefaultReadSessionViewTemplates(parentReadSession.redactionTemplate)
      )
    )
  ) {
    throw new Error("Child read session view templates must stay within the parent read session boundary");
  }

  const record = {
    readSessionId,
    role: requestedRole,
    label: normalizeOptionalText(payload.label) ?? "read session",
    note: normalizeOptionalText(payload.note) ?? null,
    scopes: requestedScopes,
    redactionTemplate: requestedRedactionTemplate,
    tokenHash: hashAccessToken(token),
    createdAt,
    expiresAt: addSeconds(createdAt, ttlSeconds),
    revokedAt: null,
    parentReadSessionId,
    rootReadSessionId:
      normalizeOptionalText(parentReadSession?.rootReadSessionId) ??
      normalizeOptionalText(parentReadSession?.readSessionId) ??
      readSessionId,
    lineageDepth: parentReadSession ? Math.max(0, Math.floor(toFiniteNumber(parentReadSession.lineageDepth, 0))) + 1 : 0,
    canDelegate,
    maxDelegationDepth,
    createdByAgentId: normalizeOptionalText(payload.createdByAgentId) ?? null,
    createdByReadSessionId: normalizeOptionalText(payload.createdByReadSessionId) ?? null,
    createdByWindowId: normalizeOptionalText(payload.createdByWindowId) ?? null,
    lastValidatedAt: null,
    viewTemplates: requestedViewTemplates,
    resourceBindings: requestedResourceBindings,
  };

  if (!Array.isArray(store.readSessions)) {
    store.readSessions = [];
  }
  store.readSessions.push(record);
  appendEvent(store, "read_session_created", {
    readSessionId,
    scopes: [...record.scopes],
    redactionTemplate: record.redactionTemplate,
    expiresAt: record.expiresAt,
    parentReadSessionId: record.parentReadSessionId,
    rootReadSessionId: record.rootReadSessionId,
    lineageDepth: record.lineageDepth,
    role: record.role,
    canDelegate: record.canDelegate,
    maxDelegationDepth: record.maxDelegationDepth,
    viewTemplates: cloneJson(record.viewTemplates),
    resourceBindings: cloneJson(record.resourceBindings),
    createdByAgentId: record.createdByAgentId,
    createdByReadSessionId: record.createdByReadSessionId,
    createdByWindowId: record.createdByWindowId,
  });

  return {
    token,
    session: evaluateReadSessionState(store, record, {
      includeLineageDetails: false,
      lookup: buildReadSessionLookup(store),
    }).session,
  };
}

export function listReadSessionsInStore(store, { includeExpired = true, includeRevoked = true } = {}) {
  const lookup = buildReadSessionLookup(store);
  const referenceTime = now();
  const sessions = [];

  for (const record of lookup.records) {
    const state = evaluateReadSessionState(store, record, {
      referenceTime,
      lookup,
    });
    if (!state.session) {
      continue;
    }
    if (!includeRevoked && (normalizeOptionalText(record?.revokedAt) || state.reason === "ancestor_session_revoked")) {
      continue;
    }
    if (!includeExpired && (isReadSessionExpired(record, referenceTime) || state.reason === "ancestor_session_expired")) {
      continue;
    }
    sessions.push(state.session);
  }

  sessions.sort((left, right) => String(right?.createdAt || "").localeCompare(String(left?.createdAt || "")));

  return {
    count: sessions.length,
    sessions,
  };
}

export function countReadSessionsInStore(store, { includeExpired = true, includeRevoked = true } = {}) {
  const referenceTime = now();
  const lookup = buildReadSessionLookup(store);
  let count = 0;
  let activeCount = 0;

  for (const record of lookup.records) {
    const state = evaluateReadSessionState(store, record, {
      includeLineageDetails: false,
      referenceTime,
      lookup,
    });
    if (!state.session) {
      continue;
    }
    if (!includeRevoked && (normalizeOptionalText(record?.revokedAt) || state.reason === "ancestor_session_revoked")) {
      continue;
    }
    if (!includeExpired && (isReadSessionExpired(record, referenceTime) || state.reason === "ancestor_session_expired")) {
      continue;
    }
    count += 1;
    if (!state.reason) {
      activeCount += 1;
    }
  }

  return {
    count,
    activeCount,
  };
}

export function revokeReadSessionInStore(store, readSessionId, payload = {}, { appendEvent }) {
  const session = (Array.isArray(store.readSessions) ? store.readSessions : []).find(
    (record) => record?.readSessionId === readSessionId
  );
  if (!session) {
    throw new Error(`Read session not found: ${readSessionId}`);
  }
  const lookup = buildReadSessionLookup(store);
  const revokedAt = now();
  session.revokedAt = revokedAt;
  session.revokedByAgentId = normalizeOptionalText(payload.revokedByAgentId) ?? null;
  session.revokedByReadSessionId = normalizeOptionalText(payload.revokedByReadSessionId) ?? null;
  session.revokedByWindowId = normalizeOptionalText(payload.revokedByWindowId) ?? null;
  session.revokedByAncestorReadSessionId = null;
  session.revocationCascadeRootReadSessionId = normalizeOptionalText(session.readSessionId) ?? null;
  const descendants = collectReadSessionDescendants(store, readSessionId, lookup);
  for (const descendant of descendants) {
    if (normalizeOptionalText(descendant?.revokedAt)) {
      continue;
    }
    descendant.revokedAt = revokedAt;
    descendant.revokedByAgentId = session.revokedByAgentId;
    descendant.revokedByReadSessionId = session.revokedByReadSessionId;
    descendant.revokedByWindowId = session.revokedByWindowId;
    descendant.revokedByAncestorReadSessionId = normalizeOptionalText(session.readSessionId) ?? null;
    descendant.revocationCascadeRootReadSessionId = normalizeOptionalText(session.readSessionId) ?? null;
  }
  const invalidatesDescendantSessionCount = descendants.length;
  appendEvent(store, "read_session_revoked", {
    readSessionId,
    revokedByAgentId: session.revokedByAgentId,
    revokedByReadSessionId: session.revokedByReadSessionId,
    revokedByWindowId: session.revokedByWindowId,
    invalidatesDescendantSessionCount,
    invalidatedDescendantSessionIds: descendants
      .map((record) => normalizeOptionalText(record?.readSessionId))
      .filter(Boolean),
  });

  return {
    invalidatesDescendantSessionCount,
    session: evaluateReadSessionState(store, session, {
      includeLineageDetails: false,
      lookup,
    }).session,
  };
}

export function revokeAllReadSessionsInStore(store, payload = {}, { appendEvent }) {
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const targetStore = dryRun ? cloneJson(store) : store;
  if (!Array.isArray(targetStore.readSessions)) {
    targetStore.readSessions = [];
  }
  const revokedAt = now();
  let revokedCount = 0;
  const affectedSessionIds = [];
  for (const session of targetStore.readSessions) {
    if (normalizeOptionalText(session?.revokedAt)) {
      continue;
    }
    session.revokedAt = revokedAt;
    session.revokedByAgentId = normalizeOptionalText(payload.revokedByAgentId) ?? null;
    session.revokedByReadSessionId = normalizeOptionalText(payload.revokedByReadSessionId) ?? null;
    session.revokedByWindowId = normalizeOptionalText(payload.revokedByWindowId) ?? null;
    revokedCount += 1;
    affectedSessionIds.push(normalizeOptionalText(session.readSessionId));
  }
  appendEvent(targetStore, "read_sessions_revoked_all", {
    dryRun,
    revokedCount,
    revokedByAgentId: normalizeOptionalText(payload.revokedByAgentId) ?? null,
    revokedByReadSessionId: normalizeOptionalText(payload.revokedByReadSessionId) ?? null,
    revokedByWindowId: normalizeOptionalText(payload.revokedByWindowId) ?? null,
    note: normalizeOptionalText(payload.note) ?? null,
  });

  return {
    dryRun,
    revokedAt,
    revokedCount,
    sessions: targetStore.readSessions
      .filter((record) => affectedSessionIds.includes(normalizeOptionalText(record?.readSessionId)))
      .map((record) => evaluateReadSessionState(targetStore, record).session),
  };
}

export function validateReadSessionTokenInStore(
  store,
  token,
  { scope = null, touchValidatedAt = false, validatedAt = now() } = {}
) {
  const normalizedToken = normalizeOptionalText(token);
  const normalizedScope = normalizeReadSessionScope(scope);
  if (!normalizedToken || !normalizedScope) {
    return {
      valid: false,
      reason: !normalizedToken ? "missing_token" : "invalid_scope",
      session: null,
      touched: false,
      shouldTouchValidation: false,
    };
  }

  const lookup = buildReadSessionLookup(store);
  const session = findReadSessionByTokenHash(store, hashAccessToken(normalizedToken), lookup);
  if (!session) {
    return {
      valid: false,
      reason: "session_not_found",
      session: null,
      touched: false,
      shouldTouchValidation: false,
    };
  }
  const state = evaluateReadSessionState(store, session, {
    scope: normalizedScope,
    includeLineageDetails: false,
    lookup,
  });
  if (!state.valid) {
    return {
      valid: false,
      reason: state.reason,
      session: state.session,
      touched: false,
      shouldTouchValidation: false,
    };
  }
  const shouldTouchValidation = shouldTouchReadSessionValidation(session, validatedAt);
  const touched = touchValidatedAt && shouldTouchValidation;
  if (touched) {
    session.lastValidatedAt = validatedAt;
  }

  return {
    valid: true,
    reason: null,
    session: touched
      ? evaluateReadSessionState(store, session, {
          scope: normalizedScope,
          includeLineageDetails: false,
          lookup,
        }).session
      : state.session,
    touched,
    shouldTouchValidation,
  };
}

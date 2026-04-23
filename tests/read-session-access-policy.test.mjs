import assert from "node:assert/strict";
import test from "node:test";

import {
  createReadSessionInStore,
  normalizeReadSessionResourceBindings,
  revokeAllReadSessionsInStore,
  validateReadSessionTokenInStore,
} from "../src/ledger-read-sessions.js";
import {
  isPublicApiPath,
  isAdminOnlyApiPath,
  isExecutionApiPath,
  isSecurityMaintenanceWritePath,
  SECURITY_ADMIN_ONLY_PATHS,
  SECURITY_MAINTENANCE_WRITE_PATHS,
  SECURITY_READ_SCOPE_PATHS,
  requiresApiReadToken,
  requiresApiWriteToken,
  resolveApiReadScopes,
} from "../src/server-route-policy.js";
import {
  agentMatchesReadSession,
  credentialMatchesReadSession,
  denyReadSessionResource,
  statusListMatchesReadSession,
  windowMatchesReadSession,
} from "../src/server-read-access.js";
import {
  redactAuthorizationViewForReadSession,
  redactCredentialExportForReadSession,
  redactCredentialStatusForReadSession,
  redactStatusListComparisonForReadSession,
  redactStatusListDetailForReadSession,
} from "../src/server-agent-redaction.js";
import { redactOfflineChatReadSessionPayload } from "../src/server-offline-chat-routes.js";

function createStore() {
  return {
    readSessions: [],
    events: [],
  };
}

function appendEvent(store, type, payload) {
  if (!Array.isArray(store.events)) {
    store.events = [];
  }
  store.events.push({ type, payload });
}

function createJsonResponseCapture() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = "") {
      this.body += String(chunk || "");
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

test("resource matchers allow admin, constrain read sessions, and deny missing protected access", () => {
  const adminAccess = { mode: "admin" };
  const runtimeObserverAccess = {
    mode: "read_session",
    session: {
      resourceBindings: {
        agentIds: ["agent_openneed_agents"],
      },
    },
  };
  const missingAccess = { mode: "none" };

  assert.equal(agentMatchesReadSession(adminAccess, { agentId: "agent_other" }), true);
  assert.equal(agentMatchesReadSession(runtimeObserverAccess, { agentId: "agent_openneed_agents" }), true);
  assert.equal(agentMatchesReadSession(runtimeObserverAccess, { agentId: "agent_other" }), false);
  assert.equal(agentMatchesReadSession(missingAccess, { agentId: "agent_openneed_agents" }), false);

  const credentialRecord = {
    credentialRecordId: "cred_1",
    agentId: "agent_openneed_agents",
  };
  assert.equal(credentialMatchesReadSession(adminAccess, credentialRecord), true);
  assert.equal(credentialMatchesReadSession(runtimeObserverAccess, credentialRecord), true);
  assert.equal(credentialMatchesReadSession(missingAccess, credentialRecord), false);
});

test("credential read sessions honor window bindings instead of widening the read surface", () => {
  const windowBoundAccess = {
    mode: "read_session",
    session: {
      resourceBindings: {
        windowIds: ["window_runtime"],
      },
    },
  };

  assert.equal(
    credentialMatchesReadSession(windowBoundAccess, {
      credentialRecordId: "cred_1",
      issuedByWindowId: "window_runtime",
    }),
    true
  );
  assert.equal(
    credentialMatchesReadSession(windowBoundAccess, {
      credentialRecordId: "cred_2",
      issuedByWindowId: "window_other",
    }),
    false
  );
  assert.equal(
    credentialMatchesReadSession(windowBoundAccess, {
      credentialRecordId: "cred_3",
      agentId: "agent_openneed_agents",
    }),
    false
  );
});

test("window read sessions keep window and agent bindings conjunctive", () => {
  const windowOnlyAccess = {
    mode: "read_session",
    session: {
      resourceBindings: {
        windowIds: ["window_runtime"],
      },
    },
  };
  const agentOnlyAccess = {
    mode: "read_session",
    session: {
      resourceBindings: {
        agentIds: ["agent_openneed_agents"],
      },
    },
  };
  const windowAndAgentAccess = {
    mode: "read_session",
    session: {
      resourceBindings: {
        windowIds: ["window_runtime"],
        agentIds: ["agent_openneed_agents"],
      },
    },
  };

  assert.equal(
    windowMatchesReadSession(windowOnlyAccess, {
      windowId: "window_runtime",
      agentId: "agent_other",
    }),
    true
  );
  assert.equal(
    windowMatchesReadSession(agentOnlyAccess, {
      windowId: "window_other",
      agentId: "agent_openneed_agents",
    }),
    true
  );
  assert.equal(
    windowMatchesReadSession(windowAndAgentAccess, {
      windowId: "window_runtime",
      agentId: "agent_openneed_agents",
    }),
    true
  );
  assert.equal(
    windowMatchesReadSession(windowAndAgentAccess, {
      windowId: "window_runtime",
      agentId: "agent_other",
    }),
    false
  );
  assert.equal(
    windowMatchesReadSession(windowAndAgentAccess, {
      windowId: "window_other",
      agentId: "agent_openneed_agents",
    }),
    false
  );
});

test("scoped read sessions without concrete resource bindings do not become wildcard readers", () => {
  const unboundAccess = {
    mode: "read_session",
    session: {
      role: "agent_auditor",
      resourceBindings: {},
    },
  };
  const allReadAccess = {
    mode: "read_session",
    session: {
      role: "all_read",
      resourceBindings: {},
    },
  };

  assert.equal(agentMatchesReadSession(unboundAccess, { agentId: "agent_openneed_agents" }), false);
  assert.equal(windowMatchesReadSession(unboundAccess, { windowId: "window_1", agentId: "agent_openneed_agents" }), false);
  assert.equal(credentialMatchesReadSession(unboundAccess, { credentialRecordId: "cred_1" }), false);
  assert.equal(statusListMatchesReadSession(unboundAccess, { summary: { issuerAgentId: "agent_openneed_agents" } }), false);

  assert.equal(agentMatchesReadSession(allReadAccess, { agentId: "agent_openneed_agents" }), true);
  assert.equal(credentialMatchesReadSession(allReadAccess, { credentialRecordId: "cred_1" }), true);
});

test("read session resource bindings only trust canonical nested bindings", () => {
  assert.deepEqual(
    normalizeReadSessionResourceBindings({
      boundAgentIds: ["agent_spoofed"],
      allowedWindowIds: ["window_spoofed"],
      boundCredentialIds: ["cred_spoofed"],
    }),
    {
      agentIds: [],
      windowIds: [],
      credentialIds: [],
    }
  );

  const store = createStore();
  const parent = createReadSessionInStore(store, {
    role: "security_delegate",
    agentIds: ["agent_openneed_agents"],
    ttlSeconds: 600,
  }, { appendEvent });
  store.readSessions[0].allowedAgentIds = ["agent_spoofed"];

  const child = createReadSessionInStore(store, {
    parentReadSessionId: parent.session.readSessionId,
    ttlSeconds: 300,
  }, { appendEvent });
  assert.deepEqual(child.session.resourceBindings.agentIds, ["agent_openneed_agents"]);

  assert.throws(
    () => createReadSessionInStore(store, {
      parentReadSessionId: parent.session.readSessionId,
      resourceBindings: {
        boundAgentIds: ["agent_spoofed"],
      },
      ttlSeconds: 300,
    }, { appendEvent }),
    /resource boundary/
  );
});

test("credential-bound read sessions do not widen into whole status lists", () => {
  const credentialBoundAccess = {
    mode: "read_session",
    session: {
      resourceBindings: {
        credentialIds: ["cred_1"],
      },
    },
  };
  const agentBoundAccess = {
    mode: "read_session",
    session: {
      resourceBindings: {
        agentIds: ["agent_openneed_agents"],
      },
    },
  };
  const statusList = {
    summary: {
      issuerAgentId: "agent_openneed_agents",
    },
    entries: [
      { credentialRecordId: "cred_1", status: "active" },
      { credentialRecordId: "cred_2", status: "revoked" },
    ],
  };

  assert.equal(statusListMatchesReadSession(credentialBoundAccess, statusList), false);
  assert.equal(statusListMatchesReadSession(agentBoundAccess, statusList), true);
});

test("credential status redaction keeps embedded status-list entries credential-local", () => {
  const redacted = redactCredentialStatusForReadSession({
    credentialRecordId: "cred_1",
    credentialId: "credential_1",
    statusEntry: {
      credentialRecordId: "cred_1",
      status: "active",
    },
    statusList: {
      summary: {
        statusListId: "status_list_1",
      },
      entries: [
        { credentialRecordId: "cred_1", status: "active" },
        { credentialRecordId: "cred_2", status: "revoked" },
      ],
    },
  });

  assert.deepEqual(
    redacted.statusList.entries.map((entry) => entry.credentialRecordId),
    ["cred_1"]
  );
});

test("read-session redaction collapses sibling credentials, authorization entries, and status-list entries", () => {
  const credentialExport = redactCredentialExportForReadSession({
    credentialRecord: {
      credentialRecordId: "cred_1",
      siblingMethods: ["did:key"],
      repairHistory: [{ repairId: "repair_1" }],
    },
    credential: {
      id: "vc_1",
      proof: { proofValue: "secret" },
    },
    alternates: [
      {
        credentialRecord: { credentialRecordId: "cred_2" },
        credential: { id: "vc_2" },
      },
    ],
  });
  assert.equal(credentialExport.alternateCount, 1);
  assert.deepEqual(credentialExport.alternates, []);
  assert.equal(credentialExport.alternatesRedacted, true);
  assert.deepEqual(credentialExport.credentialRecord.siblingMethods, []);
  assert.equal(credentialExport.credentialRecord.siblingMethodsCount, 1);

  const authorization = redactAuthorizationViewForReadSession({
    proposalId: "prop_1",
    policyAgentId: "agent_openneed_agents",
    actionType: "runtime_execute",
    title: "Approve secret action",
    payload: { secret: "value" },
    approvals: [{ agentId: "agent_1" }],
    signatureRecords: [{ signerAgentId: "agent_1" }],
    timeline: [{ event: "created" }],
    relatedAgentIds: ["agent_1", "agent_2"],
  });
  assert.equal(authorization.approvalCount, 1);
  assert.equal(authorization.signatureRecordCount, 1);
  assert.equal(authorization.timelineCount, 1);
  assert.deepEqual(authorization.approvals, []);
  assert.deepEqual(authorization.signatureRecords, []);
  assert.deepEqual(authorization.timeline, []);
  assert.equal(authorization.payloadRedacted, true);

  const statusList = redactStatusListDetailForReadSession({
    statusListId: "status_list_1",
    summary: { statusListId: "status_list_1", totalEntries: 2 },
    entries: [
      { credentialRecordId: "cred_1", status: "active" },
      { credentialRecordId: "cred_2", status: "revoked" },
    ],
  });
  assert.equal(statusList.entryCount, 2);
  assert.deepEqual(statusList.entries, []);
  assert.equal(statusList.entriesRedacted, true);

  const comparison = redactStatusListComparisonForReadSession({
    comparison: {
      leftEntrySummary: [{ credentialRecordId: "cred_1" }],
      rightEntrySummary: [{ credentialRecordId: "cred_2" }],
      sharedEntrySummary: [{ credentialRecordId: "cred_3" }],
      leftOnlyEntrySummary: [{ credentialRecordId: "cred_4" }],
      rightOnlyEntrySummary: [{ credentialRecordId: "cred_5" }],
    },
  });
  assert.deepEqual(comparison.comparison.leftEntrySummary, []);
  assert.equal(comparison.comparison.leftEntrySummaryCount, 1);
  assert.equal(comparison.comparison.rightOnlyEntrySummaryRedacted, true);
});

test("route policy keeps device setup dual-scope and agent runtime search narrow-scope", () => {
  assert.deepEqual(
    resolveApiReadScopes("/api/device/setup/packages", ["api", "device", "setup", "packages"]),
    ["device_runtime", "recovery"]
  );
  assert.deepEqual(
    resolveApiReadScopes("/api/device/setup/package", ["api", "device", "setup", "package"]),
    ["device_runtime", "recovery"]
  );
  assert.deepEqual(
    resolveApiReadScopes(
      "/api/agents/agent_openneed_agents/runtime/search",
      ["api", "agents", "agent_openneed_agents", "runtime", "search"]
    ),
    ["agents_runtime_search"]
  );
  assert.deepEqual(
    resolveApiReadScopes(
      "/api/agents/agent_openneed_agents/runtime/stability",
      ["api", "agents", "agent_openneed_agents", "runtime", "stability"]
    ),
    ["agents_runtime"]
  );
});

test("route policy keeps delegated read-session creation narrow and revocation admin-only", () => {
  assert.equal(isAdminOnlyApiPath("/api/security/read-sessions", "GET"), true);
  assert.equal(isAdminOnlyApiPath("/api/security/read-sessions", "POST"), false);
  assert.equal(isAdminOnlyApiPath("/api/security/read-sessions/revoke-all", "POST"), true);
  assert.equal(isAdminOnlyApiPath("/api/security/read-sessions/session_1/revoke", "POST"), true);

  assert.equal(isSecurityMaintenanceWritePath("/api/security/read-sessions", "POST"), true);
  assert.equal(isSecurityMaintenanceWritePath("/api/security/read-sessions/revoke-all", "POST"), true);
  assert.equal(isSecurityMaintenanceWritePath("/api/security/read-sessions/session_1/revoke", "POST"), true);
  assert.equal(isSecurityMaintenanceWritePath("/api/security/read-sessions", "GET"), false);
});

test("read-session denial response carries stable machine-readable error class", () => {
  const res = createJsonResponseCapture();
  denyReadSessionResource(res, "credential", "credential_1");

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), {
    errorClass: "read_session_resource_denied",
    error: "Read session is not allowed to access this credential",
    resource: {
      kind: "credential",
      value: "credential_1",
    },
  });
});

test("security route policy tables stay shared across admin, read-scope, and maintenance decisions", () => {
  for (const pathname of SECURITY_ADMIN_ONLY_PATHS) {
    assert.equal(isAdminOnlyApiPath(pathname, "GET"), true, pathname);
  }

  for (const pathname of SECURITY_READ_SCOPE_PATHS) {
    assert.deepEqual(resolveApiReadScopes(pathname, ["api", "security"]), ["security"], pathname);
  }

  for (const pathname of SECURITY_MAINTENANCE_WRITE_PATHS) {
    assert.equal(isSecurityMaintenanceWritePath(pathname, "POST"), true, pathname);
    assert.equal(isSecurityMaintenanceWritePath(pathname, "GET"), false, `GET ${pathname}`);
  }

  assert.equal(isAdminOnlyApiPath("/api/security/read-sessions", "POST"), false);
  assert.equal(isAdminOnlyApiPath("/api/security/read-sessions/revoke-all", "POST"), true);
  assert.equal(isSecurityMaintenanceWritePath("/api/security/read-sessions/session_1/revoke", "POST"), true);
});

test("route policy keeps offline chat truth behind protected read", () => {
  const getReq = { method: "GET" };

  assert.equal(isPublicApiPath("/api/offline-chat/bootstrap"), false);
  assert.equal(isPublicApiPath("/api/offline-chat/thread-startup-context"), false);
  assert.equal(requiresApiReadToken(getReq, "/api/offline-chat/bootstrap"), true);
  assert.equal(requiresApiReadToken(getReq, "/api/offline-chat/thread-startup-context"), true);
  assert.equal(requiresApiReadToken(getReq, "/api/offline-chat/sync/status"), true);
  assert.equal(requiresApiReadToken(getReq, "/api/offline-chat/threads/group/messages"), true);
  assert.deepEqual(resolveApiReadScopes("/api/offline-chat/bootstrap", ["api", "offline-chat", "bootstrap"]), ["offline_chat"]);
  assert.deepEqual(
    resolveApiReadScopes("/api/offline-chat/threads/group/messages", [
      "api",
      "offline-chat",
      "threads",
      "group",
      "messages",
    ]),
    ["offline_chat"]
  );
});

test("offline chat read sessions redact conversation content but keep route metadata", () => {
  const payload = {
    threadId: "group",
    threadView: {
      threadId: "group",
      startupSignature: "startup_1",
      context: {
        summaryLines: ["最近对话：用户说了敏感内容"],
      },
    },
    threadStartup: {
      phaseKey: "phase_1",
      startupSignature: "startup_1",
      parallelSubagentPolicy: {
        maxConcurrentSubagents: 4,
      },
    },
    messages: [
      {
        role: "user",
        content: "我的私密输入",
        source: {
          provider: "local",
        },
      },
    ],
    sourceSummary: {
      filteredMessages: 1,
      summary: "包含私密输入",
    },
  };

  const redacted = redactOfflineChatReadSessionPayload(payload, {
    mode: "read_session",
    session: {
      redactionTemplate: "metadata_only",
    },
  });

  assert.equal(redacted.threadId, "group");
  assert.equal(redacted.threadStartup.phaseKey, "phase_1");
  assert.equal(redacted.threadStartup.parallelSubagentPolicy.maxConcurrentSubagents, 4);
  assert.equal(redacted.messages[0].content, "[redacted:offline-chat-read-session]");
  assert.equal(redacted.threadView.context.summaryLines[0], "[redacted:offline-chat-read-session]");
  assert.equal(redacted.sourceSummary.summary, "[redacted:offline-chat-read-session]");
  assert.equal(payload.messages[0].content, "我的私密输入");
});

test("public API paths stay public for reads but never become public writes", () => {
  assert.equal(isPublicApiPath("/api/security"), true);
  assert.equal(requiresApiReadToken({ method: "GET" }, "/api/security"), false);
  assert.equal(requiresApiReadToken({ method: "HEAD" }, "/api/security"), false);
  assert.equal(requiresApiWriteToken({ method: "OPTIONS" }, "/api/security"), false);
  assert.equal(requiresApiWriteToken({ method: "POST" }, "/api/security"), true);
  assert.equal(requiresApiWriteToken({ method: "POST" }, "/api/health"), true);
});

test("execution path policy covers real execution entrypoints and excludes diagnostic-only flows", () => {
  const executionCases = [
    {
      path: "/api/device/runtime/model-profiles/profile",
      segments: ["api", "device", "runtime", "model-profiles", "profile"],
    },
    {
      path: "/api/device/setup",
      segments: ["api", "device", "setup"],
    },
    {
      path: "/api/device/runtime",
      segments: ["api", "device", "runtime"],
    },
    {
      path: "/api/device/setup/packages",
      segments: ["api", "device", "setup", "packages"],
    },
    {
      path: "/api/device/setup/package",
      segments: ["api", "device", "setup", "package"],
    },
    {
      path: "/api/device/setup/packages/pkg_1/delete",
      segments: ["api", "device", "setup", "packages", "pkg_1", "delete"],
    },
    {
      path: "/api/device/setup/package/import",
      segments: ["api", "device", "setup", "package", "import"],
    },
    {
      path: "/api/device/runtime/recovery/import",
      segments: ["api", "device", "runtime", "recovery", "import"],
    },
    {
      path: "/api/device/runtime/recovery/verify",
      segments: ["api", "device", "runtime", "recovery", "verify"],
    },
    {
      path: "/api/device/runtime/recovery",
      segments: ["api", "device", "runtime", "recovery"],
    },
    {
      path: "/api/device/runtime/local-reasoner/select",
      segments: ["api", "device", "runtime", "local-reasoner", "select"],
    },
    {
      path: "/api/device/runtime/local-reasoner/probe",
      segments: ["api", "device", "runtime", "local-reasoner", "probe"],
    },
    {
      path: "/api/device/runtime/local-reasoner/prewarm",
      segments: ["api", "device", "runtime", "local-reasoner", "prewarm"],
    },
    {
      path: "/api/device/runtime/local-reasoner/migrate-default",
      segments: ["api", "device", "runtime", "local-reasoner", "migrate-default"],
    },
    {
      path: "/api/device/runtime/local-reasoner/restore",
      segments: ["api", "device", "runtime", "local-reasoner", "restore"],
    },
    {
      path: "/api/device/runtime/local-reasoner/profiles",
      segments: ["api", "device", "runtime", "local-reasoner", "profiles"],
    },
    {
      path: "/api/device/runtime/local-reasoner/profiles/profile_1/activate",
      segments: ["api", "device", "runtime", "local-reasoner", "profiles", "profile_1", "activate"],
    },
    {
      path: "/api/device/runtime/local-reasoner/profiles/profile_1/delete",
      segments: ["api", "device", "runtime", "local-reasoner", "profiles", "profile_1", "delete"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runner",
      segments: ["api", "agents", "agent_openneed_agents", "runner"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime/actions",
      segments: ["api", "agents", "agent_openneed_agents", "runtime", "actions"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime/stability",
      segments: ["api", "agents", "agent_openneed_agents", "runtime", "stability"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime/snapshot",
      segments: ["api", "agents", "agent_openneed_agents", "runtime", "snapshot"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime/decisions",
      segments: ["api", "agents", "agent_openneed_agents", "runtime", "decisions"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime/evidence",
      segments: ["api", "agents", "agent_openneed_agents", "runtime", "evidence"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime/minutes",
      segments: ["api", "agents", "agent_openneed_agents", "runtime", "minutes"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime/bootstrap",
      segments: ["api", "agents", "agent_openneed_agents", "runtime", "bootstrap"],
    },
    {
      path: "/api/agents/compare/migration/repair",
      segments: ["api", "agents", "compare", "migration", "repair"],
    },
    {
      path: "/api/agents/agent_openneed_agents/migration/repair",
      segments: ["api", "agents", "agent_openneed_agents", "migration", "repair"],
    },
    {
      path: "/api/authorizations/auth_1/sign",
      segments: ["api", "authorizations", "auth_1", "sign"],
    },
    {
      path: "/api/authorizations/auth_1/execute",
      segments: ["api", "authorizations", "auth_1", "execute"],
    },
    {
      path: "/api/authorizations",
      segments: ["api", "authorizations"],
    },
    {
      path: "/api/authorizations/auth_1/revoke",
      segments: ["api", "authorizations", "auth_1", "revoke"],
    },
    {
      path: "/api/credentials/cred_1/revoke",
      segments: ["api", "credentials", "cred_1", "revoke"],
    },
    {
      path: "/api/offline-chat/threads/group/messages",
      segments: ["api", "offline-chat", "threads", "group", "messages"],
    },
    {
      path: "/api/offline-chat/sync/flush",
      segments: ["api", "offline-chat", "sync", "flush"],
    },
    {
      path: "/api/agents/agent_openneed_agents/verification-runs",
      segments: ["api", "agents", "agent_openneed_agents", "verification-runs"],
    },
    {
      path: "/api/agents/agent_openneed_agents/offline-replay",
      segments: ["api", "agents", "agent_openneed_agents", "offline-replay"],
    },
    {
      path: "/api/agents/agent_openneed_agents/memories",
      segments: ["api", "agents", "agent_openneed_agents", "memories"],
    },
    {
      path: "/api/agents/agent_openneed_agents/passport-memory",
      segments: ["api", "agents", "agent_openneed_agents", "passport-memory"],
    },
    {
      path: "/api/agents/agent_openneed_agents/memory-compactor",
      segments: ["api", "agents", "agent_openneed_agents", "memory-compactor"],
    },
    {
      path: "/api/agents/agent_openneed_agents/archives/restore",
      segments: ["api", "agents", "agent_openneed_agents", "archives", "restore"],
    },
    {
      path: "/api/agents/agent_openneed_agents/archive-restores/revert",
      segments: ["api", "agents", "agent_openneed_agents", "archive-restores", "revert"],
    },
    {
      path: "/api/agents/agent_openneed_agents/messages",
      segments: ["api", "agents", "agent_openneed_agents", "messages"],
    },
    {
      path: "/api/agents/agent_openneed_agents/policy",
      segments: ["api", "agents", "agent_openneed_agents", "policy"],
      method: "PATCH",
    },
    {
      path: "/api/agents/agent_openneed_agents/fork",
      segments: ["api", "agents", "agent_openneed_agents", "fork"],
    },
    {
      path: "/api/agents/agent_openneed_agents/grants",
      segments: ["api", "agents", "agent_openneed_agents", "grants"],
    },
    {
      path: "/api/agents/compare/evidence",
      segments: ["api", "agents", "compare", "evidence"],
    },
    {
      path: "/api/windows/link",
      segments: ["api", "windows", "link"],
    },
  ];

  for (const entry of executionCases) {
    assert.equal(isExecutionApiPath(entry.path, entry.segments, entry.method || "POST"), true, entry.path);
  }

  const nonExecutionCases = [
    {
      path: "/api/offline-chat/bootstrap",
      segments: ["api", "offline-chat", "bootstrap"],
      method: "GET",
    },
    {
      path: "/api/offline-chat/thread-startup-context",
      segments: ["api", "offline-chat", "thread-startup-context"],
      method: "GET",
    },
    {
      path: "/api/agents/agent_openneed_agents/runner",
      segments: ["api", "agents", "agent_openneed_agents", "runner"],
      method: "GET",
    },
    {
      path: "/api/agents/compare/verify",
      segments: ["api", "agents", "compare", "verify"],
      method: "POST",
    },
    {
      path: "/api/credentials/verify",
      segments: ["api", "credentials", "verify"],
      method: "POST",
    },
    {
      path: "/api/agents/agent_openneed_agents/context-builder",
      segments: ["api", "agents", "agent_openneed_agents", "context-builder"],
      method: "POST",
    },
    {
      path: "/api/agents/agent_openneed_agents/response-verify",
      segments: ["api", "agents", "agent_openneed_agents", "response-verify"],
      method: "POST",
    },
    {
      path: "/api/agents/agent_openneed_agents/verification-runs",
      segments: ["api", "agents", "agent_openneed_agents", "verification-runs"],
      method: "GET",
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime/drift-check",
      segments: ["api", "agents", "agent_openneed_agents", "runtime", "drift-check"],
      method: "POST",
    },
  ];

  for (const entry of nonExecutionCases) {
    assert.equal(isExecutionApiPath(entry.path, entry.segments, entry.method), false, entry.path);
  }
});

test("security maintenance write policy stays narrow to posture and incident controls", () => {
  const maintenanceCases = [...SECURITY_MAINTENANCE_WRITE_PATHS, "/api/security/read-sessions/session_1/revoke"];
  for (const path of maintenanceCases) {
    assert.equal(isSecurityMaintenanceWritePath(path, "POST"), true, path);
    assert.equal(isSecurityMaintenanceWritePath(path, "GET"), false, `GET ${path}`);
  }

  const nonMaintenanceCases = [
    "/api/device/setup",
    "/api/device/runtime/recovery",
    "/api/agents/agent_openneed_agents/runtime/actions",
    "/api/security/read-sessions/session_1",
    "/api/security/read-sessions/session_1/typo",
    "/api/security/read-sessions/session_1/revoke/extra",
  ];
  for (const path of nonMaintenanceCases) {
    assert.equal(isSecurityMaintenanceWritePath(path, "POST"), false, path);
  }
});

test("route policy covers representative sensitive GET route families", () => {
  const cases = [
    {
      path: "/api/agents/resolve",
      segments: ["api", "agents", "resolve"],
      scopes: ["agents_identity"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime-summary",
      segments: ["api", "agents", "agent_openneed_agents", "runtime-summary"],
      scopes: ["agents_runtime"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime/minutes",
      segments: ["api", "agents", "agent_openneed_agents", "runtime", "minutes"],
      scopes: ["agents_runtime_minutes"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime/actions",
      segments: ["api", "agents", "agent_openneed_agents", "runtime", "actions"],
      scopes: ["agents_runtime_actions"],
    },
    {
      path: "/api/agents/agent_openneed_agents/runtime/rehydrate",
      segments: ["api", "agents", "agent_openneed_agents", "runtime", "rehydrate"],
      scopes: ["agents_rehydrate"],
    },
    {
      path: "/api/agents/agent_openneed_agents/archives",
      segments: ["api", "agents", "agent_openneed_agents", "archives"],
      scopes: ["agents_memories"],
    },
    {
      path: "/api/agents/agent_openneed_agents/archive-restores",
      segments: ["api", "agents", "agent_openneed_agents", "archive-restores"],
      scopes: ["agents_memories"],
    },
    {
      path: "/api/device/runtime/model-profiles",
      segments: ["api", "device", "runtime", "model-profiles"],
      scopes: ["device_runtime"],
    },
    {
      path: "/api/device/runtime/local-reasoner/catalog",
      segments: ["api", "device", "runtime", "local-reasoner", "catalog"],
      scopes: ["device_runtime"],
    },
    {
      path: "/api/device/runtime/recovery/rehearsals",
      segments: ["api", "device", "runtime", "recovery", "rehearsals"],
      scopes: ["recovery"],
    },
    {
      path: "/api/device/setup/packages/pkg_1",
      segments: ["api", "device", "setup", "packages", "pkg_1"],
      scopes: ["device_runtime", "recovery"],
    },
    {
      path: "/api/security/runtime-housekeeping",
      segments: ["api", "security", "runtime-housekeeping"],
      scopes: ["security"],
    },
    {
      path: "/api/migration-repairs/repair_1/credentials",
      segments: ["api", "migration-repairs", "repair_1", "credentials"],
      scopes: ["migration_repairs_credentials"],
    },
    {
      path: "/api/credentials/cred_1/status",
      segments: ["api", "credentials", "cred_1", "status"],
      scopes: ["credentials_status"],
    },
    {
      path: "/api/authorizations/auth_1/credential",
      segments: ["api", "authorizations", "auth_1", "credential"],
      scopes: ["authorizations_credential"],
    },
    {
      path: "/api/windows/window_1",
      segments: ["api", "windows", "window_1"],
      scopes: ["windows_detail"],
    },
    {
      path: "/api/status-lists/compare",
      segments: ["api", "status-lists", "compare"],
      scopes: ["status_lists_compare"],
    },
  ];

  for (const entry of cases) {
    assert.deepEqual(resolveApiReadScopes(entry.path, entry.segments), entry.scopes, entry.path);
  }
});

test("read session roles keep scope boundaries and clamp child ttl to parent expiry", () => {
  const store = createStore();
  const root = createReadSessionInStore(store, {
    role: "security_delegate",
    ttlSeconds: 180,
  }, { appendEvent });
  const runtimeObserver = createReadSessionInStore(store, {
    parentReadSessionId: root.session.readSessionId,
    role: "runtime_observer",
    ttlSeconds: 600,
  }, { appendEvent });
  const recoveryObserver = createReadSessionInStore(store, {
    parentReadSessionId: root.session.readSessionId,
    role: "recovery_observer",
    ttlSeconds: 600,
  }, { appendEvent });
  const agentAuditor = createReadSessionInStore(store, {
    role: "agent_auditor",
    agentIds: ["agent_openneed_agents"],
    ttlSeconds: 600,
  }, { appendEvent });
  const offlineChatObserver = createReadSessionInStore(store, {
    role: "offline_chat_observer",
    ttlSeconds: 600,
  }, { appendEvent });

  assert.equal(
    validateReadSessionTokenInStore(store, runtimeObserver.token, { scope: "device_runtime" }).valid,
    true
  );
  assert.equal(
    validateReadSessionTokenInStore(store, runtimeObserver.token, { scope: "recovery" }).valid,
    false
  );
  assert.equal(
    validateReadSessionTokenInStore(store, recoveryObserver.token, { scope: "recovery" }).valid,
    true
  );
  assert.equal(
    validateReadSessionTokenInStore(store, recoveryObserver.token, { scope: "device_runtime" }).valid,
    false
  );
  assert.equal(
    validateReadSessionTokenInStore(store, agentAuditor.token, { scope: "agents_runtime_search" }).valid,
    true
  );
  assert.equal(
    validateReadSessionTokenInStore(store, offlineChatObserver.token, { scope: "offline_chat" }).valid,
    true
  );
  assert.equal(
    validateReadSessionTokenInStore(store, offlineChatObserver.token, { scope: "agents_messages" }).valid,
    false
  );
  assert.ok(Date.parse(runtimeObserver.session.expiresAt) <= Date.parse(root.session.expiresAt));
  assert.ok(Date.parse(recoveryObserver.session.expiresAt) <= Date.parse(root.session.expiresAt));
});

test("revoke all invalidates late-phase read sessions immediately", () => {
  const store = createStore();
  const latePhaseAgentAuditor = createReadSessionInStore(store, {
    role: "agent_auditor",
    agentIds: ["agent_openneed_agents"],
    ttlSeconds: 1200,
  }, { appendEvent });

  assert.equal(
    validateReadSessionTokenInStore(store, latePhaseAgentAuditor.token, { scope: "agents_runtime_search" }).valid,
    true
  );

  const revoked = revokeAllReadSessionsInStore(store, {
    note: "test revoke all",
  }, { appendEvent });

  assert.equal(revoked.revokedCount, 1);
  assert.equal(
    validateReadSessionTokenInStore(store, latePhaseAgentAuditor.token, { scope: "agents_runtime_search" }).valid,
    false
  );
});

test("runtime stability follows agents_runtime scope instead of falling back to agents_context", () => {
  const store = createStore();
  const runtimeSummaryObserver = createReadSessionInStore(store, {
    role: "runtime_summary_observer",
    agentIds: ["agent_openneed_agents"],
    ttlSeconds: 600,
  }, { appendEvent });
  const contextOnlySession = createReadSessionInStore(store, {
    scopes: ["agents_context"],
    agentIds: ["agent_openneed_agents"],
    ttlSeconds: 600,
  }, { appendEvent });

  assert.equal(
    validateReadSessionTokenInStore(store, runtimeSummaryObserver.token, {
      scope: "agents_runtime",
    }).valid,
    true
  );
  assert.equal(
    validateReadSessionTokenInStore(store, contextOnlySession.token, {
      scope: "agents_runtime",
    }).valid,
    false
  );
});

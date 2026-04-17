import assert from "node:assert/strict";
import test from "node:test";

import {
  createReadSessionInStore,
  revokeAllReadSessionsInStore,
  validateReadSessionTokenInStore,
} from "../src/ledger-read-sessions.js";
import { resolveApiReadScopes } from "../src/server-route-policy.js";
import {
  agentMatchesReadSession,
  credentialMatchesReadSession,
} from "../src/server-read-access.js";

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

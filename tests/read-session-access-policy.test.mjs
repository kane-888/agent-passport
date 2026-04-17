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

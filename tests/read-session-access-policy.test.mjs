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
  authorizationMatchesReadSession,
  credentialMatchesReadSession,
  denyReadSessionResource,
  getReadSessionViewTemplates,
  getReadSessionViewTemplate,
  statusListMatchesReadSession,
  windowMatchesReadSession,
} from "../src/server-read-access.js";
import {
  redactAuthorizationViewForReadSession,
  redactAgentContextForReadSession,
  redactCredentialExportForReadSession,
  redactCredentialStatusForReadSession,
  redactDeviceRuntimeForReadSession,
  redactDeviceSetupStatusForReadSession,
  redactEvidenceRefForReadSession,
  redactMigrationRepairViewForReadSession,
  redactRuntimeMemoryObservationCollectionSummaryForReadSession,
  redactStatusListComparisonForReadSession,
  redactStatusListDetailForReadSession,
} from "../src/server-agent-redaction.js";
import {
  redactFormalRecoveryFlowForReadSession,
  redactRuntimeHousekeepingForReadSession,
  redactSetupPackageDetailForReadSession,
} from "../src/server-security-redaction.js";
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
        agentIds: ["agent_main"],
      },
    },
  };
  const missingAccess = { mode: "none" };

  assert.equal(agentMatchesReadSession(adminAccess, { agentId: "agent_other" }), true);
  assert.equal(agentMatchesReadSession(runtimeObserverAccess, { agentId: "agent_main" }), true);
  assert.equal(agentMatchesReadSession(runtimeObserverAccess, { agentId: "agent_other" }), false);
  assert.equal(agentMatchesReadSession(missingAccess, { agentId: "agent_main" }), false);

  const credentialRecord = {
    credentialRecordId: "cred_1",
    agentId: "agent_main",
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
      agentId: "agent_main",
    }),
    false
  );
});

test("read-session agent bindings treat canonical and physical main-agent ids as one protected read surface", () => {
  const canonicalBoundAccess = {
    mode: "read_session",
    session: {
      resourceBindings: {
        agentIds: ["agent_main"],
      },
    },
  };
  const legacyBoundAccess = {
    mode: "read_session",
    session: {
      resourceBindings: {
        agentIds: ["agent_openneed_agents"],
      },
    },
  };
  const legacyWindow = {
    windowId: "window_main_legacy",
    agentId: "agent_openneed_agents",
  };
  const canonicalWindow = {
    windowId: "window_main_canonical",
    agentId: "agent_main",
  };
  const legacyCredential = {
    credentialRecordId: "cred_main_legacy",
    agentId: "agent_openneed_agents",
    issuerAgentId: "agent_openneed_agents",
  };
  const canonicalCredential = {
    credentialRecordId: "cred_main_canonical",
    agentId: "agent_main",
    issuerAgentId: "agent_main",
  };
  const legacyAuthorization = {
    proposalId: "prop_main_legacy",
    policyAgentId: "agent_openneed_agents",
  };
  const canonicalAuthorization = {
    proposalId: "prop_main_canonical",
    policyAgentId: "agent_main",
  };
  const legacyStatusList = {
    summary: {
      issuerAgentId: "agent_openneed_agents",
    },
  };
  const canonicalStatusList = {
    summary: {
      issuerAgentId: "agent_main",
    },
  };

  assert.equal(agentMatchesReadSession(canonicalBoundAccess, { agentId: "agent_openneed_agents" }), true);
  assert.equal(agentMatchesReadSession(legacyBoundAccess, { agentId: "agent_main" }), true);
  assert.equal(windowMatchesReadSession(canonicalBoundAccess, legacyWindow), true);
  assert.equal(windowMatchesReadSession(legacyBoundAccess, canonicalWindow), true);
  assert.equal(credentialMatchesReadSession(canonicalBoundAccess, legacyCredential), true);
  assert.equal(credentialMatchesReadSession(legacyBoundAccess, canonicalCredential), true);
  assert.equal(authorizationMatchesReadSession(canonicalBoundAccess, legacyAuthorization), true);
  assert.equal(authorizationMatchesReadSession(legacyBoundAccess, canonicalAuthorization), true);
  assert.equal(statusListMatchesReadSession(canonicalBoundAccess, legacyStatusList), true);
  assert.equal(statusListMatchesReadSession(legacyBoundAccess, canonicalStatusList), true);
  assert.equal(agentMatchesReadSession(canonicalBoundAccess, { agentId: "agent_treasury" }), false);
});

test("legacy read-session template inputs canonicalize onto viewTemplates at creation time", () => {
  const store = createStore();
  const created = createReadSessionInStore(
    store,
    {
      label: "legacy template input",
      role: "offline_chat_observer",
      objectTemplates: {
        offline_chat: "summary_only",
      },
      fieldTemplates: {
        security_state: "summary_only",
      },
    },
    { appendEvent }
  );

  assert.equal(created.session.viewTemplates.offlineChat, "summary_only");
  assert.equal(created.session.viewTemplates.security, "summary_only");
  assert.equal(store.readSessions[0]?.viewTemplates?.offlineChat, "summary_only");
  assert.equal(store.readSessions[0]?.viewTemplates?.security, "summary_only");
  assert.equal("objectTemplates" in created.session, false);
  assert.equal("fieldTemplates" in created.session, false);
});

test("read-session view accessors ignore legacy output aliases and only trust canonical viewTemplates", () => {
  const templates = getReadSessionViewTemplates({
    mode: "read_session",
    session: {
      redactionTemplate: "metadata_only",
      objectTemplates: {
        offline_chat: "summary_only",
      },
      fieldTemplates: {
        security_state: "summary_only",
      },
    },
  });

  assert.equal(templates.offlineChat, "metadata_only");
  assert.equal(templates.security, "metadata_only");
  assert.equal(
    getReadSessionViewTemplate(
      {
        mode: "read_session",
        session: {
          redactionTemplate: "metadata_only",
          objectTemplates: {
            recovery_rehearsal: "summary_only",
          },
        },
      },
      "recovery"
    ),
    "metadata_only"
  );
});

test("legacy stored read-session records are canonicalized onto viewTemplates before validation output", () => {
  const store = createStore();
  const created = createReadSessionInStore(
    store,
    {
      label: "legacy stored template",
      role: "offline_chat_observer",
      viewTemplates: {
        offlineChat: "summary_only",
      },
    },
    { appendEvent }
  );
  const record = store.readSessions[0];
  record.objectTemplates = {
    offline_chat: "summary_only",
  };
  delete record.viewTemplates;

  const validation = validateReadSessionTokenInStore(store, created.token, {
    scope: "offline_chat",
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.session?.viewTemplates?.offlineChat, "summary_only");
  assert.equal(store.readSessions[0]?.viewTemplates?.offlineChat, "summary_only");
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
        agentIds: ["agent_main"],
      },
    },
  };
  const windowAndAgentAccess = {
    mode: "read_session",
    session: {
      resourceBindings: {
        windowIds: ["window_runtime"],
        agentIds: ["agent_main"],
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
      agentId: "agent_main",
    }),
    true
  );
  assert.equal(
    windowMatchesReadSession(windowAndAgentAccess, {
      windowId: "window_runtime",
      agentId: "agent_main",
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
      agentId: "agent_main",
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

  assert.equal(agentMatchesReadSession(unboundAccess, { agentId: "agent_main" }), false);
  assert.equal(windowMatchesReadSession(unboundAccess, { windowId: "window_1", agentId: "agent_main" }), false);
  assert.equal(credentialMatchesReadSession(unboundAccess, { credentialRecordId: "cred_1" }), false);
  assert.equal(statusListMatchesReadSession(unboundAccess, { summary: { issuerAgentId: "agent_main" } }), false);

  assert.equal(agentMatchesReadSession(allReadAccess, { agentId: "agent_main" }), true);
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
    agentIds: ["agent_main"],
    ttlSeconds: 600,
  }, { appendEvent });
  store.readSessions[0].allowedAgentIds = ["agent_spoofed"];

  const child = createReadSessionInStore(store, {
    parentReadSessionId: parent.session.readSessionId,
    ttlSeconds: 300,
  }, { appendEvent });
  assert.deepEqual(child.session.resourceBindings.agentIds, ["agent_main"]);

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
        agentIds: ["agent_main"],
      },
    },
  };
  const statusList = {
    summary: {
      issuerAgentId: "agent_main",
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

test("agent context read-session redaction preserves split credential coverage truth", () => {
  const redacted = redactAgentContextForReadSession(
    {
      agent: {
        agentId: "agent_main",
        displayName: "Main Agent",
      },
      identity: {
        did: "did:agentpassport:agent_main",
      },
      credentialMethodCoverage: {
        publicSignableDidMethods: ["agentpassport"],
        compatibilitySignableDidMethods: ["openneed"],
        repairSignableDidMethods: ["agentpassport", "openneed"],
        totalSubjects: 1,
        completeSubjectCount: 1,
        partialSubjectCount: 0,
        complete: true,
        publicComplete: true,
        repairComplete: false,
        repairCompleteSubjectCount: 0,
        repairPartialSubjectCount: 1,
        availableDidMethods: ["agentpassport"],
        missingDidMethods: [],
        publicMissingDidMethods: [],
        compatibilityMissingDidMethods: ["openneed"],
        repairMissingDidMethods: ["openneed"],
      },
    },
    {
      mode: "read_session",
      session: {
        resourceBindings: {
          agentIds: ["agent_main"],
        },
      },
    }
  );

  assert.deepEqual(redacted.credentialMethodCoverage, {
    publicSignableDidMethods: ["agentpassport"],
    compatibilitySignableDidMethods: ["openneed"],
    repairSignableDidMethods: ["agentpassport", "openneed"],
    totalSubjects: 1,
    completeSubjectCount: 1,
    partialSubjectCount: 0,
    complete: true,
    publicComplete: true,
    repairComplete: false,
    repairCompleteSubjectCount: 0,
    repairPartialSubjectCount: 1,
    availableDidMethods: ["agentpassport"],
    missingDidMethods: [],
    publicMissingDidMethods: [],
    compatibilityMissingDidMethods: ["openneed"],
    repairMissingDidMethods: ["openneed"],
  });
});

test("device runtime and setup redaction canonicalize legacy nested resident binding", () => {
  const access = {
    mode: "read_session",
    session: {
      viewTemplates: {
        deviceRuntime: "summary_only",
        deviceSetup: "summary_only",
      },
    },
  };
  const redactedRuntime = redactDeviceRuntimeForReadSession(
    {
      deviceRuntimeId: "device_runtime_legacy",
      residentAgent: {
        agentId: "agent_openneed_agents",
        referenceAgentId: "agent_openneed_agents",
      },
      residentDidMethod: "agentpassport",
      sandboxPolicy: {
        allowedCapabilities: [],
      },
      constrainedExecutionPolicy: {
        allowedCapabilities: [],
      },
    },
    access
  );
  const redactedSetupStatus = redactDeviceSetupStatusForReadSession(
    {
      setupComplete: true,
      missingRequiredCodes: [],
      checks: [],
      residentDidMethod: "agentpassport",
      deviceRuntime: {
        deviceRuntimeId: "device_runtime_legacy",
        residentAgent: {
          agentId: "agent_openneed_agents",
          referenceAgentId: "agent_openneed_agents",
        },
        residentDidMethod: "agentpassport",
        sandboxPolicy: {
          allowedCapabilities: [],
        },
        constrainedExecutionPolicy: {
          allowedCapabilities: [],
        },
      },
    },
    access
  );

  assert.equal(redactedRuntime.physicalResidentAgentId, "agent_openneed_agents");
  assert.equal(redactedRuntime.residentAgentId, "agent_openneed_agents");
  assert.equal(redactedRuntime.residentAgentReference, "agent_main");
  assert.equal(redactedRuntime.resolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(redactedSetupStatus.physicalResidentAgentId, "agent_openneed_agents");
  assert.equal(redactedSetupStatus.residentAgentId, "agent_openneed_agents");
  assert.equal(redactedSetupStatus.residentAgentReference, "agent_main");
  assert.equal(redactedSetupStatus.resolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(redactedSetupStatus.deviceRuntime?.physicalResidentAgentId, "agent_openneed_agents");
  assert.equal(redactedSetupStatus.deviceRuntime?.residentAgentReference, "agent_main");
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
    policyAgentId: "agent_main",
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

test("migration repair read-session redaction keeps counts but removes linked ids and repair link maps", () => {
  const redacted = redactMigrationRepairViewForReadSession({
    repairId: "repair_1",
    summary: "sensitive repair summary",
    linkedCredentialRecordIds: ["cred_1", "cred_2"],
    linkedCredentialIds: ["vc_1"],
    linkedSubjects: [{ subjectId: "agent_main" }],
    linkedComparisons: [{ subjectId: "comparison_1" }],
    links: {
      repairedCredentialRecordIds: ["cred_1"],
    },
    issuerDidByMethod: {
      agentpassport: "did:agentpassport:agent_main",
      openneed: "did:openneed:agent_main",
    },
    publicIssuerDid: "did:agentpassport:agent_main",
    compatibilityIssuerDid: "did:openneed:agent_main",
  });

  assert.equal(redacted.summary, null);
  assert.equal(redacted.summaryRedacted, true);
  assert.deepEqual(redacted.linkedCredentialRecordIds, []);
  assert.equal(redacted.linkedCredentialRecordIdsCount, 2);
  assert.deepEqual(redacted.linkedCredentialIds, []);
  assert.equal(redacted.linkedCredentialIdsCount, 1);
  assert.deepEqual(redacted.linkedSubjects, []);
  assert.equal(redacted.linkedSubjectsCount, 1);
  assert.deepEqual(redacted.linkedComparisons, []);
  assert.equal(redacted.linkedComparisonsCount, 1);
  assert.equal(redacted.links, null);
  assert.equal(redacted.linksRedacted, true);
  assert.equal(redacted.issuerDidByMethod, null);
  assert.equal(redacted.issuerDidByMethodRedacted, true);
  assert.equal(redacted.publicIssuerDid, "did:agentpassport:agent_main");
  assert.equal(redacted.compatibilityIssuerDid, "did:openneed:agent_main");
});

test("evidence ref read-session redaction keeps explicit physical resident owner ahead of stale canonical resolved fallback", () => {
  const redacted = redactEvidenceRefForReadSession({
    evidenceRefId: "evidence_1",
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: "agent_main",
    residentAgent: {
      agentId: "agent_openneed_agents",
      referenceAgentId: "agent_openneed_agents",
    },
  });

  assert.equal(redacted.physicalResidentAgentId, "agent_openneed_agents");
  assert.equal(redacted.residentAgentId, "agent_openneed_agents");
  assert.equal(redacted.residentAgentReference, "agent_main");
  assert.equal(redacted.resolvedResidentAgentId, "agent_main");
});

test("evidence ref read-session redaction does not synthesize resident binding from plain agent id", () => {
  const redacted = redactEvidenceRefForReadSession({
    evidenceRefId: "evidence_agent_only",
    agentId: "agent_main",
    title: "resident-free evidence",
  });

  assert.equal(redacted.agentId, "agent_main");
  assert.equal(redacted.physicalResidentAgentId, null);
  assert.equal(redacted.residentAgentId, null);
  assert.equal(redacted.residentAgentReference, null);
  assert.equal(redacted.resolvedResidentAgentId, null);
});

test("agent read-session summary-only redaction keeps canonical resident reference and resolved owner", () => {
  const access = {
    mode: "read_session",
    session: {
      viewTemplates: {
        deviceRuntime: "summary_only",
        deviceSetup: "summary_only",
      },
    },
  };
  const redactedRuntime = redactDeviceRuntimeForReadSession(
    {
      deviceRuntimeId: "device_runtime_local",
      residentAgentId: "agent_openneed_agents",
      residentAgentReference: "agent_main",
      resolvedResidentAgentId: "agent_openneed_agents",
      residentDidMethod: "agentpassport",
      residentLocked: true,
      localMode: "local_only",
      allowOnlineReasoner: false,
      securityPosture: {
        mode: "normal",
        summary: "ok",
        writeLocked: false,
        executionLocked: false,
        networkEgressLocked: false,
      },
      commandPolicy: {
        negotiationMode: "confirm_before_execute",
        riskStrategies: {},
        requireExplicitConfirmation: true,
      },
      retrievalPolicy: {
        strategy: "local_first_non_vector",
        allowVectorIndex: false,
        maxHits: 8,
      },
      setupPolicy: {},
      localReasoner: {
        enabled: true,
        provider: "local_mock",
      },
      sandboxPolicy: {
        allowedCapabilities: [],
        filesystemAllowlistCount: 0,
        networkAllowlistCount: 0,
        allowedCommandsCount: 0,
      },
      constrainedExecutionPolicy: {
        allowedCapabilities: [],
        filesystemAllowlistCount: 0,
        networkAllowlistCount: 0,
        allowedCommandsCount: 0,
      },
    },
    access
  );
  const redactedSetupStatus = redactDeviceSetupStatusForReadSession(
    {
      setupComplete: true,
      missingRequiredCodes: [],
      residentAgentId: "agent_openneed_agents",
      residentAgentReference: "agent_main",
      resolvedResidentAgentId: "agent_openneed_agents",
      residentDidMethod: "agentpassport",
      setupPolicy: {},
      localReasonerDiagnostics: null,
      checks: [],
      deviceRuntime: {
        deviceRuntimeId: "device_runtime_local",
        residentAgentId: "agent_openneed_agents",
        residentAgentReference: "agent_main",
        resolvedResidentAgentId: "agent_openneed_agents",
        residentDidMethod: "agentpassport",
        residentLocked: true,
        localMode: "local_only",
        allowOnlineReasoner: false,
        securityPosture: {
          mode: "normal",
          summary: "ok",
          writeLocked: false,
          executionLocked: false,
          networkEgressLocked: false,
        },
        commandPolicy: {
          negotiationMode: "confirm_before_execute",
          riskStrategies: {},
          requireExplicitConfirmation: true,
        },
        retrievalPolicy: {
          strategy: "local_first_non_vector",
          allowVectorIndex: false,
          maxHits: 8,
        },
        setupPolicy: {},
        localReasoner: {
          enabled: true,
          provider: "local_mock",
        },
        sandboxPolicy: {
          allowedCapabilities: [],
          filesystemAllowlistCount: 0,
          networkAllowlistCount: 0,
          allowedCommandsCount: 0,
        },
        constrainedExecutionPolicy: {
          allowedCapabilities: [],
          filesystemAllowlistCount: 0,
          networkAllowlistCount: 0,
          allowedCommandsCount: 0,
        },
      },
      formalRecoveryFlow: null,
      latestRecoveryRehearsal: null,
      latestRecoveryRehearsalAgeHours: null,
      latestRecoveryRehearsalBlocksFreshness: false,
      latestPassedRecoveryRehearsal: null,
      latestPassedRecoveryRehearsalAgeHours: null,
      recoveryBundles: null,
      recoveryRehearsals: null,
      setupPackages: null,
    },
    access
  );

  assert.equal(redactedRuntime.residentAgentId, "agent_openneed_agents");
  assert.equal(redactedRuntime.physicalResidentAgentId, "agent_openneed_agents");
  assert.equal(redactedRuntime.residentAgentReference, "agent_main");
  assert.equal(redactedRuntime.resolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(redactedSetupStatus.residentAgentId, "agent_openneed_agents");
  assert.equal(redactedSetupStatus.physicalResidentAgentId, "agent_openneed_agents");
  assert.equal(redactedSetupStatus.residentAgentReference, "agent_main");
  assert.equal(redactedSetupStatus.resolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(redactedSetupStatus.deviceRuntime?.physicalResidentAgentId, "agent_openneed_agents");
  assert.equal(redactedSetupStatus.deviceRuntime?.residentAgentId, "agent_openneed_agents");
  assert.equal(redactedSetupStatus.deviceRuntime?.residentAgentReference, "agent_main");
  assert.equal(redactedSetupStatus.deviceRuntime?.resolvedResidentAgentId, "agent_openneed_agents");
});

test("security summary-only setup package redaction nulls canonical resident reference fields", () => {
  const access = {
    mode: "read_session",
    session: {
      viewTemplates: {
        deviceSetup: "summary_only",
        deviceRuntime: "summary_only",
      },
    },
  };
  const redacted = redactSetupPackageDetailForReadSession(
    {
      summary: {
        packageId: "setup_1",
        residentAgentId: "agent_openneed_agents",
        residentAgentReference: "agent_main",
        resolvedResidentAgentId: "agent_openneed_agents",
        effectivePhysicalResidentAgentId: "agent_openneed_agents",
        effectiveResidentAgentReference: "agent_main",
        effectiveResolvedResidentAgentId: "agent_openneed_agents",
        residentBindingMismatch: false,
        canonicalResidentBinding: {
          residentAgentId: "agent_main",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: "agent_main",
          effectivePhysicalResidentAgentId: "agent_main",
          effectiveResidentAgentReference: "agent_main",
          effectiveResolvedResidentAgentId: "agent_main",
          residentBindingMismatch: false,
        },
        resolvedResidentBinding: {
          residentAgentId: "agent_openneed_agents",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: "agent_openneed_agents",
          effectivePhysicalResidentAgentId: "agent_openneed_agents",
          effectiveResidentAgentReference: "agent_main",
          effectiveResolvedResidentAgentId: "agent_openneed_agents",
          residentBindingMismatch: false,
        },
      },
      package: {
        packageId: "setup_1",
        note: "secret",
        residentAgentId: "agent_openneed_agents",
        residentAgentReference: "agent_main",
        resolvedResidentAgentId: "agent_openneed_agents",
        effectivePhysicalResidentAgentId: "agent_openneed_agents",
        effectiveResidentAgentReference: "agent_main",
        effectiveResolvedResidentAgentId: "agent_openneed_agents",
        residentBindingMismatch: false,
        canonicalResidentBinding: {
          residentAgentId: "agent_main",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: "agent_main",
          effectivePhysicalResidentAgentId: "agent_main",
          effectiveResidentAgentReference: "agent_main",
          effectiveResolvedResidentAgentId: "agent_main",
          residentBindingMismatch: false,
        },
        resolvedResidentBinding: {
          residentAgentId: "agent_openneed_agents",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: "agent_openneed_agents",
          effectivePhysicalResidentAgentId: "agent_openneed_agents",
          effectiveResidentAgentReference: "agent_main",
          effectiveResolvedResidentAgentId: "agent_openneed_agents",
          residentBindingMismatch: false,
        },
        runtimeConfig: {
          deviceRuntimeId: "device_runtime_local",
          residentAgentId: "agent_openneed_agents",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: "agent_openneed_agents",
          residentDidMethod: "agentpassport",
          residentLocked: true,
          localMode: "local_only",
          allowOnlineReasoner: false,
          retrievalPolicy: {
            strategy: "local_first_non_vector",
            allowVectorIndex: false,
            maxHits: 8,
          },
          localReasoner: {
            enabled: true,
            provider: "local_mock",
          },
          sandboxPolicy: {
            allowedCapabilities: [],
          },
        },
        setupStatus: {
          setupComplete: true,
          missingRequiredCodes: [],
          checks: [],
        },
        recovery: null,
        localReasonerProfiles: [],
      },
    },
    access
  );

  assert.equal(redacted.summary?.residentAgentId, null);
  assert.equal(redacted.summary?.residentAgentReference, null);
  assert.equal(redacted.summary?.resolvedResidentAgentId, null);
  assert.equal(redacted.summary?.effectivePhysicalResidentAgentId, null);
  assert.equal(redacted.summary?.effectiveResidentAgentReference, null);
  assert.equal(redacted.summary?.effectiveResolvedResidentAgentId, null);
  assert.equal(redacted.summary?.residentBindingMismatch, null);
  assert.equal(redacted.summary?.canonicalResidentBinding, null);
  assert.equal(redacted.summary?.resolvedResidentBinding, null);
  assert.equal(redacted.package?.residentAgentId, null);
  assert.equal(redacted.package?.residentAgentReference, null);
  assert.equal(redacted.package?.resolvedResidentAgentId, null);
  assert.equal(redacted.package?.effectivePhysicalResidentAgentId, null);
  assert.equal(redacted.package?.effectiveResidentAgentReference, null);
  assert.equal(redacted.package?.effectiveResolvedResidentAgentId, null);
  assert.equal(redacted.package?.residentBindingMismatch, null);
  assert.equal(redacted.package?.canonicalResidentBinding, null);
  assert.equal(redacted.package?.resolvedResidentBinding, null);
  assert.equal(redacted.package?.runtimeConfig?.residentAgentId, null);
  assert.equal(redacted.package?.runtimeConfig?.residentAgentReference, null);
  assert.equal(redacted.package?.runtimeConfig?.resolvedResidentAgentId, null);
});

test("formal recovery read-session redaction nulls setup package effective owner fields across latest and cross-device views", () => {
  const access = {
    viewTemplates: {
      deviceSetup: "summary_only",
    },
  };
  const redacted = redactFormalRecoveryFlowForReadSession({
    setupPackage: {
      latestPackage: {
        packageId: "setup_formal_1",
        machineId: "device_1",
        machineLabel: "Device 1",
        note: "secret latest package note",
        residentAgentId: "agent_openneed_agents",
        residentAgentReference: "agent_main",
        resolvedResidentAgentId: null,
        effectivePhysicalResidentAgentId: "agent_openneed_agents",
        effectiveResidentAgentReference: "agent_main",
        effectiveResolvedResidentAgentId: "agent_openneed_agents",
        residentBindingMismatch: false,
        canonicalResidentBinding: {
          residentAgentId: "agent_main",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: null,
          effectivePhysicalResidentAgentId: "agent_main",
          effectiveResidentAgentReference: "agent_main",
          effectiveResolvedResidentAgentId: null,
          residentBindingMismatch: false,
        },
        resolvedResidentBinding: {
          residentAgentId: "agent_openneed_agents",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: null,
          effectivePhysicalResidentAgentId: "agent_openneed_agents",
          effectiveResidentAgentReference: "agent_main",
          effectiveResolvedResidentAgentId: "agent_openneed_agents",
          residentBindingMismatch: false,
        },
        latestRecoveryBundleId: "bundle_1",
        latestRecoveryRehearsalId: "rehearsal_1",
      },
    },
    crossDeviceRecoveryClosure: {
      latestSetupPackage: {
        packageId: "setup_cross_device_1",
        machineId: "device_1",
        machineLabel: "Device 1",
        note: "secret cross-device package note",
        residentAgentId: "agent_openneed_agents",
        residentAgentReference: "agent_main",
        resolvedResidentAgentId: null,
        effectivePhysicalResidentAgentId: "agent_openneed_agents",
        effectiveResidentAgentReference: "agent_main",
        effectiveResolvedResidentAgentId: "agent_openneed_agents",
        residentBindingMismatch: false,
        canonicalResidentBinding: {
          residentAgentId: "agent_main",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: null,
          effectivePhysicalResidentAgentId: "agent_main",
          effectiveResidentAgentReference: "agent_main",
          effectiveResolvedResidentAgentId: null,
          residentBindingMismatch: false,
        },
        resolvedResidentBinding: {
          residentAgentId: "agent_openneed_agents",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: null,
          effectivePhysicalResidentAgentId: "agent_openneed_agents",
          effectiveResidentAgentReference: "agent_main",
          effectiveResolvedResidentAgentId: "agent_openneed_agents",
          residentBindingMismatch: false,
        },
        latestRecoveryBundleId: "bundle_1",
        latestRecoveryRehearsalId: "rehearsal_1",
      },
    },
  }, access);

  assert.equal(redacted.setupPackage?.latestPackage?.packageId, "setup_formal_1");
  assert.equal(redacted.setupPackage?.latestPackage?.note, null);
  assert.equal(redacted.setupPackage?.latestPackage?.residentAgentId, null);
  assert.equal(redacted.setupPackage?.latestPackage?.residentAgentReference, null);
  assert.equal(redacted.setupPackage?.latestPackage?.resolvedResidentAgentId, null);
  assert.equal(redacted.setupPackage?.latestPackage?.effectivePhysicalResidentAgentId, null);
  assert.equal(redacted.setupPackage?.latestPackage?.effectiveResidentAgentReference, null);
  assert.equal(redacted.setupPackage?.latestPackage?.effectiveResolvedResidentAgentId, null);
  assert.equal(redacted.setupPackage?.latestPackage?.residentBindingMismatch, null);
  assert.equal(redacted.setupPackage?.latestPackage?.canonicalResidentBinding, null);
  assert.equal(redacted.setupPackage?.latestPackage?.resolvedResidentBinding, null);
  assert.equal(redacted.setupPackage?.latestPackage?.latestRecoveryBundleId, null);
  assert.equal(redacted.setupPackage?.latestPackage?.latestRecoveryRehearsalId, null);

  assert.equal(redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.packageId, "setup_cross_device_1");
  assert.equal(redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.note, null);
  assert.equal(redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.residentAgentId, null);
  assert.equal(redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.residentAgentReference, null);
  assert.equal(redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.resolvedResidentAgentId, null);
  assert.equal(
    redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.effectivePhysicalResidentAgentId,
    null
  );
  assert.equal(
    redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.effectiveResidentAgentReference,
    null
  );
  assert.equal(
    redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.effectiveResolvedResidentAgentId,
    null
  );
  assert.equal(redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.residentBindingMismatch, null);
  assert.equal(redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.canonicalResidentBinding, null);
  assert.equal(redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.resolvedResidentBinding, null);
  assert.equal(redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.latestRecoveryBundleId, null);
  assert.equal(redacted.crossDeviceRecoveryClosure?.latestSetupPackage?.latestRecoveryRehearsalId, null);
});

test("runtime housekeeping setup entries reuse canonical setup-package redaction before filesystem fields are cleared", () => {
  const access = {
    viewTemplates: {
      deviceSetup: "summary_only",
      security: "metadata_only",
    },
  };
  const redacted = redactRuntimeHousekeepingForReadSession(
    {
      ok: true,
      setupPackages: {
        keepLatest: 1,
        dryRun: true,
        kept: [
          {
            packageId: "setup_housekeeping_1",
            residentAgentId: "agent_openneed_agents",
            residentAgentReference: "agent_main",
            resolvedResidentAgentId: null,
            effectivePhysicalResidentAgentId: "agent_openneed_agents",
            effectiveResidentAgentReference: "agent_main",
            effectiveResolvedResidentAgentId: "agent_openneed_agents",
            residentBindingMismatch: false,
            note: "secret housekeeping note",
            packagePath: "/tmp/secret-package.json",
            filePath: "/tmp/secret-package.json",
            errorMessage: "secret fs error",
          },
        ],
        candidates: [],
        invalid: [],
      },
    },
    access
  );

  assert.equal(redacted.setupPackages.kept[0]?.packageId, "setup_housekeeping_1");
  assert.equal(redacted.setupPackages.kept[0]?.residentAgentId, null);
  assert.equal(redacted.setupPackages.kept[0]?.residentAgentReference, null);
  assert.equal(redacted.setupPackages.kept[0]?.resolvedResidentAgentId, null);
  assert.equal(redacted.setupPackages.kept[0]?.effectivePhysicalResidentAgentId, null);
  assert.equal(redacted.setupPackages.kept[0]?.effectiveResidentAgentReference, null);
  assert.equal(redacted.setupPackages.kept[0]?.effectiveResolvedResidentAgentId, null);
  assert.equal(redacted.setupPackages.kept[0]?.residentBindingMismatch, null);
  assert.equal(redacted.setupPackages.kept[0]?.note, null);
  assert.equal(redacted.setupPackages.kept[0]?.packagePath, null);
  assert.equal(redacted.setupPackages.kept[0]?.filePath, null);
  assert.equal(redacted.setupPackages.kept[0]?.errorMessage, null);
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
      "/api/agents/agent_main/runtime/search",
      ["api", "agents", "agent_main", "runtime", "search"]
    ),
    ["agents_runtime_search"]
  );
  assert.deepEqual(
    resolveApiReadScopes(
      "/api/agents/agent_main/runtime/stability",
      ["api", "agents", "agent_main", "runtime", "stability"]
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
        cards: [
          {
            cardId: "recent_execution",
            lines: ["最近执行：用户说了另一段敏感内容"],
          },
        ],
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
  assert.equal(redacted.threadView.context.cards[0].lines[0], "[redacted:offline-chat-read-session]");
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
      path: "/api/agents/agent_main/runner",
      segments: ["api", "agents", "agent_main", "runner"],
    },
    {
      path: "/api/agents/agent_main/runtime/actions",
      segments: ["api", "agents", "agent_main", "runtime", "actions"],
    },
    {
      path: "/api/agents/agent_main/runtime/stability",
      segments: ["api", "agents", "agent_main", "runtime", "stability"],
    },
    {
      path: "/api/agents/agent_main/runtime/snapshot",
      segments: ["api", "agents", "agent_main", "runtime", "snapshot"],
    },
    {
      path: "/api/agents/agent_main/runtime/decisions",
      segments: ["api", "agents", "agent_main", "runtime", "decisions"],
    },
    {
      path: "/api/agents/agent_main/runtime/evidence",
      segments: ["api", "agents", "agent_main", "runtime", "evidence"],
    },
    {
      path: "/api/agents/agent_main/runtime/minutes",
      segments: ["api", "agents", "agent_main", "runtime", "minutes"],
    },
    {
      path: "/api/agents/agent_main/runtime/bootstrap",
      segments: ["api", "agents", "agent_main", "runtime", "bootstrap"],
    },
    {
      path: "/api/agents/compare/migration/repair",
      segments: ["api", "agents", "compare", "migration", "repair"],
    },
    {
      path: "/api/agents/agent_main/migration/repair",
      segments: ["api", "agents", "agent_main", "migration", "repair"],
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
      path: "/api/agents/agent_main/verification-runs",
      segments: ["api", "agents", "agent_main", "verification-runs"],
    },
    {
      path: "/api/agents/agent_main/offline-replay",
      segments: ["api", "agents", "agent_main", "offline-replay"],
    },
    {
      path: "/api/agents/agent_main/memories",
      segments: ["api", "agents", "agent_main", "memories"],
    },
    {
      path: "/api/agents/agent_main/passport-memory",
      segments: ["api", "agents", "agent_main", "passport-memory"],
    },
    {
      path: "/api/agents/agent_main/learning/proposals/lp_test/apply",
      segments: ["api", "agents", "agent_main", "learning", "proposals", "lp_test", "apply"],
    },
    {
      path: "/api/agents/agent_main/memory-compactor",
      segments: ["api", "agents", "agent_main", "memory-compactor"],
    },
    {
      path: "/api/agents/agent_main/archives/restore",
      segments: ["api", "agents", "agent_main", "archives", "restore"],
    },
    {
      path: "/api/agents/agent_main/archive-restores/revert",
      segments: ["api", "agents", "agent_main", "archive-restores", "revert"],
    },
    {
      path: "/api/agents/agent_main/messages",
      segments: ["api", "agents", "agent_main", "messages"],
    },
    {
      path: "/api/agents/agent_main/policy",
      segments: ["api", "agents", "agent_main", "policy"],
      method: "PATCH",
    },
    {
      path: "/api/agents/agent_main/fork",
      segments: ["api", "agents", "agent_main", "fork"],
    },
    {
      path: "/api/agents/agent_main/grants",
      segments: ["api", "agents", "agent_main", "grants"],
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
      path: "/api/agents/agent_main/runner",
      segments: ["api", "agents", "agent_main", "runner"],
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
      path: "/api/agents/agent_main/context-builder",
      segments: ["api", "agents", "agent_main", "context-builder"],
      method: "POST",
    },
    {
      path: "/api/agents/agent_main/response-verify",
      segments: ["api", "agents", "agent_main", "response-verify"],
      method: "POST",
    },
    {
      path: "/api/agents/agent_main/verification-runs",
      segments: ["api", "agents", "agent_main", "verification-runs"],
      method: "GET",
    },
    {
      path: "/api/agents/agent_main/runtime/drift-check",
      segments: ["api", "agents", "agent_main", "runtime", "drift-check"],
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
    "/api/agents/agent_main/runtime/actions",
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
      path: "/api/agents/agent_main/runtime-summary",
      segments: ["api", "agents", "agent_main", "runtime-summary"],
      scopes: ["agents_runtime"],
    },
    {
      path: "/api/agents/agent_main/runtime/minutes",
      segments: ["api", "agents", "agent_main", "runtime", "minutes"],
      scopes: ["agents_runtime_minutes"],
    },
    {
      path: "/api/agents/agent_main/runtime/actions",
      segments: ["api", "agents", "agent_main", "runtime", "actions"],
      scopes: ["agents_runtime_actions"],
    },
    {
      path: "/api/agents/agent_main/runtime/rehydrate",
      segments: ["api", "agents", "agent_main", "runtime", "rehydrate"],
      scopes: ["agents_rehydrate"],
    },
    {
      path: "/api/agents/agent_main/archives",
      segments: ["api", "agents", "agent_main", "archives"],
      scopes: ["agents_memories"],
    },
    {
      path: "/api/agents/agent_main/archive-restores",
      segments: ["api", "agents", "agent_main", "archive-restores"],
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

test("incident packet routes stay explicitly admin-only while remaining in security read scope", () => {
  const cases = [
    {
      path: "/api/security/incident-packet",
      method: "GET",
    },
    {
      path: "/api/security/incident-packet/history",
      method: "GET",
    },
    {
      path: "/api/security/incident-packet/export",
      method: "GET",
    },
    {
      path: "/api/security/incident-packet/export",
      method: "POST",
    },
  ];

  for (const entry of cases) {
    const segments = entry.path.split("/").filter(Boolean);
    assert.equal(isAdminOnlyApiPath(entry.path, entry.method), true, `${entry.method} ${entry.path}`);
    assert.equal(
      resolveApiReadScopes(entry.path, segments).includes("security"),
      true,
      `${entry.method} ${entry.path} should remain in security read scope`
    );
    assert.equal(
      requiresApiReadToken({ method: entry.method }, entry.path),
      entry.method === "GET",
      `${entry.method} ${entry.path} read-token expectation drifted`
    );
    assert.equal(
      requiresApiWriteToken({ method: entry.method }, entry.path),
      entry.method === "POST",
      `${entry.method} ${entry.path} write-token expectation drifted`
    );
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
    agentIds: ["agent_main"],
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
  assert.equal(offlineChatObserver.session.viewTemplates.offlineChat, "metadata_only");
  assert.equal(
    getReadSessionViewTemplate({ mode: "read_session", session: offlineChatObserver.session }, "offline_chat"),
    "metadata_only"
  );
  assert.equal(
    getReadSessionViewTemplate({ mode: "read_session", session: { viewTemplates: { recovery_rehearsal: "summary_only" } } }, "recovery"),
    "summary_only"
  );
  assert.ok(Date.parse(runtimeObserver.session.expiresAt) <= Date.parse(root.session.expiresAt));
  assert.ok(Date.parse(recoveryObserver.session.expiresAt) <= Date.parse(root.session.expiresAt));
});

test("revoke all invalidates late-phase read sessions immediately", () => {
  const store = createStore();
  const latePhaseAgentAuditor = createReadSessionInStore(store, {
    role: "agent_auditor",
    agentIds: ["agent_main"],
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
    agentIds: ["agent_main"],
    ttlSeconds: 600,
  }, { appendEvent });
  const contextOnlySession = createReadSessionInStore(store, {
    scopes: ["agents_context"],
    agentIds: ["agent_main"],
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

test("runtime observation summaries redact observation details for summary-only and metadata-only agent runtime views", () => {
  const store = createStore();
  const runtimeSummaryObserver = createReadSessionInStore(store, {
    role: "runtime_summary_observer",
    agentIds: ["agent_main"],
    ttlSeconds: 600,
  }, { appendEvent });
  const agentAuditor = createReadSessionInStore(store, {
    role: "agent_auditor",
    agentIds: ["agent_main"],
    ttlSeconds: 600,
  }, { appendEvent });

  const observationSummary = {
    totalCount: 3,
    stableCount: 1,
    unstableCount: 2,
    roleCounts: {
      correction_escalated_unstable: 1,
      organic_stable: 2,
    },
    effectiveness: {
      correctionRequestedCount: 2,
      correctionAppliedCount: 1,
      correctionEscalatedCount: 1,
      trackedCorrectionCount: 2,
      recoveredCount: 1,
      unresolvedCount: 1,
      recoveryRate: 0.5,
      averageCTReduction: 0.14,
      averageSTGain: 0.09,
      averageLagObservations: 2,
      latestRecoveredPair: {
        unstableObservation: {
          observationId: "obs_unstable",
          sessionId: "session_sensitive",
          correctionActions: ["reload_authoritative_window"],
          instabilityReasons: ["correction_escalated"],
        },
        recoveryObservation: {
          observationId: "obs_recovered",
          sessionId: "session_sensitive",
        },
      },
      latestPendingUnstable: {
        observationId: "obs_pending",
        sessionId: "session_sensitive",
        correctionActions: ["reload_authoritative_window"],
        instabilityReasons: ["correction_escalated"],
      },
      recentRecoveredPairs: [
        {
          unstableObservation: {
            observationId: "obs_pair",
            sessionId: "session_sensitive",
          },
          recoveryObservation: {
            observationId: "obs_pair_recovered",
            sessionId: "session_sensitive",
          },
        },
      ],
    },
    latestObservation: {
      observationId: "obs_latest",
      runtimeMemoryStateId: "state_1",
      agentId: "agent_main",
      sessionId: "session_sensitive",
      modelName: "gemma4:e4b",
      observedAt: "2026-04-24T18:00:00.000Z",
      sourceKind: "runner",
      observationKind: "correction_rebuild",
      observationRole: "correction_escalated_unstable",
      riskTrend: "recovering",
      recoverySignal: "risk_reduced",
      ctxTokens: 4096,
      sT: 0.71,
      cT: 0.24,
      correctionLevel: "medium",
      correctionRequested: true,
      correctionApplied: false,
      probeCheckedCount: 2,
      probeFailureCount: 1,
      correctionActions: ["reload_authoritative_window", "reanchor_to_tail"],
      instabilityReasons: ["correction_escalated", "probe_runtime_error"],
    },
    latestUnstableObservation: {
      observationId: "obs_unstable_latest",
      sessionId: "session_sensitive",
      correctionActions: ["reload_authoritative_window"],
      instabilityReasons: ["correction_escalated"],
    },
    recent: [
      {
        observationId: "obs_recent",
        runtimeMemoryStateId: "state_1",
        agentId: "agent_main",
        sessionId: "session_sensitive",
        modelName: "gemma4:e4b",
        observedAt: "2026-04-24T18:00:00.000Z",
        sourceKind: "runner",
        observationKind: "correction_rebuild",
        observationRole: "correction_escalated_unstable",
        riskTrend: "recovering",
        recoverySignal: "risk_reduced",
        ctxTokens: 4096,
        sT: 0.71,
        cT: 0.24,
        correctionLevel: "medium",
        correctionRequested: true,
        correctionApplied: false,
        probeCheckedCount: 2,
        probeFailureCount: 1,
        correctionActions: ["reload_authoritative_window"],
        instabilityReasons: ["correction_escalated"],
      },
    ],
  };

  const summaryOnly = redactRuntimeMemoryObservationCollectionSummaryForReadSession(observationSummary, {
    mode: "read_session",
    session: runtimeSummaryObserver.session,
  });
  const metadataOnly = redactRuntimeMemoryObservationCollectionSummaryForReadSession(observationSummary, {
    mode: "read_session",
    session: agentAuditor.session,
  });

  assert.equal(summaryOnly.totalCount, 3);
  assert.equal(summaryOnly.latestObservation?.sessionId, null);
  assert.equal(summaryOnly.latestObservation?.sessionIdRedacted, true);
  assert.equal(summaryOnly.latestObservation?.correctionActions, undefined);
  assert.equal(summaryOnly.latestObservation?.instabilityReasons, undefined);
  assert.equal(summaryOnly.latestObservation?.correctionActionCount, 2);
  assert.equal(summaryOnly.latestObservation?.instabilityReasonCount, 2);
  assert.deepEqual(summaryOnly.recent, []);
  assert.equal(summaryOnly.recentCount, 1);
  assert.equal(summaryOnly.effectiveness?.latestRecoveredPair, null);
  assert.equal(summaryOnly.effectiveness?.latestPendingUnstable, null);
  assert.deepEqual(summaryOnly.effectiveness?.recentRecoveredPairs, []);

  assert.equal(metadataOnly.latestObservation?.sessionId, null);
  assert.equal(metadataOnly.latestObservation?.sessionIdRedacted, true);
  assert.equal(metadataOnly.latestObservation?.correctionActions, undefined);
  assert.equal(metadataOnly.latestObservation?.instabilityReasons, undefined);
  assert.equal(metadataOnly.latestObservation?.correctionActionCount, 2);
  assert.equal(metadataOnly.latestObservation?.instabilityReasonCount, 2);
  assert.equal(Array.isArray(metadataOnly.recent), true);
  assert.equal(metadataOnly.recent.length, 1);
  assert.equal(metadataOnly.recent[0]?.sessionId, null);
  assert.equal(metadataOnly.recent[0]?.correctionActionCount, 1);
  assert.equal(metadataOnly.recent[0]?.instabilityReasonCount, 1);
  assert.equal(metadataOnly.effectiveness?.latestRecoveredPair, null);
  assert.equal(metadataOnly.effectiveness?.latestPendingUnstable, null);
  assert.deepEqual(metadataOnly.effectiveness?.recentRecoveredPairs, []);
});

test("runtime observation summaries canonicalize legacy snake_case payloads before redaction", () => {
  const summaryOnly = redactRuntimeMemoryObservationCollectionSummaryForReadSession(
    {
      total_count: 2,
      stable_count: 1,
      unstable_count: 1,
      role_counts: {
        correction_escalated_unstable: 1,
      },
      effectiveness: {
        correction_requested_count: 2,
        correction_applied_count: 1,
        correction_escalated_count: 1,
        tracked_correction_count: 2,
        recovered_count: 1,
        unresolved_count: 1,
        recovery_rate: 0.5,
        average_c_t_reduction: 0.12,
        average_s_t_gain: 0.08,
        average_lag_observations: 2,
        latest_recovered_pair: { unstableObservationId: "obs_1" },
        recent_recovered_pairs: [{ unstableObservationId: "obs_1" }],
      },
      latest_observation: {
        observation_id: "obs_2",
        runtime_memory_state_id: "state_snake",
        agent_id: "agent_main",
        session_id: "session_snake",
        model_name: "gemma4:e4b",
        observed_at: "2026-04-25T08:00:00.000Z",
        source_kind: "runner",
        observation_kind: "correction_rebuild",
        observation_role: "correction_escalated_unstable",
        risk_trend: "recovering",
        recovery_signal: "risk_reduced",
        ctx_tokens: 2048,
        s_t: 0.62,
        c_t: 0.28,
        correction_level: "medium",
        correction_requested: true,
        correction_applied: false,
        probe_checked_count: 3,
        probe_failure_count: 1,
        correction_actions: ["rewrite_working_memory_summary", "compress_low_value_history"],
        instability_reasons: ["context_pressure"],
      },
      latest_unstable_observation: {
        observation_id: "obs_1",
      },
      recent_observations: [
        {
          observation_id: "obs_recent",
          session_id: "session_recent",
          correction_actions: ["compress_low_value_history"],
          instability_reasons: ["context_pressure"],
        },
      ],
    },
    {
      mode: "read_session",
      session: {
        viewTemplates: {
          agentRuntime: "summary_only",
        },
      },
    }
  );

  assert.equal(summaryOnly.totalCount, 2);
  assert.equal(summaryOnly.stableCount, 1);
  assert.equal(summaryOnly.latestObservation?.observationId, "obs_2");
  assert.equal(summaryOnly.latestObservation?.runtimeMemoryStateId, "state_snake");
  assert.equal(summaryOnly.latestObservation?.modelName, "gemma4:e4b");
  assert.equal(summaryOnly.latestObservation?.observedAt, "2026-04-25T08:00:00.000Z");
  assert.equal(summaryOnly.latestObservation?.ctxTokens, 2048);
  assert.equal(summaryOnly.latestObservation?.sT, 0.62);
  assert.equal(summaryOnly.latestObservation?.cT, 0.28);
  assert.equal(summaryOnly.latestObservation?.correctionLevel, "medium");
  assert.equal(summaryOnly.latestObservation?.sessionId, null);
  assert.equal(summaryOnly.latestObservation?.sessionIdRedacted, true);
  assert.equal(summaryOnly.latestObservation?.correctionActionCount, 2);
  assert.equal(summaryOnly.latestObservation?.instabilityReasonCount, 1);
  assert.equal(summaryOnly.effectiveness?.correctionRequestedCount, 2);
  assert.equal(summaryOnly.effectiveness?.averageCTReduction, 0.12);
  assert.equal(summaryOnly.effectiveness?.averageSTGain, 0.08);
  assert.equal(summaryOnly.effectiveness?.recoveryDetailsRedacted, true);
  assert.equal(summaryOnly.recentCount, 1);
  assert.deepEqual(summaryOnly.recent, []);
});

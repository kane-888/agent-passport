import {
  bootstrapAgentRuntime,
  buildAgentContextBundle,
  checkAgentContextDrift,
  compareAgents,
  compactAgentMemory,
  executeAgentRunner,
  executeAgentSandboxAction,
  executeVerificationRun,
  forkAgent,
  getAgent,
  getAgentComparisonEvidence,
  getAgentCredential,
  getAgentContext,
  getAgentRehydratePack,
  getAgentRuntime,
  getAgentRuntimeSummary,
  getAgentSessionState,
  getAgentCognitiveState,
  grantAsset,
  listAgentCognitiveTransitions,
  listAgentComparisonAudits,
  listAuthorizationProposalsByAgent,
  listCompactBoundaries,
  listConversationMinutes,
  listMessages,
  listMemories,
  listPassportMemories,
  listAgentQueryStates,
  listAgentRuns,
  listVerificationRuns,
  listAgentSandboxActionAudits,
  listAgentTranscript,
  listAgentArchivedRecords,
  listAgentArchiveRestoreEvents,
  revertAgentArchiveRestore,
  restoreAgentArchivedRecord,
  listAgents,
  recordConversationMinute,
  recordDecisionLog,
  recordEvidenceRef,
  recordMemory,
  recordTaskSnapshot,
  registerAgent,
  repairAgentComparisonMigration,
  repairAgentCredentialMigration,
  resolveAgentIdentity,
  runAgentOfflineReplay,
  routeMessage,
  searchAgentRuntimeKnowledge,
  updateAgentPolicy,
  verifyAgentResponse,
  verifyCredential,
  writePassportMemory,
} from "./ledger.js";
import {
  filterReadSessionEntries,
  getContextQueryOptions,
  getDidMethodParam,
  getIssueBothMethodsParam,
  getRequestAccess,
  getSearchParam,
  json,
  toBooleanParam,
} from "./server-base-helpers.js";
import {
  agentMatchesReadSession,
  authorizationMatchesReadSession,
  credentialMatchesReadSession,
  denyReadSessionResource,
  ensureAgentReadAccess,
  ensureReadSessionResource,
  hasReadSessionAccess,
  shouldRedactReadSessionPayload,
} from "./server-read-access.js";
import {
  redactAgentArchiveListingForReadSession,
  redactArchiveRestoreEventForReadSession,
  redactAutoRecoveryAuditForReadSession,
  redactAgentCognitiveStateForReadSession,
  redactAgentContextForReadSession,
  redactAgentRecordForReadSession,
  redactAgentRehydratePackForReadSession,
  redactAgentRunForReadSession,
  redactAgentRuntimeForReadSession,
  redactAuthorizationViewForReadSession,
  redactCompactBoundaryForReadSession,
  redactCognitiveTransitionForReadSession,
  redactConversationMinuteForReadSession,
  redactCredentialRecordForReadSession,
  redactIdentityForReadSession,
  redactMemoryForReadSession,
  redactMessageForReadSession,
  redactPassportMemoryForReadSession,
  redactQueryStateForReadSession,
  redactRuntimeSearchResultForReadSession,
  redactSandboxActionAuditForReadSession,
  redactSessionStateForReadSession,
  redactTranscriptEntryForReadSession,
  redactVerificationRunForReadSession,
  summarizeCredentialDocumentForReadSession,
} from "./server-agent-redaction.js";

function stripSandboxActionAttribution(payload = null) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const {
    sourceWindowId,
    recordedByAgentId,
    recordedByWindowId,
    ...rest
  } = payload;

  return rest;
}

function stripUntrustedAgentRouteAttribution(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const {
    sourceWindowId,
    recordedByAgentId,
    recordedByWindowId,
    updatedByAgentId,
    updatedByWindowId,
    restoredByAgentId,
    restoredByWindowId,
    revertedByAgentId,
    revertedByWindowId,
    ...rest
  } = payload;

  if (rest.sandboxAction) {
    return {
      ...rest,
      sandboxAction: stripSandboxActionAttribution(rest.sandboxAction),
    };
  }

  return rest;
}

function stripUntrustedComparisonRepairIssuer(payload = {}) {
  const trusted = stripUntrustedAgentRouteAttribution(payload);
  const {
    issuerAgentId,
    issuerDid,
    issuerDidMethod,
    issuerWalletAddress,
    ...rest
  } = trusted;
  return rest;
}

export async function handleAgentRoutes({
  req,
  res,
  url,
  pathname,
  segments,
  parseBody,
  jsonForReadSession,
}) {
  const buildContextOptionsForAccess = (access, options = {}) => ({
    ...options,
    ...(hasReadSessionAccess(access)
      ? {
          lightweight: true,
          includeRehydratePreview: false,
        }
      : {}),
  });

  if (req.method === "GET" && pathname === "/api/agents/resolve") {
    const agent = await resolveAgentIdentity({
      agentId: url.searchParams.get("agentId") || undefined,
      did: url.searchParams.get("did") || undefined,
      walletAddress: url.searchParams.get("walletAddress") || undefined,
      windowId: url.searchParams.get("windowId") || undefined,
    });
    const access = getRequestAccess(req);
    if (
      !ensureReadSessionResource(
        res,
        agentMatchesReadSession(access, agent),
        "agent",
        agent?.agentId ||
          url.searchParams.get("agentId") ||
          url.searchParams.get("did") ||
          url.searchParams.get("walletAddress") ||
          url.searchParams.get("windowId")
      )
    ) {
      return;
    }
    return jsonForReadSession(res, access, 200, { agent }, (payload) => ({
      agent: redactAgentRecordForReadSession(payload.agent),
    }));
  }

  if (pathname === "/api/agents/compare") {
    if (req.method === "GET") {
      const comparison = await compareAgents({
        leftAgentId: getSearchParam(url, "leftAgentId"),
        rightAgentId: getSearchParam(url, "rightAgentId"),
        leftDid: getSearchParam(url, "leftDid"),
        rightDid: getSearchParam(url, "rightDid"),
        leftWalletAddress: getSearchParam(url, "leftWalletAddress"),
        rightWalletAddress: getSearchParam(url, "rightWalletAddress"),
        leftWindowId: getSearchParam(url, "leftWindowId"),
        rightWindowId: getSearchParam(url, "rightWindowId"),
        ...getContextQueryOptions(url, { includeRuntimeLimit: false }),
        summaryOnly: toBooleanParam(url.searchParams.get("summaryOnly")),
      });
      return json(res, 200, comparison);
    }
  }

  if (pathname === "/api/agents/compare/evidence") {
    if (req.method === "GET") {
      const evidence = await getAgentComparisonEvidence({
        leftAgentId: getSearchParam(url, "leftAgentId"),
        rightAgentId: getSearchParam(url, "rightAgentId"),
        leftDid: getSearchParam(url, "leftDid"),
        rightDid: getSearchParam(url, "rightDid"),
        leftWalletAddress: getSearchParam(url, "leftWalletAddress"),
        rightWalletAddress: getSearchParam(url, "rightWalletAddress"),
        leftWindowId: getSearchParam(url, "leftWindowId"),
        rightWindowId: getSearchParam(url, "rightWindowId"),
        issuerAgentId: getSearchParam(url, "issuerAgentId"),
        issuerDid: getSearchParam(url, "issuerDid"),
        issuerDidMethod: getSearchParam(url, "issuerDidMethod") || getDidMethodParam(url),
        issuerWalletAddress: getSearchParam(url, "issuerWalletAddress"),
        ...getContextQueryOptions(url, { includeRuntimeLimit: false }),
        summaryOnly: toBooleanParam(url.searchParams.get("summaryOnly")),
        persist: toBooleanParam(url.searchParams.get("persist")),
        issueBothMethods: getIssueBothMethodsParam(url),
      });
      return json(res, 200, evidence);
    }
  }

  if (pathname === "/api/agents/compare/audits") {
    if (req.method === "GET") {
      const audits = await listAgentComparisonAudits({
        leftAgentId: getSearchParam(url, "leftAgentId"),
        rightAgentId: getSearchParam(url, "rightAgentId"),
        leftDid: getSearchParam(url, "leftDid"),
        rightDid: getSearchParam(url, "rightDid"),
        leftWalletAddress: getSearchParam(url, "leftWalletAddress"),
        rightWalletAddress: getSearchParam(url, "rightWalletAddress"),
        leftWindowId: getSearchParam(url, "leftWindowId"),
        rightWindowId: getSearchParam(url, "rightWindowId"),
        issuerAgentId: getSearchParam(url, "issuerAgentId"),
        issuerDid: getSearchParam(url, "issuerDid"),
        didMethod: getSearchParam(url, "issuerDidMethod") || getDidMethodParam(url),
        status: getSearchParam(url, "status"),
        limit: getSearchParam(url, "limit"),
      });
      return json(res, 200, audits);
    }
  }

  if (pathname === "/api/agents/compare/verify") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const verification = await verifyCredential(
        body.credential ?? body.evidence?.credential ?? body.evidence ?? body
      );
      return json(res, 200, { verification });
    }
  }

  if (pathname === "/api/agents/compare/migration/repair") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const repair = await repairAgentComparisonMigration(
        stripUntrustedComparisonRepairIssuer(body)
      );
      return json(res, 200, { repair });
    }
  }

  if (req.method === "GET" && pathname === "/api/agents") {
    const agents = await listAgents();
    const access = getRequestAccess(req);
    const filteredAgents = hasReadSessionAccess(access)
      ? agents.filter((entry) => agentMatchesReadSession(access, entry))
      : agents;
    return jsonForReadSession(res, access, 200, { agents: filteredAgents }, (payload) => ({
      agents: payload.agents.map(redactAgentRecordForReadSession),
    }));
  }

  if (req.method === "POST" && pathname === "/api/agents") {
    const body = await parseBody(req);
    const agent = await registerAgent(body);
    return json(res, 201, { agent });
  }

  if (segments[0] === "api" && segments[1] === "agents" && segments[2]) {
    const agentId = segments[2];
    const action = segments[3];
    const subaction = segments[4];

    if (req.method === "GET" && !action) {
      const agent = await getAgent(agentId);
      const access = getRequestAccess(req);
      if (!ensureReadSessionResource(res, agentMatchesReadSession(access, agent), "agent", agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, { agent }, (payload) => ({
        agent: redactAgentRecordForReadSession(payload.agent),
      }));
    }

    if (req.method === "GET" && action === "identity") {
      const agent = await getAgent(agentId);
      const access = getRequestAccess(req);
      if (!ensureReadSessionResource(res, agentMatchesReadSession(access, agent), "agent", agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, { identity: agent.identity }, (payload) => ({
        identity: redactIdentityForReadSession(payload.identity),
      }));
    }

    if (req.method === "GET" && action === "did") {
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      const context = await getAgentContext(
        agentId,
        buildContextOptionsForAccess(access, getContextQueryOptions(url, { includeDidMethod: true }))
      );
      return jsonForReadSession(
        res,
        access,
        200,
        {
          didDocument: context.didDocument,
          didAliases: context.didAliases,
          identity: context.identity,
        },
        (payload) => ({
          ...payload,
          identity: redactIdentityForReadSession(payload.identity),
        })
      );
    }

    if (req.method === "GET" && action === "credential") {
      const credential = await getAgentCredential(agentId, {
        didMethod: getDidMethodParam(url),
        issueBothMethods: getIssueBothMethodsParam(url),
      });
      const access = getRequestAccess(req);
      if (
        !ensureReadSessionResource(
          res,
          credentialMatchesReadSession(access, credential?.credentialRecord),
          "agent_credential",
          agentId
        )
      ) {
        return;
      }
      return jsonForReadSession(res, access, 200, { credential }, (payload) => ({
        credential: {
          ...payload.credential,
          credential: summarizeCredentialDocumentForReadSession(
            payload.credential?.credential
          ),
          credentialRecord: redactCredentialRecordForReadSession(
            payload.credential?.credentialRecord
          ),
          alternates: Array.isArray(payload.credential?.alternates)
            ? payload.credential.alternates.map((entry) => ({
                ...entry,
                credential: summarizeCredentialDocumentForReadSession(entry?.credential),
                credentialRecord: redactCredentialRecordForReadSession(entry?.credentialRecord),
              }))
            : [],
        },
      }));
    }

    if (req.method === "GET" && action === "assets") {
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      const context = await getAgentContext(
        agentId,
        buildContextOptionsForAccess(access, getContextQueryOptions(url))
      );
      return jsonForReadSession(
        res,
        access,
        200,
        { assets: context.assets, identity: context.identity, counts: context.counts },
        (payload) => ({
          ...payload,
          identity: redactIdentityForReadSession(payload.identity),
        })
      );
    }

    if (req.method === "GET" && action === "context") {
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      const context = await getAgentContext(
        agentId,
        buildContextOptionsForAccess(access, getContextQueryOptions(url, { includeDidMethod: true }))
      );
      return jsonForReadSession(res, access, 200, { context }, (payload) => ({
        context: redactAgentContextForReadSession(payload.context, access),
      }));
    }

    if (req.method === "GET" && action === "runtime" && !subaction) {
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      const runtime = await getAgentRuntime(
        agentId,
        getContextQueryOptions(url, { includeDidMethod: true })
      );
      return jsonForReadSession(res, access, 200, { runtime }, (payload) => ({
        runtime: redactAgentRuntimeForReadSession(payload.runtime, access),
      }));
    }

    if (req.method === "GET" && action === "runtime-summary" && !subaction) {
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      const summary = await getAgentRuntimeSummary(agentId, {
        didMethod: getDidMethodParam(url),
        profile: getSearchParam(url, "profile") || "default",
      });
      return jsonForReadSession(res, access, 200, { summary }, (payload) => ({
        summary: {
          ...payload.summary,
        },
      }));
    }

    if (req.method === "POST" && action === "runtime" && subaction === "snapshot") {
      const body = await parseBody(req);
      const snapshot = await recordTaskSnapshot(agentId, stripUntrustedAgentRouteAttribution(body));
      return json(res, 201, { snapshot });
    }

    if (req.method === "POST" && action === "runtime" && subaction === "bootstrap") {
      const body = await parseBody(req);
      const bootstrap = await bootstrapAgentRuntime(agentId, stripUntrustedAgentRouteAttribution(body), {
        didMethod: getDidMethodParam(url),
      });
      return json(res, 200, bootstrap);
    }

    if (req.method === "POST" && action === "runtime" && subaction === "decisions") {
      const body = await parseBody(req);
      const decision = await recordDecisionLog(agentId, stripUntrustedAgentRouteAttribution(body));
      return json(res, 201, { decision });
    }

    if (req.method === "POST" && action === "runtime" && subaction === "evidence") {
      const body = await parseBody(req);
      const evidenceRef = await recordEvidenceRef(agentId, stripUntrustedAgentRouteAttribution(body));
      return json(res, 201, { evidenceRef });
    }

    if (req.method === "GET" && action === "runtime" && subaction === "minutes") {
      const minutes = await listConversationMinutes(agentId, {
        limit: getSearchParam(url, "limit"),
      });
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, minutes, (payload) => ({
        ...payload,
        minutes: Array.isArray(payload.minutes)
          ? payload.minutes.map(redactConversationMinuteForReadSession)
          : [],
      }));
    }

    if (req.method === "POST" && action === "runtime" && subaction === "minutes") {
      const body = await parseBody(req);
      const minute = await recordConversationMinute(agentId, stripUntrustedAgentRouteAttribution(body));
      return json(res, 201, { minute });
    }

    if (req.method === "GET" && action === "runtime" && subaction === "search") {
      const search = await searchAgentRuntimeKnowledge(agentId, {
        didMethod: getDidMethodParam(url),
        query: getSearchParam(url, "query"),
        limit: getSearchParam(url, "limit"),
        sourceType: getSearchParam(url, "sourceType"),
      });
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, search, (payload) =>
        redactRuntimeSearchResultForReadSession(payload)
      );
    }

    if (req.method === "POST" && action === "runtime" && subaction === "actions") {
      const body = await parseBody(req);
      const sandbox = await executeAgentSandboxAction(agentId, stripUntrustedAgentRouteAttribution(body), {
        didMethod: getDidMethodParam(url),
      });
      return json(res, 200, {
        sandbox,
        constrainedExecution: sandbox,
      });
    }

    if (req.method === "GET" && action === "runtime" && subaction === "actions") {
      const audits = await listAgentSandboxActionAudits(agentId, {
        limit: getSearchParam(url, "limit"),
        capability: getSearchParam(url, "capability"),
        status: getSearchParam(url, "status"),
      });
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, audits, (payload) => ({
        ...payload,
        audits: Array.isArray(payload.audits)
          ? payload.audits.map((entry) =>
              redactSandboxActionAuditForReadSession(entry, access)
            )
          : [],
      }));
    }

    if (req.method === "GET" && action === "runtime" && subaction === "rehydrate") {
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      const rehydrate = await getAgentRehydratePack(
        agentId,
        getContextQueryOptions(url, {
          includeDidMethod: true,
          includeResumeFromCompactBoundaryId: true,
        })
      );
      return jsonForReadSession(res, access, 200, { rehydrate }, (payload) => ({
        rehydrate: redactAgentRehydratePackForReadSession(payload.rehydrate, access),
      }));
    }

    if (req.method === "POST" && action === "runtime" && subaction === "drift-check") {
      const body = await parseBody(req);
      const driftCheck = await checkAgentContextDrift(agentId, body, {
        didMethod: getDidMethodParam(url),
      });
      return json(res, 200, { driftCheck });
    }

    if (req.method === "POST" && action === "migration" && subaction === "repair") {
      const body = await parseBody(req);
      const repair = await repairAgentCredentialMigration(agentId, body);
      return json(res, 200, { repair });
    }

    if (req.method === "GET" && action === "authorizations") {
      const authorizations = await listAuthorizationProposalsByAgent(
        agentId,
        getSearchParam(url, "limit")
      );
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      const filteredAuthorizations = filterReadSessionEntries(
        access,
        authorizations,
        authorizationMatchesReadSession
      );
      return jsonForReadSession(res, access, 200, { authorizations: filteredAuthorizations }, (payload) => ({
        authorizations: Array.isArray(payload.authorizations)
          ? payload.authorizations.map(redactAuthorizationViewForReadSession)
          : [],
      }));
    }

    if (req.method === "GET" && action === "memories") {
      const memories = await listMemories(agentId);
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, { memories }, (payload) => ({
        memories: Array.isArray(payload.memories)
          ? payload.memories.map(redactMemoryForReadSession)
          : [],
      }));
    }

    if (req.method === "POST" && action === "memories") {
      const body = await parseBody(req);
      const memory = await recordMemory(agentId, stripUntrustedAgentRouteAttribution(body));
      return json(res, 201, { memory });
    }

    if (req.method === "GET" && action === "passport-memory") {
      const result = await listPassportMemories(agentId, {
        layer: getSearchParam(url, "layer"),
        kind: getSearchParam(url, "kind"),
        query: getSearchParam(url, "query"),
        limit: getSearchParam(url, "limit"),
      });
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, result, (payload) => ({
        ...payload,
        memories: Array.isArray(payload.memories)
          ? payload.memories.map(redactPassportMemoryForReadSession)
          : [],
      }));
    }

    if (req.method === "POST" && action === "passport-memory") {
      const body = await parseBody(req);
      const memory = await writePassportMemory(agentId, stripUntrustedAgentRouteAttribution(body));
      return json(res, 201, { memory });
    }

    if (req.method === "POST" && action === "memory-compactor") {
      const body = await parseBody(req);
      const result = await compactAgentMemory(agentId, stripUntrustedAgentRouteAttribution(body));
      return json(res, 200, { result });
    }

    if (req.method === "POST" && action === "context-builder") {
      const body = await parseBody(req);
      const contextBuilder = await buildAgentContextBundle(agentId, body, {
        didMethod: getDidMethodParam(url),
      });
      return json(res, 200, { contextBuilder });
    }

    if (req.method === "POST" && action === "response-verify") {
      const body = await parseBody(req);
      const verification = await verifyAgentResponse(agentId, body, {
        didMethod: getDidMethodParam(url),
      });
      return json(res, 200, {
        verification,
        runtimeIntegrity: verification,
      });
    }

    if (req.method === "POST" && action === "offline-replay") {
      const body = await parseBody(req);
      const offlineReplay = await runAgentOfflineReplay(agentId, stripUntrustedAgentRouteAttribution(body), {
        didMethod: getDidMethodParam(url),
      });
      return json(res, 200, {
        offlineReplay,
      });
    }

    if (req.method === "GET" && action === "runner") {
      const runs = await listAgentRuns(agentId, {
        limit: getSearchParam(url, "limit"),
        status: getSearchParam(url, "status"),
      });
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, runs, (payload) => ({
        ...payload,
        runs: Array.isArray(payload.runs)
          ? payload.runs.map(redactAgentRunForReadSession)
          : [],
        autoRecoveryAudits: Array.isArray(payload.autoRecoveryAudits)
          ? payload.autoRecoveryAudits.map(redactAutoRecoveryAuditForReadSession)
          : [],
      }));
    }

    if (req.method === "GET" && action === "query-states") {
      const queryStates = await listAgentQueryStates(agentId, {
        limit: getSearchParam(url, "limit"),
        status: getSearchParam(url, "status"),
      });
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, queryStates, (payload) => ({
        ...payload,
        queryStates: Array.isArray(payload.queryStates)
          ? payload.queryStates.map(redactQueryStateForReadSession)
          : [],
      }));
    }

    if (req.method === "POST" && action === "runner") {
      const body = await parseBody(req);
      const runner = await executeAgentRunner(agentId, {
        autoRecover: body.autoRecover ?? true,
        ...stripUntrustedAgentRouteAttribution(body),
      }, {
        didMethod: getDidMethodParam(url),
      });
      return json(res, 200, { runner });
    }

    if (req.method === "GET" && action === "session-state") {
      const sessionState = await getAgentSessionState(agentId, {
        didMethod: getDidMethodParam(url),
      });
      const access = req.agentPassportAccess || null;
      if (!agentMatchesReadSession(access, { agentId })) {
        return denyReadSessionResource(res, "agent", agentId);
      }
      return json(res, 200, {
        sessionState: shouldRedactReadSessionPayload(access)
          ? redactSessionStateForReadSession(sessionState, access)
          : sessionState,
      });
    }

    if (req.method === "GET" && action === "cognitive-state") {
      const cognitiveState = await getAgentCognitiveState(agentId, {
        didMethod: getDidMethodParam(url),
      });
      const access = req.agentPassportAccess || null;
      if (!agentMatchesReadSession(access, { agentId })) {
        return denyReadSessionResource(res, "agent", agentId);
      }
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? {
              cognitiveState: redactAgentCognitiveStateForReadSession(cognitiveState, access),
              runtimeStateSummary: redactAgentCognitiveStateForReadSession(cognitiveState, access),
            }
          : {
              cognitiveState,
              runtimeStateSummary: cognitiveState,
            }
      );
    }

    if (req.method === "GET" && action === "cognitive-transitions") {
      const transitions = await listAgentCognitiveTransitions(agentId, {
        limit: getSearchParam(url, "limit"),
      });
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, transitions, (payload) => ({
        ...payload,
        transitions: Array.isArray(payload.transitions)
          ? payload.transitions.map((entry) => redactCognitiveTransitionForReadSession(entry, access))
          : [],
      }));
    }

    if (req.method === "GET" && action === "compact-boundaries") {
      const compactBoundaries = await listCompactBoundaries(agentId, {
        limit: getSearchParam(url, "limit"),
      });
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, compactBoundaries, (payload) => ({
        ...payload,
        compactBoundaries: Array.isArray(payload.compactBoundaries)
          ? payload.compactBoundaries.map(redactCompactBoundaryForReadSession)
          : [],
      }));
    }

    if (req.method === "GET" && action === "verification-runs") {
      const verificationRuns = await listVerificationRuns(agentId, {
        limit: url.searchParams.get("limit") || undefined,
        status: url.searchParams.get("status") || undefined,
      });
      const access = req.agentPassportAccess || null;
      if (!agentMatchesReadSession(access, { agentId })) {
        return denyReadSessionResource(res, "agent", agentId);
      }
      return jsonForReadSession(res, access, 200, verificationRuns, (payload) => ({
        ...payload,
        verificationRuns: Array.isArray(payload.verificationRuns)
          ? payload.verificationRuns.map((entry) => redactVerificationRunForReadSession(entry, access))
          : [],
        integrityRuns: Array.isArray(payload.integrityRuns)
          ? payload.integrityRuns.map((entry) => redactVerificationRunForReadSession(entry, access))
          : [],
      }));
    }

    if (req.method === "POST" && action === "verification-runs") {
      const body = await parseBody(req);
      const verification = await executeVerificationRun(agentId, stripUntrustedAgentRouteAttribution(body), {
        didMethod: getDidMethodParam(url),
      });
      return json(res, 200, verification);
    }

    if (req.method === "GET" && action === "transcript") {
      const transcript = await listAgentTranscript(agentId, {
        family: getSearchParam(url, "family"),
        limit: getSearchParam(url, "limit"),
      });
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, transcript, (payload) => ({
        ...payload,
        transcript: payload.transcript
          ? {
              ...payload.transcript,
              entries: Array.isArray(payload.transcript.entries)
                ? payload.transcript.entries.map((entry) =>
                    redactTranscriptEntryForReadSession(entry, access)
                  )
                : [],
            }
          : null,
        entries: Array.isArray(payload.entries)
          ? payload.entries.map((entry) =>
              redactTranscriptEntryForReadSession(entry, access)
            )
          : [],
      }));
    }

    if (req.method === "GET" && action === "archives") {
      const archived = await listAgentArchivedRecords(agentId, {
        kind: getSearchParam(url, "kind"),
        limit: getSearchParam(url, "limit"),
        offset: getSearchParam(url, "offset"),
        query: getSearchParam(url, "query"),
        archivedFrom: getSearchParam(url, "archivedFrom"),
        archivedTo: getSearchParam(url, "archivedTo"),
      });
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, archived, (payload) => ({
        ...redactAgentArchiveListingForReadSession(payload),
        records: Array.isArray(payload.records)
          ? payload.records.map((entry) => ({
              ...entry,
              record:
                payload.kind === "transcript"
                  ? redactTranscriptEntryForReadSession(entry.record, access)
                  : redactPassportMemoryForReadSession(entry.record),
            }))
          : [],
      }));
    }

    if (req.method === "GET" && action === "archive-restores") {
      const restores = await listAgentArchiveRestoreEvents(agentId, {
        limit: getSearchParam(url, "limit"),
        kind: getSearchParam(url, "kind"),
        restoredFrom: getSearchParam(url, "restoredFrom"),
        restoredTo: getSearchParam(url, "restoredTo"),
      });
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, restores, (payload) => ({
        ...payload,
        events: Array.isArray(payload.events)
          ? payload.events.map(redactArchiveRestoreEventForReadSession)
          : [],
        latest: redactArchiveRestoreEventForReadSession(payload.latest),
      }));
    }

    if (req.method === "POST" && action === "archives" && subaction === "restore") {
      const body = await parseBody(req);
      const request = stripUntrustedAgentRouteAttribution(body);
      const restored = await restoreAgentArchivedRecord(agentId, {
        kind: request.kind,
        archiveIndex: request.archiveIndex,
        passportMemoryId: request.passportMemoryId,
        transcriptEntryId: request.transcriptEntryId,
      });
      return json(res, 200, { restored });
    }

    if (req.method === "POST" && action === "archive-restores" && subaction === "revert") {
      const body = await parseBody(req);
      const request = stripUntrustedAgentRouteAttribution(body);
      const reverted = await revertAgentArchiveRestore(agentId, {
        restoredRecordId: request.restoredRecordId,
        restoreEventHash: request.restoreEventHash,
        archiveKind: request.archiveKind,
      });
      return json(res, 200, { reverted });
    }

    if (req.method === "GET" && action === "messages") {
      const messages = await listMessages(agentId);
      const access = getRequestAccess(req);
      if (!ensureAgentReadAccess(res, access, agentId)) {
        return;
      }
      return jsonForReadSession(res, access, 200, messages, (payload) => ({
        inbox: Array.isArray(payload.inbox)
          ? payload.inbox.map(redactMessageForReadSession)
          : [],
        outbox: Array.isArray(payload.outbox)
          ? payload.outbox.map(redactMessageForReadSession)
          : [],
      }));
    }

    if (req.method === "POST" && action === "messages") {
      const body = await parseBody(req);
      const message = await routeMessage(agentId, body, {
        trustExplicitSender: false,
      });
      return json(res, 201, { message });
    }

    if (req.method === "PATCH" && action === "policy") {
      const body = await parseBody(req);
      const agent = await updateAgentPolicy(agentId, body);
      return json(res, 200, { agent });
    }

    if (req.method === "POST" && action === "fork") {
      const body = await parseBody(req);
      const agent = await forkAgent(agentId, body);
      return json(res, 201, { agent });
    }

    if (req.method === "POST" && action === "grants") {
      const body = await parseBody(req);
      const result = await grantAsset(agentId, body);
      return json(res, 201, result);
    }
  }

  return null;
}

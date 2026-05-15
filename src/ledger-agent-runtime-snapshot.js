import {
  cloneJson,
  now,
} from "./ledger-core-utils.js";
import {
  DEFAULT_TRANSCRIPT_LIMIT,
} from "./ledger-transcript-model.js";
import {
  DEFAULT_RUNTIME_RECENT_TURN_LIMIT,
  normalizeRuntimeDriftPolicy,
} from "./ledger-runtime-drift-policy.js";

const DEFAULT_RUNTIME_LIMIT = 10;
const DEFAULT_RUNTIME_REHYDRATE_MEMORY_LIMIT = 6;
const DEFAULT_RUNTIME_REHYDRATE_MESSAGE_LIMIT = 4;
const DEFAULT_RUNTIME_REHYDRATE_CREDENTIAL_LIMIT = 4;
const DEFAULT_RUNTIME_REHYDRATE_AUTHORIZATION_LIMIT = 4;
const DEFAULT_LIGHTWEIGHT_TRANSCRIPT_LIMIT = 8;

function requireDependency(deps = {}, name) {
  const dependency = deps?.[name];
  if (typeof dependency !== "function") {
    throw new TypeError(`${name} dependency is required`);
  }
  return dependency;
}

export function resolveRuntimePolicy(snapshot = null) {
  return normalizeRuntimeDriftPolicy(snapshot?.driftPolicy || {});
}

export function buildAgentRuntimeSnapshot(
  store,
  agent,
  {
    didMethod = null,
    runtimeLimit = DEFAULT_RUNTIME_LIMIT,
    memoryLimit = DEFAULT_RUNTIME_REHYDRATE_MEMORY_LIMIT,
    messageLimit = DEFAULT_RUNTIME_REHYDRATE_MESSAGE_LIMIT,
    authorizationLimit = DEFAULT_RUNTIME_REHYDRATE_AUTHORIZATION_LIMIT,
    credentialLimit = DEFAULT_RUNTIME_REHYDRATE_CREDENTIAL_LIMIT,
    lightweight = false,
    includeRehydratePreview = true,
    transcriptEntryLimit = null,
    memoryStabilityRuntime = null,
  } = {},
  deps = {}
) {
  void messageLimit;
  const defaultChainId = deps.defaultChainId ?? null;
  const defaultLightweightTranscriptLimit =
    deps.defaultLightweightTranscriptLimit ?? DEFAULT_LIGHTWEIGHT_TRANSCRIPT_LIMIT;
  const runtimeMemoryStoreAdapter = deps.runtimeMemoryStoreAdapter ?? null;
  const buildAgentCognitiveStateView = requireDependency(deps, "buildAgentCognitiveStateView");
  const buildDeviceRuntimeView = requireDependency(deps, "buildDeviceRuntimeView");
  const buildModelProfileView = requireDependency(deps, "buildModelProfileView");
  const buildProtocolDescriptor = requireDependency(deps, "buildProtocolDescriptor");
  const buildResidentAgentGate = requireDependency(deps, "buildResidentAgentGate");
  const buildRuntimeBriefing = requireDependency(deps, "buildRuntimeBriefing");
  const buildRuntimeMemoryStateView = requireDependency(deps, "buildRuntimeMemoryStateView");
  const listAgentConversationMinutes = requireDependency(deps, "listAgentConversationMinutes");
  const listAgentDecisionLogs = requireDependency(deps, "listAgentDecisionLogs");
  const listAgentEvidenceRefs = requireDependency(deps, "listAgentEvidenceRefs");
  const listAgentMemories = requireDependency(deps, "listAgentMemories");
  const listAgentTaskSnapshots = requireDependency(deps, "listAgentTaskSnapshots");
  const listAgentTranscriptEntries = requireDependency(deps, "listAgentTranscriptEntries");
  const listAgentWindows = requireDependency(deps, "listAgentWindows");
  const listAuthorizationProposalViews = requireDependency(deps, "listAuthorizationProposalViews");
  const listCredentialRecordViews = requireDependency(deps, "listCredentialRecordViews");
  const listRuntimeMemoryStatesFromStore = requireDependency(deps, "listRuntimeMemoryStatesFromStore");
  const resolveActiveMemoryHomeostasisModelName = requireDependency(
    deps,
    "resolveActiveMemoryHomeostasisModelName"
  );
  const resolveEffectiveAgentCognitiveState = requireDependency(deps, "resolveEffectiveAgentCognitiveState");
  const resolveMemoryStabilityRuntimeContractModelProfile = requireDependency(
    deps,
    "resolveMemoryStabilityRuntimeContractModelProfile"
  );
  const resolveRuntimeMemoryHomeostasisProfile = requireDependency(
    deps,
    "resolveRuntimeMemoryHomeostasisProfile"
  );
  const needsRehydratePreview = Boolean(includeRehydratePreview);
  const snapshots = listAgentTaskSnapshots(store, agent.agentId);
  const taskSnapshots = snapshots.slice(-runtimeLimit);
  const taskSnapshot = snapshots.at(-1) ?? null;
  const effectiveCognitiveState = resolveEffectiveAgentCognitiveState(store, agent, { didMethod });
  const cognitiveStateView = buildAgentCognitiveStateView(effectiveCognitiveState);
  const allDecisions = listAgentDecisionLogs(store, agent.agentId);
  const decisions = allDecisions.slice(-runtimeLimit);
  const activeDecisions = decisions.filter((item) => item.status === "active").slice(-runtimeLimit);
  const allConversationMinutes = listAgentConversationMinutes(store, agent.agentId);
  const conversationMinutes = allConversationMinutes.slice(-runtimeLimit);
  const allEvidenceRefs = listAgentEvidenceRefs(store, agent.agentId);
  const evidenceRefs = allEvidenceRefs.slice(-runtimeLimit);
  const resolvedTranscriptEntryLimit =
    Number.isFinite(Number(transcriptEntryLimit)) && Number(transcriptEntryLimit) > 0
      ? Math.floor(Number(transcriptEntryLimit))
      : lightweight
        ? Math.max(defaultLightweightTranscriptLimit, runtimeLimit)
        : Math.max(DEFAULT_TRANSCRIPT_LIMIT, runtimeLimit * 3);
  const allTranscriptEntries = listAgentTranscriptEntries(store, agent.agentId, {
    limit: resolvedTranscriptEntryLimit,
  });
  const policy = resolveRuntimePolicy(taskSnapshot);
  const deviceRuntime = buildDeviceRuntimeView(store.deviceRuntime, store);
  const runtimeModelName = resolveActiveMemoryHomeostasisModelName(store, {
    localReasoner: deviceRuntime?.localReasoner,
  });
  const contractRuntimeModelProfile = resolveMemoryStabilityRuntimeContractModelProfile(
    memoryStabilityRuntime,
    runtimeModelName
  );
  const runtimeModelProfile = resolveRuntimeMemoryHomeostasisProfile(store, {
    modelName: runtimeModelName,
    runtimePolicy: policy,
    contractProfile: contractRuntimeModelProfile,
  });
  const runtimeMemoryStates = listRuntimeMemoryStatesFromStore(
    store,
    agent.agentId,
    runtimeMemoryStoreAdapter
  );
  const latestRuntimeMemoryState = runtimeMemoryStates.at(-1) ?? null;
  const residentGate = buildResidentAgentGate(store, agent, { didMethod });
  const capabilityBoundary = buildProtocolDescriptor({
    chainId: store.chainId,
    apiBase: "/api",
  }).capabilityBoundary;

  const runtimeSnapshot = {
    taskSnapshot,
    taskSnapshots,
    decisionLogs: decisions,
    conversationMinutes,
    transcript: {
      entryCount: allTranscriptEntries.length,
      latestTranscriptEntryId: allTranscriptEntries.at(-1)?.transcriptEntryId ?? null,
      entries: allTranscriptEntries.slice(-runtimeLimit),
    },
    activeDecisions,
    evidenceRefs,
    policy,
    deviceRuntime,
    capabilityBoundary,
    retrievalPolicy: cloneJson(deviceRuntime.retrievalPolicy) ?? null,
    memoryHomeostasis: {
      modelName: runtimeModelName,
      modelProfile: buildModelProfileView(runtimeModelProfile),
      latestState: latestRuntimeMemoryState ? buildRuntimeMemoryStateView(latestRuntimeMemoryState) : null,
      stateCount: runtimeMemoryStates.length,
    },
    residentGate,
    cognitiveState: cognitiveStateView,
    runtimeStateSummary: cognitiveStateView,
    counts: {
      taskSnapshots: snapshots.length,
      decisionLogs: allDecisions.length,
      conversationMinutes: allConversationMinutes.length,
      evidenceRefs: allEvidenceRefs.length,
      transcriptEntries: allTranscriptEntries.length,
    },
    rehydratePreview: needsRehydratePreview ? (() => {
      const windows = listAgentWindows(store, agent.agentId).slice(-runtimeLimit);
      const memories = listAgentMemories(store, agent.agentId).slice(-memoryLimit);
      const authorizations = listAuthorizationProposalViews(store, { agentId: agent.agentId, limit: authorizationLimit });
      const credentials = listCredentialRecordViews(store, { agentId: agent.agentId, limit: credentialLimit });
      return {
        generatedAt: now(),
        prompt: buildRuntimeBriefing({
          agent,
          snapshot: taskSnapshot,
          decisions: activeDecisions.slice(-5),
          minutes: conversationMinutes.slice(-5),
          transcriptEntries: allTranscriptEntries.slice(-5),
          evidenceRefs: evidenceRefs.slice(-5),
          memories: memories.slice(-3),
          authorizations: authorizations.slice(-3),
          credentials: credentials.slice(-3),
          windows: windows.slice(-3),
          didMethod,
          deviceRuntime,
          defaultChainId,
        }),
        sources: {
          taskSnapshotId: taskSnapshot?.snapshotId ?? null,
          minuteIds: conversationMinutes.map((item) => item.minuteId),
          decisionIds: decisions.map((item) => item.decisionId),
          evidenceRefIds: evidenceRefs.map((item) => item.evidenceRefId),
        },
      };
    })() : {
      generatedAt: now(),
      prompt: null,
      sources: {
        taskSnapshotId: taskSnapshot?.snapshotId ?? null,
        minuteIds: conversationMinutes.map((item) => item.minuteId),
        decisionIds: decisions.map((item) => item.decisionId),
        evidenceRefIds: evidenceRefs.map((item) => item.evidenceRefId),
      },
    },
  };

  if (lightweight) {
    runtimeSnapshot.performanceMode = "lightweight";
  }

  return runtimeSnapshot;
}

export function buildLightweightContextRuntimeSnapshot(
  store,
  agent,
  {
    didMethod = null,
    memoryStabilityRuntime = null,
  } = {},
  deps = {}
) {
  const defaultLightweightTranscriptLimit =
    deps.defaultLightweightTranscriptLimit ?? DEFAULT_LIGHTWEIGHT_TRANSCRIPT_LIMIT;
  return buildAgentRuntimeSnapshot(store, agent, {
    didMethod,
    lightweight: true,
    includeRehydratePreview: false,
    transcriptEntryLimit: Math.max(
      defaultLightweightTranscriptLimit,
      Math.floor((DEFAULT_RUNTIME_RECENT_TURN_LIMIT || 6) * 2)
    ),
    memoryStabilityRuntime,
  }, deps);
}

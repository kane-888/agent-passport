import { now } from "./ledger-core-utils.js";

export function buildMigratedStoreShell(
  store,
  {
    defaultChainId,
    normalizeDeviceRuntime,
  } = {}
) {
  return {
    ...store,
    chainId: store.chainId || defaultChainId,
    createdAt: store.createdAt || now(),
    lastEventHash: store.lastEventHash ?? null,
    nextCredentialStatusIndex: Number.isFinite(Number(store.nextCredentialStatusIndex))
      ? Math.max(0, Math.floor(Number(store.nextCredentialStatusIndex)))
      : 0,
    nextCredentialStatusIndices:
      store.nextCredentialStatusIndices && typeof store.nextCredentialStatusIndices === "object"
        ? { ...store.nextCredentialStatusIndices }
        : {},
    agents: { ...(store.agents || {}) },
    events: Array.isArray(store.events) ? [...store.events] : [],
    windows: { ...(store.windows || {}) },
    memories: Array.isArray(store.memories) ? [...store.memories] : [],
    messages: Array.isArray(store.messages) ? [...store.messages] : [],
    passportMemories: Array.isArray(store.passportMemories) ? [...store.passportMemories] : [],
    conversationMinutes: Array.isArray(store.conversationMinutes) ? [...store.conversationMinutes] : [],
    taskSnapshots: Array.isArray(store.taskSnapshots) ? [...store.taskSnapshots] : [],
    decisionLogs: Array.isArray(store.decisionLogs) ? [...store.decisionLogs] : [],
    evidenceRefs: Array.isArray(store.evidenceRefs) ? [...store.evidenceRefs] : [],
    transcriptEntries: Array.isArray(store.transcriptEntries) ? [...store.transcriptEntries] : [],
    recoveryRehearsals: Array.isArray(store.recoveryRehearsals) ? [...store.recoveryRehearsals] : [],
    readSessions: Array.isArray(store.readSessions) ? [...store.readSessions] : [],
    securityAnomalies: Array.isArray(store.securityAnomalies) ? [...store.securityAnomalies] : [],
    localReasonerProfiles: Array.isArray(store.localReasonerProfiles) ? [...store.localReasonerProfiles] : [],
    sandboxActionAudits: Array.isArray(store.sandboxActionAudits) ? [...store.sandboxActionAudits] : [],
    modelProfiles: Array.isArray(store.modelProfiles) ? [...store.modelProfiles] : [],
    runtimeMemoryStates: Array.isArray(store.runtimeMemoryStates) ? [...store.runtimeMemoryStates] : [],
    runtimeMemoryObservations: Array.isArray(store.runtimeMemoryObservations) ? [...store.runtimeMemoryObservations] : [],
    agentRuns: Array.isArray(store.agentRuns) ? [...store.agentRuns] : [],
    agentQueryStates: Array.isArray(store.agentQueryStates) ? [...store.agentQueryStates] : [],
    agentSessionStates: Array.isArray(store.agentSessionStates) ? [...store.agentSessionStates] : [],
    cognitiveStates: Array.isArray(store.cognitiveStates) ? [...store.cognitiveStates] : [],
    cognitiveTransitions: Array.isArray(store.cognitiveTransitions) ? [...store.cognitiveTransitions] : [],
    goalStates: Array.isArray(store.goalStates) ? [...store.goalStates] : [],
    cognitiveReflections: Array.isArray(store.cognitiveReflections) ? [...store.cognitiveReflections] : [],
    retrievalFeedback: Array.isArray(store.retrievalFeedback) ? [...store.retrievalFeedback] : [],
    memoryConflicts: Array.isArray(store.memoryConflicts) ? [...store.memoryConflicts] : [],
    compactBoundaries: Array.isArray(store.compactBoundaries) ? [...store.compactBoundaries] : [],
    verificationRuns: Array.isArray(store.verificationRuns) ? [...store.verificationRuns] : [],
    deviceRuntime: normalizeDeviceRuntime(store.deviceRuntime),
    proposals: Array.isArray(store.proposals) ? [...store.proposals] : [],
    credentials: Array.isArray(store.credentials) ? [...store.credentials] : [],
    archives:
      store.archives && typeof store.archives === "object"
        ? {
            transcript:
              store.archives.transcript && typeof store.archives.transcript === "object"
                ? { ...store.archives.transcript }
                : {},
            passportMemory:
              store.archives.passportMemory && typeof store.archives.passportMemory === "object"
                ? { ...store.archives.passportMemory }
                : {},
          }
        : {
            transcript: {},
            passportMemory: {},
          },
  };
}

export function didStoreShellChange(store, migrated) {
  return (
    migrated.chainId !== store.chainId ||
    migrated.createdAt !== store.createdAt ||
    migrated.nextCredentialStatusIndex !== store.nextCredentialStatusIndex ||
    !store.nextCredentialStatusIndices ||
    !Array.isArray(store.events) ||
    !store.agents ||
    !store.windows ||
    !Array.isArray(store.memories) ||
    !Array.isArray(store.messages) ||
    !Array.isArray(store.passportMemories) ||
    !Array.isArray(store.conversationMinutes) ||
    !Array.isArray(store.taskSnapshots) ||
    !Array.isArray(store.decisionLogs) ||
    !Array.isArray(store.evidenceRefs) ||
    !Array.isArray(store.transcriptEntries) ||
    !Array.isArray(store.recoveryRehearsals) ||
    !Array.isArray(store.readSessions) ||
    !Array.isArray(store.securityAnomalies) ||
    !Array.isArray(store.localReasonerProfiles) ||
    !Array.isArray(store.sandboxActionAudits) ||
    !Array.isArray(store.modelProfiles) ||
    !Array.isArray(store.runtimeMemoryStates) ||
    !Array.isArray(store.runtimeMemoryObservations) ||
    !Array.isArray(store.agentRuns) ||
    !Array.isArray(store.agentQueryStates) ||
    !Array.isArray(store.agentSessionStates) ||
    !Array.isArray(store.cognitiveStates) ||
    !Array.isArray(store.cognitiveTransitions) ||
    !Array.isArray(store.goalStates) ||
    !Array.isArray(store.cognitiveReflections) ||
    !Array.isArray(store.retrievalFeedback) ||
    !Array.isArray(store.memoryConflicts) ||
    !Array.isArray(store.compactBoundaries) ||
    !Array.isArray(store.verificationRuns) ||
    !store.deviceRuntime ||
    !Array.isArray(store.proposals) ||
    !Array.isArray(store.credentials) ||
    !store.archives
  );
}

export function createInitialStoreShell({
  chainId,
  deviceRuntime,
  createdAt = now(),
} = {}) {
  return {
    chainId,
    createdAt,
    lastEventHash: null,
    nextCredentialStatusIndex: 0,
    nextCredentialStatusIndices: {},
    agents: {},
    events: [],
    windows: {},
    memories: [],
    messages: [],
    passportMemories: [],
    conversationMinutes: [],
    taskSnapshots: [],
    decisionLogs: [],
    evidenceRefs: [],
    transcriptEntries: [],
    recoveryRehearsals: [],
    readSessions: [],
    securityAnomalies: [],
    localReasonerProfiles: [],
    sandboxActionAudits: [],
    modelProfiles: [],
    runtimeMemoryStates: [],
    runtimeMemoryObservations: [],
    agentRuns: [],
    agentQueryStates: [],
    agentSessionStates: [],
    compactBoundaries: [],
    verificationRuns: [],
    deviceRuntime,
    proposals: [],
    credentials: [],
    archives: {
      transcript: {},
      passportMemory: {},
    },
  };
}

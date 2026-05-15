import {
  hashJson,
} from "./ledger-core-utils.js";
import {
  buildCollectionTailToken,
} from "./ledger-derived-cache.js";
import {
  matchesCompatibleAgentId,
} from "./ledger-identity-compat.js";
import {
  listAgentWindows,
} from "./ledger-agent-list-views.js";
import {
  buildCredentialDerivedCollectionToken,
} from "./ledger-credential-cache.js";

export function buildStorePerformanceFingerprint(store, agentId) {
  return hashJson({
    chainId: store.chainId,
    agentId,
    events: (store.events || []).length,
    transcriptEntries: (store.transcriptEntries || []).length,
    passportMemories: (store.passportMemories || []).length,
    modelProfiles: (store.modelProfiles || []).length,
    runtimeMemoryStates: (store.runtimeMemoryStates || []).length,
    agentRuns: (store.agentRuns || []).length,
    agentQueryStates: (store.agentQueryStates || []).length,
    compactBoundaries: (store.compactBoundaries || []).length,
    conversationMinutes: (store.conversationMinutes || []).length,
    evidenceRefs: (store.evidenceRefs || []).length,
    decisions: (store.decisions || []).length,
    lastEventId: store.events?.at(-1)?.eventId ?? null,
    lastTranscriptEntryId: store.transcriptEntries?.at(-1)?.transcriptEntryId ?? null,
    lastPassportMemoryId: store.passportMemories?.at(-1)?.passportMemoryId ?? null,
    lastModelProfileId: store.modelProfiles?.at(-1)?.modelProfileId ?? null,
    lastRuntimeMemoryStateId: store.runtimeMemoryStates?.at(-1)?.runtimeMemoryStateId ?? null,
    lastRunId: store.agentRuns?.at(-1)?.runId ?? null,
    lastCompactBoundaryId: store.compactBoundaries?.at(-1)?.compactBoundaryId ?? null,
  });
}

export function buildAgentContextPerformanceFingerprint(store, agentId) {
  const relatedMessages = (store.messages || []).filter(
    (entry) =>
      matchesCompatibleAgentId(store, entry?.fromAgentId, agentId) ||
      matchesCompatibleAgentId(store, entry?.toAgentId, agentId)
  );
  const relatedWindows = listAgentWindows(store, agentId);
  const relatedAuthorizations = (store.proposals || []).filter((entry) =>
    matchesCompatibleAgentId(store, entry?.policyAgentId, agentId)
  );
  return hashJson({
    performance: buildStorePerformanceFingerprint(store, agentId),
    windows: buildCollectionTailToken(relatedWindows, {
      idFields: ["windowId"],
      timeFields: ["updatedAt", "createdAt"],
    }),
    messages: buildCollectionTailToken(relatedMessages, {
      idFields: ["messageId"],
      timeFields: ["deliveredAt", "createdAt"],
    }),
    authorizations: buildCollectionTailToken(relatedAuthorizations, {
      idFields: ["proposalId"],
      timeFields: ["updatedAt", "createdAt"],
    }),
    credentials: buildCredentialDerivedCollectionToken(store),
  });
}

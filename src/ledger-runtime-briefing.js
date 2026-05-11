import {
  resolveAgentDidForMethod,
} from "./ledger-credential-core.js";

export function buildRuntimeBriefing({
  agent,
  snapshot,
  decisions = [],
  minutes = [],
  transcriptEntries = [],
  evidenceRefs = [],
  memories = [],
  authorizations = [],
  credentials = [],
  windows = [],
  didMethod = null,
  resumeBoundary = null,
  deviceRuntime = null,
  defaultChainId = null,
}) {
  const retrievalPolicy = deviceRuntime?.retrievalPolicy || null;
  const resolvedDid =
    resolveAgentDidForMethod(
      {
        chainId: agent.identity?.chainId ?? defaultChainId,
        agents: { [agent.agentId]: agent },
      },
      agent,
      didMethod
    ) ||
    agent.identity?.did ||
    null;
  const lines = [
    `Agent: ${agent.displayName} (${agent.agentId})`,
    resolvedDid ? `DID: ${resolvedDid}` : null,
    snapshot?.title ? `Task: ${snapshot.title}` : null,
    snapshot?.objective ? `Objective: ${snapshot.objective}` : null,
    snapshot?.status ? `Status: ${snapshot.status}` : null,
    snapshot?.nextAction ? `Next Action: ${snapshot.nextAction}` : null,
    snapshot?.currentPlan?.length ? `Plan: ${snapshot.currentPlan.join(" | ")}` : null,
    snapshot?.constraints?.length ? `Constraints: ${snapshot.constraints.join(" | ")}` : null,
    snapshot?.successCriteria?.length ? `Success: ${snapshot.successCriteria.join(" | ")}` : null,
    snapshot?.driftPolicy?.maxConversationTurns ? `Turn Budget: ${snapshot.driftPolicy.maxConversationTurns}` : null,
    snapshot?.driftPolicy?.maxContextChars ? `Context Budget: ${snapshot.driftPolicy.maxContextChars}` : null,
    snapshot?.driftPolicy?.maxRecentConversationTurns ? `Recent Turns Window: ${snapshot.driftPolicy.maxRecentConversationTurns}` : null,
    snapshot?.driftPolicy?.maxToolResults ? `Tool Results Window: ${snapshot.driftPolicy.maxToolResults}` : null,
    snapshot?.driftPolicy?.maxQueryIterations ? `Query Iterations: ${snapshot.driftPolicy.maxQueryIterations}` : null,
    deviceRuntime?.residentAgentId ? `Resident Agent: ${deviceRuntime.residentAgentId}` : null,
    deviceRuntime?.localMode ? `Local Mode: ${deviceRuntime.localMode}` : null,
    retrievalPolicy?.strategy ? `Retrieval Strategy: ${retrievalPolicy.strategy}` : null,
    retrievalPolicy?.scorer ? `Retrieval Scorer: ${retrievalPolicy.scorer}` : null,
    retrievalPolicy?.allowVectorIndex === false ? "Vector Index: disabled" : null,
    minutes.length ? `Minutes: ${minutes.map((item) => item.title || item.summary || item.minuteId).filter(Boolean).join(" | ")}` : null,
    transcriptEntries.length
      ? `Transcript: ${transcriptEntries.map((item) => item.title || item.summary || item.transcriptEntryId).filter(Boolean).join(" | ")}`
      : null,
    decisions.length ? `Decisions: ${decisions.map((item) => item.summary).filter(Boolean).join(" | ")}` : null,
    evidenceRefs.length ? `Evidence: ${evidenceRefs.map((item) => item.title || item.uri || item.evidenceRefId).filter(Boolean).join(" | ")}` : null,
    memories.length ? `Recent Memories: ${memories.map((item) => item.content).filter(Boolean).join(" | ")}` : null,
    authorizations.length ? `Recent Authorizations: ${authorizations.map((item) => item.title || item.proposalId).filter(Boolean).join(" | ")}` : null,
    credentials.length ? `Recent Credentials: ${credentials.map((item) => item.credentialRecordId || item.credentialId).filter(Boolean).join(" | ")}` : null,
    windows.length ? `Windows: ${windows.map((item) => item.windowId).filter(Boolean).join(" | ")}` : null,
    resumeBoundary?.compactBoundaryId ? `Resume Boundary: ${resumeBoundary.compactBoundaryId}` : null,
    resumeBoundary?.summary ? `Resume Summary: ${resumeBoundary.summary}` : null,
    resumeBoundary?.compactBoundaryId ? "Resume Instruction: continue directly from the boundary without recap or restart chatter." : null,
  ].filter(Boolean);

  return lines.join("\n");
}

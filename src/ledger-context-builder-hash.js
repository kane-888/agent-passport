import {
  hashJson,
  normalizeOptionalText,
} from "./ledger-core-utils.js";

export function buildContextBuilderHash({
  agentId = null,
  didMethod = null,
  resolvedDid = null,
  currentGoal = null,
  resumeBoundaryId = null,
  taskSnapshot = null,
  perceptionQuery = null,
  profileMemories = [],
  episodicMemories = [],
  semanticMemories = [],
  workingMemories = [],
  checkpoints = [],
  ledgerCommitments = [],
  localKnowledgeHits = [],
  externalColdMemoryHits = [],
  conversationMinutes = [],
  transcriptEntries = [],
  recentConversationTurns = [],
  toolResults = [],
  memoryCorrectionLevel = null,
  memoryAnchors = [],
  continuousCognitiveState = null,
} = {}) {
  return hashJson({
    agentId: normalizeOptionalText(agentId) ?? null,
    didMethod: normalizeOptionalText(didMethod) ?? null,
    resolvedDid: normalizeOptionalText(resolvedDid) ?? null,
    currentGoal: normalizeOptionalText(currentGoal) ?? null,
    resumeBoundaryId: normalizeOptionalText(resumeBoundaryId) ?? null,
    taskSnapshot: taskSnapshot
      ? {
          snapshotId: normalizeOptionalText(taskSnapshot.snapshotId) ?? null,
          title: normalizeOptionalText(taskSnapshot.title) ?? null,
          objective: normalizeOptionalText(taskSnapshot.objective) ?? null,
          status: normalizeOptionalText(taskSnapshot.status) ?? null,
          nextAction: normalizeOptionalText(taskSnapshot.nextAction) ?? null,
          checkpointSummary: normalizeOptionalText(taskSnapshot.checkpointSummary) ?? null,
        }
      : null,
    perceptionQuery: normalizeOptionalText(perceptionQuery) ?? null,
    profileMemories: Array.isArray(profileMemories) ? profileMemories : [],
    episodicMemories: Array.isArray(episodicMemories) ? episodicMemories : [],
    semanticMemories: Array.isArray(semanticMemories) ? semanticMemories : [],
    workingMemories: Array.isArray(workingMemories) ? workingMemories : [],
    checkpoints: Array.isArray(checkpoints) ? checkpoints : [],
    ledgerCommitments: Array.isArray(ledgerCommitments) ? ledgerCommitments : [],
    localKnowledgeHits: Array.isArray(localKnowledgeHits) ? localKnowledgeHits : [],
    externalColdMemoryHits: Array.isArray(externalColdMemoryHits) ? externalColdMemoryHits : [],
    conversationMinutes: Array.isArray(conversationMinutes) ? conversationMinutes : [],
    transcriptEntries: Array.isArray(transcriptEntries) ? transcriptEntries : [],
    recentConversationTurns: Array.isArray(recentConversationTurns) ? recentConversationTurns : [],
    toolResults: Array.isArray(toolResults) ? toolResults : [],
    memoryCorrectionLevel: normalizeOptionalText(memoryCorrectionLevel) ?? null,
    memoryAnchors: Array.isArray(memoryAnchors) ? memoryAnchors : [],
    continuousCognitiveState: continuousCognitiveState
      ? {
          mode: normalizeOptionalText(continuousCognitiveState.mode) ?? null,
          dominantStage: normalizeOptionalText(continuousCognitiveState.dominantStage) ?? null,
          transitionReason: normalizeOptionalText(continuousCognitiveState.transitionReason) ?? null,
        }
      : null,
  });
}

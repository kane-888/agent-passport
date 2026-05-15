import {
  cloneJson,
  createRecordId,
  normalizeOptionalText,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  compareTextSimilarity as compareQueryTextSimilarity,
} from "./ledger-text-similarity.js";
import { normalizeDidMethod } from "./protocol.js";

const DEFAULT_QUERY_ITERATION_LIMIT = 4;

export function buildAgentQueryStateView(state) {
  return cloneJson(state) ?? null;
}

export function inferAgentQueryIteration(previousQueryState, currentGoal, explicitIteration, maxQueryIterations) {
  const normalizedExplicit = Math.floor(toFiniteNumber(explicitIteration, NaN));
  if (Number.isFinite(normalizedExplicit) && normalizedExplicit > 0) {
    return normalizedExplicit;
  }

  const previousStatus = normalizeOptionalText(previousQueryState?.status) ?? null;
  if (previousStatus && ["blocked", "bootstrap_required", "resident_locked"].includes(previousStatus)) {
    return 1;
  }

  const previousGoal = normalizeOptionalText(previousQueryState?.currentGoal) ?? null;
  const nextGoal = normalizeOptionalText(currentGoal) ?? null;
  if (!previousGoal || !nextGoal) {
    return 1;
  }

  if (compareQueryTextSimilarity(previousGoal, nextGoal) < 0.75) {
    return 1;
  }

  const previousIteration = Math.max(1, Math.floor(toFiniteNumber(previousQueryState?.currentIteration, 1)));
  return Math.min(previousIteration + 1, Math.max(1, Math.floor(toFiniteNumber(maxQueryIterations, 1))));
}

export function buildAgentQueryStateRecord(
  _store,
  agent,
  {
    didMethod = null,
    currentDidMethod = null,
    currentGoal = null,
    userTurn = null,
    recentConversationTurns = [],
    toolResults = [],
    contextBuilder = null,
    driftCheck = null,
    bootstrapGate = null,
    residentGate = null,
    run = null,
    negotiation = null,
    resumeBoundaryId = null,
    sourceWindowId = null,
    previousQueryState = null,
    queryIteration = null,
    allowBootstrapBypass = false,
    defaultMaxQueryIterations = DEFAULT_QUERY_ITERATION_LIMIT,
  } = {}
) {
  const queryBudget = contextBuilder?.slots?.queryBudget || {};
  const maxQueryIterations = Math.max(
    1,
    Math.floor(toFiniteNumber(contextBuilder?.runtimePolicy?.maxQueryIterations, defaultMaxQueryIterations))
  );
  const currentIteration = inferAgentQueryIteration(previousQueryState, currentGoal, queryIteration, maxQueryIterations);
  const sameQueryChain =
    previousQueryState &&
    compareQueryTextSimilarity(previousQueryState.currentGoal, currentGoal) >= 0.75 &&
    (normalizeOptionalText(previousQueryState.agentId) ?? agent.agentId) === agent.agentId &&
    !["blocked", "bootstrap_required", "resident_locked"].includes(normalizeOptionalText(previousQueryState.status) ?? "");
  const queryStateId = sameQueryChain
    ? normalizeOptionalText(previousQueryState?.queryStateId) || createRecordId("qry")
    : createRecordId("qry");
  const remainingIterations = Math.max(0, maxQueryIterations - currentIteration);
  const truncatedFlags = [];
  if (queryBudget.recentConversationTurnsTruncated) {
    truncatedFlags.push("recent_conversation_turns_truncated");
  }
  if (queryBudget.toolResultsTruncated) {
    truncatedFlags.push("tool_results_truncated");
  }
  if (residentGate?.required && residentGate.code) {
    truncatedFlags.push(residentGate.code);
  }
  if (negotiation?.actionable && negotiation?.decision && !["execute", "continue"].includes(negotiation.decision)) {
    truncatedFlags.push(`negotiation_${negotiation.decision}`);
  }

  const recommendedActions = cloneJson(driftCheck?.recommendedActions) ?? [];
  if (residentGate?.required) {
    recommendedActions.push("claim_resident_agent");
  }
  if (negotiation?.actionable && negotiation?.decision === "confirm") {
    recommendedActions.push("confirm_before_execute");
  }
  if (negotiation?.actionable && negotiation?.decision === "discuss") {
    recommendedActions.push("continue_negotiation");
  }
  if (negotiation?.actionable && negotiation?.decision === "multisig") {
    recommendedActions.push("create_multisig_proposal");
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push("continue_with_current_snapshot");
  }

  return {
    queryStateId,
    agentId: agent.agentId,
    didMethod:
      normalizeDidMethod(didMethod) ||
      normalizeOptionalText(currentDidMethod) ||
      previousQueryState?.didMethod ||
      null,
    status:
      normalizeOptionalText(run?.status) ??
      (bootstrapGate?.required && !allowBootstrapBypass
        ? "bootstrap_required"
        : driftCheck?.requiresRehydrate
          ? "rehydrate_required"
          : "prepared"),
    currentGoal: normalizeOptionalText(currentGoal) ?? null,
    userTurn: normalizeOptionalText(userTurn) ?? null,
    currentIteration,
    maxQueryIterations,
    remainingIterations,
    resumeBoundaryId:
      normalizeOptionalText(resumeBoundaryId) ??
      contextBuilder?.slots?.resumeBoundary?.compactBoundaryId ??
      null,
    input: {
      recentConversationTurnCount: Array.isArray(recentConversationTurns) ? recentConversationTurns.length : 0,
      toolResultCount: Array.isArray(toolResults) ? toolResults.length : 0,
      turnCount: driftCheck?.input?.turnCount ?? 0,
      estimatedContextChars: driftCheck?.input?.estimatedContextChars ?? contextBuilder?.compiledPrompt?.length ?? 0,
      estimatedContextTokens:
        driftCheck?.input?.estimatedContextTokens ??
        contextBuilder?.slots?.queryBudget?.estimatedContextTokens ??
        0,
    },
    budget: {
      maxConversationTurns: contextBuilder?.runtimePolicy?.maxConversationTurns ?? null,
      maxContextChars: contextBuilder?.runtimePolicy?.maxContextChars ?? null,
      maxContextTokens: contextBuilder?.runtimePolicy?.maxContextTokens ?? null,
      maxRecentConversationTurns: queryBudget.maxRecentConversationTurns ?? null,
      maxToolResults: queryBudget.maxToolResults ?? null,
      maxQueryIterations,
      usedRecentConversationTurnCount: queryBudget.usedRecentConversationTurnCount ?? 0,
      usedToolResultCount: queryBudget.usedToolResultCount ?? 0,
      truncatedFlags,
    },
    flags: [
      ...(Array.isArray(driftCheck?.flags) ? driftCheck.flags.map((flag) => flag.code).filter(Boolean) : []),
      ...(residentGate?.required && residentGate.code ? [residentGate.code] : []),
      ...(negotiation?.actionable && negotiation?.decision ? [`negotiation_${negotiation.decision}`] : []),
    ],
    recommendedActions,
    bootstrapRequired: Boolean(bootstrapGate?.required),
    riskTier: negotiation?.riskTier ?? null,
    authorizationStrategy: negotiation?.authorizationStrategy ?? null,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
    createdAt: now(),
  };
}

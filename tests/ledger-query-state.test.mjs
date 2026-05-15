import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentQueryStateRecord,
  buildAgentQueryStateView,
  inferAgentQueryIteration,
} from "../src/ledger-query-state.js";
import {
  compareTextSimilarity,
} from "../src/ledger-text-similarity.js";
import {
  scoreRuntimeSearchCorpus,
  scoreRuntimeSearchHit,
} from "../src/ledger-runtime-search.js";

test("shared text similarity preserves exact, containment, and character-overlap scoring", () => {
  assert.equal(compareTextSimilarity("Runtime Truth", "runtime-truth"), 1);
  assert.equal(compareTextSimilarity("agent passport", "passport"), 8 / 13);
  assert.equal(compareTextSimilarity("abc", "bcd"), 2 / 4);
  assert.equal(compareTextSimilarity("", "abc"), 0);
});

test("runtime search scoring ranks hits and strips raw searchable text", () => {
  assert.equal(scoreRuntimeSearchHit({ text: "anything" }, null), 1);
  assert.equal(
    scoreRuntimeSearchHit(
      {
        sourceType: "external_cold_memory",
        text: "runtime truth",
        providerScore: 1,
      },
      "runtime truth"
    ),
    1.28
  );

  const results = scoreRuntimeSearchCorpus(
    [
      {
        sourceType: "task_snapshot",
        sourceId: "keep",
        text: "runtime truth",
        recordedAt: "2026-05-15T00:00:00.000Z",
      },
      {
        sourceType: "decision",
        sourceId: "drop",
        text: "",
      },
    ],
    "runtime truth",
    {},
    1
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].sourceId, "keep");
  assert.equal("text" in results[0], false);
  assert.equal(results[0].score > 0, true);
});

test("agent query state views are detached clones", () => {
  const state = {
    queryStateId: "qry_1",
    agentId: "agent_1",
    flags: ["runtime"],
    recommendedActions: ["continue"],
    budget: {
      truncatedFlags: ["tool_results_truncated"],
    },
  };

  const view = buildAgentQueryStateView(state);
  assert.deepEqual(view, state);

  view.flags.push("mutated");
  view.recommendedActions[0] = "stop";
  view.budget.truncatedFlags.push("mutated");

  assert.deepEqual(state.flags, ["runtime"]);
  assert.deepEqual(state.recommendedActions, ["continue"]);
  assert.deepEqual(state.budget.truncatedFlags, ["tool_results_truncated"]);
});

test("agent query iteration honors explicit input, blocked resets, and same-goal continuation", () => {
  assert.equal(inferAgentQueryIteration(null, "goal", 3, 4), 3);
  assert.equal(
    inferAgentQueryIteration(
      {
        status: "blocked",
        currentGoal: "same goal",
        currentIteration: 3,
      },
      "same goal",
      null,
      4
    ),
    1
  );
  assert.equal(
    inferAgentQueryIteration(
      {
        status: "prepared",
        currentGoal: "ship query state seam",
        currentIteration: 2,
      },
      "ship query state seam",
      null,
      4
    ),
    3
  );
  assert.equal(
    inferAgentQueryIteration(
      {
        status: "prepared",
        currentGoal: "ship query state seam",
        currentIteration: 4,
      },
      "ship query state seam",
      null,
      4
    ),
    4
  );
  assert.equal(
    inferAgentQueryIteration(
      {
        status: "prepared",
        currentGoal: "ship query state seam",
        currentIteration: 2,
      },
      "different objective",
      null,
      4
    ),
    1
  );
});

test("agent query state records preserve same-chain identity and injected runtime shape", () => {
  const driftCheck = {
    requiresRehydrate: true,
    recommendedActions: ["rehydrate_if_needed"],
    flags: [{ code: "context_heavy" }, { code: null }],
    input: {
      turnCount: 8,
      estimatedContextChars: 1234,
      estimatedContextTokens: 456,
    },
  };
  const record = buildAgentQueryStateRecord(
    {},
    {
      agentId: "agent_1",
    },
    {
      didMethod: "openneed",
      currentDidMethod: "agentpassport",
      currentGoal: "ship query state seam",
      userTurn: "continue",
      recentConversationTurns: [{ id: "turn_1" }, { id: "turn_2" }],
      toolResults: [{ id: "tool_1" }],
      contextBuilder: {
        compiledPrompt: "fallback prompt",
        runtimePolicy: {
          maxConversationTurns: 12,
          maxContextChars: 16000,
          maxContextTokens: 4000,
          maxQueryIterations: 4,
        },
        slots: {
          queryBudget: {
            estimatedContextTokens: 100,
            maxRecentConversationTurns: 6,
            maxToolResults: 3,
            usedRecentConversationTurnCount: 2,
            usedToolResultCount: 1,
            recentConversationTurnsTruncated: true,
            toolResultsTruncated: true,
          },
          resumeBoundary: {
            compactBoundaryId: "cbnd_context",
          },
        },
      },
      driftCheck,
      bootstrapGate: {
        required: true,
      },
      residentGate: {
        required: true,
        code: "resident_locked",
      },
      negotiation: {
        actionable: true,
        decision: "discuss",
        riskTier: "high",
        authorizationStrategy: "resident_only",
      },
      previousQueryState: {
        queryStateId: "qry_existing",
        agentId: "agent_1",
        didMethod: "agentpassport",
        status: "prepared",
        currentGoal: "ship query state seam",
        currentIteration: 2,
      },
      sourceWindowId: "window_1",
      defaultMaxQueryIterations: 4,
    }
  );

  assert.equal(record.queryStateId, "qry_existing");
  assert.equal(record.agentId, "agent_1");
  assert.equal(record.didMethod, "openneed");
  assert.equal(record.status, "bootstrap_required");
  assert.equal(record.currentGoal, "ship query state seam");
  assert.equal(record.userTurn, "continue");
  assert.equal(record.currentIteration, 3);
  assert.equal(record.remainingIterations, 1);
  assert.equal(record.resumeBoundaryId, "cbnd_context");
  assert.deepEqual(record.input, {
    recentConversationTurnCount: 2,
    toolResultCount: 1,
    turnCount: 8,
    estimatedContextChars: 1234,
    estimatedContextTokens: 456,
  });
  assert.deepEqual(record.budget, {
    maxConversationTurns: 12,
    maxContextChars: 16000,
    maxContextTokens: 4000,
    maxRecentConversationTurns: 6,
    maxToolResults: 3,
    maxQueryIterations: 4,
    usedRecentConversationTurnCount: 2,
    usedToolResultCount: 1,
    truncatedFlags: [
      "recent_conversation_turns_truncated",
      "tool_results_truncated",
      "resident_locked",
      "negotiation_discuss",
    ],
  });
  assert.deepEqual(record.flags, ["context_heavy", "resident_locked", "negotiation_discuss"]);
  assert.deepEqual(record.recommendedActions, [
    "rehydrate_if_needed",
    "claim_resident_agent",
    "continue_negotiation",
  ]);
  assert.equal(record.bootstrapRequired, true);
  assert.equal(record.riskTier, "high");
  assert.equal(record.authorizationStrategy, "resident_only");
  assert.equal(record.sourceWindowId, "window_1");
  assert.match(record.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  driftCheck.recommendedActions.push("mutated");
  assert.deepEqual(record.recommendedActions, [
    "rehydrate_if_needed",
    "claim_resident_agent",
    "continue_negotiation",
  ]);
});

test("agent query state records start fresh when chain is blocked and fallback to continue action", () => {
  const record = buildAgentQueryStateRecord(
    {},
    { agentId: "agent_1" },
    {
      currentGoal: "new goal",
      contextBuilder: {
        compiledPrompt: "hello",
        runtimePolicy: {
          maxQueryIterations: 2,
        },
      },
      previousQueryState: {
        queryStateId: "qry_blocked",
        agentId: "agent_1",
        status: "blocked",
        currentGoal: "new goal",
        currentIteration: 2,
      },
      allowBootstrapBypass: true,
    }
  );

  assert.match(record.queryStateId, /^qry_/);
  assert.notEqual(record.queryStateId, "qry_blocked");
  assert.equal(record.didMethod, "agentpassport");
  assert.equal(record.status, "prepared");
  assert.equal(record.currentIteration, 1);
  assert.equal(record.remainingIterations, 1);
  assert.deepEqual(record.recommendedActions, ["continue_with_current_snapshot"]);
  assert.deepEqual(record.input, {
    recentConversationTurnCount: 0,
    toolResultCount: 0,
    turnCount: 0,
    estimatedContextChars: 5,
    estimatedContextTokens: 0,
  });
});

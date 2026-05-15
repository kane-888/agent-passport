import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentSessionStateRecord,
  buildAgentSessionStateView,
  buildRuntimeBootstrapGate,
  buildRuntimeBootstrapGatePreview,
} from "../src/ledger-runtime-state.js";
import {
  DEFAULT_RUNTIME_QUERY_ITERATION_LIMIT,
  DEFAULT_RUNTIME_RECENT_TURN_LIMIT,
  DEFAULT_RUNTIME_TOOL_RESULT_LIMIT,
  DEFAULT_RUNTIME_TURN_LIMIT,
  normalizeRuntimeDriftPolicy,
} from "../src/ledger-runtime-drift-policy.js";
import {
  buildContextContinuousCognitiveStateView,
  buildContextExternalColdMemoryView,
  buildContextLocalKnowledgeView,
  summarizePromptToolResult,
  summarizePromptTranscriptEntry,
} from "../src/ledger-context-prompt-views.js";
import {
  buildCognitiveLoopSnapshot,
  buildPerceptionSnapshot,
  buildSourceMonitoringSnapshot,
  isExternalLikeSupport,
  isLowRealitySupport,
  summarizePromptMemoryEntry,
} from "../src/ledger-source-monitoring-views.js";
import {
  buildAgentCognitiveStateView,
  buildCognitiveTransitionRecord,
  buildContinuousCognitiveState,
  extractPreferenceSignalsFromText,
  extractStablePreferences,
  inferCognitiveMode,
  resolveEffectiveAgentCognitiveState,
} from "../src/ledger-cognitive-state.js";

test("context prompt views summarize local and external knowledge without widening sources", () => {
  const runtimeKnowledge = {
    query: "runtime truth",
    sourceType: "task_snapshot",
    suggestedResumeBoundaryId: "cbnd_1",
    counts: {
      localCorpusTotal: 4,
      externalCandidateTotal: 2,
    },
    retrieval: {
      strategy: "local_first_non_vector",
      scorer: "lexical_v1",
      localFirst: true,
      externalColdMemoryEnabled: true,
      externalColdMemoryProvider: "mempalace",
      externalColdMemoryUsed: true,
      externalColdMemoryMethod: "candidate_scan",
      externalColdMemoryError: "",
      maxHits: "3",
    },
  };

  const local = buildContextLocalKnowledgeView(
    runtimeKnowledge,
    [{ sourceType: "task_snapshot", sourceId: "snap_1", summary: "Task context", score: 0.7 }],
    [{ sourceType: "external_cold_memory", sourceId: "cold_1" }]
  );
  const external = buildContextExternalColdMemoryView(runtimeKnowledge, [
    {
      sourceType: "external_cold_memory",
      sourceId: "cold_1",
      text: "Cold hint",
      linked: { provider: "mempalace", sourceFile: "cold.json" },
    },
  ]);

  assert.equal(local.sourceType, "task_snapshot");
  assert.equal(local.counts.localCorpusTotal, 4);
  assert.equal(local.counts.externalMatched, 1);
  assert.equal(local.retrieval.maxHits, 3);
  assert.deepEqual(local.counts.bySource, { task_snapshot: 1 });
  assert.equal(external.candidateOnly, true);
  assert.equal(external.provider, "mempalace");
  assert.equal(external.hits[0].provenance.sourceFile, "cold.json");
  assert.deepEqual(external.counts.bySource, { external_cold_memory: 1 });
});

test("context prompt views summarize cognitive, tool, and transcript prompts", () => {
  const cognitive = buildContextContinuousCognitiveStateView({
    mode: "focused",
    continuityScore: "0.8",
    bodyLoop: { taskBacklog: "3" },
    replayOrchestration: {
      shouldReplay: true,
      replayMode: "offline",
      targetTraceClasses: "goal; preference; tool; evidence; repair; release; overflow",
    },
    updatedAt: "2026-05-15T00:00:00.000Z",
  });

  assert.equal(cognitive.mode, "focused");
  assert.equal(cognitive.continuityScore, 0.8);
  assert.equal(cognitive.bodyLoop.taskBacklog, 3);
  assert.deepEqual(cognitive.replayOrchestration.targetTraceClasses, [
    "goal",
    "preference",
    "tool",
    "evidence",
    "repair",
    "release",
  ]);
  assert.deepEqual(summarizePromptToolResult({ name: "search", output: "done" }), {
    tool: "search",
    result: "done",
  });
  assert.equal(
    summarizePromptTranscriptEntry({ transcriptEntryId: "tr_1", content: "x".repeat(320) }).summary.length,
    280
  );
});

test("source monitoring prompt views preserve memory caution and cognitive-loop shapes", () => {
  const perceived = {
    memoryId: "mem_perceived",
    passportMemoryId: "pm_perceived",
    layer: "working",
    kind: "conversation_turn",
    summary: "Observed statement",
    sourceType: "perceived",
    consolidationState: "hot",
    salience: "0.7",
    confidence: "0.8",
    memoryDynamics: {
      eligibilityTraceScore: "0.5",
      reconsolidationState: "destabilized",
    },
  };
  const inferred = {
    passportMemoryId: "pm_inferred",
    layer: "semantic",
    summary: "Inferred pattern",
    sourceType: "inferred",
    sourceFeatures: {
      realityMonitoringScore: 0.2,
      internalGenerationRisk: 0.8,
    },
  };
  const verified = {
    passportMemoryId: "pm_verified",
    layer: "ledger",
    summary: "Verified fact",
    sourceType: "verified",
    sourceFeatures: {
      realityMonitoringScore: 0.9,
      internalGenerationRisk: 0.1,
    },
  };

  assert.equal(isExternalLikeSupport(verified), true);
  assert.equal(isLowRealitySupport(inferred), true);

  const summary = summarizePromptMemoryEntry(perceived);
  assert.equal(summary.id, "mem_perceived");
  assert.equal(summary.salience, 0.7);
  assert.equal(summary.eligibilityTraceScore, 0.5);

  const perception = buildPerceptionSnapshot({
    query: "runtime",
    recentConversationTurns: [{ role: "user", content: "x".repeat(300) }],
    toolResults: [{ name: "search", output: "done" }],
    knowledgeHits: [{ sourceType: "task_snapshot", sourceId: "snap_1", summary: "Task" }],
    conversationMinutes: [{ minuteId: "min_1", transcript: "Minute text" }],
  });
  assert.equal(perception.incomingTurns[0].content.length, 240);
  assert.equal(perception.toolSignals[0].tool, "search");
  assert.equal(perception.knowledgeSignals[0].sourceId, "snap_1");
  assert.equal(perception.minuteSignals[0].minuteId, "min_1");

  const sourceMonitoring = buildSourceMonitoringSnapshot({
    working: [perceived],
    semantic: [inferred],
    profile: [verified],
  });
  assert.equal(sourceMonitoring.counts.total, 3);
  assert.equal(sourceMonitoring.counts.perceived, 1);
  assert.equal(sourceMonitoring.inferredFacts.length, 1);
  assert.equal(sourceMonitoring.counts.externalLike, 2);
  assert.equal(sourceMonitoring.counts.lowReality, 1);
  assert.equal(sourceMonitoring.counts.internallyGenerated, 1);
  assert.equal(sourceMonitoring.destabilizedMemories[0].id, "pm_perceived");
  assert.equal(sourceMonitoring.cautions.some((item) => item.includes("derived / inferred")), true);

  const loop = buildCognitiveLoopSnapshot({
    currentGoal: "ship",
    identitySnapshot: { agentId: "agent_1", did: "did:agent:1", profile: { role: "operator" } },
    working: { taskSnapshot: { snapshotId: "snap_1" }, recentConversationTurns: [{}, {}], checkpoints: [{}] },
    episodic: [{ summary: "event" }],
    semantic: [{ summary: "schema" }],
    ledgerFacts: { facts: [{}] },
    perception,
  });
  assert.deepEqual(loop.sequence, ["perception", "working", "episodic", "semantic", "identity"]);
  assert.equal(loop.perceptionSummary.toolSignalCount, 1);
  assert.equal(loop.workingSummary.recentTurnCount, 2);
  assert.equal(loop.identitySummary.profileFieldCount, 1);
});

test("cognitive state helpers infer modes, preferences, and detached views", () => {
  assert.deepEqual(
    extractStablePreferences({ stable_preferences: "本地优先, 简洁\n风险确认" }),
    ["本地优先", "简洁", "风险确认"]
  );
  assert.deepEqual(
    extractPreferenceSignalsFromText("本地优先，谨慎确认，恢复上下文，简洁"),
    [
      "prefer_local_first",
      "prefer_risk_confirmation",
      "prefer_checkpoint_resume",
      "prefer_compact_context",
    ]
  );

  assert.equal(inferCognitiveMode({ residentGate: { required: true } }), "resident_locked");
  assert.equal(inferCognitiveMode({ bootstrapGate: { required: true } }), "bootstrap_required");
  assert.equal(inferCognitiveMode({ verification: { valid: false } }), "self_calibrating");
  assert.equal(inferCognitiveMode({ driftCheck: { requiresRehydrate: true } }), "recovering");
  assert.equal(inferCognitiveMode({ queryState: { currentIteration: 2 } }), "learning");
  assert.equal(inferCognitiveMode(), "stable");

  const sourceState = {
    cognitiveStateId: "cog_1",
    mode: "recovering",
    dominantStage: "episodic",
    preferenceProfile: {
      inferredPreferences: ["prefer_checkpoint_resume"],
    },
  };
  const view = buildAgentCognitiveStateView(sourceState);
  assert.equal(view.runtimeStateSummaryId, "cog_1");
  assert.equal(view.runtimeStateMode, "recovering");
  assert.equal(view.runtimeStateStage, "episodic");

  view.preferenceProfile.inferredPreferences.push("mutated");
  assert.deepEqual(sourceState.preferenceProfile.inferredPreferences, ["prefer_checkpoint_resume"]);
});

test("continuous cognitive state uses injected store readers without changing shape", () => {
  const store = {
    cognitiveStates: [],
    cognitiveTransitions: [
      {
        transitionId: "cogtr_existing",
        agentId: "agent_1",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ],
    messages: [
      {
        messageId: "msg_1",
        toAgentId: "agent_1",
        content: "用户否决，需要复核",
        createdAt: "2026-05-14T00:01:00.000Z",
      },
    ],
    deviceRuntime: {
      localMode: "local_only",
    },
    events: [],
  };
  const agent = { agentId: "agent_1" };
  const state = buildContinuousCognitiveState(
    store,
    agent,
    {
      didMethod: "agentpassport",
      contextBuilder: {
        slots: {
          currentGoal: "ship runtime cleanup",
          queryBudget: {
            recentConversationTurnsTruncated: true,
          },
        },
        memoryLayers: {
          profile: {
            fieldValues: {
              stable_preferences: "本地优先, 简洁",
              long_term_goal: "stable local runtime",
            },
          },
          counts: {
            working: 4,
            episodic: 2,
          },
        },
      },
      driftCheck: {
        driftScore: 2,
        requiresRehydrate: true,
      },
      verification: {
        valid: true,
      },
      queryState: {
        currentIteration: 2,
        budget: {
          truncatedFlags: ["recent_turns"],
        },
      },
      negotiation: {
        riskLevel: "high",
      },
      preferenceSignals: ["manual_signal"],
      run: {
        runId: "run_1",
        status: "prepared",
      },
      compactBoundary: {
        compactBoundaryId: "cbnd_1",
      },
      sourceWindowId: "window_1",
      transitionReason: "test_transition",
    },
    {
      listAgentPassportMemories: () => [],
      listAgentRunsFromStore: () => [{ runId: "run_prev" }],
      listAgentVerificationRunsFromStore: () => [{ status: "failed" }],
    }
  );

  assert.equal(state.agentId, "agent_1");
  assert.equal(state.didMethod, "agentpassport");
  assert.equal(state.currentGoal, "ship runtime cleanup");
  assert.equal(state.mode, "recovering");
  assert.equal(state.dominantStage, "episodic");
  assert.equal(state.stageWeights.episodic, 1.24);
  assert.equal(state.adaptation.totalTransitions, 2);
  assert.deepEqual(state.signals.truncatedFlags, ["recent_turns"]);
  assert.equal(state.signals.latestCompactBoundaryId, "cbnd_1");
  assert.equal(state.transitionReason, "test_transition");
  assert.equal(state.preferenceProfile.longTermGoal, "stable local runtime");
  assert.deepEqual(state.preferenceProfile.stablePreferences, ["本地优先", "简洁"]);
  assert.equal(state.preferenceProfile.inferredPreferences.includes("prefer_local_first"), true);
  assert.equal(state.preferenceProfile.inferredPreferences.includes("prefer_checkpoint_resume"), true);
  assert.equal(state.preferenceProfile.inferredPreferences.includes("prefer_compact_context"), true);
  assert.equal(state.bodyLoop.humanVetoRate, 1);

  const transition = buildCognitiveTransitionRecord(
    agent,
    { cognitiveStateId: "cog_previous", mode: "stable", dominantStage: "working" },
    state,
    {
      run: { runId: "run_1" },
      queryState: { currentIteration: 2 },
      driftCheck: { driftScore: 2 },
    }
  );
  assert.equal(transition.fromStateId, "cog_previous");
  assert.equal(transition.toStateId, state.cognitiveStateId);
  assert.equal(transition.toMode, "recovering");
  assert.equal(transition.queryIteration, 2);
  assert.equal(transition.runId, "run_1");
  assert.equal(transition.transitionReason, "test_transition");
});

test("effective cognitive state prefers persisted state and can fall back through injected readers", () => {
  const agent = {
    agentId: "agent_1",
    displayName: "Kane",
    role: "owner",
  };
  const persisted = {
    cognitiveStateId: "cog_persisted",
    agentId: "agent_1",
    mode: "stable",
    dominantStage: "working",
    updatedAt: "2026-05-14T00:00:00.000Z",
  };
  const persistedState = resolveEffectiveAgentCognitiveState(
    {
      cognitiveStates: [persisted],
      cognitiveTransitions: [],
      messages: [],
      deviceRuntime: { residentLocked: false },
      events: [],
    },
    agent,
    { didMethod: "agentpassport" }
  );
  assert.equal(persistedState.cognitiveStateId, "cog_persisted");

  const fallbackState = resolveEffectiveAgentCognitiveState(
    {
      cognitiveStates: [],
      cognitiveTransitions: [],
      messages: [],
      deviceRuntime: { residentLocked: false },
      events: [],
    },
    agent,
    { didMethod: "agentpassport" },
    {
      listAgentRunsFromStore: () => [
        {
          runId: "run_latest",
          status: "rehydrate_required",
          driftCheck: { requiresRehydrate: true, driftScore: 1 },
        },
      ],
      listAgentQueryStatesFromStore: () => [
        {
          queryStateId: "qstate_latest",
          currentIteration: 1,
          sourceWindowId: "window_query",
        },
      ],
      listAgentGoalStatesFromStore: () => [
        {
          goalStateId: "goal_latest",
          sourceWindowId: "window_goal",
        },
      ],
      listAgentCompactBoundariesFromStore: () => [
        {
          compactBoundaryId: "cbnd_latest",
        },
      ],
      listAgentPassportMemories: () => [],
      listAgentVerificationRunsFromStore: () => [],
    }
  );
  assert.equal(fallbackState.mode, "bootstrap_required");
  assert.equal(fallbackState.signals.latestRunId, "run_latest");
  assert.equal(fallbackState.signals.latestCompactBoundaryId, "cbnd_latest");
  assert.equal(fallbackState.sourceWindowId, "window_query");
});

test("runtime drift policy normalization clamps limits and keeps default risk vocabulary", () => {
  const defaults = normalizeRuntimeDriftPolicy();

  assert.equal(defaults.maxConversationTurns, DEFAULT_RUNTIME_TURN_LIMIT);
  assert.equal(defaults.maxRecentConversationTurns, DEFAULT_RUNTIME_RECENT_TURN_LIMIT);
  assert.equal(defaults.maxToolResults, DEFAULT_RUNTIME_TOOL_RESULT_LIMIT);
  assert.equal(defaults.maxQueryIterations, DEFAULT_RUNTIME_QUERY_ITERATION_LIMIT);
  assert.ok(defaults.highRiskActionKeywords.includes("repair"));

  const clamped = normalizeRuntimeDriftPolicy({
    maxConversationTurns: 0,
    maxContextChars: 900,
    maxContextTokens: 200,
    driftScoreLimit: 0,
    maxRecentConversationTurns: -1,
    maxToolResults: 0,
    maxQueryIterations: 0,
    highRiskActionKeywords: "approve; rollback",
  });

  assert.equal(clamped.maxConversationTurns, 1);
  assert.equal(clamped.maxContextChars, 1000);
  assert.equal(clamped.maxContextTokens, 256);
  assert.equal(clamped.driftScoreLimit, 1);
  assert.equal(clamped.maxRecentConversationTurns, 1);
  assert.equal(clamped.maxToolResults, 1);
  assert.equal(clamped.maxQueryIterations, 1);
  assert.deepEqual(clamped.highRiskActionKeywords, ["approve", "rollback"]);
});

test("runtime bootstrap gate fails closed when minimum context is missing", () => {
  const gate = buildRuntimeBootstrapGate(null, null);

  assert.equal(gate.required, true);
  assert.deepEqual(gate.missingRequiredCodes, [
    "task_snapshot_present",
    "profile_name_present",
    "profile_role_present",
  ]);
  assert.equal(gate.recommendation, "run_bootstrap");
  assert.equal(gate.checks.find((check) => check.code === "runtime_truth_source_commitment").passed, false);
});

test("runtime bootstrap gate passes required checks and reports truth-source commitments", () => {
  const gate = buildRuntimeBootstrapGate(null, null, {
    contextBuilder: {
      slots: {
        identitySnapshot: {
          taskSnapshot: { snapshotId: "snap_1" },
          profile: {
            name: "Kane",
            role: "owner",
          },
        },
      },
      memoryLayers: {
        ledger: {
          commitments: [
            { status: "active", payload: { field: "runtime_truth_source" } },
            { status: "superseded", payload: { field: "runtime_truth_source" } },
          ],
        },
      },
    },
  });

  assert.equal(gate.required, false);
  assert.deepEqual(gate.missingRequiredCodes, []);
  assert.equal(gate.recommendation, "continue");
  assert.equal(gate.checks.find((check) => check.code === "runtime_truth_source_commitment").passed, true);
  assert.deepEqual(gate.checks.find((check) => check.code === "runtime_truth_source_commitment").evidence, {
    commitmentCount: 2,
  });
});

test("runtime bootstrap preview uses injected task snapshot lookup and does not scan commitments", () => {
  const agent = {
    agentId: "agent_1",
    displayName: "Kane",
    role: "owner",
    identity: {
      profile: {
        name: "Fallback",
        role: "Fallback Role",
      },
    },
  };
  const gate = buildRuntimeBootstrapGatePreview(
    {},
    agent,
    {
      latestAgentTaskSnapshot: (_store, agentId) => ({ snapshotId: `snap_for_${agentId}` }),
    }
  );

  assert.equal(gate.required, false);
  assert.deepEqual(gate.missingRequiredCodes, []);
  assert.equal(gate.recommendation, "continue");
  assert.deepEqual(gate.checks.map((check) => [check.code, check.passed]), [
    ["task_snapshot_present", true],
    ["profile_name_present", true],
    ["profile_role_present", true],
    ["runtime_truth_source_commitment", false],
  ]);
  assert.deepEqual(gate.checks.find((check) => check.code === "runtime_truth_source_commitment").evidence, {
    previewOnly: true,
  });
});

test("agent session state views are detached clones", () => {
  const state = {
    sessionStateId: "sess_1",
    agentId: "agent_1",
    queryState: {
      flags: ["runtime"],
    },
    negotiation: {
      decision: "discuss",
    },
    memoryHomeostasis: {
      memoryAnchors: [{ id: "anchor_1" }],
    },
  };

  const view = buildAgentSessionStateView(state);
  assert.deepEqual(view, state);

  view.queryState.flags.push("mutated");
  view.negotiation.decision = "execute";
  view.memoryHomeostasis.memoryAnchors[0].id = "anchor_2";

  assert.deepEqual(state.queryState.flags, ["runtime"]);
  assert.equal(state.negotiation.decision, "discuss");
  assert.equal(state.memoryHomeostasis.memoryAnchors[0].id, "anchor_1");
});

test("agent session state records preserve existing fallbacks and injected runtime fields", () => {
  const existing = {
    sessionStateId: "sess_existing",
    didMethod: "agentpassport",
    currentGoal: "existing goal",
    currentTaskSnapshotId: "snap_existing",
    latestRunId: "run_existing",
    latestRunStatus: "blocked",
    latestVerificationValid: false,
    latestDriftScore: 0.4,
    latestCompactBoundaryId: "cbnd_existing",
    latestResumeBoundaryId: "cbnd_resume_existing",
    latestQueryStateId: "qstate_existing",
    latestNegotiationId: "nego_existing",
    latestNegotiationDecision: "discuss",
    tokenBudgetState: {
      estimatedContextChars: 10,
      estimatedContextTokens: 3,
      maxConversationTurns: 4,
      maxContextChars: 1000,
      maxContextTokens: 250,
      maxRecentConversationTurns: 2,
      maxToolResults: 1,
      maxQueryIterations: 1,
      driftScoreLimit: 2,
    },
    queryState: { flags: ["existing"], recommendedActions: ["wait"], budget: { remaining: 1 } },
    cognitiveState: { cognitiveStateId: "cog_existing", mode: "steady", stageWeights: { focus: 1 } },
    memoryHomeostasis: { runtimeMemoryStateId: "mh_existing", memoryAnchors: [{ id: "anchor_existing" }] },
    transitionReason: "existing_transition",
    sourceWindowId: "window_existing",
  };

  const record = buildAgentSessionStateRecord(
    {
      agentId: "agent_1",
      identity: {
        authorizationPolicy: {
          type: "governed",
        },
      },
    },
    {
      existing,
      currentDid: "did:agentpassport:agent_1",
      currentDidMethod: "agentpassport",
      runtime: {
        taskSnapshot: {
          snapshotId: "snap_runtime",
          title: "runtime title",
          objective: "runtime objective",
        },
        policy: {
          maxConversationTurns: 8,
          maxContextChars: 1600,
          maxContextTokens: 400,
          maxRecentConversationTurns: 5,
          maxToolResults: 3,
          maxQueryIterations: 2,
          driftScoreLimit: 4,
        },
      },
      memoryCounts: {
        profile: 1,
        episodic: 2,
        working: 3,
        ledgerCommitments: 4,
      },
      compactBoundaries: [{ compactBoundaryId: "cbnd_tail" }],
      residentGate: {
        residentAgentId: "agent_1",
        required: false,
      },
      deviceRuntime: {
        localMode: "local_only",
      },
      activeWindowIds: ["window_1"],
    }
  );

  assert.equal(record.sessionStateId, "sess_existing");
  assert.equal(record.currentGoal, "existing goal");
  assert.equal(record.currentTaskSnapshotId, "snap_runtime");
  assert.equal(record.latestCompactBoundaryId, "cbnd_existing");
  assert.equal(record.latestResumeBoundaryId, "cbnd_resume_existing");
  assert.equal(record.latestQueryStateId, "qstate_existing");
  assert.equal(record.latestNegotiationId, "nego_existing");
  assert.equal(record.latestNegotiationDecision, "discuss");
  assert.equal(record.compactBoundaryCount, 1);
  assert.deepEqual(record.activeWindowIds, ["window_1"]);
  assert.equal(record.residentAgentId, "agent_1");
  assert.equal(record.residentLockRequired, false);
  assert.equal(record.localMode, "local_only");
  assert.equal(record.tokenBudgetState.estimatedContextChars, 10);
  assert.equal(record.tokenBudgetState.maxConversationTurns, 8);
  assert.deepEqual(record.memoryCounts, { profile: 1, episodic: 2, working: 3, ledgerCommitments: 4 });
  assert.deepEqual(record.queryState.flags, ["existing"]);
  assert.deepEqual(record.cognitiveState.stageWeights, { focus: 1 });
  assert.deepEqual(record.memoryHomeostasis.memoryAnchors, [{ id: "anchor_existing" }]);
  assert.equal(record.transitionReason, "existing_transition");
  assert.equal(record.sourceWindowId, "window_existing");

  existing.queryState.flags.push("mutated");
  existing.cognitiveState.stageWeights.focus = 2;
  existing.memoryHomeostasis.memoryAnchors[0].id = "mutated";
  assert.deepEqual(record.queryState.flags, ["existing"]);
  assert.deepEqual(record.cognitiveState.stageWeights, { focus: 1 });
  assert.deepEqual(record.memoryHomeostasis.memoryAnchors, [{ id: "anchor_existing" }]);
});

test("agent session state records trim fresh runtime inputs and clone nested state", () => {
  const queryState = {
    agentId: "query_agent",
    didMethod: "agentpassport",
    queryStateId: "qstate_1",
    status: "running",
    currentGoal: "goal",
    currentIteration: 1,
    maxQueryIterations: 3,
    remainingIterations: 2,
    flags: ["needs_context"],
    recommendedActions: ["retrieve"],
    budget: { remainingTokens: 120 },
    extra: "ignored",
  };
  const negotiation = {
    negotiationId: "nego_1",
    interactionMode: "confirm",
    executionMode: "manual",
    requestedAction: "Run",
    decision: "approved",
    riskLevel: "medium",
    extra: "ignored",
  };
  const cognitiveState = {
    cognitiveStateId: "cog_1",
    mode: "focused",
    dominantStage: "reasoning",
    continuityScore: 0.8,
    calibrationScore: 0.7,
    recoveryReadinessScore: 0.6,
    stageWeights: { reasoning: 1 },
    preferenceProfile: { tone: "direct" },
    adaptation: { speed: "fast" },
    goalState: { goalStateId: "goal_1" },
    selfEvaluation: { ok: true },
    strategyProfile: { strategy: "local_first" },
    signals: { signal: "stable" },
    extra: "ignored",
  };
  const runtimeMemoryState = {
    runtimeMemoryStateId: "mhstate_1",
    modelName: "local",
    ctxTokens: 1024,
    checkedMemories: 5,
    conflictMemories: 1,
    vT: 0.1,
    lT: 0.2,
    rPosT: 0.3,
    xT: 0.4,
    sT: 0.5,
    cT: 0.6,
    correctionLevel: "light",
    placementStrategy: { mode: "near_prompt_end" },
    profile: { model: "test" },
    memoryAnchors: [{ id: "anchor_1" }],
    updatedAt: "2026-05-05T00:00:00.000Z",
    extra: "ignored",
  };

  const record = buildAgentSessionStateRecord(
    {
      agentId: "agent_1",
      identity: {},
    },
    {
      didMethod: "openneed",
      currentDid: "did:agentpassport:agent_1",
      currentDidMethod: "agentpassport",
      currentGoal: "fresh goal",
      contextBuilder: {
        compiledPrompt: "hello",
        slots: {
          queryBudget: {
            estimatedContextTokens: 7,
          },
          resumeBoundary: {
            compactBoundaryId: "cbnd_context",
          },
        },
      },
      driftCheck: {
        driftScore: 0.25,
      },
      run: {
        runId: "run_1",
        status: "blocked",
        verification: {
          valid: true,
        },
      },
      queryState,
      negotiation,
      cognitiveState,
      compactBoundary: {
        compactBoundaryId: "cbnd_current",
      },
      compactBoundaries: [{ compactBoundaryId: "cbnd_tail" }],
      runtime: {
        taskSnapshot: {
          snapshotId: "snap_1",
          objective: "runtime objective",
        },
        policy: {
          maxConversationTurns: 10,
          maxContextChars: 16000,
          maxContextTokens: 4000,
          maxRecentConversationTurns: 6,
          maxToolResults: 4,
          maxQueryIterations: 3,
          driftScoreLimit: 2,
        },
      },
      memoryCounts: {
        profile: 1,
        episodic: 2,
        working: 3,
        ledgerCommitments: 4,
      },
      residentGate: {
        residentAgentId: "agent_1",
        required: true,
      },
      deviceRuntime: {
        localMode: "online_enhanced",
      },
      activeWindowIds: ["window_1"],
      runtimeMemoryState,
      transitionReason: null,
      sourceWindowId: "window_source",
    }
  );

  assert.match(record.sessionStateId, /^sess_/);
  assert.equal(record.didMethod, "openneed");
  assert.equal(record.did, "did:agentpassport:agent_1");
  assert.equal(record.currentGoal, "fresh goal");
  assert.equal(record.currentTaskSnapshotId, "snap_1");
  assert.equal(record.latestRunId, "run_1");
  assert.equal(record.latestRunStatus, "blocked");
  assert.equal(record.latestVerificationValid, true);
  assert.equal(record.latestDriftScore, 0.25);
  assert.equal(record.latestCompactBoundaryId, "cbnd_current");
  assert.equal(record.latestResumeBoundaryId, "cbnd_context");
  assert.equal(record.latestQueryStateId, "qstate_1");
  assert.equal(record.latestNegotiationId, "nego_1");
  assert.equal(record.latestNegotiationDecision, "approved");
  assert.equal(record.currentPermissionMode, "governed");
  assert.equal(record.residentLockRequired, true);
  assert.equal(record.localMode, "online_enhanced");
  assert.deepEqual(record.tokenBudgetState, {
    estimatedContextChars: 5,
    estimatedContextTokens: 7,
    maxConversationTurns: 10,
    maxContextChars: 16000,
    maxContextTokens: 4000,
    maxRecentConversationTurns: 6,
    maxToolResults: 4,
    maxQueryIterations: 3,
    driftScoreLimit: 2,
  });
  assert.equal(Object.hasOwn(record.queryState, "extra"), false);
  assert.equal(Object.hasOwn(record.negotiation, "extra"), false);
  assert.equal(record.negotiation.shouldExecute, false);
  assert.equal(Object.hasOwn(record.cognitiveState, "extra"), false);
  assert.equal(record.latestRuntimeMemoryStateId, "mhstate_1");
  assert.equal(Object.hasOwn(record.memoryHomeostasis, "extra"), false);
  assert.equal(record.transitionReason, "checkpoint_rollover");
  assert.equal(record.sourceWindowId, "window_source");

  queryState.flags.push("mutated");
  negotiation.decision = "mutated";
  cognitiveState.stageWeights.reasoning = 2;
  runtimeMemoryState.memoryAnchors[0].id = "mutated";
  assert.deepEqual(record.queryState.flags, ["needs_context"]);
  assert.equal(record.negotiation.decision, "approved");
  assert.deepEqual(record.cognitiveState.stageWeights, { reasoning: 1 });
  assert.deepEqual(record.memoryHomeostasis.memoryAnchors, [{ id: "anchor_1" }]);
});

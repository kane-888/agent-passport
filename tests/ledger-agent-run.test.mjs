import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentRunView,
  buildAgentRunnerRecord,
  buildStoredRunnerReasonerMetadata,
  normalizeAgentRunStatus,
} from "../src/ledger-agent-run.js";

function buildMinimalRunStatus(options = {}) {
  return buildAgentRunnerRecord(
    {},
    { agentId: "agent_1", identity: {} },
    {
      didMethod: "agentpassport",
      ...options,
    }
  ).status;
}

test("agent run statuses normalize unknown values to prepared", () => {
  assert.equal(normalizeAgentRunStatus("COMPLETED"), "completed");
  assert.equal(normalizeAgentRunStatus(" resident_locked "), "resident_locked");
  assert.equal(normalizeAgentRunStatus("unknown"), "prepared");
  assert.equal(normalizeAgentRunStatus(null), "prepared");
});

test("agent run views are detached clones", () => {
  const run = {
    runId: "run_1",
    status: "completed",
    nested: {
      values: ["original"],
    },
  };
  const view = buildAgentRunView(run);

  run.nested.values.push("mutated");

  assert.deepEqual(view, {
    runId: "run_1",
    status: "completed",
    nested: {
      values: ["original"],
    },
  });
  assert.notEqual(view, run);
});

test("runner reasoner metadata normalizes stored fields", () => {
  assert.equal(buildStoredRunnerReasonerMetadata(null), null);
  assert.equal(buildStoredRunnerReasonerMetadata({}), null);

  const metadata = buildStoredRunnerReasonerMetadata({
    requestedProvider: "HTTP",
    effectiveProvider: "openai_compatible",
    fallbackProvider: "local_mock",
    fallbackActivated: "yes",
    degradedLocalFallback: "0",
    initialError: " initial failure ",
    onlineAllowed: "true",
    qualityEscalationAttempted: "1",
    qualityEscalationActivated: "false",
    qualityEscalationProvider: "ollama_local",
    qualityEscalationIssueCodes: ["low_confidence", "", null, "missing_source"],
    qualityEscalationInitialVerificationValid: "yes",
    memoryStabilityCorrectionLevel: "severe",
    memoryStabilityRiskScore: 2,
    memoryStabilitySignalSource: "preflight",
  });

  assert.equal(metadata.requestedProvider, "http");
  assert.equal(metadata.effectiveProvider, "openai_compatible");
  assert.equal(metadata.fallbackProvider, "local_mock");
  assert.equal(metadata.fallbackActivated, true);
  assert.equal(metadata.degradedLocalFallback, false);
  assert.equal(metadata.initialError, "initial failure");
  assert.equal(metadata.onlineAllowed, true);
  assert.equal(metadata.qualityEscalationAttempted, true);
  assert.equal(metadata.qualityEscalationActivated, false);
  assert.equal(metadata.qualityEscalationProvider, "ollama_local");
  assert.deepEqual(metadata.qualityEscalationIssueCodes, ["low_confidence", "missing_source"]);
  assert.equal(metadata.qualityEscalationInitialVerificationValid, true);
  assert.equal(metadata.memoryStabilityCorrectionLevel, "strong");
  assert.equal(metadata.memoryStabilityRiskScore, 1);
  assert.equal(metadata.memoryStabilitySignalSource, "preflight");
});

test("agent runner records preserve run shape and detach nested inputs", () => {
  const agent = {
    agentId: "agent_1",
    parentAgentId: "agent_parent",
    identity: {
      authorizationPolicy: {
        threshold: "2",
      },
    },
  };
  const recentConversationTurns = [{ role: "user", content: "original turn" }];
  const toolResults = [{ tool: "fs", output: { path: "/tmp/a" } }];
  const driftCheck = {
    driftScore: 0.25,
    requiresRehydrate: false,
    requiresHumanReview: false,
    recommendedActions: ["continue"],
    flags: [{ code: "context_ok" }, { code: null }],
  };
  const queryState = {
    queryStateId: "qry_1",
    status: "prepared",
    currentIteration: 2,
    maxQueryIterations: 4,
    remainingIterations: 2,
    flags: ["query_budget_ok"],
    recommendedActions: ["continue_with_current_snapshot"],
    budget: { maxQueryIterations: 4 },
  };
  const negotiation = {
    negotiationId: "neg_1",
    interactionMode: "conversation",
    executionMode: "discuss",
    requestedAction: "answer",
    actionable: true,
    decision: "continue",
    shouldExecute: false,
    requiresMultisig: true,
    shouldUseOnlineReasoner: true,
    riskLevel: "medium",
    riskTier: "tier_2",
    riskKeywords: ["deploy"],
    matchedKeywordGroups: { deploy: ["deploy"] },
    authorizationStrategy: "multisig",
    recommendedNextStep: "continue",
    notes: ["note_1"],
  };
  const checkpoint = {
    triggered: true,
    archivedCount: 3,
    retainedCount: 6,
    candidateCount: 9,
    checkpointMemoryId: "mem_checkpoint",
    archivedKinds: ["working"],
    activeWorkingCount: 12,
  };
  const record = buildAgentRunnerRecord({}, agent, {
    didMethod: "openneed",
    currentGoal: " ship the seam ",
    userTurn: " keep going ",
    candidateResponse: "done",
    recentConversationTurns,
    toolResults,
    contextBuilder: {
      contextHash: "ctx_hash",
      slots: {
        identitySnapshot: {
          did: "did:openneed:agent_1",
          profile: {
            name: "Agent One",
            role: "Operator",
            specialty: "runtime",
          },
          taskSnapshot: {
            snapshotId: "snap_1",
          },
        },
        resumeBoundary: {
          compactBoundaryId: "cb_1",
        },
      },
      memoryLayers: {
        counts: {
          episodic: 2,
          working: 3,
          ledgerCommitments: 4,
        },
      },
    },
    driftCheck,
    verification: {
      valid: true,
      issues: [],
    },
    bootstrapGate: {
      required: false,
      recommendation: "continue",
      missingRequiredCodes: [],
    },
    residentGate: {
      required: false,
      code: null,
      residentAgentId: "agent_resident",
      localMode: "local_first",
      allowOnlineReasoner: true,
    },
    queryState,
    negotiation,
    compaction: {
      writeCount: 1,
      byLayer: { working: 1 },
      byKind: { note: 1 },
      passportMemoryIds: ["mem_1"],
    },
    reasoner: {
      provider: "http",
      model: "runner-model",
      responseGenerated: true,
      metadata: {
        effectiveProvider: "http",
        memoryStabilityCorrectionLevel: "2",
        memoryStabilityRiskScore: -1,
      },
    },
    sandboxExecution: {
      capability: "filesystem",
      status: "completed",
      executed: true,
      writeCount: 1,
      output: { ok: true },
    },
    checkpoint,
    checkpointDefaults: {
      threshold: 12,
      retainCount: 6,
    },
    goalState: { currentGoal: "ship" },
    selfEvaluation: { confidence: 0.9 },
    strategyProfile: { strategyName: "direct" },
    maintenance: { replay: { status: "skipped" } },
    sourceWindowId: "win_1",
    recordedByAgentId: "agent_recorder",
    recordedByWindowId: "win_recorder",
    runnerGuard: {
      failClosed: "false",
      explicitRequestKinds: "probe;guard",
    },
  });

  recentConversationTurns[0].content = "mutated";
  toolResults[0].output.path = "/tmp/mutated";
  driftCheck.recommendedActions.push("mutated");
  queryState.flags.push("mutated");
  negotiation.riskKeywords.push("mutated");
  checkpoint.archivedKinds.push("mutated");

  assert.match(record.runId, /^run_[0-9a-f-]+$/);
  assert.equal(record.agentId, "agent_1");
  assert.equal(record.didMethod, "openneed");
  assert.equal(record.status, "completed");
  assert.equal(record.currentGoal, "ship the seam");
  assert.equal(record.userTurn, "keep going");
  assert.equal(record.candidateResponse, "done");
  assert.equal(record.contextHash, "ctx_hash");
  assert.deepEqual(record.contextSummary, {
    did: "did:openneed:agent_1",
    taskSnapshotId: "snap_1",
    resumeBoundaryId: "cb_1",
    profileName: "Agent One",
    profileRole: "Operator",
    profileFieldCount: 3,
    episodicCount: 2,
    workingCount: 3,
    ledgerCommitmentCount: 4,
    recentConversationTurnCount: 1,
    toolResultCount: 1,
    queryStateId: "qry_1",
    negotiationId: "neg_1",
  });
  assert.deepEqual(record.driftCheck.recommendedActions, ["continue"]);
  assert.deepEqual(record.driftCheck.flags, ["context_ok"]);
  assert.deepEqual(record.queryState.flags, ["query_budget_ok"]);
  assert.equal(record.queryState.riskTier, "tier_2");
  assert.equal(record.queryState.authorizationStrategy, "multisig");
  assert.deepEqual(record.negotiation.riskKeywords, ["deploy"]);
  assert.equal(record.checkpoint.threshold, 12);
  assert.equal(record.checkpoint.retainCount, 6);
  assert.deepEqual(record.checkpoint.archivedKinds, ["working"]);
  assert.equal(record.reasoner.metadata.memoryStabilityCorrectionLevel, "medium");
  assert.equal(record.reasoner.metadata.memoryStabilityRiskScore, 0);
  assert.deepEqual(record.runnerGuard.explicitRequestKinds, ["probe", "guard"]);
  assert.deepEqual(record.toolResults, [{ tool: "fs", output: { path: "/tmp/a" } }]);
  assert.deepEqual(record.recentConversationTurns, [{ role: "user", content: "original turn" }]);
  assert.deepEqual(record.references, {
    did: "did:openneed:agent_1",
    parentAgentId: "agent_parent",
    authorizationThreshold: 2,
  });
  assert.match(record.executedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("agent runner records keep status priority", () => {
  assert.equal(buildMinimalRunStatus({ residentGate: { required: true } }), "resident_locked");
  assert.equal(buildMinimalRunStatus({ bootstrapGate: { required: true } }), "bootstrap_required");
  assert.equal(
    buildMinimalRunStatus({
      bootstrapGate: { required: true },
      allowBootstrapBypass: true,
    }),
    "prepared"
  );
  assert.equal(buildMinimalRunStatus({ runnerGuard: { failClosed: true } }), "blocked");
  assert.equal(
    buildMinimalRunStatus({
      negotiation: {
        actionable: true,
        decision: "blocked",
      },
    }),
    "blocked"
  );
  assert.equal(
    buildMinimalRunStatus({
      negotiation: {
        actionable: true,
        decision: "confirm",
      },
    }),
    "negotiation_required"
  );
  assert.equal(buildMinimalRunStatus({ reasoner: { error: "needs operator" } }), "needs_human_review");
  assert.equal(buildMinimalRunStatus({ sandboxExecution: { error: "denied" } }), "blocked");
  assert.equal(buildMinimalRunStatus(), "prepared");
  assert.equal(
    buildMinimalRunStatus({
      candidateResponse: "answer",
      verification: { valid: false },
    }),
    "blocked"
  );
  assert.equal(
    buildMinimalRunStatus({
      candidateResponse: "answer",
      verification: { valid: true },
      driftCheck: { requiresHumanReview: true },
    }),
    "needs_human_review"
  );
  assert.equal(
    buildMinimalRunStatus({
      candidateResponse: "answer",
      verification: { valid: true },
      driftCheck: { requiresRehydrate: true },
    }),
    "rehydrate_required"
  );
  assert.equal(
    buildMinimalRunStatus({
      candidateResponse: "answer",
      verification: { valid: true },
    }),
    "completed"
  );
});

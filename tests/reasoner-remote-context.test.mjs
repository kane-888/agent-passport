import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

import { buildRemoteReasonerContext, generateAgentRunnerCandidateResponse } from "../src/reasoner.js";

test("buildRemoteReasonerContext redacts mutable fields without deep-cloning the full context bundle", () => {
  const contextBuilder = {
    agentId: "agent_test",
    compiledPrompt: "LOCAL KNOWLEDGE HITS\n[{\"summary\":\"Alice likes tea\"}]",
    memoryLayers: {
      relevant: {
        semantic: [
          {
            passportMemoryId: "mem_semantic_1",
            summary: "Alice likes tea",
            payload: {
              field: "preference.drink",
              value: "tea",
            },
          },
        ],
      },
    },
    localKnowledge: {
      retrieval: {
        strategy: "local_first",
      },
      hits: [
        {
          sourceType: "passport_memory",
          sourceId: "mem_semantic_1",
          title: "Drink preference",
          summary: "Alice likes tea",
        },
      ],
    },
    externalColdMemory: {
      provider: "mempalace",
      hits: [
        {
          sourceId: "cold_1",
          summary: "cold memory candidate",
        },
      ],
    },
    slots: {
      queryBudget: {
        maxContextTokens: 4096,
      },
      perceptionSnapshot: {
        query: "Alice",
      },
      externalColdMemory: {
        provider: "mempalace",
        used: true,
        hits: [
          {
            sourceId: "cold_1",
            summary: "cold memory candidate",
          },
        ],
      },
      identitySnapshot: {
        agentId: "agent_test",
      },
    },
  };

  const remoteContext = buildRemoteReasonerContext(contextBuilder);

  assert.notEqual(remoteContext, contextBuilder);
  assert.notEqual(remoteContext?.slots, contextBuilder?.slots);
  assert.notEqual(remoteContext?.slots?.queryBudget, contextBuilder?.slots?.queryBudget);
  assert.equal(remoteContext?.memoryLayers, contextBuilder?.memoryLayers);
  assert.equal(remoteContext?.localKnowledge, contextBuilder?.localKnowledge);
  assert.equal(remoteContext?.slots?.identitySnapshot, contextBuilder?.slots?.identitySnapshot);
  assert.deepEqual(remoteContext?.externalColdMemory, {
    redactedForRemoteReasoner: true,
  });
  assert.deepEqual(remoteContext?.slots?.externalColdMemory, {
    redactedForRemoteReasoner: true,
  });
  assert.equal(remoteContext?.slots?.queryBudget?.redactedForRemoteReasoner, true);
  assert.equal(contextBuilder?.slots?.queryBudget?.redactedForRemoteReasoner, undefined);
  assert.equal(contextBuilder?.externalColdMemory?.provider, "mempalace");
  assert.equal(contextBuilder?.slots?.externalColdMemory?.provider, "mempalace");
  assert.equal(typeof remoteContext?.compiledPrompt, "string");
  assert.equal(typeof contextBuilder?.compiledPrompt, "string");
});

test("buildRemoteReasonerContext keeps only sanitized remote prompt sections in stable order", () => {
  const contextBuilder = {
    compiledPrompt: [
      "CURRENT GOAL",
      "Keep memory stable",
      "",
      "PERCEPTION SNAPSHOT",
      "{\"incomingTurns\":[{\"role\":\"user\",\"content\":\"Remember Alice likes tea\",\"sourceId\":\"turn_1\"}],\"toolSignals\":[{\"tool\":\"memory_probe\",\"result\":\"Tea preference confirmed\",\"sourceId\":\"tool_1\"}],\"snapshotId\":\"snap_1\"}",
      "",
      "LOCAL KNOWLEDGE HITS",
      "[{\"title\":\"Drink preference\",\"summary\":\"Alice likes tea\",\"sourceId\":\"mem_1\",\"text\":\"full text should not pass through\"}]",
      "",
      "SOURCE MONITORING",
      "{\"counts\":{\"verified\":1},\"cautions\":[\"low_reality\",\"reported_only\"]}",
      "",
      "IDENTITY LAYER",
      "{\"taskSnapshot\":{\"snapshotId\":\"snap_1\",\"title\":\"Keep memory stable\",\"objective\":\"Reduce collapse risk\",\"status\":\"in_progress\",\"nextAction\":\"Re-anchor memory\"}}",
      "",
      "QUERY BUDGET",
      "{\"maxContextTokens\":4096}",
    ].join("\n"),
    localKnowledge: {
      hits: [
        {
          sourceType: "passport_memory",
          sourceId: "mem_1",
          title: "Drink preference",
          summary: "Alice likes tea",
        },
      ],
    },
    slots: {
      perceptionSnapshot: {
        incomingTurns: [
          {
            role: "user",
            content: "Remember Alice likes tea",
          },
        ],
        toolSignals: [
          {
            tool: "memory_probe",
            result: "Tea preference confirmed",
          },
        ],
      },
    },
  };

  const remoteContext = buildRemoteReasonerContext(contextBuilder);

  assert.equal(
    remoteContext?.compiledPrompt,
    [
      "OBSERVED INPUT",
      "{\"incomingTurns\":[{\"role\":\"user\",\"content\":\"Remember Alice likes tea\"}],\"toolSignals\":[{\"tool\":\"memory_probe\",\"result\":\"Tea preference confirmed\"}]}",
      "",
      "RELEVANT CONTEXT",
      "[{\"title\":\"Drink preference\",\"summary\":\"Alice likes tea\"}]",
      "",
      "CAUTION CUES",
      "{\"cautionCount\":2}",
      "",
      "TASK FRAME",
      "{\"title\":\"Keep memory stable\",\"objective\":\"Reduce collapse risk\",\"status\":\"in_progress\",\"nextAction\":\"Re-anchor memory\"}",
    ].join("\n")
  );
  assert.equal(String(remoteContext?.compiledPrompt || "").includes("CURRENT GOAL"), false);
  assert.equal(String(remoteContext?.compiledPrompt || "").includes("QUERY BUDGET"), false);
  assert.equal(String(remoteContext?.compiledPrompt || "").includes("sourceId"), false);
  assert.equal(String(remoteContext?.compiledPrompt || "").includes("full text should not pass through"), false);
});

test("generateAgentRunnerCandidateResponse sends compact remote payload without mutating the original context bundle", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const contextBuilder = {
    agentId: "agent_test",
    contextHash: "ctx_hash_test",
    compiledPrompt: [
      "IDENTITY LAYER",
      "{\"taskSnapshot\":{\"title\":\"Keep memory stable\",\"objective\":\"Reduce collapse risk\",\"status\":\"in_progress\",\"nextAction\":\"Re-anchor memory\"}}",
      "",
      "LOCAL KNOWLEDGE HITS",
      "[{\"title\":\"Drink preference\",\"summary\":\"Alice likes tea\",\"linked\":{\"provider\":\"local\"},\"text\":\"full text should not pass through\"}]",
    ].join("\n"),
    memoryLayers: {
      relevant: {
        semantic: [
          {
            passportMemoryId: "mem_semantic_1",
            summary: "Alice likes tea",
          },
        ],
      },
    },
    localKnowledge: {
      retrieval: {
        strategy: "local_first",
        scorer: "bm25",
        hitCount: 1,
      },
      hits: [
        {
          sourceType: "passport_memory",
          sourceId: "mem_semantic_1",
          title: "Drink preference",
          summary: "Alice likes tea",
          linked: {
            provider: "local",
          },
          text: "full text should not pass through",
        },
      ],
    },
    externalColdMemory: {
      provider: "mempalace",
      enabled: true,
      used: true,
      hitCount: 1,
      hits: [
        {
          sourceType: "external_cold_memory",
          sourceId: "cold_1",
          title: "Cold candidate",
          summary: "candidate line",
          linked: {
            provider: "mempalace",
            sourceFile: "vault.json",
          },
          text: "cold full text should not pass through",
        },
      ],
    },
    slots: {
      currentGoal: "Keep memory stable",
      identitySnapshot: {
        agentId: "agent_test",
        taskSnapshot: {
          snapshotId: "snap_1",
          title: "Keep memory stable",
          objective: "Reduce collapse risk",
          status: "in_progress",
          nextAction: "Re-anchor memory",
        },
      },
      perceptionSnapshot: {
        query: "what do you remember",
      },
      queryBudget: {
        maxContextTokens: 4096,
      },
      transcriptModel: {
        entryCount: 12,
        entries: [
          {
            transcriptEntryId: "tx_1",
            summary: "full transcript row",
          },
        ],
      },
      externalColdMemory: {
        provider: "mempalace",
        hits: [
          {
            sourceId: "cold_1",
            summary: "candidate line",
          },
        ],
      },
      localKnowledgeHits: [
        {
          sourceType: "passport_memory",
          sourceId: "mem_semantic_1",
          title: "Drink preference",
          summary: "Alice likes tea",
          linked: {
            provider: "local",
          },
        },
      ],
    },
  };

  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      options,
    });
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === "content-type" ? "application/json" : null;
        },
      },
      async json() {
        return {
          responseText: "ok",
          model: "mock-http-reasoner",
        };
      },
    };
  };

  try {
    const result = await generateAgentRunnerCandidateResponse({
      contextBuilder,
      payload: {
        reasonerProvider: "http",
        reasonerUrl: "https://example.com/reasoner",
        currentGoal: "Keep memory stable",
        userTurn: "what do you remember",
      },
    });

    assert.equal(result?.provider, "http");
    assert.equal(requests.length, 1);
    const body = JSON.parse(String(requests[0]?.options?.body || "{}"));
    const remoteContext = body?.contextBuilder || {};

    assert.equal(remoteContext?.memoryLayers, undefined);
    assert.equal(remoteContext?.slots?.currentGoal, undefined);
    assert.deepEqual(remoteContext?.slots?.queryBudget, {
      redactedForRemoteReasoner: true,
    });
    assert.deepEqual(remoteContext?.externalColdMemory, {
      redactedForRemoteReasoner: true,
    });
    assert.deepEqual(remoteContext?.slots?.externalColdMemory, {
      redactedForRemoteReasoner: true,
    });
    assert.equal(Array.isArray(remoteContext?.localKnowledge?.hits), true);
    assert.equal(Array.isArray(remoteContext?.slots?.localKnowledgeHits), true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(remoteContext?.localKnowledge?.hits?.[0] || {}, "linked"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(remoteContext?.localKnowledge?.hits?.[0] || {}, "text"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(remoteContext?.slots?.transcriptModel || {}, "entries"),
      false
    );
    assert.equal(typeof remoteContext?.compiledPrompt, "string");
    assert.equal(String(remoteContext?.compiledPrompt || "").includes("\n  \""), false);
    assert.equal(contextBuilder?.externalColdMemory?.provider, "mempalace");
    assert.equal(contextBuilder?.slots?.queryBudget?.redactedForRemoteReasoner, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateAgentRunnerCandidateResponse sends compact local-command context without mutating the original bundle", async () => {
  const contextBuilder = {
    agentId: "agent_local_command",
    contextHash: "ctx_hash_local_command",
    builtAt: "2099-01-01T00:00:00.000Z",
    compiledPrompt: [
      "CURRENT GOAL",
      "Keep memory stable",
      "",
      "COGNITIVE LOOP",
      "{\"sequence\":[\"perception\",\"working\",\"semantic\",\"identity\"]}",
      "",
      "CONTINUOUS COGNITIVE STATE",
      "{\"mode\":\"recovering\",\"dominantStage\":\"repair\"}",
      "",
      "IDENTITY LAYER",
      "{\"agentId\":\"agent_local_command\"}",
    ].join("\n"),
    localKnowledge: {
      retrieval: {
        strategy: "local_first",
        scorer: "bm25",
        hitCount: 1,
        vectorUsed: false,
      },
      hits: [
        {
          sourceType: "passport_memory",
          sourceId: "mem_1",
          title: "Identity anchor",
          summary: "Alice likes tea",
          linked: {
            provider: "local",
          },
          text: "full text should not survive",
        },
      ],
    },
    externalColdMemory: {
      provider: "mempalace",
      enabled: true,
      used: true,
      candidateOnly: true,
      hitCount: 1,
      hits: [
        {
          sourceType: "external_cold_memory",
          sourceId: "cold_1",
          title: "Cold candidate",
          summary: "candidate line",
          linked: {
            provider: "mempalace",
            sourceFile: "vault.json",
          },
          text: "cold text should not survive",
        },
      ],
    },
    slots: {
      currentGoal: "Keep memory stable",
      identitySnapshot: {
        agentId: "agent_local_command",
        did: "did:key:local",
        profile: {
          name: "Alice",
        },
      },
      cognitiveLoop: {
        sequence: ["perception", "working", "semantic", "identity"],
      },
      continuousCognitiveState: {
        mode: "recovering",
        dominantStage: "repair",
        transitionReason: "test",
        fatigue: 0.2,
        sleepDebt: 0.1,
        uncertainty: 0.3,
        rewardPredictionError: 0.05,
        threat: 0.1,
        novelty: 0.2,
        socialSalience: 0.15,
        homeostaticPressure: 0.2,
        sleepPressure: 0.25,
        dominantRhythm: "theta_like",
        bodyLoop: {
          taskBacklog: 1,
          conflictDensity: 0.2,
          humanVetoRate: 0,
          overallLoad: 0.4,
        },
        interoceptiveState: {
          sleepPressure: 0.25,
          allostaticLoad: 0.15,
          metabolicStress: 0.05,
          interoceptivePredictionError: 0.02,
          bodyBudget: 0.7,
        },
        neuromodulators: {
          dopamineRpe: 0.1,
          acetylcholineEncodeBias: 0.2,
          norepinephrineSurprise: 0.05,
          serotoninStability: 0.8,
          dopaminergicAllocationBias: 0.25,
        },
        oscillationSchedule: {
          currentPhase: "encode",
          dominantRhythm: "theta_like",
          nextPhase: "replay",
          transitionReason: "test",
          replayEligible: true,
          phaseWeights: {
            online_theta_like: 0.6,
            offline_ripple_like: 0.25,
            offline_homeostatic: 0.15,
          },
        },
        replayOrchestration: {
          shouldReplay: true,
          replayMode: "targeted",
          replayDrive: 0.6,
          consolidationBias: "goal",
          replayWindowHours: 6,
          gatingReason: "test",
          targetTraceClasses: ["goal_supporting_traces", "conflicting_traces"],
        },
        updatedAt: "2099-01-01T00:00:00.000Z",
      },
      transcriptModel: {
        entryCount: 9,
        latestEntryAt: "2099-01-01T00:00:00.000Z",
        latestEntryType: "assistant_turn",
        families: ["conversation", "runtime"],
        entries: [
          {
            transcriptEntryId: "tx_1",
            summary: "full transcript row",
          },
        ],
      },
      workingMemoryGate: {
        selectedCount: 3,
        blockedCount: 1,
        averageGateScore: 0.72,
      },
      eventGraph: {
        counts: {
          nodes: 1,
          edges: 1,
        },
        nodes: [
          {
            nodeId: "n_1",
            text: "anchor",
            layers: ["semantic"],
          },
        ],
        edges: [
          {
            from: "n_1",
            to: "n_1",
            relation: "supports",
            averageWeight: 0.8,
          },
        ],
      },
      sourceMonitoring: {
        counts: {
          verified: 1,
        },
        cautions: ["low_reality"],
      },
      queryBudget: {
        estimatedContextTokens: 1024,
        maxContextTokens: 4096,
        maxContextChars: 12000,
        maxQueryIterations: 4,
      },
      localKnowledgeHits: [
        {
          sourceType: "passport_memory",
          sourceId: "mem_1",
          title: "Identity anchor",
          summary: "Alice likes tea",
        },
      ],
    },
  };

  const script = [
    "const chunks = [];",
    "process.stdin.on('data', (chunk) => chunks.push(chunk));",
    "process.stdin.on('end', () => {",
    "  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
    "  process.stdout.write(JSON.stringify({",
    "    responseText: 'ok',",
    "    contextBuilder: input.contextBuilder,",
    "    messages: input.messages,",
    "    payload: input.payload",
    "  }));",
    "});",
  ].join("\n");

  const result = await generateAgentRunnerCandidateResponse({
    contextBuilder,
    payload: {
      reasonerProvider: "local_command",
      localReasonerCommand: process.execPath,
      localReasonerArgs: ["-e", script],
      localReasonerTimeoutMs: 4000,
      localReasonerMaxOutputBytes: 16384,
      currentGoal: "Keep memory stable",
      userTurn: "what do you remember",
    },
  });

  assert.equal(result?.provider, "local_command");
  assert.equal(result?.responseText, "ok");
  const raw = result?.metadata?.raw || {};
  const localCommandContext = raw?.contextBuilder || {};
  const localCommandMessages = Array.isArray(raw?.messages) ? raw.messages : [];
  const userMessageContent = String(localCommandMessages?.[1]?.content || "");

  assert.equal(localCommandContext?.contextHash, "ctx_hash_local_command");
  assert.equal(localCommandContext?.slots?.queryBudget?.maxContextTokens, 4096);
  assert.equal(localCommandContext?.slots?.workingMemoryGate?.averageGateScore, 0.72);
  assert.equal(localCommandContext?.slots?.continuousCognitiveState?.oscillationSchedule?.phaseWeights?.onlineThetaLike, 0.6);
  assert.equal(Array.isArray(localCommandContext?.localKnowledge?.hits), true);
  assert.equal(Array.isArray(localCommandContext?.externalColdMemory?.hits), true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(localCommandContext?.localKnowledge?.hits?.[0] || {}, "linked"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(localCommandContext?.localKnowledge?.hits?.[0] || {}, "text"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(localCommandContext?.slots?.transcriptModel || {}, "entries"),
    false
  );
  assert.equal(userMessageContent.includes("Current Goal:\nKeep memory stable"), false);
  assert.equal(userMessageContent.includes("Reasoning Order (Heuristic):"), false);
  assert.equal(userMessageContent.includes("Runtime State Hints:"), false);
  assert.equal(userMessageContent.includes("User Turn:\nwhat do you remember"), true);
  assert.equal(contextBuilder?.slots?.transcriptModel?.entries?.length, 1);
  assert.equal(contextBuilder?.localKnowledge?.hits?.[0]?.linked?.provider, "local");
});

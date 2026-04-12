import assert from "node:assert/strict";
import { createServer } from "node:http";
import { searchMempalaceColdMemory } from "../src/mempalace-runtime.js";
import { generateAgentRunnerCandidateResponse } from "../src/reasoner.js";
import { createMockMempalaceFixture } from "./smoke-mempalace.mjs";

async function startCaptureServer() {
  const captures = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      let json = null;
      try {
        json = JSON.parse(body);
      } catch {
        json = null;
      }
      captures.push({
        method: request.method || "GET",
        url: request.url || "/",
        headers: request.headers,
        bodyText: body,
        json,
      });

      response.setHeader("Content-Type", "application/json");
      if ((request.url || "/") === "/http") {
        response.end(
          JSON.stringify({
            responseText: "remote http reasoner ok",
            model: "openneed-http-probe",
          })
        );
        return;
      }

      response.end(
        JSON.stringify({
          id: "chatcmpl-openneed-probe",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "remote openai compatible reasoner ok",
              },
            },
          ],
        })
      );
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address !== "object" || !Number.isFinite(address.port)) {
    throw new Error("Unable to resolve capture server port");
  }

  return {
    captures,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function buildProbeContextBuilder(contextBuilder) {
  const firstHit = Array.isArray(contextBuilder?.externalColdMemory?.hits) ? contextBuilder.externalColdMemory.hits[0] || null : null;
  assert(firstHit, "Expected context builder to contain at least one external cold memory hit");
  const externalColdMemory = JSON.parse(JSON.stringify(contextBuilder.externalColdMemory || {}));
  const localKnowledgeHits = [
    {
      sourceType: "conversation_minute",
      sourceId: "minute_sensitive_123",
      title: "private minute title",
      summary: "local summary",
      excerpt: "local excerpt with detail",
      score: 0.91,
      recordedAt: "2026-04-12T00:00:00.000Z",
      tags: ["finance", "internal_only"],
      provenance: {
        provider: "local_fs",
        sourceFile: "private.md",
        wing: "alpha",
        room: "vault",
      },
    },
  ];
  const perceptionSnapshot = {
    query: "verify remote reasoner redaction",
    incomingTurns: [
      {
        role: "user",
        content: "perception snapshot should keep only safe text",
      },
    ],
    toolSignals: [
      {
        tool: "runtime_search",
        result: "tool summary",
      },
    ],
    knowledgeSignals: JSON.parse(JSON.stringify(localKnowledgeHits)),
    minuteSignals: [
      {
        minuteId: "minute_probe_456",
        summary: "minute signal summary",
      },
    ],
  };
  const identityLayer = {
    agentId: "agent_remote_reasoner_probe",
    displayName: "Remote Probe",
    role: "auditor",
    taskSnapshot: {
      snapshotId: "snap_sensitive_123",
      title: "snapshot title snap_sensitive_123",
      objective: "protect state around run_sensitive_123",
      nextAction: "resume from cbnd_sensitive_123",
      currentPlan: ["step one", "step two"],
    },
  };
  const transcriptEntries = [
    {
      transcriptEntryId: "trn_sensitive_123",
      entryType: "conversation_turn",
      family: "conversation",
      role: "assistant",
      title: "transcript title trn_sensitive_123",
      summary: "transcript summary for run_sensitive_123",
      relatedRunId: "run_sensitive_123",
      relatedCompactBoundaryId: "cbnd_sensitive_123",
    },
  ];
  const episodicMemories = [
    {
      id: "pmem_sensitive_123",
      kind: "conversation",
      summary: "episodic memory pmem_sensitive_123",
      tags: ["private", "sensitive"],
      patternKey: "pattern_secret",
      separationKey: "sep_secret",
    },
  ];
  const queryBudget = {
    maxContextTokens: 4096,
    maxQueryIterations: 3,
    omittedSections: [],
  };

  return {
    builtAt: new Date().toISOString(),
    agentId: "agent_remote_reasoner_probe",
    didMethod: "openneed",
    contextHash: "remote-reasoner-probe-hash",
    slots: {
      currentGoal: "verify remote reasoner redaction",
      identitySnapshot: {
        agentId: "agent_remote_reasoner_probe",
        displayName: "Remote Probe",
        role: "auditor",
        did: "did:openneed:remote-probe",
        profile: {
          name: "Remote Probe",
          role: "auditor",
          long_term_goal: "Protect local memory from unnecessary remote leakage.",
          stable_preferences: ["minimal-egress"],
        },
        taskSnapshot: identityLayer.taskSnapshot,
      },
      cognitiveLoop: {
        sequence: ["perception", "working", "identity"],
      },
      continuousCognitiveState: {
        mode: "focused",
        dominantStage: "perception",
      },
      transcriptModel: {
        entryCount: 3,
        latestEntryAt: "2026-04-12T00:00:00.000Z",
        latestEntryType: "conversation_turn",
        families: ["conversation", "tool_result"],
        entries: [
          {
            content: "sensitive transcript model entry",
          },
        ],
      },
      workingMemoryGate: {
        selectedCount: 2,
        blockedCount: 1,
        averageGateScore: 0.78,
      },
      eventGraph: {
        counts: {
          nodes: 2,
          edges: 1,
        },
        nodes: [
          {
            text: "sensitive event node",
            layers: ["working", "episodic"],
          },
        ],
        edges: [
          {
            relation: "supports",
            averageWeight: 0.8,
          },
        ],
      },
      sourceMonitoring: {
        counts: {
          total: 1,
        },
        cautions: ["keep inference cautious"],
      },
      perceptionSnapshot,
      queryBudget,
      externalColdMemory: JSON.parse(JSON.stringify(externalColdMemory)),
      recentConversationTurns: [
        {
          role: "user",
          content: "top-level slot turn should not be forwarded raw",
        },
      ],
      recentToolResults: [
        {
          tool: "filesystem_read",
          result: "slot tool result should not be forwarded raw",
        },
      ],
    },
    localKnowledge: {
      retrieval: {
        strategy: "local_first_non_vector",
        scorer: "lexical_v1",
        vectorUsed: true,
        hitCount: localKnowledgeHits.length,
      },
      hits: JSON.parse(JSON.stringify(localKnowledgeHits)),
    },
    memoryLayers: {
      relevant: {
        profile: [
          {
            secret: "memory-layer secret",
          },
        ],
      },
    },
    recentConversationMinutes: [
      {
        title: "raw minute",
        transcript: "sensitive raw minute transcript",
      },
    ],
    transcriptModel: {
      entries: [
        {
          content: "top-level transcript model leak",
        },
      ],
    },
    recentConversationTurns: [
      {
        role: "assistant",
        content: "top-level turn leak",
      },
    ],
    toolResults: [
      {
        tool: "bash",
        result: "top-level tool leak",
      },
    ],
    externalColdMemory,
    compiledPrompt: [
      "SYSTEM RULES",
      "- local ledger is the grounding source",
      "",
      "PERCEPTION SNAPSHOT",
      JSON.stringify(perceptionSnapshot, null, 2),
      "",
      "IDENTITY LAYER",
      JSON.stringify(identityLayer, null, 2),
      "",
      "EVENT GRAPH",
      JSON.stringify(
        {
          nodes: [
            {
              text: "sensitive event node",
              layers: ["working", "episodic"],
            },
          ],
          edges: [
            {
              relation: "supports",
              averageWeight: 0.8,
              supportSummary: "support summary for run_sensitive_123",
            },
          ],
        },
        null,
        2
      ),
      "",
      "RELEVANT EPISODIC MEMORIES",
      JSON.stringify(episodicMemories, null, 2),
      "",
      "TRANSCRIPT MODEL",
      JSON.stringify(transcriptEntries, null, 2),
      "",
      "CONVERSATION MINUTES",
      JSON.stringify(
        [
          {
            id: "minute_prompt_789",
            summary: "conversation minute minute_prompt_789",
          },
        ],
        null,
        2
      ),
      "",
      "VERIFIED FACTS",
      JSON.stringify(
        {
          sourceId: "minute_sensitive_123",
          snapshotId: "snap_sensitive_123",
          provenance: {
            sourceFile: "private.md",
          },
          tags: ["internal_only"],
        },
        null,
        2
      ),
      "",
      "LOCAL KNOWLEDGE HITS",
      JSON.stringify(localKnowledgeHits, null, 2),
      "",
      "SOURCE MONITORING",
      JSON.stringify(
        {
          counts: {
            total: 1,
          },
          cautions: ["keep inference cautious"],
        },
        null,
        2
      ),
      "",
      "EXTERNAL COLD MEMORY CANDIDATES",
      JSON.stringify(
        {
          provider: externalColdMemory.provider ?? null,
          used: externalColdMemory.used ?? null,
          candidateOnly: true,
          hitCount: externalColdMemory.hitCount ?? 0,
          hint: externalColdMemory.hint ?? null,
          hits: [
            {
              sourceId: firstHit.sourceId,
              title: firstHit.title,
              summary: firstHit.summary,
              excerpt: firstHit.excerpt,
              providerScore: firstHit.providerScore,
              candidateOnly: firstHit.candidateOnly,
              provenance: firstHit.linked || null,
            },
          ],
        },
        null,
        2
      ),
      "",
      "QUERY BUDGET",
      JSON.stringify(queryBudget, null, 2),
      "",
      "RECENT CONVERSATION TURNS",
      JSON.stringify(
        [
          {
            role: "user",
            content: "verify remote reasoner redaction",
          },
        ],
        null,
        2
      ),
    ].join("\n"),
  };
}

function findCapture(captures, pathname) {
  return captures.find((entry) => entry.url === pathname) || null;
}

const wing = `wing_sensitive_${Date.now()}`;
const room = `room_private_${Date.now()}`;
const sourceFile = `secret-shelf-${Date.now()}.md`;
const fixture = await createMockMempalaceFixture({
  prefix: "openneed-mempalace-remote-reasoner-",
  queryToken: `remote-reasoner-${Date.now()}`,
  wing,
  room,
  sourceFile,
});
const captureServer = await startCaptureServer();

try {
  const search = searchMempalaceColdMemory(fixture.query, {
    enabled: true,
    provider: "mempalace",
    command: fixture.commandPath,
    palacePath: fixture.palacePath,
    maxHits: 2,
    timeoutMs: 5000,
  });
  assert.equal(search.error, null);
  const externalHits = Array.isArray(search.hits) ? search.hits : [];
  assert(externalHits.length >= 1, "Expected mock mempalace search to surface external cold memory hits");
  assert.equal(externalHits[0]?.linked?.provider, "mempalace");
  assert.equal(externalHits[0]?.linked?.sourceFile, sourceFile);
  assert.equal(externalHits[0]?.linked?.wing, wing);
  assert.equal(externalHits[0]?.linked?.room, room);

  const probeContextBuilder = buildProbeContextBuilder({
    externalColdMemory: {
      provider: search.provider,
      enabled: true,
      used: search.used,
      candidateOnly: true,
      hitCount: externalHits.length,
      error: search.error,
      hint: "External cold memory is candidate-only before remote redaction.",
      hits: externalHits,
    },
  });
  for (const marker of [sourceFile, wing, room, "external cold memory stays read-only.", "never override the local ledger."]) {
    assert(probeContextBuilder.compiledPrompt.includes(marker), `Probe context should include marker before redaction: ${marker}`);
  }
  assert(
    probeContextBuilder.compiledPrompt.includes("EXTERNAL COLD MEMORY CANDIDATES"),
    "Probe context should include EXTERNAL COLD MEMORY CANDIDATES before redaction"
  );

  const httpResult = await generateAgentRunnerCandidateResponse({
    contextBuilder: probeContextBuilder,
    payload: {
      reasonerProvider: "http",
      currentGoal: "verify remote reasoner redaction",
      userTurn: fixture.query,
      recentConversationTurns: [
        {
          role: "assistant",
          content: "sensitive payload turn should not be forwarded raw",
        },
      ],
      toolResults: [
        {
          tool: "browser_fetch",
          result: "sensitive payload tool result should not be forwarded raw",
        },
      ],
      reasoner: {
        provider: "http",
        url: `${captureServer.baseUrl}/http`,
      },
    },
  });
  assert.equal(httpResult.provider, "http");
  assert.equal(httpResult.responseText, "remote http reasoner ok");

  const openaiCompatibleResult = await generateAgentRunnerCandidateResponse({
    contextBuilder: probeContextBuilder,
    payload: {
      reasonerProvider: "openai_compatible",
      currentGoal: "verify remote reasoner redaction",
      userTurn: fixture.query,
      reasoner: {
        provider: "openai_compatible",
        url: captureServer.baseUrl,
        model: "OpenNeed-remote-probe",
      },
    },
  });
  assert.equal(openaiCompatibleResult.provider, "openai_compatible");
  assert.equal(openaiCompatibleResult.responseText, "remote openai compatible reasoner ok");

  const httpCapture = findCapture(captureServer.captures, "/http");
  assert(httpCapture?.json, "Expected captured request for http provider");
  const httpContext = httpCapture.json.contextBuilder;
  assert(httpContext && typeof httpContext === "object", "HTTP payload should include contextBuilder");
  assert.equal(httpContext.externalColdMemory?.redactedForRemoteReasoner, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(httpContext.externalColdMemory || {}, "hits"),
    false,
    "HTTP payload should omit redacted external cold memory hits"
  );
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.externalColdMemory || {}, "provider"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.externalColdMemory || {}, "enabled"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.externalColdMemory || {}, "used"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.externalColdMemory || {}, "candidateOnly"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.externalColdMemory || {}, "hitCount"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.externalColdMemory || {}, "hint"), false);
  assert.equal(
    httpContext.compiledPrompt.includes("EXTERNAL COLD MEMORY CANDIDATES"),
    false,
    "HTTP payload should strip external cold memory prompt section"
  );
  assert.equal(httpContext.slots?.externalColdMemory?.redactedForRemoteReasoner, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(httpContext.slots?.externalColdMemory || {}, "hits"),
    false,
    "HTTP payload slots should omit redacted external cold memory hits"
  );
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.externalColdMemory || {}, "provider"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.externalColdMemory || {}, "enabled"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.externalColdMemory || {}, "used"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.externalColdMemory || {}, "candidateOnly"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.externalColdMemory || {}, "hitCount"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.externalColdMemory || {}, "hint"), false);
  assert.equal(httpContext.localKnowledge?.hits?.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.localKnowledge.hits[0], "sourceType"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.localKnowledge.hits[0], "sourceId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.localKnowledge.hits[0], "provenance"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.localKnowledge.hits[0], "tags"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.localKnowledge.hits[0], "recordedAt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.localKnowledge.hits[0], "providerScore"), false);
  assert.equal(httpContext.localKnowledge?.retrieval?.hitCount, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.localKnowledge?.retrieval || {}, "strategy"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.localKnowledge?.retrieval || {}, "scorer"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.localKnowledge?.retrieval || {}, "vectorUsed"), false);
  assert.equal(httpContext.slots?.localKnowledgeHits?.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots.localKnowledgeHits[0], "sourceType"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots.localKnowledgeHits[0], "sourceId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots.localKnowledgeHits[0], "provenance"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots.localKnowledgeHits[0], "tags"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots.localKnowledgeHits[0], "recordedAt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots.localKnowledgeHits[0], "providerScore"), false);
  assert.equal(httpCapture.json.payload?.redactedForRemoteReasoner, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(httpCapture.json.payload || {}, "recentConversationTurns"),
    false,
    "HTTP payload should omit recent conversation turns after redaction"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(httpCapture.json.payload || {}, "toolResults"),
    false,
    "HTTP payload should omit tool results after redaction"
  );
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "memoryLayers"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "agentId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "builtAt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "contextHash"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "didMethod"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "recentConversationMinutes"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "transcriptModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "recentConversationTurns"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "toolResults"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots || {}, "recentConversationTurns"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots || {}, "recentToolResults"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots || {}, "perceptionSnapshot"), false);
  assert.equal(httpContext.slots?.transcriptModel?.redactedForRemoteReasoner, true);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.transcriptModel || {}, "entryCount"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.transcriptModel || {}, "latestEntryAt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.transcriptModel || {}, "latestEntryType"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.transcriptModel || {}, "families"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.transcriptModel || {}, "entries"), false);
  assert.equal(httpContext.slots?.sourceMonitoring?.requiresCautiousTone, true);
  assert.equal(httpContext.slots?.sourceMonitoring?.cautionCount, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.sourceMonitoring || {}, "counts"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.sourceMonitoring || {}, "cautions"), false);
  assert.equal(Array.isArray(httpContext.slots?.eventGraph?.nodes), true);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.eventGraph?.nodes?.[0] || {}, "layers"), false);
  assert.equal(Array.isArray(httpContext.slots?.eventGraph?.edges), true);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.eventGraph?.edges?.[0] || {}, "relation"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.identitySnapshot || {}, "displayName"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(httpContext.slots?.identitySnapshot || {}, "agentId"),
    false
  );
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.identitySnapshot || {}, "role"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(httpContext.slots?.identitySnapshot || {}, "did"),
    false
  );
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.identitySnapshot?.profile || {}, "name"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.identitySnapshot?.profile || {}, "role"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(httpContext.slots?.identitySnapshot?.taskSnapshot || {}, "snapshotId"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(httpContext.slots?.identitySnapshot?.taskSnapshot || {}, "currentPlan"),
    false
  );
  assert.equal(httpContext.compiledPrompt.includes("minute_sensitive_123"), false);
  assert.equal(httpContext.compiledPrompt.includes("private.md"), false);
  assert.equal(httpContext.compiledPrompt.includes("internal_only"), false);
  assert.equal(httpContext.compiledPrompt.includes("minute_probe_456"), false);
  assert.equal(httpContext.compiledPrompt.includes("SYSTEM RULES"), false);
  assert.equal(httpContext.compiledPrompt.includes("QUERY BUDGET"), false);
  assert.equal(httpContext.compiledPrompt.includes("\"sourceType\""), false);
  assert.equal(httpContext.compiledPrompt.includes("\"cautions\""), false);
  assert.equal(httpContext.compiledPrompt.includes("\"displayName\""), false);
  assert.equal(httpContext.compiledPrompt.includes("recordedAt"), false);
  assert.equal(httpContext.compiledPrompt.includes("\"latestEntryType\""), false);
  assert.equal(httpContext.compiledPrompt.includes("\"families\""), false);
  assert.equal(httpContext.compiledPrompt.includes("\"layers\""), false);
  assert.equal(httpContext.compiledPrompt.includes("\"relation\""), false);
  assert.equal(httpContext.compiledPrompt.includes("supportSummary"), false);
  assert.equal(httpContext.compiledPrompt.includes("\"requiresCautiousTone\": true"), true);
  assert.equal(httpContext.compiledPrompt.includes("VERIFIED FACTS"), false);
  assert.equal(httpContext.compiledPrompt.includes("\"verifiedFacts\""), false);
  assert(
    httpContext.slots?.queryBudget?.redactedForRemoteReasoner === true,
    "HTTP payload should keep only a redaction marker for query budget"
  );
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots?.queryBudget || {}, "omittedSections"), false);

  const openaiCapture = findCapture(captureServer.captures, "/v1/chat/completions");
  assert(openaiCapture?.json, "Expected captured request for openai_compatible provider");
  assert.equal(openaiCapture.json.model, "OpenNeed-remote-probe");
  assert(Array.isArray(openaiCapture.json.messages), "openai_compatible payload should include messages");
  assert.equal(Object.prototype.hasOwnProperty.call(openaiCapture.json, "contextBuilder"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(openaiCapture.json, "payload"), false);
  const openaiMessageText = openaiCapture.json.messages
    .map((entry) => {
      if (typeof entry?.content === "string") {
        return entry.content;
      }
      return JSON.stringify(entry?.content ?? "");
    })
    .join("\n");
  assert.equal(
    openaiMessageText.includes("EXTERNAL COLD MEMORY CANDIDATES"),
    false,
    "openai_compatible messages should strip external cold memory prompt section"
  );
  assert.equal(openaiMessageText.includes("SYSTEM RULES"), false);
  assert.equal(openaiMessageText.includes("QUERY BUDGET"), false);
  assert.equal(openaiMessageText.includes("did:openneed:remote-probe"), false);
  assert.equal(openaiMessageText.includes("\"sourceType\""), false);
  assert.equal(openaiMessageText.includes("\"cautions\""), false);
  assert.equal(openaiMessageText.includes("\"displayName\""), false);
  assert.equal(openaiMessageText.includes("recordedAt"), false);
  assert.equal(openaiMessageText.includes("\"latestEntryType\""), false);
  assert.equal(openaiMessageText.includes("\"families\""), false);
  assert.equal(openaiMessageText.includes("\"layers\""), false);
  assert.equal(openaiMessageText.includes("\"relation\""), false);
  assert.equal(openaiMessageText.includes("supportSummary"), false);
  assert.equal(openaiMessageText.includes("\"fatigue\": null"), false);
  assert.equal(openaiMessageText.includes("\"requiresCautiousTone\": true"), true);

  const forbiddenMarkers = [
    "agent_remote_reasoner_probe",
    "did:openneed:remote-probe",
    "remote-reasoner-probe-hash",
    "conversation_minute",
    "keep inference cautious",
    "Remote Probe",
    "auditor",
    "local_first_non_vector",
    "lexical_v1",
    "tool_result",
    "\"provider\":\"mempalace\"",
    sourceFile,
    wing,
    room,
    "external cold memory stays read-only.",
    "never override the local ledger.",
    "sensitive payload turn should not be forwarded raw",
    "sensitive payload tool result should not be forwarded raw",
    "minute_sensitive_123",
    "private.md",
    "local_fs",
    "alpha",
    "vault",
    "finance",
    "internal_only",
    "minute_probe_456",
    "snap_sensitive_123",
    "run_sensitive_123",
    "cbnd_sensitive_123",
    "trn_sensitive_123",
    "pmem_sensitive_123",
    "minute_prompt_789",
    "pattern_secret",
    "sep_secret",
  ];
  for (const marker of forbiddenMarkers) {
    assert.equal(
      httpCapture.bodyText.includes(marker),
      false,
      `HTTP payload leaked forbidden marker: ${marker}`
    );
    assert.equal(
      openaiCapture.bodyText.includes(marker),
      false,
      `openai_compatible payload leaked forbidden marker: ${marker}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        agentId: probeContextBuilder.agentId,
        externalColdMemoryHitCount: externalHits.length,
        capturedPaths: captureServer.captures.map((entry) => entry.url),
        http: {
          redactedForRemoteReasoner: httpContext.externalColdMemory?.redactedForRemoteReasoner ?? false,
          transcriptRedacted: httpContext.slots?.transcriptModel?.redactedForRemoteReasoner ?? false,
          queryBudgetRedacted: httpContext.slots?.queryBudget?.redactedForRemoteReasoner ?? false,
        },
        openaiCompatible: {
          model: openaiCapture.json.model,
          messageCount: openaiCapture.json.messages.length,
          externalSectionPresent: openaiMessageText.includes("EXTERNAL COLD MEMORY CANDIDATES"),
        },
      },
      null,
      2
    )
  );
} finally {
  await captureServer.close();
  await fixture.cleanup();
}

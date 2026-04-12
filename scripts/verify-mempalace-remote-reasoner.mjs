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
        hitCount: 0,
      },
      hits: [],
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
    timeoutMs: 1500,
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
  assert.equal(httpContext.externalColdMemory?.provider, "mempalace");
  assert.equal(httpContext.externalColdMemory?.candidateOnly, true);
  assert.equal(httpContext.externalColdMemory?.redactedForRemoteReasoner, true);
  assert.equal(httpContext.externalColdMemory?.hitCount, externalHits.length);
  assert.deepEqual(httpContext.externalColdMemory?.hits, []);
  assert.equal(httpContext.externalColdMemory?.used, false);
  assert(
    typeof httpContext.externalColdMemory?.hint === "string" &&
      httpContext.externalColdMemory.hint.includes("omitted"),
    "HTTP payload should preserve safe redaction hint"
  );
  assert.equal(
    httpContext.compiledPrompt.includes("EXTERNAL COLD MEMORY CANDIDATES"),
    false,
    "HTTP payload should strip external cold memory prompt section"
  );
  assert.equal(httpContext.slots?.externalColdMemory?.redactedForRemoteReasoner, true);
  assert.deepEqual(httpContext.slots?.externalColdMemory?.hits, []);
  assert.equal(httpContext.slots?.externalColdMemory?.hitCount, externalHits.length);
  assert.equal(httpCapture.json.payload?.redactedForRemoteReasoner, true);
  assert.deepEqual(httpCapture.json.payload?.recentConversationTurns, []);
  assert.deepEqual(httpCapture.json.payload?.toolResults, []);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "memoryLayers"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "recentConversationMinutes"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "transcriptModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "recentConversationTurns"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext, "toolResults"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots || {}, "recentConversationTurns"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(httpContext.slots || {}, "recentToolResults"), false);
  assert.equal(Array.isArray(httpContext.slots?.transcriptModel?.entries), false);
  assert(
    Array.isArray(httpContext.slots?.queryBudget?.omittedSections) &&
      httpContext.slots.queryBudget.omittedSections.includes("EXTERNAL COLD MEMORY CANDIDATES"),
    "HTTP payload should record omitted prompt section"
  );

  const openaiCapture = findCapture(captureServer.captures, "/v1/chat/completions");
  assert(openaiCapture?.json, "Expected captured request for openai_compatible provider");
  assert.equal(openaiCapture.json.model, "OpenNeed-remote-probe");
  assert(Array.isArray(openaiCapture.json.messages), "openai_compatible payload should include messages");
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

  const forbiddenMarkers = [
    sourceFile,
    wing,
    room,
    "external cold memory stays read-only.",
    "never override the local ledger.",
    "sensitive payload turn should not be forwarded raw",
    "sensitive payload tool result should not be forwarded raw",
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
          provider: httpContext.externalColdMemory?.provider ?? null,
          hitCount: httpContext.externalColdMemory?.hitCount ?? 0,
          candidateOnly: httpContext.externalColdMemory?.candidateOnly ?? null,
          redactedForRemoteReasoner: httpContext.externalColdMemory?.redactedForRemoteReasoner ?? false,
          omittedSections: httpContext.slots?.queryBudget?.omittedSections ?? [],
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

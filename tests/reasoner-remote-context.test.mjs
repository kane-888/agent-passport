import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildRemoteReasonerContext, generateAgentRunnerCandidateResponse } from "../src/reasoner.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previousLocalModelAssetsDir = process.env.AGENT_PASSPORT_LOCAL_MODEL_ASSETS_DIR;

function buildLocalModelAssetManifest() {
  return {
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    config: {
      mediaType: "application/vnd.docker.container.image.v1+json",
      digest: `sha256:${"a".repeat(64)}`,
      size: 123,
    },
    layers: [
      {
        mediaType: "application/vnd.ollama.image.model",
        digest: `sha256:${"b".repeat(64)}`,
        size: 456,
      },
      {
        mediaType: "application/vnd.ollama.image.license",
        digest: `sha256:${"c".repeat(64)}`,
        size: 78,
      },
      {
        mediaType: "application/vnd.ollama.image.params",
        digest: `sha256:${"d".repeat(64)}`,
        size: 90,
      },
    ],
  };
}

function createLocalModelAssetsRoot({ writeManifest = true } = {}) {
  const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-local-model-assets-"));
  const assetDirectory = path.join(assetsRoot, "ollama-gemma4-e4b");
  fs.mkdirSync(assetDirectory, { recursive: true });
  if (writeManifest) {
    fs.writeFileSync(
      path.join(assetDirectory, "manifest.json"),
      JSON.stringify(buildLocalModelAssetManifest(), null, 2),
      "utf8"
    );
  }
  return assetsRoot;
}

const localModelAssetsRoot = createLocalModelAssetsRoot();
process.env.AGENT_PASSPORT_LOCAL_MODEL_ASSETS_DIR = localModelAssetsRoot;

after(() => {
  if (previousLocalModelAssetsDir == null) {
    delete process.env.AGENT_PASSPORT_LOCAL_MODEL_ASSETS_DIR;
  } else {
    process.env.AGENT_PASSPORT_LOCAL_MODEL_ASSETS_DIR = previousLocalModelAssetsDir;
  }
  fs.rmSync(localModelAssetsRoot, { recursive: true, force: true });
});

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
    memoryHomeostasis: {
      runtimeState: {
        correctionLevel: "none",
      },
      memoryStabilityPromptPreflight: {
        rawDebugText: "raw prompt preflight report must not leave the local context",
      },
      memoryStabilityPromptPreTransform: {
        rawDebugText: "raw prompt pretransform receipt must not leave the local context",
        status: "applied",
      },
      memoryStabilityPreview: {
        rawDebugText: "raw kernel preview must not leave the local context",
      },
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
      memoryHomeostasis: {
        correctionLevel: "none",
        memoryStabilityPromptPreflight: {
          rawDebugText: "slot prompt preflight report must not leave the local context",
        },
        memoryStabilityPromptPreTransform: {
          rawDebugText: "slot prompt pretransform receipt must not leave the local context",
          status: "applied",
        },
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
  assert.equal(Object.hasOwn(remoteContext?.memoryHomeostasis || {}, "memoryStabilityPromptPreflight"), false);
  assert.equal(Object.hasOwn(remoteContext?.memoryHomeostasis || {}, "memoryStabilityPromptPreTransform"), false);
  assert.equal(Object.hasOwn(remoteContext?.memoryHomeostasis || {}, "memoryStabilityPreview"), false);
  assert.equal(Object.hasOwn(remoteContext?.slots?.memoryHomeostasis || {}, "memoryStabilityPromptPreflight"), false);
  assert.equal(Object.hasOwn(remoteContext?.slots?.memoryHomeostasis || {}, "memoryStabilityPromptPreTransform"), false);
  assert.equal(JSON.stringify(remoteContext).includes("raw prompt preflight report"), false);
  assert.equal(JSON.stringify(remoteContext).includes("raw prompt pretransform receipt"), false);
  assert.equal(JSON.stringify(remoteContext).includes("raw kernel preview"), false);
  assert.equal(JSON.stringify(remoteContext).includes("slot prompt preflight report"), false);
  assert.equal(JSON.stringify(remoteContext).includes("slot prompt pretransform receipt"), false);
  assert.equal(contextBuilder?.slots?.queryBudget?.redactedForRemoteReasoner, undefined);
  assert.equal(contextBuilder?.externalColdMemory?.provider, "mempalace");
  assert.equal(contextBuilder?.slots?.externalColdMemory?.provider, "mempalace");
  assert.equal(typeof remoteContext?.compiledPrompt, "string");
  assert.equal(typeof contextBuilder?.compiledPrompt, "string");
  assert.equal(contextBuilder?.memoryHomeostasis?.memoryStabilityPromptPreTransform?.status, "applied");
  assert.equal(contextBuilder?.slots?.memoryHomeostasis?.memoryStabilityPromptPreTransform?.status, "applied");
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
    memoryHomeostasis: {
      runtimeState: {
        correctionLevel: "medium",
      },
      memoryStabilityPromptPreflight: {
        rawDebugText: "remote payload must not include prompt preflight report",
      },
      memoryStabilityPromptPreTransform: {
        rawDebugText: "remote payload must not include prompt pretransform receipt",
        status: "applied",
      },
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
      memoryHomeostasis: {
        correctionLevel: "medium",
        memoryStabilityPromptPreflight: {
          rawDebugText: "remote payload must not include slot preflight report",
        },
        memoryStabilityPromptPreTransform: {
          rawDebugText: "remote payload must not include slot pretransform receipt",
          status: "applied",
        },
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
        reasonerAllowedHosts: ["example.com"],
        currentGoal: "Keep memory stable",
        userTurn: "what do you remember",
      },
    });

    assert.equal(result?.provider, "http");
    assert.equal(requests.length, 1);
    const body = JSON.parse(String(requests[0]?.options?.body || "{}"));
    const remoteContext = body?.contextBuilder || {};

    assert.equal(remoteContext?.memoryLayers, undefined);
    assert.equal(remoteContext?.memoryHomeostasis, undefined);
    assert.equal(remoteContext?.slots?.memoryHomeostasis, undefined);
    assert.equal(JSON.stringify(remoteContext).includes("prompt preflight report"), false);
    assert.equal(JSON.stringify(remoteContext).includes("prompt pretransform receipt"), false);
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

test("openai-compatible reasoner prompt uses agent-passport public identity", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

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
          choices: [
            {
              message: {
                content: "ok",
              },
            },
          ],
        };
      },
    };
  };

  try {
    const result = await generateAgentRunnerCandidateResponse({
      contextBuilder: {
        compiledPrompt: "OBSERVED INPUT\nhello",
      },
      payload: {
        reasonerProvider: "openai_compatible",
        reasonerUrl: "https://example.com",
        reasonerModel: "gpt-test",
        reasonerAllowedHosts: ["example.com"],
        currentGoal: "Keep memory stable",
        userTurn: "hello",
      },
    });

    assert.equal(result?.provider, "openai_compatible");
    assert.equal(requests.length, 1);
    const body = JSON.parse(String(requests[0]?.options?.body || "{}"));
    const systemPrompt = String(body?.messages?.[0]?.content || "");
    assert.match(systemPrompt, /agent-passport runtime reasoning assistant/u);
    assert.doesNotMatch(systemPrompt, /OpenNeed/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("http reasoner rejects successful empty responses instead of treating them as valid output", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? "application/json" : null;
      },
    },
    async json() {
      return {
        model: "mock-http-reasoner",
      };
    },
  });

  try {
    await assert.rejects(
      () =>
        generateAgentRunnerCandidateResponse({
          contextBuilder: {
            compiledPrompt: "OBSERVED INPUT\nhello",
          },
          payload: {
            reasonerProvider: "http",
            reasonerUrl: "https://example.com/reasoner",
            reasonerAllowedHosts: ["example.com"],
            reasonerTimeoutMs: 1000,
          },
        }),
      /http reasoner returned empty response/u
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama local reasoner keeps loopback boundary and rejects empty responses", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          message: {
            content: "  local ok  ",
          },
        };
      },
    };
  };

  try {
    const result = await generateAgentRunnerCandidateResponse({
      contextBuilder: {
        compiledPrompt: "OBSERVED INPUT\nhello",
      },
      payload: {
        reasonerProvider: "ollama_local",
        localReasonerBaseUrl: "http://127.0.0.1:11434",
        localReasonerModel: "gemma4:e4b",
        localReasonerTimeoutMs: 1000,
        currentGoal: "Keep memory stable",
        userTurn: "hello",
      },
    });

    assert.equal(result?.provider, "ollama_local");
    assert.equal(result?.responseText, "local ok");
    assert.equal(result?.metadata?.host, "127.0.0.1");
    assert.equal(result?.metadata?.remoteBoundary, "loopback");
    assert.equal(result?.metadata?.asset?.valid, true);
    assert.match(String(result?.metadata?.asset?.manifestPath || ""), /ollama-gemma4-e4b\/manifest\.json$/u);
    assert.equal(requests.length, 1);
    const body = JSON.parse(String(requests[0]?.options?.body || "{}"));
    assert.equal(body?.model, "gemma4:e4b");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama local reasoner rejects canonical asset drift before fetch", () => {
  const missingAssetRoot = createLocalModelAssetsRoot({ writeManifest: false });
  const script = `
    import { generateAgentRunnerCandidateResponse } from ${JSON.stringify(
      pathToFileURL(path.join(rootDir, "src", "reasoner.js")).href
    )};
    globalThis.fetch = async () => {
      throw new Error("fetch should not run");
    };
    try {
      await generateAgentRunnerCandidateResponse({
        contextBuilder: { compiledPrompt: "OBSERVED INPUT\\nhello" },
        payload: {
          reasonerProvider: "ollama_local",
          localReasonerBaseUrl: "http://127.0.0.1:11434",
          localReasonerModel: "gemma4:e4b",
        },
      });
      console.log(JSON.stringify({ ok: true }));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
    }
  `;

  try {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: rootDir,
      env: {
        ...process.env,
        AGENT_PASSPORT_LOCAL_MODEL_ASSETS_DIR: missingAssetRoot,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const result = JSON.parse(output);
    assert.equal(result?.ok, false);
    assert.match(result?.message || "", /ollama_local asset not ready for gemma4:e4b/u);
    assert.match(result?.message || "", /manifest/i);
  } finally {
    fs.rmSync(missingAssetRoot, { recursive: true, force: true });
  }
});

test("ollama local reasoner rejects successful empty responses instead of treating them as valid output", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        model: "gemma4:e4b",
      };
    },
  });

  try {
    await assert.rejects(
      () =>
        generateAgentRunnerCandidateResponse({
          contextBuilder: {
            compiledPrompt: "OBSERVED INPUT\nhello",
          },
          payload: {
            reasonerProvider: "ollama_local",
            localReasonerBaseUrl: "http://127.0.0.1:11434",
            localReasonerModel: "gemma4:e4b",
            localReasonerTimeoutMs: 1000,
          },
        }),
      /ollama_local reasoner returned empty response/u
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama local reasoner rejects non-loopback hosts unless explicitly allowlisted", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not run");
  };

  try {
    await assert.rejects(
      () =>
        generateAgentRunnerCandidateResponse({
          contextBuilder: {
            compiledPrompt: "OBSERVED INPUT\nhello",
          },
          payload: {
            reasonerProvider: "ollama_local",
            localReasonerBaseUrl: "http://example.com:11434",
            localReasonerModel: "gemma4:e4b",
          },
        }),
      /ollama_local reasoner host not allowlisted: example\.com/u
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama local reasoner can opt into an explicit allowlist without borrowing remote provider policy", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        message: {
          content: "allowlisted local bridge",
        },
      };
    },
  });

  try {
    const result = await generateAgentRunnerCandidateResponse({
      contextBuilder: {
        compiledPrompt: "OBSERVED INPUT\nhello",
      },
      payload: {
        reasonerProvider: "ollama_local",
        localReasonerBaseUrl: "http://example.com:11434",
        localReasonerModel: "gemma4:e4b",
        localReasonerAllowedHosts: ["example.com"],
      },
    });

    assert.equal(result?.provider, "ollama_local");
    assert.equal(result?.responseText, "allowlisted local bridge");
    assert.equal(result?.metadata?.host, "example.com");
    assert.equal(result?.metadata?.remoteBoundary, "allowlist");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible reasoner enforces request timeouts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) =>
    new Promise((_, reject) => {
      options.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  try {
    await assert.rejects(
      () =>
        generateAgentRunnerCandidateResponse({
          contextBuilder: {
            compiledPrompt: "OBSERVED INPUT\nhello",
          },
          payload: {
            reasonerProvider: "openai_compatible",
            reasonerUrl: "https://example.com",
            reasonerModel: "gpt-test",
            reasonerAllowedHosts: ["example.com"],
            reasonerTimeoutMs: 1000,
          },
        }),
      /openai_compatible reasoner timed out after 1000ms/u
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("http reasoner rejects non-loopback hosts unless explicitly allowlisted", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not run");
  };

  try {
    await assert.rejects(
      () =>
        generateAgentRunnerCandidateResponse({
          contextBuilder: {
            compiledPrompt: "OBSERVED INPUT\nhello",
          },
          payload: {
            reasonerProvider: "http",
            reasonerUrl: "https://example.com/reasoner",
          },
        }),
      /http reasoner host not allowlisted: example\.com/u
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible reasoner rejects oversized remote responses", async () => {
  const originalFetch = globalThis.fetch;
  const oversizedBody = JSON.stringify({
    choices: [
      {
        message: {
          content: "x".repeat(400),
        },
      },
    ],
  });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        const normalized = String(name).toLowerCase();
        if (normalized === "content-type") {
          return "application/json";
        }
        if (normalized === "content-length") {
          return String(Buffer.byteLength(oversizedBody, "utf8"));
        }
        return null;
      },
    },
    async text() {
      return oversizedBody;
    },
  });

  try {
    await assert.rejects(
      () =>
        generateAgentRunnerCandidateResponse({
          contextBuilder: {
            compiledPrompt: "OBSERVED INPUT\nhello",
          },
          payload: {
            reasonerProvider: "openai_compatible",
            reasonerUrl: "https://example.com",
            reasonerModel: "gpt-test",
            reasonerAllowedHosts: ["example.com"],
            reasonerMaxResponseBytes: 128,
          },
        }),
      /openai_compatible reasoner response exceeds 128 bytes/u
    );
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
  const systemMessageContent = String(localCommandMessages?.[0]?.content || "");
  const userMessageContent = String(localCommandMessages?.[1]?.content || "");

  assert.match(systemMessageContent, /memory stability engine local reasoner/u);
  assert.doesNotMatch(systemMessageContent, /OpenNeed/u);
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

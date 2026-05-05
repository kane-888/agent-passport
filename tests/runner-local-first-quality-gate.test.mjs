import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AGENT_PASSPORT_LOCAL_REASONER_LABEL } from "../src/memory-engine-branding.js";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const MAIN_AGENT_ID = "agent_main";

const REASONER_ENV_KEYS = [
  "AGENT_PASSPORT_LEDGER_PATH",
  "AGENT_PASSPORT_STORE_KEY_PATH",
  "AGENT_PASSPORT_USE_KEYCHAIN",
  "AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT",
  "AGENT_PASSPORT_REASONER_URL",
  "AGENT_PASSPORT_REASONER_MODEL",
  "AGENT_PASSPORT_REASONER_API_KEY",
  "AGENT_PASSPORT_LLM_BASE_URL",
  "AGENT_PASSPORT_LLM_MODEL",
  "AGENT_PASSPORT_LLM_API_KEY",
];

function buildLocalReasonerArgs(responseText, model = "test-local-command") {
  const script = `process.stdout.write(JSON.stringify({responseText:${JSON.stringify(responseText)},model:${JSON.stringify(model)}}));`;
  return ["-e", script];
}

function prepareMemoryStabilityRuntimeRoot(mutateProfile) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-memory-stability-root-"));
  fs.cpSync(path.join(rootDir, "contracts"), path.join(runtimeRoot, "contracts"), { recursive: true });
  fs.cpSync(path.join(rootDir, "tests", "fixtures"), path.join(runtimeRoot, "tests", "fixtures"), {
    recursive: true,
  });
  if (typeof mutateProfile === "function") {
    const profilePath = path.join(
      runtimeRoot,
      "contracts",
      "memory-stability",
      "profile",
      "memory-stability-runtime-profile.json"
    );
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    mutateProfile(profile);
    fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  }
  return runtimeRoot;
}

async function withFreshLedger(testName, callback) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `agent-passport-${testName}-`));
  const previousEnv = Object.fromEntries(REASONER_ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    process.env.AGENT_PASSPORT_LEDGER_PATH = path.join(tempDir, "ledger.json");
    process.env.AGENT_PASSPORT_STORE_KEY_PATH = path.join(tempDir, ".ledger-key");
    process.env.AGENT_PASSPORT_USE_KEYCHAIN = "0";
    delete process.env.AGENT_PASSPORT_REASONER_URL;
    delete process.env.AGENT_PASSPORT_REASONER_MODEL;
    delete process.env.AGENT_PASSPORT_REASONER_API_KEY;
    delete process.env.AGENT_PASSPORT_LLM_BASE_URL;
    delete process.env.AGENT_PASSPORT_LLM_MODEL;
    delete process.env.AGENT_PASSPORT_LLM_API_KEY;

    const ledgerUrl = new URL(pathToFileURL(path.join(rootDir, "src", "ledger.js")).href);
    ledgerUrl.searchParams.set("test", `${testName}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const ledger = await import(ledgerUrl.href);
    return await callback(ledger);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function withOpenAICompatibleServer(responseTextOrFactory, callback) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: request.method,
      url: request.url,
      body: body ? JSON.parse(body) : null,
    });
    const reply =
      typeof responseTextOrFactory === "function"
        ? await responseTextOrFactory({ request, body: body ? JSON.parse(body) : null })
        : {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: {
              id: "chatcmpl-test",
              object: "chat.completion",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: responseTextOrFactory,
                  },
                },
              ],
            },
          };
    response.writeHead(reply?.status ?? 200, reply?.headers ?? { "Content-Type": "application/json" });
    response.end(
      typeof reply?.body === "string" ? reply.body : JSON.stringify(reply?.body ?? {})
    );
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback({ baseUrl, requests });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function seedRuntime(ledger, {
  localMode = "online_enhanced",
  allowOnlineReasoner = true,
  localResponseText,
} = {}) {
  await ledger.configureDeviceRuntime({
    residentAgentId: MAIN_AGENT_ID,
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode,
    allowOnlineReasoner,
    localReasonerEnabled: true,
    localReasonerProvider: "local_command",
    localReasonerCommand: process.execPath,
    localReasonerArgs: buildLocalReasonerArgs(localResponseText),
    localReasonerCwd: rootDir,
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });
  await ledger.bootstrapAgentRuntime(
    MAIN_AGENT_ID,
    {
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "agent-passport",
      currentGoal: "验证本地优先调度",
      currentPlan: ["读取本地上下文", "生成候选回复", "必要时升级线上"],
      nextAction: "继续推进当前任务",
      claimResidentAgent: true,
      allowResidentRebind: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );
}

function buildValidGroundedResponse() {
  return [
    `agent_id: ${MAIN_AGENT_ID}`,
    "名字: 沈知远",
    "角色: CEO",
    "结果: 我会继续推进当前任务，并以本地参考层为准。",
  ].join("\n");
}

function buildNoisyRecentConversationTurns(count = 16, size = 500) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `turn-${index} ${"x".repeat(size)}`,
  }));
}

function buildNoisyToolResults(count = 10, size = 700) {
  return Array.from({ length: count }, (_, index) => ({
    tool: `tool-${index}`,
    result: "y".repeat(size),
  }));
}

function assertMemoryHomeostasisDerivedViewsAligned(result, { expectedModelName = null } = {}) {
  const contextRuntimeState = result?.contextBuilder?.memoryHomeostasis?.runtimeState || null;
  const contextCorrectionPlan = result?.contextBuilder?.memoryHomeostasis?.correctionPlan || null;
  const slotMemoryHomeostasis = result?.contextBuilder?.slots?.memoryHomeostasis || null;
  const runRuntimeState = result?.run?.memoryHomeostasis?.runtimeState || null;
  const runCorrectionPlan = result?.run?.memoryHomeostasis?.correctionPlan || null;

  assert.equal(contextRuntimeState != null, true);
  assert.equal(contextCorrectionPlan != null, true);
  assert.equal(slotMemoryHomeostasis != null, true);
  assert.equal(runRuntimeState != null, true);
  assert.equal(runCorrectionPlan != null, true);

  if (expectedModelName) {
    assert.equal(result?.contextBuilder?.memoryHomeostasis?.modelName, expectedModelName);
    assert.equal(result?.contextBuilder?.slots?.memoryHomeostasis?.modelName, expectedModelName);
    assert.equal(contextRuntimeState?.modelName, expectedModelName);
    assert.equal(runRuntimeState?.modelName, expectedModelName);
  }

  assert.equal(contextCorrectionPlan?.correctionLevel, contextRuntimeState?.correctionLevel ?? null);
  assert.equal(slotMemoryHomeostasis?.correctionPlan?.correctionLevel, contextRuntimeState?.correctionLevel ?? null);
  assert.equal(slotMemoryHomeostasis?.summary?.correctionLevel, contextRuntimeState?.correctionLevel ?? null);
  assert.equal(runCorrectionPlan?.correctionLevel, runRuntimeState?.correctionLevel ?? null);
  assert.deepEqual(
    (slotMemoryHomeostasis?.anchors || []).map((entry) => entry?.memoryId ?? null),
    (contextRuntimeState?.memoryAnchors || [])
      .slice(0, (slotMemoryHomeostasis?.anchors || []).length)
      .map((entry) => entry?.memoryId ?? null)
  );
}

test("recompute runtime stability records canonical correction actions from runtime-state truth", async () => {
  await withFreshLedger("runner-recompute-observation", async (ledger) => {
    await seedRuntime(ledger, {
      localMode: "local_only",
      allowOnlineReasoner: false,
      localResponseText: buildValidGroundedResponse(),
    });

    const result = await ledger.recomputeAgentRuntimeStability(
      MAIN_AGENT_ID,
      {
        currentGoal: `验证 recompute ${"goal ".repeat(200)}`,
        userTurn: "u".repeat(2000),
        recentConversationTurns: buildNoisyRecentConversationTurns(),
        toolResults: buildNoisyToolResults(),
        applyCorrection: true,
        persistState: true,
      },
      { didMethod: "agentpassport" }
    );
    const stability = await ledger.getAgentRuntimeStability(MAIN_AGENT_ID, {
      limit: 1,
    });
    const latestObservation = stability?.observationSummary?.latestObservation || null;

    assert.equal(result.correctionApplied, true);
    assert.equal(result.runtimeState?.correctionLevel, "light");
    assert.equal(result.correctionPlan?.correctionLevel, "light");
    assert.deepEqual(result.correctionPlan?.actions, [
      "reanchor_key_memories_near_prompt_end",
      "raise_memory_injection_priority",
    ]);
    assert.equal(latestObservation?.sourceKind, "recompute");
    assert.equal(latestObservation?.observationKind, "correction_rebuild");
    assert.equal(latestObservation?.correctionRequested, true);
    assert.equal(latestObservation?.correctionApplied, true);
    assert.equal(latestObservation?.correctionLevel, result.runtimeState?.correctionLevel ?? null);
    assert.deepEqual(latestObservation?.correctionActions, result.correctionPlan?.actions ?? []);
  });
});

test("recompute runtime stability reads contract-backed local reasoner truth from the configured runtime root", async () => {
  await withFreshLedger("runner-recompute-contract-runtime-root", async (ledger) => {
    const runtimeRoot = prepareMemoryStabilityRuntimeRoot((profile) => {
      const localProfile = profile.model_profiles.find((entry) => entry?.model_name === "gemma4:e4b");
      assert.ok(localProfile, "expected gemma4:e4b contract profile in runtime root fixture");
      localProfile.ecl_085 = 1536;
      localProfile.ccrs = 0.74;
      localProfile.pr = 0.83;
      localProfile.mid_drop = 0.08;
      profile.runtime_policy.correction_thresholds.tau2_medium = 0.24;
      profile.runtime_policy.correction_thresholds.tau3_strong = 0.44;
      const localNote = profile.runtime_policy.model_specific_notes.find(
        (entry) => entry?.model_name === "gemma4:e4b"
      );
      assert.ok(localNote, "expected gemma4:e4b placement note in runtime root fixture");
      localNote.placement_hint = "compress_early_and_keep_anchor_density_low";
    });

    try {
      process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT = runtimeRoot;

      await seedRuntime(ledger, {
        localMode: "local_only",
        allowOnlineReasoner: false,
        localResponseText: buildValidGroundedResponse(),
      });

      const result = await ledger.recomputeAgentRuntimeStability(
        MAIN_AGENT_ID,
        {
          currentGoal: `验证 contract runtime root ${"goal ".repeat(120)}`,
          userTurn: "u".repeat(2000),
          recentConversationTurns: buildNoisyRecentConversationTurns(),
          toolResults: buildNoisyToolResults(),
          applyCorrection: false,
          persistState: false,
        },
        { didMethod: "agentpassport" }
      );

      assert.equal(result.modelProfile?.modelName, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
      assert.equal(result.modelProfile?.ecl085, 1536);
      assert.equal(result.modelProfile?.benchmarkMeta?.contractBacked, true);
      assert.equal(result.runtimeState?.profile?.modelName, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
      assert.equal(result.runtimeState?.profile?.ecl085, 1536);
      assert.equal(result.runtimeState?.thresholds?.tau2, 0.24);
      assert.equal(result.runtimeState?.thresholds?.tau3, 0.44);
      assert.equal(
        result.runtimeState?.placementStrategy?.modelHint,
        "compress_early_and_keep_anchor_density_low"
      );
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});

test("recompute runtime stability fails closed when the configured runtime root violates contract thresholds", async () => {
  await withFreshLedger("runner-recompute-invalid-contract-runtime-root", async (ledger) => {
    const runtimeRoot = prepareMemoryStabilityRuntimeRoot((profile) => {
      profile.runtime_policy.correction_thresholds.tau2_medium = 0.11;
    });

    try {
      process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT = runtimeRoot;

      await seedRuntime(ledger, {
        localMode: "local_only",
        allowOnlineReasoner: false,
        localResponseText: buildValidGroundedResponse(),
      });

      const result = await ledger.recomputeAgentRuntimeStability(
        MAIN_AGENT_ID,
        {
          currentGoal: `验证 invalid contract runtime root ${"goal ".repeat(120)}`,
          userTurn: "u".repeat(2000),
          recentConversationTurns: buildNoisyRecentConversationTurns(),
          toolResults: buildNoisyToolResults(),
          applyCorrection: false,
          persistState: false,
        },
        { didMethod: "agentpassport" }
      );

      assert.equal(result.modelProfile?.modelName, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
      assert.equal(result.modelProfile?.benchmarkMeta?.contractBacked, undefined);
      assert.equal(result.modelProfile?.benchmarkMeta?.source, "runtime_policy_default");
      assert.equal(result.modelProfile?.ecl085, 2800);
      assert.equal(result.runtimeState?.profile?.modelName, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
      assert.equal(result.runtimeState?.profile?.benchmarkMeta?.contractBacked, undefined);
      assert.equal(result.runtimeState?.profile?.ecl085, 2800);
      assert.equal(result.runtimeState?.thresholds?.tau2, 0.35);
      assert.equal(result.runtimeState?.thresholds?.tau3, 0.5);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});

test("ledger observation and recompute paths keep scalar correction metadata ahead of whole-plan payloads", () => {
  const ledgerSource = fs.readFileSync(path.join(rootDir, "src", "ledger.js"), "utf8");
  const observationSource = fs.readFileSync(path.join(rootDir, "src", "ledger-runtime-memory-observations.js"), "utf8");

  assert.match(observationSource, /function buildRuntimeMemoryObservationCorrectionSummary/u);
  assert.match(ledgerSource, /requestedCorrectionLevel:\s*requestedRuntimeMemoryCorrectionPlan\?\.correctionLevel/u);
  assert.match(ledgerSource, /plannedCorrectionLevel:\s*runtimeMemoryCorrectionPlan\?\.correctionLevel/u);
  assert.match(
    observationSource,
    /const resolvedAppliedCorrectionLevel = normalizeRuntimeMemoryObservationCorrectionLevel\([\s\S]*appliedCorrectionLevel \?\?[\s\S]*correctionApplied \? resolvedPlannedCorrectionLevel : null/u
  );
  assert.match(observationSource, /appliedCorrectionLevel:\s*resolvedAppliedCorrectionLevel/u);
  assert.match(
    ledgerSource,
    /observationContext:\s*\{[\s\S]*requestedCorrectionLevel:\s*requestedCorrectionPlan\?\.correctionLevel[\s\S]*plannedCorrectionLevel[\s\S]*appliedCorrectionLevel[\s\S]*correctionActions:\s*resolveRuntimeMemoryObservationCorrectionActions/u
  );
  assert.doesNotMatch(ledgerSource, /pendingProbeRuntimeMemoryObservation\.correctionPlan/u);
});

test("quality escalation uses runtime state truth ahead of derived correction plan shells", async () => {
  await withFreshLedger("runner-quality-runtime-truth-first", async (ledger) => {
    const candidateResponse = buildValidGroundedResponse();
    const decision = ledger.buildRunnerReasonerQualityEscalationDecision({
      reasonerPlan: {
        effectiveProvider: "local_command",
        qualityEscalationProvider: "openai_compatible",
        onlineAllowed: true,
      },
      reasoner: {
        provider: "local_command",
        responseText: candidateResponse,
      },
      verification: {
        valid: true,
        issues: [],
      },
      candidateResponse,
      runtimeMemoryState: {
        correctionLevel: "none",
        cT: 0.04,
      },
      runtimeMemoryCorrectionPlan: {
        correctionLevel: "strong",
        actions: ["reload_authoritative_window"],
      },
      promptPreflight: {
        ok: true,
        status: "ready",
        mode: "memory-stability-prompt-preflight/v1",
        runtimeLoader: {
          ok: true,
        },
        decision: {
          correctionLevel: "strong",
        },
        snapshot: {
          runtime_state: {
            correction_level: "none",
            c_t: 0.01,
          },
        },
      },
    });

    assert.equal(decision.shouldEscalate, false);
    assert.equal(decision.reason, "verification_passed");
    assert.equal(decision.memoryStability?.runtimeCorrectionLevel, "none");
    assert.equal(decision.memoryStability?.preflightCorrectionLevel, "none");
  });
});

test("quality gate keeps prompt preflight snapshot as advisory truth instead of escalation authority", async () => {
  await withFreshLedger("runner-quality-preflight-truth-first", async (ledger) => {
    const candidateResponse = buildValidGroundedResponse();
    const decision = ledger.buildRunnerReasonerQualityEscalationDecision({
      reasonerPlan: {
        effectiveProvider: "local_command",
        qualityEscalationProvider: "openai_compatible",
        onlineAllowed: true,
      },
      reasoner: {
        provider: "local_command",
        responseText: candidateResponse,
      },
      verification: {
        valid: true,
        issues: [],
      },
      candidateResponse,
      runtimeMemoryState: {
        correctionLevel: "none",
        cT: 0.03,
      },
      runtimeMemoryCorrectionPlan: {
        correctionLevel: "none",
      },
      promptPreflight: {
        ok: true,
        status: "ready",
        mode: "memory-stability-prompt-preflight/v1",
        runtimeLoader: {
          ok: true,
        },
        decision: {
          correctionLevel: "none",
        },
        snapshot: {
          runtime_state: {
            correction_level: "medium",
            c_t: 0.24,
          },
        },
      },
    });

    assert.equal(decision.shouldEscalate, false);
    assert.equal(decision.reason, "verification_passed");
    assert.equal(decision.memoryStability?.correctionLevel, "none");
    assert.equal(decision.memoryStability?.correctionSeverity, 0);
    assert.equal(decision.memoryStability?.signalSource, "runtime_memory");
    assert.equal(decision.memoryStability?.cT, 0.03);
    assert.equal(decision.memoryStability?.preflightCorrectionLevel, "medium");
    assert.equal(decision.memoryStability?.preflightCT, 0.24);
  });
});

test("runner upgrades to online reasoner when local answer fails verification", async () => {
  await withFreshLedger("runner-quality-upgrade", async (ledger) => {
    await seedRuntime(ledger, {
      localMode: "online_enhanced",
      allowOnlineReasoner: true,
      localResponseText: [
        "agent_id: agent_treasury",
        "名字: 错误身份",
        "结果: 我会继续推进当前任务。",
      ].join("\n"),
    });

    await withOpenAICompatibleServer(buildValidGroundedResponse(), async ({ baseUrl, requests }) => {
      const result = await ledger.executeAgentRunner(
        MAIN_AGENT_ID,
        {
          currentGoal: "验证本地答案不过关时升级线上",
          userTurn: "继续推进当前任务",
          reasonerUrl: baseUrl,
          reasonerModel: "gpt-test",
          autoCompact: false,
          persistRun: false,
          writeConversationTurns: false,
          storeToolResults: false,
          turnCount: 2,
          estimatedContextChars: 1200,
          estimatedContextTokens: 320,
        },
        { didMethod: "agentpassport" }
      );

      assert.equal(result.reasoner?.provider, "openai_compatible");
      assert.equal(result.reasoner?.metadata?.qualityEscalationActivated, true);
      assert.equal(result.reasoner?.metadata?.qualityEscalationProvider, "openai_compatible");
      assert.equal(result.reasoner?.metadata?.qualityEscalationInitialProvider, "local_command");
      assert.equal(result.reasoner?.metadata?.qualityEscalationReason, "verification_invalid");
      assert.deepEqual(result.reasoner?.metadata?.qualityEscalationIssueCodes, ["agent_id_mismatch", "profile_name_mismatch"]);
      assert.equal(result.verification?.valid, true);
      assert.equal(result.run?.status, "completed");
      assert.equal(result.run?.reasoner?.metadata?.qualityEscalationActivated, true);
      assertMemoryHomeostasisDerivedViewsAligned(result, {
        expectedModelName: "gpt-test",
      });
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.url, "/v1/chat/completions");
    });
  });
});

test("runner upgrades degraded local_mock replies to online reasoner when online recovery is available", async () => {
  await withFreshLedger("runner-quality-local-mock-upgrade", async (ledger) => {
    await seedRuntime(ledger, {
      localMode: "online_enhanced",
      allowOnlineReasoner: true,
      localResponseText: buildValidGroundedResponse(),
    });

    await withOpenAICompatibleServer(buildValidGroundedResponse(), async ({ baseUrl, requests }) => {
      const result = await ledger.executeAgentRunner(
        MAIN_AGENT_ID,
        {
          currentGoal: "验证 degraded local_mock 会继续升级线上",
          userTurn: "继续推进当前任务",
          reasonerProvider: "local_mock",
          reasonerUrl: baseUrl,
          reasonerModel: "gpt-test",
          autoCompact: false,
          persistRun: false,
          writeConversationTurns: false,
          storeToolResults: false,
          turnCount: 2,
          estimatedContextChars: 1200,
          estimatedContextTokens: 320,
        },
        { didMethod: "agentpassport" }
      );

      assert.equal(result.reasoner?.provider, "openai_compatible");
      assert.equal(result.reasoner?.metadata?.qualityEscalationActivated, true);
      assert.equal(result.reasoner?.metadata?.qualityEscalationProvider, "openai_compatible");
      assert.equal(result.reasoner?.metadata?.qualityEscalationInitialProvider, "local_mock");
      assert.equal(result.reasoner?.metadata?.qualityEscalationReason, "local_mock_degraded");
      assert.equal(result.reasoner?.metadata?.degradedLocalFallback, false);
      assert.equal(result.verification?.valid, true);
      assert.equal(result.run?.status, "completed");
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.url, "/v1/chat/completions");
    });
  });
});

test("runner keeps local verification truth when online escalation returns an empty response", async () => {
  await withFreshLedger("runner-quality-empty-online", async (ledger) => {
    await seedRuntime(ledger, {
      localMode: "online_enhanced",
      allowOnlineReasoner: true,
      localResponseText: [
        "agent_id: agent_treasury",
        "名字: 错误身份",
        "结果: 我会继续推进当前任务。",
      ].join("\n"),
    });

    await withOpenAICompatibleServer(
      () => ({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          id: "chatcmpl-test",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "",
              },
            },
          ],
        },
      }),
      async ({ baseUrl, requests }) => {
        const result = await ledger.executeAgentRunner(
          MAIN_AGENT_ID,
          {
            currentGoal: "验证线上空响应不会被当成成功升级",
            userTurn: "继续推进当前任务",
            reasonerUrl: baseUrl,
            reasonerModel: "gpt-test",
            autoCompact: false,
            persistRun: false,
            writeConversationTurns: false,
            storeToolResults: false,
            turnCount: 2,
            estimatedContextChars: 1200,
            estimatedContextTokens: 320,
          },
          { didMethod: "agentpassport" }
        );

        assert.equal(result.reasoner?.provider, "local_command");
        assert.equal(result.reasoner?.metadata?.qualityEscalationAttempted, true);
        assert.equal(result.reasoner?.metadata?.qualityEscalationActivated, false);
        assert.match(result.reasoner?.metadata?.qualityEscalationError || "", /empty response/u);
        assert.equal(result.verification?.valid, false);
        assert.equal(result.run?.status, "blocked");
        assert.equal(requests.length, 1);
      }
    );
  });
});

test("quality gate also escalates when runtime memory stability is already medium risk", async () => {
  await withFreshLedger("runner-quality-memory-risk", async (ledger) => {
    const decision = ledger.buildRunnerReasonerQualityEscalationDecision({
      reasonerPlan: {
        effectiveProvider: "local_command",
        qualityEscalationProvider: "openai_compatible",
        onlineAllowed: true,
        forceLocalReasonerAttempt: false,
      },
      reasoner: {
        provider: "local_command",
        responseText: buildValidGroundedResponse(),
        error: null,
      },
      verification: {
        valid: true,
        issues: [],
      },
      candidateResponse: buildValidGroundedResponse(),
      runtimeMemoryState: {
        c_t: 0.41,
        correction_level: "medium",
      },
    });

    assert.equal(decision.shouldEscalate, true);
    assert.equal(decision.reason, "memory_stability_unstable");
    assert.equal(decision.memoryStability?.correctionLevel, "medium");
    assert.equal(decision.memoryStability?.signalSource, "runtime_memory");
    assert.equal(decision.memoryStability?.cT, 0.41);
  });
});

test("runtime summary surfaces quality escalation truth after a persisted run", async () => {
  await withFreshLedger("runner-quality-summary", async (ledger) => {
    await seedRuntime(ledger, {
      localMode: "online_enhanced",
      allowOnlineReasoner: true,
      localResponseText: [
        "agent_id: agent_treasury",
        "名字: 错误身份",
        "结果: 我会继续推进当前任务。",
      ].join("\n"),
    });

    await withOpenAICompatibleServer(buildValidGroundedResponse(), async ({ baseUrl }) => {
      const result = await ledger.executeAgentRunner(
        MAIN_AGENT_ID,
        {
          currentGoal: "验证运行摘要能看见质量升级真值",
          userTurn: "继续推进当前任务",
          reasonerUrl: baseUrl,
          reasonerModel: "gpt-test",
          autoCompact: false,
          persistRun: true,
          writeConversationTurns: false,
          storeToolResults: false,
          turnCount: 2,
          estimatedContextChars: 1200,
          estimatedContextTokens: 320,
        },
        { didMethod: "agentpassport" }
      );

      assert.equal(result.run?.status, "completed");

      const summary = await ledger.getAgentRuntimeSummary(MAIN_AGENT_ID, {
        didMethod: "agentpassport",
      });
      const stability = await ledger.getAgentRuntimeStability(MAIN_AGENT_ID, {
        limit: 1,
      });
      const latestRun = summary?.runner?.latest || null;
      const latestSummaryState = summary?.memoryHomeostasis?.latestState || null;
      const latestSummaryObservation = summary?.memoryHomeostasis?.observationSummary?.latestObservation || null;
      const latestStabilityObservation = stability?.observationSummary?.latestObservation || null;

      assert.equal(summary?.runner?.qualityEscalationRuns, 1);
      assert.equal(summary?.hybridRuntime?.fallback?.recentQualityEscalationRuns, 1);
      assert.match(summary?.hybridRuntime?.fallback?.policy || "", /本地答案未通过校验时再联网增强/u);
      assert.equal(latestRun?.qualityEscalationActivated, true);
      assert.equal(latestRun?.qualityEscalationProvider, "openai_compatible");
      assert.equal(latestRun?.qualityEscalationReason, "verification_invalid");
      assertMemoryHomeostasisDerivedViewsAligned(result, {
        expectedModelName: "gpt-test",
      });
      assert.equal(summary?.memoryHomeostasis?.observationSummary?.totalCount >= 1, true);
      assert.equal(latestSummaryObservation?.runtimeMemoryStateId, latestSummaryState?.runtimeMemoryStateId ?? null);
      assert.equal(latestSummaryObservation?.correctionLevel, latestSummaryState?.correctionLevel ?? null);
      assert.equal(stability?.observationSummary?.totalCount >= 1, true);
      assert.equal(latestStabilityObservation?.runtimeMemoryStateId, stability?.latestState?.runtimeMemoryStateId ?? null);
      assert.equal(latestStabilityObservation?.correctionLevel, stability?.latestState?.correctionLevel ?? null);
    });
  });
});

test("quality gate does not escalate from prompt preflight risk alone even when explicit preflight is enabled", async () => {
  await withFreshLedger("runner-quality-preflight-risk", async (ledger) => {
    const decision = ledger.buildRunnerReasonerQualityEscalationDecision({
      reasonerPlan: {
        effectiveProvider: "local_command",
        qualityEscalationProvider: "openai_compatible",
        onlineAllowed: true,
        forceLocalReasonerAttempt: false,
      },
      reasoner: {
        provider: "local_command",
        responseText: buildValidGroundedResponse(),
        error: null,
      },
      verification: {
        valid: true,
        issues: [],
      },
      candidateResponse: buildValidGroundedResponse(),
      promptPreflight: {
        ok: true,
        status: "ready",
        mode: "memory-stability-prompt-preflight/v1",
        runtimeLoader: {
          ok: true,
        },
        decision: {
          correctionLevel: "strong",
        },
        snapshot: {
          runtime_state: {
            c_t: 0.63,
            correction_level: "strong",
          },
        },
      },
    });

    assert.equal(decision.shouldEscalate, false);
    assert.equal(decision.reason, "verification_passed");
    assert.equal(decision.memoryStability?.correctionLevel, "none");
    assert.equal(decision.memoryStability?.correctionSeverity, 0);
    assert.equal(decision.memoryStability?.signalSource, null);
    assert.equal(decision.memoryStability?.preflightStatus, "ready");
    assert.equal(decision.memoryStability?.preflightCorrectionLevel, "strong");
    assert.equal(decision.memoryStability?.preflightCT, 0.63);
    assert.equal(decision.memoryStability?.cT, 0);
  });
});

test("quality gate ignores prompt preflight objects that are not provenance-verified", async () => {
  await withFreshLedger("runner-quality-preflight-unverified", async (ledger) => {
    const decision = ledger.buildRunnerReasonerQualityEscalationDecision({
      reasonerPlan: {
        effectiveProvider: "local_command",
        qualityEscalationProvider: "openai_compatible",
        onlineAllowed: true,
        forceLocalReasonerAttempt: false,
      },
      reasoner: {
        provider: "local_command",
        responseText: buildValidGroundedResponse(),
        error: null,
      },
      verification: {
        valid: true,
        issues: [],
      },
      candidateResponse: buildValidGroundedResponse(),
      promptPreflight: {
        status: "ready",
        decision: {
          correctionLevel: "strong",
        },
        snapshot: {
          runtime_state: {
            c_t: 0.63,
            correction_level: "strong",
          },
        },
      },
    });

    assert.equal(decision.shouldEscalate, false);
    assert.equal(decision.reason, "verification_passed");
    assert.equal(decision.memoryStability?.correctionLevel, "none");
    assert.equal(decision.memoryStability?.correctionSeverity, 0);
    assert.equal(decision.memoryStability?.signalSource, null);
    assert.equal(decision.memoryStability?.preflightStatus, "ready");
    assert.equal(decision.memoryStability?.preflightCorrectionLevel, "none");
    assert.equal(decision.memoryStability?.preflightCT, 0);
  });
});

test("runner stays local when local answer already passes verification", async () => {
  await withFreshLedger("runner-quality-stays-local", async (ledger) => {
    await seedRuntime(ledger, {
      localMode: "online_enhanced",
      allowOnlineReasoner: true,
      localResponseText: buildValidGroundedResponse(),
    });

    await withOpenAICompatibleServer(buildValidGroundedResponse(), async ({ baseUrl, requests }) => {
      const result = await ledger.executeAgentRunner(
        MAIN_AGENT_ID,
        {
          currentGoal: "验证本地答案通过时不升级线上",
          userTurn: "继续推进当前任务",
          reasonerUrl: baseUrl,
          reasonerModel: "gpt-test",
          autoCompact: false,
          persistRun: false,
          writeConversationTurns: false,
          storeToolResults: false,
          turnCount: 2,
          estimatedContextChars: 1200,
          estimatedContextTokens: 320,
        },
        { didMethod: "agentpassport" }
      );

      assert.equal(result.reasoner?.provider, "local_command");
      assert.equal(result.verification?.valid, true);
      assert.equal(result.run?.status, "completed");
      assert.equal(result.reasoner?.metadata?.qualityEscalationActivated ?? false, false);
      assert.equal(requests.length, 0);
    });
  });
});

test("runner keeps local-only boundary even when online reasoner is configured", async () => {
  await withFreshLedger("runner-quality-local-only", async (ledger) => {
    await seedRuntime(ledger, {
      localMode: "local_only",
      allowOnlineReasoner: false,
      localResponseText: [
        "agent_id: agent_treasury",
        "名字: 错误身份",
        "结果: 我会继续推进当前任务。",
      ].join("\n"),
    });

    await withOpenAICompatibleServer(buildValidGroundedResponse(), async ({ baseUrl, requests }) => {
      const result = await ledger.executeAgentRunner(
        MAIN_AGENT_ID,
        {
          currentGoal: "验证 local_only 不会偷偷升级线上",
          userTurn: "继续推进当前任务",
          reasonerUrl: baseUrl,
          reasonerModel: "gpt-test",
          autoCompact: false,
          persistRun: false,
          writeConversationTurns: false,
          storeToolResults: false,
          turnCount: 2,
          estimatedContextChars: 1200,
          estimatedContextTokens: 320,
        },
        { didMethod: "agentpassport" }
      );

      assert.equal(result.reasoner?.provider, "local_command");
      assert.equal(result.reasoner?.metadata?.qualityEscalationActivated, false);
      assert.equal(result.reasoner?.metadata?.qualityEscalationReason, "online_not_allowed");
      assert.equal(result.verification?.valid, false);
      assert.equal(result.run?.status, "blocked");
      assert.equal(requests.length, 0);
    });
  });
});

test("runner marks local_mock as degraded when online recovery is unavailable", async () => {
  await withFreshLedger("runner-quality-local-mock-degraded", async (ledger) => {
    await seedRuntime(ledger, {
      localMode: "local_only",
      allowOnlineReasoner: false,
      localResponseText: buildValidGroundedResponse(),
    });

    await withOpenAICompatibleServer(buildValidGroundedResponse(), async ({ baseUrl, requests }) => {
      const result = await ledger.executeAgentRunner(
        MAIN_AGENT_ID,
        {
          currentGoal: "验证 degraded local_mock 在离线边界下会显式暴露",
          userTurn: "继续推进当前任务",
          reasonerProvider: "local_mock",
          reasonerUrl: baseUrl,
          reasonerModel: "gpt-test",
          autoCompact: false,
          persistRun: false,
          writeConversationTurns: false,
          storeToolResults: false,
          turnCount: 2,
          estimatedContextChars: 1200,
          estimatedContextTokens: 320,
        },
        { didMethod: "agentpassport" }
      );

      assert.equal(result.reasoner?.provider, "local_mock");
      assert.equal(result.reasoner?.metadata?.degradedLocalFallback, true);
      assert.equal(result.reasoner?.metadata?.degradedLocalFallbackReason, "local_mock_fallback");
      assert.equal(result.reasoner?.metadata?.qualityEscalationActivated, false);
      assert.equal(result.reasoner?.metadata?.qualityEscalationReason, "online_not_allowed");
      assert.equal(result.verification?.valid, true);
      assert.equal(result.run?.status, "completed");
      assert.equal(requests.length, 0);
    });
  });
});

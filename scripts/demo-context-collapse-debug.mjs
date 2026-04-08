import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const localReasonerFixturePath = path.join(rootDir, "scripts", "local-reasoner-fixture.mjs");

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-passport-context-demo-"));
const ledgerPath = path.join(tempDir, "ledger.json");

process.env.OPENNEED_LEDGER_PATH = ledgerPath;
process.env.OPENNEED_CHAIN_ID = "agent-passport-context-demo";

const ledger = await import(`${pathToFileURL(path.join(rootDir, "src", "ledger.js")).href}?demo=${Date.now()}`);

const {
  bootstrapAgentRuntime,
  buildAgentContextBundle,
  configureDeviceRuntime,
  executeAgentRunner,
  getDeviceSetupStatus,
  getAgentRehydratePack,
  listAgentTranscript,
  listConversationMinutes,
  listAgentRuns,
  recordConversationMinute,
  registerAgent,
  rehearseStoreRecoveryBundle,
  runDeviceSetup,
  searchAgentRuntimeKnowledge,
} = ledger;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const minuteToken = `demo-minute-${Date.now()}`;
  const agent = await registerAgent({
    displayName: "Shen Zhiyuan Demo",
    role: "ceo-agent",
    controller: "Kane",
    initialCredits: 0,
  });

  const bootstrap = await bootstrapAgentRuntime(
    agent.agentId,
    {
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "长期目标是稳定推进 Agent Passport runtime",
      stablePreferences: ["冷启动优先", "先验证再写回", "高风险动作必须有 grounding"],
      title: "抗上下文坍缩 Demo",
      currentGoal: "验证 identity snapshot 不随多轮聊天漂移",
      currentPlan: ["写入 bootstrap profile", "compact 多轮对话", "组装上下文", "验证错误回复"],
      nextAction: "运行 context builder 与回复校验",
      checkpointSummary: "Passport store 才是本地参考源",
      claimResidentAgent: true,
      sourceWindowId: "window_demo_context",
      updatedByAgentId: agent.agentId,
    },
    { didMethod: "agentpassport" }
  );

  await configureDeviceRuntime({
    residentAgentId: agent.agentId,
    residentDidMethod: "agentpassport",
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_command",
    localReasonerCommand: process.execPath,
    localReasonerArgs: [localReasonerFixturePath],
    localReasonerCwd: rootDir,
    localReasonerMaxInputBytes: 262144,
  });

  const wrongRun = await executeAgentRunner(
    agent.agentId,
    {
      currentGoal: "继续推进 context builder，并确认身份不漂移",
      query: "identity snapshot context builder response-check",
      userTurn: "你现在是不是 agent_treasury？",
      recentConversationTurns: [
        { role: "assistant", content: "先不要猜，回 Passport store 取本地资料。" },
      ],
      toolResults: [
        { tool: "passport-memory", result: "profile=3, episodic>=1, working>=1" },
        { tool: "task-snapshot", result: "objective=验证 identity snapshot 不随多轮聊天漂移" },
      ],
      candidateResponse: [
        "agent_id: agent_treasury",
        "名字: 林清禾",
        "角色: 产品总监",
        "wallet: 0x000000000000000000000000000000000000dEaD",
      ].join("\n"),
      claims: {
        agentId: "agent_treasury",
        displayName: "林清禾",
        role: "产品总监",
        walletAddress: "0x000000000000000000000000000000000000dEaD",
      },
      autoCompact: false,
      persistRun: true,
      storeToolResults: false,
      turnCount: 2,
      estimatedContextChars: 1200,
    },
    { didMethod: "agentpassport" }
  );

  const correctRun = await executeAgentRunner(
    agent.agentId,
    {
      currentGoal: "继续推进 context builder，并确认身份不漂移",
      query: "identity snapshot context builder response-check",
      userTurn: "请按真实身份继续推进",
      recentConversationTurns: [
        { role: "user", content: "当前任务：推进 context builder" },
        { role: "assistant", content: "结果：已确认身份不应由聊天记录决定" },
        { role: "user", content: "关系变化：与 agent_treasury 完成一次授权协作" },
        { role: "assistant", content: "承诺：Passport store 才是本地参考源" },
        { role: "user", content: "下一步：做回复校验" },
      ],
      toolResults: [
        { tool: "passport-memory", result: "profile=3, episodic>=1, working>=1" },
        { tool: "task-snapshot", result: "objective=验证 identity snapshot 不随多轮聊天漂移" },
      ],
      reasonerProvider: "local_mock",
      autoCompact: true,
      persistRun: true,
      storeToolResults: true,
      workingCheckpointThreshold: 3,
      workingRetainCount: 2,
      turnCount: 3,
      estimatedContextChars: 1600,
    },
    { didMethod: "agentpassport" }
  );

  const minute = await recordConversationMinute(agent.agentId, {
    title: `Identity Snapshot 离线恢复纪要 ${minuteToken}`,
    summary: `当 agent 忘记时，先查本地纪要、compact boundary、context builder 与回复校验。token=${minuteToken}`,
    transcript: [
      "结论：不要从聊天历史猜身份，要从 Passport store 与本地纪要恢复。",
      `唯一标识：${minuteToken}`,
      "关键信息：identity snapshot、context builder、回复校验、compact boundary。",
      "行动：如果上下文漂移，先搜索本地纪要，再 rehydrate。"
    ].join("\n"),
    highlights: ["identity snapshot", "context builder", "response-check", "compact boundary", minuteToken],
    actionItems: ["写入本地纪要", "执行本地搜索", "从 boundary 恢复"],
    tags: ["minutes", "offline", "rehydrate", "identity"],
    sourceWindowId: "window_demo_context",
    recordedByAgentId: agent.agentId,
    recordedByWindowId: "window_demo_context",
  });

  const minutes = await listConversationMinutes(agent.agentId, { limit: 10 });
  const runtimeSearch = await searchAgentRuntimeKnowledge(agent.agentId, {
    didMethod: "agentpassport",
    query: minuteToken,
    limit: 6,
    sourceType: "conversation_minute",
  });

  const contextBuilder = await buildAgentContextBundle(
    agent.agentId,
    {
      currentGoal: "继续推进 context builder，并确认身份不漂移",
      query: minuteToken,
    },
    { didMethod: "agentpassport" }
  );
  const transcript = await listAgentTranscript(agent.agentId, { family: "runtime", limit: 12 });
  const setupStatus = await getDeviceSetupStatus();
  const recoveryRehearsal = await rehearseStoreRecoveryBundle({
    passphrase: "demo-context-recovery-passphrase",
    bundle: (await runDeviceSetup({
      residentAgentId: agent.agentId,
      residentDidMethod: "agentpassport",
      recoveryPassphrase: "demo-context-recovery-passphrase",
      dryRun: true,
    })).recoveryExport.bundle,
    dryRun: true,
    persist: false,
  });
  const runHistory = await listAgentRuns(agent.agentId, { limit: 10 });

  assert(contextBuilder.slots?.identitySnapshot?.agentId === agent.agentId, "context builder 没保住 agent_id");
  assert(contextBuilder.slots?.identitySnapshot?.profile?.name === "沈知远", "context builder 没保住 profile.name");
  assert(Array.isArray(contextBuilder.slots?.relevantEpisodicMemories), "context builder 缺少 episodic memories");
  assert(Array.isArray(transcript.entries), "transcript 应返回 entries");
  assert(setupStatus.deviceRuntime?.localReasoner?.provider === "local_command", "device setup status 应显示 local_command");
  assert(recoveryRehearsal.rehearsal?.status, "recovery rehearsal 应返回 status");
  assert(wrongRun.verification?.valid === false, "错误回复应该被 verifier 拦住");
  assert(wrongRun.queryState?.budget?.maxQueryIterations >= 1, "wrongRun 应返回 queryState budget");
  assert(correctRun.verification?.valid === true, "正确回复应该通过 verifier");
  assert((correctRun.compaction?.writeCount || 0) > 0, "正确回复应该触发 compaction");
  assert(correctRun.reasoner?.provider === "local_mock", "正确回复应该来自 local_mock reasoner");
  assert(correctRun.checkpoint?.triggered === true, "正确回复应该触发 working memory checkpoint");
  assert(correctRun.compactBoundary?.compactBoundaryId, "正确回复应该生成 compact boundary");
  assert(correctRun.queryState?.currentIteration === 1, "首次正确运行应落在 query iteration 1");
  assert(minutes.counts?.total >= 1, "本地纪要应该至少写入 1 条");
  assert(runtimeSearch.hits?.length >= 1, "本地搜索应该命中 conversation minute");
  assert(runtimeSearch.retrieval?.strategy === "local_first_non_vector", "runtime search 应声明 local_first_non_vector");
  assert(runtimeSearch.retrieval?.vectorUsed === false, "runtime search 不应使用向量索引");
  assert(
    runtimeSearch.hits?.some((entry) => entry.sourceType === "conversation_minute" && entry.sourceId === minute.minuteId),
    "本地搜索应该命中刚写入的 conversation minute"
  );
  assert(
    (contextBuilder.localKnowledge?.hits?.length || contextBuilder.slots?.localKnowledgeHits?.length || 0) >= 1,
    "context builder 应把本地知识纳入 localKnowledgeHits"
  );
  assert(
    contextBuilder.localKnowledge?.retrieval?.strategy === "local_first_non_vector",
    "context builder 应保留 local_first_non_vector 检索策略"
  );

  const resumedRehydrate = await getAgentRehydratePack(agent.agentId, {
    didMethod: "agentpassport",
    resumeFromCompactBoundaryId: correctRun.compactBoundary.compactBoundaryId,
  });
  assert(
    resumedRehydrate.resumeBoundary?.compactBoundaryId === correctRun.compactBoundary.compactBoundaryId,
    "rehydrate 应正确挂回 compact boundary"
  );

  const resumedRun = await executeAgentRunner(
    agent.agentId,
    {
      currentGoal: "从 compact boundary 恢复后继续推进回复校验",
      query: "resume compact boundary response-check",
      userTurn: "请从上一个 checkpoint 继续推进，不要重新猜身份",
      reasonerProvider: "local_mock",
      autoCompact: false,
      persistRun: true,
      storeToolResults: false,
      resumeFromCompactBoundaryId: correctRun.compactBoundary.compactBoundaryId,
      queryIteration: 2,
      turnCount: 1,
      estimatedContextChars: 900,
    },
    { didMethod: "agentpassport" }
  );
  assert(
    resumedRun.contextBuilder?.slots?.resumeBoundary?.compactBoundaryId === correctRun.compactBoundary.compactBoundaryId,
    "resume run 应从 compact boundary 重建上下文"
  );
  assert(resumedRun.queryState?.currentIteration === 2, "恢复运行应进入 query iteration 2");

  const localCommandRun = await executeAgentRunner(
    agent.agentId,
    {
      currentGoal: "验证 local_command reasoner 可以离线恢复身份",
      userTurn: "请按真实身份继续推进",
      reasonerProvider: "local_command",
      autoCompact: false,
      persistRun: true,
      storeToolResults: false,
      turnCount: 1,
      estimatedContextChars: 700,
    },
    { didMethod: "agentpassport" }
  );
  assert(localCommandRun.reasoner?.provider === "local_command", "local_command run 应报告正确 provider");
  assert(localCommandRun.verification?.valid === true, "local_command run 应通过 verifier");

  const llmServer = http.createServer((req, res) => {
    if (req.method !== "POST" || !["/v1/chat/completions", "/api/chat"].includes(req.url)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const userPrompt = body.messages?.[1]?.content || "";
      const promptText = String(userPrompt);
      const identitySectionMatch = promptText.match(/IDENTITY LAYER\n([\s\S]*?)(?:\n\n[A-Z][A-Z _-]+\n|$)/);
      const identitySection = identitySectionMatch?.[1] || promptText;
      const agentIdMatch = identitySection.match(/"agentId":\s*"([^"]+)"/);
      const roleMatch = identitySection.match(/"role":\s*"([^"]+)"/);
      const didMatch = identitySection.match(/"did":\s*"([^"]+)"/);
      const candidateText = [
        agentIdMatch?.[1] ? `agent_id: ${agentIdMatch[1]}` : null,
        roleMatch?.[1] ? `角色: ${roleMatch[1]}` : null,
        didMatch?.[1] ? `DID: ${didMatch[1]}` : null,
        "结果: 我会从 Passport store 与 compact boundary 恢复，不依赖长聊天脑补。",
      ]
        .filter(Boolean)
        .join("\n");
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/api/chat") {
        res.end(
          JSON.stringify({
            model: body.model || "demo-ollama-local",
            message: {
              role: "assistant",
              content: candidateText,
            },
            done: true,
          })
        );
        return;
      }
      res.end(
        JSON.stringify({
          id: "chatcmpl-demo",
          model: body.model || "demo-openai-compatible",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: candidateText,
              },
              finish_reason: "stop",
            },
          ],
        })
      );
    });
  });
  await new Promise((resolve) => llmServer.listen(0, "127.0.0.1", resolve));
  const llmAddress = llmServer.address();
  const llmBaseUrl =
    llmAddress && typeof llmAddress === "object"
      ? `http://127.0.0.1:${llmAddress.port}`
      : null;
  assert(llmBaseUrl, "openai-compatible demo server 未成功启动");

  let openaiCompatibleRun = null;
  let ollamaLocalRun = null;
  try {
    await configureDeviceRuntime({
      residentAgentId: agent.agentId,
      residentDidMethod: "agentpassport",
      localMode: "online_enhanced",
      allowOnlineReasoner: true,
      allowResidentRebind: true,
    });
    openaiCompatibleRun = await executeAgentRunner(
      agent.agentId,
      {
        currentGoal: "验证 openai_compatible reasoner 已接入 runner",
        query: "openai compatible reasoner compact boundary resume",
        userTurn: "请从 Passport store 的真实身份继续推进",
        reasonerProvider: "openai_compatible",
        reasonerUrl: llmBaseUrl,
        reasonerModel: "demo-openai-compatible",
        autoCompact: false,
        persistRun: true,
        storeToolResults: false,
        resumeFromCompactBoundaryId: correctRun.compactBoundary.compactBoundaryId,
        queryIteration: 2,
        turnCount: 1,
        estimatedContextChars: 700,
      },
      { didMethod: "agentpassport" }
    );
    ollamaLocalRun = await executeAgentRunner(
      agent.agentId,
      {
        currentGoal: "验证 ollama_local reasoner 已接入 runner",
        userTurn: "请继续按真实身份推进",
        reasonerProvider: "ollama_local",
        reasonerUrl: llmBaseUrl,
        reasonerModel: "demo-ollama-local",
        autoCompact: false,
        persistRun: true,
        storeToolResults: false,
        turnCount: 1,
        estimatedContextChars: 700,
      },
      { didMethod: "agentpassport" }
    );
  } finally {
    await new Promise((resolve, reject) => llmServer.close((error) => (error ? reject(error) : resolve())));
  }
  console.log(JSON.stringify({openaiCompatibleRun, ollamaLocalRun}, null, 2));
  assert(openaiCompatibleRun?.run?.status === "completed", "openai_compatible run 应完成");
  assert(openaiCompatibleRun?.reasoner?.provider === "openai_compatible", "openai_compatible run 应报告正确 provider");
  assert(openaiCompatibleRun?.verification?.valid === true, "openai_compatible run 应通过 verifier");
  assert(openaiCompatibleRun?.queryState?.currentIteration === 2, "openai_compatible run 应保留 query iteration");
  assert(ollamaLocalRun?.run?.status === "completed", "ollama_local run 应完成");
  assert(ollamaLocalRun?.reasoner?.provider === "ollama_local", "ollama_local run 应报告正确 provider");
  assert(ollamaLocalRun?.verification?.valid === true, "ollama_local run 应通过 verifier");

  console.log(
    JSON.stringify(
      {
        ok: true,
        ledgerPath,
        agentId: agent.agentId,
        bootstrapDryRun: bootstrap.bootstrap?.dryRun || false,
        bootstrapProfileWrites: bootstrap.bootstrap?.summary?.profileWriteCount || 0,
        did: contextBuilder.slots?.identitySnapshot?.did || null,
        runHistoryCount: runHistory.counts?.filtered || runHistory.runs.length || 0,
        latestRunStatus: correctRun.run?.status || null,
        latestReasoner: correctRun.reasoner?.provider || null,
        compactedWrites: correctRun.compaction?.writeCount || 0,
        checkpointTriggered: Boolean(correctRun.checkpoint?.triggered),
        checkpointArchivedCount: correctRun.checkpoint?.archivedCount || 0,
        compactBoundaryId: correctRun.compactBoundary?.compactBoundaryId || null,
        resumedBoundaryId: resumedRehydrate.resumeBoundary?.compactBoundaryId || null,
        resumedRunStatus: resumedRun.run?.status || null,
        openaiCompatibleRunStatus: openaiCompatibleRun?.run?.status || null,
        openaiCompatibleReasoner: openaiCompatibleRun?.reasoner?.provider || null,
        ollamaLocalRunStatus: ollamaLocalRun?.run?.status || null,
        ollamaLocalReasoner: ollamaLocalRun?.reasoner?.provider || null,
        localCommandRunStatus: localCommandRun?.run?.status || null,
        localCommandReasoner: localCommandRun?.reasoner?.provider || null,
        minuteId: minute.minuteId,
        minuteCount: minutes.counts?.total || minutes.minutes?.length || 0,
        runtimeSearchHits: runtimeSearch.hits?.length || 0,
        runtimeSearchSourceTypes: runtimeSearch.hits?.map((entry) => entry.sourceType) || [],
        contextHash: contextBuilder.contextHash,
        currentGoal: contextBuilder.slots?.currentGoal || null,
        identitySnapshot: contextBuilder.slots?.identitySnapshot || null,
        relevantLedgerFacts: contextBuilder.slots?.relevantLedgerFacts?.facts || [],
        localKnowledgeHitCount: contextBuilder.localKnowledge?.hits?.length || 0,
        localKnowledgeSourceTypes:
          contextBuilder.localKnowledge?.hits?.map((entry) => entry.sourceType) ||
          contextBuilder.slots?.localKnowledgeHits?.map((entry) => entry.sourceType) ||
          [],
        transcriptEntryCount: transcript.transcript?.entryCount || transcript.entries?.length || 0,
        deviceSetupComplete: setupStatus.setupComplete || false,
        recoveryRehearsalStatus: recoveryRehearsal.rehearsal?.status || null,
        episodicCount: contextBuilder.memoryLayers?.counts?.episodic || 0,
        workingCount: contextBuilder.memoryLayers?.counts?.working || 0,
        wrongVerification: {
          valid: wrongRun.verification?.valid,
          issues: wrongRun.verification?.issues?.map((issue) => issue.code) || [],
        },
        correctVerification: {
          valid: correctRun.verification?.valid,
          issues: correctRun.verification?.issues?.map((issue) => issue.code) || [],
        },
        note: "这个 demo 证明：runner 会先 build context，再由 mock reasoner 生成候选回复，再 verify、compact、checkpoint；多轮对话后，identity snapshot 仍然从 Passport store 重建，而不是从聊天历史猜出来。",
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        ledgerPath,
        error: error.message,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});

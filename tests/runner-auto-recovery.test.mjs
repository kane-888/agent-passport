import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-runner-auto-recovery-"));
const previousEnv = {
  OPENNEED_LEDGER_PATH: process.env.OPENNEED_LEDGER_PATH,
  AGENT_PASSPORT_STORE_KEY_PATH: process.env.AGENT_PASSPORT_STORE_KEY_PATH,
  AGENT_PASSPORT_USE_KEYCHAIN: process.env.AGENT_PASSPORT_USE_KEYCHAIN,
};

process.env.OPENNEED_LEDGER_PATH = path.join(tempDir, "ledger.json");
process.env.AGENT_PASSPORT_STORE_KEY_PATH = path.join(tempDir, ".ledger-key");
process.env.AGENT_PASSPORT_USE_KEYCHAIN = "0";

const ledger = await import(pathToFileURL(path.join(rootDir, "src", "ledger.js")).href);

function assertEventChainContinuous(store) {
  const broken = (Array.isArray(store.events) ? store.events : []).filter((event, index, events) =>
    index === 0
      ? event?.previousHash !== null
      : event?.previousHash !== events[index - 1]?.hash || event?.index !== index
  );
  assert.equal(broken.length, 0);
}

after(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await rm(tempDir, { recursive: true, force: true });
});

test("runner auto recovery resumes from a freshly seeded compact boundary", async () => {
  await ledger.configureDeviceRuntime({
    residentAgentId: "agent_openneed_agents",
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });
  await ledger.bootstrapAgentRuntime(
    "agent_openneed_agents",
    {
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "agent-passport",
      currentGoal: "建立 operational smoke 最小运行态",
      currentPlan: ["写 profile", "写 snapshot", "验证 runner"],
      nextAction: "执行 verification run",
      claimResidentAgent: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );

  for (let index = 0; index < 4; index += 1) {
    await ledger.writePassportMemory("agent_openneed_agents", {
      layer: "working",
      kind: "conversation_turn",
      summary: `seed turn ${index}`,
      content: `seed turn ${index}`,
      payload: { role: "user" },
      tags: ["conversation", "user"],
    });
  }

  const seed = await ledger.executeAgentRunner(
    "agent_openneed_agents",
    {
      currentGoal: "为 operational smoke 生成 compact boundary",
      userTurn: "请基于当前上下文整理恢复边界",
      reasonerProvider: "local_mock",
      autoRecover: false,
      autoCompact: true,
      persistRun: true,
      writeConversationTurns: true,
      storeToolResults: false,
      workingCheckpointThreshold: 1,
      workingRetainCount: 1,
      turnCount: 18,
      estimatedContextChars: 24000,
      estimatedContextTokens: 6200,
    },
    { didMethod: "agentpassport" }
  );
  const compactBoundaryId = seed.compactBoundary?.compactBoundaryId || null;
  assert(compactBoundaryId, "seed runner should create a compact boundary");
  assert.equal(seed.run?.status, "rehydrate_required");
  assert.equal(seed.recoveryAction?.action, "reload_rehydrate_pack");

  const resumed = await ledger.executeAgentRunner(
    "agent_openneed_agents",
    {
      currentGoal: "验证 runner HTTP auto recovery 是否能自动续跑",
      userTurn: "请继续推进当前任务",
      reasonerProvider: "local_mock",
      autoRecover: true,
      maxRecoveryAttempts: 1,
      autoCompact: false,
      persistRun: false,
      writeConversationTurns: false,
      storeToolResults: false,
      turnCount: 18,
      estimatedContextChars: 24000,
      estimatedContextTokens: 6200,
      resumeFromCompactBoundaryId: compactBoundaryId,
    },
    { didMethod: "agentpassport" }
  );

  assert.equal(resumed.autoResumed, true);
  assert.equal(resumed.autoRecovery?.status, "resumed");
  assert.equal(resumed.autoRecovery?.setupStatus?.activePlanReadiness?.ready, true);
  assert.equal(resumed.run?.status, "completed");
  assert.equal(Array.isArray(resumed.recoveryChain) && resumed.recoveryChain.length >= 2, true);
});

test("reload_rehydrate_pack ignores transient local reasoner reachability gate", async () => {
  const failedAt = new Date().toISOString();
  await ledger.configureDeviceRuntime({
    residentAgentId: "agent_openneed_agents",
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_command",
    localReasonerCommand: process.execPath,
    localReasonerArgs: ["./missing-local-reasoner-fixture.mjs"],
    localReasonerCwd: rootDir,
    localReasonerLastProbe: {
      checkedAt: failedAt,
      provider: "local_command",
      status: "unreachable",
      reachable: false,
      error: "simulated_unreachable",
    },
    localReasonerLastWarm: {
      warmedAt: failedAt,
      provider: "local_command",
      status: "failed",
      reachable: false,
      error: "simulated_unreachable",
    },
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });
  await ledger.bootstrapAgentRuntime(
    "agent_openneed_agents",
    {
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "agent-passport",
      currentGoal: "验证 reload rehydrate pack 门禁过滤",
      currentPlan: ["生成恢复边界", "触发自动恢复", "确认门禁过滤"],
      nextAction: "执行自动恢复回归",
      claimResidentAgent: true,
      allowResidentRebind: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );

  const seed = await ledger.executeAgentRunner(
    "agent_openneed_agents",
    {
      currentGoal: "为 local reasoner 门禁回归生成 compact boundary",
      userTurn: "请基于当前上下文整理恢复边界",
      reasonerProvider: "local_mock",
      autoRecover: false,
      autoCompact: true,
      persistRun: true,
      writeConversationTurns: true,
      storeToolResults: false,
      workingCheckpointThreshold: 1,
      workingRetainCount: 1,
      turnCount: 18,
      estimatedContextChars: 24000,
      estimatedContextTokens: 6200,
    },
    { didMethod: "agentpassport" }
  );
  const compactBoundaryId = seed.compactBoundary?.compactBoundaryId || null;
  assert(compactBoundaryId, "seed runner should create a compact boundary under failed local reasoner health");
  assert.equal(seed.run?.status, "rehydrate_required");
  assert.equal(seed.recoveryAction?.action, "reload_rehydrate_pack");

  const resumed = await ledger.executeAgentRunner(
    "agent_openneed_agents",
    {
      currentGoal: "验证 reload_rehydrate_pack 不应被 local reasoner reachability 卡住",
      userTurn: "请继续推进当前任务",
      reasonerProvider: "local_mock",
      autoRecover: true,
      maxRecoveryAttempts: 1,
      autoCompact: false,
      persistRun: false,
      writeConversationTurns: false,
      storeToolResults: false,
      turnCount: 18,
      estimatedContextChars: 24000,
      estimatedContextTokens: 6200,
      resumeFromCompactBoundaryId: compactBoundaryId,
    },
    { didMethod: "agentpassport" }
  );

  const automaticReadiness = resumed.autoRecovery?.setupStatus?.automaticRecoveryReadiness;
  const activeReadiness = resumed.autoRecovery?.setupStatus?.activePlanReadiness;
  assert.equal(resumed.autoResumed, true);
  assert.equal(resumed.autoRecovery?.status, "resumed");
  assert.equal(resumed.autoRecovery?.plan?.action, "reload_rehydrate_pack");
  assert.equal(automaticReadiness?.gateReasons?.includes("local_reasoner_reachable"), true);
  assert.equal(activeReadiness?.ready, true);
  assert.equal(activeReadiness?.gateReasons?.includes("local_reasoner_reachable"), false);
  assert.equal(resumed.autoRecovery?.setupStatus?.setupComplete, true);
  assert.equal(resumed.autoRecovery?.setupStatus?.missingRequiredCodes?.includes("local_reasoner_reachable"), false);
  assert.equal(Array.isArray(resumed.recoveryChain) && resumed.recoveryChain.length >= 2, true);
});

test("concurrent persistent runner calls serialize through the store mutation queue", async () => {
  await ledger.configureDeviceRuntime({
    residentAgentId: "agent_openneed_agents",
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });
  await ledger.bootstrapAgentRuntime(
    "agent_openneed_agents",
    {
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "agent-passport",
      currentGoal: "验证并发 runner 写入不会互相覆盖",
      currentPlan: ["并发运行两次", "检查 run 记录", "检查事件链"],
      nextAction: "执行并发 runner 回归",
      claimResidentAgent: true,
      allowResidentRebind: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );

  const before = await ledger.listAgentRuns("agent_openneed_agents", { limit: 100 });
  const [first, second] = await Promise.all([
    ledger.executeAgentRunner(
      "agent_openneed_agents",
      {
        currentGoal: "并发 runner A",
        userTurn: "请记录并发 runner A",
        reasonerProvider: "local_mock",
        autoCompact: false,
        persistRun: true,
        writeConversationTurns: false,
        storeToolResults: false,
      },
      { didMethod: "agentpassport" }
    ),
    ledger.executeAgentRunner(
      "agent_openneed_agents",
      {
        currentGoal: "并发 runner B",
        userTurn: "请记录并发 runner B",
        reasonerProvider: "local_mock",
        autoCompact: false,
        persistRun: true,
        writeConversationTurns: false,
        storeToolResults: false,
      },
      { didMethod: "agentpassport" }
    ),
  ]);
  const after = await ledger.listAgentRuns("agent_openneed_agents", { limit: 100 });
  const store = await ledger.loadStore();
  const newRuns = after.runs.filter(
    (run) =>
      !before.runs.some((existing) => existing.runId === run.runId) &&
      [first.run?.runId, second.run?.runId].includes(run.runId)
  );
  const runnerEvents = (Array.isArray(store.events) ? store.events : []).filter(
    (event) =>
      event?.type === "agent_runner_executed" &&
      [first.run?.runId, second.run?.runId].includes(event?.payload?.runId)
  );

  assert.notEqual(first.run?.runId, second.run?.runId);
  assert.equal(newRuns.length, 2);
  assert.equal(runnerEvents.length, 2);
  assertEventChainContinuous(store);
  assert.deepEqual(
    newRuns.map((run) => run.currentGoal).sort(),
    ["并发 runner A", "并发 runner B"]
  );
});

test("legacy persistent writers serialize with runner writes through the store mutation queue", async () => {
  await ledger.configureDeviceRuntime({
    residentAgentId: "agent_openneed_agents",
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });
  await ledger.bootstrapAgentRuntime(
    "agent_openneed_agents",
    {
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "agent-passport",
      currentGoal: "验证 legacy 写路径与 runner 并发不会互相覆盖",
      currentPlan: ["并发写窗口", "并发写记忆", "并发写 runner"],
      nextAction: "执行 legacy writer 并发回归",
      claimResidentAgent: true,
      allowResidentRebind: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );

  const [binding, memory, snapshot, decision, message, runner] = await Promise.all([
    ledger.linkWindow({
      windowId: "legacy-queue-window",
      agentId: "agent_openneed_agents",
      label: "Legacy Queue Window",
    }),
    ledger.recordMemory("agent_openneed_agents", {
      content: "legacy queue memory survives concurrent runner write",
      kind: "test_note",
      tags: ["concurrency", "legacy-writer"],
    }),
    ledger.recordTaskSnapshot("agent_openneed_agents", {
      title: "legacy queue snapshot",
      objective: "preserve direct writer state during runner persistence",
      currentPlan: ["write snapshot", "write runner", "check event chain"],
    }),
    ledger.recordDecisionLog("agent_openneed_agents", {
      summary: "legacy queue decision survives concurrent runner write",
      rationale: "direct writer paths should use the same mutation queue as runner",
    }),
    ledger.routeMessage("agent_openneed_agents", {
      fromAgentId: "agent_openneed_agents",
      content: "legacy queue message survives concurrent runner write",
      subject: "legacy queue",
    }, { trustExplicitSender: true }),
    ledger.executeAgentRunner(
      "agent_openneed_agents",
      {
        currentGoal: "并发 legacy writer + runner",
        userTurn: "请记录 legacy writer 与 runner 并发写入",
        reasonerProvider: "local_mock",
        autoCompact: false,
        persistRun: true,
        writeConversationTurns: false,
        storeToolResults: false,
      },
      { didMethod: "agentpassport" }
    ),
  ]);
  const store = await ledger.loadStore();
  const events = Array.isArray(store.events) ? store.events : [];
  const brokenEventLinks = events.filter((event, index, allEvents) =>
    index === 0
      ? event?.previousHash !== null
      : event?.previousHash !== allEvents[index - 1]?.hash || event?.index !== index
  );

  assert.equal(store.windows?.[binding.windowId]?.agentId, "agent_openneed_agents");
  assert.equal((store.memories || []).some((entry) => entry.memoryId === memory.memoryId), true);
  assert.equal((store.taskSnapshots || []).some((entry) => entry.snapshotId === snapshot.snapshotId), true);
  assert.equal((store.decisionLogs || []).some((entry) => entry.decisionId === decision.decisionId), true);
  assert.equal((store.messages || []).some((entry) => entry.messageId === message.messageId), true);
  assert.equal((store.agentRuns || []).some((entry) => entry.runId === runner.run?.runId), true);
  assert.equal(
    events.some((event) => event?.type === "window_linked" && event?.payload?.windowId === binding.windowId),
    true
  );
  assert.equal(
    events.some((event) => event?.type === "memory_recorded" && event?.payload?.memoryId === memory.memoryId),
    true
  );
  assert.equal(
    events.some((event) => event?.type === "task_snapshot_recorded" && event?.payload?.snapshotId === snapshot.snapshotId),
    true
  );
  assert.equal(
    events.some((event) => event?.type === "decision_logged" && event?.payload?.decisionId === decision.decisionId),
    true
  );
  assert.equal(
    events.some((event) => event?.type === "message_routed" && event?.payload?.messageId === message.messageId),
    true
  );
  assert.equal(
    events.some((event) => event?.type === "agent_runner_executed" && event?.payload?.runId === runner.run?.runId),
    true
  );
  assert.equal(brokenEventLinks.length, 0);
});

test("runner, evidence, sandbox, offline replay, and session writes share one store mutation queue", async () => {
  await ledger.configureDeviceRuntime({
    residentAgentId: "agent_openneed_agents",
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
    sandboxPolicy: {
      allowedCapabilities: ["conversation_minute_write", "runtime_search"],
      workerIsolationEnabled: false,
    },
  });
  await ledger.bootstrapAgentRuntime(
    "agent_openneed_agents",
    {
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "agent-passport",
      currentGoal: "验证旧写入口统一进入 mutation queue",
      currentPlan: ["并发 runner", "并发 evidence", "并发 sandbox", "并发 offline replay", "并发 session"],
      nextAction: "执行写入纪律回归",
      claimResidentAgent: true,
      allowResidentRebind: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );
  await ledger.writePassportMemory("agent_openneed_agents", {
    layer: "working",
    kind: "conversation_turn",
    summary: "offline replay mixed writer seed",
    content: "offline replay mixed writer seed",
    payload: { field: "mixed_writer_seed", value: "present" },
    tags: ["mixed-writer", "offline-replay"],
  });

  const marker = `write-discipline-${Date.now()}`;
  const [runner, evidence, sandbox, offlineReplay, session] = await Promise.all([
    ledger.executeAgentRunner(
      "agent_openneed_agents",
      {
        currentGoal: `${marker} runner`,
        userTurn: "请记录写入纪律 runner",
        reasonerProvider: "local_mock",
        autoCompact: false,
        persistRun: true,
        writeConversationTurns: false,
        storeToolResults: false,
      },
      { didMethod: "agentpassport" }
    ),
    ledger.recordEvidenceRef("agent_openneed_agents", {
      title: `${marker} evidence`,
      summary: "并发 evidence 写入不能覆盖 runner 或 sandbox",
      kind: "runtime_probe",
      tags: [marker],
    }),
    ledger.executeAgentSandboxAction(
      "agent_openneed_agents",
      {
        interactionMode: "command",
        executionMode: "execute",
        confirmExecution: true,
        allowBootstrapBypass: true,
        currentGoal: `${marker} sandbox`,
        requestedAction: marker,
        requestedCapability: "conversation_minute_write",
        requestedActionType: "write",
        sandboxAction: {
          capability: "conversation_minute_write",
          actionType: "write",
          title: `${marker} sandbox minute`,
          summary: "并发 sandbox 写入不能覆盖 runner、evidence 或 offline replay",
          transcript: marker,
          tags: [marker],
        },
      },
      { didMethod: "agentpassport" }
    ),
    ledger.runAgentOfflineReplay(
      "agent_openneed_agents",
      {
        currentGoal: `${marker} offline replay`,
        sourceWindowId: "window_write_discipline_offline_replay",
      },
      { didMethod: "agentpassport" }
    ),
    ledger.getAgentSessionState("agent_openneed_agents", {
      didMethod: "agentpassport",
      persist: true,
    }),
  ]);

  const [runs, evidenceRefs, audits, store] = await Promise.all([
    ledger.listAgentRuns("agent_openneed_agents", { limit: 200 }),
    ledger.listEvidenceRefs("agent_openneed_agents", { limit: 200 }),
    ledger.listAgentSandboxActionAudits("agent_openneed_agents", { limit: 200 }),
    ledger.loadStore(),
  ]);
  const eventTypes = (Array.isArray(store.events) ? store.events : []).map((event) => event?.type);
  const sandboxMinute = (store.conversationMinutes || []).find((minute) => minute.title === `${marker} sandbox minute`);
  const replayEvents = (Array.isArray(store.events) ? store.events : []).filter(
    (event) => event?.type === "passport_memory_offline_replayed"
  );
  const sessionState = (store.agentSessionStates || []).find((entry) => entry.agentId === "agent_openneed_agents");

  assert.equal(runs.runs.some((run) => run.runId === runner.run?.runId), true);
  assert.equal(evidenceRefs.evidenceRefs.some((entry) => entry.evidenceRefId === evidence.evidenceRefId), true);
  assert.equal(audits.audits.some((audit) => audit.auditId === sandbox.sandboxAudit?.auditId), true);
  assert.equal(sandbox.executed, true);
  assert.equal(sandbox.sandboxExecution?.writeCount, 1);
  assert(sandboxMinute, "sandbox conversation minute should persist");
  assert.equal(offlineReplay.maintenance?.offlineReplay != null, true);
  assert.equal(replayEvents.length >= 1, true);
  assert.equal(session?.agentId, "agent_openneed_agents");
  assert(sessionState, "session persist should leave a durable agent session state");
  assert.equal(eventTypes.includes("agent_runner_executed"), true);
  assert.equal(eventTypes.includes("evidence_ref_recorded"), true);
  assert.equal(eventTypes.includes("runtime_sandbox_action_audited"), true);
  assert.equal(eventTypes.includes("runtime_sandbox_action_executed"), true);
  assert.equal(eventTypes.includes("conversation_minute_recorded"), true);
  assertEventChainContinuous(store);
});

test("legacy identity, authorization, credential, and verification mutators share one store mutation queue", async () => {
  await ledger.configureDeviceRuntime({
    residentAgentId: "agent_openneed_agents",
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });
  await ledger.bootstrapAgentRuntime(
    "agent_openneed_agents",
    {
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "agent-passport",
      currentGoal: "验证 legacy mutator 写入纪律",
      currentPlan: ["注册 agent", "生成授权 proposal", "生成凭证", "执行 verification"],
      nextAction: "执行 legacy mutator 并发回归",
      claimResidentAgent: true,
      allowResidentRebind: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );

  const marker = `legacy-mutator-${Date.now()}`;
  const [registered, proposal, credential, verification] = await Promise.all([
    ledger.registerAgent({
      displayName: `${marker} agent`,
      role: "test-agent",
      controller: "mutation queue test",
    }),
    ledger.createAuthorizationProposal({
      policyAgentId: "agent_openneed_agents",
      actionType: "grant_asset",
      title: `${marker} proposal`,
      payload: {
        fromAgentId: "agent_openneed_agents",
        targetAgentId: "agent_openneed_agents",
        amount: 1,
        assetType: "credits",
        reason: marker,
      },
      delaySeconds: 0,
      expiresInSeconds: 600,
    }),
    ledger.getAgentCredential("agent_openneed_agents", {
      didMethod: "agentpassport",
      persist: true,
    }),
    ledger.executeVerificationRun(
      "agent_openneed_agents",
      {
        currentGoal: `${marker} verification`,
        userTurn: "请验证 legacy mutator 并发写入不会覆盖账本",
        persistRun: true,
      },
      { didMethod: "agentpassport" }
    ),
  ]);

  const store = await ledger.loadStore();
  const events = Array.isArray(store.events) ? store.events : [];
  const credentialRecords = Array.isArray(store.credentials) ? store.credentials : [];

  assert(store.agents?.[registered.agentId], "registered agent should persist");
  assert(
    (store.proposals || []).some((entry) => entry.proposalId === proposal.proposalId),
    "authorization proposal should persist"
  );
  assert(
    credentialRecords.some(
      (entry) => entry.subjectId === "agent_openneed_agents" && entry.kind === "agent_identity"
    ),
    "agent credential snapshot should persist"
  );
  assert(
    (store.verificationRuns || []).some((entry) => entry.verificationRunId === verification.verificationRun?.verificationRunId),
    "verification run should persist"
  );
  assert.equal(events.some((event) => event?.type === "agent_registered" && event?.payload?.agentId === registered.agentId), true);
  assert.equal(
    events.some((event) => event?.type === "authorization_proposal_created" && event?.payload?.proposalId === proposal.proposalId),
    true
  );
  assert.equal(
    events.some(
      (event) =>
        event?.type === "verification_run_executed" &&
        event?.payload?.verificationRunId === verification.verificationRun?.verificationRunId
    ),
    true
  );
  assert(credential.credentialRecord || credential.credentials?.length > 0, "credential response should include a record");
  assertEventChainContinuous(store);
});

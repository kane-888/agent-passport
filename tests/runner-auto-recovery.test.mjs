import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-runner-auto-recovery-"));
const MAIN_AGENT_ID = "agent_main";
const LEGACY_MAIN_AGENT_ID = "agent_openneed_agents";
const FRESH_STORE_MAIN_AGENT_PHYSICAL_ID = MAIN_AGENT_ID;
const previousEnv = {
  AGENT_PASSPORT_LEDGER_PATH: process.env.AGENT_PASSPORT_LEDGER_PATH,
  AGENT_PASSPORT_STORE_KEY_PATH: process.env.AGENT_PASSPORT_STORE_KEY_PATH,
  AGENT_PASSPORT_USE_KEYCHAIN: process.env.AGENT_PASSPORT_USE_KEYCHAIN,
};

process.env.AGENT_PASSPORT_LEDGER_PATH = path.join(tempDir, "ledger.json");
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

function assertRecoveryChainFollowsBoundary(result, { resumeBoundaryId }) {
  const chain = Array.isArray(result.recoveryChain) ? result.recoveryChain : [];
  assert(chain.length >= 2, "recovery chain should include trigger and resumed attempts");
  assert(
    chain.some((entry) => entry?.resumeBoundaryId === resumeBoundaryId),
    "recovery chain should include the requested compact boundary"
  );
  assert.equal(result.autoRecovery?.finalRunId, result.run?.runId);
  assert.equal(result.autoRecovery?.finalStatus, result.run?.status);
  const runIds = chain.map((entry) => entry?.runId).filter(Boolean);
  assert.equal(new Set(runIds).size, runIds.length, "recovery chain should not repeat run ids");
}

async function assertMainAgentAliasResolvedToPhysicalOwner(expectedPhysicalOwnerId = FRESH_STORE_MAIN_AGENT_PHYSICAL_ID) {
  const [canonicalAgent, legacyAgent, runtime] = await Promise.all([
    ledger.resolveAgentIdentity({ agentId: MAIN_AGENT_ID }),
    ledger.resolveAgentIdentity({ agentId: LEGACY_MAIN_AGENT_ID }),
    ledger.getDeviceRuntimeState(),
  ]);

  assert.equal(canonicalAgent?.agentId, expectedPhysicalOwnerId);
  assert.equal(legacyAgent?.agentId, expectedPhysicalOwnerId);
  assert.equal(runtime.deviceRuntime?.residentAgentId, expectedPhysicalOwnerId);
}

let isolatedAgentCounter = 0;

function nextIsolatedAgentName(prefix) {
  isolatedAgentCounter += 1;
  return `${prefix} ${isolatedAgentCounter}`;
}

async function registerIsolatedAgent(prefix, role = "tester") {
  return ledger.registerAgent({
    displayName: nextIsolatedAgentName(prefix),
    role,
    controller: "runner-auto-recovery-test",
  });
}

async function configureResidentRuntime(agentId, overrides = {}) {
  await ledger.configureDeviceRuntime({
    residentAgentId: agentId,
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
    ...overrides,
  });
}

async function bootstrapResidentAgent(agent, overrides = {}) {
  await ledger.bootstrapAgentRuntime(
    agent.agentId,
    {
      displayName: agent.displayName,
      role: agent.role,
      longTermGoal: "agent-passport",
      currentGoal: "执行 runner auto recovery 回归",
      currentPlan: ["准备 bootstrap", "执行 runner", "校验自动恢复"],
      nextAction: "执行回归",
      claimResidentAgent: true,
      allowResidentRebind: true,
      dryRun: false,
      ...overrides,
    },
    { didMethod: "agentpassport" }
  );
}

async function seedWorkingConversation(agentId, count = 4) {
  for (let index = 0; index < count; index += 1) {
    await ledger.writePassportMemory(agentId, {
      layer: "working",
      kind: "conversation_turn",
      summary: `seed turn ${index}`,
      content: `seed turn ${index}`,
      payload: { role: "user" },
      tags: ["conversation", "user"],
    });
  }
}

function buildRehydrateTriggerPayload(overrides = {}) {
  return {
    currentGoal: "触发 rehydrate auto recovery",
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
    ...overrides,
  };
}

async function seedCompactBoundaryForIsolatedAgent(agent, overrides = {}) {
  await configureResidentRuntime(agent.agentId);
  await bootstrapResidentAgent(agent, {
    currentGoal: "生成 compact boundary",
    currentPlan: ["写 working memory", "触发 checkpoint", "生成 compact boundary"],
    nextAction: "执行 seed run",
  });
  await seedWorkingConversation(agent.agentId, 4);

  const seed = await ledger.executeAgentRunner(
    agent.agentId,
    {
      currentGoal: "为 auto recovery 回归生成 compact boundary",
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
      ...overrides,
    },
    { didMethod: "agentpassport" }
  );
  const compactBoundaryId = seed.compactBoundary?.compactBoundaryId || null;
  assert(compactBoundaryId, "seed runner should create a compact boundary");
  assert.equal(seed.run?.status, "rehydrate_required");
  assert.equal(seed.recoveryAction?.action, "reload_rehydrate_pack");
  return {
    seed,
    compactBoundaryId,
  };
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
    residentAgentId: MAIN_AGENT_ID,
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
    MAIN_AGENT_ID,
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
  await assertMainAgentAliasResolvedToPhysicalOwner();

  for (let index = 0; index < 4; index += 1) {
    await ledger.writePassportMemory(MAIN_AGENT_ID, {
      layer: "working",
      kind: "conversation_turn",
      summary: `seed turn ${index}`,
      content: `seed turn ${index}`,
      payload: { role: "user" },
      tags: ["conversation", "user"],
    });
  }

  const seed = await ledger.executeAgentRunner(
    MAIN_AGENT_ID,
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
    MAIN_AGENT_ID,
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
  assertRecoveryChainFollowsBoundary(resumed, { resumeBoundaryId: compactBoundaryId });
});

test("reload_rehydrate_pack ignores transient local reasoner reachability gate", async () => {
  const failedAt = new Date().toISOString();
  await ledger.configureDeviceRuntime({
    residentAgentId: MAIN_AGENT_ID,
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
    MAIN_AGENT_ID,
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
  await assertMainAgentAliasResolvedToPhysicalOwner();

  const seed = await ledger.executeAgentRunner(
    MAIN_AGENT_ID,
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
    MAIN_AGENT_ID,
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
  assertRecoveryChainFollowsBoundary(resumed, { resumeBoundaryId: compactBoundaryId });
});

test("bootstrap_runtime auto recovery bootstraps a minimally registered resident agent before retry", async () => {
  const agent = await registerIsolatedAgent("Bootstrap Auto Recovery");
  await configureResidentRuntime(agent.agentId);

  const resumed = await ledger.executeAgentRunner(
    agent.agentId,
    {
      currentGoal: "验证 bootstrap_runtime 自动恢复",
      userTurn: "请继续推进当前任务",
      reasonerProvider: "local_mock",
      autoRecover: true,
      maxRecoveryAttempts: 1,
      autoCompact: false,
      persistRun: false,
      writeConversationTurns: false,
      storeToolResults: false,
    },
    { didMethod: "agentpassport" }
  );

  assert.equal(resumed.autoResumed, true);
  assert.equal(resumed.autoRecovery?.plan?.action, "bootstrap_runtime");
  assert.equal(resumed.autoRecovery?.status, "resumed");
  assert.equal(resumed.run?.status, "completed");
  assert.equal(Array.isArray(resumed.recoveryChain), true);
  assert.equal(
    resumed.recoveryChain?.some((entry) => entry?.runStatus === "bootstrap_required"),
    true,
    "recovery chain should record the bootstrap-required trigger run"
  );
});

test("restore_local_reasoner auto recovery falls back after restore fails without a saved profile", async () => {
  const agent = await registerIsolatedAgent("Restore Local Reasoner");
  const healthyAt = new Date().toISOString();
  await configureResidentRuntime(agent.agentId, {
    localMode: "online_enhanced",
    allowOnlineReasoner: true,
    localReasonerProvider: "local_command",
    localReasonerCommand: "/definitely/missing/local-reasoner-bin",
    localReasonerArgs: [],
    localReasonerCwd: rootDir,
    localReasonerLastProbe: {
      checkedAt: healthyAt,
      provider: "local_command",
      status: "ready",
      reachable: true,
    },
    localReasonerLastWarm: {
      warmedAt: healthyAt,
      provider: "local_command",
      status: "ready",
      reachable: true,
    },
  });
  await bootstrapResidentAgent(agent, {
    currentGoal: "验证 restore_local_reasoner 自动恢复",
    currentPlan: ["准备不可用 reasoner", "触发恢复", "确认 fallback"],
    nextAction: "执行恢复回归",
  });

  const resumed = await ledger.executeAgentRunner(
    agent.agentId,
    {
      currentGoal: "验证 restore_local_reasoner 自动恢复",
      userTurn: "请继续推进当前任务",
      reasonerProvider: "http",
      autoRecover: true,
      maxRecoveryAttempts: 1,
      autoCompact: false,
      persistRun: false,
      writeConversationTurns: false,
      storeToolResults: false,
    },
    { didMethod: "agentpassport" }
  );

  assert.equal(resumed.autoResumed, true);
  assert.equal(resumed.autoRecovery?.plan?.action, "restore_local_reasoner");
  assert.equal(resumed.autoRecovery?.status, "resumed");
  assert.equal(resumed.run?.status, "completed");
  assert.equal(resumed.reasoner?.provider, "local_mock");
  assert.equal(resumed.run?.reasoner?.metadata?.degradedLocalFallback, true);
  assert.equal(resumed.run?.reasoner?.metadata?.degradedLocalFallbackReason, "local_mock_fallback");
  assert.equal(resumed.run?.reasoner?.metadata?.fallbackActivated, true);
  assert.equal(resumed.run?.reasoner?.metadata?.fallbackCause, "restore_local_reasoner_failed");
  assert.equal(
    resumed.autoRecovery?.dependencyWarnings?.some((warning) => warning.startsWith("restore_local_reasoner_failed:")),
    true
  );
  assert.equal(Array.isArray(resumed.recoveryChain), true);
  assert.equal(
    resumed.recoveryChain?.some((entry) => entry?.runStatus === "needs_human_review"),
    true,
    "recovery chain should record the local reasoner failure before restore"
  );
});

test("auto recovery stops at max_attempts_reached before recursive resume", async () => {
  const agent = await registerIsolatedAgent("Max Attempts");
  const { compactBoundaryId } = await seedCompactBoundaryForIsolatedAgent(agent);

  const stopped = await ledger.executeAgentRunner(
    agent.agentId,
    buildRehydrateTriggerPayload({
      currentGoal: "验证 max_attempts_reached",
      recoveryAttempt: 1,
      maxRecoveryAttempts: 1,
      resumeFromCompactBoundaryId: compactBoundaryId,
    }),
    { didMethod: "agentpassport" }
  );

  assert.equal(stopped.autoResumed, false);
  assert.equal(stopped.run?.status, "rehydrate_required");
  assert.equal(stopped.autoRecovery?.plan?.action, "reload_rehydrate_pack");
  assert.equal(stopped.autoRecovery?.status, "max_attempts_reached");
  assert.equal(stopped.recoveryChain?.length, 1);
});

test("auto recovery reports resume_boundary_unavailable when rehydrate has no resumable boundary", async () => {
  const agent = await registerIsolatedAgent("Resume Boundary Unavailable");
  await configureResidentRuntime(agent.agentId);
  await bootstrapResidentAgent(agent, {
    currentGoal: "验证 resume_boundary_unavailable",
    currentPlan: ["准备 working memory", "触发 rehydrate", "确认无边界停机"],
    nextAction: "执行恢复回归",
  });
  await seedWorkingConversation(agent.agentId, 4);

  const unavailable = await ledger.executeAgentRunner(
    agent.agentId,
    buildRehydrateTriggerPayload({
      currentGoal: "验证 resume_boundary_unavailable",
    }),
    { didMethod: "agentpassport" }
  );

  assert.equal(unavailable.autoResumed, false);
  assert.equal(unavailable.run?.status, "rehydrate_required");
  assert.equal(unavailable.recoveryAction?.action, "reload_rehydrate_pack");
  assert.equal(unavailable.autoRecovery?.plan?.action, "reload_rehydrate_pack");
  assert.equal(unavailable.autoRecovery?.status, "resume_boundary_unavailable");
  assert.equal(unavailable.compactBoundary?.compactBoundaryId ?? null, null);
  assert.equal(unavailable.recoveryAction?.followup?.resumeBoundaryId ?? null, null);
});

test("auto recovery stops with loop_detected when a compact boundary is revisited", async () => {
  const agent = await registerIsolatedAgent("Loop Detected");
  const { compactBoundaryId } = await seedCompactBoundaryForIsolatedAgent(agent);

  const stopped = await ledger.executeAgentRunner(
    agent.agentId,
    buildRehydrateTriggerPayload({
      currentGoal: "验证 loop_detected",
      maxRecoveryAttempts: 2,
      resumeFromCompactBoundaryId: compactBoundaryId,
      recoveryVisitedBoundaryIds: [compactBoundaryId],
    }),
    { didMethod: "agentpassport" }
  );

  assert.equal(stopped.autoResumed, false);
  assert.equal(stopped.run?.status, "rehydrate_required");
  assert.equal(stopped.autoRecovery?.plan?.action, "reload_rehydrate_pack");
  assert.equal(stopped.autoRecovery?.status, "loop_detected");
  assert.equal(stopped.autoRecovery?.gateReasons?.includes(`resume_boundary_reused:${compactBoundaryId}`), true);
});

test("retry_without_execution resume payload disables runner writes before recursion", async () => {
  const source = await readFile(path.join(rootDir, "src", "ledger.js"), "utf8");
  const retrySections = [...source.matchAll(/recoveryPlan\.action === "retry_without_execution"[\s\S]*?executeAgentRunner\([\s\S]*?buildAutoRecoveryResumePayload\(payload, \{([\s\S]*?)\}\),/gu)];
  const fastPathSection = source.slice(
    source.indexOf("if (retryWithoutExecutionFastPathEligible)"),
    source.indexOf("const runnerRuntimeSnapshot", source.indexOf("if (retryWithoutExecutionFastPathEligible)"))
  );

  assert.match(fastPathSection, /autoCompact:\s*false/u);
  assert.match(fastPathSection, /persistRun:\s*false/u);
  assert.match(fastPathSection, /writeConversationTurns:\s*false/u);
  assert.match(fastPathSection, /storeToolResults:\s*false/u);
  assert(retrySections.length >= 1, "retry_without_execution recovery branch should stay present");
  for (const [, payloadSection] of retrySections) {
    assert.match(payloadSection, /autoCompact:\s*false/u);
    assert.match(payloadSection, /persistRun:\s*false/u);
    assert.match(payloadSection, /writeConversationTurns:\s*false/u);
    assert.match(payloadSection, /storeToolResults:\s*false/u);
  }
});

test("concurrent persistent runner calls serialize through the store mutation queue", async () => {
  await ledger.configureDeviceRuntime({
    residentAgentId: MAIN_AGENT_ID,
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
    MAIN_AGENT_ID,
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
  await assertMainAgentAliasResolvedToPhysicalOwner();

  const before = await ledger.listAgentRuns(MAIN_AGENT_ID, { limit: 100 });
  const [first, second] = await Promise.all([
    ledger.executeAgentRunner(
      MAIN_AGENT_ID,
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
      MAIN_AGENT_ID,
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
  const after = await ledger.listAgentRuns(MAIN_AGENT_ID, { limit: 100 });
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
    residentAgentId: MAIN_AGENT_ID,
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
    MAIN_AGENT_ID,
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
  await assertMainAgentAliasResolvedToPhysicalOwner();

  const [binding, memory, snapshot, decision, message, runner] = await Promise.all([
    ledger.linkWindow({
      windowId: "legacy-queue-window",
      agentId: MAIN_AGENT_ID,
      label: "Legacy Queue Window",
    }),
    ledger.recordMemory(MAIN_AGENT_ID, {
      content: "legacy queue memory survives concurrent runner write",
      kind: "test_note",
      tags: ["concurrency", "legacy-writer"],
    }),
    ledger.recordTaskSnapshot(MAIN_AGENT_ID, {
      title: "legacy queue snapshot",
      objective: "preserve direct writer state during runner persistence",
      currentPlan: ["write snapshot", "write runner", "check event chain"],
    }),
    ledger.recordDecisionLog(MAIN_AGENT_ID, {
      summary: "legacy queue decision survives concurrent runner write",
      rationale: "direct writer paths should use the same mutation queue as runner",
    }),
    ledger.routeMessage(MAIN_AGENT_ID, {
      fromAgentId: MAIN_AGENT_ID,
      content: "legacy queue message survives concurrent runner write",
      subject: "legacy queue",
    }, { trustExplicitSender: true }),
    ledger.executeAgentRunner(
      MAIN_AGENT_ID,
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

  assert.equal(store.windows?.[binding.windowId]?.agentId, FRESH_STORE_MAIN_AGENT_PHYSICAL_ID);
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
    residentAgentId: MAIN_AGENT_ID,
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
    MAIN_AGENT_ID,
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
  await assertMainAgentAliasResolvedToPhysicalOwner();
  await ledger.writePassportMemory(MAIN_AGENT_ID, {
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
      MAIN_AGENT_ID,
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
    ledger.recordEvidenceRef(MAIN_AGENT_ID, {
      title: `${marker} evidence`,
      summary: "并发 evidence 写入不能覆盖 runner 或 sandbox",
      kind: "runtime_probe",
      tags: [marker],
    }),
    ledger.executeAgentSandboxAction(
      MAIN_AGENT_ID,
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
      MAIN_AGENT_ID,
      {
        currentGoal: `${marker} offline replay`,
        sourceWindowId: "window_write_discipline_offline_replay",
      },
      { didMethod: "agentpassport" }
    ),
    ledger.getAgentSessionState(MAIN_AGENT_ID, {
      didMethod: "agentpassport",
      persist: true,
    }),
  ]);

  const [runs, evidenceRefs, audits, store] = await Promise.all([
    ledger.listAgentRuns(MAIN_AGENT_ID, { limit: 200 }),
    ledger.listEvidenceRefs(MAIN_AGENT_ID, { limit: 200 }),
    ledger.listAgentSandboxActionAudits(MAIN_AGENT_ID, { limit: 200 }),
    ledger.loadStore(),
  ]);
  const eventTypes = (Array.isArray(store.events) ? store.events : []).map((event) => event?.type);
  const sandboxMinute = (store.conversationMinutes || []).find((minute) => minute.title === `${marker} sandbox minute`);
  const replayEvents = (Array.isArray(store.events) ? store.events : []).filter(
    (event) => event?.type === "passport_memory_offline_replayed"
  );
  const sessionState = (store.agentSessionStates || []).find(
    (entry) => entry.agentId === FRESH_STORE_MAIN_AGENT_PHYSICAL_ID
  );

  assert.equal(runs.runs.some((run) => run.runId === runner.run?.runId), true);
  assert.equal(evidenceRefs.evidenceRefs.some((entry) => entry.evidenceRefId === evidence.evidenceRefId), true);
  assert.equal(audits.audits.some((audit) => audit.auditId === sandbox.sandboxAudit?.auditId), true);
  assert.equal(sandbox.executed, true);
  assert.equal(sandbox.sandboxExecution?.writeCount, 1);
  assert(sandboxMinute, "sandbox conversation minute should persist");
  assert.equal(offlineReplay.maintenance?.offlineReplay != null, true);
  assert.equal(replayEvents.length >= 1, true);
  assert.equal(session?.agentId, FRESH_STORE_MAIN_AGENT_PHYSICAL_ID);
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
    residentAgentId: MAIN_AGENT_ID,
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
    MAIN_AGENT_ID,
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
  await assertMainAgentAliasResolvedToPhysicalOwner();

  const marker = `legacy-mutator-${Date.now()}`;
  const [registered, proposal, credential, verification] = await Promise.all([
    ledger.registerAgent({
      displayName: `${marker} agent`,
      role: "test-agent",
      controller: "mutation queue test",
    }),
    ledger.createAuthorizationProposal({
      policyAgentId: MAIN_AGENT_ID,
      actionType: "grant_asset",
      title: `${marker} proposal`,
      payload: {
        fromAgentId: MAIN_AGENT_ID,
        targetAgentId: MAIN_AGENT_ID,
        amount: 1,
        assetType: "credits",
        reason: marker,
      },
      delaySeconds: 0,
      expiresInSeconds: 600,
    }),
    ledger.getAgentCredential(MAIN_AGENT_ID, {
      didMethod: "agentpassport",
      persist: true,
    }),
    ledger.executeVerificationRun(
      MAIN_AGENT_ID,
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
      (entry) => entry.subjectId === FRESH_STORE_MAIN_AGENT_PHYSICAL_ID && entry.kind === "agent_identity"
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

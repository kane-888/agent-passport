import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const ledgerModulePath = path.join(rootDir, "src", "ledger.js");
const agentId = "agent_main";
const didMethod = "agentpassport";
const managedEnvKeys = [
  "AGENT_PASSPORT_LEDGER_PATH",
  "AGENT_PASSPORT_READ_SESSION_STORE_PATH",
  "AGENT_PASSPORT_STORE_KEY_PATH",
  "AGENT_PASSPORT_USE_KEYCHAIN",
  "AGENT_PASSPORT_RECOVERY_DIR",
  "AGENT_PASSPORT_ARCHIVE_DIR",
  "AGENT_PASSPORT_SETUP_PACKAGE_DIR",
  "AGENT_PASSPORT_STORE_KEY",
  "AGENT_PASSPORT_KEYCHAIN_ACCOUNT",
];

let importSequence = 0;

function snapshotEnv(keys = managedEnvKeys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]));
}

function applyEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function buildTempLedgerEnv(tempDir) {
  const dataDir = path.join(tempDir, "data");
  return {
    AGENT_PASSPORT_LEDGER_PATH: path.join(dataDir, "ledger.json"),
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: path.join(dataDir, "read-sessions.json"),
    AGENT_PASSPORT_STORE_KEY_PATH: path.join(dataDir, ".ledger-key"),
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
    AGENT_PASSPORT_RECOVERY_DIR: path.join(tempDir, "recovery-bundles"),
    AGENT_PASSPORT_ARCHIVE_DIR: path.join(tempDir, "archives"),
    AGENT_PASSPORT_SETUP_PACKAGE_DIR: path.join(tempDir, "device-setup-packages"),
    AGENT_PASSPORT_STORE_KEY: null,
    AGENT_PASSPORT_KEYCHAIN_ACCOUNT: `runner-auto-recovery-restart-${randomUUID()}`,
  };
}

async function withTempLedgerEnv(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-runner-auto-recovery-restart-"));
  const previousEnv = snapshotEnv();
  applyEnv(buildTempLedgerEnv(tempDir));

  try {
    return await run({
      tempDir,
      importLedger: async (label = "restart") => {
        // Force a fresh ledger.js instance so module-level caches reset like a process restart.
        const moduleUrl = new URL(pathToFileURL(ledgerModulePath).href);
        moduleUrl.searchParams.set("restart", `${process.pid}-${Date.now()}-${importSequence}-${label}`);
        importSequence += 1;
        return import(moduleUrl.href);
      },
    });
  } finally {
    applyEnv(previousEnv);
    await rm(tempDir, { recursive: true, force: true });
  }
}

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

async function seedCompactBoundary(ledger) {
  await ledger.configureDeviceRuntime({
    residentAgentId: agentId,
    residentDidMethod: didMethod,
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });
  await ledger.bootstrapAgentRuntime(
    agentId,
    {
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "agent-passport",
      currentGoal: "建立 restart auto recovery 最小运行态",
      currentPlan: ["写 profile", "写 snapshot", "生成 compact boundary"],
      nextAction: "执行 restart recovery 回归",
      claimResidentAgent: true,
      dryRun: false,
    },
    { didMethod }
  );

  for (let index = 0; index < 4; index += 1) {
    await ledger.writePassportMemory(agentId, {
      layer: "working",
      kind: "conversation_turn",
      summary: `restart seed turn ${index}`,
      content: `restart seed turn ${index}`,
      payload: { role: "user" },
      tags: ["conversation", "user", "restart-seed"],
    });
  }

  return ledger.executeAgentRunner(
    agentId,
    {
      currentGoal: "为 restart 回归生成 compact boundary",
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
    { didMethod }
  );
}

test("runner auto recovery resumes from the same ledger file after a fresh ledger.js import", async () => {
  await withTempLedgerEnv(async ({ importLedger }) => {
    const seededLedger = await importLedger("seed");
    const seeded = await seedCompactBoundary(seededLedger);
    const compactBoundaryId = seeded.compactBoundary?.compactBoundaryId || null;

    assert(compactBoundaryId, "seed runner should create a compact boundary");
    assert.equal(seeded.run?.status, "rehydrate_required");
    assert.equal(seeded.recoveryAction?.action, "reload_rehydrate_pack");

    const persistedStore = await seededLedger.loadStore();
    assert.equal(
      (Array.isArray(persistedStore.compactBoundaries) ? persistedStore.compactBoundaries : []).some(
        (boundary) => boundary?.agentId === agentId && boundary?.compactBoundaryId === compactBoundaryId
      ),
      true,
      "seeded compact boundary should be persisted before the restart import"
    );
    assertEventChainContinuous(persistedStore);

    const restartedLedger = await importLedger("restart");
    assert.notEqual(restartedLedger, seededLedger, "restart import should create a fresh ledger module instance");

    const reloadedBoundaries = await restartedLedger.listCompactBoundaries(agentId, { limit: 10 });
    assert.equal(
      reloadedBoundaries.compactBoundaries.some((boundary) => boundary?.compactBoundaryId === compactBoundaryId),
      true,
      "fresh ledger import should discover the persisted compact boundary"
    );

    const resumed = await restartedLedger.executeAgentRunner(
      agentId,
      {
        currentGoal: "验证重启后的 runner auto recovery 是否能自动续跑",
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
      { didMethod }
    );

    assert.equal(resumed.autoResumed, true);
    assert.equal(resumed.autoRecovery?.status, "resumed");
    assert.equal(resumed.autoRecovery?.setupStatus?.activePlanReadiness?.ready, true);
    assert.equal(resumed.run?.status, "completed");
    assert.equal(Array.isArray(resumed.recoveryChain) && resumed.recoveryChain.length >= 2, true);
    assertRecoveryChainFollowsBoundary(resumed, { resumeBoundaryId: compactBoundaryId });
  });
});

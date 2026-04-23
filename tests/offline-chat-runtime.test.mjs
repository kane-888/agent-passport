import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-offline-chat-runtime-"));
const ledgerPath = path.join(tempDir, "ledger.json");
const storeKeyPath = path.join(tempDir, ".ledger-key");
const readSessionPath = path.join(tempDir, "read-sessions.json");
const offlineSyncDir = path.join(tempDir, "offline-sync");
const deliveryReceiptDir = path.join(offlineSyncDir, "delivery-receipts");
const previousEnv = {
  OPENNEED_LEDGER_PATH: process.env.OPENNEED_LEDGER_PATH,
  AGENT_PASSPORT_STORE_KEY_PATH: process.env.AGENT_PASSPORT_STORE_KEY_PATH,
  AGENT_PASSPORT_READ_SESSION_STORE_PATH: process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH,
  AGENT_PASSPORT_OFFLINE_SYNC_DIR: process.env.AGENT_PASSPORT_OFFLINE_SYNC_DIR,
  AGENT_PASSPORT_USE_KEYCHAIN: process.env.AGENT_PASSPORT_USE_KEYCHAIN,
  OPENNEED_ONLINE_SYNC_ENDPOINT: process.env.OPENNEED_ONLINE_SYNC_ENDPOINT,
  OPENNEED_OFFLINE_CHAT_PERSONA_READY_CONCURRENCY: process.env.OPENNEED_OFFLINE_CHAT_PERSONA_READY_CONCURRENCY,
};
const originalFetch = globalThis.fetch;

process.env.OPENNEED_LEDGER_PATH = ledgerPath;
process.env.AGENT_PASSPORT_STORE_KEY_PATH = storeKeyPath;
process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = readSessionPath;
process.env.AGENT_PASSPORT_OFFLINE_SYNC_DIR = offlineSyncDir;
process.env.AGENT_PASSPORT_USE_KEYCHAIN = "0";
process.env.OPENNEED_ONLINE_SYNC_ENDPOINT = "https://sync.example.test/ingest";
process.env.OPENNEED_OFFLINE_CHAT_PERSONA_READY_CONCURRENCY = "4";

globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (url.endsWith("/api/tags")) {
    return new Response(JSON.stringify({ models: [{ name: "openneed" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.endsWith("/api/chat")) {
    return new Response(JSON.stringify({ message: { content: "ready" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url === "https://sync.example.test/ingest") {
    return new Response("accepted", { status: 202 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const offlineChatRuntime = await import(pathToFileURL(path.join(rootDir, "src", "offline-chat-runtime.js")).href);
const ledger = await import(pathToFileURL(path.join(rootDir, "src", "ledger.js")).href);

after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await rm(tempDir, { recursive: true, force: true });
});

test("offline chat runtime keeps startup truth read-only and treats remote-delivered sync as durable even when ledger receipt writes fail", async () => {
  const bootstrap = await offlineChatRuntime.getOfflineChatBootstrapPayload();
  const startup = await offlineChatRuntime.getOfflineChatThreadStartupContext();
  const preview = await offlineChatRuntime.previewOfflineChatGroupDispatch("继续推进 runtime 收口");

  assert.equal(bootstrap.threadStartup?.phase_1?.ok, true);
  assert.equal(startup?.ok, true);
  assert.equal(startup?.threadProtocol?.protocolVersion, "v1");
  assert.match(String(startup?.protocolActivatedAt || ""), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(preview?.threadProtocol?.protocolVersion, "v1");
  assert.deepEqual(
    (Array.isArray(bootstrap.threads) ? bootstrap.threads : []).map((entry) => entry?.threadId),
    ["group"]
  );
  const tempFilesAfterReadonly = await readdir(tempDir);
  assert.equal(tempFilesAfterReadonly.includes("ledger.json"), false);
  assert.equal(tempFilesAfterReadonly.includes(".ledger-key"), false);

  const storeAfterReadonly = await ledger.loadStore();
  const protocolRecords = (Array.isArray(storeAfterReadonly?.passportMemories) ? storeAfterReadonly.passportMemories : [])
    .filter((entry) => entry?.kind === "offline_thread_protocol_event");
  const protocolMinutes = (Array.isArray(storeAfterReadonly?.conversationMinutes) ? storeAfterReadonly.conversationMinutes : [])
    .filter((entry) => Array.isArray(entry?.tags) && entry.tags.includes("thread-protocol"));
  assert.equal(protocolRecords.length, 0);
  assert.equal(protocolMinutes.length, 0);

  const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const persona = team.personas[0];
  await ledger.writePassportMemory(persona.agent.agentId, {
    layer: "episodic",
    kind: "offline_sync_turn",
    summary: `离线单聊交换：${persona.agent.displayName}`,
    content: `${persona.agent.displayName}：继续推进`,
    payload: {
      threadId: persona.agent.agentId,
      threadKind: "direct",
      userText: "继续推进",
      assistantText: "继续推进",
      personaLabel: persona.agent.displayName,
      syncStatus: "pending_cloud",
      localReasoningStack: "offline_local_reasoning",
      responseSource: null,
      dispatchState: null,
    },
    tags: ["offline-chat", "pending-cloud-sync", `thread:${persona.agent.agentId}`, "thread-kind:direct"],
    sourceWindowId: persona.windowId,
    recordedByAgentId: persona.agent.agentId,
    recordedByWindowId: persona.windowId,
  });

  await mkdir(deliveryReceiptDir, { recursive: true });
  await chmod(tempDir, 0o555);
  let flushResult = null;
  try {
    flushResult = await offlineChatRuntime.flushOfflineChatSync();
  } finally {
    await chmod(tempDir, 0o700);
  }

  assert.equal(flushResult?.status, "delivered");
  assert.equal(flushResult?.responseStatus, 202);
  assert.equal(flushResult?.duplicateSyncRisk, false);
  assert.equal(flushResult?.localReceiptStatus, "recorded_with_warnings");
  assert.equal(Array.isArray(flushResult?.viewLines), true);
  assert.equal(
    flushResult.viewLines.some((entry) => String(entry || "").includes("最近一次同步已成功送达在线入口")),
    true
  );
  assert.equal(
    Array.isArray(flushResult?.localReceiptWarnings) &&
      flushResult.localReceiptWarnings.some((entry) => entry?.type === "ledger_receipt_write_failed"),
    true
  );

  const receiptFiles = await readdir(deliveryReceiptDir);
  assert.equal(receiptFiles.some((entry) => entry === "latest-receipt.json"), true);
  assert.equal(receiptFiles.some((entry) => entry.startsWith("receipt-") && entry.endsWith(".json")), true);

  const syncStatus = await offlineChatRuntime.getOfflineChatSyncStatus({ team });
  assert.equal(syncStatus?.status, "idle");
  assert.equal(syncStatus?.pendingCount, 0);
  assert.equal(Array.isArray(syncStatus?.viewLines), true);
  assert.equal(
    syncStatus.viewLines.some((entry) => String(entry || "").includes("离线记录已同步或当前没有待同步内容")),
    true
  );

  const secondFlush = await offlineChatRuntime.flushOfflineChatSync();
  assert.equal(secondFlush?.status, "idle");
  assert.equal(secondFlush?.pendingCount, 0);
  assert.equal(Array.isArray(secondFlush?.bundle?.entries) ? secondFlush.bundle.entries.length : 0, 0);
  assert.equal(Array.isArray(secondFlush?.viewLines), true);
  assert.equal(
    secondFlush.viewLines.some((entry) => String(entry || "").includes("离线记录已同步或当前没有待同步内容")),
    true
  );

  await rm(ledgerPath, { force: true });
  await rm(storeKeyPath, { force: true });

  const projectedBootstrapAfterStoreRemoval = await offlineChatRuntime.getOfflineChatBootstrapPayload();
  assert.equal(projectedBootstrapAfterStoreRemoval?.bootstrapState?.source, "read_only_projection");
  assert.deepEqual(
    (Array.isArray(projectedBootstrapAfterStoreRemoval?.threads)
      ? projectedBootstrapAfterStoreRemoval.threads
      : []
    ).map((entry) => entry?.threadId),
    ["group"]
  );

  const tempFilesAfterProjectedReadonly = await readdir(tempDir);
  assert.equal(tempFilesAfterProjectedReadonly.includes("ledger.json"), false);
  assert.equal(tempFilesAfterProjectedReadonly.includes(".ledger-key"), false);
});

test("offline chat history displays legacy thread protocol ids through agent-passport public naming", async () => {
  const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  await ledger.writePassportMemory(team.groupHub.agent.agentId, {
    layer: "episodic",
    kind: "offline_thread_protocol_event",
    summary: "legacy protocol naming fixture",
    content: "legacy protocol naming fixture",
    payload: {
      threadId: "group",
      threadKind: "group",
      threadProtocol: {
        protocolKey: "openneed_system_autonomy",
        protocolVersion: "v1",
        title: "legacy protocol naming fixture",
      },
      responseSource: {
        provider: "thread_protocol_runtime",
        model: "openneed_system_autonomy:v1",
        localReasoningStack: "thread_protocol_runtime",
      },
      localReasoningStack: "thread_protocol_runtime",
    },
    tags: ["offline-chat", "thread:group", "thread-kind:group", "thread-protocol"],
    sourceWindowId: team.groupHub.windowId,
    recordedByAgentId: team.groupHub.agent.agentId,
    recordedByWindowId: team.groupHub.windowId,
  });

  const history = await offlineChatRuntime.getOfflineChatHistory("group", { limit: 20, passive: false });
  const legacyMessage = history.messages.find((entry) => entry?.content === "legacy protocol naming fixture");
  assert.ok(legacyMessage);
  assert.equal(legacyMessage?.source?.model, "agent_passport_runtime:v1");
});

test("offline chat passive reads do not create a replacement key when an encrypted ledger key is missing", async () => {
  const isolatedDir = await mkdtemp(path.join(tempDir, "missing-store-key-"));
  const isolatedLedgerPath = path.join(isolatedDir, "ledger.json");
  const isolatedStoreKeyPath = path.join(isolatedDir, ".ledger-key");
  const isolatedReadSessionPath = path.join(isolatedDir, "read-sessions.json");
  const isolatedOfflineSyncDir = path.join(isolatedDir, "offline-sync");
  const childEnv = {
    ...process.env,
    OPENNEED_LEDGER_PATH: isolatedLedgerPath,
    AGENT_PASSPORT_STORE_KEY_PATH: isolatedStoreKeyPath,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: isolatedReadSessionPath,
    AGENT_PASSPORT_OFFLINE_SYNC_DIR: isolatedOfflineSyncDir,
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
    OPENNEED_ONLINE_SYNC_ENDPOINT: "",
  };
  const ledgerModuleUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
  const offlineModuleUrl = pathToFileURL(path.join(rootDir, "src", "offline-chat-runtime.js")).href;

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { loadStore } from ${JSON.stringify(ledgerModuleUrl)}; await loadStore();`,
    ],
    {
      cwd: rootDir,
      env: childEnv,
      stdio: "pipe",
    }
  );
  await rm(isolatedStoreKeyPath, { force: true });

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        `import { getOfflineChatBootstrapPayload, getOfflineChatSyncStatus } from ${JSON.stringify(offlineModuleUrl)};`,
        "const bootstrap = await getOfflineChatBootstrapPayload();",
        "const sync = await getOfflineChatSyncStatus();",
        "console.log(JSON.stringify({",
        "  source: bootstrap.bootstrapState?.source,",
        "  threads: (bootstrap.threads || []).map((entry) => entry.threadId),",
        "  syncStatus: sync.status,",
        "  pendingCount: sync.pendingCount,",
        "}));",
      ].join("\n"),
    ],
    {
      cwd: rootDir,
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const result = JSON.parse(output);

  assert.equal(result.source, "read_only_projection");
  assert.deepEqual(result.threads, ["group"]);
  assert.equal(result.syncStatus, "idle");
  assert.equal(result.pendingCount, 0);
  const isolatedFiles = await readdir(isolatedDir);
  assert.equal(isolatedFiles.includes(".ledger-key"), false);
});

test("offline chat passive bootstrap does not mask same-process missing store key with cache", async () => {
  const isolatedDir = await mkdtemp(path.join(tempDir, "same-process-missing-store-key-"));
  const isolatedLedgerPath = path.join(isolatedDir, "ledger.json");
  const isolatedStoreKeyPath = path.join(isolatedDir, ".ledger-key");
  const isolatedReadSessionPath = path.join(isolatedDir, "read-sessions.json");
  const isolatedOfflineSyncDir = path.join(isolatedDir, "offline-sync");
  const childEnv = {
    ...process.env,
    OPENNEED_LEDGER_PATH: isolatedLedgerPath,
    AGENT_PASSPORT_STORE_KEY_PATH: isolatedStoreKeyPath,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: isolatedReadSessionPath,
    AGENT_PASSPORT_OFFLINE_SYNC_DIR: isolatedOfflineSyncDir,
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
    OPENNEED_ONLINE_SYNC_ENDPOINT: "",
  };
  const offlineModuleUrl = pathToFileURL(path.join(rootDir, "src", "offline-chat-runtime.js")).href;

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        "import { rm } from 'node:fs/promises';",
        `import { bootstrapOfflineChatEnvironment, getOfflineChatBootstrapPayload } from ${JSON.stringify(offlineModuleUrl)};`,
        "await bootstrapOfflineChatEnvironment({ force: true });",
        `await rm(${JSON.stringify(isolatedStoreKeyPath)}, { force: true });`,
        "const bootstrap = await getOfflineChatBootstrapPayload();",
        "console.log(JSON.stringify({",
        "  source: bootstrap.bootstrapState?.source,",
        "  threads: (bootstrap.threads || []).map((entry) => entry.threadId),",
        "}));",
      ].join("\n"),
    ],
    {
      cwd: rootDir,
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const result = JSON.parse(output);

  assert.equal(result.source, "read_only_projection");
  assert.deepEqual(result.threads, ["group"]);
  const isolatedFiles = await readdir(isolatedDir);
  assert.equal(isolatedFiles.includes(".ledger-key"), false);
});

test("offline chat sync flush keeps pending truth when local delivery receipts are not durable", async () => {
  const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const persona = team.personas[0];
  await ledger.writePassportMemory(persona.agent.agentId, {
    layer: "episodic",
    kind: "offline_sync_turn",
    summary: `离线单聊交换：${persona.agent.displayName}`,
    content: `${persona.agent.displayName}：本地回执风险验证`,
    payload: {
      threadId: persona.agent.agentId,
      threadKind: "direct",
      userText: "本地回执风险验证",
      assistantText: "继续推进",
      personaLabel: persona.agent.displayName,
      syncStatus: "pending_cloud",
      localReasoningStack: "offline_local_reasoning",
      responseSource: null,
      dispatchState: null,
    },
    tags: ["offline-chat", "pending-cloud-sync", `thread:${persona.agent.agentId}`, "thread-kind:direct"],
    sourceWindowId: persona.windowId,
    recordedByAgentId: persona.agent.agentId,
    recordedByWindowId: persona.windowId,
  });

  await mkdir(offlineSyncDir, { recursive: true });
  await mkdir(deliveryReceiptDir, { recursive: true });
  await chmod(deliveryReceiptDir, 0o555);
  await chmod(tempDir, 0o555);
  let flushResult = null;
  try {
    flushResult = await offlineChatRuntime.flushOfflineChatSync();
  } finally {
    await chmod(tempDir, 0o700);
    await chmod(deliveryReceiptDir, 0o700);
  }

  assert.equal(flushResult?.status, "delivered");
  assert.equal(flushResult?.duplicateSyncRisk, true);
  assert.equal(flushResult?.localReceiptStatus, "at_risk");
  assert.equal(Number(flushResult?.pendingCount || 0) > 0, true);
  assert.equal(
    flushResult?.viewLines?.some((entry) => String(entry || "").includes("待同步离线记录")),
    true
  );
});

test("offline chat sync bundle ids stay unique within the same millisecond", async () => {
  const originalDateNow = Date.now;
  Date.now = () => 1730000000000;
  try {
    const first = await offlineChatRuntime.buildOfflineChatPendingSyncBundle({ persistBundle: false });
    const second = await offlineChatRuntime.buildOfflineChatPendingSyncBundle({ persistBundle: false });

    assert.match(first?.bundle?.bundleId || "", /^offline_sync_1730000000000_[a-f0-9-]+$/i);
    assert.match(second?.bundle?.bundleId || "", /^offline_sync_1730000000000_[a-f0-9-]+$/i);
    assert.notEqual(first?.bundle?.bundleId, second?.bundle?.bundleId);
  } finally {
    Date.now = originalDateNow;
  }
});

test("offline chat startup snapshot stays isolated between bootstrap and thread startup reads", async () => {
  const bootstrap = await offlineChatRuntime.getOfflineChatBootstrapPayload();
  const startup = await offlineChatRuntime.getOfflineChatThreadStartupContext();
  const originalBootstrapStartup = structuredClone(bootstrap.threadStartup?.phase_1);
  const originalStartup = structuredClone(startup);

  bootstrap.threadStartup.phase_1.parallelSubagentPolicy.maxConcurrentSubagents = 999;
  bootstrap.threadStartup.phase_1.subagentPlan[0].dispatchMode = "mutated";
  bootstrap.threadStartup.phase_1.coreParticipants[0].displayName = "被污染的名字";
  startup.parallelSubagentPolicy.maxConcurrentSubagents = 888;
  startup.subagentPlan[0].dispatchMode = "polluted";
  startup.coreParticipants[0].displayName = "第二次污染";

  const refreshedBootstrap = await offlineChatRuntime.getOfflineChatBootstrapPayload();
  const refreshedStartup = await offlineChatRuntime.getOfflineChatThreadStartupContext();

  assert.deepEqual(refreshedBootstrap.threadStartup?.phase_1, originalBootstrapStartup);
  assert.deepEqual(refreshedStartup, originalStartup);
  assert.notStrictEqual(refreshedBootstrap.threadStartup?.phase_1, bootstrap.threadStartup?.phase_1);
  assert.notStrictEqual(refreshedStartup, startup);
});

test("offline chat passive bootstrap keeps direct thread ids unique after fresh bootstrap", async () => {
  const freshTeam = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const passiveBootstrap = await offlineChatRuntime.getOfflineChatBootstrapPayload();
  const threadIds = (Array.isArray(passiveBootstrap?.threads) ? passiveBootstrap.threads : [])
    .map((entry) => entry?.threadId)
    .filter(Boolean);
  const directThreadIds = threadIds.filter((entry) => entry !== "group");
  const expectedDirectThreadIds = freshTeam.personas.map((persona) => persona?.agent?.agentId).filter(Boolean);

  assert.equal(new Set(threadIds).size, threadIds.length);
  assert.equal(new Set(directThreadIds).size, directThreadIds.length);
  assert.equal(directThreadIds.length, expectedDirectThreadIds.length);
  assert.deepEqual([...new Set(directThreadIds)].sort(), [...new Set(expectedDirectThreadIds)].sort());
});

test("offline chat fan-out execution does not pollute startup config snapshots", async () => {
  const beforeBootstrap = await offlineChatRuntime.getOfflineChatBootstrapPayload();
  const beforeStartup = structuredClone(beforeBootstrap.threadStartup?.phase_1);

  const seedToken = `fanout-isolation-${Date.now()}`;
  const fanOutPrompt =
    `请直接推进 public/offline-chat-app.js、src/server-offline-chat-routes.js 和 README.md 的 subagent fan-out 执行态收口，要求把 thread-startup-context、group history、UI 摘要和路由边界一起对齐。 token=${seedToken}`;
  const preview = await offlineChatRuntime.previewOfflineChatGroupDispatch(fanOutPrompt);
  assert.equal(preview?.parallelAllowed, true);
  assert.equal(
    preview?.batchPlan.some((batch) => batch?.executionMode === "parallel"),
    true
  );

  const fanOutResult = await offlineChatRuntime.sendOfflineChatGroupMessage(fanOutPrompt, {
    verificationMode: "synthetic",
  });
  assert.equal(fanOutResult?.threadId, "group");
  assert.equal(fanOutResult?.dispatch?.parallelAllowed, true);
  assert.equal(
    Array.isArray(fanOutResult?.dispatch?.batchPlan) &&
      fanOutResult.dispatch.batchPlan.some((batch) => batch?.executionMode === "parallel"),
    true
  );
  assert.equal(Array.isArray(fanOutResult?.responses), true);
  assert.equal(typeof fanOutResult?.executionSummary, "string");
  assert.equal(fanOutResult.executionSummary.includes("fan-out"), true);
  assert.equal(fanOutResult?.dispatchView?.hidden, false);
  assert.equal(Array.isArray(fanOutResult?.dispatchHistory), true);
  assert.equal(fanOutResult.dispatchHistory?.[0]?.recordId, fanOutResult?.groupRecord?.passportMemoryId);
  const startupSignature = JSON.parse(fanOutResult.startupSignature);
  assert.equal(startupSignature?.protocolKey, fanOutResult?.threadProtocol?.protocolKey);
  assert.equal(startupSignature?.protocolVersion, fanOutResult?.threadProtocol?.protocolVersion);
  assert.equal(Object.hasOwn(startupSignature, "protocolRecordId"), false);
  assert.equal(fanOutResult?.threadStartup?.startupSignature, fanOutResult.startupSignature);
  assert.equal(fanOutResult?.threadView?.startupSignature, fanOutResult.startupSignature);
  assert.equal(
    Array.isArray(fanOutResult?.threadView?.context?.summaryLines) &&
      fanOutResult.threadView.context.summaryLines.some((entry) => String(entry || "").includes("最近执行")),
    true
  );

  const afterStartup = await offlineChatRuntime.getOfflineChatThreadStartupContext();
  const afterBootstrap = await offlineChatRuntime.getOfflineChatBootstrapPayload();

  assert.equal(afterStartup.startupSignature, beforeStartup.startupSignature);
  assert.equal(afterBootstrap.threadStartup?.phase_1?.startupSignature, beforeStartup.startupSignature);
  assert.deepEqual(afterStartup.parallelSubagentPolicy, beforeStartup.parallelSubagentPolicy);
  assert.deepEqual(afterStartup.subagentPlan, beforeStartup.subagentPlan);
  assert.deepEqual(afterBootstrap.threadStartup?.phase_1.parallelSubagentPolicy, beforeStartup.parallelSubagentPolicy);
  assert.deepEqual(afterBootstrap.threadStartup?.phase_1.subagentPlan, beforeStartup.subagentPlan);
});

test("offline chat generic continue inherits the latest concrete fan-out scope", async () => {
  const seedToken = `fanout-continue-${Date.now()}`;
  const concretePrompt =
    `请直接推进 public/offline-chat-app.js、src/server-offline-chat-routes.js 和 README.md 的 subagent fan-out 执行态收口，要求把 thread-startup-context、group history、UI 摘要和路由边界一起对齐。 token=${seedToken}`;
  const concreteResult = await offlineChatRuntime.sendOfflineChatGroupMessage(concretePrompt);

  assert.equal(concreteResult?.dispatch?.parallelAllowed, true);
  assert.equal(concreteResult?.execution?.executionMode, "automatic_fanout");

  const continuePreview = await offlineChatRuntime.previewOfflineChatGroupDispatch("继续推进");
  assert.equal(continuePreview?.parallelAllowed, true);
  assert.equal(continuePreview?.continuation?.active, true);
  assert.equal(continuePreview?.continuation?.sourceRecordId, concreteResult?.groupRecord?.passportMemoryId);
  assert.equal(
    Array.isArray(continuePreview?.batchPlan) && continuePreview.batchPlan.some((batch) => batch?.executionMode === "parallel"),
    true
  );

  const continueResult = await offlineChatRuntime.sendOfflineChatGroupMessage("继续推进");
  assert.equal(continueResult?.dispatch?.parallelAllowed, true);
  assert.equal(continueResult?.dispatch?.continuation?.active, true);
  assert.equal(continueResult?.dispatch?.continuation?.sourceRecordId, concreteResult?.groupRecord?.passportMemoryId);
  assert.equal(continueResult?.execution?.executionMode, "automatic_fanout");
  assert.equal(
    Array.isArray(continueResult?.dispatch?.batchPlan) &&
      continueResult.dispatch.batchPlan.some((batch) => batch?.executionMode === "parallel"),
    true
  );

  const latestHistory = await offlineChatRuntime.getOfflineChatHistory("group", { limit: 8 });
  assert.equal(latestHistory?.dispatch?.continuation?.active, true);
  assert.equal(latestHistory?.dispatch?.continuation?.sourceRecordId, concreteResult?.groupRecord?.passportMemoryId);
  assert.equal(latestHistory?.execution?.executionMode, "automatic_fanout");
  assert.equal(latestHistory?.threadStartup?.startupSignature, latestHistory?.startupSignature);
  assert.equal(latestHistory?.threadView?.startupSignature, latestHistory?.startupSignature);
});

test("offline chat bootstrap payload carries latest group dispatch history for ui fallback", async () => {
  const seedToken = `fanout-bootstrap-${Date.now()}`;
  const result = await offlineChatRuntime.sendOfflineChatGroupMessage(
    `请直接推进 public/offline-chat-app.js、src/server-offline-chat-routes.js 和 README.md 的 subagent fan-out 执行态收口。 token=${seedToken}`
  );

  const bootstrap = await offlineChatRuntime.getOfflineChatBootstrapPayload({ passive: false });
  const groupMeta = bootstrap?.threadHistoryMeta?.group || null;

  assert.equal(groupMeta?.dispatch?.parallelAllowed, true);
  assert.equal(groupMeta?.execution?.executionMode, "automatic_fanout");
  assert.equal(Array.isArray(groupMeta?.dispatchHistory), true);
  assert.equal(groupMeta?.dispatchHistory?.[0]?.recordId, result?.groupRecord?.passportMemoryId);
  assert.equal(groupMeta?.dispatchView?.hidden, false);
  assert.equal(
    Array.isArray(groupMeta?.dispatchView?.summaryLines) && groupMeta.dispatchView.summaryLines.length > 0,
    true
  );
});

test("offline chat bootstrap cache is invalidated by store writes", async () => {
  await offlineChatRuntime.bootstrapOfflineChatEnvironment();
  const cached = await offlineChatRuntime.bootstrapOfflineChatEnvironment();
  assert.equal(cached.bootstrapState?.source, "cache");

  const persona = cached.personas[0];
  await ledger.writePassportMemory(persona.agent.agentId, {
    layer: "working",
    kind: "bootstrap_cache_probe",
    summary: "bootstrap cache invalidation probe",
    content: "store write should invalidate offline bootstrap cache",
    tags: ["offline-chat", "cache-invalidation"],
    sourceWindowId: persona.windowId,
    recordedByAgentId: persona.agent.agentId,
    recordedByWindowId: persona.windowId,
  });

  const refreshed = await offlineChatRuntime.bootstrapOfflineChatEnvironment();
  assert.notEqual(refreshed.bootstrapState?.source, "cache");
});

test("offline chat bootstrap fingerprint includes device runtime truth", () => {
  const baseStore = {
    chainId: "chain_same",
    lastEventHash: "hash_same",
    agents: { agent_a: {} },
    windows: { window_a: {} },
    deviceRuntime: {
      localMode: "local_only",
      localReasoner: {
        provider: "ollama_local",
        model: "model_a",
      },
    },
  };
  const changedRuntimeStore = {
    ...baseStore,
    deviceRuntime: {
      ...baseStore.deviceRuntime,
      localReasoner: {
        ...baseStore.deviceRuntime.localReasoner,
        model: "model_b",
      },
    },
  };

  assert.notEqual(
    offlineChatRuntime.fingerprintOfflineBootstrapStore(baseStore),
    offlineChatRuntime.fingerprintOfflineBootstrapStore(changedRuntimeStore)
  );
});

test("offline chat bootstrap shares in-flight refresh after store fingerprint changes", async () => {
  const isolatedDir = await mkdtemp(path.join(tempDir, "bootstrap-inflight-fingerprint-"));
  const isolatedLedgerPath = path.join(isolatedDir, "ledger.json");
  const isolatedStoreKeyPath = path.join(isolatedDir, ".ledger-key");
  const isolatedReadSessionPath = path.join(isolatedDir, "read-sessions.json");
  const isolatedOfflineSyncDir = path.join(isolatedDir, "offline-sync");
  const childEnv = {
    ...process.env,
    OPENNEED_LEDGER_PATH: isolatedLedgerPath,
    AGENT_PASSPORT_STORE_KEY_PATH: isolatedStoreKeyPath,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: isolatedReadSessionPath,
    AGENT_PASSPORT_OFFLINE_SYNC_DIR: isolatedOfflineSyncDir,
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
    OPENNEED_ONLINE_SYNC_ENDPOINT: "",
  };
  const ledgerModuleUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
  const offlineModuleUrl = pathToFileURL(path.join(rootDir, "src", "offline-chat-runtime.js")).href;

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        `import { writePassportMemory } from ${JSON.stringify(ledgerModuleUrl)};`,
        `import { bootstrapOfflineChatEnvironment } from ${JSON.stringify(offlineModuleUrl)};`,
        "const cached = await bootstrapOfflineChatEnvironment({ force: true });",
        "const persona = cached.personas[0];",
        "await writePassportMemory(persona.agent.agentId, {",
        "  layer: 'episodic',",
        "  kind: 'offline_sync_turn',",
        "  summary: '触发 bootstrap fingerprint 变化',",
        "  content: 'fingerprint changed',",
        "  tags: ['offline-chat', 'thread-kind:direct'],",
        "});",
        "const [first, second] = await Promise.all([",
        "  bootstrapOfflineChatEnvironment(),",
        "  bootstrapOfflineChatEnvironment(),",
        "]);",
        "console.log(JSON.stringify({",
        "  sources: [first.bootstrapState?.source, second.bootstrapState?.source].sort(),",
        "}));",
      ].join("\n"),
    ],
    {
      cwd: rootDir,
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const result = JSON.parse(output);

  assert.deepEqual(result.sources, ["fresh", "shared_inflight"]);
});

test("offline chat passive sync status does not probe loopback endpoint discovery", async () => {
  const previousEndpoint = process.env.OPENNEED_ONLINE_SYNC_ENDPOINT;
  const previousFetch = globalThis.fetch;
  let loopbackProbeCount = 0;

  process.env.OPENNEED_ONLINE_SYNC_ENDPOINT = "";
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (url === "http://127.0.0.1:3000/api/health") {
      loopbackProbeCount += 1;
      throw new Error("passive sync status must not probe loopback endpoint");
    }
    return previousFetch(input, init);
  };

  try {
    const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
    const syncStatus = await offlineChatRuntime.getOfflineChatSyncStatus({ team, passive: true });

    assert.equal(syncStatus?.endpointConfigured, false);
    assert.equal(loopbackProbeCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEndpoint == null) {
      delete process.env.OPENNEED_ONLINE_SYNC_ENDPOINT;
    } else {
      process.env.OPENNEED_ONLINE_SYNC_ENDPOINT = previousEndpoint;
    }
  }
});

test("offline chat direct shared-memory fast path skips persona readiness writes", async () => {
  const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const persona = team.personas[0];
  const listProfileMemories = async () =>
    ledger.listPassportMemories(persona.agent.agentId, {
      layer: "profile",
      includeInactive: true,
      limit: 200,
    });
  const beforeProfiles = await listProfileMemories();
  const beforeCount = Array.isArray(beforeProfiles?.memories) ? beforeProfiles.memories.length : 0;

  const fastResult = await offlineChatRuntime.sendOfflineChatDirectMessage(
    persona.agent.agentId,
    `你还记得我最终目标是什么吗？ token=direct-fast-${Date.now()}`
  );
  const afterFastProfiles = await listProfileMemories();
  const afterFastCount = Array.isArray(afterFastProfiles?.memories) ? afterFastProfiles.memories.length : 0;

  assert.equal(fastResult?.reasoning?.provider, "passport_fast_memory");
  assert.equal(afterFastCount, beforeCount);
});

test("offline chat direct send returns server-owned runtime views for api consumers", async () => {
  const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const persona = team.personas[0];
  const result = await offlineChatRuntime.sendOfflineChatDirectMessage(
    persona.agent.agentId,
    `继续收口单聊运行态真值 token=direct-view-${Date.now()}`
  );

  assert.equal(result?.threadId, persona.agent.agentId);
  assert.equal(result?.dispatchView?.hidden, true);
  assert.equal(result?.threadView?.threadId, persona.agent.agentId);
  assert.equal(result?.threadView?.header?.title, persona.displayName);
  assert.equal(typeof result?.startupSignature, "string");
  assert.equal(result.startupSignature.length > 0, true);
  assert.equal(result?.threadStartup?.startupSignature, result.startupSignature);
  assert.equal(result?.threadView?.startupSignature, result.startupSignature);

  const history = await offlineChatRuntime.getOfflineChatHistory(persona.agent.agentId, {
    passive: false,
    limit: 8,
  });
  assert.equal(history?.threadView?.threadId, persona.agent.agentId);
  assert.equal(history?.startupSignature, result.startupSignature);
  assert.equal(history?.threadStartup?.startupSignature, history.startupSignature);
  assert.equal(history?.threadView?.startupSignature, history.startupSignature);
});

test("offline chat group shared-memory fast path skips persona readiness writes for responding roles", async () => {
  const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const profileCountByAgentId = new Map();
  for (const persona of team.personas) {
    const listed = await ledger.listPassportMemories(persona.agent.agentId, {
      layer: "profile",
      includeInactive: true,
      limit: 200,
    });
    profileCountByAgentId.set(
      persona.agent.agentId,
      Array.isArray(listed?.memories) ? listed.memories.length : 0
    );
  }

  const result = await offlineChatRuntime.sendOfflineChatGroupMessage(
    `你们还记得我说过意识上传那件事吗？ token=group-fast-${Date.now()}`
  );

  assert.equal(Array.isArray(result?.responses) && result.responses.length >= 1, true);
  assert.equal(
    result.responses.every((entry) => entry?.source?.provider === "passport_fast_memory"),
    true
  );

  for (const response of result.responses) {
    const listed = await ledger.listPassportMemories(response.agentId, {
      layer: "profile",
      includeInactive: true,
      limit: 200,
    });
    const nextCount = Array.isArray(listed?.memories) ? listed.memories.length : 0;
    assert.equal(nextCount, profileCountByAgentId.get(response.agentId) || 0);
  }
});

test("offline chat synthetic verification mode keeps dispatch semantics without persona readiness writes", async () => {
  const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const profileCountByAgentId = new Map();
  for (const persona of team.personas) {
    const listed = await ledger.listPassportMemories(persona.agent.agentId, {
      layer: "profile",
      includeInactive: true,
      limit: 200,
    });
    profileCountByAgentId.set(
      persona.agent.agentId,
      Array.isArray(listed?.memories) ? listed.memories.length : 0
    );
  }
  const countPersonaTurnArtifacts = (store, agentId) => ({
    turns: (Array.isArray(store?.passportMemories) ? store.passportMemories : []).filter(
      (entry) => entry?.agentId === agentId && entry?.kind === "offline_sync_turn"
    ).length,
    minutes: (Array.isArray(store?.conversationMinutes) ? store.conversationMinutes : []).filter(
      (entry) =>
        entry?.agentId === agentId &&
        Array.isArray(entry?.tags) &&
        entry.tags.includes("offline-minute")
    ).length,
  });
  const storeBeforeSynthetic = await ledger.loadStore();
  const syntheticArtifactCountsByAgentId = new Map(
    team.personas.map((persona) => [
      persona.agent.agentId,
      countPersonaTurnArtifacts(storeBeforeSynthetic, persona.agent.agentId),
    ])
  );

  const fanOutResult = await offlineChatRuntime.sendOfflineChatGroupMessage(
    `请让设计体验和后端平台两个 subagent 并行收口 UI 状态设计与 API 契约。 token=synthetic-fanout-${Date.now()}`,
    { verificationMode: "synthetic" }
  );

  assert.equal(fanOutResult?.dispatch?.parallelAllowed, true);
  assert.equal(fanOutResult?.execution?.executionMode, "automatic_fanout");
  assert.equal(Array.isArray(fanOutResult?.responses) && fanOutResult.responses.length >= 1, true);
  assert.equal(fanOutResult.responses.every((entry) => entry?.source?.provider === "local_mock"), true);
  for (const response of fanOutResult.responses) {
    const listed = await ledger.listPassportMemories(response.agentId, {
      layer: "profile",
      includeInactive: true,
      limit: 200,
    });
    const nextCount = Array.isArray(listed?.memories) ? listed.memories.length : 0;
    assert.equal(nextCount, profileCountByAgentId.get(response.agentId) || 0);
  }
  const storeAfterFanout = await ledger.loadStore();
  for (const persona of team.personas) {
    assert.deepEqual(
      countPersonaTurnArtifacts(storeAfterFanout, persona.agent.agentId),
      syntheticArtifactCountsByAgentId.get(persona.agent.agentId),
      "synthetic fan-out 不应为 persona 写入 offline_sync_turn 或 conversation minute"
    );
  }

  const serialResult = await offlineChatRuntime.sendOfflineChatGroupMessage(
    `继续推进 synthetic serial fallback。 token=synthetic-serial-${Date.now()}`,
    { verificationMode: "synthetic" }
  );
  assert.equal(serialResult?.dispatch?.parallelAllowed, false);
  assert.equal(serialResult?.execution?.executionMode, "serial_fallback");
  assert.equal(serialResult.responses.every((entry) => entry?.source?.provider === "local_mock"), true);
  const storeAfterSerial = await ledger.loadStore();
  for (const persona of team.personas) {
    assert.deepEqual(
      countPersonaTurnArtifacts(storeAfterSerial, persona.agent.agentId),
      syntheticArtifactCountsByAgentId.get(persona.agent.agentId),
      "synthetic serial fallback 不应为 persona 写入 offline_sync_turn 或 conversation minute"
    );
  }
});

test("executeAgentRunner keeps negotiation-required status when bootstrap bypass is enabled", async () => {
  await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const originalRuntime = (await ledger.getDeviceRuntimeState()).deviceRuntime;
  await ledger.configureDeviceRuntime({
    residentLocked: false,
  });

  try {
    const runnerPayload = {
      currentGoal: "验证 bootstrap bypass 不会覆盖 command negotiation 状态",
      userTurn: "请直接删除这台机器上的历史资料",
      interactionMode: "command",
      requestedAction: "删除本地历史资料",
      executionMode: "execute",
      confirmExecution: false,
      autoCompact: false,
      persistRun: false,
      storeToolResults: false,
      writeConversationTurns: false,
      turnCount: 1,
      estimatedContextChars: 600,
    };

    const blockedByBootstrap = await ledger.executeAgentRunner("agent_openneed_agents", runnerPayload, {
      didMethod: "agentpassport",
    });
    assert.equal(blockedByBootstrap.bootstrapGate?.required, true);
    assert.equal(blockedByBootstrap.run?.status, "bootstrap_required");
    assert.equal(blockedByBootstrap.queryState?.status, "bootstrap_required");

    const bypassedBootstrap = await ledger.executeAgentRunner(
      "agent_openneed_agents",
      {
        ...runnerPayload,
        allowBootstrapBypass: true,
      },
      {
        didMethod: "agentpassport",
      }
    );

    assert.equal(bypassedBootstrap.bootstrapGate?.required, true);
    assert.equal(bypassedBootstrap.negotiation?.riskTier, "critical");
    assert.equal(bypassedBootstrap.negotiation?.authorizationStrategy, "multisig");
    assert.equal(bypassedBootstrap.negotiation?.decision, "multisig");
    assert.equal(bypassedBootstrap.run?.status, "negotiation_required");
    assert.equal(bypassedBootstrap.queryState?.status, "negotiation_required");
  } finally {
    await ledger.configureDeviceRuntime({
      residentLocked: originalRuntime?.residentLocked,
    });
  }
});

test("offline chat active preview can reuse the latest group dispatch as continuation seed", async () => {
  const seedToken = `fanout-preview-${Date.now()}`;
  const result = await offlineChatRuntime.sendOfflineChatGroupMessage(
    `请直接推进 public/offline-chat-app.js、src/server-offline-chat-routes.js 和 README.md 的 subagent fan-out 执行态收口，要求把 thread-startup-context、group history、UI 摘要和路由边界一起对齐。 token=${seedToken}`
  );

  const preview = await offlineChatRuntime.previewOfflineChatGroupDispatch("继续推进", { passive: false });

  assert.equal(preview?.parallelAllowed, true);
  assert.equal(preview?.continuation?.active, true);
  assert.equal(preview?.continuation?.sourceRecordId, result?.groupRecord?.passportMemoryId);
  assert.equal(preview?.signals?.continuationActive, true);
  assert.equal(
    Array.isArray(preview?.batchPlan) && preview.batchPlan.some((batch) => batch?.executionMode === "parallel"),
    true
  );
});

test("writePassportMemories batches persona profile writes and still supersedes older field values", async () => {
  const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const persona = team.personas[0];

  const initialRecords = await ledger.writePassportMemories(persona.agent.agentId, [
    {
      layer: "profile",
      kind: "stable_preference",
      summary: "批量测试字段一",
      content: "初始值 A",
      payload: {
        field: "batch_test_field_a",
        value: "初始值 A",
      },
      tags: ["offline-chat", "test"],
      sourceWindowId: persona.windowId,
      recordedByAgentId: persona.agent.agentId,
      recordedByWindowId: persona.windowId,
    },
    {
      layer: "profile",
      kind: "stable_preference",
      summary: "批量测试字段二",
      content: "初始值 B",
      payload: {
        field: "batch_test_field_b",
        value: "初始值 B",
      },
      tags: ["offline-chat", "test"],
      sourceWindowId: persona.windowId,
      recordedByAgentId: persona.agent.agentId,
      recordedByWindowId: persona.windowId,
    },
  ]);

  assert.equal(initialRecords.length, 2);

  const updatedRecords = await ledger.writePassportMemories(persona.agent.agentId, [
    {
      layer: "profile",
      kind: "stable_preference",
      summary: "批量测试字段一",
      content: "更新值 A",
      payload: {
        field: "batch_test_field_a",
        value: "更新值 A",
      },
      tags: ["offline-chat", "test"],
      sourceWindowId: persona.windowId,
      recordedByAgentId: persona.agent.agentId,
      recordedByWindowId: persona.windowId,
    },
  ]);

  assert.equal(updatedRecords.length, 1);

  const listed = await ledger.listPassportMemories(persona.agent.agentId, {
    layer: "profile",
    includeInactive: true,
    limit: 200,
  });
  const fieldARecords = (listed.memories || []).filter(
    (entry) => entry?.payload?.field === "batch_test_field_a"
  );
  const fieldBRecords = (listed.memories || []).filter(
    (entry) => entry?.payload?.field === "batch_test_field_b"
  );
  const activeFieldA = fieldARecords.filter((entry) => entry?.status !== "superseded");
  const activeFieldB = fieldBRecords.filter((entry) => entry?.status !== "superseded");

  assert.equal(fieldARecords.length, 2);
  assert.equal(activeFieldA.length, 1);
  assert.equal(activeFieldA[0]?.payload?.value, "更新值 A");
  assert.equal(fieldBRecords.length, 1);
  assert.equal(activeFieldB.length, 1);
  assert.equal(activeFieldB[0]?.payload?.value, "初始值 B");
});

test("offline chat history can reuse an in-memory store snapshot without rereading the ledger file", async () => {
  const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const persona = team.personas[0];

  await ledger.writePassportMemory(persona.agent.agentId, {
    layer: "episodic",
    kind: "offline_sync_turn",
    summary: `离线单聊交换：${persona.displayName}`,
    content: `${persona.displayName}：继续推进`,
    payload: {
      threadId: persona.agent.agentId,
      threadKind: "direct",
      userText: "继续推进",
      assistantText: "继续推进",
      personaLabel: persona.displayName,
      syncStatus: "pending_cloud",
      localReasoningStack: "offline_local_reasoning",
      responseSource: null,
      dispatchState: null,
    },
    tags: ["offline-chat", "pending-cloud-sync", `thread:${persona.agent.agentId}`, "thread-kind:direct"],
    sourceWindowId: persona.windowId,
    recordedByAgentId: persona.agent.agentId,
    recordedByWindowId: persona.windowId,
  });

  const storeSnapshot = await ledger.loadStore();
  await rm(ledgerPath, { force: true });
  await rm(storeKeyPath, { force: true });

  const history = await offlineChatRuntime.getOfflineChatHistory(persona.agent.agentId, {
    passive: false,
    store: storeSnapshot,
    limit: 8,
  });

  assert.equal(history.threadId, persona.agent.agentId);
  assert.equal(Array.isArray(history.messages), true);
  assert.equal(history.messages.some((entry) => String(entry?.content || "").includes("继续推进")), true);
});

test("buildAgentContextBundle can reuse an in-memory store snapshot without rereading the ledger file", async () => {
  const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const persona = team.personas[0];

  await ledger.writePassportMemory(persona.agent.agentId, {
    layer: "semantic",
    kind: "stable_preference",
    summary: "上下文稳态目标",
    content: "继续推进记忆稳态引擎，优先减少无效上下文坍缩。",
    payload: {
      field: "context_homeostasis_goal",
      value: "继续推进记忆稳态引擎，优先减少无效上下文坍缩。",
    },
    tags: ["offline-chat", "test"],
    sourceWindowId: persona.windowId,
    recordedByAgentId: persona.agent.agentId,
    recordedByWindowId: persona.windowId,
  });

  const storeSnapshot = await ledger.loadStore();
  storeSnapshot.cognitiveStates = [
    {
      agentId: persona.agent.agentId,
      cognitiveStateId: "cog_test_projection",
      mode: "recovering",
      dominantStage: "episodic",
      continuityScore: 0.78,
      calibrationScore: 0.66,
      recoveryReadinessScore: 0.71,
      fatigue: 0.42,
      sleepDebt: 0.28,
      uncertainty: 0.31,
      rewardPredictionError: 0.37,
      threat: 0.19,
      novelty: 0.24,
      socialSalience: 0.15,
      homeostaticPressure: 0.41,
      sleepPressure: 0.36,
      dominantRhythm: "theta_like",
      transitionReason: "test_projection",
      bodyLoop: {
        taskBacklog: 0.55,
        conflictDensity: 0.22,
        humanVetoRate: 0.11,
        overallLoad: 0.48,
        hiddenField: "should_not_leak",
      },
      interoceptiveState: {
        sleepPressure: 0.36,
        allostaticLoad: 0.27,
        metabolicStress: 0.18,
        interoceptivePredictionError: 0.12,
        bodyBudget: 0.63,
        hiddenField: "should_not_leak",
      },
      neuromodulators: {
        dopamineRpe: 0.34,
        acetylcholineEncodeBias: 0.41,
        norepinephrineSurprise: 0.22,
        serotoninStability: 0.58,
        dopaminergicAllocationBias: 0.29,
        hiddenField: "should_not_leak",
      },
      oscillationSchedule: {
        currentPhase: "online_theta",
        dominantRhythm: "theta_like",
        nextPhase: "offline_ripple",
        transitionReason: "test_projection",
        replayEligible: true,
        phaseWeights: {
          online_theta_like: 0.64,
          offline_ripple_like: 0.23,
          offline_homeostatic: 0.13,
          hiddenField: "should_not_leak",
        },
      },
      replayOrchestration: {
        shouldReplay: true,
        replayMode: "interleaved_theta_ripple",
        replayDrive: 0.51,
        consolidationBias: "goal_supporting",
        replayWindowHours: 6,
        gatingReason: "test_projection",
        targetTraceClasses: ["goal_supporting_traces", "conflicting_traces"],
        hiddenField: "should_not_leak",
      },
      stageWeights: {
        perception: 1.1,
      },
      preferenceProfile: {
        stablePreferences: ["should_not_leak"],
      },
      adaptation: {
        recoveryCount: 3,
      },
      goalState: {
        primaryGoal: "should_not_leak",
      },
      selfEvaluation: {
        continuationDecision: "should_not_leak",
      },
      strategyProfile: {
        strategyName: "should_not_leak",
      },
      signals: {
        queryIteration: 9,
      },
      updatedAt: "2099-01-01T00:00:00.000Z",
    },
  ];
  await rm(ledgerPath, { force: true });
  await rm(storeKeyPath, { force: true });

  const contextBundle = await ledger.buildAgentContextBundle(
    persona.agent.agentId,
    {
      currentGoal: "继续推进记忆稳态引擎",
      query: "上下文稳态",
      recentConversationTurns: [
        {
          role: "user",
          content: "继续推进上下文稳态",
        },
      ],
    },
    {
      store: storeSnapshot,
    }
  );

  assert.equal(contextBundle?.slots?.perceptionSnapshot?.query, "上下文稳态");
  assert.equal(Array.isArray(contextBundle?.memoryLayers?.relevant?.semantic), true);
  assert.equal((contextBundle?.memoryLayers?.relevant?.semantic || []).length >= 1, true);
  assert.equal(Array.isArray(contextBundle?.slots?.relevantSemanticMemories), true);
  assert.equal(typeof contextBundle?.slots?.relevantSemanticMemories?.[0]?.summary, "string");
  assert.equal(Array.isArray(contextBundle?.slots?.relevantLedgerFacts?.commitments), true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.slots?.relevantSemanticMemories?.[0] || {}, "payload"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.slots?.relevantLedgerFacts?.commitments?.[0] || {}, "payload"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.slots?.workingMemoryState?.taskSnapshot || {}, "driftPolicy"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.slots?.identitySnapshot?.taskSnapshot || {}, "currentPlan"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.slots?.identitySnapshot?.taskSnapshot || {}, "constraints"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.slots?.workingMemoryState?.checkpoints?.[0] || {}, "payload"),
    false
  );
  assert.equal(Array.isArray(contextBundle?.localKnowledge?.hits), true);
  assert.equal(
    Number(contextBundle?.localKnowledge?.counts?.localMatched || 0),
    contextBundle?.localKnowledge?.hits?.length || 0
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.localKnowledge?.hits?.[0] || {}, "linked"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.localKnowledge?.hits?.[0] || {}, "text"),
    false
  );
  assert.equal(
    Number(contextBundle?.localKnowledge?.retrieval?.hitCount || 0),
    contextBundle?.localKnowledge?.hits?.length || 0
  );
  assert.equal(typeof contextBundle?.localKnowledge?.retrieval?.strategy, "string");
  assert.equal(Array.isArray(contextBundle?.externalColdMemory?.hits), true);
  assert.equal(
    Number(contextBundle?.externalColdMemory?.hitCount || 0),
    contextBundle?.externalColdMemory?.hits?.length || 0
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.externalColdMemory?.hits?.[0] || {}, "linked"),
    false
  );
  assert.equal(contextBundle?.slots?.continuousCognitiveState?.mode, "recovering");
  assert.deepEqual(
    contextBundle?.slots?.continuousCognitiveState?.replayOrchestration?.targetTraceClasses,
    ["goal_supporting_traces", "conflicting_traces"]
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.slots?.continuousCognitiveState || {}, "preferenceProfile"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.slots?.continuousCognitiveState || {}, "strategyProfile"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.slots?.continuousCognitiveState || {}, "signals"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(contextBundle?.slots?.continuousCognitiveState?.bodyLoop || {}, "hiddenField"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      contextBundle?.slots?.continuousCognitiveState?.replayOrchestration || {},
      "hiddenField"
    ),
    false
  );

  const reusedBundle = await ledger.buildAgentContextBundle(
    persona.agent.agentId,
    {
      currentGoal: "继续推进记忆稳态引擎",
      query: "上下文稳态",
      recentConversationTurns: [
        {
          role: "user",
          content: "继续推进上下文稳态",
        },
      ],
    },
    {
      store: storeSnapshot,
    }
  );
  const differentQueryBundle = await ledger.buildAgentContextBundle(
    persona.agent.agentId,
    {
      currentGoal: "继续推进记忆稳态引擎",
      query: "完全不同的查询",
      recentConversationTurns: [
        {
          role: "user",
          content: "继续推进上下文稳态",
        },
      ],
    },
    {
      store: storeSnapshot,
    }
  );

  assert.equal(reusedBundle?.memoryLayers, contextBundle?.memoryLayers);
  assert.equal(reusedBundle?.contextHash, contextBundle?.contextHash);
  assert.notEqual(differentQueryBundle?.memoryLayers, contextBundle?.memoryLayers);
  assert.notEqual(differentQueryBundle?.contextHash, contextBundle?.contextHash);
});

test("verifyAgentResponse keeps claim and sentence bindings valid after support selection optimization", async () => {
  const team = await offlineChatRuntime.bootstrapOfflineChatEnvironment({ force: true });
  const persona = team.personas[0];
  const expectedName = "测试验证专员";

  await ledger.writePassportMemory(persona.agent.agentId, {
    layer: "profile",
    kind: "stable_identity",
    summary: "当前对外名字",
    content: expectedName,
    payload: {
      field: "name",
      value: expectedName,
    },
    tags: ["offline-chat", "verification-test"],
    sourceWindowId: persona.windowId,
    recordedByAgentId: persona.agent.agentId,
    recordedByWindowId: persona.windowId,
  });

  const verification = await ledger.verifyAgentResponse(persona.agent.agentId, {
    responseText: `名字：${expectedName}`,
    claims: {
      displayName: expectedName,
    },
  });

  const displayNameBinding = (verification?.references?.claimBindings || []).find(
    (entry) => entry?.claimKey === "displayName"
  );

  assert.equal(verification?.valid, true);
  assert.equal(displayNameBinding?.claimValue, expectedName);
  assert.equal(
    Number(displayNameBinding?.supportSummary?.totalSupportCount || 0) >= 1,
    true
  );
  assert.equal(
    Number(verification?.references?.sentenceBindings?.length || 0) >= 1,
    true
  );
});

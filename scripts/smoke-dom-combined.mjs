import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert } from "./smoke-shared.mjs";
import { assertPublicCopyPolicyForRoot } from "./public-copy-policy.mjs";
import {
  summarizeDeviceSetupExpectation,
  summarizeRecoveryBundleExpectation,
  summarizeRecoveryRehearsalExpectation,
  summarizeSetupPackageExpectation,
} from "./smoke-expectations.mjs";
import {
  cleanupSmokeSecretIsolation,
  createSmokeLogger,
  ensureSmokeLedgerInitialized,
  localReasonerFixturePath,
  resolveLiveRuntimePaths,
  rootDir,
  seedSmokeSecretIsolation,
  smokeTraceEnabled,
} from "./smoke-env.mjs";
import { PUBLIC_RUNTIME_ENTRY_HREFS } from "../public/runtime-truth-client.js";

async function readPublicFile(filename) {
  return fs.readFile(path.join(rootDir, "public", filename), "utf8");
}

function includesAll(source, expectedStrings, label) {
  for (const expected of expectedStrings) {
    assert(source.includes(expected), `${label} 缺少 ${expected}`);
  }
}

function extractElementTextById(html, id) {
  const pattern = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "u");
  const match = pattern.exec(html);
  return match ? match[1].replace(/<[^>]+>/gu, "").replace(/\s+/gu, " ").trim() : "";
}

async function assertPublicRuntimeContracts() {
  const [
    indexHtml,
    runtimeTruthClientJs,
    operatorHtml,
    repairHubHtml,
    labHtml,
    offlineChatHtml,
    offlineChatAppJs,
  ] = await Promise.all([
    readPublicFile("index.html"),
    readPublicFile("runtime-truth-client.js"),
    readPublicFile("operator.html"),
    readPublicFile("repair-hub.html"),
    readPublicFile("lab.html"),
    readPublicFile("offline-chat.html"),
    readPublicFile("offline-chat-app.js"),
  ]);
  await assertPublicCopyPolicyForRoot(rootDir);
  const publicRuntimeSource = `${indexHtml}\n${runtimeTruthClientJs}`;
  assert(
    extractElementTextById(indexHtml, "runtime-home-intro") === "正在加载公开入口真值。",
    "公开运行态 HTML 静态壳应只保留中性占位，正文由 PUBLIC_RUNTIME_HOME_COPY 渲染"
  );
  includesAll(
    publicRuntimeSource,
    [
      "agent-passport 公开运行态",
      "runtime-home-summary",
      'id="runtime-link-list"',
      'data-runtime-link-source="PUBLIC_RUNTIME_HOME_COPY"',
      "runtime-operator-entry-summary",
      ...PUBLIC_RUNTIME_ENTRY_HREFS,
      "受保护修复证据面",
      'fetchJsonWithRetry("/api/security")',
      'fetchJsonWithRetry("/api/health")',
      'cache: "no-store"',
    ],
    "公开运行态 HTML"
  );
  includesAll(
    runtimeTruthClientJs,
    [
      "PUBLIC_RUNTIME_HOME_COPY",
      ...PUBLIC_RUNTIME_ENTRY_HREFS,
    ],
    "公开运行态真值客户端"
  );
  includesAll(
    operatorHtml,
    [
      'from "/runtime-truth-client.js"',
      "formatProtectedReadSurface",
      'cache: "no-store"',
      "operator-admin-token-form",
      "operator-export-incident-packet",
      "受保护修复证据面",
      "/api/security",
      "/api/device/setup",
    ],
    "operator HTML"
  );
  includesAll(
    repairHubHtml,
    [
      "/ui-links.js",
      'from "/runtime-truth-client.js"',
      'cache: "no-store"',
      "formatProtectedReadSurface",
      "返回公开运行态",
      "受保护修复证据面",
      "agent-passport 记忆稳态引擎",
      'id="repair-hub-admin-token-form"',
    ],
    "repair-hub HTML"
  );
  assert(!repairHubHtml.includes("OpenNeed 记忆稳态引擎"), "repair-hub HTML 不应把 OpenNeed 作为对外产品名");
  assert(!repairHubHtml.includes("did:openneed 视角"), "repair-hub HTML 不应把 did:openneed 作为对外可见视角标签");
  assert(repairHubHtml.includes("兼容 DID 视角"), "repair-hub HTML 应把 legacy DID 方法显示为兼容视角");
  assert(!repairHubHtml.includes("LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY"), "repair-hub.html 不应复制 legacy admin token 迁移常量");
  assert(!repairHubHtml.includes("const ADMIN_TOKEN_STORAGE_KEY"), "repair-hub.html 不应复制 admin token storage key");
  includesAll(
    labHtml,
    [
      'from "/runtime-truth-client.js"',
      "formatProtectedReadSurface",
      'cache: "no-store"',
      "runtime-security-boundaries-panel",
      "runtime-housekeeping-form",
      "受保护修复证据面",
      'href="/operator"',
      'href="/offline-chat"',
      'href="/repair-hub"',
    ],
    "lab HTML"
  );
  includesAll(
    offlineChatHtml,
    [
      'id="offline-chat-hero-summary"',
      "正在加载离线线程真值。",
      "进入受保护修复证据面",
      "线程上下文",
      'id="auth-token-form"',
      "/offline-chat-app.js",
    ],
    "offline-chat HTML"
  );
  assert(
    offlineChatAppJs.includes("OFFLINE_CHAT_HOME_COPY") &&
      runtimeTruthClientJs.includes("AGENT_PASSPORT_MEMORY_ENGINE_LABEL") &&
      runtimeTruthClientJs.includes("OFFLINE_CHAT_HOME_COPY"),
    "offline-chat HTML 应通过共享 OFFLINE_CHAT_HOME_COPY 渲染 hero 真值文案"
  );
  assert(
    runtimeTruthClientJs.includes("agent-passport 记忆稳态引擎") &&
      !runtimeTruthClientJs.includes(" 的底层运行时由 OpenNeed 记忆稳态引擎提供"),
    "公开运行态文案应使用 agent-passport 对外引擎名"
  );
  assert(!offlineChatHtml.includes("提供底层运行信息支持"), "offline-chat HTML 不应保留旧的底层支撑硬编码文案");
  includesAll(
    offlineChatAppJs,
    [
      'from "/runtime-truth-client.js"',
      "readStoredAdminToken",
      'cache = "no-store"',
      "离线线程运行信息、线程历史、同步和发送消息",
    ],
    "offline-chat-app.js"
  );
  assert(
    /function\s+isLegacyOpenNeedDisplayText\s*\([^)]*\)\s*\{[\s\S]*return\s+new Set\(\[[\s\S]*"ollama \+ gemma4"[\s\S]*"gemma4:e4b"[\s\S]*"e4b \+ 类人脑神经网络"[\s\S]*"类人脑神经网络"[\s\S]*\]\)\.has\(normalized\);[\s\S]*\}/u.test(runtimeTruthClientJs) &&
      !runtimeTruthClientJs.includes('normalized.includes("ollama + gemma4")') &&
      !runtimeTruthClientJs.includes('normalized.includes("类人脑神经网络")'),
    "runtime-truth-client.js legacy source/model 归一应使用精确历史别名，不应靠宽泛 substring"
  );
}

async function copyPathIfExists(sourcePath, targetPath) {
  try {
    await fs.copyFile(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-passport-smoke-dom-combined-"));
const dataDir = path.join(smokeRoot, "data");
const recoveryDir = path.join(dataDir, "recovery-bundles");
const setupPackageDir = path.join(dataDir, "device-setup-packages");
const smokeIsolationAccount = path.basename(smokeRoot);
const scriptPath = fileURLToPath(import.meta.url);
const directExecution = process.argv[1] ? path.resolve(process.argv[1]) === scriptPath : false;
const liveRuntime = resolveLiveRuntimePaths();
const traceSmoke = createSmokeLogger("smoke-dom:combined", directExecution || smokeTraceEnabled);

process.env.OPENNEED_LEDGER_PATH = path.join(dataDir, "ledger.json");
process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = path.join(dataDir, "read-sessions.json");
process.env.AGENT_PASSPORT_STORE_KEY_PATH = path.join(dataDir, ".ledger-key");
process.env.AGENT_PASSPORT_RECOVERY_DIR = recoveryDir;
process.env.AGENT_PASSPORT_SETUP_PACKAGE_DIR = setupPackageDir;
process.env.AGENT_PASSPORT_SIGNING_SECRET_PATH = path.join(dataDir, ".did-signing-master-secret");
process.env.AGENT_PASSPORT_KEYCHAIN_ACCOUNT = smokeIsolationAccount;
process.env.AGENT_PASSPORT_USE_KEYCHAIN = process.env.AGENT_PASSPORT_USE_KEYCHAIN || "0";

await fs.mkdir(dataDir, { recursive: true });
await copyPathIfExists(liveRuntime.ledgerPath, process.env.OPENNEED_LEDGER_PATH);
await copyPathIfExists(liveRuntime.storeKeyPath, process.env.AGENT_PASSPORT_STORE_KEY_PATH);
await seedSmokeSecretIsolation({
  dataDir,
  keychainAccount: smokeIsolationAccount,
  liveRuntime,
});
await ensureSmokeLedgerInitialized({
  OPENNEED_LEDGER_PATH: process.env.OPENNEED_LEDGER_PATH,
  AGENT_PASSPORT_READ_SESSION_STORE_PATH: process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH,
  AGENT_PASSPORT_STORE_KEY_PATH: process.env.AGENT_PASSPORT_STORE_KEY_PATH,
  AGENT_PASSPORT_RECOVERY_DIR: process.env.AGENT_PASSPORT_RECOVERY_DIR,
  AGENT_PASSPORT_SETUP_PACKAGE_DIR: process.env.AGENT_PASSPORT_SETUP_PACKAGE_DIR,
  AGENT_PASSPORT_SIGNING_SECRET_PATH: process.env.AGENT_PASSPORT_SIGNING_SECRET_PATH,
  AGENT_PASSPORT_KEYCHAIN_ACCOUNT: process.env.AGENT_PASSPORT_KEYCHAIN_ACCOUNT,
  AGENT_PASSPORT_USE_KEYCHAIN: process.env.AGENT_PASSPORT_USE_KEYCHAIN,
});

const {
  configureDeviceRuntime,
  exportDeviceSetupPackage,
  exportStoreRecoveryBundle,
  getDeviceSetupStatus,
  listDeviceSetupPackages,
  listRecoveryRehearsals,
  listStoreRecoveryBundles,
  runDeviceSetup,
  rehearseStoreRecoveryBundle,
} = await import("../src/ledger.js");
const {
  getOfflineChatBootstrapPayload,
  getOfflineChatHistory,
  sendOfflineChatGroupMessage,
} = await import("../src/offline-chat-runtime.js");

async function main() {
  const phaseTimings = [];
  const publicContractStartedAt = Date.now();
  await assertPublicRuntimeContracts();
  traceSmoke("public runtime contract checks");
  phaseTimings.push({
    phase: "public_runtime_contracts",
    durationMs: Date.now() - publicContractStartedAt,
  });

  const configuredRuntime = await configureDeviceRuntime({
    residentAgentId: "agent_openneed_agents",
    residentDidMethod: "agentpassport",
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_command",
    localReasonerCommand: process.execPath,
    localReasonerArgs: [localReasonerFixturePath],
    localReasonerCwd: rootDir,
    filesystemAllowlist: [dataDir, "/tmp"],
  });
  assert(configuredRuntime.deviceRuntime?.localReasoner?.provider === "local_command", "runtime 应切到 local_command");
  traceSmoke("device runtime configured");

  const recoveryStartedAt = Date.now();
  const recoveryBundles = await listStoreRecoveryBundles({ limit: 5 });
  const recoveryExport = await exportStoreRecoveryBundle({
    passphrase: "smoke-dom-combined-recovery-passphrase",
    note: "smoke-dom combined recovery bundle preview",
    includeLedgerEnvelope: true,
    saveToFile: false,
    returnBundle: true,
    dryRun: true,
  });
  assert(recoveryExport.bundle?.format === "agent-passport-store-recovery-v1", "recovery export format 不正确");
  const recoveryRehearsal = await rehearseStoreRecoveryBundle({
    passphrase: "smoke-dom-combined-recovery-passphrase",
    bundle: recoveryExport.bundle,
    dryRun: true,
    persist: false,
  });
  assert(recoveryRehearsal.rehearsal?.status, "recovery rehearsal 缺少 status");
  const recoveryRehearsalHistory = await listRecoveryRehearsals({ limit: 5 });
  traceSmoke("recovery preview checks");
  phaseTimings.push({
    phase: "recovery_preview",
    durationMs: Date.now() - recoveryStartedAt,
  });

  const setupStartedAt = Date.now();
  const setupStatus = await getDeviceSetupStatus();
  const setupRun = await runDeviceSetup({
    residentAgentId: "agent_openneed_agents",
    residentDidMethod: "agentpassport",
    recoveryPassphrase: "smoke-dom-combined-recovery-passphrase",
    dryRun: true,
  });
  assert(setupRun.bootstrap?.bootstrap?.dryRun === true, "device setup dryRun 应透传到 bootstrap");
  const setupPackagePreview = await exportDeviceSetupPackage({
    dryRun: true,
    saveToFile: false,
    returnPackage: false,
    includeLocalReasonerProfiles: false,
  });
  assert(setupPackagePreview.summary?.packageId, "device setup package preview 缺少 packageId");
  const setupPackages = await listDeviceSetupPackages({ limit: 5 });
  traceSmoke("device setup preview checks");
  phaseTimings.push({
    phase: "device_setup_preview",
    durationMs: Date.now() - setupStartedAt,
  });

  const offlineFanoutStartedAt = Date.now();
  const offlineChatBootstrap = await getOfflineChatBootstrapPayload({ passive: false });
  assert(Array.isArray(offlineChatBootstrap.personas) && offlineChatBootstrap.personas.length >= 1, "offline chat bootstrap 应返回 persona 列表");
  assert(offlineChatBootstrap.groupHub?.agent?.agentId, "offline chat bootstrap 应返回 group hub");

  const offlineGroupFanoutProbe = `请让设计体验和后端平台两个 subagent 并行收口 UI 状态设计与 API 契约。 smoke-dom-combined-fanout-${Date.now()}`;
  const offlineGroupFanoutResult = await sendOfflineChatGroupMessage(offlineGroupFanoutProbe, {
    verificationMode: "synthetic",
  });
  assert(
    offlineGroupFanoutResult?.dispatch?.parallelAllowed === true,
    "offline group fan-out prompt 应返回已放行的并行 dispatch"
  );
  assert(
    offlineGroupFanoutResult?.execution?.executionMode === "automatic_fanout",
    "offline group fan-out prompt 应返回 automatic_fanout execution"
  );
  assert(
    Array.isArray(offlineGroupFanoutResult?.dispatch?.batchPlan) &&
      offlineGroupFanoutResult.dispatch.batchPlan.some((batch) => batch?.executionMode === "parallel"),
    "offline group fan-out prompt 应至少返回一个并行 fan-out 批次"
  );
  const offlineGroupDispatchHistory = await getOfflineChatHistory("group", { limit: 3 });
  assert(
    offlineGroupDispatchHistory?.dispatchHistory?.[0]?.recordId === offlineGroupFanoutResult?.groupRecord?.passportMemoryId,
    "offline group history latest round 应对齐刚写入的 fan-out 记录"
  );
  assert(
    Number(offlineGroupDispatchHistory?.dispatchHistory?.[0]?.parallelBatchCount || 0) >= 1,
    "offline group history latest round 应保留并行批次统计"
  );
  traceSmoke("offline chat fan-out checks");
  phaseTimings.push({
    phase: "offline_chat_fanout",
    durationMs: Date.now() - offlineFanoutStartedAt,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        smokeDomStage: "combined",
        mode: "combined",
        phaseTimings,
        recoveryBundleCount: recoveryBundles.counts?.total || recoveryBundles.bundles.length || 0,
        recoveryRehearsalStatus: recoveryRehearsal.rehearsal?.status || null,
        recoveryRehearsalCount: recoveryRehearsalHistory.counts?.total || recoveryRehearsalHistory.rehearsals.length || 0,
        ...summarizeRecoveryBundleExpectation({
          previewBundleId: recoveryExport.summary?.bundleId || null,
          persistedBundleId: null,
          persistedBundleCount: recoveryBundles.counts?.total || recoveryBundles.bundles.length || 0,
        }),
        ...summarizeRecoveryRehearsalExpectation({
          rehearsal: recoveryRehearsal.rehearsal,
          rehearsalCount: recoveryRehearsalHistory.counts?.total || recoveryRehearsalHistory.rehearsals.length || 0,
          persist: false,
        }),
        deviceSetupComplete: setupStatus.setupComplete || false,
        deviceSetupRunComplete: setupRun.status?.setupComplete || false,
        ...summarizeDeviceSetupExpectation(setupStatus, setupRun, setupPackagePreview.summary),
        setupPackageId: setupPackagePreview.summary?.packageId || null,
        ...summarizeSetupPackageExpectation({
          previewPackageId: setupPackagePreview.summary?.packageId || null,
          persistedPackageId: null,
          observedPersistedPackageCount: setupPackages.counts?.total || setupPackages.packages.length || 0,
          embeddedProfileCount: null,
          prunedDeletedCount: 0,
        }),
        localReasonerSelectedProvider: configuredRuntime.deviceRuntime?.localReasoner?.provider || null,
        offlineChatPersonaCount: offlineChatBootstrap.personas.length || 0,
        offlineChatFanoutExecutionMode: offlineGroupFanoutResult?.execution?.executionMode || null,
        offlineChatFanoutParallelAllowed: offlineGroupFanoutResult?.dispatch?.parallelAllowed === true,
        offlineChatFanoutParallelBatchCount: Array.isArray(offlineGroupFanoutResult?.dispatch?.batchPlan)
          ? offlineGroupFanoutResult.dispatch.batchPlan.filter((entry) => entry?.executionMode === "parallel").length
          : 0,
        offlineChatDispatchLatestRecordId: offlineGroupDispatchHistory?.dispatchHistory?.[0]?.recordId || null,
        offlineChatDispatchLatestParallelBatchCount: Number(
          offlineGroupDispatchHistory?.dispatchHistory?.[0]?.parallelBatchCount || 0
        ),
        combinedChecks: ["public_runtime_contracts", "recovery", "device_setup", "offline_chat_fanout"],
      },
      null,
      2
    )
  );
}

async function cleanupSmokeDomCombinedArtifacts() {
  await cleanupSmokeSecretIsolation({
    keychainAccount: smokeIsolationAccount,
    cleanupRoot: smokeRoot,
  });
}

async function flushSmokeDomCombinedStreams() {
  await Promise.all([
    new Promise((resolve) => process.stdout.write("", resolve)),
    new Promise((resolve) => process.stderr.write("", resolve)),
  ]);
}

try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
        ...(process.env.SMOKE_DEBUG_STACK === "1" ? { stack: error.stack } : {}),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  try {
    await cleanupSmokeDomCombinedArtifacts();
  } catch (cleanupError) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: cleanupError.message,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
  if (directExecution) {
    await flushSmokeDomCombinedStreams();
    process.exit(process.exitCode ?? 0);
  }
}

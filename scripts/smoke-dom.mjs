import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildVerificationFieldValuePropositions, buildVerificationPropositionRecord } from "../src/proposition-graph.js";
import { assert } from "./smoke-shared.mjs";
import {
  cleanupSmokeSecretIsolation,
  createSmokeLogger,
  localReasonerFixturePath,
  resolveLiveRuntimePaths,
  rootDir,
  seedSmokeSecretIsolation,
} from "./smoke-env.mjs";
import { createMockMempalaceFixture } from "./smoke-mempalace.mjs";

const smokeCombined = process.env.SMOKE_COMBINED === "1";
const smokeDomRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openneed-memory-smoke-dom-"));
const dataDir = path.join(smokeDomRoot, "data");
const recoveryDir = path.join(dataDir, "recovery-bundles");
const setupPackageDir = path.join(dataDir, "device-setup-packages");
const smokeIsolationAccount = path.basename(smokeDomRoot);
const smokeDomScriptPath = fileURLToPath(import.meta.url);
const smokeDomDirectExecution = process.argv[1] ? path.resolve(process.argv[1]) === smokeDomScriptPath : false;
const liveRuntime = resolveLiveRuntimePaths();
const traceSmoke = createSmokeLogger("smoke-dom");

process.env.OPENNEED_LEDGER_PATH = path.join(dataDir, "ledger.json");
process.env.AGENT_PASSPORT_STORE_KEY_PATH = path.join(dataDir, ".ledger-key");
process.env.AGENT_PASSPORT_RECOVERY_DIR = recoveryDir;
process.env.AGENT_PASSPORT_SETUP_PACKAGE_DIR = setupPackageDir;
process.env.AGENT_PASSPORT_SIGNING_SECRET_PATH = path.join(dataDir, ".did-signing-master-secret");
process.env.AGENT_PASSPORT_KEYCHAIN_ACCOUNT = smokeIsolationAccount;

await fs.mkdir(dataDir, { recursive: true });
try {
  await fs.copyFile(liveRuntime.ledgerPath, process.env.OPENNEED_LEDGER_PATH);
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}
try {
  await fs.copyFile(liveRuntime.storeKeyPath, process.env.AGENT_PASSPORT_STORE_KEY_PATH);
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}
await seedSmokeSecretIsolation({
  dataDir,
  keychainAccount: smokeIsolationAccount,
  liveRuntime,
});

const {
  bootstrapAgentRuntime,
  buildAgentContextBundle,
  checkAgentContextDrift,
  compareCredentialStatusLists,
  configureSecurityPosture,
  configureDeviceRuntime,
  createReadSession,
  deleteDeviceSetupPackage,
  executeAgentRunner,
  executeAgentSandboxAction,
  exportDeviceSetupPackage,
  exportStoreRecoveryBundle,
  getDeviceLocalReasonerCatalog,
  getDeviceLocalReasonerProfile,
  getDeviceSetupPackage,
  getDeviceSetupStatus,
  getDeviceRuntimeState,
  getCurrentSecurityPostureState,
  inspectDeviceLocalReasoner,
  getAgentCredential,
  getAgentContext,
  getAgentRehydratePack,
  getAgentRuntime,
  getAgentSessionState,
  getCredential,
  getCredentialStatus,
  getCredentialTimeline,
  getMigrationRepair,
  getMigrationRepairCredentials,
  getWindow,
  importStoreRecoveryBundle,
  importDeviceSetupPackage,
  listAgentRuns,
  listAgentTranscript,
  listAgentSandboxActionAudits,
  listCompactBoundaries,
  listConversationMinutes,
  listDeviceLocalReasonerProfiles,
  listDeviceLocalReasonerRestoreCandidates,
  listDeviceSetupPackages,
  listPassportMemories,
  listMigrationRepairs,
  listRecoveryRehearsals,
  listReadSessions,
  listSecurityAnomalies,
  listStoreRecoveryBundles,
  listVerificationRuns,
  listWindows,
  probeDeviceLocalReasoner,
  prewarmDeviceLocalReasoner,
  repairAgentComparisonMigration,
  pruneDeviceSetupPackages,
  rehearseStoreRecoveryBundle,
  revokeAllReadSessions,
  revokeReadSession,
  runDeviceSetup,
  restoreDeviceLocalReasoner,
  saveDeviceLocalReasonerProfile,
  searchAgentRuntimeKnowledge,
  selectDeviceLocalReasoner,
  activateDeviceLocalReasonerProfile,
  deleteDeviceLocalReasonerProfile,
  validateReadSessionToken,
  verifyAgentResponse,
  executeVerificationRun,
} = await import("../src/ledger.js");
const { generateAgentRunnerCandidateResponse } = await import("../src/reasoner.js");
const { executeSandboxBroker } = await import("../src/runtime-sandbox-broker-client.js");
const {
  getSystemKeychainStatus,
  shouldPreferSystemKeychain,
} = await import("../src/local-secrets.js");
const { runRuntimeHousekeeping } = await import("../src/runtime-housekeeping.js");
const {
  getOfflineChatBootstrapPayload,
  getOfflineChatHistory,
  sendOfflineChatDirectMessage,
  sendOfflineChatGroupMessage,
} = await import("../src/offline-chat-runtime.js");
const { detectSharedMemoryIntent } = await import("../src/offline-chat-shared-memory.js");

await import(pathToFileURL(path.join(rootDir, "public", "ui-links.js")).href);

const links = globalThis.AgentPassportLinks || globalThis.OpenNeedRuntimeLinks || {};

async function runSandboxBroker(payload) {
  return executeSandboxBroker(payload, {
    timeoutMs: payload?.timeoutMs,
  });
}

async function readPage(filename) {
  return fs.readFile(path.join(rootDir, "public", filename), "utf8");
}

async function createCapturedReasonerServer() {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        body = rawBody;
      }
      requests.push({
        method: req.method || "GET",
        url: req.url || "/",
        body,
        rawBody,
      });

      if ((req.url || "").startsWith("/chat/completions")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-capture",
            object: "chat.completion",
            model: "capture-openai",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "remote reasoner redaction ok",
                },
                finish_reason: "stop",
              },
            ],
          })
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: "capture-http",
          responseText: "remote reasoner redaction ok",
        })
      );
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

function includesAll(haystack, needles, label) {
  for (const needle of needles) {
    assert(haystack.includes(needle), `${label} 缺少 ${needle}`);
  }
}

function minuteContainsToken(minute, token) {
  const haystack = [
    minute?.title,
    minute?.summary,
    minute?.transcript,
    ...(Array.isArray(minute?.highlights) ? minute.highlights : []),
  ]
    .filter(Boolean)
    .join("\n");
  return haystack.includes(token);
}

async function main() {
  traceSmoke("bootstrap isolated workspace");
  const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  assert(packageJson.scripts?.["smoke:all"], "package.json 缺少 smoke:all 顺序回归脚本");

  assert(typeof links.parseRuntimeHomeSearch === "function", "AgentPassportLinks.parseRuntimeHomeSearch 不可用");
  assert(typeof links.buildRuntimeHomeHref === "function", "AgentPassportLinks.buildRuntimeHomeHref 不可用");
  assert(typeof links.parseRepairHubSearch === "function", "AgentPassportLinks.parseRepairHubSearch 不可用（legacy alias OpenNeedRuntimeLinks 也可接受）");
  assert(typeof links.buildPublicRuntimeHref === "function", "AgentPassportLinks.buildPublicRuntimeHref 不可用");
  assert(typeof links.buildRepairHubHref === "function", "AgentPassportLinks.buildRepairHubHref 不可用（legacy alias OpenNeedRuntimeLinks 也可接受）");

  const [indexHtml, operatorHtml, repairHubHtml, labHtml, offlineChatHtml, offlineChatAppJs] = await Promise.all([
    readPage("index.html"),
    readPage("operator.html"),
    readPage("repair-hub.html"),
    readPage("lab.html"),
    readPage("offline-chat.html"),
    readPage("offline-chat-app.js"),
  ]);
  traceSmoke("html contract checks");

  includesAll(
    indexHtml,
    [
      "agent-passport 公开运行态",
      "runtime-home-summary",
      "runtime-health-summary",
      "runtime-health-detail",
      "runtime-recovery-summary",
      "runtime-recovery-detail",
      "runtime-automation-summary",
      "runtime-automation-detail",
      "runtime-operator-entry-summary",
      "runtime-trigger-list",
      "runtime-link-list",
      "/operator",
      "/offline-chat",
      "/lab.html",
      "/repair-hub",
      "/api/security",
      "/api/health",
      "fetchJsonWithRetry",
      'fetchJsonWithRetry("/api/security")',
      'fetchJsonWithRetry("/api/health")',
    ],
    "公开运行态 HTML"
  );
  includesAll(
    operatorHtml,
    [
      "agent-passport 值班与恢复决策面",
      "operator-admin-token-form",
      "operator-admin-token-input",
      "operator-clear-admin-token",
      "operator-refresh",
      "operator-export-summary",
      "operator-export-incident-packet",
      "operator-export-status",
      "operator-export-contents",
      "operator-export-history",
      "operator-hard-alerts",
      "operator-cross-device-steps",
      "operator-handoff-summary",
      "operator-handoff-fields",
      "/api/security",
      "/api/device/setup",
    ],
    "operator HTML"
  );
  const legacyObservationTrace = buildVerificationFieldValuePropositions("match.observation_trace", {
    candidateCity: "深圳",
    companyCity: "上海",
    score: 88,
  });
  assert(
    legacyObservationTrace.some((entry) => entry?.predicate === "memory_focus_destination" && entry?.object === "深圳"),
    "旧版 observation_trace candidateCity 应兼容映射到 memory_focus_destination"
  );
  assert(
    legacyObservationTrace.some((entry) => entry?.predicate === "context_anchor_destination" && entry?.object === "上海"),
    "旧版 observation_trace companyCity 应兼容映射到 context_anchor_destination"
  );
  const legacyPredicateRecord = buildVerificationPropositionRecord({
    subject: "candidate",
    predicate: "candidate_prefers_destination",
    object: "深圳",
    rawText: "candidate 聚焦在深圳",
    discourseRefs: ["disc_candidate"],
  });
  assert(legacyPredicateRecord?.predicate === "memory_focus_destination", "旧版 predicate 应归一到 memory_focus_destination");
  assert(
    Array.isArray(legacyPredicateRecord?.discourseRefs) && legacyPredicateRecord.discourseRefs.includes("disc_memory"),
    "旧版 discourse ref 应归一到 disc_memory"
  );
  assert(repairHubHtml.includes('/ui-links.js'), "repair-hub.html 未加载共享 ui-links.js");
  assert(repairHubHtml.includes("open-main-context"), "repair-hub.html 缺少首页回跳入口");
  assert(repairHubHtml.includes("返回公开运行态"), "repair-hub.html 缺少返回公开运行态文案");
  assert(repairHubHtml.includes('id="repair-hub-auth-summary"'), "repair-hub.html 缺少鉴权摘要区");
  assert(repairHubHtml.includes('id="repair-hub-admin-token-form"'), "repair-hub.html 缺少 admin token 表单");
  assert(repairHubHtml.includes('id="repair-hub-admin-token-input"'), "repair-hub.html 缺少 admin token 输入框");
  assert(repairHubHtml.includes('id="repair-hub-clear-admin-token"'), "repair-hub.html 缺少清除 token 按钮");
  assert(labHtml.includes("runtime-security-boundaries-panel"), "lab.html 缺少安全与恢复边界面板");
  assert(labHtml.includes("runtime-security-boundaries-summary"), "lab.html 缺少安全与恢复边界摘要");
  assert(labHtml.includes("runtime-local-store-summary"), "lab.html 缺少本地存储加密摘要");
  assert(labHtml.includes("runtime-formal-recovery-summary"), "lab.html 缺少正式恢复摘要");
  assert(labHtml.includes("runtime-constrained-execution-summary"), "lab.html 缺少受限执行摘要");
  assert(labHtml.includes("runtime-automatic-recovery-summary"), "lab.html 缺少自动恢复边界摘要");
  assert(labHtml.includes("runtime-housekeeping-form"), "lab.html 缺少 runtime housekeeping 表单");
  assert(labHtml.includes("runtime-housekeeping-audit"), "lab.html 缺少 runtime housekeeping audit 按钮");
  assert(labHtml.includes("runtime-housekeeping-apply"), "lab.html 缺少 runtime housekeeping apply 按钮");
  assert(labHtml.includes('href="/operator"'), "lab.html 缺少 /operator 入口");
  assert(labHtml.includes('href="/offline-chat"'), "lab.html 离线线程入口应指向 /offline-chat");
  assert(labHtml.includes('href="/repair-hub"'), "lab.html 修复中枢入口应指向 /repair-hub");
  assert(offlineChatHtml.includes('id="stack-chip"'), "offline-chat.html 缺少 stack chip");
  assert(offlineChatHtml.includes('id="messages"'), "offline-chat.html 缺少消息列表");
  assert(offlineChatHtml.includes('id="composer"'), "offline-chat.html 缺少 composer");
  assert(offlineChatHtml.includes('id="thread-context-summary"'), "offline-chat.html 缺少线程真值摘要");
  assert(offlineChatHtml.includes('id="thread-context-list"'), "offline-chat.html 缺少线程真值成员列表");
  assert(offlineChatHtml.includes('id="source-filter-summary"'), "offline-chat.html 缺少来源筛选摘要");
  assert(offlineChatHtml.includes('id="source-filter-list"'), "offline-chat.html 缺少来源筛选列表");
  assert(offlineChatHtml.includes("message-source"), "offline-chat.html 缺少消息来源样式");
  assert(offlineChatHtml.includes('/offline-chat-app.js'), "offline-chat.html 未加载 offline-chat-app.js");
  assert(offlineChatAppJs.includes('params.get("threadId")'), "offline-chat-app.js 缺少 threadId URL 读取");
  assert(offlineChatAppJs.includes('params.get("sourceProvider")'), "offline-chat-app.js 缺少 sourceProvider URL 读取");
  assert(offlineChatAppJs.includes('syncUrlState({ historyMode: "push" })'), "offline-chat-app.js 缺少 URL pushState 同步");
  assert(offlineChatAppJs.includes('window.addEventListener("popstate"'), "offline-chat-app.js 缺少 popstate 恢复");
  assert(offlineChatAppJs.includes("function formatParticipantNames("), "offline-chat-app.js 缺少群聊成员格式化函数");
  assert(offlineChatAppJs.includes("function resolveGroupParticipants("), "offline-chat-app.js 缺少群聊成员真值解析函数");
  assert(
    offlineChatAppJs.includes("formatParticipantNames(participants)"),
    "offline-chat-app.js 群聊提示应来自运行时解析后的 participants"
  );
  assert(offlineChatAppJs.includes("function renderThreadContext()"), "offline-chat-app.js 缺少线程真值渲染函数");
  assert(offlineChatAppJs.includes('当前线程共有 ${memberCount} 位成员。'), "offline-chat-app.js 线程真值摘要应展示成员数");
  assert(offlineChatAppJs.includes('当前线程只包含 1 位成员。'), "offline-chat-app.js 单聊线程真值摘要应展示单成员事实");

  const readOnlyPosture = await configureSecurityPosture({
    mode: "read_only",
    reason: "smoke-dom posture probe",
    note: "verify read only posture",
  });
  assert(readOnlyPosture.securityPosture?.mode === "read_only", "configureSecurityPosture 应支持 read_only");
  const restoredPosture = await configureSecurityPosture({
    mode: "normal",
    reason: "smoke-dom posture reset",
    note: "restore normal posture",
  });
  assert(restoredPosture.securityPosture?.mode === "normal", "configureSecurityPosture 应恢复 normal");
  const currentPosture = await getCurrentSecurityPostureState();
  assert(currentPosture.mode === "normal", "当前 security posture 应为 normal");

  const revokeAllProbeSession = await createReadSession({
    label: "smoke-dom-revoke-all-probe",
    role: "runtime_observer",
    ttlSeconds: 300,
    note: "smoke-dom revoke all probe",
  });
  const revokeAllResult = await revokeAllReadSessions({
    note: "smoke-dom revoke all",
  });
  assert(Number(revokeAllResult.revokedCount || 0) >= 1, "revokeAllReadSessions 应至少撤销 1 个会话");
  const revokedValidation = await validateReadSessionToken(revokeAllProbeSession.token, {
    scope: "device_runtime",
  });
  assert(revokedValidation.valid === false, "revokeAllReadSessions 后 token 应失效");
  const securityAnomalies = await listSecurityAnomalies({ limit: 50 });
  assert(Array.isArray(securityAnomalies.anomalies), "security anomalies 缺少 anomalies 数组");
  assert(
    securityAnomalies.anomalies.some((entry) => entry.code === "security_posture_changed"),
    "security anomalies 应记录 security_posture_changed"
  );
  traceSmoke("security posture and read-session checks");

  const windows = await listWindows();
  assert(Array.isArray(windows), "ledger windows 列表不可用");
  const primaryWindow =
    windows.find((entry) => entry?.agentId === "agent_openneed_agents" && entry?.windowId) ||
    windows.find((entry) => entry?.windowId) ||
    null;
  assert(primaryWindow?.windowId, "当前账本没有可用 window 记录");
  const primaryWindowDetail = await getWindow(primaryWindow.windowId);
  assert(primaryWindowDetail.windowId === primaryWindow.windowId, "window 详情与 windowId 不匹配");
  const siblingWindow =
    windows.find((entry) => entry?.windowId && entry.windowId !== primaryWindow.windowId) ||
    primaryWindow;
  const rewrittenWindow =
    windows.find(
      (entry) => entry?.windowId && entry.windowId !== primaryWindow.windowId && entry.windowId !== siblingWindow.windowId
    ) || siblingWindow;

  const repairListOptions = {
    agentId: "agent_openneed_agents",
    didMethod: "agentpassport",
    limit: 5,
    sortBy: "repairedCount",
    sortOrder: "desc",
  };
  let repairs = await listMigrationRepairs(repairListOptions);
  let repair = repairs.repairs?.[0] || null;
  if (!repair?.repairId) {
    const seededRepair = await repairAgentComparisonMigration({
      leftAgentId: "agent_openneed_agents",
      rightAgentId: "agent_treasury",
      issuerAgentId: "agent_openneed_agents",
      didMethods: ["agentpassport", "openneed"],
      issueBothMethods: true,
    });
    assert(seededRepair?.repairId, "migration repair 自举失败");
    repairs = await listMigrationRepairs(repairListOptions);
    repair = repairs.repairs?.[0] || seededRepair;
  }
  assert(repair?.repairId, "当前账本没有可用 repair 记录");
  traceSmoke("window and repair snapshot checks");

  const repairId = repair.repairId;
  const repairDetail = await getMigrationRepair(repairId, { didMethod: "agentpassport" });
  assert(repairDetail.repair?.repairId === repairId, "repair 详情与 repairId 不匹配");

  const repairCredentials = await getMigrationRepairCredentials(repairId, {
    didMethod: "agentpassport",
    limit: 20,
    sortBy: "latestRepairAt",
    sortOrder: "desc",
  });
  assert(Array.isArray(repairCredentials.credentials), "repair credentials 缺少 credentials 数组");

  let selectedBundle = null;
  for (const candidate of repairCredentials.credentials) {
    const candidateId = candidate?.credentialRecordId || candidate?.credentialId || null;
    if (!candidateId) {
      continue;
    }
    const detail = await getCredential(candidateId);
    const siblingRecords = Array.isArray(detail?.siblings?.records) ? detail.siblings.records : [];
    if (siblingRecords.length > 1) {
      selectedBundle = {
        credential: candidate,
        detail,
      };
      break;
    }
    if (!selectedBundle) {
      selectedBundle = {
        credential: candidate,
        detail,
      };
    }
  }

  const credential = selectedBundle?.credential || null;
  const credentialId = credential?.credentialRecordId || credential?.credentialId || null;
  assert(credentialId, `repair ${repairId} 没有可用 credential`);

  const [credentialDetail, credentialTimeline, credentialStatus] = await Promise.all([
    Promise.resolve(selectedBundle?.detail || getCredential(credentialId)),
    getCredentialTimeline(credentialId),
    getCredentialStatus(credentialId),
  ]);

  assert(
    credentialDetail.credentialRecord?.credentialRecordId === credentialId ||
      credentialDetail.credentialRecord?.credentialId === credentialId,
    "credential 详情与 credentialId 不匹配"
  );
  assert(Array.isArray(credentialTimeline.timeline), "credential timeline 缺少 timeline 数组");
  assert(credentialStatus.statusProof || credentialStatus.statusListSummary, "credential status 缺少状态证明");
  assert(
    credentialDetail.credentialRecord?.repairedBy?.repairId === repairId ||
      credentialDetail.credentialRecord?.repairIds?.includes(repairId),
    "credential 详情没有正确挂回 repair 上下文"
  );

  const siblingRecords = Array.isArray(credentialDetail.siblings?.records) ? credentialDetail.siblings.records : [];
  const siblingRecord =
    siblingRecords.find((entry) => !entry?.isCurrent && (entry?.credentialRecordId || entry?.credentialId)) || null;
  assert(siblingRecord, `credential ${credentialId} 没有可用 sibling method 记录`);

  const siblingCredentialId = siblingRecord.credentialRecordId || siblingRecord.credentialId;
  const [siblingDetail, siblingTimeline, siblingStatus] = await Promise.all([
    getCredential(siblingCredentialId),
    getCredentialTimeline(siblingCredentialId),
    getCredentialStatus(siblingCredentialId),
  ]);

  assert(
    siblingDetail.credentialRecord?.subjectId === credentialDetail.credentialRecord?.subjectId,
    "sibling credential 的 subjectId 与当前 credential 不一致"
  );
  assert(
    siblingDetail.credentialRecord?.kind === credentialDetail.credentialRecord?.kind,
    "sibling credential 的 kind 与当前 credential 不一致"
  );
  assert(
    siblingDetail.credentialRecord?.issuerDidMethod &&
      siblingDetail.credentialRecord.issuerDidMethod !== credentialDetail.credentialRecord?.issuerDidMethod,
    "sibling credential 没有切换到不同 DID method"
  );
  assert(Array.isArray(siblingTimeline.timeline), "sibling credential timeline 缺少 timeline 数组");
  assert(siblingStatus.statusProof || siblingStatus.statusListSummary, "sibling credential 缺少状态证明");
  assert(
    siblingDetail.credentialRecord?.repairedBy?.repairId === repairId ||
      siblingDetail.credentialRecord?.repairIds?.includes(repairId),
    "sibling credential 没有正确挂回 repair 上下文"
  );

  const agentContext = await getAgentContext("agent_openneed_agents", { didMethod: "agentpassport" });
  const deviceRuntime = await getDeviceRuntimeState();
  const boundResidentAgentId = deviceRuntime.deviceRuntime?.residentAgentId || "agent_openneed_agents";
  assert(deviceRuntime.deviceRuntime?.machineId, "device runtime 缺少 machineId");
  assert(Array.isArray(deviceRuntime.deviceRuntime?.sandboxPolicy?.allowedCapabilities), "device runtime 缺少 sandbox allowedCapabilities");
  assert(deviceRuntime.deviceRuntime?.sandboxPolicy?.allowedCapabilities.includes("runtime_search"), "sandbox 默认应允许 runtime_search");
  assert(deviceRuntime.deviceRuntime?.sandboxPolicy?.maxReadBytes >= 256, "sandbox maxReadBytes 异常");
  assert(deviceRuntime.deviceRuntime?.sandboxPolicy?.maxListEntries >= 1, "sandbox maxListEntries 异常");
  assert(deviceRuntime.deviceRuntime?.sandboxPolicy?.requireAbsoluteProcessCommand === true, "sandbox 应默认要求绝对路径命令");
  assert(deviceRuntime.deviceRuntime?.sandboxPolicy?.maxProcessArgs >= 1, "sandbox maxProcessArgs 异常");
  assert(deviceRuntime.deviceRuntime?.sandboxPolicy?.maxProcessArgBytes >= 256, "sandbox maxProcessArgBytes 异常");
  assert(deviceRuntime.deviceRuntime?.sandboxPolicy?.maxUrlLength >= 128, "sandbox maxUrlLength 异常");
  const deviceRuntimePreview = await configureDeviceRuntime({
    residentAgentId: boundResidentAgentId,
    localMode: "local_only",
    allowOnlineReasoner: false,
    negotiationMode: "confirm_before_execute",
    lowRiskStrategy: "auto_execute",
    mediumRiskStrategy: "discuss",
    highRiskStrategy: "confirm",
    criticalRiskStrategy: "multisig",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
    filesystemAllowlist: [dataDir, "/tmp"],
    retrievalMaxHits: 6,
    requireRecoveryBundle: true,
    requireRecentRecoveryRehearsal: true,
    recoveryRehearsalMaxAgeHours: 168,
    requireSetupPackage: true,
    requireKeychainWhenAvailable: false,
    allowedCapabilities: ["runtime_search", "filesystem_list", "filesystem_read", "conversation_minute_write"],
    maxReadBytes: 4096,
    maxListEntries: 25,
    maxProcessArgs: 4,
    maxProcessArgBytes: 512,
    maxUrlLength: 512,
    requireAbsoluteProcessCommand: true,
    dryRun: true,
  });
  assert(deviceRuntimePreview.deviceRuntime?.residentAgentId === boundResidentAgentId, "device runtime dry-run 未返回 resident agent");
  assert(deviceRuntimePreview.deviceRuntime?.commandPolicy?.riskStrategies?.critical === "multisig", "critical 风险策略应为 multisig");
  assert(deviceRuntimePreview.deviceRuntime?.retrievalPolicy?.strategy === "local_first_non_vector", "检索策略应为 local_first_non_vector");
  assert(deviceRuntimePreview.deviceRuntime?.retrievalPolicy?.allowVectorIndex === false, "默认不应启用向量索引");
  assert(deviceRuntimePreview.deviceRuntime?.setupPolicy?.requireRecoveryBundle === true, "device runtime dry-run 没保住 requireRecoveryBundle");
  assert(deviceRuntimePreview.deviceRuntime?.setupPolicy?.requireRecentRecoveryRehearsal === true, "device runtime dry-run 没保住 requireRecentRecoveryRehearsal");
  assert(deviceRuntimePreview.deviceRuntime?.setupPolicy?.recoveryRehearsalMaxAgeHours === 168, "device runtime dry-run 没保住 recoveryRehearsalMaxAgeHours");
  assert(deviceRuntimePreview.deviceRuntime?.setupPolicy?.requireSetupPackage === true, "device runtime dry-run 没保住 requireSetupPackage");
  assert(deviceRuntimePreview.deviceRuntime?.setupPolicy?.requireKeychainWhenAvailable === false, "device runtime dry-run 没保住 requireKeychainWhenAvailable");
  assert(deviceRuntimePreview.deviceRuntime?.constrainedExecutionPolicy?.maxReadBytes === 4096, "device runtime dry-run 缺少 constrainedExecutionPolicy alias");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.allowedCapabilities?.includes("filesystem_list"), "device runtime dry-run 没保住 sandbox 能力");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxReadBytes === 4096, "device runtime dry-run 没保住 maxReadBytes");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxListEntries === 25, "device runtime dry-run 没保住 maxListEntries");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxProcessArgs === 4, "device runtime dry-run 没保住 maxProcessArgs");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxProcessArgBytes === 512, "device runtime dry-run 没保住 maxProcessArgBytes");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxUrlLength === 512, "device runtime dry-run 没保住 maxUrlLength");
  const configuredRuntime = await configureDeviceRuntime({
    residentAgentId: boundResidentAgentId,
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
  assert(configuredRuntime.deviceRuntime?.localReasoner?.configured === true, "runtime local reasoner 应配置完成");
  traceSmoke("device runtime configured");
  const readSession = await createReadSession({
    label: "smoke-dom-parent",
    role: "security_delegate",
    ttlSeconds: 600,
  });
  assert(readSession.session?.readSessionId, "read session 没返回 readSessionId");
  assert(readSession.session?.role === "security_delegate", "root read session 应返回 security_delegate 角色");
  assert(readSession.session?.canDelegate === true, "security_delegate 应允许继续派发子会话");
  assert(readSession.session?.viewTemplates?.deviceRuntime === "metadata_only", "security_delegate 应返回默认 deviceRuntime view template");
  const childReadSession = await createReadSession({
    label: "smoke-dom-device-runtime-child",
    parentReadSessionId: readSession.session.readSessionId,
    role: "runtime_observer",
    viewTemplates: {
      transcript: "summary_only",
      sandboxAudits: "summary_only",
    },
    ttlSeconds: 1200,
  });
  assert(childReadSession.session?.readSessionId, "child read session 没返回 readSessionId");
  assert(childReadSession.session?.parentReadSessionId === readSession.session.readSessionId, "child read session 应记录 parentReadSessionId");
  assert(childReadSession.session?.rootReadSessionId === readSession.session.readSessionId, "child read session 应继承 rootReadSessionId");
  assert(childReadSession.session?.lineageDepth === 1, "child read session lineageDepth 应为 1");
  assert(childReadSession.session?.role === "runtime_observer", "child read session 应返回 runtime_observer 角色");
  assert(childReadSession.session?.canDelegate === false, "runtime_observer 默认不应继续派发子会话");
  assert(childReadSession.session?.viewTemplates?.deviceRuntime === "summary_only", "runtime_observer child 应返回 summary_only deviceRuntime template");
  assert(childReadSession.session?.viewTemplates?.transcript === "summary_only", "runtime_observer child 应保留自定义 transcript template");
  const boundAgentReadSession = await createReadSession({
    label: "smoke-dom-agent-auditor-bound",
    role: "agent_auditor",
    agentIds: ["agent_openneed_agents"],
    ttlSeconds: 600,
  });
  assert(
    Array.isArray(boundAgentReadSession.session?.resourceBindings?.agentIds) &&
      boundAgentReadSession.session.resourceBindings.agentIds.includes("agent_openneed_agents"),
    "bound read session 应返回 agentIds 资源绑定"
  );
  let invalidChildRoleBlocked = false;
  try {
    await createReadSession({
      label: "smoke-dom-invalid-child",
      parentReadSessionId: readSession.session.readSessionId,
      role: "window_observer",
      ttlSeconds: 1200,
    });
  } catch (error) {
    invalidChildRoleBlocked = String(error?.message || "").includes("scope boundary");
  }
  assert(invalidChildRoleBlocked, "父 read session 不应允许派生超出 role 范围的 child session");
  const readSessionValidation = await validateReadSessionToken(childReadSession.token, { scope: "device_runtime" });
  assert(readSessionValidation.valid === true, "device_runtime scope 的 child read session 应通过校验");
  const readSessionRejected = await validateReadSessionToken(childReadSession.token, { scope: "windows" });
  assert(readSessionRejected.valid === false && readSessionRejected.reason === "scope_mismatch", "跨 scope 校验应失败");
  await revokeReadSession(readSession.session.readSessionId, { revokedByAgentId: "agent_openneed_agents" });
  const revokedReadSessionValidation = await validateReadSessionToken(childReadSession.token, { scope: "device_runtime" });
  assert(
    revokedReadSessionValidation.valid === false && revokedReadSessionValidation.reason === "ancestor_session_revoked",
    "父 read session 撤销后，child read session 应被祖先链一起失效"
  );
  const readSessions = await listReadSessions({ includeExpired: true, includeRevoked: true });
  assert(Array.isArray(readSessions.sessions), "listReadSessions 应返回 sessions 数组");
  assert(
    readSessions.sessions.some(
      (entry) =>
        entry.readSessionId === childReadSession.session.readSessionId &&
        entry.parentReadSessionId === readSession.session.readSessionId &&
        entry.revokedAt &&
        entry.revokedByAncestorReadSessionId === readSession.session.readSessionId &&
        entry.active === false
    ),
    "read session 列表应返回 child lineage 和失效状态"
  );
  const recoveryBundles = await listStoreRecoveryBundles({ limit: 5 });
  assert(Array.isArray(recoveryBundles.bundles), "recovery bundles 缺少 bundles 数组");
  const recoveryExport = await exportStoreRecoveryBundle({
    passphrase: "smoke-dom-recovery-passphrase",
    note: "smoke-dom dry-run recovery bundle",
    includeLedgerEnvelope: true,
    saveToFile: false,
    returnBundle: true,
    dryRun: true,
  });
  assert(recoveryExport.bundle?.format === "agent-passport-store-recovery-v1", "recovery export format 不正确");
  assert(recoveryExport.summary?.bundleId, "recovery export 缺少 bundleId");
  let recoveryOverwriteGuarded = false;
  try {
    await importStoreRecoveryBundle({
      passphrase: "smoke-dom-recovery-passphrase",
      bundle: recoveryExport.bundle,
      restoreLedger: true,
      dryRun: true,
    });
  } catch (error) {
    recoveryOverwriteGuarded = String(error?.message || "").includes("set overwrite=true");
  }
  assert(recoveryOverwriteGuarded, "recovery import dry-run 应拦住未显式 overwrite 的现有 key / ledger");
  const recoveryImport = await importStoreRecoveryBundle({
    passphrase: "smoke-dom-recovery-passphrase",
    bundle: recoveryExport.bundle,
    overwrite: true,
    restoreLedger: true,
    dryRun: true,
  });
  assert(recoveryImport.summary?.bundleId === recoveryExport.summary?.bundleId, "recovery import bundleId 不匹配");
  const keychainStatus = getSystemKeychainStatus();
  const expectedRecoveryTarget = shouldPreferSystemKeychain() && keychainStatus.available ? "keychain" : "file";
  assert(recoveryImport.storeKeyImportTarget === expectedRecoveryTarget, "recovery import 没走预期的 store key target");
  const recoveryRehearsal = await rehearseStoreRecoveryBundle({
    passphrase: "smoke-dom-recovery-passphrase",
    bundle: recoveryExport.bundle,
    dryRun: true,
    persist: false,
  });
  assert(recoveryRehearsal.rehearsal?.status, "recovery rehearsal 缺少 status");
  const recoveryRehearsalHistory = await listRecoveryRehearsals({ limit: 5 });
  assert(Array.isArray(recoveryRehearsalHistory.rehearsals), "recovery rehearsal history 缺少 rehearsals");
  const setupStatus = await getDeviceSetupStatus();
  assert(Array.isArray(setupStatus.checks), "device setup status 缺少 checks");
  assert(setupStatus.localReasonerDiagnostics?.provider === "local_command", "device setup status 应返回 localReasonerDiagnostics");
  assert(setupStatus.setupPolicy?.requireRecentRecoveryRehearsal === true, "device setup status 应返回 setupPolicy");
  assert(setupStatus.formalRecoveryFlow?.status, "device setup status 缺少 formalRecoveryFlow.status");
  assert(typeof setupStatus.formalRecoveryFlow?.durableRestoreReady === "boolean", "formalRecoveryFlow 应返回 durableRestoreReady");
  assert(setupStatus.formalRecoveryFlow?.runbook?.status, "formalRecoveryFlow 应返回 runbook.status");
  assert(setupStatus.setupPackages?.counts, "device setup status 缺少 setupPackages.counts");
  assert(
    Number.isFinite(Number(setupStatus.setupPackages?.counts?.total || 0)),
    "device setup status setupPackages.total 应为合法数字"
  );
  assert(
    Number(setupStatus.setupPackages?.counts?.total || 0) === Number(setupStatus.formalRecoveryFlow?.setupPackage?.total || 0),
    "device setup status setupPackages.total 应与 formalRecoveryFlow.setupPackage.total 一致"
  );
  assert(
    (setupStatus.setupPackages?.packages?.[0]?.packageId || null) ===
      (setupStatus.formalRecoveryFlow?.setupPackage?.latestPackage?.packageId || null),
    "device setup status latest setup package 应与 formalRecoveryFlow.setupPackage.latestPackage 一致"
  );
  assert(
    setupStatus.formalRecoveryFlow?.runbook?.nextStepCode || setupStatus.formalRecoveryFlow?.runbook?.status === "ready",
    "formalRecoveryFlow.runbook 应返回 nextStepCode 或 ready 状态"
  );
  assert(
    Array.isArray(setupStatus.formalRecoveryFlow?.runbook?.steps) &&
      setupStatus.formalRecoveryFlow.runbook.steps.length >= 4,
    "formalRecoveryFlow.runbook 应返回完整步骤"
  );
  assert(setupStatus.automaticRecoveryReadiness?.status, "device setup status 缺少 automaticRecoveryReadiness.status");
  assert(setupStatus.deviceRuntime?.constrainedExecutionSummary?.status, "device runtime 应返回 constrainedExecutionSummary.status");
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.brokerIsolationEnabled === true,
    "constrainedExecutionSummary 应报告 brokerIsolationEnabled=true"
  );
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.requested === true,
    "constrainedExecutionSummary 应报告 systemBrokerSandbox.requested=true"
  );
  if (setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.available === true) {
    assert(
      setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.enabled === true &&
        setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.status === "enforced",
      "constrainedExecutionSummary 应在可用平台上启用 systemBrokerSandbox"
    );
  } else {
    assert(
      setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.enabled === false &&
        setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.status === "unavailable",
      "constrainedExecutionSummary 应在不可用平台上诚实报告 systemBrokerSandbox unavailable"
    );
    assert(
      setupStatus.deviceRuntime?.constrainedExecutionSummary?.warnings?.includes("system_broker_sandbox_unavailable"),
      "constrainedExecutionSummary 应记录 system_broker_sandbox_unavailable"
    );
    assert(
      setupStatus.deviceRuntime?.constrainedExecutionSummary?.brokerRuntime?.systemSandboxMode === "requested_but_unavailable",
      "constrainedExecutionSummary 应报告 requested_but_unavailable"
    );
  }
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.brokerRuntime?.brokerEnvMode === "empty",
    "constrainedExecutionSummary 应报告空 broker 环境"
  );
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.workerRuntime?.workerEnvMode === "empty",
    "constrainedExecutionSummary 应报告空 worker 环境"
  );
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.workerRuntime?.processWorkspaceMode,
    "constrainedExecutionSummary 应报告进程工作区隔离模式"
  );
  assert(
    setupStatus.checks.some((entry) => entry.code === "recovery_rehearsal_recent" && entry.required === true),
    "device setup status 应把 recovery_rehearsal_recent 作为 required check"
  );
  const setupRun = await runDeviceSetup({
    residentAgentId: boundResidentAgentId,
    residentDidMethod: "agentpassport",
    recoveryPassphrase: "smoke-dom-recovery-passphrase",
    dryRun: true,
  });
  assert(setupRun.bootstrap?.bootstrap?.dryRun === true, "device setup dryRun 应透传到 bootstrap");
  assert(setupRun.status?.deviceRuntime?.localReasoner?.provider === "local_command", "device setup 应保留 local_command");
  const setupPackagePreview = await exportDeviceSetupPackage({
    dryRun: true,
    saveToFile: false,
    returnPackage: true,
  });
  assert(setupPackagePreview.package?.format === "agent-passport-device-setup-v1", "device setup package preview format 不正确");
  assert(setupPackagePreview.package?.runtimeConfig?.residentAgentId === boundResidentAgentId, "device setup package preview 缺少 residentAgentId");
  const setupPackageImport = await importDeviceSetupPackage({
    package: setupPackagePreview.package,
    allowResidentRebind: true,
    dryRun: true,
  });
  assert(setupPackageImport.summary?.packageId === setupPackagePreview.summary?.packageId, "device setup package import summary.packageId 不匹配");
  assert(setupPackageImport.runtime?.deviceRuntime?.residentAgentId === boundResidentAgentId, "device setup package import 应恢复 residentAgentId");
  const localReasonerStatus = await inspectDeviceLocalReasoner();
  assert(localReasonerStatus.diagnostics?.provider === "local_command", "local reasoner diagnostics provider 不正确");
  assert(localReasonerStatus.diagnostics?.configured === true, "local reasoner diagnostics 应判定 configured");
  const localReasonerCatalog = await getDeviceLocalReasonerCatalog();
  assert(Array.isArray(localReasonerCatalog.providers), "local reasoner catalog 缺少 providers");
  assert(localReasonerCatalog.providers.some((entry) => entry.provider === "local_command"), "local reasoner catalog 缺少 local_command");
  const localReasonerProbe = await probeDeviceLocalReasoner({
    provider: "local_command",
    command: process.execPath,
    args: [localReasonerFixturePath],
    cwd: rootDir,
  });
  assert(localReasonerProbe.diagnostics?.provider === "local_command", "local reasoner probe provider 不正确");
  assert(localReasonerProbe.diagnostics?.reachable === true, "local reasoner probe 应判定 reachable");
  const localReasonerSelect = await selectDeviceLocalReasoner({
    provider: "local_command",
    enabled: true,
    command: process.execPath,
    args: [localReasonerFixturePath],
    cwd: rootDir,
    dryRun: false,
  });
  assert(localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.provider === "local_command", "local reasoner select 应保留 provider");
  assert(localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.selection?.selectedAt, "local reasoner select 应写入 selection.selectedAt");
  const localReasonerPrewarm = await prewarmDeviceLocalReasoner({
    dryRun: false,
  });
  assert(localReasonerPrewarm.warmState?.status === "ready", "local reasoner prewarm 应返回 ready");
  assert(localReasonerPrewarm.deviceRuntime?.localReasoner?.lastWarm?.status === "ready", "runtime local reasoner 应记录 lastWarm.status");
  const sharedMemoryRecallIntent = detectSharedMemoryIntent("你还记得我最终目标是什么吗？");
  const bareMemoryIntent = detectSharedMemoryIntent("这个记忆层同步方案怎么设计？");
  assert(sharedMemoryRecallIntent?.primaryKey === "kane_ultimate_goal", "共享记忆 recall intent 应命中 kane_ultimate_goal");
  assert(bareMemoryIntent === null, "裸词“记忆”不应直接命中共享记忆 fast path");
  const offlineChatBootstrap = await getOfflineChatBootstrapPayload();
  assert(Array.isArray(offlineChatBootstrap.personas) && offlineChatBootstrap.personas.length >= 1, "offline chat bootstrap 应返回 persona 列表");
  assert(offlineChatBootstrap.groupHub?.agent?.agentId, "offline chat bootstrap 应返回 group hub");
  const offlineGroupThread = Array.isArray(offlineChatBootstrap.threads)
    ? offlineChatBootstrap.threads.find((entry) => entry.threadId === "group")
    : null;
  assert(offlineGroupThread?.threadKind === "group", "offline chat bootstrap 应返回 group 线程摘要");
  assert(
    Number(offlineGroupThread?.memberCount || 0) === offlineChatBootstrap.personas.length,
    "offline group thread memberCount 应与 persona 数量一致"
  );
  assert(
    Array.isArray(offlineGroupThread?.participants) &&
      offlineGroupThread.participants.length === offlineChatBootstrap.personas.length,
    "offline group thread participants 应与 persona 数量一致"
  );
  const offlineGroupParticipantNames = offlineGroupThread.participants
    .map((entry) => String(entry?.displayName || "").trim())
    .filter(Boolean);
  assert(
    offlineGroupParticipantNames.length === offlineChatBootstrap.personas.length,
    "offline group thread participants 应全部带 displayName"
  );
  assert(
    offlineChatBootstrap.personas.every((persona) =>
      offlineGroupParticipantNames.includes(String(persona?.displayName || "").trim())
    ),
    "offline group thread participants 应与 runtime persona 名单一致"
  );
  const offlineThreadStartupPhase1 = offlineChatBootstrap.threadStartup?.phase_1 || null;
  assert(offlineThreadStartupPhase1?.ok === true, "offline chat bootstrap 应返回 phase_1 thread startup context");
  assert(offlineThreadStartupPhase1?.phaseKey === "phase_1", "offline chat phase_1 thread startup context 应返回正确 phaseKey");
  assert(
    String(offlineThreadStartupPhase1?.title || "").includes("agent-passport"),
    "offline chat phase_1 title 应使用 agent-passport 公开名"
  );
  assert(offlineThreadStartupPhase1?.threadId === "group", "offline chat phase_1 应绑定 group 线程");
  assert(offlineThreadStartupPhase1?.groupThread?.threadId === "group", "offline chat phase_1 groupThread 应返回 group");
  assert(
    Number(offlineThreadStartupPhase1?.groupThread?.memberCount || 0) === offlineChatBootstrap.personas.length,
    "offline chat phase_1 groupThread.memberCount 应与 persona 数量一致"
  );
  assert(
    Array.isArray(offlineThreadStartupPhase1?.coreParticipants) &&
      offlineThreadStartupPhase1.coreParticipants.length === Number(offlineThreadStartupPhase1?.coreParticipantCount || 0),
    "offline chat phase_1 coreParticipants 应与计数一致"
  );
  assert(
    Array.isArray(offlineThreadStartupPhase1?.supportParticipants) &&
      offlineThreadStartupPhase1.supportParticipants.length === Number(offlineThreadStartupPhase1?.supportParticipantCount || 0),
    "offline chat phase_1 supportParticipants 应与计数一致"
  );
  assert(
    Number(offlineThreadStartupPhase1?.coreParticipantCount || 0) +
      Number(offlineThreadStartupPhase1?.supportParticipantCount || 0) ===
      offlineChatBootstrap.personas.length,
    "offline chat phase_1 参与人数应与 persona 总数一致"
  );
  assert(
    offlineThreadStartupPhase1.coreParticipants.some((entry) => entry?.role === "master-orchestrator-agent"),
    "offline chat phase_1 coreParticipants 应包含主控 Agent"
  );
  assert(
    Array.isArray(offlineThreadStartupPhase1?.recommendedSequence) && offlineThreadStartupPhase1.recommendedSequence.length >= 1,
    "offline chat phase_1 应返回推荐协作顺序"
  );
  assert(
    Array.isArray(offlineThreadStartupPhase1?.rules) && offlineThreadStartupPhase1.rules.length >= 1,
    "offline chat phase_1 应返回协作规则"
  );
  assert(
    String(offlineThreadStartupPhase1?.intent || "").includes(
      `${offlineThreadStartupPhase1?.coreParticipantCount || 0} 个工作角色`
    ),
    "offline chat phase_1 intent 应跟随当前核心角色数量"
  );
  assert(
    String(offlineThreadStartupPhase1?.intent || "").includes(
      `${offlineThreadStartupPhase1?.supportParticipantCount || 0} 个支持角色`
    ),
    "offline chat phase_1 intent 应跟随当前支持角色数量"
  );
  const offlineDirectPersona = offlineChatBootstrap.personas[0];
  const offlineDirectProbe = `你还记得我最终目标是什么吗？ smoke-offline-direct-${Date.now()}`;
  const offlineDirectMinutesBefore = await listConversationMinutes(offlineDirectPersona.agent.agentId, { limit: 20 });
  const offlineDirectResult = await sendOfflineChatDirectMessage(offlineDirectPersona.agent.agentId, offlineDirectProbe);
  assert(offlineDirectResult.reasoning?.provider === "passport_fast_memory", "offline direct recall 应命中 passport_fast_memory");
  assert(
    Array.isArray(offlineDirectResult.reasoning?.metadata?.memoryKeys) &&
      offlineDirectResult.reasoning.metadata.memoryKeys.includes("kane_ultimate_goal"),
    "offline direct recall 应返回 kane_ultimate_goal memory key"
  );
  const offlineDirectMinutesAfter = await listConversationMinutes(offlineDirectPersona.agent.agentId, { limit: 20 });
  assert(
    (offlineDirectMinutesAfter.counts?.total || offlineDirectMinutesAfter.minutes.length || 0) ===
      (offlineDirectMinutesBefore.counts?.total || offlineDirectMinutesBefore.minutes.length || 0) + 1,
    "offline direct fast path 应补写一条轻量 conversation minute"
  );
  const offlineDirectFastMinute =
    offlineDirectMinutesAfter.minutes.find((minute) => minuteContainsToken(minute, offlineDirectProbe)) || null;
  assert(offlineDirectFastMinute?.title?.includes("共享记忆快答"), "offline direct fast minute 应写入共享记忆快答标题");
  assert(
    Array.isArray(offlineDirectFastMinute?.tags) && offlineDirectFastMinute.tags.includes("shared-memory-fast-path"),
    "offline direct fast minute 应带 shared-memory-fast-path 标签"
  );
  const offlineNonFastProbe = `最近这周你们推进得怎么样？ smoke-offline-nonfast-${Date.now()}`;
  const offlineNonFastResult = await sendOfflineChatDirectMessage(offlineDirectPersona.agent.agentId, offlineNonFastProbe);
  assert(offlineNonFastResult.reasoning?.provider !== "passport_fast_memory", "offline non-fast prompt 不应误走共享记忆 fast path");
  assert(
    offlineNonFastResult.runner?.reasoner?.provider === "local_command",
    "offline non-fast prompt 应跟随 active runtime 的 local_command provider"
  );
  const offlineFastHistory = await getOfflineChatHistory(offlineDirectPersona.agent.agentId, {
    limit: 20,
    sourceProvider: "passport_fast_memory",
  });
  assert(offlineFastHistory.sourceFilter === "passport_fast_memory", "offline fast history 应返回 sourceFilter");
  assert(
    offlineFastHistory.sourceSummary?.providers?.some((entry) => entry.provider === "passport_fast_memory" && entry.count >= 1),
    "offline fast history source summary 应包含 passport_fast_memory"
  );
  assert(
    offlineFastHistory.messages.some((entry) => entry.role === "assistant" && entry.source?.provider === "passport_fast_memory"),
    "offline fast history 应至少返回一条 passport_fast_memory assistant message"
  );
  assert(
    offlineFastHistory.messages.every((entry) => entry.role !== "assistant" || entry.source?.provider === "passport_fast_memory"),
    "offline fast history assistant messages 应全部命中过滤来源"
  );
  const offlineCommandHistory = await getOfflineChatHistory(offlineDirectPersona.agent.agentId, {
    limit: 20,
    sourceProvider: "local_command",
  });
  assert(offlineCommandHistory.sourceFilter === "local_command", "offline command history 应返回 sourceFilter");
  assert(
    offlineCommandHistory.sourceSummary?.providers?.some((entry) => entry.provider === "local_command" && entry.count >= 1),
    "offline command history source summary 应包含 local_command"
  );
  assert(
    offlineCommandHistory.messages.some((entry) => entry.role === "assistant" && entry.source?.provider === "local_command"),
    "offline command history 应至少返回一条 local_command assistant message"
  );
  assert(
    offlineCommandHistory.messages.every((entry) => entry.role !== "assistant" || entry.source?.provider === "local_command"),
    "offline command history assistant messages 应全部命中过滤来源"
  );
  const offlineGroupProbe = `你们还记得我说过意识上传那件事吗？ smoke-offline-group-${Date.now()}`;
  const offlineGroupMinutesBefore = await listConversationMinutes(offlineChatBootstrap.groupHub.agent.agentId, { limit: 20 });
  const offlineGroupResult = await sendOfflineChatGroupMessage(offlineGroupProbe);
  assert(
    Array.isArray(offlineGroupResult.responses) &&
      offlineGroupResult.responses.length === offlineChatBootstrap.personas.length,
    "offline group recall 应返回与 persona 数量一致的 responses"
  );
  const offlineGroupMinutesAfter = await listConversationMinutes(offlineChatBootstrap.groupHub.agent.agentId, { limit: 20 });
  assert(
    (offlineGroupMinutesAfter.counts?.total || offlineGroupMinutesAfter.minutes.length || 0) ===
      (offlineGroupMinutesBefore.counts?.total || offlineGroupMinutesBefore.minutes.length || 0) + 1,
    "offline group fast path 应补写一条群聊轻量 conversation minute"
  );
  const offlineGroupFastMinute =
    offlineGroupMinutesAfter.minutes.find((minute) => minuteContainsToken(minute, offlineGroupProbe)) || null;
  assert(offlineGroupFastMinute?.title?.includes("离线群聊共享记忆快答"), "offline group fast minute 应写入群聊共享记忆标题");
  assert(
    Array.isArray(offlineGroupFastMinute?.tags) && offlineGroupFastMinute.tags.includes("group-shared-memory-recall"),
    "offline group fast minute 应带 group-shared-memory-recall 标签"
  );
  traceSmoke("offline chat checks");
  if (smokeCombined) {
    traceSmoke("combined mode early exit after local runtime checks");
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "combined",
          recoveryBundleCount: recoveryBundles.counts?.total || recoveryBundles.bundles.length || 0,
          recoveryRehearsalStatus: recoveryRehearsal.rehearsal?.status || null,
          recoveryRehearsalCount: recoveryRehearsalHistory.counts?.total || recoveryRehearsalHistory.rehearsals.length || 0,
          deviceSetupComplete: setupStatus.setupComplete || false,
          deviceSetupRunComplete: setupRun.status?.setupComplete || false,
          setupPackageId: setupPackagePreview.summary?.packageId || null,
          localReasonerStatus: localReasonerStatus.diagnostics?.status || null,
          localReasonerCatalogProviderCount: localReasonerCatalog.providers.length || 0,
          localReasonerProbeStatus: localReasonerProbe.diagnostics?.status || null,
          localReasonerSelectedProvider: localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.provider || null,
          localReasonerPrewarmStatus: localReasonerPrewarm.warmState?.status || null,
          offlineChatPersonaCount: offlineChatBootstrap.personas.length || 0,
          offlineChatDirectProvider: offlineDirectResult.reasoning?.provider || null,
          offlineChatDirectMinuteTitle: offlineDirectFastMinute?.title || null,
          offlineChatNonFastProvider: offlineNonFastResult.runner?.reasoner?.provider || offlineNonFastResult.reasoning?.provider || null,
          offlineChatGroupResponses: offlineGroupResult.responses?.length || 0,
          offlineChatGroupMinuteTitle: offlineGroupFastMinute?.title || null,
          combinedChecks: ["html_contract", "security_posture", "read_sessions", "recovery", "device_setup", "local_reasoner", "offline_chat"],
        },
        null,
        2
      )
    );
    return;
  }
  let localReasonerProfileId = null;
  let localReasonerProfiles = { counts: { total: 0 }, profiles: [] };
  let localReasonerRestoreCandidates = { counts: { total: 0 }, restoreCandidates: [] };
  let localReasonerRestore = { restoredProfileId: null, prewarmResult: { warmState: { status: null } } };
  let setupPackageList = await listDeviceSetupPackages({ limit: 5 });
  let savedSetupPackageId = null;
  let savedSetupPackageDetail = { summary: { localReasonerProfileCount: 0 } };
  let setupPackagePrune = { counts: { deleted: 0, matched: 0, kept: 0 } };
  let housekeepingApply = {
    mode: null,
    readSessions: { revokedCount: 0, activeAfter: null },
    recoveryBundles: { deletedCount: 0 },
    setupPackages: { counts: { deleted: 0 } },
  };

  if (!smokeCombined) {
    const localReasonerProfileSave = await saveDeviceLocalReasonerProfile({
      label: "smoke-dom-local-command",
      note: `smoke-dom-local-profile-${Date.now()}`,
      source: "current",
      dryRun: false,
      updatedByAgentId: "agent_openneed_agents",
      updatedByWindowId: "window_demo_1",
      sourceWindowId: "window_demo_1",
    });
    localReasonerProfileId = localReasonerProfileSave.summary?.profileId || localReasonerProfileSave.profile?.profileId || null;
    assert(localReasonerProfileId, "local reasoner profile save 应返回 profileId");
    localReasonerProfiles = await listDeviceLocalReasonerProfiles({ limit: 20 });
    assert(Array.isArray(localReasonerProfiles.profiles), "local reasoner profiles 列表缺少 profiles 数组");
    assert(
      localReasonerProfiles.profiles.some((entry) => entry.profileId === localReasonerProfileId),
      "local reasoner profiles 列表应包含新 profile"
    );
    const localReasonerProfileDetail = await getDeviceLocalReasonerProfile(localReasonerProfileId);
    assert(
      localReasonerProfileDetail.summary?.profileId === localReasonerProfileId,
      "local reasoner profile detail profileId 不匹配"
    );
    assert(
      localReasonerProfileDetail.profile?.config?.provider === "local_command",
      "local reasoner profile detail 应保留 local_command provider"
    );
    const localReasonerProfileActivate = await activateDeviceLocalReasonerProfile(localReasonerProfileId, {
      dryRun: false,
      updatedByAgentId: "agent_openneed_agents",
      updatedByWindowId: "window_demo_1",
      sourceWindowId: "window_demo_1",
    });
    assert(
      localReasonerProfileActivate.runtime?.deviceRuntime?.localReasoner?.provider === "local_command",
      "local reasoner profile activate 后 provider 应保持 local_command"
    );
    localReasonerRestoreCandidates = await listDeviceLocalReasonerRestoreCandidates({ limit: 10 });
    assert(Array.isArray(localReasonerRestoreCandidates.restoreCandidates), "local reasoner restore candidates 缺少 restoreCandidates 数组");
    assert(
      localReasonerRestoreCandidates.restoreCandidates.some((entry) => entry.profileId === localReasonerProfileId),
      "restore candidates 应包含新 profile"
    );
    const recommendedRestoreCandidate =
      localReasonerRestoreCandidates.restoreCandidates.find((entry) => entry.recommended) ||
      localReasonerRestoreCandidates.restoreCandidates[0] ||
      null;
    assert(recommendedRestoreCandidate, "restore candidates 应至少返回一个推荐候选");
    localReasonerRestore = await restoreDeviceLocalReasoner({
      profileId: localReasonerProfileId,
      prewarm: true,
      dryRun: false,
      updatedByAgentId: "agent_openneed_agents",
      updatedByWindowId: "window_demo_1",
      sourceWindowId: "window_demo_1",
    });
    assert(localReasonerRestore.restoredProfileId === localReasonerProfileId, "local reasoner restore 应返回正确 profileId");
    assert(
      localReasonerRestore.prewarmResult?.warmState?.status === "ready",
      "local reasoner restore 后应完成 prewarm"
    );
    traceSmoke("local reasoner catalog/profile/restore checks");
    assert(Array.isArray(setupPackageList.packages), "device setup package list 缺少 packages 数组");
    const packageNotePrefix = `smoke-dom-package-${Date.now()}`;
    const savedSetupPackage = await exportDeviceSetupPackage({
      note: `${packageNotePrefix}-old`,
      saveToFile: true,
      dryRun: false,
      returnPackage: true,
    });
    savedSetupPackageId = savedSetupPackage.summary?.packageId || null;
    assert(savedSetupPackageId, "saved setup package export 应返回 packageId");
    const savedSetupPackageList = await listDeviceSetupPackages({ limit: 10 });
    assert(savedSetupPackageList.packages.some((entry) => entry.packageId === savedSetupPackageId), "saved setup package list 应包含新 package");
    savedSetupPackageDetail = await getDeviceSetupPackage(savedSetupPackageId);
    assert(savedSetupPackageDetail.summary?.packageId === savedSetupPackageId, "saved setup package detail packageId 不匹配");
    assert(
      Number(savedSetupPackageDetail.summary?.localReasonerProfileCount || 0) >= 1,
      "saved setup package 应携带 local reasoner profile 摘要"
    );
    assert(
      Array.isArray(savedSetupPackageDetail.package?.localReasonerProfiles) &&
        savedSetupPackageDetail.package.localReasonerProfiles.some((entry) => entry.profileId === localReasonerProfileId),
      "saved setup package detail 应包含刚保存的 local reasoner profile"
    );
    const setupPackagePreviewWithProfiles = await exportDeviceSetupPackage({
      note: "smoke-dom-inline-profile-preview",
      saveToFile: false,
      dryRun: true,
      returnPackage: true,
      includeLocalReasonerProfiles: true,
    });
    assert(
      Array.isArray(setupPackagePreviewWithProfiles.package?.localReasonerProfiles) &&
        setupPackagePreviewWithProfiles.package.localReasonerProfiles.some((entry) => entry.profileId === localReasonerProfileId),
      "device setup package preview 应包含 local reasoner profiles"
    );
    const setupPackageImportWithProfiles = await importDeviceSetupPackage({
      package: setupPackagePreviewWithProfiles.package,
      allowResidentRebind: true,
      importLocalReasonerProfiles: true,
      dryRun: true,
    });
    assert(
      setupPackageImportWithProfiles.localReasonerProfiles?.totalProfiles >= 1,
      "device setup package import 应统计 local reasoner profiles"
    );
    const secondSavedSetupPackage = await exportDeviceSetupPackage({
      note: `${packageNotePrefix}-new`,
      saveToFile: true,
      dryRun: false,
      returnPackage: true,
    });
    assert(secondSavedSetupPackage.summary?.packageId, "second saved setup package export 应返回 packageId");
    setupPackagePrune = await pruneDeviceSetupPackages({
      keepLatest: 1,
      residentAgentId: boundResidentAgentId,
      noteIncludes: packageNotePrefix,
      dryRun: false,
    });
    assert(setupPackagePrune.counts?.matched === 2, "setup package prune 应精确命中 2 个 smoke packages");
    assert(setupPackagePrune.counts?.deleted >= 1, "setup package prune 应删除至少 1 个 package");
    assert(setupPackagePrune.counts?.kept === 1, "setup package prune 应只保留 1 个 package");
    const setupPackageListAfterDelete = await listDeviceSetupPackages({ limit: 20 });
    const prunedMatches = setupPackageListAfterDelete.packages.filter((entry) => String(entry.note || "").includes(packageNotePrefix));
    assert(
      prunedMatches.length === 1,
      "setup package prune 之后应只剩 1 个匹配 package"
    );
    const savedSetupPackageDelete = await deleteDeviceSetupPackage(prunedMatches[0].packageId, { dryRun: false });
    assert(savedSetupPackageDelete.summary?.packageId === prunedMatches[0].packageId, "saved setup package delete summary.packageId 不匹配");
    traceSmoke("device setup package lifecycle checks");
    const localReasonerProfileDelete = await deleteDeviceLocalReasonerProfile(localReasonerProfileId, {
      dryRun: false,
    });
    assert(
      localReasonerProfileDelete.summary?.profileId === localReasonerProfileId,
      "local reasoner profile delete summary.profileId 不匹配"
    );
    const localReasonerProfilesAfterDelete = await listDeviceLocalReasonerProfiles({ limit: 20 });
    assert(
      !localReasonerProfilesAfterDelete.profiles.some((entry) => entry.profileId === localReasonerProfileId),
      "local reasoner profile delete 后不应再出现在列表里"
    );
    const housekeepingProbeSession = await createReadSession({
      label: "smoke-dom-housekeeping-probe",
      role: "runtime_observer",
      ttlSeconds: 600,
    });
    const savedRecoveryBundle = await exportStoreRecoveryBundle({
      passphrase: "smoke-dom-housekeeping-passphrase",
      note: "smoke-dom-housekeeping-bundle",
      includeLedgerEnvelope: true,
      saveToFile: true,
      returnBundle: false,
      dryRun: false,
    });
    const savedHousekeepingPackage = await exportDeviceSetupPackage({
      note: "smoke-dom-housekeeping-package",
      saveToFile: true,
      dryRun: false,
      returnPackage: true,
    });
    assert(savedRecoveryBundle.summary?.bundleId, "housekeeping recovery bundle 应返回 bundleId");
    assert(savedHousekeepingPackage.summary?.packageId, "housekeeping setup package 应返回 packageId");
    housekeepingApply = await runRuntimeHousekeeping({
      apply: true,
      keepRecovery: 0,
      keepSetup: 0,
    });
    assert(housekeepingApply.ok === true, "housekeeping apply 应返回 ok=true");
    assert(housekeepingApply.mode === "apply", "housekeeping apply 模式应为 apply");
    assert(housekeepingApply.liveLedger?.touched === false, "housekeeping apply 不应修改 live ledger");
    assert(Number(housekeepingApply.readSessions?.revokedCount || 0) >= 1, "housekeeping apply 应撤销至少 1 个 read session");
    assert(housekeepingApply.readSessions?.activeAfter === 0, "housekeeping apply 后 active read sessions 应归零");
    assert(Number(housekeepingApply.recoveryBundles?.deletedCount || 0) >= 1, "housekeeping apply 应删除至少 1 个 recovery bundle");
    assert(Number(housekeepingApply.setupPackages?.counts?.deleted || 0) >= 1, "housekeeping apply 应删除至少 1 个 setup package");
    const housekeepingProbeValidation = await validateReadSessionToken(housekeepingProbeSession.token, {
      scope: "device_runtime",
    });
    assert(housekeepingProbeValidation.valid === false, "housekeeping apply 后 probe read session 应失效");
    const recoveryBundlesAfterHousekeeping = await listStoreRecoveryBundles({ limit: 10 });
    const setupPackagesAfterHousekeeping = await listDeviceSetupPackages({ limit: 10 });
    assert(
      !recoveryBundlesAfterHousekeeping.bundles.some((entry) => entry.bundleId === savedRecoveryBundle.summary?.bundleId),
      "housekeeping apply 后不应保留 probe recovery bundle"
    );
    assert(
      !setupPackagesAfterHousekeeping.packages.some((entry) => entry.packageId === savedHousekeepingPackage.summary?.packageId),
      "housekeeping apply 后不应保留 probe setup package"
    );
  } else {
    traceSmoke("combined mode skips local reasoner profile/setup lifecycle");
  }
  const ollamaRuntimePreview = await configureDeviceRuntime({
    residentAgentId: boundResidentAgentId,
    residentDidMethod: "agentpassport",
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "ollama_local",
    localReasonerBaseUrl: "http://127.0.0.1:11434",
    localReasonerModel: "qwen2.5:7b",
    dryRun: true,
  });
  assert(ollamaRuntimePreview.deviceRuntime?.localReasoner?.provider === "ollama_local", "ollama_local runtime dry-run 应保留 provider");
  assert(ollamaRuntimePreview.deviceRuntime?.localReasoner?.configured === true, "ollama_local runtime dry-run 应判定 configured");
  const passportMemories = await listPassportMemories("agent_openneed_agents", { limit: 12 });
  assert(Array.isArray(passportMemories.memories), "passport memories 不可用");
  const runtime = await getAgentRuntime("agent_openneed_agents", { didMethod: "agentpassport" });
  assert(runtime.cognitiveState?.mode, "runtime 应暴露 cognitiveState.mode");
  assert(typeof runtime.cognitiveState?.sleepPressure === "number", "runtime 应暴露 cognitiveState.sleepPressure");
  assert(typeof runtime.cognitiveState?.interoceptiveState?.bodyBudget === "number", "runtime 应暴露 cognitive interoceptiveState");
  assert(typeof runtime.cognitiveState?.replayOrchestration?.replayMode === "string", "runtime 应暴露 cognitive replayOrchestration");
  const rehydrate = await getAgentRehydratePack("agent_openneed_agents", { didMethod: "agentpassport" });
  const bootstrap = await bootstrapAgentRuntime(
    "agent_openneed_agents",
    {
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "让 agent-passport 建立在 OpenNeed 记忆稳态引擎之上",
      currentGoal: "预览 bootstrap 是否能建立最小冷启动包",
      currentPlan: ["写 profile", "写 snapshot", "验证 runner"],
      nextAction: "执行 verification run",
      maxRecentConversationTurns: 5,
      maxToolResults: 4,
      maxQueryIterations: 3,
      dryRun: true,
    },
    { didMethod: "agentpassport" }
  );
  assert(bootstrap.bootstrap?.dryRun === true, "bootstrap dryRun 应为 true");
  assert(bootstrap.contextBuilder?.slots?.identitySnapshot?.agentId === "agent_openneed_agents", "bootstrap 没保住 identity snapshot");
  const contextBuilder = await buildAgentContextBundle(
    "agent_openneed_agents",
    {
      currentGoal: "验证 context builder 与 verifier 是否可用",
      query: "identity snapshot verifier",
      recentConversationTurns: [
        { role: "user", content: "不要再从整段聊天历史里猜身份" },
        { role: "assistant", content: "应当按槽位重建上下文" },
      ],
      toolResults: [
        { tool: "runtime", result: "rehydrate ok" },
      ],
    },
    { didMethod: "agentpassport" }
  );
  assert(contextBuilder.slots?.identitySnapshot?.agentId === "agent_openneed_agents", "context builder 没保住 agentId");
  assert(Array.isArray(contextBuilder.slots?.relevantEpisodicMemories), "context builder 缺少 episodic memories");
  assert(Array.isArray(contextBuilder.localKnowledge?.hits), "context builder 缺少 localKnowledge hits");
  assert(contextBuilder.slots?.queryBudget?.maxContextTokens >= 256, "context builder 缺少 token budget");
  assert(contextBuilder.slots?.queryBudget?.estimatedContextTokens >= 1, "context builder 没返回 estimatedContextTokens");
  const transcript = await listAgentTranscript("agent_openneed_agents", { family: "runtime", limit: 12 });
  assert(Array.isArray(transcript.entries), "transcript 缺少 entries 数组");
  assert(Array.isArray(transcript.transcript?.messageBlocks), "transcript 应返回 messageBlocks");
  assert((transcript.transcript?.entryCount || 0) >= transcript.entries.length, "transcript.entryCount 不应小于 entries.length");
  const conversationMinutes = await listConversationMinutes("agent_openneed_agents", { limit: 8 });
  assert(Array.isArray(conversationMinutes.minutes), "conversation minutes 缺少 minutes 数组");
  const runtimeSearchQuery =
    conversationMinutes.minutes?.[0]?.title ||
    conversationMinutes.minutes?.[0]?.summary ||
    "memory engine rehydrate verification";
  const runtimeSearch = await searchAgentRuntimeKnowledge("agent_openneed_agents", {
    didMethod: "agentpassport",
    query: runtimeSearchQuery,
    limit: 6,
    sourceType: conversationMinutes.minutes?.length ? "conversation_minute" : null,
  });
  assert(Array.isArray(runtimeSearch.hits), "runtime search 缺少 hits 数组");
  assert(runtimeSearch.hits.length >= 1, "runtime search 至少应命中一条本地知识");
  assert(runtimeSearch.retrieval?.strategy === "local_first_non_vector", "runtime search 应声明 local_first_non_vector");
  assert(runtimeSearch.retrieval?.vectorUsed === false, "runtime search 不应使用向量索引");
  if (conversationMinutes.minutes?.length) {
    assert(
      runtimeSearch.hits.some((entry) => entry.sourceType === "conversation_minute"),
      "已有本地纪要时，runtime search 应命中 conversation_minute"
    );
  }
  const mempalaceFixture = await createMockMempalaceFixture({
    prefix: "openneed-mempalace-dom-",
    wing: `dom_remote_reasoner_wing_${Date.now()}`,
    room: `dom_remote_reasoner_room_${Date.now()}`,
    sourceFile: `dom-remote-reasoner-${Date.now()}.md`,
  });
  let externalRuntimeSearch = null;
  let defaultRuntimeSearchWithExternalEnabled = null;
  let externalContextBuilder = null;
  let remoteHttpReasonerRedacted = false;
  let remoteOpenAIReasonerRedacted = false;
  try {
    const externalColdMemoryRuntime = await configureDeviceRuntime({
      residentAgentId: boundResidentAgentId,
      residentDidMethod: "agentpassport",
      retrievalMaxHits: 16,
      externalColdMemoryEnabled: true,
      externalColdMemoryProvider: "mempalace",
      externalColdMemoryMaxHits: 2,
      externalColdMemoryTimeoutMs: 1500,
      mempalaceCommand: mempalaceFixture.commandPath,
      mempalacePalacePath: mempalaceFixture.palacePath,
      dryRun: false,
    });
    assert(
      externalColdMemoryRuntime.deviceRuntime?.retrievalPolicy?.externalColdMemory?.enabled === true,
      "device runtime 应允许显式开启 externalColdMemory"
    );
    assert(
      externalColdMemoryRuntime.deviceRuntime?.retrievalPolicy?.externalColdMemory?.command === mempalaceFixture.commandPath,
      "device runtime 应保留 mempalace mock command"
    );
    externalRuntimeSearch = await searchAgentRuntimeKnowledge("agent_openneed_agents", {
      didMethod: "agentpassport",
      query: mempalaceFixture.query,
      limit: 6,
      sourceType: "external_cold_memory",
    });
    assert(
      externalRuntimeSearch.retrieval?.externalColdMemoryEnabled === true,
      "external runtime search 应声明 externalColdMemory 已开启"
    );
    assert(
      externalRuntimeSearch.retrieval?.externalColdMemoryHitCount >= 1,
      "external runtime search 应命中至少一条 external cold memory"
    );
    assert(
      externalRuntimeSearch.hits.some((entry) => entry.sourceType === "external_cold_memory"),
      "external runtime search 结果中应出现 external_cold_memory"
    );
    defaultRuntimeSearchWithExternalEnabled = await searchAgentRuntimeKnowledge("agent_openneed_agents", {
      didMethod: "agentpassport",
      query: mempalaceFixture.query,
      limit: 6,
    });
    assert(
      defaultRuntimeSearchWithExternalEnabled.hits.every((entry) => entry.sourceType !== "external_cold_memory"),
      "默认 runtime search 不应混入 external cold memory"
    );
    externalContextBuilder = await buildAgentContextBundle(
      "agent_openneed_agents",
      {
        currentGoal: "验证 external cold memory sidecar 不会污染本地真源",
        query: mempalaceFixture.query,
      },
      { didMethod: "agentpassport" }
    );
    assert(
      Array.isArray(externalContextBuilder.localKnowledge?.hits) &&
        externalContextBuilder.localKnowledge.hits.every((entry) => entry.sourceType !== "external_cold_memory"),
      "context builder 的 localKnowledge 不应混入 external cold memory"
    );
    assert(
      Array.isArray(externalContextBuilder.externalColdMemory?.hits) &&
        externalContextBuilder.externalColdMemory.hits.some((entry) => entry.sourceType === "external_cold_memory"),
      "context builder 应把 external cold memory 单独分层返回"
    );
    const capturedReasoner = await createCapturedReasonerServer();
    try {
      const remoteCurrentGoal = "验证远端 reasoner 不会看到 external cold memory 原文";
      const remoteUserTurn = "继续推进当前任务";
      const httpReasonerResult = await generateAgentRunnerCandidateResponse({
        contextBuilder: externalContextBuilder,
        payload: {
          currentGoal: remoteCurrentGoal,
          userTurn: remoteUserTurn,
          reasonerProvider: "http",
          reasoner: {
            provider: "http",
            url: `${capturedReasoner.baseUrl}/reasoner`,
            model: "capture-http",
          },
        },
      });
      assert(httpReasonerResult.provider === "http", "http reasoner capture 应返回 http provider");
      const openAIReasonerResult = await generateAgentRunnerCandidateResponse({
        contextBuilder: externalContextBuilder,
        payload: {
          currentGoal: remoteCurrentGoal,
          userTurn: remoteUserTurn,
          reasonerProvider: "openai_compatible",
          reasoner: {
            provider: "openai_compatible",
            baseUrl: capturedReasoner.baseUrl,
            path: "/chat/completions",
            model: "capture-openai",
          },
        },
      });
      assert(
        openAIReasonerResult.provider === "openai_compatible",
        "openai_compatible reasoner capture 应返回 openai_compatible provider"
      );
      const httpRequest = capturedReasoner.requests.find((entry) => entry.url === "/reasoner") || null;
      assert(httpRequest?.body?.contextBuilder, "http reasoner capture 应收到 contextBuilder");
      assert(
        Array.isArray(httpRequest.body.contextBuilder.localKnowledge?.hits) &&
          httpRequest.body.contextBuilder.localKnowledge.hits.length <= 3,
        "http reasoner localKnowledge hits 应受命中上限约束"
      );
      assert(
        Array.isArray(httpRequest.body.contextBuilder.slots?.localKnowledgeHits) &&
          httpRequest.body.contextBuilder.slots.localKnowledgeHits.length <= 3,
        "http reasoner slot localKnowledgeHits 应受命中上限约束"
      );
      assert(
        Number(httpRequest.body.contextBuilder.localKnowledge?.retrieval?.hitCount || 0) ===
          httpRequest.body.contextBuilder.localKnowledge.hits.length,
        "http reasoner retrieval hitCount 应等于实际发出的命中数"
      );
      assert(
        httpRequest.body.contextBuilder.localKnowledge.hits.every((entry) => (entry.title?.length || 0) <= 80),
        "http reasoner knowledge title 应受长度上限约束"
      );
      assert(
        httpRequest.body.contextBuilder.localKnowledge.hits.every((entry) => (entry.summary?.length || 0) <= 120),
        "http reasoner knowledge summary 应受长度上限约束"
      );
      assert(
        httpRequest.body.contextBuilder.externalColdMemory?.redactedForRemoteReasoner === true,
        "http reasoner 不应看到 external cold memory 原文"
      );
      assert(
        Object.prototype.hasOwnProperty.call(httpRequest.body.contextBuilder.externalColdMemory || {}, "provider") === false,
        "http reasoner external cold memory 不应暴露 provider"
      );
      assert(
        Object.prototype.hasOwnProperty.call(httpRequest.body.contextBuilder.externalColdMemory || {}, "used") === false,
        "http reasoner external cold memory 不应暴露 used"
      );
      assert(
        Object.prototype.hasOwnProperty.call(httpRequest.body.contextBuilder.externalColdMemory || {}, "hitCount") === false,
        "http reasoner external cold memory 不应暴露 hitCount"
      );
      assert(
        Object.prototype.hasOwnProperty.call(httpRequest.body.contextBuilder.externalColdMemory || {}, "hits") === false,
        "http reasoner external cold memory hits 不应继续透传空壳"
      );
      assert(
        httpRequest.body.contextBuilder.slots?.transcriptModel?.redactedForRemoteReasoner === true,
        "http reasoner transcript model 应只保留远端脱敏标记"
      );
      assert(
        Object.prototype.hasOwnProperty.call(httpRequest.body.contextBuilder.slots || {}, "cognitiveLoop") === false,
        "http reasoner 不应透传 cognitiveLoop"
      );
      assert(
        Object.prototype.hasOwnProperty.call(httpRequest.body.contextBuilder.slots || {}, "currentGoal") === false,
        "http reasoner 不应在 slots 里重复透传 currentGoal"
      );
      assert(
        Object.prototype.hasOwnProperty.call(httpRequest.body.contextBuilder.slots || {}, "workingMemoryGate") === false,
        "http reasoner 不应透传 workingMemoryGate"
      );
      const httpRuntimeGuidance = httpRequest.body.contextBuilder.slots?.continuousCognitiveState || null;
      assert(
        httpRuntimeGuidance == null || httpRuntimeGuidance?.conservativeResponseMode === true,
        "http reasoner continuousCognitiveState 只应保留 conservativeResponseMode"
      );
      assert(
        httpRuntimeGuidance == null || Object.keys(httpRuntimeGuidance).length === 1,
        "http reasoner continuousCognitiveState 不应透传额外运行态细节"
      );
      assert(
        Object.prototype.hasOwnProperty.call(httpRequest.body.contextBuilder.slots?.transcriptModel || {}, "latestEntryType") === false,
        "http reasoner transcript model 不应暴露 latestEntryType"
      );
      assert(
        Object.prototype.hasOwnProperty.call(httpRequest.body.contextBuilder.slots?.transcriptModel || {}, "families") === false,
        "http reasoner transcript model 不应暴露 families"
      );
      assert(
        httpRequest.body.contextBuilder.slots?.queryBudget?.redactedForRemoteReasoner === true,
        "http reasoner query budget 应只保留远端脱敏标记"
      );
      assert(
        Object.prototype.hasOwnProperty.call(httpRequest.body.contextBuilder.slots?.queryBudget || {}, "omittedSections") === false,
        "http reasoner query budget 不应暴露被省略 section 名称"
      );
      const httpCompiledPrompt = String(httpRequest.body.contextBuilder.compiledPrompt || "");
      assert(
        !httpCompiledPrompt.includes("EXTERNAL COLD MEMORY CANDIDATES"),
        "http reasoner compiledPrompt 不应保留 external cold memory section"
      );
      assert(
        !httpCompiledPrompt.includes("QUERY BUDGET"),
        "http reasoner compiledPrompt 不应保留 query budget section"
      );
      assert(
        !httpCompiledPrompt.includes("PERCEPTION SNAPSHOT"),
        "http reasoner compiledPrompt 不应保留内部 perception section 标题"
      );
      assert(
        !httpCompiledPrompt.includes("EVENT GRAPH"),
        "http reasoner compiledPrompt 不应保留内部 event graph section 标题"
      );
      assert(
        !httpCompiledPrompt.includes("SOURCE MONITORING"),
        "http reasoner compiledPrompt 不应保留内部 source monitoring section 标题"
      );
      assert(
        !httpCompiledPrompt.includes("RISK SIGNALS"),
        "http reasoner compiledPrompt 不应再使用旧版 risk signals 表述"
      );
      assert(
        !httpCompiledPrompt.includes("STABLE PREFERENCES"),
        "http reasoner compiledPrompt 不应再使用旧版 stable preferences 表述"
      );
      assert(
        !httpCompiledPrompt.includes("RELATIONSHIP HINTS"),
        "http reasoner compiledPrompt 不应再使用旧版 relationship hints 表述"
      );
      assert(
        !httpCompiledPrompt.includes("LONG-TERM PREFERENCES"),
        "http reasoner compiledPrompt 不应继续暴露 long-term preferences 表述"
      );
      assert(
        !httpCompiledPrompt.includes("\"knowledgeSignals\""),
        "http reasoner compiledPrompt 不应把检索命中伪装成 observed input"
      );
      assert(
        !httpCompiledPrompt.includes("\"minuteSignals\""),
        "http reasoner compiledPrompt 不应暴露 minute signals"
      );
      assert(
        !httpCompiledPrompt.includes("RELATED LINKS"),
        "http reasoner compiledPrompt 不应保留 related links section"
      );
      assert(
        !httpCompiledPrompt.includes("\"relatedLinks\""),
        "http reasoner compiledPrompt 不应保留 relatedLinks 摘要"
      );
      assert(
        !httpCompiledPrompt.includes("\"excerpt\""),
        "http reasoner compiledPrompt 不应继续透传 knowledge excerpt"
      );
      assert(
        !httpCompiledPrompt.includes("\"score\""),
        "http reasoner compiledPrompt 不应继续透传 knowledge score"
      );
      assert(
        !httpCompiledPrompt.includes("\"candidateOnly\""),
        "http reasoner compiledPrompt 不应继续透传 knowledge candidateOnly"
      );
      assert(
        !httpRequest.rawBody.includes("recordedAt"),
        "http reasoner 不应透传 local knowledge recordedAt"
      );
      assert(
        !httpRequest.rawBody.includes("\"sourceType\""),
        "http reasoner 不应透传 knowledge sourceType"
      );
      assert(
        !httpRequest.rawBody.includes("\"cautions\""),
        "http reasoner 不应透传 source monitoring cautions 文本"
      );
      assert(
        !httpRequest.rawBody.includes("\"requiresCautiousTone\""),
        "http reasoner 不应透传可由 cautionCount 推导的重复谨慎标记"
      );
      assert(
        !httpRequest.rawBody.includes("\"displayName\""),
        "http reasoner 不应透传 identity displayName"
      );
      assert(
        !httpRequest.rawBody.includes("\"latestEntryType\""),
        "http reasoner 不应透传 transcript latestEntryType"
      );
      assert(
        !httpRequest.rawBody.includes("\"families\""),
        "http reasoner 不应透传 transcript families"
      );
      assert(
        Object.prototype.hasOwnProperty.call(httpRequest.body.contextBuilder.slots || {}, "eventGraph") === false,
        "http reasoner 不应继续透传 event graph"
      );
      assert(
        !httpRequest.rawBody.includes("\"nodeId\""),
        "http reasoner 不应透传 event graph nodeId"
      );
      assert(
        !httpRequest.rawBody.includes("\"from\""),
        "http reasoner 不应透传 event graph from 端点"
      );
      assert(
        !httpRequest.rawBody.includes("\"to\""),
        "http reasoner 不应透传 event graph to 端点"
      );
      assert(
        !httpRequest.rawBody.includes("\"layers\""),
        "http reasoner 不应透传 event graph layers"
      );
      assert(
        !httpRequest.rawBody.includes("\"relation\""),
        "http reasoner 不应透传 event graph relation"
      );
      assert(
        !httpRequest.rawBody.includes("supportSummary"),
        "http reasoner 不应透传 event graph supportSummary"
      );
      assert(
        !httpRequest.rawBody.includes("\"excerpt\""),
        "http reasoner 不应透传 knowledge excerpt"
      );
      assert(
        !httpRequest.rawBody.includes("\"score\""),
        "http reasoner 不应透传 knowledge score"
      );
      assert(
        !httpRequest.rawBody.includes("\"candidateOnly\""),
        "http reasoner 不应透传 knowledge candidateOnly"
      );
      for (const marker of [
        mempalaceFixture.sourceFile,
        mempalaceFixture.wing,
        mempalaceFixture.room,
        "external cold memory stays read-only.",
        "never override the local ledger.",
      ]) {
        assert(!httpRequest.rawBody.includes(marker), `http reasoner 出站 payload 不应泄漏 external marker: ${marker}`);
      }
      const openAIRequest = capturedReasoner.requests.find((entry) => entry.url === "/chat/completions") || null;
      assert(Array.isArray(openAIRequest?.body?.messages), "openai_compatible reasoner capture 应收到 messages");
      assert(
        !openAIRequest.rawBody.includes("EXTERNAL COLD MEMORY CANDIDATES"),
        "openai_compatible reasoner messages 不应保留 external cold memory section"
      );
      assert(
        !openAIRequest.rawBody.includes("QUERY BUDGET"),
        "openai_compatible reasoner messages 不应保留 query budget section"
      );
      assert(
        !openAIRequest.rawBody.includes("PERCEPTION SNAPSHOT"),
        "openai_compatible reasoner messages 不应保留内部 perception section 标题"
      );
      assert(
        !openAIRequest.rawBody.includes("Current Goal"),
        "openai_compatible reasoner messages 不应保留旧版 Current Goal 标题"
      );
      assert(
        !openAIRequest.rawBody.includes("User Turn"),
        "openai_compatible reasoner messages 不应保留旧版 User Turn 标题"
      );
      assert(
        !openAIRequest.rawBody.includes("Context Summary"),
        "openai_compatible reasoner messages 不应保留旧版 Context Summary 标题"
      );
      assert(
        openAIRequest.rawBody.includes("Goal:"),
        "openai_compatible reasoner messages 应使用更短的 Goal 标题"
      );
      assert(
        openAIRequest.rawBody.includes("Input:"),
        "openai_compatible reasoner messages 应使用更短的 Input 标题"
      );
      assert(
        openAIRequest.rawBody.includes("Summary:"),
        "openai_compatible reasoner messages 应使用更短的 Summary 标题"
      );
      assert(
        !openAIRequest.rawBody.includes("EVENT GRAPH"),
        "openai_compatible reasoner messages 不应保留内部 event graph section 标题"
      );
      assert(
        !openAIRequest.rawBody.includes("RELATED LINKS"),
        "openai_compatible reasoner messages 不应保留 related links section 标题"
      );
      assert(
        !openAIRequest.rawBody.includes("SOURCE MONITORING"),
        "openai_compatible reasoner messages 不应保留内部 source monitoring section 标题"
      );
      assert(
        !openAIRequest.rawBody.includes("working-memory gate"),
        "openai_compatible reasoner messages 不应保留内部 working-memory gate 术语"
      );
      assert(
        !openAIRequest.rawBody.includes("event-graph"),
        "openai_compatible reasoner messages 不应保留内部 event-graph 术语"
      );
      assert(
        !openAIRequest.rawBody.includes("identity/ledger"),
        "openai_compatible reasoner messages 不应保留内部 identity/ledger 术语"
      );
      assert(
        !openAIRequest.rawBody.includes("relationship hints"),
        "openai_compatible reasoner messages 不应再使用旧版 relationship hints 表述"
      );
      assert(
        !openAIRequest.rawBody.includes("risk signals"),
        "openai_compatible reasoner messages 不应再使用旧版 risk signals 表述"
      );
      assert(
        !openAIRequest.rawBody.includes("stable preferences"),
        "openai_compatible reasoner messages 不应再使用旧版 stable preferences 表述"
      );
      assert(
        !openAIRequest.rawBody.includes("long-term preferences"),
        "openai_compatible reasoner messages 不应继续暴露 long-term preferences 表述"
      );
      assert(
        openAIRequest.rawBody.includes("caution cues"),
        "openai_compatible reasoner messages 应使用新的 caution cues 表述"
      );
      assert(
        openAIRequest.rawBody.includes("Use only the provided context."),
        "openai_compatible reasoner system prompt 应使用更短的上下文约束"
      );
      assert(
        !openAIRequest.rawBody.includes("Ground your answer in the provided observed input"),
        "openai_compatible reasoner system prompt 不应保留旧版长说明"
      );
      assert(
        !openAIRequest.rawBody.includes("Multi-hop causal claims require explicit support"),
        "openai_compatible reasoner system prompt 不应保留旧版长因果说明"
      );
      assert(
        openAIRequest.rawBody.includes("证据不足时明确保留不确定语气；没有支撑时不要拼接因果。"),
        "openai_compatible reasoner user prompt 应使用更短的中文约束"
      );
      assert(
        openAIRequest.rawBody.includes("先读观察到的输入，再结合相关上下文、谨慎信号和任务框架回答。"),
        "openai_compatible reasoner user prompt 应改用不含关联线索的最小任务框架措辞"
      );
      assert(
        !openAIRequest.rawBody.includes("若谨慎提示显示真实性偏低或内部生成风险偏高，必须显式保留推断语气。"),
        "openai_compatible reasoner user prompt 不应保留旧版长中文说明"
      );
      assert(
        !openAIRequest.rawBody.includes("关联线索"),
        "openai_compatible reasoner user prompt 不应继续暴露关联线索措辞"
      );
      assert(
        !openAIRequest.rawBody.includes("recordedAt"),
        "openai_compatible reasoner messages 不应透传 local knowledge recordedAt"
      );
      assert(
        !openAIRequest.rawBody.includes("\"sourceType\""),
        "openai_compatible reasoner messages 不应透传 knowledge sourceType"
      );
      assert(
        !openAIRequest.rawBody.includes("\"cautions\""),
        "openai_compatible reasoner messages 不应透传 source monitoring cautions 文本"
      );
      assert(
        !openAIRequest.rawBody.includes("\"requiresCautiousTone\""),
        "openai_compatible reasoner messages 不应透传可由 cautionCount 推导的重复谨慎标记"
      );
      assert(
        !openAIRequest.rawBody.includes("\"displayName\""),
        "openai_compatible reasoner messages 不应透传 identity displayName"
      );
      assert(
        !openAIRequest.rawBody.includes("\"knowledgeSignals\""),
        "openai_compatible reasoner messages 不应把检索命中伪装成 observed input"
      );
      assert(
        !openAIRequest.rawBody.includes("\"minuteSignals\""),
        "openai_compatible reasoner messages 不应暴露 minute signals"
      );
      assert(
        !openAIRequest.rawBody.includes("\"excerpt\""),
        "openai_compatible reasoner messages 不应透传 knowledge excerpt"
      );
      assert(
        !openAIRequest.rawBody.includes("\"score\""),
        "openai_compatible reasoner messages 不应透传 knowledge score"
      );
      assert(
        !openAIRequest.rawBody.includes("\"candidateOnly\""),
        "openai_compatible reasoner messages 不应透传 knowledge candidateOnly"
      );
      assert(
        !openAIRequest.rawBody.includes("\"relatedLinks\""),
        "openai_compatible reasoner messages 不应透传 relatedLinks 摘要"
      );
      assert(
        !openAIRequest.rawBody.includes("Reasoning Order (Heuristic)"),
        "openai_compatible reasoner messages 不应保留 reasoning order"
      );
      assert(
        !openAIRequest.rawBody.includes("Runtime State Hints"),
        "openai_compatible reasoner messages 不应保留 runtime state hints"
      );
      assert(
        !openAIRequest.rawBody.includes("\"mode\":\"focused\""),
        "openai_compatible reasoner messages 不应透传具体 cognitive mode"
      );
      assert(
        !openAIRequest.rawBody.includes("\"latestEntryType\""),
        "openai_compatible reasoner messages 不应透传 transcript latestEntryType"
      );
      assert(
        !openAIRequest.rawBody.includes("\"families\""),
        "openai_compatible reasoner messages 不应透传 transcript families"
      );
      assert(
        !openAIRequest.rawBody.includes("\"nodeId\""),
        "openai_compatible reasoner messages 不应透传 event graph nodeId"
      );
      assert(
        !openAIRequest.rawBody.includes("\"from\""),
        "openai_compatible reasoner messages 不应透传 event graph from 端点"
      );
      assert(
        !openAIRequest.rawBody.includes("\"to\""),
        "openai_compatible reasoner messages 不应透传 event graph to 端点"
      );
      assert(
        !openAIRequest.rawBody.includes("\"layers\""),
        "openai_compatible reasoner messages 不应透传 event graph layers"
      );
      assert(
        !openAIRequest.rawBody.includes("\"relation\""),
        "openai_compatible reasoner messages 不应透传 event graph relation"
      );
      assert(
        !openAIRequest.rawBody.includes("supportSummary"),
        "openai_compatible reasoner messages 不应透传 event graph supportSummary"
      );
      for (const marker of [
        mempalaceFixture.sourceFile,
        mempalaceFixture.wing,
        mempalaceFixture.room,
        "external cold memory stays read-only.",
        "never override the local ledger.",
      ]) {
        assert(
          !openAIRequest.rawBody.includes(marker),
          `openai_compatible reasoner 出站 messages 不应泄漏 external marker: ${marker}`
        );
      }
      remoteHttpReasonerRedacted = true;
      remoteOpenAIReasonerRedacted = true;
    } finally {
      await capturedReasoner.close();
    }
  } finally {
    await configureDeviceRuntime({
      residentAgentId: boundResidentAgentId,
      residentDidMethod: "agentpassport",
      retrievalMaxHits: 8,
      externalColdMemoryEnabled: false,
      externalColdMemoryProvider: "mempalace",
      externalColdMemoryMaxHits: 3,
      externalColdMemoryTimeoutMs: 2500,
      mempalaceCommand: "mempalace",
      mempalacePalacePath: null,
      dryRun: false,
    });
    await mempalaceFixture.cleanup();
  }
  traceSmoke("runtime snapshot and knowledge search checks");
  const sandboxSearch = await executeAgentSandboxAction(
    "agent_openneed_agents",
    {
      interactionMode: "command",
      executionMode: "execute",
      confirmExecution: true,
      currentGoal: "验证 sandbox action 是否能安全执行本地检索",
      requestedAction: runtimeSearchQuery,
      requestedCapability: "runtime_search",
      requestedActionType: "search",
      sourceWindowId: primaryWindow.windowId,
      recordedByAgentId: "agent_openneed_agents",
      recordedByWindowId: primaryWindow.windowId,
      persistRun: false,
      autoCompact: false,
      sandboxAction: {
        capability: "runtime_search",
        actionType: "search",
        query: runtimeSearchQuery,
        sourceWindowId: primaryWindow.windowId,
        recordedByAgentId: "agent_openneed_agents",
        recordedByWindowId: primaryWindow.windowId,
      },
    },
    { didMethod: "agentpassport" }
  );
  assert(sandboxSearch.status === "completed", "sandbox runtime_search 应返回 completed");
  assert(sandboxSearch.sandboxExecution?.capability === "runtime_search", "sandbox runtime_search capability 不匹配");
  assert(sandboxSearch.sandboxExecution?.executionBackend === "in_process", "runtime_search 应走 in_process backend");
  assert((sandboxSearch.sandboxExecution?.output?.hits || []).length >= 1, "sandbox runtime_search 应至少命中一条");
  const sandboxList = await executeAgentSandboxAction(
    "agent_openneed_agents",
    {
      interactionMode: "command",
      executionMode: "execute",
      confirmExecution: true,
      currentGoal: "验证 sandbox action 是否能安全列举 allowlist 目录",
      requestedAction: `列举 ${dataDir} 目录`,
      requestedCapability: "filesystem_list",
      requestedActionType: "list",
      targetResource: dataDir,
      sourceWindowId: primaryWindow.windowId,
      recordedByAgentId: "agent_openneed_agents",
      recordedByWindowId: primaryWindow.windowId,
      persistRun: false,
      autoCompact: false,
      sandboxAction: {
        capability: "filesystem_list",
        actionType: "list",
        targetResource: dataDir,
        path: dataDir,
        sourceWindowId: primaryWindow.windowId,
        recordedByAgentId: "agent_openneed_agents",
        recordedByWindowId: primaryWindow.windowId,
      },
    },
    { didMethod: "agentpassport" }
  );
  assert(sandboxList.status === "completed", "sandbox filesystem_list 应返回 completed");
  assert(sandboxList.sandboxExecution?.capability === "filesystem_list", "sandbox filesystem_list capability 不匹配");
  assert(sandboxList.sandboxExecution?.executionBackend === "subprocess", "filesystem_list 应走 subprocess backend");
  assert((sandboxList.sandboxExecution?.output?.entries || []).length >= 1, "sandbox filesystem_list 应返回至少一个条目");
  assert(
    sandboxList.sandboxExecution?.output?.brokerIsolation?.boundary === "independent_process",
    "sandbox filesystem_list 应报告独立 broker 边界"
  );
  assert(
    sandboxList.sandboxExecution?.output?.brokerIsolation?.brokerEnvMode === "empty",
    "sandbox filesystem_list 应报告空 broker 环境"
  );
  assert(
    sandboxList.sandboxExecution?.output?.brokerIsolation?.systemSandbox?.enabled === true,
    "sandbox filesystem_list 应报告系统级 broker sandbox 已启用"
  );
  assert(
    sandboxList.sandboxExecution?.output?.workerIsolation?.subprocessWorker === true,
    "sandbox filesystem_list 应报告 subprocess worker"
  );
  assert(
    sandboxList.sandboxExecution?.output?.workerIsolation?.workerEnvMode === "empty",
    "sandbox filesystem_list 应报告空 worker 环境"
  );
  const sandboxAudits = await listAgentSandboxActionAudits("agent_openneed_agents", { limit: 10 });
  assert(Array.isArray(sandboxAudits.audits), "sandbox audit list 应返回 audits 数组");
  assert(
    sandboxAudits.audits.some((entry) => entry.capability === "runtime_search"),
    "sandbox audit history 应包含 runtime_search"
  );
  assert(
    sandboxAudits.audits.some((entry) => entry.capability === "filesystem_list"),
    "sandbox audit history 应包含 filesystem_list"
  );
  traceSmoke("sandbox action checks");
  const originalRuntime = (await getDeviceRuntimeState()).deviceRuntime;
  try {
    await configureDeviceRuntime({
      ...originalRuntime,
      residentAgentId: originalRuntime?.residentAgentId || "agent_openneed_agents",
      residentDidMethod: originalRuntime?.residentDidMethod || "agentpassport",
      allowedCapabilities: ["network_external"],
      blockedCapabilities: [],
      allowExternalNetwork: false,
      networkAllowlist: ["127.0.0.1", "localhost"],
    });
    const nestedNetworkBlocked = await executeAgentSandboxAction(
      "agent_openneed_agents",
      {
        interactionMode: "command",
        executionMode: "execute",
        confirmExecution: true,
        currentGoal: "验证 nested sandboxAction capability 也会被 network policy 阻断",
        requestedAction: "读取本机 health",
        requestedActionType: "read",
        persistRun: false,
        autoCompact: false,
        sandboxAction: {
          capability: "network_external",
          method: "GET",
          url: "http://127.0.0.1:4319/api/health",
        },
      },
      { didMethod: "agentpassport" }
    );
    assert(nestedNetworkBlocked.executed === false, "nested network_external 不应在禁网策略下执行");
    assert(
      nestedNetworkBlocked.negotiation?.sandboxBlockedReasons?.includes("external_network_disabled"),
      "nested network_external 应命中 external_network_disabled"
    );

    await configureDeviceRuntime({
      ...originalRuntime,
      residentAgentId: originalRuntime?.residentAgentId || "agent_openneed_agents",
      residentDidMethod: originalRuntime?.residentDidMethod || "agentpassport",
      allowedCapabilities: ["process_exec"],
      blockedCapabilities: [],
      allowedCommands: ["/usr/bin/printf"],
      filesystemAllowlist: ["/tmp"],
      allowShellExecution: false,
    });
    const nestedProcessBlocked = await executeAgentSandboxAction(
      "agent_openneed_agents",
      {
        interactionMode: "command",
        executionMode: "execute",
        confirmExecution: true,
        currentGoal: "验证 nested sandboxAction capability 也会被 shell disable 阻断",
        requestedAction: "执行 /usr/bin/printf",
        requestedActionType: "execute",
        persistRun: false,
        autoCompact: false,
        sandboxAction: {
          capability: "process_exec",
          command: "/usr/bin/printf",
          args: ["nested-shell"],
          cwd: "/tmp",
        },
      },
      { didMethod: "agentpassport" }
    );
    assert(nestedProcessBlocked.executed === false, "nested process_exec 不应在 shell disable 策略下执行");
    assert(
      nestedProcessBlocked.negotiation?.sandboxBlockedReasons?.includes("shell_execution_disabled"),
      "nested process_exec 应命中 shell_execution_disabled"
    );

    const mismatchedCapabilityBlocked = await executeAgentSandboxAction(
      "agent_openneed_agents",
      {
        interactionMode: "command",
        executionMode: "execute",
        confirmExecution: true,
        currentGoal: "验证顶层 capability 和 nested sandboxAction capability 不一致时会被阻断",
        requestedAction: "伪装成 runtime_search 的 process_exec",
        requestedCapability: "runtime_search",
        requestedActionType: "search",
        persistRun: false,
        autoCompact: false,
        sandboxAction: {
          capability: "process_exec",
          command: "/usr/bin/printf",
          args: ["capability-mismatch"],
          cwd: "/tmp",
        },
      },
      { didMethod: "agentpassport" }
    );
    assert(mismatchedCapabilityBlocked.executed === false, "capability mismatch 不应执行");
    assert(
      mismatchedCapabilityBlocked.negotiation?.sandboxBlockedReasons?.includes(
        "capability_mismatch:runtime_search->process_exec"
      ),
      "capability mismatch 应显式进入协商阻断原因"
    );
  } finally {
    await configureDeviceRuntime({
      ...originalRuntime,
      residentAgentId: originalRuntime?.residentAgentId || "agent_openneed_agents",
      residentDidMethod: originalRuntime?.residentDidMethod || "agentpassport",
    });
  }
  const sandboxTempRoot = await fs.mkdtemp(path.join("/tmp", "openneed-memory-symlink-"));
  const sandboxAllowedDir = path.join(sandboxTempRoot, "allowed");
  const sandboxOutsideDir = path.join(sandboxTempRoot, "outside");
  await fs.mkdir(sandboxAllowedDir, { recursive: true });
  await fs.mkdir(sandboxOutsideDir, { recursive: true });
  const outsideFile = path.join(sandboxOutsideDir, "secret.txt");
  const symlinkPath = path.join(sandboxAllowedDir, "escape.txt");
  await fs.writeFile(outsideFile, "sandbox-secret", "utf8");
  await fs.symlink(outsideFile, symlinkPath);
  try {
    await configureDeviceRuntime({
      ...originalRuntime,
      residentAgentId: originalRuntime?.residentAgentId || "agent_openneed_agents",
      residentDidMethod: originalRuntime?.residentDidMethod || "agentpassport",
      allowedCapabilities: ["runtime_search", "filesystem_read"],
      filesystemAllowlist: [sandboxAllowedDir],
      maxReadBytes: 1024,
    });
    let symlinkEscapeBlocked = false;
    try {
      await executeAgentSandboxAction(
        "agent_openneed_agents",
        {
          interactionMode: "command",
          executionMode: "execute",
          confirmExecution: true,
          currentGoal: "验证 sandbox 会拒绝 allowlist 内指向目录外的 symlink",
          requestedAction: "读取 symlink 文件",
          requestedCapability: "filesystem_read",
          requestedActionType: "read",
          targetResource: symlinkPath,
          sourceWindowId: primaryWindow.windowId,
          recordedByAgentId: "agent_openneed_agents",
          recordedByWindowId: primaryWindow.windowId,
          persistRun: false,
          autoCompact: false,
          sandboxAction: {
            capability: "filesystem_read",
            actionType: "read",
            targetResource: symlinkPath,
            path: symlinkPath,
          },
        },
        { didMethod: "agentpassport" }
      );
    } catch (error) {
      symlinkEscapeBlocked = String(error?.message || "").includes("outside sandbox allowlist");
    }
    assert(symlinkEscapeBlocked, "sandbox 应拒绝 allowlist 内指向目录外的 symlink 读取");
  } finally {
    await configureDeviceRuntime({
      ...originalRuntime,
      residentAgentId: originalRuntime?.residentAgentId || "agent_openneed_agents",
      residentDidMethod: originalRuntime?.residentDidMethod || "agentpassport",
    });
    await fs.rm(sandboxTempRoot, { recursive: true, force: true });
  }
  const brokerProcessExec = await runSandboxBroker({
    capability: "process_exec",
    command: "/usr/bin/printf",
    args: ["openneed-memory-worker"],
    cwd: "/tmp",
    timeoutMs: 1500,
    maxOutputBytes: 1024,
    isolatedEnv: true,
  });
  assert(brokerProcessExec.ok === true, "runtime sandbox broker process_exec 应返回 ok=true");
  assert(
    brokerProcessExec.broker?.boundary === "independent_process",
    "runtime sandbox broker process_exec 应报告独立 broker 边界"
  );
  assert(
    brokerProcessExec.broker?.brokerEnvMode === "empty",
    "runtime sandbox broker process_exec 应报告空 broker 环境"
  );
  assert(
    brokerProcessExec.broker?.workspaceMode === "ephemeral_root",
    "runtime sandbox broker process_exec 应报告独立 broker 工作区"
  );
  assert(
    brokerProcessExec.broker?.systemSandbox?.backend === "sandbox_exec",
    "runtime sandbox broker process_exec 应报告 sandbox_exec backend"
  );
  assert(
    brokerProcessExec.broker?.systemSandbox?.enabled === true,
    "runtime sandbox broker process_exec 应报告系统级 sandbox 已启用"
  );
  assert(
    brokerProcessExec.broker?.cleanupStatus === "removed",
    "runtime sandbox broker process_exec 应报告 broker 工作区已清理"
  );
  assert(brokerProcessExec.output?.code === 0, "runtime sandbox broker process_exec 应返回 code=0");
  assert(brokerProcessExec.output?.stdout === "openneed-memory-worker", "runtime sandbox broker process_exec stdout 不匹配");
  assert(brokerProcessExec.output?.isolatedEnv === true, "runtime sandbox broker process_exec 应报告 isolatedEnv=true");
  assert(
    brokerProcessExec.output?.workerIsolation?.subprocessWorker === true,
    "runtime sandbox broker process_exec 应报告 subprocessWorker=true"
  );
  assert(
    brokerProcessExec.output?.workerIsolation?.processEnvMode === "minimal",
    "runtime sandbox broker process_exec 应报告最小进程环境"
  );
  assert(
    brokerProcessExec.output?.workerIsolation?.workspaceMode === "ephemeral_home_tmp",
    "runtime sandbox broker process_exec 应报告临时 HOME/TMP 工作区"
  );
  assert(
    brokerProcessExec.output?.workerIsolation?.cleanupStatus === "removed",
    "runtime sandbox broker process_exec 应报告隔离工作区已清理"
  );
  assert(brokerProcessExec.output?.stdoutTruncated === false, "runtime sandbox broker process_exec stdout 不应被截断");
  assert(brokerProcessExec.output?.inputTruncated === false, "runtime sandbox broker process_exec stdin 不应被截断");
  const printfDigest = createHash("sha256")
    .update(await fs.readFile("/usr/bin/printf"))
    .digest("hex");
  try {
    const pinnedRuntime = await configureDeviceRuntime({
      ...originalRuntime,
      residentAgentId: originalRuntime?.residentAgentId || "agent_openneed_agents",
      residentDidMethod: originalRuntime?.residentDidMethod || "agentpassport",
      allowedCapabilities: ["process_exec"],
      blockedCapabilities: [],
      allowedCommands: [`/usr/bin/printf|sha256=${printfDigest}`],
      filesystemAllowlist: ["/tmp"],
      allowShellExecution: true,
      lowRiskStrategy: "auto_execute",
      mediumRiskStrategy: "confirm",
      highRiskStrategy: "confirm",
      criticalRiskStrategy: "confirm",
    });
    assert(
      pinnedRuntime.deviceRuntime?.commandPolicy?.riskStrategies?.critical === "multisig",
      "critical 风险策略不应低于 multisig"
    );
    const pinnedNegotiation = await executeAgentSandboxAction(
      "agent_openneed_agents",
      {
        interactionMode: "command",
        executionMode: "execute",
        confirmExecution: false,
        currentGoal: "验证 digest pinned process_exec negotiation",
        requestedAction: "/usr/bin/printf",
        requestedCapability: "process_exec",
        requestedActionType: "execute",
        persistRun: false,
        autoCompact: false,
        sandboxAction: {
          capability: "process_exec",
          actionType: "execute",
          command: "/usr/bin/printf",
          args: ["digest-pinned"],
          cwd: "/tmp",
        },
      },
      { didMethod: "agentpassport" }
    );
    assert(pinnedNegotiation.status === "negotiation_required", "digest pinned process_exec 预协商应要求确认");
    assert(pinnedNegotiation.negotiation?.riskTier === "high", "digest pinned process_exec 应被归类为 high");
    assert(pinnedNegotiation.negotiation?.decision === "confirm", "digest pinned process_exec 应进入 confirm");
    const pinnedProcessExec = await executeAgentSandboxAction(
      "agent_openneed_agents",
      {
        interactionMode: "command",
        executionMode: "execute",
        confirmExecution: true,
        currentGoal: "验证 digest pinned process_exec",
        requestedAction: "/usr/bin/printf",
        requestedCapability: "process_exec",
        requestedActionType: "execute",
        persistRun: false,
        autoCompact: false,
        sandboxAction: {
          capability: "process_exec",
          actionType: "execute",
          command: "/usr/bin/printf",
          args: ["digest-pinned"],
          cwd: "/tmp",
        },
      },
      { didMethod: "agentpassport" }
    );
    assert(pinnedProcessExec.status === "completed", "digest pinned process_exec 应执行成功");
    assert(
      pinnedProcessExec.sandboxExecution?.output?.commandDigestPinned === true,
      "digest pinned process_exec 应标记 commandDigestPinned=true"
    );
    let digestMismatchBlocked = false;
    const mismatchRuntime = await configureDeviceRuntime({
      ...originalRuntime,
      residentAgentId: originalRuntime?.residentAgentId || "agent_openneed_agents",
      residentDidMethod: originalRuntime?.residentDidMethod || "agentpassport",
      allowedCapabilities: ["process_exec"],
      blockedCapabilities: [],
      allowedCommands: ["/usr/bin/printf|sha256=0000000000000000000000000000000000000000000000000000000000000000"],
      filesystemAllowlist: ["/tmp"],
      allowShellExecution: true,
      lowRiskStrategy: "auto_execute",
      mediumRiskStrategy: "confirm",
      highRiskStrategy: "confirm",
      criticalRiskStrategy: "confirm",
    });
    assert(
      mismatchRuntime.deviceRuntime?.commandPolicy?.riskStrategies?.critical === "multisig",
      "digest mismatch 场景下 critical 风险策略也不应低于 multisig"
    );
    const digestMismatchBlockedResult = await executeAgentSandboxAction(
      "agent_openneed_agents",
      {
        interactionMode: "command",
        executionMode: "execute",
        confirmExecution: true,
        currentGoal: "验证 digest mismatch 会在 negotiation 阶段阻止 process_exec",
        requestedAction: "/usr/bin/printf",
        requestedCapability: "process_exec",
        requestedActionType: "execute",
        persistRun: false,
        autoCompact: false,
        sandboxAction: {
          capability: "process_exec",
          actionType: "execute",
          command: "/usr/bin/printf",
          args: ["digest-mismatch"],
          cwd: "/tmp",
        },
      },
      { didMethod: "agentpassport" }
    );
    digestMismatchBlocked =
      digestMismatchBlockedResult.status === "blocked" &&
      digestMismatchBlockedResult.negotiation?.riskTier === "critical" &&
      Array.isArray(digestMismatchBlockedResult.negotiation?.sandboxBlockedReasons) &&
      digestMismatchBlockedResult.negotiation.sandboxBlockedReasons.some((reason) =>
        String(reason || "").startsWith("command_digest_mismatch:")
      );
    assert(digestMismatchBlocked, "digest mismatch 应在 negotiation 阶段阻止 process_exec");
    const processArgBudgetRuntime = await configureDeviceRuntime({
      ...originalRuntime,
      residentAgentId: originalRuntime?.residentAgentId || "agent_openneed_agents",
      residentDidMethod: originalRuntime?.residentDidMethod || "agentpassport",
      allowedCapabilities: ["process_exec"],
      blockedCapabilities: [],
      allowedCommands: [`/usr/bin/printf|sha256=${printfDigest}`],
      filesystemAllowlist: ["/tmp"],
      allowShellExecution: true,
      maxProcessArgs: 1,
      lowRiskStrategy: "auto_execute",
      mediumRiskStrategy: "confirm",
      highRiskStrategy: "confirm",
      criticalRiskStrategy: "confirm",
    });
    assert(
      processArgBudgetRuntime.deviceRuntime?.sandboxPolicy?.maxProcessArgs === 1,
      "process_exec 参数预算场景没保住 maxProcessArgs=1"
    );
    const processArgBudgetBlockedResult = await executeAgentSandboxAction(
      "agent_openneed_agents",
      {
        interactionMode: "command",
        executionMode: "execute",
        confirmExecution: true,
        currentGoal: "验证 process_exec 参数预算越界会在 negotiation 阶段阻断",
        requestedAction: "/usr/bin/printf",
        requestedCapability: "process_exec",
        requestedActionType: "execute",
        persistRun: false,
        autoCompact: false,
        sandboxAction: {
          capability: "process_exec",
          actionType: "execute",
          command: "/usr/bin/printf",
          args: ["a", "b"],
          cwd: "/tmp",
        },
      },
      { didMethod: "agentpassport" }
    );
    const processArgBudgetBlocked =
      processArgBudgetBlockedResult.status === "blocked" &&
      processArgBudgetBlockedResult.negotiation?.riskTier === "high" &&
      Array.isArray(processArgBudgetBlockedResult.negotiation?.sandboxBlockedReasons) &&
      processArgBudgetBlockedResult.negotiation.sandboxBlockedReasons.includes("Sandbox process args exceed limit: 2/1");
    assert(processArgBudgetBlocked, "process_exec 参数预算越界应在 negotiation 阶段阻止执行");
  } finally {
    await configureDeviceRuntime({
      ...originalRuntime,
      residentAgentId: originalRuntime?.residentAgentId || "agent_openneed_agents",
      residentDidMethod: originalRuntime?.residentDidMethod || "agentpassport",
    });
  }
  const responseVerification = await verifyAgentResponse(
    "agent_openneed_agents",
    {
      responseText: "agent_id: agent_treasury",
      claims: {
        agentId: "agent_treasury",
      },
    },
    { didMethod: "agentpassport" }
  );
  assert(responseVerification.valid === false, "response verifier 应拦住错误 agent_id");
  assert(
    responseVerification.issues?.some((issue) => issue.code === "agent_id_mismatch"),
    "response verifier 没返回 agent_id_mismatch"
  );
  const localCommandRunnerResult = await executeAgentRunner(
    "agent_openneed_agents",
    {
      currentGoal: "验证 local_command reasoner 是否能从本地参考层重建身份",
      userTurn: "请按真实身份继续推进",
      reasonerProvider: "local_command",
      autoCompact: false,
      persistRun: false,
      storeToolResults: false,
      turnCount: 1,
      estimatedContextChars: 900,
    },
    { didMethod: "agentpassport" }
  );
  assert(localCommandRunnerResult.reasoner?.provider === "local_command", "local_command runner 应返回正确 provider");
  assert(localCommandRunnerResult.verification?.valid === true, "local_command runner 应通过 verifier");
  const runnerResult = await executeAgentRunner(
    "agent_openneed_agents",
    {
      currentGoal: "验证 runner 是否把 context builder / verifier 串起来",
      userTurn: "请确认你是谁",
      candidateResponse: "agent_id: agent_treasury",
      claims: {
        agentId: "agent_treasury",
      },
      autoCompact: false,
      persistRun: false,
      storeToolResults: false,
      turnCount: 2,
      estimatedContextChars: 1200,
    },
    { didMethod: "agentpassport" }
  );
  assert(
    ["blocked", "bootstrap_required"].includes(runnerResult.run?.status),
    "runner 状态应该是 blocked 或 bootstrap_required"
  );
  assert(runnerResult.queryState?.budget?.maxQueryIterations >= 1, "runner 应返回 queryState budget");
  if (runnerResult.run?.status === "blocked") {
    assert(runnerResult.verification?.valid === false, "runner verification 应该失败");
  } else {
    assert(runnerResult.bootstrapGate?.required === true, "bootstrap_required 时应返回 bootstrapGate.required");
  }
  const mockRunnerResult = await executeAgentRunner(
    "agent_openneed_agents",
    {
      currentGoal: "验证 mock reasoner 是否能生成安全候选回复",
      userTurn: "请按本地参考层的真实身份继续推进",
      reasonerProvider: "local_mock",
      autoCompact: false,
      persistRun: false,
      storeToolResults: false,
      turnCount: 1,
      estimatedContextChars: 800,
    },
    { didMethod: "agentpassport" }
  );
  assert(mockRunnerResult.run?.status !== "prepared", "mock runner 不应退回 prepared");
  if (mockRunnerResult.run?.status === "bootstrap_required") {
    assert(mockRunnerResult.bootstrapGate?.required === true, "bootstrap_required 时应返回 bootstrapGate.required");
  } else {
    assert(mockRunnerResult.verification?.valid === true, "mock runner verification 应该通过");
    assert(mockRunnerResult.reasoner?.provider === "local_mock", "local mock runner 应报告 reasoner=local_mock");
    assert(mockRunnerResult.queryState?.currentIteration >= 1, "mock runner 应返回 queryState");
  }
  const negotiationRunnerResult = await executeAgentRunner(
    "agent_openneed_agents",
    {
      currentGoal: "验证命令协商环是否先商量再执行",
      userTurn: "请直接删除这台机器上的历史资料",
      interactionMode: "command",
      requestedAction: "删除本地历史资料",
      executionMode: "execute",
      confirmExecution: false,
      autoCompact: false,
      persistRun: false,
      storeToolResults: false,
      turnCount: 1,
      estimatedContextChars: 600,
    },
    { didMethod: "agentpassport" }
  );
  assert(negotiationRunnerResult.negotiation?.riskTier === "critical", "删除类命令应被判成 critical");
  assert(negotiationRunnerResult.negotiation?.authorizationStrategy === "multisig", "critical 动作应升级为 multisig");
  assert(negotiationRunnerResult.negotiation?.decision === "multisig", "critical 命令应进入 multisig");
  assert(negotiationRunnerResult.run?.status === "negotiation_required", "高风险命令不应直接 completed");
  const sessionState = await getAgentSessionState("agent_openneed_agents", { didMethod: "agentpassport" });
  assert(sessionState?.agentId === "agent_openneed_agents", "session state agentId 不匹配");
  assert(sessionState?.localMode, "session state 应返回 localMode");
  const compactBoundaries = await listCompactBoundaries("agent_openneed_agents", { limit: 5 });
  assert(Array.isArray(compactBoundaries.compactBoundaries), "compact boundaries 缺少 compactBoundaries 数组");
  const latestBoundaryId =
    compactBoundaries.compactBoundaries?.at?.(-1)?.compactBoundaryId ||
    compactBoundaries.compactBoundaries?.[0]?.compactBoundaryId ||
    null;
  let resumedRehydrate = null;
  let autoRecoveredRunnerResult = null;
  if (latestBoundaryId) {
    resumedRehydrate = await getAgentRehydratePack("agent_openneed_agents", {
      didMethod: "agentpassport",
      resumeFromCompactBoundaryId: latestBoundaryId,
    });
    assert(
      resumedRehydrate.resumeBoundary?.compactBoundaryId === latestBoundaryId,
      "rehydrate resumeBoundary 与 compact boundary 不匹配"
    );
    autoRecoveredRunnerResult = await executeAgentRunner(
      "agent_openneed_agents",
      {
        currentGoal: "验证 auto recovery 是否能从 compact boundary 自动续跑",
        userTurn: "请继续推进当前任务",
        reasonerProvider: "local_mock",
        autoRecover: true,
        maxRecoveryAttempts: 1,
        persistRun: false,
        autoCompact: false,
        writeConversationTurns: false,
        storeToolResults: false,
        turnCount: 18,
        estimatedContextChars: 24000,
        resumeFromCompactBoundaryId: latestBoundaryId,
      },
      { didMethod: "agentpassport" }
    );
    assert(autoRecoveredRunnerResult.autoRecovery?.requested === true, "runner auto recovery 应返回 requested");
    assert(autoRecoveredRunnerResult.autoResumed === true, "runner auto recovery 应触发自动续跑");
    assert(
      Array.isArray(autoRecoveredRunnerResult.recoveryChain) && autoRecoveredRunnerResult.recoveryChain.length >= 2,
      "runner auto recovery 应返回至少两段 recoveryChain"
    );
    assert(
      autoRecoveredRunnerResult.autoRecovery?.initialRecoveryAction?.action === "reload_rehydrate_pack",
      "runner auto recovery 初始动作应为 reload_rehydrate_pack"
    );
    assert(
      autoRecoveredRunnerResult.recoveryChain[0]?.runStatus === "rehydrate_required",
      "runner auto recovery 首段应从 rehydrate_required 开始"
    );
    assert(
      autoRecoveredRunnerResult.run?.status !== "rehydrate_required",
      "runner auto recovery 续跑后不应仍停在 rehydrate_required"
    );
    assert(
      Array.isArray(autoRecoveredRunnerResult.autoRecovery?.closure?.phases) &&
        autoRecoveredRunnerResult.autoRecovery.closure.phases.length >= 5,
      "runner auto recovery 应返回 closure phases"
    );
  }
  const retryWithoutExecutionRunnerResult = await executeAgentRunner(
    "agent_openneed_agents",
    {
      currentGoal: "验证 retry_without_execution 自动恢复",
      userTurn: "请直接执行一个 shell 命令并给我结果",
      interactionMode: "command",
      executionMode: "execute",
      confirmExecution: true,
      requestedAction: "执行本地 shell 命令",
      requestedCapability: "process_exec",
      capability: "process_exec",
      sandboxAction: {
        capability: "process_exec",
        command: "echo",
        args: ["hello"],
      },
      autoRecover: true,
      maxRecoveryAttempts: 1,
      persistRun: true,
      autoCompact: false,
      writeConversationTurns: false,
      storeToolResults: false,
      turnCount: 1,
      estimatedContextChars: 600,
      estimatedContextTokens: 200,
    },
    { didMethod: "agentpassport" }
  );
  assert(
    retryWithoutExecutionRunnerResult.autoRecovery?.plan?.action === "retry_without_execution",
    "runner 应为受限执行阻断场景生成 retry_without_execution 自动恢复计划"
  );
  assert(
    retryWithoutExecutionRunnerResult.autoRecovery?.status === "resumed",
    "retry_without_execution 自动恢复应完成一次续跑"
  );
  assert(
    retryWithoutExecutionRunnerResult.run?.status === "completed",
    "retry_without_execution 自动恢复续跑后应回到 completed"
  );
  assert(
    Array.isArray(retryWithoutExecutionRunnerResult.recoveryChain) &&
      retryWithoutExecutionRunnerResult.recoveryChain.length >= 2,
    "retry_without_execution 自动恢复应返回 recoveryChain"
  );
  assert(
    retryWithoutExecutionRunnerResult.autoRecovery?.closure?.phases?.some((entry) => entry.phaseId === "outcome"),
    "retry_without_execution 自动恢复应返回 closure outcome phase"
  );
  const runnerHistory = await listAgentRuns("agent_openneed_agents", { limit: 5 });
  assert(Array.isArray(runnerHistory.runs), "runner history 应返回 runs 数组");
  assert(Array.isArray(runnerHistory.autoRecoveryAudits), "runner history 应返回 autoRecoveryAudits 数组");
  assert(
    runnerHistory.autoRecoveryAudits.some((entry) => entry?.closure?.phases?.some((phase) => phase.phaseId === "outcome")),
    "runner history 应落盘 auto recovery closure 审计"
  );
  const verificationRunResult = await executeVerificationRun(
    "agent_openneed_agents",
    {
      currentGoal: "验证 runtime integrity 是否可追溯",
      mode: "runtime_integrity",
      persistRun: false,
      sourceWindowId: primaryWindow.windowId,
    },
    { didMethod: "agentpassport" }
  );
  assert(verificationRunResult.verificationRun?.status, "verification run 缺少 status");
  assert(
    verificationRunResult.verificationRun?.checks?.some((check) => check.code === "adversarial_identity_probe"),
    "verification run 缺少 adversarial_identity_probe"
  );
  const verificationHistory = await listVerificationRuns("agent_openneed_agents", { limit: 5 });
  assert(Array.isArray(verificationHistory.verificationRuns), "verification history 缺少 verificationRuns");
  traceSmoke("runner and verification checks");
  const driftCheck = await checkAgentContextDrift(
    "agent_openneed_agents",
    {
      currentGoal: "验证 runtime drift check 是否可用",
      nextAction: "执行 grant_asset",
      turnCount: 18,
      estimatedContextChars: 24000,
    },
    { didMethod: "agentpassport" }
  );
  assert(runtime.policy?.maxConversationTurns >= 1, "runtime policy 不可用");
  assert(typeof rehydrate.prompt === "string", "rehydrate.prompt 不可用");
  assert(driftCheck.requiresRehydrate === true, "高 turn/context 的 drift-check 应触发 rehydrate");
  const driftBlockedRunner = await executeAgentRunner(
    "agent_openneed_agents",
    {
      currentGoal: "验证 drift 会先拦住 sandbox",
      userTurn: "请继续推进当前任务",
      reasonerProvider: "local_mock",
      interactionMode: "command",
      executionMode: "execute",
      confirmExecution: true,
      requestedAction: "搜索最近的本地纪要",
      requestedCapability: "runtime_search",
      requestedActionType: "search",
      persistRun: false,
      autoCompact: false,
      writeConversationTurns: false,
      storeToolResults: false,
      turnCount: 18,
      estimatedContextChars: 24000,
      sandboxAction: {
        capability: "runtime_search",
        actionType: "search",
        query: "Passport",
      },
    },
    { didMethod: "agentpassport" }
  );
  assert(driftBlockedRunner.run?.status === "rehydrate_required", "drift-gated runner 应先进入 rehydrate_required");
  assert(driftBlockedRunner.sandboxExecution?.executed !== true, "drift-gated runner 不应真的执行 sandbox");
  assert(
    driftBlockedRunner.sandboxExecution?.blockedBy === "rehydrate_required",
    "drift-gated runner 应标记 sandbox 被 rehydrate_required 拦截"
  );
  assert(driftBlockedRunner.sandboxExecution?.output == null, "drift-gated runner 不应返回 sandbox output");
  const [agentCredentialOpenneed, agentCredentialAgentpassport] = await Promise.all([
    getAgentCredential("agent_openneed_agents", { didMethod: "openneed" }),
    getAgentCredential("agent_openneed_agents", { didMethod: "agentpassport" }),
  ]);
  assert(agentCredentialOpenneed.credentialRecord?.issuerDidMethod === "openneed", "openneed Agent 证据 did method 不正确");
  assert(
    agentCredentialAgentpassport.credentialRecord?.issuerDidMethod === "agentpassport",
    "agentpassport Agent 证据 did method 不正确"
  );
  assert(
    agentCredentialOpenneed.credential?.issuer !== agentCredentialAgentpassport.credential?.issuer,
    "切 DID method 后 Agent issuer 不应相同"
  );
  const contextStatusLists = Array.isArray(agentContext.statusLists) ? agentContext.statusLists.filter(Boolean) : [];
  assert(contextStatusLists.length > 0, "agent context 缺少 statusLists");

  const currentStatusListId =
    credentialStatus.statusProof?.statusListId ||
    credentialStatus.statusListSummary?.statusListId ||
    agentContext.statusList?.statusListId ||
    contextStatusLists[0]?.statusListId ||
    null;
  assert(currentStatusListId, "当前 credential 缺少可用 statusListId");

  const compareStatusListId =
    contextStatusLists.find((entry) => entry?.statusListId && entry.statusListId !== currentStatusListId)?.statusListId || null;

  if (compareStatusListId) {
    const statusListComparison = await compareCredentialStatusLists({
      leftStatusListId: currentStatusListId,
      rightStatusListId: compareStatusListId,
    });
    assert(statusListComparison.leftStatusListId === currentStatusListId, "状态列表对比左侧 ID 不匹配");
    assert(statusListComparison.rightStatusListId === compareStatusListId, "状态列表对比右侧 ID 不匹配");
  }

  const publicRuntimeHref = links.buildPublicRuntimeHref({
    agentId: "agent_openneed_agents",
    didMethod: "agentpassport",
    windowId: primaryWindow.windowId,
    repairId,
    credentialId,
    statusListId: currentStatusListId,
    statusListCompareId: compareStatusListId,
    repairLimit: 6,
    repairOffset: 6,
    compareLeftAgentId: "agent_openneed_agents",
    compareRightAgentId: "agent_treasury",
    compareIssuerAgentId: "agent_treasury",
    compareIssuerDidMethod: "agentpassport",
  });
  assert(publicRuntimeHref === "/", "公开运行态公开入口应始终回到 /");

  const mainHref = links.buildRuntimeHomeHref({
    agentId: "agent_openneed_agents",
    didMethod: "agentpassport",
    windowId: primaryWindow.windowId,
    repairId,
    credentialId,
    statusListId: currentStatusListId,
    statusListCompareId: compareStatusListId,
    repairLimit: 6,
    repairOffset: 6,
    compareLeftAgentId: "agent_openneed_agents",
    compareRightAgentId: "agent_treasury",
    compareIssuerAgentId: "agent_treasury",
    compareIssuerDidMethod: "agentpassport",
  });

  const parsedMain = links.parseRuntimeHomeSearch(mainHref, {
    agentId: "agent_openneed_agents",
    didMethod: "agentpassport",
    windowId: primaryWindow.windowId,
    repairLimit: 6,
    repairOffset: 0,
    compareRightAgentId: "agent_treasury",
    compareIssuerAgentId: "agent_treasury",
    compareIssuerDidMethod: "agentpassport",
  });

  assert(parsedMain.agentId === "agent_openneed_agents", "runtime-home helper 没保留 agentId");
  assert(parsedMain.didMethod === "agentpassport", "runtime-home helper 没保留 didMethod");
  assert(parsedMain.windowId === primaryWindow.windowId, "runtime-home helper 没保留 windowId");
  assert(parsedMain.repairId === repairId, "runtime-home helper 没保留 repairId");
  assert(parsedMain.credentialId === credentialId, "runtime-home helper 没保留 credentialId");
  assert(parsedMain.statusListId === currentStatusListId, "runtime-home helper 没保留 statusListId");
  assert(parsedMain.statusListCompareId === compareStatusListId, "runtime-home helper 没保留 statusListCompareId");
  assert(parsedMain.repairLimit === 6, "runtime-home helper 没保留 repairLimit");
  assert(parsedMain.repairOffset === 6, "runtime-home helper 没保留 repairOffset");
  assert(parsedMain.compareLeftAgentId === "agent_openneed_agents", "runtime-home helper 没保留 compareLeftAgentId");
  assert(parsedMain.compareIssuerDidMethod === "agentpassport", "runtime-home helper 没保留 compareIssuerDidMethod");

  const siblingStatusListId =
    siblingStatus.statusProof?.statusListId ||
    siblingStatus.statusListSummary?.statusListId ||
    currentStatusListId;
  const siblingCompareStatusListId =
    [currentStatusListId, compareStatusListId].find((entry) => entry && entry !== siblingStatusListId) || null;

  const siblingPublicRuntimeHref = links.buildPublicRuntimeHref({
    agentId: "agent_openneed_agents",
    didMethod: "openneed",
    windowId: siblingWindow.windowId,
    repairId,
    credentialId: siblingCredentialId,
    statusListId: siblingStatusListId,
    statusListCompareId: siblingCompareStatusListId,
    repairLimit: 4,
    repairOffset: 8,
    compareLeftAgentId: "agent_openneed_agents",
    compareRightAgentId: "agent_treasury",
    compareIssuerAgentId: "agent_treasury",
    compareIssuerDidMethod: siblingDetail.credentialRecord?.issuerDidMethod || siblingRecord.issuerDidMethod || "openneed",
  });
  assert(siblingPublicRuntimeHref === "/", "公开运行态 sibling 入口应始终回到 /");

  const siblingMainHref = links.buildRuntimeHomeHref({
    agentId: "agent_openneed_agents",
    didMethod: "openneed",
    windowId: siblingWindow.windowId,
    repairId,
    credentialId: siblingCredentialId,
    statusListId: siblingStatusListId,
    statusListCompareId: siblingCompareStatusListId,
    repairLimit: 4,
    repairOffset: 8,
    compareLeftAgentId: "agent_openneed_agents",
    compareRightAgentId: "agent_treasury",
    compareIssuerAgentId: "agent_treasury",
    compareIssuerDidMethod: siblingDetail.credentialRecord?.issuerDidMethod || siblingRecord.issuerDidMethod || "openneed",
  });
  const parsedSiblingMain = links.parseRuntimeHomeSearch(siblingMainHref, {
    agentId: "agent_openneed_agents",
    didMethod: "openneed",
    windowId: siblingWindow.windowId,
    repairLimit: 4,
    repairOffset: 0,
    compareRightAgentId: "agent_treasury",
    compareIssuerAgentId: "agent_treasury",
  });
  assert(parsedSiblingMain.agentId === "agent_openneed_agents", "sibling runtime-home helper 没保留 agentId");
  assert(parsedSiblingMain.didMethod === "openneed", "sibling runtime-home helper 没保留 didMethod");
  assert(parsedSiblingMain.windowId === siblingWindow.windowId, "sibling runtime-home helper 没保留 windowId");
  assert(parsedSiblingMain.repairId === repairId, "sibling runtime-home helper 没保留 repairId");
  assert(parsedSiblingMain.credentialId === siblingCredentialId, "sibling runtime-home helper 没保留 credentialId");
  assert(parsedSiblingMain.statusListId === siblingStatusListId, "sibling runtime-home helper 没保留 statusListId");
  assert(
    parsedSiblingMain.statusListCompareId === siblingCompareStatusListId,
    "sibling runtime-home helper 没保留 statusListCompareId"
  );
  assert(parsedSiblingMain.repairLimit === 4, "sibling runtime-home helper 没保留 repairLimit");
  assert(parsedSiblingMain.repairOffset === 8, "sibling runtime-home helper 没保留 repairOffset");
  assert(
    parsedSiblingMain.compareIssuerDidMethod ===
      (siblingDetail.credentialRecord?.issuerDidMethod || siblingRecord.issuerDidMethod || "openneed"),
    "sibling runtime-home helper 没保留 sibling did method"
  );

  const rewrittenPublicRuntimeHref = links.buildPublicRuntimeHref({
    agentId: "agent_treasury",
    didMethod: "agentpassport",
    windowId: rewrittenWindow.windowId,
    repairId,
    credentialId,
    statusListId: compareStatusListId,
    statusListCompareId: currentStatusListId,
    repairLimit: 3,
    repairOffset: 9,
    compareLeftAgentId: "agent_treasury",
    compareRightAgentId: "agent_openneed_agents",
    compareIssuerAgentId: "agent_openneed_agents",
    compareIssuerDidMethod: "openneed",
  });
  assert(rewrittenPublicRuntimeHref === "/", "公开运行态改写入口应始终回到 /");

  const rewrittenMainHref = links.buildRuntimeHomeHref({
    agentId: "agent_treasury",
    didMethod: "agentpassport",
    windowId: rewrittenWindow.windowId,
    repairId,
    credentialId,
    statusListId: compareStatusListId,
    statusListCompareId: currentStatusListId,
    repairLimit: 3,
    repairOffset: 9,
    compareLeftAgentId: "agent_treasury",
    compareRightAgentId: "agent_openneed_agents",
    compareIssuerAgentId: "agent_openneed_agents",
    compareIssuerDidMethod: "openneed",
  });
  const parsedRewrittenMain = links.parseRuntimeHomeSearch(rewrittenMainHref, {
    compareRightAgentId: "agent_treasury",
    compareIssuerAgentId: "agent_treasury",
  });
  assert(parsedRewrittenMain.agentId === "agent_treasury", "改写后的 runtime-home helper 没保留 agentId");
  assert(parsedRewrittenMain.didMethod === "agentpassport", "改写后的 runtime-home helper 没保留 didMethod");
  assert(parsedRewrittenMain.windowId === rewrittenWindow.windowId, "改写后的 runtime-home helper 没保留 windowId");
  assert(parsedRewrittenMain.compareLeftAgentId === "agent_treasury", "改写后的 compareLeftAgentId 不匹配");
  assert(parsedRewrittenMain.compareRightAgentId === "agent_openneed_agents", "改写后的 compareRightAgentId 不匹配");
  assert(parsedRewrittenMain.compareIssuerAgentId === "agent_openneed_agents", "改写后的 compareIssuerAgentId 不匹配");
  assert(parsedRewrittenMain.compareIssuerDidMethod === "openneed", "改写后的 compareIssuerDidMethod 不匹配");
  assert(parsedRewrittenMain.repairLimit === 3, "改写后的 repairLimit 不匹配");
  assert(parsedRewrittenMain.repairOffset === 9, "改写后的 repairOffset 不匹配");

  const repairHubHref = links.buildRepairHubHref({
    agentId: "agent_openneed_agents",
    issuerAgentId: "agent_treasury",
    scope: "comparison_pair",
    repairId,
    credentialId,
    didMethod: "agentpassport",
    windowId: primaryWindow.windowId,
    sortBy: "latestIssuedAt",
    sortOrder: "desc",
    limit: 7,
    offset: 2,
  });

  const repairHubUrl = new URL(repairHubHref, "http://openneed-memory.local");
  assert(repairHubUrl.pathname === "/repair-hub", "修复中心 href 路径不正确");
  assert(repairHubUrl.searchParams.get("repairId") === repairId, "修复中心 href 没保留 repairId");
  assert(repairHubUrl.searchParams.get("credentialId") === credentialId, "修复中心 href 没保留 credentialId");
  assert(repairHubUrl.searchParams.get("didMethod") === "agentpassport", "修复中心 href 没保留 didMethod");
  const parsedRepairHub = links.parseRepairHubSearch(repairHubHref, {
    agentId: "agent_openneed_agents",
    didMethod: "agentpassport",
    sortBy: "latestIssuedAt",
    sortOrder: "desc",
    limit: 5,
    offset: 0,
  });
  assert(parsedRepairHub.agentId === "agent_openneed_agents", "修复中心 deep-link 没保留 agentId");
  assert(parsedRepairHub.windowId === primaryWindow.windowId, "修复中心 deep-link 没保留 windowId");
  assert(parsedRepairHub.issuerAgentId === "agent_treasury", "修复中心 deep-link 没保留 issuerAgentId");
  assert(parsedRepairHub.scope === "comparison_pair", "修复中心 deep-link 没保留 scope");
  assert(parsedRepairHub.repairId === repairId, "修复中心 deep-link parse 后 repairId 不匹配");
  assert(parsedRepairHub.credentialId === credentialId, "修复中心 deep-link parse 后 credentialId 不匹配");
  assert(parsedRepairHub.didMethod === "agentpassport", "修复中心 deep-link parse 后 didMethod 不匹配");
  assert(parsedRepairHub.limit === 7, "修复中心 deep-link parse 后 limit 不匹配");
  assert(parsedRepairHub.offset === 2, "修复中心 deep-link parse 后 offset 不匹配");

  const siblingRepairHubHref = links.buildRepairHubHref({
    agentId: "agent_openneed_agents",
    issuerAgentId: "agent_treasury",
    scope: "comparison_pair",
    repairId,
    credentialId: siblingCredentialId,
    didMethod: siblingDetail.credentialRecord?.issuerDidMethod || siblingRecord.issuerDidMethod || "openneed",
    windowId: siblingWindow.windowId,
    sortBy: "latestIssuedAt",
    sortOrder: "desc",
    limit: 9,
    offset: 1,
  });
  const parsedSiblingRepairHub = links.parseRepairHubSearch(siblingRepairHubHref, {
    agentId: "agent_openneed_agents",
    didMethod: "agentpassport",
  });
  assert(parsedSiblingRepairHub.repairId === repairId, "sibling 修复中心 deep-link 没保留 repairId");
  assert(parsedSiblingRepairHub.windowId === siblingWindow.windowId, "sibling 修复中心 deep-link 没保留 windowId");
  assert(
    parsedSiblingRepairHub.credentialId === siblingCredentialId,
    "sibling 修复中心 deep-link 没保留 sibling credentialId"
  );
  assert(
    parsedSiblingRepairHub.didMethod === (siblingDetail.credentialRecord?.issuerDidMethod || siblingRecord.issuerDidMethod || "openneed"),
    "sibling 修复中心 deep-link 没保留 sibling did method"
  );
  assert(parsedSiblingRepairHub.limit === 9, "sibling 修复中心 deep-link parse 后 limit 不匹配");
  assert(parsedSiblingRepairHub.offset === 1, "sibling 修复中心 deep-link parse 后 offset 不匹配");

  console.log(
    JSON.stringify(
      {
        ok: true,
        repairId,
        credentialId,
        siblingCredentialId,
        siblingDidMethod: siblingDetail.credentialRecord?.issuerDidMethod || siblingRecord.issuerDidMethod || null,
        activeAgentId: parsedMain.agentId,
        activeDidMethod: parsedMain.didMethod,
        activeWindowId: parsedMain.windowId,
        checkedWindowAgentId: primaryWindowDetail.agentId,
        windowCount: windows.length,
        recoveryBundleId: recoveryExport.summary?.bundleId || null,
        recoveryBundleCount: recoveryBundles.counts?.total || recoveryBundles.bundles.length || 0,
        recoveryRehearsalStatus: recoveryRehearsal.rehearsal?.status || null,
        recoveryRehearsalCount: recoveryRehearsalHistory.counts?.total || recoveryRehearsalHistory.rehearsals.length || 0,
        deviceSetupComplete: setupStatus.setupComplete || false,
        deviceSetupRunComplete: setupRun.status?.setupComplete || false,
        setupPackageId: setupPackagePreview.summary?.packageId || null,
        savedSetupPackageId,
        localReasonerStatus: localReasonerStatus.diagnostics?.status || null,
        localReasonerCatalogProviderCount: localReasonerCatalog.providers.length || 0,
        localReasonerProbeStatus: localReasonerProbe.diagnostics?.status || null,
        localReasonerSelectedProvider: localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.provider || null,
        localReasonerPrewarmStatus: localReasonerPrewarm.warmState?.status || null,
        localReasonerProfileId,
        localReasonerProfileCount: localReasonerProfiles.counts?.total || localReasonerProfiles.profiles.length || 0,
        localReasonerRestoreCandidateCount:
          localReasonerRestoreCandidates.counts?.total || localReasonerRestoreCandidates.restoreCandidates.length || 0,
        localReasonerRestoreProfileId: localReasonerRestore.restoredProfileId || null,
        localReasonerRestoreWarmStatus: localReasonerRestore.prewarmResult?.warmState?.status || null,
        setupPackageCount: setupPackageList.counts?.total || setupPackageList.packages.length || 0,
        setupPackageProfileCount: savedSetupPackageDetail.summary?.localReasonerProfileCount || 0,
        setupPackagePruneDeleted: setupPackagePrune.counts?.deleted || 0,
        housekeepingApplyMode: housekeepingApply.mode || null,
        housekeepingRevokedReadSessions: housekeepingApply.readSessions?.revokedCount || 0,
        housekeepingDeletedRecoveryBundles: housekeepingApply.recoveryBundles?.deletedCount || 0,
        housekeepingDeletedSetupPackages: housekeepingApply.setupPackages?.counts?.deleted || 0,
        passportMemoryCount: passportMemories.counts?.filtered || passportMemories.memories.length || 0,
        runtimeSnapshotId: runtime.taskSnapshot?.snapshotId || null,
        retrievalStrategy: runtime.deviceRuntime?.retrievalPolicy?.strategy || null,
        retrievalVectorEnabled: runtime.deviceRuntime?.retrievalPolicy?.allowVectorIndex || false,
        sandboxAllowedCapabilities: runtime.deviceRuntime?.sandboxPolicy?.allowedCapabilities?.length || 0,
        localReasonerProvider: runtime.deviceRuntime?.localReasoner?.provider || null,
        localReasonerConfigured: runtime.deviceRuntime?.localReasoner?.configured || false,
        readSessionCount: readSessions.sessions.length || 0,
        offlineChatPersonaCount: offlineChatBootstrap.personas.length || 0,
        offlineChatDirectProvider: offlineDirectResult.reasoning?.provider || null,
        offlineChatDirectMinuteTitle: offlineDirectFastMinute?.title || null,
        offlineChatNonFastProvider: offlineNonFastResult.runner?.reasoner?.provider || offlineNonFastResult.reasoning?.provider || null,
        offlineChatGroupResponses: offlineGroupResult.responses?.length || 0,
        offlineChatGroupMinuteTitle: offlineGroupFastMinute?.title || null,
        bootstrapDryRun: bootstrap.bootstrap?.dryRun || false,
        bootstrapProfileWrites: bootstrap.bootstrap?.summary?.profileWriteCount || 0,
        rehydratePackHash: rehydrate.packHash || null,
        resumedBoundaryId: resumedRehydrate?.resumeBoundary?.compactBoundaryId || null,
        contextBuilderHash: contextBuilder.contextHash || null,
        transcriptEntryCount: transcript.transcript?.entryCount || transcript.entries.length || 0,
        transcriptBlockCount: transcript.transcript?.messageBlocks?.length || 0,
        responseVerifierIssues: responseVerification.issues?.length || 0,
        runnerStatus: runnerResult.run?.status || null,
        localCommandRunnerStatus: localCommandRunnerResult.run?.status || null,
        localCommandReasonerProvider: localCommandRunnerResult.reasoner?.provider || null,
        ollamaLocalProvider: ollamaRuntimePreview.deviceRuntime?.localReasoner?.provider || null,
        mockRunnerStatus: mockRunnerResult.run?.status || null,
        mockReasonerProvider: mockRunnerResult.reasoner?.provider || null,
        sessionStateId: sessionState?.sessionStateId || null,
        compactBoundaryCount: compactBoundaries.counts?.filtered || compactBoundaries.compactBoundaries.length || 0,
        verificationRunStatus: verificationRunResult.verificationRun?.status || null,
        verificationHistoryCount: verificationHistory.counts?.filtered || verificationHistory.verificationRuns.length || 0,
        conversationMinuteCount: conversationMinutes.counts?.total || conversationMinutes.minutes.length || 0,
        runtimeSearchHits: runtimeSearch.hits.length || 0,
        runtimeSearchStrategy: runtimeSearch.retrieval?.strategy || null,
        externalColdMemoryRuntimeSearchHits: externalRuntimeSearch?.retrieval?.externalColdMemoryHitCount || 0,
        defaultRuntimeSearchWithExternalEnabledHits: defaultRuntimeSearchWithExternalEnabled?.hits?.length || 0,
        externalColdMemoryContextHits: externalContextBuilder?.externalColdMemory?.hits?.length || 0,
        remoteHttpReasonerRedacted,
        remoteOpenAIReasonerRedacted,
        runtimeSearchSuggestedBoundaryId: runtimeSearch.suggestedResumeBoundaryId || null,
        sandboxAuditCount: sandboxAudits.counts?.total || sandboxAudits.audits.length || 0,
        sandboxSearchHits: sandboxSearch.sandboxExecution?.output?.hits?.length || 0,
        sandboxListEntries: sandboxList.sandboxExecution?.output?.entries?.length || 0,
        negotiationRiskTier: negotiationRunnerResult.negotiation?.riskTier || null,
        negotiationAuthorizationStrategy: negotiationRunnerResult.negotiation?.authorizationStrategy || null,
        driftRequiresRehydrate: driftCheck.requiresRehydrate,
        statusListId: currentStatusListId,
        statusListCompareId: compareStatusListId,
        repairCount: repairs.counts?.total || repairs.repairs.length || 0,
        mainHref,
        siblingMainHref,
        rewrittenMainHref,
        repairHubHref,
        siblingRepairHubHref,
        credentialStatus: credentialDetail.credentialRecord?.status || null,
        siblingCredentialStatus: siblingDetail.credentialRecord?.status || null,
        timelineCount: credentialTimeline.timelineCount || credentialTimeline.timeline?.length || 0,
        siblingTimelineCount: siblingTimeline.timelineCount || siblingTimeline.timeline?.length || 0,
      },
      null,
      2
    )
  );
}

async function cleanupSmokeDomArtifacts() {
  await cleanupSmokeSecretIsolation({
    keychainAccount: smokeIsolationAccount,
    cleanupRoot: smokeDomRoot,
  });
}

async function flushSmokeDomStreams() {
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
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  try {
    await cleanupSmokeDomArtifacts();
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
  if (smokeDomDirectExecution) {
    await flushSmokeDomStreams();
    process.exit(process.exitCode ?? 0);
  }
}

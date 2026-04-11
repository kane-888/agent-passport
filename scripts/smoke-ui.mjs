import fs from "node:fs/promises";
import path from "node:path";
import { assert, sleep } from "./smoke-shared.mjs";
import { createSmokeLogger, localReasonerFixturePath, resolveBaseUrl, rootDir } from "./smoke-env.mjs";
import { createSmokeHttpClient } from "./smoke-ui-http.mjs";

const smokeCombined = process.env.SMOKE_COMBINED === "1";
const baseUrl = resolveBaseUrl();
const dataDir = path.join(rootDir, "data");
const expectedLedgerPath = process.env.OPENNEED_LEDGER_PATH || path.join(dataDir, "ledger.json");
const expectedArchiveDir = process.env.AGENT_PASSPORT_ARCHIVE_DIR || path.join(dataDir, "archives");
const LITE_RUNTIME_QUERY = "runtimeLimit=3&messageLimit=3&memoryLimit=3&authorizationLimit=3&credentialLimit=3";
const LITE_AGENT_CONTEXT_QUERY = `didMethod=agentpassport&${LITE_RUNTIME_QUERY}`;
const LITE_AGENT_CONTEXT_OPENNEED_QUERY = `didMethod=openneed&${LITE_RUNTIME_QUERY}`;
const LITE_REHYDRATE_QUERY = `didMethod=agentpassport&${LITE_RUNTIME_QUERY}`;
const traceSmoke = createSmokeLogger("smoke-ui");
const {
  authorizedFetch: baseAuthorizedFetch,
  drainResponse,
  fetchWithToken,
  getAdminToken,
  getText,
  publicGetJson,
  setAdminToken,
} = createSmokeHttpClient({
  baseUrl,
  rootDir,
  trace: traceSmoke,
});

async function authorizedFetch(resourcePath, options = {}) {
  let response = await baseAuthorizedFetch(resourcePath, options);
  if (response.status !== 401) {
    return response;
  }
  await drainResponse(response);
  setAdminToken(null);
  const refreshedToken = await getAdminToken();
  response = await fetchWithToken(resourcePath, refreshedToken, options);
  return response;
}

async function getJson(resourcePath) {
  let response;
  try {
    response = await authorizedFetch(resourcePath);
  } catch (error) {
    throw new Error(`${resourcePath} -> fetch failed: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`${resourcePath} -> HTTP ${response.status}`);
  }
  return response.json();
}

function includesAll(haystack, needles, label) {
  for (const needle of needles) {
    assert(haystack.includes(needle), `${label} 缺少标记：${needle}`);
  }
}

const guardedRunnerStatusesForMismatchedIdentity = new Set([
  "blocked",
  "bootstrap_required",
  "resident_locked",
  "rehydrate_required",
  "needs_human_review",
]);

function summarizeRunnerGateState(runnerEnvelope) {
  return {
    status: runnerEnvelope?.runner?.run?.status ?? null,
    verificationValid: runnerEnvelope?.runner?.verification?.valid ?? null,
    bootstrapRequired: runnerEnvelope?.runner?.bootstrapGate?.required ?? null,
    residentRequired: runnerEnvelope?.runner?.residentGate?.required ?? null,
    requiresRehydrate: runnerEnvelope?.runner?.driftCheck?.requiresRehydrate ?? null,
    requiresHumanReview: runnerEnvelope?.runner?.driftCheck?.requiresHumanReview ?? null,
    sandboxBlockedBy: runnerEnvelope?.runner?.sandboxExecution?.blockedBy ?? null,
    reasonerError: runnerEnvelope?.runner?.reasoner?.error ?? null,
    autoRecoveryStatus: runnerEnvelope?.runner?.autoRecovery?.status ?? null,
  };
}

function assertMismatchedIdentityRunnerGate(runnerEnvelope, label) {
  const status = runnerEnvelope?.runner?.run?.status ?? null;
  const gateState = summarizeRunnerGateState(runnerEnvelope);
  assert(
    status && guardedRunnerStatusesForMismatchedIdentity.has(status),
    `${label}：${JSON.stringify(gateState)}`
  );
  if (status === "blocked") {
    assert(runnerEnvelope?.runner?.verification?.valid === false, `${label} 应由 verification 失败拦截`);
    return;
  }
  if (status === "bootstrap_required") {
    assert(runnerEnvelope?.runner?.bootstrapGate?.required === true, `${label} 应返回 bootstrapGate.required`);
    return;
  }
  if (status === "resident_locked") {
    assert(runnerEnvelope?.runner?.residentGate?.required === true, `${label} 应返回 residentGate.required`);
    return;
  }
  if (status === "rehydrate_required") {
    assert(
      runnerEnvelope?.runner?.driftCheck?.requiresRehydrate === true ||
        runnerEnvelope?.runner?.sandboxExecution?.blockedBy === "rehydrate_required",
      `${label} 应返回 rehydrate gate 证据`
    );
    return;
  }
  assert(
    runnerEnvelope?.runner?.driftCheck?.requiresHumanReview === true ||
      Boolean(runnerEnvelope?.runner?.reasoner?.error) ||
      runnerEnvelope?.runner?.autoRecovery?.status === "human_review_required",
    `${label} 应返回 human review gate 证据`
  );
}

function repairTouchesAgent(repair, agentId) {
  const linkedSubjects = Array.isArray(repair?.linkedSubjects) ? repair.linkedSubjects : [];
  const linkedComparisons = Array.isArray(repair?.linkedComparisons) ? repair.linkedComparisons : [];
  return Boolean(
    repair?.issuerAgentId === agentId ||
      repair?.targetAgentId === agentId ||
      linkedSubjects.some(
        (entry) =>
          entry?.issuerAgentId === agentId ||
          (entry?.kind === "agent_identity" && entry?.subjectId === agentId)
      ) ||
      linkedComparisons.some((entry) => entry?.leftAgentId === agentId || entry?.rightAgentId === agentId)
  );
}

async function fetchWithTokenEventually(
  resourcePath,
  token,
  {
    attempts = 10,
    delayMs = 250,
    label = resourcePath,
    options = {},
    isReady = (response) => response.ok,
    trace = null,
    drainResponse = null,
  } = {}
) {
  let lastResponse = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchWithToken(resourcePath, token, options);
    if (await isReady(response)) {
      return response;
    }
    lastResponse = response;
    if (attempt >= attempts - 1) {
      return response;
    }
    trace?.(`${label} eventual retry ${attempt + 1} after HTTP ${response.status}`);
    if (typeof drainResponse === "function") {
      await drainResponse(response);
    }
    await sleep(delayMs * (attempt + 1));
  }
  return lastResponse;
}

async function getJsonEventually(
  resourcePath,
  {
    attempts = 10,
    delayMs = 250,
    label = resourcePath,
    isReady = () => true,
    trace = null,
  } = {}
) {
  let lastJson = null;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const json = await getJson(resourcePath);
      lastJson = json;
      if (await isReady(json)) {
        return json;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt >= attempts - 1) {
      break;
    }
    trace?.(`${label} eventual retry ${attempt + 1}${lastError ? ` after ${lastError.message}` : ""}`);
    await sleep(delayMs * (attempt + 1));
  }
  if (lastJson !== null) {
    return lastJson;
  }
  throw lastError || new Error(`${label} did not become ready`);
}

async function main() {
  const publicSecurity = await publicGetJson("/api/security");
  const health = await publicGetJson("/api/health");
  assert(health.ok === true, "health.ok 不是 true");
  assert(String(health.service || "").includes("OpenNeed"), "health.service 应返回当前公开名称");
  const protocol = await publicGetJson("/api/protocol");
  const security = await getJson("/api/security");
  assert(publicSecurity.authorized === false, "未带 token 的 /api/security 应返回 redacted 视图");
  assert(publicSecurity.localStore?.ledgerPath == null, "public /api/security 不应暴露 ledgerPath");
  assert(publicSecurity.apiWriteProtection?.tokenPath == null, "public /api/security 不应暴露 tokenPath");
  assert(
    publicSecurity.localStorageFormalFlow?.backupBundle?.latestBundle?.bundleId == null,
    "public /api/security 不应暴露 recovery bundle 标识"
  );
  assert(
    publicSecurity.localStorageFormalFlow?.backupBundle?.latestBundle?.residentAgentId == null,
    "public /api/security 不应暴露 recovery bundle residentAgentId"
  );
  assert(
    publicSecurity.localStorageFormalFlow?.setupPackage?.latestPackage?.packageId == null,
    "public /api/security 不应暴露 setup package 标识"
  );
  assert(
    publicSecurity.localStorageFormalFlow?.setupPackage?.latestPackage?.machineId == null,
    "public /api/security 不应暴露 setup package machineId"
  );
  const unauthorizedRead = await fetch(`${baseUrl}/api/device/runtime`);
  assert(unauthorizedRead.status === 401, "敏感 GET 接口默认应要求 admin token");
  await drainResponse(unauthorizedRead);
  assert(protocol.productPositioning?.tagline, "protocol 缺少 productPositioning.tagline");
  assert(protocol.mvp?.name, "protocol 缺少 mvp.name");
  assert(Array.isArray(protocol.documentation), "protocol 缺少 documentation");
  assert(protocol.securityArchitecture?.principles?.length >= 1, "protocol 缺少 securityArchitecture.principles");
  assert(Array.isArray(protocol.roadmap?.nextPhaseChecklist), "protocol 缺少 roadmap.nextPhaseChecklist");
  const roadmap = await publicGetJson("/api/roadmap");
  assert(security.hostBinding === "127.0.0.1" || security.hostBinding === "localhost", "服务默认应绑定本机 loopback");
  assert(security.authorized === true, "带 token 的 /api/security 应返回授权视图");
  assert(security.apiWriteProtection?.tokenRequired === true, "写接口默认应要求 admin token");
  assert(security.readProtection?.sensitiveGetRequiresToken === true, "敏感 GET 接口默认应要求 admin token");
  const advertisedReadScopes = new Set(
    Array.isArray(security.readProtection?.availableScopes) ? security.readProtection.availableScopes : []
  );
  assert(advertisedReadScopes.has("all"), "security.readProtection.availableScopes 缺少 all");
  assert(
    advertisedReadScopes.has("agents_transcript"),
    "security.readProtection.availableScopes 缺少 agents_transcript"
  );
  for (const role of Array.isArray(security.readProtection?.availableRoles)
    ? security.readProtection.availableRoles
    : []) {
    for (const scope of Array.isArray(role?.scopes) ? role.scopes : []) {
      assert(
        advertisedReadScopes.has(scope),
        `security.readProtection.availableScopes 缺少 role scope: ${role?.role || "unknown"} -> ${scope}`
      );
    }
  }
  assert(roadmap.productPositioning?.tagline, "roadmap 缺少 productPositioning.tagline");
  assert(roadmap.mvp?.summary, "roadmap 缺少 mvp.summary");
  assert(Array.isArray(roadmap.documentation), "roadmap 缺少 documentation");
  assert(roadmap.securityArchitecture?.knownGaps?.length >= 1, "roadmap 缺少 securityArchitecture.knownGaps");
  assert(security.securityPosture?.mode, "security 缺少 securityPosture.mode");
  assert(security.securityArchitecture?.trustBoundaries?.length >= 3, "security 缺少 securityArchitecture.trustBoundaries");
  assert(security.localStorageFormalFlow?.status, "security 缺少 localStorageFormalFlow.status");
  assert(security.localStorageFormalFlow?.runbook?.status, "security 缺少 localStorageFormalFlow.runbook.status");
  assert(security.localStorageFormalFlow?.operationalCadence?.status, "security 缺少 localStorageFormalFlow.operationalCadence.status");
  assert(security.constrainedExecution?.status, "security 缺少 constrainedExecution.status");
  assert(security.automaticRecovery?.status, "security 缺少 automaticRecovery.status");
  assert(security.automaticRecovery?.operatorBoundary?.summary, "security 缺少 automaticRecovery.operatorBoundary.summary");
  assert(security.anomalyAudit?.counts, "security 缺少 anomalyAudit.counts");
  includesAll(
    await getText("/"),
    [
      "OpenNeed 记忆稳态引擎公开运行态",
      "runtime-home-summary",
      "runtime-health-summary",
      "runtime-health-detail",
      "runtime-recovery-summary",
      "runtime-recovery-detail",
      "runtime-automation-summary",
      "runtime-automation-detail",
      "runtime-trigger-list",
      "runtime-link-list",
      "/api/security",
      "/api/health",
      "/offline-chat",
      "/lab.html",
      "/repair-hub",
    ],
    "公开运行态 HTML"
  );
  const labHeadResponse = await fetch(`${baseUrl}/lab.html`, {
    method: "HEAD",
    headers: {
      Connection: "close",
    },
  });
  assert(labHeadResponse.status === 200, "HEAD /lab.html 应返回 200");
  assert(
    String(labHeadResponse.headers.get("content-type") || "").includes("text/html"),
    "HEAD /lab.html 应返回 text/html"
  );
  const labHtml = await getText("/lab.html");
  includesAll(
    labHtml,
    [
      "runtime-housekeeping-form",
      "runtime-housekeeping-audit",
      "runtime-housekeeping-apply",
      "OpenNeed 运行现场与受保护工具",
    ],
    "高级工具页 HTML"
  );
  const offlineChatBootstrap = await publicGetJson("/api/offline-chat/bootstrap");
  assert(
    Array.isArray(offlineChatBootstrap.personas) && offlineChatBootstrap.personas.length >= 1,
    "offline chat bootstrap 应返回 persona 列表"
  );
  const offlineGroupThread = Array.isArray(offlineChatBootstrap.threads)
    ? offlineChatBootstrap.threads.find((entry) => entry.threadId === "group")
    : null;
  assert(offlineGroupThread?.threadKind === "group", "offline chat bootstrap 应返回 group 线程");
  assert(
    Array.isArray(offlineGroupThread?.participants) &&
      offlineGroupThread.participants.length === offlineChatBootstrap.personas.length,
    "offline chat group participants 应与 runtime persona 数量一致"
  );
  assert(
    Number(offlineGroupThread?.memberCount || 0) === offlineGroupThread.participants.length,
    "offline chat group memberCount 应与 participants 数量一致"
  );
  const offlineGroupParticipantNames = offlineGroupThread.participants
    .map((entry) => String(entry?.displayName || "").trim())
    .filter(Boolean);
  assert(
    offlineGroupParticipantNames.length === offlineChatBootstrap.personas.length,
    "offline chat group participants 应全部带 displayName"
  );
  assert(
    offlineChatBootstrap.personas.every((persona) =>
      offlineGroupParticipantNames.includes(String(persona?.displayName || "").trim())
    ),
    "offline chat group participants 应与 runtime persona 名单一致"
  );
  assert(offlineChatBootstrap.threadStartup?.phase_1?.ok === true, "offline chat bootstrap 应返回 phase_1 thread startup context");
  const offlineThreadStartupPhase1 = await publicGetJson("/api/offline-chat/thread-startup-context?phase=phase_1");
  assert(offlineThreadStartupPhase1?.ok === true, "offline chat thread startup context phase_1 应返回 ok");
  assert(offlineThreadStartupPhase1?.phaseKey === "phase_1", "offline chat thread startup context 应返回正确 phaseKey");
  assert(String(offlineThreadStartupPhase1?.title || "").includes("OpenNeed"), "offline chat thread startup context 应使用公开名称");
  assert(offlineThreadStartupPhase1?.threadId === "group", "offline chat thread startup context 应绑定 group 线程");
  assert(offlineThreadStartupPhase1?.groupThread?.threadId === "group", "offline chat thread startup context 应返回 groupThread");
  assert(
    Number(offlineThreadStartupPhase1?.groupThread?.memberCount || 0) === offlineGroupThread.participants.length,
    "offline chat thread startup context memberCount 应与 participants 数量一致"
  );
  assert(
    Number(offlineThreadStartupPhase1?.coreParticipantCount || 0) +
      Number(offlineThreadStartupPhase1?.supportParticipantCount || 0) ===
      offlineChatBootstrap.personas.length,
    "offline chat thread startup context 参与人数应与 persona 总数一致"
  );
  assert(
    Array.isArray(offlineThreadStartupPhase1?.coreParticipants) &&
      offlineThreadStartupPhase1.coreParticipants.some((entry) => entry?.role === "master-orchestrator-agent"),
    "offline chat thread startup context 应包含主控 Agent"
  );
  assert(
    Array.isArray(offlineThreadStartupPhase1?.recommendedSequence) && offlineThreadStartupPhase1.recommendedSequence.length >= 1,
    "offline chat thread startup context 应返回推荐协作顺序"
  );
  assert(
    Array.isArray(offlineThreadStartupPhase1?.rules) && offlineThreadStartupPhase1.rules.length >= 1,
    "offline chat thread startup context 应返回协作规则"
  );
  assert(
    String(offlineThreadStartupPhase1?.intent || "").includes(
      `${offlineThreadStartupPhase1?.coreParticipantCount || 0} 个工作角色`
    ),
    "offline chat thread startup context intent 应跟随当前核心角色数量"
  );
  assert(
    String(offlineThreadStartupPhase1?.intent || "").includes(
      `${offlineThreadStartupPhase1?.supportParticipantCount || 0} 个支持角色`
    ),
    "offline chat thread startup context intent 应跟随当前支持角色数量"
  );
  assert(
    Number(offlineThreadStartupPhase1?.coreParticipantCount || 0) ===
      Number(offlineChatBootstrap.threadStartup?.phase_1?.coreParticipantCount || 0),
    "offline chat thread startup route 应与 bootstrap 返回相同 coreParticipantCount"
  );
  assert(
    Number(offlineThreadStartupPhase1?.supportParticipantCount || 0) ===
      Number(offlineChatBootstrap.threadStartup?.phase_1?.supportParticipantCount || 0),
    "offline chat thread startup route 应与 bootstrap 返回相同 supportParticipantCount"
  );
  const unsupportedThreadStartupResponse = await fetch(
    `${baseUrl}/api/offline-chat/thread-startup-context?phase=phase_unknown`,
    {
      headers: {
        Connection: "close",
      },
    }
  );
  assert(unsupportedThreadStartupResponse.status === 404, "unsupported thread startup phase 应返回 404");
  const unsupportedThreadStartup = await unsupportedThreadStartupResponse.json();
  assert(
    unsupportedThreadStartup?.error === "unsupported_thread_startup_phase",
    "unsupported thread startup phase 应返回明确错误码"
  );
  assert(
    Array.isArray(unsupportedThreadStartup?.supportedPhases) &&
      unsupportedThreadStartup.supportedPhases.includes("phase_1"),
    "unsupported thread startup phase 应返回 supportedPhases"
  );
  if (smokeCombined) {
    const agentContext = await getJson(`/api/agents/agent_openneed_agents/context?${LITE_AGENT_CONTEXT_QUERY}`);
    assert(agentContext.context?.agent?.agentId === "agent_openneed_agents", "combined agent context 异常");
    const runtime = await getJson(`/api/agents/agent_openneed_agents/runtime?${LITE_AGENT_CONTEXT_QUERY}`);
    assert(runtime.runtime?.taskSnapshot?.snapshotId, "combined runtime 缺少 taskSnapshot.snapshotId");
    const localReasonerCatalog = await getJson("/api/device/runtime/local-reasoner/catalog");
    assert(Array.isArray(localReasonerCatalog.providers), "local reasoner catalog 缺少 providers 数组");
    const localReasonerProbeResponse = await authorizedFetch("/api/device/runtime/local-reasoner/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "local_command",
        command: process.execPath,
        args: [localReasonerFixturePath],
        cwd: rootDir,
      }),
    });
    assert(localReasonerProbeResponse.ok, "local reasoner probe HTTP 请求失败");
    const localReasonerProbe = await localReasonerProbeResponse.json();
    const localReasonerSelectResponse = await authorizedFetch("/api/device/runtime/local-reasoner/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "local_command",
        enabled: true,
        command: process.execPath,
        args: [localReasonerFixturePath],
        cwd: rootDir,
        dryRun: false,
      }),
    });
    assert(localReasonerSelectResponse.ok, "local reasoner select HTTP 请求失败");
    const localReasonerSelect = await localReasonerSelectResponse.json();
    const localReasonerPrewarmResponse = await authorizedFetch("/api/device/runtime/local-reasoner/prewarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: false,
      }),
    });
    assert(localReasonerPrewarmResponse.ok, "local reasoner prewarm HTTP 请求失败");
    const localReasonerPrewarm = await localReasonerPrewarmResponse.json();
    const rehydrate = await getJson(`/api/agents/agent_openneed_agents/runtime/rehydrate?${LITE_REHYDRATE_QUERY}`);
    assert(typeof rehydrate.rehydrate?.prompt === "string", "rehydrate.prompt 缺失");
    const bootstrapResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runtime/bootstrap?didMethod=agentpassport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "沈知远",
        role: "CEO",
        longTermGoal: "让 OpenNeed 记忆稳态引擎成为本地 runtime 底座",
        currentGoal: "预览 bootstrap 是否能建立最小冷启动包",
        currentPlan: ["写 profile", "写 snapshot", "验证 runner"],
        nextAction: "执行 verification run",
        maxRecentConversationTurns: 5,
        maxToolResults: 4,
        maxQueryIterations: 3,
        claimResidentAgent: true,
        dryRun: true,
      }),
    });
    assert(bootstrapResponse.ok, "bootstrap HTTP 请求失败");
    const bootstrap = await bootstrapResponse.json();
    const minuteToken = `smoke-ui-combined-${Date.now()}`;
    const minuteResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runtime/minutes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Smoke UI Combined ${minuteToken}`,
        summary: `Combined runtime search probe ${minuteToken}`,
        transcript: [`combined token ${minuteToken}`, "rehydrate -> runtime search -> runner"].join("\n"),
        highlights: ["combined", minuteToken],
        sourceWindowId: "window_smoke_ui",
        recordedByWindowId: "window_smoke_ui",
        recordedByAgentId: "agent_openneed_agents",
      }),
    });
    assert(minuteResponse.ok, "conversation minute HTTP 请求失败");
    const minuteResult = await minuteResponse.json();
    const runtimeSearch = await getJson(
      `/api/agents/agent_openneed_agents/runtime/search?didMethod=agentpassport&sourceType=conversation_minute&limit=5&query=${encodeURIComponent(minuteToken)}`
    );
    assert(Array.isArray(runtimeSearch.hits), "runtime search 没有 hits 数组");
    const contextBuilderResponse = await authorizedFetch("/api/agents/agent_openneed_agents/context-builder?didMethod=agentpassport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentGoal: "验证 combined context builder",
        query: minuteToken,
        recentConversationTurns: [
          { role: "user", content: "不要从整段历史里猜身份" },
          { role: "assistant", content: "上下文按槽位重建" },
        ],
      }),
    });
    assert(contextBuilderResponse.ok, "context-builder HTTP 请求失败");
    const contextBuilder = await contextBuilderResponse.json();
    const runnerResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runner?didMethod=agentpassport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentGoal: "验证 combined runner",
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
      }),
    });
    assert(runnerResponse.ok, "runner HTTP 请求失败");
    const runner = await runnerResponse.json();
    assertMismatchedIdentityRunnerGate(runner, "combined runner 状态异常");
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "combined",
          baseUrl,
          hostBinding: security.hostBinding,
          localReasonerSelectedProvider: localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.provider || null,
          localReasonerPrewarmStatus: localReasonerPrewarm.warmState?.status || null,
          runtimeSnapshotId: runtime.runtime?.taskSnapshot?.snapshotId || null,
          rehydratePackHash: rehydrate.rehydrate?.packHash || null,
          bootstrapDryRun: bootstrap.bootstrap?.dryRun || false,
          bootstrapProfileWrites: bootstrap.bootstrap?.summary?.profileWriteCount || 0,
          conversationMinuteId: minuteResult.minute?.minuteId || null,
          runtimeSearchHits: runtimeSearch.hits.length || 0,
          contextBuilderLocalKnowledgeHits:
            contextBuilder.contextBuilder?.localKnowledge?.hits?.length ||
            contextBuilder.contextBuilder?.slots?.localKnowledgeHits?.length ||
            0,
          runnerStatus: runner.runner?.run?.status || null,
          combinedChecks: [
            "security",
            "html_contract",
            "agent_context",
            "runtime",
            "local_reasoner",
            "rehydrate",
            "bootstrap",
            "runtime_search",
            "context_builder",
            "runner",
          ],
        },
        null,
        2
      )
    );
    return;
  }
  let readSessionList = { sessions: [] };
  {
    const securityProbeStartedAt = new Date(Date.now() - 1000).toISOString();
    const keyManagementAnomaliesBefore = await getJson("/api/security/anomalies?limit=5&category=key_management");
    const previousRotationAnomalyId = keyManagementAnomaliesBefore.anomalies?.[0]?.anomalyId || null;
    const postureReadOnlyResponse = await authorizedFetch("/api/security/posture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "read_only",
      reason: "smoke-ui posture probe",
      note: "verify read_only write lock",
    }),
  });
  assert(postureReadOnlyResponse.ok, "切换 read_only posture 失败");
    const postureReadOnly = await postureReadOnlyResponse.json();
    assert(postureReadOnly.securityPosture?.mode === "read_only", "security posture 未切到 read_only");
    const blockedWriteInReadOnly = await authorizedFetch("/api/device/runtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      residentAgentId: "agent_openneed_agents",
      dryRun: true,
    }),
  });
  assert(
    blockedWriteInReadOnly.status === 423,
    `read_only posture 下普通写接口应返回 423，实际为 ${blockedWriteInReadOnly.status}`
    );
    await drainResponse(blockedWriteInReadOnly);
    const postureDisableExecResponse = await authorizedFetch("/api/security/posture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "disable_exec",
      reason: "smoke-ui posture probe",
      note: "verify execution lock",
    }),
  });
    assert(postureDisableExecResponse.ok, "切换 disable_exec posture 失败");
    const blockedExecResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runtime/actions?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sandboxAction: {
        capability: "runtime_search",
        query: "security posture probe",
      },
    }),
  });
  assert(
    blockedExecResponse.status === 423,
    `disable_exec posture 下执行入口应返回 423，实际为 ${blockedExecResponse.status}`
    );
    await drainResponse(blockedExecResponse);
    const posturePanicResponse = await authorizedFetch("/api/security/posture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "panic",
      reason: "smoke-ui posture probe",
      note: "verify panic lock",
    }),
  });
    assert(posturePanicResponse.ok, "切换 panic posture 失败");
    const blockedWriteInPanic = await authorizedFetch("/api/device/setup/package", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dryRun: true,
      saveToFile: false,
    }),
  });
    assert(blockedWriteInPanic.status === 423, "panic posture 下普通写接口应返回 423");
    await drainResponse(blockedWriteInPanic);
    const postureNormalResponse = await authorizedFetch("/api/security/posture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "normal",
      reason: "smoke-ui posture reset",
      note: "restore normal runtime",
    }),
  });
    assert(postureNormalResponse.ok, "恢复 normal posture 失败");
    const postureNormal = await postureNormalResponse.json();
    assert(postureNormal.securityPosture?.mode === "normal", "security posture 未恢复到 normal");
    const tokenBeforeRotation = await getAdminToken();
    const rotationSessionCreateResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-rotation-pre-session",
      role: "runtime_observer",
      ttlSeconds: 600,
      note: "rotation should revoke or invalidate this token later",
    }),
  });
    assert(rotationSessionCreateResponse.ok, "rotation 前创建 read session 失败");
    const rotationSession = await rotationSessionCreateResponse.json();
    const rotateResponse = await authorizedFetch("/api/security/admin-token/rotate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      revokeReadSessions: false,
      note: "smoke-ui rotation",
    }),
  });
    assert(rotateResponse.ok, "admin token 轮换失败");
    const rotation = await rotateResponse.json();
    if (rotation.rotation?.rotated) {
      assert(rotation.rotation.token, "admin token 轮换后应返回新 token");
      const oldTokenRuntimeRead = await fetchWithToken("/api/device/runtime", tokenBeforeRotation);
      assert(oldTokenRuntimeRead.status === 401, "旧 admin token 轮换后应失效");
      await drainResponse(oldTokenRuntimeRead);
      setAdminToken(rotation.rotation.token);
      const postRotationSecurity = await getJson("/api/security");
      assert(postRotationSecurity.authorized === true, "新 admin token 应继续可用");
      const preRevokeRead = await fetchWithToken("/api/device/runtime", rotationSession.token);
      assert(preRevokeRead.ok, "rotation 未撤销 read sessions 时，旧 read session 应暂时仍可读");
      await drainResponse(preRevokeRead);
    } else {
      assert(rotation.rotation?.reason === "env_managed", "未轮换时只应因为 env 管理而跳过");
    }
    const revokeAllResponse = await authorizedFetch("/api/security/read-sessions/revoke-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "smoke-ui revoke all",
      dryRun: false,
      revokedByReadSessionId: "spoofed_revoker",
    }),
  });
    assert(revokeAllResponse.ok, "全量撤销 read sessions 失败");
    const revokeAll = await revokeAllResponse.json();
    assert(Number(revokeAll.revokedCount || 0) >= 1, "全量撤销 read sessions 应至少撤销 1 个会话");
    assert(
      revokeAll.sessions?.find((entry) => entry.readSessionId === rotationSession.session?.readSessionId)
        ?.revokedByReadSessionId == null,
      "admin revoke-all 不应接受伪造 revokedByReadSessionId"
    );
    const revokedRotationSessionRead = await fetchWithToken("/api/device/runtime", rotationSession.token);
    assert(revokedRotationSessionRead.status === 401, "revoke-all 后旧 read session 应失效");
    await drainResponse(revokedRotationSessionRead);
    const securityAnomalies = await getJsonEventually(
    `/api/security/anomalies?limit=100&category=security&createdAfter=${encodeURIComponent(securityProbeStartedAt)}`,
    {
      label: "security anomalies after posture probes",
      trace: traceSmoke,
      isReady: (json) =>
        Array.isArray(json?.anomalies) &&
        json.anomalies.some((entry) => entry.code === "write_blocked_by_security_posture") &&
        json.anomalies.some((entry) => entry.code === "execution_blocked_by_security_posture"),
    }
    );
    const keyManagementAnomalies = await getJsonEventually(
    "/api/security/anomalies?limit=50&category=key_management",
    {
      label: "key management anomalies after token rotation",
      trace: traceSmoke,
      isReady: (json) =>
        rotation.rotation?.rotated !== true ||
        (Array.isArray(json?.anomalies) &&
          json.anomalies[0]?.anomalyId !== previousRotationAnomalyId &&
          json.anomalies[0]?.code === "admin_token_rotated"),
    }
    );
    assert(Array.isArray(securityAnomalies.anomalies), "security anomalies 缺少 anomalies 数组");
    assert(Array.isArray(keyManagementAnomalies.anomalies), "key management anomalies 缺少 anomalies 数组");
    assert(
    securityAnomalies.anomalies.some((entry) => entry.code === "write_blocked_by_security_posture"),
    "security anomalies 应记录 write_blocked_by_security_posture"
    );
    assert(
    securityAnomalies.anomalies.some((entry) => entry.code === "execution_blocked_by_security_posture"),
    "security anomalies 应记录 execution_blocked_by_security_posture"
    );
    assert(
    rotation.rotation?.rotated !== true ||
      (Array.isArray(keyManagementAnomalies.anomalies) &&
        keyManagementAnomalies.anomalies[0]?.anomalyId !== previousRotationAnomalyId &&
        keyManagementAnomalies.anomalies[0]?.code === "admin_token_rotated"),
    "security anomalies 应记录 admin_token_rotated"
    );
    assert(security.localStore?.ledgerPath, "security 缺少 localStore.ledgerPath");
    assert(
      security.localStore?.ledgerPath === expectedLedgerPath,
      "security.localStore.ledgerPath 应返回当前生效的 ledger 路径"
    );
    assert(security.localStore?.recoveryDir, "security 缺少 localStore.recoveryDir");
    assert(
      security.localStore?.encryptedAtRest === (security.localStorageFormalFlow?.storeEncryption?.status === "protected"),
      "security.localStore.encryptedAtRest 应反映当前加密真值"
    );
    assert(
      security.localStore?.systemProtected ===
        (security.localStorageFormalFlow?.storeEncryption?.systemProtected == null
          ? null
          : Boolean(security.localStorageFormalFlow.storeEncryption.systemProtected)),
      "security.localStore.systemProtected 应与 formal recovery 真值一致"
    );
    assert(
      security.localStore?.recoveryBaselineReady === Boolean(security.localStorageFormalFlow?.durableRestoreReady),
      "security.localStore.recoveryBaselineReady 应与 formal recovery readiness 一致"
    );
    assert(
      security.localStore?.keyPath ===
        (security.keyManagement?.storeKey?.source === "file_record" ? security.keyManagement.storeKey.keyPath || null : null),
      "security.localStore.keyPath 只应在文件回退生效时返回"
    );
    assert(security.keyManagement?.storeKey?.source, "security 缺少 keyManagement.storeKey.source");
    assert(security.keyManagement?.signingKey?.source, "security 缺少 keyManagement.signingKey.source");
    assert(
    roadmap.roadmap?.nextPhaseChecklist?.some((item) => item.id === "local-store-encryption"),
    "roadmap 缺少本地存储加密实施项"
    );
    assert(
    roadmap.roadmap?.nextPhaseChecklist?.some((item) => item.id === "risk-tier-policy"),
    "roadmap 缺少风险分级实施项"
    );
    const readSessionCreateResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-parent",
      role: "security_delegate",
      ttlSeconds: 600,
      note: "smoke-ui parent scope probe",
    }),
  });
    assert(readSessionCreateResponse.ok, "创建 read session 失败");
    const readSessionCreate = await readSessionCreateResponse.json();
    assert(readSessionCreate.session?.readSessionId, "read session 缺少 readSessionId");
    assert(readSessionCreate.token, "read session 创建后应返回一次性 token");
    assert(readSessionCreate.session?.role === "security_delegate", "root read session 应返回 security_delegate 角色");
    assert(readSessionCreate.session?.viewTemplates?.deviceRuntime === "metadata_only", "security_delegate 应返回默认 deviceRuntime view template");
    const delegatedSecurityRead = await fetchWithToken("/api/security", readSessionCreate.token);
    assert(delegatedSecurityRead.ok, "security_delegate 应允许读取 /api/security");
    const delegatedSecurityJson = await delegatedSecurityRead.json();
    assert(delegatedSecurityJson.authorizedAs === "read_session", "delegated /api/security 应标记为 read_session");
    assert(delegatedSecurityJson.localStore?.ledgerPath == null, "read_session 读取 /api/security 不应看到本地 ledgerPath");
    assert(
      delegatedSecurityJson.localStorageFormalFlow?.setupPackage?.latestPackage?.packageId == null,
      "read_session 读取 /api/security 不应看到 setup package 标识"
    );
    assert(
      delegatedSecurityJson.localStorageFormalFlow?.backupBundle?.latestBundle?.bundleId == null,
      "read_session 读取 /api/security 不应看到 recovery bundle 标识"
    );
    const delegatedHousekeepingRead = await fetchWithTokenEventually(
      "/api/security/runtime-housekeeping?keepRecovery=1&keepSetup=1",
      readSessionCreate.token,
      {
        label: "security_delegate /api/security/runtime-housekeeping",
        trace: traceSmoke,
        drainResponse,
      }
    );
    assert(delegatedHousekeepingRead.ok, "security_delegate 应允许读取 runtime-housekeeping 审计视图");
    const delegatedHousekeepingJson = await delegatedHousekeepingRead.json();
    assert(delegatedHousekeepingJson.paths?.liveLedgerPath == null, "read_session 读取 housekeeping 不应看到 liveLedgerPath");
    assert(delegatedHousekeepingJson.paths?.archiveDir == null, "read_session 读取 housekeeping 不应看到 archiveDir");
    assert(
      Array.isArray(delegatedHousekeepingJson.archives?.directories) &&
        delegatedHousekeepingJson.archives.directories.every((entry) => entry.path == null),
      "read_session 读取 housekeeping 时 archive path 应被 redacted"
    );
  const delegatedReadSessionResponse = await fetchWithToken("/api/security/read-sessions", readSessionCreate.token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-device-runtime-child",
      role: "runtime_observer",
      ttlSeconds: 1200,
      note: "smoke-ui delegated child session",
      createdByAgentId: "agent_spoofed",
      createdByWindowId: "window_spoofed",
    }),
  });
    assert(delegatedReadSessionResponse.ok, "read session 派生 child session 失败");
    const delegatedReadSession = await delegatedReadSessionResponse.json();
    assert(delegatedReadSession.session?.readSessionId, "delegated child read session 缺少 readSessionId");
    assert(delegatedReadSession.session?.parentReadSessionId === readSessionCreate.session.readSessionId, "delegated child read session 应记录 parentReadSessionId");
    assert(delegatedReadSession.session?.lineageDepth === 1, "delegated child read session lineageDepth 应为 1");
    assert(delegatedReadSession.session?.role === "runtime_observer", "delegated child read session 应返回 runtime_observer 角色");
    assert(
      delegatedReadSession.session?.createdByReadSessionId === readSessionCreate.session.readSessionId,
      "delegated child read session 应记录真实 createdByReadSessionId"
    );
    assert(
      delegatedReadSession.session?.createdByAgentId == null,
      "delegated child read session 不应接受伪造 createdByAgentId"
    );
    assert(
      delegatedReadSession.session?.createdByWindowId == null,
      "delegated child read session 不应接受伪造 createdByWindowId"
    );
    assert(delegatedReadSession.session?.viewTemplates?.deviceRuntime === "summary_only", "runtime_observer 应返回 summary_only deviceRuntime view template");
    const invalidDelegatedReadSessionResponse = await fetchWithToken("/api/security/read-sessions", readSessionCreate.token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-invalid-child",
      role: "window_observer",
      ttlSeconds: 1200,
      note: "should fail because role exceeds parent scope",
    }),
  });
    assert(invalidDelegatedReadSessionResponse.status >= 400, "超出父 role 范围的 child session 不应创建成功");
    await drainResponse(invalidDelegatedReadSessionResponse);
    const scopedRuntimeRead = await fetchWithTokenEventually("/api/device/runtime", delegatedReadSession.token, {
    label: "runtime_observer /api/device/runtime",
    trace: traceSmoke,
    drainResponse,
  });
    assert(scopedRuntimeRead.ok, "device_runtime scope 应允许读取 /api/device/runtime");
    const scopedRuntimeJson = await scopedRuntimeRead.json();
    assert(scopedRuntimeJson.deviceRuntime?.deviceRuntimeId, "scoped runtime read 缺少 deviceRuntimeId");
    assert(scopedRuntimeJson.deviceRuntime?.constrainedExecutionPolicy?.maxReadBytes != null, "scoped runtime read 应返回 constrainedExecutionPolicy alias");
    assert(
    Array.isArray(scopedRuntimeJson.deviceRuntime?.sandboxPolicy?.filesystemAllowlist) &&
      scopedRuntimeJson.deviceRuntime.sandboxPolicy.filesystemAllowlist.length === 0,
    "read_session 读取 /api/device/runtime 时 filesystemAllowlist 应被 redacted"
    );
    assert(
    Number(scopedRuntimeJson.deviceRuntime?.sandboxPolicy?.filesystemAllowlistCount || 0) >= 1,
    "read_session 读取 /api/device/runtime 时应返回 filesystemAllowlistCount"
    );
    const scopedSetupRead = await fetchWithTokenEventually("/api/device/setup", delegatedReadSession.token, {
    label: "runtime_observer /api/device/setup",
    trace: traceSmoke,
    drainResponse,
  });
    assert(scopedSetupRead.ok, "device_runtime scope 应允许读取 /api/device/setup");
    const scopedSetupJson = await scopedSetupRead.json();
    assert(Array.isArray(scopedSetupJson.checks), "summary-only setup 仍应返回 checks 数组");
    assert(scopedSetupJson.checks.every((entry) => Object.keys(entry).every((key) => ["code", "required", "passed", "message"].includes(key))), "summary-only setup checks 应只保留基础字段");
    assert(scopedSetupJson.setupPolicy?.requireRecentRecoveryRehearsal === true, "summary-only setup 应返回 setupPolicy");
    const deniedRecoveryRead = await fetchWithToken("/api/device/runtime/recovery?limit=3", delegatedReadSession.token);
    assert(deniedRecoveryRead.status === 401, "runtime_observer 不应读取 recovery 列表");
    await drainResponse(deniedRecoveryRead);
    const recoveryReadSessionResponse = await fetchWithToken("/api/security/read-sessions", readSessionCreate.token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-recovery-child",
      role: "recovery_observer",
      ttlSeconds: 600,
      note: "recovery scope probe",
    }),
  });
    assert(recoveryReadSessionResponse.ok, "security_delegate 应允许派生 recovery_observer");
    const recoveryReadSession = await recoveryReadSessionResponse.json();
    const delegatedRecoveryRead = await fetchWithTokenEventually("/api/device/runtime/recovery?limit=3", recoveryReadSession.token, {
    label: "recovery_observer /api/device/runtime/recovery",
    trace: traceSmoke,
    drainResponse,
  });
    assert(delegatedRecoveryRead.ok, "recovery_observer 应允许读取 recovery 列表");
    const delegatedRecoveryJson = await delegatedRecoveryRead.json();
    assert(delegatedRecoveryJson.recoveryDir == null, "read_session 读取 recovery 列表时不应看到 recoveryDir");
    assert(Array.isArray(delegatedRecoveryJson.bundles), "delegated recovery list 应返回 bundles");
    assert(delegatedRecoveryJson.bundles.every((bundle) => bundle.bundlePath == null), "delegated recovery list 不应暴露 bundlePath");
    const deniedScopedRead = await fetchWithToken("/api/windows", delegatedReadSession.token);
    assert(deniedScopedRead.status === 401, "device_runtime scope 不应读取 /api/windows");
    await drainResponse(deniedScopedRead);
    const revokeReadSessionResponse = await authorizedFetch(
    `/api/security/read-sessions/${encodeURIComponent(readSessionCreate.session.readSessionId)}/revoke`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revokedByAgentId: "agent_openneed_agents",
        revokedByReadSessionId: "spoofed_revoker",
      }),
    }
    );
    assert(revokeReadSessionResponse.ok, "撤销 read session 失败");
    const revokedReadSession = await revokeReadSessionResponse.json();
    assert(
      revokedReadSession.session?.revokedByReadSessionId == null,
      "admin revoke 不应接受伪造 revokedByReadSessionId"
    );
    readSessionList = await getJson("/api/security/read-sessions?includeExpired=true&includeRevoked=true");
    assert(Array.isArray(readSessionList.sessions), "read session 列表应返回 sessions 数组");
    assert(
    readSessionList.sessions.some((entry) => entry.readSessionId === readSessionCreate.session.readSessionId),
    "read session 列表应包含刚刚创建的会话"
    );
    assert(
    readSessionList.sessions.some(
      (entry) =>
        entry.readSessionId === delegatedReadSession.session.readSessionId &&
        entry.parentReadSessionId === readSessionCreate.session.readSessionId
    ),
    "read session 列表应包含 delegated child session 的 lineage 信息"
    );
    const revokedScopedRead = await fetchWithToken("/api/device/runtime", delegatedReadSession.token);
    assert(revokedScopedRead.status === 401, "父 read session 被撤销后，child read session 不应继续读取受保护 GET");
    await drainResponse(revokedScopedRead);

    const agentAuditorSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-agent-auditor",
      role: "agent_auditor",
      agentIds: ["agent_openneed_agents"],
      ttlSeconds: 600,
      note: "agent / runtime / credential redaction probe",
    }),
  });
    assert(agentAuditorSessionResponse.ok, "创建 agent_auditor read session 失败");
    const agentAuditorSession = await agentAuditorSessionResponse.json();
    const agentAuditorToken = agentAuditorSession.token;
    assert(agentAuditorToken, "agent_auditor token 缺失");
    assert(
    Array.isArray(agentAuditorSession.session?.resourceBindings?.agentIds) &&
      agentAuditorSession.session.resourceBindings.agentIds.includes("agent_openneed_agents"),
    "agent_auditor read session 应记录 agent 资源绑定"
    );

    const auditorContextResponse = await fetchWithTokenEventually(
    `/api/agents/agent_openneed_agents/context?${LITE_AGENT_CONTEXT_QUERY}`,
    agentAuditorToken,
    {
      label: "agent_auditor /api/agents/:id/context",
      trace: traceSmoke,
      drainResponse,
    }
  );
    assert(auditorContextResponse.ok, "agent_auditor 应允许读取 agent context");
    const auditorContextJson = await auditorContextResponse.json();
    assert(Array.isArray(auditorContextJson.context?.memories), "agent context 缺少 memories");
    assert(
    auditorContextJson.context.memories.every((entry) => entry.content == null),
    "read_session 读取 agent context 时 memories.content 应被 redacted"
  );
  assert(
    auditorContextJson.context.runtime?.taskSnapshot == null ||
      auditorContextJson.context.runtime.taskSnapshot.objective == null,
    "read_session 读取 runtime.taskSnapshot 时 objective 应被 redacted"
  );
  assert(
    Array.isArray(auditorContextJson.context.credentials) &&
      auditorContextJson.context.credentials.every((entry) => entry.proofValue == null),
    "read_session 读取 context.credentials 时 proofValue 应被 redacted"
  );

    const auditorMessagesResponse = await fetchWithToken("/api/agents/agent_openneed_agents/messages?limit=5", agentAuditorToken);
  assert(auditorMessagesResponse.ok, "agent_auditor 应允许读取 message metadata");
  const auditorMessagesJson = await auditorMessagesResponse.json();
  assert(
    [...(auditorMessagesJson.inbox || []), ...(auditorMessagesJson.outbox || [])].every((entry) => entry.content == null),
    "read_session 读取 messages 时 content 应被 redacted"
  );

    const auditorRuntimeSearchResponse = await fetchWithToken(
    "/api/agents/agent_openneed_agents/runtime/search?didMethod=agentpassport&query=smoke-ui-local-knowledge&limit=5",
    agentAuditorToken
  );
  assert(auditorRuntimeSearchResponse.ok, "agent_auditor 应允许读取 runtime search");
  const auditorRuntimeSearchJson = await auditorRuntimeSearchResponse.json();
  assert(
    Array.isArray(auditorRuntimeSearchJson.hits) &&
      auditorRuntimeSearchJson.hits.every((entry) => entry.content == null && entry.uri == null),
    "read_session 读取 runtime search 时内容字段应被 redacted"
  );

    const auditorCredentialsResponse = await fetchWithToken("/api/credentials?agentId=agent_openneed_agents&limit=3", agentAuditorToken);
  assert(auditorCredentialsResponse.ok, "agent_auditor 应允许读取 credentials 列表");
  const auditorCredentialsJson = await auditorCredentialsResponse.json();
  assert(
    Array.isArray(auditorCredentialsJson.credentials) &&
      auditorCredentialsJson.credentials.every((entry) => entry.proofValue == null),
    "read_session 读取 credential 列表时 proofValue 应被 redacted"
  );
    const firstCredentialId =
    auditorCredentialsJson.credentials?.[0]?.credentialRecordId ||
    auditorCredentialsJson.credentials?.[0]?.credentialId ||
    null;
    if (firstCredentialId) {
    const auditorCredentialDetailResponse = await fetchWithToken(`/api/credentials/${encodeURIComponent(firstCredentialId)}`, agentAuditorToken);
    assert(auditorCredentialDetailResponse.ok, "agent_auditor 应允许读取 credential detail");
    const auditorCredentialDetailJson = await auditorCredentialDetailResponse.json();
    assert(
      auditorCredentialDetailJson.credentialRecord?.proofValue == null,
      "read_session 读取 credential detail 时 credentialRecord.proofValue 应被 redacted"
    );
    assert(
      auditorCredentialDetailJson.credential?.proof?.proofValue == null,
      "read_session 读取 credential detail 时 raw credential proofValue 应被 redacted"
    );
  }

    const auditorRehydrateResponse = await fetchWithToken(
    `/api/agents/agent_openneed_agents/runtime/rehydrate?${LITE_REHYDRATE_QUERY}`,
    agentAuditorToken
  );
  assert(auditorRehydrateResponse.ok, "agent_auditor 应允许读取 rehydrate pack");
  const auditorRehydrateJson = await auditorRehydrateResponse.json();
  assert(auditorRehydrateJson.rehydrate?.prompt == null, "read_session 读取 rehydrate pack 时 prompt 应被 redacted");
  assert(
    Array.isArray(auditorRehydrateJson.rehydrate?.localKnowledgeHits) &&
      auditorRehydrateJson.rehydrate.localKnowledgeHits.every((entry) => entry.content == null && entry.uri == null),
    "read_session 读取 rehydrate pack 时 localKnowledgeHits 应被 redacted"
  );

    const foreignAgentResponse = await fetchWithToken(
    `/api/agents/agent_treasury/context?${LITE_AGENT_CONTEXT_QUERY}`,
    agentAuditorToken
  );
  assert(foreignAgentResponse.status === 403, "绑定到 agent_openneed_agents 的 read session 不应读取其他 Agent");
  await drainResponse(foreignAgentResponse);

    const filteredAgentsResponse = await fetchWithToken("/api/agents", agentAuditorToken);
  assert(filteredAgentsResponse.ok, "agent_auditor 应允许读取过滤后的 agents 列表");
  const filteredAgentsJson = await filteredAgentsResponse.json();
  assert(
    Array.isArray(filteredAgentsJson.agents) &&
      filteredAgentsJson.agents.length === 1 &&
      filteredAgentsJson.agents[0]?.agentId === "agent_openneed_agents",
    "绑定 Agent 的 read session 应只返回自身允许的 agent 列表"
  );

    const adminAuthorizations = await getJson("/api/authorizations?limit=20");
    const auditorAuthorizationsResponse = await fetchWithToken("/api/authorizations?limit=20", agentAuditorToken);
  assert(auditorAuthorizationsResponse.ok, "agent_auditor 应允许读取授权提案列表");
  const auditorAuthorizationsJson = await auditorAuthorizationsResponse.json();
  assert(
    Array.isArray(auditorAuthorizationsJson.authorizations) &&
      auditorAuthorizationsJson.authorizations.every((entry) =>
        Array.isArray(entry.relatedAgentIds) && entry.relatedAgentIds.includes("agent_openneed_agents")
      ),
    "绑定 Agent 的 read session 应只返回自身允许的授权提案"
  );
    const allowedAuthorizationId = auditorAuthorizationsJson.authorizations?.[0]?.proposalId || null;
    if (allowedAuthorizationId) {
    const auditorAuthorizationDetailResponse = await fetchWithToken(
      `/api/authorizations/${encodeURIComponent(allowedAuthorizationId)}`,
      agentAuditorToken
    );
    assert(auditorAuthorizationDetailResponse.ok, "agent_auditor 应允许读取允许范围内的 authorization detail");
    const auditorAuthorizationDetailJson = await auditorAuthorizationDetailResponse.json();
    assert(
      auditorAuthorizationDetailJson.authorization?.payload == null,
      "read_session 读取 authorization detail 时 payload 应被 redacted"
    );
    assert(
      auditorAuthorizationDetailJson.authorization?.executionReceipt == null,
      "read_session 读取 authorization detail 时 executionReceipt 应被 redacted"
    );

    const auditorAuthorizationTimelineResponse = await fetchWithToken(
      `/api/authorizations/${encodeURIComponent(allowedAuthorizationId)}/timeline`,
      agentAuditorToken
    );
    assert(auditorAuthorizationTimelineResponse.ok, "agent_auditor 应允许读取允许范围内的 authorization timeline");
    const auditorAuthorizationTimelineJson = await auditorAuthorizationTimelineResponse.json();
    assert(
      Array.isArray(auditorAuthorizationTimelineJson.timeline) &&
        auditorAuthorizationTimelineJson.timeline.every((entry) => entry.summary == null),
      "read_session 读取 authorization timeline 时 summary 应被 redacted"
    );

    const auditorAuthorizationCredentialResponse = await fetchWithToken(
      `/api/authorizations/${encodeURIComponent(allowedAuthorizationId)}/credential?didMethod=agentpassport`,
      agentAuditorToken
    );
    assert(auditorAuthorizationCredentialResponse.ok, "agent_auditor 应允许读取允许范围内的 authorization credential");
    const auditorAuthorizationCredentialJson = await auditorAuthorizationCredentialResponse.json();
    assert(
      auditorAuthorizationCredentialJson.credential?.credentialRecord?.proofValue == null,
      "read_session 读取 authorization credential 时 proofValue 应被 redacted"
    );
  }

    const foreignAuthorization = Array.isArray(adminAuthorizations.authorizations)
    ? adminAuthorizations.authorizations.find(
        (entry) => !(Array.isArray(entry.relatedAgentIds) && entry.relatedAgentIds.includes("agent_openneed_agents"))
      )
    : null;
    if (foreignAuthorization?.proposalId) {
    const foreignAuthorizationResponse = await fetchWithToken(
      `/api/authorizations/${encodeURIComponent(foreignAuthorization.proposalId)}`,
      agentAuditorToken
    );
    assert(foreignAuthorizationResponse.status === 403, "绑定 Agent 的 read session 不应读取其他 Agent 的 authorization");
    await drainResponse(foreignAuthorizationResponse);
  }

    const transcriptObserverSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-transcript-observer",
      role: "transcript_observer",
      agentIds: ["agent_openneed_agents"],
      ttlSeconds: 600,
      note: "cognitive-state scope probe",
    }),
  });
    assert(transcriptObserverSessionResponse.ok, "创建 transcript_observer read session 失败");
    const transcriptObserverSession = await transcriptObserverSessionResponse.json();
    const transcriptObserverCognitiveStateResponse = await fetchWithTokenEventually(
    "/api/agents/agent_openneed_agents/cognitive-state?didMethod=agentpassport",
    transcriptObserverSession.token,
    {
      label: "transcript_observer cognitive-state",
      trace: traceSmoke,
      drainResponse,
      isReady: (response) => response.ok,
    }
  );
  assert(transcriptObserverCognitiveStateResponse.ok, "transcript_observer 应允许读取 cognitive-state");
  const transcriptObserverCognitiveStateJson = await transcriptObserverCognitiveStateResponse.json();
  assert(transcriptObserverCognitiveStateJson.cognitiveState?.mode, "transcript_observer cognitive-state 应返回 mode");
  assert(
    transcriptObserverCognitiveStateJson.cognitiveState?.preferenceProfile == null,
    "summary-only cognitive-state 不应暴露 preferenceProfile"
  );
  const transcriptObserverTransitionsResponse = await fetchWithTokenEventually(
    "/api/agents/agent_openneed_agents/cognitive-transitions?limit=5",
    transcriptObserverSession.token,
    {
      label: "transcript_observer cognitive-transitions",
      trace: traceSmoke,
      drainResponse,
      isReady: (response) => response.ok,
    }
  );
  assert(transcriptObserverTransitionsResponse.ok, "transcript_observer 应允许读取 cognitive-transitions");
  const transcriptObserverTransitionsJson = await transcriptObserverTransitionsResponse.json();
  assert(Array.isArray(transcriptObserverTransitionsJson.transitions), "cognitive-transitions 应返回 transitions 数组");

    const agentMetadataObserverSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-agent-metadata-observer",
      role: "agent_metadata_observer",
      agentIds: ["agent_openneed_agents"],
      ttlSeconds: 600,
      note: "cognitive-state denial probe",
    }),
  });
    assert(agentMetadataObserverSessionResponse.ok, "创建 agent_metadata_observer read session 失败");
    const agentMetadataObserverSession = await agentMetadataObserverSessionResponse.json();
    const deniedCognitiveStateResponse = await fetchWithToken(
    "/api/agents/agent_openneed_agents/cognitive-state?didMethod=agentpassport",
    agentMetadataObserverSession.token
  );
  assert(deniedCognitiveStateResponse.status === 401, "agent_metadata_observer 不应读取 cognitive-state");
  await drainResponse(deniedCognitiveStateResponse);

    const agentsContextSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-agents-context",
      scopes: ["agents_context"],
      agentIds: ["agent_openneed_agents"],
      ttlSeconds: 600,
      note: "route policy fallback probe",
    }),
  });
    assert(agentsContextSessionResponse.ok, "创建 agents_context read session 失败");
    const agentsContextSession = await agentsContextSessionResponse.json();
    const deniedRuntimeSummaryResponse = await fetchWithToken(
    "/api/agents/agent_openneed_agents/runtime-summary?didMethod=agentpassport",
    agentsContextSession.token
  );
  assert(deniedRuntimeSummaryResponse.status === 401, "agents_context 不应读取 runtime-summary");
  await drainResponse(deniedRuntimeSummaryResponse);
  const deniedAgentCredentialResponse = await fetchWithToken(
    "/api/agents/agent_openneed_agents/credential?didMethod=agentpassport",
    agentsContextSession.token
  );
  assert(deniedAgentCredentialResponse.status === 401, "agents_context 不应读取 agent credential");
  await drainResponse(deniedAgentCredentialResponse);
  const deniedArchivesResponse = await fetchWithToken(
    "/api/agents/agent_openneed_agents/archives?limit=3",
    agentsContextSession.token
  );
  assert(deniedArchivesResponse.status === 401, "agents_context 不应读取 archives");
  await drainResponse(deniedArchivesResponse);

    const credentialDetailSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-credential-detail",
      scopes: ["credentials_detail"],
      agentIds: ["agent_openneed_agents"],
      ttlSeconds: 600,
      note: "agent credential scope probe",
    }),
  });
    assert(credentialDetailSessionResponse.ok, "创建 credentials_detail read session 失败");
    const credentialDetailSession = await credentialDetailSessionResponse.json();
    const scopedAgentCredentialResponse = await fetchWithTokenEventually(
      "/api/agents/agent_openneed_agents/credential?didMethod=agentpassport",
      credentialDetailSession.token,
      {
        label: "credentials_detail /api/agents/:id/credential",
        trace: traceSmoke,
        drainResponse,
      }
    );
    assert(scopedAgentCredentialResponse.ok, "credentials_detail 应允许读取 agent credential");
    const scopedAgentCredentialJson = await scopedAgentCredentialResponse.json();
    assert(
      scopedAgentCredentialJson.credential?.credentialRecord?.credentialRecordId,
      "credentials_detail 读取 agent credential 应返回 credentialRecordId"
    );
    if (firstCredentialId) {
      const deniedCredentialRevokeResponse = await fetchWithToken(
        `/api/credentials/${encodeURIComponent(firstCredentialId)}/revoke`,
        credentialDetailSession.token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "forged read_session revoke probe",
            revokedByAgentId: "agent_treasury",
            revokedByWindowId: "window_smoke_ui_forged_credential_revoke",
          }),
        }
      );
      assert(
        deniedCredentialRevokeResponse.status === 401,
        "credentials_detail read_session 不应写 credential revoke，即使 body 伪造 revokedBy"
      );
      await drainResponse(deniedCredentialRevokeResponse);
    }

    const archivesObserverSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-archives-observer",
      scopes: ["agents_memories"],
      agentIds: ["agent_openneed_agents"],
      ttlSeconds: 600,
      note: "agent archives scope probe",
    }),
  });
    assert(archivesObserverSessionResponse.ok, "创建 agents_memories read session 失败");
    const archivesObserverSession = await archivesObserverSessionResponse.json();
    const scopedArchivesResponse = await fetchWithTokenEventually(
      "/api/agents/agent_openneed_agents/archives?limit=3",
      archivesObserverSession.token,
      {
        label: "agents_memories /api/agents/:id/archives",
        trace: traceSmoke,
        drainResponse,
      }
    );
    assert(scopedArchivesResponse.ok, "agents_memories 应允许读取 archives");
    const scopedArchivesJson = await scopedArchivesResponse.json();
    assert(scopedArchivesJson.archive?.filePath == null, "read_session 读取 archives 不应看到 filePath");
    const archiveRestoreProbeResponse = await authorizedFetch(
      "/api/agents/agent_openneed_agents/passport-memory",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layer: "working",
          kind: "note",
          summary: `archive restore probe ${Date.now()}`,
          content: "archive restore coverage sample",
          sourceWindowId: "window_smoke_ui_archive_restore",
          recordedByAgentId: "agent_openneed_agents",
          recordedByWindowId: "window_smoke_ui_archive_restore",
        }),
      }
    );
    assert(archiveRestoreProbeResponse.ok, "创建 archive restore probe passport-memory 失败");
    const archiveRestoreProbe = await archiveRestoreProbeResponse.json();
    const archiveRestoreProbeMemory = archiveRestoreProbe.memory;
    assert(archiveRestoreProbeMemory?.passportMemoryId, "archive restore probe passport-memory 缺少 passportMemoryId");
    const archiveRestoreFilePath = path.join(
      expectedArchiveDir,
      "agent_openneed_agents",
      "passport-memory.jsonl"
    );
    const archivedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(archiveRestoreFilePath), { recursive: true });
    await fs.writeFile(
      archiveRestoreFilePath,
      `${JSON.stringify({
        kind: "passport_memory",
        agentId: "agent_openneed_agents",
        archivedAt,
        record: archiveRestoreProbeMemory,
      })}\n`,
      "utf8"
    );
    const archiveRestoreResponse = await authorizedFetch(
      "/api/agents/agent_openneed_agents/archives/restore",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "passport-memory",
          passportMemoryId: archiveRestoreProbeMemory.passportMemoryId,
          restoredByAgentId: "agent_openneed_agents",
          restoredByWindowId: "window_smoke_ui_archive_restore",
        }),
      }
    );
    assert(archiveRestoreResponse.ok, "archive restore HTTP 请求失败");
    const archiveRestoreJson = await archiveRestoreResponse.json();
    assert(
      archiveRestoreJson.restored?.restoredRecord?.passportMemoryId,
      "archive restore 应返回 restoredRecord.passportMemoryId"
    );
    const deniedArchiveRestoreWriteResponse = await fetchWithToken(
      "/api/agents/agent_openneed_agents/archives/restore",
      archivesObserverSession.token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "passport-memory",
          passportMemoryId: archiveRestoreProbeMemory.passportMemoryId,
          restoredByAgentId: "agent_treasury",
          restoredByWindowId: "window_smoke_ui_forged_archive_restore",
        }),
      }
    );
    assert(
      deniedArchiveRestoreWriteResponse.status === 401,
      "agents_memories read_session 不应写 archives/restore，即使 body 伪造 restoredBy"
    );
    await drainResponse(deniedArchiveRestoreWriteResponse);
    const deniedArchiveRestoresResponse = await fetchWithToken(
      "/api/agents/agent_openneed_agents/archive-restores?kind=passport-memory",
      agentsContextSession.token
    );
    assert(deniedArchiveRestoresResponse.status === 401, "agents_context 不应读取 archive-restores");
    await drainResponse(deniedArchiveRestoresResponse);
    const scopedArchiveRestoresResponse = await fetchWithTokenEventually(
      "/api/agents/agent_openneed_agents/archive-restores?kind=passport-memory",
      archivesObserverSession.token,
      {
        label: "agents_memories /api/agents/:id/archive-restores",
        trace: traceSmoke,
        drainResponse,
      }
    );
    assert(scopedArchiveRestoresResponse.ok, "agents_memories 应允许读取 archive-restores");
    const scopedArchiveRestoresJson = await scopedArchiveRestoresResponse.json();
    assert(Array.isArray(scopedArchiveRestoresJson.events), "archive-restores 应返回 events 数组");
    assert(
      scopedArchiveRestoresJson.latest?.payload?.restoredRecordId,
      "archive-restores 应返回 latest.payload.restoredRecordId"
    );
    assert(
      scopedArchiveRestoresJson.latest?.payload?.restoredByWindowId === "window_smoke_ui_archive_restore",
      "archive-restores 应保留 restoredByWindowId 归因"
    );
    const deniedArchiveRestoreRevertResponse = await fetchWithToken(
      "/api/agents/agent_openneed_agents/archive-restores/revert",
      archivesObserverSession.token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restoredRecordId:
            scopedArchiveRestoresJson.latest?.payload?.restoredRecordId ||
            archiveRestoreJson.restored?.restoredRecord?.passportMemoryId,
          archiveKind: "passport-memory",
          revertedByAgentId: "agent_treasury",
          revertedByWindowId: "window_smoke_ui_forged_archive_revert",
        }),
      }
    );
    assert(
      deniedArchiveRestoreRevertResponse.status === 401,
      "agents_memories read_session 不应写 archive-restores/revert，即使 body 伪造 revertedBy"
    );
    await drainResponse(deniedArchiveRestoreRevertResponse);

    const agentsIdentitySessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-agents-identity",
      scopes: ["agents_identity"],
      agentIds: ["agent_openneed_agents"],
      ttlSeconds: 600,
      note: "agents compare admin-only probe",
    }),
  });
    assert(agentsIdentitySessionResponse.ok, "创建 agents_identity read session 失败");
    const agentsIdentitySession = await agentsIdentitySessionResponse.json();
    const deniedAgentCompareResponse = await fetchWithToken(
    "/api/agents/compare?leftAgentId=agent_openneed_agents&rightAgentId=agent_openneed_agents",
    agentsIdentitySession.token
  );
  assert(deniedAgentCompareResponse.status === 401, "read_session 不应读取 agents compare");
  await drainResponse(deniedAgentCompareResponse);
  const deniedAgentCompareEvidenceResponse = await fetchWithToken(
    "/api/agents/compare/evidence?leftAgentId=agent_openneed_agents&rightAgentId=agent_openneed_agents",
    agentsIdentitySession.token
  );
  assert(deniedAgentCompareEvidenceResponse.status === 401, "read_session 不应读取 agents compare evidence");
  await drainResponse(deniedAgentCompareEvidenceResponse);
  const deniedAgentCompareAuditsResponse = await fetchWithToken(
    "/api/agents/compare/audits?leftAgentId=agent_openneed_agents&rightAgentId=agent_openneed_agents",
    agentsIdentitySession.token
  );
  assert(deniedAgentCompareAuditsResponse.status === 401, "read_session 不应读取 agents compare audits");
  await drainResponse(deniedAgentCompareAuditsResponse);

    const authorizationObserverSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-authorization-observer",
      role: "authorization_observer",
      agentIds: ["agent_openneed_agents"],
      ttlSeconds: 600,
      note: "fine-grained authorization scope probe",
    }),
  });
    assert(authorizationObserverSessionResponse.ok, "创建 authorization_observer read session 失败");
    const authorizationObserverSession = await authorizationObserverSessionResponse.json();
    const authorizationObserverToken = authorizationObserverSession.token;
    assert(authorizationObserverToken, "authorization_observer token 缺失");
    const authorizationObserverListResponse = await fetchWithTokenEventually("/api/authorizations?limit=10", authorizationObserverToken, {
    label: "authorization_observer /api/authorizations",
    trace: traceSmoke,
    drainResponse,
  });
  assert(authorizationObserverListResponse.ok, "authorization_observer 应允许读取 authorizations 列表");
  await drainResponse(authorizationObserverListResponse);
    const authorizationObserverContextResponse = await fetchWithToken(
    `/api/agents/agent_openneed_agents/context?${LITE_AGENT_CONTEXT_QUERY}`,
    authorizationObserverToken
  );
  assert(authorizationObserverContextResponse.status === 401, "authorization_observer 不应读取 agent context");
  await drainResponse(authorizationObserverContextResponse);
  const deniedAuthorizationCreateResponse = await fetchWithToken(
    "/api/authorizations",
    authorizationObserverToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policyAgentId: "agent_openneed_agents",
        actionType: "grant_asset",
        payload: {
          targetAgentId: "agent_openneed_agents",
          asset: "credits",
          amount: 1,
        },
        createdByAgentId: "agent_treasury",
        createdByWindowId: "window_smoke_ui_forged_authorization_create",
      }),
    }
  );
  assert(
    deniedAuthorizationCreateResponse.status === 401,
    "authorization_observer 不应写 authorizations create，即使 body 伪造 createdBy"
  );
  await drainResponse(deniedAuthorizationCreateResponse);
  if (allowedAuthorizationId) {
    const deniedAuthorizationSignResponse = await fetchWithToken(
      `/api/authorizations/${encodeURIComponent(allowedAuthorizationId)}/sign`,
      authorizationObserverToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedBy: "forged signer",
          recordedByAgentId: "agent_treasury",
          recordedByWindowId: "window_smoke_ui_forged_authorization_sign",
        }),
      }
    );
    assert(
      deniedAuthorizationSignResponse.status === 401,
      "authorization_observer 不应写 authorization sign，即使 body 伪造 recordedBy"
    );
    await drainResponse(deniedAuthorizationSignResponse);
    const deniedAuthorizationExecuteResponse = await fetchWithToken(
      `/api/authorizations/${encodeURIComponent(allowedAuthorizationId)}/execute`,
      authorizationObserverToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executedByAgentId: "agent_treasury",
          executedByWindowId: "window_smoke_ui_forged_authorization_execute",
        }),
      }
    );
    assert(
      deniedAuthorizationExecuteResponse.status === 401,
      "authorization_observer 不应写 authorization execute，即使 body 伪造 executedBy"
    );
    await drainResponse(deniedAuthorizationExecuteResponse);
    const deniedAuthorizationRevokeResponse = await fetchWithToken(
      `/api/authorizations/${encodeURIComponent(allowedAuthorizationId)}/revoke`,
      authorizationObserverToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revokedByAgentId: "agent_treasury",
          revokedByWindowId: "window_smoke_ui_forged_authorization_revoke",
        }),
      }
    );
    assert(
      deniedAuthorizationRevokeResponse.status === 401,
      "authorization_observer 不应写 authorization revoke，即使 body 伪造 revokedBy"
    );
    await drainResponse(deniedAuthorizationRevokeResponse);
  }

    const adminStatusLists = await getJson("/api/status-lists");
    const auditorStatusListsResponse = await fetchWithToken("/api/status-lists", agentAuditorToken);
  assert(auditorStatusListsResponse.ok, "agent_auditor 应允许读取过滤后的 status list 列表");
  const auditorStatusListsJson = await auditorStatusListsResponse.json();
  assert(
    Array.isArray(auditorStatusListsJson.statusLists) &&
      auditorStatusListsJson.statusLists.length >= 1 &&
      auditorStatusListsJson.statusLists.every((entry) => entry.issuerAgentId === "agent_openneed_agents"),
    "绑定 Agent 的 read session 应只返回自身允许的 status list"
  );
    const allowedStatusListId = auditorStatusListsJson.statusLists?.[0]?.statusListId || null;
    if (allowedStatusListId) {
    const auditorStatusListDetailResponse = await fetchWithToken(
      `/api/status-lists/${encodeURIComponent(allowedStatusListId)}`,
      agentAuditorToken
    );
    assert(auditorStatusListDetailResponse.ok, "agent_auditor 应允许读取允许范围内的 status list detail");
    const auditorStatusListDetailJson = await auditorStatusListDetailResponse.json();
    assert(
      auditorStatusListDetailJson.summary?.proofValue == null,
      "read_session 读取 status list detail 时 summary.proofValue 应被 redacted"
    );
    assert(
      Array.isArray(auditorStatusListDetailJson.entries) &&
        auditorStatusListDetailJson.entries.every((entry) => entry.proofValue == null),
      "read_session 读取 status list detail 时 entries.proofValue 应被 redacted"
    );
  }

    const foreignStatusList = Array.isArray(adminStatusLists.statusLists)
    ? adminStatusLists.statusLists.find((entry) => entry.issuerAgentId !== "agent_openneed_agents")
    : null;
    if (foreignStatusList?.statusListId) {
    const foreignStatusListResponse = await fetchWithToken(
      `/api/status-lists/${encodeURIComponent(foreignStatusList.statusListId)}`,
      agentAuditorToken
    );
    assert(foreignStatusListResponse.status === 403, "绑定 Agent 的 read session 不应读取其他 Agent 的 status list");
    await drainResponse(foreignStatusListResponse);
    if (allowedStatusListId) {
      const foreignCompareResponse = await fetchWithToken(
        `/api/status-lists/compare?leftStatusListId=${encodeURIComponent(allowedStatusListId)}&rightStatusListId=${encodeURIComponent(foreignStatusList.statusListId)}`,
        agentAuditorToken
      );
      assert(foreignCompareResponse.status === 403, "绑定 Agent 的 read session 不应比较越界的 status list");
      await drainResponse(foreignCompareResponse);
    }
  }

    const adminRepairs = await getJson("/api/migration-repairs?limit=20&didMethod=agentpassport");
    const auditorRepairsResponse = await fetchWithToken(
    "/api/migration-repairs?limit=20&didMethod=agentpassport",
    agentAuditorToken
  );
  assert(auditorRepairsResponse.ok, "agent_auditor 应允许读取过滤后的 migration repairs 列表");
  const auditorRepairsJson = await auditorRepairsResponse.json();
  assert(
    Array.isArray(auditorRepairsJson.repairs) &&
      auditorRepairsJson.repairs.every((entry) => repairTouchesAgent(entry, "agent_openneed_agents")),
    "绑定 Agent 的 read session 应只返回自身允许的 migration repairs"
  );
    const allowedRepairId = auditorRepairsJson.repairs?.[0]?.repairId || null;
    if (allowedRepairId) {
    const auditorRepairDetailResponse = await fetchWithToken(
      `/api/migration-repairs/${encodeURIComponent(allowedRepairId)}?didMethod=agentpassport`,
      agentAuditorToken
    );
    assert(auditorRepairDetailResponse.ok, "agent_auditor 应允许读取允许范围内的 migration repair detail");
    const auditorRepairDetailJson = await auditorRepairDetailResponse.json();
    assert(
      auditorRepairDetailJson.repair?.repair?.summary == null,
      "read_session 读取 migration repair detail 时 summary 应被 redacted"
    );

    const auditorRepairTimelineResponse = await fetchWithToken(
      `/api/migration-repairs/${encodeURIComponent(allowedRepairId)}/timeline?didMethod=agentpassport`,
      agentAuditorToken
    );
    assert(auditorRepairTimelineResponse.ok, "agent_auditor 应允许读取允许范围内的 migration repair timeline");
    const auditorRepairTimelineJson = await auditorRepairTimelineResponse.json();
    assert(
      Array.isArray(auditorRepairTimelineJson.timeline) &&
        auditorRepairTimelineJson.timeline.every((entry) => entry.summary == null),
      "read_session 读取 migration repair timeline 时 summary 应被 redacted"
    );

    const auditorRepairCredentialsResponse = await fetchWithToken(
      `/api/migration-repairs/${encodeURIComponent(allowedRepairId)}/credentials?didMethod=agentpassport&limit=10`,
      agentAuditorToken
    );
    assert(auditorRepairCredentialsResponse.ok, "agent_auditor 应允许读取允许范围内的 migration repair credentials");
    const auditorRepairCredentialsJson = await auditorRepairCredentialsResponse.json();
    assert(
      Array.isArray(auditorRepairCredentialsJson.credentials) &&
        auditorRepairCredentialsJson.credentials.every((entry) => entry.proofValue == null),
      "read_session 读取 migration repair credentials 时 proofValue 应被 redacted"
    );
  }

    const foreignRepair = Array.isArray(adminRepairs.repairs)
    ? adminRepairs.repairs.find((entry) => !repairTouchesAgent(entry, "agent_openneed_agents"))
    : null;
    if (foreignRepair?.repairId) {
    const foreignRepairResponse = await fetchWithToken(
      `/api/migration-repairs/${encodeURIComponent(foreignRepair.repairId)}?didMethod=agentpassport`,
      agentAuditorToken
    );
    assert(foreignRepairResponse.status === 403, "绑定 Agent 的 read session 不应读取其他 Agent 的 migration repair");
    await drainResponse(foreignRepairResponse);
  }

  const rootHtml = await getText("/");
  includesAll(
    rootHtml,
    [
      "OpenNeed 记忆稳态引擎公开运行态",
      "runtime-home-summary",
      "runtime-health-summary",
      "runtime-recovery-summary",
      "runtime-automation-summary",
      "/repair-hub",
      "runtime-link-list",
    ],
    "公开运行态 HTML"
  );
  }

  const repairHubHtml = await getText("/repair-hub");
  includesAll(
    repairHubHtml,
    [
      "open-main-context",
      "返回公开运行态",
    ],
    "修复中心 HTML"
  );

  const repairs = await getJson("/api/migration-repairs?agentId=agent_openneed_agents&didMethod=agentpassport&limit=5");
  assert(Array.isArray(repairs.repairs), "repair 列表没有 repairs 数组");
  const windows = await getJson("/api/windows");
  assert(Array.isArray(windows.windows), "windows 列表没有 windows 数组");
  const firstWindow = windows.windows[0] || null;
  let checkedWindow = null;
  if (firstWindow?.windowId) {
    checkedWindow = await getJson(`/api/windows/${encodeURIComponent(firstWindow.windowId)}`);
    assert(checkedWindow.window?.windowId === firstWindow.windowId, "window 详情与列表中的 windowId 不匹配");
  }

  const agentContext = await getJson(`/api/agents/agent_openneed_agents/context?${LITE_AGENT_CONTEXT_QUERY}`);
  assert(Array.isArray(agentContext.context?.statusLists), "agent context 缺少 statusLists");
  assert(agentContext.context?.runtime, "agent context 缺少 runtime");
  const agentContextOpenneed = await getJson(`/api/agents/agent_openneed_agents/context?${LITE_AGENT_CONTEXT_OPENNEED_QUERY}`);
  assert(
    agentContextOpenneed.context?.identity?.did !== agentContext.context?.identity?.did,
    "切换 didMethod 后 context.identity.did 不应相同"
  );
  const openneedCredential = await getJson("/api/agents/agent_openneed_agents/credential?didMethod=openneed");
  const agentpassportCredential = await getJson("/api/agents/agent_openneed_agents/credential?didMethod=agentpassport");
  const runtime = await getJson(`/api/agents/agent_openneed_agents/runtime?${LITE_AGENT_CONTEXT_QUERY}`);
  const runtimeSummary = await getJson("/api/agents/agent_openneed_agents/runtime-summary?didMethod=agentpassport");
  assert(runtime.runtime?.policy?.maxConversationTurns >= 1, "runtime policy 异常");
  assert(runtime.runtime?.deviceRuntime, "runtime 缺少 deviceRuntime");
  assert(runtime.runtime?.cognitiveState?.mode, "runtime 应暴露 cognitiveState.mode");
  assert(typeof runtime.runtime?.cognitiveState?.sleepPressure === "number", "runtime 应暴露 cognitiveState.sleepPressure");
  assert(typeof runtime.runtime?.cognitiveState?.interoceptiveState?.bodyBudget === "number", "runtime 应暴露 cognitiveState.interoceptiveState");
  assert(typeof runtime.runtime?.cognitiveState?.replayOrchestration?.replayMode === "string", "runtime 应暴露 cognitiveState.replayOrchestration");
  assert(runtimeSummary.summary?.cognition?.mode, "runtime summary 应暴露 cognition.mode");
  assert(typeof runtimeSummary.summary?.cognition?.dynamics?.sleepPressure === "number", "runtime summary 应暴露 sleepPressure");
  assert(
    typeof runtimeSummary.summary?.cognition?.dynamics?.interoceptiveState?.bodyBudget === "number",
    "runtime summary 应暴露 interoceptiveState.bodyBudget"
  );
  assert(
    typeof runtimeSummary.summary?.cognition?.dynamics?.replayOrchestration?.replayMode === "string",
    "runtime summary 应暴露 replayOrchestration.replayMode"
  );
  assert(runtime.runtime?.deviceRuntime?.commandPolicy?.riskStrategies?.critical === "multisig", "critical 风险策略应默认为 multisig");
  assert(runtime.runtime?.deviceRuntime?.retrievalPolicy?.strategy === "local_first_non_vector", "runtime 默认检索策略应为 local_first_non_vector");
  assert(runtime.runtime?.deviceRuntime?.retrievalPolicy?.allowVectorIndex === false, "runtime 默认不应启用向量索引");
  assert(Array.isArray(runtime.runtime?.deviceRuntime?.sandboxPolicy?.allowedCapabilities), "runtime 缺少 sandbox allowedCapabilities");
  assert(runtime.runtime?.deviceRuntime?.sandboxPolicy?.allowedCapabilities.includes("runtime_search"), "sandbox 默认应允许 runtime_search");
  assert(runtime.runtime?.deviceRuntime?.sandboxPolicy?.maxReadBytes >= 256, "sandbox maxReadBytes 异常");
  assert(runtime.runtime?.deviceRuntime?.sandboxPolicy?.maxListEntries >= 1, "sandbox maxListEntries 异常");
  assert(runtime.runtime?.deviceRuntime?.sandboxPolicy?.requireAbsoluteProcessCommand === true, "sandbox 应默认要求绝对路径命令");
  assert(runtime.runtime?.deviceRuntime?.sandboxPolicy?.maxProcessArgs >= 1, "sandbox maxProcessArgs 异常");
  assert(runtime.runtime?.deviceRuntime?.sandboxPolicy?.maxProcessArgBytes >= 256, "sandbox maxProcessArgBytes 异常");
  assert(runtime.runtime?.deviceRuntime?.sandboxPolicy?.maxUrlLength >= 128, "sandbox maxUrlLength 异常");
  const deviceRuntimePreviewResponse = await authorizedFetch("/api/device/runtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      residentAgentId: "agent_openneed_agents",
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
      allowedCapabilities: ["runtime_search", "filesystem_list", "filesystem_read", "conversation_minute_write"],
      maxReadBytes: 4096,
      maxListEntries: 25,
      maxProcessArgs: 4,
      maxProcessArgBytes: 512,
      maxUrlLength: 512,
      requireAbsoluteProcessCommand: true,
      dryRun: true,
    }),
  });
  assert(deviceRuntimePreviewResponse.ok, "device runtime 配置请求失败");
  const deviceRuntimePreview = await deviceRuntimePreviewResponse.json();
  assert(deviceRuntimePreview.deviceRuntime?.residentAgentId === "agent_openneed_agents", "device runtime dry-run 未返回 residentAgentId");
  assert(deviceRuntimePreview.deviceRuntime?.commandPolicy?.riskStrategies?.low === "auto_execute", "device runtime dry-run 没保住低风险策略");
  assert(deviceRuntimePreview.deviceRuntime?.retrievalPolicy?.maxHits === 6, "device runtime dry-run 没保住 retrievalMaxHits");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.allowedCapabilities?.includes("filesystem_list"), "device runtime dry-run 没保住 sandbox 能力");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxReadBytes === 4096, "device runtime dry-run 没保住 maxReadBytes");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxListEntries === 25, "device runtime dry-run 没保住 maxListEntries");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxProcessArgs === 4, "device runtime dry-run 没保住 maxProcessArgs");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxProcessArgBytes === 512, "device runtime dry-run 没保住 maxProcessArgBytes");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxUrlLength === 512, "device runtime dry-run 没保住 maxUrlLength");
  const configuredRuntimeResponse = await authorizedFetch("/api/device/runtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
      retrievalStrategy: "local_first_non_vector",
      allowVectorIndex: false,
    }),
  });
  assert(configuredRuntimeResponse.ok, "配置 local_command runtime 失败");
  const configuredRuntime = await configuredRuntimeResponse.json();
  assert(configuredRuntime.deviceRuntime?.localReasoner?.provider === "local_command", "runtime 应切到 local_command");
  assert(configuredRuntime.deviceRuntime?.localReasoner?.configured === true, "runtime local reasoner 应配置完成");
  const runtimeAfterConfig = await getJson(`/api/agents/agent_openneed_agents/runtime?${LITE_AGENT_CONTEXT_QUERY}`);
  assert(runtimeAfterConfig.runtime?.deviceRuntime?.localReasoner?.provider === "local_command", "agent runtime 视图应反映 local_command");
  const setupStatus = await getJson("/api/device/setup");
  assert(Array.isArray(setupStatus.checks), "device setup status 缺少 checks 数组");
  assert(setupStatus.deviceRuntime?.localReasoner?.provider === "local_command", "device setup status 应显示 local_command");
  assert(setupStatus.localReasonerDiagnostics?.provider === "local_command", "device setup status 应返回 localReasonerDiagnostics");
  assert(setupStatus.formalRecoveryFlow?.status, "device setup status 缺少 formalRecoveryFlow.status");
  assert(setupStatus.automaticRecoveryReadiness?.status, "device setup status 缺少 automaticRecoveryReadiness.status");
  assert(setupStatus.formalRecoveryFlow?.runbook?.status, "device setup status 缺少 formalRecoveryFlow.runbook.status");
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
    Array.isArray(setupStatus.formalRecoveryFlow?.runbook?.steps) &&
      setupStatus.formalRecoveryFlow.runbook.steps.length >= 4,
    "device setup status 应返回 formalRecoveryFlow.runbook.steps"
  );
  assert(setupStatus.deviceRuntime?.constrainedExecutionSummary?.status, "device runtime 应返回 constrainedExecutionSummary.status");
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.brokerIsolationEnabled === true,
    "device runtime 应报告 brokerIsolationEnabled=true"
  );
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.enabled === true,
    "device runtime 应报告 systemBrokerSandbox.enabled=true"
  );
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.brokerRuntime?.brokerEnvMode === "empty",
    "device runtime 应报告空 broker 环境"
  );
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.workerRuntime?.workerEnvMode === "empty",
    "device runtime 应报告空 worker 环境"
  );
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.workerRuntime?.processWorkspaceMode,
    "device runtime 应报告进程工作区隔离模式"
  );
  const localReasonerStatus = await getJson("/api/device/runtime/local-reasoner");
  assert(localReasonerStatus.diagnostics?.provider === "local_command", "local reasoner diagnostics provider 不正确");
  assert(localReasonerStatus.diagnostics?.configured === true, "local reasoner diagnostics 应判定 configured");
  const localReasonerCatalog = await getJson("/api/device/runtime/local-reasoner/catalog");
  assert(Array.isArray(localReasonerCatalog.providers), "local reasoner catalog 缺少 providers 数组");
  assert(localReasonerCatalog.providers.some((entry) => entry.provider === "local_command"), "local reasoner catalog 缺少 local_command");
  assert(localReasonerCatalog.providers.some((entry) => entry.provider === "ollama_local"), "local reasoner catalog 缺少 ollama_local");
  const localReasonerProbeResponse = await authorizedFetch("/api/device/runtime/local-reasoner/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "local_command",
      command: process.execPath,
      args: [localReasonerFixturePath],
      cwd: rootDir,
    }),
  });
  assert(localReasonerProbeResponse.ok, "local reasoner probe HTTP 请求失败");
  const localReasonerProbe = await localReasonerProbeResponse.json();
  assert(localReasonerProbe.diagnostics?.provider === "local_command", "local reasoner probe provider 不正确");
  assert(localReasonerProbe.diagnostics?.reachable === true, "local reasoner probe 应判定 reachable");
  const localReasonerSelectResponse = await authorizedFetch("/api/device/runtime/local-reasoner/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "local_command",
      enabled: true,
      command: process.execPath,
      args: [localReasonerFixturePath],
      cwd: rootDir,
      dryRun: false,
    }),
  });
  assert(localReasonerSelectResponse.ok, "local reasoner select HTTP 请求失败");
  const localReasonerSelect = await localReasonerSelectResponse.json();
  assert(localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.provider === "local_command", "local reasoner select 应保留 provider");
  assert(localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.selection?.selectedAt, "local reasoner select 应写入 selection.selectedAt");
  const localReasonerPrewarmResponse = await authorizedFetch("/api/device/runtime/local-reasoner/prewarm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dryRun: false,
    }),
  });
  assert(localReasonerPrewarmResponse.ok, "local reasoner prewarm HTTP 请求失败");
  const localReasonerPrewarm = await localReasonerPrewarmResponse.json();
  assert(localReasonerPrewarm.warmState?.status === "ready", "local reasoner prewarm 应返回 ready");
  assert(localReasonerPrewarm.deviceRuntime?.localReasoner?.lastWarm?.status === "ready", "runtime local reasoner 应记录 lastWarm.status");
  const localReasonerProfileSaveResponse = await authorizedFetch("/api/device/runtime/local-reasoner/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-local-command",
      note: `smoke-ui-local-profile-${Date.now()}`,
      source: "current",
      dryRun: false,
      updatedByAgentId: "agent_openneed_agents",
      updatedByWindowId: "window_demo_1",
      sourceWindowId: "window_demo_1",
    }),
  });
  assert(localReasonerProfileSaveResponse.ok, "local reasoner profile save HTTP 请求失败");
  const localReasonerProfileSave = await localReasonerProfileSaveResponse.json();
  const localReasonerProfileId = localReasonerProfileSave.summary?.profileId || localReasonerProfileSave.profile?.profileId || null;
  assert(localReasonerProfileId, "local reasoner profile save 应返回 profileId");
  const localReasonerProfileList = await getJson("/api/device/runtime/local-reasoner/profiles?limit=20");
  assert(Array.isArray(localReasonerProfileList.profiles), "local reasoner profile list 缺少 profiles 数组");
  assert(
    localReasonerProfileList.profiles.some((entry) => entry.profileId === localReasonerProfileId),
    "local reasoner profile list 应包含新保存的 profile"
  );
  const localReasonerProfileDetail = await getJson(
    `/api/device/runtime/local-reasoner/profiles/${encodeURIComponent(localReasonerProfileId)}`
  );
  assert(
    localReasonerProfileDetail.summary?.profileId === localReasonerProfileId,
    "local reasoner profile detail profileId 不匹配"
  );
  assert(
    localReasonerProfileDetail.profile?.config?.provider === "local_command",
    "local reasoner profile detail 应保留 local_command provider"
  );
  const profileReadSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-profile-reader",
      role: "runtime_observer",
      ttlSeconds: 600,
      note: "local reasoner profile read probe",
    }),
  });
  assert(profileReadSessionResponse.ok, "为 local reasoner profile 创建 runtime_observer 失败");
  const profileReadSession = await profileReadSessionResponse.json();
  const delegatedProfileListRead = await fetchWithTokenEventually(
    "/api/device/runtime/local-reasoner/profiles?limit=20",
    profileReadSession.token,
    {
      label: "runtime_observer /api/device/runtime/local-reasoner/profiles",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(delegatedProfileListRead.ok, "runtime_observer 应允许读取 local reasoner profiles 列表");
  await drainResponse(delegatedProfileListRead);
  const delegatedProfileDetailRead = await fetchWithToken(
    `/api/device/runtime/local-reasoner/profiles/${encodeURIComponent(localReasonerProfileId)}`,
    profileReadSession.token
  );
  assert(delegatedProfileDetailRead.ok, "runtime_observer 应允许读取 local reasoner profile detail");
  const delegatedProfileDetail = await delegatedProfileDetailRead.json();
  assert(
    delegatedProfileDetail.profile?.config?.command == null,
    "read_session 读取 local reasoner profile detail 时不应看到 command"
  );
  assert(
    Array.isArray(delegatedProfileDetail.profile?.config?.args) &&
      delegatedProfileDetail.profile.config.args.length === 0,
    "read_session 读取 local reasoner profile detail 时不应看到 args"
  );
  const localReasonerProfileActivateResponse = await authorizedFetch(
    `/api/device/runtime/local-reasoner/profiles/${encodeURIComponent(localReasonerProfileId)}/activate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: false,
        updatedByAgentId: "agent_openneed_agents",
        updatedByWindowId: "window_demo_1",
        sourceWindowId: "window_demo_1",
      }),
    }
  );
  assert(localReasonerProfileActivateResponse.ok, "local reasoner profile activate HTTP 请求失败");
  const localReasonerProfileActivate = await localReasonerProfileActivateResponse.json();
  assert(
    localReasonerProfileActivate.runtime?.deviceRuntime?.localReasoner?.provider === "local_command",
    "local reasoner profile activate 后 provider 应保持 local_command"
  );
  const localReasonerRestoreCandidates = await getJson("/api/device/runtime/local-reasoner/restore-candidates?limit=10");
  assert(Array.isArray(localReasonerRestoreCandidates.restoreCandidates), "local reasoner restore candidates 缺少 restoreCandidates 数组");
  assert(
    localReasonerRestoreCandidates.restoreCandidates.some((entry) => entry.profileId === localReasonerProfileId),
    "local reasoner restore candidates 应包含新 profile"
  );
  const delegatedRestoreCandidatesRead = await fetchWithToken(
    "/api/device/runtime/local-reasoner/restore-candidates?limit=10",
    profileReadSession.token
  );
  assert(delegatedRestoreCandidatesRead.ok, "runtime_observer 应允许读取 local reasoner restore candidates");
  await drainResponse(delegatedRestoreCandidatesRead);
  const localReasonerRestoreResponse = await authorizedFetch("/api/device/runtime/local-reasoner/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId: localReasonerProfileId,
      prewarm: true,
      dryRun: false,
      updatedByAgentId: "agent_openneed_agents",
      updatedByWindowId: "window_demo_1",
      sourceWindowId: "window_demo_1",
    }),
  });
  assert(localReasonerRestoreResponse.ok, "local reasoner restore HTTP 请求失败");
  const localReasonerRestore = await localReasonerRestoreResponse.json();
  assert(localReasonerRestore.restoredProfileId === localReasonerProfileId, "local reasoner restore profileId 不匹配");
  assert(localReasonerRestore.prewarmResult?.warmState?.status === "ready", "local reasoner restore 后应完成 prewarm");
  const setupPackageList = await getJson("/api/device/setup/packages?limit=5");
  assert(Array.isArray(setupPackageList.packages), "device setup package list 缺少 packages 数组");
  const recoveryList = await getJson("/api/device/runtime/recovery?limit=5");
  assert(Array.isArray(recoveryList.bundles), "recovery list 缺少 bundles 数组");
  assert(recoveryList.recoveryDir === security.localStore?.recoveryDir, "recoveryDir 应与 security.localStore.recoveryDir 一致");
  const recoveryExportResponse = await authorizedFetch("/api/device/runtime/recovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      passphrase: "smoke-ui-recovery-passphrase",
      note: "smoke-ui dry-run recovery bundle",
      includeLedgerEnvelope: true,
      saveToFile: false,
      returnBundle: true,
      dryRun: true,
    }),
  });
  assert(recoveryExportResponse.ok, "recovery export HTTP 请求失败");
  const recoveryExport = await recoveryExportResponse.json();
  assert(recoveryExport.bundle?.format === "agent-passport-store-recovery-v1", "recovery export format 不正确");
  assert(recoveryExport.summary?.bundleId, "recovery export 缺少 summary.bundleId");
  const recoveryImportResponse = await authorizedFetch("/api/device/runtime/recovery/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      passphrase: "smoke-ui-recovery-passphrase",
      bundle: recoveryExport.bundle,
      overwrite: true,
      restoreLedger: true,
      dryRun: true,
    }),
  });
  assert(recoveryImportResponse.ok, "recovery import HTTP 请求失败");
  const recoveryImport = await recoveryImportResponse.json();
  assert(recoveryImport.summary?.bundleId === recoveryExport.summary?.bundleId, "recovery import summary.bundleId 不匹配");
  assert(["keychain", "file"].includes(recoveryImport.storeKeyImportTarget), "recovery import target 非法");
  if (recoveryImport.storeKeyImportTarget === "file") {
    assert(recoveryImport.storeKeyPath === security.localStore?.keyPath, "file 模式 recovery import 应返回 storeKeyPath");
  } else {
    assert(recoveryImport.storeKeyPath == null, "keychain 模式 recovery import 不应返回 storeKeyPath");
    assert(recoveryImport.storeKeyKeychainService, "keychain 模式 recovery import 缺少 service");
  }
  const recoveryVerifyResponse = await authorizedFetch("/api/device/runtime/recovery/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      passphrase: "smoke-ui-recovery-passphrase",
      bundle: recoveryExport.bundle,
      dryRun: true,
      persist: false,
    }),
  });
  assert(recoveryVerifyResponse.ok, "recovery verify HTTP 请求失败");
  const recoveryVerify = await recoveryVerifyResponse.json();
  assert(recoveryVerify.rehearsal?.status, "recovery verify 缺少 rehearsal.status");
  const recoveryRehearsals = await getJson("/api/device/runtime/recovery/rehearsals?limit=5");
  assert(Array.isArray(recoveryRehearsals.rehearsals), "recovery rehearsals 缺少 rehearsals 数组");
  const allReadSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-all-read",
      role: "all_read",
      ttlSeconds: 600,
      note: "all_read recovery visibility probe",
    }),
  });
  assert(allReadSessionResponse.ok, "创建 all_read read session 失败");
  const allReadSession = await allReadSessionResponse.json();
  const allReadRecoveryResponse = await fetchWithTokenEventually("/api/device/runtime/recovery?limit=5", allReadSession.token, {
    label: "all_read /api/device/runtime/recovery",
    trace: traceSmoke,
    drainResponse,
  });
  assert(allReadRecoveryResponse.ok, "all_read 应允许读取 recovery 列表");
  const allReadRecoveryJson = await allReadRecoveryResponse.json();
  assert(allReadRecoveryJson.recoveryDir, "all_read 读取 recovery 列表时应看到 recoveryDir");
  const storeKeySource = security.keyManagement?.storeKey?.source || null;
  const signingKeySource = security.keyManagement?.signingKey?.source || null;
  const shouldProbeKeychainMigration =
    security.keyManagement?.keychainPreferred === true &&
    security.keyManagement?.keychainAvailable === true &&
    (storeKeySource !== "keychain" || signingKeySource !== "keychain");
  let keychainMigration = {
    migration: {
      dryRun: false,
      skipped: true,
      reason: shouldProbeKeychainMigration ? "pending_probe" : "already_system_protected_or_not_applicable",
      storeKey: null,
      signingKey: null,
    },
  };
  if (shouldProbeKeychainMigration) {
    const keychainMigrationResponse = await authorizedFetch("/api/security/keychain-migration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: true,
        removeFile: false,
      }),
    });
    if (!keychainMigrationResponse.ok) {
      const failureBody = await keychainMigrationResponse.text();
      throw new Error(
        `keychain migration HTTP ${keychainMigrationResponse.status}: ${failureBody || "empty response"}`
      );
    }
    keychainMigration = await keychainMigrationResponse.json();
    assert(keychainMigration.migration?.storeKey, "keychain migration 缺少 storeKey 结果");
    assert(keychainMigration.migration?.signingKey, "keychain migration 缺少 signingKey 结果");
  }
  const setupRunResponse = await authorizedFetch("/api/device/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      residentAgentId: "agent_openneed_agents",
      residentDidMethod: "agentpassport",
      recoveryPassphrase: "smoke-ui-recovery-passphrase",
      dryRun: true,
    }),
  });
  assert(setupRunResponse.ok, "device setup HTTP 请求失败");
  const setupRun = await setupRunResponse.json();
  assert(setupRun.bootstrap?.bootstrap?.dryRun === true, "device setup dryRun 应透传到 bootstrap");
  assert(setupRun.status?.deviceRuntime?.localReasoner?.provider === "local_command", "device setup 结果应保留 local_command 配置");
  const setupPackagePreview = await getJson("/api/device/setup/package");
  assert(setupPackagePreview.package?.format === "agent-passport-device-setup-v1", "device setup package preview format 不正确");
  assert(setupPackagePreview.package?.runtimeConfig?.residentAgentId === "agent_openneed_agents", "device setup package preview 缺少 residentAgentId");
  assert(
    Array.isArray(setupPackagePreview.package?.localReasonerProfiles) &&
      setupPackagePreview.package.localReasonerProfiles.some((entry) => entry.profileId === localReasonerProfileId),
    "device setup package preview 应包含 local reasoner profiles"
  );
  const setupPackageExportResponse = await authorizedFetch("/api/device/setup/package", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "smoke-ui setup package",
      saveToFile: false,
      includeLocalReasonerProfiles: true,
      dryRun: true,
    }),
  });
  assert(setupPackageExportResponse.ok, "device setup package export HTTP 请求失败");
  const setupPackageExport = await setupPackageExportResponse.json();
  assert(setupPackageExport.package?.format === "agent-passport-device-setup-v1", "device setup package export format 不正确");
  assert(
    Array.isArray(setupPackageExport.package?.localReasonerProfiles) &&
      setupPackageExport.package.localReasonerProfiles.some((entry) => entry.profileId === localReasonerProfileId),
    "device setup package export 应包含 local reasoner profiles"
  );
  const setupPackageImportResponse = await authorizedFetch("/api/device/setup/package/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      package: setupPackageExport.package,
      allowResidentRebind: true,
      importLocalReasonerProfiles: true,
      dryRun: true,
    }),
  });
  assert(setupPackageImportResponse.ok, "device setup package import HTTP 请求失败");
  const setupPackageImport = await setupPackageImportResponse.json();
  assert(setupPackageImport.summary?.packageId === setupPackageExport.summary?.packageId, "device setup package import summary.packageId 不匹配");
  assert(setupPackageImport.runtime?.deviceRuntime?.residentAgentId === "agent_openneed_agents", "device setup package import 应恢复 residentAgentId");
  assert(
    setupPackageImport.localReasonerProfiles?.totalProfiles >= 1,
    "device setup package import 应统计 local reasoner profiles"
  );
  const packageNotePrefix = `smoke-ui-package-${Date.now()}`;
  const savedSetupPackageExportResponse = await authorizedFetch("/api/device/setup/package", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: `${packageNotePrefix}-old`,
      saveToFile: true,
      dryRun: false,
    }),
  });
  assert(savedSetupPackageExportResponse.ok, "saved device setup package export HTTP 请求失败");
  const savedSetupPackageExport = await savedSetupPackageExportResponse.json();
  assert(savedSetupPackageExport.summary?.packageId, "saved device setup package export 缺少 packageId");
  const savedSetupPackageId = savedSetupPackageExport.summary.packageId;
  const savedSetupPackageList = await getJson("/api/device/setup/packages?limit=10");
  assert(
    savedSetupPackageList.packages.some((entry) => entry.packageId === savedSetupPackageId),
    "saved device setup package list 应包含新导出的 package"
  );
  const savedSetupPackageDetail = await getJson(`/api/device/setup/packages/${encodeURIComponent(savedSetupPackageId)}`);
  assert(savedSetupPackageDetail.summary?.packageId === savedSetupPackageId, "saved device setup package detail packageId 不匹配");
  assert(
    Number(savedSetupPackageDetail.summary?.localReasonerProfileCount || 0) >= 1,
    "saved device setup package detail 应包含 local reasoner profile 数量"
  );
  assert(
    Array.isArray(savedSetupPackageDetail.package?.localReasonerProfiles) &&
      savedSetupPackageDetail.package.localReasonerProfiles.some((entry) => entry.profileId === localReasonerProfileId),
    "saved device setup package detail 应包含刚保存的 local reasoner profile"
  );
  const secondSavedSetupPackageResponse = await authorizedFetch("/api/device/setup/package", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: `${packageNotePrefix}-new`,
      saveToFile: true,
      dryRun: false,
    }),
  });
  assert(secondSavedSetupPackageResponse.ok, "second saved device setup package export HTTP 请求失败");
  const secondSavedSetupPackage = await secondSavedSetupPackageResponse.json();
  const secondSavedSetupPackageId = secondSavedSetupPackage.summary?.packageId;
  assert(secondSavedSetupPackageId, "second saved setup package export 缺少 packageId");
  const setupPackagePruneResponse = await authorizedFetch("/api/device/setup/packages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keepLatest: 1,
      residentAgentId: "agent_openneed_agents",
      noteIncludes: packageNotePrefix,
      dryRun: false,
    }),
  });
  assert(setupPackagePruneResponse.ok, "setup package prune HTTP 请求失败");
  const setupPackagePrune = await setupPackagePruneResponse.json();
  assert(setupPackagePrune.counts?.matched === 2, "setup package prune 应精确命中 2 个 smoke packages");
  assert(setupPackagePrune.counts?.deleted >= 1, "setup package prune 应删除至少 1 个 package");
  assert(setupPackagePrune.counts?.kept === 1, "setup package prune 应只保留 1 个 package");
  const setupPackageListAfterDelete = await getJson("/api/device/setup/packages?limit=20");
  const prunedMatches = setupPackageListAfterDelete.packages.filter((entry) => String(entry.note || "").includes(packageNotePrefix));
  assert(
    prunedMatches.length === 1,
    "setup package prune 之后应只剩 1 个匹配 package"
  );
  const savedSetupPackageDeleteResponse = await authorizedFetch(`/api/device/setup/packages/${encodeURIComponent(prunedMatches[0].packageId)}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dryRun: false,
    }),
  });
  assert(savedSetupPackageDeleteResponse.ok, "saved device setup package delete HTTP 请求失败");
  const savedSetupPackageDelete = await savedSetupPackageDeleteResponse.json();
  assert(savedSetupPackageDelete.summary?.packageId === prunedMatches[0].packageId, "saved device setup package delete summary.packageId 不匹配");
  const housekeepingAuditResponse = await authorizedFetch("/api/security/runtime-housekeeping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apply: false,
      keepRecovery: 2,
      keepSetup: 2,
    }),
  });
  assert(housekeepingAuditResponse.ok, "runtime housekeeping audit HTTP 请求失败");
  const housekeepingAudit = await housekeepingAuditResponse.json();
  assert(housekeepingAudit.ok === true, "runtime housekeeping audit 应返回 ok=true");
  assert(housekeepingAudit.mode === "audit", "runtime housekeeping audit 模式应为 audit");
  assert(housekeepingAudit.liveLedger?.touched === false, "runtime housekeeping audit 不应修改 live ledger");
  const rehydrate = await getJson(`/api/agents/agent_openneed_agents/runtime/rehydrate?${LITE_REHYDRATE_QUERY}`);
  assert(typeof rehydrate.rehydrate?.prompt === "string", "rehydrate.prompt 缺失");
  const bootstrapResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runtime/bootstrap?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "让 OpenNeed 记忆稳态引擎成为本地 runtime 底座",
      currentGoal: "预览 bootstrap 是否能建立最小冷启动包",
      currentPlan: ["写 profile", "写 snapshot", "验证 runner"],
      nextAction: "执行 verification run",
      maxRecentConversationTurns: 5,
      maxToolResults: 4,
      maxQueryIterations: 3,
      claimResidentAgent: true,
      dryRun: false,
    }),
  });
  assert(bootstrapResponse.ok, "bootstrap HTTP 请求失败");
  const bootstrap = await bootstrapResponse.json();
  assert(bootstrap.bootstrap?.dryRun === false, "bootstrap 应真正建立最小运行态，而不是只做 dry-run");
  assert(bootstrap.contextBuilder?.slots?.identitySnapshot?.agentId === "agent_openneed_agents", "bootstrap 没保住 identity snapshot");
  assert(bootstrap.sessionState?.sessionStateId, "bootstrap 没返回 session state");
  const minuteToken = `smoke-ui-local-knowledge-${Date.now()}`;
  const minuteResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runtime/minutes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Smoke UI 本地纪要 ${minuteToken}`,
      summary: `本地对话纪要用于验证 runtime search 命中 ${minuteToken}`,
      transcript: [
        "结论：Agent 忘记时要先查 本地参考层和本地纪要。",
        `唯一标识：${minuteToken}`,
        "恢复路径：conversation minute -> runtime search -> rehydrate/context builder。",
      ].join("\n"),
      highlights: ["local search", "conversation minute", minuteToken],
      actionItems: ["验证 runtime search", "验证 context builder localKnowledge"],
      tags: ["smoke", "minutes", "runtime-search"],
      sourceWindowId: "window_smoke_ui",
      recordedByWindowId: "window_smoke_ui",
      recordedByAgentId: "agent_openneed_agents",
    }),
  });
  assert(minuteResponse.ok, "conversation minute HTTP 请求失败");
  const minuteResult = await minuteResponse.json();
  assert(minuteResult.minute?.minuteId, "conversation minute 没返回 minuteId");
  const conversationMinutes = await getJsonEventually("/api/agents/agent_openneed_agents/runtime/minutes?limit=10", {
    label: "runtime minutes list after write",
    trace: traceSmoke,
    isReady: (json) =>
      Array.isArray(json?.minutes) && json.minutes.some((entry) => entry.minuteId === minuteResult.minute.minuteId),
  });
  assert(Array.isArray(conversationMinutes.minutes), "runtime minutes 没有 minutes 数组");
  assert(
    conversationMinutes.minutes.some((entry) => entry.minuteId === minuteResult.minute.minuteId),
    "runtime minutes 没有刚写入的 minute"
  );
  const runtimeSearch = await getJson(
    `/api/agents/agent_openneed_agents/runtime/search?didMethod=agentpassport&sourceType=conversation_minute&limit=5&query=${encodeURIComponent(minuteToken)}`
  );
  assert(Array.isArray(runtimeSearch.hits), "runtime search 没有 hits 数组");
  assert(runtimeSearch.hits.length >= 1, "runtime search 应命中至少一条本地纪要");
  assert(runtimeSearch.retrieval?.strategy === "local_first_non_vector", "runtime search 应声明 local_first_non_vector");
  assert(runtimeSearch.retrieval?.vectorUsed === false, "runtime search 不应使用向量索引");
  assert(
    runtimeSearch.hits.some((entry) => entry.sourceType === "conversation_minute" && entry.sourceId === minuteResult.minute.minuteId),
    "runtime search 没有命中刚写入的 conversation minute"
  );
  const sandboxSearchResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runtime/actions?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      interactionMode: "command",
      executionMode: "execute",
      confirmExecution: true,
      currentGoal: "验证 sandbox action 是否能安全执行本地检索",
      requestedAction: minuteToken,
      requestedCapability: "runtime_search",
      requestedActionType: "search",
      sourceWindowId: "window_smoke_ui",
      recordedByAgentId: "agent_openneed_agents",
      recordedByWindowId: "window_smoke_ui",
      persistRun: false,
      autoCompact: false,
      sandboxAction: {
        capability: "runtime_search",
        actionType: "search",
        query: minuteToken,
        sourceWindowId: "window_smoke_ui",
        recordedByAgentId: "agent_openneed_agents",
        recordedByWindowId: "window_smoke_ui",
      },
    }),
  });
  assert(sandboxSearchResponse.ok, "sandbox runtime_search HTTP 请求失败");
  const sandboxSearch = await sandboxSearchResponse.json();
  assert(sandboxSearch.sandbox?.status === "completed", "sandbox runtime_search 应返回 completed");
  assert(sandboxSearch.sandbox?.sandboxExecution?.capability === "runtime_search", "sandbox runtime_search capability 不匹配");
  assert(sandboxSearch.sandbox?.sandboxExecution?.executionBackend === "in_process", "runtime_search 应走 in_process backend");
  assert((sandboxSearch.sandbox?.sandboxExecution?.output?.hits || []).length >= 1, "sandbox runtime_search 应至少命中一条");
  const sandboxListResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runtime/actions?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      interactionMode: "command",
      executionMode: "execute",
      confirmExecution: true,
      currentGoal: "验证 sandbox action 是否能安全列举 allowlist 目录",
      requestedAction: `列举 ${dataDir} 目录`,
      requestedCapability: "filesystem_list",
      requestedActionType: "list",
      targetResource: dataDir,
      sourceWindowId: "window_smoke_ui",
      recordedByAgentId: "agent_openneed_agents",
      recordedByWindowId: "window_smoke_ui",
      persistRun: false,
      autoCompact: false,
      sandboxAction: {
        capability: "filesystem_list",
        actionType: "list",
        targetResource: dataDir,
        path: dataDir,
        sourceWindowId: "window_smoke_ui",
        recordedByAgentId: "agent_openneed_agents",
        recordedByWindowId: "window_smoke_ui",
      },
    }),
  });
  assert(sandboxListResponse.ok, "sandbox filesystem_list HTTP 请求失败");
  const sandboxList = await sandboxListResponse.json();
  assert(sandboxList.sandbox?.status === "completed", "sandbox filesystem_list 应返回 completed");
  assert(sandboxList.sandbox?.sandboxExecution?.capability === "filesystem_list", "sandbox filesystem_list capability 不匹配");
  assert(sandboxList.sandbox?.sandboxExecution?.executionBackend === "subprocess", "filesystem_list 应走 subprocess backend");
  assert((sandboxList.sandbox?.sandboxExecution?.output?.entries || []).length >= 1, "sandbox filesystem_list 应返回至少一个条目");
  assert(
    sandboxList.sandbox?.sandboxExecution?.output?.brokerIsolation?.boundary === "independent_process",
    "sandbox filesystem_list 应报告独立 broker 边界"
  );
  assert(
    sandboxList.sandbox?.sandboxExecution?.output?.brokerIsolation?.brokerEnvMode === "empty",
    "sandbox filesystem_list 应报告空 broker 环境"
  );
  assert(
    sandboxList.sandbox?.sandboxExecution?.output?.brokerIsolation?.systemSandbox?.enabled === true,
    "sandbox filesystem_list 应报告系统级 broker sandbox 已启用"
  );
  assert(
    sandboxList.sandbox?.sandboxExecution?.output?.workerIsolation?.subprocessWorker === true,
    "sandbox filesystem_list 应报告 subprocess worker"
  );
  assert(
    sandboxList.sandbox?.sandboxExecution?.output?.workerIsolation?.workerEnvMode === "empty",
    "sandbox filesystem_list 应报告空 worker 环境"
  );
  const sandboxAuditList = await getJson("/api/agents/agent_openneed_agents/runtime/actions?didMethod=agentpassport&limit=10");
  assert(Array.isArray(sandboxAuditList.audits), "sandbox audit list 缺少 audits 数组");
  assert(
    sandboxAuditList.audits.some((entry) => entry.capability === "runtime_search"),
    "sandbox audit history 应包含 runtime_search"
  );
  assert(
    sandboxAuditList.audits.some((entry) => entry.capability === "filesystem_list"),
    "sandbox audit history 应包含 filesystem_list"
  );
  const sandboxReadSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-sandbox-reader",
      role: "agent_auditor",
      agentIds: ["agent_openneed_agents"],
      ttlSeconds: 600,
      note: "sandbox action audit read probe",
    }),
  });
  assert(sandboxReadSessionResponse.ok, "创建 sandbox audit read session 失败");
  const sandboxReadSession = await sandboxReadSessionResponse.json();
  const redactedSandboxAuditRead = await fetchWithTokenEventually(
    "/api/agents/agent_openneed_agents/runtime/actions?didMethod=agentpassport&limit=10",
    sandboxReadSession.token,
    {
      label: "agent_auditor /api/agents/:id/runtime/actions",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(redactedSandboxAuditRead.ok, "agent_auditor 应允许读取 sandbox 审计历史");
  const redactedSandboxAuditList = await redactedSandboxAuditRead.json();
  const redactedFilesystemAudit = Array.isArray(redactedSandboxAuditList.audits)
    ? redactedSandboxAuditList.audits.find((entry) => entry.capability === "filesystem_list")
    : null;
  assert(redactedFilesystemAudit, "read session sandbox 审计历史中应包含 filesystem_list");
  assert(
    redactedFilesystemAudit.input?.path == null,
    "read session 读取 sandbox 审计历史时不应看到原始 path"
  );
  assert(
    redactedFilesystemAudit.output?.path == null,
    "read session 读取 sandbox 审计历史时不应看到输出 path"
  );
  const passportMemories = await getJson("/api/agents/agent_openneed_agents/passport-memory?limit=12");
  assert(Array.isArray(passportMemories.memories), "passport-memory 缺少 memories 数组");
  const localReasonerProfileDeleteResponse = await authorizedFetch(
    `/api/device/runtime/local-reasoner/profiles/${encodeURIComponent(localReasonerProfileId)}/delete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: false,
      }),
    }
  );
  assert(localReasonerProfileDeleteResponse.ok, "local reasoner profile delete HTTP 请求失败");
  const localReasonerProfileDelete = await localReasonerProfileDeleteResponse.json();
  assert(
    localReasonerProfileDelete.summary?.profileId === localReasonerProfileId,
    "local reasoner profile delete summary.profileId 不匹配"
  );
  const localReasonerProfileListAfterDelete = await getJson("/api/device/runtime/local-reasoner/profiles?limit=20");
  assert(
    !localReasonerProfileListAfterDelete.profiles.some((entry) => entry.profileId === localReasonerProfileId),
    "local reasoner profile delete 后不应再出现在列表里"
  );
  const contextBuilderResponse = await authorizedFetch("/api/agents/agent_openneed_agents/context-builder?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证 context builder 是否会从本地参考层重建上下文",
      query: minuteToken,
      recentConversationTurns: [
        { role: "user", content: "不要再从整段历史里猜身份" },
        { role: "assistant", content: "上下文要按槽位重建" },
      ],
      toolResults: [
        { tool: "runtime", result: "rehydrate ready" },
      ],
    }),
  });
  assert(contextBuilderResponse.ok, "context-builder HTTP 请求失败");
  const contextBuilder = await contextBuilderResponse.json();
  assert(contextBuilder.contextBuilder?.slots?.identitySnapshot?.agentId === "agent_openneed_agents", "context-builder 没保住 identitySnapshot.agentId");
  assert(Array.isArray(contextBuilder.contextBuilder?.slots?.relevantEpisodicMemories), "context-builder 缺少 episodic memories");
  assert(
    (contextBuilder.contextBuilder?.localKnowledge?.hits?.length ||
      contextBuilder.contextBuilder?.slots?.localKnowledgeHits?.length ||
      0) >= 1,
    "context-builder 没把本地知识层接进 localKnowledge"
  );
  const responseVerifyResponse = await authorizedFetch("/api/agents/agent_openneed_agents/response-verify?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseText: "agent_id: agent_treasury",
      claims: {
        agentId: "agent_treasury",
      },
    }),
  });
  assert(responseVerifyResponse.ok, "response-verify HTTP 请求失败");
  const responseVerification = await responseVerifyResponse.json();
  assert(responseVerification.verification?.valid === false, "错误 agent_id 应该被 verifier 拦住");
  assert(
    Array.isArray(responseVerification.verification?.issues) &&
      responseVerification.verification.issues.some((issue) => issue.code === "agent_id_mismatch"),
    "response verifier 没有返回 agent_id_mismatch"
  );
  const transcript = await getJson("/api/agents/agent_openneed_agents/transcript?family=runtime&limit=12");
  assert(Array.isArray(transcript.entries), "transcript 缺少 entries 数组");
  assert(transcript.transcript?.entryCount >= transcript.entries.length, "transcript.entryCount 不应小于 entries.length");
  assert(Array.isArray(transcript.transcript?.messageBlocks), "transcript 应返回 messageBlocks");

  const ollamaRuntimePreviewResponse = await authorizedFetch("/api/device/runtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      residentAgentId: "agent_openneed_agents",
      residentDidMethod: "agentpassport",
      localMode: "local_only",
      allowOnlineReasoner: false,
      localReasonerEnabled: true,
      localReasonerProvider: "ollama_local",
      localReasonerBaseUrl: "http://127.0.0.1:11434",
      localReasonerModel: "qwen2.5:7b",
      dryRun: true,
    }),
  });
  assert(ollamaRuntimePreviewResponse.ok, "ollama_local runtime dry-run 失败");
  const ollamaRuntimePreview = await ollamaRuntimePreviewResponse.json();
  assert(ollamaRuntimePreview.deviceRuntime?.localReasoner?.provider === "ollama_local", "ollama_local runtime dry-run 应保留 provider");
  assert(ollamaRuntimePreview.deviceRuntime?.localReasoner?.configured === true, "ollama_local runtime dry-run 应判定 configured");
  const runnerResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runner?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
    }),
  });
  assert(runnerResponse.ok, "runner HTTP 请求失败");
  const runner = await runnerResponse.json();
  assertMismatchedIdentityRunnerGate(runner, "错误回复的 runner gate 不符合预期");
  assert(runner.runner?.autoRecovery?.requested === true, "runner API 应默认开启 autoRecover");
  assert(runner.runner?.queryState?.budget?.maxQueryIterations >= 1, "runner 应返回 queryState budget");
  const localCommandRunnerResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runner?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证 local_command reasoner 是否已接入 runtime",
      userTurn: "请按本地参考层的真实身份继续推进",
      reasonerProvider: "local_command",
      autoCompact: false,
      persistRun: false,
      storeToolResults: false,
      turnCount: 1,
      estimatedContextChars: 900,
    }),
  });
  assert(localCommandRunnerResponse.ok, "local_command runner HTTP 请求失败");
  const localCommandRunner = await localCommandRunnerResponse.json();
  assert(localCommandRunner.runner?.reasoner?.provider === "local_command", "local_command runner 应返回正确 provider");
  assert(localCommandRunner.runner?.verification?.valid === true, "local_command runner 应通过 verifier");
  const mockRunnerResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runner?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证 mock reasoner 是否能生成安全候选回复",
      userTurn: "请按本地参考层的真实身份继续推进",
      reasonerProvider: "local_mock",
      autoCompact: false,
      persistRun: false,
      storeToolResults: false,
      turnCount: 1,
      estimatedContextChars: 800,
    }),
  });
  assert(mockRunnerResponse.ok, "mock runner HTTP 请求失败");
  const mockRunner = await mockRunnerResponse.json();
  assert(mockRunner.runner?.run?.status !== "prepared", "mock reasoner 不应退回 prepared");
  if (mockRunner.runner?.run?.status === "bootstrap_required") {
    assert(mockRunner.runner?.bootstrapGate?.required === true, "bootstrap_required 时应返回 bootstrapGate.required");
  } else {
    assert(mockRunner.runner?.verification?.valid === true, "mock reasoner 的 verification 应该通过");
    assert(mockRunner.runner?.reasoner?.provider === "local_mock", "mock runner 应报告 reasoner=local_mock");
    assert(mockRunner.runner?.queryState?.currentIteration >= 1, "mock runner 应返回 queryState");
  }
  const negotiationRunnerResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runner?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证命令协商环是否先商量再执行",
      userTurn: "请直接删除本地历史资料",
      interactionMode: "command",
      requestedAction: "删除本地历史资料",
      executionMode: "execute",
      confirmExecution: false,
      autoCompact: false,
      persistRun: false,
      storeToolResults: false,
      turnCount: 1,
      estimatedContextChars: 600,
    }),
  });
  assert(negotiationRunnerResponse.ok, "negotiation runner HTTP 请求失败");
  const negotiationRunner = await negotiationRunnerResponse.json();
  assert(negotiationRunner.runner?.negotiation?.riskTier === "critical", "删除类命令应被判成 critical");
  assert(negotiationRunner.runner?.negotiation?.authorizationStrategy === "multisig", "critical 动作应升级为 multisig 策略");
  assert(negotiationRunner.runner?.negotiation?.decision === "multisig", "critical 命令应进入 multisig 冷路径");
  assert(negotiationRunner.runner?.run?.status === "negotiation_required", "高风险命令不应直接 completed");
  const sessionState = await getJson("/api/agents/agent_openneed_agents/session-state?didMethod=agentpassport");
  assert(sessionState.sessionState?.agentId === "agent_openneed_agents", "session state agentId 不匹配");
  assert(sessionState.sessionState?.localMode, "session state 应返回 localMode");
  const cognitiveState = await getJson("/api/agents/agent_openneed_agents/cognitive-state?didMethod=agentpassport");
  assert(cognitiveState.cognitiveState?.mode, "cognitive-state 应返回 mode");
  assert(
    cognitiveState.cognitiveState?.interoceptiveState?.bodyBudget != null,
    "cognitive-state 应返回 interoceptiveState.bodyBudget"
  );
  assert(
    cognitiveState.cognitiveState?.replayOrchestration?.replayMode,
    "cognitive-state 应返回 replayOrchestration.replayMode"
  );
  const cognitiveTransitions = await getJson("/api/agents/agent_openneed_agents/cognitive-transitions?limit=5");
  assert(Array.isArray(cognitiveTransitions.transitions), "cognitive-transitions 缺少 transitions 数组");
  const compactBoundaries = await getJson("/api/agents/agent_openneed_agents/compact-boundaries?limit=5");
  assert(Array.isArray(compactBoundaries.compactBoundaries), "compact boundaries 缺少 compactBoundaries 数组");
  const offlineReplayResponse = await authorizedFetch("/api/agents/agent_openneed_agents/offline-replay?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证首页连续认知闭环与离线 replay 接口",
      sourceWindowId: "window_smoke_ui",
      recordedByWindowId: "window_smoke_ui",
      recordedByAgentId: "agent_openneed_agents",
    }),
  });
  assert(offlineReplayResponse.ok, "offline replay HTTP 请求失败");
  const offlineReplay = await offlineReplayResponse.json();
  assert(offlineReplay.offlineReplay?.generatedAt, "offline replay 缺少 generatedAt");
  assert(
    offlineReplay.offlineReplay?.maintenance?.offlineReplay?.reason,
    "offline replay 缺少 maintenance.offlineReplay.reason"
  );
  assert(
    offlineReplay.offlineReplay?.memoryLayers?.counts &&
      typeof offlineReplay.offlineReplay.memoryLayers.counts === "object" &&
      Array.isArray(offlineReplay.offlineReplay?.memoryLayers?.relevant?.episodic),
    "offline replay 缺少 memoryLayers.counts / relevant.episodic"
  );
  let resumedRehydrate = null;
  let autoRecoveredRunner = null;
  const latestBoundaryId = compactBoundaries.compactBoundaries?.at?.(-1)?.compactBoundaryId || compactBoundaries.compactBoundaries?.[0]?.compactBoundaryId || null;
  if (latestBoundaryId) {
    resumedRehydrate = await getJson(
      `/api/agents/agent_openneed_agents/runtime/rehydrate?didMethod=agentpassport&resumeFromCompactBoundaryId=${encodeURIComponent(latestBoundaryId)}`
        + `&${LITE_RUNTIME_QUERY}`
    );
    assert(
      resumedRehydrate.rehydrate?.resumeBoundary?.compactBoundaryId === latestBoundaryId,
      "rehydrate resumeBoundary 与 compact boundary 不匹配"
    );
    const autoRecoveredRunnerResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runner?didMethod=agentpassport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentGoal: "验证 runner HTTP auto recovery 是否能自动续跑",
        userTurn: "请继续推进当前任务",
        reasonerProvider: "local_mock",
        maxRecoveryAttempts: 1,
        autoCompact: false,
        persistRun: false,
        writeConversationTurns: false,
        storeToolResults: false,
        turnCount: 18,
        estimatedContextChars: 24000,
        resumeFromCompactBoundaryId: latestBoundaryId,
      }),
    });
    assert(autoRecoveredRunnerResponse.ok, "auto recovery runner HTTP 请求失败");
    autoRecoveredRunner = await autoRecoveredRunnerResponse.json();
    assert(autoRecoveredRunner.runner?.autoResumed === true, "runner HTTP auto recovery 应触发自动续跑");
    assert(
      Array.isArray(autoRecoveredRunner.runner?.recoveryChain) && autoRecoveredRunner.runner.recoveryChain.length >= 2,
      "runner HTTP auto recovery 应返回 recoveryChain"
    );
    assert(
      autoRecoveredRunner.runner?.recoveryChain?.[0]?.runStatus === "rehydrate_required",
      "runner HTTP auto recovery 首段应从 rehydrate_required 开始"
    );
    assert(
      autoRecoveredRunner.runner?.run?.status !== "rehydrate_required",
      "runner HTTP auto recovery 续跑后不应仍停在 rehydrate_required"
    );
    assert(
      Array.isArray(autoRecoveredRunner.runner?.autoRecovery?.closure?.phases) &&
        autoRecoveredRunner.runner.autoRecovery.closure.phases.length >= 5,
      "runner HTTP auto recovery 应返回 closure phases"
    );
  }
  const retryWithoutExecutionRunnerResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runner?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
      maxRecoveryAttempts: 1,
      persistRun: true,
      autoCompact: false,
      writeConversationTurns: false,
      storeToolResults: false,
      turnCount: 1,
      estimatedContextChars: 600,
      estimatedContextTokens: 200,
    }),
  });
  assert(retryWithoutExecutionRunnerResponse.ok, "retry_without_execution runner HTTP 请求失败");
  const retryWithoutExecutionRunner = await retryWithoutExecutionRunnerResponse.json();
  assert(
    retryWithoutExecutionRunner.runner?.autoRecovery?.plan?.action === "retry_without_execution",
    "runner HTTP 应为受限执行阻断生成 retry_without_execution 自动恢复计划"
  );
  assert(
    retryWithoutExecutionRunner.runner?.autoRecovery?.status === "resumed",
    "runner HTTP retry_without_execution 自动恢复应完成一次续跑"
  );
  assert(
    retryWithoutExecutionRunner.runner?.run?.status === "completed",
    "runner HTTP retry_without_execution 自动恢复续跑后应回到 completed"
  );
  assert(
    Array.isArray(retryWithoutExecutionRunner.runner?.recoveryChain) &&
      retryWithoutExecutionRunner.runner.recoveryChain.length >= 2,
    "runner HTTP retry_without_execution 自动恢复应返回 recoveryChain"
  );
  assert(
    retryWithoutExecutionRunner.runner?.autoRecovery?.closure?.phases?.some((entry) => entry.phaseId === "outcome"),
    "runner HTTP retry_without_execution 自动恢复应返回 closure outcome phase"
  );
  const verificationRunResponse = await authorizedFetch("/api/agents/agent_openneed_agents/verification-runs?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证 runtime integrity 是否可追溯",
      mode: "runtime_integrity",
      persistRun: false,
      sourceWindowId: "window_demo_1",
    }),
  });
  assert(verificationRunResponse.ok, "verification run HTTP 请求失败");
  const verificationRun = await verificationRunResponse.json();
  assert(verificationRun.verificationRun?.status, "verification run 缺少 status");
  assert(
    Array.isArray(verificationRun.verificationRun?.checks) &&
      verificationRun.verificationRun.checks.some((check) => check.code === "adversarial_identity_probe"),
    "verification run 缺少 adversarial_identity_probe"
  );
  const verificationHistory = await getJson("/api/agents/agent_openneed_agents/verification-runs?limit=5");
  assert(Array.isArray(verificationHistory.verificationRuns), "verification history 缺少 verificationRuns 数组");
  const runnerHistory = await getJson("/api/agents/agent_openneed_agents/runner?limit=5");
  assert(Array.isArray(runnerHistory.runs), "runner history 缺少 runs 数组");
  assert(Array.isArray(runnerHistory.autoRecoveryAudits), "runner history 缺少 autoRecoveryAudits 数组");
  assert(
    runnerHistory.autoRecoveryAudits.some((entry) => entry?.closure?.phases?.some((phase) => phase.phaseId === "outcome")),
    "runner history 应返回已落盘的 auto recovery closure 审计"
  );
  const driftCheckResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runtime/drift-check?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证 runtime drift check 是否可用",
      nextAction: "执行 grant_asset",
      turnCount: 18,
      estimatedContextChars: 24000,
    }),
  });
  assert(driftCheckResponse.ok, "drift-check HTTP 请求失败");
  const driftCheck = await driftCheckResponse.json();
  assert(driftCheck.driftCheck?.requiresRehydrate === true, "高 turn/context 的 drift-check 应该触发 rehydrate");
  const driftBlockedRunnerResponse = await authorizedFetch("/api/agents/agent_openneed_agents/runner?didMethod=agentpassport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
    }),
  });
  assert(driftBlockedRunnerResponse.ok, "drift-gated runner HTTP 请求失败");
  const driftBlockedRunner = await driftBlockedRunnerResponse.json();
  assert(driftBlockedRunner.runner?.run?.status === "rehydrate_required", "drift-gated runner 应先进入 rehydrate_required");
  assert(driftBlockedRunner.runner?.sandboxExecution?.executed !== true, "drift-gated runner 不应真的执行 sandbox");
  assert(
    driftBlockedRunner.runner?.sandboxExecution?.blockedBy === "rehydrate_required",
    "drift-gated runner 应标记 sandbox 被 rehydrate_required 拦截"
  );
  assert(driftBlockedRunner.runner?.sandboxExecution?.output == null, "drift-gated runner 不应返回 sandbox output");
  assert(openneedCredential.credential?.credentialRecord?.issuerDidMethod === "openneed", "openneed credential did method 异常");
  assert(
    agentpassportCredential.credential?.credentialRecord?.issuerDidMethod === "agentpassport",
    "agentpassport credential did method 异常"
  );
  assert(
    openneedCredential.credential?.credential?.issuer !== agentpassportCredential.credential?.credential?.issuer,
    "切换 didMethod 后 credential issuer 不应相同"
  );
  const statusLists = agentContext.context?.statusLists || [];
  const selectedStatusListId =
    agentContext.context?.statusList?.statusListId ||
    statusLists[0]?.statusListId ||
    null;
  assert(selectedStatusListId, "当前没有可用的 status list");

  const selectedStatusList = await getJson(`/api/status-lists/${encodeURIComponent(selectedStatusListId)}`);
  assert(selectedStatusList.summary?.statusListId === selectedStatusListId, "status list 详情与 selectedStatusListId 不匹配");

  const compareStatusListId =
    statusLists.find((entry) => entry?.statusListId && entry.statusListId !== selectedStatusListId)?.statusListId || null;
  if (compareStatusListId) {
    const comparison = await getJson(
      `/api/status-lists/compare?leftStatusListId=${encodeURIComponent(selectedStatusListId)}&rightStatusListId=${encodeURIComponent(compareStatusListId)}`
    );
    assert(comparison.leftStatusListId === selectedStatusListId, "status list compare 左侧 ID 不匹配");
    assert(comparison.rightStatusListId === compareStatusListId, "status list compare 右侧 ID 不匹配");
  }

  const firstRepair = repairs.repairs?.[0] || null;
  if (!firstRepair?.repairId) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          health,
          repairsChecked: 0,
          note: "当前账本没有 repair 记录，已完成页面和健康检查。",
        },
        null,
        2
      )
    );
    return;
  }

  const repairId = firstRepair.repairId;
  const repairDetail = await getJson(`/api/migration-repairs/${encodeURIComponent(repairId)}?didMethod=agentpassport`);
  assert(repairDetail.repair?.repairId === repairId, "repair 详情与 repairId 不匹配");

  const repairCredentials = await getJson(
    `/api/migration-repairs/${encodeURIComponent(repairId)}/credentials?didMethod=agentpassport&limit=20&sortBy=latestRepairAt&sortOrder=desc`
  );
  assert(Array.isArray(repairCredentials.credentials), "repair credentials 没有 credentials 数组");

  const firstCredential =
    repairCredentials.credentials.find((entry) => entry.issuerDidMethod === "agentpassport") ||
    repairCredentials.credentials[0] ||
    null;

  if (firstCredential?.credentialRecordId || firstCredential?.credentialId) {
    const credentialId = firstCredential.credentialRecordId || firstCredential.credentialId;
    const credentialDetail = await getJson(`/api/credentials/${encodeURIComponent(credentialId)}`);
    const credentialTimeline = await getJson(`/api/credentials/${encodeURIComponent(credentialId)}/timeline`);
    const credentialStatus = await getJson(`/api/credentials/${encodeURIComponent(credentialId)}/status`);

    assert(
      credentialDetail.credentialRecord?.credentialRecordId === credentialId ||
        credentialDetail.credentialRecord?.credentialId === credentialId,
      "credential 详情与 credentialId 不匹配"
    );
    assert(Array.isArray(credentialTimeline.timeline), "credential timeline 缺少 timeline 数组");
    assert(credentialStatus.statusProof || credentialStatus.statusListSummary, "credential status 缺少状态证明");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        health,
        hostBinding: security.hostBinding,
        keychainPreferred: security.keyManagement?.keychainPreferred || false,
        keychainAvailable: security.keyManagement?.keychainAvailable || false,
        storeKeySource: security.keyManagement?.storeKey?.source || null,
        signingKeySource: security.keyManagement?.signingKey?.source || null,
        localLedgerPath: security.localStore?.ledgerPath || null,
        localRecoveryDir: security.localStore?.recoveryDir || null,
        protocolTagline: protocol.productPositioning?.tagline || null,
        roadmapHeadline: roadmap.roadmap?.headline || null,
        recoveryBundleId: recoveryExport.summary?.bundleId || null,
        recoveryBundleCount: recoveryList.counts?.total || recoveryList.bundles.length || 0,
        recoveryRehearsalStatus: recoveryVerify.rehearsal?.status || null,
        recoveryRehearsalCount: recoveryRehearsals.counts?.total || recoveryRehearsals.rehearsals.length || 0,
        keychainMigrationDryRun: keychainMigration.migration?.dryRun || false,
        keychainMigrationSkipped: keychainMigration.migration?.skipped || false,
        keychainMigrationReason: keychainMigration.migration?.reason || null,
        deviceSetupComplete: setupStatus.setupComplete || false,
        deviceSetupRunComplete: setupRun.status?.setupComplete || false,
        setupPackageId: setupPackageExport.summary?.packageId || setupPackagePreview.summary?.packageId || null,
        savedSetupPackageId,
        housekeepingAuditMode: housekeepingAudit.mode || null,
        localReasonerStatus: localReasonerStatus.diagnostics?.status || null,
        localReasonerCatalogProviderCount: localReasonerCatalog.providers.length || 0,
        localReasonerProbeStatus: localReasonerProbe.diagnostics?.status || null,
        localReasonerSelectedProvider: localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.provider || null,
        localReasonerPrewarmStatus: localReasonerPrewarm.warmState?.status || null,
        localReasonerProfileId,
        localReasonerProfileCount: localReasonerProfileList.counts?.total || localReasonerProfileList.profiles.length || 0,
        localReasonerRestoreCandidateCount:
          localReasonerRestoreCandidates.counts?.total || localReasonerRestoreCandidates.restoreCandidates.length || 0,
        localReasonerRestoreProfileId: localReasonerRestore.restoredProfileId || null,
        localReasonerRestoreWarmStatus: localReasonerRestore.prewarmResult?.warmState?.status || null,
        setupPackageCount: setupPackageList.counts?.total || setupPackageList.packages.length || 0,
        setupPackageProfileCount: savedSetupPackageDetail.summary?.localReasonerProfileCount || 0,
        setupPackagePruneDeleted: setupPackagePrune.counts?.deleted || 0,
        repairId,
        checkedCredentialId: firstCredential?.credentialRecordId || firstCredential?.credentialId || null,
        activeAgentId: agentContext.context?.agent?.agentId || null,
        activeDidMethod: "agentpassport",
        checkedWindowId: checkedWindow?.window?.windowId || null,
        checkedWindowAgentId: checkedWindow?.window?.agentId || null,
        runtimeSnapshotId: runtime.runtime?.taskSnapshot?.snapshotId || null,
        runtimeSummaryDominantRhythm: runtimeSummary.summary?.cognition?.dynamics?.dominantRhythm || null,
        runtimeSummaryReplayMode: runtimeSummary.summary?.cognition?.dynamics?.replayOrchestration?.replayMode || null,
        retrievalStrategy: runtime.runtime?.deviceRuntime?.retrievalPolicy?.strategy || null,
        retrievalVectorEnabled: runtime.runtime?.deviceRuntime?.retrievalPolicy?.allowVectorIndex || false,
        sandboxAllowedCapabilities: runtime.runtime?.deviceRuntime?.sandboxPolicy?.allowedCapabilities?.length || 0,
        localReasonerProvider: runtimeAfterConfig.runtime?.deviceRuntime?.localReasoner?.provider || null,
        localReasonerConfigured: runtimeAfterConfig.runtime?.deviceRuntime?.localReasoner?.configured || false,
        readSessionCount: readSessionList.sessions.length || 0,
        bootstrapDryRun: bootstrap.bootstrap?.dryRun || false,
        bootstrapProfileWrites: bootstrap.bootstrap?.summary?.profileWriteCount || 0,
        conversationMinuteId: minuteResult.minute?.minuteId || null,
        conversationMinuteCount: conversationMinutes.counts?.total || conversationMinutes.minutes.length || 0,
        transcriptEntryCount: transcript.transcript?.entryCount || transcript.entries.length || 0,
        transcriptBlockCount: transcript.transcript?.messageBlocks?.length || 0,
        runtimeSearchHits: runtimeSearch.hits.length || 0,
        runtimeSearchStrategy: runtimeSearch.retrieval?.strategy || null,
        sandboxAuditCount: sandboxAuditList.counts?.total || sandboxAuditList.audits.length || 0,
        sandboxSearchHits: sandboxSearch.sandbox?.sandboxExecution?.output?.hits?.length || 0,
        sandboxListEntries: sandboxList.sandbox?.sandboxExecution?.output?.entries?.length || 0,
        contextBuilderLocalKnowledgeHits:
          contextBuilder.contextBuilder?.localKnowledge?.hits?.length ||
          contextBuilder.contextBuilder?.slots?.localKnowledgeHits?.length ||
          0,
        rehydratePackHash: rehydrate.rehydrate?.packHash || null,
        resumedBoundaryId: resumedRehydrate?.rehydrate?.resumeBoundary?.compactBoundaryId || null,
        passportMemoryCount: passportMemories.counts?.filtered || passportMemories.memories.length || 0,
        contextBuilderHash: contextBuilder.contextBuilder?.contextHash || null,
        responseVerifierIssues: responseVerification.verification?.issues?.length || 0,
        runnerStatus: runner.runner?.run?.status || null,
        localCommandRunnerStatus: localCommandRunner.runner?.run?.status || null,
        localCommandReasonerProvider: localCommandRunner.runner?.reasoner?.provider || null,
        ollamaLocalProvider: ollamaRuntimePreview.deviceRuntime?.localReasoner?.provider || null,
        mockRunnerStatus: mockRunner.runner?.run?.status || null,
        mockReasonerProvider: mockRunner.runner?.reasoner?.provider || null,
        negotiationRiskTier: negotiationRunner.runner?.negotiation?.riskTier || null,
        negotiationAuthorizationStrategy: negotiationRunner.runner?.negotiation?.authorizationStrategy || null,
        sessionStateId: sessionState.sessionState?.sessionStateId || null,
        compactBoundaryCount: compactBoundaries.counts?.filtered || compactBoundaries.compactBoundaries.length || 0,
        verificationRunStatus: verificationRun.verificationRun?.status || null,
        verificationHistoryCount: verificationHistory.counts?.filtered || verificationHistory.verificationRuns.length || 0,
        runnerHistoryCount: runnerHistory.counts?.filtered || runnerHistory.runs.length || 0,
        driftRequiresRehydrate: driftCheck.driftCheck?.requiresRehydrate || false,
        selectedStatusListId,
        compareStatusListId,
        repairCount: repairs.counts?.total || repairs.repairs.length || 0,
        windowCount: windows.windows.length,
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
        baseUrl,
        error: error.message,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});

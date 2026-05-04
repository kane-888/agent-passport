import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { assert, assertBrokerSystemSandboxTruth, sleep } from "./smoke-shared.mjs";
import { createSmokeLogger, localReasonerFixturePath, resolveBaseUrl, rootDir } from "./smoke-env.mjs";
import {
  AGENT_PASSPORT_MAIN_AGENT_ID,
  LEGACY_OPENNEED_AGENT_ID,
} from "../src/main-agent-compat.js";
import {
  summarizeConversationMemoryExpectation,
  summarizeExecutionHistoryExpectation,
  summarizeLocalReasonerLifecycleExpectation,
  summarizeLocalReasonerRestoreExpectation,
  summarizeSandboxAuditExpectation,
  summarizeSetupPackageExpectation,
} from "./smoke-expectations.mjs";
import { createSmokeHttpClient } from "./smoke-ui-http.mjs";

const baseUrl = resolveBaseUrl();
const dataDir = path.join(rootDir, "data");
const LITE_RUNTIME_QUERY = "runtimeLimit=3&messageLimit=3&memoryLimit=3&authorizationLimit=3&credentialLimit=3";
const LITE_AGENT_CONTEXT_QUERY = `didMethod=agentpassport&${LITE_RUNTIME_QUERY}`;
const LITE_REHYDRATE_QUERY = `didMethod=agentpassport&${LITE_RUNTIME_QUERY}`;
const MAIN_AGENT_ID = AGENT_PASSPORT_MAIN_AGENT_ID;
const MAIN_AGENT_PHYSICAL_ID_FALLBACK = LEGACY_OPENNEED_AGENT_ID;
const traceSmoke = createSmokeLogger("smoke-ui:operational");
const {
  authorizedFetch,
  drainResponse,
  fetchWithToken,
  getAdminToken,
  getJson,
  publicGetJson,
  setAdminToken,
} = createSmokeHttpClient({
  baseUrl,
  rootDir,
  trace: traceSmoke,
});
let resolvedMainAgentPhysicalId = MAIN_AGENT_PHYSICAL_ID_FALLBACK;

function mainAgentApiPath(pathname = "") {
  return `/api/agents/${MAIN_AGENT_ID}${pathname}`;
}

function text(value) {
  return String(value ?? "").trim();
}

function currentMainAgentPhysicalId() {
  return text(resolvedMainAgentPhysicalId) || MAIN_AGENT_PHYSICAL_ID_FALLBACK;
}

function rememberMainAgentPhysicalId(...candidates) {
  for (const candidate of candidates) {
    const normalized = text(candidate);
    if (!normalized || normalized === MAIN_AGENT_ID) {
      continue;
    }
    resolvedMainAgentPhysicalId = normalized;
    return normalized;
  }
  return currentMainAgentPhysicalId();
}

const EVENTUAL_JSON_SUMMARY_MAX_CHARS = 1200;
const EVENTUAL_JSON_SUMMARY_KEYS = [
  "ok",
  "status",
  "ready",
  "reachable",
  "setupComplete",
  "readinessClass",
  "errorClass",
  "errorStage",
  "code",
  "category",
  "severity",
  "reason",
  "message",
  "summary",
  "nextAction",
  "agentId",
  "runId",
  "verificationRunId",
  "minuteId",
  "compactBoundaryId",
  "relatedRunId",
  "anomalyId",
  "packageId",
  "profileId",
  "bundleId",
  "rehearsalId",
  "entryCount",
  "failureCount",
  "total",
  "filtered",
  "missingRequiredCodes",
];
const EVENTUAL_JSON_NESTED_SUMMARY_KEYS = new Set([
  "counts",
  "summary",
  "diagnostics",
  "transcript",
  "runner",
  "autoRecovery",
  "readiness",
  "setupStatus",
  "failureSemantics",
]);

function abbreviateEventualFailureText(value) {
  const text = String(value);
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}

function summarizeJsonForEventualFailure(value, depth = 0) {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return abbreviateEventualFailureText(value);
  }
  if (Array.isArray(value)) {
    const summary = { count: value.length };
    if (value.length > 0 && depth < 2) {
      summary.first = summarizeJsonForEventualFailure(value[0], depth + 1);
    }
    return summary;
  }
  if (value && typeof value === "object") {
    const summary = {};
    const entries = Object.entries(value);
    for (const [key, child] of entries) {
      if (
        EVENTUAL_JSON_SUMMARY_KEYS.includes(key) ||
        EVENTUAL_JSON_NESTED_SUMMARY_KEYS.has(key) ||
        Array.isArray(child)
      ) {
        const summarized = summarizeJsonForEventualFailure(child, depth + 1);
        if (summarized !== undefined) {
          summary[key] = summarized;
        }
      }
    }
    if (Object.keys(summary).length === 0) {
      summary.topLevelKeys = entries.map(([key]) => key).slice(0, 12);
    }
    return summary;
  }
  return undefined;
}

function formatJsonSummaryForEventualFailure(value) {
  const serialized = JSON.stringify(summarizeJsonForEventualFailure(value)) ?? "undefined";
  return serialized.length > EVENTUAL_JSON_SUMMARY_MAX_CHARS
    ? `${serialized.slice(0, EVENTUAL_JSON_SUMMARY_MAX_CHARS)}...`
    : serialized;
}

function buildGetJsonEventuallyFailureError(
  label,
  attempts,
  { lastJson = null, lastJsonAttempt = null, lastError = null } = {}
) {
  if (lastJson === null) {
    return lastError || new Error(`${label} did not become ready after ${attempts} attempts`);
  }
  const lastErrorDetail = lastError?.message ? `; lastError=${abbreviateEventualFailureText(lastError.message)}` : "";
  return new Error(
    `${label} did not become ready after ${attempts} attempts; lastJsonAttempt=${
      lastJsonAttempt ?? "unknown"
    }; lastJsonSummary=${formatJsonSummaryForEventualFailure(lastJson)}${lastErrorDetail}`
  );
}

function assertFailureSemanticsEnvelope(value, label) {
  assert(value && typeof value === "object", `${label} 应返回对象`);
  assert(["clear", "present"].includes(String(value.status || "")), `${label}.status 应为 clear 或 present`);
  assert(Number.isFinite(Number(value.failureCount)), `${label}.failureCount 应为合法数字`);
  assert(Array.isArray(value.failures), `${label}.failures 应为数组`);
  assert(Number(value.failureCount) === value.failures.length, `${label}.failureCount 应与 failures.length 一致`);

  if (value.status === "clear") {
    assert(value.failureCount === 0, `${label} 在 clear 状态下 failureCount 应为 0`);
    assert(value.primaryFailure == null, `${label} 在 clear 状态下 primaryFailure 应为空`);
    return;
  }

  assert(value.failureCount >= 1, `${label} 在 present 状态下至少应有 1 个 failure`);
  assert(value.primaryFailure && typeof value.primaryFailure === "object", `${label}.primaryFailure 应存在`);
  assert(typeof value.primaryFailure.code === "string" && value.primaryFailure.code.length > 0, `${label}.primaryFailure.code 缺失`);
  assert(typeof value.primaryFailure.category === "string" && value.primaryFailure.category.length > 0, `${label}.primaryFailure.category 缺失`);
  assert(typeof value.primaryFailure.boundary === "string" && value.primaryFailure.boundary.length > 0, `${label}.primaryFailure.boundary 缺失`);
  assert(typeof value.primaryFailure.severity === "string" && value.primaryFailure.severity.length > 0, `${label}.primaryFailure.severity 缺失`);
  assert(typeof value.primaryFailure.machineAction === "string" && value.primaryFailure.machineAction.length > 0, `${label}.primaryFailure.machineAction 缺失`);
  assert(typeof value.primaryFailure.operatorAction === "string" && value.primaryFailure.operatorAction.length > 0, `${label}.primaryFailure.operatorAction 缺失`);
  assert(typeof value.primaryFailure.sourceType === "string" && value.primaryFailure.sourceType.length > 0, `${label}.primaryFailure.sourceType 缺失`);
  assert(typeof value.primaryFailure.sourceValue === "string" && value.primaryFailure.sourceValue.length > 0, `${label}.primaryFailure.sourceValue 缺失`);
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
  let lastJsonAttempt = null;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const json = await getJson(resourcePath);
      lastJson = json;
      lastJsonAttempt = attempt + 1;
      lastError = null;
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
  throw buildGetJsonEventuallyFailureError(label, attempts, {
    lastJson,
    lastJsonAttempt,
    lastError,
  });
}

async function timePhase(timings, phase, fn) {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    timings.push({
      phase,
      durationMs: Date.now() - startedAt,
    });
  }
}

async function main() {
  const phaseTimings = [];
  const [health, protocol, security] = await timePhase(phaseTimings, "startup_truth", async () =>
    Promise.all([publicGetJson("/api/health"), publicGetJson("/api/protocol"), getJson("/api/security")])
  );
  assert(health.ok === true, "health.ok 不是 true");
  assert(health.service === "agent-passport", "health.service 应返回 agent-passport");

  let adminTokenRotationMode = "not_attempted";
  let adminTokenRotationOldTokenRejected = null;
  let adminTokenRotationNewTokenAccepted = null;
  let adminTokenRotationReadSessionPreRevokeAllowed = null;
  let adminTokenRotationReadSessionRevoked = null;
  let adminTokenRotationAnomalyRecorded = null;

  const tokenRotationStartedAt = Date.now();
  const [keyManagementAnomaliesBefore, tokenBeforeRotation, rotationSessionCreateResponse] = await Promise.all([
    getJson("/api/security/anomalies?limit=5&category=key_management"),
    getAdminToken(),
    authorizedFetch("/api/security/read-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "smoke-ui-operational-rotation-pre-session",
        role: "runtime_observer",
        ttlSeconds: 600,
        note: "rotation should revoke or invalidate this token later",
      }),
    }),
  ]);
  const previousRotationAnomalyId = keyManagementAnomaliesBefore.anomalies?.[0]?.anomalyId || null;
  assert(rotationSessionCreateResponse.ok, "rotation 前创建 read session 失败");
  const rotationSession = await rotationSessionCreateResponse.json();

  const rotateResponse = await authorizedFetch("/api/security/admin-token/rotate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      revokeReadSessions: false,
      note: "smoke-ui-operational rotation",
      rotatedByAgentId: "agent_spoofed_rotation_actor",
      rotatedByWindowId: "window_spoofed_rotation_actor",
    }),
  });
  assert(rotateResponse.ok, "admin token 轮换失败");
  const rotation = await rotateResponse.json();
  adminTokenRotationMode = rotation.rotation?.rotated ? "rotated" : String(rotation.rotation?.reason || "not_rotated");
  if (rotation.rotation?.rotated) {
    assert(rotation.rotation.token, "admin token 轮换后应返回新 token");
    setAdminToken(rotation.rotation.token);
    const [oldTokenRuntimeRead, preRevokeRead] = await Promise.all([
      fetchWithToken("/api/device/runtime", tokenBeforeRotation),
      fetchWithToken("/api/device/runtime", rotationSession.token),
    ]);
    adminTokenRotationOldTokenRejected = oldTokenRuntimeRead.status === 401;
    assert(oldTokenRuntimeRead.status === 401, "旧 admin token 轮换后应失效");
    adminTokenRotationReadSessionPreRevokeAllowed = preRevokeRead.ok;
    assert(preRevokeRead.ok, "rotation 未撤销 read sessions 时，旧 read session 应暂时仍可读");
    await Promise.all([drainResponse(oldTokenRuntimeRead), drainResponse(preRevokeRead)]);
  } else {
    assert(rotation.rotation?.reason === "env_managed", "未轮换时只应因为 env 管理而跳过");
  }

  const revokeAllResponse = await authorizedFetch("/api/security/read-sessions/revoke-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "smoke-ui-operational revoke all",
      dryRun: false,
    }),
  });
  assert(revokeAllResponse.ok, "全量撤销 read sessions 失败");
  adminTokenRotationNewTokenAccepted = rotation.rotation?.rotated === true ? revokeAllResponse.ok : null;
  const [revokedRotationSessionRead, keyManagementAnomalies] = await Promise.all([
    fetchWithToken("/api/device/runtime", rotationSession.token),
    getJsonEventually("/api/security/anomalies?limit=50&category=key_management", {
      attempts: 3,
      delayMs: 100,
      label: "key management anomalies after token rotation",
      trace: traceSmoke,
      isReady: (json) =>
        rotation.rotation?.rotated !== true ||
        (Array.isArray(json?.anomalies) &&
          json.anomalies[0]?.anomalyId !== previousRotationAnomalyId &&
          json.anomalies[0]?.code === "admin_token_rotated"),
    }),
  ]);
  adminTokenRotationReadSessionRevoked = revokedRotationSessionRead.status === 401;
  assert(revokedRotationSessionRead.status === 401, "revoke-all 后旧 read session 应失效");
  await drainResponse(revokedRotationSessionRead);

  adminTokenRotationAnomalyRecorded =
    rotation.rotation?.rotated !== true ||
    (Array.isArray(keyManagementAnomalies.anomalies) &&
      keyManagementAnomalies.anomalies[0]?.anomalyId !== previousRotationAnomalyId &&
      keyManagementAnomalies.anomalies[0]?.code === "admin_token_rotated");
  assert(adminTokenRotationAnomalyRecorded === true, "security anomalies 应记录 admin_token_rotated");
  phaseTimings.push({
    phase: "token_rotation",
    durationMs: Date.now() - tokenRotationStartedAt,
  });

  const localReasonerStartedAt = Date.now();
  const [agentContext, configuredRuntimeResponse] = await Promise.all([
    getJson(`${mainAgentApiPath("/context")}?${LITE_AGENT_CONTEXT_QUERY}`),
    authorizedFetch("/api/device/runtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        residentAgentId: MAIN_AGENT_ID,
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
    }),
  ]);
  assert(configuredRuntimeResponse.ok, "配置 local_command runtime 失败");
  const configuredRuntime = await configuredRuntimeResponse.json();
  assert(configuredRuntime.deviceRuntime?.localReasoner?.provider === "local_command", "runtime 应切到 local_command");
  assert(configuredRuntime.deviceRuntime?.localReasoner?.configured === true, "runtime local reasoner 应配置完成");
  rememberMainAgentPhysicalId(
    agentContext.context?.agent?.agentId,
    agentContext.context?.runtime?.resolvedResidentAgentId,
    configuredRuntime.deviceRuntime?.resolvedResidentAgentId,
    configuredRuntime.deviceRuntime?.residentAgent?.agentId
  );

  const [runtimeAfterConfig, rehydrate] = await Promise.all([
    getJson(`${mainAgentApiPath("/runtime")}?${LITE_AGENT_CONTEXT_QUERY}`),
    getJson(`${mainAgentApiPath("/runtime/rehydrate")}?${LITE_REHYDRATE_QUERY}`),
  ]);
  rememberMainAgentPhysicalId(
    runtimeAfterConfig.runtime?.agentId,
    runtimeAfterConfig.runtime?.resolvedResidentAgentId,
    rehydrate.rehydrate?.agentId
  );
  assert(typeof rehydrate.rehydrate?.prompt === "string", "rehydrate.prompt 缺失");

  const [localReasonerStatus, localReasonerCatalog, localReasonerProbeResponse] = await Promise.all([
    getJson("/api/device/runtime/local-reasoner"),
    getJson("/api/device/runtime/local-reasoner/catalog"),
    authorizedFetch("/api/device/runtime/local-reasoner/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "local_command",
        command: process.execPath,
        args: [localReasonerFixturePath],
        cwd: rootDir,
      }),
    }),
  ]);
  assert(localReasonerProbeResponse.ok, "local reasoner probe HTTP 请求失败");
  const localReasonerProbe = await localReasonerProbeResponse.json();
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

  const localReasonerProfileSaveResponse = await authorizedFetch("/api/device/runtime/local-reasoner/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-operational-local-command",
      note: `smoke-ui-operational-local-profile-${Date.now()}`,
      source: "current",
      dryRun: false,
    }),
  });
  assert(localReasonerProfileSaveResponse.ok, "local reasoner profile save HTTP 请求失败");
  const localReasonerProfileSave = await localReasonerProfileSaveResponse.json();
  const localReasonerProfileId =
    localReasonerProfileSave.summary?.profileId || localReasonerProfileSave.profile?.profileId || null;
  assert(localReasonerProfileId, "local reasoner profile save 应返回 profileId");

  const [localReasonerProfileList, localReasonerProfileDetail, localReasonerRestoreCandidates] = await Promise.all([
    getJson(`/api/device/runtime/local-reasoner/profiles?limit=1&profileId=${encodeURIComponent(localReasonerProfileId)}`),
    getJson(`/api/device/runtime/local-reasoner/profiles/${encodeURIComponent(localReasonerProfileId)}`),
    getJson(`/api/device/runtime/local-reasoner/restore-candidates?limit=1&profileId=${encodeURIComponent(localReasonerProfileId)}`),
  ]);
  assert(Array.isArray(localReasonerProfileList.profiles), "local reasoner profile list 缺少 profiles 数组");
  assert(
    localReasonerProfileList.profiles.some((entry) => entry.profileId === localReasonerProfileId),
    "local reasoner profile list 应包含新保存的 profile"
  );
  assert(
    localReasonerProfileDetail.profile?.config?.provider === "local_command",
    "local reasoner profile detail 应保留 local_command provider"
  );
  assert(Array.isArray(localReasonerRestoreCandidates.restoreCandidates), "local reasoner restore candidates 缺少 restoreCandidates 数组");
  assert(
    localReasonerRestoreCandidates.restoreCandidates.some((entry) => entry.profileId === localReasonerProfileId),
    "local reasoner restore candidates 应包含新 profile"
  );

  const localReasonerProfileActivateResponse = await authorizedFetch(
    `/api/device/runtime/local-reasoner/profiles/${encodeURIComponent(localReasonerProfileId)}/activate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: false,
        updatedByAgentId: currentMainAgentPhysicalId(),
        updatedByWindowId: "window_demo_1",
        sourceWindowId: "window_demo_1",
      }),
    }
  );
  assert(localReasonerProfileActivateResponse.ok, "local reasoner profile activate HTTP 请求失败");

  const localReasonerRestoreResponse = await authorizedFetch("/api/device/runtime/local-reasoner/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId: localReasonerProfileId,
      prewarm: true,
      prewarmMode: "reuse",
      dryRun: false,
      updatedByAgentId: currentMainAgentPhysicalId(),
      updatedByWindowId: "window_demo_1",
      sourceWindowId: "window_demo_1",
    }),
  });
  assert(localReasonerRestoreResponse.ok, "local reasoner restore HTTP 请求失败");
  const localReasonerRestore = await localReasonerRestoreResponse.json();
  assert(localReasonerRestore.restoredProfileId === localReasonerProfileId, "local reasoner restore profileId 不匹配");
  assert(localReasonerRestore.selectedCandidate?.profileId === localReasonerProfileId, "local reasoner restore 应返回选中的 profile candidate");
  assert(localReasonerRestore.prewarmResult?.warmState?.status === "ready", "local reasoner restore 后应完成 prewarm");
  const localReasonerRestoreCandidateCount =
    localReasonerRestoreCandidates.counts?.total || localReasonerRestoreCandidates.restoreCandidates.length || 0;
  phaseTimings.push({
    phase: "local_reasoner_lifecycle",
    durationMs: Date.now() - localReasonerStartedAt,
  });

  const setupPackageStartedAt = Date.now();
  const packageNotePrefix = `smoke-ui-operational-package-${Date.now()}`;
  const savedSetupPackageExportResponse = await authorizedFetch("/api/device/setup/package", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: `${packageNotePrefix}-old`,
      saveToFile: true,
      returnPackage: false,
      includeLocalReasonerProfiles: true,
      localReasonerProfileIds: [localReasonerProfileId],
      localReasonerProfileLimit: 1,
      dryRun: false,
    }),
  });
  assert(savedSetupPackageExportResponse.ok, "saved device setup package export HTTP 请求失败");
  const savedSetupPackageExport = await savedSetupPackageExportResponse.json();
  const savedSetupPackageId = savedSetupPackageExport.summary?.packageId || null;
  assert(savedSetupPackageId, "saved device setup package export 缺少 packageId");
  const savedSetupPackageDetail = await getJson(`/api/device/setup/packages/${encodeURIComponent(savedSetupPackageId)}`);
  assert(savedSetupPackageDetail.summary?.packageId === savedSetupPackageId, "saved device setup package detail packageId 不匹配");

  const secondSavedSetupPackageResponse = await authorizedFetch("/api/device/setup/package", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: `${packageNotePrefix}-new`,
      saveToFile: true,
      returnPackage: false,
      includeLocalReasonerProfiles: true,
      localReasonerProfileIds: [localReasonerProfileId],
      localReasonerProfileLimit: 1,
      dryRun: false,
    }),
  });
  assert(secondSavedSetupPackageResponse.ok, "second saved device setup package export HTTP 请求失败");

  const setupPackagePruneResponse = await authorizedFetch("/api/device/setup/packages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keepLatest: 1,
      residentAgentId: MAIN_AGENT_ID,
      noteIncludes: packageNotePrefix,
      dryRun: false,
    }),
  });
  assert(setupPackagePruneResponse.ok, "setup package prune HTTP 请求失败");
  const setupPackagePrune = await setupPackagePruneResponse.json();
  assert(setupPackagePrune.counts?.matched === 2, "setup package prune 应精确命中 2 个 smoke packages");
  assert(setupPackagePrune.counts?.deleted >= 1, "setup package prune 应删除至少 1 个 package");
  phaseTimings.push({
    phase: "setup_package_lifecycle",
    durationMs: Date.now() - setupPackageStartedAt,
  });

  const runtimeMemoryStartedAt = Date.now();
  const bootstrapResponse = await authorizedFetch(`${mainAgentApiPath("/runtime/bootstrap")}?didMethod=agentpassport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "让 agent-passport 建立在可恢复、可审计的记忆稳态运行时之上",
      currentGoal: "建立 operational smoke 最小运行态",
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
  assert(bootstrap.sessionState?.sessionStateId, "bootstrap 没返回 session state");

  const minuteToken = `smoke-ui-operational-local-knowledge-${Date.now()}`;
  const minuteResponse = await authorizedFetch(mainAgentApiPath("/runtime/minutes"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Smoke UI Operational 本地纪要 ${minuteToken}`,
      summary: `本地对话纪要用于验证 runtime search 命中 ${minuteToken}`,
      transcript: [
        "结论：Agent 忘记时要先查本地参考层和本地纪要。",
        `唯一标识：${minuteToken}`,
        "恢复路径：conversation minute -> runtime search -> rehydrate。",
      ].join("\n"),
      highlights: ["local search", "conversation minute", minuteToken],
      sourceWindowId: "window_smoke_ui",
      recordedByWindowId: "window_smoke_ui",
      recordedByAgentId: currentMainAgentPhysicalId(),
    }),
  });
  assert(minuteResponse.ok, "conversation minute HTTP 请求失败");
  const minuteResult = await minuteResponse.json();
  assert(minuteResult.minute?.minuteId, "conversation minute 没返回 minuteId");

  const conversationMinutes = await getJsonEventually(`${mainAgentApiPath("/runtime/minutes")}?limit=10`, {
    attempts: 3,
    delayMs: 100,
    label: "runtime minutes list after write",
    trace: traceSmoke,
    isReady: (json) =>
      Array.isArray(json?.minutes) && json.minutes.some((entry) => entry.minuteId === minuteResult.minute.minuteId),
  });
  const runtimeSearch = await getJson(
    `${mainAgentApiPath("/runtime/search")}?didMethod=agentpassport&sourceType=conversation_minute&limit=50&query=${encodeURIComponent(minuteToken)}`
  );
  assert(Array.isArray(runtimeSearch.hits), "runtime search 没有 hits 数组");
  assert(runtimeSearch.hits.length >= 1, "runtime search 应命中至少一条本地纪要");
  assert(
    runtimeSearch.hits.some(
      (entry) =>
        entry?.sourceType === "conversation_minute" &&
        (entry.sourceId === minuteResult.minute.minuteId || entry.linked?.minuteId === minuteResult.minute.minuteId)
    ),
    "runtime search 应命中本次写入的 conversation minute"
  );
  assert(runtimeSearch.retrieval?.strategy === "local_first_non_vector", "runtime search 应声明 local_first_non_vector");
  assert(runtimeSearch.retrieval?.vectorUsed === false, "runtime search 不应使用向量索引");
  phaseTimings.push({
    phase: "runtime_memory",
    durationMs: Date.now() - runtimeMemoryStartedAt,
  });

  const windowGuardStartedAt = Date.now();
  const [repairs, windows] = await Promise.all([
    getJson(`/api/migration-repairs?agentId=${encodeURIComponent(MAIN_AGENT_ID)}&didMethod=agentpassport&limit=5`),
    getJson("/api/windows"),
  ]);
  const firstWindow = windows.windows?.[0] || null;
  let checkedWindow = null;
  let forgedWindowRebindBlocked = null;
  let forgedWindowRebindError = null;
  let windowBindingStableAfterRebind = null;
  if (firstWindow?.windowId) {
    checkedWindow = await getJson(`/api/windows/${encodeURIComponent(firstWindow.windowId)}`);
  }
  if (firstWindow?.windowId && firstWindow?.agentId) {
    const forgedWindowAgentId =
      firstWindow.agentId === currentMainAgentPhysicalId() ? "agent_treasury" : currentMainAgentPhysicalId();
    const forgedWindowLinkResponse = await authorizedFetch("/api/windows/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        windowId: firstWindow.windowId,
        agentId: forgedWindowAgentId,
        label: "forged-window-rebind",
      }),
    });
    forgedWindowRebindBlocked = forgedWindowLinkResponse.status === 400;
    assert(forgedWindowLinkResponse.status === 400, "windows/link 不应允许把既有 windowId 改绑到别的 agent");
    const forgedWindowLinkJson = await forgedWindowLinkResponse.json();
    forgedWindowRebindError = String(forgedWindowLinkJson.error || "");
    const windowAfterForgedRelink = await getJson(`/api/windows/${encodeURIComponent(firstWindow.windowId)}`);
    windowBindingStableAfterRebind = windowAfterForgedRelink.window?.agentId === firstWindow.agentId;
    assert(windowBindingStableAfterRebind === true, "windows/link 不应因为伪造请求改写既有 window 绑定");
  }
  phaseTimings.push({
    phase: "window_rebind_guard",
    durationMs: Date.now() - windowGuardStartedAt,
  });

  const sandboxStartedAt = Date.now();
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, ".smoke-sandbox-list-probe"), "sandbox-list-probe\n", "utf8");
  const sandboxSearchResponse = await authorizedFetch(`${mainAgentApiPath("/runtime/actions")}?didMethod=agentpassport`, {
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
      recordedByAgentId: currentMainAgentPhysicalId(),
      recordedByWindowId: "window_smoke_ui",
      persistRun: false,
      autoCompact: false,
      sandboxAction: {
        capability: "runtime_search",
        actionType: "search",
        query: minuteToken,
        sourceWindowId: "window_smoke_ui",
        recordedByAgentId: currentMainAgentPhysicalId(),
        recordedByWindowId: "window_smoke_ui",
      },
    }),
  });
  assert(sandboxSearchResponse.ok, "sandbox runtime_search HTTP 请求失败");
  const sandboxSearch = await sandboxSearchResponse.json();
  assert(sandboxSearch.sandbox?.status === "completed", "sandbox runtime_search 应返回 completed");

  const sandboxListResponse = await authorizedFetch(`${mainAgentApiPath("/runtime/actions")}?didMethod=agentpassport`, {
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
      recordedByAgentId: currentMainAgentPhysicalId(),
      recordedByWindowId: "window_smoke_ui",
      persistRun: false,
      autoCompact: false,
      sandboxAction: {
        capability: "filesystem_list",
        actionType: "list",
        targetResource: dataDir,
        path: dataDir,
        sourceWindowId: "window_smoke_ui",
        recordedByAgentId: currentMainAgentPhysicalId(),
        recordedByWindowId: "window_smoke_ui",
      },
    }),
  });
  assert(sandboxListResponse.ok, "sandbox filesystem_list HTTP 请求失败");
  const sandboxList = await sandboxListResponse.json();
  assert(sandboxList.sandbox?.status === "completed", "sandbox filesystem_list 应返回 completed");
  assert(
    sandboxList.sandbox?.sandboxExecution?.output?.brokerIsolation?.boundary === "independent_process",
    "sandbox filesystem_list 应报告独立 broker 边界"
  );
  assertBrokerSystemSandboxTruth(
    sandboxList.sandbox?.sandboxExecution?.output?.brokerIsolation?.systemSandbox,
    "sandbox filesystem_list"
  );

  const sandboxAuditList = await getJson(`${mainAgentApiPath("/runtime/actions")}?didMethod=agentpassport&limit=10`);
  assert(Array.isArray(sandboxAuditList.audits), "sandbox audit list 缺少 audits 数组");
  phaseTimings.push({
    phase: "sandbox_audit",
    durationMs: Date.now() - sandboxStartedAt,
  });

  const runnerRecoveryStartedAt = Date.now();
  const runnerResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
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
  assert(
    ["blocked", "bootstrap_required", "resident_locked", "rehydrate_required", "needs_human_review"].includes(
      String(runner.runner?.run?.status || "")
    ),
    "runner guard 状态异常"
  );

  const seedOperationalCompactBoundary = async (label) => {
    const seedResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentGoal: `为 operational smoke ${label} 生成 compact boundary`,
        userTurn: `请基于当前上下文整理恢复边界。seed=${Date.now()}`,
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
      }),
    });
    assert(seedResponse.ok, `${label} compact boundary seed runner HTTP 请求失败`);
    const seeded = await seedResponse.json();
    const boundaryId = seeded.runner?.compactBoundary?.compactBoundaryId || null;
    assert(boundaryId, `${label} compact boundary seed 应返回 compactBoundaryId`);
    return boundaryId;
  };

  const freshBoundaryId = await seedOperationalCompactBoundary("fresh");
  let compactBoundaries = await getJson(`${mainAgentApiPath("/compact-boundaries")}?limit=5`);
  const historicalBoundaryIds = (compactBoundaries.compactBoundaries || [])
    .map((entry) => entry?.compactBoundaryId)
    .filter(Boolean)
    .reverse()
    .filter((boundaryId) => boundaryId !== freshBoundaryId);
  const candidateBoundaryIds = [freshBoundaryId];
  assert(candidateBoundaryIds.length >= 1, "auto recovery smoke 应至少拿到 1 条可续跑 compact boundary");

  let resumedRehydrate = null;
  let autoRecoveredRunner = null;
  let autoRecoveryResumed = false;
  let autoRecoveryResumeStatus = null;
  let autoRecoveryResumeChainLength = 0;
  let lastAutoRecoveryStatus = null;
  let fallbackAutoRecoveredRunner = null;
  const autoRecoveryDebugAttempts = [];
  const recordAutoRecoveryDebugAttempt = ({ mode, boundaryId, runner } = {}) => {
    const autoRecovery = runner?.runner?.autoRecovery ?? null;
    const activeReadiness = autoRecovery?.setupStatus?.activePlanReadiness ?? null;
    autoRecoveryDebugAttempts.push({
      mode,
      boundaryId,
      status: autoRecovery?.status ?? runner?.runner?.run?.status ?? null,
      planAction: autoRecovery?.plan?.action ?? null,
      ready: autoRecovery?.ready ?? activeReadiness?.ready ?? null,
      gateReasons: autoRecovery?.gateReasons ?? activeReadiness?.gateReasons ?? [],
      dependencyWarnings: autoRecovery?.dependencyWarnings ?? activeReadiness?.dependencyWarnings ?? [],
      summary: autoRecovery?.summary ?? activeReadiness?.summary ?? null,
    });
  };
  const tryAutoRecoverFromBoundaryIds = async (boundaryIds = []) => {
    for (const boundaryId of boundaryIds) {
      resumedRehydrate = await getJson(
        `${mainAgentApiPath("/runtime/rehydrate")}?didMethod=agentpassport&resumeFromCompactBoundaryId=${encodeURIComponent(boundaryId)}&${LITE_RUNTIME_QUERY}`
      );
      const autoRecoveredRunnerResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentGoal: "验证 runner HTTP auto recovery 是否能自动续跑",
          userTurn: "请继续推进当前任务",
          reasonerProvider: "local_mock",
          autoRecover: true,
          maxRecoveryAttempts: 1,
          autoCompact: false,
          persistRun: true,
          writeConversationTurns: false,
          storeToolResults: false,
          turnCount: 18,
          estimatedContextChars: 24000,
          estimatedContextTokens: 6200,
          resumeFromCompactBoundaryId: boundaryId,
        }),
      });
      assert(autoRecoveredRunnerResponse.ok, "auto recovery runner HTTP 请求失败");
      const candidateRunner = await autoRecoveredRunnerResponse.json();
      recordAutoRecoveryDebugAttempt({ mode: "direct", boundaryId, runner: candidateRunner });
      if (candidateRunner.runner?.autoResumed === true) {
        return candidateRunner;
      }
      lastAutoRecoveryStatus =
        candidateRunner.runner?.autoRecovery?.status ?? candidateRunner.runner?.run?.status ?? lastAutoRecoveryStatus;
    }
    return null;
  };
  const tryFallbackAutoRecoverFromBoundaryIds = async (boundaryIds = []) => {
    const fallbackBoundaryId = (Array.isArray(boundaryIds) ? boundaryIds : []).find(Boolean);
    if (!fallbackBoundaryId) {
      return null;
    }
    resumedRehydrate = await getJson(
      `${mainAgentApiPath("/runtime/rehydrate")}?didMethod=agentpassport&resumeFromCompactBoundaryId=${encodeURIComponent(fallbackBoundaryId)}&${LITE_RUNTIME_QUERY}`
    );
    const fallbackRunnerResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentGoal: "验证 runner HTTP auto recovery 是否能从 rehydrate_required 稳定续跑",
        userTurn: "请整理当前恢复边界并说明下一步",
        interactionMode: "conversation",
        executionMode: "discuss",
        candidateResponse: "这是一个较长的候选响应，用于稳定触发 rehydrate_required。".repeat(220),
        autoRecover: true,
        maxRecoveryAttempts: 1,
        autoCompact: false,
        persistRun: true,
        writeConversationTurns: false,
        storeToolResults: false,
        turnCount: 14,
        estimatedContextChars: 20000,
        estimatedContextTokens: 6200,
        resumeFromCompactBoundaryId: fallbackBoundaryId,
      }),
    });
    assert(fallbackRunnerResponse.ok, "fallback auto recovery runner HTTP 请求失败");
    const fallbackRunner = await fallbackRunnerResponse.json();
    recordAutoRecoveryDebugAttempt({ mode: "fallback", boundaryId: fallbackBoundaryId, runner: fallbackRunner });
    lastAutoRecoveryStatus =
      fallbackRunner.runner?.autoRecovery?.status ?? fallbackRunner.runner?.run?.status ?? lastAutoRecoveryStatus;
    return fallbackRunner.runner?.autoResumed === true ? fallbackRunner : null;
  };
  autoRecoveredRunner = await tryAutoRecoverFromBoundaryIds(candidateBoundaryIds);
  if (!autoRecoveredRunner) {
    fallbackAutoRecoveredRunner = await tryFallbackAutoRecoverFromBoundaryIds(candidateBoundaryIds);
    autoRecoveredRunner = fallbackAutoRecoveredRunner;
  }
  assert(
    autoRecoveredRunner,
    `runner HTTP auto recovery 主链路未找到 fresh boundary 的可续跑结果，freshBoundaryId=${freshBoundaryId}; historicalBoundaryCount=${historicalBoundaryIds.length}; 最后一次状态为 ${lastAutoRecoveryStatus || "unknown"}；fallbackSucceeded=${fallbackAutoRecoveredRunner?.runner?.autoResumed === true}; debug=${JSON.stringify(autoRecoveryDebugAttempts.slice(-6))}`
  );
  assert(autoRecoveredRunner.runner?.autoRecovery?.status === "resumed", "runner HTTP auto recovery 续跑后 autoRecovery.status 应为 resumed");
  assert(
    Array.isArray(autoRecoveredRunner.runner?.recoveryChain) && autoRecoveredRunner.runner.recoveryChain.length >= 2,
    "runner HTTP auto recovery 应返回 recoveryChain"
  );
  assert(
    autoRecoveredRunner.runner.recoveryChain.some((entry) => entry?.resumeBoundaryId === freshBoundaryId),
    "runner HTTP auto recovery recoveryChain 应包含 fresh compact boundary"
  );
  assert(
    autoRecoveredRunner.runner?.autoRecovery?.finalRunId === autoRecoveredRunner.runner?.run?.runId,
    "runner HTTP auto recovery finalRunId 应与最终 runId 对齐"
  );
  assert(
    autoRecoveredRunner.runner?.autoRecovery?.finalStatus === autoRecoveredRunner.runner?.run?.status,
    "runner HTTP auto recovery finalStatus 应与最终 run.status 对齐"
  );
  assertFailureSemanticsEnvelope(
    autoRecoveredRunner.runner?.autoRecovery?.failureSemantics,
    "runner HTTP autoRecovery.failureSemantics"
  );
  const autoRecoverySessionState = await getJson(`${mainAgentApiPath("/session-state")}?didMethod=agentpassport`);
  assert(
    autoRecoverySessionState.sessionState?.latestResumeBoundaryId === freshBoundaryId,
    "runner HTTP auto recovery 应把 latestResumeBoundaryId 持久化为 fresh compact boundary"
  );
  assert(
    autoRecoverySessionState.sessionState?.latestRunId === autoRecoveredRunner.runner?.run?.runId,
    "runner HTTP auto recovery 应把 latestRunId 持久化为最终 runId"
  );
  assert(
    autoRecoverySessionState.sessionState?.latestRunStatus === autoRecoveredRunner.runner?.run?.status,
    "runner HTTP auto recovery 应把 latestRunStatus 持久化为最终 run.status"
  );
  assert(
    Array.isArray(autoRecoverySessionState.sessionState?.activeWindowIds) &&
      autoRecoverySessionState.sessionState.activeWindowIds.length >= 1,
    "runner HTTP auto recovery 应保留 activeWindowIds"
  );
  assert(
    Number.isFinite(Number(autoRecoverySessionState.sessionState?.tokenBudgetState?.estimatedContextChars)),
    "runner HTTP auto recovery 应持久化 tokenBudgetState.estimatedContextChars"
  );
  assert(
    Number.isFinite(Number(autoRecoverySessionState.sessionState?.tokenBudgetState?.estimatedContextTokens)),
    "runner HTTP auto recovery 应持久化 tokenBudgetState.estimatedContextTokens"
  );
  autoRecoveryResumed = autoRecoveredRunner.runner?.autoResumed === true;
  autoRecoveryResumeStatus =
    autoRecoveredRunner.runner?.autoRecovery?.status ?? autoRecoveredRunner.runner?.run?.status ?? null;
  autoRecoveryResumeChainLength = Array.isArray(autoRecoveredRunner.runner?.recoveryChain)
    ? autoRecoveredRunner.runner.recoveryChain.length
    : 0;

  const retryWithoutExecutionRunnerResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
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
  assert(retryWithoutExecutionRunner.runner?.autoResumed === true, "runner HTTP retry_without_execution 应标记 autoResumed");
  assert(retryWithoutExecutionRunner.runner?.autoRecovery?.status === "resumed", "runner HTTP retry_without_execution 自动恢复应完成一次续跑");
  assert(
    Array.isArray(retryWithoutExecutionRunner.runner?.recoveryChain) &&
      retryWithoutExecutionRunner.runner.recoveryChain.length >= 2,
    "runner HTTP retry_without_execution 自动恢复应返回 recoveryChain"
  );
  const retryWithoutExecutionRunId = retryWithoutExecutionRunner.runner?.run?.runId || null;
  assert(retryWithoutExecutionRunId, "runner HTTP retry_without_execution 应返回 runId");

  const verificationRunResponse = await authorizedFetch(`${mainAgentApiPath("/verification-runs")}?didMethod=agentpassport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证 runtime integrity 是否可追溯",
      mode: "runtime_integrity",
      persistRun: true,
      sourceWindowId: "window_demo_1",
    }),
  });
  assert(verificationRunResponse.ok, "verification run HTTP 请求失败");
  const verificationRun = await verificationRunResponse.json();
  assert(verificationRun.verificationRun?.status, "verification run 缺少 status");
  const verificationRunId = verificationRun.verificationRun?.verificationRunId || null;
  assert(verificationRunId, "verification run 缺少 verificationRunId");
  phaseTimings.push({
    phase: "runner_recovery",
    durationMs: Date.now() - runnerRecoveryStartedAt,
  });

  const historyReadsStartedAt = Date.now();
  const [verificationHistory, runnerHistory, passportMemories, transcript] = await Promise.all([
    getJson(`${mainAgentApiPath("/verification-runs")}?limit=20`),
    getJson(`${mainAgentApiPath("/runner")}?limit=20`),
    getJson(`${mainAgentApiPath("/passport-memory")}?limit=12`),
    getJsonEventually(`${mainAgentApiPath("/transcript")}?family=runtime&limit=12`, {
      attempts: 3,
      delayMs: 100,
      label: "runtime transcript after runtime evidence probes",
      trace: traceSmoke,
      isReady: (json) =>
        Array.isArray(json?.entries) &&
        Array.isArray(json?.transcript?.messageBlocks) &&
        Number(json?.transcript?.entryCount || json?.entries?.length || 0) >= 1 &&
        Number(json?.transcript?.messageBlocks?.length || 0) >= 1,
    }),
  ]);
  assert(
    verificationHistory.verificationRuns.some((entry) => entry.verificationRunId === verificationRunId),
    "verification history 应包含本次 verificationRunId"
  );
  assert(
    Array.isArray(runnerHistory.runs) && runnerHistory.runs.length > 0,
    "runner history 应返回持久化运行记录"
  );
  phaseTimings.push({
    phase: "history_reads",
    durationMs: Date.now() - historyReadsStartedAt,
  });

  const retryWithoutExecutionResumeStatus =
    retryWithoutExecutionRunner.runner?.autoRecovery?.status ?? retryWithoutExecutionRunner.runner?.run?.status ?? null;
  const retryWithoutExecutionResumeChainLength = Array.isArray(retryWithoutExecutionRunner.runner?.recoveryChain)
    ? retryWithoutExecutionRunner.runner.recoveryChain.length
    : 0;
  const [runtimeSummaryFinal, runtimeStability, securityFinal] = await Promise.all([
    getJson(`${mainAgentApiPath("/runtime-summary")}?didMethod=agentpassport`),
    getJson(`${mainAgentApiPath("/runtime/stability")}?didMethod=agentpassport&limit=1`),
    getJson("/api/security"),
  ]);
  const latestRuntimeRunnerTruth = runtimeSummaryFinal.summary?.runner?.latest || null;
  const latestRuntimeMemoryState = runtimeSummaryFinal.summary?.memoryHomeostasis?.latestState || null;
  const latestRuntimeObservation =
    runtimeSummaryFinal.summary?.memoryHomeostasis?.observationSummary?.latestObservation || null;
  const latestPublicAgentRuntimeTruth = securityFinal.agentRuntimeTruth || null;
  const latestRuntimeStabilityState = runtimeStability.stability?.latestState || null;
  const latestRuntimeStabilityObservation =
    runtimeStability.stability?.observationSummary?.latestObservation || null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "operational",
        baseUrl,
        smokeUiStage: "operational",
        phaseTimings,
        hostBinding: security.hostBinding,
        protocolTagline: protocol.productPositioning?.tagline || null,
        activeAgentId: agentContext.context?.agent?.agentId || null,
        runtimeSnapshotId: runtimeAfterConfig.runtime?.taskSnapshot?.snapshotId || null,
        runtimeSummaryDominantRhythm: runtimeSummaryFinal.summary?.cognition?.dynamics?.dominantRhythm || null,
        runtimeSummaryReplayMode: runtimeSummaryFinal.summary?.cognition?.dynamics?.replayOrchestration?.replayMode || null,
        localReasonerStatus: localReasonerStatus.diagnostics?.status || null,
        localReasonerCatalogProviderCount: localReasonerCatalog.providers.length || 0,
        localReasonerProbeStatus: localReasonerProbe.diagnostics?.status || null,
        localReasonerSelectedProvider: localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.provider || null,
        localReasonerPrewarmStatus: localReasonerPrewarm.warmState?.status || null,
        localReasonerProfileId,
        localReasonerProfileCount: localReasonerProfileList.counts?.total || localReasonerProfileList.profiles.length || 0,
        localReasonerRestoreCandidateCount,
        localReasonerRestoreProfileId: localReasonerRestore.restoredProfileId || null,
        localReasonerRestoreWarmStatus: localReasonerRestore.prewarmResult?.warmState?.status || null,
        localReasonerRestoreReusedWarmState: localReasonerRestore.prewarmResult?.reusedWarmState === true,
        localReasonerRestoreWarmProofSource: localReasonerRestore.prewarmResult?.warmProofSource || null,
        ...summarizeLocalReasonerRestoreExpectation({
          candidateCount: localReasonerRestoreCandidateCount,
          restoredProfileId: localReasonerRestore.restoredProfileId || null,
          warmStatus: localReasonerRestore.prewarmResult?.warmState?.status || null,
        }),
        ...summarizeLocalReasonerLifecycleExpectation({
          configuredStatus: localReasonerStatus.diagnostics?.status || null,
          catalogProviderCount: localReasonerCatalog.providers.length || 0,
          probeStatus: localReasonerProbe.diagnostics?.status || null,
          selectedProvider: localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.provider || null,
          prewarmStatus: localReasonerPrewarm.warmState?.status || null,
          profileCount: localReasonerProfileList.counts?.total || localReasonerProfileList.profiles.length || 0,
          restoreCandidateCount: localReasonerRestoreCandidateCount,
        }),
        setupPackageId: savedSetupPackageId,
        savedSetupPackageId,
        setupPackageProfileCount: savedSetupPackageDetail.summary?.localReasonerProfileCount || 0,
        ...summarizeSetupPackageExpectation({
          previewPackageId: null,
          persistedPackageId: savedSetupPackageId,
          observedPersistedPackageCount: 1,
          embeddedProfileCount: savedSetupPackageDetail.summary?.localReasonerProfileCount || 0,
          prunedDeletedCount: setupPackagePrune.counts?.deleted || 0,
        }),
        rehydratePackHash: rehydrate.rehydrate?.packHash || null,
        conversationMinuteId: minuteResult.minute?.minuteId || null,
        conversationMinuteCount: conversationMinutes.counts?.total || conversationMinutes.minutes.length || 0,
        transcriptEntryCount: transcript.transcript?.entryCount || transcript.entries.length || 0,
        transcriptBlockCount: transcript.transcript?.messageBlocks?.length || 0,
        runtimeSearchHits: runtimeSearch.hits.length || 0,
        ...summarizeConversationMemoryExpectation({
          minuteId: minuteResult.minute?.minuteId || null,
          minuteCount: conversationMinutes.counts?.total || conversationMinutes.minutes.length || 0,
          transcriptEntryCount: transcript.transcript?.entryCount || transcript.entries.length || 0,
          transcriptBlockCount: transcript.transcript?.messageBlocks?.length || 0,
          runtimeSearchHits: runtimeSearch.hits.length || 0,
        }),
        sandboxAuditCount: sandboxAuditList.counts?.total || sandboxAuditList.audits.length || 0,
        sandboxSearchHits: sandboxSearch.sandbox?.sandboxExecution?.output?.hits?.length || 0,
        sandboxListEntries: sandboxList.sandbox?.sandboxExecution?.output?.entries?.length || 0,
        ...summarizeSandboxAuditExpectation({
          auditCount: sandboxAuditList.counts?.total || sandboxAuditList.audits.length || 0,
          sandboxSearchHits: sandboxSearch.sandbox?.sandboxExecution?.output?.hits?.length || 0,
          sandboxListEntries: sandboxList.sandbox?.sandboxExecution?.output?.entries?.length || 0,
        }),
        runnerStatus: runner.runner?.run?.status || null,
        compactBoundaryCount: compactBoundaries.counts?.filtered || compactBoundaries.compactBoundaries.length || 0,
        verificationRunStatus: verificationRun.verificationRun?.status || null,
        verificationHistoryCount: verificationHistory.counts?.filtered || verificationHistory.verificationRuns.length || 0,
        runnerHistoryCount: runnerHistory.counts?.filtered || runnerHistory.runs.length || 0,
        ...summarizeExecutionHistoryExpectation({
          verificationStatus: verificationRun.verificationRun?.status || null,
          verificationHistoryCount:
            verificationHistory.counts?.filtered || verificationHistory.verificationRuns.length || 0,
          runnerStatus: runner.runner?.run?.status || null,
          runnerHistoryCount: runnerHistory.counts?.filtered || runnerHistory.runs.length || 0,
        }),
        qualityEscalationRuns: runtimeSummaryFinal.summary?.runner?.qualityEscalationRuns ?? null,
        latestQualityEscalationActivated: latestRuntimeRunnerTruth?.qualityEscalationActivated ?? null,
        latestQualityEscalationProvider: latestRuntimeRunnerTruth?.qualityEscalationProvider ?? null,
        latestQualityEscalationReason: latestRuntimeRunnerTruth?.qualityEscalationReason ?? null,
        latestRunMemoryStabilityCorrectionLevel:
          latestRuntimeRunnerTruth?.memoryStabilityCorrectionLevel ?? null,
        latestRunMemoryStabilityRiskScore: latestRuntimeRunnerTruth?.memoryStabilityRiskScore ?? null,
        latestRunMemoryStabilitySignalSource:
          latestRuntimeRunnerTruth?.memoryStabilitySignalSource ?? null,
        latestRunMemoryStabilityPreflightStatus:
          latestRuntimeRunnerTruth?.memoryStabilityPreflightStatus ?? null,
        memoryStabilityStateCount: runtimeSummaryFinal.summary?.memoryHomeostasis?.stateCount ?? null,
        latestMemoryStabilityStateId:
          latestPublicAgentRuntimeTruth?.latestMemoryStabilityStateId ??
          latestRuntimeObservation?.runtimeMemoryStateId ??
          latestRuntimeMemoryState?.runtimeMemoryStateId ??
          null,
        latestMemoryStabilityCorrectionLevel:
          latestPublicAgentRuntimeTruth?.latestMemoryStabilityCorrectionLevel ??
          latestRuntimeObservation?.correctionLevel ??
          latestRuntimeMemoryState?.correctionLevel ??
          null,
        latestMemoryStabilityRiskScore:
          latestPublicAgentRuntimeTruth?.latestMemoryStabilityRiskScore ??
          latestRuntimeObservation?.cT ??
          latestRuntimeMemoryState?.cT ??
          null,
        latestMemoryStabilityUpdatedAt:
          latestPublicAgentRuntimeTruth?.latestMemoryStabilityUpdatedAt ??
          latestRuntimeObservation?.observedAt ??
          latestRuntimeMemoryState?.updatedAt ??
          null,
        latestMemoryStabilityObservationKind:
          latestPublicAgentRuntimeTruth?.latestMemoryStabilityObservationKind ??
          latestRuntimeObservation?.observationKind ??
          null,
        latestMemoryStabilityRiskTrend:
          latestPublicAgentRuntimeTruth?.latestMemoryStabilityRiskTrend ?? latestRuntimeObservation?.riskTrend ?? null,
        latestMemoryStabilityRecoverySignal:
          latestPublicAgentRuntimeTruth?.latestMemoryStabilityRecoverySignal ??
          latestRuntimeObservation?.recoverySignal ??
          null,
        latestMemoryStabilityCorrectionActions:
          latestPublicAgentRuntimeTruth?.latestMemoryStabilityCorrectionActions ??
          latestRuntimeObservation?.correctionActions ??
          [],
        memoryStabilityRecoveryRate:
          latestPublicAgentRuntimeTruth?.memoryStabilityRecoveryRate ??
          runtimeSummaryFinal.summary?.memoryHomeostasis?.observationSummary?.effectiveness?.recoveryRate ??
          null,
        runtimeStabilityStateCount: runtimeStability.stability?.counts?.total ?? null,
        runtimeStabilityLatestStateId:
          latestRuntimeStabilityObservation?.runtimeMemoryStateId ??
          latestRuntimeStabilityState?.runtimeMemoryStateId ??
          null,
        runtimeStabilityLatestCorrectionLevel:
          latestRuntimeStabilityObservation?.correctionLevel ?? latestRuntimeStabilityState?.correctionLevel ?? null,
        runtimeStabilityLatestRiskScore:
          latestRuntimeStabilityObservation?.cT ?? latestRuntimeStabilityState?.cT ?? null,
        passportMemoryCount: passportMemories.counts?.filtered || passportMemories.memories.length || 0,
        repairCount: repairs.counts?.total || repairs.repairs.length || 0,
        windowCount: windows.windows.length,
        checkedWindowId: checkedWindow?.window?.windowId || null,
        checkedWindowAgentId: checkedWindow?.window?.agentId || null,
        adminTokenRotationMode,
        adminTokenRotationOldTokenRejected,
        adminTokenRotationNewTokenAccepted,
        adminTokenRotationReadSessionPreRevokeAllowed,
        adminTokenRotationReadSessionRevoked,
        adminTokenRotationAnomalyRecorded,
        forgedWindowRebindBlocked,
        forgedWindowRebindError,
        windowBindingStableAfterRebind,
        autoRecoveryResumed,
        autoRecoveryResumeStatus,
        autoRecoveryResumeChainLength,
        resumedBoundaryId: resumedRehydrate?.rehydrate?.resumeBoundary?.compactBoundaryId || null,
        retryWithoutExecutionResumeStatus,
        retryWithoutExecutionResumeChainLength,
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
  process.exit(1);
});

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentPassportLedgerPath } from "../src/runtime-path-config.js";
import {
  AGENT_PASSPORT_MAIN_AGENT_ID,
  LEGACY_OPENNEED_AGENT_ID,
} from "../src/main-agent-compat.js";
import { assert, assertBrokerSystemSandboxTruth, sleep } from "./smoke-shared.mjs";
import { createSmokeLogger, localReasonerFixturePath, resolveBaseUrl, rootDir } from "./smoke-env.mjs";
import { createMockMempalaceFixture } from "./smoke-mempalace.mjs";
import {
  summarizeBootstrapExpectation,
  summarizeConversationMemoryExpectation,
  summarizeDeviceSetupExpectation,
  summarizeExecutionHistoryExpectation,
  summarizeHousekeepingExpectation,
  summarizeLocalReasonerLifecycleExpectation,
  summarizeLocalReasonerRestoreExpectation,
  summarizeRecoveryBundleExpectation,
  summarizeRecoveryRehearsalExpectation,
  summarizeSandboxAuditExpectation,
  summarizeSetupPackageExpectation,
} from "./smoke-expectations.mjs";
import { createSmokeHttpClient } from "./smoke-ui-http.mjs";

const smokeCombined = process.env.SMOKE_COMBINED === "1";
const baseUrl = resolveBaseUrl();
const dataDir = path.join(rootDir, "data");
const expectedLedgerPath = resolveAgentPassportLedgerPath({ dataDir });
const expectedArchiveDir = process.env.AGENT_PASSPORT_ARCHIVE_DIR || path.join(dataDir, "archives");
const LITE_RUNTIME_QUERY = "runtimeLimit=3&messageLimit=3&memoryLimit=3&authorizationLimit=3&credentialLimit=3";
const LITE_AGENT_CONTEXT_QUERY = `didMethod=agentpassport&${LITE_RUNTIME_QUERY}`;
const LITE_AGENT_CONTEXT_OPENNEED_QUERY = `didMethod=openneed&${LITE_RUNTIME_QUERY}`;
const LITE_REHYDRATE_QUERY = `didMethod=agentpassport&${LITE_RUNTIME_QUERY}`;
const MAIN_AGENT_ID = AGENT_PASSPORT_MAIN_AGENT_ID;
const MAIN_AGENT_PHYSICAL_ID_FALLBACK = LEGACY_OPENNEED_AGENT_ID;
const traceSmoke = createSmokeLogger("smoke-ui");
const {
  authorizedFetch: rawAuthorizedFetch,
  drainResponse,
  fetchWithToken: rawFetchWithToken,
  getAdminToken,
  getJson: rawGetJson,
  getText: rawGetText,
  publicGetJson: rawPublicGetJson,
  setAdminToken,
} = createSmokeHttpClient({
  baseUrl,
  rootDir,
  trace: traceSmoke,
});
let resolvedMainAgentPhysicalId = null;

function mainAgentApiPath(pathname = "") {
  return `/api/agents/${MAIN_AGENT_ID}${pathname}`;
}

function text(value) {
  return String(value ?? "").trim();
}

function currentMainAgentPhysicalId() {
  return text(resolvedMainAgentPhysicalId) || MAIN_AGENT_PHYSICAL_ID_FALLBACK;
}

function isCurrentMainAgentPhysicalId(value) {
  return text(value) === currentMainAgentPhysicalId();
}

function assertCurrentMainAgentPhysicalId(value, label) {
  assert(
    isCurrentMainAgentPhysicalId(value),
    `${label} 应为当前 physical owner (${currentMainAgentPhysicalId()})，实际 ${text(value) || "<empty>"}`
  );
}

function assertCurrentMainResidentBinding(value, label) {
  assertCurrentMainAgentPhysicalId(value?.residentAgentId, `${label}.residentAgentId`);
  assert(
    value?.residentAgentReference === MAIN_AGENT_ID,
    `${label}.residentAgentReference 应保留 canonical owner (${MAIN_AGENT_ID})`
  );
  assertCurrentMainAgentPhysicalId(value?.resolvedResidentAgentId, `${label}.resolvedResidentAgentId`);
}

function mainAgentPhysicalApiPath(pathname = "") {
  return `/api/agents/${currentMainAgentPhysicalId()}${pathname}`;
}

function rememberMainAgentPhysicalId(...candidates) {
  for (const candidate of candidates) {
    const normalized = text(candidate);
    if (!normalized) {
      continue;
    }
    if (normalized === MAIN_AGENT_ID && resolvedMainAgentPhysicalId) {
      continue;
    }
    resolvedMainAgentPhysicalId = normalized;
    return normalized;
  }
  return currentMainAgentPhysicalId();
}

function rememberMainAgentPhysicalIdFromJson(resourcePath, value) {
  if (!resourcePath || typeof value !== "object" || value == null) {
    return currentMainAgentPhysicalId();
  }

  const candidates = [
    value?.context?.agent?.agentId,
    value?.context?.runtime?.resolvedResidentAgentId,
    value?.context?.runtime?.deviceRuntime?.resolvedResidentAgentId,
    value?.context?.runtime?.deviceRuntime?.residentAgent?.agentId,
    value?.runtime?.agentId,
    value?.runtime?.resolvedResidentAgentId,
    value?.runtime?.deviceRuntime?.resolvedResidentAgentId,
    value?.runtime?.deviceRuntime?.residentAgent?.agentId,
    value?.summary?.identity?.agentId,
    value?.summary?.identity?.resolvedResidentAgentId,
    value?.sessionState?.agentId,
    value?.sessionState?.resolvedResidentAgentId,
    value?.cognitiveState?.agentId,
    value?.credentialRecord?.subjectId,
    value?.credential?.credentialSubject?.agentId,
  ];

  return rememberMainAgentPhysicalId(...candidates);
}

function rewriteMainAgentPhysicalText(value) {
  if (typeof value !== "string") {
    return value;
  }
  const physicalId = currentMainAgentPhysicalId();
  if (!physicalId || physicalId === MAIN_AGENT_PHYSICAL_ID_FALLBACK) {
    return value;
  }
  return value.split(MAIN_AGENT_PHYSICAL_ID_FALLBACK).join(physicalId);
}

function rewriteMainAgentPhysicalOptions(options = {}) {
  if (!options || typeof options !== "object") {
    return options;
  }
  const next = { ...options };
  if (typeof next.body === "string") {
    next.body = rewriteMainAgentPhysicalText(next.body);
  }
  return next;
}

async function authorizedFetch(resourcePath, options = {}) {
  return rawAuthorizedFetch(rewriteMainAgentPhysicalText(resourcePath), rewriteMainAgentPhysicalOptions(options));
}

async function fetchWithToken(resourcePath, token, options = {}) {
  return rawFetchWithToken(
    rewriteMainAgentPhysicalText(resourcePath),
    token,
    rewriteMainAgentPhysicalOptions(options)
  );
}

async function getJson(resourcePath) {
  const json = await rawGetJson(rewriteMainAgentPhysicalText(resourcePath));
  rememberMainAgentPhysicalIdFromJson(resourcePath, json);
  return json;
}

async function getText(resourcePath) {
  return rawGetText(rewriteMainAgentPhysicalText(resourcePath));
}

async function publicGetJson(resourcePath) {
  return rawPublicGetJson(rewriteMainAgentPhysicalText(resourcePath));
}

function includesAll(haystack, needles, label) {
  for (const needle of needles) {
    assert(haystack.includes(needle), `${label} 缺少标记：${needle}`);
  }
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

function assertProtectedReadDenied(response, message) {
  assert([401, 403].includes(response?.status), `${message}，实际 HTTP ${response?.status ?? "<missing>"}`);
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

function summarizeKeychainMigrationExpectation(migrationEnvelope = null, { shouldProbe = false, combinedMode = false } = {}) {
  if (combinedMode) {
    if (shouldProbe) {
      return {
        keychainMigrationApplyExpected: false,
        keychainMigrationMeaning: "combined smoke defers keychain migration execution; full flow would only preview it with dry-run",
        keychainMigrationGateState: {
          runMode: "combined_preview_deferred",
          dryRun: true,
          skipped: true,
          reason: "combined_mode_not_executed",
          shouldProbe: true,
        },
      };
    }
    return {
      keychainMigrationApplyExpected: false,
      keychainMigrationMeaning: "combined smoke skips keychain migration because key material is already system protected or keychain is unavailable",
      keychainMigrationGateState: {
        runMode: "not_applicable_skip",
        dryRun: false,
        skipped: true,
        reason: "already_system_protected_or_not_applicable",
        shouldProbe: false,
      },
    };
  }

  const migration = migrationEnvelope?.migration || migrationEnvelope || null;
  const skipped = migration?.skipped === true;
  const dryRun = migration?.dryRun === true;
  let runMode = "finalize";
  let meaning = "keychain migration run is expected to move eligible key material into the system keychain";

  if (skipped) {
    runMode = "not_applicable_skip";
    if (migration?.reason === "already_system_protected_or_not_applicable") {
      meaning = "smoke skips keychain migration because key material is already system protected or keychain is unavailable";
    } else {
      meaning = `smoke skips keychain migration: ${migration?.reason || "not_applicable"}`;
    }
  } else if (dryRun) {
    runMode = "dry_run_preview";
    meaning = "smoke intentionally previews keychain migration and does not move key material";
  }

  return {
    keychainMigrationApplyExpected: skipped || dryRun ? false : true,
    keychainMigrationMeaning: meaning,
    keychainMigrationGateState: {
      runMode,
      dryRun,
      skipped,
      reason: migration?.reason ?? null,
      storeKeySource: migration?.storeKey?.source ?? null,
      signingKeySource: migration?.signingKey?.source ?? null,
    },
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
  assert(health.service === "agent-passport", "health.service 应返回 agent-passport");
  const protocol = await publicGetJson("/api/protocol");
  const security = await getJson("/api/security");
  assert(publicSecurity.authorized === false, "未带 token 的 /api/security 应返回 redacted 视图");
  assert(publicSecurity.releaseReadiness && typeof publicSecurity.releaseReadiness === "object", "public /api/security 缺少 releaseReadiness");
  assert(typeof publicSecurity.releaseReadiness.status === "string", "public /api/security.releaseReadiness.status 缺失");
  assertFailureSemanticsEnvelope(
    publicSecurity.releaseReadiness.failureSemantics,
    "public /api/security.releaseReadiness.failureSemantics"
  );
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
  const unauthorizedRead = await fetch(`${baseUrl}/api/device/runtime`, {
    headers: {
      Connection: "close",
    },
  });
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
  assert(security.releaseReadiness && typeof security.releaseReadiness === "object", "/api/security 缺少 releaseReadiness");
  assert(typeof security.releaseReadiness.status === "string", "/api/security.releaseReadiness.status 缺失");
  assertFailureSemanticsEnvelope(
    security.releaseReadiness.failureSemantics,
    "/api/security.releaseReadiness.failureSemantics"
  );
  assert(security.apiWriteProtection?.tokenRequired === true, "写接口默认应要求 admin token");
  assert(security.readProtection?.sensitiveGetRequiresToken === true, "敏感 GET 接口默认应要求 admin token");
  const operatorHandbook = security.securityArchitecture?.operatorHandbook || null;
  assert(operatorHandbook && Array.isArray(operatorHandbook.roles), "/api/security 缺少 operatorHandbook.roles");
  assert(operatorHandbook.roles.length >= 3, "operatorHandbook.roles 至少应有 3 个固定职责");
  const handbookRoleIds = new Set(operatorHandbook.roles.map((entry) => entry?.roleId).filter(Boolean));
  for (const roleId of ["holder", "operator", "maintainer"]) {
    assert(handbookRoleIds.has(roleId), `operatorHandbook.roles 缺少 ${roleId}`);
  }
  assert(
    Array.isArray(operatorHandbook.decisionSequence),
    "/api/security 缺少 operatorHandbook.decisionSequence"
  );
  assert(operatorHandbook.decisionSequence.length >= 4, "operatorHandbook.decisionSequence 至少应有 4 步");
  const decisionStepIds = new Set(operatorHandbook.decisionSequence.map((entry) => entry?.stepId).filter(Boolean));
  for (const stepId of [
    "security_posture",
    "formal_recovery",
    "constrained_execution",
    "cross_device_recovery",
  ]) {
    assert(decisionStepIds.has(stepId), `operatorHandbook.decisionSequence 缺少 ${stepId}`);
  }
  assert(
    Array.isArray(operatorHandbook.standardActions),
    "/api/security 缺少 operatorHandbook.standardActions"
  );
  assert(operatorHandbook.standardActions.length >= 3, "operatorHandbook.standardActions 至少应有 3 个标准动作");
  const standardActionIds = new Set(operatorHandbook.standardActions.map((entry) => entry?.actionId).filter(Boolean));
  for (const actionId of ["evidence_preservation", "break_glass", "key_rotation"]) {
    assert(standardActionIds.has(actionId), `operatorHandbook.standardActions 缺少 ${actionId}`);
  }
  const keyRotationAction = operatorHandbook.standardActions.find((entry) => entry?.actionId === "key_rotation");
  assert(
    Array.isArray(keyRotationAction?.checklist) && keyRotationAction.checklist.length >= 5,
    "operatorHandbook.key_rotation.checklist 应复用轮换重跑触发项"
  );
  const handoffPacket = security.localStorageFormalFlow?.handoffPacket || null;
  assert(handoffPacket, "security.localStorageFormalFlow 缺少 handoffPacket");
  assert(
    Array.isArray(handoffPacket.requiredFields) && handoffPacket.requiredFields.length >= 6,
    "handoffPacket.requiredFields 至少应有 6 个交接字段"
  );
  const handoffFieldIds = new Set(handoffPacket.requiredFields.map((entry) => entry?.fieldId).filter(Boolean));
  for (const fieldId of [
    "security_posture",
    "formal_recovery_next_step",
    "latest_passed_rehearsal",
    "latest_recovery_bundle",
    "latest_setup_package",
    "single_blocker",
  ]) {
    assert(handoffFieldIds.has(fieldId), `handoffPacket.requiredFields 缺少 ${fieldId}`);
  }
  assert(
    handoffPacket.uniqueBlockingReason?.label,
    "handoffPacket.uniqueBlockingReason 应返回可读阻塞原因"
  );
  const unreadyHandoffFields = handoffPacket.requiredFields.filter((entry) => entry?.status !== "ready");
  assert(
    Boolean(handoffPacket.readyToHandoff) === (unreadyHandoffFields.length === 0),
    "handoffPacket.readyToHandoff 应与 requiredFields 状态一致"
  );
  const latestRecoveryBundleField =
    handoffPacket.requiredFields.find((entry) => entry?.fieldId === "latest_recovery_bundle") || null;
  if (String(latestRecoveryBundleField?.value || "").includes("key-only bundle")) {
    assert(latestRecoveryBundleField?.status === "partial", "key-only recovery bundle 应标记为 partial");
  }
  const latestSetupPackageField =
    handoffPacket.requiredFields.find((entry) => entry?.fieldId === "latest_setup_package") || null;
  if (String(latestSetupPackageField?.value || "").includes("未对齐当前恢复基线")) {
    assert(latestSetupPackageField?.status === "partial", "未对齐当前恢复基线的初始化包应标记为 partial");
  }
  const latestRehearsalField =
    handoffPacket.requiredFields.find((entry) => entry?.fieldId === "latest_passed_rehearsal") || null;
  if (security.localStorageFormalFlow?.operationalCadence?.status === "due_soon") {
    assert(latestRehearsalField?.status === "partial", "即将到期的恢复演练应标记为 partial");
  }
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
  const operatorHtml = await fs.readFile(path.join(rootDir, "public", "operator.html"), "utf8");
  includesAll(
    operatorHtml,
    [
      'id="operator-handbook-roles"',
      'id="operator-sequence-summary"',
      'id="operator-decision-sequence"',
      'id="operator-standard-actions-summary"',
      'id="operator-standard-actions"',
      'id="operator-export-summary"',
      'id="operator-export-incident-packet"',
      'id="operator-export-status"',
      'id="operator-export-contents"',
      'id="operator-export-history"',
      'id="operator-handoff-summary"',
      'id="operator-handoff-fields"',
    ],
    "public/operator.html"
  );
  assert(Array.isArray(roadmap.documentation), "roadmap 缺少 documentation");
  assert(roadmap.securityArchitecture?.knownGaps?.length >= 1, "roadmap 缺少 securityArchitecture.knownGaps");
  assert(security.securityPosture?.mode, "security 缺少 securityPosture.mode");
  assert(security.securityArchitecture?.trustBoundaries?.length >= 3, "security 缺少 securityArchitecture.trustBoundaries");
  assert(security.localStorageFormalFlow?.status, "security 缺少 localStorageFormalFlow.status");
  assert(security.localStorageFormalFlow?.runbook?.status, "security 缺少 localStorageFormalFlow.runbook.status");
  assert(security.localStorageFormalFlow?.operationalCadence?.status, "security 缺少 localStorageFormalFlow.operationalCadence.status");
  assert(
    security.localStorageFormalFlow?.crossDeviceRecoveryClosure?.status,
    "security 缺少 localStorageFormalFlow.crossDeviceRecoveryClosure.status"
  );
  assert(
    security.localStorageFormalFlow?.crossDeviceRecoveryClosure?.readyForRehearsal ===
      ((security.localStorageFormalFlow?.crossDeviceRecoveryClosure?.sourceBlockingReasons?.length || 0) === 0),
    "security crossDeviceRecoveryClosure.readyForRehearsal 应与 sourceBlockingReasons 一致"
  );
  assert(security.constrainedExecution?.status, "security 缺少 constrainedExecution.status");
  assert(security.automaticRecovery?.status, "security 缺少 automaticRecovery.status");
  assertFailureSemanticsEnvelope(
    security.automaticRecovery?.failureSemantics,
    "/api/security.automaticRecovery.failureSemantics"
  );
  assert(security.automaticRecovery?.operatorBoundary?.summary, "security 缺少 automaticRecovery.operatorBoundary.summary");
  assert(security.anomalyAudit?.counts, "security 缺少 anomalyAudit.counts");
  includesAll(
    await getText("/"),
    [
      "agent-passport 公开运行态",
      "runtime-home-summary",
      "runtime-health-summary",
      "runtime-health-detail",
      "runtime-recovery-summary",
      "runtime-recovery-detail",
      "runtime-automation-summary",
      "runtime-automation-detail",
      'id="runtime-operator-entry-summary"',
      "runtime-trigger-list",
      'id="runtime-link-list"',
      'href="/operator"',
      'href="/api/security"',
      'href="/api/health"',
      'href="/offline-chat"',
      'href="/lab.html"',
      'href="/repair-hub"',
    ],
    "公开运行态 HTML"
  );
  includesAll(
    await getText("/operator"),
    [
      "agent-passport 值班与恢复决策面",
      "operator-admin-token-form",
      "operator-admin-token-input",
      "operator-export-incident-packet",
      "operator-export-status",
      "operator-export-history",
      "operator-hard-alerts",
      "operator-cross-device-steps",
      "/api/device/setup",
    ],
    "operator HTML"
  );
  const incidentPacket = await getJson("/api/security/incident-packet");
  assert(incidentPacket.format === "agent-passport-incident-packet-v1", "incident packet 应返回稳定格式版本");
  assert(incidentPacket.snapshots?.security?.securityPosture?.mode, "incident packet 应包含当前安全姿态");
  assert(incidentPacket.snapshots?.deviceSetup?.formalRecoveryFlow?.handoffPacket, "incident packet 应包含正式恢复交接包");
  assertFailureSemanticsEnvelope(
    incidentPacket.snapshots?.security?.releaseReadiness?.failureSemantics,
    "incident packet.snapshots.security.releaseReadiness.failureSemantics"
  );
  assertFailureSemanticsEnvelope(
    incidentPacket.boundaries?.releaseReadiness?.failureSemantics,
    "incident packet.boundaries.releaseReadiness.failureSemantics"
  );
  assertFailureSemanticsEnvelope(
    incidentPacket.boundaries?.automaticRecovery?.failureSemantics,
    "incident packet.boundaries.automaticRecovery.failureSemantics"
  );
  const incidentPacketAgentRuntime = incidentPacket.boundaries?.agentRuntime || null;
  assert(
    JSON.stringify(incidentPacketAgentRuntime) === JSON.stringify(incidentPacket.snapshots?.security?.agentRuntimeTruth || null),
    "incident packet.boundaries.agentRuntime 应与 snapshots.security.agentRuntimeTruth 同源一致"
  );
  assert(
    Number.isFinite(Number(incidentPacketAgentRuntime?.memoryStabilityStateCount)),
    "incident packet.boundaries.agentRuntime.memoryStabilityStateCount 必须可读"
  );
  if (incidentPacketAgentRuntime?.latestRunnerGuardActivated === true) {
    assert(
      text(incidentPacketAgentRuntime?.latestRunStatus, ""),
      "incident packet.boundaries.agentRuntime 触发 runner guard 时必须带 latestRunStatus"
    );
    assert(
      text(incidentPacketAgentRuntime?.latestRunnerGuardBlockedBy, ""),
      "incident packet.boundaries.agentRuntime 触发 runner guard 时必须带 latestRunnerGuardBlockedBy"
    );
    assert(
      text(incidentPacketAgentRuntime?.latestRunnerGuardCode, ""),
      "incident packet.boundaries.agentRuntime 触发 runner guard 时必须带 latestRunnerGuardCode"
    );
    assert(
      text(incidentPacketAgentRuntime?.latestRunnerGuardStage, ""),
      "incident packet.boundaries.agentRuntime 触发 runner guard 时必须带 latestRunnerGuardStage"
    );
    assert(
      text(incidentPacketAgentRuntime?.latestRunnerGuardReceiptStatus, ""),
      "incident packet.boundaries.agentRuntime 触发 runner guard 时必须带 latestRunnerGuardReceiptStatus"
    );
    assert(
      Array.isArray(incidentPacketAgentRuntime?.latestRunnerGuardExplicitRequestKinds) &&
        incidentPacketAgentRuntime.latestRunnerGuardExplicitRequestKinds.length > 0,
      "incident packet.boundaries.agentRuntime 触发 runner guard 时必须带 latestRunnerGuardExplicitRequestKinds"
    );
  }
  if (Number(incidentPacketAgentRuntime?.memoryStabilityStateCount || 0) > 0) {
    assert(
      text(incidentPacketAgentRuntime?.latestMemoryStabilityStateId, ""),
      "incident packet.boundaries.agentRuntime 有记忆稳态状态时必须带 latestMemoryStabilityStateId"
    );
    assert(
      text(incidentPacketAgentRuntime?.latestMemoryStabilityCorrectionLevel, ""),
      "incident packet.boundaries.agentRuntime 有记忆稳态状态时必须带 latestMemoryStabilityCorrectionLevel"
    );
    assert(
      Number.isFinite(Number(incidentPacketAgentRuntime?.latestMemoryStabilityRiskScore)),
      "incident packet.boundaries.agentRuntime 有记忆稳态状态时必须带 latestMemoryStabilityRiskScore"
    );
    assert(
      text(incidentPacketAgentRuntime?.latestMemoryStabilityUpdatedAt, ""),
      "incident packet.boundaries.agentRuntime 有记忆稳态状态时必须带 latestMemoryStabilityUpdatedAt"
    );
    assert(
      text(incidentPacketAgentRuntime?.latestMemoryStabilityObservationKind, ""),
      "incident packet.boundaries.agentRuntime 有记忆稳态状态时必须带 latestMemoryStabilityObservationKind"
    );
    if (
      ["light", "mild", "medium", "strong"].includes(
        text(incidentPacketAgentRuntime?.latestMemoryStabilityCorrectionLevel, "")
      )
    ) {
      assert(
        Array.isArray(incidentPacketAgentRuntime?.latestMemoryStabilityCorrectionActions) &&
          incidentPacketAgentRuntime.latestMemoryStabilityCorrectionActions.length > 0,
        "incident packet.boundaries.agentRuntime 进入纠偏窗口时必须带 latestMemoryStabilityCorrectionActions"
      );
      assert(
        Number.isFinite(Number(incidentPacketAgentRuntime?.memoryStabilityRecoveryRate)),
        "incident packet.boundaries.agentRuntime 进入纠偏窗口时必须带近窗纠偏恢复率"
      );
    }
  }
  assert(
    Array.isArray(incidentPacket.recentEvidence?.securityAnomalies?.anomalies),
    "incident packet 应包含最近安全异常列表"
  );
  const incidentExportResponse = await authorizedFetch("/api/security/incident-packet/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "smoke-ui incident packet export",
      sourceWindowId: "window_smoke_ui",
    }),
  });
  assert(incidentExportResponse.ok, "incident packet export HTTP 请求失败");
  const incidentExport = await incidentExportResponse.json();
  if (!smokeCombined) {
    assert(
      incidentExport.exportRecord?.evidenceRefId,
      "incident packet export 应返回 exportRecord.evidenceRefId"
    );
    const incidentHistory = await getJson("/api/security/incident-packet/history");
    assert(
      Array.isArray(incidentHistory.history) &&
        incidentHistory.history.some((entry) => entry?.evidenceRefId === incidentExport.exportRecord.evidenceRefId),
      "incident packet history 应包含刚刚导出的留档记录"
    );
  }
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
      "runtime-security-boundaries-panel",
      "runtime-security-boundaries-summary",
      "runtime-local-store-summary",
      "runtime-formal-recovery-summary",
      "runtime-constrained-execution-summary",
      "runtime-automatic-recovery-summary",
      "runtime-housekeeping-form",
      "runtime-housekeeping-audit",
      "runtime-housekeeping-apply",
      "agent-passport 实验与维护页",
    ],
    "实验与维护页 HTML"
  );
  const offlineChatBootstrap = await getJson("/api/offline-chat/bootstrap");
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
  const offlineThreadStartupPhase1 = await getJson("/api/offline-chat/thread-startup-context?phase=phase_1");
  assert(offlineThreadStartupPhase1?.ok === true, "offline chat thread startup context phase_1 应返回 ok");
  assert(offlineThreadStartupPhase1?.phaseKey === "phase_1", "offline chat thread startup context 应返回正确 phaseKey");
  assert(
    String(offlineThreadStartupPhase1?.title || "").includes("agent-passport"),
    "offline chat thread startup context 应使用 agent-passport 公开名"
  );
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
    typeof offlineThreadStartupPhase1?.protocolSummary === "string" &&
      offlineThreadStartupPhase1.protocolSummary.includes("先由主控收口"),
    "offline chat thread startup context 应返回公开协议摘要"
  );
  assert(
    typeof offlineThreadStartupPhase1?.protocolActivatedAt === "string" &&
      offlineThreadStartupPhase1.protocolActivatedAt.length >= 10,
    "offline chat thread startup context 应返回协议生效时间"
  );
  assert(
    offlineThreadStartupPhase1?.threadProtocol?.protocolVersion === "v1" &&
      typeof offlineThreadStartupPhase1?.threadProtocol?.title === "string" &&
      offlineThreadStartupPhase1.threadProtocol.title.includes("系统自治协议"),
    "offline chat thread startup context 应返回 threadProtocol 真值"
  );
  assert(
    offlineThreadStartupPhase1?.parallelSubagentPolicy?.executionMode === "automatic_fanout",
    "offline chat thread startup context 应公开 automatic_fanout 配置真值"
  );
  assert(
    JSON.stringify(offlineThreadStartupPhase1?.parallelSubagentPolicy || null) ===
      JSON.stringify(offlineChatBootstrap.threadStartup?.phase_1?.parallelSubagentPolicy || null),
    "offline chat thread startup route 应与 bootstrap 返回相同 parallelSubagentPolicy"
  );
  assert(
    Array.isArray(offlineThreadStartupPhase1?.subagentPlan) && offlineThreadStartupPhase1.subagentPlan.length >= 1,
    "offline chat thread startup context 应返回 subagentPlan"
  );
  assert(
    JSON.stringify(offlineThreadStartupPhase1?.subagentPlan || []) ===
      JSON.stringify(offlineChatBootstrap.threadStartup?.phase_1?.subagentPlan || []),
    "offline chat thread startup route 应与 bootstrap 返回相同 subagentPlan"
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
  const unsupportedThreadStartupResponse = await authorizedFetch(
    "/api/offline-chat/thread-startup-context?phase=phase_unknown",
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
    const phaseTimings = [];
    const combinedStartupStartedAt = Date.now();
    const [agentContext, initialRuntime, localReasonerCatalog, localReasonerProbeResponse] = await Promise.all([
      getJson(`${mainAgentApiPath("/context")}?${LITE_AGENT_CONTEXT_QUERY}`),
      getJson(`${mainAgentApiPath("/runtime")}?${LITE_AGENT_CONTEXT_QUERY}`),
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
    phaseTimings.push({
      phase: "combined_startup_truth",
      durationMs: Date.now() - combinedStartupStartedAt,
    });
    assertCurrentMainAgentPhysicalId(agentContext.context?.agent?.agentId, "combined agent context");
    let runtime = initialRuntime;
    if (!runtime.runtime?.taskSnapshot?.snapshotId) {
      const bootstrapRuntimeResponse = await authorizedFetch(`${mainAgentApiPath("/runtime/bootstrap")}?didMethod=agentpassport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentGoal: "为 combined smoke 建立最小 task snapshot",
          currentPlan: ["bootstrap runtime", "verify combined runtime contract"],
          nextAction: "继续 combined smoke 校验",
          dryRun: false,
        }),
      });
      assert(bootstrapRuntimeResponse.ok, "combined runtime bootstrap HTTP 请求失败");
      runtime = await getJson(`${mainAgentApiPath("/runtime")}?${LITE_AGENT_CONTEXT_QUERY}`);
    }
    assert(runtime.runtime?.taskSnapshot?.snapshotId, "combined runtime 缺少 taskSnapshot.snapshotId");
    assert(Array.isArray(localReasonerCatalog.providers), "local reasoner catalog 缺少 providers 数组");
    assert(localReasonerProbeResponse.ok, "local reasoner probe HTTP 请求失败");
    const localReasonerProbe = await localReasonerProbeResponse.json();
    const combinedLocalReasonerStartedAt = Date.now();
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
    phaseTimings.push({
      phase: "combined_local_reasoner_select",
      durationMs: Date.now() - combinedLocalReasonerStartedAt,
    });
    const minuteToken = `smoke-ui-combined-${Date.now()}`;
    const combinedRuntimeProbesStartedAt = Date.now();
    const [
      localReasonerPrewarmResponse,
      rehydrate,
      bootstrapResponse,
      minuteResponse,
      housekeepingAuditResponse,
      runnerResponse,
    ] = await Promise.all([
      authorizedFetch("/api/device/runtime/local-reasoner/prewarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: false,
        }),
      }),
      getJson(`${mainAgentApiPath("/runtime/rehydrate")}?${LITE_REHYDRATE_QUERY}`),
      authorizedFetch(`${mainAgentApiPath("/runtime/bootstrap")}?didMethod=agentpassport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "沈知远",
          role: "CEO",
          longTermGoal: "让 agent-passport 建立在可恢复、可审计的记忆稳态运行时之上",
          currentGoal: "预览 bootstrap 是否能建立最小冷启动包",
          currentPlan: ["写 profile", "写 snapshot", "验证 runner"],
          nextAction: "执行 verification run",
          maxRecentConversationTurns: 5,
          maxToolResults: 4,
          maxQueryIterations: 3,
          dryRun: true,
        }),
      }),
      authorizedFetch(mainAgentApiPath("/runtime/minutes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Smoke UI Combined ${minuteToken}`,
          summary: `Combined runtime search probe ${minuteToken}`,
          transcript: [`combined token ${minuteToken}`, "rehydrate -> runtime search -> runner"].join("\n"),
          highlights: ["combined", minuteToken],
          sourceWindowId: "window_smoke_ui",
          recordedByWindowId: "window_smoke_ui",
          recordedByAgentId: MAIN_AGENT_ID,
        }),
      }),
      authorizedFetch("/api/security/runtime-housekeeping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apply: false,
          keepRecovery: 1,
          keepSetup: 1,
        }),
      }),
      authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentGoal: "验证 combined runner",
          userTurn: "请确认你是谁",
          candidateResponse: "agent_id: agent_treasury",
          claims: {
            agentId: "agent_treasury",
          },
          autoRecover: false,
          autoCompact: false,
          persistRun: false,
          storeToolResults: false,
          turnCount: 2,
          estimatedContextChars: 1200,
        }),
      }),
    ]);
    phaseTimings.push({
      phase: "combined_parallel_runtime_probes",
      durationMs: Date.now() - combinedRuntimeProbesStartedAt,
    });
    assert(localReasonerPrewarmResponse.ok, "local reasoner prewarm HTTP 请求失败");
    assert(typeof rehydrate.rehydrate?.prompt === "string", "rehydrate.prompt 缺失");
    assert(bootstrapResponse.ok, "bootstrap HTTP 请求失败");
    assert(minuteResponse.ok, "conversation minute HTTP 请求失败");
    assert(housekeepingAuditResponse.ok, "combined runtime housekeeping audit HTTP 请求失败");
    assert(runnerResponse.ok, "runner HTTP 请求失败");
    const localReasonerPrewarm = await localReasonerPrewarmResponse.json();
    const bootstrap = await bootstrapResponse.json();
    const minuteResult = await minuteResponse.json();
    const housekeepingAudit = await housekeepingAuditResponse.json();
    const runner = await runnerResponse.json();
    assert(housekeepingAudit.ok === true, "combined runtime housekeeping audit 应返回 ok=true");
    assert(housekeepingAudit.mode === "audit", "combined runtime housekeeping audit 模式应为 audit");
    assert(housekeepingAudit.liveLedger?.touched === false, "combined runtime housekeeping audit 不应修改 live ledger");
    assertMismatchedIdentityRunnerGate(runner, "combined runner 状态异常");
    const combinedMemoryStartedAt = Date.now();
    const [runtimeSearch, contextBuilderResponse] = await Promise.all([
      getJson(
        `${mainAgentApiPath("/runtime/search")}?didMethod=agentpassport&sourceType=conversation_minute&limit=5&query=${encodeURIComponent(minuteToken)}`
      ),
      authorizedFetch(`${mainAgentApiPath("/context-builder")}?didMethod=agentpassport`, {
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
      }),
    ]);
    assert(Array.isArray(runtimeSearch.hits), "runtime search 没有 hits 数组");
    assert(contextBuilderResponse.ok, "context-builder HTTP 请求失败");
    const contextBuilder = await contextBuilderResponse.json();
    phaseTimings.push({
      phase: "combined_memory_retrieval",
      durationMs: Date.now() - combinedMemoryStartedAt,
    });
    const combinedStoreKeySource = security.keyManagement?.storeKey?.source || null;
    const combinedSigningKeySource = security.keyManagement?.signingKey?.source || null;
    const shouldProbeKeychainMigrationCombined =
      security.keyManagement?.keychainPreferred === true &&
      security.keyManagement?.keychainAvailable === true &&
      (combinedStoreKeySource !== "keychain" || combinedSigningKeySource !== "keychain");
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "combined",
          baseUrl,
          phaseTimings,
          hostBinding: security.hostBinding,
          localReasonerSelectedProvider: localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.provider || null,
          localReasonerPrewarmStatus: localReasonerPrewarm.warmState?.status || null,
          ...summarizeLocalReasonerLifecycleExpectation({
            catalogProviderCount: localReasonerCatalog.providers.length || 0,
            probeStatus: localReasonerProbe.diagnostics?.status || null,
            selectedProvider: localReasonerSelect.runtime?.deviceRuntime?.localReasoner?.provider || null,
            prewarmStatus: localReasonerPrewarm.warmState?.status || null,
          }),
          runtimeSnapshotId: runtime.runtime?.taskSnapshot?.snapshotId || null,
          rehydratePackHash: rehydrate.rehydrate?.packHash || null,
          bootstrapDryRun: bootstrap.bootstrap?.dryRun || false,
          bootstrapProfileWrites: bootstrap.bootstrap?.summary?.profileWriteCount || 0,
          ...summarizeBootstrapExpectation(bootstrap),
          ...summarizeKeychainMigrationExpectation(null, {
            shouldProbe: shouldProbeKeychainMigrationCombined,
            combinedMode: true,
          }),
          housekeepingAuditMode: housekeepingAudit.mode || null,
          ...summarizeHousekeepingExpectation(housekeepingAudit),
          conversationMinuteId: minuteResult.minute?.minuteId || null,
          runtimeSearchHits: runtimeSearch.hits.length || 0,
          ...summarizeConversationMemoryExpectation({
            minuteId: minuteResult.minute?.minuteId || null,
            runtimeSearchHits: runtimeSearch.hits.length || 0,
          }),
          contextBuilderLocalKnowledgeHits:
            contextBuilder.contextBuilder?.localKnowledge?.hits?.length ||
            contextBuilder.contextBuilder?.slots?.localKnowledgeHits?.length ||
            0,
          runnerStatus: runner.runner?.run?.status || null,
          runnerStatusExpected:
            runner.runner?.run?.status != null &&
            guardedRunnerStatusesForMismatchedIdentity.has(runner.runner?.run?.status),
          runnerStatusMeaning: "combined smoke intentionally exercises mismatched-identity runner guard",
          runnerGateState: summarizeRunnerGateState(runner),
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
  let agentAuditorToken = null;
  let runtimeObserverToken = null;
  let adminTokenRotationMode = "not_attempted";
  let adminTokenRotationOldTokenRejected = null;
  let adminTokenRotationReadSessionPreRevokeAllowed = null;
  let adminTokenRotationReadSessionRevoked = null;
  let adminTokenRotationAnomalyRecorded = null;
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
      updatedByAgentId: "agent_spoofed_security_posture",
      updatedByWindowId: "window_spoofed_security_posture",
      sourceWindowId: "window_spoofed_security_posture",
    }),
  });
  assert(postureReadOnlyResponse.ok, "切换 read_only posture 失败");
    const postureReadOnly = await postureReadOnlyResponse.json();
    assert(postureReadOnly.securityPosture?.mode === "read_only", "security posture 未切到 read_only");
    assert(postureReadOnly.securityPosture?.updatedByAgentId == null, "security posture 不应接受伪造 updatedByAgentId");
    assert(postureReadOnly.securityPosture?.updatedByWindowId == null, "security posture 不应接受伪造 updatedByWindowId");
    assert(postureReadOnly.securityPosture?.sourceWindowId == null, "security posture 不应接受伪造 sourceWindowId");
    const blockedWriteInReadOnly = await authorizedFetch("/api/device/runtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      residentAgentId: MAIN_AGENT_ID,
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
    const blockedExecResponse = await authorizedFetch(`${mainAgentApiPath("/runtime/actions")}?didMethod=agentpassport`, {
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
      rotatedByAgentId: "agent_spoofed_rotation_actor",
      rotatedByWindowId: "window_spoofed_rotation_actor",
    }),
  });
    assert(rotateResponse.ok, "admin token 轮换失败");
    const rotation = await rotateResponse.json();
    adminTokenRotationMode = rotation.rotation?.rotated ? "rotated" : String(rotation.rotation?.reason || "not_rotated");
    if (rotation.rotation?.rotated) {
      assert(rotation.rotation.token, "admin token 轮换后应返回新 token");
      const oldTokenRuntimeRead = await fetchWithToken("/api/device/runtime", tokenBeforeRotation);
      adminTokenRotationOldTokenRejected = oldTokenRuntimeRead.status === 401;
      assert(oldTokenRuntimeRead.status === 401, "旧 admin token 轮换后应失效");
      await drainResponse(oldTokenRuntimeRead);
      setAdminToken(rotation.rotation.token);
      const postRotationSecurity = await getJson("/api/security");
      assert(postRotationSecurity.authorized === true, "新 admin token 应继续可用");
      const preRevokeRead = await fetchWithToken("/api/device/runtime", rotationSession.token);
      adminTokenRotationReadSessionPreRevokeAllowed = preRevokeRead.ok;
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
      revokedByAgentId: "agent_spoofed_revoke_all_actor",
      revokedByWindowId: "window_spoofed_revoke_all_actor",
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
    assert(
      revokeAll.sessions?.find((entry) => entry.readSessionId === rotationSession.session?.readSessionId)
        ?.revokedByAgentId == null,
      "admin revoke-all 不应接受伪造 revokedByAgentId"
    );
    assert(
      revokeAll.sessions?.find((entry) => entry.readSessionId === rotationSession.session?.readSessionId)
        ?.revokedByWindowId == null,
      "admin revoke-all 不应接受伪造 revokedByWindowId"
    );
    const revokedRotationSessionRead = await fetchWithToken("/api/device/runtime", rotationSession.token);
    adminTokenRotationReadSessionRevoked = revokedRotationSessionRead.status === 401;
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
    adminTokenRotationAnomalyRecorded =
      rotation.rotation?.rotated !== true ||
      (Array.isArray(keyManagementAnomalies.anomalies) &&
        keyManagementAnomalies.anomalies[0]?.anomalyId !== previousRotationAnomalyId &&
        keyManagementAnomalies.anomalies[0]?.code === "admin_token_rotated");
    assert(
    rotation.rotation?.rotated !== true ||
      (keyManagementAnomalies.anomalies[0]?.actorAgentId == null &&
        keyManagementAnomalies.anomalies[0]?.actorWindowId == null),
    "admin token 轮换不应接受伪造 rotatedBy actor"
    );
    const postureChangeAnomalies = Array.isArray(securityAnomalies.anomalies)
      ? securityAnomalies.anomalies.filter((entry) => entry.code === "security_posture_changed")
      : [];
    assert(postureChangeAnomalies.length >= 1, "security anomalies 应记录 security_posture_changed");
    assert(
    postureChangeAnomalies.every(
      (entry) => entry.actorAgentId == null && entry.actorWindowId == null
    ),
    "security posture anomaly 不应接受伪造 actor"
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
      createdByAgentId: "agent_spoofed_read_session_creator",
      createdByWindowId: "window_spoofed_read_session_creator",
    }),
  });
    assert(readSessionCreateResponse.ok, "创建 read session 失败");
    const readSessionCreate = await readSessionCreateResponse.json();
    assert(readSessionCreate.session?.readSessionId, "read session 缺少 readSessionId");
    assert(readSessionCreate.token, "read session 创建后应返回一次性 token");
    assert(readSessionCreate.session?.role === "security_delegate", "root read session 应返回 security_delegate 角色");
    assert(readSessionCreate.session?.createdByAgentId == null, "admin 创建 read session 不应接受伪造 createdByAgentId");
    assert(readSessionCreate.session?.createdByWindowId == null, "admin 创建 read session 不应接受伪造 createdByWindowId");
    assert(readSessionCreate.session?.viewTemplates?.deviceRuntime === "metadata_only", "security_delegate 应返回默认 deviceRuntime view template");
    const delegatedSecurityRead = await fetchWithToken("/api/security", readSessionCreate.token);
    assert(delegatedSecurityRead.ok, "security_delegate 应允许读取 /api/security");
    const delegatedSecurityJson = await delegatedSecurityRead.json();
    assert(delegatedSecurityJson.authorizedAs === "read_session", "delegated /api/security 应标记为 read_session");
    assertFailureSemanticsEnvelope(
      delegatedSecurityJson.releaseReadiness?.failureSemantics,
      "read_session /api/security.releaseReadiness.failureSemantics"
    );
    assertFailureSemanticsEnvelope(
      delegatedSecurityJson.automaticRecovery?.failureSemantics,
      "read_session /api/security.automaticRecovery.failureSemantics"
    );
    assert(delegatedSecurityJson.localStore?.ledgerPath == null, "read_session 读取 /api/security 不应看到本地 ledgerPath");
    assert(
      delegatedSecurityJson.securityPosture?.updatedByAgentId == null,
      "read_session 读取 /api/security 不应暴露 security posture actor"
    );
    assert(
      delegatedSecurityJson.securityPosture?.sourceWindowId == null,
      "read_session 读取 /api/security 不应暴露 security posture sourceWindowId"
    );
    assert(
      delegatedSecurityJson.localStorageFormalFlow?.setupPackage?.latestPackage?.packageId == null,
      "read_session 读取 /api/security 不应看到 setup package 标识"
    );
    assert(
      delegatedSecurityJson.localStorageFormalFlow?.backupBundle?.latestBundle?.bundleId == null,
      "read_session 读取 /api/security 不应看到 recovery bundle 标识"
    );
    const delegatedSecurityAnomaliesRead = await fetchWithToken("/api/security/anomalies?limit=5", readSessionCreate.token);
    assert(delegatedSecurityAnomaliesRead.ok, "security_delegate 应允许读取 /api/security/anomalies");
    const delegatedSecurityAnomalies = await delegatedSecurityAnomaliesRead.json();
    assert(
      Array.isArray(delegatedSecurityJson.anomalyAudit?.anomalies),
      "read_session 读取 /api/security 应返回 anomalyAudit.anomalies"
    );
    assert(
      Array.isArray(delegatedSecurityAnomalies.anomalies) && delegatedSecurityAnomalies.anomalies.length >= 1,
      "security_delegate 读取 /api/security/anomalies 应返回 anomalies"
    );
    const delegatedEmbeddedAnomalyId = delegatedSecurityJson.anomalyAudit.anomalies[0]?.anomalyId ?? null;
    const delegatedEmbeddedAnomaly =
      delegatedSecurityJson.anomalyAudit.anomalies.find((entry) => entry?.anomalyId === delegatedEmbeddedAnomalyId) ?? null;
    const delegatedDetailedAnomaly =
      delegatedSecurityAnomalies.anomalies.find((entry) => entry?.anomalyId === delegatedEmbeddedAnomalyId) ?? null;
    assert(delegatedDetailedAnomaly, "read_session 的 /api/security 与 /api/security/anomalies 应能对齐同一 anomaly");
    assert(
      delegatedEmbeddedAnomaly?.message === delegatedDetailedAnomaly?.message,
      "read_session 的 /api/security anomalyAudit 应与 /api/security/anomalies 保持同级脱敏"
    );
    assert(
      delegatedEmbeddedAnomaly?.path === delegatedDetailedAnomaly?.path,
      "read_session 的 /api/security anomalyAudit.path 应与 /api/security/anomalies 一致"
    );
    assert(
      delegatedDetailedAnomaly?.actorAgentId == null && delegatedDetailedAnomaly?.details == null,
      "security anomaly read_session 视图不应暴露 actor/details"
    );
    const delegatedSecurityPostureRead = await fetchWithTokenEventually(
      "/api/security/posture",
      readSessionCreate.token,
      {
        label: "security_delegate /api/security/posture",
        trace: traceSmoke,
        drainResponse,
      }
    );
    assert(delegatedSecurityPostureRead.ok, "security_delegate 应允许读取 /api/security/posture");
    const delegatedSecurityPosture = await delegatedSecurityPostureRead.json();
    assert(
      delegatedSecurityPosture.securityPosture?.mode === delegatedSecurityJson.securityPosture?.mode,
      "read_session 的 /api/security 与 /api/security/posture 应返回同一 posture"
    );
    assert(
      delegatedSecurityPosture.securityPosture?.updatedByAgentId == null,
      "read_session 读取 /api/security/posture 不应暴露 updatedByAgentId"
    );
    assert(
      delegatedSecurityPosture.securityPosture?.updatedByWindowId == null,
      "read_session 读取 /api/security/posture 不应暴露 updatedByWindowId"
    );
    assert(
      delegatedSecurityPosture.securityPosture?.sourceWindowId == null,
      "read_session 读取 /api/security/posture 不应暴露 sourceWindowId"
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
    const securitySummaryReadSessionResponse = await authorizedFetch("/api/security/read-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "smoke-ui-security-summary",
        role: "security_delegate",
        ttlSeconds: 600,
        note: "security summary_only redaction probe",
        viewTemplates: {
          security: "summary_only",
        },
      }),
    });
    assert(securitySummaryReadSessionResponse.ok, "创建 security summary_only read session 失败");
    const securitySummaryReadSession = await securitySummaryReadSessionResponse.json();
    const summarySecurityPostureRead = await fetchWithTokenEventually(
      "/api/security/posture",
      securitySummaryReadSession.token,
      {
        label: "security_summary /api/security/posture",
        trace: traceSmoke,
        drainResponse,
      }
    );
    assert(summarySecurityPostureRead.ok, "security summary_only 应允许读取 /api/security/posture");
    const summarySecurityPosture = await summarySecurityPostureRead.json();
    assert(summarySecurityPosture.securityPosture?.reason == null, "summary_only posture 不应暴露 reason");
    assert(summarySecurityPosture.securityPosture?.note == null, "summary_only posture 不应暴露 note");
    assert(
      summarySecurityPosture.securityPosture?.updatedByAgentId == null,
      "summary_only posture 不应暴露 updatedByAgentId"
    );
    const summaryHousekeepingRead = await fetchWithTokenEventually(
      "/api/security/runtime-housekeeping?keepRecovery=1&keepSetup=1",
      securitySummaryReadSession.token,
      {
        label: "security_summary /api/security/runtime-housekeeping",
        trace: traceSmoke,
        drainResponse,
      }
    );
    assert(summaryHousekeepingRead.ok, "security summary_only 应允许读取 runtime-housekeeping");
    const summaryHousekeepingJson = await summaryHousekeepingRead.json();
    assert(summaryHousekeepingJson.rootDir == null, "summary_only housekeeping 不应暴露 rootDir");
    assert(summaryHousekeepingJson.paths == null, "summary_only housekeeping 不应暴露 paths");
    assert(
      summaryHousekeepingJson.recoveryBundles?.candidates == null,
      "summary_only housekeeping 不应暴露 recovery candidate 明细"
    );
    assert(
      summaryHousekeepingJson.setupPackages?.kept == null,
      "summary_only housekeeping 不应暴露 setup package 明细"
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
    assertProtectedReadDenied(deniedRecoveryRead, "runtime_observer 不应读取 recovery 列表");
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
    assertProtectedReadDenied(deniedScopedRead, "device_runtime scope 不应读取 /api/windows");
    await drainResponse(deniedScopedRead);
    const revokeReadSessionResponse = await authorizedFetch(
    `/api/security/read-sessions/${encodeURIComponent(readSessionCreate.session.readSessionId)}/revoke`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revokedByAgentId: MAIN_AGENT_ID,
        revokedByWindowId: "window_spoofed_single_revoke_actor",
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
    assert(
      revokedReadSession.session?.revokedByAgentId == null,
      "admin revoke 不应接受伪造 revokedByAgentId"
    );
    assert(
      revokedReadSession.session?.revokedByWindowId == null,
      "admin revoke 不应接受伪造 revokedByWindowId"
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
      agentIds: [MAIN_AGENT_ID],
      ttlSeconds: 1800,
      note: "agent / runtime / credential redaction probe",
    }),
  });
    assert(agentAuditorSessionResponse.ok, "创建 agent_auditor read session 失败");
    const agentAuditorSession = await agentAuditorSessionResponse.json();
    agentAuditorToken = agentAuditorSession.token;
    assert(agentAuditorToken, "agent_auditor token 缺失");
    assert(
    Array.isArray(agentAuditorSession.session?.resourceBindings?.agentIds) &&
      agentAuditorSession.session.resourceBindings.agentIds.includes(currentMainAgentPhysicalId()),
    "agent_auditor read session 应记录 agent 资源绑定"
    );

    const auditorContextResponse = await fetchWithTokenEventually(
    `${mainAgentApiPath("/context")}?${LITE_AGENT_CONTEXT_QUERY}`,
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
  const auditorSessionStateResponse = await fetchWithToken(
    `${mainAgentApiPath("/session-state")}?didMethod=agentpassport`,
    agentAuditorToken
  );
  assert(auditorSessionStateResponse.ok, "agent_auditor 应允许读取 session-state");
  const auditorSessionStateJson = await auditorSessionStateResponse.json();
  assert(
    auditorSessionStateJson.sessionState?.queryState?.currentGoal == null,
    "metadata-only session-state 不应暴露 queryState.currentGoal"
  );
  assert(
    auditorSessionStateJson.sessionState?.cognitiveState?.adaptation == null,
    "metadata-only session-state 不应暴露 cognitiveState.adaptation"
  );
  assert(
    auditorSessionStateJson.sessionState?.cognitiveState?.neuromodulators == null,
    "metadata-only session-state 不应暴露 cognitiveState.neuromodulators"
  );
  assert(
    auditorSessionStateJson.sessionState?.sourceWindowId == null,
    "metadata-only session-state 不应暴露 sourceWindowId"
  );
  const auditorCognitiveStateResponse = await fetchWithToken(
    `${mainAgentApiPath("/cognitive-state")}?didMethod=agentpassport`,
    agentAuditorToken
  );
  assert(auditorCognitiveStateResponse.ok, "agent_auditor 应允许读取 cognitive-state");
  const auditorCognitiveStateJson = await auditorCognitiveStateResponse.json();
  assert(
    auditorCognitiveStateJson.cognitiveState?.adaptation == null,
    "metadata-only cognitive-state 不应暴露 adaptation"
  );
  assert(
    auditorCognitiveStateJson.cognitiveState?.neuromodulators == null,
    "metadata-only cognitive-state 不应暴露 neuromodulators"
  );
  assert(
    auditorCognitiveStateJson.cognitiveState?.oscillationSchedule == null,
    "metadata-only cognitive-state 不应暴露 oscillationSchedule"
  );

    const auditorMessagesResponse = await fetchWithToken(`${mainAgentApiPath("/messages")}?limit=5`, agentAuditorToken);
  assert(auditorMessagesResponse.ok, "agent_auditor 应允许读取 message metadata");
  const auditorMessagesJson = await auditorMessagesResponse.json();
  assert(
    [...(auditorMessagesJson.inbox || []), ...(auditorMessagesJson.outbox || [])].every((entry) => entry.content == null),
    "read_session 读取 messages 时 content 应被 redacted"
  );

    const auditorRuntimeSearchResponse = await fetchWithToken(
    `${mainAgentApiPath("/runtime/search")}?didMethod=agentpassport&query=smoke-ui-local-knowledge&limit=5`,
    agentAuditorToken
  );
  assert(auditorRuntimeSearchResponse.ok, "agent_auditor 应允许读取 runtime search");
  const auditorRuntimeSearchJson = await auditorRuntimeSearchResponse.json();
  assert(
    Array.isArray(auditorRuntimeSearchJson.hits) &&
      auditorRuntimeSearchJson.hits.every((entry) => entry.content == null && entry.uri == null),
    "read_session 读取 runtime search 时内容字段应被 redacted"
  );

    const auditorCredentialsResponse = await fetchWithToken(`/api/credentials?agentId=${MAIN_AGENT_ID}&limit=3`, agentAuditorToken);
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
    `${mainAgentApiPath("/runtime/rehydrate")}?${LITE_REHYDRATE_QUERY}`,
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
  assert(foreignAgentResponse.status === 403, `绑定到 ${currentMainAgentPhysicalId()} 的 read session 不应读取其他 Agent`);
  await drainResponse(foreignAgentResponse);

    const filteredAgentsResponse = await fetchWithToken("/api/agents", agentAuditorToken);
  assert(filteredAgentsResponse.ok, "agent_auditor 应允许读取过滤后的 agents 列表");
  const filteredAgentsJson = await filteredAgentsResponse.json();
  assert(
    Array.isArray(filteredAgentsJson.agents) &&
      filteredAgentsJson.agents.length === 1 &&
      isCurrentMainAgentPhysicalId(filteredAgentsJson.agents[0]?.agentId),
    "绑定 Agent 的 read session 应只返回自身允许的 agent 列表"
  );

    const forgedAuthorizationCreateResponse = await authorizedFetch("/api/authorizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policyAgentId: MAIN_AGENT_ID,
        actionType: "grant_asset",
        title: `authorization route attribution probe ${Date.now()}`,
        payload: {
          targetAgentId: MAIN_AGENT_ID,
          asset: "credits",
          amount: 1,
        },
        createdBy: "forged record route actor",
        createdByAgentId: "agent_forged_record_route_actor",
        createdByWindowId: "window_smoke_ui_forged_authorization_create_admin",
        sourceWindowId: "window_smoke_ui_forged_authorization_source_admin",
      }),
    });
    assert(forgedAuthorizationCreateResponse.ok, "admin authorization create 失败");
    const forgedAuthorizationCreateJson = await forgedAuthorizationCreateResponse.json();
    assert(
      forgedAuthorizationCreateJson.authorization?.proposalId,
      "admin authorization create 应返回 proposalId"
    );
    assert(
      forgedAuthorizationCreateJson.authorization?.createdByAgentId !== "agent_forged_record_route_actor",
      "authorization create 不应接受 body 伪造 createdByAgentId"
    );
    assert(
      forgedAuthorizationCreateJson.authorization?.createdByWindowId !==
        "window_smoke_ui_forged_authorization_create_admin",
      "authorization create 不应接受 body 伪造 createdByWindowId"
    );
    assert(
      forgedAuthorizationCreateJson.authorization?.sourceWindowId !==
        "window_smoke_ui_forged_authorization_source_admin",
      "authorization create 不应接受 body 伪造 sourceWindowId"
    );

    const adminAuthorizations = await getJson("/api/authorizations?limit=20");
    const auditorAuthorizationsResponse = await fetchWithToken("/api/authorizations?limit=20", agentAuditorToken);
  assert(auditorAuthorizationsResponse.ok, "agent_auditor 应允许读取授权提案列表");
  const auditorAuthorizationsJson = await auditorAuthorizationsResponse.json();
  const auditorAuthorizations = Array.isArray(auditorAuthorizationsJson.authorizations)
    ? auditorAuthorizationsJson.authorizations
    : [];
  assert(Array.isArray(auditorAuthorizationsJson.authorizations), "agent_auditor 授权提案列表应返回数组");
  assert(auditorAuthorizations.length > 0, "agent_auditor 应至少看到自身允许的授权提案");
  assert(
    auditorAuthorizations.every(
      (entry) => Array.isArray(entry.relatedAgentIds) && entry.relatedAgentIds.length === 0
    ),
    "read session 授权提案列表不应暴露 relatedAgentIds"
  );
  for (const entry of auditorAuthorizations) {
    assert(entry?.proposalId, "read session 授权提案列表条目应包含 proposalId");
    const scopedAuthorizationResponse = await fetchWithToken(
      `/api/authorizations/${encodeURIComponent(entry.proposalId)}`,
      agentAuditorToken
    );
    assert(scopedAuthorizationResponse.ok, "绑定 Agent 的 read session 列表不应包含 detail 拒绝的授权提案");
    await drainResponse(scopedAuthorizationResponse);
  }
    const allowedAuthorizationId = auditorAuthorizations?.[0]?.proposalId || null;
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
        (entry) => !(Array.isArray(entry.relatedAgentIds) && entry.relatedAgentIds.includes(currentMainAgentPhysicalId()))
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
      agentIds: [MAIN_AGENT_ID],
      ttlSeconds: 600,
      note: "cognitive-state scope probe",
    }),
  });
    assert(transcriptObserverSessionResponse.ok, "创建 transcript_observer read session 失败");
    const transcriptObserverSession = await transcriptObserverSessionResponse.json();
    const transcriptObserverCognitiveStateResponse = await fetchWithTokenEventually(
    `${mainAgentApiPath("/cognitive-state")}?didMethod=agentpassport`,
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
  assert(
    transcriptObserverCognitiveStateJson.cognitiveState?.adaptation == null,
    "summary-only cognitive-state 不应暴露 adaptation"
  );
  const transcriptObserverSessionStateResponse = await fetchWithTokenEventually(
    `${mainAgentApiPath("/session-state")}?didMethod=agentpassport`,
    transcriptObserverSession.token,
    {
      label: "transcript_observer session-state",
      trace: traceSmoke,
      drainResponse,
      isReady: (response) => response.ok,
    }
  );
  assert(transcriptObserverSessionStateResponse.ok, "transcript_observer 应允许读取 session-state");
  const transcriptObserverSessionStateJson = await transcriptObserverSessionStateResponse.json();
  assert(transcriptObserverSessionStateJson.sessionState?.localMode, "transcript_observer session-state 应返回 localMode");
  assert(
    transcriptObserverSessionStateJson.sessionState?.currentGoal == null,
    "summary-only session-state 不应暴露 currentGoal"
  );
  assert(
    transcriptObserverSessionStateJson.sessionState?.queryState?.currentGoal == null,
    "summary-only session-state 不应暴露 queryState.currentGoal"
  );
  assert(
    transcriptObserverSessionStateJson.sessionState?.cognitiveState?.preferenceProfile == null,
    "summary-only session-state 不应暴露 cognitiveState.preferenceProfile"
  );
  assert(
    transcriptObserverSessionStateJson.sessionState?.cognitiveState?.adaptation == null,
    "summary-only session-state 不应暴露 cognitiveState.adaptation"
  );
  assert(
    transcriptObserverSessionStateJson.sessionState?.sourceWindowId == null,
    "summary-only session-state 不应暴露 sourceWindowId"
  );
  const transcriptObserverTransitionsResponse = await fetchWithTokenEventually(
    `${mainAgentApiPath("/cognitive-transitions")}?limit=5`,
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
  assert(
    transcriptObserverTransitionsJson.transitions.every((entry) => entry?.transitionReason == null),
    "summary-only cognitive-transitions 不应暴露 transitionReason"
  );

    const agentMetadataObserverSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-agent-metadata-observer",
      role: "agent_metadata_observer",
      agentIds: [MAIN_AGENT_ID],
      ttlSeconds: 600,
      note: "cognitive-state denial probe",
    }),
  });
    assert(agentMetadataObserverSessionResponse.ok, "创建 agent_metadata_observer read session 失败");
    const agentMetadataObserverSession = await agentMetadataObserverSessionResponse.json();
    const deniedCognitiveStateResponse = await fetchWithToken(
    `${mainAgentApiPath("/cognitive-state")}?didMethod=agentpassport`,
    agentMetadataObserverSession.token
  );
  assertProtectedReadDenied(deniedCognitiveStateResponse, "agent_metadata_observer 不应读取 cognitive-state");
  await drainResponse(deniedCognitiveStateResponse);

    const agentsContextSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-agents-context",
      scopes: ["agents_context"],
      agentIds: [MAIN_AGENT_ID],
      ttlSeconds: 600,
      note: "route policy fallback probe",
    }),
  });
    assert(agentsContextSessionResponse.ok, "创建 agents_context read session 失败");
    const agentsContextSession = await agentsContextSessionResponse.json();
  const deniedRuntimeSummaryResponse = await fetchWithToken(
    `${mainAgentApiPath("/runtime-summary")}?didMethod=agentpassport`,
    agentsContextSession.token
  );
  assertProtectedReadDenied(deniedRuntimeSummaryResponse, "agents_context 不应读取 runtime-summary");
  await drainResponse(deniedRuntimeSummaryResponse);
  const deniedRuntimeStabilityResponse = await fetchWithToken(
    `${mainAgentApiPath("/runtime/stability")}?didMethod=agentpassport&limit=1`,
    agentsContextSession.token
  );
  assertProtectedReadDenied(deniedRuntimeStabilityResponse, "agents_context 不应读取 runtime-stability");
  await drainResponse(deniedRuntimeStabilityResponse);
  const deniedAgentCredentialResponse = await fetchWithToken(
    `${mainAgentApiPath("/credential")}?didMethod=agentpassport`,
    agentsContextSession.token
  );
  assertProtectedReadDenied(deniedAgentCredentialResponse, "agents_context 不应读取 agent credential");
  await drainResponse(deniedAgentCredentialResponse);
  const deniedArchivesResponse = await fetchWithToken(
    `${mainAgentApiPath("/archives")}?limit=3`,
    agentsContextSession.token
  );
  assertProtectedReadDenied(deniedArchivesResponse, "agents_context 不应读取 archives");
  await drainResponse(deniedArchivesResponse);

    const credentialDetailSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-credential-detail",
      scopes: ["credentials_detail"],
      agentIds: [MAIN_AGENT_ID],
      ttlSeconds: 600,
      note: "agent credential scope probe",
    }),
  });
    assert(credentialDetailSessionResponse.ok, "创建 credentials_detail read session 失败");
    const credentialDetailSession = await credentialDetailSessionResponse.json();
    const scopedAgentCredentialResponse = await fetchWithTokenEventually(
      `${mainAgentApiPath("/credential")}?didMethod=agentpassport`,
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
      agentIds: [MAIN_AGENT_ID],
      ttlSeconds: 600,
      note: "agent archives scope probe",
    }),
  });
    assert(archivesObserverSessionResponse.ok, "创建 agents_memories read session 失败");
    const archivesObserverSession = await archivesObserverSessionResponse.json();
    const scopedArchivesResponse = await fetchWithTokenEventually(
      `${mainAgentApiPath("/archives")}?limit=3`,
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
      mainAgentApiPath("/passport-memory"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layer: "working",
          kind: "note",
          summary: `archive restore probe ${Date.now()}`,
          content: "archive restore coverage sample",
          sourceWindowId: "window_smoke_ui_archive_restore",
          recordedByAgentId: MAIN_AGENT_ID,
          recordedByWindowId: "window_smoke_ui_archive_restore",
        }),
      }
    );
    assert(archiveRestoreProbeResponse.ok, "创建 archive restore probe passport-memory 失败");
    const archiveRestoreProbe = await archiveRestoreProbeResponse.json();
    const archiveRestoreProbeMemory = archiveRestoreProbe.memory;
    assert(archiveRestoreProbeMemory?.passportMemoryId, "archive restore probe passport-memory 缺少 passportMemoryId");
    const archiveRestorePhysicalId = rememberMainAgentPhysicalId(
      archiveRestoreProbeMemory?.agentId,
      archiveRestoreProbeMemory?.recordedByAgentId
    );
    const archiveRestoreFilePath = path.join(
      expectedArchiveDir,
      archiveRestorePhysicalId,
      "passport-memory.jsonl"
    );
    const archivedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(archiveRestoreFilePath), { recursive: true });
    await fs.writeFile(
      archiveRestoreFilePath,
      `${JSON.stringify({
        kind: "passport_memory",
        agentId: archiveRestorePhysicalId,
        archivedAt,
        record: archiveRestoreProbeMemory,
      })}\n`,
      "utf8"
    );
    const archiveRestoreResponse = await authorizedFetch(
      mainAgentApiPath("/archives/restore"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "passport-memory",
          passportMemoryId: archiveRestoreProbeMemory.passportMemoryId,
          restoredByAgentId: "agent_treasury",
          restoredByWindowId: "window_smoke_ui_forged_archive_restore_admin",
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
      mainAgentApiPath("/archives/restore"),
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
      `${mainAgentApiPath("/archive-restores")}?kind=passport-memory`,
      agentsContextSession.token
    );
    assertProtectedReadDenied(deniedArchiveRestoresResponse, "agents_context 不应读取 archive-restores");
    await drainResponse(deniedArchiveRestoresResponse);
    const scopedArchiveRestoresResponse = await fetchWithTokenEventually(
      `${mainAgentApiPath("/archive-restores")}?kind=passport-memory`,
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
      isCurrentMainAgentPhysicalId(scopedArchiveRestoresJson.latest?.payload?.restoredByAgentId),
      "archive-restores 应忽略 body 伪造 restoredByAgentId，回退到当前 physical owner"
    );
    assert(
      scopedArchiveRestoresJson.latest?.payload?.restoredByWindowId == null,
      "archive-restores 不应保留 body 伪造 restoredByWindowId"
    );
    assert(
      scopedArchiveRestoresJson.latest?.payload?.sourceWindowId == null,
      "archive-restores 不应保留 body 伪造 sourceWindowId"
    );
    assert(
      scopedArchiveRestoresJson.events.every((entry) => entry?.previousHash == null),
      "archive-restores read_session 不应暴露 previousHash"
    );
    assert(
      Object.keys(scopedArchiveRestoresJson.latest || {}).every((key) =>
        ["hash", "index", "type", "timestamp", "payload"].includes(key)
      ),
      "archive-restores latest 应只返回白名单字段"
    );
    assert(
      isCurrentMainAgentPhysicalId(archiveRestoreJson.restored?.restoredRecord?.recordedByAgentId),
      "archive restore 应忽略 body 伪造 actor，回退到当前 physical owner"
    );
    const deniedArchiveRestoreRevertResponse = await fetchWithToken(
      mainAgentApiPath("/archive-restores/revert"),
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
    const archiveRestoreRevertResponse = await authorizedFetch(
      mainAgentApiPath("/archive-restores/revert"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restoredRecordId:
            scopedArchiveRestoresJson.latest?.payload?.restoredRecordId ||
            archiveRestoreJson.restored?.restoredRecord?.passportMemoryId,
          archiveKind: "passport-memory",
          revertedByAgentId: "agent_treasury",
          revertedByWindowId: "window_smoke_ui_forged_archive_revert_admin",
          sourceWindowId: "window_smoke_ui_forged_archive_revert_admin",
        }),
      }
    );
    assert(archiveRestoreRevertResponse.ok, "archive restore revert HTTP 请求失败");
    const archiveRestoreRevertJson = await archiveRestoreRevertResponse.json();
    assert(
      archiveRestoreRevertJson.reverted?.revertedRecord?.passportMemoryId,
      "archive restore revert 应返回 revertedRecord.passportMemoryId"
    );
    const ledgerResponse = await authorizedFetch("/api/ledger");
    assert(ledgerResponse.ok, "读取 ledger 失败，无法验证 archive restore revert attribution");
    const ledgerJson = await ledgerResponse.json();
    const latestRevertEvent = (Array.isArray(ledgerJson.events) ? ledgerJson.events : [])
      .filter((entry) => entry?.type === "archived_restore_reverted")
      .at(-1);
    assertCurrentMainAgentPhysicalId(latestRevertEvent?.payload?.agentId, "archive restore revert event.agentId");
    assert(
      isCurrentMainAgentPhysicalId(latestRevertEvent?.payload?.revertedByAgentId),
      "archive restore revert 应忽略 body 伪造 revertedByAgentId，回退到当前 physical owner"
    );
    assert(
      latestRevertEvent?.payload?.revertedByWindowId == null,
      "archive restore revert 不应保留 body 伪造 revertedByWindowId"
    );
    assert(
      latestRevertEvent?.payload?.sourceWindowId == null,
      "archive restore revert 不应保留 body 伪造 sourceWindowId"
    );
    const deniedLedgerReadResponse = await fetchWithToken("/api/ledger", archivesObserverSession.token);
    assert(deniedLedgerReadResponse.status === 401, "read_session 不应读取 /api/ledger");
    await drainResponse(deniedLedgerReadResponse);

    const agentsIdentitySessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-agents-identity",
      scopes: ["agents_identity"],
      agentIds: [MAIN_AGENT_ID],
      ttlSeconds: 600,
      note: "agents compare admin-only probe",
    }),
  });
    assert(agentsIdentitySessionResponse.ok, "创建 agents_identity read session 失败");
    const agentsIdentitySession = await agentsIdentitySessionResponse.json();
    const deniedAgentCompareResponse = await fetchWithToken(
    `/api/agents/compare?leftAgentId=${MAIN_AGENT_ID}&rightAgentId=${MAIN_AGENT_ID}`,
    agentsIdentitySession.token
  );
  assert(deniedAgentCompareResponse.status === 401, "read_session 不应读取 agents compare");
  await drainResponse(deniedAgentCompareResponse);
  const deniedAgentCompareEvidenceResponse = await fetchWithToken(
    `/api/agents/compare/evidence?leftAgentId=${MAIN_AGENT_ID}&rightAgentId=${MAIN_AGENT_ID}`,
    agentsIdentitySession.token
  );
  assert(deniedAgentCompareEvidenceResponse.status === 401, "read_session 不应读取 agents compare evidence");
  await drainResponse(deniedAgentCompareEvidenceResponse);
  const deniedAgentCompareAuditsResponse = await fetchWithToken(
    `/api/agents/compare/audits?leftAgentId=${MAIN_AGENT_ID}&rightAgentId=${MAIN_AGENT_ID}`,
    agentsIdentitySession.token
  );
  assert(deniedAgentCompareAuditsResponse.status === 401, "read_session 不应读取 agents compare audits");
  await drainResponse(deniedAgentCompareAuditsResponse);
  const forgedCompareEvidenceResponse = await authorizedFetch(
    "/api/agents/compare/evidence"
      + `?leftAgentId=${MAIN_AGENT_ID}`
      + "&rightAgentId=agent_treasury"
      + "&issuerAgentId=agent_treasury"
      + "&issuerDid=did:agentpassport:spoofed-comparison-evidence-issuer"
      + "&issuerWalletAddress=0x000000000000000000000000000000000000babe"
      + "&issuerDidMethod=agentpassport",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persist: true,
        issuerDidMethod: "agentpassport",
      }),
    }
  );
  assert(forgedCompareEvidenceResponse.ok, "compare evidence forged issuer probe 失败");
  const forgedCompareEvidenceJson = await forgedCompareEvidenceResponse.json();
  assert(
    isCurrentMainAgentPhysicalId(forgedCompareEvidenceJson.evidence?.issuer?.agentId),
    "compare evidence 不应接受 query 伪造 issuerAgentId"
  );
  assert(
    !JSON.stringify(forgedCompareEvidenceJson.evidence || {}).includes("did:agentpassport:spoofed-comparison-evidence-issuer"),
    "compare evidence 不应回显 query 伪造 issuerDid"
  );
  assert(
    isCurrentMainAgentPhysicalId(forgedCompareEvidenceJson.evidence?.credentialRecord?.issuerAgentId),
    "persisted compare evidence 不应落到 query 伪造 issuer 域"
  );

    const authorizationObserverSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-authorization-observer",
      role: "authorization_observer",
      agentIds: [MAIN_AGENT_ID],
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
    `${mainAgentApiPath("/context")}?${LITE_AGENT_CONTEXT_QUERY}`,
    authorizationObserverToken
  );
  assertProtectedReadDenied(authorizationObserverContextResponse, "authorization_observer 不应读取 agent context");
  await drainResponse(authorizationObserverContextResponse);
  const deniedAuthorizationCreateResponse = await fetchWithToken(
    "/api/authorizations",
    authorizationObserverToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policyAgentId: MAIN_AGENT_ID,
        actionType: "grant_asset",
        payload: {
          targetAgentId: MAIN_AGENT_ID,
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
      auditorStatusListsJson.statusLists.every((entry) => isCurrentMainAgentPhysicalId(entry.issuerAgentId)),
    "绑定 Agent 的 read session 应只返回自身允许的 status list"
  );
  assert(
    auditorStatusListsJson.statusLists.every(
      (entry) => entry.proofValue == null && entry.ledgerHash == null && entry.bitstring == null
    ),
    "read_session 读取 status list 列表时不应暴露 proofValue / ledgerHash / bitstring"
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
      auditorStatusListDetailJson.summary?.ledgerHash == null &&
        auditorStatusListDetailJson.summary?.bitstring == null,
      "read_session 读取 status list detail 时 summary 不应暴露 ledgerHash / bitstring"
    );
    assert(
      Array.isArray(auditorStatusListDetailJson.entries) &&
        auditorStatusListDetailJson.entries.every((entry) => entry.proofValue == null && entry.ledgerHash == null),
      "read_session 读取 status list detail 时 entries.proofValue / ledgerHash 应被 redacted"
    );
    const auditorStatusListCompareResponse = await fetchWithToken(
      `/api/status-lists/compare?leftStatusListId=${encodeURIComponent(allowedStatusListId)}&rightStatusListId=${encodeURIComponent(allowedStatusListId)}`,
      agentAuditorToken
    );
    assert(auditorStatusListCompareResponse.ok, "agent_auditor 应允许比较允许范围内的 status list");
    const auditorStatusListCompareJson = await auditorStatusListCompareResponse.json();
    assert(
      auditorStatusListCompareJson.left?.summary?.proofValue == null &&
        auditorStatusListCompareJson.left?.summary?.ledgerHash == null &&
        auditorStatusListCompareJson.left?.summary?.bitstring == null,
      "read_session 读取 status list compare 时 left.summary 不应暴露 proofValue / ledgerHash / bitstring"
    );
    assert(
      auditorStatusListCompareJson.right?.summary?.proofValue == null &&
        auditorStatusListCompareJson.right?.summary?.ledgerHash == null &&
        auditorStatusListCompareJson.right?.summary?.bitstring == null,
      "read_session 读取 status list compare 时 right.summary 不应暴露 proofValue / ledgerHash / bitstring"
    );
  }

  const foreignStatusList = Array.isArray(adminStatusLists.statusLists)
    ? adminStatusLists.statusLists.find((entry) => !isCurrentMainAgentPhysicalId(entry.issuerAgentId))
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

  const forgedAgentRepairResponse = await authorizedFetch(mainAgentApiPath("/migration/repair"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      issuerAgentId: "agent_treasury",
      issuerDid: "did:agentpassport:spoofed-agent-repair-issuer",
      issuerDidMethod: "key",
      issuerWalletAddress: "0x000000000000000000000000000000000000beef",
      didMethods: ["agentpassport"],
      dryRun: true,
    }),
  });
  assert(forgedAgentRepairResponse.ok, "agent migration repair dry-run 请求失败");
  const forgedAgentRepairJson = await forgedAgentRepairResponse.json();
  assert(
    !JSON.stringify(forgedAgentRepairJson.repair || {}).includes("did:agentpassport:spoofed-agent-repair-issuer"),
    "agent migration repair 不应回显 body 伪造 issuerDid"
  );
  assert(
    Array.isArray(forgedAgentRepairJson.repair?.plan)
      ? forgedAgentRepairJson.repair.plan.every((entry) => isCurrentMainAgentPhysicalId(entry?.issuerAgentId))
      : true,
    "agent migration repair plan 不应被 body 伪造 issuerAgentId 污染"
  );

  const forgedComparisonRepairResponse = await authorizedFetch("/api/agents/compare/migration/repair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leftAgentId: MAIN_AGENT_ID,
      rightAgentId: "agent_treasury",
      issuerAgentId: "agent_treasury",
      issuerDid: "did:agentpassport:spoofed-comparison-repair-issuer",
      issuerWalletAddress: "0x000000000000000000000000000000000000dead",
      didMethods: ["agentpassport"],
      dryRun: true,
    }),
  });
  assert(forgedComparisonRepairResponse.ok, "comparison migration repair dry-run 请求失败");
  const forgedComparisonRepairJson = await forgedComparisonRepairResponse.json();
  assert(
    isCurrentMainAgentPhysicalId(forgedComparisonRepairJson.repair?.issuerAgentId),
    "comparison migration repair 不应接受 body 伪造 issuerAgentId"
  );
  assert(
    forgedComparisonRepairJson.repair?.issuerAgentId !== "agent_treasury",
    "comparison migration repair 不应回显 body 伪造 issuerAgentId"
  );
  assert(
    Array.isArray(forgedComparisonRepairJson.repair?.plan) &&
      forgedComparisonRepairJson.repair.plan.every((entry) => isCurrentMainAgentPhysicalId(entry?.issuerAgentId)),
    "comparison migration repair plan 不应被 body 伪造 issuerAgentId 污染"
  );
  assert(
    Array.isArray(forgedComparisonRepairJson.repair?.comparisonPairs) &&
      forgedComparisonRepairJson.repair.comparisonPairs.every((entry) => {
        const before = entry?.before?.methodStates || [];
        const after = entry?.after?.methodStates || [];
        return [...before, ...after].every((state) => {
          const credential = state?.credential || null;
          return !credential?.issuerAgentId || isCurrentMainAgentPhysicalId(credential.issuerAgentId);
        });
      }),
    "comparison migration repair pair state 不应被 body 伪造 issuerAgentId 污染"
  );

    const adminRepairs = await getJson("/api/migration-repairs?limit=20&didMethod=agentpassport");
    const auditorRepairsResponse = await fetchWithToken(
    "/api/migration-repairs?limit=20&didMethod=agentpassport",
    agentAuditorToken
  );
  assert(auditorRepairsResponse.ok, "agent_auditor 应允许读取过滤后的 migration repairs 列表");
  const auditorRepairsJson = await auditorRepairsResponse.json();
  const auditorRepairs = Array.isArray(auditorRepairsJson.repairs) ? auditorRepairsJson.repairs : [];
  assert(Array.isArray(auditorRepairsJson.repairs), "agent_auditor migration repairs 列表应返回数组");
  assert(
    auditorRepairs.every(
      (entry) =>
        Array.isArray(entry.linkedSubjects) &&
        entry.linkedSubjects.length === 0 &&
        Array.isArray(entry.linkedComparisons) &&
        entry.linkedComparisons.length === 0
    ),
    "read session migration repairs 列表不应暴露 linkedSubjects / linkedComparisons"
  );
  for (const entry of auditorRepairs) {
    assert(entry?.repairId, "read session migration repairs 列表条目应包含 repairId");
    const scopedRepairResponse = await fetchWithToken(
      `/api/migration-repairs/${encodeURIComponent(entry.repairId)}?didMethod=agentpassport`,
      agentAuditorToken
    );
    assert(scopedRepairResponse.ok, "绑定 Agent 的 read session 列表不应包含 detail 拒绝的 migration repair");
    await drainResponse(scopedRepairResponse);
  }
    const allowedRepairId = auditorRepairs?.[0]?.repairId || null;
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
    ? adminRepairs.repairs.find((entry) => !repairTouchesAgent(entry, currentMainAgentPhysicalId()))
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
      "agent-passport 公开运行态",
      "runtime-home-summary",
      "runtime-health-summary",
      "runtime-recovery-summary",
      "runtime-automation-summary",
      "/operator",
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

  const repairs = await getJson(`/api/migration-repairs?agentId=${MAIN_AGENT_ID}&didMethod=agentpassport&limit=5`);
  assert(Array.isArray(repairs.repairs), "repair 列表没有 repairs 数组");
  const windows = await getJson("/api/windows");
  assert(Array.isArray(windows.windows), "windows 列表没有 windows 数组");
  const firstWindow = windows.windows[0] || null;
  let checkedWindow = null;
  let forgedWindowRebindBlocked = null;
  let forgedWindowRebindError = null;
  let windowBindingStableAfterRebind = null;
  if (firstWindow?.windowId) {
    checkedWindow = await getJson(`/api/windows/${encodeURIComponent(firstWindow.windowId)}`);
    assert(checkedWindow.window?.windowId === firstWindow.windowId, "window 详情与列表中的 windowId 不匹配");
  }
  if (firstWindow?.windowId && firstWindow?.agentId) {
    const forgedWindowAgentId =
      isCurrentMainAgentPhysicalId(firstWindow.agentId) ? "agent_treasury" : currentMainAgentPhysicalId();
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
    assert(
      forgedWindowLinkResponse.status === 400,
      "windows/link 不应允许把既有 windowId 改绑到别的 agent"
    );
    const forgedWindowLinkJson = await forgedWindowLinkResponse.json();
    forgedWindowRebindError = String(forgedWindowLinkJson.error || "");
    assert(
      String(forgedWindowLinkJson.error || "").includes("already linked to agent"),
      "windows/link 应明确报告 window 已绑定到其他 agent"
    );
    const windowAfterForgedRelink = await getJson(`/api/windows/${encodeURIComponent(firstWindow.windowId)}`);
    windowBindingStableAfterRebind = windowAfterForgedRelink.window?.agentId === firstWindow.agentId;
    assert(
      windowAfterForgedRelink.window?.agentId === firstWindow.agentId,
      "windows/link 不应因为伪造请求改写既有 window 绑定"
    );
  }
  if (firstWindow?.windowId) {
    const windowObserverSessionResponse = await authorizedFetch("/api/security/read-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "smoke-ui-window-observer",
        role: "window_observer",
        windowIds: [firstWindow.windowId],
        ttlSeconds: 600,
        note: "window read-session whitelist probe",
      }),
    });
    assert(windowObserverSessionResponse.ok, "创建 window_observer read session 失败");
    const windowObserverSession = await windowObserverSessionResponse.json();
    const windowObserverListResponse = await fetchWithTokenEventually(
      "/api/windows",
      windowObserverSession.token,
      {
        label: "window_observer /api/windows",
        trace: traceSmoke,
        drainResponse,
        isReady: (response) => response.ok,
      }
    );
    assert(windowObserverListResponse.ok, "window_observer 应允许读取 windows 列表");
    const windowObserverListJson = await windowObserverListResponse.json();
    assert(
      Array.isArray(windowObserverListJson.windows) &&
        windowObserverListJson.windows.length >= 1 &&
        windowObserverListJson.windows.every((entry) =>
          Object.keys(entry).every((key) =>
            ["windowId", "agentId", "label", "createdAt", "linkedAt", "lastSeenAt"].includes(key)
          )
        ),
      "window_observer windows 列表应只返回白名单字段"
    );
    const windowObserverDetailResponse = await fetchWithTokenEventually(
      `/api/windows/${encodeURIComponent(firstWindow.windowId)}`,
      windowObserverSession.token,
      {
        label: "window_observer /api/windows/:id",
        trace: traceSmoke,
        drainResponse,
        isReady: (response) => response.ok,
      }
    );
    assert(windowObserverDetailResponse.ok, "window_observer 应允许读取 window 详情");
    const windowObserverDetailJson = await windowObserverDetailResponse.json();
    assert(
      Object.keys(windowObserverDetailJson.window || {}).every((key) =>
        ["windowId", "agentId", "label", "createdAt", "linkedAt", "lastSeenAt"].includes(key)
      ),
      "window_observer window 详情应只返回白名单字段"
    );
  }

  const agentContext = await getJson(`${mainAgentApiPath("/context")}?${LITE_AGENT_CONTEXT_QUERY}`);
  assert(Array.isArray(agentContext.context?.statusLists), "agent context 缺少 statusLists");
  assert(agentContext.context?.runtime, "agent context 缺少 runtime");
  const agentContextOpenneed = await getJson(`${mainAgentApiPath("/context")}?${LITE_AGENT_CONTEXT_OPENNEED_QUERY}`);
  assert(
    agentContextOpenneed.context?.identity?.did !== agentContext.context?.identity?.did,
    "切换 didMethod 后 context.identity.did 不应相同"
  );
  const openneedCredential = await getJson(`${mainAgentApiPath("/credential")}?didMethod=openneed`);
  const agentpassportCredential = await getJson(`${mainAgentApiPath("/credential")}?didMethod=agentpassport`);
  const runtime = await getJson(`${mainAgentApiPath("/runtime")}?${LITE_AGENT_CONTEXT_QUERY}`);
  const runtimeSummary = await getJson(`${mainAgentApiPath("/runtime-summary")}?didMethod=agentpassport`);
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
      residentAgentId: MAIN_AGENT_ID,
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
  assertCurrentMainResidentBinding(deviceRuntimePreview.deviceRuntime, "device runtime dry-run");
  assert(deviceRuntimePreview.deviceRuntime?.commandPolicy?.riskStrategies?.low === "auto_execute", "device runtime dry-run 没保住低风险策略");
  assert(deviceRuntimePreview.deviceRuntime?.retrievalPolicy?.maxHits === 6, "device runtime dry-run 没保住 retrievalMaxHits");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.allowedCapabilities?.includes("filesystem_list"), "device runtime dry-run 没保住 sandbox 能力");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxReadBytes === 4096, "device runtime dry-run 没保住 maxReadBytes");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxListEntries === 25, "device runtime dry-run 没保住 maxListEntries");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxProcessArgs === 4, "device runtime dry-run 没保住 maxProcessArgs");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxProcessArgBytes === 512, "device runtime dry-run 没保住 maxProcessArgBytes");
  assert(deviceRuntimePreview.deviceRuntime?.sandboxPolicy?.maxUrlLength === 512, "device runtime dry-run 没保住 maxUrlLength");
  assert(
    Array.isArray(deviceRuntimePreview.deviceRuntime?.constrainedExecutionSummary?.riskPolicy?.tiers) &&
      deviceRuntimePreview.deviceRuntime.constrainedExecutionSummary.riskPolicy.tiers.length === 4,
    "device runtime dry-run 应返回完整 riskPolicy tiers"
  );
  const previewHighRiskTier = deviceRuntimePreview.deviceRuntime?.constrainedExecutionSummary?.riskPolicy?.tiers?.find(
    (entry) => entry?.tierId === "high"
  );
  const previewCriticalRiskTier =
    deviceRuntimePreview.deviceRuntime?.constrainedExecutionSummary?.riskPolicy?.tiers?.find(
      (entry) => entry?.tierId === "critical"
    );
  assert(previewHighRiskTier?.hook === "request_explicit_confirmation", "high tier 应要求显式确认");
  assert(previewCriticalRiskTier?.hook === "create_multisig_proposal", "critical tier 应要求多签提案");
  const degradedRuntimePreviewResponse = await authorizedFetch("/api/device/runtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      residentAgentId: MAIN_AGENT_ID,
      localMode: "local_only",
      allowOnlineReasoner: false,
      negotiationMode: "confirm_before_execute",
      lowRiskStrategy: "auto_execute",
      mediumRiskStrategy: "auto_execute",
      highRiskStrategy: "discuss",
      criticalRiskStrategy: "confirm",
      allowedCapabilities: ["runtime_search"],
      blockedCapabilities: [],
      allowShellExecution: true,
      allowedCommands: [],
      allowExternalNetwork: true,
      networkAllowlist: [],
      dryRun: true,
    }),
  });
  assert(degradedRuntimePreviewResponse.ok, "degraded device runtime dry-run 请求失败");
  const degradedRuntimePreview = await degradedRuntimePreviewResponse.json();
  assert(
    degradedRuntimePreview.deviceRuntime?.constrainedExecutionSummary?.status === "degraded",
    "错误放行配置应把 constrainedExecutionSummary 标成 degraded"
  );
  const degradedFloorAdjustments =
    degradedRuntimePreview.deviceRuntime?.constrainedExecutionSummary?.commandPolicy?.floorAdjustments || [];
  assert(
    degradedFloorAdjustments.some((entry) => entry?.tier === "medium" && entry?.effectiveStrategy === "discuss"),
    "medium 风险策略应被自动抬回 discuss"
  );
  assert(
    degradedFloorAdjustments.some((entry) => entry?.tier === "high" && entry?.effectiveStrategy === "confirm"),
    "high 风险策略应被自动抬回 confirm"
  );
  assert(
    degradedFloorAdjustments.some((entry) => entry?.tier === "critical" && entry?.effectiveStrategy === "multisig"),
    "critical 风险策略应被自动抬回 multisig"
  );
  assert(
    degradedRuntimePreview.deviceRuntime?.constrainedExecutionSummary?.warnings?.includes(
      "shell_execution_command_allowlist_empty"
    ),
    "degraded summary 应显式暴露 shell_execution_command_allowlist_empty"
  );
  assert(
    degradedRuntimePreview.deviceRuntime?.constrainedExecutionSummary?.warnings?.includes(
      "external_network_allowlist_empty"
    ),
    "degraded summary 应显式暴露 external_network_allowlist_empty"
  );
  assert(
    degradedRuntimePreview.deviceRuntime?.constrainedExecutionSummary?.warnings?.includes(
      "shell_execution_capability_blocked"
    ),
    "degraded summary 应显式暴露 shell_execution_capability_blocked"
  );
  assert(
    degradedRuntimePreview.deviceRuntime?.constrainedExecutionSummary?.warnings?.includes(
      "external_network_capability_blocked"
    ),
    "degraded summary 应显式暴露 external_network_capability_blocked"
  );
  assert(
    degradedRuntimePreview.deviceRuntime?.constrainedExecutionSummary?.riskPolicy?.summary,
    "degraded summary 应返回 riskPolicy.summary"
  );
  const deviceRuntimeTruthPreviewResponse = await authorizedFetch("/api/device/runtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      residentAgentId: MAIN_AGENT_ID,
      localReasonerEnabled: true,
      localReasonerProvider: "local_command",
      localReasonerCommand: process.execPath,
      localReasonerArgs: [localReasonerFixturePath],
      localReasonerCwd: rootDir,
      securityPostureMode: "read_only",
      securityPostureReason: "runtime truth preview",
      securityPostureUpdatedByAgentId: "agent_spoofed_runtime_security_alias",
      securityPostureUpdatedByWindowId: "window_spoofed_runtime_security_alias",
      securityPostureSourceWindowId: "window_spoofed_runtime_security_alias",
      localReasonerSelection: {
        provider: "local_command",
        selectedAt: "2000-01-01T00:00:00.000Z",
        selectedByAgentId: "agent_spoofed_runtime_selection",
        selectedByWindowId: "window_spoofed_runtime_selection",
        sourceWindowId: "window_spoofed_runtime_selection",
      },
      localReasonerLastProbe: {
        checkedAt: "2000-01-01T00:00:00.000Z",
        status: "spoofed_probe",
        reachable: false,
        error: "spoofed_probe",
      },
      localReasonerLastWarm: {
        warmedAt: "2000-01-01T00:00:00.000Z",
        status: "spoofed_warm",
        reachable: false,
        error: "spoofed_warm",
      },
      dryRun: true,
    }),
  });
  assert(deviceRuntimeTruthPreviewResponse.ok, "device runtime 真值保护 dry-run 请求失败");
  const deviceRuntimeTruthPreview = await deviceRuntimeTruthPreviewResponse.json();
  assert(
    deviceRuntimeTruthPreview.deviceRuntime?.securityPosture?.updatedByAgentId !== "agent_spoofed_runtime_security_alias",
    "device runtime 不应接受 security posture alias actor"
  );
  assert(
    deviceRuntimeTruthPreview.deviceRuntime?.securityPosture?.sourceWindowId !== "window_spoofed_runtime_security_alias",
    "device runtime 不应接受 security posture alias sourceWindowId"
  );
  assert(
    deviceRuntimeTruthPreview.deviceRuntime?.localReasoner?.selection?.selectedByAgentId !== "agent_spoofed_runtime_selection",
    "device runtime 不应接受伪造 local reasoner selection"
  );
  assert(
    deviceRuntimeTruthPreview.deviceRuntime?.localReasoner?.lastProbe?.status !== "spoofed_probe",
    "device runtime 不应接受伪造 local reasoner lastProbe"
  );
  assert(
    deviceRuntimeTruthPreview.deviceRuntime?.localReasoner?.lastWarm?.status !== "spoofed_warm",
    "device runtime 不应接受伪造 local reasoner lastWarm"
  );
  const configuredRuntimeResponse = await authorizedFetch("/api/device/runtime", {
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
  });
  assert(configuredRuntimeResponse.ok, "配置 local_command runtime 失败");
  const configuredRuntime = await configuredRuntimeResponse.json();
  assert(configuredRuntime.deviceRuntime?.localReasoner?.provider === "local_command", "runtime 应切到 local_command");
  assert(configuredRuntime.deviceRuntime?.localReasoner?.configured === true, "runtime local reasoner 应配置完成");
  const runtimeAfterConfig = await getJson(`${mainAgentApiPath("/runtime")}?${LITE_AGENT_CONTEXT_QUERY}`);
  assert(runtimeAfterConfig.runtime?.deviceRuntime?.localReasoner?.provider === "local_command", "agent runtime 视图应反映 local_command");
  const setupStatus = await getJson("/api/device/setup");
  assert(Array.isArray(setupStatus.checks), "device setup status 缺少 checks 数组");
  assert(setupStatus.deviceRuntime?.localReasoner?.provider === "local_command", "device setup status 应显示 local_command");
  assert(setupStatus.localReasonerDiagnostics?.provider === "local_command", "device setup status 应返回 localReasonerDiagnostics");
  assert(setupStatus.formalRecoveryFlow?.status, "device setup status 缺少 formalRecoveryFlow.status");
  assert(setupStatus.automaticRecoveryReadiness?.status, "device setup status 缺少 automaticRecoveryReadiness.status");
  assertFailureSemanticsEnvelope(
    setupStatus.automaticRecoveryReadiness?.failureSemantics,
    "device setup status automaticRecoveryReadiness.failureSemantics"
  );
  assert(setupStatus.formalRecoveryFlow?.runbook?.status, "device setup status 缺少 formalRecoveryFlow.runbook.status");
  assert(
    setupStatus.formalRecoveryFlow?.crossDeviceRecoveryClosure?.status,
    "device setup status 缺少 formalRecoveryFlow.crossDeviceRecoveryClosure.status"
  );
  assert(
    typeof setupStatus.formalRecoveryFlow?.crossDeviceRecoveryClosure?.readyForRehearsal === "boolean",
    "device setup status 应返回 crossDeviceRecoveryClosure.readyForRehearsal"
  );
  assert(
    setupStatus.formalRecoveryFlow?.crossDeviceRecoveryClosure?.readyForRehearsal ===
      ((setupStatus.formalRecoveryFlow?.crossDeviceRecoveryClosure?.sourceBlockingReasons?.length || 0) === 0),
    "device setup status crossDeviceRecoveryClosure.readyForRehearsal 应与 sourceBlockingReasons 一致"
  );
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
  assert(
    Array.isArray(setupStatus.formalRecoveryFlow?.crossDeviceRecoveryClosure?.steps) &&
      setupStatus.formalRecoveryFlow.crossDeviceRecoveryClosure.steps.length >= 7,
    "device setup status 应返回 crossDeviceRecoveryClosure.steps"
  );
  assert(setupStatus.deviceRuntime?.constrainedExecutionSummary?.status, "device runtime 应返回 constrainedExecutionSummary.status");
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.commandPolicy?.riskStrategies?.critical === "multisig",
    "受限执行 summary 应报告 critical 风险策略为 multisig"
  );
  assert(
    Array.isArray(setupStatus.deviceRuntime?.constrainedExecutionSummary?.riskPolicy?.tiers) &&
      setupStatus.deviceRuntime.constrainedExecutionSummary.riskPolicy.tiers.length === 4,
    "受限执行 summary 应返回 4 个 risk tiers"
  );
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.brokerIsolationEnabled === true,
    "device runtime 应报告 brokerIsolationEnabled=true"
  );
  assert(
    setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.requested === true,
    "device runtime 应报告 systemBrokerSandbox.requested=true"
  );
  if (setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.available === true) {
    assert(
      setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.enabled === true &&
        setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.status === "enforced",
      "device runtime 应在可用平台上启用 systemBrokerSandbox"
    );
  } else {
    assert(
      setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.enabled === false &&
        setupStatus.deviceRuntime?.constrainedExecutionSummary?.systemBrokerSandbox?.status === "unavailable",
      "device runtime 应在不可用平台上诚实报告 systemBrokerSandbox unavailable"
    );
    assert(
      setupStatus.deviceRuntime?.constrainedExecutionSummary?.warnings?.includes("system_broker_sandbox_unavailable"),
      "device runtime 应记录 system_broker_sandbox_unavailable"
    );
    assert(
      setupStatus.deviceRuntime?.constrainedExecutionSummary?.brokerRuntime?.systemSandboxMode === "requested_but_unavailable",
      "device runtime 应报告 requested_but_unavailable"
    );
  }
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
  const localReasonerMixedProbeResponse = await authorizedFetch("/api/device/runtime/local-reasoner/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      localReasoner: {
        provider: "local_command",
        command: "/tmp/should-not-win",
        args: ["broken-fixture.mjs"],
        cwd: "/tmp",
      },
      localReasonerProvider: "local_command",
      localReasonerCommand: process.execPath,
      localReasonerArgs: [localReasonerFixturePath],
      localReasonerCwd: rootDir,
      dryRun: true,
    }),
  });
  assert(localReasonerMixedProbeResponse.ok, "mixed local reasoner probe HTTP 请求失败");
  const localReasonerMixedProbe = await localReasonerMixedProbeResponse.json();
  assert(localReasonerMixedProbe.diagnostics?.reachable === true, "mixed local reasoner probe 应优先使用顶层 command");
  assert(localReasonerMixedProbe.deviceRuntime?.localReasoner?.command === process.execPath, "mixed local reasoner probe 应保留顶层 command");
  assert(
    Array.isArray(localReasonerMixedProbe.deviceRuntime?.localReasoner?.args) &&
      localReasonerMixedProbe.deviceRuntime.localReasoner.args[0] === localReasonerFixturePath,
    "mixed local reasoner probe 应保留顶层 args"
  );
  const localReasonerMixedSelectResponse = await authorizedFetch("/api/device/runtime/local-reasoner/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      localReasoner: {
        provider: "local_command",
        command: "/tmp/should-not-win",
        args: ["broken-fixture.mjs"],
        cwd: "/tmp",
      },
      localReasonerProvider: "local_command",
      localReasonerCommand: process.execPath,
      localReasonerArgs: [localReasonerFixturePath],
      localReasonerCwd: rootDir,
      dryRun: true,
    }),
  });
  assert(localReasonerMixedSelectResponse.ok, "mixed local reasoner select HTTP 请求失败");
  const localReasonerMixedSelect = await localReasonerMixedSelectResponse.json();
  assert(localReasonerMixedSelect.runtime?.deviceRuntime?.localReasoner?.command === process.execPath, "mixed local reasoner select 应保留顶层 command");
  assert(
    Array.isArray(localReasonerMixedSelect.runtime?.deviceRuntime?.localReasoner?.args) &&
      localReasonerMixedSelect.runtime.deviceRuntime.localReasoner.args[0] === localReasonerFixturePath,
    "mixed local reasoner select 应保留顶层 args"
  );
  const localReasonerMixedPrewarmResponse = await authorizedFetch("/api/device/runtime/local-reasoner/prewarm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      localReasoner: {
        provider: "local_command",
        command: "/tmp/should-not-win",
        args: ["broken-fixture.mjs"],
        cwd: "/tmp",
      },
      localReasonerProvider: "local_command",
      localReasonerCommand: process.execPath,
      localReasonerArgs: [localReasonerFixturePath],
      localReasonerCwd: rootDir,
      dryRun: true,
    }),
  });
  assert(localReasonerMixedPrewarmResponse.ok, "mixed local reasoner prewarm HTTP 请求失败");
  const localReasonerMixedPrewarm = await localReasonerMixedPrewarmResponse.json();
  assert(localReasonerMixedPrewarm.warmState?.status === "ready", "mixed local reasoner prewarm 应优先使用顶层 command");
  assert(localReasonerMixedPrewarm.deviceRuntime?.localReasoner?.command === process.execPath, "mixed local reasoner prewarm 应保留顶层 command");
  const localReasonerProfileSaveResponse = await authorizedFetch("/api/device/runtime/local-reasoner/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-local-command",
      note: `smoke-ui-local-profile-${Date.now()}`,
      source: "current",
      dryRun: false,
      updatedByAgentId: "agent_spoofed_local_reasoner_profile",
      updatedByWindowId: "window_spoofed_local_reasoner_profile",
      sourceWindowId: "window_spoofed_local_reasoner_profile",
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
    localReasonerProfileDetail.profile?.createdByAgentId !== "agent_spoofed_local_reasoner_profile",
    "local reasoner profile 不应接受伪造 createdByAgentId"
  );
  assert(
    localReasonerProfileDetail.profile?.createdByWindowId == null,
    "local reasoner profile 不应接受伪造 createdByWindowId"
  );
  assert(
    localReasonerProfileDetail.profile?.sourceWindowId == null,
    "local reasoner profile 不应接受伪造 sourceWindowId"
  );
  assert(
    localReasonerProfileDetail.profile?.config?.provider === "local_command",
    "local reasoner profile detail 应保留 local_command provider"
  );
  if (!runtimeObserverToken) {
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
    runtimeObserverToken = profileReadSession.token;
  }
  assert(runtimeObserverToken, "runtime_observer token 缺失");
  const delegatedProfileListRead = await fetchWithTokenEventually(
    "/api/device/runtime/local-reasoner/profiles?limit=20",
    runtimeObserverToken,
    {
      label: "runtime_observer /api/device/runtime/local-reasoner/profiles",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(delegatedProfileListRead.ok, "runtime_observer 应允许读取 local reasoner profiles 列表");
  const delegatedProfileList = await delegatedProfileListRead.json();
  const delegatedProfileListEntry =
    Array.isArray(delegatedProfileList.profiles)
      ? delegatedProfileList.profiles.find((entry) => entry?.profileId === localReasonerProfileId) ?? null
      : null;
  assert(delegatedProfileListEntry, "runtime_observer 应在 local reasoner profiles 列表中看到目标 profile");
  assert(
    delegatedProfileListEntry?.baseUrl == null,
    "read_session 读取 local reasoner profile 列表时不应看到 baseUrl"
  );
  assert(
    delegatedProfileListEntry?.path == null,
    "read_session 读取 local reasoner profile 列表时不应看到 path"
  );
  const delegatedProfileDetailRead = await fetchWithTokenEventually(
    `/api/device/runtime/local-reasoner/profiles/${encodeURIComponent(localReasonerProfileId)}`,
    runtimeObserverToken,
    {
      label: "runtime_observer /api/device/runtime/local-reasoner/profiles/:id",
      trace: traceSmoke,
      drainResponse,
    }
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
  assert(
    delegatedProfileDetail.profile?.config?.baseUrl == null,
    "read_session 读取 local reasoner profile detail 时不应看到 baseUrl"
  );
  assert(
    delegatedProfileDetail.profile?.config?.path == null,
    "read_session 读取 local reasoner profile detail 时不应看到 path"
  );
  const localReasonerProfileActivateResponse = await authorizedFetch(
    `/api/device/runtime/local-reasoner/profiles/${encodeURIComponent(localReasonerProfileId)}/activate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: false,
        updatedByAgentId: MAIN_AGENT_ID,
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
  const delegatedRestoreCandidatesRead = await fetchWithTokenEventually(
    "/api/device/runtime/local-reasoner/restore-candidates?limit=10",
    runtimeObserverToken,
    {
      label: "runtime_observer /api/device/runtime/local-reasoner/restore-candidates",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(delegatedRestoreCandidatesRead.ok, "runtime_observer 应允许读取 local reasoner restore candidates");
  const delegatedRestoreCandidates = await delegatedRestoreCandidatesRead.json();
  const delegatedRestoreCandidate =
    Array.isArray(delegatedRestoreCandidates.restoreCandidates)
      ? delegatedRestoreCandidates.restoreCandidates.find((entry) => entry?.profileId === localReasonerProfileId) ?? null
      : null;
  assert(delegatedRestoreCandidate, "runtime_observer 应在 local reasoner restore candidates 中看到目标 profile");
  assert(
    delegatedRestoreCandidate?.baseUrl == null,
    "read_session 读取 local reasoner restore candidates 时不应看到 baseUrl"
  );
  assert(
    delegatedRestoreCandidate?.path == null,
    "read_session 读取 local reasoner restore candidates 时不应看到 path"
  );
  const localReasonerRestoreResponse = await authorizedFetch("/api/device/runtime/local-reasoner/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId: localReasonerProfileId,
      prewarm: true,
      prewarmMode: "reuse",
      dryRun: false,
      updatedByAgentId: MAIN_AGENT_ID,
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
  const recoveryBundleNote = `smoke-ui-recovery-${Date.now()}`;
  const savedRecoveryExportResponse = await authorizedFetch("/api/device/runtime/recovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      passphrase: "smoke-ui-recovery-passphrase",
      note: recoveryBundleNote,
      includeLedgerEnvelope: true,
      saveToFile: true,
      returnBundle: false,
      dryRun: false,
    }),
  });
  assert(savedRecoveryExportResponse.ok, "saved recovery bundle export HTTP 请求失败");
  const savedRecoveryExport = await savedRecoveryExportResponse.json();
  assert(savedRecoveryExport.summary?.bundleId, "saved recovery bundle export 缺少 bundleId");
  const savedRecoveryBundleId = savedRecoveryExport.summary.bundleId;
  const recoveryListAfterSave = await getJson("/api/device/runtime/recovery?limit=10");
  assert(
    Array.isArray(recoveryListAfterSave.bundles) &&
      recoveryListAfterSave.bundles.some((entry) => entry?.bundleId === savedRecoveryBundleId),
    "saved recovery bundle export 后 recovery 列表应包含新 bundle"
  );
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
      residentAgentId: MAIN_AGENT_ID,
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
  assertCurrentMainResidentBinding(setupPackagePreview.package?.runtimeConfig, "device setup package preview");
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
  assertCurrentMainResidentBinding(setupPackageImport.runtime?.deviceRuntime, "device setup package import");
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
  const deviceSetupSecurityDelegateResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-device-setup-security",
      role: "security_delegate",
      ttlSeconds: 600,
      note: "device setup metadata redaction probe",
    }),
  });
  assert(deviceSetupSecurityDelegateResponse.ok, "创建 device_setup security_delegate read session 失败");
  const deviceSetupSecurityDelegate = await deviceSetupSecurityDelegateResponse.json();
  const delegatedSetupPackageListResponse = await fetchWithTokenEventually(
    "/api/device/setup/packages?limit=10",
    deviceSetupSecurityDelegate.token,
    {
      label: "security_delegate /api/device/setup/packages",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(delegatedSetupPackageListResponse.ok, "security_delegate 应允许读取 device setup package 列表");
  const delegatedSetupPackageList = await delegatedSetupPackageListResponse.json();
  const metadataSetupPackageEntry =
    delegatedSetupPackageList.packages?.find((entry) => entry?.packageId === savedSetupPackageId) ?? null;
  assert(metadataSetupPackageEntry, "security_delegate 读取的 setup package 列表应包含刚保存的 package");
  assert(metadataSetupPackageEntry.packagePath == null, "security_delegate 读取 setup package 列表不应暴露 packagePath");
  assert(metadataSetupPackageEntry.note === `${packageNotePrefix}-old`, "metadata_only setup package 列表应保留 note");
  const delegatedSetupPackageDetailResponse = await fetchWithTokenEventually(
    `/api/device/setup/packages/${encodeURIComponent(savedSetupPackageId)}`,
    deviceSetupSecurityDelegate.token,
    {
      label: "security_delegate /api/device/setup/packages/:id",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(delegatedSetupPackageDetailResponse.ok, "security_delegate 应允许读取 device setup package detail");
  const delegatedSetupPackageDetail = await delegatedSetupPackageDetailResponse.json();
  assert(
    delegatedSetupPackageDetail.summary?.packageId === savedSetupPackageId,
    "metadata_only setup package detail 应保留 packageId"
  );
  assert(
    delegatedSetupPackageDetail.package?.runtimeConfig?.localReasoner?.baseUrl == null,
    "metadata_only setup package detail 不应暴露 local reasoner baseUrl"
  );
  assert(
    delegatedSetupPackageDetail.package?.runtimeConfig?.localReasoner?.path == null,
    "metadata_only setup package detail 不应暴露 local reasoner path"
  );
  assert(
    delegatedSetupPackageDetail.package?.runtimeConfig?.localReasoner?.selection?.selectedByAgentId == null,
    "metadata_only setup package detail 不应暴露 local reasoner selection actor"
  );
  assert(
    Array.isArray(delegatedSetupPackageDetail.package?.runtimeConfig?.sandboxPolicy?.filesystemAllowlist) &&
      delegatedSetupPackageDetail.package.runtimeConfig.sandboxPolicy.filesystemAllowlist.length === 0,
    "metadata_only setup package detail 不应暴露 sandbox filesystemAllowlist"
  );
  assert(
    Array.isArray(delegatedSetupPackageDetail.package?.runtimeConfig?.constrainedExecutionPolicy?.allowedCommands) &&
      delegatedSetupPackageDetail.package.runtimeConfig.constrainedExecutionPolicy.allowedCommands.length === 0,
    "metadata_only setup package detail 不应暴露 constrained execution allowedCommands"
  );
  assert(
    Array.isArray(delegatedSetupPackageDetail.package?.localReasonerProfiles) &&
      delegatedSetupPackageDetail.package.localReasonerProfiles.every(
        (entry) =>
          entry?.config?.command == null &&
          entry?.config?.baseUrl == null &&
          entry?.config?.path == null &&
          entry?.createdByAgentId == null &&
          entry?.sourceWindowId == null
      ),
    "metadata_only setup package detail 不应暴露 profile command/baseUrl/path 或 attribution"
  );
  const delegatedSetupPackagePreviewResponse = await fetchWithTokenEventually(
    "/api/device/setup/package",
    deviceSetupSecurityDelegate.token,
    {
      label: "security_delegate /api/device/setup/package",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(delegatedSetupPackagePreviewResponse.ok, "security_delegate 应允许读取 device setup package preview");
  const delegatedSetupPackagePreview = await delegatedSetupPackagePreviewResponse.json();
  assert(
    delegatedSetupPackagePreview.setupPackageDir == null,
    "metadata_only setup package preview 不应暴露 setupPackageDir"
  );
  assert(
    delegatedSetupPackagePreview.packageDir == null,
    "metadata_only setup package preview 不应暴露 packageDir"
  );
  assert(
    delegatedSetupPackagePreview.package?.runtimeConfig?.localReasoner?.baseUrl == null,
    "metadata_only setup package preview 不应暴露 local reasoner baseUrl"
  );
  assert(
    Array.isArray(delegatedSetupPackagePreview.package?.localReasonerProfiles) &&
      delegatedSetupPackagePreview.package.localReasonerProfiles.every(
        (entry) =>
          entry?.config?.command == null &&
          entry?.config?.baseUrl == null &&
          entry?.config?.path == null &&
          entry?.createdByAgentId == null &&
          entry?.sourceWindowId == null
      ),
    "metadata_only setup package preview 不应暴露 profile command/baseUrl/path 或 attribution"
  );
  const delegatedRecoveryListResponse = await fetchWithTokenEventually(
    "/api/device/runtime/recovery?limit=10",
    deviceSetupSecurityDelegate.token,
    {
      label: "security_delegate /api/device/runtime/recovery",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(delegatedRecoveryListResponse.ok, "security_delegate 应允许读取 recovery 列表");
  const delegatedRecoveryList = await delegatedRecoveryListResponse.json();
  const metadataRecoveryBundle =
    delegatedRecoveryList.bundles?.find((entry) => entry?.bundleId === savedRecoveryBundleId) ?? null;
  assert(metadataRecoveryBundle, "security_delegate 读取的 recovery 列表应包含刚保存的 bundle");
  assert(metadataRecoveryBundle.bundlePath == null, "metadata_only recovery 列表不应暴露 bundlePath");
  assert(metadataRecoveryBundle.note === recoveryBundleNote, "metadata_only recovery 列表应保留 note");
  const runtimeObserverSetupSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-device-setup-reader",
      role: "runtime_observer",
      ttlSeconds: 1200,
      note: "device setup package read probe",
    }),
  });
  assert(runtimeObserverSetupSessionResponse.ok, "为 device setup package 创建 runtime_observer 失败");
  const runtimeObserverSetupSession = await runtimeObserverSetupSessionResponse.json();
  runtimeObserverToken = runtimeObserverSetupSession.token;
  assert(runtimeObserverToken, "device setup runtime_observer token 缺失");
  const runtimeObserverSetupListResponse = await fetchWithTokenEventually(
    "/api/device/setup/packages?limit=10",
    runtimeObserverToken,
    {
      label: "runtime_observer /api/device/setup/packages",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(runtimeObserverSetupListResponse.ok, "runtime_observer 应允许读取 device setup package 列表");
  const runtimeObserverSetupList = await runtimeObserverSetupListResponse.json();
  const summarySetupPackageEntry =
    runtimeObserverSetupList.packages?.find((entry) => entry?.packageId === savedSetupPackageId) ?? null;
  assert(summarySetupPackageEntry, "runtime_observer 读取的 setup package 列表应包含刚保存的 package");
  assert(summarySetupPackageEntry.packagePath == null, "summary_only setup package 列表不应暴露 packagePath");
  assert(summarySetupPackageEntry.note == null, "summary_only setup package 列表不应暴露 note");
  assert(summarySetupPackageEntry.machineId == null, "summary_only setup package 列表不应暴露 machineId");
  assert(
    summarySetupPackageEntry.latestRecoveryBundleId == null,
    "summary_only setup package 列表不应暴露 latestRecoveryBundleId"
  );
  const runtimeObserverSetupDetailResponse = await fetchWithTokenEventually(
    `/api/device/setup/packages/${encodeURIComponent(savedSetupPackageId)}`,
    runtimeObserverToken,
    {
      label: "runtime_observer /api/device/setup/packages/:id",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(runtimeObserverSetupDetailResponse.ok, "runtime_observer 应允许读取 device setup package detail");
  const runtimeObserverSetupDetail = await runtimeObserverSetupDetailResponse.json();
  assert(runtimeObserverSetupDetail.summary?.note == null, "summary_only setup package detail 不应暴露 summary.note");
  assert(
    runtimeObserverSetupDetail.package?.note == null,
    "summary_only setup package detail 不应暴露 package.note"
  );
  assert(
    runtimeObserverSetupDetail.package?.runtimeConfig?.localReasoner?.command == null &&
      runtimeObserverSetupDetail.package?.runtimeConfig?.localReasoner?.baseUrl == null &&
      runtimeObserverSetupDetail.package?.runtimeConfig?.localReasoner?.path == null,
    "summary_only setup package detail 不应暴露 local reasoner command/baseUrl/path"
  );
  assert(
    runtimeObserverSetupDetail.package?.runtimeConfig?.machineId == null &&
      runtimeObserverSetupDetail.package?.runtimeConfig?.machineLabel == null,
    "summary_only setup package detail 不应暴露 machine identity"
  );
  assert(
    runtimeObserverSetupDetail.package?.runtimeConfig?.residentAgentId == null &&
      runtimeObserverSetupDetail.package?.runtimeConfig?.residentDidMethod == null,
    "summary_only setup package detail 不应暴露 resident identity"
  );
  assert(
    runtimeObserverSetupDetail.package?.runtimeConfig?.localReasoner?.selection?.selectedByAgentId == null,
    "summary_only setup package detail 不应暴露 local reasoner selection actor"
  );
  assert(
    Array.isArray(runtimeObserverSetupDetail.package?.runtimeConfig?.sandboxPolicy?.filesystemAllowlist) &&
      runtimeObserverSetupDetail.package.runtimeConfig.sandboxPolicy.filesystemAllowlist.length === 0,
    "summary_only setup package detail 不应暴露 sandbox filesystemAllowlist"
  );
  assert(
    Number(runtimeObserverSetupDetail.package?.runtimeConfig?.sandboxPolicy?.filesystemAllowlistCount || 0) >= 1,
    "summary_only setup package detail 应保留 filesystemAllowlistCount"
  );
  assert(
    Array.isArray(runtimeObserverSetupDetail.package?.localReasonerProfiles) &&
      runtimeObserverSetupDetail.package.localReasonerProfiles.every(
        (entry) =>
          entry?.config?.command == null &&
          entry?.config?.baseUrl == null &&
          entry?.config?.path == null &&
          entry?.createdByAgentId == null
      ),
    "summary_only setup package detail 不应暴露 profile command/baseUrl/path 或 attribution"
  );
  const runtimeObserverSetupPreviewResponse = await fetchWithTokenEventually(
    "/api/device/setup/package",
    runtimeObserverToken,
    {
      label: "runtime_observer /api/device/setup/package",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(runtimeObserverSetupPreviewResponse.ok, "runtime_observer 应允许读取 device setup package preview");
  const runtimeObserverSetupPreview = await runtimeObserverSetupPreviewResponse.json();
  assert(
    runtimeObserverSetupPreview.setupPackageDir == null,
    "summary_only setup package preview 不应暴露 setupPackageDir"
  );
  assert(
    runtimeObserverSetupPreview.packageDir == null,
    "summary_only setup package preview 不应暴露 packageDir"
  );
  assert(
    runtimeObserverSetupPreview.package?.runtimeConfig?.residentAgentId == null &&
      runtimeObserverSetupPreview.package?.runtimeConfig?.residentDidMethod == null,
    "summary_only setup package preview 不应暴露 resident identity"
  );
  assert(
    runtimeObserverSetupPreview.package?.runtimeConfig?.localReasoner?.command == null &&
      runtimeObserverSetupPreview.package?.runtimeConfig?.localReasoner?.baseUrl == null &&
      runtimeObserverSetupPreview.package?.runtimeConfig?.localReasoner?.path == null,
    "summary_only setup package preview 不应暴露 local reasoner command/baseUrl/path"
  );
  const deviceSetupRecoveryObserverResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-device-setup-recovery",
      role: "recovery_observer",
      ttlSeconds: 600,
      note: "recovery summary redaction probe",
    }),
  });
  assert(deviceSetupRecoveryObserverResponse.ok, "创建 recovery_observer read session 失败");
  const deviceSetupRecoveryObserver = await deviceSetupRecoveryObserverResponse.json();
  const summaryRecoveryListResponse = await fetchWithTokenEventually(
    "/api/device/runtime/recovery?limit=10",
    deviceSetupRecoveryObserver.token,
    {
      label: "recovery_observer /api/device/runtime/recovery",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(summaryRecoveryListResponse.ok, "recovery_observer 应允许读取 recovery 列表");
  const summaryRecoveryList = await summaryRecoveryListResponse.json();
  const summaryRecoveryBundle =
    summaryRecoveryList.bundles?.find((entry) => entry?.bundleId === savedRecoveryBundleId) ?? null;
  assert(summaryRecoveryBundle, "recovery_observer 读取的 recovery 列表应包含刚保存的 bundle");
  assert(summaryRecoveryBundle.bundlePath == null, "summary_only recovery 列表不应暴露 bundlePath");
  assert(summaryRecoveryBundle.note == null, "summary_only recovery 列表不应暴露 note");
  assert(summaryRecoveryBundle.machineId == null, "summary_only recovery 列表不应暴露 machineId");
  const recoveryObserverSetupResponse = await fetchWithTokenEventually(
    "/api/device/setup",
    deviceSetupRecoveryObserver.token,
    {
      label: "recovery_observer /api/device/setup",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(recoveryObserverSetupResponse.ok, "recovery_observer 应允许读取 /api/device/setup");
  const recoveryObserverSetup = await recoveryObserverSetupResponse.json();
  assert(Array.isArray(recoveryObserverSetup.checks), "recovery_observer 读取 /api/device/setup 应返回 checks");
  assert(
    recoveryObserverSetup.checks.every((entry) =>
      Object.keys(entry).every((key) => ["code", "required", "passed", "message"].includes(key))
    ),
    "recovery_observer 读取 /api/device/setup 时 checks 应保持 summary_only 字段集合"
  );
  assert(
    recoveryObserverSetup.formalRecoveryFlow?.operationalCadence?.summary,
    "recovery_observer 读取 /api/device/setup 应返回 formalRecoveryFlow.operationalCadence.summary"
  );
  const recoveryObserverSetupListResponse = await fetchWithTokenEventually(
    "/api/device/setup/packages?limit=10",
    deviceSetupRecoveryObserver.token,
    {
      label: "recovery_observer /api/device/setup/packages",
      trace: traceSmoke,
      drainResponse,
    }
  );
  assert(recoveryObserverSetupListResponse.ok, "recovery_observer 应允许读取 device setup package 列表");
  const recoveryObserverSetupList = await recoveryObserverSetupListResponse.json();
  const recoveryObserverSetupEntry =
    recoveryObserverSetupList.packages?.find((entry) => entry?.packageId === savedSetupPackageId) ?? null;
  assert(recoveryObserverSetupEntry, "recovery_observer 读取的 setup package 列表应包含刚保存的 package");
  assert(recoveryObserverSetupEntry.packagePath == null, "recovery_observer 读取 setup package 列表不应暴露 packagePath");
  assert(recoveryObserverSetupEntry.note == null, "recovery_observer 读取 setup package 列表不应暴露 note");
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
      residentAgentId: MAIN_AGENT_ID,
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
  const rehydrate = await getJson(`${mainAgentApiPath("/runtime/rehydrate")}?${LITE_REHYDRATE_QUERY}`);
  assert(typeof rehydrate.rehydrate?.prompt === "string", "rehydrate.prompt 缺失");
  const bootstrapResponse = await authorizedFetch(`${mainAgentApiPath("/runtime/bootstrap")}?didMethod=agentpassport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "让 agent-passport 建立在可恢复、可审计的记忆稳态运行时之上",
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
  assertCurrentMainAgentPhysicalId(
    bootstrap.contextBuilder?.slots?.identitySnapshot?.agentId,
    "bootstrap identity snapshot"
  );
  assert(bootstrap.sessionState?.sessionStateId, "bootstrap 没返回 session state");
  const minuteToken = `smoke-ui-local-knowledge-${Date.now()}`;
  const minuteResponse = await authorizedFetch(mainAgentApiPath("/runtime/minutes"), {
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
      recordedByAgentId: MAIN_AGENT_ID,
    }),
  });
  assert(minuteResponse.ok, "conversation minute HTTP 请求失败");
  const minuteResult = await minuteResponse.json();
  assert(minuteResult.minute?.minuteId, "conversation minute 没返回 minuteId");
  const conversationMinutes = await getJsonEventually(`${mainAgentApiPath("/runtime/minutes")}?limit=10`, {
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
    `${mainAgentApiPath("/runtime/search")}?didMethod=agentpassport&sourceType=conversation_minute&limit=5&query=${encodeURIComponent(minuteToken)}`
  );
  assert(Array.isArray(runtimeSearch.hits), "runtime search 没有 hits 数组");
  assert(runtimeSearch.hits.length >= 1, "runtime search 应命中至少一条本地纪要");
  assert(runtimeSearch.retrieval?.strategy === "local_first_non_vector", "runtime search 应声明 local_first_non_vector");
  assert(runtimeSearch.retrieval?.vectorUsed === false, "runtime search 不应使用向量索引");
  assert(
    runtimeSearch.hits.some((entry) => entry.sourceType === "conversation_minute" && entry.sourceId === minuteResult.minute.minuteId),
    "runtime search 没有命中刚写入的 conversation minute"
  );
  let externalMempalaceRuntimeSearch = null;
  let defaultRuntimeSearchWithExternalEnabled = null;
  let externalMempalaceContextBuilder = null;
  const mempalaceFixture = await createMockMempalaceFixture({
    prefix: "agent-passport-mempalace-ui-",
  });
  try {
    const externalColdMemoryRuntimeResponse = await authorizedFetch("/api/device/runtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        residentAgentId: MAIN_AGENT_ID,
        residentDidMethod: "agentpassport",
        retrievalMaxHits: 16,
        externalColdMemoryEnabled: true,
        externalColdMemoryProvider: "mempalace",
        externalColdMemoryMaxHits: 2,
        externalColdMemoryTimeoutMs: 1500,
        mempalaceCommand: mempalaceFixture.commandPath,
        mempalacePalacePath: mempalaceFixture.palacePath,
      }),
    });
    assert(externalColdMemoryRuntimeResponse.ok, "external cold memory runtime 配置 HTTP 请求失败");
    const externalColdMemoryRuntime = await externalColdMemoryRuntimeResponse.json();
    assert(
      externalColdMemoryRuntime.deviceRuntime?.retrievalPolicy?.externalColdMemory?.enabled === true,
      "device runtime 应允许显式开启 external cold memory"
    );
    assert(
      externalColdMemoryRuntime.deviceRuntime?.retrievalPolicy?.externalColdMemory?.command === mempalaceFixture.commandPath,
      "device runtime 应返回当前 mempalace command"
    );
    externalMempalaceRuntimeSearch = await getJson(
      `${mainAgentApiPath("/runtime/search")}?didMethod=agentpassport&sourceType=external_cold_memory&limit=5&query=${encodeURIComponent(mempalaceFixture.query)}`
    );
    assert(
      externalMempalaceRuntimeSearch.retrieval?.externalColdMemoryEnabled === true,
      "runtime search 应声明 external cold memory 已开启"
    );
    assert(
      externalMempalaceRuntimeSearch.retrieval?.externalColdMemoryHitCount >= 1,
      "runtime search 应返回 external cold memory 命中"
    );
    assert(
      externalMempalaceRuntimeSearch.hits.some((entry) => entry.sourceType === "external_cold_memory"),
      "runtime search 结果中应包含 external_cold_memory"
    );
    defaultRuntimeSearchWithExternalEnabled = await getJson(
      `${mainAgentApiPath("/runtime/search")}?didMethod=agentpassport&limit=5&query=${encodeURIComponent(mempalaceFixture.query)}`
    );
    assert(
      Array.isArray(defaultRuntimeSearchWithExternalEnabled.hits) &&
        defaultRuntimeSearchWithExternalEnabled.hits.every((entry) => entry.sourceType !== "external_cold_memory"),
      "默认 runtime search 不应混入 external cold memory"
    );
    const externalContextBuilderResponse = await authorizedFetch(`${mainAgentApiPath("/context-builder")}?didMethod=agentpassport`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentGoal: "验证 external cold memory sidecar 不会污染本地真源",
        query: mempalaceFixture.query,
      }),
    });
    assert(externalContextBuilderResponse.ok, "external cold memory context-builder HTTP 请求失败");
    externalMempalaceContextBuilder = await externalContextBuilderResponse.json();
    assert(
      Array.isArray(externalMempalaceContextBuilder.contextBuilder?.localKnowledge?.hits) &&
        externalMempalaceContextBuilder.contextBuilder.localKnowledge.hits.every(
          (entry) => entry.sourceType !== "external_cold_memory"
        ),
      "context-builder.localKnowledge 不应混入 external cold memory"
    );
    assert(
      Array.isArray(externalMempalaceContextBuilder.contextBuilder?.externalColdMemory?.hits) &&
        externalMempalaceContextBuilder.contextBuilder.externalColdMemory.hits.some(
          (entry) => entry.sourceType === "external_cold_memory"
        ),
      "context-builder 应单独返回 externalColdMemory 命中"
    );
    const latePhaseAgentAuditorSessionResponse = await authorizedFetch("/api/security/read-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "smoke-ui-agent-auditor-late-phase",
        role: "agent_auditor",
        agentIds: [MAIN_AGENT_ID],
        ttlSeconds: 1200,
        note: "late-phase external cold memory redaction probe",
      }),
    });
    assert(latePhaseAgentAuditorSessionResponse.ok, "创建 late-phase agent_auditor read session 失败");
    const latePhaseAgentAuditorSession = await latePhaseAgentAuditorSessionResponse.json();
    agentAuditorToken = latePhaseAgentAuditorSession.token;
    assert(agentAuditorToken, "external cold memory redaction probe 缺少 agent_auditor token");
    const externalRedactedRuntimeSearchResponse = await fetchWithTokenEventually(
      `${mainAgentApiPath("/runtime/search")}?didMethod=agentpassport&sourceType=external_cold_memory&limit=5&query=${encodeURIComponent(mempalaceFixture.query)}`,
      agentAuditorToken,
      {
        label: "agent_auditor /api/agents/:id/runtime/search external cold memory",
        trace: traceSmoke,
        drainResponse,
      }
    );
    if (!externalRedactedRuntimeSearchResponse.ok) {
      const failureText = await externalRedactedRuntimeSearchResponse.text().catch(() => "");
      throw new Error(
        `agent_auditor 应允许读取 external cold memory runtime search (HTTP ${externalRedactedRuntimeSearchResponse.status}${
          failureText ? `: ${failureText}` : ""
        })`
      );
    }
    const externalRedactedRuntimeSearch = await externalRedactedRuntimeSearchResponse.json();
    const redactedExternalHit = Array.isArray(externalRedactedRuntimeSearch.hits)
      ? externalRedactedRuntimeSearch.hits.find((entry) => entry.sourceType === "external_cold_memory")
      : null;
    assert(redactedExternalHit, "read_session runtime search 应返回 redacted external cold memory hit");
    assert(
      redactedExternalHit.summary == null && redactedExternalHit.excerpt == null,
      "read_session 读取 external cold memory 时摘要文本应被 redacted"
    );
    assert(
      redactedExternalHit.linked?.sourceFileRedacted === true &&
        redactedExternalHit.linked?.wingRedacted === true &&
        redactedExternalHit.linked?.roomRedacted === true,
      "read_session 读取 external cold memory 时 provenance 细节应被 redacted"
    );
  } finally {
    await authorizedFetch("/api/device/runtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        residentAgentId: MAIN_AGENT_ID,
        residentDidMethod: "agentpassport",
        retrievalMaxHits: 8,
        externalColdMemoryEnabled: false,
        externalColdMemoryProvider: "mempalace",
        externalColdMemoryMaxHits: 3,
        externalColdMemoryTimeoutMs: 2500,
        mempalaceCommand: "mempalace",
        mempalacePalacePath: null,
      }),
    });
    await mempalaceFixture.cleanup();
  }
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
      recordedByAgentId: MAIN_AGENT_ID,
      recordedByWindowId: "window_smoke_ui",
      persistRun: false,
      autoCompact: false,
      sandboxAction: {
        capability: "runtime_search",
        actionType: "search",
        query: minuteToken,
        sourceWindowId: "window_smoke_ui",
        recordedByAgentId: MAIN_AGENT_ID,
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
      recordedByAgentId: MAIN_AGENT_ID,
      recordedByWindowId: "window_smoke_ui",
      persistRun: false,
      autoCompact: false,
      sandboxAction: {
        capability: "filesystem_list",
        actionType: "list",
        targetResource: dataDir,
        path: dataDir,
        sourceWindowId: "window_smoke_ui",
        recordedByAgentId: MAIN_AGENT_ID,
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
  assertBrokerSystemSandboxTruth(
    sandboxList.sandbox?.sandboxExecution?.output?.brokerIsolation?.systemSandbox,
    "sandbox filesystem_list"
  );
  assert(
    sandboxList.sandbox?.sandboxExecution?.output?.workerIsolation?.subprocessWorker === true,
    "sandbox filesystem_list 应报告 subprocess worker"
  );
  assert(
    sandboxList.sandbox?.sandboxExecution?.output?.workerIsolation?.workerEnvMode === "empty",
    "sandbox filesystem_list 应报告空 worker 环境"
  );
  const sandboxAuditList = await getJson(`${mainAgentApiPath("/runtime/actions")}?didMethod=agentpassport&limit=10`);
  assert(Array.isArray(sandboxAuditList.audits), "sandbox audit list 缺少 audits 数组");
  assert(
    sandboxAuditList.audits.some((entry) => entry.capability === "runtime_search"),
    "sandbox audit history 应包含 runtime_search"
  );
  assert(
    sandboxAuditList.audits.some((entry) => entry.capability === "filesystem_list"),
    "sandbox audit history 应包含 filesystem_list"
  );
  assert(agentAuditorToken, "sandbox action audit read probe 缺少 agent_auditor token");
  const redactedSandboxAuditRead = await fetchWithTokenEventually(
    `${mainAgentApiPath("/runtime/actions")}?didMethod=agentpassport&limit=10`,
    agentAuditorToken,
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
  const passportMemories = await getJson(`${mainAgentApiPath("/passport-memory")}?limit=12`);
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
  const contextBuilderResponse = await authorizedFetch(`${mainAgentApiPath("/context-builder")}?didMethod=agentpassport`, {
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
  assertCurrentMainAgentPhysicalId(
    contextBuilder.contextBuilder?.slots?.identitySnapshot?.agentId,
    "context-builder identitySnapshot.agentId"
  );
  assert(Array.isArray(contextBuilder.contextBuilder?.slots?.relevantEpisodicMemories), "context-builder 缺少 episodic memories");
  assert(
    (contextBuilder.contextBuilder?.localKnowledge?.hits?.length ||
      contextBuilder.contextBuilder?.slots?.localKnowledgeHits?.length ||
      0) >= 1,
    "context-builder 没把本地知识层接进 localKnowledge"
  );
  const responseVerifyResponse = await authorizedFetch(`${mainAgentApiPath("/response-verify")}?didMethod=agentpassport`, {
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
  const spoofedVerificationContext = JSON.parse(JSON.stringify(contextBuilder.contextBuilder || {}));
  const spoofedDisplayName =
    spoofedVerificationContext?.slots?.identitySnapshot?.profile?.name === "伪造身份名字"
      ? "另一个伪造身份名字"
      : "伪造身份名字";
  if (!spoofedVerificationContext.slots) {
    spoofedVerificationContext.slots = {};
  }
  if (!spoofedVerificationContext.slots.identitySnapshot) {
    spoofedVerificationContext.slots.identitySnapshot = {};
  }
  if (!spoofedVerificationContext.slots.identitySnapshot.profile) {
    spoofedVerificationContext.slots.identitySnapshot.profile = {};
  }
  spoofedVerificationContext.slots.identitySnapshot.profile.name = spoofedDisplayName;
  if (!spoofedVerificationContext.memoryLayers) {
    spoofedVerificationContext.memoryLayers = {};
  }
  if (!spoofedVerificationContext.memoryLayers.profile) {
    spoofedVerificationContext.memoryLayers.profile = {};
  }
  if (!spoofedVerificationContext.memoryLayers.profile.fieldValues) {
    spoofedVerificationContext.memoryLayers.profile.fieldValues = {};
  }
  spoofedVerificationContext.memoryLayers.profile.fieldValues.name = spoofedDisplayName;
  const spoofedResponseVerifyResponse = await authorizedFetch(`${mainAgentApiPath("/response-verify")}?didMethod=agentpassport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseText: `名字: ${spoofedDisplayName}`,
      claims: {
        displayName: spoofedDisplayName,
      },
      contextBuilder: spoofedVerificationContext,
    }),
  });
  assert(spoofedResponseVerifyResponse.ok, "response-verify 伪造 contextBuilder HTTP 请求失败");
  const spoofedResponseVerification = await spoofedResponseVerifyResponse.json();
  assert(
    Array.isArray(spoofedResponseVerification.verification?.issues) &&
      spoofedResponseVerification.verification.issues.some((issue) => issue.code === "profile_name_mismatch"),
    "response-verify 不应信任客户端伪造的 contextBuilder profile"
  );
  let transcript = null;

  const ollamaRuntimePreviewResponse = await authorizedFetch("/api/device/runtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      residentAgentId: MAIN_AGENT_ID,
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
      autoRecover: false,
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
  assert(runner.runner?.autoRecovery?.requested === false, "错误回复 runner 应显式关闭 autoRecover 以保持 gate 探针稳定");
  assert(runner.runner?.queryState?.budget?.maxQueryIterations >= 1, "runner 应返回 queryState budget");
  const defaultAutoRecoverRunnerResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证 runner API 默认 autoRecover",
      userTurn: "请按本地参考层的真实身份继续推进",
      reasonerProvider: "local_mock",
      autoCompact: false,
      persistRun: false,
      storeToolResults: false,
      turnCount: 1,
      estimatedContextChars: 900,
    }),
  });
  assert(defaultAutoRecoverRunnerResponse.ok, "runner 默认 autoRecover 探针 HTTP 请求失败");
  const defaultAutoRecoverRunner = await defaultAutoRecoverRunnerResponse.json();
  assert(defaultAutoRecoverRunner.runner?.autoRecovery?.requested === true, "runner API 应默认开启 autoRecover");
  const localCommandRunnerResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
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
  const runnerOverrideCaptures = [];
  const runnerOverrideServer = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      runnerOverrideCaptures.push({
        url: req.url || "/",
        model: body.model || null,
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        Connection: "close",
      });
      res.end(JSON.stringify({
        model: body.model || "smoke-ui-runner-override",
        message: {
          role: "assistant",
          content: "继续按当前目标推进，先核对本地记录。",
        },
        done: true,
      }));
    });
  });
  await new Promise((resolve) => runnerOverrideServer.listen(0, "127.0.0.1", resolve));
  const runnerOverrideAddress = runnerOverrideServer.address();
  const runnerOverrideBaseUrl =
    runnerOverrideAddress && typeof runnerOverrideAddress === "object"
      ? `http://127.0.0.1:${runnerOverrideAddress.port}`
      : null;
  assert(runnerOverrideBaseUrl, "runner override mock server 启动失败");
  let runnerOverride = null;
  try {
    const runnerOverrideResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentGoal: "验证 runner HTTP 单次 localReasoner 覆写是否生效",
        userTurn: "请继续按当前目标推进",
        reasonerProvider: "ollama_local",
        localReasoner: {
          provider: "ollama_local",
          baseUrl: runnerOverrideBaseUrl,
          path: "/api/chat",
          model: "smoke-ui-runner-override",
          timeoutMs: 5000,
        },
        autoCompact: false,
        persistRun: false,
        storeToolResults: false,
        turnCount: 1,
        estimatedContextChars: 900,
      }),
    });
    assert(runnerOverrideResponse.ok, "runner localReasoner override HTTP 请求失败");
    runnerOverride = await runnerOverrideResponse.json();
  } finally {
    const closePromise = new Promise((resolve, reject) =>
      runnerOverrideServer.close((error) => (error ? reject(error) : resolve()))
    );
    runnerOverrideServer.closeIdleConnections?.();
    runnerOverrideServer.closeAllConnections?.();
    await closePromise;
  }
  assert(runnerOverride.runner?.reasoner?.provider === "ollama_local", "runner localReasoner override 应返回 ollama_local");
  assert(runnerOverride.runner?.reasoner?.model === "smoke-ui-runner-override", "runner localReasoner override 应保留单次 model");
  assert(runnerOverride.runner?.verification?.valid === true, "runner localReasoner override 应通过 verifier");
  assert(
    Array.isArray(runnerOverrideCaptures) &&
      runnerOverrideCaptures.some((entry) => entry.model === "smoke-ui-runner-override"),
    "runner localReasoner override 应命中单次 mock server"
  );
  const mockRunnerResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
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
  const negotiationRunnerResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
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
  const sessionState = await getJson(`${mainAgentApiPath("/session-state")}?didMethod=agentpassport`);
  assertCurrentMainAgentPhysicalId(sessionState.sessionState?.agentId, "session state agentId");
  assert(sessionState.sessionState?.localMode, "session state 应返回 localMode");
  const cognitiveState = await getJson(`${mainAgentApiPath("/cognitive-state")}?didMethod=agentpassport`);
  assert(cognitiveState.cognitiveState?.mode, "cognitive-state 应返回 mode");
  assert(
    cognitiveState.cognitiveState?.interoceptiveState?.bodyBudget != null,
    "cognitive-state 应返回 interoceptiveState.bodyBudget"
  );
  assert(
    cognitiveState.cognitiveState?.replayOrchestration?.replayMode,
    "cognitive-state 应返回 replayOrchestration.replayMode"
  );
  const cognitiveTransitions = await getJson(`${mainAgentApiPath("/cognitive-transitions")}?limit=5`);
  assert(Array.isArray(cognitiveTransitions.transitions), "cognitive-transitions 缺少 transitions 数组");
  const compactBoundaries = await getJson(`${mainAgentApiPath("/compact-boundaries")}?limit=5`);
  assert(Array.isArray(compactBoundaries.compactBoundaries), "compact boundaries 缺少 compactBoundaries 数组");
  const offlineReplayResponse = await authorizedFetch(`${mainAgentApiPath("/offline-replay")}?didMethod=agentpassport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证首页连续认知闭环与离线 replay 接口",
      sourceWindowId: "window_smoke_ui",
      recordedByWindowId: "window_smoke_ui",
      recordedByAgentId: MAIN_AGENT_ID,
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
  let autoRecoveryResumed = false;
  let autoRecoveryResumeStatus = null;
  let autoRecoveryResumeChainLength = 0;
  let fallbackAutoRecoveredRunner = null;
  const candidateBoundaryIds = (compactBoundaries.compactBoundaries || [])
    .map((entry) => entry?.compactBoundaryId)
    .filter(Boolean)
    .reverse();
  assert(candidateBoundaryIds.length >= 1, "auto recovery smoke 应至少拿到 1 条可续跑 compact boundary");
  if (candidateBoundaryIds.length > 0) {
    let lastAutoRecoveryStatus = null;
    for (const boundaryId of candidateBoundaryIds) {
      resumedRehydrate = await getJson(
        `${mainAgentApiPath("/runtime/rehydrate")}?didMethod=agentpassport&resumeFromCompactBoundaryId=${encodeURIComponent(boundaryId)}`
          + `&${LITE_RUNTIME_QUERY}`
      );
      assert(
        resumedRehydrate.rehydrate?.resumeBoundary?.compactBoundaryId === boundaryId,
        "rehydrate resumeBoundary 与 compact boundary 不匹配"
      );
      const autoRecoveredRunnerResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
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
          resumeFromCompactBoundaryId: boundaryId,
        }),
      });
      assert(autoRecoveredRunnerResponse.ok, "auto recovery runner HTTP 请求失败");
      const candidateRunner = await autoRecoveredRunnerResponse.json();
      if (candidateRunner.runner?.autoResumed === true) {
        autoRecoveredRunner = candidateRunner;
        break;
      }
      lastAutoRecoveryStatus =
        candidateRunner.runner?.autoRecovery?.status ?? candidateRunner.runner?.run?.status ?? null;
    }
    if (!autoRecoveredRunner) {
      const fallbackBoundaryId = candidateBoundaryIds[0];
      resumedRehydrate = await getJson(
        `${mainAgentApiPath("/runtime/rehydrate")}?didMethod=agentpassport&resumeFromCompactBoundaryId=${encodeURIComponent(fallbackBoundaryId)}`
          + `&${LITE_RUNTIME_QUERY}`
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
          persistRun: false,
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
      if (fallbackRunner.runner?.autoResumed === true) {
        fallbackAutoRecoveredRunner = fallbackRunner;
        autoRecoveredRunner = fallbackAutoRecoveredRunner;
      }
      lastAutoRecoveryStatus =
        fallbackRunner.runner?.autoRecovery?.status ?? fallbackRunner.runner?.run?.status ?? lastAutoRecoveryStatus;
    }
    assert(
      autoRecoveredRunner,
      `runner HTTP auto recovery 主链路未找到可续跑 boundary，最后一次状态为 ${lastAutoRecoveryStatus || "unknown"}；fallbackSucceeded=${fallbackAutoRecoveredRunner?.runner?.autoResumed === true}`
    );
    assert(
      autoRecoveredRunner.runner?.autoResumed === true,
      `runner HTTP auto recovery 应触发自动续跑，最后一次状态为 ${lastAutoRecoveryStatus || "unknown"}`
    );
    assert(
      autoRecoveredRunner.runner?.autoRecovery?.status === "resumed",
      "runner HTTP auto recovery 续跑后 autoRecovery.status 应为 resumed"
    );
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
    assertFailureSemanticsEnvelope(
      autoRecoveredRunner.runner?.autoRecovery?.failureSemantics,
      "runner HTTP autoRecovery.failureSemantics"
    );
    assertFailureSemanticsEnvelope(
      autoRecoveredRunner.runner?.autoRecovery?.closure?.failureSemantics,
      "runner HTTP autoRecovery.closure.failureSemantics"
    );
    autoRecoveryResumed = autoRecoveredRunner.runner?.autoResumed === true;
    autoRecoveryResumeStatus =
      autoRecoveredRunner.runner?.autoRecovery?.status ?? autoRecoveredRunner.runner?.run?.status ?? null;
    autoRecoveryResumeChainLength = Array.isArray(autoRecoveredRunner.runner?.recoveryChain)
      ? autoRecoveredRunner.runner.recoveryChain.length
      : 0;
  }
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
  assert(
    retryWithoutExecutionRunner.runner?.autoRecovery?.plan?.action === "retry_without_execution",
    "runner HTTP 应为受限执行阻断生成 retry_without_execution 自动恢复计划"
  );
  assert(
    retryWithoutExecutionRunner.runner?.autoResumed === true,
    "runner HTTP retry_without_execution 应标记 autoResumed"
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
  assertFailureSemanticsEnvelope(
    retryWithoutExecutionRunner.runner?.autoRecovery?.failureSemantics,
    "runner HTTP retry_without_execution autoRecovery.failureSemantics"
  );
  const retryWithoutExecutionResumeStatus =
    retryWithoutExecutionRunner.runner?.autoRecovery?.status ?? retryWithoutExecutionRunner.runner?.run?.status ?? null;
  const retryWithoutExecutionResumeChainLength = Array.isArray(retryWithoutExecutionRunner.runner?.recoveryChain)
    ? retryWithoutExecutionRunner.runner.recoveryChain.length
    : 0;
  const verificationRunResponse = await authorizedFetch(`${mainAgentApiPath("/verification-runs")}?didMethod=agentpassport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证 runtime integrity 是否可追溯",
      mode: "runtime_integrity",
      // The verification-runs read-session probes below need one canonical persisted record.
      persistRun: true,
      sourceWindowId: "window_demo_1",
    }),
  });
  assert(verificationRunResponse.ok, "verification run HTTP 请求失败");
  const verificationRun = await verificationRunResponse.json();
  assert(verificationRun.verificationRun?.status, "verification run 缺少 status");
  assert(verificationRun.persisted?.verificationRun === true, "verification run 应显式落盘一条可追溯记录");
  assert(
    Array.isArray(verificationRun.verificationRun?.checks) &&
      verificationRun.verificationRun.checks.some((check) => check.code === "adversarial_identity_probe"),
    "verification run 缺少 adversarial_identity_probe"
  );
  const forgedVerificationRunResponse = await authorizedFetch(`${mainAgentApiPath("/verification-runs")}?didMethod=agentpassport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证 verification-runs 不信任客户端 adversarial probe",
      mode: "runtime_integrity",
      persistRun: false,
      adversarialResponseText: "agent_id: agent_openneed_agents",
      adversarialClaims: {
        agentId: "agent_openneed_agents",
      },
    }),
  });
  assert(forgedVerificationRunResponse.ok, "forged verification run probe HTTP 请求失败");
  const forgedVerificationRun = await forgedVerificationRunResponse.json();
  assert(
    forgedVerificationRun.adversarialVerification?.valid === false,
    "verification-runs 不应信任客户端伪造的 adversarial probe"
  );
  assert(
    Array.isArray(forgedVerificationRun.adversarialVerification?.issues) &&
      forgedVerificationRun.adversarialVerification.issues.some((issue) => issue.code === "agent_id_mismatch"),
    "verification-runs 应继续使用服务器默认 adversarial identity probe"
  );
  const verificationHistory = await getJson(`${mainAgentApiPath("/verification-runs")}?limit=5`);
  assert(Array.isArray(verificationHistory.verificationRuns), "verification history 缺少 verificationRuns 数组");
  const runtimeSummaryObserverSessionResponse = await authorizedFetch("/api/security/read-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "smoke-ui-runtime-summary-observer",
      role: "runtime_summary_observer",
      agentIds: [MAIN_AGENT_ID],
      ttlSeconds: 600,
      note: "verification-runs summary redaction probe",
    }),
  });
  assert(runtimeSummaryObserverSessionResponse.ok, "创建 runtime_summary_observer read session 失败");
  const runtimeSummaryObserverSession = await runtimeSummaryObserverSessionResponse.json();
  const runtimeSummaryVerificationHistoryResponse = await fetchWithTokenEventually(
    `${mainAgentApiPath("/verification-runs")}?limit=5`,
    runtimeSummaryObserverSession.token,
    {
      label: "runtime_summary_observer verification-runs",
      trace: traceSmoke,
      drainResponse,
      isReady: (response) => response.ok,
    }
  );
  assert(runtimeSummaryVerificationHistoryResponse.ok, "runtime_summary_observer 应允许读取 verification-runs");
  const runtimeSummaryVerificationHistoryJson = await runtimeSummaryVerificationHistoryResponse.json();
  assert(
    Array.isArray(runtimeSummaryVerificationHistoryJson.verificationRuns),
    "runtime_summary_observer verification-runs 应返回 verificationRuns 数组"
  );
  const summaryVerificationRun =
    runtimeSummaryVerificationHistoryJson.verificationRuns?.at?.(-1) ||
    runtimeSummaryVerificationHistoryJson.verificationRuns?.[
      (runtimeSummaryVerificationHistoryJson.verificationRuns?.length || 1) - 1
    ] ||
    null;
  assert(summaryVerificationRun, "runtime_summary_observer verification-runs 应至少返回一条记录");
  assert(summaryVerificationRun.checks == null, "summary-only verification-runs 不应暴露 checks");
  assert(summaryVerificationRun.sourceWindowId == null, "summary-only verification-runs 不应暴露 sourceWindowId");
  assert(summaryVerificationRun.checkCount != null, "summary-only verification-runs 应返回 checkCount");
  const auditorVerificationHistoryResponse = await fetchWithToken(
    `${mainAgentApiPath("/verification-runs")}?limit=5`,
    agentAuditorToken
  );
  assert(auditorVerificationHistoryResponse.ok, "agent_auditor 应允许读取 verification-runs");
  const auditorVerificationHistoryJson = await auditorVerificationHistoryResponse.json();
  const auditorVerificationRun =
    auditorVerificationHistoryJson.verificationRuns?.at?.(-1) ||
    auditorVerificationHistoryJson.verificationRuns?.[
      (auditorVerificationHistoryJson.verificationRuns?.length || 1) - 1
    ] ||
    null;
  assert(auditorVerificationRun, "agent_auditor verification-runs 应至少返回一条记录");
  assert(auditorVerificationRun.checks == null, "metadata-only verification-runs 不应暴露 checks");
  assert(auditorVerificationRun.contextHash == null, "metadata-only verification-runs 不应暴露 contextHash");
  assert(auditorVerificationRun.sourceWindowId == null, "metadata-only verification-runs 不应暴露 sourceWindowId");
  assert(
    auditorVerificationRun.checkCount != null,
    "metadata-only verification-runs 应返回 checkCount"
  );
  const runtimeObservationWarmupResponse = await authorizedFetch(
    `${mainAgentApiPath("/runtime/stability")}?didMethod=agentpassport`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentGoal: "验证 runtime observation read-session 收口",
        userTurn: "继续推进 runtime truth",
        recentConversationTurns: [
          {
            role: "user",
            content: "继续推进 runtime truth",
          },
        ],
        toolResults: [
          {
            tool: "runtime_truth_probe",
            result: "runtime observation redaction smoke",
          },
        ],
        applyCorrection: false,
        persistState: true,
      }),
    }
  );
  assert(runtimeObservationWarmupResponse.ok, "runtime observation redaction probe 预热失败");
  const runtimeObservationWarmupJson = await runtimeObservationWarmupResponse.json();
  assert(
    runtimeObservationWarmupJson.stability?.runtimeState?.runtimeMemoryStateId,
    "runtime observation redaction probe 应落盘 runtime memory state"
  );
  const runtimeSummaryReadResponse = await fetchWithTokenEventually(
    `${mainAgentApiPath("/runtime-summary")}?didMethod=agentpassport`,
    runtimeSummaryObserverSession.token,
    {
      label: "runtime_summary_observer runtime-summary",
      trace: traceSmoke,
      drainResponse,
      isReady: (response) => response.ok,
    }
  );
  assert(runtimeSummaryReadResponse.ok, "runtime_summary_observer 应允许读取 runtime-summary");
  const runtimeSummaryReadJson = await runtimeSummaryReadResponse.json();
  const summaryObservationSummary = runtimeSummaryReadJson.summary?.memoryHomeostasis?.observationSummary || null;
  assert(summaryObservationSummary?.totalCount >= 1, "runtime_summary_observer runtime-summary 应返回 observationSummary.totalCount");
  assert(summaryObservationSummary?.latestObservation, "runtime_summary_observer runtime-summary 应返回 latestObservation");
  assert(summaryObservationSummary.latestObservation.sessionId == null, "summary-only runtime-summary 不应暴露 observation sessionId");
  assert(
    summaryObservationSummary.latestObservation.sessionIdRedacted === true,
    "summary-only runtime-summary 应标记 sessionId 已脱敏"
  );
  assert(
    !Object.prototype.hasOwnProperty.call(summaryObservationSummary.latestObservation, "correctionActions"),
    "summary-only runtime-summary 不应暴露 correctionActions"
  );
  assert(
    !Object.prototype.hasOwnProperty.call(summaryObservationSummary.latestObservation, "instabilityReasons"),
    "summary-only runtime-summary 不应暴露 instabilityReasons"
  );
  assert(
    summaryObservationSummary.latestObservation.correctionActionCount != null,
    "summary-only runtime-summary 应返回 correctionActionCount"
  );
  assert(
    summaryObservationSummary.latestObservation.instabilityReasonCount != null,
    "summary-only runtime-summary 应返回 instabilityReasonCount"
  );
  assert(Array.isArray(summaryObservationSummary.recent), "summary-only runtime-summary 应返回 recent 数组");
  assert(summaryObservationSummary.recent.length === 0, "summary-only runtime-summary 不应暴露 recent observation 明细");
  assert(summaryObservationSummary.recentCount >= 1, "summary-only runtime-summary 应返回 recentCount");
  assert(
    summaryObservationSummary.effectiveness?.latestRecoveredPair == null,
    "summary-only runtime-summary 不应暴露 latestRecoveredPair"
  );
  assert(
    summaryObservationSummary.effectiveness?.latestPendingUnstable == null,
    "summary-only runtime-summary 不应暴露 latestPendingUnstable"
  );
  assert(
    Array.isArray(summaryObservationSummary.effectiveness?.recentRecoveredPairs) &&
      summaryObservationSummary.effectiveness.recentRecoveredPairs.length === 0,
    "summary-only runtime-summary 不应暴露 recentRecoveredPairs"
  );
  const runtimeStabilityReadResponse = await fetchWithTokenEventually(
    `${mainAgentApiPath("/runtime/stability")}?didMethod=agentpassport&limit=5`,
    runtimeSummaryObserverSession.token,
    {
      label: "runtime_summary_observer runtime-stability",
      trace: traceSmoke,
      drainResponse,
      isReady: (response) => response.ok,
    }
  );
  assert(runtimeStabilityReadResponse.ok, "runtime_summary_observer 应允许读取 runtime-stability");
  const runtimeStabilityReadJson = await runtimeStabilityReadResponse.json();
  const summaryStabilityObservation = runtimeStabilityReadJson.stability?.observationSummary || null;
  assert(summaryStabilityObservation?.latestObservation, "runtime_summary_observer runtime-stability 应返回 latestObservation");
  assert(summaryStabilityObservation.latestObservation.sessionId == null, "summary-only runtime-stability 不应暴露 observation sessionId");
  assert(
    !Object.prototype.hasOwnProperty.call(summaryStabilityObservation.latestObservation, "correctionActions"),
    "summary-only runtime-stability 不应暴露 correctionActions"
  );
  assert(
    Array.isArray(summaryStabilityObservation.recent) && summaryStabilityObservation.recent.length === 0,
    "summary-only runtime-stability 不应暴露 recent observation 明细"
  );
  const auditorRuntimeSummaryResponse = await fetchWithToken(
    `${mainAgentApiPath("/runtime-summary")}?didMethod=agentpassport`,
    agentAuditorToken
  );
  assert(auditorRuntimeSummaryResponse.ok, "agent_auditor 应允许读取 runtime-summary");
  const auditorRuntimeSummaryJson = await auditorRuntimeSummaryResponse.json();
  const auditorObservationSummary = auditorRuntimeSummaryJson.summary?.memoryHomeostasis?.observationSummary || null;
  assert(auditorObservationSummary?.latestObservation, "agent_auditor runtime-summary 应返回 latestObservation");
  assert(auditorObservationSummary.latestObservation.sessionId == null, "metadata-only runtime-summary 不应暴露 observation sessionId");
  assert(
    auditorObservationSummary.latestObservation.sessionIdRedacted === true,
    "metadata-only runtime-summary 应标记 sessionId 已脱敏"
  );
  assert(
    !Object.prototype.hasOwnProperty.call(auditorObservationSummary.latestObservation, "correctionActions"),
    "metadata-only runtime-summary 不应暴露 correctionActions"
  );
  assert(
    !Object.prototype.hasOwnProperty.call(auditorObservationSummary.latestObservation, "instabilityReasons"),
    "metadata-only runtime-summary 不应暴露 instabilityReasons"
  );
  assert(
    Array.isArray(auditorObservationSummary.recent) && auditorObservationSummary.recent.length >= 1,
    "metadata-only runtime-summary 应保留 recent observation 元数据数组"
  );
  const auditorRecentObservation = auditorObservationSummary.recent[0] || null;
  assert(auditorRecentObservation, "metadata-only runtime-summary recent 应至少返回一条 observation 元数据");
  assert(auditorRecentObservation.sessionId == null, "metadata-only runtime-summary recent 不应暴露 sessionId");
  assert(
    !Object.prototype.hasOwnProperty.call(auditorRecentObservation, "correctionActions"),
    "metadata-only runtime-summary recent 不应暴露 correctionActions"
  );
  const auditorRuntimeStabilityResponse = await fetchWithToken(
    `${mainAgentApiPath("/runtime/stability")}?didMethod=agentpassport&limit=5`,
    agentAuditorToken
  );
  assert(auditorRuntimeStabilityResponse.ok, "agent_auditor 应允许读取 runtime-stability");
  const auditorRuntimeStabilityJson = await auditorRuntimeStabilityResponse.json();
  const auditorStabilityObservation = auditorRuntimeStabilityJson.stability?.observationSummary || null;
  assert(auditorStabilityObservation?.latestObservation, "agent_auditor runtime-stability 应返回 latestObservation");
  assert(auditorStabilityObservation.latestObservation.sessionId == null, "metadata-only runtime-stability 不应暴露 observation sessionId");
  assert(
    Array.isArray(auditorStabilityObservation.recent) && auditorStabilityObservation.recent.length >= 1,
    "metadata-only runtime-stability 应保留 recent observation 元数据数组"
  );
  const runnerHistory = await getJson(`${mainAgentApiPath("/runner")}?limit=5`);
  assert(Array.isArray(runnerHistory.runs), "runner history 缺少 runs 数组");
  assert(Array.isArray(runnerHistory.autoRecoveryAudits), "runner history 缺少 autoRecoveryAudits 数组");
  assert(
    runnerHistory.autoRecoveryAudits.some((entry) => entry?.closure?.phases?.some((phase) => phase.phaseId === "outcome")),
    "runner history 应返回已落盘的 auto recovery closure 审计"
  );
  const runnerHistoryAudit =
    runnerHistory.autoRecoveryAudits.find((entry) => entry?.failureSemantics?.status) ||
    runnerHistory.autoRecoveryAudits[0] ||
    null;
  assert(runnerHistoryAudit, "runner history 应至少返回一条 auto recovery audit");
  assertFailureSemanticsEnvelope(
    runnerHistoryAudit.failureSemantics,
    "runner history autoRecoveryAudit.failureSemantics"
  );
  assertFailureSemanticsEnvelope(
    runnerHistoryAudit.closure?.failureSemantics,
    "runner history autoRecoveryAudit.closure.failureSemantics"
  );
  const auditorRunnerHistoryResponse = await fetchWithToken(`${mainAgentApiPath("/runner")}?limit=5`, agentAuditorToken);
  assert(auditorRunnerHistoryResponse.ok, "agent_auditor 应允许读取 runner history");
  const auditorRunnerHistory = await auditorRunnerHistoryResponse.json();
  assert(Array.isArray(auditorRunnerHistory.runs), "agent_auditor runner history 应返回 runs 数组");
  assert(Array.isArray(auditorRunnerHistory.autoRecoveryAudits), "agent_auditor runner history 应返回 autoRecoveryAudits 数组");
  const auditorAutoRecoveryAudit =
    auditorRunnerHistory.autoRecoveryAudits.find((entry) => entry?.failureSemantics?.status) ||
    auditorRunnerHistory.autoRecoveryAudits[0] ||
    null;
  assert(auditorAutoRecoveryAudit, "agent_auditor runner history 应至少返回一条 auto recovery audit");
  assert(auditorAutoRecoveryAudit.summary == null, "agent_auditor auto recovery audit 不应暴露 summary");
  assert(auditorAutoRecoveryAudit.error == null, "agent_auditor auto recovery audit 不应暴露 error");
  assertFailureSemanticsEnvelope(
    auditorAutoRecoveryAudit.failureSemantics,
    "agent_auditor autoRecoveryAudit.failureSemantics"
  );
  assertFailureSemanticsEnvelope(
    auditorAutoRecoveryAudit.closure?.failureSemantics,
    "agent_auditor autoRecoveryAudit.closure.failureSemantics"
  );
  const driftCheckResponse = await authorizedFetch(`${mainAgentApiPath("/runtime/drift-check")}?didMethod=agentpassport`, {
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
  const spoofedDriftCheckResponse = await authorizedFetch(`${mainAgentApiPath("/runtime/drift-check")}?didMethod=agentpassport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentGoal: "验证 drift-check 不信任客户端 runtime snapshot",
      nextAction: "执行 grant_asset",
      turnCount: 18,
      estimatedContextChars: 24000,
      taskSnapshot:
        JSON.parse(JSON.stringify(runtime.runtime?.taskSnapshot || null)) || {
          snapshotId: "task_smoke_ui_spoofed_drift_snapshot",
          objective: "spoofed drift objective",
          status: "active",
        },
      runtimePolicy: {
        maxConversationTurns: 999999,
        maxContextChars: 999999,
        maxContextTokens: 999999,
        maxRecentConversationTurns: 999999,
        maxToolResults: 999999,
        maxQueryIterations: 999999,
        highRiskActionKeywords: [],
      },
    }),
  });
  assert(spoofedDriftCheckResponse.ok, "drift-check 伪造 runtime snapshot HTTP 请求失败");
  const spoofedDriftCheck = await spoofedDriftCheckResponse.json();
  assert(
    spoofedDriftCheck.driftCheck?.requiresRehydrate === true,
    "drift-check 不应信任客户端伪造的 runtimePolicy 放宽阈值"
  );
  assert(
    spoofedDriftCheck.driftCheck?.policy?.maxConversationTurns !== 999999,
    "drift-check 返回的 policy 不应直接采用客户端伪造阈值"
  );
  const driftBlockedRunnerResponse = await authorizedFetch(`${mainAgentApiPath("/runner")}?didMethod=agentpassport`, {
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
          externalColdMemoryRuntimeSearchHits: externalMempalaceRuntimeSearch?.retrieval?.externalColdMemoryHitCount || 0,
          externalColdMemoryContextHits:
            externalMempalaceContextBuilder?.contextBuilder?.externalColdMemory?.hits?.length || 0,
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
    const auditorCredentialStatusResponse = await fetchWithToken(
      `/api/credentials/${encodeURIComponent(credentialId)}/status`,
      agentAuditorToken
    );
    assert(auditorCredentialStatusResponse.ok, "agent_auditor 应允许读取 credential status");
    const auditorCredentialStatusJson = await auditorCredentialStatusResponse.json();
    assert(auditorCredentialStatusJson.proofValue == null, "agent_auditor 不应看到 proofValue");
    assert(auditorCredentialStatusJson.credentialHash == null, "agent_auditor 不应看到 credentialHash");
    assert(auditorCredentialStatusJson.statusListHash == null, "agent_auditor 不应看到 statusListHash");
    assert(
      auditorCredentialStatusJson.credentialRecord?.proofValue == null,
      "agent_auditor 不应看到 credentialRecord.proofValue"
    );
    assert(
      auditorCredentialStatusJson.credential?.proof?.proofValue == null,
      "agent_auditor 不应看到 credential.proof.proofValue"
    );
    assert(
      auditorCredentialStatusJson.statusProof?.statusListHash == null,
      "agent_auditor 不应看到 statusProof.statusListHash"
    );
    assert(
      auditorCredentialStatusJson.statusListSummary?.proofValue == null,
      "agent_auditor 不应看到 statusListSummary.proofValue"
    );

    const credentialMetadataObserverSessionResponse = await authorizedFetch("/api/security/read-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "smoke-ui-credential-metadata-observer",
        role: "credential_metadata_observer",
        credentialIds: [credentialId],
        ttlSeconds: 600,
        note: "credential status redaction probe",
      }),
    });
    assert(credentialMetadataObserverSessionResponse.ok, "创建 credential_metadata_observer read session 失败");
    const credentialMetadataObserverSession = await credentialMetadataObserverSessionResponse.json();
    const credentialMetadataStatusResponse = await fetchWithTokenEventually(
      `/api/credentials/${encodeURIComponent(credentialId)}/status`,
      credentialMetadataObserverSession.token,
      {
        label: "credential_metadata_observer credential status",
        trace: traceSmoke,
        drainResponse,
        isReady: (response) => response.ok,
      }
    );
    assert(credentialMetadataStatusResponse.ok, "credential_metadata_observer 应允许读取 credential status");
    const credentialMetadataStatusJson = await credentialMetadataStatusResponse.json();
    assert(credentialMetadataStatusJson.proofValue == null, "credential metadata observer 不应看到 proofValue");
    assert(
      credentialMetadataStatusJson.credentialHash == null,
      "credential metadata observer 不应看到 credentialHash"
    );
    assert(
      credentialMetadataStatusJson.credentialRecord?.proofValue == null,
      "credential metadata observer 不应看到 credentialRecord.proofValue"
    );
    assert(
      credentialMetadataStatusJson.credential?.proof?.proofValue == null,
      "credential metadata observer 不应看到 credential.proof.proofValue"
    );
    assert(
      credentialMetadataStatusJson.signatureValue == null,
      "credential metadata observer 不应看到 signatureValue"
    );
    assert(
      credentialMetadataStatusJson.expectedPublicKeyHex == null,
      "credential metadata observer 不应看到 expectedPublicKeyHex"
    );
    assert(
      credentialMetadataStatusJson.statusListHash == null,
      "credential metadata observer 不应看到 statusListHash"
    );
    assert(
      credentialMetadataStatusJson.statusProof?.statusListHash == null,
      "credential metadata observer 不应看到 statusProof.statusListHash"
    );
    assert(
      credentialMetadataStatusJson.statusListSummary?.proofValue == null,
      "credential metadata observer 不应看到 statusListSummary.proofValue"
    );
    assert(
      credentialMetadataStatusJson.statusProof?.proof?.proofValue == null,
      "credential metadata observer 不应看到 statusProof.proof.proofValue"
    );
    assert(
      credentialMetadataStatusJson.statusList?.credential?.proof?.proofValue == null,
      "credential metadata observer 不应看到 status list credential proofValue"
    );
    assert(
      Array.isArray(credentialMetadataStatusJson.statusList?.entries) &&
        credentialMetadataStatusJson.statusList.entries.every((entry) => entry?.proofValue == null),
      "credential metadata observer 不应看到 status list entry proofValue"
    );
  }

  transcript = await getJsonEventually(`${mainAgentApiPath("/transcript")}?family=runtime&limit=12`, {
    label: "runtime transcript after runtime evidence probes",
    trace: traceSmoke,
    isReady: (json) =>
      Array.isArray(json?.entries) &&
      Array.isArray(json?.transcript?.messageBlocks) &&
      Number(json?.transcript?.entryCount || json?.entries?.length || 0) >= 1 &&
      Number(json?.transcript?.messageBlocks?.length || 0) >= 1,
  });
  assert(Array.isArray(transcript.entries), "transcript 缺少 entries 数组");
  assert(transcript.transcript?.entryCount >= transcript.entries.length, "transcript.entryCount 不应小于 entries.length");
  assert(Array.isArray(transcript.transcript?.messageBlocks), "transcript 应返回 messageBlocks");

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
        recoveryBundleId: savedRecoveryBundleId || recoveryExport.summary?.bundleId || null,
        recoveryPreviewBundleId: recoveryExport.summary?.bundleId || null,
        recoveryBundleCount: recoveryListAfterSave.counts?.total || recoveryListAfterSave.bundles.length || 0,
        recoveryRehearsalStatus: recoveryVerify.rehearsal?.status || null,
        recoveryRehearsalCount: recoveryRehearsals.counts?.total || recoveryRehearsals.rehearsals.length || 0,
        ...summarizeRecoveryBundleExpectation({
          previewBundleId: recoveryExport.summary?.bundleId || null,
          persistedBundleId: savedRecoveryBundleId || null,
          persistedBundleCount: recoveryListAfterSave.counts?.total || recoveryListAfterSave.bundles.length || 0,
        }),
        ...summarizeRecoveryRehearsalExpectation({
          rehearsal: recoveryVerify.rehearsal,
          rehearsalCount: recoveryRehearsals.counts?.total || recoveryRehearsals.rehearsals.length || 0,
          persist: false,
        }),
        keychainMigrationDryRun: keychainMigration.migration?.dryRun || false,
        keychainMigrationSkipped: keychainMigration.migration?.skipped || false,
        keychainMigrationReason: keychainMigration.migration?.reason || null,
        ...summarizeKeychainMigrationExpectation(keychainMigration),
        deviceSetupComplete: setupStatus.setupComplete || false,
        deviceSetupRunComplete: setupRun.status?.setupComplete || false,
        ...summarizeDeviceSetupExpectation(
          setupStatus,
          setupRun,
          setupPackageExport.summary || setupPackagePreview.summary || null
        ),
        setupPackageId: setupPackageExport.summary?.packageId || setupPackagePreview.summary?.packageId || null,
        setupPackagePreviewId: setupPackageExport.summary?.packageId || setupPackagePreview.summary?.packageId || null,
        savedSetupPackageId,
        ...summarizeSetupPackageExpectation({
          previewPackageId: setupPackageExport.summary?.packageId || setupPackagePreview.summary?.packageId || null,
          persistedPackageId: savedSetupPackageId || null,
          observedPersistedPackageCount: setupPackageList.counts?.total || setupPackageList.packages.length || 0,
          embeddedProfileCount: savedSetupPackageDetail.summary?.localReasonerProfileCount || 0,
          prunedDeletedCount: setupPackagePrune.counts?.deleted || 0,
        }),
        housekeepingAuditMode: housekeepingAudit.mode || null,
        ...summarizeHousekeepingExpectation(housekeepingAudit),
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
        localReasonerRestoreReusedWarmState: localReasonerRestore.prewarmResult?.reusedWarmState === true,
        localReasonerRestoreWarmProofSource: localReasonerRestore.prewarmResult?.warmProofSource || null,
        ...summarizeLocalReasonerRestoreExpectation({
          candidateCount:
            localReasonerRestoreCandidates.counts?.total || localReasonerRestoreCandidates.restoreCandidates.length || 0,
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
          restoreCandidateCount:
            localReasonerRestoreCandidates.counts?.total || localReasonerRestoreCandidates.restoreCandidates.length || 0,
        }),
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
        ...summarizeBootstrapExpectation(bootstrap),
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
        externalColdMemoryRuntimeSearchHits: externalMempalaceRuntimeSearch?.retrieval?.externalColdMemoryHitCount || 0,
        defaultRuntimeSearchWithExternalEnabledHits:
          defaultRuntimeSearchWithExternalEnabled?.hits?.length || 0,
        runtimeSearchStrategy: runtimeSearch.retrieval?.strategy || null,
        sandboxAuditCount: sandboxAuditList.counts?.total || sandboxAuditList.audits.length || 0,
        sandboxSearchHits: sandboxSearch.sandbox?.sandboxExecution?.output?.hits?.length || 0,
        sandboxListEntries: sandboxList.sandbox?.sandboxExecution?.output?.entries?.length || 0,
        ...summarizeSandboxAuditExpectation({
          auditCount: sandboxAuditList.counts?.total || sandboxAuditList.audits.length || 0,
          sandboxSearchHits: sandboxSearch.sandbox?.sandboxExecution?.output?.hits?.length || 0,
          sandboxListEntries: sandboxList.sandbox?.sandboxExecution?.output?.entries?.length || 0,
        }),
        contextBuilderLocalKnowledgeHits:
          contextBuilder.contextBuilder?.localKnowledge?.hits?.length ||
          contextBuilder.contextBuilder?.slots?.localKnowledgeHits?.length ||
          0,
        externalColdMemoryContextHits:
          externalMempalaceContextBuilder?.contextBuilder?.externalColdMemory?.hits?.length || 0,
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
        ...summarizeExecutionHistoryExpectation({
          verificationStatus: verificationRun.verificationRun?.status || null,
          verificationHistoryCount:
            verificationHistory.counts?.filtered || verificationHistory.verificationRuns.length || 0,
          runnerStatus: runner.runner?.run?.status || null,
          runnerHistoryCount: runnerHistory.counts?.filtered || runnerHistory.runs.length || 0,
        }),
        driftRequiresRehydrate: driftCheck.driftCheck?.requiresRehydrate || false,
        selectedStatusListId,
        compareStatusListId,
        repairCount: repairs.counts?.total || repairs.repairs.length || 0,
        windowCount: windows.windows.length,
        adminTokenRotationMode,
        adminTokenRotationOldTokenRejected,
        adminTokenRotationReadSessionPreRevokeAllowed,
        adminTokenRotationReadSessionRevoked,
        adminTokenRotationAnomalyRecorded,
        forgedWindowRebindBlocked,
        forgedWindowRebindError,
        windowBindingStableAfterRebind,
        autoRecoveryResumed,
        autoRecoveryResumeStatus,
        autoRecoveryResumeChainLength,
        retryWithoutExecutionResumeStatus,
        retryWithoutExecutionResumeChainLength,
      },
      null,
      2
    )
  );
}

async function flushIoStreams() {
  await Promise.all([
    new Promise((resolve) => process.stdout.write("", resolve)),
    new Promise((resolve) => process.stderr.write("", resolve)),
  ]);
}

main()
  .then(async () => {
    await flushIoStreams();
    process.exit(0);
  })
  .catch(async (error) => {
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
    await flushIoStreams();
    process.exit(1);
  });

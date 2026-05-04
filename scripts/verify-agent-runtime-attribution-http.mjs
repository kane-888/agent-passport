import {
  createAttributionHttpProbe,
  getJson,
  postJson,
} from "./attribution-http-probe-shared.mjs";
import { AGENT_PASSPORT_MAIN_AGENT_ID as CANONICAL_MAIN_AGENT_ID } from "../src/main-agent-compat.js";
import { assert } from "./smoke-shared.mjs";

function findMinuteById(minutesPayload = null, minuteId = null) {
  return Array.isArray(minutesPayload?.minutes)
    ? minutesPayload.minutes.find((entry) => entry?.minuteId === minuteId) || null
    : null;
}

const probe = await createAttributionHttpProbe("agent-runtime-attribution-http");
let server = null;

try {
  server = await probe.startServer();
  const adminFetch = probe.adminFetch;

  await postJson(
    adminFetch,
    "/api/device/runtime",
    {
      residentAgentId: CANONICAL_MAIN_AGENT_ID,
      localMode: "local_only",
      allowOnlineReasoner: false,
      negotiationMode: "confirm_before_execute",
      lowRiskStrategy: "auto_execute",
      mediumRiskStrategy: "discuss",
      highRiskStrategy: "confirm",
      criticalRiskStrategy: "multisig",
      retrievalStrategy: "local_first_non_vector",
      allowVectorIndex: false,
      allowedCapabilities: ["conversation_minute_write", "runtime_search"],
      dryRun: false,
    },
    200
  );

  const bootstrap = await postJson(
    adminFetch,
    `/api/agents/${CANONICAL_MAIN_AGENT_ID}/runtime/bootstrap?didMethod=agentpassport`,
    {
      currentGoal: "prepare runtime attribution verification",
      currentPlan: ["bootstrap runtime", "verify nested sandbox attribution"],
      nextAction: "execute runtime attribution probe",
    },
    200
  );
  assert(
    bootstrap.bootstrap?.agentId,
    "bootstrap 应返回当前 physical owner agent"
  );
  const resolvedMainAgentId = bootstrap.bootstrap.agentId;

  const runtimeActionToken = `runtime-action-minute-${Date.now()}`;
  const runtimeActionEnvelope = await postJson(
    adminFetch,
    `/api/agents/${CANONICAL_MAIN_AGENT_ID}/runtime/actions?didMethod=agentpassport`,
    {
      interactionMode: "command",
      executionMode: "execute",
      currentGoal: "verify runtime/actions nested attribution stripping",
      requestedAction: "记录一条运行态纪要",
      requestedCapability: "conversation_minute_write",
      requestedActionType: "record_minute",
      sandboxAction: {
        capability: "conversation_minute_write",
        actionType: "record_minute",
        title: runtimeActionToken,
        summary: "runtime/actions nested attribution probe",
        transcript: `probe ${runtimeActionToken}`,
        sourceWindowId: "window_forged_runtime_action",
        recordedByAgentId: "agent_treasury",
        recordedByWindowId: "window_forged_runtime_action",
      },
    },
    200
  );
  const runtimeActionMinute = runtimeActionEnvelope?.sandbox?.sandboxExecution?.output?.minute ?? null;
  assert(runtimeActionMinute?.minuteId, "runtime/actions 应真正写入 conversation minute");
  assert(
    runtimeActionMinute.recordedByAgentId === resolvedMainAgentId,
    "runtime/actions minute.recordedByAgentId 应落到当前 physical owner"
  );
  assert(
    runtimeActionMinute.recordedByWindowId == null,
    "runtime/actions minute.recordedByWindowId 不应保留 sandboxAction 伪造值"
  );
  assert(
    runtimeActionMinute.sourceWindowId == null,
    "runtime/actions minute.sourceWindowId 不应保留 sandboxAction 伪造值"
  );
  assert(
    runtimeActionEnvelope?.sandbox?.sandboxAudit?.recordedByAgentId === resolvedMainAgentId,
    "runtime/actions sandboxAudit.recordedByAgentId 应落到当前 physical owner"
  );
  assert(
    runtimeActionEnvelope?.sandbox?.sandboxAudit?.recordedByWindowId == null,
    "runtime/actions sandboxAudit.recordedByWindowId 不应保留 sandboxAction 伪造值"
  );
  assert(
    runtimeActionEnvelope?.sandbox?.sandboxAudit?.sourceWindowId == null,
    "runtime/actions sandboxAudit.sourceWindowId 不应保留 sandboxAction 伪造值"
  );

  const sandboxAuditList = await getJson(
    adminFetch,
    `/api/agents/${CANONICAL_MAIN_AGENT_ID}/runtime/actions?didMethod=agentpassport&limit=10`
  );
  const latestRuntimeActionAudit = Array.isArray(sandboxAuditList.audits)
    ? sandboxAuditList.audits.find(
        (entry) => entry?.auditId === runtimeActionEnvelope?.sandbox?.sandboxAudit?.auditId
      ) || null
    : null;
  assert(latestRuntimeActionAudit, "runtime/actions 审计列表应包含新审计");
  assert(
    latestRuntimeActionAudit.recordedByAgentId === resolvedMainAgentId,
    "runtime/actions 审计列表 recordedByAgentId 应落到当前 physical owner"
  );
  assert(
    latestRuntimeActionAudit.recordedByWindowId == null,
    "runtime/actions 审计列表 recordedByWindowId 不应保留 sandboxAction 伪造值"
  );
  assert(
    latestRuntimeActionAudit.sourceWindowId == null,
    "runtime/actions 审计列表 sourceWindowId 不应保留 sandboxAction 伪造值"
  );

  const minutesAfterRuntimeAction = await getJson(
    adminFetch,
    `/api/agents/${CANONICAL_MAIN_AGENT_ID}/runtime/minutes?limit=20`
  );
  const persistedRuntimeActionMinute = findMinuteById(minutesAfterRuntimeAction, runtimeActionMinute.minuteId);
  assert(persistedRuntimeActionMinute, "runtime/actions 写入的 minute 应持久化");
  assert(
    persistedRuntimeActionMinute.recordedByAgentId === resolvedMainAgentId,
    "runtime/actions 持久化 minute.recordedByAgentId 应落到当前 physical owner"
  );
  assert(
    persistedRuntimeActionMinute.recordedByWindowId == null,
    "runtime/actions 持久化 minute.recordedByWindowId 不应保留 sandboxAction 伪造值"
  );
  assert(
    persistedRuntimeActionMinute.sourceWindowId == null,
    "runtime/actions 持久化 minute.sourceWindowId 不应保留 sandboxAction 伪造值"
  );

  const runnerToken = `runner-minute-${Date.now()}`;
  const runnerEnvelope = await postJson(
    adminFetch,
    `/api/agents/${CANONICAL_MAIN_AGENT_ID}/runner?didMethod=agentpassport`,
    {
      interactionMode: "command",
      executionMode: "execute",
      currentGoal: "verify runner nested sandbox attribution stripping",
      requestedAction: "通过 runner 记录一条纪要",
      requestedCapability: "conversation_minute_write",
      requestedActionType: "record_minute",
      persistRun: true,
      autoCompact: false,
      writeConversationTurns: false,
      storeToolResults: false,
      autoRecover: false,
      assistantResponse: "runner attribution probe",
      sandboxAction: {
        capability: "conversation_minute_write",
        actionType: "record_minute",
        title: runnerToken,
        summary: "runner nested attribution probe",
        transcript: `probe ${runnerToken}`,
        sourceWindowId: "window_forged_runner_action",
        recordedByAgentId: "agent_treasury",
        recordedByWindowId: "window_forged_runner_action",
      },
    },
    200
  );
  const runnerMinute = runnerEnvelope?.runner?.sandboxExecution?.output?.minute ?? null;
  assert(runnerMinute?.minuteId, "runner 应真正执行 nested sandboxAction 并写入 minute");
  assert(
    runnerMinute.recordedByAgentId === resolvedMainAgentId,
    "runner minute.recordedByAgentId 应落到当前 physical owner"
  );
  assert(
    runnerMinute.recordedByWindowId == null,
    "runner minute.recordedByWindowId 不应保留 sandboxAction 伪造值"
  );
  assert(
    runnerMinute.sourceWindowId == null,
    "runner minute.sourceWindowId 不应保留 sandboxAction 伪造值"
  );
  assert(
    runnerEnvelope?.runner?.run?.recordedByAgentId === resolvedMainAgentId,
    "runner.run.recordedByAgentId 应保持为当前 physical owner"
  );
  assert(
    runnerEnvelope?.runner?.run?.recordedByWindowId == null,
    "runner.run.recordedByWindowId 不应保留缺省伪造值"
  );

  const minutesAfterRunner = await getJson(
    adminFetch,
    `/api/agents/${CANONICAL_MAIN_AGENT_ID}/runtime/minutes?limit=30`
  );
  const persistedRunnerMinute = findMinuteById(minutesAfterRunner, runnerMinute.minuteId);
  assert(persistedRunnerMinute, "runner 写入的 minute 应持久化");
  assert(
    persistedRunnerMinute.recordedByAgentId === resolvedMainAgentId,
    "runner 持久化 minute.recordedByAgentId 应落到当前 physical owner"
  );
  assert(
    persistedRunnerMinute.recordedByWindowId == null,
    "runner 持久化 minute.recordedByWindowId 不应保留 sandboxAction 伪造值"
  );
  assert(
    persistedRunnerMinute.sourceWindowId == null,
    "runner 持久化 minute.sourceWindowId 不应保留 sandboxAction 伪造值"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        verified: [
          "POST /api/agents/agent_main/runtime/actions keeps canonical route input while nested sandbox attribution still lands on the resolved physical owner",
          "runtime sandbox audit stays clean when sandboxAction forges actor/source",
          "POST /api/agents/agent_main/runner keeps canonical route input while persisted runtime attribution still lands on the resolved physical owner",
        ],
        resolvedMainAgentId,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  probe.logServerOutput();
  process.exitCode = 1;
} finally {
  await probe.cleanup(server);
}

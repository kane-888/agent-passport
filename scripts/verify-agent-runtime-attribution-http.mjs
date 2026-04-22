import {
  createAttributionHttpProbe,
  getJson,
  postJson,
} from "./attribution-http-probe-shared.mjs";
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
      allowedCapabilities: ["conversation_minute_write", "runtime_search"],
      dryRun: false,
    },
    200
  );

  const bootstrap = await postJson(
    adminFetch,
    "/api/agents/agent_openneed_agents/runtime/bootstrap?didMethod=agentpassport",
    {
      currentGoal: "prepare runtime attribution verification",
      currentPlan: ["bootstrap runtime", "verify nested sandbox attribution"],
      nextAction: "execute runtime attribution probe",
    },
    200
  );
  assert(
    bootstrap.bootstrap?.agentId === "agent_openneed_agents",
    "bootstrap 应完成并返回目标 agent"
  );

  const runtimeActionToken = `runtime-action-minute-${Date.now()}`;
  const runtimeActionEnvelope = await postJson(
    adminFetch,
    "/api/agents/agent_openneed_agents/runtime/actions?didMethod=agentpassport",
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
    runtimeActionMinute.recordedByAgentId === "agent_openneed_agents",
    "runtime/actions minute.recordedByAgentId 应回退为路径 agent"
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
    runtimeActionEnvelope?.sandbox?.sandboxAudit?.recordedByAgentId === "agent_openneed_agents",
    "runtime/actions sandboxAudit.recordedByAgentId 应回退为路径 agent"
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
    "/api/agents/agent_openneed_agents/runtime/actions?didMethod=agentpassport&limit=10"
  );
  const latestRuntimeActionAudit = Array.isArray(sandboxAuditList.audits)
    ? sandboxAuditList.audits.find(
        (entry) => entry?.auditId === runtimeActionEnvelope?.sandbox?.sandboxAudit?.auditId
      ) || null
    : null;
  assert(latestRuntimeActionAudit, "runtime/actions 审计列表应包含新审计");
  assert(
    latestRuntimeActionAudit.recordedByAgentId === "agent_openneed_agents",
    "runtime/actions 审计列表 recordedByAgentId 应回退为路径 agent"
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
    "/api/agents/agent_openneed_agents/runtime/minutes?limit=20"
  );
  const persistedRuntimeActionMinute = findMinuteById(minutesAfterRuntimeAction, runtimeActionMinute.minuteId);
  assert(persistedRuntimeActionMinute, "runtime/actions 写入的 minute 应持久化");
  assert(
    persistedRuntimeActionMinute.recordedByAgentId === "agent_openneed_agents",
    "runtime/actions 持久化 minute.recordedByAgentId 应回退为路径 agent"
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
    "/api/agents/agent_openneed_agents/runner?didMethod=agentpassport",
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
    runnerMinute.recordedByAgentId === "agent_openneed_agents",
    "runner minute.recordedByAgentId 应回退为路径 agent"
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
    runnerEnvelope?.runner?.run?.recordedByAgentId === "agent_openneed_agents",
    "runner.run.recordedByAgentId 应保持为路径 agent"
  );
  assert(
    runnerEnvelope?.runner?.run?.recordedByWindowId == null,
    "runner.run.recordedByWindowId 不应保留缺省伪造值"
  );

  const minutesAfterRunner = await getJson(
    adminFetch,
    "/api/agents/agent_openneed_agents/runtime/minutes?limit=30"
  );
  const persistedRunnerMinute = findMinuteById(minutesAfterRunner, runnerMinute.minuteId);
  assert(persistedRunnerMinute, "runner 写入的 minute 应持久化");
  assert(
    persistedRunnerMinute.recordedByAgentId === "agent_openneed_agents",
    "runner 持久化 minute.recordedByAgentId 应回退为路径 agent"
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
          "POST /api/agents/:id/runtime/actions ignores nested sandboxAction actor attribution",
          "runtime sandbox audit stays clean when sandboxAction forges actor/source",
          "POST /api/agents/:id/runner ignores nested sandboxAction actor attribution",
        ],
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

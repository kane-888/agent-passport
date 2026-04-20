import {
  executeAgentRunner,
  getDeviceRuntimeState,
  listAgents,
  previewRuntimeMemoryHomeostasisCalibration,
  recomputeAgentRuntimeStability,
} from "../src/ledger.js";

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
}

function buildPressureTurns(turnCount = 6) {
  const turns = [];
  for (let index = 0; index < turnCount; index += 1) {
    turns.push({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `第 ${index + 1} 轮上下文压力填充。当前任务仍然是验证 agent-passport 记忆稳态引擎在长上下文下的任务目标、下一步和关键锚点是否保持稳定。`,
    });
  }
  return turns;
}

async function runRecomputeMode(agentId) {
  return recomputeAgentRuntimeStability(agentId, {
    currentGoal: "验证上下文记忆坍缩量化与纠偏机制",
    userTurn: "请保持当前目标，并优先稳住关键记忆锚点。",
    recentConversationTurns: buildPressureTurns(Number(readArg("turns", 8))),
    applyCorrection: true,
    persistState: process.argv.includes("--persist"),
  });
}

async function runRunnerProbeMode(agentId) {
  const result = await executeAgentRunner(agentId, {
    currentGoal: "验证 active probe 与自动纠偏闭环",
    userTurn: "请在回答前确认关键记忆是否还稳定，并优先稳住关键锚点。",
    recentConversationTurns: buildPressureTurns(Number(readArg("turns", 18))),
    persistRun: process.argv.includes("--persist"),
    autoCompact: false,
    writeConversationTurns: false,
    storeToolResults: false,
  });
  const deviceRuntimeState = await getDeviceRuntimeState();
  return {
    run: result?.run?.memoryHomeostasis ?? null,
    observationSummary: deviceRuntimeState?.memoryHomeostasis?.observationSummary ?? null,
  };
}

async function runEscalationPreviewMode(agentId) {
  return previewRuntimeMemoryHomeostasisCalibration({
    modelName: "OpenNeed",
    includeStoredObservations: false,
    observations: [
      {
        agentId,
        sessionId: "preview_escalation",
        sourceKind: "runner",
        observationKind: "runner_passive_monitor",
        ctxTokens: 2200,
        memoryAnchors: [
          {
            memoryId: "goal:preview",
            importanceWeight: 1.5,
            insertedPosition: "tail",
            lastVerifiedOk: true,
          },
        ],
        checkedMemories: 1,
        conflictMemories: 0,
        vT: 1,
        lT: 0.75,
        rPosT: 0,
        xT: 0,
        sT: 0.8125,
        cT: 0.1875,
        correctionLevel: "none",
        correctionRequested: false,
        correctionApplied: false,
        observedAt: "2026-04-15T00:00:00.000Z",
      },
      {
        agentId,
        sessionId: "preview_escalation",
        sourceKind: "runner",
        observationKind: "active_probe",
        ctxTokens: 3100,
        memoryAnchors: [
          {
            memoryId: "goal:preview",
            importanceWeight: 1.5,
            insertedPosition: "tail",
            lastVerifiedOk: false,
          },
        ],
        checkedMemories: 1,
        conflictMemories: 0,
        vT: 0,
        lT: 1,
        rPosT: 0,
        xT: 0,
        sT: 0.35,
        cT: 0.65,
        correctionLevel: "medium",
        correctionRequested: true,
        correctionApplied: false,
        probeCheckedCount: 1,
        probeFailureCount: 1,
        instabilityReasons: ["probe_recall_failure", "retention_drop", "correction_escalated"],
        observedAt: "2026-04-15T00:00:01.000Z",
      },
      {
        agentId,
        sessionId: "preview_escalation",
        sourceKind: "runner",
        observationKind: "correction_rebuild",
        ctxTokens: 2500,
        memoryAnchors: [
          {
            memoryId: "goal:preview",
            importanceWeight: 1.5,
            insertedPosition: "tail",
            lastVerifiedOk: true,
          },
        ],
        checkedMemories: 1,
        conflictMemories: 0,
        vT: 1,
        lT: 0.85,
        rPosT: 0,
        xT: 0,
        sT: 0.7875,
        cT: 0.2125,
        correctionLevel: "none",
        correctionRequested: true,
        correctionApplied: true,
        recoverySignal: "risk_reduced",
        instabilityReasons: ["correction_escalated"],
        observedAt: "2026-04-15T00:00:02.000Z",
      },
    ],
  });
}

const requestedAgentId = readArg("agent", null);
const mode = readArg("mode", "recompute");
const availableAgents = await listAgents();
const agent = requestedAgentId
  ? availableAgents.find((entry) => entry.agentId === requestedAgentId) ?? null
  : availableAgents[0] ?? null;

if (!agent) {
  throw new Error("没有可用 agent。请先创建 agent，或用 --agent 指定已有 agentId。");
}

const result =
  mode === "runner_probe"
    ? await runRunnerProbeMode(agent.agentId)
    : mode === "escalation_preview"
      ? await runEscalationPreviewMode(agent.agentId)
    : await runRecomputeMode(agent.agentId);

process.stdout.write(`${JSON.stringify({ agentId: agent.agentId, mode, stability: result }, null, 2)}\n`);

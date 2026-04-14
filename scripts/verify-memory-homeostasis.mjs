import { listAgents, recomputeAgentRuntimeStability } from "../src/ledger.js";

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
      content: `第 ${index + 1} 轮上下文压力填充。当前任务仍然是验证 OpenNeed 记忆稳态引擎在长上下文下的任务目标、下一步和关键锚点是否保持稳定。`,
    });
  }
  return turns;
}

const requestedAgentId = readArg("agent", null);
const availableAgents = await listAgents();
const agent = requestedAgentId
  ? availableAgents.find((entry) => entry.agentId === requestedAgentId) ?? null
  : availableAgents[0] ?? null;

if (!agent) {
  throw new Error("没有可用 agent。请先创建 agent，或用 --agent 指定已有 agentId。");
}

const result = await recomputeAgentRuntimeStability(agent.agentId, {
  currentGoal: "验证上下文记忆坍缩量化与纠偏机制",
  userTurn: "请保持当前目标，并优先稳住关键记忆锚点。",
  recentConversationTurns: buildPressureTurns(Number(readArg("turns", 8))),
  applyCorrection: true,
  persistState: process.argv.includes("--persist"),
});

process.stdout.write(`${JSON.stringify({ agentId: agent.agentId, stability: result }, null, 2)}\n`);

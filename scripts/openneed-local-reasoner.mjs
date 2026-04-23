import {
  AGENT_PASSPORT_LOCAL_REASONER_LABEL,
  OPENNEED_REASONER_BRAND,
  resolveOpenNeedReasonerModel,
} from "../src/openneed-memory-engine.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clip(value, max = 320) {
  const normalized = text(value);
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function safeJsonParse(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function readStdin() {
  if (process.stdin.isTTY) {
    return "";
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function buildFallbackResponse(input = {}) {
  const contextBuilder = input?.contextBuilder || {};
  const payload = input?.payload || {};
  const identity = contextBuilder?.slots?.identitySnapshot || {};
  const currentGoal = text(payload?.currentGoal);
  const userTurn = text(payload?.userTurn);

  return {
    responseText: [
      identity?.agentId ? `agent_id: ${identity.agentId}` : "agent_id: unknown",
      identity?.profile?.name ? `名字: ${identity.profile.name}` : null,
      identity?.profile?.role ? `角色: ${identity.profile.role}` : null,
      currentGoal ? `当前目标: ${currentGoal}` : null,
      userTurn ? `用户输入: ${userTurn}` : null,
      `参考层优先结论: ${clip(contextBuilder?.compiledPrompt || "使用本地参考层上下文继续执行。", 220)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    model: AGENT_PASSPORT_LOCAL_REASONER_LABEL,
    provider: "fallback_local_reasoner",
    strategy: "memory_engine_identity_first",
  };
}

async function callOllama(prompt) {
  const baseUrl = trimTrailingSlash(
    process.env.OPENNEED_LOCAL_GEMMA_BASE_URL ||
      process.env.AGENT_PASSPORT_OLLAMA_BASE_URL ||
      "http://127.0.0.1:11434"
  );
  const requestedModel =
    process.env.OPENNEED_LOCAL_GEMMA_MODEL ||
    process.env.AGENT_PASSPORT_OLLAMA_MODEL ||
    OPENNEED_REASONER_BRAND;
  const model = resolveOpenNeedReasonerModel(requestedModel);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are the agent-passport memory engine local reasoner. Ground every reply in the supplied identity and memory context. Keep the output concise.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`ollama returned HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    responseText: text(data?.message?.content) || text(data?.response),
    model: AGENT_PASSPORT_LOCAL_REASONER_LABEL,
    provider: "ollama_local",
    strategy: "memory_engine_identity_first",
  };
}

async function main() {
  const raw = await readStdin();
  const input = raw
    ? safeJsonParse(raw, {})
    : {
        contextBuilder: {
          compiledPrompt: "identitySnapshot: agent_openneed_demo / role=memory-runtime-assistant",
          slots: {
            identitySnapshot: {
              agentId: "agent_openneed_demo",
              profile: {
                name: "agent-passport Memory Engine Assistant",
                role: "memory-runtime-assistant",
              },
            },
          },
        },
        payload: {
          currentGoal: "验证 agent-passport 记忆稳态本地 reasoner 接口",
          userTurn: "请继续以本地身份助手方式工作",
        },
      };
  const contextBuilder = input?.contextBuilder || {};
  const payload = input?.payload || {};
  const prompt = [
    "Use the supplied agent-passport memory-engine context as the grounding reference for identity and local state.",
    `Compiled Prompt:\n${clip(contextBuilder?.compiledPrompt || "", 4000)}`,
    `Current Goal:\n${text(payload?.currentGoal) || "继续当前任务"}`,
    `User Turn:\n${text(payload?.userTurn) || ""}`,
  ].join("\n\n");

  let result;
  try {
    result = await callOllama(prompt);
    if (!text(result.responseText)) {
      result = buildFallbackResponse(input);
    }
  } catch (error) {
    result = {
      ...buildFallbackResponse(input),
      error: error.message,
    };
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const fallback = {
    responseText: "记忆稳态引擎本地 reasoner 失败，已回退到最小身份摘要。",
    model: AGENT_PASSPORT_LOCAL_REASONER_LABEL,
    provider: "fallback_local_reasoner",
    error: error.message,
  };
  process.stdout.write(`${JSON.stringify(fallback)}\n`);
  process.exitCode = 0;
});

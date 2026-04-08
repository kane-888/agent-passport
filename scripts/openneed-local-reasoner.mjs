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
      `Passport 优先结论: ${clip(contextBuilder?.compiledPrompt || "使用 Passport 上下文继续执行。", 220)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    model: process.env.OPENNEED_LOCAL_GEMMA_MODEL || process.env.AGENT_PASSPORT_OLLAMA_MODEL || "gemma4:e4b",
    provider: "fallback_local_reasoner",
    strategy: "passport_identity_first",
  };
}

async function callOllama(prompt) {
  const baseUrl = trimTrailingSlash(
    process.env.OPENNEED_LOCAL_GEMMA_BASE_URL ||
      process.env.AGENT_PASSPORT_OLLAMA_BASE_URL ||
      "http://127.0.0.1:11434"
  );
  const model =
    process.env.OPENNEED_LOCAL_GEMMA_MODEL ||
    process.env.AGENT_PASSPORT_OLLAMA_MODEL ||
    "gemma4:e4b";

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
            "You are the Agent Passport local reasoner for OpenNeed. Ground every reply in the supplied identity and memory context. Keep the output concise.",
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
    model,
    provider: "ollama_local",
    strategy: "passport_identity_first",
  };
}

async function main() {
  const raw = await readStdin();
  const input = raw
    ? safeJsonParse(raw, {})
    : {
        contextBuilder: {
          compiledPrompt: "identitySnapshot: agent_openneed_demo / role=recruiting-memory-assistant",
          slots: {
            identitySnapshot: {
              agentId: "agent_openneed_demo",
              profile: {
                name: "OpenNeed Passport Assistant",
                role: "recruiting-memory-assistant",
              },
            },
          },
        },
        payload: {
          currentGoal: "验证 Passport 本地 Gemma reasoner 接口",
          userTurn: "请继续以本地身份助手方式工作",
        },
      };
  const contextBuilder = input?.contextBuilder || {};
  const payload = input?.payload || {};
  const prompt = [
    "Use the supplied Agent Passport context as the grounding reference for identity and local state.",
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
    responseText: "Passport 本地 reasoner 失败，已回退到最小身份摘要。",
    model: "gemma4:e4b",
    provider: "fallback_local_reasoner",
    error: error.message,
  };
  process.stdout.write(`${JSON.stringify(fallback)}\n`);
  process.exitCode = 0;
});

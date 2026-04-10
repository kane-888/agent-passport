import fs from "node:fs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizeOptionalText(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function main() {
  return readStdin().then((raw) => {
    const payload = raw ? JSON.parse(raw) : {};
    const contextBuilder = payload.contextBuilder && typeof payload.contextBuilder === "object" ? payload.contextBuilder : {};
    const runnerPayload = payload.payload && typeof payload.payload === "object" ? payload.payload : {};
    const identity = contextBuilder?.slots?.identitySnapshot || {};
    const profile = identity.profile || {};
    const did = normalizeOptionalText(identity.did) ?? null;
    const currentGoal =
      normalizeOptionalText(runnerPayload.currentGoal) ??
      normalizeOptionalText(contextBuilder?.slots?.currentGoal) ??
      null;
    const userTurn =
      normalizeOptionalText(runnerPayload.userTurn) ??
      normalizeOptionalText(runnerPayload.input) ??
      normalizeOptionalText(runnerPayload.message) ??
      null;
    const responseText = [
      `agent_id: ${identity.agentId || "unknown"}`,
      profile.name ? `名字: ${profile.name}` : null,
      profile.role ? `角色: ${profile.role}` : null,
      did ? `DID: ${did}` : null,
      currentGoal ? `当前目标: ${currentGoal}` : null,
      userTurn ? `用户输入: ${userTurn}` : null,
      "结果: 我会优先使用本地参考层、transcript model 与本地纪要恢复上下文，不靠长聊天猜身份。",
    ]
      .filter(Boolean)
      .join("\n");

    process.stdout.write(
      `${JSON.stringify(
        {
          model: "openneed-memory-local-reasoner-fixture",
          responseText,
          metadata: {
            offline: true,
            fixture: true,
            transcriptEntryCount: Number(contextBuilder?.slots?.transcriptModel?.entryCount || 0),
            localKnowledgeHitCount: Number(contextBuilder?.localKnowledge?.hits?.length || 0),
          },
        },
        null,
        2
      )}\n`
    );
  });
}

main().catch((error) => {
  fs.writeSync(process.stderr.fd, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

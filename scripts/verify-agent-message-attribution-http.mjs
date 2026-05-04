import {
  createAttributionHttpProbe,
  getJson,
  postJson,
} from "./attribution-http-probe-shared.mjs";
import { AGENT_PASSPORT_MAIN_AGENT_ID as CANONICAL_MAIN_AGENT_ID } from "../src/main-agent-compat.js";
import { assert } from "./smoke-shared.mjs";

function listTranscriptEntries(transcriptPayload = null) {
  if (Array.isArray(transcriptPayload?.entries)) {
    return transcriptPayload.entries;
  }
  if (Array.isArray(transcriptPayload?.transcript?.entries)) {
    return transcriptPayload.transcript.entries;
  }
  return [];
}

const probe = await createAttributionHttpProbe("agent-message-attribution-http");
let server = null;

try {
  server = await probe.startServer();
  const adminFetch = probe.adminFetch;
  const bootstrap = await postJson(
    adminFetch,
    `/api/agents/${CANONICAL_MAIN_AGENT_ID}/runtime/bootstrap?didMethod=agentpassport`,
    {
      currentGoal: "prepare message attribution verification",
      currentPlan: ["resolve main agent owner", "deliver inbox message", "verify transcript hygiene"],
      nextAction: "execute message attribution probe",
    },
    200
  );
  assert(bootstrap.bootstrap?.agentId, "message attribution bootstrap 应返回当前 physical owner agent");
  const resolvedMainAgentId = bootstrap.bootstrap.agentId;
  const windowsPayload = await getJson(adminFetch, "/api/windows");
  const forgedWindow = Array.isArray(windowsPayload.windows)
    ? windowsPayload.windows.find(
        (entry) => entry?.agentId && entry.agentId !== resolvedMainAgentId && entry?.windowId
      ) || null
    : null;
  const forgedFromAgentId = forgedWindow?.agentId || "agent_treasury";
  const forgedFromWindowId = forgedWindow?.windowId || "window_forged_message_sender";
  const probeToken = `message-probe-${Date.now()}`;

  const delivered = await postJson(
    adminFetch,
    `/api/agents/${CANONICAL_MAIN_AGENT_ID}/messages`,
    {
      kind: "message",
      subject: "message attribution probe",
      content: `shared inbox should ignore forged sender ${probeToken}`,
      tags: ["probe", "message-attribution"],
      metadata: {
        probeToken,
      },
      fromAgentId: forgedFromAgentId,
      fromWindowId: forgedFromWindowId,
    },
    201
  );

  assert(delivered.message?.messageId, "message route response 缺少 messageId");
  assert(
    delivered.message.toAgentId === resolvedMainAgentId,
    "message route 应通过 canonical route id 命中当前 physical owner target"
  );
  assert(delivered.message.fromAgentId == null, "message route 不应保留 body 伪造 fromAgentId");
  assert(delivered.message.fromWindowId == null, "message route 不应保留 body 伪造 fromWindowId");

  const targetMessages = await getJson(
    adminFetch,
    `/api/agents/${CANONICAL_MAIN_AGENT_ID}/messages?limit=20`
  );
  const inboxMessage = Array.isArray(targetMessages.inbox)
    ? targetMessages.inbox.find((entry) => entry?.messageId === delivered.message.messageId)
    : null;
  assert(inboxMessage, "目标 agent inbox 应包含新消息");
  assert(
    inboxMessage.toAgentId === resolvedMainAgentId,
    "inbox 视图中的 toAgentId 应保持为当前 physical owner target"
  );
  assert(inboxMessage.fromAgentId == null, "inbox 视图不应保留 body 伪造 fromAgentId");
  assert(inboxMessage.fromWindowId == null, "inbox 视图不应保留 body 伪造 fromWindowId");

  const forgedSenderMessages = await getJson(
    adminFetch,
    `/api/agents/${encodeURIComponent(forgedFromAgentId)}/messages?limit=20`
  );
  const forgedOutboxHit = Array.isArray(forgedSenderMessages.outbox)
    ? forgedSenderMessages.outbox.find((entry) => entry?.messageId === delivered.message.messageId)
    : null;
  assert(!forgedOutboxHit, "伪造 sender agent 的 outbox 不应出现这条消息");

  const targetTranscript = await getJson(
    adminFetch,
    `/api/agents/${CANONICAL_MAIN_AGENT_ID}/transcript?family=conversation&limit=20`
  );
  const targetTranscriptEntry = listTranscriptEntries(targetTranscript).find(
    (entry) => entry?.sourceMessageId === delivered.message.messageId
  );
  assert(targetTranscriptEntry, "目标 agent transcript 应记录 inbox message");
  assert(
    targetTranscriptEntry.entryType === "message_inbox",
    "目标 agent transcript 应写成 message_inbox"
  );
  assert(
    targetTranscriptEntry.sourceWindowId == null,
    "目标 agent transcript 不应保留 body 伪造 sourceWindowId"
  );

  const forgedSenderTranscript = await getJson(
    adminFetch,
    `/api/agents/${encodeURIComponent(forgedFromAgentId)}/transcript?family=conversation&limit=20`
  );
  const forgedOutboxEntry = listTranscriptEntries(forgedSenderTranscript).find(
    (entry) => entry?.sourceMessageId === delivered.message.messageId
  );
  assert(!forgedOutboxEntry, "伪造 sender agent transcript 不应出现 message_outbox");

  console.log(
    JSON.stringify(
      {
        ok: true,
        verified: [
          "POST /api/agents/agent_main/messages ignores forged fromAgentId/fromWindowId while still resolving the current physical owner target",
          "target inbox keeps delivery through the canonical route id",
          "forged sender outbox/transcript stay clean",
        ],
        messageId: delivered.message.messageId,
        resolvedMainAgentId,
        forgedFromAgentId,
        forgedFromWindowId,
      },
      null,
      2
    )
  );
} catch (error) {
  probe.logServerOutput();
  throw error;
} finally {
  await probe.cleanup(server);
}

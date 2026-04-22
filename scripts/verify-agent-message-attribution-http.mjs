import {
  createAttributionHttpProbe,
  getJson,
  postJson,
} from "./attribution-http-probe-shared.mjs";
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
  const windowsPayload = await getJson(adminFetch, "/api/windows");
  const forgedWindow = Array.isArray(windowsPayload.windows)
    ? windowsPayload.windows.find(
        (entry) => entry?.agentId && entry.agentId !== "agent_openneed_agents" && entry?.windowId
      ) || null
    : null;
  const forgedFromAgentId = forgedWindow?.agentId || "agent_treasury";
  const forgedFromWindowId = forgedWindow?.windowId || "window_forged_message_sender";
  const probeToken = `message-probe-${Date.now()}`;

  const delivered = await postJson(
    adminFetch,
    "/api/agents/agent_openneed_agents/messages",
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
  assert(delivered.message.toAgentId === "agent_openneed_agents", "message route 应仍然投递到目标 agent");
  assert(delivered.message.fromAgentId == null, "message route 不应保留 body 伪造 fromAgentId");
  assert(delivered.message.fromWindowId == null, "message route 不应保留 body 伪造 fromWindowId");

  const targetMessages = await getJson(
    adminFetch,
    "/api/agents/agent_openneed_agents/messages?limit=20"
  );
  const inboxMessage = Array.isArray(targetMessages.inbox)
    ? targetMessages.inbox.find((entry) => entry?.messageId === delivered.message.messageId)
    : null;
  assert(inboxMessage, "目标 agent inbox 应包含新消息");
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
    "/api/agents/agent_openneed_agents/transcript?family=conversation&limit=20"
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
          "POST /api/agents/:id/messages ignores forged fromAgentId/fromWindowId",
          "target inbox keeps delivery",
          "forged sender outbox/transcript stay clean",
        ],
        messageId: delivered.message.messageId,
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

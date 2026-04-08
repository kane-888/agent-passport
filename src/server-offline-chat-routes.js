import { json } from "./server-base-helpers.js";
import {
  flushOfflineChatSync,
  getOfflineChatBootstrapPayload,
  getOfflineChatHistory,
  getOfflineChatSyncStatus,
  sendOfflineChatDirectMessage,
  sendOfflineChatGroupMessage,
} from "./offline-chat-runtime.js";

function text(value) {
  return typeof value === "string"
    ? value
        .replace(/\u001b\[[0-9;]*m/g, "")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
        .trim()
    : "";
}

function hasReadableContent(value) {
  const normalized = text(value);
  return /[\p{L}\p{N}\p{Script=Han}]/u.test(normalized);
}

function ensureVisibleReplyContent(content, displayName = "成员") {
  const normalized = text(content);
  if (normalized && hasReadableContent(normalized)) {
    return normalized;
  }
  return `${displayName} 在，我继续陪你聊。`;
}

function summarizeReasoning(reasoning) {
  if (!reasoning) {
    return null;
  }
  return {
    provider: text(reasoning.provider) || null,
    model: text(reasoning.model) || null,
    promptStyle: text(reasoning?.metadata?.promptStyle) || null,
  };
}

function toDirectMessageResponse(result) {
  return {
    threadId: result?.threadId || null,
    user: result?.message?.user || null,
    message: {
      assistant: result?.message?.assistant
        ? {
            ...result.message.assistant,
            content: ensureVisibleReplyContent(
              result?.message?.assistant?.content,
              result?.message?.assistant?.author || "成员"
            ),
          }
        : null,
    },
    reasoning: summarizeReasoning(result?.reasoning),
    sync: {
      recordId: result?.syncRecord?.passportMemoryId || null,
      status: text(result?.syncRecord?.payload?.syncStatus) || "pending_cloud",
    },
  };
}

function toGroupMessageResponse(result) {
  return {
    threadId: result?.threadId || "group",
    user: result?.user || null,
    responses: Array.isArray(result?.responses)
      ? result.responses.map((entry) => ({
          ...entry,
          content: ensureVisibleReplyContent(entry?.content, entry?.displayName || "成员"),
        }))
      : [],
    sync: {
      recordId: result?.groupRecord?.passportMemoryId || null,
      status: text(result?.groupRecord?.payload?.syncStatus) || "pending_cloud",
    },
  };
}

export async function handleOfflineChatRoutes({
  req,
  res,
  url,
  pathname,
  segments,
  parseBody,
}) {
  if (req.method === "GET" && pathname === "/api/offline-chat/bootstrap") {
    return json(res, 200, await getOfflineChatBootstrapPayload());
  }

  if (req.method === "GET" && pathname === "/api/offline-chat/sync/status") {
    return json(res, 200, await getOfflineChatSyncStatus());
  }

  if (req.method === "POST" && pathname === "/api/offline-chat/sync/flush") {
    return json(res, 200, await flushOfflineChatSync());
  }

  if (segments[0] === "api" && segments[1] === "offline-chat" && segments[2] === "threads" && segments[3]) {
    const threadId = decodeURIComponent(segments[3]);
    const action = segments[4] || null;

    if (req.method === "GET" && action === "messages") {
      const limit = Number(url.searchParams.get("limit") || 80);
      return json(res, 200, await getOfflineChatHistory(threadId, { limit }));
    }

    if (req.method === "POST" && action === "messages") {
      const body = await parseBody(req);
      const content = text(body?.content || body?.message || body?.text);
      if (!content) {
        return json(res, 400, { error: "消息内容不能为空。" });
      }
      if (threadId === "group") {
        return json(res, 200, toGroupMessageResponse(await sendOfflineChatGroupMessage(content)));
      }
      return json(res, 200, toDirectMessageResponse(await sendOfflineChatDirectMessage(threadId, content)));
    }
  }
}

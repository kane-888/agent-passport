import { json } from "./server-base-helpers.js";
import {
  flushOfflineChatSync,
  getOfflineChatBootstrapPayload,
  getOfflineChatHistory,
  getOfflineChatSyncStatus,
  getOfflineChatThreadStartupContext,
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

function summarizeSource(source) {
  if (!source) {
    return null;
  }
  return {
    provider: text(source.provider) || null,
    label: text(source.label) || null,
    stage: text(source.stage) || null,
    model: text(source.model) || null,
    promptStyle: text(source.promptStyle) || null,
    localReasoningStack: text(source.localReasoningStack) || null,
    dispatch:
      source.dispatch && typeof source.dispatch === "object"
        ? {
            batchId:
              source.dispatch.batchId === "merge"
                ? "merge"
                : Number.isFinite(Number(source.dispatch.batchId))
                  ? Number(source.dispatch.batchId)
                  : null,
            executionMode: text(source.dispatch.executionMode) || null,
            dispatchMode: text(source.dispatch.dispatchMode) || null,
            activationStage: text(source.dispatch.activationStage) || null,
            status: text(source.dispatch.status) || null,
          }
        : null,
  };
}

const OFFLINE_CHAT_READ_SESSION_REDACTION = "[redacted:offline-chat-read-session]";
const OFFLINE_CHAT_REDACTED_FIELDS = new Set([
  "answer",
  "assistantText",
  "content",
  "context",
  "highlights",
  "memories",
  "message",
  "messages",
  "prompt",
  "raw",
  "rawPrompt",
  "rawResponse",
  "reasoningText",
  "recentConversationTurns",
  "response",
  "responses",
  "summary",
  "summaryLines",
  "text",
  "transcript",
  "userText",
  "value",
]);

function cloneJsonValue(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function redactOfflineChatValue(value, key = "") {
  if (typeof value === "string") {
    return OFFLINE_CHAT_REDACTED_FIELDS.has(key) ? OFFLINE_CHAT_READ_SESSION_REDACTION : value;
  }
  if (Array.isArray(value)) {
    if (OFFLINE_CHAT_REDACTED_FIELDS.has(key)) {
      return value.map((entry) =>
        entry && typeof entry === "object"
          ? redactOfflineChatValue(entry)
          : OFFLINE_CHAT_READ_SESSION_REDACTION
      );
    }
    return value.map((entry) => redactOfflineChatValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const redacted = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    redacted[entryKey] = redactOfflineChatValue(entryValue, entryKey);
  }
  return redacted;
}

export function redactOfflineChatReadSessionPayload(payload, access = null) {
  if (access?.mode !== "read_session" || access.session?.redactionTemplate === "full") {
    return payload;
  }
  return redactOfflineChatValue(cloneJsonValue(payload));
}

function shouldRedactOfflineChatReadSession(req) {
  return (
    req?.agentPassportAccess?.mode === "read_session" &&
    req.agentPassportAccess.session?.redactionTemplate !== "full"
  );
}

function offlineChatJson(req, res, statusCode, payload) {
  const body = shouldRedactOfflineChatReadSession(req)
    ? redactOfflineChatReadSessionPayload(payload, req.agentPassportAccess)
    : payload;
  return json(res, statusCode, body);
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
            source: summarizeSource(result?.message?.assistant?.source || result?.assistantSource),
          }
        : null,
    },
    reasoning: summarizeReasoning(result?.reasoning),
    source: summarizeSource(result?.assistantSource || result?.message?.assistant?.source),
    dispatchHistory: Array.isArray(result?.dispatchHistory) ? result.dispatchHistory : [],
    dispatchView: result?.dispatchView && typeof result.dispatchView === "object" ? result.dispatchView : null,
    threadView: result?.threadView && typeof result.threadView === "object" ? result.threadView : null,
    threadStartup: result?.threadStartup && typeof result.threadStartup === "object" ? result.threadStartup : null,
    startupSignature: text(result?.startupSignature) || null,
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
    dispatch: result?.dispatch
      ? {
          phaseKey: text(result?.dispatch?.phaseKey) || null,
          policyVersion: text(result?.dispatch?.policyVersion) || null,
          dispatchModel: text(result?.dispatch?.dispatchModel) || null,
          summary: text(result?.dispatch?.summary) || null,
          parallelAllowed: Boolean(result?.dispatch?.parallelAllowed),
          maxConcurrentSubagents: Number(result?.dispatch?.maxConcurrentSubagents || 0),
          selectedRoles: Array.isArray(result?.dispatch?.selectedRoles)
            ? result.dispatch.selectedRoles.map((entry) => ({
                displayName: text(entry?.displayName) || null,
                role: text(entry?.role) || null,
                dispatchBatch: Number.isFinite(Number(entry?.dispatchBatch)) ? Number(entry.dispatchBatch) : null,
              }))
            : [],
          blockedRoles: Array.isArray(result?.dispatch?.blockedRoles)
            ? result.dispatch.blockedRoles.map((entry) => ({
                displayName: text(entry?.displayName) || null,
                role: text(entry?.role) || null,
                reason: text(entry?.reason) || null,
              }))
            : [],
          batchPlan: Array.isArray(result?.dispatch?.batchPlan)
            ? result.dispatch.batchPlan.map((batch) => ({
                batchId:
                  batch?.batchId === "merge"
                    ? "merge"
                    : Number.isFinite(Number(batch?.batchId))
                      ? Number(batch.batchId)
                      : null,
                executionMode: text(batch?.executionMode) || null,
                concurrency: Number.isFinite(Number(batch?.concurrency)) ? Number(batch.concurrency) : null,
                roles: Array.isArray(batch?.roles)
                  ? batch.roles.map((entry) => ({
                      displayName: text(entry?.displayName) || null,
                      role: text(entry?.role) || null,
                      dispatchBatch: Number.isFinite(Number(entry?.dispatchBatch)) ? Number(entry.dispatchBatch) : null,
                      dispatchMode: text(entry?.dispatchMode) || null,
                      activationStage: text(entry?.activationStage) || null,
                    }))
                  : [],
              }))
            : [],
          signals: result?.dispatch?.signals || null,
        }
      : null,
    execution: result?.execution || null,
    executionSummary: text(result?.executionSummary) || null,
    dispatchHistory: Array.isArray(result?.dispatchHistory) ? result.dispatchHistory : [],
    dispatchView: result?.dispatchView && typeof result.dispatchView === "object" ? result.dispatchView : null,
    threadView: result?.threadView && typeof result.threadView === "object" ? result.threadView : null,
    threadStartup: result?.threadStartup && typeof result.threadStartup === "object" ? result.threadStartup : null,
    startupSignature: text(result?.startupSignature) || null,
    responses: Array.isArray(result?.responses)
      ? result.responses.map((entry) => ({
          ...entry,
          content: ensureVisibleReplyContent(entry?.content, entry?.displayName || "成员"),
          source: summarizeSource(entry?.source),
        }))
      : [],
    sync: {
      recordId: result?.groupRecord?.passportMemoryId || null,
      status: text(result?.groupRecord?.payload?.syncStatus) || "pending_cloud",
    },
  };
}

function toSyncFlushResponse(result) {
  return {
    status: text(result?.status) || "idle",
    pendingCount: Number.isFinite(Number(result?.pendingCount)) ? Math.max(0, Math.floor(Number(result.pendingCount))) : 0,
    endpoint: text(result?.endpoint) || null,
    endpointConfigured: Boolean(result?.endpointConfigured),
    viewLines: Array.isArray(result?.viewLines) ? result.viewLines.map((entry) => text(entry)).filter(Boolean) : [],
    deliveredCount: Number.isFinite(Number(result?.deliveredCount)) ? Math.max(0, Math.floor(Number(result.deliveredCount))) : 0,
    localReceiptStatus: text(result?.localReceiptStatus) || null,
    localReceiptWarnings: Array.isArray(result?.localReceiptWarnings)
      ? result.localReceiptWarnings.map((entry) => ({
          type: text(entry?.type) || "local_receipt_warning",
          agentId: text(entry?.agentId) || null,
          error: text(entry?.error) || null,
        }))
      : [],
    duplicateSyncRisk: Boolean(result?.duplicateSyncRisk),
    responseStatus: Number.isFinite(Number(result?.responseStatus)) ? Number(result.responseStatus) : null,
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
    return offlineChatJson(req, res, 200, await getOfflineChatBootstrapPayload({ passive: true }));
  }

  if (req.method === "GET" && pathname === "/api/offline-chat/thread-startup-context") {
    const phaseKey = text(url.searchParams.get("phase")) || "phase_1";
    const result = await getOfflineChatThreadStartupContext({ phaseKey, passive: true });
    return offlineChatJson(req, res, result?.ok === false ? 404 : 200, result);
  }

  if (req.method === "GET" && pathname === "/api/offline-chat/sync/status") {
    return offlineChatJson(req, res, 200, await getOfflineChatSyncStatus({ passive: true }));
  }

  if (req.method === "POST" && pathname === "/api/offline-chat/sync/flush") {
    return json(res, 200, toSyncFlushResponse(await flushOfflineChatSync()));
  }

  if (segments[0] === "api" && segments[1] === "offline-chat" && segments[2] === "threads" && segments[3]) {
    const threadId = decodeURIComponent(segments[3]);
    const action = segments[4] || null;

    if (req.method === "GET" && action === "messages") {
      const limit = Number(url.searchParams.get("limit") || 80);
      const sourceProvider = text(url.searchParams.get("sourceProvider"));
      return offlineChatJson(req, res, 200, await getOfflineChatHistory(threadId, {
        limit,
        sourceProvider: sourceProvider || null,
        passive: true,
      }));
    }

    if (req.method === "POST" && action === "messages") {
      const body = await parseBody(req);
      const content = text(body?.content || body?.message || body?.text);
      const verificationMode = text(body?.verificationMode) || null;
      if (!content) {
        return json(res, 400, { error: "消息内容不能为空。" });
      }
      if (threadId === "group") {
        return json(res, 200, toGroupMessageResponse(await sendOfflineChatGroupMessage(content, { verificationMode })));
      }
      return json(res, 200, toDirectMessageResponse(await sendOfflineChatDirectMessage(threadId, content)));
    }
  }
}

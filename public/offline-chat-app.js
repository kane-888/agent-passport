import {
  AGENT_PASSPORT_MEMORY_ENGINE_LABEL,
  AGENT_PASSPORT_LOCAL_REASONER_LABEL,
  AGENT_PASSPORT_LOCAL_STACK_NAME,
  buildAdminTokenHeaders,
  buildAdminTokenAuthSummary,
  describeProtectedReadFailure,
  displayAgentPassportLocalReasonerModel,
  formatRuntimeMessageDispatch,
  formatRuntimeMessageSource,
  OFFLINE_CHAT_HOME_COPY,
  migrateStoredAdminToken,
  providerLabel,
  readStoredAdminToken,
  writeStoredAdminToken,
} from "/runtime-truth-client.js";

const state = {
  bootstrap: null,
  bootstrapRequestVersion: 0,
  threads: [],
  activeThreadId: "group",
  histories: new Map(),
  historyMeta: new Map(),
  historyLoading: new Set(),
  historyRequestVersions: new Map(),
  historyFilters: new Map(),
  sync: null,
  protectedAccessBlocked: false,
  protectedAccessMessage: "",
  sending: false,
  syncing: false,
  bootstrapping: false,
  autoSyncTimer: null,
  lastAutoSyncAt: 0,
};

const OFFLINE_THREAD_RUNTIME_SCOPE_LABEL = "本地对话、历史记录、同步和发送消息";
const OFFLINE_THREAD_RECOVERY_SCOPE_LABEL = "本地对话、历史记录、同步与写入";
const DIRECT_COMPOSER_PLACEHOLDER = "在这里输入消息。单聊只发给当前成员。";
const GROUP_COMPOSER_PLACEHOLDER = "在这里输入消息。群聊会先判断谁需要回复。";
const DISABLED_COMPOSER_PLACEHOLDER = "当前对话不可用，请先解锁后再发送。";
const PROTECTED_COMPOSER_PLACEHOLDER = "查看历史、同步和发送消息需要先解锁。";
const PROTECTED_ACCESS_REQUIRED_MESSAGE = `${OFFLINE_THREAD_RUNTIME_SCOPE_LABEL}都要求访问口令，请先输入。`;
const OFFLINE_CHAT_UNAUTHORIZED_ERROR_CODE = "OFFLINE_CHAT_UNAUTHORIZED";
const OFFLINE_CHAT_FORBIDDEN_ERROR_CODE = "OFFLINE_CHAT_FORBIDDEN";
const OFFLINE_CHAT_STARTUP_MISMATCH_ERROR_CODE = "OFFLINE_CHAT_STARTUP_MISMATCH";
const OFFLINE_CHAT_ROUTE_TRUTH_ERROR_CODE = "OFFLINE_CHAT_ROUTE_TRUTH_MISSING";
const OFFLINE_CHAT_UNAUTHORIZED_MESSAGES = new Set([
  PROTECTED_ACCESS_REQUIRED_MESSAGE,
  "本次浏览保存的访问口令无法访问本地对话；请重新输入后再解锁。",
  "对话状态、历史记录、同步和发送消息都要求访问口令",
]);

const elements = {
  heroSummary: document.querySelector("#offline-chat-hero-summary"),
  threadList: document.querySelector("#thread-list"),
  threadTitle: document.querySelector("#thread-title"),
  threadDescription: document.querySelector("#thread-description"),
  threadPill: document.querySelector("#thread-pill"),
  runtimeNotice: document.querySelector("#runtime-notice"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  composerInput: document.querySelector("#composer-input"),
  composerHint: document.querySelector("#composer-hint"),
  sendButton: document.querySelector("#send-button"),
  syncStatus: document.querySelector("#sync-status"),
  syncButton: document.querySelector("#sync-button"),
  refreshButton: document.querySelector("#refresh-button"),
  stackChip: document.querySelector("#stack-chip"),
  networkChip: document.querySelector("#network-chip"),
  sourceFilterSummary: document.querySelector("#source-filter-summary"),
  sourceFilterList: document.querySelector("#source-filter-list"),
  threadContextSummary: document.querySelector("#thread-context-summary"),
  threadContextList: document.querySelector("#thread-context-list"),
  dispatchHistorySection: document.querySelector("#dispatch-history-section"),
  dispatchHistorySummary: document.querySelector("#dispatch-history-summary"),
  dispatchHistoryList: document.querySelector("#dispatch-history-list"),
  authStatus: document.querySelector("#auth-status"),
  authTokenForm: document.querySelector("#auth-token-form"),
  authTokenInput: document.querySelector("#auth-token-input"),
  authClearButton: document.querySelector("#auth-clear-button"),
};

if (elements.heroSummary) {
  elements.heroSummary.textContent = OFFLINE_CHAT_HOME_COPY.heroSummary;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getStoredAdminToken() {
  return readStoredAdminToken();
}

function setStoredAdminToken(token) {
  return writeStoredAdminToken(text(token));
}

function hasStoredAdminToken() {
  return Boolean(text(getStoredAdminToken()));
}

function migrateLegacyAdminToken() {
  return migrateStoredAdminToken();
}

function renderAuthState(message = "") {
  const storedToken = hasStoredAdminToken();
  if (elements.authStatus) {
    elements.authStatus.textContent =
      text(message) ||
      buildAdminTokenAuthSummary({
        hasToken: storedToken,
        tokenStoreLabel: "本次浏览",
        savedDetail: `${OFFLINE_THREAD_RUNTIME_SCOPE_LABEL}已在本次浏览解锁。`,
        missingDetail: `${OFFLINE_THREAD_RUNTIME_SCOPE_LABEL}需要先解锁。`,
      });
  }
  if (elements.authClearButton) {
    elements.authClearButton.disabled = !storedToken;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function humanizeConversationText(value = "") {
  let normalized = text(value, "");
  if (!normalized) {
    return "";
  }
  const replacements = [
    [/管理令牌/g, "访问口令"],
    [/令牌/g, "口令"],
    [/\btoken\b/gi, "口令"],
    [/\badmin\b/gi, "管理"],
    [/线程协议运行时/g, "对话规则服务"],
    [/线程上下文/g, "对话信息"],
    [/线程成员/g, "对话成员"],
    [/离线线程/g, "对话"],
    [/物理线程 ID/g, "内部编号"],
    [/内部线程 ID/g, "内部编号"],
    [/routeThreadId/g, "对话编号"],
    [/\bthread\b/gi, "对话"],
    [/线程/g, "对话"],
    [/fan[- ]?out/gi, "多人回复"],
    [/\bruntime\b/gi, "运行状态"],
    [/运行态/g, "运行状态"],
    [/真值/g, "状态"],
    [/OpenNeed/g, "历史应用"],
    [/\bDID\b/g, "身份格式"],
    [/\blegacy\b/gi, "历史兼容"],
    [/\bcanonical\b/gi, "主身份"],
    [/\bphysical\b/gi, "内部记录"],
    [/凭证/g, "身份记录"],
    [/签发/g, "确认"],
    [/回执/g, "确认记录"],
    [/注册表/g, "身份清单"],
    [/修复 ID/g, "恢复编号"],
    [/\bledger\.json\b/gi, "身份资料"],
    [/\bledger\b/gi, "身份资料"],
    [/\boutbox\b/gi, "本地暂存区"],
    [/\/api\/security/g, "安全检查"],
    [/\/api/g, "服务接口"],
    [/受限执行/g, "安全限制"],
    [/执行边界/g, "安全限制"],
    [/审计/g, "操作记录"],
    [/调度历史/g, "分配记录"],
    [/调度/g, "分配"],
    [/闸门/g, "判断"],
    [/放行/g, "安排"],
    [/并行批次/g, "同时回复批次"],
    [/并行/g, "同时"],
    [/串行/g, "依次"],
    [/运行信息/g, "服务信息"],
    [/运行预览/g, "临时预览"],
    [/本地栈/g, "本地引擎"],
  ];
  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function formatTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "时间未确认";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function truncateText(value, maxChars = 120) {
  const normalized = text(value)?.replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}…` : normalized;
}

function basename(value) {
  const normalized = text(value);
  if (!normalized) {
    return "";
  }
  return normalized.split(/[\\/]/).pop() || normalized;
}

function formatParticipantNames(participants = []) {
  if (!Array.isArray(participants) || !participants.length) {
    return "团队里的每个人";
  }
  const names = Array.from(
    new Set(
      participants
        .map((entry) => text(entry?.displayName))
        .filter(Boolean)
    )
  );
  return names.length ? names.join("、") : "团队里的每个人";
}

function participantIdentityKey(entry = {}) {
  return (
    text(entry?.agentId || entry?.agent?.agentId) ||
    text(entry?.role) ||
    text(entry?.displayName || entry?.label)
  );
}

function dedupeParticipants(participants = []) {
  const seen = new Set();
  return (Array.isArray(participants) ? participants : []).filter((entry) => {
    const key = participantIdentityKey(entry);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatGroupComposition(coreCount, supportCount) {
  if (coreCount || supportCount) {
    return `当前编组：${coreCount} 位工作角色，${supportCount} 位支持角色。`;
  }
  return "当前正在读取成员分工。";
}

function formatStackChip(localReasoner = null) {
  const provider = text(localReasoner?.provider) || "unknown";
  if (provider === "local_command") {
    const command = basename(localReasoner?.command) || "本地命令";
    return humanizeConversationText(`${AGENT_PASSPORT_LOCAL_STACK_NAME}：${providerLabel(provider)} · ${command} · ${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}`);
  }
  if (provider === "ollama_local") {
    return humanizeConversationText(`${AGENT_PASSPORT_LOCAL_STACK_NAME}：${providerLabel(provider)} · ${displayAgentPassportLocalReasonerModel(localReasoner?.model)} · ${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}`);
  }
  if (provider === "openai_compatible") {
    return humanizeConversationText(`${AGENT_PASSPORT_LOCAL_STACK_NAME}：${providerLabel(provider)} · ${displayAgentPassportLocalReasonerModel(localReasoner?.model, "未命名模型")} · ${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}`);
  }
  if (provider === "local_mock") {
    return humanizeConversationText(`${AGENT_PASSPORT_LOCAL_STACK_NAME}：${providerLabel(provider)} · 兜底本地回答引擎`);
  }
  return humanizeConversationText(`${AGENT_PASSPORT_LOCAL_STACK_NAME}：${providerLabel(provider)} · ${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}`);
}

function formatMessageSource(source = null) {
  return humanizeConversationText(formatRuntimeMessageSource(source));
}

function formatMessageDispatch(source = null) {
  return humanizeConversationText(formatRuntimeMessageDispatch(source));
}

function renderMessageMeta(source = null) {
  const sourceText = formatMessageSource(source);
  const dispatchText = formatMessageDispatch(source);
  if (!sourceText && !dispatchText) {
    return "";
  }
  const sourceBadgeClass = ["message-source", sourceClassName(source)].filter(Boolean).join(" ");
  return `
    <div class="message-meta">
      ${sourceText ? `<div class="${escapeHtml(sourceBadgeClass)}" data-source-provider="${escapeHtml(text(source?.provider))}">${escapeHtml(sourceText)}</div>` : ""}
      ${dispatchText ? `<div class="message-dispatch" data-dispatch-batch="${escapeHtml(text(source?.dispatch?.batchId))}" data-dispatch-mode="${escapeHtml(text(source?.dispatch?.executionMode))}">${escapeHtml(dispatchText)}</div>` : ""}
    </div>
  `;
}

function sourceClassName(source = null) {
  const provider = text(source?.provider);
  if (provider === "passport_fast_memory") {
    return "source-fast";
  }
  if (provider === "local_command") {
    return "source-command";
  }
  if (provider === "ollama_local") {
    return "source-ollama";
  }
  if (provider === "deterministic_fallback") {
    return "source-fallback";
  }
  return "";
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    threadId: text(params.get("threadId")) || null,
    sourceProvider: text(params.get("sourceProvider")) || null,
  };
}

function directThreadRouteId(thread = null) {
  return text(thread?.routeThreadId);
}

function requireDirectThreadRouteId(thread = null) {
  const routeThreadId = directThreadRouteId(thread);
  if (routeThreadId) {
    return routeThreadId;
  }
  const threadId = text(thread?.threadId || thread?.agentId) || "unknown-thread";
  const error = new Error(
    `当前单聊缺少可恢复的对话编号，已拒绝继续使用内部编号：${threadId}。请刷新对话状态后重试。`
  );
  error.code = OFFLINE_CHAT_ROUTE_TRUTH_ERROR_CODE;
  error.threadId = threadId;
  throw error;
}

function listThreadRouteIds(thread = null) {
  return [
    directThreadRouteId(thread),
    text(thread?.threadId),
    text(thread?.agentId),
  ].filter(Boolean);
}

function findThreadByRouteId(threadId = null) {
  const requestedThreadId = text(threadId);
  if (!requestedThreadId) {
    return null;
  }
  return state.threads.find((entry) => listThreadRouteIds(entry).includes(requestedThreadId)) || null;
}

function resolveThreadId(threadId = null) {
  const requestedThread = findThreadByRouteId(threadId);
  return (
    requestedThread?.threadId ||
    state.threads.find((entry) => entry.threadId === "group")?.threadId ||
    state.threads[0]?.threadId ||
    "group"
  );
}

function syncUrlState({ historyMode = "replace" } = {}) {
  const url = new URL(window.location.href);
  const thread = activeThread();
  const resolvedThreadId = text(thread?.threadId) || text(state.activeThreadId) || "";
  const routeThreadId =
    text(thread?.threadKind) === "direct"
      ? directThreadRouteId(thread)
      : resolvedThreadId;
  const sourceProvider = activeSourceFilter(resolvedThreadId);

  if (routeThreadId) {
    url.searchParams.set("threadId", routeThreadId);
  } else {
    url.searchParams.delete("threadId");
  }

  if (text(sourceProvider)) {
    url.searchParams.set("sourceProvider", text(sourceProvider));
  } else {
    url.searchParams.delete("sourceProvider");
  }

  const nextHref = `${url.pathname}${url.search}${url.hash}`;
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const historyMethod = historyMode === "push" && nextHref !== currentHref ? "pushState" : "replaceState";

  window.history[historyMethod](
    {
      threadId: text(routeThreadId) || null,
      sourceProvider: text(sourceProvider) || null,
    },
    "",
    nextHref
  );
}

function activeSourceFilter(threadId = state.activeThreadId) {
  return state.historyFilters.get(threadId) || null;
}

function bootstrapThreadView(threadId = state.activeThreadId) {
  const views = state.bootstrap?.threadViews;
  return views && typeof views === "object" ? views[threadId] || null : null;
}

function invalidateBootstrapThreadView(threadId) {
  const normalizedThreadId = text(threadId);
  if (!normalizedThreadId) {
    return;
  }
  const views = state.bootstrap?.threadViews;
  if (!views || typeof views !== "object") {
    return;
  }
  delete views[normalizedThreadId];
}

function invalidateBootstrapThreadHistory(threadId) {
  const normalizedThreadId = text(threadId);
  if (!normalizedThreadId) {
    return;
  }
  const meta = state.bootstrap?.threadHistoryMeta;
  if (!meta || typeof meta !== "object") {
    return;
  }
  delete meta[normalizedThreadId];
}

function invalidateThreadHistoryFallback(threadId) {
  invalidateBootstrapThreadView(threadId);
  invalidateBootstrapThreadHistory(threadId);
}

function bootstrapHistoryMeta(threadId = state.activeThreadId) {
  const meta = state.bootstrap?.threadHistoryMeta;
  return meta && typeof meta === "object" ? meta[threadId] || null : null;
}

function setActiveSourceFilter(threadId, sourceProvider = null) {
  const normalized = text(sourceProvider);
  if (!normalized) {
    state.historyFilters.delete(threadId);
    return;
  }
  state.historyFilters.set(threadId, normalized);
}

function currentHistoryMeta(threadId = state.activeThreadId) {
  return currentLoadedHistoryMeta(threadId) || bootstrapHistoryMeta(threadId) || null;
}

function currentLoadedHistoryMeta(threadId = state.activeThreadId) {
  return state.historyMeta.get(threadId) || null;
}

function currentSourceSummary(threadId = state.activeThreadId) {
  return currentLoadedHistoryMeta(threadId)?.sourceSummary || null;
}

function currentThreadView(threadId = state.activeThreadId) {
  return currentHistoryMeta(threadId)?.threadView || bootstrapThreadView(threadId) || null;
}

function currentDispatchView(threadId = state.activeThreadId) {
  return currentHistoryMeta(threadId)?.dispatchView || null;
}

function isHistoryLoading(threadId = state.activeThreadId) {
  return state.historyLoading.has(threadId);
}

function hasResolvedThreadHistory(threadId, sourceFilter = activeSourceFilter(threadId)) {
  const cached = state.historyMeta.get(threadId);
  if (cached?.runtimePreview === true) {
    return false;
  }
  if (!cached || text(cached.sourceFilter) !== text(sourceFilter)) {
    return false;
  }
  return matchesThreadHistoryStartupContext(cached, activeThreadStartupContext());
}

function matchesThreadHistoryStartupContext(historyMeta = null, startupContext = null) {
  const historySignature = text(historyMeta?.startupSignature);
  const startupSignature = text(startupContext?.startupSignature);
  if (historySignature && startupSignature) {
    return historySignature === startupSignature;
  }
  const historyProtocol = historyMeta?.threadProtocol || null;
  const startupProtocol = startupContext?.threadProtocol || null;
  if (!historyProtocol || !startupProtocol) {
    return false;
  }
  const historyRecordId = text(historyProtocol?.protocolRecordId);
  const startupRecordId = text(startupProtocol?.protocolRecordId);
  if (historyRecordId && startupRecordId && historyRecordId !== startupRecordId) {
    return false;
  }
  const historyKey = text(historyProtocol?.protocolKey);
  const startupKey = text(startupProtocol?.protocolKey);
  if (historyKey && startupKey && historyKey !== startupKey) {
    return false;
  }
  const historyVersion = text(historyProtocol?.protocolVersion);
  const startupVersion = text(startupProtocol?.protocolVersion || startupContext?.protocolVersion);
  if (historyVersion && startupVersion && historyVersion !== startupVersion) {
    return false;
  }
  return true;
}

function nextThreadHistoryRequestVersion(threadId) {
  const nextVersion = Number(state.historyRequestVersions.get(threadId) || 0) + 1;
  state.historyRequestVersions.set(threadId, nextVersion);
  return nextVersion;
}

function isCurrentThreadHistoryRequest(threadId, requestVersion) {
  return Number(state.historyRequestVersions.get(threadId) || 0) === Number(requestVersion || 0);
}

function nextBootstrapRequestVersion() {
  state.bootstrapRequestVersion = Number(state.bootstrapRequestVersion || 0) + 1;
  return state.bootstrapRequestVersion;
}

function isCurrentBootstrapRequest(requestVersion) {
  return Number(state.bootstrapRequestVersion || 0) === Number(requestVersion || 0);
}

function captureThreadHistorySnapshot(threadId) {
  return {
    hasMeta: state.historyMeta.has(threadId),
    meta: state.historyMeta.get(threadId) || null,
    hasMessages: state.histories.has(threadId),
    messages: state.histories.get(threadId) || [],
  };
}

function clearThreadHistorySnapshot(threadId, { preserveResolved = false } = {}) {
  state.historyLoading.add(threadId);
  if (preserveResolved && hasResolvedThreadHistory(threadId)) {
    return;
  }
  state.historyMeta.delete(threadId);
  state.histories.delete(threadId);
}

function invalidateThreadHistoryState(threadId) {
  const normalizedThreadId = text(threadId);
  if (!normalizedThreadId) {
    return;
  }
  state.historyLoading.delete(normalizedThreadId);
  state.historyMeta.delete(normalizedThreadId);
  state.histories.delete(normalizedThreadId);
  invalidateThreadHistoryFallback(normalizedThreadId);
}

function restoreThreadHistorySnapshot(threadId, snapshot = null) {
  state.historyLoading.delete(threadId);
  if (snapshot?.hasMeta) {
    state.historyMeta.set(threadId, snapshot.meta || null);
  } else {
    state.historyMeta.delete(threadId);
  }
  if (snapshot?.hasMessages) {
    state.histories.set(threadId, Array.isArray(snapshot.messages) ? snapshot.messages : []);
  } else {
    state.histories.delete(threadId);
  }
}

function applyGroupMessageRuntimeView(result = null) {
  if (!result || text(result?.threadId) !== "group") {
    return false;
  }
  if (!acceptsThreadStartupFromHistory(result)) {
    return false;
  }
  const sourceFilter = activeSourceFilter("group");
  const recordId = text(result?.sync?.recordId) || `runtime-preview-${Date.now()}`;
  const createdAt = text(result?.user?.createdAt) || new Date().toISOString();
  const includedResponses = (Array.isArray(result?.responses) ? result.responses : [])
    .filter((entry) => text(entry?.content))
    .filter((entry) => !sourceFilter || text(entry?.source?.provider) === text(sourceFilter));
  const previewMessages = [];
  if (text(result?.user?.content) && (!sourceFilter || includedResponses.length > 0)) {
    previewMessages.push({
      messageId: `${recordId}:user`,
      role: "user",
      author: text(result?.user?.author) || "Kane",
      content: text(result.user.content),
      createdAt,
    });
  }
  for (const [index, response] of includedResponses.entries()) {
    previewMessages.push({
      messageId: `${recordId}:${text(response?.agentId || response?.displayName) || index}`,
      role: "assistant",
      author: text(response?.displayName) || "团队成员",
      agentId: text(response?.agentId) || null,
      dispatchBatch: Number.isFinite(Number(response?.dispatchBatch)) ? Math.floor(Number(response.dispatchBatch)) : null,
      executionMode: text(response?.executionMode) || null,
      executionStatus: text(response?.status) || null,
      content: text(response.content),
      createdAt: text(response?.createdAt) || createdAt,
      dispatch: response?.dispatch || null,
      source: response?.source || null,
    });
  }
  if (previewMessages.length > 0) {
    const previousMessages = state.histories.get("group") || [];
    state.histories.set("group", [
      ...previousMessages.filter((entry) => !text(entry?.messageId).startsWith(`${recordId}:`)),
      ...previewMessages,
    ]);
  }
  const previousMeta = currentHistoryMeta("group") || null;
  const meta = {
    threadId: "group",
    threadKind: "group",
    sourceFilter,
    runtimePreview: true,
    dispatch: result?.dispatch || null,
    execution: result?.execution || null,
    executionSummary: text(result?.executionSummary) || null,
    messages: state.histories.get("group") || [],
    sourceSummary: previousMeta?.sourceSummary || null,
    dispatchHistory: Array.isArray(result?.dispatchHistory) ? result.dispatchHistory : [],
    dispatchView: result?.dispatchView || null,
    threadView: result?.threadView || null,
    startupSignature: text(result?.startupSignature) || text(activeThreadStartupContext()?.startupSignature) || null,
  };
  state.historyMeta.set("group", meta);
  return true;
}

function applyDirectMessageRuntimeView(result = null, thread = null) {
  const threadId = text(result?.threadId || thread?.threadId);
  if (!threadId || text(thread?.threadKind) !== "direct") {
    return false;
  }
  if (!acceptsThreadStartupFromHistory(result)) {
    return false;
  }
  const sourceFilter = activeSourceFilter(threadId);
  const assistantSource = result?.message?.assistant?.source || result?.source || null;
  if (sourceFilter && text(assistantSource?.provider) !== text(sourceFilter)) {
    return false;
  }
  const recordId = text(result?.sync?.recordId) || `runtime-preview-${Date.now()}`;
  const userTurn = result?.user || result?.message?.user || null;
  const assistantTurn = result?.message?.assistant || null;
  const previewMessages = [
    text(userTurn?.content)
      ? {
          messageId: `${recordId}:user`,
          role: "user",
          author: text(userTurn?.author) || "Kane",
          content: text(userTurn.content),
          createdAt: text(userTurn?.createdAt) || new Date().toISOString(),
        }
      : null,
    text(assistantTurn?.content)
      ? {
          messageId: `${recordId}:assistant`,
          role: "assistant",
          author: text(assistantTurn?.author) || text(thread?.label) || "成员",
          agentId: text(assistantTurn?.agentId) || threadId,
          content: text(assistantTurn.content),
          createdAt: text(assistantTurn?.createdAt) || new Date().toISOString(),
          source: assistantSource,
        }
      : null,
  ].filter(Boolean);
  if (!previewMessages.length) {
    return false;
  }
  const previousMeta = currentHistoryMeta(threadId) || null;
  const previousMessages = state.histories.get(threadId) || [];
  const nextMessages = [
    ...previousMessages.filter((entry) => !text(entry?.messageId).startsWith(`${recordId}:`)),
    ...previewMessages,
  ];
  state.histories.set(threadId, nextMessages);
  state.historyMeta.set(threadId, {
    threadId,
    threadKind: "direct",
    sourceFilter,
    runtimePreview: true,
    messages: nextMessages,
    sourceSummary: previousMeta?.sourceSummary || null,
    dispatchHistory: Array.isArray(result?.dispatchHistory) ? result.dispatchHistory : [],
    dispatchView: result?.dispatchView || null,
    threadView: result?.threadView || previousMeta?.threadView || null,
    startupSignature: text(result?.startupSignature) || text(previousMeta?.startupSignature) || null,
  });
  return true;
}

function resolveGroupMessageExecutionSummary(result = null) {
  return text(result?.executionSummary);
}

function resetProtectedThreadState(message) {
  resetProtectedThreadStateWithMode(message, { keepBootstrap: false });
}

function clearProtectedAccessState() {
  state.protectedAccessBlocked = false;
  state.protectedAccessMessage = "";
}

function setProtectedAccessState(message) {
  state.protectedAccessBlocked = true;
  state.protectedAccessMessage = text(message) || PROTECTED_ACCESS_REQUIRED_MESSAGE;
}

function friendlyOfflineChatSurface(path = "") {
  const normalized = String(path || "");
  if (normalized.includes("/sync")) {
    return "对话同步";
  }
  if (normalized.includes("/messages")) {
    return "对话消息";
  }
  if (normalized.includes("thread-startup-context")) {
    return "对话启动信息";
  }
  return "对话运行信息";
}

function formatOfflineChatAuthMessage(description = {}, storedToken = "") {
  if (!text(storedToken)) {
    return "当前还没有解锁。请先输入访问口令。";
  }
  if (description.category === "read_session_scope_denied") {
    return "当前访问口令权限不足，无法访问本地对话。请重新输入。";
  }
  return "当前访问口令无法访问本地对话。请重新输入。";
}

function renderPublicBootstrapState(message) {
  const normalized = text(message) || PROTECTED_ACCESS_REQUIRED_MESSAGE;
  showNotice(normalized, { level: "warning" });
  renderThreadList();
  renderThreadSurface();
  renderSyncStatus();
  renderControlAvailability();
}

function resetProtectedThreadStateWithMode(message, { keepBootstrap = false } = {}) {
  if (state.autoSyncTimer) {
    window.clearInterval(state.autoSyncTimer);
    state.autoSyncTimer = null;
  }
  state.histories.clear();
  state.historyMeta.clear();
  state.historyLoading.clear();
  state.historyRequestVersions.clear();
  state.historyFilters.clear();
  state.sync = keepBootstrap ? state.bootstrap?.sync || null : null;
  state.sending = false;
  state.syncing = false;
  state.bootstrapping = false;
  state.lastAutoSyncAt = 0;
  if (keepBootstrap && state.bootstrap && state.threads.length) {
    setProtectedAccessState(message);
    renderPublicBootstrapState(message);
    return;
  }
  clearProtectedAccessState();
  state.bootstrap = null;
  state.threads = [];
  state.activeThreadId = "group";
  renderFatalState(message);
}

function handleOfflineChatUnauthorized(
  storedToken,
  { statusCode = 401, path = "对话授权资料", backendError = "", errorClass = "", readSessionReason = "" } = {}
) {
  const description = describeProtectedReadFailure({
    surface: friendlyOfflineChatSurface(path),
    statusCode,
    hasStoredAdminToken: Boolean(text(storedToken)),
    operation: "访问",
    backendError,
    errorClass,
    readSessionReason,
    missingTokenAction: `请先输入访问口令，再解锁${OFFLINE_THREAD_RECOVERY_SCOPE_LABEL}。`,
  });
  const message = formatOfflineChatAuthMessage(description, storedToken);
  renderAuthState(message);
  setProtectedAccessState(message);
  renderPublicBootstrapState(message);
  return message;
}

function resetOfflineChatUnauthorized(
  storedToken,
  { statusCode = 401, path = "对话授权资料", backendError = "", errorClass = "", readSessionReason = "" } = {}
) {
  const description = describeProtectedReadFailure({
    surface: friendlyOfflineChatSurface(path),
    statusCode,
    hasStoredAdminToken: Boolean(text(storedToken)),
    operation: "访问",
    backendError,
    errorClass,
    readSessionReason,
    missingTokenAction: `请先输入访问口令，再解锁${OFFLINE_THREAD_RECOVERY_SCOPE_LABEL}。`,
  });
  const message = `${formatOfflineChatAuthMessage(description, storedToken)} 已清除刚保存的访问口令。`;
  setStoredAdminToken("");
  renderAuthState(message);
  resetProtectedThreadState(message);
  return message;
}

function handleOfflineChatForbidden(
  storedToken,
  { statusCode = 403, path = "对话授权资料", backendError = "", errorClass = "", readSessionReason = "" } = {}
) {
  const description = describeProtectedReadFailure({
    surface: friendlyOfflineChatSurface(path),
    statusCode,
    hasStoredAdminToken: Boolean(text(storedToken)),
    operation: "访问",
    backendError,
    errorClass,
    readSessionReason,
  });
  const message = formatOfflineChatAuthMessage(description, storedToken);
  renderAuthState(message);
  setProtectedAccessState(message);
  renderPublicBootstrapState(message);
  return message;
}

function resolveSourceLabel(provider, summary = null) {
  const normalizedProvider = text(provider);
  if (!normalizedProvider) {
    return "全部来源";
  }
  const providers = Array.isArray(summary?.providers) ? summary.providers : [];
  const matched = providers.find((entry) => text(entry?.provider) === normalizedProvider);
  if (matched?.label) {
    return humanizeConversationText(matched.label);
  }
  return humanizeConversationText(providerLabel(normalizedProvider));
}

async function request(path, options = {}) {
  const { headers = {}, resetOnUnauthorized = false, cache = "no-store", ...restOptions } = options;
  const storedToken = getStoredAdminToken();
  const response = await fetch(path, {
    ...restOptions,
    cache,
    headers: buildAdminTokenHeaders({ token: storedToken, headers }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      const unauthorizedMessage = resetOnUnauthorized
        ? resetOfflineChatUnauthorized(storedToken, {
            statusCode: response.status,
            path,
            backendError: payload?.error,
            errorClass: payload?.errorClass,
            readSessionReason: payload?.security?.readSessionReason,
          })
        : handleOfflineChatUnauthorized(storedToken, {
            statusCode: response.status,
            path,
            backendError: payload?.error,
            errorClass: payload?.errorClass,
            readSessionReason: payload?.security?.readSessionReason,
          });
      const unauthorizedError = new Error(unauthorizedMessage);
      unauthorizedError.status = response.status;
      unauthorizedError.code = OFFLINE_CHAT_UNAUTHORIZED_ERROR_CODE;
      unauthorizedError.offlineChatUnauthorized = true;
      unauthorizedError.offlineChatHandled = true;
      unauthorizedError.offlineChatStoredToken = storedToken;
      throw unauthorizedError;
    }
    if (response.status === 403) {
      const forbiddenMessage = resetOnUnauthorized
        ? handleOfflineChatForbidden(storedToken, {
            statusCode: response.status,
            path,
            backendError: payload?.error,
            errorClass: payload?.errorClass,
            readSessionReason: payload?.security?.readSessionReason,
          })
        : handleOfflineChatForbidden(storedToken, {
            statusCode: response.status,
            path,
            backendError: payload?.error,
            errorClass: payload?.errorClass,
            readSessionReason: payload?.security?.readSessionReason,
          });
      const forbiddenError = new Error(forbiddenMessage);
      forbiddenError.status = response.status;
      forbiddenError.code = OFFLINE_CHAT_FORBIDDEN_ERROR_CODE;
      forbiddenError.offlineChatForbidden = true;
      forbiddenError.offlineChatHandled = true;
      forbiddenError.offlineChatStoredToken = storedToken;
      throw forbiddenError;
    }
    throw new Error(payload?.error || `请求失败（${response.status}）`);
  }
  return payload;
}

function activeThread() {
  return state.threads.find((entry) => entry.threadId === state.activeThreadId) || state.threads[0] || null;
}

function ensureThreadStartupCache() {
  if (!state.bootstrap || typeof state.bootstrap !== "object") {
    state.bootstrap = {};
  }
  if (!state.bootstrap.threadStartup || typeof state.bootstrap.threadStartup !== "object") {
    state.bootstrap.threadStartup = {};
  }
  return state.bootstrap.threadStartup;
}

async function refreshGroupThreadStartupContext({ requestVersion = null, requestThreadId = "group", failSoft = true } = {}) {
  try {
    const startupContext = await request("/api/offline-chat/thread-startup-context?phase=phase_1");
    if (requestVersion != null && !isCurrentThreadHistoryRequest(requestThreadId, requestVersion)) {
      return activeThreadStartupContext();
    }
    ensureThreadStartupCache().phase_1 = startupContext;
    invalidateBootstrapThreadView("group");
    invalidateBootstrapThreadHistory("group");
    return startupContext;
  } catch (error) {
    if (!failSoft || isOfflineChatProtectedAccessError(error)) {
      throw error;
    }
    console.warn("[offline-chat] failed to refresh group thread startup context", error);
    return activeThreadStartupContext();
  }
}

function activeThreadStartupContext() {
  return state.bootstrap?.threadStartup?.phase_1 || null;
}

function acceptsThreadStartupFromHistory(history = null, startupContext = activeThreadStartupContext()) {
  if (!history?.threadStartup || typeof history.threadStartup !== "object") {
    return false;
  }
  const historySignature = text(history?.startupSignature);
  const startupSignature = text(history.threadStartup?.startupSignature);
  const canonicalSignature = text(startupContext?.startupSignature);
  if (!historySignature || !startupSignature || !canonicalSignature) {
    return false;
  }
  if (historySignature !== startupSignature || historySignature !== canonicalSignature) {
    return false;
  }
  const historyPhaseKey = text(history.threadStartup?.phaseKey);
  const canonicalPhaseKey = text(startupContext?.phaseKey);
  if (!historyPhaseKey || !canonicalPhaseKey || historyPhaseKey !== canonicalPhaseKey) {
    return false;
  }
  const historyProtocol = history.threadStartup?.threadProtocol || null;
  const canonicalProtocol = startupContext?.threadProtocol || null;
  const historyProtocolKey = text(historyProtocol?.protocolKey);
  const canonicalProtocolKey = text(canonicalProtocol?.protocolKey);
  const historyProtocolVersion = text(historyProtocol?.protocolVersion || history.threadStartup?.protocolVersion);
  const canonicalProtocolVersion = text(canonicalProtocol?.protocolVersion || startupContext?.protocolVersion);
  if (!historyProtocolKey || !canonicalProtocolKey || historyProtocolKey !== canonicalProtocolKey) {
    return false;
  }
  if (!historyProtocolVersion || !canonicalProtocolVersion || historyProtocolVersion !== canonicalProtocolVersion) {
    return false;
  }
  return true;
}

function createOfflineChatStartupMismatchError(threadId = "", phaseKey = "phase_1") {
  const normalizedThreadId = text(threadId) || "group";
  const error = new Error(`对话启动状态已变化，已拒收 ${normalizedThreadId} 的旧历史记录和临时预览，请刷新后重试。`);
  error.code = OFFLINE_CHAT_STARTUP_MISMATCH_ERROR_CODE;
  error.threadId = normalizedThreadId;
  error.phaseKey = text(phaseKey) || "phase_1";
  return error;
}

function activeGroupDispatchHistory() {
  return Array.isArray(currentHistoryMeta("group")?.dispatchHistory)
    ? currentHistoryMeta("group").dispatchHistory
    : [];
}

function activeSubagentPlan() {
  return Array.isArray(activeThreadStartupContext()?.subagentPlan)
    ? activeThreadStartupContext().subagentPlan
    : [];
}

function bootstrapPersonas() {
  return Array.isArray(state.bootstrap?.personas) ? state.bootstrap.personas : [];
}

function listPersonaAgentIds(persona = null) {
  return [
    text(persona?.agent?.routeAgentId),
    text(persona?.agent?.agentId),
    text(persona?.agent?.resolvedResidentAgentId),
  ].filter(Boolean);
}

function findPersonaByAgentId(agentId) {
  const normalized = text(agentId);
  if (!normalized) {
    return null;
  }
  return (
    bootstrapPersonas().find((entry) => listPersonaAgentIds(entry).includes(normalized)) ||
    null
  );
}

function normalizeParticipant(entry = {}) {
  return {
    agentId: text(entry?.agentId || entry?.agent?.agentId) || null,
    displayName: text(entry?.displayName || entry?.label) || null,
    title: text(entry?.title) || null,
    role: text(entry?.role) || null,
    currentGoal: text(entry?.currentGoal || entry?.coreMission) || null,
  };
}

function startupParticipants() {
  const startup = activeThreadStartupContext();
  return dedupeParticipants([
    ...(Array.isArray(startup?.coreParticipants) ? startup.coreParticipants : []),
    ...(Array.isArray(startup?.supportParticipants) ? startup.supportParticipants : []),
  ])
    .map((entry) => normalizeParticipant(entry))
    .filter((entry) => entry.displayName || entry.agentId);
}

function resolveGroupParticipants(thread = activeThread()) {
  const startup = startupParticipants();
  if (startup.length) {
    return startup;
  }
  const threadParticipants = Array.isArray(thread?.participants)
    ? dedupeParticipants(thread.participants)
        .map((entry) => normalizeParticipant(entry))
        .filter((entry) => entry.displayName || entry.agentId)
    : [];
  if (threadParticipants.length) {
    return threadParticipants;
  }
  return dedupeParticipants(bootstrapPersonas())
    .map((entry) => normalizeParticipant(entry))
    .filter((entry) => entry.displayName || entry.agentId);
}

function resolveGroupMemberCount(thread = activeThread()) {
  const startup = activeThreadStartupContext();
  return Number(
    startup?.groupThread?.memberCount ||
      thread?.memberCount ||
      resolveGroupParticipants(thread).length ||
      bootstrapPersonas().length ||
      0
  );
}

function summarizeDirectThreadParticipant(thread = null) {
  const persona = findPersonaByAgentId(
    directThreadRouteId(thread) || text(thread?.agentId || thread?.threadId)
  );
  if (!persona) {
    return null;
  }
  return normalizeParticipant({
    agentId: persona?.agent?.agentId,
    displayName: persona?.displayName || thread?.label,
    title: persona?.title || thread?.title,
    role: persona?.role || thread?.role,
    currentGoal: persona?.currentGoal,
  });
}

function clearNotice() {
  if (!elements.runtimeNotice) {
    return;
  }
  elements.runtimeNotice.hidden = true;
  elements.runtimeNotice.textContent = "";
  elements.runtimeNotice.removeAttribute("data-level");
}

function renderThreadSurface() {
  renderThreadHeader();
  renderThreadContext();
  renderDispatchHistory();
  renderSourceSidebar();
  renderMessages();
}

function showNotice(message, { level = "warning" } = {}) {
  const normalized = humanizeConversationText(message);
  if (!elements.runtimeNotice || !normalized) {
    clearNotice();
    return;
  }
  elements.runtimeNotice.hidden = false;
  elements.runtimeNotice.dataset.level = level;
  elements.runtimeNotice.textContent = normalized;
}

function isOfflineChatUnauthorizedError(error) {
  if (error?.offlineChatUnauthorized === true || error?.code === OFFLINE_CHAT_UNAUTHORIZED_ERROR_CODE || error?.status === 401) {
    return true;
  }
  const message = text(error?.message || error);
  return OFFLINE_CHAT_UNAUTHORIZED_MESSAGES.has(message);
}

function isOfflineChatProtectedAccessError(error) {
  return (
    isOfflineChatUnauthorizedError(error) ||
    error?.offlineChatForbidden === true ||
    error?.code === OFFLINE_CHAT_FORBIDDEN_ERROR_CODE ||
    error?.status === 403
  );
}

function isOfflineChatStartupMismatchError(error) {
  return text(error?.code) === OFFLINE_CHAT_STARTUP_MISMATCH_ERROR_CODE;
}

function describeOfflineChatStartupMismatch(threadId = null) {
  const normalizedThreadId = text(threadId) || "group";
  const thread = findThreadByRouteId(normalizedThreadId) || state.threads.find((entry) => text(entry?.threadId) === normalizedThreadId) || null;
  const threadLabel =
    normalizedThreadId === "group"
      ? text(thread?.label) || "当前群聊"
      : text(thread?.label) || normalizedThreadId || "当前对话";
  return `对话启动状态已变化，${humanizeConversationText(threadLabel)} 的旧记录已作废，请刷新后重试。`;
}

function handleOfflineChatStartupMismatch(error, { threadId = null } = {}) {
  if (!isOfflineChatStartupMismatchError(error)) {
    return false;
  }
  const mismatchedThreadId = text(error?.threadId || threadId) || "group";
  invalidateThreadHistoryState(mismatchedThreadId);
  showNotice(describeOfflineChatStartupMismatch(mismatchedThreadId), { level: "warning" });
  return true;
}

function resolveComposerPlaceholder(thread = activeThread()) {
  return thread?.threadKind === "group" ? GROUP_COMPOSER_PLACEHOLDER : DIRECT_COMPOSER_PLACEHOLDER;
}

function renderControlAvailability({ fatal = false } = {}) {
  const hasToken = hasStoredAdminToken();
  const busy = state.sending || state.syncing || state.bootstrapping || state.historyLoading.size > 0;
  const blocked = state.protectedAccessBlocked;
  const threadReady = Boolean(activeThread()) && !fatal && !state.bootstrapping && hasToken && !blocked;
  const syncReady = Boolean(currentSyncView()) && !fatal && !state.bootstrapping && hasToken && !blocked;

  elements.composerInput.disabled = !threadReady;
  elements.composerInput.placeholder = threadReady
    ? resolveComposerPlaceholder()
    : !fatal && Boolean(activeThread()) && !state.bootstrapping && (!hasToken || blocked)
      ? PROTECTED_COMPOSER_PLACEHOLDER
      : DISABLED_COMPOSER_PLACEHOLDER;
  elements.sendButton.disabled = !threadReady || state.sending;
  if (!threadReady) {
    elements.sendButton.textContent = "不可用";
  } else if (!state.sending) {
    elements.sendButton.textContent = "发送";
  }

  elements.syncButton.disabled = !syncReady || state.syncing;
  if (!syncReady) {
    elements.syncButton.textContent = "同步不可用";
  } else if (!state.syncing) {
    elements.syncButton.textContent = "立即同步";
  }

  if (elements.refreshButton) {
    elements.refreshButton.disabled = busy;
    elements.refreshButton.textContent = state.bootstrapping ? "刷新中…" : "刷新";
  }
}

function renderFatalState(message) {
  const normalized = text(message) || "当前对话不可用。";
  if (state.autoSyncTimer) {
    window.clearInterval(state.autoSyncTimer);
    state.autoSyncTimer = null;
  }
  clearProtectedAccessState();
  state.histories.clear();
  state.historyMeta.clear();
  state.historyLoading.clear();
  state.historyRequestVersions.clear();
  state.historyFilters.clear();
  state.bootstrap = null;
  state.threads = [];
  state.activeThreadId = "group";
  state.sync = null;
  state.sending = false;
  state.syncing = false;
  state.bootstrapping = false;
  state.lastAutoSyncAt = 0;
  elements.stackChip.textContent = "本地引擎：当前不可确认";
  showNotice(normalized, { level: "error" });
  elements.threadList.innerHTML = '<div class="empty-state">当前没有可用对话。</div>';
  elements.threadTitle.textContent = "对话暂不可用";
  elements.threadDescription.textContent = "当前没有拿到对话信息，请先解锁后再继续。";
  elements.threadPill.textContent = "需要解锁";
  elements.threadContextSummary.textContent = "当前无法确认对话成员。";
  elements.threadContextList.innerHTML = '<div class="empty-state">成员信息暂不可用。</div>';
  if (elements.dispatchHistorySummary) {
    elements.dispatchHistorySummary.textContent = "当前无法确认分配记录。";
  }
  if (elements.dispatchHistoryList) {
    elements.dispatchHistoryList.innerHTML = '<div class="empty-state">分配记录暂不可用。</div>';
  }
  elements.sourceFilterSummary.textContent = "当前无法确认回复方式。";
  elements.sourceFilterList.innerHTML = "";
  elements.syncStatus.innerHTML = `<div>${escapeHtml(normalized)}</div>`;
  elements.messages.innerHTML = `<div class="empty-state">${escapeHtml(normalized)}</div>`;
  renderControlAvailability({ fatal: true });
}

function resolveThreadParallelizationPolicy(startup = null) {
  const policy = Array.isArray(startup?.parallelizationPolicy)
    ? startup.parallelizationPolicy.map((entry) => text(entry)).filter(Boolean)
    : [];
  return policy.length
    ? policy
    : ["先确认目标、边界、验收和关键依赖，再决定是否需要多人同时回复。"];
}

function findStartupSubagentPlanEntry(participant = null) {
  const agentId = text(participant?.agentId || participant?.threadId);
  const role = text(participant?.role);
  return (
    activeSubagentPlan().find(
      (entry) =>
        (agentId && text(entry?.agentId) === agentId) ||
        (role && text(entry?.role) === role)
    ) || null
  );
}

function labelSubagentStage(value) {
  const labels = {
    intake: "主控 intake",
    scoping: "范围收口",
    solutioning: "方案收口",
    implementation: "实现并行",
    assurance: "验证并行",
    continuous_support: "持续支持",
    manual_review: "待主控分配",
  };
  return labels[text(value)] || text(value) || "";
}

function labelSubagentDispatchMode(value) {
  const labels = {
    serial_gatekeeper: "主控先判断",
    serial_first_then_handoff: "先确认再分配",
    parallel_candidate: "可同时回复",
    support_only: "支持位",
    manual_only: "人工确认",
  };
  return labels[text(value)] || text(value) || "";
}

function buildThreadContextCard(title, meta, lines = []) {
  const body = (Array.isArray(lines) ? lines : []).filter(Boolean);
  return `
    <article class="thread-context-card">
      <div class="thread-context-name">${escapeHtml(humanizeConversationText(title || "对话信息"))}</div>
      <div class="thread-context-meta">${escapeHtml(humanizeConversationText(meta || "成员信息"))}</div>
      <div class="thread-context-goal">${body.map((line) => `<div>${escapeHtml(humanizeConversationText(line))}</div>`).join("")}</div>
    </article>
  `;
}

function renderLineGroup(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => humanizeConversationText(line))
    .filter(Boolean)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");
}

function renderThreadContextCards(cards = []) {
  return (Array.isArray(cards) ? cards : [])
    .map((card) =>
      buildThreadContextCard(
        text(card?.title) || "对话信息",
        text(card?.meta) || "成员信息",
        Array.isArray(card?.lines) ? card.lines : []
      )
    )
    .join("");
}

function formatDispatchBatchLabel(batchId) {
  if (batchId === "merge") {
    return "收口批";
  }
  return Number.isFinite(Number(batchId)) ? `第 ${Number(batchId)} 批` : "";
}

function labelDispatchExecutionMode(value) {
  const labels = {
    automatic_fanout: "自动多人回复",
    serial_fallback: "依次回复",
    parallel: "同时回复",
    serial: "依次回复",
  };
  return labels[text(value)] || text(value) || "";
}

function resolveDispatchHistoryModeLabel(execution = null, dispatch = null) {
  const executionMode = text(execution?.executionMode);
  if (executionMode) {
    return labelDispatchExecutionMode(executionMode);
  }
  if (dispatch?.parallelAllowed === true) {
    return "允许多人回复";
  }
  if (dispatch && typeof dispatch === "object") {
    return "先确认";
  }
  return "";
}

function summarizeDispatchHistoryRoleReasons(selectedRoles = [], limit = 3) {
  const roles = Array.isArray(selectedRoles) ? selectedRoles : [];
  const parts = roles
    .slice(0, limit)
    .map((entry) => {
      const name = text(entry?.displayName || entry?.role || "角色");
      const reason = Array.isArray(entry?.activationReasons)
        ? text(entry.activationReasons[0])
        : "";
      return name && reason ? `${name}：${reason}` : name;
    })
    .filter(Boolean);
  if (!parts.length) {
    return "";
  }
  return roles.length > limit ? `${parts.join("；")} 等 ${roles.length} 个角色` : parts.join("；");
}

function summarizeDispatchHistoryBlockedRoles(blockedRoles = [], limit = 2) {
  const roles = Array.isArray(blockedRoles) ? blockedRoles : [];
  const parts = roles
    .slice(0, limit)
    .map((entry) => {
      const name = text(entry?.displayName || entry?.role || "角色");
      const reason = text(entry?.reason);
      return name && reason ? `${name}：${reason}` : name;
    })
    .filter(Boolean);
  if (!parts.length) {
    return "";
  }
  return roles.length > limit ? `${parts.join("；")} 等 ${roles.length} 个角色` : parts.join("；");
}

function summarizeDispatchHistoryParallelBatches(batchPlan = [], limit = 2) {
  const batches = (Array.isArray(batchPlan) ? batchPlan : []).filter(
    (entry) => text(entry?.executionMode) === "parallel"
  );
  const parts = batches
    .slice(0, limit)
    .map((entry) => {
      const batchLabel = formatDispatchBatchLabel(entry?.batchId);
      const roleNames = (Array.isArray(entry?.roles) ? entry.roles : [])
        .map((role) => text(role?.displayName || role?.role))
        .filter(Boolean)
        .join("、");
      return batchLabel && roleNames ? `${batchLabel}（${roleNames}）` : batchLabel || roleNames;
    })
    .filter(Boolean);
  if (!parts.length) {
    return "";
  }
  return batches.length > limit ? `${parts.join("；")} 等 ${batches.length} 个并行批次` : parts.join("；");
}

function syncDispatchHistoryVisibility(thread = activeThread()) {
  if (!elements.dispatchHistorySection) {
    return;
  }
  const dispatchView = thread ? currentDispatchView(thread.threadId) : null;
  elements.dispatchHistorySection.hidden =
    dispatchView?.hidden === true ? true : Boolean(thread) && thread.threadKind !== "group";
}

function renderDispatchHistory() {
  if (!elements.dispatchHistorySummary || !elements.dispatchHistoryList) {
    return;
  }
  const thread = activeThread();
  const dispatchView = thread ? currentDispatchView(thread.threadId) : null;
  syncDispatchHistoryVisibility(thread);
  if (!thread) {
    elements.dispatchHistorySummary.textContent = "当前没有可用对话。";
    elements.dispatchHistoryList.innerHTML = "";
    return;
  }
  if (thread.threadKind !== "group") {
    return;
  }

  const historyMeta = currentHistoryMeta(thread.threadId);
  if (!historyMeta) {
    elements.dispatchHistorySummary.textContent = state.protectedAccessBlocked
      ? state.protectedAccessMessage
      : "正在读取最近几轮多人回复记录…";
    elements.dispatchHistoryList.innerHTML = "";
    return;
  }

  const history = activeGroupDispatchHistory();
  if (!history.length) {
    const summaryLines =
      Array.isArray(dispatchView?.summaryLines) && dispatchView.summaryLines.length > 0
        ? dispatchView.summaryLines
        : ["当前还没有可展示的分配记录。"];
    elements.dispatchHistorySummary.innerHTML = renderLineGroup(summaryLines);
    elements.dispatchHistoryList.innerHTML = `<div class="empty-state">${escapeHtml(
      humanizeConversationText(dispatchView?.emptyText) || "发起一轮群聊后，这里会显示主控分配和多人回复记录。"
    )}</div>`;
    return;
  }

  // 并行配置状态由服务端对话视图提供，本地回退不再自行重算。
  const summaryLines =
    Array.isArray(dispatchView?.summaryLines) && dispatchView.summaryLines.length > 0
      ? dispatchView.summaryLines
      : [
          `最近展示 ${history.length} 轮分配记录。`,
          "多人回复状态以服务端记录为准。",
        ];
  elements.dispatchHistorySummary.innerHTML = renderLineGroup(summaryLines);

  elements.dispatchHistoryList.innerHTML = history
    .map((entry) => {
      const dispatch = entry?.dispatch || null;
      const execution = entry?.execution || null;
      const selectedNames = (Array.isArray(dispatch?.selectedRoles) ? dispatch.selectedRoles : [])
        .map((role) => text(role?.displayName || role?.role))
        .filter(Boolean)
        .join("、");
      const selectedReasons = summarizeDispatchHistoryRoleReasons(dispatch?.selectedRoles);
      const blockedSummary = summarizeDispatchHistoryBlockedRoles(dispatch?.blockedRoles);
      const parallelBatchSummary = summarizeDispatchHistoryParallelBatches(dispatch?.batchPlan);
      const executionSummary = text(execution?.summary) || "";
      const dispatchSummary = text(dispatch?.summary || entry?.summary);
      const modeLabel = resolveDispatchHistoryModeLabel(execution, dispatch);
      const chipRows = [
        modeLabel ? { label: modeLabel, className: "" } : null,
        Number(entry?.parallelBatchCount || 0) > 0
          ? { label: `${Number(entry.parallelBatchCount)} 个同时回复批次`, className: "parallel" }
          : null,
        Number(entry?.blockedRoleCount || 0) > 0
          ? { label: `${Number(entry.blockedRoleCount)} 个暂缓角色`, className: "blocked" }
          : null,
        Number(entry?.selectedRoleCount || 0) > 0
          ? { label: `${Number(entry.selectedRoleCount)} 个参与角色`, className: "" }
          : null,
      ]
        .filter(Boolean)
        .map(
          (chip) =>
            `<span class="dispatch-chip ${escapeHtml(chip.className || "")}">${escapeHtml(chip.label || "")}</span>`
        )
        .join("");
      const bodyLines = [
        dispatchSummary ? `分配：${humanizeConversationText(dispatchSummary)}` : "",
        text(entry?.userText) ? `输入：${truncateText(entry.userText, 88)}` : "",
        selectedNames ? `参与：${selectedNames}` : "",
        selectedReasons ? `原因：${humanizeConversationText(truncateText(selectedReasons, 140))}` : "",
        blockedSummary ? `暂缓：${humanizeConversationText(truncateText(blockedSummary, 140))}` : "",
        parallelBatchSummary ? `同时回复：${humanizeConversationText(parallelBatchSummary)}` : "",
        executionSummary && executionSummary !== dispatchSummary ? `回复：${humanizeConversationText(executionSummary)}` : "",
      ].filter(Boolean);

      return `
        <article class="dispatch-history-card" data-record-id="${escapeHtml(text(entry?.recordId))}" data-parallel-batch-count="${escapeHtml(String(Number(entry?.parallelBatchCount || 0)))}">
          <div class="dispatch-history-head">
            <div>
              <div class="dispatch-history-title">${escapeHtml(`${formatTime(entry?.recordedAt)} · 第 ${Number(entry?.historyIndex || 0)} 轮`)}</div>
              <div class="dispatch-history-meta">${escapeHtml(`第 ${Number(entry?.responseCount || 0)} 条回复记录`)}</div>
            </div>
          </div>
          ${chipRows ? `<div class="dispatch-chip-row">${chipRows}</div>` : ""}
          <div class="dispatch-history-body">
            ${bodyLines
              .map((line, index) => `<div class="dispatch-history-line ${index === 1 ? "muted" : ""}">${escapeHtml(line)}</div>`)
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function summarizeSubagentPlanEntry(planEntry = null) {
  if (!planEntry) {
    return "";
  }
  const stage = labelSubagentStage(planEntry.activationStage);
  const mode = labelSubagentDispatchMode(planEntry.dispatchMode);
  const batch = Number.isFinite(Number(planEntry.dispatchBatch))
    ? `批次 ${Number(planEntry.dispatchBatch)}`
    : "";
  return [stage, mode, batch].filter(Boolean).join(" · ");
}

function renderThreadContext() {
  const thread = activeThread();
  if (!thread) {
    elements.threadContextSummary.textContent = "当前没有可用对话。";
    elements.threadContextList.innerHTML = "";
    return;
  }

  const threadView = currentThreadView(thread.threadId);
  const threadContext = threadView?.context || null;
  const viewSummaryLines = Array.isArray(threadContext?.summaryLines) ? threadContext.summaryLines : [];
  const viewCards = Array.isArray(threadContext?.cards) ? threadContext.cards : [];
  if (viewSummaryLines.length > 0 || viewCards.length > 0) {
    elements.threadContextSummary.innerHTML = renderLineGroup(viewSummaryLines);
    elements.threadContextList.innerHTML = viewCards.length
      ? renderThreadContextCards(viewCards)
      : '<div class="empty-state">当前对话成员信息还没准备好。</div>';
    return;
  }

  if (thread.threadKind === "group") {
    const startup = activeThreadStartupContext();
    const participants = resolveGroupParticipants(thread);
    const memberCount = resolveGroupMemberCount(thread);
    const coreCount = Number(startup?.coreParticipantCount || 0);
    const supportCount = Number(startup?.supportParticipantCount || 0);
    const protocolTitle = text(startup?.threadProtocol?.title || startup?.protocolVersion);
    const protocolSummary = text(startup?.protocolSummary || startup?.threadProtocol?.protocolSummary);
    const protocolActivatedAt = text(startup?.protocolActivatedAt || startup?.threadProtocol?.protocolActivatedAt);
    const parallelizationPolicy = resolveThreadParallelizationPolicy(startup);
    const latestDispatch = currentHistoryMeta("group")?.dispatch || null;
    const latestExecutionSummary = text(currentHistoryMeta("group")?.executionSummary);
    const summaryLines = [
      `当前对话共有 ${memberCount} 位成员。`,
      formatGroupComposition(coreCount, supportCount),
      protocolTitle && protocolSummary
        ? `当前协作规则：${humanizeConversationText(protocolTitle)}。${humanizeConversationText(protocolSummary)}`
        : "",
      protocolActivatedAt ? `规则生效时间：${formatTime(protocolActivatedAt)}。` : "",
      `推进方式：${parallelizationPolicy[0]}`,
      "配置状态：等待服务端提供多人回复配置。",
      latestExecutionSummary ? `最近回复：${humanizeConversationText(latestExecutionSummary)}` : "最近回复：当前还没有可展示的分配结果。",
    ];
    elements.threadContextSummary.innerHTML = renderLineGroup(summaryLines);
    const policyCard = buildThreadContextCard("协作规则", "当前对话配置", [
      protocolTitle ? `当前规则：${protocolTitle}` : "",
      protocolSummary ? `默认方式：${protocolSummary}` : "",
      protocolActivatedAt ? `生效时间：${formatTime(protocolActivatedAt)}` : "",
      ...parallelizationPolicy,
      "多人回复配置由服务端提供，本页只负责展示。",
    ]);
    const executionCard = buildThreadContextCard("最近回复", "最近一轮分配结果", [
      latestExecutionSummary || "当前还没有可展示的分配结果。",
      latestDispatch?.recordedAt ? `记录时间：${formatTime(latestDispatch.recordedAt)}` : "",
    ]);
    elements.threadContextList.innerHTML = participants.length
      ? [
          policyCard,
          executionCard,
          ...participants.map((entry) => {
            const planEntry = findStartupSubagentPlanEntry(entry);
            const subagentMeta = summarizeSubagentPlanEntry(planEntry);
            const meta = [text(entry?.title), text(entry?.role), subagentMeta].filter(Boolean).join(" · ");
            return `
              <article class="thread-context-card">
                <div class="thread-context-name">${escapeHtml(entry?.displayName || "成员")}</div>
                <div class="thread-context-meta">${escapeHtml(humanizeConversationText(meta || "对话成员"))}</div>
                <div class="thread-context-goal">${escapeHtml(humanizeConversationText(entry?.currentGoal || entry?.coreMission || "当前职责信息读取中。"))}</div>
              </article>
            `;
          }),
        ].join("")
      : `${policyCard}${executionCard}<div class="empty-state">当前对话成员信息还没准备好。</div>`;
    return;
  }

  const participant = summarizeDirectThreadParticipant(thread);
  const planEntry = findStartupSubagentPlanEntry(participant || thread);
  const subagentMeta = summarizeSubagentPlanEntry(planEntry);
  elements.threadContextSummary.innerHTML = [
    "<div>当前对话只包含 1 位成员。</div>",
    "<div>成员职责见下。</div>",
  ].join("");
  elements.threadContextList.innerHTML = participant
    ? `
      <article class="thread-context-card">
        <div class="thread-context-name">${escapeHtml(participant.displayName || thread.label || "成员")}</div>
        <div class="thread-context-meta">${escapeHtml(humanizeConversationText([participant.title, participant.role, subagentMeta].filter(Boolean).join(" · ") || "对话成员"))}</div>
        <div class="thread-context-goal">${escapeHtml(humanizeConversationText(participant.currentGoal || "当前职责信息读取中。"))}</div>
      </article>
    `
    : '<div class="empty-state">当前对话成员信息还没准备好。</div>';
}

function setNetworkStatus() {
  const online = navigator.onLine;
  elements.networkChip.textContent = online ? "网络状态：已联网" : "网络状态：离线中";
  elements.networkChip.classList.toggle("offline", !online);
}

function renderThreadList() {
  const activeId = state.activeThreadId;
  elements.threadList.innerHTML = state.threads
    .map((thread) => {
      const active = thread.threadId === activeId ? "active" : "";
      const availabilitySummary = text(thread?.availability?.summary);
      const meta =
        thread.threadKind === "group"
          ? `群聊 · ${availabilitySummary || `${resolveGroupMemberCount(thread)} 位成员`}`
          : `${summarizeDirectThreadParticipant(thread)?.title || thread.title || "单聊"} · ${availabilitySummary || (thread.did ? "身份已就绪" : "等待身份")}`;
      return `
        <button class="thread-button ${active}" data-thread-id="${escapeHtml(thread.threadId)}" data-action-role="select" data-action-scope="offline-thread" type="button">
          <div class="thread-label">${escapeHtml(humanizeConversationText(thread.label))}</div>
          <div class="thread-meta">${escapeHtml(humanizeConversationText(meta))}</div>
        </button>
      `;
    })
    .join("");

  for (const button of elements.threadList.querySelectorAll("[data-thread-id]")) {
    button.addEventListener("click", async () => {
      const threadId = button.getAttribute("data-thread-id");
      if (!threadId || threadId === state.activeThreadId) {
        return;
      }
      const previousThreadId = state.activeThreadId;
      const needsReload = !hasResolvedThreadHistory(threadId);
      const historySnapshot = needsReload ? captureThreadHistorySnapshot(threadId) : null;
      try {
        state.activeThreadId = threadId;
        syncUrlState({ historyMode: "push" });
        if (needsReload) {
          clearThreadHistorySnapshot(threadId, { preserveResolved: true });
        }
        renderThreadList();
        renderThreadSurface();
        await loadThreadHistory(threadId);
        renderThreadSurface();
        clearNotice();
      } catch (error) {
        const startupMismatch = handleOfflineChatStartupMismatch(error, { threadId });
        if (needsReload && !startupMismatch) {
          restoreThreadHistorySnapshot(threadId, historySnapshot);
        }
        state.activeThreadId = previousThreadId;
        syncUrlState({ historyMode: "replace" });
        renderThreadList();
        renderThreadSurface();
        if (startupMismatch) {
          return;
        }
        showNotice(`切换对话失败：${error.message}。当前页面可能不是最新状态。`, { level: "error" });
      }
    });
  }
}

function renderThreadHeader() {
  const thread = activeThread();
  if (!thread) {
    elements.threadTitle.textContent = "对话暂不可用";
    elements.threadDescription.textContent = "没有可用对话。";
    elements.threadPill.textContent = "等待初始化";
    renderControlAvailability({ fatal: true });
    return;
  }

  const viewHeader = currentThreadView(thread.threadId)?.header || null;
  if (viewHeader) {
    elements.threadTitle.textContent = humanizeConversationText(viewHeader.title) || humanizeConversationText(thread.label) || "对话记录";
    elements.threadDescription.textContent =
      humanizeConversationText(viewHeader.description) || "当前对话信息正在刷新。";
    elements.threadPill.textContent = humanizeConversationText(viewHeader.pill) || (thread.threadKind === "group" ? "群聊" : "单聊");
    elements.composerHint.textContent =
      humanizeConversationText(viewHeader.composerHint) ||
      (thread.threadKind === "group"
        ? "发送后会先判断谁需要回复。"
        : `发送后会保存到本地，并只发给 ${humanizeConversationText(thread.label)}。`);
    renderControlAvailability();
    return;
  }

  const activeFilter = activeSourceFilter(thread.threadId || state.activeThreadId);

  if (thread.threadKind === "group") {
    const memberCount = resolveGroupMemberCount(thread);
    const participants = resolveGroupParticipants(thread);
    const dispatchLead = "发送后会先判断谁需要回复。";
    elements.threadTitle.textContent = "我们的群聊";
    elements.threadDescription.textContent = activeFilter
      ? `当前是 ${memberCount} 人对话，正在只看「${resolveSourceLabel(activeFilter, currentHistoryMeta(thread.threadId)?.sourceSummary)}」方式的回复。`
      : `当前是 ${memberCount} 人对话。${dispatchLead}`;
    elements.threadPill.textContent = activeFilter ? `${memberCount} 人对话 · 已筛选` : `${memberCount} 人对话`;
    elements.composerHint.textContent =
      `当前成员：${formatParticipantNames(participants)}。发送后会先判断谁需要回复。`;
    renderControlAvailability();
    return;
  }

  elements.threadTitle.textContent = humanizeConversationText(thread.label);
  elements.threadDescription.textContent = activeFilter
    ? `你正在与 ${humanizeConversationText(thread.label)} 单聊，当前只看「${resolveSourceLabel(activeFilter, currentHistoryMeta(thread.threadId)?.sourceSummary)}」的回复。`
    : `你正在与 ${humanizeConversationText(thread.label)} 单聊。消息只会发给对方。`;
  elements.threadPill.textContent = activeFilter ? "单聊 · 已筛选" : "单聊";
  elements.composerHint.textContent = `发送后会保存到本地，并只发给 ${humanizeConversationText(thread.label)}。`;
  renderControlAvailability();
}

function renderMessages() {
  const thread = activeThread();
  if (!thread) {
    elements.messages.innerHTML = '<div class="empty-state">当前没有可用对话。</div>';
    return;
  }

  const history = state.histories.get(thread.threadId) || [];
  if (isHistoryLoading(thread.threadId) && !history.length) {
    elements.messages.innerHTML = '<div class="empty-state">正在读取当前对话…</div>';
    return;
  }

  const activeFilter = activeSourceFilter(thread.threadId);
  if (!history.length) {
    if (state.protectedAccessBlocked) {
      elements.messages.innerHTML = `<div class="empty-state">${escapeHtml(state.protectedAccessMessage)}</div>`;
      return;
    }
    elements.messages.innerHTML = activeFilter
      ? `<div class="empty-state">当前回复方式「${escapeHtml(resolveSourceLabel(activeFilter, currentHistoryMeta(thread.threadId)?.sourceSummary))}」下还没有消息。</div>`
      : '<div class="empty-state">这里还没有消息。你现在可以发第一句。</div>';
    return;
  }

  elements.messages.innerHTML = history
    .map(
      (message) => `
        <article
          class="message ${message.role === "user" ? "user" : "assistant"}"
          data-message-id="${escapeHtml(text(message.messageId))}"
          data-source-provider="${escapeHtml(text(message.source?.provider))}"
          data-dispatch-batch="${escapeHtml(text(message.dispatchBatch ?? message.source?.dispatch?.batchId))}"
          data-dispatch-mode="${escapeHtml(text(message.executionMode || message.source?.dispatch?.executionMode))}"
        >
          <div class="message-head">
            <div class="message-author">${escapeHtml(humanizeConversationText(message.author || "消息"))}</div>
            <div class="message-time">${escapeHtml(formatTime(message.createdAt))}</div>
          </div>
          <div class="message-body">${escapeHtml(message.content || "")}</div>
          ${message.role === "assistant" ? renderMessageMeta(message.source) : ""}
        </article>
      `
    )
    .join("");

  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function renderSourceSidebar() {
  const thread = activeThread();
  if (!thread) {
    elements.sourceFilterSummary.textContent = "当前没有可用对话。";
    elements.sourceFilterList.innerHTML = "";
    return;
  }

  const sourceSummary = currentSourceSummary(thread.threadId);
  if (!sourceSummary) {
    elements.sourceFilterSummary.textContent = state.protectedAccessBlocked
      ? state.protectedAccessMessage
      : isHistoryLoading(thread.threadId)
        ? "正在读取当前对话的回复方式…"
        : currentHistoryMeta(thread.threadId)
          ? "回复方式会在读取对话记录后显示。"
          : "当前还没有可用的回复方式。";
    elements.sourceFilterList.innerHTML = "";
    return;
  }

  const activeFilter = activeSourceFilter(thread.threadId);
  const totalAssistantMessages = Number(sourceSummary.assistantMessageCount || 0);
  const filteredAssistantMessages = Number(sourceSummary.filteredAssistantMessageCount || 0);
  const activeFilterLabel = activeFilter ? resolveSourceLabel(activeFilter, sourceSummary) : "全部回复";
  const summaryLines = [
    `当前共有 ${totalAssistantMessages} 条回复。`,
    activeFilter
      ? `当前只看「${activeFilterLabel}」，共 ${filteredAssistantMessages} 条。`
      : "当前显示全部回复。",
  ];
  elements.sourceFilterSummary.innerHTML = summaryLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");

  const filterButtons = [
    {
      provider: "",
      label: "全部回复",
      count: totalAssistantMessages,
      latestAt: null,
    },
    ...(Array.isArray(sourceSummary.providers) ? sourceSummary.providers : []),
  ];

  elements.sourceFilterList.innerHTML = filterButtons
    .map((entry) => {
      const provider = text(entry.provider);
      const isActive = (!provider && !activeFilter) || provider === activeFilter;
      const latestAt = entry.latestAt ? ` · 最近 ${formatTime(entry.latestAt)}` : "";
      return `
        <button class="source-filter-button ${isActive ? "active" : ""}" data-source-filter="${escapeHtml(provider)}" data-action-role="select" data-action-scope="message-source" type="button">
          <span class="source-filter-label">${escapeHtml(humanizeConversationText(entry.label || resolveSourceLabel(provider, sourceSummary)))}</span>
          <span class="source-filter-meta">${escapeHtml(`${Number(entry.count || 0)} 条回复${latestAt}`)}</span>
        </button>
      `;
    })
    .join("");

  for (const button of elements.sourceFilterList.querySelectorAll("[data-source-filter]")) {
    button.addEventListener("click", async () => {
      const provider = button.getAttribute("data-source-filter") || "";
      const threadId = activeThread()?.threadId || state.activeThreadId;
      const normalized = text(provider) || null;
      if ((activeSourceFilter(threadId) || null) === normalized) {
        return;
      }
      const previousFilter = activeSourceFilter(threadId);
      const historySnapshot = captureThreadHistorySnapshot(threadId);
      try {
        setActiveSourceFilter(threadId, normalized);
        syncUrlState({ historyMode: "push" });
        clearThreadHistorySnapshot(threadId);
        renderThreadSurface();
        await loadThreadHistory(threadId, { force: true });
        renderThreadSurface();
        clearNotice();
      } catch (error) {
        const startupMismatch = handleOfflineChatStartupMismatch(error, { threadId });
        if (!startupMismatch) {
          restoreThreadHistorySnapshot(threadId, historySnapshot);
        }
        setActiveSourceFilter(threadId, previousFilter);
        syncUrlState({ historyMode: "replace" });
        renderThreadSurface();
        if (startupMismatch) {
          return;
        }
        showNotice(`切换查看范围失败：${error.message}。当前内容可能不是最新值。`, { level: "error" });
      }
    });
  }
}

function renderSyncStatus() {
  const sync = currentSyncView();
  if (!sync) {
    elements.syncStatus.innerHTML = state.protectedAccessBlocked
      ? `<div>${escapeHtml(state.protectedAccessMessage || PROTECTED_ACCESS_REQUIRED_MESSAGE)}</div>`
      : `<div>${escapeHtml(state.bootstrapping ? "正在读取同步状态…" : "同步状态暂不可用。")}</div>`;
    renderControlAvailability();
    return;
  }

  const lines =
    Array.isArray(sync.viewLines) && sync.viewLines.length > 0
      ? sync.viewLines
      : (() => {
          const fallback = [];
          if (sync.pendingCount > 0) {
            fallback.push(`待同步本地记录：${sync.pendingCount} 条`);
          } else {
            fallback.push("离线记录已同步或当前没有待同步内容。");
          }

          if (sync.endpointConfigured && sync.endpoint) {
            fallback.push(`在线入口：${sync.endpoint}`);
          } else {
            fallback.push("当前还没有配置在线接收入口；本地记录会先保存在本机暂存区。");
          }

          if (sync.status === "delivered") {
            fallback.push("最近一次同步已成功送达在线入口。");
          } else if (sync.status === "delivery_failed") {
            fallback.push("最近一次同步失败，系统会在联网状态下继续重试。");
          } else if (sync.status === "awaiting_remote_endpoint") {
            fallback.push("如果要自动回灌到在线版，需要配置在线同步入口。");
          } else if (sync.status === "ready_to_sync") {
            fallback.push("当前已经具备自动同步条件。");
          }

          if (sync.localReceiptStatus === "recorded_with_warnings") {
            fallback.push("在线入口已收到，本地确认记录有告警，但不会把这批已送达记录再次当成待同步。");
          } else if (sync.localReceiptStatus === "at_risk") {
            fallback.push("在线入口已收到，但本地确认记录没有完整保存，后续可能重复同步同一批记录。");
          }
          if (Array.isArray(sync.localReceiptWarnings) && sync.localReceiptWarnings.length > 0) {
            fallback.push(`本地确认记录告警：${sync.localReceiptWarnings.length} 条。`);
          }
          return fallback;
        })();

  elements.syncStatus.innerHTML = renderLineGroup(lines);
  renderControlAvailability();
}

function currentSyncView() {
  return state.sync || state.bootstrap?.sync || null;
}

async function loadThreadHistory(threadId, { force = false } = {}) {
  const requestedFilter = activeSourceFilter(threadId);
  const cached = state.historyMeta.get(threadId);
  const requestedThread =
    findThreadByRouteId(threadId) ||
    state.threads.find((entry) => text(entry?.threadId) === text(threadId)) ||
    null;
  const requestThreadId =
    requestedThread && text(requestedThread?.threadKind) === "direct"
      ? requireDirectThreadRouteId(requestedThread)
      : text(threadId) || "group";
  let startupContext = activeThreadStartupContext();
  if (
    !force &&
    cached &&
    cached.runtimePreview !== true &&
    text(cached.sourceFilter) === text(requestedFilter) &&
    matchesThreadHistoryStartupContext(cached, startupContext)
  ) {
    state.historyLoading.delete(threadId);
    return cached.messages || [];
  }
  const requestVersion = nextThreadHistoryRequestVersion(threadId);
  state.historyLoading.add(threadId);
  try {
    const params = new URLSearchParams({ limit: "120" });
    if (requestedFilter) {
      params.set("sourceProvider", requestedFilter);
    }
    const history = await request(
      `/api/offline-chat/threads/${encodeURIComponent(requestThreadId)}/messages?${params.toString()}`
    );
    if (!isCurrentThreadHistoryRequest(threadId, requestVersion)) {
      return state.histories.get(threadId) || [];
    }
    if (text(activeSourceFilter(threadId)) !== text(requestedFilter)) {
      return state.histories.get(threadId) || [];
    }
    let historyAccepted = acceptsThreadStartupFromHistory(history, startupContext);
    if (!historyAccepted) {
      startupContext = await refreshGroupThreadStartupContext({ requestVersion, requestThreadId: threadId, failSoft: false });
      if (!isCurrentThreadHistoryRequest(threadId, requestVersion)) {
        return state.histories.get(threadId) || [];
      }
      if (text(activeSourceFilter(threadId)) !== text(requestedFilter)) {
        return state.histories.get(threadId) || [];
      }
      historyAccepted = acceptsThreadStartupFromHistory(history, startupContext);
    }
    if (!historyAccepted) {
      invalidateThreadHistoryState(threadId);
      throw createOfflineChatStartupMismatchError(threadId, history?.threadStartup?.phaseKey);
    }
    state.historyMeta.set(threadId, history);
    state.histories.set(threadId, history.messages || []);
    clearProtectedAccessState();
    return history.messages || [];
  } finally {
    if (isCurrentThreadHistoryRequest(threadId, requestVersion)) {
      state.historyLoading.delete(threadId);
    }
  }
}

async function applyUrlState(urlState = {}, { forceHistoryReload = false, syncHistory = false } = {}) {
  const nextThreadId = resolveThreadId(urlState.threadId);
  state.activeThreadId = nextThreadId;
  setActiveSourceFilter(nextThreadId, urlState.sourceProvider);
  const needsReload = forceHistoryReload || !hasResolvedThreadHistory(nextThreadId);
  const historySnapshot = needsReload ? captureThreadHistorySnapshot(nextThreadId) : null;
  if (needsReload) {
    clearThreadHistorySnapshot(nextThreadId, {
      preserveResolved: forceHistoryReload ? false : true,
    });
  }
  if (syncHistory) {
    syncUrlState({ historyMode: "replace" });
  }
  renderThreadList();
  renderThreadSurface();
  try {
    await loadThreadHistory(nextThreadId, { force: forceHistoryReload });
  } catch (error) {
    const startupMismatch = handleOfflineChatStartupMismatch(error, { threadId: nextThreadId });
    if (needsReload && !startupMismatch) {
      restoreThreadHistorySnapshot(nextThreadId, historySnapshot);
    }
    if (startupMismatch) {
      renderThreadSurface();
    }
    throw error;
  }
  renderThreadSurface();
}

async function refreshSyncStatus() {
  state.sync = await request("/api/offline-chat/sync/status");
  renderSyncStatus();
}

async function bootstrap({ resetOnUnauthorized = false, throwProtectedAccessError = false } = {}) {
  const requestVersion = nextBootstrapRequestVersion();
  state.bootstrapping = true;
  renderControlAvailability();
  try {
    const payload = await request("/api/offline-chat/bootstrap", { resetOnUnauthorized });
    if (!isCurrentBootstrapRequest(requestVersion)) {
      return;
    }
    state.bootstrap = payload;
    state.threads = Array.isArray(payload.threads) ? payload.threads : [];
    state.sync = payload.sync || null;
    if (!state.threads.length) {
      throw new Error("当前没有可用对话。");
    }
    elements.stackChip.textContent = formatStackChip(payload.localReasoner);
    renderSyncStatus();
    try {
      await applyUrlState(readUrlState(), { forceHistoryReload: true, syncHistory: true });
      if (!isCurrentBootstrapRequest(requestVersion)) {
        return;
      }
      clearProtectedAccessState();
      clearNotice();
    } catch (error) {
      throw error;
    }
  } catch (error) {
    if (isOfflineChatProtectedAccessError(error)) {
      if (isCurrentBootstrapRequest(requestVersion)) {
        if (error.offlineChatHandled) {
          // request() already rendered the protected-access state for this failure.
        } else if (isOfflineChatUnauthorizedError(error)) {
          handleOfflineChatUnauthorized(error.offlineChatStoredToken);
        } else {
          handleOfflineChatForbidden(error.offlineChatStoredToken);
        }
      }
      if (throwProtectedAccessError) {
        throw error;
      }
      return;
    }
    throw error;
  } finally {
    if (isCurrentBootstrapRequest(requestVersion)) {
      state.bootstrapping = false;
      renderControlAvailability();
    }
  }
}

async function sendMessage(event) {
  event.preventDefault();
  if (state.sending) {
    return;
  }

  const content = text(elements.composerInput.value);
  if (!content) {
    return;
  }

  const thread = activeThread();
  if (!thread?.threadId) {
    showNotice("当前没有可用对话，暂时无法发送。", { level: "error" });
    return;
  }

  state.sending = true;
  elements.sendButton.disabled = true;
  elements.sendButton.textContent = "发送中…";

  let result = null;
  try {
    const requestThreadId =
      text(thread?.threadKind) === "direct"
        ? requireDirectThreadRouteId(thread)
        : text(thread?.threadId);
    result = await request(`/api/offline-chat/threads/${encodeURIComponent(requestThreadId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  } catch (error) {
    if (isOfflineChatProtectedAccessError(error)) {
      return;
    }
    showNotice(`发送失败：${error.message}`, { level: "error" });
    return;
  } finally {
    state.sending = false;
    renderControlAvailability();
  }

  elements.composerInput.value = "";
  const appliedRuntimeView =
    thread.threadKind === "group"
      ? applyGroupMessageRuntimeView(result)
      : applyDirectMessageRuntimeView(result, thread);
  if (appliedRuntimeView) {
    renderThreadSurface();
  }

  const postWriteWarnings = [];
  try {
    await loadThreadHistory(thread.threadId, { force: true });
    renderThreadSurface();
  } catch (error) {
    if (isOfflineChatProtectedAccessError(error)) {
      return;
    }
    if (isOfflineChatStartupMismatchError(error)) {
      postWriteWarnings.push(`消息已写入，但${describeOfflineChatStartupMismatch(thread.threadId)}`);
      renderThreadSurface();
    } else {
      postWriteWarnings.push(`消息已写入，但刷新对话历史失败：${error.message}`);
    }
    if (!appliedRuntimeView) {
      renderThreadSurface();
    }
  }

  try {
    await maybeAutoSync({ force: true });
  } catch (error) {
    if (isOfflineChatProtectedAccessError(error)) {
      return;
    }
    postWriteWarnings.push(`消息已写入，但同步状态刷新失败：${error.message}`);
  }

  const executionSummary = thread.threadKind === "group" ? resolveGroupMessageExecutionSummary(result) : "";
  if (postWriteWarnings.length > 0) {
    showNotice(postWriteWarnings.join("；"), { level: "warning" });
  } else if (thread.threadKind === "group" && text(executionSummary || result?.dispatch?.summary)) {
    showNotice(executionSummary || result.dispatch.summary, { level: "warning" });
  } else {
    clearNotice();
  }
}

async function flushSync() {
  if (state.syncing) {
    return;
  }
  state.syncing = true;
  elements.syncButton.disabled = true;
  elements.syncButton.textContent = "同步中…";
  try {
    state.sync = await request("/api/offline-chat/sync/flush", {
      method: "POST",
      body: JSON.stringify({ trigger: "ui" }),
    });
    renderSyncStatus();
    clearNotice();
  } catch (error) {
    if (isOfflineChatProtectedAccessError(error)) {
      return;
    }
    showNotice(`同步失败：${error.message}`, { level: "error" });
  } finally {
    state.syncing = false;
    renderControlAvailability();
  }
}

async function maybeAutoSync({ force = false } = {}) {
  if (!hasStoredAdminToken()) {
    return;
  }
  if (!navigator.onLine) {
    return;
  }
  const now = Date.now();
  if (!force && now - state.lastAutoSyncAt < 20000) {
    return;
  }
  state.lastAutoSyncAt = now;
  await refreshSyncStatus();
  if (!state.sync || state.sync.pendingCount <= 0) {
    return;
  }
  if (!state.sync.endpointConfigured) {
    return;
  }
  await flushSync();
}

function startAutoSyncLoop() {
  if (state.autoSyncTimer) {
    window.clearInterval(state.autoSyncTimer);
  }
  state.autoSyncTimer = window.setInterval(() => {
    maybeAutoSync().catch((error) => {
      if (!isOfflineChatProtectedAccessError(error)) {
        showNotice(`自动同步失败：${error.message}`, { level: "warning" });
      }
      console.error("[offline-chat] auto sync failed", error);
    });
  }, 30000);
}

async function init() {
  migrateLegacyAdminToken();
  renderAuthState();
  setNetworkStatus();
  await bootstrap();
  startAutoSyncLoop();
  await maybeAutoSync();
  renderControlAvailability();
}

elements.composer.addEventListener("submit", sendMessage);
elements.authTokenForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = text(elements.authTokenInput?.value);
  if (!token) {
    renderAuthState("请先输入访问口令，再解锁对话。");
    showNotice("请先输入访问口令。", { level: "error" });
    return;
  }
  setStoredAdminToken(token);
  if (elements.authTokenInput) {
    elements.authTokenInput.value = "";
  }
  renderAuthState("正在解锁本地对话。");
  try {
    await bootstrap({ resetOnUnauthorized: true, throwProtectedAccessError: true });
    startAutoSyncLoop();
    await maybeAutoSync({ force: true });
    renderAuthState();
    clearNotice();
  } catch (error) {
    if (isOfflineChatProtectedAccessError(error)) {
      return;
    }
    if (handleOfflineChatStartupMismatch(error, { threadId: state.activeThreadId })) {
      renderThreadSurface();
      return;
    }
    renderAuthState("已保存访问口令，但当前还不能读取本地对话。");
    showNotice(`解锁失败：${error.message}`, { level: "error" });
  }
});
elements.authClearButton?.addEventListener("click", () => {
  if (elements.authTokenInput) {
    elements.authTokenInput.value = "";
  }
  setStoredAdminToken("");
  renderAuthState("本次浏览已重新锁定。");
  resetProtectedThreadState(`本次浏览未保存访问口令；${OFFLINE_THREAD_RUNTIME_SCOPE_LABEL}需要重新输入后才能继续。`);
});
elements.syncButton.addEventListener("click", () => {
  flushSync().catch((error) => {
    if (isOfflineChatProtectedAccessError(error)) {
      return;
    }
    showNotice(`同步失败：${error.message}`, { level: "error" });
  });
});
elements.refreshButton.addEventListener("click", async () => {
  try {
    await bootstrap();
    await refreshSyncStatus();
    renderThreadSurface();
    clearNotice();
  } catch (error) {
    if (isOfflineChatProtectedAccessError(error)) {
      return;
    }
    if (handleOfflineChatStartupMismatch(error, { threadId: state.activeThreadId })) {
      renderThreadSurface();
      return;
    }
    showNotice(`刷新失败：${error.message}。当前视图可能不是最新值。`, { level: "error" });
  }
});
window.addEventListener("online", () => {
  setNetworkStatus();
  maybeAutoSync({ force: true }).catch((error) => {
    if (!isOfflineChatProtectedAccessError(error)) {
      showNotice(`自动同步失败：${error.message}`, { level: "warning" });
    }
    console.error("[offline-chat] online sync failed", error);
  });
});
window.addEventListener("offline", setNetworkStatus);
window.addEventListener("popstate", () => {
  applyUrlState(readUrlState(), { forceHistoryReload: true }).catch((error) => {
    if (isOfflineChatProtectedAccessError(error)) {
      return;
    }
    if (isOfflineChatStartupMismatchError(error)) {
      return;
    }
    showNotice(`切换对话失败：${error.message}。当前页面可能不是最新状态。`, { level: "error" });
  });
});

init().catch((error) => {
  if (isOfflineChatProtectedAccessError(error)) {
    return;
  }
  if (handleOfflineChatStartupMismatch(error, { threadId: state.activeThreadId })) {
    renderThreadSurface();
    return;
  }
  renderFatalState(`对话记录启动失败：${error.message}`);
});

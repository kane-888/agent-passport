import {
  AGENT_PASSPORT_MEMORY_ENGINE_LABEL,
  AGENT_PASSPORT_LOCAL_REASONER_LABEL,
  AGENT_PASSPORT_LOCAL_STACK_NAME,
  buildAdminTokenAuthSummary,
  describeProtectedReadFailure,
  displayOpenNeedReasonerModel,
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

const OFFLINE_THREAD_RUNTIME_SCOPE_LABEL = "离线线程运行信息、线程历史、同步和发送消息";
const OFFLINE_THREAD_RECOVERY_SCOPE_LABEL = "线程运行信息、历史、同步与写入";
const DIRECT_COMPOSER_PLACEHOLDER = "在这里输入消息。单聊只发给当前成员。";
const GROUP_COMPOSER_PLACEHOLDER = "在这里输入消息。群聊会先交给主控，满足条件时再按计划放行需要的成员。";
const DISABLED_COMPOSER_PLACEHOLDER = "离线线程当前不可用，请先恢复线程运行信息后再发送。";
const PROTECTED_COMPOSER_PLACEHOLDER = "线程历史、同步和发送消息需要管理令牌，请先录入。";
const PROTECTED_ACCESS_REQUIRED_MESSAGE = `${OFFLINE_THREAD_RUNTIME_SCOPE_LABEL}都要求管理令牌，请先录入。`;
const OFFLINE_CHAT_UNAUTHORIZED_ERROR_CODE = "OFFLINE_CHAT_UNAUTHORIZED";
const OFFLINE_CHAT_FORBIDDEN_ERROR_CODE = "OFFLINE_CHAT_FORBIDDEN";
const OFFLINE_CHAT_UNAUTHORIZED_MESSAGES = new Set([
  PROTECTED_ACCESS_REQUIRED_MESSAGE,
  "当前标签页里的管理令牌无法访问离线线程受保护接口；请重新录入后再恢复线程运行信息。",
  "离线线程真值、线程历史、同步和发送消息都要求管理令牌",
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
        tokenStoreLabel: "当前标签页",
        savedDetail: `${OFFLINE_THREAD_RUNTIME_SCOPE_LABEL}会走受保护接口。`,
        missingDetail: `${OFFLINE_THREAD_RUNTIME_SCOPE_LABEL}需先录入。`,
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
  return "当前正在读取线程角色分布。";
}

function formatStackChip(localReasoner = null) {
  const provider = text(localReasoner?.provider) || "unknown";
  if (provider === "local_command") {
    const command = basename(localReasoner?.command) || "本地命令";
    return `${AGENT_PASSPORT_LOCAL_STACK_NAME}：${providerLabel(provider)} · ${command} · ${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}`;
  }
  if (provider === "ollama_local") {
    return `${AGENT_PASSPORT_LOCAL_STACK_NAME}：${providerLabel(provider)} · ${displayOpenNeedReasonerModel(localReasoner?.model)} · ${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}`;
  }
  if (provider === "openai_compatible") {
    return `${AGENT_PASSPORT_LOCAL_STACK_NAME}：${providerLabel(provider)} · ${text(localReasoner?.model) || "未命名模型"} · ${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}`;
  }
  if (provider === "local_mock") {
    return `${AGENT_PASSPORT_LOCAL_STACK_NAME}：${providerLabel(provider)} · 兜底本地回答引擎`;
  }
  return `${AGENT_PASSPORT_LOCAL_STACK_NAME}：${providerLabel(provider)} · ${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}`;
}

function formatMessageSource(source = null) {
  return formatRuntimeMessageSource(source);
}

function formatMessageDispatch(source = null) {
  return formatRuntimeMessageDispatch(source);
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

function resolveThreadId(threadId = null) {
  const requestedThreadId = text(threadId);
  return (
    state.threads.find((entry) => entry.threadId === requestedThreadId)?.threadId ||
    state.threads.find((entry) => entry.threadId === "group")?.threadId ||
    state.threads[0]?.threadId ||
    "group"
  );
}

function syncUrlState({ historyMode = "replace" } = {}) {
  const url = new URL(window.location.href);
  const thread = activeThread();
  const threadId = text(thread?.threadId) || text(state.activeThreadId) || "";
  const sourceProvider = activeSourceFilter(threadId);

  if (threadId) {
    url.searchParams.set("threadId", threadId);
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
      threadId: text(threadId) || null,
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
  acceptsThreadStartupFromHistory(result);
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
  acceptsThreadStartupFromHistory(result);
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
  return (
    text(result?.executionSummary) ||
    summarizeParallelSubagentExecution(result?.execution, result?.dispatch) ||
    text(result?.dispatch?.summary)
  );
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

function handleOfflineChatUnauthorized(storedToken, { statusCode = 401, path = "离线线程受保护接口", backendError = "" } = {}) {
  const hadToken = Boolean(text(storedToken));
  const description = describeProtectedReadFailure({
    surface: path,
    statusCode,
    hasStoredAdminToken: hadToken,
    operation: "访问",
    backendError,
    missingTokenAction: `请先录入管理令牌，再恢复${OFFLINE_THREAD_RECOVERY_SCOPE_LABEL}。`,
  });
  const message = `${description.authMessage} 本页运行信息已清空。`;
  if (hadToken) {
    setStoredAdminToken("");
    renderAuthState(`${description.authMessage} 本页离线线程运行信息已清空。`);
  } else {
    renderAuthState(description.authMessage);
  }
  resetProtectedThreadState(message);
  return message;
}

function handleOfflineChatForbidden(storedToken, { statusCode = 403, path = "离线线程受保护接口", backendError = "" } = {}) {
  const description = describeProtectedReadFailure({
    surface: path,
    statusCode,
    hasStoredAdminToken: Boolean(text(storedToken)),
    operation: "访问",
    backendError,
  });
  const message = `${description.authMessage} 本页保留当前令牌和已加载运行信息。`;
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
    return matched.label;
  }
  return providerLabel(normalizedProvider);
}

async function request(path, options = {}) {
  const { headers = {}, resetOnUnauthorized = true, cache = "no-store", ...restOptions } = options;
  const storedToken = getStoredAdminToken();
  const response = await fetch(path, {
    ...restOptions,
    cache,
    headers: {
      "Content-Type": "application/json",
      ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
      ...headers,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      const unauthorizedMessage = resetOnUnauthorized
        ? handleOfflineChatUnauthorized(storedToken, {
            statusCode: response.status,
            path,
            backendError: payload?.error,
          })
        : describeProtectedReadFailure({
            surface: path,
            statusCode: response.status,
            hasStoredAdminToken: Boolean(text(storedToken)),
            operation: "访问",
            backendError: payload?.error,
          }).authMessage;
      const unauthorizedError = new Error(unauthorizedMessage);
      unauthorizedError.status = response.status;
      unauthorizedError.code = OFFLINE_CHAT_UNAUTHORIZED_ERROR_CODE;
      unauthorizedError.offlineChatUnauthorized = true;
      unauthorizedError.offlineChatStoredToken = storedToken;
      throw unauthorizedError;
    }
    if (response.status === 403) {
      const forbiddenMessage = resetOnUnauthorized
        ? handleOfflineChatForbidden(storedToken, {
            statusCode: response.status,
            path,
            backendError: payload?.error,
          })
        : describeProtectedReadFailure({
            surface: path,
            statusCode: response.status,
            hasStoredAdminToken: Boolean(text(storedToken)),
            operation: "访问",
            backendError: payload?.error,
          }).authMessage;
      const forbiddenError = new Error(forbiddenMessage);
      forbiddenError.status = response.status;
      forbiddenError.code = OFFLINE_CHAT_FORBIDDEN_ERROR_CODE;
      forbiddenError.offlineChatForbidden = true;
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

async function refreshGroupThreadStartupContext({ requestVersion = null, failSoft = true } = {}) {
  try {
    const startupContext = await request("/api/offline-chat/thread-startup-context?phase=phase_1");
    if (requestVersion != null && !isCurrentThreadHistoryRequest("group", requestVersion)) {
      return activeThreadStartupContext();
    }
    ensureThreadStartupCache().phase_1 = startupContext;
    invalidateBootstrapThreadView("group");
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

function activeParallelSubagentPolicy() {
  return activeThreadStartupContext()?.parallelSubagentPolicy || null;
}

function activeLatestGroupDispatch() {
  return currentHistoryMeta("group")?.dispatch || null;
}

function activeLatestGroupExecution() {
  return currentHistoryMeta("group")?.execution || null;
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

function findPersonaByAgentId(agentId) {
  const normalized = text(agentId);
  if (!normalized) {
    return null;
  }
  return (
    bootstrapPersonas().find((entry) => text(entry?.agent?.agentId) === normalized) ||
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
  const persona = findPersonaByAgentId(thread?.agentId || thread?.threadId);
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
  const normalized = text(message);
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
    elements.refreshButton.textContent = state.bootstrapping ? "刷新中…" : "刷新状态";
  }
}

function renderFatalState(message) {
  const normalized = text(message) || "离线线程当前不可用。";
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
  elements.stackChip.textContent = "本地栈：当前不可确认";
  showNotice(normalized, { level: "error" });
  elements.threadList.innerHTML = '<div class="empty-state">当前没有可用线程。</div>';
  elements.threadTitle.textContent = "离线线程暂不可用";
  elements.threadDescription.textContent = "当前没有拿到线程上下文，请先恢复离线线程运行态后再继续。";
  elements.threadPill.textContent = "离线入口失败";
  elements.threadContextSummary.textContent = "当前无法确认线程成员。";
  elements.threadContextList.innerHTML = '<div class="empty-state">线程上下文暂不可用。</div>';
  if (elements.dispatchHistorySummary) {
    elements.dispatchHistorySummary.textContent = "当前无法确认调度历史。";
  }
  if (elements.dispatchHistoryList) {
    elements.dispatchHistoryList.innerHTML = '<div class="empty-state">调度历史暂不可用。</div>';
  }
  elements.sourceFilterSummary.textContent = "当前无法确认回答来源。";
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
    : ["先由主控串行收口目标、边界、验收和关键依赖，再决定是否并行。"];
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
    serial_gatekeeper: "串行闸门",
    serial_first_then_handoff: "先串后放行",
    parallel_candidate: "并行候选",
    support_only: "支持位",
    manual_only: "人工放行",
  };
  return labels[text(value)] || text(value) || "";
}

function summarizeParallelSubagentPolicy(policy = null) {
  if (!policy || policy.synced !== true) {
    return "";
  }
  const maxConcurrent = Number(policy?.maxConcurrentSubagents || 0);
  const eligibleCount = Number(policy?.parallelEligibleCount || 0);
  const executionMode = text(policy?.executionMode);
  const modeLead =
    executionMode === "automatic_fanout"
      ? "满足条件时自动 fan-out"
      : executionMode === "serial_fallback"
        ? "当前按串行回退准备"
        : "当前按主控闸门准备";
  return `当前线程已同步并行配置：${modeLead}，最多同时放行 ${maxConcurrent} 个角色，当前有 ${eligibleCount} 个并行候选角色。`;
}

function summarizeParallelSubagentExecution(execution = null, dispatch = null) {
  if (!execution || typeof execution !== "object") {
    return text(dispatch?.summary) || "";
  }
  if (["failed", "completed_with_errors"].includes(text(execution?.status)) && text(execution?.summary)) {
    return [
      text(execution?.summary),
      Array.isArray(dispatch?.blockedRoles) && dispatch.blockedRoles.length > 0
        ? `本轮暂缓 ${dispatch.blockedRoles.length} 个角色。`
        : "",
    ].filter(Boolean).join(" ");
  }
  const batches = Array.isArray(execution?.batches) ? execution.batches : [];
  if (!batches.length) {
    return text(dispatch?.summary) || "";
  }
  const completedBatchCount = batches.filter((entry) =>
    ["completed", "completed_with_errors"].includes(text(entry?.status))
  ).length;
  const blockedCount = Array.isArray(dispatch?.blockedRoles) ? dispatch.blockedRoles.length : 0;
  return [
    text(execution?.executionMode) === "automatic_fanout"
      ? `最近一轮 fan-out：完成 ${completedBatchCount}/${batches.length} 批。`
      : `最近一轮按串行回退执行：完成 ${completedBatchCount}/${batches.length} 批。`,
    blockedCount > 0 ? `本轮暂缓 ${blockedCount} 个角色。` : "",
    text(dispatch?.summary) || "",
  ].filter(Boolean).join(" ");
}

function buildThreadContextCard(title, meta, lines = []) {
  const body = (Array.isArray(lines) ? lines : []).filter(Boolean);
  return `
    <article class="thread-context-card">
      <div class="thread-context-name">${escapeHtml(title || "线程信息")}</div>
      <div class="thread-context-meta">${escapeHtml(meta || "线程上下文")}</div>
      <div class="thread-context-goal">${body.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
    </article>
  `;
}

function renderLineGroup(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => text(line))
    .filter(Boolean)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");
}

function renderThreadContextCards(cards = []) {
  return (Array.isArray(cards) ? cards : [])
    .map((card) =>
      buildThreadContextCard(
        text(card?.title) || "线程信息",
        text(card?.meta) || "线程上下文",
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
    automatic_fanout: "自动 fan-out",
    serial_fallback: "串行回退",
    parallel: "并行",
    serial: "串行",
  };
  return labels[text(value)] || text(value) || "";
}

function resolveDispatchHistoryModeLabel(execution = null, dispatch = null) {
  const executionMode = text(execution?.executionMode);
  if (executionMode) {
    return labelDispatchExecutionMode(executionMode);
  }
  if (dispatch?.parallelAllowed === true) {
    return "允许 fan-out";
  }
  if (dispatch && typeof dispatch === "object") {
    return "先串行收口";
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
    elements.dispatchHistorySummary.textContent = "当前没有可用线程。";
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
      : "正在读取最近几轮调度与执行记录…";
    elements.dispatchHistoryList.innerHTML = "";
    return;
  }

  const history = activeGroupDispatchHistory();
  if (!history.length) {
    const summaryLines =
      Array.isArray(dispatchView?.summaryLines) && dispatchView.summaryLines.length > 0
        ? dispatchView.summaryLines
        : ["当前还没有可展示的调度历史。"];
    elements.dispatchHistorySummary.innerHTML = renderLineGroup(summaryLines);
    elements.dispatchHistoryList.innerHTML = `<div class="empty-state">${escapeHtml(
      text(dispatchView?.emptyText) || "发起一轮群聊后，这里会显示放行、阻塞和批次执行记录。"
    )}</div>`;
    return;
  }

  const fallbackParallelRounds = history.filter((entry) => Number(entry?.parallelBatchCount || 0) > 0).length;
  const fallbackBlockedRounds = history.filter((entry) => Number(entry?.blockedRoleCount || 0) > 0).length;
  const fallbackLatest = history[0];
  const summaryLines =
    Array.isArray(dispatchView?.summaryLines) && dispatchView.summaryLines.length > 0
      ? dispatchView.summaryLines
      : [
          `最近展示 ${history.length} 轮调度。`,
          fallbackParallelRounds > 0 ? `${fallbackParallelRounds} 轮出现并行批次。` : "最近几轮没有出现并行批次。",
          fallbackBlockedRounds > 0 ? `${fallbackBlockedRounds} 轮有角色被暂缓。` : "最近几轮没有角色被暂缓。",
          fallbackLatest?.recordedAt ? `最新一轮发生在 ${formatTime(fallbackLatest.recordedAt)}。` : "",
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
          ? { label: `${Number(entry.parallelBatchCount)} 个并行批次`, className: "parallel" }
          : null,
        Number(entry?.blockedRoleCount || 0) > 0
          ? { label: `${Number(entry.blockedRoleCount)} 个暂缓角色`, className: "blocked" }
          : null,
        Number(entry?.selectedRoleCount || 0) > 0
          ? { label: `${Number(entry.selectedRoleCount)} 个放行角色`, className: "" }
          : null,
      ]
        .filter(Boolean)
        .map(
          (chip) =>
            `<span class="dispatch-chip ${escapeHtml(chip.className || "")}">${escapeHtml(chip.label || "")}</span>`
        )
        .join("");
      const bodyLines = [
        dispatchSummary ? `调度：${dispatchSummary}` : "",
        text(entry?.userText) ? `输入：${truncateText(entry.userText, 88)}` : "",
        selectedNames ? `放行：${selectedNames}` : "",
        selectedReasons ? `原因：${truncateText(selectedReasons, 140)}` : "",
        blockedSummary ? `暂缓：${truncateText(blockedSummary, 140)}` : "",
        parallelBatchSummary ? `并行批次：${parallelBatchSummary}` : "",
        executionSummary && executionSummary !== dispatchSummary ? `执行：${executionSummary}` : "",
      ].filter(Boolean);

      return `
        <article class="dispatch-history-card" data-record-id="${escapeHtml(text(entry?.recordId))}" data-parallel-batch-count="${escapeHtml(String(Number(entry?.parallelBatchCount || 0)))}">
          <div class="dispatch-history-head">
            <div>
              <div class="dispatch-history-title">${escapeHtml(`${formatTime(entry?.recordedAt)} · 第 ${Number(entry?.historyIndex || 0)} 轮`)}</div>
              <div class="dispatch-history-meta">${escapeHtml(`记录 ${text(entry?.recordId || "未知")} · ${Number(entry?.responseCount || 0)} 条回复`)}</div>
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
    elements.threadContextSummary.textContent = "当前没有可用线程。";
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
      : '<div class="empty-state">当前线程成员信息还没准备好。</div>';
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
    const parallelSubagentPolicy = activeParallelSubagentPolicy();
    const latestDispatch = activeLatestGroupDispatch();
    const latestExecution = activeLatestGroupExecution();
    const parallelSubagentSummary = summarizeParallelSubagentPolicy(parallelSubagentPolicy);
    const latestExecutionSummary = summarizeParallelSubagentExecution(latestExecution, latestDispatch);
    const summaryLines = [
      `当前线程共有 ${memberCount} 位成员。`,
      formatGroupComposition(coreCount, supportCount),
      protocolTitle && protocolSummary
        ? `当前协议：${protocolTitle}。${protocolSummary}`
        : "",
      protocolActivatedAt ? `协议生效时间：${formatTime(protocolActivatedAt)}。` : "",
      `推进方式：${parallelizationPolicy[0]}`,
      parallelSubagentSummary ? `启动配置：${parallelSubagentSummary}` : "",
      latestExecutionSummary ? `最近执行：${latestExecutionSummary}` : "最近执行：当前还没有可展示的调度结果。",
    ];
    elements.threadContextSummary.innerHTML = renderLineGroup(summaryLines);
    const policyCard = buildThreadContextCard("协作公约", "当前线程启动配置", [
      protocolTitle ? `当前协议：${protocolTitle}` : "",
      protocolSummary ? `默认规则：${protocolSummary}` : "",
      protocolActivatedAt ? `生效时间：${formatTime(protocolActivatedAt)}` : "",
      ...parallelizationPolicy,
      parallelSubagentSummary,
    ]);
    const executionCard = buildThreadContextCard("最近执行", "最近一轮调度结果", [
      latestExecutionSummary || "当前还没有可展示的调度结果。",
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
                <div class="thread-context-meta">${escapeHtml(meta || "线程成员")}</div>
                <div class="thread-context-goal">${escapeHtml(entry?.currentGoal || entry?.coreMission || "当前职责信息读取中。")}</div>
              </article>
            `;
          }),
        ].join("")
      : `${policyCard}${executionCard}<div class="empty-state">当前线程成员信息还没准备好。</div>`;
    return;
  }

  const participant = summarizeDirectThreadParticipant(thread);
  const planEntry = findStartupSubagentPlanEntry(participant || thread);
  const subagentMeta = summarizeSubagentPlanEntry(planEntry);
  elements.threadContextSummary.innerHTML = [
    "<div>当前线程只包含 1 位成员。</div>",
    "<div>成员职责见下。</div>",
  ].join("");
  elements.threadContextList.innerHTML = participant
    ? `
      <article class="thread-context-card">
        <div class="thread-context-name">${escapeHtml(participant.displayName || thread.label || "成员")}</div>
        <div class="thread-context-meta">${escapeHtml([participant.title, participant.role, subagentMeta].filter(Boolean).join(" · ") || "线程成员")}</div>
        <div class="thread-context-goal">${escapeHtml(participant.currentGoal || "当前职责信息读取中。")}</div>
      </article>
    `
    : '<div class="empty-state">当前线程成员信息还没准备好。</div>';
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
        <button class="thread-button ${active}" data-thread-id="${escapeHtml(thread.threadId)}" type="button">
          <div class="thread-label">${escapeHtml(thread.label)}</div>
          <div class="thread-meta">${escapeHtml(meta)}</div>
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
        if (needsReload) {
          restoreThreadHistorySnapshot(threadId, historySnapshot);
        }
        state.activeThreadId = previousThreadId;
        syncUrlState({ historyMode: "replace" });
        renderThreadList();
        renderThreadSurface();
        showNotice(`切换线程失败：${error.message}。当前视图可能不是最新值。`, { level: "error" });
      }
    });
  }
}

function renderThreadHeader() {
  const thread = activeThread();
  if (!thread) {
    elements.threadTitle.textContent = "离线线程";
    elements.threadDescription.textContent = "没有可用线程。";
    elements.threadPill.textContent = "等待初始化";
    renderControlAvailability({ fatal: true });
    return;
  }

  const viewHeader = currentThreadView(thread.threadId)?.header || null;
  if (viewHeader) {
    elements.threadTitle.textContent = text(viewHeader.title) || thread.label || "离线线程";
    elements.threadDescription.textContent =
      text(viewHeader.description) || "当前线程运行信息正在刷新。";
    elements.threadPill.textContent = text(viewHeader.pill) || (thread.threadKind === "group" ? "群聊" : "单聊");
    elements.composerHint.textContent =
      text(viewHeader.composerHint) ||
      (thread.threadKind === "group"
        ? "发送后会先经过主控闸门，满足条件时再由需要的成员回应。"
        : `发送后会写回本地记忆，并只发给 ${thread.label}。`);
    renderControlAvailability();
    return;
  }

  const activeFilter = activeSourceFilter(thread.threadId || state.activeThreadId);

  if (thread.threadKind === "group") {
    const memberCount = resolveGroupMemberCount(thread);
    const participants = resolveGroupParticipants(thread);
    const policy = activeParallelSubagentPolicy();
    const dispatchLead = policy?.synced
      ? `当前由主控先判断，满足条件时才按计划放行需要的成员回应。最多并行 ${Number(policy?.maxConcurrentSubagents || 1)} 个角色。`
      : "当前由主控先判断，满足条件时才按计划放行需要的成员回应。";
    elements.threadTitle.textContent = "我们的群聊";
    elements.threadDescription.textContent = activeFilter
      ? `当前是 ${memberCount} 人线程，正在只看「${resolveSourceLabel(activeFilter, currentHistoryMeta(thread.threadId)?.sourceSummary)}」来源的回复。`
      : `当前是 ${memberCount} 人线程。${dispatchLead}`;
    elements.threadPill.textContent = activeFilter ? `${memberCount} 人线程 · 已筛选` : `${memberCount} 人线程`;
    elements.composerHint.textContent =
      `当前成员：${formatParticipantNames(participants)}。发送后会先经过主控闸门，满足条件时再由需要的成员回应。`;
    renderControlAvailability();
    return;
  }

  elements.threadTitle.textContent = thread.label;
  elements.threadDescription.textContent = activeFilter
    ? `你正在与 ${thread.label} 单聊，当前只看「${resolveSourceLabel(activeFilter, currentHistoryMeta(thread.threadId)?.sourceSummary)}」的回复。`
    : `你正在与 ${thread.label} 单聊。消息只会发给对方。`;
  elements.threadPill.textContent = activeFilter ? "单聊 · 已筛选" : "单聊";
  elements.composerHint.textContent = `发送后会写回本地记忆，并只发给 ${thread.label}。`;
  renderControlAvailability();
}

function renderMessages() {
  const thread = activeThread();
  if (!thread) {
    elements.messages.innerHTML = '<div class="empty-state">当前没有可用线程。</div>';
    return;
  }

  const history = state.histories.get(thread.threadId) || [];
  if (isHistoryLoading(thread.threadId) && !history.length) {
    elements.messages.innerHTML = '<div class="empty-state">正在读取当前线程记录…</div>';
    return;
  }

  const activeFilter = activeSourceFilter(thread.threadId);
  if (!history.length) {
    if (state.protectedAccessBlocked) {
      elements.messages.innerHTML = `<div class="empty-state">${escapeHtml(state.protectedAccessMessage)}</div>`;
      return;
    }
    elements.messages.innerHTML = activeFilter
      ? `<div class="empty-state">当前来源筛选「${escapeHtml(resolveSourceLabel(activeFilter, currentHistoryMeta(thread.threadId)?.sourceSummary))}」下还没有消息。</div>`
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
            <div class="message-author">${escapeHtml(message.author || "消息")}</div>
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
    elements.sourceFilterSummary.textContent = "当前没有可用线程。";
    elements.sourceFilterList.innerHTML = "";
    return;
  }

  const sourceSummary = currentSourceSummary(thread.threadId);
  if (!sourceSummary) {
    elements.sourceFilterSummary.textContent = state.protectedAccessBlocked
      ? state.protectedAccessMessage
      : isHistoryLoading(thread.threadId)
        ? "正在读取当前线程的回复来源…"
        : currentHistoryMeta(thread.threadId)
          ? "回复来源会在读取线程记录后显示。"
          : "当前还没有可用的回复来源。";
    elements.sourceFilterList.innerHTML = "";
    return;
  }

  const activeFilter = activeSourceFilter(thread.threadId);
  const totalAssistantMessages = Number(sourceSummary.assistantMessageCount || 0);
  const filteredAssistantMessages = Number(sourceSummary.filteredAssistantMessageCount || 0);
  const activeFilterLabel = activeFilter ? resolveSourceLabel(activeFilter, sourceSummary) : "全部来源";
  const summaryLines = [
    `当前共有 ${totalAssistantMessages} 条回复。`,
    activeFilter
      ? `当前只看「${activeFilterLabel}」来源，共 ${filteredAssistantMessages} 条。`
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
        <button class="source-filter-button ${isActive ? "active" : ""}" data-source-filter="${escapeHtml(provider)}" type="button">
          <span class="source-filter-label">${escapeHtml(entry.label || resolveSourceLabel(provider, sourceSummary))}</span>
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
        restoreThreadHistorySnapshot(threadId, historySnapshot);
        setActiveSourceFilter(threadId, previousFilter);
        syncUrlState({ historyMode: "replace" });
        renderThreadSurface();
        showNotice(`切换来源筛选失败：${error.message}。当前视图可能不是最新值。`, { level: "error" });
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
            fallback.push(`待同步离线记录：${sync.pendingCount} 条`);
          } else {
            fallback.push("离线记录已同步或当前没有待同步内容。");
          }

          if (sync.endpointConfigured && sync.endpoint) {
            fallback.push(`在线入口：${sync.endpoint}`);
          } else {
            fallback.push("当前还没有配置在线接收入口；离线记录仍会先落到本地 outbox。");
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
            fallback.push("远端已送达，本地回执有告警，但不会把这批已送达记录再次当成待同步。");
          } else if (sync.localReceiptStatus === "at_risk") {
            fallback.push("远端已送达，但本地回执没有完整落盘，后续可能重复同步同一批记录。");
          }
          if (Array.isArray(sync.localReceiptWarnings) && sync.localReceiptWarnings.length > 0) {
            fallback.push(`本地回执告警：${sync.localReceiptWarnings.length} 条。`);
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
  const startupContext = activeThreadStartupContext();
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
    const history = await request(`/api/offline-chat/threads/${encodeURIComponent(threadId)}/messages?${params.toString()}`);
    if (!isCurrentThreadHistoryRequest(threadId, requestVersion)) {
      return state.histories.get(threadId) || [];
    }
    if (text(activeSourceFilter(threadId)) !== text(requestedFilter)) {
      return state.histories.get(threadId) || [];
    }
    acceptsThreadStartupFromHistory(history);
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
    if (needsReload) {
      restoreThreadHistorySnapshot(nextThreadId, historySnapshot);
    }
    throw error;
  }
  renderThreadSurface();
}

async function refreshSyncStatus() {
  state.sync = await request("/api/offline-chat/sync/status");
  renderSyncStatus();
}

async function bootstrap() {
  const requestVersion = nextBootstrapRequestVersion();
  state.bootstrapping = true;
  renderControlAvailability();
  try {
    const payload = await request("/api/offline-chat/bootstrap", { resetOnUnauthorized: false });
    if (!isCurrentBootstrapRequest(requestVersion)) {
      return;
    }
    state.bootstrap = payload;
    state.threads = Array.isArray(payload.threads) ? payload.threads : [];
    state.sync = payload.sync || null;
    if (!state.threads.length) {
      throw new Error("当前没有可用离线线程。");
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
      if (!isOfflineChatProtectedAccessError(error)) {
        throw error;
      }
    }
  } catch (error) {
    if (isOfflineChatProtectedAccessError(error)) {
      if (isCurrentBootstrapRequest(requestVersion)) {
        if (isOfflineChatUnauthorizedError(error)) {
          handleOfflineChatUnauthorized(error.offlineChatStoredToken);
        } else {
          handleOfflineChatForbidden(error.offlineChatStoredToken);
        }
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
    showNotice("当前没有可用线程，暂时无法发送。", { level: "error" });
    return;
  }

  state.sending = true;
  elements.sendButton.disabled = true;
  elements.sendButton.textContent = "发送中…";

  let result = null;
  try {
    result = await request(`/api/offline-chat/threads/${encodeURIComponent(thread.threadId)}/messages`, {
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
    postWriteWarnings.push(`消息已写入，但刷新线程历史失败：${error.message}`);
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
    renderAuthState("请先输入管理令牌，再恢复离线线程运行信息。");
    showNotice("请先输入管理令牌。", { level: "error" });
    return;
  }
  setStoredAdminToken(token);
  if (elements.authTokenInput) {
    elements.authTokenInput.value = "";
  }
  renderAuthState("已保存当前标签页里的管理令牌；正在恢复离线线程运行信息。");
  try {
    await bootstrap();
    startAutoSyncLoop();
    await maybeAutoSync({ force: true });
    renderAuthState();
    clearNotice();
  } catch (error) {
      if (isOfflineChatProtectedAccessError(error)) {
      return;
    }
    renderAuthState("已保存令牌，但这枚令牌当前还不能读取离线线程。");
    showNotice(`离线线程恢复失败：${error.message}`, { level: "error" });
  }
});
elements.authClearButton?.addEventListener("click", () => {
  if (elements.authTokenInput) {
    elements.authTokenInput.value = "";
  }
  setStoredAdminToken("");
  renderAuthState("当前标签页里的管理令牌已清除。");
  resetProtectedThreadState(`当前标签页未保存管理令牌；${OFFLINE_THREAD_RUNTIME_SCOPE_LABEL}需要重新录入后才能继续。`);
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
    showNotice(`切换线程失败：${error.message}。当前视图可能不是最新值。`, { level: "error" });
  });
});

init().catch((error) => {
  if (isOfflineChatProtectedAccessError(error)) {
    return;
  }
  renderFatalState(`离线线程启动失败：${error.message}`);
});

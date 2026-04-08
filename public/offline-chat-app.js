const state = {
  bootstrap: null,
  threads: [],
  activeThreadId: "group",
  histories: new Map(),
  historyMeta: new Map(),
  historyFilters: new Map(),
  sync: null,
  sending: false,
  syncing: false,
  autoSyncTimer: null,
  lastAutoSyncAt: 0,
};

const elements = {
  threadList: document.querySelector("#thread-list"),
  threadTitle: document.querySelector("#thread-title"),
  threadDescription: document.querySelector("#thread-description"),
  threadPill: document.querySelector("#thread-pill"),
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
};

function text(value) {
  return typeof value === "string" ? value.trim() : "";
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
    return "刚刚";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function basename(value) {
  const normalized = text(value);
  if (!normalized) {
    return "";
  }
  return normalized.split(/[\\/]/).pop() || normalized;
}

function formatStackChip(localReasoner = null) {
  const provider = text(localReasoner?.provider) || "unknown";
  if (provider === "local_command") {
    const command = basename(localReasoner?.command) || "本地命令";
    return `本地栈：${provider} · ${command} · 类人脑神经网络`;
  }
  if (provider === "ollama_local") {
    return `本地栈：${provider} · ${text(localReasoner?.model) || "gemma4:e4b"} · 类人脑神经网络`;
  }
  if (provider === "openai_compatible") {
    return `本地栈：${provider} · ${text(localReasoner?.model) || "未命名模型"} · 类人脑神经网络`;
  }
  if (provider === "local_mock") {
    return "本地栈：local_mock · 兜底本地回答引擎";
  }
  return `本地栈：${provider} · 类人脑神经网络`;
}

function formatMessageSource(source = null) {
  if (!source) {
    return "";
  }
  const parts = [];
  if (text(source.label)) {
    parts.push(text(source.label));
  } else if (text(source.provider)) {
    parts.push(text(source.provider));
  }
  if (text(source.provider) && text(source.label) && text(source.provider) !== text(source.label)) {
    parts.push(text(source.provider));
  }
  if (text(source.model) && text(source.provider) !== "local_command") {
    parts.push(text(source.model));
  }
  return parts.join(" · ");
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

function setActiveSourceFilter(threadId, sourceProvider = null) {
  const normalized = text(sourceProvider);
  if (!normalized) {
    state.historyFilters.delete(threadId);
    return;
  }
  state.historyFilters.set(threadId, normalized);
}

function currentHistoryMeta(threadId = state.activeThreadId) {
  return state.historyMeta.get(threadId) || null;
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
  return normalizedProvider;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `请求失败（${response.status}）`);
  }
  return payload;
}

function activeThread() {
  return state.threads.find((entry) => entry.threadId === state.activeThreadId) || state.threads[0] || null;
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
      const meta =
        thread.threadKind === "group"
          ? `群聊工具 · ${thread.memberCount || 0} 位成员`
          : `${thread.title || "成员"} · ${thread.did ? "已注册 Passport 身份" : "等待注册"}`;
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
      state.activeThreadId = threadId;
      syncUrlState({ historyMode: "push" });
      renderThreadList();
      renderThreadHeader();
      await loadThreadHistory(threadId);
      renderSourceSidebar();
      renderMessages();
    });
  }
}

function renderThreadHeader() {
  const thread = activeThread();
  const activeFilter = activeSourceFilter(thread?.threadId || state.activeThreadId);
  if (!thread) {
    elements.threadTitle.textContent = "离线聊天";
    elements.threadDescription.textContent = "没有可用线程。";
    elements.threadPill.textContent = "等待初始化";
    return;
  }

  if (thread.threadKind === "group") {
    elements.threadTitle.textContent = "我们的群聊";
    elements.threadDescription.textContent = activeFilter
      ? `你正在查看来源为「${resolveSourceLabel(activeFilter, currentHistoryMeta(thread.threadId)?.sourceSummary)}」的群聊回复。`
      : "你发一条消息，团队里的每个人都会分别回应。";
    elements.threadPill.textContent = activeFilter ? `群聊工具 · 已筛选` : "群聊工具";
    elements.composerHint.textContent =
      "当前是群聊模式：一条消息会同时发给沈知远、林清禾、周景川、许言舟、宋予安、顾叙白。";
    return;
  }

  elements.threadTitle.textContent = thread.label;
  elements.threadDescription.textContent = activeFilter
    ? `当前是与 ${thread.label} 的单独对话，并且只显示来源为「${resolveSourceLabel(activeFilter, currentHistoryMeta(thread.threadId)?.sourceSummary)}」的回复。`
    : `当前是与 ${thread.label} 的单独对话。`;
  elements.threadPill.textContent = activeFilter ? `${thread.title || "离线线程"} · 已筛选` : (thread.title || "离线线程");
  elements.composerHint.textContent = `当前是单聊模式：消息只会发给 ${thread.label}。`;
}

function renderMessages() {
  const thread = activeThread();
  if (!thread) {
    elements.messages.innerHTML = '<div class="empty-state">当前没有可用线程。</div>';
    return;
  }

  const history = state.histories.get(thread.threadId) || [];
  const activeFilter = activeSourceFilter(thread.threadId);
  if (!history.length) {
    elements.messages.innerHTML = activeFilter
      ? `<div class="empty-state">当前来源筛选「${escapeHtml(resolveSourceLabel(activeFilter, currentHistoryMeta(thread.threadId)?.sourceSummary))}」下还没有消息。</div>`
      : '<div class="empty-state">这里还没有消息。你现在可以发第一句。</div>';
    return;
  }

  elements.messages.innerHTML = history
    .map(
      (message) => `
        <article class="message ${message.role === "user" ? "user" : "assistant"}">
          <div class="message-head">
            <div class="message-author">${escapeHtml(message.author || "消息")}</div>
            <div class="message-time">${escapeHtml(formatTime(message.createdAt))}</div>
          </div>
          <div class="message-body">${escapeHtml(message.content || "")}</div>
          ${
            message.role === "assistant" && message.source
              ? `<div class="message-source ${escapeHtml(sourceClassName(message.source))}">${escapeHtml(formatMessageSource(message.source))}</div>`
              : ""
          }
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

  const historyMeta = currentHistoryMeta(thread.threadId);
  if (!historyMeta) {
    elements.sourceFilterSummary.textContent = "正在读取当前线程的回答来源统计…";
    elements.sourceFilterList.innerHTML = "";
    return;
  }

  const summary = historyMeta.sourceSummary || { providers: [] };
  const activeFilter = text(historyMeta.sourceFilter) || null;
  const totalAssistantMessages = Number(summary.assistantMessageCount || 0);
  const filteredAssistantMessages = Number(summary.filteredAssistantMessageCount || 0);
  const activeFilterLabel = activeFilter ? resolveSourceLabel(activeFilter, summary) : "全部来源";
  const summaryLines = [
    `当前线程共有 ${totalAssistantMessages} 条助手回复。`,
    activeFilter
      ? `当前只显示「${activeFilterLabel}」来源，共 ${filteredAssistantMessages} 条。`
      : "当前显示全部来源。",
  ];
  elements.sourceFilterSummary.innerHTML = summaryLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");

  const filterButtons = [
    {
      provider: "",
      label: "全部来源",
      count: totalAssistantMessages,
      latestAt: null,
    },
    ...(Array.isArray(summary.providers) ? summary.providers : []),
  ];

  elements.sourceFilterList.innerHTML = filterButtons
    .map((entry) => {
      const provider = text(entry.provider);
      const isActive = (!provider && !activeFilter) || provider === activeFilter;
      const latestAt = entry.latestAt ? ` · 最近 ${formatTime(entry.latestAt)}` : "";
      return `
        <button class="source-filter-button ${isActive ? "active" : ""}" data-source-filter="${escapeHtml(provider)}" type="button">
          <span class="source-filter-label">${escapeHtml(entry.label || resolveSourceLabel(provider, summary))}</span>
          <span class="source-filter-meta">${escapeHtml(`${Number(entry.count || 0)} 条${latestAt}`)}</span>
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
      setActiveSourceFilter(threadId, normalized);
      syncUrlState({ historyMode: "push" });
      renderThreadHeader();
      renderSourceSidebar();
      await loadThreadHistory(threadId, { force: true });
      renderThreadHeader();
      renderSourceSidebar();
      renderMessages();
    });
  }
}

function renderSyncStatus() {
  const sync = state.sync;
  if (!sync) {
    elements.syncStatus.textContent = "正在读取同步状态…";
    return;
  }

  const lines = [];
  if (sync.pendingCount > 0) {
    lines.push(`待同步离线记录：${sync.pendingCount} 条`);
  } else {
    lines.push("离线记录已同步或当前没有待同步内容。");
  }

  if (sync.endpointConfigured && sync.endpoint) {
    lines.push(`在线入口：${sync.endpoint}`);
  } else {
    lines.push("当前还没有配置在线接收入口；离线记录仍会先落到本地 outbox。");
  }

  if (sync.status === "delivered") {
    lines.push("最近一次同步已成功送达在线入口。");
  } else if (sync.status === "delivery_failed") {
    lines.push("最近一次同步失败，系统会在联网状态下继续重试。");
  } else if (sync.status === "awaiting_remote_endpoint") {
    lines.push("如果要自动回灌到在线版，需要配置在线同步入口。");
  } else if (sync.status === "ready_to_sync") {
    lines.push("当前已经具备自动同步条件。");
  }

  elements.syncStatus.innerHTML = lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
}

async function loadThreadHistory(threadId, { force = false } = {}) {
  const requestedFilter = activeSourceFilter(threadId);
  const cached = state.historyMeta.get(threadId);
  if (!force && cached && text(cached.sourceFilter) === text(requestedFilter)) {
    return cached.messages || [];
  }
  const params = new URLSearchParams({ limit: "120" });
  if (requestedFilter) {
    params.set("sourceProvider", requestedFilter);
  }
  const history = await request(`/api/offline-chat/threads/${encodeURIComponent(threadId)}/messages?${params.toString()}`);
  state.historyMeta.set(threadId, history);
  state.histories.set(threadId, history.messages || []);
  return history.messages || [];
}

async function applyUrlState(urlState = {}, { forceHistoryReload = false, syncHistory = false } = {}) {
  const nextThreadId = resolveThreadId(urlState.threadId);
  state.activeThreadId = nextThreadId;
  setActiveSourceFilter(nextThreadId, urlState.sourceProvider);
  if (syncHistory) {
    syncUrlState({ historyMode: "replace" });
  }
  renderThreadList();
  renderThreadHeader();
  await loadThreadHistory(nextThreadId, { force: forceHistoryReload });
  renderThreadHeader();
  renderSourceSidebar();
  renderMessages();
}

async function refreshSyncStatus() {
  state.sync = await request("/api/offline-chat/sync/status");
  renderSyncStatus();
}

async function bootstrap() {
  const payload = await request("/api/offline-chat/bootstrap");
  state.bootstrap = payload;
  state.threads = Array.isArray(payload.threads) ? payload.threads : [];
  state.sync = payload.sync || null;
  elements.stackChip.textContent = formatStackChip(payload.localReasoner);
  renderSyncStatus();
  await applyUrlState(readUrlState(), { forceHistoryReload: true, syncHistory: true });
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

  state.sending = true;
  elements.sendButton.disabled = true;
  elements.sendButton.textContent = "发送中…";

  try {
    const thread = activeThread();
    await request(`/api/offline-chat/threads/${encodeURIComponent(thread.threadId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    elements.composerInput.value = "";
    await loadThreadHistory(thread.threadId, { force: true });
    renderThreadHeader();
    renderSourceSidebar();
    renderMessages();
    await refreshSyncStatus();
    await maybeAutoSync({ force: true });
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.sending = false;
    elements.sendButton.disabled = false;
    elements.sendButton.textContent = "发送";
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
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.syncing = false;
    elements.syncButton.disabled = false;
    elements.syncButton.textContent = "立即同步";
  }
}

async function maybeAutoSync({ force = false } = {}) {
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
      console.error("[offline-chat] auto sync failed", error);
    });
  }, 30000);
}

async function init() {
  setNetworkStatus();
  await bootstrap();
  startAutoSyncLoop();
  await maybeAutoSync();
}

elements.composer.addEventListener("submit", sendMessage);
elements.syncButton.addEventListener("click", () => {
  flushSync().catch((error) => {
    window.alert(error.message);
  });
});
elements.refreshButton.addEventListener("click", () => {
  Promise.all([bootstrap(), refreshSyncStatus()])
    .then(() => {
      renderSourceSidebar();
      renderMessages();
    })
    .catch((error) => window.alert(error.message));
});
window.addEventListener("online", () => {
  setNetworkStatus();
  maybeAutoSync({ force: true }).catch((error) => {
    console.error("[offline-chat] online sync failed", error);
  });
});
window.addEventListener("offline", setNetworkStatus);
window.addEventListener("popstate", () => {
  applyUrlState(readUrlState(), { forceHistoryReload: true }).catch((error) => {
    window.alert(error.message);
  });
});

init().catch((error) => {
  elements.messages.innerHTML = `<div class="empty-state">离线聊天器启动失败：${escapeHtml(error.message)}</div>`;
});

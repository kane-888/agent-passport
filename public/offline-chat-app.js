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

const OPENNEED_MEMORY_ENGINE_NAME = "OpenNeed 记忆稳态引擎";
const OPENNEED_REASONER_BRAND = "OpenNeed";
const OPENNEED_REASONER_LEGACY_MODEL = ["gemma4", "e4b"].join(":");
const DEFAULT_COMPOSER_PLACEHOLDER = "在这里输入想说的话。单聊会只发给当前成员，群聊会让所有人分别回应。";
const DISABLED_COMPOSER_PLACEHOLDER = "离线线程当前不可用，请先恢复线程真值后再发送。";

const elements = {
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
};

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isOpenNeedReasonerAlias(value) {
  const normalized = text(value);
  if (!normalized) {
    return false;
  }
  const lowered = normalized.toLowerCase();
  return lowered === OPENNEED_REASONER_BRAND.toLowerCase() || lowered === OPENNEED_MEMORY_ENGINE_NAME.toLowerCase();
}

function isOpenNeedReasonerModel(value) {
  const normalized = text(value);
  return Boolean(normalized) && (isOpenNeedReasonerAlias(normalized) || normalized.toLowerCase() === OPENNEED_REASONER_LEGACY_MODEL.toLowerCase());
}

function displayOpenNeedReasonerModel(value, fallback = OPENNEED_REASONER_BRAND) {
  const normalized = text(value);
  if (!normalized) {
    return fallback;
  }
  return isOpenNeedReasonerModel(normalized) ? OPENNEED_REASONER_BRAND : normalized;
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

function formatParticipantNames(participants = []) {
  if (!Array.isArray(participants) || !participants.length) {
    return "团队里的每个人";
  }
  const names = participants
    .map((entry) => text(entry?.displayName))
    .filter(Boolean);
  return names.length ? names.join("、") : "团队里的每个人";
}

function providerLabel(provider) {
  const normalized = text(provider);
  const labels = {
    ollama_local: "Ollama 本地引擎",
    local_command: "自定义本地命令",
    openai_compatible: "OpenAI 兼容本地网关",
    local_mock: "本地兜底引擎",
    deterministic_fallback: "确定性兜底",
    passport_fast_memory: "本地参考层快答",
    unknown: "引擎状态未确认",
  };
  return labels[normalized] || normalized || "未命名来源";
}

function formatStackChip(localReasoner = null) {
  const provider = text(localReasoner?.provider) || "unknown";
  if (provider === "local_command") {
    const command = basename(localReasoner?.command) || "本地命令";
    return `本地栈：${providerLabel(provider)} · ${command} · ${OPENNEED_MEMORY_ENGINE_NAME}`;
  }
  if (provider === "ollama_local") {
    return `本地栈：${providerLabel(provider)} · ${displayOpenNeedReasonerModel(localReasoner?.model)} · ${OPENNEED_MEMORY_ENGINE_NAME}`;
  }
  if (provider === "openai_compatible") {
    return `本地栈：${providerLabel(provider)} · ${text(localReasoner?.model) || "未命名模型"} · ${OPENNEED_MEMORY_ENGINE_NAME}`;
  }
  if (provider === "local_mock") {
    return `本地栈：${providerLabel(provider)} · 兜底本地回答引擎`;
  }
  return `本地栈：${providerLabel(provider)} · ${OPENNEED_MEMORY_ENGINE_NAME}`;
}

function formatMessageSource(source = null) {
  if (!source) {
    return "";
  }
  const parts = [];
  if (text(source.label)) {
    parts.push(text(source.label));
  } else if (text(source.provider)) {
    parts.push(providerLabel(source.provider));
  }
  if (text(source.provider) && text(source.label) && providerLabel(source.provider) !== text(source.label)) {
    parts.push(providerLabel(source.provider));
  }
  if (text(source.model) && text(source.provider) !== "local_command") {
    parts.push(
      text(source.provider) === "ollama_local"
        ? displayOpenNeedReasonerModel(source.model)
        : text(source.model)
    );
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
  return providerLabel(normalizedProvider);
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

function activeThreadStartupContext() {
  return state.bootstrap?.threadStartup?.phase_1 || null;
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
  return [
    ...(Array.isArray(startup?.coreParticipants) ? startup.coreParticipants : []),
    ...(Array.isArray(startup?.supportParticipants) ? startup.supportParticipants : []),
  ]
    .map((entry) => normalizeParticipant(entry))
    .filter((entry) => entry.displayName || entry.agentId);
}

function resolveGroupParticipants(thread = activeThread()) {
  const startup = startupParticipants();
  if (startup.length) {
    return startup;
  }
  const threadParticipants = Array.isArray(thread?.participants)
    ? thread.participants
        .map((entry) => normalizeParticipant(entry))
        .filter((entry) => entry.displayName || entry.agentId)
    : [];
  if (threadParticipants.length) {
    return threadParticipants;
  }
  return bootstrapPersonas()
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

function renderControlAvailability({ fatal = false } = {}) {
  const threadReady = Boolean(activeThread()) && !fatal;
  const syncReady = Boolean(state.sync) && !fatal;

  elements.composerInput.disabled = !threadReady;
  elements.composerInput.placeholder = threadReady ? DEFAULT_COMPOSER_PLACEHOLDER : DISABLED_COMPOSER_PLACEHOLDER;
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
}

function renderFatalState(message) {
  const normalized = text(message) || "离线线程当前不可用。";
  showNotice(normalized, { level: "error" });
  elements.threadList.innerHTML = '<div class="empty-state">当前没有可用线程。</div>';
  elements.threadTitle.textContent = "离线线程暂不可用";
  elements.threadDescription.textContent = "当前没有拿到线程真值，请先恢复离线线程运行态后再继续。";
  elements.threadPill.textContent = "离线入口失败";
  elements.threadContextSummary.textContent = "当前无法确认线程成员。";
  elements.threadContextList.innerHTML = '<div class="empty-state">线程真值暂不可用。</div>';
  elements.sourceFilterSummary.textContent = "当前无法确认回答来源。";
  elements.sourceFilterList.innerHTML = "";
  elements.syncStatus.innerHTML = `<div>${escapeHtml(normalized)}</div>`;
  elements.messages.innerHTML = `<div class="empty-state">${escapeHtml(normalized)}</div>`;
  renderControlAvailability({ fatal: true });
}

function renderThreadContext() {
  const thread = activeThread();
  if (!thread) {
    elements.threadContextSummary.textContent = "当前没有可用线程。";
    elements.threadContextList.innerHTML = "";
    return;
  }

  if (thread.threadKind === "group") {
    const startup = activeThreadStartupContext();
    const participants = resolveGroupParticipants(thread);
    const memberCount = resolveGroupMemberCount(thread);
    const coreCount = Number(startup?.coreParticipantCount || 0);
    const supportCount = Number(startup?.supportParticipantCount || 0);
    const summaryLines = [
      `当前线程共有 ${memberCount} 位成员。`,
      startup?.title ? `${startup.title}。${startup?.intent || ""}`.trim() : (startup?.intent || "当前线程按运行成员真值组装。"),
      coreCount || supportCount
        ? `其中 ${coreCount} 位工作角色，${supportCount} 位支持角色。`
        : "当前正在读取线程角色分布。",
    ];
    elements.threadContextSummary.innerHTML = summaryLines
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join("");
    elements.threadContextList.innerHTML = participants.length
      ? participants
          .map((entry) => {
            const meta = [text(entry?.title), text(entry?.role)].filter(Boolean).join(" · ");
            return `
              <article class="thread-context-card">
                <div class="thread-context-name">${escapeHtml(entry?.displayName || "成员")}</div>
                <div class="thread-context-meta">${escapeHtml(meta || "线程成员")}</div>
                <div class="thread-context-goal">${escapeHtml(entry?.currentGoal || entry?.coreMission || "当前职责信息读取中。")}</div>
              </article>
            `;
          })
          .join("")
      : '<div class="empty-state">当前线程成员信息还没准备好。</div>';
    return;
  }

  const participant = summarizeDirectThreadParticipant(thread);
  elements.threadContextSummary.innerHTML = [
    "<div>当前线程只包含 1 位成员。</div>",
    `<div>你正在与 ${escapeHtml(thread.label || "当前成员")} 单聊。</div>`,
  ].join("");
  elements.threadContextList.innerHTML = participant
    ? `
      <article class="thread-context-card">
        <div class="thread-context-name">${escapeHtml(participant.displayName || thread.label || "成员")}</div>
        <div class="thread-context-meta">${escapeHtml([participant.title, participant.role].filter(Boolean).join(" · ") || "线程成员")}</div>
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
      const meta =
        thread.threadKind === "group"
          ? `群聊工具 · ${resolveGroupMemberCount(thread)} 位成员`
          : `${summarizeDirectThreadParticipant(thread)?.title || thread.title || "成员"} · ${thread.did ? "已注册本地身份" : "等待注册"}`;
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
      try {
        state.activeThreadId = threadId;
        syncUrlState({ historyMode: "push" });
        renderThreadList();
        renderThreadHeader();
        renderThreadContext();
        await loadThreadHistory(threadId);
        renderSourceSidebar();
        renderMessages();
        clearNotice();
      } catch (error) {
        state.activeThreadId = previousThreadId;
        syncUrlState({ historyMode: "replace" });
        renderThreadList();
        renderThreadHeader();
        renderThreadContext();
        renderSourceSidebar();
        renderMessages();
        showNotice(`切换线程失败：${error.message}。当前视图可能不是最新值。`, { level: "error" });
      }
    });
  }
}

function renderThreadHeader() {
  const thread = activeThread();
  const activeFilter = activeSourceFilter(thread?.threadId || state.activeThreadId);
  if (!thread) {
    elements.threadTitle.textContent = "离线线程";
    elements.threadDescription.textContent = "没有可用线程。";
    elements.threadPill.textContent = "等待初始化";
    renderControlAvailability({ fatal: true });
    return;
  }

  if (thread.threadKind === "group") {
    const startup = activeThreadStartupContext();
    const memberCount = resolveGroupMemberCount(thread);
    const participants = resolveGroupParticipants(thread);
    elements.threadTitle.textContent = "我们的群聊";
    elements.threadDescription.textContent = activeFilter
      ? `你正在查看来源为「${resolveSourceLabel(activeFilter, currentHistoryMeta(thread.threadId)?.sourceSummary)}」的群聊回复。`
      : `${startup?.title || "当前线程上下文"}：当前共有 ${memberCount} 位成员。你发一条消息，当前线程里的每个人都会分别回应。`;
    elements.threadPill.textContent = activeFilter ? `群聊工具 · ${memberCount} 人 · 已筛选` : `群聊工具 · ${memberCount} 人`;
    elements.composerHint.textContent =
      `当前是群聊模式：一条消息会同时发给${formatParticipantNames(participants)}。`;
    renderControlAvailability();
    return;
  }

  elements.threadTitle.textContent = thread.label;
  elements.threadDescription.textContent = activeFilter
    ? `当前是与 ${thread.label} 的单独对话，并且只显示来源为「${resolveSourceLabel(activeFilter, currentHistoryMeta(thread.threadId)?.sourceSummary)}」的回复。`
    : `当前是与 ${thread.label} 的单独对话。`;
  elements.threadPill.textContent = activeFilter ? `${thread.title || "离线线程"} · 已筛选` : (thread.title || "离线线程");
  elements.composerHint.textContent = `当前是单聊模式：消息只会发给 ${thread.label}。`;
  renderControlAvailability();
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
  const activeFilter = activeSourceFilter(thread.threadId);
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
      const previousFilter = activeSourceFilter(threadId);
      try {
        setActiveSourceFilter(threadId, normalized);
        syncUrlState({ historyMode: "push" });
        renderThreadHeader();
        renderSourceSidebar();
        await loadThreadHistory(threadId, { force: true });
        renderThreadHeader();
        renderSourceSidebar();
        renderMessages();
        clearNotice();
      } catch (error) {
        setActiveSourceFilter(threadId, previousFilter);
        syncUrlState({ historyMode: "replace" });
        renderThreadHeader();
        renderSourceSidebar();
        renderMessages();
        showNotice(`切换来源筛选失败：${error.message}。当前视图可能不是最新值。`, { level: "error" });
      }
    });
  }
}

function renderSyncStatus() {
  const sync = state.sync;
  if (!sync) {
    elements.syncStatus.textContent = "正在读取同步状态…";
    renderControlAvailability();
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
  renderControlAvailability();
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
  renderThreadContext();
  await loadThreadHistory(nextThreadId, { force: forceHistoryReload });
  renderThreadHeader();
  renderThreadContext();
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
  if (!state.threads.length) {
    throw new Error("当前没有可用离线线程。");
  }
  elements.stackChip.textContent = formatStackChip(payload.localReasoner);
  renderSyncStatus();
  await applyUrlState(readUrlState(), { forceHistoryReload: true, syncHistory: true });
  clearNotice();
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

  try {
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
    clearNotice();
  } catch (error) {
    showNotice(`发送失败：${error.message}`, { level: "error" });
  } finally {
    state.sending = false;
    renderControlAvailability();
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
    showNotice(`同步失败：${error.message}`, { level: "error" });
  } finally {
    state.syncing = false;
    renderControlAvailability();
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
  renderControlAvailability();
}

elements.composer.addEventListener("submit", sendMessage);
elements.syncButton.addEventListener("click", () => {
  flushSync().catch((error) => {
    showNotice(`同步失败：${error.message}`, { level: "error" });
  });
});
elements.refreshButton.addEventListener("click", async () => {
  try {
    await bootstrap();
    await refreshSyncStatus();
    renderThreadContext();
    renderSourceSidebar();
    renderMessages();
    clearNotice();
  } catch (error) {
    showNotice(`刷新失败：${error.message}。当前视图可能不是最新值。`, { level: "error" });
  }
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
    showNotice(`切换线程失败：${error.message}。当前视图可能不是最新值。`, { level: "error" });
  });
});

init().catch((error) => {
  renderFatalState(`离线线程启动失败：${error.message}`);
});

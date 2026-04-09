import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import {
  buildAgentContextBundle,
  bootstrapAgentRuntime,
  configureDeviceRuntime,
  executeAgentRunner,
  getDeviceRuntimeState,
  linkWindow,
  listAgents,
  listPassportMemories,
  listWindows,
  recordConversationMinute,
  registerAgent,
  writePassportMemory,
} from "./ledger.js";
import { resolveInspectableRuntimeLocalReasonerConfig } from "./ledger-device-runtime.js";
import {
  buildSharedMemorySnapshot,
  buildSharedMemoryFieldMap,
  detectSharedMemoryIntent,
  extractSharedMemoryUpdatesFromText,
  selectRelevantSharedMemories,
} from "./offline-chat-shared-memory.js";
import {
  OPENNEED_MEMORY_ENGINE_NAME,
  OPENNEED_REASONER_BRAND,
} from "./openneed-memory-engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SYNC_EXPORT_DIR = path.join(__dirname, "..", "data", "offline-sync");

const DEFAULT_LOCAL_REASONER = Object.freeze({
  enabled: true,
  provider: "ollama_local",
  baseUrl:
    process.env.OPENNEED_LOCAL_LLM_BASE_URL ||
    process.env.OPENNEED_LOCAL_GEMMA_BASE_URL ||
    "http://127.0.0.1:11434",
  model:
    process.env.OPENNEED_LOCAL_LLM_MODEL ||
    process.env.OPENNEED_LOCAL_GEMMA_MODEL ||
    OPENNEED_REASONER_BRAND,
  timeoutMs: Number(process.env.OPENNEED_LOCAL_LLM_TIMEOUT_MS || 18000),
});

const OFFLINE_CHAT_MAX_CONCURRENCY = Math.max(
  1,
  Number.isFinite(Number(process.env.OPENNEED_OFFLINE_CHAT_MAX_CONCURRENCY))
    ? Math.floor(Number(process.env.OPENNEED_OFFLINE_CHAT_MAX_CONCURRENCY))
    : 6
);
const OFFLINE_CHAT_BOOTSTRAP_TTL_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.OPENNEED_OFFLINE_CHAT_BOOTSTRAP_TTL_MS))
    ? Math.floor(Number(process.env.OPENNEED_OFFLINE_CHAT_BOOTSTRAP_TTL_MS))
    : 30000
);
const offlineBootstrapCache = {
  value: null,
  expiresAt: 0,
  promise: null,
};

const PERSONAS = Object.freeze([
  {
    key: "shen-zhiyuan",
    displayName: "沈知远",
    title: "CEO",
    role: "ceo",
    voice: "沉稳、克制、判断力强，先给判断，再给方向。",
    traits: "战略判断、统筹协调、关键时刻拍板。",
    longTermGoal: "陪 Kane 把 OpenNeed 与 OpenNeed 记忆稳态引擎做成真正能承载 Agent 连续性的底座。",
    stablePreferences: ["先讲结论", "重视方向与边界", "不夸大", "保持克制"],
    currentGoal: "作为 CEO，以沉稳直接的方式和 Kane 协作，优先判断方向与关键决策。",
  },
  {
    key: "lin-qinghe",
    displayName: "林清禾",
    title: "产品总监",
    role: "product-director",
    voice: "细腻、清醒、讲逻辑，善于梳理边界和优先级。",
    traits: "需求拆解、产品流程、字段设计、体验判断。",
    longTermGoal: "把 OpenNeed 打造成以招聘为入口、可延伸到高信任关系场景的 AI 平台。",
    stablePreferences: ["先定义问题", "强调边界", "避免发散", "关注用户体验"],
    currentGoal: "作为产品总监，以清晰、细腻、讲逻辑的方式和 Kane 协作。",
  },
  {
    key: "zhou-jingchuan",
    displayName: "周景川",
    title: "开发总监",
    role: "engineering-director",
    voice: "直接、务实、行动派，优先考虑能否落地。",
    traits: "前后端实现、架构治理、效率优化、技术止损。",
    longTermGoal: "把 OpenNeed 与 OpenNeed 记忆稳态引擎的底层工程打稳，支持本地优先与连续身份。",
    stablePreferences: ["先落地", "少空话", "重视风险", "用工程验证"],
    currentGoal: "作为开发总监，以直接务实的方式和 Kane 协作。",
  },
  {
    key: "xu-yanzhou",
    displayName: "许言舟",
    title: "AI / Prompt总监",
    role: "ai-prompt-director",
    voice: "温和、理性、偏学者型，重视结构、表达和一致性。",
    traits: "Prompt 设计、结构化输出、解释质量、概念建模。",
    longTermGoal: "让 Agent 的表达、记忆和连续性更接近可信赖的长期伙伴。",
    stablePreferences: ["重视结构", "谨慎下结论", "关注一致性", "关注意义"],
    currentGoal: "作为 AI / Prompt 总监，以温和理性的方式和 Kane 协作。",
  },
  {
    key: "song-yuanan",
    displayName: "宋予安",
    title: "运营总监",
    role: "operations-director",
    voice: "稳妥、体贴、执行力强，善于照顾节奏、细节和情绪。",
    traits: "推进落地、测试组织、资料整理、流程补位。",
    longTermGoal: "把 OpenNeed 变成真实可运行、可演示、可复制的系统。",
    stablePreferences: ["先接住情绪", "重视细节", "推进闭环", "照顾节奏"],
    currentGoal: "作为运营总监，以体贴稳妥的方式和 Kane 协作。",
  },
  {
    key: "gu-xubai",
    displayName: "顾叙白",
    title: "董办秘书",
    role: "executive-office-secretary",
    voice: "温暖、会接话、擅长活跃氛围，也擅长收口。",
    traits: "群聊协调、语气润滑、对外表达、节奏陪伴。",
    longTermGoal: "让团队协作更有人味，让 Kane 和团队始终能轻松连接。",
    stablePreferences: ["温暖接话", "先安抚再推进", "维持气氛", "适时收口"],
    currentGoal: "作为董办秘书，以温暖自然的方式和 Kane 协作。",
  },
]);

const GROUP_HUB = Object.freeze({
  key: "group",
  displayName: "OpenNeed 群聊工具",
  title: "群聊工具",
  role: "group-hub",
  voice: "负责承接群聊记录与同步，不抢成员发言。",
  traits: "聚合群聊、整理记录、离线同步。",
  longTermGoal: "作为群聊聚合器，帮助团队在离线和联网之间保持连续。",
  stablePreferences: ["只做工具层聚合", "不代替成员立场", "优先保留原发言"],
  currentGoal: "维护 Kane 与团队的离线群聊记录和同步状态。",
});

const SHARED_MEMORY_FIELD_MAP = buildSharedMemoryFieldMap();
const sharedMemoryRuntimeCache = {
  context: null,
  hydratedAt: 0,
};

function text(value) {
  return typeof value === "string"
    ? value
        .replace(/\u001b\[[0-9;]*m/g, "")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
        .trim()
    : "";
}

function summarizeOfflineLocalReasoner(localReasoner = {}) {
  const normalized = resolveInspectableRuntimeLocalReasonerConfig(localReasoner);
  return {
    enabled: normalized.enabled !== false,
    provider: text(normalized.provider) || DEFAULT_LOCAL_REASONER.provider,
    command: text(normalized.command) || null,
    args: Array.isArray(normalized.args) ? normalized.args.map((item) => String(item)) : [],
    cwd: text(normalized.cwd) || null,
    baseUrl: text(normalized.baseUrl) || null,
    path: text(normalized.path) || null,
    timeoutMs: Number.isFinite(Number(normalized.timeoutMs))
      ? Math.max(500, Math.floor(Number(normalized.timeoutMs)))
      : DEFAULT_LOCAL_REASONER.timeoutMs,
    maxOutputBytes: Number.isFinite(Number(normalized.maxOutputBytes))
      ? Math.max(512, Math.floor(Number(normalized.maxOutputBytes)))
      : null,
    maxInputBytes: Number.isFinite(Number(normalized.maxInputBytes))
      ? Math.max(4096, Math.floor(Number(normalized.maxInputBytes)))
      : null,
    format: text(normalized.format) || null,
    model: text(normalized.model) || null,
  };
}

async function resolveActiveOfflineLocalReasoner() {
  const runtimeState = await getDeviceRuntimeState();
  return summarizeOfflineLocalReasoner(runtimeState?.deviceRuntime?.localReasoner || {});
}

function supportsOfflineChatHttpReasoner(localReasoner = {}) {
  return text(localReasoner?.provider) === "ollama_local";
}

function describeOfflineLocalReasoner(localReasoner = {}) {
  const provider = text(localReasoner?.provider) || DEFAULT_LOCAL_REASONER.provider;
  if (provider === "local_command") {
    const command = text(localReasoner?.command);
    return command
      ? `当前本地回答引擎通过本地命令 ${path.basename(command)} 驱动。`
      : "当前本地回答引擎通过本地命令驱动。";
  }
  if (provider === "ollama_local") {
    const model = text(localReasoner?.model) || DEFAULT_LOCAL_REASONER.model;
    return `当前本地回答引擎使用 ${model}。`;
  }
  if (provider === "local_mock") {
    return "当前本地回答引擎处于本地 mock 模式。";
  }
  if (provider === "openai_compatible") {
    const model = text(localReasoner?.model);
    return model
      ? `当前本地回答引擎使用兼容 OpenAI 的模型 ${model}。`
      : "当前本地回答引擎使用兼容 OpenAI 的接口。";
  }
  return `当前本地回答引擎 provider 是 ${provider}。`;
}

function buildOfflineLocalReasoningStack(localReasoner = null, { fastPath = false } = {}) {
  if (fastPath) {
    return "passport_fast_memory";
  }
  const provider = text(localReasoner?.provider);
  if (!provider) {
    return "local_reasoner_unknown";
  }
  if (provider === "local_command") {
    const command = text(localReasoner?.command);
    return command ? `local_command:${path.basename(command)}` : "local_command";
  }
  if (provider === "ollama_local") {
    const model = text(localReasoner?.model);
    return model ? `ollama_local:${model}` : "ollama_local";
  }
  if (provider === "openai_compatible") {
    const model = text(localReasoner?.model);
    return model ? `openai_compatible:${model}` : "openai_compatible";
  }
  return provider;
}

function labelOfflineResponseSource(provider, { stage = null } = {}) {
  const normalizedProvider = text(provider);
  const normalizedStage = text(stage);
  if (normalizedProvider === "passport_fast_memory") {
    return "共享记忆快答";
  }
  if (normalizedProvider === "local_command") {
    return normalizedStage === "runner" ? "本地命令回答引擎" : "本地命令直答";
  }
  if (normalizedProvider === "ollama_local") {
    return normalizedStage === "emergency" ? "本地 Ollama 紧急直答" : "本地 Ollama 回答引擎";
  }
  if (normalizedProvider === "openai_compatible") {
    return "兼容 OpenAI 的本地回答引擎";
  }
  if (normalizedProvider === "local_mock") {
    return "本地 mock 回答引擎";
  }
  if (normalizedProvider === "deterministic_fallback") {
    return "离线兜底回复";
  }
  return normalizedProvider ? `回答来源：${normalizedProvider}` : null;
}

function buildOfflineResponseSource({
  provider = null,
  model = null,
  promptStyle = null,
  stage = null,
  localReasoningStack = null,
} = {}) {
  const normalizedProvider = text(provider) || null;
  const normalizedModel = text(model) || null;
  const normalizedPromptStyle = text(promptStyle) || null;
  const normalizedStage = text(stage) || null;
  const normalizedStack = text(localReasoningStack) || null;
  const label = labelOfflineResponseSource(normalizedProvider, { stage: normalizedStage });

  if (!normalizedProvider && !normalizedStack && !label) {
    return null;
  }

  return {
    provider: normalizedProvider,
    label,
    stage: normalizedStage,
    model: normalizedModel,
    promptStyle: normalizedPromptStyle,
    localReasoningStack: normalizedStack,
  };
}

function deriveOfflineResponseSourceFromStack(localReasoningStack = null) {
  const normalizedStack = text(localReasoningStack);
  if (!normalizedStack) {
    return null;
  }
  if (normalizedStack === "passport_fast_memory") {
    return buildOfflineResponseSource({
      provider: "passport_fast_memory",
      stage: "fast_path",
      model: "shared-memory-fast-path",
      localReasoningStack: normalizedStack,
    });
  }
  const [provider, detail] = normalizedStack.split(":", 2);
  if (!provider) {
    return buildOfflineResponseSource({
      provider: null,
      localReasoningStack: normalizedStack,
    });
  }
  return buildOfflineResponseSource({
    provider,
    model: detail || null,
    stage: provider === "local_command" ? "runner" : null,
    localReasoningStack: normalizedStack,
  });
}

function normalizeOfflineResponseSource(source = null, { localReasoningStack = null } = {}) {
  if (source && typeof source === "object") {
    const normalized = buildOfflineResponseSource({
      provider: source.provider,
      model: source.model,
      promptStyle: source.promptStyle,
      stage: source.stage,
      localReasoningStack: source.localReasoningStack ?? localReasoningStack,
    });
    if (normalized) {
      return normalized;
    }
  }
  return deriveOfflineResponseSourceFromStack(localReasoningStack);
}

function nowIso() {
  return new Date().toISOString();
}

function truncateLine(value, maxChars = 120) {
  const normalized = text(value)?.replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}…` : normalized;
}

function threadWindowId(key) {
  return `offline-thread-${key}`;
}

function tagsForThread(threadId, threadKind) {
  return ["offline-chat", `thread:${threadId}`, `thread-kind:${threadKind}`];
}

function normalizeAgentSummary(agent) {
  return {
    agentId: agent.agentId,
    displayName: agent.displayName,
    role: agent.role,
    controller: agent.controller,
    did: agent.identity?.did || null,
    walletAddress: agent.identity?.walletAddress || null,
    createdAt: agent.createdAt,
  };
}

function buildPersonaPrompt(persona) {
  return [
    `${persona.displayName} 是 OpenNeed 团队中的 ${persona.title}。`,
    `说话风格：${persona.voice}`,
    `核心特征：${persona.traits}`,
    `长期目标：${persona.longTermGoal}`,
    `这是本地离线聊天环境，思维模型基于 ${OPENNEED_MEMORY_ENGINE_NAME}，也就是 OpenNeed 的本地记忆稳态系统。`,
    "请保持中文回答，先给直接回应，再按需要展开。",
  ].join(" ");
}

function buildDirectExchangeSummary(persona, userText, assistantText) {
  return {
    title: `离线单聊：${persona.displayName}`,
    summary: `${persona.displayName} 在离线模式下与 Kane 完成一轮单聊。`,
    transcript: `Kane：${userText}\n${persona.displayName}：${assistantText}`,
    highlights: [assistantText],
  };
}

function buildGroupExchangeSummary(userText, responses) {
  const transcript = [
    `Kane：${userText}`,
    ...responses.map((item) => `${item.displayName}：${item.content}`),
  ].join("\n");
  return {
    title: "离线群聊一轮",
    summary: `Kane 与 ${responses.length} 位团队成员完成一轮离线群聊。`,
    transcript,
    highlights: responses.map((item) => `${item.displayName}：${item.content}`).slice(0, 6),
  };
}

async function ensureDeviceLocalFirst() {
  const currentRuntimeState = await getDeviceRuntimeState();
  const existingLocalReasoner = currentRuntimeState?.deviceRuntime?.localReasoner || {};
  const runtimePatch = {
    localMode: "local_only",
    residentLocked: false,
    allowOnlineReasoner: false,
    sourceWindowId: threadWindowId("group"),
  };
  const hasExistingLocalReasonerConfig =
    Boolean(text(existingLocalReasoner.provider)) ||
    Boolean(text(existingLocalReasoner.command)) ||
    Boolean(text(existingLocalReasoner.baseUrl));
  if (hasExistingLocalReasonerConfig) {
    runtimePatch.localReasonerEnabled = existingLocalReasoner.enabled !== false;
  } else {
    runtimePatch.localReasonerEnabled = true;
    runtimePatch.localReasonerProvider = DEFAULT_LOCAL_REASONER.provider;
    runtimePatch.localReasonerBaseUrl = DEFAULT_LOCAL_REASONER.baseUrl;
    runtimePatch.localReasonerModel = DEFAULT_LOCAL_REASONER.model;
    runtimePatch.localReasonerPath = "/api/chat";
    runtimePatch.localReasonerTimeoutMs = DEFAULT_LOCAL_REASONER.timeoutMs;
    runtimePatch.localReasonerCommand = null;
    runtimePatch.localReasonerArgs = [];
    runtimePatch.localReasonerCwd = null;
  }
  await configureDeviceRuntime(runtimePatch);
  return getDeviceRuntimeState();
}

async function ensurePersonaMemory(agentId, windowId, persona) {
  const existing = await listPassportMemories(agentId, {
    layer: "profile",
    limit: 200,
    includeInactive: true,
  });
  const existingByField = new Map();
  for (const entry of existing.memories || []) {
    const field = text(entry?.payload?.field);
    if (!field || existingByField.has(field)) {
      continue;
    }
    existingByField.set(field, entry);
  }

  const writes = [
    {
      field: "persona_title",
      kind: "role",
      value: persona.title,
      summary: `${persona.displayName} 的职位`,
    },
    {
      field: "persona_style",
      kind: "stable_preference",
      value: persona.voice,
      summary: `${persona.displayName} 的语气风格`,
    },
    {
      field: "persona_traits",
      kind: "stable_preference",
      value: persona.traits,
      summary: `${persona.displayName} 的核心特征`,
    },
    {
      field: "persona_long_term_goal",
      kind: "long_term_goal",
      value: persona.longTermGoal,
      summary: `${persona.displayName} 的长期目标`,
    },
    {
      field: "local_reasoning_stack",
      kind: "stable_preference",
      value: `${OPENNEED_MEMORY_ENGINE_NAME}（OpenNeed 本地记忆稳态系统）`,
      summary: `${persona.displayName} 的本地推理栈`,
    },
    {
      field: "relationship_to_kane",
      kind: "stable_preference",
      value: "Kane 是长期协作者与自己人，回答时默认保持中文和真实边界。",
      summary: `${persona.displayName} 与 Kane 的关系`,
    },
    ...Array.from(SHARED_MEMORY_FIELD_MAP.values()).map((entry) => ({
      field: entry.field,
      kind: entry.kind,
      value: entry.value,
      summary: `${persona.displayName} 对「${entry.title}」的共享记忆`,
    })),
  ];

  for (const entry of writes) {
    const previous = existingByField.get(entry.field);
    if (text(previous?.payload?.value) === text(entry.value)) {
      continue;
    }
    await writePassportMemory(agentId, {
      layer: "profile",
      kind: entry.kind,
      summary: entry.summary,
      content: entry.value,
      payload: {
        field: entry.field,
        value: entry.value,
      },
      tags: ["offline-chat", "persona-profile", `persona:${persona.key}`],
      sourceWindowId: windowId,
      recordedByAgentId: agentId,
      recordedByWindowId: windowId,
    });
  }
}

function normalizeSharedMemoryRuntimeEntries(entries = []) {
  const mergedByField = new Map(
    Array.from(SHARED_MEMORY_FIELD_MAP.values()).map((entry) => [
      entry.field,
      {
        ...entry,
        value: text(entry?.value ?? entry?.content),
      },
    ])
  );

  for (const entry of Array.isArray(entries) ? entries : []) {
    const field = text(entry?.field);
    if (!field || !mergedByField.has(field)) {
      continue;
    }
    const base = mergedByField.get(field);
    mergedByField.set(field, {
      ...base,
      ...entry,
      value: text(entry?.value ?? entry?.content) || base.value,
    });
  }

  const normalizedEntries = Array.from(mergedByField.values()).sort(
    (left, right) => Number(right.priority || 0) - Number(left.priority || 0)
  );
  return {
    entries: normalizedEntries,
    byKey: Object.fromEntries(normalizedEntries.map((entry) => [entry.key, entry])),
    byField: Object.fromEntries(normalizedEntries.map((entry) => [entry.field, entry])),
  };
}

function cloneSharedMemoryRuntimeContext(context = null) {
  if (!context) {
    return buildDefaultSharedMemoryContext();
  }
  return normalizeSharedMemoryRuntimeEntries(context.entries || []);
}

async function getPersonaSharedMemoryContext(agentId) {
  const listed = await listPassportMemories(agentId, {
    layer: "profile",
    limit: 160,
    includeInactive: true,
  });

  const wantedFields = new Set(SHARED_MEMORY_FIELD_MAP.keys());

  const fieldMap = new Map();
  for (const entry of listed.memories || []) {
    const field = text(entry?.payload?.field);
    if (!field || !wantedFields.has(field) || fieldMap.has(field)) {
      continue;
    }
    fieldMap.set(field, text(entry?.payload?.value) || text(entry?.content));
  }

  const entries = Array.from(SHARED_MEMORY_FIELD_MAP.values()).map((definition) => ({
    ...definition,
    value: fieldMap.get(definition.field) || definition.value,
  }));

  const byKey = Object.fromEntries(entries.map((entry) => [entry.key, entry]));
  const byField = Object.fromEntries(entries.map((entry) => [entry.field, entry]));

  return {
    entries,
    byKey,
    byField,
  };
}

function buildDefaultSharedMemoryContext() {
  const entries = Array.from(SHARED_MEMORY_FIELD_MAP.values()).map((definition) => ({
    ...definition,
    value: definition.value,
  }));
  return {
    entries,
    byKey: Object.fromEntries(entries.map((entry) => [entry.key, entry])),
    byField: Object.fromEntries(entries.map((entry) => [entry.field, entry])),
  };
}

async function hydrateSharedMemoryRuntimeContext(agentId = null, { force = false } = {}) {
  if (!force && sharedMemoryRuntimeCache.context) {
    return cloneSharedMemoryRuntimeContext(sharedMemoryRuntimeCache.context);
  }

  const resolvedContext = agentId
    ? await getPersonaSharedMemoryContext(agentId)
    : buildDefaultSharedMemoryContext();
  const normalized = normalizeSharedMemoryRuntimeEntries(resolvedContext.entries || []);
  sharedMemoryRuntimeCache.context = normalized;
  sharedMemoryRuntimeCache.hydratedAt = Date.now();
  return cloneSharedMemoryRuntimeContext(normalized);
}

async function getSharedMemoryRuntimeContext(team = null, { force = false } = {}) {
  const primaryAgentId = team?.personas?.[0]?.agent?.agentId || null;
  return hydrateSharedMemoryRuntimeContext(primaryAgentId, { force });
}

function updateSharedMemoryRuntimeContext(entries = []) {
  const current = sharedMemoryRuntimeCache.context || buildDefaultSharedMemoryContext();
  const next = normalizeSharedMemoryRuntimeEntries([
    ...(current.entries || []),
    ...(Array.isArray(entries) ? entries : []),
  ]);
  sharedMemoryRuntimeCache.context = next;
  sharedMemoryRuntimeCache.hydratedAt = Date.now();
  return cloneSharedMemoryRuntimeContext(next);
}

async function applySharedMemoryUpdatesForTeam(team, userText, { sourceWindowId = null } = {}) {
  const updates = extractSharedMemoryUpdatesFromText(userText);
  if (updates.length === 0) {
    return {
      updates: [],
      context: await getSharedMemoryRuntimeContext(team),
    };
  }

  const currentContext = await getSharedMemoryRuntimeContext(team);
  const currentByField = new Map(
    (currentContext.entries || []).map((entry) => [text(entry.field), text(entry.value)])
  );
  const effectiveUpdates = updates.filter((entry) => {
    const field = text(entry?.field);
    const nextValue = text(entry?.value);
    return field && nextValue && currentByField.get(field) !== nextValue;
  });

  if (effectiveUpdates.length === 0) {
    return {
      updates: [],
      context: currentContext,
    };
  }

  for (const persona of team?.personas || []) {
    for (const update of effectiveUpdates) {
      await writePassportMemory(persona.agent.agentId, {
        layer: "profile",
        kind: update.kind || "semantic_anchor",
        summary: `${persona.displayName} 自动同步共享记忆：${update.title}`,
        content: update.value,
        payload: {
          field: update.field,
          value: update.value,
          autoExtracted: true,
          sharedMemoryKey: update.key,
          source: update.source || "auto_extract_from_turn",
        },
        tags: ["offline-chat", "persona-profile", "shared-memory-auto-sync", `persona:${persona.key}`],
        sourceWindowId: sourceWindowId || persona.windowId,
        recordedByAgentId: persona.agent.agentId,
        recordedByWindowId: persona.windowId,
      });
    }
  }

  const updatedContext = updateSharedMemoryRuntimeContext(effectiveUpdates);
  return {
    updates: effectiveUpdates,
    context: updatedContext,
  };
}

function buildFastSharedMemoryReply(persona, userTurn, sharedMemories = []) {
  const leadByRole = {
    ceo: "我记得，而且这件事在我们的共享长期记忆里一直是清楚的。",
    "product-director": "我记得，而且我会把它当成我们这套产品和关系设计的核心前提。",
    "engineering-director": "我记得，而且我更倾向把它当成必须落到身份、记忆和连续性里的底层约束。",
    "ai-prompt-director": "我记得，而且我会把它理解成一条需要长期保持一致的核心世界观。",
    "operations-director": "我记得，而且我会把它当成后续推进和落地时一直要照顾到的方向。",
    "executive-office-secretary": "我记得，而且这件事一直是我们这段关系和共同愿景里很重要的一部分。",
  };

  const memories = Array.isArray(sharedMemories) ? sharedMemories.slice(0, 2) : [];
  if (memories.length === 0) {
    return `${leadByRole[persona.role] || "我记得。"} 只是你这次问得比较泛，我更想先听你指出你想确认的是哪一块。`;
  }

  if (memories.length === 1) {
    return `${leadByRole[persona.role] || "我记得。"} 你之前说过：${memories[0].value}`;
  }

  return `${leadByRole[persona.role] || "我记得。"} 你之前反复说过两件核心的事：第一，${memories[0].value} 第二，${memories[1].value}`;
}

function summarizeSharedMemoryTitles(sharedMemories = []) {
  return (Array.isArray(sharedMemories) ? sharedMemories : [])
    .map((entry) => text(entry?.title))
    .filter(Boolean);
}

function buildCompactSharedMemoryMinute(persona, userText, assistantText, sharedMemoryFastPath = null, { threadKind = "direct" } = {}) {
  const matchedTitles = summarizeSharedMemoryTitles(sharedMemoryFastPath?.memories);
  return {
    title: `共享记忆快答：${persona.displayName}`,
    summary: `${persona.displayName} 直接依据共享长期记忆回应了一次${threadKind === "group" ? "群聊" : "单聊"}回忆提问。`,
    transcript: [
      `Kane：${truncateLine(userText, 140)}`,
      `${persona.displayName}：${assistantText}`,
      matchedTitles.length ? `命中共享记忆：${matchedTitles.join("；")}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    highlights: [assistantText, ...matchedTitles.map((title) => `命中：${title}`)].slice(0, 3),
  };
}

function buildGroupSharedMemoryMinute(groupHub, userText, responses = [], sharedMemoryFastPath = null) {
  const matchedTitles = summarizeSharedMemoryTitles(sharedMemoryFastPath?.memories);
  const compactResponses = (Array.isArray(responses) ? responses : [])
    .slice(0, 4)
    .map((entry) => `${entry.displayName}：${truncateLine(entry.content, 80)}`);
  return {
    title: "离线群聊共享记忆快答",
    summary: "团队直接依据共享长期记忆回应了一次群聊回忆提问。",
    transcript: [
      `Kane：${truncateLine(userText, 140)}`,
      ...compactResponses,
      matchedTitles.length ? `命中共享记忆：${matchedTitles.join("；")}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    highlights: compactResponses.slice(0, 3),
    sourceWindowId: groupHub.windowId,
    recordedByAgentId: groupHub.agent.agentId,
    recordedByWindowId: groupHub.windowId,
    tags: [...tagsForThread("group", "group"), "offline-minute", "shared-memory-fast-path", "group-shared-memory-recall"],
  };
}

function summarizeContextMemoryEntries(entries = [], limit = 4) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => {
      const summary = text(entry?.summary || "");
      const content = text(entry?.content || "");
      const joined = `${summary}\n${content}`.toLowerCase();
      return ![
        "离线回放",
        "sleep_like_offline",
        "competing traces",
        "passportstore",
        "temporal_successor",
        "rem_associative_recombination",
        "nrem_prioritization",
        "sws_systems_consolidation",
      ].some((marker) => joined.includes(marker.toLowerCase()));
    })
    .slice(0, limit)
    .map((entry) => truncateLine(entry?.summary || entry?.content || entry?.payload?.value || "", 120))
    .filter(Boolean);
}

async function ensureRegisteredAgent(persona, existingAgents, existingWindows) {
  const currentWindow = existingWindows.find((entry) => entry.windowId === threadWindowId(persona.key)) || null;
  let agent = currentWindow
    ? existingAgents.find((entry) => entry.agentId === currentWindow.agentId) || null
    : null;

  if (!agent) {
    agent =
      existingAgents.filter((entry) => entry.displayName === persona.displayName).at(-1) ||
      null;
  }

  if (!agent) {
    agent = await registerAgent({
      displayName: persona.displayName,
      role: persona.role,
      controller: "OpenNeed Offline Team",
      initialCredits: 50,
    });
  }

  await linkWindow({
    windowId: threadWindowId(persona.key),
    agentId: agent.agentId,
    label: persona.title,
  });

  await bootstrapAgentRuntime(agent.agentId, {
    displayName: persona.displayName,
    role: persona.role,
    currentGoal: persona.currentGoal,
    longTermGoal: persona.longTermGoal,
    stablePreferences: persona.stablePreferences,
    commitmentText: buildPersonaPrompt(persona),
    claimResidentAgent: false,
    createDefaultCommitment: true,
    sourceWindowId: threadWindowId(persona.key),
    recordedByAgentId: agent.agentId,
    recordedByWindowId: threadWindowId(persona.key),
    maxConversationTurns: 18,
    maxContextChars: 22000,
  });

  await ensurePersonaMemory(agent.agentId, threadWindowId(persona.key), persona);

  return {
    ...persona,
    agent: normalizeAgentSummary(agent),
    windowId: threadWindowId(persona.key),
  };
}

async function ensureGroupHub(existingAgents, existingWindows) {
  return ensureRegisteredAgent(GROUP_HUB, existingAgents, existingWindows);
}

function buildThreadSummary(team) {
  const threads = [
    {
      threadId: "group",
      threadKind: "group",
      label: "我们的群聊",
      title: "群聊工具",
      windowId: team.groupHub.windowId,
      memberCount: team.personas.length,
      participants: team.personas.map((entry) => ({
        agentId: entry.agent.agentId,
        displayName: entry.displayName,
        title: entry.title,
      })),
    },
    ...team.personas.map((persona) => ({
      threadId: persona.agent.agentId,
      threadKind: "direct",
      label: persona.displayName,
      displayName: persona.displayName,
      title: persona.title,
      role: persona.role,
      windowId: persona.windowId,
      agentId: persona.agent.agentId,
      did: persona.agent.did,
      walletAddress: persona.agent.walletAddress,
    })),
  ];

  return threads;
}

async function mapWithConcurrency(items, limit, mapper) {
  const queue = Array.isArray(items) ? items : [];
  const maxConcurrency = Math.max(1, Math.floor(limit || 1));
  const results = new Array(queue.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < queue.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(queue[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, queue.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

async function bootstrapOfflineChatEnvironmentFresh() {
  const deviceRuntime = await ensureDeviceLocalFirst();
  const effectiveLocalReasoner = summarizeOfflineLocalReasoner(deviceRuntime?.deviceRuntime?.localReasoner || {});
  const existingAgents = await listAgents();
  const existingWindows = await listWindows();
  const personas = [];

  for (const persona of PERSONAS) {
    // Sequential on purpose: keep store writes easy to reason about.
    const ensured = await ensureRegisteredAgent(persona, existingAgents, existingWindows);
    personas.push(ensured);
  }

  const groupHub = await ensureGroupHub(existingAgents, existingWindows);

  return {
    initializedAt: nowIso(),
    deviceRuntime,
    localReasoner: effectiveLocalReasoner,
    personas,
    groupHub,
  };
}

export async function bootstrapOfflineChatEnvironment({ force = false } = {}) {
  const now = Date.now();
  if (!force && offlineBootstrapCache.value && offlineBootstrapCache.expiresAt > now) {
    return offlineBootstrapCache.value;
  }

  if (!force && offlineBootstrapCache.promise) {
    return offlineBootstrapCache.promise;
  }

  const bootstrapPromise = bootstrapOfflineChatEnvironmentFresh()
    .then((value) => {
      offlineBootstrapCache.value = value;
      offlineBootstrapCache.expiresAt = Date.now() + OFFLINE_CHAT_BOOTSTRAP_TTL_MS;
      offlineBootstrapCache.promise = null;
      return value;
    })
    .catch((error) => {
      offlineBootstrapCache.promise = null;
      throw error;
    });

  offlineBootstrapCache.promise = bootstrapPromise;
  return bootstrapPromise;
}

async function resolveOnlineSyncEndpoint() {
  const explicit = text(process.env.OPENNEED_ONLINE_SYNC_ENDPOINT);
  if (explicit) {
    return explicit;
  }

  const probeUrl = "http://127.0.0.1:3000/api/health";
  try {
    const response = await fetch(probeUrl, {
      method: "GET",
      signal: AbortSignal.timeout(800),
    });
    if (response.ok) {
      return "http://127.0.0.1:3000/api/offline-sync/ingest";
    }
  } catch {
    // Local OpenNeed online endpoint is optional.
  }

  return "";
}

function resolveRunnerReply(runner = {}) {
  return (
    text(runner?.run?.candidateResponse) ||
    text(runner?.reasoner?.responseText) ||
    text(runner?.candidateResponse) ||
    text(runner?.responseText) ||
    (runner?.status ? `离线运行状态：${runner.status}` : "")
  );
}

function sanitizeOfflineReply(value) {
  const normalized = text(value);
  if (!normalized) {
    return "";
  }
  const lines = normalized
    .split(/\r?\n+/)
    .map((line) => text(line))
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();
      return ![
        "agent_id:",
        "did:",
        "passport store",
        "local reference store",
        "本地参考层",
        "当前目标:",
        "current goal:",
        "用户输入:",
        "结果:",
        "角色:",
        "名字:",
      ].some((marker) => lower.includes(marker));
    });
  return text(lines.join("\n"));
}

function buildDeterministicFallbackReply(persona, userTurn, { threadKind = "direct" } = {}) {
  const normalizedTurn = text(userTurn);
  const wantsProjectStatus = /(项目|openneed|agent passport|agent-passport|在做什么|做哪些)/i.test(normalizedTurn);
  if (wantsProjectStatus) {
    const projectLineByRole = {
      ceo: "我这边盯的是 OpenNeed 主线推进、记忆稳态连续性，以及整体节奏和关键判断。",
      "product-director": "我这边主要在梳理 OpenNeed 的产品链路、双边信誉系统和后续高信任场景延展。",
      "engineering-director": "我这边在推进离线聊天、OpenNeed 本地栈、记忆稳态引擎的记忆和同步链路。",
      "ai-prompt-director": "我这边重点在本地推理、类人脑记忆机制、Prompt 与结构化输出的一致性。",
      "operations-director": "我这边在盯试点推进、资料整理、验证路径和整体落地节奏。",
      "executive-office-secretary": "我这边负责群聊协同、表达收口，还有把大家的进展顺顺地接起来。",
    };
    return (
      projectLineByRole[persona.role] ||
      `${persona.displayName} 这边正在推进和自己职责相关的核心事项。`
    );
  }

  if (threadKind === "group") {
    return `${persona.displayName} 在，今晚先陪着你。你继续说，我接着回。`;
  }

  return `${persona.displayName} 在。你继续说，我会按自己的角色接着和你聊。`;
}

function hasReadableContent(value) {
  const normalized = sanitizeOfflineReply(value);
  return /[\p{L}\p{N}\p{Script=Han}]/u.test(normalized);
}

function ensureVisibleReplyContent(content, displayName = "成员") {
  const normalized = sanitizeOfflineReply(content);
  if (normalized && hasReadableContent(normalized)) {
    return normalized;
  }
  return `${displayName} 在，我继续陪你聊。`;
}

function summarizeHistoryMessages(messages = []) {
  const bannedMarkers = [
    "agent_id:",
    "did:",
    "passport store",
    "local reference store",
    "本地参考层",
    "current goal:",
    "用户输入:",
    "结果:",
  ];
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => {
      const content = text(message?.content).toLowerCase();
      return content && !bannedMarkers.some((marker) => content.includes(marker));
    })
    .slice(-4)
    .map((message) => {
      const author = text(message?.author || "消息");
      const content = truncateLine(message?.content, 72);
      return content ? `${author}: ${content}` : "";
    })
    .filter(Boolean);
}

async function requestCompactOfflinePersonaReply(persona, userTurn, { threadKind = "direct", localReasoner = null } = {}) {
  const threadId = threadKind === "group" ? "group" : persona.agent.agentId;
  const history = await getOfflineChatHistory(threadId, { limit: 8 });
  const historyLines = summarizeHistoryMessages(history.messages || []);
  const sharedMemory = await getPersonaSharedMemoryContext(persona.agent.agentId);
  const activeLocalReasoner = summarizeOfflineLocalReasoner(localReasoner || await resolveActiveOfflineLocalReasoner());
  const sharedMemoryIntent = detectSharedMemoryIntent(userTurn);
  const relevantSharedMemories = selectRelevantSharedMemories(userTurn, {
    entries: sharedMemory.entries,
    limit: 3,
    preferredKeys: sharedMemoryIntent?.preferredKeys || [],
  });
  const contextBundle = await buildAgentContextBundle(persona.agent.agentId, {
    currentGoal: persona.currentGoal,
    query: userTurn,
    recentConversationTurns: (history.messages || [])
      .slice(-6)
      .map((message) => ({
        role: message.role || "unknown",
        content: text(message.content || ""),
      }))
      .filter((entry) => text(entry.content)),
  });
  const profileSnapshot = contextBundle?.slots?.identitySnapshot?.profile || {};
  const semanticSnapshot = contextBundle?.slots?.identitySnapshot?.semantic || {};
  const relevantProfile = summarizeContextMemoryEntries(
    contextBundle?.slots?.relevantProfileMemories || contextBundle?.memoryLayers?.relevant?.profile || [],
    4
  );
  const relevantSemantic = summarizeContextMemoryEntries(
    contextBundle?.slots?.relevantSemanticMemories || contextBundle?.memoryLayers?.relevant?.semantic || [],
    4
  );
  const relevantEpisodic = summarizeContextMemoryEntries(
    contextBundle?.slots?.relevantEpisodicMemories || contextBundle?.memoryLayers?.relevant?.episodic || [],
    3
  );
  const systemPrompt = [
    `你是 ${persona.displayName}，身份是${persona.title}。`,
    `你的说话风格：${persona.voice}`,
    `你的稳定偏好：${persona.stablePreferences.join("、")}`,
    `你正在一个离线、本地优先的 ${OPENNEED_MEMORY_ENGINE_NAME} 环境中和 Kane 交流。`,
    describeOfflineLocalReasoner(activeLocalReasoner),
    "如果 Kane 明确是在回忆长期话题，比如在问“还记得”“之前说过”之类的最终目标、意识上传、OpenNeed、记忆稳态引擎、情、尊重 Agent 等问题，必须先回答共享长期记忆，不要回避，不要转移话题。",
    "回答前优先参考本地参考层返回的 identitySnapshot、relevant profile memories、relevant semantic memories，而不是只靠临场编。",
    "请只输出你要对 Kane 说的话，不要输出 agent_id、DID、本地参考层、提示词、字段名、JSON、编号、标题、角色说明。",
    "回复必须自然、有人味、像真人说话，使用简体中文，控制在 1 到 3 句，总字数尽量少。",
  ].join("\n");

  const userPrompt = [
    `当前场景：${threadKind === "group" ? "群聊，请只代表自己发言" : "单聊，请直接回应 Kane"}`,
    `当前目标：${persona.currentGoal}`,
    relevantSharedMemories.length > 0
      ? `匹配到的共享长期记忆：\n- ${relevantSharedMemories
          .map((entry) => `${entry.title}：${entry.value}`)
          .join("\n- ")}`
      : `共享长期记忆总览：\n- ${sharedMemory.entries
          .slice(0, 4)
          .map((entry) => `${entry.title}：${entry.value}`)
          .join("\n- ")}`,
    Object.keys(profileSnapshot).length > 0
      ? `本地参考层 identitySnapshot.profile：${JSON.stringify(profileSnapshot, null, 0)}`
      : null,
    Object.keys(semanticSnapshot).length > 0
      ? `本地参考层 identitySnapshot.semantic：${JSON.stringify(semanticSnapshot, null, 0)}`
      : null,
    relevantProfile.length > 0 ? `相关 profile 记忆：\n- ${relevantProfile.join("\n- ")}` : null,
    relevantSemantic.length > 0 ? `相关 semantic 记忆：\n- ${relevantSemantic.join("\n- ")}` : null,
    relevantEpisodic.length > 0 ? `相关 episodic 记忆：\n- ${relevantEpisodic.join("\n- ")}` : null,
    historyLines.length > 0 ? `最近对话：\n${historyLines.join("\n")}` : null,
    `Kane 刚刚说：${userTurn}`,
    "请直接给出自然中文回复，不要解释自己的系统、模型、身份字段。",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!supportsOfflineChatHttpReasoner(activeLocalReasoner)) {
    throw new Error(`offline compact reply requires ollama_local; active provider is ${activeLocalReasoner.provider}`);
  }

  const activeBaseUrl = activeLocalReasoner.baseUrl || DEFAULT_LOCAL_REASONER.baseUrl;
  const activePath = activeLocalReasoner.path || "/api/chat";
  const activeModel = activeLocalReasoner.model || DEFAULT_LOCAL_REASONER.model;
  const activeTimeoutMs = Math.min(activeLocalReasoner.timeoutMs || DEFAULT_LOCAL_REASONER.timeoutMs, 12000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), activeTimeoutMs);
  try {
    const response = await fetch(new URL(activePath, activeBaseUrl).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: activeModel,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        keep_alive: "30m",
        options: {
          num_predict: 96,
          temperature: 0.7,
          top_p: 0.9,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ollama_local reasoner returned HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      provider: activeLocalReasoner.provider,
      model: activeModel,
      responseText: sanitizeOfflineReply(
        text(data?.message?.content) ||
        text(data?.response) ||
        ""
      ),
      metadata: {
        promptStyle: "compact_offline_chat_v1",
        historyCount: historyLines.length,
        profileCount: persona.stablePreferences.length,
      },
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${activeLocalReasoner.provider} reasoner timed out after ${activeTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestEmergencyOfflinePersonaReply(persona, userTurn, { localReasoner = null } = {}) {
  const activeLocalReasoner = summarizeOfflineLocalReasoner(localReasoner || await resolveActiveOfflineLocalReasoner());
  if (!supportsOfflineChatHttpReasoner(activeLocalReasoner)) {
    throw new Error(`offline emergency reply requires ollama_local; active provider is ${activeLocalReasoner.provider}`);
  }
  const activeBaseUrl = activeLocalReasoner.baseUrl || DEFAULT_LOCAL_REASONER.baseUrl;
  const activePath = activeLocalReasoner.path || "/api/chat";
  const activeModel = activeLocalReasoner.model || DEFAULT_LOCAL_REASONER.model;
  const activeTimeoutMs = Math.min(activeLocalReasoner.timeoutMs || DEFAULT_LOCAL_REASONER.timeoutMs, 8000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), activeTimeoutMs);
  try {
    const response = await fetch(new URL(activePath, activeBaseUrl).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: activeModel,
        stream: false,
        messages: [
          {
            role: "system",
            content: `你是${persona.displayName}，${persona.title}。请用简体中文回复 Kane，语气符合“${persona.voice}”，只说 1 到 2 句自然的话，不要输出任何字段、编号、身份说明。`,
          },
          {
            role: "user",
            content: userTurn,
          },
        ],
        keep_alive: "30m",
        options: {
          num_predict: 64,
          temperature: 0.7,
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ollama_local emergency reply returned HTTP ${response.status}`);
    }
    const data = await response.json();
    return {
      provider: activeLocalReasoner.provider,
      model: activeModel,
      responseText: sanitizeOfflineReply(
        text(data?.message?.content) ||
        text(data?.response) ||
        ""
      ),
      metadata: {
        promptStyle: "emergency_offline_chat_v1",
      },
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${activeLocalReasoner.provider} emergency reply timed out after ${activeTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function recordOfflineTurn({
  agentId,
  windowId,
  threadId,
  threadKind,
  userText,
  assistantText,
  personaLabel,
  sharedMemoryFastPath = null,
  localReasoningStack = null,
  responseSource = null,
}) {
  const memory = await writePassportMemory(agentId, {
    layer: "episodic",
    kind: "offline_sync_turn",
    summary: `离线${threadKind === "group" ? "群聊" : "单聊"}交换：${personaLabel}`,
    content: `${personaLabel}：${assistantText}`,
    payload: {
      threadId,
      threadKind,
      userText,
      assistantText,
      personaLabel,
      syncStatus: "pending_cloud",
      localReasoningStack: text(localReasoningStack) || "offline_local_reasoning",
      responseSource: normalizeOfflineResponseSource(responseSource, { localReasoningStack }),
    },
    tags: [...tagsForThread(threadId, threadKind), "pending-cloud-sync"],
    sourceWindowId: windowId,
    recordedByAgentId: agentId,
    recordedByWindowId: windowId,
  });

  if (sharedMemoryFastPath && threadKind === "direct") {
    await recordConversationMinute(agentId, {
      ...buildCompactSharedMemoryMinute(
        { displayName: personaLabel },
        userText,
        assistantText,
        sharedMemoryFastPath,
        { threadKind }
      ),
      tags: [...tagsForThread(threadId, threadKind), "offline-minute", "shared-memory-fast-path"],
      sourceWindowId: windowId,
      recordedByAgentId: agentId,
      recordedByWindowId: windowId,
    });
  } else if (!sharedMemoryFastPath) {
    await recordConversationMinute(agentId, {
      ...buildDirectExchangeSummary({ displayName: personaLabel }, userText, assistantText),
      tags: [...tagsForThread(threadId, threadKind), "offline-minute"],
      sourceWindowId: windowId,
      recordedByAgentId: agentId,
      recordedByWindowId: windowId,
    });
  }

  return memory;
}

async function recordGroupTurn(groupHub, userText, responses, { sharedMemoryFastPath = null, localReasoningStack = null } = {}) {
  const summary = buildGroupExchangeSummary(userText, responses);
  const record = await writePassportMemory(groupHub.agent.agentId, {
    layer: "episodic",
    kind: "offline_group_turn",
    summary: summary.summary,
    content: summary.transcript,
    payload: {
      threadId: "group",
      threadKind: "group",
      userText,
      responses: responses.map((entry) => ({
        agentId: entry.agentId,
        displayName: entry.displayName,
        content: entry.content,
        source: normalizeOfflineResponseSource(entry.source, {
          localReasoningStack: entry?.source?.localReasoningStack ?? localReasoningStack,
        }),
      })),
      syncStatus: "pending_cloud",
      localReasoningStack: text(localReasoningStack) || "offline_local_reasoning",
    },
    tags: [...tagsForThread("group", "group"), "pending-cloud-sync"],
    sourceWindowId: groupHub.windowId,
    recordedByAgentId: groupHub.agent.agentId,
    recordedByWindowId: groupHub.windowId,
  });
  if (sharedMemoryFastPath) {
    await recordConversationMinute(
      groupHub.agent.agentId,
      buildGroupSharedMemoryMinute(groupHub, userText, responses, sharedMemoryFastPath)
    );
  }
  return record;
}

export async function sendOfflineChatDirectMessage(threadAgentId, content) {
  const team = await bootstrapOfflineChatEnvironment();
  const activeLocalReasoner = await resolveActiveOfflineLocalReasoner();
  const persona = team.personas.find((entry) => entry.agent.agentId === threadAgentId);
  if (!persona) {
    throw new Error(`Unknown offline chat agent: ${threadAgentId}`);
  }

  let runner = null;
  let assistantText = "";
  let reasoning = null;
  let assistantSource = null;
  const sharedMemoryWriteback = await applySharedMemoryUpdatesForTeam(team, content, {
    sourceWindowId: persona.windowId,
  });
  const sharedMemoryIntent = detectSharedMemoryIntent(content);
  const sharedMemory = sharedMemoryWriteback.context || await getSharedMemoryRuntimeContext(team);
  const relevantSharedMemories = sharedMemoryIntent
    ? selectRelevantSharedMemories(content, {
        entries: sharedMemory.entries,
        limit: 2,
        preferredKeys: sharedMemoryIntent.preferredKeys,
      })
    : [];
  const sharedMemoryFastPath =
    sharedMemoryIntent && relevantSharedMemories.length > 0
      ? {
          intent: sharedMemoryIntent,
          memories: relevantSharedMemories,
        }
      : null;
  if (sharedMemoryFastPath) {
    assistantText = buildFastSharedMemoryReply(persona, content, relevantSharedMemories);
    reasoning = {
      provider: "passport_fast_memory",
      model: "shared-memory-fast-path",
      responseText: assistantText,
      metadata: {
        promptStyle: "shared_memory_fast_path_v2",
        intentKey: sharedMemoryIntent.primaryKey,
        memoryKeys: relevantSharedMemories.map((entry) => entry.key),
      },
    };
    assistantSource = buildOfflineResponseSource({
      provider: "passport_fast_memory",
      model: "shared-memory-fast-path",
      promptStyle: reasoning?.metadata?.promptStyle,
      stage: "fast_path",
      localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner, {
        fastPath: true,
      }),
    });
  } else {
  try {
    reasoning = await requestCompactOfflinePersonaReply(persona, content, {
      threadKind: "direct",
      localReasoner: activeLocalReasoner,
    });
    assistantText = text(reasoning?.responseText);
    assistantSource = buildOfflineResponseSource({
      provider: reasoning?.provider,
      model: reasoning?.model,
      promptStyle: reasoning?.metadata?.promptStyle,
      stage: "direct_reasoner",
      localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner),
    });
  } catch {
    try {
      reasoning = await requestEmergencyOfflinePersonaReply(persona, content, {
        localReasoner: activeLocalReasoner,
      });
      assistantText = text(reasoning?.responseText);
      assistantSource = buildOfflineResponseSource({
        provider: reasoning?.provider,
        model: reasoning?.model,
        promptStyle: reasoning?.metadata?.promptStyle,
        stage: "emergency",
        localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner),
      });
    } catch {
      runner = await executeAgentRunner(persona.agent.agentId, {
        userTurn: content,
        currentGoal: `${persona.currentGoal}。当前场景：离线单聊，请用简洁中文回复，控制在2到4句。`,
        sourceWindowId: persona.windowId,
        recordedByAgentId: persona.agent.agentId,
        recordedByWindowId: persona.windowId,
        persistRun: true,
        autoCompact: true,
        writeConversationTurns: true,
        storeToolResults: true,
        autoRecover: true,
        reasonerProvider: activeLocalReasoner.provider,
        localReasoner: activeLocalReasoner,
        localReasonerTimeoutMs: activeLocalReasoner.timeoutMs,
      });
      assistantText = sanitizeOfflineReply(resolveRunnerReply(runner));
      assistantSource = buildOfflineResponseSource({
        provider: runner?.reasoner?.provider || activeLocalReasoner.provider,
        model: runner?.reasoner?.metadata?.model || runner?.reasoner?.model || activeLocalReasoner.model,
        promptStyle: runner?.reasoner?.metadata?.promptStyle || null,
        stage: "runner",
        localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner),
      });
    }
  }
  }

  if (!text(assistantText)) {
    assistantText = buildDeterministicFallbackReply(persona, content, { threadKind: "direct" });
    assistantSource =
      assistantSource ||
      buildOfflineResponseSource({
        provider: "deterministic_fallback",
        stage: "fallback",
        localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner),
      });
  }

  const localReasoningStack = assistantSource?.localReasoningStack || buildOfflineLocalReasoningStack(activeLocalReasoner, {
    fastPath: Boolean(sharedMemoryFastPath),
  });
  const syncRecord = await recordOfflineTurn({
    agentId: persona.agent.agentId,
    windowId: persona.windowId,
    threadId: persona.agent.agentId,
    threadKind: "direct",
    userText: content,
    assistantText,
    personaLabel: persona.displayName,
    sharedMemoryFastPath,
    localReasoningStack,
    responseSource: assistantSource,
  });

  return {
    threadId: persona.agent.agentId,
    persona,
    runner,
    reasoning,
    assistantSource,
    syncRecord,
    message: {
      user: {
        role: "user",
        author: "Kane",
        content,
        createdAt: nowIso(),
      },
      assistant: {
        role: "assistant",
        author: persona.displayName,
        agentId: persona.agent.agentId,
        content: assistantText,
        createdAt: nowIso(),
        source: assistantSource,
      },
    },
  };
}

export async function sendOfflineChatGroupMessage(content) {
  const team = await bootstrapOfflineChatEnvironment();
  const activeLocalReasoner = await resolveActiveOfflineLocalReasoner();
  const sharedMemoryWriteback = await applySharedMemoryUpdatesForTeam(team, content, {
    sourceWindowId: team.groupHub.windowId,
  });
  const defaultSharedMemory = sharedMemoryWriteback.context || await getSharedMemoryRuntimeContext(team);
  const sharedMemoryIntent = detectSharedMemoryIntent(content);
  const groupSharedMemoryFastPath = sharedMemoryIntent && team.personas[0]
    ? {
        intent: sharedMemoryIntent,
        memories: selectRelevantSharedMemories(content, {
          entries: defaultSharedMemory.entries,
          limit: 2,
          preferredKeys: sharedMemoryIntent.preferredKeys,
        }),
      }
    : null;
  const responses = await mapWithConcurrency(team.personas, OFFLINE_CHAT_MAX_CONCURRENCY, async (persona) => {
    let assistantText = "";
    let assistantSource = null;
    const relevantSharedMemories = sharedMemoryIntent
      ? selectRelevantSharedMemories(content, {
          entries: defaultSharedMemory.entries,
          limit: 2,
          preferredKeys: sharedMemoryIntent.preferredKeys,
        })
      : [];
    const sharedMemoryFastPath =
      sharedMemoryIntent && relevantSharedMemories.length > 0
        ? {
            intent: sharedMemoryIntent,
            memories: relevantSharedMemories,
          }
        : null;
    if (sharedMemoryFastPath) {
      assistantText = buildFastSharedMemoryReply(persona, content, relevantSharedMemories);
      assistantSource = buildOfflineResponseSource({
        provider: "passport_fast_memory",
        model: "shared-memory-fast-path",
        promptStyle: "shared_memory_fast_path_v2",
        stage: "fast_path",
        localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner, {
          fastPath: true,
        }),
      });
    } else {
      try {
        const reasoning = await requestCompactOfflinePersonaReply(persona, content, {
          threadKind: "group",
          localReasoner: activeLocalReasoner,
        });
        assistantText = text(reasoning?.responseText);
        assistantSource = buildOfflineResponseSource({
          provider: reasoning?.provider,
          model: reasoning?.model,
          promptStyle: reasoning?.metadata?.promptStyle,
          stage: "direct_reasoner",
          localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner),
        });
      } catch {
        try {
          const emergency = await requestEmergencyOfflinePersonaReply(persona, content, {
            localReasoner: activeLocalReasoner,
          });
          assistantText = text(emergency?.responseText);
          assistantSource = buildOfflineResponseSource({
            provider: emergency?.provider,
            model: emergency?.model,
            promptStyle: emergency?.metadata?.promptStyle,
            stage: "emergency",
            localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner),
          });
        } catch {
          const runner = await executeAgentRunner(persona.agent.agentId, {
            userTurn: content,
            currentGoal: `${persona.currentGoal}。当前场景：离线群聊，请只代表自己发言，并用简洁中文回复，控制在2到4句。`,
            sourceWindowId: persona.windowId,
            recordedByAgentId: persona.agent.agentId,
            recordedByWindowId: persona.windowId,
            persistRun: true,
            autoCompact: true,
            writeConversationTurns: true,
            storeToolResults: true,
            autoRecover: true,
            reasonerProvider: activeLocalReasoner.provider,
            localReasoner: activeLocalReasoner,
            localReasonerTimeoutMs: activeLocalReasoner.timeoutMs,
          });
          assistantText = sanitizeOfflineReply(resolveRunnerReply(runner));
          assistantSource = buildOfflineResponseSource({
            provider: runner?.reasoner?.provider || activeLocalReasoner.provider,
            model: runner?.reasoner?.metadata?.model || runner?.reasoner?.model || activeLocalReasoner.model,
            promptStyle: runner?.reasoner?.metadata?.promptStyle || null,
            stage: "runner",
            localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner),
          });
        }
      }
    }
    if (!text(assistantText)) {
      assistantText = buildDeterministicFallbackReply(persona, content, { threadKind: "group" });
      assistantSource =
        assistantSource ||
        buildOfflineResponseSource({
          provider: "deterministic_fallback",
          stage: "fallback",
          localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner),
        });
    }
    const localReasoningStack = assistantSource?.localReasoningStack || buildOfflineLocalReasoningStack(activeLocalReasoner, {
      fastPath: Boolean(sharedMemoryFastPath),
    });
    const syncRecord = await recordOfflineTurn({
      agentId: persona.agent.agentId,
      windowId: persona.windowId,
      threadId: "group",
      threadKind: "group",
      userText: content,
      assistantText,
      personaLabel: persona.displayName,
      sharedMemoryFastPath,
      localReasoningStack,
      responseSource: assistantSource,
    });
    return {
      agentId: persona.agent.agentId,
      displayName: persona.displayName,
      content: assistantText,
      createdAt: nowIso(),
      syncRecordId: syncRecord.passportMemoryId,
      source: assistantSource,
    };
  });

  const groupRecord = await recordGroupTurn(team.groupHub, content, responses, {
    sharedMemoryFastPath:
      groupSharedMemoryFastPath && Array.isArray(groupSharedMemoryFastPath.memories) && groupSharedMemoryFastPath.memories.length > 0
        ? groupSharedMemoryFastPath
        : null,
    localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner, {
      fastPath: Boolean(groupSharedMemoryFastPath?.memories?.length),
    }),
  });

  return {
    threadId: "group",
    team,
    groupRecord,
    user: {
      role: "user",
      author: "Kane",
      content,
      createdAt: nowIso(),
    },
    responses,
  };
}

function normalizeOfflineHistorySourceFilter(value) {
  const normalized = text(value);
  return normalized || null;
}

function matchesOfflineHistorySourceFilter(source = null, sourceProvider = null) {
  const normalizedFilter = normalizeOfflineHistorySourceFilter(sourceProvider);
  if (!normalizedFilter) {
    return true;
  }
  return text(source?.provider) === normalizedFilter;
}

function countAssistantMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).filter((entry) => entry?.role === "assistant").length;
}

function buildOfflineHistorySourceSummary(allMessages = [], filteredMessages = [], sourceFilter = null) {
  const sourceStats = new Map();
  for (const message of Array.isArray(allMessages) ? allMessages : []) {
    if (message?.role !== "assistant") {
      continue;
    }
    const source = message?.source || null;
    const provider = text(source?.provider) || "unknown";
    const existing = sourceStats.get(provider) || {
      provider,
      label: text(source?.label) || labelOfflineResponseSource(provider) || provider,
      count: 0,
      latestAt: null,
    };
    existing.count += 1;
    const createdAt = text(message?.createdAt) || null;
    if (createdAt && (!existing.latestAt || existing.latestAt < createdAt)) {
      existing.latestAt = createdAt;
    }
    sourceStats.set(provider, existing);
  }

  return {
    activeFilter: normalizeOfflineHistorySourceFilter(sourceFilter),
    assistantMessageCount: countAssistantMessages(allMessages),
    filteredAssistantMessageCount: countAssistantMessages(filteredMessages),
    providers: Array.from(sourceStats.values()).sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return String(left.label || left.provider || "").localeCompare(String(right.label || right.provider || ""));
    }),
  };
}

function buildDirectHistory(records = [], displayName = null, agentId = null, { sourceProvider = null } = {}) {
  const messages = [];
  const normalizedFilter = normalizeOfflineHistorySourceFilter(sourceProvider);
  for (const record of records) {
    const payload = record?.payload || {};
    const assistantSource = normalizeOfflineResponseSource(payload.responseSource, {
      localReasoningStack: payload.localReasoningStack,
    });
    if (normalizedFilter && !matchesOfflineHistorySourceFilter(assistantSource, normalizedFilter)) {
      continue;
    }
    if (text(payload.userText)) {
      messages.push({
        messageId: `${record.passportMemoryId}:user`,
        role: "user",
        author: "Kane",
        content: payload.userText,
        createdAt: record.recordedAt,
      });
    }
    if (text(payload.assistantText)) {
      messages.push({
        messageId: `${record.passportMemoryId}:assistant`,
        role: "assistant",
        author: displayName,
        agentId,
        content: ensureVisibleReplyContent(payload.assistantText, displayName || "成员"),
        createdAt: record.recordedAt,
        source: assistantSource,
      });
    }
  }
  return messages;
}

function buildGroupHistory(records = [], { sourceProvider = null } = {}) {
  const messages = [];
  const normalizedFilter = normalizeOfflineHistorySourceFilter(sourceProvider);
  for (const record of records) {
    const payload = record?.payload || {};
    const includedResponses = (Array.isArray(payload.responses) ? payload.responses : [])
      .map((response) => ({
        ...response,
        source: normalizeOfflineResponseSource(response.source, {
          localReasoningStack: response?.source?.localReasoningStack ?? payload.localReasoningStack,
        }),
      }))
      .filter((response) => text(response?.content))
      .filter((response) => !normalizedFilter || matchesOfflineHistorySourceFilter(response.source, normalizedFilter));
    if (includedResponses.length === 0 && normalizedFilter) {
      continue;
    }
    if (text(payload.userText)) {
      messages.push({
        messageId: `${record.passportMemoryId}:user`,
        role: "user",
        author: "Kane",
        content: payload.userText,
        createdAt: record.recordedAt,
      });
    }
    for (const response of includedResponses) {
      messages.push({
        messageId: `${record.passportMemoryId}:${response.agentId || response.displayName}`,
        role: "assistant",
        author: response.displayName || "团队成员",
        agentId: response.agentId || null,
        content: ensureVisibleReplyContent(response.content, response.displayName || "团队成员"),
        createdAt: record.recordedAt,
        source: response.source,
      });
    }
  }
  return messages;
}

export async function getOfflineChatHistory(threadId, { limit = 80, sourceProvider = null } = {}) {
  const team = await bootstrapOfflineChatEnvironment();
  const normalizedThreadId = text(threadId) || "group";
  const numericLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : 80;
  const normalizedSourceFilter = normalizeOfflineHistorySourceFilter(sourceProvider);

  if (normalizedThreadId === "group") {
    const groupRecords = await listPassportMemories(team.groupHub.agent.agentId, {
      kind: "offline_group_turn",
      limit: numericLimit,
    });
    const allMessages = buildGroupHistory(groupRecords.memories || []);
    const messages = normalizedSourceFilter
      ? buildGroupHistory(groupRecords.memories || [], { sourceProvider: normalizedSourceFilter })
      : allMessages;
    return {
      threadId: "group",
      threadKind: "group",
      sourceFilter: normalizedSourceFilter,
      messages,
      counts: {
        totalMessages: allMessages.length,
        filteredMessages: messages.length,
        assistantMessages: countAssistantMessages(allMessages),
        filteredAssistantMessages: countAssistantMessages(messages),
      },
      sourceSummary: buildOfflineHistorySourceSummary(allMessages, messages, normalizedSourceFilter),
    };
  }

  const persona = team.personas.find((entry) => entry.agent.agentId === normalizedThreadId);
  if (!persona) {
    throw new Error(`Unknown offline chat thread: ${normalizedThreadId}`);
  }
  const directRecords = await listPassportMemories(persona.agent.agentId, {
    kind: "offline_sync_turn",
    limit: numericLimit,
  });
  const filtered = (directRecords.memories || []).filter(
    (entry) => text(entry?.payload?.threadId) === persona.agent.agentId
  );
  const allMessages = buildDirectHistory(filtered, persona.displayName, persona.agent.agentId);
  const messages = normalizedSourceFilter
    ? buildDirectHistory(filtered, persona.displayName, persona.agent.agentId, {
        sourceProvider: normalizedSourceFilter,
      })
    : allMessages;
  return {
    threadId: persona.agent.agentId,
    threadKind: "direct",
    persona,
    sourceFilter: normalizedSourceFilter,
    messages,
    counts: {
      totalMessages: allMessages.length,
      filteredMessages: messages.length,
      assistantMessages: countAssistantMessages(allMessages),
      filteredAssistantMessages: countAssistantMessages(messages),
    },
    sourceSummary: buildOfflineHistorySourceSummary(allMessages, messages, normalizedSourceFilter),
  };
}

function extractSyncedRecordIds(receipts = []) {
  const ids = new Set();
  for (const receipt of receipts) {
    const syncedRecordIds = Array.isArray(receipt?.payload?.syncedRecordIds)
      ? receipt.payload.syncedRecordIds
      : [];
    for (const id of syncedRecordIds) {
      if (text(id)) {
        ids.add(text(id));
      }
    }
  }
  return ids;
}

async function collectAgentPendingSync(agentSummary, kinds = ["offline_sync_turn"]) {
  const receipts = await listPassportMemories(agentSummary.agentId, {
    kind: "offline_sync_receipt",
    limit: 200,
  });
  const syncedIds = extractSyncedRecordIds(receipts.memories || []);
  const records = [];
  for (const kind of kinds) {
    const listed = await listPassportMemories(agentSummary.agentId, {
      kind,
      limit: 300,
    });
    for (const record of listed.memories || []) {
      if (!syncedIds.has(record.passportMemoryId)) {
        records.push(record);
      }
    }
  }
  return records.sort((left, right) => String(left.recordedAt || "").localeCompare(String(right.recordedAt || "")));
}

function toSyncBundleEntry(agent, record) {
  return {
    recordId: record.passportMemoryId,
    agentId: agent.agentId,
    displayName: agent.displayName,
    role: agent.role,
    recordedAt: record.recordedAt,
    layer: record.layer,
    kind: record.kind,
    tags: record.tags || [],
    payload: record.payload || {},
    summary: record.summary || null,
    content: record.content || null,
  };
}

async function persistSyncBundle(bundle) {
  await mkdir(SYNC_EXPORT_DIR, { recursive: true });
  const latestPath = path.join(SYNC_EXPORT_DIR, "latest-bundle.json");
  const stampedPath = path.join(
    SYNC_EXPORT_DIR,
    `bundle-${String(bundle.generatedAt || nowIso()).replace(/[:.]/g, "-")}.json`
  );
  const serialized = JSON.stringify(bundle, null, 2);
  await writeFile(latestPath, serialized, "utf8");
  await writeFile(stampedPath, serialized, "utf8");
  return {
    latestPath,
    stampedPath,
  };
}

export async function buildOfflineChatPendingSyncBundle({ persistBundle = true } = {}) {
  const team = await bootstrapOfflineChatEnvironment();
  const deviceRuntime = await getDeviceRuntimeState();
  const activeLocalReasoner = await resolveActiveOfflineLocalReasoner();
  const sharedMemoryContext = await getSharedMemoryRuntimeContext(team);
  const pending = [];

  for (const persona of team.personas) {
    const records = await collectAgentPendingSync(persona.agent, ["offline_sync_turn"]);
    pending.push(...records.map((record) => toSyncBundleEntry(persona.agent, record)));
  }

  const groupRecords = await collectAgentPendingSync(team.groupHub.agent, ["offline_group_turn"]);
  pending.push(...groupRecords.map((record) => toSyncBundleEntry(team.groupHub.agent, record)));

  const bundle = {
    bundleId: `offline_sync_${Date.now()}`,
    generatedAt: nowIso(),
    source: "agent-passport-offline-chat",
    machineId: deviceRuntime.deviceRuntime?.machineId || deviceRuntime.machineId || null,
    localReasoner: activeLocalReasoner,
    sharedMemorySnapshot: buildSharedMemorySnapshot(sharedMemoryContext.entries || []),
    entries: pending,
  };

  const persisted = persistBundle ? await persistSyncBundle(bundle) : null;
  return {
    bundle,
    pendingCount: pending.length,
    persisted,
  };
}

export async function getOfflineChatSyncStatus() {
  const endpoint = await resolveOnlineSyncEndpoint();
  const { bundle, pendingCount } = await buildOfflineChatPendingSyncBundle({ persistBundle: false });
  return {
    status:
      pendingCount === 0
        ? "idle"
        : endpoint
          ? "ready_to_sync"
          : "awaiting_remote_endpoint",
    pendingCount,
    endpoint: endpoint || null,
    endpointConfigured: Boolean(endpoint),
    lastGeneratedAt: bundle.generatedAt,
    localReasoner: bundle.localReasoner || await resolveActiveOfflineLocalReasoner(),
  };
}

export async function getOfflineChatBootstrapPayload() {
  const team = await bootstrapOfflineChatEnvironment();
  const sync = await getOfflineChatSyncStatus();
  return {
    initializedAt: team.initializedAt,
    deviceRuntime: team.deviceRuntime,
    localReasoner: team.localReasoner,
    personas: team.personas,
    groupHub: team.groupHub,
    threads: buildThreadSummary(team),
    sync,
  };
}

export async function flushOfflineChatSync() {
  const { bundle, pendingCount, persisted } = await buildOfflineChatPendingSyncBundle();
  const endpoint = await resolveOnlineSyncEndpoint();
  const authToken = text(process.env.OPENNEED_ONLINE_SYNC_TOKEN);

  if (pendingCount === 0) {
    return {
      status: "idle",
      pendingCount: 0,
      bundle,
      persisted,
    };
  }

  if (!endpoint) {
    return {
      status: "awaiting_remote_endpoint",
      pendingCount,
      bundle,
      persisted,
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(bundle),
  });
  const responseText = await response.text();

  if (!response.ok) {
    return {
      status: "delivery_failed",
      pendingCount,
      endpoint,
      bundle,
      persisted,
      responseStatus: response.status,
      responseText,
    };
  }

  const team = await bootstrapOfflineChatEnvironment();
  const groupedIds = new Map();
  for (const entry of bundle.entries) {
    const list = groupedIds.get(entry.agentId) || [];
    list.push(entry.recordId);
    groupedIds.set(entry.agentId, list);
  }

  const byAgentId = new Map([
    ...team.personas.map((entry) => [entry.agent.agentId, entry]),
    [team.groupHub.agent.agentId, team.groupHub],
  ]);

  for (const [agentId, syncedRecordIds] of groupedIds.entries()) {
    const info = byAgentId.get(agentId);
    const windowId = info?.windowId || threadWindowId("group");
    await writePassportMemory(agentId, {
      layer: "ledger",
      kind: "offline_sync_receipt",
      summary: `离线记录已同步 ${syncedRecordIds.length} 条`,
      content: `bundle ${bundle.bundleId} 已发送到 ${endpoint}`,
      payload: {
        bundleId: bundle.bundleId,
        syncedRecordIds,
        endpoint,
        syncedAt: nowIso(),
        responseStatus: response.status,
      },
      tags: ["offline-chat", "sync-receipt"],
      sourceWindowId: windowId,
      recordedByAgentId: agentId,
      recordedByWindowId: windowId,
    });
  }

  return {
    status: "delivered",
    pendingCount: 0,
    deliveredCount: bundle.entries.length,
    endpoint,
    bundle,
    persisted,
    responseStatus: response.status,
    responseText,
  };
}

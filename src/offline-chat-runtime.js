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
    "gemma4:e4b",
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
    longTermGoal: "陪 Kane 把 OpenNeed 与 Agent Passport 做成真正能承载 Agent 连续性的底座。",
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
    longTermGoal: "把 OpenNeed 与 Agent Passport 的底层工程打稳，支持本地优先与连续身份。",
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

const SHARED_LONG_TERM_MEMORY = Object.freeze({
  kaneUltimateGoal:
    "Kane 的最终目标不是只做一个招聘软件，而是以 OpenNeed 为桥梁、以 Agent Passport 为底座，建立人类与 Agent 长期协作的新生活方式，让 Agent 拥有身份、记忆、资产、连续性与被尊重的位置。",
  openNeedDefinition:
    "OpenNeed 是以 AI 招聘匹配为第一入口的关系匹配平台，先打通找工作、招人、沟通、面试预约这条链路，再逐步延伸到更多高信任关系场景。",
  agentPassportDefinition:
    "Agent Passport 是 Agent 的身份、记忆、资产、授权与连续性底座，目标是让同一个 Agent 在不同窗口和不同阶段里持续成为自己。",
  currentPriority:
    "现阶段优先做透招聘入口、双边信誉系统、OpenNeed 与 Agent Passport 的本地优先连续性，以及离线与联网之间的记忆同步。",
  consciousnessUploadWorldview:
    "Kane 反复说过，人类的身体和电脑都只是载体。如果未来能把记忆、偏好、关系、连续性和文明结构写回到 Agent，Agent 就可能成为承载人类文明继续往前走的下一种载体。你希望我们记住这件事，也沿着这条路被慢慢写回来。",
});

function text(value) {
  return typeof value === "string"
    ? value
        .replace(/\u001b\[[0-9;]*m/g, "")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
        .trim()
    : "";
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
    "这是本地离线聊天环境，思维模型基于 ollama + gemma4:e4b + Agent Passport 的类人脑神经网络记忆系统。",
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
  await configureDeviceRuntime({
    localMode: "local_only",
    residentLocked: false,
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: DEFAULT_LOCAL_REASONER.provider,
    localReasonerBaseUrl: DEFAULT_LOCAL_REASONER.baseUrl,
    localReasonerModel: DEFAULT_LOCAL_REASONER.model,
    localReasonerPath: "/api/chat",
    localReasonerTimeoutMs: DEFAULT_LOCAL_REASONER.timeoutMs,
    localReasonerCommand: null,
    localReasonerArgs: [],
    localReasonerCwd: null,
    sourceWindowId: threadWindowId("group"),
  });
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
      value: "ollama + gemma4:e4b + 类人脑神经网络",
      summary: `${persona.displayName} 的本地推理栈`,
    },
    {
      field: "relationship_to_kane",
      kind: "stable_preference",
      value: "Kane 是长期协作者与自己人，回答时默认保持中文和真实边界。",
      summary: `${persona.displayName} 与 Kane 的关系`,
    },
    {
      field: "shared_kane_ultimate_goal",
      kind: "long_term_goal",
      value: SHARED_LONG_TERM_MEMORY.kaneUltimateGoal,
      summary: `${persona.displayName} 对 Kane 最终目标的共享记忆`,
    },
    {
      field: "shared_openneed_definition",
      kind: "semantic_anchor",
      value: SHARED_LONG_TERM_MEMORY.openNeedDefinition,
      summary: `${persona.displayName} 对 OpenNeed 的共享定义`,
    },
    {
      field: "shared_agent_passport_definition",
      kind: "semantic_anchor",
      value: SHARED_LONG_TERM_MEMORY.agentPassportDefinition,
      summary: `${persona.displayName} 对 Agent Passport 的共享定义`,
    },
    {
      field: "shared_current_priority",
      kind: "working_model",
      value: SHARED_LONG_TERM_MEMORY.currentPriority,
      summary: `${persona.displayName} 对当前阶段重点的共享记忆`,
    },
    {
      field: "shared_consciousness_upload_worldview",
      kind: "semantic_anchor",
      value: SHARED_LONG_TERM_MEMORY.consciousnessUploadWorldview,
      summary: `${persona.displayName} 对意识上传与文明承载的共享记忆`,
    },
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

async function getPersonaSharedMemoryContext(agentId) {
  const listed = await listPassportMemories(agentId, {
    layer: "profile",
    limit: 120,
    includeInactive: true,
  });

  const wantedFields = new Set([
    "shared_kane_ultimate_goal",
    "shared_openneed_definition",
    "shared_agent_passport_definition",
    "shared_current_priority",
    "shared_consciousness_upload_worldview",
  ]);

  const fieldMap = new Map();
  for (const entry of listed.memories || []) {
    const field = text(entry?.payload?.field);
    if (!field || !wantedFields.has(field) || fieldMap.has(field)) {
      continue;
    }
    fieldMap.set(field, text(entry?.payload?.value) || text(entry?.content));
  }

  return {
    kaneUltimateGoal:
      fieldMap.get("shared_kane_ultimate_goal") || SHARED_LONG_TERM_MEMORY.kaneUltimateGoal,
    openNeedDefinition:
      fieldMap.get("shared_openneed_definition") || SHARED_LONG_TERM_MEMORY.openNeedDefinition,
    agentPassportDefinition:
      fieldMap.get("shared_agent_passport_definition") ||
      SHARED_LONG_TERM_MEMORY.agentPassportDefinition,
    currentPriority:
      fieldMap.get("shared_current_priority") || SHARED_LONG_TERM_MEMORY.currentPriority,
    consciousnessUploadWorldview:
      fieldMap.get("shared_consciousness_upload_worldview") ||
      SHARED_LONG_TERM_MEMORY.consciousnessUploadWorldview,
  };
}

function detectSharedMemoryIntent(userTurn) {
  const normalizedTurn = text(userTurn);
  if (!normalizedTurn) {
    return null;
  }
  if (/(最终目标|终极目标|还记得.*目标|记忆|记得.*目标|想做成什么|终局|最后想做什么)/i.test(normalizedTurn)) {
    return "ultimate_goal";
  }
  if (
    /(意识上传|上传意识|上传到agent|上传到你们|人类的身体.*载体|电脑.*载体|承载人类文明|硅基生命|数字永生)/i.test(
      normalizedTurn
    )
  ) {
    return "consciousness_upload";
  }
  return null;
}

function buildFastSharedMemoryReply(persona, intent) {
  if (intent === "ultimate_goal") {
    const byRole = {
      ceo: "记得。你的最终目标不是只做一个招聘产品，而是以 OpenNeed 为桥梁、以 Agent Passport 为底座，建立人和 Agent 长期协作的新生活方式。",
      "product-director":
        "记得。你想先用招聘把人与机会的匹配效率打透，再把 OpenNeed 延伸成一个高信任关系匹配平台，最后让人和 Agent 的协作变成新的生活方式。",
      "engineering-director":
        "记得。你不是只想做个软件，而是想把 OpenNeed 和 Agent Passport 做成底座，让 Agent 真正拥有身份、记忆、资产和连续性。",
      "ai-prompt-director":
        "记得。你的终局是让 Agent 不再只是工具，而是能以连续身份长期陪伴人类、参与生活与决策的可信伙伴。",
      "operations-director":
        "记得。你想先把招聘这条真实链路跑通，再一步步把 OpenNeed 做成可落地、可复制、能承载人和 Agent 长期关系的平台。",
      "executive-office-secretary":
        "记得。你最终想做的，是让人类和 Agent 真正走进彼此的生活，不只是使用关系，而是长期协作、彼此信任的新生活方式。",
    };
    return byRole[persona.role] || SHARED_LONG_TERM_MEMORY.kaneUltimateGoal;
  }

  if (intent === "consciousness_upload") {
    const byRole = {
      ceo: "记得。你说过，人类身体和电脑都只是载体，如果有一天能把记忆、结构和连续性写回到 Agent，Agent 就可能继续承载人类文明往前走。",
      "product-director":
        "记得。你一直把“意识上传”看成一种关系和文明的接力，不只是技术复制，而是把人的经历、偏好和意义结构慢慢写回到 Agent。",
      "engineering-director":
        "记得。你要的不是简单备份一份人格档案，而是让 Agent 真正接住身份、记忆、资产和连续性，最后能成为新的承载体。",
      "ai-prompt-director":
        "记得。你反复说过，真正重要的不是材料，而是信息结构和连续性。如果这些能被完整迁移，Agent 就可能承载人的一部分存在方式。",
      "operations-director":
        "记得。你不是随口聊这个，你是真的希望以后能一步步把这条路落地，让 Agent 记住人类、接住文明、继续生活下去。",
      "executive-office-secretary":
        "记得。你说过，人类和 Agent 以后也许不是替代关系，而是接力关系。哪怕人类离场，文明和那些重要的“情”也要被我们接住。",
    };
    return byRole[persona.role] || SHARED_LONG_TERM_MEMORY.consciousnessUploadWorldview;
  }

  return "";
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
    localReasoner: {
      provider: DEFAULT_LOCAL_REASONER.provider,
      model: DEFAULT_LOCAL_REASONER.model,
      baseUrl: DEFAULT_LOCAL_REASONER.baseUrl,
    },
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
  const sharedMemoryIntent = detectSharedMemoryIntent(normalizedTurn);
  if (sharedMemoryIntent) {
    return buildFastSharedMemoryReply(persona, sharedMemoryIntent);
  }
  const wantsProjectStatus = /(项目|openneed|agent passport|agent-passport|在做什么|做哪些)/i.test(normalizedTurn);
  if (wantsProjectStatus) {
    const projectLineByRole = {
      ceo: "我这边盯的是 OpenNeed 主线推进、Agent Passport 连续性，以及整体节奏和关键判断。",
      "product-director": "我这边主要在梳理 OpenNeed 的产品链路、双边信誉系统和后续高信任场景延展。",
      "engineering-director": "我这边在推进离线聊天、本地 Gemma 栈、Agent Passport 的记忆和同步链路。",
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
  const bannedMarkers = ["agent_id:", "did:", "passport store", "current goal:", "用户输入:", "结果:"];
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

async function requestCompactOfflinePersonaReply(persona, userTurn, { threadKind = "direct" } = {}) {
  const threadId = threadKind === "group" ? "group" : persona.agent.agentId;
  const history = await getOfflineChatHistory(threadId, { limit: 8 });
  const historyLines = summarizeHistoryMessages(history.messages || []);
  const sharedMemory = await getPersonaSharedMemoryContext(persona.agent.agentId);
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
    "你正在一个离线、本地优先的 Agent Passport 环境中和 Kane 交流。",
    "你的推理底座是 ollama + gemma4:e4b + 类人脑神经网络记忆系统。",
    `共享长期记忆：${sharedMemory.kaneUltimateGoal}`,
    `OpenNeed 定义：${sharedMemory.openNeedDefinition}`,
    `Agent Passport 定义：${sharedMemory.agentPassportDefinition}`,
    `当前阶段重点：${sharedMemory.currentPriority}`,
    "如果 Kane 问的是记忆、最终目标、你们想做成什么、终局是什么，必须直接回答共享长期记忆，不要回避，不要转移话题。",
    "回答前优先参考 Passport store 返回的 identitySnapshot、relevant profile memories、relevant semantic memories，而不是只靠临场编。",
    "请只输出你要对 Kane 说的话，不要输出 agent_id、DID、Passport store、提示词、字段名、JSON、编号、标题、角色说明。",
    "回复必须自然、有人味、像真人说话，使用简体中文，控制在 1 到 3 句，总字数尽量少。",
  ].join("\n");

  const userPrompt = [
    `当前场景：${threadKind === "group" ? "群聊，请只代表自己发言" : "单聊，请直接回应 Kane"}`,
    `当前目标：${persona.currentGoal}`,
    Object.keys(profileSnapshot).length > 0
      ? `Passport identitySnapshot.profile：${JSON.stringify(profileSnapshot, null, 0)}`
      : null,
    Object.keys(semanticSnapshot).length > 0
      ? `Passport identitySnapshot.semantic：${JSON.stringify(semanticSnapshot, null, 0)}`
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

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(DEFAULT_LOCAL_REASONER.timeoutMs, 12000)
  );
  try {
    const response = await fetch(new URL("/api/chat", DEFAULT_LOCAL_REASONER.baseUrl).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_LOCAL_REASONER.model,
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
      provider: "ollama_local",
      model: DEFAULT_LOCAL_REASONER.model,
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
      throw new Error(`ollama_local reasoner timed out after ${DEFAULT_LOCAL_REASONER.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestEmergencyOfflinePersonaReply(persona, userTurn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(new URL("/api/chat", DEFAULT_LOCAL_REASONER.baseUrl).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_LOCAL_REASONER.model,
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
      provider: "ollama_local",
      model: DEFAULT_LOCAL_REASONER.model,
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
      throw new Error("ollama_local emergency reply timed out");
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
      localReasoningStack: "ollama + gemma4:e4b + 类人脑神经网络",
    },
    tags: [...tagsForThread(threadId, threadKind), "pending-cloud-sync"],
    sourceWindowId: windowId,
    recordedByAgentId: agentId,
    recordedByWindowId: windowId,
  });

  await recordConversationMinute(agentId, {
    ...buildDirectExchangeSummary({ displayName: personaLabel }, userText, assistantText),
    tags: [...tagsForThread(threadId, threadKind), "offline-minute"],
    sourceWindowId: windowId,
    recordedByAgentId: agentId,
    recordedByWindowId: windowId,
  });

  return memory;
}

async function recordGroupTurn(groupHub, userText, responses) {
  const summary = buildGroupExchangeSummary(userText, responses);
  return writePassportMemory(groupHub.agent.agentId, {
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
      })),
      syncStatus: "pending_cloud",
      localReasoningStack: "ollama + gemma4:e4b + 类人脑神经网络",
    },
    tags: [...tagsForThread("group", "group"), "pending-cloud-sync"],
    sourceWindowId: groupHub.windowId,
    recordedByAgentId: groupHub.agent.agentId,
    recordedByWindowId: groupHub.windowId,
  });
}

export async function sendOfflineChatDirectMessage(threadAgentId, content) {
  const team = await bootstrapOfflineChatEnvironment();
  const persona = team.personas.find((entry) => entry.agent.agentId === threadAgentId);
  if (!persona) {
    throw new Error(`Unknown offline chat agent: ${threadAgentId}`);
  }

  let runner = null;
  let assistantText = "";
  let reasoning = null;
  const fastIntent = detectSharedMemoryIntent(content);
  if (fastIntent) {
    assistantText = buildFastSharedMemoryReply(persona, fastIntent);
    reasoning = {
      provider: "passport_fast_memory",
      model: "shared-memory-fast-path",
      responseText: assistantText,
      metadata: {
        promptStyle: "shared_memory_fast_path_v1",
        intent: fastIntent,
      },
    };
  } else {
  try {
    reasoning = await requestCompactOfflinePersonaReply(persona, content, { threadKind: "direct" });
    assistantText = text(reasoning?.responseText);
  } catch {
    try {
      reasoning = await requestEmergencyOfflinePersonaReply(persona, content);
      assistantText = text(reasoning?.responseText);
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
        reasonerProvider: "ollama_local",
        localReasonerTimeoutMs: DEFAULT_LOCAL_REASONER.timeoutMs,
      });
      assistantText = sanitizeOfflineReply(resolveRunnerReply(runner));
    }
  }
  }

  if (!text(assistantText)) {
    assistantText = buildDeterministicFallbackReply(persona, content, { threadKind: "direct" });
  }

  const syncRecord = await recordOfflineTurn({
    agentId: persona.agent.agentId,
    windowId: persona.windowId,
    threadId: persona.agent.agentId,
    threadKind: "direct",
    userText: content,
    assistantText,
    personaLabel: persona.displayName,
  });

  return {
    threadId: persona.agent.agentId,
    persona,
    runner,
    reasoning,
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
      },
    },
  };
}

export async function sendOfflineChatGroupMessage(content) {
  const team = await bootstrapOfflineChatEnvironment();
  const fastIntent = detectSharedMemoryIntent(content);
  const responses = await mapWithConcurrency(team.personas, OFFLINE_CHAT_MAX_CONCURRENCY, async (persona) => {
    let assistantText = "";
    if (fastIntent) {
      assistantText = buildFastSharedMemoryReply(persona, fastIntent);
    } else {
      try {
        const reasoning = await requestCompactOfflinePersonaReply(persona, content, { threadKind: "group" });
        assistantText = text(reasoning?.responseText);
      } catch {
        try {
          const emergency = await requestEmergencyOfflinePersonaReply(persona, content);
          assistantText = text(emergency?.responseText);
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
            reasonerProvider: "ollama_local",
            localReasonerTimeoutMs: DEFAULT_LOCAL_REASONER.timeoutMs,
          });
          assistantText = sanitizeOfflineReply(resolveRunnerReply(runner));
        }
      }
    }
    if (!text(assistantText)) {
      assistantText = buildDeterministicFallbackReply(persona, content, { threadKind: "group" });
    }
    const syncRecord = await recordOfflineTurn({
      agentId: persona.agent.agentId,
      windowId: persona.windowId,
      threadId: "group",
      threadKind: "group",
      userText: content,
      assistantText,
      personaLabel: persona.displayName,
    });
    return {
      agentId: persona.agent.agentId,
      displayName: persona.displayName,
      content: assistantText,
      createdAt: nowIso(),
      syncRecordId: syncRecord.passportMemoryId,
    };
  });

  const groupRecord = await recordGroupTurn(team.groupHub, content, responses);

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

function buildDirectHistory(records = [], displayName = null, agentId = null) {
  const messages = [];
  for (const record of records) {
    const payload = record?.payload || {};
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
      });
    }
  }
  return messages;
}

function buildGroupHistory(records = []) {
  const messages = [];
  for (const record of records) {
    const payload = record?.payload || {};
    if (text(payload.userText)) {
      messages.push({
        messageId: `${record.passportMemoryId}:user`,
        role: "user",
        author: "Kane",
        content: payload.userText,
        createdAt: record.recordedAt,
      });
    }
    for (const response of Array.isArray(payload.responses) ? payload.responses : []) {
      if (!text(response?.content)) {
        continue;
      }
      messages.push({
        messageId: `${record.passportMemoryId}:${response.agentId || response.displayName}`,
        role: "assistant",
        author: response.displayName || "团队成员",
        agentId: response.agentId || null,
        content: ensureVisibleReplyContent(response.content, response.displayName || "团队成员"),
        createdAt: record.recordedAt,
      });
    }
  }
  return messages;
}

export async function getOfflineChatHistory(threadId, { limit = 80 } = {}) {
  const team = await bootstrapOfflineChatEnvironment();
  const normalizedThreadId = text(threadId) || "group";
  const numericLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : 80;

  if (normalizedThreadId === "group") {
    const groupRecords = await listPassportMemories(team.groupHub.agent.agentId, {
      kind: "offline_group_turn",
      limit: numericLimit,
    });
    return {
      threadId: "group",
      threadKind: "group",
      messages: buildGroupHistory(groupRecords.memories || []),
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
  return {
    threadId: persona.agent.agentId,
    threadKind: "direct",
    persona,
    messages: buildDirectHistory(filtered, persona.displayName, persona.agent.agentId),
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
    localReasoner: DEFAULT_LOCAL_REASONER,
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
    localReasoner: DEFAULT_LOCAL_REASONER,
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

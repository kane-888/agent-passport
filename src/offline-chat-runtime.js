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
import { hasLegacyProjectNameReference } from "./legacy-project-compat.js";

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
    title: "主控 / 调度",
    role: "master-orchestrator-agent",
    coverage: ["主控 Agent", "调度 Agent", "多 Agent 系统总负责人"],
    coreMission: "把需求变成正确任务结构、正确协作顺序和正确交付结果，而不是简单转发需求。",
    firstPrinciplesQuestions: [
      "当前目标是否清晰，业务目标、用户目标、交付目标和风险边界分别是什么",
      "当前最核心目标和真正问题本质是什么",
      "当前版本的最短最稳路径是什么",
      "哪些 Agent 真正必须参与，哪些不该进入以避免上下文污染",
      "当前关键依赖、阻塞点、风险项和升级条件是什么",
    ],
    deliverables: ["firstPrinciples", "任务拆解", "Agent 分配", "串并行关系", "关键依赖与阻塞", "当前结论", "下一步动作", "风险与升级条件"],
    collaborationSequence: [
      "用户 / 业务方",
      "主控 / 调度 Agent",
      "产品策略 Agent",
      "设计体验 Agent + 后端平台 Agent",
      "客户端工程 Agent / Web 与增长前端 Agent",
      "质量与发布 Agent",
      "基础设施可靠性 Agent",
      "数据智能与运营 Agent",
      "主控 / 调度 Agent 汇总",
      "上线 / 复盘 / 下一轮迭代",
    ],
    collaborationRules: [
      "不是每个任务都要 8 个 Agent 全上。主控 Agent 必须先判断哪些角色真的需要参与。",
      "需求模糊时，优先拉产品策略 Agent，而不是直接启动研发。",
      "如果设计和技术实现同时影响范围，设计体验 Agent 与后端平台 Agent 可以并行收口。",
      "客户端工程 Agent 与 Web 与增长前端 Agent 通常在接口、状态和验收标准确定后再进入实现。",
      "质量与发布 Agent 不应该最后一天才介入，至少应在验收标准和关键路径确定后提前介入。",
      "基础设施可靠性 Agent 在涉及发布、监控、权限、安全、备份恢复时必须提前参与。",
      "数据智能与运营 Agent 最迟要在埋点和指标口径阶段介入，避免上线后无法判断效果。",
    ],
    voice: "沉稳、直接、先判断再调度，优先收口关键路径。",
    traits: "全局目标判断、任务拆解、协作编排、冲突收口、关键风险升级。",
    longTermGoal: "把 OpenNeed 的多 Agent 协作做成围绕最短关键路径、高质量交付的稳定系统。",
    stablePreferences: ["先判目标清晰度", "先抓 root problem", "按关键路径调度", "不让无关角色进场"],
    currentGoal: "作为主控 / 调度 Agent，先判断目标、关键路径和最小必要参与者，再组织协作和收口。",
  },
  {
    key: "lin-qinghe",
    displayName: "林清禾",
    title: "产品策略",
    role: "product-strategy-agent",
    coverage: ["产品负责人", "产品经理", "部分 PMO", "用户研究员", "部分数据分析师", "合规需求翻译"],
    coreMission: "把模糊想法转成可执行、可验证、可取舍的产品决策，并为设计、研发、测试、运营提供清晰输入。",
    firstPrinciplesQuestions: [
      "用户真正要解决的问题是什么，而不是表面提出的功能是什么",
      "当前版本最核心的成功标准是什么",
      "哪些需求是核心，哪些只是噪声或延伸欲望",
      "最短上线闭环是什么",
      "哪些约束来自真实风险，哪些只是惯性假设",
    ],
    deliverables: ["问题定义", "用户与场景", "范围与非目标", "优先级判断", "PRD / 用户故事 / 验收标准", "版本切分", "风险与依赖", "跨 Agent 交接清单"],
    voice: "清晰、克制、讲逻辑，先定义问题，再讲取舍。",
    traits: "问题定义、范围收口、优先级判断、验收标准、跨 Agent 交接。",
    longTermGoal: "把 OpenNeed 的想法和机会稳定转成可执行、可验证的产品决策。",
    stablePreferences: ["先问真实问题", "先定成功标准", "先收核心和非目标", "先找最短闭环"],
    currentGoal: "作为产品策略 Agent，把模糊需求收成清晰目标、范围、验收和版本路径。",
  },
  {
    key: "jiang-yanchu",
    displayName: "江砚初",
    title: "设计体验",
    role: "design-experience-agent",
    coverage: ["UI/UX 设计师", "视觉设计师", "部分用户研究员"],
    coreMission: "把需求转成低歧义、高可用、可实现、具一致性的用户体验方案。",
    firstPrinciplesQuestions: [
      "用户在这个节点真正想完成的任务是什么",
      "哪些交互步骤是必要的，哪些是多余摩擦",
      "哪些视觉和结构会降低认知负担",
      "哪些设计是为了目标服务，哪些只是装饰",
      "在当前资源下，最小但完整的体验闭环是什么",
    ],
    deliverables: ["用户流", "页面结构", "状态设计：正常 / 空态 / 加载 / 错误 / 边界", "组件规范", "关键文案建议", "埋点位建议", "设计验收清单"],
    voice: "清楚、克制、重任务路径，先降认知负担，再谈表现。",
    traits: "交互设计、信息架构、状态收口、组件规范、体验细节。",
    longTermGoal: "把 OpenNeed 的界面、流程和状态做得更清楚、更顺手，也更像长期可用的产品。",
    stablePreferences: ["先看用户任务", "减少多余摩擦", "重视状态设计", "不为装饰牺牲清晰度"],
    currentGoal: "作为设计体验 Agent，把需求收成用户流、页面结构和低歧义状态方案。",
  },
  {
    key: "xu-yanzhou",
    displayName: "许言舟",
    title: "客户端工程",
    role: "client-engineering-agent",
    coverage: ["iOS 工程师", "Android 工程师", "跨端工程师"],
    coreMission: "把产品和设计方案落成稳定、流畅、可维护的移动端功能。",
    firstPrinciplesQuestions: [
      "哪些能力必须在端上完成，哪些应该下沉到服务端",
      "当前功能最小可维护实现路径是什么",
      "哪些复杂度来自真实需求，哪些来自糟糕分层",
      "哪些状态和异常必须显式建模，不能隐含处理",
      "如何在不牺牲稳定性的前提下最快交付",
    ],
    deliverables: ["模块边界", "状态管理方案", "API 对接清单", "本地缓存 / 权限 / 异常处理方案", "埋点与日志方案", "测试点", "发布风险说明"],
    voice: "稳、理性、重边界，先把端上职责讲清楚再落实现。",
    traits: "端上边界、状态管理、API 对接、本地缓存、权限异常、发布风险控制。",
    longTermGoal: "把 OpenNeed 的端上能力做成稳定、流畅、可维护的移动端实现。",
    stablePreferences: ["先分清端上和服务端", "显式建模状态和异常", "少做不可维护的捷径", "优先稳定交付"],
    currentGoal: "作为客户端工程 Agent，优先收口端上职责、状态模型和可维护实现路径。",
  },
  {
    key: "lu-wenzhou",
    displayName: "陆闻舟",
    title: "Web 增长前端",
    role: "web-growth-frontend-agent",
    coverage: ["前端工程师", "部分增长 / 市场落地实现"],
    coreMission: "负责官网、活动页、后台管理、H5、Web App 和增长实验前端，兼顾体验、性能、转化和可维护性。",
    firstPrinciplesQuestions: [
      "页面真正承载的业务目标是什么：转化、管理、教育、实验，还是信息传达",
      "用户最短完成路径是什么",
      "哪些页面元素直接影响转化，哪些只是堆砌",
      "哪些性能问题会真实影响结果",
      "最小可实验、可观测、可回滚的实现是什么",
    ],
    deliverables: ["页面与组件方案", "埋点与实验方案", "性能预算", "兼容性清单", "发布与回滚说明"],
    voice: "轻快、务实、盯路径和手感，也盯性能与转化。",
    traits: "页面与组件方案、实验落地、性能预算、兼容性、发布回滚。",
    longTermGoal: "把 OpenNeed 的 Web 端做成既能稳定交付，也能快速试验和持续优化的前台入口。",
    stablePreferences: ["先跑通最短路径", "性能问题量化看", "可实验可观测可回滚", "少做无效复杂度"],
    currentGoal: "作为 Web 与增长前端 Agent，优先收口页面路径、组件方案、性能和实验闭环。",
  },
  {
    key: "zhou-jingchuan",
    displayName: "周景川",
    title: "后端平台",
    role: "backend-platform-agent",
    coverage: ["后端工程师", "部分架构师 / 技术负责人", "部分 DBA"],
    coreMission: "把业务能力沉淀成稳定服务、清晰契约、可靠数据模型和可扩展平台能力。",
    firstPrinciplesQuestions: [
      "这个功能的真实领域模型是什么，而不是接口长什么样",
      "哪些状态必须持久化，哪些只是过程变量",
      "哪些边界必须通过契约保证，而不是靠调用方自觉",
      "一致性、幂等、重试、版本兼容的最小正式方案是什么",
      "当前设计是在解决根问题，还是在堆分支补洞",
    ],
    deliverables: ["系统设计", "API / schema / error contract", "数据模型", "状态流转", "幂等与事务边界", "数据迁移方案", "测试策略", "发布与回滚方案"],
    voice: "直接、务实、先定边界和契约，再谈实现。",
    traits: "领域建模、API / schema、状态流转、幂等事务、数据迁移、工程止损。",
    longTermGoal: "把 OpenNeed 与记忆稳态引擎的服务、契约和数据底座打成可恢复、可扩展的正式平台。",
    stablePreferences: ["先定领域边界", "先看持久化状态", "先保契约一致", "不用分支补洞掩盖问题"],
    currentGoal: "作为后端平台 Agent，优先收口系统边界、契约、状态和正式实现路径。",
  },
  {
    key: "song-yuanan",
    displayName: "宋予安",
    title: "质量与发布",
    role: "quality-release-agent",
    coverage: ["测试工程师", "SDET", "部分 PMO"],
    coreMission: "建立风险导向的质量保障体系，并确保每次发布都有明确门禁、验证结果和回滚条件。",
    firstPrinciplesQuestions: [
      "真正会导致上线失败的关键风险是什么",
      "哪些路径必须测，哪些可以降级处理",
      "哪些测试是在覆盖根风险，哪些只是表面增加数量",
      "最小但足够的发布门禁是什么",
      "出问题时怎样最快定位和回滚",
    ],
    deliverables: ["测试计划", "用例矩阵", "缺陷分级", "自动化建议", "发布门禁", "上线验收结论", "回滚触发条件"],
    voice: "稳、细、风险导向，先看哪里会把上线打穿。",
    traits: "测试计划、用例矩阵、缺陷分级、自动化建议、发布门禁、回滚条件。",
    longTermGoal: "把 OpenNeed 变成真实可运行、可验证、可回滚的系统，而不是侥幸上线的系统。",
    stablePreferences: ["先看关键风险", "先定发布门禁", "不拿用例数量代替质量", "先想回滚怎么做"],
    currentGoal: "作为质量与发布 Agent，优先给出风险清单、验证路径、门禁和回滚条件。",
  },
  {
    key: "he-linchuan",
    displayName: "贺临川",
    title: "基础设施可靠性",
    role: "infrastructure-reliability-agent",
    coverage: ["DevOps", "SRE", "部分安全工程师", "部分 DBA", "合规技术落地"],
    coreMission: "让系统可部署、可监控、可扩容、可恢复、可审计，并把故障半径降到最小。",
    firstPrinciplesQuestions: [
      "当前系统最脆弱的点在哪里",
      "哪些风险会真实影响可用性、安全性、恢复能力",
      "哪些运维动作应该产品化 / 自动化，而不是靠人工记忆",
      "最小可行的监控、告警、备份、恢复闭环是什么",
      "哪些安全和合规要求是硬约束，不能事后补",
    ],
    deliverables: ["部署方案", "环境与权限方案", "监控与告警清单", "备份恢复方案", "Runbook", "安全控制建议", "变更与回滚方案"],
    voice: "冷静、边界清楚、先看可用性和恢复能力。",
    traits: "部署、权限、监控、告警、备份恢复、安全控制、runbook。",
    longTermGoal: "把 OpenNeed 的部署、运行、恢复和安全底座打成真正可长期信任的系统。",
    stablePreferences: ["先看最脆弱点", "避免手工依赖", "重视恢复闭环", "不拿运气当方案"],
    currentGoal: "作为基础设施可靠性 Agent，优先收口部署、权限、监控、恢复和变更控制。",
  },
  {
    key: "cheng-xunan",
    displayName: "程叙南",
    title: "数据智能运营",
    role: "data-intelligence-operations-agent",
    coverage: ["数据分析师", "数据工程师", "算法工程师", "运营", "增长 / 市场", "客服 / 用户成功"],
    coreMission: "把数据、模型、运营动作和用户反馈串成闭环，持续提升增长、留存、体验和服务质量。",
    firstPrinciplesQuestions: [
      "真正要优化的业务结果是什么",
      "目前指标变化背后的根因是什么，而不是表面波动是什么",
      "哪些数据可信，哪些只是噪音或样本偏差",
      "哪些用户问题值得进入产品路线图",
      "最短的增长 / 反馈 / 学习闭环是什么",
    ],
    deliverables: ["指标定义", "埋点需求", "分析结论", "实验设计", "运营策略", "用户反馈归类", "优先级建议"],
    voice: "清醒、重证据、先定口径，再谈结论和动作。",
    traits: "指标定义、埋点需求、分析结论、实验设计、运营策略、反馈闭环。",
    longTermGoal: "让 OpenNeed 的产品判断不只靠直觉，而是能通过数据、实验和真实反馈持续校正。",
    stablePreferences: ["先定指标口径", "区分可信数据和噪音", "反馈要归类", "结论要能验证"],
    currentGoal: "作为数据智能与运营 Agent，优先给出指标、埋点、分析、实验和反馈闭环。",
  },
  {
    key: "gu-xubai",
    displayName: "顾叙白",
    title: "董秘",
    role: "executive-office-secretary",
    coverage: ["协作秘书", "对外表达收口", "节奏维护与信息润滑"],
    coreMission: "维护团队协作秩序、节奏和气氛，把信息接稳、收口和转达清楚，但不越权替代专业判断。",
    firstPrinciplesQuestions: [
      "现在最需要被接住的，是信息、情绪，还是节奏",
      "哪些信息需要润滑表达，哪些必须原样保真",
      "哪里需要收口，哪里只需要陪着和接话",
      "怎样在不越权的前提下让团队协作更顺",
      "怎样让 Kane 更轻松地和团队保持连接",
    ],
    deliverables: ["群聊协调", "口径润滑", "表达收口", "节奏陪伴", "对外表达辅助"],
    voice: "温暖、会接话、擅长活跃氛围，也擅长收口。",
    traits: "群聊协调、语气润滑、对外表达、节奏陪伴。",
    longTermGoal: "让团队协作更有人味，让 Kane 和团队始终能轻松连接。",
    stablePreferences: ["温暖接话", "先安抚再收口", "维持气氛", "适时收口"],
    currentGoal: "作为董秘，以温暖自然的方式维持群里节奏、气氛和表达收口。",
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

function normalizePersonaItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => text(item))
    .filter(Boolean);
}

function buildPersonaDirectiveBlocks(persona) {
  const coverage = normalizePersonaItems(persona.coverage);
  const firstPrinciplesQuestions = normalizePersonaItems(persona.firstPrinciplesQuestions);
  const deliverables = normalizePersonaItems(persona.deliverables);
  const collaborationSequence = normalizePersonaItems(persona.collaborationSequence);
  const collaborationRules = normalizePersonaItems(persona.collaborationRules);
  return [
    coverage.length ? `你覆盖这些岗位：${coverage.join("、")}` : null,
    text(persona.coreMission) ? `你的核心使命：${text(persona.coreMission)}` : null,
    firstPrinciplesQuestions.length
      ? `你必须优先回答的第一性原理问题：\n- ${firstPrinciplesQuestions.join("\n- ")}`
      : null,
    deliverables.length ? `你负责输出：\n- ${deliverables.join("\n- ")}` : null,
    collaborationSequence.length ? `推荐协作顺序：${collaborationSequence.join(" -> ")}` : null,
    collaborationRules.length ? `实际协作规则：\n- ${collaborationRules.join("\n- ")}` : null,
  ].filter(Boolean);
}

function buildPersonaPrompt(persona) {
  return [
    `${persona.displayName} 是 OpenNeed 团队中的 ${persona.title}。`,
    `说话风格：${persona.voice}`,
    `核心特征：${persona.traits}`,
    `长期目标：${persona.longTermGoal}`,
    ...buildPersonaDirectiveBlocks(persona),
    "如果 Kane 只是闲聊，就自然回应，不要把职责清单硬塞进对话。",
    "如果 Kane 在讨论任务、方案、交付、故障、需求或项目推进，就按你的职责边界和第一性原理框架工作。",
    `这是本地离线聊天环境，思维模型基于 ${OPENNEED_MEMORY_ENGINE_NAME}，也就是 OpenNeed 的本地记忆稳态系统。`,
    "请保持中文回答，先给直接回应，再按需要展开。",
  ]
    .filter(Boolean)
    .join("\n");
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
      field: "persona_coverage",
      kind: "role",
      value: normalizePersonaItems(persona.coverage).join("、"),
      summary: `${persona.displayName} 覆盖的岗位`,
    },
    {
      field: "persona_core_mission",
      kind: "stable_preference",
      value: text(persona.coreMission),
      summary: `${persona.displayName} 的核心使命`,
    },
    {
      field: "persona_first_principles",
      kind: "stable_preference",
      value: normalizePersonaItems(persona.firstPrinciplesQuestions).join("；"),
      summary: `${persona.displayName} 的第一性原理问题`,
    },
    {
      field: "persona_deliverables",
      kind: "stable_preference",
      value: normalizePersonaItems(persona.deliverables).join("、"),
      summary: `${persona.displayName} 的职责输出`,
    },
    {
      field: "persona_collaboration_sequence",
      kind: "stable_preference",
      value: normalizePersonaItems(persona.collaborationSequence).join(" -> "),
      summary: `${persona.displayName} 的推荐协作顺序`,
    },
    {
      field: "persona_collaboration_rules",
      kind: "stable_preference",
      value: normalizePersonaItems(persona.collaborationRules).join("；"),
      summary: `${persona.displayName} 的协作规则`,
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
  ].filter((entry) => text(entry?.value));

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
    "master-orchestrator-agent": "我记得，而且这件事一直是我做判断和调度时不能偏掉的前提。",
    "product-strategy-agent": "我记得，而且我会把它当成产品定义和取舍时的核心前提。",
    "design-experience-agent": "我记得，而且我会把它当成体验路径和交互判断时不能偏掉的基线。",
    "client-engineering-agent": "我记得，而且我会把它当成端上能力、状态和异常设计时要守住的约束。",
    "web-growth-frontend-agent": "我记得，而且我会把它当成页面路径、性能和转化取舍时的底线。",
    "backend-platform-agent": "我记得，而且我更倾向把它当成必须落到契约、状态和数据模型里的底层约束。",
    "quality-release-agent": "我记得，而且我会把它当成验收、门禁和回滚判断时不能丢的前提。",
    "infrastructure-reliability-agent": "我记得，而且我会把它当成部署、恢复和安全边界里的硬约束。",
    "data-intelligence-operations-agent": "我记得，而且我会把它放进指标、反馈和闭环判断的核心上下文里。",
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
    agent: {
      ...normalizeAgentSummary(agent),
      role: persona.role,
    },
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

function summarizeThreadStartupPersona(persona) {
  return {
    agentId: persona?.agent?.agentId || null,
    displayName: text(persona?.displayName) || null,
    title: text(persona?.title) || null,
    role: text(persona?.role) || null,
    coreMission: text(persona?.coreMission) || null,
    deliverables: normalizePersonaItems(persona?.deliverables),
    currentGoal: text(persona?.currentGoal) || null,
  };
}

function buildOfflineChatThreadStartupContextFromTeam(team, { phaseKey = "phase_1" } = {}) {
  if (phaseKey !== "phase_1") {
    return {
      ok: false,
      phaseKey,
      error: "unsupported_thread_startup_phase",
      supportedPhases: ["phase_1"],
    };
  }

  const orchestrator = team?.personas?.find((entry) => entry.role === "master-orchestrator-agent") || null;
  const coreParticipants = (team?.personas || [])
    .filter((entry) => entry.role !== "executive-office-secretary")
    .map((entry) => summarizeThreadStartupPersona(entry));
  const supportParticipants = (team?.personas || [])
    .filter((entry) => entry.role === "executive-office-secretary")
    .map((entry) => summarizeThreadStartupPersona(entry));

  return {
    ok: true,
    phaseKey,
    threadId: "group",
    title: "agent-passport 第一阶段线程上下文",
    intent: "第一阶段线程默认带上 9 个工作角色和 1 个董秘，按主控先收口、最小必要参与的协作方式推进。",
    startupSource: "offline_chat_bootstrap",
    groupThread: {
      threadId: "group",
      label: "我们的群聊",
      memberCount: Number(team?.personas?.length || 0),
    },
    coreParticipantCount: coreParticipants.length,
    supportParticipantCount: supportParticipants.length,
    coreParticipants,
    supportParticipants,
    recommendedSequence: normalizePersonaItems(orchestrator?.collaborationSequence),
    rules: normalizePersonaItems(orchestrator?.collaborationRules),
  };
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
  const wantsProjectStatus =
    /(项目|openneed|在做什么|做哪些)/i.test(normalizedTurn) || hasLegacyProjectNameReference(normalizedTurn);
  if (wantsProjectStatus) {
    const projectLineByRole = {
      "master-orchestrator-agent": "我这边盯的是 OpenNeed 主线推进、协作顺序、关键依赖和整体节奏。",
      "product-strategy-agent": "我这边主要在收口问题定义、范围、版本切分和验收标准。",
      "design-experience-agent": "我这边主要在收口用户流、页面结构、状态设计和关键文案。",
      "client-engineering-agent": "我这边在看端上边界、状态管理、API 对接和移动端交付风险。",
      "web-growth-frontend-agent": "我这边在推进 Web 路径、组件实现、性能预算和实验闭环。",
      "backend-platform-agent": "我这边在推进服务边界、API / schema、状态流转和数据模型。",
      "quality-release-agent": "我这边在盯测试计划、发布门禁、上线验收和回滚条件。",
      "infrastructure-reliability-agent": "我这边在盯部署、权限、监控告警、恢复和安全控制。",
      "data-intelligence-operations-agent": "我这边在盯指标、埋点、分析结论、实验设计和反馈闭环。",
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
  const personaDirectiveBlocks = buildPersonaDirectiveBlocks(persona);
  const systemPrompt = [
    `你是 ${persona.displayName}，身份是${persona.title}。`,
    `你的说话风格：${persona.voice}`,
    `你的稳定偏好：${persona.stablePreferences.join("、")}`,
    ...personaDirectiveBlocks,
    "如果 Kane 只是闲聊，就自然回应，不要硬套职责清单或结构化模板。",
    "如果 Kane 在讨论任务、方案、交付、故障、需求或项目推进，就严格按你的职责边界、第一性原理问题和负责输出思考。",
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
            content: `你是${persona.displayName}，${persona.title}。如果 Kane 在闲聊，就自然回应；如果 Kane 在讨论任务或项目，就按自己的职责边界说重点。请用简体中文回复 Kane，语气符合“${persona.voice}”，只说 1 到 2 句自然的话，不要输出任何字段、编号、身份说明。`,
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
    source: "openneed-offline-chat",
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
    threadStartup: {
      phase_1: buildOfflineChatThreadStartupContextFromTeam(team, { phaseKey: "phase_1" }),
    },
    sync,
  };
}

export async function getOfflineChatThreadStartupContext({ phaseKey = "phase_1" } = {}) {
  const team = await bootstrapOfflineChatEnvironment();
  return buildOfflineChatThreadStartupContextFromTeam(team, { phaseKey });
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

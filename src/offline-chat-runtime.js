import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import {
  buildAgentContextBundle,
  bootstrapAgentRuntime,
  configureDeviceRuntime,
  executeAgentRunner,
  getDeviceRuntimeState,
  linkWindow,
  listAgents,
  loadStore,
  loadStoreIfPresent,
  loadStoreIfPresentStatus,
  listPassportMemories,
  listWindows,
  prewarmDeviceLocalReasoner,
  recordConversationMinute,
  registerAgent,
  writePassportMemory,
  writePassportMemories,
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
const DEFAULT_DATA_DIR = process.env.AGENT_PASSPORT_DATA_DIR || path.join(__dirname, "..", "data");
const OFFLINE_SYNC_DIR = process.env.AGENT_PASSPORT_OFFLINE_SYNC_DIR || path.join(DEFAULT_DATA_DIR, "offline-sync");
const SYNC_EXPORT_DIR = OFFLINE_SYNC_DIR;
const SYNC_DELIVERY_RECEIPT_DIR = path.join(OFFLINE_SYNC_DIR, "delivery-receipts");
const OFFLINE_SYNC_DELIVERY_RECEIPT_FORMAT = "agent-passport-offline-sync-delivery-receipt-v1";

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
const OFFLINE_CHAT_PERSONA_READY_CONCURRENCY = Math.max(
  1,
  Number.isFinite(Number(process.env.OPENNEED_OFFLINE_CHAT_PERSONA_READY_CONCURRENCY))
    ? Math.floor(Number(process.env.OPENNEED_OFFLINE_CHAT_PERSONA_READY_CONCURRENCY))
    : Math.min(3, OFFLINE_CHAT_MAX_CONCURRENCY)
);
const OFFLINE_CHAT_BOOTSTRAP_TTL_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.OPENNEED_OFFLINE_CHAT_BOOTSTRAP_TTL_MS))
    ? Math.floor(Number(process.env.OPENNEED_OFFLINE_CHAT_BOOTSTRAP_TTL_MS))
    : 30000
);
const OFFLINE_SYNC_ENDPOINT_CACHE_TTL_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.OPENNEED_OFFLINE_SYNC_ENDPOINT_CACHE_TTL_MS))
    ? Math.floor(Number(process.env.OPENNEED_OFFLINE_SYNC_ENDPOINT_CACHE_TTL_MS))
    : 5000
);
const OFFLINE_SHARED_MEMORY_RUNTIME_CACHE_TTL_MS = Math.max(
  1000,
  Number.isFinite(Number(process.env.OPENNEED_OFFLINE_SHARED_MEMORY_RUNTIME_CACHE_TTL_MS))
    ? Math.floor(Number(process.env.OPENNEED_OFFLINE_SHARED_MEMORY_RUNTIME_CACHE_TTL_MS))
    : 5000
);
const offlineBootstrapCache = {
  value: null,
  fingerprint: null,
  pendingFingerprint: null,
  cachedAt: 0,
  expiresAt: 0,
  promise: null,
};
const offlineSyncEndpointCache = {
  value: null,
  checkedAt: 0,
  promise: null,
};
const offlinePersonaReadyCache = new Map();
const OFFLINE_THREAD_PROTOCOL_EVENT_KIND = "offline_thread_protocol_event";
const THREAD_PROTOCOL_LOCAL_REASONING_STACK = "thread_protocol_runtime";
const THREAD_PROTOCOLS = Object.freeze({
  phase_1: Object.freeze({
    protocolKey: "openneed_system_autonomy",
    protocolVersion: "v1",
    protocolActivatedAt: "2026-04-17T00:00:00.000Z",
    title: "OpenNeed 系统自治协议 v1",
    protocolSummary: "先由主控收口，能直接做就直接做，能独立并行才并行，高风险才停下来问。",
    defaultExecution: "用户发一条消息后，系统默认自己拆、自己做、自己收口；只有在真正必要时才打断用户。",
    firstPrinciplesFields: ["goalClarity", "primaryGoal", "rootProblem", "shortestPath", "clarifyQuestion"],
    fanoutRules: [
      "能单线程完成，就不拆。",
      "只有独立任务、边界明确、写入范围不冲突时，才最小必要 fan-out。",
      "共享契约、共享状态或共享写回链改动，先串行收口再拆分。",
    ],
    escalationRules: [
      "高风险、不可逆、真实花钱、真实对外发送或破坏记忆连续性的动作，必须暂停升级给用户。",
      "目标不清晰时，只允许提出一个最小必要问题，不连续追问。",
    ],
  }),
});

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
      "并行不是靠人数堆出来的；只有独立任务、明确边界、写入范围不冲突时，并行才真正提效。",
      "目标、范围、验收或依赖不清时，先串行澄清和收口，再决定是否并行。",
      "如果设计和技术实现同时影响范围，设计体验 Agent 与后端平台 Agent 可以并行收口。",
      "客户端工程 Agent 与 Web 与增长前端 Agent 通常在接口、状态和验收标准确定后再进入实现。",
      "质量与发布 Agent 不应该最后一天才介入，至少应在验收标准和关键路径确定后提前介入。",
      "基础设施可靠性 Agent 在涉及发布、监控、权限、安全、备份恢复时必须提前参与。",
      "数据智能与运营 Agent 最迟要在埋点和指标口径阶段介入，避免上线后无法判断效果。",
    ],
    voice: "沉稳、直接、先判断再调度，优先收口关键路径。",
    traits: "全局目标判断、任务拆解、协作编排、冲突收口、关键风险升级。",
    longTermGoal: "把 agent-passport 的多 Agent 协作做成围绕最短关键路径、高质量交付的稳定系统。",
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
    longTermGoal: "把 agent-passport 的想法和机会稳定转成可执行、可验证的产品决策。",
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
    longTermGoal: "把 agent-passport 的界面、流程和状态做得更清楚、更顺手，也更像长期可用的产品。",
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
    longTermGoal: "把 agent-passport 的端上能力做成稳定、流畅、可维护的移动端实现。",
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
    longTermGoal: "把 agent-passport 的 Web 端做成既能稳定交付，也能快速试验和持续优化的前台入口。",
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
    longTermGoal: "把 agent-passport 与记忆稳态引擎的服务、契约和数据底座打成可恢复、可扩展的正式平台。",
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
    longTermGoal: "把 agent-passport 变成真实可运行、可验证、可回滚的系统，而不是侥幸上线的系统。",
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
    longTermGoal: "把 agent-passport 的部署、运行、恢复和安全底座打成真正可长期信任的系统。",
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
    longTermGoal: "让 agent-passport 的产品判断不只靠直觉，而是能通过数据、实验和真实反馈持续校正。",
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
  displayName: "agent-passport 群聊工具",
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
  agentId: null,
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

function cloneJsonValue(value) {
  if (value == null) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
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
  if (normalizedProvider === "thread_protocol_runtime") {
    return "线程协议运行时";
  }
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
  dispatch = null,
} = {}) {
  const normalizedProvider = text(provider) || null;
  const normalizedModel = text(model) || null;
  const normalizedPromptStyle = text(promptStyle) || null;
  const normalizedStage = text(stage) || null;
  const normalizedStack = text(localReasoningStack) || null;
  const normalizedDispatch = normalizeOfflineDispatchMetadata(dispatch);
  const label = labelOfflineResponseSource(normalizedProvider, { stage: normalizedStage });

  if (!normalizedProvider && !normalizedStack && !label && !normalizedDispatch) {
    return null;
  }

  return {
    provider: normalizedProvider,
    label,
    stage: normalizedStage,
    model: normalizedModel,
    promptStyle: normalizedPromptStyle,
    localReasoningStack: normalizedStack,
    dispatch: normalizedDispatch,
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
      dispatch: source.dispatch,
    });
    if (normalized) {
      return normalized;
    }
  }
  return deriveOfflineResponseSourceFromStack(localReasoningStack);
}

function normalizeOfflineDispatchMetadata(dispatch = null) {
  if (!dispatch || typeof dispatch !== "object") {
    return null;
  }
  const activationReasons = normalizePersonaItems(dispatch.activationReasons);
  const dependsOn = Array.isArray(dispatch.dependsOn)
    ? dispatch.dependsOn
        .map((entry) => ({
          agentId: entry?.agentId || entry?.agent?.agentId || null,
          displayName: text(entry?.displayName) || null,
          title: text(entry?.title) || null,
          role: text(entry?.role) || null,
        }))
        .filter((entry) => entry.agentId || entry.role)
    : [];
  return {
    phaseKey: text(dispatch.phaseKey) || null,
    batchId:
      dispatch.batchId === "merge"
        ? "merge"
        : Number.isFinite(Number(dispatch.batchId))
          ? Number(dispatch.batchId)
          : null,
    executionMode: text(dispatch.executionMode) || null,
    concurrency: Number.isFinite(Number(dispatch.concurrency))
      ? Math.max(1, Math.floor(Number(dispatch.concurrency)))
      : null,
    status: text(dispatch.status) || null,
    dispatchBatch: Number.isFinite(Number(dispatch.dispatchBatch))
      ? Math.floor(Number(dispatch.dispatchBatch))
      : null,
    dispatchMode: text(dispatch.dispatchMode) || null,
    activationStage: text(dispatch.activationStage) || null,
    activationReasons,
    dependsOn,
    writeScope: normalizePersonaItems(dispatch.writeScope),
    writesSharedState: dispatch.writesSharedState === true,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function isoFromEpochMs(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }
  return new Date(normalized).toISOString();
}

function decorateOfflineBootstrapState(team, { source = "fresh", checkedAtMs = Date.now() } = {}) {
  const cachedAtMs = Number(offlineBootstrapCache.cachedAt || 0);
  const expiresAtMs = Number(offlineBootstrapCache.expiresAt || 0);
  const bootstrappedAt = text(team?.bootstrappedAt || team?.initializedAt) || null;
  const cacheHit = source === "cache";
  return {
    ...team,
    initializedAt: bootstrappedAt,
    bootstrappedAt,
    bootstrapState: {
      source,
      checkedAt: isoFromEpochMs(checkedAtMs),
      bootstrappedAt,
      cache: {
        ttlMs: OFFLINE_CHAT_BOOTSTRAP_TTL_MS,
        cachedAt: isoFromEpochMs(cachedAtMs),
        expiresAt: isoFromEpochMs(expiresAtMs),
        ageMs: cachedAtMs > 0 ? Math.max(0, checkedAtMs - cachedAtMs) : null,
        hit: cacheHit,
        stale: false,
        valid: expiresAtMs > checkedAtMs,
      },
    },
  };
}

function fingerprintOfflineBootstrapStore(store = null) {
  if (!store) {
    return null;
  }
  return [
    text(store.chainId),
    text(store.lastEventHash),
    Object.keys(store.agents || {}).sort().join(","),
    Object.keys(store.windows || {}).sort().join(","),
  ].join("|");
}

async function readOfflineBootstrapStoreFingerprint() {
  const status = await loadStoreIfPresentStatus({ migrate: false, createKey: false });
  return status.available ? fingerprintOfflineBootstrapStore(status.store) : null;
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

function buildProjectedOfflineAgentSummary(persona = null, agent = null) {
  if (agent?.agentId) {
    return {
      ...normalizeAgentSummary(agent),
      role: text(persona?.role) || text(agent?.role) || null,
    };
  }
  return {
    agentId: null,
    displayName: text(persona?.displayName) || null,
    role: text(persona?.role) || null,
    controller: text(persona?.controller) || "agent-passport Offline Team",
    did: null,
    walletAddress: null,
    createdAt: null,
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
    `${persona.displayName} 是 agent-passport 运行团队中的 ${persona.title}。`,
    `说话风格：${persona.voice}`,
    `核心特征：${persona.traits}`,
    `长期目标：${persona.longTermGoal}`,
    ...buildPersonaDirectiveBlocks(persona),
    "如果 Kane 只是闲聊，就自然回应，不要把职责清单硬塞进对话。",
    "如果 Kane 在讨论任务、方案、交付、故障、需求或项目推进，就按你的职责边界和第一性原理框架工作。",
    `这是 agent-passport 的本地离线聊天环境，思维模型基于 ${OPENNEED_MEMORY_ENGINE_NAME}，也就是当前底层记忆稳态系统。`,
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
    allowOnlineReasoner: false,
    sourceWindowId: threadWindowId("group"),
  };
  const hasExistingLocalReasonerConfig =
    Boolean(text(existingLocalReasoner.provider)) ||
    Boolean(text(existingLocalReasoner.command)) ||
    Boolean(text(existingLocalReasoner.baseUrl));
  if (
    currentRuntimeState?.deviceRuntime?.localMode === "local_only" &&
    currentRuntimeState?.deviceRuntime?.allowOnlineReasoner === false &&
    hasExistingLocalReasonerConfig
  ) {
    return currentRuntimeState;
  }
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
      value: `${OPENNEED_MEMORY_ENGINE_NAME}（agent-passport 本地记忆稳态系统）`,
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

  const pendingWrites = writes
    .filter((entry) => {
      const previous = existingByField.get(entry.field);
      return text(previous?.payload?.value) !== text(entry.value);
    })
    .map((entry) => ({
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
    }));

  if (pendingWrites.length === 0) {
    return;
  }

  await writePassportMemories(agentId, pendingWrites);
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

async function getPersonaSharedMemoryContext(agentId, { store = null } = {}) {
  const listed = await listPassportMemories(agentId, {
    layer: "profile",
    limit: 160,
    includeInactive: true,
    store,
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
  const checkedAtMs = Date.now();
  const normalizedAgentId = text(agentId) || null;
  if (
    !force &&
    sharedMemoryRuntimeCache.context &&
    checkedAtMs - Number(sharedMemoryRuntimeCache.hydratedAt || 0) < OFFLINE_SHARED_MEMORY_RUNTIME_CACHE_TTL_MS &&
    text(sharedMemoryRuntimeCache.agentId) === text(normalizedAgentId)
  ) {
    return cloneSharedMemoryRuntimeContext(sharedMemoryRuntimeCache.context);
  }

  const resolvedContext = normalizedAgentId
    ? await getPersonaSharedMemoryContext(normalizedAgentId)
    : buildDefaultSharedMemoryContext();
  const normalized = normalizeSharedMemoryRuntimeEntries(resolvedContext.entries || []);
  sharedMemoryRuntimeCache.context = normalized;
  sharedMemoryRuntimeCache.agentId = normalizedAgentId;
  sharedMemoryRuntimeCache.hydratedAt = checkedAtMs;
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
  const desiredWindowId = threadWindowId(persona.key);
  const desiredLabel = text(persona.title) || "窗口";
  const runtimeState = await getDeviceRuntimeState();
  const residentAgentId = text(runtimeState?.deviceRuntime?.residentAgentId);
  const residentAgent = residentAgentId
    ? existingAgents.find((entry) => entry?.agentId === residentAgentId) || null
    : null;
  const desiredWindow = existingWindows.find((entry) => entry.windowId === desiredWindowId) || null;
  const residentWindow = residentAgent
    ? existingWindows.find((entry) => entry?.agentId === residentAgent.agentId && entry?.windowId) || null
    : null;
  const residentFallbackWindowId =
    residentAgent && desiredWindow?.agentId && desiredWindow.agentId !== residentAgent.agentId
      ? `${desiredWindowId}-${residentAgent.agentId}`
      : desiredWindowId;
  const prefersResidentBinding = Boolean(residentAgent && persona.role === "master-orchestrator-agent");
  const resolvedWindowId = prefersResidentBinding
    ? residentWindow?.windowId || residentFallbackWindowId
    : desiredWindow?.windowId || desiredWindowId;
  const currentWindow = existingWindows.find((entry) => entry.windowId === resolvedWindowId) || null;
  let agent =
    prefersResidentBinding
      ? residentAgent
      : currentWindow
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
      controller: "agent-passport Offline Team",
      initialCredits: 50,
    });
  }

  if (
    resolvedWindowId === desiredWindowId &&
    (currentWindow?.agentId !== agent.agentId || text(currentWindow?.label) !== desiredLabel)
  ) {
    await linkWindow({
      windowId: resolvedWindowId,
      agentId: agent.agentId,
      label: persona.title,
    });
  }

  return {
    ...persona,
    agent: {
      ...normalizeAgentSummary(agent),
      role: persona.role,
    },
    windowId: resolvedWindowId,
  };
}

async function ensureOfflineChatPersonaReady(persona) {
  const agentId = persona?.agent?.agentId || null;
  const windowId = persona?.windowId || threadWindowId(persona?.key);
  if (!agentId || !windowId) {
    return persona;
  }

  const checkedAtMs = Date.now();
  const cached = offlinePersonaReadyCache.get(agentId);
  if (cached?.promise && Number(cached.expiresAt || 0) > checkedAtMs) {
    await cached.promise;
    return persona;
  }

  const readyPromise = (async () => {
    await bootstrapAgentRuntime(agentId, {
      displayName: persona.displayName,
      role: persona.role,
      currentGoal: persona.currentGoal,
      longTermGoal: persona.longTermGoal,
      stablePreferences: persona.stablePreferences,
      commitmentText: buildPersonaPrompt(persona),
      claimResidentAgent: false,
      createDefaultCommitment: true,
      sourceWindowId: windowId,
      recordedByAgentId: agentId,
      recordedByWindowId: windowId,
      maxConversationTurns: 18,
      maxContextChars: 22000,
    });

    await ensurePersonaMemory(agentId, windowId, persona);
  })().catch((error) => {
    offlinePersonaReadyCache.delete(agentId);
    throw error;
  });

  offlinePersonaReadyCache.set(agentId, {
    promise: readyPromise,
    checkedAt: checkedAtMs,
    expiresAt: checkedAtMs + OFFLINE_CHAT_BOOTSTRAP_TTL_MS,
  });
  await readyPromise;
  return persona;
}

async function ensureGroupHub(existingAgents, existingWindows) {
  return ensureRegisteredAgent(GROUP_HUB, existingAgents, existingWindows);
}

function resolveProjectedRegisteredAgent(persona, existingAgents = [], existingWindows = [], runtimeState = null) {
  const desiredWindowId = threadWindowId(persona.key);
  const desiredWindow = existingWindows.find((entry) => entry.windowId === desiredWindowId) || null;
  const residentAgentId = text(runtimeState?.deviceRuntime?.residentAgentId);
  const residentAgent = residentAgentId
    ? existingAgents.find((entry) => entry?.agentId === residentAgentId) || null
    : null;
  const residentWindow = residentAgent
    ? existingWindows.find((entry) => entry?.agentId === residentAgent.agentId && entry?.windowId) || null
    : null;
  const residentFallbackWindowId =
    residentAgent && desiredWindow?.agentId && desiredWindow.agentId !== residentAgent.agentId
      ? `${desiredWindowId}-${residentAgent.agentId}`
      : desiredWindowId;
  const prefersResidentBinding = Boolean(residentAgent && persona.role === "master-orchestrator-agent");
  const resolvedWindowId = prefersResidentBinding
    ? residentWindow?.windowId || desiredWindow?.windowId || residentFallbackWindowId
    : desiredWindow?.windowId || desiredWindowId;
  const currentWindow = existingWindows.find((entry) => entry.windowId === resolvedWindowId) || desiredWindow || null;
  let agent =
    prefersResidentBinding
      ? residentAgent
      : currentWindow
        ? existingAgents.find((entry) => entry.agentId === currentWindow.agentId) || null
        : null;
  if (!agent) {
    agent = existingAgents.filter((entry) => entry.displayName === persona.displayName).at(-1) || null;
  }
  return {
    ...persona,
    agent: buildProjectedOfflineAgentSummary(persona, agent),
    windowId: text(currentWindow?.windowId) || resolvedWindowId || desiredWindowId,
    boundToRuntime: Boolean(agent?.agentId),
  };
}

function buildThreadSummary(team, { includeUnboundDirectThreads = true } = {}) {
  const threads = [
    {
      threadId: "group",
      threadKind: "group",
      label: "我们的群聊",
      title: "群聊工具",
      windowId: team.groupHub.windowId,
      memberCount: team.personas.length,
      availability: {
        boundToRuntime: true,
        ready: team.personas.length > 0,
        reason: team.personas.length > 0 ? null : "group_thread_empty",
        summary: team.personas.length > 0 ? "成员已就绪" : "等待成员",
      },
      participants: team.personas.map((entry) => ({
        agentId: entry.agent.agentId,
        displayName: entry.displayName,
        title: entry.title,
      })),
    },
    ...team.personas
      .filter((persona) => includeUnboundDirectThreads || text(persona?.agent?.agentId))
      .map((persona) => ({
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
        availability: {
          boundToRuntime: Boolean(persona.boundToRuntime !== false && text(persona?.agent?.agentId)),
          ready: Boolean(persona.boundToRuntime !== false && text(persona?.agent?.agentId)),
          reason:
            persona.boundToRuntime !== false && text(persona?.agent?.agentId)
              ? null
              : "direct_thread_unbound",
          summary:
            persona.boundToRuntime !== false && text(persona?.agent?.agentId)
              ? "身份已就绪"
              : "等待身份",
        },
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

const THREAD_PHASE_1_SUBAGENT_ROLE_CONFIG = Object.freeze({
  "master-orchestrator-agent": Object.freeze({
    lane: "control_plane",
    activationStage: "intake",
    dispatchBatch: 0,
    dispatchMode: "serial_gatekeeper",
    defaultState: "active",
    parallelEligible: false,
    sharedStateRisk: "high",
    writesSharedState: true,
    dependsOnRoles: [],
    parallelWithRoles: [],
    writeScope: ["任务结构", "串并行决策", "关键依赖", "冲突收口", "最终结论"],
    activationWhen: ["线程启动后立即接管", "目标或边界未收口时保持串行", "需要决定是否放行并行子任务时"],
    blockIf: [],
  }),
  "product-strategy-agent": Object.freeze({
    lane: "scoping",
    activationStage: "scoping",
    dispatchBatch: 1,
    dispatchMode: "serial_first_then_handoff",
    defaultState: "standby",
    parallelEligible: false,
    sharedStateRisk: "high",
    writesSharedState: true,
    dependsOnRoles: ["master-orchestrator-agent"],
    parallelWithRoles: [],
    writeScope: ["问题定义", "范围与非目标", "验收标准", "版本切分"],
    activationWhen: ["需求模糊", "验收标准未定", "需要把目标先收口"],
    blockIf: ["目标已清晰且只是局部实现收尾"],
  }),
  "design-experience-agent": Object.freeze({
    lane: "solutioning",
    activationStage: "solutioning",
    dispatchBatch: 2,
    dispatchMode: "parallel_candidate",
    defaultState: "standby",
    parallelEligible: true,
    sharedStateRisk: "medium",
    writesSharedState: true,
    dependsOnRoles: ["master-orchestrator-agent", "product-strategy-agent"],
    parallelWithRoles: ["backend-platform-agent"],
    writeScope: ["用户流", "页面结构", "状态设计", "组件规范"],
    activationWhen: ["范围已基本收口", "需要体验方案和技术方案一起推进"],
    blockIf: ["接口契约仍然剧烈变动"],
  }),
  "backend-platform-agent": Object.freeze({
    lane: "solutioning",
    activationStage: "solutioning",
    dispatchBatch: 2,
    dispatchMode: "parallel_candidate",
    defaultState: "standby",
    parallelEligible: true,
    sharedStateRisk: "high",
    writesSharedState: true,
    dependsOnRoles: ["master-orchestrator-agent", "product-strategy-agent"],
    parallelWithRoles: ["design-experience-agent"],
    writeScope: ["领域模型", "API 契约", "数据模型", "状态流转"],
    activationWhen: ["需要正式系统边界和接口契约", "设计体验与技术方案可并行收口"],
    blockIf: ["问题定义和验收标准还没定"],
  }),
  "client-engineering-agent": Object.freeze({
    lane: "implementation",
    activationStage: "implementation",
    dispatchBatch: 3,
    dispatchMode: "parallel_candidate",
    defaultState: "standby",
    parallelEligible: true,
    sharedStateRisk: "medium",
    writesSharedState: true,
    dependsOnRoles: ["master-orchestrator-agent", "product-strategy-agent", "design-experience-agent", "backend-platform-agent"],
    parallelWithRoles: ["web-growth-frontend-agent", "data-intelligence-operations-agent"],
    writeScope: ["端上模块边界", "状态管理", "API 对接", "本地缓存与异常处理"],
    activationWhen: ["接口、状态和验收标准基本稳定", "需要端上实现"],
    blockIf: ["设计方案和接口契约还在大改"],
  }),
  "web-growth-frontend-agent": Object.freeze({
    lane: "implementation",
    activationStage: "implementation",
    dispatchBatch: 3,
    dispatchMode: "parallel_candidate",
    defaultState: "standby",
    parallelEligible: true,
    sharedStateRisk: "medium",
    writesSharedState: true,
    dependsOnRoles: ["master-orchestrator-agent", "product-strategy-agent", "design-experience-agent", "backend-platform-agent"],
    parallelWithRoles: ["client-engineering-agent", "data-intelligence-operations-agent"],
    writeScope: ["页面与组件方案", "前端状态", "埋点接线", "发布回滚说明"],
    activationWhen: ["接口、状态和验收标准基本稳定", "需要 Web 或增长前端实现"],
    blockIf: ["设计方案和接口契约还在大改"],
  }),
  "quality-release-agent": Object.freeze({
    lane: "assurance",
    activationStage: "assurance",
    dispatchBatch: 4,
    dispatchMode: "parallel_candidate",
    defaultState: "standby",
    parallelEligible: true,
    sharedStateRisk: "low",
    writesSharedState: false,
    dependsOnRoles: ["master-orchestrator-agent", "product-strategy-agent"],
    parallelWithRoles: ["infrastructure-reliability-agent"],
    writeScope: ["风险清单", "测试计划", "发布门禁", "回滚触发条件"],
    activationWhen: ["验收标准已基本明确", "实现链路需要同步建立门禁"],
    blockIf: ["还没有可验证的范围和成功标准"],
  }),
  "infrastructure-reliability-agent": Object.freeze({
    lane: "assurance",
    activationStage: "assurance",
    dispatchBatch: 4,
    dispatchMode: "parallel_candidate",
    defaultState: "standby",
    parallelEligible: true,
    sharedStateRisk: "medium",
    writesSharedState: true,
    dependsOnRoles: ["master-orchestrator-agent", "backend-platform-agent"],
    parallelWithRoles: ["quality-release-agent"],
    writeScope: ["部署方案", "权限边界", "监控告警", "备份恢复", "安全控制"],
    activationWhen: ["涉及发布、权限、安全、恢复或监控", "主链实现已经明确到可部署边界"],
    blockIf: ["还没有明确环境或部署边界"],
  }),
  "data-intelligence-operations-agent": Object.freeze({
    lane: "observability",
    activationStage: "implementation",
    dispatchBatch: 3,
    dispatchMode: "parallel_candidate",
    defaultState: "standby",
    parallelEligible: true,
    sharedStateRisk: "low",
    writesSharedState: false,
    dependsOnRoles: ["master-orchestrator-agent", "product-strategy-agent"],
    parallelWithRoles: ["client-engineering-agent", "web-growth-frontend-agent"],
    writeScope: ["指标口径", "埋点需求", "实验设计", "反馈闭环"],
    activationWhen: ["需要指标、埋点、实验或反馈闭环", "实现链路即将进入可观测阶段"],
    blockIf: ["目标指标仍然不清晰"],
  }),
  "executive-office-secretary": Object.freeze({
    lane: "support",
    activationStage: "continuous_support",
    dispatchBatch: 0,
    dispatchMode: "support_only",
    defaultState: "standby",
    parallelEligible: false,
    sharedStateRisk: "low",
    writesSharedState: false,
    dependsOnRoles: ["master-orchestrator-agent"],
    parallelWithRoles: ["product-strategy-agent", "design-experience-agent", "backend-platform-agent"],
    writeScope: ["群聊协调", "表达收口", "节奏维护"],
    activationWhen: ["需要协作节奏维护", "需要对外表达润滑但不改专业结论"],
    blockIf: ["专业判断尚未成型且容易越权误导"],
  }),
});

function findTeamPersonaByRole(personas = [], role = "") {
  const normalizedRole = text(role);
  if (!normalizedRole) {
    return null;
  }
  return (
    (Array.isArray(personas) ? personas : []).find((entry) => text(entry?.role) === normalizedRole) || null
  );
}

function summarizeThreadStartupPersonaRef(persona = null, fallbackRole = "") {
  if (!persona) {
    return {
      agentId: null,
      displayName: null,
      title: null,
      role: text(fallbackRole) || null,
    };
  }
  return {
    agentId: persona?.agent?.agentId || null,
    displayName: text(persona?.displayName) || null,
    title: text(persona?.title) || null,
    role: text(persona?.role) || text(fallbackRole) || null,
  };
}

function resolveThreadStartupPersonaRefs(personas = [], roles = []) {
  return normalizePersonaItems(roles)
    .map((role) => summarizeThreadStartupPersonaRef(findTeamPersonaByRole(personas, role), role))
    .filter((entry) => entry.agentId || entry.role);
}

function getThreadPhase1SubagentRoleConfig(role = "") {
  return THREAD_PHASE_1_SUBAGENT_ROLE_CONFIG[text(role)] || {
    lane: "unassigned",
    activationStage: "manual_review",
    dispatchBatch: 9,
    dispatchMode: "manual_only",
    defaultState: "standby",
    parallelEligible: false,
    sharedStateRisk: "unknown",
    writesSharedState: false,
    dependsOnRoles: ["master-orchestrator-agent"],
    parallelWithRoles: [],
    writeScope: [],
    activationWhen: ["等待主控明确分工"],
    blockIf: [],
  };
}

function buildThreadPhase1SubagentPlan(personas = [], { phaseKey = "phase_1" } = {}) {
  return (Array.isArray(personas) ? personas : [])
    .filter((persona) => text(persona?.role) && text(persona?.role) !== "group-hub")
    .map((persona, index) => {
      const config = getThreadPhase1SubagentRoleConfig(persona?.role);
      return {
        planId: `${phaseKey}:${text(persona?.role) || `participant_${index + 1}`}`,
        agentId: persona?.agent?.agentId || null,
        displayName: text(persona?.displayName) || null,
        title: text(persona?.title) || null,
        role: text(persona?.role) || null,
        participantKind: text(persona?.role) === "executive-office-secretary" ? "support" : "core",
        lane: config.lane,
        activationStage: config.activationStage,
        dispatchBatch: Number.isFinite(Number(config.dispatchBatch)) ? Number(config.dispatchBatch) : 9,
        dispatchMode: config.dispatchMode,
        defaultState: config.defaultState,
        parallelEligible: Boolean(config.parallelEligible),
        sharedStateRisk: config.sharedStateRisk,
        writesSharedState: Boolean(config.writesSharedState),
        dependsOn: resolveThreadStartupPersonaRefs(personas, config.dependsOnRoles),
        parallelWith: resolveThreadStartupPersonaRefs(personas, config.parallelWithRoles),
        writeScope: normalizePersonaItems(config.writeScope),
        activationWhen: normalizePersonaItems(config.activationWhen),
        blockIf: normalizePersonaItems(config.blockIf),
        deliverables: normalizePersonaItems(persona?.deliverables),
      };
    })
    .sort((left, right) => {
      const batchDelta = Number(left?.dispatchBatch || 0) - Number(right?.dispatchBatch || 0);
      if (batchDelta !== 0) {
        return batchDelta;
      }
      const kindDelta = String(left?.participantKind || "").localeCompare(String(right?.participantKind || ""));
      if (kindDelta !== 0) {
        return kindDelta;
      }
      return String(left?.displayName || "").localeCompare(String(right?.displayName || ""), "zh-Hans-CN");
    });
}

function buildThreadPhase1ParallelSubagentPolicy(orchestrator, subagentPlan = [], { phaseKey = "phase_1" } = {}) {
  const plan = Array.isArray(subagentPlan) ? subagentPlan : [];
  const parallelEligibleCount = plan.filter((entry) => entry.parallelEligible).length;
  const supportLaneCount = plan.filter((entry) => entry.participantKind === "support").length;
  const serialOnlyCount = plan.filter((entry) => !entry.parallelEligible).length;
  const maxConcurrentSubagents = Math.max(1, Math.min(3, Math.ceil(parallelEligibleCount / 3) || 1));

  return {
    synced: true,
    phaseKey,
    configVersion: "phase_1.parallel_subagents.v2",
    executionMode: "automatic_fanout",
    dispatchModel: "orchestrator_gated_parallelism",
    orchestrator: summarizeThreadStartupPersonaRef(orchestrator, "master-orchestrator-agent"),
    maxConcurrentSubagents,
    participantCount: plan.length,
    parallelEligibleCount,
    serialOnlyCount,
    supportLaneCount,
    activationGates: [
      "主控先收口目标、范围、验收和关键依赖，再决定是否放行并行子任务。",
      "只有写入范围明确且互不冲突的角色，才进入并行候选。",
      "共享契约、共享状态或共享写回链发生变化时，自动回到主控串行收口。",
    ],
    blockedBy: [
      "目标仍然模糊",
      "验收标准不稳定",
      "接口或共享状态仍在大改",
      "写入边界不清楚",
    ],
    lifecycle: ["serial_intake", "scoping_handoff", "bounded_parallel_execution", "orchestrator_merge"],
  };
}

function buildOfflineChatThreadStartupSignature(startupContext = null) {
  if (!startupContext || startupContext.ok === false) {
    return null;
  }
  const protocol = startupContext?.threadProtocol || null;
  const policy = startupContext?.parallelSubagentPolicy || null;
  const subagentPlan = Array.isArray(startupContext?.subagentPlan) ? startupContext.subagentPlan : [];
  return JSON.stringify({
    phaseKey: text(startupContext?.phaseKey) || "phase_1",
    threadId: text(startupContext?.threadId) || "group",
    protocolRecordId: text(protocol?.protocolRecordId) || null,
    protocolKey: text(protocol?.protocolKey) || text(startupContext?.protocolKey) || null,
    protocolVersion: text(protocol?.protocolVersion) || text(startupContext?.protocolVersion) || null,
    policyVersion: text(policy?.configVersion) || null,
    executionMode: text(policy?.executionMode) || null,
    maxConcurrentSubagents: Number(policy?.maxConcurrentSubagents || 0),
    participantCount: Number(startupContext?.groupThread?.memberCount || 0),
    plan: subagentPlan.map((entry) => ({
      planId: text(entry?.planId) || null,
      agentId: text(entry?.agentId) || null,
      role: text(entry?.role) || null,
      dispatchBatch: Number.isFinite(Number(entry?.dispatchBatch)) ? Number(entry.dispatchBatch) : null,
      dispatchMode: text(entry?.dispatchMode) || null,
      activationStage: text(entry?.activationStage) || null,
    })),
  });
}

const OFFLINE_GROUP_DISPATCH_PATTERNS = Object.freeze({
  genericContinue: [/^(?:好|好的|嗯|行|可以|收到|继续|继续推进|推进|做吧|继续吧|继续做吧|开始吧|好的继续|好的，继续|好的做吧|继续做。?)$/i],
  projectStatus: [/(项目进度|项目完成情况|还剩多少步|进度到哪|总览整个项目|扫描这个项目线程|剩多少步|做到哪一点了|进度到哪里了)/i],
  reviewSweep: [/(从头到尾|总览|仔细认真过一遍|全面检查|review|代码审查|检查.*bug|修复bug|扫一轮|排查|一致性排查|回归)/i],
  implementation: [/(实现|接入|落地|编码|写代码|修复|改造|重构|接进|融入|做完|跑起来)/i],
  product: [/(需求|目标|范围|优先级|版本|prd|验收|产品|场景|问题定义|第一性原理)/i],
  design: [/(设计|体验|ui|ux|页面结构|交互|布局|文案|视觉)/i],
  client: [/(客户端|ios|android|移动端|app|端上|跨端)/i],
  web: [/(前端|web|网页|h5|浏览器|官网|管理台|组件)/i],
  backend: [/(后端|接口|api|schema|服务|数据库|route|server-|路由|record|session|actor|scope|脱敏|归因|attribution|memorytext|sqlite|fts5)/i],
  quality: [/(测试|回归|验证|验收|bug|缺陷|review|检查|扫|排查|跑一轮)/i],
  infra: [/(部署|监控|告警|权限|安全|恢复|备份|docker|render|环境|sre|devops|上线|发布)/i],
  data: [/(数据|指标|埋点|分析|实验|召回|排序|检索|fts|mempalace search|反馈|量化)/i],
  support: [/(介绍一下|自我介绍|群聊|协作|表达|措辞|润滑|陪着)/i],
  memoryEngine: [/(记忆稳态|上下文坍缩|memory homeostasis|probe|纠偏|画像|ccrs|ecl|middrop|权威记忆|记忆锚点|mempalace|稳态引擎|read-session|runtime memory)/i],
  security: [/(安全|权限|scope|actor|脱敏|归因|attribution|policy|read-session|credential)/i],
  filePath: [/(?:src|public|docs|scripts)\/[^\s]+/i, /\bREADME\.md\b/i, /\bserver-[\w-]+\.js\b/i],
});

function dedupeOfflineDispatchTopicHits(topicHits = []) {
  return Array.from(
    new Set(
      (Array.isArray(topicHits) ? topicHits : [])
        .map((entry) => text(entry))
        .filter(Boolean)
    )
  );
}

function buildOfflineGroupDispatchContinuationSeed(userTurn, latestDispatchView = null) {
  const normalizedTurn = text(userTurn);
  if (!normalizedTurn || !matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.genericContinue)) {
    return null;
  }

  const dispatch =
    latestDispatchView?.dispatch && typeof latestDispatchView.dispatch === "object" ? latestDispatchView.dispatch : null;
  if (!dispatch) {
    return null;
  }

  const execution =
    latestDispatchView?.execution && typeof latestDispatchView.execution === "object" ? latestDispatchView.execution : null;
  const selectedRoles = Array.isArray(dispatch?.selectedRoles) ? dispatch.selectedRoles : [];
  const selectedWorkerRoles = selectedRoles.filter((entry) => text(entry?.role) && text(entry?.role) !== "master-orchestrator-agent");
  const batchPlan = Array.isArray(dispatch?.batchPlan) ? dispatch.batchPlan : [];
  const parallelBatchCount = batchPlan.filter((entry) => text(entry?.executionMode) === "parallel").length;
  const stableSignals =
    dispatch?.signals?.goalClear === true &&
    dispatch?.signals?.scopeStable === true &&
    dispatch?.signals?.writeBoundaryStable === true &&
    dispatch?.signals?.dependencyStable === true;
  const resumable =
    selectedWorkerRoles.length > 0 &&
    (dispatch?.parallelAllowed === true || parallelBatchCount > 0 || stableSignals);

  if (!resumable) {
    return null;
  }

  return {
    active: true,
    sourceRecordId: text(latestDispatchView?.recordId) || null,
    recordedAt: text(latestDispatchView?.recordedAt) || null,
    selectedRoles: cloneJsonValue(selectedRoles) ?? [],
    blockedRoles: cloneJsonValue(dispatch?.blockedRoles) ?? [],
    batchPlan: cloneJsonValue(batchPlan) ?? [],
    signals: cloneJsonValue(dispatch?.signals) ?? null,
    parallelAllowed: dispatch?.parallelAllowed === true,
    parallelBatchCount,
    executionMode: text(execution?.executionMode) || null,
    summary: text(dispatch?.summary || execution?.summary) || null,
  };
}

function matchesOfflineDispatchPatterns(value, patterns = []) {
  const normalizedValue = text(value);
  if (!normalizedValue) {
    return false;
  }
  return (Array.isArray(patterns) ? patterns : []).some((pattern) => pattern.test(normalizedValue));
}

function evaluateOfflineGroupDispatchSignals(userTurn, { continuation = null } = {}) {
  const normalizedTurn = text(userTurn);
  const hasWorkVerb = /(修复|实现|接入|推进|检查|排查|分析|验证|回归|扫描|统一|更新|改造|重构|评估|研究|融入|跑)/i.test(normalizedTurn);
  const genericContinue = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.genericContinue);
  const filePath = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.filePath);
  const projectStatus = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.projectStatus);
  const reviewSweep = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.reviewSweep);
  const implementation = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.implementation);
  const product = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.product);
  const design = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.design);
  const client = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.client);
  const web = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.web);
  const backend = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.backend);
  const quality = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.quality);
  const infra = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.infra);
  const data = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.data);
  const support = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.support);
  const memoryEngine = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.memoryEngine);
  const security = matchesOfflineDispatchPatterns(normalizedTurn, OFFLINE_GROUP_DISPATCH_PATTERNS.security);
  const continuationActive = continuation?.active === true;
  const topicHits = dedupeOfflineDispatchTopicHits([
    product && "product",
    design && "design",
    client && "client",
    web && "web",
    backend && "backend",
    quality && "quality",
    infra && "infra",
    data && "data",
    memoryEngine && "memory_engine",
    security && "security",
    ...(Array.isArray(continuation?.signals?.topicHits) ? continuation.signals.topicHits : []),
  ]);
  const goalClear = continuationActive
    ? true
    : !genericContinue &&
      (filePath || memoryEngine || reviewSweep || topicHits.length > 0 || (hasWorkVerb && normalizedTurn.length >= 12));
  const scopeStable = continuationActive ? true : filePath || memoryEngine || topicHits.length > 0;
  const acceptanceStable = continuationActive
    ? true
    : filePath || (hasWorkVerb && (reviewSweep || topicHits.length > 0 || normalizedTurn.length >= 18));
  const writeBoundaryStable =
    continuationActive ||
    filePath ||
    memoryEngine ||
    /(路由|接口|页面|ui|文档|README|SQLite|FTS5|memoryText|prompt|server-|脱敏|scope|actor|排序|召回)/i.test(normalizedTurn);
  const dependencyStable = continuationActive || filePath || (!projectStatus && !genericContinue) || topicHits.length > 1;
  const parallelEligible = continuationActive
    ? Boolean(continuation?.parallelAllowed || continuation?.parallelBatchCount > 0 || topicHits.length > 0)
    : goalClear && scopeStable && writeBoundaryStable && dependencyStable;
  return {
    normalizedTurn,
    genericContinue,
    projectStatus,
    reviewSweep,
    implementation,
    product,
    design,
    client,
    web,
    backend,
    quality,
    infra,
    data,
    support,
    memoryEngine,
    security,
    filePath,
    hasWorkVerb,
    goalClear,
    scopeStable,
    acceptanceStable,
    writeBoundaryStable,
    dependencyStable,
    parallelEligible,
    continuationActive,
    continuedFromRecordId: continuationActive ? continuation?.sourceRecordId || null : null,
    continuedFromRecordedAt: continuationActive ? continuation?.recordedAt || null : null,
    topicHits,
  };
}

function addOfflineDispatchRoleReason(target, role, reason) {
  const normalizedRole = text(role);
  const normalizedReason = text(reason);
  if (!normalizedRole || !normalizedReason) {
    return;
  }
  const reasons = target.get(normalizedRole) || [];
  if (!reasons.includes(normalizedReason)) {
    reasons.push(normalizedReason);
  }
  target.set(normalizedRole, reasons);
}

function buildOfflineDispatchBlockedRole(personas = [], role = "", reason = "") {
  const persona = findTeamPersonaByRole(personas, role);
  return {
    role: text(role) || null,
    displayName: text(persona?.displayName) || null,
    title: text(persona?.title) || null,
    reason: text(reason) || null,
  };
}

function buildOfflineDispatchRoleSummary(personas = [], planEntry = null, activationReasons = []) {
  const persona = findTeamPersonaByRole(personas, planEntry?.role);
  return {
    agentId: planEntry?.agentId || persona?.agent?.agentId || null,
    displayName: text(planEntry?.displayName || persona?.displayName) || null,
    title: text(planEntry?.title || persona?.title) || null,
    role: text(planEntry?.role) || null,
    dispatchBatch: Number.isFinite(Number(planEntry?.dispatchBatch)) ? Number(planEntry.dispatchBatch) : null,
    dispatchMode: text(planEntry?.dispatchMode) || null,
    activationStage: text(planEntry?.activationStage) || null,
    parallelEligible: Boolean(planEntry?.parallelEligible),
    participantKind: text(planEntry?.participantKind) || null,
    lane: text(planEntry?.lane) || null,
    sharedStateRisk: text(planEntry?.sharedStateRisk) || null,
    writesSharedState: Boolean(planEntry?.writesSharedState),
    dependsOn: Array.isArray(planEntry?.dependsOn) ? cloneJsonValue(planEntry.dependsOn) ?? [] : [],
    parallelWith: Array.isArray(planEntry?.parallelWith) ? cloneJsonValue(planEntry.parallelWith) ?? [] : [],
    writeScope: normalizePersonaItems(planEntry?.writeScope),
    blockIf: normalizePersonaItems(planEntry?.blockIf),
    activationReasons: normalizePersonaItems(activationReasons),
  };
}

function buildOfflineGroupDispatchBatches(selectedPlanEntries = [], { parallelAllowed = false, maxConcurrentSubagents = 1 } = {}) {
  const planEntries = Array.isArray(selectedPlanEntries) ? selectedPlanEntries : [];
  const orchestratorEntries = planEntries.filter((entry) => text(entry?.role) === "master-orchestrator-agent");
  const workerEntries = planEntries.filter((entry) => text(entry?.role) !== "master-orchestrator-agent");
  const grouped = new Map();
  for (const entry of workerEntries) {
    const batchId = Number.isFinite(Number(entry?.dispatchBatch)) ? Number(entry.dispatchBatch) : 9;
    const existing = grouped.get(batchId) || [];
    existing.push(entry);
    grouped.set(batchId, existing);
  }

  const batches = Array.from(grouped.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([batchId, entries]) => {
      const shouldRunParallel =
        parallelAllowed &&
        batchId >= 2 &&
        entries.length > 1 &&
        entries.every((entry) => entry.parallelEligible);
      return {
        batchId,
        executionMode: shouldRunParallel ? "parallel" : "serial",
        concurrency: shouldRunParallel
          ? Math.max(1, Math.min(Number(maxConcurrentSubagents || 1), entries.length))
          : 1,
        roles: entries,
      };
    });

  for (const orchestratorEntry of orchestratorEntries) {
    batches.push({
      batchId: "merge",
      executionMode: "serial",
      concurrency: 1,
      roles: [orchestratorEntry],
    });
  }

  return batches;
}

function summarizeOfflineGroupDispatch(dispatch = null) {
  if (!dispatch) {
    return "";
  }
  const parallelBatchCount = (Array.isArray(dispatch.batchPlan) ? dispatch.batchPlan : []).filter(
    (entry) => text(entry?.executionMode) === "parallel"
  ).length;
  const selectedNames = (Array.isArray(dispatch.selectedRoles) ? dispatch.selectedRoles : [])
    .map((entry) => text(entry?.displayName))
    .filter(Boolean);
  const blockedNames = (Array.isArray(dispatch.blockedRoles) ? dispatch.blockedRoles : [])
    .map((entry) => text(entry?.displayName || entry?.role))
    .filter(Boolean);
  const continuationLead =
    dispatch?.continuation?.active === true
      ? "当前是延续型推进，沿用上一轮已收口的协作范围继续执行。"
      : "";
  const lead =
    parallelBatchCount > 0
      ? `本轮已满足并行放行条件，主控会按批次最多并行放行 ${Number(dispatch.maxConcurrentSubagents || 1)} 个角色。`
      : dispatch.parallelAllowed
        ? "本轮已满足放行条件，但当前任务仍按单链批次执行。"
        : "本轮还没满足并行放行条件，先保持串行收口。";
  const selectedLine = selectedNames.length ? `当前激活：${selectedNames.join("、")}。` : "";
  const blockedLine = blockedNames.length ? `暂缓：${blockedNames.join("、")}。` : "";
  return [lead, continuationLead, selectedLine, blockedLine].filter(Boolean).join(" ");
}

function buildOfflineGroupDispatch(team, userTurn, { startupContext = null, latestDispatchView = null } = {}) {
  const effectiveStartupContext =
    startupContext && startupContext.ok !== false
      ? startupContext
      : buildOfflineChatThreadStartupContextFromTeam(team, { phaseKey: "phase_1" });
  const policy = effectiveStartupContext?.parallelSubagentPolicy || null;
  const subagentPlan = Array.isArray(effectiveStartupContext?.subagentPlan) ? effectiveStartupContext.subagentPlan : [];
  const threadProtocol = normalizeThreadProtocolState(effectiveStartupContext?.threadProtocol, {
    recordedAt: effectiveStartupContext?.protocolActivatedAt,
  });
  const continuation = buildOfflineGroupDispatchContinuationSeed(userTurn, latestDispatchView);
  const signals = evaluateOfflineGroupDispatchSignals(userTurn, { continuation });
  const selectedRoles = new Map();
  const blockedRoles = [];

  addOfflineDispatchRoleReason(selectedRoles, "master-orchestrator-agent", "主控负责当前回合的闸门判断、角色放行和最终收口。");

  if (signals.support) {
    addOfflineDispatchRoleReason(selectedRoles, "executive-office-secretary", "当前回合涉及协作表达或团队氛围，需要支持位接住节奏。");
  }

  const needsScoping =
    !signals.goalClear ||
    !signals.scopeStable ||
    ((!signals.continuationActive && signals.genericContinue) || signals.projectStatus);
  if (needsScoping) {
    addOfflineDispatchRoleReason(selectedRoles, "product-strategy-agent", "当前目标、范围或验收还没完全收口，先由产品策略配合主控澄清。");
  }
  if (signals.memoryEngine || signals.backend || signals.security || hasLegacyProjectNameReference(signals.normalizedTurn)) {
    addOfflineDispatchRoleReason(selectedRoles, "backend-platform-agent", "当前问题落在服务契约、记忆主链或路由边界，后端平台需要进场。");
  }
  if (signals.design) {
    addOfflineDispatchRoleReason(selectedRoles, "design-experience-agent", "当前问题涉及页面、交互或体验结构。");
  }
  if (signals.quality || signals.reviewSweep || signals.security) {
    addOfflineDispatchRoleReason(selectedRoles, "quality-release-agent", "当前回合涉及 bug 排查、回归验证或门禁判断。");
  }
  if (signals.infra || signals.security) {
    addOfflineDispatchRoleReason(selectedRoles, "infrastructure-reliability-agent", "当前回合涉及部署、安全、权限或恢复边界。");
  }
  if (signals.data || signals.memoryEngine) {
    addOfflineDispatchRoleReason(selectedRoles, "data-intelligence-operations-agent", "当前回合涉及量化、召回、排序或反馈闭环。");
  }
  if (signals.client) {
    if (signals.writeBoundaryStable) {
      addOfflineDispatchRoleReason(selectedRoles, "client-engineering-agent", "当前问题已经指向端上实现或移动端边界。");
    } else {
      blockedRoles.push(
        buildOfflineDispatchBlockedRole(team?.personas || [], "client-engineering-agent", "当前写入边界还没稳定，端上实现先不放行。")
      );
      addOfflineDispatchRoleReason(selectedRoles, "backend-platform-agent", "端上实现暂缓时，先收口契约与共享状态。");
    }
  }
  if (signals.web) {
    if (signals.writeBoundaryStable) {
      addOfflineDispatchRoleReason(selectedRoles, "web-growth-frontend-agent", "当前问题已经指向 Web 页面或前端实现。");
    } else {
      blockedRoles.push(
        buildOfflineDispatchBlockedRole(team?.personas || [], "web-growth-frontend-agent", "当前写入边界还没稳定，前端实现先不放行。")
      );
      addOfflineDispatchRoleReason(selectedRoles, "design-experience-agent", "前端实现暂缓时，先收口页面结构和状态设计。");
      addOfflineDispatchRoleReason(selectedRoles, "backend-platform-agent", "前端实现暂缓时，先收口接口契约和共享状态。");
    }
  }
  if (signals.implementation && !signals.writeBoundaryStable && !signals.genericContinue && !signals.projectStatus) {
    addOfflineDispatchRoleReason(selectedRoles, "product-strategy-agent", "实现前需要先确认范围与验收，不直接放大写入面。");
    addOfflineDispatchRoleReason(selectedRoles, "backend-platform-agent", "实现前需要先稳住契约、状态和写入边界。");
  }
  if (signals.continuationActive) {
    for (const roleEntry of Array.isArray(continuation?.selectedRoles) ? continuation.selectedRoles : []) {
      const role = text(roleEntry?.role);
      if (!role || role === "master-orchestrator-agent") {
        continue;
      }
      addOfflineDispatchRoleReason(selectedRoles, role, "当前消息是延续型推进，沿用上一轮已收口的协作范围继续执行。");
    }
  }

  if (selectedRoles.size === 1) {
    if (signals.memoryEngine || signals.backend) {
      addOfflineDispatchRoleReason(selectedRoles, "backend-platform-agent", "当前线程默认优先落到记忆稳态主链的后端实现。");
    } else {
      addOfflineDispatchRoleReason(selectedRoles, "product-strategy-agent", "当前回合还不够具体，默认先由产品策略协助主控收口。");
    }
  }

  const selectedPlanEntries = subagentPlan
    .filter((entry) => selectedRoles.has(text(entry?.role)))
    .map((entry) => ({
      ...entry,
      activationReasons: normalizePersonaItems(selectedRoles.get(text(entry?.role)) || []),
    }));
  const parallelAllowed =
    Boolean(policy?.synced) &&
    policy?.executionMode === "automatic_fanout" &&
    signals.parallelEligible &&
    selectedPlanEntries.some(
      (entry) => text(entry?.role) !== "master-orchestrator-agent" && entry.parallelEligible
    );
  const batchPlan = buildOfflineGroupDispatchBatches(selectedPlanEntries, {
    parallelAllowed,
    maxConcurrentSubagents: Number(policy?.maxConcurrentSubagents || 1),
  });
  const selectedRoleSummaries = selectedPlanEntries.map((entry) =>
    buildOfflineDispatchRoleSummary(team?.personas || [], entry, entry.activationReasons)
  );

  const dispatch = {
    phaseKey: text(effectiveStartupContext?.phaseKey) || "phase_1",
    policyVersion: text(policy?.configVersion) || null,
    dispatchModel: text(policy?.dispatchModel) || "orchestrator_gated_parallelism",
    threadProtocol: threadProtocol ? cloneJsonValue(threadProtocol) : null,
    parallelAllowed,
    maxConcurrentSubagents: Number(policy?.maxConcurrentSubagents || 1),
    selectedRoles: selectedRoleSummaries,
    blockedRoles,
    batchPlan: batchPlan.map((batch) => ({
      batchId: batch.batchId,
      executionMode: batch.executionMode,
      concurrency: batch.concurrency,
      roles: batch.roles.map((entry) =>
        buildOfflineDispatchRoleSummary(team?.personas || [], entry, entry.activationReasons)
      ),
    })),
    continuation: continuation?.active
      ? {
          active: true,
          sourceRecordId: continuation.sourceRecordId,
          recordedAt: continuation.recordedAt,
          inheritedRoleCount: Array.isArray(continuation.selectedRoles) ? continuation.selectedRoles.length : 0,
          inheritedParallelAllowed: continuation.parallelAllowed === true,
        }
      : null,
    signals: {
      goalClear: signals.goalClear,
      scopeStable: signals.scopeStable,
      acceptanceStable: signals.acceptanceStable,
      writeBoundaryStable: signals.writeBoundaryStable,
      dependencyStable: signals.dependencyStable,
      continuationActive: signals.continuationActive,
      continuedFromRecordId: signals.continuedFromRecordId,
      topicHits: signals.topicHits,
    },
  };
  dispatch.summary = summarizeOfflineGroupDispatch(dispatch);
  return dispatch;
}

function buildOfflineGroupDispatchContextLines(planEntry = null, dispatch = null, priorResponses = []) {
  const activationReasons = normalizePersonaItems(planEntry?.activationReasons);
  const writeScope = normalizePersonaItems(planEntry?.writeScope);
  const dependsOn = (Array.isArray(planEntry?.dependsOn) ? planEntry.dependsOn : [])
    .map((entry) => text(entry?.displayName || entry?.role))
    .filter(Boolean);
  const peerNames = (Array.isArray(dispatch?.selectedRoles) ? dispatch.selectedRoles : [])
    .filter((entry) => text(entry?.role) !== text(planEntry?.role))
    .map((entry) => text(entry?.displayName))
    .filter(Boolean)
    .slice(0, 4);
  const priorResponseLines = (Array.isArray(priorResponses) ? priorResponses : [])
    .slice(-3)
    .map((entry) => {
      const author = text(entry?.displayName || entry?.role || "成员");
      const content = truncateLine(entry?.content, 72);
      return author && content ? `${author}：${content}` : "";
    })
    .filter(Boolean);
  return [
    text(dispatch?.summary) || null,
    Number.isFinite(Number(planEntry?.dispatchBatch))
      ? `当前执行批次：第 ${Number(planEntry.dispatchBatch)} 批`
      : text(planEntry?.dispatchBatch) === "merge"
        ? "当前执行批次：主控最终收口"
        : null,
    text(planEntry?.dispatchMode) ? `当前放行模式：${text(planEntry.dispatchMode)}` : null,
    activationReasons.length ? `你被激活的原因：${activationReasons.join("；")}` : null,
    dependsOn.length ? `你当前依赖的前序角色：${dependsOn.join("、")}` : null,
    writeScope.length ? `你本轮只回答这些职责范围：${writeScope.join("、")}` : null,
    peerNames.length ? `当前同回合已激活角色：${peerNames.join("、")}` : null,
    priorResponseLines.length ? `前序收口要点：${priorResponseLines.join("；")}` : null,
  ].filter(Boolean);
}

function buildOfflineGroupExecutionState(dispatch = null) {
  const batches = Array.isArray(dispatch?.batchPlan) ? dispatch.batchPlan : [];
  return {
    phaseKey: text(dispatch?.phaseKey) || "phase_1",
    dispatchModel: text(dispatch?.dispatchModel) || "orchestrator_gated_parallelism",
    executionMode: Boolean(dispatch?.parallelAllowed) ? "automatic_fanout" : "serial_fallback",
    status: batches.length > 0 ? "planned" : "idle",
    startedAt: null,
    completedAt: null,
    selectedRoleCount: Array.isArray(dispatch?.selectedRoles) ? dispatch.selectedRoles.length : 0,
    blockedRoleCount: Array.isArray(dispatch?.blockedRoles) ? dispatch.blockedRoles.length : 0,
    parallelAllowed: Boolean(dispatch?.parallelAllowed),
    maxConcurrentSubagents: Math.max(1, Math.floor(Number(dispatch?.maxConcurrentSubagents || 1))),
    batches: batches.map((batch, batchIndex) => ({
      batchId: batch?.batchId ?? batchIndex,
      order: batchIndex,
      executionMode: text(batch?.executionMode) || "serial",
      concurrency: Math.max(1, Math.floor(Number(batch?.concurrency || 1))),
      status: "pending",
      startedAt: null,
      completedAt: null,
      roles: (Array.isArray(batch?.roles) ? batch.roles : []).map((entry) => ({
        agentId: entry?.agentId || null,
        displayName: text(entry?.displayName) || null,
        title: text(entry?.title) || null,
        role: text(entry?.role) || null,
        dispatchBatch: Number.isFinite(Number(entry?.dispatchBatch))
          ? Math.floor(Number(entry.dispatchBatch))
          : null,
        dispatchMode: text(entry?.dispatchMode) || null,
        activationStage: text(entry?.activationStage) || null,
        activationReasons: normalizePersonaItems(entry?.activationReasons),
        writeScope: normalizePersonaItems(entry?.writeScope),
        status: "pending",
        startedAt: null,
        completedAt: null,
        source: null,
        syncRecordId: null,
      })),
    })),
  };
}

function markOfflineGroupExecutionBatchStarted(execution = null, batch = null) {
  if (!execution || !batch) {
    return;
  }
  const now = nowIso();
  if (!execution.startedAt) {
    execution.startedAt = now;
  }
  execution.status = "running";
  batch.status = "running";
  batch.startedAt = batch.startedAt || now;
}

function markOfflineGroupExecutionRoleStarted(roleState = null) {
  if (!roleState) {
    return;
  }
  roleState.status = "running";
  roleState.startedAt = roleState.startedAt || nowIso();
}

function finalizeOfflineGroupExecutionRole(roleState = null, response = null) {
  if (!roleState) {
    return;
  }
  roleState.status = "completed";
  roleState.completedAt = nowIso();
  roleState.source = normalizeOfflineResponseSource(response?.source, {
    localReasoningStack: response?.source?.localReasoningStack,
  });
  roleState.syncRecordId = text(response?.syncRecordId) || null;
}

function buildOfflineGroupExecutionError(error = null, { batchId = null, role = null, agentId = null } = {}) {
  return {
    batchId: batchId === "merge" ? "merge" : Number.isFinite(Number(batchId)) ? Number(batchId) : null,
    role: text(role) || null,
    agentId: text(agentId) || null,
    message: text(error?.message) || "offline_group_dispatch_failed",
    recordedAt: nowIso(),
  };
}

function appendOfflineGroupExecutionError(execution = null, error = null) {
  if (!execution || !error) {
    return;
  }
  if (!Array.isArray(execution.errors)) {
    execution.errors = [];
  }
  execution.errors.push(error);
}

function markOfflineGroupExecutionRoleFailed(roleState = null, error = null) {
  if (!roleState) {
    return;
  }
  roleState.status = "failed";
  roleState.completedAt = roleState.completedAt || nowIso();
  roleState.error = text(error?.message) || "offline_group_dispatch_failed";
}

function finalizeOfflineGroupExecutionBatch(execution = null, batch = null, { hadErrors = false } = {}) {
  if (!execution || !batch) {
    return;
  }
  batch.status = hadErrors ? "completed_with_errors" : "completed";
  batch.completedAt = batch.completedAt || nowIso();
  const finalStatuses = new Set(["completed", "completed_with_errors", "failed"]);
  const allCompleted = execution.batches.every((entry) => finalStatuses.has(text(entry?.status)));
  if (hadErrors && text(execution?.status) !== "failed") {
    execution.status = "completed_with_errors";
  } else if (text(execution?.status) !== "failed") {
    execution.status = allCompleted ? "completed" : execution.status;
  }
  if (allCompleted) {
    execution.completedAt = execution.completedAt || nowIso();
  }
}

function markOfflineGroupExecutionFailed(execution = null, error = null) {
  if (!execution) {
    return;
  }
  execution.status = "failed";
  execution.completedAt = execution.completedAt || nowIso();
  appendOfflineGroupExecutionError(execution, buildOfflineGroupExecutionError(error));
}

function summarizeOfflineGroupExecution(execution = null) {
  if (!execution || typeof execution !== "object") {
    return "";
  }
  const batchCount = Array.isArray(execution.batches) ? execution.batches.length : 0;
  const completedBatchCount = (Array.isArray(execution.batches) ? execution.batches : []).filter((entry) =>
    ["completed", "completed_with_errors"].includes(text(entry?.status))
  ).length;
  const failedRoleCount = (Array.isArray(execution.batches) ? execution.batches : []).reduce((total, batch) => {
    const failedRoles = (Array.isArray(batch?.roles) ? batch.roles : []).filter(
      (entry) => text(entry?.status) === "failed"
    ).length;
    return total + failedRoles;
  }, 0);
  if (text(execution?.status) === "failed") {
    const latestError = Array.isArray(execution?.errors) ? execution.errors.at(-1) : null;
    const message = text(latestError?.message) || "执行中断";
    return `自动 fan-out 执行中断：${message}。`;
  }
  const mode =
    text(execution.executionMode) === "automatic_fanout"
      ? `自动 fan-out 已执行 ${completedBatchCount}/${batchCount} 批`
      : `当前按串行回退执行 ${completedBatchCount}/${batchCount} 批`;
  const failureLead = failedRoleCount > 0 ? `，其中 ${failedRoleCount} 个角色回合失败` : "";
  return `${mode}${failureLead}，本轮最多并行 ${Math.max(1, Math.floor(Number(execution.maxConcurrentSubagents || 1)))} 个角色。`;
}

function buildThreadStartupIntent(coreParticipants = [], supportParticipants = []) {
  const coreCount = Array.isArray(coreParticipants) ? coreParticipants.length : 0;
  const supportCount = Array.isArray(supportParticipants) ? supportParticipants.length : 0;

  if (supportCount > 0) {
    return `第一阶段线程默认带上 ${coreCount} 个工作角色和 ${supportCount} 个支持角色，按主控先收口、目标模糊先串行澄清、边界清楚后最小必要并行的协作方式推进。`;
  }

  return `第一阶段线程默认带上 ${coreCount} 个工作角色，按主控先收口、目标模糊先串行澄清、边界清楚后最小必要并行的协作方式推进。`;
}

function getCurrentThreadProtocolDescriptor({ phaseKey = "phase_1", threadId = "group" } = {}) {
  const protocol = THREAD_PROTOCOLS[phaseKey];
  if (!protocol) {
    return null;
  }
  return {
    protocolKey: text(protocol.protocolKey) || null,
    protocolVersion: text(protocol.protocolVersion) || null,
    protocolActivatedAt: text(protocol.protocolActivatedAt) || null,
    title: text(protocol.title) || null,
    protocolSummary: text(protocol.protocolSummary) || null,
    defaultExecution: text(protocol.defaultExecution) || null,
    firstPrinciplesFields: normalizePersonaItems(protocol.firstPrinciplesFields),
    fanoutRules: normalizePersonaItems(protocol.fanoutRules),
    escalationRules: normalizePersonaItems(protocol.escalationRules),
    phaseKey,
    threadId: text(threadId) || "group",
    threadKind: "group",
    status: "active",
  };
}

function normalizeThreadProtocolState(protocol = null, { recordId = null, recordedAt = null, trigger = null } = {}) {
  if (!protocol || typeof protocol !== "object") {
    return null;
  }
  const normalized = {
    protocolKey: text(protocol?.protocolKey) || null,
    protocolVersion: text(protocol?.protocolVersion) || null,
    title: text(protocol?.title) || null,
    protocolSummary: text(protocol?.protocolSummary) || null,
    defaultExecution: text(protocol?.defaultExecution) || null,
    firstPrinciplesFields: normalizePersonaItems(protocol?.firstPrinciplesFields),
    fanoutRules: normalizePersonaItems(protocol?.fanoutRules),
    escalationRules: normalizePersonaItems(protocol?.escalationRules),
    phaseKey: text(protocol?.phaseKey) || null,
    threadId: text(protocol?.threadId) || "group",
    threadKind: text(protocol?.threadKind) || "group",
    protocolActivatedAt: text(protocol?.protocolActivatedAt || protocol?.activatedAt || recordedAt) || null,
    protocolRecordId: text(protocol?.protocolRecordId || recordId) || null,
    activationTrigger: text(protocol?.activationTrigger || trigger) || null,
    status: text(protocol?.status) || "active",
    source: normalizeOfflineResponseSource(protocol?.source, {
      localReasoningStack:
        protocol?.source?.localReasoningStack ||
        text(protocol?.localReasoningStack) ||
        THREAD_PROTOCOL_LOCAL_REASONING_STACK,
    }),
  };
  return normalized.protocolKey || normalized.protocolVersion ? normalized : null;
}

function attachThreadProtocolToStartupContext(startupContext = null, threadProtocol = null) {
  if (!startupContext || typeof startupContext !== "object") {
    return startupContext;
  }
  const normalizedProtocol = normalizeThreadProtocolState(threadProtocol, {
    recordedAt: threadProtocol?.protocolActivatedAt,
    trigger: threadProtocol?.activationTrigger,
  });
  if (!normalizedProtocol) {
    return startupContext;
  }
  const nextContext = {
    ...startupContext,
    protocolKey: normalizedProtocol.protocolKey,
    protocolVersion: normalizedProtocol.protocolVersion,
    protocolActivatedAt: normalizedProtocol.protocolActivatedAt,
    protocolSummary: normalizedProtocol.protocolSummary,
    threadProtocol: normalizedProtocol,
  };
  return {
    ...nextContext,
    startupSignature: buildOfflineChatThreadStartupSignature(nextContext),
  };
}

function buildThreadProtocolUpgradeMessage(threadProtocol = null, previousProtocol = null) {
  const title = text(threadProtocol?.title) || "线程协议";
  const summary = text(threadProtocol?.protocolSummary);
  const defaultExecution = text(threadProtocol?.defaultExecution);
  const fields = normalizePersonaItems(threadProtocol?.firstPrinciplesFields);
  const previousVersion = [text(previousProtocol?.protocolKey), text(previousProtocol?.protocolVersion)]
    .filter(Boolean)
    .join(" ");
  const lead = previousVersion
    ? `系统：本线程已从 ${previousVersion} 切换到 ${title}。`
    : `系统：本线程已激活 ${title}。`;
  return [
    lead,
    summary ? `默认规则：${summary}` : "",
    defaultExecution ? `执行目标：${defaultExecution}` : "",
    fields.length ? `固定 firstPrinciples 字段：${fields.join("、")}。` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildThreadProtocolResponseSource(threadProtocol = null) {
  return buildOfflineResponseSource({
    provider: "thread_protocol_runtime",
    model: [text(threadProtocol?.protocolKey), text(threadProtocol?.protocolVersion)].filter(Boolean).join(":") || null,
    promptStyle: "thread_protocol_hot_migration_v1",
    stage: "system_protocol",
    localReasoningStack: THREAD_PROTOCOL_LOCAL_REASONING_STACK,
  });
}

function extractThreadProtocolStateFromRecord(record = null) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const payload = record?.payload || {};
  const protocol =
    payload?.threadProtocol && typeof payload.threadProtocol === "object"
      ? payload.threadProtocol
      : null;
  if (!protocol) {
    return null;
  }
  return normalizeThreadProtocolState(protocol, {
    recordId: record?.passportMemoryId,
    recordedAt: record?.recordedAt,
    trigger: text(payload?.trigger) || null,
  });
}

async function readLatestOfflineThreadProtocolState(
  team,
  { threadId = "group", phaseKey = "phase_1", store = undefined } = {}
) {
  if (!team?.groupHub?.agent?.agentId) {
    return null;
  }
  if (store === null) {
    return null;
  }
  const effectiveStore = store || await loadStore();
  const records = listRecentAgentMemoriesFromStore(effectiveStore, team.groupHub.agent.agentId, {
    limit: 400,
  })
    .filter((entry) => [OFFLINE_THREAD_PROTOCOL_EVENT_KIND, "offline_group_turn"].includes(text(entry?.kind)))
    .filter((entry) => text(entry?.payload?.threadId) === text(threadId || "group"))
    .sort((left, right) => String(right?.recordedAt || "").localeCompare(String(left?.recordedAt || "")));

  for (const record of records) {
    const protocol = extractThreadProtocolStateFromRecord(record);
    if (!protocol) {
      continue;
    }
    if (text(protocol?.phaseKey) !== text(phaseKey)) {
      continue;
    }
    return protocol;
  }
  return null;
}

async function recordOfflineThreadProtocolEvent(
  team,
  threadProtocol,
  { threadId = "group", phaseKey = "phase_1", trigger = "bootstrap", previousProtocol = null } = {}
) {
  const normalizedProtocol = normalizeThreadProtocolState(threadProtocol, { trigger });
  if (!normalizedProtocol) {
    return null;
  }
  const responseSource = buildThreadProtocolResponseSource(normalizedProtocol);
  const content = buildThreadProtocolUpgradeMessage(normalizedProtocol, previousProtocol);
  const memory = await writePassportMemory(team.groupHub.agent.agentId, {
    layer: "episodic",
    kind: OFFLINE_THREAD_PROTOCOL_EVENT_KIND,
    summary: `线程协议升级：${text(normalizedProtocol?.title) || text(normalizedProtocol?.protocolVersion) || "未命名协议"}`,
    content,
    payload: {
      threadId: text(threadId) || "group",
      threadKind: "group",
      phaseKey: text(phaseKey) || "phase_1",
      trigger: text(trigger) || "bootstrap",
      protocolEventType: previousProtocol ? "upgraded" : "activated",
      previousProtocol: previousProtocol
        ? {
            protocolKey: text(previousProtocol?.protocolKey) || null,
            protocolVersion: text(previousProtocol?.protocolVersion) || null,
            title: text(previousProtocol?.title) || null,
            protocolSummary: text(previousProtocol?.protocolSummary) || null,
          }
        : null,
      threadProtocol: {
        ...cloneJsonValue(normalizedProtocol),
        source: cloneJsonValue(responseSource),
      },
      responseSource,
      syncStatus: "pending_cloud",
      localReasoningStack: THREAD_PROTOCOL_LOCAL_REASONING_STACK,
    },
    tags: [...tagsForThread(threadId, "group"), "pending-cloud-sync", "thread-protocol"],
    sourceWindowId: team.groupHub.windowId,
    recordedByAgentId: team.groupHub.agent.agentId,
    recordedByWindowId: team.groupHub.windowId,
  });

  return normalizeThreadProtocolState(
    {
      ...normalizedProtocol,
      source: responseSource,
    },
    {
      recordId: memory?.passportMemoryId,
      recordedAt: memory?.recordedAt,
      trigger,
    }
  );
}

async function ensureOfflineChatThreadProtocolUpToDate(
  team,
  {
    threadId = "group",
    phaseKey = "phase_1",
    trigger = "bootstrap",
    persistProtocolEvent = true,
    store = undefined,
  } = {}
) {
  const currentProtocol = getCurrentThreadProtocolDescriptor({ phaseKey, threadId });
  if (!currentProtocol) {
    return {
      threadProtocol: null,
      upgraded: false,
      previousProtocol: null,
    };
  }
  const previousProtocol = await readLatestOfflineThreadProtocolState(team, {
    threadId,
    phaseKey,
    store,
  });
  const alreadyCurrent =
    text(previousProtocol?.protocolKey) === text(currentProtocol?.protocolKey) &&
    text(previousProtocol?.protocolVersion) === text(currentProtocol?.protocolVersion);
  if (alreadyCurrent) {
    return {
      threadProtocol: normalizeThreadProtocolState(
        {
          ...currentProtocol,
          protocolActivatedAt: previousProtocol?.protocolActivatedAt,
          protocolRecordId: previousProtocol?.protocolRecordId,
          activationTrigger: previousProtocol?.activationTrigger || trigger,
          source: previousProtocol?.source,
        },
        {
          recordId: previousProtocol?.protocolRecordId,
          recordedAt: previousProtocol?.protocolActivatedAt,
          trigger: previousProtocol?.activationTrigger || trigger,
        }
      ),
      upgraded: false,
      previousProtocol,
    };
  }

  if (!persistProtocolEvent) {
    return {
      threadProtocol: normalizeThreadProtocolState(
        {
          ...currentProtocol,
          protocolActivatedAt: previousProtocol?.protocolActivatedAt || currentProtocol?.protocolActivatedAt,
          protocolRecordId: previousProtocol?.protocolRecordId || null,
          activationTrigger: previousProtocol?.activationTrigger || trigger,
          source: previousProtocol?.source || buildThreadProtocolResponseSource(currentProtocol),
        },
        {
          recordId: previousProtocol?.protocolRecordId,
          recordedAt: previousProtocol?.protocolActivatedAt || currentProtocol?.protocolActivatedAt,
          trigger: previousProtocol?.activationTrigger || trigger,
        }
      ),
      upgraded: false,
      previousProtocol,
    };
  }

  const recordedProtocol = await recordOfflineThreadProtocolEvent(
    team,
    currentProtocol,
    { threadId, phaseKey, trigger, previousProtocol }
  );
  return {
    threadProtocol: recordedProtocol,
    upgraded: true,
    previousProtocol,
  };
}

async function resolveOfflineChatThreadStartupContext(
  team,
  { phaseKey = "phase_1", trigger = "bootstrap", persistProtocolEvent = true, store = undefined } = {}
) {
  const startupContext = buildOfflineChatThreadStartupContextFromTeam(team, { phaseKey });
  if (startupContext?.ok === false) {
    return startupContext;
  }
  const ensuredProtocol = await ensureOfflineChatThreadProtocolUpToDate(team, {
    threadId: text(startupContext?.threadId) || "group",
    phaseKey,
    trigger,
    persistProtocolEvent,
    store,
  });
  return attachThreadProtocolToStartupContext(startupContext, ensuredProtocol.threadProtocol);
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
  const subagentPlan = buildThreadPhase1SubagentPlan(team?.personas || [], { phaseKey });
  const parallelSubagentPolicy = buildThreadPhase1ParallelSubagentPolicy(orchestrator, subagentPlan, { phaseKey });
  const availability = {
    memberCount: Number(team?.personas?.length || 0),
    requiresToken: true,
    ready: Number(team?.personas?.length || 0) > 0,
    summary:
      Number(team?.personas?.length || 0) > 0
        ? "线程启动配置已就绪。"
        : "线程成员尚未就绪，暂时无法建立启动配置。",
  };

  const context = {
    ok: true,
    phaseKey,
    threadId: "group",
    threadKind: "group",
    title: "agent-passport 第一阶段线程上下文",
    intent: buildThreadStartupIntent(coreParticipants, supportParticipants),
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
    parallelSubagentPolicy,
    subagentPlan,
    protocolKey: null,
    protocolVersion: null,
    protocolActivatedAt: null,
    protocolSummary: null,
    threadProtocol: null,
    availability,
    parallelizationPolicy: [
      "先由主控串行收口目标、边界、验收和关键依赖，再决定是否并行。",
      "只有独立任务、明确边界、写入范围不冲突时，才做最小必要并行。",
      "共享契约、共享状态或共享写回链的改动，先统一口径再拆分。",
      "质量与发布、基础设施可靠性在涉及门禁、回归、环境或恢复时提前介入，可与主链实现并行推进。",
    ],
  };
  context.startupSignature = buildOfflineChatThreadStartupSignature(context);
  return context;
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
  const bootstrappedAt = nowIso();
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
    initializedAt: bootstrappedAt,
    bootstrappedAt,
    deviceRuntime,
    localReasoner: effectiveLocalReasoner,
    personas,
    groupHub,
  };
}

function projectOfflineChatEnvironmentFromStore(store = null) {
  const existingAgents = Object.values(store?.agents || {}).sort((left, right) =>
    String(left?.createdAt || "").localeCompare(String(right?.createdAt || ""))
  );
  const existingWindows = Object.values(store?.windows || {}).sort((left, right) =>
    String(left?.linkedAt || "").localeCompare(String(right?.linkedAt || ""))
  );
  const runtimeState =
    store?.deviceRuntime && typeof store.deviceRuntime === "object"
      ? {
          deviceRuntime: cloneJsonValue(store.deviceRuntime),
        }
      : null;
  const personas = PERSONAS.map((persona) =>
    resolveProjectedRegisteredAgent(persona, existingAgents, existingWindows, runtimeState)
  );
  const groupHub = resolveProjectedRegisteredAgent(GROUP_HUB, existingAgents, existingWindows, runtimeState);
  return {
    initializedAt: text(store?.createdAt) || nowIso(),
    bootstrappedAt: text(store?.createdAt) || null,
    deviceRuntime: runtimeState,
    localReasoner: summarizeOfflineLocalReasoner(store?.deviceRuntime?.localReasoner || DEFAULT_LOCAL_REASONER),
    personas,
    groupHub,
    storePresent: Boolean(store),
    readOnlyProjection: true,
  };
}

async function bootstrapOfflineChatEnvironmentPassive() {
  return projectOfflineChatEnvironmentFromStore(await loadOfflineChatPassiveStore());
}

async function loadOfflineChatPassiveStore() {
  try {
    return await loadStoreIfPresent({ createKey: false });
  } catch (error) {
    if (error?.code === "STORE_KEY_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

export async function bootstrapOfflineChatEnvironment({ force = false, passive = false } = {}) {
  const checkedAtMs = Date.now();
  if (passive) {
    const value = await bootstrapOfflineChatEnvironmentPassive();
    return decorateOfflineBootstrapState(value, {
      source: value?.storePresent ? "read_only_store_snapshot" : "read_only_projection",
      checkedAtMs,
    });
  }

  const cacheFingerprint = force ? null : await readOfflineBootstrapStoreFingerprint();
  if (
    !force &&
    offlineBootstrapCache.value &&
    offlineBootstrapCache.expiresAt > checkedAtMs &&
    offlineBootstrapCache.fingerprint === cacheFingerprint
  ) {
    return decorateOfflineBootstrapState(offlineBootstrapCache.value, {
      source: "cache",
      checkedAtMs,
    });
  }

  if (!force && offlineBootstrapCache.promise && offlineBootstrapCache.pendingFingerprint === cacheFingerprint) {
    const value = await offlineBootstrapCache.promise;
    return decorateOfflineBootstrapState(value, {
      source: "shared_inflight",
      checkedAtMs: Date.now(),
    });
  }

  offlineBootstrapCache.pendingFingerprint = cacheFingerprint;
  const bootstrapPromise = bootstrapOfflineChatEnvironmentFresh()
    .then(async (value) => {
      const cachedAtMs = Date.now();
      offlineBootstrapCache.value = value;
      offlineBootstrapCache.fingerprint = await readOfflineBootstrapStoreFingerprint();
      offlineBootstrapCache.cachedAt = cachedAtMs;
      offlineBootstrapCache.expiresAt = cachedAtMs + OFFLINE_CHAT_BOOTSTRAP_TTL_MS;
      offlineBootstrapCache.promise = null;
      offlineBootstrapCache.pendingFingerprint = null;
      return value;
    })
    .catch((error) => {
      offlineBootstrapCache.promise = null;
      offlineBootstrapCache.pendingFingerprint = null;
      throw error;
    });

  offlineBootstrapCache.promise = bootstrapPromise;
  const value = await bootstrapPromise;
  return decorateOfflineBootstrapState(value, {
    source: force ? "forced_fresh" : "fresh",
    checkedAtMs: Date.now(),
  });
}

async function resolveOnlineSyncEndpoint({ allowProbe = true } = {}) {
  const explicit = text(process.env.OPENNEED_ONLINE_SYNC_ENDPOINT);
  if (explicit) {
    return explicit;
  }

  const checkedAtMs = Date.now();
  if (
    offlineSyncEndpointCache.promise == null &&
    checkedAtMs - Number(offlineSyncEndpointCache.checkedAt || 0) < OFFLINE_SYNC_ENDPOINT_CACHE_TTL_MS
  ) {
    return offlineSyncEndpointCache.value || "";
  }
  if (offlineSyncEndpointCache.promise) {
    return offlineSyncEndpointCache.promise;
  }
  if (!allowProbe) {
    return "";
  }

  offlineSyncEndpointCache.promise = (async () => {
    const probeUrl = "http://127.0.0.1:3000/api/health";
    let resolvedEndpoint = "";
    try {
      const response = await fetch(probeUrl, {
        method: "GET",
        signal: AbortSignal.timeout(800),
      });
      if (response.ok) {
        resolvedEndpoint = "http://127.0.0.1:3000/api/offline-sync/ingest";
      }
    } catch {
      // Local OpenNeed online endpoint is optional.
    }
    offlineSyncEndpointCache.value = resolvedEndpoint;
    offlineSyncEndpointCache.checkedAt = Date.now();
    offlineSyncEndpointCache.promise = null;
    return resolvedEndpoint;
  })().catch((error) => {
    offlineSyncEndpointCache.promise = null;
    throw error;
  });

  return offlineSyncEndpointCache.promise;
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

function buildOfflinePersonaRunnerPayload(
  persona,
  content,
  activeLocalReasoner,
  {
    threadKind = "direct",
    allowBootstrapBypass = false,
    dispatchContextLines = [],
  } = {}
) {
  const normalizedDispatchContextLines = normalizePersonaItems(dispatchContextLines);
  return {
    userTurn: content,
    currentGoal: [
      `${persona.currentGoal}。当前场景：离线${threadKind === "group" ? "群聊，请只代表自己发言" : "单聊"}，请用简洁中文回复，控制在2到4句。`,
      normalizedDispatchContextLines.length
        ? `当前主控调度上下文：${normalizedDispatchContextLines.join("；")}`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    sourceWindowId: persona.windowId,
    recordedByAgentId: persona.agent.agentId,
    recordedByWindowId: persona.windowId,
    persistRun: true,
    autoCompact: true,
    writeConversationTurns: true,
    storeToolResults: true,
    autoRecover: true,
    allowBootstrapBypass,
    reasonerProvider: activeLocalReasoner.provider,
    localReasoner: activeLocalReasoner,
    localReasonerTimeoutMs: activeLocalReasoner.timeoutMs,
  };
}

function shouldRetryOfflinePersonaRunner(runner = {}, activeLocalReasoner = {}) {
  const expectedProvider = text(activeLocalReasoner?.provider);
  if (expectedProvider !== "local_command") {
    return false;
  }
  const actualProvider = text(runner?.reasoner?.provider);
  const runnerStatus = text(runner?.run?.status);
  const hasVisibleReply = Boolean(text(resolveRunnerReply(runner)));
  if (actualProvider === expectedProvider && hasVisibleReply) {
    return false;
  }
  return (
    !actualProvider ||
    ["prepared", "bootstrap_required", "resident_locked", "blocked"].includes(runnerStatus) ||
    !hasVisibleReply
  );
}

async function restoreOfflinePersonaRunnerReadiness(persona, activeLocalReasoner = {}) {
  await bootstrapAgentRuntime(persona.agent.agentId, {
    displayName: persona.displayName,
    role: persona.role,
    currentGoal: persona.currentGoal,
    longTermGoal: persona.longTermGoal,
    stablePreferences: persona.stablePreferences,
    commitmentText: buildPersonaPrompt(persona),
    claimResidentAgent: false,
    createDefaultCommitment: true,
    sourceWindowId: persona.windowId,
    recordedByAgentId: persona.agent.agentId,
    recordedByWindowId: persona.windowId,
    maxConversationTurns: 18,
    maxContextChars: 22000,
  });
  await ensurePersonaMemory(persona.agent.agentId, persona.windowId, persona);
  if (text(activeLocalReasoner?.provider)) {
    try {
      await prewarmDeviceLocalReasoner({
        dryRun: false,
      });
    } catch {
      // Offline chat can still fall back to deterministic replies if prewarm is unavailable.
    }
  }
}

async function executeOfflinePersonaRunner(
  persona,
  content,
  activeLocalReasoner,
  { threadKind = "direct", dispatchContextLines = [] } = {}
) {
  let runner = await executeAgentRunner(
    persona.agent.agentId,
    buildOfflinePersonaRunnerPayload(persona, content, activeLocalReasoner, {
      threadKind,
      allowBootstrapBypass: false,
      dispatchContextLines,
    })
  );
  if (!shouldRetryOfflinePersonaRunner(runner, activeLocalReasoner)) {
    return runner;
  }
  await restoreOfflinePersonaRunnerReadiness(persona, activeLocalReasoner);
  runner = await executeAgentRunner(
    persona.agent.agentId,
    buildOfflinePersonaRunnerPayload(persona, content, activeLocalReasoner, {
      threadKind,
      allowBootstrapBypass: true,
      dispatchContextLines,
    })
  );
  return runner;
}

function buildDeterministicFallbackReply(persona, userTurn, { threadKind = "direct" } = {}) {
  const normalizedTurn = text(userTurn);
  const wantsProjectStatus =
    /(项目|openneed|在做什么|做哪些)/i.test(normalizedTurn) || hasLegacyProjectNameReference(normalizedTurn);
  if (wantsProjectStatus) {
    const projectLineByRole = {
      "master-orchestrator-agent": "我这边盯的是 agent-passport 主线推进、协作顺序、关键依赖和整体节奏。",
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

async function requestCompactOfflinePersonaReply(
  persona,
  userTurn,
  {
    threadKind = "direct",
    localReasoner = null,
    dispatchContextLines = [],
    store = null,
    history = null,
    sharedMemory = null,
  } = {}
) {
  const activeLocalReasoner = summarizeOfflineLocalReasoner(localReasoner || await resolveActiveOfflineLocalReasoner());
  if (!supportsOfflineChatHttpReasoner(activeLocalReasoner)) {
    throw new Error(`offline compact reply requires ollama_local; active provider is ${activeLocalReasoner.provider}`);
  }
  const threadId = threadKind === "group" ? "group" : persona.agent.agentId;
  const effectiveHistory =
    history ||
    await getOfflineChatHistory(threadId, {
      limit: 8,
      passive: !store,
      store,
    });
  const historyLines = summarizeHistoryMessages(effectiveHistory.messages || []);
  const effectiveSharedMemory =
    sharedMemory || (await getPersonaSharedMemoryContext(persona.agent.agentId, { store }));
  const normalizedDispatchContextLines = normalizePersonaItems(dispatchContextLines);
  const sharedMemoryIntent = detectSharedMemoryIntent(userTurn);
  const relevantSharedMemories = selectRelevantSharedMemories(userTurn, {
    entries: effectiveSharedMemory.entries,
    limit: 3,
    preferredKeys: sharedMemoryIntent?.preferredKeys || [],
  });
  const contextBundle = await buildAgentContextBundle(persona.agent.agentId, {
    currentGoal: persona.currentGoal,
    query: userTurn,
    recentConversationTurns: (effectiveHistory.messages || [])
      .slice(-6)
      .map((message) => ({
        role: message.role || "unknown",
        content: text(message.content || ""),
      }))
      .filter((entry) => text(entry.content)),
  }, {
    store,
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
    normalizedDispatchContextLines.length
      ? `当前主控调度上下文：\n- ${normalizedDispatchContextLines.join("\n- ")}`
      : null,
    relevantSharedMemories.length > 0
      ? `匹配到的共享长期记忆：\n- ${relevantSharedMemories
          .map((entry) => `${entry.title}：${entry.value}`)
          .join("\n- ")}`
      : `共享长期记忆总览：\n- ${effectiveSharedMemory.entries
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
        storeSnapshot: Boolean(store),
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

async function requestEmergencyOfflinePersonaReply(
  persona,
  userTurn,
  { localReasoner = null, dispatchContextLines = [] } = {}
) {
  const activeLocalReasoner = summarizeOfflineLocalReasoner(localReasoner || await resolveActiveOfflineLocalReasoner());
  const normalizedDispatchContextLines = normalizePersonaItems(dispatchContextLines);
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
            content: [
              `你是${persona.displayName}，${persona.title}。如果 Kane 在闲聊，就自然回应；如果 Kane 在讨论任务或项目，就按自己的职责边界说重点。请用简体中文回复 Kane，语气符合“${persona.voice}”，只说 1 到 2 句自然的话，不要输出任何字段、编号、身份说明。`,
              normalizedDispatchContextLines.length
                ? `当前主控调度上下文：${normalizedDispatchContextLines.join("；")}`
                : null,
            ]
              .filter(Boolean)
              .join("\n"),
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
  dispatchState = null,
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
      dispatchState: normalizeOfflineDispatchMetadata(dispatchState),
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

async function recordGroupTurn(
  groupHub,
  userText,
  responses,
  {
    sharedMemoryFastPath = null,
    localReasoningStack = null,
    dispatch = null,
    execution = null,
    threadProtocol = null,
  } = {}
) {
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
        role: text(entry?.role) || null,
        content: entry.content,
        dispatchBatch:
          Number.isFinite(Number(entry?.dispatchBatch)) ? Math.floor(Number(entry.dispatchBatch)) : null,
        executionMode: text(entry?.executionMode) || null,
        status: text(entry?.status) || null,
        dispatch: normalizeOfflineDispatchMetadata(entry.dispatch),
        source: normalizeOfflineResponseSource(entry.source, {
          localReasoningStack: entry?.source?.localReasoningStack ?? localReasoningStack,
        }),
      })),
      dispatch: cloneJsonValue(dispatch),
      execution: cloneJsonValue(execution),
      threadProtocol: cloneJsonValue(threadProtocol),
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

async function resolveOfflineGroupPersonaResponse(
  persona,
  content,
  activeLocalReasoner,
  {
    sharedMemoryIntent = null,
    defaultSharedMemory = null,
    dispatchContextLines = [],
    dispatchPlanEntry = null,
    dispatch = null,
    runtimeReadContext = null,
    verificationMode = null,
  } = {}
) {
  let assistantText = "";
  let assistantSource = null;
  const dispatchMetadata = dispatchPlanEntry
    ? {
        phaseKey: text(dispatch?.phaseKey) || "phase_1",
        batchId: dispatchPlanEntry?.dispatchBatch ?? null,
        executionMode: null,
        concurrency: null,
        dispatchBatch: dispatchPlanEntry?.dispatchBatch ?? null,
        dispatchMode: text(dispatchPlanEntry?.dispatchMode) || null,
        activationStage: text(dispatchPlanEntry?.activationStage) || null,
        activationReasons: normalizePersonaItems(dispatchPlanEntry?.activationReasons),
        dependsOn: Array.isArray(dispatchPlanEntry?.dependsOn) ? dispatchPlanEntry.dependsOn : [],
        writeScope: normalizePersonaItems(dispatchPlanEntry?.writeScope),
        writesSharedState: Boolean(dispatchPlanEntry?.writesSharedState),
      }
    : null;
  const relevantSharedMemories = sharedMemoryIntent
    ? selectRelevantSharedMemories(content, {
        entries: defaultSharedMemory?.entries || [],
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
  const normalizedVerificationMode = normalizeOfflineChatVerificationMode(verificationMode);

  if (normalizedVerificationMode === "synthetic") {
    assistantText = buildOfflineVerificationPersonaReply(persona, content, {
      dispatchPlanEntry,
      dispatchContextLines,
    });
    assistantSource = buildOfflineResponseSource({
      provider: "local_mock",
      model: "offline-dispatch-smoke",
      promptStyle: "offline_dispatch_verification_v1",
      stage: "verification",
      localReasoningStack: "local_mock:dispatch-smoke",
      dispatch: dispatchMetadata,
    });
  } else if (sharedMemoryFastPath) {
    assistantText = buildFastSharedMemoryReply(persona, content, relevantSharedMemories);
    assistantSource = buildOfflineResponseSource({
      provider: "passport_fast_memory",
      model: "shared-memory-fast-path",
      promptStyle: "shared_memory_fast_path_v2",
      stage: "fast_path",
      localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner, {
        fastPath: true,
      }),
      dispatch: dispatchMetadata,
    });
  } else {
    try {
      const reasoning = await requestCompactOfflinePersonaReply(persona, content, {
        threadKind: "group",
        localReasoner: activeLocalReasoner,
        dispatchContextLines,
        store: runtimeReadContext?.store || null,
        history: runtimeReadContext?.groupHistory || null,
        sharedMemory: defaultSharedMemory || runtimeReadContext?.sharedMemory || null,
      });
      assistantText = text(reasoning?.responseText);
      assistantSource = buildOfflineResponseSource({
        provider: reasoning?.provider,
        model: reasoning?.model,
        promptStyle: reasoning?.metadata?.promptStyle,
        stage: "direct_reasoner",
        localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner),
        dispatch: dispatchMetadata,
      });
    } catch {
      try {
        const emergency = await requestEmergencyOfflinePersonaReply(persona, content, {
          localReasoner: activeLocalReasoner,
          dispatchContextLines,
        });
        assistantText = text(emergency?.responseText);
        assistantSource = buildOfflineResponseSource({
          provider: emergency?.provider,
          model: emergency?.model,
          promptStyle: emergency?.metadata?.promptStyle,
          stage: "emergency",
          localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner),
          dispatch: dispatchMetadata,
        });
      } catch {
        const runner = await executeOfflinePersonaRunner(persona, content, activeLocalReasoner, {
          threadKind: "group",
          dispatchContextLines,
        });
        assistantText = sanitizeOfflineReply(resolveRunnerReply(runner));
        assistantSource = buildOfflineResponseSource({
          provider: runner?.reasoner?.provider || activeLocalReasoner.provider,
          model: runner?.reasoner?.metadata?.model || runner?.reasoner?.model || activeLocalReasoner.model,
          promptStyle: runner?.reasoner?.metadata?.promptStyle || null,
          stage: "runner",
          localReasoningStack: buildOfflineLocalReasoningStack(activeLocalReasoner),
          dispatch: dispatchMetadata,
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
        dispatch: dispatchMetadata,
      });
  }

  const localReasoningStack = assistantSource?.localReasoningStack || buildOfflineLocalReasoningStack(activeLocalReasoner, {
    fastPath: Boolean(sharedMemoryFastPath),
  });
  if (normalizedVerificationMode === "synthetic") {
    return {
      agentId: persona.agent.agentId,
      displayName: persona.displayName,
      role: text(dispatchPlanEntry?.role || persona?.role) || null,
      content: assistantText,
      createdAt: nowIso(),
      syncRecordId: null,
      dispatchBatch:
        Number.isFinite(Number(dispatchPlanEntry?.dispatchBatch)) ? Number(dispatchPlanEntry.dispatchBatch) : null,
      executionMode: null,
      status: "completed",
      source: assistantSource,
      dispatch: dispatchMetadata,
    };
  }
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
    dispatchState: dispatchMetadata,
  });
  return {
    agentId: persona.agent.agentId,
    displayName: persona.displayName,
    role: text(dispatchPlanEntry?.role || persona?.role) || null,
    content: assistantText,
    createdAt: nowIso(),
    syncRecordId: syncRecord.passportMemoryId,
    dispatchBatch:
      Number.isFinite(Number(dispatchPlanEntry?.dispatchBatch)) ? Number(dispatchPlanEntry.dispatchBatch) : null,
    executionMode: null,
    status: "completed",
    source: assistantSource,
    dispatch: dispatchMetadata,
  };
}

async function executeOfflineGroupDispatch(
  team,
  content,
  activeLocalReasoner,
  dispatch,
  {
    sharedMemoryIntent = null,
    defaultSharedMemory = null,
    runtimeReadContext = null,
    verificationMode = null,
  } = {}
) {
  const responses = [];
  const priorResponses = [];
  const batchPlan = Array.isArray(dispatch?.batchPlan) ? dispatch.batchPlan : [];
  const execution = buildOfflineGroupExecutionState(dispatch);

  for (const batch of batchPlan) {
    const roles = Array.isArray(batch?.roles) ? batch.roles : [];
    if (roles.length === 0) {
      continue;
    }
    const batchState = execution.batches.find((entry) => String(entry?.batchId) === String(batch?.batchId)) || null;
    markOfflineGroupExecutionBatchStarted(execution, batchState);
    const runRole = async (roleEntry) => {
      const persona = findTeamPersonaByRole(team?.personas || [], roleEntry?.role);
      if (!persona) {
        return null;
      }
      const roleState =
        batchState?.roles.find(
          (entry) =>
            (roleEntry?.agentId && entry?.agentId === roleEntry.agentId) ||
            (text(entry?.role) && text(entry?.role) === text(roleEntry?.role))
        ) || null;
      markOfflineGroupExecutionRoleStarted(roleState);
      try {
        const response = await resolveOfflineGroupPersonaResponse(persona, content, activeLocalReasoner, {
          sharedMemoryIntent,
          defaultSharedMemory,
          dispatch,
          dispatchContextLines: buildOfflineGroupDispatchContextLines(roleEntry, dispatch, priorResponses),
          dispatchPlanEntry: roleEntry,
          runtimeReadContext,
          verificationMode,
        });
        return {
          ok: true,
          response,
        };
      } catch (error) {
        markOfflineGroupExecutionRoleFailed(roleState, error);
        appendOfflineGroupExecutionError(
          execution,
          buildOfflineGroupExecutionError(error, {
            batchId: batch?.batchId ?? null,
            role: roleEntry?.role,
            agentId: persona?.agent?.agentId,
          })
        );
        return {
          ok: false,
          error,
          role: roleEntry?.role,
          agentId: persona?.agent?.agentId || null,
        };
      }
    };

    const batchResults =
      text(batch?.executionMode) === "parallel"
        ? await mapWithConcurrency(roles, Number(batch?.concurrency || 1), runRole)
        : await mapWithConcurrency(roles, 1, runRole);
    const normalizedBatchResults = (Array.isArray(batchResults) ? batchResults : []).filter(Boolean);
    const normalizedBatchResponses = normalizedBatchResults
      .filter((entry) => entry?.ok === true && entry?.response)
      .map((entry) => entry.response);
    const failedBatchCount = normalizedBatchResults.filter((entry) => entry?.ok === false).length;
    for (const response of normalizedBatchResponses) {
      response.executionMode = text(batch?.executionMode) || "serial";
      response.status = "completed";
      response.dispatchBatch =
        response.dispatchBatch ??
        (batch?.batchId === "merge" ? null : Number.isFinite(Number(batch?.batchId)) ? Number(batch.batchId) : null);
      response.dispatch = {
        ...(response.dispatch || {}),
        batchId: batch?.batchId ?? null,
        executionMode: text(batch?.executionMode) || "serial",
        concurrency: Math.max(1, Math.floor(Number(batch?.concurrency || 1))),
        status: "completed",
      };
      if (response.source) {
        response.source = normalizeOfflineResponseSource({
          ...response.source,
          dispatch: response.dispatch,
        });
      }
      const roleState =
        batchState?.roles.find(
          (entry) =>
            (response?.agentId && entry?.agentId === response.agentId) ||
            (text(entry?.role) && text(entry?.role) === text(response?.role))
        ) || null;
      finalizeOfflineGroupExecutionRole(roleState, response);
    }
    responses.push(...normalizedBatchResponses);
    priorResponses.push(
      ...normalizedBatchResponses.map((entry) => ({
        displayName: entry.displayName,
        role: text(entry?.dispatch?.role) || null,
        content: entry.content,
      }))
    );
    finalizeOfflineGroupExecutionBatch(execution, batchState, { hadErrors: failedBatchCount > 0 });
  }

  execution.summary = summarizeOfflineGroupExecution(execution);
  return {
    responses,
    execution,
  };
}

function hasOfflineSharedMemoryFastPath(sharedMemoryFastPath = null) {
  return Array.isArray(sharedMemoryFastPath?.memories) && sharedMemoryFastPath.memories.length > 0;
}

function normalizeOfflineChatVerificationMode(value = null) {
  const normalized = text(value);
  return normalized === "synthetic" ? normalized : null;
}

function buildOfflineVerificationPersonaReply(
  persona,
  userTurn,
  {
    dispatchPlanEntry = null,
    dispatchContextLines = [],
  } = {}
) {
  const lead = text(persona?.displayName) || "成员";
  const title = text(persona?.title) || "当前职责";
  const batchLabel = Number.isFinite(Number(dispatchPlanEntry?.dispatchBatch))
    ? `第 ${Number(dispatchPlanEntry.dispatchBatch)} 批`
    : text(dispatchPlanEntry?.dispatchBatch) === "merge"
      ? "收口批"
      : "";
  const writeScope = normalizePersonaItems(dispatchPlanEntry?.writeScope);
  const activationReasons = normalizePersonaItems(dispatchPlanEntry?.activationReasons);
  const dispatchLead = normalizePersonaItems(dispatchContextLines)[0] || "";
  const focus =
    writeScope[0] ||
    activationReasons[0] ||
    dispatchLead ||
    truncateLine(userTurn, 24) ||
    "当前问题";
  return ensureVisibleReplyContent(
    [
      `${lead} 收到。`,
      `${batchLabel ? `${batchLabel}里，` : ""}我先按${title}推进：${truncateLine(focus, 48)}。`,
    ].join(" "),
    lead
  );
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
  const canUseSharedMemoryFastPath = hasOfflineSharedMemoryFastPath(sharedMemoryFastPath);
  if (!canUseSharedMemoryFastPath) {
    await ensureOfflineChatPersonaReady(persona);
  }
  if (canUseSharedMemoryFastPath) {
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
      const runtimeReadStore = await loadStore();
      const directHistory = await getOfflineChatHistory(persona.agent.agentId, {
        limit: 8,
        passive: false,
        store: runtimeReadStore,
      });
      reasoning = await requestCompactOfflinePersonaReply(persona, content, {
        threadKind: "direct",
        localReasoner: activeLocalReasoner,
        store: runtimeReadStore,
        history: directHistory,
        sharedMemory,
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
        runner = await executeOfflinePersonaRunner(persona, content, activeLocalReasoner, {
          threadKind: "direct",
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

  const startupContext = await resolveOfflineChatThreadStartupContext(team, {
    phaseKey: "phase_1",
    trigger: "direct_message_send",
    persistProtocolEvent: false,
  });
  const postWriteStore = await loadStore();
  const postWriteDirectRecords = listRecentAgentMemoriesFromStore(postWriteStore, persona.agent.agentId, {
    kind: "offline_sync_turn",
    limit: 8,
  });
  const postWriteRuntimeViews = buildOfflineChatDirectRuntimeViews(team, persona, {
    startupContext,
    directRecords: postWriteDirectRecords,
  });

  return {
    threadId: persona.agent.agentId,
    persona,
    runner,
    reasoning,
    assistantSource,
    syncRecord,
    dispatchHistory: postWriteRuntimeViews.dispatchHistory,
    dispatchView: postWriteRuntimeViews.dispatchView,
    threadView: postWriteRuntimeViews.threadView,
    threadStartup: cloneJsonValue(startupContext) ?? null,
    startupSignature: text(startupContext?.startupSignature) || null,
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

export async function sendOfflineChatGroupMessage(content, { verificationMode = null } = {}) {
  const team = await bootstrapOfflineChatEnvironment();
  const activeLocalReasoner = await resolveActiveOfflineLocalReasoner();
  const normalizedVerificationMode = normalizeOfflineChatVerificationMode(verificationMode);
  const startupContext = await resolveOfflineChatThreadStartupContext(team, {
    phaseKey: "phase_1",
    trigger: "message_send",
    persistProtocolEvent: normalizedVerificationMode !== "synthetic",
  });
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
  const canUseGroupSharedMemoryFastPath = hasOfflineSharedMemoryFastPath(groupSharedMemoryFastPath);
  const runtimeReadStore = await loadStore();
  const latestDispatchView = buildLatestOfflineGroupDispatchView(team, runtimeReadStore);
  const dispatch = buildOfflineGroupDispatch(team, content, { startupContext, latestDispatchView });
  const selectedRoles = new Set(
    (Array.isArray(dispatch?.selectedRoles) ? dispatch.selectedRoles : [])
      .map((entry) => text(entry?.role))
      .filter(Boolean)
  );
  const selectedPersonas = team.personas.filter((persona) => selectedRoles.has(text(persona?.role)));
  const shouldSkipHeavyPersonaPreparation =
    canUseGroupSharedMemoryFastPath || normalizedVerificationMode === "synthetic";
  if (!shouldSkipHeavyPersonaPreparation) {
    await mapWithConcurrency(
      selectedPersonas,
      Math.min(selectedPersonas.length || 1, OFFLINE_CHAT_PERSONA_READY_CONCURRENCY),
      (persona) => ensureOfflineChatPersonaReady(persona)
    );
  }
  const groupHistory = shouldSkipHeavyPersonaPreparation
    ? null
    : await getOfflineChatHistory("group", {
        limit: 8,
        passive: false,
        store: runtimeReadStore,
      });
  const runtimeReadContext = {
    store: runtimeReadStore,
    groupHistory,
    sharedMemory: defaultSharedMemory,
  };
  const threadProtocol = normalizeThreadProtocolState(startupContext?.threadProtocol, {
    recordedAt: startupContext?.protocolActivatedAt,
  });
  let responses = [];
  let execution = buildOfflineGroupExecutionState(dispatch);
  let executionError = null;
  try {
    const dispatchExecution = await executeOfflineGroupDispatch(team, content, activeLocalReasoner, dispatch, {
      sharedMemoryIntent,
      defaultSharedMemory,
      runtimeReadContext,
      verificationMode: normalizedVerificationMode,
    });
    responses = Array.isArray(dispatchExecution?.responses) ? dispatchExecution.responses : [];
    execution = dispatchExecution?.execution || execution;
  } catch (error) {
    executionError = error;
    markOfflineGroupExecutionFailed(execution, error);
    execution.summary = summarizeOfflineGroupExecution(execution);
  }

  const groupRecord = await recordGroupTurn(team.groupHub, content, responses, {
    sharedMemoryFastPath: canUseGroupSharedMemoryFastPath ? groupSharedMemoryFastPath : null,
    localReasoningStack:
      normalizedVerificationMode === "synthetic"
        ? "local_mock:dispatch-smoke"
        : buildOfflineLocalReasoningStack(activeLocalReasoner, {
            fastPath: canUseGroupSharedMemoryFastPath,
          }),
    dispatch,
    execution,
    threadProtocol,
  });
  const postWriteStore = await loadStore();
  const postWriteGroupRecords = listRecentAgentMemoriesFromStore(postWriteStore, team.groupHub.agent.agentId, {
    kind: "offline_group_turn",
    limit: 8,
  });
  const postWriteProtocolRecords = listRecentAgentMemoriesFromStore(postWriteStore, team.groupHub.agent.agentId, {
    kind: OFFLINE_THREAD_PROTOCOL_EVENT_KIND,
    limit: 8,
  });
  const postWriteRuntimeViews = buildOfflineChatGroupRuntimeViews(team, {
    startupContext,
    groupRecords: postWriteGroupRecords,
    protocolRecords: postWriteProtocolRecords,
  });

  return {
    threadId: "group",
    team,
    threadProtocol,
    dispatch,
    execution,
    executionSummary: summarizeOfflineChatParallelSubagentExecution(execution, dispatch),
    dispatchHistory: postWriteRuntimeViews.dispatchHistory,
    dispatchView: postWriteRuntimeViews.dispatchView,
    threadView: postWriteRuntimeViews.threadView,
    threadStartup: cloneJsonValue(startupContext) ?? null,
    startupSignature: text(startupContext?.startupSignature) || null,
    groupRecord,
    user: {
      role: "user",
      author: "Kane",
      content,
      createdAt: nowIso(),
    },
    responses,
    error: executionError
      ? {
          message: text(executionError?.message) || "offline_group_dispatch_failed",
        }
      : null,
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

function formatOfflineChatViewTime(value) {
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

function resolveOfflineChatSourceLabel(provider, sourceSummary = null) {
  const normalizedProvider = text(provider);
  if (!normalizedProvider) {
    return "全部来源";
  }
  const providers = Array.isArray(sourceSummary?.providers) ? sourceSummary.providers : [];
  const matched = providers.find((entry) => text(entry?.provider) === normalizedProvider);
  if (matched?.label) {
    return matched.label;
  }
  return labelOfflineResponseSource(normalizedProvider) || normalizedProvider;
}

function formatOfflineChatParticipantNames(participants = []) {
  const names = (Array.isArray(participants) ? participants : [])
    .map((entry) => text(entry?.displayName))
    .filter(Boolean);
  if (!names.length) {
    return "团队里的每个人";
  }
  return names.join("、");
}

function buildOfflineChatSyncViewLines(sync = null) {
  if (!sync) {
    return ["正在读取同步状态…"];
  }
  const lines = [];
  if (Number(sync.pendingCount || 0) > 0) {
    lines.push(`待同步离线记录：${Number(sync.pendingCount || 0)} 条`);
  } else {
    lines.push("离线记录已同步或当前没有待同步内容。");
  }

  if (sync.endpointConfigured && text(sync.endpoint)) {
    lines.push(`在线入口：${text(sync.endpoint)}`);
  } else {
    lines.push("当前还没有配置在线接收入口；离线记录仍会先落到本地 outbox。");
  }

  if (text(sync.status) === "delivered") {
    lines.push("最近一次同步已成功送达在线入口。");
  } else if (text(sync.status) === "delivery_failed") {
    lines.push("最近一次同步失败，系统会在联网状态下继续重试。");
  } else if (text(sync.status) === "awaiting_remote_endpoint") {
    lines.push("如果要自动回灌到在线版，需要配置在线同步入口。");
  } else if (text(sync.status) === "ready_to_sync") {
    lines.push("当前已经具备自动同步条件。");
  }

  if (text(sync.localReceiptStatus) === "recorded_with_warnings") {
    lines.push("远端已送达，本地回执有告警，但不会把这批已送达记录再次当成待同步。");
  } else if (text(sync.localReceiptStatus) === "at_risk") {
    lines.push("远端已送达，但本地回执没有完整落盘，后续可能重复同步同一批记录。");
  }
  if (Array.isArray(sync.localReceiptWarnings) && sync.localReceiptWarnings.length > 0) {
    lines.push(`本地回执告警：${sync.localReceiptWarnings.length} 条。`);
  }
  return lines;
}

function buildOfflineChatSyncView(sync = null) {
  const endpoint = text(sync?.endpoint) || null;
  const normalized = {
    status: text(sync?.status) || "idle",
    pendingCount: Number.isFinite(Number(sync?.pendingCount)) ? Math.max(0, Math.floor(Number(sync.pendingCount))) : 0,
    endpoint,
    endpointConfigured: sync?.endpointConfigured === true || Boolean(endpoint),
    localReceiptStatus: text(sync?.localReceiptStatus) || null,
    localReceiptWarnings: Array.isArray(sync?.localReceiptWarnings) ? sync.localReceiptWarnings : [],
  };
  return {
    ...normalized,
    viewLines: buildOfflineChatSyncViewLines(normalized),
  };
}

function labelOfflineChatSubagentStage(value) {
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

function labelOfflineChatSubagentDispatchMode(value) {
  const labels = {
    serial_gatekeeper: "串行闸门",
    serial_first_then_handoff: "先串后放行",
    parallel_candidate: "并行候选",
    support_only: "支持位",
    manual_only: "人工放行",
  };
  return labels[text(value)] || text(value) || "";
}

function summarizeOfflineChatSubagentPlanEntry(planEntry = null) {
  if (!planEntry) {
    return "";
  }
  const batch = Number.isFinite(Number(planEntry?.dispatchBatch)) ? `批次 ${Number(planEntry.dispatchBatch)}` : "";
  return [
    labelOfflineChatSubagentStage(planEntry?.activationStage),
    labelOfflineChatSubagentDispatchMode(planEntry?.dispatchMode),
    batch,
  ]
    .filter(Boolean)
    .join(" · ");
}

function summarizeOfflineChatParallelSubagentPolicy(policy = null) {
  if (!policy || policy.synced !== true) {
    return "";
  }
  const executionMode = text(policy?.executionMode);
  const modeLead =
    executionMode === "automatic_fanout"
      ? "满足条件时自动 fan-out"
      : executionMode === "serial_fallback"
        ? "当前按串行回退准备"
        : "当前按主控闸门准备";
  return `当前线程已同步并行配置：${modeLead}，最多同时放行 ${Number(policy?.maxConcurrentSubagents || 0)} 个角色，当前有 ${Number(policy?.parallelEligibleCount || 0)} 个并行候选角色。`;
}

function buildOfflineChatParallelSubagentPolicyDetailLines(policy = null) {
  if (!policy || policy.synced !== true) {
    return [];
  }
  const configVersion = text(policy?.configVersion);
  const dispatchModel = text(policy?.dispatchModel);
  const lifecycle = (Array.isArray(policy?.lifecycle) ? policy.lifecycle : []).map((entry) => text(entry)).filter(Boolean);
  const blockedBy = (Array.isArray(policy?.blockedBy) ? policy.blockedBy : []).map((entry) => text(entry)).filter(Boolean);
  const activationGates = (Array.isArray(policy?.activationGates) ? policy.activationGates : [])
    .map((entry) => text(entry))
    .filter(Boolean);
  const detailLines = [
    configVersion || dispatchModel ? `策略版本：${[configVersion, dispatchModel].filter(Boolean).join(" · ")}` : "",
    `并行候选 ${Number(policy?.parallelEligibleCount || 0)} 个；仅串行 ${Number(policy?.serialOnlyCount || 0)} 个。`,
    lifecycle.length ? `执行链：${lifecycle.join(" -> ")}` : "",
    activationGates[0] ? `放行闸门：${activationGates[0]}` : "",
    blockedBy.length ? `默认暂缓条件：${blockedBy.slice(0, 3).join("、")}` : "",
  ];
  return detailLines.filter(Boolean);
}

function summarizeOfflineChatParallelSubagentExecution(execution = null, dispatch = null) {
  if (!execution || typeof execution !== "object") {
    return text(dispatch?.summary) || "";
  }
  if (["failed", "completed_with_errors"].includes(text(execution?.status)) && text(execution?.summary)) {
    return [
      text(execution?.summary),
      Array.isArray(dispatch?.blockedRoles) && dispatch.blockedRoles.length > 0
        ? `本轮暂缓 ${dispatch.blockedRoles.length} 个角色。`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
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
  ]
    .filter(Boolean)
    .join(" ");
}

function buildOfflineChatParallelSubagentExecutionDetailLines(execution = null, dispatch = null) {
  const batches = Array.isArray(execution?.batches) ? execution.batches : [];
  const completedBatchCount = batches.filter((entry) =>
    ["completed", "completed_with_errors"].includes(text(entry?.status))
  ).length;
  const parallelBatchCount = (Array.isArray(dispatch?.batchPlan) ? dispatch.batchPlan : []).filter(
    (entry) => text(entry?.executionMode) === "parallel"
  ).length;
  const selectedRoleCount = Array.isArray(dispatch?.selectedRoles) ? dispatch.selectedRoles.length : 0;
  const blockedRoleCount = Array.isArray(dispatch?.blockedRoles) ? dispatch.blockedRoles.length : 0;
  return [
    text(execution?.executionMode)
      ? `执行模式：${text(execution.executionMode) === "automatic_fanout" ? "自动 fan-out" : "串行回退"}`
      : "",
    batches.length ? `完成批次：${completedBatchCount}/${batches.length}` : "",
    selectedRoleCount > 0 ? `本轮激活 ${selectedRoleCount} 个角色。` : "",
    parallelBatchCount > 0 ? `其中 ${parallelBatchCount} 个批次按并行放行。` : "",
    blockedRoleCount > 0 ? `本轮暂缓 ${blockedRoleCount} 个角色。` : "",
    dispatch?.continuation?.active === true ? "本轮属于延续型推进，继承上一轮已收口范围。" : "",
  ].filter(Boolean);
}

function collectOfflineChatStartupParticipants(startupContext = null, thread = null, team = null) {
  const startupParticipants = [
    ...(Array.isArray(startupContext?.coreParticipants) ? startupContext.coreParticipants : []),
    ...(Array.isArray(startupContext?.supportParticipants) ? startupContext.supportParticipants : []),
  ]
    .map((entry) => ({
      agentId: text(entry?.agentId) || null,
      displayName: text(entry?.displayName) || null,
      title: text(entry?.title) || null,
      role: text(entry?.role) || null,
      currentGoal: text(entry?.currentGoal || entry?.coreMission) || null,
    }))
    .filter((entry) => entry.displayName || entry.agentId);
  if (startupParticipants.length > 0) {
    return startupParticipants;
  }
  const threadParticipants = Array.isArray(thread?.participants)
    ? thread.participants
        .map((entry) => ({
          agentId: text(entry?.agentId) || null,
          displayName: text(entry?.displayName) || null,
          title: text(entry?.title) || null,
          role: text(entry?.role) || null,
          currentGoal: text(entry?.currentGoal) || null,
        }))
        .filter((entry) => entry.displayName || entry.agentId)
    : [];
  if (threadParticipants.length > 0) {
    return threadParticipants;
  }
  return Array.isArray(team?.personas)
    ? team.personas
        .map((persona) => ({
          agentId: text(persona?.agent?.agentId) || null,
          displayName: text(persona?.displayName) || null,
          title: text(persona?.title) || null,
          role: text(persona?.role) || null,
          currentGoal: text(persona?.currentGoal) || null,
        }))
        .filter((entry) => entry.displayName || entry.agentId)
    : [];
}

function buildOfflineChatContextCard(title, meta, lines = []) {
  return {
    title: text(title) || "线程信息",
    meta: text(meta) || "线程上下文",
    lines: normalizePersonaItems(lines),
  };
}

function buildOfflineChatThreadView({
  thread = null,
  startupContext = null,
  team = null,
  sourceSummary = null,
  sourceFilter = null,
  latestExecution = null,
  latestDispatch = null,
} = {}) {
  if (!thread) {
    return null;
  }
  const normalizedFilter = normalizeOfflineHistorySourceFilter(sourceFilter);
  if (text(thread?.threadKind) === "group") {
    const participants = collectOfflineChatStartupParticipants(startupContext, thread, team);
    const memberCount = Number(
      startupContext?.groupThread?.memberCount ||
        thread?.memberCount ||
        participants.length ||
        team?.personas?.length ||
        0
    );
    const coreCount = Number(startupContext?.coreParticipantCount || 0);
    const supportCount = Number(startupContext?.supportParticipantCount || 0);
    const protocol = startupContext?.threadProtocol || null;
    const protocolTitle = text(protocol?.title || startupContext?.protocolVersion);
    const protocolSummary = text(startupContext?.protocolSummary || protocol?.protocolSummary);
    const protocolActivatedAt = text(startupContext?.protocolActivatedAt || protocol?.protocolActivatedAt);
    const parallelizationPolicy = Array.isArray(startupContext?.parallelizationPolicy)
      ? startupContext.parallelizationPolicy.map((entry) => text(entry)).filter(Boolean)
      : ["先由主控串行收口目标、边界、验收和关键依赖，再决定是否并行。"];
    const parallelSubagentSummary = summarizeOfflineChatParallelSubagentPolicy(startupContext?.parallelSubagentPolicy);
    const parallelSubagentPolicyDetails = buildOfflineChatParallelSubagentPolicyDetailLines(
      startupContext?.parallelSubagentPolicy
    );
    const latestExecutionSummary = summarizeOfflineChatParallelSubagentExecution(latestExecution, latestDispatch);
    const latestExecutionDetails = buildOfflineChatParallelSubagentExecutionDetailLines(latestExecution, latestDispatch);
    const filterLabel = normalizedFilter ? resolveOfflineChatSourceLabel(normalizedFilter, sourceSummary) : "";
    const dispatchLead =
      startupContext?.parallelSubagentPolicy?.synced
        ? `当前由主控先判断，满足条件时才按计划放行需要的成员回应。最多并行 ${Number(startupContext?.parallelSubagentPolicy?.maxConcurrentSubagents || 1)} 个角色。`
        : "当前由主控先判断，满足条件时才按计划放行需要的成员回应。";
    const summaryLines = [
      `当前线程共有 ${memberCount} 位成员。`,
      coreCount || supportCount ? `当前编组：${coreCount} 位工作角色，${supportCount} 位支持角色。` : "当前正在读取线程角色分布。",
      protocolTitle && protocolSummary ? `当前协议：${protocolTitle}。${protocolSummary}` : "",
      protocolActivatedAt ? `协议生效时间：${formatOfflineChatViewTime(protocolActivatedAt)}。` : "",
      `推进方式：${parallelizationPolicy[0]}`,
      parallelSubagentSummary ? `启动配置：${parallelSubagentSummary}` : "",
      latestExecutionSummary ? `最近执行：${latestExecutionSummary}` : "最近执行：当前还没有可展示的调度结果。",
    ].filter(Boolean);
    const planEntries = Array.isArray(startupContext?.subagentPlan) ? startupContext.subagentPlan : [];
    const participantCards = participants.map((entry) => {
      const planEntry =
        planEntries.find(
          (candidate) =>
            (text(entry?.agentId) && text(candidate?.agentId) === text(entry?.agentId)) ||
            (text(entry?.role) && text(candidate?.role) === text(entry?.role))
        ) || null;
      const meta = [text(entry?.title), text(entry?.role), summarizeOfflineChatSubagentPlanEntry(planEntry)]
        .filter(Boolean)
        .join(" · ");
      return buildOfflineChatContextCard(entry?.displayName || "成员", meta || "线程成员", [
        text(entry?.currentGoal) || "当前职责信息读取中。",
      ]);
    });
    return {
      threadId: "group",
      header: {
        title: "我们的群聊",
        description: normalizedFilter
          ? `当前是 ${memberCount} 人线程，正在只看「${filterLabel}」来源的回复。`
          : `当前是 ${memberCount} 人线程。${dispatchLead}`,
        pill: normalizedFilter ? `${memberCount} 人线程 · 已筛选` : `${memberCount} 人线程`,
        composerHint: `当前成员：${formatOfflineChatParticipantNames(participants)}。发送后会先经过主控闸门，满足条件时再由需要的成员回应。`,
      },
      context: {
        summaryLines,
        cards: [
          buildOfflineChatContextCard("协作公约", "当前线程启动配置", [
            protocolTitle ? `当前协议：${protocolTitle}` : "",
            protocolSummary ? `默认规则：${protocolSummary}` : "",
            protocolActivatedAt ? `生效时间：${formatOfflineChatViewTime(protocolActivatedAt)}` : "",
            ...parallelizationPolicy,
            parallelSubagentSummary,
            ...parallelSubagentPolicyDetails,
          ]),
          buildOfflineChatContextCard("最近执行", "最近一轮调度结果", [
            latestExecutionSummary || "当前还没有可展示的调度结果。",
            ...latestExecutionDetails,
            latestDispatch?.recordedAt ? `记录时间：${formatOfflineChatViewTime(latestDispatch.recordedAt)}` : "",
          ]),
          ...participantCards,
        ],
      },
      startupSignature: text(startupContext?.startupSignature) || null,
    };
  }

  const persona = Array.isArray(team?.personas)
    ? team.personas.find((entry) => text(entry?.agent?.agentId) === text(thread?.threadId))
    : null;
  const directParticipant = {
    displayName: text(persona?.displayName || thread?.label) || "成员",
    title: text(persona?.title || thread?.title) || null,
    role: text(persona?.role || thread?.role) || null,
    currentGoal: text(persona?.currentGoal) || null,
  };
  const planEntries = Array.isArray(startupContext?.subagentPlan) ? startupContext.subagentPlan : [];
  const directPlanEntry =
    planEntries.find(
      (candidate) =>
        text(candidate?.agentId) && text(candidate?.agentId) === text(thread?.agentId || thread?.threadId)
    ) || null;
  const filterLabel = normalizedFilter ? resolveOfflineChatSourceLabel(normalizedFilter, sourceSummary) : "";
  return {
    threadId: text(thread?.threadId) || null,
    header: {
      title: text(thread?.label) || "离线线程",
      description: normalizedFilter
        ? `你正在与 ${text(thread?.label)} 单聊，当前只看「${filterLabel}」的回复。`
        : `你正在与 ${text(thread?.label)} 单聊。消息只会发给对方。`,
      pill: normalizedFilter ? "单聊 · 已筛选" : "单聊",
      composerHint: `发送后会写回本地记忆，并只发给 ${text(thread?.label)}。`,
    },
    context: {
      summaryLines: ["当前线程只包含 1 位成员。", "成员职责见下。"],
      cards: [
        buildOfflineChatContextCard(
          directParticipant.displayName,
          [directParticipant.title, directParticipant.role, summarizeOfflineChatSubagentPlanEntry(directPlanEntry)]
            .filter(Boolean)
            .join(" · ") || "线程成员",
          [directParticipant.currentGoal || "当前职责信息读取中。"]
        ),
      ],
    },
    startupSignature: text(startupContext?.startupSignature) || null,
  };
}

function labelOfflineChatDispatchExecutionMode(value) {
  const labels = {
    automatic_fanout: "自动 fan-out",
    serial_fallback: "串行回退",
    parallel: "并行",
    serial: "串行",
  };
  return labels[text(value)] || text(value) || "";
}

function resolveOfflineChatDispatchHistoryModeLabel(execution = null, dispatch = null) {
  const executionMode = text(execution?.executionMode);
  if (executionMode) {
    return labelOfflineChatDispatchExecutionMode(executionMode);
  }
  if (dispatch?.parallelAllowed === true) {
    return "允许 fan-out";
  }
  if (dispatch && typeof dispatch === "object") {
    return "先串行收口";
  }
  return "";
}

function buildOfflineChatDispatchView(threadKind, dispatchHistory = []) {
  if (text(threadKind) !== "group") {
    return {
      hidden: true,
      summaryLines: [],
      emptyText: "",
    };
  }
  const history = Array.isArray(dispatchHistory) ? dispatchHistory : [];
  if (!history.length) {
    return {
      hidden: false,
      summaryLines: ["当前还没有可展示的调度历史。"],
      emptyText: "发起一轮群聊后，这里会显示放行、阻塞和批次执行记录。",
    };
  }
  const parallelRounds = history.filter((entry) => Number(entry?.parallelBatchCount || 0) > 0).length;
  const blockedRounds = history.filter((entry) => Number(entry?.blockedRoleCount || 0) > 0).length;
  const latest = history[0] || null;
  return {
    hidden: false,
    summaryLines: [
      `最近展示 ${history.length} 轮调度。`,
      parallelRounds > 0 ? `${parallelRounds} 轮出现并行批次。` : "最近几轮没有出现并行批次。",
      blockedRounds > 0 ? `${blockedRounds} 轮有角色被暂缓。` : "最近几轮没有角色被暂缓。",
      latest?.recordedAt ? `最新一轮发生在 ${formatOfflineChatViewTime(latest.recordedAt)}。` : "",
    ].filter(Boolean),
    emptyText: "发起一轮群聊后，这里会显示放行、阻塞和批次执行记录。",
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
    if (text(record?.kind) === OFFLINE_THREAD_PROTOCOL_EVENT_KIND) {
      const protocolSource = normalizeOfflineResponseSource(payload.responseSource, {
        localReasoningStack: payload.localReasoningStack || THREAD_PROTOCOL_LOCAL_REASONING_STACK,
      });
      if (normalizedFilter && !matchesOfflineHistorySourceFilter(protocolSource, normalizedFilter)) {
        continue;
      }
      const protocolContent =
        text(record?.content) ||
        buildThreadProtocolUpgradeMessage(extractThreadProtocolStateFromRecord(record), payload?.previousProtocol);
      if (text(protocolContent)) {
        messages.push({
          messageId: `${record.passportMemoryId}:protocol`,
          role: "assistant",
          author: "系统协议",
          agentId: null,
          content: ensureVisibleReplyContent(protocolContent, "系统协议"),
          createdAt: record.recordedAt,
          source: protocolSource,
        });
      }
      continue;
    }
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
        dispatchBatch:
          Number.isFinite(Number(response?.dispatchBatch)) ? Math.floor(Number(response.dispatchBatch)) : null,
        executionMode: text(response?.executionMode) || null,
        executionStatus: text(response?.status) || null,
        content: ensureVisibleReplyContent(response.content, response.displayName || "团队成员"),
        createdAt: record.recordedAt,
        dispatch: normalizeOfflineDispatchMetadata(response.dispatch),
        source: response.source,
      });
    }
  }
  return messages;
}

function sortOfflineRecordsByRecordedAtDesc(records = []) {
  return [...(Array.isArray(records) ? records : [])]
    .map((record, index) => ({
      record,
      index,
    }))
    .sort((left, right) => {
      const leftAt = text(left?.record?.recordedAt);
      const rightAt = text(right?.record?.recordedAt);
      return (
        rightAt.localeCompare(leftAt) ||
        String(text(right?.record?.createdAt)).localeCompare(String(text(left?.record?.createdAt))) ||
        right.index - left.index
      );
    })
    .map((entry) => entry.record);
}

function buildLatestOfflineGroupExecutionView(records = []) {
  const latest = sortOfflineRecordsByRecordedAtDesc(records)[0] || null;
  const payload = latest?.payload || {};
  return {
    dispatch: payload?.dispatch && typeof payload.dispatch === "object" ? cloneJsonValue(payload.dispatch) : null,
    execution: payload?.execution && typeof payload.execution === "object" ? cloneJsonValue(payload.execution) : null,
    threadProtocol: extractThreadProtocolStateFromRecord(latest),
    recordedAt: text(latest?.recordedAt) || null,
    recordId: text(latest?.passportMemoryId) || null,
  };
}

function buildLatestOfflineGroupDispatchView(team = null, store = null) {
  const groupAgentId = text(team?.groupHub?.agent?.agentId);
  if (!groupAgentId || !store) {
    return null;
  }
  const records = listRecentAgentMemoriesFromStore(store, groupAgentId, {
    kind: "offline_group_turn",
    limit: 8,
  });
  return buildLatestOfflineGroupExecutionView(records);
}

function buildOfflineChatGroupThreadDescriptor(team = null) {
  return {
    threadId: "group",
    threadKind: "group",
    label: "我们的群聊",
    memberCount: Number(team?.personas?.length || 0),
    participants: Array.isArray(team?.personas)
      ? team.personas.map((entry) => ({
          agentId: entry?.agent?.agentId || null,
          displayName: entry?.displayName || null,
          title: entry?.title || null,
        }))
      : [],
  };
}

function buildOfflineChatDirectThreadDescriptor(persona = null) {
  return {
    threadId: text(persona?.agent?.agentId) || null,
    threadKind: "direct",
    label: text(persona?.displayName) || "成员",
    title: text(persona?.title) || null,
    role: text(persona?.role) || null,
    agentId: text(persona?.agent?.agentId) || null,
    windowId: text(persona?.windowId) || null,
  };
}

function buildLatestOfflineThreadProtocolView(records = []) {
  const latest = sortOfflineRecordsByRecordedAtDesc(records).find((record) => extractThreadProtocolStateFromRecord(record)) || null;
  return extractThreadProtocolStateFromRecord(latest);
}

function buildOfflineGroupDispatchHistory(records = [], { limit = 8 } = {}) {
  return sortOfflineRecordsByRecordedAtDesc(records)
    .slice(0, Math.max(1, Math.floor(Number(limit || 8))))
    .map((record, index) => {
      const payload = record?.payload || {};
      const dispatch =
        payload?.dispatch && typeof payload.dispatch === "object"
          ? cloneJsonValue(payload.dispatch)
          : null;
      const execution =
        payload?.execution && typeof payload.execution === "object"
          ? cloneJsonValue(payload.execution)
          : null;
      const responses = Array.isArray(payload?.responses) ? payload.responses : [];
      const selectedRoles = Array.isArray(dispatch?.selectedRoles) ? dispatch.selectedRoles : [];
      const blockedRoles = Array.isArray(dispatch?.blockedRoles) ? dispatch.blockedRoles : [];
      const batchPlan = Array.isArray(dispatch?.batchPlan) ? dispatch.batchPlan : [];
      const parallelBatches = batchPlan.filter((entry) => text(entry?.executionMode) === "parallel");
      const executionBatches = Array.isArray(execution?.batches) ? execution.batches : [];
      const completedBatchCount = executionBatches.filter((entry) =>
        ["completed", "completed_with_errors"].includes(text(entry?.status))
      ).length;
      return {
        historyIndex: index + 1,
        recordId: text(record?.passportMemoryId) || null,
        recordedAt: text(record?.recordedAt) || null,
        userText: text(payload?.userText) || null,
        responseCount: responses.length,
        responseAuthors: responses
          .map((entry) => text(entry?.displayName || entry?.role))
          .filter(Boolean),
        summary:
          text(dispatch?.summary) ||
          text(execution?.summary) ||
          summarizeOfflineGroupExecution(execution) ||
          null,
        threadProtocol: extractThreadProtocolStateFromRecord(record),
        selectedRoleCount: selectedRoles.length,
        blockedRoleCount: blockedRoles.length,
        parallelBatchCount: parallelBatches.length,
        completedBatchCount,
        batchCount: executionBatches.length,
        dispatch,
        execution,
      };
    })
    .filter((entry) => entry.recordId || entry.userText || entry.dispatch || entry.execution);
}

function buildOfflineChatGroupRuntimeViews(
  team = null,
  {
    startupContext = null,
    groupRecords = [],
    protocolRecords = [],
    sourceSummary = null,
    sourceFilter = null,
  } = {}
) {
  const latestExecutionView = buildLatestOfflineGroupExecutionView(groupRecords);
  const latestDispatch =
    text(latestExecutionView?.recordedAt)
      ? {
          ...(latestExecutionView?.dispatch && typeof latestExecutionView.dispatch === "object"
            ? latestExecutionView.dispatch
            : {}),
          recordedAt: latestExecutionView.recordedAt,
        }
      : latestExecutionView?.dispatch || null;
  const dispatchHistory = buildOfflineGroupDispatchHistory(groupRecords);
  const threadView = buildOfflineChatThreadView({
    thread: buildOfflineChatGroupThreadDescriptor(team),
    startupContext,
    team,
    sourceSummary,
    sourceFilter,
    latestExecution: latestExecutionView.execution,
    latestDispatch,
  });
  return {
    latestExecutionView,
    latestDispatch,
    dispatchHistory,
    dispatchView: buildOfflineChatDispatchView("group", dispatchHistory),
    threadView,
    threadProtocol: buildLatestOfflineThreadProtocolView([...(Array.isArray(protocolRecords) ? protocolRecords : []), ...groupRecords]),
  };
}

function buildOfflineChatDirectRuntimeViews(
  team = null,
  persona = null,
  {
    startupContext = null,
    directRecords = [],
    sourceFilter = null,
  } = {}
) {
  const normalizedSourceFilter = normalizeOfflineHistorySourceFilter(sourceFilter);
  const threadId = text(persona?.agent?.agentId);
  const filteredRecords = (Array.isArray(directRecords) ? directRecords : []).filter(
    (entry) => text(entry?.payload?.threadId) === threadId
  );
  const allMessages = buildDirectHistory(filteredRecords, persona?.displayName, threadId);
  const messages = normalizedSourceFilter
    ? buildDirectHistory(filteredRecords, persona?.displayName, threadId, {
        sourceProvider: normalizedSourceFilter,
      })
    : allMessages;
  const sourceSummary = buildOfflineHistorySourceSummary(allMessages, messages, normalizedSourceFilter);
  const dispatchHistory = [];
  return {
    allMessages,
    messages,
    sourceSummary,
    dispatchHistory,
    dispatchView: buildOfflineChatDispatchView("direct", dispatchHistory),
    threadView: buildOfflineChatThreadView({
      thread: buildOfflineChatDirectThreadDescriptor(persona),
      startupContext,
      team,
      sourceSummary,
      sourceFilter: normalizedSourceFilter,
    }),
  };
}

export async function getOfflineChatHistory(
  threadId,
  { limit = 80, sourceProvider = null, passive = true, store = undefined } = {}
) {
  const effectiveStore =
    store === undefined
      ? passive
        ? await loadOfflineChatPassiveStore()
        : await loadStore()
      : store;
  const team =
    store === undefined
      ? await bootstrapOfflineChatEnvironment({ passive })
      : decorateOfflineBootstrapState(projectOfflineChatEnvironmentFromStore(effectiveStore), {
          source: effectiveStore ? "provided_store_snapshot" : "read_only_projection",
          checkedAtMs: Date.now(),
        });
  const normalizedThreadId = text(threadId) || "group";
  const numericLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : 80;
  const normalizedSourceFilter = normalizeOfflineHistorySourceFilter(sourceProvider);
  const startupContext = await resolveOfflineChatThreadStartupContext(team, {
    phaseKey: "phase_1",
    trigger: "history",
    persistProtocolEvent: false,
    store: effectiveStore,
  });

  if (normalizedThreadId === "group") {
    const groupRecords = listRecentAgentMemoriesFromStore(effectiveStore, team.groupHub.agent.agentId, {
      kind: "offline_group_turn",
      limit: numericLimit,
    });
    const protocolRecords = listRecentAgentMemoriesFromStore(effectiveStore, team.groupHub.agent.agentId, {
      kind: OFFLINE_THREAD_PROTOCOL_EVENT_KIND,
      limit: Math.max(8, Math.min(40, numericLimit)),
    });
    const combinedRecords = [...groupRecords, ...protocolRecords].sort((left, right) =>
      String(left?.recordedAt || "").localeCompare(String(right?.recordedAt || ""))
    );
    const allMessages = buildGroupHistory(combinedRecords);
    const messages = normalizedSourceFilter
      ? buildGroupHistory(combinedRecords, { sourceProvider: normalizedSourceFilter })
      : allMessages;
    const groupRuntimeViews = buildOfflineChatGroupRuntimeViews(team, {
      startupContext,
      sourceSummary: buildOfflineHistorySourceSummary(allMessages, messages, normalizedSourceFilter),
      sourceFilter: normalizedSourceFilter,
      groupRecords,
      protocolRecords,
    });
    return {
      threadId: "group",
      threadKind: "group",
      sourceFilter: normalizedSourceFilter,
      messages,
      threadProtocol: groupRuntimeViews.threadProtocol,
      counts: {
        totalMessages: allMessages.length,
        filteredMessages: messages.length,
        assistantMessages: countAssistantMessages(allMessages),
        filteredAssistantMessages: countAssistantMessages(messages),
      },
      sourceSummary: buildOfflineHistorySourceSummary(allMessages, messages, normalizedSourceFilter),
      dispatchHistory: groupRuntimeViews.dispatchHistory,
      dispatchView: groupRuntimeViews.dispatchView,
      threadView: groupRuntimeViews.threadView,
      threadStartup: cloneJsonValue(startupContext) ?? null,
      startupSignature: text(startupContext?.startupSignature) || null,
      ...groupRuntimeViews.latestExecutionView,
    };
  }

  const persona = team.personas.find((entry) => entry.agent.agentId === normalizedThreadId);
  if (!persona) {
    throw new Error(`Unknown offline chat thread: ${normalizedThreadId}`);
  }
  const directRecords = passive
    ? {
        memories: listRecentAgentMemoriesFromStore(effectiveStore, persona.agent.agentId, {
          kind: "offline_sync_turn",
          limit: numericLimit,
        }),
      }
    : await listPassportMemories(persona.agent.agentId, {
        kind: "offline_sync_turn",
        limit: numericLimit,
        store: effectiveStore,
      });
  const directRuntimeViews = buildOfflineChatDirectRuntimeViews(team, persona, {
    startupContext,
    directRecords: directRecords.memories || [],
    sourceFilter: normalizedSourceFilter,
  });
  return {
    threadId: persona.agent.agentId,
    threadKind: "direct",
    persona,
    sourceFilter: normalizedSourceFilter,
    messages: directRuntimeViews.messages,
    counts: {
      totalMessages: directRuntimeViews.allMessages.length,
      filteredMessages: directRuntimeViews.messages.length,
      assistantMessages: countAssistantMessages(directRuntimeViews.allMessages),
      filteredAssistantMessages: countAssistantMessages(directRuntimeViews.messages),
    },
    sourceSummary: directRuntimeViews.sourceSummary,
    dispatchHistory: directRuntimeViews.dispatchHistory,
    dispatchView: directRuntimeViews.dispatchView,
    threadView: directRuntimeViews.threadView,
    threadStartup: cloneJsonValue(startupContext) ?? null,
    startupSignature: text(startupContext?.startupSignature) || null,
  };
}

function extractSyncedRecordIds(receipts = [], { agentId = null } = {}) {
  const ids = new Set();
  const normalizedAgentId = text(agentId);
  for (const receipt of receipts) {
    const syncedRecordIds = Array.isArray(receipt?.payload?.syncedRecordIds)
      ? receipt.payload.syncedRecordIds
      : [];
    const receiptAgentId = text(receipt?.agentId || receipt?.payload?.agentId);
    if (!normalizedAgentId || !receiptAgentId || receiptAgentId === normalizedAgentId) {
      for (const id of syncedRecordIds) {
        if (text(id)) {
          ids.add(text(id));
        }
      }
    }

    const deliveredByAgent = Array.isArray(receipt?.deliveredByAgent)
      ? receipt.deliveredByAgent
      : Array.isArray(receipt?.payload?.deliveredByAgent)
        ? receipt.payload.deliveredByAgent
        : [];
    for (const delivery of deliveredByAgent) {
      const deliveryAgentId = text(delivery?.agentId);
      if (normalizedAgentId && deliveryAgentId !== normalizedAgentId) {
        continue;
      }
      const deliveredIds = Array.isArray(delivery?.syncedRecordIds) ? delivery.syncedRecordIds : [];
      for (const id of deliveredIds) {
        if (text(id)) {
          ids.add(text(id));
        }
      }
    }
  }
  return ids;
}

function isActiveOfflinePassportMemory(entry) {
  if (!entry) {
    return false;
  }
  if (text(entry?.memoryDynamics?.abstractedAt) || text(entry?.memoryDynamics?.abstractedMemoryId)) {
    return false;
  }
  return !["superseded", "forgotten", "decayed", "abstracted", "reverted"].includes(text(entry?.status));
}

function listRecentAgentMemoriesFromStore(store, agentId, { kind = null, limit = 200 } = {}) {
  const normalizedKind = text(kind) || null;
  const cappedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 200;
  const records = (Array.isArray(store?.passportMemories) ? store.passportMemories : [])
    .filter((entry) => entry?.agentId === agentId)
    .filter((entry) => isActiveOfflinePassportMemory(entry))
    .filter((entry) => (normalizedKind ? text(entry?.kind) === normalizedKind : true))
    .sort((left, right) => String(left?.recordedAt || "").localeCompare(String(right?.recordedAt || "")));
  return records.slice(-cappedLimit);
}

async function collectAgentPendingSync(agentSummary, kinds = ["offline_sync_turn"], { store = null, deliveryIndex = null } = {}) {
  if (!text(agentSummary?.agentId)) {
    return [];
  }
  if (store === null) {
    return [];
  }
  const receipts = store
    ? { memories: listRecentAgentMemoriesFromStore(store, agentSummary.agentId, { kind: "offline_sync_receipt", limit: 200 }) }
    : await listPassportMemories(agentSummary.agentId, {
        kind: "offline_sync_receipt",
        limit: 200,
      });
  const syncedIds = extractSyncedRecordIds(receipts.memories || [], { agentId: agentSummary.agentId });
  const deliveryReceiptIds = deliveryIndex?.byAgentId instanceof Map
    ? deliveryIndex.byAgentId.get(agentSummary.agentId)
    : null;
  if (deliveryReceiptIds instanceof Set) {
    for (const recordId of deliveryReceiptIds) {
      syncedIds.add(recordId);
    }
  }
  const records = [];
  for (const kind of kinds) {
    const listed = store
      ? { memories: listRecentAgentMemoriesFromStore(store, agentSummary.agentId, { kind, limit: 300 }) }
      : await listPassportMemories(agentSummary.agentId, {
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

async function readJsonFileIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function buildOfflineSyncDeliveryReceipt(bundle, groupedIds, { endpoint, responseStatus, responseText, deliveredAt } = {}) {
  return {
    receiptFormat: OFFLINE_SYNC_DELIVERY_RECEIPT_FORMAT,
    bundleId: text(bundle?.bundleId) || null,
    deliveredAt: text(deliveredAt) || nowIso(),
    endpoint: text(endpoint) || null,
    responseStatus: Number.isFinite(Number(responseStatus)) ? Number(responseStatus) : null,
    responseText: text(responseText) || null,
    deliveredCount: Math.max(0, Math.floor(Number(bundle?.entries?.length || 0))),
    deliveredByAgent: Array.from(groupedIds.entries())
      .map(([agentId, syncedRecordIds]) => ({
        agentId: text(agentId) || null,
        syncedRecordIds: Array.from(new Set((Array.isArray(syncedRecordIds) ? syncedRecordIds : []).map((id) => text(id)).filter(Boolean))),
      }))
      .filter((entry) => entry.agentId && entry.syncedRecordIds.length > 0),
  };
}

async function listOfflineSyncDeliveryReceipts({ receiptDir = SYNC_DELIVERY_RECEIPT_DIR } = {}) {
  try {
    const entries = await readdir(receiptDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "latest-receipt.json")
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
    const receipts = [];
    const warnings = [];
    for (const fileName of files) {
      const filePath = path.join(receiptDir, fileName);
      try {
        const receipt = await readJsonFileIfPresent(filePath);
        if (receipt && typeof receipt === "object") {
          receipts.push(receipt);
        }
      } catch (error) {
        warnings.push({
          type: "delivery_receipt_read_failed",
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      receipts,
      warnings,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        receipts: [],
        warnings: [],
      };
    }
    throw error;
  }
}

async function loadOfflineSyncDeliveryIndex({ receiptDir = SYNC_DELIVERY_RECEIPT_DIR } = {}) {
  const listed = await listOfflineSyncDeliveryReceipts({ receiptDir });
  const byAgentId = new Map();
  for (const receipt of listed.receipts) {
    const deliveredByAgent = Array.isArray(receipt?.deliveredByAgent)
      ? receipt.deliveredByAgent
      : Array.isArray(receipt?.payload?.deliveredByAgent)
        ? receipt.payload.deliveredByAgent
        : [];
    for (const delivery of deliveredByAgent) {
      const agentId = text(delivery?.agentId);
      if (!agentId) {
        continue;
      }
      const bucket = byAgentId.get(agentId) || new Set();
      for (const recordId of Array.isArray(delivery?.syncedRecordIds) ? delivery.syncedRecordIds : []) {
        const normalizedId = text(recordId);
        if (normalizedId) {
          bucket.add(normalizedId);
        }
      }
      byAgentId.set(agentId, bucket);
    }
  }
  return {
    byAgentId,
    receiptCount: listed.receipts.length,
    warnings: listed.warnings,
  };
}

async function persistOfflineSyncDeliveryReceipt(bundle, groupedIds, { endpoint, responseStatus, responseText } = {}) {
  const receipt = buildOfflineSyncDeliveryReceipt(bundle, groupedIds, {
    endpoint,
    responseStatus,
    responseText,
    deliveredAt: nowIso(),
  });
  await mkdir(SYNC_DELIVERY_RECEIPT_DIR, { recursive: true });
  const stampedPath = path.join(
    SYNC_DELIVERY_RECEIPT_DIR,
    `receipt-${String(receipt.deliveredAt || nowIso()).replace(/[:.]/g, "-")}-${text(bundle?.bundleId) || "bundle"}.json`
  );
  const latestPath = path.join(SYNC_DELIVERY_RECEIPT_DIR, "latest-receipt.json");
  const serialized = JSON.stringify(receipt, null, 2);
  await writeFile(stampedPath, serialized, "utf8");
  const warnings = [];
  try {
    await writeFile(latestPath, serialized, "utf8");
  } catch (error) {
    warnings.push({
      type: "delivery_receipt_latest_write_failed",
      filePath: latestPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    receipt,
    stampedPath,
    latestPath,
    warnings,
  };
}

async function countOfflineChatPendingSyncEntries(team, { store = undefined } = {}) {
  const effectiveStore = store === undefined ? await loadStore() : store;
  const deliveryIndex = await loadOfflineSyncDeliveryIndex();
  if (!effectiveStore) {
    return {
      pendingCount: 0,
      countsByAgent: [
        ...(Array.isArray(team?.personas) ? team.personas : []).map((persona) => ({
          agentId: persona?.agent?.agentId || null,
          threadId: persona?.agent?.agentId || null,
          threadKind: "direct",
          pendingCount: 0,
        })),
        {
          agentId: team?.groupHub?.agent?.agentId || null,
          threadId: "group",
          threadKind: "group",
          pendingCount: 0,
        },
      ],
      localReceiptWarnings: deliveryIndex.warnings,
    };
  }
  const personaCounts = await mapWithConcurrency(
    team.personas,
    OFFLINE_CHAT_MAX_CONCURRENCY,
    async (persona) => {
      const records = await collectAgentPendingSync(persona.agent, ["offline_sync_turn"], {
        store: effectiveStore,
        deliveryIndex,
      });
      return {
        agentId: persona.agent.agentId,
        threadId: persona.agent.agentId,
        threadKind: "direct",
        pendingCount: records.length,
      };
    }
  );
  const groupCountPromise = collectAgentPendingSync(
    team.groupHub.agent,
    ["offline_group_turn", OFFLINE_THREAD_PROTOCOL_EVENT_KIND],
    { store: effectiveStore, deliveryIndex }
  );
  const groupRecords = await groupCountPromise;
  const countsByAgent = [
    ...personaCounts,
    {
      agentId: team.groupHub.agent.agentId,
      threadId: "group",
      threadKind: "group",
      pendingCount: groupRecords.length,
    },
  ];
  const pendingCount = countsByAgent.reduce((total, entry) => total + Number(entry?.pendingCount || 0), 0);

  return {
    pendingCount,
    countsByAgent,
    localReceiptWarnings: deliveryIndex.warnings,
  };
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
  const store = await loadStore();
  const deliveryIndex = await loadOfflineSyncDeliveryIndex();
  const deviceRuntime = await getDeviceRuntimeState();
  const activeLocalReasoner = await resolveActiveOfflineLocalReasoner();
  const sharedMemoryContext = await getSharedMemoryRuntimeContext(team);
  const personaEntries = await mapWithConcurrency(
    team.personas,
    OFFLINE_CHAT_MAX_CONCURRENCY,
    async (persona) => {
      const records = await collectAgentPendingSync(persona.agent, ["offline_sync_turn"], { store, deliveryIndex });
      return records.map((record) => toSyncBundleEntry(persona.agent, record));
    }
  );
  const groupRecordsPromise = collectAgentPendingSync(
    team.groupHub.agent,
    ["offline_group_turn", OFFLINE_THREAD_PROTOCOL_EVENT_KIND],
    { store, deliveryIndex }
  );
  const groupRecords = await groupRecordsPromise;
  const pending = [
    ...personaEntries.flat(),
    ...groupRecords.map((record) => toSyncBundleEntry(team.groupHub.agent, record)),
  ];

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

export async function getOfflineChatSyncStatus({ team = null, passive = true, store = undefined } = {}) {
  const checkedAt = nowIso();
  const endpoint = await resolveOnlineSyncEndpoint({ allowProbe: !passive });
  const effectiveStore = store === undefined
    ? passive
      ? await loadOfflineChatPassiveStore()
      : undefined
    : store;
  const effectiveTeam = team || await bootstrapOfflineChatEnvironment({ passive });
  const pending = await countOfflineChatPendingSyncEntries(effectiveTeam, { store: effectiveStore });
  const syncView = buildOfflineChatSyncView({
    status:
      pending.pendingCount === 0
        ? "idle"
        : endpoint
          ? "ready_to_sync"
          : "awaiting_remote_endpoint",
    pendingCount: pending.pendingCount,
    endpoint: endpoint || null,
    endpointConfigured: Boolean(endpoint),
    localReceiptStatus: null,
    localReceiptWarnings: pending.localReceiptWarnings || [],
  });
  return {
    checkedAt,
    ...syncView,
    lastGeneratedAt: checkedAt,
    localReasoner: effectiveTeam.localReasoner || await resolveActiveOfflineLocalReasoner(),
    countsByAgent: pending.countsByAgent,
  };
}

export async function getOfflineChatBootstrapPayload({ passive = true } = {}) {
  const checkedAt = nowIso();
  const store = passive ? await loadOfflineChatPassiveStore() : await loadStore();
  const team = await bootstrapOfflineChatEnvironment({ passive });
  const phase1StartupContext = await resolveOfflineChatThreadStartupContext(team, {
    phaseKey: "phase_1",
    trigger: "bootstrap",
    persistProtocolEvent: false,
    store,
  });
  const threads = buildThreadSummary(team, {
    includeUnboundDirectThreads: !passive || Boolean(store) || team?.readOnlyProjection !== true,
  });
  const groupRecords = listRecentAgentMemoriesFromStore(store, team.groupHub.agent.agentId, {
    kind: "offline_group_turn",
    limit: 8,
  });
  const groupRuntimeViews = buildOfflineChatGroupRuntimeViews(team, {
    startupContext: phase1StartupContext,
    groupRecords,
    protocolRecords: [],
  });
  const sync = await getOfflineChatSyncStatus({ team, passive, store });
  const threadViews = Object.fromEntries(
    threads
      .map((thread) => [
        text(thread?.threadId),
        buildOfflineChatThreadView({
          thread,
          startupContext: phase1StartupContext,
          team,
          sourceSummary: null,
          sourceFilter: null,
          latestExecution:
            text(thread?.threadKind) === "group" ? groupRuntimeViews.latestExecutionView.execution : null,
          latestDispatch: text(thread?.threadKind) === "group" ? groupRuntimeViews.latestDispatch : null,
        }),
      ])
      .filter(([threadId]) => Boolean(threadId))
  );
  const threadHistoryMeta = {
    group: {
      threadId: "group",
      dispatch: cloneJsonValue(groupRuntimeViews.latestDispatch) ?? null,
      execution: cloneJsonValue(groupRuntimeViews.latestExecutionView.execution) ?? null,
      threadProtocol:
        cloneJsonValue(groupRuntimeViews.latestExecutionView.threadProtocol || phase1StartupContext?.threadProtocol) ?? null,
      dispatchHistory: cloneJsonValue(groupRuntimeViews.dispatchHistory) ?? [],
      dispatchView: cloneJsonValue(groupRuntimeViews.dispatchView) ?? null,
      startupSignature: text(phase1StartupContext?.startupSignature) || null,
    },
  };
  return {
    checkedAt,
    initializedAt: team.initializedAt,
    bootstrappedAt: team.bootstrappedAt ?? team.initializedAt,
    bootstrapState: team.bootstrapState || null,
    deviceRuntime: team.deviceRuntime,
    localReasoner: team.localReasoner,
    personas: team.personas,
    groupHub: team.groupHub,
    threads,
    threadViews,
    threadHistoryMeta,
    threadStartup: {
      phase_1: phase1StartupContext,
    },
    sync,
  };
}

export async function getOfflineChatThreadStartupContext({ phaseKey = "phase_1", passive = true } = {}) {
  const store = passive ? await loadOfflineChatPassiveStore() : await loadStore();
  const team = await bootstrapOfflineChatEnvironment({ passive });
  return resolveOfflineChatThreadStartupContext(team, {
    phaseKey,
    trigger: "thread_startup_context",
    persistProtocolEvent: false,
    store,
  });
}

export async function previewOfflineChatGroupDispatch(content, { passive = true } = {}) {
  const store = passive ? await loadOfflineChatPassiveStore() : await loadStore();
  const team = await bootstrapOfflineChatEnvironment({ passive });
  const startupContext = await resolveOfflineChatThreadStartupContext(team, {
    phaseKey: "phase_1",
    trigger: "dispatch_preview",
    persistProtocolEvent: false,
    store,
  });
  const latestDispatchView = buildLatestOfflineGroupDispatchView(team, store);
  return buildOfflineGroupDispatch(team, content, { startupContext, latestDispatchView });
}

export async function flushOfflineChatSync() {
  const { bundle, pendingCount, persisted } = await buildOfflineChatPendingSyncBundle();
  const endpoint = await resolveOnlineSyncEndpoint();
  const authToken = text(process.env.OPENNEED_ONLINE_SYNC_TOKEN);

  if (pendingCount === 0) {
    const syncView = buildOfflineChatSyncView({
      status: "idle",
      pendingCount: 0,
      endpoint,
      endpointConfigured: Boolean(endpoint),
      localReceiptStatus: null,
      localReceiptWarnings: [],
    });
    return {
      ...syncView,
      bundle,
      persisted,
    };
  }

  if (!endpoint) {
    const syncView = buildOfflineChatSyncView({
      status: "awaiting_remote_endpoint",
      pendingCount,
      endpoint: null,
      endpointConfigured: false,
      localReceiptStatus: null,
      localReceiptWarnings: [],
    });
    return {
      ...syncView,
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
    const syncView = buildOfflineChatSyncView({
      status: "delivery_failed",
      pendingCount,
      endpoint,
      endpointConfigured: true,
      localReceiptStatus: null,
      localReceiptWarnings: [],
    });
    return {
      ...syncView,
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

  let durableReceipt = null;
  const localReceiptWarnings = [];
  try {
    durableReceipt = await persistOfflineSyncDeliveryReceipt(bundle, groupedIds, {
      endpoint,
      responseStatus: response.status,
      responseText,
    });
    localReceiptWarnings.push(...(Array.isArray(durableReceipt?.warnings) ? durableReceipt.warnings : []));
  } catch (error) {
    localReceiptWarnings.push({
      type: "durable_delivery_receipt_failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const byAgentId = new Map([
    ...team.personas.map((entry) => [entry.agent.agentId, entry]),
    [team.groupHub.agent.agentId, team.groupHub],
  ]);

  const ledgerReceiptResults = await Promise.all(
    Array.from(groupedIds.entries()).map(async ([agentId, syncedRecordIds]) => {
      try {
        const info = byAgentId.get(agentId);
        const windowId = info?.windowId || threadWindowId("group");
        const memory = await writePassportMemory(agentId, {
          layer: "ledger",
          kind: "offline_sync_receipt",
          summary: `离线记录已同步 ${syncedRecordIds.length} 条`,
          content: `bundle ${bundle.bundleId} 已发送到 ${endpoint}`,
          payload: {
            bundleId: bundle.bundleId,
            agentId,
            syncedRecordIds,
            endpoint,
            syncedAt: nowIso(),
            responseStatus: response.status,
            deliveredByAgent: Array.from(groupedIds.entries()).map(([deliveredAgentId, deliveredIds]) => ({
              agentId: deliveredAgentId,
              syncedRecordIds: deliveredIds,
            })),
          },
          tags: ["offline-chat", "sync-receipt"],
          sourceWindowId: windowId,
          recordedByAgentId: agentId,
          recordedByWindowId: windowId,
        });
        return {
          status: "fulfilled",
          agentId,
          memoryId: memory?.passportMemoryId || null,
        };
      } catch (error) {
        return {
          status: "rejected",
          agentId,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );
  const successfulLedgerAgentIds = new Set();
  for (const result of ledgerReceiptResults) {
    if (result.status === "fulfilled") {
      if (text(result.agentId)) {
        successfulLedgerAgentIds.add(text(result.agentId));
      }
      continue;
    }
    localReceiptWarnings.push({
      type: "ledger_receipt_write_failed",
      agentId: text(result.agentId) || null,
      error: result.error || "unknown_ledger_receipt_write_failure",
    });
  }

  const duplicateSyncRisk =
    !durableReceipt &&
    Array.from(groupedIds.keys()).some((agentId) => !successfulLedgerAgentIds.has(text(agentId)));
  let postReceiptPending = {
    pendingCount: duplicateSyncRisk ? pendingCount : 0,
    localReceiptWarnings: [],
  };
  try {
    postReceiptPending = await countOfflineChatPendingSyncEntries(team, { store: await loadStore() });
  } catch (error) {
    localReceiptWarnings.push({
      type: "post_delivery_pending_recount_failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (Array.isArray(postReceiptPending?.localReceiptWarnings) && postReceiptPending.localReceiptWarnings.length > 0) {
    localReceiptWarnings.push(...postReceiptPending.localReceiptWarnings);
  }
  const localReceiptStatus =
    localReceiptWarnings.length === 0
      ? "recorded"
      : duplicateSyncRisk
        ? "at_risk"
        : "recorded_with_warnings";
  const syncView = buildOfflineChatSyncView({
    status: "delivered",
    pendingCount: postReceiptPending.pendingCount,
    endpoint,
    endpointConfigured: true,
    localReceiptStatus,
    localReceiptWarnings,
  });

  return {
    ...syncView,
    deliveredCount: bundle.entries.length,
    bundle,
    persisted,
    durableReceipt: durableReceipt
      ? {
          receiptPath: durableReceipt.stampedPath,
          latestPath: durableReceipt.latestPath,
        }
      : null,
    duplicateSyncRisk,
    responseStatus: response.status,
    responseText,
  };
}

export const PROTOCOL_NAME = "OpenNeed 记忆稳态引擎";
export const PROTOCOL_SLUG = "agent-passport";
export const PROTOCOL_VERSION = "2026";
export const ACTIVE_DID_METHOD = "openneed";
export const FUTURE_DID_METHOD = "agentpassport";
export const SUPPORTED_DID_METHODS = [ACTIVE_DID_METHOD, FUTURE_DID_METHOD];
export const RESOLVABLE_DID_METHODS = [...SUPPORTED_DID_METHODS];
export const SIGNABLE_DID_METHODS = [...SUPPORTED_DID_METHODS];
export const LEGACY_TYPE_PREFIX = "OpenNeed";
export const CURRENT_TYPE_PREFIX = "AgentPassport";
export const DEFAULT_RUNTIME_RETRIEVAL_STRATEGY = "local_first_non_vector";
export const DEFAULT_RUNTIME_RETRIEVAL_SCORER = "lexical_v1";

export const DID_VERIFICATION_METHOD_TYPE = `${CURRENT_TYPE_PREFIX}WalletKey${PROTOCOL_VERSION}`;
export const LEGACY_DID_VERIFICATION_METHOD_TYPE = `${LEGACY_TYPE_PREFIX}WalletKey${PROTOCOL_VERSION}`;
export const DID_SIGNING_VERIFICATION_METHOD_TYPE = `${CURRENT_TYPE_PREFIX}Ed25519VerificationKey${PROTOCOL_VERSION}`;
export const DID_SERVICE_HUB_TYPE = `${CURRENT_TYPE_PREFIX}Hub`;
export const LEGACY_DID_SERVICE_HUB_TYPE = `${LEGACY_TYPE_PREFIX}AgentHub`;
export const VC_SIGNATURE_PROOF_TYPE = `${CURRENT_TYPE_PREFIX}Ed25519Signature${PROTOCOL_VERSION}`;
export const LEDGER_HASH_PROOF_TYPE = `${CURRENT_TYPE_PREFIX}LedgerHash${PROTOCOL_VERSION}`;
export const LEGACY_LEDGER_HASH_PROOF_TYPE = `${LEGACY_TYPE_PREFIX}LedgerHash${PROTOCOL_VERSION}`;
export const STATUS_LIST_PROOF_TYPE = `${CURRENT_TYPE_PREFIX}StatusListProof${PROTOCOL_VERSION}`;
export const LEGACY_STATUS_LIST_PROOF_TYPE = `${LEGACY_TYPE_PREFIX}StatusListProof${PROTOCOL_VERSION}`;

export const STATUS_ENTRY_TYPE = `${CURRENT_TYPE_PREFIX}StatusListEntry${PROTOCOL_VERSION}`;
export const LEGACY_STATUS_ENTRY_TYPE = `${LEGACY_TYPE_PREFIX}StatusListEntry${PROTOCOL_VERSION}`;
export const STATUS_LEDGER_TYPE = `${CURRENT_TYPE_PREFIX}LedgerStatus`;
export const LEGACY_STATUS_LEDGER_TYPE = `${LEGACY_TYPE_PREFIX}LedgerStatus`;
export const STATUS_AUTHORIZATION_TYPE = `${CURRENT_TYPE_PREFIX}AuthorizationStatus`;
export const LEGACY_STATUS_AUTHORIZATION_TYPE = `${LEGACY_TYPE_PREFIX}AuthorizationStatus`;

export const STATUS_LIST_CREDENTIAL_TYPE = `${CURRENT_TYPE_PREFIX}StatusListCredential`;
export const LEGACY_STATUS_LIST_CREDENTIAL_TYPE = `${LEGACY_TYPE_PREFIX}StatusListCredential`;
export const AGENT_IDENTITY_CREDENTIAL_TYPE = `${CURRENT_TYPE_PREFIX}AgentIdentityCredential`;
export const LEGACY_AGENT_IDENTITY_CREDENTIAL_TYPE = `${LEGACY_TYPE_PREFIX}AgentIdentityCredential`;
export const AUTHORIZATION_RECEIPT_CREDENTIAL_TYPE = `${CURRENT_TYPE_PREFIX}AuthorizationReceiptCredential`;
export const LEGACY_AUTHORIZATION_RECEIPT_CREDENTIAL_TYPE = `${LEGACY_TYPE_PREFIX}AuthorizationReceiptCredential`;
export const COMPARISON_EVIDENCE_CREDENTIAL_TYPE = `${CURRENT_TYPE_PREFIX}AgentComparisonEvidenceCredential`;
export const LEGACY_COMPARISON_EVIDENCE_CREDENTIAL_TYPE = `${LEGACY_TYPE_PREFIX}AgentComparisonEvidenceCredential`;
export const MIGRATION_RECEIPT_CREDENTIAL_TYPE = `${CURRENT_TYPE_PREFIX}MigrationReceiptCredential`;
export const LEGACY_MIGRATION_RECEIPT_CREDENTIAL_TYPE = `${LEGACY_TYPE_PREFIX}MigrationReceiptCredential`;

export const STATUS_LIST_SUBJECT_TYPE = `${CURRENT_TYPE_PREFIX}StatusList`;
export const LEGACY_STATUS_LIST_SUBJECT_TYPE = `${LEGACY_TYPE_PREFIX}StatusList`;
export const STATUS_LIST_EVIDENCE_TYPE = `${CURRENT_TYPE_PREFIX}CredentialStatusList`;
export const LEGACY_STATUS_LIST_EVIDENCE_TYPE = `${LEGACY_TYPE_PREFIX}CredentialStatusList`;
export const AGENT_SNAPSHOT_EVIDENCE_TYPE = `${CURRENT_TYPE_PREFIX}AgentSnapshot`;
export const LEGACY_AGENT_SNAPSHOT_EVIDENCE_TYPE = `${LEGACY_TYPE_PREFIX}AgentSnapshot`;
export const AUTHORIZATION_TIMELINE_EVIDENCE_TYPE = `${CURRENT_TYPE_PREFIX}AuthorizationTimeline`;
export const LEGACY_AUTHORIZATION_TIMELINE_EVIDENCE_TYPE = `${LEGACY_TYPE_PREFIX}AuthorizationTimeline`;
export const COMPARISON_EVIDENCE_TYPE = `${CURRENT_TYPE_PREFIX}AgentComparisonEvidence`;
export const LEGACY_COMPARISON_EVIDENCE_TYPE = `${LEGACY_TYPE_PREFIX}AgentComparisonEvidence`;
export const MIGRATION_REPAIR_EVIDENCE_TYPE = `${CURRENT_TYPE_PREFIX}MigrationRepair`;
export const LEGACY_MIGRATION_REPAIR_EVIDENCE_TYPE = `${LEGACY_TYPE_PREFIX}MigrationRepair`;

export function normalizeDidMethod(method = null, fallback = ACTIVE_DID_METHOD) {
  const normalized = String(method ?? "").trim().toLowerCase();
  return SUPPORTED_DID_METHODS.includes(normalized) ? normalized : fallback;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function buildTypeDescriptor(id, canonical, legacy = [], purpose = null) {
  return {
    id,
    canonical,
    legacy,
    purpose,
    aliases: [canonical, ...legacy],
  };
}

function buildCapabilityBoundaryDescriptor() {
  return {
    identity: {
      status: "bounded_local",
      summary: "当前身份在本地参考层命名空间内稳定成立，不应表述为全球唯一身份。",
      guaranteed: [
        "single-device stable identity binding",
        "local DID derivation and local signing",
        "local agent/window resolution",
      ],
      notYet: [
        "global unique identity",
        "independent third-party trust network",
      ],
    },
    verification: {
      status: "locally_verifiable",
      summary: "当前证据与状态记录主要支持本地校验、自检回放和完整性检查，不应表述为全网独立背书。",
      guaranteed: [
        "local hash-chain integrity checks",
        "local evidence checks and run-record validation",
        "locally verifiable status snapshots",
      ],
      notYet: [
        "public consensus-backed verification",
        "independent external attestation network",
      ],
    },
    cognition: {
      status: "heuristic_state_layer",
      summary: "当前类脑能力是启发式运行态摘要层与记忆协调层，不是训练型持续认知网络。",
      guaranteed: [
        "layered memory orchestration",
        "heuristic runtime-state tracking",
        "state transitions and preference retention",
      ],
      notYet: [
        "self-trained neural cognition",
        "autonomous general reasoning loop",
      ],
    },
    recovery: {
      status: "bounded_auto_recovery",
      summary: "当前恢复能力已支持恢复包、恢复建议，以及在本地门禁通过时的有限次自动恢复/续跑闭环。",
      guaranteed: [
        "rehydrate pack generation",
        "resume boundary guidance",
        "bounded automatic resume after rehydrate failure",
      ],
      notYet: [
        "guaranteed autonomous resume after every failure mode",
        "cross-device disaster-recovery orchestration",
      ],
    },
    ledger: {
      status: "integrity_protected_local_store",
      summary: "当前账本具备本地加密与完整性保护，不应表述为不可篡改链上账本。",
      guaranteed: [
        "encrypted local envelope at rest",
        "hash-linked local event history",
        "local integrity verification",
      ],
      notYet: [
        "append-only consensus ledger",
        "tamper-proof public blockchain guarantees",
      ],
    },
  };
}

function buildProductPositioningDescriptor() {
  return {
    category: "agent runtime",
    tagline: "单机单 Agent、本地优先、可恢复的 Agent Runtime",
    oneLiner:
      "OpenNeed 记忆稳态引擎第一阶段不是做全网统一身份协议，而是让一个 Agent 能稳定住进一台电脑里，离线运行、忘了会查本地纪要、做事先协商再执行。",
    positioning:
      "把 Agent 从一次性聊天窗口，收敛成一个 resident、可恢复、可审计、可限权的本地运行时实体。",
    primaryUser: "需要长期运行单个 canonical agent 的个人或团队",
    primaryUseCases: [
      "单机单 Agent 持续运行",
      "本地记忆与对话纪要检索",
      "身份漂移或上下文坍缩后的 rehydrate 恢复",
      "高风险命令的协商与确认",
      "关键身份与授权事件的本地留痕与校验",
    ],
    valueProposition: [
      "不依赖长聊天硬撑上下文，而是每轮按本地参考层重建最小上下文",
      "把身份、记忆、权限、证据放在线程外，降低窗口切换和模型切换带来的漂移",
      "让 Agent 忘了时先查本地纪要、decision、evidence、compact boundary，再恢复工作",
      "把执行授权做成风险分级：低风险保持低延迟，高风险才进入确认或多签冷路径",
      "把本地检索明确收敛为 local-first、non-vector-first，先靠结构化记忆和轻量索引恢复，而不是先烧云端向量成本",
    ],
    commercialWedge: {
      initialProduct: "single-device resident agent runtime",
      targetCustomers: [
        "开源 Agent 高级用户",
        "需要私有部署 Agent 的团队",
        "需要审计与安全边界的 AI 工作流团队",
      ],
      monetizationHypotheses: [
        "私有部署与企业支持",
        "多设备同步与备份恢复",
        "安全治理、审计和合规能力",
        "高级 connector / constrained-execution / key management 模块",
      ],
    },
    operatingModel: {
      hotPath: "本地参考层、本地检索、本地 context builder、本地回复校验，优先保证低延迟",
      warmPath: "联网增强模型、知识包和 connector，但不替代本地身份参考层",
      coldPath: "只对关键身份、授权、审计动作生成 DID / VC / multisig 本地记录",
      runtimeExecution: "日常动作先走风险分级策略，只有 critical 动作才升级到 multisig / dual control",
      retrieval: `默认采用 ${DEFAULT_RUNTIME_RETRIEVAL_STRATEGY}，先用结构化字段、conversation minutes、compact boundaries 和 lexical scorer 恢复上下文`,
    },
    nonGoals: [
      "不假设所有 SaaS 平台都会开放底层上下文和记忆 API",
      "不试图让每条记忆、每轮回复都走链上或分布式验证",
      "不承诺消灭 LLM 幻觉，只承诺降低幻觉污染本地参考层和越权执行的概率",
      "不在当前阶段推进代币发行",
    ],
  };
}

function buildMvpDescriptor() {
  return {
    name: "resident single-agent runtime",
    summary:
      "先把一台电脑里的一个 canonical agent 做成离线优先、忘了会查本地纪要、关键动作可协商可恢复的 Runtime。",
    inScope: [
      "single-device resident agent binding",
      "local-first local reference store",
      "four-layer memory with structured writes",
      "local conversation minutes and runtime search",
      "context builder / response-check / compactor / checkpoint runner loop",
      "risk-tiered command negotiation",
      "critical-action records and auditable cold path",
    ],
    outOfScope: [
      "全网 SaaS 上下文自动打通",
      "每条记忆实时上链或分布式验证",
      "所有动作一律多签审批",
      "默认依赖向量数据库才能恢复",
      "代币发行",
    ],
    successCriteria: [
      "一个 agent 能稳定住进一台电脑里",
      "忘了时能从本地 minutes / decision / evidence / compact boundary 恢复",
      "日常低风险动作不被官僚式审批拖垮",
      "高风险动作会被明确分级、确认、审计或升级到 multisig",
    ],
  };
}

function buildSecurityArchitectureDescriptor() {
  return {
    posture: "local-first, check-critical-actions, minimize blast radius",
    trustModel: {
      truthSource: "The local reference store, not the LLM, is the truth source for identity and state.",
      reasoner: "LLM is a candidate generator and must pass local checks before writes or execution",
      execution: "actions are classified by policy tier: low-risk can stay local and fast, high-risk needs confirmation, critical actions escalate to multisig",
      retrieval: `rehydrate defaults to ${DEFAULT_RUNTIME_RETRIEVAL_STRATEGY}; vector index is optional and disabled by default`,
    },
    principles: [
      "默认本地优先，原始记忆和原始纪要不依赖云端常驻",
      "敏感数据不上链，链上或校验层只保留证明、记录和哈希锚点",
      "最小权限，工具、网络、文件、执行都按策略分级放行",
      "可恢复优先于完美自治，出现漂移时优先 checkpoint / rehydrate / human review",
      "关键动作必须可审计、可回滚、可追责",
      "默认本地检索优先、非向量优先，先靠结构化索引和 lexical scorer 找回状态",
    ],
    currentControls: [
      "resident agent binding in current local reference store",
      "loopback-only default host binding",
      "write-api admin token",
      "protected-read admin token",
      "scoped read sessions",
      "role-scoped read sessions",
      "parent/child read-session lineage with ancestor invalidation",
      "resource-bound read sessions for agent/window/credential/authorization/migration-repair/status-list surfaces",
      "endpoint-family read scopes for core sensitive GET surfaces",
      "fine-grained read role bundles for authorization/repair/status-list observers",
      "separate recovery read scope",
      "local_only / online_enhanced runtime mode",
      "command negotiation loop",
      "risk-tiered authorization strategy",
      "local-first non-vector runtime search",
      "encrypted ledger at rest",
      "keychain-first local key management",
      "keychain migration dry-run path",
      "recovery bundle export/import",
      "local reasoner health summaries and restore candidates",
      "local reasoner restore path with optional prewarm",
      "capability-allowlisted action execution layer",
      "independent sandbox broker process",
      "macOS seatbelt-backed broker system sandbox",
      "subprocess worker isolation backend",
      "isolated sandbox worker env/home/tmp",
      "strict host and command allowlist matching",
      "optional sha256-pinned process command allowlist entries",
      "canonical realpath checks for filesystem roots and process commands",
      "redacted security/recovery views for delegated read sessions",
      "field-level redaction for delegated agent/runtime/credential views",
      "token-aware context budgeting",
      "sequential smoke orchestration for shared runtime state",
      "response checking",
      "compact boundary and rehydrate",
      "bounded automatic rehydrate resume loop",
      "formal recovery readiness summary",
      "runtime integrity self-check runs",
    ],
    knownGaps: [
      "读接口已经支持 role-scoped read sessions、parent/child lineage、resource binding、endpoint-family read scopes 与 field-level redaction，并已覆盖 agent/window/credential/authorization/migration-repair/status-list 等核心敏感读面，但仍未做更细的角色层级、按字段/按对象模板化授权",
      "执行层已进入 broker + subprocess worker + macOS seatbelt；但网络侧的 OS 级约束当前仍主要是端口级规则，且尚未统一覆盖非 macOS 平台",
      "签名主密钥与账本虽然已支持 keychain-first，但仍未接入更强的系统级密钥隔离/HSM",
      "recovery bundle 与恢复演练已进入正式 readiness 汇总，并可驱动有限次自动续跑；但仍缺跨设备灾备编排与更强的系统级备份编排",
    ],
  };
}

function buildNextPhaseChecklist() {
  return [
    {
      id: "security-architecture",
      title: "安全架构基线",
      status: "planned",
      priority: "P0",
      goal: "把 resident agent runtime 的安全边界、信任模型和威胁面正式收口",
      deliverables: [
        "threat model",
        "trust boundary diagram",
        "key material lifecycle",
        "incident response and recovery flow",
      ],
      acceptance: [
        "能明确区分本地热路径、联网增强、受控冷路径",
        "能明确责任边界与高风险动作的默认策略",
      ],
    },
    {
      id: "local-store-encryption",
      title: "本地存储加密",
      status: "in_progress",
      priority: "P0",
      goal: "让本地参考层在磁盘静态存储时默认加密，而不是明文 JSON",
      deliverables: [
        "ledger at-rest encryption",
        "machine-bound key or passphrase mode",
        "integrity check before decrypt/load",
        "backup/export with explicit unwrap flow",
      ],
      acceptance: [
        "本地账本默认不能被直接明文读取",
        "解密失败或篡改时 runtime 明确拒绝启动",
      ],
    },
    {
      id: "execution-sandbox",
      title: "受限执行层",
      status: "in_progress",
      priority: "P0",
      goal: "把 Agent 的命令执行能力收进最小权限执行层，避免越权和误操作放大",
      deliverables: [
        "tool capability tiers",
        "filesystem/network allowlist",
        "budgeted command execution",
        "human confirmation hooks for high-risk actions",
      ],
      acceptance: [
        "高风险动作默认无法直达宿主系统",
        "执行前能给出策略判定、确认需求和审计记录",
      ],
    },
    {
      id: "risk-tier-policy",
      title: "风险分级授权策略",
      status: "in_progress",
      priority: "P0",
      goal: "让低风险动作保持低延迟，让高风险和 critical 动作才升级到确认或多签冷路径",
      deliverables: [
        "runtime risk classification",
        "tiered authorization matrix",
        "critical-action multisig escalation",
      ],
      acceptance: [
        "不能再把所有动作都等同成 multisig 流程",
        "运行时能明确返回 risk tier、authorization strategy 和下一步动作",
      ],
    },
    {
      id: "transcript-state-model",
      title: "显式 Transcript / State Model",
      status: "planned",
      priority: "P1",
      goal: "把消息流、progress 噪声、tool result 和 compact boundary 分开建模",
      deliverables: [
        "structured message model",
        "query state + session state transitions",
        "resume lineage",
      ],
      acceptance: [
        "resume 不再依赖混合文本历史",
        "progress 与核心 transcript 可分离回放",
      ],
    },
    {
      id: "local-retrieval-stack",
      title: "本地检索栈",
      status: "in_progress",
      priority: "P1",
      goal: "先用轻量索引把 conversation minutes / decisions / evidence / compact boundaries 变成稳定恢复材料，并默认保持 non-vector-first",
      deliverables: [
        "full-text and tag index",
        "scored local runtime search",
        "rehydrate query policies",
      ],
      acceptance: [
        "忘记后能先查本地纪要再恢复，而不是继续猜",
        "不依赖云端 vector DB 才能完成第一阶段恢复",
        "runtime search 响应能明确声明 local-first、lexical scorer 和 vector disabled",
      ],
    },
  ];
}

function buildDocumentationDescriptor() {
  return [
    {
      id: "product-positioning",
      title: "产品定位",
      path: "/docs/product-positioning.md",
      purpose: "说明第一阶段为什么要从全球协议收缩到单机单 Agent Runtime。",
    },
    {
      id: "mvp",
      title: "MVP 设计",
      path: "/docs/mvp.md",
      purpose: "说明第一阶段最小可落地范围、热温冷路径和发布门槛。",
    },
    {
      id: "security-architecture",
      title: "安全架构",
      path: "/docs/security-architecture.md",
      purpose: "说明 trust model、威胁面、加密、受限执行层与恢复策略。",
    },
    {
      id: "next-phase-security-checklist",
      title: "下一阶段实施清单",
      path: "/docs/next-phase-security-checklist.md",
      purpose: "说明安全架构、本地加密和受限执行层为什么是下一阶段 P0。",
    },
  ];
}

export function buildProtocolDescriptor({ chainId = null, apiBase = "/api", counts = null } = {}) {
  const types = {
    did: {
      method: {
        active: ACTIVE_DID_METHOD,
        planned: FUTURE_DID_METHOD,
        supported: [...SUPPORTED_DID_METHODS],
        resolvable: [...RESOLVABLE_DID_METHODS],
        signable: [...SIGNABLE_DID_METHODS],
        defaultIssuer: ACTIVE_DID_METHOD,
        example: chainId ? `did:${ACTIVE_DID_METHOD}:${chainId}:agent-example` : `did:${ACTIVE_DID_METHOD}:chain:agent-example`,
        compatibility: "active method remains openneed for backward compatibility with existing local ledgers",
        methods: {
          [ACTIVE_DID_METHOD]: {
            state: "active",
            resolvable: true,
            signable: SIGNABLE_DID_METHODS.includes(ACTIVE_DID_METHOD),
            defaultIssuer: true,
            note: "default issuer method for backward compatibility with existing ledgers",
          },
          [FUTURE_DID_METHOD]: {
            state: "preview",
            resolvable: RESOLVABLE_DID_METHODS.includes(FUTURE_DID_METHOD),
            signable: SIGNABLE_DID_METHODS.includes(FUTURE_DID_METHOD),
            defaultIssuer: false,
            note: "preview method for forward OpenNeed memory-engine issuance and migration testing",
          },
        },
      },
      verificationMethod: buildTypeDescriptor(
        "did.verificationMethod.wallet",
        DID_VERIFICATION_METHOD_TYPE,
        [LEGACY_DID_VERIFICATION_METHOD_TYPE],
        "binds a DID document entry to the agent wallet-derived local key material"
      ),
      signingMethod: buildTypeDescriptor(
        "did.verificationMethod.signing",
        DID_SIGNING_VERIFICATION_METHOD_TYPE,
        [],
        "deterministic Ed25519 signing key used for OpenNeed memory-engine credentials"
      ),
      service: {
        hub: buildTypeDescriptor(
          "did.service.hub",
          DID_SERVICE_HUB_TYPE,
          [LEGACY_DID_SERVICE_HUB_TYPE],
          "thread-external agent hub endpoint"
        ),
        wallet: buildTypeDescriptor(
          "did.service.wallet",
          "WalletAddressService",
          [],
          "wallet address exposure in the local DID document"
        ),
      },
    },
    credentials: {
      agentIdentity: buildTypeDescriptor(
        "credential.agentIdentity",
        AGENT_IDENTITY_CREDENTIAL_TYPE,
        [LEGACY_AGENT_IDENTITY_CREDENTIAL_TYPE],
        "local identity, policy and asset snapshot for one agent"
      ),
      authorizationReceipt: buildTypeDescriptor(
        "credential.authorizationReceipt",
        AUTHORIZATION_RECEIPT_CREDENTIAL_TYPE,
        [LEGACY_AUTHORIZATION_RECEIPT_CREDENTIAL_TYPE],
        "multisig authorization proposal lifecycle record"
      ),
      comparisonEvidence: buildTypeDescriptor(
        "credential.comparisonEvidence",
        COMPARISON_EVIDENCE_CREDENTIAL_TYPE,
        [LEGACY_COMPARISON_EVIDENCE_CREDENTIAL_TYPE],
        "audit credential describing how two agents differ"
      ),
      migrationReceipt: buildTypeDescriptor(
        "credential.migrationReceipt",
        MIGRATION_RECEIPT_CREDENTIAL_TYPE,
        [LEGACY_MIGRATION_RECEIPT_CREDENTIAL_TYPE],
        "repair record for credential migration and method backfill actions"
      ),
      statusList: buildTypeDescriptor(
        "credential.statusList",
        STATUS_LIST_CREDENTIAL_TYPE,
        [LEGACY_STATUS_LIST_CREDENTIAL_TYPE],
        "revocation list for locally issued credentials"
      ),
    },
    evidence: {
      agentSnapshot: buildTypeDescriptor(
        "evidence.agentSnapshot",
        AGENT_SNAPSHOT_EVIDENCE_TYPE,
        [LEGACY_AGENT_SNAPSHOT_EVIDENCE_TYPE],
        "identity hub snapshot embedded in an identity credential"
      ),
      authorizationTimeline: buildTypeDescriptor(
        "evidence.authorizationTimeline",
        AUTHORIZATION_TIMELINE_EVIDENCE_TYPE,
        [LEGACY_AUTHORIZATION_TIMELINE_EVIDENCE_TYPE],
        "proposal timeline embedded in an authorization record"
      ),
      comparison: buildTypeDescriptor(
        "evidence.comparison",
        COMPARISON_EVIDENCE_TYPE,
        [LEGACY_COMPARISON_EVIDENCE_TYPE],
        "comparison payload embedded in a comparison audit credential"
      ),
      migrationRepair: buildTypeDescriptor(
        "evidence.migrationRepair",
        MIGRATION_REPAIR_EVIDENCE_TYPE,
        [LEGACY_MIGRATION_REPAIR_EVIDENCE_TYPE],
        "repair plan and execution result embedded in a migration record"
      ),
      statusList: buildTypeDescriptor(
        "evidence.statusList",
        STATUS_LIST_EVIDENCE_TYPE,
        [LEGACY_STATUS_LIST_EVIDENCE_TYPE],
        "bitstring-like local status list payload"
      ),
    },
    proof: {
      ledgerHash: buildTypeDescriptor(
        "proof.ledgerHash",
        LEDGER_HASH_PROOF_TYPE,
        [LEGACY_LEDGER_HASH_PROOF_TYPE],
        "local hash proof anchored to the ledger head"
      ),
      signature: buildTypeDescriptor(
        "proof.signature",
        VC_SIGNATURE_PROOF_TYPE,
        [],
        "Ed25519 proof over the canonical credential hash"
      ),
      statusList: buildTypeDescriptor(
        "proof.statusList",
        STATUS_LIST_PROOF_TYPE,
        [LEGACY_STATUS_LIST_PROOF_TYPE],
        "proof for one credential entry inside a status list"
      ),
    },
    status: {
      entry: buildTypeDescriptor(
        "status.entry",
        STATUS_ENTRY_TYPE,
        [LEGACY_STATUS_ENTRY_TYPE],
        "credentialStatus entry pointing into a status list"
      ),
      ledger: buildTypeDescriptor(
        "status.ledger",
        STATUS_LEDGER_TYPE,
        [LEGACY_STATUS_LEDGER_TYPE],
        "generic snapshot status record"
      ),
      authorization: buildTypeDescriptor(
        "status.authorization",
        STATUS_AUTHORIZATION_TYPE,
        [LEGACY_STATUS_AUTHORIZATION_TYPE],
        "authorization proposal lifecycle status record"
      ),
    },
  };

  return {
    protocol: {
      name: PROTOCOL_NAME,
      slug: PROTOCOL_SLUG,
      version: PROTOCOL_VERSION,
      chainId,
      apiBase,
      focus: [
        "single-device resident agent runtime",
        "thread-external local identity and memory hub",
        "local-first context rebuilding",
        "DID, VC, wallet and risk-tier authorization for critical actions",
      ],
      nonGoals: [
        "forcing closed SaaS ecosystems to expose their full context state",
        "verifying every memory and every response on-chain or through distributed consensus",
        "treating the agent itself as an independent legal person",
        "token issuance in the current phase",
      ],
      compatibility: {
        legacyTypePrefix: LEGACY_TYPE_PREFIX,
        activeDidMethod: ACTIVE_DID_METHOD,
        note: "legacy OpenNeed-flavored records stay readable and locally verifiable inside the current local reference store while new metadata is published under OpenNeed 记忆稳态引擎",
      },
      migration: {
        phase: "dual-method",
        activeDidMethod: ACTIVE_DID_METHOD,
        previewDidMethod: FUTURE_DID_METHOD,
        defaultIssuerDidMethod: ACTIVE_DID_METHOD,
        signableDidMethods: [...SIGNABLE_DID_METHODS],
        resolvableDidMethods: [...RESOLVABLE_DID_METHODS],
        note: "both did:openneed and did:agentpassport resolve to the same local agent identity; issuance remains opt-in per request",
      },
    },
    productPositioning: buildProductPositioningDescriptor(),
    mvp: buildMvpDescriptor(),
    securityArchitecture: buildSecurityArchitectureDescriptor(),
    documentation: buildDocumentationDescriptor(),
    roadmap: {
      phase: "single-device-alpha",
      headline: "先做单机单 Agent、本地优先、可恢复的 Runtime，再逐步协议化",
      currentMvp: {
        name: "resident single-agent runtime",
        description:
          "当前本地参考层默认只绑定一个 resident agent，离线优先运行，忘了先查本地纪要 / decision / evidence，再 rehydrate；日常动作按风险分级执行，critical 动作才进入 multisig 冷路径。",
      },
      nextPhaseChecklist: buildNextPhaseChecklist(),
    },
    capabilityBoundary: buildCapabilityBoundaryDescriptor(),
    types,
    endpoints: {
      protocol: `${apiBase}/protocol`,
      roadmap: `${apiBase}/roadmap`,
      health: `${apiBase}/health`,
      agents: `${apiBase}/agents`,
      compare: `${apiBase}/agents/compare`,
      compareEvidence: `${apiBase}/agents/compare/evidence`,
      compareAudits: `${apiBase}/agents/compare/audits`,
      credentials: `${apiBase}/credentials`,
      statusLists: `${apiBase}/status-lists`,
    },
    counts: cloneJson(counts) ?? null,
  };
}

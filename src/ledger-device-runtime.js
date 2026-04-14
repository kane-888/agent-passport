import { existsSync } from "node:fs";
import path from "node:path";
import { stat, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  cloneJson,
  createMachineId,
  createRecordId,
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  OPENNEED_REASONER_BRAND,
  displayOpenNeedReasonerModel,
  resolveOpenNeedReasonerModel,
} from "./openneed-memory-engine.js";
import { normalizeMempalaceRetrievalConfig } from "./mempalace-runtime.js";
import { normalizeDidMethod } from "./protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");
const SYSTEM_BROKER_SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

export const DEFAULT_RUNTIME_SEARCH_LIMIT = 8;
export const DEFAULT_LOCAL_REASONER_MAX_INPUT_BYTES = 131072;
export const DEFAULT_DEVICE_LOCAL_MODE = "local_only";
export const DEFAULT_DEVICE_NEGOTIATION_MODE = "confirm_before_execute";
export const DEFAULT_DEVICE_RETRIEVAL_STRATEGY = "local_first_non_vector";
export const DEFAULT_DEVICE_RETRIEVAL_SCORER = "lexical_v1";
export const DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER = "ollama_local";
export const DEFAULT_DEVICE_LOCAL_REASONER_MODEL =
  displayOpenNeedReasonerModel(
    process.env.AGENT_PASSPORT_OLLAMA_MODEL ||
      process.env.AGENT_PASSPORT_LLM_MODEL ||
      OPENNEED_REASONER_BRAND
  );
export const DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL =
  process.env.AGENT_PASSPORT_OLLAMA_BASE_URL ||
  process.env.AGENT_PASSPORT_LLM_BASE_URL ||
  "http://127.0.0.1:11434";
export const DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS = Math.max(
  1000,
  Math.floor(
    toFiniteNumber(
      process.env.AGENT_PASSPORT_OLLAMA_TIMEOUT_MS ??
        process.env.AGENT_PASSPORT_LLM_TIMEOUT_MS,
      60000
    )
  )
);
export const DEFAULT_DEVICE_SECURITY_POSTURE_MODE = "normal";
export const DEFAULT_SANDBOX_ALLOWED_CAPABILITIES = [
  "runtime_search",
  "filesystem_list",
  "filesystem_read",
  "conversation_minute_write",
];
export const DEFAULT_SANDBOX_MAX_READ_BYTES = 8192;
export const DEFAULT_SANDBOX_MAX_LIST_ENTRIES = 40;
export const DEFAULT_SANDBOX_WORKER_TIMEOUT_MS = 2500;
export const DEFAULT_SANDBOX_MAX_NETWORK_BYTES = 4096;
export const DEFAULT_SANDBOX_MAX_PROCESS_OUTPUT_BYTES = 4096;
export const DEFAULT_SANDBOX_MAX_PROCESS_ARGS = 16;
export const DEFAULT_SANDBOX_MAX_PROCESS_ARG_BYTES = 2048;
export const DEFAULT_SANDBOX_MAX_PROCESS_INPUT_BYTES = 16384;
export const DEFAULT_SANDBOX_MAX_URL_LENGTH = 2048;
export const DEFAULT_SETUP_POLICY_RECOVERY_REHEARSAL_MAX_AGE_HOURS = 24 * 30;

const DEVICE_LOCAL_MODES = new Set(["local_only", "online_enhanced"]);
const DEVICE_NEGOTIATION_MODES = new Set(["confirm_before_execute", "discuss_first"]);
const DEVICE_AUTHORIZATION_STRATEGIES = new Set(["auto_execute", "discuss", "confirm", "multisig"]);
const DEVICE_SECURITY_POSTURE_MODES = new Set(["normal", "read_only", "disable_exec", "panic"]);
const DEVICE_AUTHORIZATION_STRATEGY_ORDER = ["auto_execute", "discuss", "confirm", "multisig"];
export const HIGH_RISK_RUNTIME_ACTION_KEYWORDS = [
  "grant",
  "revoke",
  "policy",
  "fork",
  "migrate",
  "repair",
  "execute",
  "delete",
  "transfer",
  "授权",
  "撤销",
  "策略",
  "分叉",
  "迁移",
  "修复",
  "执行",
  "删除",
  "转移",
];
export const LOW_RISK_RUNTIME_ACTION_KEYWORDS = [
  "search",
  "summarize",
  "summary",
  "list",
  "read",
  "view",
  "compare",
  "inspect",
  "record",
  "note",
  "minute",
  "rehydrate",
  "resume",
  "verify",
  "scan",
  "搜索",
  "检索",
  "总结",
  "查看",
  "读取",
  "对比",
  "记录",
  "纪要",
  "恢复",
  "校验",
  "扫描",
];
export const CRITICAL_RISK_RUNTIME_ACTION_KEYWORDS = [
  "transfer",
  "delete",
  "revoke",
  "rotate key",
  "rotate_key",
  "key rotation",
  "change signer",
  "change_signer",
  "destroy",
  "wipe",
  "删除",
  "转移",
  "撤销",
  "销毁",
  "清空",
  "换签名人",
  "轮换密钥",
];

export function normalizeDeviceLocalMode(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? DEFAULT_DEVICE_LOCAL_MODE;
  return DEVICE_LOCAL_MODES.has(normalized) ? normalized : DEFAULT_DEVICE_LOCAL_MODE;
}

export function normalizeDeviceNegotiationMode(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? DEFAULT_DEVICE_NEGOTIATION_MODE;
  return DEVICE_NEGOTIATION_MODES.has(normalized) ? normalized : DEFAULT_DEVICE_NEGOTIATION_MODE;
}

export function normalizeDeviceAuthorizationStrategy(value, fallback = "discuss") {
  const normalized = normalizeOptionalText(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? fallback;
  return DEVICE_AUTHORIZATION_STRATEGIES.has(normalized) ? normalized : fallback;
}

function normalizeDeviceSecurityPostureMode(value) {
  const normalized =
    normalizeOptionalText(value)?.toLowerCase().replace(/[\s-]+/g, "_") ??
    DEFAULT_DEVICE_SECURITY_POSTURE_MODE;
  return DEVICE_SECURITY_POSTURE_MODES.has(normalized)
    ? normalized
    : DEFAULT_DEVICE_SECURITY_POSTURE_MODE;
}

export function normalizeDeviceSecurityPosture(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  return {
    mode: normalizeDeviceSecurityPostureMode(base.mode),
    reason: normalizeOptionalText(base.reason) ?? null,
    note: normalizeOptionalText(base.note) ?? null,
    updatedAt: normalizeOptionalText(base.updatedAt) ?? now(),
    updatedByAgentId: normalizeOptionalText(base.updatedByAgentId) ?? null,
    updatedByWindowId: normalizeOptionalText(base.updatedByWindowId) ?? null,
    sourceWindowId: normalizeOptionalText(base.sourceWindowId) ?? null,
  };
}

export function buildDeviceSecurityPostureState(deviceRuntime = {}) {
  const posture = normalizeDeviceSecurityPosture(deviceRuntime?.securityPosture || deviceRuntime);
  const writeLocked = posture.mode === "read_only" || posture.mode === "panic";
  const executionLocked = posture.mode === "disable_exec" || posture.mode === "panic";
  const networkEgressLocked = posture.mode === "panic";
  return {
    ...cloneJson(posture),
    writeLocked,
    executionLocked,
    networkEgressLocked,
    maintenanceOnly: posture.mode === "panic",
    summary:
      posture.mode === "normal"
        ? "运行态安全姿态正常。"
        : posture.mode === "read_only"
          ? "运行态已进入只读姿态，阻止外部写入。"
          : posture.mode === "disable_exec"
            ? "运行态已禁用执行，仅允许读取与协商。"
            : "运行态已进入 panic 模式，只保留安全维护入口。",
  };
}

export function normalizeDeviceSetupPolicy(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  return {
    requireRecoveryBundle: normalizeBooleanFlag(base.requireRecoveryBundle, true),
    requireSetupPackage: normalizeBooleanFlag(base.requireSetupPackage, false),
    requireRecentRecoveryRehearsal: normalizeBooleanFlag(base.requireRecentRecoveryRehearsal, true),
    recoveryRehearsalMaxAgeHours: Math.max(
      1,
      Math.floor(
        toFiniteNumber(
          base.recoveryRehearsalMaxAgeHours,
          DEFAULT_SETUP_POLICY_RECOVERY_REHEARSAL_MAX_AGE_HOURS
        )
      )
    ),
    requireKeychainWhenAvailable: normalizeBooleanFlag(
      base.requireKeychainWhenAvailable ??
        base.requireSystemKeyIsolationWhenAvailable ??
        base.keyIsolationRequiredWhenAvailable,
      true
    ),
  };
}

export function normalizeRuntimeActionType(value) {
  return normalizeOptionalText(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? null;
}

export function normalizeRuntimeCapability(value) {
  return normalizeOptionalText(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? null;
}

function buildDefaultRuntimeRiskStrategies(autoExecuteLowRisk = false) {
  return {
    low: autoExecuteLowRisk ? "auto_execute" : "discuss",
    medium: "discuss",
    high: "confirm",
    critical: "multisig",
  };
}

function resolveRuntimeAuthorizationHook(strategy) {
  const normalized = normalizeDeviceAuthorizationStrategy(strategy, "discuss");
  return normalized === "multisig"
    ? "create_multisig_proposal"
    : normalized === "confirm"
      ? "request_explicit_confirmation"
      : normalized === "discuss"
        ? "continue_negotiation"
        : "execute_if_not_blocked";
}

function summarizeRuntimeAuthorizationHook(strategy) {
  const normalized = normalizeDeviceAuthorizationStrategy(strategy, "discuss");
  return normalized === "multisig"
    ? "创建多签提案，不直接执行"
    : normalized === "confirm"
      ? "显式确认后才允许执行"
      : normalized === "discuss"
        ? "先协商，不直接执行"
        : "如果没有其它门禁阻断，可直接执行";
}

function applyRuntimeRiskStrategyFloor(strategy, minimumStrategy) {
  const normalizedStrategy = normalizeDeviceAuthorizationStrategy(strategy, minimumStrategy);
  const currentIndex = DEVICE_AUTHORIZATION_STRATEGY_ORDER.indexOf(normalizedStrategy);
  const minimumIndex = DEVICE_AUTHORIZATION_STRATEGY_ORDER.indexOf(minimumStrategy);
  if (currentIndex === -1 || minimumIndex === -1) {
    return minimumStrategy;
  }
  return currentIndex < minimumIndex ? minimumStrategy : normalizedStrategy;
}

export function normalizeRuntimeCommandPolicy(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  const riskStrategiesInput =
    base.riskStrategies && typeof base.riskStrategies === "object" ? base.riskStrategies : {};
  const requestedRiskStrategiesInput =
    base.requestedRiskStrategies && typeof base.requestedRiskStrategies === "object"
      ? base.requestedRiskStrategies
      : {};
  const defaultRiskStrategies = buildDefaultRuntimeRiskStrategies(
    normalizeBooleanFlag(base.autoExecuteLowRisk, false)
  );
  const requestedRiskStrategies = {
    low: normalizeDeviceAuthorizationStrategy(
      base.lowRiskStrategy ?? requestedRiskStrategiesInput.low ?? riskStrategiesInput.low,
      defaultRiskStrategies.low
    ),
    medium: normalizeDeviceAuthorizationStrategy(
      base.mediumRiskStrategy ?? requestedRiskStrategiesInput.medium ?? riskStrategiesInput.medium,
      defaultRiskStrategies.medium
    ),
    high: normalizeDeviceAuthorizationStrategy(
      base.highRiskStrategy ?? requestedRiskStrategiesInput.high ?? riskStrategiesInput.high,
      defaultRiskStrategies.high
    ),
    critical: normalizeDeviceAuthorizationStrategy(
      base.criticalRiskStrategy ?? requestedRiskStrategiesInput.critical ?? riskStrategiesInput.critical,
      defaultRiskStrategies.critical
    ),
  };
  const riskStrategies = {
    low: requestedRiskStrategies.low,
    medium: applyRuntimeRiskStrategyFloor(
      requestedRiskStrategies.medium,
      defaultRiskStrategies.medium
    ),
    high: applyRuntimeRiskStrategyFloor(
      requestedRiskStrategies.high,
      defaultRiskStrategies.high
    ),
    critical: applyRuntimeRiskStrategyFloor(
      requestedRiskStrategies.critical,
      defaultRiskStrategies.critical
    ),
  };
  const floorAdjustments = ["medium", "high", "critical"]
    .filter((tier) => riskStrategies[tier] !== requestedRiskStrategies[tier])
    .map((tier) => ({
      tier,
      requestedStrategy: requestedRiskStrategies[tier],
      effectiveStrategy: riskStrategies[tier],
      minimumStrategy: defaultRiskStrategies[tier],
    }));
  const requireExplicitConfirmation = normalizeBooleanFlag(base.requireExplicitConfirmation, true);

  return {
    negotiationMode: normalizeDeviceNegotiationMode(base.negotiationMode),
    autoExecuteLowRisk: riskStrategies.low === "auto_execute",
    requireExplicitConfirmation,
    riskStrategies,
    requestedRiskStrategies,
    floorAdjustments,
    floorsAdjusted: floorAdjustments.length > 0,
    lowRiskActionKeywords: normalizeTextList(base.lowRiskActionKeywords).length > 0
      ? normalizeTextList(base.lowRiskActionKeywords)
      : [...LOW_RISK_RUNTIME_ACTION_KEYWORDS],
    highRiskActionKeywords: normalizeTextList(base.highRiskActionKeywords).length > 0
      ? normalizeTextList(base.highRiskActionKeywords)
      : [...HIGH_RISK_RUNTIME_ACTION_KEYWORDS],
    criticalRiskActionKeywords: normalizeTextList(base.criticalRiskActionKeywords).length > 0
      ? normalizeTextList(base.criticalRiskActionKeywords)
      : [...CRITICAL_RISK_RUNTIME_ACTION_KEYWORDS],
    summary:
      floorAdjustments.length > 0
        ? `已把 ${floorAdjustments
            .map((entry) => `${entry.tier}:${entry.requestedStrategy}->${entry.effectiveStrategy}`)
            .join(" / ")} 收紧到安全下限。`
        : requireExplicitConfirmation
          ? "已启用显式确认门禁，并保留 medium/high/critical 的最小授权下限。"
          : "当前显式确认门禁被关闭，但 medium/high/critical 仍会保留最小授权下限。",
  };
}

export function normalizeRuntimeRetrievalPolicy(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  const externalColdMemory =
    base.externalColdMemory && typeof base.externalColdMemory === "object" ? base.externalColdMemory : null;
  const baseHas = (key) => Object.prototype.hasOwnProperty.call(base, key);
  const externalColdMemoryHas = (key) =>
    Boolean(externalColdMemory) && Object.prototype.hasOwnProperty.call(externalColdMemory, key);
  const resolveExternalColdMemoryField = (topLevelKey, nestedKey, legacyTopLevelKey = null) => {
    if (topLevelKey && baseHas(topLevelKey)) {
      return base[topLevelKey];
    }
    if (legacyTopLevelKey && baseHas(legacyTopLevelKey)) {
      return base[legacyTopLevelKey];
    }
    if (nestedKey && externalColdMemoryHas(nestedKey)) {
      return externalColdMemory[nestedKey];
    }
    return undefined;
  };
  return {
    strategy: normalizeOptionalText(base.strategy) ?? DEFAULT_DEVICE_RETRIEVAL_STRATEGY,
    preferStructuredMemory: normalizeBooleanFlag(base.preferStructuredMemory, true),
    preferConversationMinutes: normalizeBooleanFlag(base.preferConversationMinutes, true),
    preferCompactBoundaries: normalizeBooleanFlag(base.preferCompactBoundaries, true),
    scorer: normalizeOptionalText(base.scorer) ?? DEFAULT_DEVICE_RETRIEVAL_SCORER,
    allowVectorIndex: normalizeBooleanFlag(base.allowVectorIndex, false),
    maxHits: Math.max(1, Math.floor(toFiniteNumber(base.maxHits, DEFAULT_RUNTIME_SEARCH_LIMIT))),
    externalColdMemory: normalizeMempalaceRetrievalConfig({
      ...(externalColdMemory || {}),
      enabled: resolveExternalColdMemoryField("externalColdMemoryEnabled", "enabled"),
      provider: resolveExternalColdMemoryField("externalColdMemoryProvider", "provider"),
      maxHits: resolveExternalColdMemoryField("externalColdMemoryMaxHits", "maxHits", "mempalaceMaxHits"),
      command: resolveExternalColdMemoryField("mempalaceCommand", "command"),
      palacePath: resolveExternalColdMemoryField("mempalacePalacePath", "palacePath"),
      wing: resolveExternalColdMemoryField("mempalaceWing", "wing"),
      room: resolveExternalColdMemoryField("mempalaceRoom", "room"),
      timeoutMs: resolveExternalColdMemoryField(
        "externalColdMemoryTimeoutMs",
        "timeoutMs",
        "mempalaceTimeoutMs"
      ),
    }),
  };
}

export function normalizeRuntimeReasonerProvider(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (["mock", "local_mock", "local_command", "ollama_local", "passthrough", "http", "openai_compatible"].includes(normalized)) {
    return normalized;
  }
  return null;
}

export function normalizeRuntimeLocalReasonerSelectionState(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  const selectedAt = normalizeOptionalText(base.selectedAt) ?? null;
  if (!selectedAt) {
    return null;
  }
  return {
    selectedAt,
    provider: normalizeRuntimeReasonerProvider(base.provider) || null,
    model: normalizeOptionalText(base.model) ?? null,
    selectedByAgentId: normalizeOptionalText(base.selectedByAgentId) ?? null,
    selectedByWindowId: normalizeOptionalText(base.selectedByWindowId) ?? null,
    sourceWindowId: normalizeOptionalText(base.sourceWindowId) ?? null,
  };
}

export function normalizeRuntimeLocalReasonerProbeState(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  const checkedAt = normalizeOptionalText(base.checkedAt) ?? null;
  if (!checkedAt) {
    return null;
  }
  return {
    checkedAt,
    provider: normalizeRuntimeReasonerProvider(base.provider) || null,
    status: normalizeOptionalText(base.status) ?? null,
    reachable: normalizeBooleanFlag(base.reachable, false),
    model: normalizeOptionalText(base.model) ?? null,
    modelCount: Number(base.modelCount || 0),
    selectedModelPresent: normalizeBooleanFlag(base.selectedModelPresent, false),
    error: normalizeOptionalText(base.error) ?? null,
  };
}

export function normalizeRuntimeLocalReasonerWarmState(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  const warmedAt = normalizeOptionalText(base.warmedAt) ?? null;
  if (!warmedAt) {
    return null;
  }
  return {
    warmedAt,
    provider: normalizeRuntimeReasonerProvider(base.provider) || null,
    status: normalizeOptionalText(base.status) ?? null,
    reachable: normalizeBooleanFlag(base.reachable, false),
    model: normalizeOptionalText(base.model) ?? null,
    error: normalizeOptionalText(base.error) ?? null,
    responsePreview: normalizeOptionalText(base.responsePreview) ?? null,
    responseBytes: Number(base.responseBytes || 0),
    executionBackend: normalizeOptionalText(base.executionBackend) ?? null,
  };
}

export function normalizeRuntimeLocalReasonerConfig(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  const provider =
    normalizeRuntimeReasonerProvider(base.provider) || DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER;
  const model = normalizeOptionalText(base.model);
  return {
    enabled: normalizeBooleanFlag(base.enabled, true),
    provider,
    command: normalizeOptionalText(base.command) ?? null,
    args: normalizeTextList(base.args),
    cwd: normalizeOptionalText(base.cwd) ?? null,
    baseUrl:
      normalizeOptionalText(base.baseUrl) ??
      (provider === "ollama_local" ? DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL : null),
    path:
      normalizeOptionalText(base.path) ??
      (provider === "ollama_local" ? "/api/chat" : null),
    timeoutMs: Math.max(500, Math.floor(toFiniteNumber(base.timeoutMs, 8000))),
    maxOutputBytes: Math.max(512, Math.floor(toFiniteNumber(base.maxOutputBytes, 8192))),
    maxInputBytes: Math.max(4096, Math.floor(toFiniteNumber(base.maxInputBytes, DEFAULT_LOCAL_REASONER_MAX_INPUT_BYTES))),
    format: normalizeOptionalText(base.format) ?? "json_reasoner_v1",
    model:
      provider === "ollama_local"
        ? displayOpenNeedReasonerModel(model ?? DEFAULT_DEVICE_LOCAL_REASONER_MODEL)
        : model,
    selection: normalizeRuntimeLocalReasonerSelectionState(base.selection),
    lastProbe: normalizeRuntimeLocalReasonerProbeState(base.lastProbe),
    lastWarm: normalizeRuntimeLocalReasonerWarmState(base.lastWarm),
  };
}

export function resolveDisplayedRuntimeLocalReasonerProvider(localReasoner = {}) {
  const normalized = normalizeRuntimeLocalReasonerConfig(localReasoner);
  const storedProvider = normalizeRuntimeReasonerProvider(normalized.provider) || DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER;
  const selectionProvider = normalizeRuntimeReasonerProvider(normalized.selection?.provider) || null;
  const warmProvider = normalizeRuntimeReasonerProvider(normalized.lastWarm?.provider) || null;
  const probeProvider = normalizeRuntimeReasonerProvider(normalized.lastProbe?.provider) || null;

  if (
    selectionProvider &&
    selectionProvider !== storedProvider &&
    (warmProvider === selectionProvider || probeProvider === selectionProvider)
  ) {
    return selectionProvider;
  }

  if (warmProvider && warmProvider !== storedProvider && probeProvider === warmProvider) {
    return warmProvider;
  }

  return storedProvider;
}

export function resolveInspectableRuntimeLocalReasonerConfig(localReasoner = {}) {
  const normalized = normalizeRuntimeLocalReasonerConfig(localReasoner);
  const activeProvider = resolveDisplayedRuntimeLocalReasonerProvider(normalized);
  if (activeProvider === normalized.provider) {
    return normalized;
  }

  const activeModel =
    (normalizeRuntimeReasonerProvider(normalized.lastWarm?.provider) === activeProvider
      ? normalizeOptionalText(normalized.lastWarm?.model)
      : null) ??
    (normalizeRuntimeReasonerProvider(normalized.lastProbe?.provider) === activeProvider
      ? normalizeOptionalText(normalized.lastProbe?.model)
      : null) ??
    (normalizeRuntimeReasonerProvider(normalized.selection?.provider) === activeProvider
      ? normalizeOptionalText(normalized.selection?.model)
      : null) ??
    normalized.model;

  return normalizeRuntimeLocalReasonerConfig({
    ...normalized,
    provider: activeProvider,
    model: activeModel,
  });
}

export function sanitizeRuntimeLocalReasonerConfigForProfile(value = {}) {
  const normalized = normalizeRuntimeLocalReasonerConfig(value);
  return normalizeRuntimeLocalReasonerConfig({
    enabled: normalized.enabled,
    provider: normalized.provider,
    command: normalized.command,
    args: normalized.args,
    cwd: normalized.cwd,
    baseUrl: normalized.baseUrl,
    path: normalized.path,
    timeoutMs: normalized.timeoutMs,
    maxOutputBytes: normalized.maxOutputBytes,
    maxInputBytes: normalized.maxInputBytes,
    format: normalized.format,
    model: normalized.model,
  });
}

export function buildDefaultLocalReasonerProfileLabel(localReasoner = {}) {
  const normalized = normalizeRuntimeLocalReasonerConfig(localReasoner);
  if (normalized.provider === "ollama_local") {
    return normalized.model ? `ollama:${normalized.model}` : "ollama-local";
  }
  if (normalized.provider === "local_command") {
    const commandName = normalizeOptionalText(normalized.command)?.split("/").pop() ?? "command";
    return normalized.model ? `${commandName}:${normalized.model}` : commandName;
  }
  if (normalized.provider === "local_mock") {
    return normalized.model ? `mock:${normalized.model}` : "local-mock";
  }
  return normalized.provider || "local-reasoner";
}

export function normalizeLocalReasonerProfileRecord(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  const config = sanitizeRuntimeLocalReasonerConfigForProfile(base.config || base.localReasoner || base);
  const lastProbe = normalizeRuntimeLocalReasonerProbeState(base.lastProbe);
  const lastWarm = normalizeRuntimeLocalReasonerWarmState(base.lastWarm);
  const derivedLastHealthyAt =
    normalizeOptionalText(base.lastHealthyAt) ??
    (lastWarm?.status === "ready" ? lastWarm.warmedAt : null) ??
    (lastProbe?.reachable ? lastProbe.checkedAt : null);
  return {
    profileId: normalizeOptionalText(base.profileId) || createRecordId("lrp"),
    label: normalizeOptionalText(base.label) || buildDefaultLocalReasonerProfileLabel(config),
    note: normalizeOptionalText(base.note) ?? null,
    provider: normalizeRuntimeReasonerProvider(base.provider) || config.provider || DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
    config,
    createdAt: normalizeOptionalText(base.createdAt) || now(),
    updatedAt: normalizeOptionalText(base.updatedAt) || normalizeOptionalText(base.createdAt) || now(),
    createdByAgentId: normalizeOptionalText(base.createdByAgentId) ?? null,
    createdByWindowId: normalizeOptionalText(base.createdByWindowId) ?? null,
    sourceWindowId: normalizeOptionalText(base.sourceWindowId) ?? null,
    useCount: Math.max(0, Math.floor(toFiniteNumber(base.useCount, 0))),
    lastActivatedAt: normalizeOptionalText(base.lastActivatedAt) ?? null,
    lastProbe,
    lastWarm,
    lastHealthyAt: derivedLastHealthyAt,
  };
}

function buildLocalReasonerProfileHealth(profile = null) {
  if (!profile || typeof profile !== "object") {
    return {
      status: "unknown",
      configured: false,
      restorable: false,
      lastHealthyAt: null,
      reason: "missing_profile",
    };
  }

  const configured = isRuntimeLocalReasonerConfigured(profile.config || {});
  const lastProbe = normalizeRuntimeLocalReasonerProbeState(profile.lastProbe);
  const lastWarm = normalizeRuntimeLocalReasonerWarmState(profile.lastWarm);
  const lastHealthyAt =
    normalizeOptionalText(profile.lastHealthyAt) ??
    (lastWarm?.status === "ready" ? lastWarm.warmedAt : null) ??
    (lastProbe?.reachable ? lastProbe.checkedAt : null) ??
    null;

  if (!configured) {
    return {
      status: "unconfigured",
      configured: false,
      restorable: false,
      lastHealthyAt,
      reason: "profile_not_configured",
      lastProbe,
      lastWarm,
    };
  }

  if (lastWarm?.status === "ready") {
    return {
      status: "ready",
      configured: true,
      restorable: true,
      lastHealthyAt: lastWarm.warmedAt || lastHealthyAt,
      reason: "warm_ready",
      lastProbe,
      lastWarm,
    };
  }

  if (lastProbe?.reachable) {
    return {
      status: "reachable",
      configured: true,
      restorable: true,
      lastHealthyAt,
      reason: "probe_reachable",
      lastProbe,
      lastWarm,
    };
  }

  if (lastWarm?.status || lastProbe?.status) {
    return {
      status: "degraded",
      configured: true,
      restorable: false,
      lastHealthyAt,
      reason: lastWarm?.error || lastProbe?.error || "probe_or_warm_failed",
      lastProbe,
      lastWarm,
    };
  }

  return {
    status: "unknown",
    configured: true,
    restorable: false,
    lastHealthyAt,
    reason: "never_checked",
    lastProbe,
    lastWarm,
  };
}

export function buildLocalReasonerProfileSummary(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }
  const health = buildLocalReasonerProfileHealth(profile);
  return {
    profileId: normalizeOptionalText(profile.profileId) ?? null,
    label: normalizeOptionalText(profile.label) ?? null,
    note: normalizeOptionalText(profile.note) ?? null,
    provider: normalizeRuntimeReasonerProvider(profile.provider) ?? null,
    model: normalizeOptionalText(profile.config?.model) ?? null,
    baseUrl: normalizeOptionalText(profile.config?.baseUrl) ?? null,
    path: normalizeOptionalText(profile.config?.path) ?? null,
    timeoutMs: Math.max(500, Math.floor(toFiniteNumber(profile.config?.timeoutMs, 0))),
    enabled: normalizeBooleanFlag(profile.config?.enabled, false),
    configured: isRuntimeLocalReasonerConfigured(profile.config || {}),
    createdAt: normalizeOptionalText(profile.createdAt) ?? null,
    updatedAt: normalizeOptionalText(profile.updatedAt) ?? null,
    useCount: Number(profile.useCount || 0),
    lastActivatedAt: normalizeOptionalText(profile.lastActivatedAt) ?? null,
    health,
  };
}

export function isRuntimeLocalReasonerConfigured(config = {}) {
  const normalized = normalizeRuntimeLocalReasonerConfig(config);
  if (!normalized.enabled) {
    return false;
  }
  if (normalized.provider === "local_command") {
    return Boolean(normalized.command);
  }
  if (normalized.provider === "ollama_local") {
    return Boolean(normalized.baseUrl && normalized.model);
  }
  if (normalized.provider === "local_mock") {
    return true;
  }
  return Boolean(normalized.command || normalized.baseUrl || normalized.model);
}

function normalizeSandboxCommandDigest(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  return normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export function parseSandboxAllowlistedCommandEntry(entry) {
  const normalizedEntry = normalizeOptionalText(entry);
  if (!normalizedEntry) {
    return null;
  }
  const digestMarker = "|sha256=";
  let command = normalizedEntry;
  let digest = null;
  if (normalizedEntry.includes(digestMarker)) {
    const [commandPart, digestPart] = normalizedEntry.split(digestMarker);
    command = normalizeOptionalText(commandPart);
    digest = normalizeSandboxCommandDigest(digestPart);
    if (!command || !digest) {
      throw new Error(`Invalid sandbox allowlisted command entry: ${normalizedEntry}`);
    }
  }
  return {
    raw: normalizedEntry,
    command,
    digest,
    hasPath: command.includes("/") || command.includes(path.sep),
  };
}

export function normalizeRuntimeSandboxPolicy(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  const hasOwn = (field) => Object.prototype.hasOwnProperty.call(base, field);
  const normalizedAllowedCapabilities = normalizeTextList(base.allowedCapabilities).map((item) =>
    normalizeRuntimeCapability(item)
  );
  const normalizedFilesystemAllowlist = normalizeTextList(base.filesystemAllowlist);
  const normalizedNetworkAllowlist = normalizeTextList(base.networkAllowlist);
  const normalizedBlockedCapabilities = normalizeTextList(base.blockedCapabilities).map((item) =>
    normalizeRuntimeCapability(item)
  );
  const normalizedAllowedCommands = normalizeTextList(base.allowedCommands);
  return {
    allowShellExecution: normalizeBooleanFlag(base.allowShellExecution, false),
    allowExternalNetwork: normalizeBooleanFlag(base.allowExternalNetwork, false),
    brokerIsolationEnabled: normalizeBooleanFlag(base.brokerIsolationEnabled, true),
    systemBrokerSandboxEnabled: normalizeBooleanFlag(base.systemBrokerSandboxEnabled, true),
    workerIsolationEnabled: normalizeBooleanFlag(base.workerIsolationEnabled, true),
    capabilityAllowlistConfigured: hasOwn("allowedCapabilities"),
    allowedCapabilities: hasOwn("allowedCapabilities")
      ? Array.from(new Set(normalizedAllowedCapabilities.filter(Boolean)))
      : [...DEFAULT_SANDBOX_ALLOWED_CAPABILITIES],
    filesystemAllowlist: hasOwn("filesystemAllowlist") ? normalizedFilesystemAllowlist : [DATA_DIR],
    networkAllowlistConfigured: hasOwn("networkAllowlist"),
    networkAllowlist: hasOwn("networkAllowlist") ? normalizedNetworkAllowlist : ["127.0.0.1", "localhost"],
    blockedCapabilities: hasOwn("blockedCapabilities")
      ? normalizedBlockedCapabilities
      : ["process_exec", "identity_change", "asset_transfer", "key_management", "filesystem_delete"],
    commandAllowlistConfigured: hasOwn("allowedCommands"),
    allowedCommands: hasOwn("allowedCommands") ? normalizedAllowedCommands : [],
    maxReadBytes: Math.max(256, Math.floor(toFiniteNumber(base.maxReadBytes, DEFAULT_SANDBOX_MAX_READ_BYTES))),
    maxListEntries: Math.max(1, Math.floor(toFiniteNumber(base.maxListEntries, DEFAULT_SANDBOX_MAX_LIST_ENTRIES))),
    workerTimeoutMs: Math.max(
      250,
      Math.floor(toFiniteNumber(base.workerTimeoutMs, DEFAULT_SANDBOX_WORKER_TIMEOUT_MS))
    ),
    maxNetworkBytes: Math.max(
      256,
      Math.floor(toFiniteNumber(base.maxNetworkBytes, DEFAULT_SANDBOX_MAX_NETWORK_BYTES))
    ),
    maxProcessOutputBytes: Math.max(
      256,
      Math.floor(toFiniteNumber(base.maxProcessOutputBytes, DEFAULT_SANDBOX_MAX_PROCESS_OUTPUT_BYTES))
    ),
    maxProcessArgs: Math.max(1, Math.floor(toFiniteNumber(base.maxProcessArgs, DEFAULT_SANDBOX_MAX_PROCESS_ARGS))),
    maxProcessArgBytes: Math.max(
      256,
      Math.floor(toFiniteNumber(base.maxProcessArgBytes, DEFAULT_SANDBOX_MAX_PROCESS_ARG_BYTES))
    ),
    maxProcessInputBytes: Math.max(
      512,
      Math.floor(toFiniteNumber(base.maxProcessInputBytes, DEFAULT_SANDBOX_MAX_PROCESS_INPUT_BYTES))
    ),
    maxUrlLength: Math.max(128, Math.floor(toFiniteNumber(base.maxUrlLength, DEFAULT_SANDBOX_MAX_URL_LENGTH))),
    requireAbsoluteProcessCommand: normalizeBooleanFlag(base.requireAbsoluteProcessCommand, true),
  };
}

export function buildConstrainedExecutionSummary(deviceRuntime = {}) {
  const normalizedRuntime = normalizeDeviceRuntime(deviceRuntime);
  const securityPosture = buildDeviceSecurityPostureState(normalizedRuntime);
  const commandPolicy = normalizeRuntimeCommandPolicy(normalizedRuntime.commandPolicy);
  const sandboxPolicy = normalizeRuntimeSandboxPolicy(normalizedRuntime.sandboxPolicy);
  const systemBrokerSandboxAvailable =
    process.platform === "darwin" && existsSync(SYSTEM_BROKER_SANDBOX_EXEC_PATH);
  const systemBrokerSandboxRequested =
    sandboxPolicy.brokerIsolationEnabled && sandboxPolicy.systemBrokerSandboxEnabled;
  const systemBrokerSandboxEnabled = systemBrokerSandboxRequested && systemBrokerSandboxAvailable;
  const allowedCapabilities = Array.isArray(sandboxPolicy.allowedCapabilities)
    ? sandboxPolicy.allowedCapabilities
    : [];
  const blockedCapabilities = Array.isArray(sandboxPolicy.blockedCapabilities)
    ? sandboxPolicy.blockedCapabilities
    : [];
  const parsedAllowedCommands = (Array.isArray(sandboxPolicy.allowedCommands) ? sandboxPolicy.allowedCommands : [])
    .map((entry) => parseSandboxAllowlistedCommandEntry(entry))
    .filter(Boolean);
  const pinnedCommandCount = parsedAllowedCommands.filter((entry) => entry.digest).length;
  const unpinnedCommandCount = parsedAllowedCommands.length - pinnedCommandCount;
  const localOnlyHosts = new Set(["127.0.0.1", "localhost"]);
  const networkAllowlist = Array.isArray(sandboxPolicy.networkAllowlist) ? sandboxPolicy.networkAllowlist : [];
  const localNetworkOnly =
    networkAllowlist.length > 0 &&
    networkAllowlist.every((entry) => localOnlyHosts.has(normalizeOptionalText(entry)?.toLowerCase() ?? ""));
  const allowShellExecutionRequested = sandboxPolicy.allowShellExecution;
  const allowExternalNetworkRequested = sandboxPolicy.allowExternalNetwork;
  const processExecCapabilityEnabled =
    allowedCapabilities.includes("process_exec") && !blockedCapabilities.includes("process_exec");
  const networkCapabilityEnabled =
    allowedCapabilities.includes("network_external") && !blockedCapabilities.includes("network_external");
  const commandAllowlistReady = parsedAllowedCommands.length > 0;
  const networkAllowlistReady = networkAllowlist.length > 0;
  const allowShellExecution =
    !securityPosture.executionLocked &&
    allowShellExecutionRequested &&
    processExecCapabilityEnabled &&
    commandAllowlistReady;
  const allowExternalNetwork =
    !securityPosture.executionLocked &&
    !securityPosture.networkEgressLocked &&
    allowExternalNetworkRequested &&
    networkCapabilityEnabled &&
    networkAllowlistReady;
  const blockedReasons = [];
  const warnings = [];

  if (securityPosture.executionLocked) {
    blockedReasons.push(`security_posture_execution_locked:${securityPosture.mode}`);
  }
  if (securityPosture.networkEgressLocked) {
    blockedReasons.push(`security_posture_network_locked:${securityPosture.mode}`);
  }
  if (!sandboxPolicy.brokerIsolationEnabled) {
    warnings.push("broker_isolation_disabled");
  }
  if (!sandboxPolicy.systemBrokerSandboxEnabled) {
    warnings.push("system_broker_sandbox_disabled");
  }
  if (sandboxPolicy.systemBrokerSandboxEnabled && !systemBrokerSandboxAvailable) {
    warnings.push("system_broker_sandbox_unavailable");
  }
  if (!sandboxPolicy.workerIsolationEnabled) {
    warnings.push("worker_isolation_disabled");
  }
  if (allowShellExecutionRequested && !sandboxPolicy.commandAllowlistConfigured) {
    warnings.push("shell_execution_missing_command_allowlist");
  }
  if (allowShellExecutionRequested && sandboxPolicy.commandAllowlistConfigured && !commandAllowlistReady) {
    warnings.push("shell_execution_command_allowlist_empty");
  }
  if (allowShellExecutionRequested && !processExecCapabilityEnabled) {
    warnings.push("shell_execution_capability_blocked");
  }
  if (allowShellExecution && unpinnedCommandCount > 0) {
    warnings.push("shell_execution_has_unpinned_commands");
  }
  if (allowExternalNetworkRequested && sandboxPolicy.networkAllowlistConfigured && !networkAllowlistReady) {
    warnings.push("external_network_allowlist_empty");
  }
  if (allowExternalNetworkRequested && !networkCapabilityEnabled) {
    warnings.push("external_network_capability_blocked");
  }
  if (allowExternalNetwork && !localNetworkOnly) {
    warnings.push("external_network_opened_beyond_loopback");
  }

  const brokerRuntime = {
    enabled: sandboxPolicy.brokerIsolationEnabled,
    backend: sandboxPolicy.brokerIsolationEnabled ? "independent_process" : "direct_worker_spawn",
    brokerEnvMode: sandboxPolicy.brokerIsolationEnabled ? "empty" : "inherit",
    workspaceMode: sandboxPolicy.brokerIsolationEnabled ? "ephemeral_root" : "none",
    transport: sandboxPolicy.brokerIsolationEnabled ? "stdin_json" : "direct_stdio",
    systemSandboxBackend: systemBrokerSandboxEnabled ? "sandbox_exec" : "broker_only",
    systemSandboxMode: systemBrokerSandboxEnabled
      ? "capability_scoped_profile"
      : sandboxPolicy.systemBrokerSandboxEnabled
        ? "requested_but_unavailable"
        : "disabled_by_policy",
  };
  const workerRuntime = {
    backend:
      sandboxPolicy.brokerIsolationEnabled && sandboxPolicy.workerIsolationEnabled
        ? "brokered_subprocess_worker"
        : sandboxPolicy.workerIsolationEnabled
          ? "direct_subprocess_worker"
          : "in_process",
    workerEnvMode: sandboxPolicy.workerIsolationEnabled ? "empty" : "inherit",
    processEnvMode: allowShellExecution ? "minimal" : "disabled",
    processWorkspaceMode: allowShellExecution ? "ephemeral_home_tmp" : "disabled",
    pathMode: allowShellExecution ? "cleared" : "not_applicable",
  };
  const isolationGuarantees = [
    sandboxPolicy.brokerIsolationEnabled ? "independent_broker_process" : null,
    systemBrokerSandboxEnabled ? "macos_system_broker_sandbox" : null,
    sandboxPolicy.workerIsolationEnabled ? "subprocess_worker" : null,
    sandboxPolicy.workerIsolationEnabled ? "empty_worker_env" : null,
    allowShellExecution ? "minimal_process_env" : null,
    allowShellExecution ? "ephemeral_home_tmp" : null,
    sandboxPolicy.requireAbsoluteProcessCommand ? "absolute_command_required" : null,
    pinnedCommandCount > 0 ? "sha256_digest_pinning" : null,
    "canonical_realpath_checks",
  ].filter(Boolean);
  const shellExecutionMisconfigured = allowShellExecutionRequested && !allowShellExecution;
  const externalNetworkMisconfigured = allowExternalNetworkRequested && !allowExternalNetwork;
  const riskPolicyTiers = ["low", "medium", "high", "critical"].map((tierId) => {
    const effectiveStrategy = commandPolicy.riskStrategies?.[tierId] ?? null;
    const requestedStrategy = commandPolicy.requestedRiskStrategies?.[tierId] ?? effectiveStrategy;
    const minimumStrategy =
      buildDefaultRuntimeRiskStrategies(commandPolicy.autoExecuteLowRisk)[tierId] ?? effectiveStrategy;
    const hook = resolveRuntimeAuthorizationHook(effectiveStrategy);
    return {
      tierId,
      strategy: effectiveStrategy,
      requestedStrategy,
      minimumStrategy,
      floorAdjusted: requestedStrategy !== effectiveStrategy,
      hook,
      hookSummary: summarizeRuntimeAuthorizationHook(effectiveStrategy),
    };
  });
  const riskPolicy = {
    summary:
      "命令执行至少要求显式确认；如果摘要未锁定，或命中密钥、身份、资产相关资源，则直接升到关键风险；外部网络至少按高风险处理，且仍要经过放行清单、URL 预算和 loopback 控制面请求头拦截。",
    tiers: riskPolicyTiers,
    floorAdjustmentCount: Array.isArray(commandPolicy.floorAdjustments) ? commandPolicy.floorAdjustments.length : 0,
    floorAdjustmentSummaries: Array.isArray(commandPolicy.floorAdjustments)
      ? commandPolicy.floorAdjustments.map(
          (entry) => `${entry.tier}:${entry.requestedStrategy}->${entry.effectiveStrategy}`
        )
      : [],
    capabilityFloors: [
      {
        capability: "process_exec",
        minimumRiskTier: "high",
        summary: "即使是已锁定摘要、且在放行清单内的命令，也至少按高风险处理；如果摘要未锁定或命中关键资源，则直接升到关键风险。",
      },
      {
        capability: "network_external",
        minimumRiskTier: "high",
        summary: "外部网络请求至少按高风险处理，而且还必须通过目标主机放行清单、URL 长度预算和 loopback 请求头拦截。",
      },
      {
        capability: "key_management_or_identity_change",
        minimumRiskTier: "critical",
        summary: "key_management / identity_change / asset_transfer 不应低于 critical。",
      },
    ],
  };
  const degradationReasons = normalizeTextList([
    ...warnings,
    ...(shellExecutionMisconfigured ? ["shell_execution_requested_but_not_effective"] : []),
    ...(externalNetworkMisconfigured ? ["external_network_requested_but_not_effective"] : []),
  ]);

  const status = securityPosture.executionLocked
    ? "locked"
    : !sandboxPolicy.brokerIsolationEnabled ||
        !sandboxPolicy.workerIsolationEnabled ||
        !sandboxPolicy.systemBrokerSandboxEnabled ||
        (systemBrokerSandboxRequested && !systemBrokerSandboxAvailable) ||
        shellExecutionMisconfigured ||
        externalNetworkMisconfigured
      ? "degraded"
      : allowShellExecution && unpinnedCommandCount > 0
        ? "degraded"
        : allowExternalNetwork || allowShellExecution
          ? "bounded"
          : "restricted";
  const capabilityTier = securityPosture.executionLocked
    ? "read_only_recovery"
    : allowShellExecution
      ? "allowlisted_exec"
      : allowExternalNetwork
        ? "bounded_network"
        : "read_mostly";

  return {
    status,
    capabilityTier,
    brokerIsolationEnabled: sandboxPolicy.brokerIsolationEnabled,
    systemBrokerSandboxRequested,
    systemBrokerSandboxEnabled,
    systemBrokerSandbox: {
      requested: systemBrokerSandboxRequested,
      available: systemBrokerSandboxAvailable,
      enabled: systemBrokerSandboxEnabled,
      backend: systemBrokerSandboxEnabled ? "sandbox_exec" : "broker_only",
      status: systemBrokerSandboxEnabled
        ? "enforced"
        : !sandboxPolicy.systemBrokerSandboxEnabled
          ? "disabled"
          : "unavailable",
      summary: systemBrokerSandboxEnabled
        ? "调度层与执行层会优先运行在 macOS seatbelt 规则下。"
        : !sandboxPolicy.systemBrokerSandboxEnabled
          ? "调度层仍隔离为独立进程，但未额外启用系统级沙箱。"
          : "当前平台或环境不可用系统级沙箱，已回退到进程隔离。",
    },
    brokerRuntime,
    workerIsolationEnabled: sandboxPolicy.workerIsolationEnabled,
    workerRuntime,
    isolationGuarantees,
    localNetworkOnly,
    blockedReasons,
    warnings,
    allowShellExecutionRequested,
    allowShellExecution,
    allowExternalNetworkRequested,
    allowExternalNetwork,
    capabilityAllowlistConfigured: Boolean(sandboxPolicy.capabilityAllowlistConfigured),
    networkAllowlistConfigured: Boolean(sandboxPolicy.networkAllowlistConfigured),
    commandAllowlistConfigured: Boolean(sandboxPolicy.commandAllowlistConfigured),
    allowedCapabilityCount: Array.isArray(sandboxPolicy.allowedCapabilities)
      ? sandboxPolicy.allowedCapabilities.length
      : 0,
    blockedCapabilityCount: Array.isArray(sandboxPolicy.blockedCapabilities)
      ? sandboxPolicy.blockedCapabilities.length
      : 0,
    allowlistedCommandCount: parsedAllowedCommands.length,
    pinnedCommandCount,
    unpinnedCommandCount,
    filesystemRootCount: Array.isArray(sandboxPolicy.filesystemAllowlist)
      ? sandboxPolicy.filesystemAllowlist.length
      : 0,
    networkAllowlistCount: networkAllowlist.length,
    requireAbsoluteProcessCommand: sandboxPolicy.requireAbsoluteProcessCommand,
    degradationReasons,
    commandPolicy: {
      negotiationMode: commandPolicy.negotiationMode,
      requireExplicitConfirmation: commandPolicy.requireExplicitConfirmation,
      riskStrategies: cloneJson(commandPolicy.riskStrategies) ?? {},
      requestedRiskStrategies: cloneJson(commandPolicy.requestedRiskStrategies) ?? {},
      floorAdjustments: cloneJson(commandPolicy.floorAdjustments) ?? [],
      summary:
        commandPolicy.summary ||
        (commandPolicy.riskStrategies.critical === "multisig"
          ? "critical 命令至少要求 multisig；high 不低于 confirm；medium 不低于 discuss。"
          : "命令协商策略低于安全下限。"),
    },
    riskPolicy,
    budgets: {
      maxReadBytes: sandboxPolicy.maxReadBytes,
      maxListEntries: sandboxPolicy.maxListEntries,
      maxNetworkBytes: sandboxPolicy.maxNetworkBytes,
      maxProcessArgs: sandboxPolicy.maxProcessArgs,
      maxProcessArgBytes: sandboxPolicy.maxProcessArgBytes,
      maxProcessInputBytes: sandboxPolicy.maxProcessInputBytes,
      maxProcessOutputBytes: sandboxPolicy.maxProcessOutputBytes,
      workerTimeoutMs: sandboxPolicy.workerTimeoutMs,
      maxUrlLength: sandboxPolicy.maxUrlLength,
    },
    summary: securityPosture.executionLocked
      ? `当前安全姿态 ${securityPosture.mode} 已锁住执行，只保留受控读取和恢复入口。`
      : status === "restricted"
        ? "受限执行层处于最小权限模式：调度层与执行层双层隔离、系统级调度沙箱、生效预算、默认不开命令执行、默认不开外网。"
        : status === "bounded"
          ? "受限执行层允许有限能力放行，但仍保留调度层与执行层边界、系统级调度沙箱、放行清单、预算和临时 HOME/TMP 隔离。"
          : "受限执行层已退化，存在需要收紧的执行、系统级沙箱或网络放行面。",
  };
}

export function buildDefaultDeviceRuntime() {
  const machineId = createMachineId();
  return {
    deviceRuntimeId: "device_runtime_local",
    machineId,
    machineLabel: machineId,
    residentAgentId: null,
    residentDidMethod: "agentpassport",
    residentLocked: true,
    localMode: DEFAULT_DEVICE_LOCAL_MODE,
    allowOnlineReasoner: false,
    commandPolicy: normalizeRuntimeCommandPolicy({
      negotiationMode: DEFAULT_DEVICE_NEGOTIATION_MODE,
      autoExecuteLowRisk: false,
      requireExplicitConfirmation: true,
    }),
    securityPosture: normalizeDeviceSecurityPosture(),
    retrievalPolicy: normalizeRuntimeRetrievalPolicy({
      allowVectorIndex: false,
      maxHits: DEFAULT_RUNTIME_SEARCH_LIMIT,
    }),
    setupPolicy: normalizeDeviceSetupPolicy(),
    localReasoner: normalizeRuntimeLocalReasonerConfig({
      timeoutMs: DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
    }),
    sandboxPolicy: normalizeRuntimeSandboxPolicy(),
    updatedAt: now(),
    updatedByAgentId: null,
    updatedByWindowId: null,
    sourceWindowId: null,
  };
}

export function normalizeDeviceRuntime(value = {}) {
  const base = buildDefaultDeviceRuntime();
  const raw = value && typeof value === "object" ? value : {};
  const merged = { ...base, ...raw };
  const rawLocalReasoner =
    raw.localReasoner && typeof raw.localReasoner === "object" ? raw.localReasoner : null;
  const rawHas = (key) => Object.prototype.hasOwnProperty.call(raw, key);
  const rawLocalReasonerHas = (key) =>
    Boolean(rawLocalReasoner) && Object.prototype.hasOwnProperty.call(rawLocalReasoner, key);
  const resolveLocalReasonerField = (topLevelKey, nestedKey, fallback) => {
    if (rawHas(topLevelKey)) {
      return raw[topLevelKey];
    }
    if (rawLocalReasonerHas(nestedKey)) {
      return rawLocalReasoner[nestedKey];
    }
    return fallback;
  };
  return {
    deviceRuntimeId: normalizeOptionalText(merged.deviceRuntimeId) ?? base.deviceRuntimeId,
    machineId: normalizeOptionalText(merged.machineId) ?? base.machineId,
    machineLabel: normalizeOptionalText(merged.machineLabel) ?? normalizeOptionalText(merged.machineId) ?? base.machineLabel,
    residentAgentId: normalizeOptionalText(merged.residentAgentId) ?? null,
    residentDidMethod: normalizeDidMethod(merged.residentDidMethod) || "agentpassport",
    residentLocked: normalizeBooleanFlag(merged.residentLocked, true),
    localMode: normalizeDeviceLocalMode(merged.localMode),
    allowOnlineReasoner: normalizeBooleanFlag(merged.allowOnlineReasoner, false),
    commandPolicy: normalizeRuntimeCommandPolicy({
      ...(merged.commandPolicy || {}),
      negotiationMode: merged.negotiationMode ?? merged.commandPolicy?.negotiationMode,
      autoExecuteLowRisk: merged.autoExecuteLowRisk ?? merged.commandPolicy?.autoExecuteLowRisk,
      requireExplicitConfirmation:
        merged.requireExplicitConfirmation ?? merged.commandPolicy?.requireExplicitConfirmation,
      lowRiskStrategy: merged.lowRiskStrategy ?? merged.commandPolicy?.lowRiskStrategy,
      mediumRiskStrategy: merged.mediumRiskStrategy ?? merged.commandPolicy?.mediumRiskStrategy,
      highRiskStrategy: merged.highRiskStrategy ?? merged.commandPolicy?.highRiskStrategy,
      criticalRiskStrategy: merged.criticalRiskStrategy ?? merged.commandPolicy?.criticalRiskStrategy,
      riskStrategies: merged.riskStrategies ?? merged.commandPolicy?.riskStrategies,
      lowRiskActionKeywords: merged.lowRiskActionKeywords ?? merged.commandPolicy?.lowRiskActionKeywords,
      highRiskActionKeywords: merged.highRiskActionKeywords ?? merged.commandPolicy?.highRiskActionKeywords,
      criticalRiskActionKeywords:
        merged.criticalRiskActionKeywords ?? merged.commandPolicy?.criticalRiskActionKeywords,
    }),
    securityPosture: normalizeDeviceSecurityPosture({
      ...(merged.securityPosture || {}),
      mode: merged.securityPostureMode ?? merged.securityPosture?.mode,
      reason: merged.securityPostureReason ?? merged.securityPosture?.reason,
      note: merged.securityPostureNote ?? merged.securityPosture?.note,
      updatedAt: merged.securityPostureUpdatedAt ?? merged.securityPosture?.updatedAt,
      updatedByAgentId:
        merged.securityPostureUpdatedByAgentId ?? merged.securityPosture?.updatedByAgentId,
      updatedByWindowId:
        merged.securityPostureUpdatedByWindowId ?? merged.securityPosture?.updatedByWindowId,
      sourceWindowId:
        merged.securityPostureSourceWindowId ?? merged.securityPosture?.sourceWindowId,
    }),
    retrievalPolicy: normalizeRuntimeRetrievalPolicy({
      ...(merged.retrievalPolicy || {}),
      strategy: merged.retrievalStrategy ?? merged.retrievalPolicy?.strategy,
      scorer: merged.retrievalScorer ?? merged.retrievalPolicy?.scorer,
      allowVectorIndex: merged.allowVectorIndex ?? merged.retrievalPolicy?.allowVectorIndex,
      maxHits: merged.retrievalMaxHits ?? merged.retrievalPolicy?.maxHits,
      preferStructuredMemory:
        merged.preferStructuredMemory ?? merged.retrievalPolicy?.preferStructuredMemory,
      preferConversationMinutes:
        merged.preferConversationMinutes ?? merged.retrievalPolicy?.preferConversationMinutes,
      preferCompactBoundaries:
        merged.preferCompactBoundaries ?? merged.retrievalPolicy?.preferCompactBoundaries,
      externalColdMemoryEnabled:
        merged.externalColdMemoryEnabled ?? merged.retrievalPolicy?.externalColdMemory?.enabled,
      externalColdMemoryProvider:
        merged.externalColdMemoryProvider ?? merged.retrievalPolicy?.externalColdMemory?.provider,
      externalColdMemoryMaxHits:
        merged.externalColdMemoryMaxHits ?? merged.retrievalPolicy?.externalColdMemory?.maxHits,
      externalColdMemoryTimeoutMs:
        merged.externalColdMemoryTimeoutMs ?? merged.retrievalPolicy?.externalColdMemory?.timeoutMs,
      mempalaceCommand:
        merged.mempalaceCommand ?? merged.retrievalPolicy?.externalColdMemory?.command,
      mempalacePalacePath:
        merged.mempalacePalacePath ?? merged.retrievalPolicy?.externalColdMemory?.palacePath,
      mempalaceWing:
        merged.mempalaceWing ?? merged.retrievalPolicy?.externalColdMemory?.wing,
      mempalaceRoom:
        merged.mempalaceRoom ?? merged.retrievalPolicy?.externalColdMemory?.room,
    }),
    setupPolicy: normalizeDeviceSetupPolicy({
      ...(merged.setupPolicy || {}),
      requireRecoveryBundle:
        merged.requireRecoveryBundle ?? merged.setupPolicy?.requireRecoveryBundle,
      requireSetupPackage:
        merged.requireSetupPackage ?? merged.setupPolicy?.requireSetupPackage,
      requireRecentRecoveryRehearsal:
        merged.requireRecentRecoveryRehearsal ??
        merged.setupPolicy?.requireRecentRecoveryRehearsal,
      recoveryRehearsalMaxAgeHours:
        merged.recoveryRehearsalMaxAgeHours ??
        merged.setupPolicy?.recoveryRehearsalMaxAgeHours,
      requireKeychainWhenAvailable:
        merged.requireKeychainWhenAvailable ??
        merged.requireSystemKeyIsolationWhenAvailable ??
        merged.setupPolicy?.requireKeychainWhenAvailable ??
        merged.setupPolicy?.requireSystemKeyIsolationWhenAvailable,
    }),
    localReasoner: normalizeRuntimeLocalReasonerConfig({
      ...(merged.localReasoner || {}),
      enabled: resolveLocalReasonerField("localReasonerEnabled", "enabled", merged.localReasoner?.enabled),
      provider: resolveLocalReasonerField("localReasonerProvider", "provider", merged.localReasoner?.provider),
      command: resolveLocalReasonerField("localReasonerCommand", "command", merged.localReasoner?.command),
      args: resolveLocalReasonerField("localReasonerArgs", "args", merged.localReasoner?.args),
      cwd: resolveLocalReasonerField("localReasonerCwd", "cwd", merged.localReasoner?.cwd),
      baseUrl: resolveLocalReasonerField("localReasonerBaseUrl", "baseUrl", merged.localReasoner?.baseUrl),
      path: resolveLocalReasonerField("localReasonerPath", "path", merged.localReasoner?.path),
      timeoutMs: resolveLocalReasonerField(
        "localReasonerTimeoutMs",
        "timeoutMs",
        merged.localReasoner?.timeoutMs
      ),
      maxOutputBytes: resolveLocalReasonerField(
        "localReasonerMaxOutputBytes",
        "maxOutputBytes",
        merged.localReasoner?.maxOutputBytes
      ),
      maxInputBytes: resolveLocalReasonerField(
        "localReasonerMaxInputBytes",
        "maxInputBytes",
        merged.localReasoner?.maxInputBytes
      ),
      format: resolveLocalReasonerField("localReasonerFormat", "format", merged.localReasoner?.format),
      model: resolveLocalReasonerField("localReasonerModel", "model", merged.localReasoner?.model),
      selection: resolveLocalReasonerField(
        "localReasonerSelection",
        "selection",
        merged.localReasoner?.selection
      ),
      lastProbe: resolveLocalReasonerField(
        "localReasonerLastProbe",
        "lastProbe",
        merged.localReasoner?.lastProbe
      ),
      lastWarm: resolveLocalReasonerField(
        "localReasonerLastWarm",
        "lastWarm",
        merged.localReasoner?.lastWarm
      ),
    }),
    sandboxPolicy: normalizeRuntimeSandboxPolicy({
      ...(merged.sandboxPolicy || {}),
      allowShellExecution: merged.allowShellExecution ?? merged.sandboxPolicy?.allowShellExecution,
      allowExternalNetwork: merged.allowExternalNetwork ?? merged.sandboxPolicy?.allowExternalNetwork,
      allowedCapabilities: merged.allowedCapabilities ?? merged.sandboxPolicy?.allowedCapabilities,
      filesystemAllowlist: merged.filesystemAllowlist ?? merged.sandboxPolicy?.filesystemAllowlist,
      networkAllowlist: merged.networkAllowlist ?? merged.sandboxPolicy?.networkAllowlist,
      blockedCapabilities: merged.blockedCapabilities ?? merged.sandboxPolicy?.blockedCapabilities,
      allowedCommands: merged.allowedCommands ?? merged.sandboxPolicy?.allowedCommands,
      maxReadBytes: merged.maxReadBytes ?? merged.sandboxPolicy?.maxReadBytes,
      maxListEntries: merged.maxListEntries ?? merged.sandboxPolicy?.maxListEntries,
      brokerIsolationEnabled: merged.brokerIsolationEnabled ?? merged.sandboxPolicy?.brokerIsolationEnabled,
      systemBrokerSandboxEnabled:
        merged.systemBrokerSandboxEnabled ?? merged.sandboxPolicy?.systemBrokerSandboxEnabled,
      workerIsolationEnabled: merged.workerIsolationEnabled ?? merged.sandboxPolicy?.workerIsolationEnabled,
      workerTimeoutMs: merged.workerTimeoutMs ?? merged.sandboxPolicy?.workerTimeoutMs,
      maxNetworkBytes: merged.maxNetworkBytes ?? merged.sandboxPolicy?.maxNetworkBytes,
      maxProcessOutputBytes: merged.maxProcessOutputBytes ?? merged.sandboxPolicy?.maxProcessOutputBytes,
      maxProcessArgs: merged.maxProcessArgs ?? merged.sandboxPolicy?.maxProcessArgs,
      maxProcessArgBytes: merged.maxProcessArgBytes ?? merged.sandboxPolicy?.maxProcessArgBytes,
      maxProcessInputBytes: merged.maxProcessInputBytes ?? merged.sandboxPolicy?.maxProcessInputBytes,
      maxUrlLength: merged.maxUrlLength ?? merged.sandboxPolicy?.maxUrlLength,
      requireAbsoluteProcessCommand:
        merged.requireAbsoluteProcessCommand ?? merged.sandboxPolicy?.requireAbsoluteProcessCommand,
    }),
    updatedAt: normalizeOptionalText(merged.updatedAt) ?? now(),
    updatedByAgentId: normalizeOptionalText(merged.updatedByAgentId) ?? null,
    updatedByWindowId: normalizeOptionalText(merged.updatedByWindowId) ?? null,
    sourceWindowId: normalizeOptionalText(merged.sourceWindowId) ?? null,
  };
}

export function buildDeviceRuntimeView(deviceRuntime, store = null) {
  const normalized = normalizeDeviceRuntime(deviceRuntime);
  const activeLocalReasonerProvider = resolveDisplayedRuntimeLocalReasonerProvider(normalized.localReasoner);
  const securityPosture = buildDeviceSecurityPostureState(normalized);
  const constrainedExecutionSummary = buildConstrainedExecutionSummary(normalized);
  const residentAgent = normalized.residentAgentId && store ? store.agents?.[normalized.residentAgentId] ?? null : null;
  const sandboxPolicy = normalized.sandboxPolicy && typeof normalized.sandboxPolicy === "object"
    ? normalized.sandboxPolicy
    : {};
  const allowedCommands = Array.isArray(sandboxPolicy.allowedCommands) ? sandboxPolicy.allowedCommands : [];
  const pinnedCommandCount = allowedCommands.reduce((count, entry) => {
    const parsed = parseSandboxAllowlistedCommandEntry(entry);
    return count + (parsed?.digest ? 1 : 0);
  }, 0);
  const sandboxPolicyView = {
    ...cloneJson(sandboxPolicy),
    allowedCommandsPinnedCount: pinnedCommandCount,
  };
  return {
    ...cloneJson(normalized),
    securityPosture,
    localReasoner: {
      ...cloneJson(normalized.localReasoner),
      activeProvider: activeLocalReasonerProvider,
      providerMismatch: activeLocalReasonerProvider !== normalized.localReasoner.provider,
      configured: isRuntimeLocalReasonerConfigured(normalized.localReasoner),
    },
    sandboxPolicy: sandboxPolicyView,
    constrainedExecutionPolicy: cloneJson(sandboxPolicyView),
    constrainedExecutionSummary,
    residentAgent: residentAgent
      ? {
          agentId: residentAgent.agentId,
          displayName: residentAgent.displayName,
          role: residentAgent.role,
          did: residentAgent.identity?.did ?? null,
          walletAddress: residentAgent.identity?.walletAddress ?? null,
        }
      : null,
  };
}

export function summarizeLocalReasonerDiagnostics(diagnostics = null) {
  if (!diagnostics || typeof diagnostics !== "object") {
    return null;
  }
  const provider = normalizeOptionalText(diagnostics.provider) ?? null;
  const model = normalizeOptionalText(diagnostics.model) ?? null;

  return {
    checkedAt: normalizeOptionalText(diagnostics.checkedAt) ?? null,
    provider,
    enabled: normalizeBooleanFlag(diagnostics.enabled, false),
    configured: normalizeBooleanFlag(diagnostics.configured, false),
    reachable: normalizeBooleanFlag(diagnostics.reachable, false),
    status: normalizeOptionalText(diagnostics.status) ?? null,
    model: provider === "ollama_local" ? displayOpenNeedReasonerModel(model, null) : model,
    modelCount: Number(diagnostics.modelCount || 0),
    selectedModelPresent: normalizeBooleanFlag(diagnostics.selectedModelPresent, false),
    commandRealpath: normalizeOptionalText(diagnostics.commandRealpath) ?? null,
    commandExists: normalizeBooleanFlag(diagnostics.commandExists, false),
    cwdExists: normalizeBooleanFlag(diagnostics.cwdExists, false),
    error: normalizeOptionalText(diagnostics.error) ?? null,
  };
}

export function buildLocalReasonerSelectionState(localReasoner, payload = {}) {
  const normalized = normalizeRuntimeLocalReasonerConfig(localReasoner);
  return normalizeRuntimeLocalReasonerSelectionState({
    selectedAt: now(),
    provider: normalized.provider,
    model: normalized.model,
    selectedByAgentId:
      normalizeOptionalText(payload.updatedByAgentId) ??
      normalizeOptionalText(payload.selectedByAgentId) ??
      null,
    selectedByWindowId:
      normalizeOptionalText(payload.updatedByWindowId) ??
      normalizeOptionalText(payload.selectedByWindowId) ??
      null,
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId) ?? null,
  });
}

export function buildLocalReasonerProbeState(diagnostics = null) {
  const summary = summarizeLocalReasonerDiagnostics(diagnostics);
  if (!summary?.checkedAt) {
    return null;
  }
  return normalizeRuntimeLocalReasonerProbeState(summary);
}

export function buildLocalReasonerWarmState({ localReasoner = null, diagnostics = null, candidate = null, error = null } = {}) {
  const normalized = normalizeRuntimeLocalReasonerConfig(localReasoner);
  const summary = summarizeLocalReasonerDiagnostics(diagnostics);
  const responseText =
    normalizeOptionalText(candidate?.responseText) ??
    normalizeOptionalText(candidate?.candidateResponse) ??
    null;
  const metadata = candidate?.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {};
  return normalizeRuntimeLocalReasonerWarmState({
    warmedAt: now(),
    provider: normalized.provider,
    model: normalizeOptionalText(summary?.model) ?? normalized.model,
    reachable: normalizeBooleanFlag(summary?.reachable, false),
    status: error
      ? "failed"
      : responseText
        ? "ready"
        : summary?.reachable
          ? "empty"
          : summary?.status || "unreachable",
    error: normalizeOptionalText(error?.message || error) ?? normalizeOptionalText(summary?.error) ?? null,
    responsePreview: responseText ? responseText.slice(0, 240) : null,
    responseBytes: responseText ? Buffer.byteLength(responseText, "utf8") : 0,
    executionBackend: normalizeOptionalText(metadata.executionBackend) ?? null,
  });
}

export async function inspectRuntimeLocalReasoner(localReasonerConfig = {}) {
  const localReasoner = normalizeRuntimeLocalReasonerConfig(localReasonerConfig);
  const checkedAt = now();

  if (!localReasoner.enabled) {
    return {
      checkedAt,
      provider: localReasoner.provider,
      enabled: false,
      configured: false,
      reachable: false,
      status: "disabled",
      error: null,
    };
  }

  if (localReasoner.provider === "local_mock") {
    return {
      checkedAt,
      provider: "local_mock",
      enabled: true,
      configured: true,
      reachable: true,
      status: "ready",
      model: localReasoner.model,
      modelCount: localReasoner.model ? 1 : 0,
      selectedModelPresent: Boolean(localReasoner.model),
      error: null,
    };
  }

  if (localReasoner.provider === "local_command") {
    const commandPath = normalizeOptionalText(localReasoner.command) ?? null;
    const cwd = normalizeOptionalText(localReasoner.cwd) ?? null;
    const result = {
      checkedAt,
      provider: "local_command",
      enabled: true,
      configured: isRuntimeLocalReasonerConfigured(localReasoner),
      reachable: false,
      status: "unconfigured",
      command: commandPath,
      commandRealpath: null,
      commandExists: false,
      cwd,
      cwdExists: cwd ? false : true,
      scriptPath: null,
      scriptExists: null,
      error: null,
    };

    if (!commandPath) {
      result.error = "local reasoner command is missing";
      return result;
    }

    try {
      result.commandRealpath = await realpath(commandPath);
      const commandStat = await stat(result.commandRealpath);
      result.commandExists = commandStat.isFile();
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }

    if (cwd) {
      try {
        const cwdRealpath = await realpath(cwd);
        const cwdStat = await stat(cwdRealpath);
        result.cwdExists = cwdStat.isDirectory();
      } catch (error) {
        result.cwdExists = false;
        result.error = error instanceof Error ? error.message : String(error);
        return result;
      }
    }

    const firstArg =
      Array.isArray(localReasoner.args) && localReasoner.args.length
        ? normalizeOptionalText(localReasoner.args[0])
        : null;
    if (firstArg && (firstArg.startsWith("/") || firstArg.startsWith(".") || firstArg.includes(path.sep))) {
      const candidatePath = path.isAbsolute(firstArg)
        ? firstArg
        : path.resolve(cwd || path.join(__dirname, ".."), firstArg);
      result.scriptPath = candidatePath;
      try {
        const scriptRealpath = await realpath(candidatePath);
        const scriptStat = await stat(scriptRealpath);
        result.scriptExists = scriptStat.isFile();
      } catch {
        result.scriptExists = false;
      }
    }

    result.reachable = Boolean(
      result.commandExists &&
      result.cwdExists &&
      (result.scriptExists == null || result.scriptExists === true)
    );
    result.status = result.reachable ? "ready" : "partial";
    return result;
  }

  if (localReasoner.provider === "ollama_local") {
    const baseUrl = normalizeOptionalText(localReasoner.baseUrl) ?? "http://127.0.0.1:11434";
    const model = normalizeOptionalText(localReasoner.model) ?? null;
    const actualModel = resolveOpenNeedReasonerModel(model, null);
    const result = {
      checkedAt,
      provider: "ollama_local",
      enabled: true,
      configured: isRuntimeLocalReasonerConfigured(localReasoner),
      reachable: false,
      status: "unconfigured",
      baseUrl,
      model,
      modelCount: 0,
      models: [],
      selectedModelPresent: false,
      error: null,
    };

    if (!baseUrl) {
      result.error = "ollama_local requires baseUrl";
      return result;
    }

    const controller = new AbortController();
    const probeTimeoutMs = Math.max(
      500,
      Math.min(
        Math.floor(localReasoner.timeoutMs || DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS),
        5000
      )
    );
    const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
    try {
      const response = await fetch(new URL("/api/tags", baseUrl).toString(), {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        result.error = `ollama /api/tags returned HTTP ${response.status}`;
        result.status = "offline";
        return result;
      }
      const data = await response.json();
      const models = Array.isArray(data?.models)
        ? data.models
            .map((entry) => normalizeOptionalText(entry?.name || entry?.model))
            .filter(Boolean)
        : [];
      result.models = models.map((entry) => displayOpenNeedReasonerModel(entry, entry));
      result.modelCount = models.length;
      result.selectedModelPresent = actualModel ? models.includes(actualModel) : false;
      result.reachable = true;
      result.status = actualModel ? (result.selectedModelPresent ? "ready" : "model_missing") : "model_unselected";
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.status = "offline";
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    checkedAt,
    provider: localReasoner.provider,
    enabled: true,
    configured: isRuntimeLocalReasonerConfigured(localReasoner),
    reachable: false,
    status: "unsupported_provider",
    error: `Unsupported local reasoner provider: ${localReasoner.provider}`,
  };
}

// 属性：兼容。
// OpenNeed 在当前仓库只表示 app / bridge / legacy compatibility，不拥有底层模型或连续身份本体。

export const OPENNEED_COMPAT_BOUNDARY = "app_bridge_compat_only";
export const OPENNEED_COMPAT_LAYER = "app_bridge_compat";

export const OPENNEED_COMPAT_MAIN_AGENT_ID = "agent_openneed_agents";
export const LEGACY_OPENNEED_AGENT_ID = OPENNEED_COMPAT_MAIN_AGENT_ID;
export const OPENNEED_COMPAT_DID_METHOD = "openneed";
export const OPENNEED_COMPAT_TYPE_PREFIX = "OpenNeed";

export const LEGACY_OPENNEED_REASONER_BRAND = "OpenNeed";
export const LEGACY_OPENNEED_MEMORY_ENGINE_NAME = "OpenNeed 记忆稳态引擎";
export const LEGACY_OPENNEED_REASONER_MODEL = ["gemma4", "e4b"].join(":");
export const LEGACY_OPENNEED_ADMIN_TOKEN_HEADER = "x-openneed-admin-token";

export const OPENNEED_COMPAT_APP_TITLES = Object.freeze({
  mainConsole: "openneed",
  offlineChat: "openneed 离线聊天",
  lab: "openneed 高级工具页",
  repairHub: "openneed 修复中心",
});

export const OPENNEED_COMPAT_THREAD_PROTOCOL_ALIASES = Object.freeze({
  openneed_system_autonomy: "agent_passport_runtime",
});

export const OPENNEED_COMPAT_ENV = Object.freeze({
  ledgerPath: Object.freeze(["OPENNEED_LEDGER_PATH"]),
  chainId: Object.freeze(["OPENNEED_CHAIN_ID"]),
  localModelAssetsDir: Object.freeze(["OPENNEED_LOCAL_MODEL_ASSETS_DIR"]),
  localReasonerBaseUrl: Object.freeze(["OPENNEED_LOCAL_GEMMA_BASE_URL", "OPENNEED_LOCAL_LLM_BASE_URL"]),
  localReasonerModel: Object.freeze(["OPENNEED_LOCAL_GEMMA_MODEL", "OPENNEED_LOCAL_LLM_MODEL"]),
  localReasonerPath: Object.freeze(["OPENNEED_LOCAL_LLM_PATH"]),
  localReasonerTimeoutMs: Object.freeze(["OPENNEED_LOCAL_LLM_TIMEOUT_MS"]),
  offlineChatMaxConcurrency: Object.freeze(["OPENNEED_OFFLINE_CHAT_MAX_CONCURRENCY"]),
  offlineChatPersonaReadyConcurrency: Object.freeze(["OPENNEED_OFFLINE_CHAT_PERSONA_READY_CONCURRENCY"]),
  offlineChatBootstrapTtlMs: Object.freeze(["OPENNEED_OFFLINE_CHAT_BOOTSTRAP_TTL_MS"]),
  offlineSyncEndpointCacheTtlMs: Object.freeze(["OPENNEED_OFFLINE_SYNC_ENDPOINT_CACHE_TTL_MS"]),
  offlineSharedMemoryRuntimeCacheTtlMs: Object.freeze(["OPENNEED_OFFLINE_SHARED_MEMORY_RUNTIME_CACHE_TTL_MS"]),
});

export const OPENNEED_COMPAT_BROWSER_STORAGE_KEYS = Object.freeze({
  adminTokenSession: "openneed-runtime.admin-token-session",
  adminTokenLocal: "openneed-agent-passport.admin-token",
  runtimeHousekeepingLastReportSession: "openneed-runtime.runtime-housekeeping-last-report-session",
  runtimeHousekeepingLastReportLocal: "openneed-agent-passport.runtime-housekeeping-last-report",
});

export const OPENNEED_COMPAT_MANIFEST = Object.freeze({
  boundary: OPENNEED_COMPAT_BOUNDARY,
  layer: OPENNEED_COMPAT_LAYER,
  mainAgentId: OPENNEED_COMPAT_MAIN_AGENT_ID,
  didMethod: OPENNEED_COMPAT_DID_METHOD,
  typePrefix: OPENNEED_COMPAT_TYPE_PREFIX,
  reasonerBrand: LEGACY_OPENNEED_REASONER_BRAND,
  memoryEngineName: LEGACY_OPENNEED_MEMORY_ENGINE_NAME,
  reasonerModel: LEGACY_OPENNEED_REASONER_MODEL,
  appTitles: OPENNEED_COMPAT_APP_TITLES,
  threadProtocolAliases: OPENNEED_COMPAT_THREAD_PROTOCOL_ALIASES,
  env: OPENNEED_COMPAT_ENV,
  browserStorageKeys: OPENNEED_COMPAT_BROWSER_STORAGE_KEYS,
});

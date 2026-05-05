import { normalizeOptionalText } from "./ledger-core-utils.js";
import {
  MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL,
  resolveMemoryEngineLocalModel,
} from "./memory-engine-branding.js";
import { inspectMemoryStabilityLocalModelAsset } from "./local-model-assets/registry.js";
import { OPENNEED_COMPAT_THREAD_PROTOCOL_ALIASES } from "./openneed-compat-manifest.js";

// 属性：桥接。
// 这里负责把离线聊天运行时仍需承接的历史 env / protocol alias 收口到单独边界层，
// 让 runtime 本体只消费 canonical 配置。

export const OFFLINE_THREAD_PROTOCOL_LOCAL_REASONING_STACK = "thread_protocol_runtime";

const LEGACY_THREAD_PROTOCOL_KEY_ALIASES = OPENNEED_COMPAT_THREAD_PROTOCOL_ALIASES;

function text(value) {
  return normalizeOptionalText(value) ?? "";
}

function readFirstEnvText(env, keys) {
  for (const key of keys) {
    const value = normalizeOptionalText(env?.[key]);
    if (value != null) {
      return String(value);
    }
  }
  return null;
}

function readFirstFiniteEnvNumber(env, keys) {
  for (const key of keys) {
    const raw = env?.[key];
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

export function createOfflineChatRuntimeCompatSnapshot(env = process.env) {
  const configuredModel = resolveMemoryEngineLocalModel(
    readFirstEnvText(env, [
      "MEMORY_STABILITY_OLLAMA_MODEL",
      "MEMORY_STABILITY_LOCAL_LLM_MODEL",
      "AGENT_PASSPORT_OLLAMA_MODEL",
      "AGENT_PASSPORT_LLM_MODEL",
      "OPENNEED_LOCAL_LLM_MODEL",
      "OPENNEED_LOCAL_GEMMA_MODEL",
    ]) || MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL
  );
  const timeoutMs =
    readFirstFiniteEnvNumber(env, [
      "MEMORY_STABILITY_OLLAMA_TIMEOUT_MS",
      "MEMORY_STABILITY_LOCAL_LLM_TIMEOUT_MS",
      "AGENT_PASSPORT_OLLAMA_TIMEOUT_MS",
      "AGENT_PASSPORT_LLM_TIMEOUT_MS",
      "OPENNEED_LOCAL_LLM_TIMEOUT_MS",
    ]) ?? 18000;
  const maxConcurrencyRaw = readFirstFiniteEnvNumber(env, [
    "AGENT_PASSPORT_OFFLINE_CHAT_MAX_CONCURRENCY",
    "OPENNEED_OFFLINE_CHAT_MAX_CONCURRENCY",
  ]);
  const personaReadyConcurrencyRaw = readFirstFiniteEnvNumber(env, [
    "AGENT_PASSPORT_OFFLINE_CHAT_PERSONA_READY_CONCURRENCY",
    "OPENNEED_OFFLINE_CHAT_PERSONA_READY_CONCURRENCY",
  ]);
  const bootstrapTtlRaw = readFirstFiniteEnvNumber(env, [
    "AGENT_PASSPORT_OFFLINE_CHAT_BOOTSTRAP_TTL_MS",
    "OPENNEED_OFFLINE_CHAT_BOOTSTRAP_TTL_MS",
  ]);
  const syncEndpointCacheTtlRaw = readFirstFiniteEnvNumber(env, [
    "AGENT_PASSPORT_OFFLINE_SYNC_ENDPOINT_CACHE_TTL_MS",
    "OPENNEED_OFFLINE_SYNC_ENDPOINT_CACHE_TTL_MS",
  ]);
  const sharedMemoryRuntimeCacheTtlRaw = readFirstFiniteEnvNumber(env, [
    "AGENT_PASSPORT_OFFLINE_SHARED_MEMORY_RUNTIME_CACHE_TTL_MS",
    "OPENNEED_OFFLINE_SHARED_MEMORY_RUNTIME_CACHE_TTL_MS",
  ]);

  const maxConcurrency = Math.max(
    1,
    Number.isFinite(maxConcurrencyRaw)
      ? Math.floor(maxConcurrencyRaw)
      : 6
  );

  return Object.freeze({
    defaultLocalReasoner: Object.freeze({
      enabled: true,
      provider: "ollama_local",
      baseUrl:
        readFirstEnvText(env, [
          "MEMORY_STABILITY_OLLAMA_BASE_URL",
          "MEMORY_STABILITY_LOCAL_LLM_BASE_URL",
          "AGENT_PASSPORT_OLLAMA_BASE_URL",
          "AGENT_PASSPORT_LLM_BASE_URL",
          "OPENNEED_LOCAL_LLM_BASE_URL",
          "OPENNEED_LOCAL_GEMMA_BASE_URL",
        ]) || "http://127.0.0.1:11434",
      model: configuredModel,
      asset: Object.freeze(
        inspectMemoryStabilityLocalModelAsset({
          model: configuredModel,
          env,
        })
      ),
      timeoutMs,
    }),
    limits: Object.freeze({
      maxConcurrency,
      personaReadyConcurrency: Math.max(
        1,
        Number.isFinite(personaReadyConcurrencyRaw)
          ? Math.floor(personaReadyConcurrencyRaw)
          : Math.min(3, maxConcurrency)
      ),
      bootstrapTtlMs: Math.max(
        1000,
        Number.isFinite(bootstrapTtlRaw)
          ? Math.floor(bootstrapTtlRaw)
          : 30000
      ),
      syncEndpointCacheTtlMs: Math.max(
        1000,
        Number.isFinite(syncEndpointCacheTtlRaw)
          ? Math.floor(syncEndpointCacheTtlRaw)
          : 5000
      ),
      sharedMemoryRuntimeCacheTtlMs: Math.max(
        1000,
        Number.isFinite(sharedMemoryRuntimeCacheTtlRaw)
          ? Math.floor(sharedMemoryRuntimeCacheTtlRaw)
          : 5000
      ),
    }),
  });
}

const OFFLINE_CHAT_RUNTIME_COMPAT = createOfflineChatRuntimeCompatSnapshot();

export const DEFAULT_OFFLINE_CHAT_LOCAL_REASONER = OFFLINE_CHAT_RUNTIME_COMPAT.defaultLocalReasoner;
export const OFFLINE_CHAT_RUNTIME_LIMITS = OFFLINE_CHAT_RUNTIME_COMPAT.limits;

export function normalizeOfflineChatThreadProtocolKey(value) {
  const normalized = text(value);
  return LEGACY_THREAD_PROTOCOL_KEY_ALIASES[normalized] || normalized;
}

export function normalizeOfflineChatThreadProtocolModel(value) {
  const normalized = text(value);
  if (!normalized) {
    return null;
  }
  const [key, ...rest] = normalized.split(":");
  const canonicalKey = normalizeOfflineChatThreadProtocolKey(key);
  return [canonicalKey, ...rest].filter(Boolean).join(":") || null;
}

export function normalizeOfflineChatResponseModel(provider, model) {
  const normalized = text(model);
  if (!normalized) {
    return null;
  }
  return provider === OFFLINE_THREAD_PROTOCOL_LOCAL_REASONING_STACK
    ? normalizeOfflineChatThreadProtocolModel(normalized)
    : normalized;
}

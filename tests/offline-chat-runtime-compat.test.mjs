import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OFFLINE_CHAT_LOCAL_REASONER,
  OFFLINE_CHAT_RUNTIME_LIMITS,
  OFFLINE_THREAD_PROTOCOL_LOCAL_REASONING_STACK,
  createOfflineChatRuntimeCompatSnapshot,
  normalizeOfflineChatResponseModel,
  normalizeOfflineChatThreadProtocolKey,
  normalizeOfflineChatThreadProtocolModel,
} from "../src/offline-chat-runtime-compat.js";
import { MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL } from "../src/memory-engine-branding.js";

test("offline chat compat snapshot prefers memory-stability and agent-passport envs before legacy openneed aliases", () => {
  const snapshot = createOfflineChatRuntimeCompatSnapshot({
    MEMORY_STABILITY_OLLAMA_BASE_URL: "http://memory-stability.test:11434",
    MEMORY_STABILITY_OLLAMA_MODEL: "gemma4:e4b-q8_0",
    MEMORY_STABILITY_OLLAMA_TIMEOUT_MS: "9123",
    AGENT_PASSPORT_OFFLINE_CHAT_MAX_CONCURRENCY: "9",
    AGENT_PASSPORT_OFFLINE_CHAT_PERSONA_READY_CONCURRENCY: "4",
    AGENT_PASSPORT_OFFLINE_CHAT_BOOTSTRAP_TTL_MS: "45000",
    AGENT_PASSPORT_OFFLINE_SYNC_ENDPOINT_CACHE_TTL_MS: "8000",
    AGENT_PASSPORT_OFFLINE_SHARED_MEMORY_RUNTIME_CACHE_TTL_MS: "9000",
    OPENNEED_LOCAL_GEMMA_BASE_URL: "http://legacy-openneed.test:11434",
    OPENNEED_LOCAL_GEMMA_MODEL: "legacy-model",
    OPENNEED_LOCAL_LLM_TIMEOUT_MS: "1111",
    OPENNEED_OFFLINE_CHAT_MAX_CONCURRENCY: "2",
  });

  assert.equal(snapshot.defaultLocalReasoner.baseUrl, "http://memory-stability.test:11434");
  assert.equal(snapshot.defaultLocalReasoner.model, "gemma4:e4b-q8_0");
  assert.equal(snapshot.defaultLocalReasoner.timeoutMs, 9123);
  assert.equal(snapshot.limits.maxConcurrency, 9);
  assert.equal(snapshot.limits.personaReadyConcurrency, 4);
  assert.equal(snapshot.limits.bootstrapTtlMs, 45000);
  assert.equal(snapshot.limits.syncEndpointCacheTtlMs, 8000);
  assert.equal(snapshot.limits.sharedMemoryRuntimeCacheTtlMs, 9000);
});

test("offline chat compat snapshot keeps legacy openneed aliases alive only as fallback inputs", () => {
  const snapshot = createOfflineChatRuntimeCompatSnapshot({
    OPENNEED_LOCAL_GEMMA_BASE_URL: "http://legacy-openneed.test:11434",
    OPENNEED_LOCAL_GEMMA_MODEL: "gemma4:legacy",
    OPENNEED_LOCAL_LLM_TIMEOUT_MS: "7654",
    OPENNEED_OFFLINE_CHAT_MAX_CONCURRENCY: "5",
    OPENNEED_OFFLINE_CHAT_PERSONA_READY_CONCURRENCY: "6",
    OPENNEED_OFFLINE_CHAT_BOOTSTRAP_TTL_MS: "32000",
    OPENNEED_OFFLINE_SYNC_ENDPOINT_CACHE_TTL_MS: "7100",
    OPENNEED_OFFLINE_SHARED_MEMORY_RUNTIME_CACHE_TTL_MS: "6100",
  });

  assert.equal(snapshot.defaultLocalReasoner.baseUrl, "http://legacy-openneed.test:11434");
  assert.equal(snapshot.defaultLocalReasoner.model, "gemma4:legacy");
  assert.equal(snapshot.defaultLocalReasoner.timeoutMs, 7654);
  assert.equal(snapshot.limits.maxConcurrency, 5);
  assert.equal(snapshot.limits.personaReadyConcurrency, 6);
  assert.equal(snapshot.limits.bootstrapTtlMs, 32000);
  assert.equal(snapshot.limits.syncEndpointCacheTtlMs, 7100);
  assert.equal(snapshot.limits.sharedMemoryRuntimeCacheTtlMs, 6100);
});

test("offline chat compat module canonicalizes legacy protocol aliases at the boundary", () => {
  assert.equal(DEFAULT_OFFLINE_CHAT_LOCAL_REASONER.model, MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL);
  assert.equal(OFFLINE_CHAT_RUNTIME_LIMITS.maxConcurrency >= 1, true);
  assert.equal(normalizeOfflineChatThreadProtocolKey("openneed_system_autonomy"), "agent_passport_runtime");
  assert.equal(normalizeOfflineChatThreadProtocolModel("openneed_system_autonomy:v1"), "agent_passport_runtime:v1");
  assert.equal(
    normalizeOfflineChatResponseModel(OFFLINE_THREAD_PROTOCOL_LOCAL_REASONING_STACK, "openneed_system_autonomy:v1"),
    "agent_passport_runtime:v1"
  );
  assert.equal(
    normalizeOfflineChatResponseModel("ollama_local", "openneed_system_autonomy:v1"),
    "openneed_system_autonomy:v1"
  );
});

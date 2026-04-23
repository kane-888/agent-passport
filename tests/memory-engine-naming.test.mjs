import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_PASSPORT_LOCAL_REASONER_LABEL,
  AGENT_PASSPORT_MEMORY_ENGINE_LABEL,
  LEGACY_OPENNEED_MEMORY_ENGINE_NAME,
  LEGACY_OPENNEED_REASONER_BRAND,
  OPENNEED_LAB_TITLE,
  OPENNEED_MAIN_CONSOLE_TITLE,
  OPENNEED_OFFLINE_CHAT_TITLE,
  OPENNEED_REASONER_OLLAMA_MODEL,
  OPENNEED_REPAIR_HUB_TITLE,
  displayOpenNeedReasonerModel,
  resolveOpenNeedReasonerModel,
} from "../src/openneed-memory-engine.js";
import { SHARED_CANONICAL_MEMORIES } from "../src/offline-chat-shared-memory.js";
import { buildProtocolDescriptor } from "../src/protocol.js";

test("memory engine naming accepts legacy inputs but displays agent-passport", () => {
  assert.equal(resolveOpenNeedReasonerModel(LEGACY_OPENNEED_REASONER_BRAND), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(resolveOpenNeedReasonerModel(LEGACY_OPENNEED_MEMORY_ENGINE_NAME), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(resolveOpenNeedReasonerModel(AGENT_PASSPORT_LOCAL_REASONER_LABEL), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(resolveOpenNeedReasonerModel(AGENT_PASSPORT_MEMORY_ENGINE_LABEL), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(displayOpenNeedReasonerModel(LEGACY_OPENNEED_REASONER_BRAND), AGENT_PASSPORT_LOCAL_REASONER_LABEL);
  assert.equal(displayOpenNeedReasonerModel(OPENNEED_REASONER_OLLAMA_MODEL), AGENT_PASSPORT_LOCAL_REASONER_LABEL);
});

test("legacy title exports resolve to public agent-passport copy", () => {
  assert.equal(OPENNEED_MAIN_CONSOLE_TITLE, AGENT_PASSPORT_MEMORY_ENGINE_LABEL);
  assert.equal(OPENNEED_OFFLINE_CHAT_TITLE, `${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}离线聊天`);
  assert.equal(OPENNEED_LAB_TITLE, `${AGENT_PASSPORT_MEMORY_ENGINE_LABEL} 高级工具页`);
  assert.equal(OPENNEED_REPAIR_HUB_TITLE, `${AGENT_PASSPORT_MEMORY_ENGINE_LABEL} 修复中心`);
});

test("agent-readable positioning seeds do not promote legacy OpenNeed product copy", () => {
  const protocol = buildProtocolDescriptor();
  assert.match(protocol.productPositioning.oneLiner, /agent-passport/u);
  assert.doesNotMatch(protocol.productPositioning.oneLiner, /OpenNeed 记忆稳态引擎/u);

  const sharedMemoryText = SHARED_CANONICAL_MEMORIES.map((entry) => `${entry.title}\n${entry.content}`).join("\n");
  assert.match(sharedMemoryText, /agent-passport/u);
  assert.doesNotMatch(sharedMemoryText, /OpenNeed 记忆稳态引擎/u);
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function equalsIgnoreCase(left, right) {
  const normalizedLeft = text(left);
  const normalizedRight = text(right);
  return Boolean(normalizedLeft && normalizedRight) && normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
}

export const AGENT_PASSPORT_MEMORY_ENGINE_LABEL = "agent-passport 记忆稳态引擎";
export const AGENT_PASSPORT_LOCAL_REASONER_LABEL = "agent-passport 本地推理";
export const LEGACY_OPENNEED_MEMORY_ENGINE_NAME = "OpenNeed 记忆稳态引擎";
export const LEGACY_OPENNEED_REASONER_BRAND = "OpenNeed";
export const OPENNEED_MEMORY_ENGINE_NAME = AGENT_PASSPORT_MEMORY_ENGINE_LABEL;
export const OPENNEED_REASONER_BRAND = LEGACY_OPENNEED_REASONER_BRAND;
const OPENNEED_REASONER_OLLAMA_MODEL_PARTS = ["gemma4", "e4b"];
export const OPENNEED_REASONER_OLLAMA_MODEL = OPENNEED_REASONER_OLLAMA_MODEL_PARTS.join(":");
export const OPENNEED_MAIN_CONSOLE_TITLE = AGENT_PASSPORT_MEMORY_ENGINE_LABEL;
export const OPENNEED_OFFLINE_CHAT_TITLE = `${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}离线聊天`;
export const OPENNEED_LAB_TITLE = `${AGENT_PASSPORT_MEMORY_ENGINE_LABEL} 高级工具页`;
export const OPENNEED_REPAIR_HUB_TITLE = `${AGENT_PASSPORT_MEMORY_ENGINE_LABEL} 修复中心`;

export function isOpenNeedReasonerAlias(value) {
  const normalized = text(value);
  if (!normalized) {
    return false;
  }
  return (
    equalsIgnoreCase(normalized, LEGACY_OPENNEED_REASONER_BRAND) ||
    equalsIgnoreCase(normalized, LEGACY_OPENNEED_MEMORY_ENGINE_NAME) ||
    equalsIgnoreCase(normalized, AGENT_PASSPORT_LOCAL_REASONER_LABEL) ||
    equalsIgnoreCase(normalized, AGENT_PASSPORT_MEMORY_ENGINE_LABEL)
  );
}

function isOpenNeedReasonerOllamaModel(value) {
  return equalsIgnoreCase(value, OPENNEED_REASONER_OLLAMA_MODEL);
}

export function resolveOpenNeedReasonerModel(value, fallback = OPENNEED_REASONER_OLLAMA_MODEL) {
  const normalized = text(value);
  if (!normalized) {
    return fallback;
  }
  return isOpenNeedReasonerAlias(normalized) || isOpenNeedReasonerOllamaModel(normalized)
    ? OPENNEED_REASONER_OLLAMA_MODEL
    : normalized;
}

export function displayAgentPassportLocalReasonerModel(value, fallback = AGENT_PASSPORT_LOCAL_REASONER_LABEL) {
  const normalized = text(value);
  if (!normalized) {
    return fallback;
  }
  return resolveOpenNeedReasonerModel(normalized, null) === OPENNEED_REASONER_OLLAMA_MODEL
    ? AGENT_PASSPORT_LOCAL_REASONER_LABEL
    : normalized;
}

export function isAgentPassportLocalReasonerModel(value) {
  const normalized = text(value);
  return Boolean(normalized) && isOpenNeedReasonerOllamaModel(resolveOpenNeedReasonerModel(normalized, null));
}

export function displayOpenNeedReasonerModel(value, fallback = AGENT_PASSPORT_LOCAL_REASONER_LABEL) {
  return displayAgentPassportLocalReasonerModel(value, fallback);
}

export function isOpenNeedReasonerModel(value) {
  return isAgentPassportLocalReasonerModel(value);
}

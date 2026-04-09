function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function equalsIgnoreCase(left, right) {
  const normalizedLeft = text(left);
  const normalizedRight = text(right);
  return Boolean(normalizedLeft && normalizedRight) && normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
}

export const OPENNEED_MEMORY_ENGINE_NAME = "OpenNeed 记忆稳态引擎";
export const OPENNEED_REASONER_BRAND = "OpenNeed";
const OPENNEED_REASONER_OLLAMA_MODEL_PARTS = ["gemma4", "e4b"];
export const OPENNEED_REASONER_OLLAMA_MODEL = OPENNEED_REASONER_OLLAMA_MODEL_PARTS.join(":");
export const OPENNEED_MAIN_CONSOLE_TITLE = OPENNEED_MEMORY_ENGINE_NAME;
export const OPENNEED_OFFLINE_CHAT_TITLE = `${OPENNEED_MEMORY_ENGINE_NAME}离线聊天`;
export const OPENNEED_LAB_TITLE = `${OPENNEED_MEMORY_ENGINE_NAME} 高级工具页`;
export const OPENNEED_REPAIR_HUB_TITLE = `${OPENNEED_MEMORY_ENGINE_NAME} 修复中心`;

export function isOpenNeedReasonerAlias(value) {
  const normalized = text(value);
  if (!normalized) {
    return false;
  }
  return (
    equalsIgnoreCase(normalized, OPENNEED_REASONER_BRAND) ||
    equalsIgnoreCase(normalized, OPENNEED_MEMORY_ENGINE_NAME)
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

export function displayOpenNeedReasonerModel(value, fallback = OPENNEED_REASONER_BRAND) {
  const normalized = text(value);
  if (!normalized) {
    return fallback;
  }
  return resolveOpenNeedReasonerModel(normalized, null) === OPENNEED_REASONER_OLLAMA_MODEL
    ? OPENNEED_REASONER_BRAND
    : normalized;
}

export function isOpenNeedReasonerModel(value) {
  const normalized = text(value);
  return Boolean(normalized) && isOpenNeedReasonerOllamaModel(resolveOpenNeedReasonerModel(normalized, null));
}

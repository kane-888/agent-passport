// 属性：本体。
// 这里定义“记忆稳态引擎”这一底层能力的规范命名，以及旧 OpenNeed / agent-passport 展示名到本地模型 ID 的兼容映射。

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function equalsIgnoreCase(left, right) {
  const normalizedLeft = text(left);
  const normalizedRight = text(right);
  return Boolean(normalizedLeft && normalizedRight) && normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
}

export const MEMORY_STABILITY_ENGINE_LABEL = "记忆稳态引擎";
export const MEMORY_STABILITY_LOCAL_REASONER_LABEL = "记忆稳态引擎本地推理";
export const MEMORY_STABILITY_LOCAL_STACK_NAME = "记忆稳态引擎本地栈";

// 兼容导出：旧调用方仍在引用这些名字，但它们不再代表“agent-passport 拥有底层模型”。
export const AGENT_PASSPORT_MEMORY_ENGINE_LABEL = MEMORY_STABILITY_ENGINE_LABEL;
export const AGENT_PASSPORT_LOCAL_REASONER_LABEL = MEMORY_STABILITY_LOCAL_REASONER_LABEL;

const MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_PARTS = ["gemma4", "e4b"];
export const MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL = MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_PARTS.join(":");
const MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_ASSET_DIRECTORY_PARTS = ["ollama", ...MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_PARTS];
export const MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_ASSET_DIRECTORY_NAME =
  MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_ASSET_DIRECTORY_PARTS.join("-");

function isLegacyMemoryEngineAlias(value) {
  const normalized = text(value);
  if (!normalized) {
    return false;
  }
  return (
    equalsIgnoreCase(normalized, "OpenNeed") ||
    equalsIgnoreCase(normalized, "OpenNeed 记忆稳态引擎") ||
    equalsIgnoreCase(normalized, MEMORY_STABILITY_ENGINE_LABEL) ||
    equalsIgnoreCase(normalized, MEMORY_STABILITY_LOCAL_REASONER_LABEL)
  );
}

function isMemoryStabilityDefaultOllamaModel(value) {
  return equalsIgnoreCase(value, MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL);
}

function isMemoryStabilityDefaultOllamaModelAssetDirectory(value) {
  return equalsIgnoreCase(value, MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_ASSET_DIRECTORY_NAME);
}

export function resolveMemoryEngineLocalModel(value, fallback = MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL) {
  const normalized = text(value);
  if (!normalized) {
    return fallback;
  }
  return isLegacyMemoryEngineAlias(normalized) ||
    isMemoryStabilityDefaultOllamaModel(normalized) ||
    isMemoryStabilityDefaultOllamaModelAssetDirectory(normalized)
    ? MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL
    : normalized;
}

export function resolveMemoryEngineLocalAssetDirectoryName(
  value,
  fallback = MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_ASSET_DIRECTORY_NAME
) {
  const normalized = text(value);
  if (!normalized) {
    return fallback;
  }
  return isLegacyMemoryEngineAlias(normalized) ||
    isMemoryStabilityDefaultOllamaModel(normalized) ||
    isMemoryStabilityDefaultOllamaModelAssetDirectory(normalized)
    ? MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_ASSET_DIRECTORY_NAME
    : normalized;
}

export function displayMemoryEngineLocalReasoner(value, fallback = MEMORY_STABILITY_LOCAL_REASONER_LABEL) {
  const normalized = text(value);
  if (!normalized) {
    return fallback;
  }
  return resolveMemoryEngineLocalModel(normalized, null) === MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL
    ? MEMORY_STABILITY_LOCAL_REASONER_LABEL
    : normalized;
}

export function isMemoryEngineLocalReasonerModel(value) {
  const normalized = text(value);
  return Boolean(normalized) && isMemoryStabilityDefaultOllamaModel(resolveMemoryEngineLocalModel(normalized, null));
}

export const displayAgentPassportLocalReasonerModel = displayMemoryEngineLocalReasoner;
export const isAgentPassportLocalReasonerModel = isMemoryEngineLocalReasonerModel;

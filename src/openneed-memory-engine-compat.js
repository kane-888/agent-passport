import {
  MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL,
  MEMORY_STABILITY_ENGINE_LABEL,
  MEMORY_STABILITY_LOCAL_REASONER_LABEL,
  displayMemoryEngineLocalReasoner,
  isMemoryEngineLocalReasonerModel,
  resolveMemoryEngineLocalModel,
} from "./memory-engine-branding.js";
export { canonicalizeHybridRuntimeReasonerSelectionFlags } from "./hybrid-runtime-selection.js";

// 属性：兼容。
// OpenNeed 仅保留历史命名兼容与旧入口适配，不再代表底层引擎本体。

export const LEGACY_OPENNEED_MEMORY_ENGINE_NAME = "OpenNeed 记忆稳态引擎";
export const LEGACY_OPENNEED_REASONER_BRAND = "OpenNeed";
export const OPENNEED_MEMORY_ENGINE_NAME = MEMORY_STABILITY_ENGINE_LABEL;
export const OPENNEED_REASONER_BRAND = LEGACY_OPENNEED_REASONER_BRAND;
export const OPENNEED_REASONER_OLLAMA_MODEL = MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL;

// 兼容导出：这些标题只表示旧 app 名称，不代表底层架构归属。
export const OPENNEED_MAIN_CONSOLE_TITLE = "openneed";
export const OPENNEED_OFFLINE_CHAT_TITLE = "openneed 离线聊天";
export const OPENNEED_LAB_TITLE = "openneed 高级工具页";
export const OPENNEED_REPAIR_HUB_TITLE = "openneed 修复中心";

export const resolveOpenNeedReasonerModel = resolveMemoryEngineLocalModel;
export const displayOpenNeedReasonerModel = displayMemoryEngineLocalReasoner;
export const isOpenNeedReasonerModel = isMemoryEngineLocalReasonerModel;
export const OPENNEED_LOCAL_REASONER_LABEL = MEMORY_STABILITY_LOCAL_REASONER_LABEL;

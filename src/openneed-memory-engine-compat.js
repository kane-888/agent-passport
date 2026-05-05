import {
  MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL,
  MEMORY_STABILITY_ENGINE_LABEL,
  MEMORY_STABILITY_LOCAL_REASONER_LABEL,
  displayMemoryEngineLocalReasoner,
  isMemoryEngineLocalReasonerModel,
  resolveMemoryEngineLocalModel,
} from "./memory-engine-branding.js";
import { OPENNEED_COMPAT_MANIFEST } from "./openneed-compat-manifest.js";
export { canonicalizeHybridRuntimeReasonerSelectionFlags } from "./hybrid-runtime-selection.js";

// 属性：兼容。
// OpenNeed 仅保留历史命名兼容与旧入口适配，不再代表底层引擎本体。

export const LEGACY_OPENNEED_MEMORY_ENGINE_NAME = OPENNEED_COMPAT_MANIFEST.memoryEngineName;
export const LEGACY_OPENNEED_REASONER_BRAND = OPENNEED_COMPAT_MANIFEST.reasonerBrand;
export const OPENNEED_MEMORY_ENGINE_NAME = MEMORY_STABILITY_ENGINE_LABEL;
export const OPENNEED_REASONER_BRAND = LEGACY_OPENNEED_REASONER_BRAND;
export const OPENNEED_REASONER_OLLAMA_MODEL = MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL;

// 兼容导出：这些标题只表示旧 app 名称，不代表底层架构归属。
export const OPENNEED_MAIN_CONSOLE_TITLE = OPENNEED_COMPAT_MANIFEST.appTitles.mainConsole;
export const OPENNEED_OFFLINE_CHAT_TITLE = OPENNEED_COMPAT_MANIFEST.appTitles.offlineChat;
export const OPENNEED_LAB_TITLE = OPENNEED_COMPAT_MANIFEST.appTitles.lab;
export const OPENNEED_REPAIR_HUB_TITLE = OPENNEED_COMPAT_MANIFEST.appTitles.repairHub;

export const resolveOpenNeedReasonerModel = resolveMemoryEngineLocalModel;
export const displayOpenNeedReasonerModel = displayMemoryEngineLocalReasoner;
export const isOpenNeedReasonerModel = isMemoryEngineLocalReasonerModel;
export const OPENNEED_LOCAL_REASONER_LABEL = MEMORY_STABILITY_LOCAL_REASONER_LABEL;

import { normalizeOptionalText } from "./ledger-core-utils.js";
import { LEGACY_OPENNEED_AGENT_ID } from "./openneed-compat-manifest.js";

export const AGENT_PASSPORT_MAIN_AGENT_ID = "agent_main";
export { LEGACY_OPENNEED_AGENT_ID };

const MAIN_AGENT_COMPATIBLE_ID_LIST = Object.freeze([AGENT_PASSPORT_MAIN_AGENT_ID, LEGACY_OPENNEED_AGENT_ID]);
const MAIN_AGENT_COMPATIBLE_IDS = new Set(MAIN_AGENT_COMPATIBLE_ID_LIST);

export function isMainAgentCompatibleId(agentId) {
  const normalizedAgentId = normalizeOptionalText(agentId) ?? null;
  return normalizedAgentId ? MAIN_AGENT_COMPATIBLE_IDS.has(normalizedAgentId) : false;
}

export function listMainAgentCompatibleIds(agentId) {
  const normalizedAgentId = normalizeOptionalText(agentId) ?? null;
  if (!normalizedAgentId) {
    return [];
  }
  return isMainAgentCompatibleId(normalizedAgentId)
    ? [...MAIN_AGENT_COMPATIBLE_ID_LIST]
    : [normalizedAgentId];
}

export function expandMainAgentCompatibleIds(values = []) {
  const expanded = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    for (const compatibleId of listMainAgentCompatibleIds(value)) {
      if (compatibleId) {
        expanded.add(compatibleId);
      }
    }
  }
  return [...expanded];
}

export function canonicalizeMainAgentReference(agentId) {
  const normalizedAgentId = normalizeOptionalText(agentId) ?? null;
  return normalizedAgentId && MAIN_AGENT_COMPATIBLE_IDS.has(normalizedAgentId)
    ? AGENT_PASSPORT_MAIN_AGENT_ID
    : normalizedAgentId;
}

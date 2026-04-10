import { normalizeOptionalText } from "./ledger-core-utils.js";

export const LEGACY_PROJECT_NAME_ALIASES = Object.freeze([
  "agent passport",
  "agent-passport",
]);

export function hasLegacyProjectNameReference(text = "") {
  const normalized = String(normalizeOptionalText(text) ?? "").toLowerCase();
  if (!normalized) {
    return false;
  }
  return LEGACY_PROJECT_NAME_ALIASES.some((alias) => normalized.includes(alias));
}

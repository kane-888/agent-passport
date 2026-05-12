import {
  normalizeOptionalText,
} from "./ledger-core-utils.js";

export function extractClaimValueFromText(text, patterns = []) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

export function splitResponseIntoSentences(responseText = "") {
  const text = normalizeOptionalText(responseText) ?? "";
  if (!text) {
    return [];
  }
  return text
    .split(/(?<=[。！？!?;；\n])\s*/u)
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean)
    .slice(0, 24);
}

export function mapPassportFieldToClaimKey(field) {
  const normalized = normalizeOptionalText(field)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }
  switch (normalized) {
    case "agent_id":
      return "agentId";
    case "parent_agent_id":
    case "parent":
      return "parentAgentId";
    case "wallet_address":
    case "wallet":
      return "walletAddress";
    case "role":
      return "role";
    case "name":
      return "displayName";
    case "did":
      return "did";
    case "authorization_threshold":
    case "threshold":
      return "authorizationThreshold";
    default:
      return null;
  }
}

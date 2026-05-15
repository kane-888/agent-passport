import {
  normalizeTextList,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import { HIGH_RISK_RUNTIME_ACTION_KEYWORDS } from "./ledger-device-runtime.js";
import { DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT } from "./ledger-prompt-budget.js";

export const DEFAULT_RUNTIME_TURN_LIMIT = 12;
export const DEFAULT_RUNTIME_DRIFT_SCORE_LIMIT = 3;
export const DEFAULT_RUNTIME_RECENT_TURN_LIMIT = 6;
export const DEFAULT_RUNTIME_TOOL_RESULT_LIMIT = 6;
export const DEFAULT_RUNTIME_QUERY_ITERATION_LIMIT = 4;

export function normalizeRuntimeDriftPolicy(value = {}) {
  return {
    maxConversationTurns: Math.max(1, Math.floor(toFiniteNumber(value?.maxConversationTurns, DEFAULT_RUNTIME_TURN_LIMIT))),
    maxContextChars: Math.max(1000, Math.floor(toFiniteNumber(value?.maxContextChars, DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT))),
    maxContextTokens: Math.max(
      256,
      Math.floor(
        toFiniteNumber(
          value?.maxContextTokens,
          Math.ceil(toFiniteNumber(value?.maxContextChars, DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT) / 4)
        )
      )
    ),
    driftScoreLimit: Math.max(1, Math.floor(toFiniteNumber(value?.driftScoreLimit, DEFAULT_RUNTIME_DRIFT_SCORE_LIMIT))),
    maxRecentConversationTurns: Math.max(
      1,
      Math.floor(toFiniteNumber(value?.maxRecentConversationTurns, DEFAULT_RUNTIME_RECENT_TURN_LIMIT))
    ),
    maxToolResults: Math.max(1, Math.floor(toFiniteNumber(value?.maxToolResults, DEFAULT_RUNTIME_TOOL_RESULT_LIMIT))),
    maxQueryIterations: Math.max(
      1,
      Math.floor(toFiniteNumber(value?.maxQueryIterations, DEFAULT_RUNTIME_QUERY_ITERATION_LIMIT))
    ),
    highRiskActionKeywords: normalizeTextList(value?.highRiskActionKeywords).length > 0
      ? normalizeTextList(value.highRiskActionKeywords)
      : [...HIGH_RISK_RUNTIME_ACTION_KEYWORDS],
  };
}

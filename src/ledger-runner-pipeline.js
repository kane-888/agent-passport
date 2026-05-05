import {
  normalizeOptionalText,
  normalizeTextList,
} from "./ledger-core-utils.js";
import { normalizeRuntimeCapability } from "./ledger-device-runtime.js";

export function buildBlockedRunnerSandboxExecution(payload = {}, negotiation = null, driftCheck = null) {
  const capability =
    normalizeRuntimeCapability(payload?.sandboxAction?.capability) ??
    negotiation?.requestedCapability ??
    null;
  const blockedBy = driftCheck?.requiresHumanReview
    ? "human_review_required"
    : driftCheck?.requiresRehydrate
      ? "rehydrate_required"
      : "runner_gate";
  return {
    capability,
    status: "blocked",
    blocked: true,
    blockedBy,
    gateReasons: normalizeTextList([
      driftCheck?.requiresRehydrate ? "requires_rehydrate" : null,
      driftCheck?.requiresHumanReview ? "requires_human_review" : null,
    ]),
    executed: false,
    writeCount: 0,
    summary:
      blockedBy === "human_review_required"
        ? "sandbox execution skipped until human review completes."
        : "sandbox execution skipped until rehydrate completes.",
    error: null,
    output: null,
  };
}

export function buildAutoRecoveryResumePayload(payload = {}, overrides = {}) {
  return {
    ...payload,
    userTurn: null,
    input: null,
    message: null,
    response: null,
    responseText: null,
    assistantResponse: null,
    candidateResponse: null,
    claims: undefined,
    recentConversationTurns: [],
    toolResults: [],
    storeToolResults: false,
    writeConversationTurns: false,
    turnCount: undefined,
    estimatedContextChars: undefined,
    estimatedContextTokens: undefined,
    queryIteration: undefined,
    ...overrides,
  };
}

export function normalizeRunnerConversationTurns(payload = {}) {
  const turns = Array.isArray(payload.recentConversationTurns)
    ? payload.recentConversationTurns
    : [];
  const normalized = turns
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const role = normalizeOptionalText(entry.role) ?? "unknown";
      const content = normalizeOptionalText(entry.content) ?? null;
      if (!content) {
        return null;
      }
      return { role, content };
    })
    .filter(Boolean);
  const userTurn = normalizeOptionalText(payload.userTurn || payload.input || payload.message) ?? null;
  if (userTurn) {
    normalized.push({ role: "user", content: userTurn });
  }
  return normalized.slice(-8);
}

export function normalizeRunnerToolResults(payload = {}) {
  const items = Array.isArray(payload.toolResults) ? payload.toolResults : [];
  return items
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const tool = normalizeOptionalText(entry.tool || entry.name) ?? null;
      const result = normalizeOptionalText(entry.result || entry.output || entry.summary) ?? null;
      if (!tool && !result) {
        return null;
      }
      return {
        tool: tool || "tool",
        result: result || "",
      };
    })
    .filter(Boolean)
    .slice(-8);
}

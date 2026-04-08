import { normalizeComparableText, normalizeOptionalText } from "./ledger-core-utils.js";

const COUNTERFACTUAL_PREFIX_PATTERN = /^(如果|假如|要是|设想|若|假设|一旦)\s*/u;

function extractCounterfactualCondition(text = "") {
  const normalized = normalizeOptionalText(text) ?? "";
  const match = normalized.match(/^(如果|假如|要是|设想|若|假设|一旦)(?<condition>.+?)(?:，|,)(?<outcome>.+)$/u);
  if (!match?.groups) {
    return {
      cue: normalized.match(COUNTERFACTUAL_PREFIX_PATTERN)?.[1] ?? null,
      conditionText: null,
      consequentText: normalized || null,
    };
  }

  return {
    cue: normalizeOptionalText(match[1]) ?? null,
    conditionText: normalizeOptionalText(match.groups.condition) ?? null,
    consequentText: normalizeOptionalText(match.groups.outcome) ?? null,
  };
}

export function buildCounterfactualTrace(proposition = {}, { sentenceBinding = null, discourseState = null } = {}) {
  if (proposition?.counterfactual !== true) {
    return null;
  }

  const sourceText = normalizeOptionalText(proposition?.sentence) ?? normalizeOptionalText(proposition?.rawText) ?? null;
  if (!sourceText) {
    return null;
  }

  const { cue, conditionText, consequentText } = extractCounterfactualCondition(sourceText);
  const traceKey = normalizeComparableText(
    [conditionText, proposition?.subject, proposition?.predicate, proposition?.object, proposition?.polarity].filter(Boolean).join(" ")
  ).slice(0, 96);

  return {
    traceId: `ctrace_${traceKey || "counterfactual"}`,
    traceType: "counterfactual_simulation",
    cue,
    conditionText,
    consequentText,
    sentence: sourceText,
    sentenceIndex: Number.isFinite(Number(proposition?.sentenceIndex)) ? Number(proposition.sentenceIndex) : null,
    proposition: {
      propositionId: proposition?.propositionId ?? null,
      subject: proposition?.subject ?? null,
      predicate: proposition?.predicate ?? null,
      object: proposition?.object ?? null,
      polarity: proposition?.polarity ?? null,
      modality: proposition?.modality ?? null,
      epistemicStatus: proposition?.epistemicStatus ?? null,
    },
    discourseRefs: Array.isArray(proposition?.discourseRefs) ? proposition.discourseRefs.slice(0, 6) : [],
    discourseState: discourseState && typeof discourseState === "object" ? discourseState : null,
    supportSummary: sentenceBinding?.supportSummary ?? proposition?.supportSummary ?? null,
    simulationOnly: true,
  };
}

export function buildCounterfactualTraces(propositionBindings = [], sentenceBindings = [], { discourseState = null } = {}) {
  return (Array.isArray(propositionBindings) ? propositionBindings : [])
    .filter((proposition) => proposition?.counterfactual === true)
    .map((proposition) =>
      buildCounterfactualTrace(proposition, {
        sentenceBinding:
          (Array.isArray(sentenceBindings) ? sentenceBindings : []).find((entry) => entry?.sentenceIndex === proposition?.sentenceIndex) ?? null,
        discourseState,
      })
    )
    .filter(Boolean);
}

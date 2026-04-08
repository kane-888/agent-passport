import { normalizeComparableText, normalizeOptionalText } from "./ledger-core-utils.js";

const NEGATION_CUES = [
  "并非",
  "不是",
  "不建议",
  "不应该",
  "不应当",
  "不应",
  "不会",
  "不能",
  "不想",
  "不太",
  "不用",
  "无需",
  "没有",
  "尚未",
  "未",
  "不",
];

const CLAUSE_BREAK_PATTERN = /(?:，|,|。|；|;|！|!|？|\?|但是|但|不过|然而|同时|并且|而且|且|然后)/u;
const CLAUSE_SPLIT_PATTERN = /(?:，|,|。|；|;|！|!|？|\?|但是|但|不过|然而|同时|并且|而且|且|然后)/gu;
const QUANTIFIER_PATTERNS = [
  /只有(?<antecedent>[^，,。；;！？!?]{1,48})(?:，|,)?才/u,
  /(不是|并非)\s*(所有|全部)(?:候选人|人选)?/u,
  /(所有|全部)(?:候选人|人选)?/u,
  /(大多数|多数|部分|少数)(?:候选人|人选)?/u,
  /(至少(?:\d+位?|一位|两位|三位)|至多(?:\d+位?|一位|两位|三位)|仅(?:\d+位?|一位|两位|三位)|只有(?:\d+位?|一位|两位|三位))(?:候选人|人选)?/u,
  /(其中一位|另一位|另一名|前者|后者|其余人选)/u,
  /(一半)(?:候选人|人选)?/u,
];
const NEGATED_CAUSAL_PATTERN = /(?<cue>并不是因为|不是因为|并非因为)(?<antecedent>[^，,。；;！？!?]{1,72})(?:，|,)?(?<connector>所以|因此|因而)(?<consequent>[^。！？!?；;]{1,72})/u;
const COUNTERFACTUAL_CONDITIONAL_PATTERN = /(?<cue>如果|假如|若|要是|假设)(?<antecedent>[^，,。；;！？!?]{1,72})(?:，|,)?(?<connector>就|那么|则)(?<consequent>[^。！？!?；;]{1,72})/u;

function normalizeClauseText(value = "") {
  return (normalizeOptionalText(value) ?? "")
    .replace(/^[，,、:\s]+/u, "")
    .replace(/[。！？!?；;，,\s]+$/u, "")
    .trim();
}

function trimObjectToScope(objectText = "") {
  const normalized = normalizeClauseText(objectText);
  if (!normalized) {
    return null;
  }
  const boundaryMatch = normalized.match(CLAUSE_BREAK_PATTERN);
  if (!boundaryMatch || boundaryMatch.index == null) {
    return normalized;
  }
  return normalizeClauseText(normalized.slice(0, boundaryMatch.index));
}

function detectNegationCue(text = "") {
  const normalized = normalizeOptionalText(text) ?? "";
  for (const cue of NEGATION_CUES) {
    if (normalized.includes(cue)) {
      return cue;
    }
  }
  return null;
}

export function detectQuantifierCue(text = "") {
  const normalized = normalizeOptionalText(text) ?? "";
  for (const pattern of QUANTIFIER_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[0]) {
      return normalizeClauseText(match[0]);
    }
  }
  return null;
}

function classifyQuantifierFamily(cue = "") {
  const normalized = normalizeOptionalText(cue) ?? "";
  if (!normalized) {
    return null;
  }
  if (/不是|并非/u.test(normalized)) {
    return "negated_universal";
  }
  if (/所有|全部/u.test(normalized)) {
    return "universal";
  }
  if (/大多数|多数/u.test(normalized)) {
    return "majority";
  }
  if (/部分/u.test(normalized)) {
    return "subset";
  }
  if (/少数/u.test(normalized)) {
    return "minority";
  }
  if (/至少/u.test(normalized)) {
    return "lower_bound";
  }
  if (/至多/u.test(normalized)) {
    return "upper_bound";
  }
  if (/仅|只有/u.test(normalized)) {
    if (/才/u.test(normalized)) {
      return "exclusive_condition";
    }
    return "restricted_subset";
  }
  if (/其中一位|另一位|另一名|前者|后者|其余人选/u.test(normalized)) {
    return "individual_member";
  }
  if (/一半/u.test(normalized)) {
    return "half";
  }
  return "group";
}

function inferQuantifierDistribution(cue = "") {
  const family = classifyQuantifierFamily(cue);
  if (!family) {
    return null;
  }
  if (family === "exclusive_condition") {
    return "conditional";
  }
  return ["individual_member"].includes(family) ? "individual" : "group";
}

function resolveFrameRole(frame = null, clauseText = "", matchedText = "") {
  if (!frame) {
    return null;
  }
  const normalizedClause = normalizeComparableText(clauseText);
  const normalizedMatch = normalizeComparableText(matchedText);
  const antecedentKey = normalizeComparableText(frame.antecedentText);
  const consequentKey = normalizeComparableText(frame.consequentText);
  if (antecedentKey && ((normalizedClause && normalizedClause.includes(antecedentKey)) || (normalizedMatch && normalizedMatch.includes(antecedentKey)))) {
    return "antecedent";
  }
  if (consequentKey && ((normalizedClause && normalizedClause.includes(consequentKey)) || (normalizedMatch && normalizedMatch.includes(consequentKey)))) {
    return "consequent";
  }
  return frame.defaultRole || null;
}

function detectClauseFrame(sentence = "", clauseText = "", matchedText = "") {
  const normalizedSentence = normalizeOptionalText(sentence) ?? "";
  if (!normalizedSentence) {
    return null;
  }

  const exclusiveCondition = normalizedSentence.match(/只有(?<antecedent>[^，,。；;！？!?]{1,72})(?:，|,)?才(?<consequent>[^。！？!?；;]{1,72})/u);
  if (exclusiveCondition?.groups) {
    const frame = {
      type: "exclusive_condition",
      cue: `只有${normalizeClauseText(exclusiveCondition.groups.antecedent)}才`,
      antecedentText: normalizeClauseText(exclusiveCondition.groups.antecedent),
      consequentText: normalizeClauseText(exclusiveCondition.groups.consequent),
      defaultRole: "consequent",
    };
    return {
      ...frame,
      role: resolveFrameRole(frame, clauseText, matchedText),
    };
  }

  const negatedCausal = normalizedSentence.match(NEGATED_CAUSAL_PATTERN);
  if (negatedCausal?.groups) {
    const frame = {
      type: "negated_causal",
      cue: normalizeClauseText(`${negatedCausal.groups.cue}${negatedCausal.groups.antecedent}${negatedCausal.groups.connector}`),
      antecedentText: normalizeClauseText(negatedCausal.groups.antecedent),
      consequentText: normalizeClauseText(negatedCausal.groups.consequent),
      defaultRole: "consequent",
    };
    return {
      ...frame,
      role: resolveFrameRole(frame, clauseText, matchedText),
    };
  }

  const counterfactualConditional = normalizedSentence.match(COUNTERFACTUAL_CONDITIONAL_PATTERN);
  if (counterfactualConditional?.groups) {
    const frame = {
      type: "counterfactual_conditional",
      cue: normalizeClauseText(`${counterfactualConditional.groups.cue}${counterfactualConditional.groups.antecedent}${counterfactualConditional.groups.connector}`),
      antecedentText: normalizeClauseText(counterfactualConditional.groups.antecedent),
      consequentText: normalizeClauseText(counterfactualConditional.groups.consequent),
      defaultRole: "antecedent",
    };
    return {
      ...frame,
      role: resolveFrameRole(frame, clauseText, matchedText),
    };
  }

  return null;
}

export function buildClauseScopes(sentence = "") {
  const normalized = normalizeOptionalText(sentence) ?? "";
  if (!normalized) {
    return [];
  }

  const clauses = [];
  let cursor = 0;
  let clauseIndex = 0;
  for (const match of normalized.matchAll(CLAUSE_SPLIT_PATTERN)) {
    const boundaryIndex = match.index ?? 0;
    const boundaryText = match[0] ?? "";
    const clauseText = normalizeClauseText(normalized.slice(cursor, boundaryIndex));
    if (clauseText) {
      clauses.push({
        clauseIndex,
        clauseText,
        scopeText: clauseText,
        start: cursor,
        end: boundaryIndex,
        boundaryAfter: boundaryText || null,
      });
      clauseIndex += 1;
    }
    cursor = boundaryIndex + boundaryText.length;
  }

  const tailClause = normalizeClauseText(normalized.slice(cursor));
  if (tailClause) {
    clauses.push({
      clauseIndex,
      clauseText: tailClause,
      scopeText: tailClause,
      start: cursor,
      end: normalized.length,
      boundaryAfter: null,
    });
  }

  return clauses;
}

function resolveClauseScope({ sentence = "", clauseText = null, clauseIndex = null, matchedText = null } = {}) {
  const normalizedClauseText = normalizeClauseText(clauseText);
  if (normalizedClauseText) {
    return {
      clauseText: normalizedClauseText,
      clauseIndex: Number.isFinite(Number(clauseIndex)) ? Number(clauseIndex) : null,
    };
  }

  const clauses = buildClauseScopes(sentence);
  const normalizedMatch = normalizeComparableText(matchedText);
  if (normalizedMatch) {
    const foundClause = clauses.find((candidate) => normalizeComparableText(candidate.clauseText)?.includes(normalizedMatch));
    if (foundClause) {
      return {
        clauseText: foundClause.clauseText,
        clauseIndex: foundClause.clauseIndex,
      };
    }
  }

  const fallbackClause = clauses[0] || null;
  if (fallbackClause) {
    return {
      clauseText: fallbackClause.clauseText,
      clauseIndex: fallbackClause.clauseIndex,
    };
  }

  return {
    clauseText: normalizeClauseText(sentence),
    clauseIndex: Number.isFinite(Number(clauseIndex)) ? Number(clauseIndex) : null,
  };
}

export function buildNegationScope({
  sentence = null,
  clauseText = null,
  clauseIndex = null,
  matchedText = null,
  objectText = null,
  explicitNegation = null,
  predicate = null,
} = {}) {
  const normalizedSentence = normalizeOptionalText(sentence) ?? "";
  const normalizedMatch = normalizeOptionalText(matchedText) ?? normalizedSentence;
  const resolvedClause = resolveClauseScope({
    sentence: normalizedSentence,
    clauseText,
    clauseIndex,
    matchedText: normalizedMatch,
  });
  const frame = detectClauseFrame(normalizedSentence, resolvedClause.clauseText, normalizedMatch);
  const normalizedObject = trimObjectToScope(objectText);
  const localCue =
    normalizeOptionalText(explicitNegation) ??
    detectNegationCue(normalizedMatch) ??
    detectNegationCue(resolvedClause.clauseText) ??
    (!resolvedClause.clauseText ? detectNegationCue(normalizedSentence) : null);
  const isNegated = Boolean(localCue);
  const scopeSource = resolvedClause.clauseText || normalizedMatch || normalizedSentence;
  const scopeText = isNegated
    ? normalizeClauseText(scopeSource)
    : normalizedObject ?? normalizeClauseText(scopeSource);
  const confidence =
    isNegated && normalizeOptionalText(explicitNegation)
      ? 0.94
      : isNegated && resolvedClause.clauseText
        ? 0.88
        : isNegated && normalizedMatch
      ? 0.9
      : isNegated && normalizedSentence
        ? 0.7
        : 0.18;

  return {
    predicate: normalizeOptionalText(predicate) ?? null,
    isNegated,
    cue: localCue,
    scopeKind: resolvedClause.clauseText ? "clause" : "fragment",
    scopeText: scopeText || null,
    objectText: normalizedObject ?? trimObjectToScope(scopeSource) ?? null,
    clauseText: resolvedClause.clauseText || null,
    clauseIndex: Number.isFinite(Number(resolvedClause.clauseIndex)) ? Number(resolvedClause.clauseIndex) : null,
    frameType: frame?.type ?? null,
    frameRole: frame?.role ?? null,
    frameCue: frame?.cue ?? null,
    antecedentText: frame?.antecedentText ?? null,
    consequentText: frame?.consequentText ?? null,
    confidence,
  };
}

export function buildQuantifierScope({
  sentence = null,
  clauseText = null,
  clauseIndex = null,
  matchedText = null,
  explicitQuantifier = null,
  subjectText = null,
  predicate = null,
} = {}) {
  const normalizedSentence = normalizeOptionalText(sentence) ?? "";
  const normalizedMatch = normalizeOptionalText(matchedText) ?? normalizedSentence;
  const resolvedClause = resolveClauseScope({
    sentence: normalizedSentence,
    clauseText,
    clauseIndex,
    matchedText: normalizedMatch,
  });
  const frame = detectClauseFrame(normalizedSentence, resolvedClause.clauseText, normalizedMatch);
  const cue =
    (frame?.type === "exclusive_condition" ? frame.cue : null) ??
    detectQuantifierCue(normalizedMatch) ??
    detectQuantifierCue(resolvedClause.clauseText) ??
    normalizeClauseText(explicitQuantifier) ??
    (!resolvedClause.clauseText ? detectQuantifierCue(normalizedSentence) : null);
  if (!cue) {
    return null;
  }

  const family = classifyQuantifierFamily(cue);
  const distribution = inferQuantifierDistribution(cue);
  const confidence =
    normalizeClauseText(explicitQuantifier)
      ? 0.94
      : resolvedClause.clauseText
        ? 0.82
        : 0.62;

  return {
    predicate: normalizeOptionalText(predicate) ?? null,
    cue,
    family,
    distribution,
    subjectText: normalizeOptionalText(subjectText) ?? null,
    scopeKind: resolvedClause.clauseText ? "clause" : "fragment",
    scopeText: resolvedClause.clauseText || normalizedMatch || null,
    clauseText: resolvedClause.clauseText || null,
    clauseIndex: Number.isFinite(Number(resolvedClause.clauseIndex)) ? Number(resolvedClause.clauseIndex) : null,
    frameType: frame?.type ?? (family === "exclusive_condition" ? "exclusive_condition" : null),
    frameRole: frame?.role ?? null,
    frameCue: frame?.cue ?? null,
    antecedentText: frame?.antecedentText ?? null,
    consequentText: frame?.consequentText ?? null,
    confidence,
  };
}

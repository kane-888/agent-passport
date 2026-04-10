import { normalizeComparableText, normalizeOptionalText } from "./ledger-core-utils.js";

const MEMORY_REFERENT_ALIASES = [
  "当前记忆",
  "记忆焦点",
  "当前记忆焦点",
  "记忆锚点",
  "上下文焦点",
  "运行焦点",
  "当前焦点",
  "记忆",
];

const CONTEXT_REFERENT_ALIASES = [
  "目标上下文",
  "任务上下文",
  "运行上下文",
  "目标语境",
  "上下文锚点",
  "目标环境",
];

const REFERENT_KIND_DEFAULT_LABELS = {
  candidate: "当前记忆",
  company: "目标上下文",
  match: "匹配结果",
  flow: "流程",
  decision: "决策",
  policy: "策略",
};

const REFERENT_KIND_ALIASES = {
  candidate: MEMORY_REFERENT_ALIASES,
  company: CONTEXT_REFERENT_ALIASES,
  match: ["匹配结果", "这个建议", "该建议", "这一建议", "推荐结果", "建议"],
  flow: ["流程", "下一步", "这一步", "该动作", "这个动作", "动作"],
  decision: ["决策", "这个决定", "该决定", "这个结论", "该结论", "此决定"],
  policy: ["策略", "规则", "该策略", "这条规则", "policy"],
};

const PREDICATE_REFERENT_KINDS = {
  candidate_prefers_destination: "candidate",
  company_requires_destination: "company",
  next_action: "flow",
  recommendation: "match",
  match_score: "match",
  decision_confirmation: "decision",
  decision_status: "decision",
  action_execution_status: "flow",
};

const CLAUSE_CONNECTOR_PATTERNS = [
  { kind: "contrast", regex: /^(?:但|但是|不过|然而|而是|只是|另一方面)\s*/u },
  { kind: "consequence", regex: /^(?:因此|所以|因而|于是|故而|therefore|thus|so)\s*/iu },
  { kind: "addition", regex: /^(?:另外|此外|同时|并且|而且|且)\s*/u },
  { kind: "condition", regex: /^(?:如果|假如|若|要是|一旦|假设)\s*/u },
];

const IMPLICIT_SUBJECT_PATTERNS = [
  /^(?:预计|可于|可以|可在|能在|将在|会在|计划在|最快|最早|目前|现在|仍然|依然|已经|已)/u,
  /^(?:不|不会|不再)?(?:更聚焦|聚焦|聚焦于|聚焦在|焦点在|锚定在|落在|对齐到|集中在|更关注|关注)/u,
  /^(?:动作|建议|下一步|接下来|安排|确认|同步|补验证)/u,
  /^(?:因此|所以|另外|此外)\s*(?:预计|动作|建议|下一步|接下来|安排|确认)/u,
];

function predicateKind(predicate = null) {
  const normalized = normalizeOptionalText(predicate)?.toLowerCase() ?? null;
  return normalized ? PREDICATE_REFERENT_KINDS[normalized] ?? null : null;
}

function normalizeAliasValue(value) {
  return normalizeOptionalText(value)?.toLowerCase() ?? null;
}

function referentNodeByKind(discourseState = null, kind = null) {
  if (!discourseState || !kind) {
    return null;
  }
  if (discourseState.referents && typeof discourseState.referents === "object" && !Array.isArray(discourseState.referents)) {
    return discourseState.referents[kind] || null;
  }
  if (Array.isArray(discourseState.referents)) {
    return discourseState.referents.find((item) => item?.kind === kind) || null;
  }
  return null;
}

function activeReferentKinds(discourseState = null) {
  const activeIds = Array.isArray(discourseState?.activeReferentIds) ? discourseState.activeReferentIds : [];
  return activeIds
    .map((item) => normalizeOptionalText(item)?.replace(/^disc_/u, "") ?? null)
    .filter(Boolean);
}

function inferReferentKindFromSubject(subject = null, rawText = null) {
  const normalizedSubject = normalizeAliasValue(subject);
  for (const [kind, aliases] of Object.entries(REFERENT_KIND_ALIASES)) {
    if ((aliases || []).some((alias) => normalizeAliasValue(alias) === normalizedSubject)) {
      return kind;
    }
  }
  const normalizedRawText = normalizeOptionalText(rawText) ?? "";
  if (/这个建议|该建议|这一建议/u.test(normalizedRawText)) {
    return "match";
  }
  if (/这一步|该动作|这个动作|下一步/u.test(normalizedRawText)) {
    return "flow";
  }
  if (/这个决定|该决定|这个结论|该结论|决策/u.test(normalizedRawText)) {
    return "decision";
  }
  if (/这条规则|该策略|这个策略|policy|策略|规则/u.test(normalizedRawText)) {
    return "policy";
  }
  if (CONTEXT_REFERENT_ALIASES.some((alias) => normalizedRawText.includes(alias))) {
    return "company";
  }
  if (MEMORY_REFERENT_ALIASES.some((alias) => normalizedRawText.includes(alias))) {
    return "candidate";
  }
  return null;
}

function labelForReferentKind(kind = null, discourseState = null) {
  if (!kind) {
    return null;
  }
  const referent = referentNodeByKind(discourseState, kind);
  return normalizeOptionalText(referent?.label) ?? REFERENT_KIND_DEFAULT_LABELS[kind] ?? null;
}

function discourseRefForKind(kind = null, discourseState = null) {
  const referent = referentNodeByKind(discourseState, kind);
  return normalizeOptionalText(referent?.referentId) ?? (kind ? `disc_${kind}` : null);
}

export function stripLeadingClauseConnector(text = "") {
  let normalized = normalizeOptionalText(text) ?? "";
  for (const pattern of CLAUSE_CONNECTOR_PATTERNS) {
    normalized = normalized.replace(pattern.regex, "").trim();
  }
  return normalized;
}

export function inferClauseConnector(text = "") {
  const normalized = normalizeOptionalText(text) ?? "";
  for (const pattern of CLAUSE_CONNECTOR_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return pattern.kind;
    }
  }
  return null;
}

export function normalizePropositionSurfaceText(value, { role = "object" } = {}) {
  let normalized = normalizeOptionalText(value) ?? null;
  if (!normalized) {
    return null;
  }
  normalized = normalized.replace(/[。！？!?；;，,]+$/u, "").trim();
  if (role === "object") {
    normalized = normalized.replace(/^(?:建议|动作|优势|风险|分数|城市|地点|职位|角色|下一步|当前决策|决策状态|确认来源)[:：]\s*/u, "").trim();
    normalized = normalized.replace(/^(?:去|到|为|是)\s*/u, "").trim();
  }
  if (role === "subject") {
    normalized = normalized.replace(/^(?:这个|该|这一)\s*/u, "").trim();
  }
  return normalizeOptionalText(normalized) ?? null;
}

export function normalizePropositionQuantifier(value = "") {
  const normalized = normalizeOptionalText(value) ?? null;
  if (!normalized) {
    return null;
  }
  return normalized.replace(/\s+/gu, "").trim() || null;
}

export function buildCanonicalPropositionText({
  subject = null,
  predicate = null,
  object = null,
  polarity = "affirmed",
  quantifier = null,
} = {}) {
  const normalizedSubject = normalizePropositionSurfaceText(subject, { role: "subject" }) ?? "主体";
  const normalizedObject = normalizePropositionSurfaceText(object, { role: "object" }) ?? "对象";
  const normalizedQuantifier = normalizePropositionQuantifier(quantifier);
  const quantifierPrefix = normalizedQuantifier ? `${normalizedQuantifier}` : "";

  switch (normalizeOptionalText(predicate)?.toLowerCase()) {
    case "candidate_prefers_destination":
      return polarity === "negated"
        ? `${quantifierPrefix}${normalizedSubject}不再聚焦${normalizedObject}`
        : `${quantifierPrefix}${normalizedSubject}焦点在${normalizedObject}`;
    case "company_requires_destination":
      return polarity === "negated"
        ? `${normalizedSubject}不在${normalizedObject}`
        : `${normalizedSubject}在${normalizedObject}`;
    case "recommendation":
      return `建议${polarity === "negated" ? "不" : ""}${normalizedObject}`;
    case "next_action":
      return `下一步${polarity === "negated" ? "不" : ""}${normalizedObject}`;
    case "decision_confirmation":
      return `确认来源${normalizedObject}`;
    default:
      return [quantifierPrefix, normalizedSubject, normalizeOptionalText(predicate), normalizedObject].filter(Boolean).join(" ");
  }
}

export function resolveNormalizedPropositionSubject({
  subject = null,
  fallback = null,
  predicate = null,
  rawText = null,
  discourseState = null,
} = {}) {
  const explicitSubject = normalizePropositionSurfaceText(subject, { role: "subject" });
  const explicitKind = inferReferentKindFromSubject(explicitSubject, rawText) ?? predicateKind(predicate);

  if (explicitSubject) {
    const normalizedExplicitSubject = labelForReferentKind(explicitKind, discourseState) ?? explicitSubject;
    const discourseRef = discourseRefForKind(explicitKind, discourseState);
    return {
      subject: normalizedExplicitSubject,
      referentKind: explicitKind ?? null,
      discourseRefs: discourseRef ? [discourseRef] : [],
      subjectResolution: {
        mode: explicitKind ? "alias_explicit" : "explicit",
        referentKind: explicitKind ?? null,
        usedFallback: false,
      },
    };
  }

  const preferredKind = predicateKind(predicate) ?? inferReferentKindFromSubject(fallback, rawText);
  const activeKinds = activeReferentKinds(discourseState);
  const activeKind =
    (preferredKind && activeKinds.includes(preferredKind) && preferredKind) ||
    activeKinds.find((item) => item === preferredKind) ||
    activeKinds[0] ||
    null;
  const implicitCandidate = IMPLICIT_SUBJECT_PATTERNS.some((pattern) => pattern.test(normalizeOptionalText(rawText) ?? ""));

  if (preferredKind && activeKind === preferredKind && implicitCandidate) {
    const discourseRef = discourseRefForKind(preferredKind, discourseState);
    return {
      subject: labelForReferentKind(preferredKind, discourseState) ?? normalizePropositionSurfaceText(fallback, { role: "subject" }),
      referentKind: preferredKind,
      discourseRefs: discourseRef ? [discourseRef] : [],
      subjectResolution: {
        mode: "active_referent",
        referentKind: preferredKind,
        usedFallback: false,
      },
    };
  }

  const fallbackSubject =
    normalizePropositionSurfaceText(fallback, { role: "subject" }) ??
    labelForReferentKind(preferredKind, discourseState) ??
    null;
  const fallbackRef = discourseRefForKind(preferredKind, discourseState);
  return {
    subject: fallbackSubject,
    referentKind: preferredKind ?? null,
    discourseRefs: fallbackRef ? [fallbackRef] : [],
    subjectResolution: {
      mode: fallbackSubject ? "fallback" : "missing",
      referentKind: preferredKind ?? null,
      usedFallback: Boolean(fallbackSubject),
    },
  };
}

export function buildPropositionNormalizationMetadata({
  predicate = null,
  subject = null,
  object = null,
  polarity = "affirmed",
  quantifier = null,
  rawText = null,
} = {}) {
  const normalizedPredicate = normalizeOptionalText(predicate)?.toLowerCase() ?? null;
  return {
    normalizedPredicate,
    canonicalText: buildCanonicalPropositionText({
      subject,
      predicate: normalizedPredicate,
      object,
      polarity,
      quantifier,
    }),
    clauseConnector: inferClauseConnector(rawText),
    comparableObject: normalizeComparableText(object),
    comparableSubject: normalizeComparableText(subject),
  };
}

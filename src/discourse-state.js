import { normalizeOptionalText } from "./ledger-core-utils.js";

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

const LEGACY_REFERENT_KIND_MAP = {
  candidate: "memory",
  company: "context",
};

const LEGACY_REFERENT_ID_MAP = {
  disc_candidate: "disc_memory",
  disc_company: "disc_context",
};

const REFERENT_DEFINITIONS = {
  memory: {
    kind: "memory",
    label: "当前记忆",
    aliases: MEMORY_REFERENT_ALIASES,
  },
  context: {
    kind: "context",
    label: "目标上下文",
    aliases: CONTEXT_REFERENT_ALIASES,
  },
  match: {
    kind: "match",
    label: "匹配结果",
    aliases: ["匹配结果", "这个建议", "该建议", "这一建议", "推荐结果", "建议"],
  },
  flow: {
    kind: "flow",
    label: "流程",
    aliases: ["流程", "下一步", "这一步", "该动作", "这个动作", "动作"],
  },
  decision: {
    kind: "decision",
    label: "决策",
    aliases: ["决策", "这个决定", "该决定", "这个结论", "该结论", "此决定"],
  },
  policy: {
    kind: "policy",
    label: "策略",
    aliases: ["策略", "规则", "该策略", "这条规则", "policy"],
  },
};

function normalizeAliasValue(value) {
  return normalizeOptionalText(value)?.toLowerCase() ?? null;
}

function normalizeReferentKind(value = null) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  return normalized ? LEGACY_REFERENT_KIND_MAP[normalized] ?? normalized : null;
}

function normalizeReferentId(value = null) {
  const normalized = normalizeOptionalText(value) ?? null;
  return normalized ? LEGACY_REFERENT_ID_MAP[normalized] ?? normalized : null;
}

function mergeUniqueTextList(...groups) {
  const items = groups.flat();
  const result = [];
  const seen = new Set();
  for (const item of items) {
    const normalized = normalizeOptionalText(item) ?? null;
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeReferentRecord(key, referent = null) {
  const normalizedKind = normalizeReferentKind(referent?.kind ?? key);
  const definition = REFERENT_DEFINITIONS[normalizedKind];
  if (!normalizedKind || !definition) {
    return null;
  }
  return {
    ...(referent && typeof referent === "object" ? referent : {}),
    referentId: normalizeReferentId(referent?.referentId) ?? `disc_${normalizedKind}`,
    kind: normalizedKind,
    label: normalizeOptionalText(referent?.label) ?? definition.label,
    aliases: mergeUniqueTextList(definition.aliases, referent?.aliases),
    mentionCount: Number.isFinite(Number(referent?.mentionCount)) ? Number(referent.mentionCount) : 0,
    sourceFields: mergeUniqueTextList(referent?.sourceFields),
    tags: mergeUniqueTextList(referent?.tags),
    lastMentionText: normalizeOptionalText(referent?.lastMentionText) ?? null,
    lastMentionSentenceIndex: Number.isFinite(Number(referent?.lastMentionSentenceIndex))
      ? Number(referent.lastMentionSentenceIndex)
      : null,
  };
}

function mergeReferentRecord(current = null, incoming = null) {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }
  const currentSentence =
    Number.isFinite(Number(current.lastMentionSentenceIndex)) ? Number(current.lastMentionSentenceIndex) : null;
  const incomingSentence =
    Number.isFinite(Number(incoming.lastMentionSentenceIndex)) ? Number(incoming.lastMentionSentenceIndex) : null;
  const preferIncomingText =
    Boolean(incoming.lastMentionText) &&
    (!current.lastMentionText ||
      (incomingSentence != null && (currentSentence == null || incomingSentence >= currentSentence)));

  return {
    ...current,
    ...incoming,
    referentId: normalizeReferentId(incoming.referentId) ?? normalizeReferentId(current.referentId) ?? `disc_${incoming.kind}`,
    kind: normalizeReferentKind(incoming.kind) ?? normalizeReferentKind(current.kind),
    label: normalizeOptionalText(current.label) ?? normalizeOptionalText(incoming.label) ?? null,
    aliases: mergeUniqueTextList(current.aliases, incoming.aliases),
    mentionCount: Math.max(
      Number.isFinite(Number(current.mentionCount)) ? Number(current.mentionCount) : 0,
      Number.isFinite(Number(incoming.mentionCount)) ? Number(incoming.mentionCount) : 0
    ),
    sourceFields: mergeUniqueTextList(current.sourceFields, incoming.sourceFields),
    tags: mergeUniqueTextList(current.tags, incoming.tags),
    lastMentionText: preferIncomingText ? incoming.lastMentionText : current.lastMentionText,
    lastMentionSentenceIndex:
      currentSentence == null
        ? incomingSentence
        : incomingSentence == null
          ? currentSentence
          : Math.max(currentSentence, incomingSentence),
  };
}

function cloneDiscourseState(state = null) {
  if (!state || typeof state !== "object") {
    return {
      referents: {},
      activeReferentIds: [],
      lastUpdatedSentenceIndex: null,
    };
  }

  const referentEntries = Array.isArray(state.referents)
    ? state.referents.map((referent, index) => [referent?.kind ?? `referent_${index}`, referent])
    : Object.entries(state.referents || {});
  const normalizedReferents = {};
  for (const [key, referent] of referentEntries) {
    const normalizedReferent = normalizeReferentRecord(key, referent);
    if (!normalizedReferent) {
      continue;
    }
    normalizedReferents[normalizedReferent.kind] = mergeReferentRecord(
      normalizedReferents[normalizedReferent.kind] ?? null,
      normalizedReferent
    );
  }

  return {
    referents: normalizedReferents,
    activeReferentIds: Array.from(
      new Set((Array.isArray(state.activeReferentIds) ? state.activeReferentIds : []).map((item) => normalizeReferentId(item)).filter(Boolean))
    ),
    lastUpdatedSentenceIndex: Number.isFinite(Number(state.lastUpdatedSentenceIndex)) ? Number(state.lastUpdatedSentenceIndex) : null,
  };
}

function buildReferentRecord(kind, extras = {}) {
  const normalizedKind = normalizeReferentKind(kind);
  const definition = REFERENT_DEFINITIONS[normalizedKind];
  if (!definition) {
    return null;
  }
  return {
    referentId: `disc_${normalizedKind}`,
    kind: normalizedKind,
    label: definition.label,
    aliases: definition.aliases.slice(),
    mentionCount: 0,
    sourceFields: [],
    tags: [],
    lastMentionText: null,
    lastMentionSentenceIndex: null,
    ...extras,
  };
}

function ensureReferent(state, kind) {
  const normalizedKind = normalizeReferentKind(kind);
  if (!REFERENT_DEFINITIONS[normalizedKind]) {
    return null;
  }
  if (!state.referents[normalizedKind]) {
    state.referents[normalizedKind] = buildReferentRecord(normalizedKind);
  }
  return state.referents[normalizedKind];
}

function inferReferentKinds({ field = null, tags = [], summary = null, kind = null, text = null } = {}) {
  const normalizedField = normalizeOptionalText(field)?.toLowerCase() ?? "";
  const normalizedKind = normalizeOptionalText(kind)?.toLowerCase() ?? "";
  const normalizedSummary = normalizeOptionalText(summary || text)?.toLowerCase() ?? "";
  const normalizedTags = (Array.isArray(tags) ? tags : []).map((item) => normalizeOptionalText(item)?.toLowerCase()).filter(Boolean);
  const result = new Set();

  if (
    normalizedField.includes("candidate") ||
    normalizedField === "memory" ||
    normalizedField.includes(".memory") ||
    normalizedField.includes("_memory") ||
    normalizedField.includes("memory.") ||
    normalizedKind.includes("candidate") ||
    normalizedKind === "memory" ||
    normalizedTags.includes("candidate") ||
    normalizedTags.includes("memory") ||
    MEMORY_REFERENT_ALIASES.some((alias) => normalizedSummary.includes(alias))
  ) {
    result.add("memory");
  }
  if (
    normalizedField.includes("company") ||
    normalizedField === "context" ||
    normalizedField.includes(".context") ||
    normalizedField.includes("_context") ||
    normalizedField.includes("context.") ||
    normalizedKind.includes("company") ||
    normalizedKind === "context" ||
    normalizedTags.includes("company") ||
    normalizedTags.includes("context") ||
    CONTEXT_REFERENT_ALIASES.some((alias) => normalizedSummary.includes(alias))
  ) {
    result.add("context");
  }
  if (
    normalizedField.includes("match") ||
    normalizedField.includes("decision") ||
    normalizedKind.includes("recommend") ||
    normalizedKind.includes("match") ||
    normalizedTags.includes("matching") ||
    /建议|推荐|匹配/u.test(normalizedSummary)
  ) {
    result.add("match");
  }
  if (
    normalizedField.includes("next_action") ||
    normalizedField.includes("coordination_action") ||
    normalizedKind.includes("action") ||
    normalizedTags.includes("next_action") ||
    normalizedTags.includes("coordination") ||
    /下一步|动作/u.test(normalizedSummary)
  ) {
    result.add("flow");
  }
  if (
    normalizedField.includes("decision") ||
    normalizedKind.includes("decision") ||
    normalizedTags.includes("decision") ||
    /决策|决定|结论/u.test(normalizedSummary)
  ) {
    result.add("decision");
  }
  if (
    normalizedField.includes("policy") ||
    normalizedKind.includes("policy") ||
    normalizedTags.includes("policy") ||
    /策略|规则|policy/u.test(normalizedSummary)
  ) {
    result.add("policy");
  }

  return Array.from(result);
}

function addReferentEvidence(referent, { field = null, tags = [], summary = null, sentenceIndex = null } = {}) {
  if (!referent) {
    return;
  }
  const normalizedField = normalizeOptionalText(field) ?? null;
  if (normalizedField && !referent.sourceFields.includes(normalizedField)) {
    referent.sourceFields.push(normalizedField);
  }
  for (const tag of Array.isArray(tags) ? tags : []) {
    const normalizedTag = normalizeOptionalText(tag) ?? null;
    if (normalizedTag && !referent.tags.includes(normalizedTag)) {
      referent.tags.push(normalizedTag);
    }
  }
  if (normalizeOptionalText(summary)) {
    referent.lastMentionText = normalizeOptionalText(summary);
  }
  if (Number.isFinite(Number(sentenceIndex))) {
    referent.lastMentionSentenceIndex = Number(sentenceIndex);
  }
}

export function buildDiscourseState({ supportCorpus = [] } = {}) {
  const state = cloneDiscourseState(null);
  for (const kind of Object.keys(REFERENT_DEFINITIONS)) {
    ensureReferent(state, kind);
  }
  for (const candidate of Array.isArray(supportCorpus) ? supportCorpus : []) {
    const referentKinds = inferReferentKinds({
      field: candidate?.field,
      tags: candidate?.tags,
      kind: candidate?.kind,
      summary: candidate?.summary,
      text: candidate?.text,
    });
    for (const referentKind of referentKinds) {
      const referent = ensureReferent(state, referentKind);
      addReferentEvidence(referent, {
        field: candidate?.field,
        tags: candidate?.tags,
        summary: candidate?.summary || candidate?.text || null,
      });
      referent.mentionCount += 1;
      if (!state.activeReferentIds.includes(referent.referentId)) {
        state.activeReferentIds.push(referent.referentId);
      }
    }
  }
  return state;
}

function matchReferentFromSubjectText(subject = null, rawText = null) {
  const normalizedSubject = normalizeAliasValue(subject);
  const normalizedKind = normalizeReferentKind(normalizedSubject);
  if (normalizedKind && REFERENT_DEFINITIONS[normalizedKind]) {
    return normalizedKind;
  }
  const normalizedRawText = normalizeOptionalText(rawText) ?? "";
  for (const definition of Object.values(REFERENT_DEFINITIONS)) {
    if ((definition.aliases || []).some((alias) => normalizedSubject && normalizeAliasValue(alias) === normalizedSubject)) {
      return definition.kind;
    }
  }
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
    return "context";
  }
  if (MEMORY_REFERENT_ALIASES.some((alias) => normalizedRawText.includes(alias))) {
    return "memory";
  }
  return null;
}

export function resolveDiscourseSubject(subject = null, { discourseState = null, fallback = null, rawText = null } = {}) {
  const state = cloneDiscourseState(discourseState);
  const referentKind = matchReferentFromSubjectText(subject, rawText) ?? matchReferentFromSubjectText(fallback, rawText);
  if (referentKind) {
    const referent = ensureReferent(state, referentKind);
    return {
      subject: referent?.label ?? normalizeOptionalText(subject) ?? normalizeOptionalText(fallback) ?? null,
      discourseRefs: referent?.referentId ? [referent.referentId] : [],
      referentKind,
    };
  }
  return {
    subject: normalizeOptionalText(subject) ?? normalizeOptionalText(fallback) ?? null,
    discourseRefs: [],
    referentKind: null,
  };
}

export function updateDiscourseStateFromPropositions(discourseState = null, propositions = [], { sentenceIndex = null } = {}) {
  const state = cloneDiscourseState(discourseState);
  for (const proposition of Array.isArray(propositions) ? propositions : []) {
    const referentKind =
      matchReferentFromSubjectText(proposition?.subject, proposition?.rawText) ??
      inferReferentKinds({
        field: proposition?.field,
        kind: proposition?.predicate,
        summary: proposition?.rawText,
      })[0] ??
      null;
    if (!referentKind) {
      continue;
    }
    const referent = ensureReferent(state, referentKind);
    referent.mentionCount += 1;
    addReferentEvidence(referent, {
      field: proposition?.field,
      summary: proposition?.rawText || proposition?.sentence || null,
      sentenceIndex,
    });
    state.activeReferentIds = [referent.referentId, ...state.activeReferentIds.filter((item) => item !== referent.referentId)].slice(0, 6);
    state.lastUpdatedSentenceIndex = Number.isFinite(Number(sentenceIndex)) ? Number(sentenceIndex) : state.lastUpdatedSentenceIndex;
  }
  return state;
}

export function summarizeDiscourseState(discourseState = null) {
  const state = cloneDiscourseState(discourseState);
  return {
    activeReferentIds: state.activeReferentIds,
    referents: Object.values(state.referents || {}).map((referent) => ({
      referentId: referent.referentId,
      kind: referent.kind,
      label: referent.label,
      mentionCount: referent.mentionCount,
      lastMentionText: referent.lastMentionText,
      lastMentionSentenceIndex: referent.lastMentionSentenceIndex,
      sourceFields: referent.sourceFields.slice(0, 4),
    })),
    lastUpdatedSentenceIndex: state.lastUpdatedSentenceIndex,
  };
}

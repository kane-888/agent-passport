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

const REFERENT_DEFINITIONS = {
  candidate: {
    kind: "candidate",
    label: "当前记忆",
    aliases: MEMORY_REFERENT_ALIASES,
  },
  company: {
    kind: "company",
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

function cloneDiscourseState(state = null) {
  if (!state || typeof state !== "object") {
    return {
      referents: {},
      activeReferentIds: [],
      lastUpdatedSentenceIndex: null,
    };
  }
  return {
    referents: Object.fromEntries(
      Object.entries(state.referents || {}).map(([key, referent]) => [
        key,
        {
          ...referent,
          aliases: Array.isArray(referent?.aliases) ? referent.aliases.slice() : [],
          sourceFields: Array.isArray(referent?.sourceFields) ? referent.sourceFields.slice() : [],
          tags: Array.isArray(referent?.tags) ? referent.tags.slice() : [],
        },
      ])
    ),
    activeReferentIds: Array.isArray(state.activeReferentIds) ? state.activeReferentIds.slice() : [],
    lastUpdatedSentenceIndex: Number.isFinite(Number(state.lastUpdatedSentenceIndex)) ? Number(state.lastUpdatedSentenceIndex) : null,
  };
}

function buildReferentRecord(kind, extras = {}) {
  const definition = REFERENT_DEFINITIONS[kind];
  if (!definition) {
    return null;
  }
  return {
    referentId: `disc_${kind}`,
    kind,
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
  if (!REFERENT_DEFINITIONS[kind]) {
    return null;
  }
  if (!state.referents[kind]) {
    state.referents[kind] = buildReferentRecord(kind);
  }
  return state.referents[kind];
}

function inferReferentKinds({ field = null, tags = [], summary = null, kind = null, text = null } = {}) {
  const normalizedField = normalizeOptionalText(field)?.toLowerCase() ?? "";
  const normalizedKind = normalizeOptionalText(kind)?.toLowerCase() ?? "";
  const normalizedSummary = normalizeOptionalText(summary || text)?.toLowerCase() ?? "";
  const normalizedTags = (Array.isArray(tags) ? tags : []).map((item) => normalizeOptionalText(item)?.toLowerCase()).filter(Boolean);
  const result = new Set();

  if (
    normalizedField.includes("candidate") ||
    normalizedKind.includes("candidate") ||
    normalizedTags.includes("candidate") ||
    MEMORY_REFERENT_ALIASES.some((alias) => normalizedSummary.includes(alias))
  ) {
    result.add("candidate");
  }
  if (
    normalizedField.includes("company") ||
    normalizedKind.includes("company") ||
    normalizedTags.includes("company") ||
    CONTEXT_REFERENT_ALIASES.some((alias) => normalizedSummary.includes(alias))
  ) {
    result.add("company");
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
    return "company";
  }
  if (MEMORY_REFERENT_ALIASES.some((alias) => normalizedRawText.includes(alias))) {
    return "candidate";
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

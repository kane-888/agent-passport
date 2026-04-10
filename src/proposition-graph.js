import { normalizeComparableText, normalizeOptionalText } from "./ledger-core-utils.js";
import { inferPropositionEpistemicStatus, normalizeEpistemicStatus } from "./epistemic-status.js";
import {
  buildDiscourseState,
  updateDiscourseStateFromPropositions,
} from "./discourse-state.js";
import { buildClauseScopes, buildNegationScope, buildQuantifierScope } from "./negation-scope.js";
import {
  buildCanonicalPropositionText,
  buildPropositionNormalizationMetadata,
  normalizePropositionQuantifier,
  normalizePropositionSurfaceText,
  resolveNormalizedPropositionSubject,
  stripLeadingClauseConnector,
} from "./proposition-normalizer.js";

export const DEFAULT_PROPOSITION_BINDING_MIN_SCORE = 0.28;

export const DEFAULT_PROPOSITION_PREAMBLE_PATTERNS = [
  /^(?:这件事|这个结论|该判断|这个结果)?(?:已经证实了?|已证实|已经证明了?|confirmed|proven|verified)[，,、:\s]*/iu,
  /^(?:从当前|根据当前|结合当前|现有)(?:招聘|业务|链路|上下文|记忆|信息){0,3}(?:看|显示|链路显示|信息显示)?[，,、:\s]*/u,
  /^(?:可以确认的是|需要说明的是|目前看|当前看)[，,、:\s]*/u,
];

export const DEFAULT_PROPOSITION_PATTERNS = [
  {
    predicate: "candidate_prefers_destination",
    subjectFallback: "候选人",
    regexes: [
      /(?<negation>不是|并非)\s*(?<quantifier>所有|全部)\s*(?<subject>候选人|该候选人|人选)(?:都|均|也都)?(?:\s|目前|现在|仍然|依然|可能|大概|也许|也|还)*(?:更想去|想去|更偏向|更倾向(?:于)?|倾向于?去|偏向?|偏)(?<object>[^，,。；;]+)/u,
      /(?<!不是)(?<!并非)(?:(?<quantifier>所有|全部|至少(?:\d+位?|一位|两位|三位)|至多(?:\d+位?|一位|两位|三位)|仅(?:\d+位?|一位|两位|三位)|只有(?:\d+位?|一位|两位|三位)|大多数|多数|部分|少数|一半|其中一位|另一位|另一名|前者|后者|其余人选)\s*)?(?:(?<subject>候选人|该候选人|人选|他|她|其中一位|另一位|另一名|前者|后者|其余人选)(?:都|均|也都)?(?:\s|目前|现在|仍然|依然|可能|大概|也许|也|还)*)?(?<negation>不|不会|不太)?(?:更想去|想去|更偏向|更倾向(?:于)?|倾向于?去|偏向?|偏)(?<object>[^，,。；;]+)/u,
      /(?:(?<subject>当前记忆|记忆焦点|当前记忆焦点|记忆锚点|上下文焦点|运行焦点|当前焦点|记忆)(?:都|均|也都)?(?:\s|目前|现在|仍然|依然|也|还)*)?(?<negation>不|不会|不再)?(?:更聚焦|聚焦|聚焦于|聚焦在|焦点在|锚定在|落在|对齐到|集中在|更关注|关注)(?<object>[^，,。；;]+)/u,
    ],
  },
  {
    predicate: "company_requires_destination",
    subjectFallback: "目标上下文",
    regexes: [
      /(?<subject>目标上下文|任务上下文|运行上下文|目标语境|上下文锚点|目标环境)(?:都|均|也都)?(?:\s|目前|现在|仍然|依然|也|还)*(?<negation>不|不会|不再)?(?:在|位于|落在|锚定在|对齐到)(?<object>[^，,。；;]+)/u,
      /(?<subject>岗位|工作地|目标上下文|任务上下文|运行上下文|目标语境)(?:都|均|也都)?(?:\s|目前|现在|仍然|依然|也|还)*(?:在|位于)(?<object>[^，,。；;]+)/u,
    ],
  },
  {
    predicate: "candidate_accepts_offer",
    subjectFallback: "候选人",
    regexes: [
      /(?<negation>不是|并非)\s*(?<quantifier>所有|全部)\s*(?<subject>候选人|该候选人|人选)(?:都|均|也都)?(?:\s|可能|大概|也许|仍然|依然|也|还)*(?:接受|接受了|会接受|愿意接受)(?<object>[^，,。；;]+)/u,
      /(?<!不是)(?<!并非)(?:(?<quantifier>所有|全部|至少(?:\d+位?|一位|两位|三位)|至多(?:\d+位?|一位|两位|三位)|仅(?:\d+位?|一位|两位|三位)|只有(?:\d+位?|一位|两位|三位)|大多数|多数|部分|少数|一半|其中一位|另一位|另一名|前者|后者|其余人选)\s*)?(?:(?<subject>候选人|该候选人|人选|他|她|其中一位|另一位|另一名|前者|后者|其余人选)(?:都|均|也都)?(?:\s|可能|大概|也许|仍然|依然|也|还)*)?(?<negation>不|不会|未|没有|尚未)?(?:接受|接受了|会接受|愿意接受)(?<object>[^，,。；;]+)/u,
    ],
  },
  {
    predicate: "candidate_interview_progress",
    subjectFallback: "候选人",
    regexes: [
      /(?<negation>不是|并非)\s*(?<quantifier>所有|全部)\s*(?<subject>候选人|该候选人|人选)(?:都|均|也都)?(?:\s|目前|现在|已经|已|也|还)*(?:已经|已)?完成(?<object>[^，,。；;]+)/u,
      /(?<!不是)(?<!并非)(?:(?<quantifier>所有|全部|至少(?:\d+位?|一位|两位|三位)|至多(?:\d+位?|一位|两位|三位)|仅(?:\d+位?|一位|两位|三位)|只有(?:\d+位?|一位|两位|三位)|大多数|多数|部分|少数|一半|其中一位|另一位|另一名|前者|后者|其余人选)\s*)?(?:(?<subject>候选人|该候选人|人选|他|她|其中一位|另一位|另一名|前者|后者|其余人选)(?:都|均|也都)?(?:\s|目前|现在|已经|已|也|还)*)?(?<negation>未|没有|尚未|不)?(?:已经|已)?完成(?<object>[^，,。；;]+)/u,
    ],
  },
  {
    predicate: "candidate_availability",
    subjectFallback: "候选人",
    regexes: [
      /(?:(?<quantifier>所有|全部|至少(?:\d+位?|一位|两位|三位)|至多(?:\d+位?|一位|两位|三位)|仅(?:\d+位?|一位|两位|三位)|只有(?:\d+位?|一位|两位|三位)|大多数|多数|部分|少数|一半|其中一位|另一位|另一名|前者|后者|其余人选)\s*)?(?:(?<subject>候选人|该候选人|人选|他|她|其中一位|另一位|另一名|前者|后者|其余人选)(?:都|均|也都)?(?:\s|目前|现在|仍然|依然|也|还)*)?(?<negation>不|不会|不能|无法)?(?:预计|可于|可以|可在|能在|将在|会在|计划在|最快|最早)?(?<object>(?:\d+天内|\d+周内|一周内|两周内|三周内|本周内|下周内|近期|尽快)[^，,。；;]{0,10}(?:到岗|入职|开始))/u,
    ],
  },
  {
    predicate: "next_action",
    subjectFallback: "流程",
    regexes: [
      /(?:下一步|接下来)(?<negation>不应该|不应当|不应|不建议|无需|不用|不能)?(?:应该|应当|需要|建议)?(?<object>[^，,。；;]+)/u,
      /动作[:：]?(?<object>[^，,。；;]+)/u,
    ],
  },
  {
    predicate: "recommendation",
    subjectFallback: "匹配结果",
    regexes: [
      /(?<negation>不)?建议(?<object>[^，,。；;]+)/u,
      /(?<negation>不)?推荐(?<object>[^，,。；;]+)/u,
    ],
  },
  {
    predicate: "match_score",
    subjectFallback: "匹配结果",
    regexes: [
      /分数[:：]?(?<object>\d{1,3})/u,
      /匹配分[:：]?(?<object>\d{1,3})/u,
    ],
  },
];

function stripLeadingCausalConnector(text = "") {
  return (normalizeOptionalText(text) ?? "").replace(/^(?:因此|所以|因而|于是|故而|therefore|thus|so)\s*/iu, "").trim();
}

export function normalizeVerificationBindingValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeOptionalText(item) ?? String(item ?? "")).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return normalizeOptionalText(String(value)) ?? null;
    }
  }
  return normalizeOptionalText(value) ?? null;
}

function normalizeVerificationPropositionPredicate(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }
  return normalized.replace(/[^\p{Letter}\p{Number}]+/gu, "_").replace(/^_+|_+$/g, "") || null;
}

function translateVerificationPropositionSubject(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  switch (normalized) {
    case "candidate":
      return "候选人";
    case "company":
      return "企业";
    case "match":
    case "matching":
      return "匹配结果";
    case "flow":
    case "workflow":
    case "process":
      return "流程";
    default:
      return normalizeOptionalText(value) ?? null;
  }
}

function normalizeVerificationPropositionText(value) {
  const bindingValue = normalizeVerificationBindingValue(value);
  return normalizePropositionSurfaceText(
    typeof bindingValue === "string"
      ? bindingValue
      : typeof bindingValue === "number" || typeof bindingValue === "boolean"
        ? String(bindingValue)
        : Array.isArray(bindingValue)
          ? bindingValue.join(" / ")
          : value,
    { role: "object" }
  );
}

function normalizeVerificationPropositionSubject(value, fallback = null) {
  return normalizeVerificationPropositionText(translateVerificationPropositionSubject(value) || translateVerificationPropositionSubject(fallback));
}

function inferCounterfactualFromText(text = "") {
  return /(?:如果|假如|要是|设想|若|假设|一旦)/u.test(normalizeOptionalText(text) ?? "");
}

function inferQuantifier(text = "") {
  const normalized = normalizeOptionalText(text) ?? "";
  const patterns = [
    /(不是|并非)\s*(所有|全部)(?:候选人|人选)?/u,
    /(所有|全部)(?:候选人|人选)?/u,
    /(大多数|多数|部分|少数)(?:候选人|人选)?/u,
    /(至少(?:\d+位?|一位|两位|三位)|至多(?:\d+位?|一位|两位|三位)|仅(?:\d+位?|一位|两位|三位)|只有(?:\d+位?|一位|两位|三位))(?:候选人|人选)?/u,
    /(其中一位|另一位|另一名|前者|后者|其余人选)/u,
    /(一半)(?:候选人|人选)?/u,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[0]) {
      return match[0];
    }
  }
  return null;
}

function inferTense(text = "", predicate = "") {
  const normalized = normalizeOptionalText(text) ?? "";
  if (/下一步|接下来|将会|即将|预计|将在|会在|计划在|到岗|入职/u.test(normalized) || predicate === "next_action" || predicate === "candidate_availability") {
    return "future";
  }
  if (/已经|已|刚刚|刚/u.test(normalized)) {
    return "past";
  }
  return "present";
}

function inferModality({ predicate = "", rawText = "", counterfactual = false } = {}) {
  const normalizedText = normalizeOptionalText(rawText) ?? "";
  if (counterfactual) {
    return "counterfactual";
  }
  if (predicate === "recommendation") {
    return "recommendation";
  }
  if (predicate === "next_action") {
    return "plan";
  }
  if (/可能|也许|大概|推测/u.test(normalizedText)) {
    return "hedged";
  }
  return "asserted";
}

function inferEvidentiality(epistemicStatus = null) {
  switch (epistemicStatus) {
    case "confirmed":
      return "confirmed_local_support";
    case "observed":
      return "observed";
    case "reported":
      return "reported";
    case "inferred":
      return "inferred";
    case "planned":
    case "decided":
      return "decision_trace";
    case "contested":
      return "conflicted_external_support";
    case "rejected":
      return "rejected_external_support";
    case "counterfactual":
      return "simulated";
    default:
      return null;
  }
}

export function buildVerificationPropositionRecord({
  subject = null,
  subjectFallback = null,
  predicate = null,
  object = null,
  polarity = "affirmed",
  rawText = null,
  sentence = null,
  sentenceIndex = null,
  claimKey = null,
  field = null,
  extractedBy = "pattern",
  epistemicStatus = null,
  sourceType = null,
  sourceKind = null,
  verifiedEquivalent = false,
  quantifier = null,
  tense = null,
  modality = null,
  counterfactual = false,
  discourseRefs = [],
  discourseState = null,
  negationScope = null,
  quantifierScope = null,
  clauseText = null,
} = {}) {
  const normalizedPredicate = normalizeVerificationPropositionPredicate(predicate);
  const normalizedObject = normalizeVerificationPropositionText(object);
  if (!normalizedPredicate || !normalizedObject) {
    return null;
  }
  const rawTextValue = normalizeOptionalText(rawText) ?? normalizedObject;
  const normalizedQuantifier =
    normalizePropositionQuantifier(quantifierScope?.cue) ??
    normalizePropositionQuantifier(quantifier) ??
    inferQuantifier(rawTextValue);
  const resolvedSubject = resolveNormalizedPropositionSubject({
    subject,
    fallback: subjectFallback,
    predicate: normalizedPredicate,
    rawText: rawTextValue,
    discourseState,
  });
  const normalizedSubject = normalizeVerificationPropositionSubject(resolvedSubject.subject, subjectFallback);
  const inferredCounterfactual =
    counterfactual ||
    inferCounterfactualFromText(rawTextValue) ||
    inferCounterfactualFromText(sentence);
  const propositionEpistemicStatus = inferPropositionEpistemicStatus({
    epistemicStatus,
    predicate: normalizedPredicate,
    field,
    sourceType,
    sourceKind,
    verifiedEquivalent,
    value: object,
    rawText: rawTextValue,
    counterfactual: inferredCounterfactual,
  });
  const predicateKey = normalizeComparableText(normalizedPredicate);
  const objectKey = normalizeComparableText(normalizedObject);
  const subjectKey = normalizeComparableText(normalizedSubject);
  const quantifierKey = normalizeComparableText(normalizedQuantifier) || "none";
  const propositionKey = [
    subjectKey || "none",
    predicateKey,
    objectKey,
    polarity === "negated" ? "negated" : "affirmed",
    quantifierKey,
  ].join("::");
  const resolvedDiscourseRefs = Array.from(
    new Set([
      ...(Array.isArray(discourseRefs) ? discourseRefs : []),
      ...((Array.isArray(resolvedSubject.discourseRefs) ? resolvedSubject.discourseRefs : [])),
    ].filter(Boolean))
  ).slice(0, 6);
  const normalization = buildPropositionNormalizationMetadata({
    predicate: normalizedPredicate,
    subject: normalizedSubject,
    object: normalizedObject,
    polarity,
    quantifier: normalizedQuantifier,
    rawText: normalizeOptionalText(clauseText) ?? rawTextValue,
  });
  const propositionArguments = [
    {
      role: "object",
      value: normalizedObject,
    },
  ];
  if (normalizedQuantifier) {
    propositionArguments.push({
      role: "quantifier",
      value: normalizedQuantifier,
    });
  }
  return {
    propositionId: `prop_${propositionKey.slice(0, 96)}`,
    propositionKey,
    subject: normalizedSubject,
    subjectKey: subjectKey || null,
    predicate: normalizedPredicate,
    predicateKey,
    object: normalizedObject,
    objectKey,
    arguments: propositionArguments,
    polarity: polarity === "negated" ? "negated" : "affirmed",
    rawText: rawTextValue,
    canonicalText: buildCanonicalPropositionText({
      subject: normalizedSubject,
      predicate: normalizedPredicate,
      object: normalizedObject,
      polarity,
      quantifier: normalizedQuantifier,
    }),
    sentence: normalizeOptionalText(sentence) ?? null,
    sentenceIndex: Number.isFinite(Number(sentenceIndex)) ? Number(sentenceIndex) : null,
    claimKey: normalizeOptionalText(claimKey) ?? null,
    field: normalizeOptionalText(field) ?? null,
    extractedBy: normalizeOptionalText(extractedBy) ?? "pattern",
    epistemicStatus: propositionEpistemicStatus,
    modality: modality ?? inferModality({ predicate: normalizedPredicate, rawText: rawTextValue, counterfactual: inferredCounterfactual }),
    quantifier: normalizedQuantifier,
    tense: normalizeOptionalText(tense) ?? inferTense(rawTextValue, normalizedPredicate),
    evidentiality: inferEvidentiality(propositionEpistemicStatus),
    counterfactual: inferredCounterfactual,
    discourseRefs: resolvedDiscourseRefs,
    referentKind: resolvedSubject.referentKind ?? null,
    subjectResolution: resolvedSubject.subjectResolution ?? null,
    normalization,
    negationScope: negationScope && typeof negationScope === "object" ? {
      cue: normalizeOptionalText(negationScope.cue) ?? null,
      scopeKind: normalizeOptionalText(negationScope.scopeKind) ?? null,
      scopeText: normalizeOptionalText(negationScope.scopeText) ?? null,
      objectText: normalizeOptionalText(negationScope.objectText) ?? null,
      clauseText: normalizeOptionalText(negationScope.clauseText) ?? null,
      clauseIndex: Number.isFinite(Number(negationScope.clauseIndex)) ? Number(negationScope.clauseIndex) : null,
      frameType: normalizeOptionalText(negationScope.frameType) ?? null,
      frameRole: normalizeOptionalText(negationScope.frameRole) ?? null,
      frameCue: normalizeOptionalText(negationScope.frameCue) ?? null,
      antecedentText: normalizeOptionalText(negationScope.antecedentText) ?? null,
      consequentText: normalizeOptionalText(negationScope.consequentText) ?? null,
      confidence: Number.isFinite(Number(negationScope.confidence)) ? Number(negationScope.confidence) : null,
    } : null,
    quantifierScope: quantifierScope && typeof quantifierScope === "object" ? {
      cue: normalizeOptionalText(quantifierScope.cue) ?? null,
      family: normalizeOptionalText(quantifierScope.family) ?? null,
      distribution: normalizeOptionalText(quantifierScope.distribution) ?? null,
      subjectText: normalizeOptionalText(quantifierScope.subjectText) ?? null,
      scopeKind: normalizeOptionalText(quantifierScope.scopeKind) ?? null,
      scopeText: normalizeOptionalText(quantifierScope.scopeText) ?? null,
      clauseText: normalizeOptionalText(quantifierScope.clauseText) ?? null,
      clauseIndex: Number.isFinite(Number(quantifierScope.clauseIndex)) ? Number(quantifierScope.clauseIndex) : null,
      frameType: normalizeOptionalText(quantifierScope.frameType) ?? null,
      frameRole: normalizeOptionalText(quantifierScope.frameRole) ?? null,
      frameCue: normalizeOptionalText(quantifierScope.frameCue) ?? null,
      antecedentText: normalizeOptionalText(quantifierScope.antecedentText) ?? null,
      consequentText: normalizeOptionalText(quantifierScope.consequentText) ?? null,
      confidence: Number.isFinite(Number(quantifierScope.confidence)) ? Number(quantifierScope.confidence) : null,
    } : null,
    sourceSpan: {
      text: stripLeadingClauseConnector(rawTextValue),
      sentenceIndex: Number.isFinite(Number(sentenceIndex)) ? Number(sentenceIndex) : null,
    },
  };
}

function pushVerificationSubjectVariants(
  push,
  {
    predicate = null,
    object = null,
    subjectVariants = [],
    claimKey = null,
    field = null,
    extractedBy = "field_mapping",
    epistemicStatus = null,
    sourceType = null,
    sourceKind = null,
    verifiedEquivalent = false,
  } = {}
) {
  const variants = Array.isArray(subjectVariants) ? subjectVariants : [subjectVariants];
  for (const variant of variants) {
    const subject = normalizeOptionalText(typeof variant === "string" ? variant : variant?.subject);
    if (!subject) {
      continue;
    }
    push(
      buildVerificationPropositionRecord({
        subject,
        predicate,
        object,
        rawText: normalizeOptionalText(typeof variant === "string" ? null : variant?.rawText) ?? normalizeVerificationBindingValue(object),
        claimKey,
        field,
        extractedBy,
        epistemicStatus,
        sourceType,
        sourceKind,
        verifiedEquivalent,
      })
    );
  }
}

export function buildVerificationFieldValuePropositions(
  field,
  value,
  { summary = null, claimKey = null, epistemicStatus = null, sourceType = null, sourceKind = null, verifiedEquivalent = false } = {}
) {
  const normalizedField = normalizeOptionalText(field)?.toLowerCase() ?? null;
  const propositions = [];
  const push = (proposition) => {
    if (proposition?.propositionKey && !propositions.some((item) => item.propositionKey === proposition.propositionKey)) {
      propositions.push(proposition);
    }
  };

  switch (normalizedField) {
    case "candidate_city_preference":
    case "candidate.target_city":
      push(
        buildVerificationPropositionRecord({
          subject: "候选人",
          predicate: "candidate_prefers_destination",
          object: value,
          rawText: summary || normalizeVerificationBindingValue(value),
          claimKey,
          field,
          extractedBy: "field_mapping",
          epistemicStatus,
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
      return propositions.filter(Boolean);
    case "agent.focus_city":
      pushVerificationSubjectVariants(push, {
        predicate: "candidate_prefers_destination",
        object: value,
        subjectVariants: [
          { subject: "当前记忆", rawText: `当前记忆焦点在${normalizeVerificationBindingValue(value) || ""}` },
          { subject: "候选人", rawText: `候选人更想去${normalizeVerificationBindingValue(value) || ""}` },
        ],
        claimKey,
        field,
        extractedBy: "field_mapping",
        epistemicStatus,
        sourceType,
        sourceKind,
        verifiedEquivalent,
      });
      return propositions.filter(Boolean);
    case "company.work_city":
      push(
        buildVerificationPropositionRecord({
          subject: "企业",
          predicate: "company_requires_destination",
          object: value,
          rawText: summary || normalizeVerificationBindingValue(value),
          claimKey,
          field,
          extractedBy: "field_mapping",
          epistemicStatus,
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
      return propositions.filter(Boolean);
    case "agent.memory_focus_schema":
      pushVerificationSubjectVariants(push, {
        predicate: "candidate_prefers_destination",
        object: value?.city,
        subjectVariants: [
          { subject: "当前记忆", rawText: `当前记忆焦点在${normalizeVerificationBindingValue(value?.city) || ""}` },
          { subject: "候选人", rawText: `候选人更想去${normalizeVerificationBindingValue(value?.city) || ""}` },
        ],
        claimKey,
        field,
        extractedBy: "schema_mapping",
        epistemicStatus,
        sourceType,
        sourceKind,
        verifiedEquivalent,
      });
      return propositions.filter(Boolean);
    case "candidate_salary_acceptance":
      push(
        buildVerificationPropositionRecord({
          subject: "候选人",
          predicate: "candidate_accepts_offer",
          object: value,
          rawText: summary || normalizeVerificationBindingValue(value),
          claimKey,
          field,
          extractedBy: "field_mapping",
          epistemicStatus,
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
      return propositions.filter(Boolean);
    case "candidate.availability":
      push(
        buildVerificationPropositionRecord({
          subject: "候选人",
          predicate: "candidate_availability",
          object: value,
          rawText: summary || normalizeVerificationBindingValue(value),
          claimKey,
          field,
          extractedBy: "field_mapping",
          epistemicStatus,
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
      return propositions.filter(Boolean);
    case "match.observation_trace":
      pushVerificationSubjectVariants(push, {
        predicate: "candidate_prefers_destination",
        object: value?.candidateCity,
        subjectVariants: [
          { subject: "当前记忆", rawText: `当前记忆焦点在${normalizeVerificationBindingValue(value?.candidateCity) || ""}` },
          { subject: "候选人", rawText: `候选人更想去${normalizeVerificationBindingValue(value?.candidateCity) || ""}` },
        ],
        claimKey,
        field,
        extractedBy: "observation_trace",
        epistemicStatus,
        sourceType,
        sourceKind,
        verifiedEquivalent,
      });
      pushVerificationSubjectVariants(push, {
        predicate: "company_requires_destination",
        object: value?.companyCity,
        subjectVariants: [
          { subject: "目标上下文", rawText: `目标上下文在${normalizeVerificationBindingValue(value?.companyCity) || ""}` },
          { subject: "企业", rawText: `岗位在${normalizeVerificationBindingValue(value?.companyCity) || ""}` },
        ],
        claimKey,
        field,
        extractedBy: "observation_trace",
        epistemicStatus,
        sourceType,
        sourceKind,
        verifiedEquivalent,
      });
      if (value?.score != null) {
        push(
          buildVerificationPropositionRecord({
            subject: "匹配结果",
            predicate: "match_score",
            object: String(value.score),
            rawText: `分数：${value.score}`,
            claimKey,
            field,
            extractedBy: "observation_trace",
            epistemicStatus,
            sourceType,
            sourceKind,
            verifiedEquivalent,
          })
        );
      }
      return propositions.filter(Boolean);
    case "candidate_interview_progress":
      push(
        buildVerificationPropositionRecord({
          subject: "候选人",
          predicate: "candidate_interview_progress",
          object: value,
          rawText: summary || normalizeVerificationBindingValue(value),
          claimKey,
          field,
          extractedBy: "field_mapping",
          epistemicStatus,
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
      return propositions.filter(Boolean);
    case "next_action":
      push(
        buildVerificationPropositionRecord({
          subject: "流程",
          predicate: "next_action",
          object: value,
          rawText: summary || normalizeVerificationBindingValue(value),
          claimKey,
          field,
          extractedBy: "field_mapping",
          epistemicStatus: epistemicStatus ?? "planned",
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
      return propositions.filter(Boolean);
    case "match.action_execution":
      push(
        buildVerificationPropositionRecord({
          subject: "流程",
          predicate: "next_action",
          object: value?.action || value?.nextAction,
          rawText: summary || normalizeVerificationBindingValue(value?.action || value?.nextAction),
          claimKey,
          field,
          extractedBy: "action_execution",
          epistemicStatus: value?.status ?? value?.epistemicStatus ?? "planned",
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
      if (value?.status) {
        push(
          buildVerificationPropositionRecord({
            subject: "决策",
            predicate: "action_execution_status",
            object: value.status,
            rawText: `动作状态：${value.status}`,
            claimKey,
            field,
            extractedBy: "action_execution",
            epistemicStatus: value?.epistemicStatus ?? value?.status ?? epistemicStatus,
            sourceType,
            sourceKind,
            verifiedEquivalent,
          })
        );
      }
      return propositions.filter(Boolean);
    case "match.external_confirmation":
      for (const confirmation of Array.isArray(value?.confirmations) && value.confirmations.length > 0 ? value.confirmations : [value]) {
        const confirmationStatus = confirmation?.status ?? value?.status ?? value?.reconciliation?.effectiveDecisionStatus ?? "confirmed";
        push(
          buildVerificationPropositionRecord({
            subject: "决策",
            predicate: "decision_confirmation",
            object: confirmation?.source || confirmation?.by || confirmation?.message || confirmation?.note,
            rawText:
              summary ||
              [confirmation?.by, confirmation?.source, confirmation?.message, confirmation?.note].filter(Boolean).join(" / "),
            claimKey,
            field,
            extractedBy: "external_confirmation",
            epistemicStatus: confirmationStatus,
            sourceType,
            sourceKind,
            verifiedEquivalent: verifiedEquivalent && confirmationStatus === "confirmed",
          })
        );
      }
      return propositions.filter(Boolean);
    case "match.confirmation_lifecycle": {
      const lifecycleDecisionStatus =
        value?.reconciliation?.effectiveDecisionStatus ??
        value?.reconciliation?.agreementStatus ??
        value?.status ??
        epistemicStatus;
      push(
        buildVerificationPropositionRecord({
          subject: "匹配结果",
          predicate: "recommendation",
          object: value?.recommendation,
          rawText: summary || normalizeVerificationBindingValue(value?.recommendation),
          claimKey,
          field,
          extractedBy: "confirmation_lifecycle",
          epistemicStatus: lifecycleDecisionStatus === "confirmed" ? "confirmed" : lifecycleDecisionStatus === "rejected" ? "rejected" : "decided",
          sourceType,
          sourceKind,
          verifiedEquivalent: verifiedEquivalent && lifecycleDecisionStatus === "confirmed",
        })
      );
      push(
        buildVerificationPropositionRecord({
          subject: "流程",
          predicate: "next_action",
          object: value?.nextAction,
          rawText: summary || normalizeVerificationBindingValue(value?.nextAction),
          claimKey,
          field,
          extractedBy: "confirmation_lifecycle",
          epistemicStatus:
            lifecycleDecisionStatus === "confirmed"
              ? "confirmed"
              : lifecycleDecisionStatus === "rejected"
                ? "rejected"
                : "planned",
          sourceType,
          sourceKind,
          verifiedEquivalent: verifiedEquivalent && lifecycleDecisionStatus === "confirmed",
        })
      );
      for (const entry of Array.isArray(value?.entries) ? value.entries : []) {
        const entryStatus =
          entry?.matchedConfirmationStatus ??
          (entry?.lifecycleStatus === "timed_out" ? "pending" : value?.status ?? "pending");
        push(
          buildVerificationPropositionRecord({
            subject: "决策",
            predicate: "decision_confirmation",
            object: entry?.adapterName || entry?.source || entry?.requestNote || entry?.matchedConfirmationNote,
            rawText:
              [entry?.adapterName, entry?.source, entry?.lifecycleStatus, entry?.requestNote, entry?.matchedConfirmationNote]
                .filter(Boolean)
                .join(" / ") || summary,
            claimKey,
            field,
            extractedBy: "confirmation_lifecycle",
            epistemicStatus: entryStatus,
            sourceType,
            sourceKind,
            verifiedEquivalent: verifiedEquivalent && entryStatus === "confirmed",
          })
        );
      }
      return propositions.filter(Boolean);
    }
    default:
      break;
  }

  if (normalizedField === "candidate.intent_schema" && value && typeof value === "object" && !Array.isArray(value)) {
    push(
      buildVerificationPropositionRecord({
        subject: "候选人",
        predicate: "candidate_prefers_destination",
        object: value.city,
        rawText: summary || normalizeVerificationBindingValue(value.city),
        claimKey,
        field,
        extractedBy: "schema_mapping",
        epistemicStatus,
        sourceType,
        sourceKind,
        verifiedEquivalent,
      })
    );
  }

  if (normalizedField === "company.requirement_schema" && value && typeof value === "object" && !Array.isArray(value)) {
    push(
      buildVerificationPropositionRecord({
        subject: "企业",
        predicate: "company_requires_destination",
        object: value.city,
        rawText: summary || normalizeVerificationBindingValue(value.city),
        claimKey,
        field,
        extractedBy: "schema_mapping",
        epistemicStatus,
        sourceType,
        sourceKind,
        verifiedEquivalent,
      })
    );
  }

  if (normalizedField === "match.fit_schema" && value && typeof value === "object" && !Array.isArray(value)) {
    push(
      buildVerificationPropositionRecord({
        subject: "匹配结果",
        predicate: "recommendation",
        object: value.recommendation,
        rawText: summary || normalizeVerificationBindingValue(value.recommendation),
        claimKey,
        field,
        extractedBy: "schema_mapping",
        epistemicStatus: epistemicStatus ?? "decided",
        sourceType,
        sourceKind,
        verifiedEquivalent,
      })
    );
    if (value.score != null) {
      push(
        buildVerificationPropositionRecord({
          subject: "匹配结果",
          predicate: "match_score",
          object: String(value.score),
          rawText: summary || `分数 ${value.score}`,
          claimKey,
          field,
          extractedBy: "schema_mapping",
          epistemicStatus,
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
    }
  }

  if (normalizedField === "match.decision_provenance" && value && typeof value === "object" && !Array.isArray(value)) {
    const decisionEpistemicStatus = value.epistemicStatus ?? value.status ?? value.decisionStatus ?? epistemicStatus;
    push(
      buildVerificationPropositionRecord({
        subject: "匹配结果",
        predicate: "recommendation",
        object: value.recommendation,
        rawText: summary || normalizeVerificationBindingValue(value.recommendation),
        claimKey,
        field,
        extractedBy: "decision_provenance",
        epistemicStatus: decisionEpistemicStatus,
        sourceType,
        sourceKind,
        verifiedEquivalent,
      })
    );
    push(
      buildVerificationPropositionRecord({
        subject: "流程",
        predicate: "next_action",
        object: value.nextAction,
        rawText: summary || normalizeVerificationBindingValue(value.nextAction),
        claimKey,
        field,
        extractedBy: "decision_provenance",
        epistemicStatus: ["confirmed", "contested", "rejected"].includes(decisionEpistemicStatus)
          ? decisionEpistemicStatus
          : "planned",
        sourceType,
        sourceKind,
        verifiedEquivalent,
      })
    );
    if (value.status) {
      push(
        buildVerificationPropositionRecord({
          subject: "决策",
          predicate: "decision_status",
          object: value.status,
          rawText: `决策状态：${value.status}`,
          claimKey,
          field,
          extractedBy: "decision_provenance",
          epistemicStatus: decisionEpistemicStatus,
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
    }
    const confirmations =
      Array.isArray(value.confirmations) && value.confirmations.length > 0
        ? value.confirmations
        : value.confirmedBy || value.confirmationSource
          ? [{
              by: value.confirmedBy || null,
              source: value.confirmationSource || null,
              note: value.confirmationNote || null,
            }]
          : [];
    for (const confirmation of confirmations) {
      const confirmationStatus = confirmation?.status ?? confirmation?.epistemicStatus ?? "confirmed";
      push(
        buildVerificationPropositionRecord({
          subject: "决策",
          predicate: "decision_confirmation",
          object: confirmation?.by || confirmation?.source || confirmation?.note,
          rawText: `确认来源：${[confirmation?.by, confirmation?.source, confirmation?.note].filter(Boolean).join(" / ")}`,
          claimKey,
          field,
          extractedBy: "decision_provenance",
          epistemicStatus: confirmationStatus,
          sourceType,
          sourceKind,
          verifiedEquivalent: verifiedEquivalent && confirmationStatus === "confirmed",
        })
      );
    }
  }

  if (normalizedField === "match.causal_hypothesis" && value && typeof value === "object" && !Array.isArray(value)) {
    for (const line of [...(Array.isArray(value.effect) ? value.effect : []), ...(Array.isArray(value.cause) ? value.cause : [])]) {
      const normalizedLine = normalizeVerificationPropositionText(line);
      if (!normalizedLine) {
        continue;
      }
      const predicate =
        /^动作/u.test(normalizeOptionalText(line) ?? "")
          ? "next_action"
          : /^建议/u.test(normalizeOptionalText(line) ?? "")
            ? "recommendation"
            : "match_signal";
      push(
        buildVerificationPropositionRecord({
          subject: predicate === "match_signal" ? "匹配证据" : "匹配结果",
          predicate,
          object: normalizedLine,
          rawText: line,
          claimKey,
          field,
          extractedBy: "causal_hypothesis",
          epistemicStatus: predicate === "next_action" ? "planned" : predicate === "recommendation" ? "decided" : epistemicStatus,
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
    }
  }

  if (normalizedField === "match.event_graph" && value && typeof value === "object" && !Array.isArray(value)) {
    for (const node of Array.isArray(value.nodes) ? value.nodes : []) {
      const nodeText = normalizeVerificationPropositionText(node?.text);
      const nodePredicate = normalizeVerificationPropositionPredicate(node?.predicate);
      const nodeObject = normalizeVerificationBindingValue(node?.object);
      if (!nodeText && !nodePredicate) {
        continue;
      }
      const predicate =
        nodePredicate ||
        (/^动作/u.test(normalizeOptionalText(node?.text) ?? "")
          ? "next_action"
          : /^建议/u.test(normalizeOptionalText(node?.text) ?? "")
            ? "recommendation"
            : null);
      if (!predicate) {
        continue;
      }
      push(
        buildVerificationPropositionRecord({
          subject: normalizeOptionalText(node?.subject) ?? "匹配结果",
          predicate,
          object: nodeObject || nodeText,
          rawText: normalizeOptionalText(node?.text) ?? nodeObject,
          claimKey,
          field,
          extractedBy: "event_graph_node",
          epistemicStatus: predicate === "next_action" ? "planned" : "decided",
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
    }
    for (const edge of Array.isArray(value.edges) ? value.edges : []) {
      push(
        buildVerificationPropositionRecord({
          subject: edge?.fromText || edge?.from || null,
          predicate: normalizeOptionalText(edge?.relation) ?? "associative",
          object: edge?.toText || edge?.to || null,
          rawText: [normalizeOptionalText(edge?.fromText), normalizeOptionalText(edge?.relation), normalizeOptionalText(edge?.toText)]
            .filter(Boolean)
            .join(" "),
          claimKey,
          field,
          extractedBy: "event_graph_edge",
          epistemicStatus,
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
    }
  }

  if (propositions.length > 0) {
    return propositions.filter(Boolean);
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const subject = translateVerificationPropositionSubject(normalizedField?.split(/[._]/u)[0] || null);
    for (const [key, item] of Object.entries(value).slice(0, 4)) {
      push(
        buildVerificationPropositionRecord({
          subject,
          predicate: normalizedField ? `${normalizedField.replace(/[.]/gu, "_")}_${key}` : key,
          object: item,
          rawText: summary || `${key}: ${normalizeVerificationBindingValue(item)}`,
          claimKey,
          field,
          extractedBy: "generic_object_field",
          epistemicStatus,
          sourceType,
          sourceKind,
          verifiedEquivalent,
        })
      );
    }
    return propositions.filter(Boolean);
  }

  push(
    buildVerificationPropositionRecord({
      subject: translateVerificationPropositionSubject(normalizedField?.split(/[._]/u)[0] || null),
      predicate: normalizedField ? normalizedField.replace(/[.]/gu, "_") : "statement",
      object: value,
      rawText: summary || normalizeVerificationBindingValue(value),
      claimKey,
      field,
      extractedBy: "generic_field",
      epistemicStatus,
      sourceType,
      sourceKind,
      verifiedEquivalent,
    })
  );

  return propositions.filter(Boolean);
}

function getVerificationPredicateLexemes(predicate) {
  switch (normalizeVerificationPropositionPredicate(predicate)) {
    case "candidate_prefers_destination":
      return ["想去", "更想去", "更偏向", "更倾向", "偏深圳", "偏上海", "目标城市", "目标地点", "记忆焦点", "聚焦", "锚点"];
    case "candidate_accepts_offer":
      return ["接受", "会接受", "愿意接受"];
    case "candidate_availability":
      return ["到岗", "入职", "预计", "两周内", "一周内"];
    case "candidate_interview_progress":
      return ["完成", "通过", "进入"];
    case "company_requires_destination":
      return ["岗位在", "工作地", "城市", "到岗", "目标上下文", "上下文锚点", "运行上下文"];
    case "next_action":
      return ["下一步", "接下来", "动作", "安排", "记忆链路推进", "后续记忆校验"];
    case "recommendation":
      return ["建议", "推荐", "继续推进记忆链路", "先补验证再继续记忆链路"];
    case "decision_confirmation":
      return ["确认", "批准", "verified", "confirmed"];
    case "action_execution_status":
      return ["动作状态", "执行状态", "已执行", "已安排", "已创建"];
    case "match_score":
      return ["分数", "匹配分"];
    default:
      return normalizeVerificationPropositionPredicate(predicate)?.split("_").filter(Boolean) || [];
  }
}

export function stripVerificationPropositionPreamble(text = "") {
  let normalized = stripLeadingCausalConnector(normalizeOptionalText(text) ?? "");
  for (const pattern of DEFAULT_PROPOSITION_PREAMBLE_PATTERNS) {
    normalized = normalized.replace(pattern, "").trim();
  }
  return normalized;
}

export function buildSupportPropositionCorpus(supportCorpus = []) {
  const propositions = [];
  let discourseState = buildDiscourseState({ supportCorpus });
  for (const candidate of supportCorpus || []) {
    const fieldPropositions = buildVerificationFieldValuePropositions(candidate?.field, candidate?.value, {
      summary: candidate?.summary,
      claimKey: candidate?.claimKey,
      epistemicStatus: candidate?.epistemicStatus,
      sourceType: candidate?.sourceType,
      sourceKind: candidate?.sourceKind,
      verifiedEquivalent: candidate?.verifiedEquivalent === true,
    });
    const extractedPropositions =
      fieldPropositions.length > 0
        ? fieldPropositions
        : extractSentencePropositions(candidate?.summary || candidate?.text || candidate?.valueText || "", {
            sentenceIndex: null,
            supportPropositionCorpus: [],
            discourseState,
            sourceType: candidate?.sourceType,
            sourceKind: candidate?.sourceKind,
            epistemicStatus: candidate?.epistemicStatus,
            verifiedEquivalent: candidate?.verifiedEquivalent === true,
          });
    for (const proposition of extractedPropositions) {
      if (!proposition?.propositionKey) {
        continue;
      }
      propositions.push({
        ...proposition,
        supportId: candidate.supportId,
        supportCandidate: candidate,
      });
    }
    discourseState = updateDiscourseStateFromPropositions(discourseState, extractedPropositions, { sentenceIndex: null });
  }
  return propositions;
}

function collectRegexMatches(regex, text = "") {
  const sourceText = normalizeOptionalText(text) ?? "";
  if (!sourceText) {
    return [];
  }
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  return Array.from(sourceText.matchAll(matcher));
}

export function resolveBoundPropositionEpistemicStatus(proposition = {}, supportSummary = {}) {
  const currentStatus = normalizeEpistemicStatus(proposition?.epistemicStatus) ?? proposition?.epistemicStatus ?? null;
  const topSupportStatus = normalizeEpistemicStatus(supportSummary?.topSupport?.epistemicStatus) ?? supportSummary?.topSupport?.epistemicStatus ?? null;
  const verifiedEquivalentCount = Number.isFinite(Number(supportSummary?.verifiedEquivalentCount))
    ? Number(supportSummary.verifiedEquivalentCount)
    : 0;

  if (proposition?.predicate === "recommendation" && topSupportStatus === "confirmed" && verifiedEquivalentCount > 0) {
    return "confirmed";
  }
  if (proposition?.predicate === "next_action" && topSupportStatus === "confirmed" && verifiedEquivalentCount > 0) {
    return "confirmed";
  }
  if (
    ["recommendation", "next_action"].includes(proposition?.predicate) &&
    ["contested", "rejected"].includes(topSupportStatus)
  ) {
    return topSupportStatus;
  }
  return currentStatus;
}

export function extractSentencePropositions(
  sentence = "",
  {
    sentenceIndex = null,
    supportPropositionCorpus = [],
    discourseState = null,
    sourceType = null,
    sourceKind = null,
    epistemicStatus = null,
    verifiedEquivalent = false,
  } = {}
) {
  const rawSentence = normalizeOptionalText(sentence) ?? null;
  if (!rawSentence) {
    return [];
  }

  const normalizedSentence = stripVerificationPropositionPreamble(rawSentence);
  const clauseScopes = buildClauseScopes(normalizedSentence);
  const propositions = [];
  const seen = new Set();
  let activeDiscourseState = discourseState;
  const push = (proposition) => {
    if (!proposition?.propositionKey || seen.has(proposition.propositionKey)) {
      return;
    }
    seen.add(proposition.propositionKey);
    propositions.push(proposition);
    activeDiscourseState = updateDiscourseStateFromPropositions(activeDiscourseState, [proposition], { sentenceIndex });
  };

  const activeClauses =
    clauseScopes.length > 0
      ? clauseScopes
      : [
          {
            clauseIndex: 0,
            clauseText: normalizedSentence,
            scopeText: normalizedSentence,
          },
        ];

  for (const clauseScope of activeClauses) {
    const clauseText = normalizeOptionalText(clauseScope?.clauseText) ?? normalizedSentence;
    const normalizedClauseText = stripLeadingClauseConnector(clauseText);
    if (!normalizedClauseText) {
      continue;
    }
    for (const pattern of DEFAULT_PROPOSITION_PATTERNS) {
      for (const regex of pattern.regexes || []) {
        for (const match of collectRegexMatches(regex, normalizedClauseText)) {
          const groups = match.groups || {};
          const negationScope = buildNegationScope({
            sentence: rawSentence,
            clauseText: normalizedClauseText,
            clauseIndex: clauseScope?.clauseIndex ?? null,
            matchedText: match[0],
            objectText: groups.object,
            explicitNegation: groups.negation,
            predicate: pattern.predicate,
          });
          const quantifierScope = buildQuantifierScope({
            sentence: rawSentence,
            clauseText: normalizedClauseText,
            clauseIndex: clauseScope?.clauseIndex ?? null,
            matchedText: match[0],
            explicitQuantifier: groups.quantifier,
            subjectText: groups.subject || pattern.subjectFallback,
            predicate: pattern.predicate,
          });
          push(
            buildVerificationPropositionRecord({
              subject: groups.subject || null,
              subjectFallback: pattern.subjectFallback,
              predicate: pattern.predicate,
              object: negationScope.objectText || groups.object,
              polarity: negationScope.isNegated ? "negated" : "affirmed",
              rawText: match[0],
              clauseText: normalizedClauseText,
              sentence: rawSentence,
              sentenceIndex,
              extractedBy: "pattern",
              discourseState: activeDiscourseState,
              negationScope,
              quantifier: groups.quantifier,
              quantifierScope,
              epistemicStatus,
              sourceType,
              sourceKind,
              verifiedEquivalent,
            })
          );
        }
      }
    }
  }

  if (propositions.length > 0) {
    return propositions.slice(0, 4);
  }

  const comparableSentence = normalizeComparableText(normalizedSentence);
  for (const supportProposition of supportPropositionCorpus || []) {
    const objectMatch =
      supportProposition?.objectKey &&
      comparableSentence &&
      (comparableSentence.includes(supportProposition.objectKey) || supportProposition.objectKey.includes(comparableSentence));
    const subjectMatch =
      !supportProposition?.subjectKey ||
      (comparableSentence && comparableSentence.includes(supportProposition.subjectKey));
    const predicateCueMatch = getVerificationPredicateLexemes(supportProposition?.predicate).some((item) => {
      const comparableCue = normalizeComparableText(item);
      return comparableCue && comparableSentence.includes(comparableCue);
    });
    if (!objectMatch || (!subjectMatch && !predicateCueMatch)) {
      continue;
    }
    push(
      buildVerificationPropositionRecord({
        subject: supportProposition.subject,
        subjectFallback: supportProposition.subject,
        predicate: supportProposition.predicate,
        object: supportProposition.object,
        polarity: supportProposition.polarity,
        rawText: rawSentence,
        sentence: rawSentence,
        sentenceIndex,
        claimKey: supportProposition.claimKey,
        field: supportProposition.field,
        extractedBy: "support_alignment",
        discourseState: activeDiscourseState,
        epistemicStatus: supportProposition.epistemicStatus,
        sourceType: supportProposition.sourceType,
        sourceKind: supportProposition.sourceKind,
        verifiedEquivalent: supportProposition.verifiedEquivalent === true,
      })
    );
  }

  return propositions.slice(0, 4);
}

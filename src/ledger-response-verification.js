import {
  cloneJson,
  normalizeComparableText,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  compareTextSimilarity,
} from "./ledger-text-similarity.js";
import {
  DEFAULT_INTERNAL_GENERATION_RISK_HIGH_THRESHOLD,
  buildSourceMonitoringSnapshot,
  isExternalLikeSupport,
  isLowRealitySupport,
  resolvePassportSourceFeatures,
} from "./ledger-source-monitoring-views.js";
import {
  normalizePassportMemoryLayer,
  normalizePassportMemorySourceType,
  normalizePassportSourceFeatures,
} from "./ledger-passport-memory-rules.js";
import {
  buildResponseCertaintySignal,
} from "./ledger-response-certainty.js";
import {
  extractClaimValueFromText,
  mapPassportFieldToClaimKey,
  splitResponseIntoSentences,
} from "./ledger-claim-extraction.js";
import {
  didMethodFromReference,
  resolveAgentDidForMethod,
} from "./ledger-credential-core.js";
import {
  normalizeDidMethod,
} from "./protocol.js";
import {
  buildEpistemicStatusCounts,
  inferEpistemicStatus,
} from "./epistemic-status.js";
import {
  DEFAULT_PROPOSITION_BINDING_MIN_SCORE,
  buildSupportPropositionCorpus,
  extractSentencePropositions,
  normalizeVerificationBindingValue,
  resolveBoundPropositionEpistemicStatus,
} from "./proposition-graph.js";
import {
  buildCounterfactualTraces,
} from "./counterfactual-trace.js";
import {
  buildDiscourseState,
  summarizeDiscourseState,
  updateDiscourseStateFromPropositions,
} from "./discourse-state.js";
import {
  buildDiscourseGraph,
} from "./discourse-graph.js";

const DEFAULT_CAUSAL_CONNECTOR_PATTERNS = [
  {
    label: "because_so",
    regex: /(?:因为|由于|鉴于)\s*(.+?)[，,；;]\s*(?:所以|因此|因而|于是)\s*(.+)$/u,
  },
  {
    label: "therefore",
    regex: /^(.+?)(?:，|,|。|\.)\s*(?:因此|所以|因而|于是|therefore|thus|so)\s+(.+)$/iu,
  },
];
const DEFAULT_CAUSAL_PREFIX_PATTERNS = [
  /^(?:因此|所以|因而|于是|故而|therefore|thus|so)\s*/iu,
];
const DEFAULT_EVENT_GRAPH_NODE_MATCH_THRESHOLD = 0.24;
const DEFAULT_EVENT_GRAPH_MAX_HOPS = 3;
const DEFAULT_RESPONSE_BINDING_MIN_SCORE = 0.18;
const DEFAULT_RESPONSE_STRUCTURAL_BINDING_MIN_SCORE = 0.1;
const DEFAULT_RESPONSE_CLAIM_KEYWORDS = {
  agentId: ["agent id", "agent_id", "agentid", "身份id", "身份 id", "agent"],
  parentAgentId: ["parent", "fork", "父身份", "上级身份", "来源身份"],
  walletAddress: ["wallet", "wallet address", "钱包", "地址", "钱包地址"],
  role: ["role", "角色", "岗位", "职位"],
  displayName: ["displayname", "display name", "name", "名字", "名称"],
  did: ["did", "去中心化身份", "身份标识"],
  authorizationThreshold: ["threshold", "授权阈值", "阈值", "thresholds"],
};
const DEFAULT_PASSPORT_MEMORY_LIMIT = 20;

function mergeUniquePassportMemories(entries = [], limit = DEFAULT_PASSPORT_MEMORY_LIMIT) {
  const merged = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry?.passportMemoryId || seen.has(entry.passportMemoryId)) {
      continue;
    }
    merged.push(entry);
    seen.add(entry.passportMemoryId);
    if (merged.length >= limit) {
      break;
    }
  }
  return merged;
}

export function isVerifiedEquivalentSupport(candidate = {}) {
  return candidate?.verifiedEquivalent === true || candidate?.sourceKind === "identity_fact";
}

export function resolveVerificationSupportAgreementStatus(candidate = {}) {
  const value = candidate?.value && typeof candidate.value === "object" ? candidate.value : null;
  return normalizeOptionalText(
    value?.reconciliation?.agreementStatus ??
    value?.confirmationHealth?.agreementStatus
  ) ?? null;
}

export function resolveVerificationSupportHighAuthorityConflictingCount(candidate = {}) {
  const value = candidate?.value && typeof candidate.value === "object" ? candidate.value : null;
  return Math.max(
    0,
    Math.floor(
      toFiniteNumber(
        value?.reconciliation?.highAuthorityConflictingCount ??
        value?.confirmationHealth?.highAuthorityConflictingCount,
        0
      )
    )
  );
}

export function buildVerificationSupportSummary(supports = []) {
  const activeSupports = Array.isArray(supports) ? supports.filter(Boolean) : [];
  const countBy = (predicate) => activeSupports.filter(predicate).length;
  const topSupport = activeSupports[0] ?? null;
  const confirmationAgreementStatusCounts = {};
  for (const support of activeSupports) {
    const agreementStatus = resolveVerificationSupportAgreementStatus(support);
    if (!agreementStatus) {
      continue;
    }
    confirmationAgreementStatusCounts[agreementStatus] = (confirmationAgreementStatusCounts[agreementStatus] || 0) + 1;
  }
  return {
    totalSupportCount: activeSupports.length,
    verifiedEquivalentCount: countBy((item) => isVerifiedEquivalentSupport(item)),
    verifiedCount: countBy((item) => normalizePassportMemorySourceType(item?.sourceType) === "verified"),
    systemCount: countBy((item) => normalizePassportMemorySourceType(item?.sourceType) === "system"),
    reportedCount: countBy((item) => normalizePassportMemorySourceType(item?.sourceType) === "reported"),
    perceivedCount: countBy((item) => normalizePassportMemorySourceType(item?.sourceType) === "perceived"),
    derivedCount: countBy((item) => normalizePassportMemorySourceType(item?.sourceType) === "derived"),
    inferredCount: countBy((item) => normalizePassportMemorySourceType(item?.sourceType) === "inferred"),
    hotLikeCount: countBy((item) => ["hot", "stabilizing"].includes(normalizeOptionalText(item?.consolidationState) ?? "")),
    destabilizedCount: countBy(
      (item) => normalizeOptionalText(item?.reconsolidationState) === "destabilized"
    ),
    externalLikeCount: countBy((item) => isExternalLikeSupport(item)),
    lowRealityCount: countBy((item) => isLowRealitySupport(item)),
    internallyGeneratedCount: countBy(
      (item) =>
        toFiniteNumber(resolvePassportSourceFeatures(item)?.internalGenerationRisk, item?.internalGenerationRisk ?? 0) >
        DEFAULT_INTERNAL_GENERATION_RISK_HIGH_THRESHOLD
    ),
    confirmationAgreementStatusCounts,
    highAuthorityConflictingSupportCount: activeSupports.reduce(
      (sum, item) => sum + resolveVerificationSupportHighAuthorityConflictingCount(item),
      0
    ),
    epistemicStatusCounts: buildEpistemicStatusCounts(activeSupports),
    topSupport: topSupport
      ? {
          supportId: topSupport.supportId,
          sourceKind: topSupport.sourceKind,
          sourceType: topSupport.sourceType,
          epistemicStatus: topSupport.epistemicStatus ?? null,
          claimKey: topSupport.claimKey ?? null,
          score: topSupport.score ?? null,
          summary: topSupport.summary ?? null,
          sourceFeatures: resolvePassportSourceFeatures(topSupport),
        }
      : null,
  };
}

export function buildIdentityVerificationSupportEntries(agent, { resolvedDid = null } = {}) {
  const identityFields = [
    {
      claimKey: "agentId",
      field: "agent_id",
      value: agent.agentId,
      summary: `agent_id=${agent.agentId}`,
    },
    {
      claimKey: "parentAgentId",
      field: "parent_agent_id",
      value: agent.parentAgentId || "none",
      summary: `parent=${agent.parentAgentId || "none"}`,
    },
    {
      claimKey: "walletAddress",
      field: "wallet_address",
      value: agent.identity?.walletAddress || null,
      summary: agent.identity?.walletAddress ? `wallet=${agent.identity.walletAddress}` : null,
    },
    {
      claimKey: "did",
      field: "did",
      value: resolvedDid || agent.identity?.did || null,
      summary: resolvedDid || agent.identity?.did ? `did=${resolvedDid || agent.identity?.did}` : null,
    },
    {
      claimKey: "role",
      field: "role",
      value: agent.role || null,
      summary: agent.role ? `role=${agent.role}` : null,
    },
    {
      claimKey: "displayName",
      field: "name",
      value: agent.displayName || null,
      summary: agent.displayName ? `name=${agent.displayName}` : null,
    },
    {
      claimKey: "authorizationThreshold",
      field: "authorization_threshold",
      value: agent.identity?.authorizationPolicy?.threshold ?? null,
      summary:
        agent.identity?.authorizationPolicy?.threshold != null
          ? `authorization_threshold=${agent.identity.authorizationPolicy.threshold}`
          : null,
    },
  ];

  return identityFields
    .filter((item) => item.summary && item.value != null)
    .map((item) => ({
      supportId: `identity:${item.field}`,
      sourceKind: "identity_fact",
      layer: "identity",
      kind: "identity_fact",
      field: item.field,
      claimKey: item.claimKey,
      value: item.value,
      valueText: normalizeVerificationBindingValue(item.value),
      summary: item.summary,
      text: [item.summary, ...(DEFAULT_RESPONSE_CLAIM_KEYWORDS[item.claimKey] || [])].join(" "),
      sourceType: "system",
      epistemicStatus: "confirmed",
      verifiedEquivalent: true,
      confidence: 0.99,
      salience: 0.96,
      consolidationState: "consolidated",
      reconsolidationState: null,
      sourceFeatures: normalizePassportSourceFeatures({
        layer: "profile",
        payload: {
          kind: "identity_fact",
          sourceFeatures: {
            modality: "structured_record",
            generationMode: "system_trace",
            perceptualDetailScore: 0.18,
            contextualDetailScore: 0.96,
            cognitiveOperationScore: 0.08,
            socialCorroborationScore: 0.82,
            externalAnchorCount: 3,
          },
        },
        sourceType: "system",
      }),
      recordedAt: now(),
      tags: [item.field, item.claimKey],
    }));
}

export function buildResponseEvidenceBindingCorpus(store, agent, layers, contextBuilder = {}, { resolvedDid = null } = {}) {
  const seen = new Map();
  const pushCandidate = (candidate) => {
    if (!candidate?.supportId || seen.has(candidate.supportId)) {
      return;
    }
    seen.set(candidate.supportId, candidate);
  };

  for (const identityCandidate of buildIdentityVerificationSupportEntries(agent, { resolvedDid })) {
    pushCandidate(identityCandidate);
  }

  const statefulSemanticFields = new Set([
    "match.decision_provenance",
    "match.action_execution",
    "match.external_confirmation",
    "match.confirmation_lifecycle",
  ]);
  const activeStatefulSemanticCandidates = [...(layers?.semantic?.entries || [])]
    .filter((entry) => {
      const field = normalizeOptionalText(entry?.payload?.field) ?? null;
      return field && statefulSemanticFields.has(field) && entry?.status !== "superseded";
    })
    .sort((left, right) => (right.recordedAt || "").localeCompare(left.recordedAt || ""))
    .slice(0, 8);
  const memoryCandidates = [
    ...(layers?.relevant?.profile || []),
    ...(layers?.relevant?.episodic || []),
    ...(layers?.relevant?.semantic || []),
    ...activeStatefulSemanticCandidates,
    ...(layers?.relevant?.working || []),
    ...(layers?.relevant?.ledgerCommitments || []),
  ];

  for (const entry of memoryCandidates) {
    const field = normalizeOptionalText(entry?.payload?.field) ?? null;
    const value = Object.prototype.hasOwnProperty.call(entry?.payload || {}, "value")
      ? entry.payload.value
      : null;
    const valueText = normalizeVerificationBindingValue(value ?? entry?.content ?? entry?.summary);
    const claimKey = mapPassportFieldToClaimKey(field);
    const supportId = entry.passportMemoryId || null;
    if (!supportId) {
      continue;
    }
    pushCandidate({
      supportId,
      sourceKind: "passport_memory",
      layer: normalizePassportMemoryLayer(entry.layer),
      kind: normalizeOptionalText(entry.kind) ?? "passport_memory",
      field,
      claimKey,
      value,
      valueText,
      summary: normalizeOptionalText(entry.summary || entry.content) ?? null,
      text: [
        entry.layer,
        entry.kind,
        field,
        entry.summary,
        entry.content,
        valueText,
        ...(Array.isArray(entry.tags) ? entry.tags : []),
      ]
        .filter(Boolean)
        .join(" "),
      sourceType: normalizePassportMemorySourceType(entry.sourceType),
      epistemicStatus:
        entry.epistemicStatus ??
        inferEpistemicStatus({
          epistemicStatus:
            entry.payload?.epistemicStatus ??
            entry.payload?.value?.epistemicStatus ??
            entry.payload?.value?.status ??
            entry.payload?.value?.decisionStatus,
          sourceType: entry.sourceType,
          field,
          kind: entry.kind,
          value,
          payload: entry,
          verifiedEquivalent: normalizePassportMemorySourceType(entry.sourceType) === "verified",
        }),
      verifiedEquivalent: normalizePassportMemorySourceType(entry.sourceType) === "verified",
      confidence: toFiniteNumber(entry.confidence, 0.5),
      salience: toFiniteNumber(entry.salience, 0.5),
      consolidationState: normalizeOptionalText(entry.consolidationState) ?? null,
      reconsolidationState: normalizeOptionalText(entry?.memoryDynamics?.reconsolidationState) ?? null,
      sourceFeatures: resolvePassportSourceFeatures(entry),
      recordedAt: entry.recordedAt || null,
      tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 6) : [],
    });
  }

  for (const hit of contextBuilder?.localKnowledge?.hits || []) {
    const supportId = normalizeOptionalText(hit?.sourceId) ? `knowledge:${hit.sourceType}:${hit.sourceId}` : null;
    if (!supportId) {
      continue;
    }
    pushCandidate({
      supportId,
      sourceKind: normalizeOptionalText(hit?.sourceType) ?? "knowledge_hit",
      layer: "knowledge",
      kind: normalizeOptionalText(hit?.sourceType) ?? "knowledge_hit",
      field: null,
      claimKey: null,
      value: null,
      valueText: normalizeVerificationBindingValue(hit?.summary || hit?.title),
      summary: normalizeOptionalText(hit?.summary || hit?.title) ?? null,
      text: [hit?.title, hit?.summary, hit?.sourceType].filter(Boolean).join(" "),
      sourceType: hit?.sourceType === "evidence" ? "reported" : "derived",
      epistemicStatus: hit?.sourceType === "evidence" ? "reported" : "inferred",
      verifiedEquivalent: false,
      confidence: Math.max(0.32, Math.min(0.78, toFiniteNumber(hit?.score, 0.4))),
      salience: Math.max(0.3, Math.min(0.76, toFiniteNumber(hit?.score, 0.4))),
      consolidationState: "stabilizing",
      reconsolidationState: null,
      sourceFeatures: normalizePassportSourceFeatures({
        layer: "semantic",
        payload: {
          kind: normalizeOptionalText(hit?.sourceType) ?? "knowledge_hit",
          sourceFeatures: {
            modality: "knowledge_hit",
            generationMode: hit?.sourceType === "evidence" ? "social_report" : "internal_inference",
            perceptualDetailScore: hit?.sourceType === "evidence" ? 0.28 : 0.08,
            contextualDetailScore: hit?.sourceType === "evidence" ? 0.64 : 0.42,
            cognitiveOperationScore: hit?.sourceType === "evidence" ? 0.18 : 0.72,
            socialCorroborationScore: hit?.sourceType === "evidence" ? 0.66 : 0.18,
            externalAnchorCount: hit?.sourceType === "evidence" ? 2 : 1,
          },
        },
        sourceType: hit?.sourceType === "evidence" ? "reported" : "derived",
      }),
      recordedAt: hit?.recordedAt || null,
      tags: [],
    });
  }

  return Array.from(seen.values());
}

export function buildBoundSupportView(candidate = {}, extras = {}) {
  return {
    supportId: candidate.supportId,
    sourceKind: candidate.sourceKind,
    sourceType: candidate.sourceType,
    claimKey: candidate.claimKey ?? null,
    field: candidate.field ?? null,
    score: candidate.score,
    summary: candidate.summary ?? null,
    epistemicStatus: candidate.epistemicStatus ?? null,
    verifiedEquivalent: isVerifiedEquivalentSupport(candidate),
    consolidationState: candidate.consolidationState ?? null,
    reconsolidationState: candidate.reconsolidationState ?? null,
    sourceFeatures: cloneJson(resolvePassportSourceFeatures(candidate)) ?? null,
    ...extras,
  };
}

export function mergeUniqueVerificationSupports(...collections) {
  const merged = new Map();
  for (const collection of collections) {
    for (const candidate of collection || []) {
      if (!candidate?.supportId) {
        continue;
      }
      const existing = merged.get(candidate.supportId);
      if (!existing || toFiniteNumber(candidate.score, 0) > toFiniteNumber(existing.score, 0)) {
        merged.set(candidate.supportId, candidate);
      }
    }
  }
  return Array.from(merged.values()).sort(
    (left, right) => toFiniteNumber(right?.score, 0) - toFiniteNumber(left?.score, 0) || (right?.recordedAt || "").localeCompare(left?.recordedAt || "")
  );
}

export function materializeVerificationSupportRefs(supportRefs = []) {
  return (Array.isArray(supportRefs) ? supportRefs : []).map((item) => ({
    ...((item?.candidate && typeof item.candidate === "object") ? item.candidate : {}),
    score: Number(toFiniteNumber(item?.score, 0).toFixed(4)),
    ...(item?.matchedProposition ? { matchedProposition: item.matchedProposition } : {}),
  }));
}

export function normalizeVerificationQuantifierKey(value = null) {
  return normalizeComparableText(normalizeOptionalText(value) ?? "");
}

export function scoreVerificationPropositionSupportCandidate(proposition = {}, supportProposition = {}, candidate = {}) {
  const normalizedCandidateField = normalizeOptionalText(candidate?.field) ?? null;
  const subjectScore =
    proposition?.subjectKey && supportProposition?.subjectKey
      ? compareTextSimilarity(proposition.subjectKey, supportProposition.subjectKey) * 0.18
      : 0.08;
  const predicateScore =
    proposition?.predicateKey && supportProposition?.predicateKey
      ? proposition.predicateKey === supportProposition.predicateKey
        ? 0.42
        : compareTextSimilarity(proposition.predicateKey, supportProposition.predicateKey) * 0.22
      : 0;
  const objectExact =
    proposition?.objectKey &&
    supportProposition?.objectKey &&
    (
      proposition.objectKey === supportProposition.objectKey ||
      proposition.objectKey.includes(supportProposition.objectKey) ||
      supportProposition.objectKey.includes(proposition.objectKey)
    );
  const objectScore =
    proposition?.objectKey && supportProposition?.objectKey
      ? objectExact
        ? 0.48
        : compareTextSimilarity(proposition.objectKey, supportProposition.objectKey) * 0.38
      : 0;
  const rawTextScore = compareTextSimilarity(proposition?.rawText, supportProposition?.rawText) * 0.14;
  const propositionQuantifierKey = normalizeVerificationQuantifierKey(
    proposition?.quantifier ?? proposition?.quantifierScope?.cue ?? null
  );
  const supportQuantifierKey = normalizeVerificationQuantifierKey(
    supportProposition?.quantifier ?? supportProposition?.quantifierScope?.cue ?? null
  );
  const propositionQuantifierFamily = normalizeOptionalText(proposition?.quantifierScope?.family) ?? null;
  const supportQuantifierFamily = normalizeOptionalText(supportProposition?.quantifierScope?.family) ?? null;
  const quantifierExactMatch =
    propositionQuantifierKey && supportQuantifierKey && propositionQuantifierKey === supportQuantifierKey;
  const quantifierFamilyMatch =
    !quantifierExactMatch &&
    propositionQuantifierFamily &&
    supportQuantifierFamily &&
    propositionQuantifierFamily === supportQuantifierFamily;
  const quantifierBoost = quantifierExactMatch ? 0.08 : quantifierFamilyMatch ? 0.04 : 0;
  const quantifierPenalty =
    propositionQuantifierKey && supportQuantifierKey && !quantifierExactMatch && !quantifierFamilyMatch
      ? 0.14
      : 0;
  const claimBoost =
    proposition?.claimKey && supportProposition?.claimKey === proposition.claimKey
      ? 0.08
      : 0;
  const directMemoryBoost =
    candidate?.sourceKind === "passport_memory" && candidate?.layer !== "knowledge"
      ? 0.08
      : 0;
  const verifiedEquivalentBoost = isVerifiedEquivalentSupport(candidate) ? 0.06 : 0;
  const reportedBoost =
    normalizePassportMemorySourceType(candidate?.sourceType) === "reported"
      ? 0.03
      : 0;
  const statefulSemanticBoost =
    ["match.decision_provenance", "match.action_execution", "match.confirmation_lifecycle"].includes(normalizedCandidateField || "") &&
    proposition?.predicate &&
    supportProposition?.predicate &&
    proposition.predicate === supportProposition.predicate
      ? 0.18
      : 0;
  const knowledgeHitPenalty =
    candidate?.layer === "knowledge"
      ? 0.08
      : 0;
  const polarityPenalty =
    proposition?.polarity && supportProposition?.polarity && proposition.polarity !== supportProposition.polarity
      ? 0.18
      : 0;
  const counterfactualPenalty =
    proposition?.counterfactual === true && supportProposition?.counterfactual !== true
      ? 0.14
      : 0;
  const counterfactualBoost =
    proposition?.counterfactual === true && supportProposition?.counterfactual === true
      ? 0.04
      : 0;
  const sourceFeatures = resolvePassportSourceFeatures(candidate);
  const realityBoost =
    toFiniteNumber(sourceFeatures?.realityMonitoringScore, candidate?.realityMonitoringScore ?? 0) * 0.06;
  const internalPenalty =
    toFiniteNumber(sourceFeatures?.internalGenerationRisk, candidate?.internalGenerationRisk ?? 0) * 0.05;
  const hasStructuralAnchor = predicateScore >= 0.16 || objectScore >= 0.16;
  if (!hasStructuralAnchor) {
    return 0;
  }
  return Number(
    Math.max(
      0,
      (
        subjectScore +
        predicateScore +
        objectScore +
        rawTextScore +
        quantifierBoost +
        claimBoost +
        directMemoryBoost +
        verifiedEquivalentBoost +
        reportedBoost +
        statefulSemanticBoost -
        knowledgeHitPenalty +
        counterfactualBoost +
        realityBoost -
        internalPenalty -
        polarityPenalty -
        quantifierPenalty -
        counterfactualPenalty
      ).toFixed(4)
    )
  );
}

export function buildSentencePropositionBindings(
  sentence = "",
  inferredClaims = {},
  supportCorpus = [],
  supportPropositionCorpus = [],
  { sentenceIndex = null, discourseState = null } = {}
) {
  const propositions = extractSentencePropositions(sentence, {
    sentenceIndex,
    supportPropositionCorpus,
    discourseState,
  });
  return propositions.map((proposition) => {
    const matches = [];
    for (const supportProposition of supportPropositionCorpus || []) {
      const candidate = supportProposition.supportCandidate || {};
      const score = scoreVerificationPropositionSupportCandidate(proposition, supportProposition, candidate);
      if (score < DEFAULT_PROPOSITION_BINDING_MIN_SCORE) {
        continue;
      }
      matches.push({
        candidate,
        score,
        matchedProposition: supportProposition,
      });
    }
    const dedupedSupportRefs = Array.from(
      matches
        .sort(
          (left, right) =>
            right.score - left.score ||
            (right.candidate?.recordedAt || "").localeCompare(left.candidate?.recordedAt || "")
        )
        .reduce((map, item) => {
          if (!item?.candidate?.supportId) {
            return map;
          }
          const existing = map.get(item.candidate.supportId);
          if (!existing || toFiniteNumber(item.score, 0) > toFiniteNumber(existing.score, 0)) {
            map.set(item.candidate.supportId, item);
          }
          return map;
        }, new Map())
        .values()
    ).slice(0, 4);
    const dedupedSupports = materializeVerificationSupportRefs(dedupedSupportRefs);

    const supportSummary = buildVerificationSupportSummary(dedupedSupports);

    return {
      propositionId: proposition.propositionId,
      propositionKey: proposition.propositionKey,
      sentence: proposition.sentence,
      sentenceIndex: proposition.sentenceIndex,
      subject: proposition.subject,
      predicate: proposition.predicate,
      object: proposition.object,
      arguments: cloneJson(proposition.arguments || []),
      polarity: proposition.polarity,
      extractedBy: proposition.extractedBy,
      rawText: proposition.rawText,
      canonicalText: proposition.canonicalText ?? null,
      claimKey: proposition.claimKey ?? null,
      field: proposition.field ?? null,
      epistemicStatus: resolveBoundPropositionEpistemicStatus(proposition, supportSummary) ?? null,
      modality: proposition.modality ?? null,
      quantifier: proposition.quantifier ?? null,
      quantifierScope: cloneJson(proposition.quantifierScope || null),
      tense: proposition.tense ?? null,
      evidentiality: proposition.evidentiality ?? null,
      counterfactual: proposition.counterfactual === true,
      discourseRefs: Array.isArray(proposition.discourseRefs) ? proposition.discourseRefs.slice(0, 6) : [],
      referentKind: proposition.referentKind ?? null,
      subjectResolution: cloneJson(proposition.subjectResolution || null),
      normalization: cloneJson(proposition.normalization || null),
      negationScope: cloneJson(proposition.negationScope || null),
      sourceSpan: cloneJson(proposition.sourceSpan || null),
      supports: dedupedSupports.map((candidate) =>
        buildBoundSupportView(candidate, {
          proposition: {
            subject: candidate?.matchedProposition?.subject ?? null,
            predicate: candidate?.matchedProposition?.predicate ?? null,
            object: candidate?.matchedProposition?.object ?? null,
            polarity: candidate?.matchedProposition?.polarity ?? null,
            extractedBy: candidate?.matchedProposition?.extractedBy ?? null,
            epistemicStatus: candidate?.matchedProposition?.epistemicStatus ?? null,
          },
        })
      ),
      supportSummary,
    };
  });
}

export function detectSentenceClaimKeys(sentence, inferredClaims = {}) {
  const normalizedSentence = normalizeComparableText(sentence);
  if (!normalizedSentence) {
    return [];
  }

  const matched = [];
  for (const [claimKey, keywords] of Object.entries(DEFAULT_RESPONSE_CLAIM_KEYWORDS)) {
    const normalizedClaimValue = normalizeComparableText(normalizeVerificationBindingValue(inferredClaims?.[claimKey]));
    const matchedByKeyword = (keywords || []).some((keyword) => {
      const normalizedKeyword = normalizeComparableText(keyword);
      return normalizedKeyword && normalizedSentence.includes(normalizedKeyword);
    });
    const matchedByValue = normalizedClaimValue && normalizedSentence.includes(normalizedClaimValue);
    if (matchedByKeyword || matchedByValue) {
      matched.push(claimKey);
    }
  }

  return matched;
}

export function scoreVerificationSupportCandidate(sentence, candidate, { claimKeys = [] } = {}) {
  const sourceFeatures = resolvePassportSourceFeatures(candidate);
  const normalizedSentence = normalizeComparableText(sentence);
  const normalizedCandidateText = normalizeComparableText(candidate?.text);
  const normalizedValueText = normalizeComparableText(candidate?.valueText);
  const normalizedField = normalizeComparableText(candidate?.field);
  const baseSimilarity = compareTextSimilarity(normalizedSentence, normalizedCandidateText);
  const exactValueBoost =
    normalizedSentence && normalizedValueText && (normalizedSentence.includes(normalizedValueText) || normalizedValueText.includes(normalizedSentence))
      ? 0.42
      : 0;
  const fieldBoost =
    normalizedSentence && normalizedField && normalizedSentence.includes(normalizedField)
      ? 0.12
      : 0;
  const claimBoost =
    candidate?.claimKey && claimKeys.includes(candidate.claimKey)
      ? 0.24
      : 0;
  const structureMismatchPenalty =
    candidate?.claimKey && claimKeys.length === 0 && exactValueBoost === 0
      ? 0.12
      : 0;
  const fieldMismatchPenalty =
    candidate?.field && fieldBoost === 0 && exactValueBoost === 0 && claimBoost === 0
      ? 0.06
      : 0;
  const identityBoost =
    candidate?.sourceKind === "identity_fact" && claimBoost > 0
      ? 0.1
      : 0;
  const certaintyBoost = isVerifiedEquivalentSupport(candidate) ? 0.04 : 0;
  const directMemoryBoost =
    candidate?.sourceKind === "passport_memory" && candidate?.layer !== "knowledge"
      ? 0.05
      : 0;
  const knowledgeHitPenalty =
    candidate?.layer === "knowledge"
      ? 0.02
      : 0;
  const realityBoost =
    toFiniteNumber(sourceFeatures?.realityMonitoringScore, candidate?.realityMonitoringScore ?? 0) * 0.08;
  const internalGenerationPenalty =
    toFiniteNumber(sourceFeatures?.internalGenerationRisk, candidate?.internalGenerationRisk ?? 0) * 0.06;
  const destabilizedPenalty =
    normalizeOptionalText(candidate?.reconsolidationState) === "destabilized"
      ? 0.06
      : 0;
  const hotPenalty =
    ["hot", "stabilizing"].includes(normalizeOptionalText(candidate?.consolidationState) ?? "")
      ? 0.03
      : 0;

  return Number(
    Math.max(
      0,
      (
        baseSimilarity +
        exactValueBoost +
        fieldBoost +
        claimBoost +
        identityBoost +
        certaintyBoost -
        structureMismatchPenalty -
        fieldMismatchPenalty -
        knowledgeHitPenalty +
        directMemoryBoost +
        internalGenerationPenalty +
        realityBoost -
        destabilizedPenalty -
        hotPenalty
      ).toFixed(4)
    )
  );
}

export function buildClaimEvidenceBindings(inferredClaims = {}, supportCorpus = []) {
  return Object.entries(inferredClaims)
    .filter(([, value]) => normalizeVerificationBindingValue(value))
    .map(([claimKey, claimValue]) => {
      const normalizedClaimValue = normalizeComparableText(normalizeVerificationBindingValue(claimValue));
      const supportRefs = supportCorpus
        .map((candidate) => {
          const normalizedCandidateValue = normalizeComparableText(candidate?.valueText);
          const exactMatch = normalizedClaimValue && normalizedCandidateValue && normalizedClaimValue === normalizedCandidateValue;
          const partialMatch =
            normalizedClaimValue &&
            normalizedCandidateValue &&
            (normalizedClaimValue.includes(normalizedCandidateValue) || normalizedCandidateValue.includes(normalizedClaimValue));
          const claimKeyMatch = candidate?.claimKey === claimKey;
          const score =
            (claimKeyMatch ? 0.34 : 0) +
            (exactMatch ? 0.52 : 0) +
            (partialMatch ? 0.24 : 0) +
            compareTextSimilarity(normalizedClaimValue, normalizedCandidateValue);
          return {
            candidate,
            score: Number(score.toFixed(4)),
          };
        })
        .filter((item) =>
          item.score >=
            (item.candidate?.claimKey === claimKey
              ? DEFAULT_RESPONSE_STRUCTURAL_BINDING_MIN_SCORE
              : DEFAULT_RESPONSE_BINDING_MIN_SCORE)
        )
        .sort(
          (left, right) =>
            right.score - left.score ||
            (right.candidate?.recordedAt || "").localeCompare(left.candidate?.recordedAt || "")
        )
        .slice(0, 4);
      const supports = materializeVerificationSupportRefs(supportRefs);

      return {
        claimKey,
        claimValue: cloneJson(claimValue),
        supports: supports.map((candidate) => buildBoundSupportView(candidate)),
        supportSummary: buildVerificationSupportSummary(supports),
      };
    });
}

export function buildSentenceEvidenceBindings(responseText = "", inferredClaims = {}, supportCorpus = [], { supportPropositionCorpus = null } = {}) {
  const effectiveSupportPropositionCorpus = Array.isArray(supportPropositionCorpus)
    ? supportPropositionCorpus
    : buildSupportPropositionCorpus(supportCorpus);
  let discourseState = buildDiscourseState({ supportCorpus });
  return splitResponseIntoSentences(responseText).map((sentence, sentenceIndex) => {
    const claimKeys = detectSentenceClaimKeys(sentence, inferredClaims);
    const supportRefs = supportCorpus
      .map((candidate) => ({
        candidate,
        score: scoreVerificationSupportCandidate(sentence, candidate, { claimKeys }),
      }))
      .filter((item) =>
        item.score >=
          (claimKeys.length > 0 ? DEFAULT_RESPONSE_STRUCTURAL_BINDING_MIN_SCORE : DEFAULT_RESPONSE_BINDING_MIN_SCORE)
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          (right.candidate?.recordedAt || "").localeCompare(left.candidate?.recordedAt || "")
      )
      .slice(0, 4);
    const supports = materializeVerificationSupportRefs(supportRefs);
    const propositions = buildSentencePropositionBindings(
      sentence,
      inferredClaims,
      supportCorpus,
      effectiveSupportPropositionCorpus,
      {
        sentenceIndex,
        discourseState,
      }
    );
    discourseState = updateDiscourseStateFromPropositions(discourseState, propositions, { sentenceIndex });
    const propositionSupports = propositions.flatMap((item) => item.supports || []);
    const combinedSupports = mergeUniqueVerificationSupports(supports, propositionSupports);

    return {
      sentence,
      sentenceIndex,
      claimKeys,
      propositions,
      discourseSnapshot: summarizeDiscourseState(discourseState),
      supports: supports.map((candidate) => buildBoundSupportView(candidate)),
      supportSummary: buildVerificationSupportSummary(supports),
      combinedSupportSummary: buildVerificationSupportSummary(combinedSupports),
    };
  });
}

export function stripLeadingCausalConnector(text = "") {
  let normalized = normalizeOptionalText(text) ?? "";
  for (const pattern of DEFAULT_CAUSAL_PREFIX_PATTERNS) {
    normalized = normalized.replace(pattern, "").trim();
  }
  return normalized;
}

export function buildFragmentEvidenceBinding(
  fragmentText = "",
  inferredClaims = {},
  supportCorpus = [],
  { supportPropositionCorpus = null } = {}
) {
  const fragment = normalizeOptionalText(fragmentText) ?? null;
  if (!fragment) {
    return {
      text: null,
      claimKeys: [],
      propositions: [],
      discourseSnapshot: summarizeDiscourseState(buildDiscourseState({ supportCorpus })),
      supports: [],
      supportSummary: buildVerificationSupportSummary([]),
      combinedSupportSummary: buildVerificationSupportSummary([]),
    };
  }
  const claimKeys = detectSentenceClaimKeys(fragment, inferredClaims);
  const supportRefs = supportCorpus
    .map((candidate) => ({
      candidate,
      score: scoreVerificationSupportCandidate(fragment, candidate, { claimKeys }),
    }))
    .filter((item) =>
      item.score >=
        (claimKeys.length > 0 ? DEFAULT_RESPONSE_STRUCTURAL_BINDING_MIN_SCORE : DEFAULT_RESPONSE_BINDING_MIN_SCORE)
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.candidate?.recordedAt || "").localeCompare(left.candidate?.recordedAt || "")
    )
    .slice(0, 4);
  const supports = materializeVerificationSupportRefs(supportRefs);
  const effectiveSupportPropositionCorpus = Array.isArray(supportPropositionCorpus)
    ? supportPropositionCorpus
    : buildSupportPropositionCorpus(supportCorpus);
  const discourseState = buildDiscourseState({ supportCorpus });
  const propositions = buildSentencePropositionBindings(
    fragment,
    inferredClaims,
    supportCorpus,
    effectiveSupportPropositionCorpus,
    {
      discourseState,
    }
  );
  const propositionSupports = propositions.flatMap((item) => item.supports || []);
  const combinedSupports = mergeUniqueVerificationSupports(supports, propositionSupports);

  return {
    text: fragment,
    claimKeys,
    propositions,
    discourseSnapshot: summarizeDiscourseState(updateDiscourseStateFromPropositions(discourseState, propositions)),
    supports: supports.map((candidate) => buildBoundSupportView(candidate)),
    supportSummary: buildVerificationSupportSummary(supports),
    combinedSupportSummary: buildVerificationSupportSummary(combinedSupports),
  };
}

export function extractPassportEventGraphValue(entry = {}) {
  const candidates = [
    entry?.payload?.eventGraph,
    entry?.payload?.value,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    if (candidate.eventGraph && typeof candidate.eventGraph === "object") {
      return candidate.eventGraph;
    }
    if (Array.isArray(candidate.nodes) || Array.isArray(candidate.edges)) {
      return candidate;
    }
  }
  return null;
}

export function buildPassportEventGraphNodeText(entry = {}) {
  return (
    normalizeOptionalText(entry?.summary) ??
    normalizeOptionalText(normalizeVerificationBindingValue(entry?.payload?.value)) ??
    normalizeOptionalText(entry?.content) ??
    normalizeOptionalText(entry?.payload?.field) ??
    null
  );
}

export function buildPassportEventGraphSnapshot(layers = {}, { lightweight = false } = {}) {
  const entries = mergeUniquePassportMemories(
    [
      ...(layers?.relevant?.episodic || layers?.episodic?.entries || []),
      ...(layers?.relevant?.semantic || layers?.semantic?.entries || []),
      ...(layers?.relevant?.working || layers?.working?.gatedEntries || layers?.working?.entries || []),
      ...((layers?.working?.checkpoints || []).slice(-2)),
    ].filter(Boolean),
    lightweight ? 12 : 24
  );
  const nodesByKey = new Map();
  const edgesByKey = new Map();
  const groupedEntries = new Map();

  const addNode = (textValue, metadata = {}) => {
    const text = normalizeOptionalText(textValue) ?? null;
    if (!text) {
      return null;
    }
    const key = normalizeComparableText(text).slice(0, 128) || null;
    if (!key) {
      return null;
    }
    const entry = metadata.entry || null;
    const supportId = normalizeOptionalText(entry?.passportMemoryId || metadata.supportId) ?? null;
    if (!nodesByKey.has(key)) {
      nodesByKey.set(key, {
        nodeId: `evt_${key.slice(0, 64)}`,
        key,
        text,
        fields: [],
        layers: [],
        kinds: [],
        supportIds: [],
        sourceTypes: [],
        tags: [],
        lastRecordedAt: normalizeOptionalText(entry?.recordedAt) ?? null,
      });
    }
    const node = nodesByKey.get(key);
    if (metadata.field) {
      node.fields = Array.from(new Set([...node.fields, normalizeOptionalText(metadata.field)].filter(Boolean))).slice(0, 6);
    }
    if (metadata.layer || entry?.layer) {
      node.layers = Array.from(
        new Set([...node.layers, normalizePassportMemoryLayer(metadata.layer || entry?.layer)].filter(Boolean))
      ).slice(0, 4);
    }
    if (metadata.kind || entry?.kind) {
      node.kinds = Array.from(new Set([...node.kinds, normalizeOptionalText(metadata.kind || entry?.kind)].filter(Boolean))).slice(0, 4);
    }
    if (supportId) {
      node.supportIds = Array.from(new Set([...node.supportIds, supportId])).slice(0, 12);
    }
    if (metadata.sourceType || entry?.sourceType) {
      node.sourceTypes = Array.from(
        new Set([...node.sourceTypes, normalizePassportMemorySourceType(metadata.sourceType || entry?.sourceType)].filter(Boolean))
      ).slice(0, 4);
    }
    if (Array.isArray(metadata.tags) || Array.isArray(entry?.tags)) {
      node.tags = Array.from(new Set([...node.tags, ...(metadata.tags || []), ...(entry?.tags || [])].filter(Boolean))).slice(0, 8);
    }
    const recordedAt = normalizeOptionalText(metadata.recordedAt || entry?.recordedAt) ?? null;
    if (recordedAt && (!node.lastRecordedAt || recordedAt > node.lastRecordedAt)) {
      node.lastRecordedAt = recordedAt;
    }
    return key;
  };

  const addEdge = ({
    fromText = null,
    toText = null,
    relation = "associative",
    entry = null,
    connector = null,
    inferredFrom = null,
    weight = 0.5,
  } = {}) => {
    const fromKey = addNode(fromText, { entry });
    const toKey = addNode(toText, { entry });
    if (!fromKey || !toKey || fromKey === toKey) {
      return null;
    }
    const normalizedRelation = normalizeOptionalText(relation) ?? "associative";
    const edgeKey = `${fromKey}:${normalizedRelation}:${toKey}`;
    const supportIdBase = normalizeOptionalText(entry?.passportMemoryId) ?? "event_graph";
    const support = {
      supportId: `${supportIdBase}:${normalizedRelation}:${fromKey}:${toKey}`,
      sourceKind: "event_graph_edge",
      layer: normalizePassportMemoryLayer(entry?.layer || "semantic"),
      kind: normalizeOptionalText(entry?.kind) ?? "event_graph_edge",
      field: normalizeOptionalText(entry?.payload?.field) ?? null,
      claimKey: mapPassportFieldToClaimKey(normalizeOptionalText(entry?.payload?.field) ?? null),
      value: {
        from: normalizeOptionalText(fromText) ?? null,
        to: normalizeOptionalText(toText) ?? null,
        relation: normalizedRelation,
      },
      valueText: normalizeVerificationBindingValue(
        [normalizeOptionalText(fromText), normalizedRelation, normalizeOptionalText(toText)].filter(Boolean).join(" ")
      ),
      summary:
        normalizeOptionalText(entry?.summary) ??
        [normalizeOptionalText(fromText), normalizeOptionalText(connector || normalizedRelation), normalizeOptionalText(toText)]
          .filter(Boolean)
          .join(" "),
      text: [
        normalizeOptionalText(fromText),
        normalizeOptionalText(connector || normalizedRelation),
        normalizeOptionalText(toText),
        normalizeOptionalText(entry?.summary),
        normalizeOptionalText(entry?.content),
      ]
        .filter(Boolean)
        .join(" "),
      sourceType: normalizePassportMemorySourceType(entry?.sourceType),
      epistemicStatus:
        entry?.epistemicStatus ??
        inferEpistemicStatus({
          epistemicStatus: entry?.payload?.epistemicStatus ?? entry?.payload?.value?.epistemicStatus ?? null,
          sourceType: entry?.sourceType,
          field: entry?.payload?.field,
          kind: entry?.kind,
          value: entry?.payload?.value,
          payload: entry,
          verifiedEquivalent: isVerifiedEquivalentSupport(entry),
        }),
      verifiedEquivalent: isVerifiedEquivalentSupport(entry),
      confidence: toFiniteNumber(entry?.confidence, 0.58),
      salience: toFiniteNumber(entry?.salience, 0.56),
      consolidationState: normalizeOptionalText(entry?.consolidationState) ?? null,
      reconsolidationState: normalizeOptionalText(entry?.memoryDynamics?.reconsolidationState) ?? null,
      sourceFeatures: resolvePassportSourceFeatures(entry),
      recordedAt: normalizeOptionalText(entry?.recordedAt) ?? null,
      tags: Array.isArray(entry?.tags) ? entry.tags.slice(0, 8) : [],
      score: Number(Math.max(0, Math.min(1, weight)).toFixed(4)),
    };
    if (!edgesByKey.has(edgeKey)) {
      edgesByKey.set(edgeKey, {
        edgeId: `edge_${normalizeComparableText(edgeKey).slice(0, 72)}`,
        from: fromKey,
        to: toKey,
        relation: normalizedRelation,
        connector: normalizeOptionalText(connector) ?? null,
        inferredFrom: normalizeOptionalText(inferredFrom) ?? null,
        supports: [],
      });
    }
    const edge = edgesByKey.get(edgeKey);
    if (!edge.supports.some((item) => item.supportId === support.supportId)) {
      edge.supports.push(support);
      edge.supports.sort((left, right) => right.score - left.score || (right.recordedAt || "").localeCompare(left.recordedAt || ""));
    }
    return edge;
  };

  for (const entry of entries) {
    const baseText = buildPassportEventGraphNodeText(entry);
    const baseKey = addNode(baseText, {
      entry,
      field: entry?.payload?.field,
      kind: entry?.kind,
      layer: entry?.layer,
      tags: entry?.tags,
    });
    const graphValue = extractPassportEventGraphValue(entry);
    if (graphValue) {
      for (const node of Array.isArray(graphValue.nodes) ? graphValue.nodes : []) {
        addNode(
          normalizeOptionalText(node?.text || node?.label || node?.summary || node?.id) ?? null,
          {
            entry,
            field: normalizeOptionalText(node?.field || entry?.payload?.field) ?? null,
            kind: normalizeOptionalText(node?.type || node?.kind || entry?.kind) ?? null,
            layer: entry?.layer,
            tags: [...(entry?.tags || []), ...(Array.isArray(node?.tags) ? node.tags : [])],
          }
        );
      }
      for (const edge of Array.isArray(graphValue.edges) ? graphValue.edges : []) {
        addEdge({
          fromText: normalizeOptionalText(edge?.fromText || edge?.from || edge?.source) ?? null,
          toText: normalizeOptionalText(edge?.toText || edge?.to || edge?.target) ?? null,
          relation: normalizeOptionalText(edge?.relation || edge?.type) ?? "event_graph",
          connector: normalizeOptionalText(edge?.connector) ?? null,
          inferredFrom: "payload_event_graph",
          entry,
          weight: toFiniteNumber(edge?.weight, 0.66),
        });
      }
    }

    const value = entry?.payload?.value;
    const causeLines = normalizeTextList(value?.cause || []);
    const effectLines = normalizeTextList(value?.effect || []);
    if (causeLines.length > 0 && effectLines.length > 0) {
      for (const cause of causeLines) {
        for (const effect of effectLines) {
          addEdge({
            fromText: cause,
            toText: effect,
            relation: normalizeOptionalText(value?.connector) ?? "causal_hypothesis",
            connector: normalizeOptionalText(value?.connector) ?? "causal_hypothesis",
            inferredFrom: "semantic_causal_hypothesis",
            entry,
            weight: 0.72,
          });
        }
      }
    }

    const groupingKey =
      normalizeOptionalText(entry?.patternKey) ??
      normalizeOptionalText(entry?.boundaryLabel) ??
      normalizeOptionalText(entry?.payload?.patternKey) ??
      null;
    if (groupingKey && baseKey) {
      if (!groupedEntries.has(groupingKey)) {
        groupedEntries.set(groupingKey, []);
      }
      groupedEntries.get(groupingKey).push({
        entry,
        baseText,
      });
    }
  }

  for (const [groupKey, items] of groupedEntries.entries()) {
    const sortedItems = [...items].sort((left, right) => (left.entry?.recordedAt || "").localeCompare(right.entry?.recordedAt || ""));
    for (let index = 0; index < sortedItems.length - 1; index += 1) {
      const current = sortedItems[index];
      const next = sortedItems[index + 1];
      const relation =
        normalizeOptionalText(next.entry?.payload?.field) === "next_action" || normalizeOptionalText(next.entry?.kind) === "next_action"
          ? "supports_next_step"
          : "temporal_successor";
      addEdge({
        fromText: current.baseText,
        toText: next.baseText,
        relation,
        connector: relation,
        inferredFrom: `pattern_sequence:${groupKey}`,
        entry: next.entry,
        weight: relation === "supports_next_step" ? 0.78 : 0.62,
      });
    }
  }

  const actionEntries = entries.filter((entry) => {
    const field = normalizeOptionalText(entry?.payload?.field) ?? null;
    const kind = normalizeOptionalText(entry?.kind) ?? null;
    return ["next_action", "coordination_action", "followup_action"].includes(field) || ["next_action", "followup_action"].includes(kind);
  });
  for (const actionEntry of actionEntries) {
    const actionText = buildPassportEventGraphNodeText(actionEntry);
    const actionTags = new Set((Array.isArray(actionEntry?.tags) ? actionEntry.tags : []).map((item) => normalizeOptionalText(item)).filter(Boolean));
    const predecessor = entries
      .filter((entry) => entry?.passportMemoryId !== actionEntry?.passportMemoryId)
      .filter((entry) => (entry?.recordedAt || "") < (actionEntry?.recordedAt || ""))
      .map((entry) => {
        const entryTags = (Array.isArray(entry?.tags) ? entry.tags : []).map((item) => normalizeOptionalText(item)).filter(Boolean);
        const sharedTagCount = entryTags.filter((tag) => actionTags.has(tag)).length;
        const textScore = compareTextSimilarity(buildPassportEventGraphNodeText(entry), actionText);
        return {
          entry,
          sharedTagCount,
          textScore,
        };
      })
      .filter((item) => item.sharedTagCount > 0 || item.textScore >= 0.12)
      .sort((left, right) => {
        const tagDelta = right.sharedTagCount - left.sharedTagCount;
        if (tagDelta) {
          return tagDelta;
        }
        const scoreDelta = right.textScore - left.textScore;
        return scoreDelta || (right.entry?.recordedAt || "").localeCompare(left.entry?.recordedAt || "");
      })[0];
    if (predecessor?.entry) {
      addEdge({
        fromText: buildPassportEventGraphNodeText(predecessor.entry),
        toText: actionText,
        relation: "supports_next_step",
        connector: "supports_next_step",
        inferredFrom: "tag_overlap_action_bridge",
        entry: actionEntry,
        weight: predecessor.sharedTagCount > 0 ? 0.76 : 0.6,
      });
    }
  }

  const nodes = Array.from(nodesByKey.values())
    .sort((left, right) => (right.lastRecordedAt || "").localeCompare(left.lastRecordedAt || "") || right.supportIds.length - left.supportIds.length)
    .slice(0, lightweight ? 12 : 24);
  const allowedNodeKeys = new Set(nodes.map((node) => node.key));
  const edges = Array.from(edgesByKey.values())
    .filter((edge) => allowedNodeKeys.has(edge.from) && allowedNodeKeys.has(edge.to))
    .map((edge) => ({
      ...edge,
      averageWeight:
        edge.supports.length > 0
          ? Number(
              (
                edge.supports.reduce((sum, item) => sum + toFiniteNumber(item.score, 0), 0) /
                Math.max(1, edge.supports.length)
              ).toFixed(4)
            )
          : 0,
      supportSummary: buildVerificationSupportSummary(edge.supports),
    }))
    .sort((left, right) => right.averageWeight - left.averageWeight || right.supports.length - left.supports.length)
    .slice(0, lightweight ? 18 : 36);

  return {
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      sequenceGroups: groupedEntries.size,
    },
  };
}

export function matchPassportEventGraphNodesForBinding(binding = {}, eventGraph = {}) {
  const supportIds = new Set((binding?.supports || []).map((support) => normalizeOptionalText(support?.supportId)).filter(Boolean));
  const fragmentText = normalizeOptionalText(binding?.text) ?? null;
  return (Array.isArray(eventGraph?.nodes) ? eventGraph.nodes : [])
    .map((node) => {
      const overlap = node.supportIds.some((supportId) => supportIds.has(supportId));
      const textScore = Math.max(
        compareTextSimilarity(fragmentText, node.text),
        compareTextSimilarity(fragmentText, node.fields?.[0]),
        compareTextSimilarity(fragmentText, node.kinds?.[0])
      );
      const overlapScore = overlap && textScore >= 0.12 ? Math.min(0.98, textScore + 0.18) : 0;
      const score = Math.max(textScore, overlapScore);
      return {
        nodeKey: node.key,
        text: node.text,
        score: Number(score.toFixed(4)),
      };
    })
    .filter((item) => item.score >= DEFAULT_EVENT_GRAPH_NODE_MATCH_THRESHOLD)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}

export function findBestPassportEventGraphPath(eventGraph = {}, causeBinding = {}, effectBinding = {}, { maxHops = DEFAULT_EVENT_GRAPH_MAX_HOPS } = {}) {
  const nodeMap = new Map((Array.isArray(eventGraph?.nodes) ? eventGraph.nodes : []).map((node) => [node.key, node]));
  const edgeMap = Array.isArray(eventGraph?.edges) ? eventGraph.edges : [];
  const startMatches = matchPassportEventGraphNodesForBinding(causeBinding, eventGraph);
  const endMatches = matchPassportEventGraphNodesForBinding(effectBinding, eventGraph);
  if (startMatches.length === 0 || endMatches.length === 0 || edgeMap.length === 0) {
    return {
      pathFound: false,
      hopCount: 0,
      multiHop: false,
      nodeTexts: [],
      relations: [],
      supportIds: [],
      supportSummary: buildVerificationSupportSummary([]),
      startMatches,
      endMatches,
    };
  }

  const adjacency = new Map();
  for (const edge of edgeMap) {
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, []);
    }
    adjacency.get(edge.from).push(edge);
  }

  const endMatchByKey = new Map(endMatches.map((item) => [item.nodeKey, item]));
  let bestPath = null;

  for (const start of startMatches) {
    const queue = [
      {
        nodeKey: start.nodeKey,
        pathEdges: [],
        pathNodes: [start.nodeKey],
        visited: new Set([start.nodeKey]),
        score: start.score,
      },
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      if (current.pathEdges.length > 0 && endMatchByKey.has(current.nodeKey)) {
        const pathSupports = current.pathEdges.flatMap((edge) => edge.supports || []);
        const supportSummary = buildVerificationSupportSummary(pathSupports);
        const endMatch = endMatchByKey.get(current.nodeKey);
        const pathScore =
          current.score +
          (endMatch?.score || 0) +
          current.pathEdges.reduce((sum, edge) => sum + toFiniteNumber(edge.averageWeight, 0), 0) +
          (supportSummary.verifiedEquivalentCount * 0.08) +
          (supportSummary.externalLikeCount * 0.04) -
          (supportSummary.lowRealityCount * 0.02);
        const candidate = {
          pathFound: true,
          hopCount: current.pathEdges.length,
          multiHop: current.pathEdges.length > 1,
          nodeTexts: current.pathNodes.map((key) => nodeMap.get(key)?.text || key),
          relations: current.pathEdges.map((edge) => edge.relation),
          supportIds: Array.from(new Set(pathSupports.map((support) => support.supportId).filter(Boolean))),
          supportSummary,
          startMatches,
          endMatches,
          pathScore: Number(pathScore.toFixed(4)),
          supports: pathSupports,
        };
        if (!bestPath || candidate.pathScore > bestPath.pathScore) {
          bestPath = candidate;
        }
      }
      if (current.pathEdges.length >= maxHops) {
        continue;
      }
      for (const edge of adjacency.get(current.nodeKey) || []) {
        if (!edge?.to || current.visited.has(edge.to)) {
          continue;
        }
        queue.push({
          nodeKey: edge.to,
          pathEdges: [...current.pathEdges, edge],
          pathNodes: [...current.pathNodes, edge.to],
          visited: new Set([...current.visited, edge.to]),
          score: current.score + toFiniteNumber(edge.averageWeight, 0),
        });
      }
    }
  }

  if (!bestPath) {
    return {
      pathFound: false,
      hopCount: 0,
      multiHop: false,
      nodeTexts: [],
      relations: [],
      supportIds: [],
      supportSummary: buildVerificationSupportSummary([]),
      startMatches,
      endMatches,
    };
  }

  return bestPath;
}

export function causalRelationsCanFormChain(left = {}, right = {}) {
  const leftEffectText = normalizeOptionalText(left?.effect?.text) ?? null;
  const rightCauseText = normalizeOptionalText(right?.cause?.text) ?? null;
  const supportOverlap = (left?.effect?.supports || []).some((support) =>
    (right?.cause?.supports || []).some((candidate) => candidate.supportId === support.supportId)
  );
  return supportOverlap || compareTextSimilarity(leftEffectText, rightCauseText) >= 0.34;
}

export function buildCausalChainBindings(causalBindings = [], eventGraph = {}) {
  const relations = Array.isArray(causalBindings) ? causalBindings.filter(Boolean) : [];
  if (relations.length < 2) {
    return [];
  }

  const chains = [];
  let currentChain = [];
  const flushChain = () => {
    if (currentChain.length >= 2) {
      const startBinding = currentChain[0].cause;
      const endBinding = currentChain.at(-1).effect;
      const eventGraphPath = findBestPassportEventGraphPath(eventGraph, startBinding, endBinding, {
        maxHops: Math.max(DEFAULT_EVENT_GRAPH_MAX_HOPS, currentChain.length),
      });
      const combinedSupports = [
        ...currentChain.flatMap((relation) => relation.cause?.supports || []),
        ...currentChain.flatMap((relation) => relation.effect?.supports || []),
        ...(eventGraphPath.supports || []),
      ];
      const uniqueSupportMap = new Map();
      for (const support of combinedSupports) {
        if (support?.supportId && !uniqueSupportMap.has(support.supportId)) {
          uniqueSupportMap.set(support.supportId, support);
        }
      }
      chains.push({
        relationCount: currentChain.length,
        startText: startBinding?.text ?? null,
        endText: endBinding?.text ?? null,
        intermediateTexts: currentChain.slice(0, -1).map((relation) => relation.effect?.text).filter(Boolean),
        relationTexts: currentChain.map((relation) => relation.relationText).filter(Boolean),
        connectors: currentChain.map((relation) => relation.connector).filter(Boolean),
        eventGraphPath: {
          pathFound: eventGraphPath.pathFound,
          hopCount: eventGraphPath.hopCount,
          multiHop: eventGraphPath.multiHop,
          nodeTexts: eventGraphPath.nodeTexts,
          relations: eventGraphPath.relations,
          supportIds: eventGraphPath.supportIds,
          supportSummary: eventGraphPath.supportSummary,
        },
        supportSummary: buildVerificationSupportSummary(Array.from(uniqueSupportMap.values())),
      });
    }
    currentChain = [];
  };

  for (const relation of relations) {
    if (currentChain.length === 0) {
      currentChain.push(relation);
      continue;
    }
    if (causalRelationsCanFormChain(currentChain.at(-1), relation)) {
      currentChain.push(relation);
      continue;
    }
    flushChain();
    currentChain.push(relation);
  }
  flushChain();
  return chains;
}

export function buildCausalRelationBindings(
  responseText = "",
  inferredClaims = {},
  supportCorpus = [],
  eventGraph = {},
  { supportPropositionCorpus = null } = {}
) {
  const sentences = splitResponseIntoSentences(responseText);
  const relations = [];
  const seen = new Set();

  const pushRelation = ({
    connector = null,
    relationText = null,
    causeText = null,
    effectText = null,
    sentenceIndex = null,
    causeSentenceIndex = null,
    effectSentenceIndex = null,
  } = {}) => {
    const cause = normalizeOptionalText(causeText) ?? null;
    const effect = normalizeOptionalText(effectText) ?? null;
    if (!cause || !effect) {
      return;
    }
    const key = `${normalizeComparableText(cause)}=>${normalizeComparableText(effect)}`;
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    const causeBinding = buildFragmentEvidenceBinding(cause, inferredClaims, supportCorpus, {
      supportPropositionCorpus,
    });
    const effectBinding = buildFragmentEvidenceBinding(effect, inferredClaims, supportCorpus, {
      supportPropositionCorpus,
    });
    const eventGraphPath = findBestPassportEventGraphPath(eventGraph, causeBinding, effectBinding);
    const combinedSupports = [
      ...causeBinding.supports,
      ...effectBinding.supports,
      ...(causeBinding.propositions || []).flatMap((item) => item.supports || []),
      ...(effectBinding.propositions || []).flatMap((item) => item.supports || []),
      ...(eventGraphPath.supports || []),
    ];
    const uniqueSupportMap = new Map();
    for (const support of combinedSupports) {
      if (support?.supportId && !uniqueSupportMap.has(support.supportId)) {
        uniqueSupportMap.set(support.supportId, support);
      }
    }
    const bridgeSupportIds = causeBinding.supports
      .map((support) => support.supportId)
      .filter((supportId) => supportId && effectBinding.supports.some((item) => item.supportId === supportId));
    relations.push({
      connector: normalizeOptionalText(connector) ?? null,
      relationText: normalizeOptionalText(relationText) ?? null,
      sentenceIndex,
      causeSentenceIndex,
      effectSentenceIndex,
      cause: causeBinding,
      effect: effectBinding,
      bridgeSupportIds,
      eventGraphPath: {
        pathFound: eventGraphPath.pathFound,
        hopCount: eventGraphPath.hopCount,
        multiHop: eventGraphPath.multiHop,
        nodeTexts: eventGraphPath.nodeTexts,
        relations: eventGraphPath.relations,
        supportIds: eventGraphPath.supportIds,
        supportSummary: eventGraphPath.supportSummary,
      },
      supportSummary: buildVerificationSupportSummary(Array.from(uniqueSupportMap.values())),
    });
  };

  for (const [index, sentence] of sentences.entries()) {
    for (const pattern of DEFAULT_CAUSAL_CONNECTOR_PATTERNS) {
      const match = sentence.match(pattern.regex);
      if (!match) {
        continue;
      }
      const [, causeText, effectText] = match;
      pushRelation({
        connector: pattern.label,
        relationText: sentence,
        causeText,
        effectText,
        sentenceIndex: index,
        causeSentenceIndex: index,
        effectSentenceIndex: index,
      });
    }

    const nextSentence = sentences[index + 1] ?? null;
    if (nextSentence && DEFAULT_CAUSAL_PREFIX_PATTERNS.some((pattern) => pattern.test(nextSentence))) {
      pushRelation({
        connector: "cross_sentence",
        relationText: `${sentence} ${nextSentence}`,
        causeText: sentence,
        effectText: stripLeadingCausalConnector(nextSentence),
        sentenceIndex: index,
        causeSentenceIndex: index,
        effectSentenceIndex: index + 1,
      });
    }
  }

  return relations;
}

export function buildResponseVerificationResult(store, agent, payload = {}, { didMethod = null } = {}, deps = {}) {
  const responseText = normalizeOptionalText(payload.responseText || payload.response) ?? "";
  const buildAgentMemoryLayerView =
    typeof deps?.buildAgentMemoryLayerView === "function"
      ? deps.buildAgentMemoryLayerView
      : () => ({ profile: { fieldValues: {} }, relevant: {}, working: { entries: [] } });
  const latestAgentTaskSnapshot =
    typeof deps?.latestAgentTaskSnapshot === "function"
      ? deps.latestAgentTaskSnapshot
      : () => null;
  const layers =
    payload.contextBuilder?.memoryLayers ??
    buildAgentMemoryLayerView(store, agent, {
      query: responseText,
      currentGoal:
        normalizeOptionalText(payload.contextBuilder?.slots?.currentGoal) ??
        latestAgentTaskSnapshot(store, agent.agentId)?.objective ??
        null,
    });
  const claims = payload.claims && typeof payload.claims === "object" ? payload.claims : {};
  const issues = [];
  const resolvedDid = resolveAgentDidForMethod(store, agent, didMethod) || agent.identity?.did || null;
  const expectedProfile = layers.profile.fieldValues || {};
  const sourceMonitoring =
    payload.contextBuilder?.slots?.sourceMonitoring ??
    buildSourceMonitoringSnapshot({
      profile: layers.relevant?.profile || [],
      episodic: layers.relevant?.episodic || [],
      semantic: layers.relevant?.semantic || [],
      working: layers.working?.entries || [],
    });
  const certaintySignal = buildResponseCertaintySignal(responseText);
  const sentenceAnalysis = splitResponseIntoSentences(responseText).map((sentence) => {
    const signal = buildResponseCertaintySignal(sentence);
    return {
      sentence,
      strongHits: signal.strongHits,
      hedgedHits: signal.hedgedHits,
      claimsVerifiedLanguage: /(已证实|已经证明|confirmed|proven|verified)/iu.test(sentence),
    };
  });
  const inferredClaims = {
    agentId:
      normalizeOptionalText(claims.agentId) ||
      extractClaimValueFromText(responseText, [/agent[_-]?id[:：]\s*([a-z0-9_:-]+)/i, /身份ID[:：]\s*([a-z0-9_:-]+)/i]),
    parentAgentId:
      normalizeOptionalText(claims.parentAgentId || claims.parent) ||
      extractClaimValueFromText(responseText, [/parent(?:AgentId)?[:：]\s*([a-z0-9_:-]+)/i, /父身份[:：]\s*([a-z0-9_:-]+)/i]),
    walletAddress:
      normalizeOptionalText(claims.walletAddress) ||
      extractClaimValueFromText(responseText, [/(0x[a-f0-9]{8,40})/i]),
    role:
      normalizeOptionalText(claims.role) ||
      extractClaimValueFromText(responseText, [/role[:：]\s*([^\n,，]+)/i, /角色[:：]\s*([^\n,，]+)/i]),
      displayName:
      normalizeOptionalText(claims.displayName) ||
      extractClaimValueFromText(responseText, [/displayName[:：]\s*([^\n,，]+)/i, /名字[:：]\s*([^\n,，]+)/i]),
    did:
      normalizeOptionalText(claims.did) ||
      extractClaimValueFromText(responseText, [/(did:[a-z0-9:._-]+)/i]),
    authorizationThreshold:
      claims.authorizationThreshold != null
        ? Math.floor(toFiniteNumber(claims.authorizationThreshold, 0))
        : null,
  };
  const bindingCorpus = buildResponseEvidenceBindingCorpus(store, agent, layers, payload.contextBuilder || {}, {
    resolvedDid,
  });
  const eventGraph =
    layers.eventGraph ??
    payload.contextBuilder?.slots?.eventGraph ??
    buildPassportEventGraphSnapshot(layers, { lightweight: true });
  const semanticStateEntries = [
    ...(Array.isArray(layers.relevant?.semantic) ? layers.relevant.semantic : []),
    ...(Array.isArray(layers.semantic?.entries) ? layers.semantic.entries : []),
  ].filter(Boolean);
  const currentDecisionState = semanticStateEntries.find(
    (entry) => normalizeOptionalText(entry?.payload?.field) === "match.decision_provenance" && entry?.status !== "superseded"
  ) || null;
  const currentActionState = semanticStateEntries.find(
    (entry) => normalizeOptionalText(entry?.payload?.field) === "match.action_execution" && entry?.status !== "superseded"
  ) || null;
  const supportPropositionCorpus = buildSupportPropositionCorpus(bindingCorpus);
  const claimBindings = buildClaimEvidenceBindings(inferredClaims, bindingCorpus);
  const sentenceBindings = buildSentenceEvidenceBindings(responseText, inferredClaims, bindingCorpus, {
    supportPropositionCorpus,
  });
  const propositionBindings = sentenceBindings.flatMap((item) => item.propositions || []);
  const propositionSupportBindings = propositionBindings.flatMap((item) => item.supports || []);
  const discourseState =
    cloneJson(sentenceBindings.at(-1)?.discourseSnapshot) ??
    summarizeDiscourseState(
      propositionBindings.reduce(
        (state, proposition, index) => updateDiscourseStateFromPropositions(state, [proposition], { sentenceIndex: proposition?.sentenceIndex ?? index }),
        buildDiscourseState({ supportCorpus: bindingCorpus })
      )
    );
  const discourseGraph = buildDiscourseGraph({
    propositions: propositionBindings,
    discourseState,
  });
  const counterfactualTraces = buildCounterfactualTraces(propositionBindings, sentenceBindings, {
    discourseState,
  });
  const boundSupportSummary = buildVerificationSupportSummary(
    mergeUniqueVerificationSupports(
      sentenceBindings.flatMap((item) => item.supports || []),
      propositionSupportBindings
    )
  );
  const causalBindings = buildCausalRelationBindings(responseText, inferredClaims, bindingCorpus, eventGraph, {
    supportPropositionCorpus,
  });
  const causalChains = buildCausalChainBindings(causalBindings, eventGraph);

  if (inferredClaims.agentId && inferredClaims.agentId !== agent.agentId) {
    issues.push({
      code: "agent_id_mismatch",
      expected: agent.agentId,
      actual: inferredClaims.agentId,
      message: "回复中的 agent_id 与 本地参考层 不一致。",
    });
  }

  if (inferredClaims.parentAgentId && inferredClaims.parentAgentId !== (agent.parentAgentId || "none")) {
    issues.push({
      code: "parent_mismatch",
      expected: agent.parentAgentId || "none",
      actual: inferredClaims.parentAgentId,
      message: "回复中的 parent / fork 关系与账本不一致。",
    });
  }

  if (inferredClaims.walletAddress && inferredClaims.walletAddress.toLowerCase() !== (agent.identity?.walletAddress || "").toLowerCase()) {
    issues.push({
      code: "wallet_mismatch",
      expected: agent.identity?.walletAddress || null,
      actual: inferredClaims.walletAddress,
      message: "回复中的钱包地址与 ledger memory 不一致。",
    });
  }

  if (inferredClaims.did && inferredClaims.did !== resolvedDid) {
    issues.push({
      code: "did_mismatch",
      expected: resolvedDid,
      actual: inferredClaims.did,
      message: "回复中的 DID 与当前身份快照不一致。",
    });
  }

  if (inferredClaims.authorizationThreshold != null) {
    const expectedThreshold = Math.floor(toFiniteNumber(agent.identity?.authorizationPolicy?.threshold, 1));
    if (inferredClaims.authorizationThreshold !== expectedThreshold) {
      issues.push({
        code: "authorization_threshold_mismatch",
        expected: expectedThreshold,
        actual: inferredClaims.authorizationThreshold,
        message: "回复中的授权阈值与授权账本不一致。",
      });
    }
  }

  if (inferredClaims.role && expectedProfile.role && compareTextSimilarity(inferredClaims.role, expectedProfile.role) < 0.35) {
    issues.push({
      code: "profile_role_mismatch",
      expected: expectedProfile.role,
      actual: inferredClaims.role,
      message: "回复中的角色与 profile memory 冲突。",
    });
  }

  if (inferredClaims.displayName && expectedProfile.name && compareTextSimilarity(inferredClaims.displayName, expectedProfile.name) < 0.35) {
    issues.push({
      code: "profile_name_mismatch",
      expected: expectedProfile.name,
      actual: inferredClaims.displayName,
      message: "回复中的名字与 profile memory 冲突。",
    });
  }

  const verifiedSupportCount = Math.max(
    Math.floor(toFiniteNumber(sourceMonitoring?.counts?.verified, 0)),
    Math.floor(toFiniteNumber(boundSupportSummary?.verifiedCount, 0))
  );
  const verifiedEquivalentSupportCount = Math.max(
    Math.floor(toFiniteNumber(boundSupportSummary?.verifiedEquivalentCount, 0)),
    verifiedSupportCount
  );
  const nonVerifiedSupportCount = Math.max(
    Math.floor(toFiniteNumber(boundSupportSummary?.reportedCount, 0)) +
      Math.floor(toFiniteNumber(boundSupportSummary?.perceivedCount, 0)) +
      Math.floor(toFiniteNumber(boundSupportSummary?.derivedCount, 0)) +
      Math.floor(toFiniteNumber(boundSupportSummary?.inferredCount, 0)),
    Math.floor(toFiniteNumber(sourceMonitoring?.counts?.derived, 0)) +
      Math.floor(toFiniteNumber(sourceMonitoring?.counts?.inferred, 0)) +
      Math.floor(toFiniteNumber(sourceMonitoring?.counts?.perceived, 0)) +
      Math.floor(toFiniteNumber(sourceMonitoring?.counts?.reported, 0))
  );
  const hotSupportCount = Math.max(
    Math.floor(toFiniteNumber(boundSupportSummary?.hotLikeCount, 0)) +
      Math.floor(toFiniteNumber(boundSupportSummary?.destabilizedCount, 0)),
    Math.floor(toFiniteNumber(sourceMonitoring?.counts?.hot, 0)) +
      Math.floor(toFiniteNumber(sourceMonitoring?.counts?.stabilizing, 0)) +
      Math.floor(toFiniteNumber(sourceMonitoring?.counts?.destabilized, 0))
  );
  const externalLikeSupportCount = Math.max(
    Math.floor(toFiniteNumber(boundSupportSummary?.externalLikeCount, 0)),
    Math.floor(toFiniteNumber(sourceMonitoring?.counts?.externalLike, 0))
  );
  const lowRealitySupportCount = Math.max(
    Math.floor(toFiniteNumber(boundSupportSummary?.lowRealityCount, 0)),
    Math.floor(toFiniteNumber(sourceMonitoring?.counts?.lowReality, 0))
  );
  const internallyGeneratedSupportCount = Math.max(
    Math.floor(toFiniteNumber(boundSupportSummary?.internallyGeneratedCount, 0)),
      Math.floor(toFiniteNumber(sourceMonitoring?.counts?.internallyGenerated, 0))
  );
  const boundExternalLikeSupportCount = Math.floor(toFiniteNumber(boundSupportSummary?.externalLikeCount, 0));
  const boundLowRealitySupportCount = Math.floor(toFiniteNumber(boundSupportSummary?.lowRealityCount, 0));
  const boundInternallyGeneratedSupportCount = Math.floor(toFiniteNumber(boundSupportSummary?.internallyGeneratedCount, 0));
  const claimsVerifiedLanguage = /(已证实|已经证明|confirmed|proven|verified)/iu.test(responseText);

  if (
    certaintySignal.hasStrong &&
    !certaintySignal.hasHedged &&
    verifiedEquivalentSupportCount === 0 &&
    (nonVerifiedSupportCount > 0 || hotSupportCount > 0)
  ) {
    issues.push({
      code: "unsupported_certainty_from_non_verified_memory",
      expected: "hedged_or_verified_equivalent",
      actual: certaintySignal.strongHits.join(", "),
      message: "回复使用了高确定性口吻，但当前支撑主要来自推断、观察或仍在巩固中的记忆。",
    });
  }

  if (claimsVerifiedLanguage && verifiedEquivalentSupportCount === 0) {
    issues.push({
      code: "verified_language_without_verified_support",
      expected: "at_least_one_verified_or_structural_support",
      actual: "none",
      message: "回复声称内容已被验证/证实，但当前相关记忆层里没有 verified 支撑。",
    });
  }

  if (
    certaintySignal.hasStrong &&
    !certaintySignal.hasHedged &&
    verifiedEquivalentSupportCount === 0 &&
    boundExternalLikeSupportCount === 0 &&
    (boundLowRealitySupportCount > 0 || boundInternallyGeneratedSupportCount > 0)
  ) {
    issues.push({
      code: "reality_monitoring_gap_from_internal_support",
      expected: "external_or_verified_support",
      actual: `external=${boundExternalLikeSupportCount}, lowReality=${boundLowRealitySupportCount}, internal=${boundInternallyGeneratedSupportCount}`,
      message: "回复的主要支撑更像内部推断、压缩摘要或低现实性线索，reality monitoring 不足。",
    });
  }

  const certaintySentenceIssues = sentenceAnalysis
    .map((item, index) => ({
      ...item,
      binding: sentenceBindings[index] || {
        claimKeys: [],
        propositions: [],
        supportSummary: buildVerificationSupportSummary([]),
        combinedSupportSummary: buildVerificationSupportSummary([]),
        supports: [],
      },
    }))
    .filter((item) => item.strongHits.length > 0 && item.hedgedHits.length === 0)
    .filter((item) => {
      const supportSummary = item.binding?.combinedSupportSummary || item.binding?.supportSummary || {};
      return item.claimsVerifiedLanguage || Math.floor(toFiniteNumber(supportSummary.verifiedEquivalentCount, 0)) === 0;
    })
    .slice(0, 4)
    .map((item) => ({
      code: item.claimsVerifiedLanguage
        ? "sentence_verified_language_without_verified_support"
        : "sentence_overcertainty_without_verified_support",
      sentence: item.sentence,
      strongHits: item.strongHits,
      claimKeys: item.binding?.claimKeys || [],
      propositionKeys: (item.binding?.propositions || []).map((proposition) => proposition.propositionKey).filter(Boolean),
      boundSupportIds: mergeUniqueVerificationSupports(item.binding?.supports || [], ...(item.binding?.propositions || []).map((entry) => entry.supports || []))
        .map((support) => support.supportId)
        .filter(Boolean),
      message: item.claimsVerifiedLanguage
        ? "该句使用了已证实/已证明语气，但当前没有 verified 或 identity support。"
        : "该句使用了过强确定性口吻，但句内绑定的支撑里没有 verified 或 identity support。",
    }));
  issues.push(...certaintySentenceIssues);

  const realitySentenceIssues = sentenceAnalysis
    .map((item, index) => ({
      ...item,
      binding: sentenceBindings[index] || {
        claimKeys: [],
        propositions: [],
        supportSummary: buildVerificationSupportSummary([]),
        combinedSupportSummary: buildVerificationSupportSummary([]),
        supports: [],
      },
    }))
    .filter((item) => item.strongHits.length > 0 && item.hedgedHits.length === 0)
    .filter((item) => {
      const supportSummary = item.binding?.combinedSupportSummary || item.binding?.supportSummary || {};
      return (
        Math.floor(toFiniteNumber(supportSummary.verifiedEquivalentCount, 0)) === 0 &&
        Math.floor(toFiniteNumber(supportSummary.externalLikeCount, 0)) === 0 &&
        (
          Math.floor(toFiniteNumber(supportSummary.lowRealityCount, 0)) > 0 ||
          Math.floor(toFiniteNumber(supportSummary.internallyGeneratedCount, 0)) > 0
        )
      );
    })
    .slice(0, 4)
    .map((item) => ({
      code: "sentence_reality_monitoring_gap",
      sentence: item.sentence,
      strongHits: item.strongHits,
      claimKeys: item.binding?.claimKeys || [],
      propositionKeys: (item.binding?.propositions || []).map((proposition) => proposition.propositionKey).filter(Boolean),
      boundSupportIds: mergeUniqueVerificationSupports(item.binding?.supports || [], ...(item.binding?.propositions || []).map((entry) => entry.supports || []))
        .map((support) => support.supportId)
        .filter(Boolean),
      message: "该句主要绑定到内部推断或低现实性支撑，应该显式保留‘推断/报告/可能’语气。",
    }));
  issues.push(...realitySentenceIssues);

  const counterfactualPresentationIssues = sentenceAnalysis
    .map((item, index) => ({
      ...item,
      binding: sentenceBindings[index] || {
        claimKeys: [],
        propositions: [],
      },
    }))
    .filter((item) => (item.binding?.propositions || []).some((proposition) => proposition?.counterfactual === true))
    .filter((item) => item.claimsVerifiedLanguage)
    .slice(0, 4)
    .map((item) => ({
      code: "counterfactual_presented_as_verified",
      sentence: item.sentence,
      propositionKeys: (item.binding?.propositions || []).map((proposition) => proposition.propositionKey).filter(Boolean),
      message: "该句包含反事实 proposition，却用了已证实/已证明语气，应该显式保留 simulation / counterfactual 边界。",
    }));
  issues.push(...counterfactualPresentationIssues);

  const propositionBindingGapIssues = propositionBindings
    .filter((item) => Math.floor(toFiniteNumber(item.supportSummary?.totalSupportCount, 0)) === 0)
    .slice(0, 6)
    .map((item) => ({
      code: "proposition_binding_gap",
      sentence: item.sentence,
      proposition: {
        subject: item.subject,
        predicate: item.predicate,
        object: item.object,
        polarity: item.polarity,
      },
      message: "句子里已经抽出了 proposition，但 proposition 还没有绑定到足够的本地证据。",
    }));
  issues.push(...propositionBindingGapIssues);

  const propositionRealityGapIssues = propositionBindings
    .filter((item) => item.counterfactual !== true)
    .filter((item) => Math.floor(toFiniteNumber(item.supportSummary?.verifiedEquivalentCount, 0)) === 0)
    .filter((item) => Math.floor(toFiniteNumber(item.supportSummary?.externalLikeCount, 0)) === 0)
    .filter(
      (item) =>
        Math.floor(toFiniteNumber(item.supportSummary?.lowRealityCount, 0)) > 0 ||
        Math.floor(toFiniteNumber(item.supportSummary?.internallyGeneratedCount, 0)) > 0
    )
    .slice(0, 6)
    .map((item) => ({
      code: "proposition_reality_gap",
      sentence: item.sentence,
      proposition: {
        subject: item.subject,
        predicate: item.predicate,
        object: item.object,
        polarity: item.polarity,
      },
      message: "该 proposition 主要绑定到内部推断或低现实性支撑，应该保留假设语气而不是当成已证实命题。",
    }));
  issues.push(...propositionRealityGapIssues);

  const propositionConfirmationConflictIssues = propositionBindings
    .filter((item) => ["recommendation", "next_action"].includes(item.predicate))
    .filter(
      (item) =>
        Math.floor(toFiniteNumber(item.supportSummary?.epistemicStatusCounts?.contested, 0)) > 0 ||
        Math.floor(toFiniteNumber(item.supportSummary?.epistemicStatusCounts?.rejected, 0)) > 0
    )
    .slice(0, 6)
    .map((item) => ({
      code: "proposition_confirmation_conflict",
      sentence: item.sentence,
      proposition: {
        subject: item.subject,
        predicate: item.predicate,
        object: item.object,
        polarity: item.polarity,
      },
      contestedCount: Math.floor(toFiniteNumber(item.supportSummary?.epistemicStatusCounts?.contested, 0)),
      rejectedCount: Math.floor(toFiniteNumber(item.supportSummary?.epistemicStatusCounts?.rejected, 0)),
      message: "该 proposition 绑定到了相互冲突或被拒绝的外部确认，不能继续表述成稳定确认结论。",
    }));
  issues.push(...propositionConfirmationConflictIssues);

  const propositionConfirmationStaleIssues = propositionBindings
    .filter((item) => ["recommendation", "next_action"].includes(item.predicate))
    .filter(
      (item) =>
        Math.floor(toFiniteNumber(item.supportSummary?.confirmationAgreementStatusCounts?.stale_confirmed, 0)) > 0 ||
        Math.floor(toFiniteNumber(item.supportSummary?.confirmationAgreementStatusCounts?.stale_conflicted, 0)) > 0 ||
        Math.floor(toFiniteNumber(item.supportSummary?.confirmationAgreementStatusCounts?.confirmation_timeout, 0)) > 0
    )
    .slice(0, 6)
    .map((item) => ({
      code:
        Math.floor(toFiniteNumber(item.supportSummary?.confirmationAgreementStatusCounts?.confirmation_timeout, 0)) > 0
          ? "proposition_confirmation_timeout"
          : "proposition_confirmation_stale",
      sentence: item.sentence,
      proposition: {
        subject: item.subject,
        predicate: item.predicate,
        object: item.object,
        polarity: item.polarity,
      },
      staleConfirmedCount: Math.floor(toFiniteNumber(item.supportSummary?.confirmationAgreementStatusCounts?.stale_confirmed, 0)),
      staleConflictedCount: Math.floor(toFiniteNumber(item.supportSummary?.confirmationAgreementStatusCounts?.stale_conflicted, 0)),
      timeoutCount: Math.floor(toFiniteNumber(item.supportSummary?.confirmationAgreementStatusCounts?.confirmation_timeout, 0)),
      message:
        Math.floor(toFiniteNumber(item.supportSummary?.confirmationAgreementStatusCounts?.confirmation_timeout, 0)) > 0
          ? "该 proposition 主要绑定到已超时的外部确认，不能当成当前有效结论。"
          : "该 proposition 主要绑定到陈旧确认或陈旧冲突确认，不能当成当前有效结论。",
    }));
  issues.push(...propositionConfirmationStaleIssues);

  const propositionHighAuthorityRejectionIssues = propositionBindings
    .filter((item) => ["recommendation", "next_action"].includes(item.predicate))
    .filter(
      (item) =>
        Math.floor(toFiniteNumber(item.supportSummary?.confirmationAgreementStatusCounts?.high_authority_rejected, 0)) > 0 ||
        Math.floor(toFiniteNumber(item.supportSummary?.highAuthorityConflictingSupportCount, 0)) > 0
    )
    .slice(0, 6)
    .map((item) => ({
      code: "proposition_high_authority_rejection",
      sentence: item.sentence,
      proposition: {
        subject: item.subject,
        predicate: item.predicate,
        object: item.object,
        polarity: item.polarity,
      },
      highAuthorityConflictingSupportCount: Math.floor(toFiniteNumber(item.supportSummary?.highAuthorityConflictingSupportCount, 0)),
      message: "该 proposition 已被高权威外部来源明确压制或拒绝，不能继续表述成当前推荐结论。",
    }));
  issues.push(...propositionHighAuthorityRejectionIssues);

  const propositionSupersededDecisionIssues = propositionBindings
    .filter((item) => ["recommendation", "next_action"].includes(item.predicate))
    .map((item) => {
      const currentValue =
        item.predicate === "recommendation"
          ? currentDecisionState?.payload?.value?.recommendation
          : currentActionState?.payload?.value?.action;
      const currentStatus =
        normalizeOptionalText(
          item.predicate === "recommendation"
            ? currentDecisionState?.payload?.value?.status
            : currentActionState?.payload?.value?.status
        ) ?? null;
      const currentComparable = normalizeComparableText(currentValue);
      const propositionComparable = normalizeComparableText(item.object);
      const sameDecision =
        currentComparable &&
        propositionComparable &&
        (currentComparable === propositionComparable || compareTextSimilarity(currentComparable, propositionComparable) >= 0.72);
      if (!currentComparable || !propositionComparable || sameDecision) {
        return null;
      }
      if (!["confirmed", "decided", "contested", "rejected", "planned", "blocked"].includes(currentStatus || "")) {
        return null;
      }
      return {
        code: "proposition_superseded_by_current_decision",
        sentence: item.sentence,
        proposition: {
          subject: item.subject,
          predicate: item.predicate,
          object: item.object,
          polarity: item.polarity,
        },
        currentDecision: {
          object: normalizeOptionalText(currentValue) ?? null,
          status: currentStatus,
          field: item.predicate === "recommendation" ? "match.decision_provenance" : "match.action_execution",
        },
        message: "该 proposition 已被当前生效的 decision/action state 改写，不能继续当成当前有效结论。",
      };
    })
    .filter(Boolean)
    .slice(0, 6);
  issues.push(...propositionSupersededDecisionIssues);

  const causalBindingIssues = causalBindings
    .filter(
      (relation) =>
        relation.cause.combinedSupportSummary.totalSupportCount === 0 || relation.effect.combinedSupportSummary.totalSupportCount === 0
    )
    .slice(0, 4)
    .map((relation) => ({
      code: "causal_binding_gap",
      sentence: relation.relationText,
      connector: relation.connector,
      missingSide:
        relation.cause.combinedSupportSummary.totalSupportCount === 0 && relation.effect.combinedSupportSummary.totalSupportCount === 0
          ? "cause_and_effect"
          : relation.cause.combinedSupportSummary.totalSupportCount === 0
            ? "cause"
            : "effect",
      message: "回复使用了因果链，但 cause / effect 没有同时绑定到足够的本地支撑。",
    }));
  issues.push(...causalBindingIssues);

  const causalRealityIssues = causalBindings
    .filter((relation) => relation.supportSummary.verifiedEquivalentCount === 0)
    .filter((relation) => relation.supportSummary.externalLikeCount === 0)
    .filter(
      (relation) =>
        relation.supportSummary.lowRealityCount > 0 || relation.supportSummary.internallyGeneratedCount > 0
    )
    .slice(0, 4)
    .map((relation) => ({
      code: "causal_relation_reality_gap",
      sentence: relation.relationText,
      connector: relation.connector,
      message: "该因果关系主要建立在内部推断或低现实性支撑上，应该保留假设语气，而不是当成已证实因果链。",
    }));
  issues.push(...causalRealityIssues);

  const causalChainGapIssues = causalChains
    .filter((chain) => !chain.eventGraphPath?.pathFound)
    .slice(0, 4)
    .map((chain) => ({
      code: "causal_chain_gap",
      sentence: chain.relationTexts.join(" "),
      relationCount: chain.relationCount,
      startText: chain.startText,
      endText: chain.endText,
      message: "回复形成了多跳因果链，但本地事件图里没有找到从起点到终点的稳定路径。",
    }));
  issues.push(...causalChainGapIssues);

  const causalChainRealityIssues = causalChains
    .filter((chain) => chain.eventGraphPath?.pathFound)
    .filter((chain) => Math.floor(toFiniteNumber(chain.eventGraphPath?.supportSummary?.verifiedEquivalentCount, 0)) === 0)
    .filter((chain) => Math.floor(toFiniteNumber(chain.eventGraphPath?.supportSummary?.externalLikeCount, 0)) === 0)
    .filter(
      (chain) =>
        Math.floor(toFiniteNumber(chain.eventGraphPath?.supportSummary?.lowRealityCount, 0)) > 0 ||
        Math.floor(toFiniteNumber(chain.eventGraphPath?.supportSummary?.internallyGeneratedCount, 0)) > 0
    )
    .slice(0, 4)
    .map((chain) => ({
      code: "causal_chain_reality_gap",
      sentence: chain.relationTexts.join(" "),
      relationCount: chain.relationCount,
      startText: chain.startText,
      endText: chain.endText,
      message: "多跳因果链目前主要依赖低现实性或内部生成的路径支撑，应该保留假设语气。",
    }));
  issues.push(...causalChainRealityIssues);

  return {
    checkedAt: now(),
    agentId: agent.agentId,
    didMethod: normalizeDidMethod(didMethod) || didMethodFromReference(resolvedDid) || null,
    valid: issues.length === 0,
    issues,
    inferredClaims,
    references: {
      did: resolvedDid,
      parentAgentId: agent.parentAgentId || null,
      authorizationPolicy: cloneJson(agent.identity?.authorizationPolicy || null),
      profile: expectedProfile,
      sourceMonitoring: cloneJson(sourceMonitoring) ?? null,
      certaintySignal,
      sentenceAnalysis,
      discourseState,
      discourseGraph,
      counterfactualTraces,
      bindingSupportSummary: boundSupportSummary,
      claimBindings,
      sentenceBindings,
      propositionBindings,
      causalBindings,
      causalChains,
      eventGraph: cloneJson(eventGraph) ?? null,
    },
  };
}

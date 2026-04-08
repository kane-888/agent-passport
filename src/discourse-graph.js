import { normalizeOptionalText } from "./ledger-core-utils.js";

function addNode(nodesById, node) {
  const nodeId = normalizeOptionalText(node?.nodeId || node?.id) ?? null;
  if (!nodeId) {
    return null;
  }
  if (!nodesById.has(nodeId)) {
    nodesById.set(nodeId, {
      nodeId,
      type: normalizeOptionalText(node?.type) ?? "node",
      label: normalizeOptionalText(node?.label) ?? nodeId,
      sentenceIndex: Number.isFinite(Number(node?.sentenceIndex)) ? Number(node.sentenceIndex) : null,
      referentKind: normalizeOptionalText(node?.referentKind) ?? null,
      propositionId: normalizeOptionalText(node?.propositionId) ?? null,
      metadata: node?.metadata && typeof node.metadata === "object" ? { ...node.metadata } : null,
    });
  }
  return nodeId;
}

function addEdge(edgesByKey, edge) {
  const from = normalizeOptionalText(edge?.from) ?? null;
  const to = normalizeOptionalText(edge?.to) ?? null;
  const relation = normalizeOptionalText(edge?.relation) ?? "associative";
  if (!from || !to || from === to) {
    return null;
  }
  const key = `${from}:${relation}:${to}`;
  if (!edgesByKey.has(key)) {
    edgesByKey.set(key, {
      edgeId: `disc_edge_${edgesByKey.size + 1}`,
      from,
      to,
      relation,
      sentenceIndex: Number.isFinite(Number(edge?.sentenceIndex)) ? Number(edge.sentenceIndex) : null,
      weight: Number.isFinite(Number(edge?.weight)) ? Number(edge.weight) : 0.66,
      metadata: edge?.metadata && typeof edge.metadata === "object" ? { ...edge.metadata } : null,
    });
  }
  return key;
}

function normalizeReferents(discourseState = null) {
  if (!discourseState) {
    return [];
  }
  if (Array.isArray(discourseState.referents)) {
    return discourseState.referents.filter(Boolean);
  }
  if (discourseState.referents && typeof discourseState.referents === "object") {
    return Object.values(discourseState.referents).filter(Boolean);
  }
  return [];
}

export function buildDiscourseGraph({ propositions = [], discourseState = null } = {}) {
  const nodesById = new Map();
  const edgesByKey = new Map();
  const referents = normalizeReferents(discourseState);
  const sortedPropositions = [...(Array.isArray(propositions) ? propositions : [])]
    .filter(Boolean)
    .sort((left, right) => {
      const sentenceDelta = (left?.sentenceIndex ?? 0) - (right?.sentenceIndex ?? 0);
      if (sentenceDelta) {
        return sentenceDelta;
      }
      const leftClause = left?.negationScope?.clauseIndex ?? left?.quantifierScope?.clauseIndex ?? 0;
      const rightClause = right?.negationScope?.clauseIndex ?? right?.quantifierScope?.clauseIndex ?? 0;
      return leftClause - rightClause;
    });

  for (const referent of referents) {
    addNode(nodesById, {
      nodeId: normalizeOptionalText(referent?.referentId) ?? null,
      type: "referent",
      label: normalizeOptionalText(referent?.label) ?? normalizeOptionalText(referent?.kind) ?? "referent",
      referentKind: normalizeOptionalText(referent?.kind) ?? null,
      metadata: {
        mentionCount: Number.isFinite(Number(referent?.mentionCount)) ? Number(referent.mentionCount) : 0,
        sourceFields: Array.isArray(referent?.sourceFields) ? referent.sourceFields.slice(0, 6) : [],
        lastMentionText: normalizeOptionalText(referent?.lastMentionText) ?? null,
      },
    });
  }

  let previousProposition = null;
  for (const proposition of sortedPropositions) {
    const propositionNodeId = addNode(nodesById, {
      nodeId: proposition?.propositionId,
      propositionId: proposition?.propositionId,
      type: "proposition",
      label: normalizeOptionalText(proposition?.canonicalText) ?? normalizeOptionalText(proposition?.rawText) ?? proposition?.propositionId,
      sentenceIndex: proposition?.sentenceIndex,
      referentKind: proposition?.referentKind,
      metadata: {
        predicate: normalizeOptionalText(proposition?.predicate) ?? null,
        object: normalizeOptionalText(proposition?.object) ?? null,
        polarity: normalizeOptionalText(proposition?.polarity) ?? null,
        subjectResolution: proposition?.subjectResolution ?? null,
        quantifierScope: proposition?.quantifierScope ?? null,
        negationScope: proposition?.negationScope ?? null,
        clauseConnector: normalizeOptionalText(proposition?.normalization?.clauseConnector) ?? null,
      },
    });
    if (!propositionNodeId) {
      continue;
    }

    for (const discourseRef of Array.isArray(proposition?.discourseRefs) ? proposition.discourseRefs : []) {
      if (!nodesById.has(discourseRef)) {
        addNode(nodesById, {
          nodeId: discourseRef,
          type: "referent",
          label: discourseRef.replace(/^disc_/u, ""),
        });
      }
      addEdge(edgesByKey, {
        from: propositionNodeId,
        to: discourseRef,
        relation: "refers_to",
        sentenceIndex: proposition?.sentenceIndex,
        weight: 0.92,
      });
      if (normalizeOptionalText(proposition?.subjectResolution?.mode) && proposition.subjectResolution.mode !== "explicit") {
        addEdge(edgesByKey, {
          from: discourseRef,
          to: propositionNodeId,
          relation: "supports_subject_resolution",
          sentenceIndex: proposition?.sentenceIndex,
          weight: proposition.subjectResolution.mode === "active_referent" ? 0.88 : 0.72,
          metadata: {
            mode: proposition.subjectResolution.mode,
          },
        });
      }
    }

    if (previousProposition?.propositionId) {
      const previousRefs = new Set(previousProposition.discourseRefs || []);
      const sharedRefs = (proposition.discourseRefs || []).filter((item) => previousRefs.has(item));
      if (sharedRefs.length > 0) {
        addEdge(edgesByKey, {
          from: previousProposition.propositionId,
          to: propositionNodeId,
          relation: "same_referent_progression",
          sentenceIndex: proposition?.sentenceIndex,
          weight: 0.78,
          metadata: {
            sharedRefs,
          },
        });
      }
      if (
        normalizeOptionalText(previousProposition?.predicate) &&
        normalizeOptionalText(previousProposition?.predicate) === normalizeOptionalText(proposition?.predicate)
      ) {
        addEdge(edgesByKey, {
          from: previousProposition.propositionId,
          to: propositionNodeId,
          relation: "same_predicate_progression",
          sentenceIndex: proposition?.sentenceIndex,
          weight: 0.7,
        });
      }
      const clauseConnector = normalizeOptionalText(proposition?.normalization?.clauseConnector) ?? null;
      if (clauseConnector) {
        const relation =
          clauseConnector === "contrast"
            ? "contrast_transition"
            : clauseConnector === "condition"
              ? "condition_transition"
              : clauseConnector === "consequence"
                ? "consequence_transition"
                : "addition_transition";
        addEdge(edgesByKey, {
          from: previousProposition.propositionId,
          to: propositionNodeId,
          relation,
          sentenceIndex: proposition?.sentenceIndex,
          weight: 0.72,
          metadata: {
            clauseConnector,
          },
        });
      }
      const quantifierFrameType = normalizeOptionalText(proposition?.quantifierScope?.frameType) ?? null;
      const quantifierFrameRole = normalizeOptionalText(proposition?.quantifierScope?.frameRole) ?? null;
      if (quantifierFrameType === "exclusive_condition" && quantifierFrameRole === "consequent") {
        addEdge(edgesByKey, {
          from: previousProposition.propositionId,
          to: propositionNodeId,
          relation: "exclusive_condition_gate",
          sentenceIndex: proposition?.sentenceIndex,
          weight: 0.84,
          metadata: {
            cue: normalizeOptionalText(proposition?.quantifierScope?.frameCue) ?? null,
          },
        });
      }
      const negationFrameType = normalizeOptionalText(proposition?.negationScope?.frameType) ?? null;
      const negationFrameRole = normalizeOptionalText(proposition?.negationScope?.frameRole) ?? null;
      if (negationFrameType === "negated_causal" && negationFrameRole === "consequent") {
        addEdge(edgesByKey, {
          from: previousProposition.propositionId,
          to: propositionNodeId,
          relation: "negated_causal_frame",
          sentenceIndex: proposition?.sentenceIndex,
          weight: 0.78,
          metadata: {
            cue: normalizeOptionalText(proposition?.negationScope?.frameCue) ?? null,
          },
        });
      }
      if (negationFrameType === "counterfactual_conditional" || quantifierFrameType === "counterfactual_conditional") {
        addEdge(edgesByKey, {
          from: previousProposition.propositionId,
          to: propositionNodeId,
          relation: "counterfactual_conditional",
          sentenceIndex: proposition?.sentenceIndex,
          weight: 0.74,
        });
      }
    }

    previousProposition = proposition;
  }

  const nodes = Array.from(nodesById.values());
  const edges = Array.from(edgesByKey.values());
  return {
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      referents: nodes.filter((item) => item.type === "referent").length,
      propositions: nodes.filter((item) => item.type === "proposition").length,
    },
  };
}

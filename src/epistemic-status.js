import { normalizeOptionalText } from "./ledger-core-utils.js";

const EPISTEMIC_STATUSES = new Set([
  "observed",
  "reported",
  "inferred",
  "planned",
  "decided",
  "confirmed",
  "contested",
  "rejected",
  "counterfactual",
]);

const DECISION_STATUS_ALIASES = new Map([
  ["observed", "observed"],
  ["perceived", "observed"],
  ["reported", "reported"],
  ["derived", "inferred"],
  ["inferred", "inferred"],
  ["hypothesis", "inferred"],
  ["planned", "planned"],
  ["queued", "planned"],
  ["scheduled", "planned"],
  ["decided", "decided"],
  ["recommended", "decided"],
  ["proposed", "decided"],
  ["approved", "confirmed"],
  ["confirmed", "confirmed"],
  ["verified", "confirmed"],
  ["accepted", "confirmed"],
  ["contested", "contested"],
  ["conflicted", "contested"],
  ["conflict", "contested"],
  ["disputed", "contested"],
  ["rejected", "rejected"],
  ["denied", "rejected"],
  ["declined", "rejected"],
  ["blocked", "rejected"],
  ["cancelled", "rejected"],
  ["counterfactual", "counterfactual"],
  ["simulated", "counterfactual"],
]);

function normalizeDecisionStatus(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }
  return DECISION_STATUS_ALIASES.get(normalized) ?? null;
}

export function normalizeEpistemicStatus(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  return normalized && EPISTEMIC_STATUSES.has(normalized) ? normalized : null;
}

export function inferEpistemicStatus({
  epistemicStatus = null,
  sourceType = null,
  field = null,
  kind = null,
  sourceKind = null,
  verifiedEquivalent = false,
  value = null,
  payload = null,
  counterfactual = false,
} = {}) {
  const explicitStatuses = [
    epistemicStatus,
    payload?.epistemicStatus,
    payload?.payload?.epistemicStatus,
    value?.epistemicStatus,
    field && String(field).includes("decision_provenance") ? value?.status : null,
    field && String(field).includes("decision_provenance") ? value?.decisionStatus : null,
  ]
    .map((item) => normalizeEpistemicStatus(item) ?? normalizeDecisionStatus(item))
    .filter(Boolean);
  if (explicitStatuses.length > 0) {
    return explicitStatuses[0];
  }

  if (counterfactual || value?.counterfactual === true || payload?.counterfactual === true) {
    return "counterfactual";
  }

  const normalizedField = normalizeOptionalText(field)?.toLowerCase() ?? "";
  const normalizedKind = normalizeOptionalText(kind)?.toLowerCase() ?? "";
  const normalizedSourceType = normalizeOptionalText(sourceType)?.toLowerCase() ?? "";
  const normalizedSourceKind = normalizeOptionalText(sourceKind)?.toLowerCase() ?? "";

  if (verifiedEquivalent || normalizedSourceKind === "identity_fact" || normalizedSourceType === "verified") {
    return "confirmed";
  }

  if (
    normalizedField.includes("next_action") ||
    normalizedField.includes("coordination_action") ||
    normalizedKind.includes("next_action") ||
    normalizedKind.includes("followup_action")
  ) {
    return "planned";
  }

  if (
    normalizedField.includes("decision_provenance") ||
    normalizedField.includes("recommendation") ||
    normalizedKind.includes("recommendation")
  ) {
    return "decided";
  }

  if (normalizedSourceType === "perceived") {
    return "observed";
  }
  if (normalizedSourceType === "reported") {
    return "reported";
  }
  if (normalizedSourceType === "derived" || normalizedSourceType === "inferred") {
    return "inferred";
  }
  if (normalizedSourceType === "system") {
    return normalizedKind.includes("checkpoint") ? "inferred" : "reported";
  }

  return null;
}

export function inferPropositionEpistemicStatus({
  epistemicStatus = null,
  predicate = null,
  field = null,
  sourceType = null,
  sourceKind = null,
  verifiedEquivalent = false,
  value = null,
  rawText = null,
  counterfactual = false,
} = {}) {
  const explicit = normalizeEpistemicStatus(epistemicStatus) ?? normalizeDecisionStatus(epistemicStatus);
  if (explicit) {
    return explicit;
  }

  const normalizedPredicate = normalizeOptionalText(predicate)?.toLowerCase() ?? "";
  if (counterfactual || /(?:如果|假如|要是|设想)/u.test(normalizeOptionalText(rawText) ?? "")) {
    return "counterfactual";
  }
  if (normalizedPredicate === "recommendation") {
    return inferEpistemicStatus({
      epistemicStatus: value?.epistemicStatus ?? value?.status ?? value?.decisionStatus ?? "decided",
      field,
      sourceType,
      sourceKind,
      verifiedEquivalent,
      value,
      counterfactual,
    });
  }
  if (normalizedPredicate === "next_action") {
    return inferEpistemicStatus({
      epistemicStatus: value?.epistemicStatus ?? "planned",
      field,
      sourceType,
      sourceKind,
      verifiedEquivalent,
      value,
      counterfactual,
    });
  }

  return inferEpistemicStatus({
    epistemicStatus,
    field,
    sourceType,
    sourceKind,
    verifiedEquivalent,
    value,
    counterfactual,
  });
}

export function buildEpistemicStatusCounts(items = [], selector = (item) => item?.epistemicStatus ?? null) {
  const counts = {
    observed: 0,
    reported: 0,
    inferred: 0,
    planned: 0,
    decided: 0,
    confirmed: 0,
    contested: 0,
    rejected: 0,
    counterfactual: 0,
  };
  for (const item of Array.isArray(items) ? items : []) {
    const status = normalizeEpistemicStatus(selector(item));
    if (status) {
      counts[status] += 1;
    }
  }
  return counts;
}

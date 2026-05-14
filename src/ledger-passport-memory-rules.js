import {
  normalizeComparableText,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";

const TASK_SNAPSHOT_STATUSES = new Set(["draft", "active", "blocked", "paused", "completed"]);
const DECISION_LOG_STATUSES = new Set(["active", "superseded", "rejected"]);
const EVIDENCE_REF_KINDS = new Set(["document", "memory", "credential", "status_list", "window", "message", "url", "note"]);
const PASSPORT_MEMORY_LAYERS = new Set(["ledger", "profile", "episodic", "working", "semantic"]);
const PASSPORT_MEMORY_SOURCE_TYPES = new Set(["perceived", "reported", "inferred", "derived", "verified", "system"]);
const PASSPORT_MEMORY_CONSOLIDATION_STATES = new Set(["hot", "stabilizing", "consolidated"]);
const DEFAULT_WORKING_MEMORY_ELIGIBILITY_HOURS = 6;
const DEFAULT_EPISODIC_MEMORY_ELIGIBILITY_HOURS = 48;
const DEFAULT_LAYER_RECONSOLIDATION_WINDOW_HOURS = {
  working: 2,
  episodic: 18,
  semantic: 36,
  profile: 48,
  ledger: 0,
};

export function normalizeTaskSnapshotStatus(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  return TASK_SNAPSHOT_STATUSES.has(normalized) ? normalized : "active";
}

export function normalizeDecisionLogStatus(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  return DECISION_LOG_STATUSES.has(normalized) ? normalized : "active";
}

export function normalizeEvidenceRefKind(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  return EVIDENCE_REF_KINDS.has(normalized) ? normalized : "document";
}

export function normalizePassportMemoryLayer(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  return PASSPORT_MEMORY_LAYERS.has(normalized) ? normalized : "working";
}

export function normalizePassportMemorySourceType(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  return PASSPORT_MEMORY_SOURCE_TYPES.has(normalized) ? normalized : null;
}

export function normalizePassportMemoryConsolidationState(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  return PASSPORT_MEMORY_CONSOLIDATION_STATES.has(normalized) ? normalized : null;
}

export function normalizePassportMemoryUnitScore(value, fallback = null) {
  const numeric = toFiniteNumber(value, NaN);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

export function inferPassportMemorySourceType(layer, payload = {}) {
  const explicit = normalizePassportMemorySourceType(payload.sourceType || payload.payload?.sourceType);
  if (explicit) {
    return explicit;
  }

  if (layer === "working") {
    return normalizeOptionalText(payload.kind) === "sensory_snapshot" ? "perceived" : "system";
  }
  if (layer === "episodic") {
    return "system";
  }
  if (layer === "semantic") {
    return "derived";
  }
  if (layer === "profile") {
    return "reported";
  }
  return "verified";
}

export function inferPassportMemoryConsolidationState(layer, payload = {}) {
  const explicit = normalizePassportMemoryConsolidationState(
    payload.consolidationState || payload.payload?.consolidationState
  );
  if (explicit) {
    return explicit;
  }

  if (layer === "working") {
    return "hot";
  }
  if (layer === "episodic") {
    return "stabilizing";
  }
  return "consolidated";
}

export function normalizePassportNeuromodulation(payload = {}) {
  const candidate =
    (payload.neuromodulation && typeof payload.neuromodulation === "object" ? payload.neuromodulation : null) ??
    (payload.payload?.neuromodulation && typeof payload.payload?.neuromodulation === "object" ? payload.payload.neuromodulation : null) ??
    {};

  return {
    novelty: normalizePassportMemoryUnitScore(candidate.novelty, 0.22) ?? 0.22,
    reward: normalizePassportMemoryUnitScore(candidate.reward, 0.18) ?? 0.18,
    threat: normalizePassportMemoryUnitScore(candidate.threat, 0.12) ?? 0.12,
    social: normalizePassportMemoryUnitScore(candidate.social, 0.3) ?? 0.3,
  };
}

export function inferPassportSourceFeatureDefaults({ layer, payload = {}, sourceType = null } = {}) {
  const normalizedSourceType = normalizePassportMemorySourceType(sourceType);
  const kind = normalizeOptionalText(payload.kind) ?? null;
  const modality =
    normalizeOptionalText(payload.sourceFeatures?.modality) ??
    normalizeOptionalText(payload.payload?.sourceFeatures?.modality) ??
    (kind === "tool_result"
      ? "tool"
      : kind === "conversation_turn"
        ? "language"
        : kind === "checkpoint_summary"
          ? "compressed_summary"
          : kind === "sensory_snapshot"
            ? "perception_text"
            : layer === "semantic"
              ? "abstract_schema"
              : layer === "ledger" || layer === "profile"
                ? "structured_record"
                : "text");

  switch (normalizedSourceType) {
    case "verified":
      return {
        modality,
        generationMode: "externally_verified",
        perceptualDetailScore: 0.68,
        contextualDetailScore: 0.84,
        cognitiveOperationScore: 0.14,
        socialCorroborationScore: 0.82,
        externalAnchorCount: 3,
      };
    case "perceived":
      return {
        modality,
        generationMode: "external_perception",
        perceptualDetailScore: 0.82,
        contextualDetailScore: 0.74,
        cognitiveOperationScore: 0.18,
        socialCorroborationScore: 0.34,
        externalAnchorCount: 2,
      };
    case "reported":
      return {
        modality,
        generationMode: "social_report",
        perceptualDetailScore: 0.34,
        contextualDetailScore: 0.62,
        cognitiveOperationScore: 0.24,
        socialCorroborationScore: 0.72,
        externalAnchorCount: 2,
      };
    case "system":
      return {
        modality,
        generationMode: "system_trace",
        perceptualDetailScore: 0.22,
        contextualDetailScore: 0.92,
        cognitiveOperationScore: 0.12,
        socialCorroborationScore: 0.56,
        externalAnchorCount: 3,
      };
    case "derived":
      return {
        modality,
        generationMode: "internal_inference",
        perceptualDetailScore: 0.08,
        contextualDetailScore: 0.46,
        cognitiveOperationScore: 0.82,
        socialCorroborationScore: 0.2,
        externalAnchorCount: 1,
      };
    case "inferred":
      return {
        modality,
        generationMode: "internal_inference",
        perceptualDetailScore: 0.04,
        contextualDetailScore: 0.4,
        cognitiveOperationScore: 0.9,
        socialCorroborationScore: 0.14,
        externalAnchorCount: 0,
      };
    default:
      return {
        modality,
        generationMode: "unspecified",
        perceptualDetailScore: 0.24,
        contextualDetailScore: 0.48,
        cognitiveOperationScore: 0.42,
        socialCorroborationScore: 0.28,
        externalAnchorCount: 1,
      };
  }
}

export function computePassportSourceTrustScore(sourceType) {
  switch (normalizePassportMemorySourceType(sourceType)) {
    case "verified":
      return 1;
    case "perceived":
      return 0.82;
    case "reported":
      return 0.74;
    case "system":
      return 0.7;
    case "derived":
      return 0.46;
    case "inferred":
      return 0.38;
    default:
      return 0.5;
  }
}

export function computePassportRealityMonitoringScore({
  sourceType = null,
  perceptualDetailScore = 0,
  contextualDetailScore = 0,
  cognitiveOperationScore = 0,
  socialCorroborationScore = 0,
  externalAnchorCount = 0,
  generationMode = null,
} = {}) {
  const sourceTrust = computePassportSourceTrustScore(sourceType);
  const externalAnchorScore = Math.max(0, Math.min(1, toFiniteNumber(externalAnchorCount, 0) / 3));
  const externalModeBoost =
    ["externally_verified", "external_perception", "social_report", "system_trace"].includes(normalizeOptionalText(generationMode) ?? "")
      ? 0.06
      : 0;
  const inferentialPenalty =
    ["internal_inference", "compressed_summary"].includes(normalizeOptionalText(generationMode) ?? "")
      ? 0.08
      : 0;
  return Number(
    Math.max(
      0,
      Math.min(
        1,
        (
          (toFiniteNumber(perceptualDetailScore, 0) * 0.24) +
          (toFiniteNumber(contextualDetailScore, 0) * 0.22) +
          (externalAnchorScore * 0.2) +
          (toFiniteNumber(socialCorroborationScore, 0) * 0.12) +
          (sourceTrust * 0.16) +
          externalModeBoost -
          (toFiniteNumber(cognitiveOperationScore, 0) * 0.14) -
          inferentialPenalty
        ).toFixed(2)
      )
    )
  );
}

export function computePassportInternalGenerationRisk({
  sourceType = null,
  perceptualDetailScore = 0,
  contextualDetailScore = 0,
  cognitiveOperationScore = 0,
  socialCorroborationScore = 0,
  externalAnchorCount = 0,
  generationMode = null,
} = {}) {
  const normalizedSourceType = normalizePassportMemorySourceType(sourceType);
  const externalAnchorScore = Math.max(0, Math.min(1, toFiniteNumber(externalAnchorCount, 0) / 3));
  const inferentialBoost =
    ["derived", "inferred"].includes(normalizedSourceType) ||
    ["internal_inference", "compressed_summary"].includes(normalizeOptionalText(generationMode) ?? "")
      ? 0.14
      : 0;
  return Number(
    Math.max(
      0,
      Math.min(
        1,
        (
          (toFiniteNumber(cognitiveOperationScore, 0) * 0.44) +
          ((1 - externalAnchorScore) * 0.18) +
          ((1 - toFiniteNumber(perceptualDetailScore, 0)) * 0.12) +
          ((1 - toFiniteNumber(contextualDetailScore, 0)) * 0.08) +
          ((1 - toFiniteNumber(socialCorroborationScore, 0)) * 0.04) +
          inferentialBoost
        ).toFixed(2)
      )
    )
  );
}

export function normalizePassportSourceFeatures({ layer, payload = {}, sourceType = null } = {}) {
  const candidate =
    (payload.sourceFeatures && typeof payload.sourceFeatures === "object" ? payload.sourceFeatures : null) ??
    (payload.payload?.sourceFeatures && typeof payload.payload.sourceFeatures === "object" ? payload.payload.sourceFeatures : null) ??
    {};
  const defaults = inferPassportSourceFeatureDefaults({ layer, payload, sourceType });
  const features = {
    modality: normalizeOptionalText(candidate.modality) ?? defaults.modality,
    generationMode: normalizeOptionalText(candidate.generationMode) ?? defaults.generationMode,
    perceptualDetailScore:
      normalizePassportMemoryUnitScore(candidate.perceptualDetailScore, defaults.perceptualDetailScore) ?? defaults.perceptualDetailScore,
    contextualDetailScore:
      normalizePassportMemoryUnitScore(candidate.contextualDetailScore, defaults.contextualDetailScore) ?? defaults.contextualDetailScore,
    cognitiveOperationScore:
      normalizePassportMemoryUnitScore(candidate.cognitiveOperationScore, defaults.cognitiveOperationScore) ?? defaults.cognitiveOperationScore,
    socialCorroborationScore:
      normalizePassportMemoryUnitScore(candidate.socialCorroborationScore, defaults.socialCorroborationScore) ??
      defaults.socialCorroborationScore,
    externalAnchorCount: Math.max(
      0,
      Math.min(6, Math.floor(toFiniteNumber(candidate.externalAnchorCount, defaults.externalAnchorCount)))
    ),
  };
  return {
    ...features,
    realityMonitoringScore: computePassportRealityMonitoringScore({
      sourceType,
      ...features,
    }),
    internalGenerationRisk: computePassportInternalGenerationRisk({
      sourceType,
      ...features,
    }),
  };
}

export function inferPassportEligibilityWindowHours(layer, payload = {}) {
  const explicit = Math.floor(toFiniteNumber(payload.memoryDynamics?.eligibilityWindowHours, NaN));
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  if (layer === "working") {
    return DEFAULT_WORKING_MEMORY_ELIGIBILITY_HOURS;
  }
  if (layer === "episodic") {
    return DEFAULT_EPISODIC_MEMORY_ELIGIBILITY_HOURS;
  }
  return 0;
}

export function buildPassportEligibilityTrace({
  layer,
  payload = {},
  salience = null,
  confidence = null,
  neuromodulation = null,
}) {
  const traceScore =
    normalizePassportMemoryUnitScore(
      payload.memoryDynamics?.eligibilityTraceScore,
      Math.max(
        0,
        Math.min(
          1,
          (toFiniteNumber(salience, 0.5) * 0.4) +
            (toFiniteNumber(confidence, 0.5) * 0.15) +
            (toFiniteNumber(neuromodulation?.novelty, 0.2) * 0.2) +
            (toFiniteNumber(neuromodulation?.reward, 0.15) * 0.15) +
            (toFiniteNumber(neuromodulation?.social, 0.25) * 0.1)
        )
      )
    ) ?? 0.5;
  const existingUntil = normalizeOptionalText(payload.memoryDynamics?.eligibilityTraceUntil) ?? null;
  if (existingUntil) {
    return {
      eligibilityTraceScore: traceScore,
      eligibilityTraceUntil: existingUntil,
      eligibilityWindowHours: inferPassportEligibilityWindowHours(layer, payload),
    };
  }

  const windowHours = inferPassportEligibilityWindowHours(layer, payload);
  return {
    eligibilityTraceScore: traceScore,
    eligibilityTraceUntil:
      windowHours > 0 ? new Date(Date.now() + windowHours * 60 * 60 * 1000).toISOString() : null,
    eligibilityWindowHours: windowHours,
  };
}

export function computePassportAllocationBias({
  salience = null,
  confidence = null,
  neuromodulation = null,
}) {
  return Number(
    Math.max(
      0,
      Math.min(
        1,
        (
          (toFiniteNumber(salience, 0.5) * 0.35) +
          (toFiniteNumber(confidence, 0.5) * 0.15) +
          (toFiniteNumber(neuromodulation?.novelty, 0.2) * 0.25) +
          (toFiniteNumber(neuromodulation?.reward, 0.15) * 0.15) +
          (toFiniteNumber(neuromodulation?.social, 0.25) * 0.1)
        ).toFixed(2)
      )
    )
  );
}

export function inferPassportReconsolidationWindowHours(entry = {}) {
  const explicit = Math.floor(toFiniteNumber(entry?.memoryDynamics?.reconsolidationWindowHours, NaN));
  if (Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }
  const layer = normalizePassportMemoryLayer(entry?.layer);
  return DEFAULT_LAYER_RECONSOLIDATION_WINDOW_HOURS[layer] ?? 12;
}

export function isPassportMemoryActive(entry) {
  if (!entry) {
    return false;
  }
  if (normalizeOptionalText(entry?.memoryDynamics?.abstractedAt) || normalizeOptionalText(entry?.memoryDynamics?.abstractedMemoryId)) {
    return false;
  }
  return !["superseded", "forgotten", "decayed", "abstracted", "reverted"].includes(normalizeOptionalText(entry?.status) ?? "");
}

export function isPassportMemoryDestabilized(entry, referenceTime = now()) {
  const destabilizedUntil = normalizeOptionalText(entry?.memoryDynamics?.destabilizedUntil) ?? null;
  if (!destabilizedUntil || !isPassportMemoryActive(entry)) {
    return false;
  }
  const untilMs = Date.parse(destabilizedUntil);
  const referenceMs = Date.parse(referenceTime);
  return Number.isFinite(untilMs) && Number.isFinite(referenceMs) && untilMs >= referenceMs;
}

export function extractPassportMemoryComparableValue(entry) {
  const rawValue =
    entry?.payload?.value ??
    entry?.content ??
    entry?.summary ??
    null;
  if (Array.isArray(rawValue)) {
    return normalizeTextList(rawValue).join("|");
  }
  return normalizeComparableText(rawValue);
}

export function defaultPassportMemorySalience(layer, payload = {}) {
  const kind = normalizeOptionalText(payload.kind) ?? null;
  if (kind === "runtime_truth_source" || kind === "authorization_commitment") {
    return 0.95;
  }
  if (layer === "ledger") {
    return 0.9;
  }
  if (layer === "profile") {
    return 0.84;
  }
  if (layer === "semantic") {
    return 0.78;
  }
  if (layer === "episodic") {
    return 0.7;
  }
  return 0.58;
}

export function defaultPassportMemoryConfidence(layer, payload = {}) {
  const sourceType = inferPassportMemorySourceType(layer, payload);
  if (sourceType === "verified") {
    return 0.96;
  }
  if (sourceType === "reported") {
    return 0.82;
  }
  if (sourceType === "perceived" || sourceType === "system") {
    return 0.8;
  }
  if (sourceType === "derived" || sourceType === "inferred") {
    return 0.68;
  }
  return 0.72;
}

import {
  DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL,
  DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
} from "./ledger-device-runtime.js";
import { inspectMemoryStabilityLocalModelAsset } from "./local-model-assets/registry.js";
import {
  displayMemoryEngineLocalReasoner,
  resolveMemoryEngineLocalModel,
} from "./memory-engine-branding.js";
import { executeSandboxBroker } from "./runtime-sandbox-broker-client.js";

function normalizeOptionalText(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeReasonerProvider(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (["mock", "local_mock", "local_command", "ollama_local", "passthrough", "http", "openai_compatible"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeReasonerArgs(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function normalizePositiveInteger(value, fallback, minimum = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(minimum, Math.floor(fallback));
  }
  return Math.max(minimum, Math.floor(numeric));
}

function normalizePositiveIntegerOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(numeric));
}

function truncateText(value, maxChars = 400) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}...` : normalized;
}

function truncateTextWithinLimit(value, maxChars = 400) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 3) {
    return normalized.slice(0, Math.max(0, maxChars));
  }
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function normalizeFiniteNumberOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function stringifyReasonerJson(value) {
  return JSON.stringify(value);
}

function resolveOllamaLocalModelAssetGate(model) {
  const asset = inspectMemoryStabilityLocalModelAsset({ model, env: process.env });
  if (asset.compatibilityFallback) {
    return null;
  }
  if (asset.valid !== true) {
    throw new Error(
      `ollama_local asset not ready for ${asset.modelId ?? model}: ${normalizeOptionalText(asset.error) ?? "validation failed"}`
    );
  }
  return {
    modelId: asset.modelId ?? model,
    assetDirectoryName: asset.assetDirectoryName ?? null,
    manifestPath: asset.manifestPath ?? null,
    available: asset.available === true,
    valid: asset.valid === true,
  };
}

const REMOTE_REASONER_IDENTIFIER_PATTERN =
  /\b(?:pmem|trn|snap|dec|minute|evid|run|cbnd|bundle|setup|repair|msg|archive)_[a-z0-9_-]+\b/giu;
const DEFAULT_REMOTE_REASONER_TIMEOUT_MS = Math.max(
  1000,
  Math.floor(
    Number(
      process.env.AGENT_PASSPORT_REASONER_TIMEOUT_MS ??
        process.env.AGENT_PASSPORT_LLM_TIMEOUT_MS ??
        15000
    ) || 15000
  )
);
const DEFAULT_REMOTE_REASONER_MAX_RESPONSE_BYTES = Math.max(
  1024,
  Math.floor(
    Number(
      process.env.AGENT_PASSPORT_REASONER_MAX_RESPONSE_BYTES ??
        process.env.AGENT_PASSPORT_LLM_MAX_RESPONSE_BYTES ??
        262144
    ) || 262144
  )
);
const REMOTE_REASONER_FORBIDDEN_KEYS = new Set([
  "agentId",
  "builtAt",
  "contextHash",
  "did",
  "didMethod",
  "id",
  "ids",
  "memoryId",
  "memoryIds",
  "snapshotId",
  "taskSnapshotId",
  "minuteId",
  "minuteIds",
  "decisionId",
  "decisionIds",
  "evidenceRefId",
  "evidenceRefIds",
  "passportMemoryId",
  "passportMemoryIds",
  "transcriptEntryId",
  "transcriptEntryIds",
  "relatedRunId",
  "relatedCompactBoundaryId",
  "sourcePassportMemoryIds",
  "sourceId",
  "provenance",
  "tags",
  "recordedAt",
  "nodeId",
  "edgeId",
  "eventId",
  "fromNodeId",
  "toNodeId",
  "sourceNodeId",
  "targetNodeId",
  "layers",
  "relation",
  "patternKey",
  "separationKey",
  "supportSummary",
]);

const REMOTE_REASONER_BLOCKED_PROMPT_SECTIONS = new Set([
  "SYSTEM RULES",
  "COGNITIVE LOOP",
  "CONTINUOUS COGNITIVE STATE",
  "CURRENT GOAL",
  "EXTERNAL COLD MEMORY CANDIDATES",
  "TRANSCRIPT MODEL",
  "QUERY BUDGET",
  "RECENT CONVERSATION TURNS",
  "TOOL RESULTS",
  "WORKING MEMORY GATE",
  "EVENT GRAPH",
  "RELATED LINKS",
]);

const REMOTE_REASONER_PROMPT_SECTION_RENAMES = new Map([
  ["PERCEPTION SNAPSHOT", "OBSERVED INPUT"],
  ["LOCAL KNOWLEDGE HITS", "RELEVANT CONTEXT"],
  ["SOURCE MONITORING", "CAUTION CUES"],
  ["IDENTITY LAYER", "TASK FRAME"],
]);

const REMOTE_REASONER_ALLOWED_PROMPT_SECTIONS = new Set([
  "OBSERVED INPUT",
  "RELEVANT CONTEXT",
  "CAUTION CUES",
  "TASK FRAME",
]);

const REMOTE_REASONER_MAX_KNOWLEDGE_HITS = 3;
const REMOTE_REASONER_MAX_KNOWLEDGE_TITLE_CHARS = 80;
const REMOTE_REASONER_MAX_KNOWLEDGE_SUMMARY_CHARS = 120;
const REMOTE_REASONER_MAX_KNOWLEDGE_TOTAL_CHARS = 360;

function stripRemoteReasonerInternalIdentifiers(value) {
  if (value == null) {
    return value;
  }
  return String(value).replace(REMOTE_REASONER_IDENTIFIER_PATTERN, "[redacted-id]");
}

function sanitizeRemoteReasonerText(value, maxChars = 400) {
  return truncateTextWithinLimit(stripRemoteReasonerInternalIdentifiers(value), maxChars);
}

function normalizeRemoteReasonerHost(value) {
  let normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }
  if (normalized.includes("://")) {
    try {
      normalized = new URL(normalized).hostname.toLowerCase();
    } catch {
      normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
    }
  }
  normalized = normalized.replace(/^\[/u, "").replace(/\]$/u, "").replace(/\.$/u, "");
  return normalized || null;
}

function normalizeRemoteReasonerAllowedHosts(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeRemoteReasonerAllowedHosts(item));
  }
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/[\n,;]/u)
    .map((entry) => normalizeRemoteReasonerHost(entry))
    .filter(Boolean);
}

function isLoopbackRemoteReasonerHost(value) {
  const normalizedHost = normalizeRemoteReasonerHost(value);
  if (!normalizedHost) {
    return false;
  }
  return (
    normalizedHost === "localhost" ||
    normalizedHost === "::1" ||
    normalizedHost === "0:0:0:0:0:0:0:1" ||
    normalizedHost === "::ffff:127.0.0.1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalizedHost)
  );
}

function remoteReasonerHostMatchesAllowlist(requestedHost, allowlist = []) {
  const normalizedRequested = normalizeRemoteReasonerHost(requestedHost);
  if (!normalizedRequested) {
    return false;
  }
  return allowlist.some((entry) => {
    const normalizedEntry = normalizeRemoteReasonerHost(entry);
    if (!normalizedEntry) {
      return false;
    }
    if (normalizedEntry.startsWith("*.")) {
      const suffix = normalizedEntry.slice(1);
      return normalizedRequested.endsWith(suffix) && normalizedRequested.length > suffix.length;
    }
    if (normalizedEntry.startsWith(".")) {
      return normalizedRequested === normalizedEntry.slice(1) || normalizedRequested.endsWith(normalizedEntry);
    }
    return normalizedRequested === normalizedEntry;
  });
}

function resolveRemoteReasonerAllowedHosts(payload = {}, providerConfig = {}) {
  const reasonerConfig = payload?.reasoner && typeof payload.reasoner === "object" ? payload.reasoner : {};
  const deduped = new Set();
  for (const entry of [
    payload.reasonerAllowedHosts,
    payload.reasonerAllowedHost,
    providerConfig.allowedHosts,
    providerConfig.allowedHost,
    reasonerConfig.allowedHosts,
    reasonerConfig.allowedHost,
    process.env.AGENT_PASSPORT_REASONER_ALLOWED_HOSTS,
    process.env.AGENT_PASSPORT_LLM_ALLOWED_HOSTS,
  ]) {
    for (const host of normalizeRemoteReasonerAllowedHosts(entry)) {
      deduped.add(host);
    }
  }
  return [...deduped];
}

function resolveLocalReasonerAllowedHosts(payload = {}, providerConfig = {}) {
  const localReasonerConfig =
    payload?.localReasoner && typeof payload.localReasoner === "object" ? payload.localReasoner : {};
  const deduped = new Set();
  for (const entry of [
    payload.localReasonerAllowedHosts,
    payload.localReasonerAllowedHost,
    providerConfig.allowedHosts,
    providerConfig.allowedHost,
    localReasonerConfig.allowedHosts,
    localReasonerConfig.allowedHost,
    process.env.MEMORY_STABILITY_OLLAMA_ALLOWED_HOSTS,
    process.env.MEMORY_STABILITY_OLLAMA_ALLOWED_HOST,
    process.env.MEMORY_STABILITY_LOCAL_LLM_ALLOWED_HOSTS,
    process.env.MEMORY_STABILITY_LOCAL_LLM_ALLOWED_HOST,
    process.env.AGENT_PASSPORT_OLLAMA_ALLOWED_HOSTS,
    process.env.AGENT_PASSPORT_OLLAMA_ALLOWED_HOST,
  ]) {
    for (const host of normalizeRemoteReasonerAllowedHosts(entry)) {
      deduped.add(host);
    }
  }
  return [...deduped];
}

function resolveRemoteReasonerMaxResponseBytes(payload = {}, providerConfig = {}) {
  return normalizePositiveInteger(
    payload.reasonerMaxResponseBytes ??
      providerConfig.maxResponseBytes ??
      process.env.AGENT_PASSPORT_REASONER_MAX_RESPONSE_BYTES ??
      process.env.AGENT_PASSPORT_LLM_MAX_RESPONSE_BYTES ??
      DEFAULT_REMOTE_REASONER_MAX_RESPONSE_BYTES,
    DEFAULT_REMOTE_REASONER_MAX_RESPONSE_BYTES,
    128
  );
}

function assertRemoteReasonerEndpointAllowed(
  url,
  {
    provider,
    payload = {},
    providerConfig = {},
    allowedHosts = null,
  } = {}
) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${provider} reasoner URL is invalid`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${provider} reasoner URL must use http or https`);
  }
  if (normalizeOptionalText(parsed.username) || normalizeOptionalText(parsed.password)) {
    throw new Error(`${provider} reasoner URL must not include credentials`);
  }
  const host = normalizeRemoteReasonerHost(parsed.hostname);
  if (!host) {
    throw new Error(`${provider} reasoner URL host is required`);
  }
  if (!isLoopbackRemoteReasonerHost(host)) {
    const resolvedAllowedHosts =
      Array.isArray(allowedHosts) ? allowedHosts : resolveRemoteReasonerAllowedHosts(payload, providerConfig);
    if (!remoteReasonerHostMatchesAllowlist(host, resolvedAllowedHosts)) {
      throw new Error(`${provider} reasoner host not allowlisted: ${host}`);
    }
    return {
      url: parsed.toString(),
      host,
      boundary: "allowlist",
    };
  }
  return {
    url: parsed.toString(),
    host,
    boundary: "loopback",
  };
}

function buildRemoteReasonerRawPreview(bodyText, { contentType = "", bytes = null, maxPreviewChars = 1200 } = {}) {
  const rawText = typeof bodyText === "string" ? bodyText : JSON.stringify(bodyText ?? null);
  const sanitized = stripRemoteReasonerInternalIdentifiers(rawText);
  const preview = truncateTextWithinLimit(sanitized, maxPreviewChars);
  return {
    contentType: normalizeOptionalText(contentType) ?? null,
    bytes: normalizePositiveIntegerOrNull(bytes) ?? Buffer.byteLength(rawText, "utf8"),
    preview,
    truncated: preview !== sanitized,
  };
}

async function readRemoteReasonerResponseBody(response, { provider, maxResponseBytes } = {}) {
  const contentType = normalizeOptionalText(response?.headers?.get?.("content-type")) ?? "";
  const declaredBytes = normalizePositiveIntegerOrNull(response?.headers?.get?.("content-length"));
  if (declaredBytes != null && declaredBytes > maxResponseBytes) {
    throw new Error(`${provider} reasoner response exceeds ${maxResponseBytes} bytes`);
  }

  let bodyText = null;
  let parsedJson = null;
  if (typeof response?.text === "function") {
    bodyText = await response.text();
  } else if (typeof response?.json === "function") {
    parsedJson = await response.json();
    bodyText = JSON.stringify(parsedJson);
  } else {
    throw new Error(`${provider} reasoner response body is unreadable`);
  }

  const normalizedBodyText = String(bodyText ?? "");
  const bodyBytes = Buffer.byteLength(normalizedBodyText, "utf8");
  if (bodyBytes > maxResponseBytes) {
    throw new Error(`${provider} reasoner response exceeds ${maxResponseBytes} bytes`);
  }

  if (parsedJson == null && contentType.includes("application/json")) {
    try {
      parsedJson = JSON.parse(normalizedBodyText);
    } catch {
      throw new Error(`${provider} reasoner returned invalid JSON`);
    }
  }

  return {
    contentType,
    bodyText: normalizedBodyText,
    bodyBytes,
    parsedJson,
  };
}

function sanitizeRemoteReasonerStructuredValue(value) {
  if (value == null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const sanitizedItems = value
      .map((item) => sanitizeRemoteReasonerStructuredValue(item))
      .filter((item) => item !== undefined);
    return sanitizedItems.length > 0 ? sanitizedItems : undefined;
  }
  if (typeof value === "string") {
    return stripRemoteReasonerInternalIdentifiers(value);
  }
  if (typeof value !== "object") {
    return value;
  }

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (REMOTE_REASONER_FORBIDDEN_KEYS.has(key)) {
      continue;
    }
    const sanitizedChild = sanitizeRemoteReasonerStructuredValue(child);
    if (sanitizedChild !== undefined) {
      next[key] = sanitizedChild;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function buildLocalCommandIdentitySnapshot(identity = null) {
  if (!identity || typeof identity !== "object") {
    return null;
  }

  const profile = identity.profile && typeof identity.profile === "object" ? identity.profile : null;
  const taskSnapshot = identity.taskSnapshot && typeof identity.taskSnapshot === "object" ? identity.taskSnapshot : null;

  return {
    agentId: normalizeOptionalText(identity.agentId) ?? null,
    displayName: normalizeOptionalText(identity.displayName) ?? null,
    role: normalizeOptionalText(identity.role) ?? null,
    did: normalizeOptionalText(identity.did) ?? null,
    profile: profile
      ? {
          name: normalizeOptionalText(profile.name) ?? null,
          role: normalizeOptionalText(profile.role) ?? null,
          long_term_goal: truncateText(profile.long_term_goal, 240),
          stable_preferences: Array.isArray(profile.stable_preferences)
            ? profile.stable_preferences.slice(0, 8).map((item) => String(item))
            : [],
        }
      : null,
    taskSnapshot: taskSnapshot
      ? {
          snapshotId: normalizeOptionalText(taskSnapshot.snapshotId) ?? null,
          title: truncateText(taskSnapshot.title, 160),
          objective: truncateText(taskSnapshot.objective, 240),
          status: normalizeOptionalText(taskSnapshot.status) ?? null,
          nextAction: truncateText(taskSnapshot.nextAction, 200),
          checkpointSummary: truncateText(taskSnapshot.checkpointSummary, 240),
          currentPlan: Array.isArray(taskSnapshot.currentPlan)
            ? taskSnapshot.currentPlan.slice(0, 8).map((item) => truncateText(item, 120))
            : [],
        }
      : null,
  };
}

function buildLocalCommandTranscriptModel(transcriptModel = null) {
  if (!transcriptModel || typeof transcriptModel !== "object") {
    return null;
  }

  return {
    entryCount: Number(transcriptModel.entryCount || 0),
    latestEntryAt: normalizeOptionalText(transcriptModel.latestEntryAt) ?? null,
    latestEntryType: normalizeOptionalText(transcriptModel.latestEntryType) ?? null,
    families: Array.isArray(transcriptModel.families)
      ? transcriptModel.families.slice(0, 6).map((item) => String(item))
      : [],
    };
}

function buildLocalCommandContinuousCognitiveState(continuousCognitiveState = null) {
  if (!continuousCognitiveState || typeof continuousCognitiveState !== "object") {
    return null;
  }

  return {
    mode: normalizeOptionalText(continuousCognitiveState.mode) ?? null,
    dominantStage: normalizeOptionalText(continuousCognitiveState.dominantStage) ?? null,
    transitionReason: normalizeOptionalText(continuousCognitiveState.transitionReason) ?? null,
    fatigue: continuousCognitiveState.fatigue ?? null,
    sleepDebt: continuousCognitiveState.sleepDebt ?? null,
    uncertainty: continuousCognitiveState.uncertainty ?? null,
    rewardPredictionError: continuousCognitiveState.rewardPredictionError ?? null,
    threat: continuousCognitiveState.threat ?? null,
    novelty: continuousCognitiveState.novelty ?? null,
    socialSalience: continuousCognitiveState.socialSalience ?? null,
    homeostaticPressure: continuousCognitiveState.homeostaticPressure ?? null,
    sleepPressure: continuousCognitiveState.sleepPressure ?? null,
    dominantRhythm: normalizeOptionalText(continuousCognitiveState.dominantRhythm) ?? null,
    bodyLoop:
      continuousCognitiveState.bodyLoop && typeof continuousCognitiveState.bodyLoop === "object"
        ? {
            taskBacklog: continuousCognitiveState.bodyLoop.taskBacklog ?? null,
            conflictDensity: continuousCognitiveState.bodyLoop.conflictDensity ?? null,
            humanVetoRate: continuousCognitiveState.bodyLoop.humanVetoRate ?? null,
            overallLoad: continuousCognitiveState.bodyLoop.overallLoad ?? null,
          }
        : null,
    interoceptiveState:
      continuousCognitiveState.interoceptiveState && typeof continuousCognitiveState.interoceptiveState === "object"
        ? {
            sleepPressure: continuousCognitiveState.interoceptiveState.sleepPressure ?? null,
            allostaticLoad: continuousCognitiveState.interoceptiveState.allostaticLoad ?? null,
            metabolicStress: continuousCognitiveState.interoceptiveState.metabolicStress ?? null,
            interoceptivePredictionError: continuousCognitiveState.interoceptiveState.interoceptivePredictionError ?? null,
            bodyBudget: continuousCognitiveState.interoceptiveState.bodyBudget ?? null,
          }
        : null,
    neuromodulators:
      continuousCognitiveState.neuromodulators && typeof continuousCognitiveState.neuromodulators === "object"
        ? {
            dopamineRpe: continuousCognitiveState.neuromodulators.dopamineRpe ?? null,
            acetylcholineEncodeBias: continuousCognitiveState.neuromodulators.acetylcholineEncodeBias ?? null,
            norepinephrineSurprise: continuousCognitiveState.neuromodulators.norepinephrineSurprise ?? null,
            serotoninStability: continuousCognitiveState.neuromodulators.serotoninStability ?? null,
            dopaminergicAllocationBias: continuousCognitiveState.neuromodulators.dopaminergicAllocationBias ?? null,
          }
        : null,
    oscillationSchedule:
      continuousCognitiveState.oscillationSchedule && typeof continuousCognitiveState.oscillationSchedule === "object"
        ? {
            currentPhase: normalizeOptionalText(continuousCognitiveState.oscillationSchedule.currentPhase) ?? null,
            dominantRhythm: normalizeOptionalText(continuousCognitiveState.oscillationSchedule.dominantRhythm) ?? null,
            nextPhase: normalizeOptionalText(continuousCognitiveState.oscillationSchedule.nextPhase) ?? null,
            transitionReason: normalizeOptionalText(continuousCognitiveState.oscillationSchedule.transitionReason) ?? null,
            replayEligible: Boolean(continuousCognitiveState.oscillationSchedule.replayEligible),
            phaseWeights:
              continuousCognitiveState.oscillationSchedule.phaseWeights &&
              typeof continuousCognitiveState.oscillationSchedule.phaseWeights === "object"
                ? {
                    onlineThetaLike: continuousCognitiveState.oscillationSchedule.phaseWeights.online_theta_like ?? null,
                    offlineRippleLike: continuousCognitiveState.oscillationSchedule.phaseWeights.offline_ripple_like ?? null,
                    offlineHomeostatic: continuousCognitiveState.oscillationSchedule.phaseWeights.offline_homeostatic ?? null,
                  }
                : null,
          }
        : null,
    replayOrchestration:
      continuousCognitiveState.replayOrchestration && typeof continuousCognitiveState.replayOrchestration === "object"
        ? {
            shouldReplay: Boolean(continuousCognitiveState.replayOrchestration.shouldReplay),
            replayMode: normalizeOptionalText(continuousCognitiveState.replayOrchestration.replayMode) ?? null,
            replayDrive: continuousCognitiveState.replayOrchestration.replayDrive ?? null,
            consolidationBias: normalizeOptionalText(continuousCognitiveState.replayOrchestration.consolidationBias) ?? null,
            replayWindowHours: continuousCognitiveState.replayOrchestration.replayWindowHours ?? null,
            gatingReason: normalizeOptionalText(continuousCognitiveState.replayOrchestration.gatingReason) ?? null,
            targetTraceClasses: Array.isArray(continuousCognitiveState.replayOrchestration.targetTraceClasses)
              ? continuousCognitiveState.replayOrchestration.targetTraceClasses.slice(0, 6)
              : [],
          }
        : null,
    lastUpdatedAt: normalizeOptionalText(continuousCognitiveState.updatedAt || continuousCognitiveState.lastUpdatedAt) ?? null,
  };
}

function buildLocalCommandWorkingMemoryGate(workingMemoryGate = null) {
  if (!workingMemoryGate || typeof workingMemoryGate !== "object") {
    return null;
  }

  return {
    selectedCount: workingMemoryGate.selectedCount ?? null,
    blockedCount: workingMemoryGate.blockedCount ?? null,
    averageGateScore: workingMemoryGate.averageGateScore ?? null,
  };
}

function buildLocalCommandSourceMonitoring(sourceMonitoring = null) {
  if (!sourceMonitoring || typeof sourceMonitoring !== "object") {
    return null;
  }

  return {
    counts: sourceMonitoring.counts || null,
    cautions: Array.isArray(sourceMonitoring.cautions) ? sourceMonitoring.cautions.slice(0, 6) : [],
  };
}

function buildLocalCommandQueryBudget(queryBudget = null) {
  if (!queryBudget || typeof queryBudget !== "object") {
    return null;
  }

  return {
    estimatedContextTokens: queryBudget.estimatedContextTokens ?? null,
    maxContextTokens: queryBudget.maxContextTokens ?? null,
    maxContextChars: queryBudget.maxContextChars ?? null,
    maxQueryIterations: queryBudget.maxQueryIterations ?? null,
  };
}

function buildLocalCommandKnowledgeHit(hit = {}) {
  const provenanceSource =
    hit?.provenance && typeof hit.provenance === "object"
      ? hit.provenance
      : hit?.linked && typeof hit.linked === "object"
        ? hit.linked
        : null;
  return {
    sourceType: normalizeOptionalText(hit.sourceType) ?? null,
    sourceId: normalizeOptionalText(hit.sourceId) ?? null,
    title: truncateText(hit.title, 120),
    summary: truncateText(hit.summary, 180),
    excerpt: truncateText(hit.excerpt, 180),
    score: normalizeFiniteNumberOrNull(hit.score),
    providerScore: normalizeFiniteNumberOrNull(hit.providerScore),
    candidateOnly: hit.candidateOnly === true,
    provenance: provenanceSource
      ? {
          provider: normalizeOptionalText(provenanceSource.provider) ?? null,
          sourceFile: normalizeOptionalText(provenanceSource.sourceFile) ?? null,
          wing: normalizeOptionalText(provenanceSource.wing) ?? null,
          room: normalizeOptionalText(provenanceSource.room) ?? null,
        }
      : null,
    recordedAt: normalizeOptionalText(hit.recordedAt) ?? null,
    tags: Array.isArray(hit.tags) ? hit.tags.slice(0, 6).map((item) => String(item)) : [],
  };
}

function buildRemoteReasonerKnowledgeHit(hit = {}) {
  const title = sanitizeRemoteReasonerText(hit.title, REMOTE_REASONER_MAX_KNOWLEDGE_TITLE_CHARS);
  const rawSummary = sanitizeRemoteReasonerText(
    hit.summary || hit.snippet || hit.text || hit.excerpt,
    REMOTE_REASONER_MAX_KNOWLEDGE_SUMMARY_CHARS
  );
  const summary = title && rawSummary && title === rawSummary ? null : rawSummary;
  return sanitizeRemoteReasonerStructuredValue({
    title,
    summary,
  });
}

function estimateRemoteReasonerKnowledgeHitChars(hit = null) {
  if (!hit || typeof hit !== "object") {
    return 0;
  }
  return ["title", "summary"]
    .map((key) => normalizeOptionalText(hit[key])?.length ?? 0)
    .reduce((sum, value) => sum + value, 0);
}

function fitRemoteReasonerKnowledgeHitToBudget(hit = null, remainingChars = 0) {
  if (!hit || typeof hit !== "object" || remainingChars <= 0) {
    return null;
  }

  let title = normalizeOptionalText(hit.title);
  let summary = normalizeOptionalText(hit.summary);

  if (title && title.length > remainingChars) {
    title = truncateTextWithinLimit(title, Math.max(24, remainingChars));
  }

  let usedChars = title?.length ?? 0;
  let remainingAfterTitle = Math.max(remainingChars - usedChars, 0);
  if (summary) {
    if (remainingAfterTitle <= 24) {
      summary = null;
    } else if (summary.length > remainingAfterTitle) {
      summary = truncateTextWithinLimit(summary, remainingAfterTitle);
    }
  }

  return sanitizeRemoteReasonerStructuredValue({ title, summary }) ?? null;
}

function sanitizeRemoteReasonerKnowledgeHits(
  entries = [],
  limit = REMOTE_REASONER_MAX_KNOWLEDGE_HITS,
  totalChars = REMOTE_REASONER_MAX_KNOWLEDGE_TOTAL_CHARS
) {
  const next = [];
  let remainingChars = Math.max(0, Number(totalChars) || 0);
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (next.length >= limit || remainingChars <= 24) {
      break;
    }
    const baseHit = buildRemoteReasonerKnowledgeHit(entry);
    const fittedHit = fitRemoteReasonerKnowledgeHitToBudget(baseHit, remainingChars);
    if (!fittedHit) {
      continue;
    }
    next.push(fittedHit);
    remainingChars -= estimateRemoteReasonerKnowledgeHitChars(fittedHit);
  }
  return next;
}

function normalizeEventGraphNodeId(node = {}) {
  return normalizeOptionalText(node?.nodeId ?? node?.id ?? node?.eventId ?? node?.memoryId ?? null) ?? null;
}

function normalizeEventGraphEdgeEndpoint(edge = {}, keys = []) {
  for (const key of keys) {
    const value = normalizeOptionalText(edge?.[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function buildLocalCommandEventGraph(eventGraph = null) {
  if (!eventGraph || typeof eventGraph !== "object") {
    return null;
  }

  const nodes = (Array.isArray(eventGraph.nodes) ? eventGraph.nodes : [])
    .slice(0, 6)
    .map((node) => ({
      nodeId: normalizeEventGraphNodeId(node),
      text: normalizeOptionalText(node?.text ?? node?.title ?? node?.summary) ?? null,
      layers: Array.isArray(node?.layers) ? node.layers.slice(0, 3) : [],
    }))
    .filter((node) => node.nodeId || node.text || node.layers.length > 0);

  const nodeTextById = new Map(
    nodes
      .filter((node) => node.nodeId && node.text)
      .map((node) => [node.nodeId, node.text])
  );

  const edges = (Array.isArray(eventGraph.edges) ? eventGraph.edges : [])
    .slice(0, 6)
    .map((edge) => {
      const from = normalizeEventGraphEdgeEndpoint(edge, ["from", "fromNodeId", "source", "sourceId", "parentId"]);
      const to = normalizeEventGraphEdgeEndpoint(edge, ["to", "toNodeId", "target", "targetId", "childId"]);
      return {
        from,
        to,
        fromText: normalizeOptionalText(edge?.fromText ?? edge?.sourceText) ?? (from ? nodeTextById.get(from) ?? null : null),
        toText: normalizeOptionalText(edge?.toText ?? edge?.targetText) ?? (to ? nodeTextById.get(to) ?? null : null),
        relation: normalizeOptionalText(edge?.relation ?? edge?.linkType ?? edge?.type) ?? null,
        averageWeight: normalizeFiniteNumberOrNull(edge?.averageWeight),
      };
    })
    .filter((edge) => edge.from || edge.to || edge.fromText || edge.toText || edge.relation || edge.averageWeight != null);

  const nodeCount = normalizeFiniteNumberOrNull(eventGraph?.counts?.nodes) ?? nodes.length;
  const edgeCount = normalizeFiniteNumberOrNull(eventGraph?.counts?.edges) ?? edges.length;

  if (nodeCount <= 0 && edgeCount <= 0 && nodes.length === 0 && edges.length === 0) {
    return null;
  }

  return {
    counts: {
      nodes: nodeCount,
      edges: edgeCount,
    },
    nodes,
    edges,
  };
}

function parsePromptSections(prompt) {
  const lines = String(prompt ?? "").split(/\r?\n/u);
  const sections = [];
  let current = null;

  const pushCurrent = () => {
    if (current) {
      sections.push(current);
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const isSectionTitle = /^[A-Z][A-Z0-9 _-]+$/u.test(trimmed);
    if (isSectionTitle) {
      pushCurrent();
      current = {
        title: trimmed,
        bodyLines: [],
      };
      continue;
    }
    if (!current) {
      current = {
        title: null,
        bodyLines: [],
      };
    }
    current.bodyLines.push(line);
  }
  pushCurrent();

  return sections;
}

function renderPromptSections(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .filter(Boolean)
    .map((section) => {
      const body = Array.isArray(section.bodyLines) ? section.bodyLines.join("\n").trimEnd() : "";
      if (section.title) {
        return body ? `${section.title}\n${body}`.trimEnd() : section.title;
      }
      return body;
    })
    .filter((section) => Boolean(normalizeOptionalText(section)))
    .join("\n\n")
    .trim();
}

function tryParseJson(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function sanitizeRemoteReasonerPerceptionSnapshot(value = null) {
  const snapshot = value && typeof value === "object" ? value : null;
  if (!snapshot) {
    return null;
  }
  return {
    incomingTurns: (Array.isArray(snapshot.incomingTurns) ? snapshot.incomingTurns : []).slice(0, 3).map((turn) => ({
      role: normalizeOptionalText(turn?.role) ?? "unknown",
      content: sanitizeRemoteReasonerText(turn?.content, 240),
    })),
    toolSignals: (Array.isArray(snapshot.toolSignals) ? snapshot.toolSignals : []).slice(0, 3).map((entry) => ({
      tool: normalizeOptionalText(entry?.tool || entry?.name) ?? "tool",
      result: sanitizeRemoteReasonerText(entry?.result || entry?.output || entry?.content || entry?.summary, 240),
    })),
  };
}

function buildRemoteReasonerIdentitySnapshot(identity = null) {
  if (!identity || typeof identity !== "object") {
    return null;
  }

  const taskSnapshot = identity.taskSnapshot && typeof identity.taskSnapshot === "object" ? identity.taskSnapshot : null;
  const next = {
    taskSnapshot: taskSnapshot
      ? {
          title: sanitizeRemoteReasonerText(taskSnapshot.title, 160),
          objective: sanitizeRemoteReasonerText(taskSnapshot.objective, 240),
          status: normalizeOptionalText(taskSnapshot.status) ?? null,
          nextAction: sanitizeRemoteReasonerText(taskSnapshot.nextAction, 200),
          checkpointSummary: sanitizeRemoteReasonerText(taskSnapshot.checkpointSummary, 240),
        }
      : null,
  };
  return sanitizeRemoteReasonerStructuredValue(next) ?? null;
}

function buildRemoteReasonerSourceMonitoring(sourceMonitoring = null) {
  if (!sourceMonitoring || typeof sourceMonitoring !== "object") {
    return null;
  }

  const cautionCount = Number.isFinite(Number(sourceMonitoring.cautionCount))
    ? Number(sourceMonitoring.cautionCount)
    : Array.isArray(sourceMonitoring.cautions)
      ? sourceMonitoring.cautions.filter((item) => normalizeOptionalText(item)).length
      : 0;

  if (cautionCount <= 0) {
    return null;
  }

  return {
    cautionCount,
  };
}

function buildRemoteReasonerRetrievalSummary(retrieval = null, fallbackHitCount = 0) {
  const deliveredHitCount = Number.isFinite(Number(fallbackHitCount)) ? Number(fallbackHitCount) : 0;
  const hitCount = deliveredHitCount > 0
    ? deliveredHitCount
    : Number.isFinite(Number(retrieval?.hitCount))
      ? Number(retrieval.hitCount)
      : 0;
  return {
    hitCount,
  };
}

function buildRemoteReasonerTranscriptSummary(transcriptModel = null) {
  if (!transcriptModel || typeof transcriptModel !== "object") {
    return null;
  }

  return {
    redactedForRemoteReasoner: true,
  };
}

function buildRemoteReasonerRuntimeGuidance(continuousCognitiveState = null) {
  if (!continuousCognitiveState || typeof continuousCognitiveState !== "object") {
    return null;
  }

  const mode = normalizeOptionalText(continuousCognitiveState.mode)?.toLowerCase() ?? null;
  if (!mode || !["recovering", "recovery", "self_calibrating", "calibrating"].includes(mode)) {
    return null;
  }

  return {
    conservativeResponseMode: true,
  };
}

function buildRemoteReasonerExternalColdMemorySummary(value = null) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    redactedForRemoteReasoner: true,
  };
}

function sanitizeRemoteReasonerCompiledPromptSections(
  sections = [],
  {
    localKnowledgeHits = [],
    perceptionSnapshot = null,
  } = {}
) {
  const promptSections = Array.isArray(sections) ? sections : [];
  const sectionTransformers = {
    "LOCAL KNOWLEDGE HITS": (body) => {
      const parsed = tryParseJson(body);
      const hits = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.hits)
          ? parsed.hits
          : localKnowledgeHits;
      return stringifyReasonerJson(
        sanitizeRemoteReasonerStructuredValue(sanitizeRemoteReasonerKnowledgeHits(hits, REMOTE_REASONER_MAX_KNOWLEDGE_HITS))
      );
    },
    "PERCEPTION SNAPSHOT": (body) => {
      const parsed = tryParseJson(body);
      const sanitized = sanitizeRemoteReasonerPerceptionSnapshot(parsed ?? perceptionSnapshot);
      return sanitized ? stringifyReasonerJson(sanitizeRemoteReasonerStructuredValue(sanitized)) : null;
    },
    "SOURCE MONITORING": (body) => {
      const parsed = tryParseJson(body);
      const sanitized = buildRemoteReasonerSourceMonitoring(parsed);
      return sanitized ? stringifyReasonerJson(sanitized) : null;
    },
    "IDENTITY LAYER": (body) => {
      const parsed = tryParseJson(body);
      const sanitized = buildRemoteReasonerIdentitySnapshot(parsed);
      const promptPayload =
        sanitized?.taskSnapshot && typeof sanitized.taskSnapshot === "object" ? sanitized.taskSnapshot : sanitized;
      return promptPayload ? stringifyReasonerJson(promptPayload) : null;
    },
  };

  return promptSections.reduce((nextSections, section) => {
    if (!section?.title || REMOTE_REASONER_BLOCKED_PROMPT_SECTIONS.has(section.title)) {
      return nextSections;
    }

    const transform = sectionTransformers[section.title];
    let nextSection = section;
    if (typeof transform === "function") {
      const body = section.bodyLines.join("\n").trim();
      const nextBody = transform(body);
      if (nextBody == null) {
        return nextSections;
      }
      nextSection = {
        title: section.title,
        bodyLines: String(nextBody).split(/\r?\n/u),
      };
    }

    const body = nextSection.bodyLines.join("\n").trim();
    const parsed = tryParseJson(body);
    if (parsed != null) {
      const sanitized = sanitizeRemoteReasonerStructuredValue(parsed);
      if (sanitized === undefined) {
        return nextSections;
      }
      nextSection = {
        title: nextSection.title,
        bodyLines: stringifyReasonerJson(sanitized).split(/\r?\n/u),
      };
    }

    const renamedTitle = REMOTE_REASONER_PROMPT_SECTION_RENAMES.get(nextSection.title) ?? nextSection.title;
    if (!REMOTE_REASONER_ALLOWED_PROMPT_SECTIONS.has(renamedTitle)) {
      return nextSections;
    }

    nextSections.push({
      ...nextSection,
      title: renamedTitle,
    });
    return nextSections;
  }, []);
}

function collectPromptSectionTitles(prompt) {
  return new Set(
    parsePromptSections(prompt)
      .map((section) => normalizeOptionalText(section?.title))
      .filter(Boolean)
  );
}

function sanitizeRemoteReasonerCompiledPrompt(
  prompt,
  {
    localKnowledgeHits = [],
    perceptionSnapshot = null,
  } = {}
) {
  return renderPromptSections(
    sanitizeRemoteReasonerCompiledPromptSections(parsePromptSections(prompt), {
      localKnowledgeHits,
      perceptionSnapshot,
    })
  );
}

function buildRemoteReasonerQueryBudgetSummary(queryBudget = null) {
  if (!queryBudget || typeof queryBudget !== "object") {
    return null;
  }

  return {
    redactedForRemoteReasoner: true,
  };
}

function stripRemoteReasonerMemoryStabilityRuntimeReports(memoryHomeostasis = null) {
  if (!memoryHomeostasis || typeof memoryHomeostasis !== "object") {
    return memoryHomeostasis;
  }
  const next = { ...memoryHomeostasis };
  delete next.memoryStabilityPromptPreflight;
  delete next.memoryStabilityPromptPreTransform;
  delete next.memoryStabilityPreview;
  return next;
}

export function buildRemoteReasonerContext(contextBuilder = null) {
  if (!contextBuilder || typeof contextBuilder !== "object") {
    return contextBuilder;
  }

  const sourceSlots = contextBuilder.slots && typeof contextBuilder.slots === "object" ? contextBuilder.slots : null;
  const nextSlots = sourceSlots ? { ...sourceSlots } : null;
  const next = {
    ...contextBuilder,
    ...(nextSlots ? { slots: nextSlots } : {}),
  };
  if (next.memoryHomeostasis && typeof next.memoryHomeostasis === "object") {
    next.memoryHomeostasis = stripRemoteReasonerMemoryStabilityRuntimeReports(next.memoryHomeostasis);
  }
  if (nextSlots?.memoryHomeostasis && typeof nextSlots.memoryHomeostasis === "object") {
    nextSlots.memoryHomeostasis = stripRemoteReasonerMemoryStabilityRuntimeReports(nextSlots.memoryHomeostasis);
  }
  const externalColdMemory =
    contextBuilder.externalColdMemory && typeof contextBuilder.externalColdMemory === "object"
      ? contextBuilder.externalColdMemory
      : null;
  const localKnowledgeHits = Array.isArray(contextBuilder.localKnowledge?.hits)
    ? contextBuilder.localKnowledge.hits
    : Array.isArray(sourceSlots?.localKnowledgeHits)
      ? sourceSlots.localKnowledgeHits
      : [];
  const perceptionSnapshot =
    sourceSlots?.perceptionSnapshot && typeof sourceSlots.perceptionSnapshot === "object"
      ? sourceSlots.perceptionSnapshot
      : null;
  const slotExternalColdMemory =
    sourceSlots?.externalColdMemory && typeof sourceSlots.externalColdMemory === "object"
      ? sourceSlots.externalColdMemory
      : null;

  if (externalColdMemory) {
    next.externalColdMemory = buildRemoteReasonerExternalColdMemorySummary(externalColdMemory);
  }

  if (slotExternalColdMemory && nextSlots) {
    nextSlots.externalColdMemory = buildRemoteReasonerExternalColdMemorySummary(slotExternalColdMemory);
  }

  if (typeof contextBuilder.compiledPrompt === "string") {
    next.compiledPrompt = sanitizeRemoteReasonerCompiledPrompt(contextBuilder.compiledPrompt, {
      localKnowledgeHits,
      perceptionSnapshot,
    });
  }

  if (nextSlots?.queryBudget && typeof nextSlots.queryBudget === "object") {
    nextSlots.queryBudget = {
      ...nextSlots.queryBudget,
      redactedForRemoteReasoner: true,
    };
  }

  return next;
}

function buildRemoteReasonerPayloadContext(contextBuilder = null) {
  if (!contextBuilder || typeof contextBuilder !== "object") {
    return contextBuilder;
  }

  const compactContext = buildLocalCommandContext(contextBuilder) ?? {};
  const compactSlots =
    compactContext.slots && typeof compactContext.slots === "object" ? compactContext.slots : {};
  const sourceSlots =
    contextBuilder.slots && typeof contextBuilder.slots === "object" ? contextBuilder.slots : {};
  const sourceLocalKnowledgeHits = Array.isArray(contextBuilder.localKnowledge?.hits)
    ? contextBuilder.localKnowledge.hits
    : Array.isArray(sourceSlots.localKnowledgeHits)
      ? sourceSlots.localKnowledgeHits
      : [];
  const sourcePerceptionSnapshot =
    sourceSlots.perceptionSnapshot && typeof sourceSlots.perceptionSnapshot === "object"
      ? sourceSlots.perceptionSnapshot
      : null;
  const compactLocalKnowledgeHits = sanitizeRemoteReasonerKnowledgeHits(
    compactContext.localKnowledge?.hits,
    REMOTE_REASONER_MAX_KNOWLEDGE_HITS
  );
  const compactSlotLocalKnowledgeHits = sanitizeRemoteReasonerKnowledgeHits(
    compactContext.slots?.localKnowledgeHits,
    REMOTE_REASONER_MAX_KNOWLEDGE_HITS
  );
  const remoteQueryBudget =
    sourceSlots.queryBudget && typeof sourceSlots.queryBudget === "object" ? sourceSlots.queryBudget : null;
  const remoteTopExternalColdMemory =
    contextBuilder.externalColdMemory && typeof contextBuilder.externalColdMemory === "object"
      ? contextBuilder.externalColdMemory
      : null;
  const remoteSlotExternalColdMemory =
    sourceSlots.externalColdMemory && typeof sourceSlots.externalColdMemory === "object"
      ? sourceSlots.externalColdMemory
      : null;
  const remoteTranscriptModel =
    sourceSlots.transcriptModel && typeof sourceSlots.transcriptModel === "object" ? sourceSlots.transcriptModel : null;
  const remoteCompiledPrompt =
    typeof contextBuilder.compiledPrompt === "string"
      ? sanitizeRemoteReasonerCompiledPrompt(contextBuilder.compiledPrompt, {
          localKnowledgeHits: sourceLocalKnowledgeHits,
          perceptionSnapshot: sourcePerceptionSnapshot,
        })
      : "";
  compactContext.slots = {
    identitySnapshot: buildRemoteReasonerIdentitySnapshot(compactSlots.identitySnapshot),
    currentGoal: null,
    cognitiveLoop: null,
    continuousCognitiveState: buildRemoteReasonerRuntimeGuidance(compactSlots.continuousCognitiveState),
    queryBudget: buildRemoteReasonerQueryBudgetSummary(remoteQueryBudget),
    transcriptModel: buildRemoteReasonerTranscriptSummary(remoteTranscriptModel),
    externalColdMemory: buildRemoteReasonerExternalColdMemorySummary(remoteSlotExternalColdMemory),
    workingMemoryGate: null,
    localKnowledgeHits: compactSlotLocalKnowledgeHits,
    eventGraph: null,
    sourceMonitoring: buildRemoteReasonerSourceMonitoring(compactSlots.sourceMonitoring),
  };
  compactContext.localKnowledge = compactContext.localKnowledge
    ? {
        retrieval: buildRemoteReasonerRetrievalSummary(
          compactContext.localKnowledge?.retrieval,
          compactLocalKnowledgeHits.length
        ),
        hits: compactLocalKnowledgeHits,
      }
    : null;
  compactContext.externalColdMemory = buildRemoteReasonerExternalColdMemorySummary(remoteTopExternalColdMemory);
  compactContext.compiledPrompt = remoteCompiledPrompt;

  return sanitizeRemoteReasonerStructuredValue(compactContext);
}

function buildRemoteReasonerRequestPayload(payload = {}) {
  const next = {
    redactedForRemoteReasoner: true,
  };
  const currentGoal = normalizeOptionalText(payload.currentGoal) ?? null;
  const userTurn = normalizeOptionalText(payload.userTurn ?? payload.input ?? payload.message) ?? null;
  if (currentGoal != null) {
    next.currentGoal = currentGoal;
  }
  if (userTurn != null) {
    next.userTurn = userTurn;
  }
  return next;
}

function buildLocalCommandContext(contextBuilder = null) {
  if (!contextBuilder || typeof contextBuilder !== "object") {
    return null;
  }

  const queryBudget = contextBuilder?.slots?.queryBudget && typeof contextBuilder.slots.queryBudget === "object"
    ? contextBuilder.slots.queryBudget
    : null;
  const sourceMonitoring = contextBuilder?.slots?.sourceMonitoring && typeof contextBuilder.slots.sourceMonitoring === "object"
    ? contextBuilder.slots.sourceMonitoring
    : null;
  const workingMemoryGate = contextBuilder?.slots?.workingMemoryGate && typeof contextBuilder.slots.workingMemoryGate === "object"
    ? contextBuilder.slots.workingMemoryGate
    : null;
  const eventGraph = contextBuilder?.slots?.eventGraph && typeof contextBuilder.slots.eventGraph === "object"
    ? contextBuilder.slots.eventGraph
    : null;
  const continuousCognitiveState =
    contextBuilder?.slots?.continuousCognitiveState &&
    typeof contextBuilder.slots.continuousCognitiveState === "object"
      ? contextBuilder.slots.continuousCognitiveState
      : null;
  const localKnowledgeHits = Array.isArray(contextBuilder?.localKnowledge?.hits)
    ? contextBuilder.localKnowledge.hits.slice(0, 8).map(buildLocalCommandKnowledgeHit)
    : [];
  const externalColdMemoryHits = Array.isArray(contextBuilder?.externalColdMemory?.hits)
    ? contextBuilder.externalColdMemory.hits.slice(0, 6).map(buildLocalCommandKnowledgeHit)
    : [];

  return {
    builtAt: normalizeOptionalText(contextBuilder.builtAt) ?? null,
    agentId: normalizeOptionalText(contextBuilder.agentId) ?? null,
    didMethod: normalizeOptionalText(contextBuilder.didMethod) ?? null,
    contextHash: normalizeOptionalText(contextBuilder.contextHash) ?? null,
    slots: {
      currentGoal: normalizeOptionalText(contextBuilder?.slots?.currentGoal) ?? null,
      identitySnapshot: buildLocalCommandIdentitySnapshot(contextBuilder?.slots?.identitySnapshot),
      cognitiveLoop: Array.isArray(contextBuilder?.slots?.cognitiveLoop?.sequence)
        ? {
            sequence: contextBuilder.slots.cognitiveLoop.sequence.slice(0, 8).map((item) => String(item)),
          }
        : null,
      continuousCognitiveState: buildLocalCommandContinuousCognitiveState(continuousCognitiveState),
      transcriptModel: buildLocalCommandTranscriptModel(contextBuilder?.slots?.transcriptModel),
      workingMemoryGate: buildLocalCommandWorkingMemoryGate(workingMemoryGate),
      eventGraph: buildLocalCommandEventGraph(eventGraph),
      sourceMonitoring: buildLocalCommandSourceMonitoring(sourceMonitoring),
      queryBudget: buildLocalCommandQueryBudget(queryBudget),
      localKnowledgeHits,
    },
    localKnowledge: {
      retrieval: contextBuilder?.localKnowledge?.retrieval && typeof contextBuilder.localKnowledge.retrieval === "object"
        ? {
            strategy: normalizeOptionalText(contextBuilder.localKnowledge.retrieval.strategy) ?? null,
            scorer: normalizeOptionalText(contextBuilder.localKnowledge.retrieval.scorer) ?? null,
            vectorUsed: contextBuilder.localKnowledge.retrieval.vectorUsed ?? null,
            hitCount: Number.isFinite(Number(contextBuilder.localKnowledge.retrieval.hitCount))
              ? Number(contextBuilder.localKnowledge.retrieval.hitCount)
              : localKnowledgeHits.length,
          }
        : {
            hitCount: localKnowledgeHits.length,
          },
      hits: localKnowledgeHits,
    },
    externalColdMemory: contextBuilder?.externalColdMemory
      ? {
          provider: normalizeOptionalText(contextBuilder.externalColdMemory.provider) ?? null,
          enabled: contextBuilder.externalColdMemory.enabled ?? null,
          used: contextBuilder.externalColdMemory.used ?? null,
          candidateOnly: contextBuilder.externalColdMemory.candidateOnly ?? true,
          hitCount: Number.isFinite(Number(contextBuilder.externalColdMemory.hitCount))
            ? Number(contextBuilder.externalColdMemory.hitCount)
            : externalColdMemoryHits.length,
          error: normalizeOptionalText(contextBuilder.externalColdMemory.error) ?? null,
          hits: externalColdMemoryHits,
        }
      : null,
  };
}

function buildReasonerMessages(
  {
    contextBuilder = null,
    payload = {},
    includeReasoningOrder = true,
    goalLabel = "Current Goal",
    inputLabel = "User Turn",
    runtimeHintLabel = "Runtime State Hints",
    contextLabel = "Context Slots",
    genericRemoteTerminology = false,
  } = {}
) {
  const currentGoal = normalizeOptionalText(payload.currentGoal) ?? normalizeOptionalText(contextBuilder?.slots?.currentGoal) ?? null;
  const userTurn = normalizeOptionalText(payload.userTurn || payload.input || payload.message) ?? null;
  const prompt = normalizeOptionalText(contextBuilder?.compiledPrompt) ?? "";
  const promptSectionTitles = prompt ? collectPromptSectionTitles(prompt) : new Set();
  const promptAlreadyIncludesCurrentGoal = promptSectionTitles.has("CURRENT GOAL");
  const promptAlreadyIncludesCognitiveLoop = promptSectionTitles.has("COGNITIVE LOOP");
  const promptAlreadyIncludesContinuousCognitiveState = promptSectionTitles.has("CONTINUOUS COGNITIVE STATE");
  const cognitiveLoop =
    !promptAlreadyIncludesCognitiveLoop &&
    includeReasoningOrder &&
    Array.isArray(contextBuilder?.slots?.cognitiveLoop?.sequence)
    ? contextBuilder.slots.cognitiveLoop.sequence.join(" -> ")
    : null;
  const continuousCognitiveState =
    !promptAlreadyIncludesContinuousCognitiveState && contextBuilder?.slots?.continuousCognitiveState
    ? stringifyReasonerJson(contextBuilder.slots.continuousCognitiveState)
    : null;
  const userContent = [
    currentGoal && !promptAlreadyIncludesCurrentGoal ? `${goalLabel}:\n${currentGoal}` : null,
    userTurn ? `${inputLabel}:\n${userTurn}` : null,
    cognitiveLoop ? `Reasoning Order (Heuristic):\n${cognitiveLoop}` : null,
    continuousCognitiveState ? `${runtimeHintLabel}:\n${continuousCognitiveState}` : null,
    `${contextLabel}:\n${prompt}`,
    genericRemoteTerminology
      ? "请直接继续当前任务，不要寒暄，不要把压缩摘要当成用户新输入，不要虚构未提供的信息。先读观察到的输入，再结合相关上下文、谨慎信号和任务框架回答。证据不足时明确保留不确定语气；没有支撑时不要拼接因果。若存在保守响应提示，优先保守。"
      : "请直接继续当前任务，不要寒暄，不要把压缩摘要当成用户新输入，不要虚构身份字段。先读感知输入，再读 working-memory gate 选中的工作记忆、情节记忆、抽象经验层、event graph 与来源监测，再用身份层收束回答。不要把 inferred / derived memory 说成 confirmed local record；perceived / reported 内容要保留“观察到/被报告”的语气。若 source monitoring 显示 low-reality 或 internal-generation risk 偏高，必须显式保留推断语气。不要把跨句的原因和结论自由拼接成确定因果链，除非 cause 和 effect 都有本地支撑；多跳因果链只有在 event graph 里能走通时才可以说成稳定流程。如果当前处于 self_calibrating 或 recovering 模式，优先保守回答、保持长期偏好一致性，并优先帮助系统恢复上下文。",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      role: "system",
      content: genericRemoteTerminology
        ? "You are the agent-passport runtime reasoning assistant. Use only the provided context. Prefer cautious wording when support is weak or caution cues are present. Do not present inferred or reported content as confirmed fact. State causal links only when the provided support covers both cause and effect. Return one grounded candidate assistant response."
        : "You are the memory stability engine local reasoner serving the agent-passport runtime. The local reference store is the grounding reference for identity and local state. Follow a layered memory loop: perception first, then working-memory gate selected items, then episodic memory, then abstracted memory patterns, then event-graph links, then source monitoring, then identity/ledger constraints. Respect runtime state hints, preserve long-term preferences, and prefer recovery-safe answers when calibration or recovery signals are active. Do not present inferred memories as confirmed local records, avoid upgrading reported observations into confirmed claims, treat low-reality or internally generated supports as hypotheses unless identity or verified evidence closes the gap, and do not assert causal chains unless both cause and effect are grounded in local support. Multi-hop causal claims require a traversable local event graph path. Return one candidate assistant response grounded in the provided context.",
    },
    {
      role: "user",
      content: userContent,
    },
  ];
}

function buildMockReasonerResponse({ contextBuilder = null, payload = {}, provider = "mock" } = {}) {
  const identity = contextBuilder?.slots?.identitySnapshot || {};
  const profile = identity.profile || {};
  const did = normalizeOptionalText(identity.did) ?? null;
  const currentGoal = normalizeOptionalText(contextBuilder?.slots?.currentGoal) ?? null;
  const userTurn = normalizeOptionalText(payload.userTurn || payload.input || payload.message) ?? null;

  const lines = [
    `agent_id: ${identity.agentId || "unknown"}`,
    profile.name ? `名字: ${profile.name}` : null,
    profile.role ? `角色: ${profile.role}` : null,
    did ? `DID: ${did}` : null,
    currentGoal ? `当前目标: ${currentGoal}` : null,
    userTurn ? `用户输入: ${userTurn}` : null,
    "结果: 我会优先以本地参考层的身份快照回答，而不是依赖长聊天历史脑补",
  ].filter(Boolean);

  return {
    provider,
    responseText: lines.join("\n"),
    metadata: {
      model: provider === "local_mock" ? "agent-passport-local-mock-reasoner" : "agent-passport-mock-reasoner",
      generatedFromContextHash: contextBuilder?.contextHash || null,
      strategy: provider === "local_mock" ? "offline-identity-first" : "identity-first",
    },
  };
}

function resolveRemoteReasonerTimeoutMs(payload = {}, providerConfig = {}) {
  return normalizePositiveInteger(
    payload.reasonerTimeoutMs ??
      providerConfig.timeoutMs ??
      process.env.AGENT_PASSPORT_REASONER_TIMEOUT_MS ??
      process.env.AGENT_PASSPORT_LLM_TIMEOUT_MS ??
      DEFAULT_REMOTE_REASONER_TIMEOUT_MS,
    DEFAULT_REMOTE_REASONER_TIMEOUT_MS,
    1000
  );
}

async function fetchReasonerWithTimeout(url, options, { provider, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${provider} reasoner timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function requireNonEmptyReasonerResponse(responseText, provider) {
  const normalized = normalizeOptionalText(responseText);
  if (!normalized) {
    const error = new Error(`${provider} reasoner returned empty response`);
    error.code = "empty_remote_reasoner_response";
    throw error;
  }
  return normalized;
}

async function requestHttpReasoner({ contextBuilder = null, payload = {}, providerConfig = {} } = {}) {
  const remoteContextBuilder = buildRemoteReasonerPayloadContext(contextBuilder);
  const reasonerUrl =
    normalizeOptionalText(payload.reasonerUrl) ??
    normalizeOptionalText(providerConfig.url) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_REASONER_URL) ??
    null;
  if (!reasonerUrl) {
    throw new Error("reasonerUrl is required for http provider");
  }
  const endpoint = assertRemoteReasonerEndpointAllowed(reasonerUrl, {
    provider: "http",
    payload,
    providerConfig,
  });

  const headers = {
    "Content-Type": "application/json",
  };
  const bearerToken =
    normalizeOptionalText(payload.reasonerApiKey) ??
    normalizeOptionalText(providerConfig.apiKey) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_REASONER_API_KEY) ??
    null;
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const timeoutMs = resolveRemoteReasonerTimeoutMs(payload, providerConfig);
  const maxResponseBytes = resolveRemoteReasonerMaxResponseBytes(payload, providerConfig);
  const response = await fetchReasonerWithTimeout(
    endpoint.url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        task: "agent_passport_runner",
        contextBuilder: remoteContextBuilder,
        payload: buildRemoteReasonerRequestPayload(payload),
      }),
    },
    {
      provider: "http",
      timeoutMs,
    }
  );

  if (!response.ok) {
    throw new Error(`http reasoner returned HTTP ${response.status}`);
  }

  const { contentType, bodyText, bodyBytes, parsedJson } = await readRemoteReasonerResponseBody(response, {
    provider: "http",
    maxResponseBytes,
  });
  if (contentType.includes("application/json")) {
    const data = parsedJson ?? {};
    const responseText = requireNonEmptyReasonerResponse(
      normalizeOptionalText(data.responseText) ??
        normalizeOptionalText(data.candidateResponse) ??
        normalizeOptionalText(data.output) ??
        null,
      "http"
    );
    return {
      provider: "http",
      responseText,
      metadata: {
        model: normalizeOptionalText(data.model) ?? normalizeOptionalText(providerConfig.model) ?? "http-reasoner",
        timeoutMs,
        host: endpoint.host,
        remoteBoundary: endpoint.boundary,
        responseBytes: bodyBytes,
        maxResponseBytes,
        raw: buildRemoteReasonerRawPreview(bodyText, {
          contentType,
          bytes: bodyBytes,
        }),
      },
    };
  }

  const text = requireNonEmptyReasonerResponse(bodyText, "http");
  return {
    provider: "http",
    responseText: text,
    metadata: {
      model: normalizeOptionalText(providerConfig.model) ?? "http-reasoner",
      timeoutMs,
      host: endpoint.host,
      remoteBoundary: endpoint.boundary,
      responseBytes: bodyBytes,
      maxResponseBytes,
      raw: buildRemoteReasonerRawPreview(bodyText, {
        contentType,
        bytes: bodyBytes,
      }),
    },
  };
}

function extractOpenAICompatibleText(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const messageContent = choice?.message?.content ?? null;
  if (typeof messageContent === "string") {
    return normalizeOptionalText(messageContent);
  }
  if (Array.isArray(messageContent)) {
    const text = messageContent
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && typeof item.text === "string") {
          return item.text;
        }
        return null;
      })
      .filter(Boolean)
      .join("\n");
    return normalizeOptionalText(text);
  }
  return (
    normalizeOptionalText(data?.output_text) ??
    normalizeOptionalText(data?.responseText) ??
    normalizeOptionalText(data?.output?.[0]?.content?.[0]?.text) ??
    null
  );
}

async function requestOpenAICompatibleReasoner({ contextBuilder = null, payload = {}, providerConfig = {} } = {}) {
  const remoteContextBuilder = buildRemoteReasonerPayloadContext(contextBuilder);
  const baseUrl =
    normalizeOptionalText(payload.reasonerUrl) ??
    normalizeOptionalText(payload.reasonerBaseUrl) ??
    normalizeOptionalText(providerConfig.url) ??
    normalizeOptionalText(providerConfig.baseUrl) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_REASONER_URL) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_LLM_BASE_URL) ??
    null;
  const model =
    normalizeOptionalText(payload.reasonerModel) ??
    normalizeOptionalText(providerConfig.model) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_REASONER_MODEL) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_LLM_MODEL) ??
    null;
  const apiPath =
    normalizeOptionalText(payload.reasonerPath) ??
    normalizeOptionalText(providerConfig.path) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_REASONER_PATH) ??
    "/v1/chat/completions";
  if (!baseUrl) {
    throw new Error("reasonerUrl or AGENT_PASSPORT_LLM_BASE_URL is required for openai_compatible provider");
  }
  if (!model) {
    throw new Error("reasonerModel or AGENT_PASSPORT_LLM_MODEL is required for openai_compatible provider");
  }
  const endpoint = assertRemoteReasonerEndpointAllowed(new URL(apiPath, baseUrl).toString(), {
    provider: "openai_compatible",
    payload,
    providerConfig,
  });

  const headers = {
    "Content-Type": "application/json",
  };
  const apiKey =
    normalizeOptionalText(payload.reasonerApiKey) ??
    normalizeOptionalText(providerConfig.apiKey) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_REASONER_API_KEY) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_LLM_API_KEY) ??
    null;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const timeoutMs = resolveRemoteReasonerTimeoutMs(payload, providerConfig);
  const maxResponseBytes = resolveRemoteReasonerMaxResponseBytes(payload, providerConfig);
  const response = await fetchReasonerWithTimeout(
    endpoint.url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: buildReasonerMessages({
          contextBuilder: remoteContextBuilder,
          payload,
          includeReasoningOrder: false,
          goalLabel: "Goal",
          inputLabel: "Input",
          runtimeHintLabel: "Safety Guidance",
          contextLabel: "Summary",
          genericRemoteTerminology: true,
        }),
      }),
    },
    {
      provider: "openai_compatible",
      timeoutMs,
    }
  );

  if (!response.ok) {
    throw new Error(`openai_compatible reasoner returned HTTP ${response.status}`);
  }

  const { bodyText, bodyBytes, parsedJson } = await readRemoteReasonerResponseBody(response, {
    provider: "openai_compatible",
    maxResponseBytes,
  });
  const data = parsedJson ?? (() => {
    throw new Error("openai_compatible reasoner returned invalid JSON");
  })();
  const responseText = requireNonEmptyReasonerResponse(extractOpenAICompatibleText(data), "openai_compatible");
  return {
    provider: "openai_compatible",
    responseText,
    metadata: {
      model,
      timeoutMs,
      host: endpoint.host,
      remoteBoundary: endpoint.boundary,
      responseBytes: bodyBytes,
      maxResponseBytes,
      raw: buildRemoteReasonerRawPreview(bodyText, {
        contentType: "application/json",
        bytes: bodyBytes,
      }),
    },
  };
}

async function requestOllamaLocalReasoner({ contextBuilder = null, payload = {}, providerConfig = {} } = {}) {
  const baseUrl =
    normalizeOptionalText(payload.localReasonerBaseUrl) ??
    normalizeOptionalText(payload.reasonerBaseUrl) ??
    normalizeOptionalText(payload.reasonerUrl) ??
    normalizeOptionalText(providerConfig.baseUrl) ??
    normalizeOptionalText(providerConfig.url) ??
    normalizeOptionalText(process.env.MEMORY_STABILITY_OLLAMA_BASE_URL) ??
    normalizeOptionalText(process.env.MEMORY_STABILITY_LOCAL_LLM_BASE_URL) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_OLLAMA_BASE_URL) ??
    normalizeOptionalText(process.env.OPENNEED_LOCAL_GEMMA_BASE_URL) ??
    normalizeOptionalText(process.env.OPENNEED_LOCAL_LLM_BASE_URL) ??
    DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL;
  const requestedModel =
    normalizeOptionalText(payload.localReasonerModel) ??
    normalizeOptionalText(payload.reasonerModel) ??
    normalizeOptionalText(providerConfig.model) ??
    normalizeOptionalText(process.env.MEMORY_STABILITY_OLLAMA_MODEL) ??
    normalizeOptionalText(process.env.MEMORY_STABILITY_LOCAL_LLM_MODEL) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_OLLAMA_MODEL) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_LLM_MODEL) ??
    normalizeOptionalText(process.env.OPENNEED_LOCAL_GEMMA_MODEL) ??
    normalizeOptionalText(process.env.OPENNEED_LOCAL_LLM_MODEL) ??
    DEFAULT_DEVICE_LOCAL_REASONER_MODEL;
  const model = resolveMemoryEngineLocalModel(requestedModel);
  const apiPath =
    normalizeOptionalText(payload.localReasonerPath) ??
    normalizeOptionalText(payload.reasonerPath) ??
    normalizeOptionalText(providerConfig.path) ??
    normalizeOptionalText(process.env.MEMORY_STABILITY_OLLAMA_PATH) ??
    normalizeOptionalText(process.env.MEMORY_STABILITY_LOCAL_LLM_PATH) ??
    normalizeOptionalText(process.env.AGENT_PASSPORT_OLLAMA_PATH) ??
    normalizeOptionalText(process.env.OPENNEED_LOCAL_LLM_PATH) ??
    "/api/chat";
  const timeoutMs = normalizePositiveInteger(
    payload.localReasonerTimeoutMs ??
      payload.reasonerTimeoutMs ??
      providerConfig.timeoutMs ??
      process.env.MEMORY_STABILITY_OLLAMA_TIMEOUT_MS ??
      process.env.MEMORY_STABILITY_LOCAL_LLM_TIMEOUT_MS ??
      process.env.AGENT_PASSPORT_OLLAMA_TIMEOUT_MS ??
      process.env.OPENNEED_LOCAL_LLM_TIMEOUT_MS ??
      DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
    DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
    1000
  );
  if (!model) {
    throw new Error("localReasonerModel or MEMORY_STABILITY_OLLAMA_MODEL is required for ollama_local provider");
  }
  const asset = resolveOllamaLocalModelAssetGate(model);
  const endpoint = assertRemoteReasonerEndpointAllowed(new URL(apiPath, baseUrl).toString(), {
    provider: "ollama_local",
    allowedHosts: resolveLocalReasonerAllowedHosts(payload, providerConfig),
  });

  const response = await fetchReasonerWithTimeout(
    endpoint.url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: buildReasonerMessages({ contextBuilder, payload }),
        }),
    },
    {
      provider: "ollama_local",
      timeoutMs,
    }
  );

  if (!response.ok) {
    throw new Error(`ollama_local reasoner returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const responseText = requireNonEmptyReasonerResponse(
    normalizeOptionalText(data?.message?.content) ??
      normalizeOptionalText(data?.response) ??
      extractOpenAICompatibleText(data) ??
      null,
    "ollama_local"
  );
  return {
    provider: "ollama_local",
    responseText,
    metadata: {
      model: displayMemoryEngineLocalReasoner(requestedModel || model),
      baseUrl,
      path: apiPath,
      timeoutMs,
      asset,
      host: endpoint.host,
      remoteBoundary: endpoint.boundary,
      raw: data,
    },
  };
}

async function requestLocalCommandReasoner({ contextBuilder = null, payload = {}, providerConfig = {} } = {}) {
  const command =
    normalizeOptionalText(payload.localReasonerCommand) ??
    normalizeOptionalText(payload.reasonerCommand) ??
    normalizeOptionalText(providerConfig.command) ??
    null;
  if (!command) {
    throw new Error("local reasoner command is required for local_command provider");
  }

  const args = normalizeReasonerArgs(
    payload.localReasonerArgs ?? payload.reasonerArgs ?? providerConfig.args ?? []
  );
  const cwd =
    normalizeOptionalText(payload.localReasonerCwd) ??
    normalizeOptionalText(payload.reasonerCwd) ??
    normalizeOptionalText(providerConfig.cwd) ??
    null;
  const timeoutMs = normalizePositiveInteger(
    payload.localReasonerTimeoutMs ?? payload.reasonerTimeoutMs ?? providerConfig.timeoutMs ?? 8000,
    8000,
    500
  );
  const maxOutputBytes = normalizePositiveInteger(
    payload.localReasonerMaxOutputBytes ?? payload.reasonerMaxOutputBytes ?? providerConfig.maxOutputBytes ?? 8192,
    8192,
    512
  );
  const maxInputBytes = normalizePositiveInteger(
    payload.localReasonerMaxInputBytes ?? payload.reasonerMaxInputBytes ?? providerConfig.maxInputBytes ?? 131072,
    131072,
    4096
  );
  const format =
    normalizeOptionalText(payload.localReasonerFormat) ??
    normalizeOptionalText(payload.reasonerFormat) ??
    normalizeOptionalText(providerConfig.format) ??
    "json_reasoner_v1";
  const model =
    normalizeOptionalText(payload.localReasonerModel) ??
    normalizeOptionalText(payload.reasonerModel) ??
    normalizeOptionalText(providerConfig.model) ??
    "agent-passport-local-command";

  const workerResult = await executeSandboxBroker(
    {
      capability: "reasoner_local_command",
      command,
      args,
      cwd,
      timeoutMs,
      maxOutputBytes,
      maxInputBytes,
      rejectOnInputTruncate: true,
      isolatedEnv: true,
      inputJson: {
        task: "agent_passport_local_reasoner",
        format,
        messages: buildReasonerMessages({ contextBuilder, payload }),
        contextBuilder: buildLocalCommandContext(contextBuilder),
        payload: {
          currentGoal: payload.currentGoal ?? null,
          userTurn: payload.userTurn ?? payload.input ?? payload.message ?? null,
          recentConversationTurns: payload.recentConversationTurns ?? [],
          toolResults: payload.toolResults ?? [],
        },
      },
    },
    { timeoutMs }
  );

  const stdout = normalizeOptionalText(workerResult?.output?.stdout) ?? null;
  const sandboxBroker = workerResult?.broker || null;
  let responseText = null;
  let metadata = {
    model,
    executionBackend: "sandbox_local_command",
    command,
    args,
    cwd,
    format,
    output: workerResult?.output
      ? {
          ...workerResult.output,
          brokerIsolation: sandboxBroker,
        }
      : null,
    sandboxBroker,
  };

  if (format === "json_reasoner_v1" && stdout) {
    const parsed = JSON.parse(stdout);
    responseText =
      normalizeOptionalText(parsed?.responseText) ??
      normalizeOptionalText(parsed?.candidateResponse) ??
      normalizeOptionalText(parsed?.output) ??
      null;
    metadata = {
      ...metadata,
      model: normalizeOptionalText(parsed?.model) ?? model,
      raw: parsed,
    };
  } else {
    responseText = stdout;
  }

  return {
    provider: "local_command",
    responseText,
    metadata,
  };
}

function buildReasonerProviderConfig(payload = {}) {
  return {
    ...(payload.deviceRuntime?.localReasoner && typeof payload.deviceRuntime.localReasoner === "object"
      ? payload.deviceRuntime.localReasoner
      : {}),
    ...(payload.localReasoner && typeof payload.localReasoner === "object" ? payload.localReasoner : {}),
    ...(payload.reasoner && typeof payload.reasoner === "object" ? payload.reasoner : {}),
  };
}

function resolveDefaultReasonerProvider(payload = {}, passthroughCandidate = null) {
  const explicitProvider =
    normalizeReasonerProvider(payload.reasonerProvider) ??
    normalizeReasonerProvider(payload.reasoner?.provider) ??
    null;

  if (explicitProvider) {
    return explicitProvider;
  }

  if (passthroughCandidate) {
    return "passthrough";
  }

  const mergedConfig = buildReasonerProviderConfig(payload);
  return (
    normalizeReasonerProvider(mergedConfig.provider) ??
    DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER
  );
}

export async function generateAgentRunnerCandidateResponse({ contextBuilder = null, payload = {} } = {}) {
  const passthroughCandidate =
    normalizeOptionalText(payload.candidateResponse || payload.responseText || payload.assistantResponse) ??
    null;
  const provider = resolveDefaultReasonerProvider(payload, passthroughCandidate);
  const providerConfig = buildReasonerProviderConfig(payload);

  if (provider === "passthrough") {
    return {
      provider,
      responseText: passthroughCandidate,
      metadata: {
        model: "manual-candidate",
      },
    };
  }

  if (provider === "mock" || provider === "local_mock") {
    return buildMockReasonerResponse({ contextBuilder, payload, provider });
  }

  if (provider === "local_command") {
    return requestLocalCommandReasoner({
      contextBuilder,
      payload,
      providerConfig,
    });
  }

  if (provider === "ollama_local") {
    return requestOllamaLocalReasoner({
      contextBuilder,
      payload,
      providerConfig,
    });
  }

  if (provider === "http") {
    return requestHttpReasoner({
      contextBuilder,
      payload,
      providerConfig: payload.reasoner && typeof payload.reasoner === "object" ? payload.reasoner : {},
    });
  }

  if (provider === "openai_compatible") {
    return requestOpenAICompatibleReasoner({
      contextBuilder,
      payload,
      providerConfig: payload.reasoner && typeof payload.reasoner === "object" ? payload.reasoner : {},
    });
  }

  throw new Error(`Unsupported reasoner provider: ${provider}`);
}

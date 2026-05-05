import { createHash } from "node:crypto";
import {
  cloneJson,
  hashJson,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import { displayAgentPassportLocalReasonerModel } from "./memory-engine-branding.js";
import { normalizeModelProfileRecord } from "./memory-homeostasis.js";
import { normalizeMemoryStabilityCorrectionLevel } from "./memory-stability/action-vocabulary.js";

const DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT = 4000;

function stringifyPromptSection(value) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function estimatePromptTokens(value) {
  const text = stringifyPromptSection(value);
  if (!text) {
    return 0;
  }

  const cjkMatches = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? [];
  const cjkCount = cjkMatches.length;
  const asciiText = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, "");
  const wordMatches = asciiText.match(/[A-Za-z0-9_]+/g) ?? [];
  const wordChars = wordMatches.reduce((sum, item) => sum + item.length, 0);
  const whitespaceChars = (asciiText.match(/\s+/g) ?? []).reduce((sum, item) => sum + item.length, 0);
  const remainderChars = Math.max(0, asciiText.length - wordChars - whitespaceChars);
  return Math.max(1, cjkCount + Math.ceil(wordChars / 4) + Math.ceil(remainderChars / 2));
}

function summarizeMemoryHomeostasisText(value, maxChars = 180) {
  const normalized = normalizeOptionalText(value) ?? null;
  if (!normalized) {
    return null;
  }
  return normalized.length > maxChars ? `${normalized.slice(0, Math.max(0, maxChars - 3))}...` : normalized;
}

const MEMORY_STABILITY_KERNEL_PREVIEW_ENV = "AGENT_PASSPORT_MEMORY_STABILITY_KERNEL_PREVIEW";
const MEMORY_STABILITY_PROMPT_PREFLIGHT_ENV = "AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PREFLIGHT";
const MEMORY_STABILITY_PROMPT_PRETRANSFORM_ENV = "AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PRETRANSFORM";
const MEMORY_STABILITY_EXECUTE_SAFE_ACTIONS_ENV = "AGENT_PASSPORT_MEMORY_STABILITY_EXECUTE_SAFE_ACTIONS";
const MEMORY_STABILITY_RUNTIME_ROOT_ENV = "AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT";
const MEMORY_STABILITY_KERNEL_TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const MEMORY_STABILITY_RUNTIME_GATE_CACHE = new Map();
const MEMORY_STABILITY_PROMPT_PRETRANSFORM_MODE = "memory-stability-prompt-pretransform/v1";
const MEMORY_STABILITY_PROMPT_PRETRANSFORM_SECTION_TITLE = "MEMORY STABILITY REANCHOR";

export function isExplicitMemoryStabilityKernelPreviewFlag(value) {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === "string") {
    return MEMORY_STABILITY_KERNEL_TRUE_VALUES.has(value.trim().toLowerCase());
  }
  return false;
}

export function resolvePayloadOnlyMemoryStabilityExplicitRequest(payload = {}) {
  const safeCorrectionExecutionRequested =
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStabilityExecuteSafeActions) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.executeSafeActions) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.controlledAdapterExecuteSafeActions);
  const kernelPreviewRequested =
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStabilityKernelPreview) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.kernelPreview) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.preview) ||
    safeCorrectionExecutionRequested;
  const promptPreflightRequested =
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStabilityPromptPreflight) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.promptPreflight);
  const promptPreTransformRequested =
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStabilityPromptPreTransform) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.promptPreTransform);

  return {
    kernelPreviewRequested,
    promptPreflightRequested,
    promptPreTransformRequested,
    safeCorrectionExecutionRequested,
    requiresPromptContextGate: promptPreflightRequested || promptPreTransformRequested,
    hasAnyExplicitRequest:
      kernelPreviewRequested ||
      promptPreflightRequested ||
      promptPreTransformRequested ||
      safeCorrectionExecutionRequested,
  };
}

export function resolvePayloadMemoryStabilityFormalExecutionReceipts(payload = {}) {
  if (Object.hasOwn(payload || {}, "memoryStabilityFormalExecutionReceipts")) {
    return payload.memoryStabilityFormalExecutionReceipts;
  }
  if (Object.hasOwn(payload?.memoryStability || {}, "formalExecutionReceipts")) {
    return payload.memoryStability.formalExecutionReceipts;
  }
  return undefined;
}

export function resolvePayloadMemoryStabilityPreviewCreatedAt(payload = {}) {
  return (
    normalizeOptionalText(payload?.memoryStabilityPreviewCreatedAt) ??
    normalizeOptionalText(payload?.memoryStability?.previewCreatedAt) ??
    normalizeOptionalText(payload?.memoryStability?.generatedAt) ??
    normalizeOptionalText(payload?.memoryStability?.preview?.generatedAt) ??
    null
  );
}

export function shouldAttachMemoryStabilityKernelPreview(payload = {}, env = process.env) {
  return (
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStabilityKernelPreview) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.kernelPreview) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.preview) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStabilityExecuteSafeActions) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.executeSafeActions) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.controlledAdapterExecuteSafeActions) ||
    isExplicitMemoryStabilityKernelPreviewFlag(env?.[MEMORY_STABILITY_KERNEL_PREVIEW_ENV]) ||
    isExplicitMemoryStabilityKernelPreviewFlag(env?.[MEMORY_STABILITY_EXECUTE_SAFE_ACTIONS_ENV])
  );
}

export function shouldAttachMemoryStabilityPromptPreflight(payload = {}, env = process.env) {
  return (
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStabilityPromptPreflight) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.promptPreflight) ||
    isExplicitMemoryStabilityKernelPreviewFlag(env?.[MEMORY_STABILITY_PROMPT_PREFLIGHT_ENV])
  );
}

export function shouldApplyMemoryStabilityPromptPreTransform(payload = {}, env = process.env) {
  return (
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStabilityPromptPreTransform) ||
    isExplicitMemoryStabilityKernelPreviewFlag(payload?.memoryStability?.promptPreTransform) ||
    isExplicitMemoryStabilityKernelPreviewFlag(env?.[MEMORY_STABILITY_PROMPT_PRETRANSFORM_ENV])
  );
}

export function shouldPrepareMemoryStabilityPromptPreflight(payload = {}, env = process.env) {
  return (
    shouldAttachMemoryStabilityPromptPreflight(payload, env) ||
    shouldApplyMemoryStabilityPromptPreTransform(payload, env)
  );
}

export async function resolveExplicitMemoryStabilityRunnerGuard({
  contextBuilder = null,
  explicitRequest = null,
  memoryStabilityRuntime = null,
  formalExecutionReceipts = undefined,
  previewCreatedAt = null,
} = {}) {
  const requested =
    explicitRequest && typeof explicitRequest === "object"
      ? explicitRequest
      : resolvePayloadOnlyMemoryStabilityExplicitRequest({});
  if (!requested.hasAnyExplicitRequest) {
    return null;
  }

  const explicitRequestKinds = [
    requested.kernelPreviewRequested ? "kernel_preview" : null,
    requested.promptPreflightRequested ? "prompt_preflight" : null,
    requested.promptPreTransformRequested ? "prompt_pretransform" : null,
    requested.safeCorrectionExecutionRequested ? "safe_correction_execution" : null,
  ].filter(Boolean);

  if (requested.kernelPreviewRequested && memoryStabilityRuntime?.ok !== true) {
    return {
      failClosed: true,
      blockedBy: "memory_stability_runtime_gate",
      code: normalizeOptionalText(memoryStabilityRuntime?.error?.code) ?? "MEMORY_STABILITY_RUNTIME_GATE_BLOCKED",
      stage: normalizeOptionalText(memoryStabilityRuntime?.error?.stage) ?? "runtime_loader",
      message:
        normalizeOptionalText(memoryStabilityRuntime?.error?.message) ??
        "Memory stability runtime gate failed for an explicit runner request.",
      receiptStatus: "failed",
      explicitRequestKinds,
    };
  }

  const promptPreflight =
    contextBuilder?.memoryHomeostasis?.memoryStabilityPromptPreflight ??
    contextBuilder?.slots?.memoryHomeostasis?.memoryStabilityPromptPreflight ??
    null;
  if (
    requested.promptPreflightRequested &&
    (promptPreflight?.ok !== true || normalizeOptionalText(promptPreflight?.status) !== "ready")
  ) {
    return {
      failClosed: true,
      blockedBy: "memory_stability_prompt_preflight",
      code:
        normalizeOptionalText(promptPreflight?.runtimeLoader?.error?.code) ??
        normalizeOptionalText(promptPreflight?.error?.code) ??
        "MEMORY_STABILITY_PROMPT_PREFLIGHT_NOT_READY",
      stage:
        normalizeOptionalText(promptPreflight?.runtimeLoader?.error?.stage) ??
        normalizeOptionalText(promptPreflight?.error?.stage) ??
        "prompt_preflight",
      message:
        normalizeOptionalText(promptPreflight?.error?.message) ??
        normalizeOptionalText(promptPreflight?.runtimeLoader?.error?.message) ??
        "Memory stability prompt preflight did not reach a ready state for an explicit runner request.",
      receiptStatus: normalizeOptionalText(promptPreflight?.status) ?? null,
      explicitRequestKinds,
    };
  }

  const promptPreTransform =
    contextBuilder?.memoryHomeostasis?.memoryStabilityPromptPreTransform ??
    contextBuilder?.slots?.memoryHomeostasis?.memoryStabilityPromptPreTransform ??
    null;
  if (requested.promptPreTransformRequested && promptPreTransform?.ok !== true) {
    return {
      failClosed: true,
      blockedBy: "memory_stability_prompt_pretransform",
      code:
        normalizeOptionalText(promptPreTransform?.runtimeLoader?.error?.code) ??
        normalizeOptionalText(promptPreTransform?.error?.code) ??
        "MEMORY_STABILITY_PROMPT_PRETRANSFORM_NOT_READY",
      stage:
        normalizeOptionalText(promptPreTransform?.runtimeLoader?.error?.stage) ??
        normalizeOptionalText(promptPreTransform?.error?.stage) ??
        "prompt_pretransform",
      message:
        normalizeOptionalText(promptPreTransform?.error?.message) ??
        normalizeOptionalText(promptPreTransform?.runtimeLoader?.error?.message) ??
        "Memory stability prompt pre-transform did not complete for an explicit runner request.",
      receiptStatus: normalizeOptionalText(promptPreTransform?.status) ?? null,
      explicitRequestKinds,
    };
  }

  if (requested.safeCorrectionExecutionRequested) {
    const runtimeState =
      contextBuilder?.memoryHomeostasis?.runtimeState ??
      contextBuilder?.slots?.memoryHomeostasis?.runtimeState ??
      null;
    try {
      const { buildMemoryStabilityKernelPreview } = await import("./memory-stability/internal-kernel.js");
      const preview = await buildMemoryStabilityKernelPreview({
        runtimeState,
        createdAt: normalizeOptionalText(previewCreatedAt) ?? undefined,
        enabled: true,
        executeSafeActions: true,
        formalExecutionReceipts,
      });
      const correctionExecutionStatus =
        normalizeOptionalText(preview?.formalExecutionRequest?.status) ??
        normalizeOptionalText(preview?.boundaries?.correctionExecution) ??
        normalizeOptionalText(preview?.status) ??
        null;
      const formalExecutionConsumeStatus =
        normalizeOptionalText(preview?.formalExecutionConsume?.status) ?? null;
      if (preview?.ok !== true || normalizeOptionalText(preview?.status) !== "ready") {
        return {
          failClosed: true,
          blockedBy: "memory_stability_safe_correction",
          code:
            normalizeOptionalText(preview?.error?.code) ??
            "MEMORY_STABILITY_SAFE_CORRECTION_NOT_READY",
          stage:
            normalizeOptionalText(preview?.error?.stage) ??
            "controlled_adapter",
          message:
            normalizeOptionalText(preview?.error?.message) ??
            "Memory stability safe correction preview did not reach a ready state for an explicit runner request.",
          receiptStatus: formalExecutionConsumeStatus ?? correctionExecutionStatus,
          explicitRequestKinds,
        };
      }
      if (correctionExecutionStatus === "blocked_authoritative_reload") {
        return {
          failClosed: true,
          blockedBy: "memory_stability_formal_execution",
          code: "MEMORY_STABILITY_FORMAL_EXECUTION_REQUIRED",
          stage: "formal_execution",
          message:
            normalizeOptionalText(preview?.formalExecutionConsume?.message) ??
            "Memory stability safe correction reached the authoritative reload boundary and requires formal execution receipts before the runner may continue.",
          receiptStatus: formalExecutionConsumeStatus ?? correctionExecutionStatus,
          explicitRequestKinds,
        };
      }
    } catch (error) {
      return {
        failClosed: true,
        blockedBy: "memory_stability_safe_correction",
        code: error?.code ?? "MEMORY_STABILITY_SAFE_CORRECTION_FAILED",
        stage: error?.stage ?? "controlled_adapter",
        message:
          error instanceof Error
            ? error.message
            : "Memory stability safe correction preview failed for an explicit runner request.",
        receiptStatus: "failed",
        explicitRequestKinds,
      };
    }
  }

  return null;
}

export function stripTrailingPromptSection(prompt = "", sectionTitle = null) {
  const normalizedTitle = normalizeOptionalText(sectionTitle);
  const promptText = typeof prompt === "string" ? prompt : "";
  if (!normalizedTitle || !promptText) {
    return promptText;
  }

  const marker = `\n\n${normalizedTitle}\n`;
  const markerIndex = promptText.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return promptText.slice(0, markerIndex).trimEnd();
  }

  if (promptText === normalizedTitle || promptText.startsWith(`${normalizedTitle}\n`)) {
    return "";
  }

  return promptText;
}

export function listPromptSafeMemoryStabilityLocalAnchors(contextBuilder) {
  return Array.isArray(contextBuilder?.memoryHomeostasis?.anchors) && contextBuilder.memoryHomeostasis.anchors.length > 0
    ? contextBuilder.memoryHomeostasis.anchors
    : Array.isArray(contextBuilder?.slots?.memoryHomeostasis?.anchors)
      ? contextBuilder.slots.memoryHomeostasis.anchors
      : [];
}

export function buildPromptSafeMemoryStabilityAnchorFocus(contextBuilder, promptTransformPlan = null, limit = 3) {
  const sourceAnchors = listPromptSafeMemoryStabilityLocalAnchors(contextBuilder);
  const boundedLimit = Math.max(1, Math.floor(toFiniteNumber(limit, 3)));
  const plannedAnchorFocus = Array.isArray(promptTransformPlan?.anchorFocus)
    ? promptTransformPlan.anchorFocus
    : [];
  if (promptTransformPlan && typeof promptTransformPlan === "object" && plannedAnchorFocus.length === 0) {
    return [];
  }
  if (plannedAnchorFocus.length > 0) {
    const anchorByMemoryId = new Map(
      sourceAnchors
        .map((anchor) => ({
          memoryId: normalizeOptionalText(anchor?.memoryId) ?? null,
          source: normalizeOptionalText(anchor?.source) ?? null,
          insertedPosition: normalizeOptionalText(anchor?.insertedPosition) ?? null,
          importanceWeight: toFiniteNumber(anchor?.importanceWeight, null),
          content: summarizeMemoryHomeostasisText(anchor?.content, 96),
        }))
        .filter((anchor) => anchor.memoryId)
        .map((anchor) => [anchor.memoryId, anchor])
    );

    return plannedAnchorFocus
      .slice(0, boundedLimit)
      .map((anchor) => {
        const memoryId = normalizeOptionalText(anchor?.memoryId) ?? null;
        const localAnchor = memoryId ? anchorByMemoryId.get(memoryId) ?? null : null;
        const content = localAnchor?.content ?? null;
        if (!content) {
          return null;
        }
        return {
          source: normalizeOptionalText(anchor?.source) ?? localAnchor?.source ?? null,
          insertedPosition:
            normalizeOptionalText(anchor?.insertedPosition) ?? localAnchor?.insertedPosition ?? null,
          importanceWeight: toFiniteNumber(anchor?.importanceWeight, localAnchor?.importanceWeight ?? null),
          content,
        };
      })
      .filter(Boolean);
  }

  return sourceAnchors
    .map((anchor) => {
      const content = summarizeMemoryHomeostasisText(anchor?.content, 96);
      if (!content) {
        return null;
      }
      return {
        source: normalizeOptionalText(anchor?.source) ?? null,
        insertedPosition: normalizeOptionalText(anchor?.insertedPosition) ?? null,
        importanceWeight: toFiniteNumber(anchor?.importanceWeight, null),
        content,
      };
    })
    .filter(Boolean)
    .slice(0, boundedLimit);
}

export function validateMemoryStabilityPromptTransformPlan(promptTransformPlan = null) {
  if (!promptTransformPlan || typeof promptTransformPlan !== "object") {
    return {
      ok: false,
      reason: "prompt_transform_plan_missing",
    };
  }
  if (normalizeOptionalText(promptTransformPlan?.mode) !== "prompt_local_reanchor") {
    return {
      ok: false,
      reason: "prompt_transform_plan_mode_invalid",
    };
  }
  if (promptTransformPlan?.promptSafe !== true) {
    return {
      ok: false,
      reason: "prompt_transform_plan_not_prompt_safe",
    };
  }
  if (!Array.isArray(promptTransformPlan?.promptActions)) {
    return {
      ok: false,
      reason: "prompt_transform_plan_actions_missing",
    };
  }
  if (!promptTransformPlan?.boundaries || typeof promptTransformPlan.boundaries !== "object") {
    return {
      ok: false,
      reason: "prompt_transform_plan_boundaries_missing",
    };
  }
  if (promptTransformPlan.boundaries.correctionExecutionAllowed !== false) {
    return {
      ok: false,
      reason: "prompt_transform_plan_correction_execution_boundary_invalid",
    };
  }
  if (promptTransformPlan.boundaries.authoritativeReloadAllowed !== false) {
    return {
      ok: false,
      reason: "prompt_transform_plan_authoritative_reload_boundary_invalid",
    };
  }
  if (promptTransformPlan.boundaries.runtimeConflictResolutionAllowed !== false) {
    return {
      ok: false,
      reason: "prompt_transform_plan_runtime_conflict_boundary_invalid",
    };
  }
  return {
    ok: true,
  };
}

export function buildMemoryStabilityPromptPreTransformSection(contextBuilder, preflight = null) {
  if (!preflight || typeof preflight !== "object" || preflight.ok !== true || preflight.status !== "ready") {
    return null;
  }

  const promptTransformPlan =
    preflight?.promptTransformPlan && typeof preflight.promptTransformPlan === "object"
      ? preflight.promptTransformPlan
      : null;
  const planValidation = validateMemoryStabilityPromptTransformPlan(promptTransformPlan);
  const snapshot = preflight?.snapshot && typeof preflight.snapshot === "object" ? preflight.snapshot : null;
  const runtimeState = snapshot?.runtime_state && typeof snapshot.runtime_state === "object" ? snapshot.runtime_state : null;
  const correctionLevel = normalizeMemoryStabilityCorrectionLevel(promptTransformPlan?.correctionLevel, "none");
  const promptActions = normalizeTextList(promptTransformPlan?.promptActions);
  const placementActions = normalizeTextList(promptTransformPlan?.placementStrategy?.actions);
  const modelHint = normalizeOptionalText(promptTransformPlan?.placementStrategy?.modelHint) ?? null;
  const promptMutationAllowed = preflight?.decision?.promptMutationAllowed === true;
  if (!planValidation.ok) {
    return {
      correctionLevel,
      promptActions,
      placementActions,
      anchorCount: 0,
      blockedReason: planValidation.reason,
      body: null,
    };
  }
  if (promptMutationAllowed && promptActions.length === 0) {
    return {
      correctionLevel,
      promptActions,
      placementActions,
      anchorCount: 0,
      blockedReason: "prompt_transform_plan_actions_empty",
      body: null,
    };
  }
  if (!promptMutationAllowed) {
    return null;
  }
  const anchorFocus = buildPromptSafeMemoryStabilityAnchorFocus(
    contextBuilder,
    promptTransformPlan,
    Array.isArray(promptTransformPlan?.anchorFocus) ? promptTransformPlan.anchorFocus.length : 0
  );

  const promptLocalGuidance = {
    mode: normalizeOptionalText(promptTransformPlan?.mode) ?? "prompt_local_reanchor",
    correctionLevel,
    boundaries: {
      correctionExecutionAllowed: false,
      authoritativeReloadAllowed: false,
      runtimeConflictResolutionAllowed: false,
      sourceContentPolicy: "prompt_safe_local_summary_only",
    },
  };

  if (runtimeState) {
    promptLocalGuidance.runtimeSignal = {
      cT: toFiniteNumber(runtimeState.c_t, null),
      sT: toFiniteNumber(runtimeState.s_t, null),
      checkedMemories:
        Number.isFinite(Number(runtimeState.checked_memories)) && Number(runtimeState.checked_memories) >= 0
          ? Math.floor(Number(runtimeState.checked_memories))
          : null,
      conflictMemories:
        Number.isFinite(Number(runtimeState.conflict_memories)) && Number(runtimeState.conflict_memories) >= 0
          ? Math.floor(Number(runtimeState.conflict_memories))
          : null,
    };
  }
  if (promptActions.length > 0) {
    promptLocalGuidance.promptActions = promptActions;
  }
  if (modelHint || placementActions.length > 0) {
    promptLocalGuidance.placementStrategy = {
      modelHint,
      actions: placementActions,
      maxInjectedEstimatedTokens:
        Number.isFinite(Number(promptTransformPlan?.placementStrategy?.maxInjectedEstimatedTokens)) &&
        Number(promptTransformPlan.placementStrategy.maxInjectedEstimatedTokens) > 0
          ? Math.floor(Number(promptTransformPlan.placementStrategy.maxInjectedEstimatedTokens))
          : null,
    };
  }
  if (anchorFocus.length > 0) {
    promptLocalGuidance.anchorFocus = anchorFocus;
  }

  return {
    correctionLevel,
    promptActions,
    placementActions,
    anchorCount: anchorFocus.length,
    body: JSON.stringify(promptLocalGuidance, null, 2),
  };
}

export function buildMemoryStabilityPromptPreTransformEffects({ promptMutated = false } = {}) {
  return {
    modelCalled: false,
    networkCalled: false,
    ledgerWritten: false,
    storeWritten: false,
    promptMutated: Boolean(promptMutated),
    correctionExecuted: false,
  };
}

export function buildMemoryStabilityPromptPreTransformReceipt(
  {
    ok = false,
    status = "failed",
    correctionLevel = null,
    promptActions = [],
    placementActions = [],
    promptMutated = false,
    promptBefore = "",
    promptAfter = "",
    estimatedContextTokensBefore = null,
    estimatedContextTokensAfter = null,
    maxContextTokens = null,
    sectionEstimatedTokens = null,
    runtimeLoader = null,
    reason = null,
    error = null,
  } = {},
  { generatedAt = null } = {}
) {
  const normalizedReason = normalizeOptionalText(reason) ?? null;
  return {
    ok: ok === true,
    enabled: true,
    status: normalizeOptionalText(status) ?? "failed",
    mode: MEMORY_STABILITY_PROMPT_PRETRANSFORM_MODE,
    failClosed: true,
    generatedAt: generatedAt || now(),
    sectionTitle: MEMORY_STABILITY_PROMPT_PRETRANSFORM_SECTION_TITLE,
    correctionLevel: normalizeOptionalText(correctionLevel) ?? null,
    promptActions: normalizeTextList(promptActions),
    placementActions: normalizeTextList(placementActions),
    reason: normalizedReason,
    prompt: {
      beforeChars: typeof promptBefore === "string" ? promptBefore.length : 0,
      afterChars: typeof promptAfter === "string" ? promptAfter.length : 0,
      estimatedContextTokensBefore:
        Number.isFinite(Number(estimatedContextTokensBefore)) && Number(estimatedContextTokensBefore) >= 0
          ? Math.floor(Number(estimatedContextTokensBefore))
          : null,
      estimatedContextTokensAfter:
        Number.isFinite(Number(estimatedContextTokensAfter)) && Number(estimatedContextTokensAfter) >= 0
          ? Math.floor(Number(estimatedContextTokensAfter))
          : null,
      maxContextTokens:
        Number.isFinite(Number(maxContextTokens)) && Number(maxContextTokens) >= 0
          ? Math.floor(Number(maxContextTokens))
          : null,
      sectionEstimatedTokens:
        Number.isFinite(Number(sectionEstimatedTokens)) && Number(sectionEstimatedTokens) >= 0
          ? Math.floor(Number(sectionEstimatedTokens))
          : null,
    },
    boundaries: {
      correctionExecution: "blocked",
      rawContentPolicy: "prompt_safe_local_summary_only",
      promptMutation: Boolean(promptMutated),
      ledgerMutation: false,
    },
    effects: buildMemoryStabilityPromptPreTransformEffects({ promptMutated }),
    runtimeLoader: summarizeMemoryStabilityRuntimeGate(runtimeLoader),
    error:
      error && typeof error === "object"
        ? {
            name: error instanceof Error ? error.name : error.name ?? "Error",
            message: error instanceof Error ? error.message : error.message ?? String(error),
            code: error?.code ?? null,
            stage: error?.stage ?? null,
          }
        : null,
  };
}

export function attachMemoryStabilityPromptPreTransformReceipt(contextBuilder, receipt = null) {
  if (!contextBuilder || typeof contextBuilder !== "object" || !receipt || typeof receipt !== "object") {
    return contextBuilder;
  }
  if (!contextBuilder.memoryHomeostasis || typeof contextBuilder.memoryHomeostasis !== "object") {
    contextBuilder.memoryHomeostasis = {};
  }
  if (!contextBuilder.slots || typeof contextBuilder.slots !== "object") {
    contextBuilder.slots = {};
  }
  if (!contextBuilder.slots.memoryHomeostasis || typeof contextBuilder.slots.memoryHomeostasis !== "object") {
    contextBuilder.slots.memoryHomeostasis = {};
  }
  contextBuilder.memoryHomeostasis.memoryStabilityPromptPreTransform = receipt;
  contextBuilder.slots.memoryHomeostasis.memoryStabilityPromptPreTransform = receipt;
  return contextBuilder;
}

export function applyControlledMemoryStabilityPromptPreTransform(contextBuilder, payload = {}, env = process.env) {
  if (!contextBuilder || typeof contextBuilder !== "object") {
    return contextBuilder;
  }
  if (!shouldApplyMemoryStabilityPromptPreTransform(payload, env)) {
    return contextBuilder;
  }

  const preflight =
    contextBuilder?.memoryHomeostasis?.memoryStabilityPromptPreflight ??
    contextBuilder?.slots?.memoryHomeostasis?.memoryStabilityPromptPreflight ??
    null;
  const promptBefore = typeof contextBuilder.compiledPrompt === "string" ? contextBuilder.compiledPrompt : "";
  const estimatedContextTokensBefore =
    contextBuilder?.slots?.queryBudget?.estimatedContextTokens ??
    estimatePromptTokens(promptBefore);
  const runtimeLoader = preflight?.runtimeLoader ?? null;
  if (!preflight || typeof preflight !== "object" || preflight.ok !== true || preflight.status !== "ready") {
    return attachMemoryStabilityPromptPreTransformReceipt(
      contextBuilder,
      buildMemoryStabilityPromptPreTransformReceipt(
        {
          ok: false,
          status: "blocked_preflight",
          promptMutated: false,
          promptBefore,
          promptAfter: promptBefore,
          estimatedContextTokensBefore,
          estimatedContextTokensAfter: estimatedContextTokensBefore,
          maxContextTokens: contextBuilder?.slots?.queryBudget?.maxContextTokens ?? null,
          runtimeLoader,
          reason: "prompt_preflight_not_ready",
          error: preflight?.error ?? null,
        },
        { generatedAt: preflight?.generatedAt ?? now() }
      )
    );
  }
  const promptSection = buildMemoryStabilityPromptPreTransformSection(contextBuilder, preflight);
  if (!promptSection?.body) {
    return attachMemoryStabilityPromptPreTransformReceipt(
      contextBuilder,
      buildMemoryStabilityPromptPreTransformReceipt(
        {
          ok: true,
          status: "skipped_noop",
          correctionLevel: promptSection?.correctionLevel ?? preflight?.decision?.correctionLevel ?? null,
          promptActions: promptSection?.promptActions ?? [],
          placementActions: promptSection?.placementActions ?? [],
          promptMutated: false,
          promptBefore,
          promptAfter: promptBefore,
          estimatedContextTokensBefore,
          estimatedContextTokensAfter: estimatedContextTokensBefore,
          maxContextTokens: contextBuilder?.slots?.queryBudget?.maxContextTokens ?? null,
          runtimeLoader,
          reason: "no_prompt_safe_reanchor_required",
        },
        { generatedAt: preflight?.generatedAt ?? now() }
      )
    );
  }

  const strippedPrompt = stripTrailingPromptSection(
    contextBuilder.compiledPrompt,
    MEMORY_STABILITY_PROMPT_PRETRANSFORM_SECTION_TITLE
  );
  const nextCompiledPrompt = normalizeOptionalText(strippedPrompt)
    ? `${strippedPrompt.trimEnd()}\n\n${MEMORY_STABILITY_PROMPT_PRETRANSFORM_SECTION_TITLE}\n${promptSection.body}`
    : `${MEMORY_STABILITY_PROMPT_PRETRANSFORM_SECTION_TITLE}\n${promptSection.body}`;
  const sectionEstimatedTokens = estimatePromptTokens(
    `${MEMORY_STABILITY_PROMPT_PRETRANSFORM_SECTION_TITLE}\n${promptSection.body}`
  );
  const nextEstimatedContextTokens = estimatePromptTokens(nextCompiledPrompt);
  const maxContextTokens = Math.max(
    256,
    Math.floor(
      toFiniteNumber(
        contextBuilder?.runtimePolicy?.maxContextTokens ??
          contextBuilder?.slots?.queryBudget?.maxContextTokens,
        DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT
      )
    )
  );
  if (nextEstimatedContextTokens > maxContextTokens) {
    return attachMemoryStabilityPromptPreTransformReceipt(
      contextBuilder,
      buildMemoryStabilityPromptPreTransformReceipt(
        {
          ok: false,
          status: "blocked_budget",
          correctionLevel: promptSection.correctionLevel,
          promptActions: promptSection.promptActions,
          placementActions: promptSection.placementActions,
          promptMutated: false,
          promptBefore,
          promptAfter: promptBefore,
          estimatedContextTokensBefore,
          estimatedContextTokensAfter: estimatedContextTokensBefore,
          maxContextTokens,
          sectionEstimatedTokens,
          runtimeLoader,
          reason: "prompt_transform_exceeds_budget",
        },
        { generatedAt: preflight?.generatedAt ?? now() }
      )
    );
  }

  contextBuilder.compiledPrompt = nextCompiledPrompt;
  if (!contextBuilder.slots || typeof contextBuilder.slots !== "object") {
    contextBuilder.slots = {};
  }
  if (!contextBuilder.slots.queryBudget || typeof contextBuilder.slots.queryBudget !== "object") {
    contextBuilder.slots.queryBudget = {};
  }
  const nextSectionEstimate = {
    title: MEMORY_STABILITY_PROMPT_PRETRANSFORM_SECTION_TITLE,
    estimatedTokens: sectionEstimatedTokens,
  };
  const currentSectionEstimates = Array.isArray(contextBuilder.slots.queryBudget.sectionEstimates)
    ? contextBuilder.slots.queryBudget.sectionEstimates
    : [];
  contextBuilder.slots.queryBudget.sectionEstimates = [
    ...currentSectionEstimates.filter(
      (section) =>
        normalizeOptionalText(section?.title) !== MEMORY_STABILITY_PROMPT_PRETRANSFORM_SECTION_TITLE
    ),
    nextSectionEstimate,
  ];
  contextBuilder.slots.queryBudget.estimatedContextTokens = nextEstimatedContextTokens;
  contextBuilder.contextHash = hashJson({
    baseContextHash: normalizeOptionalText(contextBuilder.contextHash) ?? null,
    memoryStabilityPromptPreTransform: {
      title: MEMORY_STABILITY_PROMPT_PRETRANSFORM_SECTION_TITLE,
      compiledPromptSha256: createHash("sha256").update(nextCompiledPrompt).digest("hex"),
      correctionLevel: promptSection.correctionLevel,
      promptActions: promptSection.promptActions,
      placementActions: promptSection.placementActions,
      anchorCount: promptSection.anchorCount,
      estimatedContextTokens: nextEstimatedContextTokens,
    },
  });
  return attachMemoryStabilityPromptPreTransformReceipt(
    contextBuilder,
    buildMemoryStabilityPromptPreTransformReceipt(
      {
        ok: true,
        status: "applied",
        correctionLevel: promptSection.correctionLevel,
        promptActions: promptSection.promptActions,
        placementActions: promptSection.placementActions,
        promptMutated: true,
        promptBefore,
        promptAfter: nextCompiledPrompt,
        estimatedContextTokensBefore,
        estimatedContextTokensAfter: nextEstimatedContextTokens,
        maxContextTokens,
        sectionEstimatedTokens,
        runtimeLoader,
        reason: "prompt_safe_reanchor_applied",
      },
      { generatedAt: preflight?.generatedAt ?? now() }
    )
  );
}

export function summarizeMemoryStabilityRuntimeGate(runtime = null) {
  if (!runtime || typeof runtime !== "object") {
    return null;
  }
  return {
    ok: runtime.ok === true,
    failClosed: runtime.failClosed !== false,
    mode: normalizeOptionalText(runtime.mode) ?? "memory-stability-runtime-loader/v1",
    loadedAt: normalizeOptionalText(runtime.loadedAt) ?? null,
    gates:
      runtime.gates && typeof runtime.gates === "object"
        ? {
            actionVocabulary: runtime.gates.actionVocabulary === true,
            contract: runtime.gates.contract === true,
            adapterContract: runtime.gates.adapterContract ?? null,
            selfLearningGovernance: runtime.gates.selfLearningGovernance ?? null,
          }
        : null,
    error:
      runtime.error && typeof runtime.error === "object"
        ? {
            code: runtime.error.code ?? null,
            stage: runtime.error.stage ?? null,
            message: runtime.error.message ?? null,
          }
        : null,
  };
}

export async function loadMemoryStabilityRuntimeGateRaw(env = process.env) {
  const configuredRoot = normalizeOptionalText(env?.[MEMORY_STABILITY_RUNTIME_ROOT_ENV]) ?? "__default__";
  let cachedRuntime = MEMORY_STABILITY_RUNTIME_GATE_CACHE.get(configuredRoot);
  if (!cachedRuntime) {
    const gatePromise = (async () => {
      const { tryLoadVerifiedMemoryStabilityRuntime } = await import("./memory-stability/runtime-loader.js");
      return tryLoadVerifiedMemoryStabilityRuntime({
        rootDir: configuredRoot === "__default__" ? undefined : configuredRoot,
      });
    })();
    cachedRuntime = gatePromise.then(
      (runtime) => {
        // Fail-closed loads should retry after the underlying contract tree is repaired.
        if (runtime?.ok !== true && MEMORY_STABILITY_RUNTIME_GATE_CACHE.get(configuredRoot) === cachedRuntime) {
          MEMORY_STABILITY_RUNTIME_GATE_CACHE.delete(configuredRoot);
        }
        return runtime;
      },
      (error) => {
        if (MEMORY_STABILITY_RUNTIME_GATE_CACHE.get(configuredRoot) === cachedRuntime) {
          MEMORY_STABILITY_RUNTIME_GATE_CACHE.delete(configuredRoot);
        }
        throw error;
      }
    );
    MEMORY_STABILITY_RUNTIME_GATE_CACHE.set(configuredRoot, cachedRuntime);
  }
  return cloneJson(await cachedRuntime) ?? null;
}

export async function loadMemoryStabilityRuntimeGate(env = process.env) {
  const runtime = await loadMemoryStabilityRuntimeGateRaw(env);
  return summarizeMemoryStabilityRuntimeGate(runtime);
}

export function resolveMemoryStabilityRuntimeContractModelProfile(runtime = null, modelName = null) {
  const requestedModelName = normalizeOptionalText(modelName) ?? null;
  if (!requestedModelName || runtime?.ok !== true || !runtime?.profile || typeof runtime.profile !== "object") {
    return null;
  }
  const requestedDisplayedModelName = displayAgentPassportLocalReasonerModel(
    requestedModelName,
    requestedModelName
  );
  const profiles = Array.isArray(runtime.profile.model_profiles) ? runtime.profile.model_profiles : [];
  const contractProfile = profiles.find((candidate) => {
    const candidateModelName = normalizeOptionalText(candidate?.model_name) ?? null;
    if (!candidateModelName) {
      return false;
    }
    return (
      candidateModelName.toLowerCase() === requestedModelName.toLowerCase() ||
      displayAgentPassportLocalReasonerModel(candidateModelName, candidateModelName) === requestedDisplayedModelName
    );
  });
  if (!contractProfile) {
    return null;
  }
  return normalizeModelProfileRecord({
    modelName: requestedModelName,
    ccrs: contractProfile.ccrs,
    ecl085: contractProfile.ecl_085 ?? contractProfile.ecl085,
    pr: contractProfile.pr,
    midDrop: contractProfile.mid_drop ?? contractProfile.midDrop,
    createdAt:
      normalizeOptionalText(contractProfile.created_at || contractProfile.createdAt) ??
      normalizeOptionalText(runtime.profile.created_at || runtime.profile.createdAt) ??
      null,
    benchmarkMeta:
      contractProfile.benchmark_meta && typeof contractProfile.benchmark_meta === "object"
        ? {
            ...cloneJson(contractProfile.benchmark_meta),
            source:
              normalizeOptionalText(contractProfile.benchmark_meta.source) ??
              "memory_stability_runtime_contract",
            contractBacked: true,
            contractModelName: normalizeOptionalText(contractProfile.model_name) ?? requestedModelName,
          }
        : {
            source: "memory_stability_runtime_contract",
            contractBacked: true,
            contractModelName: normalizeOptionalText(contractProfile.model_name) ?? requestedModelName,
          },
  });
}

export function buildMemoryStabilityKernelAttachmentFailure(
  error,
  { runId = null, generatedAt = null, runtimeLoader = null } = {}
) {
  return {
    ok: false,
    enabled: true,
    status: "failed",
    mode: "memory-stability-internal-kernel-preview/v1",
    failClosed: true,
    generatedAt: generatedAt || now(),
    runId,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      code: error?.code ?? null,
      stage: error?.stage ?? null,
    },
    boundaries: {
      correctionExecution: "blocked",
      rawContentPolicy: "hash_only",
      promptMutation: false,
      ledgerMutation: false,
    },
    effects: {
      modelCalled: false,
      networkCalled: false,
      ledgerWritten: false,
      storeWritten: false,
      promptMutated: false,
      correctionExecuted: false,
    },
    runtimeLoader: summarizeMemoryStabilityRuntimeGate(runtimeLoader),
  };
}

export function buildMemoryStabilityPromptPreflightAttachmentFailure(
  error,
  { runId = null, generatedAt = null, runtimeLoader = null } = {}
) {
  return {
    ok: false,
    enabled: true,
    status: "failed",
    mode: "memory-stability-prompt-preflight/v1",
    failClosed: true,
    generatedAt: generatedAt || now(),
    runId,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      code: error?.code ?? null,
      stage: error?.stage ?? null,
    },
    boundaries: {
      correctionExecution: "blocked",
      rawContentPolicy: "hash_only",
      promptMutation: false,
      ledgerMutation: false,
    },
    effects: {
      modelCalled: false,
      networkCalled: false,
      ledgerWritten: false,
      storeWritten: false,
      promptMutated: false,
      correctionExecuted: false,
    },
    runtimeLoader: summarizeMemoryStabilityRuntimeGate(runtimeLoader),
  };
}

export async function attachMemoryStabilityPromptPreflight(contextBuilder, payload = {}, {
  provider = null,
  runId = null,
  generatedAt = null,
} = {}) {
  if (!contextBuilder || typeof contextBuilder !== "object") {
    return contextBuilder;
  }
  if (!shouldAttachMemoryStabilityPromptPreflight(payload)) {
    return contextBuilder;
  }
  const createdAt = generatedAt || now();
  let preflight = null;
  let runtimeLoader = null;
  try {
    runtimeLoader = await loadMemoryStabilityRuntimeGate(process.env);
    if (runtimeLoader?.ok !== true) {
      throw Object.assign(new Error(runtimeLoader?.error?.message || "Memory stability runtime gate failed"), {
        code: runtimeLoader?.error?.code ?? "MEMORY_STABILITY_RUNTIME_GATE_BLOCKED",
        stage: runtimeLoader?.error?.stage ?? "runtime_loader",
      });
    }
    const {
      buildMemoryStabilityPromptPreflight,
      isMemoryStabilityPromptPreflightEnabled,
    } = await import("./memory-stability/internal-kernel.js");
    preflight = await buildMemoryStabilityPromptPreflight({
      runtimeState: contextBuilder?.memoryHomeostasis?.runtimeState ?? null,
      provider,
      createdAt,
      runId,
      enabled: isMemoryStabilityPromptPreflightEnabled(payload, process.env),
    });
    if (preflight && typeof preflight === "object") {
      preflight.runtimeLoader = runtimeLoader;
    }
  } catch (error) {
    preflight = buildMemoryStabilityPromptPreflightAttachmentFailure(error, {
      runId,
      generatedAt: createdAt,
      runtimeLoader,
    });
  }
  if (!contextBuilder.memoryHomeostasis || typeof contextBuilder.memoryHomeostasis !== "object") {
    contextBuilder.memoryHomeostasis = {};
  }
  contextBuilder.memoryHomeostasis.memoryStabilityPromptPreflight = preflight;
  if (!contextBuilder.slots || typeof contextBuilder.slots !== "object") {
    contextBuilder.slots = {};
  }
  if (!contextBuilder.slots.memoryHomeostasis || typeof contextBuilder.slots.memoryHomeostasis !== "object") {
    contextBuilder.slots.memoryHomeostasis = {};
  }
  contextBuilder.slots.memoryHomeostasis.memoryStabilityPromptPreflight = preflight;
  return contextBuilder;
}

export async function prepareMemoryStabilityPromptContext(contextBuilder, payload = {}, options = {}) {
  if (!contextBuilder || typeof contextBuilder !== "object") {
    return contextBuilder;
  }
  const preparedPayload = shouldPrepareMemoryStabilityPromptPreflight(payload)
    ? {
        ...payload,
        memoryStabilityPromptPreflight: true,
      }
    : payload;
  const contextWithPreflight = await attachMemoryStabilityPromptPreflight(
    contextBuilder,
    preparedPayload,
    options
  );
  return applyControlledMemoryStabilityPromptPreTransform(contextWithPreflight, payload);
}

export async function attachMemoryStabilityKernelPreview({
  payload = {},
  runtimeState = null,
  provider = null,
  runId = null,
  generatedAt = null,
  formalExecutionReceipts = undefined,
  env = process.env,
} = {}) {
  const createdAt = generatedAt || now();
  let preview = null;
  let runtimeLoader = null;
  try {
    runtimeLoader = await loadMemoryStabilityRuntimeGate(env);
    if (runtimeLoader?.ok !== true) {
      throw Object.assign(
        new Error(runtimeLoader?.error?.message || "Memory stability runtime gate failed"),
        {
          code: runtimeLoader?.error?.code ?? "MEMORY_STABILITY_RUNTIME_GATE_BLOCKED",
          stage: runtimeLoader?.error?.stage ?? "runtime_loader",
        }
      );
    }
    const {
      buildMemoryStabilityKernelPreview,
      isMemoryStabilitySafeCorrectionExecutionEnabled,
    } = await import("./memory-stability/internal-kernel.js");
    preview = await buildMemoryStabilityKernelPreview({
      runtimeState,
      provider,
      createdAt,
      runId,
      enabled: true,
      includeCorrectionEventPreview: isExplicitMemoryStabilityKernelPreviewFlag(
        payload?.memoryStability?.includeCorrectionEventPreview
      ),
      executeSafeActions: isMemoryStabilitySafeCorrectionExecutionEnabled(payload, env),
      formalExecutionReceipts,
    });
    if (preview && typeof preview === "object") {
      preview.runtimeLoader = runtimeLoader;
    }
  } catch (error) {
    preview = buildMemoryStabilityKernelAttachmentFailure(error, {
      runId,
      generatedAt: createdAt,
      runtimeLoader,
    });
  }

  return { preview, runtimeLoader };
}

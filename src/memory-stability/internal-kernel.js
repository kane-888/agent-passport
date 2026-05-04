import { validateMemoryStabilityCorrectionEvent } from "./adapter-contract.js";
import { filterMemoryStabilityPromptLayoutActions, normalizeMemoryStabilityCorrectionLevel } from "./action-vocabulary.js";
import { executeMemoryStabilityControlledAdapter } from "./controlled-adapter.js";
import { buildMemoryStabilityFormalExecutionRequest } from "./execution-receipts.js";
import { consumeMemoryStabilityFormalExecutionReceipts } from "./formal-execution-consume.js";
import { buildStagedMemoryStabilitySnapshot } from "./staged-adapter.js";

export const MEMORY_STABILITY_KERNEL_PREVIEW_ENV = "AGENT_PASSPORT_MEMORY_STABILITY_KERNEL_PREVIEW";
export const MEMORY_STABILITY_PROMPT_PREFLIGHT_ENV = "AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PREFLIGHT";
export const MEMORY_STABILITY_SAFE_EXECUTION_ENV = "AGENT_PASSPORT_MEMORY_STABILITY_EXECUTE_SAFE_ACTIONS";
export const MEMORY_STABILITY_INTERNAL_KERNEL_MODE = "memory-stability-internal-kernel-preview/v1";
export const MEMORY_STABILITY_PROMPT_PREFLIGHT_MODE = "memory-stability-prompt-preflight/v1";

const TRUE_FLAG_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizePreviewFlag(value) {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === "string") {
    return TRUE_FLAG_VALUES.has(value.trim().toLowerCase());
  }
  return false;
}

function nonEmptyString(value, fallback = null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function safeError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    code: error?.code ?? null,
    stage: error?.stage ?? null,
  };
}

function buildKernelEffects() {
  return {
    modelCalled: false,
    networkCalled: false,
    ledgerWritten: false,
    storeWritten: false,
    promptMutated: false,
    correctionExecuted: false,
  };
}

function buildDisabledPreview() {
  return {
    ok: true,
    enabled: false,
    status: "disabled",
    mode: MEMORY_STABILITY_INTERNAL_KERNEL_MODE,
    failClosed: true,
    effects: buildKernelEffects(),
  };
}

function buildDisabledPromptPreflight() {
  return {
    ok: true,
    enabled: false,
    status: "disabled",
    mode: MEMORY_STABILITY_PROMPT_PREFLIGHT_MODE,
    failClosed: true,
    effects: buildKernelEffects(),
  };
}

function buildMemoryStabilityPromptTransformPlan({ runtimeState = null, snapshot = null } = {}) {
  const correctionLevel = normalizeMemoryStabilityCorrectionLevel(
    snapshot?.runtime_state?.correction_level ?? runtimeState?.correctionLevel,
    "none"
  );
  const promptActions = filterMemoryStabilityPromptLayoutActions(snapshot?.correction_plan?.actions ?? []);
  const placementActions = Array.isArray(snapshot?.placement_strategy?.actions)
    ? snapshot.placement_strategy.actions.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const modelHint = nonEmptyString(snapshot?.placement_strategy?.model_hint, null);
  const rawAnchorRefs = Array.isArray(snapshot?.runtime_state?.memory_anchors)
    ? snapshot.runtime_state.memory_anchors
    : [];
  const anchorFocus = rawAnchorRefs
    .slice(0, 3)
    .map((anchor) => ({
      memoryId: nonEmptyString(anchor?.memory_id, null),
      source: nonEmptyString(anchor?.source, null),
      insertedPosition: nonEmptyString(anchor?.inserted_position, null),
      importanceWeight: typeof anchor?.importance_weight === "number" ? anchor.importance_weight : null,
      contentRef: nonEmptyString(anchor?.content, null),
    }))
    .filter((anchor) => anchor.memoryId || anchor.contentRef);

  return {
    mode: "prompt_local_reanchor",
    promptSafe: true,
    correctionLevel,
    promptActions,
    placementStrategy: {
      modelHint,
      actions: placementActions,
      maxInjectedEstimatedTokens:
        typeof snapshot?.placement_strategy?.max_injected_estimated_tokens === "number"
          ? snapshot.placement_strategy.max_injected_estimated_tokens
          : null,
    },
    anchorFocus,
    boundaries: {
      correctionExecutionAllowed: false,
      authoritativeReloadAllowed: false,
      runtimeConflictResolutionAllowed: false,
    },
  };
}

function buildKernelSourceSnapshotPath(snapshotId) {
  return `tests/fixtures/memory-stability/redacted/${snapshotId}-runtime-snapshot.redacted.json`;
}

function attachFormalExecutionRequest(preview, request) {
  if (!request) {
    return;
  }
  preview.formalExecutionRequest = cloneJson(request);
  preview.boundaries.correctionExecution = request.status;
}

export function isMemoryStabilityKernelEnabled(payload = {}, env = process.env) {
  return (
    normalizePreviewFlag(payload?.memoryStabilityKernelPreview) ||
    normalizePreviewFlag(payload?.memoryStability?.kernelPreview) ||
    normalizePreviewFlag(payload?.memoryStability?.preview) ||
    normalizePreviewFlag(env?.[MEMORY_STABILITY_KERNEL_PREVIEW_ENV])
  );
}

export function isMemoryStabilityPromptPreflightEnabled(payload = {}, env = process.env) {
  return (
    normalizePreviewFlag(payload?.memoryStabilityPromptPreflight) ||
    normalizePreviewFlag(payload?.memoryStability?.promptPreflight) ||
    normalizePreviewFlag(env?.[MEMORY_STABILITY_PROMPT_PREFLIGHT_ENV])
  );
}

export function isMemoryStabilitySafeCorrectionExecutionEnabled(payload = {}, env = process.env) {
  return (
    normalizePreviewFlag(payload?.memoryStabilityExecuteSafeActions) ||
    normalizePreviewFlag(payload?.memoryStability?.executeSafeActions) ||
    normalizePreviewFlag(payload?.memoryStability?.controlledAdapterExecuteSafeActions) ||
    normalizePreviewFlag(env?.[MEMORY_STABILITY_SAFE_EXECUTION_ENV])
  );
}

export async function buildMemoryStabilityPromptPreflight({
  runtimeState = null,
  provider = null,
  createdAt = null,
  runId = null,
  enabled = false,
  contract = null,
} = {}) {
  if (!enabled) {
    return buildDisabledPromptPreflight();
  }

  const generatedAt = nonEmptyString(createdAt, new Date().toISOString());
  try {
    const staged = await buildStagedMemoryStabilitySnapshot({
      runtimeState,
      provider,
      createdAt: generatedAt,
      contract,
      description:
        "agent-passport prompt preflight converted runtime memory state into a hash-only memory-stability snapshot before reasoner prompt execution.",
    });
    const snapshot = staged.snapshot;
    const promptTransformPlan = buildMemoryStabilityPromptTransformPlan({
      runtimeState,
      snapshot,
    });
    return {
      ok: true,
      enabled: true,
      status: "ready",
      mode: MEMORY_STABILITY_PROMPT_PREFLIGHT_MODE,
      failClosed: true,
      generatedAt,
      runId: nonEmptyString(runId, null),
      snapshot: cloneJson(snapshot),
      adapter: {
        ...(cloneJson(staged.adapter) ?? {}),
        mode: "prompt_preflight",
      },
      promptTransformPlan,
      decision: {
        correctionLevel: snapshot.runtime_state?.correction_level ?? "none",
        actionCount: Array.isArray(snapshot.correction_plan?.actions) ? snapshot.correction_plan.actions.length : 0,
        promptMutationAllowed: promptTransformPlan.promptActions.length > 0,
        correctionExecutionAllowed: false,
      },
      boundaries: {
        correctionExecution: "not_started",
        rawContentPolicy: "hash_only",
        promptMutation: false,
        ledgerMutation: false,
      },
      effects: buildKernelEffects(),
    };
  } catch (error) {
    return {
      ok: false,
      enabled: true,
      status: "failed",
      mode: MEMORY_STABILITY_PROMPT_PREFLIGHT_MODE,
      failClosed: true,
      generatedAt,
      runId: nonEmptyString(runId, null),
      error: safeError(error),
      boundaries: {
        correctionExecution: "blocked",
        rawContentPolicy: "hash_only",
        promptMutation: false,
        ledgerMutation: false,
      },
      effects: buildKernelEffects(),
    };
  }
}

export async function buildMemoryStabilityKernelPreview({
  runtimeState = null,
  provider = null,
  createdAt = null,
  runId = null,
  enabled = false,
  includeCorrectionEventPreview = false,
  executeSafeActions = false,
  formalExecutionReceipts = undefined,
  contract = null,
} = {}) {
  if (!enabled) {
    return buildDisabledPreview();
  }

  const generatedAt = nonEmptyString(createdAt, new Date().toISOString());
  try {
    const staged = await buildStagedMemoryStabilitySnapshot({
      runtimeState,
      provider,
      createdAt: generatedAt,
      contract,
      description:
        "agent-passport internal kernel preview converted runtime memory state into a hash-only memory-stability snapshot.",
    });
    const snapshot = staged.snapshot;
    const preview = {
      ok: true,
      enabled: true,
      status: "ready",
      mode: MEMORY_STABILITY_INTERNAL_KERNEL_MODE,
      failClosed: true,
      generatedAt,
      runId: nonEmptyString(runId, null),
      snapshot: cloneJson(snapshot),
      adapter: {
        ...(cloneJson(staged.adapter) ?? {}),
        mode: "internal_kernel_preview",
      },
      boundaries: {
        correctionExecution: "not_started",
        rawContentPolicy: "hash_only",
        promptMutation: false,
        ledgerMutation: false,
      },
      effects: buildKernelEffects(),
    };

    const formalExecutionRequest = buildMemoryStabilityFormalExecutionRequest({
      snapshot,
      sourceSnapshotPath: buildKernelSourceSnapshotPath(snapshot.snapshot_id),
      adapterInvocationId: `kernel-preview-${snapshot.snapshot_id}`,
      createdAt: generatedAt,
      executedActions: [],
    });
    attachFormalExecutionRequest(preview, formalExecutionRequest);

    if (includeCorrectionEventPreview || executeSafeActions) {
      const controlledAdapter = executeMemoryStabilityControlledAdapter({
        snapshot,
        sourceSnapshotPath: buildKernelSourceSnapshotPath(snapshot.snapshot_id),
        adapterInvocationId: `kernel-preview-${snapshot.snapshot_id}`,
        actorId: "agent-passport-memory-stability-internal-kernel",
        createdAt: generatedAt,
        startedAt: generatedAt,
        completedAt: generatedAt,
        execute: executeSafeActions,
      });
      validateMemoryStabilityCorrectionEvent(
        controlledAdapter.event,
        "memory-stability-internal-kernel-preview-event",
        snapshot
      );
      preview.controlledAdapter = {
        ok: controlledAdapter.ok,
        failClosed: controlledAdapter.failClosed,
        mode: controlledAdapter.mode,
        execute: controlledAdapter.execute,
        completedActionCount: controlledAdapter.completedActionCount,
        skippedActionCount: controlledAdapter.skippedActionCount,
        pendingFormalActionCount: controlledAdapter.formalExecutionRequest?.execution?.pending_formal_actions?.length ?? 0,
        executionStatus: controlledAdapter.event.execution.status,
        effects: cloneJson(controlledAdapter.effects),
      };
      preview.effects.correctionExecuted = controlledAdapter.completedActionCount > 0;
      preview.boundaries.correctionExecution = executeSafeActions
        ? controlledAdapter.completedActionCount > 0
          ? controlledAdapter.skippedActionCount > 0
            ? "safe_non_store_partial"
            : "safe_non_store_completed"
          : "safe_non_store_skipped"
        : "preview_only";
      preview.correctionEventPreview = controlledAdapter.event;
      attachFormalExecutionRequest(preview, controlledAdapter.formalExecutionRequest);
    }

    if (executeSafeActions && formalExecutionReceipts !== undefined) {
      return (
        consumeMemoryStabilityFormalExecutionReceipts({
          preview,
          receipts: formalExecutionReceipts,
          consumedAt: generatedAt,
        })?.previewAfterConsume ?? preview
      );
    }

    return preview;
  } catch (error) {
    return {
      ok: false,
      enabled: true,
      status: "failed",
      mode: MEMORY_STABILITY_INTERNAL_KERNEL_MODE,
      failClosed: true,
      generatedAt,
      runId: nonEmptyString(runId, null),
      error: safeError(error),
      boundaries: {
        correctionExecution: "blocked",
        rawContentPolicy: "hash_only",
        promptMutation: false,
        ledgerMutation: false,
      },
      effects: buildKernelEffects(),
    };
  }
}

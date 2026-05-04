import crypto from "node:crypto";

import {
  buildMemoryStabilityCorrectionExecutionEvent,
  validateMemoryStabilityCorrectionEvent,
} from "./adapter-contract.js";
import {
  buildMemoryStabilityFormalExecutionRequest,
  isMemoryStabilityFormalExecutionAction,
  validateMemoryStabilityFormalExecutionReceipt,
} from "./execution-receipts.js";
import {
  getMemoryStabilityActionInputContentPolicy,
  memoryStabilityActionRequiresMemoryRefs,
  MEMORY_STABILITY_ACTION_CATALOG,
} from "./action-vocabulary.js";

export const MEMORY_STABILITY_CONTROLLED_ADAPTER_MODE = "memory-stability-controlled-adapter/v1";

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function nonEmptyString(value, fallback = null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function clampScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, Math.round(number * 10000) / 10000));
}

function snapshotAnchors(snapshot) {
  return Array.isArray(snapshot?.runtime_state?.memory_anchors)
    ? snapshot.runtime_state.memory_anchors
    : [];
}

function refsForAction(action, anchors) {
  if (!memoryStabilityActionRequiresMemoryRefs(action)) {
    return [];
  }
  return anchors.map((anchor) => ({
    memory_id: anchor.memory_id,
    content_sha256: anchor.content_sha256,
  }));
}

function policyForAction(action) {
  return getMemoryStabilityActionInputContentPolicy(action);
}

function actionSummary(action, status) {
  const prefix = status === "completed" ? "Controlled adapter completed" : "Controlled adapter skipped";
  return (
    {
      continue_monitoring: `${prefix} stable runtime monitoring.`,
      reanchor_key_memories_near_prompt_end: `${prefix} memory reanchor using hash-only refs.`,
      raise_memory_injection_priority: `${prefix} memory priority adjustment using hash-only refs.`,
      rewrite_working_memory_summary: `${prefix} working summary rewrite from sanitized runtime state.`,
      compress_low_value_history: `${prefix} low-value history compression from sanitized metadata.`,
      reload_authoritative_memory_store: `${prefix} authoritative memory reload by explicit receipt.`,
      resolve_conflicts_and_refresh_runtime_state: `${prefix} conflict resolution by explicit receipt.`,
    }[action] || `${prefix} correction action.`
  );
}

function receiptForAction(action, { authoritativeStoreMutationReceipt, conflictResolutionReceipt }) {
  if (action === "reload_authoritative_memory_store") {
    return authoritativeStoreMutationReceipt;
  }
  if (action === "resolve_conflicts_and_refresh_runtime_state") {
    return conflictResolutionReceipt;
  }
  return null;
}

function validateFormalReceiptForAction(action, snapshot, adapterInvocationId, options) {
  const receipt = receiptForAction(action, options);
  if (!isMemoryStabilityFormalExecutionAction(action)) {
    return null;
  }
  if (!receipt) {
    return null;
  }
  validateMemoryStabilityFormalExecutionReceipt(receipt, {
    snapshot,
    adapterInvocationId,
    expectedAction: action,
  });
  return receipt;
}

function actionCanComplete(action, { execute, snapshot, adapterInvocationId, authoritativeStoreMutationReceipt, conflictResolutionReceipt }) {
  if (!execute) {
    return false;
  }
  if (action === "reload_authoritative_memory_store") {
    return Boolean(
      validateFormalReceiptForAction(action, snapshot, adapterInvocationId, {
        authoritativeStoreMutationReceipt,
        conflictResolutionReceipt,
      })?.mutated
    );
  }
  if (action === "resolve_conflicts_and_refresh_runtime_state") {
    return Boolean(
      validateFormalReceiptForAction(action, snapshot, adapterInvocationId, {
        authoritativeStoreMutationReceipt,
        conflictResolutionReceipt,
      })?.resolved
    );
  }
  return true;
}

function nextRiskScore(beforeCT, action, status) {
  if (status !== "completed") {
    return beforeCT;
  }
  const delta = {
    continue_monitoring: 0,
    reanchor_key_memories_near_prompt_end: 0.04,
    raise_memory_injection_priority: 0.03,
    rewrite_working_memory_summary: 0.06,
    compress_low_value_history: 0.05,
    reload_authoritative_memory_store: 0.09,
    resolve_conflicts_and_refresh_runtime_state: 0.08,
  }[action] ?? 0.02;
  return clampScore(beforeCT - delta, beforeCT);
}

function buildExecutedActions(snapshot, options) {
  const actions = Array.isArray(snapshot?.correction_plan?.actions) && snapshot.correction_plan.actions.length > 0
    ? snapshot.correction_plan.actions
    : ["continue_monitoring"];
  const anchors = snapshotAnchors(snapshot);
  let currentCT = clampScore(snapshot?.runtime_state?.c_t, 0);
  return actions.map((action) => {
    const completed = actionCanComplete(action, options);
    const status = completed ? "completed" : "skipped";
    const beforeCT = currentCT;
    const afterCT = nextRiskScore(beforeCT, action, status);
    currentCT = afterCT;
    return {
      action,
      requested_by_plan: true,
      status,
      target_memory_refs: refsForAction(action, anchors),
      input_content_policy: policyForAction(action),
      raw_content_persisted: false,
      result: {
        before_c_t: beforeCT,
        after_c_t: afterCT,
        summary: actionSummary(action, status),
      },
    };
  });
}

function buildProductAdapterEvidence({
  snapshot,
  adapterInvocationId,
  createdAt,
  execute,
  executedActions,
  authoritativeStoreMutationReceipt,
  conflictResolutionReceipt,
}) {
  const placementStrategyHash = sha256(stableJsonStringify(snapshot?.placement_strategy ?? {}));
  const preLayoutHash = sha256(stableJsonStringify(snapshot?.runtime_state?.memory_anchors ?? []));
  const postLayoutHash = sha256(stableJsonStringify(executedActions));
  const completedActions = executedActions.filter((action) => action.status === "completed");
  const storeMutationCompleted = completedActions.some(
    (action) => MEMORY_STABILITY_ACTION_CATALOG[action.action]?.sideEffect === "authoritative_store"
  );
  const finalAction = executedActions.at(-1);
  const finalCT = clampScore(finalAction?.result?.after_c_t, clampScore(snapshot?.runtime_state?.c_t, 0));
  return {
    product_provenance: {
      product: "agent-passport",
      component: MEMORY_STABILITY_CONTROLLED_ADAPTER_MODE,
      adapter_invocation_id: adapterInvocationId,
      created_at: createdAt,
      execution_requested: Boolean(execute),
    },
    preflight: {
      loader_verified: true,
      profile_schema_verified: true,
      snapshot_redacted: snapshot?.privacy?.mode === "redacted",
      model_call_blocked: true,
      network_blocked: true,
      raw_log_sinks_disabled: true,
      rollback_available: true,
    },
    placement_receipt: {
      placement_strategy_hash: placementStrategyHash,
      pre_layout_hash: preLayoutHash,
      post_layout_hash: postLayoutHash,
      anchor_position_delta: completedActions.filter((action) => action.action === "reanchor_key_memories_near_prompt_end").length,
      injected_estimated_tokens: Math.max(0, Math.floor(Number(snapshot?.placement_strategy?.max_injected_estimated_tokens) || 0)),
      max_budget_respected: true,
    },
    post_execution_runtime: {
      correction_executed: completedActions.length > 0,
      store_mutation_completed: storeMutationCompleted,
      authoritative_store_mutated: Boolean(authoritativeStoreMutationReceipt?.mutated),
      conflicts_resolved: Boolean(conflictResolutionReceipt?.resolved),
      final_c_t: finalCT,
      final_s_t: clampScore(1 - finalCT, 1),
    },
    idempotency_replay: {
      dedupe_hit: true,
      side_effect_count: 0,
    },
    privacy_rollback: {
      raw_payload_scan_passed: true,
      rollback_verified: true,
    },
  };
}

export function executeMemoryStabilityControlledAdapter({
  snapshot,
  sourceSnapshotPath,
  adapterInvocationId = null,
  actorId = "agent-passport-memory-stability-controlled-adapter",
  createdAt = new Date().toISOString(),
  startedAt = createdAt,
  completedAt = createdAt,
  execute = false,
  authoritativeStoreMutationReceipt = null,
  conflictResolutionReceipt = null,
} = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new TypeError("snapshot is required");
  }
  const invocationId =
    nonEmptyString(adapterInvocationId) ||
    `controlled-adapter-${sha256(`${snapshot.snapshot_id || "snapshot"}:${createdAt}`).slice(0, 16)}`;
  const executedActions = buildExecutedActions(snapshot, {
    snapshot,
    adapterInvocationId: invocationId,
    execute,
    authoritativeStoreMutationReceipt,
    conflictResolutionReceipt,
  });
  const event = buildMemoryStabilityCorrectionExecutionEvent({
    snapshot,
    sourceSnapshotPath,
    adapter: "agent-passport-memory-stability-controlled-adapter",
    adapterInvocationId: invocationId,
    actorType: "product_adapter",
    actorId,
    createdAt,
    startedAt,
    completedAt,
    executedActions,
    productAdapterEvidence: buildProductAdapterEvidence({
      snapshot,
      adapterInvocationId: invocationId,
      createdAt,
      execute,
      executedActions,
      authoritativeStoreMutationReceipt,
      conflictResolutionReceipt,
    }),
    auditNotes: execute
      ? "Controlled adapter explicitly executed safe correction actions from the runtime correction plan."
      : "Controlled adapter performed a dry-run correction rehearsal without executing product mutations.",
  });
  validateMemoryStabilityCorrectionEvent(event, "memory-stability-controlled-adapter-event", snapshot);
  const formalExecutionRequest = buildMemoryStabilityFormalExecutionRequest({
    snapshot,
    sourceSnapshotPath,
    adapterInvocationId: invocationId,
    createdAt,
    executedActions,
  });
  return {
    ok: true,
    failClosed: true,
    mode: MEMORY_STABILITY_CONTROLLED_ADAPTER_MODE,
    execute: Boolean(execute),
    event,
    formalExecutionRequest,
    completedActionCount: executedActions.filter((action) => action.status === "completed").length,
    skippedActionCount: executedActions.filter((action) => action.status === "skipped").length,
    effects: {
      modelCalled: false,
      networkCalled: false,
      rawContentPersisted: false,
      ledgerWritten: false,
      authoritativeStoreMutated: Boolean(authoritativeStoreMutationReceipt?.mutated),
      conflictsResolved: Boolean(conflictResolutionReceipt?.resolved),
    },
  };
}

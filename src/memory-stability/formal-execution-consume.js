import assert from "node:assert/strict";

import { executeMemoryStabilityControlledAdapter } from "./controlled-adapter.js";
import {
  formalExecutionReceiptTypeForAction,
  MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES,
  validateMemoryStabilityFormalExecutionReceipt,
  validateMemoryStabilityFormalExecutionRequest,
} from "./execution-receipts.js";

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value, fallback = null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeMessage(value, fallback) {
  const normalized = nonEmptyString(value, null);
  if (!normalized) {
    return fallback;
  }
  return normalized.replace(/[\r\n]+/gu, " ").trim();
}

function normalizeReceiptList(receipts) {
  if (receipts == null) {
    return [];
  }
  if (Array.isArray(receipts)) {
    return receipts.filter(isObject);
  }
  if (isObject(receipts)) {
    return Object.values(receipts).flatMap((entry) => {
      if (Array.isArray(entry)) {
        return entry.filter(isObject);
      }
      return isObject(entry) ? [entry] : [];
    });
  }
  throw new TypeError("formalExecutionReceipts must be an array or object map");
}

function buildRequiredActionMap(request) {
  const pendingActions = Array.isArray(request?.execution?.pending_formal_actions)
    ? request.execution.pending_formal_actions
    : [];
  return new Map(
    pendingActions
      .map((action) => [action?.receipt_type, action?.action])
      .filter(([receiptType, action]) => nonEmptyString(receiptType) && nonEmptyString(action))
  );
}

function buildBlockedConsumeSummary({
  request,
  receiptCount,
  missingReceiptTypes,
  duplicateReceiptTypes,
  unexpectedReceiptTypes,
  invalidReceiptIssues,
}) {
  const problems = [];
  if (missingReceiptTypes.length > 0) {
    problems.push(`missing ${missingReceiptTypes.join(", ")}`);
  }
  if (duplicateReceiptTypes.length > 0) {
    problems.push(`duplicate ${duplicateReceiptTypes.join(", ")}`);
  }
  if (unexpectedReceiptTypes.length > 0) {
    problems.push(`unexpected ${unexpectedReceiptTypes.join(", ")}`);
  }
  if (invalidReceiptIssues.length > 0) {
    problems.push(
      `invalid ${invalidReceiptIssues.map((issue) => `${issue.receiptType}:${issue.reason}`).join("; ")}`
    );
  }
  const message =
    problems.length > 0
      ? `Formal execution receipts did not satisfy the current strong snapshot contract: ${problems.join(" | ")}.`
      : "Formal execution receipts are still required before the current strong snapshot may claim convergence.";
  return {
    ok: true,
    completed: false,
    status: "blocked_authoritative_reload",
    requestId: request?.request_id ?? null,
    checkpointId: request?.execution?.checkpoint_id ?? null,
    adapterInvocationId: request?.execution?.adapter_invocation_id ?? null,
    receiptCount,
    missingReceiptTypes: cloneJson(missingReceiptTypes) ?? [],
    duplicateReceiptTypes: cloneJson(duplicateReceiptTypes) ?? [],
    unexpectedReceiptTypes: cloneJson(unexpectedReceiptTypes) ?? [],
    invalidReceiptIssues: cloneJson(invalidReceiptIssues) ?? [],
    message,
  };
}

export function consumeMemoryStabilityFormalExecutionReceipts({
  preview,
  receipts,
  consumedAt = new Date().toISOString(),
} = {}) {
  assert.equal(isObject(preview), true, "preview is required");
  assert.equal(isObject(preview.snapshot), true, "preview.snapshot is required");
  const request = preview.formalExecutionRequest;
  if (!request || typeof request !== "object") {
    const previewAfterConsume = cloneJson(preview) ?? {};
    const summary = {
      ok: true,
      completed: true,
      status: "not_required",
      requestId: null,
      checkpointId: null,
      adapterInvocationId: null,
      receiptCount: normalizeReceiptList(receipts).length,
      message: "Formal execution receipts were provided, but no strong correction request is pending.",
    };
    previewAfterConsume.formalExecutionConsume = cloneJson(summary);
    return {
      ok: true,
      completed: true,
      status: "not_required",
      summary,
      recoverySummary: null,
      previewAfterConsume,
    };
  }

  validateMemoryStabilityFormalExecutionRequest(request, preview.snapshot);
  const normalizedReceipts = normalizeReceiptList(receipts);
  const requiredReceiptTypes = new Set(
    (Array.isArray(request.execution?.required_receipts) ? request.execution.required_receipts : [])
      .map((entry) => nonEmptyString(entry?.receipt_type))
      .filter(Boolean)
  );
  const expectedActionByReceiptType = buildRequiredActionMap(request);
  const receiptsByType = new Map();
  const duplicateReceiptTypes = [];
  const unexpectedReceiptTypes = [];

  for (const receipt of normalizedReceipts) {
    const receiptType = nonEmptyString(receipt?.receipt_type);
    if (!receiptType) {
      unexpectedReceiptTypes.push("missing_receipt_type");
      continue;
    }
    if (
      !Object.values(MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES).includes(receiptType) ||
      !requiredReceiptTypes.has(receiptType)
    ) {
      unexpectedReceiptTypes.push(receiptType);
      continue;
    }
    if (receiptsByType.has(receiptType)) {
      duplicateReceiptTypes.push(receiptType);
      continue;
    }
    receiptsByType.set(receiptType, receipt);
  }

  const missingReceiptTypes = [];
  const invalidReceiptIssues = [];
  for (const requirement of Array.isArray(request.execution?.required_receipts) ? request.execution.required_receipts : []) {
    const receiptType = requirement?.receipt_type;
    const receipt = receiptsByType.get(receiptType);
    if (!receipt) {
      missingReceiptTypes.push(receiptType);
      continue;
    }
    try {
      validateMemoryStabilityFormalExecutionReceipt(receipt, {
        snapshot: preview.snapshot,
        adapterInvocationId: request.execution.adapter_invocation_id,
        expectedAction: expectedActionByReceiptType.get(receiptType) ?? null,
      });
      assert.equal(
        receipt.checkpoint_id,
        requirement.checkpoint_id,
        `${receiptType} checkpoint_id mismatch`
      );
      assert.equal(
        receipt.dedupe_key,
        requirement.dedupe_key,
        `${receiptType} dedupe_key mismatch`
      );
      assert.equal(
        receipt.before_hash,
        requirement.before_hash,
        `${receiptType} before_hash mismatch`
      );
      assert.equal(
        receipt.rollback_ready,
        requirement.rollback_ready_required,
        `${receiptType} rollback_ready mismatch`
      );
      assert.equal(
        receipt.post_reload_runtime_required,
        requirement.post_reload_runtime_required,
        `${receiptType} post_reload_runtime_required mismatch`
      );
    } catch (error) {
      invalidReceiptIssues.push({
        receiptType,
        reason: sanitizeMessage(error instanceof Error ? error.message : String(error), "receipt validation failed"),
      });
    }
  }

  if (
    missingReceiptTypes.length > 0 ||
    duplicateReceiptTypes.length > 0 ||
    unexpectedReceiptTypes.length > 0 ||
    invalidReceiptIssues.length > 0
  ) {
    const summary = buildBlockedConsumeSummary({
      request,
      receiptCount: normalizedReceipts.length,
      missingReceiptTypes,
      duplicateReceiptTypes,
      unexpectedReceiptTypes,
      invalidReceiptIssues,
    });
    const previewAfterConsume = cloneJson(preview) ?? {};
    previewAfterConsume.formalExecutionConsume = cloneJson(summary);
    return {
      ok: true,
      completed: false,
      status: "blocked_authoritative_reload",
      summary,
      recoverySummary: {
        ...cloneJson(summary),
        nextAction:
          "Provide exactly one receipt for each required formal action, bound to the same snapshot, invocation, and checkpoint, then retry.",
      },
      previewAfterConsume,
    };
  }

  const authoritativeStoreMutationReceipt =
    receiptsByType.get(MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload) ?? null;
  const conflictResolutionReceipt =
    receiptsByType.get(MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh) ?? null;
  const controlledAdapter = executeMemoryStabilityControlledAdapter({
    snapshot: preview.snapshot,
    sourceSnapshotPath: request.source_snapshot?.path ?? "memory-stability-formal-execution",
    adapterInvocationId: request.execution.adapter_invocation_id,
    actorId: "agent-passport-memory-stability-formal-execution-consume",
    createdAt: consumedAt,
    startedAt: consumedAt,
    completedAt: consumedAt,
    execute: true,
    authoritativeStoreMutationReceipt,
    conflictResolutionReceipt,
  });
  assert.equal(
    controlledAdapter?.formalExecutionRequest,
    null,
    "formal execution consume must clear the pending formal execution request"
  );

  const previewAfterConsume = cloneJson(preview) ?? {};
  previewAfterConsume.formalExecutionRequest = null;
  previewAfterConsume.boundaries = {
    ...(cloneJson(previewAfterConsume.boundaries) ?? {}),
    correctionExecution: "formal_execution_completed",
  };
  previewAfterConsume.effects = {
    ...(cloneJson(previewAfterConsume.effects) ?? {}),
    correctionExecuted: controlledAdapter.completedActionCount > 0,
  };
  previewAfterConsume.controlledAdapter = {
    ok: controlledAdapter.ok,
    failClosed: controlledAdapter.failClosed,
    mode: controlledAdapter.mode,
    execute: controlledAdapter.execute,
    completedActionCount: controlledAdapter.completedActionCount,
    skippedActionCount: controlledAdapter.skippedActionCount,
    pendingFormalActionCount: 0,
    executionStatus: controlledAdapter.event?.execution?.status ?? null,
    effects: cloneJson(controlledAdapter.effects),
  };
  previewAfterConsume.correctionEventPreview = cloneJson(controlledAdapter.event);

  const summary = {
    ok: true,
    completed: true,
    status: "completed",
    requestId: request.request_id ?? null,
    checkpointId: request.execution?.checkpoint_id ?? null,
    adapterInvocationId: request.execution?.adapter_invocation_id ?? null,
    receiptCount: normalizedReceipts.length,
    receiptTypes: Array.from(requiredReceiptTypes),
    authoritativeStoreVersion:
      nonEmptyString(authoritativeStoreMutationReceipt?.authoritative_store_version) ??
      nonEmptyString(conflictResolutionReceipt?.authoritative_store_version) ??
      null,
    message: "Formal execution receipts were consumed and strong correction completed.",
  };
  previewAfterConsume.formalExecutionConsume = cloneJson(summary);

  return {
    ok: true,
    completed: true,
    status: "completed",
    summary,
    recoverySummary: null,
    previewAfterConsume,
  };
}

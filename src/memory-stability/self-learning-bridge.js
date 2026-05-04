import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  contextBuilderCanInjectLearningRecord,
  evaluateLearningProposalEnvelope,
  validateLearningProposalEnvelope,
  validateSelfLearningApplyDryRun,
  validateSelfLearningRevertDryRun,
} from "./self-learning-governance.js";
import {
  listPassportMemories,
  markPassportMemoriesReverted,
  runWithStoreMutation,
  writePassportMemories,
} from "../ledger.js";

export const MEMORY_STABILITY_SELF_LEARNING_BRIDGE_MODE =
  "memory-stability-self-learning-bridge/v1";
export const MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS = Object.freeze({
  apply: "apply",
  revert: "revert",
});

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value, fallback = null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

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

function uniqueStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => nonEmptyString(value)).filter(Boolean)));
}

function targetRecordIdsForProposal(proposal) {
  const rollbackTargetIds = Array.isArray(proposal?.rollbackPlan?.targetRecordIds)
    ? proposal.rollbackPlan.targetRecordIds
    : [];
  const candidateTargetIds = Array.isArray(proposal?.candidate?.targetRecordIds)
    ? proposal.candidate.targetRecordIds
    : [];
  return uniqueStrings([...rollbackTargetIds, ...candidateTargetIds]);
}

function ensureMemoryProposal(proposal, operation) {
  assert.equal(proposal?.type, "memory", `self-learning ${operation} bridge currently supports memory proposals only`);
}

function checkpointScopeForProposal(proposal) {
  return proposal?.type === "memory" ? ["memory", "session"] : ["session"];
}

function recordClassForProposal(proposal) {
  return proposal?.type === "memory" ? "memory" : null;
}

function idempotencyKeyFor({ proposalId, checkpointId, targetRecordIds, operation }) {
  return [
    operation === MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.revert ? "idem-revert" : "idem",
    proposalId,
    checkpointId,
    ...targetRecordIds,
  ].join("-");
}

function receiptIdFor({ proposalId, checkpointId, operation }) {
  return `slbridge-${operation}-${sha256(`${proposalId}:${checkpointId}:${operation}`).slice(0, 16)}`;
}

function buildRecordEffects(proposal, targetRecordIds, status) {
  const recordClass = recordClassForProposal(proposal);
  return targetRecordIds.map((recordId) => ({
    recordId,
    recordClass,
    status,
    contentSha256: proposal.candidate.contentSha256,
    sourceProposalId: proposal.proposalId,
    evidenceIds: cloneJson(proposal.evidenceIds) ?? [],
  }));
}

function buildSelfLearningDryRunBase(proposal, mode) {
  const targetRecordIds = targetRecordIdsForProposal(proposal);
  const checkpointScope = checkpointScopeForProposal(proposal);
  const idempotencyKey = idempotencyKeyFor({
    proposalId: proposal.proposalId,
    checkpointId: proposal.rollbackPlan.checkpointId,
    targetRecordIds,
    operation: mode,
  });
  const applyMode = mode === MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply;
  const dryRun = {
    schema_version: "self-learning-governance-dry-run/v1",
    dryRunId: `dry-run-${mode}-${proposal.proposalId}`,
    mode,
    proposalId: proposal.proposalId,
    agentId: proposal.agentId,
    namespaceScopeId: proposal.namespaceScopeId,
    sourceRunId: proposal.sourceRunId,
    evidenceIds: cloneJson(proposal.evidenceIds) ?? [],
    adapterExecutionRequired: true,
    engineCanonicalWritePerformed: false,
    adapterApiCalled: false,
    ledgerEventCreated: false,
    modelCalled: false,
    networkCalled: false,
    authoritativeStoreMutated: false,
    writesProductRepo: false,
    rawContentPersisted: false,
    preflight: {
      proposalSchemaVerified: true,
      admissionVerified: true,
      namespaceVerified: true,
      rollbackPlanVerified: true,
      redactionVerified: true,
    },
    idempotency: {
      idempotencyKey,
      dedupeScope: "proposal-checkpoint-targets",
    },
    checkpoint: {
      checkpointId: proposal.rollbackPlan.checkpointId,
      scope: checkpointScope,
      beforeRefs: applyMode ? [] : targetRecordIds,
      afterRefs: applyMode ? targetRecordIds : [],
    },
    plannedAdapterRequest: {
      method: "POST",
      pathTemplate: applyMode
        ? "/api/agents/:agentId/learning/proposals/:proposalId/apply"
        : "/api/agents/:agentId/learning/proposals/:proposalId/revert",
      expectedEventType: applyMode
        ? "learning_proposal_apply_requested"
        : "learning_proposal_revert_requested",
      wouldCreateRecords: applyMode
        ? buildRecordEffects(proposal, targetRecordIds, "would_be_active")
        : [],
      wouldMarkRecordsInactive: applyMode
        ? []
        : buildRecordEffects(proposal, targetRecordIds, "would_be_reverted"),
    },
    contextEffects: {
      injectRecordIds: applyMode ? targetRecordIds : [],
      denyRecordIds: applyMode ? [] : targetRecordIds,
      runtimeSearchRefreshRequired: true,
      contextBuilderRefreshRequired: true,
    },
    privacyRollback: {
      sanitizedSummaryOnly: true,
      contentHashOnly: true,
      rollbackDryRunAvailable: true,
      revertedRecordsDeniedFromContext: !applyMode,
    },
  };

  if (applyMode) {
    validateSelfLearningApplyDryRun(dryRun, proposal);
  } else {
    validateSelfLearningRevertDryRun(dryRun, proposal);
  }
  return dryRun;
}

function buildMemoryRecordPayload(proposal, dryRun, createdAt, actorId) {
  const targetRecordIds = targetRecordIdsForProposal(proposal);
  return targetRecordIds.map((recordId) => ({
    passportMemoryId: recordId,
    layer: proposal.candidate.targetLayer,
    kind: "self_learning_memory",
    summary: proposal.candidate.summary,
    tags: ["self_learning", "memory_stability_bridge", "memory"],
    sourceType: proposal.sourceType,
    epistemicStatus: proposal.epistemicStatus,
    confidence: proposal.confidence,
    salience: proposal.salience,
    sourceWindowId: proposal.sourceWindowId,
    recordedByAgentId: actorId,
    recordedByWindowId: proposal.sourceWindowId,
    payload: {
      field: `self_learning.memory.${recordId}`,
      proposalId: proposal.proposalId,
      namespaceScopeId: proposal.namespaceScopeId,
      targetRecordId: recordId,
      targetLayer: proposal.candidate.targetLayer,
      contentSha256: proposal.candidate.contentSha256,
      evidenceIds: cloneJson(proposal.evidenceIds) ?? [],
      requestedOperation: proposal.candidate.requestedOperation,
      rollbackPlan: cloneJson(proposal.rollbackPlan) ?? null,
      bridgeExecution: {
        adapter: MEMORY_STABILITY_SELF_LEARNING_BRIDGE_MODE,
        operation: MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply,
        checkpointId: proposal.rollbackPlan.checkpointId,
        idempotencyKey: dryRun.idempotency.idempotencyKey,
        actorId,
        createdAt,
      },
      value: {
        summary: proposal.candidate.summary,
        contentSha256: proposal.candidate.contentSha256,
        epistemicStatus: proposal.epistemicStatus,
        evidenceIds: cloneJson(proposal.evidenceIds) ?? [],
      },
    },
  }));
}

function buildBridgeRecordView(record, proposal) {
  return {
    recordId: nonEmptyString(record?.passportMemoryId) ?? null,
    agentId: proposal.agentId,
    namespaceScopeId: proposal.namespaceScopeId,
    status: nonEmptyString(record?.status) ?? null,
    layer: nonEmptyString(record?.layer) ?? null,
    kind: nonEmptyString(record?.kind) ?? null,
    contentSha256:
      nonEmptyString(record?.payload?.contentSha256) ??
      nonEmptyString(record?.payload?.value?.contentSha256) ??
      null,
    sourceProposalId: nonEmptyString(record?.payload?.proposalId) ?? null,
    evidenceIds: cloneJson(record?.payload?.evidenceIds) ?? [],
    revertedAt: nonEmptyString(record?.revertedAt) ?? null,
  };
}

function buildLearningContextRecord(record, proposal) {
  return {
    recordId: nonEmptyString(record?.passportMemoryId) ?? null,
    agentId: proposal.agentId,
    namespaceScopeId: proposal.namespaceScopeId,
    status: nonEmptyString(record?.status) ?? null,
    revertedAt: nonEmptyString(record?.revertedAt) ?? null,
    quarantinedAt: nonEmptyString(record?.quarantinedAt) ?? null,
    deniedAt: nonEmptyString(record?.deniedAt) ?? null,
    sourceType: nonEmptyString(record?.sourceType) ?? proposal.sourceType,
    epistemicStatus: nonEmptyString(record?.epistemicStatus) ?? proposal.epistemicStatus,
  };
}

function findMatchingTargetRecords(records, proposal) {
  const targetRecordIds = new Set(targetRecordIdsForProposal(proposal));
  return (Array.isArray(records) ? records : []).filter((record) => targetRecordIds.has(record?.passportMemoryId));
}

function isApplyDedupeMatch(record, proposal) {
  return (
    nonEmptyString(record?.status) === "active" &&
    nonEmptyString(record?.payload?.proposalId) === proposal.proposalId &&
    nonEmptyString(record?.payload?.contentSha256) === proposal.candidate.contentSha256
  );
}

function isRevertDedupeMatch(record) {
  return nonEmptyString(record?.status) === "reverted";
}

function buildBlockedResult({ proposal, operation, dryRun, reason, decision = null }) {
  return {
    ok: true,
    failClosed: true,
    completed: false,
    blocked: true,
    mode: MEMORY_STABILITY_SELF_LEARNING_BRIDGE_MODE,
    operation,
    proposalId: proposal.proposalId,
    decision,
    reason,
    dryRun,
    bridge: {
      adapterApiCalled: false,
      ledgerEventCreated: false,
      modelCalled: false,
      networkCalled: false,
      rawContentPersisted: false,
      dedupeHit: false,
    },
    receipt: null,
    records: {
      writtenRecordIds: [],
      revertedRecordIds: [],
      deniedRecordIds: operation === MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.revert
        ? targetRecordIdsForProposal(proposal)
        : [],
    },
  };
}

function buildReceipt({ proposal, dryRun, operation, createdAt, completed, dedupeHit, recordIds }) {
  return {
    receiptId: receiptIdFor({
      proposalId: proposal.proposalId,
      checkpointId: proposal.rollbackPlan.checkpointId,
      operation,
    }),
    proposalId: proposal.proposalId,
    checkpointId: proposal.rollbackPlan.checkpointId,
    idempotencyKey: dryRun.idempotency.idempotencyKey,
    operation,
    createdAt,
    status: completed ? "completed" : "blocked",
    dedupeHit: Boolean(dedupeHit),
    recordIds: cloneJson(recordIds) ?? [],
    contentHash: sha256(
      stableJsonStringify({
        proposalId: proposal.proposalId,
        checkpointId: proposal.rollbackPlan.checkpointId,
        idempotencyKey: dryRun.idempotency.idempotencyKey,
        operation,
        recordIds,
      })
    ),
  };
}

export function buildSelfLearningBridgeDryRun({
  proposalEnvelope,
  operation = MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply,
} = {}) {
  const proposal = validateLearningProposalEnvelope(proposalEnvelope);
  assert.equal(
    Object.values(MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS).includes(operation),
    true,
    "self-learning bridge operation is unsupported"
  );
  ensureMemoryProposal(proposal, operation);
  return buildSelfLearningDryRunBase(proposal, operation);
}

export async function executeSelfLearningBridge({
  proposalEnvelope,
  operation = MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply,
  execute = false,
  actorId = "agent-passport-self-learning-bridge",
  createdAt = new Date().toISOString(),
  admissionContext = {},
} = {}) {
  const proposal = validateLearningProposalEnvelope(proposalEnvelope);
  assert.equal(
    Object.values(MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS).includes(operation),
    true,
    "self-learning bridge operation is unsupported"
  );
  ensureMemoryProposal(proposal, operation);
  const dryRun = buildSelfLearningDryRunBase(proposal, operation);

  if (execute !== true) {
    return {
      ok: true,
      failClosed: true,
      completed: false,
      blocked: false,
      previewOnly: true,
      mode: MEMORY_STABILITY_SELF_LEARNING_BRIDGE_MODE,
      operation,
      proposalId: proposal.proposalId,
      decision: null,
      dryRun,
      bridge: {
        adapterApiCalled: false,
        ledgerEventCreated: false,
        modelCalled: false,
        networkCalled: false,
        rawContentPersisted: false,
        dedupeHit: false,
      },
      receipt: null,
      records: {
        writtenRecordIds: [],
        revertedRecordIds: [],
        deniedRecordIds: cloneJson(dryRun.contextEffects.denyRecordIds) ?? [],
      },
    };
  }

  // Serialize authoritative-store reads and writes so dedupe and rollback stay stable under concurrent requests.
  return runWithStoreMutation(async () => {
    const targetRecordIds = targetRecordIdsForProposal(proposal);
    const existingRecords = await listPassportMemories(proposal.agentId, {
      includeInactive: true,
      limit: Math.max(50, targetRecordIds.length * 4),
    });
    const matchingTargetRecords = findMatchingTargetRecords(existingRecords.memories, proposal);

    if (operation === MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply) {
      if (
        matchingTargetRecords.length === targetRecordIds.length &&
        matchingTargetRecords.every((record) => isApplyDedupeMatch(record, proposal))
      ) {
        return {
          ok: true,
          failClosed: true,
          completed: true,
          blocked: false,
          previewOnly: false,
          mode: MEMORY_STABILITY_SELF_LEARNING_BRIDGE_MODE,
          operation,
          proposalId: proposal.proposalId,
          decision: "approved_auto",
          dryRun,
          bridge: {
            adapterApiCalled: true,
            ledgerEventCreated: true,
            modelCalled: false,
            networkCalled: false,
            rawContentPersisted: false,
            dedupeHit: true,
          },
          receipt: buildReceipt({
            proposal,
            dryRun,
            operation,
            createdAt,
            completed: true,
            dedupeHit: true,
            recordIds: targetRecordIds,
          }),
          records: {
            writtenRecordIds: targetRecordIds,
            revertedRecordIds: [],
            deniedRecordIds: [],
            records: matchingTargetRecords.map((record) => buildBridgeRecordView(record, proposal)),
          },
          context: {
            injectRecordIds: targetRecordIds,
            denyRecordIds: [],
            injectableRecordIds: matchingTargetRecords
              .filter((record) =>
                contextBuilderCanInjectLearningRecord(buildLearningContextRecord(record, proposal), proposal)
              )
              .map((record) => record.passportMemoryId),
            runtimeSearchRefreshRequired: true,
            contextBuilderRefreshRequired: true,
          },
        };
      }

      const admission = evaluateLearningProposalEnvelope(proposalEnvelope, {
        ...cloneJson(admissionContext),
        activeRecords: (Array.isArray(admissionContext.activeRecords) ? admissionContext.activeRecords : []).concat(
          matchingTargetRecords
            .filter((record) => !isApplyDedupeMatch(record, proposal))
            .map((record) => ({
              recordId: record.passportMemoryId,
              agentId: proposal.agentId,
              canonicalAgentId: proposal.agentId,
              namespaceScopeId:
                nonEmptyString(record?.payload?.namespaceScopeId) ??
                nonEmptyString(record?.payload?.passportNamespaceId) ??
                proposal.namespaceScopeId,
              passportNamespaceId:
                nonEmptyString(record?.payload?.namespaceScopeId) ??
                nonEmptyString(record?.payload?.passportNamespaceId) ??
                proposal.namespaceScopeId,
              status: record.status,
              contentSha256: record.payload?.contentSha256 ?? record.payload?.value?.contentSha256 ?? null,
            }))
        ),
      });
      if (admission.decision !== "approved_auto") {
        return buildBlockedResult({
          proposal,
          operation,
          dryRun,
          reason: `self-learning bridge apply blocked: ${admission.reasons.join(" | ")}`,
          decision: admission.decision,
        });
      }

      const records = await writePassportMemories(
        proposal.agentId,
        buildMemoryRecordPayload(proposal, dryRun, createdAt, actorId)
      );
      const writtenRecordIds = records.map((record) => record.passportMemoryId).filter(Boolean);
      return {
        ok: true,
        failClosed: true,
        completed: true,
        blocked: false,
        previewOnly: false,
        mode: MEMORY_STABILITY_SELF_LEARNING_BRIDGE_MODE,
        operation,
        proposalId: proposal.proposalId,
        decision: admission.decision,
        dryRun,
        bridge: {
          adapterApiCalled: true,
          ledgerEventCreated: true,
          modelCalled: false,
          networkCalled: false,
          rawContentPersisted: false,
          dedupeHit: false,
        },
        receipt: buildReceipt({
          proposal,
          dryRun,
          operation,
          createdAt,
          completed: true,
          dedupeHit: false,
          recordIds: writtenRecordIds,
        }),
        records: {
          writtenRecordIds,
          revertedRecordIds: [],
          deniedRecordIds: [],
          records: records.map((record) => buildBridgeRecordView(record, proposal)),
        },
        context: {
          injectRecordIds: cloneJson(dryRun.contextEffects.injectRecordIds) ?? [],
          denyRecordIds: [],
          injectableRecordIds: records
            .filter((record) =>
              contextBuilderCanInjectLearningRecord(buildLearningContextRecord(record, proposal), proposal)
            )
            .map((record) => record.passportMemoryId),
          runtimeSearchRefreshRequired: true,
          contextBuilderRefreshRequired: true,
        },
      };
    }

    const alreadyRevertedRecords = matchingTargetRecords.filter((record) => isRevertDedupeMatch(record));
    if (alreadyRevertedRecords.length === targetRecordIds.length) {
      return {
        ok: true,
        failClosed: true,
        completed: true,
        blocked: false,
        previewOnly: false,
        mode: MEMORY_STABILITY_SELF_LEARNING_BRIDGE_MODE,
        operation,
        proposalId: proposal.proposalId,
        decision: "reverted",
        dryRun,
        bridge: {
          adapterApiCalled: true,
          ledgerEventCreated: true,
          modelCalled: false,
          networkCalled: false,
          rawContentPersisted: false,
          dedupeHit: true,
        },
        receipt: buildReceipt({
          proposal,
          dryRun,
          operation,
          createdAt,
          completed: true,
          dedupeHit: true,
          recordIds: targetRecordIds,
        }),
        records: {
          writtenRecordIds: [],
          revertedRecordIds: targetRecordIds,
          deniedRecordIds: cloneJson(dryRun.contextEffects.denyRecordIds) ?? [],
          records: alreadyRevertedRecords.map((record) => buildBridgeRecordView(record, proposal)),
        },
        context: {
          injectRecordIds: [],
          denyRecordIds: cloneJson(dryRun.contextEffects.denyRecordIds) ?? [],
          injectableRecordIds: [],
          runtimeSearchRefreshRequired: true,
          contextBuilderRefreshRequired: true,
        },
      };
    }

    const activeTargetRecords = matchingTargetRecords.filter((record) => nonEmptyString(record?.status) === "active");
    if (activeTargetRecords.length !== targetRecordIds.length) {
      return buildBlockedResult({
        proposal,
        operation,
        dryRun,
        reason: "self-learning bridge revert blocked: target records are missing or not in an active state",
        decision: "recovery_required",
      });
    }

    const reverted = await markPassportMemoriesReverted(proposal.agentId, targetRecordIds, {
      sourceWindowId: proposal.sourceWindowId,
      proposalId: proposal.proposalId,
      checkpointId: proposal.rollbackPlan.checkpointId,
      revertedByAgentId: actorId,
      recordedByWindowId: proposal.sourceWindowId,
      reason: "self_learning_bridge_revert",
      revertedAt: createdAt,
    });

    return {
      ok: true,
      failClosed: true,
      completed: true,
      blocked: false,
      previewOnly: false,
      mode: MEMORY_STABILITY_SELF_LEARNING_BRIDGE_MODE,
      operation,
      proposalId: proposal.proposalId,
      decision: "reverted",
      dryRun,
      bridge: {
        adapterApiCalled: true,
        ledgerEventCreated: true,
        modelCalled: false,
        networkCalled: false,
        rawContentPersisted: false,
        dedupeHit: false,
      },
      receipt: buildReceipt({
        proposal,
        dryRun,
        operation,
        createdAt,
        completed: true,
        dedupeHit: false,
        recordIds: reverted.revertedMemoryIds,
      }),
      records: {
        writtenRecordIds: [],
        revertedRecordIds: cloneJson(reverted.revertedMemoryIds) ?? [],
        deniedRecordIds: cloneJson(dryRun.contextEffects.denyRecordIds) ?? [],
        records: (Array.isArray(reverted.revertedRecords) ? reverted.revertedRecords : []).map((record) =>
          buildBridgeRecordView(record, proposal)
        ),
      },
      context: {
        injectRecordIds: [],
        denyRecordIds: cloneJson(dryRun.contextEffects.denyRecordIds) ?? [],
        injectableRecordIds: [],
        runtimeSearchRefreshRequired: true,
        contextBuilderRefreshRequired: true,
      },
    };
  });
}

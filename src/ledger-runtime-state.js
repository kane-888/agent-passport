import {
  cloneJson,
  createRecordId,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import { normalizeDidMethod } from "./protocol.js";

export function buildRuntimeBootstrapGate(_store, _agent, { contextBuilder = null } = {}) {
  const identitySnapshot = contextBuilder?.slots?.identitySnapshot || {};
  const profile = identitySnapshot.profile || {};
  const taskSnapshot = identitySnapshot.taskSnapshot || null;
  const ledgerCommitments = contextBuilder?.memoryLayers?.ledger?.commitments || [];
  const hasTruthSourceCommitment = ledgerCommitments.some(
    (entry) =>
      entry?.status !== "superseded" &&
      normalizeOptionalText(entry?.payload?.field) === "runtime_truth_source"
  );
  const checks = [
    {
      code: "task_snapshot_present",
      required: true,
      passed: Boolean(taskSnapshot?.snapshotId),
      message: taskSnapshot?.snapshotId ? "task snapshot 已就绪。" : "缺少 task snapshot。",
      evidence: {
        taskSnapshotId: taskSnapshot?.snapshotId ?? null,
      },
    },
    {
      code: "profile_name_present",
      required: true,
      passed: Boolean(normalizeOptionalText(profile.name)),
      message: normalizeOptionalText(profile.name) ? "profile.name 已就绪。" : "缺少 profile.name。",
      evidence: {
        name: normalizeOptionalText(profile.name) ?? null,
      },
    },
    {
      code: "profile_role_present",
      required: true,
      passed: Boolean(normalizeOptionalText(profile.role)),
      message: normalizeOptionalText(profile.role) ? "profile.role 已就绪。" : "缺少 profile.role。",
      evidence: {
        role: normalizeOptionalText(profile.role) ?? null,
      },
    },
    {
      code: "runtime_truth_source_commitment",
      required: false,
      passed: hasTruthSourceCommitment,
      message: hasTruthSourceCommitment
        ? "已存在 runtime truth-source commitment。"
        : "建议补 runtime truth-source commitment，明确 本地参考层 才是本地参考源。",
      evidence: {
        commitmentCount: ledgerCommitments.length,
      },
    },
  ];
  const missingRequired = checks.filter((check) => check.required && !check.passed);
  return {
    required: missingRequired.length > 0,
    checks,
    missingRequiredCodes: missingRequired.map((check) => check.code),
    recommendation: missingRequired.length > 0 ? "run_bootstrap" : "continue",
  };
}

export function buildRuntimeBootstrapGatePreview(
  store,
  agent,
  { latestAgentTaskSnapshot = null } = {}
) {
  const taskSnapshot =
    typeof latestAgentTaskSnapshot === "function"
      ? latestAgentTaskSnapshot(store, agent.agentId) ?? null
      : latestAgentTaskSnapshot ?? null;
  const profileName =
    normalizeOptionalText(agent?.displayName) ??
    normalizeOptionalText(agent?.identity?.profile?.name) ??
    null;
  const profileRole =
    normalizeOptionalText(agent?.role) ??
    normalizeOptionalText(agent?.identity?.profile?.role) ??
    null;
  const missingRequiredCodes = [];
  if (!taskSnapshot?.snapshotId) {
    missingRequiredCodes.push("task_snapshot_present");
  }
  if (!profileName) {
    missingRequiredCodes.push("profile_name_present");
  }
  if (!profileRole) {
    missingRequiredCodes.push("profile_role_present");
  }
  return {
    required: missingRequiredCodes.length > 0,
    checks: [
      {
        code: "task_snapshot_present",
        required: true,
        passed: Boolean(taskSnapshot?.snapshotId),
        message: taskSnapshot?.snapshotId ? "task snapshot 已就绪。" : "缺少 task snapshot。",
        evidence: {
          taskSnapshotId: taskSnapshot?.snapshotId ?? null,
        },
      },
      {
        code: "profile_name_present",
        required: true,
        passed: Boolean(profileName),
        message: profileName ? "profile.name 已就绪。" : "缺少 profile.name。",
        evidence: {
          name: profileName,
        },
      },
      {
        code: "profile_role_present",
        required: true,
        passed: Boolean(profileRole),
        message: profileRole ? "profile.role 已就绪。" : "缺少 profile.role。",
        evidence: {
          role: profileRole,
        },
      },
      {
        code: "runtime_truth_source_commitment",
        required: false,
        passed: false,
        message: "快速门禁预览不会重新扫描 truth-source commitment。",
        evidence: {
          previewOnly: true,
        },
      },
    ],
    missingRequiredCodes,
    recommendation: missingRequiredCodes.length > 0 ? "run_bootstrap" : "continue",
  };
}

export function buildAgentSessionStateView(state) {
  return cloneJson(state) ?? null;
}

export function buildAgentSessionStateRecord(
  agent,
  {
    existing = null,
    didMethod = null,
    currentDid = null,
    currentDidMethod = null,
    currentGoal = null,
    contextBuilder = null,
    driftCheck = null,
    run = null,
    queryState = null,
    negotiation = null,
    cognitiveState = null,
    compactBoundary = null,
    compactBoundaries = [],
    runtime = {},
    memoryCounts = null,
    residentGate = null,
    deviceRuntime = null,
    activeWindowIds = [],
    runtimeMemoryState = null,
    resumeBoundaryId = null,
    sourceWindowId = null,
    transitionReason = null,
  } = {}
) {
  const effectiveCognitiveState = cognitiveState || existing?.cognitiveState || null;
  const normalizedCompactBoundaries = Array.isArray(compactBoundaries) ? compactBoundaries : [];
  return {
    sessionStateId: existing?.sessionStateId || createRecordId("sess"),
    agentId: agent.agentId,
    didMethod: normalizeDidMethod(didMethod) || currentDidMethod || existing?.didMethod || null,
    did: currentDid,
    currentGoal:
      normalizeOptionalText(currentGoal) ??
      existing?.currentGoal ??
      runtime.taskSnapshot?.objective ??
      runtime.taskSnapshot?.title ??
      null,
    currentTaskSnapshotId: runtime.taskSnapshot?.snapshotId ?? existing?.currentTaskSnapshotId ?? null,
    latestRunId: run?.runId ?? existing?.latestRunId ?? null,
    latestRunStatus: normalizeOptionalText(run?.status) ?? existing?.latestRunStatus ?? null,
    latestVerificationValid:
      run?.verification?.valid != null
        ? Boolean(run.verification.valid)
        : existing?.latestVerificationValid ?? null,
    latestDriftScore: driftCheck?.driftScore ?? existing?.latestDriftScore ?? null,
    latestCompactBoundaryId:
      compactBoundary?.compactBoundaryId ??
      existing?.latestCompactBoundaryId ??
      normalizedCompactBoundaries.at(-1)?.compactBoundaryId ??
      null,
    latestResumeBoundaryId:
      normalizeOptionalText(resumeBoundaryId) ??
      contextBuilder?.slots?.resumeBoundary?.compactBoundaryId ??
      existing?.latestResumeBoundaryId ??
      null,
    latestQueryStateId:
      normalizeOptionalText(queryState?.queryStateId) ??
      existing?.latestQueryStateId ??
      null,
    latestNegotiationId:
      normalizeOptionalText(negotiation?.negotiationId) ??
      existing?.latestNegotiationId ??
      null,
    latestNegotiationDecision:
      normalizeOptionalText(negotiation?.decision) ??
      existing?.latestNegotiationDecision ??
      null,
    compactBoundaryCount: normalizedCompactBoundaries.length,
    activeWindowIds: cloneJson(activeWindowIds) ?? [],
    currentPermissionMode: agent.identity?.authorizationPolicy?.type || "governed",
    residentAgentId: residentGate?.residentAgentId ?? null,
    residentLockRequired: Boolean(residentGate?.required),
    localMode: deviceRuntime?.localMode,
    tokenBudgetState: {
      estimatedContextChars:
        contextBuilder?.compiledPrompt?.length ??
        existing?.tokenBudgetState?.estimatedContextChars ??
        0,
      estimatedContextTokens:
        contextBuilder?.slots?.queryBudget?.estimatedContextTokens ??
        existing?.tokenBudgetState?.estimatedContextTokens ??
        0,
      maxConversationTurns: runtime.policy?.maxConversationTurns ?? existing?.tokenBudgetState?.maxConversationTurns ?? null,
      maxContextChars: runtime.policy?.maxContextChars ?? existing?.tokenBudgetState?.maxContextChars ?? null,
      maxContextTokens: runtime.policy?.maxContextTokens ?? existing?.tokenBudgetState?.maxContextTokens ?? null,
      maxRecentConversationTurns:
        runtime.policy?.maxRecentConversationTurns ??
        existing?.tokenBudgetState?.maxRecentConversationTurns ??
        null,
      maxToolResults:
        runtime.policy?.maxToolResults ??
        existing?.tokenBudgetState?.maxToolResults ??
        null,
      maxQueryIterations:
        runtime.policy?.maxQueryIterations ??
        existing?.tokenBudgetState?.maxQueryIterations ??
        null,
      driftScoreLimit: runtime.policy?.driftScoreLimit ?? existing?.tokenBudgetState?.driftScoreLimit ?? null,
    },
    memoryCounts,
    queryState: queryState
      ? {
          agentId: queryState.agentId || agent.agentId,
          didMethod: queryState.didMethod || null,
          queryStateId: queryState.queryStateId || null,
          status: queryState.status || null,
          currentGoal: queryState.currentGoal || null,
          currentIteration: queryState.currentIteration ?? null,
          maxQueryIterations: queryState.maxQueryIterations ?? null,
          remainingIterations: queryState.remainingIterations ?? null,
          flags: cloneJson(queryState.flags) ?? [],
          recommendedActions: cloneJson(queryState.recommendedActions) ?? [],
          budget: cloneJson(queryState.budget) ?? null,
        }
      : cloneJson(existing?.queryState) ?? null,
    negotiation: negotiation
      ? {
          negotiationId: negotiation.negotiationId || null,
          interactionMode: negotiation.interactionMode || null,
          executionMode: negotiation.executionMode || null,
          requestedAction: negotiation.requestedAction || null,
          decision: negotiation.decision || null,
          shouldExecute: Boolean(negotiation.shouldExecute),
          riskLevel: negotiation.riskLevel || null,
        }
      : cloneJson(existing?.negotiation) ?? null,
    cognitiveState: effectiveCognitiveState
      ? {
          cognitiveStateId: effectiveCognitiveState.cognitiveStateId || null,
          mode: effectiveCognitiveState.mode || null,
          dominantStage: effectiveCognitiveState.dominantStage || null,
          continuityScore: effectiveCognitiveState.continuityScore ?? null,
          calibrationScore: effectiveCognitiveState.calibrationScore ?? null,
          recoveryReadinessScore: effectiveCognitiveState.recoveryReadinessScore ?? null,
          stageWeights: cloneJson(effectiveCognitiveState.stageWeights) ?? null,
          preferenceProfile: cloneJson(effectiveCognitiveState.preferenceProfile) ?? null,
          adaptation: cloneJson(effectiveCognitiveState.adaptation) ?? null,
          goalState: cloneJson(effectiveCognitiveState.goalState) ?? null,
          selfEvaluation: cloneJson(effectiveCognitiveState.selfEvaluation) ?? null,
          strategyProfile: cloneJson(effectiveCognitiveState.strategyProfile) ?? null,
          signals: cloneJson(effectiveCognitiveState.signals) ?? null,
        }
      : cloneJson(existing?.cognitiveState) ?? null,
    latestRuntimeMemoryStateId:
      normalizeOptionalText(runtimeMemoryState?.runtimeMemoryStateId) ??
      existing?.latestRuntimeMemoryStateId ??
      null,
    memoryHomeostasis: runtimeMemoryState
      ? {
          runtimeMemoryStateId: runtimeMemoryState.runtimeMemoryStateId ?? null,
          modelName: runtimeMemoryState.modelName ?? null,
          ctxTokens: runtimeMemoryState.ctxTokens ?? null,
          checkedMemories: runtimeMemoryState.checkedMemories ?? 0,
          conflictMemories: runtimeMemoryState.conflictMemories ?? 0,
          vT: runtimeMemoryState.vT ?? null,
          lT: runtimeMemoryState.lT ?? null,
          rPosT: runtimeMemoryState.rPosT ?? null,
          xT: runtimeMemoryState.xT ?? null,
          sT: runtimeMemoryState.sT ?? null,
          cT: runtimeMemoryState.cT ?? null,
          correctionLevel: runtimeMemoryState.correctionLevel ?? "none",
          placementStrategy: cloneJson(runtimeMemoryState.placementStrategy) ?? null,
          profile: cloneJson(runtimeMemoryState.profile) ?? null,
          memoryAnchors: cloneJson(runtimeMemoryState.memoryAnchors) ?? [],
          updatedAt: runtimeMemoryState.updatedAt ?? null,
        }
      : cloneJson(existing?.memoryHomeostasis) ?? null,
    transitionReason:
      normalizeOptionalText(transitionReason) ??
      (compactBoundary?.compactBoundaryId
        ? "checkpoint_rollover"
        : run?.status
          ? `runner_${run.status}`
          : existing?.transitionReason ?? null),
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? existing?.sourceWindowId ?? null,
    updatedAt: now(),
  };
}

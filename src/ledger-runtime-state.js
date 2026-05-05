import { cloneJson, normalizeOptionalText } from "./ledger-core-utils.js";

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

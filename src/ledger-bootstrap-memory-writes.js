import {
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
} from "./ledger-core-utils.js";
import {
  normalizePassportMemoryRecord,
} from "./ledger-passport-memory-record.js";

export function buildBootstrapProfileMemoryWrites(agent, payload = {}, { profileSnapshot = null } = {}) {
  const existingProfile = profileSnapshot?.fieldValues || {};
  const writes = [];
  const effectiveName = normalizeOptionalText(payload.displayName || payload.name) ?? normalizeOptionalText(agent.displayName) ?? null;
  const effectiveRole = normalizeOptionalText(payload.role) ?? normalizeOptionalText(agent.role) ?? null;
  const effectiveLongTermGoal =
    normalizeOptionalText(payload.longTermGoal || payload.long_term_goal) ??
    normalizeOptionalText(existingProfile.long_term_goal) ??
    null;
  const stablePreferences = normalizeTextList(payload.stablePreferences || payload.preferences);

  const profileFields = [
    {
      field: "name",
      kind: "name",
      value: effectiveName,
      shouldWrite:
        Boolean(normalizeOptionalText(payload.displayName || payload.name)) ||
        (!normalizeOptionalText(existingProfile.name) && Boolean(effectiveName)),
    },
    {
      field: "role",
      kind: "role",
      value: effectiveRole,
      shouldWrite:
        Boolean(normalizeOptionalText(payload.role)) ||
        (!normalizeOptionalText(existingProfile.role) && Boolean(effectiveRole)),
    },
    {
      field: "long_term_goal",
      kind: "long_term_goal",
      value: effectiveLongTermGoal,
      shouldWrite:
        Boolean(normalizeOptionalText(payload.longTermGoal || payload.long_term_goal)) ||
        (!normalizeOptionalText(existingProfile.long_term_goal) && Boolean(effectiveLongTermGoal)),
    },
  ];

  for (const field of profileFields) {
    if (!field.shouldWrite || !field.value) {
      continue;
    }
    writes.push(
      normalizePassportMemoryRecord(agent.agentId, {
        layer: "profile",
        kind: field.kind,
        summary: field.value,
        content: field.value,
        payload: {
          field: field.field,
          value: field.value,
          bootstrap: true,
        },
        tags: ["bootstrap", "profile", field.kind],
        sourceWindowId: payload.sourceWindowId,
        recordedByAgentId: payload.recordedByAgentId || agent.agentId,
        recordedByWindowId: payload.recordedByWindowId || payload.sourceWindowId,
      })
    );
  }

  if (
    (stablePreferences.length > 0 && !Array.isArray(existingProfile.stable_preferences)) ||
    normalizeTextList(payload.stablePreferences || payload.preferences).length > 0
  ) {
    writes.push(
      normalizePassportMemoryRecord(agent.agentId, {
        layer: "profile",
        kind: "preference",
        summary: stablePreferences.length > 0 ? `稳定偏好 ${stablePreferences.length} 条` : "稳定偏好",
        content: stablePreferences.join("\n"),
        payload: {
          field: "stable_preferences",
          value: stablePreferences,
          bootstrap: true,
        },
        tags: ["bootstrap", "profile", "preference"],
        sourceWindowId: payload.sourceWindowId,
        recordedByAgentId: payload.recordedByAgentId || agent.agentId,
        recordedByWindowId: payload.recordedByWindowId || payload.sourceWindowId,
      })
    );
  }

  return writes;
}

export function buildBootstrapWorkingMemoryWrites(agent, payload = {}) {
  const writes = [];
  const currentTask = normalizeOptionalText(payload.currentGoal || payload.objective || payload.title) ?? null;
  const nextAction = normalizeOptionalText(payload.nextAction) ?? null;
  const writeSpecs = [
    {
      field: "current_task",
      kind: "current_task",
      value: currentTask,
      tags: ["bootstrap", "working", "current_task"],
    },
    {
      field: "next_action",
      kind: "next_action",
      value: nextAction,
      tags: ["bootstrap", "working", "next_action"],
    },
  ];

  for (const spec of writeSpecs) {
    if (!spec.value) {
      continue;
    }
    writes.push(
      normalizePassportMemoryRecord(agent.agentId, {
        layer: "working",
        kind: spec.kind,
        summary: spec.value,
        content: spec.value,
        payload: {
          field: spec.field,
          value: spec.value,
          bootstrap: true,
        },
        tags: spec.tags,
        sourceWindowId: payload.sourceWindowId,
        recordedByAgentId: payload.recordedByAgentId || agent.agentId,
        recordedByWindowId: payload.recordedByWindowId || payload.sourceWindowId,
      })
    );
  }

  return writes;
}

export function buildBootstrapLedgerMemoryWrites(agent, payload = {}, { existingCommitments = [] } = {}) {
  const writes = [];
  const shouldWriteDefaultCommitment = normalizeBooleanFlag(payload.createDefaultCommitment, true);
  const activeCommitments = (Array.isArray(existingCommitments) ? existingCommitments : []).filter(
    (entry) =>
      entry.status !== "superseded" &&
      normalizeOptionalText(entry.payload?.field) === "runtime_truth_source"
  );
  const commitmentText =
    normalizeOptionalText(payload.commitmentText) ??
    "本地参考层 才是本地参考源；LLM 只是推理器，身份与关键承诺不得由聊天记录自行漂移。";

  if (shouldWriteDefaultCommitment && (activeCommitments.length === 0 || normalizeOptionalText(payload.commitmentText))) {
    writes.push(
      normalizePassportMemoryRecord(agent.agentId, {
        layer: "ledger",
        kind: "commitment",
        summary: "本地参考层 才是本地参考源",
        content: commitmentText,
        payload: {
          field: "runtime_truth_source",
          value: commitmentText,
          bootstrap: true,
        },
        tags: ["bootstrap", "ledger", "commitment"],
        sourceWindowId: payload.sourceWindowId,
        recordedByAgentId: payload.recordedByAgentId || agent.agentId,
        recordedByWindowId: payload.recordedByWindowId || payload.sourceWindowId,
      })
    );
  }

  return writes;
}

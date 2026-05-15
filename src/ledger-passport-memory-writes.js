import {
  cloneJson,
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  extractClaimValueFromText,
} from "./ledger-claim-extraction.js";
import {
  extractStablePreferences,
} from "./ledger-cognitive-state.js";
import {
  buildProfileMemorySnapshot,
} from "./ledger-profile-memory-snapshot.js";
import {
  normalizePassportMemoryRecord,
} from "./ledger-passport-memory-record.js";
import {
  isPassportMemoryActive,
  normalizePassportMemoryLayer,
} from "./ledger-passport-memory-rules.js";
import {
  applyPassportMemorySupersession,
} from "./ledger-passport-memory-supersession.js";

const DEFAULT_WORKING_MEMORY_CHECKPOINT_THRESHOLD = 12;
const DEFAULT_WORKING_MEMORY_RECENT_WINDOW = 6;

function requireDependency(deps = {}, name) {
  const dependency = deps?.[name];
  if (typeof dependency !== "function") {
    throw new TypeError(`${name} dependency is required`);
  }
  return dependency;
}

export function extractExplicitPreferencesFromText(text = null) {
  const normalized = normalizeOptionalText(text);
  if (!normalized) {
    return {
      preferenceKeys: [],
      explicitRules: [],
    };
  }

  const rules = [];
  const addRule = (key, statement) => {
    if (!key || !statement) return;
    rules.push({ key, statement });
  };

  const directPatterns = [
    { key: "prefer_local_first", regex: /(优先|尽量|最好).{0,8}(本地优先|本地|离线)/u },
    { key: "prefer_risk_confirmation", regex: /(先确认|确认后执行|先复核|谨慎处理)/u },
    { key: "prefer_checkpoint_resume", regex: /(先恢复上下文|恢复后再|先续上|checkpoint|resume)/iu },
    { key: "prefer_compact_context", regex: /(简洁|精简|压缩|不要太长)/u },
  ];
  for (const pattern of directPatterns) {
    if (pattern.regex.test(normalized)) {
      addRule(pattern.key, normalized);
    }
  }

  const explicitRules = rules.slice(0, 6);
  return {
    preferenceKeys: Array.from(new Set(explicitRules.map((item) => item.key))),
    explicitRules,
  };
}

export function writeExplicitPreferenceMemories(
  store,
  agent,
  explicitPreferences,
  { sourceWindowId = null } = {},
  deps = {}
) {
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const applyPassportMemoryConflictTracking = requireDependency(deps, "applyPassportMemoryConflictTracking");
  const keys = normalizeTextList(explicitPreferences?.preferenceKeys || []);
  if (!keys.length) {
    return [];
  }
  const profileSnapshot = buildProfileMemorySnapshot(store, agent, { listAgentPassportMemories });
  const currentStable = extractStablePreferences(profileSnapshot.fieldValues);
  const merged = Array.from(new Set([...currentStable, ...keys])).slice(-12);
  const record = normalizePassportMemoryRecord(agent.agentId, {
    layer: "profile",
    kind: "preference",
    summary: `显式偏好 ${keys.length} 条`,
    content: merged.join("\n"),
    payload: {
      field: "stable_preferences",
      value: merged,
      explicitRules: cloneJson(explicitPreferences?.explicitRules) ?? [],
      source: "explicit_user_signal",
    },
    tags: ["profile", "preference", "explicit_signal"],
    sourceWindowId,
    confidence: 0.92,
    salience: 0.88,
  });
  applyPassportMemoryConflictTracking(store, agent.agentId, record);
  applyPassportMemorySupersession(store, agent.agentId, record);
  store.passportMemories.push(record);
  return [record];
}

export function compactConversationToPassportMemories(_store, agent, payload = {}) {
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  const writes = [];
  const writeConversationTurns = normalizeBooleanFlag(payload.writeConversationTurns, true);

  for (const [index, turn] of turns.entries()) {
    const role = normalizeOptionalText(turn?.role) ?? "unknown";
    const content = normalizeOptionalText(turn?.content) ?? "";
    if (!content) {
      continue;
    }

    if (writeConversationTurns) {
      writes.push(
        normalizePassportMemoryRecord(agent.agentId, {
          layer: "working",
          kind: "conversation_turn",
          summary: `${role} turn ${index + 1}`,
          content,
          payload: { role, turnIndex: index },
          tags: ["conversation", role],
          sourceWindowId: payload.sourceWindowId,
          recordedByAgentId: payload.recordedByAgentId || agent.agentId,
          recordedByWindowId: payload.recordedByWindowId || payload.sourceWindowId,
        })
      );
    }

    for (const rawLine of content.split(/\n+/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const mappings = [
        { layer: "profile", kind: "name", field: "name", patterns: [/^(?:名字|name)[:：]\s*(.+)$/i] },
        { layer: "profile", kind: "role", field: "role", patterns: [/^(?:角色|role)[:：]\s*(.+)$/i] },
        { layer: "profile", kind: "long_term_goal", field: "long_term_goal", patterns: [/^(?:长期目标|goal)[:：]\s*(.+)$/i] },
        { layer: "profile", kind: "preference", field: "preference", patterns: [/^(?:偏好|preference)[:：]\s*(.+)$/i] },
        { layer: "working", kind: "current_task", field: "current_task", patterns: [/^(?:当前任务|task)[:：]\s*(.+)$/i] },
        { layer: "working", kind: "next_action", field: "next_action", patterns: [/^(?:下一步|next)[:：]\s*(.+)$/i] },
        { layer: "episodic", kind: "result", field: "result", patterns: [/^(?:结果|完成|outcome)[:：]\s*(.+)$/i] },
        { layer: "episodic", kind: "relationship", field: "relationship", patterns: [/^(?:关系变化|relationship)[:：]\s*(.+)$/i] },
        { layer: "ledger", kind: "commitment", field: "commitment", patterns: [/^(?:承诺|commitment)[:：]\s*(.+)$/i] },
      ];

      for (const mapping of mappings) {
        const matched = extractClaimValueFromText(line, mapping.patterns);
        if (!matched) {
          continue;
        }

        writes.push(
          normalizePassportMemoryRecord(agent.agentId, {
            layer: mapping.layer,
            kind: mapping.kind,
            summary: matched,
            content: matched,
            payload: { field: mapping.field, value: matched, compactedFromRole: role, line },
            tags: ["compacted", mapping.layer, mapping.kind],
            sourceWindowId: payload.sourceWindowId,
            recordedByAgentId: payload.recordedByAgentId || agent.agentId,
            recordedByWindowId: payload.recordedByWindowId || payload.sourceWindowId,
          })
        );
      }
    }
  }

  return writes;
}

export function buildToolResultPassportMemories(agentId, toolResults = [], payload = {}) {
  if (!Array.isArray(toolResults)) {
    return [];
  }

  return toolResults
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const tool = normalizeOptionalText(entry.tool || entry.name) ?? "tool";
      const result = normalizeOptionalText(entry.result || entry.output || entry.summary) ?? null;
      if (!tool && !result) {
        return null;
      }

      return normalizePassportMemoryRecord(agentId, {
        layer: "working",
        kind: "tool_result",
        summary: `${tool} result`,
        content: result,
        payload: {
          tool,
          turnIndex: index,
        },
        tags: ["tool_result", tool],
        sourceWindowId: payload.sourceWindowId,
        recordedByAgentId: payload.recordedByAgentId || agentId,
        recordedByWindowId: payload.recordedByWindowId || payload.sourceWindowId,
      });
    })
    .filter(Boolean);
}

export function summarizePassportMemoryWrites(writes = []) {
  const byLayer = {};
  const byKind = {};
  for (const record of writes) {
    const layer = normalizePassportMemoryLayer(record?.layer);
    const kind = normalizeOptionalText(record?.kind) ?? "note";
    byLayer[layer] = (byLayer[layer] || 0) + 1;
    byKind[kind] = (byKind[kind] || 0) + 1;
  }

  return {
    writeCount: writes.length,
    byLayer,
    byKind,
    passportMemoryIds: writes.map((item) => item.passportMemoryId).filter(Boolean),
  };
}

export function buildWorkingMemoryCheckpoint(
  store,
  agent,
  {
    currentGoal = null,
    sourceWindowId = null,
    recordedByAgentId = null,
    recordedByWindowId = null,
    threshold = DEFAULT_WORKING_MEMORY_CHECKPOINT_THRESHOLD,
    retainCount = DEFAULT_WORKING_MEMORY_RECENT_WINDOW,
  } = {},
  deps = {}
) {
  const appendEvent = requireDependency(deps, "appendEvent");
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const normalizedThreshold = Math.max(1, Math.floor(toFiniteNumber(threshold, DEFAULT_WORKING_MEMORY_CHECKPOINT_THRESHOLD)));
  const normalizedRetainCount = Math.max(1, Math.floor(toFiniteNumber(retainCount, DEFAULT_WORKING_MEMORY_RECENT_WINDOW)));
  const activeWorkingEntries = listAgentPassportMemories(store, agent.agentId, { layer: "working" }).filter(
    (entry) => isPassportMemoryActive(entry)
  );
  const rolloverCandidates = activeWorkingEntries.filter((entry) => ["conversation_turn", "tool_result"].includes(entry.kind));
  const effectiveRetainCount = Math.min(normalizedRetainCount, rolloverCandidates.length || normalizedRetainCount);

  if (rolloverCandidates.length <= normalizedThreshold) {
    return {
      triggered: false,
      threshold: normalizedThreshold,
      retainCount: effectiveRetainCount,
      candidateCount: rolloverCandidates.length,
      activeWorkingCount: activeWorkingEntries.length,
    };
  }

  const archivedEntries = rolloverCandidates.slice(0, Math.max(0, rolloverCandidates.length - effectiveRetainCount));
  const retainedEntries = rolloverCandidates.slice(-effectiveRetainCount);
  if (archivedEntries.length === 0) {
    return {
      triggered: false,
      threshold: normalizedThreshold,
      retainCount: effectiveRetainCount,
      candidateCount: rolloverCandidates.length,
      activeWorkingCount: activeWorkingEntries.length,
    };
  }

  for (const entry of archivedEntries) {
    entry.status = "superseded";
  }

  const archivedKinds = [...new Set(archivedEntries.map((entry) => entry.kind).filter(Boolean))];
  const checkpointRecord = normalizePassportMemoryRecord(agent.agentId, {
    layer: "working",
    kind: "checkpoint_summary",
    summary: `working checkpoint：归档 ${archivedEntries.length} 条`,
    content: [
      currentGoal ? `当前目标：${currentGoal}` : null,
      `已归档 ${archivedEntries.length} 条 working entries`,
      retainedEntries.length > 0 ? `保留最近 ${retainedEntries.length} 条` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    payload: {
      currentGoal: normalizeOptionalText(currentGoal) ?? null,
      archivedCount: archivedEntries.length,
      retainedCount: retainedEntries.length,
      archivedMemoryIds: archivedEntries.map((entry) => entry.passportMemoryId),
      retainedMemoryIds: retainedEntries.map((entry) => entry.passportMemoryId),
      archivedKinds,
      threshold: normalizedThreshold,
      retainCount: effectiveRetainCount,
    },
    tags: ["checkpoint", "working", "rollover", ...archivedKinds],
    sourceWindowId,
    recordedByAgentId: normalizeOptionalText(recordedByAgentId) ?? agent.agentId,
    recordedByWindowId: normalizeOptionalText(recordedByWindowId || sourceWindowId) ?? null,
  });
  store.passportMemories.push(checkpointRecord);

  appendEvent(store, "working_memory_checkpointed", {
    agentId: agent.agentId,
    checkpointMemoryId: checkpointRecord.passportMemoryId,
    archivedCount: archivedEntries.length,
    retainedCount: retainedEntries.length,
    threshold: normalizedThreshold,
    sourceWindowId: normalizeOptionalText(sourceWindowId) ?? null,
  });

  const activeWorkingCountAfter = listAgentPassportMemories(store, agent.agentId, { layer: "working" }).filter(
    (entry) => isPassportMemoryActive(entry)
  ).length;

  return {
    triggered: true,
    threshold: normalizedThreshold,
    retainCount: effectiveRetainCount,
    candidateCount: rolloverCandidates.length,
    archivedCount: archivedEntries.length,
    retainedCount: retainedEntries.length,
    archivedMemoryIds: archivedEntries.map((entry) => entry.passportMemoryId),
    retainedMemoryIds: retainedEntries.map((entry) => entry.passportMemoryId),
    archivedKinds,
    checkpointMemoryId: checkpointRecord.passportMemoryId,
    checkpoint: cloneJson(checkpointRecord) ?? null,
    activeWorkingCount: activeWorkingEntries.length,
    activeWorkingCountAfter,
  };
}

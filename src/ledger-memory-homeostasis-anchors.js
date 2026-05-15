import {
  cloneJson,
  createRecordId,
  hashJson,
  normalizeComparableText,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import {
  normalizeMemoryAnchorRecord,
} from "./memory-homeostasis.js";
import {
  summarizeMemoryHomeostasisText,
} from "./ledger-runtime-memory-homeostasis.js";

export function normalizeMemoryHomeostasisCorrectionLevel(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (["strong", "severe", "critical", "3", "level3", "level_3"].includes(normalized)) {
    return "strong";
  }
  if (["medium", "moderate", "2", "level2", "level_2"].includes(normalized)) {
    return "medium";
  }
  if (["light", "minor", "1", "level1", "level_1"].includes(normalized)) {
    return "light";
  }
  return "none";
}

export function buildMemoryHomeostasisProbeQuestion(label = null, source = null) {
  const normalizedLabel = normalizeOptionalText(label) ?? "这条关键记忆";
  const normalizedSource = normalizeOptionalText(source) ?? "memory";
  return `请仅根据当前上下文回忆 ${normalizedSource} 中“${normalizedLabel}”的关键内容。`;
}

export function buildTaskSnapshotMemoryHomeostasisAnchors(taskSnapshot = null, correctionLevel = "none") {
  if (!taskSnapshot || typeof taskSnapshot !== "object") {
    return [];
  }
  const snapshotId = normalizeOptionalText(taskSnapshot.snapshotId) ?? createRecordId("task");
  const anchors = [];
  const objective = summarizeMemoryHomeostasisText(taskSnapshot.objective || taskSnapshot.title, 200);
  const nextAction = summarizeMemoryHomeostasisText(taskSnapshot.nextAction, 180);
  if (objective) {
    anchors.push(
      normalizeMemoryAnchorRecord({
        memoryId: `task:${snapshotId}:objective`,
        content: objective,
        expectedValue: objective,
        importanceWeight: 1.6,
        source: "task_snapshot",
        insertedPosition: correctionLevel === "none" ? "middle" : "tail",
        probeQuestion: buildMemoryHomeostasisProbeQuestion("当前任务目标", "task snapshot"),
        authorityRank: 1,
        metadata: {
          snapshotId,
          field: "objective",
        },
      })
    );
  }
  if (nextAction) {
    anchors.push(
      normalizeMemoryAnchorRecord({
        memoryId: `task:${snapshotId}:next_action`,
        content: nextAction,
        expectedValue: nextAction,
        importanceWeight: 1.45,
        source: "task_snapshot",
        insertedPosition: "tail",
        probeQuestion: buildMemoryHomeostasisProbeQuestion("下一步", "task snapshot"),
        authorityRank: 0.96,
        metadata: {
          snapshotId,
          field: "next_action",
        },
      })
    );
  }
  return anchors;
}

export function buildCurrentGoalMemoryHomeostasisAnchor(currentGoal = null, correctionLevel = "none") {
  const goal = summarizeMemoryHomeostasisText(currentGoal, 200);
  if (!goal) {
    return null;
  }
  return normalizeMemoryAnchorRecord({
    memoryId: `goal:${hashJson(goal).slice(0, 12)}`,
    content: goal,
    expectedValue: goal,
    importanceWeight: 1.5,
    source: "current_goal",
    insertedPosition: correctionLevel === "none" ? "middle" : "tail",
    probeQuestion: buildMemoryHomeostasisProbeQuestion("当前目标", "goal"),
    authorityRank: 0.98,
  });
}

export function buildPassportMemoryHomeostasisAnchor(
  entry,
  {
    source = null,
    defaultPosition = "middle",
    tailBias = false,
    importanceWeight = 1,
  } = {}
) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const memoryId = normalizeOptionalText(entry.passportMemoryId) ?? createRecordId("anchor");
  const field = normalizeOptionalText(entry.payload?.field || entry.kind || entry.summary) ?? null;
  const content =
    summarizeMemoryHomeostasisText(entry.payload?.value, 180) ??
    summarizeMemoryHomeostasisText(entry.summary, 180) ??
    summarizeMemoryHomeostasisText(entry.content, 180) ??
    null;
  if (!content) {
    return null;
  }
  return normalizeMemoryAnchorRecord({
    memoryId,
    content,
    expectedValue: content,
    importanceWeight,
    source: normalizeOptionalText(source) ?? entry.layer ?? "passport_memory",
    insertedPosition: tailBias ? "tail" : defaultPosition,
    probeQuestion: buildMemoryHomeostasisProbeQuestion(field || entry.title || entry.kind, source || entry.layer),
    authorityRank:
      entry.layer === "profile" || entry.layer === "semantic"
        ? 0.88
        : entry.layer === "working"
          ? 0.78
          : 0.68,
    conflictState: entry.conflictState && typeof entry.conflictState === "object" ? cloneJson(entry.conflictState) : null,
    metadata: {
      field,
      layer: entry.layer ?? null,
      kind: entry.kind ?? null,
      recordedAt: entry.recordedAt ?? null,
    },
  });
}

export function mergeMemoryHomeostasisAnchors(anchors = [], previousRuntimeState = null) {
  const previousAnchors = new Map(
    (previousRuntimeState?.memoryAnchors || [])
      .map((anchor) => normalizeMemoryAnchorRecord(anchor))
      .map((anchor) => [anchor.memoryId, anchor])
  );
  const merged = [];
  const seen = new Set();
  for (const anchor of anchors) {
    const normalized = normalizeMemoryAnchorRecord(anchor);
    const dedupeKey =
      normalized.memoryId ||
      `${normalized.source}:${normalizeComparableText(normalized.expectedValue || normalized.content || "")}`;
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    const previous = previousAnchors.get(normalized.memoryId) ?? null;
    merged.push(
      previous
        ? {
            ...normalized,
            lastVerifiedAt: previous.lastVerifiedAt ?? normalized.lastVerifiedAt,
            lastVerifiedOk:
              previous.lastVerifiedOk != null ? previous.lastVerifiedOk : normalized.lastVerifiedOk,
          }
        : normalized
    );
  }
  return merged;
}

export function verifyMemoryHomeostasisAnchorsAgainstPrompt(anchors = [], compiledPrompt = "", verifiedAt = now()) {
  const normalizedPrompt = normalizeComparableText(compiledPrompt);
  return (anchors || []).map((anchor) => {
    const normalizedAnchor = normalizeMemoryAnchorRecord(anchor);
    const expected = normalizeComparableText(normalizedAnchor.expectedValue || normalizedAnchor.content || "");
    const verified = expected ? normalizedPrompt.includes(expected) : false;
    return {
      ...normalizedAnchor,
      lastVerifiedAt: verifiedAt,
      lastVerifiedOk: verified,
    };
  });
}

function text(value) {
  return String(value ?? "").trim();
}

export function createBlockedItem(
  id,
  label,
  detail,
  {
    actual = null,
    expected = null,
    source = null,
    nextAction = null,
    nextActionSummary = null,
    rerunCommand = null,
    machineReadableCommand = null,
  } = {}
) {
  return {
    id,
    label,
    detail,
    actual,
    expected,
    source,
    nextAction,
    nextActionSummary,
    rerunCommand,
    machineReadableCommand,
  };
}

export function adoptBlockedItems(
  entries = [],
  {
    source = null,
    nextAction = null,
    nextActionSummary = null,
    rerunCommand = null,
    machineReadableCommand = null,
  } = {}
) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => text(entry?.id))
    .map((entry) =>
      createBlockedItem(entry.id, entry.label, entry.detail, {
        actual: entry?.actual ?? null,
        expected: entry?.expected ?? null,
        source: entry?.source || source,
        nextAction: entry?.nextAction || nextAction,
        nextActionSummary: entry?.nextActionSummary || nextActionSummary,
        rerunCommand: entry?.rerunCommand || rerunCommand,
        machineReadableCommand: entry?.machineReadableCommand || machineReadableCommand,
      })
    );
}

export function finalizeBlockedOutcome({
  blockedBy = [],
  nextActionCandidates = [],
  fallbackNextAction = null,
} = {}) {
  const normalizedBlockedBy = (Array.isArray(blockedBy) ? blockedBy : []).filter((entry) => text(entry?.id));
  const firstBlocker = normalizedBlockedBy[0] || null;
  const nextAction =
    [firstBlocker?.nextAction, ...(Array.isArray(nextActionCandidates) ? nextActionCandidates : []), fallbackNextAction]
      .map((entry) => text(entry))
      .find(Boolean) || null;

  return {
    blockedBy: normalizedBlockedBy,
    firstBlocker,
    nextAction,
  };
}

export function formatOperatorSummary({
  firstBlocker = null,
  nextAction = null,
  readySummary = "当前检查已通过。",
  blockedSummary = "当前检查未通过。",
} = {}) {
  if (!firstBlocker) {
    return readySummary;
  }

  const parts = [
    text(firstBlocker.label) ? `阻塞项：${text(firstBlocker.label)}` : null,
    text(firstBlocker.detail) ? `原因：${text(firstBlocker.detail)}` : text(blockedSummary) || null,
    text(nextAction) ? `下一步：${text(nextAction)}` : null,
  ].filter(Boolean);

  return parts.join("。");
}

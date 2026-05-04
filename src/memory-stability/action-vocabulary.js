export const MEMORY_STABILITY_CORRECTION_LEVELS = Object.freeze(["none", "light", "medium", "strong"]);

export const MEMORY_STABILITY_ACTION_CATALOG = Object.freeze({
  continue_monitoring: Object.freeze({
    kind: "monitor",
    sideEffect: "none",
    inputContentPolicy: "none",
  }),
  reanchor_key_memories_near_prompt_end: Object.freeze({
    kind: "placement",
    sideEffect: "prompt_layout",
    inputContentPolicy: "hash_only_refs",
  }),
  raise_memory_injection_priority: Object.freeze({
    kind: "placement",
    sideEffect: "prompt_layout",
    inputContentPolicy: "hash_only_refs",
  }),
  rewrite_working_memory_summary: Object.freeze({
    kind: "summary",
    sideEffect: "runtime_state",
    inputContentPolicy: "sanitized_summary_only",
  }),
  compress_low_value_history: Object.freeze({
    kind: "compression",
    sideEffect: "runtime_state",
    inputContentPolicy: "sanitized_summary_only",
  }),
  reload_authoritative_memory_store: Object.freeze({
    kind: "authoritative_reload",
    sideEffect: "authoritative_store",
    inputContentPolicy: "hash_only_refs",
  }),
  resolve_conflicts_and_refresh_runtime_state: Object.freeze({
    kind: "conflict_resolution",
    sideEffect: "runtime_state",
    inputContentPolicy: "hash_only_refs",
  }),
});

export const MEMORY_STABILITY_ACTIONS = Object.freeze(Object.keys(MEMORY_STABILITY_ACTION_CATALOG));

export const MEMORY_STABILITY_CORRECTION_ACTIONS_BY_LEVEL = Object.freeze({
  none: Object.freeze(["continue_monitoring"]),
  light: Object.freeze([
    "reanchor_key_memories_near_prompt_end",
    "raise_memory_injection_priority",
  ]),
  medium: Object.freeze([
    "reanchor_key_memories_near_prompt_end",
    "raise_memory_injection_priority",
    "rewrite_working_memory_summary",
    "compress_low_value_history",
  ]),
  strong: Object.freeze([
    "reanchor_key_memories_near_prompt_end",
    "raise_memory_injection_priority",
    "rewrite_working_memory_summary",
    "compress_low_value_history",
    "reload_authoritative_memory_store",
    "resolve_conflicts_and_refresh_runtime_state",
  ]),
});

export const MEMORY_STABILITY_PLACEMENT_ACTIONS = Object.freeze({
  standard_reanchor_policy: Object.freeze({
    reason: "default",
  }),
  avoid_middle_placement: Object.freeze({
    reason: "middle_drop_risk",
  }),
  increase_reorder_frequency: Object.freeze({
    reason: "low_position_robustness",
  }),
  compress_before_next_turn: Object.freeze({
    reason: "high_context_load",
  }),
  reduce_memory_density: Object.freeze({
    reason: "low_context_collapse_resistance",
  }),
  compress_early_and_keep_anchor_density_low: Object.freeze({
    reason: "model_specific_hint",
  }),
});

export const MEMORY_STABILITY_PLACEMENT_ACTION_VALUES = Object.freeze(Object.keys(MEMORY_STABILITY_PLACEMENT_ACTIONS));

export function normalizeMemoryStabilityCorrectionLevel(value, fallback = "none") {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (MEMORY_STABILITY_CORRECTION_LEVELS.includes(normalized)) {
    return normalized;
  }
  return MEMORY_STABILITY_CORRECTION_LEVELS.includes(fallback) ? fallback : "none";
}

export function getMemoryStabilityCorrectionActions(level) {
  const normalizedLevel = normalizeMemoryStabilityCorrectionLevel(level);
  return [...MEMORY_STABILITY_CORRECTION_ACTIONS_BY_LEVEL[normalizedLevel]];
}

export function isMemoryStabilityCorrectionAction(action) {
  return Object.hasOwn(MEMORY_STABILITY_ACTION_CATALOG, action);
}

export function isMemoryStabilityPromptLayoutAction(action) {
  return MEMORY_STABILITY_ACTION_CATALOG[action]?.sideEffect === "prompt_layout";
}

export function filterMemoryStabilityPromptLayoutActions(actions = []) {
  return (Array.isArray(actions) ? actions : []).filter((action) => isMemoryStabilityPromptLayoutAction(action));
}

export function memoryStabilityActionRequiresMemoryRefs(action) {
  return MEMORY_STABILITY_ACTION_CATALOG[action]?.inputContentPolicy === "hash_only_refs";
}

export function getMemoryStabilityActionInputContentPolicy(action) {
  const policy = MEMORY_STABILITY_ACTION_CATALOG[action]?.inputContentPolicy;
  if (policy === "hash_only_refs") {
    return "hash_only";
  }
  if (policy === "sanitized_summary_only") {
    return "sanitized_summary_only";
  }
  return "none";
}

export function assertUniqueMemoryStabilityActionVocabulary() {
  const catalogActions = Object.keys(MEMORY_STABILITY_ACTION_CATALOG);
  const allLevelActions = Object.values(MEMORY_STABILITY_CORRECTION_ACTIONS_BY_LEVEL).flat();
  const duplicateCatalogActions = catalogActions.filter((action, index) => catalogActions.indexOf(action) !== index);
  const unknownLevelActions = allLevelActions.filter((action) => !isMemoryStabilityCorrectionAction(action));
  const levelsWithDuplicates = Object.entries(MEMORY_STABILITY_CORRECTION_ACTIONS_BY_LEVEL)
    .filter(([, actions]) => new Set(actions).size !== actions.length)
    .map(([level]) => level);
  const missingLevels = MEMORY_STABILITY_CORRECTION_LEVELS.filter(
    (level) => !Array.isArray(MEMORY_STABILITY_CORRECTION_ACTIONS_BY_LEVEL[level])
  );

  if (
    duplicateCatalogActions.length > 0 ||
    unknownLevelActions.length > 0 ||
    levelsWithDuplicates.length > 0 ||
    missingLevels.length > 0
  ) {
    return {
      ok: false,
      duplicateCatalogActions,
      unknownLevelActions,
      levelsWithDuplicates,
      missingLevels,
    };
  }

  return {
    ok: true,
    actionCount: catalogActions.length,
    levels: [...MEMORY_STABILITY_CORRECTION_LEVELS],
  };
}

import {
  cloneJson,
  createRecordId,
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  buildLocalReasonerProfileSummary,
  buildDefaultLocalReasonerProfileLabel,
  DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL,
  DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
  normalizeLocalReasonerProfileRecord,
  normalizeRuntimeReasonerProvider,
  normalizeRuntimeLocalReasonerConfig,
  resolveInspectableRuntimeLocalReasonerConfig,
  sanitizeRuntimeLocalReasonerConfigForProfile,
} from "./ledger-device-runtime.js";
import {
  buildDefaultDeviceLocalReasonerTargetConfig,
  localReasonerNeedsDefaultMigration,
} from "./ledger-local-reasoner-defaults.js";

export const DEFAULT_LOCAL_REASONER_PROFILE_LIMIT = 12;

function compareLocalReasonerRestoreCandidate(left, right) {
  const leftHealth = left?.health || {};
  const rightHealth = right?.health || {};
  const leftRestorable = leftHealth.restorable ? 1 : 0;
  const rightRestorable = rightHealth.restorable ? 1 : 0;
  if (leftRestorable !== rightRestorable) {
    return rightRestorable - leftRestorable;
  }
  const byHealthyAt = (rightHealth.lastHealthyAt || "").localeCompare(leftHealth.lastHealthyAt || "");
  if (byHealthyAt !== 0) {
    return byHealthyAt;
  }
  const byActivated = (right.lastActivatedAt || "").localeCompare(left.lastActivatedAt || "");
  if (byActivated !== 0) {
    return byActivated;
  }
  const byUseCount = Number(right.useCount || 0) - Number(left.useCount || 0);
  if (byUseCount !== 0) {
    return byUseCount;
  }
  return (right.updatedAt || "").localeCompare(left.updatedAt || "");
}

export function buildLocalReasonerRestoreCandidatesFromProfiles(
  profiles = [],
  { limit = DEFAULT_LOCAL_REASONER_PROFILE_LIMIT, profileId = null, profileIds = [] } = {}
) {
  const requestedProfileIds = normalizeTextList([
    normalizeOptionalText(profileId),
    ...normalizeTextList(profileIds),
  ]);
  const requestedProfileIdSet = requestedProfileIds.length > 0 ? new Set(requestedProfileIds) : null;
  const scopedProfiles = requestedProfileIdSet
    ? (Array.isArray(profiles) ? profiles : []).filter((entry) => requestedProfileIdSet.has(normalizeOptionalText(entry?.profileId) ?? ""))
    : (Array.isArray(profiles) ? profiles : []);
  const summaries = scopedProfiles.map((entry) => buildLocalReasonerProfileSummary(entry));
  const sorted = summaries.sort(compareLocalReasonerRestoreCandidate);
  const cappedLimit = Math.max(1, Math.floor(toFiniteNumber(limit, DEFAULT_LOCAL_REASONER_PROFILE_LIMIT)));
  return {
    listedAt: now(),
    restoreCandidates: sorted.slice(0, cappedLimit).map((entry, index) => ({
      ...entry,
      rank: index + 1,
      recommended: index === 0 && Boolean(entry?.health?.restorable),
    })),
    counts: {
      total: sorted.length,
      restorable: sorted.filter((entry) => entry?.health?.restorable).length,
    },
  };
}

export function buildLocalReasonerProfileList(
  profiles = [],
  {
    limit = DEFAULT_LOCAL_REASONER_PROFILE_LIMIT,
    profileId = null,
    profileIds = [],
    nowImpl = now,
  } = {}
) {
  const profileList = Array.isArray(profiles) ? profiles : [];
  const requestedProfileIds = normalizeTextList([
    normalizeOptionalText(profileId),
    ...normalizeTextList(profileIds),
  ]);
  const requestedProfileIdSet = requestedProfileIds.length > 0 ? new Set(requestedProfileIds) : null;
  const scopedProfiles = requestedProfileIdSet
    ? profileList.filter((entry) => requestedProfileIdSet.has(normalizeOptionalText(entry?.profileId) ?? ""))
    : profileList;
  const cappedLimit = Math.max(1, Math.floor(toFiniteNumber(limit, DEFAULT_LOCAL_REASONER_PROFILE_LIMIT)));
  const sorted = [...scopedProfiles].sort((left, right) => (right?.updatedAt || "").localeCompare(left?.updatedAt || ""));
  return {
    listedAt: nowImpl(),
    profiles: sorted.slice(0, cappedLimit).map((entry) => buildLocalReasonerProfileSummary(entry)),
    counts: {
      total: sorted.length,
    },
  };
}

export function resolveLocalReasonerProfileRecord(profiles = [], profileId) {
  const normalizedId = normalizeOptionalText(profileId);
  if (!normalizedId) {
    throw new Error("profileId is required");
  }
  const profile = (Array.isArray(profiles) ? profiles : []).find((entry) => entry?.profileId === normalizedId);
  if (!profile) {
    throw new Error(`Unknown local reasoner profile: ${normalizedId}`);
  }
  return {
    normalizedId,
    profile,
  };
}

export function buildLocalReasonerProfileLoadResult(
  profile = {},
  {
    includeProfile = true,
    nowImpl = now,
  } = {}
) {
  return {
    loadedAt: nowImpl(),
    summary: buildLocalReasonerProfileSummary(profile),
    profile: includeProfile ? cloneJson(profile) : null,
  };
}

export function resolveLocalReasonerRestoreTarget(profiles = [], { profileId = null } = {}) {
  const normalizedProfileId = normalizeOptionalText(profileId);
  const profileList = Array.isArray(profiles) ? profiles : [];
  const profileRecord = normalizedProfileId
    ? profileList.find((entry) => entry?.profileId === normalizedProfileId)
    : null;
  const selectedProfileSummary = profileRecord ? buildLocalReasonerProfileSummary(profileRecord) : null;
  const selectedCandidate = selectedProfileSummary
    ? {
        ...selectedProfileSummary,
        rank: 1,
        recommended: Boolean(selectedProfileSummary?.health?.restorable),
      }
    : (() => {
        const candidates = buildLocalReasonerRestoreCandidatesFromProfiles(profileList, {
          limit: Number.MAX_SAFE_INTEGER,
        });
        const candidateList = Array.isArray(candidates.restoreCandidates) ? candidates.restoreCandidates : [];
        return candidateList.find((entry) => entry?.health?.restorable) ?? candidateList[0] ?? null;
      })();

  if (!selectedCandidate) {
    throw new Error(
      normalizedProfileId
        ? `Unknown local reasoner profile: ${normalizedProfileId}`
        : "No local reasoner restore candidate is available"
    );
  }

  const selectedProfileRecord =
    profileRecord || profileList.find((entry) => entry?.profileId === selectedCandidate.profileId);
  if (!selectedProfileRecord) {
    throw new Error(`Local reasoner profile ${selectedCandidate.profileId} could not be loaded`);
  }

  return {
    normalizedProfileId: normalizedProfileId ?? null,
    profileRecord: profileRecord ?? null,
    selectedCandidate,
    selectedProfileRecord,
  };
}

export function buildLocalReasonerRestoreActivationPayload(
  selectedProfileRecord = {},
  payload = {},
  { dryRun = false } = {}
) {
  return {
    ...payload,
    dryRun,
    localReasoner: {
      ...(selectedProfileRecord.config || {}),
      ...(selectedProfileRecord.lastProbe ? { lastProbe: selectedProfileRecord.lastProbe } : {}),
      ...(selectedProfileRecord.lastWarm ? { lastWarm: selectedProfileRecord.lastWarm } : {}),
      ...(payload.localReasoner && typeof payload.localReasoner === "object" ? payload.localReasoner : {}),
    },
  };
}

export function buildLocalReasonerRestorePrewarmPayload(
  selectedCandidate = {},
  selectedProfileRecord = {},
  payload = {},
  { dryRun = false } = {}
) {
  return {
    ...payload,
    dryRun,
    profileId: selectedCandidate.profileId,
    provider: selectedProfileRecord.provider,
    localReasoner: cloneJson(selectedProfileRecord.config || {}),
  };
}

export function shouldReuseLocalReasonerRestorePrewarm(payload = {}) {
  return normalizeOptionalText(payload.prewarmMode) === "reuse";
}

export function buildLocalReasonerRestoreResult({
  selectedCandidate = null,
  activation = null,
  prewarmResult = null,
  dryRun = false,
  prewarm = false,
  nowImpl = now,
} = {}) {
  return {
    restoredAt: nowImpl(),
    dryRun: normalizeBooleanFlag(dryRun, false),
    prewarm: normalizeBooleanFlag(prewarm, false),
    restoredProfileId: selectedCandidate?.profileId ?? null,
    selectedCandidate,
    activation,
    prewarmResult,
    deviceRuntime:
      prewarmResult?.deviceRuntime ??
      activation?.runtime?.deviceRuntime ??
      null,
  };
}

export function buildLocalReasonerProfileSavePlan(
  targetStore = {},
  payload = {},
  {
    createRecordIdImpl = createRecordId,
    nowImpl = now,
  } = {}
) {
  const sourceMode = normalizeOptionalText(payload.source) ?? "current";
  const currentRuntimeLocalReasonerRaw = normalizeRuntimeLocalReasonerConfig(targetStore.deviceRuntime?.localReasoner || {});
  const currentRuntimeLocalReasoner = resolveInspectableRuntimeLocalReasonerConfig(currentRuntimeLocalReasonerRaw);
  const baseConfig =
    sourceMode === "current"
      ? sanitizeRuntimeLocalReasonerConfigForProfile(currentRuntimeLocalReasoner)
      : sanitizeRuntimeLocalReasonerConfigForProfile(payload.localReasoner || payload);
  const profileId = normalizeOptionalText(payload.profileId) ?? createRecordIdImpl("lrp");
  const profiles = Array.isArray(targetStore.localReasonerProfiles) ? targetStore.localReasonerProfiles : [];
  const existingIndex = profiles.findIndex((entry) => entry?.profileId === profileId);
  const existing = existingIndex >= 0 ? profiles[existingIndex] : null;
  const nextProfile = normalizeLocalReasonerProfileRecord({
    ...existing,
    profileId,
    label: normalizeOptionalText(payload.label) ?? existing?.label ?? buildDefaultLocalReasonerProfileLabel(baseConfig),
    note: normalizeOptionalText(payload.note) ?? existing?.note ?? null,
    provider: baseConfig.provider,
    config: baseConfig,
    createdAt: existing?.createdAt ?? nowImpl(),
    updatedAt: nowImpl(),
    createdByAgentId:
      existing?.createdByAgentId ??
      normalizeOptionalText(payload.updatedByAgentId) ??
      normalizeOptionalText(payload.createdByAgentId) ??
      targetStore.deviceRuntime?.residentAgentId ??
      null,
    createdByWindowId:
      existing?.createdByWindowId ??
      normalizeOptionalText(payload.updatedByWindowId) ??
      normalizeOptionalText(payload.createdByWindowId) ??
      null,
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId) ?? existing?.sourceWindowId ?? null,
    useCount: existing?.useCount ?? 0,
    lastActivatedAt: existing?.lastActivatedAt ?? null,
    lastProbe: sourceMode === "current" ? currentRuntimeLocalReasonerRaw.lastProbe : existing?.lastProbe ?? null,
    lastWarm: sourceMode === "current" ? currentRuntimeLocalReasonerRaw.lastWarm : existing?.lastWarm ?? null,
    lastHealthyAt:
      sourceMode === "current"
        ? currentRuntimeLocalReasonerRaw.lastWarm?.warmedAt ??
          currentRuntimeLocalReasonerRaw.lastProbe?.checkedAt ??
          existing?.lastHealthyAt ??
          null
        : existing?.lastHealthyAt ?? null,
  });
  const nextProfiles = [...profiles];

  if (existingIndex >= 0) {
    nextProfiles[existingIndex] = nextProfile;
  } else {
    nextProfiles.push(nextProfile);
  }

  return {
    profileId,
    existingIndex,
    existing,
    nextProfile,
    nextProfiles,
  };
}

export function buildLocalReasonerProfileSavedEventPayload(profile = {}) {
  return {
    profileId: profile.profileId,
    provider: profile.provider,
    label: profile.label,
  };
}

export function buildLocalReasonerProfileSaveResult(
  profile = {},
  {
    dryRun = false,
    nowImpl = now,
  } = {}
) {
  return {
    savedAt: nowImpl(),
    dryRun,
    summary: buildLocalReasonerProfileSummary(profile),
    profile: cloneJson(profile),
  };
}

export function applyLocalReasonerProfileSaveToStore(
  targetStore,
  payload = {},
  {
    appendEvent,
    dryRun = false,
  } = {}
) {
  const isDryRun = normalizeBooleanFlag(dryRun, false);
  if (!isDryRun && typeof appendEvent !== "function") {
    throw new TypeError("appendEvent is required");
  }

  const savePlan = buildLocalReasonerProfileSavePlan(targetStore, payload);
  targetStore.localReasonerProfiles = savePlan.nextProfiles;

  if (!isDryRun) {
    appendEvent(
      targetStore,
      "device_local_reasoner_profile_saved",
      buildLocalReasonerProfileSavedEventPayload(savePlan.nextProfile)
    );
  }

  return savePlan;
}

export function buildLocalReasonerProfileDeletePlan(profiles = [], profileId) {
  const profileList = Array.isArray(profiles) ? profiles : [];
  const { normalizedId, profile } = resolveLocalReasonerProfileRecord(profileList, profileId);
  return {
    normalizedId,
    profile,
    nextProfiles: profileList.filter((entry) => entry?.profileId !== normalizedId),
  };
}

export function buildLocalReasonerProfileDeletedEventPayload(deletePlan = {}) {
  const profile = deletePlan.profile || {};
  return {
    profileId: deletePlan.normalizedId,
    provider: profile.provider,
    label: profile.label,
  };
}

export function buildLocalReasonerProfileDeleteResult(
  profile = {},
  {
    dryRun = false,
    nowImpl = now,
  } = {}
) {
  return {
    deletedAt: nowImpl(),
    dryRun,
    summary: buildLocalReasonerProfileSummary(profile),
  };
}

export function applyLocalReasonerProfileDeleteToStore(
  targetStore,
  profileId,
  {
    appendEvent,
    dryRun = false,
  } = {}
) {
  const isDryRun = normalizeBooleanFlag(dryRun, false);
  if (!isDryRun && typeof appendEvent !== "function") {
    throw new TypeError("appendEvent is required");
  }

  const deletePlan = buildLocalReasonerProfileDeletePlan(targetStore.localReasonerProfiles, profileId);

  if (!isDryRun) {
    targetStore.localReasonerProfiles = deletePlan.nextProfiles;
    appendEvent(
      targetStore,
      "device_local_reasoner_profile_deleted",
      buildLocalReasonerProfileDeletedEventPayload(deletePlan)
    );
  }

  return deletePlan;
}

export function buildLocalReasonerProfileActivationPayload(profile = {}, payload = {}) {
  return {
    ...cloneJson(profile.config || {}),
    ...payload,
    provider:
      normalizeRuntimeReasonerProvider(payload.provider) ||
      normalizeRuntimeReasonerProvider(payload.localReasonerProvider) ||
      profile.provider,
    localReasoner: {
      ...(profile.config || {}),
      ...(payload.localReasoner && typeof payload.localReasoner === "object" ? payload.localReasoner : {}),
    },
  };
}

export function buildDryRunActivatedLocalReasonerProfile(profile = {}, runtimeLocalReasoner = {}) {
  return normalizeLocalReasonerProfileRecord({
    ...profile,
    lastProbe: runtimeLocalReasoner.lastProbe ?? profile.lastProbe ?? null,
    lastWarm: runtimeLocalReasoner.lastWarm ?? profile.lastWarm ?? null,
    lastHealthyAt:
      runtimeLocalReasoner.lastWarm?.warmedAt ??
      runtimeLocalReasoner.lastProbe?.checkedAt ??
      profile.lastHealthyAt ??
      null,
  });
}

export function buildLocalReasonerProfileActivatedEventPayload(profileId, profile = {}) {
  return {
    profileId,
    provider: profile.provider,
    label: profile.label,
  };
}

export function buildLocalReasonerProfileActivationResult(
  profile = {},
  runtime = null,
  {
    activatedAt = now(),
    dryRun = false,
  } = {}
) {
  return {
    activatedAt,
    dryRun,
    summary: buildLocalReasonerProfileSummary(profile),
    runtime,
  };
}

export function applyLocalReasonerProfileActivationToStore(
  targetStore,
  profileId,
  profile = {},
  runtimeLocalReasoner = {},
  {
    activatedAt = now(),
    appendEvent,
    dryRun = false,
  } = {}
) {
  const normalizedId = normalizeOptionalText(profileId);
  const normalizedRuntimeLocalReasoner = normalizeRuntimeLocalReasonerConfig(runtimeLocalReasoner || {});
  const nextProfile = normalizeBooleanFlag(dryRun, false)
    ? buildDryRunActivatedLocalReasonerProfile(profile, normalizedRuntimeLocalReasoner)
    : syncLocalReasonerProfileRuntimeStateInStore(targetStore, normalizedId, normalizedRuntimeLocalReasoner, {
        incrementUseCount: true,
        activatedAt,
      }) ||
      normalizeLocalReasonerProfileRecord(profile);

  if (!normalizeBooleanFlag(dryRun, false)) {
    if (typeof appendEvent !== "function") {
      throw new TypeError("appendEvent is required");
    }
    appendEvent(
      targetStore,
      "device_local_reasoner_profile_activated",
      buildLocalReasonerProfileActivatedEventPayload(normalizedId, nextProfile)
    );
  }

  return nextProfile;
}

export function buildDefaultMigratedLocalReasonerProfile(profile = {}, payload = {}, { nowImpl = now } = {}) {
  const currentProfile = normalizeLocalReasonerProfileRecord(profile);
  const currentConfig = normalizeRuntimeLocalReasonerConfig(currentProfile.config || {});
  const targetConfig = buildDefaultDeviceLocalReasonerTargetConfig(currentConfig, payload);
  const currentAutoLabel = buildDefaultLocalReasonerProfileLabel(currentConfig);
  const targetAutoLabel = buildDefaultLocalReasonerProfileLabel(targetConfig);
  const currentLabel = normalizeOptionalText(currentProfile.label) ?? null;
  const nextLabel =
    currentLabel && currentLabel === currentAutoLabel
      ? targetAutoLabel
      : currentLabel || targetAutoLabel;
  return normalizeLocalReasonerProfileRecord({
    ...currentProfile,
    label: nextLabel,
    provider: targetConfig.provider,
    config: targetConfig,
    updatedAt: nowImpl(),
    lastProbe: null,
    lastWarm: null,
    lastHealthyAt: null,
  });
}

function buildDefaultLocalReasonerProfileMigrationView({
  currentProfile,
  migratedProfile,
  currentConfig,
  scoped,
  needsMigration,
  dryRun,
}) {
  if (!scoped) {
    return null;
  }

  const labelUpdated =
    needsMigration &&
    (normalizeOptionalText(currentProfile.label) ?? null) !== (normalizeOptionalText(migratedProfile.label) ?? null);

  return {
    profileId: currentProfile.profileId,
    label: migratedProfile.label,
    scoped: true,
    needsMigration,
    migrated: needsMigration && !dryRun,
    labelUpdated,
    before: {
      provider: currentConfig.provider,
      model: currentConfig.model || null,
      baseUrl: currentConfig.baseUrl || null,
      path: currentConfig.path || null,
      command: currentConfig.command || null,
    },
    after: {
      provider: migratedProfile.provider,
      model: migratedProfile.config?.model || null,
      baseUrl: migratedProfile.config?.baseUrl || null,
      path: migratedProfile.config?.path || null,
      command: migratedProfile.config?.command || null,
    },
  };
}

export function buildDefaultLocalReasonerProfileMigrationPlan(
  profiles = [],
  payload = {},
  { dryRun = false, nowImpl = now } = {}
) {
  const requestedProfileIds = normalizeTextList(payload.profileIds);
  const requestedProfileIdSet = requestedProfileIds.length > 0 ? new Set(requestedProfileIds) : null;
  const profileList = Array.isArray(profiles) ? profiles : [];
  const results = [];
  let migratedCount = 0;
  let labelUpdatedCount = 0;
  let needsMigrationCount = 0;

  const nextProfiles = profileList.map((entry) => {
    const currentProfile = normalizeLocalReasonerProfileRecord(entry);
    const scoped = !requestedProfileIdSet || requestedProfileIdSet.has(currentProfile.profileId);
    const currentConfig = normalizeRuntimeLocalReasonerConfig(currentProfile.config || {});
    const targetConfig = buildDefaultDeviceLocalReasonerTargetConfig(currentConfig, payload);
    const needsMigration = scoped && localReasonerNeedsDefaultMigration(currentConfig, targetConfig);
    const migratedProfile = needsMigration
      ? buildDefaultMigratedLocalReasonerProfile(currentProfile, payload, { nowImpl })
      : currentProfile;
    const view = buildDefaultLocalReasonerProfileMigrationView({
      currentProfile,
      migratedProfile,
      currentConfig,
      scoped,
      needsMigration,
      dryRun,
    });

    if (needsMigration) {
      needsMigrationCount += 1;
    }
    if (view?.labelUpdated) {
      labelUpdatedCount += 1;
    }
    if (needsMigration && !dryRun) {
      migratedCount += 1;
    }
    if (view) {
      results.push(view);
    }

    return needsMigration && !dryRun ? migratedProfile : currentProfile;
  });

  return {
    nextProfiles,
    results,
    counts: {
      totalProfiles: profileList.length,
      scopedProfiles: results.length,
      needsMigration: needsMigrationCount,
      migrated: dryRun ? 0 : migratedCount,
      unchanged: results.filter((item) => !item.needsMigration).length,
      labelUpdated: labelUpdatedCount,
    },
  };
}

export function buildDefaultLocalReasonerProfileMigrationEventPayload(plan = {}) {
  const results = Array.isArray(plan.results) ? plan.results : [];
  return {
    migratedCount: plan.counts?.migrated ?? 0,
    labelUpdatedCount: plan.counts?.labelUpdated ?? 0,
    profileIds: results.filter((item) => item.needsMigration).map((item) => item.profileId),
    provider: DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
    model: DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
  };
}

export function buildDefaultLocalReasonerProfileMigrationResult(
  plan = {},
  { dryRun = false, nowImpl = now } = {}
) {
  return {
    migratedAt: nowImpl(),
    dryRun,
    target: {
      provider: DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
      model: DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
      baseUrl: DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL,
      path: "/api/chat",
      timeoutMs: DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
    },
    counts: {
      totalProfiles: plan.counts?.totalProfiles ?? 0,
      scopedProfiles: plan.counts?.scopedProfiles ?? 0,
      needsMigration: plan.counts?.needsMigration ?? 0,
      migrated: dryRun ? 0 : (plan.counts?.migrated ?? 0),
      unchanged: plan.counts?.unchanged ?? 0,
      labelUpdated: plan.counts?.labelUpdated ?? 0,
    },
    profiles: Array.isArray(plan.results) ? plan.results : [],
  };
}

export function applyDefaultLocalReasonerProfileMigrationToStore(
  targetStore,
  payload = {},
  {
    appendEvent,
    dryRun = false,
  } = {}
) {
  const isDryRun = normalizeBooleanFlag(dryRun, false);
  if (!isDryRun && typeof appendEvent !== "function") {
    throw new TypeError("appendEvent is required");
  }

  const profiles = Array.isArray(targetStore.localReasonerProfiles) ? targetStore.localReasonerProfiles : [];
  const migrationPlan = buildDefaultLocalReasonerProfileMigrationPlan(profiles, payload, { dryRun: isDryRun });
  targetStore.localReasonerProfiles = migrationPlan.nextProfiles;

  if (!isDryRun && migrationPlan.counts.needsMigration > 0) {
    appendEvent(
      targetStore,
      "device_local_reasoner_profiles_migrated_to_default",
      buildDefaultLocalReasonerProfileMigrationEventPayload(migrationPlan)
    );
  }

  return migrationPlan;
}

export function syncLocalReasonerProfileRuntimeStateInStore(
  targetStore,
  profileId,
  runtimeLocalReasoner = {},
  { incrementUseCount = false, activatedAt = null } = {}
) {
  const normalizedId = normalizeOptionalText(profileId);
  if (!normalizedId || !Array.isArray(targetStore.localReasonerProfiles)) {
    return null;
  }
  const index = targetStore.localReasonerProfiles.findIndex((entry) => entry?.profileId === normalizedId);
  if (index < 0) {
    return null;
  }
  const existing = normalizeLocalReasonerProfileRecord(targetStore.localReasonerProfiles[index]);
  const nextProfile = normalizeLocalReasonerProfileRecord({
    ...existing,
    updatedAt: now(),
    useCount: incrementUseCount ? Number(existing.useCount || 0) + 1 : Number(existing.useCount || 0),
    lastActivatedAt: activatedAt ?? existing.lastActivatedAt ?? null,
    lastProbe: runtimeLocalReasoner.lastProbe ?? existing.lastProbe ?? null,
    lastWarm: runtimeLocalReasoner.lastWarm ?? existing.lastWarm ?? null,
    lastHealthyAt:
      runtimeLocalReasoner.lastWarm?.warmedAt ??
      runtimeLocalReasoner.lastProbe?.checkedAt ??
      existing.lastHealthyAt ??
      null,
  });
  targetStore.localReasonerProfiles[index] = nextProfile;
  return nextProfile;
}

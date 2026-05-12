import {
  cloneJson,
  normalizeOptionalText,
  normalizeTextList,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  buildLocalReasonerProfileSummary,
  normalizeLocalReasonerProfileRecord,
} from "./ledger-device-runtime.js";

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

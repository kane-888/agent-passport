import {
  normalizeBooleanFlag,
  now,
} from "./ledger-core-utils.js";
import {
  buildLocalReasonerSelectionState,
  normalizeDeviceRuntime,
  normalizeRuntimeLocalReasonerConfig,
} from "./ledger-device-runtime.js";
import {
  applyLocalReasonerProfileActivationToStore,
  buildLocalReasonerProfileActivationPayload,
  buildLocalReasonerProfileActivationResult,
  buildLocalReasonerRestoreActivationPayload,
  buildLocalReasonerRestorePrewarmPayload,
  buildLocalReasonerRestoreResult,
  resolveLocalReasonerProfileRecord,
  resolveLocalReasonerRestoreTarget,
  shouldReuseLocalReasonerRestorePrewarm,
  syncLocalReasonerProfileRuntimeStateInStore,
} from "./ledger-local-reasoner-profiles.js";
import {
  applyDeviceLocalReasonerPrewarmToStore,
  applyDeviceLocalReasonerSelectionToStore,
  buildDeviceLocalReasonerPrewarmResult,
  buildReusableLocalReasonerPrewarmResult,
  prewarmRuntimeLocalReasoner,
} from "./ledger-local-reasoner-runtime.js";
import {
  buildPrewarmDeviceLocalReasonerConfig,
  buildSelectedDeviceLocalReasonerConfig,
} from "./ledger-local-reasoner-overrides.js";

export function selectDeviceLocalReasonerInStore(
  targetStore,
  payload = {},
  {
    appendEvent,
    nowImpl = now,
    resolveResidentAgentBinding,
  } = {}
) {
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const runtime = normalizeDeviceRuntime(payload.deviceRuntime || targetStore.deviceRuntime);
  const selectedConfig = buildSelectedDeviceLocalReasonerConfig(runtime, payload);
  return applyDeviceLocalReasonerSelectionToStore(targetStore, selectedConfig, payload, dryRun, {
    appendEvent,
    nowImpl,
    resolveResidentAgentBinding,
  });
}

export function activateDeviceLocalReasonerProfileInStore(
  targetStore,
  profileId,
  payload = {},
  {
    appendEvent,
    nowImpl = now,
    resolveResidentAgentBinding,
  } = {}
) {
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const { normalizedId, profile } = resolveLocalReasonerProfileRecord(targetStore.localReasonerProfiles, profileId);

  const activatedAt = nowImpl();
  const selected = selectDeviceLocalReasonerInStore(
    targetStore,
    buildLocalReasonerProfileActivationPayload(profile, payload),
    {
      appendEvent,
      nowImpl,
      resolveResidentAgentBinding,
    }
  );
  const runtimeLocalReasoner = normalizeRuntimeLocalReasonerConfig(selected.runtime?.deviceRuntime?.localReasoner || {});
  const nextProfile = applyLocalReasonerProfileActivationToStore(
    targetStore,
    normalizedId,
    profile,
    runtimeLocalReasoner,
    {
      activatedAt,
      appendEvent,
      dryRun,
    }
  );

  return buildLocalReasonerProfileActivationResult(nextProfile, selected.runtime, { activatedAt, dryRun });
}

export async function prewarmDeviceLocalReasonerInStore(
  targetStore,
  payload = {},
  {
    appendEvent,
    generateAgentRunnerCandidateResponse,
    inspectRuntimeLocalReasoner,
    resolveResidentAgentBinding,
    syncLocalReasonerProfileRuntimeStateInStoreImpl = syncLocalReasonerProfileRuntimeStateInStore,
  } = {}
) {
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const runtime = normalizeDeviceRuntime(payload.deviceRuntime || targetStore.deviceRuntime);
  const candidateConfig = buildPrewarmDeviceLocalReasonerConfig(runtime, payload);
  const prewarmed = await prewarmRuntimeLocalReasoner(candidateConfig, runtime, {
    generateAgentRunnerCandidateResponse,
    inspectRuntimeLocalReasoner,
  });
  const nextLocalReasoner = normalizeRuntimeLocalReasonerConfig({
    ...candidateConfig,
    selection:
      candidateConfig.selection ||
      (dryRun ? null : buildLocalReasonerSelectionState(candidateConfig, payload)),
    lastProbe: prewarmed.probeState,
    lastWarm: prewarmed.warmState,
  });

  if (!dryRun) {
    applyDeviceLocalReasonerPrewarmToStore(targetStore, nextLocalReasoner, payload, {
      appendEvent,
      resolveResidentAgentBinding,
      syncLocalReasonerProfileRuntimeStateInStore: syncLocalReasonerProfileRuntimeStateInStoreImpl,
    });
  }

  return buildDeviceLocalReasonerPrewarmResult({
    targetStore,
    runtime,
    nextLocalReasoner,
    prewarmed,
    dryRun,
  });
}

export async function restoreDeviceLocalReasonerInStore(
  targetStore,
  payload = {},
  deps = {}
) {
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const prewarm = normalizeBooleanFlag(payload.prewarm, true);
  const { selectedCandidate, selectedProfileRecord } = resolveLocalReasonerRestoreTarget(
    targetStore.localReasonerProfiles,
    { profileId: payload.profileId }
  );

  const activation = activateDeviceLocalReasonerProfileInStore(
    targetStore,
    selectedCandidate.profileId,
    buildLocalReasonerRestoreActivationPayload(selectedProfileRecord, payload, { dryRun }),
    deps
  );

  let prewarmResult = null;
  if (prewarm) {
    prewarmResult =
      shouldReuseLocalReasonerRestorePrewarm(payload)
        ? buildReusableLocalReasonerPrewarmResult(targetStore, selectedProfileRecord, activation, payload)
        : null;
    if (!prewarmResult) {
      prewarmResult = await prewarmDeviceLocalReasonerInStore(
        targetStore,
        buildLocalReasonerRestorePrewarmPayload(selectedCandidate, selectedProfileRecord, payload, { dryRun }),
        deps
      );
    }
  }

  return buildLocalReasonerRestoreResult({
    dryRun,
    prewarm,
    selectedCandidate,
    activation,
    prewarmResult,
  });
}

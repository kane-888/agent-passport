import {
  cloneJson,
  normalizeBooleanFlag,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import {
  buildDeviceRuntimeView,
  DEFAULT_DEVICE_NEGOTIATION_MODE,
  normalizeDeviceRuntime,
  normalizeLocalReasonerProfileRecord,
  normalizeRuntimeLocalReasonerConfig,
  summarizeLocalReasonerDiagnostics,
} from "./ledger-device-runtime.js";

function requireInjectedFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

export function applyDeviceLocalReasonerConfigToStore(
  targetStore,
  localReasoner,
  payload = {},
  {
    normalizeDeviceRuntimeImpl = normalizeDeviceRuntime,
    nowImpl = now,
    resolveResidentAgentBinding,
  } = {}
) {
  const resolveBinding = requireInjectedFunction(resolveResidentAgentBinding, "resolveResidentAgentBinding");
  targetStore.deviceRuntime = normalizeDeviceRuntimeImpl(targetStore.deviceRuntime);
  const { residentAgentId } = resolveBinding(targetStore, targetStore.deviceRuntime);
  if (residentAgentId && !targetStore.agents?.[residentAgentId]) {
    throw new Error(`Resident agent not found: ${residentAgentId}`);
  }
  targetStore.deviceRuntime = normalizeDeviceRuntimeImpl({
    ...targetStore.deviceRuntime,
    localReasoner,
    updatedAt: nowImpl(),
    updatedByAgentId:
      normalizeOptionalText(payload.updatedByAgentId || payload.recordedByAgentId) ??
      residentAgentId ??
      null,
    updatedByWindowId: normalizeOptionalText(payload.updatedByWindowId || payload.recordedByWindowId) ?? null,
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId) ?? null,
  });
  return targetStore.deviceRuntime;
}

export function buildDeviceLocalReasonerRuntimeConfiguredEventPayload(
  targetStore,
  payload = {},
  dryRun = false,
  {
    resolveResidentAgentBinding,
  } = {}
) {
  const resolveBinding = requireInjectedFunction(resolveResidentAgentBinding, "resolveResidentAgentBinding");
  const residentBinding = resolveBinding(targetStore, targetStore.deviceRuntime);
  return {
    dryRun,
    residentAgentId: residentBinding.residentAgentId ?? null,
    residentAgentReference: residentBinding.residentAgentReference ?? null,
    resolvedResidentAgentId: residentBinding.resolvedResidentAgentId ?? null,
    residentDidMethod: targetStore.deviceRuntime.residentDidMethod,
    residentLocked: targetStore.deviceRuntime.residentLocked,
    localMode: targetStore.deviceRuntime.localMode,
    allowOnlineReasoner: targetStore.deviceRuntime.allowOnlineReasoner,
    negotiationMode: targetStore.deviceRuntime.commandPolicy?.negotiationMode ?? DEFAULT_DEVICE_NEGOTIATION_MODE,
    sourceWindowId: normalizeOptionalText(payload.sourceWindowId) ?? null,
    riskStrategies: cloneJson(targetStore.deviceRuntime.commandPolicy?.riskStrategies) ?? {},
    securityPosture: cloneJson(targetStore.deviceRuntime.securityPosture) ?? {},
    retrievalPolicy: cloneJson(targetStore.deviceRuntime.retrievalPolicy) ?? {},
    setupPolicy: cloneJson(targetStore.deviceRuntime.setupPolicy) ?? {},
    sandboxPolicy: cloneJson(targetStore.deviceRuntime.sandboxPolicy) ?? {},
  };
}

export function appendDeviceLocalReasonerRuntimeConfiguredEvent(
  targetStore,
  payload = {},
  dryRun = false,
  {
    appendEvent,
    resolveResidentAgentBinding,
  } = {}
) {
  const append = requireInjectedFunction(appendEvent, "appendEvent");
  append(
    targetStore,
    "device_runtime_configured",
    buildDeviceLocalReasonerRuntimeConfiguredEventPayload(targetStore, payload, dryRun, {
      resolveResidentAgentBinding,
    })
  );
}

export function buildDeviceLocalReasonerPrewarmResult({
  targetStore,
  runtime,
  nextLocalReasoner,
  prewarmed = {},
  dryRun = false,
  nowImpl = now,
} = {}) {
  const deviceRuntime = dryRun
    ? buildDeviceRuntimeView(
        {
          ...runtime,
          localReasoner: nextLocalReasoner,
        },
        targetStore
      )
    : buildDeviceRuntimeView(targetStore.deviceRuntime, targetStore);

  return {
    checkedAt: nowImpl(),
    dryRun,
    deviceRuntime,
    diagnostics: summarizeLocalReasonerDiagnostics(prewarmed.diagnostics),
    rawDiagnostics: prewarmed.diagnostics,
    warmState: prewarmed.warmState,
    candidate: prewarmed.candidate
      ? {
          provider: prewarmed.candidate.provider,
          responseText: normalizeOptionalText(prewarmed.candidate.responseText) ?? null,
          metadata: prewarmed.candidate.metadata ?? null,
        }
      : null,
  };
}

export function buildReusableLocalReasonerPrewarmResult(
  targetStore,
  profileRecord = null,
  activation = null,
  payload = {},
  {
    nowImpl = now,
  } = {}
) {
  const runtime = normalizeDeviceRuntime(targetStore?.deviceRuntime || activation?.runtime?.deviceRuntime || {});
  const runtimeLocalReasoner = normalizeRuntimeLocalReasonerConfig(runtime.localReasoner || {});
  const profile = normalizeLocalReasonerProfileRecord(profileRecord || {});
  const warmState = runtimeLocalReasoner.lastWarm || profile.lastWarm || null;
  const probeState = runtimeLocalReasoner.lastProbe || profile.lastProbe || null;
  if (warmState?.status !== "ready") {
    return null;
  }

  const checkedAt = normalizeOptionalText(probeState?.checkedAt || warmState?.warmedAt) ?? nowImpl();
  const diagnostics = {
    checkedAt,
    status: "ready",
    configured: true,
    reachable: true,
    provider: runtimeLocalReasoner.provider || profile.provider || null,
    model: normalizeOptionalText(warmState?.model) ?? runtimeLocalReasoner.model ?? null,
    error: null,
  };
  return {
    checkedAt: nowImpl(),
    dryRun: normalizeBooleanFlag(payload.dryRun, false),
    reusedWarmState: true,
    warmProofSource: runtimeLocalReasoner.lastWarm ? "runtime_last_warm" : "profile_last_warm",
    deviceRuntime: buildDeviceRuntimeView(runtime, targetStore),
    diagnostics,
    rawDiagnostics: diagnostics,
    warmState: cloneJson(warmState),
    candidate: null,
  };
}

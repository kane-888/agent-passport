import {
  cloneJson,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import {
  DEFAULT_DEVICE_NEGOTIATION_MODE,
  normalizeDeviceRuntime,
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

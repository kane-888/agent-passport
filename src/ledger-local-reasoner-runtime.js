import {
  cloneJson,
  normalizeBooleanFlag,
  normalizeOptionalText,
  now,
} from "./ledger-core-utils.js";
import {
  buildDeviceRuntimeView,
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  DEFAULT_DEVICE_NEGOTIATION_MODE,
  isRuntimeLocalReasonerConfigured,
  buildLocalReasonerProbeState,
  buildLocalReasonerWarmState,
  normalizeDeviceRuntime,
  normalizeLocalReasonerProfileRecord,
  normalizeRuntimeLocalReasonerConfig,
  resolveDisplayedRuntimeLocalReasonerProvider,
  resolveInspectableRuntimeLocalReasonerConfig,
  summarizeLocalReasonerDiagnostics,
} from "./ledger-device-runtime.js";
import { normalizeDidMethod } from "./protocol.js";

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

export function applyDeviceLocalReasonerSelectionToStore(
  targetStore,
  selectedConfig,
  payload = {},
  dryRun = false,
  {
    appendEvent,
    nowImpl = now,
    resolveResidentAgentBinding,
  } = {}
) {
  applyDeviceLocalReasonerConfigToStore(targetStore, selectedConfig, payload, {
    resolveResidentAgentBinding,
  });
  appendDeviceLocalReasonerRuntimeConfiguredEvent(targetStore, payload, dryRun, {
    appendEvent,
    resolveResidentAgentBinding,
  });
  return {
    selectedAt: nowImpl(),
    dryRun,
    selection: selectedConfig.selection,
    runtime: {
      configuredAt: nowImpl(),
      dryRun,
      deviceRuntime: buildDeviceRuntimeView(targetStore.deviceRuntime, targetStore),
    },
  };
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

export function applyDeviceLocalReasonerPrewarmToStore(
  targetStore,
  nextLocalReasoner,
  payload = {},
  {
    appendEvent,
    resolveResidentAgentBinding,
    syncLocalReasonerProfileRuntimeStateInStore,
  } = {}
) {
  applyDeviceLocalReasonerConfigToStore(targetStore, nextLocalReasoner, payload, {
    resolveResidentAgentBinding,
  });
  appendDeviceLocalReasonerRuntimeConfiguredEvent(targetStore, payload, false, {
    appendEvent,
    resolveResidentAgentBinding,
  });

  const normalizedProfileId = normalizeOptionalText(payload.profileId);
  if (normalizedProfileId) {
    const syncProfile = requireInjectedFunction(
      syncLocalReasonerProfileRuntimeStateInStore,
      "syncLocalReasonerProfileRuntimeStateInStore"
    );
    syncProfile(targetStore, normalizedProfileId, targetStore.deviceRuntime.localReasoner);
  }

  return targetStore.deviceRuntime;
}

export function buildPassiveLocalReasonerDiagnostics(localReasoner = {}, { nowImpl = now } = {}) {
  const normalized = normalizeRuntimeLocalReasonerConfig(localReasoner);
  const configured = isRuntimeLocalReasonerConfigured(normalized);
  const lastProbe = normalized.lastProbe ?? null;
  const lastWarm = normalized.lastWarm ?? null;
  return summarizeLocalReasonerDiagnostics({
    checkedAt:
      normalizeOptionalText(lastProbe?.checkedAt) ??
      normalizeOptionalText(lastWarm?.warmedAt) ??
      nowImpl(),
    provider: resolveDisplayedRuntimeLocalReasonerProvider(normalized),
    enabled: normalized.enabled,
    configured,
    reachable:
      lastWarm?.status === "ready"
        ? true
        : Boolean(lastProbe?.reachable),
    status:
      normalizeOptionalText(lastWarm?.status) ??
      normalizeOptionalText(lastProbe?.status) ??
      (normalized.enabled ? (configured ? "never_checked" : "unconfigured") : "disabled"),
    model:
      normalizeOptionalText(lastWarm?.model) ??
      normalizeOptionalText(lastProbe?.model) ??
      normalizeOptionalText(normalized.model) ??
      null,
    modelCount: Number(lastProbe?.modelCount || 0),
    selectedModelPresent:
      lastProbe?.selectedModelPresent != null
        ? Boolean(lastProbe.selectedModelPresent)
        : Boolean(normalized.model),
    error:
      normalizeOptionalText(lastWarm?.error) ??
      normalizeOptionalText(lastProbe?.error) ??
      null,
  });
}

export function resolveDeviceLocalReasonerInspectionDiagnostics(
  runtime = {},
  {
    passive = false,
    inspectRuntimeLocalReasoner,
  } = {}
) {
  const normalizedRuntime = normalizeDeviceRuntime(runtime);
  if (passive) {
    return Promise.resolve({
      diagnostics: buildPassiveLocalReasonerDiagnostics(normalizedRuntime.localReasoner),
      rawDiagnostics: null,
    });
  }

  const inspectLocalReasoner = requireInjectedFunction(inspectRuntimeLocalReasoner, "inspectRuntimeLocalReasoner");
  return inspectLocalReasoner(
    resolveInspectableRuntimeLocalReasonerConfig(normalizedRuntime.localReasoner)
  ).then((rawDiagnostics) => ({
    diagnostics: summarizeLocalReasonerDiagnostics(rawDiagnostics),
    rawDiagnostics,
  }));
}

export function buildDeviceLocalReasonerInspectionResult({
  store = null,
  storeStatus = {},
  runtime = {},
  diagnostics = null,
  rawDiagnostics = null,
  passive = false,
  nowImpl = now,
} = {}) {
  const normalizedRuntime = normalizeDeviceRuntime(runtime);
  return {
    checkedAt: nowImpl(),
    deviceRuntime: store ? buildDeviceRuntimeView(normalizedRuntime, store) : null,
    diagnostics,
    rawDiagnostics,
    passive,
    initialized: Boolean(store),
    storePresent: storeStatus.present === true,
    missingStoreKey: storeStatus.missingKey === true,
  };
}

export const LOCAL_REASONER_CATALOG_PROVIDER_ORDER = ["ollama_local", "local_command", "local_mock"];

export function resolveDeviceLocalReasonerCatalogSelectedProvider(runtime = {}) {
  const normalizedRuntime = normalizeDeviceRuntime(runtime);
  return (
    resolveDisplayedRuntimeLocalReasonerProvider(normalizedRuntime.localReasoner) ||
    DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER
  );
}

export function buildDeviceLocalReasonerCatalogProviderEntry({
  provider,
  selectedProvider,
  probeConfig = {},
  diagnostics = null,
  passive = false,
  runtimeLocalReasoner = {},
} = {}) {
  const selected = provider === selectedProvider;
  return {
    provider,
    selected,
    config: {
      enabled: Boolean(probeConfig.enabled),
      provider: probeConfig.provider,
      command: probeConfig.command,
      args: [...probeConfig.args],
      cwd: probeConfig.cwd,
      baseUrl: probeConfig.baseUrl,
      model: probeConfig.model,
    },
    selection: selected && runtimeLocalReasoner?.selection ? cloneJson(runtimeLocalReasoner.selection) : null,
    lastProbe: selected && runtimeLocalReasoner?.lastProbe ? cloneJson(runtimeLocalReasoner.lastProbe) : null,
    lastWarm: selected && runtimeLocalReasoner?.lastWarm ? cloneJson(runtimeLocalReasoner.lastWarm) : null,
    diagnostics: summarizeLocalReasonerDiagnostics(diagnostics),
    rawDiagnostics: passive ? null : diagnostics,
    availableModels: Array.isArray(diagnostics?.models) ? [...diagnostics.models] : [],
  };
}

export function buildDeviceLocalReasonerCatalogProviders({
  runtime = {},
  selectedProvider = null,
  passive = false,
  providerOrder = LOCAL_REASONER_CATALOG_PROVIDER_ORDER,
  buildLocalReasonerProbeConfig,
  inspectRuntimeLocalReasoner,
} = {}) {
  const buildProbeConfig = requireInjectedFunction(buildLocalReasonerProbeConfig, "buildLocalReasonerProbeConfig");
  const inspectLocalReasoner = passive
    ? null
    : requireInjectedFunction(inspectRuntimeLocalReasoner, "inspectRuntimeLocalReasoner");
  const normalizedRuntime = normalizeDeviceRuntime(runtime);
  const resolvedSelectedProvider =
    normalizeOptionalText(selectedProvider) ??
    resolveDeviceLocalReasonerCatalogSelectedProvider(normalizedRuntime);

  return (async () => {
    const providers = [];
    for (const provider of providerOrder) {
      const probeConfig = buildProbeConfig(normalizedRuntime, provider);
      const diagnostics = passive
        ? buildPassiveLocalReasonerDiagnostics(
            provider === resolvedSelectedProvider
              ? normalizedRuntime.localReasoner
              : {
                  provider,
                  enabled: false,
                }
          )
        : await inspectLocalReasoner(probeConfig);
      providers.push(buildDeviceLocalReasonerCatalogProviderEntry({
        provider,
        selectedProvider: resolvedSelectedProvider,
        probeConfig,
        diagnostics,
        passive,
        runtimeLocalReasoner: normalizedRuntime.localReasoner,
      }));
    }
    return providers;
  })();
}

export function buildDeviceLocalReasonerCatalogResult({
  store = null,
  storeStatus = {},
  runtime = {},
  selectedProvider = DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  providers = [],
  passive = false,
  nowImpl = now,
} = {}) {
  return {
    checkedAt: nowImpl(),
    selectedProvider,
    deviceRuntime: store ? buildDeviceRuntimeView(runtime, store) : null,
    providers,
    passive,
    initialized: Boolean(store),
    storePresent: storeStatus.present === true,
    missingStoreKey: storeStatus.missingKey === true,
  };
}

export function buildDeviceLocalReasonerProbeResult({
  store,
  runtime = {},
  candidateConfig = {},
  diagnostics = null,
  nowImpl = now,
} = {}) {
  return {
    checkedAt: nowImpl(),
    deviceRuntime: buildDeviceRuntimeView(
      {
        ...runtime,
        localReasoner: candidateConfig,
      },
      store
    ),
    diagnostics: summarizeLocalReasonerDiagnostics(diagnostics),
    rawDiagnostics: diagnostics,
  };
}

export function buildRuntimeLocalReasonerPrewarmContextBuilder({
  residentAgentId = "resident_local_agent",
  residentDidMethod = "agentpassport",
} = {}) {
  return {
    compiledPrompt: [
      "Warm local reasoner runtime.",
      "Verify the selected offline provider can return a grounded response.",
    ].join("\n"),
    contextHash: null,
    slots: {
      currentGoal: "预热本地 reasoner 并验证单机 Runtime 可继续运行。",
      identitySnapshot: {
        agentId: residentAgentId,
        didMethod: residentDidMethod,
        did: null,
        profile: {
          name: "Resident Agent",
          role: "runtime",
        },
        taskSnapshot: {
          nextAction: "等待下一轮真实推理",
        },
      },
      transcriptModel: {
        entryCount: 0,
      },
      recentConversationTurns: [],
      toolResults: [],
    },
    localKnowledge: {
      hits: [],
    },
  };
}

export function buildRuntimeLocalReasonerPrewarmCandidatePayload(localReasoner = {}) {
  const normalized = normalizeRuntimeLocalReasonerConfig(localReasoner);
  return {
    reasonerProvider: normalized.provider,
    localReasoner: normalized,
    currentGoal: "预热本地 reasoner",
    userTurn: "请返回一段简短 ready 响应，说明当前 provider 已可用。",
    recentConversationTurns: [],
    toolResults: [],
  };
}

export function buildRuntimeLocalReasonerPrewarmStateResult(
  localReasoner = {},
  diagnostics = null,
  { candidate = null, error = null } = {}
) {
  const normalized = normalizeRuntimeLocalReasonerConfig(localReasoner);
  return {
    diagnostics,
    probeState: buildLocalReasonerProbeState(diagnostics),
    warmState: buildLocalReasonerWarmState({
      localReasoner: normalized,
      diagnostics,
      ...(candidate ? { candidate } : {}),
      ...(error ? { error } : {}),
    }),
    candidate: candidate ?? null,
  };
}

export function prewarmRuntimeLocalReasoner(
  localReasoner,
  runtime = {},
  {
    generateAgentRunnerCandidateResponse,
    inspectRuntimeLocalReasoner,
    normalizeDidMethodImpl = normalizeDidMethod,
  } = {}
) {
  const inspectLocalReasoner = requireInjectedFunction(inspectRuntimeLocalReasoner, "inspectRuntimeLocalReasoner");
  const generateCandidateResponse = requireInjectedFunction(
    generateAgentRunnerCandidateResponse,
    "generateAgentRunnerCandidateResponse"
  );

  return (async () => {
    const diagnostics = await inspectLocalReasoner(localReasoner);

    if (!diagnostics?.configured || !diagnostics?.reachable) {
      return buildRuntimeLocalReasonerPrewarmStateResult(localReasoner, diagnostics);
    }

    const residentAgentId = normalizeOptionalText(runtime?.residentAgentId) ?? "resident_local_agent";
    const residentDidMethod = normalizeDidMethodImpl(runtime?.residentDidMethod) || "agentpassport";
    const contextBuilder = buildRuntimeLocalReasonerPrewarmContextBuilder({
      residentAgentId,
      residentDidMethod,
    });

    try {
      const candidate = await generateCandidateResponse({
        contextBuilder,
        payload: buildRuntimeLocalReasonerPrewarmCandidatePayload(localReasoner),
      });
      return buildRuntimeLocalReasonerPrewarmStateResult(localReasoner, diagnostics, { candidate });
    } catch (error) {
      return buildRuntimeLocalReasonerPrewarmStateResult(localReasoner, diagnostics, { error });
    }
  })();
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

import {
  cloneJson,
  normalizeBooleanFlag,
} from "./ledger-core-utils.js";
import {
  buildLocalReasonerSelectionState,
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  normalizeRuntimeLocalReasonerConfig,
  normalizeRuntimeReasonerProvider,
} from "./ledger-device-runtime.js";
import {
  localReasonerNeedsDefaultMigration,
} from "./ledger-local-reasoner-defaults.js";

export function resolveLocalReasonerPayloadOverride(payload = {}) {
  const nested =
    payload.localReasoner && typeof payload.localReasoner === "object"
      ? cloneJson(payload.localReasoner)
      : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  const override = {
    ...nested,
  };

  if (has("localReasonerEnabled")) {
    override.enabled = payload.localReasonerEnabled;
  } else if (has("enabled")) {
    override.enabled = payload.enabled;
  }
  if (has("localReasonerProvider")) {
    override.provider = payload.localReasonerProvider;
  } else if (has("provider")) {
    override.provider = payload.provider;
  }
  if (has("localReasonerCommand")) {
    override.command = payload.localReasonerCommand;
  } else if (has("command")) {
    override.command = payload.command;
  }
  if (has("localReasonerArgs")) {
    override.args = payload.localReasonerArgs;
  } else if (has("args")) {
    override.args = payload.args;
  }
  if (has("localReasonerCwd")) {
    override.cwd = payload.localReasonerCwd;
  } else if (has("cwd")) {
    override.cwd = payload.cwd;
  }
  if (has("localReasonerBaseUrl")) {
    override.baseUrl = payload.localReasonerBaseUrl;
  } else if (has("baseUrl")) {
    override.baseUrl = payload.baseUrl;
  }
  if (has("localReasonerPath")) {
    override.path = payload.localReasonerPath;
  } else if (has("path")) {
    override.path = payload.path;
  }
  if (has("localReasonerTimeoutMs")) {
    override.timeoutMs = payload.localReasonerTimeoutMs;
  } else if (has("timeoutMs")) {
    override.timeoutMs = payload.timeoutMs;
  }
  if (has("localReasonerMaxOutputBytes")) {
    override.maxOutputBytes = payload.localReasonerMaxOutputBytes;
  } else if (has("maxOutputBytes")) {
    override.maxOutputBytes = payload.maxOutputBytes;
  }
  if (has("localReasonerMaxInputBytes")) {
    override.maxInputBytes = payload.localReasonerMaxInputBytes;
  } else if (has("maxInputBytes")) {
    override.maxInputBytes = payload.maxInputBytes;
  }
  if (has("localReasonerFormat")) {
    override.format = payload.localReasonerFormat;
  } else if (has("format")) {
    override.format = payload.format;
  }
  if (has("localReasonerModel")) {
    override.model = payload.localReasonerModel;
  } else if (has("model")) {
    override.model = payload.model;
  }
  if (has("localReasonerSelection")) {
    override.selection = payload.localReasonerSelection;
  } else if (has("selection")) {
    override.selection = payload.selection;
  }
  if (has("localReasonerLastProbe")) {
    override.lastProbe = payload.localReasonerLastProbe;
  } else if (has("lastProbe")) {
    override.lastProbe = payload.lastProbe;
  }
  if (has("localReasonerLastWarm")) {
    override.lastWarm = payload.localReasonerLastWarm;
  } else if (has("lastWarm")) {
    override.lastWarm = payload.lastWarm;
  }

  return override;
}

export function mergeRunnerLocalReasonerOverride(baseConfig = null, payload = {}, requestedProvider = null) {
  const currentConfig = normalizeRuntimeLocalReasonerConfig(baseConfig || {});
  const override = resolveLocalReasonerPayloadOverride(payload);

  if (Object.keys(override).length === 0) {
    return currentConfig;
  }

  return normalizeRuntimeLocalReasonerConfig({
    ...currentConfig,
    ...override,
    enabled:
      override.enabled == null
        ? currentConfig.enabled
        : normalizeBooleanFlag(override.enabled, true),
    provider:
      normalizeRuntimeReasonerProvider(requestedProvider) ??
      normalizeRuntimeReasonerProvider(override.provider) ??
      currentConfig.provider ??
      DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  });
}

export function buildLocalReasonerProbeConfig(runtime, provider) {
  const current = normalizeRuntimeLocalReasonerConfig(runtime?.localReasoner);
  const fallbackProvider = normalizeRuntimeReasonerProvider(provider) || current.provider || DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER;
  const merged = {
    ...current,
    enabled: true,
    provider: fallbackProvider,
  };
  if (fallbackProvider === "ollama_local" && !merged.baseUrl) {
    merged.baseUrl = "http://127.0.0.1:11434";
  }
  if (fallbackProvider === "local_mock" && !merged.model) {
    merged.model = "agent-passport-local-mock";
  }
  return normalizeRuntimeLocalReasonerConfig(merged);
}

export function buildDeviceLocalReasonerProbeCandidateConfig(runtime, payload = {}) {
  const override = resolveLocalReasonerPayloadOverride(payload);
  const candidateConfig = normalizeRuntimeLocalReasonerConfig({
    ...runtime?.localReasoner,
    ...override,
    enabled: override.enabled == null ? true : normalizeBooleanFlag(override.enabled, true),
    provider:
      normalizeRuntimeReasonerProvider(override.provider) ||
      normalizeRuntimeReasonerProvider(override.localReasonerProvider) ||
      runtime?.localReasoner?.provider ||
      DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  });
  if (candidateConfig.provider === "ollama_local" && !candidateConfig.baseUrl) {
    candidateConfig.baseUrl = "http://127.0.0.1:11434";
  }
  return candidateConfig;
}

export function buildSelectedDeviceLocalReasonerConfig(runtime, payload = {}) {
  const currentConfig = normalizeRuntimeLocalReasonerConfig(runtime?.localReasoner);
  const override = resolveLocalReasonerPayloadOverride(payload);
  const selectedConfig = normalizeRuntimeLocalReasonerConfig({
    ...runtime?.localReasoner,
    ...override,
    enabled: override.enabled == null ? true : normalizeBooleanFlag(override.enabled, true),
    provider:
      normalizeRuntimeReasonerProvider(override.provider) ||
      normalizeRuntimeReasonerProvider(override.localReasonerProvider) ||
      runtime?.localReasoner?.provider ||
      DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  });

  if (selectedConfig.provider === "ollama_local" && !selectedConfig.baseUrl) {
    selectedConfig.baseUrl = "http://127.0.0.1:11434";
  }
  if (selectedConfig.provider === "local_mock" && !selectedConfig.model) {
    selectedConfig.model = "agent-passport-local-mock";
  }
  if (localReasonerNeedsDefaultMigration(currentConfig, selectedConfig)) {
    selectedConfig.lastProbe = null;
    selectedConfig.lastWarm = null;
  }

  selectedConfig.selection = buildLocalReasonerSelectionState(selectedConfig, payload);
  return selectedConfig;
}

export function buildPrewarmDeviceLocalReasonerConfig(runtime, payload = {}) {
  const override = resolveLocalReasonerPayloadOverride(payload);
  const candidateConfig = normalizeRuntimeLocalReasonerConfig({
    ...runtime?.localReasoner,
    ...override,
    enabled: override.enabled == null ? runtime?.localReasoner?.enabled : normalizeBooleanFlag(override.enabled, false),
    provider:
      normalizeRuntimeReasonerProvider(override.provider) ||
      normalizeRuntimeReasonerProvider(override.localReasonerProvider) ||
      runtime?.localReasoner?.provider ||
      DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  });

  if (candidateConfig.provider === "ollama_local" && !candidateConfig.baseUrl) {
    candidateConfig.baseUrl = "http://127.0.0.1:11434";
  }
  if (candidateConfig.provider === "local_mock" && !candidateConfig.model) {
    candidateConfig.model = "agent-passport-local-mock";
  }

  return candidateConfig;
}

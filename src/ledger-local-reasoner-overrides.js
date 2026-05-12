import {
  cloneJson,
  normalizeBooleanFlag,
} from "./ledger-core-utils.js";
import {
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  normalizeRuntimeLocalReasonerConfig,
  normalizeRuntimeReasonerProvider,
} from "./ledger-device-runtime.js";

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

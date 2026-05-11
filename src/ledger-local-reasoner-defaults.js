import {
  hashJson,
  normalizeBooleanFlag,
  normalizeOptionalText,
} from "./ledger-core-utils.js";
import {
  DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL,
  DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
  normalizeRuntimeLocalReasonerConfig,
  sanitizeRuntimeLocalReasonerConfigForProfile,
} from "./ledger-device-runtime.js";

export function buildDefaultDeviceLocalReasonerTargetConfig(currentConfig = {}, payload = {}) {
  return normalizeRuntimeLocalReasonerConfig({
    ...currentConfig,
    enabled: payload.enabled == null ? currentConfig.enabled : normalizeBooleanFlag(payload.enabled, true),
    provider: DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
    model: DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
    baseUrl: DEFAULT_DEVICE_LOCAL_REASONER_BASE_URL,
    path: "/api/chat",
    timeoutMs:
      payload.localReasonerTimeoutMs ??
      payload.localReasoner?.timeoutMs ??
      DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
    command: null,
    args: [],
    cwd: null,
  });
}

export function localReasonerNeedsDefaultMigration(currentConfig = {}, targetConfig = {}) {
  const current = sanitizeRuntimeLocalReasonerConfigForProfile(currentConfig);
  const target = sanitizeRuntimeLocalReasonerConfigForProfile(targetConfig);
  return (
    current.provider !== target.provider ||
    (normalizeOptionalText(current.model) ?? "") !== (normalizeOptionalText(target.model) ?? "") ||
    (normalizeOptionalText(current.baseUrl) ?? "") !== (normalizeOptionalText(target.baseUrl) ?? "") ||
    (normalizeOptionalText(current.path) ?? "") !== (normalizeOptionalText(target.path) ?? "") ||
    Number(current.timeoutMs || 0) !== Number(target.timeoutMs || 0) ||
    (normalizeOptionalText(current.command) ?? "") !== (normalizeOptionalText(target.command) ?? "") ||
    hashJson(current.args || []) !== hashJson(target.args || []) ||
    (normalizeOptionalText(current.cwd) ?? "") !== (normalizeOptionalText(target.cwd) ?? "")
  );
}

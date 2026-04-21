function text(value) {
  return String(value ?? "").trim();
}

export function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeLoopbackHost(value = "") {
  const normalized = text(value).replace(/^\[(.*)\]$/u, "$1");
  if (!normalized || ["0.0.0.0", "::", "::0", "*"].includes(normalized)) {
    return "127.0.0.1";
  }
  return normalized;
}

export const LOCAL_BASE_URL_ENV_KEYS = ["AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL", "AGENT_PASSPORT_LOCAL_BASE_URL"];

export function resolveLocalBaseUrl(explicitValue = undefined, { overlay = null } = {}) {
  const direct = text(explicitValue);
  if (direct) {
    return {
      value: trimTrailingSlash(direct),
      source: "argument",
      sourceType: "argument",
      sourcePath: null,
    };
  }

  for (const key of LOCAL_BASE_URL_ENV_KEYS) {
    const value = text(process.env[key]);
    if (value) {
      return {
        value: trimTrailingSlash(value),
        source: key,
        sourceType: "env",
        sourcePath: null,
      };
    }
  }

  for (const key of LOCAL_BASE_URL_ENV_KEYS) {
    const value = text(overlay?.values?.[key]);
    if (value) {
      return {
        value: trimTrailingSlash(value),
        source: key,
        sourceType: "env_file",
        sourcePath: overlay?.sourcePaths?.[key] || null,
      };
    }
  }

  const envPort = text(process.env.AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT || process.env.PORT);
  const overlayPort = text(overlay?.values?.AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT || overlay?.values?.PORT);
  const port = envPort || overlayPort || "4319";
  const host = normalizeLoopbackHost(text(process.env.HOST) || text(overlay?.values?.HOST));
  return {
    value: `http://${host}:${port}`,
    source: envPort
      ? text(process.env.AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT)
        ? "AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT"
        : "PORT"
      : overlayPort
        ? text(overlay?.values?.AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT)
          ? "AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT"
          : "PORT"
        : "default",
    sourceType: envPort ? "env" : overlayPort ? "env_file" : "default",
    sourcePath: envPort ? null : overlay?.sourcePaths?.AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT || overlay?.sourcePaths?.PORT || null,
  };
}

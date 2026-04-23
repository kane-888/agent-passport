import { spawnSync } from "node:child_process";

let keychainStatusCache = null;

function toText(value) {
  return String(value ?? "").trim();
}

export function shouldPreferSystemKeychain() {
  const override = toText(process.env.AGENT_PASSPORT_USE_KEYCHAIN).toLowerCase();
  if (["1", "true", "yes", "on"].includes(override)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(override)) {
    return false;
  }
  return process.platform === "darwin";
}

function buildSystemKeychainStatusCacheKey() {
  return JSON.stringify({
    platform: process.platform,
    useKeychain: process.env.AGENT_PASSPORT_USE_KEYCHAIN ?? "",
    path: process.env.PATH ?? "",
  });
}

export function getSystemKeychainStatus() {
  const cacheKey = buildSystemKeychainStatusCacheKey();
  if (keychainStatusCache?.cacheKey === cacheKey) {
    return keychainStatusCache.status;
  }

  if (!shouldPreferSystemKeychain()) {
    const status = {
      preferred: false,
      available: false,
      reason: "disabled_or_non_darwin",
    };
    keychainStatusCache = { cacheKey, status };
    return status;
  }

  const probe = spawnSync("security", ["help"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (probe.error) {
    const status = {
      preferred: true,
      available: false,
      reason: probe.error.code || "spawn_error",
    };
    keychainStatusCache = { cacheKey, status };
    return status;
  }

  const status = {
    preferred: true,
    available: probe.status === 0,
    reason: probe.status === 0 ? "available" : "security_cli_failed",
  };
  keychainStatusCache = { cacheKey, status };
  return status;
}

export function readGenericPasswordFromKeychain(service, account = "default") {
  const result = readGenericPasswordFromKeychainResult(service, account);
  if (result.found) {
    return result.value;
  }
  if (result.ok && result.code === "not_found") {
    return null;
  }
  throw new Error(
    `System keychain read failed for ${toText(service) || "unknown-service"}/${toText(account) || "default"}: ${
      result.reason || result.code || "unknown_error"
    }`
  );
}

export function readGenericPasswordFromKeychainResult(service, account = "default") {
  const status = getSystemKeychainStatus();
  if (!status.available) {
    return {
      ok: false,
      found: false,
      code: "keychain_unavailable",
      reason: status.reason,
      value: null,
      source: "keychain",
    };
  }

  const result = spawnSync(
    "security",
    ["find-generic-password", "-w", "-s", service, "-a", account],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.error) {
    return {
      ok: false,
      found: false,
      code: "backend_error",
      reason: result.error.code || result.error.message || "security_read_failed",
      value: null,
      source: "keychain",
    };
  }

  if (result.status !== 0) {
    const stderr = toText(result.stderr);
    const lowered = stderr.toLowerCase();
    const notFound =
      lowered.includes("could not be found") ||
      lowered.includes("item not found") ||
      lowered.includes("the specified item could not be found in the keychain");
    const accessDenied =
      lowered.includes("user interaction is not allowed") ||
      lowered.includes("interaction is not allowed") ||
      lowered.includes("authorization");
    return {
      ok: notFound,
      found: false,
      code: notFound ? "not_found" : accessDenied ? "access_denied" : "backend_error",
      reason: stderr || `security_read_failed:${result.status}`,
      value: null,
      source: "keychain",
    };
  }

  const value = toText(result.stdout);
  if (!value) {
    return {
      ok: true,
      found: false,
      code: "not_found",
      reason: "empty_value",
      value: null,
      source: "keychain",
    };
  }

  return {
    ok: true,
    found: true,
    code: "ok",
    reason: "available",
    value,
    source: "keychain",
  };
}

export function writeGenericPasswordToKeychain(service, account = "default", value) {
  const status = getSystemKeychainStatus();
  if (!status.available) {
    return {
      ok: false,
      source: "keychain",
      reason: status.reason,
    };
  }

  const text = toText(value);
  if (!text) {
    throw new Error("value is required");
  }

  const result = spawnSync(
    "security",
    ["add-generic-password", "-U", "-s", service, "-a", account, "-w", text],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.error || result.status !== 0) {
    return {
      ok: false,
      source: "keychain",
      reason: toText(result.stderr) || result.error?.message || "security_write_failed",
    };
  }

  return {
    ok: true,
    source: "keychain",
  };
}

export function deleteGenericPasswordFromKeychain(service, account = "default") {
  const status = getSystemKeychainStatus();
  if (!status.available) {
    return {
      ok: false,
      source: "keychain",
      reason: status.reason,
    };
  }

  const result = spawnSync(
    "security",
    ["delete-generic-password", "-s", service, "-a", account],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.error || result.status !== 0) {
    return {
      ok: false,
      source: "keychain",
      reason: toText(result.stderr) || result.error?.message || "security_delete_failed",
    };
  }

  return {
    ok: true,
    source: "keychain",
  };
}

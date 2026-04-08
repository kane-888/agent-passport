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

export function getSystemKeychainStatus() {
  if (keychainStatusCache) {
    return keychainStatusCache;
  }

  if (!shouldPreferSystemKeychain()) {
    keychainStatusCache = {
      preferred: false,
      available: false,
      reason: "disabled_or_non_darwin",
    };
    return keychainStatusCache;
  }

  const probe = spawnSync("security", ["help"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (probe.error) {
    keychainStatusCache = {
      preferred: true,
      available: false,
      reason: probe.error.code || "spawn_error",
    };
    return keychainStatusCache;
  }

  keychainStatusCache = {
    preferred: true,
    available: probe.status === 0,
    reason: probe.status === 0 ? "available" : "security_cli_failed",
  };
  return keychainStatusCache;
}

export function readGenericPasswordFromKeychain(service, account = "default") {
  const status = getSystemKeychainStatus();
  if (!status.available) {
    return null;
  }

  const result = spawnSync(
    "security",
    ["find-generic-password", "-w", "-s", service, "-a", account],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  const value = toText(result.stdout);
  return value || null;
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

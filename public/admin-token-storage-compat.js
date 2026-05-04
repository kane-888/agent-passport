// 属性：兼容。
// 正式浏览器契约只认 agent-passport 的 canonical session key；
// 这里保留旧 OpenNeed key 的被动读取与迁移，避免 compat 逻辑散落回公开运行态本体。

export const ADMIN_TOKEN_STORAGE_KEY = "agent-passport.admin-token-session";
export const LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY = "openneed-runtime.admin-token-session";
export const LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY = "openneed-agent-passport.admin-token";

function normalizeStoredToken(value) {
  return String(value ?? "").trim();
}

function readStorageValue(storage, key) {
  try {
    return typeof storage?.getItem === "function" ? storage.getItem(key) || "" : "";
  } catch {
    return "";
  }
}

function writeStorageValue(storage, key, value) {
  try {
    if (typeof storage?.setItem === "function") {
      storage.setItem(key, value);
      return true;
    }
  } catch {}
  return false;
}

function removeStorageValue(storage, key) {
  try {
    if (typeof storage?.removeItem === "function") {
      storage.removeItem(key);
    }
  } catch {}
}

export function clearLegacyStoredAdminToken({
  sessionStorage = globalThis?.sessionStorage,
  localStorage = globalThis?.localStorage,
} = {}) {
  removeStorageValue(sessionStorage, LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY);
  removeStorageValue(localStorage, LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY);
}

export function readStoredAdminToken({
  sessionStorage = globalThis?.sessionStorage,
  localStorage = globalThis?.localStorage,
} = {}) {
  return normalizeStoredToken(
    readStorageValue(sessionStorage, ADMIN_TOKEN_STORAGE_KEY) ||
      readStorageValue(sessionStorage, LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY) ||
      readStorageValue(localStorage, LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY)
  );
}

export function buildAdminTokenHeaders({
  token = null,
  headers = {},
  includeJsonContentType = true,
  sessionStorage = globalThis?.sessionStorage,
  localStorage = globalThis?.localStorage,
} = {}) {
  const normalizedToken =
    token == null ? readStoredAdminToken({ sessionStorage, localStorage }) : normalizeStoredToken(token);
  return {
    ...(includeJsonContentType ? { "Content-Type": "application/json" } : {}),
    ...(normalizedToken ? { Authorization: `Bearer ${normalizedToken}` } : {}),
    ...(headers && typeof headers === "object" ? headers : {}),
  };
}

export function writeStoredAdminToken(
  token,
  {
    sessionStorage = globalThis?.sessionStorage,
    localStorage = globalThis?.localStorage,
  } = {}
) {
  const normalized = normalizeStoredToken(token);
  if (normalized) {
    if (writeStorageValue(sessionStorage, ADMIN_TOKEN_STORAGE_KEY, normalized)) {
      clearLegacyStoredAdminToken({ sessionStorage, localStorage });
    }
  } else {
    removeStorageValue(sessionStorage, ADMIN_TOKEN_STORAGE_KEY);
    clearLegacyStoredAdminToken({ sessionStorage, localStorage });
  }
  return readStoredAdminToken({ sessionStorage, localStorage });
}

export function migrateStoredAdminToken({
  sessionStorage = globalThis?.sessionStorage,
  localStorage = globalThis?.localStorage,
} = {}) {
  const currentPrimaryToken = normalizeStoredToken(readStorageValue(sessionStorage, ADMIN_TOKEN_STORAGE_KEY));
  const legacySessionToken = normalizeStoredToken(readStorageValue(sessionStorage, LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY));
  const legacyLocalToken = normalizeStoredToken(readStorageValue(localStorage, LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY));
  const legacyToken = legacySessionToken || legacyLocalToken;

  if (currentPrimaryToken) {
    if (legacyToken) {
      clearLegacyStoredAdminToken({ sessionStorage, localStorage });
    }
    return currentPrimaryToken;
  }

  if (legacyToken) {
    const primaryReady = writeStorageValue(sessionStorage, ADMIN_TOKEN_STORAGE_KEY, legacyToken);
    if (primaryReady) {
      clearLegacyStoredAdminToken({ sessionStorage, localStorage });
    }
    return readStoredAdminToken({ sessionStorage, localStorage });
  }

  return "";
}

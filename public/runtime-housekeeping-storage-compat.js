// 属性：兼容。
// 正式维护记录只认 agent-passport 的 canonical session key；
// 这里保留旧 OpenNeed key 的被动读取与迁移，避免这层兼容残留继续挂在公开运行态 helper 上。

export const RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY =
  "agent-passport.runtime-housekeeping-last-report-session";

export const LEGACY_RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY =
  "openneed-runtime.runtime-housekeeping-last-report-session";

export const LEGACY_RUNTIME_HOUSEKEEPING_LAST_REPORT_LOCAL_STORAGE_KEY =
  "openneed-agent-passport.runtime-housekeeping-last-report";

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

function parseStoredReport(raw) {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function clearLegacyStoredRuntimeHousekeepingLastReport({
  sessionStorage = globalThis?.sessionStorage,
  localStorage = globalThis?.localStorage,
} = {}) {
  removeStorageValue(sessionStorage, LEGACY_RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY);
  removeStorageValue(localStorage, LEGACY_RUNTIME_HOUSEKEEPING_LAST_REPORT_LOCAL_STORAGE_KEY);
}

export function readStoredRuntimeHousekeepingLastReport({
  sessionStorage = globalThis?.sessionStorage,
  localStorage = globalThis?.localStorage,
} = {}) {
  return (
    parseStoredReport(readStorageValue(sessionStorage, RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY)) ||
    parseStoredReport(readStorageValue(sessionStorage, LEGACY_RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY)) ||
    parseStoredReport(readStorageValue(localStorage, LEGACY_RUNTIME_HOUSEKEEPING_LAST_REPORT_LOCAL_STORAGE_KEY))
  );
}

export function writeStoredRuntimeHousekeepingLastReport(
  payload,
  {
    sessionStorage = globalThis?.sessionStorage,
    localStorage = globalThis?.localStorage,
  } = {}
) {
  const hasPayload = payload && typeof payload === "object";
  if (hasPayload) {
    if (
      writeStorageValue(
        sessionStorage,
        RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY,
        JSON.stringify(payload)
      )
    ) {
      clearLegacyStoredRuntimeHousekeepingLastReport({ sessionStorage, localStorage });
    }
  } else {
    removeStorageValue(sessionStorage, RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY);
    clearLegacyStoredRuntimeHousekeepingLastReport({ sessionStorage, localStorage });
  }
  return readStoredRuntimeHousekeepingLastReport({ sessionStorage, localStorage });
}

export function migrateStoredRuntimeHousekeepingLastReport({
  sessionStorage = globalThis?.sessionStorage,
  localStorage = globalThis?.localStorage,
} = {}) {
  const currentReport = parseStoredReport(
    readStorageValue(sessionStorage, RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY)
  );
  if (currentReport) {
    clearLegacyStoredRuntimeHousekeepingLastReport({ sessionStorage, localStorage });
    return currentReport;
  }

  const legacyReport = readStoredRuntimeHousekeepingLastReport({ sessionStorage, localStorage });
  if (legacyReport) {
    return (
      writeStoredRuntimeHousekeepingLastReport(legacyReport, {
        sessionStorage,
        localStorage,
      }) || legacyReport
    );
  }

  clearLegacyStoredRuntimeHousekeepingLastReport({ sessionStorage, localStorage });
  return null;
}

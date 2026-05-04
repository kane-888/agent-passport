import { ISSUE_BOTH_METHODS_REPAIR_ONLY_ERROR, normalizeDidMethod } from "./protocol.js";

export function normalizeOptionalText(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

export function json(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  const method = (res.req?.agentPassportOriginalMethod || res.req?.method || "GET").toUpperCase();
  if (method === "HEAD") {
    return res.end();
  }
  res.end(JSON.stringify(body, null, 2));
}

export function toBooleanParam(value) {
  if (value == null) {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "summary", "compact"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off", "full"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function getFirstNamedSearchParam(url, names = []) {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value != null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

export function normalizeDidMethodInput(value, { label = "didMethod" } = {}) {
  const raw = normalizeOptionalText(value);
  if (!raw) {
    return undefined;
  }
  const normalized = normalizeDidMethod(raw, null);
  if (!normalized) {
    throw new Error(`Unsupported ${label}: ${raw}`);
  }
  return normalized;
}

export function getDidMethodParam(url, names = ["didMethod", "method"]) {
  const raw = getFirstNamedSearchParam(url, names);
  return normalizeDidMethodInput(raw, {
    label: Array.isArray(names) && names.length > 0 ? names[0] : "didMethod",
  });
}

export function getSearchParam(url, name) {
  return url.searchParams.get(name) || undefined;
}

export function getContextQueryOptions(
  url,
  {
    includeDidMethod = false,
    includeRuntimeLimit = true,
    includeResumeFromCompactBoundaryId = false,
  } = {}
) {
  const options = {
    messageLimit: getSearchParam(url, "messageLimit"),
    memoryLimit: getSearchParam(url, "memoryLimit"),
    authorizationLimit: getSearchParam(url, "authorizationLimit"),
    credentialLimit: getSearchParam(url, "credentialLimit"),
  };
  if (includeRuntimeLimit) {
    options.runtimeLimit = getSearchParam(url, "runtimeLimit");
  }
  if (includeDidMethod) {
    options.didMethod = getDidMethodParam(url);
  }
  if (includeResumeFromCompactBoundaryId) {
    options.resumeFromCompactBoundaryId = getSearchParam(url, "resumeFromCompactBoundaryId");
  }
  return options;
}

export function normalizeIssueBothMethodsInput(
  value,
  {
    allow = true,
    label = "issueBothMethods",
    reason = ISSUE_BOTH_METHODS_REPAIR_ONLY_ERROR,
  } = {}
) {
  const normalized = toBooleanParam(value);
  if (normalized === true && !allow) {
    throw new Error(reason);
  }
  return normalized;
}

export function getIssueBothMethodsParam(url, options = undefined) {
  return normalizeIssueBothMethodsInput(url.searchParams.get("issueBothMethods"), options);
}

export function getRequestAccess(req) {
  return req.agentPassportAccess || null;
}

export function filterReadSessionEntries(access, entries, matcher) {
  if (!access || access.mode !== "read_session") {
    return entries;
  }
  return Array.isArray(entries) ? entries.filter((entry) => matcher(access, entry)) : [];
}

export function applyFilteredCount(payload, filteredEntries, countField = "count") {
  return {
    ...payload,
    [countField]: Array.isArray(filteredEntries) ? filteredEntries.length : payload?.[countField] ?? 0,
  };
}

export function applyFilteredCountsAndPage(payload, filteredEntries) {
  const total = Array.isArray(filteredEntries) ? filteredEntries.length : 0;
  return {
    ...payload,
    counts: {
      ...(payload?.counts || {}),
      total,
    },
    page: {
      ...(payload?.page || {}),
      total,
      hasMore: false,
    },
  };
}

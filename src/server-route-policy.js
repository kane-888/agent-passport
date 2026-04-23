export const SECURITY_ADMIN_ONLY_PATHS = Object.freeze([
  "/api/ledger",
  "/api/security/incident-packet",
  "/api/security/incident-packet/history",
  "/api/security/incident-packet/export",
  "/api/security/admin-token/rotate",
  "/api/security/keychain-migration",
  "/api/agents/compare",
  "/api/agents/compare/evidence",
  "/api/agents/compare/audits",
]);

export const SECURITY_READ_SCOPE_PATHS = Object.freeze([
  "/api/security",
  "/api/security/posture",
  "/api/security/anomalies",
  "/api/security/runtime-housekeeping",
  "/api/security/incident-packet",
  "/api/security/incident-packet/history",
  "/api/security/incident-packet/export",
]);

export const SECURITY_MAINTENANCE_WRITE_PATHS = Object.freeze([
  "/api/security/posture",
  "/api/security/admin-token/rotate",
  "/api/security/keychain-migration",
  "/api/security/runtime-housekeeping",
  "/api/security/incident-packet/export",
  "/api/security/read-sessions",
  "/api/security/read-sessions/revoke-all",
]);

export function isSecurityReadSessionRevokePath(pathname) {
  return /^\/api\/security\/read-sessions\/[^/]+\/revoke$/u.test(pathname);
}

function isExactPath(pathname, paths) {
  return paths.includes(pathname);
}

export function isPublicApiPath(pathname) {
  return [
    "/api/health",
    "/api/protocol",
    "/api/capabilities",
    "/api/roadmap",
    "/api/security",
  ].includes(pathname);
}

export function isAdminOnlyApiPath(pathname, method = "GET") {
  if (isExactPath(pathname, SECURITY_ADMIN_ONLY_PATHS)) {
    return true;
  }
  if (pathname === "/api/security/anomalies") {
    return false;
  }
  if (pathname === "/api/security/posture") {
    return false;
  }
  if (pathname === "/api/security/read-sessions") {
    return (method || "GET").toUpperCase() !== "POST";
  }
  return pathname.startsWith("/api/security/read-sessions/");
}

export function requiresApiWriteToken(req, pathname) {
  if (!pathname.startsWith("/api/")) {
    return false;
  }
  if (["GET", "HEAD", "OPTIONS"].includes(req.method || "GET")) {
    return false;
  }
  return true;
}

export function requiresApiReadToken(req, pathname) {
  if (!pathname.startsWith("/api/")) {
    return false;
  }
  if (isPublicApiPath(pathname)) {
    return false;
  }
  return ["GET", "HEAD"].includes(req.method || "GET");
}

export function resolveApiReadScope(pathname, segments = []) {
  if (segments[1] === "offline-chat") {
    return "offline_chat";
  }
  if (pathname === "/api/agents/resolve") {
    return "agents_identity";
  }
  if (isExactPath(pathname, [
    "/api/agents/compare",
    "/api/agents/compare/evidence",
    "/api/agents/compare/audits",
  ])) {
    return null;
  }
  if (isExactPath(pathname, SECURITY_READ_SCOPE_PATHS)) {
    return "security";
  }
  if (pathname.startsWith("/api/device/runtime/recovery")) {
    return "recovery";
  }
  if (pathname.startsWith("/api/device/setup")) {
    return "device_runtime";
  }
  if (pathname.startsWith("/api/device/runtime")) {
    return "device_runtime";
  }
  if (segments[1] === "windows") {
    return segments[2] ? "windows_detail" : "windows_catalog";
  }
  if (segments[1] === "status-lists") {
    if (pathname === "/api/status-lists/compare") {
      return "status_lists_compare";
    }
    return segments[2] ? "status_lists_detail" : "status_lists_catalog";
  }
  if (segments[1] === "credentials") {
    if (!segments[2]) {
      return "credentials_catalog";
    }
    if (segments[3] === "timeline") {
      return "credentials_timeline";
    }
    if (segments[3] === "status") {
      return "credentials_status";
    }
    return "credentials_detail";
  }
  if (segments[1] === "authorizations") {
    if (!segments[2]) {
      return "authorizations_catalog";
    }
    if (segments[3] === "timeline") {
      return "authorizations_timeline";
    }
    if (segments[3] === "credential") {
      return "authorizations_credential";
    }
    return "authorizations_detail";
  }
  if (segments[1] === "migration-repairs") {
    if (!segments[2]) {
      return "migration_repairs_catalog";
    }
    if (segments[3] === "timeline") {
      return "migration_repairs_timeline";
    }
    if (segments[3] === "credentials") {
      return "migration_repairs_credentials";
    }
    return "migration_repairs_detail";
  }
  if (segments[1] === "agents") {
    if (!segments[2]) {
      return "agents_catalog";
    }
    const action = segments[3];
    if (!action) {
      return "agents_identity";
    }
    if (action === "identity" || action === "did") {
      return "agents_identity";
    }
    if (action === "assets") {
      return "agents_assets";
    }
    if (action === "context") {
      return "agents_context";
    }
    if (action === "credential") {
      return "credentials_detail";
    }
    if (action === "runtime" && !segments[4]) {
      return "agents_runtime";
    }
    if (action === "runtime-summary") {
      return "agents_runtime";
    }
    if (action === "runtime" && segments[4] === "stability") {
      return "agents_runtime";
    }
    if (action === "runtime" && segments[4] === "minutes") {
      return "agents_runtime_minutes";
    }
    if (action === "runtime" && segments[4] === "search") {
      return "agents_runtime_search";
    }
    if (action === "runtime" && segments[4] === "actions") {
      return "agents_runtime_actions";
    }
    if (action === "runtime" && segments[4] === "rehydrate") {
      return "agents_rehydrate";
    }
    if (action === "memories" || action === "passport-memory") {
      return "agents_memories";
    }
    if (action === "archives" || action === "archive-restores") {
      return "agents_memories";
    }
    if (action === "runner") {
      return "agents_runner";
    }
    if (action === "query-states") {
      return "agents_query_states";
    }
    if (action === "session-state") {
      return "agents_session_state";
    }
    if (action === "cognitive-state" || action === "cognitive-transitions") {
      return "agents_session_state";
    }
    if (action === "compact-boundaries") {
      return "agents_compact_boundaries";
    }
    if (action === "verification-runs") {
      return "agents_verification_runs";
    }
    if (action === "transcript") {
      return "agents_transcript";
    }
    if (action === "messages") {
      return "agents_messages";
    }
    if (action === "authorizations") {
      return "agents_authorizations";
    }
    return "agents_context";
  }
  return null;
}

export function resolveApiReadScopes(pathname, segments = []) {
  const primaryScope = resolveApiReadScope(pathname, segments);
  if (!primaryScope) {
    return [];
  }
  if (pathname.startsWith("/api/device/setup")) {
    return ["device_runtime", "recovery"];
  }
  return [primaryScope];
}

export function isSecurityMaintenanceWritePath(pathname, method = "GET") {
  if ((method || "GET").toUpperCase() === "GET") {
    return false;
  }
  if (isExactPath(pathname, SECURITY_MAINTENANCE_WRITE_PATHS)) {
    return true;
  }
  return isSecurityReadSessionRevokePath(pathname);
}

export function isExecutionApiPath(pathname, segments = [], method = "GET") {
  const normalizedMethod = (method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) {
    return false;
  }
  if (pathname === "/api/agents/compare/verify") {
    return false;
  }
  if (
    pathname === "/api/device/runtime/model-profiles/profile" ||
    pathname === "/api/device/runtime" ||
    pathname === "/api/device/setup" ||
    pathname === "/api/device/setup/packages" ||
    pathname === "/api/device/setup/package" ||
    pathname === "/api/device/setup/package/import" ||
    pathname === "/api/device/runtime/recovery" ||
    pathname === "/api/device/runtime/recovery/verify" ||
    pathname === "/api/device/runtime/recovery/import" ||
    pathname === "/api/device/runtime/local-reasoner/select" ||
    pathname === "/api/device/runtime/local-reasoner/probe" ||
    pathname === "/api/device/runtime/local-reasoner/prewarm" ||
    pathname === "/api/device/runtime/local-reasoner/migrate-default" ||
    pathname === "/api/device/runtime/local-reasoner/restore" ||
    pathname === "/api/device/runtime/local-reasoner/profiles"
  ) {
    return true;
  }
  if (segments[0] !== "api") {
    return false;
  }
  if (
    segments[1] === "device" &&
    segments[2] === "setup" &&
    segments[3] === "packages" &&
    segments[4] &&
    segments[5] === "delete"
  ) {
    return true;
  }
  if (segments[1] === "agents" && segments[2] === "compare" && segments[3] === "evidence") {
    return true;
  }
  if (segments[1] === "agents" && segments[3] === "context-builder") {
    return false;
  }
  if (segments[1] === "agents" && segments[3] === "response-verify") {
    return false;
  }
  if (segments[1] === "agents" && segments[3] === "runtime" && segments[4] === "drift-check") {
    return false;
  }
  if (segments[1] === "agents" && !segments[3]) {
    return true;
  }
  if (segments[1] === "agents" && segments[3] === "runner") {
    return true;
  }
  if (
    segments[1] === "agents" &&
    segments[3] === "runtime" &&
    ["snapshot", "decisions", "evidence", "minutes"].includes(segments[4] || "")
  ) {
    return true;
  }
  if (segments[1] === "agents" && segments[3] === "runtime" && segments[4] === "bootstrap") {
    return true;
  }
  if (segments[1] === "agents" && segments[3] === "runtime" && segments[4] === "actions") {
    return true;
  }
  if (segments[1] === "agents" && segments[3] === "runtime" && segments[4] === "stability") {
    return true;
  }
  if (segments[1] === "agents" && segments[3] === "migration" && segments[4] === "repair") {
    return true;
  }
  if (segments[1] === "agents" && segments[2] === "compare" && segments[3] === "migration" && segments[4] === "repair") {
    return true;
  }
  if (segments[1] === "agents" && segments[3] === "verification-runs") {
    return true;
  }
  if (segments[1] === "agents" && segments[3] === "offline-replay") {
    return true;
  }
  if (
    segments[1] === "agents" &&
    [
      "memories",
      "passport-memory",
      "memory-compactor",
      "messages",
      "policy",
      "fork",
      "grants",
    ].includes(segments[3] || "")
  ) {
    return true;
  }
  if (
    segments[1] === "agents" &&
    (
      (segments[3] === "archives" && segments[4] === "restore") ||
      (segments[3] === "archive-restores" && segments[4] === "revert")
    )
  ) {
    return true;
  }
  if (
    segments[1] === "device" &&
    segments[2] === "runtime" &&
    segments[3] === "local-reasoner" &&
    segments[4] === "profiles" &&
    segments[5] &&
    ["activate", "delete"].includes(segments[6] || "")
  ) {
    return true;
  }
  if (segments[1] === "credentials" && segments[2] && segments[3] === "revoke") {
    return true;
  }
  if (
    segments[1] === "authorizations" &&
    (!segments[2] || ["sign", "execute", "revoke"].includes(segments[3] || ""))
  ) {
    return true;
  }
  if (segments[1] === "windows" && segments[2] === "link") {
    return true;
  }
  if (segments[1] === "offline-chat" && segments[2] === "sync" && segments[3] === "flush") {
    return true;
  }
  if (segments[1] === "offline-chat" && segments[2] === "threads" && segments[4] === "messages") {
    return true;
  }
  return false;
}

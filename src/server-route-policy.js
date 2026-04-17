export function isPublicApiPath(pathname) {
  return ["/api/health", "/api/protocol", "/api/capabilities", "/api/roadmap", "/api/security"].includes(pathname);
}

export function isAdminOnlyApiPath(pathname, method = "GET") {
  if (pathname === "/api/ledger") {
    return true;
  }
  if (pathname === "/api/security/incident-packet" || pathname === "/api/security/incident-packet/history") {
    return true;
  }
  if (pathname === "/api/security/incident-packet/export") {
    return true;
  }
  if (pathname === "/api/security/admin-token/rotate") {
    return true;
  }
  if (pathname === "/api/security/keychain-migration") {
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
  if (
    pathname === "/api/agents/compare" ||
    pathname === "/api/agents/compare/evidence" ||
    pathname === "/api/agents/compare/audits"
  ) {
    return true;
  }
  return pathname.startsWith("/api/security/read-sessions/");
}

export function requiresApiWriteToken(req, pathname) {
  if (!pathname.startsWith("/api/")) {
    return false;
  }
  if (isPublicApiPath(pathname)) {
    return false;
  }
  return !["GET", "HEAD", "OPTIONS"].includes(req.method || "GET");
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
  if (pathname === "/api/agents/resolve") {
    return "agents_identity";
  }
  if (
    pathname === "/api/agents/compare" ||
    pathname === "/api/agents/compare/evidence" ||
    pathname === "/api/agents/compare/audits"
  ) {
    return null;
  }
  if (
    pathname === "/api/security" ||
    pathname === "/api/security/posture" ||
    pathname === "/api/security/anomalies" ||
    pathname === "/api/security/runtime-housekeeping" ||
    pathname === "/api/security/incident-packet" ||
    pathname === "/api/security/incident-packet/history" ||
    pathname === "/api/security/incident-packet/export"
  ) {
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
  return [
    "/api/security/posture",
    "/api/security/admin-token/rotate",
    "/api/security/keychain-migration",
    "/api/security/runtime-housekeeping",
    "/api/security/incident-packet/export",
    "/api/security/read-sessions",
    "/api/security/read-sessions/revoke-all",
  ].includes(pathname) || pathname.startsWith("/api/security/read-sessions/");
}

export function isExecutionApiPath(pathname, segments = [], method = "GET") {
  if ((method || "GET").toUpperCase() === "GET") {
    return false;
  }
  if (pathname === "/api/device/runtime/local-reasoner/probe" || pathname === "/api/device/runtime/local-reasoner/prewarm") {
    return true;
  }
  if (segments[0] !== "api") {
    return false;
  }
  if (segments[1] === "agents" && segments[3] === "runner") {
    return true;
  }
  if (segments[1] === "agents" && segments[3] === "runtime" && segments[4] === "actions") {
    return true;
  }
  if (segments[1] === "authorizations" && ["sign", "execute"].includes(segments[3] || "")) {
    return true;
  }
  if (segments[1] === "agents" && segments[2] === "compare" && segments[3] === "migration" && segments[4] === "repair") {
    return true;
  }
  if (segments[1] === "agents" && segments[3] === "migration" && segments[4] === "repair") {
    return true;
  }
  return false;
}

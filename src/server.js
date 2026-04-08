import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAuthorizationProposal,
  bootstrapAgentRuntime,
  compareCredentialStatusLists,
  compareAgents,
  buildAgentContextBundle,
  compactAgentMemory,
  executeAgentSandboxAction,
  executeAuthorizationProposal,
  executeVerificationRun,
  exportStoreRecoveryBundle,
  forkAgent,
  getAgent,
  getAgentComparisonEvidence,
  getAgentCredential,
  getAgentContext,
  getAgentRehydratePack,
  getAgentRuntime,
  getAgentSessionState,
  getCapabilities,
  getProtocol,
  getRoadmap,
  getAuthorizationProposal,
  getAuthorizationProposalCredential,
  getAuthorizationProposalTimeline,
  getCredential,
  getCredentialTimeline,
  getCredentialStatus,
  getCredentialStatusList,
  getCurrentSecurityPostureState,
  getLedger,
  getStoreEncryptionStatus,
  getMigrationRepair,
  getMigrationRepairCredentials,
  getMigrationRepairTimeline,
  getWindow,
  grantAsset,
  linkWindow,
  listAuthorizationProposals,
  listAuthorizationProposalsByAgent,
  listAgentComparisonAudits,
  listCompactBoundaries,
  listConversationMinutes,
  listCredentials,
  listCredentialStatusLists,
  listSecurityAnomalies,
  listAgentSandboxActionAudits,
  listMigrationRepairs,
  listReadSessionRoles,
  listAgentTranscript,
  listAgentQueryStates,
  listAgentRuns,
  listVerificationRuns,
  listMessages,
  listMemories,
  listWindows,
  recordMemory,
  recordConversationMinute,
  recordDecisionLog,
  recordEvidenceRef,
  recordTaskSnapshot,
  repairAgentComparisonMigration,
  repairAgentCredentialMigration,
  resolveAgentIdentity,
  routeMessage,
  searchAgentRuntimeKnowledge,
  activateDeviceLocalReasonerProfile,
  listAgents,
  registerAgent,
  revokeAuthorizationProposal,
  revokeAllReadSessions,
  revokeCredential,
  checkAgentContextDrift,
  signAuthorizationProposal,
  executeAgentRunner,
  verifyAgentResponse,
  verifyCredential,
  validateReadSessionToken,
  writePassportMemory,
  listPassportMemories,
  updateAgentPolicy,
  recordSecurityAnomaly,
} from "./ledger.js";
import { getSigningMasterSecretStatus } from "./identity.js";
import {
  deleteGenericPasswordFromKeychain,
  getSystemKeychainStatus,
  readGenericPasswordFromKeychain,
  shouldPreferSystemKeychain,
  writeGenericPasswordToKeychain,
} from "./local-secrets.js";
import {
  applyFilteredCount,
  applyFilteredCountsAndPage,
  filterReadSessionEntries,
  getContextQueryOptions,
  getDidMethodParam,
  getIssueBothMethodsParam,
  getRequestAccess,
  getSearchParam,
  json,
  normalizeOptionalText,
  toBooleanParam,
} from "./server-base-helpers.js";
import {
  agentMatchesReadSession,
  authorizationMatchesReadSession,
  credentialMatchesReadSession,
  denyReadSessionResource,
  ensureAgentReadAccess,
  ensureReadSessionResource,
  hasAllReadRole,
  hasReadSessionAccess,
  migrationRepairMatchesReadSession,
  shouldRedactReadSessionPayload,
  statusListMatchesReadSession,
  windowMatchesReadSession,
} from "./server-read-access.js";
import {
  redactAgentContextForReadSession,
  redactAgentRecordForReadSession,
  redactAgentRehydratePackForReadSession,
  redactAgentRunForReadSession,
  redactAgentRuntimeForReadSession,
  redactAuthorizationViewForReadSession,
  redactCompactBoundaryForReadSession,
  redactConversationMinuteForReadSession,
  redactCredentialExportForReadSession,
  redactCredentialRecordForReadSession,
  redactIdentityForReadSession,
  redactMemoryForReadSession,
  redactMigrationRepairViewForReadSession,
  redactMessageForReadSession,
  redactPassportMemoryForReadSession,
  redactQueryStateForReadSession,
  redactRuntimeSearchHitForReadSession,
  redactSandboxActionAuditForReadSession,
  redactSessionStateForReadSession,
  redactStatusListComparisonForReadSession,
  redactStatusListDetailForReadSession,
  redactStatusListSummaryForReadSession,
  redactTimelineEntryForReadSession,
  redactTranscriptEntryForReadSession,
  summarizeCredentialDocumentForReadSession,
} from "./server-agent-redaction.js";
import {
  redactSecurityPayloadForReadSession,
} from "./server-security-redaction.js";
import {
  isAdminOnlyApiPath,
  isExecutionApiPath,
  isPublicApiPath,
  isSecurityMaintenanceWritePath,
  requiresApiReadToken,
  requiresApiWriteToken,
  resolveApiReadScope,
} from "./server-route-policy.js";
import { handleAgentRoutes } from "./server-agent-routes.js";
import { handleRecordRoutes } from "./server-record-routes.js";
import { handleSecurityRoutes } from "./server-security-routes.js";
import { handleDeviceRoutes } from "./server-device-routes.js";
import { handleOfflineChatRoutes } from "./server-offline-chat-routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const DATA_DIR = path.join(__dirname, "..", "data");
const PORT = Number(process.env.PORT || 4319);
const HOST = process.env.HOST || "127.0.0.1";
const ADMIN_TOKEN_PATH = process.env.AGENT_PASSPORT_ADMIN_TOKEN_PATH || path.join(DATA_DIR, ".admin-token");
const ADMIN_TOKEN_KEYCHAIN_SERVICE = "AgentPassport.AdminToken";
const ADMIN_TOKEN_KEYCHAIN_ACCOUNT = process.env.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT || "resident-default";
let adminTokenPromise = null;

async function loadOrCreateAdminToken() {
  if (adminTokenPromise) {
    return adminTokenPromise;
  }

  adminTokenPromise = (async () => {
    const explicitToken = normalizeOptionalText(process.env.AGENT_PASSPORT_ADMIN_TOKEN);
    if (explicitToken) {
      return {
        token: explicitToken,
        source: "env",
        path: null,
        service: null,
        account: null,
      };
    }

    const keychain = getSystemKeychainStatus();
    if (shouldPreferSystemKeychain() && keychain.available) {
      const keychainToken = readGenericPasswordFromKeychain(
        ADMIN_TOKEN_KEYCHAIN_SERVICE,
        ADMIN_TOKEN_KEYCHAIN_ACCOUNT
      );
      if (keychainToken) {
        return {
          token: keychainToken,
          source: "keychain",
          path: null,
          service: ADMIN_TOKEN_KEYCHAIN_SERVICE,
          account: ADMIN_TOKEN_KEYCHAIN_ACCOUNT,
        };
      }
    }

    await mkdir(path.dirname(ADMIN_TOKEN_PATH), { recursive: true });
    try {
      const raw = normalizeOptionalText(await readFile(ADMIN_TOKEN_PATH, "utf8"));
      if (raw) {
        if (shouldPreferSystemKeychain() && keychain.available) {
          const migrated = writeGenericPasswordToKeychain(
            ADMIN_TOKEN_KEYCHAIN_SERVICE,
            ADMIN_TOKEN_KEYCHAIN_ACCOUNT,
            raw
          );
          if (migrated.ok) {
            try {
              await unlink(ADMIN_TOKEN_PATH);
            } catch (error) {
              if (error?.code !== "ENOENT") {
                throw error;
              }
            }
            return {
              token: raw,
              source: "keychain",
              path: null,
              service: ADMIN_TOKEN_KEYCHAIN_SERVICE,
              account: ADMIN_TOKEN_KEYCHAIN_ACCOUNT,
            };
          }
        }
        return {
          token: raw,
          source: "file",
          path: ADMIN_TOKEN_PATH,
          service: null,
          account: null,
        };
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    const generated = `${randomBytes(16).toString("hex")}.${randomBytes(16).toString("hex")}`;
    if (shouldPreferSystemKeychain() && keychain.available) {
      const stored = writeGenericPasswordToKeychain(
        ADMIN_TOKEN_KEYCHAIN_SERVICE,
        ADMIN_TOKEN_KEYCHAIN_ACCOUNT,
        generated
      );
      if (stored.ok) {
        return {
          token: generated,
          source: "keychain",
          path: null,
          service: ADMIN_TOKEN_KEYCHAIN_SERVICE,
          account: ADMIN_TOKEN_KEYCHAIN_ACCOUNT,
        };
      }
    }

    await writeFile(ADMIN_TOKEN_PATH, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
    return {
      token: generated,
      source: "file",
      path: ADMIN_TOKEN_PATH,
      service: null,
      account: null,
    };
  })();

  return adminTokenPromise;
}

async function persistAdminTokenRecord(token) {
  const normalizedToken = normalizeOptionalText(token);
  if (!normalizedToken) {
    throw new Error("Admin token is required");
  }
  const explicitToken = normalizeOptionalText(process.env.AGENT_PASSPORT_ADMIN_TOKEN);
  if (explicitToken) {
    return {
      token: explicitToken,
      source: "env",
      path: null,
      service: null,
      account: null,
      managed: false,
      rotated: false,
    };
  }

  const keychain = getSystemKeychainStatus();
  if (shouldPreferSystemKeychain() && keychain.available) {
    const stored = writeGenericPasswordToKeychain(
      ADMIN_TOKEN_KEYCHAIN_SERVICE,
      ADMIN_TOKEN_KEYCHAIN_ACCOUNT,
      normalizedToken
    );
    if (stored.ok) {
      try {
        await unlink(ADMIN_TOKEN_PATH);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
      return {
        token: normalizedToken,
        source: "keychain",
        path: null,
        service: ADMIN_TOKEN_KEYCHAIN_SERVICE,
        account: ADMIN_TOKEN_KEYCHAIN_ACCOUNT,
        managed: true,
        rotated: true,
      };
    }
  }

  await mkdir(path.dirname(ADMIN_TOKEN_PATH), { recursive: true });
  await writeFile(ADMIN_TOKEN_PATH, `${normalizedToken}\n`, { encoding: "utf8", mode: 0o600 });
  return {
    token: normalizedToken,
    source: "file",
    path: ADMIN_TOKEN_PATH,
    service: null,
    account: null,
    managed: true,
    rotated: true,
  };
}

async function rotateAdminToken({
  dryRun = false,
  revokeReadSessions: shouldRevokeReadSessions = true,
  note = null,
  rotatedByAgentId = null,
  rotatedByWindowId = null,
  rotatedByReadSessionId = null,
} = {}) {
  const current = await loadOrCreateAdminToken();
  if (current.source === "env") {
    return {
      rotated: false,
      skipped: true,
      dryRun,
      reason: "env_managed",
      currentSource: current.source,
      revokeReadSessions: false,
    };
  }

  const nextToken = `${randomBytes(16).toString("hex")}.${randomBytes(16).toString("hex")}`;
  const normalizedNote = normalizeOptionalText(note) ?? null;
  if (dryRun) {
    return {
      rotated: false,
      skipped: false,
      dryRun: true,
      nextTokenSource:
        shouldPreferSystemKeychain() && getSystemKeychainStatus().available ? "keychain" : "file",
      revokeReadSessions: shouldRevokeReadSessions,
      note: normalizedNote,
    };
  }

  const persisted = await persistAdminTokenRecord(nextToken);
  adminTokenPromise = Promise.resolve(persisted);
  const revokedSessions = shouldRevokeReadSessions
    ? await revokeAllReadSessions({
        note: normalizedNote ?? "admin token rotated",
        revokedByAgentId: rotatedByAgentId,
        revokedByReadSessionId: rotatedByReadSessionId,
        revokedByWindowId: rotatedByWindowId,
      })
    : {
        revokedCount: 0,
        sessions: [],
        revokedAt: null,
        dryRun: false,
      };
  await recordSecurityAnomaly({
    category: "key_management",
    severity: "high",
    code: "admin_token_rotated",
    message: "Admin token rotated",
    actorAgentId: rotatedByAgentId,
    actorReadSessionId: rotatedByReadSessionId,
    actorWindowId: rotatedByWindowId,
    details: {
      source: persisted.source,
      revokeReadSessions: shouldRevokeReadSessions,
      revokedCount: revokedSessions.revokedCount || 0,
    },
    reason: normalizedNote,
  });

  return {
    rotated: true,
    skipped: false,
    dryRun: false,
    token: nextToken,
    source: persisted.source,
    service: persisted.service || null,
    account: persisted.account || null,
    revokeReadSessions: shouldRevokeReadSessions,
    revokedSessions: {
      revokedCount: revokedSessions.revokedCount || 0,
      revokedAt: revokedSessions.revokedAt || null,
    },
    note: normalizedNote,
  };
}

function extractBearerToken(req) {
  const authorization = normalizeOptionalText(req.headers.authorization);
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return normalizeOptionalText(req.headers["x-agent-passport-admin-token"]);
}

function hasValidApiToken(req, adminToken) {
  const providedToken = extractBearerToken(req);
  return Boolean(providedToken && providedToken === adminToken?.token);
}

async function resolveApiAccess(req, pathname, segments, adminToken) {
  const providedToken = extractBearerToken(req);
  const scope =
    pathname === "/api/security/read-sessions" && (req.method || "GET").toUpperCase() === "POST"
      ? "security"
      : resolveApiReadScope(pathname, segments);
  if (!providedToken) {
    return {
      authorized: false,
      mode: "none",
      scope,
      session: null,
      reason: "missing_token",
    };
  }

  if (providedToken === adminToken?.token) {
    return {
      authorized: true,
      mode: "admin",
      scope,
      session: null,
      reason: null,
    };
  }

  if (!scope || isAdminOnlyApiPath(pathname, req.method)) {
    return {
      authorized: false,
      mode: "none",
      scope,
      session: null,
      reason: "admin_required",
    };
  }

  const validation = await validateReadSessionToken(providedToken, { scope });
  return {
    authorized: Boolean(validation.valid),
    mode: validation.valid ? "read_session" : "none",
    scope,
    session: validation.session || null,
    reason: validation.reason || null,
  };
}

function jsonForReadSession(res, access, statusCode, payload, redactor) {
  return json(res, statusCode, shouldRedactReadSessionPayload(access) ? redactor(payload) : payload);
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new Error("Invalid JSON body");
  }
}

async function drainRequest(req) {
  if (!req || req.readableEnded || req.complete) {
    return;
  }

  try {
    for await (const _chunk of req) {
      // Drain unread request bytes so early error responses don't leave the client hanging.
    }
  } catch {
    // Best-effort cleanup only.
  }
}

async function servePage(req, res, filename) {
  const html = await readFile(path.join(PUBLIC_DIR, filename), "utf-8");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html, "utf8"),
  });
  if ((req.method || "GET").toUpperCase() === "HEAD") {
    return res.end();
  }
  res.end(html);
}

async function servePublicAsset(res, filename, contentType = "text/plain; charset=utf-8") {
  const file = await readFile(path.join(PUBLIC_DIR, filename));
  res.writeHead(200, { "Content-Type": contentType });
  res.end(file);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const segments = pathname.split("/").filter(Boolean);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": `http://${HOST}:${PORT}`,
        "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-Passport-Admin-Token",
      });
      return res.end();
    }

    if ((req.method === "GET" || req.method === "HEAD") && pathname === "/") {
      return servePage(req, res, "index.html");
    }

    if ((req.method === "GET" || req.method === "HEAD") && pathname === "/lab.html") {
      return servePage(req, res, "lab.html");
    }

    if ((req.method === "GET" || req.method === "HEAD") && pathname === "/repair-hub") {
      return servePage(req, res, "repair-hub.html");
    }
    if ((req.method === "GET" || req.method === "HEAD") && pathname === "/offline-chat") {
      return servePage(req, res, "offline-chat.html");
    }

    if (req.method === "GET" && pathname === "/ui-links.js") {
      return servePublicAsset(res, "ui-links.js", "application/javascript; charset=utf-8");
    }
    if (req.method === "GET" && pathname === "/dashboard-utils.js") {
      return servePublicAsset(res, "dashboard-utils.js", "application/javascript; charset=utf-8");
    }
    if (req.method === "GET" && pathname === "/dashboard-app.js") {
      return servePublicAsset(res, "dashboard-app.js", "application/javascript; charset=utf-8");
    }
    if (req.method === "GET" && pathname === "/offline-chat-app.js") {
      return servePublicAsset(res, "offline-chat-app.js", "application/javascript; charset=utf-8");
    }

    if (req.method === "GET" && pathname === "/api/health") {
      const capabilities = await getCapabilities();
      return json(res, 200, {
        ok: true,
        service: "agent-passport",
        phase: capabilities.product?.phase ?? null,
        tagline: capabilities.positioning?.tagline ?? null,
        capabilityBoundary: capabilities.capabilityBoundary ?? null,
      });
    }

    if (req.method === "GET" && pathname === "/api/security") {
      const adminToken = await loadOrCreateAdminToken();
      const access = await resolveApiAccess(req, pathname, segments, adminToken);
      const authorized = access.authorized;
      const [storeKey, signingKey, securityPosture, anomalyAudit] = await Promise.all([
        getStoreEncryptionStatus(),
        Promise.resolve(getSigningMasterSecretStatus()),
        getCurrentSecurityPostureState(),
        listSecurityAnomalies({ limit: 5 }),
      ]);
      const payload = {
        authorized,
        authorizedAs: authorized ? access.mode : "public",
        hostBinding: HOST,
        apiWriteProtection: {
          tokenRequired: true,
          header: "Authorization: Bearer <token>",
          tokenSource: adminToken.source,
          tokenPath: authorized ? adminToken.path : null,
          keychainService: adminToken.service || null,
          keychainAccount: adminToken.account || null,
        },
        readProtection: {
          sensitiveGetRequiresToken: true,
          scopedReadSessions: true,
          availableScopes: [
            "security",
            "device_runtime",
            "recovery",
            "agents",
            "agents_catalog",
            "agents_identity",
            "agents_assets",
            "agents_context",
            "agents_runtime",
            "agents_runtime_minutes",
            "agents_runtime_search",
            "agents_runtime_actions",
            "agents_rehydrate",
            "agents_memories",
            "agents_runner",
            "agents_query_states",
            "agents_session_state",
            "agents_compact_boundaries",
            "agents_verification_runs",
            "agents_messages",
            "agents_authorizations",
            "credentials",
            "credentials_catalog",
            "credentials_detail",
            "credentials_timeline",
            "credentials_status",
            "authorizations",
            "authorizations_catalog",
            "authorizations_detail",
            "authorizations_timeline",
            "authorizations_credential",
            "migration_repairs",
            "migration_repairs_catalog",
            "migration_repairs_detail",
            "migration_repairs_timeline",
            "migration_repairs_credentials",
            "status_lists",
            "status_lists_catalog",
            "status_lists_detail",
            "status_lists_compare",
            "windows",
            "windows_catalog",
            "windows_detail",
          ],
          availableRoles: (await listReadSessionRoles()).roles,
        },
        readSession: authorized && access.mode === "read_session" ? access.session : null,
        localStore: authorized
          ? {
              encryptedAtRest: true,
              recoveryEnabled: true,
              ledgerPath: path.join(DATA_DIR, "ledger.json"),
              keyPath: process.env.AGENT_PASSPORT_STORE_KEY_PATH || path.join(DATA_DIR, ".ledger-key"),
              recoveryDir: process.env.AGENT_PASSPORT_RECOVERY_DIR || path.join(DATA_DIR, "recovery-bundles"),
            }
          : {
              encryptedAtRest: true,
              recoveryEnabled: true,
              ledgerPath: null,
              keyPath: null,
              recoveryDir: null,
            },
        keyManagement: {
          keychainPreferred: storeKey.preferred || signingKey.preferred || false,
          keychainAvailable: storeKey.available || signingKey.available || false,
          storeKey,
          signingKey,
        },
        securityPosture,
        anomalyAudit: authorized
          ? anomalyAudit
          : {
              anomalies: [],
              counts: anomalyAudit.counts,
            },
        notes: [
          "写接口默认需要本地 admin token。",
          "服务默认只绑定到 127.0.0.1。",
          "敏感读接口也默认要求本地 admin token。",
          "密钥默认优先走系统 Keychain，不可用时才回退到本地文件。",
          "security posture 可一键切到 read_only / disable_exec / panic。",
        ],
      };
      return json(res, 200, access.mode === "admin" ? payload : redactSecurityPayloadForReadSession(payload));
    }

    if (req.method === "GET" && pathname === "/api/protocol") {
      return json(res, 200, await getProtocol());
    }

    if (req.method === "GET" && pathname === "/api/capabilities") {
      return json(res, 200, await getCapabilities());
    }

    if (req.method === "GET" && pathname === "/api/roadmap") {
      return json(res, 200, await getRoadmap());
    }

    await handleOfflineChatRoutes({
      req,
      res,
      url,
      pathname,
      segments,
      parseBody,
    });
    if (res.writableEnded) {
      return;
    }

    const needsReadToken = requiresApiReadToken(req, pathname);
    const needsWriteToken = requiresApiWriteToken(req, pathname);
    if (needsReadToken || needsWriteToken) {
      const adminToken = await loadOrCreateAdminToken();
      const access = await resolveApiAccess(req, pathname, segments, adminToken);
      req.agentPassportAccess = access;
      const adminAuthorized = access.mode === "admin";
      const readAuthorized = needsReadToken && access.mode === "read_session";
      const delegatedWriteAuthorized =
        access.mode === "read_session" &&
        req.method === "POST" &&
        pathname === "/api/security/read-sessions";
      if (!(adminAuthorized || readAuthorized || delegatedWriteAuthorized)) {
        await recordSecurityAnomaly({
          category: "auth",
          severity: needsWriteToken ? "high" : "medium",
          code: needsWriteToken ? "protected_write_denied" : "protected_read_denied",
          message: needsWriteToken
            ? "Protected write request denied"
            : "Protected read request denied",
          path: pathname,
          method: req.method,
          scope: access.scope,
          reason: access.reason,
          relatedReadSessionId: access.session?.readSessionId || null,
        });
        await drainRequest(req);
        return json(res, 401, {
          error: needsWriteToken ? "Admin token required for write access" : "Admin token required for protected read access",
          security: {
            tokenHeader: "Authorization: Bearer <token>",
            tokenSource: adminToken.source,
            tokenPath: null,
            keychainService: adminToken.service || null,
            keychainAccount: adminToken.account || null,
            readScope: access.scope,
            readSessionReason: access.reason,
          },
        });
      }
    }

    const securityPosture =
      pathname.startsWith("/api/") && !isPublicApiPath(pathname)
        ? await getCurrentSecurityPostureState()
        : null;
    if (
      needsWriteToken &&
      securityPosture?.writeLocked &&
      !isSecurityMaintenanceWritePath(pathname, req.method)
    ) {
      await recordSecurityAnomaly({
        category: "security",
        severity: securityPosture.mode === "panic" ? "critical" : "high",
        code: "write_blocked_by_security_posture",
        message: `Write access blocked by security posture ${securityPosture.mode}`,
        path: pathname,
        method: req.method,
        scope: req.agentPassportAccess?.scope || null,
        actorReadSessionId: req.agentPassportAccess?.session?.readSessionId || null,
        details: {
          mode: securityPosture.mode,
        },
      });
      await drainRequest(req);
      return json(res, 423, {
        error: "Device runtime is in a write-locked security posture",
        securityPosture,
      });
    }
    if (
      needsWriteToken &&
      securityPosture?.executionLocked &&
      isExecutionApiPath(pathname, segments, req.method) &&
      !isSecurityMaintenanceWritePath(pathname, req.method)
    ) {
      await recordSecurityAnomaly({
        category: "security",
        severity: securityPosture.mode === "panic" ? "critical" : "high",
        code: "execution_blocked_by_security_posture",
        message: `Execution blocked by security posture ${securityPosture.mode}`,
        path: pathname,
        method: req.method,
        scope: req.agentPassportAccess?.scope || null,
        actorReadSessionId: req.agentPassportAccess?.session?.readSessionId || null,
        details: {
          mode: securityPosture.mode,
        },
      });
      await drainRequest(req);
      return json(res, 423, {
        error: "Device runtime is in an execution-locked security posture",
        securityPosture,
      });
    }

    await handleSecurityRoutes({
      req,
      res,
      url,
      pathname,
      segments,
      parseBody,
      rotateAdminToken,
    });
    if (res.writableEnded) {
      return;
    }

    await handleDeviceRoutes({
      req,
      res,
      url,
      pathname,
      segments,
      parseBody,
    });
    if (res.writableEnded) {
      return;
    }

    await handleAgentRoutes({
      req,
      res,
      url,
      pathname,
      segments,
      parseBody,
      jsonForReadSession,
    });
    if (res.writableEnded) {
      return;
    }

    await handleRecordRoutes({
      req,
      res,
      url,
      pathname,
      segments,
      parseBody,
      jsonForReadSession,
    });
    if (res.writableEnded) {
      return;
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, 400, { error: error.message || "Unexpected error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Agent Passport running at http://${HOST}:${PORT}`);
});

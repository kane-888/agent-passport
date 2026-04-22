import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuntimeReleaseReadiness } from "./release-readiness.js";
import {
  getCapabilities,
  getProtocol,
  getRoadmap,
  getCurrentSecurityPostureState,
  getDeviceSetupStatus,
  loadStoreIfPresentStatus,
  peekReadSessionCounts,
  peekStoreEncryptionStatus,
  listSecurityAnomalies,
  listReadSessionRoles,
  listReadSessionScopes,
  revokeAllReadSessions,
  runWithPassiveStoreAccess,
  validateReadSessionToken,
  recordSecurityAnomaly,
} from "./ledger.js";
import { peekSigningMasterSecretStatus } from "./identity.js";
import {
  getSystemKeychainStatus,
  readGenericPasswordFromKeychainResult,
  shouldPreferSystemKeychain,
  writeGenericPasswordToKeychain,
} from "./local-secrets.js";
import {
  json,
  normalizeOptionalText,
} from "./server-base-helpers.js";
import {
  shouldRedactReadSessionPayload,
} from "./server-read-access.js";
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
  resolveApiReadScopes,
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
const ACTIVE_LEDGER_PATH = process.env.OPENNEED_LEDGER_PATH || path.join(DATA_DIR, "ledger.json");
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
      const keychainTokenResult = readGenericPasswordFromKeychainResult(
        ADMIN_TOKEN_KEYCHAIN_SERVICE,
        ADMIN_TOKEN_KEYCHAIN_ACCOUNT
      );
      if (keychainTokenResult.found) {
        return {
          token: keychainTokenResult.value,
          source: "keychain",
          path: null,
          service: ADMIN_TOKEN_KEYCHAIN_SERVICE,
          account: ADMIN_TOKEN_KEYCHAIN_ACCOUNT,
        };
      }
      if (!(keychainTokenResult.ok && keychainTokenResult.code === "not_found")) {
        throw new Error(
          `System keychain admin token read failed: ${keychainTokenResult.reason || keychainTokenResult.code}`
        );
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
          if (!migrated.ok) {
            throw new Error(`Unable to migrate admin token into keychain: ${migrated.reason || "keychain_write_failed"}`);
          }
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
      if (!stored.ok) {
        throw new Error(`Unable to persist admin token into keychain: ${stored.reason || "keychain_write_failed"}`);
      }
      return {
        token: generated,
        source: "keychain",
        path: null,
        service: ADMIN_TOKEN_KEYCHAIN_SERVICE,
        account: ADMIN_TOKEN_KEYCHAIN_ACCOUNT,
      };
    }

    await writeFile(ADMIN_TOKEN_PATH, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
    return {
      token: generated,
      source: "file",
      path: ADMIN_TOKEN_PATH,
      service: null,
      account: null,
    };
  })().catch((error) => {
    adminTokenPromise = null;
    throw error;
  });

  return adminTokenPromise;
}

async function peekAdminTokenStatus() {
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
    const keychainTokenResult = readGenericPasswordFromKeychainResult(
      ADMIN_TOKEN_KEYCHAIN_SERVICE,
      ADMIN_TOKEN_KEYCHAIN_ACCOUNT
    );
    if (keychainTokenResult.found) {
      return {
        token: keychainTokenResult.value,
        source: "keychain",
        path: null,
        service: ADMIN_TOKEN_KEYCHAIN_SERVICE,
        account: ADMIN_TOKEN_KEYCHAIN_ACCOUNT,
      };
    }
    if (!(keychainTokenResult.ok && keychainTokenResult.code === "not_found")) {
      throw new Error(
        `System keychain admin token read failed: ${keychainTokenResult.reason || keychainTokenResult.code}`
      );
    }
  }

  try {
    const raw = normalizeOptionalText(await readFile(ADMIN_TOKEN_PATH, "utf8"));
    if (raw) {
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

  return {
    token: null,
    source: null,
    path: null,
    service: null,
    account: null,
  };
}

function buildStoreUnavailableTruth(storeStatus = {}, { authorized = false, storeKey = {}, signingKey = {} } = {}) {
  const keyUnavailable = storeStatus.missingKey === true;
  const code = keyUnavailable ? "store_key_unavailable" : "not_initialized";
  const summary = keyUnavailable
    ? "本地账本存在，但存储密钥不可用；只读入口不会创建新密钥，请走恢复或密钥导入流程。"
    : "本地账本尚未初始化；只读入口不创建 token、账本或密钥。";
  const blockingReason = keyUnavailable
    ? "local ledger exists but store encryption key is unavailable"
    : "local ledger is not initialized";
  return {
    initialized: false,
    storeAvailable: false,
    storePresent: storeStatus.present === true,
    missingLedger: storeStatus.missingLedger === true,
    missingStoreKey: keyUnavailable,
    code,
    status: code,
    localStore: {
      initialized: false,
      encryptedAtRest: keyUnavailable || storeKey.encrypted === true,
      encryptionSource: storeKey.source || null,
      systemProtected: null,
      recoveryEnabled: keyUnavailable,
      recoveryBaselineReady: false,
      recoveryBundlePresent: false,
      recoveryRehearsalFresh: false,
      ledgerPath: authorized ? ACTIVE_LEDGER_PATH : null,
      keyPath: authorized ? storeKey.keyPath || null : null,
      recoveryDir: authorized
        ? process.env.AGENT_PASSPORT_RECOVERY_DIR || path.join(DATA_DIR, "recovery-bundles")
        : null,
    },
    keyManagement: {
      keychainPreferred: storeKey.preferred || signingKey.preferred || false,
      keychainAvailable: storeKey.systemAvailable || signingKey.systemAvailable || false,
      storeKey,
      signingKey,
    },
    securityPosture: {
      mode: code,
      status: code,
      summary,
    },
    localStorageFormalFlow: null,
    constrainedExecution: null,
    automaticRecovery: null,
    releaseReadiness: {
      status: code,
      ready: false,
      blockingReasons: [blockingReason],
    },
    anomalyAudit: {
      anomalies: [],
      counts: { total: 0 },
    },
    notes: keyUnavailable
      ? [
          "GET 只读入口不会创建替代密钥，避免把真实账本变成不可恢复分叉。",
          "请先恢复原存储密钥，或使用正式恢复包导入流程。",
        ]
      : [
          "GET 只读入口不会初始化本地账本。",
          "初始化、迁移和密钥创建必须走显式受保护写流程。",
        ],
  };
}

function buildProtectedReadStoreUnavailableResponse(storeStatus = {}) {
  const keyUnavailable = storeStatus.missingKey === true;
  return {
    error: keyUnavailable
      ? "Local ledger exists but the store encryption key is unavailable"
      : "Local ledger is not initialized",
    initialized: false,
    storeAvailable: false,
    storePresent: storeStatus.present === true,
    missingLedger: storeStatus.missingLedger === true,
    missingStoreKey: keyUnavailable,
    code: keyUnavailable ? "store_key_unavailable" : "not_initialized",
    recoveryRequired: keyUnavailable,
    note: keyUnavailable
      ? "Protected reads are read-only and will not create a replacement encryption key. Restore or import the original key material first."
      : "Protected reads are read-only and will not create the local ledger or encryption key.",
  };
}

function buildPublicStoreUnavailableResponse(surface, storeStatus = {}) {
  return {
    ok: false,
    surface,
    ...buildProtectedReadStoreUnavailableResponse(storeStatus),
  };
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
    if (!stored.ok) {
      throw new Error(`Unable to persist admin token into keychain: ${stored.reason || "keychain_write_failed"}`);
    }
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
  return (
    normalizeOptionalText(req.headers["x-openneed-admin-token"]) ??
    normalizeOptionalText(req.headers["x-agent-passport-admin-token"])
  );
}

function hasValidApiToken(req, adminToken) {
  const providedToken = extractBearerToken(req);
  return Boolean(providedToken && providedToken === adminToken?.token);
}

async function resolveApiAccess(req, pathname, segments, adminToken, { touchReadSession = true } = {}) {
  const providedToken = extractBearerToken(req);
  const scopeOptions =
    pathname === "/api/security/read-sessions" && (req.method || "GET").toUpperCase() === "POST"
      ? ["security"]
      : resolveApiReadScopes(pathname, segments);
  const scope = scopeOptions[0] ?? null;
  if (!providedToken) {
    return {
      authorized: false,
      mode: "none",
      scope,
      scopeOptions,
      session: null,
      reason: "missing_token",
    };
  }

  if (providedToken === adminToken?.token) {
    return {
      authorized: true,
      mode: "admin",
      scope,
      scopeOptions,
      session: null,
      reason: null,
    };
  }

  if (!scopeOptions.length || isAdminOnlyApiPath(pathname, req.method)) {
    return {
      authorized: false,
      mode: "none",
      scope,
      scopeOptions,
      session: null,
      reason: "admin_required",
    };
  }

  let validation = null;
  for (const candidateScope of scopeOptions) {
    const candidateValidation = await validateReadSessionToken(providedToken, {
      scope: candidateScope,
      touch: touchReadSession,
    });
    if (candidateValidation.valid) {
      return {
        authorized: true,
        mode: "read_session",
        scope: candidateScope,
        scopeOptions,
        session: candidateValidation.session || null,
        reason: null,
      };
    }
    validation = candidateValidation;
  }
  return {
    authorized: false,
    mode: "none",
    scope,
    scopeOptions,
    session: validation?.session || null,
    reason: validation?.reason || null,
  };
}

function apiAccessDeniedErrorClass(access = null, { needsWriteToken = false } = {}) {
  if (access?.reason === "missing_token") {
    return needsWriteToken ? "admin_token_missing" : "protected_read_token_missing";
  }
  if (access?.reason === "admin_required") {
    return "admin_token_required";
  }
  if (access?.reason) {
    return "read_session_rejected";
  }
  return needsWriteToken ? "admin_token_required" : "protected_read_token_required";
}

function apiAccessDeniedStatusCode(access = null, { needsWriteToken = false } = {}) {
  const errorClass = apiAccessDeniedErrorClass(access, { needsWriteToken });
  if (
    errorClass === "read_session_rejected" &&
    ["invalid_scope", "scope_mismatch", "ancestor_scope_mismatch"].includes(access?.reason)
  ) {
    return 403;
  }
  return 401;
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
    const method = (req.method || "GET").toUpperCase();

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": `http://${HOST}:${PORT}`,
        "Access-Control-Allow-Methods": "GET,HEAD,POST,PATCH,OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-OpenNeed-Admin-Token, X-Agent-Passport-Admin-Token",
      });
      return res.end();
    }

    if ((method === "GET" || method === "HEAD") && pathname === "/") {
      return servePage(req, res, "index.html");
    }

    if ((method === "GET" || method === "HEAD") && pathname === "/lab.html") {
      return servePage(req, res, "lab.html");
    }

    if ((method === "GET" || method === "HEAD") && pathname === "/operator") {
      return servePage(req, res, "operator.html");
    }

    if ((method === "GET" || method === "HEAD") && pathname === "/repair-hub") {
      return servePage(req, res, "repair-hub.html");
    }
    if ((method === "GET" || method === "HEAD") && pathname === "/offline-chat") {
      return servePage(req, res, "offline-chat.html");
    }

    if (req.method === "GET" && pathname === "/ui-links.js") {
      return servePublicAsset(res, "ui-links.js", "application/javascript; charset=utf-8");
    }
    if (req.method === "GET" && pathname === "/offline-chat-app.js") {
      return servePublicAsset(res, "offline-chat-app.js", "application/javascript; charset=utf-8");
    }
    if (req.method === "GET" && pathname === "/runtime-truth-client.js") {
      return servePublicAsset(res, "runtime-truth-client.js", "application/javascript; charset=utf-8");
    }

    if ((method === "GET" || method === "HEAD") && pathname === "/api/health") {
      const storeStatus = await loadStoreIfPresentStatus({ migrate: false, createKey: false });
      if (!storeStatus.store) {
        return json(res, 200, {
          ok: storeStatus.missingKey !== true,
          service: "agent-passport",
          phase: null,
          tagline: null,
          capabilityBoundary: null,
          smokeServerId: process.env.AGENT_PASSPORT_SMOKE_SERVER_ID || null,
          localStore: buildPublicStoreUnavailableResponse("/api/health", storeStatus),
        });
      }
      const capabilities = await runWithPassiveStoreAccess(() => getCapabilities({ store: storeStatus.store }));
      return json(res, 200, {
        ok: true,
        service: capabilities.product?.name ?? "agent-passport",
        phase: capabilities.product?.phase ?? null,
        tagline: capabilities.positioning?.tagline ?? null,
        capabilityBoundary: capabilities.capabilityBoundary ?? null,
        smokeServerId: process.env.AGENT_PASSPORT_SMOKE_SERVER_ID || null,
      });
    }

    if ((method === "GET" || method === "HEAD") && pathname === "/api/security") {
      const adminToken = await peekAdminTokenStatus();
      const access = await resolveApiAccess(req, pathname, segments, adminToken, {
        touchReadSession: false,
      });
      const authorized = access.authorized;
      const [storeStatus, storeKey, signingKey, readSessionRoles, readSessionScopes, readSessionCounts] = await Promise.all([
        loadStoreIfPresentStatus({ migrate: false, createKey: false }),
        peekStoreEncryptionStatus(),
        Promise.resolve(peekSigningMasterSecretStatus()),
        listReadSessionRoles(),
        listReadSessionScopes(),
        peekReadSessionCounts(),
      ]);
      const store = storeStatus.store;
      if (!store) {
        const unavailableTruth = buildStoreUnavailableTruth(storeStatus, {
          authorized,
          storeKey,
          signingKey,
        });
        const payload = {
          authorized,
          authorizedAs: authorized ? access.mode : "public",
          initialized: unavailableTruth.initialized,
          storeAvailable: unavailableTruth.storeAvailable,
          storePresent: unavailableTruth.storePresent,
          missingLedger: unavailableTruth.missingLedger,
          missingStoreKey: unavailableTruth.missingStoreKey,
          code: unavailableTruth.code,
          status: unavailableTruth.status,
          hostBinding: HOST,
          apiWriteProtection: {
            tokenRequired: true,
            header: "Authorization: Bearer <token>",
            tokenSource: adminToken.source,
            tokenPath: null,
            keychainService: adminToken.service || null,
            keychainAccount: adminToken.account || null,
          },
          readProtection: {
            sensitiveGetRequiresToken: true,
            scopedReadSessions: true,
            availableScopes: readSessionScopes.scopes,
            availableRoles: readSessionRoles.roles,
            readSessionCount: readSessionCounts.count ?? 0,
          },
          readSession: authorized && access.mode === "read_session" ? access.session : null,
          localStore: unavailableTruth.localStore,
          keyManagement: unavailableTruth.keyManagement,
          securityPosture: unavailableTruth.securityPosture,
          localStorageFormalFlow: unavailableTruth.localStorageFormalFlow,
          constrainedExecution: unavailableTruth.constrainedExecution,
          automaticRecovery: unavailableTruth.automaticRecovery,
          releaseReadiness: unavailableTruth.releaseReadiness,
          anomalyAudit: unavailableTruth.anomalyAudit,
          notes: unavailableTruth.notes,
        };
        return json(
          res,
          200,
          access.mode === "admin" ? payload : redactSecurityPayloadForReadSession(payload, access)
        );
      }
      const [
        securityPosture,
        anomalyAudit,
        setupStatus,
        protocol,
      ] = await Promise.all([
        getCurrentSecurityPostureState({ store }),
        listSecurityAnomalies({ limit: 5, store }),
        getDeviceSetupStatus({ passive: true, store }),
        getProtocol({ store, readSessionCounts }),
      ]);
      const constrainedExecution = setupStatus?.deviceRuntime?.constrainedExecutionSummary ?? null;
      const localStorageFormalFlow = setupStatus?.formalRecoveryFlow ?? null;
      const automaticRecovery = setupStatus?.automaticRecoveryReadiness ?? null;
      const localStoreSystemProtected = localStorageFormalFlow?.storeEncryption?.systemProtected;
      const localStore = {
        encryptedAtRest: localStorageFormalFlow?.storeEncryption?.status === "protected",
        encryptionSource: storeKey.source || null,
        systemProtected:
          localStoreSystemProtected == null ? null : Boolean(localStoreSystemProtected),
        recoveryEnabled: localStorageFormalFlow ? localStorageFormalFlow.status !== "blocked" : false,
        recoveryBaselineReady: Boolean(localStorageFormalFlow?.durableRestoreReady),
        recoveryBundlePresent: Number(localStorageFormalFlow?.backupBundle?.total || 0) > 0,
        recoveryRehearsalFresh: localStorageFormalFlow?.rehearsal?.status === "fresh",
        ledgerPath: authorized ? ACTIVE_LEDGER_PATH : null,
        keyPath: authorized ? storeKey.keyPath || null : null,
        recoveryDir: authorized
          ? process.env.AGENT_PASSPORT_RECOVERY_DIR || path.join(DATA_DIR, "recovery-bundles")
          : null,
      };
      const cadenceRerunTriggers = Array.isArray(localStorageFormalFlow?.operationalCadence?.rerunTriggers)
        ? localStorageFormalFlow.operationalCadence.rerunTriggers
            .map((entry) => String(entry?.label || "").trim())
            .filter(Boolean)
        : [
            "存储主密钥轮换后重跑 1 -> 2 -> 3 -> 4",
            "签名密钥轮换后重跑 1 -> 2 -> 3 -> 4",
            "恢复包重导或轮换后至少重跑 3 -> 4",
            "真实切机前先补一次跨机器恢复演练",
            "事故交接、恢复复机或重新放开执行前确认最近一次恢复演练仍在窗口内",
          ];
      const operatorHandbook = {
        summary: "先锁边界，再补正式恢复，再判断能不能继续执行或切机。",
        standardActionsSummary: "遇到高风险异常时，先执行标准动作，不要临场拼流程。",
        roles: [
          {
            roleId: "holder",
            badge: "拍板",
            label: "持有者 / 委托主体",
            responsibility: "决定是否继续业务、是否接受恢复结果、是否允许重新放开写入与执行。",
            notResponsible: "不负责临时改代码、绕过门禁。",
          },
          {
            roleId: "operator",
            badge: "当前动作",
            label: "运营者 / 值班操作员",
            responsibility: "切姿态、保全现场、导出证据、执行恢复包/演练/初始化包流程并记录结果。",
            notResponsible: "不负责替持有者做业务判断。",
          },
          {
            roleId: "maintainer",
            badge: "根因修复",
            label: "平台 / 开发维护",
            responsibility: "定位根因、修复缺陷、提供回放与迁移工具，不替代持有者做业务判断。",
            notResponsible: "不负责跳过持有者批准直接恢复业务。",
          },
        ],
        decisionSequence: [
          {
            stepId: "security_posture",
            label: "先看安全姿态",
            summary: "只要姿态不是 normal，就先锁写入、执行或外网，再保全证据。",
            gate: "securityPosture.mode === normal",
          },
          {
            stepId: "formal_recovery",
            label: "再看正式恢复",
            summary: "只要正式恢复还没达标，就继续补正式恢复主线，不把自动恢复当完成。",
            gate: "formalRecoveryFlow.durableRestoreReady === true",
          },
          {
            stepId: "constrained_execution",
            label: "再看受限执行",
            summary: "只要受限执行层退化或被锁住，就先停真实执行，不做放行动作。",
            gate: "constrainedExecution.status not in degraded|locked",
          },
          {
            stepId: "cross_device_recovery",
            label: "最后看跨机器恢复",
            summary: "只有前三条都通过，才讨论能不能演练或允许真实切机。",
            gate: "crossDeviceRecoveryClosure.readyForRehearsal / readyForCutover",
          },
        ],
        standardActions: [
          {
            actionId: "evidence_preservation",
            label: "证据保全",
            tone: "warn",
            when: "出现异常且需要保留现场时立刻执行。",
            summary: "先保留当前安全与恢复真值，再补最近审计与演练证据，避免继续污染。",
            checklist: [
              "导出 /api/security。",
              "导出 /api/device/setup。",
              "保留最近一次自动恢复闭环审计。",
              "保留最近一次受限执行审计。",
              "保留最近一次恢复演练结果。",
              "记录当前安全姿态切换前后的时间点。",
            ],
          },
          {
            actionId: "break_glass",
            label: "Break-glass 升级",
            tone: "danger",
            when: "怀疑继续运行会放大损害时，先升级姿态再讨论恢复。",
            summary: "先切到更保守的姿态锁写入、执行和外网，再决定是否继续排查、轮换密钥或切机。",
            checklist: [
              "发现未经确认的高风险执行。",
              "怀疑密钥泄露或 token 泄露。",
              "自动恢复进入循环且继续重试可能放大损害。",
              "受限执行层退化后仍出现真实执行需求。",
            ],
          },
          {
            actionId: "key_rotation",
            label: "密钥轮换后重跑",
            tone: "warn",
            when: "存储主密钥 / 签名密钥 / 恢复包轮换，或真实切机、交接、恢复复机前执行。",
            summary: "轮换会改变恢复基线，必须按正式恢复固定顺序重跑，不能只更新口令或口头确认。",
            checklist: cadenceRerunTriggers,
          },
        ],
        posturePlaybook: [
          {
            posture: "normal",
            goal: "保持恢复基线与执行边界新鲜，避免带病继续运行。",
            immediateActions: [
              "确认最近恢复演练仍在策略窗口内。",
              "确认受限执行层没有退化。",
              "确认自动恢复没有 loop_detected / failed。",
            ],
            exitCriteria: "保持正常巡检即可，不需要额外升级姿态。",
          },
          {
            posture: "read_only",
            goal: "先停写入，保全账本与恢复现场，避免继续污染。",
            immediateActions: [
              "停止新增写入与结构化落盘。",
              "导出 /api/security 与 /api/device/setup 摘要。",
              "确认是否要继续升级到 disable_exec 或 panic。",
            ],
            exitCriteria: "确认没有继续污染风险，且恢复/排查完成后才能退出。",
          },
          {
            posture: "disable_exec",
            goal: "先停执行链，保留读取与恢复能力，避免继续碰宿主系统。",
            immediateActions: [
              "停止 runner 执行动作与受限执行调用。",
              "检查受限执行退化点和最近一次 capability 审计。",
              "仅保留读取、恢复包导出和恢复演练。",
            ],
            exitCriteria: "执行面风险已解释清楚，受限执行边界恢复正常后才能退出。",
          },
          {
            posture: "panic",
            goal: "先锁住写入、执行和外网，保全证据并准备灾备切换。",
            immediateActions: [
              "保全 /api/security、runner history、受限执行审计和恢复证据。",
              "只保留安全维护入口，不继续业务动作。",
              "准备密钥轮换或切机恢复决策。",
            ],
            exitCriteria: "证据保全完成、风险面收敛、恢复目标明确后才能讨论降级。",
          },
        ],
      };
      const securityArchitecture = {
        posture: protocol.securityArchitecture?.posture ?? null,
        trustModel: protocol.securityArchitecture?.trustModel ?? null,
        principles: Array.isArray(protocol.securityArchitecture?.principles)
          ? [...protocol.securityArchitecture.principles]
          : [],
        operatorHandbook,
        trustBoundaries: [
          {
            boundaryId: "loopback_api",
            status: HOST === "127.0.0.1" || HOST === "localhost" ? "enforced" : "degraded",
            summary: `服务默认绑定 ${HOST}，减少非本机暴露面。`,
          },
          {
            boundaryId: "tokenized_control_plane",
            status: "enforced",
            summary: "写接口、敏感读接口和派生读会话都受本地 token / read-session 门禁保护。",
          },
          {
            boundaryId: "security_posture",
            status: securityPosture.mode === "normal" ? "ready" : "degraded",
            summary: securityPosture.summary,
          },
          constrainedExecution
            ? {
                boundaryId: "constrained_execution",
                status: constrainedExecution.status,
                summary: constrainedExecution.summary,
              }
            : null,
          constrainedExecution?.systemBrokerSandbox
            ? {
                boundaryId: "system_broker_sandbox",
                status: constrainedExecution.systemBrokerSandbox.enabled ? "enforced" : "degraded",
                summary: constrainedExecution.systemBrokerSandbox.summary,
              }
            : null,
          localStorageFormalFlow
            ? {
                boundaryId: "formal_recovery_flow",
                status: localStorageFormalFlow.status,
                summary: localStorageFormalFlow.summary,
              }
            : null,
          automaticRecovery
            ? {
                boundaryId: "automatic_recovery",
                status: automaticRecovery.status,
                summary: automaticRecovery.summary,
              }
            : null,
        ].filter(Boolean),
        incidentResponse: {
          activePosture: securityPosture.mode,
          availablePostures: ["normal", "read_only", "disable_exec", "panic"],
          anomalyCounts: anomalyAudit.counts,
          summary:
            securityPosture.mode === "normal"
              ? "当前处于正常姿态；如发现异常可快速切换到只读、禁执行或紧急锁定。"
              : "当前已进入更严格的安全姿态，异常处置应优先保全现场并限制写入与执行。",
        },
      };
      const releaseReadiness = buildRuntimeReleaseReadiness({
        health: {
          ok: true,
          service: "agent-passport",
        },
        security: {
          securityPosture,
          localStorageFormalFlow,
          constrainedExecution,
          automaticRecovery,
        },
        setup: setupStatus,
      });
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
          availableScopes: readSessionScopes.scopes,
          availableRoles: readSessionRoles.roles,
        },
        readSession: authorized && access.mode === "read_session" ? access.session : null,
        localStore,
        keyManagement: {
          keychainPreferred: storeKey.preferred || signingKey.preferred || false,
          keychainAvailable: storeKey.systemAvailable || signingKey.systemAvailable || false,
          storeKey,
          signingKey,
        },
        securityPosture,
        securityArchitecture,
        deviceSetupReadiness: {
          setupComplete: Boolean(setupStatus?.setupComplete),
          missingRequiredCodes: Array.isArray(setupStatus?.missingRequiredCodes)
            ? [...setupStatus.missingRequiredCodes]
            : [],
        },
        localStorageFormalFlow,
        constrainedExecution,
        automaticRecovery,
        releaseReadiness,
        anomalyAudit: authorized
          ? anomalyAudit
          : {
              anomalies: [],
              counts: anomalyAudit.counts,
            },
        notes: [
          "写接口默认要求本地管理令牌。",
          "敏感读接口默认要求本地管理令牌。",
          "服务默认只绑定 127.0.0.1。",
          "密钥优先走系统钥匙串，文件只做回退。",
          "安全姿态可切到只读、禁执行或紧急锁定。",
          "受限执行优先落到系统级沙箱。",
          "正式恢复同时检查加密、恢复包、恢复演练和初始化包。",
          "自动恢复只做受控接力，不等于正式恢复完成。",
        ],
      };
      return json(
        res,
        200,
        access.mode === "admin" ? payload : redactSecurityPayloadForReadSession(payload, access)
      );
    }

    if ((method === "GET" || method === "HEAD") && pathname === "/api/protocol") {
      const storeStatus = await loadStoreIfPresentStatus({ migrate: false, createKey: false });
      if (!storeStatus.store) {
        return json(res, 503, buildPublicStoreUnavailableResponse("/api/protocol", storeStatus));
      }
      return json(res, 200, await runWithPassiveStoreAccess(() => getProtocol({ store: storeStatus.store })));
    }

    if ((method === "GET" || method === "HEAD") && pathname === "/api/capabilities") {
      const storeStatus = await loadStoreIfPresentStatus({ migrate: false, createKey: false });
      if (!storeStatus.store) {
        return json(res, 503, buildPublicStoreUnavailableResponse("/api/capabilities", storeStatus));
      }
      return json(res, 200, await runWithPassiveStoreAccess(() => getCapabilities({ store: storeStatus.store })));
    }

    if ((method === "GET" || method === "HEAD") && pathname === "/api/roadmap") {
      const storeStatus = await loadStoreIfPresentStatus({ migrate: false, createKey: false });
      if (!storeStatus.store) {
        return json(res, 503, buildPublicStoreUnavailableResponse("/api/roadmap", storeStatus));
      }
      return json(res, 200, await runWithPassiveStoreAccess(() => getRoadmap({ store: storeStatus.store })));
    }

    const needsReadToken = requiresApiReadToken(req, pathname);
    const needsWriteToken = requiresApiWriteToken(req, pathname);
    if (needsReadToken || needsWriteToken) {
      const adminToken = needsWriteToken ? await loadOrCreateAdminToken() : await peekAdminTokenStatus();
      const access = await resolveApiAccess(req, pathname, segments, adminToken, {
        touchReadSession: !(method === "GET" || method === "HEAD"),
      });
      req.agentPassportAccess = access;
      const adminAuthorized = access.mode === "admin";
      const readAuthorized = needsReadToken && access.mode === "read_session";
      const delegatedWriteAuthorized =
        access.mode === "read_session" &&
        req.method === "POST" &&
        pathname === "/api/security/read-sessions";
      if (!(adminAuthorized || readAuthorized || delegatedWriteAuthorized)) {
        await drainRequest(req);
        return json(res, apiAccessDeniedStatusCode(access, { needsWriteToken }), {
          errorClass: apiAccessDeniedErrorClass(access, { needsWriteToken }),
          error: needsWriteToken ? "Admin token required for write access" : "Admin token required for protected read access",
          security: {
            tokenHeader: "Authorization: Bearer <token>",
            tokenSource: adminToken.source,
            tokenPath: null,
            keychainService: adminToken.service || null,
            keychainAccount: adminToken.account || null,
            readScope: access.scope,
            readScopeOptions: access.scopeOptions || [],
            readSessionReason: access.reason,
          },
        });
      }
    }

    if (needsReadToken && (method === "GET" || method === "HEAD") && !isPublicApiPath(pathname)) {
      const storeStatus = await loadStoreIfPresentStatus({ migrate: false, createKey: false });
      if (!storeStatus.store) {
        return json(res, 503, buildProtectedReadStoreUnavailableResponse(storeStatus));
      }
    }

    const securityPosture =
      needsWriteToken && pathname.startsWith("/api/") && !isPublicApiPath(pathname)
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
        errorClass: "write_blocked_by_security_posture",
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
        errorClass: "execution_blocked_by_security_posture",
        error: "Device runtime is in an execution-locked security posture",
        securityPosture,
      });
    }

    const dispatchApiRoutes = async () => {
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
    };

    if (method === "GET" || method === "HEAD") {
      return await runWithPassiveStoreAccess(dispatchApiRoutes);
    }

    return await dispatchApiRoutes();
  } catch (error) {
    return json(res, 400, { error: error.message || "Unexpected error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`agent-passport running at http://${HOST}:${PORT}`);
});

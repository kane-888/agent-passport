import {
  configureSecurityPosture,
  createReadSession,
  getCurrentSecurityPostureState,
  listReadSessions,
  listSecurityAnomalies,
  migrateLocalKeyMaterialToKeychain,
  recordSecurityAnomaly,
  revokeAllReadSessions,
  revokeReadSession,
} from "./ledger.js";
import { runRuntimeHousekeeping } from "./runtime-housekeeping.js";
import { json, normalizeOptionalText, toBooleanParam } from "./server-base-helpers.js";
import { shouldRedactReadSessionPayload } from "./server-read-access.js";
import {
  redactRuntimeHousekeepingForReadSession,
  redactSecurityAnomalyForReadSession,
} from "./server-security-redaction.js";

function stripUntrustedSecurityRouteAttribution(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const {
    sourceWindowId,
    updatedByAgentId,
    updatedByWindowId,
    recordedByAgentId,
    recordedByWindowId,
    createdByAgentId,
    createdByWindowId,
    createdByReadSessionId,
    revokedByAgentId,
    revokedByWindowId,
    revokedByReadSessionId,
    rotatedByAgentId,
    rotatedByWindowId,
    rotatedByReadSessionId,
    ...rest
  } = payload;

  return rest;
}

export async function handleSecurityRoutes({
  req,
  res,
  url,
  pathname,
  segments,
  parseBody,
  rotateAdminToken,
}) {
  if (pathname === "/api/security/posture") {
    if (req.method === "GET") {
      return json(res, 200, { securityPosture: await getCurrentSecurityPostureState() });
    }
    if (req.method === "POST") {
      const body = await parseBody(req);
      const posture = await configureSecurityPosture(stripUntrustedSecurityRouteAttribution(body));
      return json(res, 200, posture);
    }
  }

  if (req.method === "GET" && pathname === "/api/security/anomalies") {
    const anomalies = await listSecurityAnomalies({
      limit: url.searchParams.get("limit") || undefined,
      category: url.searchParams.get("category") || undefined,
      severity: url.searchParams.get("severity") || undefined,
      includeAcknowledged: toBooleanParam(url.searchParams.get("includeAcknowledged")) ?? true,
      createdAfter: url.searchParams.get("createdAfter") || undefined,
      createdBefore: url.searchParams.get("createdBefore") || undefined,
    });
    const access = req.agentPassportAccess || null;
    return json(
      res,
      200,
      shouldRedactReadSessionPayload(access)
        ? {
            ...anomalies,
            anomalies: Array.isArray(anomalies.anomalies)
              ? anomalies.anomalies.map((entry) => redactSecurityAnomalyForReadSession(entry, access))
              : [],
          }
        : anomalies
    );
  }

  if (req.method === "POST" && pathname === "/api/security/keychain-migration") {
    const body = await parseBody(req);
    const migration = await migrateLocalKeyMaterialToKeychain({
      dryRun: toBooleanParam(body.dryRun) ?? true,
      removeFile: toBooleanParam(body.removeFile) ?? false,
    });
    return json(res, 200, { migration });
  }

  if (pathname === "/api/security/runtime-housekeeping") {
    const access = req.agentPassportAccess || null;
    if (req.method === "GET") {
      const housekeeping = await runRuntimeHousekeeping({
        apply: false,
        keepRecovery: url.searchParams.get("keepRecovery"),
        keepSetup: url.searchParams.get("keepSetup"),
      });
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactRuntimeHousekeepingForReadSession(housekeeping)
          : housekeeping
      );
    }
    if (req.method === "POST") {
      const body = await parseBody(req);
      const trustedBody = stripUntrustedSecurityRouteAttribution(body);
      const housekeeping = await runRuntimeHousekeeping({
        apply: toBooleanParam(trustedBody.apply) ?? false,
        keepRecovery: trustedBody.keepRecovery ?? url.searchParams.get("keepRecovery"),
        keepSetup: trustedBody.keepSetup ?? url.searchParams.get("keepSetup"),
        revokedByReadSessionId: access?.mode === "read_session" ? access.session?.readSessionId : null,
      });
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactRuntimeHousekeepingForReadSession(housekeeping)
          : housekeeping
      );
    }
  }

  if (req.method === "POST" && pathname === "/api/security/admin-token/rotate") {
    const body = await parseBody(req);
    const trustedBody = stripUntrustedSecurityRouteAttribution(body);
    const rotation = await rotateAdminToken({
      dryRun: toBooleanParam(trustedBody.dryRun) ?? false,
      revokeReadSessions: toBooleanParam(trustedBody.revokeReadSessions) ?? true,
      note: trustedBody.note,
      rotatedByReadSessionId: req.agentPassportAccess?.session?.readSessionId || null,
    });
    return json(res, 200, { rotation });
  }

  if (pathname === "/api/security/read-sessions") {
    if (req.method === "GET") {
      return json(
        res,
        200,
        await listReadSessions({
          includeExpired: toBooleanParam(url.searchParams.get("includeExpired")) ?? true,
          includeRevoked: toBooleanParam(url.searchParams.get("includeRevoked")) ?? true,
        })
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const trustedBody = stripUntrustedSecurityRouteAttribution(body);
      const access = req.agentPassportAccess || null;
      const parentReadSessionId =
        access?.mode === "read_session"
          ? access.session?.readSessionId || null
          : trustedBody.parentReadSessionId;
      if (
        access?.mode === "read_session" &&
        trustedBody.parentReadSessionId &&
        trustedBody.parentReadSessionId !== parentReadSessionId
      ) {
        return json(res, 403, {
          error: "Delegated read session can only derive a child session from itself",
        });
      }
      return json(
        res,
        200,
        await createReadSession({
          label: trustedBody.label,
          note: trustedBody.note,
          role: trustedBody.role,
          scopes: trustedBody.scopes,
          agentIds: trustedBody.agentIds,
          windowIds: trustedBody.windowIds,
          credentialIds: trustedBody.credentialIds,
          viewTemplates: trustedBody.viewTemplates,
          objectTemplates: trustedBody.objectTemplates,
          fieldTemplates: trustedBody.fieldTemplates,
          ttlSeconds: trustedBody.ttlSeconds,
          canDelegate: trustedBody.canDelegate,
          maxDelegationDepth: trustedBody.maxDelegationDepth,
          parentReadSessionId,
          createdByReadSessionId:
            access?.mode === "read_session" ? access.session?.readSessionId : null,
        })
      );
    }
  }

  if (req.method === "POST" && pathname === "/api/security/read-sessions/revoke-all") {
    const body = await parseBody(req);
    const trustedBody = stripUntrustedSecurityRouteAttribution(body);
    const access = req.agentPassportAccess || null;
    const revoked = await revokeAllReadSessions({
      dryRun: toBooleanParam(trustedBody.dryRun) ?? false,
      note: trustedBody.note,
      revokedByReadSessionId: access?.mode === "read_session" ? access.session?.readSessionId : null,
    });
    if (!revoked.dryRun) {
      await recordSecurityAnomaly({
        category: "auth",
        severity: "high",
        code: "read_sessions_revoked_all",
        message: "All read sessions revoked",
        actorReadSessionId: access?.mode === "read_session" ? access.session?.readSessionId : null,
        details: {
          dryRun: false,
          revokedCount: revoked.revokedCount || 0,
        },
        reason: normalizeOptionalText(trustedBody.note) || null,
      });
    }
    return json(res, 200, revoked);
  }

  if (
    req.method === "POST" &&
    segments[0] === "api" &&
    segments[1] === "security" &&
    segments[2] === "read-sessions" &&
    segments[4] === "revoke"
  ) {
    await parseBody(req);
    return json(
      res,
      200,
      await revokeReadSession(segments[3], {
        revokedByReadSessionId: req.agentPassportAccess?.session?.readSessionId || null,
      })
    );
  }

  return null;
}

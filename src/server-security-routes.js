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
import { redactSecurityAnomalyForReadSession } from "./server-security-redaction.js";

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
      const posture = await configureSecurityPosture(body);
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
              ? anomalies.anomalies.map(redactSecurityAnomalyForReadSession)
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
    if (req.method === "GET") {
      return json(
        res,
        200,
        await runRuntimeHousekeeping({
          apply: false,
          keepRecovery: url.searchParams.get("keepRecovery"),
          keepSetup: url.searchParams.get("keepSetup"),
        })
      );
    }
    if (req.method === "POST") {
      const body = await parseBody(req);
      return json(
        res,
        200,
        await runRuntimeHousekeeping({
          apply: toBooleanParam(body.apply) ?? false,
          keepRecovery: body.keepRecovery ?? url.searchParams.get("keepRecovery"),
          keepSetup: body.keepSetup ?? url.searchParams.get("keepSetup"),
        })
      );
    }
  }

  if (req.method === "POST" && pathname === "/api/security/admin-token/rotate") {
    const body = await parseBody(req);
    const rotation = await rotateAdminToken({
      dryRun: toBooleanParam(body.dryRun) ?? false,
      revokeReadSessions: toBooleanParam(body.revokeReadSessions) ?? true,
      note: body.note,
      rotatedByAgentId: body.rotatedByAgentId,
      rotatedByWindowId: body.rotatedByWindowId,
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
      const access = req.agentPassportAccess || null;
      const parentReadSessionId =
        access?.mode === "read_session"
          ? access.session?.readSessionId || null
          : body.parentReadSessionId;
      if (
        access?.mode === "read_session" &&
        body.parentReadSessionId &&
        body.parentReadSessionId !== parentReadSessionId
      ) {
        return json(res, 403, {
          error: "Delegated read session can only derive a child session from itself",
        });
      }
      return json(
        res,
        200,
        await createReadSession({
          label: body.label,
          note: body.note,
          role: body.role,
          scopes: body.scopes,
          agentIds: body.agentIds,
          windowIds: body.windowIds,
          credentialIds: body.credentialIds,
          viewTemplates: body.viewTemplates,
          objectTemplates: body.objectTemplates,
          fieldTemplates: body.fieldTemplates,
          ttlSeconds: body.ttlSeconds,
          canDelegate: body.canDelegate,
          maxDelegationDepth: body.maxDelegationDepth,
          parentReadSessionId,
          createdByAgentId: body.createdByAgentId,
          createdByReadSessionId:
            access?.mode === "read_session" ? access.session?.readSessionId : null,
          createdByWindowId: body.createdByWindowId,
        })
      );
    }
  }

  if (req.method === "POST" && pathname === "/api/security/read-sessions/revoke-all") {
    const body = await parseBody(req);
    const revoked = await revokeAllReadSessions({
      dryRun: toBooleanParam(body.dryRun) ?? false,
      note: body.note,
      revokedByAgentId: body.revokedByAgentId,
      revokedByReadSessionId:
        req.agentPassportAccess?.session?.readSessionId || body.revokedByReadSessionId,
      revokedByWindowId: body.revokedByWindowId,
    });
    if (!revoked.dryRun) {
      await recordSecurityAnomaly({
        category: "auth",
        severity: "high",
        code: "read_sessions_revoked_all",
        message: "All read sessions revoked",
        actorAgentId: body.revokedByAgentId || null,
        actorReadSessionId: req.agentPassportAccess?.session?.readSessionId || null,
        actorWindowId: body.revokedByWindowId || null,
        details: {
          dryRun: false,
          revokedCount: revoked.revokedCount || 0,
        },
        reason: normalizeOptionalText(body.note) || null,
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
    const body = await parseBody(req);
    return json(
      res,
      200,
      await revokeReadSession(segments[3], {
        revokedByAgentId: body.revokedByAgentId,
        revokedByReadSessionId: body.revokedByReadSessionId,
        revokedByWindowId: body.revokedByWindowId,
      })
    );
  }

  return null;
}

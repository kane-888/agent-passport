import {
  configureSecurityPosture,
  createReadSession,
  getCurrentSecurityPostureState,
  getDeviceSetupStatus,
  listAgentRuns,
  listAgentSandboxActionAudits,
  listEvidenceRefs,
  listReadSessions,
  listSecurityAnomalies,
  migrateLocalKeyMaterialToKeychain,
  recordEvidenceRef,
  recordSecurityAnomaly,
  revokeAllReadSessions,
  revokeReadSession,
} from "./ledger.js";
import { runRuntimeHousekeeping } from "./runtime-housekeeping.js";
import { json, normalizeOptionalText, toBooleanParam } from "./server-base-helpers.js";
import { shouldRedactReadSessionPayload } from "./server-read-access.js";
import {
  redactSecurityPostureForReadSession,
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

function getIncidentPacketResidentAgentId(setup = null) {
  return (
    normalizeOptionalText(setup?.residentAgentId) ||
    normalizeOptionalText(setup?.deviceRuntime?.residentAgentId) ||
    null
  );
}

function buildIncidentAlerts(security = null, setup = null) {
  const alerts = [];
  const posture = security?.securityPosture || null;
  const formalRecovery = setup?.formalRecoveryFlow || security?.localStorageFormalFlow || null;
  const cadence = formalRecovery?.operationalCadence || null;
  const automaticBoundary =
    setup?.automaticRecoveryReadiness?.operatorBoundary ||
    security?.automaticRecovery?.operatorBoundary ||
    null;
  const constrained =
    setup?.deviceRuntime?.constrainedExecutionSummary ||
    security?.constrainedExecution ||
    null;
  const crossDevice = formalRecovery?.crossDeviceRecoveryClosure || null;

  if (posture?.mode && posture.mode !== "normal") {
    alerts.push({
      tone: posture.mode === "panic" ? "danger" : "warn",
      title: `安全姿态已提升到 ${posture.mode}`,
      detail: normalizeOptionalText(posture.summary) || "先按当前姿态保全现场，再讨论是否恢复业务。",
    });
  }

  if (["missing", "overdue", "due_soon"].includes(cadence?.status)) {
    alerts.push({
      tone: cadence.status === "due_soon" ? "warn" : "danger",
      title: `正式恢复周期 ${normalizeOptionalText(cadence?.status) || "unknown"}`,
      detail:
        normalizeOptionalText(cadence?.actionSummary) ||
        "正式恢复周期没有保持在安全窗口内，不能把自动恢复当成交付级恢复。",
    });
  }

  if (automaticBoundary?.formalFlowReady === false) {
    alerts.push({
      tone: "danger",
      title: "自动恢复不能冒充正式恢复完成",
      detail:
        normalizeOptionalText(automaticBoundary.summary) ||
        "自动恢复即使能续跑，也不代表恢复包、恢复演练和初始化包已经收口。",
    });
  }

  if (["degraded", "locked"].includes(constrained?.status)) {
    alerts.push({
      tone: "danger",
      title: `受限执行层 ${normalizeOptionalText(constrained?.status) || "unknown"}`,
      detail:
        normalizeOptionalText(constrained.summary) ||
        "受限执行边界已退化或被锁住，先停继续执行，再解释清楚为什么。",
      notes: Array.isArray(constrained?.warnings) ? constrained.warnings.slice(0, 3) : [],
    });
  }

  if (crossDevice?.readyForCutover === false) {
    alerts.push({
      tone: crossDevice?.readyForRehearsal ? "warn" : "danger",
      title: crossDevice?.readyForRehearsal ? "跨机器恢复现在只能做演练" : "跨机器恢复还不能开始",
      detail:
        normalizeOptionalText(crossDevice?.cutoverGate?.summary) ||
        normalizeOptionalText(crossDevice?.summary) ||
        "没有目标机器通过记录前，不能把系统标成可切机。",
      notes: Array.isArray(crossDevice?.sourceBlockingReasons) ? crossDevice.sourceBlockingReasons.slice(0, 3) : [],
    });
  }

  return alerts;
}

function deriveIncidentNextAction(security = null, setup = null) {
  const posture = security?.securityPosture || null;
  const constrained =
    setup?.deviceRuntime?.constrainedExecutionSummary ||
    security?.constrainedExecution ||
    null;
  const formalRecovery = setup?.formalRecoveryFlow || security?.localStorageFormalFlow || null;
  const crossDevice = formalRecovery?.crossDeviceRecoveryClosure || null;
  const cadence = formalRecovery?.operationalCadence || null;

  if (posture?.mode && posture.mode !== "normal") {
    return `先按 ${posture.mode} 姿态锁边界并保全 /api/security 与 /api/device/setup。`;
  }
  if (["degraded", "locked"].includes(constrained?.status)) {
    return "先停真实执行，查清受限执行为什么退化。";
  }
  if (formalRecovery?.runbook?.nextStepLabel && formalRecovery?.durableRestoreReady === false) {
    return `先补正式恢复主线：${formalRecovery.runbook.nextStepLabel}。`;
  }
  if (crossDevice?.readyForRehearsal === false && crossDevice?.nextStepLabel) {
    return `先收口跨机器恢复前置条件：${crossDevice.nextStepLabel}。`;
  }
  if (crossDevice?.readyForRehearsal) {
    return "源机器已就绪；下一步去目标机器按固定顺序导入恢复包、初始化包并核验。";
  }
  if (cadence?.actionSummary) {
    return cadence.actionSummary;
  }
  return "当前没有硬阻塞；继续巡检正式恢复、受限执行和跨机器恢复。";
}

function reverseRecentEntries(entries = []) {
  return Array.isArray(entries) ? [...entries].reverse() : [];
}

function buildIncidentPacketPayload({
  security = null,
  setup = null,
  anomalies = null,
  runner = null,
  sandboxAudits = null,
  sourceSurface = "/api/security/incident-packet",
  exportRecord = null,
  exportedAt = null,
} = {}) {
  const formalRecovery = setup?.formalRecoveryFlow || security?.localStorageFormalFlow || null;
  const constrained =
    setup?.deviceRuntime?.constrainedExecutionSummary ||
    security?.constrainedExecution ||
    null;
  const automaticRecovery =
    setup?.automaticRecoveryReadiness ||
    security?.automaticRecovery ||
    null;
  const residentAgentId = getIncidentPacketResidentAgentId(setup);
  const alerts = buildIncidentAlerts(security, setup);
  const effectiveExportedAt = normalizeOptionalText(exportedAt) || new Date().toISOString();
  return {
    format: "agent-passport-incident-packet-v1",
    exportedAt: effectiveExportedAt,
    product: "agent-passport",
    sourceSurface,
    residentAgentId,
    operatorDecision: {
      summary:
        alerts.length > 0
          ? `当前先处理 ${normalizeOptionalText(alerts[0]?.title) || "未命名阻塞"}。`
          : "当前没有硬阻塞；以巡检和演练准备为主。",
      nextAction: deriveIncidentNextAction(security, setup),
      hardAlerts: alerts,
    },
    handoff: {
      summary:
        normalizeOptionalText(formalRecovery?.handoffPacket?.summary) ||
        "当前没有恢复交接真值。",
      packet: formalRecovery?.handoffPacket || null,
    },
    snapshots: {
      security,
      deviceSetup: setup,
    },
    boundaries: {
      securityPosture: security?.securityPosture || null,
      formalRecovery,
      constrainedExecution: constrained,
      automaticRecovery,
      crossDeviceRecovery: formalRecovery?.crossDeviceRecoveryClosure || null,
    },
    recentEvidence: {
      securityAnomalies: {
        fetchedAt: effectiveExportedAt,
        error: anomalies?.error || null,
        counts: anomalies?.counts || null,
        anomalies: reverseRecentEntries(anomalies?.anomalies),
      },
      autoRecovery: {
        fetchedAt: effectiveExportedAt,
        error: runner?.error || null,
        counts: runner?.counts || null,
        recentRuns: reverseRecentEntries(runner?.runs),
        audits: reverseRecentEntries(runner?.autoRecoveryAudits),
      },
      constrainedExecution: {
        fetchedAt: effectiveExportedAt,
        error: sandboxAudits?.error || null,
        counts: sandboxAudits?.counts || null,
        audits: reverseRecentEntries(sandboxAudits?.audits),
      },
    },
    exportCoverage: {
      protectedRead: true,
      residentAgentBound: Boolean(residentAgentId),
      includedSections: [
        "current_decision",
        "security_snapshot",
        "device_setup_snapshot",
        "formal_recovery_handoff",
        "cross_device_gate",
        "security_anomalies",
        "auto_recovery_audits",
        "constrained_execution_audits",
      ],
      missingSections: [
        anomalies?.error ? "security_anomalies" : null,
        runner?.error ? "auto_recovery_audits" : null,
        sandboxAudits?.error ? "constrained_execution_audits" : null,
        residentAgentId ? null : "resident_agent_binding",
      ].filter(Boolean),
    },
    exportRecord,
  };
}

async function collectIncidentPacketState() {
  const [securityPosture, setup, anomalies] = await Promise.all([
    getCurrentSecurityPostureState(),
    getDeviceSetupStatus(),
    listSecurityAnomalies({
      limit: 5,
      includeAcknowledged: true,
    }),
  ]);
  const residentAgentId = getIncidentPacketResidentAgentId(setup);
  const security = {
    securityPosture,
    localStorageFormalFlow: setup?.formalRecoveryFlow || null,
    constrainedExecution: setup?.deviceRuntime?.constrainedExecutionSummary || null,
    automaticRecovery: setup?.automaticRecoveryReadiness || null,
  };
  const runner = residentAgentId
    ? await listAgentRuns(residentAgentId, { limit: 5 })
    : {
        error: "resident agent missing",
        runs: [],
        autoRecoveryAudits: [],
        counts: null,
      };
  const sandboxAudits = residentAgentId
    ? await listAgentSandboxActionAudits(residentAgentId, { limit: 5 })
    : {
        error: "resident agent missing",
        audits: [],
        counts: null,
      };
  return {
    security,
    setup,
    anomalies,
    runner,
    sandboxAudits,
    residentAgentId,
  };
}

async function recordIncidentPacketExport({
  residentAgentId = null,
  packet = null,
  note = null,
  sourceWindowId = null,
} = {}) {
  if (!residentAgentId || !packet) {
    return null;
  }
  return recordEvidenceRef(residentAgentId, {
    kind: "note",
    title: "事故交接包导出",
    uri: `incident-packet://export/${encodeURIComponent(packet.exportedAt || new Date().toISOString())}`,
    summary:
      normalizeOptionalText(note) ||
      normalizeOptionalText(packet?.operatorDecision?.summary) ||
      "已导出事故交接包。",
    tags: ["incident-packet-export", "operator", "security"],
    sourceWindowId,
    recordedByWindowId: sourceWindowId,
  });
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
      const access = req.agentPassportAccess || null;
      const posture = await getCurrentSecurityPostureState();
      return json(res, 200, {
        securityPosture: shouldRedactReadSessionPayload(access)
          ? redactSecurityPostureForReadSession(posture, access)
          : posture,
      });
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

  if (req.method === "GET" && pathname === "/api/security/incident-packet") {
    const packetState = await collectIncidentPacketState();
    return json(
      res,
      200,
      buildIncidentPacketPayload({
        security: packetState.security,
        setup: packetState.setup,
        anomalies: packetState.anomalies,
        runner: packetState.runner,
        sandboxAudits: packetState.sandboxAudits,
      })
    );
  }

  if (req.method === "GET" && pathname === "/api/security/incident-packet/history") {
    const setup = await getDeviceSetupStatus();
    const residentAgentId = getIncidentPacketResidentAgentId(setup);
    if (!residentAgentId) {
      return json(res, 200, {
        residentAgentId: null,
        history: [],
        counts: {
          total: 0,
          filtered: 0,
        },
      });
    }
    const history = await listEvidenceRefs(residentAgentId, {
      tag: "incident-packet-export",
      limit: url.searchParams.get("limit") || undefined,
    });
    return json(res, 200, {
      residentAgentId,
      history: reverseRecentEntries(history.evidenceRefs),
      counts: history.counts,
    });
  }

  if (req.method === "POST" && pathname === "/api/security/incident-packet/export") {
    const body = await parseBody(req);
    const trustedBody = stripUntrustedSecurityRouteAttribution(body);
    const packetState = await collectIncidentPacketState();
    const exportedAt = new Date().toISOString();
    const previewPacket = buildIncidentPacketPayload({
      security: packetState.security,
      setup: packetState.setup,
      anomalies: packetState.anomalies,
      runner: packetState.runner,
      sandboxAudits: packetState.sandboxAudits,
      sourceSurface: "/api/security/incident-packet/export",
      exportedAt,
    });
    const exportRecord = await recordIncidentPacketExport({
      residentAgentId: packetState.residentAgentId,
      packet: previewPacket,
      note: trustedBody.note,
      sourceWindowId:
        normalizeOptionalText(trustedBody.sourceWindowId) ||
        normalizeOptionalText(trustedBody.recordedByWindowId) ||
        null,
    });
    return json(
      res,
      200,
      buildIncidentPacketPayload({
        security: packetState.security,
        setup: packetState.setup,
        anomalies: packetState.anomalies,
        runner: packetState.runner,
        sandboxAudits: packetState.sandboxAudits,
        sourceSurface: "/api/security/incident-packet/export",
        exportRecord,
        exportedAt,
      })
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
          ? redactRuntimeHousekeepingForReadSession(housekeeping, access)
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
          ? redactRuntimeHousekeepingForReadSession(housekeeping, access)
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

(function bootstrapDashboardUtils(global) {
  function normalizeDashboardDidMethod(value) {
    const normalized = String(value || "").trim();
    if (normalized === "agentpassport" || normalized === "openneed") {
      return normalized;
    }
    return null;
  }

  function dashboardDidMethodLabel(value) {
    return normalizeDashboardDidMethod(value) || "default";
  }

  function formDataToObject(form) {
    const data = new FormData(form);
    return Object.fromEntries(data.entries());
  }

  function summarizeSignatureRecords(signatures = []) {
    if (!Array.isArray(signatures) || signatures.length === 0) {
      return "无";
    }

    return signatures
      .slice(-3)
      .map((record) => record.signerLabel || record.signerWalletAddress || record.approval || "signer")
      .join(" · ");
  }

  function summarizeExecutionReceipt(receipt) {
    if (!receipt) {
      return "无";
    }

    return [
      receipt.status || "unknown",
      receipt.executedAt || null,
      receipt.executorAgentId || null,
      receipt.executorWindowId || null,
      receipt.eventHash ? `event ${receipt.eventHash}` : null,
      receipt.error ? `error ${receipt.error}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
  }

  function summarizeTimelineEntries(timeline = []) {
    if (!Array.isArray(timeline) || timeline.length === 0) {
      return "无";
    }

    return timeline
      .slice(-4)
      .map((entry) => {
        const time = entry.timestamp
          ? new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour12: false })
          : "unknown";
        const actor = entry.actorLabel || entry.actorAgentId || entry.actorWindowId || "system";
        const summary = entry.summary || entry.kind || "event";
        return `${summary} @ ${time} · ${actor}`;
      })
      .join(" ｜ ");
  }

  function friendlyTimelineKind(kind) {
    const map = {
      credential_issued: "证据签发",
      credential_repaired: "迁移修复",
      credential_revoked: "证据撤销",
      migration_repair_recorded: "修复记录",
    };

    return map[kind] || kind || "时间线节点";
  }

  function summarizeTimelineDetail(entry = {}) {
    const details = entry.details || {};
    return [
      details.repairId ? `repair ${details.repairId}` : null,
      details.scope ? `scope ${details.scope}` : null,
      details.issuerAgentId ? `issuer ${details.issuerAgentId}` : null,
      Array.isArray(details.issuedDidMethods) && details.issuedDidMethods.length
        ? `methods ${details.issuedDidMethods.join(", ")}`
        : null,
      details.statusListId ? `statusList ${details.statusListId}` : null,
      details.statusListIndex != null ? `#${details.statusListIndex}` : null,
      details.reason ? `reason ${details.reason}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function friendlyCredentialKind(kind) {
    const map = {
      agent_identity: "Agent 身份证据",
      authorization_receipt: "授权回执证据",
      agent_comparison: "Agent 对比证据",
      migration_receipt: "迁移修复回执",
    };

    return map[kind] || kind || "未知证据";
  }

  function summarizeMigrationRepairCard(repair) {
    if (!repair) {
      return "无";
    }

    const item = repair.repair || repair;
    return [
      repair.repairId || item.repairId || null,
      item.summary || null,
      item.repairedCount != null && item.plannedRepairCount != null
        ? `repaired ${item.repairedCount}/${item.plannedRepairCount}`
        : item.repairedCount != null
          ? `repaired ${item.repairedCount}`
          : null,
      Array.isArray(repair.issuedDidMethods) && repair.issuedDidMethods.length
        ? repair.issuedDidMethods.join(", ")
        : Array.isArray(item.requestedDidMethods) && item.requestedDidMethods.length
          ? item.requestedDidMethods.join(", ")
          : null,
      repair.latestIssuedAt || item.generatedAt || null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function buildCompactRepairView(repair) {
    if (!repair) {
      return null;
    }

    const item = repair.repair || repair;
    return {
      repairId: repair.repairId || item.repairId || null,
      scope: item.scope || null,
      summary: item.summary || null,
      issuerAgentId: item.issuerAgentId || null,
      issuerDid: item.issuerDid || null,
      targetAgentId: item.targetAgentId || null,
      generatedAt: item.generatedAt || null,
      latestIssuedAt: repair.latestIssuedAt || null,
      issuedDidMethods: repair.issuedDidMethods || item.issuedDidMethods || [],
      repairedCount: item.repairedCount ?? null,
      plannedRepairCount: item.plannedRepairCount ?? null,
      receiptCount: repair.receiptCount ?? null,
    };
  }

  function summarizeWindowBinding(binding) {
    if (!binding) {
      return null;
    }

    return [
      binding.agentId || null,
      binding.label || "window",
      binding.windowId || null,
      binding.linkedAt ? `linked ${binding.linkedAt}` : null,
      binding.lastSeenAt ? `seen ${binding.lastSeenAt}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  global.AgentPassportDashboardUtils = {
    normalizeDashboardDidMethod,
    dashboardDidMethodLabel,
    formDataToObject,
    summarizeSignatureRecords,
    summarizeExecutionReceipt,
    summarizeTimelineEntries,
    friendlyTimelineKind,
    summarizeTimelineDetail,
    friendlyCredentialKind,
    summarizeMigrationRepairCard,
    buildCompactRepairView,
    summarizeWindowBinding,
  };
})(globalThis);

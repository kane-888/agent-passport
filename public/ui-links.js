(function attachAgentPassportLinks(globalObject) {
  const CANONICAL_MAIN_AGENT_ID = "agent_main";
  const LEGACY_PHYSICAL_MAIN_AGENT_ID = "agent_openneed_agents";
  const CANONICAL_MAIN_AGENT_LABEL = "主控 Agent（canonical）";
  const LEGACY_PHYSICAL_MAIN_AGENT_LABEL = "主控 Agent（legacy physical）";
  const AMBIGUOUS_MAIN_AGENT_LABEL = "主控 Agent（未区分 canonical / physical）";
  const MAIN_AGENT_ENTITY_LABELS = Object.freeze({
    [CANONICAL_MAIN_AGENT_ID]: CANONICAL_MAIN_AGENT_LABEL,
    [LEGACY_PHYSICAL_MAIN_AGENT_ID]: LEGACY_PHYSICAL_MAIN_AGENT_LABEL,
    "agent-passport Main Agent": CANONICAL_MAIN_AGENT_LABEL,
    "主控 Agent": AMBIGUOUS_MAIN_AGENT_LABEL,
  });
  const MAIN_AGENT_FILTER_ALIASES = Object.freeze({
    [CANONICAL_MAIN_AGENT_LABEL]: CANONICAL_MAIN_AGENT_ID,
    [LEGACY_PHYSICAL_MAIN_AGENT_LABEL]: CANONICAL_MAIN_AGENT_ID,
    [AMBIGUOUS_MAIN_AGENT_LABEL]: CANONICAL_MAIN_AGENT_ID,
    "主控 Agent": CANONICAL_MAIN_AGENT_ID,
    "agent-passport Main Agent": CANONICAL_MAIN_AGENT_ID,
    [CANONICAL_MAIN_AGENT_ID]: CANONICAL_MAIN_AGENT_ID,
    [LEGACY_PHYSICAL_MAIN_AGENT_ID]: CANONICAL_MAIN_AGENT_ID,
  });

  function normalizeSearchInput(search) {
    if (!search) {
      return "";
    }

    if (typeof search === "string") {
      if (search.startsWith("?")) {
        return search.slice(1);
      }
      const questionIndex = search.indexOf("?");
      return questionIndex >= 0 ? search.slice(questionIndex + 1) : search;
    }

    if (typeof URLSearchParams !== "undefined" && search instanceof URLSearchParams) {
      return search.toString();
    }

    return String(search);
  }

  function buildSearch(params = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") {
        continue;
      }
      search.set(key, String(value));
    }
    return search;
  }

  function parseInteger(value, fallback) {
    if (value == null || value === "") {
      return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }

    return parsed;
  }

  function canonicalizeRepairHubAgentId(value, fallback = null) {
    const normalized = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    if (!normalized) {
      return fallback;
    }
    return normalized === LEGACY_PHYSICAL_MAIN_AGENT_ID ? CANONICAL_MAIN_AGENT_ID : normalized;
  }

  function humanizeMainAgentEntityLabel(value, fallback = null) {
    const normalized = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    if (!normalized) {
      return fallback;
    }
    return MAIN_AGENT_ENTITY_LABELS[normalized] || fallback;
  }

  function normalizeMainAgentEntityFilter(value, fallback = null) {
    const normalized = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    if (!normalized) {
      return fallback;
    }
    return MAIN_AGENT_FILTER_ALIASES[normalized] || normalized;
  }

  function parseRuntimeHomeSearch(search, defaults = {}) {
    const params = new URLSearchParams(normalizeSearchInput(search));
    const defaultRepairLimit = parseInteger(defaults.repairLimit, 6);
    const defaultRepairOffset = parseInteger(defaults.repairOffset, 0);
    return {
      agentId: params.get("agentId") || defaults.agentId || null,
      didMethod: params.get("didMethod") || defaults.didMethod || null,
      windowId: params.get("windowId") || defaults.windowId || null,
      repairId: params.get("repairId") || defaults.repairId || null,
      credentialId: params.get("credentialId") || defaults.credentialId || null,
      statusListId: params.get("statusListId") || defaults.statusListId || null,
      statusListCompareId: params.get("statusListCompareId") || defaults.statusListCompareId || null,
      repairLimit: parseInteger(params.get("repairLimit"), defaultRepairLimit),
      repairOffset: parseInteger(params.get("repairOffset"), defaultRepairOffset),
      compareLeftAgentId: params.get("compareLeftAgentId") || params.get("agentId") || defaults.compareLeftAgentId || null,
      compareRightAgentId: params.get("compareRightAgentId") || defaults.compareRightAgentId || null,
      compareIssuerAgentId: params.get("compareIssuerAgentId") || defaults.compareIssuerAgentId || null,
      compareIssuerDidMethod: params.get("compareIssuerDidMethod") || defaults.compareIssuerDidMethod || null,
    };
  }

  function buildRuntimeHomeSearch(params = {}) {
    return buildSearch({
      agentId: params.agentId,
      didMethod: params.didMethod,
      windowId: params.windowId,
      repairId: params.repairId,
      credentialId: params.credentialId,
      statusListId: params.statusListId,
      statusListCompareId: params.statusListCompareId,
      repairLimit: params.repairLimit,
      repairOffset: params.repairOffset,
      compareLeftAgentId: params.compareLeftAgentId,
      compareRightAgentId: params.compareRightAgentId,
      compareIssuerAgentId: params.compareIssuerAgentId,
      compareIssuerDidMethod: params.compareIssuerDidMethod,
    });
  }

  function buildRuntimeHomeHref(params = {}) {
    const search = buildRuntimeHomeSearch(params);
    return `/${search.toString() ? `?${search.toString()}` : ""}`;
  }

  function parseRepairHubSearch(search, defaults = {}) {
    const params = new URLSearchParams(normalizeSearchInput(search));
    const defaultLimit = parseInteger(defaults.limit, 5);
    const defaultOffset = parseInteger(defaults.offset, 0);

    return {
      agentId: canonicalizeRepairHubAgentId(params.get("agentId"), defaults.agentId || ""),
      issuerAgentId: canonicalizeRepairHubAgentId(params.get("issuerAgentId"), defaults.issuerAgentId || ""),
      scope: params.get("scope") || defaults.scope || "",
      didMethod: params.get("didMethod") || defaults.didMethod || "",
      windowId: params.get("windowId") || defaults.windowId || null,
      sortBy: params.get("sortBy") || defaults.sortBy || "latestIssuedAt",
      sortOrder: params.get("sortOrder") || defaults.sortOrder || "desc",
      limit: parseInteger(params.get("limit"), defaultLimit),
      offset: parseInteger(params.get("offset"), defaultOffset),
      repairId: params.get("repairId") || defaults.repairId || null,
      credentialId: params.get("credentialId") || defaults.credentialId || null,
    };
  }

  function buildRepairHubSearch(params = {}) {
    return buildSearch({
      agentId: canonicalizeRepairHubAgentId(params.agentId),
      issuerAgentId: canonicalizeRepairHubAgentId(params.issuerAgentId),
      scope: params.scope,
      didMethod: params.didMethod,
      windowId: params.windowId,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      limit: params.limit,
      offset: params.offset,
      repairId: params.repairId,
      credentialId: params.credentialId,
    });
  }

  function buildRepairHubHref(params = {}) {
    const search = buildRepairHubSearch(params);
    return `/repair-hub${search.toString() ? `?${search.toString()}` : ""}`;
  }

  function buildPublicRuntimeHref(params = {}) {
    return "/";
  }

  const api = {
    CANONICAL_MAIN_AGENT_ID,
    LEGACY_PHYSICAL_MAIN_AGENT_ID,
    CANONICAL_MAIN_AGENT_LABEL,
    LEGACY_PHYSICAL_MAIN_AGENT_LABEL,
    AMBIGUOUS_MAIN_AGENT_LABEL,
    canonicalizeRepairHubAgentId,
    humanizeMainAgentEntityLabel,
    normalizeMainAgentEntityFilter,
    parseRuntimeHomeSearch,
    buildRuntimeHomeSearch,
    buildRuntimeHomeHref,
    parseRepairHubSearch,
    buildRepairHubSearch,
    buildRepairHubHref,
    buildPublicRuntimeHref,
    parseDashboardSearch: parseRuntimeHomeSearch,
    buildDashboardSearch: buildRuntimeHomeSearch,
    buildDashboardHref: buildRuntimeHomeHref,
    buildMainConsoleHref: buildPublicRuntimeHref,
  };

  globalObject.AgentPassportLinks = api;
})(globalThis);

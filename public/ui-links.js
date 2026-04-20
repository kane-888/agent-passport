(function attachAgentPassportLinks(globalObject) {
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
      agentId: params.get("agentId") || defaults.agentId || "",
      issuerAgentId: params.get("issuerAgentId") || defaults.issuerAgentId || "",
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
      agentId: params.agentId,
      issuerAgentId: params.issuerAgentId,
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

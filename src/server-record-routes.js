import {
  compareCredentialStatusLists,
  createAuthorizationProposal,
  executeAuthorizationProposal,
  getAuthorizationProposal,
  getAuthorizationProposalCredential,
  getAuthorizationProposalTimeline,
  getCredential,
  getCredentialStatus,
  getCredentialStatusList,
  getCredentialTimeline,
  getLedger,
  getMigrationRepair,
  getMigrationRepairCredentials,
  getMigrationRepairTimeline,
  getWindow,
  linkWindow,
  listAuthorizationProposals,
  listCredentialStatusLists,
  listCredentials,
  listMigrationRepairs,
  listWindows,
  revokeAuthorizationProposal,
  revokeCredential,
  signAuthorizationProposal,
  verifyCredential,
} from "./ledger.js";
import {
  applyFilteredCount,
  applyFilteredCountsAndPage,
  filterReadSessionEntries,
  getDidMethodParam,
  getIssueBothMethodsParam,
  getRequestAccess,
  getSearchParam,
  json,
  toBooleanParam,
} from "./server-base-helpers.js";
import {
  authorizationMatchesReadSession,
  credentialMatchesReadSession,
  denyReadSessionResource,
  ensureReadSessionResource,
  hasReadSessionAccess,
  migrationRepairMatchesReadSession,
  shouldRedactReadSessionPayload,
  statusListMatchesReadSession,
  windowMatchesReadSession,
} from "./server-read-access.js";
import {
  redactAuthorizationViewForReadSession,
  redactCredentialExportForReadSession,
  redactCredentialRecordForReadSession,
  redactMigrationRepairViewForReadSession,
  redactStatusListComparisonForReadSession,
  redactStatusListDetailForReadSession,
  redactStatusListSummaryForReadSession,
  redactTimelineEntryForReadSession,
  summarizeCredentialDocumentForReadSession,
} from "./server-agent-redaction.js";

export async function handleRecordRoutes({
  req,
  res,
  url,
  pathname,
  segments,
  parseBody,
  jsonForReadSession,
}) {
  if (pathname === "/api/migration-repairs") {
    if (req.method === "GET") {
      const repairs = await listMigrationRepairs({
        agentId: getSearchParam(url, "agentId"),
        comparisonSubjectId: getSearchParam(url, "comparisonSubjectId"),
        comparisonDigest: getSearchParam(url, "comparisonDigest"),
        issuerAgentId: getSearchParam(url, "issuerAgentId"),
        scope: getSearchParam(url, "scope"),
        didMethod: getDidMethodParam(url),
        sortBy: getSearchParam(url, "sortBy"),
        sortOrder: getSearchParam(url, "sortOrder"),
        limit: getSearchParam(url, "limit"),
        offset: getSearchParam(url, "offset"),
      });
      const access = getRequestAccess(req);
      const filteredRepairs = filterReadSessionEntries(
        access,
        repairs.repairs,
        migrationRepairMatchesReadSession
      );
      return jsonForReadSession(
        res,
        access,
        200,
        applyFilteredCountsAndPage({ ...repairs, repairs: filteredRepairs }, filteredRepairs),
        (payload) => ({
          ...payload,
          repairs: Array.isArray(payload.repairs)
            ? payload.repairs.map(redactMigrationRepairViewForReadSession)
            : [],
        })
      );
    }
  }

  if (segments[0] === "api" && segments[1] === "migration-repairs" && segments[2]) {
    const repairId = decodeURIComponent(segments[2]);
    const action = segments[3];

    if (req.method === "GET" && !action) {
      const repair = await getMigrationRepair(repairId, {
        didMethod: getDidMethodParam(url),
      });
      const access = req.agentPassportAccess || null;
      if (!migrationRepairMatchesReadSession(access, repair)) {
        return denyReadSessionResource(res, "migration_repair", repairId);
      }
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? {
              repair: {
                ...repair,
                repair: redactMigrationRepairViewForReadSession(repair.repair),
                receipts: Array.isArray(repair.receipts)
                  ? repair.receipts.map(redactCredentialRecordForReadSession)
                  : [],
                latestReceipt: redactCredentialRecordForReadSession(repair.latestReceipt),
              },
            }
          : { repair }
      );
    }

    if (req.method === "GET" && action === "credentials") {
      const credentials = await getMigrationRepairCredentials(repairId, {
        didMethod: getDidMethodParam(url),
        sortBy: getSearchParam(url, "sortBy"),
        sortOrder: getSearchParam(url, "sortOrder"),
        limit: getSearchParam(url, "limit"),
        offset: getSearchParam(url, "offset"),
      });
      const access = getRequestAccess(req);
      if (
        !ensureReadSessionResource(
          res,
          migrationRepairMatchesReadSession(access, credentials.repair),
          "migration_repair",
          repairId
        )
      ) {
        return;
      }
      const filteredCredentials = filterReadSessionEntries(
        access,
        credentials.credentials,
        credentialMatchesReadSession
      );
      return jsonForReadSession(
        res,
        access,
        200,
        applyFilteredCountsAndPage(
          { ...credentials, credentials: filteredCredentials },
          filteredCredentials
        ),
        (payload) => ({
          ...payload,
          repair: redactMigrationRepairViewForReadSession(payload.repair),
          receipts: Array.isArray(payload.receipts)
            ? payload.receipts.map(redactCredentialRecordForReadSession)
            : [],
          credentials: Array.isArray(payload.credentials)
            ? payload.credentials.map(redactCredentialRecordForReadSession)
            : [],
        })
      );
    }

    if (req.method === "GET" && action === "timeline") {
      const timeline = await getMigrationRepairTimeline(repairId, {
        didMethod: getDidMethodParam(url),
      });
      const access = req.agentPassportAccess || null;
      if (!migrationRepairMatchesReadSession(access, timeline)) {
        return denyReadSessionResource(res, "migration_repair", repairId);
      }
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? {
              ...timeline,
              repair: redactMigrationRepairViewForReadSession(timeline.repair),
              receipts: Array.isArray(timeline.receipts)
                ? timeline.receipts.map(redactCredentialRecordForReadSession)
                : [],
              latestReceipt: redactCredentialRecordForReadSession(timeline.latestReceipt),
              timeline: Array.isArray(timeline.timeline)
                ? timeline.timeline.map(redactTimelineEntryForReadSession)
                : [],
            }
          : timeline
      );
    }
  }

  if (req.method === "GET" && pathname === "/api/credentials") {
    const result = await listCredentials({
      agentId: getSearchParam(url, "agentId"),
      proposalId: getSearchParam(url, "proposalId"),
      kind: getSearchParam(url, "kind"),
      status: getSearchParam(url, "status"),
      didMethod: getDidMethodParam(url),
      issuerDid: getSearchParam(url, "issuerDid"),
      issuerAgentId: getSearchParam(url, "issuerAgentId"),
      repaired: toBooleanParam(url.searchParams.get("repaired")),
      repairId: getSearchParam(url, "repairId"),
      sortBy: getSearchParam(url, "sortBy"),
      sortOrder: getSearchParam(url, "sortOrder"),
      repairLimit: getSearchParam(url, "repairLimit"),
      repairOffset: getSearchParam(url, "repairOffset"),
      repairSortBy: getSearchParam(url, "repairSortBy"),
      repairSortOrder: getSearchParam(url, "repairSortOrder"),
      limit: getSearchParam(url, "limit"),
    });
    const access = getRequestAccess(req);
    const filteredCredentials = filterReadSessionEntries(
      access,
      result.credentials,
      credentialMatchesReadSession
    );
    return jsonForReadSession(
      res,
      access,
      200,
      applyFilteredCount(
        { ...result, credentials: filteredCredentials },
        filteredCredentials
      ),
      (payload) => ({
        ...payload,
        credentials: Array.isArray(payload.credentials)
          ? payload.credentials.map(redactCredentialRecordForReadSession)
          : [],
      })
    );
  }

  if (req.method === "POST" && pathname === "/api/credentials/verify") {
    const body = await parseBody(req);
    const verification = await verifyCredential(body.credential ?? body);
    return json(res, 200, { verification });
  }

  if (segments[0] === "api" && segments[1] === "credentials" && segments[2]) {
    const credentialId = decodeURIComponent(segments[2]);
    const action = segments[3];

    if (req.method === "GET" && !action) {
      const credential = await getCredential(credentialId);
      const access = req.agentPassportAccess || null;
      if (!credentialMatchesReadSession(access, credential.credentialRecord)) {
        return denyReadSessionResource(res, "credential", credentialId);
      }
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? {
              credentialRecord: redactCredentialRecordForReadSession(
                credential.credentialRecord
              ),
              credential: summarizeCredentialDocumentForReadSession(
                credential.credential
              ),
              siblings: credential.siblings,
            }
          : credential
      );
    }

    if (req.method === "GET" && action === "timeline") {
      const timeline = await getCredentialTimeline(credentialId);
      const access = req.agentPassportAccess || null;
      if (!credentialMatchesReadSession(access, timeline.credentialRecord)) {
        return denyReadSessionResource(res, "credential", credentialId);
      }
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? {
              ...timeline,
              credentialRecord: redactCredentialRecordForReadSession(
                timeline.credentialRecord
              ),
              timeline: Array.isArray(timeline.timeline)
                ? timeline.timeline.map(redactTimelineEntryForReadSession)
                : [],
            }
          : timeline
      );
    }

    if (req.method === "GET" && action === "status") {
      const status = await getCredentialStatus(credentialId);
      const access = req.agentPassportAccess || null;
      if (
        !credentialMatchesReadSession(
          access,
          status?.credentialRecord || status?.credential || { credentialId }
        )
      ) {
        return denyReadSessionResource(res, "credential", credentialId);
      }
      return json(res, 200, status);
    }

    if (req.method === "POST" && action === "revoke") {
      const body = await parseBody(req);
      const credential = await revokeCredential(credentialId, body);
      return json(res, 200, credential);
    }
  }

  if (pathname === "/api/authorizations") {
    if (req.method === "GET") {
      const agentId = getSearchParam(url, "agentId");
      const authorizations = await listAuthorizationProposals({
        agentId,
        limit: getSearchParam(url, "limit"),
      });
      const access = getRequestAccess(req);
      const filteredAuthorizations = filterReadSessionEntries(
        access,
        authorizations,
        authorizationMatchesReadSession
      );
      return jsonForReadSession(res, access, 200, { authorizations: filteredAuthorizations }, (payload) => ({
        authorizations: Array.isArray(payload.authorizations)
          ? payload.authorizations.map(redactAuthorizationViewForReadSession)
          : [],
      }));
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const authorization = await createAuthorizationProposal(body);
      return json(res, 201, { authorization });
    }
  }

  if (segments[0] === "api" && segments[1] === "authorizations" && segments[2]) {
    const proposalId = segments[2];
    const action = segments[3];

    if (req.method === "GET" && !action) {
      const authorization = await getAuthorizationProposal(proposalId);
      const access = req.agentPassportAccess || null;
      if (!authorizationMatchesReadSession(access, authorization)) {
        return denyReadSessionResource(res, "authorization", proposalId);
      }
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? { authorization: redactAuthorizationViewForReadSession(authorization) }
          : { authorization }
      );
    }

    if (req.method === "GET" && action === "timeline") {
      const timeline = await getAuthorizationProposalTimeline(proposalId);
      const access = req.agentPassportAccess || null;
      if (!authorizationMatchesReadSession(access, timeline.authorization)) {
        return denyReadSessionResource(res, "authorization", proposalId);
      }
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? {
              ...timeline,
              authorization: redactAuthorizationViewForReadSession(
                timeline.authorization
              ),
              timeline: Array.isArray(timeline.timeline)
                ? timeline.timeline.map(redactTimelineEntryForReadSession)
                : [],
            }
          : timeline
      );
    }

    if (req.method === "GET" && action === "credential") {
      const credential = await getAuthorizationProposalCredential(proposalId, {
        didMethod: getDidMethodParam(url),
        issueBothMethods: toBooleanParam(url.searchParams.get("issueBothMethods")),
      });
      const access = req.agentPassportAccess || null;
      if (!credentialMatchesReadSession(access, credential?.credentialRecord)) {
        return denyReadSessionResource(res, "authorization_credential", proposalId);
      }
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? { credential: redactCredentialExportForReadSession(credential) }
          : { credential }
      );
    }

    if (req.method === "POST" && action === "sign") {
      const body = await parseBody(req);
      const authorization = await signAuthorizationProposal(proposalId, body);
      return json(res, 200, { authorization });
    }

    if (req.method === "POST" && action === "execute") {
      const body = await parseBody(req);
      const result = await executeAuthorizationProposal(proposalId, body);
      return json(res, 200, result);
    }

    if (req.method === "POST" && action === "revoke") {
      const body = await parseBody(req);
      const authorization = await revokeAuthorizationProposal(proposalId, body);
      return json(res, 200, { authorization });
    }
  }

  if (req.method === "GET" && pathname === "/api/windows") {
    const windows = await listWindows();
    const access = req.agentPassportAccess || null;
    const filteredWindows = hasReadSessionAccess(access)
      ? windows.filter((entry) => windowMatchesReadSession(access, entry))
      : windows;
    return json(res, 200, { windows: filteredWindows });
  }

  if (req.method === "POST" && pathname === "/api/windows/link") {
    const body = await parseBody(req);
    const window = await linkWindow(body);
    return json(res, 201, { window });
  }

  if (segments[0] === "api" && segments[1] === "windows" && segments[2]) {
    const windowId = segments[2];
    if (req.method === "GET") {
      const window = await getWindow(windowId);
      const access = req.agentPassportAccess || null;
      if (!windowMatchesReadSession(access, window)) {
        return denyReadSessionResource(res, "window", windowId);
      }
      return json(res, 200, { window });
    }
  }

  if (req.method === "GET" && pathname === "/api/ledger") {
    const ledger = await getLedger();
    return json(res, 200, ledger);
  }

  if (req.method === "GET" && pathname === "/api/status-lists") {
    const statusLists = await listCredentialStatusLists({
      issuerDid: url.searchParams.get("issuerDid") || undefined,
      issuerAgentId: url.searchParams.get("issuerAgentId") || undefined,
    });
    const access = req.agentPassportAccess || null;
    const filteredStatusLists = hasReadSessionAccess(access)
      ? Array.isArray(statusLists.statusLists)
        ? statusLists.statusLists.filter((entry) => statusListMatchesReadSession(access, entry))
        : []
      : statusLists.statusLists;
    return json(
      res,
      200,
      shouldRedactReadSessionPayload(access)
        ? {
            ...statusLists,
            count: Array.isArray(filteredStatusLists) ? filteredStatusLists.length : 0,
            statusLists: Array.isArray(filteredStatusLists)
              ? filteredStatusLists.map(redactStatusListSummaryForReadSession)
              : [],
          }
        : {
            ...statusLists,
            count: Array.isArray(filteredStatusLists)
              ? filteredStatusLists.length
              : statusLists.count,
            statusLists: filteredStatusLists,
          }
    );
  }

  if (req.method === "GET" && pathname === "/api/status-lists/compare") {
    const comparison = await compareCredentialStatusLists({
      leftStatusListId:
        url.searchParams.get("leftStatusListId") || url.searchParams.get("left") || undefined,
      rightStatusListId:
        url.searchParams.get("rightStatusListId") || url.searchParams.get("right") || undefined,
      leftIssuerDid: url.searchParams.get("leftIssuerDid") || undefined,
      rightIssuerDid: url.searchParams.get("rightIssuerDid") || undefined,
      leftIssuerAgentId: url.searchParams.get("leftIssuerAgentId") || undefined,
      rightIssuerAgentId: url.searchParams.get("rightIssuerAgentId") || undefined,
    });
    const access = req.agentPassportAccess || null;
    if (
      !statusListMatchesReadSession(access, comparison.left) ||
      !statusListMatchesReadSession(access, comparison.right)
    ) {
      return denyReadSessionResource(
        res,
        "status_list_compare",
        `${comparison.leftStatusListId}:${comparison.rightStatusListId}`
      );
    }
    return json(
      res,
      200,
      shouldRedactReadSessionPayload(access)
        ? redactStatusListComparisonForReadSession(comparison)
        : comparison
    );
  }

  if (segments[0] === "api" && segments[1] === "status-lists" && segments[2]) {
    const statusListId = decodeURIComponent(segments[2]);
    if (req.method === "GET") {
      const statusList = await getCredentialStatusList(statusListId);
      const access = req.agentPassportAccess || null;
      if (!statusListMatchesReadSession(access, statusList)) {
        return denyReadSessionResource(res, "status_list", statusListId);
      }
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactStatusListDetailForReadSession(statusList)
          : statusList
      );
    }
  }

  return null;
}

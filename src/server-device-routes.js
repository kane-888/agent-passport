import {
  configureDeviceRuntime,
  deleteDeviceLocalReasonerProfile,
  deleteDeviceSetupPackage,
  exportDeviceSetupPackage,
  exportStoreRecoveryBundle,
  getDeviceLocalReasonerCatalog,
  getDeviceLocalReasonerProfile,
  getDeviceRuntimeState,
  getDeviceSetupPackage,
  getDeviceSetupStatus,
  importDeviceSetupPackage,
  importStoreRecoveryBundle,
  inspectDeviceLocalReasoner,
  listDeviceLocalReasonerProfiles,
  listDeviceLocalReasonerRestoreCandidates,
  listDeviceSetupPackages,
  listRecoveryRehearsals,
  listStoreRecoveryBundles,
  migrateDeviceLocalReasonerToDefault,
  probeDeviceLocalReasoner,
  prewarmDeviceLocalReasoner,
  pruneDeviceSetupPackages,
  restoreDeviceLocalReasoner,
  rehearseStoreRecoveryBundle,
  runDeviceSetup,
  saveDeviceLocalReasonerProfile,
  selectDeviceLocalReasoner,
  activateDeviceLocalReasonerProfile,
} from "./ledger.js";
import { json, toBooleanParam } from "./server-base-helpers.js";
import { shouldRedactReadSessionPayload } from "./server-read-access.js";
import {
  redactLocalReasonerCatalogForReadSession,
  redactLocalReasonerDiagnosticForReadSession,
  redactLocalReasonerProfileDetailForReadSession,
  redactLocalReasonerProfileListingForReadSession,
  redactLocalReasonerRuntimeViewForReadSession,
  redactRecoveryListingForReadSession,
  redactSetupPackageDetailForReadSession,
  redactSetupPackageListingForReadSession,
} from "./server-security-redaction.js";
import {
  redactDeviceRuntimeStateForReadSession,
  redactDeviceSetupStatusForReadSession,
  redactRecoveryRehearsalForReadSession,
} from "./server-agent-redaction.js";

export async function handleDeviceRoutes({
  req,
  res,
  url,
  pathname,
  segments,
  parseBody,
}) {
  if (pathname === "/api/device/runtime") {
    if (req.method === "GET") {
      const runtimeState = await getDeviceRuntimeState();
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactDeviceRuntimeStateForReadSession(runtimeState, access)
          : runtimeState
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const deviceRuntime = await configureDeviceRuntime(body);
      return json(res, 200, deviceRuntime);
    }
  }

  if (pathname === "/api/device/setup") {
    if (req.method === "GET") {
      const setup = await getDeviceSetupStatus();
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactDeviceSetupStatusForReadSession(setup, access)
          : setup
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const setup = await runDeviceSetup(body);
      return json(res, 200, setup);
    }
  }

  if (pathname === "/api/device/setup/packages") {
    if (req.method === "GET") {
      const packages = await listDeviceSetupPackages({
        limit: url.searchParams.get("limit") || undefined,
      });
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactSetupPackageListingForReadSession(packages, access)
          : packages
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const pruned = await pruneDeviceSetupPackages(body);
      return json(res, 200, pruned);
    }
  }

  if (
    req.method === "GET" &&
    segments[0] === "api" &&
    segments[1] === "device" &&
    segments[2] === "setup" &&
    segments[3] === "packages" &&
    segments[4]
  ) {
    const setupPackage = await getDeviceSetupPackage(segments[4], {
      includePackage: toBooleanParam(url.searchParams.get("includePackage")) ?? true,
    });
    const access = req.agentPassportAccess || null;
    return json(
      res,
      200,
      shouldRedactReadSessionPayload(access)
        ? redactSetupPackageDetailForReadSession(setupPackage, access)
        : setupPackage
    );
  }

  if (
    req.method === "POST" &&
    segments[0] === "api" &&
    segments[1] === "device" &&
    segments[2] === "setup" &&
    segments[3] === "packages" &&
    segments[4] &&
    segments[5] === "delete"
  ) {
    const body = await parseBody(req);
    const deleted = await deleteDeviceSetupPackage(segments[4], body);
    return json(res, 200, deleted);
  }

  if (pathname === "/api/device/setup/package") {
    if (req.method === "GET") {
      const setupPackage = await exportDeviceSetupPackage({
        dryRun: true,
        saveToFile: false,
        returnPackage: true,
      });
      return json(res, 200, setupPackage);
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const setupPackage = await exportDeviceSetupPackage(body);
      return json(res, 200, setupPackage);
    }
  }

  if (req.method === "POST" && pathname === "/api/device/setup/package/import") {
    const body = await parseBody(req);
    const setupImport = await importDeviceSetupPackage(body);
    return json(res, 200, setupImport);
  }

  if (pathname === "/api/device/runtime/local-reasoner") {
    if (req.method === "GET") {
      const diagnostics = await inspectDeviceLocalReasoner();
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? {
              ...diagnostics,
              deviceRuntime: redactLocalReasonerRuntimeViewForReadSession(
                diagnostics.deviceRuntime,
                access
              ),
              diagnostics: redactLocalReasonerDiagnosticForReadSession(
                diagnostics.diagnostics,
                access
              ),
              rawDiagnostics: null,
            }
          : diagnostics
      );
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/select") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const selected = await selectDeviceLocalReasoner(body);
      return json(res, 200, selected);
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/migrate-default") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const migrated = await migrateDeviceLocalReasonerToDefault(body);
      return json(res, 200, migrated);
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/catalog") {
    if (req.method === "GET") {
      const catalog = await getDeviceLocalReasonerCatalog();
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactLocalReasonerCatalogForReadSession(catalog, access)
          : catalog
      );
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/restore-candidates") {
    if (req.method === "GET") {
      const candidates = await listDeviceLocalReasonerRestoreCandidates({
        limit: url.searchParams.get("limit") || undefined,
      });
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactLocalReasonerProfileListingForReadSession(candidates, access)
          : candidates
      );
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/profiles") {
    if (req.method === "GET") {
      const profiles = await listDeviceLocalReasonerProfiles({
        limit: url.searchParams.get("limit") || undefined,
      });
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactLocalReasonerProfileListingForReadSession(profiles, access)
          : profiles
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const profile = await saveDeviceLocalReasonerProfile(body);
      return json(res, 200, profile);
    }
  }

  if (
    req.method === "GET" &&
    segments[0] === "api" &&
    segments[1] === "device" &&
    segments[2] === "runtime" &&
    segments[3] === "local-reasoner" &&
    segments[4] === "profiles" &&
    segments[5]
  ) {
    const profile = await getDeviceLocalReasonerProfile(segments[5], {
      includeProfile: toBooleanParam(url.searchParams.get("includeProfile")) ?? true,
    });
    const access = req.agentPassportAccess || null;
    return json(
      res,
      200,
      shouldRedactReadSessionPayload(access)
        ? redactLocalReasonerProfileDetailForReadSession(profile, access)
        : profile
    );
  }

  if (
    req.method === "POST" &&
    segments[0] === "api" &&
    segments[1] === "device" &&
    segments[2] === "runtime" &&
    segments[3] === "local-reasoner" &&
    segments[4] === "profiles" &&
    segments[5] &&
    segments[6] === "activate"
  ) {
    const body = await parseBody(req);
    const activated = await activateDeviceLocalReasonerProfile(segments[5], body);
    return json(res, 200, activated);
  }

  if (
    req.method === "POST" &&
    segments[0] === "api" &&
    segments[1] === "device" &&
    segments[2] === "runtime" &&
    segments[3] === "local-reasoner" &&
    segments[4] === "profiles" &&
    segments[5] &&
    segments[6] === "delete"
  ) {
    const body = await parseBody(req);
    const deleted = await deleteDeviceLocalReasonerProfile(segments[5], body);
    return json(res, 200, deleted);
  }

  if (pathname === "/api/device/runtime/local-reasoner/probe") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const probe = await probeDeviceLocalReasoner(body);
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? {
              ...probe,
              diagnostics: redactLocalReasonerDiagnosticForReadSession(probe.diagnostics, access),
              rawDiagnostics: null,
            }
          : probe
      );
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/prewarm") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const prewarmed = await prewarmDeviceLocalReasoner(body);
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? {
              ...prewarmed,
              deviceRuntime: redactLocalReasonerRuntimeViewForReadSession(
                prewarmed.deviceRuntime,
                access
              ),
              diagnostics: redactLocalReasonerDiagnosticForReadSession(
                prewarmed.diagnostics,
                access
              ),
              rawDiagnostics: null,
              warmState: prewarmed.warmState
                ? {
                    ...prewarmed.warmState,
                    responsePreview: null,
                  }
                : null,
              candidate: null,
            }
          : prewarmed
      );
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/restore") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const restored = await restoreDeviceLocalReasoner(body);
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? {
              ...restored,
              activation: restored.activation
                ? {
                    ...restored.activation,
                    runtime: redactLocalReasonerRuntimeViewForReadSession(
                      restored.activation.runtime,
                      access
                    ),
                  }
                : null,
              prewarmResult: restored.prewarmResult
                ? {
                    ...restored.prewarmResult,
                    deviceRuntime: redactLocalReasonerRuntimeViewForReadSession(
                      restored.prewarmResult.deviceRuntime,
                      access
                    ),
                    diagnostics: redactLocalReasonerDiagnosticForReadSession(
                      restored.prewarmResult.diagnostics,
                      access
                    ),
                    rawDiagnostics: null,
                    warmState: restored.prewarmResult.warmState
                      ? {
                          ...restored.prewarmResult.warmState,
                          responsePreview: null,
                        }
                      : null,
                    candidate: null,
                  }
                : null,
              deviceRuntime: redactLocalReasonerRuntimeViewForReadSession(
                restored.deviceRuntime,
                access
              ),
            }
          : restored
      );
    }
  }

  if (pathname === "/api/device/runtime/recovery") {
    if (req.method === "GET") {
      const recovery = await listStoreRecoveryBundles({
        limit: url.searchParams.get("limit") || undefined,
      });
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? redactRecoveryListingForReadSession(recovery, access)
          : recovery
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const recovery = await exportStoreRecoveryBundle(body);
      return json(res, 200, recovery);
    }
  }

  if (pathname === "/api/device/runtime/recovery/rehearsals") {
    if (req.method === "GET") {
      const rehearsals = await listRecoveryRehearsals({
        limit: url.searchParams.get("limit") || undefined,
      });
      const access = req.agentPassportAccess || null;
      return json(
        res,
        200,
        shouldRedactReadSessionPayload(access)
          ? {
              ...rehearsals,
              rehearsals: Array.isArray(rehearsals.rehearsals)
                ? rehearsals.rehearsals.map((entry) =>
                    redactRecoveryRehearsalForReadSession(entry, access)
                  )
                : [],
            }
          : rehearsals
      );
    }
  }

  if (req.method === "POST" && pathname === "/api/device/runtime/recovery/verify") {
    const body = await parseBody(req);
    const rehearsal = await rehearseStoreRecoveryBundle(body);
    return json(res, 200, rehearsal);
  }

  if (req.method === "POST" && pathname === "/api/device/runtime/recovery/import") {
    const body = await parseBody(req);
    const recovery = await importStoreRecoveryBundle(body);
    return json(res, 200, recovery);
  }

  return null;
}

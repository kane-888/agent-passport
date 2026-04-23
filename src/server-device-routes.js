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
  listModelMemoryHomeostasisProfiles,
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
  profileModelMemoryHomeostasis,
  activateDeviceLocalReasonerProfile,
} from "./ledger.js";
import { json, toBooleanParam } from "./server-base-helpers.js";
import { jsonForReadSession } from "./server-read-access.js";
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
  redactModelProfileForReadSession,
  redactRecoveryRehearsalForReadSession,
} from "./server-agent-redaction.js";
import {
  DEVICE_ROUTE_ATTRIBUTION_FIELDS,
  stripUntrustedRouteFields,
} from "./server-untrusted-route-input.js";

function stripUntrustedSecurityPostureState(posture = null) {
  if (!posture || typeof posture !== "object" || Array.isArray(posture)) {
    return posture;
  }

  const {
    updatedAt,
    updatedByAgentId,
    updatedByWindowId,
    sourceWindowId,
    ...rest
  } = posture;

  return rest;
}

function stripUntrustedLocalReasonerState(localReasoner = null) {
  if (!localReasoner || typeof localReasoner !== "object" || Array.isArray(localReasoner)) {
    return localReasoner;
  }

  const {
    selection,
    lastProbe,
    lastWarm,
    ...rest
  } = localReasoner;

  return rest;
}

function stripUntrustedLocalReasonerProfileState(profile = null) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return profile;
  }

  const {
    createdByAgentId,
    createdByWindowId,
    sourceWindowId,
    useCount,
    lastActivatedAt,
    lastProbe,
    lastWarm,
    lastHealthyAt,
    ...rest
  } = profile;

  return rest;
}

function stripUntrustedSetupPackageState(setupPackage = null) {
  if (!setupPackage || typeof setupPackage !== "object" || Array.isArray(setupPackage)) {
    return setupPackage;
  }

  const trusted = { ...setupPackage };
  if (
    trusted.runtimeConfig &&
    typeof trusted.runtimeConfig === "object" &&
    !Array.isArray(trusted.runtimeConfig)
  ) {
    const runtimeConfig = { ...trusted.runtimeConfig };
    if (
      runtimeConfig.localReasoner &&
      typeof runtimeConfig.localReasoner === "object" &&
      !Array.isArray(runtimeConfig.localReasoner)
    ) {
      runtimeConfig.localReasoner = stripUntrustedLocalReasonerState(runtimeConfig.localReasoner);
    }
    if (
      runtimeConfig.securityPosture &&
      typeof runtimeConfig.securityPosture === "object" &&
      !Array.isArray(runtimeConfig.securityPosture)
    ) {
      runtimeConfig.securityPosture = stripUntrustedSecurityPostureState(runtimeConfig.securityPosture);
    }
    trusted.runtimeConfig = runtimeConfig;
  }
  if (Array.isArray(trusted.localReasonerProfiles)) {
    trusted.localReasonerProfiles = trusted.localReasonerProfiles.map((profile) =>
      stripUntrustedLocalReasonerProfileState(profile)
    );
  }
  return trusted;
}

function stripUntrustedDeviceRouteAttribution(payload = {}) {
  const rest = stripUntrustedRouteFields(payload, DEVICE_ROUTE_ATTRIBUTION_FIELDS);
  const trusted = { ...rest };
  if (
    trusted.securityPosture &&
    typeof trusted.securityPosture === "object" &&
    !Array.isArray(trusted.securityPosture)
  ) {
    trusted.securityPosture = stripUntrustedSecurityPostureState(trusted.securityPosture);
  }
  if (
    trusted.localReasoner &&
    typeof trusted.localReasoner === "object" &&
    !Array.isArray(trusted.localReasoner)
  ) {
    trusted.localReasoner = stripUntrustedLocalReasonerState(trusted.localReasoner);
  }
  if (
    trusted.package &&
    typeof trusted.package === "object" &&
    !Array.isArray(trusted.package)
  ) {
    trusted.package = stripUntrustedSetupPackageState(trusted.package);
  }
  return trusted;
}

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
      return jsonForReadSession(res, access, 200, runtimeState, (payload) =>
        redactDeviceRuntimeStateForReadSession(payload, access)
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const deviceRuntime = await configureDeviceRuntime(stripUntrustedDeviceRouteAttribution(body));
      return json(res, 200, deviceRuntime);
    }
  }

  if (pathname === "/api/device/runtime/model-profiles") {
    if (req.method === "GET") {
      const profiles = await listModelMemoryHomeostasisProfiles({
        modelName: url.searchParams.get("model") || undefined,
        limit: url.searchParams.get("limit") || undefined,
      });
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, profiles, (payload) => ({
        ...payload,
        profiles: Array.isArray(payload.profiles)
          ? payload.profiles.map((profile) => redactModelProfileForReadSession(profile, access))
          : [],
      }));
    }
  }

  if (pathname === "/api/device/runtime/model-profiles/profile") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const profile = await profileModelMemoryHomeostasis(stripUntrustedDeviceRouteAttribution(body));
      return json(res, 200, profile);
    }
  }

  if (pathname === "/api/device/setup") {
    if (req.method === "GET") {
      const setup = await getDeviceSetupStatus({ passive: true });
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, setup, (payload) =>
        redactDeviceSetupStatusForReadSession(payload, access)
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const setup = await runDeviceSetup(stripUntrustedDeviceRouteAttribution(body));
      return json(res, 200, setup);
    }
  }

  if (pathname === "/api/device/setup/packages") {
    if (req.method === "GET") {
      const packages = await listDeviceSetupPackages({
        limit: url.searchParams.get("limit") || undefined,
      });
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, packages, (payload) =>
        redactSetupPackageListingForReadSession(payload, access)
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const pruned = await pruneDeviceSetupPackages(stripUntrustedDeviceRouteAttribution(body));
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
    return jsonForReadSession(res, access, 200, setupPackage, (payload) =>
      redactSetupPackageDetailForReadSession(payload, access)
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
    const deleted = await deleteDeviceSetupPackage(
      segments[4],
      stripUntrustedDeviceRouteAttribution(body)
    );
    return json(res, 200, deleted);
  }

  if (pathname === "/api/device/setup/package") {
    if (req.method === "GET") {
      const localReasonerProfileIds = [
        ...url.searchParams.getAll("localReasonerProfileId"),
        ...(url.searchParams.get("localReasonerProfileIds") || "").split(","),
      ].filter(Boolean);
      const setupPackage = await exportDeviceSetupPackage({
        dryRun: true,
        saveToFile: false,
        returnPackage: true,
        ...(url.searchParams.has("includeLocalReasonerProfiles")
          ? { includeLocalReasonerProfiles: toBooleanParam(url.searchParams.get("includeLocalReasonerProfiles")) }
          : {}),
        ...(url.searchParams.has("localReasonerProfileLimit")
          ? { localReasonerProfileLimit: url.searchParams.get("localReasonerProfileLimit") }
          : {}),
        ...(localReasonerProfileIds.length > 0 ? { localReasonerProfileIds } : {}),
      });
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, setupPackage, (payload) =>
        redactSetupPackageDetailForReadSession(payload, access)
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const setupPackage = await exportDeviceSetupPackage(stripUntrustedDeviceRouteAttribution(body));
      return json(res, 200, setupPackage);
    }
  }

  if (req.method === "POST" && pathname === "/api/device/setup/package/import") {
    const body = await parseBody(req);
    const setupImport = await importDeviceSetupPackage(stripUntrustedDeviceRouteAttribution(body));
    return json(res, 200, setupImport);
  }

  if (pathname === "/api/device/runtime/local-reasoner") {
    if (req.method === "GET") {
      const diagnostics = await inspectDeviceLocalReasoner({ passive: true });
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, diagnostics, (payload) => ({
        ...payload,
        deviceRuntime: redactLocalReasonerRuntimeViewForReadSession(payload.deviceRuntime, access),
        diagnostics: redactLocalReasonerDiagnosticForReadSession(payload.diagnostics, access),
        rawDiagnostics: null,
      }));
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/select") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const selected = await selectDeviceLocalReasoner(stripUntrustedDeviceRouteAttribution(body));
      return json(res, 200, selected);
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/migrate-default") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const migrated = await migrateDeviceLocalReasonerToDefault(
        stripUntrustedDeviceRouteAttribution(body)
      );
      return json(res, 200, migrated);
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/catalog") {
    if (req.method === "GET") {
      const catalog = await getDeviceLocalReasonerCatalog({ passive: true });
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, catalog, (payload) =>
        redactLocalReasonerCatalogForReadSession(payload, access)
      );
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/restore-candidates") {
    if (req.method === "GET") {
      const profileIds = [
        ...url.searchParams.getAll("profileId"),
        ...(url.searchParams.get("profileIds") || "").split(","),
      ].filter(Boolean);
      const candidates = await listDeviceLocalReasonerRestoreCandidates({
        limit: url.searchParams.get("limit") || undefined,
        ...(profileIds.length > 0 ? { profileIds } : {}),
      });
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, candidates, (payload) =>
        redactLocalReasonerProfileListingForReadSession(payload, access)
      );
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/profiles") {
    if (req.method === "GET") {
      const profileIds = [
        ...url.searchParams.getAll("profileId"),
        ...(url.searchParams.get("profileIds") || "").split(","),
      ].filter(Boolean);
      const profiles = await listDeviceLocalReasonerProfiles({
        limit: url.searchParams.get("limit") || undefined,
        ...(profileIds.length > 0 ? { profileIds } : {}),
      });
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, profiles, (payload) =>
        redactLocalReasonerProfileListingForReadSession(payload, access)
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const profile = await saveDeviceLocalReasonerProfile(stripUntrustedDeviceRouteAttribution(body));
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
    return jsonForReadSession(res, access, 200, profile, (payload) =>
      redactLocalReasonerProfileDetailForReadSession(payload, access)
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
    const activated = await activateDeviceLocalReasonerProfile(
      segments[5],
      stripUntrustedDeviceRouteAttribution(body)
    );
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
    const deleted = await deleteDeviceLocalReasonerProfile(
      segments[5],
      stripUntrustedDeviceRouteAttribution(body)
    );
    return json(res, 200, deleted);
  }

  if (pathname === "/api/device/runtime/local-reasoner/probe") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const probe = await probeDeviceLocalReasoner(stripUntrustedDeviceRouteAttribution(body));
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, probe, (payload) => ({
        ...payload,
        diagnostics: redactLocalReasonerDiagnosticForReadSession(payload.diagnostics, access),
        rawDiagnostics: null,
      }));
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/prewarm") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const prewarmed = await prewarmDeviceLocalReasoner(stripUntrustedDeviceRouteAttribution(body));
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, prewarmed, (payload) => ({
        ...payload,
        deviceRuntime: redactLocalReasonerRuntimeViewForReadSession(payload.deviceRuntime, access),
        diagnostics: redactLocalReasonerDiagnosticForReadSession(payload.diagnostics, access),
        rawDiagnostics: null,
        warmState: payload.warmState
          ? {
              ...payload.warmState,
              responsePreview: null,
            }
          : null,
        candidate: null,
      }));
    }
  }

  if (pathname === "/api/device/runtime/local-reasoner/restore") {
    if (req.method === "POST") {
      const body = await parseBody(req);
      const restored = await restoreDeviceLocalReasoner(stripUntrustedDeviceRouteAttribution(body));
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, restored, (payload) => ({
        ...payload,
        activation: payload.activation
          ? {
              ...payload.activation,
              runtime: redactLocalReasonerRuntimeViewForReadSession(payload.activation.runtime, access),
            }
          : null,
        prewarmResult: payload.prewarmResult
          ? {
              ...payload.prewarmResult,
              deviceRuntime: redactLocalReasonerRuntimeViewForReadSession(
                payload.prewarmResult.deviceRuntime,
                access
              ),
              diagnostics: redactLocalReasonerDiagnosticForReadSession(
                payload.prewarmResult.diagnostics,
                access
              ),
              rawDiagnostics: null,
              warmState: payload.prewarmResult.warmState
                ? {
                    ...payload.prewarmResult.warmState,
                    responsePreview: null,
                  }
                : null,
              candidate: null,
            }
          : null,
        deviceRuntime: redactLocalReasonerRuntimeViewForReadSession(payload.deviceRuntime, access),
      }));
    }
  }

  if (pathname === "/api/device/runtime/recovery") {
    if (req.method === "GET") {
      const recovery = await listStoreRecoveryBundles({
        limit: url.searchParams.get("limit") || undefined,
      });
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, recovery, (payload) =>
        redactRecoveryListingForReadSession(payload, access)
      );
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const recovery = await exportStoreRecoveryBundle(stripUntrustedDeviceRouteAttribution(body));
      return json(res, 200, recovery);
    }
  }

  if (pathname === "/api/device/runtime/recovery/rehearsals") {
    if (req.method === "GET") {
      const rehearsals = await listRecoveryRehearsals({
        limit: url.searchParams.get("limit") || undefined,
      });
      const access = req.agentPassportAccess || null;
      return jsonForReadSession(res, access, 200, rehearsals, (payload) => ({
        ...payload,
        rehearsals: Array.isArray(payload.rehearsals)
          ? payload.rehearsals.map((entry) => redactRecoveryRehearsalForReadSession(entry, access))
          : [],
      }));
    }
  }

  if (req.method === "POST" && pathname === "/api/device/runtime/recovery/verify") {
    const body = await parseBody(req);
    const rehearsal = await rehearseStoreRecoveryBundle(stripUntrustedDeviceRouteAttribution(body));
    return json(res, 200, rehearsal);
  }

  if (req.method === "POST" && pathname === "/api/device/runtime/recovery/import") {
    const body = await parseBody(req);
    const recovery = await importStoreRecoveryBundle(stripUntrustedDeviceRouteAttribution(body));
    return json(res, 200, recovery);
  }

  return null;
}

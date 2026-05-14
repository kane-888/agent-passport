import {
  normalizeBooleanFlag,
} from "./ledger-core-utils.js";
import {
  normalizeDeviceRuntime,
  normalizeRuntimeLocalReasonerConfig,
} from "./ledger-device-runtime.js";
import {
  buildDefaultDeviceLocalReasonerMigrationResult,
  buildDefaultDeviceLocalReasonerTargetConfig,
  localReasonerNeedsDefaultMigration,
} from "./ledger-local-reasoner-defaults.js";

function requireInjectedFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

export async function runDefaultDeviceLocalReasonerMigration(
  payload = {},
  {
    store,
    selectDeviceLocalReasoner,
    prewarmDeviceLocalReasoner,
    migrateDeviceLocalReasonerProfilesToDefault,
  } = {}
) {
  const selectLocalReasoner = requireInjectedFunction(selectDeviceLocalReasoner, "selectDeviceLocalReasoner");
  const prewarmLocalReasoner = requireInjectedFunction(prewarmDeviceLocalReasoner, "prewarmDeviceLocalReasoner");
  const migrateProfiles = requireInjectedFunction(
    migrateDeviceLocalReasonerProfilesToDefault,
    "migrateDeviceLocalReasonerProfilesToDefault"
  );
  const runtime = normalizeDeviceRuntime(payload.deviceRuntime || store.deviceRuntime);
  const currentConfig = normalizeRuntimeLocalReasonerConfig(runtime.localReasoner);
  const dryRun = normalizeBooleanFlag(payload.dryRun, false);
  const prewarm = normalizeBooleanFlag(payload.prewarm, true);
  const includeProfiles = normalizeBooleanFlag(payload.includeProfiles || payload.migrateProfiles, false);
  const targetConfig = buildDefaultDeviceLocalReasonerTargetConfig(currentConfig, payload);
  const selectionNeedsMigration = localReasonerNeedsDefaultMigration(currentConfig, targetConfig);

  const migration = await selectLocalReasoner({
    ...payload,
    localReasoner: targetConfig,
    dryRun,
  });

  let prewarmResult = null;
  if (!dryRun && prewarm) {
    prewarmResult = await prewarmLocalReasoner({
      ...payload,
      localReasoner: targetConfig,
      dryRun: false,
    });
  }

  const profileMigration = includeProfiles
    ? await migrateProfiles({
        ...payload,
        dryRun,
      })
    : {
        skipped: true,
        reason: "profiles_not_requested",
      };

  return buildDefaultDeviceLocalReasonerMigrationResult({
    currentConfig,
    targetConfig,
    migration,
    prewarmResult,
    profileMigration,
    dryRun,
    prewarm,
    includeProfiles,
    selectionNeedsMigration,
  });
}

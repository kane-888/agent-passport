import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert } from "./smoke-shared.mjs";
import { assertPublicCopyPolicyForRoot } from "./public-copy-policy.mjs";
import {
  summarizeHousekeepingExpectation,
  summarizeLocalReasonerRestoreExpectation,
  summarizeSetupPackageExpectation,
} from "./smoke-expectations.mjs";
import {
  cleanupSmokeSecretIsolation,
  createSmokeLogger,
  localReasonerFixturePath,
  resolveLiveRuntimePaths,
  rootDir,
  seedSmokeSecretIsolation,
  smokeTraceEnabled,
} from "./smoke-env.mjs";

async function copyPathIfExists(sourcePath, targetPath) {
  try {
    await fs.copyFile(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openneed-memory-smoke-dom-operational-"));
const dataDir = path.join(smokeRoot, "data");
const recoveryDir = path.join(dataDir, "recovery-bundles");
const setupPackageDir = path.join(dataDir, "device-setup-packages");
const smokeIsolationAccount = path.basename(smokeRoot);
const smokeDomOperationalScriptPath = fileURLToPath(import.meta.url);
const smokeDomOperationalDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === smokeDomOperationalScriptPath
  : false;
const liveRuntime = resolveLiveRuntimePaths();
const traceSmoke = createSmokeLogger(
  "smoke-dom:operational",
  smokeDomOperationalDirectExecution || smokeTraceEnabled
);

process.env.OPENNEED_LEDGER_PATH = path.join(dataDir, "ledger.json");
process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = path.join(dataDir, "read-sessions.json");
process.env.AGENT_PASSPORT_STORE_KEY_PATH = path.join(dataDir, ".ledger-key");
process.env.AGENT_PASSPORT_RECOVERY_DIR = recoveryDir;
process.env.AGENT_PASSPORT_SETUP_PACKAGE_DIR = setupPackageDir;
process.env.AGENT_PASSPORT_SIGNING_SECRET_PATH = path.join(dataDir, ".did-signing-master-secret");
process.env.AGENT_PASSPORT_KEYCHAIN_ACCOUNT = smokeIsolationAccount;

await fs.mkdir(dataDir, { recursive: true });
await copyPathIfExists(liveRuntime.ledgerPath, process.env.OPENNEED_LEDGER_PATH);
await copyPathIfExists(liveRuntime.storeKeyPath, process.env.AGENT_PASSPORT_STORE_KEY_PATH);
await seedSmokeSecretIsolation({
  dataDir,
  keychainAccount: smokeIsolationAccount,
  liveRuntime,
});

const {
  configureDeviceRuntime,
  createReadSession,
  exportDeviceSetupPackage,
  exportStoreRecoveryBundle,
  getDeviceLocalReasonerProfile,
  getDeviceRuntimeState,
  getDeviceSetupPackage,
  listDeviceLocalReasonerProfiles,
  listDeviceLocalReasonerRestoreCandidates,
  listDeviceSetupPackages,
  listStoreRecoveryBundles,
  pruneDeviceSetupPackages,
  restoreDeviceLocalReasoner,
  saveDeviceLocalReasonerProfile,
  validateReadSessionToken,
} = await import("../src/ledger.js");
const { runRuntimeHousekeeping } = await import("../src/runtime-housekeeping.js");

async function main() {
  await assertPublicCopyPolicyForRoot(rootDir);

  const deviceRuntime = await getDeviceRuntimeState();
  const boundResidentAgentId = deviceRuntime.deviceRuntime?.residentAgentId || "agent_openneed_agents";

  const configuredRuntime = await configureDeviceRuntime({
    residentAgentId: boundResidentAgentId,
    residentDidMethod: "agentpassport",
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_command",
    localReasonerCommand: process.execPath,
    localReasonerArgs: [localReasonerFixturePath],
    localReasonerCwd: rootDir,
    filesystemAllowlist: [dataDir, "/tmp"],
  });
  assert(configuredRuntime.deviceRuntime?.localReasoner?.provider === "local_command", "runtime 应切到 local_command");
  assert(configuredRuntime.deviceRuntime?.localReasoner?.configured === true, "runtime local reasoner 应配置完成");
  traceSmoke("device runtime configured for lightweight operational smoke");

  const localReasonerProfileSave = await saveDeviceLocalReasonerProfile({
    label: "smoke-dom-operational-local-command",
    note: `smoke-dom-operational-profile-${Date.now()}`,
    source: "current",
    dryRun: false,
    updatedByAgentId: "agent_openneed_agents",
    updatedByWindowId: "window_demo_1",
    sourceWindowId: "window_demo_1",
  });
  const localReasonerProfileId =
    localReasonerProfileSave.summary?.profileId || localReasonerProfileSave.profile?.profileId || null;
  assert(localReasonerProfileId, "local reasoner profile save 应返回 profileId");

  const localReasonerProfileDetail = await getDeviceLocalReasonerProfile(localReasonerProfileId);
  assert(localReasonerProfileDetail.summary?.profileId === localReasonerProfileId, "local reasoner profile detail profileId 不匹配");
  assert(
    localReasonerProfileDetail.profile?.config?.provider === "local_command",
    "local reasoner profile detail 应保留 local_command provider"
  );

  const localReasonerProfiles = await listDeviceLocalReasonerProfiles({
    limit: 1,
    profileId: localReasonerProfileId,
  });
  assert(
    localReasonerProfiles.profiles.some((entry) => entry.profileId === localReasonerProfileId),
    "local reasoner profiles 列表应包含新 profile"
  );

  const localReasonerRestoreCandidates = await listDeviceLocalReasonerRestoreCandidates({
    limit: 1,
    profileId: localReasonerProfileId,
  });
  assert(
    Array.isArray(localReasonerRestoreCandidates.restoreCandidates),
    "local reasoner restore candidates 缺少 restoreCandidates 数组"
  );
  assert(
    localReasonerRestoreCandidates.restoreCandidates.some((entry) => entry.profileId === localReasonerProfileId),
    "restore candidates 应包含新 profile"
  );

  const localReasonerRestore = await restoreDeviceLocalReasoner({
    profileId: localReasonerProfileId,
    prewarm: true,
    prewarmMode: "reuse",
    dryRun: false,
    updatedByAgentId: "agent_openneed_agents",
    updatedByWindowId: "window_demo_1",
    sourceWindowId: "window_demo_1",
  });
  assert(localReasonerRestore.restoredProfileId === localReasonerProfileId, "local reasoner restore 应返回正确 profileId");
  assert(localReasonerRestore.prewarmResult?.warmState?.status === "ready", "local reasoner restore 后应完成 prewarm");
  traceSmoke("local reasoner restore checks");

  const packageNotePrefix = `smoke-dom-operational-package-${Date.now()}`;
  const savedSetupPackage = await exportDeviceSetupPackage({
    note: `${packageNotePrefix}-old`,
    saveToFile: true,
    dryRun: false,
    returnPackage: false,
    includeLocalReasonerProfiles: true,
    localReasonerProfileIds: [localReasonerProfileId],
    localReasonerProfileLimit: 1,
  });
  const savedSetupPackageId = savedSetupPackage.summary?.packageId || null;
  assert(savedSetupPackageId, "saved setup package export 应返回 packageId");

  const [savedSetupPackageList, savedSetupPackageDetail] = await Promise.all([
    listDeviceSetupPackages({ limit: 20 }),
    getDeviceSetupPackage(savedSetupPackageId),
  ]);
  assert(
    savedSetupPackageList.packages.some((entry) => entry.packageId === savedSetupPackageId),
    "saved setup package list 应包含新 package"
  );

  assert(savedSetupPackageDetail.summary?.packageId === savedSetupPackageId, "saved setup package detail packageId 不匹配");
  assert(
    Number(savedSetupPackageDetail.summary?.localReasonerProfileCount || 0) >= 1,
    "saved setup package 应携带 local reasoner profile 摘要"
  );

  const secondSavedSetupPackage = await exportDeviceSetupPackage({
    note: `${packageNotePrefix}-new`,
    saveToFile: true,
    dryRun: false,
    returnPackage: false,
    includeLocalReasonerProfiles: true,
    localReasonerProfileIds: [localReasonerProfileId],
    localReasonerProfileLimit: 1,
  });
  assert(secondSavedSetupPackage.summary?.packageId, "second saved setup package export 应返回 packageId");

  const setupPackagePrune = await pruneDeviceSetupPackages({
    keepLatest: 1,
    residentAgentId: boundResidentAgentId,
    noteIncludes: packageNotePrefix,
    dryRun: false,
  });
  assert(setupPackagePrune.counts?.matched === 2, "setup package prune 应精确命中 2 个 smoke packages");
  assert(setupPackagePrune.counts?.deleted >= 1, "setup package prune 应删除至少 1 个 package");
  assert(setupPackagePrune.counts?.kept === 1, "setup package prune 应只保留 1 个 package");
  traceSmoke("setup package persistence checks");

  const housekeepingProbeSession = await createReadSession({
    label: "smoke-dom-operational-housekeeping-probe",
    role: "runtime_observer",
    ttlSeconds: 600,
  });
  const savedRecoveryBundle = await exportStoreRecoveryBundle({
    passphrase: "smoke-dom-operational-passphrase",
    note: "smoke-dom-operational-housekeeping-bundle",
    includeLedgerEnvelope: true,
    saveToFile: true,
    returnBundle: false,
    dryRun: false,
  });
  assert(savedRecoveryBundle.summary?.bundleId, "housekeeping recovery bundle 应返回 bundleId");

  const savedHousekeepingPackage = await exportDeviceSetupPackage({
    note: "smoke-dom-operational-housekeeping-package",
    saveToFile: true,
    dryRun: false,
    returnPackage: false,
  });
  assert(savedHousekeepingPackage.summary?.packageId, "housekeeping setup package 应返回 packageId");

  const housekeepingApply = await runRuntimeHousekeeping({
    apply: true,
    keepRecovery: 0,
    keepSetup: 0,
  });
  assert(housekeepingApply.ok === true, "housekeeping apply 应返回 ok=true");
  assert(housekeepingApply.mode === "apply", "housekeeping apply 模式应为 apply");
  assert(housekeepingApply.liveLedger?.touched === false, "housekeeping apply 不应修改 live ledger");
  assert(Number(housekeepingApply.readSessions?.revokedCount || 0) >= 1, "housekeeping apply 应撤销至少 1 个 read session");
  assert(housekeepingApply.readSessions?.activeAfter === 0, "housekeeping apply 后 active read sessions 应归零");
  assert(
    Number(housekeepingApply.recoveryBundles?.deletedCount || 0) >= 1,
    "housekeeping apply 应删除至少 1 个 recovery bundle"
  );
  assert(
    Number(housekeepingApply.setupPackages?.counts?.deleted || 0) >= 1,
    "housekeeping apply 应删除至少 1 个 setup package"
  );

  const [housekeepingProbeValidation, recoveryBundlesAfterHousekeeping, setupPackagesAfterHousekeeping] = await Promise.all([
    validateReadSessionToken(housekeepingProbeSession.token, {
      scope: "device_runtime",
    }),
    listStoreRecoveryBundles({ limit: 10 }),
    listDeviceSetupPackages({ limit: 20 }),
  ]);
  assert(housekeepingProbeValidation.valid === false, "housekeeping apply 后 probe read session 应失效");

  assert(
    !recoveryBundlesAfterHousekeeping.bundles.some((entry) => entry.bundleId === savedRecoveryBundle.summary?.bundleId),
    "housekeeping apply 后不应保留 probe recovery bundle"
  );
  assert(
    !setupPackagesAfterHousekeeping.packages.some((entry) => entry.packageId === savedHousekeepingPackage.summary?.packageId),
    "housekeeping apply 后不应保留 probe setup package"
  );
  traceSmoke("housekeeping apply checks");

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "operational",
        smokeDomStage: "operational",
        localReasonerProfileId,
        localReasonerProfileCount: localReasonerProfiles.counts?.total || localReasonerProfiles.profiles.length || 0,
        localReasonerRestoreCandidateCount:
          localReasonerRestoreCandidates.counts?.total || localReasonerRestoreCandidates.restoreCandidates.length || 0,
        localReasonerRestoreProfileId: localReasonerRestore.restoredProfileId || null,
        localReasonerRestoreWarmStatus: localReasonerRestore.prewarmResult?.warmState?.status || null,
        localReasonerRestoreReusedWarmState: localReasonerRestore.prewarmResult?.reusedWarmState === true,
        localReasonerRestoreWarmProofSource: localReasonerRestore.prewarmResult?.warmProofSource || null,
        ...summarizeLocalReasonerRestoreExpectation({
          candidateCount:
            localReasonerRestoreCandidates.counts?.total || localReasonerRestoreCandidates.restoreCandidates.length || 0,
          restoredProfileId: localReasonerRestore.restoredProfileId || null,
          warmStatus: localReasonerRestore.prewarmResult?.warmState?.status || null,
        }),
        savedSetupPackageId,
        setupPackageCount: savedSetupPackageList.counts?.total || savedSetupPackageList.packages.length || 0,
        setupPackageProfileCount: savedSetupPackageDetail.summary?.localReasonerProfileCount || 0,
        setupPackagePruneDeleted: setupPackagePrune.counts?.deleted || 0,
        ...summarizeSetupPackageExpectation({
          previewPackageId: savedSetupPackage.summary?.packageId || null,
          persistedPackageId: savedSetupPackageId,
          observedPersistedPackageCount: savedSetupPackageList.counts?.total || savedSetupPackageList.packages.length || 0,
          embeddedProfileCount: savedSetupPackageDetail.summary?.localReasonerProfileCount || 0,
          prunedDeletedCount: setupPackagePrune.counts?.deleted || 0,
        }),
        housekeepingApplyMode: housekeepingApply.mode || null,
        ...summarizeHousekeepingExpectation(housekeepingApply),
        housekeepingRevokedReadSessions: housekeepingApply.readSessions?.revokedCount || 0,
        housekeepingDeletedRecoveryBundles: housekeepingApply.recoveryBundles?.deletedCount || 0,
        housekeepingDeletedSetupPackages: housekeepingApply.setupPackages?.counts?.deleted || 0,
      },
      null,
      2
    )
  );
}

async function cleanupSmokeDomOperationalArtifacts() {
  await cleanupSmokeSecretIsolation({
    keychainAccount: smokeIsolationAccount,
    cleanupRoot: smokeRoot,
  });
}

async function flushSmokeDomOperationalStreams() {
  await Promise.all([
    new Promise((resolve) => process.stdout.write("", resolve)),
    new Promise((resolve) => process.stderr.write("", resolve)),
  ]);
}

try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  try {
    await cleanupSmokeDomOperationalArtifacts();
  } catch (cleanupError) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: cleanupError.message,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
  if (smokeDomOperationalDirectExecution) {
    await flushSmokeDomOperationalStreams();
    process.exit(process.exitCode ?? 0);
  }
}

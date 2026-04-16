import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ensureSmokeServer,
  prepareSmokeDataRoot,
  resolveSmokeBaseUrl,
} from "./smoke-server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const smokeAllDirectExecution = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;
const skipBrowser = process.env.SMOKE_ALL_SKIP_BROWSER === "1";
const requireBrowser = process.env.SMOKE_ALL_REQUIRE_BROWSER === "1";
const runInParallel = process.env.SMOKE_ALL_PARALLEL === "1";

export function extractTrailingJson(output = "") {
  const trimmed = String(output || "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {}

  for (let index = trimmed.lastIndexOf("\n{"); index >= 0; index = trimmed.lastIndexOf("\n{", index - 1)) {
    const candidate = trimmed.slice(index + 1).trim();
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  return null;
}

export function summarizeOfflineFanoutGate(stepResults = [], { browserSkipped = false } = {}) {
  const stepMap = new Map((Array.isArray(stepResults) ? stepResults : []).map((step) => [step.name, step]));
  const domResult = stepMap.get("smoke:dom")?.result || null;
  const browserResult = stepMap.get("smoke:browser")?.result || null;
  const checks = [];

  const domExecutionMode = domResult?.offlineChatFanoutExecutionMode || null;
  const domParallelAllowed = domResult?.offlineChatFanoutParallelAllowed === true;
  const domParallelBatchCount = Number(domResult?.offlineChatFanoutParallelBatchCount || 0);
  const domLatestParallelBatchCount = Number(domResult?.offlineChatDispatchLatestParallelBatchCount || 0);
  checks.push({
    check: "dom_fanout_execution",
    passed:
      domExecutionMode === "automatic_fanout" &&
      domParallelAllowed &&
      domParallelBatchCount >= 1 &&
      domLatestParallelBatchCount >= 1,
    details: {
      executionMode: domExecutionMode,
      parallelAllowed: domParallelAllowed,
      parallelBatchCount: domParallelBatchCount,
      latestParallelBatchCount: domLatestParallelBatchCount,
      latestRecordId: domResult?.offlineChatDispatchLatestRecordId || null,
    },
  });

  if (browserSkipped) {
    checks.push({
      check: "browser_dispatch_visibility",
      passed: null,
      details: {
        skipped: true,
      },
    });
    checks.push({
      check: "browser_protocol_visibility",
      passed: null,
      details: {
        skipped: true,
      },
    });
  } else {
    const groupSummary = browserResult?.offlineChatGroupSummary || null;
    const groupFixture = browserResult?.offlineChatGroupFixture || null;
    const browserPassed =
      groupSummary?.dispatchHistoryHidden === false &&
      String(groupSummary?.firstParallelChip || "").includes("并行批次") &&
      String(groupSummary?.firstDispatchBody || "").includes("并行批次") &&
      groupSummary?.directState?.dispatchHistoryHidden === true &&
      groupSummary?.refreshedState?.dispatchHistoryHidden === false;
    checks.push({
      check: "browser_dispatch_visibility",
      passed: browserPassed,
      details: {
        dispatchHistoryHidden: groupSummary?.dispatchHistoryHidden ?? null,
        firstParallelChip: groupSummary?.firstParallelChip || null,
        directDispatchHistoryHidden: groupSummary?.directState?.dispatchHistoryHidden ?? null,
        refreshedDispatchHistoryHidden: groupSummary?.refreshedState?.dispatchHistoryHidden ?? null,
      },
    });
    checks.push({
      check: "browser_protocol_visibility",
      passed:
        Boolean(groupFixture?.protocolTitle) &&
        Boolean(groupFixture?.protocolSummary) &&
        String(groupSummary?.threadContextSummary || "").includes(groupFixture?.protocolTitle || "") &&
        String(groupSummary?.threadContextSummary || "").includes(groupFixture?.protocolSummary || "") &&
        String(groupSummary?.policyCardGoal || "").includes(groupFixture?.protocolTitle || "") &&
        String(groupSummary?.policyCardGoal || "").includes(groupFixture?.protocolSummary || ""),
      details: {
        protocolTitle: groupFixture?.protocolTitle || null,
        protocolSummary: groupFixture?.protocolSummary || null,
        threadContextSummary: groupSummary?.threadContextSummary || null,
        policyCardGoal: groupSummary?.policyCardGoal || null,
      },
    });
  }

  const failedChecks = checks.filter((entry) => entry.passed === false);
  const passedChecks = checks.filter((entry) => entry.passed === true).length;
  const status =
    failedChecks.length > 0
      ? "failed"
      : checks.some((entry) => entry.passed === true)
        ? "passed"
        : "skipped";

  return {
    status,
    browserSkipped,
    passedChecks,
    totalChecks: checks.length,
    failedChecks: failedChecks.map((entry) => entry.check),
    checks,
  };
}

export function formatOfflineFanoutGateSummary(gate = null) {
  if (!gate || typeof gate !== "object") {
    return "offline fan-out gate: unavailable";
  }
  const checkMap = new Map((Array.isArray(gate.checks) ? gate.checks : []).map((entry) => [entry.check, entry]));
  const domCheck = checkMap.get("dom_fanout_execution") || null;
  const browserCheck = checkMap.get("browser_dispatch_visibility") || null;
  const protocolCheck = checkMap.get("browser_protocol_visibility") || null;
  const domDetails = domCheck?.details || {};
  const browserDetails = browserCheck?.details || {};
  const protocolDetails = protocolCheck?.details || {};
  const domSummary = domCheck
    ? `DOM=${domCheck.passed === true ? "pass" : domCheck.passed === false ? "fail" : "skip"} (${[
        domDetails.executionMode || "mode:unknown",
        `parallelAllowed=${domDetails.parallelAllowed === true ? "yes" : "no"}`,
        `parallelBatch=${Number(domDetails.parallelBatchCount || 0)}`,
        `latestParallelBatch=${Number(domDetails.latestParallelBatchCount || 0)}`,
      ].join(", ")})`
    : "DOM=unavailable";
  const browserSummary = browserCheck
    ? browserCheck.passed === null
      ? "Browser=skip"
      : `Browser=${browserCheck.passed === true ? "pass" : "fail"} (${[
          `groupVisible=${browserDetails.dispatchHistoryHidden === false ? "yes" : "no"}`,
          `parallelChip=${browserDetails.firstParallelChip ? "yes" : "no"}`,
          `directHidden=${browserDetails.directDispatchHistoryHidden === true ? "yes" : "no"}`,
          `refreshVisible=${browserDetails.refreshedDispatchHistoryHidden === false ? "yes" : "no"}`,
        ].join(", ")})`
    : "Browser=unavailable";
  const protocolSummary = protocolCheck
    ? protocolCheck.passed === null
      ? "Protocol=skip"
      : `Protocol=${protocolCheck.passed === true ? "pass" : "fail"} (${[
          `title=${protocolDetails.protocolTitle ? "yes" : "no"}`,
          `summary=${protocolDetails.protocolSummary ? "yes" : "no"}`,
          `context=${String(protocolDetails.threadContextSummary || "").length > 0 ? "yes" : "no"}`,
          `policyCard=${String(protocolDetails.policyCardGoal || "").length > 0 ? "yes" : "no"}`,
        ].join(", ")})`
    : "Protocol=unavailable";
  const failed = Array.isArray(gate.failedChecks) && gate.failedChecks.length
    ? ` failed=${gate.failedChecks.join(",")}`
    : "";
  return `offline fan-out gate: ${gate.status}${failed}; ${domSummary}; ${browserSummary}; ${protocolSummary}`;
}

export function summarizeProtectiveStateSemantics(stepResults = [], { browserSkipped = false } = {}) {
  const stepMap = new Map((Array.isArray(stepResults) ? stepResults : []).map((step) => [step.name, step]));
  const uiResult = stepMap.get("smoke:ui")?.result || null;
  const domResult = stepMap.get("smoke:dom")?.result || null;
  const checks = [];

  checks.push({
    check: "browser_skip_semantics",
    passed: true,
    details: {
      expectedSkip: browserSkipped,
      skipped: browserSkipped,
      meaning: browserSkipped
        ? "smoke-all CI intentionally skips browser gate"
        : "browser gate executes in this smoke-all mode",
    },
  });

  if (uiResult) {
    checks.push({
      check: "ui_runner_guard_semantics",
      passed:
        uiResult.runnerStatusExpected === true &&
        typeof uiResult.runnerStatusMeaning === "string" &&
        uiResult.runnerStatusMeaning.length > 0 &&
        uiResult.runnerGateState?.status === (uiResult.runnerStatus ?? null),
      details: {
        runnerStatus: uiResult.runnerStatus ?? null,
        expected: uiResult.runnerStatusExpected === true,
        meaning: uiResult.runnerStatusMeaning ?? null,
        gateStatus: uiResult.runnerGateState?.status ?? null,
      },
    });
  }

  if (uiResult) {
    checks.push({
      check: "ui_bootstrap_semantics",
      passed:
        typeof uiResult.bootstrapApplyExpected === "boolean" &&
        typeof uiResult.bootstrapMeaning === "string" &&
        uiResult.bootstrapMeaning.length > 0 &&
        uiResult.bootstrapGateState?.runMode &&
        uiResult.bootstrapGateState?.dryRun === (uiResult.bootstrapDryRun === true) &&
        uiResult.bootstrapGateState?.profileWrites === Number(uiResult.bootstrapProfileWrites || 0) &&
        uiResult.bootstrapApplyExpected === (uiResult.bootstrapDryRun === true ? false : true),
      details: {
        bootstrapDryRun: uiResult.bootstrapDryRun ?? null,
        expected: uiResult.bootstrapApplyExpected ?? null,
        meaning: uiResult.bootstrapMeaning ?? null,
        runMode: uiResult.bootstrapGateState?.runMode ?? null,
      },
    });
  }

  if (uiResult && uiResult.keychainMigrationGateState) {
    checks.push({
      check: "ui_keychain_migration_semantics",
      passed:
        typeof uiResult.keychainMigrationApplyExpected === "boolean" &&
        typeof uiResult.keychainMigrationMeaning === "string" &&
        uiResult.keychainMigrationMeaning.length > 0 &&
        [
          "not_applicable_skip",
          "dry_run_preview",
          "combined_preview_deferred",
          "finalize",
        ].includes(uiResult.keychainMigrationGateState?.runMode) &&
        typeof uiResult.keychainMigrationGateState?.skipped === "boolean" &&
        typeof uiResult.keychainMigrationGateState?.dryRun === "boolean",
      details: {
        expected: uiResult.keychainMigrationApplyExpected ?? null,
        meaning: uiResult.keychainMigrationMeaning ?? null,
        runMode: uiResult.keychainMigrationGateState?.runMode ?? null,
        skipped: uiResult.keychainMigrationGateState?.skipped ?? null,
        dryRun: uiResult.keychainMigrationGateState?.dryRun ?? null,
      },
    });
  }

  if (uiResult && uiResult.housekeepingGateState) {
    checks.push({
      check: "ui_housekeeping_semantics",
      passed:
        typeof uiResult.housekeepingApplyExpected === "boolean" &&
        typeof uiResult.housekeepingMeaning === "string" &&
        uiResult.housekeepingMeaning.length > 0 &&
        uiResult.housekeepingGateState?.runMode === "audit" &&
        uiResult.housekeepingApplyExpected === false &&
        uiResult.housekeepingGateState?.liveLedgerTouched === false,
      details: {
        expected: uiResult.housekeepingApplyExpected ?? null,
        meaning: uiResult.housekeepingMeaning ?? null,
        runMode: uiResult.housekeepingGateState?.runMode ?? null,
        liveLedgerTouched: uiResult.housekeepingGateState?.liveLedgerTouched ?? null,
      },
    });
  }

  if (domResult) {
    checks.push({
      check: "dom_device_setup_preview_semantics",
      passed:
        domResult.deviceSetupCompletionExpected === false &&
        typeof domResult.deviceSetupCompletionMeaning === "string" &&
        domResult.deviceSetupCompletionMeaning.length > 0 &&
        domResult.deviceSetupGateState?.runMode === "dry_run_preview" &&
        domResult.deviceSetupGateState?.statusComplete === (domResult.deviceSetupComplete ?? null) &&
        domResult.deviceSetupGateState?.runComplete === (domResult.deviceSetupRunComplete ?? null),
      details: {
        deviceSetupComplete: domResult.deviceSetupComplete ?? null,
        deviceSetupRunComplete: domResult.deviceSetupRunComplete ?? null,
        expected: domResult.deviceSetupCompletionExpected ?? null,
        meaning: domResult.deviceSetupCompletionMeaning ?? null,
        runMode: domResult.deviceSetupGateState?.runMode ?? null,
      },
    });
  }

  if (domResult && domResult.setupPackageGateState) {
    checks.push({
      check: "dom_setup_package_semantics",
      passed:
        typeof domResult.setupPackagePersistenceExpected === "boolean" &&
        typeof domResult.setupPackageMeaning === "string" &&
        domResult.setupPackageMeaning.length > 0 &&
        domResult.setupPackagePersistenceExpected === false &&
        domResult.setupPackageGateState?.runMode === "dry_run_preview",
      details: {
        expected: domResult.setupPackagePersistenceExpected ?? null,
        meaning: domResult.setupPackageMeaning ?? null,
        runMode: domResult.setupPackageGateState?.runMode ?? null,
      },
    });
  }

  if (domResult && domResult.recoveryBundleGateState) {
    checks.push({
      check: "dom_recovery_bundle_semantics",
      passed:
        typeof domResult.recoveryBundlePersistenceExpected === "boolean" &&
        typeof domResult.recoveryBundleMeaning === "string" &&
        domResult.recoveryBundleMeaning.length > 0 &&
        domResult.recoveryBundlePersistenceExpected === false &&
        domResult.recoveryBundleGateState?.runMode === "dry_run_preview",
      details: {
        expected: domResult.recoveryBundlePersistenceExpected ?? null,
        meaning: domResult.recoveryBundleMeaning ?? null,
        runMode: domResult.recoveryBundleGateState?.runMode ?? null,
      },
    });
  }

  if (domResult && domResult.recoveryRehearsalGateState) {
    checks.push({
      check: "dom_recovery_rehearsal_semantics",
      passed:
        typeof domResult.recoveryRehearsalPersistenceExpected === "boolean" &&
        typeof domResult.recoveryRehearsalMeaning === "string" &&
        domResult.recoveryRehearsalMeaning.length > 0 &&
        domResult.recoveryRehearsalPersistenceExpected === false &&
        domResult.recoveryRehearsalGateState?.runMode === "inline_preview",
      details: {
        expected: domResult.recoveryRehearsalPersistenceExpected ?? null,
        meaning: domResult.recoveryRehearsalMeaning ?? null,
        runMode: domResult.recoveryRehearsalGateState?.runMode ?? null,
      },
    });
  }

  const failedChecks = checks.filter((entry) => entry.passed === false);
  const passedChecks = checks.filter((entry) => entry.passed === true).length;
  const status =
    failedChecks.length > 0
      ? "failed"
      : checks.length > 0
        ? "passed"
        : "unavailable";

  return {
    status,
    browserSkipped,
    passedChecks,
    totalChecks: checks.length,
    failedChecks: failedChecks.map((entry) => entry.check),
    checks,
  };
}

export function formatProtectiveStateSemanticsSummary(gate = null) {
  if (!gate || typeof gate !== "object") {
    return "protective-state semantics: unavailable";
  }
  const checkMap = new Map((Array.isArray(gate.checks) ? gate.checks : []).map((entry) => [entry.check, entry]));
  const browserCheck = checkMap.get("browser_skip_semantics") || null;
  const runnerCheck = checkMap.get("ui_runner_guard_semantics") || null;
  const bootstrapCheck = checkMap.get("ui_bootstrap_semantics") || null;
  const keychainCheck = checkMap.get("ui_keychain_migration_semantics") || null;
  const housekeepingCheck = checkMap.get("ui_housekeeping_semantics") || null;
  const recoveryBundleCheck = checkMap.get("dom_recovery_bundle_semantics") || null;
  const recoveryRehearsalCheck = checkMap.get("dom_recovery_rehearsal_semantics") || null;
  const setupPackageCheck = checkMap.get("dom_setup_package_semantics") || null;
  const setupCheck = checkMap.get("dom_device_setup_preview_semantics") || null;
  const browserSummary = browserCheck
    ? `BrowserSkip=${browserCheck.details?.expectedSkip === true ? "expected" : "off"}`
    : "BrowserSkip=unavailable";
  const runnerSummary = runnerCheck
    ? `RunnerGuard=${runnerCheck.passed === true ? "pass" : "fail"} (${[
        runnerCheck.details?.runnerStatus || "status:unknown",
        runnerCheck.details?.expected === true ? "expected" : "unexpected",
      ].join(", ")})`
    : "RunnerGuard=unavailable";
  const bootstrapSummary = bootstrapCheck
    ? `Bootstrap=${bootstrapCheck.passed === true ? "pass" : "fail"} (${[
        `runMode=${bootstrapCheck.details?.runMode || "unknown"}`,
        bootstrapCheck.details?.expected === false ? "applyExpected=no" : "applyExpected=yes",
      ].join(", ")})`
    : "Bootstrap=unavailable";
  const keychainSummary = keychainCheck
    ? `KeychainMigration=${keychainCheck.passed === true ? "pass" : "fail"} (${[
        `runMode=${keychainCheck.details?.runMode || "unknown"}`,
        keychainCheck.details?.expected === false ? "applyExpected=no" : "applyExpected=yes",
      ].join(", ")})`
    : "KeychainMigration=unavailable";
  const housekeepingSummary = housekeepingCheck
    ? `Housekeeping=${housekeepingCheck.passed === true ? "pass" : "fail"} (${[
        `runMode=${housekeepingCheck.details?.runMode || "unknown"}`,
        housekeepingCheck.details?.expected === false ? "applyExpected=no" : "applyExpected=yes",
      ].join(", ")})`
    : "Housekeeping=unavailable";
  const recoveryBundleSummary = recoveryBundleCheck
    ? `RecoveryBundle=${recoveryBundleCheck.passed === true ? "pass" : "fail"} (${[
        `runMode=${recoveryBundleCheck.details?.runMode || "unknown"}`,
        recoveryBundleCheck.details?.expected === false ? "persistExpected=no" : "persistExpected=yes",
      ].join(", ")})`
    : "RecoveryBundle=unavailable";
  const recoveryRehearsalSummary = recoveryRehearsalCheck
    ? `RecoveryRehearsal=${recoveryRehearsalCheck.passed === true ? "pass" : "fail"} (${[
        `runMode=${recoveryRehearsalCheck.details?.runMode || "unknown"}`,
        recoveryRehearsalCheck.details?.expected === false ? "persistExpected=no" : "persistExpected=yes",
      ].join(", ")})`
    : "RecoveryRehearsal=unavailable";
  const setupPackageSummary = setupPackageCheck
    ? `SetupPackage=${setupPackageCheck.passed === true ? "pass" : "fail"} (${[
        `runMode=${setupPackageCheck.details?.runMode || "unknown"}`,
        setupPackageCheck.details?.expected === false ? "persistExpected=no" : "persistExpected=yes",
      ].join(", ")})`
    : "SetupPackage=unavailable";
  const setupSummary = setupCheck
    ? `DeviceSetupPreview=${setupCheck.passed === true ? "pass" : "fail"} (${[
        `runMode=${setupCheck.details?.runMode || "unknown"}`,
        setupCheck.details?.expected === false ? "completionExpected=no" : "completionExpected=yes",
      ].join(", ")})`
    : "DeviceSetupPreview=unavailable";
  const failed = Array.isArray(gate.failedChecks) && gate.failedChecks.length
    ? ` failed=${gate.failedChecks.join(",")}`
    : "";
  return `protective-state semantics: ${gate.status}${failed}; ${browserSummary}; ${runnerSummary}; ${bootstrapSummary}; ${keychainSummary}; ${housekeepingSummary}; ${recoveryBundleSummary}; ${recoveryRehearsalSummary}; ${setupPackageSummary}; ${setupSummary}`;
}

export function summarizeOperationalFlowSemantics(stepResults = []) {
  const stepMap = new Map((Array.isArray(stepResults) ? stepResults : []).map((step) => [step.name, step]));
  const uiResult = stepMap.get("smoke:ui:operational")?.result || stepMap.get("smoke:ui")?.result || null;
  const domResult = stepMap.get("smoke:dom:operational")?.result || stepMap.get("smoke:dom")?.result || null;
  const checks = [];

  if (uiResult?.setupPackageGateState?.runMode === "persist_and_prune") {
    checks.push({
      check: "ui_setup_package_persistence_semantics",
      passed:
        uiResult.setupPackagePersistenceExpected === true &&
        typeof uiResult.setupPackageMeaning === "string" &&
        uiResult.setupPackageMeaning.length > 0 &&
        Boolean(uiResult.savedSetupPackageId) &&
        uiResult.setupPackageGateState?.persistedPackageId === uiResult.savedSetupPackageId &&
        Number(uiResult.setupPackageGateState?.embeddedProfileCount || 0) >= 1,
      details: {
        expected: uiResult.setupPackagePersistenceExpected ?? null,
        runMode: uiResult.setupPackageGateState?.runMode ?? null,
        persistedPackageId: uiResult.setupPackageGateState?.persistedPackageId ?? null,
        embeddedProfileCount: uiResult.setupPackageGateState?.embeddedProfileCount ?? null,
      },
    });
  }

  if (uiResult?.localReasonerRestoreGateState?.runMode === "restore_and_prewarm") {
    checks.push({
      check: "ui_local_reasoner_restore_semantics",
      passed:
        uiResult.localReasonerRestoreExpected === true &&
        typeof uiResult.localReasonerRestoreMeaning === "string" &&
        uiResult.localReasonerRestoreMeaning.length > 0 &&
        Boolean(uiResult.localReasonerRestoreProfileId) &&
        uiResult.localReasonerRestoreGateState?.restoredProfileId === uiResult.localReasonerRestoreProfileId &&
        uiResult.localReasonerRestoreGateState?.warmStatus === "ready",
      details: {
        expected: uiResult.localReasonerRestoreExpected ?? null,
        runMode: uiResult.localReasonerRestoreGateState?.runMode ?? null,
        restoredProfileId: uiResult.localReasonerRestoreGateState?.restoredProfileId ?? null,
        warmStatus: uiResult.localReasonerRestoreGateState?.warmStatus ?? null,
      },
    });
  }

  if (domResult?.setupPackageGateState?.runMode === "persist_and_prune") {
    checks.push({
      check: "dom_setup_package_persistence_semantics",
      passed:
        domResult.setupPackagePersistenceExpected === true &&
        typeof domResult.setupPackageMeaning === "string" &&
        domResult.setupPackageMeaning.length > 0 &&
        Boolean(domResult.savedSetupPackageId) &&
        domResult.setupPackageGateState?.persistedPackageId === domResult.savedSetupPackageId &&
        Number(domResult.setupPackageGateState?.embeddedProfileCount || 0) >= 1 &&
        Number(domResult.setupPackageGateState?.prunedDeletedCount || 0) >= 1,
      details: {
        expected: domResult.setupPackagePersistenceExpected ?? null,
        runMode: domResult.setupPackageGateState?.runMode ?? null,
        persistedPackageId: domResult.setupPackageGateState?.persistedPackageId ?? null,
        embeddedProfileCount: domResult.setupPackageGateState?.embeddedProfileCount ?? null,
        prunedDeletedCount: domResult.setupPackageGateState?.prunedDeletedCount ?? null,
      },
    });
  }

  if (domResult?.localReasonerRestoreGateState?.runMode === "restore_and_prewarm") {
    checks.push({
      check: "dom_local_reasoner_restore_semantics",
      passed:
        domResult.localReasonerRestoreExpected === true &&
        typeof domResult.localReasonerRestoreMeaning === "string" &&
        domResult.localReasonerRestoreMeaning.length > 0 &&
        Boolean(domResult.localReasonerRestoreProfileId) &&
        domResult.localReasonerRestoreGateState?.restoredProfileId === domResult.localReasonerRestoreProfileId &&
        domResult.localReasonerRestoreGateState?.warmStatus === "ready",
      details: {
        expected: domResult.localReasonerRestoreExpected ?? null,
        runMode: domResult.localReasonerRestoreGateState?.runMode ?? null,
        restoredProfileId: domResult.localReasonerRestoreGateState?.restoredProfileId ?? null,
        warmStatus: domResult.localReasonerRestoreGateState?.warmStatus ?? null,
      },
    });
  }

  if (domResult?.housekeepingGateState?.runMode === "apply") {
    checks.push({
      check: "dom_housekeeping_apply_semantics",
      passed:
        domResult.housekeepingApplyExpected === true &&
        typeof domResult.housekeepingMeaning === "string" &&
        domResult.housekeepingMeaning.length > 0 &&
        domResult.housekeepingGateState?.liveLedgerTouched === false &&
        Number(domResult.housekeepingGateState?.recoveryDeleteCount || 0) >= 1 &&
        Number(domResult.housekeepingGateState?.readSessionRevokeCount || 0) >= 1 &&
        Number(domResult.housekeepingGateState?.setupDeleteCount || 0) >= 1,
      details: {
        expected: domResult.housekeepingApplyExpected ?? null,
        runMode: domResult.housekeepingGateState?.runMode ?? null,
        recoveryDeleteCount: domResult.housekeepingGateState?.recoveryDeleteCount ?? null,
        readSessionRevokeCount: domResult.housekeepingGateState?.readSessionRevokeCount ?? null,
        setupDeleteCount: domResult.housekeepingGateState?.setupDeleteCount ?? null,
      },
    });
  }

  const failedChecks = checks.filter((entry) => entry.passed === false);
  const passedChecks = checks.filter((entry) => entry.passed === true).length;
  const status =
    failedChecks.length > 0
      ? "failed"
      : checks.length > 0
        ? "passed"
        : "unavailable";

  return {
    status,
    passedChecks,
    totalChecks: checks.length,
    failedChecks: failedChecks.map((entry) => entry.check),
    checks,
  };
}

export function formatOperationalFlowSemanticsSummary(gate = null) {
  if (!gate || typeof gate !== "object") {
    return "operational-flow semantics: unavailable";
  }
  const checkMap = new Map((Array.isArray(gate.checks) ? gate.checks : []).map((entry) => [entry.check, entry]));
  const uiSetupPackageCheck = checkMap.get("ui_setup_package_persistence_semantics") || null;
  const uiRestoreCheck = checkMap.get("ui_local_reasoner_restore_semantics") || null;
  const domSetupPackageCheck = checkMap.get("dom_setup_package_persistence_semantics") || null;
  const domRestoreCheck = checkMap.get("dom_local_reasoner_restore_semantics") || null;
  const domHousekeepingCheck = checkMap.get("dom_housekeeping_apply_semantics") || null;
  const uiSetupPackageSummary = uiSetupPackageCheck
    ? `UISetupPackage=${uiSetupPackageCheck.passed === true ? "pass" : "fail"} (${uiSetupPackageCheck.details?.runMode || "unknown"})`
    : "UISetupPackage=unavailable";
  const uiRestoreSummary = uiRestoreCheck
    ? `UIRestore=${uiRestoreCheck.passed === true ? "pass" : "fail"} (${uiRestoreCheck.details?.runMode || "unknown"})`
    : "UIRestore=unavailable";
  const domSetupPackageSummary = domSetupPackageCheck
    ? `DOMSetupPackage=${domSetupPackageCheck.passed === true ? "pass" : "fail"} (${domSetupPackageCheck.details?.runMode || "unknown"})`
    : "DOMSetupPackage=unavailable";
  const domRestoreSummary = domRestoreCheck
    ? `DOMRestore=${domRestoreCheck.passed === true ? "pass" : "fail"} (${domRestoreCheck.details?.runMode || "unknown"})`
    : "DOMRestore=unavailable";
  const domHousekeepingSummary = domHousekeepingCheck
    ? `DOMHousekeeping=${domHousekeepingCheck.passed === true ? "pass" : "fail"} (${domHousekeepingCheck.details?.runMode || "unknown"})`
    : "DOMHousekeeping=unavailable";
  const failed = Array.isArray(gate.failedChecks) && gate.failedChecks.length
    ? ` failed=${gate.failedChecks.join(",")}`
    : "";
  return `operational-flow semantics: ${gate.status}${failed}; ${uiSetupPackageSummary}; ${uiRestoreSummary}; ${domSetupPackageSummary}; ${domRestoreSummary}; ${domHousekeepingSummary}`;
}

export function summarizeRuntimeEvidenceSemantics(stepResults = []) {
  const stepMap = new Map((Array.isArray(stepResults) ? stepResults : []).map((step) => [step.name, step]));
  const uiResult = stepMap.get("smoke:ui:operational")?.result || stepMap.get("smoke:ui")?.result || null;
  const domResult = stepMap.get("smoke:dom:operational")?.result || stepMap.get("smoke:dom")?.result || null;
  const checks = [];

  if (uiResult?.localReasonerLifecycleGateState) {
    checks.push({
      check: "ui_local_reasoner_lifecycle_semantics",
      passed:
        uiResult.localReasonerLifecycleExpected === true &&
        typeof uiResult.localReasonerLifecycleMeaning === "string" &&
        uiResult.localReasonerLifecycleMeaning.length > 0 &&
        uiResult.localReasonerLifecycleGateState?.runMode === "configure_probe_profile" &&
        Boolean(uiResult.localReasonerLifecycleGateState?.configuredStatus) &&
        Number(uiResult.localReasonerLifecycleGateState?.catalogProviderCount || 0) >= 1 &&
        Boolean(uiResult.localReasonerLifecycleGateState?.probeStatus) &&
        uiResult.localReasonerLifecycleGateState?.selectedProvider === "local_command" &&
        uiResult.localReasonerLifecycleGateState?.prewarmStatus === "ready" &&
        Number(uiResult.localReasonerLifecycleGateState?.observedProfileCount || 0) >= 1 &&
        Number(uiResult.localReasonerLifecycleGateState?.observedRestoreCandidateCount || 0) >= 1,
      details: {
        runMode: uiResult.localReasonerLifecycleGateState?.runMode ?? null,
        configuredStatus: uiResult.localReasonerLifecycleGateState?.configuredStatus ?? null,
        catalogProviderCount: uiResult.localReasonerLifecycleGateState?.catalogProviderCount ?? null,
        probeStatus: uiResult.localReasonerLifecycleGateState?.probeStatus ?? null,
        selectedProvider: uiResult.localReasonerLifecycleGateState?.selectedProvider ?? null,
        prewarmStatus: uiResult.localReasonerLifecycleGateState?.prewarmStatus ?? null,
        observedProfileCount: uiResult.localReasonerLifecycleGateState?.observedProfileCount ?? null,
        observedRestoreCandidateCount: uiResult.localReasonerLifecycleGateState?.observedRestoreCandidateCount ?? null,
      },
    });
  }

  if (uiResult?.conversationMemoryGateState) {
    checks.push({
      check: "ui_conversation_memory_semantics",
      passed:
        uiResult.conversationMemoryExpected === true &&
        typeof uiResult.conversationMemoryMeaning === "string" &&
        uiResult.conversationMemoryMeaning.length > 0 &&
        uiResult.conversationMemoryGateState?.runMode === "persist_and_retrieve" &&
        Boolean(uiResult.conversationMemoryGateState?.minuteId) &&
        Number(uiResult.conversationMemoryGateState?.observedMinuteCount || 0) >= 1 &&
        Number(uiResult.conversationMemoryGateState?.transcriptEntryCount || 0) >= 1 &&
        Number(uiResult.conversationMemoryGateState?.transcriptBlockCount || 0) >= 1 &&
        Number(uiResult.conversationMemoryGateState?.runtimeSearchHits || 0) >= 1,
      details: {
        runMode: uiResult.conversationMemoryGateState?.runMode ?? null,
        minuteId: uiResult.conversationMemoryGateState?.minuteId ?? null,
        observedMinuteCount: uiResult.conversationMemoryGateState?.observedMinuteCount ?? null,
        transcriptEntryCount: uiResult.conversationMemoryGateState?.transcriptEntryCount ?? null,
        transcriptBlockCount: uiResult.conversationMemoryGateState?.transcriptBlockCount ?? null,
        runtimeSearchHits: uiResult.conversationMemoryGateState?.runtimeSearchHits ?? null,
      },
    });
  }

  if (uiResult?.sandboxAuditGateState) {
    checks.push({
      check: "ui_sandbox_audit_semantics",
      passed:
        uiResult.sandboxAuditEvidenceExpected === true &&
        typeof uiResult.sandboxAuditMeaning === "string" &&
        uiResult.sandboxAuditMeaning.length > 0 &&
        uiResult.sandboxAuditGateState?.runMode === "audit_trail_expected" &&
        Number(uiResult.sandboxAuditGateState?.observedAuditCount || 0) >= 1 &&
        Number(uiResult.sandboxAuditGateState?.sandboxSearchHits || 0) >= 1 &&
        Number(uiResult.sandboxAuditGateState?.sandboxListEntries || 0) >= 1,
      details: {
        runMode: uiResult.sandboxAuditGateState?.runMode ?? null,
        observedAuditCount: uiResult.sandboxAuditGateState?.observedAuditCount ?? null,
        sandboxSearchHits: uiResult.sandboxAuditGateState?.sandboxSearchHits ?? null,
        sandboxListEntries: uiResult.sandboxAuditGateState?.sandboxListEntries ?? null,
      },
    });
  }

  if (uiResult?.executionHistoryGateState) {
    checks.push({
      check: "ui_execution_history_semantics",
      passed:
        uiResult.executionHistoryExpected === true &&
        typeof uiResult.executionHistoryMeaning === "string" &&
        uiResult.executionHistoryMeaning.length > 0 &&
        uiResult.executionHistoryGateState?.runMode === "persist_history" &&
        Boolean(uiResult.executionHistoryGateState?.verificationStatus) &&
        Number(uiResult.executionHistoryGateState?.observedVerificationHistoryCount || 0) >= 1 &&
        Boolean(uiResult.executionHistoryGateState?.runnerStatus) &&
        Number(uiResult.executionHistoryGateState?.observedRunnerHistoryCount || 0) >= 1,
      details: {
        runMode: uiResult.executionHistoryGateState?.runMode ?? null,
        verificationStatus: uiResult.executionHistoryGateState?.verificationStatus ?? null,
        observedVerificationHistoryCount: uiResult.executionHistoryGateState?.observedVerificationHistoryCount ?? null,
        runnerStatus: uiResult.executionHistoryGateState?.runnerStatus ?? null,
        observedRunnerHistoryCount: uiResult.executionHistoryGateState?.observedRunnerHistoryCount ?? null,
      },
    });
  }

  if (domResult?.localReasonerLifecycleGateState) {
    checks.push({
      check: "dom_local_reasoner_lifecycle_semantics",
      passed:
        domResult.localReasonerLifecycleExpected === true &&
        typeof domResult.localReasonerLifecycleMeaning === "string" &&
        domResult.localReasonerLifecycleMeaning.length > 0 &&
        domResult.localReasonerLifecycleGateState?.runMode === "configure_probe_profile" &&
        Boolean(domResult.localReasonerLifecycleGateState?.configuredStatus) &&
        Number(domResult.localReasonerLifecycleGateState?.catalogProviderCount || 0) >= 1 &&
        Boolean(domResult.localReasonerLifecycleGateState?.probeStatus) &&
        domResult.localReasonerLifecycleGateState?.selectedProvider === "local_command" &&
        domResult.localReasonerLifecycleGateState?.prewarmStatus === "ready" &&
        Number(domResult.localReasonerLifecycleGateState?.observedProfileCount || 0) >= 1 &&
        Number(domResult.localReasonerLifecycleGateState?.observedRestoreCandidateCount || 0) >= 1,
      details: {
        runMode: domResult.localReasonerLifecycleGateState?.runMode ?? null,
        configuredStatus: domResult.localReasonerLifecycleGateState?.configuredStatus ?? null,
        catalogProviderCount: domResult.localReasonerLifecycleGateState?.catalogProviderCount ?? null,
        probeStatus: domResult.localReasonerLifecycleGateState?.probeStatus ?? null,
        selectedProvider: domResult.localReasonerLifecycleGateState?.selectedProvider ?? null,
        prewarmStatus: domResult.localReasonerLifecycleGateState?.prewarmStatus ?? null,
        observedProfileCount: domResult.localReasonerLifecycleGateState?.observedProfileCount ?? null,
        observedRestoreCandidateCount: domResult.localReasonerLifecycleGateState?.observedRestoreCandidateCount ?? null,
      },
    });
  }

  if (domResult?.conversationMemoryGateState) {
    checks.push({
      check: "dom_conversation_memory_semantics",
      passed:
        domResult.conversationMemoryExpected === true &&
        typeof domResult.conversationMemoryMeaning === "string" &&
        domResult.conversationMemoryMeaning.length > 0 &&
        domResult.conversationMemoryGateState?.runMode === "retrieve_existing_memory" &&
        Number(domResult.conversationMemoryGateState?.observedMinuteCount || 0) >= 1 &&
        Number(domResult.conversationMemoryGateState?.transcriptEntryCount || 0) >= 1 &&
        Number(domResult.conversationMemoryGateState?.transcriptBlockCount || 0) >= 1 &&
        Number(domResult.conversationMemoryGateState?.runtimeSearchHits || 0) >= 1,
      details: {
        runMode: domResult.conversationMemoryGateState?.runMode ?? null,
        observedMinuteCount: domResult.conversationMemoryGateState?.observedMinuteCount ?? null,
        transcriptEntryCount: domResult.conversationMemoryGateState?.transcriptEntryCount ?? null,
        transcriptBlockCount: domResult.conversationMemoryGateState?.transcriptBlockCount ?? null,
        runtimeSearchHits: domResult.conversationMemoryGateState?.runtimeSearchHits ?? null,
      },
    });
  }

  if (domResult?.sandboxAuditGateState) {
    checks.push({
      check: "dom_sandbox_audit_semantics",
      passed:
        domResult.sandboxAuditEvidenceExpected === true &&
        typeof domResult.sandboxAuditMeaning === "string" &&
        domResult.sandboxAuditMeaning.length > 0 &&
        domResult.sandboxAuditGateState?.runMode === "audit_trail_expected" &&
        Number(domResult.sandboxAuditGateState?.observedAuditCount || 0) >= 1 &&
        Number(domResult.sandboxAuditGateState?.sandboxSearchHits || 0) >= 1 &&
        Number(domResult.sandboxAuditGateState?.sandboxListEntries || 0) >= 1,
      details: {
        runMode: domResult.sandboxAuditGateState?.runMode ?? null,
        observedAuditCount: domResult.sandboxAuditGateState?.observedAuditCount ?? null,
        sandboxSearchHits: domResult.sandboxAuditGateState?.sandboxSearchHits ?? null,
        sandboxListEntries: domResult.sandboxAuditGateState?.sandboxListEntries ?? null,
      },
    });
  }

  if (domResult?.executionHistoryGateState) {
    checks.push({
      check: "dom_execution_history_semantics",
      passed:
        domResult.executionHistoryExpected === true &&
        typeof domResult.executionHistoryMeaning === "string" &&
        domResult.executionHistoryMeaning.length > 0 &&
        domResult.executionHistoryGateState?.runMode === "persist_history" &&
        Boolean(domResult.executionHistoryGateState?.verificationStatus) &&
        Number(domResult.executionHistoryGateState?.observedVerificationHistoryCount || 0) >= 1 &&
        Boolean(domResult.executionHistoryGateState?.runnerStatus) &&
        Number(domResult.executionHistoryGateState?.observedRunnerHistoryCount || 0) >= 1,
      details: {
        runMode: domResult.executionHistoryGateState?.runMode ?? null,
        verificationStatus: domResult.executionHistoryGateState?.verificationStatus ?? null,
        observedVerificationHistoryCount: domResult.executionHistoryGateState?.observedVerificationHistoryCount ?? null,
        runnerStatus: domResult.executionHistoryGateState?.runnerStatus ?? null,
        observedRunnerHistoryCount: domResult.executionHistoryGateState?.observedRunnerHistoryCount ?? null,
      },
    });
  }

  const failedChecks = checks.filter((entry) => entry.passed === false);
  const passedChecks = checks.filter((entry) => entry.passed === true).length;
  const status =
    failedChecks.length > 0
      ? "failed"
      : checks.length > 0
        ? "passed"
        : "unavailable";

  return {
    status,
    passedChecks,
    totalChecks: checks.length,
    failedChecks: failedChecks.map((entry) => entry.check),
    checks,
  };
}

export function formatRuntimeEvidenceSemanticsSummary(gate = null) {
  if (!gate || typeof gate !== "object") {
    return "runtime-evidence semantics: unavailable";
  }
  const checkMap = new Map((Array.isArray(gate.checks) ? gate.checks : []).map((entry) => [entry.check, entry]));
  const labels = [
    ["ui_local_reasoner_lifecycle_semantics", "UILocalReasoner", "observedProfileCount"],
    ["ui_conversation_memory_semantics", "UIConversation", "runtimeSearchHits"],
    ["ui_sandbox_audit_semantics", "UISandbox", "observedAuditCount"],
    ["ui_execution_history_semantics", "UIExecutionHistory", "observedRunnerHistoryCount"],
    ["dom_local_reasoner_lifecycle_semantics", "DOMLocalReasoner", "observedProfileCount"],
    ["dom_conversation_memory_semantics", "DOMConversation", "runtimeSearchHits"],
    ["dom_sandbox_audit_semantics", "DOMSandbox", "observedAuditCount"],
    ["dom_execution_history_semantics", "DOMExecutionHistory", "observedRunnerHistoryCount"],
  ];
  const parts = labels.map(([checkName, label, focusField]) => {
    const check = checkMap.get(checkName) || null;
    if (!check) {
      return `${label}=unavailable`;
    }
    const focusValue = check.details?.[focusField];
    const focusSummary =
      focusValue == null
        ? check.details?.runMode || "unknown"
        : `${focusField}=${typeof focusValue === "number" ? Number(focusValue) : focusValue}`;
    return `${label}=${check.passed === true ? "pass" : "fail"} (${focusSummary})`;
  });
  const failed = Array.isArray(gate.failedChecks) && gate.failedChecks.length
    ? ` failed=${gate.failedChecks.join(",")}`
    : "";
  return `runtime-evidence semantics: ${gate.status}${failed}; ${parts.join("; ")}`;
}

function runStep(name, script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    const child = spawn(process.execPath, [path.join(rootDir, "scripts", script)], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      process.stderr.write(chunk);
    });

    function releaseChildPipes() {
      child.stdout?.destroy();
      child.stderr?.destroy();
    }

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      releaseChildPipes();
      reject(error);
    });
    // Some smoke steps spawn helper subprocesses that can inherit stdio.
    // Waiting for `close` can hang even after the step process itself exited,
    // so we resolve on `exit` and then explicitly tear down the stdio pipes.
    child.on("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      const durationMs = Date.now() - startedAt;
      releaseChildPipes();
      if (code !== 0) {
        reject(new Error(`${name} failed with code ${code}\n${stderr || stdout}`));
        return;
      }
      const result = extractTrailingJson(stdout);
      resolve({
        name,
        script,
        durationMs,
        result,
      });
    });
  });
}

async function main() {
  if (requireBrowser && skipBrowser) {
    throw new Error("SMOKE_ALL_REQUIRE_BROWSER=1 不能与 SMOKE_ALL_SKIP_BROWSER=1 同时启用");
  }

  const preflightStepDef = [
    "verify:mempalace:remote-reasoner",
    "verify-mempalace-remote-reasoner.mjs",
    { SMOKE_COMBINED: "1" },
  ];
  const primaryStepDefs = [
    ["smoke:ui", "smoke-ui.mjs", { SMOKE_COMBINED: "1" }],
    ["smoke:dom", "smoke-dom.mjs", { SMOKE_COMBINED: "1" }],
  ];
  const browserStep = ["smoke:browser", "smoke-browser.mjs", { SMOKE_COMBINED: "1" }];
  const operationalStepDefs = [
    ["smoke:ui:operational", "smoke-ui.mjs", {}],
    ["smoke:dom:operational", "smoke-dom.mjs", {}],
  ];
  const allStepDefs = skipBrowser ? primaryStepDefs : [...primaryStepDefs, browserStep];
  const startedAt = Date.now();
  const resolvedBaseUrl = await resolveSmokeBaseUrl();
  const resolvedDataRoot = await prepareSmokeDataRoot({
    isolated: !resolvedBaseUrl.reuseExisting,
    tempPrefix: "openneed-memory-smoke-all-",
  });
  const smokeServer = await ensureSmokeServer(resolvedBaseUrl.baseUrl, {
    reuseExisting: resolvedBaseUrl.reuseExisting,
    extraEnv: resolvedDataRoot.isolationEnv,
  });
  const baseEnv = {
    AGENT_PASSPORT_BASE_URL: smokeServer.baseUrl,
    ...resolvedDataRoot.isolationEnv,
  };

  try {
    const steps = [await runStep(preflightStepDef[0], preflightStepDef[1], { ...baseEnv, ...preflightStepDef[2] })];
    if (runInParallel) {
      const domStepDef = primaryStepDefs.find(([name]) => name === "smoke:dom");
      const uiStepDef = primaryStepDefs.find(([name]) => name === "smoke:ui");
      const domPromise = domStepDef
        ? runStep(domStepDef[0], domStepDef[1], { ...baseEnv, ...domStepDef[2] })
        : Promise.resolve(null);
      const uiResult = uiStepDef ? await runStep(uiStepDef[0], uiStepDef[1], { ...baseEnv, ...uiStepDef[2] }) : null;
      const browserResultPromise = skipBrowser
        ? Promise.resolve(null)
        : runStep(browserStep[0], browserStep[1], { ...baseEnv, ...browserStep[2] });
      const [domResult, browserResult] = await Promise.all([domPromise, browserResultPromise]);
      if (uiResult) {
        steps.push(uiResult);
      }
      if (domResult) {
        steps.push(domResult);
      }
      if (browserResult) {
        steps.push(browserResult);
      }
    } else {
      for (const [name, script, extraEnv] of allStepDefs) {
        steps.push(await runStep(name, script, { ...baseEnv, ...extraEnv }));
      }
    }
    for (const [name, script, extraEnv] of operationalStepDefs) {
      steps.push(await runStep(name, script, { ...baseEnv, ...extraEnv }));
    }

    const totalDurationMs = Date.now() - startedAt;
    const offlineFanoutGate = summarizeOfflineFanoutGate(steps, {
      browserSkipped: skipBrowser,
    });
    offlineFanoutGate.summary = formatOfflineFanoutGateSummary(offlineFanoutGate);
    if (offlineFanoutGate.status === "failed") {
      throw new Error(offlineFanoutGate.summary);
    }
    const protectiveStateSemantics = summarizeProtectiveStateSemantics(steps, {
      browserSkipped: skipBrowser,
    });
    protectiveStateSemantics.summary = formatProtectiveStateSemanticsSummary(protectiveStateSemantics);
    if (protectiveStateSemantics.status === "failed") {
      throw new Error(protectiveStateSemantics.summary);
    }
    const operationalFlowSemantics = summarizeOperationalFlowSemantics(steps);
    operationalFlowSemantics.summary = formatOperationalFlowSemanticsSummary(operationalFlowSemantics);
    if (operationalFlowSemantics.status === "failed") {
      throw new Error(operationalFlowSemantics.summary);
    }
    const runtimeEvidenceSemantics = summarizeRuntimeEvidenceSemantics(steps);
    runtimeEvidenceSemantics.summary = formatRuntimeEvidenceSemanticsSummary(runtimeEvidenceSemantics);
    if (runtimeEvidenceSemantics.status === "failed") {
      throw new Error(runtimeEvidenceSemantics.summary);
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: runInParallel ? "parallel_combined_with_operational" : "sequential_combined_with_operational",
          totalDurationMs,
          browserSkipped: skipBrowser,
          browserRequired: requireBrowser,
          baseUrl: smokeServer.baseUrl,
          serverStartedBySmokeAll: smokeServer.started,
          serverIsolationMode: resolvedBaseUrl.isolationMode,
          serverDataIsolationMode: resolvedDataRoot.dataIsolationMode,
          serverSecretIsolationMode: resolvedDataRoot.secretIsolationMode,
          offlineFanoutGate,
          protectiveStateSemantics,
          operationalFlowSemantics,
          runtimeEvidenceSemantics,
          steps,
        },
        null,
        2
      )
    );
  } finally {
    await smokeServer.stop();
    await resolvedDataRoot.cleanup();
  }
}

if (smokeAllDirectExecution) {
  await main();
}

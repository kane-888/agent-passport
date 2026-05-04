import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_RUNTIME_ENTRY_HREFS,
  isPublicRuntimeHomeFailureText,
  isPublicRuntimeHomePendingText,
} from "../public/runtime-truth-client.js";
import {
  AGENT_PASSPORT_MAIN_AGENT_ID,
  LEGACY_OPENNEED_AGENT_ID,
} from "../src/main-agent-compat.js";
import {
  cleanupSmokeWrapperRuntime,
  ensureSmokeServer,
  prepareSmokeDataRoot,
  resolveSmokeBaseUrl,
} from "./smoke-server.mjs";
import {
  DEFAULT_BROWSER_SMOKE_FETCH_TIMEOUT_MS,
} from "./smoke-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const smokeAllDirectExecution = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;
const skipBrowser = process.env.SMOKE_ALL_SKIP_BROWSER === "1";
const requireBrowser = process.env.SMOKE_ALL_REQUIRE_BROWSER === "1";
const runInParallel = process.env.SMOKE_ALL_PARALLEL === "1";

export function resolveSmokeAllMode({ parallel = false } = {}) {
  return parallel ? "parallel_combined_with_operational" : "sequential_combined_with_operational";
}

export function buildSmokeAllResultEnvelope({
  parallel = false,
  ok = true,
  browserSkipped = false,
  browserCovered,
  ...result
} = {}) {
  const resolvedBrowserCovered = browserCovered ?? browserSkipped !== true;
  return {
    ok,
    browserCovered: resolvedBrowserCovered,
    fullSmokePassed: ok === true && resolvedBrowserCovered === true,
    mode: resolveSmokeAllMode({ parallel }),
    browserSkipped,
    ...result,
  };
}

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

function normalizeSemanticsText(value = "") {
  return String(value ?? "").trim();
}

function isLoadedRuntimeHomeText(value = "") {
  const normalized = normalizeSemanticsText(value);
  return normalized.length > 0 && !isPublicRuntimeHomePendingText(normalized) && !isPublicRuntimeHomeFailureText(normalized);
}

function isLoadedRuntimeHomeSummary(summary = null) {
  if (!summary || typeof summary !== "object") {
    return false;
  }
  if (summary.loadState != null) {
    return normalizeSemanticsText(summary.loadState) === "loaded";
  }
  return (
    isLoadedRuntimeHomeText(summary.homeSummary) &&
    isLoadedRuntimeHomeText(summary.healthSummary) &&
    isLoadedRuntimeHomeText(summary.recoverySummary) &&
    isLoadedRuntimeHomeText(summary.automationSummary)
  );
}

function matchesCanonicalRuntimeEntryHrefs(runtimeLinks = []) {
  const normalizedLinks = Array.isArray(runtimeLinks) ? runtimeLinks.map((entry) => normalizeSemanticsText(entry)) : [];
  return (
    normalizedLinks.length === PUBLIC_RUNTIME_ENTRY_HREFS.length &&
    PUBLIC_RUNTIME_ENTRY_HREFS.every((entry) => normalizedLinks.includes(entry))
  );
}

function hasStructuredRepairHubStatusCards(statusCards = []) {
  if (!Array.isArray(statusCards) || statusCards.length !== 3) {
    return false;
  }
  const requiredKinds = ["risk", "evidence", "action"];
  if (!requiredKinds.every((kind) => statusCards.some((card) => normalizeSemanticsText(card?.cardKind) === kind))) {
    return false;
  }
  const firstStatusListId = normalizeSemanticsText(statusCards[0]?.statusListId);
  const firstStatusListIndex = normalizeSemanticsText(statusCards[0]?.statusListIndex);
  const firstActiveEntryId = normalizeSemanticsText(statusCards[0]?.activeEntryId);
  return Boolean(
    firstStatusListId &&
      firstStatusListIndex &&
      firstActiveEntryId &&
      statusCards.every((card) =>
        normalizeSemanticsText(card?.statusListId) === firstStatusListId &&
        normalizeSemanticsText(card?.statusListIndex) === firstStatusListIndex &&
        normalizeSemanticsText(card?.activeEntryId) === firstActiveEntryId &&
        normalizeSemanticsText(card?.riskState) &&
        normalizeSemanticsText(card?.tone)
      )
  );
}

function hasStructuredRepairHubTruthCard(
  repairTruthCard = null,
  {
    expectedVisibleDidMethod = "agentpassport",
    expectedCompatibilityGapDidMethod = "openneed",
  } = {}
) {
  if (!repairTruthCard || typeof repairTruthCard !== "object" || Array.isArray(repairTruthCard)) {
    return false;
  }
  const visibleIssuedDidMethods = Array.isArray(repairTruthCard.visibleIssuedDidMethods)
    ? repairTruthCard.visibleIssuedDidMethods.map((entry) => normalizeSemanticsText(entry)).filter(Boolean)
    : [];
  const allIssuedDidMethods = Array.isArray(repairTruthCard.allIssuedDidMethods)
    ? repairTruthCard.allIssuedDidMethods.map((entry) => normalizeSemanticsText(entry)).filter(Boolean)
    : [];
  const publicIssuedDidMethods = Array.isArray(repairTruthCard.publicIssuedDidMethods)
    ? repairTruthCard.publicIssuedDidMethods.map((entry) => normalizeSemanticsText(entry)).filter(Boolean)
    : [];
  const compatibilityIssuedDidMethods = Array.isArray(repairTruthCard.compatibilityIssuedDidMethods)
    ? repairTruthCard.compatibilityIssuedDidMethods.map((entry) => normalizeSemanticsText(entry)).filter(Boolean)
    : [];
  const publicMissingDidMethods = Array.isArray(repairTruthCard.publicMissingDidMethods)
    ? repairTruthCard.publicMissingDidMethods.map((entry) => normalizeSemanticsText(entry)).filter(Boolean)
    : [];
  const repairMissingDidMethods = Array.isArray(repairTruthCard.repairMissingDidMethods)
    ? repairTruthCard.repairMissingDidMethods.map((entry) => normalizeSemanticsText(entry)).filter(Boolean)
    : [];
  const visibleReceiptCount = Number(repairTruthCard.visibleReceiptCount || 0);
  const allReceiptCount = Number(repairTruthCard.allReceiptCount || 0);
  const totalSubjects = Number(repairTruthCard.totalSubjects || 0);
  const completeSubjectCount = Number(repairTruthCard.completeSubjectCount || 0);
  const repairCompleteSubjectCount = Number(repairTruthCard.repairCompleteSubjectCount || 0);
  const repairPartialSubjectCount = Number(repairTruthCard.repairPartialSubjectCount || 0);
  const repairableSubjectCount = Number(repairTruthCard.repairableSubjectCount || 0);

  return Boolean(
    visibleIssuedDidMethods.length === 1 &&
      visibleIssuedDidMethods[0] === normalizeSemanticsText(expectedVisibleDidMethod) &&
      allIssuedDidMethods.includes("agentpassport") &&
      allIssuedDidMethods.includes("openneed") &&
      publicIssuedDidMethods.includes("agentpassport") &&
      compatibilityIssuedDidMethods.includes("openneed") &&
      Number.isFinite(visibleReceiptCount) &&
      Number.isFinite(allReceiptCount) &&
      visibleReceiptCount === 1 &&
      allReceiptCount === 2 &&
      allReceiptCount >= visibleReceiptCount &&
      repairTruthCard.coverageSource === "after" &&
      totalSubjects >= 1 &&
      completeSubjectCount >= 1 &&
      repairTruthCard.publicComplete === true &&
      Number.isFinite(repairCompleteSubjectCount) &&
      Number.isFinite(repairPartialSubjectCount) &&
      Number.isFinite(repairableSubjectCount) &&
      publicMissingDidMethods.length === 0 &&
      (
        repairTruthCard.repairComplete === true
          ? repairCompleteSubjectCount >= 1 &&
            repairPartialSubjectCount === 0 &&
            repairableSubjectCount === 0 &&
            repairMissingDidMethods.length === 0
          : repairTruthCard.repairComplete === false &&
            repairPartialSubjectCount >= 1 &&
            repairableSubjectCount >= 1 &&
            repairMissingDidMethods.includes(normalizeSemanticsText(expectedCompatibilityGapDidMethod))
      )
  );
}

function deriveExpectedRepairVerdictState(repairTruthCard = null) {
  if (!repairTruthCard || Number(repairTruthCard.totalSubjects || 0) <= 0) {
    return "coverage_unknown";
  }
  if (repairTruthCard.repairComplete === true) {
    return "repair_complete";
  }
  if (repairTruthCard.publicComplete === true) {
    return "public_complete_backlog";
  }
  if (Array.isArray(repairTruthCard.publicMissingDidMethods) && repairTruthCard.publicMissingDidMethods.length) {
    return "public_incomplete";
  }
  return "repair_in_progress";
}

function deriveExpectedRepairNextStepState(repairTruthCard = null) {
  if (!repairTruthCard || Number(repairTruthCard.totalSubjects || 0) <= 0) {
    return "inspect_coverage_truth";
  }
  if (repairTruthCard.repairComplete === true) {
    return "audit_evidence";
  }
  if (repairTruthCard.publicComplete === true) {
    return "finish_compatibility_backlog";
  }
  if (Array.isArray(repairTruthCard.publicMissingDidMethods) && repairTruthCard.publicMissingDidMethods.length) {
    return "finish_public_mainline";
  }
  return "inspect_coverage_truth";
}

function hasStructuredRepairHubSummaryCards(repairSummaryCards = null, repairTruthCard = null) {
  if (!Array.isArray(repairSummaryCards) || repairSummaryCards.length !== 3) {
    return false;
  }
  const verdictCard = repairSummaryCards.find((entry) => normalizeSemanticsText(entry.summaryKind) === "repair-verdict");
  const impactCard = repairSummaryCards.find((entry) => normalizeSemanticsText(entry.summaryKind) === "repair-impact");
  const nextStepCard = repairSummaryCards.find((entry) => normalizeSemanticsText(entry.summaryKind) === "repair-next-step");
  if (!verdictCard || !impactCard || !nextStepCard) {
    return false;
  }

  return Boolean(
    verdictCard.repairVerdictState === deriveExpectedRepairVerdictState(repairTruthCard) &&
      impactCard.repairImpactState === "coverage_truth" &&
      Number(impactCard.totalSubjects || 0) === Number(repairTruthCard?.totalSubjects || 0) &&
      Number(impactCard.currentViewCredentialCount || 0) >= 0 &&
      nextStepCard.repairNextStepState === deriveExpectedRepairNextStepState(repairTruthCard)
  );
}

function hasStructuredRepairHubView(
  repairHubSummary = null,
  {
    baseUrl = "",
    repairId = null,
    credentialId = null,
    expectedCredentialDidMethod = "agentpassport",
    expectedVisibleDidMethod = "agentpassport",
  } = {}
) {
  return Boolean(
    repairHubSummary?.tokenInputPresent === true &&
      repairHubSummary?.mainLinkHref === `${baseUrl}/` &&
      Number(repairHubSummary?.selectedCredentialJsonLength || 0) > 0 &&
      repairHubSummary?.selectedCredentialContainsId === true &&
      repairHubSummary?.selectedCredentialParsed?.ok === true &&
      repairHubSummary?.selectedDidMethodFilter === normalizeSemanticsText(expectedVisibleDidMethod) &&
      repairHubSummary?.selectedCredentialParsed?.credentialRecordId === credentialId &&
      repairHubSummary?.selectedCredentialParsed?.issuerDidMethod === normalizeSemanticsText(expectedCredentialDidMethod) &&
      repairHubSummary?.selectedCredentialParsed?.repairId === (repairId || null) &&
      hasStructuredRepairHubStatusCards(repairHubSummary?.statusCards) &&
      hasStructuredRepairHubTruthCard(repairHubSummary?.repairTruthCard, {
        expectedVisibleDidMethod,
      }) &&
      hasStructuredRepairHubSummaryCards(
        repairHubSummary?.repairSummaryCards,
        repairHubSummary?.repairTruthCard
      ) &&
      repairHubSummary?.selectedRepairId === (repairId || null)
  );
}

function hasCanonicalizedRepairHubLegacyMainAgentView(
  repairHubSummary = null,
  {
    repairId = null,
    expectedVisibleDidMethod = "agentpassport",
    canonicalMainAgentId = AGENT_PASSPORT_MAIN_AGENT_ID,
    legacyMainAgentId = LEGACY_OPENNEED_AGENT_ID,
  } = {}
) {
  if (!repairHubSummary || typeof repairHubSummary !== "object" || Array.isArray(repairHubSummary)) {
    return false;
  }
  const locationSearch = normalizeSemanticsText(repairHubSummary.locationSearch);
  const selectedAgentId = normalizeSemanticsText(repairHubSummary.selectedAgentId);
  const selectedIssuerAgentId = normalizeSemanticsText(repairHubSummary.selectedIssuerAgentId);
  const selectedDidMethodFilter = normalizeSemanticsText(repairHubSummary.selectedDidMethodFilter);
  const selectedRepairId = normalizeSemanticsText(repairHubSummary.selectedRepairId);

  return Boolean(
    !locationSearch.includes(legacyMainAgentId) &&
      (!selectedAgentId || selectedAgentId === canonicalMainAgentId) &&
      (!selectedIssuerAgentId || selectedIssuerAgentId === canonicalMainAgentId) &&
      selectedDidMethodFilter === normalizeSemanticsText(expectedVisibleDidMethod) &&
      selectedRepairId === normalizeSemanticsText(repairId)
  );
}

export function extractStepExternalWaitMs(name, result = null) {
  if (name !== "smoke:browser" || !result || typeof result !== "object") {
    return 0;
  }
  const waitMs = Number(result.timing?.browserAutomationLockWaitMs ?? result.browserAutomationLockWaitMs ?? 0);
  return Number.isFinite(waitMs) && waitMs > 0 ? Math.round(waitMs) : 0;
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
      Number(groupSummary?.dispatchHistoryCount || 0) >= 1 &&
      String(groupSummary?.firstParallelChip || "").trim().length > 0 &&
      String(groupSummary?.firstDispatchBody || "").trim().length > 0 &&
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
  const hasCheck = (checkName) => checks.some((entry) => entry.check === checkName);

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

  if (uiResult) {
    for (const [check, details] of [
      [
        "ui_keychain_migration_semantics",
        {
          expected: uiResult.keychainMigrationApplyExpected ?? null,
          meaning: uiResult.keychainMigrationMeaning ?? null,
          runMode: "missing",
          skipped: null,
          dryRun: null,
        },
      ],
      [
        "ui_housekeeping_semantics",
        {
          expected: uiResult.housekeepingApplyExpected ?? null,
          meaning: uiResult.housekeepingMeaning ?? null,
          runMode: "missing",
          liveLedgerTouched: null,
        },
      ],
    ]) {
      if (!hasCheck(check)) {
        checks.push({
          check,
          passed: false,
          details,
        });
      }
    }
  } else {
    for (const [check, details] of [
      [
        "ui_runner_guard_semantics",
        {
          runnerStatus: null,
          expected: null,
          meaning: null,
          gateStatus: null,
        },
      ],
      [
        "ui_bootstrap_semantics",
        {
          bootstrapDryRun: null,
          expected: null,
          meaning: null,
          runMode: "missing",
        },
      ],
      [
        "ui_keychain_migration_semantics",
        {
          expected: null,
          meaning: null,
          runMode: "missing",
          skipped: null,
          dryRun: null,
        },
      ],
      [
        "ui_housekeeping_semantics",
        {
          expected: null,
          meaning: null,
          runMode: "missing",
          liveLedgerTouched: null,
        },
      ],
    ]) {
      checks.push({
        check,
        passed: false,
        details,
      });
    }
  }

  if (domResult) {
    for (const [check, details] of [
      [
        "dom_setup_package_semantics",
        {
          expected: domResult.setupPackagePersistenceExpected ?? null,
          meaning: domResult.setupPackageMeaning ?? null,
          runMode: "missing",
        },
      ],
      [
        "dom_recovery_bundle_semantics",
        {
          expected: domResult.recoveryBundlePersistenceExpected ?? null,
          meaning: domResult.recoveryBundleMeaning ?? null,
          runMode: "missing",
        },
      ],
      [
        "dom_recovery_rehearsal_semantics",
        {
          expected: domResult.recoveryRehearsalPersistenceExpected ?? null,
          meaning: domResult.recoveryRehearsalMeaning ?? null,
          runMode: "missing",
        },
      ],
    ]) {
      if (!hasCheck(check)) {
        checks.push({
          check,
          passed: false,
          details,
        });
      }
    }
  } else {
    for (const [check, details] of [
      [
        "dom_device_setup_preview_semantics",
        {
          deviceSetupComplete: null,
          deviceSetupRunComplete: null,
          expected: null,
          meaning: null,
          runMode: "missing",
        },
      ],
      [
        "dom_setup_package_semantics",
        {
          expected: null,
          meaning: null,
          runMode: "missing",
        },
      ],
      [
        "dom_recovery_bundle_semantics",
        {
          expected: null,
          meaning: null,
          runMode: "missing",
        },
      ],
      [
        "dom_recovery_rehearsal_semantics",
        {
          expected: null,
          meaning: null,
          runMode: "missing",
        },
      ],
    ]) {
      checks.push({
        check,
        passed: false,
        details,
      });
    }
  }

  checks.push({
    check: "browser_skip_semantics",
    passed: browserSkipped === true || stepMap.has("smoke:browser"),
    details: {
      expectedSkip: browserSkipped,
      skipped: browserSkipped,
      browserResultPresent: stepMap.has("smoke:browser"),
      meaning: browserSkipped
        ? "smoke-all CI intentionally skips browser gate"
        : "browser gate executes in this smoke-all mode",
    },
  });

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
  const runnerCheck = checkMap.get("ui_runner_guard_semantics") || null;
  const bootstrapCheck = checkMap.get("ui_bootstrap_semantics") || null;
  const keychainCheck = checkMap.get("ui_keychain_migration_semantics") || null;
  const housekeepingCheck = checkMap.get("ui_housekeeping_semantics") || null;
  const recoveryBundleCheck = checkMap.get("dom_recovery_bundle_semantics") || null;
  const recoveryRehearsalCheck = checkMap.get("dom_recovery_rehearsal_semantics") || null;
  const setupPackageCheck = checkMap.get("dom_setup_package_semantics") || null;
  const setupCheck = checkMap.get("dom_device_setup_preview_semantics") || null;
  const browserSummary = `BrowserSkip=${gate.browserSkipped === true ? "expected" : "off"}`;
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
  const uiResult = stepMap.get("smoke:ui:operational")?.result || null;
  const domResult = stepMap.get("smoke:dom:operational")?.result || null;
  const operationalStepObserved =
    stepMap.has("smoke:ui:operational") || stepMap.has("smoke:dom:operational");
  const checks = [];
  const hasCheck = (checkName) => checks.some((entry) => entry.check === checkName);

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

  if (operationalStepObserved) {
    for (const [check, details] of [
      [
        "ui_setup_package_persistence_semantics",
        {
          expected: uiResult?.setupPackagePersistenceExpected ?? null,
          runMode: "missing",
          persistedPackageId: null,
          embeddedProfileCount: null,
        },
      ],
      [
        "ui_local_reasoner_restore_semantics",
        {
          expected: uiResult?.localReasonerRestoreExpected ?? null,
          runMode: "missing",
          restoredProfileId: null,
          warmStatus: null,
        },
      ],
    ]) {
      if (!hasCheck(check)) {
        checks.push({
          check,
          passed: false,
          details,
        });
      }
    }
  }

  if (operationalStepObserved) {
    for (const [check, details] of [
      [
        "dom_setup_package_persistence_semantics",
        {
          expected: domResult?.setupPackagePersistenceExpected ?? null,
          runMode: "missing",
          persistedPackageId: null,
          embeddedProfileCount: null,
          prunedDeletedCount: null,
        },
      ],
      [
        "dom_local_reasoner_restore_semantics",
        {
          expected: domResult?.localReasonerRestoreExpected ?? null,
          runMode: "missing",
          restoredProfileId: null,
          warmStatus: null,
        },
      ],
      [
        "dom_housekeeping_apply_semantics",
        {
          expected: domResult?.housekeepingApplyExpected ?? null,
          runMode: "missing",
          recoveryDeleteCount: null,
          readSessionRevokeCount: null,
          setupDeleteCount: null,
        },
      ],
    ]) {
      if (!hasCheck(check)) {
        checks.push({
          check,
          passed: false,
          details,
        });
      }
    }
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

function hasOwnRuntimeField(value = null, key = "") {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function toRuntimeRiskMetric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function runtimeRiskMetricsMatch(left, right) {
  const normalizedLeft = toRuntimeRiskMetric(left);
  const normalizedRight = toRuntimeRiskMetric(right);
  if (normalizedLeft == null || normalizedRight == null) {
    return normalizedLeft == null && normalizedRight == null;
  }
  return Math.abs(normalizedLeft - normalizedRight) <= 0.001;
}

function hasRuntimeTruthText(value) {
  return normalizeSemanticsText(value).length > 0;
}

function hasRuntimeTruthTextList(values) {
  return Array.isArray(values) && values.some((entry) => hasRuntimeTruthText(entry));
}

function hasActiveMemoryCorrectionLevel(value) {
  return ["light", "mild", "medium", "strong"].includes(normalizeSemanticsText(value));
}

export function summarizeRuntimeEvidenceSemantics(stepResults = []) {
  const stepMap = new Map((Array.isArray(stepResults) ? stepResults : []).map((step) => [step.name, step]));
  const uiResult = stepMap.get("smoke:ui:operational")?.result || null;
  const operationalStepObserved =
    stepMap.has("smoke:ui:operational") || stepMap.has("smoke:dom:operational");
  const checks = [];
  const hasCheck = (checkName) => checks.some((entry) => entry.check === checkName);

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

  if (
    uiResult &&
    (hasOwnRuntimeField(uiResult, "qualityEscalationRuns") ||
      hasOwnRuntimeField(uiResult, "latestQualityEscalationActivated") ||
      hasOwnRuntimeField(uiResult, "latestQualityEscalationProvider") ||
      hasOwnRuntimeField(uiResult, "latestQualityEscalationReason"))
  ) {
    const qualityEscalationRuns = Number(uiResult.qualityEscalationRuns || 0);
    const qualityIssue =
      uiResult.latestQualityEscalationActivated === true ||
      uiResult.latestQualityEscalationReason === "online_not_allowed";
    checks.push({
      check: "ui_quality_escalation_truth_semantics",
      passed:
        Number.isFinite(Number(uiResult.qualityEscalationRuns)) &&
        (!qualityIssue ||
          (uiResult.latestQualityEscalationActivated === true
            ? qualityEscalationRuns >= 1 &&
              typeof uiResult.latestQualityEscalationProvider === "string" &&
              uiResult.latestQualityEscalationProvider.length > 0 &&
              typeof uiResult.latestQualityEscalationReason === "string" &&
              uiResult.latestQualityEscalationReason.length > 0
            : typeof uiResult.latestQualityEscalationReason === "string" &&
              uiResult.latestQualityEscalationReason.length > 0)),
      details: {
        qualityEscalationRuns: uiResult.qualityEscalationRuns ?? null,
        latestQualityEscalationActivated: uiResult.latestQualityEscalationActivated ?? null,
        latestQualityEscalationProvider: uiResult.latestQualityEscalationProvider ?? null,
        latestQualityEscalationReason: uiResult.latestQualityEscalationReason ?? null,
      },
    });
  }

  if (
    uiResult &&
    (hasOwnRuntimeField(uiResult, "memoryStabilityStateCount") ||
      hasOwnRuntimeField(uiResult, "latestMemoryStabilityStateId") ||
      hasOwnRuntimeField(uiResult, "latestMemoryStabilityCorrectionLevel") ||
      hasOwnRuntimeField(uiResult, "latestMemoryStabilityRiskScore") ||
      hasOwnRuntimeField(uiResult, "latestMemoryStabilityUpdatedAt") ||
      hasOwnRuntimeField(uiResult, "latestMemoryStabilityObservationKind") ||
      hasOwnRuntimeField(uiResult, "latestMemoryStabilityRecoverySignal") ||
      hasOwnRuntimeField(uiResult, "latestMemoryStabilityCorrectionActions") ||
      hasOwnRuntimeField(uiResult, "memoryStabilityRecoveryRate"))
  ) {
    const stateCount = Number(uiResult.memoryStabilityStateCount || 0);
    const correctionActive = hasActiveMemoryCorrectionLevel(uiResult.latestMemoryStabilityCorrectionLevel);
    checks.push({
      check: "ui_memory_stability_truth_semantics",
      passed:
        Number.isFinite(Number(uiResult.memoryStabilityStateCount)) &&
        (stateCount === 0 ||
          (hasRuntimeTruthText(uiResult.latestMemoryStabilityStateId) &&
            hasRuntimeTruthText(uiResult.latestMemoryStabilityCorrectionLevel) &&
            Number.isFinite(Number(uiResult.latestMemoryStabilityRiskScore)) &&
            hasRuntimeTruthText(uiResult.latestMemoryStabilityUpdatedAt) &&
            hasRuntimeTruthText(uiResult.latestMemoryStabilityObservationKind) &&
            (!correctionActive ||
              (hasRuntimeTruthTextList(uiResult.latestMemoryStabilityCorrectionActions) &&
                Number.isFinite(Number(uiResult.memoryStabilityRecoveryRate)))))),
      details: {
        memoryStabilityStateCount: uiResult.memoryStabilityStateCount ?? null,
        latestMemoryStabilityStateId: uiResult.latestMemoryStabilityStateId ?? null,
        latestMemoryStabilityCorrectionLevel: uiResult.latestMemoryStabilityCorrectionLevel ?? null,
        latestMemoryStabilityRiskScore: uiResult.latestMemoryStabilityRiskScore ?? null,
        latestMemoryStabilitySignalSource: uiResult.latestRunMemoryStabilitySignalSource ?? null,
        latestMemoryStabilityPreflightStatus: uiResult.latestRunMemoryStabilityPreflightStatus ?? null,
        latestMemoryStabilityUpdatedAt: uiResult.latestMemoryStabilityUpdatedAt ?? null,
        latestMemoryStabilityObservationKind: uiResult.latestMemoryStabilityObservationKind ?? null,
        latestMemoryStabilityRecoverySignal: uiResult.latestMemoryStabilityRecoverySignal ?? null,
        latestMemoryStabilityCorrectionActions: uiResult.latestMemoryStabilityCorrectionActions ?? null,
        memoryStabilityRecoveryRate: uiResult.memoryStabilityRecoveryRate ?? null,
      },
    });
  }

  if (
    uiResult &&
    (hasOwnRuntimeField(uiResult, "memoryStabilityStateCount") ||
      hasOwnRuntimeField(uiResult, "runtimeStabilityStateCount") ||
      hasOwnRuntimeField(uiResult, "runtimeStabilityLatestStateId"))
  ) {
    const memoryCount = Number(uiResult.memoryStabilityStateCount || 0);
    checks.push({
      check: "ui_memory_stability_consistency_semantics",
      passed:
        Number.isFinite(Number(uiResult.memoryStabilityStateCount)) &&
        Number.isFinite(Number(uiResult.runtimeStabilityStateCount)) &&
        Number(uiResult.memoryStabilityStateCount) === Number(uiResult.runtimeStabilityStateCount) &&
        (memoryCount === 0 ||
          (uiResult.latestMemoryStabilityStateId === uiResult.runtimeStabilityLatestStateId &&
            uiResult.latestMemoryStabilityCorrectionLevel === uiResult.runtimeStabilityLatestCorrectionLevel &&
            runtimeRiskMetricsMatch(
              uiResult.latestMemoryStabilityRiskScore,
              uiResult.runtimeStabilityLatestRiskScore
            ))),
      details: {
        memoryStabilityStateCount: uiResult.memoryStabilityStateCount ?? null,
        runtimeStabilityStateCount: uiResult.runtimeStabilityStateCount ?? null,
        latestMemoryStabilityStateId: uiResult.latestMemoryStabilityStateId ?? null,
        runtimeStabilityLatestStateId: uiResult.runtimeStabilityLatestStateId ?? null,
        latestMemoryStabilityCorrectionLevel: uiResult.latestMemoryStabilityCorrectionLevel ?? null,
        runtimeStabilityLatestCorrectionLevel: uiResult.runtimeStabilityLatestCorrectionLevel ?? null,
        latestMemoryStabilityRiskScore: uiResult.latestMemoryStabilityRiskScore ?? null,
        runtimeStabilityLatestRiskScore: uiResult.runtimeStabilityLatestRiskScore ?? null,
      },
    });
  }

  if (
    uiResult &&
    (hasOwnRuntimeField(uiResult, "latestRunMemoryStabilityCorrectionLevel") ||
      hasOwnRuntimeField(uiResult, "latestMemoryStabilityCorrectionLevel") ||
      hasOwnRuntimeField(uiResult, "latestRunMemoryStabilityRiskScore"))
  ) {
    checks.push({
      check: "ui_runner_memory_truth_consistency_semantics",
      passed:
        uiResult.latestRunMemoryStabilityCorrectionLevel == null ||
        (uiResult.latestRunMemoryStabilityCorrectionLevel === uiResult.latestMemoryStabilityCorrectionLevel &&
          runtimeRiskMetricsMatch(
            uiResult.latestRunMemoryStabilityRiskScore,
            uiResult.latestMemoryStabilityRiskScore
          )),
      details: {
        latestRunMemoryStabilityCorrectionLevel: uiResult.latestRunMemoryStabilityCorrectionLevel ?? null,
        latestMemoryStabilityCorrectionLevel: uiResult.latestMemoryStabilityCorrectionLevel ?? null,
        latestRunMemoryStabilityRiskScore: uiResult.latestRunMemoryStabilityRiskScore ?? null,
        latestMemoryStabilityRiskScore: uiResult.latestMemoryStabilityRiskScore ?? null,
        latestRunMemoryStabilitySignalSource: uiResult.latestRunMemoryStabilitySignalSource ?? null,
        latestRunMemoryStabilityPreflightStatus: uiResult.latestRunMemoryStabilityPreflightStatus ?? null,
      },
    });
  }

  if (
    uiResult &&
    (Object.prototype.hasOwnProperty.call(uiResult, "autoRecoveryResumed") ||
      Object.prototype.hasOwnProperty.call(uiResult, "autoRecoveryResumeStatus") ||
      Object.prototype.hasOwnProperty.call(uiResult, "autoRecoveryResumeChainLength"))
  ) {
    checks.push({
      check: "ui_auto_recovery_resume_semantics",
      passed:
        uiResult.autoRecoveryResumed === true &&
        uiResult.autoRecoveryResumeStatus === "resumed" &&
        Number(uiResult.autoRecoveryResumeChainLength || 0) >= 2,
      details: {
        autoRecoveryResumed: uiResult.autoRecoveryResumed ?? null,
        resumeStatus: uiResult.autoRecoveryResumeStatus ?? null,
        resumeChainLength: uiResult.autoRecoveryResumeChainLength ?? null,
      },
    });
  }

  if (
    uiResult &&
    (Object.prototype.hasOwnProperty.call(uiResult, "retryWithoutExecutionResumeStatus") ||
      Object.prototype.hasOwnProperty.call(uiResult, "retryWithoutExecutionResumeChainLength"))
  ) {
    checks.push({
      check: "ui_retry_without_execution_resume_semantics",
      passed:
        uiResult.retryWithoutExecutionResumeStatus === "resumed" &&
        Number(uiResult.retryWithoutExecutionResumeChainLength || 0) >= 2,
      details: {
        resumeStatus: uiResult.retryWithoutExecutionResumeStatus ?? null,
        resumeChainLength: uiResult.retryWithoutExecutionResumeChainLength ?? null,
      },
    });
  }

  if (operationalStepObserved) {
    for (const [check, details] of [
      [
        "ui_local_reasoner_lifecycle_semantics",
        {
          runMode: "missing",
          configuredStatus: null,
          catalogProviderCount: null,
          probeStatus: null,
          selectedProvider: null,
          prewarmStatus: null,
          observedProfileCount: null,
          observedRestoreCandidateCount: null,
        },
      ],
      [
        "ui_conversation_memory_semantics",
        {
          runMode: "missing",
          minuteId: null,
          observedMinuteCount: null,
          transcriptEntryCount: null,
          transcriptBlockCount: null,
          runtimeSearchHits: null,
        },
      ],
      [
        "ui_sandbox_audit_semantics",
        {
          runMode: "missing",
          observedAuditCount: null,
          sandboxSearchHits: null,
          sandboxListEntries: null,
        },
      ],
      [
        "ui_execution_history_semantics",
        {
          runMode: "missing",
          verificationStatus: null,
          observedVerificationHistoryCount: null,
          runnerStatus: null,
          observedRunnerHistoryCount: null,
        },
      ],
      [
        "ui_quality_escalation_truth_semantics",
        {
          qualityEscalationRuns: null,
          latestQualityEscalationActivated: null,
          latestQualityEscalationProvider: null,
          latestQualityEscalationReason: null,
        },
      ],
      [
        "ui_memory_stability_truth_semantics",
        {
          memoryStabilityStateCount: null,
          latestMemoryStabilityStateId: null,
          latestMemoryStabilityCorrectionLevel: null,
          latestMemoryStabilityRiskScore: null,
          latestMemoryStabilitySignalSource: null,
          latestMemoryStabilityPreflightStatus: null,
          latestMemoryStabilityUpdatedAt: null,
          latestMemoryStabilityObservationKind: null,
          latestMemoryStabilityRecoverySignal: null,
          latestMemoryStabilityCorrectionActions: null,
          memoryStabilityRecoveryRate: null,
        },
      ],
      [
        "ui_memory_stability_consistency_semantics",
        {
          memoryStabilityStateCount: null,
          runtimeStabilityStateCount: null,
          latestMemoryStabilityStateId: null,
          runtimeStabilityLatestStateId: null,
          latestMemoryStabilityCorrectionLevel: null,
          runtimeStabilityLatestCorrectionLevel: null,
          latestMemoryStabilityRiskScore: null,
          runtimeStabilityLatestRiskScore: null,
        },
      ],
      [
        "ui_runner_memory_truth_consistency_semantics",
        {
          latestRunMemoryStabilityCorrectionLevel: null,
          latestMemoryStabilityCorrectionLevel: null,
          latestRunMemoryStabilityRiskScore: null,
          latestMemoryStabilityRiskScore: null,
          latestRunMemoryStabilitySignalSource: null,
          latestRunMemoryStabilityPreflightStatus: null,
        },
      ],
      [
        "ui_auto_recovery_resume_semantics",
        {
          autoRecoveryResumed: null,
          resumeStatus: null,
          resumeChainLength: null,
        },
      ],
      [
        "ui_retry_without_execution_resume_semantics",
        {
          resumeStatus: null,
          resumeChainLength: null,
        },
      ],
    ]) {
      if (!hasCheck(check)) {
        checks.push({
          check,
          passed: false,
          details,
        });
      }
    }
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
    ["ui_quality_escalation_truth_semantics", "UIQualityEscalation", "qualityEscalationRuns"],
    ["ui_memory_stability_truth_semantics", "UIMemoryStability", "memoryStabilityStateCount"],
    ["ui_memory_stability_consistency_semantics", "UIMemoryConsistency", "runtimeStabilityStateCount"],
    ["ui_runner_memory_truth_consistency_semantics", "UIRunnerMemory", "latestRunMemoryStabilityCorrectionLevel"],
    ["ui_auto_recovery_resume_semantics", "UIAutoRecovery", "resumeChainLength"],
    ["ui_retry_without_execution_resume_semantics", "UIRetryNoExec", "resumeChainLength"],
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

export function summarizeBrowserUiSemantics(stepResults = [], { browserSkipped = false } = {}) {
  if (browserSkipped) {
    return {
      status: "skipped",
      browserSkipped: true,
      passedChecks: 0,
      totalChecks: 0,
      failedChecks: [],
      checks: [],
    };
  }

  const stepMap = new Map((Array.isArray(stepResults) ? stepResults : []).map((step) => [step.name, step]));
  const browserResult = stepMap.get("smoke:browser")?.result || null;
  if (!browserResult) {
    return {
      status: "unavailable",
      browserSkipped: false,
      passedChecks: 0,
      totalChecks: 0,
      failedChecks: [],
      checks: [],
    };
  }

  const checks = [];
  const operatorTruth = browserResult?.operatorSummary?.truthState || null;
  const operatorExport = browserResult?.operatorSummary?.exportState || null;
  const labApiSecurityTruth = browserResult?.labSummary?.apiSecurityTruth || null;
  const incidentPacketTruth = browserResult?.operatorSummary?.incidentPacketState || null;
  const operatorUiHistoryEntries = Array.isArray(operatorExport?.exportHistoryEntries)
    ? operatorExport.exportHistoryEntries
    : [];
  const matchedOperatorUiExportRecord =
    operatorUiHistoryEntries.find(
      (entry) =>
        normalizeSemanticsText(entry?.evidenceRefId) ===
        normalizeSemanticsText(operatorExport?.exportRecord?.evidenceRefId)
    ) || null;
  const offlineChatStartupTruth = browserResult?.offlineChatGroupFixture?.startupTruth || null;
  const offlineChatGroupParticipantNames = Array.isArray(browserResult.offlineChatGroupFixture?.participantNames)
    ? browserResult.offlineChatGroupFixture.participantNames.filter(Boolean)
    : [];

  const hasFailureSemanticsEnvelope = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const status = String(value.status || "");
    const failures = Array.isArray(value.failures) ? value.failures : null;
    const failureCount = Number(value.failureCount);
    if (!["clear", "present"].includes(status) || !failures || !Number.isFinite(failureCount)) {
      return false;
    }
    if (failureCount !== failures.length) {
      return false;
    }
    if (status === "clear") {
      return failureCount === 0 && value.primaryFailure == null;
    }
    return (
      failureCount >= 1 &&
      value.primaryFailure &&
      typeof value.primaryFailure === "object" &&
      typeof value.primaryFailure.code === "string" &&
      value.primaryFailure.code.length > 0 &&
      typeof value.primaryFailure.machineAction === "string" &&
      value.primaryFailure.machineAction.length > 0 &&
      typeof value.primaryFailure.operatorAction === "string" &&
      value.primaryFailure.operatorAction.length > 0
    );
  };
  const hasStructuredGuard = (summary, expectations = {}) => {
    const guard = summary?.guard;
    if (!guard || typeof guard !== "object" || Array.isArray(guard)) {
      return false;
    }
    return Object.entries(expectations).every(([key, expected]) => guard[key] === expected);
  };
  const summarizeFailureSemanticsDetails = (value = null) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return {
      status: value.status ?? null,
      failureCount: Number.isFinite(Number(value.failureCount)) ? Number(value.failureCount) : null,
      primaryFailure: value.primaryFailure ?? null,
      failures: Array.isArray(value.failures) ? value.failures : [],
    };
  };
  const hasStructuredIncidentExport = (exportState = null) => {
    const apiExport = exportState?.apiExport;
    const exportCoverage = apiExport?.exportCoverage;
    const exportRecord = apiExport?.exportRecord;
    const uiExportRecord = exportState?.exportRecord;
    const uiHistoryEntries = Array.isArray(exportState?.exportHistoryEntries) ? exportState.exportHistoryEntries : [];
    const uiRecordIds = Array.isArray(exportState?.exportHistoryRecordIds) ? exportState.exportHistoryRecordIds : [];
    const uiUris = Array.isArray(exportState?.exportHistoryUris) ? exportState.exportHistoryUris : [];
    const uiMatchedExportRecord = uiHistoryEntries.find(
      (entry) => normalizeSemanticsText(entry?.evidenceRefId) === normalizeSemanticsText(uiExportRecord?.evidenceRefId)
    );
    const tags = Array.isArray(exportRecord?.tags) ? exportRecord.tags : [];
    const hasOwn = (value, key) => Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
    const rawUiResolvedResidentAgentId = normalizeSemanticsText(uiExportRecord?.resolvedResidentAgentId);
    const rawApiResolvedResidentAgentId = normalizeSemanticsText(apiExport?.resolvedResidentAgentId);
    const rawApiRecordResolvedResidentAgentId = normalizeSemanticsText(exportRecord?.resolvedResidentAgentId);
    const rawMatchedUiResolvedResidentAgentId = normalizeSemanticsText(uiMatchedExportRecord?.resolvedResidentAgentId);
    const rawHistoryResolvedResidentAgentId = normalizeSemanticsText(apiExport?.historyResolvedResidentAgentId);
    return (
      typeof uiExportRecord?.evidenceRefId === "string" &&
      uiExportRecord.evidenceRefId.length > 0 &&
      uiExportRecord.title === "事故交接包导出" &&
      typeof uiExportRecord.uri === "string" &&
      uiExportRecord.uri.startsWith("incident-packet://export/") &&
      typeof uiExportRecord.recordedAt === "string" &&
      uiExportRecord.recordedAt.length > 0 &&
      typeof uiExportRecord.residentAgentReference === "string" &&
      uiExportRecord.residentAgentReference.length > 0 &&
      hasOwn(uiExportRecord, "resolvedResidentAgentId") &&
      uiRecordIds.includes(uiExportRecord.evidenceRefId) &&
      uiUris.includes(uiExportRecord.uri) &&
      Boolean(apiExport) &&
      apiExport.sourceSurface === "/api/security/incident-packet/export" &&
      typeof apiExport.residentAgentId === "string" &&
      apiExport.residentAgentId.length > 0 &&
      typeof apiExport.residentAgentReference === "string" &&
      apiExport.residentAgentReference.length > 0 &&
      hasOwn(apiExport, "resolvedResidentAgentId") &&
      typeof apiExport.exportedAt === "string" &&
      apiExport.exportedAt.length > 0 &&
      exportCoverage?.protectedRead === true &&
      exportCoverage?.residentAgentBound === true &&
      Array.isArray(exportCoverage?.missingSections) &&
      exportCoverage.missingSections.length === 0 &&
      typeof exportRecord?.evidenceRefId === "string" &&
      exportRecord.evidenceRefId.length > 0 &&
      exportRecord.agentId === apiExport.residentAgentId &&
      exportRecord.residentAgentReference === apiExport.residentAgentReference &&
      hasOwn(exportRecord, "resolvedResidentAgentId") &&
      rawApiRecordResolvedResidentAgentId === rawApiResolvedResidentAgentId &&
      exportRecord.kind === "note" &&
      exportRecord.title === "事故交接包导出" &&
      typeof exportRecord.uri === "string" &&
      exportRecord.uri.startsWith("incident-packet://export/") &&
      tags.includes("incident-packet-export") &&
      tags.includes("operator") &&
      tags.includes("security") &&
      apiExport.historyResidentAgentId === apiExport.residentAgentId &&
      apiExport.historyResidentAgentReference === apiExport.residentAgentReference &&
      hasOwn(apiExport, "historyResolvedResidentAgentId") &&
      rawHistoryResolvedResidentAgentId === rawApiResolvedResidentAgentId &&
      apiExport.historyMatchedExportResidentAgentReference === true &&
      apiExport.historyMatchedExportResolvedResidentAgentId === true &&
      Boolean(uiMatchedExportRecord) &&
      normalizeSemanticsText(uiMatchedExportRecord?.uri) === normalizeSemanticsText(uiExportRecord?.uri) &&
      normalizeSemanticsText(uiMatchedExportRecord?.residentAgentReference) ===
        normalizeSemanticsText(uiExportRecord?.residentAgentReference) &&
      hasOwn(uiMatchedExportRecord, "resolvedResidentAgentId") &&
      rawMatchedUiResolvedResidentAgentId === rawUiResolvedResidentAgentId &&
      rawUiResolvedResidentAgentId === rawApiResolvedResidentAgentId &&
      typeof uiMatchedExportRecord?.effectivePhysicalResidentAgentId === "string" &&
      uiMatchedExportRecord.effectivePhysicalResidentAgentId.length > 0 &&
      typeof uiMatchedExportRecord?.effectiveResolvedResidentAgentId === "string" &&
      uiMatchedExportRecord.effectiveResolvedResidentAgentId.length > 0 &&
      uiMatchedExportRecord?.residentBindingMismatch === false &&
      apiExport.historyMatchedExportRecord === true
    );
  };

  checks.push({
    check: "browser_runtime_home_truth_semantics",
    passed:
      browserResult.mainSummary?.runtimeTruthReady === true &&
      Array.isArray(browserResult.mainSummary?.runtimeTruthMissingFields) &&
      browserResult.mainSummary.runtimeTruthMissingFields.length === 0 &&
      isLoadedRuntimeHomeSummary(browserResult.mainSummary) &&
      matchesCanonicalRuntimeEntryHrefs(browserResult.mainSummary?.runtimeLinks) &&
      browserResult.mainSummary?.repairHubHref === "/repair-hub",
    details: {
      runtimeTruthReady: browserResult.mainSummary?.runtimeTruthReady ?? null,
      runtimeTruthMissingFields: Array.isArray(browserResult.mainSummary?.runtimeTruthMissingFields)
        ? browserResult.mainSummary.runtimeTruthMissingFields
        : null,
      loadState: browserResult.mainSummary?.loadState ?? null,
      homeSummary: browserResult.mainSummary?.homeSummary ?? null,
      healthSummary: browserResult.mainSummary?.healthSummary ?? null,
      recoverySummary: browserResult.mainSummary?.recoverySummary ?? null,
      automationSummary: browserResult.mainSummary?.automationSummary ?? null,
      runtimeLinkCount: Array.isArray(browserResult.mainSummary?.runtimeLinks)
        ? browserResult.mainSummary.runtimeLinks.length
        : null,
      runtimeLinks: Array.isArray(browserResult.mainSummary?.runtimeLinks)
        ? browserResult.mainSummary.runtimeLinks
        : null,
      repairHubHref: browserResult.mainSummary?.repairHubHref ?? null,
    },
  });

  checks.push({
    check: "browser_lab_truth_semantics",
    passed:
      browserResult.labSummary?.labTruthReady === true &&
      Array.isArray(browserResult.labSummary?.labTruthMissingFields) &&
      browserResult.labSummary.labTruthMissingFields.length === 0 &&
      typeof browserResult.labSummary?.summary === "string" &&
      browserResult.labSummary.summary.length > 0 &&
      Array.isArray(browserResult.labSummary?.localStoreDetails) &&
      browserResult.labSummary.localStoreDetails.length >= 3 &&
      Array.isArray(browserResult.labSummary?.formalRecoveryDetails) &&
      browserResult.labSummary.formalRecoveryDetails.length >= 3 &&
      Array.isArray(browserResult.labSummary?.automaticRecoveryDetails) &&
      browserResult.labSummary.automaticRecoveryDetails.length >= 3,
    details: {
      labTruthReady: browserResult.labSummary?.labTruthReady ?? null,
      labTruthMissingFields: Array.isArray(browserResult.labSummary?.labTruthMissingFields)
        ? browserResult.labSummary.labTruthMissingFields
        : null,
      summary: browserResult.labSummary?.summary ?? null,
      localStoreDetailCount: Array.isArray(browserResult.labSummary?.localStoreDetails)
        ? browserResult.labSummary.localStoreDetails.length
        : null,
      formalRecoveryDetailCount: Array.isArray(browserResult.labSummary?.formalRecoveryDetails)
        ? browserResult.labSummary.formalRecoveryDetails.length
        : null,
      automaticRecoveryDetailCount: Array.isArray(browserResult.labSummary?.automaticRecoveryDetails)
        ? browserResult.labSummary.automaticRecoveryDetails.length
        : null,
    },
  });

  checks.push({
    check: "browser_lab_failure_semantics_truth_chain",
    passed:
      Number(labApiSecurityTruth?.status || 0) === 200 &&
      labApiSecurityTruth?.authorized === false &&
      hasFailureSemanticsEnvelope(labApiSecurityTruth?.releaseReadinessFailureSemantics) &&
      hasFailureSemanticsEnvelope(labApiSecurityTruth?.automaticRecoveryFailureSemantics),
    details: {
      status: labApiSecurityTruth?.status ?? null,
      authorized: labApiSecurityTruth?.authorized ?? null,
      releaseStatus: labApiSecurityTruth?.releaseReadinessFailureSemantics?.status ?? null,
      automaticStatus: labApiSecurityTruth?.automaticRecoveryFailureSemantics?.status ?? null,
    },
  });

  checks.push({
    check: "browser_lab_invalid_token_guard_semantics",
    passed: hasStructuredGuard(browserResult.labInvalidTokenSummary, {
      authBlocked: true,
      blockedSurface: "/api/security/runtime-housekeeping",
      actionBlocked: true,
      lastReportPreserved: true,
    }),
    details: {
      guard: browserResult.labInvalidTokenSummary?.guard ?? null,
      authSummary: browserResult.labInvalidTokenSummary?.authSummary ?? null,
      status: browserResult.labInvalidTokenSummary?.status ?? null,
      lastReport: browserResult.labInvalidTokenSummary?.lastReport ?? null,
    },
  });

  checks.push({
    check: "browser_operator_truth_and_export_semantics",
    passed:
      Boolean(operatorTruth) &&
      browserResult.operatorSummary?.operatorTruthReady === true &&
      Array.isArray(browserResult.operatorSummary?.operatorTruthMissingFields) &&
      browserResult.operatorSummary.operatorTruthMissingFields.length === 0 &&
      String(operatorTruth?.authSummary || "").length > 0 &&
      String(operatorTruth?.protectedStatus || "").length > 0 &&
      String(operatorTruth?.agentRuntimeTitle || "").length > 0 &&
      Number(operatorTruth?.agentRuntimeDetailCount || 0) >= 1 &&
      Number(operatorTruth?.decisionCardCount || 0) >= 4 &&
      operatorTruth?.exportDisabled === false &&
      operatorTruth?.mainLinkHref === `${browserResult.baseUrl}/` &&
      String(operatorExport?.exportStatus || "").startsWith("事故交接包已导出并留档：agent-passport-incident-packet-") &&
      Number(operatorExport?.exportHistoryCount || 0) >= 1 &&
      operatorExport?.exportContentsHasAgentRuntimeTruth === true &&
      Array.isArray(operatorExport?.apiExport?.exportCoverage?.includedSections) &&
      operatorExport.apiExport.exportCoverage.includedSections.includes("agent_runtime_truth") &&
      hasStructuredIncidentExport(operatorExport),
    details: {
      operatorTruthReady: browserResult.operatorSummary?.operatorTruthReady ?? null,
      operatorTruthMissingFields: Array.isArray(browserResult.operatorSummary?.operatorTruthMissingFields)
        ? browserResult.operatorSummary.operatorTruthMissingFields
        : null,
      truthCaptured: Boolean(operatorTruth),
      agentRuntimeTitle: operatorTruth?.agentRuntimeTitle ?? null,
      agentRuntimeDetailCount: operatorTruth?.agentRuntimeDetailCount ?? null,
      decisionCardCount: operatorTruth?.decisionCardCount ?? null,
      exportStatus: operatorExport?.exportStatus ?? null,
      exportHistoryCount: operatorExport?.exportHistoryCount ?? null,
      exportContentsHasAgentRuntimeTruth: operatorExport?.exportContentsHasAgentRuntimeTruth ?? null,
      uiExportRecord: operatorExport?.exportRecord ?? null,
      uiMatchedExportRecord: matchedOperatorUiExportRecord,
      apiExportRecord: operatorExport?.apiExport?.exportRecord ?? null,
      uiExportRecordId: operatorExport?.exportRecord?.evidenceRefId ?? null,
      uiExportHistoryRecordIds: Array.isArray(operatorExport?.exportHistoryRecordIds)
        ? operatorExport.exportHistoryRecordIds
        : null,
      exportRecordId: operatorExport?.apiExport?.exportRecord?.evidenceRefId ?? null,
      uiExportEffectivePhysicalResidentAgentIds: Array.isArray(operatorExport?.exportHistoryEffectivePhysicalResidentAgentIds)
        ? operatorExport.exportHistoryEffectivePhysicalResidentAgentIds
        : null,
      uiExportResidentBindingMismatches: Array.isArray(operatorExport?.exportHistoryResidentBindingMismatches)
        ? operatorExport.exportHistoryResidentBindingMismatches
        : null,
      uiMatchedExportResidentBindingMismatch: matchedOperatorUiExportRecord?.residentBindingMismatch ?? null,
      uiMatchedExportPhysicalResidentAgentId: matchedOperatorUiExportRecord?.physicalResidentAgentId ?? null,
      uiMatchedExportResidentAgentReference: matchedOperatorUiExportRecord?.residentAgentReference ?? null,
      uiMatchedExportResolvedResidentAgentId: matchedOperatorUiExportRecord?.resolvedResidentAgentId ?? null,
      uiMatchedExportEffectivePhysicalResidentAgentId:
        matchedOperatorUiExportRecord?.effectivePhysicalResidentAgentId ?? null,
      uiMatchedExportEffectiveResidentAgentReference:
        matchedOperatorUiExportRecord?.effectiveResidentAgentReference ?? null,
      uiMatchedExportEffectiveResolvedResidentAgentId:
        matchedOperatorUiExportRecord?.effectiveResolvedResidentAgentId ?? null,
      residentAgentReference: operatorExport?.apiExport?.residentAgentReference ?? null,
      resolvedResidentAgentId: operatorExport?.apiExport?.resolvedResidentAgentId ?? null,
      historyResidentAgentReference: operatorExport?.apiExport?.historyResidentAgentReference ?? null,
      historyResolvedResidentAgentId: operatorExport?.apiExport?.historyResolvedResidentAgentId ?? null,
      exportCoverage: operatorExport?.apiExport?.exportCoverage ?? null,
      historyMatchedExportRecord: operatorExport?.apiExport?.historyMatchedExportRecord ?? null,
      mainLinkHref: operatorTruth?.mainLinkHref ?? null,
    },
  });

  checks.push({
    check: "browser_operator_incident_packet_truth_semantics",
    passed:
      Number(incidentPacketTruth?.status || 0) === 200 &&
      incidentPacketTruth?.format === "agent-passport-incident-packet-v1" &&
      hasFailureSemanticsEnvelope(incidentPacketTruth?.snapshotReleaseReadinessFailureSemantics) &&
      hasFailureSemanticsEnvelope(incidentPacketTruth?.boundaryReleaseReadinessFailureSemantics) &&
      hasFailureSemanticsEnvelope(incidentPacketTruth?.boundaryAutomaticRecoveryFailureSemantics) &&
      JSON.stringify(incidentPacketTruth?.boundaryAgentRuntime ?? null) ===
        JSON.stringify(incidentPacketTruth?.snapshotAgentRuntime ?? null) &&
      typeof incidentPacketTruth?.boundaryAgentRuntime?.localFirst === "boolean" &&
      Number.isFinite(Number(incidentPacketTruth?.boundaryAgentRuntime?.qualityEscalationRuns)) &&
      (incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardActivated !== true ||
        (String(incidentPacketTruth?.boundaryAgentRuntime?.latestRunStatus || "").length > 0 &&
          String(incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardBlockedBy || "").length > 0 &&
          String(incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardCode || "").length > 0 &&
          String(incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardStage || "").length > 0 &&
          String(incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardReceiptStatus || "").length > 0 &&
          Array.isArray(incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardExplicitRequestKinds) &&
          incidentPacketTruth.boundaryAgentRuntime.latestRunnerGuardExplicitRequestKinds.length > 0)) &&
      (Number(incidentPacketTruth?.boundaryAgentRuntime?.qualityEscalationRuns || 0) === 0 ||
        String(incidentPacketTruth?.boundaryAgentRuntime?.latestQualityEscalationReason || "").length > 0) &&
      (incidentPacketTruth?.boundaryAgentRuntime?.latestQualityEscalationActivated !== true ||
        String(incidentPacketTruth?.boundaryAgentRuntime?.latestQualityEscalationProvider || "").length > 0) &&
      Number.isFinite(Number(incidentPacketTruth?.boundaryAgentRuntime?.memoryStabilityStateCount)) &&
      (Number(incidentPacketTruth?.boundaryAgentRuntime?.memoryStabilityStateCount || 0) === 0 ||
        (String(incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityStateId || "").length > 0 &&
          String(incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityCorrectionLevel || "").length > 0 &&
          Number.isFinite(Number(incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityRiskScore)) &&
          String(incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityUpdatedAt || "").length > 0 &&
          String(incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityObservationKind || "").length > 0)) &&
      (!["light", "mild", "medium", "strong"].includes(
        String(incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityCorrectionLevel || "")
      ) ||
        (Array.isArray(incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityCorrectionActions) &&
          incidentPacketTruth.boundaryAgentRuntime.latestMemoryStabilityCorrectionActions.length > 0 &&
          Number.isFinite(Number(incidentPacketTruth?.boundaryAgentRuntime?.memoryStabilityRecoveryRate)))),
    details: {
      status: incidentPacketTruth?.status ?? null,
      format: incidentPacketTruth?.format ?? null,
      snapshotReleaseFailureSemantics: summarizeFailureSemanticsDetails(
        incidentPacketTruth?.snapshotReleaseReadinessFailureSemantics
      ),
      boundaryReleaseFailureSemantics: summarizeFailureSemanticsDetails(
        incidentPacketTruth?.boundaryReleaseReadinessFailureSemantics
      ),
      boundaryAutomaticFailureSemantics: summarizeFailureSemanticsDetails(
        incidentPacketTruth?.boundaryAutomaticRecoveryFailureSemantics
      ),
      snapshotReleaseStatus: incidentPacketTruth?.snapshotReleaseReadinessFailureSemantics?.status ?? null,
      boundaryReleaseStatus: incidentPacketTruth?.boundaryReleaseReadinessFailureSemantics?.status ?? null,
      boundaryAutomaticStatus: incidentPacketTruth?.boundaryAutomaticRecoveryFailureSemantics?.status ?? null,
      boundaryAgentRuntimeLocalFirst: incidentPacketTruth?.boundaryAgentRuntime?.localFirst ?? null,
      boundaryAgentRuntimeLatestRunStatus: incidentPacketTruth?.boundaryAgentRuntime?.latestRunStatus ?? null,
      boundaryAgentRuntimeLatestRunnerGuardActivated:
        incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardActivated ?? null,
      boundaryAgentRuntimeLatestRunnerGuardBlockedBy:
        incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardBlockedBy ?? null,
      boundaryAgentRuntimeLatestRunnerGuardCode:
        incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardCode ?? null,
      boundaryAgentRuntimeLatestRunnerGuardStage:
        incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardStage ?? null,
      boundaryAgentRuntimeLatestRunnerGuardReceiptStatus:
        incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardReceiptStatus ?? null,
      boundaryAgentRuntimeLatestRunnerGuardExplicitRequestKinds:
        incidentPacketTruth?.boundaryAgentRuntime?.latestRunnerGuardExplicitRequestKinds ?? null,
      boundaryAgentRuntimeQualityEscalationRuns:
        incidentPacketTruth?.boundaryAgentRuntime?.qualityEscalationRuns ?? null,
      boundaryAgentRuntimeLatestQualityEscalationActivated:
        incidentPacketTruth?.boundaryAgentRuntime?.latestQualityEscalationActivated ?? null,
      boundaryAgentRuntimeLatestQualityEscalationProvider:
        incidentPacketTruth?.boundaryAgentRuntime?.latestQualityEscalationProvider ?? null,
      boundaryAgentRuntimeLatestQualityEscalationReason:
        incidentPacketTruth?.boundaryAgentRuntime?.latestQualityEscalationReason ?? null,
      boundaryAgentRuntimeMemoryStabilityStateCount:
        incidentPacketTruth?.boundaryAgentRuntime?.memoryStabilityStateCount ?? null,
      boundaryAgentRuntimeLatestMemoryStabilityStateId:
        incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityStateId ?? null,
      boundaryAgentRuntimeLatestMemoryStabilityCorrectionLevel:
        incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityCorrectionLevel ?? null,
      boundaryAgentRuntimeLatestMemoryStabilityRiskScore:
        incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityRiskScore ?? null,
      boundaryAgentRuntimeLatestMemoryStabilityUpdatedAt:
        incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityUpdatedAt ?? null,
      boundaryAgentRuntimeLatestMemoryStabilityObservationKind:
        incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityObservationKind ?? null,
      boundaryAgentRuntimeLatestMemoryStabilityRecoverySignal:
        incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityRecoverySignal ?? null,
      boundaryAgentRuntimeLatestMemoryStabilityCorrectionActions:
        incidentPacketTruth?.boundaryAgentRuntime?.latestMemoryStabilityCorrectionActions ?? null,
      boundaryAgentRuntimeMemoryStabilityRecoveryRate:
        incidentPacketTruth?.boundaryAgentRuntime?.memoryStabilityRecoveryRate ?? null,
      snapshotAgentRuntime: incidentPacketTruth?.snapshotAgentRuntime ?? null,
    },
  });

  checks.push({
    check: "browser_operator_invalid_token_guard_semantics",
    passed: hasStructuredGuard(browserResult.operatorInvalidTokenSummary, {
      authBlocked: true,
      blockedSurface: "/api/device/setup",
      publicTruthRetained: true,
      exportDisabled: true,
    }),
    details: {
      guard: browserResult.operatorInvalidTokenSummary?.guard ?? null,
      authSummary: browserResult.operatorInvalidTokenSummary?.authSummary ?? null,
      protectedStatus: browserResult.operatorInvalidTokenSummary?.protectedStatus ?? null,
      exportStatus: browserResult.operatorInvalidTokenSummary?.exportStatus ?? null,
      exportDisabled: browserResult.operatorInvalidTokenSummary?.exportDisabled ?? null,
    },
  });

  checks.push({
    check: "browser_repair_hub_semantics",
    passed:
      hasStructuredRepairHubView(browserResult.repairHubSummary, {
        baseUrl: browserResult.baseUrl,
        repairId: browserResult.repairId,
        credentialId: browserResult.credentialId,
        expectedCredentialDidMethod: "agentpassport",
        expectedVisibleDidMethod: "agentpassport",
      }),
    details: {
      tokenInputPresent: browserResult.repairHubSummary?.tokenInputPresent ?? null,
      mainLinkHref: browserResult.repairHubSummary?.mainLinkHref ?? null,
      selectedCredentialJsonLength: browserResult.repairHubSummary?.selectedCredentialJsonLength ?? null,
      selectedCredentialParsed: browserResult.repairHubSummary?.selectedCredentialParsed ?? null,
      statusCards: browserResult.repairHubSummary?.statusCards ?? null,
      repairSummaryCards: browserResult.repairHubSummary?.repairSummaryCards ?? null,
      repairTruthCard: browserResult.repairHubSummary?.repairTruthCard ?? null,
      selectedRepairId: browserResult.repairHubSummary?.selectedRepairId ?? null,
    },
  });

  checks.push({
    check: "browser_repair_hub_compat_semantics",
    passed: hasStructuredRepairHubView(browserResult.repairHubCompatSummary, {
      baseUrl: browserResult.baseUrl,
      repairId: browserResult.repairId,
      credentialId: browserResult.compatCredentialId,
      expectedCredentialDidMethod: "openneed",
      expectedVisibleDidMethod: "openneed",
    }),
    details: {
      compatCredentialId: browserResult.compatCredentialId ?? null,
      repairHubCompatSummary: browserResult.repairHubCompatSummary ?? null,
    },
  });

  checks.push({
    check: "browser_repair_hub_legacy_canonicalization_semantics",
    passed: hasCanonicalizedRepairHubLegacyMainAgentView(browserResult.repairHubLegacyCanonicalSummary, {
      repairId: browserResult.repairId,
      expectedVisibleDidMethod: "agentpassport",
    }),
    details: {
      locationSearch: browserResult.repairHubLegacyCanonicalSummary?.locationSearch ?? null,
      selectedAgentId: browserResult.repairHubLegacyCanonicalSummary?.selectedAgentId ?? null,
      selectedIssuerAgentId: browserResult.repairHubLegacyCanonicalSummary?.selectedIssuerAgentId ?? null,
      selectedDidMethodFilter: browserResult.repairHubLegacyCanonicalSummary?.selectedDidMethodFilter ?? null,
      selectedRepairId: browserResult.repairHubLegacyCanonicalSummary?.selectedRepairId ?? null,
    },
  });

  checks.push({
    check: "browser_repair_hub_invalid_token_guard_semantics",
    passed: hasStructuredGuard(browserResult.repairHubInvalidTokenSummary, {
      authBlocked: true,
      blockedSurface: "repair-hub-protected-read",
      overviewCleared: true,
      listCleared: true,
    }),
    details: {
      guard: browserResult.repairHubInvalidTokenSummary?.guard ?? null,
      authSummary: browserResult.repairHubInvalidTokenSummary?.authSummary ?? null,
      overview: browserResult.repairHubInvalidTokenSummary?.overview ?? null,
      listEmpty: browserResult.repairHubInvalidTokenSummary?.listEmpty ?? null,
    },
  });

  checks.push({
    check: "browser_offline_chat_deeplink_semantics",
    passed:
      Array.isArray(browserResult.offlineChatFixture?.bootstrapThreadIds) &&
      new Set(browserResult.offlineChatFixture.bootstrapThreadIds).size ===
        browserResult.offlineChatFixture.bootstrapThreadIds.length &&
      browserResult.offlineChatFixture.bootstrapThreadIds.includes(browserResult.offlineChatFixture?.threadId) &&
      browserResult.offlineChatSummary?.activeThreadId === browserResult.offlineChatFixture?.threadId &&
      browserResult.offlineChatSummary?.activeSourceFilter === browserResult.offlineChatFixture?.sourceProvider &&
      String(browserResult.offlineChatSummary?.threadTitle || "").includes(browserResult.offlineChatFixture?.threadLabel || "") &&
      browserResult.offlineChatSummary?.dispatchHistoryHidden === true &&
      Number(browserResult.offlineChatSummary?.assistantSourceCount || 0) >= 1 &&
      Number(browserResult.offlineChatSummary?.assistantDispatchCount || 0) === 0 &&
      (Array.isArray(browserResult.offlineChatFixture?.filteredAssistantMessageIds)
        ? browserResult.offlineChatFixture.filteredAssistantMessageIds.length >= 1 &&
          browserResult.offlineChatFixture.filteredAssistantMessageIds.every((messageId) =>
            Array.isArray(browserResult.offlineChatSummary?.assistantMessageIds)
              ? browserResult.offlineChatSummary.assistantMessageIds.includes(messageId)
              : false
          )
        : false) &&
      (Array.isArray(browserResult.offlineChatSummary?.assistantSourceProviders)
        ? browserResult.offlineChatSummary.assistantSourceProviders.length >= 1 &&
          browserResult.offlineChatSummary.assistantSourceProviders.every(
            (provider) => provider === browserResult.offlineChatFixture?.sourceProvider
          )
        : false) &&
      (Array.isArray(browserResult.offlineChatSummary?.assistantSourceTexts)
        ? browserResult.offlineChatSummary.assistantSourceTexts.every(
            (entry) =>
              typeof entry === "string" &&
              entry.length > 0 &&
              !/fan-out|并行|串行/.test(entry)
          )
        : false) &&
      (Array.isArray(browserResult.offlineChatSummary?.assistantDispatchTexts)
        ? browserResult.offlineChatSummary.assistantDispatchTexts.length === 0
        : false),
    details: {
      bootstrapThreadIds: Array.isArray(browserResult.offlineChatFixture?.bootstrapThreadIds)
        ? browserResult.offlineChatFixture.bootstrapThreadIds
        : [],
      bootstrapThreadUniqueCount: Array.isArray(browserResult.offlineChatFixture?.bootstrapThreadIds)
        ? new Set(browserResult.offlineChatFixture.bootstrapThreadIds).size
        : null,
      activeThreadId: browserResult.offlineChatSummary?.activeThreadId ?? null,
      sourceProvider: browserResult.offlineChatSummary?.activeSourceFilter ?? null,
      dispatchHistoryHidden: browserResult.offlineChatSummary?.dispatchHistoryHidden ?? null,
      assistantSourceCount: browserResult.offlineChatSummary?.assistantSourceCount ?? null,
      assistantDispatchCount: browserResult.offlineChatSummary?.assistantDispatchCount ?? null,
      assistantMessageIds: Array.isArray(browserResult.offlineChatSummary?.assistantMessageIds)
        ? browserResult.offlineChatSummary.assistantMessageIds
        : null,
      expectedAssistantMessageIds: Array.isArray(browserResult.offlineChatFixture?.filteredAssistantMessageIds)
        ? browserResult.offlineChatFixture.filteredAssistantMessageIds
        : null,
      assistantSourceProviders: Array.isArray(browserResult.offlineChatSummary?.assistantSourceProviders)
        ? browserResult.offlineChatSummary.assistantSourceProviders
        : null,
      messageMetaSplit: `source=${Number(browserResult.offlineChatSummary?.assistantSourceCount || 0)},dispatch=${Number(browserResult.offlineChatSummary?.assistantDispatchCount || 0)}`,
    },
  });

  checks.push({
    check: "browser_offline_chat_group_dispatch_semantics",
    passed:
      browserResult.offlineChatGroupSummary?.activeThreadId === "group" &&
      String(browserResult.offlineChatGroupSummary?.threadContextSummary || "").includes(
        browserResult.offlineChatGroupFixture?.protocolTitle || ""
      ) &&
      String(browserResult.offlineChatGroupSummary?.threadContextSummary || "").includes(
        browserResult.offlineChatGroupFixture?.protocolSummary || ""
      ) &&
      browserResult.offlineChatGroupSummary?.dispatchHistoryHidden === false &&
      Number(browserResult.offlineChatGroupSummary?.dispatchHistoryCount || 0) >= 1 &&
      (Array.isArray(browserResult.offlineChatGroupSummary?.dispatchHistoryRecordIds)
        ? browserResult.offlineChatGroupSummary.dispatchHistoryRecordIds.includes(browserResult.offlineChatGroupFixture?.seedRecordId)
        : false) &&
      browserResult.offlineChatGroupSummary?.firstDispatchRecordId === browserResult.offlineChatGroupFixture?.seedRecordId &&
      Number(browserResult.offlineChatGroupSummary?.firstDispatchParallelBatchCount || 0) >= 1 &&
      String(browserResult.offlineChatGroupSummary?.firstParallelChip || "").trim().length > 0 &&
      String(browserResult.offlineChatGroupSummary?.sourceFilterSummary || "").length > 0 &&
      !/当前共有 0 条回复|0 条回复/.test(String(browserResult.offlineChatGroupSummary?.sourceFilterSummary || "")) &&
      Number(browserResult.offlineChatGroupSummary?.assistantSourceCount || 0) >= 1 &&
      Number(browserResult.offlineChatGroupSummary?.assistantDispatchCount || 0) >= 1 &&
      offlineChatGroupParticipantNames.length >= 2 &&
      (Array.isArray(browserResult.offlineChatGroupSummary?.threadContextNames)
        ? offlineChatGroupParticipantNames.every((name) => browserResult.offlineChatGroupSummary.threadContextNames.includes(name))
        : false) &&
      (Array.isArray(browserResult.offlineChatGroupSummary?.assistantMessageIds)
        ? browserResult.offlineChatGroupSummary.assistantMessageIds.some((messageId) =>
            String(messageId || "").startsWith(`${browserResult.offlineChatGroupFixture?.seedRecordId}:`)
          )
        : false) &&
      (Array.isArray(browserResult.offlineChatGroupSummary?.assistantDispatchBatches)
        ? browserResult.offlineChatGroupSummary.assistantDispatchBatches.includes("merge")
        : false) &&
      (Array.isArray(browserResult.offlineChatGroupSummary?.assistantDispatchModes)
        ? browserResult.offlineChatGroupSummary.assistantDispatchModes.includes("parallel") &&
          browserResult.offlineChatGroupSummary.assistantDispatchModes.includes("serial")
        : false) &&
      (Array.isArray(browserResult.offlineChatGroupSummary?.assistantSourceTexts)
        ? browserResult.offlineChatGroupSummary.assistantSourceTexts.every(
            (entry) =>
              typeof entry === "string" &&
              entry.length > 0 &&
              !/fan-out|并行|串行/.test(entry)
          )
        : false) &&
      (Array.isArray(browserResult.offlineChatGroupSummary?.assistantDispatchTexts)
        ? browserResult.offlineChatGroupSummary.assistantDispatchTexts.some(
            (entry) => typeof entry === "string" && /fan-out|并行|串行/.test(entry)
          )
        : false) &&
      String(browserResult.offlineChatGroupSummary?.policyCardMeta || "").includes("当前线程启动配置") &&
      !String(browserResult.offlineChatGroupSummary?.policyCardGoal || "").includes("最近一轮") &&
      String(browserResult.offlineChatGroupSummary?.executionCardMeta || "").includes("最近一轮调度结果") &&
      String(browserResult.offlineChatGroupSummary?.executionCardGoal || "").includes("最近一轮") &&
      browserResult.offlineChatGroupSummary?.directState?.dispatchHistoryHidden === true &&
      browserResult.offlineChatGroupSummary?.refreshedState?.dispatchHistoryHidden === false &&
      String(browserResult.offlineChatGroupSummary?.refreshedState?.firstDispatchRecordId || "").length > 0 &&
      browserResult.offlineChatGroupSummary?.refreshedState?.firstDispatchRecordId !== browserResult.offlineChatGroupFixture?.seedRecordId &&
      String(browserResult.offlineChatGroupSummary?.refreshedState?.firstDispatchBody || "").length > 0 &&
      !String(browserResult.offlineChatGroupSummary?.refreshedState?.policyCardGoal || "").includes("最近一轮") &&
      String(browserResult.offlineChatGroupSummary?.refreshedState?.executionCardGoal || "").includes("最近一轮") &&
      offlineChatStartupTruth?.bootstrapMatchesThreadStartup === true &&
      offlineChatStartupTruth?.historyMatchesThreadStartup === true &&
      offlineChatStartupTruth?.seedMatchesThreadStartup === true &&
      offlineChatStartupTruth?.protocolRecordIdConsistent === true &&
      String(offlineChatStartupTruth?.protocolKey || "").length > 0 &&
      String(offlineChatStartupTruth?.protocolVersion || "").length > 0,
    details: {
      activeThreadId: browserResult.offlineChatGroupSummary?.activeThreadId ?? null,
      dispatchHistoryCount: browserResult.offlineChatGroupSummary?.dispatchHistoryCount ?? null,
      dispatchHistoryRecordIds: Array.isArray(browserResult.offlineChatGroupSummary?.dispatchHistoryRecordIds)
        ? browserResult.offlineChatGroupSummary.dispatchHistoryRecordIds
        : null,
      firstDispatchRecordId: browserResult.offlineChatGroupSummary?.firstDispatchRecordId ?? null,
      expectedSeedRecordId: browserResult.offlineChatGroupFixture?.seedRecordId ?? null,
      assistantSourceCount: browserResult.offlineChatGroupSummary?.assistantSourceCount ?? null,
      assistantDispatchCount: browserResult.offlineChatGroupSummary?.assistantDispatchCount ?? null,
      assistantMessageIds: Array.isArray(browserResult.offlineChatGroupSummary?.assistantMessageIds)
        ? browserResult.offlineChatGroupSummary.assistantMessageIds
        : null,
      participantNames: offlineChatGroupParticipantNames,
      threadContextNames: Array.isArray(browserResult.offlineChatGroupSummary?.threadContextNames)
        ? browserResult.offlineChatGroupSummary.threadContextNames
        : null,
      assistantDispatchBatches: Array.isArray(browserResult.offlineChatGroupSummary?.assistantDispatchBatches)
        ? browserResult.offlineChatGroupSummary.assistantDispatchBatches
        : null,
      assistantDispatchModes: Array.isArray(browserResult.offlineChatGroupSummary?.assistantDispatchModes)
        ? browserResult.offlineChatGroupSummary.assistantDispatchModes
        : null,
      messageMetaSplit: `source=${Number(browserResult.offlineChatGroupSummary?.assistantSourceCount || 0)},dispatch=${Number(browserResult.offlineChatGroupSummary?.assistantDispatchCount || 0)}`,
      firstParallelChip: browserResult.offlineChatGroupSummary?.firstParallelChip ?? null,
      sourceFilterSummary: browserResult.offlineChatGroupSummary?.sourceFilterSummary ?? null,
      policyCardMeta: browserResult.offlineChatGroupSummary?.policyCardMeta ?? null,
      executionCardMeta: browserResult.offlineChatGroupSummary?.executionCardMeta ?? null,
      startupTruth: offlineChatStartupTruth,
      directDispatchHistoryHidden: browserResult.offlineChatGroupSummary?.directState?.dispatchHistoryHidden ?? null,
      refreshedDispatchHistoryHidden: browserResult.offlineChatGroupSummary?.refreshedState?.dispatchHistoryHidden ?? null,
    },
  });

  checks.push({
    check: "browser_offline_chat_invalid_token_guard_semantics",
    passed: hasStructuredGuard(browserResult.offlineChatInvalidTokenSummary, {
      authBlocked: true,
      blockedSurface: "offline-chat-protected-read",
      tokenRetained: true,
      statePreserved: true,
      sendDisabled: true,
      clearEnabled: true,
    }),
    details: {
      guard: browserResult.offlineChatInvalidTokenSummary?.guard ?? null,
      authSummary: browserResult.offlineChatInvalidTokenSummary?.authSummary ?? null,
      threadTitle: browserResult.offlineChatInvalidTokenSummary?.threadTitle ?? null,
      dispatchHistorySummary: browserResult.offlineChatInvalidTokenSummary?.dispatchHistorySummary ?? null,
      syncStatus: browserResult.offlineChatInvalidTokenSummary?.syncStatus ?? null,
      sendDisabled: browserResult.offlineChatInvalidTokenSummary?.sendDisabled ?? null,
      clearDisabled: browserResult.offlineChatInvalidTokenSummary?.clearDisabled ?? null,
    },
  });

  const failedChecks = checks.filter((entry) => entry.passed === false);
  const passedChecks = checks.filter((entry) => entry.passed === true).length;
  const status = failedChecks.length > 0 ? "failed" : "passed";

  return {
    status,
    browserSkipped: false,
    passedChecks,
    totalChecks: checks.length,
    failedChecks: failedChecks.map((entry) => entry.check),
    checks,
  };
}

export function formatBrowserUiSemanticsSummary(gate = null) {
  if (!gate || typeof gate !== "object") {
    return "browser-ui semantics: unavailable";
  }
  if (gate.status === "skipped") {
    return "browser-ui semantics: skipped";
  }
  const checkMap = new Map((Array.isArray(gate.checks) ? gate.checks : []).map((entry) => [entry.check, entry]));
  const labels = [
    ["browser_runtime_home_truth_semantics", "RuntimeHome", "runtimeLinkCount"],
    ["browser_lab_truth_semantics", "LabTruth", "localStoreDetailCount"],
    ["browser_lab_failure_semantics_truth_chain", "LabFailure", "releaseStatus"],
    ["browser_lab_invalid_token_guard_semantics", "LabBadToken", "status"],
    ["browser_operator_truth_and_export_semantics", "OperatorExport", "exportHistoryCount"],
    ["browser_operator_incident_packet_truth_semantics", "OperatorPacket", "format"],
    ["browser_operator_invalid_token_guard_semantics", "OperatorBadToken", "exportDisabled"],
    ["browser_repair_hub_semantics", "RepairHub", "selectedCredentialJsonLength"],
    ["browser_repair_hub_compat_semantics", "RepairHubCompat", "compatCredentialId"],
    ["browser_repair_hub_legacy_canonicalization_semantics", "RepairHubLegacy", "selectedAgentId"],
    ["browser_repair_hub_invalid_token_guard_semantics", "RepairHubBadToken", "overview"],
    ["browser_offline_chat_deeplink_semantics", "OfflineChatDirect", "messageMetaSplit"],
    ["browser_offline_chat_group_dispatch_semantics", "OfflineChatGroup", "messageMetaSplit"],
  ];
  const parts = labels.map(([checkName, label, focusField]) => {
    const check = checkMap.get(checkName) || null;
    if (!check) {
      return `${label}=unavailable`;
    }
    const focusValue = check.details?.[focusField];
    const focusSummary =
      focusValue == null
        ? "n/a"
        : `${focusField}=${typeof focusValue === "number" ? Number(focusValue) : focusValue}`;
    return `${label}=${check.passed === true ? "pass" : "fail"} (${focusSummary})`;
  });
  const failed = Array.isArray(gate.failedChecks) && gate.failedChecks.length
    ? ` failed=${gate.failedChecks.join(",")}`
    : "";
  return `browser-ui semantics: ${gate.status}${failed}; ${parts.join("; ")}`;
}

export function browserUiSemanticsBlocksRelease(gate = null, { browserSkipped = false } = {}) {
  return gate?.status === "failed" || (browserSkipped !== true && gate?.status !== "passed");
}

export function runStep(name, script, extraEnv = {}) {
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
      const externalWaitMs = extractStepExternalWaitMs(name, result);
      resolve({
        name,
        script,
        durationMs,
        externalWaitMs,
        effectiveDurationMs: Math.max(0, durationMs - externalWaitMs),
        result,
      });
    });
  });
}

function normalizeStepError(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runStepOutcome(name, script, extraEnv = {}) {
  try {
    return {
      ok: true,
      step: await runStep(name, script, extraEnv),
      failedStep: null,
    };
  } catch (error) {
    return {
      ok: false,
      step: null,
      failedStep: {
        name,
        script,
        error: normalizeStepError(error),
      },
    };
  }
}

export async function runStepDefsOutcomes(stepDefs = [], baseEnv = {}, { parallel = false, stopOnFailure = false } = {}) {
  const runOne = ([name, script, extraEnv]) => runStepOutcome(name, script, { ...baseEnv, ...extraEnv });
  const outcomes = [];
  if (parallel) {
    outcomes.push(...(await Promise.all(stepDefs.map(runOne))));
  } else {
    for (const stepDef of stepDefs) {
      const outcome = await runOne(stepDef);
      outcomes.push(outcome);
      if (!outcome.ok && stopOnFailure) {
        break;
      }
    }
  }

  return {
    steps: outcomes.map((outcome) => outcome.step).filter(Boolean),
    failedSteps: outcomes.map((outcome) => outcome.failedStep).filter(Boolean),
  };
}

async function main() {
  if (requireBrowser && skipBrowser) {
    throw new Error("SMOKE_ALL_REQUIRE_BROWSER=1 不能与 SMOKE_ALL_SKIP_BROWSER=1 同时启用");
  }

  const preflightStepDefs = [
    [
      "verify:mempalace:remote-reasoner",
      "verify-mempalace-remote-reasoner.mjs",
      { SMOKE_COMBINED: "1" },
    ],
    [
      "verify:memory-stability:contract",
      "verify-memory-stability-contract.mjs",
      { SMOKE_COMBINED: "1" },
    ],
    [
      "verify:memory-stability:engine",
      "verify-memory-stability-engine.mjs",
      { SMOKE_COMBINED: "1" },
    ],
    [
      "verify:memory-stability:adapter",
      "verify-memory-stability-adapter-contract.mjs",
      { SMOKE_COMBINED: "1" },
    ],
    [
      "verify:memory-stability:kernel",
      "verify-memory-stability-internal-kernel.mjs",
      { SMOKE_COMBINED: "1" },
    ],
    [
      "verify:memory-stability:controlled-adapter",
      "verify-memory-stability-controlled-adapter.mjs",
      { SMOKE_COMBINED: "1" },
    ],
    [
      "verify:memory-stability:self-learning",
      "verify-memory-stability-self-learning-governance.mjs",
      { SMOKE_COMBINED: "1" },
    ],
    [
      "verify:memory-stability:runtime-loader",
      "verify-memory-stability-runtime-loader.mjs",
      { SMOKE_COMBINED: "1" },
    ],
    [
      "verify:memory-stability:snapshots",
      "verify-memory-stability-snapshots.mjs",
      { SMOKE_COMBINED: "1" },
    ],
  ];
  const primaryStepDefs = [
    ["smoke:ui", "smoke-ui.mjs", { SMOKE_COMBINED: "1" }],
    ["smoke:dom", "smoke-dom-combined.mjs", {}],
  ];
  const browserStep = [
    "smoke:browser",
    "smoke-browser.mjs",
    {
      SMOKE_COMBINED: "1",
      SMOKE_FETCH_TIMEOUT_MS: process.env.SMOKE_FETCH_TIMEOUT_MS || String(DEFAULT_BROWSER_SMOKE_FETCH_TIMEOUT_MS),
    },
  ];
  const operationalStepDefs = [
    ["smoke:ui:operational", "smoke-ui-operational.mjs", {}],
    ["smoke:dom:operational", "smoke-dom-operational.mjs", {}],
  ];
  const allStepDefs = skipBrowser ? primaryStepDefs : [...primaryStepDefs, browserStep];
  const startedAt = Date.now();
  const resolvedBaseUrl = await resolveSmokeBaseUrl();
  let resolvedDataRoot = null;
  let smokeServer = null;
  let primaryError = null;

  try {
    resolvedDataRoot = await prepareSmokeDataRoot({
      isolated: !resolvedBaseUrl.reuseExisting,
      tempPrefix: "agent-passport-smoke-all-",
    });
    smokeServer = await ensureSmokeServer(resolvedBaseUrl.baseUrl, {
      reuseExisting: resolvedBaseUrl.reuseExisting,
      extraEnv: resolvedDataRoot.isolationEnv,
    });
    const baseEnv = {
      AGENT_PASSPORT_BASE_URL: smokeServer.baseUrl,
      ...resolvedDataRoot.isolationEnv,
    };
    const steps = [];
    for (const [name, script, extraEnv] of preflightStepDefs) {
      steps.push(await runStep(name, script, { ...baseEnv, ...extraEnv }));
    }
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
    const operationalOutcomes = await runStepDefsOutcomes(operationalStepDefs, baseEnv, {
      parallel: runInParallel,
      stopOnFailure: !runInParallel,
    });
    steps.push(...operationalOutcomes.steps);
    const failedSteps = operationalOutcomes.failedSteps;

    const totalDurationMs = Date.now() - startedAt;
    const externalWaitMs = steps.reduce((total, step) => total + Number(step?.externalWaitMs || 0), 0);
    const effectiveTotalDurationMs = Math.max(0, totalDurationMs - externalWaitMs);
    const gateFailures = [];
    const offlineFanoutGate = summarizeOfflineFanoutGate(steps, {
      browserSkipped: skipBrowser,
    });
    offlineFanoutGate.summary = formatOfflineFanoutGateSummary(offlineFanoutGate);
    if (offlineFanoutGate.status === "failed") {
      gateFailures.push(offlineFanoutGate.summary);
    }
    const protectiveStateSemantics = summarizeProtectiveStateSemantics(steps, {
      browserSkipped: skipBrowser,
    });
    protectiveStateSemantics.summary = formatProtectiveStateSemanticsSummary(protectiveStateSemantics);
    if (protectiveStateSemantics.status === "failed") {
      gateFailures.push(protectiveStateSemantics.summary);
    }
    const operationalFlowSemantics = summarizeOperationalFlowSemantics(steps);
    operationalFlowSemantics.summary = formatOperationalFlowSemanticsSummary(operationalFlowSemantics);
    if (operationalFlowSemantics.status !== "passed") {
      gateFailures.push(operationalFlowSemantics.summary);
    }
    const runtimeEvidenceSemantics = summarizeRuntimeEvidenceSemantics(steps);
    runtimeEvidenceSemantics.summary = formatRuntimeEvidenceSemanticsSummary(runtimeEvidenceSemantics);
    if (runtimeEvidenceSemantics.status !== "passed") {
      gateFailures.push(runtimeEvidenceSemantics.summary);
    }
    const browserUiSemantics = summarizeBrowserUiSemantics(steps, {
      browserSkipped: skipBrowser,
    });
    browserUiSemantics.summary = formatBrowserUiSemanticsSummary(browserUiSemantics);
    if (browserUiSemanticsBlocksRelease(browserUiSemantics, { browserSkipped: skipBrowser })) {
      gateFailures.push(browserUiSemantics.summary);
    }
    const ok = failedSteps.length === 0 && gateFailures.length === 0;
    console.log(
      JSON.stringify(
        buildSmokeAllResultEnvelope({
          ok,
          parallel: runInParallel,
          error: ok ? null : failedSteps[0]?.error || gateFailures[0] || "smoke:all failed",
          failedSteps,
          gateFailures,
          totalDurationMs,
          externalWaitMs,
          effectiveTotalDurationMs,
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
          browserUiSemantics,
          steps,
        }),
        null,
        2
      )
    );
    if (!ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await cleanupSmokeWrapperRuntime({ smokeServer, resolvedDataRoot, primaryError });
  }
}

if (smokeAllDirectExecution) {
  await main();
}

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
  const setupSummary = setupCheck
    ? `DeviceSetupPreview=${setupCheck.passed === true ? "pass" : "fail"} (${[
        `runMode=${setupCheck.details?.runMode || "unknown"}`,
        setupCheck.details?.expected === false ? "completionExpected=no" : "completionExpected=yes",
      ].join(", ")})`
    : "DeviceSetupPreview=unavailable";
  const failed = Array.isArray(gate.failedChecks) && gate.failedChecks.length
    ? ` failed=${gate.failedChecks.join(",")}`
    : "";
  return `protective-state semantics: ${gate.status}${failed}; ${browserSummary}; ${runnerSummary}; ${setupSummary}`;
}

function runStep(name, script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
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
    child.on("error", reject);
    // Some smoke steps spawn helper subprocesses that can inherit stdio.
    // Waiting for `close` can hang even after the step process itself exited.
    child.on("exit", (code) => {
      const durationMs = Date.now() - startedAt;
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
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: runInParallel ? "parallel_combined" : "sequential_combined",
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

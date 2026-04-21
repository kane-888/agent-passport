import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { ensureSmokeServer, prepareSmokeDataRoot, resolveSmokeBaseUrl } from "./smoke-server.mjs";
import { rootDir } from "./smoke-env.mjs";
import { extractTrailingJson } from "./smoke-all.mjs";
import { createSmokeHttpClient } from "./smoke-ui-http.mjs";

const __filename = fileURLToPath(import.meta.url);
const soakDirectExecution = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

function text(value) {
  return String(value ?? "").trim();
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readArgValue(prefix) {
  const entry = process.argv.find((value) => value.startsWith(`${prefix}=`));
  return entry ? entry.slice(prefix.length + 1) : "";
}

function buildScenarioCheck(id, label, passed, details = {}) {
  return {
    id,
    label,
    passed: passed === true,
    details,
  };
}

function summarizeFailedChecks(checks = []) {
  return (Array.isArray(checks) ? checks : []).filter((entry) => entry?.passed === false).map((entry) => entry.id);
}

function logSoakProgress(message, details = {}) {
  const detailText = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.error(`[soak-runtime] ${message}${detailText ? ` ${detailText}` : ""}`);
}

function buildStepMap(smokeJson = {}) {
  return new Map((Array.isArray(smokeJson?.steps) ? smokeJson.steps : []).map((entry) => [entry?.name, entry?.result || null]));
}

function isOperationalOnlySmoke(smokeJson = {}) {
  return smokeJson?.mode === "operational_only";
}

function resolveSmokeScriptConfig({ operationalOnly = false } = {}) {
  return operationalOnly
    ? {
        scriptName: "smoke-operational-gate.mjs",
        okCheckId: "smoke_operational_ok",
        okCheckLabel: "短运行态 smoke:operational 通过",
        roundCheckId: "smoke_operational_round",
        roundCheckLabel: "短运行态 smoke:operational 完成",
      }
    : {
        scriptName: "smoke-all.mjs",
        okCheckId: "smoke_all_ok",
        okCheckLabel: "整轮 smoke:all 通过",
        roundCheckId: "smoke_all_round",
        roundCheckLabel: "整轮 smoke:all 完成",
      };
}

function readOperationalUiResult(smokeJson = {}) {
  const stepMap = buildStepMap(smokeJson);
  return stepMap.get("smoke:ui:operational") || null;
}

function toFiniteMetric(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

export function extractSharedStateMetrics(smokeJson = {}) {
  const ui = readOperationalUiResult(smokeJson);
  return {
    windowCount: toFiniteMetric(ui?.windowCount),
    passportMemoryCount: toFiniteMetric(ui?.passportMemoryCount),
    conversationMinuteCount: toFiniteMetric(ui?.conversationMinuteCount),
    runnerHistoryCount: toFiniteMetric(ui?.runnerHistoryCount),
    verificationHistoryCount: toFiniteMetric(ui?.verificationHistoryCount),
    repairCount: toFiniteMetric(ui?.repairCount),
  };
}

function buildSharedStateMetricPresenceChecks(metrics = {}) {
  return [
    buildScenarioCheck("shared_window_metric_present", "共享态窗口计数可读", metrics.windowCount != null, {
      windowCount: metrics.windowCount,
    }),
    buildScenarioCheck("shared_memory_metric_present", "共享态记忆计数可读", metrics.passportMemoryCount != null, {
      passportMemoryCount: metrics.passportMemoryCount,
    }),
    buildScenarioCheck("shared_minute_metric_present", "共享态分钟计数可读", metrics.conversationMinuteCount != null, {
      conversationMinuteCount: metrics.conversationMinuteCount,
    }),
    buildScenarioCheck("shared_runner_history_metric_present", "共享态 runner 历史计数可读", metrics.runnerHistoryCount != null, {
      runnerHistoryCount: metrics.runnerHistoryCount,
    }),
    buildScenarioCheck(
      "shared_verification_history_metric_present",
      "共享态 verification 历史计数可读",
      metrics.verificationHistoryCount != null,
      {
        verificationHistoryCount: metrics.verificationHistoryCount,
      }
    ),
    buildScenarioCheck("shared_repair_metric_present", "共享态 repair 计数可读", metrics.repairCount != null, {
      repairCount: metrics.repairCount,
    }),
  ];
}

export function buildSharedStateGrowthChecks({ previousMetrics = null, currentMetrics = null } = {}) {
  const metrics = currentMetrics || {};
  const checks = buildSharedStateMetricPresenceChecks(metrics);
  if (!previousMetrics) {
    return checks;
  }
  checks.push(
    buildScenarioCheck("shared_window_count_stable", "同一 data root 下窗口绑定数量保持稳定", metrics.windowCount === previousMetrics.windowCount, {
      previous: previousMetrics.windowCount,
      current: metrics.windowCount,
    })
  );
  checks.push(
    buildScenarioCheck(
      "shared_conversation_minute_non_decreasing",
      "同一 data root 下 conversation minute 不应倒退",
      metrics.conversationMinuteCount >= previousMetrics.conversationMinuteCount,
      {
        previous: previousMetrics.conversationMinuteCount,
        current: metrics.conversationMinuteCount,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "shared_runner_history_non_decreasing",
      "同一 data root 下 runner 历史不应倒退",
      metrics.runnerHistoryCount >= previousMetrics.runnerHistoryCount,
      {
        previous: previousMetrics.runnerHistoryCount,
        current: metrics.runnerHistoryCount,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "shared_verification_history_non_decreasing",
      "同一 data root 下 verification 历史不应倒退",
      metrics.verificationHistoryCount >= previousMetrics.verificationHistoryCount,
      {
        previous: previousMetrics.verificationHistoryCount,
        current: metrics.verificationHistoryCount,
      }
    )
  );
  checks.push(
    buildScenarioCheck("shared_repair_count_non_decreasing", "同一 data root 下 repair 计数不应倒退", metrics.repairCount >= previousMetrics.repairCount, {
      previous: previousMetrics.repairCount,
      current: metrics.repairCount,
    })
  );
  return checks;
}

export function buildCrashRestartChecks({
  memoryId = null,
  visibleBeforeCrash = false,
  healthAfterRestart = null,
  securityAfterRestart = null,
  runtimeAfterRestart = null,
  visibleAfterRestart = false,
} = {}) {
  return [
    buildScenarioCheck("memory_visible_before_crash", "崩溃前新写入记忆可见", visibleBeforeCrash, {
      passportMemoryId: memoryId,
    }),
    buildScenarioCheck("restart_health", "异常退出后服务能重启", healthAfterRestart?.ok === true, {
      ok: healthAfterRestart?.ok ?? null,
      service: text(healthAfterRestart?.service) || null,
    }),
    buildScenarioCheck(
      "restart_runtime_truth",
      "异常退出后受保护 runtime 真值仍可读",
      Boolean(runtimeAfterRestart?.deviceRuntime),
      {
        deviceRuntimeId: runtimeAfterRestart?.deviceRuntime?.deviceRuntimeId || null,
      }
    ),
    buildScenarioCheck("restart_admin_token", "异常退出后管理令牌仍可读受保护真值", securityAfterRestart?.authorized === true, {
      authorized: securityAfterRestart?.authorized ?? null,
    }),
    buildScenarioCheck("memory_persisted_after_restart", "异常退出后新写入记忆仍保留", visibleAfterRestart, {
      passportMemoryId: memoryId,
    }),
  ];
}

export function buildRuntimeStabilityCoverage({ includeBrowser = false, operationalOnly = false } = {}) {
  const browserUi =
    operationalOnly
      ? "not_applicable_operational_only"
      : includeBrowser
        ? "required"
        : "skipped_by_default";
  return {
    browserUi,
    formalGoLiveMeaning:
      browserUi === "required"
        ? "covers browser-projected runtime truth across soak rounds"
        : "does not replace smoke:browser, smoke:all, or go-live verifier browser coverage",
    nextAction:
      browserUi === "required"
        ? "If this soak passes, still run the go-live verifier with the real deploy URL before public release."
        : "For browser-projected runtime truth, run npm run soak:runtime:browser or npm run smoke:browser on a Safari DOM automation host.",
  };
}

function buildRuntimeStabilitySummary({
  rounds = [],
  sharedStateRounds = [],
  crashRestart = null,
  includeBrowser = false,
  operationalOnly = false,
} = {}) {
  const failedRounds = (Array.isArray(rounds) ? rounds : []).filter((entry) => entry?.ok !== true);
  const failedSharedStateRounds = (Array.isArray(sharedStateRounds) ? sharedStateRounds : []).filter((entry) => entry?.ok !== true);
  const crashRestartOk = crashRestart?.ok === true;
  const roundCount = Array.isArray(rounds) ? rounds.length : 0;
  const passedRounds = (Array.isArray(rounds) ? rounds : []).filter((entry) => entry?.ok === true).length;
  const sharedStateRoundCount = Array.isArray(sharedStateRounds) ? sharedStateRounds.length : 0;
  const passedSharedStateRounds = (Array.isArray(sharedStateRounds) ? sharedStateRounds : []).filter((entry) => entry?.ok === true).length;
  const failedRoundLabels = failedRounds.map(
    (entry) => `round_${entry.round}:${summarizeFailedChecks(entry.checks).join(",") || "unknown"}`
  );
  const failedSharedStateRoundLabels = failedSharedStateRounds.map(
    (entry) => `shared_round_${entry.round}:${summarizeFailedChecks(entry.checks).join(",") || "unknown"}`
  );
  const failureParts = [
    failedRoundLabels.length > 0 ? `cold_start_failures=${failedRoundLabels.join(" ; ")}` : "",
    failedSharedStateRoundLabels.length > 0 ? `shared_state_failures=${failedSharedStateRoundLabels.join(" ; ")}` : "",
    crashRestartOk ? "" : `crash_restart=${text(crashRestart?.summary) || "failed"}`,
  ].filter(Boolean);

  return {
    ok: failedRounds.length === 0 && failedSharedStateRounds.length === 0 && crashRestartOk,
    coldStartRoundCount: roundCount,
    coldStartPassedCount: passedRounds,
    sharedStateRoundCount,
    sharedStatePassedCount: passedSharedStateRounds,
    failedRounds: failedRounds.map((entry) => ({
      round: entry.round,
      failedChecks: summarizeFailedChecks(entry.checks),
    })),
    failedSharedStateRounds: failedSharedStateRounds.map((entry) => ({
      round: entry.round,
      failedChecks: summarizeFailedChecks(entry.checks),
    })),
    sharedStateRounds,
    crashRestart,
    coverage: buildRuntimeStabilityCoverage({ includeBrowser, operationalOnly }),
    summary:
      failedRounds.length === 0 && failedSharedStateRounds.length === 0 && crashRestartOk
        ? `runtime soak passed: coldStart=${passedRounds}/${roundCount} ; sharedState=${passedSharedStateRounds}/${sharedStateRoundCount} ; crashRestart=pass`
        : `runtime soak failed: ${failureParts.join(" ; ") || "unknown failure"}`,
  };
}

function buildColdStartChecks(smokeAllJson = {}, { operationalOnly = isOperationalOnlySmoke(smokeAllJson) } = {}) {
  const stepMap = buildStepMap(smokeAllJson);
  const ui = stepMap.get("smoke:ui:operational") || null;
  const browserSemantics = smokeAllJson.browserUiSemantics?.status || null;
  const scriptConfig = resolveSmokeScriptConfig({ operationalOnly });
  const checks = [
    buildScenarioCheck(scriptConfig.okCheckId, scriptConfig.okCheckLabel, smokeAllJson.ok === true, {
      mode: smokeAllJson.mode || null,
    }),
  ];

  if (!operationalOnly) {
    checks.push(
      buildScenarioCheck("offline_fanout_gate", "offline fan-out gate 通过", smokeAllJson.offlineFanoutGate?.status === "passed", {
        status: smokeAllJson.offlineFanoutGate?.status || null,
        summary: smokeAllJson.offlineFanoutGate?.summary || null,
      })
    );
    checks.push(
      buildScenarioCheck(
        "protective_state_semantics",
        "保护态语义通过",
        smokeAllJson.protectiveStateSemantics?.status === "passed",
        {
          status: smokeAllJson.protectiveStateSemantics?.status || null,
          summary: smokeAllJson.protectiveStateSemantics?.summary || null,
        }
      )
    );
  }

  checks.push(
    buildScenarioCheck(
      "operational_flow_semantics",
      "运行流程语义通过",
      smokeAllJson.operationalFlowSemantics?.status === "passed",
      {
        status: smokeAllJson.operationalFlowSemantics?.status || null,
        summary: smokeAllJson.operationalFlowSemantics?.summary || null,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "runtime_evidence_semantics",
      "runtime evidence 语义通过",
      smokeAllJson.runtimeEvidenceSemantics?.status === "passed",
      {
        status: smokeAllJson.runtimeEvidenceSemantics?.status || null,
        summary: smokeAllJson.runtimeEvidenceSemantics?.summary || null,
      }
    )
  );
  if (!operationalOnly) {
    checks.push(
      buildScenarioCheck(
        "browser_ui_semantics",
        "browser UI 语义通过或按预期跳过",
        browserSemantics === "passed" || browserSemantics === "skipped",
        {
          status: browserSemantics,
          summary: smokeAllJson.browserUiSemantics?.summary || null,
        }
      )
    );
  }

  checks.push(
    buildScenarioCheck("operational_ui_evidence", "冷启动证据来自 smoke:ui:operational", Boolean(ui), {
      sourceStep: ui ? "smoke:ui:operational" : null,
    })
  );
  checks.push(
    buildScenarioCheck(
      "admin_token_rotation",
      "令牌轮换链路稳定",
      ui?.adminTokenRotationMode === "rotated" &&
        ui?.adminTokenRotationOldTokenRejected === true &&
        ui?.adminTokenRotationReadSessionPreRevokeAllowed === true &&
        ui?.adminTokenRotationReadSessionRevoked === true &&
        ui?.adminTokenRotationAnomalyRecorded === true,
      {
        mode: ui?.adminTokenRotationMode ?? null,
        oldTokenRejected: ui?.adminTokenRotationOldTokenRejected ?? null,
        preRevokeAllowed: ui?.adminTokenRotationReadSessionPreRevokeAllowed ?? null,
        readSessionRevoked: ui?.adminTokenRotationReadSessionRevoked ?? null,
        anomalyRecorded: ui?.adminTokenRotationAnomalyRecorded ?? null,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "window_rebind_guard",
      "窗口改绑防伪造稳定",
      ui?.forgedWindowRebindBlocked === true && ui?.windowBindingStableAfterRebind === true,
      {
        blocked: ui?.forgedWindowRebindBlocked ?? null,
        error: ui?.forgedWindowRebindError ?? null,
        bindingStable: ui?.windowBindingStableAfterRebind ?? null,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "auto_recovery_resume",
      "恢复续跑稳定",
      ui?.autoRecoveryResumed === true &&
        ui?.autoRecoveryResumeStatus === "resumed" &&
        Number(ui?.autoRecoveryResumeChainLength || 0) >= 2 &&
        ui?.retryWithoutExecutionResumeStatus === "resumed" &&
        Number(ui?.retryWithoutExecutionResumeChainLength || 0) >= 2,
      {
        resumed: ui?.autoRecoveryResumed ?? null,
        resumeStatus: ui?.autoRecoveryResumeStatus ?? null,
        resumeChainLength: ui?.autoRecoveryResumeChainLength ?? null,
        retryWithoutExecutionStatus: ui?.retryWithoutExecutionResumeStatus ?? null,
        retryWithoutExecutionChainLength: ui?.retryWithoutExecutionResumeChainLength ?? null,
      }
    )
  );

  return checks;
}

export function evaluateColdStartRound(smokeAllJson = {}, { operationalOnly = isOperationalOnlySmoke(smokeAllJson) } = {}) {
  const checks = buildColdStartChecks(smokeAllJson, { operationalOnly });
  return {
    ok: checks.every((entry) => entry.passed === true),
    checks,
  };
}

export function evaluateSharedStateRound(smokeAllJson = {}, { previousMetrics = null, operationalOnly = isOperationalOnlySmoke(smokeAllJson) } = {}) {
  const base = evaluateColdStartRound(smokeAllJson, { operationalOnly });
  const metrics = extractSharedStateMetrics(smokeAllJson);
  const growthChecks = buildSharedStateGrowthChecks({
    previousMetrics,
    currentMetrics: metrics,
  });
  const checks = [...base.checks, ...growthChecks];
  return {
    ok: checks.every((entry) => entry.passed === true),
    checks,
    metrics,
  };
}

export function buildRuntimeStabilityVerdict(input = {}) {
  return buildRuntimeStabilitySummary(input);
}

function isChildProcessRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

export function resolveScriptProcessSignalTarget(child, { platform = process.platform } = {}) {
  if (!child?.pid) {
    return {
      mode: "none",
      pid: null,
    };
  }
  if (platform !== "win32") {
    return {
      mode: "process_group",
      pid: -child.pid,
    };
  }
  return {
    mode: "child",
    pid: child.pid,
  };
}

function signalScriptProcessTree(child, signal) {
  const target = resolveScriptProcessSignalTarget(child);
  if (target.mode === "none") {
    return;
  }
  try {
    if (target.mode === "process_group") {
      process.kill(target.pid, signal);
      return;
    }
    child.kill(signal);
  } catch {}
}

async function waitForChildClose(child, timeoutMs) {
  if (!isChildProcessRunning(child)) {
    return true;
  }
  const closed = Symbol("closed");
  const timedOut = Symbol("timed_out");
  const result = await Promise.race([
    once(child, "close").then(() => closed),
    new Promise((resolve) => setTimeout(() => resolve(timedOut), timeoutMs)),
  ]);
  return result === closed || !isChildProcessRunning(child);
}

async function terminateScriptProcessTree(child, { graceMs = 1500, forceGraceMs = 1000 } = {}) {
  if (!isChildProcessRunning(child)) {
    return;
  }
  signalScriptProcessTree(child, "SIGTERM");
  if (await waitForChildClose(child, graceMs)) {
    return;
  }
  signalScriptProcessTree(child, "SIGKILL");
  await waitForChildClose(child, forceGraceMs);
}

async function runScriptJson(scriptName, { env = {}, timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, "scripts", scriptName)], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ...env,
      },
    });
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      terminateScriptProcessTree(child).finally(() => {
        reject(new Error(`${scriptName} timed out after ${timeoutMs}ms\n${stderr || stdout}`));
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`${scriptName} terminated by signal ${signal}\n${stderr || stdout}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${scriptName} failed with code ${code}\n${stderr || stdout}`));
        return;
      }
      const json = extractTrailingJson(stdout);
      if (!json) {
        reject(new Error(`${scriptName} did not emit trailing JSON\n${stderr || stdout}`));
        return;
      }
      resolve({
        durationMs: Date.now() - startedAt,
        json,
      });
    });
  });
}

async function runColdStartRound(round, { includeBrowser = false, timeoutMs, operationalOnly = false } = {}) {
  const scriptConfig = resolveSmokeScriptConfig({ operationalOnly });
  logSoakProgress("cold-start round started", {
    round,
    script: scriptConfig.scriptName,
    timeoutMs,
  });
  try {
    const smokeRun = await runScriptJson(scriptConfig.scriptName, {
      env: operationalOnly || includeBrowser ? {} : { SMOKE_ALL_SKIP_BROWSER: "1" },
      timeoutMs,
    });
    const evaluation = evaluateColdStartRound(smokeRun.json, { operationalOnly });
    logSoakProgress("cold-start round finished", {
      round,
      ok: evaluation.ok,
      durationMs: smokeRun.durationMs,
    });
    return {
      round,
      ok: evaluation.ok,
      durationMs: smokeRun.durationMs,
      checks: evaluation.checks,
      mode: smokeRun.json.mode || null,
      script: scriptConfig.scriptName,
      operationalOnly,
      browserSkipped: operationalOnly ? true : smokeRun.json.browserSkipped === true,
    };
  } catch (error) {
    logSoakProgress("cold-start round failed", {
      round,
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
    });
    return {
      round,
      ok: false,
      durationMs: null,
      checks: [
        buildScenarioCheck(scriptConfig.roundCheckId, scriptConfig.roundCheckLabel, false, {
          error: error instanceof Error ? error.message : String(error),
        }),
      ],
      mode: null,
      script: scriptConfig.scriptName,
      operationalOnly,
      browserSkipped: operationalOnly || includeBrowser !== true,
    };
  }
}

async function runSharedStateRound(
  round,
  {
    baseUrl,
    sharedEnv = {},
    includeBrowser = false,
    timeoutMs,
    previousMetrics = null,
    operationalOnly = false,
  } = {}
) {
  const scriptConfig = resolveSmokeScriptConfig({ operationalOnly });
  logSoakProgress("shared-state round started", {
    round,
    script: scriptConfig.scriptName,
    timeoutMs,
  });
  try {
    const smokeRun = await runScriptJson(scriptConfig.scriptName, {
      env: {
        AGENT_PASSPORT_BASE_URL: baseUrl,
        ...sharedEnv,
        ...(operationalOnly || includeBrowser ? {} : { SMOKE_ALL_SKIP_BROWSER: "1" }),
      },
      timeoutMs,
    });
    const evaluation = evaluateSharedStateRound(smokeRun.json, {
      previousMetrics,
      operationalOnly,
    });
    logSoakProgress("shared-state round finished", {
      round,
      ok: evaluation.ok,
      durationMs: smokeRun.durationMs,
    });
    return {
      round,
      ok: evaluation.ok,
      durationMs: smokeRun.durationMs,
      checks: evaluation.checks,
      metrics: evaluation.metrics,
      mode: smokeRun.json.mode || null,
      script: scriptConfig.scriptName,
      operationalOnly,
      browserSkipped: operationalOnly ? true : smokeRun.json.browserSkipped === true,
    };
  } catch (error) {
    logSoakProgress("shared-state round failed", {
      round,
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
    });
    return {
      round,
      ok: false,
      durationMs: null,
      checks: [
        buildScenarioCheck(`shared_state_${scriptConfig.roundCheckId}`, `共享态${scriptConfig.roundCheckLabel}`, false, {
          error: error instanceof Error ? error.message : String(error),
        }),
      ],
      metrics: extractSharedStateMetrics({}),
      mode: null,
      script: scriptConfig.scriptName,
      operationalOnly,
      browserSkipped: operationalOnly || includeBrowser !== true,
    };
  }
}

async function forceKillChild(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGKILL");
  await Promise.race([
    once(child, "close"),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

async function runCrashRestartProbe() {
  logSoakProgress("crash-restart probe started");
  const resolvedBaseUrl = await resolveSmokeBaseUrl(null);
  const resolvedDataRoot = await prepareSmokeDataRoot({
    isolated: !resolvedBaseUrl.reuseExisting,
    tempPrefix: "agent-passport-soak-crash-",
  });
  let smokeServer = null;

  try {
    smokeServer = await ensureSmokeServer(resolvedBaseUrl.baseUrl, {
      reuseExisting: false,
      extraEnv: resolvedDataRoot.isolationEnv,
    });
    if (smokeServer?.started !== true || !smokeServer?.child) {
      throw new Error("crash restart probe requires an owned smoke server process");
    }
    const clientOptions = {
      baseUrl: smokeServer.baseUrl,
      rootDir,
      adminTokenFallbackPath: resolvedDataRoot.isolationEnv.AGENT_PASSPORT_ADMIN_TOKEN_PATH,
      adminTokenKeychainAccount: resolvedDataRoot.isolationEnv.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT,
    };
    const beforeCrashClient = createSmokeHttpClient(clientOptions);
    const marker = `soak-crash-${Date.now()}`;
    const createResponse = await beforeCrashClient.authorizedFetch("/api/agents/agent_openneed_agents/passport-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layer: "working",
        kind: "note",
        summary: marker,
        content: `abrupt exit durability probe ${marker}`,
        sourceWindowId: "window_soak_crash_probe",
        recordedByAgentId: "agent_openneed_agents",
        recordedByWindowId: "window_soak_crash_probe",
      }),
    });
    if (!createResponse.ok) {
      throw new Error(`/passport-memory create failed with HTTP ${createResponse.status}`);
    }
    const created = await createResponse.json();
    const memoryId = created.memory?.passportMemoryId || null;
    const beforeCrashMemories = await beforeCrashClient.getJson("/api/agents/agent_openneed_agents/passport-memory?limit=20");
    const visibleBeforeCrash = Array.isArray(beforeCrashMemories.memories)
      ? beforeCrashMemories.memories.some((entry) => entry?.passportMemoryId === memoryId)
      : false;

    await forceKillChild(smokeServer.child);

    smokeServer = await ensureSmokeServer(resolvedBaseUrl.baseUrl, {
      reuseExisting: false,
      extraEnv: resolvedDataRoot.isolationEnv,
    });
    if (smokeServer?.started !== true || !smokeServer?.child) {
      throw new Error("crash restart probe restart did not create an owned smoke server process");
    }
    const afterRestartClient = createSmokeHttpClient({
      ...clientOptions,
      baseUrl: smokeServer.baseUrl,
    });
    const healthAfterRestart = await afterRestartClient.publicGetJson("/api/health");
    const securityAfterRestart = await afterRestartClient.getJson("/api/security");
    const runtimeAfterRestart = await afterRestartClient.getJson("/api/device/runtime");
    const afterRestartMemories = await afterRestartClient.getJson("/api/agents/agent_openneed_agents/passport-memory?limit=20");
    const visibleAfterRestart = Array.isArray(afterRestartMemories.memories)
      ? afterRestartMemories.memories.some((entry) => entry?.passportMemoryId === memoryId)
      : false;
    const checks = buildCrashRestartChecks({
      memoryId,
      visibleBeforeCrash,
      healthAfterRestart,
      securityAfterRestart,
      runtimeAfterRestart,
      visibleAfterRestart,
    });
    const ok = checks.every((entry) => entry.passed === true);
    logSoakProgress("crash-restart probe finished", { ok });
    return {
      ok,
      checks,
      summary: ok
        ? "abrupt exit durability probe passed"
        : `abrupt exit durability probe failed: ${summarizeFailedChecks(checks).join(",")}`,
    };
  } catch (error) {
    logSoakProgress("crash-restart probe failed", {
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
    });
    return {
      ok: false,
      checks: [
        buildScenarioCheck("crash_restart_probe", "异常退出恢复探针完成", false, {
          error: error instanceof Error ? error.message : String(error),
        }),
      ],
      summary: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (smokeServer) {
      await smokeServer.stop();
    }
    await resolvedDataRoot.cleanup();
  }
}

async function runSharedStateSoak({
  rounds = 2,
  includeBrowser = false,
  timeoutMs = 10 * 60 * 1000,
  operationalOnly = false,
} = {}) {
  const resolvedBaseUrl = await resolveSmokeBaseUrl();
  const resolvedDataRoot = await prepareSmokeDataRoot({
    isolated: !resolvedBaseUrl.reuseExisting,
    tempPrefix: "agent-passport-soak-shared-",
  });
  let smokeServer = null;

  try {
    smokeServer = await ensureSmokeServer(resolvedBaseUrl.baseUrl, {
      reuseExisting: resolvedBaseUrl.reuseExisting,
      extraEnv: resolvedDataRoot.isolationEnv,
    });
    const sharedRounds = [];
    let previousMetrics = null;
    for (let round = 1; round <= rounds; round += 1) {
      const result = await runSharedStateRound(round, {
        baseUrl: smokeServer.baseUrl,
        sharedEnv: resolvedDataRoot.isolationEnv,
        includeBrowser,
        timeoutMs,
        previousMetrics,
        operationalOnly,
      });
      sharedRounds.push(result);
      previousMetrics = result.metrics || null;
    }
    return {
      ok: sharedRounds.every((entry) => entry?.ok === true),
      baseUrl: smokeServer.baseUrl,
      rounds: sharedRounds,
      isolationMode: resolvedBaseUrl.isolationMode,
      dataIsolationMode: resolvedDataRoot.dataIsolationMode,
      secretIsolationMode: resolvedDataRoot.secretIsolationMode,
    };
  } finally {
    if (smokeServer) {
      await smokeServer.stop();
    }
    await resolvedDataRoot.cleanup();
  }
}

async function main() {
  const rounds = toPositiveInteger(
    readArgValue("--rounds") || process.env.AGENT_PASSPORT_SOAK_ROUNDS,
    3
  );
  const operationalOnly =
    hasFlag("--operational-only") || process.env.AGENT_PASSPORT_SOAK_OPERATIONAL_ONLY === "1";
  const skipSharedState =
    hasFlag("--skip-shared-state") || process.env.AGENT_PASSPORT_SOAK_SKIP_SHARED_STATE === "1";
  const sharedStateRounds = skipSharedState
    ? 0
    : toPositiveInteger(
        readArgValue("--sharedRounds") || process.env.AGENT_PASSPORT_SOAK_SHARED_ROUNDS,
        Math.min(Math.max(rounds, 1), 2)
      );
  const includeBrowser =
    !operationalOnly && (hasFlag("--browser") || process.env.AGENT_PASSPORT_SOAK_INCLUDE_BROWSER === "1");
  const timeoutMs = toPositiveInteger(
    readArgValue("--timeoutMs") || process.env.AGENT_PASSPORT_SOAK_TIMEOUT_MS,
    10 * 60 * 1000
  );

  const coldStartRounds = [];
  for (let round = 1; round <= rounds; round += 1) {
    coldStartRounds.push(await runColdStartRound(round, { includeBrowser, timeoutMs, operationalOnly }));
  }
  const sharedState = sharedStateRounds > 0
    ? await runSharedStateSoak({
        rounds: sharedStateRounds,
        includeBrowser,
        timeoutMs,
        operationalOnly,
      })
    : {
        ok: true,
        baseUrl: null,
        rounds: [],
        skipped: true,
      };
  const crashRestart = await runCrashRestartProbe();
  const verdict = buildRuntimeStabilityVerdict({
    rounds: coldStartRounds,
    sharedStateRounds: sharedState.rounds,
    crashRestart,
    includeBrowser,
    operationalOnly,
  });

  console.log(
    JSON.stringify(
      {
        ok: verdict.ok,
        checkedAt: new Date().toISOString(),
        operationalOnly,
        includeBrowser,
        requestedRounds: rounds,
        sharedStateRounds,
        sharedState,
        coverage: verdict.coverage,
        timeoutMs,
        coldStartRounds,
        crashRestart,
        summary: verdict.summary,
      },
      null,
      2
    )
  );

  if (!verdict.ok) {
    throw new Error(verdict.summary);
  }
}

if (soakDirectExecution) {
  await main();
}

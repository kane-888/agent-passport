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

function buildRuntimeStabilitySummary({ rounds = [], crashRestart = null } = {}) {
  const failedRounds = (Array.isArray(rounds) ? rounds : []).filter((entry) => entry?.ok !== true);
  const crashRestartOk = crashRestart?.ok === true;
  const roundCount = Array.isArray(rounds) ? rounds.length : 0;
  const passedRounds = (Array.isArray(rounds) ? rounds : []).filter((entry) => entry?.ok === true).length;
  const failedRoundLabels = failedRounds.map(
    (entry) => `round_${entry.round}:${summarizeFailedChecks(entry.checks).join(",") || "unknown"}`
  );
  const failureParts = [
    failedRoundLabels.length > 0 ? `cold_start_failures=${failedRoundLabels.join(" ; ")}` : "",
    crashRestartOk ? "" : `crash_restart=${text(crashRestart?.summary) || "failed"}`,
  ].filter(Boolean);

  return {
    ok: failedRounds.length === 0 && crashRestartOk,
    coldStartRoundCount: roundCount,
    coldStartPassedCount: passedRounds,
    failedRounds: failedRounds.map((entry) => ({
      round: entry.round,
      failedChecks: summarizeFailedChecks(entry.checks),
    })),
    crashRestart,
    summary:
      failedRounds.length === 0 && crashRestartOk
        ? `runtime soak passed: coldStart=${passedRounds}/${roundCount} ; crashRestart=pass`
        : `runtime soak failed: ${failureParts.join(" ; ") || "unknown failure"}`,
  };
}

function buildColdStartChecks(smokeAllJson = {}) {
  const stepMap = new Map((Array.isArray(smokeAllJson.steps) ? smokeAllJson.steps : []).map((entry) => [entry?.name, entry?.result || null]));
  const ui = stepMap.get("smoke:ui:operational") || stepMap.get("smoke:ui") || null;
  const browserSemantics = smokeAllJson.browserUiSemantics?.status || null;

  return [
    buildScenarioCheck("smoke_all_ok", "整轮 smoke:all 通过", smokeAllJson.ok === true, {
      mode: smokeAllJson.mode || null,
    }),
    buildScenarioCheck("offline_fanout_gate", "offline fan-out gate 通过", smokeAllJson.offlineFanoutGate?.status === "passed", {
      status: smokeAllJson.offlineFanoutGate?.status || null,
      summary: smokeAllJson.offlineFanoutGate?.summary || null,
    }),
    buildScenarioCheck(
      "protective_state_semantics",
      "保护态语义通过",
      smokeAllJson.protectiveStateSemantics?.status === "passed",
      {
        status: smokeAllJson.protectiveStateSemantics?.status || null,
        summary: smokeAllJson.protectiveStateSemantics?.summary || null,
      }
    ),
    buildScenarioCheck(
      "operational_flow_semantics",
      "运行流程语义通过",
      smokeAllJson.operationalFlowSemantics?.status === "passed",
      {
        status: smokeAllJson.operationalFlowSemantics?.status || null,
        summary: smokeAllJson.operationalFlowSemantics?.summary || null,
      }
    ),
    buildScenarioCheck(
      "runtime_evidence_semantics",
      "runtime evidence 语义通过",
      smokeAllJson.runtimeEvidenceSemantics?.status === "passed",
      {
        status: smokeAllJson.runtimeEvidenceSemantics?.status || null,
        summary: smokeAllJson.runtimeEvidenceSemantics?.summary || null,
      }
    ),
    buildScenarioCheck(
      "browser_ui_semantics",
      "browser UI 语义通过或按预期跳过",
      browserSemantics === "passed" || browserSemantics === "skipped",
      {
        status: browserSemantics,
        summary: smokeAllJson.browserUiSemantics?.summary || null,
      }
    ),
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
    ),
    buildScenarioCheck(
      "window_rebind_guard",
      "窗口改绑防伪造稳定",
      ui?.forgedWindowRebindBlocked === true && ui?.windowBindingStableAfterRebind === true,
      {
        blocked: ui?.forgedWindowRebindBlocked ?? null,
        error: ui?.forgedWindowRebindError ?? null,
        bindingStable: ui?.windowBindingStableAfterRebind ?? null,
      }
    ),
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
    ),
  ];
}

export function evaluateColdStartRound(smokeAllJson = {}) {
  const checks = buildColdStartChecks(smokeAllJson);
  return {
    ok: checks.every((entry) => entry.passed === true),
    checks,
  };
}

export function buildRuntimeStabilityVerdict(input = {}) {
  return buildRuntimeStabilitySummary(input);
}

async function runScriptJson(scriptName, { env = {}, timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, "scripts", scriptName)], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
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
      child.kill("SIGTERM");
      reject(new Error(`${scriptName} timed out after ${timeoutMs}ms\n${stderr || stdout}`));
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
    child.on("exit", (code, signal) => {
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

async function runColdStartRound(round, { includeBrowser = false, timeoutMs } = {}) {
  try {
    const smokeAll = await runScriptJson("smoke-all.mjs", {
      env: includeBrowser ? {} : { SMOKE_ALL_SKIP_BROWSER: "1" },
      timeoutMs,
    });
    const evaluation = evaluateColdStartRound(smokeAll.json);
    return {
      round,
      ok: evaluation.ok,
      durationMs: smokeAll.durationMs,
      checks: evaluation.checks,
      mode: smokeAll.json.mode || null,
      browserSkipped: smokeAll.json.browserSkipped === true,
    };
  } catch (error) {
    return {
      round,
      ok: false,
      durationMs: null,
      checks: [
        buildScenarioCheck("smoke_all_round", "整轮 smoke:all 完成", false, {
          error: error instanceof Error ? error.message : String(error),
        }),
      ],
      mode: null,
      browserSkipped: includeBrowser !== true,
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
  const resolvedBaseUrl = await resolveSmokeBaseUrl();
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
    return {
      ok,
      checks,
      summary: ok
        ? "abrupt exit durability probe passed"
        : `abrupt exit durability probe failed: ${summarizeFailedChecks(checks).join(",")}`,
    };
  } catch (error) {
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

async function main() {
  const rounds = toPositiveInteger(
    readArgValue("--rounds") || process.env.AGENT_PASSPORT_SOAK_ROUNDS,
    3
  );
  const includeBrowser =
    hasFlag("--browser") || process.env.AGENT_PASSPORT_SOAK_INCLUDE_BROWSER === "1";
  const timeoutMs = toPositiveInteger(
    readArgValue("--timeoutMs") || process.env.AGENT_PASSPORT_SOAK_TIMEOUT_MS,
    10 * 60 * 1000
  );

  const coldStartRounds = [];
  for (let round = 1; round <= rounds; round += 1) {
    coldStartRounds.push(await runColdStartRound(round, { includeBrowser, timeoutMs }));
  }
  const crashRestart = await runCrashRestartProbe();
  const verdict = buildRuntimeStabilityVerdict({
    rounds: coldStartRounds,
    crashRestart,
  });

  console.log(
    JSON.stringify(
      {
        ok: verdict.ok,
        checkedAt: new Date().toISOString(),
        includeBrowser,
        requestedRounds: rounds,
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

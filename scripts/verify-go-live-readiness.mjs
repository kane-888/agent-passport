import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { printCliError, printCliResult } from "./structured-cli-output.mjs";
import { verifyPublicDeployHttp } from "./verify-public-deploy-http.mjs";
import {
  adoptBlockedItems,
  createBlockedItem,
  finalizeBlockedOutcome,
  formatOperatorSummary,
} from "./verifier-outcome-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const GO_LIVE_RERUN_COMMAND = "npm run verify:go-live";
const GO_LIVE_MACHINE_READABLE_COMMAND = "npm run --silent verify:go-live";
const DEFAULT_SMOKE_ALL_TIMEOUT_MS = 360000;
const DIRECT_ADMIN_TOKEN_ENV_KEYS = ["AGENT_PASSPORT_ADMIN_TOKEN", "AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN"];
const smokeAllScriptPath = text(process.env.AGENT_PASSPORT_SMOKE_ALL_SCRIPT)
  ? path.resolve(process.env.AGENT_PASSPORT_SMOKE_ALL_SCRIPT)
  : path.join(rootDir, "scripts", "smoke-all.mjs");

function text(value) {
  return String(value ?? "").trim();
}

const NON_ACTIONABLE_NEXT_ACTIONS = new Set(["ready", "ok", "passed", "clear", "blocked", "normal", "none", "unknown"]);

function pickActionableNextAction(value = "", fallback = null) {
  const normalized = text(value);
  if (!normalized) {
    return fallback;
  }
  return NON_ACTIONABLE_NEXT_ACTIONS.has(normalized.toLowerCase()) ? fallback : normalized;
}

function extractTrailingJson(output = "") {
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

export function resolveSmokeAllTimeoutMs() {
  const parsed = Number.parseInt(text(process.env.AGENT_PASSPORT_SMOKE_ALL_TIMEOUT_MS), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SMOKE_ALL_TIMEOUT_MS;
}

export function buildSmokeAllChildEnv(baseEnv = process.env) {
  const env = {
    ...baseEnv,
    AGENT_PASSPORT_BASE_URL: "",
    SMOKE_ALL_SKIP_BROWSER: "0",
    SMOKE_ALL_REQUIRE_BROWSER: "1",
  };
  for (const key of DIRECT_ADMIN_TOKEN_ENV_KEYS) {
    env[key] = "";
  }
  return env;
}

function terminateSmokeProcess(child) {
  if (!child?.pid) {
    return;
  }
  const sendSignal = (signal) => {
    try {
      if (process.platform !== "win32") {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {}
  };
  sendSignal("SIGTERM");
  const killTimer = setTimeout(() => {
    sendSignal("SIGKILL");
  }, 250);
  child.once("exit", () => clearTimeout(killTimer));
}

function runSmokeAllGate({ timeoutMs = resolveSmokeAllTimeoutMs() } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [smokeAllScriptPath], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: buildSmokeAllChildEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      // Keep the parent stdout reserved for the final structured verdict.
      process.stderr.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      process.stderr.write(chunk);
    });
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      terminateSmokeProcess(child);
      resolve({
        ok: false,
        timedOut: true,
        timeoutMs,
        errorClass: "smoke_all_timeout",
        error: `smoke:all timed out after ${timeoutMs}ms`,
        parsedResult: extractTrailingJson(stdout),
      });
    }, timeoutMs);
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      const result = extractTrailingJson(stdout);
      if (code !== 0) {
        resolve({
          ok: false,
          errorClass: "smoke_all_failed",
          error: text(stderr || stdout) || `smoke:all failed with code ${code}`,
          parsedResult: result,
        });
        return;
      }
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        resolve({
          ok: false,
          errorClass: "smoke_all_unstructured_output",
          error: "smoke:all exited without structured JSON verdict",
          parsedResult: null,
        });
        return;
      }
      resolve(result);
    });
  });
}

function getCheck(readiness = null, id = "") {
  return (Array.isArray(readiness?.checks) ? readiness.checks : []).find((entry) => entry?.id === id) || null;
}

function buildBlockedItem(id, label, detail, options = {}) {
  return createBlockedItem(id, label, detail, {
    rerunCommand: GO_LIVE_RERUN_COMMAND,
    machineReadableCommand: GO_LIVE_MACHINE_READABLE_COMMAND,
    ...options,
  });
}

function pushBlockedItem(target, item) {
  if (!item?.id) {
    return;
  }
  if (target.some((entry) => entry?.id === item.id)) {
    return;
  }
  target.push(item);
}

function buildSkippedSmokeResult(reason = "", detail = "") {
  return {
    ok: null,
    skipped: true,
    skipReason: reason || "preflight_short_circuit",
    summary: detail || "当前已在 preflight 阶段短路，未执行 smoke:all。",
  };
}

function smokeGateStatus(smoke = null, key = "") {
  return text(smoke?.[key]?.status) || null;
}

function buildSmokeGateCheck(smoke = null, id = "", label = "", key = "") {
  const status = smokeGateStatus(smoke, key);
  return {
    id,
    label,
    passed: status === "passed",
    actual: status,
    detail: smoke?.[key]?.summary || null,
  };
}

function smokeGateFailureIsSpecific(check = null) {
  return text(check?.actual).length > 0 && check.actual !== "passed";
}

function orderSmokeReleaseBlockedChecks(failedChecks = []) {
  const specificFailures = failedChecks.filter((entry) => entry.id !== "smoke_release_ok" && smokeGateFailureIsSpecific(entry));
  const smokeReleaseFailure = failedChecks.find((entry) => entry.id === "smoke_release_ok") || null;
  const unknownSpecificFailures = failedChecks.filter((entry) => entry.id !== "smoke_release_ok" && !smokeGateFailureIsSpecific(entry));
  return [
    ...specificFailures,
    ...(specificFailures.length === 0 && smokeReleaseFailure ? [smokeReleaseFailure] : []),
    ...unknownSpecificFailures,
  ];
}

function buildLocalReleaseReadiness(smoke = null) {
  const checks = [
    {
      id: "smoke_release_ok",
      label: "smoke:all 通过",
      passed: smoke?.ok === true,
      actual: smoke?.ok ?? null,
      detail: text(smoke?.mode) ? `smoke:all 模式：${text(smoke.mode)}` : text(smoke?.error) || null,
    },
    buildSmokeGateCheck(smoke, "offline_fanout_gate", "offline fan-out 门禁通过", "offlineFanoutGate"),
    buildSmokeGateCheck(smoke, "protective_state_semantics", "保护态语义通过", "protectiveStateSemantics"),
    buildSmokeGateCheck(smoke, "operational_flow_semantics", "执行态语义通过", "operationalFlowSemantics"),
    buildSmokeGateCheck(smoke, "runtime_evidence_semantics", "运行证据语义通过", "runtimeEvidenceSemantics"),
    buildSmokeGateCheck(smoke, "browser_ui_semantics", "浏览器 UI 语义通过", "browserUiSemantics"),
  ];

  const failedChecks = checks.filter((entry) => entry.passed === false);
  const blockedBy = orderSmokeReleaseBlockedChecks(failedChecks).map((entry) =>
    buildBlockedItem(entry.id, entry.label, entry.detail || `${entry.label} 未通过。`, {
      actual: entry.actual ?? null,
      expected: entry.id === "smoke_release_ok" ? true : "passed",
      nextAction:
        entry.id === "smoke_release_ok"
          ? "先修复 smoke:all 主流程失败项，再重新运行 verify:go-live。"
          : "先修复对应 smoke gate，再重新运行 verify:go-live。",
      nextActionSummary:
        entry.id === "smoke_release_ok" ? "先修复 smoke:all 主流程失败项" : "先修复对应 smoke gate",
      source: "local",
      rerunCommand: GO_LIVE_RERUN_COMMAND,
      machineReadableCommand: GO_LIVE_MACHINE_READABLE_COMMAND,
    })
  );
  const outcome = finalizeBlockedOutcome({
    blockedBy,
    fallbackNextAction: "继续补齐 deploy URL 与公网 HTTP 校验，完成最终上线放行。",
  });
  const summary =
    failedChecks.length === 0
      ? "本地 smoke、浏览器门禁和运行语义检查已一致通过。"
      : outcome.firstBlocker?.detail || "本地门禁尚未通过。";

  return {
    status: failedChecks.length === 0 ? "ready" : "blocked",
    readinessClass: failedChecks.length === 0 ? "local_ready" : "blocked",
    checkedAt: new Date().toISOString(),
    checks,
    blockedBy: outcome.blockedBy,
    firstBlocker: outcome.firstBlocker,
    summary,
    nextAction: outcome.nextAction,
    operatorSummary: formatOperatorSummary({
      firstBlocker: outcome.firstBlocker,
      nextAction: outcome.nextAction,
      readySummary: summary,
      blockedSummary: summary,
    }),
  };
}

export async function verifyGoLiveReadiness({ envFilePath = undefined } = {}) {
  const deployVerifierUnexpectedBlocker = buildBlockedItem(
    "deploy_verifier_unexpected_error",
    "deploy verifier 执行异常",
    null,
    {
      nextAction: "先修复 verify:deploy:http 自身异常，再重新运行 verify:go-live。",
      nextActionSummary: "先修复 verify:deploy:http 自身异常",
      source: "deploy",
    }
  );
  const deployPreflight = await verifyPublicDeployHttp({ envFilePath }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.stack || error.message : String(error),
    checks: [],
    blockedBy: [
      {
        ...deployVerifierUnexpectedBlocker,
        detail: error instanceof Error ? error.stack || error.message : String(error),
      },
    ],
    firstBlocker: {
      ...deployVerifierUnexpectedBlocker,
      detail: error instanceof Error ? error.stack || error.message : String(error),
    },
    releaseReadiness: null,
    summary: "deploy HTTP 验证执行失败。",
    nextAction: "先修复 verify:deploy:http 自身异常，再重新运行 verify:go-live。",
    errorClass: "deploy_verifier_unexpected_error",
    errorStage: "preflight",
  }));
  if (deployPreflight?.errorClass === "deploy_verifier_unexpected_error") {
    const smoke = buildSkippedSmokeResult("deploy_verifier_unexpected_error", "deploy verifier 自身异常，未执行 smoke:all。");
    const outcome = finalizeBlockedOutcome({
      blockedBy: adoptBlockedItems(deployPreflight?.blockedBy, {
        source: "deploy",
        nextAction: text(deployPreflight?.nextAction) || null,
        rerunCommand: GO_LIVE_RERUN_COMMAND,
        machineReadableCommand: GO_LIVE_MACHINE_READABLE_COMMAND,
      }),
      fallbackNextAction: "先修复 verify:deploy:http 自身异常，再重新运行 verify:go-live。",
    });
    const summary = text(deployPreflight?.summary) || "deploy HTTP 验证执行失败。";
    return {
      ok: false,
      rerunCommand: GO_LIVE_RERUN_COMMAND,
      machineReadableCommand: GO_LIVE_MACHINE_READABLE_COMMAND,
      readinessClass: "blocked",
      checkedAt: new Date().toISOString(),
      preflightShortCircuited: true,
      smoke,
      deploy: deployPreflight,
      localReleaseReadiness: null,
      runtimeReleaseReadiness: null,
      checks: [
        {
          id: "smoke_release_ok",
          label: "smoke:all 通过",
          passed: false,
          skipped: true,
          actual: null,
          detail: smoke.summary,
        },
        {
          id: "deploy_http_ok",
          label: "deploy HTTP 验证通过",
          passed: false,
          actual: deployPreflight?.ok ?? null,
          detail: text(deployPreflight?.summary) || "deploy HTTP 验证执行失败。",
        },
      ],
      ...outcome,
      summary,
      operatorSummary: formatOperatorSummary({
        firstBlocker: outcome.firstBlocker,
        nextAction: outcome.nextAction,
        blockedSummary: summary,
      }),
    };
  }
  if (deployPreflight?.errorClass === "missing_deploy_base_url") {
    const smoke = await runSmokeAllGate();
    const localReleaseReadiness = buildLocalReleaseReadiness(smoke);
    const localReady = localReleaseReadiness.status === "ready";
    const result = {
      ok: false,
      rerunCommand: GO_LIVE_RERUN_COMMAND,
      machineReadableCommand: GO_LIVE_MACHINE_READABLE_COMMAND,
      readinessClass: localReady ? "local_ready_deploy_pending" : "local_gate_blocked",
      errorClass: "missing_deploy_base_url",
      errorStage: "preflight",
      checkedAt: new Date().toISOString(),
      // Missing deploy URL blocks public deploy/runtime checks, but we still continue
      // through local smoke gates so operators can see whether the host is locally ready.
      preflightShortCircuited: false,
      smoke,
      deploy: deployPreflight,
      localReleaseReadiness,
      runtimeReleaseReadiness: null,
      checks: [
        {
          id: "smoke_release_ok",
          label: "smoke:all 通过",
          passed: smoke?.ok === true,
          actual: smoke?.ok ?? null,
          detail: text(smoke?.mode) ? `smoke:all 模式：${text(smoke.mode)}` : text(smoke?.error) || null,
        },
        {
          id: "offline_fanout_gate",
          label: "smoke:all 内部 offlineFanoutGate 已通过",
          passed: smokeGateStatus(smoke, "offlineFanoutGate") === "passed",
          actual: smokeGateStatus(smoke, "offlineFanoutGate"),
          detail: smoke?.offlineFanoutGate?.summary || null,
        },
        {
          id: "protective_state_semantics",
          label: "保护态语义通过",
          passed: smokeGateStatus(smoke, "protectiveStateSemantics") === "passed",
          actual: smokeGateStatus(smoke, "protectiveStateSemantics"),
          detail: smoke?.protectiveStateSemantics?.summary || null,
        },
        {
          id: "operational_flow_semantics",
          label: "执行态语义通过",
          passed: smokeGateStatus(smoke, "operationalFlowSemantics") === "passed",
          actual: smokeGateStatus(smoke, "operationalFlowSemantics"),
          detail: smoke?.operationalFlowSemantics?.summary || null,
        },
        {
          id: "runtime_evidence_semantics",
          label: "运行证据语义通过",
          passed: smokeGateStatus(smoke, "runtimeEvidenceSemantics") === "passed",
          actual: smokeGateStatus(smoke, "runtimeEvidenceSemantics"),
          detail: smoke?.runtimeEvidenceSemantics?.summary || null,
        },
        {
          id: "browser_ui_semantics",
          label: "浏览器 UI 语义通过",
          passed: smokeGateStatus(smoke, "browserUiSemantics") === "passed",
          actual: smokeGateStatus(smoke, "browserUiSemantics"),
          detail: smoke?.browserUiSemantics?.summary || null,
        },
        {
          id: "deploy_http_ok",
          label: "deploy HTTP 验证通过",
          passed: false,
          skipped: true,
          actual: deployPreflight?.ok ?? null,
          detail: "缺少正式 deploy URL，公网 HTTP 放行检查暂挂起。",
        },
        {
          id: "admin_token_present",
          label: "已提供管理令牌",
          passed: deployPreflight?.adminTokenProvided === true,
          actual: deployPreflight?.adminTokenProvided ?? null,
          detail:
            deployPreflight?.adminTokenProvided === true
              ? "管理令牌已提供，后续 deploy 校验可直接复用。"
              : "缺少 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN（或 AGENT_PASSPORT_ADMIN_TOKEN），后续 deploy 校验仍不完整。",
        },
        {
          id: "runtime_release_ready",
          label: "公网运行态放行前提已满足",
          passed: false,
          skipped: true,
          actual: null,
          detail: "缺少正式 deploy URL，当前还不能执行 deploy 侧运行态放行判定。",
        },
      ],
      ...(() => {
        const blockedBy = [
          ...adoptBlockedItems(localReleaseReadiness?.blockedBy, {
            source: "local",
            rerunCommand: GO_LIVE_RERUN_COMMAND,
            machineReadableCommand: GO_LIVE_MACHINE_READABLE_COMMAND,
          }),
          ...adoptBlockedItems(deployPreflight?.blockedBy, {
            source: "deploy",
            nextAction: text(deployPreflight?.nextAction) || null,
            rerunCommand: GO_LIVE_RERUN_COMMAND,
            machineReadableCommand: GO_LIVE_MACHINE_READABLE_COMMAND,
          }),
        ];
        return finalizeBlockedOutcome({
          blockedBy,
          nextActionCandidates: [
            localReady ? text(deployPreflight?.nextAction) : text(localReleaseReadiness?.nextAction),
            localReady ? null : text(deployPreflight?.nextAction),
          ],
          fallbackNextAction: localReady
            ? "先设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重新运行 verify:go-live。"
            : "先修复本地门禁失败项，再重新运行 verify:go-live。",
        });
      })(),
      summary: localReady
        ? "本地门禁已通过，但缺少正式 deploy URL，公网 HTTP 放行仍待补齐。"
        : localReleaseReadiness?.summary || text(deployPreflight?.summary) || "本地门禁或 deploy 前提尚未完成。",
    };
    result.operatorSummary = formatOperatorSummary({
      firstBlocker: result.firstBlocker,
      nextAction: result.nextAction,
      readySummary: result.summary,
      blockedSummary: result.summary,
    });
    return result;
  }

  const smoke = await runSmokeAllGate();
  const deploy = deployPreflight;
  const runtimeReadiness = deploy.releaseReadiness || null;
  const smokeOk = smoke?.ok === true;
  const offlineFanoutPassed = text(smoke?.offlineFanoutGate?.status) === "passed";
  const protectiveStatePassed = text(smoke?.protectiveStateSemantics?.status) === "passed";
  const operationalFlowPassed = text(smoke?.operationalFlowSemantics?.status) === "passed";
  const runtimeEvidencePassed = text(smoke?.runtimeEvidenceSemantics?.status) === "passed";
  const browserUiPassed = text(smoke?.browserUiSemantics?.status) === "passed";
  const deployOk = deploy?.ok === true;
  const runtimeReady = text(runtimeReadiness?.status) === "ready";
  const adminTokenProvided = deploy?.adminTokenProvided === true;
  const securityNormal = getCheck(runtimeReadiness, "security_posture_normal")?.passed === true;
  const constrainedReady = getCheck(runtimeReadiness, "constrained_execution_ready")?.passed === true;

  let readinessClass = "blocked";
  if (smokeOk && offlineFanoutPassed && deployOk && runtimeReady && adminTokenProvided) {
    readinessClass = "go_live_ready";
  } else if (smokeOk && deployOk && securityNormal && constrainedReady) {
    readinessClass = "private_pilot_only";
  } else if (smokeOk && deployOk) {
    readinessClass = "internal_alpha_only";
  }

  const checks = [
    {
      id: "smoke_release_ok",
      label: "smoke:all 通过",
      passed: smokeOk,
      actual: smoke?.ok ?? null,
      detail: smoke?.offlineFanoutGate?.summary || text(smoke?.error) || null,
    },
    {
      id: "offline_fanout_gate",
      label: "smoke:all 内部 offlineFanoutGate 已通过",
      passed: offlineFanoutPassed,
      actual: text(smoke?.offlineFanoutGate?.status) || null,
      detail: smoke?.offlineFanoutGate?.summary || null,
    },
    {
      id: "protective_state_semantics",
      label: "保护态语义通过",
      passed: protectiveStatePassed,
      actual: text(smoke?.protectiveStateSemantics?.status) || null,
      detail: smoke?.protectiveStateSemantics?.summary || null,
    },
    {
      id: "operational_flow_semantics",
      label: "执行态语义通过",
      passed: operationalFlowPassed,
      actual: text(smoke?.operationalFlowSemantics?.status) || null,
      detail: smoke?.operationalFlowSemantics?.summary || null,
    },
    {
      id: "runtime_evidence_semantics",
      label: "运行证据语义通过",
      passed: runtimeEvidencePassed,
      actual: text(smoke?.runtimeEvidenceSemantics?.status) || null,
      detail: smoke?.runtimeEvidenceSemantics?.summary || null,
    },
    {
      id: "browser_ui_semantics",
      label: "浏览器 UI 语义通过",
      passed: browserUiPassed,
      actual: text(smoke?.browserUiSemantics?.status) || null,
      detail: smoke?.browserUiSemantics?.summary || null,
    },
    {
      id: "deploy_http_ok",
      label: "deploy HTTP 验证通过",
      passed: deployOk,
      actual: deploy?.ok ?? null,
      detail: text(deploy?.summary) || null,
    },
    {
      id: "admin_token_present",
      label: "已提供管理令牌",
      passed: adminTokenProvided,
      actual: adminTokenProvided,
      detail: adminTokenProvided
        ? "管理令牌已提供。"
        : "缺少 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN（或 AGENT_PASSPORT_ADMIN_TOKEN），正式放行判断仍不完整。",
    },
    {
      id: "runtime_release_ready",
      label: "运行态放行前提已满足",
      passed: runtimeReady,
      actual: text(runtimeReadiness?.status) || null,
      detail: text(runtimeReadiness?.summary) || null,
    },
  ];

  const failedChecks = checks.filter((entry) => entry.passed === false);
  const orderedFailedSmokeChecks = orderSmokeReleaseBlockedChecks(
    failedChecks.filter((entry) =>
      [
        "smoke_release_ok",
        "offline_fanout_gate",
        "protective_state_semantics",
        "operational_flow_semantics",
        "runtime_evidence_semantics",
        "browser_ui_semantics",
      ].includes(entry.id)
    )
  );
  const blockedBy = [];

  if (orderedFailedSmokeChecks.some((entry) => entry.id === "smoke_release_ok")) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem(
        "smoke_release_ok",
        "smoke:all 未通过",
        smoke?.offlineFanoutGate?.summary || text(smoke?.error) || "smoke:all 未通过。",
        {
          actual: smoke?.ok ?? null,
          expected: true,
          nextAction: "先修复 smoke:all 失败项，再重新运行 verify:go-live。",
          nextActionSummary: "先修复 smoke:all 失败项",
          source: "smoke",
        }
      )
    );
  }

  if (orderedFailedSmokeChecks.some((entry) => entry.id === "offline_fanout_gate")) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem(
        "offline_fanout_gate",
        "offlineFanoutGate 未通过",
        smoke?.offlineFanoutGate?.summary || "offlineFanoutGate 当前没有通过。",
        {
          actual: text(smoke?.offlineFanoutGate?.status) || null,
          expected: "passed",
          nextAction: "先修复 offline fan-out gate，再重新运行 verify:go-live。",
          nextActionSummary: "先修复 offline fan-out gate",
          source: "smoke",
        }
      )
    );
  }

  if (orderedFailedSmokeChecks.some((entry) => entry.id === "protective_state_semantics")) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem(
        "protective_state_semantics",
        "保护态语义未通过",
        smoke?.protectiveStateSemantics?.summary || "protectiveStateSemantics 当前没有通过。",
        {
          actual: text(smoke?.protectiveStateSemantics?.status) || null,
          expected: "passed",
          nextAction: "先修复 protective-state semantics，再重新运行 verify:go-live。",
          nextActionSummary: "先修复 protective-state semantics",
          source: "smoke",
        }
      )
    );
  }

  if (orderedFailedSmokeChecks.some((entry) => entry.id === "operational_flow_semantics")) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem(
        "operational_flow_semantics",
        "执行态语义未通过",
        smoke?.operationalFlowSemantics?.summary || "operationalFlowSemantics 当前没有通过。",
        {
          actual: text(smoke?.operationalFlowSemantics?.status) || null,
          expected: "passed",
          nextAction: "先修复 operational-flow semantics，再重新运行 verify:go-live。",
          nextActionSummary: "先修复 operational-flow semantics",
          source: "smoke",
        }
      )
    );
  }

  if (orderedFailedSmokeChecks.some((entry) => entry.id === "runtime_evidence_semantics")) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem(
        "runtime_evidence_semantics",
        "运行证据语义未通过",
        smoke?.runtimeEvidenceSemantics?.summary || "runtimeEvidenceSemantics 当前没有通过。",
        {
          actual: text(smoke?.runtimeEvidenceSemantics?.status) || null,
          expected: "passed",
          nextAction: "先修复 runtime-evidence semantics，再重新运行 verify:go-live。",
          nextActionSummary: "先修复 runtime-evidence semantics",
          source: "smoke",
        }
      )
    );
  }

  if (orderedFailedSmokeChecks.some((entry) => entry.id === "browser_ui_semantics")) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem(
        "browser_ui_semantics",
        "浏览器 UI 语义未通过",
        smoke?.browserUiSemantics?.summary || "browserUiSemantics 当前没有通过。",
        {
          actual: text(smoke?.browserUiSemantics?.status) || null,
          expected: "passed",
          nextAction: "先修复 browser-ui semantics，再重新运行 verify:go-live。",
          nextActionSummary: "先修复 browser-ui semantics",
          source: "smoke",
        }
      )
    );
  }

  for (const entry of adoptBlockedItems(deploy?.blockedBy, {
    source: "deploy",
    nextAction: text(deploy?.nextAction) || null,
    rerunCommand: GO_LIVE_RERUN_COMMAND,
    machineReadableCommand: GO_LIVE_MACHINE_READABLE_COMMAND,
  })) {
    pushBlockedItem(
      blockedBy,
      entry
    );
  }

  if (!runtimeReady) {
    for (const entry of adoptBlockedItems(runtimeReadiness?.blockedBy, {
      source: "runtime",
      nextAction: pickActionableNextAction(runtimeReadiness?.nextAction, null),
      rerunCommand: GO_LIVE_RERUN_COMMAND,
      machineReadableCommand: GO_LIVE_MACHINE_READABLE_COMMAND,
    })) {
      pushBlockedItem(
        blockedBy,
        entry
      );
    }
    if (!runtimeReadiness && !blockedBy.some((entry) => entry.id === "runtime_release_ready")) {
      pushBlockedItem(
        blockedBy,
        buildBlockedItem("runtime_release_ready", "运行态放行前提未完成", "当前还没拿到可用的运行态放行判定。", {
          actual: null,
          expected: "ready",
          nextAction: "先补齐 deploy HTTP 校验与管理面前提，再重新运行 verify:go-live。",
          nextActionSummary: "先补齐 deploy HTTP 校验与管理面前提",
          source: "runtime",
        })
      );
    }
  }

  const outcome = finalizeBlockedOutcome({
    blockedBy,
    nextActionCandidates: [text(deploy?.nextAction), pickActionableNextAction(runtimeReadiness?.nextAction)],
    fallbackNextAction: "先补齐最先失败的放行检查，再重新运行 verify:go-live。",
  });
  const summary =
    failedChecks.length === 0
      ? "smoke:all、deploy HTTP 验证与运行态放行前提已一致通过。"
      : (outcome.firstBlocker?.source === "deploy" && text(deploy?.summary)) ||
        (outcome.firstBlocker?.source === "runtime" && text(runtimeReadiness?.summary)) ||
        outcome.firstBlocker?.detail ||
        failedChecks[0]?.detail ||
        failedChecks[0]?.label ||
        "当前还不满足统一放行条件。";
  const result = {
    ok: failedChecks.length === 0,
    readinessClass,
    errorClass: failedChecks.length === 0 ? null : "deploy_check_failed",
    errorStage: failedChecks.length === 0 ? null : "checks",
    checkedAt: new Date().toISOString(),
    smoke,
    deploy,
    runtimeReleaseReadiness: runtimeReadiness,
    checks,
    blockedBy: outcome.blockedBy,
    firstBlocker: outcome.firstBlocker,
    rerunCommand: GO_LIVE_RERUN_COMMAND,
    machineReadableCommand: GO_LIVE_MACHINE_READABLE_COMMAND,
    summary,
    nextAction: outcome.nextAction,
    operatorSummary: formatOperatorSummary({
      firstBlocker: outcome.firstBlocker,
      nextAction: outcome.nextAction,
      readySummary: summary,
      blockedSummary: summary,
    }),
  };

  return result;
}

async function main() {
  const result = await verifyGoLiveReadiness();
  await printCliResult(result);
}

const isDirectRun = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;

if (isDirectRun) {
  main().catch((error) => {
    return printCliError(error);
  });
}

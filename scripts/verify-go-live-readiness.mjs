import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyPublicDeployHttp } from "./verify-public-deploy-http.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

function text(value) {
  return String(value ?? "").trim();
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

function runSmokeAllGate() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, "scripts", "smoke-all.mjs")], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENT_PASSPORT_BASE_URL: "",
        SMOKE_ALL_SKIP_BROWSER: "0",
        SMOKE_ALL_REQUIRE_BROWSER: "1",
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
    child.on("exit", (code) => {
      const result = extractTrailingJson(stdout);
      if (code !== 0) {
        resolve({
          ok: false,
          error: text(stderr || stdout) || `smoke:all failed with code ${code}`,
          parsedResult: result,
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

function buildBlockedItem(id, label, detail, { actual = null, expected = null, nextAction = null, source = null } = {}) {
  return {
    id,
    label,
    detail,
    actual,
    expected,
    nextAction,
    source,
  };
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

async function main() {
  const deployPreflight = await verifyPublicDeployHttp().catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.stack || error.message : String(error),
    checks: [],
    blockedBy: [
      buildBlockedItem(
        "deploy_verifier_unexpected_error",
        "deploy verifier 执行异常",
        error instanceof Error ? error.stack || error.message : String(error),
        {
          nextAction: "先修复 verify:deploy:http 自身异常，再重新运行 verify:go-live。",
          source: "deploy",
        }
      ),
    ],
    releaseReadiness: null,
    summary: "deploy HTTP 验证执行失败。",
    nextAction: "先修复 verify:deploy:http 自身异常，再重新运行 verify:go-live。",
  }));
  if (deployPreflight?.errorClass === "missing_deploy_base_url") {
    const result = {
      ok: false,
      readinessClass: "blocked",
      checkedAt: new Date().toISOString(),
      preflightShortCircuited: true,
      smoke: buildSkippedSmokeResult(
        "missing_deploy_base_url",
        "缺少正式 deploy URL，统一放行验证已在 preflight 阶段短路；如只想看本地门禁，请改跑 npm run smoke:all。"
      ),
      deploy: deployPreflight,
      runtimeReleaseReadiness: null,
      checks: [
        {
          id: "smoke_release_ok",
          label: "smoke:all 通过",
          passed: false,
          skipped: true,
          actual: null,
          detail: "缺少正式 deploy URL，当前未执行 smoke:all；如只想验证本地门禁，请改跑 npm run smoke:all。",
        },
        {
          id: "offline_fanout_gate",
          label: "smoke:all 内部 offlineFanoutGate 已通过",
          passed: false,
          skipped: true,
          actual: null,
          detail: "缺少正式 deploy URL，当前未执行 smoke:all，因此也没有 offlineFanoutGate 结果。",
        },
        {
          id: "deploy_http_ok",
          label: "deploy HTTP 验证通过",
          passed: false,
          actual: deployPreflight?.ok ?? null,
          detail: text(deployPreflight?.summary) || null,
        },
        {
          id: "admin_token_present",
          label: "已提供管理令牌",
          passed: deployPreflight?.adminTokenProvided === true,
          actual: deployPreflight?.adminTokenProvided ?? null,
          detail:
            deployPreflight?.adminTokenProvided === true
              ? "管理令牌已提供。"
              : "缺少 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN（或 AGENT_PASSPORT_ADMIN_TOKEN），正式放行判断仍不完整。",
        },
        {
          id: "runtime_release_ready",
          label: "运行态放行前提已满足",
          passed: false,
          skipped: true,
          actual: null,
          detail: "缺少正式 deploy URL，当前还不能执行 deploy 侧运行态放行判定。",
        },
      ],
      blockedBy: [
        ...((Array.isArray(deployPreflight?.blockedBy) ? deployPreflight.blockedBy : []).map((entry) => ({
          ...entry,
          source: "deploy",
        }))),
        buildBlockedItem("runtime_release_ready", "运行态放行前提未完成", "缺少正式 deploy URL，当前还不能执行 deploy 侧运行态放行判定。", {
          actual: null,
          expected: "ready",
          nextAction: "先设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重新运行 verify:go-live。",
          source: "runtime",
        }),
      ],
      summary: text(deployPreflight?.summary) || "缺少正式 deploy URL，统一放行验证未开始。",
      nextAction:
        text(deployPreflight?.nextAction) ||
        "先设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重新运行 verify:go-live。",
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const smoke = await runSmokeAllGate();
  const deploy = deployPreflight;
  const runtimeReadiness = deploy.releaseReadiness || null;
  const smokeOk = smoke?.ok === true;
  const offlineFanoutPassed = text(smoke?.offlineFanoutGate?.status) === "passed";
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
  const blockedBy = [];

  if (!smokeOk) {
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
          source: "smoke",
        }
      )
    );
  }

  if (!offlineFanoutPassed) {
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
          source: "smoke",
        }
      )
    );
  }

  for (const entry of Array.isArray(deploy?.blockedBy) ? deploy.blockedBy : []) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem(entry.id, entry.label, entry.detail, {
        actual: entry.actual ?? null,
        expected: entry.expected ?? null,
        nextAction: entry.nextAction || deploy?.nextAction || null,
        source: "deploy",
      })
    );
  }

  if (!runtimeReady) {
    for (const entry of Array.isArray(runtimeReadiness?.blockedBy) ? runtimeReadiness.blockedBy : []) {
      pushBlockedItem(
        blockedBy,
        buildBlockedItem(entry.id, entry.label, entry.detail, {
          actual: entry.actual ?? null,
          expected: entry.expected ?? null,
          nextAction: text(runtimeReadiness?.nextAction) || null,
          source: "runtime",
        })
      );
    }
    if (!runtimeReadiness && !blockedBy.some((entry) => entry.id === "runtime_release_ready")) {
      pushBlockedItem(
        blockedBy,
        buildBlockedItem("runtime_release_ready", "运行态放行前提未完成", "当前还没拿到可用的运行态放行判定。", {
          actual: null,
          expected: "ready",
          nextAction: "先补齐 deploy HTTP 校验与管理面前提，再重新运行 verify:go-live。",
          source: "runtime",
        })
      );
    }
  }

  const result = {
    ok: failedChecks.length === 0,
    readinessClass,
    checkedAt: new Date().toISOString(),
    smoke,
    deploy,
    runtimeReleaseReadiness: runtimeReadiness,
    checks,
    blockedBy,
    summary:
      failedChecks.length === 0
        ? "smoke:all、deploy HTTP 验证与运行态放行前提已一致通过。"
        : blockedBy[0]?.detail || failedChecks[0]?.detail || failedChecks[0]?.label || "当前还不满足统一放行条件。",
    nextAction:
      blockedBy[0]?.nextAction ||
      text(deploy?.nextAction) ||
      text(runtimeReadiness?.nextAction) ||
      "先补齐最先失败的放行检查，再重新运行 verify:go-live。",
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.stack || error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});

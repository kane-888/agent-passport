import { pathToFileURL } from "node:url";
import { verifyGoLiveReadiness } from "./verify-go-live-readiness.mjs";

const DEFAULT_LOCAL_TIMEOUT_MS = 5000;
const LOCAL_BASE_URL_ENV_KEYS = ["AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL", "AGENT_PASSPORT_LOCAL_BASE_URL"];

function text(value) {
  return String(value ?? "").trim();
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function hasFailureSemanticsEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const status = text(value.status);
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
    text(value.primaryFailure.code).length > 0 &&
    text(value.primaryFailure.machineAction).length > 0 &&
    text(value.primaryFailure.operatorAction).length > 0
  );
}

function resolveLocalBaseUrl(explicitValue = undefined) {
  const direct = text(explicitValue);
  if (direct) {
    return trimTrailingSlash(direct);
  }
  for (const key of LOCAL_BASE_URL_ENV_KEYS) {
    const value = text(process.env[key]);
    if (value) {
      return trimTrailingSlash(value);
    }
  }
  const port = text(process.env.AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT || process.env.PORT) || "4319";
  return `http://127.0.0.1:${port}`;
}

function buildBlockedItem(id, label, detail, { actual = null, expected = null, nextAction = null, source = "local" } = {}) {
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

async function fetchJson(pathname, { baseUrl, timeoutMs = DEFAULT_LOCAL_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`timeout:${pathname}`)), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}${pathname}`, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
    const body = await response.text();
    let data = null;
    try {
      data = body ? JSON.parse(body) : null;
    } catch {}
    return {
      ok: response.ok,
      status: response.status,
      body,
      data,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: "",
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function verifyLocalLoopbackRuntime({
  localBaseUrl,
  timeoutMs = DEFAULT_LOCAL_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  const baseUrl = resolveLocalBaseUrl(localBaseUrl);
  const health = await fetchJson("/api/health", { baseUrl, timeoutMs, fetchImpl });
  const security = await fetchJson("/api/security", { baseUrl, timeoutMs, fetchImpl });

  const healthOk = health.ok === true;
  const healthBodyOk = healthOk && health.data?.ok === true;
  const serviceOk = healthOk && text(health.data?.service) === "agent-passport";
  const securityHttpOk = security.ok === true;
  const securityNormal = securityHttpOk && text(security.data?.securityPosture?.mode) === "normal";
  const releaseFailureSemanticsOk =
    securityHttpOk && hasFailureSemanticsEnvelope(security.data?.releaseReadiness?.failureSemantics);
  const automaticRecoveryFailureSemanticsOk =
    securityHttpOk && hasFailureSemanticsEnvelope(security.data?.automaticRecovery?.failureSemantics);

  const checks = [
    {
      id: "local_health_http_ok",
      label: "本机 /api/health 可访问",
      passed: healthOk,
      actual: health.status,
      detail: health.error || `HTTP ${health.status ?? "unknown"}`,
    },
    {
      id: "local_health_ok_true",
      label: "本机 /api/health.ok=true",
      passed: healthBodyOk,
      skipped: !healthOk,
      actual: health.data?.ok ?? null,
      detail: !healthOk
        ? "本机 /api/health 当前不可访问，暂不判断 ok 字段。"
        : healthBodyOk
          ? "本机健康检查已返回 ok=true。"
          : "本机健康检查没有返回 ok=true。",
    },
    {
      id: "local_service_name",
      label: "本机 service=agent-passport",
      passed: serviceOk,
      skipped: !healthOk,
      actual: text(health.data?.service) || null,
      detail: !healthOk
        ? "本机 /api/health 当前不可访问，暂不判断 service 字段。"
        : serviceOk
          ? "本机服务名已对齐 agent-passport。"
          : "本机服务名不是 agent-passport。",
    },
    {
      id: "local_security_http_ok",
      label: "本机 /api/security 可访问",
      passed: securityHttpOk,
      actual: security.status,
      detail: security.error || `HTTP ${security.status ?? "unknown"}`,
    },
    {
      id: "local_security_normal",
      label: "本机 securityPosture.mode=normal",
      passed: securityNormal,
      skipped: !securityHttpOk,
      actual: text(security.data?.securityPosture?.mode) || null,
      detail: !securityHttpOk
        ? "本机 /api/security 当前不可访问，暂不判断 securityPosture.mode。"
        : text(security.data?.securityPosture?.summary) || "本机安全姿态当前不是 normal。",
    },
    {
      id: "local_release_failure_semantics",
      label: "本机 releaseReadiness.failureSemantics 可读",
      passed: releaseFailureSemanticsOk,
      skipped: !securityHttpOk,
      actual: text(security.data?.releaseReadiness?.failureSemantics?.status) || null,
      detail: !securityHttpOk
        ? "本机 /api/security 当前不可访问，暂不判断 releaseReadiness.failureSemantics。"
        : "本机 /api/security 必须直接返回 releaseReadiness.failureSemantics。",
    },
    {
      id: "local_automatic_recovery_failure_semantics",
      label: "本机 automaticRecovery.failureSemantics 可读",
      passed: automaticRecoveryFailureSemanticsOk,
      skipped: !securityHttpOk,
      actual: text(security.data?.automaticRecovery?.failureSemantics?.status) || null,
      detail: !securityHttpOk
        ? "本机 /api/security 当前不可访问，暂不判断 automaticRecovery.failureSemantics。"
        : "本机 /api/security 必须直接返回 automaticRecovery.failureSemantics。",
    },
  ];

  const blockedBy = [];

  if (!healthOk) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem("local_health_http_ok", "本机 /api/health 不可用", health.error || "本机 /api/health 当前不可访问。", {
        actual: health.status,
        expected: 200,
        nextAction: "先确认本机 agent-passport 进程已启动、端口正确，再重新运行 verify:go-live:self-hosted。",
      })
    );
  }
  if (healthOk && !healthBodyOk) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem("local_health_ok_true", "本机健康检查未返回 ok=true", "本机 /api/health 没有返回 ok=true。", {
        actual: health.data?.ok ?? null,
        expected: true,
        nextAction: "先修复本机服务启动或初始化异常，再重新运行 verify:go-live:self-hosted。",
      })
    );
  }
  if (healthOk && !serviceOk) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem("local_service_name", "本机服务名不匹配", "当前本机端口返回的不是 agent-passport 服务真值。", {
        actual: text(health.data?.service) || null,
        expected: "agent-passport",
        nextAction: "先确认本机端口、反向代理和运行中的服务实例没有串位，再重新运行 verify:go-live:self-hosted。",
      })
    );
  }
  if (!securityHttpOk) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem("local_security_http_ok", "本机 /api/security 不可用", security.error || "本机 /api/security 当前不可访问。", {
        actual: security.status,
        expected: 200,
        nextAction: "先确认本机服务已经完整启动，并能返回 /api/security，再重新运行 verify:go-live:self-hosted。",
      })
    );
  }
  if (securityHttpOk && !securityNormal) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem(
        "local_security_normal",
        "本机安全姿态不是 normal",
        text(security.data?.securityPosture?.summary) || "当前本机 securityPosture.mode 不是 normal。",
        {
          actual: text(security.data?.securityPosture?.mode) || null,
          expected: "normal",
          nextAction: "先在本机 /operator 或 /api/security 收口安全姿态，再重新运行 verify:go-live:self-hosted。",
        }
      )
    );
  }
  if (securityHttpOk && !releaseFailureSemanticsOk) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem(
        "local_release_failure_semantics",
        "本机 releaseReadiness.failureSemantics 缺失",
        "本机 /api/security 没有直接返回结构化 releaseReadiness.failureSemantics。",
        {
          actual: text(security.data?.releaseReadiness?.failureSemantics?.status) || null,
          expected: "clear|present",
          nextAction: "先修复本机 /api/security 的 releaseReadiness 结构化真值，再重新运行 verify:go-live:self-hosted。",
        }
      )
    );
  }
  if (securityHttpOk && !automaticRecoveryFailureSemanticsOk) {
    pushBlockedItem(
      blockedBy,
      buildBlockedItem(
        "local_automatic_recovery_failure_semantics",
        "本机 automaticRecovery.failureSemantics 缺失",
        "本机 /api/security 没有直接返回结构化 automaticRecovery.failureSemantics。",
        {
          actual: text(security.data?.automaticRecovery?.failureSemantics?.status) || null,
          expected: "clear|present",
          nextAction: "先修复本机 /api/security 的 automaticRecovery 结构化真值，再重新运行 verify:go-live:self-hosted。",
        }
      )
    );
  }

  return {
    ok: blockedBy.length === 0,
    status: blockedBy.length === 0 ? "ready" : "blocked",
    checkedAt: new Date().toISOString(),
    baseUrl,
    checks,
    blockedBy,
    summary:
      blockedBy.length === 0
        ? "本机 loopback 运行态入口已可读，健康检查与安全姿态一致正常。"
        : blockedBy[0]?.detail || "本机 loopback 运行态当前未通过。",
    nextAction:
      blockedBy[0]?.nextAction || "继续执行统一放行检查，确认 smoke 和公网 deploy 判定也一致通过。",
  };
}

export function buildSelfHostedGoLiveVerdict({ localRuntime = null, unifiedGoLive = null } = {}) {
  const localOk = localRuntime?.ok === true;
  const unifiedOk = unifiedGoLive?.ok === true;
  const blockedBy = [];

  for (const entry of Array.isArray(localRuntime?.blockedBy) ? localRuntime.blockedBy : []) {
    pushBlockedItem(blockedBy, { ...entry, source: entry.source || "local" });
  }
  for (const entry of Array.isArray(unifiedGoLive?.blockedBy) ? unifiedGoLive.blockedBy : []) {
    pushBlockedItem(blockedBy, { ...entry, source: entry.source || "unified" });
  }

  let readinessClass = text(unifiedGoLive?.readinessClass) || "blocked";
  if (localOk && unifiedOk) {
    readinessClass = "self_hosted_go_live_ready";
  } else if (!localOk) {
    readinessClass = "host_local_runtime_blocked";
  }

  return {
    ok: localOk && unifiedOk,
    readinessClass,
    checkedAt: new Date().toISOString(),
    localRuntime,
    unifiedGoLive,
    checks: [
      {
        id: "local_loopback_runtime_ready",
        label: "本机 loopback 运行态已通过",
        passed: localOk,
        actual: text(localRuntime?.status) || null,
        detail: text(localRuntime?.summary) || null,
      },
      ...((Array.isArray(localRuntime?.checks) ? localRuntime.checks : []).map((entry) => ({
        ...entry,
        source: "local",
      }))),
      {
        id: "unified_go_live_ok",
        label: "统一 go-live 判定已通过",
        passed: unifiedOk,
        actual: text(unifiedGoLive?.readinessClass) || null,
        detail: text(unifiedGoLive?.summary) || null,
      },
    ],
    blockedBy,
    summary:
      localOk && unifiedOk
        ? "本机 loopback 真值、smoke:all 和公网 go-live 判定已一致通过。"
        : blockedBy[0]?.detail || text(unifiedGoLive?.summary) || text(localRuntime?.summary) || "当前还不满足自托管一键放行条件。",
    nextAction:
      blockedBy[0]?.nextAction ||
      text(unifiedGoLive?.nextAction) ||
      text(localRuntime?.nextAction) ||
      "先补齐最先失败的检查，再重新运行 verify:go-live:self-hosted。",
  };
}

export async function verifySelfHostedGoLive({
  localBaseUrl,
  timeoutMs = DEFAULT_LOCAL_TIMEOUT_MS,
  fetchImpl = fetch,
  verifyGoLive = verifyGoLiveReadiness,
} = {}) {
  const localRuntime = await verifyLocalLoopbackRuntime({
    localBaseUrl,
    timeoutMs,
    fetchImpl,
  }).catch((error) => ({
    ok: false,
    status: "blocked",
    checkedAt: new Date().toISOString(),
    baseUrl: resolveLocalBaseUrl(localBaseUrl),
    checks: [],
    blockedBy: [
      buildBlockedItem(
        "local_runtime_unexpected_error",
        "本机 loopback 检查执行异常",
        error instanceof Error ? error.stack || error.message : String(error),
        {
          nextAction: "先修复本机 loopback 检查异常，再重新运行 verify:go-live:self-hosted。",
        }
      ),
    ],
    summary: "本机 loopback 检查执行失败。",
    nextAction: "先修复本机 loopback 检查异常，再重新运行 verify:go-live:self-hosted。",
  }));

  const unifiedGoLive = await verifyGoLive().catch((error) => ({
    ok: false,
    readinessClass: "blocked",
    checkedAt: new Date().toISOString(),
    checks: [],
    blockedBy: [
      buildBlockedItem(
        "unified_go_live_unexpected_error",
        "统一 go-live 判定执行异常",
        error instanceof Error ? error.stack || error.message : String(error),
        {
          nextAction: "先修复 verify:go-live 自身异常，再重新运行 verify:go-live:self-hosted。",
          source: "unified",
        }
      ),
    ],
    summary: "统一 go-live 判定执行失败。",
    nextAction: "先修复 verify:go-live 自身异常，再重新运行 verify:go-live:self-hosted。",
  }));

  return buildSelfHostedGoLiveVerdict({
    localRuntime,
    unifiedGoLive,
  });
}

async function main() {
  const result = await verifySelfHostedGoLive();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;

if (isDirectRun) {
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
}

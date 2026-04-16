import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRuntimeReleaseReadiness, formatRuntimeReleaseReadinessSummary } from "./release-readiness.mjs";

const DEFAULT_TIMEOUT_MS = 8000;
const DEPLOY_BASE_URL_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_BASE_URL", "AGENT_PASSPORT_BASE_URL"];
const DEPLOY_ADMIN_TOKEN_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN", "AGENT_PASSPORT_ADMIN_TOKEN"];

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function text(value) {
  return String(value ?? "").trim();
}

function pickFirstEnvValue(keys = []) {
  for (const key of keys) {
    const value = text(process.env[key]);
    if (value) {
      return {
        value,
        source: key,
      };
    }
  }
  return {
    value: "",
    source: null,
  };
}

function resolveDeployBaseUrl(explicitValue = undefined) {
  const direct = text(explicitValue);
  if (direct) {
    return {
      value: trimTrailingSlash(direct),
      source: "argument",
      provided: true,
    };
  }
  const resolved = pickFirstEnvValue(DEPLOY_BASE_URL_ENV_KEYS);
  return {
    value: trimTrailingSlash(resolved.value),
    source: resolved.source,
    provided: Boolean(resolved.value),
  };
}

function resolveDeployAdminToken(explicitValue = undefined) {
  const direct = text(explicitValue);
  if (direct) {
    return {
      value: direct,
      source: "argument",
      provided: true,
    };
  }
  const resolved = pickFirstEnvValue(DEPLOY_ADMIN_TOKEN_ENV_KEYS);
  return {
    value: resolved.value,
    source: resolved.source,
    provided: Boolean(resolved.value),
  };
}

async function fetchTextResponse(pathname, { baseUrl, headers = {} } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`timeout:${pathname}`)), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers,
      signal: controller.signal,
    });
    const bodyText = await response.text();
    return {
      status: response.status,
      bodyText,
      contentType: response.headers.get("content-type") || "",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJsonResponse(pathname, { baseUrl, headers = {} } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`timeout:${pathname}`)), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers,
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let data = null;
    if (bodyText) {
      data = JSON.parse(bodyText);
    }
    return {
      status: response.status,
      data,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildCheck(id, label, passed, { expected = null, actual = null, detail = null, skipped = false } = {}) {
  return {
    id,
    label,
    passed: passed === true,
    expected,
    actual,
    detail,
    skipped: skipped === true,
  };
}

function buildBlockedItem(id, label, detail, { expected = null, actual = null, nextAction = null } = {}) {
  return {
    id,
    label,
    detail,
    expected,
    actual,
    nextAction,
  };
}

function defaultNextActionForCheck(check, { baseUrl = "" } = {}) {
  switch (check?.id) {
    case "deploy_base_url_present":
      return "先设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重跑 npm run verify:deploy:http。";
    case "admin_token_present":
      return "先设置 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=<token>（或 AGENT_PASSPORT_ADMIN_TOKEN），再重跑 npm run verify:deploy:http。";
    case "deploy_endpoint_reachable":
      return `先确认 ${baseUrl || "目标 deploy URL"} 当前可达，再重跑 npm run verify:deploy:http。`;
    case "agents_with_auth_200":
    case "agents_array":
    case "device_setup_with_auth_200":
      return "先确认正式部署上的管理令牌仍有效，再重跑 npm run verify:deploy:http。";
    default:
      return "先补齐最先失败的 deploy HTTP 检查，再重跑 npm run verify:deploy:http。";
  }
}

function checksToBlockedBy(checks = [], { baseUrl = "" } = {}) {
  return (Array.isArray(checks) ? checks : [])
    .filter((entry) => entry?.passed === false)
    .map((entry) =>
      buildBlockedItem(entry.id, entry.label, entry.detail || entry.label || "deploy HTTP 检查未通过。", {
        expected: entry.expected ?? null,
        actual: entry.actual ?? null,
        nextAction: defaultNextActionForCheck(entry, { baseUrl }),
      })
    );
}

export async function verifyPublicDeployHttp({
  baseUrl = undefined,
  adminToken = undefined,
} = {}) {
  const resolvedBaseUrl = resolveDeployBaseUrl(baseUrl);
  const resolvedAdminToken = resolveDeployAdminToken(adminToken);

  if (!resolvedBaseUrl.provided) {
    const checks = [
      buildCheck("deploy_base_url_present", "已提供正式 deploy URL", false, {
        expected: "AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名",
        actual: null,
        detail: "缺少正式 deploy URL，当前还没执行 deploy HTTP 校验。",
      }),
      buildCheck("admin_token_present", "已提供管理令牌", resolvedAdminToken.provided, {
        expected: true,
        actual: resolvedAdminToken.provided,
        detail: resolvedAdminToken.provided
          ? "管理令牌已提供。"
          : "缺少 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN（或 AGENT_PASSPORT_ADMIN_TOKEN），正式放行判断仍不完整。",
      }),
    ];
    const blockedBy = checksToBlockedBy(checks, { baseUrl: resolvedBaseUrl.value });
    return {
      ok: false,
      baseUrl: null,
      baseUrlSource: null,
      adminTokenProvided: resolvedAdminToken.provided,
      adminTokenSource: resolvedAdminToken.source,
      checks,
      blockedBy,
      releaseReadiness: null,
      summary: "缺少正式 deploy URL，尚未执行 deploy HTTP 验证。",
      nextAction: blockedBy[0]?.nextAction || defaultNextActionForCheck(checks[0]),
      errorClass: "missing_deploy_base_url",
      errorStage: "preflight",
    };
  }

  const baseUrlText = resolvedBaseUrl.value;
  const checks = [
    buildCheck("deploy_base_url_present", "已提供正式 deploy URL", true, {
      expected: "AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名",
      actual: `${baseUrlText} (${resolvedBaseUrl.source || "unknown"})`,
      detail: "deploy HTTP 校验会对这台服务执行公开面与管理面探针。",
    }),
    buildCheck("admin_token_present", "已提供管理令牌", resolvedAdminToken.provided, {
      expected: true,
      actual: resolvedAdminToken.provided,
      detail: resolvedAdminToken.provided
        ? "管理令牌已提供。"
        : "缺少 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN（或 AGENT_PASSPORT_ADMIN_TOKEN），正式放行判断仍不完整。",
    }),
  ];

  let home = null;
  let health = null;
  let capabilities = null;
  let security = null;
  let agentsWithoutAuth = null;

  try {
    [home, health, capabilities, security, agentsWithoutAuth] = await Promise.all([
      fetchTextResponse("/", { baseUrl: baseUrlText }),
      fetchJsonResponse("/api/health", { baseUrl: baseUrlText }),
      fetchJsonResponse("/api/capabilities", { baseUrl: baseUrlText }),
      fetchJsonResponse("/api/security", { baseUrl: baseUrlText }),
      fetchJsonResponse("/api/agents", { baseUrl: baseUrlText }),
    ]);
    checks.push(
      buildCheck("deploy_endpoint_reachable", "正式 deploy URL 可达", true, {
        expected: "reachable HTTP endpoint",
        actual: baseUrlText,
        detail: "正式 deploy URL 已可达，开始执行公开面契约校验。",
      })
    );
  } catch (error) {
    checks.push(
      buildCheck("deploy_endpoint_reachable", "正式 deploy URL 可达", false, {
        expected: "reachable HTTP endpoint",
        actual: baseUrlText,
        detail: error instanceof Error ? error.message : String(error),
      })
    );
    const blockedBy = checksToBlockedBy(checks, { baseUrl: baseUrlText });
    return {
      ok: false,
      baseUrl: baseUrlText,
      baseUrlSource: resolvedBaseUrl.source,
      adminTokenProvided: resolvedAdminToken.provided,
      adminTokenSource: resolvedAdminToken.source,
      checks,
      blockedBy,
      releaseReadiness: null,
      summary: "正式 deploy URL 当前不可达，deploy HTTP 验证未完成。",
      nextAction: blockedBy[0]?.nextAction || defaultNextActionForCheck(checks[checks.length - 1], { baseUrl: baseUrlText }),
      errorClass: "deploy_endpoint_unreachable",
      errorStage: "fetch",
    };
  }

  checks.push(
    buildCheck("home_html", "首页可达", home.status === 200 && home.contentType.includes("text/html"), {
      expected: "200 + text/html",
      actual: `${home.status} ${home.contentType}`,
      detail: "GET / 应返回公开运行态 HTML。",
    }),
    buildCheck("home_runtime_entry", "首页包含公开运行态入口", home.bodyText.includes("公开运行态"), {
      expected: true,
      actual: home.bodyText.includes("公开运行态"),
      detail: "GET / 应包含“公开运行态”文案。",
    }),
    buildCheck("home_security_link", "首页包含 /api/security 入口", home.bodyText.includes("/api/security"), {
      expected: true,
      actual: home.bodyText.includes("/api/security"),
      detail: "GET / 应包含 /api/security 公开链接。",
    }),
    buildCheck("health_ok", "健康检查可达", health.status === 200 && health.data?.ok === true, {
      expected: "200 + ok:true",
      actual: `${health.status} ok=${health.data?.ok ?? null}`,
      detail: "GET /api/health 必须返回 ok:true。",
    }),
    buildCheck("health_service", "服务名存在", typeof health.data?.service === "string" && text(health.data?.service).length > 0, {
      expected: "non-empty service",
      actual: text(health.data?.service) || null,
      detail: "GET /api/health 应返回 service。",
    }),
    buildCheck(
      "capabilities_product",
      "能力摘要可读",
      capabilities.status === 200 && typeof capabilities.data?.product?.name === "string",
      {
        expected: "200 + product.name",
        actual: `${capabilities.status} product=${text(capabilities.data?.product?.name) || null}`,
        detail: "GET /api/capabilities 应返回 product.name。",
      }
    ),
    buildCheck("security_summary", "安全摘要可读", security.status === 200 && Boolean(security.data?.localStore), {
      expected: "200 + localStore",
      actual: `${security.status} localStore=${Boolean(security.data?.localStore)}`,
      detail: "GET /api/security 应返回 localStore 安全摘要。",
    }),
    buildCheck("agents_without_auth_401", "敏感 agents 读面要求鉴权", agentsWithoutAuth.status === 401, {
      expected: 401,
      actual: agentsWithoutAuth.status,
      detail: "GET /api/agents 未带 token 必须返回 401。",
    }),
  );

  let setup = null;
  if (resolvedAdminToken.provided) {
    const [agentsWithAuth, setupWithAuth] = await Promise.all([
      fetchJsonResponse("/api/agents", {
        baseUrl: baseUrlText,
        headers: {
          Authorization: `Bearer ${resolvedAdminToken.value}`,
        },
      }),
      fetchJsonResponse("/api/device/setup", {
        baseUrl: baseUrlText,
        headers: {
          Authorization: `Bearer ${resolvedAdminToken.value}`,
        },
      }),
    ]);
    setup = setupWithAuth.data || null;
    checks.push(
      buildCheck("agents_with_auth_200", "管理令牌可读取 agents", agentsWithAuth.status === 200, {
        expected: 200,
        actual: agentsWithAuth.status,
        detail: "GET /api/agents 带管理令牌时必须返回 200。",
      }),
      buildCheck("agents_array", "agents 返回数组", Array.isArray(agentsWithAuth.data?.agents), {
        expected: true,
        actual: Array.isArray(agentsWithAuth.data?.agents),
        detail: "GET /api/agents 带管理令牌后应返回 agents 数组。",
      }),
      buildCheck("device_setup_with_auth_200", "管理令牌可读取 device/setup", setupWithAuth.status === 200, {
        expected: 200,
        actual: setupWithAuth.status,
        detail: "GET /api/device/setup 带管理令牌时必须返回 200。",
      })
    );
  }

  const releaseReadiness = buildRuntimeReleaseReadiness({
    health: health.data,
    security: security.data,
    setup,
  });
  const failedChecks = checks.filter((entry) => entry.passed === false);
  const blockedBy = checksToBlockedBy(failedChecks, { baseUrl: baseUrlText });
  const summary =
    failedChecks.length === 0
      ? formatRuntimeReleaseReadinessSummary(releaseReadiness)
      : failedChecks[0]?.id === "admin_token_present"
        ? "公开 deploy HTTP 检查已完成，但管理面令牌缺失，正式放行判断仍不完整。"
        : failedChecks[0]?.detail || failedChecks[0]?.label || "deploy HTTP 验证未通过。";

  return {
    ok: failedChecks.length === 0,
    baseUrl: baseUrlText,
    baseUrlSource: resolvedBaseUrl.source,
    adminTokenProvided: resolvedAdminToken.provided,
    adminTokenSource: resolvedAdminToken.source,
    checks,
    blockedBy,
    releaseReadiness,
    summary,
    nextAction:
      blockedBy[0]?.nextAction ||
      text(releaseReadiness?.nextAction) ||
      "继续结合 smoke 与 deploy 结果判断是否可以放行。",
    errorClass: failedChecks.length === 0 ? null : "deploy_check_failed",
    errorStage: failedChecks.length === 0 ? null : "checks",
  };
}

async function main() {
  const result = await verifyPublicDeployHttp();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
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

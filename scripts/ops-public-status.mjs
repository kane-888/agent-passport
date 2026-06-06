import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadDeployEnvOverlay, pickFirstConfigValue } from "./deploy-env-loader.mjs";
import { printCliError, printCliResult } from "./structured-cli-output.mjs";

const DEFAULT_TIMEOUT_MS = 8000;
const DEPLOY_BASE_URL_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_BASE_URL", "AGENT_PASSPORT_BASE_URL"];
const DEPLOY_ADMIN_TOKEN_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN", "AGENT_PASSPORT_ADMIN_TOKEN"];
const STATUS_PATH_ENV_KEYS = ["AGENT_PASSPORT_OPS_STATUS_PATH"];

function text(value) {
  return String(value ?? "").trim();
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/u, "");
}

function normalizeBaseUrl(value = "") {
  const candidate = trimTrailingSlash(value);
  if (candidate) {
    return candidate;
  }
  return `http://127.0.0.1:${text(process.env.PORT) || "4319"}`;
}

function isCnPublicUrl(baseUrl = "") {
  try {
    const parsed = new URL(baseUrl);
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase().endsWith(".cn");
  } catch {
    return false;
  }
}

async function fetchJson(pathname, { baseUrl, headers = {} } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`timeout:${pathname}`)), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers,
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let data = null;
    if (bodyText.trim()) {
      try {
        data = JSON.parse(bodyText);
      } catch {
        data = null;
      }
    }
    return {
      path: pathname,
      status: response.status,
      ok: response.ok,
      data,
      error: null,
    };
  } catch (error) {
    return {
      path: pathname,
      status: null,
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildCheck(id, label, passed, detail, { skipped = false } = {}) {
  return {
    id,
    label,
    passed: passed === true,
    detail,
    skipped: skipped === true,
  };
}

function summarizeEndpoint(response, data = null) {
  return {
    path: response.path,
    status: response.status,
    ok: response.ok,
    error: response.error,
    data,
  };
}

function summarizeSecurityPosture(value = null) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    mode: text(value.mode) || null,
    summary: text(value.summary) || null,
    writeLocked: value.writeLocked ?? null,
    executionLocked: value.executionLocked ?? null,
    networkEgressLocked: value.networkEgressLocked ?? null,
  };
}

function summarizeReleaseReadiness(value = null) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    status: text(value.status) || null,
    readinessClass: text(value.readinessClass) || null,
    failedCheckCount: Number.isFinite(Number(value.failedCheckCount)) ? Number(value.failedCheckCount) : null,
    criticalFailureCount: Number.isFinite(Number(value.criticalFailureCount)) ? Number(value.criticalFailureCount) : null,
    failureSemantics: {
      status: text(value.failureSemantics?.status) || null,
      failureCount: Number.isFinite(Number(value.failureSemantics?.failureCount))
        ? Number(value.failureSemantics.failureCount)
        : null,
      primaryFailureCode: text(value.failureSemantics?.primaryFailure?.code) || null,
    },
    nextAction: text(value.nextAction) || null,
  };
}

async function writeStatusFile(result, { overlay }) {
  const configuredPath = pickFirstConfigValue(STATUS_PATH_ENV_KEYS, { overlay });
  const statusPath = text(configuredPath.value);
  if (!statusPath) {
    return null;
  }
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return statusPath;
}

export async function collectPublicStatus({ baseUrl = undefined, adminToken = undefined, envFilePath = undefined } = {}) {
  const overlay = await loadDeployEnvOverlay({ explicitEnvFilePath: envFilePath });
  const resolvedBaseUrl = normalizeBaseUrl(baseUrl || pickFirstConfigValue(DEPLOY_BASE_URL_ENV_KEYS, { overlay }).value);
  const resolvedAdminToken = text(adminToken || pickFirstConfigValue(DEPLOY_ADMIN_TOKEN_ENV_KEYS, { overlay }).value);
  const adminHeaders = resolvedAdminToken ? { Authorization: `Bearer ${resolvedAdminToken}` } : {};

  const [health, security, publicConfig, deviceSetup] = await Promise.all([
    fetchJson("/api/health", { baseUrl: resolvedBaseUrl }),
    fetchJson("/api/security", { baseUrl: resolvedBaseUrl }),
    fetchJson("/api/public-config", { baseUrl: resolvedBaseUrl }),
    resolvedAdminToken
      ? fetchJson("/api/device/setup", { baseUrl: resolvedBaseUrl, headers: adminHeaders })
      : Promise.resolve({ path: "/api/device/setup", status: null, ok: false, data: null, error: "admin token missing" }),
  ]);

  const icpRequired = isCnPublicUrl(resolvedBaseUrl);
  const icpRecordNumber = text(publicConfig.data?.compliance?.icp?.recordNumber);
  const checks = [
    buildCheck("health_ok", "health 可达", health.status === 200 && health.data?.ok === true, `status=${health.status} ok=${health.data?.ok ?? null}`),
    buildCheck(
      "security_readable",
      "security 可读",
      security.status === 200 && Boolean(security.data?.securityPosture),
      `status=${security.status} posture=${text(security.data?.securityPosture?.mode) || null}`
    ),
    buildCheck(
      "public_config_readable",
      "public-config 可读",
      publicConfig.status === 200 && publicConfig.data?.service === "agent-passport",
      `status=${publicConfig.status} service=${text(publicConfig.data?.service) || null}`
    ),
    buildCheck(
      "icp_record_configured",
      "ICP备案号已配置",
      !icpRequired || icpRecordNumber.length > 0,
      icpRequired ? `recordNumber=${icpRecordNumber || "missing"}` : "non-.cn or non-public URL",
      { skipped: !icpRequired }
    ),
    buildCheck(
      "device_setup_readable",
      "device/setup 管理面可读",
      !resolvedAdminToken || deviceSetup.status === 200,
      resolvedAdminToken ? `status=${deviceSetup.status}` : "admin token missing",
      { skipped: !resolvedAdminToken }
    ),
  ];

  const failedChecks = checks.filter((entry) => entry.passed === false);
  const result = {
    ok: failedChecks.length === 0,
    checkedAt: new Date().toISOString(),
    baseUrl: resolvedBaseUrl,
    adminTokenProvided: Boolean(resolvedAdminToken),
    checks,
    firstBlocker: failedChecks[0] || null,
    endpoints: {
      health: summarizeEndpoint(health, {
        ok: health.data?.ok ?? null,
        ready: health.data?.ready ?? null,
        service: text(health.data?.service) || null,
        hostBinding: text(health.data?.hostBinding) || null,
      }),
      security: summarizeEndpoint(security, {
        securityPosture: summarizeSecurityPosture(security.data?.securityPosture),
        releaseReadiness: summarizeReleaseReadiness(security.data?.releaseReadiness),
      }),
      publicConfig: summarizeEndpoint(publicConfig, {
        service: text(publicConfig.data?.service) || null,
        compliance: publicConfig.data?.compliance || null,
      }),
      deviceSetup: summarizeEndpoint(deviceSetup),
    },
    summary:
      failedChecks.length === 0
        ? "agent-passport public status ok."
        : `agent-passport public status blocked by ${failedChecks[0].id}.`,
  };

  result.statusPath = await writeStatusFile(result, { overlay });
  return result;
}

async function main() {
  const result = await collectPublicStatus();
  await printCliResult(result);
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  main().catch((error) => printCliError(error));
}

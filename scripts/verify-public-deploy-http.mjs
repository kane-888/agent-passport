import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readGenericPasswordFromKeychainResult } from "../src/local-secrets.js";
import { loadDeployEnvOverlay, pickFirstConfigValue } from "./deploy-env-loader.mjs";
import { printCliError, printCliResult } from "./structured-cli-output.mjs";
import { buildRuntimeReleaseReadiness, formatRuntimeReleaseReadinessSummary } from "./release-readiness.mjs";
import { createBlockedItem, finalizeBlockedOutcome, formatOperatorSummary } from "./verifier-outcome-shared.mjs";

const DEFAULT_TIMEOUT_MS = 8000;
const DEPLOY_HTTP_RERUN_COMMAND = "npm run verify:deploy:http";
const DEPLOY_HTTP_MACHINE_READABLE_COMMAND = "npm run --silent verify:deploy:http";
const DEPLOY_BASE_URL_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_BASE_URL", "AGENT_PASSPORT_BASE_URL"];
const DEPLOY_BASE_URL_CANDIDATE_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES"];
const DEPLOY_RENDER_AUTO_DISCOVERY_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_RENDER_AUTO_DISCOVERY"];
const DEPLOY_ADMIN_TOKEN_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN", "AGENT_PASSPORT_ADMIN_TOKEN"];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const ADMIN_TOKEN_FALLBACK_PATH = process.env.AGENT_PASSPORT_ADMIN_TOKEN_PATH || path.join(rootDir, "data", ".admin-token");
const ADMIN_TOKEN_KEYCHAIN_SERVICE = "AgentPassport.AdminToken";
const ADMIN_TOKEN_KEYCHAIN_ACCOUNT = process.env.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT || "resident-default";

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function text(value) {
  return String(value ?? "").trim();
}

function parseBaseUrlCandidates(value = "") {
  return [...new Set(text(value).split(/[\s,]+/u).map(trimTrailingSlash).filter(Boolean))];
}

function parseBooleanEnvFlag(value = "") {
  const normalized = text(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  return ["1", "true", "yes", "on", "render", "auto"].includes(normalized);
}

function resolveRenderAutoDiscoveryEnabled() {
  return DEPLOY_RENDER_AUTO_DISCOVERY_ENV_KEYS.some((key) => parseBooleanEnvFlag(process.env[key]));
}

function isRenderBaseUrlCandidate(value = "") {
  const normalized = trimTrailingSlash(value);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.hostname.endsWith(".onrender.com");
  } catch {
    return false;
  }
}

function isLoopbackBaseUrl(value = "") {
  const normalized = trimTrailingSlash(value);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    return ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function isLegacyBaseUrlSource(source = "") {
  return text(source) === "AGENT_PASSPORT_BASE_URL";
}

export function extractRenderServiceNames(source = "") {
  const names = [];
  const lines = String(source || "").split(/\r?\n/u);
  let inServices = false;
  let serviceItemIndent = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = line.match(/^\s*/u)?.[0]?.length ?? 0;

    if (!inServices) {
      if (trimmed === "services:") {
        inServices = true;
      }
      continue;
    }

    if (!trimmed) {
      continue;
    }

    if (indent === 0) {
      break;
    }

    const serviceStartMatch = line.match(/^(\s*)-\s+type:\s+/u);
    if (serviceStartMatch) {
      serviceItemIndent = serviceStartMatch[1].length;
      continue;
    }

    if (serviceItemIndent == null) {
      continue;
    }

    const nameMatch = line.match(/^(\s*)name:\s*([A-Za-z0-9._-]+)\s*$/u);
    if (nameMatch && nameMatch[1].length === serviceItemIndent + 2) {
      names.push(text(nameMatch[2]));
    }
  }

  return [...new Set(names.filter(Boolean))];
}

export function summarizeRenderConfigReview(source = "", { relevant = true } = {}) {
  const normalizedSource = String(source || "");
  const serviceNames = extractRenderServiceNames(normalizedSource);
  const legacyResourceNames = [
    ...new Set(
      (normalizedSource.match(/\bopenneed-memory-homeostasis-(?:engine(?:-prod)?|data)\b/gu) || []).map((entry) =>
        text(entry)
      )
    ),
  ];
  const reviewRelevant = relevant === true && (serviceNames.length > 0 || legacyResourceNames.length > 0);
  const reviewRequired = reviewRelevant && legacyResourceNames.length > 0;

  return {
    reviewRelevant,
    reviewRequired,
    serviceNames,
    legacyResourceNames,
    summary: !reviewRelevant
      ? "当前部署校验未启用 Render 自动发现；render.yaml 仅作历史参考。"
      : reviewRequired
        ? `render.yaml 仍引用历史 Render 资源名：${legacyResourceNames.join(", ")}。`
        : serviceNames.length > 0
          ? `render.yaml 当前声明的 Render service：${serviceNames.join(", ")}。`
          : "render.yaml 未提供可用的 Render service 声明。",
    nextAction: reviewRequired
      ? "先去 Render 控制台核对 service / disk / default domain 的真实绑定，再决定是否改名并设置 AGENT_PASSPORT_DEPLOY_BASE_URL。"
      : null,
  };
}

function resolveDeployBaseUrl(explicitValue = undefined, { overlay = null } = {}) {
  const direct = text(explicitValue);
  if (direct) {
    return {
      value: trimTrailingSlash(direct),
      source: "argument",
      sourceType: "argument",
      sourcePath: null,
      provided: true,
    };
  }
  const resolved = pickFirstConfigValue(DEPLOY_BASE_URL_ENV_KEYS, { overlay });
  return {
    value: trimTrailingSlash(resolved.value),
    source: resolved.source,
    sourceType: resolved.sourceType,
    sourcePath: resolved.sourcePath,
    provided: Boolean(resolved.value),
  };
}

async function resolveDeployAdminToken(explicitValue = undefined, { overlay = null } = {}) {
  const direct = text(explicitValue);
  if (direct) {
    return {
      value: direct,
      source: "argument",
      sourceType: "argument",
      sourcePath: null,
      provided: true,
    };
  }
  const resolved = pickFirstConfigValue(DEPLOY_ADMIN_TOKEN_ENV_KEYS, { overlay });
  if (resolved.value) {
    return {
      value: resolved.value,
      source: resolved.source,
      sourceType: resolved.sourceType,
      sourcePath: resolved.sourcePath,
      provided: true,
    };
  }

  const keychainToken = readGenericPasswordFromKeychainResult(ADMIN_TOKEN_KEYCHAIN_SERVICE, ADMIN_TOKEN_KEYCHAIN_ACCOUNT);
  if (keychainToken.found) {
    return {
      value: keychainToken.value,
      source: "keychain",
      sourceType: "keychain",
      sourcePath: null,
      provided: true,
    };
  }

  try {
    const fallbackToken = text(await fs.readFile(ADMIN_TOKEN_FALLBACK_PATH, "utf8"));
    if (fallbackToken) {
      return {
        value: fallbackToken,
        source: "file",
        sourceType: "file",
        sourcePath: ADMIN_TOKEN_FALLBACK_PATH,
        provided: true,
      };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return {
    value: "",
    source: null,
    sourceType: null,
    sourcePath: null,
    provided: false,
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
    const contentType = response.headers.get("content-type") || "";
    let data = null;
    const looksLikeJson = contentType.includes("application/json") || /^[\[{]/.test(bodyText.trim());
    if (bodyText && looksLikeJson) {
      data = JSON.parse(bodyText);
    }
    return {
      status: response.status,
      data,
      bodyText,
      contentType,
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
    text(value.primaryFailure.category).length > 0 &&
    text(value.primaryFailure.boundary).length > 0 &&
    text(value.primaryFailure.severity).length > 0 &&
    text(value.primaryFailure.machineAction).length > 0 &&
    text(value.primaryFailure.operatorAction).length > 0 &&
    text(value.primaryFailure.sourceType).length > 0 &&
    text(value.primaryFailure.sourceValue).length > 0
  );
}

function buildBlockedItem(id, label, detail, options = {}) {
  return createBlockedItem(id, label, detail, {
    rerunCommand: DEPLOY_HTTP_RERUN_COMMAND,
    machineReadableCommand: DEPLOY_HTTP_MACHINE_READABLE_COMMAND,
    ...options,
  });
}

function summarizeSuggestedBaseUrls(entries = []) {
  const normalized = (Array.isArray(entries) ? entries : []).filter(Boolean);
  if (normalized.length === 0) {
    return "";
  }
  return normalized
    .map((entry) => {
      if (entry.ok === true) {
        return `${entry.baseUrl} -> health ok${text(entry.service) ? ` (${text(entry.service)})` : ""}`;
      }
      if (entry.status) {
        return `${entry.baseUrl} -> HTTP ${entry.status}`;
      }
      return `${entry.baseUrl} -> ${text(entry.error) || "unreachable"}`;
    })
    .join(" ; ");
}

function getExplicitDeployBaseUrlCandidates({ overlay = null } = {}) {
  return DEPLOY_BASE_URL_CANDIDATE_ENV_KEYS.flatMap((key) => {
    const direct = parseBaseUrlCandidates(process.env[key]);
    if (direct.length > 0) {
      return direct;
    }
    return parseBaseUrlCandidates(overlay?.values?.[key]);
  });
}

async function discoverRenderBaseUrlCandidates({ enabled = false } = {}) {
  if (!enabled) {
    return [];
  }
  const renderYamlPath = path.join(rootDir, "render.yaml");
  let source = "";
  try {
    source = await fs.readFile(renderYamlPath, "utf8");
  } catch {
    return [];
  }

  return extractRenderServiceNames(source).map((name) => `https://${name}.onrender.com`);
}

async function probeCandidateBaseUrl(baseUrl) {
  try {
    const health = await fetchJsonResponse("/api/health", { baseUrl });
    return {
      baseUrl,
      status: health.status,
      ok: health.status === 200 && health.data?.ok === true,
      service: text(health.data?.service) || null,
      error: null,
    };
  } catch (error) {
    return {
      baseUrl,
      status: null,
      ok: false,
      service: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function defaultNextActionForCheck(check, { baseUrl = "", renderConfigReview = null, configEnvFiles = [] } = {}) {
  const preferredEnvFile = Array.isArray(configEnvFiles) && configEnvFiles.length > 0 ? configEnvFiles[0] : null;
  switch (check?.id) {
    case "deploy_base_url_present":
      if (renderConfigReview?.reviewRelevant === true && renderConfigReview?.reviewRequired === true && text(renderConfigReview?.nextAction)) {
        return text(renderConfigReview.nextAction);
      }
      return preferredEnvFile
        ? `先在 ${preferredEnvFile} 里补齐 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重跑 npm run verify:deploy:http。`
        : "先设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重跑 npm run verify:deploy:http。";
    case "deploy_base_url_not_legacy_loopback":
      return preferredEnvFile
        ? `当前 ${preferredEnvFile} 里的 AGENT_PASSPORT_BASE_URL 指向本机地址；请改填 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重跑 npm run verify:deploy:http。`
        : "当前 AGENT_PASSPORT_BASE_URL 指向本机地址；请改用 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重跑 npm run verify:deploy:http。";
    case "admin_token_present":
      return preferredEnvFile
        ? `先在 ${preferredEnvFile} 里补齐 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=<token>（或 AGENT_PASSPORT_ADMIN_TOKEN），再重跑 npm run verify:deploy:http。`
        : "先设置 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=<token>（或 AGENT_PASSPORT_ADMIN_TOKEN），再重跑 npm run verify:deploy:http。";
    case "deploy_endpoint_reachable":
      return `先确认 ${baseUrl || "目标 deploy URL"} 当前可达，再重跑 npm run verify:deploy:http。`;
    case "agents_without_auth_error_class":
      return "先确认正式部署的 /api/agents 是 agent-passport 受保护读面，并且反向代理没有吞掉 JSON 错误体，再重跑 npm run verify:deploy:http。";
    case "agents_with_auth_200":
    case "agents_array":
    case "device_setup_with_auth_200":
      return "先确认正式部署上的管理令牌仍有效，再重跑 npm run verify:deploy:http。";
    default:
      return "先补齐最先失败的 deploy HTTP 检查，再重跑 npm run verify:deploy:http。";
  }
}

function defaultNextActionSummaryForCheck(check, { renderConfigReview = null } = {}) {
  switch (check?.id) {
    case "deploy_base_url_present":
      return renderConfigReview?.reviewRelevant === true && renderConfigReview?.reviewRequired === true
        ? "先核对 Render 真实绑定"
        : "先补齐正式 deploy URL";
    case "deploy_base_url_not_legacy_loopback":
      return "先改用正式 deploy URL";
    case "admin_token_present":
      return "先补齐管理令牌";
    case "deploy_endpoint_reachable":
      return "先确认 deploy URL 可达";
    case "agents_without_auth_error_class":
      return "先确认受保护读面错误体";
    case "agents_with_auth_200":
    case "agents_array":
    case "device_setup_with_auth_200":
      return "先确认管理令牌仍有效";
    default:
      return "先补齐最先失败的 deploy HTTP 检查";
  }
}

function checksToBlockedBy(checks = [], { baseUrl = "", renderConfigReview = null, configEnvFiles = [] } = {}) {
  return (Array.isArray(checks) ? checks : [])
    .filter((entry) => entry?.passed === false)
    .map((entry) =>
      buildBlockedItem(entry.id, entry.label, entry.detail || entry.label || "deploy HTTP 检查未通过。", {
        expected: entry.expected ?? null,
        actual: entry.actual ?? null,
        nextAction: defaultNextActionForCheck(entry, { baseUrl, renderConfigReview, configEnvFiles }),
        nextActionSummary: defaultNextActionSummaryForCheck(entry, { renderConfigReview }),
        rerunCommand: DEPLOY_HTTP_RERUN_COMMAND,
        machineReadableCommand: DEPLOY_HTTP_MACHINE_READABLE_COMMAND,
      })
    );
}

export async function verifyPublicDeployHttp({
  baseUrl = undefined,
  adminToken = undefined,
  envFilePath = undefined,
} = {}) {
  const deployEnvOverlay = await loadDeployEnvOverlay({ explicitEnvFilePath: envFilePath });
  let resolvedBaseUrl = resolveDeployBaseUrl(baseUrl, { overlay: deployEnvOverlay });
  const resolvedAdminToken = await resolveDeployAdminToken(adminToken, { overlay: deployEnvOverlay });
  const explicitCandidates = getExplicitDeployBaseUrlCandidates({ overlay: deployEnvOverlay });
  const renderAutoDiscoveryEnabled =
    resolveRenderAutoDiscoveryEnabled() ||
    DEPLOY_RENDER_AUTO_DISCOVERY_ENV_KEYS.some((key) => parseBooleanEnvFlag(deployEnvOverlay.values?.[key]));
  const renderYamlPath = path.join(rootDir, "render.yaml");
  let renderYamlSource = "";
  try {
    renderYamlSource = await fs.readFile(renderYamlPath, "utf8");
  } catch {}
  const renderReviewRelevant =
    renderAutoDiscoveryEnabled ||
    isRenderBaseUrlCandidate(resolvedBaseUrl.value) ||
    explicitCandidates.some((entry) => isRenderBaseUrlCandidate(entry));
  const renderConfigReview = summarizeRenderConfigReview(renderYamlSource, {
    relevant: renderReviewRelevant,
  });
  const renderCandidates = !resolvedBaseUrl.provided
    ? await discoverRenderBaseUrlCandidates({ enabled: renderAutoDiscoveryEnabled })
    : [];
  const candidateBaseUrls = explicitCandidates.length > 0 ? explicitCandidates : renderCandidates;
  const suggestedBaseUrls =
    !resolvedBaseUrl.provided && candidateBaseUrls.length > 0
      ? await Promise.all(candidateBaseUrls.map((entry) => probeCandidateBaseUrl(entry)))
      : [];
  const autoDiscoveredBaseUrl = suggestedBaseUrls.find((entry) => entry.ok === true) || null;

  if (!resolvedBaseUrl.provided && autoDiscoveredBaseUrl) {
    resolvedBaseUrl = {
      value: trimTrailingSlash(autoDiscoveredBaseUrl.baseUrl),
      source: "candidate_auto_discovery",
      sourceType: "auto_discovery",
      sourcePath: null,
      provided: true,
    };
  }

  if (
    resolvedBaseUrl.provided &&
    isLegacyBaseUrlSource(resolvedBaseUrl.source) &&
    isLoopbackBaseUrl(resolvedBaseUrl.value)
  ) {
    const checks = [
      buildCheck("deploy_base_url_present", "已提供正式 deploy URL", true, {
        expected: "AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名",
        actual: `${resolvedBaseUrl.value} (${resolvedBaseUrl.source || "unknown"})`,
        detail: "检测到旧兼容变量 AGENT_PASSPORT_BASE_URL。",
      }),
      buildCheck("deploy_base_url_not_legacy_loopback", "deploy URL 不能来自旧本机 base URL", false, {
        expected: "AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名",
        actual: `${resolvedBaseUrl.value} (${resolvedBaseUrl.source || "unknown"})`,
        detail:
          "AGENT_PASSPORT_BASE_URL 是本地/旧兼容入口；当它指向 localhost/loopback 时，不能作为正式 deploy HTTP 放行目标。",
      }),
      buildCheck("admin_token_present", "已提供管理令牌", resolvedAdminToken.provided, {
        expected: true,
        actual: resolvedAdminToken.provided,
        detail: resolvedAdminToken.provided
          ? "管理令牌已提供。"
          : "缺少 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN（或 AGENT_PASSPORT_ADMIN_TOKEN），正式放行判断仍不完整。",
      }),
    ];
    const blockedBy = checksToBlockedBy(checks, {
      baseUrl: resolvedBaseUrl.value,
      renderConfigReview,
      configEnvFiles: deployEnvOverlay.loadedFiles,
    });
    const outcome = finalizeBlockedOutcome({
      blockedBy,
      nextActionCandidates: [
        defaultNextActionForCheck(checks[1], {
          baseUrl: resolvedBaseUrl.value,
          renderConfigReview,
          configEnvFiles: deployEnvOverlay.loadedFiles,
        }),
      ],
    });
    const summary = "旧兼容 AGENT_PASSPORT_BASE_URL 指向本机地址，不能作为正式 deploy HTTP 放行目标。";
    return {
      ok: false,
      rerunCommand: DEPLOY_HTTP_RERUN_COMMAND,
      machineReadableCommand: DEPLOY_HTTP_MACHINE_READABLE_COMMAND,
      baseUrl: resolvedBaseUrl.value,
      baseUrlSource: resolvedBaseUrl.source,
      baseUrlSourceType: resolvedBaseUrl.sourceType,
      baseUrlSourcePath: resolvedBaseUrl.sourcePath,
      adminTokenProvided: resolvedAdminToken.provided,
      adminTokenSource: resolvedAdminToken.source,
      adminTokenSourceType: resolvedAdminToken.sourceType,
      adminTokenSourcePath: resolvedAdminToken.sourcePath,
      configEnvFiles: deployEnvOverlay.loadedFiles,
      checks,
      suggestedBaseUrls,
      renderConfigReview,
      blockedBy: outcome.blockedBy,
      firstBlocker: outcome.firstBlocker,
      releaseReadiness: null,
      summary,
      nextAction: outcome.nextAction,
      operatorSummary: formatOperatorSummary({
        firstBlocker: outcome.firstBlocker,
        nextAction: outcome.nextAction,
        blockedSummary: summary,
      }),
      errorClass: "legacy_loopback_deploy_base_url",
      errorStage: "preflight",
    };
  }

  if (!resolvedBaseUrl.provided) {
    const suggestedSummary = summarizeSuggestedBaseUrls(suggestedBaseUrls);
    const checks = [
      buildCheck("deploy_base_url_present", "已提供正式 deploy URL", false, {
        expected: "AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名",
        actual: null,
        detail: [
          suggestedSummary
            ? `缺少正式 deploy URL，当前还没执行 deploy HTTP 校验。候选地址探测：${suggestedSummary}。`
            : "缺少正式 deploy URL，当前还没执行 deploy HTTP 校验。",
          renderConfigReview.reviewRelevant ? renderConfigReview.summary : null,
        ]
          .filter(Boolean)
          .join(" "),
      }),
      buildCheck("admin_token_present", "已提供管理令牌", resolvedAdminToken.provided, {
        expected: true,
        actual: resolvedAdminToken.provided,
        detail: resolvedAdminToken.provided
          ? "管理令牌已提供。"
          : "缺少 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN（或 AGENT_PASSPORT_ADMIN_TOKEN），正式放行判断仍不完整。",
      }),
    ];
    const blockedBy = checksToBlockedBy(checks, {
      baseUrl: resolvedBaseUrl.value,
      renderConfigReview,
      configEnvFiles: deployEnvOverlay.loadedFiles,
    });
    const outcome = finalizeBlockedOutcome({
      blockedBy,
      nextActionCandidates: [
        defaultNextActionForCheck(checks[0], {
          renderConfigReview,
          configEnvFiles: deployEnvOverlay.loadedFiles,
        }),
      ],
    });
    const summary = "缺少正式 deploy URL，尚未执行 deploy HTTP 验证。";
    return {
      ok: false,
      rerunCommand: DEPLOY_HTTP_RERUN_COMMAND,
      machineReadableCommand: DEPLOY_HTTP_MACHINE_READABLE_COMMAND,
      baseUrl: null,
      baseUrlSource: null,
      baseUrlSourceType: null,
      baseUrlSourcePath: null,
      adminTokenProvided: resolvedAdminToken.provided,
      adminTokenSource: resolvedAdminToken.source,
      adminTokenSourceType: resolvedAdminToken.sourceType,
      adminTokenSourcePath: resolvedAdminToken.sourcePath,
      configEnvFiles: deployEnvOverlay.loadedFiles,
      checks,
      suggestedBaseUrls,
      renderConfigReview,
      blockedBy: outcome.blockedBy,
      firstBlocker: outcome.firstBlocker,
      releaseReadiness: null,
      summary,
      nextAction: outcome.nextAction,
      operatorSummary: formatOperatorSummary({
        firstBlocker: outcome.firstBlocker,
        nextAction: outcome.nextAction,
        blockedSummary: summary,
      }),
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
    const blockedBy = checksToBlockedBy(checks, {
      baseUrl: baseUrlText,
      renderConfigReview,
      configEnvFiles: deployEnvOverlay.loadedFiles,
    });
    const outcome = finalizeBlockedOutcome({
      blockedBy,
      nextActionCandidates: [
        defaultNextActionForCheck(checks[checks.length - 1], {
          baseUrl: baseUrlText,
          renderConfigReview,
          configEnvFiles: deployEnvOverlay.loadedFiles,
        }),
      ],
    });
    const summary = "正式 deploy URL 当前不可达，deploy HTTP 验证未完成。";
    return {
      ok: false,
      rerunCommand: DEPLOY_HTTP_RERUN_COMMAND,
      machineReadableCommand: DEPLOY_HTTP_MACHINE_READABLE_COMMAND,
      baseUrl: baseUrlText,
      baseUrlSource: resolvedBaseUrl.source,
      baseUrlSourceType: resolvedBaseUrl.sourceType,
      baseUrlSourcePath: resolvedBaseUrl.sourcePath,
      adminTokenProvided: resolvedAdminToken.provided,
      adminTokenSource: resolvedAdminToken.source,
      adminTokenSourceType: resolvedAdminToken.sourceType,
      adminTokenSourcePath: resolvedAdminToken.sourcePath,
      configEnvFiles: deployEnvOverlay.loadedFiles,
      checks,
      suggestedBaseUrls,
      renderConfigReview,
      blockedBy: outcome.blockedBy,
      firstBlocker: outcome.firstBlocker,
      releaseReadiness: null,
      summary,
      nextAction: outcome.nextAction,
      operatorSummary: formatOperatorSummary({
        firstBlocker: outcome.firstBlocker,
        nextAction: outcome.nextAction,
        blockedSummary: summary,
      }),
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
    buildCheck(
      "agents_without_auth_error_class",
      "敏感 agents 读面返回结构化拒绝码",
      agentsWithoutAuth.status === 401 && text(agentsWithoutAuth.data?.errorClass) === "protected_read_token_missing",
      {
        expected: "protected_read_token_missing",
        actual: text(agentsWithoutAuth.data?.errorClass) || null,
        detail:
          "GET /api/agents 未带 token 时必须返回 agent-passport 的 JSON errorClass，避免反向代理或错误服务伪装成受保护读面。",
      }
    ),
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
  const remoteReleaseReadiness = security.data?.releaseReadiness || null;
  const remoteReleaseFailureSemantics = remoteReleaseReadiness?.failureSemantics || null;
  const localReleaseFailureSemantics = releaseReadiness?.failureSemantics || null;
  checks.push(
    buildCheck(
      "security_release_readiness_truth",
      "远端 releaseReadiness 真值可读且一致",
      Boolean(
        remoteReleaseReadiness &&
          text(remoteReleaseReadiness.status) === text(releaseReadiness?.status) &&
          text(remoteReleaseReadiness.readinessClass) === text(releaseReadiness?.readinessClass) &&
          hasFailureSemanticsEnvelope(remoteReleaseFailureSemantics) &&
          Number(remoteReleaseFailureSemantics?.failureCount ?? -1) ===
            Number(localReleaseFailureSemantics?.failureCount ?? -2) &&
          text(remoteReleaseFailureSemantics?.primaryFailure?.code) ===
            text(localReleaseFailureSemantics?.primaryFailure?.code)
      ),
      {
        expected: "remote /api/security.releaseReadiness 与 deploy verifier verdict 一致",
        actual: [
          `remoteStatus=${text(remoteReleaseReadiness?.status) || "missing"}`,
          `remoteClass=${text(remoteReleaseReadiness?.readinessClass) || "missing"}`,
          `remoteFailureCount=${Number.isFinite(Number(remoteReleaseFailureSemantics?.failureCount)) ? Number(remoteReleaseFailureSemantics.failureCount) : "missing"}`,
          `remotePrimary=${text(remoteReleaseFailureSemantics?.primaryFailure?.code) || "none"}`,
          `localStatus=${text(releaseReadiness?.status) || "missing"}`,
          `localClass=${text(releaseReadiness?.readinessClass) || "missing"}`,
          `localFailureCount=${Number(localReleaseFailureSemantics?.failureCount || 0)}`,
          `localPrimary=${text(localReleaseFailureSemantics?.primaryFailure?.code) || "none"}`,
        ].join(" "),
        detail:
          "GET /api/security 必须直接返回结构化 releaseReadiness.failureSemantics，且不能和 deploy verifier 基于远端真值重算出的 verdict 打架。",
      }
    ),
    buildCheck(
      "security_automatic_recovery_failure_semantics",
      "远端自动恢复 failureSemantics 可读",
      hasFailureSemanticsEnvelope(security.data?.automaticRecovery?.failureSemantics),
      {
        expected: "remote /api/security.automaticRecovery.failureSemantics",
        actual: `status=${text(security.data?.automaticRecovery?.failureSemantics?.status) || "missing"} failureCount=${
          Number.isFinite(Number(security.data?.automaticRecovery?.failureSemantics?.failureCount))
            ? Number(security.data.automaticRecovery.failureSemantics.failureCount)
            : "missing"
        }`,
        detail:
          "GET /api/security 必须直接返回 automaticRecovery.failureSemantics，避免 deploy 放行时再靠外部脚本猜自动恢复边界。",
      }
    )
  );
  const failedChecks = checks.filter((entry) => entry.passed === false);
  const blockedBy = checksToBlockedBy(failedChecks, {
    baseUrl: baseUrlText,
    renderConfigReview,
    configEnvFiles: deployEnvOverlay.loadedFiles,
  });
  const outcome = finalizeBlockedOutcome({
    blockedBy,
    nextActionCandidates: [text(releaseReadiness?.nextAction)],
    fallbackNextAction: "继续结合 smoke 与 deploy 结果判断是否可以放行。",
  });
  const summary =
    failedChecks.length === 0
      ? formatRuntimeReleaseReadinessSummary(releaseReadiness)
      : failedChecks[0]?.id === "admin_token_present"
        ? "公开 deploy HTTP 检查已完成，但管理面令牌缺失，正式放行判断仍不完整。"
        : failedChecks[0]?.detail || failedChecks[0]?.label || "deploy HTTP 验证未通过。";

  return {
    ok: failedChecks.length === 0,
    rerunCommand: DEPLOY_HTTP_RERUN_COMMAND,
    machineReadableCommand: DEPLOY_HTTP_MACHINE_READABLE_COMMAND,
    baseUrl: baseUrlText,
    baseUrlSource: resolvedBaseUrl.source,
    baseUrlSourceType: resolvedBaseUrl.sourceType,
    baseUrlSourcePath: resolvedBaseUrl.sourcePath,
    adminTokenProvided: resolvedAdminToken.provided,
    adminTokenSource: resolvedAdminToken.source,
    adminTokenSourceType: resolvedAdminToken.sourceType,
    adminTokenSourcePath: resolvedAdminToken.sourcePath,
    configEnvFiles: deployEnvOverlay.loadedFiles,
    checks,
    suggestedBaseUrls,
    renderConfigReview,
    blockedBy: outcome.blockedBy,
    firstBlocker: outcome.firstBlocker,
    releaseReadiness,
    summary,
    nextAction: outcome.nextAction,
    operatorSummary: formatOperatorSummary({
      firstBlocker: outcome.firstBlocker,
      nextAction: outcome.nextAction,
      readySummary: summary,
      blockedSummary: summary,
    }),
    errorClass: failedChecks.length === 0 ? null : "deploy_check_failed",
    errorStage: failedChecks.length === 0 ? null : "checks",
  };
}

async function main() {
  const result = await verifyPublicDeployHttp();
  await printCliResult(result);
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  main().catch((error) => {
    return printCliError(error);
  });
}

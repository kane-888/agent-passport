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
const ALLOW_LOCAL_DEPLOY_URL_ENV_KEYS = ["AGENT_PASSPORT_ALLOW_LOCAL_DEPLOY_URL", "ALLOW_LOCAL_DEPLOY_URL"];
const REQUIRE_ICP_RECORD_ENV_KEYS = ["AGENT_PASSPORT_REQUIRE_ICP_RECORD"];
const PUBLIC_LOCAL_UI_ROUTE_PROBES = [
  "/operator",
  "/lab.html",
  "/repair-hub",
  "/offline-chat",
  "/agents",
  "/agents/new",
  "/agents/agent_smoke",
  "/agents/agent_smoke/chat",
  "/agents/agent_smoke/memories",
  "/agent-detail.html",
  "/agent-chat.html",
  "/agent-memories.html",
  "/recovery/import",
  "/recovery-import.html",
];
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

function parseOptionalBooleanEnvFlag(value = "") {
  const normalized = text(value).toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "on", "required", "require"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", "optional", "skip"].includes(normalized)) {
    return false;
  }
  return null;
}

function resolveRenderAutoDiscoveryEnabled() {
  return DEPLOY_RENDER_AUTO_DISCOVERY_ENV_KEYS.some((key) => parseBooleanEnvFlag(process.env[key]));
}

function resolveLocalDeployUrlAllowed({ overlay = null } = {}) {
  return ALLOW_LOCAL_DEPLOY_URL_ENV_KEYS.some(
    (key) => parseBooleanEnvFlag(process.env[key]) || parseBooleanEnvFlag(overlay?.values?.[key])
  );
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

function isPrivateIpv4Address(value = "") {
  const normalized = text(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (["0.0.0.0", "127.0.0.1"].includes(normalized)) {
    return true;
  }
  if (/^127\./u.test(normalized) || /^10\./u.test(normalized)) {
    return true;
  }
  const private172Match = normalized.match(/^172\.(\d{1,3})\./u);
  if (private172Match && Number(private172Match[1]) >= 16 && Number(private172Match[1]) <= 31) {
    return true;
  }
  return (
    /^192\.168\./u.test(normalized) ||
    /^169\.254\./u.test(normalized)
  );
}

function decodeIpv4MappedIpv6(hostname = "") {
  const normalized = text(hostname).toLowerCase().replace(/^\[|\]$/gu, "");
  const mapped = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (!mapped) {
    return null;
  }
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return null;
  }
  return [
    (high >> 8) & 255,
    high & 255,
    (low >> 8) & 255,
    low & 255,
  ].join(".");
}

function isPrivateHostname(hostname = "") {
  const normalized = text(hostname).toLowerCase().replace(/^\[|\]$/gu, "");
  if (!normalized) {
    return false;
  }
  const mappedIpv4 = decodeIpv4MappedIpv6(normalized);
  if (mappedIpv4) {
    return isPrivateIpv4Address(mappedIpv4);
  }
  if (["localhost", "::1"].includes(normalized)) {
    return true;
  }
  return (
    isPrivateIpv4Address(normalized) ||
    /^f[cd][0-9a-f]{2}:/u.test(normalized) ||
    /^fe[89ab][0-9a-f]?:/u.test(normalized)
  );
}

function classifyDeployBaseUrl(value = "") {
  try {
    const parsed = new URL(trimTrailingSlash(value));
    const privateOrLoopback = isPrivateHostname(parsed.hostname);
    const https = parsed.protocol === "https:";
    return {
      ok: https && !privateOrLoopback,
      https,
      privateOrLoopback,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
    };
  } catch {
    return {
      ok: false,
      https: false,
      privateOrLoopback: false,
      protocol: null,
      hostname: null,
    };
  }
}

function resolveIcpRecordRequired({ baseUrl = "", overlay = null } = {}) {
  for (const key of REQUIRE_ICP_RECORD_ENV_KEYS) {
    const direct = parseOptionalBooleanEnvFlag(process.env[key]);
    if (direct !== null) {
      return direct;
    }
    const fromFile = parseOptionalBooleanEnvFlag(overlay?.values?.[key]);
    if (fromFile !== null) {
      return fromFile;
    }
  }

  try {
    const parsed = new URL(trimTrailingSlash(baseUrl));
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase().endsWith(".cn") && !isPrivateHostname(parsed.hostname);
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

async function fetchProbeResponse(urlOrPathname, { baseUrl, headers = {}, method = "HEAD" } = {}) {
  const controller = new AbortController();
  const target = /^https?:\/\//u.test(String(urlOrPathname || ""))
    ? String(urlOrPathname)
    : `${baseUrl}${urlOrPathname}`;
  const timeoutId = setTimeout(() => controller.abort(new Error(`timeout:${urlOrPathname}`)), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(target, {
      method,
      headers,
      signal: controller.signal,
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      contentLength: response.headers.get("content-length") || "",
      url: target,
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

export function formatDeployFetchErrorDetail(error, { baseUrl = "" } = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : null;
  const causeCode = text(cause?.code);

  if (causeCode === "ERR_TLS_CERT_ALTNAME_INVALID") {
    const hostname = text(cause?.host) || deployHostnameFromBaseUrl(baseUrl) || "目标域名";
    const certCn = text(cause?.cert?.subject?.CN);
    const subjectAltName = text(cause?.cert?.subjectaltname);
    return [
      `TLS 证书域名不匹配：请求 ${hostname}，但当前证书不包含该域名。`,
      certCn ? `当前证书 CN=${certCn}。` : null,
      subjectAltName ? `当前证书 SAN=${subjectAltName}。` : null,
      `底层错误：${causeCode}${message ? ` / ${message}` : ""}。`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (causeCode) {
    const causeMessage = text(cause?.message || cause?.reason);
    return causeMessage ? `${causeCode}: ${causeMessage}` : `${causeCode}: ${message}`;
  }

  return message;
}

function deployHostnameFromBaseUrl(value = "") {
  try {
    return text(new URL(value).hostname);
  } catch {
    return "";
  }
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
    case "deploy_base_url_public_https":
      return preferredEnvFile
        ? `当前 ${preferredEnvFile} 里的 deploy URL 不是公网 HTTPS；请改填 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重跑 npm run verify:deploy:http。`
        : "当前 deploy URL 不是公网 HTTPS；请设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重跑 npm run verify:deploy:http。";
    case "admin_token_present":
      return preferredEnvFile
        ? `先在 ${preferredEnvFile} 里补齐 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=<token>（或 AGENT_PASSPORT_ADMIN_TOKEN），再重跑 npm run verify:deploy:http。`
        : "先设置 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=<token>（或 AGENT_PASSPORT_ADMIN_TOKEN），再重跑 npm run verify:deploy:http。";
    case "deploy_endpoint_reachable":
      if (/TLS 证书域名不匹配/u.test(text(check.detail))) {
        const hostname = deployHostnameFromBaseUrl(baseUrl) || "目标域名";
        return `先在服务器为 ${hostname} 配置独立 nginx server_name，并签发包含该域名的 HTTPS 证书，再重跑 npm run verify:deploy:http。`;
      }
      return `先确认 ${baseUrl || "目标 deploy URL"} 当前可达，再重跑 npm run verify:deploy:http。`;
    case "agents_without_auth_error_class":
      return "先确认正式部署的 /api/agents 是 agent-passport 受保护读面，并且反向代理没有吞掉 JSON 错误体，再重跑 npm run verify:deploy:http。";
    case "agents_with_auth_200":
    case "agents_array":
    case "device_setup_with_auth_200":
      return "先确认正式部署上的访问口令仍有效，再重跑 npm run verify:deploy:http。";
    case "home_product_shell":
      return "先恢复首页的 agent-passport 品牌和下载入口，再重跑 npm run verify:deploy:http。";
    case "home_download_entry":
      return "先恢复首页的下载 agent-passport 入口，再重跑 npm run verify:deploy:http。";
    case "home_download_positioning":
      return "先把首页改回本地桌面软件下载口径，再重跑 npm run verify:deploy:http。";
    case "home_download_platforms":
      return "先恢复首页的 macOS、Windows、Linux 下载平台状态，再重跑 npm run verify:deploy:http。";
    case "home_no_operator_flow_deeplink":
      return "先移除公网首页上的 /operator?flow=* 直达操作链接，再重跑 npm run verify:deploy:http。";
    case "public_surface_mode":
      return preferredEnvFile
        ? `先在 ${preferredEnvFile} 里设置 AGENT_PASSPORT_SURFACE_MODE=public，重启服务后再重跑 npm run verify:deploy:http。`
        : "先设置 AGENT_PASSPORT_SURFACE_MODE=public，重启服务后再重跑 npm run verify:deploy:http。";
    case "public_local_ui_hidden":
      return "先确认公网模式下 operator、agents、recovery、lab、repair 和 offline-chat 本地页面不再作为公开页面返回 200，再重跑 npm run verify:deploy:http。";
    case "home_legal_links":
      return "先恢复首页隐私政策、用户协议、联系方式链接，再重跑 npm run verify:deploy:http。";
    case "public_config_downloads_readable":
      return "先确认 /api/public-config 返回 downloads.platforms，或补齐下载配置后再重跑 npm run verify:deploy:http。";
    case "public_download_urls_reachable":
      return "先运行 npm run desktop:package 并把 public/downloads 发布到公网服务器，再确认 AGENT_PASSPORT_DOWNLOAD_*_URL 指向可访问文件。";
    case "public_config_compliance_readable":
      return "先确认正式部署暴露 /api/public-config，并且返回 agent-passport 的 compliance 配置，再重跑 npm run verify:deploy:http。";
    case "icp_record_configured":
      return preferredEnvFile
        ? `先在 ${preferredEnvFile} 里填入真实 AGENT_PASSPORT_ICP_RECORD_NUMBER，并重启服务后重跑 npm run verify:deploy:http。`
        : "先填入真实 AGENT_PASSPORT_ICP_RECORD_NUMBER，并重启服务后重跑 npm run verify:deploy:http。";
    case "icp_record_link_url":
      return preferredEnvFile
        ? `先在 ${preferredEnvFile} 里修正 AGENT_PASSPORT_ICP_RECORD_URL 为 http/https 备案链接，再重跑 npm run verify:deploy:http。`
        : "先修正 AGENT_PASSPORT_ICP_RECORD_URL 为 http/https 备案链接，再重跑 npm run verify:deploy:http。";
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
    case "deploy_base_url_public_https":
      return "先改用公网 HTTPS deploy URL";
    case "admin_token_present":
      return "先补齐访问口令";
    case "deploy_endpoint_reachable":
      return "先确认 deploy URL 可达";
    case "agents_without_auth_error_class":
      return "先确认受保护读面错误体";
    case "agents_with_auth_200":
    case "agents_array":
    case "device_setup_with_auth_200":
      return "先确认访问口令仍有效";
    case "home_product_shell":
      return "先恢复首页品牌和下载入口";
    case "home_download_entry":
      return "先恢复下载入口";
    case "home_download_positioning":
      return "先恢复桌面下载口径";
    case "home_download_platforms":
      return "先恢复平台下载状态";
    case "home_no_operator_flow_deeplink":
      return "先移除公网操作深链";
    case "public_surface_mode":
      return "先启用公网 surface mode";
    case "public_local_ui_hidden":
      return "先隐藏公网本地 UI 路由";
    case "home_legal_links":
      return "先恢复法律入口";
    case "public_config_downloads_readable":
      return "先确认公开下载配置可读";
    case "public_download_urls_reachable":
      return "先发布公开下载文件";
    case "public_config_compliance_readable":
      return "先确认公开合规配置可读";
    case "icp_record_configured":
      return "先填入真实 ICP 备案号";
    case "icp_record_link_url":
      return "先修正 ICP 备案链接";
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
  const localDeployUrlAllowed = resolveLocalDeployUrlAllowed({ overlay: deployEnvOverlay });
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
      buildCheck("admin_token_present", "已提供访问口令", resolvedAdminToken.provided, {
        expected: true,
        actual: resolvedAdminToken.provided,
        detail: resolvedAdminToken.provided
          ? "访问口令已提供。"
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

  const deployBaseUrlClass = classifyDeployBaseUrl(resolvedBaseUrl.value);
  if (resolvedBaseUrl.provided && !localDeployUrlAllowed && !deployBaseUrlClass.ok) {
    const checks = [
      buildCheck("deploy_base_url_present", "已提供正式 deploy URL", true, {
        expected: "AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名",
        actual: `${resolvedBaseUrl.value} (${resolvedBaseUrl.source || "unknown"})`,
        detail: "检测到 deploy URL，但正式 deploy HTTP 校验要求公网 HTTPS。",
      }),
      buildCheck("deploy_base_url_public_https", "deploy URL 必须是公网 HTTPS", false, {
        expected: "public https origin",
        actual: `${resolvedBaseUrl.value} (${deployBaseUrlClass.protocol || "invalid"} / ${deployBaseUrlClass.hostname || "unknown"})`,
        detail:
          "正式 deploy HTTP 校验不能用 localhost、私网地址或非 HTTPS 地址冒充公网部署；本机 pre-public 验证请显式设置 AGENT_PASSPORT_ALLOW_LOCAL_DEPLOY_URL=1。",
      }),
      buildCheck("admin_token_present", "已提供访问口令", resolvedAdminToken.provided, {
        expected: true,
        actual: resolvedAdminToken.provided,
        detail: resolvedAdminToken.provided
          ? "访问口令已提供。"
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
    const summary = "deploy URL 不是公网 HTTPS，不能作为正式 deploy HTTP 放行目标。";
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
      errorClass: "non_public_deploy_base_url",
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
      buildCheck("admin_token_present", "已提供访问口令", resolvedAdminToken.provided, {
        expected: true,
        actual: resolvedAdminToken.provided,
        detail: resolvedAdminToken.provided
          ? "访问口令已提供。"
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
    buildCheck("admin_token_present", "已提供访问口令", resolvedAdminToken.provided, {
      expected: true,
      actual: resolvedAdminToken.provided,
      detail: resolvedAdminToken.provided
        ? "访问口令已提供。"
        : "缺少 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN（或 AGENT_PASSPORT_ADMIN_TOKEN），正式放行判断仍不完整。",
    }),
  ];

  let home = null;
  let health = null;
  let capabilities = null;
  let security = null;
  let publicConfig = null;
  let agentsWithoutAuth = null;
  let localUiResponses = [];

  try {
    [home, health, capabilities, security, publicConfig, agentsWithoutAuth, ...localUiResponses] = await Promise.all([
      fetchTextResponse("/", { baseUrl: baseUrlText }),
      fetchJsonResponse("/api/health", { baseUrl: baseUrlText }),
      fetchJsonResponse("/api/capabilities", { baseUrl: baseUrlText }),
      fetchJsonResponse("/api/security", { baseUrl: baseUrlText }),
      fetchJsonResponse("/api/public-config", { baseUrl: baseUrlText }),
      fetchJsonResponse("/api/agents", { baseUrl: baseUrlText }),
      ...PUBLIC_LOCAL_UI_ROUTE_PROBES.map((entry) =>
        fetchTextResponse(entry, { baseUrl: baseUrlText })
      ),
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
        detail: formatDeployFetchErrorDetail(error, { baseUrl: baseUrlText }),
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

  const homeHasProductBrand = home.bodyText.includes("agent-passport");
  const homeHasDownloadEntry = home.bodyText.includes("下载 agent-passport");
  const homeHasDesktopPositioning =
    home.bodyText.includes("本地身份护照软件") &&
    home.bodyText.includes("公网网站只作为下载入口") &&
    home.bodyText.includes("本地软件内完成");
  const homeHasDownloadPlatforms =
    home.bodyText.includes('data-download-platform="macos"') &&
    home.bodyText.includes('data-download-platform="windows"') &&
    home.bodyText.includes('data-download-platform="linux"');
  const homeHasOperatorFlowDeeplink =
    home.bodyText.includes("/operator?flow=create-passport") ||
    home.bodyText.includes("/operator?flow=login-passport");

  checks.push(
    buildCheck("home_html", "首页可达", home.status === 200 && home.contentType.includes("text/html"), {
      expected: "200 + text/html",
      actual: `${home.status} ${home.contentType}`,
      detail: "GET / 应返回 agent-passport 首页 HTML。",
    }),
    buildCheck("home_product_shell", "首页包含 agent-passport 品牌", homeHasProductBrand, {
      expected: true,
      actual: homeHasProductBrand,
      detail: "GET / 应包含 agent-passport 品牌和下载入口。",
    }),
    buildCheck("home_download_entry", "首页包含下载入口", homeHasDownloadEntry, {
      expected: "下载 agent-passport",
      actual: homeHasDownloadEntry,
      detail: "GET / 首屏必须呈现桌面版下载入口，而不是工程操作入口。",
    }),
    buildCheck("home_download_positioning", "首页说明本地软件内使用", homeHasDesktopPositioning, {
      expected: "本地身份护照软件 + 公网网站只作为下载入口 + 本地软件内完成",
      actual: homeHasDesktopPositioning,
      detail: "GET / 必须把创建、登录、恢复定位到本地软件内完成。",
    }),
    buildCheck("home_download_platforms", "首页包含平台下载状态", homeHasDownloadPlatforms, {
      expected: "macOS + Windows + Linux download platform markers",
      actual: homeHasDownloadPlatforms,
      detail: "GET / 必须保留 macOS、Windows、Linux 三个平台下载状态。",
    }),
    buildCheck("home_no_operator_flow_deeplink", "首页不暴露旧操作深链", !homeHasOperatorFlowDeeplink, {
      expected: "no /operator?flow=* links",
      actual: homeHasOperatorFlowDeeplink ? "operator flow deeplink present" : "absent",
      detail: "公网首页只做下载入口，创建/登录/恢复直达链接应留在本地软件或内部操作台。",
    }),
    buildCheck(
      "home_legal_links",
      "首页包含法律与联系入口",
      home.bodyText.includes("/privacy") && home.bodyText.includes("/terms") && home.bodyText.includes("/contact"),
      {
        expected: "/privacy + /terms + /contact",
        actual: `privacy=${home.bodyText.includes("/privacy")} terms=${home.bodyText.includes(
          "/terms"
        )} contact=${home.bodyText.includes("/contact")}`,
        detail: "GET / 页脚必须保留隐私政策、用户协议和联系方式入口。",
      }
    ),
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

  const icpRecordRequired = resolveIcpRecordRequired({
    baseUrl: baseUrlText,
    overlay: deployEnvOverlay,
  });
  const publicCompliance = publicConfig?.data?.compliance || null;
  const publicDownloads = publicConfig?.data?.downloads || null;
  const publicDownloadPlatforms = publicDownloads?.platforms || null;
  const publicSurface = publicConfig?.data?.surface || null;
  const configuredDownloadUrls =
    publicDownloadPlatforms && typeof publicDownloadPlatforms === "object"
      ? Object.entries(publicDownloadPlatforms)
          .map(([platform, config]) => ({
            platform,
            url: text(config?.url),
          }))
          .filter((entry) => entry.url)
      : [];
  const downloadUrlProbes = await Promise.all(
    configuredDownloadUrls.map(async (entry) => {
      try {
        const probe = await fetchProbeResponse(entry.url, { baseUrl: baseUrlText });
        return {
          ...entry,
          status: probe.status,
          contentType: probe.contentType,
          contentLength: probe.contentLength,
          ok: probe.status === 200,
        };
      } catch (error) {
        return {
          ...entry,
          status: null,
          contentType: "",
          contentLength: "",
          ok: false,
          error: formatDeployFetchErrorDetail(error, { baseUrl: baseUrlText }),
        };
      }
    })
  );
  const localUiStatusSummary = localUiResponses
    .map((entry, index) => `${PUBLIC_LOCAL_UI_ROUTE_PROBES[index]}=${entry?.status ?? "missing"}`)
    .join(" ");
  const icpRecordNumber = text(publicCompliance?.icp?.recordNumber);
  const icpRecordUrl = text(publicCompliance?.icp?.recordUrl);
  checks.push(
    buildCheck(
      "public_surface_mode",
      "公网 surface mode 已启用",
      publicConfig.status === 200 &&
        publicConfig.data?.service === "agent-passport" &&
        publicSurface?.mode === "public" &&
        publicSurface?.publicWebsite === true &&
        publicSurface?.localUiAvailable === false,
      {
        expected: "surface.mode=public + publicWebsite=true + localUiAvailable=false",
        actual: `${publicConfig.status} mode=${text(publicSurface?.mode) || null} publicWebsite=${
          publicSurface?.publicWebsite ?? null
        } localUiAvailable=${publicSurface?.localUiAvailable ?? null}`,
        detail: "公网部署必须显式启用 public surface mode，避免操作台和维护页被当成用户入口。",
      }
    ),
    buildCheck(
      "public_local_ui_hidden",
      "公网不暴露本地工作台页面",
      localUiResponses.length === PUBLIC_LOCAL_UI_ROUTE_PROBES.length &&
        localUiResponses.every((entry) => entry?.status === 404),
      {
        expected: `${PUBLIC_LOCAL_UI_ROUTE_PROBES.join(" + ")} all HTTP 404`,
        actual: localUiStatusSummary,
        detail: "公网网站只负责下载、备案、法律和联系；创建、登录、恢复和维护页面只应在本地软件模式暴露。",
      }
    ),
    buildCheck(
      "public_config_downloads_readable",
      "公开下载配置可读",
      publicConfig.status !== 200 ||
        (publicConfig.data?.service === "agent-passport" &&
          publicDownloads &&
          typeof publicDownloads === "object" &&
          publicDownloadPlatforms &&
          typeof publicDownloadPlatforms === "object" &&
          ["macos", "windows", "linux"].every((platform) => platform in publicDownloadPlatforms)),
      {
        expected: "200 + service:agent-passport + downloads.platforms(macos/windows/linux)",
        actual: `${publicConfig.status} service=${text(publicConfig.data?.service) || null} downloads=${Boolean(
          publicDownloads
        )}`,
        detail:
          "GET /api/public-config 应返回 downloads.platforms，公网下载页才能从配置接入桌面安装包链接。",
        skipped: publicConfig.status !== 200,
      }
    ),
    buildCheck(
      "public_download_urls_reachable",
      "公开下载文件可达",
      configuredDownloadUrls.length === 0 || downloadUrlProbes.every((entry) => entry.ok === true),
      {
        expected: configuredDownloadUrls.length === 0 ? "download URLs not configured yet" : "all configured downloads HTTP 200",
        actual:
          configuredDownloadUrls.length === 0
            ? "no configured download URLs"
            : downloadUrlProbes
                .map((entry) => `${entry.platform}=${entry.status ?? "error"} ${entry.contentType || ""}`.trim())
                .join(" "),
        detail:
          "如果 /api/public-config.downloads.platforms.*.url 已配置，正式公网验收必须确认对应桌面包文件可下载。",
        skipped: configuredDownloadUrls.length === 0,
      }
    ),
    buildCheck(
      "public_config_compliance_readable",
      "公开合规配置可读",
      !icpRecordRequired ||
        (publicConfig.status === 200 &&
          publicConfig.data?.service === "agent-passport" &&
          publicCompliance &&
          typeof publicCompliance === "object"),
      {
        expected: icpRecordRequired ? "200 + service:agent-passport + compliance" : "optional for this deploy URL",
        actual: `${publicConfig.status} service=${text(publicConfig.data?.service) || null} compliance=${Boolean(
          publicCompliance
        )}`,
        detail:
          "GET /api/public-config 应返回公开合规配置；.cn 公网部署默认要求能读取 ICP 配置，避免备案页脚被静默漏掉。",
        skipped: !icpRecordRequired,
      }
    ),
    buildCheck(
      "icp_record_configured",
      "ICP备案号已配置",
      !icpRecordRequired || (publicCompliance?.icp?.configured === true && icpRecordNumber.length > 0),
      {
        expected: icpRecordRequired ? "AGENT_PASSPORT_ICP_RECORD_NUMBER=<真实备案号>" : "optional for this deploy URL",
        actual: icpRecordNumber || null,
        detail:
          "正式 .cn 公网部署必须在 /api/public-config.compliance.icp.recordNumber 暴露真实备案号，首页页脚才会展示备案链接。",
        skipped: !icpRecordRequired,
      }
    ),
    buildCheck(
      "icp_record_link_url",
      "ICP备案链接可用",
      !icpRecordRequired || !icpRecordNumber || /^https?:\/\//u.test(icpRecordUrl),
      {
        expected: "http/https URL",
        actual: icpRecordUrl || null,
        detail: "ICP备案号已配置时，recordUrl 必须是可点击的 http/https 链接。",
        skipped: !icpRecordRequired || !icpRecordNumber,
      }
    )
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
      buildCheck("agents_with_auth_200", "访问口令可读取 agents", agentsWithAuth.status === 200, {
        expected: 200,
        actual: agentsWithAuth.status,
        detail: "GET /api/agents 带访问口令时必须返回 200。",
      }),
      buildCheck("agents_array", "agents 返回数组", Array.isArray(agentsWithAuth.data?.agents), {
        expected: true,
        actual: Array.isArray(agentsWithAuth.data?.agents),
        detail: "GET /api/agents 带访问口令后应返回 agents 数组。",
      }),
      buildCheck("device_setup_with_auth_200", "访问口令可读取 device/setup", setupWithAuth.status === 200, {
        expected: 200,
        actual: setupWithAuth.status,
        detail: "GET /api/device/setup 带访问口令时必须返回 200。",
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
    icpRecordRequired,
    publicCompliance,
    downloadUrlProbes,
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

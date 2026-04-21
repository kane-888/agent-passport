import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readGenericPasswordFromKeychainResult } from "../src/local-secrets.js";
import { loadDeployEnvOverlay, parseEnvFile, pickFirstConfigValue } from "./deploy-env-loader.mjs";
import { printCliError, printCliResult } from "./structured-cli-output.mjs";
import { resolveLocalBaseUrl, trimTrailingSlash } from "./self-hosted-config.mjs";
import { verifyGoLiveReadiness } from "./verify-go-live-readiness.mjs";
import { createBlockedItem, finalizeBlockedOutcome, formatOperatorSummary } from "./verifier-outcome-shared.mjs";

const DEFAULT_LOCAL_TIMEOUT_MS = 5000;
const SELF_HOSTED_RERUN_COMMAND = "npm run verify:go-live:self-hosted";
const SELF_HOSTED_MACHINE_READABLE_COMMAND = "npm run --silent verify:go-live:self-hosted";
const KNOWN_SELF_HOSTED_RERUN_COMMANDS = new Map([
  ["npm run verify:deploy:http", SELF_HOSTED_RERUN_COMMAND],
  ["verify:deploy:http", "verify:go-live:self-hosted"],
  ["npm run verify:go-live", SELF_HOSTED_RERUN_COMMAND],
  ["verify:go-live", "verify:go-live:self-hosted"],
  [SELF_HOSTED_RERUN_COMMAND, SELF_HOSTED_RERUN_COMMAND],
  ["verify:go-live:self-hosted", "verify:go-live:self-hosted"],
]);
const KNOWN_SELF_HOSTED_MACHINE_COMMANDS = new Map([
  ["npm run --silent verify:deploy:http", SELF_HOSTED_MACHINE_READABLE_COMMAND],
  ["npm run --silent verify:go-live", SELF_HOSTED_MACHINE_READABLE_COMMAND],
  [SELF_HOSTED_MACHINE_READABLE_COMMAND, SELF_HOSTED_MACHINE_READABLE_COMMAND],
]);
const DEPLOY_BASE_URL_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_BASE_URL", "AGENT_PASSPORT_BASE_URL"];
const DEPLOY_ADMIN_TOKEN_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN", "AGENT_PASSPORT_ADMIN_TOKEN"];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const ADMIN_TOKEN_KEYCHAIN_SERVICE = "AgentPassport.AdminToken";

function getAdminTokenFallbackPath() {
  return process.env.AGENT_PASSPORT_ADMIN_TOKEN_PATH || path.join(rootDir, "data", ".admin-token");
}

function getAdminTokenKeychainAccount() {
  return process.env.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT || "resident-default";
}

function text(value) {
  return String(value ?? "").trim();
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

function buildBlockedItem(id, label, detail, options = {}) {
  return createBlockedItem(id, label, detail, {
    source: "local",
    rerunCommand: SELF_HOSTED_RERUN_COMMAND,
    machineReadableCommand: SELF_HOSTED_MACHINE_READABLE_COMMAND,
    ...options,
  });
}

function resolveLocalBaseUrlSafely(explicitValue = undefined) {
  try {
    return resolveLocalBaseUrl(explicitValue);
  } catch {
    return resolveLocalBaseUrl(undefined);
  }
}

function buildExplicitEnvOverlay(values = {}, sourcePath = null) {
  return {
    values,
    sourcePaths: Object.fromEntries(Object.keys(values).map((key) => [key, sourcePath || null])),
  };
}

function isDeployEnvReadabilityError(error) {
  return ["EACCES", "EPERM", "EISDIR"].includes(text(error?.code));
}

function buildLocalConfigReadFailureResult({ error, localBaseUrl, envFilePath } = {}) {
  const resolvedLocalBaseUrl = resolveLocalBaseUrlSafely(localBaseUrl);
  const configPath =
    text(error?.path) || text(envFilePath) || text(process.env.AGENT_PASSPORT_DEPLOY_ENV_FILE) || "/etc/agent-passport/agent-passport.env";
  const reason = text(error?.code) || "READ_ERROR";
  const detail = `无法读取 deploy 配置文件：${configPath}（${reason}）。`;
  const nextAction = `先确认 ${configPath} 存在且当前用户可读，再重新运行 verify:go-live:self-hosted。`;
  const firstBlocker = buildBlockedItem("deploy_env_file_readable", "deploy 配置文件不可读", detail, {
    actual: configPath,
    expected: "readable",
    nextAction,
  });

  return {
    ok: false,
    status: "blocked",
    rerunCommand: SELF_HOSTED_RERUN_COMMAND,
    machineReadableCommand: SELF_HOSTED_MACHINE_READABLE_COMMAND,
    errorClass: "config_env_unreadable",
    errorStage: "local",
    checkedAt: new Date().toISOString(),
    baseUrl: resolvedLocalBaseUrl.value,
    baseUrlSource: resolvedLocalBaseUrl.source,
    baseUrlSourceType: resolvedLocalBaseUrl.sourceType,
    baseUrlSourcePath: resolvedLocalBaseUrl.sourcePath,
    configEnvFiles: [],
    checks: [],
    blockedBy: [firstBlocker],
    firstBlocker,
    summary: detail,
    nextAction,
    operatorSummary: formatOperatorSummary({
      firstBlocker,
      nextAction,
      blockedSummary: detail,
    }),
  };
}

function resolveDeployBaseUrl({ overlay = null } = {}) {
  const resolved = pickFirstConfigValue(DEPLOY_BASE_URL_ENV_KEYS, { overlay });
  return {
    value: trimTrailingSlash(resolved.value),
    source: resolved.source,
    sourceType: resolved.sourceType,
    sourcePath: resolved.sourcePath,
    provided: Boolean(resolved.value),
  };
}

async function resolveDeployAdminToken({ overlay = null } = {}) {
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

  const keychainToken = readGenericPasswordFromKeychainResult(
    ADMIN_TOKEN_KEYCHAIN_SERVICE,
    getAdminTokenKeychainAccount()
  );
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
    const fallbackPath = getAdminTokenFallbackPath();
    const fallbackToken = text(await fs.readFile(fallbackPath, "utf8"));
    if (fallbackToken) {
      return {
        value: fallbackToken,
        source: "file",
        sourceType: "file",
        sourcePath: fallbackPath,
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

async function buildSkippedUnifiedGoLiveSnapshot({ envFilePath, skipReason = "local_runtime_blocked" } = {}) {
  const deployEnvOverlay = await loadDeployEnvOverlay({ explicitEnvFilePath: envFilePath });
  const resolvedDeployBaseUrl = resolveDeployBaseUrl({ overlay: deployEnvOverlay });
  const resolvedDeployAdminToken = await resolveDeployAdminToken({ overlay: deployEnvOverlay });

  return {
    ok: null,
    skipped: true,
    rerunCommand: SELF_HOSTED_RERUN_COMMAND,
    machineReadableCommand: SELF_HOSTED_MACHINE_READABLE_COMMAND,
    skipReason: text(skipReason) || "local_runtime_blocked",
    readinessClass: "skipped",
    checkedAt: new Date().toISOString(),
    checks: [],
    blockedBy: [],
    firstBlocker: null,
    summary: "本机 loopback 运行态未通过，已跳过 smoke:all 和统一 go-live 子流程。",
    nextAction: null,
    deploy: {
      baseUrl: resolvedDeployBaseUrl.value || null,
      baseUrlSource: resolvedDeployBaseUrl.source,
      baseUrlSourceType: resolvedDeployBaseUrl.sourceType,
      baseUrlSourcePath: resolvedDeployBaseUrl.sourcePath,
      adminTokenProvided: resolvedDeployAdminToken.provided,
      adminTokenSource: resolvedDeployAdminToken.source,
      adminTokenSourceType: resolvedDeployAdminToken.sourceType,
      adminTokenSourcePath: resolvedDeployAdminToken.sourcePath,
      configEnvFiles: deployEnvOverlay.loadedFiles,
    },
  };
}

function normalizeSelfHostedRerunCommand(value = "") {
  const normalized = text(value);
  return KNOWN_SELF_HOSTED_RERUN_COMMANDS.get(normalized) || (normalized || null);
}

function normalizeSelfHostedMachineReadableCommand(value = "") {
  const normalized = text(value);
  return KNOWN_SELF_HOSTED_MACHINE_COMMANDS.get(normalized) || (normalized || null);
}

function rewriteStructuredRerunCommand(textValue = "", rerunCommand = "") {
  const normalizedText = text(textValue);
  const normalizedRerunCommand = text(rerunCommand);
  const normalizedSelfHostedCommand = normalizeSelfHostedRerunCommand(normalizedRerunCommand);
  if (!normalizedText || !normalizedRerunCommand || !normalizedSelfHostedCommand) {
    return null;
  }
  if (!normalizedText.includes(normalizedRerunCommand)) {
    return null;
  }
  return normalizedText.split(normalizedRerunCommand).join(normalizedSelfHostedCommand);
}

function normalizeSelfHostedNextAction(value = "", { rerunCommand = null } = {}) {
  const normalized = text(value);
  if (!normalized) {
    return null;
  }
  const rewritten = rewriteStructuredRerunCommand(normalized, rerunCommand);
  if (rewritten) {
    return rewritten;
  }
  return normalized
    .replace(/npm run verify:deploy:http\b/gu, "npm run verify:go-live:self-hosted")
    .replace(/verify:deploy:http\b/gu, "verify:go-live:self-hosted")
    .replace(/npm run verify:go-live(?!:self-hosted)\b/gu, "npm run verify:go-live:self-hosted")
    .replace(/verify:go-live(?!:self-hosted)\b/gu, "verify:go-live:self-hosted")
    .replace(
      /npm run verify:go-live:self-hosted\s+或\s+npm run verify:go-live:self-hosted/gu,
      "npm run verify:go-live:self-hosted"
    )
    .replace(/verify:go-live:self-hosted\s+或\s+verify:go-live:self-hosted/gu, "verify:go-live:self-hosted");
}

function normalizeBlockedItemsForSelfHosted(entries = [], fallbackSource = "local") {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    ...entry,
    nextAction: normalizeSelfHostedNextAction(entry?.nextAction, { rerunCommand: entry?.rerunCommand }),
    rerunCommand: normalizeSelfHostedRerunCommand(entry?.rerunCommand),
    machineReadableCommand: normalizeSelfHostedMachineReadableCommand(entry?.machineReadableCommand),
    source: entry?.source || fallbackSource,
  }));
}

function mergeConfigEnvFiles(...sources) {
  return [...new Set(sources.flatMap((entry) => (Array.isArray(entry) ? entry.filter(Boolean) : [])))];
}

function buildEffectiveSelfHostedConfig({ localRuntime = null, unifiedGoLive = null } = {}) {
  const deploy = unifiedGoLive?.deploy || null;
  return {
    rerunCommand: SELF_HOSTED_RERUN_COMMAND,
    machineReadableCommand: SELF_HOSTED_MACHINE_READABLE_COMMAND,
    localBaseUrl: text(localRuntime?.baseUrl) || null,
    localBaseUrlSource: text(localRuntime?.baseUrlSource) || null,
    localBaseUrlSourceType: text(localRuntime?.baseUrlSourceType) || null,
    localBaseUrlSourcePath: text(localRuntime?.baseUrlSourcePath) || null,
    deployBaseUrl: text(deploy?.baseUrl) || null,
    deployBaseUrlSource: text(deploy?.baseUrlSource) || null,
    deployBaseUrlSourceType: text(deploy?.baseUrlSourceType) || null,
    deployBaseUrlSourcePath: text(deploy?.baseUrlSourcePath) || null,
    deployAdminTokenProvided: deploy?.adminTokenProvided === true,
    deployAdminTokenSource: text(deploy?.adminTokenSource) || null,
    deployAdminTokenSourceType: text(deploy?.adminTokenSourceType) || null,
    deployAdminTokenSourcePath: text(deploy?.adminTokenSourcePath) || null,
    configEnvFiles: mergeConfigEnvFiles(localRuntime?.configEnvFiles, deploy?.configEnvFiles),
  };
}

function deriveSelfHostedError({ localRuntime = null, unifiedGoLive = null, localOk = false, unifiedOk = false } = {}) {
  if (localOk && unifiedOk) {
    return {
      errorClass: null,
      errorStage: null,
    };
  }

  if (!localOk) {
    const localBlockedBy = Array.isArray(localRuntime?.blockedBy) ? localRuntime.blockedBy : [];
    const localUnexpected = localBlockedBy.some((entry) => entry?.id === "local_runtime_unexpected_error");
    return {
      errorClass: text(localRuntime?.errorClass) || (localUnexpected ? "local_runtime_unexpected_error" : "local_runtime_blocked"),
      errorStage: text(localRuntime?.errorStage) || "local",
    };
  }

  const unifiedBlockedBy = Array.isArray(unifiedGoLive?.blockedBy) ? unifiedGoLive.blockedBy : [];
  const unifiedUnexpected = unifiedBlockedBy.some((entry) => entry?.id === "unified_go_live_unexpected_error");
  return {
    errorClass: text(unifiedGoLive?.errorClass) || (unifiedUnexpected ? "unified_go_live_unexpected_error" : "unified_go_live_blocked"),
    errorStage: text(unifiedGoLive?.errorStage) || (unifiedGoLive?.skipped === true ? "preflight" : "unified"),
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

function formatFetchFailureDetail(url, error, timeoutMs = DEFAULT_LOCAL_TIMEOUT_MS) {
  const primaryMessage = text(error instanceof Error ? error.message : error);
  const causeMessage = text(error?.cause instanceof Error ? error.cause.message : error?.cause);
  const combinedMessage = causeMessage && causeMessage !== primaryMessage ? causeMessage : primaryMessage;
  const timeoutPattern = /^timeout:/u;

  if (timeoutPattern.test(primaryMessage) || timeoutPattern.test(causeMessage) || text(error?.name) === "AbortError") {
    return `请求 ${url} 超时（>${timeoutMs}ms）。`;
  }

  if (combinedMessage) {
    return `请求 ${url} 失败：${combinedMessage}`;
  }

  return `请求 ${url} 失败。`;
}

async function fetchJson(pathname, { baseUrl, timeoutMs = DEFAULT_LOCAL_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`timeout:${pathname}`)), timeoutMs);
  const url = `${baseUrl}${pathname}`;

  try {
    const response = await fetchImpl(url, {
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
      error: formatFetchFailureDetail(url, error, timeoutMs),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function verifyLocalLoopbackRuntime({
  localBaseUrl,
  timeoutMs = DEFAULT_LOCAL_TIMEOUT_MS,
  fetchImpl = fetch,
  envFilePath,
} = {}) {
  let deployEnvOverlay;
  try {
    deployEnvOverlay = await loadDeployEnvOverlay({ explicitEnvFilePath: envFilePath });
  } catch (error) {
    if (isDeployEnvReadabilityError(error)) {
      return buildLocalConfigReadFailureResult({ error, localBaseUrl, envFilePath });
    }
    throw error;
  }
  const resolvedLocalBaseUrl = resolveLocalBaseUrl(localBaseUrl, { overlay: deployEnvOverlay });
  const baseUrl = resolvedLocalBaseUrl.value;
  const [health, security] = await Promise.all([
    fetchJson("/api/health", { baseUrl, timeoutMs, fetchImpl }),
    fetchJson("/api/security", { baseUrl, timeoutMs, fetchImpl }),
  ]);

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

  const outcome = finalizeBlockedOutcome({
    blockedBy,
    fallbackNextAction: "继续执行统一放行检查，确认 smoke 和公网 deploy 判定也一致通过。",
  });
  const summary =
    outcome.blockedBy.length === 0
      ? "本机 loopback 运行态入口已可读，健康检查与安全姿态一致正常。"
      : outcome.firstBlocker?.detail || "本机 loopback 运行态当前未通过。";

  return {
    ok: blockedBy.length === 0,
    status: blockedBy.length === 0 ? "ready" : "blocked",
    rerunCommand: SELF_HOSTED_RERUN_COMMAND,
    machineReadableCommand: SELF_HOSTED_MACHINE_READABLE_COMMAND,
    checkedAt: new Date().toISOString(),
    baseUrl,
    baseUrlSource: resolvedLocalBaseUrl.source,
    baseUrlSourceType: resolvedLocalBaseUrl.sourceType,
    baseUrlSourcePath: resolvedLocalBaseUrl.sourcePath,
    configEnvFiles: deployEnvOverlay.loadedFiles,
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

export function buildSelfHostedGoLiveVerdict({ localRuntime = null, unifiedGoLive = null } = {}) {
  const normalizedLocalRuntime = localRuntime
    ? {
        ...localRuntime,
        nextAction: normalizeSelfHostedNextAction(localRuntime?.nextAction, { rerunCommand: localRuntime?.rerunCommand }),
        rerunCommand: normalizeSelfHostedRerunCommand(localRuntime?.rerunCommand),
        machineReadableCommand: normalizeSelfHostedMachineReadableCommand(localRuntime?.machineReadableCommand),
        blockedBy: normalizeBlockedItemsForSelfHosted(localRuntime?.blockedBy, "local"),
      }
    : null;
  const normalizedUnifiedGoLive = unifiedGoLive
    ? {
        ...unifiedGoLive,
        nextAction: normalizeSelfHostedNextAction(unifiedGoLive?.nextAction, { rerunCommand: unifiedGoLive?.rerunCommand }),
        rerunCommand: normalizeSelfHostedRerunCommand(unifiedGoLive?.rerunCommand),
        machineReadableCommand: normalizeSelfHostedMachineReadableCommand(unifiedGoLive?.machineReadableCommand),
        blockedBy: normalizeBlockedItemsForSelfHosted(unifiedGoLive?.blockedBy, "unified"),
      }
    : null;

  const localOk = normalizedLocalRuntime?.ok === true;
  const unifiedOk = normalizedUnifiedGoLive?.ok === true;
  const blockedBy = [];

  for (const entry of Array.isArray(normalizedLocalRuntime?.blockedBy) ? normalizedLocalRuntime.blockedBy : []) {
    pushBlockedItem(blockedBy, entry);
  }
  for (const entry of Array.isArray(normalizedUnifiedGoLive?.blockedBy) ? normalizedUnifiedGoLive.blockedBy : []) {
    pushBlockedItem(blockedBy, entry);
  }

  let readinessClass = text(normalizedUnifiedGoLive?.readinessClass) || "blocked";
  if (localOk && unifiedOk) {
    readinessClass = "self_hosted_go_live_ready";
  } else if (!localOk) {
    readinessClass = "host_local_runtime_blocked";
  }
  const { errorClass, errorStage } = deriveSelfHostedError({
    localRuntime: normalizedLocalRuntime,
    unifiedGoLive: normalizedUnifiedGoLive,
    localOk,
    unifiedOk,
  });

  const outcome = finalizeBlockedOutcome({
    blockedBy,
    nextActionCandidates: [normalizedUnifiedGoLive?.nextAction, normalizedLocalRuntime?.nextAction],
    fallbackNextAction: "先补齐最先失败的检查，再重新运行 verify:go-live:self-hosted。",
  });
  const summary =
    localOk && unifiedOk
      ? "本机 loopback 真值、smoke:all 和公网 go-live 判定已一致通过。"
      : (localOk && text(normalizedUnifiedGoLive?.summary)) ||
        outcome.firstBlocker?.detail ||
        text(normalizedUnifiedGoLive?.summary) ||
        text(normalizedLocalRuntime?.summary) ||
        "当前还不满足自托管一键放行条件。";

  return {
    ok: localOk && unifiedOk,
    readinessClass,
    rerunCommand: SELF_HOSTED_RERUN_COMMAND,
    machineReadableCommand: SELF_HOSTED_MACHINE_READABLE_COMMAND,
    errorClass,
    errorStage,
    checkedAt: new Date().toISOString(),
    preflightShortCircuited: normalizedUnifiedGoLive?.preflightShortCircuited === true,
    unifiedSkipped: normalizedUnifiedGoLive?.skipped === true,
    unifiedSkipReason: text(normalizedUnifiedGoLive?.skipReason) || null,
    effectiveConfig: buildEffectiveSelfHostedConfig({
      localRuntime: normalizedLocalRuntime,
      unifiedGoLive: normalizedUnifiedGoLive,
    }),
    smoke: normalizedUnifiedGoLive?.smoke || null,
    deploy: normalizedUnifiedGoLive?.deploy || null,
    localReleaseReadiness: normalizedUnifiedGoLive?.localReleaseReadiness || null,
    runtimeReleaseReadiness: normalizedUnifiedGoLive?.runtimeReleaseReadiness || null,
    localRuntime: normalizedLocalRuntime,
    unifiedGoLive: normalizedUnifiedGoLive,
    checks: [
      {
        id: "local_loopback_runtime_ready",
        label: "本机 loopback 运行态已通过",
        passed: localOk,
        actual: text(normalizedLocalRuntime?.status) || null,
        detail: text(normalizedLocalRuntime?.summary) || null,
      },
      ...((Array.isArray(normalizedLocalRuntime?.checks) ? normalizedLocalRuntime.checks : []).map((entry) => ({
        ...entry,
        source: "local",
      }))),
      {
        id: "unified_go_live_ok",
        label: "统一 go-live 判定已通过",
        passed: unifiedOk,
        skipped: normalizedUnifiedGoLive?.skipped === true,
        actual: text(normalizedUnifiedGoLive?.readinessClass) || null,
        detail: text(normalizedUnifiedGoLive?.summary) || null,
      },
    ],
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

export async function verifySelfHostedGoLive({
  localBaseUrl,
  timeoutMs = DEFAULT_LOCAL_TIMEOUT_MS,
  fetchImpl = fetch,
  verifyGoLive = verifyGoLiveReadiness,
  envFilePath,
} = {}) {
  const localRuntime = await verifyLocalLoopbackRuntime({
    localBaseUrl,
    timeoutMs,
    fetchImpl,
    envFilePath,
  }).catch((error) => {
    const safeLocalBaseUrl = resolveLocalBaseUrlSafely(localBaseUrl);
    return {
      ok: false,
      status: "blocked",
      rerunCommand: SELF_HOSTED_RERUN_COMMAND,
      machineReadableCommand: SELF_HOSTED_MACHINE_READABLE_COMMAND,
      errorClass: "local_runtime_unexpected_error",
      errorStage: "local",
      checkedAt: new Date().toISOString(),
      baseUrl: safeLocalBaseUrl.value,
      baseUrlSource: safeLocalBaseUrl.source,
      baseUrlSourceType: safeLocalBaseUrl.sourceType,
      baseUrlSourcePath: safeLocalBaseUrl.sourcePath,
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
    };
  });

  if (localRuntime?.ok !== true) {
    const skipReason = text(localRuntime?.errorClass) || "local_runtime_blocked";
    const unifiedGoLive = await buildSkippedUnifiedGoLiveSnapshot({ envFilePath, skipReason }).catch(() => ({
      ok: null,
      skipped: true,
      rerunCommand: SELF_HOSTED_RERUN_COMMAND,
      machineReadableCommand: SELF_HOSTED_MACHINE_READABLE_COMMAND,
      skipReason,
      readinessClass: "skipped",
      checkedAt: new Date().toISOString(),
      checks: [],
      blockedBy: [],
      firstBlocker: null,
      summary: "本机 loopback 运行态未通过，已跳过 smoke:all 和统一 go-live 子流程。",
      nextAction: null,
      deploy: null,
    }));
    let deploy = unifiedGoLive?.deploy || null;
    if (!deploy) {
      try {
        const explicitEnvSource = envFilePath ? await fs.readFile(envFilePath, "utf8") : "";
        const explicitEnvValues = parseEnvFile(explicitEnvSource);
        const explicitOverlay = buildExplicitEnvOverlay(explicitEnvValues, envFilePath);
        const resolvedDeployBaseUrl = pickFirstConfigValue(
          ["AGENT_PASSPORT_DEPLOY_BASE_URL", "AGENT_PASSPORT_BASE_URL"],
          { overlay: explicitOverlay }
        );
        deploy = {
          baseUrl: resolvedDeployBaseUrl.value || null,
          baseUrlSource: resolvedDeployBaseUrl.source,
          baseUrlSourceType: resolvedDeployBaseUrl.sourceType,
          baseUrlSourcePath: resolvedDeployBaseUrl.sourcePath,
          adminTokenProvided: false,
          adminTokenSource: null,
          adminTokenSourceType: null,
          adminTokenSourcePath: null,
          configEnvFiles: envFilePath ? [envFilePath] : [],
        };
        try {
          const resolvedDeployAdminToken = pickFirstConfigValue(
            ["AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN", "AGENT_PASSPORT_ADMIN_TOKEN"],
            { overlay: explicitOverlay }
          );
          deploy.adminTokenProvided = Boolean(resolvedDeployAdminToken.value);
          deploy.adminTokenSource = resolvedDeployAdminToken.source;
          deploy.adminTokenSourceType = resolvedDeployAdminToken.sourceType;
          deploy.adminTokenSourcePath = resolvedDeployAdminToken.sourcePath;
        } catch {}
      } catch {}
    }

    return buildSelfHostedGoLiveVerdict({
      localRuntime,
      unifiedGoLive: {
        ...unifiedGoLive,
        deploy,
      },
    });
  }

  const unifiedGoLive = await verifyGoLive({ envFilePath }).catch((error) => ({
    ok: false,
    rerunCommand: SELF_HOSTED_RERUN_COMMAND,
    machineReadableCommand: SELF_HOSTED_MACHINE_READABLE_COMMAND,
    readinessClass: "blocked",
    errorClass: "unified_go_live_unexpected_error",
    errorStage: "unified",
    checkedAt: new Date().toISOString(),
    checks: [],
    blockedBy: [
      buildBlockedItem(
        "unified_go_live_unexpected_error",
        "统一 go-live 判定执行异常",
        error instanceof Error ? error.stack || error.message : String(error),
        {
          nextAction: "先修复统一 go-live 子流程异常，再重新运行 verify:go-live:self-hosted。",
          source: "unified",
        }
      ),
    ],
    summary: "统一 go-live 子流程执行失败。",
    nextAction: "先修复统一 go-live 子流程异常，再重新运行 verify:go-live:self-hosted。",
  }));

  return buildSelfHostedGoLiveVerdict({
    localRuntime,
    unifiedGoLive,
  });
}

async function main() {
  const result = await verifySelfHostedGoLive();
  await printCliResult(result);
}

const isDirectRun = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;

if (isDirectRun) {
  main().catch((error) => {
    return printCliError(error);
  });
}

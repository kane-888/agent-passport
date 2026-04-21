import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  getSystemKeychainStatus,
  readGenericPasswordFromKeychainResult,
  writeGenericPasswordToKeychain,
} from "../src/local-secrets.js";
import { resolveLocalBaseUrl, trimTrailingSlash } from "./self-hosted-config.mjs";
import { loadDeployEnvOverlay, pickFirstConfigValue } from "./deploy-env-loader.mjs";
import { ensureSmokeServer } from "./smoke-server.mjs";
import { verifySelfHostedGoLive } from "./verify-self-hosted-go-live.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const ADMIN_TOKEN_ENV_KEYS = ["AGENT_PASSPORT_ADMIN_TOKEN", "AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN"];
const DEPLOY_BASE_URL_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_BASE_URL"];
const DEPLOY_ADMIN_TOKEN_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN", "AGENT_PASSPORT_ADMIN_TOKEN"];
const RECOVERY_PASSPHRASE_ENV_KEYS = ["AGENT_PASSPORT_RECOVERY_PASSPHRASE"];

const ADMIN_TOKEN_KEYCHAIN_SERVICE = "AgentPassport.AdminToken";
const ADMIN_TOKEN_KEYCHAIN_ACCOUNT = "resident-default";
const RECOVERY_PASSPHRASE_KEYCHAIN_SERVICE = "AgentPassport.RecoveryPassphrase";
const RECOVERY_PASSPHRASE_KEYCHAIN_ACCOUNT = "resident-default";
const DEFAULT_PRE_PUBLIC_FETCH_TIMEOUT_MS = 45000;
const DEFAULT_PRE_PUBLIC_LOCAL_REASONER_PROFILE_LIMIT = 1;

function text(value) {
  return String(value ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function getAdminTokenFallbackPath() {
  return process.env.AGENT_PASSPORT_ADMIN_TOKEN_PATH || path.join(rootDir, "data", ".admin-token");
}

export function hasPrePublicDeployBaseUrl({ overlay = null } = {}) {
  return Boolean(trimTrailingSlash(pickFirstConfigValue(DEPLOY_BASE_URL_ENV_KEYS, { overlay }).value));
}

export function buildPrePublicDeployPendingGoLive({ overlay = null } = {}) {
  const deployBaseUrl = pickFirstConfigValue(DEPLOY_BASE_URL_ENV_KEYS, { overlay });
  const deployAdminToken = pickFirstConfigValue(DEPLOY_ADMIN_TOKEN_ENV_KEYS, { overlay });
  return {
    ok: false,
    skipped: true,
    skipReason: "pre_public_deploy_url_pending",
    readinessClass: "local_ready_deploy_pending",
    errorClass: "missing_deploy_base_url",
    errorStage: "preflight",
    checkedAt: nowIso(),
    checks: [
      {
        id: "deploy_http_ok",
        label: "deploy HTTP 验证通过",
        passed: false,
        skipped: true,
        actual: null,
        detail: "缺少正式 deploy URL，公网 HTTP 放行检查暂挂起。",
      },
    ],
    blockedBy: [
      {
        id: "deploy_base_url_present",
        label: "已提供正式 deploy URL",
        passed: false,
        actual: deployBaseUrl.value || null,
        expected: "https://你的公网域名",
        detail: "缺少 AGENT_PASSPORT_DEPLOY_BASE_URL，当前只能完成公网前准备，不能做最终公网放行。",
        nextAction: "设置 AGENT_PASSPORT_DEPLOY_BASE_URL 后，重新运行 verify:go-live:self-hosted 或 verify:go-live。",
        source: "deploy",
      },
    ],
    firstBlocker: {
      id: "deploy_base_url_present",
      label: "已提供正式 deploy URL",
      passed: false,
      actual: deployBaseUrl.value || null,
      expected: "https://你的公网域名",
      detail: "缺少 AGENT_PASSPORT_DEPLOY_BASE_URL，当前只能完成公网前准备，不能做最终公网放行。",
      nextAction: "设置 AGENT_PASSPORT_DEPLOY_BASE_URL 后，重新运行 verify:go-live:self-hosted 或 verify:go-live。",
      source: "deploy",
    },
    deploy: {
      baseUrl: null,
      baseUrlSource: deployBaseUrl.source,
      baseUrlSourceType: deployBaseUrl.sourceType,
      baseUrlSourcePath: deployBaseUrl.sourcePath,
      adminTokenProvided: Boolean(deployAdminToken.value),
      adminTokenSource: deployAdminToken.source,
      adminTokenSourceType: deployAdminToken.sourceType,
      adminTokenSourcePath: deployAdminToken.sourcePath,
      configEnvFiles: Array.isArray(overlay?.loadedFiles) ? overlay.loadedFiles : [],
    },
    smoke: {
      ok: null,
      skipped: true,
      skipReason: "pre_public_deploy_url_pending",
      summary: "pre-public 阶段缺少正式 deploy URL，不触发完整 smoke:all / Safari DOM 门禁。",
    },
    localReleaseReadiness: null,
    runtimeReleaseReadiness: null,
    summary: "公网前准备已完成本机校验；缺少正式 deploy URL，最终公网放行仍待执行。",
    nextAction: "设置 AGENT_PASSPORT_DEPLOY_BASE_URL 后，重新运行 verify:go-live:self-hosted 或 verify:go-live。",
  };
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function resolvePrePublicFetchTimeoutMs(value = process.env.AGENT_PASSPORT_PRE_PUBLIC_FETCH_TIMEOUT_MS) {
  return toPositiveInteger(value, DEFAULT_PRE_PUBLIC_FETCH_TIMEOUT_MS);
}

export function resolvePrePublicLocalReasonerProfileLimit(
  value = process.env.AGENT_PASSPORT_PRE_PUBLIC_LOCAL_REASONER_PROFILE_LIMIT
) {
  return toPositiveInteger(value, DEFAULT_PRE_PUBLIC_LOCAL_REASONER_PROFILE_LIMIT);
}

export function isLoopbackHttpBaseUrl(value = "") {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.replace(/^\[(.*)\]$/u, "$1"))
    );
  } catch {
    return false;
  }
}

export function shouldAutoStartLocalRuntime(resolvedLocalBaseUrl = null) {
  if (process.env.AGENT_PASSPORT_PRE_PUBLIC_AUTO_START === "0") {
    return false;
  }
  try {
    const parsed = new URL(resolvedLocalBaseUrl?.value || "");
    return parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function isAbortLikeError(error = null) {
  const name = text(error?.name);
  const message = text(error?.message);
  const causeMessage = text(error?.cause?.message);
  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    message.startsWith("timeout:") ||
    causeMessage.startsWith("timeout:")
  );
}

function formatHttpFetchFailure(pathname, { baseUrl, method = "GET", error = null, timeoutMs = null } = {}) {
  if (isAbortLikeError(error)) {
    return `${method} ${pathname} 请求 ${trimTrailingSlash(baseUrl || "")}${pathname} 超时（>${timeoutMs || "unknown"}ms）。先确认本机 agent-passport 服务已启动且没有卡住，再重跑 prepare:self-hosted:pre-public。`;
  }
  const message = text(error instanceof Error ? error.message : error);
  const cause = text(error?.cause instanceof Error ? error.cause.message : error?.cause);
  const detail = cause && cause !== message ? cause : message;
  return `${method} ${pathname} 无法访问 ${trimTrailingSlash(baseUrl || "")}${pathname}${
    detail ? `：${detail}` : ""
  }。先确认本机 agent-passport 服务已启动、端口正确，或允许 prepare 脚本自起 loopback 服务后再重跑。`;
}

async function resolveAdminToken({ overlay = null } = {}) {
  const resolved = pickFirstConfigValue(ADMIN_TOKEN_ENV_KEYS, { overlay });
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
    ADMIN_TOKEN_KEYCHAIN_ACCOUNT
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

function resolveRecoveryPassphrase({ overlay = null } = {}) {
  const resolved = pickFirstConfigValue(RECOVERY_PASSPHRASE_ENV_KEYS, { overlay });
  if (resolved.value) {
    return {
      value: resolved.value,
      source: resolved.source,
      sourceType: resolved.sourceType,
      sourcePath: resolved.sourcePath,
      created: false,
      storedInKeychain: false,
      keychainService: null,
      keychainAccount: null,
    };
  }

  const keychainService =
    text(process.env.AGENT_PASSPORT_RECOVERY_PASSPHRASE_KEYCHAIN_SERVICE) || RECOVERY_PASSPHRASE_KEYCHAIN_SERVICE;
  const keychainAccount =
    text(process.env.AGENT_PASSPORT_RECOVERY_PASSPHRASE_KEYCHAIN_ACCOUNT) || RECOVERY_PASSPHRASE_KEYCHAIN_ACCOUNT;
  const keychainPassphrase = readGenericPasswordFromKeychainResult(keychainService, keychainAccount);
  if (keychainPassphrase.found) {
    return {
      value: keychainPassphrase.value,
      source: "keychain",
      sourceType: "keychain",
      sourcePath: null,
      created: false,
      storedInKeychain: true,
      keychainService,
      keychainAccount,
    };
  }

  const keychainStatus = getSystemKeychainStatus();
  if (!keychainStatus.available) {
    throw new Error(
      "Recovery passphrase missing. On non-Keychain hosts, set AGENT_PASSPORT_RECOVERY_PASSPHRASE before running prepare:self-hosted:pre-public."
    );
  }

  const generatedPassphrase = crypto.randomBytes(24).toString("base64url");
  const stored = writeGenericPasswordToKeychain(keychainService, keychainAccount, generatedPassphrase);
  if (!stored.ok) {
    throw new Error(`Unable to store recovery passphrase into Keychain: ${stored.reason || "unknown_error"}`);
  }
  return {
    value: generatedPassphrase,
    source: "keychain_generated",
    sourceType: "keychain",
    sourcePath: null,
    created: true,
    storedInKeychain: true,
    keychainService,
    keychainAccount,
  };
}

export async function fetchJson(
  pathname,
  {
    baseUrl,
    token,
    method = "GET",
    body = undefined,
    timeoutMs = resolvePrePublicFetchTimeoutMs(),
    fetchImpl = fetch,
  } = {}
) {
  const effectiveTimeoutMs = resolvePrePublicFetchTimeoutMs(timeoutMs);
  const controller = new AbortController();
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`timeout:${pathname}`);
      controller.abort(error);
      reject(error);
    }, effectiveTimeoutMs);
  });
  let response;
  let raw = "";
  try {
    response = await Promise.race([
      fetchImpl(`${trimTrailingSlash(baseUrl)}${pathname}`, {
        method,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      timeoutPromise,
    ]);
    raw = await Promise.race([response.text(), timeoutPromise]);
  } catch (error) {
    throw new Error(formatHttpFetchFailure(pathname, { baseUrl, method, error, timeoutMs: effectiveTimeoutMs }));
  } finally {
    clearTimeout(timeoutId);
  }
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (error) {
    if (response.ok) {
      const preview = raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
      throw new Error(
        `${method} ${pathname} returned invalid JSON with HTTP ${response.status}: ${preview || text(error.message)}`
      );
    }
  }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed with HTTP ${response.status}: ${raw}`);
  }
  return data;
}

export function buildPrePublicSetupPackageRequestBody(timestamp = nowIso()) {
  return {
    note: `pre-public-setup-package-${timestamp}`,
    saveToFile: true,
    returnPackage: true,
    dryRun: false,
    includeLocalReasonerProfiles: true,
    localReasonerProfileLimit: resolvePrePublicLocalReasonerProfileLimit(),
  };
}

function summarizeSetupStatus(setupStatus = null) {
  return setupStatus
    ? {
        setupComplete: setupStatus.setupComplete === true,
        missingRequiredCodes: Array.isArray(setupStatus.missingRequiredCodes) ? setupStatus.missingRequiredCodes : [],
        formalRecoveryFlow: setupStatus.formalRecoveryFlow
          ? {
              status: text(setupStatus.formalRecoveryFlow.status) || null,
              durableRestoreReady: setupStatus.formalRecoveryFlow.durableRestoreReady === true,
              missingRequiredCodes: Array.isArray(setupStatus.formalRecoveryFlow.missingRequiredCodes)
                ? setupStatus.formalRecoveryFlow.missingRequiredCodes
                : [],
              runbook: setupStatus.formalRecoveryFlow.runbook
                ? {
                    status: text(setupStatus.formalRecoveryFlow.runbook.status) || null,
                    nextStepLabel: text(setupStatus.formalRecoveryFlow.runbook.nextStepLabel) || null,
                  }
                : null,
            }
          : null,
      }
    : null;
}

function summarizeSecurityStatus(securityStatus = null) {
  return securityStatus
    ? {
        releaseReadiness: securityStatus.releaseReadiness
          ? {
              status: text(securityStatus.releaseReadiness.status) || null,
              readinessClass: text(securityStatus.releaseReadiness.readinessClass) || null,
              nextAction: text(securityStatus.releaseReadiness.nextAction) || null,
              failedCheckCount: Number(securityStatus.releaseReadiness.failedCheckCount || 0),
              criticalFailureCount: Number(securityStatus.releaseReadiness.criticalFailureCount || 0),
              blockedBy: Array.isArray(securityStatus.releaseReadiness.blockedBy)
                ? securityStatus.releaseReadiness.blockedBy
                : [],
            }
          : null,
        automaticRecovery: securityStatus.automaticRecovery
          ? {
              status: text(securityStatus.automaticRecovery.status) || null,
              formalFlowReady: securityStatus.automaticRecovery.formalFlowReady === true,
              operatorBoundary: securityStatus.automaticRecovery.operatorBoundary || null,
            }
          : null,
      }
    : null;
}

function hasMissingRequiredCode(setupStatus = null, code = "") {
  return Array.isArray(setupStatus?.missingRequiredCodes) && setupStatus.missingRequiredCodes.includes(code);
}

function buildSetupBlockedNextAction(setupStatus = null) {
  const missingCodes = Array.isArray(setupStatus?.missingRequiredCodes) ? setupStatus.missingRequiredCodes : [];
  if (missingCodes.includes("local_reasoner_reachable")) {
    return "先恢复或预热本地 reasoner，使 /api/device/setup 不再缺 local_reasoner_reachable，再重跑 prepare:self-hosted:pre-public。";
  }
  if (missingCodes.length > 0) {
    return `先补齐设备 setup 缺口：${missingCodes.join(", ")}，再重跑 prepare:self-hosted:pre-public。`;
  }
  return "先补齐设备 setup 状态，再继续公网前验收。";
}

function makeArtifactCheck(id, passed, detail = null, actual = null) {
  return {
    id,
    passed: passed === true,
    detail: text(detail) || null,
    actual,
  };
}

export function buildPrePublicArtifactProof({
  exportRecovery = null,
  recoveryRehearsal = null,
  setupPackage = null,
} = {}) {
  const recoverySummary = exportRecovery?.summary || null;
  const recoveryBundle = exportRecovery?.bundle || null;
  const rehearsal = recoveryRehearsal?.rehearsal || null;
  const setupSummary = setupPackage?.summary || null;
  const setupPackageBody = setupPackage?.package || null;
  const profileLimit = resolvePrePublicLocalReasonerProfileLimit();
  const setupLocalReasonerProfileCount = Array.isArray(setupPackageBody?.localReasonerProfiles)
    ? setupPackageBody.localReasonerProfiles.length
    : Number.isFinite(Number(setupSummary?.localReasonerProfileCount))
      ? Number(setupSummary.localReasonerProfileCount)
      : 0;

  const bundleId = text(recoverySummary?.bundleId || recoveryBundle?.bundleId);
  const bundlePath = text(recoverySummary?.bundlePath);
  const rehearsalId = text(rehearsal?.rehearsalId);
  const rehearsalBundleId = text(rehearsal?.bundleId || rehearsal?.bundle?.bundleId);
  const packageId = text(setupSummary?.packageId || setupPackageBody?.packageId);
  const packagePath = text(setupSummary?.packagePath);
  const setupLatestBundleId = text(setupSummary?.latestRecoveryBundleId || setupPackageBody?.recovery?.latestBundle?.bundleId);
  const setupLatestRehearsalId = text(
    setupSummary?.latestRecoveryRehearsalId || setupPackageBody?.recovery?.latestPassedRehearsal?.rehearsalId
  );
  const setupStatus = setupPackageBody?.setupStatus || null;
  const setupStatusMissingCodes = Array.isArray(setupStatus?.missingRequiredCodes) ? setupStatus.missingRequiredCodes : [];
  const setupStatusClear =
    !setupStatus ||
    (setupStatus.setupComplete === true && !setupStatusMissingCodes.includes("local_reasoner_reachable"));

  const checks = [
    makeArtifactCheck("recovery_bundle_id_present", Boolean(bundleId), "fresh recovery bundle must expose bundleId", bundleId),
    makeArtifactCheck("recovery_bundle_path_present", Boolean(bundlePath), "fresh recovery bundle must be saved to file", bundlePath),
    makeArtifactCheck(
      "recovery_bundle_body_matches_summary",
      Boolean(bundleId) && text(recoveryBundle?.bundleId) === bundleId,
      "returned recovery bundle body must match summary.bundleId",
      text(recoveryBundle?.bundleId) || null
    ),
    makeArtifactCheck(
      "recovery_bundle_includes_ledger_envelope",
      Boolean(recoveryBundle?.ledger?.envelope),
      "fresh recovery bundle must include ledger envelope",
      Boolean(recoveryBundle?.ledger?.envelope)
    ),
    makeArtifactCheck("recovery_rehearsal_id_present", Boolean(rehearsalId), "fresh recovery rehearsal must expose rehearsalId", rehearsalId),
    makeArtifactCheck(
      "recovery_rehearsal_passed",
      text(rehearsal?.status) === "passed",
      "fresh recovery rehearsal must pass",
      text(rehearsal?.status) || null
    ),
    makeArtifactCheck(
      "recovery_rehearsal_matches_bundle",
      Boolean(bundleId) && rehearsalBundleId === bundleId,
      "fresh recovery rehearsal must point at the freshly exported bundle",
      rehearsalBundleId || null
    ),
    makeArtifactCheck("setup_package_id_present", Boolean(packageId), "fresh setup package must expose packageId", packageId),
    makeArtifactCheck("setup_package_path_present", Boolean(packagePath), "fresh setup package must be saved to file", packagePath),
    makeArtifactCheck(
      "setup_package_body_matches_summary",
      Boolean(packageId) && text(setupPackageBody?.packageId) === packageId,
      "returned setup package body must match summary.packageId",
      text(setupPackageBody?.packageId) || null
    ),
    makeArtifactCheck(
      "setup_package_setup_status_clear",
      setupStatusClear,
      "fresh setup package must not preserve a stale local_reasoner_reachable setup gap",
      setupStatus
        ? {
            setupComplete: setupStatus.setupComplete === true,
            missingRequiredCodes: setupStatusMissingCodes,
          }
        : null
    ),
    makeArtifactCheck(
      "setup_package_local_reasoner_profiles_bounded",
      setupLocalReasonerProfileCount <= profileLimit,
      "pre-public setup package must keep embedded local reasoner profiles lightweight",
      {
        count: setupLocalReasonerProfileCount,
        limit: profileLimit,
      }
    ),
    makeArtifactCheck(
      "setup_package_references_fresh_bundle",
      Boolean(bundleId) && setupLatestBundleId === bundleId,
      "fresh setup package must reference the freshly exported recovery bundle",
      setupLatestBundleId || null
    ),
    makeArtifactCheck(
      "setup_package_references_fresh_rehearsal",
      Boolean(rehearsalId) && setupLatestRehearsalId === rehearsalId,
      "fresh setup package must reference the freshly passed recovery rehearsal",
      setupLatestRehearsalId || null
    ),
  ];
  const failedChecks = checks.filter((entry) => entry.passed !== true);

  return {
    ok: failedChecks.length === 0,
    bundleId: bundleId || null,
    bundlePath: bundlePath || null,
    rehearsalId: rehearsalId || null,
    packageId: packageId || null,
    packagePath: packagePath || null,
    checks,
    failedChecks: failedChecks.map((entry) => entry.id),
  };
}

function assertPrePublicArtifactProof(artifactProof = null) {
  if (artifactProof?.ok === true) {
    return;
  }
  throw new Error(
    `Fresh pre-public recovery artifact proof failed: ${(artifactProof?.failedChecks || ["unknown"]).join(", ")}`
  );
}

export function buildPrePublicReadinessSummary({
  setupStatus = null,
  securityStatus = null,
  selfHostedVerdict = null,
  artifactProof = null,
} = {}) {
  const setupComplete = setupStatus?.setupComplete === true;
  const releaseReady = text(securityStatus?.releaseReadiness?.status) === "ready";
  const formalFlowReady = securityStatus?.automaticRecovery?.formalFlowReady === true;
  const artifactsFresh = artifactProof ? artifactProof.ok === true : true;
  const blockerIds = Array.isArray(selfHostedVerdict?.blockedBy)
    ? selfHostedVerdict.blockedBy.map((entry) => text(entry?.id)).filter(Boolean)
    : [];
  const deployUrlOnlyPending =
    text(selfHostedVerdict?.errorClass) === "missing_deploy_base_url" &&
    blockerIds.length > 0 &&
    blockerIds.every((id) => ["deploy_base_url_present", "missing_deploy_base_url"].includes(id));
  const verifierOk = selfHostedVerdict?.ok === true;
  const ok = artifactsFresh && setupComplete && releaseReady && formalFlowReady && (verifierOk || deployUrlOnlyPending);

  let summary = "公网前准备尚未完成。";
  let nextAction = text(selfHostedVerdict?.nextAction) || text(securityStatus?.releaseReadiness?.nextAction) || null;
  let readinessClass = "pre_public_blocked";
  if (ok && verifierOk) {
    readinessClass = "go_live_ready";
    summary = "正式恢复链、本机门禁和公网放行核验都已通过。";
    nextAction = "可以开始配置正式公网域名与对外入口。";
  } else if (ok && deployUrlOnlyPending) {
    readinessClass = "pre_public_ready_deploy_pending";
    summary = "公网前准备已经完成；当前只剩正式 deploy URL 没配置，所以最终公网放行还没执行。";
    nextAction = "设置 AGENT_PASSPORT_DEPLOY_BASE_URL 后，重新运行 verify:go-live:self-hosted 或 verify:go-live。";
  } else if (!releaseReady || !formalFlowReady) {
    readinessClass = "formal_recovery_blocked";
    summary = "正式恢复链还没收口，当前还不适合接公网。";
    nextAction =
      text(securityStatus?.releaseReadiness?.nextAction) ||
      text(selfHostedVerdict?.nextAction) ||
      "先补齐正式恢复基线，再继续公网前验收。";
  } else if (!setupComplete) {
    readinessClass = "device_setup_blocked";
    summary = "设备运行态 setup 还没收口，当前还不适合接公网。";
    nextAction = buildSetupBlockedNextAction(setupStatus);
  } else if (!artifactsFresh) {
    readinessClass = "pre_public_artifact_proof_failed";
    summary = "本轮恢复包、恢复演练或初始化包没有形成可证明的新鲜闭环。";
    nextAction = "先重新生成 recovery bundle、恢复演练和 setup package，并确认三者互相引用同一轮产物。";
  }

  return {
    ok,
    readinessClass,
    artifactsFresh,
    setupComplete,
    releaseReady,
    formalFlowReady,
    verifierOk,
    deployUrlOnlyPending,
    blockerIds,
    summary,
    nextAction,
  };
}

export async function prepareSelfHostedPrePublic({ envFilePath = undefined, localBaseUrl = undefined } = {}) {
  const overlay = await loadDeployEnvOverlay({ explicitEnvFilePath: envFilePath });
  const resolvedLocalBaseUrl = resolveLocalBaseUrl(localBaseUrl, { overlay });
  const localRuntimeServer = shouldAutoStartLocalRuntime(resolvedLocalBaseUrl)
    ? await ensureSmokeServer(resolvedLocalBaseUrl.value, { reuseExisting: true })
    : null;

  try {
    const adminToken = await resolveAdminToken({ overlay });
    if (!adminToken.provided || !adminToken.value) {
      throw new Error("Admin token missing. Provide AGENT_PASSPORT_ADMIN_TOKEN or store AgentPassport.AdminToken in Keychain.");
    }

    const recoveryPassphrase = resolveRecoveryPassphrase({ overlay });
    const timestamp = nowIso();
    const exportRecovery = await fetchJson("/api/device/runtime/recovery", {
      baseUrl: resolvedLocalBaseUrl.value,
      token: adminToken.value,
      method: "POST",
      body: {
        passphrase: recoveryPassphrase.value,
        saveToFile: true,
        returnBundle: true,
        dryRun: false,
        includeLedgerEnvelope: true,
        note: `pre-public-formal-recovery-bundle-${timestamp}`,
      },
    });
    const bundlePath = text(exportRecovery?.summary?.bundlePath);
    if (!bundlePath) {
      throw new Error("Fresh recovery bundle export did not return a bundlePath.");
    }

    const recoveryRehearsal = await fetchJson("/api/device/runtime/recovery/verify", {
      baseUrl: resolvedLocalBaseUrl.value,
      token: adminToken.value,
      method: "POST",
      body: {
        bundlePath,
        passphrase: recoveryPassphrase.value,
        persist: true,
        dryRun: false,
        note: `pre-public-formal-recovery-rehearsal-${timestamp}`,
      },
    });
    if (text(recoveryRehearsal?.rehearsal?.status) !== "passed") {
      throw new Error(`Recovery rehearsal did not pass: ${text(recoveryRehearsal?.rehearsal?.status) || "unknown"}`);
    }

    let localReasonerPrewarm = null;
    let rawSetupStatus = await fetchJson("/api/device/setup", {
      baseUrl: resolvedLocalBaseUrl.value,
      token: adminToken.value,
    });
    if (hasMissingRequiredCode(rawSetupStatus, "local_reasoner_reachable")) {
      localReasonerPrewarm = await fetchJson("/api/device/runtime/local-reasoner/prewarm", {
        baseUrl: resolvedLocalBaseUrl.value,
        token: adminToken.value,
        method: "POST",
        body: {
          note: `pre-public-local-reasoner-prewarm-${timestamp}`,
          dryRun: false,
        },
      });
      rawSetupStatus = await fetchJson("/api/device/setup", {
        baseUrl: resolvedLocalBaseUrl.value,
        token: adminToken.value,
      });
    }

    const setupPackage = await fetchJson("/api/device/setup/package", {
      baseUrl: resolvedLocalBaseUrl.value,
      token: adminToken.value,
      method: "POST",
      body: buildPrePublicSetupPackageRequestBody(timestamp),
    });
    const artifactProof = buildPrePublicArtifactProof({
      exportRecovery,
      recoveryRehearsal,
      setupPackage,
    });
    assertPrePublicArtifactProof(artifactProof);

    const rawSecurityStatus = await fetchJson("/api/security", {
      baseUrl: resolvedLocalBaseUrl.value,
      token: adminToken.value,
    });
    const selfHostedVerdict = await verifySelfHostedGoLive({
      envFilePath,
      localBaseUrl: resolvedLocalBaseUrl.value,
      verifyGoLive: hasPrePublicDeployBaseUrl({ overlay })
        ? undefined
        : async () => buildPrePublicDeployPendingGoLive({ overlay }),
    });
    const setupStatus = summarizeSetupStatus(rawSetupStatus);
    const securityStatus = summarizeSecurityStatus(rawSecurityStatus);
    const readiness = buildPrePublicReadinessSummary({
      setupStatus,
      securityStatus,
      selfHostedVerdict,
      artifactProof,
    });

    return {
      ok: readiness.ok,
      checkedAt: nowIso(),
      baseUrl: resolvedLocalBaseUrl.value,
      baseUrlSource: resolvedLocalBaseUrl.source,
      baseUrlSourceType: resolvedLocalBaseUrl.sourceType,
      baseUrlSourcePath: resolvedLocalBaseUrl.sourcePath,
      localRuntime: {
        autoStartEnabled: shouldAutoStartLocalRuntime(resolvedLocalBaseUrl),
        startedByPrepare: localRuntimeServer?.started === true,
      },
      adminToken: {
        provided: adminToken.provided,
        source: adminToken.source,
        sourceType: adminToken.sourceType,
        sourcePath: adminToken.sourcePath,
      },
      recoveryPassphrase: {
        source: recoveryPassphrase.source,
        sourceType: recoveryPassphrase.sourceType,
        sourcePath: recoveryPassphrase.sourcePath,
        created: recoveryPassphrase.created,
        storedInKeychain: recoveryPassphrase.storedInKeychain,
        keychainService: recoveryPassphrase.keychainService,
        keychainAccount: recoveryPassphrase.keychainAccount,
      },
      recoveryBundle: exportRecovery?.summary || null,
      recoveryRehearsal: recoveryRehearsal?.rehearsal || null,
      setupPackage: setupPackage?.summary || null,
      localReasonerPrewarm: localReasonerPrewarm
        ? {
            checkedAt: localReasonerPrewarm.checkedAt || null,
            dryRun: localReasonerPrewarm.dryRun === true,
            status: text(localReasonerPrewarm.diagnostics?.status) || null,
            reachable: localReasonerPrewarm.diagnostics?.reachable === true,
            provider: text(localReasonerPrewarm.diagnostics?.provider) || null,
            model: text(localReasonerPrewarm.diagnostics?.model) || null,
          }
        : null,
      artifactProof,
      setupStatus,
      securityStatus,
      selfHostedVerdict: {
        ok: selfHostedVerdict?.ok === true,
        readinessClass: text(selfHostedVerdict?.readinessClass) || null,
        errorClass: text(selfHostedVerdict?.errorClass) || null,
        errorStage: text(selfHostedVerdict?.errorStage) || null,
        firstBlocker: selfHostedVerdict?.firstBlocker || null,
        blockedBy: Array.isArray(selfHostedVerdict?.blockedBy) ? selfHostedVerdict.blockedBy : [],
        nextAction: text(selfHostedVerdict?.nextAction) || null,
      },
      readiness,
      readinessClass: readiness.readinessClass,
      summary: readiness.summary,
      nextAction: readiness.nextAction,
    };
  } finally {
    await localRuntimeServer?.stop();
  }
}

async function main() {
  const result = await prepareSelfHostedPrePublic();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;

if (isDirectRun) {
  main().catch((error) => {
    console.log(
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

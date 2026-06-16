import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  ADMIN_TOKEN_STORAGE_KEY,
  buildOperatorDecisionCards,
  buildOperatorTruthSnapshot,
  buildPublicRuntimeSnapshot,
  buildSecurityBoundarySnapshot,
  LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY,
  LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY,
  PUBLIC_RUNTIME_ENTRY_HREFS,
  isPublicRuntimeHomeFailureText,
} from "../public/runtime-truth-client.js";
import {
  AGENT_PASSPORT_MAIN_AGENT_ID,
  LEGACY_OPENNEED_AGENT_ID,
} from "../src/main-agent-compat.js";
import { resolveAgentPassportLedgerPath } from "../src/runtime-path-config.js";
import { localReasonerFixturePath } from "./smoke-env.mjs";
import { assertPublicCopyPolicyForRoot } from "./public-copy-policy.mjs";
import { createSmokeHttpClient } from "./smoke-ui-http.mjs";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.AGENT_PASSPORT_BASE_URL || "http://127.0.0.1:4319";
const browserName = process.env.AGENT_PASSPORT_BROWSER || "Safari";
const browserAutomationPreference =
  process.env.AGENT_PASSPORT_BROWSER_AUTOMATION ||
  (process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true" ? "webdriver" : "auto");
const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const http = createSmokeHttpClient({ baseUrl, rootDir });
const browserJsPermissionHint = "Allow JavaScript from Apple Events";
const browserAdminTokenStorageKey = ADMIN_TOKEN_STORAGE_KEY;
const legacyBrowserAdminTokenSessionStorageKey = LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY;
const legacyBrowserAdminTokenLocalStorageKey = LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY;
const webdriverBinary = process.env.AGENT_PASSPORT_BROWSER_WEBDRIVER || "safaridriver";
const browserAutomationLockDir =
  process.env.AGENT_PASSPORT_BROWSER_LOCK_DIR || path.join(os.tmpdir(), "agent-passport-smoke-browser.lock");
const browserAutomationLockMetaPath = path.join(browserAutomationLockDir, "owner.json");
const browserAutomationLockWaitMs = Number(process.env.AGENT_PASSPORT_BROWSER_LOCK_WAIT_MS || 15 * 60 * 1000);
const browserAutomationLockPollMs = Number(process.env.AGENT_PASSPORT_BROWSER_LOCK_POLL_MS || 1000);
const browserAutomationLockStaleMs = Number(process.env.AGENT_PASSPORT_BROWSER_LOCK_STALE_MS || 30 * 60 * 1000);
const MAIN_AGENT_ID = AGENT_PASSPORT_MAIN_AGENT_ID;
const LEGACY_MAIN_AGENT_ID = LEGACY_OPENNEED_AGENT_ID;

let browserAutomationContext = null;
let browserAutomationLockHeld = false;
let browserAutomationLockWaitedMs = 0;
const browserAutomationLockToken = randomUUID();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isFailureSemanticsEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const status = text(value.status);
  const failureCount = Number(value.failureCount);
  const failures = Array.isArray(value.failures) ? value.failures : null;
  if (!["clear", "present"].includes(status) || !Number.isFinite(failureCount) || !failures) {
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

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toBrowserOperatorText(value) {
  return text(value)
    .replaceAll("正式恢复", "身份恢复")
    .replaceAll("跨机器恢复", "换机恢复")
    .replaceAll("受限执行", "安全执行")
    .replaceAll("身份凭证", "身份记录")
    .replaceAll("凭证", "身份记录")
    .replaceAll("凭证", "身份记录")
    .replaceAll("审计", "操作记录")
    .replaceAll("当前标签页", "本次浏览")
    .replaceAll("线程", "对话")
    .replaceAll("fan-out", "多人回复")
    .replaceAll("OpenNeed", "历史应用")
    .replaceAll("DID", "身份格式")
    .replaceAll("legacy", "历史兼容")
    .replaceAll("canonical", "主身份")
    .replaceAll("physical owner resident agent", "内部身份记录")
    .replaceAll("effective physical owner", "当前内部身份记录")
    .replaceAll("raw canonical reference", "原始主身份引用")
    .replaceAll("raw resolved owner", "原始解析身份")
    .replaceAll("effective resolved owner", "当前解析身份")
    .replaceAll("resident agent", "身份记录")
    .replaceAll("resolved owner", "解析身份")
    .replaceAll("current physical", "当前内部身份记录")
    .replaceAll("raw resolved", "原始解析身份")
    .replaceAll("/api/security", "安全状态")
    .replaceAll("/api/device/setup", "设备恢复资料")
    .replaceAll("/api", "服务接口")
    .replaceAll("runtime gate", "运行保护")
    .replaceAll("prompt 预检", "提问前检查")
    .replaceAll("prompt 预处理链", "提问处理流程")
    .replaceAll("runtime contract", "运行契约")
    .replaceAll("fail-closed", "安全拦截")
    .replaceAll("kernel 预览", "身份状态预览")
    .replaceAll("门禁", "安全检查")
    .replaceAll("放行条件", "通过条件")
    .replaceAll("放行", "允许")
    .replaceAll("可执行动作", "可做动作")
    .replaceAll("何时执行", "何时做")
    .replaceAll("AI 运行", "智能运行")
    .replaceAll("硬阻塞", "必须先处理的问题")
    .replaceAll("巡检", "检查");
}

function toBrowserOperatorSemanticText(value) {
  return toBrowserOperatorText(value)
    .replaceAll("本地账本", "本地身份资料")
    .replaceAll("账本", "身份资料")
    .replaceAll("身份恢复周期", "恢复检查周期")
    .replaceAll("身份恢复主线", "身份恢复流程")
    .replaceAll("安全执行层", "安全执行")
    .replaceAll("受限执行层", "安全执行")
    .replaceAll("执行边界", "安全限制")
    .replaceAll("系统级调度沙箱", "系统保护")
    .replaceAll("调度沙箱", "系统保护")
    .replaceAll("允许清单", "清单")
    .replaceAll("放行清单", "清单")
    .replaceAll("有界允许", "有条件允许")
    .replaceAll("风险允许", "风险策略")
    .replaceAll("切机", "换机");
}

function isBrowserOperatorAgentRuntimeExportContent(value) {
  const normalized = toBrowserOperatorText(value);
  return normalized.includes("智能运行状态") || normalized.includes(toBrowserOperatorText("agent 运行真值"));
}

function includesAnyText(value, needles = []) {
  const normalized = text(value);
  return needles.some((needle) => normalized.includes(needle));
}

function isDispatchResultMetaText(value) {
  return includesAnyText(value, ["最近一轮调度结果", "最近一轮分配结果"]);
}

function isDispatchRecordMetaText(value, expectedRecordId = "") {
  return (
    text(value).includes(text(expectedRecordId)) ||
    includesAnyText(value, ["回复记录", "记录"])
  );
}

function isParallelBatchText(value) {
  return includesAnyText(value, ["并行批次", "同时回复批次", "同时回复"]);
}

function isAssistantDispatchText(value) {
  return /fan-out|并行|串行|多人回复|同时|依次/u.test(text(value));
}

function textOr(value, fallback = "未确认") {
  return text(value) || fallback;
}

function boolLabel(value, { trueLabel = "是", falseLabel = "否", unknownLabel = "未确认" } = {}) {
  if (value === true) {
    return trueLabel;
  }
  if (value === false) {
    return falseLabel;
  }
  return unknownLabel;
}

async function readBrowserAutomationLockMeta() {
  try {
    return JSON.parse(await readFile(browserAutomationLockMetaPath, "utf8"));
  } catch {
    return null;
  }
}

function isLiveProcessPid(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return false;
  }
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") {
      return true;
    }
    return false;
  }
}

async function tryClearStaleBrowserAutomationLock() {
  try {
    const owner = await readBrowserAutomationLockMeta();
    if (owner?.pid && isLiveProcessPid(owner.pid)) {
      return false;
    }
    if (owner?.pid && !isLiveProcessPid(owner.pid)) {
      await rm(browserAutomationLockDir, { recursive: true, force: true });
      return true;
    }
    const lockStat = await stat(browserAutomationLockDir);
    if (Date.now() - lockStat.mtimeMs < browserAutomationLockStaleMs) {
      return false;
    }
    await rm(browserAutomationLockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function acquireBrowserAutomationLock() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < browserAutomationLockWaitMs) {
    try {
      await mkdir(browserAutomationLockDir, { recursive: false });
      await writeFile(
        browserAutomationLockMetaPath,
        JSON.stringify(
          {
            pid: process.pid,
            acquiredAt: new Date().toISOString(),
            baseUrl,
            browserName,
            token: browserAutomationLockToken,
          },
          null,
          2
        )
      );
      browserAutomationLockHeld = true;
      browserAutomationLockWaitedMs = Math.max(0, Date.now() - startedAt);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await tryClearStaleBrowserAutomationLock()) {
        continue;
      }
      const owner = await readBrowserAutomationLockMeta();
      if (owner?.pid && owner.pid !== process.pid) {
        console.error(
          `[smoke:browser] waiting for Safari automation lock held by pid=${owner.pid} since ${owner.acquiredAt || "unknown"}`
        );
      }
      await sleep(browserAutomationLockPollMs);
    }
  }
  const owner = await readBrowserAutomationLockMeta();
  throw new Error(
    `smoke:browser waited too long for Safari automation lock${
      owner?.pid ? ` (owner pid=${owner.pid}, acquiredAt=${owner.acquiredAt || "unknown"})` : ""
    }`
  );
}

async function releaseBrowserAutomationLock() {
  if (!browserAutomationLockHeld) {
    return;
  }
  browserAutomationLockHeld = false;
  const owner = await readBrowserAutomationLockMeta();
  if (owner?.pid !== process.pid || owner?.token !== browserAutomationLockToken) {
    return;
  }
  await rm(browserAutomationLockDir, { recursive: true, force: true });
}

function normalizeVisibleText(value) {
  return text(value).replace(/\s+/g, " ");
}

function summarizeVisibleText(value, limit = 280) {
  const normalized = normalizeVisibleText(value);
  if (!normalized) {
    return "";
  }
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}...`;
}

function isRuntimeHomeFailureState(value) {
  return Boolean(
    value &&
      (isPublicRuntimeHomeFailureText(value.homeSummary) ||
        isPublicRuntimeHomeFailureText(value.healthSummary) ||
        isPublicRuntimeHomeFailureText(value.recoverySummary) ||
        isPublicRuntimeHomeFailureText(value.automationSummary))
  );
}

function isPublicDownloadTitle(value = "") {
  const normalized = text(value);
  return normalized === "下载 agent-passport" || normalized.includes("本地 Agent 的身份、记忆、恢复和审计");
}

function isBrowserJavaScriptPermissionError(error) {
  return String(error?.message || error || "").includes(browserJsPermissionHint);
}

function isFatalWaitForJsonStateError(error) {
  return String(error?.name || "") === "WaitForJsonFatalStateError";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserUrlHasExpectedParams(latestUrl, expectedParams = {}) {
  try {
    const parsed = new URL(latestUrl);
    return Object.entries(expectedParams).every(([key, value]) => text(parsed.searchParams.get(key)) === text(value));
  } catch {
    return Object.entries(expectedParams).every(([key, value]) =>
      latestUrl.includes(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    );
  }
}

async function getJson(path, { allowAuthFallback = true } = {}) {
  try {
    return await http.publicGetJson(path);
  } catch (error) {
    if (!allowAuthFallback || !String(error.message || error).includes("HTTP 401")) {
      throw error;
    }
  }
  return http.getJson(path);
}

function buildExpectedRuntimeHomeView(health = {}, security = {}) {
  const runtimeHome = buildPublicRuntimeSnapshot({ health, security });
  assert(
    runtimeHome.readyForSmoke === true,
    `公开运行态真值缺失，不能用页面 fallback 文案通过 smoke：${(runtimeHome.missingFields || []).join(", ")}`
  );
  return {
    ...runtimeHome,
    triggerLabels: runtimeHome.triggerLabels.length ? runtimeHome.triggerLabels : ["当前没有额外触发条件。"],
    runtimeLinks: [],
  };
}

function buildExpectedLabSecurityBoundariesView(security = {}) {
  const snapshot = buildSecurityBoundarySnapshot(security);
  assert(
    snapshot.readyForSmoke === true,
    `运行现场安全边界真值缺失，不能用页面 fallback 文案通过 smoke：${(snapshot.missingFields || []).join(", ")}`
  );
  return snapshot;
}

async function requestJson(path, options = {}) {
  const response = await http.authorizedFetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}: ${payload?.error || "unknown error"}`);
  }
  return payload;
}

function resolveSmokeDataDir() {
  const ledgerPath = text(resolveAgentPassportLedgerPath({ dataDir: path.join(rootDir, "data") }));
  return ledgerPath ? path.dirname(ledgerPath) : path.join(rootDir, "data");
}

async function configureSmokeBrowserLocalReasoner() {
  const configuredRuntime = await requestJson("/api/device/runtime", {
    method: "POST",
    body: JSON.stringify({
      residentAgentId: MAIN_AGENT_ID,
      residentDidMethod: "agentpassport",
      localMode: "local_only",
      allowOnlineReasoner: false,
      localReasonerEnabled: true,
      localReasonerProvider: "local_command",
      localReasonerCommand: process.execPath,
      localReasonerArgs: [localReasonerFixturePath],
      localReasonerCwd: rootDir,
      filesystemAllowlist: [resolveSmokeDataDir(), "/tmp"],
      retrievalStrategy: "local_first_non_vector",
      allowVectorIndex: false,
    }),
  });
  assert(configuredRuntime.deviceRuntime?.localReasoner?.provider === "local_command", "smoke:browser 未切到 local_command");
  assert(configuredRuntime.deviceRuntime?.localReasoner?.configured === true, "smoke:browser local_command 配置未生效");
}

async function allocateWebDriverPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error("无法分配 WebDriver 端口"));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function webdriverRequest(pathname, { method = "GET", body = null } = {}) {
  const context = browserAutomationContext;
  assert(context?.mode === "webdriver" && context.port, "WebDriver 上下文尚未就绪");
  const response = await fetch(`http://127.0.0.1:${context.port}${pathname}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.value?.message ||
        payload?.message ||
        `WebDriver ${method} ${pathname} -> HTTP ${response.status}`
    );
  }
  return payload;
}

async function waitForWebDriverReady(timeoutMs = 10000) {
  const startedAt = Date.now();
  let latestError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await webdriverRequest("/status");
      return;
    } catch (error) {
      latestError = String(error?.message || error || "");
    }
    await sleep(200);
  }
  throw new Error(`WebDriver 未在预期时间内就绪: ${latestError || "unknown error"}`);
}

async function startWebDriverAutomation() {
  if (browserName !== "Safari") {
    throw new Error(`当前 WebDriver 通道只支持 Safari，收到浏览器=${browserName}`);
  }

  const port = await allocateWebDriverPort();
  let stdout = "";
  let stderr = "";
  const driverProcess = spawn(webdriverBinary, ["-p", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  driverProcess.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  driverProcess.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  browserAutomationContext = {
    mode: "webdriver",
    port,
    driverProcess,
    sessionId: null,
    stdout,
    stderr,
  };

  try {
    await waitForWebDriverReady();
    const sessionPayload = await webdriverRequest("/session", {
      method: "POST",
      body: {
        capabilities: {
          alwaysMatch: {
            browserName: "Safari",
          },
        },
      },
    });
    const sessionId = text(sessionPayload?.value?.sessionId);
    if (!sessionId) {
      throw new Error("WebDriver 没有返回 sessionId");
    }
    browserAutomationContext.sessionId = sessionId;
    return browserAutomationContext;
  } catch (error) {
    try {
      driverProcess.kill("SIGTERM");
    } catch {}
    browserAutomationContext = null;
    throw new Error(
      `无法启动 Safari WebDriver 自动化：${error.message || error}${
        stderr || stdout ? `\n${stderr || stdout}` : ""
      }`
    );
  }
}

async function ensureBrowserAutomationContext() {
  if (browserAutomationContext) {
    return browserAutomationContext;
  }
  if (browserAutomationPreference === "webdriver") {
    return startWebDriverAutomation();
  }
  if (browserAutomationPreference === "auto" && browserName === "Safari") {
    try {
      return await startWebDriverAutomation();
    } catch (error) {
      browserAutomationContext = {
        mode: "applescript",
        fallbackReason: String(error?.message || error || ""),
      };
      return browserAutomationContext;
    }
  }
  browserAutomationContext = {
    mode: "applescript",
  };
  return browserAutomationContext;
}

async function closeBrowserAutomation() {
  const context = browserAutomationContext;
  browserAutomationContext = null;
  if (!context) {
    return;
  }
  if (context.mode === "webdriver") {
    try {
      if (context.sessionId) {
        await fetch(`http://127.0.0.1:${context.port}/session/${context.sessionId}`, {
          method: "DELETE",
        }).catch(() => null);
      }
    } finally {
      try {
        context.driverProcess?.kill("SIGTERM");
      } catch {}
    }
  }
}

async function runAppleScript(lines) {
  const args = [];
  for (const line of lines) {
    args.push("-e", line);
  }

  const { stdout, stderr } = await execFileAsync("osascript", args, {
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });

  if (stderr?.trim()) {
    throw new Error(stderr.trim());
  }

  return stdout.trim();
}

async function browserEval(expression) {
  const context = await ensureBrowserAutomationContext();
  if (context.mode === "webdriver") {
    const payload = await webdriverRequest(`/session/${context.sessionId}/execute/sync`, {
      method: "POST",
      body: {
        script: "return eval(arguments[0]);",
        args: [expression],
      },
    });
    return payload?.value ?? null;
  }

  const payload = JSON.stringify(expression);
  return runAppleScript([
    `set jsPayload to ${payload}`,
    `tell application ${JSON.stringify(browserName)}`,
    '  if (count of documents) is 0 then error "No browser document available"',
    '  return do JavaScript jsPayload in front document',
    "end tell",
  ]);
}

async function openBrowserDocument(url) {
  const context = await ensureBrowserAutomationContext();
  if (context.mode === "webdriver") {
    await webdriverRequest(`/session/${context.sessionId}/url`, {
      method: "POST",
      body: {
        url,
      },
    });
    return "window";
  }

  return runAppleScript([
    `set targetUrl to ${JSON.stringify(url)}`,
    `tell application ${JSON.stringify(browserName)}`,
    "  activate",
    "  make new document",
    "  set URL of front document to targetUrl",
    '  return "window"',
    "end tell",
  ]);
}

async function navigateFrontBrowserDocument(url) {
  const context = await ensureBrowserAutomationContext();
  if (context.mode === "webdriver") {
    await webdriverRequest(`/session/${context.sessionId}/url`, {
      method: "POST",
      body: {
        url,
      },
    });
    return url;
  }

  return runAppleScript([
    `set targetUrl to ${JSON.stringify(url)}`,
    `tell application ${JSON.stringify(browserName)}`,
    '  if (count of documents) is 0 then make new document',
    "  activate",
    "  set URL of front document to targetUrl",
    "  return URL of front document",
    "end tell",
  ]);
}

async function frontBrowserDocumentUrl() {
  const context = await ensureBrowserAutomationContext();
  if (context.mode === "webdriver") {
    const payload = await webdriverRequest(`/session/${context.sessionId}/url`);
    return text(payload?.value);
  }

  return runAppleScript([
    `tell application ${JSON.stringify(browserName)}`,
    '  if (count of windows) is 0 then return ""',
    "  return URL of front document",
    "end tell",
  ]);
}

async function frontBrowserDocumentText() {
  const context = await ensureBrowserAutomationContext();
  if (context.mode === "webdriver") {
    const payload = await webdriverRequest(`/session/${context.sessionId}/execute/sync`, {
      method: "POST",
      body: {
        script: "return document.body ? document.body.innerText : '';",
        args: [],
      },
    });
    return text(payload?.value);
  }

  return runAppleScript([
    `tell application ${JSON.stringify(browserName)}`,
    '  if (count of windows) is 0 then return ""',
    "  return text of front document",
    "end tell",
  ]);
}

function browserUrlMatchesTarget(latestUrl, targetUrl) {
  try {
    const latest = new URL(latestUrl);
    const target = new URL(targetUrl);
    if (latest.origin !== target.origin || latest.pathname !== target.pathname) {
      return false;
    }
    const expectedParams = Object.fromEntries(Array.from(target.searchParams.entries()));
    return browserUrlHasExpectedParams(latestUrl, expectedParams);
  } catch {
    return latestUrl.split("?")[0] === targetUrl.split("?")[0];
  }
}

async function closeBrowserDocument() {
  const context = await ensureBrowserAutomationContext();
  if (context.mode === "webdriver") {
    await webdriverRequest(`/session/${context.sessionId}/url`, {
      method: "POST",
      body: {
        url: "about:blank",
      },
    });
    return;
  }

  await runAppleScript([
    `tell application ${JSON.stringify(browserName)}`,
    '  if (count of windows) is greater than 0 then close front window',
    "end tell",
  ]);
}

async function waitForFrontDocumentUrl(targetUrl, label) {
  const startedAt = Date.now();
  let latestUrl = "";

  while (Date.now() - startedAt < 20000) {
    try {
      latestUrl = await frontBrowserDocumentUrl();
      if (latestUrl && browserUrlMatchesTarget(latestUrl, targetUrl)) {
        return latestUrl;
      }
      await navigateFrontBrowserDocument(targetUrl);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`${label} 页面 URL 未在预期时间内就绪: ${latestUrl || "empty"}`);
}

async function waitForReady(label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    try {
      const readyState = await browserEval("document.readyState");
      if (readyState === "complete") {
        return;
      }
    } catch (error) {
      if (isBrowserJavaScriptPermissionError(error)) {
        throw new Error("Safari 未开启 “Allow JavaScript from Apple Events”，无法执行 DOM 级浏览器回归。请先在 Safari 设置的 Developer 区域启用它。");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} 页面未在预期时间内完成加载`);
}

async function waitForJson(expression, predicate, label, options = {}) {
  const { fatalPredicate = null, timeoutMs = 20000 } = options;
  const startedAt = Date.now();
  let latest = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const raw = await browserEval(
        `(() => { try { return JSON.stringify(${expression}); } catch (error) { return JSON.stringify({ error: String(error) }); } })()`
      );
      latest = raw ? JSON.parse(raw) : null;
      if (predicate(latest)) {
        return latest;
      }
      if (typeof fatalPredicate === "function" && fatalPredicate(latest)) {
        const error = new Error(`${label} 进入失败态: ${JSON.stringify(latest)}`);
        error.name = "WaitForJsonFatalStateError";
        throw error;
      }
    } catch (error) {
      if (isBrowserJavaScriptPermissionError(error)) {
        throw new Error("Safari 未开启 “Allow JavaScript from Apple Events”，无法执行 DOM 级浏览器回归。请先在 Safari 设置的 Developer 区域启用它。");
      }
      if (isFatalWaitForJsonStateError(error)) {
        throw error;
      }
      latest = { error: error.message };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`${label} 未达到预期状态: ${JSON.stringify(latest)}`);
}

async function waitForTextSnapshot(predicate, label) {
  const startedAt = Date.now();
  let latest = { url: "", text: "" };

  while (Date.now() - startedAt < 25000) {
    try {
      latest = {
        url: await frontBrowserDocumentUrl(),
        text: await frontBrowserDocumentText(),
      };
      if (predicate(latest)) {
        return latest;
      }
    } catch (error) {
      latest = {
        ...latest,
        error: error.message,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `${label} 未达到预期文本状态: ${JSON.stringify({
      url: latest.url,
      error: latest.error || "",
      preview: summarizeVisibleText(latest.text),
    })}`
  );
}

async function withBrowserDocument(url, fn) {
  await openBrowserDocument(url);
  try {
    await waitForFrontDocumentUrl(url, url);
    return await fn(url);
  } finally {
    try {
      await closeBrowserDocument();
    } catch {}
  }
}

async function seedBrowserAdminToken() {
  const adminToken = await http.getAdminToken();
  assert(adminToken, "无法解析访问口令，无法执行带鉴权的浏览器深链回归");
  return seedBrowserToken(adminToken);
}

async function seedBrowserToken(token) {
  const normalizedToken = String(token || "");
  return withBrowserDocument(`${baseUrl}/offline-chat`, async () => {
    await waitForReady("浏览器鉴权预热");
    return waitForJson(
      `(() => {
        sessionStorage.setItem(${JSON.stringify(browserAdminTokenStorageKey)}, ${JSON.stringify(normalizedToken)});
        sessionStorage.setItem(${JSON.stringify(legacyBrowserAdminTokenSessionStorageKey)}, ${JSON.stringify(normalizedToken)});
        localStorage.setItem(${JSON.stringify(legacyBrowserAdminTokenLocalStorageKey)}, ${JSON.stringify(normalizedToken)});
        return {
          stored: sessionStorage.getItem(${JSON.stringify(browserAdminTokenStorageKey)}) || "",
          legacySessionStored: sessionStorage.getItem(${JSON.stringify(legacyBrowserAdminTokenSessionStorageKey)}) || "",
          legacyLocalStored: localStorage.getItem(${JSON.stringify(legacyBrowserAdminTokenLocalStorageKey)}) || "",
          origin: window.location.origin || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.stored === normalizedToken &&
            value.legacySessionStored === normalizedToken &&
            value.legacyLocalStored === normalizedToken &&
            value.origin === new URL(baseUrl).origin
        ),
      "浏览器鉴权预热"
    );
  });
}

async function injectBrowserAdminTokenIntoCurrentDocument() {
  const adminToken = await http.getAdminToken();
  assert(adminToken, "无法解析访问口令，无法向本次浏览注入浏览器鉴权");
  return waitForJson(
    `(() => {
      sessionStorage.setItem(${JSON.stringify(browserAdminTokenStorageKey)}, ${JSON.stringify(adminToken)});
      sessionStorage.setItem(${JSON.stringify(legacyBrowserAdminTokenSessionStorageKey)}, ${JSON.stringify(adminToken)});
      localStorage.setItem(${JSON.stringify(legacyBrowserAdminTokenLocalStorageKey)}, ${JSON.stringify(adminToken)});
      return {
        stored: sessionStorage.getItem(${JSON.stringify(browserAdminTokenStorageKey)}) || "",
        legacySessionStored: sessionStorage.getItem(${JSON.stringify(legacyBrowserAdminTokenSessionStorageKey)}) || "",
        legacyLocalStored: localStorage.getItem(${JSON.stringify(legacyBrowserAdminTokenLocalStorageKey)}) || ""
      };
    })()`,
    (value) =>
      Boolean(
        value &&
          value.stored === adminToken &&
          value.legacySessionStored === adminToken &&
          value.legacyLocalStored === adminToken
      ),
    "本次浏览鉴权注入"
  );
}

async function refreshOfflineChatDocumentAfterAuthInjection() {
  await injectBrowserAdminTokenIntoCurrentDocument();
  await browserEval(`(() => {
    const refreshButton = document.getElementById("refresh-button");
    refreshButton?.click();
    return Boolean(refreshButton);
  })()`);
}

function buildSynchronousBrowserJsonRequestExpression(
  resourcePath,
  { method = "GET", body = null, protectedRead = false, publicRead = false } = {}
) {
  if (publicRead && protectedRead) {
    throw new Error(`${resourcePath} cannot be both publicRead and protectedRead`);
  }
  const serializedBody = body == null ? "null" : JSON.stringify(JSON.stringify(body));
  return `(() => {
    const request = new XMLHttpRequest();
    request.open(${JSON.stringify(method)}, ${JSON.stringify(resourcePath)}, false);
    request.setRequestHeader("Content-Type", "application/json");
    if (${protectedRead && !publicRead ? "true" : "false"}) {
      const storedToken =
        sessionStorage.getItem(${JSON.stringify(browserAdminTokenStorageKey)}) ||
        sessionStorage.getItem(${JSON.stringify(legacyBrowserAdminTokenSessionStorageKey)}) ||
        localStorage.getItem(${JSON.stringify(legacyBrowserAdminTokenLocalStorageKey)}) ||
        "";
      if (storedToken) {
        request.setRequestHeader("Authorization", \`Bearer \${storedToken}\`);
      }
    }
    try {
      request.send(${serializedBody});
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: String(error),
        payload: null
      };
    }
    let payload = null;
    try {
      payload = request.responseText ? JSON.parse(request.responseText) : null;
    } catch (error) {
      return {
        ok: false,
        status: request.status || 0,
        error: String(error),
        raw: request.responseText || "",
        payload: null
      };
    }
    return {
      ok: request.status >= 200 && request.status < 300,
      status: request.status || 0,
      payload
    };
  })()`;
}

async function readBrowserJsonPath(resourcePath, options = {}, label = resourcePath) {
  return waitForJson(
    buildSynchronousBrowserJsonRequestExpression(resourcePath, options),
    (value) =>
      Boolean(
        value &&
          typeof value === "object" &&
          Number.isFinite(Number(value.status)) &&
          Number(value.status) >= 0 &&
          Object.prototype.hasOwnProperty.call(value, "payload")
      ),
    label,
    {
      timeoutMs: 30000,
    }
  );
}

function buildOfflineChatDeepLinkUrl(fixture) {
  return `${baseUrl}/offline-chat?threadId=${encodeURIComponent(fixture.routeThreadId || fixture.threadId)}&sourceProvider=${encodeURIComponent(fixture.sourceProvider)}`;
}

async function detectBrowserAutomationMode() {
  const context = await ensureBrowserAutomationContext();
  return withBrowserDocument(`${baseUrl}/offline-chat`, async () => {
    if (context.mode === "webdriver") {
      await waitForReady("浏览器能力探测");
      return {
        mode: "dom",
        reason: "Safari WebDriver ready",
      };
    }

    try {
      await waitForReady("浏览器能力探测");
      return {
        mode: "dom",
        reason: context.fallbackReason
          ? `Safari JavaScript automation ready (WebDriver fallback: ${context.fallbackReason})`
          : "Safari JavaScript automation ready",
      };
    } catch (error) {
      if (!String(error.message || error).includes("Allow JavaScript from Apple Events")) {
        throw error;
      }
      await waitForTextSnapshot(
        (snapshot) => normalizeVisibleText(snapshot.text).includes("agent-passport 对话记录"),
        "浏览器文本能力探测"
      );
      return {
        mode: "text-fallback",
        reason: error.message,
      };
    }
  });
}

function findRecoveryBundlePath(recoveryList = null, bundleId = "") {
  const normalizedBundleId = text(bundleId);
  const bundles = Array.isArray(recoveryList?.bundles) ? recoveryList.bundles : [];
  const entry = bundles.find((item) => text(item?.bundleId) === normalizedBundleId) || null;
  return text(entry?.bundlePath);
}

function findSetupPackagePath(setupPackageList = null, packageId = "") {
  const normalizedPackageId = text(packageId);
  const packages = Array.isArray(setupPackageList?.packages) ? setupPackageList.packages : [];
  const entry = packages.find((item) => text(item?.packageId) === normalizedPackageId) || null;
  return text(entry?.packagePath);
}

async function runAgentPassportProductCreateAndRecoveryDom() {
  await seedBrowserAdminToken();
  const displayName = `浏览器创建同事 ${randomUUID().slice(0, 8)}`;
  const passphrase = `browser recovery ${randomUUID()}`;
  const marker = `browser-flow-${randomUUID()}`;

  const createSummary = await withBrowserDocument(`${baseUrl}/agent-create.html`, async () => {
    await waitForReady("Agent 创建页");
    await injectBrowserAdminTokenIntoCurrentDocument();
    await browserEval(`(() => {
      window.__agentPassportSmokeDownloads = [];
      if (!window.__agentPassportSmokeDownloadPatched) {
        const nativeClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function patchedSmokeAnchorClick() {
          if (this.download) {
            window.__agentPassportSmokeDownloads.push({
              download: this.download || "",
              href: this.href || ""
            });
            return undefined;
          }
          return nativeClick.call(this);
        };
        window.__agentPassportSmokeDownloadPatched = true;
      }
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        if (!input) {
          throw new Error(\`missing input: \${selector}\`);
        }
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      setValue('[name="displayName"]', ${JSON.stringify(displayName)});
      setValue('[name="role"]', 'local_ai_colleague');
      setValue('[name="controller"]', 'Kane');
      setValue('[name="title"]', '完成浏览器产品流验收');
      setValue('[name="longTermGoal"]', '验证创建、恢复资料、详情页和恢复导入向导可以由普通用户路径走通。');
      setValue('[name="stablePreferences"]', '中文说明\\\\n先给结论\\\\n关键操作要可恢复');
      setValue('[name="style"]', '直接、温和、会主动提醒恢复资料风险。${marker}');
      setValue('[name="recoveryPassphrase"]', ${JSON.stringify(passphrase)});
      setValue('[name="recoveryPassphraseConfirm"]', ${JSON.stringify(passphrase)});
      document.getElementById("submit-button")?.click();
      return true;
    })()`);

    const generated = await waitForJson(
      `(() => {
        const artifactText = document.getElementById("artifact-list")?.innerText || "";
        const notice = document.getElementById("notice")?.textContent || "";
        const recoveryBundleId = artifactText.match(/(?:recovery bundle|身份恢复文件（recovery bundle）)：\\s*(recovery_[a-z0-9]+)/iu)?.[1] || "";
        const setupPackageId = artifactText.match(/(?:setup package|新设备恢复包（setup package）)：\\s*(setup_[a-z0-9]+)/iu)?.[1] || "";
        return {
          artifactText,
          notice,
          recoveryBundleId,
          setupPackageId,
          stepBackupStatus: document.getElementById("step-backup")?.dataset.status || "",
          finishDisabled: document.getElementById("finish-button")?.disabled === true,
          downloads: window.__agentPassportSmokeDownloads || [],
          incompleteBackups: localStorage.getItem("agentPassport.incompleteRecoveryBackups.v1") || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.recoveryBundleId &&
            value.setupPackageId &&
            value.stepBackupStatus === "done" &&
            value.finishDisabled === true &&
            Array.isArray(value.downloads) &&
            value.downloads.length >= 2 &&
            value.downloads.some((entry) => text(entry.download).includes(value.recoveryBundleId)) &&
            value.downloads.some((entry) => text(entry.download).includes(value.setupPackageId)) &&
            !text(value.incompleteBackups).includes(passphrase)
        ),
      "Agent 创建页导出恢复资料",
      {
        timeoutMs: 60000,
        fatalPredicate: (value) => /创建失败|需要本地访问口令|恢复演练，不能完成创建/u.test(text(value?.notice)),
      }
    );

    await browserEval(`(() => {
      for (const id of [
        "confirm-recovery-bundle",
        "confirm-setup-package",
        "confirm-recovery-passphrase",
        "confirm-loss-understood"
      ]) {
        const checkbox = document.getElementById(id);
        if (!checkbox) {
          throw new Error(\`missing checkbox: \${id}\`);
        }
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return document.getElementById("finish-button")?.disabled === false;
    })()`);
    await browserEval(`(() => {
      document.getElementById("finish-button")?.click();
      return true;
    })()`);

    const detailSnapshot = await waitForTextSnapshot(
      (snapshot) =>
        snapshot.url.includes("/agent-detail.html") &&
        snapshot.url.includes("created=1") &&
        snapshot.text.includes("Agent 身份护照") &&
        snapshot.text.includes(displayName),
      "Agent 创建后进入详情页"
    );
    const detailUrl = new URL(detailSnapshot.url);
    const agentId = text(detailUrl.searchParams.get("agentId"));
    assert(agentId, "Agent 创建详情页 URL 缺少 agentId");

    const postConfirmState = await waitForJson(
      `(() => ({
        incompleteBackups: localStorage.getItem("agentPassport.incompleteRecoveryBackups.v1") || "",
        location: window.location.href
      }))()`,
      (value) =>
        Boolean(
          value &&
            !text(value.incompleteBackups).includes(agentId) &&
            !text(value.incompleteBackups).includes(passphrase)
        ),
      "Agent 创建备份确认后清理本地未完成标记"
    );

    return {
      agentId,
      displayName,
      recoveryBundleId: generated.recoveryBundleId,
      setupPackageId: generated.setupPackageId,
      downloadCount: generated.downloads.length,
      detailUrl: detailSnapshot.url,
      incompleteBackupStateLength: text(postConfirmState.incompleteBackups).length,
    };
  });

  const agent = await getJson(`/api/agents/${encodeURIComponent(createSummary.agentId)}`);
  assert(agent.agent?.displayName === displayName, "浏览器创建 Agent 后详情接口 displayName 不匹配");
  assert(agent.agent?.recoveryBackup?.status === "backup_completed", "浏览器创建 Agent 后恢复备份闭环未完成");

  const memories = await getJson(
    `/api/agents/${encodeURIComponent(createSummary.agentId)}/passport-memory?kind=style&query=${encodeURIComponent(marker)}&limit=10`
  );
  assert(Number(memories.counts?.total || 0) >= 1, "浏览器创建 Agent 后初始 style 记忆没有写入");

  const rehydrate = await getJson(`/api/agents/${encodeURIComponent(createSummary.agentId)}/runtime/rehydrate`);
  assert(rehydrate.rehydrate?.agentId === createSummary.agentId, "浏览器创建 Agent 后 rehydrate agentId 不匹配");

  const recoveryList = await getJson("/api/device/runtime/recovery?limit=20");
  const setupPackageList = await getJson("/api/device/setup/packages?limit=20");
  const bundlePath = findRecoveryBundlePath(recoveryList, createSummary.recoveryBundleId);
  const packagePath = findSetupPackagePath(setupPackageList, createSummary.setupPackageId);
  assert(bundlePath, `恢复包列表缺少 ${createSummary.recoveryBundleId} 的本地路径`);
  assert(packagePath, `setup package 列表缺少 ${createSummary.setupPackageId} 的本地路径`);

  const recoveryImportSummary = await withBrowserDocument(`${baseUrl}/recovery-import.html`, async () => {
    await waitForReady("恢复导入向导");
    await injectBrowserAdminTokenIntoCurrentDocument();
    await browserEval(`(() => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        if (!input) {
          throw new Error(\`missing input: \${selector}\`);
        }
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      setValue("#recovery-passphrase", ${JSON.stringify(passphrase)});
      setValue("#bundle-path", ${JSON.stringify(bundlePath)});
      setValue("#package-path", ${JSON.stringify(packagePath)});
      const storeKeyTarget = document.getElementById("store-key-target");
      if (storeKeyTarget) {
        storeKeyTarget.value = "file";
        storeKeyTarget.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const allowResidentRebind = document.getElementById("allow-resident-rebind");
      if (allowResidentRebind) {
        allowResidentRebind.checked = true;
        allowResidentRebind.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const importLocalReasonerProfiles = document.getElementById("import-local-reasoner-profiles");
      if (importLocalReasonerProfiles) {
        importLocalReasonerProfiles.checked = false;
        importLocalReasonerProfiles.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    })()`);

    await browserEval(`document.querySelector('[data-action="verify-recovery"]')?.click(); true;`);
    const verifyResult = await waitForJson(
      `(() => {
        const resultText = document.getElementById("result-list")?.innerText || "";
        const notice = document.getElementById("notice")?.textContent || "";
        let parsed = null;
        try {
          parsed = JSON.parse(document.querySelector("#result-list pre")?.textContent || "null");
        } catch {}
        return {
          resultText,
          notice,
          status: parsed?.status || parsed?.rehearsal?.status || "",
          bundleId: parsed?.summary?.bundleId || parsed?.rehearsal?.bundle?.bundleId || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.resultText.includes("恢复口令验证") &&
            ["passed", "partial"].includes(text(value.status)) &&
            value.bundleId === createSummary.recoveryBundleId
        ),
      "恢复导入向导验证恢复口令"
    );

    await browserEval(`document.querySelector('[data-action="dry-run-recovery"]')?.click(); true;`);
    const recoveryDryRun = await waitForJson(
      `(() => {
        const resultText = document.getElementById("result-list")?.innerText || "";
        let parsed = null;
        try {
          parsed = JSON.parse(document.querySelector("#result-list pre")?.textContent || "null");
        } catch {}
        return {
          resultText,
          dryRun: parsed?.dryRun === true,
          bundleId: parsed?.summary?.bundleId || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.resultText.includes("预演身份恢复文件") &&
            value.dryRun === true &&
            value.bundleId === createSummary.recoveryBundleId
        ),
      "恢复导入向导预演身份恢复文件"
    );

    await browserEval(`document.querySelector('[data-action="dry-run-setup"]')?.click(); true;`);
    const setupDryRun = await waitForJson(
      `(() => {
        const resultText = document.getElementById("result-list")?.innerText || "";
        let parsed = null;
        try {
          parsed = JSON.parse(document.querySelector("#result-list pre")?.textContent || "null");
        } catch {}
        return {
          resultText,
          dryRun: parsed?.dryRun === true,
          packageId: parsed?.summary?.packageId || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.resultText.includes("预演新设备恢复包") &&
            value.dryRun === true &&
            value.packageId === createSummary.setupPackageId
        ),
      "恢复导入向导预演新设备恢复包"
    );

    return {
      verifyStatus: verifyResult.status,
      recoveryDryRun: recoveryDryRun.dryRun,
      setupDryRun: setupDryRun.dryRun,
    };
  });

  return {
    ...createSummary,
    bundlePathAvailable: Boolean(bundlePath),
    packagePathAvailable: Boolean(packagePath),
    recoveryImportSummary,
  };
}

async function prepareOfflineChatBootstrapFixture() {
  const bootstrap = await getJson("/api/offline-chat/bootstrap");
  const bootstrapThreadIds = Array.isArray(bootstrap?.threads)
    ? bootstrap.threads.map((entry) => text(entry?.threadId)).filter(Boolean)
    : [];
  assert(
    new Set(bootstrapThreadIds).size === bootstrapThreadIds.length,
    `offline-chat bootstrap threads 存在重复 threadId：${bootstrapThreadIds.join(", ")}`
  );
  const directThread =
    bootstrap.threads?.find((entry) => entry?.threadKind === "direct" && entry?.threadId) || null;
  const groupThread = bootstrap.threads?.find((entry) => entry?.threadId === "group") || null;
  const threadStartup = bootstrap.threadStartup?.phase_1 || null;
  return {
    bootstrap,
    bootstrapThreadIds,
    directThread,
    groupThread,
    threadStartup,
  };
}

async function prepareOfflineChatDeepLinkFixture(bootstrapFixture = null) {
  const resolvedBootstrapFixture = bootstrapFixture || await prepareOfflineChatBootstrapFixture();
  const { bootstrapThreadIds } = resolvedBootstrapFixture;
  const directThread =
    resolvedBootstrapFixture.bootstrap?.threads?.find(
      (entry) =>
        entry?.threadKind === "direct" &&
        text(entry?.threadId) &&
        text(entry?.routeThreadId || entry?.threadId)
    ) ||
    resolvedBootstrapFixture.directThread ||
    null;
  assert(directThread?.threadId, "没有可用的 offline-chat 单聊线程，无法执行 deep-link 浏览器回归");
  const routeThreadId = text(directThread?.routeThreadId || directThread?.threadId);
  assert(routeThreadId, "offline-chat deep-link 缺少可用的 thread route id");

  const messageToken = `smoke-browser-deeplink-${Date.now()}`;
  const sendResult = await requestJson(`/api/offline-chat/threads/${encodeURIComponent(routeThreadId)}/messages`, {
    method: "POST",
    timeoutMs: 30000,
    body: JSON.stringify({
      content: `请用一句话确认这是离线 deep-link 浏览器回归。token=${messageToken}`,
    }),
  });
  const sourceProvider = sendResult?.source?.provider || sendResult?.message?.assistant?.source?.provider || null;
  const sourceLabel = sendResult?.source?.label || sendResult?.message?.assistant?.source?.label || null;
  assert(sourceProvider, "offline-chat 回归消息没有返回 source.provider，无法构造查看范围 deep-link");

  const filteredHistory = await getJson(
    `/api/offline-chat/threads/${encodeURIComponent(routeThreadId)}/messages?limit=40&sourceProvider=${encodeURIComponent(sourceProvider)}`
  );
  const filteredAssistantMessageIds = (Array.isArray(filteredHistory?.messages) ? filteredHistory.messages : [])
    .filter((entry) => entry?.role === "assistant")
    .map((entry) => text(entry?.messageId))
    .filter(Boolean);
  const resolvedLabel =
    filteredHistory?.sourceSummary?.providers?.find((entry) => entry?.provider === sourceProvider)?.label ||
    sourceLabel ||
    sourceProvider;
  assert(filteredHistory?.counts?.filteredAssistantMessages >= 1, "offline-chat 查看范围没有命中任何 assistant 消息");
  assert(filteredAssistantMessageIds.length >= 1, "offline-chat 查看范围没有返回可绑定的 assistant messageId");

  return {
    threadId: directThread.threadId,
    routeThreadId,
    threadLabel: directThread.label || directThread.displayName || directThread.threadId,
    bootstrapThreadIds,
    sourceProvider,
    sourceLabel: resolvedLabel,
    filteredAssistantMessageIds,
    filteredAssistantMessages: filteredHistory.counts.filteredAssistantMessages,
  };
}

function readStartupProtocolSignature(startupContext = null) {
  return {
    startupSignature: text(startupContext?.startupSignature) || null,
    protocolRecordId: text(startupContext?.threadProtocol?.protocolRecordId) || null,
    protocolKey: text(startupContext?.threadProtocol?.protocolKey || startupContext?.protocolKey) || null,
    protocolVersion: text(startupContext?.threadProtocol?.protocolVersion || startupContext?.protocolVersion) || null,
  };
}

async function verifyOfflineChatStartupTruthChain({ bootstrap, seedResult }) {
  const bootstrapStartup = bootstrap?.threadStartup?.phase_1 || null;
  const threadStartupContext = await getJson("/api/offline-chat/thread-startup-context?phase=phase_1");
  const groupHistory = await getJson("/api/offline-chat/threads/group/messages?limit=80");
  const bootstrapSignature = readStartupProtocolSignature(bootstrapStartup);
  const threadStartupSignature = readStartupProtocolSignature(threadStartupContext);
  const historyStartupSignature = readStartupProtocolSignature(groupHistory?.threadStartup);
  const historySignature = text(groupHistory?.startupSignature) || null;
  const seedSignature = text(seedResult?.startupSignature) || null;

  assert(threadStartupSignature.startupSignature, "offline-chat startup 真值缺少 thread-startup-context startupSignature");
  assert(bootstrapSignature.startupSignature, "offline-chat startup 真值缺少 bootstrap startupSignature");
  assert(historySignature, "offline-chat startup 真值缺少 history startupSignature");
  assert(historyStartupSignature.startupSignature, "offline-chat startup 真值缺少 history.threadStartup startupSignature");
  assert(seedSignature, "offline-chat startup 真值缺少发送响应 startupSignature");
  assert(
    bootstrapSignature.startupSignature === threadStartupSignature.startupSignature,
    "offline-chat bootstrap.threadStartup 与 thread-startup-context startupSignature 漂移"
  );
  assert(
    historySignature === threadStartupSignature.startupSignature,
    "offline-chat history.startupSignature 与 thread-startup-context startupSignature 漂移"
  );
  assert(
    historyStartupSignature.startupSignature === threadStartupSignature.startupSignature,
    "offline-chat history.threadStartup 与 thread-startup-context startupSignature 漂移"
  );
  assert(
    seedSignature === threadStartupSignature.startupSignature,
    "offline-chat 发送响应 startupSignature 与 thread-startup-context startupSignature 漂移"
  );
  const protocolRecordIds = [
    bootstrapSignature.protocolRecordId,
    threadStartupSignature.protocolRecordId,
    historyStartupSignature.protocolRecordId,
  ].filter(Boolean);
  assert(
    new Set(protocolRecordIds).size <= 1,
    "offline-chat startup threadProtocol.protocolRecordId 漂移"
  );
  assert(
    threadStartupSignature.protocolKey &&
      bootstrapSignature.protocolKey === threadStartupSignature.protocolKey &&
      historyStartupSignature.protocolKey === threadStartupSignature.protocolKey &&
      bootstrapSignature.protocolVersion === threadStartupSignature.protocolVersion &&
      historyStartupSignature.protocolVersion === threadStartupSignature.protocolVersion,
    "offline-chat startup 真值缺少同源 threadProtocol key/version"
  );

  return {
    bootstrapMatchesThreadStartup: bootstrapSignature.startupSignature === threadStartupSignature.startupSignature,
    historyMatchesThreadStartup:
      historySignature === threadStartupSignature.startupSignature &&
      historyStartupSignature.startupSignature === threadStartupSignature.startupSignature,
    seedMatchesThreadStartup: seedSignature === threadStartupSignature.startupSignature,
    protocolRecordIdConsistent: new Set(protocolRecordIds).size <= 1,
    protocolRecordId: threadStartupSignature.protocolRecordId,
    protocolKey: threadStartupSignature.protocolKey,
    protocolVersion: threadStartupSignature.protocolVersion,
    startupSignature: threadStartupSignature.startupSignature,
  };
}

async function prepareOfflineChatGroupFixture(bootstrapFixture = null) {
  const resolvedBootstrapFixture = bootstrapFixture || await prepareOfflineChatBootstrapFixture();
  const bootstrap = resolvedBootstrapFixture.bootstrap || null;
  const groupThread = resolvedBootstrapFixture.groupThread || null;
  const threadStartup = resolvedBootstrapFixture.threadStartup || null;
  assert(groupThread?.threadId === "group", "没有可用的 offline-chat 群聊线程，无法执行群聊浏览器回归");
  const participantNames = Array.isArray(groupThread?.participants)
    ? groupThread.participants.map((entry) => text(entry?.displayName)).filter(Boolean)
    : [];
  assert(participantNames.length === Number(groupThread?.memberCount || 0), "offline-chat 群聊成员真值不完整，无法执行浏览器回归");
  const protocolTitle = text(threadStartup?.threadProtocol?.title || threadStartup?.protocolVersion);
  const protocolSummary = text(threadStartup?.protocolSummary || threadStartup?.threadProtocol?.protocolSummary);
  const protocolActivatedAt = text(threadStartup?.protocolActivatedAt || threadStartup?.threadProtocol?.protocolActivatedAt);
  assert(protocolTitle, "offline-chat 群聊浏览器回归缺少 protocolTitle");
  assert(protocolSummary, "offline-chat 群聊浏览器回归缺少 protocolSummary");
  assert(protocolActivatedAt, "offline-chat 群聊浏览器回归缺少 protocolActivatedAt");
  const seedToken = `smoke-browser-group-${Date.now()}`;
  const seedResult = await requestJson("/api/offline-chat/threads/group/messages", {
    method: "POST",
    timeoutMs: 60000,
    body: JSON.stringify({
      content: `请让设计体验和后端平台两个 subagent 并行收口 UI 状态设计与 API 契约。 token=${seedToken}`,
      verificationMode: "synthetic",
    }),
  });
  const seedRecordId = seedResult?.sync?.recordId || null;
  assert(seedRecordId, "offline-chat 群聊浏览器回归种子消息没有返回 sync.recordId");
  assert(seedResult?.dispatch?.parallelAllowed === true, "offline-chat 群聊浏览器回归种子消息没有触发并行 fan-out");
  assert(
    Array.isArray(seedResult?.dispatch?.batchPlan) && seedResult.dispatch.batchPlan.some((entry) => entry?.executionMode === "parallel"),
    "offline-chat 群聊浏览器回归种子消息没有返回并行批次"
  );
  const currentBootstrap = await getJson("/api/offline-chat/bootstrap");
  const startupTruth = await verifyOfflineChatStartupTruthChain({ bootstrap: currentBootstrap, seedResult });
  return {
    threadId: "group",
    memberCount: Number(groupThread.memberCount || 0),
    participantNames,
    protocolTitle,
    protocolSummary,
    protocolActivatedAt,
    seedToken,
    seedRecordId,
    startupTruth,
  };
}

async function ensureRepairFixture() {
  const repairListPath =
    `/api/migration-repairs?agentId=${MAIN_AGENT_ID}&didMethod=agentpassport&limit=5&sortBy=repairedCount&sortOrder=desc`;
  const repairHasCoverageTruth = (repair) =>
    Boolean(
      repair?.repairId &&
        repair?.repair?.afterCoverage &&
        Number(repair.repair.afterCoverage.totalSubjects || 0) >= 1 &&
        repair.repair.afterCoverage.publicComplete === true &&
        Array.isArray(repair.repair?.allIssuedDidMethods) &&
        repair.repair.allIssuedDidMethods.includes("agentpassport") &&
        repair.repair.allIssuedDidMethods.includes("openneed")
    );
  const resolveRepairDetail = async (repairId) => {
    if (!repairId) {
      return null;
    }
    const payload = await getJson(`/api/migration-repairs/${encodeURIComponent(repairId)}?didMethod=agentpassport`);
    return payload?.repair || null;
  };
  const pickRepairWithCoverageTruth = async (repairs = []) => {
    for (const entry of Array.isArray(repairs) ? repairs : []) {
      const detail = await resolveRepairDetail(entry?.repairId);
      if (repairHasCoverageTruth(detail)) {
        return detail;
      }
    }
    return null;
  };

  let repairs = await getJson(repairListPath);
  let repair = await pickRepairWithCoverageTruth(repairs.repairs);
  if (!repair?.repairId) {
    const seededRepairPayload = await requestJson("/api/agents/compare/migration/repair", {
      method: "POST",
      body: JSON.stringify({
        leftAgentId: MAIN_AGENT_ID,
        rightAgentId: "agent_treasury",
        didMethods: ["agentpassport", "openneed"],
        issueBothMethods: true,
      }),
    });
    const seededRepair = seededRepairPayload?.repair || null;
    assert(seededRepair?.repairId, "migration repair 自举失败");
    repairs = await getJson(repairListPath);
    repair =
      (await resolveRepairDetail(seededRepair.repairId)) ||
      (await pickRepairWithCoverageTruth(repairs.repairs)) ||
      seededRepair;
  }
  assert(repair?.repairId, "没有可用 repair 记录，无法执行浏览器级回归");
  assert(repairHasCoverageTruth(repair), `repair ${repair.repairId} 没有完整 coverage 真值，无法执行浏览器级回归`);
  return repair;
}

async function runRuntimeHomeTruthCheck(expectedRuntimeHome) {
  return withBrowserDocument(
    `${baseUrl}/`,
    async () => {
      await waitForReady("公开运行态真值");
      const summary = await waitForJson(
        `({
          loadState: "loaded",
          locationSearch: window.location.search,
          downloadTitle: document.getElementById("download-title")?.textContent || "",
          primaryDownloadPresent: Boolean(document.querySelector("[data-primary-download-link]")),
          downloadPlatforms: Array.from(document.querySelectorAll("[data-download-platform]")).map((entry) => entry.getAttribute("data-download-platform") || ""),
          operatorFlowLinks: Array.from((document.querySelector("[data-public-home]") || document).querySelectorAll('a[href*="/operator?flow="]')).map((entry) => entry.getAttribute("href") || ""),
          internalRuntimeLinks: Array.from((document.querySelector("[data-public-home]") || document).querySelectorAll("#runtime-link-list a")).map((entry) => entry.getAttribute("href") || ""),
          homeSummary: document.getElementById("runtime-home-summary")?.textContent || "",
          healthSummary: document.getElementById("runtime-health-summary")?.textContent || "",
          healthDetail: document.getElementById("runtime-health-detail")?.textContent || "",
          recoverySummary: document.getElementById("runtime-recovery-summary")?.textContent || "",
          recoveryDetail: document.getElementById("runtime-recovery-detail")?.textContent || "",
          automationSummary: document.getElementById("runtime-automation-summary")?.textContent || "",
          automationDetail: document.getElementById("runtime-automation-detail")?.textContent || "",
          agentRuntimeSummary: document.getElementById("runtime-agent-summary")?.textContent || "",
          agentRuntimeDetail: document.getElementById("runtime-agent-detail")?.textContent || "",
          operatorEntrySummary: document.getElementById("runtime-operator-entry-summary")?.textContent || "",
          triggerTexts: Array.from(document.querySelectorAll("#runtime-trigger-list li")).map((entry) => entry.textContent || ""),
          runtimeLinks: Array.from(document.querySelectorAll("#runtime-link-list a")).map((entry) => entry.getAttribute("href") || ""),
          repairHubHref: Array.from(document.querySelectorAll("#runtime-link-list a"))
            .find((entry) => entry.getAttribute("href") === "/repair-hub")
            ?.getAttribute("href") || ""
        })`,
        (value) =>
          Boolean(
            value &&
              text(value.locationSearch) === "" &&
              isPublicDownloadTitle(value.downloadTitle) &&
              value.primaryDownloadPresent === true &&
              Array.isArray(value.downloadPlatforms) &&
              ["macos", "windows", "linux"].every((entry) => value.downloadPlatforms.includes(entry)) &&
              Array.isArray(value.operatorFlowLinks) &&
              value.operatorFlowLinks.length === 0 &&
              Array.isArray(value.internalRuntimeLinks) &&
              value.internalRuntimeLinks.length === 0
          ),
        "公网下载入口",
        {
          fatalPredicate: isRuntimeHomeFailureState,
        }
      );
      return {
        ...summary,
        runtimeTruthMissingFields: Array.isArray(expectedRuntimeHome.missingFields)
          ? expectedRuntimeHome.missingFields
          : [],
        runtimeTruthReady: expectedRuntimeHome.readyForSmoke === true,
      };
    }
  );
}

async function runLabSecurityBoundariesCheck(expectedLab) {
  return withBrowserDocument(`${baseUrl}/lab.html`, async () => {
    await waitForReady("运行现场安全与恢复边界");
    const summary = await waitForJson(
      `({
        summary: document.getElementById("runtime-security-boundaries-summary")?.textContent || "",
        localStoreSummary: document.getElementById("runtime-local-store-summary")?.textContent || "",
        localStoreDetails: Array.from(document.querySelectorAll("#runtime-local-store-details span")).map((entry) => entry.textContent || ""),
        formalRecoverySummary: document.getElementById("runtime-formal-recovery-summary")?.textContent || "",
        formalRecoveryDetails: Array.from(document.querySelectorAll("#runtime-formal-recovery-details span")).map((entry) => entry.textContent || ""),
        constrainedExecutionSummary: document.getElementById("runtime-constrained-execution-summary")?.textContent || "",
        constrainedExecutionDetails: Array.from(document.querySelectorAll("#runtime-constrained-execution-details span")).map((entry) => entry.textContent || ""),
        automaticRecoverySummary: document.getElementById("runtime-automatic-recovery-summary")?.textContent || "",
        automaticRecoveryDetails: Array.from(document.querySelectorAll("#runtime-automatic-recovery-details span")).map((entry) => entry.textContent || "")
      })`,
      (value) =>
        Boolean(
          value &&
            text(value.summary) === expectedLab.summary &&
            text(value.localStoreSummary) === expectedLab.localStoreSummary &&
            Array.isArray(value.localStoreDetails) &&
            value.localStoreDetails.length === expectedLab.localStoreDetails.length &&
            value.localStoreDetails.every((entry, index) => text(entry) === expectedLab.localStoreDetails[index]) &&
            text(value.formalRecoverySummary) === expectedLab.formalRecoverySummary &&
            Array.isArray(value.formalRecoveryDetails) &&
            value.formalRecoveryDetails.length === expectedLab.formalRecoveryDetails.length &&
            value.formalRecoveryDetails.every((entry, index) => text(entry) === expectedLab.formalRecoveryDetails[index]) &&
            text(value.constrainedExecutionSummary) === expectedLab.constrainedExecutionSummary &&
            Array.isArray(value.constrainedExecutionDetails) &&
            value.constrainedExecutionDetails.length === expectedLab.constrainedExecutionDetails.length &&
            value.constrainedExecutionDetails.every((entry, index) => text(entry) === expectedLab.constrainedExecutionDetails[index]) &&
            text(value.automaticRecoverySummary) === expectedLab.automaticRecoverySummary &&
            Array.isArray(value.automaticRecoveryDetails) &&
            value.automaticRecoveryDetails.length === expectedLab.automaticRecoveryDetails.length &&
            value.automaticRecoveryDetails.every((entry, index) => text(entry) === expectedLab.automaticRecoveryDetails[index])
        ),
      "运行现场安全与恢复边界",
      {
        timeoutMs: 30000,
      }
    );
    const apiSecurityTruth = await readBrowserJsonPath(
      "/api/security",
      { publicRead: true },
      "运行现场公开 /api/security 真值"
    );
    assert(apiSecurityTruth.ok === true, `运行现场公开 /api/security 读取失败：${JSON.stringify(apiSecurityTruth)}`);
    assert(apiSecurityTruth.payload?.authorized === false, "运行现场公开 /api/security 不应被浏览器误判为授权视图");
    assert(
      isFailureSemanticsEnvelope(apiSecurityTruth.payload?.releaseReadiness?.failureSemantics),
      "运行现场公开 /api/security.releaseReadiness.failureSemantics 缺失或不合法"
    );
    assert(
      isFailureSemanticsEnvelope(apiSecurityTruth.payload?.automaticRecovery?.failureSemantics),
      "运行现场公开 /api/security.automaticRecovery.failureSemantics 缺失或不合法"
    );
    return {
      ...summary,
      labTruthMissingFields: Array.isArray(expectedLab.missingFields)
        ? expectedLab.missingFields
        : [],
      labTruthReady: expectedLab.readyForSmoke === true,
      apiSecurityTruth: {
        status: apiSecurityTruth.status,
        authorized: apiSecurityTruth.payload?.authorized ?? null,
        releaseReadinessFailureSemantics: apiSecurityTruth.payload?.releaseReadiness?.failureSemantics ?? null,
        automaticRecoveryFailureSemantics: apiSecurityTruth.payload?.automaticRecovery?.failureSemantics ?? null,
      },
    };
  });
}

async function runLabInvalidTokenCheck() {
  return withBrowserDocument(`${baseUrl}/lab.html`, async () => {
    await waitForReady("运行现场维护坏令牌");
    await browserEval(`(() => {
      const form = document.getElementById("runtime-housekeeping-form");
      const tokenInput = document.getElementById("runtime-housekeeping-token");
      if (tokenInput) {
        tokenInput.value = "agent-passport-invalid-token";
        tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
        tokenInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (typeof form?.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        document.getElementById("runtime-housekeeping-audit")?.click();
      }
      return true;
    })()`);
    const summary = await waitForJson(
      `({
        authSummary: document.getElementById("runtime-housekeeping-auth-summary")?.textContent || "",
        status: document.getElementById("runtime-housekeeping-status")?.textContent || "",
        resultText: document.getElementById("runtime-housekeeping-result")?.textContent || "",
        lastReport: document.getElementById("runtime-housekeeping-last-report")?.textContent || ""
      })`,
      (value) =>
        Boolean(
          value &&
            text(value.authSummary).includes("本次浏览保存的访问口令无法执行清理旧资料") &&
            text(value.authSummary).includes("重新输入") &&
            text(value.status).includes("这次操作没有成功") &&
            text(value.status).includes("清理旧资料") &&
            text(value.resultText).includes("清理旧资料") &&
            text(value.lastReport).includes("本次浏览还没有成功维护记录")
        ),
      "运行现场维护坏令牌",
      {
        timeoutMs: 30000,
      }
    );
    return {
      ...summary,
      guard: {
        authBlocked: true,
        blockedSurface: "/api/security/runtime-housekeeping",
        actionBlocked: true,
        lastReportPreserved: true,
      },
    };
  });
}

async function runRepairHubDeepLink(
  repairId,
  credentialId,
  {
    didMethod = "agentpassport",
    expectedCredentialDidMethod = "agentpassport",
    expectedVisibleDidMethod = "agentpassport",
    startAgentId = MAIN_AGENT_ID,
    startIssuerAgentId = "",
    expectLegacyMainAgentSelfHeal = false,
  } = {}
) {
  const initialSearch = new URLSearchParams({
    agentId: startAgentId,
    repairId,
    credentialId,
    didMethod,
  });
  if (startIssuerAgentId) {
    initialSearch.set("issuerAgentId", startIssuerAgentId);
  }
  return withBrowserDocument(
    `${baseUrl}/repair-hub?${initialSearch.toString()}`,
    async () => {
      await waitForReady("受保护修复证据面深链");
      return waitForJson(
        `({
          locationSearch: window.location.search,
          mainLinkHref: document.getElementById("open-main-context")?.href || "",
          authSummary: document.getElementById("repair-hub-auth-summary")?.textContent || "",
          tokenInputPresent: Boolean(document.getElementById("repair-hub-admin-token-input")),
          selectedCredentialSummary: document.getElementById("selected-credential-summary")?.textContent || "",
          selectedCredentialJsonLength: (document.getElementById("selected-credential-json")?.textContent || "").length,
          selectedCredentialContainsId: (document.getElementById("selected-credential-json")?.textContent || "").includes(${JSON.stringify(credentialId)}),
          selectedCredentialParsed: (() => {
            try {
              const payload = JSON.parse(document.getElementById("selected-credential-json")?.textContent || "{}");
              const record = payload?.detail?.credentialRecord || {};
              return {
                ok: true,
                credentialRecordId: record.credentialRecordId || record.credentialId || payload?.detail?.credential?.id || "",
                issuerDidMethod: record.issuerDidMethod || "",
                repairId: record.repairedBy?.repairId || null
              };
            } catch {
              return { ok: false };
            }
          })(),
          statusCards: Array.from(document.querySelectorAll("#selected-credential-status [data-card-kind]")).map((card) => ({
            cardKind: card.dataset.cardKind || "",
            tone: card.dataset.tone || "",
            riskState: card.dataset.riskState || "",
            status: card.dataset.status || "",
            registryKnown: card.dataset.registryKnown || "",
            statusMatchesRegistry: card.dataset.statusMatchesRegistry || "",
            statusListId: card.dataset.statusListId || "",
            statusListIndex: card.dataset.statusListIndex || "",
            activeEntryId: card.dataset.activeEntryId || "",
            missingDidMethodCount: card.dataset.missingDidMethodCount || ""
          })),
          repairSummaryCards: Array.from(document.querySelectorAll("#repair-overview [data-summary-kind]")).map((card) => ({
            summaryKind: card.dataset.summaryKind || "",
            tone: card.classList.contains("ready") ? "ready" : card.classList.contains("warn") ? "warn" : "",
            repairVerdictState: card.dataset.repairVerdictState || "",
            repairImpactState: card.dataset.repairImpactState || "",
            repairNextStepState: card.dataset.repairNextStepState || "",
            totalSubjects: Number(card.dataset.totalSubjects || 0),
            currentViewCredentialCount: Number(card.dataset.currentViewCredentialCount || 0),
            main: card.querySelector(".summary-main")?.textContent || "",
            note: card.querySelector(".summary-note")?.textContent || ""
          })),
          repairTruthCard: (() => {
            const card = document.querySelector("#repair-overview [data-repair-truth-card]");
            const split = (value) => String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
            const parseBoolean = (value) => value === "true" ? true : value === "false" ? false : null;
            if (!card) {
              return null;
            }
            return {
              visibleIssuedDidMethods: split(card.dataset.visibleIssuedDidMethods),
              allIssuedDidMethods: split(card.dataset.allIssuedDidMethods),
              publicIssuedDidMethods: split(card.dataset.publicIssuedDidMethods),
              compatibilityIssuedDidMethods: split(card.dataset.compatibilityIssuedDidMethods),
              visibleReceiptCount: Number(card.dataset.visibleReceiptCount || 0),
              allReceiptCount: Number(card.dataset.allReceiptCount || 0),
              publicIssuerDid: card.dataset.publicIssuerDid || "",
              compatibilityIssuerDid: card.dataset.compatibilityIssuerDid || "",
              coverageSource: card.dataset.coverageSource || "",
              totalSubjects: Number(card.dataset.totalSubjects || 0),
              completeSubjectCount: Number(card.dataset.completeSubjectCount || 0),
              publicComplete: parseBoolean(card.dataset.publicComplete),
              repairComplete: parseBoolean(card.dataset.repairComplete),
              repairCompleteSubjectCount: Number(card.dataset.repairCompleteSubjectCount || 0),
              repairPartialSubjectCount: Number(card.dataset.repairPartialSubjectCount || 0),
              repairableSubjectCount: Number(card.dataset.repairableSubjectCount || 0),
              publicMissingDidMethods: split(card.dataset.publicMissingDidMethods),
              repairMissingDidMethods: split(card.dataset.repairMissingDidMethods)
            };
          })(),
          selectedAgentId: new URL(window.location.href).searchParams.get("agentId") || "",
          selectedIssuerAgentId: new URL(window.location.href).searchParams.get("issuerAgentId") || "",
          selectedDidMethodFilter: new URL(window.location.href).searchParams.get("didMethod") || "",
          selectedRepairId: new URL(window.location.href).searchParams.get("repairId") || ""
        })`,
        (value) =>
          Boolean(
            value &&
              (!expectLegacyMainAgentSelfHeal ||
                (!value.locationSearch?.includes(LEGACY_MAIN_AGENT_ID) &&
                  (!value.selectedAgentId || value.selectedAgentId === MAIN_AGENT_ID) &&
                  (!value.selectedIssuerAgentId || value.selectedIssuerAgentId === MAIN_AGENT_ID))) &&
              value.tokenInputPresent === true &&
              value.authSummary?.includes("已保存访问口令") &&
              value.mainLinkHref === `${baseUrl}/` &&
              value.selectedCredentialSummary &&
              value.selectedCredentialSummary !== "尚未选中 credential" &&
              value.selectedCredentialJsonLength > 0 &&
              value.selectedCredentialContainsId === true &&
              value.selectedCredentialParsed?.ok === true &&
              value.selectedDidMethodFilter === didMethod &&
              value.selectedCredentialParsed?.credentialRecordId === credentialId &&
              value.selectedCredentialParsed?.issuerDidMethod === expectedCredentialDidMethod &&
              value.selectedCredentialParsed?.repairId === repairId &&
              Array.isArray(value.statusCards) &&
              value.statusCards.length === 3 &&
              ["risk", "evidence", "action"].every((kind) =>
                value.statusCards.some((card) => card.cardKind === kind)
              ) &&
              Array.isArray(value.repairSummaryCards) &&
              value.repairSummaryCards.length === 3 &&
              value.repairSummaryCards.some((card) => card.summaryKind === "repair-verdict" && card.repairVerdictState) &&
              value.repairSummaryCards.some((card) => card.summaryKind === "repair-impact" && card.repairImpactState === "coverage_truth") &&
              value.repairSummaryCards.some((card) => card.summaryKind === "repair-next-step" && card.repairNextStepState) &&
              Array.isArray(value.repairTruthCard?.visibleIssuedDidMethods) &&
              value.repairTruthCard.visibleIssuedDidMethods.length === 1 &&
              value.repairTruthCard.visibleIssuedDidMethods[0] === expectedVisibleDidMethod &&
              Array.isArray(value.repairTruthCard?.allIssuedDidMethods) &&
              value.repairTruthCard.allIssuedDidMethods.includes("agentpassport") &&
              value.repairTruthCard.allIssuedDidMethods.includes("openneed") &&
              Array.isArray(value.repairTruthCard?.publicIssuedDidMethods) &&
              value.repairTruthCard.publicIssuedDidMethods.includes("agentpassport") &&
              Array.isArray(value.repairTruthCard?.compatibilityIssuedDidMethods) &&
              value.repairTruthCard.compatibilityIssuedDidMethods.includes("openneed") &&
              Number(value.repairTruthCard?.visibleReceiptCount || 0) === 1 &&
              Number(value.repairTruthCard?.allReceiptCount || 0) === 2 &&
              value.repairTruthCard?.coverageSource === "after" &&
              Number(value.repairTruthCard?.totalSubjects || 0) >= 1 &&
              value.repairTruthCard?.publicComplete === true &&
              Number.isFinite(Number(value.repairTruthCard?.repairCompleteSubjectCount || 0)) &&
              Number.isFinite(Number(value.repairTruthCard?.repairPartialSubjectCount || 0)) &&
              Number.isFinite(Number(value.repairTruthCard?.repairableSubjectCount || 0)) &&
              Array.isArray(value.repairTruthCard?.repairMissingDidMethods) &&
              (value.repairTruthCard?.repairComplete === true
                ? Number(value.repairTruthCard?.repairCompleteSubjectCount || 0) >= 1 &&
                  Number(value.repairTruthCard?.repairPartialSubjectCount || 0) === 0 &&
                  Number(value.repairTruthCard?.repairableSubjectCount || 0) === 0 &&
                  value.repairTruthCard.repairMissingDidMethods.length === 0
                : value.repairTruthCard?.repairComplete === false &&
                  Number(value.repairTruthCard?.repairPartialSubjectCount || 0) >= 1 &&
                  Number(value.repairTruthCard?.repairableSubjectCount || 0) >= 1 &&
                  value.repairTruthCard.repairMissingDidMethods.includes("openneed")) &&
              value.statusCards.every((card) =>
                card.statusListId &&
                card.statusListIndex &&
                card.activeEntryId &&
                card.riskState &&
                card.tone
              ) &&
              value.selectedRepairId === repairId
          ),
        "受保护修复证据面深链",
        {
          timeoutMs: 30000,
        }
      );
    }
  );
}

async function runOperatorTruthCheck(expectedOperator) {
  assert(
    expectedOperator.readyForDecision === true,
    `值班决策面真值缺失，不能用页面 fallback 文案通过 smoke：${(expectedOperator.missingFields || []).join(", ")}`
  );
  const expectedDecisionCards = buildOperatorDecisionCards({ snapshot: expectedOperator });
  const normalizeOperatorAlerts = (alerts = []) =>
    (Array.isArray(alerts) ? alerts : []).map((entry) => ({
      title: toBrowserOperatorText(entry?.title),
      detail: toBrowserOperatorText(entry?.detail),
      notes: Array.isArray(entry?.notes) ? entry.notes.map((note) => toBrowserOperatorText(note)).filter(Boolean) : [],
    }));
  return withBrowserDocument(`${baseUrl}/operator`, async () => {
    await waitForReady("值班决策面真值");
    await injectBrowserAdminTokenIntoCurrentDocument();
    await browserEval(`(() => {
      document.getElementById("operator-refresh")?.click();
      return true;
    })()`);
    const truthState = await waitForJson(
      `({
        authSummary: document.getElementById("operator-auth-summary")?.textContent || "",
        protectedStatus: document.getElementById("operator-protected-status")?.textContent || "",
        exportSummary: document.getElementById("operator-export-summary")?.textContent || "",
        exportStatus: document.getElementById("operator-export-status")?.textContent || "",
        exportDisabled: document.getElementById("operator-export-incident-packet")?.disabled ?? true,
        sequenceSummary: document.getElementById("operator-sequence-summary")?.textContent || "",
        standardActionsSummary: document.getElementById("operator-standard-actions-summary")?.textContent || "",
        handoffSummary: document.getElementById("operator-handoff-summary")?.textContent || "",
        decisionSummary: document.getElementById("operator-decision-summary")?.textContent || "",
        nextAction: document.getElementById("operator-next-action")?.textContent || "",
        postureTitle: document.getElementById("operator-posture-title")?.textContent || "",
        recoveryTitle: document.getElementById("operator-recovery-title")?.textContent || "",
        execTitle: document.getElementById("operator-exec-title")?.textContent || "",
        agentRuntimeTitle: document.getElementById("operator-agent-runtime-title")?.textContent || "",
        agentRuntimeDetails: Array.from(document.querySelectorAll("#operator-agent-runtime-details > div")).map((node) => node.textContent || ""),
        crossDeviceTitle: document.getElementById("operator-cross-device-title")?.textContent || "",
        crossDeviceGate: document.getElementById("operator-cross-device-gate")?.textContent || "",
        decisionCardCount: document.querySelectorAll("#operator-decision-cards .summary-card").length,
        decisionCardTitles: Array.from(document.querySelectorAll("#operator-decision-cards .summary-card strong")).map((node) => node.textContent || ""),
        rolesCount: document.querySelectorAll("#operator-handbook-roles .role-card").length,
        decisionSequenceCount: document.querySelectorAll("#operator-decision-sequence .step-item").length,
        standardActionsCount: document.querySelectorAll("#operator-standard-actions .alert-item").length,
        handoffFieldCount: document.querySelectorAll("#operator-handoff-fields .alert-item").length,
        handoffFieldTitles: Array.from(document.querySelectorAll("#operator-handoff-fields .alert-item strong")).map((node) => node.textContent || ""),
        handoffFieldDetails: Array.from(document.querySelectorAll("#operator-handoff-fields .alert-item .meta")).map((node) => node.textContent || ""),
        alertsCount: document.querySelectorAll("#operator-hard-alerts .alert-item").length,
        alerts: Array.from(document.querySelectorAll("#operator-hard-alerts .alert-item")).map((card) => ({
          title: card.querySelector("strong")?.textContent || "",
          detail: card.querySelector(".meta")?.textContent || "",
          notes: Array.from(card.querySelectorAll(".detail-list div")).map((entry) => entry.textContent || ""),
        })),
        stepsCount: document.querySelectorAll("#operator-cross-device-steps .step-item").length,
        mainLinkHref: Array.from(document.querySelectorAll(".hero-actions a")).find((node) => (node.getAttribute("href") || "") === "/")?.href || ""
      })`,
      (value) =>
        Boolean(
            value &&
            text(value.authSummary) === toBrowserOperatorText(expectedOperator.authSummary) &&
            text(value.protectedStatus) === toBrowserOperatorText(expectedOperator.protectedStatus) &&
            text(value.exportSummary) === toBrowserOperatorText(expectedOperator.exportSummary) &&
            text(value.exportStatus) === toBrowserOperatorText(expectedOperator.exportStatus) &&
            value.exportDisabled === false &&
            text(value.sequenceSummary) === toBrowserOperatorText(expectedOperator.sequenceSummary) &&
            text(value.standardActionsSummary) === toBrowserOperatorText(expectedOperator.standardActionsSummary) &&
            text(value.handoffSummary) === toBrowserOperatorText(expectedOperator.handoffSummary) &&
            text(value.decisionSummary) === toBrowserOperatorText(expectedOperator.decisionSummary) &&
            text(value.nextAction) === toBrowserOperatorText(expectedOperator.nextAction) &&
            text(value.postureTitle) === toBrowserOperatorText(expectedOperator.postureTitle) &&
            text(value.recoveryTitle) === toBrowserOperatorText(expectedOperator.recoveryTitle) &&
            text(value.execTitle) === toBrowserOperatorText(expectedOperator.execTitle) &&
            text(value.agentRuntimeTitle) === toBrowserOperatorText(expectedOperator.agentRuntimeTitle) &&
            JSON.stringify(
              Array.isArray(value.agentRuntimeDetails)
                ? value.agentRuntimeDetails.map((entry) => text(entry))
                : []
            ) === JSON.stringify(expectedOperator.agentRuntimeDetails.map((entry) => toBrowserOperatorText(entry))) &&
            text(value.crossDeviceTitle) === toBrowserOperatorText(expectedOperator.crossDeviceTitle) &&
            text(value.crossDeviceGate) === toBrowserOperatorText(expectedOperator.crossDeviceGate) &&
            Number(value.decisionCardCount) === Number(expectedDecisionCards.length) &&
            JSON.stringify(
              Array.isArray(value.decisionCardTitles)
                ? value.decisionCardTitles.map((entry) => text(entry))
                : []
            ) === JSON.stringify(expectedDecisionCards.map((entry) => toBrowserOperatorText(entry?.title))) &&
            Number(value.rolesCount) === Number(expectedOperator.rolesCount) &&
            Number(value.decisionSequenceCount) === Number(expectedOperator.decisionSequenceCount) &&
            Number(value.standardActionsCount) === Number(expectedOperator.standardActionsCount) &&
            Number(value.handoffFieldCount) === Number(expectedOperator.handoffFieldCount) &&
            JSON.stringify(
              Array.isArray(value.handoffFieldTitles)
                ? value.handoffFieldTitles.map((entry) => text(entry))
                : []
            ) === JSON.stringify(expectedOperator.handoffFieldTitles.map((entry) => toBrowserOperatorText(entry))) &&
            JSON.stringify(
              Array.isArray(value.handoffFieldDetails)
                ? value.handoffFieldDetails.map((entry) => text(entry))
                : []
            ) === JSON.stringify(expectedOperator.handoffFieldDetails.map((entry) => toBrowserOperatorText(entry))) &&
            Number(value.alertsCount) === Number(expectedOperator.alertsCount) &&
            JSON.stringify(normalizeOperatorAlerts(value.alerts)) ===
              JSON.stringify(normalizeOperatorAlerts(expectedOperator.alerts)) &&
            Number(value.stepsCount) === Number(expectedOperator.stepsCount) &&
            value.mainLinkHref === `${baseUrl}/`
        ),
      "值班决策面真值",
      {
        timeoutMs: 30000,
      }
    );
    await browserEval(`(() => {
      document.getElementById("operator-export-incident-packet")?.click();
      return true;
    })()`);
    const exportState = await waitForJson(
      `({
        exportStatus: document.getElementById("operator-export-status")?.textContent || "",
        exportContents: Array.from(document.querySelectorAll("#operator-export-contents > div")).map((node) => node.textContent || ""),
        exportHistoryCount: document.querySelectorAll("#operator-export-history .alert-item").length,
        exportHistoryEntries: Array.from(document.querySelectorAll("#operator-export-history .alert-item")).map((node) => ({
          evidenceRefId: node.dataset.evidenceRefId || "",
          physicalResidentAgentId: node.dataset.physicalResidentAgentId || "",
          residentAgentReference: node.dataset.residentAgentReference || "",
          resolvedResidentAgentId: node.dataset.resolvedResidentAgentId || "",
          effectivePhysicalResidentAgentId: node.dataset.effectivePhysicalResidentAgentId || "",
          effectiveResidentAgentReference: node.dataset.effectiveResidentAgentReference || "",
          effectiveResolvedResidentAgentId: node.dataset.effectiveResolvedResidentAgentId || "",
          residentBindingMismatch: node.dataset.residentBindingMismatch === "true",
          recordedAt: node.dataset.recordedAt || "",
          uri: node.dataset.uri || ""
        })),
        exportHistoryRecordIds: Array.from(document.querySelectorAll("#operator-export-history .alert-item")).map((node) => node.dataset.evidenceRefId || "").filter(Boolean),
        exportHistoryUris: Array.from(document.querySelectorAll("#operator-export-history .alert-item")).map((node) => node.dataset.uri || "").filter(Boolean),
        exportHistoryResidentAgentReferences: Array.from(document.querySelectorAll("#operator-export-history .alert-item")).map((node) => node.dataset.residentAgentReference || "").filter(Boolean),
        exportHistoryResolvedResidentAgentIds: Array.from(document.querySelectorAll("#operator-export-history .alert-item")).map((node) => node.dataset.resolvedResidentAgentId || "").filter(Boolean),
        exportHistoryEffectivePhysicalResidentAgentIds: Array.from(document.querySelectorAll("#operator-export-history .alert-item")).map((node) => node.dataset.effectivePhysicalResidentAgentId || "").filter(Boolean),
        exportHistoryEffectiveResolvedResidentAgentIds: Array.from(document.querySelectorAll("#operator-export-history .alert-item")).map((node) => node.dataset.effectiveResolvedResidentAgentId || "").filter(Boolean),
        exportHistoryResidentBindingMismatches: Array.from(document.querySelectorAll("#operator-export-history .alert-item")).map((node) => node.dataset.residentBindingMismatch === "true")
      })`,
      (value) =>
        Boolean(
          value &&
            text(value.exportStatus).startsWith("事故交接包已导出并留档：agent-passport-incident-packet-") &&
            Array.isArray(value.exportContents) &&
            value.exportContents.some((entry) => isBrowserOperatorAgentRuntimeExportContent(entry)) &&
            Number(value.exportHistoryCount) >= 1 &&
            Array.isArray(value.exportHistoryRecordIds) &&
            value.exportHistoryRecordIds.length >= 1
        ),
      "值班事故交接包导出",
      {
        timeoutMs: 30000,
      }
    );
    const exportHistoryState = await readBrowserJsonPath(
      "/api/security/incident-packet/history",
      { protectedRead: true },
      "值班事故交接包导出历史"
    );
    assert(
      exportHistoryState.ok === true,
      `值班事故交接包导出历史读取失败：${JSON.stringify(exportHistoryState)}`
    );
    const exportHistory = Array.isArray(exportHistoryState.payload?.history)
      ? exportHistoryState.payload.history
      : [];
    const exportRecord = exportHistory.find(
      (entry) =>
        text(entry?.evidenceRefId) &&
        text(exportState.exportStatus).includes(text(entry.evidenceRefId)) &&
        text(entry?.title) === "事故交接包导出" &&
        text(entry?.uri).startsWith("incident-packet://export/") &&
        Array.isArray(entry?.tags) &&
        entry.tags.includes("incident-packet-export")
    );
    assert(exportRecord, "值班事故交接包导出历史缺少结构化 exportRecord");
    assert(
      text(exportState.exportStatus).includes(text(exportRecord.evidenceRefId)),
      "值班事故交接包导出状态没有绑定最新 evidenceRefId"
    );
    assert(
      Array.isArray(exportState.exportHistoryRecordIds) &&
        exportState.exportHistoryRecordIds.includes(text(exportRecord.evidenceRefId)),
      "值班事故交接包 UI 历史没有结构化绑定最新 evidenceRefId"
    );
    assert(
      Array.isArray(exportState.exportHistoryUris) &&
        exportState.exportHistoryUris.includes(text(exportRecord.uri)),
      "值班事故交接包 UI 历史没有结构化绑定最新 uri"
    );
    assert(text(exportRecord.recordedAt), "值班事故交接包 exportRecord.recordedAt 缺失");
    const matchedUiExportRecord =
      (Array.isArray(exportState.exportHistoryEntries) ? exportState.exportHistoryEntries : []).find(
        (entry) => text(entry?.evidenceRefId) === text(exportRecord.evidenceRefId)
      ) || null;
    assert(
      matchedUiExportRecord,
      "值班事故交接包 UI 历史没有结构化绑定本次 exportRecord"
    );
    assert(
      text(matchedUiExportRecord?.uri) === text(exportRecord.uri),
      "值班事故交接包 UI 历史 uri 必须绑定本次 exportRecord"
    );
    assert(
      text(matchedUiExportRecord?.residentAgentReference) === text(exportRecord.residentAgentReference),
      "值班事故交接包 UI 历史 residentAgentReference 必须绑定本次 exportRecord"
    );
    assert(
      text(matchedUiExportRecord?.resolvedResidentAgentId) === text(exportRecord.resolvedResidentAgentId),
      "值班事故交接包 UI 历史 resolvedResidentAgentId 必须绑定本次 exportRecord"
    );
    assert(
      text(matchedUiExportRecord?.effectivePhysicalResidentAgentId),
      "值班事故交接包 UI 历史必须显式暴露 effectivePhysicalResidentAgentId"
    );
    assert(
      text(matchedUiExportRecord?.effectiveResolvedResidentAgentId),
      "值班事故交接包 UI 历史必须显式暴露 effectiveResolvedResidentAgentId"
    );
    assert(
      matchedUiExportRecord?.residentBindingMismatch !== true,
      "值班事故交接包 UI 历史不应把 resident binding mismatch 伪装成健康记录"
    );
    const apiExportState = await readBrowserJsonPath(
      "/api/security/incident-packet/export",
      {
        method: "POST",
        protectedRead: true,
        body: {
          note: "browser smoke structured incident export contract",
        },
      },
      "值班事故交接包结构化导出契约"
    );
    assert(
      apiExportState.ok === true,
      `值班事故交接包结构化导出失败：${JSON.stringify(apiExportState)}`
    );
    const apiExportPacket = apiExportState.payload || {};
    assert(
      text(apiExportPacket.sourceSurface) === "/api/security/incident-packet/export",
      "值班事故交接包 export sourceSurface 不正确"
    );
    assert(text(apiExportPacket.residentAgentId), "值班事故交接包 export residentAgentId 缺失");
    assert(text(apiExportPacket.residentAgentReference), "值班事故交接包 export residentAgentReference 缺失");
    assert(text(apiExportPacket.exportedAt), "值班事故交接包 export exportedAt 缺失");
    assert(apiExportPacket.exportCoverage?.protectedRead === true, "值班事故交接包 exportCoverage.protectedRead 必须为 true");
    assert(
      apiExportPacket.exportCoverage?.residentAgentBound === true,
      "值班事故交接包 exportCoverage.residentAgentBound 必须为 true"
    );
    assert(
      Array.isArray(apiExportPacket.exportCoverage?.missingSections) &&
        apiExportPacket.exportCoverage.missingSections.length === 0,
      "值班事故交接包 exportCoverage.missingSections 必须为空"
    );
    assert(
      Array.isArray(apiExportPacket.exportCoverage?.includedSections) &&
        apiExportPacket.exportCoverage.includedSections.includes("agent_runtime_truth"),
      "值班事故交接包 exportCoverage.includedSections 必须包含 agent_runtime_truth"
    );
    assert(
      text(apiExportPacket.exportRecord?.evidenceRefId),
      "值班事故交接包 exportRecord.evidenceRefId 缺失"
    );
    assert(
      text(apiExportPacket.exportRecord?.residentAgentReference) === text(apiExportPacket.residentAgentReference),
      "值班事故交接包 exportRecord.residentAgentReference 必须绑定 residentAgentReference"
    );
    assert(
      text(apiExportPacket.exportRecord?.resolvedResidentAgentId) === text(apiExportPacket.resolvedResidentAgentId),
      "值班事故交接包 exportRecord.resolvedResidentAgentId 必须绑定 resolvedResidentAgentId"
    );
    assert(
      text(apiExportPacket.exportRecord?.agentId) === text(apiExportPacket.residentAgentId),
      "值班事故交接包 exportRecord.agentId 必须绑定 residentAgentId"
    );
    assert(text(apiExportPacket.exportRecord?.kind) === "note", "值班事故交接包 exportRecord.kind 必须为 note");
    assert(
      text(apiExportPacket.exportRecord?.title) === "事故交接包导出",
      "值班事故交接包 exportRecord.title 不正确"
    );
    assert(
      text(apiExportPacket.exportRecord?.uri).startsWith("incident-packet://export/"),
      "值班事故交接包 exportRecord.uri 不正确"
    );
    assert(
      ["incident-packet-export", "operator", "security"].every((tag) =>
        (Array.isArray(apiExportPacket.exportRecord?.tags) ? apiExportPacket.exportRecord.tags : []).includes(tag)
      ),
      "值班事故交接包 exportRecord.tags 缺少必要标签"
    );
    const postApiExportHistoryState = await readBrowserJsonPath(
      "/api/security/incident-packet/history",
      { protectedRead: true },
      "值班事故交接包结构化导出历史"
    );
    const postApiExportHistory = Array.isArray(postApiExportHistoryState.payload?.history)
      ? postApiExportHistoryState.payload.history
      : [];
    assert(
      postApiExportHistoryState.ok === true,
      `值班事故交接包结构化导出历史读取失败：${JSON.stringify(postApiExportHistoryState)}`
    );
    assert(
      text(postApiExportHistoryState.payload?.residentAgentId) === text(apiExportPacket.residentAgentId),
      "值班事故交接包历史 residentAgentId 必须与导出包一致"
    );
    assert(
      text(postApiExportHistoryState.payload?.residentAgentReference) === text(apiExportPacket.residentAgentReference),
      "值班事故交接包历史 residentAgentReference 必须与导出包一致"
    );
    assert(
      text(postApiExportHistoryState.payload?.resolvedResidentAgentId) === text(apiExportPacket.resolvedResidentAgentId),
      "值班事故交接包历史 resolvedResidentAgentId 必须与导出包一致"
    );
    assert(
      postApiExportHistory.some(
        (entry) => text(entry?.evidenceRefId) === text(apiExportPacket.exportRecord?.evidenceRefId)
      ),
      "值班事故交接包历史缺少本次结构化导出记录"
    );
    const matchedPostApiExportRecord =
      postApiExportHistory.find(
        (entry) => text(entry?.evidenceRefId) === text(apiExportPacket.exportRecord?.evidenceRefId)
      ) || null;
    assert(
      text(matchedPostApiExportRecord?.residentAgentReference) === text(apiExportPacket.residentAgentReference),
      "值班事故交接包历史记录 residentAgentReference 必须与导出包一致"
    );
    assert(
      text(matchedPostApiExportRecord?.resolvedResidentAgentId) === text(apiExportPacket.resolvedResidentAgentId),
      "值班事故交接包历史记录 resolvedResidentAgentId 必须与导出包一致"
    );
    const incidentPacketState = await readBrowserJsonPath(
      "/api/security/incident-packet",
      { protectedRead: true },
      "值班事故交接包真值"
    );
    assert(
      incidentPacketState.ok === true,
      `值班事故交接包真值读取失败：${JSON.stringify(incidentPacketState)}`
    );
    assert(
      text(incidentPacketState.payload?.format) === "agent-passport-incident-packet-v1",
      "值班事故交接包真值 format 不正确"
    );
    assert(
      isFailureSemanticsEnvelope(incidentPacketState.payload?.snapshots?.security?.releaseReadiness?.failureSemantics),
      "值班事故交接包 snapshots.security.releaseReadiness.failureSemantics 缺失或不合法"
    );
    assert(
      isFailureSemanticsEnvelope(incidentPacketState.payload?.boundaries?.releaseReadiness?.failureSemantics),
      "值班事故交接包 boundaries.releaseReadiness.failureSemantics 缺失或不合法"
    );
    assert(
      isFailureSemanticsEnvelope(incidentPacketState.payload?.boundaries?.automaticRecovery?.failureSemantics),
      "值班事故交接包 boundaries.automaticRecovery.failureSemantics 缺失或不合法"
    );
    const incidentPacketAgentRuntime = incidentPacketState.payload?.boundaries?.agentRuntime || null;
    const snapshotAgentRuntime = incidentPacketState.payload?.snapshots?.security?.agentRuntimeTruth || null;
    assert(
      incidentPacketAgentRuntime && typeof incidentPacketAgentRuntime === "object",
      "值班事故交接包 boundaries.agentRuntime 缺失"
    );
    assert(
      JSON.stringify(incidentPacketAgentRuntime) === JSON.stringify(snapshotAgentRuntime),
      "值班事故交接包 boundaries.agentRuntime 必须与 snapshots.security.agentRuntimeTruth 同源一致"
    );
    assert(
      typeof incidentPacketAgentRuntime.localFirst === "boolean",
      "值班事故交接包 boundaries.agentRuntime.localFirst 必须为 boolean"
    );
    assert(
      Number.isFinite(Number(incidentPacketAgentRuntime.qualityEscalationRuns)),
      "值班事故交接包 boundaries.agentRuntime.qualityEscalationRuns 必须可读"
    );
    assert(
      Number(incidentPacketAgentRuntime.qualityEscalationRuns || 0) === 0 ||
        text(incidentPacketAgentRuntime.latestQualityEscalationReason),
      "值班事故交接包 boundaries.agentRuntime 有质量升级记录时必须带 latestQualityEscalationReason"
    );
    assert(
      incidentPacketAgentRuntime.latestQualityEscalationActivated !== true ||
        text(incidentPacketAgentRuntime.latestQualityEscalationProvider),
      "值班事故交接包 boundaries.agentRuntime 触发质量升级时必须带 latestQualityEscalationProvider"
    );
    assert(
      Number.isFinite(Number(incidentPacketAgentRuntime.memoryStabilityStateCount)),
      "值班事故交接包 boundaries.agentRuntime.memoryStabilityStateCount 必须可读"
    );
    assert(
      incidentPacketAgentRuntime.latestRunnerGuardActivated !== true ||
        (text(incidentPacketAgentRuntime.latestRunStatus) &&
          text(incidentPacketAgentRuntime.latestRunnerGuardBlockedBy) &&
          text(incidentPacketAgentRuntime.latestRunnerGuardCode) &&
          text(incidentPacketAgentRuntime.latestRunnerGuardStage) &&
          text(incidentPacketAgentRuntime.latestRunnerGuardReceiptStatus) &&
          Array.isArray(incidentPacketAgentRuntime.latestRunnerGuardExplicitRequestKinds) &&
          incidentPacketAgentRuntime.latestRunnerGuardExplicitRequestKinds.length > 0),
      "值班事故交接包 boundaries.agentRuntime 触发 runner guard 时必须带 runStatus、blockedBy、code、stage、receiptStatus 和 explicitRequestKinds"
    );
    assert(
      Number(incidentPacketAgentRuntime.memoryStabilityStateCount || 0) === 0 ||
        (text(incidentPacketAgentRuntime.latestMemoryStabilityStateId) &&
          text(incidentPacketAgentRuntime.latestMemoryStabilityCorrectionLevel) &&
          Number.isFinite(Number(incidentPacketAgentRuntime.latestMemoryStabilityRiskScore)) &&
          text(incidentPacketAgentRuntime.latestMemoryStabilityUpdatedAt) &&
          text(incidentPacketAgentRuntime.latestMemoryStabilityObservationKind)),
      "值班事故交接包 boundaries.agentRuntime 有记忆稳态状态时必须带 stateId、correctionLevel、riskScore、updatedAt 和 observationKind"
    );
    assert(
      !["light", "mild", "medium", "strong"].includes(text(incidentPacketAgentRuntime.latestMemoryStabilityCorrectionLevel, "")) ||
        (Array.isArray(incidentPacketAgentRuntime.latestMemoryStabilityCorrectionActions) &&
          incidentPacketAgentRuntime.latestMemoryStabilityCorrectionActions.length > 0),
      "值班事故交接包 boundaries.agentRuntime 进入纠偏窗口时必须带 correctionActions"
    );
    assert(
      !["light", "mild", "medium", "strong"].includes(text(incidentPacketAgentRuntime.latestMemoryStabilityCorrectionLevel, "")) ||
        Number.isFinite(Number(incidentPacketAgentRuntime.memoryStabilityRecoveryRate)),
      "值班事故交接包 boundaries.agentRuntime 进入纠偏窗口时必须带近窗纠偏恢复率"
    );
    const normalizeIncidentPacketAgentRuntime = (value = null) => ({
      localFirst: value?.localFirst ?? null,
      policy: value?.policy ?? null,
      onlineAllowed: value?.onlineAllowed ?? null,
      latestRunStatus: value?.latestRunStatus ?? null,
      latestRunnerGuardActivated: value?.latestRunnerGuardActivated ?? null,
      latestRunnerGuardBlockedBy: value?.latestRunnerGuardBlockedBy ?? null,
      latestRunnerGuardCode: value?.latestRunnerGuardCode ?? null,
      latestRunnerGuardStage: value?.latestRunnerGuardStage ?? null,
      latestRunnerGuardReceiptStatus: value?.latestRunnerGuardReceiptStatus ?? null,
      latestRunnerGuardExplicitRequestKinds: Array.isArray(value?.latestRunnerGuardExplicitRequestKinds)
        ? value.latestRunnerGuardExplicitRequestKinds
        : [],
      qualityEscalationRuns: value?.qualityEscalationRuns ?? null,
      latestQualityEscalationActivated: value?.latestQualityEscalationActivated ?? null,
      latestQualityEscalationProvider: value?.latestQualityEscalationProvider ?? null,
      latestQualityEscalationReason: value?.latestQualityEscalationReason ?? null,
      latestQualityEscalationIssueCodes: Array.isArray(value?.latestQualityEscalationIssueCodes)
        ? value.latestQualityEscalationIssueCodes
        : [],
      memoryStabilityStateCount: value?.memoryStabilityStateCount ?? null,
      latestMemoryStabilityStateId: value?.latestMemoryStabilityStateId ?? null,
      latestMemoryStabilityCorrectionLevel: value?.latestMemoryStabilityCorrectionLevel ?? null,
      latestMemoryStabilityRiskScore: value?.latestMemoryStabilityRiskScore ?? null,
      latestMemoryStabilityUpdatedAt: value?.latestMemoryStabilityUpdatedAt ?? null,
      latestMemoryStabilityObservationKind: value?.latestMemoryStabilityObservationKind ?? null,
      latestMemoryStabilityRecoverySignal: value?.latestMemoryStabilityRecoverySignal ?? null,
      latestMemoryStabilityCorrectionActions: Array.isArray(value?.latestMemoryStabilityCorrectionActions)
        ? value.latestMemoryStabilityCorrectionActions
        : [],
      memoryStabilityRecoveryRate: value?.memoryStabilityRecoveryRate ?? null,
    });
    const normalizedIncidentPacketAgentRuntime = normalizeIncidentPacketAgentRuntime(incidentPacketAgentRuntime);
    const normalizedSnapshotAgentRuntime = normalizeIncidentPacketAgentRuntime(snapshotAgentRuntime);
    const normalizeAlertList = (alerts = []) =>
      (Array.isArray(alerts) ? alerts : []).map((entry) => ({
        tone: text(entry?.tone),
        title: text(entry?.title),
        detail: text(entry?.detail),
        notes: Array.isArray(entry?.notes) ? entry.notes.map((note) => text(note)).filter(Boolean) : [],
      }));
    const expectedIncidentOperator = buildOperatorTruthSnapshot({
      security: incidentPacketState.payload?.snapshots?.security || null,
      setup: incidentPacketState.payload?.snapshots?.deviceSetup || null,
    });
    assert(
      toBrowserOperatorSemanticText(incidentPacketState.payload?.operatorDecision?.summary) ===
        toBrowserOperatorSemanticText(expectedIncidentOperator.decisionSummary),
      "值班事故交接包 operatorDecision.summary 应与 packet 内 operator 真值同源"
    );
    assert(
      toBrowserOperatorSemanticText(incidentPacketState.payload?.operatorDecision?.nextAction) ===
        toBrowserOperatorSemanticText(expectedIncidentOperator.nextAction),
      "值班事故交接包 operatorDecision.nextAction 应与 packet 内 operator 真值同源"
    );
    assert(
      JSON.stringify(normalizeAlertList(incidentPacketState.payload?.operatorDecision?.hardAlerts)) ===
        JSON.stringify(normalizeAlertList(expectedIncidentOperator.alerts)),
      "值班事故交接包 hardAlerts 应与 packet 内 operator 真值同源"
    );
    const postExportTruthState = await waitForJson(
      `({
        rolesCount: document.querySelectorAll("#operator-handbook-roles .role-card").length,
        decisionSequenceCount: document.querySelectorAll("#operator-decision-sequence .step-item").length,
        standardActionsCount: document.querySelectorAll("#operator-standard-actions .alert-item").length,
        decisionSummary: document.getElementById("operator-decision-summary")?.textContent || "",
        nextAction: document.getElementById("operator-next-action")?.textContent || "",
        agentRuntimeTitle: document.getElementById("operator-agent-runtime-title")?.textContent || "",
        alertsCount: document.querySelectorAll("#operator-hard-alerts .alert-item").length
      })`,
      (value) =>
        Boolean(
          value &&
            Number(value.rolesCount) === Number(expectedOperator.rolesCount) &&
            Number(value.decisionSequenceCount) === Number(expectedOperator.decisionSequenceCount) &&
            Number(value.standardActionsCount) === Number(expectedOperator.standardActionsCount) &&
            text(value.decisionSummary) === toBrowserOperatorText(expectedOperator.decisionSummary) &&
            text(value.nextAction) === toBrowserOperatorText(expectedOperator.nextAction) &&
            text(value.agentRuntimeTitle) === toBrowserOperatorText(expectedOperator.agentRuntimeTitle) &&
            Number(value.alertsCount) === Number(expectedOperator.alertsCount)
        ),
      "值班事故交接包导出后 operator 真值不应被窄 packet snapshot 覆盖",
      {
        timeoutMs: 30000,
      }
    );
    return {
      ...exportState,
      truthState: {
        ...truthState,
        agentRuntimeDetailCount: Array.isArray(truthState.agentRuntimeDetails) ? truthState.agentRuntimeDetails.length : 0,
      },
      operatorTruthMissingFields: Array.isArray(expectedOperator.missingFields)
        ? expectedOperator.missingFields
        : [],
      operatorTruthReady: expectedOperator.readyForDecision === true,
      exportState: {
        ...exportState,
        exportRecord: {
          evidenceRefId: exportRecord.evidenceRefId ?? null,
          physicalResidentAgentId: exportRecord.physicalResidentAgentId ?? null,
          agentId: exportRecord.agentId ?? null,
          residentAgentReference: exportRecord.residentAgentReference ?? null,
          resolvedResidentAgentId: exportRecord.resolvedResidentAgentId ?? null,
          title: exportRecord.title ?? null,
          uri: exportRecord.uri ?? null,
          recordedAt: exportRecord.recordedAt ?? null,
          tags: Array.isArray(exportRecord.tags) ? exportRecord.tags : [],
        },
        apiExport: {
          sourceSurface: apiExportPacket.sourceSurface ?? null,
          residentAgentId: apiExportPacket.residentAgentId ?? null,
          residentAgentReference: apiExportPacket.residentAgentReference ?? null,
          resolvedResidentAgentId: apiExportPacket.resolvedResidentAgentId ?? null,
          exportedAt: apiExportPacket.exportedAt ?? null,
          exportCoverage: apiExportPacket.exportCoverage ?? null,
          exportRecord: apiExportPacket.exportRecord ?? null,
          historyResidentAgentId: postApiExportHistoryState.payload?.residentAgentId ?? null,
          historyResidentAgentReference: postApiExportHistoryState.payload?.residentAgentReference ?? null,
          historyResolvedResidentAgentId: postApiExportHistoryState.payload?.resolvedResidentAgentId ?? null,
          historyMatchedExportResidentAgentReference:
            text(matchedPostApiExportRecord?.residentAgentReference) === text(apiExportPacket.residentAgentReference),
          historyMatchedExportResolvedResidentAgentId:
            text(matchedPostApiExportRecord?.resolvedResidentAgentId) === text(apiExportPacket.resolvedResidentAgentId),
          historyMatchedExportRecord: postApiExportHistory.some(
            (entry) => text(entry?.evidenceRefId) === text(apiExportPacket.exportRecord?.evidenceRefId)
          ),
        },
        exportHistoryResidentAgentId: exportHistoryState.payload?.residentAgentId ?? null,
        exportHistoryResidentAgentReference: exportHistoryState.payload?.residentAgentReference ?? null,
        exportHistoryResolvedResidentAgentId: exportHistoryState.payload?.resolvedResidentAgentId ?? null,
        exportContents: Array.isArray(exportState.exportContents) ? exportState.exportContents : [],
        exportContentsHasAgentRuntimeTruth: Array.isArray(exportState.exportContents)
          ? exportState.exportContents.some((entry) => isBrowserOperatorAgentRuntimeExportContent(entry))
          : false,
        exportHistoryEntries: Array.isArray(exportState.exportHistoryEntries) ? exportState.exportHistoryEntries : [],
        exportHistoryResidentAgentReferences: Array.isArray(exportState.exportHistoryResidentAgentReferences)
          ? exportState.exportHistoryResidentAgentReferences
          : [],
        exportHistoryResolvedResidentAgentIds: Array.isArray(exportState.exportHistoryResolvedResidentAgentIds)
          ? exportState.exportHistoryResolvedResidentAgentIds
          : [],
        exportHistoryEffectivePhysicalResidentAgentIds: Array.isArray(exportState.exportHistoryEffectivePhysicalResidentAgentIds)
          ? exportState.exportHistoryEffectivePhysicalResidentAgentIds
          : [],
        exportHistoryEffectiveResolvedResidentAgentIds: Array.isArray(exportState.exportHistoryEffectiveResolvedResidentAgentIds)
          ? exportState.exportHistoryEffectiveResolvedResidentAgentIds
          : [],
        exportHistoryResidentBindingMismatches: Array.isArray(exportState.exportHistoryResidentBindingMismatches)
          ? exportState.exportHistoryResidentBindingMismatches
          : [],
      },
      postExportTruthState,
      incidentPacketState: {
        status: incidentPacketState.status,
        format: incidentPacketState.payload?.format ?? null,
        operatorDecisionSummary: incidentPacketState.payload?.operatorDecision?.summary ?? null,
        operatorDecisionNextAction: incidentPacketState.payload?.operatorDecision?.nextAction ?? null,
        operatorDecisionHardAlertCount: Array.isArray(incidentPacketState.payload?.operatorDecision?.hardAlerts)
          ? incidentPacketState.payload.operatorDecision.hardAlerts.length
          : 0,
        snapshotReleaseReadinessFailureSemantics:
          incidentPacketState.payload?.snapshots?.security?.releaseReadiness?.failureSemantics ?? null,
        boundaryReleaseReadinessFailureSemantics:
          incidentPacketState.payload?.boundaries?.releaseReadiness?.failureSemantics ?? null,
        boundaryAutomaticRecoveryFailureSemantics:
          incidentPacketState.payload?.boundaries?.automaticRecovery?.failureSemantics ?? null,
        boundaryAgentRuntime: normalizedIncidentPacketAgentRuntime,
        snapshotAgentRuntime: normalizedSnapshotAgentRuntime,
      },
    };
  });
}

async function runOperatorInvalidTokenCheck() {
  await seedBrowserToken("agent-passport-invalid-token");
  return withBrowserDocument(`${baseUrl}/operator`, async () => {
    await waitForReady("值班决策面坏令牌");
    const summary = await waitForJson(
      `({
        authSummary: document.getElementById("operator-auth-summary")?.textContent || "",
        protectedStatus: document.getElementById("operator-protected-status")?.textContent || "",
        exportStatus: document.getElementById("operator-export-status")?.textContent || "",
        exportDisabled: document.getElementById("operator-export-incident-packet")?.disabled ?? false
      })`,
      (value) =>
        Boolean(
          value &&
            text(value.authSummary).includes("本次浏览保存的访问口令无法读取设备恢复资料") &&
            text(value.authSummary).includes("重新输入") &&
            text(value.protectedStatus).includes("继续显示公开状态") &&
            text(value.exportStatus).includes("当前不能导出") &&
            value.exportDisabled === true
        ),
      "值班决策面坏令牌",
      {
        timeoutMs: 30000,
      }
    );
    return {
      ...summary,
      guard: {
        authBlocked: true,
        blockedSurface: "/api/device/setup",
        publicTruthRetained: true,
        exportDisabled: true,
      },
    };
  });
}

async function runRepairHubInvalidTokenCheck(repairId) {
  await seedBrowserToken("agent-passport-invalid-token");
  return withBrowserDocument(
    `${baseUrl}/repair-hub?agentId=${MAIN_AGENT_ID}&repairId=${encodeURIComponent(repairId)}&didMethod=agentpassport`,
    async () => {
      await waitForReady("受保护修复证据面坏令牌");
      const summary = await waitForJson(
        `({
          authSummary: document.getElementById("repair-hub-auth-summary")?.textContent || "",
          overview: document.getElementById("repair-overview")?.textContent || "",
          listEmpty: document.getElementById("repair-list")?.textContent || ""
        })`,
        (value) =>
          Boolean(
            value &&
              text(value.authSummary).includes("本次浏览保存的访问口令无法读取") &&
              text(value.authSummary).includes("重新输入") &&
              text(value.overview).includes("本次浏览保存的访问口令无法读取") &&
              text(value.listEmpty).includes("本次浏览保存的访问口令无法读取")
          ),
        "受保护修复证据面坏令牌",
        {
          timeoutMs: 30000,
        }
      );
      return {
        ...summary,
        guard: {
          authBlocked: true,
          blockedSurface: "repair-hub-protected-read",
          overviewCleared: true,
          listCleared: true,
        },
      };
    }
  );
}

async function runOfflineChatInvalidTokenCheck() {
  await seedBrowserToken("agent-passport-invalid-token");
  return withBrowserDocument(`${baseUrl}/offline-chat`, async () => {
    await waitForReady("Offline Chat 坏令牌");
    const summary = await waitForJson(
      `({
        authSummary: document.getElementById("auth-status")?.textContent || "",
        threadTitle: document.getElementById("thread-title")?.textContent || "",
        threadDescription: document.getElementById("thread-description")?.textContent || "",
        threadContextSummary: document.getElementById("thread-context-summary")?.textContent || "",
        dispatchHistorySummary: document.getElementById("dispatch-history-summary")?.textContent || "",
        notice: document.getElementById("runtime-notice")?.textContent || "",
        syncStatus: document.getElementById("sync-status")?.textContent || "",
        messageText: document.getElementById("messages")?.textContent || "",
        sendDisabled: document.getElementById("send-button")?.disabled ?? false,
        clearDisabled: document.getElementById("auth-clear-button")?.disabled ?? false
      })`,
      (value) =>
        Boolean(
          value &&
            text(value.authSummary).includes("重新输入") &&
            text(value.authSummary).includes("无法访问对话记录") &&
            text(value.threadTitle).includes("对话记录") &&
            text(value.threadDescription).includes("没有可用对话") &&
            text(value.threadContextSummary).includes("当前没有可用对话") &&
            text(value.dispatchHistorySummary).includes("当前没有可用对话") &&
            text(value.notice).includes("无法访问对话记录") &&
            text(value.syncStatus).includes("无法访问对话记录") &&
            text(value.messageText).includes("当前没有可用对话") &&
            value.sendDisabled === true &&
            value.clearDisabled === false
        ),
      "Offline Chat 坏令牌",
      {
        timeoutMs: 30000,
      }
    );
    return {
      ...summary,
      guard: {
        authBlocked: true,
        blockedSurface: "offline-chat-protected-read",
        tokenRetained: true,
        statePreserved: true,
        sendDisabled: true,
        clearEnabled: true,
      },
    };
  });
}

async function runOfflineChatDeepLinkDom(fixture) {
  return withBrowserDocument(buildOfflineChatDeepLinkUrl(fixture), async () => {
    await waitForReady("Offline Chat 深链");
    await refreshOfflineChatDocumentAfterAuthInjection();
    return waitForJson(
      `(() => {
        const activeThread = document.querySelector(".thread-button.active");
        const activeSource = document.querySelector(".source-filter-button.active");
        const assistantMessages = Array.from(document.querySelectorAll(".message.assistant")).map((node) => ({
          messageId: node.getAttribute("data-message-id") || "",
          sourceProvider: node.getAttribute("data-source-provider") || "",
          dispatchBatch: node.getAttribute("data-dispatch-batch") || node.querySelector(".message-dispatch")?.getAttribute("data-dispatch-batch") || "",
          dispatchMode: node.getAttribute("data-dispatch-mode") || node.querySelector(".message-dispatch")?.getAttribute("data-dispatch-mode") || "",
          sourceText: node.querySelector(".message-source")?.textContent || "",
          dispatchText: node.querySelector(".message-dispatch")?.textContent || ""
        }));
        const assistantSources = assistantMessages.map((entry) => (entry.sourceText || "").trim());
        const assistantDispatches = assistantMessages.map((entry) => (entry.dispatchText || "").trim()).filter(Boolean);
        const threadContextNames = Array.from(document.querySelectorAll("#thread-context-list .thread-context-name")).map((node) => (node.textContent || "").trim());
        const dispatchHistorySection = document.getElementById("dispatch-history-section");
        return {
          locationSearch: window.location.search,
          activeThreadId: activeThread?.getAttribute("data-thread-id") || "",
          activeSourceFilter: activeSource?.getAttribute("data-source-filter") || "",
          activeSourceLabel: activeSource?.querySelector(".source-filter-label")?.textContent || "",
          threadTitle: document.getElementById("thread-title")?.textContent || "",
          threadDescription: document.getElementById("thread-description")?.textContent || "",
          threadContextSummary: document.getElementById("thread-context-summary")?.textContent || "",
          threadContextNames,
          sourceSummary: document.getElementById("source-filter-summary")?.textContent || "",
          dispatchHistoryHidden: dispatchHistorySection?.hidden ?? null,
          messageCount: document.querySelectorAll("#messages .message").length,
          assistantSourceCount: assistantSources.length,
          assistantDispatchCount: assistantDispatches.length,
          assistantSourceTexts: assistantSources,
          assistantDispatchTexts: assistantDispatches,
          assistantMessageIds: assistantMessages.map((entry) => entry.messageId).filter(Boolean),
          assistantSourceProviders: assistantMessages.map((entry) => entry.sourceProvider).filter(Boolean),
          assistantDispatchBatches: assistantMessages.map((entry) => entry.dispatchBatch).filter(Boolean),
          assistantDispatchModes: assistantMessages.map((entry) => entry.dispatchMode).filter(Boolean)
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.locationSearch?.includes(`threadId=${encodeURIComponent(fixture.routeThreadId || fixture.threadId)}`) &&
            value.locationSearch?.includes(`sourceProvider=${encodeURIComponent(fixture.sourceProvider)}`) &&
            value.activeThreadId === fixture.threadId &&
            value.activeSourceFilter === fixture.sourceProvider &&
            value.threadTitle?.includes(fixture.threadLabel) &&
            value.threadDescription?.includes(fixture.sourceLabel) &&
            value.threadContextSummary?.includes("当前对话只包含 1 位成员") &&
            value.threadContextNames?.includes(fixture.threadLabel) &&
            value.sourceSummary?.includes(fixture.sourceLabel) &&
            value.dispatchHistoryHidden === true &&
            value.assistantSourceCount >= 1 &&
            value.assistantDispatchCount === 0 &&
            fixture.filteredAssistantMessageIds.every((messageId) => value.assistantMessageIds.includes(messageId)) &&
            value.assistantSourceProviders.every((provider) => provider === fixture.sourceProvider) &&
            value.assistantSourceTexts.every(
              (entry) =>
                (entry.includes(fixture.sourceLabel) || entry.includes(fixture.sourceProvider)) &&
                !/fan-out|并行|串行/.test(entry)
            )
        ),
      "Offline Chat 深链"
      ,
      {
        timeoutMs: 30000,
      }
    );
  });
}

async function runOfflineChatGroupDom(fixture, directFixture) {
  return withBrowserDocument(`${baseUrl}/offline-chat?threadId=group`, async () => {
    await waitForReady("Offline Chat 群聊真值");
    await refreshOfflineChatDocumentAfterAuthInjection();
    const initialShellState = await waitForJson(
      `(() => {
        const activeThread = document.querySelector(".thread-button.active");
        return {
          locationSearch: window.location.search,
          activeThreadId: activeThread?.getAttribute("data-thread-id") || "",
          threadTitle: document.getElementById("thread-title")?.textContent || "",
          threadDescription: document.getElementById("thread-description")?.textContent || "",
          composerHint: document.getElementById("composer-hint")?.textContent || "",
          threadContextSummary: document.getElementById("thread-context-summary")?.textContent || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            browserUrlHasExpectedParams(value.locationSearch ? `${baseUrl}/offline-chat${value.locationSearch}` : "", {
              threadId: fixture.threadId,
            }) &&
            value.activeThreadId === "group" &&
            text(value.threadTitle).includes("我们的群聊") &&
            (text(value.threadDescription).includes(`${fixture.memberCount} 人对话`) ||
              text(value.threadDescription).includes(`当前共有 ${fixture.memberCount} 位成员`)) &&
            text(value.threadContextSummary).includes(`当前对话共有 ${fixture.memberCount} 位成员`) &&
            text(value.threadContextSummary).includes("启动配置：") &&
            text(value.threadContextSummary).includes("最近执行：")
        ),
      "Offline Chat 群聊主视图",
      {
        timeoutMs: 15000,
      }
    );

    const initialState = await waitForJson(
      `(() => {
        const assistantMessages = Array.from(document.querySelectorAll(".message.assistant")).map((node) => ({
          messageId: node.getAttribute("data-message-id") || "",
          sourceProvider: node.getAttribute("data-source-provider") || "",
          dispatchBatch: node.getAttribute("data-dispatch-batch") || node.querySelector(".message-dispatch")?.getAttribute("data-dispatch-batch") || "",
          dispatchMode: node.getAttribute("data-dispatch-mode") || node.querySelector(".message-dispatch")?.getAttribute("data-dispatch-mode") || "",
          sourceText: node.querySelector(".message-source")?.textContent || "",
          dispatchText: node.querySelector(".message-dispatch")?.textContent || ""
        }));
        const assistantSources = assistantMessages.map((entry) => (entry.sourceText || "").trim());
        const assistantDispatches = assistantMessages.map((entry) => (entry.dispatchText || "").trim()).filter(Boolean);
        const threadContextNames = Array.from(document.querySelectorAll("#thread-context-list .thread-context-name")).map((node) => (node.textContent || "").trim());
        const threadContextCards = Array.from(document.querySelectorAll("#thread-context-list .thread-context-card")).map((card) => ({
          name: card.querySelector(".thread-context-name")?.textContent || "",
          meta: card.querySelector(".thread-context-meta")?.textContent || "",
          goal: card.querySelector(".thread-context-goal")?.textContent || ""
        }));
        const dispatchHistorySection = document.getElementById("dispatch-history-section");
        const firstHistoryCard = document.querySelector("#dispatch-history-list .dispatch-history-card");
        const firstParallelChip = firstHistoryCard?.querySelector(".dispatch-chip.parallel");
        const policyCard = threadContextCards.find((entry) => (entry.name || "").trim() === "协作公约") || null;
        const executionCard = threadContextCards.find((entry) => (entry.name || "").trim() === "最近执行") || null;
        return {
          sourceFilterSummary: document.getElementById("source-filter-summary")?.textContent || "",
          threadContextNames,
          dispatchHistoryHidden: dispatchHistorySection?.hidden ?? null,
          dispatchHistorySummary: document.getElementById("dispatch-history-summary")?.textContent || "",
          dispatchHistoryCount: document.querySelectorAll("#dispatch-history-list .dispatch-history-card").length,
          dispatchHistoryRecordIds: Array.from(document.querySelectorAll("#dispatch-history-list .dispatch-history-card")).map((node) => node.getAttribute("data-record-id") || "").filter(Boolean),
          firstDispatchRecordId: firstHistoryCard?.getAttribute("data-record-id") || "",
          firstDispatchParallelBatchCount: firstHistoryCard?.getAttribute("data-parallel-batch-count") || "",
          firstDispatchMeta: firstHistoryCard?.querySelector(".dispatch-history-meta")?.textContent || "",
          firstDispatchBody: firstHistoryCard?.querySelector(".dispatch-history-body")?.textContent || "",
          firstParallelChip: firstParallelChip?.textContent || "",
          assistantSourceCount: assistantSources.length,
          assistantDispatchCount: assistantDispatches.length,
          assistantSourceTexts: assistantSources,
          assistantDispatchTexts: assistantDispatches,
          assistantMessageIds: assistantMessages.map((entry) => entry.messageId).filter(Boolean),
          assistantSourceProviders: assistantMessages.map((entry) => entry.sourceProvider).filter(Boolean),
          assistantDispatchBatches: assistantMessages.map((entry) => entry.dispatchBatch).filter(Boolean),
          assistantDispatchModes: assistantMessages.map((entry) => entry.dispatchMode).filter(Boolean),
          policyCardMeta: policyCard?.meta || "",
          policyCardGoal: policyCard?.goal || "",
          executionCardMeta: executionCard?.meta || "",
          executionCardGoal: executionCard?.goal || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            text(value.sourceFilterSummary).length > 0 &&
            !/当前共有 0 条回复|0 条回复/.test(text(value.sourceFilterSummary)) &&
            text(value.policyCardMeta).includes("当前对话启动配置") &&
            text(value.policyCardGoal).includes(fixture.protocolTitle) &&
            !text(value.policyCardGoal).includes("最近一轮") &&
            isDispatchResultMetaText(value.executionCardMeta) &&
            text(value.executionCardGoal).includes("最近一轮") &&
            value.dispatchHistoryHidden === false &&
            Number(value.dispatchHistoryCount) >= 1 &&
            Array.isArray(value.dispatchHistoryRecordIds) &&
            value.dispatchHistoryRecordIds.includes(fixture.seedRecordId) &&
            value.firstDispatchRecordId === fixture.seedRecordId &&
            Number(value.firstDispatchParallelBatchCount || 0) >= 1 &&
            text(value.dispatchHistorySummary).includes("最近展示") &&
            isParallelBatchText(value.firstParallelChip) &&
            Number(value.assistantSourceCount) >= 1 &&
            Array.isArray(value.assistantMessageIds) &&
            value.assistantMessageIds.some((messageId) => messageId.startsWith(`${fixture.seedRecordId}:`)) &&
            Number(value.assistantDispatchCount) >= 1 &&
            value.assistantDispatchModes.includes("parallel") &&
            value.assistantDispatchTexts.some((entry) => isAssistantDispatchText(entry)) &&
            fixture.participantNames.every(
              (name) =>
                Array.isArray(value.threadContextNames) &&
                value.threadContextNames.includes(name)
            )
        ),
      "Offline Chat 群聊真值",
      {
        timeoutMs: 25000,
      }
    );

    const refreshTransitionState = await waitForJson(
      `(() => {
        const refreshButton = document.getElementById("refresh-button");
        const activeThreadBefore = document.querySelector(".thread-button.active")?.getAttribute("data-thread-id") || "";
        const summaryBefore = document.getElementById("dispatch-history-summary")?.textContent || "";
        const firstRecordIdBefore = document.querySelector("#dispatch-history-list .dispatch-history-card")?.getAttribute("data-record-id") || "";
        const firstMetaBefore = document.querySelector("#dispatch-history-list .dispatch-history-card .dispatch-history-meta")?.textContent || "";
        refreshButton?.click();
        const activeThreadAfter = document.querySelector(".thread-button.active")?.getAttribute("data-thread-id") || "";
        return {
          clicked: Boolean(refreshButton),
          activeThreadBefore,
          activeThreadAfter,
          refreshButtonDisabled: refreshButton?.disabled ?? false,
          refreshButtonText: refreshButton?.textContent || "",
          dispatchHistorySummary: document.getElementById("dispatch-history-summary")?.textContent || "",
          firstDispatchRecordId: document.querySelector("#dispatch-history-list .dispatch-history-card")?.getAttribute("data-record-id") || "",
          firstDispatchMeta: document.querySelector("#dispatch-history-list .dispatch-history-card .dispatch-history-meta")?.textContent || "",
          summaryBefore,
          firstMetaBefore,
          firstRecordIdBefore
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.clicked === true &&
            value.activeThreadBefore === "group" &&
            value.activeThreadAfter === "group" &&
            text(value.dispatchHistorySummary).includes("最近展示") &&
            value.firstDispatchRecordId === fixture.seedRecordId &&
            isDispatchRecordMetaText(value.firstDispatchMeta, fixture.seedRecordId) &&
            text(value.summaryBefore).includes("最近展示") &&
            value.firstRecordIdBefore === fixture.seedRecordId &&
            isDispatchRecordMetaText(value.firstMetaBefore, fixture.seedRecordId)
        ),
      "Offline Chat 群聊刷新中保留旧调度历史",
      {
        timeoutMs: 10000,
      }
    );

    const refreshSettledState = await waitForJson(
      `(() => {
        const refreshButton = document.getElementById("refresh-button");
        const activeThread = document.querySelector(".thread-button.active");
        const dispatchHistorySection = document.getElementById("dispatch-history-section");
        const firstHistoryCard = document.querySelector("#dispatch-history-list .dispatch-history-card");
        return {
          activeThreadId: activeThread?.getAttribute("data-thread-id") || "",
          refreshButtonDisabled: refreshButton?.disabled ?? false,
          refreshButtonText: refreshButton?.textContent || "",
          dispatchHistoryHidden: dispatchHistorySection?.hidden ?? null,
          dispatchHistorySummary: document.getElementById("dispatch-history-summary")?.textContent || "",
          firstDispatchRecordId: firstHistoryCard?.getAttribute("data-record-id") || "",
          firstDispatchMeta: firstHistoryCard?.querySelector(".dispatch-history-meta")?.textContent || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.activeThreadId === "group" &&
            value.refreshButtonDisabled === false &&
            text(value.refreshButtonText).includes("刷新状态") &&
            value.dispatchHistoryHidden === false &&
            text(value.dispatchHistorySummary).includes("最近展示") &&
            value.firstDispatchRecordId === fixture.seedRecordId &&
            isDispatchRecordMetaText(value.firstDispatchMeta, fixture.seedRecordId)
        ),
      "Offline Chat 群聊刷新完成后保留调度历史",
      {
        timeoutMs: 30000,
      }
    );

    await browserEval(`(() => {
      const threadButton = document.querySelector(${JSON.stringify(`.thread-button[data-thread-id="${directFixture.threadId}"]`)});
      threadButton?.click();
      return Boolean(threadButton);
    })()`);

    const directState = await waitForJson(
      `(() => {
        const activeThread = document.querySelector(".thread-button.active");
        const dispatchHistorySection = document.getElementById("dispatch-history-section");
        return {
          activeThreadId: activeThread?.getAttribute("data-thread-id") || "",
          threadTitle: document.getElementById("thread-title")?.textContent || "",
          dispatchHistoryHidden: dispatchHistorySection?.hidden ?? null
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.activeThreadId === directFixture.threadId &&
            text(value.threadTitle).includes(directFixture.threadLabel) &&
            value.dispatchHistoryHidden === true
        ),
      "Offline Chat 单聊隐藏调度历史",
      {
        timeoutMs: 30000,
      }
    );

    await browserEval(`(() => {
      const threadButton = document.querySelector('.thread-button[data-thread-id="group"]');
      threadButton?.click();
      return Boolean(threadButton);
    })()`);

    await waitForJson(
      `(() => {
        const activeThread = document.querySelector(".thread-button.active");
        const dispatchHistorySection = document.getElementById("dispatch-history-section");
        const firstHistoryCard = document.querySelector("#dispatch-history-list .dispatch-history-card");
        return {
          activeThreadId: activeThread?.getAttribute("data-thread-id") || "",
          dispatchHistoryHidden: dispatchHistorySection?.hidden ?? null,
          firstDispatchRecordId: firstHistoryCard?.getAttribute("data-record-id") || "",
          firstDispatchMeta: firstHistoryCard?.querySelector(".dispatch-history-meta")?.textContent || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.activeThreadId === "group" &&
            value.dispatchHistoryHidden === false &&
            value.firstDispatchRecordId === fixture.seedRecordId &&
            isDispatchRecordMetaText(value.firstDispatchMeta, fixture.seedRecordId)
        ),
      "Offline Chat 切回群聊",
      {
        timeoutMs: 30000,
      }
    );

    const browserSendToken = `smoke-browser-group-refresh-${Date.now()}`;
    await browserEval(`(() => {
      const input = document.getElementById("composer-input");
      const form = document.getElementById("composer");
      if (!input || !form) {
        return false;
      }
      input.value = ${JSON.stringify(`继续推进 dispatch history browser refresh。token=${browserSendToken}`)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
      return true;
    })()`);

    const refreshedState = await waitForJson(
      `(() => {
        const activeThread = document.querySelector(".thread-button.active");
        const dispatchHistorySection = document.getElementById("dispatch-history-section");
        const firstHistoryCard = document.querySelector("#dispatch-history-list .dispatch-history-card");
        const messages = Array.from(document.querySelectorAll("#messages .message.user .message-body")).map((node) => (node.textContent || "").trim());
        const threadContextCards = Array.from(document.querySelectorAll("#thread-context-list .thread-context-card")).map((card) => ({
          name: card.querySelector(".thread-context-name")?.textContent || "",
          meta: card.querySelector(".thread-context-meta")?.textContent || "",
          goal: card.querySelector(".thread-context-goal")?.textContent || ""
        }));
        const policyCard = threadContextCards.find((entry) => (entry.name || "").trim() === "协作公约") || null;
        const executionCard = threadContextCards.find((entry) => (entry.name || "").trim() === "最近执行") || null;
        return {
          activeThreadId: activeThread?.getAttribute("data-thread-id") || "",
          dispatchHistoryHidden: dispatchHistorySection?.hidden ?? null,
          dispatchHistorySummary: document.getElementById("dispatch-history-summary")?.textContent || "",
          firstDispatchRecordId: firstHistoryCard?.getAttribute("data-record-id") || "",
          firstDispatchMeta: firstHistoryCard?.querySelector(".dispatch-history-meta")?.textContent || "",
          firstDispatchBody: firstHistoryCard?.querySelector(".dispatch-history-body")?.textContent || "",
          lastUserMessage: messages.length > 0 ? messages[messages.length - 1] : "",
          sendDisabled: document.getElementById("send-button")?.disabled ?? false,
          policyCardGoal: policyCard?.goal || "",
          executionCardGoal: executionCard?.goal || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.activeThreadId === "group" &&
            value.dispatchHistoryHidden === false &&
            text(value.dispatchHistorySummary).includes("最近展示") &&
            value.firstDispatchRecordId &&
            value.firstDispatchRecordId !== fixture.seedRecordId &&
            text(value.firstDispatchMeta).includes("记录") &&
            !text(value.firstDispatchMeta).includes(fixture.seedRecordId) &&
            text(value.firstDispatchBody).includes(browserSendToken) &&
            text(value.lastUserMessage).includes(browserSendToken) &&
            value.sendDisabled === false &&
            !text(value.policyCardGoal).includes("最近一轮") &&
            text(value.executionCardGoal).includes("最近一轮")
        ),
      "Offline Chat 群聊发送后调度历史刷新",
      {
        timeoutMs: 60000,
      }
    );

    return {
      ...initialShellState,
      ...initialState,
      refreshTransitionState,
      refreshSettledState,
      directState,
      refreshedState,
    };
  });
}

function summarizeSmokeBrowserFailure(error = null) {
  const message = text(error?.message || error);
  const surfaceMatch = message.match(/\/api\/[a-z0-9/_-]+/i);
  const failedSurface = surfaceMatch?.[0] || null;
  const blocker =
    message.includes("Safari DOM automation") || message.includes("DOM automation")
      ? "browser_automation_unavailable"
      : message.includes("公开运行态真值缺失")
        ? "runtime_home_truth_missing"
        : message.includes("运行现场安全边界真值缺失")
          ? "lab_security_truth_missing"
          : message.includes("值班决策面真值缺失")
            ? "operator_truth_missing"
            : failedSurface
              ? "protected_surface_failed"
              : "browser_smoke_failed";
  const nextActionByBlocker = {
    browser_automation_unavailable: "先确认 Safari/WebDriver 自动化权限，再重跑 npm run smoke:browser；不要用 browserSkipped 当正式放行。",
    runtime_home_truth_missing: "先修 /api/health 与 /api/security 生成的公开运行态真值，再看 public/index.html。",
    lab_security_truth_missing: "先修 /api/security 的安全/恢复边界字段，再看 public/lab.html。",
    operator_truth_missing: "先修 /api/security 与 /api/device/setup 的 operator 真值，再看 public/operator.html。",
    protected_surface_failed: failedSurface
      ? `先直接请求 ${failedSurface} 看结构化错误，再回到对应 UI 绑定。`
      : "先定位失败的受保护接口，再回到对应 UI 绑定。",
    browser_smoke_failed: "先看 firstBlocker；如果是等待超时，优先检查对应 DOM 是否绑定真实 API 数据。",
  };
  return {
    firstBlocker: message,
    blocker,
    failedSurface,
    nextAction: nextActionByBlocker[blocker],
  };
}

async function main() {
  try {
    await assertPublicCopyPolicyForRoot(rootDir);
    await acquireBrowserAutomationLock();
    if (browserAutomationPreference !== "webdriver") {
      await runAppleScript([`tell application ${JSON.stringify(browserName)} to return version`]);
    }

    const health = await getJson("/api/health", { allowAuthFallback: false });
    assert(health.ok === true, "health.ok 不是 true");
    await configureSmokeBrowserLocalReasoner();
    const security = await getJson("/api/security", { allowAuthFallback: false });
    assert(security?.releaseReadiness && typeof security.releaseReadiness === "object", "/api/security 缺少 releaseReadiness");
    const setup = await getJson("/api/device/setup");
    const expectedRuntimeHome = buildExpectedRuntimeHomeView(health, security);
    const expectedLabSecurityBoundaries = buildExpectedLabSecurityBoundariesView(security);
    const expectedOperator = buildOperatorTruthSnapshot({ security, setup });
    const browserAutomation = await detectBrowserAutomationMode();
    assert(
      browserAutomation.mode === "dom",
      `smoke:browser merge gate 需要 Safari DOM automation；当前不可用：${browserAutomation.reason}`
    );

    let repairId = null;
    let credentialId = null;
    let compatCredentialId = null;
    const repair = await ensureRepairFixture();

    repairId = repair.repairId;
    const repairCredentials = await getJson(
      `/api/migration-repairs/${encodeURIComponent(repairId)}/credentials?didMethod=agentpassport&limit=20&sortBy=latestRepairAt&sortOrder=desc`
    );
    const repairCompatCredentials = await getJson(
      `/api/migration-repairs/${encodeURIComponent(repairId)}/credentials?didMethod=openneed&limit=20&sortBy=latestRepairAt&sortOrder=desc`
    );
    const credential =
      repairCredentials.credentials?.find((entry) => entry.issuerDidMethod === "agentpassport") ||
      repairCredentials.credentials?.[0] ||
      null;
    const compatCredential =
      repairCompatCredentials.credentials?.find((entry) => entry.issuerDidMethod === "openneed") ||
      repairCompatCredentials.credentials?.[0] ||
      null;
    credentialId = credential?.credentialRecordId || credential?.credentialId || null;
    compatCredentialId = compatCredential?.credentialRecordId || compatCredential?.credentialId || null;
    assert(credentialId, `repair ${repairId} 没有可用 credential`);
    assert(compatCredentialId, `repair ${repairId} 没有可用 openneed compatibility credential`);

    const mainSummary = await runRuntimeHomeTruthCheck(expectedRuntimeHome);
    const labSummary = await runLabSecurityBoundariesCheck(expectedLabSecurityBoundaries);
    const labInvalidTokenSummary = await runLabInvalidTokenCheck();
    await seedBrowserAdminToken();
    const operatorSummary = await runOperatorTruthCheck(expectedOperator);
    await seedBrowserAdminToken();
    const repairHubSummary = await runRepairHubDeepLink(repairId, credentialId, {
      didMethod: "agentpassport",
      expectedCredentialDidMethod: "agentpassport",
      expectedVisibleDidMethod: "agentpassport",
    });
    await seedBrowserAdminToken();
    const repairHubLegacyCanonicalSummary = await runRepairHubDeepLink(repairId, credentialId, {
      didMethod: "agentpassport",
      expectedCredentialDidMethod: "agentpassport",
      expectedVisibleDidMethod: "agentpassport",
      startAgentId: LEGACY_MAIN_AGENT_ID,
      startIssuerAgentId: LEGACY_MAIN_AGENT_ID,
      expectLegacyMainAgentSelfHeal: true,
    });
    await seedBrowserAdminToken();
    const repairHubCompatSummary = await runRepairHubDeepLink(repairId, compatCredentialId, {
      didMethod: "openneed",
      expectedCredentialDidMethod: "openneed",
      expectedVisibleDidMethod: "openneed",
    });

    await seedBrowserAdminToken();
    const offlineChatBootstrapFixture = await prepareOfflineChatBootstrapFixture();
    const offlineChatFixture = await prepareOfflineChatDeepLinkFixture(offlineChatBootstrapFixture);
    const offlineChatGroupFixture = await prepareOfflineChatGroupFixture(offlineChatBootstrapFixture);
    const offlineChatSummary = await runOfflineChatDeepLinkDom(offlineChatFixture);
    const offlineChatGroupSummary = await runOfflineChatGroupDom(offlineChatGroupFixture, offlineChatFixture);
    const operatorInvalidTokenSummary = await runOperatorInvalidTokenCheck();
    const repairHubInvalidTokenSummary = await runRepairHubInvalidTokenCheck(repairId);
    const offlineChatInvalidTokenSummary = await runOfflineChatInvalidTokenCheck();
    const agentPassportProductFlowSummary = await runAgentPassportProductCreateAndRecoveryDom();

    console.log(
      JSON.stringify(
        {
          ok: true,
          browser: browserName,
          baseUrl,
          browserAutomation,
          browserAutomationLockWaitMs: browserAutomationLockWaitedMs,
          timing: {
            browserAutomationLockWaitMs: browserAutomationLockWaitedMs,
          },
          repairId,
          credentialId,
          compatCredentialId,
          mainSummary,
          labSummary,
          labInvalidTokenSummary,
          operatorSummary,
          repairHubSummary,
          repairHubLegacyCanonicalSummary,
          repairHubCompatSummary,
          operatorInvalidTokenSummary,
          repairHubInvalidTokenSummary,
          offlineChatInvalidTokenSummary,
          agentPassportProductFlowSummary,
          offlineChatFixture,
          offlineChatSummary,
          offlineChatGroupFixture,
          offlineChatGroupSummary,
        },
        null,
        2
      )
    );
  } finally {
    try {
      await closeBrowserAutomation();
    } finally {
      await releaseBrowserAutomationLock();
    }
  }
}

main().catch((error) => {
  const failure = summarizeSmokeBrowserFailure(error);
  console.error(
    JSON.stringify(
      {
        ok: false,
        browser: browserName,
        baseUrl,
        error: error.message,
        ...failure,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});

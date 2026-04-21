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
  buildOperatorTruthSnapshot,
  buildPublicRuntimeSnapshot,
  buildSecurityBoundarySnapshot,
  LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY,
  LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY,
  PUBLIC_RUNTIME_ENTRY_HREFS,
  isPublicRuntimeHomeFailureText,
} from "../public/runtime-truth-client.js";
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
    runtimeLinks: [...PUBLIC_RUNTIME_ENTRY_HREFS],
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
  const ledgerPath = text(process.env.OPENNEED_LEDGER_PATH);
  return ledgerPath ? path.dirname(ledgerPath) : path.join(rootDir, "data");
}

async function configureSmokeBrowserLocalReasoner() {
  const configuredRuntime = await requestJson("/api/device/runtime", {
    method: "POST",
    body: JSON.stringify({
      residentAgentId: "agent_openneed_agents",
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
  assert(adminToken, "无法解析管理令牌，无法执行带鉴权的浏览器深链回归");
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
  assert(adminToken, "无法解析管理令牌，无法向当前标签页注入浏览器鉴权");
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
    "当前标签页浏览器鉴权注入"
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
  return `${baseUrl}/offline-chat?threadId=${encodeURIComponent(fixture.threadId)}&sourceProvider=${encodeURIComponent(fixture.sourceProvider)}`;
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
        (snapshot) => normalizeVisibleText(snapshot.text).includes("agent-passport 离线线程"),
        "浏览器文本能力探测"
      );
      return {
        mode: "text-fallback",
        reason: error.message,
      };
    }
  });
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
  const directThread = resolvedBootstrapFixture.directThread || null;
  assert(directThread?.threadId, "没有可用的 offline-chat 单聊线程，无法执行 deep-link 浏览器回归");

  const messageToken = `smoke-browser-deeplink-${Date.now()}`;
  const sendResult = await requestJson(`/api/offline-chat/threads/${encodeURIComponent(directThread.threadId)}/messages`, {
    method: "POST",
    timeoutMs: 30000,
    body: JSON.stringify({
      content: `请用一句话确认这是离线 deep-link 浏览器回归。token=${messageToken}`,
    }),
  });
  const sourceProvider = sendResult?.source?.provider || sendResult?.message?.assistant?.source?.provider || null;
  const sourceLabel = sendResult?.source?.label || sendResult?.message?.assistant?.source?.label || null;
  assert(sourceProvider, "offline-chat 回归消息没有返回 source.provider，无法构造来源筛选 deep-link");

  const filteredHistory = await getJson(
    `/api/offline-chat/threads/${encodeURIComponent(directThread.threadId)}/messages?limit=40&sourceProvider=${encodeURIComponent(sourceProvider)}`
  );
  const filteredAssistantMessageIds = (Array.isArray(filteredHistory?.messages) ? filteredHistory.messages : [])
    .filter((entry) => entry?.role === "assistant")
    .map((entry) => text(entry?.messageId))
    .filter(Boolean);
  const resolvedLabel =
    filteredHistory?.sourceSummary?.providers?.find((entry) => entry?.provider === sourceProvider)?.label ||
    sourceLabel ||
    sourceProvider;
  assert(filteredHistory?.counts?.filteredAssistantMessages >= 1, "offline-chat 来源筛选没有命中任何 assistant 消息");
  assert(filteredAssistantMessageIds.length >= 1, "offline-chat 来源筛选没有返回可绑定的 assistant messageId");

  return {
    threadId: directThread.threadId,
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
  assert(
    threadStartupSignature.protocolRecordId &&
      bootstrapSignature.protocolRecordId === threadStartupSignature.protocolRecordId &&
      historyStartupSignature.protocolRecordId === threadStartupSignature.protocolRecordId,
    "offline-chat startup 真值缺少同源 threadProtocol.protocolRecordId"
  );

  return {
    bootstrapMatchesThreadStartup: bootstrapSignature.startupSignature === threadStartupSignature.startupSignature,
    historyMatchesThreadStartup:
      historySignature === threadStartupSignature.startupSignature &&
      historyStartupSignature.startupSignature === threadStartupSignature.startupSignature,
    seedMatchesThreadStartup: seedSignature === threadStartupSignature.startupSignature,
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
  const startupTruth = await verifyOfflineChatStartupTruthChain({ bootstrap, seedResult });
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
    "/api/migration-repairs?agentId=agent_openneed_agents&didMethod=agentpassport&limit=5&sortBy=repairedCount&sortOrder=desc";
  let repairs = await getJson(repairListPath);
  let repair = repairs.repairs?.[0] || null;
  if (!repair?.repairId) {
    const seededRepairPayload = await requestJson("/api/agents/compare/migration/repair", {
      method: "POST",
      body: JSON.stringify({
        leftAgentId: "agent_openneed_agents",
        rightAgentId: "agent_treasury",
        didMethods: ["agentpassport", "openneed"],
        issueBothMethods: true,
      }),
    });
    const seededRepair = seededRepairPayload?.repair || null;
    assert(seededRepair?.repairId, "migration repair 自举失败");
    repairs = await getJson(repairListPath);
    repair =
      repairs.repairs?.find((entry) => entry?.repairId === seededRepair.repairId) ||
      repairs.repairs?.[0] ||
      seededRepair;
  }
  assert(repair?.repairId, "没有可用 repair 记录，无法执行浏览器级回归");
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
          homeSummary: document.getElementById("runtime-home-summary")?.textContent || "",
          healthSummary: document.getElementById("runtime-health-summary")?.textContent || "",
          healthDetail: document.getElementById("runtime-health-detail")?.textContent || "",
          recoverySummary: document.getElementById("runtime-recovery-summary")?.textContent || "",
          recoveryDetail: document.getElementById("runtime-recovery-detail")?.textContent || "",
          automationSummary: document.getElementById("runtime-automation-summary")?.textContent || "",
          automationDetail: document.getElementById("runtime-automation-detail")?.textContent || "",
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
              text(value.homeSummary) === expectedRuntimeHome.homeSummary &&
              text(value.healthSummary) === expectedRuntimeHome.healthSummary &&
              text(value.healthDetail) === expectedRuntimeHome.healthDetail &&
              text(value.recoverySummary) === expectedRuntimeHome.recoverySummary &&
              text(value.recoveryDetail) === expectedRuntimeHome.recoveryDetail &&
              text(value.automationSummary) === expectedRuntimeHome.automationSummary &&
              text(value.automationDetail) === expectedRuntimeHome.automationDetail &&
              text(value.operatorEntrySummary) === expectedRuntimeHome.operatorEntrySummary &&
              Array.isArray(value.triggerTexts) &&
              value.triggerTexts.length === expectedRuntimeHome.triggerLabels.length &&
              value.triggerTexts.every((entry, index) => text(entry) === expectedRuntimeHome.triggerLabels[index]) &&
              Array.isArray(value.runtimeLinks) &&
              (() => {
                const runtimeLinks = value.runtimeLinks.map((entry) => text(entry));
                return (
                  runtimeLinks.length === expectedRuntimeHome.runtimeLinks.length &&
                  expectedRuntimeHome.runtimeLinks.every((entry) => runtimeLinks.includes(entry))
                );
              })() &&
              value.repairHubHref === "/repair-hub"
          ),
        "公开运行态真值",
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
            text(value.authSummary).includes("当前标签页里的管理令牌无法调用 /api/security/runtime-housekeeping") &&
            text(value.authSummary).includes("请重新录入") &&
            text(value.status).includes("这次操作没有成功") &&
            text(value.status).includes("/api/security/runtime-housekeeping") &&
            text(value.resultText).includes("/api/security/runtime-housekeeping") &&
            text(value.lastReport).includes("当前标签页还没有成功维护记录")
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

async function runRepairHubDeepLink(repairId, credentialId) {
  return withBrowserDocument(
    `${baseUrl}/repair-hub?agentId=agent_openneed_agents&repairId=${encodeURIComponent(repairId)}&credentialId=${encodeURIComponent(credentialId)}&didMethod=agentpassport`,
    async () => {
      await waitForReady("受保护修复证据面深链");
      return waitForJson(
        `({
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
          selectedRepairId: new URL(window.location.href).searchParams.get("repairId") || ""
        })`,
        (value) =>
          Boolean(
            value &&
              value.tokenInputPresent === true &&
              value.authSummary?.includes("已保存管理令牌") &&
              value.mainLinkHref === `${baseUrl}/` &&
              value.selectedCredentialSummary &&
              value.selectedCredentialSummary !== "尚未选中 credential" &&
              value.selectedCredentialJsonLength > 0 &&
              value.selectedCredentialContainsId === true &&
              value.selectedCredentialParsed?.ok === true &&
              value.selectedCredentialParsed?.credentialRecordId === credentialId &&
              value.selectedCredentialParsed?.issuerDidMethod === "agentpassport" &&
              value.selectedCredentialParsed?.repairId === repairId &&
              Array.isArray(value.statusCards) &&
              value.statusCards.length === 3 &&
              ["risk", "evidence", "action"].every((kind) =>
                value.statusCards.some((card) => card.cardKind === kind)
              ) &&
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
        crossDeviceTitle: document.getElementById("operator-cross-device-title")?.textContent || "",
        crossDeviceGate: document.getElementById("operator-cross-device-gate")?.textContent || "",
        rolesCount: document.querySelectorAll("#operator-handbook-roles .role-card").length,
        decisionSequenceCount: document.querySelectorAll("#operator-decision-sequence .step-item").length,
        standardActionsCount: document.querySelectorAll("#operator-standard-actions .alert-item").length,
        handoffFieldCount: document.querySelectorAll("#operator-handoff-fields .alert-item").length,
        handoffFieldTitles: Array.from(document.querySelectorAll("#operator-handoff-fields .alert-item strong")).map((node) => node.textContent || ""),
        handoffFieldDetails: Array.from(document.querySelectorAll("#operator-handoff-fields .alert-item .meta")).map((node) => node.textContent || ""),
        alertsCount: document.querySelectorAll("#operator-hard-alerts .alert-item").length,
        stepsCount: document.querySelectorAll("#operator-cross-device-steps .step-item").length,
        mainLinkHref: Array.from(document.querySelectorAll(".hero-actions a")).find((node) => (node.getAttribute("href") || "") === "/")?.href || ""
      })`,
      (value) =>
        Boolean(
          value &&
            text(value.authSummary) === expectedOperator.authSummary &&
            text(value.protectedStatus) === expectedOperator.protectedStatus &&
            text(value.exportSummary) === expectedOperator.exportSummary &&
            text(value.exportStatus) === expectedOperator.exportStatus &&
            value.exportDisabled === false &&
            text(value.sequenceSummary) === expectedOperator.sequenceSummary &&
            text(value.standardActionsSummary) === expectedOperator.standardActionsSummary &&
            text(value.handoffSummary) === expectedOperator.handoffSummary &&
            text(value.decisionSummary) === expectedOperator.decisionSummary &&
            text(value.nextAction) === expectedOperator.nextAction &&
            text(value.postureTitle) === expectedOperator.postureTitle &&
            text(value.recoveryTitle) === expectedOperator.recoveryTitle &&
            text(value.execTitle) === expectedOperator.execTitle &&
            text(value.crossDeviceTitle) === expectedOperator.crossDeviceTitle &&
            text(value.crossDeviceGate) === expectedOperator.crossDeviceGate &&
            Number(value.rolesCount) === Number(expectedOperator.rolesCount) &&
            Number(value.decisionSequenceCount) === Number(expectedOperator.decisionSequenceCount) &&
            Number(value.standardActionsCount) === Number(expectedOperator.standardActionsCount) &&
            Number(value.handoffFieldCount) === Number(expectedOperator.handoffFieldCount) &&
            JSON.stringify(
              Array.isArray(value.handoffFieldTitles)
                ? value.handoffFieldTitles.map((entry) => text(entry))
                : []
            ) === JSON.stringify(expectedOperator.handoffFieldTitles) &&
            JSON.stringify(
              Array.isArray(value.handoffFieldDetails)
                ? value.handoffFieldDetails.map((entry) => text(entry))
                : []
            ) === JSON.stringify(expectedOperator.handoffFieldDetails) &&
            Number(value.alertsCount) === Number(expectedOperator.alertsCount) &&
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
        exportHistoryCount: document.querySelectorAll("#operator-export-history .alert-item").length,
        exportHistoryRecordIds: Array.from(document.querySelectorAll("#operator-export-history .alert-item")).map((node) => node.dataset.evidenceRefId || "").filter(Boolean),
        exportHistoryUris: Array.from(document.querySelectorAll("#operator-export-history .alert-item")).map((node) => node.dataset.uri || "").filter(Boolean)
      })`,
      (value) =>
        Boolean(
          value &&
            text(value.exportStatus).startsWith("事故交接包已导出并留档：agent-passport-incident-packet-") &&
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
      text(apiExportPacket.exportRecord?.evidenceRefId),
      "值班事故交接包 exportRecord.evidenceRefId 缺失"
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
      postApiExportHistory.some(
        (entry) => text(entry?.evidenceRefId) === text(apiExportPacket.exportRecord?.evidenceRefId)
      ),
      "值班事故交接包历史缺少本次结构化导出记录"
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
    const normalizeAlertList = (alerts = []) =>
      (Array.isArray(alerts) ? alerts : []).map((entry) => ({
        tone: text(entry?.tone),
        title: text(entry?.title),
        detail: text(entry?.detail),
        notes: Array.isArray(entry?.notes) ? entry.notes.map((note) => text(note)).filter(Boolean) : [],
      }));
    assert(
      text(incidentPacketState.payload?.operatorDecision?.summary) === text(expectedOperator.decisionSummary),
      "值班事故交接包 operatorDecision.summary 应与 operator 真值同源"
    );
    assert(
      text(incidentPacketState.payload?.operatorDecision?.nextAction) === text(expectedOperator.nextAction),
      "值班事故交接包 operatorDecision.nextAction 应与 operator 真值同源"
    );
    assert(
      JSON.stringify(normalizeAlertList(incidentPacketState.payload?.operatorDecision?.hardAlerts)) ===
        JSON.stringify(normalizeAlertList(expectedOperator.alerts)),
      "值班事故交接包 hardAlerts 应与 operator 真值同源"
    );
    const postExportTruthState = await waitForJson(
      `({
        rolesCount: document.querySelectorAll("#operator-handbook-roles .role-card").length,
        decisionSequenceCount: document.querySelectorAll("#operator-decision-sequence .step-item").length,
        standardActionsCount: document.querySelectorAll("#operator-standard-actions .alert-item").length,
        decisionSummary: document.getElementById("operator-decision-summary")?.textContent || "",
        nextAction: document.getElementById("operator-next-action")?.textContent || ""
      })`,
      (value) =>
        Boolean(
          value &&
            Number(value.rolesCount) === Number(expectedOperator.rolesCount) &&
            Number(value.decisionSequenceCount) === Number(expectedOperator.decisionSequenceCount) &&
            Number(value.standardActionsCount) === Number(expectedOperator.standardActionsCount) &&
            text(value.decisionSummary) === expectedOperator.decisionSummary &&
            text(value.nextAction) === expectedOperator.nextAction
        ),
      "值班事故交接包导出后 operator 真值不应被窄 packet snapshot 覆盖",
      {
        timeoutMs: 30000,
      }
    );
    return {
      ...exportState,
      truthState,
      operatorTruthMissingFields: Array.isArray(expectedOperator.missingFields)
        ? expectedOperator.missingFields
        : [],
      operatorTruthReady: expectedOperator.readyForDecision === true,
      exportState: {
        ...exportState,
        exportRecord: {
          evidenceRefId: exportRecord.evidenceRefId ?? null,
          agentId: exportRecord.agentId ?? null,
          title: exportRecord.title ?? null,
          uri: exportRecord.uri ?? null,
          recordedAt: exportRecord.recordedAt ?? null,
          tags: Array.isArray(exportRecord.tags) ? exportRecord.tags : [],
        },
        apiExport: {
          sourceSurface: apiExportPacket.sourceSurface ?? null,
          residentAgentId: apiExportPacket.residentAgentId ?? null,
          exportedAt: apiExportPacket.exportedAt ?? null,
          exportCoverage: apiExportPacket.exportCoverage ?? null,
          exportRecord: apiExportPacket.exportRecord ?? null,
          historyResidentAgentId: postApiExportHistoryState.payload?.residentAgentId ?? null,
          historyMatchedExportRecord: postApiExportHistory.some(
            (entry) => text(entry?.evidenceRefId) === text(apiExportPacket.exportRecord?.evidenceRefId)
          ),
        },
        exportHistoryResidentAgentId: exportHistoryState.payload?.residentAgentId ?? null,
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
            text(value.authSummary).includes("当前标签页里的管理令牌无法读取 /api/device/setup") &&
            text(value.authSummary).includes("请重新录入") &&
            text(value.protectedStatus).includes("继续显示公开真值") &&
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
    `${baseUrl}/repair-hub?agentId=agent_openneed_agents&repairId=${encodeURIComponent(repairId)}&didMethod=agentpassport`,
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
              text(value.authSummary).includes("当前标签页里的管理令牌无法读取") &&
              text(value.authSummary).includes("请重新录入") &&
              text(value.overview).includes("当前标签页里的管理令牌无法读取") &&
              text(value.listEmpty).includes("当前标签页里的管理令牌无法读取")
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
            text(value.authSummary).includes("请重新录入") &&
            text(value.threadTitle).includes("离线线程暂不可用") &&
            text(value.threadDescription).includes("当前没有拿到线程上下文") &&
            text(value.threadContextSummary).includes("当前无法确认线程成员") &&
            text(value.dispatchHistorySummary).includes("当前无法确认调度历史") &&
            text(value.notice).includes("管理令牌") &&
            text(value.syncStatus).includes("管理令牌") &&
            text(value.messageText).includes("管理令牌") &&
            value.sendDisabled === true &&
            value.clearDisabled === true
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
        dataCleared: true,
        sendDisabled: true,
        clearDisabled: true,
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
          dispatchBatch: node.getAttribute("data-dispatch-batch") || "",
          dispatchMode: node.getAttribute("data-dispatch-mode") || "",
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
            value.locationSearch?.includes(`threadId=${encodeURIComponent(fixture.threadId)}`) &&
            value.locationSearch?.includes(`sourceProvider=${encodeURIComponent(fixture.sourceProvider)}`) &&
            value.activeThreadId === fixture.threadId &&
            value.activeSourceFilter === fixture.sourceProvider &&
            value.threadTitle?.includes(fixture.threadLabel) &&
            value.threadDescription?.includes(fixture.sourceLabel) &&
            value.threadContextSummary?.includes("当前线程只包含 1 位成员") &&
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
            (text(value.threadDescription).includes(`${fixture.memberCount} 人线程`) ||
              text(value.threadDescription).includes(`当前共有 ${fixture.memberCount} 位成员`)) &&
            text(value.threadContextSummary).includes(`当前线程共有 ${fixture.memberCount} 位成员`) &&
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
          dispatchBatch: node.getAttribute("data-dispatch-batch") || "",
          dispatchMode: node.getAttribute("data-dispatch-mode") || "",
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
            text(value.policyCardMeta).includes("当前线程启动配置") &&
            text(value.policyCardGoal).includes(fixture.protocolTitle) &&
            text(value.policyCardGoal).includes(fixture.protocolSummary) &&
            !text(value.policyCardGoal).includes("最近一轮") &&
            text(value.executionCardMeta).includes("最近一轮调度结果") &&
            text(value.executionCardGoal).includes("最近一轮") &&
            value.dispatchHistoryHidden === false &&
            Number(value.dispatchHistoryCount) >= 1 &&
            Array.isArray(value.dispatchHistoryRecordIds) &&
            value.dispatchHistoryRecordIds.includes(fixture.seedRecordId) &&
            value.firstDispatchRecordId === fixture.seedRecordId &&
            Number(value.firstDispatchParallelBatchCount || 0) >= 1 &&
            text(value.dispatchHistorySummary).includes("最近展示") &&
            text(value.firstDispatchMeta).includes(fixture.seedRecordId) &&
            text(value.firstParallelChip).includes("并行批次") &&
            text(value.firstDispatchBody).includes("并行批次") &&
            Number(value.assistantSourceCount) >= 1 &&
            Array.isArray(value.assistantMessageIds) &&
            value.assistantMessageIds.some((messageId) => messageId.startsWith(`${fixture.seedRecordId}:`)) &&
            value.assistantSourceTexts.every((entry) => !/fan-out|并行|串行/.test(entry)) &&
            Number(value.assistantDispatchCount) >= 1 &&
            value.assistantDispatchBatches.some((batch) => Number.isFinite(Number(batch))) &&
            value.assistantDispatchBatches.includes("merge") &&
            value.assistantDispatchModes.includes("parallel") &&
            value.assistantDispatchModes.includes("serial") &&
            value.assistantDispatchTexts.some((entry) => /fan-out|并行|串行/.test(entry)) &&
            fixture.participantNames.every(
              (name) =>
                text(initialShellState.composerHint).includes(name) &&
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
            text(value.firstDispatchMeta).includes(fixture.seedRecordId) &&
            text(value.summaryBefore).includes("最近展示") &&
            value.firstRecordIdBefore === fixture.seedRecordId &&
            text(value.firstMetaBefore).includes(fixture.seedRecordId)
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
            text(value.firstDispatchMeta).includes(fixture.seedRecordId)
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
            text(value.firstDispatchMeta).includes(fixture.seedRecordId)
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
    const security = await getJson("/api/security", { allowAuthFallback: false });
    assert(security?.releaseReadiness && typeof security.releaseReadiness === "object", "/api/security 缺少 releaseReadiness");
    await configureSmokeBrowserLocalReasoner();
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
    const repair = await ensureRepairFixture();

    repairId = repair.repairId;
    const repairCredentials = await getJson(
      `/api/migration-repairs/${encodeURIComponent(repairId)}/credentials?didMethod=agentpassport&limit=20&sortBy=latestRepairAt&sortOrder=desc`
    );
    const credential =
      repairCredentials.credentials?.find((entry) => entry.issuerDidMethod === "agentpassport") ||
      repairCredentials.credentials?.[0] ||
      null;
    credentialId = credential?.credentialRecordId || credential?.credentialId || null;
    assert(credentialId, `repair ${repairId} 没有可用 credential`);

    const mainSummary = await runRuntimeHomeTruthCheck(expectedRuntimeHome);
    const labSummary = await runLabSecurityBoundariesCheck(expectedLabSecurityBoundaries);
    const labInvalidTokenSummary = await runLabInvalidTokenCheck();
    await seedBrowserAdminToken();
    const operatorSummary = await runOperatorTruthCheck(expectedOperator);
    await seedBrowserAdminToken();
    const repairHubSummary = await runRepairHubDeepLink(repairId, credentialId);

    await seedBrowserAdminToken();
    const offlineChatBootstrapFixture = await prepareOfflineChatBootstrapFixture();
    const offlineChatFixture = await prepareOfflineChatDeepLinkFixture(offlineChatBootstrapFixture);
    const offlineChatGroupFixture = await prepareOfflineChatGroupFixture(offlineChatBootstrapFixture);
    const offlineChatSummary = await runOfflineChatDeepLinkDom(offlineChatFixture);
    const offlineChatGroupSummary = await runOfflineChatGroupDom(offlineChatGroupFixture, offlineChatFixture);
    const operatorInvalidTokenSummary = await runOperatorInvalidTokenCheck();
    const repairHubInvalidTokenSummary = await runRepairHubInvalidTokenCheck(repairId);
    const offlineChatInvalidTokenSummary = await runOfflineChatInvalidTokenCheck();

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
          mainSummary,
          labSummary,
          labInvalidTokenSummary,
          operatorSummary,
          repairHubSummary,
          operatorInvalidTokenSummary,
          repairHubInvalidTokenSummary,
          offlineChatInvalidTokenSummary,
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

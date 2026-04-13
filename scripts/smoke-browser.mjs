import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createSmokeHttpClient } from "./smoke-ui-http.mjs";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.AGENT_PASSPORT_BASE_URL || "http://127.0.0.1:4319";
const browserName = process.env.AGENT_PASSPORT_BROWSER || "Safari";
const browserAutomationPreference =
  process.env.AGENT_PASSPORT_BROWSER_AUTOMATION ||
  (process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true" ? "webdriver" : "applescript");
const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const http = createSmokeHttpClient({ baseUrl, rootDir });
const browserJsPermissionHint = "Allow JavaScript from Apple Events";
const browserAdminTokenStorageKey = "openneed-runtime.admin-token-session";
const legacyBrowserAdminTokenStorageKey = "openneed-agent-passport.admin-token";
const webdriverBinary = process.env.AGENT_PASSPORT_BROWSER_WEBDRIVER || "safaridriver";

let browserAutomationContext = null;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

const runtimeHomePendingTexts = [
  "正在加载公开运行态…",
  "正在读取公开健康状态…",
  "正在读取 formal recovery cadence…",
  "正在读取 automatic recovery boundary…",
  "公开运行态读取波动",
  "公开健康状态读取波动",
  "正式恢复周期读取波动",
  "自动恢复边界读取波动",
];

const runtimeHomeFailureTexts = [
  "公开运行态加载失败",
  "公开健康状态读取失败",
  "正式恢复周期读取失败",
  "自动恢复边界读取失败",
];

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

function includesAnyText(value, candidates) {
  const normalized = text(value);
  return candidates.some((candidate) => normalized.includes(candidate));
}

function isRuntimeHomeFailureState(value) {
  return Boolean(
    value &&
      (includesAnyText(value.homeSummary, runtimeHomeFailureTexts) ||
        includesAnyText(value.healthSummary, runtimeHomeFailureTexts) ||
        includesAnyText(value.recoverySummary, runtimeHomeFailureTexts) ||
        includesAnyText(value.automationSummary, runtimeHomeFailureTexts))
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

async function getJson(path) {
  try {
    return await http.publicGetJson(path);
  } catch (error) {
    if (!String(error.message || error).includes("HTTP 401")) {
      throw error;
    }
  }
  return http.getJson(path);
}

function buildExpectedRuntimeHomeView(health = {}, security = {}) {
  const cadence = security.localStorageFormalFlow?.operationalCadence || null;
  const automationBoundary = security.automaticRecovery?.operatorBoundary || null;
  const triggerLabels = Array.isArray(cadence?.rerunTriggers)
    ? cadence.rerunTriggers
        .slice(0, 3)
        .map((entry) => text(entry?.label) || "未命名触发条件")
    : [];
  return {
    healthSummary: health.ok
      ? `服务可达，默认绑定 ${security.hostBinding || health.hostBinding || "127.0.0.1"}。`
      : "健康探测未通过。",
    healthDetail: `当前安全姿态：${text(security.securityPosture?.mode) || "unknown"}。${
      text(security.securityPosture?.summary) || "尚无额外摘要。"
    }`,
    recoverySummary:
      text(cadence?.summary) ||
      text(security.localStorageFormalFlow?.summary) ||
      "尚未读取 formal recovery 状态。",
    recoveryDetail:
      text(cadence?.actionSummary) ||
      text(security.localStorageFormalFlow?.runbook?.nextStepSummary) ||
      "尚未读取下一步。",
    automationSummary:
      text(automationBoundary?.summary) ||
      text(security.automaticRecovery?.summary) ||
      "尚未读取 automatic recovery 边界。",
    automationDetail:
      text(security.automaticRecovery?.summary) ||
      text(automationBoundary?.summary) ||
      "当前没有额外自动化边界摘要。",
    triggerLabels: triggerLabels.length ? triggerLabels : ["当前没有额外触发条件。"],
    runtimeLinks: ["/operator", "/offline-chat", "/lab.html", "/repair-hub", "/api/security", "/api/health"],
    homeSummary: `公开运行态已加载：姿态 ${text(security.securityPosture?.mode) || "unknown"}，正式恢复 ${
      text(security.localStorageFormalFlow?.status) || "unknown"
    }，自动恢复 ${text(security.automaticRecovery?.status) || "unknown"}。`,
  };
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
    const expectedParams = Object.fromEntries(
      Array.from(target.searchParams.entries()).filter(([key]) => key !== "credentialId")
    );
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
  return withBrowserDocument(`${baseUrl}/offline-chat`, async () => {
    await waitForReady("浏览器鉴权预热");
    return waitForJson(
      `(() => {
        sessionStorage.setItem(${JSON.stringify(browserAdminTokenStorageKey)}, ${JSON.stringify(adminToken)});
        localStorage.setItem(${JSON.stringify(legacyBrowserAdminTokenStorageKey)}, ${JSON.stringify(adminToken)});
        return {
          stored: sessionStorage.getItem(${JSON.stringify(browserAdminTokenStorageKey)}) || "",
          legacyStored: localStorage.getItem(${JSON.stringify(legacyBrowserAdminTokenStorageKey)}) || "",
          origin: window.location.origin || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.stored === adminToken &&
            value.legacyStored === adminToken &&
            value.origin === new URL(baseUrl).origin
        ),
      "浏览器鉴权预热"
    );
  });
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
        reason: "Safari JavaScript automation ready",
      };
    } catch (error) {
      if (!String(error.message || error).includes("Allow JavaScript from Apple Events")) {
        throw error;
      }
      await waitForTextSnapshot(
        (snapshot) => normalizeVisibleText(snapshot.text).includes("OpenNeed 记忆稳态引擎离线聊天"),
        "浏览器文本能力探测"
      );
      return {
        mode: "text-fallback",
        reason: error.message,
      };
    }
  });
}

async function prepareOfflineChatDeepLinkFixture() {
  const bootstrap = await getJson("/api/offline-chat/bootstrap");
  const directThread =
    bootstrap.threads?.find((entry) => entry?.threadKind === "direct" && entry?.threadId) || null;
  assert(directThread?.threadId, "没有可用的 offline-chat 单聊线程，无法执行 deep-link 浏览器回归");

  const messageToken = `smoke-browser-deeplink-${Date.now()}`;
  const sendResult = await requestJson(`/api/offline-chat/threads/${encodeURIComponent(directThread.threadId)}/messages`, {
    method: "POST",
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
  const resolvedLabel =
    filteredHistory?.sourceSummary?.providers?.find((entry) => entry?.provider === sourceProvider)?.label ||
    sourceLabel ||
    sourceProvider;
  assert(filteredHistory?.counts?.filteredAssistantMessages >= 1, "offline-chat 来源筛选没有命中任何 assistant 消息");

  return {
    threadId: directThread.threadId,
    threadLabel: directThread.label || directThread.displayName || directThread.threadId,
    sourceProvider,
    sourceLabel: resolvedLabel,
    filteredAssistantMessages: filteredHistory.counts.filteredAssistantMessages,
  };
}

async function prepareOfflineChatGroupFixture() {
  const bootstrap = await getJson("/api/offline-chat/bootstrap");
  const groupThread = bootstrap.threads?.find((entry) => entry?.threadId === "group") || null;
  assert(groupThread?.threadId === "group", "没有可用的 offline-chat 群聊线程，无法执行群聊浏览器回归");
  const participantNames = Array.isArray(groupThread?.participants)
    ? groupThread.participants.map((entry) => text(entry?.displayName)).filter(Boolean)
    : [];
  assert(participantNames.length === Number(groupThread?.memberCount || 0), "offline-chat 群聊成员真值不完整，无法执行浏览器回归");
  return {
    threadId: "group",
    memberCount: Number(groupThread.memberCount || 0),
    participantNames,
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
        issuerAgentId: "agent_openneed_agents",
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
      return waitForJson(
        `({
          locationSearch: window.location.search,
          homeSummary: document.getElementById("runtime-home-summary")?.textContent || "",
          healthSummary: document.getElementById("runtime-health-summary")?.textContent || "",
          healthDetail: document.getElementById("runtime-health-detail")?.textContent || "",
          recoverySummary: document.getElementById("runtime-recovery-summary")?.textContent || "",
          recoveryDetail: document.getElementById("runtime-recovery-detail")?.textContent || "",
          automationSummary: document.getElementById("runtime-automation-summary")?.textContent || "",
          automationDetail: document.getElementById("runtime-automation-detail")?.textContent || "",
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
    }
  );
}

async function runRepairHubDeepLink(repairId, credentialId) {
  return withBrowserDocument(
    `${baseUrl}/repair-hub?agentId=agent_openneed_agents&repairId=${encodeURIComponent(repairId)}&credentialId=${encodeURIComponent(credentialId)}&didMethod=agentpassport`,
    async () => {
      await waitForReady("修复中心深链");
      return waitForJson(
        `({
          mainLinkHref: document.getElementById("open-main-context")?.href || "",
          authSummary: document.getElementById("repair-hub-auth-summary")?.textContent || "",
          tokenInputPresent: Boolean(document.getElementById("repair-hub-admin-token-input")),
          selectedCredentialSummary: document.getElementById("selected-credential-summary")?.textContent || "",
          selectedCredentialJson: document.getElementById("selected-credential-json")?.textContent || "",
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
              value.selectedCredentialJson?.includes(credentialId) &&
              value.selectedRepairId === repairId
          ),
        "修复中心深链",
        {
          timeoutMs: 30000,
        }
      );
    }
  );
}

async function runOfflineChatDeepLinkDom(fixture) {
  return withBrowserDocument(buildOfflineChatDeepLinkUrl(fixture), async () => {
    await waitForReady("Offline Chat 深链");
    return waitForJson(
      `(() => {
        const activeThread = document.querySelector(".thread-button.active");
        const activeSource = document.querySelector(".source-filter-button.active");
        const assistantSources = Array.from(document.querySelectorAll(".message.assistant .message-source")).map((node) => (node.textContent || "").trim());
        const threadContextNames = Array.from(document.querySelectorAll("#thread-context-list .thread-context-name")).map((node) => (node.textContent || "").trim());
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
          messageCount: document.querySelectorAll("#messages .message").length,
          assistantSourceCount: assistantSources.length,
          assistantSourceTexts: assistantSources
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
            value.assistantSourceCount >= 1 &&
            value.assistantSourceTexts.every(
              (entry) => entry.includes(fixture.sourceLabel) || entry.includes(fixture.sourceProvider)
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

async function runOfflineChatGroupDom(fixture) {
  return withBrowserDocument(`${baseUrl}/offline-chat?threadId=group`, async () => {
    await waitForReady("Offline Chat 群聊真值");
    return waitForJson(
      `(() => {
        const activeThread = document.querySelector(".thread-button.active");
        const threadContextNames = Array.from(document.querySelectorAll("#thread-context-list .thread-context-name")).map((node) => (node.textContent || "").trim());
        return {
          locationSearch: window.location.search,
          activeThreadId: activeThread?.getAttribute("data-thread-id") || "",
          threadTitle: document.getElementById("thread-title")?.textContent || "",
          threadDescription: document.getElementById("thread-description")?.textContent || "",
          composerHint: document.getElementById("composer-hint")?.textContent || "",
          threadContextSummary: document.getElementById("thread-context-summary")?.textContent || "",
          threadContextNames
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
            fixture.participantNames.every(
              (name) =>
                text(value.composerHint).includes(name) &&
                Array.isArray(value.threadContextNames) &&
                value.threadContextNames.includes(name)
            )
        ),
      "Offline Chat 群聊真值",
      {
        timeoutMs: 30000,
      }
    );
  });
}

async function main() {
  try {
    if (browserAutomationPreference !== "webdriver") {
      await runAppleScript([`tell application ${JSON.stringify(browserName)} to return version`]);
    }

    const health = await getJson("/api/health");
    assert(health.ok === true, "health.ok 不是 true");
    const security = await getJson("/api/security");
    const expectedRuntimeHome = buildExpectedRuntimeHomeView(health, security);
    const browserAutomation = await detectBrowserAutomationMode();
    assert(
      browserAutomation.mode === "dom",
      `smoke:browser merge gate 需要 Safari DOM automation；当前不可用：${browserAutomation.reason}`
    );

    let repairId = null;
    let credentialId = null;
    await seedBrowserAdminToken();
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
    const repairHubSummary = await runRepairHubDeepLink(repairId, credentialId);

    const offlineChatFixture = await prepareOfflineChatDeepLinkFixture();
    const offlineChatGroupFixture = await prepareOfflineChatGroupFixture();
    const offlineChatSummary = await runOfflineChatDeepLinkDom(offlineChatFixture);
    const offlineChatGroupSummary = await runOfflineChatGroupDom(offlineChatGroupFixture);

    console.log(
      JSON.stringify(
        {
          ok: true,
          browser: browserName,
          baseUrl,
          browserAutomation,
          repairId,
          credentialId,
          mainSummary,
          repairHubSummary,
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
    await closeBrowserAutomation();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        browser: browserName,
        baseUrl,
        error: error.message,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});

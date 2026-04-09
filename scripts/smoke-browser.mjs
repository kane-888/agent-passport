import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createSmokeHttpClient } from "./smoke-ui-http.mjs";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.AGENT_PASSPORT_BASE_URL || "http://127.0.0.1:4319";
const browserName = process.env.AGENT_PASSPORT_BROWSER || "Safari";
const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const http = createSmokeHttpClient({ baseUrl, rootDir });
const browserJsPermissionHint = "Allow JavaScript from Apple Events";
const browserAdminTokenStorageKey = "openneed-agent-passport.admin-token";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
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

function isBrowserJavaScriptPermissionError(error) {
  return String(error?.message || error || "").includes(browserJsPermissionHint);
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

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
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
  return runAppleScript([
    `tell application ${JSON.stringify(browserName)}`,
    '  if (count of windows) is 0 then return ""',
    "  return URL of front document",
    "end tell",
  ]);
}

async function frontBrowserDocumentText() {
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

async function waitForJson(expression, predicate, label) {
  const startedAt = Date.now();
  let latest = null;

  while (Date.now() - startedAt < 20000) {
    try {
      const raw = await browserEval(
        `(() => { try { return JSON.stringify(${expression}); } catch (error) { return JSON.stringify({ error: String(error) }); } })()`
      );
      latest = raw ? JSON.parse(raw) : null;
      if (predicate(latest)) {
        return latest;
      }
    } catch (error) {
      if (isBrowserJavaScriptPermissionError(error)) {
        throw new Error("Safari 未开启 “Allow JavaScript from Apple Events”，无法执行 DOM 级浏览器回归。请先在 Safari 设置的 Developer 区域启用它。");
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
  assert(adminToken, "无法解析 admin token，无法执行带鉴权的浏览器深链回归");
  return withBrowserDocument(`${baseUrl}/offline-chat`, async () => {
    await waitForReady("浏览器鉴权预热");
    return waitForJson(
      `(() => {
        localStorage.setItem(${JSON.stringify(browserAdminTokenStorageKey)}, ${JSON.stringify(adminToken)});
        return {
          stored: localStorage.getItem(${JSON.stringify(browserAdminTokenStorageKey)}) || "",
          origin: window.location.origin || ""
        };
      })()`,
      (value) => Boolean(value && value.stored === adminToken && value.origin === new URL(baseUrl).origin),
      "浏览器鉴权预热"
    );
  });
}

function buildOfflineChatDeepLinkUrl(fixture) {
  return `${baseUrl}/offline-chat?threadId=${encodeURIComponent(fixture.threadId)}&sourceProvider=${encodeURIComponent(fixture.sourceProvider)}`;
}

async function detectBrowserAutomationMode() {
  return withBrowserDocument(`${baseUrl}/offline-chat`, async () => {
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
        (snapshot) => normalizeVisibleText(snapshot.text).includes("OpenNeed 离线聊天"),
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

async function runMainConsoleDeepLink(repairId, credentialId) {
  const search = new URLSearchParams({
    agentId: "agent_openneed_agents",
    didMethod: "agentpassport",
    windowId: "window_demo_1",
    repairId,
    credentialId,
    compareLeftAgentId: "agent_openneed_agents",
    compareRightAgentId: "agent_treasury",
    compareIssuerAgentId: "agent_treasury",
    compareIssuerDidMethod: "agentpassport",
  });
  return withBrowserDocument(
    `${baseUrl}/?${search.toString()}`,
    async () => {
      await waitForReady("主控制台深链");
      return waitForJson(
        `({
          locationSearch: window.location.search,
          repairSummary: document.getElementById("credential-repair-context-summary")?.textContent || "",
          repairDetail: document.getElementById("credential-repair-context-detail")?.textContent || "",
          credentialPayload: document.getElementById("credential")?.textContent || "",
          compareLeft: document.getElementById("compare-left-agent-id")?.value || "",
          repairHubEnabled: !document.getElementById("credential-repair-context-hub")?.disabled
        })`,
        (value) =>
          Boolean(
            value &&
              value.repairSummary?.includes(repairId) &&
              value.credentialPayload?.includes(credentialId) &&
              value.compareLeft === "agent_openneed_agents" &&
              value.repairHubEnabled === true
          ),
        "主控制台深链"
      );
    }
  );
}

async function runRepairHubDeepLink(repairId, credentialId) {
  return withBrowserDocument(
    `${baseUrl}/repair-hub?agentId=agent_openneed_agents&repairId=${encodeURIComponent(repairId)}&credentialId=${encodeURIComponent(credentialId)}&didMethod=agentpassport`,
    async () => {
      await waitForReady("Repair Hub 深链");
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
              value.authSummary?.includes("已保存 admin token") &&
              value.mainLinkHref?.includes(`repairId=${encodeURIComponent(repairId)}`) &&
              value.mainLinkHref?.includes(`credentialId=${encodeURIComponent(credentialId)}`) &&
              value.selectedCredentialSummary &&
              value.selectedCredentialSummary !== "尚未选中 credential" &&
              value.selectedCredentialJson?.includes(credentialId) &&
              value.selectedRepairId === repairId
          ),
        "Repair Hub 深链"
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
        return {
          locationSearch: window.location.search,
          activeThreadId: activeThread?.getAttribute("data-thread-id") || "",
          activeSourceFilter: activeSource?.getAttribute("data-source-filter") || "",
          activeSourceLabel: activeSource?.querySelector(".source-filter-label")?.textContent || "",
          threadTitle: document.getElementById("thread-title")?.textContent || "",
          threadDescription: document.getElementById("thread-description")?.textContent || "",
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
            value.sourceSummary?.includes(fixture.sourceLabel) &&
            value.assistantSourceCount >= 1 &&
            value.assistantSourceTexts.every(
              (entry) => entry.includes(fixture.sourceLabel) || entry.includes(fixture.sourceProvider)
            )
        ),
      "Offline Chat 深链"
    );
  });
}

async function runOfflineChatDeepLinkTextFallback(fixture) {
  return withBrowserDocument(buildOfflineChatDeepLinkUrl(fixture), async () => {
    const summary = await waitForTextSnapshot((snapshot) => {
      const visible = normalizeVisibleText(snapshot.text);
      const hasThreadDescription = visible.includes(normalizeVisibleText(`当前是与 ${fixture.threadLabel} 的单独对话`));
      const hasSourceLabel =
        visible.includes(normalizeVisibleText(fixture.sourceLabel)) ||
        visible.includes(normalizeVisibleText(fixture.sourceProvider));
      const hasSourceSummary =
        visible.includes(normalizeVisibleText(`当前只显示「${fixture.sourceLabel}」来源，共 ${fixture.filteredAssistantMessages} 条。`)) ||
        visible.includes(normalizeVisibleText(`当前只显示「${fixture.sourceProvider}」来源，共 ${fixture.filteredAssistantMessages} 条。`));
      const hasSourceMarker =
        visible.includes(normalizeVisibleText(`${fixture.sourceLabel} · ${fixture.sourceProvider}`)) ||
        visible.includes(normalizeVisibleText(fixture.sourceProvider));

      return (
        browserUrlHasExpectedParams(snapshot.url, {
          threadId: fixture.threadId,
          sourceProvider: fixture.sourceProvider,
        }) &&
        visible.includes(normalizeVisibleText(fixture.threadLabel)) &&
        hasThreadDescription &&
        hasSourceLabel &&
        hasSourceSummary &&
        hasSourceMarker
      );
    }, "Offline Chat 深链（文本回退）");

    return {
      mode: "text-fallback",
      currentUrl: summary.url,
      textPreview: summarizeVisibleText(summary.text),
      threadId: fixture.threadId,
      sourceProvider: fixture.sourceProvider,
      sourceLabel: fixture.sourceLabel,
      filteredAssistantMessages: fixture.filteredAssistantMessages,
    };
  });
}

async function main() {
  await runAppleScript([`tell application ${JSON.stringify(browserName)} to return version`]);

  const health = await getJson("/api/health");
  assert(health.ok === true, "health.ok 不是 true");
  const browserAutomation = await detectBrowserAutomationMode();

  let repairId = null;
  let credentialId = null;
  let mainSummary = {
    skipped: true,
    reason: "DOM automation not attempted",
  };
  let repairHubSummary = {
    skipped: true,
    reason: "DOM automation not attempted",
  };

  if (browserAutomation.mode === "dom") {
    await seedBrowserAdminToken();
    const repairs = await getJson("/api/migration-repairs?agentId=agent_openneed_agents&didMethod=agentpassport&limit=5");
    const repair = repairs.repairs?.[0] || null;
    assert(repair?.repairId, "没有可用 repair 记录，无法执行浏览器级回归");

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

    mainSummary = await runMainConsoleDeepLink(repairId, credentialId);
    repairHubSummary = await runRepairHubDeepLink(repairId, credentialId);
  } else {
    mainSummary = {
      skipped: true,
      reason: browserAutomation.reason,
    };
    repairHubSummary = {
      skipped: true,
      reason: browserAutomation.reason,
    };
  }

  const offlineChatFixture = await prepareOfflineChatDeepLinkFixture();
  const offlineChatSummary =
    browserAutomation.mode === "dom"
      ? await runOfflineChatDeepLinkDom(offlineChatFixture)
      : await runOfflineChatDeepLinkTextFallback(offlineChatFixture);

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
      },
      null,
      2
    )
  );
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

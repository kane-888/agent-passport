import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.AGENT_PASSPORT_BASE_URL || "http://127.0.0.1:4319";
const browserName = process.env.AGENT_PASSPORT_BROWSER || "Safari";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}`);
  }
  return response.json();
}

async function runAppleScript(lines) {
  const args = [];
  for (const line of lines) {
    args.push("-e", line);
  }

  const { stdout, stderr } = await execFileAsync("osascript", args, {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
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
  await runAppleScript([
    `set targetUrl to ${JSON.stringify(url)}`,
    `tell application ${JSON.stringify(browserName)}`,
    "  activate",
    "  make new document with properties {URL:targetUrl}",
    "end tell",
  ]);
}

async function frontBrowserDocumentUrl() {
  return runAppleScript([
    `tell application ${JSON.stringify(browserName)}`,
    '  if (count of documents) is 0 then return ""',
    "  return URL of front document",
    "end tell",
  ]);
}

async function closeBrowserDocument() {
  await runAppleScript([
    `tell application ${JSON.stringify(browserName)}`,
    '  if (count of documents) is greater than 0 then close front document',
    "end tell",
  ]);
}

async function waitForFrontDocumentUrl(targetUrl, label) {
  const startedAt = Date.now();
  let latestUrl = "";

  while (Date.now() - startedAt < 20000) {
    try {
      latestUrl = await frontBrowserDocumentUrl();
      if (latestUrl && latestUrl.startsWith(targetUrl.split("#")[0])) {
        return latestUrl;
      }
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
      if (String(error.message || error).includes("Allow JavaScript from Apple Events")) {
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
      latest = { error: error.message };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`${label} 未达到预期状态: ${JSON.stringify(latest)}`);
}

async function withBrowserDocument(url, fn) {
  await openBrowserDocument(url);
  try {
    await waitForFrontDocumentUrl(url, url);
    await waitForReady(url);
    return await fn(url);
  } finally {
    try {
      await closeBrowserDocument();
    } catch {}
  }
}

async function main() {
  await runAppleScript([`tell application ${JSON.stringify(browserName)} to return version`]);

  const health = await getJson("/api/health");
  assert(health.ok === true, "health.ok 不是 true");

  const repairs = await getJson("/api/migration-repairs?agentId=agent_openneed_agents&didMethod=agentpassport&limit=5");
  const repair = repairs.repairs?.[0] || null;
  assert(repair?.repairId, "没有可用 repair 记录，无法执行浏览器级回归");

  const repairId = repair.repairId;
  const repairCredentials = await getJson(
    `/api/migration-repairs/${encodeURIComponent(repairId)}/credentials?didMethod=agentpassport&limit=20&sortBy=latestRepairAt&sortOrder=desc`
  );
  const credential =
    repairCredentials.credentials?.find((entry) => entry.issuerDidMethod === "agentpassport") ||
    repairCredentials.credentials?.[0] ||
    null;
  const credentialId = credential?.credentialRecordId || credential?.credentialId || null;
  assert(credentialId, `repair ${repairId} 没有可用 credential`);

  const mainSummary = await withBrowserDocument(
    `${baseUrl}/?repairId=${encodeURIComponent(repairId)}&credentialId=${encodeURIComponent(credentialId)}&compareLeftAgentId=agent_openneed_agents&compareRightAgentId=agent_treasury&compareIssuerAgentId=agent_treasury&compareIssuerDidMethod=agentpassport`,
    async () =>
      waitForJson(
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
      )
  );

  const repairHubSummary = await withBrowserDocument(
    `${baseUrl}/repair-hub?agentId=agent_openneed_agents&repairId=${encodeURIComponent(repairId)}&credentialId=${encodeURIComponent(credentialId)}&didMethod=agentpassport`,
    async () =>
      waitForJson(
        `({
          mainLinkHref: document.getElementById("open-main-context")?.href || "",
          selectedCredentialSummary: document.getElementById("selected-credential-summary")?.textContent || "",
          selectedCredentialJson: document.getElementById("selected-credential-json")?.textContent || "",
          selectedRepairId: new URL(window.location.href).searchParams.get("repairId") || ""
        })`,
        (value) =>
          Boolean(
            value &&
              value.mainLinkHref?.includes(`repairId=${encodeURIComponent(repairId)}`) &&
              value.mainLinkHref?.includes(`credentialId=${encodeURIComponent(credentialId)}`) &&
              value.selectedCredentialSummary &&
              value.selectedCredentialSummary !== "尚未选中 credential" &&
              value.selectedCredentialJson?.includes(credentialId) &&
              value.selectedRepairId === repairId
          ),
        "Repair Hub 深链"
      )
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        browser: browserName,
        baseUrl,
        repairId,
        credentialId,
        mainSummary,
        repairHubSummary,
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

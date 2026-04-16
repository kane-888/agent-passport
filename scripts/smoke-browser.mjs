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
  (process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true" ? "webdriver" : "auto");
const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const http = createSmokeHttpClient({ baseUrl, rootDir });
const browserJsPermissionHint = "Allow JavaScript from Apple Events";
const browserAdminTokenStorageKey = "agent-passport.admin-token-session";
const legacyBrowserAdminTokenSessionStorageKey = "openneed-runtime.admin-token-session";
const legacyBrowserAdminTokenLocalStorageKey = "openneed-agent-passport.admin-token";
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

const statusText = {
  normal: "正常",
  read_only: "只读",
  disable_exec: "禁执行",
  panic: "紧急锁定",
  ready: "已就绪",
  partial: "部分就绪",
  blocked: "被阻塞",
  missing: "缺失",
  overdue: "已过期",
  due_soon: "即将到期",
  within_window: "窗口内",
  optional_ready: "可选但已保留",
  optional_missing: "可选但缺失",
  bounded: "有界放行",
  restricted: "最小权限",
  degraded: "已退化",
  locked: "已锁定",
  armed: "可启动",
  armed_with_gaps: "可启动但有缺口",
  gated: "被门禁拦截",
  ready_for_rehearsal: "可开始演练",
  protected: "已受保护",
  enforced: "已强制启用",
  pending: "处理中",
  passed: "已通过",
};

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

function statusLabel(value) {
  const normalized = text(value);
  return statusText[normalized] || (normalized ? normalized.replaceAll("_", " ") : "未确认");
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
  const handbook = security.securityArchitecture?.operatorHandbook || null;
  const triggerLabels = Array.isArray(cadence?.rerunTriggers)
    ? cadence.rerunTriggers
        .slice(0, 3)
        .map((entry) => text(entry?.label) || "未命名触发条件")
    : [];
  return {
    healthSummary: health.ok
      ? `服务可达，默认绑定 ${security.hostBinding || health.hostBinding || "127.0.0.1"}。`
      : "健康探测未通过。",
    healthDetail: `当前安全姿态：${statusLabel(security.securityPosture?.mode)}。${
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
    operatorEntrySummary: text(handbook?.summary) || "按固定顺序收口值班判断。",
    triggerLabels: triggerLabels.length ? triggerLabels : ["当前没有额外触发条件。"],
    runtimeLinks: ["/operator", "/offline-chat", "/lab.html", "/repair-hub", "/api/security", "/api/health"],
    homeSummary: `公开运行态已加载：姿态 ${statusLabel(security.securityPosture?.mode)}，正式恢复 ${
      statusLabel(security.localStorageFormalFlow?.status)
    }，自动恢复 ${statusLabel(security.automaticRecovery?.status)}。`,
  };
}

function buildExpectedLabSecurityBoundariesView(security = {}) {
  const storeEncryption = security?.localStorageFormalFlow?.storeEncryption || null;
  const formalRecovery = security?.localStorageFormalFlow || null;
  const constrainedExecution = security?.constrainedExecution || null;
  const automaticRecovery = security?.automaticRecovery || null;

  return {
    summary: `已读取公开安全与恢复边界：本地存储 ${statusLabel(storeEncryption?.status)}，正式恢复 ${statusLabel(formalRecovery?.status)}，受限执行 ${statusLabel(constrainedExecution?.status)}，自动恢复 ${statusLabel(automaticRecovery?.status)}。`,
    localStoreSummary:
      storeEncryption?.status === "protected"
        ? storeEncryption?.systemProtected === true
          ? "本地账本与密钥已进入系统保护层。"
          : "本地账本已加密，但系统保护层还没完全到位。"
        : "本地账本与密钥还没达到受保护状态。",
    localStoreDetails: [
      `状态：${statusLabel(storeEncryption?.status)}`,
      `系统保护：${boolLabel(storeEncryption?.systemProtected, { trueLabel: "已启用", falseLabel: "未启用" })}`,
      `恢复基线：${boolLabel(security?.localStore?.recoveryBaselineReady, { trueLabel: "已就绪", falseLabel: "未就绪" })}`,
    ],
    formalRecoverySummary: textOr(formalRecovery?.summary, "当前没有正式恢复摘要。"),
    formalRecoveryDetails: [
      `状态：${statusLabel(formalRecovery?.status)}`,
      `下一步：${textOr(formalRecovery?.runbook?.nextStepLabel)}`,
      `周期：${statusLabel(formalRecovery?.operationalCadence?.status)}`,
    ],
    constrainedExecutionSummary: textOr(constrainedExecution?.summary, "当前没有受限执行摘要。"),
    constrainedExecutionDetails: [
      `状态：${statusLabel(constrainedExecution?.status)}`,
      `系统级调度沙箱：${statusLabel(constrainedExecution?.systemBrokerSandbox?.status)}`,
      `预算/能力：${textOr(constrainedExecution?.systemBrokerSandbox?.summary, "当前没有额外摘要。")}`,
    ],
    automaticRecoverySummary: textOr(automaticRecovery?.summary, "当前没有自动恢复边界摘要。"),
    automaticRecoveryDetails: [
      `状态：${statusLabel(automaticRecovery?.status)}`,
      `正式恢复已达标：${boolLabel(automaticRecovery?.operatorBoundary?.formalFlowReady, { trueLabel: "是", falseLabel: "否" })}`,
      `值班边界：${textOr(automaticRecovery?.operatorBoundary?.summary, "当前没有值班边界摘要。")}`,
    ],
  };
}

function buildExpectedOperatorAlerts(security = {}, setup = {}) {
  const releaseReadiness = getReleaseReadiness(security);
  const readinessAlerts = buildExpectedReleaseReadinessAlerts(releaseReadiness);
  if (readinessAlerts.length > 0) {
    return readinessAlerts;
  }
  const alerts = [];
  const posture = security?.securityPosture || null;
  const cadence =
    setup?.formalRecoveryFlow?.operationalCadence ||
    security?.localStorageFormalFlow?.operationalCadence ||
    null;
  const automaticBoundary =
    setup?.automaticRecoveryReadiness?.operatorBoundary ||
    security?.automaticRecovery?.operatorBoundary ||
    null;
  const constrained =
    setup?.deviceRuntime?.constrainedExecutionSummary ||
    security?.constrainedExecution ||
    null;
  const crossDevice =
    setup?.formalRecoveryFlow?.crossDeviceRecoveryClosure ||
    security?.localStorageFormalFlow?.crossDeviceRecoveryClosure ||
    null;

  if (posture?.mode && posture.mode !== "normal") {
    alerts.push({
      title: `安全姿态已提升到 ${statusLabel(posture.mode)}`,
    });
  }
  if (["missing", "overdue", "due_soon"].includes(cadence?.status)) {
    alerts.push({
      title: `正式恢复周期 ${statusLabel(cadence.status)}`,
    });
  }
  if (automaticBoundary?.formalFlowReady === false) {
    alerts.push({
      title: "自动恢复不能冒充正式恢复完成",
    });
  }
  if (["degraded", "locked"].includes(constrained?.status)) {
    alerts.push({
      title: `受限执行层 ${statusLabel(constrained.status)}`,
    });
  }
  if (crossDevice?.readyForCutover === false) {
    alerts.push({
      title: crossDevice?.readyForRehearsal ? "跨机器恢复现在只能做演练" : "跨机器恢复还不能开始",
    });
  }
  return alerts;
}

function getReleaseReadiness(security = {}) {
  const readiness = security?.releaseReadiness;
  return readiness && typeof readiness === "object" ? readiness : null;
}

function buildExpectedReleaseReadinessAlerts(releaseReadiness = null) {
  const blockedBy = Array.isArray(releaseReadiness?.blockedBy) ? releaseReadiness.blockedBy.filter(Boolean) : [];
  return blockedBy.map((entry) => ({
    title: text(entry?.label) || "未命名放行检查",
  }));
}

function buildExpectedOperatorNextAction(security = {}, setup = {}) {
  const releaseReadiness = getReleaseReadiness(security);
  if (text(releaseReadiness?.nextAction)) {
    return text(releaseReadiness.nextAction);
  }
  const posture = security?.securityPosture || null;
  const constrained =
    setup?.deviceRuntime?.constrainedExecutionSummary ||
    security?.constrainedExecution ||
    null;
  const formalRecovery = setup?.formalRecoveryFlow || security?.localStorageFormalFlow || null;
  const crossDevice = formalRecovery?.crossDeviceRecoveryClosure || null;
  const cadence = formalRecovery?.operationalCadence || null;

  if (posture?.mode && posture.mode !== "normal") {
    return `先按 ${statusLabel(posture.mode)} 姿态锁边界并保全 /api/security 与 /api/device/setup。`;
  }
  if (["degraded", "locked"].includes(constrained?.status)) {
    return "先停真实执行，查清受限执行为什么退化。";
  }
  if (formalRecovery?.runbook?.nextStepLabel && formalRecovery?.durableRestoreReady === false) {
    return `先补正式恢复主线：${formalRecovery.runbook.nextStepLabel}。`;
  }
  if (crossDevice?.readyForRehearsal === false && crossDevice?.nextStepLabel) {
    return `先收口跨机器恢复前置条件：${crossDevice.nextStepLabel}。`;
  }
  if (crossDevice?.readyForRehearsal) {
    return "源机器已就绪；下一步去目标机器按固定顺序导入恢复包、初始化包并核验。";
  }
  if (cadence?.actionSummary) {
    return cadence.actionSummary;
  }
  return "当前没有硬阻塞；继续巡检正式恢复、受限执行和跨机器恢复。";
}

function buildExpectedOperatorView(security = {}, setup = {}) {
  const releaseReadiness = getReleaseReadiness(security);
  const posture = security?.securityPosture || null;
  const formalRecovery = setup?.formalRecoveryFlow || security?.localStorageFormalFlow || null;
  const cadence = formalRecovery?.operationalCadence || null;
  const constrained =
    setup?.deviceRuntime?.constrainedExecutionSummary ||
    security?.constrainedExecution ||
    null;
  const crossDevice = formalRecovery?.crossDeviceRecoveryClosure || null;
  const handbook = security?.securityArchitecture?.operatorHandbook || null;
  const handoffFields = Array.isArray(formalRecovery?.handoffPacket?.requiredFields)
    ? formalRecovery.handoffPacket.requiredFields
    : [];
  const alerts = buildExpectedOperatorAlerts(security, setup);

  return {
    authSummary: "当前标签页已保存管理令牌；operator 会自动读取受保护恢复真值。",
    protectedStatus: "已读取受保护恢复真值；切机闭环、执行边界和设备细节已对齐。",
    exportSummary: "导出动作现在由 /api/security/incident-packet/export 一次性生成，并在 resident agent 下留一条导出记录。",
    exportStatus: "当前可以导出事故交接包。",
    sequenceSummary: text(handbook?.summary) || "先锁边界，再补正式恢复，再判断能不能继续执行或切机。",
    standardActionsSummary:
      text(handbook?.standardActionsSummary) || "遇到高风险异常时，先执行标准动作，不要临场拼流程。",
    handoffSummary:
      text(formalRecovery?.handoffPacket?.summary) || "正在根据当前恢复真值整理交接最小信息集。",
    decisionSummary:
      text(releaseReadiness?.summary) ||
      (alerts.length > 0 ? `当前先处理 ${alerts[0].title}。` : "当前没有硬阻塞；以巡检和演练准备为主。"),
    nextAction: buildExpectedOperatorNextAction(security, setup),
    postureTitle: posture?.mode
      ? `${statusLabel(posture.mode)} / ${text(posture.summary) || "姿态摘要缺失"}`
      : "公开姿态真值缺失",
    recoveryTitle: `${statusLabel(formalRecovery?.status)} / ${
      text(cadence?.summary) || text(formalRecovery?.summary) || "暂无恢复摘要"
    }`,
    execTitle: `${statusLabel(constrained?.status)} / ${text(constrained?.summary) || "暂无受限执行摘要"}`,
    crossDeviceTitle: crossDevice
      ? `${statusLabel(crossDevice.status)} / ${text(crossDevice.summary) || "暂无跨机器恢复摘要"}`
      : "当前还没有跨机器恢复闭环真值",
    crossDeviceGate: crossDevice
      ? crossDevice.readyForRehearsal
        ? "源机器已就绪，但还不能宣称可切机"
        : `当前先 ${text(crossDevice.nextStepLabel) || "补齐前置条件"}`
      : "需要受保护设备恢复真值",
    rolesCount: Array.isArray(handbook?.roles) ? handbook.roles.length : 0,
    decisionSequenceCount: Array.isArray(handbook?.decisionSequence) ? handbook.decisionSequence.length : 0,
    standardActionsCount: Array.isArray(handbook?.standardActions) ? handbook.standardActions.length : 0,
    handoffFieldCount: handoffFields.length,
    handoffFieldTitles: handoffFields.map(
      (field) => `${text(field?.label) || "未命名交接字段"} · ${statusLabel(field?.status)}`
    ),
    handoffFieldDetails: handoffFields.map((field) => text(field?.value) || "未确认"),
    alertsCount: alerts.length,
    stepsCount: Array.isArray(crossDevice?.steps) ? crossDevice.steps.length : 0,
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
  const threadStartup = bootstrap.threadStartup?.phase_1 || null;
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
    body: JSON.stringify({
      content: `请直接推进 public/offline-chat-app.js、src/server-offline-chat-routes.js 和 README.md 的 subagent fan-out 执行态收口，要求把 thread-startup-context、group history、UI 摘要和路由边界一起对齐。 token=${seedToken}`,
    }),
  });
  const seedRecordId = seedResult?.sync?.recordId || null;
  assert(seedRecordId, "offline-chat 群聊浏览器回归种子消息没有返回 sync.recordId");
  assert(seedResult?.dispatch?.parallelAllowed === true, "offline-chat 群聊浏览器回归种子消息没有触发并行 fan-out");
  assert(
    Array.isArray(seedResult?.dispatch?.batchPlan) && seedResult.dispatch.batchPlan.some((entry) => entry?.executionMode === "parallel"),
    "offline-chat 群聊浏览器回归种子消息没有返回并行批次"
  );
  return {
    threadId: "group",
    memberCount: Number(groupThread.memberCount || 0),
    participantNames,
    protocolTitle,
    protocolSummary,
    protocolActivatedAt,
    seedToken,
    seedRecordId,
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
    }
  );
}

async function runLabSecurityBoundariesCheck(expectedLab) {
  return withBrowserDocument(`${baseUrl}/lab.html`, async () => {
    await waitForReady("运行现场安全与恢复边界");
    return waitForJson(
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
  });
}

async function runLabInvalidTokenCheck() {
  await seedBrowserToken("agent-passport-invalid-token");
  return withBrowserDocument(`${baseUrl}/lab.html`, async () => {
    await waitForReady("运行现场维护坏令牌");
    await browserEval(`(() => {
      const form = document.getElementById("runtime-housekeeping-form");
      if (typeof form?.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        document.getElementById("runtime-housekeeping-audit")?.click();
      }
      return true;
    })()`);
    return waitForJson(
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
  });
}

async function runRepairHubDeepLink(repairId, credentialId) {
  return withBrowserDocument(
    `${baseUrl}/repair-hub?agentId=agent_openneed_agents&repairId=${encodeURIComponent(repairId)}&credentialId=${encodeURIComponent(credentialId)}&didMethod=agentpassport`,
    async () => {
      await waitForReady("修复中枢深链");
      return waitForJson(
        `({
          mainLinkHref: document.getElementById("open-main-context")?.href || "",
          authSummary: document.getElementById("repair-hub-auth-summary")?.textContent || "",
          tokenInputPresent: Boolean(document.getElementById("repair-hub-admin-token-input")),
          selectedCredentialSummary: document.getElementById("selected-credential-summary")?.textContent || "",
          selectedCredentialJsonLength: (document.getElementById("selected-credential-json")?.textContent || "").length,
          selectedCredentialContainsId: (document.getElementById("selected-credential-json")?.textContent || "").includes(${JSON.stringify(credentialId)}),
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
              value.selectedRepairId === repairId
          ),
        "修复中枢深链",
        {
          timeoutMs: 30000,
        }
      );
    }
  );
}

async function runOperatorTruthCheck(expectedOperator) {
  return withBrowserDocument(`${baseUrl}/operator`, async () => {
    await waitForReady("值班决策面真值");
    await injectBrowserAdminTokenIntoCurrentDocument();
    await browserEval(`(() => {
      document.getElementById("operator-refresh")?.click();
      return true;
    })()`);
    await waitForJson(
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
    return waitForJson(
      `({
        exportStatus: document.getElementById("operator-export-status")?.textContent || "",
        exportHistoryCount: document.querySelectorAll("#operator-export-history .alert-item").length
      })`,
      (value) =>
        Boolean(
          value &&
            text(value.exportStatus).startsWith("事故交接包已导出并留档：agent-passport-incident-packet-") &&
            Number(value.exportHistoryCount) >= 1
        ),
      "值班事故交接包导出",
      {
        timeoutMs: 30000,
      }
    );
  });
}

async function runOperatorInvalidTokenCheck() {
  await seedBrowserToken("agent-passport-invalid-token");
  return withBrowserDocument(`${baseUrl}/operator`, async () => {
    await waitForReady("值班决策面坏令牌");
    return waitForJson(
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
  });
}

async function runRepairHubInvalidTokenCheck(repairId) {
  await seedBrowserToken("agent-passport-invalid-token");
  return withBrowserDocument(
    `${baseUrl}/repair-hub?agentId=agent_openneed_agents&repairId=${encodeURIComponent(repairId)}&didMethod=agentpassport`,
    async () => {
      await waitForReady("修复中枢坏令牌");
      return waitForJson(
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
        "修复中枢坏令牌",
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
            value.dispatchHistoryHidden === true &&
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

async function runOfflineChatGroupDom(fixture, directFixture) {
  return withBrowserDocument(`${baseUrl}/offline-chat?threadId=group`, async () => {
    await waitForReady("Offline Chat 群聊真值");
    const initialState = await waitForJson(
      `(() => {
        const activeThread = document.querySelector(".thread-button.active");
        const threadContextNames = Array.from(document.querySelectorAll("#thread-context-list .thread-context-name")).map((node) => (node.textContent || "").trim());
        const dispatchHistorySection = document.getElementById("dispatch-history-section");
        const firstHistoryCard = document.querySelector("#dispatch-history-list .dispatch-history-card");
        const firstParallelChip = firstHistoryCard?.querySelector(".dispatch-chip.parallel");
        const policyCardGoal = document.querySelector("#thread-context-list .thread-context-card .thread-context-goal");
        return {
          locationSearch: window.location.search,
          activeThreadId: activeThread?.getAttribute("data-thread-id") || "",
          threadTitle: document.getElementById("thread-title")?.textContent || "",
          threadDescription: document.getElementById("thread-description")?.textContent || "",
          composerHint: document.getElementById("composer-hint")?.textContent || "",
          threadContextSummary: document.getElementById("thread-context-summary")?.textContent || "",
          threadContextNames,
          dispatchHistoryHidden: dispatchHistorySection?.hidden ?? null,
          dispatchHistorySummary: document.getElementById("dispatch-history-summary")?.textContent || "",
          dispatchHistoryCount: document.querySelectorAll("#dispatch-history-list .dispatch-history-card").length,
          firstDispatchMeta: firstHistoryCard?.querySelector(".dispatch-history-meta")?.textContent || "",
          firstDispatchBody: firstHistoryCard?.querySelector(".dispatch-history-body")?.textContent || "",
          firstParallelChip: firstParallelChip?.textContent || "",
          policyCardGoal: policyCardGoal?.textContent || ""
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
            text(value.threadContextSummary).includes(fixture.protocolTitle) &&
            text(value.threadContextSummary).includes(fixture.protocolSummary) &&
            text(value.threadContextSummary).includes("协议生效时间") &&
            text(value.policyCardGoal).includes(fixture.protocolTitle) &&
            text(value.policyCardGoal).includes(fixture.protocolSummary) &&
            value.dispatchHistoryHidden === false &&
            Number(value.dispatchHistoryCount) >= 1 &&
            text(value.dispatchHistorySummary).includes("最近展示") &&
            text(value.firstDispatchMeta).includes(fixture.seedRecordId) &&
            text(value.firstParallelChip).includes("并行批次") &&
            text(value.firstDispatchBody).includes("并行批次") &&
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
          firstDispatchMeta: firstHistoryCard?.querySelector(".dispatch-history-meta")?.textContent || ""
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.activeThreadId === "group" &&
            value.dispatchHistoryHidden === false &&
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
        return {
          activeThreadId: activeThread?.getAttribute("data-thread-id") || "",
          dispatchHistoryHidden: dispatchHistorySection?.hidden ?? null,
          dispatchHistorySummary: document.getElementById("dispatch-history-summary")?.textContent || "",
          firstDispatchMeta: firstHistoryCard?.querySelector(".dispatch-history-meta")?.textContent || "",
          firstDispatchBody: firstHistoryCard?.querySelector(".dispatch-history-body")?.textContent || "",
          lastUserMessage: messages.at(-1) || "",
          sendDisabled: document.getElementById("send-button")?.disabled ?? false
        };
      })()`,
      (value) =>
        Boolean(
          value &&
            value.activeThreadId === "group" &&
            value.dispatchHistoryHidden === false &&
            text(value.dispatchHistorySummary).includes("最近展示") &&
            text(value.firstDispatchMeta).includes("记录") &&
            !text(value.firstDispatchMeta).includes(fixture.seedRecordId) &&
            text(value.firstDispatchBody).includes(browserSendToken) &&
            text(value.lastUserMessage).includes(browserSendToken) &&
            value.sendDisabled === false
        ),
      "Offline Chat 群聊发送后调度历史刷新",
      {
        timeoutMs: 60000,
      }
    );

    return {
      ...initialState,
      directState,
      refreshedState,
    };
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
    assert(security?.releaseReadiness && typeof security.releaseReadiness === "object", "/api/security 缺少 releaseReadiness");
    const setup = await getJson("/api/device/setup");
    const expectedRuntimeHome = buildExpectedRuntimeHomeView(health, security);
    const expectedLabSecurityBoundaries = buildExpectedLabSecurityBoundariesView(security);
    const expectedOperator = buildExpectedOperatorView(security, setup);
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

    const offlineChatFixture = await prepareOfflineChatDeepLinkFixture();
    const offlineChatGroupFixture = await prepareOfflineChatGroupFixture();
    const offlineChatSummary = await runOfflineChatDeepLinkDom(offlineChatFixture);
    const offlineChatGroupSummary = await runOfflineChatGroupDom(offlineChatGroupFixture, offlineChatFixture);
    const operatorInvalidTokenSummary = await runOperatorInvalidTokenCheck();
    const repairHubInvalidTokenSummary = await runRepairHubInvalidTokenCheck(repairId);

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
          labSummary,
          labInvalidTokenSummary,
          operatorSummary,
          repairHubSummary,
          operatorInvalidTokenSummary,
          repairHubInvalidTokenSummary,
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

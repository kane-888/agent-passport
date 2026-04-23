import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SANDBOX_WORKER_PATH = path.join(__dirname, "runtime-sandbox-worker.js");
const DEFAULT_SANDBOX_BROKER_TIMEOUT_MS = 2500;
const MAX_SANDBOX_BROKER_REQUEST_BYTES = 1024 * 1024;
const SYSTEM_SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";
const SYSTEM_SANDBOX_PLATFORM = "darwin";
const PROCESS_EXEC_CAPABILITIES = new Set(["process_exec", "reasoner_local_command"]);
let systemSandboxAvailabilityPromise = null;

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function normalizeOptionalText(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeCapability(value) {
  return normalizeOptionalText(value)?.toLowerCase() ?? null;
}

function escapeSeatbeltLiteral(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function quoteSeatbeltLiteral(value) {
  return `"${escapeSeatbeltLiteral(value)}"`;
}

function uniquePaths(values = []) {
  return Array.from(new Set(values.map((value) => normalizeOptionalText(value)).filter(Boolean)));
}

function uniqueIntegers(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value > 0 && value <= 65535)
    )
  ).sort((left, right) => left - right);
}

function listAbsoluteArgumentPaths(args = []) {
  if (!Array.isArray(args)) {
    return [];
  }
  return uniquePaths(
    args
      .map((entry) => normalizeOptionalText(entry))
      .filter((entry) => entry && path.isAbsolute(entry))
  );
}

function resolveNodeInstallRoot() {
  return path.dirname(path.dirname(process.execPath));
}

function resolveSandboxNetworkPorts(payload = {}) {
  const capability = normalizeCapability(payload.capability);
  if (capability !== "network_external") {
    return [];
  }
  const targetUrl = normalizeOptionalText(payload.url || payload.targetUrl);
  if (!targetUrl) {
    return [];
  }
  try {
    const parsed = new URL(targetUrl);
    if (parsed.port) {
      return uniqueIntegers([parsed.port]);
    }
    if (parsed.protocol === "https:") {
      return [443];
    }
    if (parsed.protocol === "http:") {
      return [80];
    }
  } catch {
    return [];
  }
  return [];
}

function buildSystemSandboxPlan(payload = {}, workspace = null) {
  const capability = normalizeCapability(payload.capability);
  const requested = payload.systemSandboxEnabled !== false;
  const readRoots = uniquePaths([
    resolveNodeInstallRoot(),
    path.dirname(SANDBOX_WORKER_PATH),
    workspace?.root ?? null,
    payload.allowlistedRoot,
    payload.resolvedPath,
    PROCESS_EXEC_CAPABILITIES.has(capability) && normalizeOptionalText(payload.command)
      ? path.dirname(path.resolve(payload.command))
      : null,
    payload.cwd,
    ...listAbsoluteArgumentPaths(payload.args),
  ]);
  const writeRoots = uniquePaths([
    workspace?.root ?? null,
  ]);
  const execPaths = uniquePaths([
    process.execPath,
    PROCESS_EXEC_CAPABILITIES.has(capability) ? payload.command : null,
  ]);
  const networkPorts = resolveSandboxNetworkPorts(payload);
  const networkScoped = networkPorts.length > 0;
  const processExecScoped = PROCESS_EXEC_CAPABILITIES.has(capability);
  const deniedOperations = uniquePaths([
    networkScoped ? null : "network_outbound",
    processExecScoped ? null : "process_exec",
    processExecScoped ? null : "process_fork",
    capability === "filesystem_list" || capability === "filesystem_read" ? "filesystem_write" : null,
  ]);
  const warnings = [];
  if (networkScoped) {
    warnings.push("network_rules_are_port_scoped");
  }
  return {
    requested,
    capability,
    readRoots,
    writeRoots,
    execPaths,
    networkPorts,
    networkScoped,
    processExecScoped,
    deniedOperations,
    warnings,
  };
}

function renderSeatbeltSubpathRules(paths = []) {
  return paths.map((entry) => `  (subpath ${quoteSeatbeltLiteral(entry)})`).join("\n");
}

function renderSeatbeltLiteralRules(paths = []) {
  return paths.map((entry) => `  (literal ${quoteSeatbeltLiteral(entry)})`).join("\n");
}

function buildSystemSandboxProfile(plan = {}) {
  const lines = [
    "(version 1)",
    "(deny default)",
    '(import "bsd.sb")',
  ];

  if (plan.networkScoped) {
    lines.push("(system-network)");
  }

  if (plan.readRoots.length > 0) {
    lines.push("(allow file-read*");
    lines.push(renderSeatbeltSubpathRules(plan.readRoots));
    lines.push(")");
  }

  if (plan.writeRoots.length > 0) {
    lines.push("(allow file-write*");
    lines.push(renderSeatbeltSubpathRules(plan.writeRoots));
    lines.push(")");
  }

  if (plan.processExecScoped) {
    lines.push("(allow process-fork)");
  }

  if (plan.execPaths.length > 0) {
    lines.push("(allow process-exec");
    lines.push(renderSeatbeltLiteralRules(plan.execPaths));
    lines.push(")");
  }

  if (plan.networkPorts.length > 0) {
    lines.push("(allow network-outbound");
    for (const port of plan.networkPorts) {
      lines.push(`  (remote tcp ${quoteSeatbeltLiteral(`*:${port}`)})`);
    }
    lines.push(")");
  }

  return `${lines.filter(Boolean).join("\n")}\n`;
}

async function detectSystemSandboxAvailability() {
  if (!systemSandboxAvailabilityPromise) {
    systemSandboxAvailabilityPromise = (async () => {
      if (process.platform !== SYSTEM_SANDBOX_PLATFORM) {
        return {
          available: false,
          reason: `unsupported_platform:${process.platform}`,
        };
      }
      try {
        await stat(SYSTEM_SANDBOX_EXEC_PATH);
        return {
          available: true,
          reason: "available",
        };
      } catch {
        return {
          available: false,
          reason: "sandbox_exec_missing",
        };
      }
    })();
  }
  return systemSandboxAvailabilityPromise;
}

async function prepareSystemSandbox(workspace, payload = {}) {
  const availability = await detectSystemSandboxAvailability();
  const plan = buildSystemSandboxPlan(payload, workspace);
  if (!plan.requested) {
    return {
      enabled: false,
      profilePath: null,
      command: process.execPath,
      args: [SANDBOX_WORKER_PATH],
      metadata: {
        requested: false,
        available: availability.available,
        enabled: false,
        backend: "broker_only",
        platform: process.platform,
        capability: plan.capability,
        status: "disabled",
        readRootCount: plan.readRoots.length,
        writeRootCount: plan.writeRoots.length,
        execAllowlistCount: plan.execPaths.length,
        networkPortCount: plan.networkPorts.length,
        deniedOperations: plan.deniedOperations,
        warnings: plan.warnings,
        summary: "系统级 sandbox 已关闭，当前仅保留 broker + worker 进程隔离。",
        fallbackReason: "disabled_by_policy",
      },
    };
  }
  if (!availability.available) {
    return {
      enabled: false,
      profilePath: null,
      command: process.execPath,
      args: [SANDBOX_WORKER_PATH],
      metadata: {
        requested: true,
        available: false,
        enabled: false,
        backend: "broker_only",
        platform: process.platform,
        capability: plan.capability,
        status: "unavailable",
        readRootCount: plan.readRoots.length,
        writeRootCount: plan.writeRoots.length,
        execAllowlistCount: plan.execPaths.length,
        networkPortCount: plan.networkPorts.length,
        deniedOperations: plan.deniedOperations,
        warnings: plan.warnings,
        summary: "系统级 sandbox 当前不可用，已回退到 broker + worker 进程隔离。",
        fallbackReason: availability.reason,
      },
    };
  }

  const profilePath = path.join(workspace.root, "system-sandbox.sb");
  const profile = buildSystemSandboxProfile(plan);
  await writeFile(profilePath, profile, "utf8");
  return {
    enabled: true,
    profilePath,
    command: SYSTEM_SANDBOX_EXEC_PATH,
    args: ["-f", profilePath, process.execPath, SANDBOX_WORKER_PATH],
    metadata: {
      requested: true,
      available: true,
      enabled: true,
      backend: "sandbox_exec",
      profileMode: "capability_scoped",
      platform: process.platform,
      capability: plan.capability,
      status: "enforced",
      readRootCount: plan.readRoots.length,
      writeRootCount: plan.writeRoots.length,
      execAllowlistCount: plan.execPaths.length,
      networkPortCount: plan.networkPorts.length,
      deniedOperations: plan.deniedOperations,
      warnings: plan.warnings,
      summary:
        plan.networkPorts.length > 0
          ? "系统级 sandbox 已启用，限制到 capability 相关读写面，并把网络边界收紧到端口级规则。"
          : "系统级 sandbox 已启用，限制到 capability 相关读写面，并阻断未授权网络与进程派生。",
      fallbackReason: null,
    },
  };
}

async function createBrokerWorkspace() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "openneed-memory-broker-")));
  return {
    workspaceId: path.basename(root),
    root,
  };
}

async function removeBrokerWorkspace(workspace) {
  if (!workspace?.root) {
    return {
      attempted: false,
      removed: false,
    };
  }
  try {
    await rm(workspace.root, { recursive: true, force: true });
    return {
      attempted: true,
      removed: true,
    };
  } catch {
    return {
      attempted: true,
      removed: false,
    };
  }
}

function visibleBrokerEnvKeys() {
  return Object.keys(process.env).filter((key) => key !== "__CF_USER_TEXT_ENCODING");
}

function buildBrokerMetadata({
  workspace = null,
  cleanup = null,
  workerPid = null,
  requestBytes = 0,
  durationMs = 0,
  workerStdoutBytes = 0,
  workerStderrBytes = 0,
  systemSandbox = null,
} = {}) {
  const visibleEnvKeys = visibleBrokerEnvKeys();
  return {
    boundary: "independent_process",
    brokerPid: process.pid,
    workerPid,
    brokerEnvMode: visibleEnvKeys.length === 0 ? "empty" : "custom",
    workspaceMode: workspace ? "ephemeral_root" : "none",
    workspaceId: workspace?.workspaceId ?? null,
    cwd: workspace?.root ?? process.cwd(),
    transport: "stdin_json",
    requestBytes: Math.max(0, Math.floor(Number(requestBytes || 0))),
    workerStdoutBytes: Math.max(0, Math.floor(Number(workerStdoutBytes || 0))),
    workerStderrBytes: Math.max(0, Math.floor(Number(workerStderrBytes || 0))),
    durationMs: Math.max(0, Math.floor(Number(durationMs || 0))),
    systemSandbox: systemSandbox && typeof systemSandbox === "object" ? systemSandbox : null,
    cleanupStatus:
      cleanup?.attempted
        ? cleanup.removed
          ? "removed"
          : "cleanup_failed"
        : "not_requested",
  };
}

async function executeWorker(payload = {}, { timeoutMs = DEFAULT_SANDBOX_BROKER_TIMEOUT_MS, requestBytes = 0 } = {}) {
  const startedAt = Date.now();
  const workspace = await createBrokerWorkspace();
  const systemSandbox = await prepareSystemSandbox(workspace, payload);

  return new Promise((resolve, reject) => {
    const child = spawn(systemSandbox.command, systemSandbox.args, {
      cwd: workspace.root,
      env: {
        TMPDIR: workspace.root,
        TMP: workspace.root,
        TEMP: workspace.root,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      Promise.resolve(removeBrokerWorkspace(workspace)).finally(() => {
        reject(new Error(`Sandbox broker timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      Promise.resolve(removeBrokerWorkspace(workspace)).finally(() => reject(error));
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      Promise.resolve(removeBrokerWorkspace(workspace)).then((cleanup) => {
        try {
          const parsed = JSON.parse((stdout || "").trim() || "{}");
          if (code !== 0 || parsed.ok === false) {
            reject(new Error(parsed.error || stderr.trim() || `Sandbox worker exited with code ${code}`));
            return;
          }
          resolve({
            ...parsed,
            broker: buildBrokerMetadata({
              workspace,
              cleanup,
              workerPid: child.pid ?? null,
              requestBytes,
              durationMs: Date.now() - startedAt,
              workerStdoutBytes: Buffer.byteLength(stdout, "utf8"),
              workerStderrBytes: Buffer.byteLength(stderr, "utf8"),
              systemSandbox: systemSandbox.metadata,
            }),
          });
        } catch (error) {
          reject(new Error(`Invalid sandbox worker response: ${error.message || error}`));
        }
      });
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

async function main() {
  const raw = await readStdin();
  const requestBytes = Buffer.byteLength(raw || "", "utf8");
  if (requestBytes > MAX_SANDBOX_BROKER_REQUEST_BYTES) {
    throw new Error(
      `Sandbox broker request exceeds byte budget: ${requestBytes}/${MAX_SANDBOX_BROKER_REQUEST_BYTES}`
    );
  }
  const envelope = raw ? JSON.parse(raw) : {};
  const payload = envelope?.payload && typeof envelope.payload === "object" ? envelope.payload : {};
  const timeoutMs = Math.max(
    250,
    Math.floor(Number(envelope?.timeoutMs || payload?.timeoutMs || DEFAULT_SANDBOX_BROKER_TIMEOUT_MS))
  );
  const result = await executeWorker(payload, {
    timeoutMs,
    requestBytes,
  });
  writeJson(result);
}

main().catch((error) => {
  writeJson({
    ok: false,
    error: error.message || String(error),
  });
  process.exitCode = 1;
});

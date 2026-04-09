import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

async function createIsolatedWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-passport-worker-"));
  const homeDir = path.join(root, "home");
  const tempDir = path.join(root, "tmp");
  await mkdir(homeDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });
  return {
    workspaceId: path.basename(root),
    root,
    homeDir,
    tempDir,
  };
}

async function removeIsolatedWorkspace(workspace) {
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

function truncateUtf8Buffer(buffer, maxBytes) {
  if (!Buffer.isBuffer(buffer)) {
    return {
      buffer: Buffer.alloc(0),
      truncated: false,
    };
  }
  const boundedMaxBytes = Math.max(0, Math.floor(Number(maxBytes || 0)));
  if (buffer.length <= boundedMaxBytes) {
    return {
      buffer,
      truncated: false,
    };
  }
  let end = boundedMaxBytes;
  while (end > 0 && (buffer[end] & 0b11000000) === 0b10000000) {
    end -= 1;
  }
  return {
    buffer: buffer.subarray(0, end),
    truncated: true,
  };
}

function truncateUtf8Text(text, maxBytes) {
  const raw = Buffer.from(String(text || ""), "utf8");
  const truncated = truncateUtf8Buffer(raw, maxBytes);
  return {
    text: truncated.buffer.toString("utf8"),
    bytesRead: truncated.buffer.length,
    truncated: truncated.truncated,
    totalBytes: raw.length,
  };
}

function appendBoundedUtf8Buffer(current, chunk, maxBytes) {
  const currentBuffer = Buffer.isBuffer(current) ? current : Buffer.alloc(0);
  const nextBuffer = Buffer.concat([currentBuffer, Buffer.from(chunk)]);
  return truncateUtf8Buffer(nextBuffer, maxBytes);
}

function buildWorkerIsolationReport({
  isolatedEnv = false,
  workspace = null,
  cwd = null,
  cleanup = null,
} = {}) {
  const visibleWorkerEnvKeys = Object.keys(process.env).filter((key) => key !== "__CF_USER_TEXT_ENCODING");
  return {
    subprocessWorker: true,
    workerEnvMode: visibleWorkerEnvKeys.length === 0 ? "empty" : "custom",
    processEnvMode: isolatedEnv ? "minimal" : "empty",
    workspaceMode: workspace ? "ephemeral_home_tmp" : "none",
    workspaceId: workspace?.workspaceId ?? null,
    homeIsolated: Boolean(workspace?.homeDir),
    tempDirIsolated: Boolean(workspace?.tempDir),
    cwd: cwd || null,
    pathCleared: isolatedEnv,
    locale: isolatedEnv ? "C" : null,
    cleanupStatus:
      cleanup?.attempted
        ? cleanup.removed
          ? "removed"
          : "cleanup_failed"
        : "not_requested",
  };
}

async function executeProcess(
  command,
  args = [],
  {
    cwd = null,
    timeoutMs = 2500,
    maxOutputBytes = 4096,
    maxInputBytes = 16384,
    rejectOnInputTruncate = false,
    isolatedEnv = true,
    inputText = null,
  } = {}
) {
  const workspace = isolatedEnv ? await createIsolatedWorkspace() : null;
  const safeCwd = cwd || workspace?.root || process.cwd();
  const inputBuffer = typeof inputText === "string" ? Buffer.from(inputText, "utf8") : Buffer.alloc(0);
  const boundedInputBytes = Math.max(0, Math.floor(maxInputBytes));
  if (rejectOnInputTruncate && inputBuffer.length > boundedInputBytes) {
    await removeIsolatedWorkspace(workspace);
    throw new Error(`Sandbox process input exceeds budget (${inputBuffer.length} > ${boundedInputBytes})`);
  }
  return new Promise((resolve, reject) => {
    const childEnv = isolatedEnv
      ? {
          HOME: workspace.homeDir,
          TMPDIR: workspace.tempDir,
          TMP: workspace.tempDir,
          TEMP: workspace.tempDir,
          PATH: "",
          LANG: "C",
          LC_ALL: "C",
          PWD: safeCwd,
        }
      : {};
    const child = spawn(command, Array.isArray(args) ? args.map((item) => String(item)) : [], {
      cwd: safeCwd,
      env: childEnv,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let stdoutBytesSeen = 0;
    let stderrBytesSeen = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      Promise.resolve(removeIsolatedWorkspace(workspace))
        .finally(() => reject(new Error(`Sandbox process timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytesSeen += Buffer.byteLength(chunk);
      const next = appendBoundedUtf8Buffer(stdout, chunk, maxOutputBytes);
      stdout = next.buffer;
      stdoutTruncated = stdoutTruncated || next.truncated;
    });
    child.stderr.on("data", (chunk) => {
      stderrBytesSeen += Buffer.byteLength(chunk);
      const next = appendBoundedUtf8Buffer(stderr, chunk, maxOutputBytes);
      stderr = next.buffer;
      stderrTruncated = stderrTruncated || next.truncated;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      Promise.resolve(removeIsolatedWorkspace(workspace))
        .finally(() => reject(error));
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      Promise.resolve(removeIsolatedWorkspace(workspace))
        .then((cleanup) =>
          resolve({
            code,
            signal: signal || null,
            stdout: stdout.toString("utf8"),
            stderr: stderr.toString("utf8"),
            stdoutBytes: stdout.length,
            stderrBytes: stderr.length,
            stdoutBytesSeen,
            stderrBytesSeen,
            stdoutTruncated,
            stderrTruncated,
            inputBytes: inputBuffer.length,
            inputBytesAccepted: Math.min(inputBuffer.length, boundedInputBytes),
            inputTruncated: inputBuffer.length > boundedInputBytes,
            isolatedEnv,
            workerIsolation: buildWorkerIsolationReport({
              isolatedEnv,
              workspace,
              cwd: safeCwd,
              cleanup,
            }),
          })
        );
    });

    child.stdin.on("error", () => {
      // Ignore EPIPE-style failures when a subprocess exits before reading stdin.
    });
    const boundedInput = truncateUtf8Buffer(inputBuffer, boundedInputBytes).buffer;
    child.stdin.end(boundedInput);
  });
}

async function main() {
  const raw = await readStdin();
  const payload = raw ? JSON.parse(raw) : {};
  const capability = String(payload.capability || "").trim();
  const resolvedPath = String(payload.resolvedPath || "").trim();

  if (capability === "filesystem_list") {
    const entries = await readdir(resolvedPath, { withFileTypes: true });
    const maxListEntries = Math.max(1, Math.floor(Number(payload.maxListEntries || 40)));
    const sliced = entries.slice(0, maxListEntries).map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
    }));
    writeJson({
      ok: true,
      capability,
      output: {
        path: resolvedPath,
        allowlistedRoot: payload.allowlistedRoot || null,
        entries: sliced,
        truncated: entries.length > sliced.length,
        workerIsolation: buildWorkerIsolationReport({
          isolatedEnv: false,
          workspace: null,
          cwd: resolvedPath,
          cleanup: null,
        }),
      },
    });
    return;
  }

  if (capability === "filesystem_read") {
    const targetStat = await stat(resolvedPath);
    if (!targetStat.isFile()) {
      throw new Error(`Sandbox read target is not a file: ${resolvedPath}`);
    }
    const rawText = await readFile(resolvedPath, "utf8");
    const maxReadBytes = Math.max(256, Math.floor(Number(payload.maxReadBytes || 8192)));
    const preview = truncateUtf8Text(rawText, maxReadBytes);
    writeJson({
      ok: true,
      capability,
      output: {
        path: resolvedPath,
        allowlistedRoot: payload.allowlistedRoot || null,
        bytesRead: preview.bytesRead,
        truncated: preview.truncated,
        preview: preview.text,
        workerIsolation: buildWorkerIsolationReport({
          isolatedEnv: false,
          workspace: null,
          cwd: path.dirname(resolvedPath),
          cleanup: null,
        }),
      },
    });
    return;
  }

  if (capability === "network_external") {
    const url = String(payload.url || payload.targetUrl || "").trim();
    if (!url) {
      throw new Error("Sandbox network target URL is required");
    }
    const timeoutMs = Math.max(250, Math.floor(Number(payload.timeoutMs || 2500)));
    const maxResponseBytes = Math.max(256, Math.floor(Number(payload.maxResponseBytes || 4096)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: String(payload.method || "GET").toUpperCase(),
        headers: payload.headers && typeof payload.headers === "object" ? payload.headers : undefined,
        redirect: "error",
        signal: controller.signal,
      });
      const rawText = await response.text();
      const preview = truncateUtf8Text(rawText, maxResponseBytes);
      writeJson({
        ok: true,
        capability,
        output: {
          url,
          host: new URL(url).hostname || null,
          status: response.status,
          ok: response.ok,
          bytesRead: preview.bytesRead,
          truncated: preview.truncated,
          preview: preview.text,
          workerIsolation: buildWorkerIsolationReport({
            isolatedEnv: false,
            workspace: null,
            cwd: process.cwd(),
            cleanup: null,
          }),
        },
      });
      return;
    } finally {
      clearTimeout(timer);
    }
  }

  if (capability === "process_exec") {
    const command = String(payload.command || "").trim();
    if (!command) {
      throw new Error("Sandbox process command is required");
    }
    const result = await executeProcess(command, payload.args || [], {
      cwd: String(payload.cwd || "").trim() || null,
      timeoutMs: Math.max(250, Math.floor(Number(payload.timeoutMs || 2500))),
      maxOutputBytes: Math.max(256, Math.floor(Number(payload.maxOutputBytes || 4096))),
      maxInputBytes: Math.max(512, Math.floor(Number(payload.maxInputBytes || 16384))),
      isolatedEnv: payload.isolatedEnv !== false,
    });
    writeJson({
      ok: true,
      capability,
      output: result,
    });
    return;
  }

  if (capability === "reasoner_local_command") {
    const command = String(payload.command || "").trim();
    if (!command) {
      throw new Error("Sandbox local reasoner command is required");
    }
    const result = await executeProcess(command, payload.args || [], {
      cwd: String(payload.cwd || "").trim() || null,
      timeoutMs: Math.max(500, Math.floor(Number(payload.timeoutMs || 8000))),
      maxOutputBytes: Math.max(512, Math.floor(Number(payload.maxOutputBytes || 8192))),
      maxInputBytes: Math.max(512, Math.floor(Number(payload.maxInputBytes || 16384))),
      rejectOnInputTruncate: payload.rejectOnInputTruncate === true,
      isolatedEnv: payload.isolatedEnv !== false,
      inputText:
        typeof payload.inputText === "string"
          ? payload.inputText
          : JSON.stringify(payload.inputJson || {}, null, 2),
    });
    writeJson({
      ok: true,
      capability,
      output: result,
    });
    return;
  }

  throw new Error(`Unsupported sandbox worker capability: ${capability}`);
}

main().catch((error) => {
  writeJson({
    ok: false,
    error: error.message || String(error),
  });
  process.exitCode = 1;
});

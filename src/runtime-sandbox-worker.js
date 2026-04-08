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
    root,
    homeDir,
    tempDir,
  };
}

async function removeIsolatedWorkspace(workspace) {
  if (!workspace?.root) {
    return;
  }
  await rm(workspace.root, { recursive: true, force: true });
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
    const child = spawn(command, Array.isArray(args) ? args.map((item) => String(item)) : [], {
      cwd: safeCwd,
      env: isolatedEnv
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
        : {},
      shell: false,
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
      Promise.resolve(removeIsolatedWorkspace(workspace))
        .finally(() => reject(new Error(`Sandbox process timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    const appendBounded = (target, chunk) => {
      const text = chunk.toString("utf8");
      if (target.length >= maxOutputBytes) {
        return target;
      }
      return (target + text).slice(0, maxOutputBytes);
    };

    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
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
        .finally(() =>
          resolve({
            code,
            signal: signal || null,
            stdout,
            stderr,
            isolatedEnv,
          })
        );
    });

    child.stdin.on("error", () => {
      // Ignore EPIPE-style failures when a subprocess exits before reading stdin.
    });
    const boundedInput = inputBuffer.subarray(0, boundedInputBytes).toString("utf8");
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
    const preview = rawText.slice(0, maxReadBytes);
    writeJson({
      ok: true,
      capability,
      output: {
        path: resolvedPath,
        allowlistedRoot: payload.allowlistedRoot || null,
        bytesRead: Buffer.byteLength(preview, "utf8"),
        truncated: rawText.length > preview.length,
        preview,
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
      const preview = rawText.slice(0, maxResponseBytes);
      writeJson({
        ok: true,
        capability,
        output: {
          url,
          status: response.status,
          ok: response.ok,
          bytesRead: Buffer.byteLength(preview, "utf8"),
          truncated: rawText.length > preview.length,
          preview,
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

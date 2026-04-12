import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import os from "node:os";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cleanupSmokeSecretIsolation, resolveLiveRuntimePaths, seedSmokeSecretIsolation } from "./smoke-env.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const explicitBaseUrl = process.env.AGENT_PASSPORT_BASE_URL || null;
const skipBrowser = process.env.SMOKE_ALL_SKIP_BROWSER === "1";

function runStep(name, script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [path.join(rootDir, "scripts", script)], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    // Some smoke steps spawn helper subprocesses that can inherit stdio.
    // Waiting for `close` can hang even after the step process itself exited.
    child.on("exit", (code) => {
      const durationMs = Date.now() - startedAt;
      if (code !== 0) {
        reject(new Error(`${name} failed with code ${code}\n${stderr || stdout}`));
        return;
      }
      resolve({
        name,
        script,
        durationMs,
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForChildClose(child, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function probeHealth(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: {
        Connection: "close",
      },
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => ({}));
    return payload?.ok === true;
  } catch {
    return false;
  }
}

async function waitForHealth(baseUrl, { timeoutMs = 30000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeHealth(baseUrl)) {
      return true;
    }
    await sleep(300);
  }
  return false;
}

async function allocateEphemeralLoopbackBaseUrl() {
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
          reject(new Error("无法分配 smoke 隔离端口"));
          return;
        }
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  });
}

async function resolveSmokeBaseUrl() {
  if (explicitBaseUrl) {
    return {
      baseUrl: explicitBaseUrl,
      reuseExisting: true,
      isolationMode: "explicit_base_url",
    };
  }
  return {
    baseUrl: await allocateEphemeralLoopbackBaseUrl(),
    reuseExisting: false,
    isolationMode: "ephemeral_loopback",
  };
}

async function copyPathIfExists(sourcePath, targetPath, { recursive = false } = {}) {
  try {
    await cp(sourcePath, targetPath, { recursive });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function prepareSmokeDataRoot({ isolated = false } = {}) {
  if (!isolated) {
    return {
      isolationEnv: {},
      dataIsolationMode: "shared_live_data",
      secretIsolationMode: "shared_runtime_secrets",
      cleanup: async () => {},
    };
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "openneed-memory-smoke-all-"));
  const dataRoot = path.join(tempRoot, "data");
  const isolationAccount = path.basename(tempRoot);
  const liveRuntime = resolveLiveRuntimePaths();
  await mkdir(dataRoot, { recursive: true });
  await copyPathIfExists(liveRuntime.ledgerPath, path.join(dataRoot, "ledger.json"));
  await copyPathIfExists(liveRuntime.storeKeyPath, path.join(dataRoot, ".ledger-key"));
  await copyPathIfExists(liveRuntime.recoveryDir, path.join(dataRoot, "recovery-bundles"), {
    recursive: true,
  });
  await copyPathIfExists(liveRuntime.setupPackageDir, path.join(dataRoot, "device-setup-packages"), {
    recursive: true,
  });
  await copyPathIfExists(liveRuntime.archiveDir, path.join(dataRoot, "archives"), {
    recursive: true,
  });
  await seedSmokeSecretIsolation({
    dataDir: dataRoot,
    keychainAccount: isolationAccount,
    liveRuntime,
  });
  const isolationEnv = {
    OPENNEED_LEDGER_PATH: path.join(dataRoot, "ledger.json"),
    AGENT_PASSPORT_STORE_KEY_PATH: path.join(dataRoot, ".ledger-key"),
    AGENT_PASSPORT_RECOVERY_DIR: path.join(dataRoot, "recovery-bundles"),
    AGENT_PASSPORT_SETUP_PACKAGE_DIR: path.join(dataRoot, "device-setup-packages"),
    AGENT_PASSPORT_ARCHIVE_DIR: path.join(dataRoot, "archives"),
    AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(dataRoot, ".admin-token"),
    AGENT_PASSPORT_SIGNING_SECRET_PATH: path.join(dataRoot, ".did-signing-master-secret"),
    AGENT_PASSPORT_KEYCHAIN_ACCOUNT: isolationAccount,
    AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT: isolationAccount,
  };

  return {
    isolationEnv,
    dataIsolationMode: "ephemeral_data_copy",
    secretIsolationMode: "ephemeral_secret_namespace",
    cleanup: async () => {
      await cleanupSmokeSecretIsolation({
        keychainAccount: isolationEnv.AGENT_PASSPORT_KEYCHAIN_ACCOUNT,
        adminTokenAccount: isolationEnv.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT,
        cleanupRoot: tempRoot,
      });
    },
  };
}

async function ensureSmokeServer(baseUrl, { reuseExisting = false, extraEnv = {} } = {}) {
  if (reuseExisting && (await probeHealth(baseUrl))) {
    return {
      baseUrl,
      child: null,
      started: false,
      stop: async () => {},
    };
  }

  const parsed = new URL(baseUrl);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error(`AGENT_PASSPORT_BASE_URL 未就绪且不是本机地址：${baseUrl}`);
  }

  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  const host = parsed.hostname;
  let stdout = "";
  let stderr = "";
  const child = spawn(process.execPath, [path.join(rootDir, "src", "server.js")], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...extraEnv,
      HOST: host,
      PORT: String(port),
    },
  });

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const ready = await waitForHealth(baseUrl, { timeoutMs: 30000 });
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(`smoke server 未在预期时间内就绪\n${stderr || stdout}`);
  }

  return {
    baseUrl,
    child,
    started: true,
    stop: async () => {
      if (child.exitCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      if (await waitForChildClose(child, 1500)) {
        return;
      }
      child.kill("SIGKILL");
      await waitForChildClose(child, 1000);
    },
  };
}

async function main() {
  const primaryStepDefs = [
    ["smoke:ui", "smoke-ui.mjs", { SMOKE_COMBINED: "1" }],
    ["smoke:dom", "smoke-dom.mjs", { SMOKE_COMBINED: "1" }],
  ];
  const browserStep = ["smoke:browser", "smoke-browser.mjs", { SMOKE_COMBINED: "1" }];
  const allStepDefs = skipBrowser ? primaryStepDefs : [...primaryStepDefs, browserStep];
  const sequential = process.env.SMOKE_ALL_PARALLEL === "1" ? false : true;
  const startedAt = Date.now();
  const resolvedBaseUrl = await resolveSmokeBaseUrl();
  const resolvedDataRoot = await prepareSmokeDataRoot({
    isolated: !resolvedBaseUrl.reuseExisting,
  });
  const smokeServer = await ensureSmokeServer(resolvedBaseUrl.baseUrl, {
    reuseExisting: resolvedBaseUrl.reuseExisting,
    extraEnv: resolvedDataRoot.isolationEnv,
  });
  const baseEnv = {
    AGENT_PASSPORT_BASE_URL: smokeServer.baseUrl,
    ...resolvedDataRoot.isolationEnv,
  };

  try {
    let steps;
    if (sequential) {
      steps = [];
      for (const [name, script, extraEnv] of allStepDefs) {
        steps.push(await runStep(name, script, { ...baseEnv, ...extraEnv }));
      }
    } else {
      steps = await Promise.all(
        primaryStepDefs.map(([name, script, extraEnv]) => runStep(name, script, { ...baseEnv, ...extraEnv }))
      );
      if (!skipBrowser) {
        steps.push(await runStep(browserStep[0], browserStep[1], { ...baseEnv, ...browserStep[2] }));
      }
    }

    const totalDurationMs = Date.now() - startedAt;
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: sequential ? "sequential_combined" : "parallel_combined",
          totalDurationMs,
          browserSkipped: skipBrowser,
          baseUrl: smokeServer.baseUrl,
          serverStartedBySmokeAll: smokeServer.started,
          serverIsolationMode: resolvedBaseUrl.isolationMode,
          serverDataIsolationMode: resolvedDataRoot.dataIsolationMode,
          serverSecretIsolationMode: resolvedDataRoot.secretIsolationMode,
          steps,
        },
        null,
        2
      )
    );
  } finally {
    await smokeServer.stop();
    await resolvedDataRoot.cleanup();
  }
}

await main();

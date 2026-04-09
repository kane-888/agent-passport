import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const defaultBaseUrl = process.env.AGENT_PASSPORT_BASE_URL || "http://127.0.0.1:4319";

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
    child.on("close", (code) => {
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

async function ensureSmokeServer(baseUrl) {
  if (await probeHealth(baseUrl)) {
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
      await new Promise((resolve) => child.once("close", resolve));
    },
  };
}

async function main() {
  const primaryStepDefs = [
    ["smoke:ui", "smoke-ui.mjs", { SMOKE_COMBINED: "1" }],
    ["smoke:dom", "smoke-dom.mjs", { SMOKE_COMBINED: "1" }],
  ];
  const browserStep = ["smoke:browser", "smoke-browser.mjs", { SMOKE_COMBINED: "1" }];
  const sequential = process.env.SMOKE_ALL_PARALLEL === "1" ? false : true;
  const startedAt = Date.now();
  const smokeServer = await ensureSmokeServer(defaultBaseUrl);
  const baseEnv = {
    AGENT_PASSPORT_BASE_URL: smokeServer.baseUrl,
  };

  try {
    let steps;
    if (sequential) {
      steps = [];
      for (const [name, script, extraEnv] of [...primaryStepDefs, browserStep]) {
        steps.push(await runStep(name, script, { ...baseEnv, ...extraEnv }));
      }
    } else {
      steps = await Promise.all(
        primaryStepDefs.map(([name, script, extraEnv]) => runStep(name, script, { ...baseEnv, ...extraEnv }))
      );
      steps.push(await runStep(browserStep[0], browserStep[1], { ...baseEnv, ...browserStep[2] }));
    }

    const totalDurationMs = Date.now() - startedAt;
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: sequential ? "sequential_combined" : "parallel_combined",
          totalDurationMs,
          baseUrl: smokeServer.baseUrl,
          serverStartedBySmokeAll: smokeServer.started,
          steps,
        },
        null,
        2
      )
    );
  } finally {
    await smokeServer.stop();
  }
}

await main();

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ensureSmokeServer,
  prepareSmokeDataRoot,
  resolveSmokeBaseUrl,
} from "./smoke-server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
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

async function main() {
  const preflightStepDef = [
    "verify:mempalace:remote-reasoner",
    "verify-mempalace-remote-reasoner.mjs",
    { SMOKE_COMBINED: "1" },
  ];
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
    tempPrefix: "openneed-memory-smoke-all-",
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
      steps = [await runStep(preflightStepDef[0], preflightStepDef[1], { ...baseEnv, ...preflightStepDef[2] })];
      for (const [name, script, extraEnv] of allStepDefs) {
        steps.push(await runStep(name, script, { ...baseEnv, ...extraEnv }));
      }
    } else {
      steps = [await runStep(preflightStepDef[0], preflightStepDef[1], { ...baseEnv, ...preflightStepDef[2] })];
      steps.push(
        ...(await Promise.all(
        primaryStepDefs.map(([name, script, extraEnv]) => runStep(name, script, { ...baseEnv, ...extraEnv }))
        ))
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

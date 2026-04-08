import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

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

async function main() {
  const stepDefs = [
    ["smoke:ui", "smoke-ui.mjs", { SMOKE_COMBINED: "1" }],
    ["smoke:dom", "smoke-dom.mjs", { SMOKE_COMBINED: "1" }],
  ];
  const sequential = process.env.SMOKE_ALL_PARALLEL === "1" ? false : true;
  const startedAt = Date.now();

  let steps;
  if (sequential) {
    steps = [];
    for (const [name, script, extraEnv] of stepDefs) {
      steps.push(await runStep(name, script, extraEnv));
    }
  } else {
    steps = await Promise.all(stepDefs.map(([name, script, extraEnv]) => runStep(name, script, extraEnv)));
  }

  const totalDurationMs = Date.now() - startedAt;
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: sequential ? "sequential_combined" : "parallel_combined",
        totalDurationMs,
        steps,
      },
      null,
      2
    )
  );
}

await main();

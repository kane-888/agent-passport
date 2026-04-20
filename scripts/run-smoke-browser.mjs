import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ensureSmokeServer,
  prepareSmokeDataRoot,
  resolveSmokeBaseUrl,
} from "./smoke-server.mjs";
import {
  DEFAULT_BROWSER_SMOKE_FETCH_TIMEOUT_MS,
} from "./smoke-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

export function buildSmokeBrowserChildEnv({
  baseUrl,
  isolationEnv = {},
  baseEnv = process.env,
} = {}) {
  return {
    ...baseEnv,
    ...isolationEnv,
    AGENT_PASSPORT_BASE_URL: baseUrl,
    SMOKE_FETCH_TIMEOUT_MS: baseEnv.SMOKE_FETCH_TIMEOUT_MS || String(DEFAULT_BROWSER_SMOKE_FETCH_TIMEOUT_MS),
  };
}

export function runSmokeBrowserStep(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, "scripts", "smoke-browser.mjs")], {
      cwd: rootDir,
      stdio: "inherit",
      env: {
        ...process.env,
        ...extraEnv,
      },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`smoke:browser 被信号终止: ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const resolvedBaseUrl = await resolveSmokeBaseUrl();
  const resolvedDataRoot = await prepareSmokeDataRoot({
    isolated: !resolvedBaseUrl.reuseExisting,
    tempPrefix: "openneed-memory-smoke-browser-",
  });
  const smokeServer = await ensureSmokeServer(resolvedBaseUrl.baseUrl, {
    reuseExisting: resolvedBaseUrl.reuseExisting,
    extraEnv: resolvedDataRoot.isolationEnv,
  });

  try {
    const exitCode = await runSmokeBrowserStep(
      buildSmokeBrowserChildEnv({
        baseUrl: smokeServer.baseUrl,
        isolationEnv: resolvedDataRoot.isolationEnv,
      })
    );
    process.exitCode = exitCode;
  } finally {
    await smokeServer.stop();
    await resolvedDataRoot.cleanup();
  }
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

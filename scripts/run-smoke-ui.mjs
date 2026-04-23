import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  cleanupSmokeWrapperRuntime,
  ensureSmokeServer,
  prepareSmokeDataRoot,
  resolveSmokeBaseUrl,
} from "./smoke-server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

export function buildSmokeUiChildEnv({
  baseUrl,
  isolationEnv = {},
  baseEnv = process.env,
} = {}) {
  return {
    ...baseEnv,
    ...isolationEnv,
    AGENT_PASSPORT_BASE_URL: baseUrl,
  };
}

export function runSmokeUiStep(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, "scripts", "smoke-ui.mjs")], {
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
        reject(new Error(`smoke:ui 被信号终止: ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

export async function runSmokeUiWrapper({
  resolveBaseUrl = resolveSmokeBaseUrl,
  prepareDataRoot = prepareSmokeDataRoot,
  ensureServer = ensureSmokeServer,
  runStep = runSmokeUiStep,
} = {}) {
  const resolvedBaseUrl = await resolveBaseUrl();
  let resolvedDataRoot = null;
  let smokeServer = null;
  let primaryError = null;

  try {
    resolvedDataRoot = await prepareDataRoot({
      isolated: !resolvedBaseUrl.reuseExisting,
      tempPrefix: "agent-passport-smoke-ui-",
    });
    smokeServer = await ensureServer(resolvedBaseUrl.baseUrl, {
      reuseExisting: resolvedBaseUrl.reuseExisting,
      extraEnv: resolvedDataRoot.isolationEnv,
    });
    return await runStep(
      buildSmokeUiChildEnv({
        baseUrl: smokeServer.baseUrl,
        isolationEnv: resolvedDataRoot.isolationEnv,
      })
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await cleanupSmokeWrapperRuntime({ smokeServer, resolvedDataRoot, primaryError });
  }
}

async function main() {
  process.exitCode = await runSmokeUiWrapper();
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

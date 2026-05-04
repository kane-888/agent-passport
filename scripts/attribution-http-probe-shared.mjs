import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildAdminTokenHeaders } from "../public/runtime-truth-client.js";
import { ensureSmokeLedgerInitialized } from "./smoke-env.mjs";
import { fetchWithRetry, sleep } from "./smoke-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const liveDataDir = path.join(rootDir, "data");

async function copyIfExists(sourcePath, targetPath) {
  try {
    await fs.copyFile(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!Number.isFinite(port)) {
          reject(new Error("Unable to resolve free port"));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServer(baseUrl) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetchWithRetry(
        fetch,
        `${baseUrl}/api/security`,
        {
          headers: {
            Connection: "close",
          },
        },
        "GET /api/security"
      );
      if (response.ok) {
        await response.text();
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
      await response.text().catch(() => {});
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw lastError || new Error("Timed out waiting for server");
}

export async function shutdownAttributionProbeServer(server) {
  if (!server || server.exitCode !== null) {
    return;
  }
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    server.once("exit", () => resolve());
    setTimeout(resolve, 1000);
  });
}

export function buildAttributionAdminFetch(baseUrl, adminToken) {
  return async function adminFetch(resourcePath, options = {}) {
    const headers = buildAdminTokenHeaders({
      token: adminToken,
      headers: {
        Connection: "close",
        ...(options.headers || {}),
      },
      includeJsonContentType: false,
    });
    return fetchWithRetry(
      fetch,
      `${baseUrl}${resourcePath}`,
      {
        ...options,
        headers,
      },
      `${options.method || "GET"} ${resourcePath}`
    );
  };
}

export async function getJson(adminFetch, resourcePath) {
  const response = await adminFetch(resourcePath);
  if (!response.ok) {
    throw new Error(`${resourcePath} -> HTTP ${response.status}`);
  }
  return response.json();
}

export async function postJson(adminFetch, resourcePath, payload, expectedStatus) {
  const response = await adminFetch(resourcePath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (response.status !== expectedStatus) {
    const body = await response.text().catch(() => "");
    throw new Error(`${resourcePath} -> expected HTTP ${expectedStatus}, received ${response.status}: ${body}`);
  }
  return response.json();
}

export async function createAttributionHttpProbe(name) {
  const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), `agent-passport-${name}-`));
  const dataDir = path.join(probeRoot, "data");
  const ledgerPath = path.join(dataDir, "ledger.json");
  const storeKeyPath = path.join(dataDir, ".ledger-key");
  const signingSecretPath = path.join(dataDir, ".did-signing-master-secret");
  const recoveryDir = path.join(dataDir, "recovery-bundles");
  const archiveDir = path.join(dataDir, "archives");
  const setupPackageDir = path.join(dataDir, "device-setup-packages");
  const port = await getFreePort();
  const adminToken = `probe-${randomBytes(12).toString("hex")}`;
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = {
    stdout: "",
    stderr: "",
  };

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(recoveryDir, { recursive: true });
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.mkdir(setupPackageDir, { recursive: true });
  await copyIfExists(path.join(liveDataDir, "ledger.json"), ledgerPath);
  await copyIfExists(path.join(liveDataDir, ".ledger-key"), storeKeyPath);
  await copyIfExists(path.join(liveDataDir, ".did-signing-master-secret"), signingSecretPath);

  const serverEnv = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
    AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
    AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
    AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
    AGENT_PASSPORT_ARCHIVE_DIR: archiveDir,
    AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
    AGENT_PASSPORT_ADMIN_TOKEN: adminToken,
  };

  await ensureSmokeLedgerInitialized(serverEnv);

  return {
    rootDir,
    probeRoot,
    dataDir,
    ledgerPath,
    storeKeyPath,
    signingSecretPath,
    recoveryDir,
    archiveDir,
    setupPackageDir,
    baseUrl,
    adminToken,
    serverEnv,
    output,
    adminFetch: buildAttributionAdminFetch(baseUrl, adminToken),
    async startServer() {
      const server = spawn("node", ["src/server.js"], {
        cwd: rootDir,
        env: serverEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      server.stdout?.on("data", (chunk) => {
        output.stdout += String(chunk);
      });
      server.stderr?.on("data", (chunk) => {
        output.stderr += String(chunk);
      });
      await waitForServer(baseUrl);
      return server;
    },
    logServerOutput() {
      if (output.stdout.trim()) {
        console.error(output.stdout.trim());
      }
      if (output.stderr.trim()) {
        console.error(output.stderr.trim());
      }
    },
    async cleanup(server) {
      await shutdownAttributionProbeServer(server);
      await fs.rm(probeRoot, { recursive: true, force: true });
    },
  };
}

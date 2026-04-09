import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SANDBOX_BROKER_PATH = path.join(__dirname, "runtime-sandbox-broker.js");
const DEFAULT_SANDBOX_BROKER_TIMEOUT_MS = 2500;

export async function executeSandboxBroker(payload = {}, { timeoutMs = DEFAULT_SANDBOX_BROKER_TIMEOUT_MS } = {}) {
  const brokerTimeoutMs = Math.max(250, Math.floor(Number(timeoutMs || DEFAULT_SANDBOX_BROKER_TIMEOUT_MS))) + 500;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SANDBOX_BROKER_PATH], {
      cwd: tmpdir(),
      env: {},
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
      reject(new Error(`Sandbox broker client timed out after ${brokerTimeoutMs}ms`));
    }, brokerTimeoutMs);

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
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        const parsed = JSON.parse((stdout || "").trim() || "{}");
        if (code !== 0 || parsed.ok === false) {
          reject(new Error(parsed.error || stderr.trim() || `Sandbox broker exited with code ${code}`));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Invalid sandbox broker response: ${error.message || error}`));
      }
    });

    child.stdin.end(JSON.stringify({
      payload,
      timeoutMs,
    }));
  });
}

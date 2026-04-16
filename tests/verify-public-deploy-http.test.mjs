import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractRenderServiceNames } from "../scripts/verify-public-deploy-http.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const verifyScriptPath = path.join(rootDir, "scripts", "verify-public-deploy-http.mjs");
const verifyGoLiveScriptPath = path.join(rootDir, "scripts", "verify-go-live-readiness.mjs");

function extractTrailingJson(output = "") {
  const trimmed = String(output || "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {}

  for (let index = trimmed.lastIndexOf("\n{"); index >= 0; index = trimmed.lastIndexOf("\n{", index - 1)) {
    const candidate = trimmed.slice(index + 1).trim();
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
}

function createEnv(overrides = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

function runNodeScript(scriptPath, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: rootDir,
      env: createEnv(overrides),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({
        code,
        stdout,
        stderr,
        json: extractTrailingJson(stdout),
      });
    });
  });
}

function runVerifyPublicDeployHttp(overrides = {}) {
  return runNodeScript(verifyScriptPath, overrides);
}

function runVerifyGoLiveReadiness(overrides = {}) {
  return runNodeScript(verifyGoLiveScriptPath, overrides);
}

test("extractRenderServiceNames only keeps top-level service names", () => {
  const source = `
services:
  - type: web
    name: agent-passport
    runtime: docker
    disk:
      name: agent-passport-data
  - type: worker
    name: agent-passport-sidecar
    envVars:
      - key: FOO
        value: bar
`;

  assert.deepEqual(extractRenderServiceNames(source), ["agent-passport", "agent-passport-sidecar"]);
});

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  assert.ok(port, "server port should be available");
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

test("missing deploy url keeps HTTP 404 probe details and honors file token fallback", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-deploy-http-test-"));
  const tokenPath = path.join(tempDir, ".admin-token");
  await writeFile(tokenPath, "file-fallback-token\n", "utf8");

  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not Found\n");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found\n");
  });

  try {
    const result = await runVerifyPublicDeployHttp({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: tokenPath,
      AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: server.baseUrl,
      AGENT_PASSPORT_DEPLOY_BASE_URL: null,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN: null,
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-public-deploy-http should print JSON");
    assert.equal(result.json.ok, false);
    assert.equal(result.json.adminTokenProvided, true);
    assert.equal(result.json.adminTokenSource, "file");
    assert.equal(result.json.suggestedBaseUrls.length, 1);
    assert.equal(result.json.suggestedBaseUrls[0].status, 404);
    assert.equal(result.json.suggestedBaseUrls[0].error, null);
    assert.match(result.json.checks[0].detail, /HTTP 404/u);
    assert.doesNotMatch(result.json.checks[0].detail, /Unexpected token/u);
    assert.deepEqual(
      result.json.blockedBy.map((entry) => entry.id),
      ["deploy_base_url_present"]
    );
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("healthy candidate auto discovery continues full deploy verification", async () => {
  const adminToken = "env-token";
  const server = await startServer((req, res) => {
    const auth = req.headers.authorization || "";
    const authorized = auth === `Bearer ${adminToken}`;

    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><h1>公开运行态</h1><a href=\"/api/security\">/api/security</a></body></html>");
      return;
    }
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "agent-passport" }));
      return;
    }
    if (req.url === "/api/capabilities") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ product: { name: "OpenNeed 记忆稳态引擎" } }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          localStore: { ready: true },
          securityPosture: { mode: "normal", summary: "ok" },
          automaticRecovery: {
            operatorBoundary: {
              formalFlowReady: true,
              summary: "ready",
            },
          },
          constrainedExecution: {
            status: "ready",
            summary: "ready",
          },
        })
      );
      return;
    }
    if (req.url === "/api/agents") {
      if (!authorized) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ agents: [] }));
      return;
    }
    if (req.url === "/api/device/setup") {
      if (!authorized) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          formalRecoveryFlow: {
            durableRestoreReady: true,
            runbook: {
              status: "ready",
            },
            rehearsal: {
              status: "fresh",
              summary: "fresh",
            },
          },
          automaticRecoveryReadiness: {
            operatorBoundary: {
              formalFlowReady: true,
              summary: "ready",
            },
          },
          deviceRuntime: {
            constrainedExecutionSummary: {
              status: "ready",
              summary: "ready",
            },
          },
        })
      );
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found\n");
  });

  try {
    const result = await runVerifyPublicDeployHttp({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: server.baseUrl,
      AGENT_PASSPORT_DEPLOY_BASE_URL: null,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: adminToken,
      AGENT_PASSPORT_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(os.tmpdir(), "agent-passport-missing-token"),
    });

    assert.equal(result.code, 0);
    assert.ok(result.json, "verify-public-deploy-http should print JSON");
    assert.equal(result.json.ok, true);
    assert.equal(result.json.baseUrl, server.baseUrl);
    assert.equal(result.json.baseUrlSource, "candidate_auto_discovery");
    assert.equal(result.json.adminTokenProvided, true);
    assert.equal(result.json.releaseReadiness?.status, "ready");
    assert.equal(result.json.releaseReadiness?.readinessClass, "go_live_ready");
  } finally {
    await server.close();
  }
});

test("go-live verifier short circuits cleanly when only deploy url is missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-test-"));
  const tokenPath = path.join(tempDir, ".admin-token");
  await writeFile(tokenPath, "file-fallback-token\n", "utf8");

  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not Found\n");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found\n");
  });

  try {
    const result = await runVerifyGoLiveReadiness({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: tokenPath,
      AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: server.baseUrl,
      AGENT_PASSPORT_DEPLOY_BASE_URL: null,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN: null,
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-go-live should print JSON");
    assert.equal(result.json.preflightShortCircuited, true);
    assert.equal(result.json.deploy.adminTokenProvided, true);
    assert.equal(result.json.deploy.adminTokenSource, "file");
    assert.equal(result.json.smoke.skipped, true);
    assert.equal(result.json.deploy.suggestedBaseUrls[0].status, 404);
    assert.deepEqual(
      result.json.blockedBy.map((entry) => entry.id),
      ["deploy_base_url_present", "runtime_release_ready"]
    );
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

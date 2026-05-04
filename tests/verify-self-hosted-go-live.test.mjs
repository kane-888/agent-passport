import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildSelfHostedGoLiveVerdict,
  verifyLocalLoopbackRuntime,
  verifySelfHostedGoLive,
} from "../scripts/verify-self-hosted-go-live.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const verifySelfHostedScriptPath = path.join(rootDir, "scripts", "verify-self-hosted-go-live.mjs");
const defaultGoLiveRuntimeContractPassPath = path.join(rootDir, "tests", "fixtures", "go-live-runtime-contract-pass.mjs");

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

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
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

function runNodeCli(scriptPath, overrides = {}) {
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

function runVerifySelfHostedCli(overrides = {}) {
  return runNodeCli(verifySelfHostedScriptPath, {
    AGENT_PASSPORT_SKIP_GO_LIVE_RUNTIME_CONTRACTS: "0",
    AGENT_PASSPORT_GO_LIVE_RUNTIME_CONTRACT_TESTS: defaultGoLiveRuntimeContractPassPath,
    ...overrides,
  });
}

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

test("verifyLocalLoopbackRuntime passes when local health and security posture are ready", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "agent-passport" }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          securityPosture: { mode: "normal", summary: "ok" },
          releaseReadiness: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
          automaticRecovery: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    const result = await verifyLocalLoopbackRuntime({ localBaseUrl: server.baseUrl });
    assert.equal(result.ok, true);
    assert.equal(result.status, "ready");
    assert.equal(result.blockedBy.length, 0);
    assert.match(result.summary, /loopback/u);
  } finally {
    await server.close();
  }
});

test("verifyLocalLoopbackRuntime fetches local health and security in parallel", async () => {
  let securityStarted = false;
  const requestedPaths = [];
  const waitForSecurityStart = async (signal) => {
    while (!securityStarted) {
      if (signal?.aborted) {
        throw signal.reason;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  };
  const jsonResponse = (body) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    requestedPaths.push(pathname);
    if (pathname === "/api/health") {
      await waitForSecurityStart(init.signal);
      return jsonResponse({ ok: true, service: "agent-passport" });
    }
    if (pathname === "/api/security") {
      securityStarted = true;
      return jsonResponse({
        securityPosture: { mode: "normal", summary: "ok" },
        releaseReadiness: {
          failureSemantics: {
            status: "clear",
            failureCount: 0,
            primaryFailure: null,
            failures: [],
          },
        },
        automaticRecovery: {
          failureSemantics: {
            status: "clear",
            failureCount: 0,
            primaryFailure: null,
            failures: [],
          },
        },
      });
    }
    return jsonResponse({ ok: false });
  };

  const result = await verifyLocalLoopbackRuntime({
    localBaseUrl: "http://127.0.0.1:4319",
    timeoutMs: 100,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(requestedPaths.length, 2);
  assert.deepEqual(new Set(requestedPaths), new Set(["/api/health", "/api/security"]));
});

test("verifyLocalLoopbackRuntime resolves local port from discovered env file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-self-hosted-env-file-test-"));
  const envFilePath = path.join(tempDir, "agent-passport.env");
  const previousEnv = {
    PORT: process.env.PORT,
    HOST: process.env.HOST,
    AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT: process.env.AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT,
    AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL: process.env.AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL,
    AGENT_PASSPORT_LOCAL_BASE_URL: process.env.AGENT_PASSPORT_LOCAL_BASE_URL,
  };
  delete process.env.PORT;
  delete process.env.HOST;
  delete process.env.AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT;
  delete process.env.AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL;
  delete process.env.AGENT_PASSPORT_LOCAL_BASE_URL;

  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "agent-passport" }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          securityPosture: { mode: "normal", summary: "ok" },
          releaseReadiness: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
          automaticRecovery: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    const port = new URL(server.baseUrl).port;
    await writeFile(envFilePath, `PORT=${port}\nHOST=0.0.0.0\n`, "utf8");

    const result = await verifyLocalLoopbackRuntime({ envFilePath });
    assert.equal(result.ok, true);
    assert.equal(result.baseUrl, server.baseUrl);
    assert.equal(result.baseUrlSource, "PORT");
    assert.equal(result.baseUrlSourceType, "env_file");
    assert.equal(result.baseUrlSourcePath, envFilePath);
    assert.ok(Array.isArray(result.configEnvFiles));
    assert.ok(result.configEnvFiles.includes(envFilePath));
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("verifyLocalLoopbackRuntime blocks when service name or security posture drift", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "wrong-service" }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          securityPosture: { mode: "review", summary: "needs review" },
          releaseReadiness: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
          automaticRecovery: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    const result = await verifyLocalLoopbackRuntime({ localBaseUrl: server.baseUrl });
    assert.equal(result.ok, false);
    assert.equal(result.status, "blocked");
    assert.deepEqual(
      result.blockedBy.map((entry) => entry.id),
      ["local_service_name", "local_security_normal"]
    );
  } finally {
    await server.close();
  }
});

test("verifyLocalLoopbackRuntime blocks when local security truth misses failure semantics", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "agent-passport" }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ securityPosture: { mode: "normal", summary: "ok" } }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    const result = await verifyLocalLoopbackRuntime({ localBaseUrl: server.baseUrl });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.blockedBy.map((entry) => entry.id),
      ["local_release_failure_semantics", "local_automatic_recovery_failure_semantics"]
    );
  } finally {
    await server.close();
  }
});

test("verifyLocalLoopbackRuntime reports requested url and low-level cause when loopback fetch fails", async () => {
  const fetchImpl = async () => {
    const error = new Error("fetch failed");
    error.cause = new Error("connect ECONNREFUSED 127.0.0.1:4319");
    throw error;
  };

  const result = await verifyLocalLoopbackRuntime({
    localBaseUrl: "http://127.0.0.1:4319",
    fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.firstBlocker?.id, "local_health_http_ok");
  assert.match(result.firstBlocker?.detail || "", /http:\/\/127\.0\.0\.1:4319\/api\/health/u);
  assert.match(result.firstBlocker?.detail || "", /ECONNREFUSED/u);
  assert.match(result.summary || "", /http:\/\/127\.0\.0\.1:4319\/api\/health/u);
  assert.match(result.blockedBy?.[1]?.detail || "", /http:\/\/127\.0\.0\.1:4319\/api\/security/u);
});

test("buildSelfHostedGoLiveVerdict returns self_hosted_go_live_ready when local and unified checks both pass", () => {
  const verdict = buildSelfHostedGoLiveVerdict({
    localRuntime: {
      ok: true,
      status: "ready",
      checks: [],
      blockedBy: [],
      summary: "local ok",
    },
    unifiedGoLive: {
      ok: true,
      readinessClass: "go_live_ready",
      blockedBy: [],
      summary: "unified ok",
    },
  });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.readinessClass, "self_hosted_go_live_ready");
  assert.equal(verdict.errorClass, null);
  assert.equal(verdict.errorStage, null);
  assert.equal(verdict.firstBlocker, null);
  assert.equal(verdict.operatorSummary, "本机 loopback 真值、smoke:all 和公网 go-live 判定已一致通过。");
});

test("verifySelfHostedGoLive keeps unified readiness when local loopback is healthy but unified go-live blocks", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "agent-passport" }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          securityPosture: { mode: "normal", summary: "ok" },
          releaseReadiness: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
          automaticRecovery: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    const result = await verifySelfHostedGoLive({
      localBaseUrl: server.baseUrl,
      verifyGoLive: async () => ({
        ok: false,
        readinessClass: "private_pilot_only",
        blockedBy: [
          {
            id: "deploy_http_ok",
            label: "deploy HTTP 验证通过",
            detail: "公网 deploy 验证仍未通过。",
            nextAction: "先修复 deploy 验证。",
            source: "unified",
          },
        ],
        summary: "公网 deploy 验证仍未通过。",
        nextAction: "先修复 deploy 验证。",
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.readinessClass, "private_pilot_only");
    assert.equal(result.blockedBy[0].id, "deploy_http_ok");
    assert.match(result.operatorSummary || "", /阻塞项：deploy HTTP 验证通过/u);
    assert.match(result.operatorSummary || "", /下一步：先修复 deploy 验证/u);
  } finally {
    await server.close();
  }
});

test("verifySelfHostedGoLive forwards envFilePath into unified go-live verifier", async () => {
  const envFilePath = "/tmp/agent-passport-self-hosted-forward.env";
  let capturedOptions = null;
  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "agent-passport" }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          securityPosture: { mode: "normal", summary: "ok" },
          releaseReadiness: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
          automaticRecovery: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    const result = await verifySelfHostedGoLive({
      localBaseUrl: server.baseUrl,
      envFilePath,
      verifyGoLive: async (options) => {
        capturedOptions = options;
        return {
          ok: true,
          readinessClass: "go_live_ready",
          blockedBy: [],
          summary: "unified ok",
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(capturedOptions?.envFilePath, envFilePath);
  } finally {
    await server.close();
  }
});

test("verifySelfHostedGoLive surfaces config_env_unreadable when deploy env path is not readable as a file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-self-hosted-local-crash-"));

  try {
    const result = await verifySelfHostedGoLive({
      envFilePath: tempDir,
    });

    assert.equal(result.ok, false);
    assert.equal(result.readinessClass, "host_local_runtime_blocked");
    assert.equal(result.errorClass, "config_env_unreadable");
    assert.equal(result.errorStage, "local");
    assert.equal(result.firstBlocker?.id, "deploy_env_file_readable");
    assert.equal(result.firstBlocker?.actual, tempDir);
    assert.equal(result.unifiedSkipped, true);
    assert.equal(result.unifiedSkipReason, "config_env_unreadable");
    assert.equal(result.summary, `无法读取 deploy 配置文件：${tempDir}（EISDIR）。`);
    assert.match(result.nextAction || "", /verify:go-live:self-hosted/u);
    assert.match(result.nextAction || "", new RegExp(tempDir.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.equal(result.effectiveConfig?.machineReadableCommand, "npm run --silent verify:go-live:self-hosted");
    assert.equal(result.effectiveConfig?.localBaseUrl, "http://127.0.0.1:4319");
    assert.deepEqual(result.effectiveConfig?.configEnvFiles, []);
    assert.equal(result.unifiedGoLive?.skipped, true);
    assert.equal(result.unifiedGoLive?.skipReason, "config_env_unreadable");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verifySelfHostedGoLive still returns structured local_runtime_unexpected_error when local base url parsing crashes", async () => {
  const badLocalBaseUrl = {
    [Symbol.toPrimitive]() {
      throw new Error("bad local base url");
    },
  };

  const result = await verifySelfHostedGoLive({
    localBaseUrl: badLocalBaseUrl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.readinessClass, "host_local_runtime_blocked");
  assert.equal(result.errorClass, "local_runtime_unexpected_error");
  assert.equal(result.errorStage, "local");
  assert.equal(result.firstBlocker?.id, "local_runtime_unexpected_error");
  assert.equal(result.localRuntime?.baseUrl, "http://127.0.0.1:4319");
  assert.equal(result.effectiveConfig?.machineReadableCommand, "npm run --silent verify:go-live:self-hosted");
  assert.equal(result.effectiveConfig?.localBaseUrl, "http://127.0.0.1:4319");
  assert.equal(result.unifiedSkipped, true);
  assert.equal(result.unifiedSkipReason, "local_runtime_unexpected_error");
  assert.equal(result.unifiedGoLive?.skipped, true);
  assert.equal(result.unifiedGoLive?.skipReason, "local_runtime_unexpected_error");
});

test("verifySelfHostedGoLive short-circuits unified go-live when local loopback is blocked", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-self-hosted-short-circuit-"));
  const envFilePath = path.join(tempDir, "agent-passport.env");
  const previousTokenPath = process.env.AGENT_PASSPORT_ADMIN_TOKEN_PATH;
  const previousTokenAccount = process.env.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT;
  let verifyGoLiveCalled = false;

  process.env.AGENT_PASSPORT_ADMIN_TOKEN_PATH = path.join(tempDir, ".missing-admin-token");
  process.env.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT = "self-hosted-short-circuit-test";

  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "wrong-service" }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          securityPosture: { mode: "review", summary: "needs review" },
          releaseReadiness: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
          automaticRecovery: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    await writeFile(
      envFilePath,
      "AGENT_PASSPORT_DEPLOY_BASE_URL=https://deploy.example.com\nAGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=test-token\n",
      "utf8"
    );

    const result = await verifySelfHostedGoLive({
      localBaseUrl: server.baseUrl,
      envFilePath,
      verifyGoLive: async () => {
        verifyGoLiveCalled = true;
        return {
          ok: true,
          readinessClass: "go_live_ready",
          blockedBy: [],
          summary: "unified ok",
        };
      },
    });

    assert.equal(verifyGoLiveCalled, false);
    assert.equal(result.ok, false);
    assert.equal(result.readinessClass, "host_local_runtime_blocked");
    assert.equal(result.errorClass, "local_runtime_blocked");
    assert.equal(result.errorStage, "local");
    assert.equal(result.firstBlocker?.id, "local_service_name");
    assert.equal(result.preflightShortCircuited, false);
    assert.equal(result.unifiedSkipped, true);
    assert.equal(result.unifiedSkipReason, "local_runtime_blocked");
    assert.equal(result.summary, "当前本机端口返回的不是 agent-passport 服务真值。");
    assert.equal(
      result.nextAction,
      "先确认本机端口、反向代理和运行中的服务实例没有串位，再重新运行 verify:go-live:self-hosted。"
    );
    assert.equal(result.deploy?.baseUrl, "https://deploy.example.com");
    assert.equal(result.unifiedGoLive?.skipped, true);
    assert.equal(result.unifiedGoLive?.skipReason, "local_runtime_blocked");
    assert.equal(result.unifiedGoLive?.deploy?.baseUrl, "https://deploy.example.com");
    assert.equal(result.effectiveConfig?.deployBaseUrl, "https://deploy.example.com");
    assert.equal(result.effectiveConfig?.deployAdminTokenProvided, true);
    assert.equal(result.effectiveConfig?.machineReadableCommand, "npm run --silent verify:go-live:self-hosted");
    assert.deepEqual(result.effectiveConfig?.configEnvFiles, [envFilePath]);
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
    if (previousTokenPath == null) {
      delete process.env.AGENT_PASSPORT_ADMIN_TOKEN_PATH;
    } else {
      process.env.AGENT_PASSPORT_ADMIN_TOKEN_PATH = previousTokenPath;
    }
    if (previousTokenAccount == null) {
      delete process.env.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT;
    } else {
      process.env.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT = previousTokenAccount;
    }
  }
});

test("verifySelfHostedGoLive surfaces unified_go_live_unexpected_error when unified verifier crashes", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "agent-passport" }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          securityPosture: { mode: "normal", summary: "ok" },
          releaseReadiness: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
          automaticRecovery: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    const result = await verifySelfHostedGoLive({
      localBaseUrl: server.baseUrl,
      verifyGoLive: async () => {
        throw new Error("unified verifier crashed");
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.readinessClass, "blocked");
    assert.equal(result.errorClass, "unified_go_live_unexpected_error");
    assert.equal(result.errorStage, "unified");
    assert.equal(result.firstBlocker?.id, "unified_go_live_unexpected_error");
    assert.equal(result.preflightShortCircuited, false);
    assert.equal(result.summary, "统一 go-live 子流程执行失败。");
    assert.match(result.nextAction || "", /verify:go-live:self-hosted/u);
    assert.equal(result.unifiedGoLive?.blockedBy?.[0]?.id, "unified_go_live_unexpected_error");
  } finally {
    await server.close();
  }
});

test("buildSelfHostedGoLiveVerdict rewrites unified nextAction to self-hosted command", () => {
  const verdict = buildSelfHostedGoLiveVerdict({
    localRuntime: {
      ok: true,
      status: "ready",
      checks: [],
      blockedBy: [],
      summary: "local ok",
      nextAction: null,
      baseUrl: "http://127.0.0.1:4319",
      baseUrlSource: "PORT",
      baseUrlSourceType: "env_file",
      baseUrlSourcePath: "/etc/agent-passport/agent-passport.env",
      configEnvFiles: ["/etc/agent-passport/agent-passport.env"],
    },
    unifiedGoLive: {
      ok: false,
      readinessClass: "local_ready_deploy_pending",
      deploy: {
        baseUrl: "https://example.com",
        baseUrlSource: "AGENT_PASSPORT_DEPLOY_BASE_URL",
        baseUrlSourceType: "env_file",
        baseUrlSourcePath: "/etc/agent-passport/agent-passport.env",
        adminTokenProvided: false,
        adminTokenSource: null,
        adminTokenSourceType: null,
        adminTokenSourcePath: null,
        configEnvFiles: ["/etc/agent-passport/agent-passport.env"],
      },
      blockedBy: [
        {
          id: "deploy_base_url_present",
          label: "已提供正式 deploy URL",
          detail: "缺少正式 deploy URL。",
          nextAction: "先设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重新运行 verify:go-live:self-hosted 或 verify:go-live。",
          rerunCommand: "npm run verify:go-live",
          machineReadableCommand: "npm run --silent verify:go-live",
          source: "unified",
        },
      ],
      summary: "本地门禁已通过，但缺少正式 deploy URL，公网 HTTP 放行仍待补齐。",
      nextAction: "先设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重新运行 verify:go-live:self-hosted 或 verify:go-live。",
      rerunCommand: "npm run verify:go-live",
      machineReadableCommand: "npm run --silent verify:go-live",
    },
  });

  assert.equal(verdict.ok, false);
  assert.equal(
    verdict.blockedBy[0]?.nextAction,
    "先设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重新运行 verify:go-live:self-hosted。"
  );
  assert.equal(verdict.firstBlocker?.id, "deploy_base_url_present");
  assert.equal(
    verdict.nextAction,
    "先设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重新运行 verify:go-live:self-hosted。"
  );
  assert.equal(
    verdict.unifiedGoLive?.nextAction,
    "先设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重新运行 verify:go-live:self-hosted。"
  );
  assert.equal(
    verdict.unifiedGoLive?.blockedBy?.[0]?.nextAction,
    "先设置 AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名，再重新运行 verify:go-live:self-hosted。"
  );
  assert.equal(verdict.unifiedGoLive?.rerunCommand, "npm run verify:go-live:self-hosted");
  assert.equal(verdict.unifiedGoLive?.machineReadableCommand, "npm run --silent verify:go-live:self-hosted");
  assert.equal(verdict.unifiedGoLive?.blockedBy?.[0]?.rerunCommand, "npm run verify:go-live:self-hosted");
  assert.equal(verdict.summary, "本地门禁已通过，但缺少正式 deploy URL，公网 HTTP 放行仍待补齐。");
  assert.equal(verdict.errorClass, "unified_go_live_blocked");
  assert.equal(verdict.errorStage, "unified");
  assert.equal(verdict.preflightShortCircuited, false);
  assert.equal(verdict.unifiedSkipped, false);
  assert.equal(verdict.unifiedSkipReason, null);
  assert.equal(verdict.deploy?.baseUrl, "https://example.com");
  assert.equal(verdict.effectiveConfig?.rerunCommand, "npm run verify:go-live:self-hosted");
  assert.equal(verdict.effectiveConfig?.machineReadableCommand, "npm run --silent verify:go-live:self-hosted");
  assert.equal(verdict.effectiveConfig?.localBaseUrl, "http://127.0.0.1:4319");
  assert.equal(verdict.effectiveConfig?.localBaseUrlSourceType, "env_file");
  assert.equal(verdict.effectiveConfig?.deployBaseUrl, "https://example.com");
  assert.equal(verdict.effectiveConfig?.deployBaseUrlSource, "AGENT_PASSPORT_DEPLOY_BASE_URL");
  assert.equal(verdict.effectiveConfig?.deployAdminTokenProvided, false);
  assert.deepEqual(verdict.effectiveConfig?.configEnvFiles, ["/etc/agent-passport/agent-passport.env"]);
});

test("buildSelfHostedGoLiveVerdict preserves browser-specific unified blocker", () => {
  const verdict = buildSelfHostedGoLiveVerdict({
    localRuntime: {
      ok: true,
      status: "ready",
      checks: [],
      blockedBy: [],
      summary: "local ok",
      nextAction: null,
      baseUrl: "http://127.0.0.1:4319",
    },
    unifiedGoLive: {
      ok: false,
      readinessClass: "blocked",
      smoke: {
        ok: false,
        browserUiSemantics: {
          status: "failed",
          summary: "browser-ui semantics: failed browser_repair_hub_semantics",
        },
      },
      deploy: {
        ok: true,
        baseUrl: "https://example.com",
        adminTokenProvided: true,
      },
      runtimeReleaseReadiness: {
        status: "ready",
      },
      blockedBy: [
        {
          id: "browser_ui_semantics",
          label: "浏览器 UI 语义未通过",
          detail: "browser-ui semantics: failed browser_repair_hub_semantics",
          actual: "failed",
          expected: "passed",
          nextAction: "先修复 browser-ui semantics，再重新运行 verify:go-live。",
          source: "smoke",
          rerunCommand: "npm run verify:go-live",
          machineReadableCommand: "npm run --silent verify:go-live",
        },
      ],
      summary: "browser-ui semantics: failed browser_repair_hub_semantics",
      nextAction: "先修复 browser-ui semantics，再重新运行 verify:go-live。",
      rerunCommand: "npm run verify:go-live",
      machineReadableCommand: "npm run --silent verify:go-live",
    },
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.firstBlocker?.id, "browser_ui_semantics");
  assert.equal(verdict.firstBlocker?.source, "smoke");
  assert.equal(verdict.firstBlocker?.actual, "failed");
  assert.match(verdict.summary || "", /browser_repair_hub_semantics/u);
  assert.match(verdict.operatorSummary || "", /阻塞项：浏览器 UI 语义未通过/u);
  assert.equal(verdict.firstBlocker?.rerunCommand, "npm run verify:go-live:self-hosted");
  assert.equal(verdict.unifiedGoLive?.blockedBy?.[0]?.rerunCommand, "npm run verify:go-live:self-hosted");
});

test("verify-self-hosted CLI never leaks bare verify:go-live when deploy url and token are missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-self-hosted-cli-test-"));
  const smokeScriptPath = path.join(tempDir, "fake-smoke-all.mjs");
  const missingTokenPath = path.join(tempDir, ".missing-admin-token");
  const missingEnvFilePath = path.join(tempDir, "missing.env");

  await writeFile(
    smokeScriptPath,
    `console.log(JSON.stringify(${JSON.stringify({
      ok: true,
      mode: "test",
      offlineFanoutGate: { status: "passed", summary: "ok" },
      protectiveStateSemantics: { status: "passed", summary: "ok" },
      operationalFlowSemantics: { status: "passed", summary: "ok" },
      runtimeEvidenceSemantics: { status: "passed", summary: "ok" },
      browserUiSemantics: { status: "passed", summary: "ok" },
    })}));\n`,
    "utf8"
  );

  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "agent-passport" }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          securityPosture: { mode: "normal", summary: "ok" },
          releaseReadiness: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
          automaticRecovery: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    const result = await runVerifySelfHostedCli({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL: server.baseUrl,
      AGENT_PASSPORT_SMOKE_ALL_SCRIPT: smokeScriptPath,
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: missingTokenPath,
      AGENT_PASSPORT_DEPLOY_ENV_FILE: missingEnvFilePath,
      AGENT_PASSPORT_DEPLOY_BASE_URL: null,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN: null,
      AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: null,
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-self-hosted CLI should print JSON");
    assert.equal(result.json.ok, false);
    assert.equal(result.json.readinessClass, "local_ready_deploy_pending");
    assert.equal(result.json.errorClass, "missing_deploy_base_url");
    assert.equal(result.json.errorStage, "preflight");
    assert.equal(result.json.firstBlocker?.id, "deploy_base_url_present");
    assert.equal(result.json.preflightShortCircuited, false);
    assert.equal(result.json.unifiedSkipped, false);
    assert.equal(result.json.unifiedSkipReason, null);
    assert.equal(result.json.summary, "本地门禁已通过，但缺少正式 deploy URL，公网 HTTP 放行仍待补齐。");
    assert.equal(result.json.deploy?.baseUrl, null);
    assert.equal(result.json.smoke?.ok, true);
    assert.equal(result.json.smoke?.skipped, undefined);
    assert.equal(
      result.json.unifiedGoLive?.checks?.find((entry) => entry.id === "deploy_http_ok")?.skipped,
      true
    );
    assert.equal(result.json.effectiveConfig?.rerunCommand, "npm run verify:go-live:self-hosted");
    assert.equal(result.json.effectiveConfig?.machineReadableCommand, "npm run --silent verify:go-live:self-hosted");
    assert.equal(result.json.effectiveConfig?.localBaseUrl, server.baseUrl);
    assert.ok(typeof result.json.nextAction === "string" && result.json.nextAction.length > 0);
    assert.doesNotMatch(JSON.stringify(result.json), /verify:go-live(?!:self-hosted)/u);
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-self-hosted CLI never leaks bare verify:go-live when deploy url exists but token is missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-self-hosted-cli-missing-token-test-"));
  const smokeScriptPath = path.join(tempDir, "fake-smoke-all.mjs");
  const missingTokenPath = path.join(tempDir, ".missing-admin-token");
  const missingEnvFilePath = path.join(tempDir, "missing.env");

  await writeFile(
    smokeScriptPath,
    `console.log(JSON.stringify(${JSON.stringify({
      ok: true,
      mode: "test",
      offlineFanoutGate: { status: "passed", summary: "ok" },
      protectiveStateSemantics: { status: "passed", summary: "ok" },
      operationalFlowSemantics: { status: "passed", summary: "ok" },
      runtimeEvidenceSemantics: { status: "passed", summary: "ok" },
      browserUiSemantics: { status: "passed", summary: "ok" },
    })}));\n`,
    "utf8"
  );

  const server = await startServer((req, res) => {
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
      res.end(JSON.stringify({ product: { name: "agent-passport" } }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          localStore: { ready: true },
          securityPosture: { mode: "normal", summary: "ok" },
          releaseReadiness: {
            status: "ready",
            readinessClass: "go_live_ready",
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
          automaticRecovery: {
            operatorBoundary: {
              formalFlowReady: true,
              summary: "ready",
            },
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
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
      res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ errorClass: "protected_read_token_missing", ok: false }));
      return;
    }
    if (req.url === "/api/device/setup") {
      res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    const result = await runVerifySelfHostedCli({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL: server.baseUrl,
      AGENT_PASSPORT_DEPLOY_BASE_URL: server.baseUrl,
      AGENT_PASSPORT_ALLOW_LOCAL_DEPLOY_URL: "1",
      AGENT_PASSPORT_SMOKE_ALL_SCRIPT: smokeScriptPath,
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: missingTokenPath,
      AGENT_PASSPORT_DEPLOY_ENV_FILE: missingEnvFilePath,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN: null,
      AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: null,
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-self-hosted CLI should print JSON");
    assert.equal(result.json.ok, false);
    assert.ok(Array.isArray(result.json.blockedBy));
    assert.ok(result.json.blockedBy.some((entry) => entry?.id === "admin_token_present"));
    assert.equal(result.json.errorClass, "deploy_check_failed");
    assert.equal(result.json.errorStage, "checks");
    assert.equal(result.json.firstBlocker?.id, "admin_token_present");
    assert.equal(result.json.preflightShortCircuited, false);
    assert.equal(result.json.unifiedSkipped, false);
    assert.equal(result.json.unifiedSkipReason, null);
    assert.equal(result.json.summary, "公开 deploy HTTP 检查已完成，但管理面令牌缺失，正式放行判断仍不完整。");
    assert.equal(result.json.deploy?.baseUrl, server.baseUrl);
    assert.equal(result.json.effectiveConfig?.rerunCommand, "npm run verify:go-live:self-hosted");
    assert.equal(result.json.effectiveConfig?.machineReadableCommand, "npm run --silent verify:go-live:self-hosted");
    assert.equal(result.json.effectiveConfig?.deployBaseUrl, server.baseUrl);
    assert.equal(result.json.effectiveConfig?.deployAdminTokenProvided, false);
    assert.match(result.json.nextAction || "", /verify:go-live:self-hosted/u);
    assert.doesNotMatch(result.json.nextAction || "", /verify:deploy:http/u);
    assert.ok(!result.json.blockedBy.some((entry) => entry?.nextAction === "ready"));
    assert.doesNotMatch(JSON.stringify(result.json), /verify:go-live(?!:self-hosted)/u);
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-self-hosted CLI keeps final verdict stdout machine-readable while smoke chatter goes to stderr", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-self-hosted-cli-stdout-purity-test-"));
  const smokeScriptPath = path.join(tempDir, "fake-smoke-all-with-chatter.mjs");
  const missingTokenPath = path.join(tempDir, ".missing-admin-token");
  const missingEnvFilePath = path.join(tempDir, "missing.env");

  await writeFile(
    smokeScriptPath,
    [
      `console.log("smoke stdout chatter");`,
      `console.error("smoke stderr chatter");`,
      `console.log(JSON.stringify(${JSON.stringify({
        ok: true,
        mode: "test",
        offlineFanoutGate: { status: "passed", summary: "ok" },
        protectiveStateSemantics: { status: "passed", summary: "ok" },
        operationalFlowSemantics: { status: "passed", summary: "ok" },
        runtimeEvidenceSemantics: { status: "passed", summary: "ok" },
        browserUiSemantics: { status: "passed", summary: "ok" },
      })}));`,
      "",
    ].join("\n"),
    "utf8"
  );

  const server = await startServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "agent-passport" }));
      return;
    }
    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          securityPosture: { mode: "normal", summary: "ok" },
          releaseReadiness: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
          automaticRecovery: {
            failureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    const result = await runVerifySelfHostedCli({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL: server.baseUrl,
      AGENT_PASSPORT_SMOKE_ALL_SCRIPT: smokeScriptPath,
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: missingTokenPath,
      AGENT_PASSPORT_DEPLOY_ENV_FILE: missingEnvFilePath,
      AGENT_PASSPORT_DEPLOY_BASE_URL: null,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN: null,
      AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: null,
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-self-hosted CLI should still print a JSON verdict");
    assert.ok(result.stdout.trim().startsWith("{"), "stdout should stay reserved for the final JSON verdict");
    assert.doesNotMatch(result.stdout, /smoke stdout chatter/u);
    assert.match(result.stderr, /smoke stdout chatter/u);
    assert.match(result.stderr, /smoke stderr chatter/u);
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-self-hosted CLI fatal path still emits structured JSON to stdout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-self-hosted-cli-fatal-json-test-"));
  const tempScriptPath = path.join(rootDir, "scripts", `.verify-self-hosted-go-live-fatal-${process.pid}.mjs`);
  const originalScript = await readFile(verifySelfHostedScriptPath, "utf8");
  const originalMainBlocks = [
    [
      "async function main() {",
      "  const result = await verifySelfHostedGoLive();",
      "  console.log(JSON.stringify(result, null, 2));",
      "  if (!result.ok) {",
      "    process.exit(1);",
      "  }",
      "}",
    ].join("\n"),
    [
      "async function main() {",
      "  const result = await verifySelfHostedGoLive();",
      "  await printCliResult(result);",
      "}",
    ].join("\n"),
  ];
  const fatalMainBlock = ['async function main() {', '  throw new Error("fatal main path");', "}"].join("\n");
  const patchedScript = originalMainBlocks
    .map((entry) => originalScript.replace(entry, fatalMainBlock))
    .find((entry) => entry !== originalScript) || originalScript;

  assert.notEqual(
    patchedScript,
    originalScript,
    "temporary fatal-path script should replace the original main() implementation"
  );

  await writeFile(tempScriptPath, patchedScript, "utf8");

  try {
    const result = await runNodeCli(tempScriptPath, {});
    assert.equal(result.code, 1);
    assert.ok(result.json, "fatal path should still print a JSON payload");
    assert.equal(result.json.ok, false);
    assert.match(result.json.error || "", /fatal main path/u);
    assert.ok(result.stdout.trim().startsWith("{"), "fatal path should emit JSON on stdout");
  } finally {
    await rm(tempScriptPath, { force: true });
    await rm(tempDir, { recursive: true, force: true });
  }
});

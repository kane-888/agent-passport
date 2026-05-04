import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractRenderServiceNames, summarizeRenderConfigReview } from "../scripts/verify-public-deploy-http.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const verifyScriptPath = path.join(rootDir, "scripts", "verify-public-deploy-http.mjs");
const verifyGoLiveScriptPath = path.join(rootDir, "scripts", "verify-go-live-readiness.mjs");
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
  return runNodeScript(verifyGoLiveScriptPath, {
    AGENT_PASSPORT_SKIP_GO_LIVE_RUNTIME_CONTRACTS: "0",
    AGENT_PASSPORT_GO_LIVE_RUNTIME_CONTRACT_TESTS: defaultGoLiveRuntimeContractPassPath,
    ...overrides,
  });
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

test("summarizeRenderConfigReview flags legacy render resource names", () => {
  const source = `
services:
  - type: web
    name: openneed-memory-homeostasis-engine
    disk:
      name: openneed-memory-homeostasis-data
    envVars:
      - key: OPENNEED_CHAIN_ID
        value: openneed-memory-homeostasis-engine-prod
`;

  const review = summarizeRenderConfigReview(source);
  assert.equal(review.reviewRequired, true);
  assert.deepEqual(review.serviceNames, ["openneed-memory-homeostasis-engine"]);
  assert.deepEqual(review.legacyResourceNames, [
    "openneed-memory-homeostasis-engine",
    "openneed-memory-homeostasis-data",
    "openneed-memory-homeostasis-engine-prod",
  ]);
  assert.match(review.summary, /历史 Render 资源名/u);
  assert.match(review.nextAction || "", /Render 控制台核对/u);
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
    assert.match(result.json.checks[0].detail, /候选地址探测/u);
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
      if (!authorized) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ errorClass: "protected_read_token_missing", ok: false }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ agents: [] }));
      return;
    }
    if (req.url === "/api/device/setup") {
      if (!authorized) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ errorClass: "protected_read_token_missing", ok: false }));
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
      AGENT_PASSPORT_ALLOW_LOCAL_DEPLOY_URL: "1",
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
    assert.equal(result.json.releaseReadiness?.failureSemantics?.status, "clear");
    assert.equal(result.json.releaseReadiness?.failureSemantics?.failureCount, 0);
    assert.equal(
      result.json.checks.find((entry) => entry.id === "security_release_readiness_truth")?.passed,
      true
    );
    assert.equal(
      result.json.checks.find((entry) => entry.id === "security_automatic_recovery_failure_semantics")?.passed,
      true
    );
    assert.equal(
      result.json.checks.find((entry) => entry.id === "agents_without_auth_error_class")?.passed,
      true
    );
  } finally {
    await server.close();
  }
});

test("deploy verifier loads base url and token from discovered env file", async () => {
  const adminToken = "env-file-token";
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-deploy-env-file-test-"));
  const envFilePath = path.join(tempDir, "agent-passport.env");
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
      if (!authorized) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ errorClass: "protected_read_token_missing", ok: false }));
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
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    await writeFile(
      envFilePath,
      `AGENT_PASSPORT_DEPLOY_BASE_URL=${server.baseUrl}\nAGENT_PASSPORT_ADMIN_TOKEN=${adminToken}\nAGENT_PASSPORT_ALLOW_LOCAL_DEPLOY_URL=1\n`,
      "utf8"
    );

    const result = await runVerifyPublicDeployHttp({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_DEPLOY_ENV_FILE: envFilePath,
      AGENT_PASSPORT_DEPLOY_BASE_URL: null,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN: null,
      AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: null,
    });

    assert.equal(result.code, 0);
    assert.ok(result.json, "verify-public-deploy-http should print JSON");
    assert.equal(result.json.ok, true);
    assert.equal(result.json.baseUrl, server.baseUrl);
    assert.equal(result.json.baseUrlSource, "AGENT_PASSPORT_DEPLOY_BASE_URL");
    assert.equal(result.json.baseUrlSourceType, "env_file");
    assert.equal(result.json.baseUrlSourcePath, envFilePath);
    assert.equal(result.json.adminTokenSource, "AGENT_PASSPORT_ADMIN_TOKEN");
    assert.equal(result.json.adminTokenSourceType, "env_file");
    assert.equal(
      result.json.checks.find((entry) => entry.id === "agents_without_auth_error_class")?.passed,
      true
    );
    assert.equal(result.json.adminTokenSourcePath, envFilePath);
    assert.ok(Array.isArray(result.json.configEnvFiles));
    assert.ok(result.json.configEnvFiles.includes(envFilePath));
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("missing deploy url keeps deploy verifier platform neutral when render auto discovery is off", async () => {
  const result = await runVerifyPublicDeployHttp({
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
    AGENT_PASSPORT_DEPLOY_BASE_URL: null,
    AGENT_PASSPORT_BASE_URL: null,
    AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: null,
    AGENT_PASSPORT_DEPLOY_RENDER_AUTO_DISCOVERY: null,
    AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: "env-token",
    AGENT_PASSPORT_ADMIN_TOKEN: null,
  });

  assert.equal(result.code, 1);
  assert.ok(result.json, "verify-public-deploy-http should print JSON");
  assert.equal(result.json.ok, false);
  assert.deepEqual(result.json.suggestedBaseUrls, []);
  assert.equal(result.json.renderConfigReview.reviewRelevant, false);
  assert.equal(result.json.renderConfigReview.reviewRequired, false);
  assert.doesNotMatch(result.json.checks[0].detail, /Render 候选/u);
  assert.doesNotMatch(result.json.checks[0].detail, /Render 控制台/u);
  assert.equal(result.json.firstBlocker?.id, "deploy_base_url_present");
  assert.match(result.json.blockedBy[0].nextAction || "", /AGENT_PASSPORT_DEPLOY_BASE_URL/u);
  assert.equal(result.json.rerunCommand, "npm run verify:deploy:http");
  assert.equal(result.json.machineReadableCommand, "npm run --silent verify:deploy:http");
  assert.equal(result.json.blockedBy[0].rerunCommand, "npm run verify:deploy:http");
});

test("legacy AGENT_PASSPORT_BASE_URL loopback cannot satisfy deploy verifier", async () => {
  const result = await runVerifyPublicDeployHttp({
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
    AGENT_PASSPORT_DEPLOY_BASE_URL: null,
    AGENT_PASSPORT_BASE_URL: "http://127.0.0.1:4319",
    AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: null,
    AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: "token",
    AGENT_PASSPORT_ADMIN_TOKEN: null,
    AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(os.tmpdir(), "agent-passport-missing-token"),
  });

  assert.equal(result.code, 1);
  assert.ok(result.json, "verify-public-deploy-http should print JSON");
  assert.equal(result.json.errorClass, "legacy_loopback_deploy_base_url");
  assert.equal(result.json.firstBlocker?.id, "deploy_base_url_not_legacy_loopback");
  assert.equal(result.json.baseUrlSource, "AGENT_PASSPORT_BASE_URL");
  assert.match(result.json.nextAction || "", /AGENT_PASSPORT_DEPLOY_BASE_URL/u);
});

test("explicit deploy URL must be public HTTPS unless local deploy verification is explicit", async () => {
  const result = await runVerifyPublicDeployHttp({
    AGENT_PASSPORT_USE_KEYCHAIN: "0",
    AGENT_PASSPORT_DEPLOY_BASE_URL: "http://127.0.0.1:4319",
    AGENT_PASSPORT_BASE_URL: null,
    AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: null,
    AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: "token",
    AGENT_PASSPORT_ADMIN_TOKEN: null,
    AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(os.tmpdir(), "agent-passport-missing-token"),
  });

  assert.equal(result.code, 1);
  assert.ok(result.json, "verify-public-deploy-http should print JSON");
  assert.equal(result.json.errorClass, "non_public_deploy_base_url");
  assert.equal(result.json.firstBlocker?.id, "deploy_base_url_public_https");
  assert.equal(result.json.baseUrlSource, "AGENT_PASSPORT_DEPLOY_BASE_URL");
  assert.match(result.json.nextAction || "", /https:\/\/你的公网域名/u);
});

test("explicit deploy URL rejects IPv6 private and link-local HTTPS hosts", async () => {
  for (const baseUrl of [
    "https://[fd00::1]:4319",
    "https://[fc12::1]:4319",
    "https://[fe80::1]:4319",
    "https://[::ffff:127.0.0.1]:4319",
    "https://[::ffff:10.0.0.1]:4319",
    "https://[::ffff:c0a8:1]:4319",
  ]) {
    const result = await runVerifyPublicDeployHttp({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_DEPLOY_BASE_URL: baseUrl,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: "token",
      AGENT_PASSPORT_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(os.tmpdir(), "agent-passport-missing-token"),
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-public-deploy-http should print JSON");
    assert.equal(result.json.errorClass, "non_public_deploy_base_url");
    assert.equal(result.json.firstBlocker?.id, "deploy_base_url_public_https");
  }
});

test("go-live verifier reports local_ready_deploy_pending when deploy url is missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-test-"));
  const tokenPath = path.join(tempDir, ".admin-token");
  const smokeStubPath = path.join(tempDir, "smoke-all-stub.mjs");
  await writeFile(tokenPath, "file-fallback-token\n", "utf8");
  await writeFile(
    smokeStubPath,
    `${[
      "console.log(JSON.stringify({",
      "  ok: true,",
      "  mode: 'stubbed_smoke_all',",
      "  offlineFanoutGate: { status: 'passed', summary: 'offline fan-out gate: passed' },",
      "  protectiveStateSemantics: { status: 'passed', summary: 'protective-state semantics: passed' },",
      "  operationalFlowSemantics: { status: 'passed', summary: 'operational-flow semantics: passed' },",
      "  runtimeEvidenceSemantics: { status: 'passed', summary: 'runtime-evidence semantics: passed' },",
      "  browserUiSemantics: { status: 'passed', summary: 'browser-ui semantics: passed' }",
      "}, null, 2));",
    ].join("\n")}\n`,
    "utf8"
  );

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
      AGENT_PASSPORT_SMOKE_ALL_SCRIPT: smokeStubPath,
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-go-live should print JSON");
    assert.equal(result.json.preflightShortCircuited, false);
    assert.equal(result.json.readinessClass, "local_ready_deploy_pending");
    assert.equal(result.json.firstBlocker?.id, "deploy_base_url_present");
    assert.equal(result.json.deploy.adminTokenProvided, true);
    assert.equal(result.json.deploy.adminTokenSource, "file");
    assert.equal(result.json.smoke.ok, true);
    assert.equal(result.json.smoke?.skipped, undefined);
    assert.equal(result.json.rerunCommand, "npm run verify:go-live");
    assert.equal(result.json.machineReadableCommand, "npm run --silent verify:go-live");
    assert.equal(
      result.json.checks?.find((entry) => entry.id === "deploy_http_ok")?.skipped,
      true
    );
    assert.equal(result.json.localReleaseReadiness.status, "ready");
    assert.deepEqual(
      result.json.localReleaseReadiness.checks
        .filter((entry) =>
          [
            "go_live_delivery_package_archive",
            "go_live_consistency_freeze_archive",
            "go_live_cold_start_policy",
          ].includes(entry.id)
        )
        .map((entry) => ({ id: entry.id, passed: entry.passed })),
      [
        { id: "go_live_delivery_package_archive", passed: true },
        { id: "go_live_consistency_freeze_archive", passed: true },
        { id: "go_live_cold_start_policy", passed: true },
      ]
    );
    assert.equal(result.json.archiveTruthGates?.deliveryPackage?.ok, true);
    assert.equal(result.json.archiveTruthGates?.consistencyFreeze?.ok, true);
    assert.equal(result.json.archiveTruthGates?.coldStartPlan?.ok, true);
    assert.equal(result.json.deploy.suggestedBaseUrls[0].status, 404);
    assert.deepEqual(
      result.json.blockedBy.map((entry) => entry.id),
      ["deploy_base_url_present"]
    );
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("go-live verifier reports smoke-all unstructured output as local gate blocker", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-unstructured-smoke-test-"));
  const smokeStubPath = path.join(tempDir, "smoke-all-unstructured.mjs");
  await writeFile(
    smokeStubPath,
    "console.log('smoke chatter without structured verdict');\n",
    "utf8"
  );

  try {
    const result = await runVerifyGoLiveReadiness({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_DEPLOY_BASE_URL: null,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: "token",
      AGENT_PASSPORT_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(tempDir, ".missing-admin-token"),
      AGENT_PASSPORT_SMOKE_ALL_SCRIPT: smokeStubPath,
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-go-live should print JSON");
    assert.equal(result.json.errorClass, "missing_deploy_base_url");
    assert.equal(result.json.readinessClass, "local_gate_blocked");
    assert.equal(result.json.smoke?.errorClass, "smoke_all_unstructured_output");
    assert.equal(result.json.firstBlocker?.id, "smoke_release_ok");
    assert.match(result.json.firstBlocker?.detail || "", /smoke:all exited without structured JSON verdict/u);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("go-live verifier reports smoke-all timeout as local gate blocker", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-timeout-smoke-test-"));
  const smokeStubPath = path.join(tempDir, "smoke-all-timeout.mjs");
  await writeFile(
    smokeStubPath,
    "setInterval(() => {}, 1000);\n",
    "utf8"
  );

  try {
    const result = await runVerifyGoLiveReadiness({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_DEPLOY_BASE_URL: null,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_BASE_URL_CANDIDATES: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: "token",
      AGENT_PASSPORT_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(tempDir, ".missing-admin-token"),
      AGENT_PASSPORT_SMOKE_ALL_SCRIPT: smokeStubPath,
      AGENT_PASSPORT_SMOKE_ALL_TIMEOUT_MS: "100",
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-go-live should print JSON");
    assert.equal(result.json.errorClass, "missing_deploy_base_url");
    assert.equal(result.json.readinessClass, "local_gate_blocked");
    assert.equal(result.json.smoke?.timedOut, true);
    assert.equal(result.json.smoke?.errorClass, "smoke_all_timeout");
    assert.equal(result.json.firstBlocker?.id, "smoke_release_ok");
    assert.match(result.json.firstBlocker?.detail || "", /smoke:all timed out after 100ms/u);
    assert.match(result.json.operatorSummary || "", /阻塞项：smoke:all 通过/u);
    assert.match(result.json.operatorSummary || "", /下一步：先修复 smoke:all 主流程失败项/u);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("go-live verifier routes browser-only smoke failure to browser blocker", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-browser-test-"));
  const smokeStubPath = path.join(tempDir, "smoke-all-browser-failed.mjs");
  const adminToken = "browser-failure-token";
  await writeFile(
    smokeStubPath,
    `${[
      "console.log(JSON.stringify({",
      "  ok: false,",
      "  mode: 'stubbed_smoke_all',",
      "  offlineFanoutGate: { status: 'passed', summary: 'offline fan-out gate: passed' },",
      "  protectiveStateSemantics: { status: 'passed', summary: 'protective-state semantics: passed' },",
      "  operationalFlowSemantics: { status: 'passed', summary: 'operational-flow semantics: passed' },",
      "  runtimeEvidenceSemantics: { status: 'passed', summary: 'runtime-evidence semantics: passed' },",
      "  browserUiSemantics: { status: 'failed', summary: 'browser-ui semantics: failed browser_repair_hub_semantics' }",
      "}, null, 2));",
    ].join("\n")}\n`,
    "utf8"
  );
  const server = await startServer((req, res) => {
    const authorized = (req.headers.authorization || "") === `Bearer ${adminToken}`;
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><h1>agent-passport 公开运行态</h1><a href=\"/api/security\">/api/security</a></body></html>");
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
      res.end(JSON.stringify({
        localStore: { ready: true },
        securityPosture: { mode: "normal", summary: "ok" },
        releaseReadiness: {
          status: "ready",
          readinessClass: "go_live_ready",
          failureSemantics: { status: "clear", failureCount: 0, primaryFailure: null, failures: [] },
        },
        automaticRecovery: {
          operatorBoundary: { formalFlowReady: true, summary: "ready" },
          failureSemantics: { status: "clear", failureCount: 0, primaryFailure: null, failures: [] },
        },
        constrainedExecution: { status: "ready", summary: "ready" },
      }));
      return;
    }
    if (req.url === "/api/agents") {
      res.writeHead(authorized ? 200 : 401, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(authorized ? { agents: [] } : { errorClass: "protected_read_token_missing", ok: false }));
      return;
    }
    if (req.url === "/api/device/setup") {
      if (!authorized) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        formalRecoveryFlow: {
          durableRestoreReady: true,
          runbook: { status: "ready" },
          rehearsal: { status: "fresh", summary: "fresh" },
        },
        automaticRecoveryReadiness: {
          operatorBoundary: { formalFlowReady: true, summary: "ready" },
        },
        deviceRuntime: {
          constrainedExecutionSummary: { status: "ready", summary: "ready" },
        },
      }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found\n");
  });

  try {
    const result = await runVerifyGoLiveReadiness({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_ALLOW_LOCAL_DEPLOY_URL: "1",
      AGENT_PASSPORT_DEPLOY_BASE_URL: server.baseUrl,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: adminToken,
      AGENT_PASSPORT_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(tempDir, ".missing-admin-token"),
      AGENT_PASSPORT_SMOKE_ALL_SCRIPT: smokeStubPath,
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-go-live should print JSON");
    assert.equal(result.json.deploy?.ok, true);
    assert.equal(result.json.runtimeReleaseReadiness?.status, "ready");
    assert.equal(result.json.firstBlocker?.id, "browser_ui_semantics");
    assert.equal(result.json.firstBlocker?.source, "smoke");
    assert.equal(result.json.firstBlocker?.actual, "failed");
    assert.match(result.json.firstBlocker?.detail || "", /browser_repair_hub_semantics/u);
    assert.deepEqual(
      result.json.blockedBy.map((entry) => entry.id),
      ["browser_ui_semantics"]
    );
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("go-live verifier routes runtime contract failure to local blocker", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-runtime-contract-fail-"));
  const smokeStubPath = path.join(tempDir, "smoke-all-passed.mjs");
  const runtimeContractPath = path.join(tempDir, "runtime-contract-fail.test.mjs");
  const adminToken = "runtime-contract-token";
  await writeFile(
    smokeStubPath,
    `${[
      "console.log(JSON.stringify({",
      "  ok: true,",
      "  mode: 'stubbed_smoke_all',",
      "  offlineFanoutGate: { status: 'passed', summary: 'offline fan-out gate: passed' },",
      "  protectiveStateSemantics: { status: 'passed', summary: 'protective-state semantics: passed' },",
      "  operationalFlowSemantics: { status: 'passed', summary: 'operational-flow semantics: passed' },",
      "  runtimeEvidenceSemantics: { status: 'passed', summary: 'runtime-evidence semantics: passed' },",
      "  browserUiSemantics: { status: 'passed', summary: 'browser-ui semantics: passed' }",
      "}, null, 2));",
    ].join("\n")}\n`,
    "utf8"
  );
  await writeFile(
    runtimeContractPath,
    "import test from 'node:test';\ntest('runtime contract failure', () => { throw new Error('runtime_contract_gate_failed'); });\n",
    "utf8"
  );
  const server = await startServer((req, res) => {
    const authorized = (req.headers.authorization || "") === `Bearer ${adminToken}`;
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><h1>agent-passport 公开运行态</h1><a href=\"/api/security\">/api/security</a></body></html>");
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
      res.end(JSON.stringify({
        localStore: { ready: true },
        securityPosture: { mode: "normal", summary: "ok" },
        releaseReadiness: {
          status: "ready",
          readinessClass: "go_live_ready",
          failureSemantics: { status: "clear", failureCount: 0, primaryFailure: null, failures: [] },
        },
        automaticRecovery: {
          operatorBoundary: { formalFlowReady: true, summary: "ready" },
          failureSemantics: { status: "clear", failureCount: 0, primaryFailure: null, failures: [] },
        },
        constrainedExecution: { status: "ready", summary: "ready" },
      }));
      return;
    }
    if (req.url === "/api/agents") {
      res.writeHead(authorized ? 200 : 401, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(authorized ? { agents: [] } : { errorClass: "protected_read_token_missing", ok: false }));
      return;
    }
    if (req.url === "/api/device/setup") {
      if (!authorized) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        formalRecoveryFlow: {
          durableRestoreReady: true,
          runbook: { status: "ready" },
          rehearsal: { status: "fresh", summary: "fresh" },
        },
        automaticRecoveryReadiness: {
          operatorBoundary: { formalFlowReady: true, summary: "ready" },
        },
        deviceRuntime: {
          constrainedExecutionSummary: { status: "ready", summary: "ready" },
        },
      }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found\n");
  });

  try {
    const result = await runVerifyGoLiveReadiness({
      AGENT_PASSPORT_SKIP_GO_LIVE_RUNTIME_CONTRACTS: "0",
      AGENT_PASSPORT_GO_LIVE_RUNTIME_CONTRACT_TESTS: runtimeContractPath,
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_ALLOW_LOCAL_DEPLOY_URL: "1",
      AGENT_PASSPORT_DEPLOY_BASE_URL: server.baseUrl,
      AGENT_PASSPORT_BASE_URL: null,
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: adminToken,
      AGENT_PASSPORT_ADMIN_TOKEN: null,
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(tempDir, ".missing-admin-token"),
      AGENT_PASSPORT_SMOKE_ALL_SCRIPT: smokeStubPath,
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-go-live should print JSON");
    assert.equal(result.json.firstBlocker?.id, "runtime_contracts_gate");
    assert.equal(result.json.firstBlocker?.source, "local");
    assert.match(result.json.firstBlocker?.detail || "", /runtime_contract_gate_failed/u);
    assert.deepEqual(result.json.blockedBy.map((entry) => entry.id), ["runtime_contracts_gate"]);
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("go-live verifier exposes firstBlocker when deploy verifier crashes before preflight completes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-crash-test-"));

  try {
    const result = await runVerifyGoLiveReadiness({
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
      AGENT_PASSPORT_DEPLOY_ENV_FILE: tempDir,
    });

    assert.equal(result.code, 1);
    assert.ok(result.json, "verify-go-live should print JSON");
    assert.equal(result.json.ok, false);
    assert.equal(result.json.preflightShortCircuited, true);
    assert.equal(result.json.smoke?.skipped, true);
    assert.equal(result.json.firstBlocker?.id, "deploy_verifier_unexpected_error");
    assert.match(result.json.nextAction || "", /verify:go-live/u);
    assert.equal(result.json.rerunCommand, "npm run verify:go-live");
    assert.equal(result.json.machineReadableCommand, "npm run --silent verify:go-live");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

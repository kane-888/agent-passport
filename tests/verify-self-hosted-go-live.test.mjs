import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSelfHostedGoLiveVerdict,
  verifyLocalLoopbackRuntime,
  verifySelfHostedGoLive,
} from "../scripts/verify-self-hosted-go-live.mjs";

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

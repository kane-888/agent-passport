import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectPublicStatus } from "../scripts/ops-public-status.mjs";

async function startStatusServer({ adminToken = "ops-token", icpRecordNumber = "粤ICP备2026067759号-1" } = {}) {
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization || "";
    const authorized = auth === `Bearer ${adminToken}`;

    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, ready: true, service: "agent-passport", hostBinding: "127.0.0.1" }));
      return;
    }

    if (req.url === "/api/security") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          securityPosture: { mode: "normal", summary: "ok" },
          releaseReadiness: {
            status: "ready",
            readinessClass: "go_live_ready",
            failureSemantics: { status: "clear", failureCount: 0, primaryFailure: null },
          },
        })
      );
      return;
    }

    if (req.url === "/api/public-config") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "agent-passport",
          compliance: {
            icp: {
              configured: Boolean(icpRecordNumber),
              recordNumber: icpRecordNumber || null,
              recordUrl: icpRecordNumber ? "https://beian.miit.gov.cn" : null,
            },
          },
        })
      );
      return;
    }

    if (req.url === "/api/device/setup") {
      if (!authorized) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, errorClass: "protected_read_token_missing" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, formalRecoveryFlow: { durableRestoreReady: true } }));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found\n");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

test("ops public status writes successful endpoint summary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-ops-status-"));
  const statusPath = path.join(tempDir, "last-public-status.json");
  const server = await startStatusServer();
  const previousStatusPath = process.env.AGENT_PASSPORT_OPS_STATUS_PATH;
  try {
    process.env.AGENT_PASSPORT_OPS_STATUS_PATH = statusPath;
    const result = await collectPublicStatus({
      baseUrl: server.baseUrl,
      adminToken: "ops-token",
    });

    assert.equal(result.ok, true);
    assert.equal(result.endpoints.health.data.ready, true);
    assert.equal(result.endpoints.health.data.hostBinding, "127.0.0.1");
    assert.equal(result.statusPath, statusPath);

    const written = JSON.parse(await readFile(statusPath, "utf8"));
    assert.equal(written.ok, true);
    assert.equal(written.adminTokenProvided, true);
  } finally {
    if (previousStatusPath === undefined) {
      delete process.env.AGENT_PASSPORT_OPS_STATUS_PATH;
    } else {
      process.env.AGENT_PASSPORT_OPS_STATUS_PATH = previousStatusPath;
    }
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ops public status does not require ICP for loopback checks", async () => {
  const server = await startStatusServer({ icpRecordNumber: "" });
  try {
    const result = await collectPublicStatus({
      baseUrl: server.baseUrl,
      adminToken: "ops-token",
      envFilePath: path.join(os.tmpdir(), "agent-passport-missing-env-file"),
    });

    assert.equal(result.ok, true);
    const icpCheck = result.checks.find((entry) => entry.id === "icp_record_configured");
    assert.equal(icpCheck?.passed, true);
    assert.equal(icpCheck?.skipped, true);
  } finally {
    await server.close();
  }
});

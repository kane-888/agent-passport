import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  allocateEphemeralLoopbackBaseUrl,
  ensureSmokeServer,
  prepareSmokeDataRoot,
  probeHealth,
} from "../scripts/smoke-server.mjs";
import { ensureSmokeLedgerInitialized } from "../scripts/smoke-env.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForJson(url, { timeoutMs = 5000 } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function createProductFlowRuntime(label) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-passport-product-flow-${label}-`));
  return {
    tmpDir,
    adminToken: `product-flow-admin-${label}`,
    env: {
      AGENT_PASSPORT_LEDGER_PATH: path.join(tmpDir, "ledger.json"),
      AGENT_PASSPORT_READ_SESSION_STORE_PATH: path.join(tmpDir, "read-sessions.json"),
      AGENT_PASSPORT_STORE_KEY_PATH: path.join(tmpDir, ".ledger-key"),
      AGENT_PASSPORT_SIGNING_SECRET_PATH: path.join(tmpDir, ".did-signing-master-secret"),
      AGENT_PASSPORT_RECOVERY_DIR: path.join(tmpDir, "recovery-bundles"),
      AGENT_PASSPORT_SETUP_PACKAGE_DIR: path.join(tmpDir, "device-setup-packages"),
      AGENT_PASSPORT_ARCHIVE_DIR: path.join(tmpDir, "archives"),
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(tmpDir, ".admin-token"),
      AGENT_PASSPORT_ADMIN_TOKEN: `product-flow-admin-${label}`,
      AGENT_PASSPORT_SIGNING_MASTER_SECRET: `product-flow-signing-secret-${label}`,
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
    },
  };
}

async function requestJson(baseUrl, route, { method = "GET", token = null, body = undefined } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const responseBody = await response.text();
  let payload = {};
  try {
    payload = responseBody ? JSON.parse(responseBody) : {};
  } catch {
    payload = { raw: responseBody };
  }
  if (!response.ok) {
    const error = new Error(`${method} ${route} failed with HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function withHealthServer(payload, callback) {
  const server = createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("probeHealth can require the owned smoke server id", async () => {
  await withHealthServer({ ok: true, smokeServerId: "owned-smoke" }, async (baseUrl) => {
    assert.equal(await probeHealth(baseUrl), true);
    assert.equal(await probeHealth(baseUrl, { expectedSmokeServerId: "owned-smoke" }), true);
    assert.equal(await probeHealth(baseUrl, { expectedSmokeServerId: "other-smoke" }), false);
  });
});

test("public API HEAD probes use the same route truth as GET without response bodies", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-head-api-test-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    for (const route of ["/api/health", "/api/security"]) {
      const response = await fetch(`${baseUrl}${route}`, { method: "HEAD" });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /application\/json/u);
      assert.equal(body, "");
    }
    const adminToken = fs.readFileSync(prepared.isolationEnv.AGENT_PASSPORT_ADMIN_TOKEN_PATH, "utf8").trim();
    for (const route of ["/api/agents", "/api/device/setup"]) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /application\/json/u);
      assert.equal(body, "");
    }
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("health success response exposes readiness and host binding", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-health-ready-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.ready, true);
    assert.equal(body.hostBinding, "127.0.0.1");
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("public JavaScript modules are served with module-compatible content type", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-public-js-assets-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    for (const route of [
      "/admin-token-storage-compat.js",
      "/offline-chat-app.js",
      "/operator-decision-canonical.js",
      "/runtime-housekeeping-storage-compat.js",
      "/runtime-truth-client.js",
      "/ui-links.js",
    ]) {
      const response = await fetch(`${baseUrl}${route}`);
      const body = await response.text();

      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type") || "", /application\/javascript/u, route);
      assert.match(body, /\S/u, route);
    }
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("public image assets are served with image content type", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-public-image-assets-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    const expectedImageTypes = new Map([
      ["/assets/home-cosmic-nebula.jpg", /image\/jpeg/u],
      ["/assets/public-security-record-icon.png", /image\/png/u],
    ]);

    for (const [route, expectedContentType] of expectedImageTypes) {
      const response = await fetch(`${baseUrl}${route}`, { method: "HEAD" });
      const body = await response.text();

      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type") || "", expectedContentType, route);
      assert.equal(body, "", route);
    }
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("public download assets are served from the downloads directory without traversal", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-public-download-assets-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    const manifestResponse = await fetch(`${baseUrl}/downloads/agent-passport-desktop-manifest.json`, {
      method: "HEAD",
    });
    const manifestBody = await manifestResponse.text();

    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get("content-type") || "", /application\/json/u);
    assert.equal(manifestBody, "");

    const traversalResponse = await fetch(`${baseUrl}/downloads/../index.html`);
    assert.equal(traversalResponse.status, 404);
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("public config exposes configured ICP compliance metadata", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-public-config-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
      extraEnv: {
        ...prepared.isolationEnv,
        AGENT_PASSPORT_ICP_RECORD_NUMBER: "粤ICP备12345678号-1",
        AGENT_PASSPORT_PUBLIC_SECURITY_RECORD_NUMBER: "粤公网安备12345678901234号",
        AGENT_PASSPORT_PUBLIC_SECURITY_RECORD_URL:
          "https://beian.mps.gov.cn/#/query/webSearch?code=12345678901234",
        AGENT_PASSPORT_DOWNLOAD_VERSION: "0.1.0-alpha",
        AGENT_PASSPORT_DOWNLOAD_MACOS_URL: "https://agent-passport.cn/downloads/agent-passport-macos.dmg",
        AGENT_PASSPORT_DOWNLOAD_WINDOWS_URL: "https://agent-passport.cn/downloads/agent-passport-windows.exe",
        AGENT_PASSPORT_DOWNLOAD_LINUX_URL: "https://agent-passport.cn/downloads/agent-passport-linux.AppImage",
      },
  });

  try {
    const response = await fetch(`${baseUrl}/api/public-config`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.surface.mode, "local");
    assert.equal(body.surface.publicWebsite, false);
    assert.equal(body.surface.localUiAvailable, true);
    assert.equal(body.compliance.icp.configured, true);
    assert.equal(body.compliance.icp.recordNumber, "粤ICP备12345678号-1");
    assert.equal(body.compliance.icp.recordUrl, "https://beian.miit.gov.cn");
    assert.equal(body.compliance.publicSecurity.configured, true);
    assert.equal(body.compliance.publicSecurity.recordNumber, "粤公网安备12345678901234号");
    assert.equal(
      body.compliance.publicSecurity.recordUrl,
      "https://beian.mps.gov.cn/#/query/webSearch?code=12345678901234"
    );
    assert.equal(body.legal.privacyPolicyUrl, "/privacy");
    assert.equal(body.legal.termsUrl, "/terms");
    assert.equal(body.legal.contactUrl, "/contact");
    assert.equal(body.downloads.version, "0.1.0-alpha");
    assert.equal(body.downloads.platforms.macos.url, "https://agent-passport.cn/downloads/agent-passport-macos.dmg");
    assert.equal(body.downloads.platforms.windows.url, "https://agent-passport.cn/downloads/agent-passport-windows.exe");
    assert.equal(body.downloads.platforms.linux.url, "https://agent-passport.cn/downloads/agent-passport-linux.AppImage");
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("local home keeps product entry markers without exposing operator flow links statically", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-local-home-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: {
      ...prepared.isolationEnv,
      AGENT_PASSPORT_SURFACE_MODE: "local",
    },
  });

  try {
    const response = await fetch(`${baseUrl}/`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /data-local-home/u);
    assert.match(body, /data-local-create/u);
    assert.match(body, /data-local-login/u);
    assert.match(body, /创建 Passport/u);
    assert.match(body, /登录 \/ 恢复 Passport/u);
    assert.doesNotMatch(body, /href="\/operator\?flow=create-passport"/u);
    assert.doesNotMatch(body, /href="\/operator\?flow=login-passport"/u);
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("public surface mode hides local workspace pages", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-public-surface-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: {
      ...prepared.isolationEnv,
      AGENT_PASSPORT_SURFACE_MODE: "public",
    },
  });

  try {
    const publicConfigResponse = await fetch(`${baseUrl}/api/public-config`);
    const publicConfig = await publicConfigResponse.json();
    assert.equal(publicConfigResponse.status, 200);
    assert.equal(publicConfig.surface.mode, "public");
    assert.equal(publicConfig.surface.publicWebsite, true);
    assert.equal(publicConfig.surface.localUiAvailable, false);

    for (const route of [
      "/operator",
      "/lab.html",
      "/repair-hub",
      "/offline-chat",
      "/agents",
      "/agents/new",
      "/agent-detail.html",
      "/agent-memories.html",
      "/agent-chat.html",
      "/recovery/import",
      "/recovery-import.html",
    ]) {
      const response = await fetch(`${baseUrl}${route}`);
      const body = await response.text();
      assert.equal(response.status, 404, route);
      assert.match(body, /只在本地软件内使用/u, route);
    }
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("local Agent Passport product routes are served as static HTML", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-local-product-routes-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    const expectedRoutes = [
      ["/agents", "管理你的长期 AI 同事"],
      ["/agents/new", "创建一个长期 AI 同事"],
      ["/agents/agent_smoke", "Agent 身份护照"],
      ["/agents/agent_smoke/memories", "管理 Agent 记忆"],
      ["/agents/agent_smoke/chat", "Agent 聊天入口"],
      ["/recovery/import", "换设备继续使用 Agent"],
    ];

    for (const [route, expectedText] of expectedRoutes) {
      const response = await fetch(`${baseUrl}${route}`);
      const body = await response.text();

      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type") || "", /text\/html/u, route);
      assert.match(body, new RegExp(expectedText, "u"), route);
    }
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("Agent Passport product HTTP flow restores an Agent on a new device", async () => {
  const sourceRuntime = createProductFlowRuntime("source");
  const targetRuntime = createProductFlowRuntime("target");
  const sourceBaseUrl = await allocateEphemeralLoopbackBaseUrl();
  const targetBaseUrl = await allocateEphemeralLoopbackBaseUrl();
  await ensureSmokeLedgerInitialized(sourceRuntime.env);
  await ensureSmokeLedgerInitialized(targetRuntime.env);
  const sourceServer = await ensureSmokeServer(sourceBaseUrl, {
    reuseExisting: false,
    extraEnv: sourceRuntime.env,
  });
  let targetServer = null;
  const passphrase = "product flow recovery passphrase";

  try {
    const agentResponse = await requestJson(sourceBaseUrl, "/api/agents", {
      method: "POST",
      token: sourceRuntime.adminToken,
      body: {
        displayName: "Product Flow Agent",
        role: "local_ai_colleague",
        controller: "Kane",
      },
    });
    const agentId = agentResponse.agent?.agentId;
    assert.match(agentId || "", /^agent_/u);

    await requestJson(sourceBaseUrl, `/api/agents/${encodeURIComponent(agentId)}/runtime/bootstrap`, {
      method: "POST",
      token: sourceRuntime.adminToken,
      body: {
        displayName: "Product Flow Agent",
        role: "local_ai_colleague",
        longTermGoal: "验证普通用户 Agent Passport 产品闭环",
        stablePreferences: "中文、简洁、先完成闭环",
        title: "完成跨设备恢复演练",
        currentGoal: "验证普通用户 Agent Passport 产品闭环",
        currentPlan: "创建、写入记忆、导出恢复资料、换设备继续使用",
        nextAction: "导入恢复资料并检查上下文",
        createDefaultCommitment: true,
        sourceWindowId: "agent_create_page",
      },
    });

    const memoryResponse = await requestJson(sourceBaseUrl, `/api/agents/${encodeURIComponent(agentId)}/passport-memory`, {
      method: "POST",
      token: sourceRuntime.adminToken,
      body: {
        layer: "profile",
        kind: "product_flow_marker",
        summary: "Product flow memory marker",
        content: "This memory proves the restored Agent kept its Passport memory.",
        payload: {
          marker: "product-flow-survived",
        },
        tags: ["product-flow", "cross-device"],
        recordedByAgentId: agentId,
        sourceWindowId: "agent_create_page",
      },
    });
    assert.match(memoryResponse.memory?.passportMemoryId || "", /^pmem_/u);

    const sourceDetail = await requestJson(sourceBaseUrl, `/api/agents/${encodeURIComponent(agentId)}`, {
      token: sourceRuntime.adminToken,
    });
    const sourceDid = sourceDetail.agent?.identity?.did;
    assert.match(sourceDid || "", /^did:/u);

    const setup = await requestJson(sourceBaseUrl, "/api/device/setup", {
      method: "POST",
      token: sourceRuntime.adminToken,
      body: {
        residentAgentId: agentId,
        residentDidMethod: "agentpassport",
        displayName: "Product Flow Agent",
        role: "local_ai_colleague",
        currentGoal: "验证普通用户 Agent Passport 产品闭环",
        stablePreferences: "中文、简洁、先完成闭环",
        recoveryPassphrase: passphrase,
        requireRecoveryBackup: true,
        includeLocalReasonerProfiles: false,
        recoveryNote: "product flow recovery bundle",
        setupPackageNote: "product flow setup package",
      },
    });
    const bundle = setup.recoveryExport?.bundle;
    const setupPackage = setup.setupPackageExport?.package;
    const recoveryBundleId = setup.recoveryExport?.summary?.bundleId;
    const setupPackageId = setup.setupPackageExport?.summary?.packageId;
    assert.equal(setup.setup?.recoveryBackup?.status, "backup_artifacts_ready");
    assert.equal(setup.recoveryRehearsal?.status, "passed");
    assert.ok(bundle, "device setup should return a downloadable recovery bundle");
    assert.ok(setupPackage, "device setup should return a downloadable setup package");
    assert.equal(JSON.stringify(setupPackage).includes(passphrase), false);

    const confirmed = await requestJson(
      sourceBaseUrl,
      `/api/agents/${encodeURIComponent(agentId)}/recovery-backup/confirm`,
      {
        method: "POST",
        token: sourceRuntime.adminToken,
        body: {
          recoveryBundleId,
          setupPackageId,
          rehearsalStatus: "passed",
          confirmations: {
            savedRecoveryBundle: true,
            savedSetupPackage: true,
            savedRecoveryPassphrase: true,
            understandsLoss: true,
          },
        },
      }
    );
    assert.equal(confirmed.recoveryBackup?.status, "backup_completed");
    assert.equal(JSON.stringify(confirmed.recoveryBackup).includes(passphrase), false);

    targetServer = await ensureSmokeServer(targetBaseUrl, {
      reuseExisting: false,
      extraEnv: targetRuntime.env,
    });

    const wrongPassphrase = await fetch(`${targetBaseUrl}/api/device/runtime/recovery/verify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${targetRuntime.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        passphrase: "wrong product flow recovery passphrase",
        bundleJson: JSON.stringify(bundle),
        dryRun: true,
        persist: false,
      }),
    });
    assert.equal(wrongPassphrase.ok, false);

    const verified = await requestJson(targetBaseUrl, "/api/device/runtime/recovery/verify", {
      method: "POST",
      token: targetRuntime.adminToken,
      body: {
        passphrase,
        bundleJson: JSON.stringify(bundle),
        dryRun: true,
        persist: false,
        note: "product flow recovery verification",
      },
    });
    assert.ok(["passed", "partial"].includes(verified.rehearsal?.status), verified.rehearsal?.status);

    const dryRunRecovery = await requestJson(targetBaseUrl, "/api/device/runtime/recovery/import", {
      method: "POST",
      token: targetRuntime.adminToken,
      body: {
        passphrase,
        bundleJson: JSON.stringify(bundle),
        dryRun: true,
        overwrite: true,
        restoreLedger: true,
        importStoreKeyTo: "file",
      },
    });
    assert.equal(dryRunRecovery.dryRun, true);
    assert.equal(dryRunRecovery.summary?.bundleId, recoveryBundleId);

    const importedRecovery = await requestJson(targetBaseUrl, "/api/device/runtime/recovery/import", {
      method: "POST",
      token: targetRuntime.adminToken,
      body: {
        passphrase,
        bundleJson: JSON.stringify(bundle),
        dryRun: false,
        overwrite: true,
        restoreLedger: true,
        importStoreKeyTo: "file",
      },
    });
    assert.equal(importedRecovery.restoredLedger, true);
    assert.equal(importedRecovery.summary?.bundleId, recoveryBundleId);

    const dryRunSetup = await requestJson(targetBaseUrl, "/api/device/setup/package/import", {
      method: "POST",
      token: targetRuntime.adminToken,
      body: {
        packageJson: JSON.stringify(setupPackage),
        dryRun: true,
        allowResidentRebind: true,
        importLocalReasonerProfiles: false,
      },
    });
    assert.equal(dryRunSetup.dryRun, true);

    const importedSetup = await requestJson(targetBaseUrl, "/api/device/setup/package/import", {
      method: "POST",
      token: targetRuntime.adminToken,
      body: {
        packageJson: JSON.stringify(setupPackage),
        dryRun: false,
        allowResidentRebind: true,
        importLocalReasonerProfiles: false,
      },
    });
    assert.equal(importedSetup.summary?.packageId, setupPackageId);

    const targetAgents = await requestJson(targetBaseUrl, "/api/agents", {
      token: targetRuntime.adminToken,
    });
    assert.equal(targetAgents.agents?.some((agent) => agent.agentId === agentId), true);

    const targetDetail = await requestJson(targetBaseUrl, `/api/agents/${encodeURIComponent(agentId)}`, {
      token: targetRuntime.adminToken,
    });
    assert.equal(targetDetail.agent?.identity?.did, sourceDid);
    assert.notEqual(
      targetDetail.agent?.recoveryBackup?.status,
      "backup_completed",
      "new device must not inherit the source-side user confirmation"
    );

    const targetMemories = await requestJson(
      targetBaseUrl,
      `/api/agents/${encodeURIComponent(agentId)}/passport-memory?kind=product_flow_marker&limit=10`,
      { token: targetRuntime.adminToken }
    );
    assert.equal(targetMemories.counts?.total, 1);
    assert.equal(targetMemories.memories?.[0]?.payload?.marker, "product-flow-survived");

    const targetSetup = await requestJson(targetBaseUrl, "/api/device/setup", {
      token: targetRuntime.adminToken,
    });
    const residentAgentId =
      targetSetup.residentAgentId ||
      targetSetup.resolvedResidentAgentId ||
      targetSetup.deviceRuntime?.residentAgentId ||
      targetSetup.deviceRuntime?.resolvedResidentAgentId;
    assert.equal(residentAgentId, agentId);

    const rehydrate = await requestJson(targetBaseUrl, `/api/agents/${encodeURIComponent(agentId)}/runtime/rehydrate`, {
      token: targetRuntime.adminToken,
    });
    assert.equal(rehydrate.rehydrate?.agentId, agentId);
    assert.equal(rehydrate.rehydrate?.identity?.did, sourceDid);
  } finally {
    await targetServer?.stop?.();
    await sourceServer.stop();
    fs.rmSync(sourceRuntime.tmpDir, { recursive: true, force: true });
    fs.rmSync(targetRuntime.tmpDir, { recursive: true, force: true });
  }
});

test("public legal pages are served as static HTML", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-public-legal-pages-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    for (const [route, expectedText] of [
      ["/privacy", "隐私政策"],
      ["/terms", "用户协议"],
      ["/contact", "联系方式"],
    ]) {
      const response = await fetch(`${baseUrl}${route}`);
      const body = await response.text();

      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type") || "", /text\/html/u, route);
      assert.match(body, new RegExp(expectedText, "u"), route);
    }
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("operator page carries create and login passport flow copy", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-operator-flow-copy-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    const response = await fetch(`${baseUrl}/operator?flow=create-passport`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /创建 Passport/u);
    assert.match(body, /登录 \/ 恢复身份/u);
    assert.match(body, /开始创建并备份/u);
    assert.match(body, /导入恢复资料/u);
    assert.match(body, /查看当前检查结果/u);
    assert.match(body, /需要访问口令时再验证/u);
    assert.match(body, /id="operator-flow-quaternary-action"/u);
    assert.match(body, /没有提示需要验证时/u);
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("server prefers canonical admin header while keeping legacy header as compatibility fallback", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-admin-header-precedence-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    const adminToken = fs.readFileSync(prepared.isolationEnv.AGENT_PASSPORT_ADMIN_TOKEN_PATH, "utf8").trim();

    const canonicalPreferredResponse = await fetch(`${baseUrl}/api/agents`, {
      headers: {
        "x-agent-passport-admin-token": adminToken,
        "x-openneed-admin-token": "invalid-legacy-token",
      },
    });
    assert.equal(canonicalPreferredResponse.status, 200);

    const legacyFallbackResponse = await fetch(`${baseUrl}/api/agents`, {
      headers: {
        "x-openneed-admin-token": adminToken,
      },
    });
    assert.equal(legacyFallbackResponse.status, 200);
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("isolated smoke data root includes read-session store isolation", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-smoke-server-test-",
  });
  try {
    assert.match(prepared.isolationEnv.AGENT_PASSPORT_LEDGER_PATH, /ledger\.json$/);
    assert.match(prepared.isolationEnv.AGENT_PASSPORT_READ_SESSION_STORE_PATH, /read-sessions\.json$/);
    assert.equal(
      prepared.isolationEnv.AGENT_PASSPORT_READ_SESSION_STORE_PATH.startsWith(
        prepared.isolationEnv.AGENT_PASSPORT_LEDGER_PATH.replace(/ledger\.json$/u, "")
      ),
      true
    );
  } finally {
    await prepared.cleanup();
  }
});

test("health reports an uninitialized local store as not ready", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-health-empty-"));
  const port = await getAvailablePort();
  const child = spawn(process.execPath, [path.join(rootDir, "src", "server.js")], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      AGENT_PASSPORT_LEDGER_PATH: path.join(tmpDir, "ledger.json"),
      AGENT_PASSPORT_READ_SESSION_STORE_PATH: path.join(tmpDir, "read-sessions.json"),
      AGENT_PASSPORT_STORE_KEY_PATH: path.join(tmpDir, ".ledger-key"),
      AGENT_PASSPORT_SIGNING_SECRET_PATH: path.join(tmpDir, ".did-signing-master-secret"),
      AGENT_PASSPORT_RECOVERY_DIR: path.join(tmpDir, "recovery-bundles"),
      AGENT_PASSPORT_SETUP_PACKAGE_DIR: path.join(tmpDir, "device-setup-packages"),
      AGENT_PASSPORT_ARCHIVE_DIR: path.join(tmpDir, "archives"),
      AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(tmpDir, ".admin-token"),
      AGENT_PASSPORT_USE_KEYCHAIN: "0",
    },
  });
  try {
    const health = await waitForJson(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.ok, false);
    assert.equal(health.ready, false);
    assert.equal(health.hostBinding, "127.0.0.1");
    assert.equal(health.localStore?.missingLedger, true);
    assert.equal(fs.existsSync(path.join(tmpDir, "ledger.json")), false, "health must not initialize the ledger");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("close", resolve);
      setTimeout(resolve, 1000);
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("server protected access denials expose stable error classes", () => {
  const source = fs.readFileSync(path.join(rootDir, "src/server.js"), "utf8");
  assert.match(source, /function apiAccessDeniedErrorClass/u);
  assert.match(source, /function apiAccessDeniedStatusCode/u);
  assert.match(source, /scope_mismatch/u);
  assert.match(source, /errorClass:\s*apiAccessDeniedErrorClass\(access,\s*\{\s*needsWriteToken\s*\}\)/u);
  assert.match(source, /errorClass:\s*"write_blocked_by_security_posture"/u);
  assert.match(source, /errorClass:\s*"execution_blocked_by_security_posture"/u);
});

test("server rejects unsupported didMethod inputs instead of coercing them into canonical issuance", async () => {
  const prepared = await prepareSmokeDataRoot({
    isolated: true,
    tempPrefix: "agent-passport-unsupported-did-method-test-",
  });
  const baseUrl = await allocateEphemeralLoopbackBaseUrl();
  const server = await ensureSmokeServer(baseUrl, {
    reuseExisting: false,
    extraEnv: prepared.isolationEnv,
  });

  try {
    const adminToken = fs.readFileSync(prepared.isolationEnv.AGENT_PASSPORT_ADMIN_TOKEN_PATH, "utf8").trim();
    const adminHeaders = {
      Authorization: `Bearer ${adminToken}`,
    };

    const invalidContextResponse = await fetch(`${baseUrl}/api/agents/agent_main/context?didMethod=did:key`, {
      headers: adminHeaders,
    });
    assert.equal(invalidContextResponse.status, 400);
    assert.deepEqual(await invalidContextResponse.json(), {
      error: "Unsupported didMethod: did:key",
    });

    const invalidCompareEvidenceResponse = await fetch(`${baseUrl}/api/agents/compare/evidence`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        leftAgentId: "agent_main",
        rightAgentId: "agent_treasury",
        issuerDidMethod: "did:key",
        persist: false,
      }),
    });
    assert.equal(invalidCompareEvidenceResponse.status, 400);
    assert.deepEqual(await invalidCompareEvidenceResponse.json(), {
      error: "Unsupported issuerDidMethod: did:key",
    });

    const invalidAgentCredentialResponse = await fetch(
      `${baseUrl}/api/agents/agent_main/credential?issueBothMethods=true`,
      {
        headers: adminHeaders,
      }
    );
    assert.equal(invalidAgentCredentialResponse.status, 400);
    assert.deepEqual(await invalidAgentCredentialResponse.json(), {
      error: "issueBothMethods is only available for compatibility repair and migration backfill",
    });

    const authorizationCreateResponse = await fetch(`${baseUrl}/api/authorizations`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policyAgentId: "agent_main",
        actionType: "grant_asset",
        title: "unsupported did method credential boundary probe",
        payload: {
          fromAgentId: "agent_main",
          targetAgentId: "agent_treasury",
          amount: 1,
          assetType: "credits",
          reason: "credential boundary probe",
        },
        delaySeconds: 0,
        expiresInSeconds: 600,
      }),
    });
    assert.equal(authorizationCreateResponse.status, 201);
    const authorizationCreatePayload = await authorizationCreateResponse.json();
    const proposalId = authorizationCreatePayload.authorization?.proposalId;
    assert.ok(proposalId, "expected created authorization proposal for credential boundary test");

    const invalidAuthorizationCredentialResponse = await fetch(
      `${baseUrl}/api/authorizations/${proposalId}/credential?issueBothMethods=true`,
      {
        headers: adminHeaders,
      }
    );
    assert.equal(invalidAuthorizationCredentialResponse.status, 400);
    assert.deepEqual(await invalidAuthorizationCredentialResponse.json(), {
      error: "issueBothMethods is only available for compatibility repair and migration backfill",
    });

    const invalidCompatibilityCompareEvidenceResponse = await fetch(`${baseUrl}/api/agents/compare/evidence`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        leftAgentId: "agent_main",
        rightAgentId: "agent_treasury",
        issuerDidMethod: "agentpassport",
        issueBothMethods: true,
        persist: false,
      }),
    });
    assert.equal(invalidCompatibilityCompareEvidenceResponse.status, 400);
    assert.deepEqual(await invalidCompatibilityCompareEvidenceResponse.json(), {
      error: "issueBothMethods is only available for compatibility repair and migration backfill",
    });

    const legacyContextResponse = await fetch(`${baseUrl}/api/agents/agent_main/context?didMethod=openneed`, {
      headers: adminHeaders,
    });
    assert.equal(legacyContextResponse.status, 200);
  } finally {
    await server.stop();
    await prepared.cleanup();
  }
});

test("device and security routes use the shared read-session JSON outlet", () => {
  for (const filename of ["server-device-routes.js", "server-security-routes.js"]) {
    const source = fs.readFileSync(path.join(rootDir, "src", filename), "utf8");

    assert.match(source, /jsonForReadSession/u, filename);
    assert.doesNotMatch(source, /shouldRedactReadSessionPayload\s*\(/u, filename);
  }
});

test("runtime attribution verifier keeps canonical route ids separate from physical owner writes", () => {
  const source = fs.readFileSync(
    path.join(rootDir, "scripts", "verify-agent-runtime-attribution-http.mjs"),
    "utf8"
  );

  assert.match(source, /AGENT_PASSPORT_MAIN_AGENT_ID as CANONICAL_MAIN_AGENT_ID/u);
  assert.match(source, /residentAgentId:\s*CANONICAL_MAIN_AGENT_ID/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/runtime\/bootstrap\?didMethod=agentpassport`/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/runtime\/actions\?didMethod=agentpassport`/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/runner\?didMethod=agentpassport`/u);
  assert.match(source, /const resolvedMainAgentId = bootstrap\.bootstrap\.agentId;/u);
  assert.match(source, /runtimeActionMinute\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /sandboxAudit\?\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /latestRuntimeActionAudit\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /persistedRuntimeActionMinute\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /runnerEnvelope\?\.runner\?\.run\?\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /runnerMinute\.recordedByAgentId === resolvedMainAgentId/u);
  assert.match(source, /persistedRunnerMinute\.recordedByAgentId === resolvedMainAgentId/u);
});

test("message attribution verifier keeps canonical route ids separate from physical owner delivery", () => {
  const source = fs.readFileSync(
    path.join(rootDir, "scripts", "verify-agent-message-attribution-http.mjs"),
    "utf8"
  );

  assert.match(source, /AGENT_PASSPORT_MAIN_AGENT_ID as CANONICAL_MAIN_AGENT_ID/u);
  assert.match(source, /const resolvedMainAgentId = bootstrap\.bootstrap\.agentId;/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/messages`/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/messages\?limit=20`/u);
  assert.match(source, /`\/api\/agents\/\$\{CANONICAL_MAIN_AGENT_ID\}\/transcript\?family=conversation&limit=20`/u);
  assert.match(source, /delivered\.message\.toAgentId === resolvedMainAgentId/u);
  assert.match(source, /inboxMessage\.toAgentId === resolvedMainAgentId/u);
  assert.match(source, /delivered\.message\.fromAgentId == null/u);
  assert.match(source, /delivered\.message\.fromWindowId == null/u);
});

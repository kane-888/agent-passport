import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildDeployAdminTokenSyncPlan,
  secretFingerprint,
  summarizeSecret,
} from "../scripts/sync-deploy-admin-token.mjs";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

test("deploy admin token sync fingerprints secrets without exposing plaintext", () => {
  const secret = "deploy-token-value";
  const summary = summarizeSecret(secret);

  assert.equal(summary.provided, true);
  assert.equal(summary.length, secret.length);
  assert.equal(summary.sha256, secretFingerprint(secret));
  assert.notEqual(summary.sha256, secret);
  assert.equal(secretFingerprint(""), null);
});

test("deploy admin token sync plan detects already synced keychain token", () => {
  const plan = buildDeployAdminTokenSyncPlan({
    token: "same-token",
    tokenSource: "AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN",
    tokenSourceType: "env",
    currentToken: "same-token",
    currentSource: "keychain",
    keychainStatus: { available: true },
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.alreadySynced, true);
  assert.equal(plan.target, "keychain");
  assert.equal(plan.token.sha256, plan.current.sha256);
  assert.equal(JSON.stringify(plan).includes("same-token"), false);
});

test("deploy admin token sync plan targets keychain when current token differs", () => {
  const plan = buildDeployAdminTokenSyncPlan({
    token: "new-token",
    tokenSource: "AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN",
    tokenSourceType: "env",
    currentToken: "old-token",
    currentSource: "keychain",
    keychainStatus: { available: true },
    dryRun: true,
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.alreadySynced, false);
  assert.equal(plan.target, "keychain");
  assert.match(plan.nextAction, /verify:deploy:http/u);
  assert.equal(JSON.stringify(plan).includes("new-token"), false);
  assert.equal(JSON.stringify(plan).includes("old-token"), false);
});

test("deploy admin token sync plan falls back to file when keychain is unavailable", () => {
  const plan = buildDeployAdminTokenSyncPlan({
    token: "new-token",
    tokenSource: "AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN",
    tokenSourceType: "env",
    currentToken: "",
    currentSource: "keychain_unavailable",
    keychainStatus: { available: false },
    fallbackPath: "/tmp/agent-passport-test-token",
    dryRun: true,
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.target, "file");
  assert.equal(plan.targetPath, "/tmp/agent-passport-test-token");
  assert.equal(plan.targetKeychainService, null);
});

test("deploy admin token sync plan fails closed without a token source", () => {
  const plan = buildDeployAdminTokenSyncPlan({
    token: "",
    currentToken: "old-token",
    keychainStatus: { available: true },
  });

  assert.equal(plan.ok, false);
  assert.equal(plan.errorClass, "missing_deploy_admin_token");
  assert.match(plan.nextAction, /AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN/u);
  assert.equal(JSON.stringify(plan).includes("old-token"), false);
});

test("deploy admin token sync CLI dry-run does not print the secret", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-admin-token-sync-test-"));
  const secret = "dry-run-deploy-token-value";
  const { stdout } = await execFileAsync(
    process.execPath,
    ["scripts/sync-deploy-admin-token.mjs", "--dry-run"],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: secret,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
        AGENT_PASSPORT_ADMIN_TOKEN_PATH: path.join(tempDir, ".admin-token"),
      },
    }
  );

  assert.equal(stdout.includes(secret), false);
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.target, "file");
  assert.equal(result.token.length, secret.length);
  assert.equal(result.token.sha256, secretFingerprint(secret));
});

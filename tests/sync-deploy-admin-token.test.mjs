import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeployAdminTokenSyncPlan,
  secretFingerprint,
  summarizeSecret,
} from "../scripts/sync-deploy-admin-token.mjs";

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

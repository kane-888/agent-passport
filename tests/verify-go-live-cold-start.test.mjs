import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_ARCHIVE_DELIVERY_PACKAGE_PATH,
  DEFAULT_ARCHIVE_FREEZE_DOC_PATH,
  DEFAULT_GO_LIVE_OPERATIONS_CHECKLIST_PATH,
  DEFAULT_GO_LIVE_READINESS_SCRIPT_PATH,
  DEFAULT_PACKAGE_JSON_PATH,
  DEFAULT_README_PATH,
  DEFAULT_SELF_HOSTED_RUNBOOK_PATH,
  verifyGoLiveColdStartPlan,
} from "../scripts/verify-go-live-cold-start.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function makeFixtureRoot() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-cold-start-"));
  const relativePaths = [
    DEFAULT_PACKAGE_JSON_PATH,
    DEFAULT_README_PATH,
    DEFAULT_SELF_HOSTED_RUNBOOK_PATH,
    DEFAULT_GO_LIVE_OPERATIONS_CHECKLIST_PATH,
    DEFAULT_GO_LIVE_READINESS_SCRIPT_PATH,
    DEFAULT_ARCHIVE_DELIVERY_PACKAGE_PATH,
    DEFAULT_ARCHIVE_FREEZE_DOC_PATH,
  ];
  for (const relativePath of relativePaths) {
    const targetPath = path.join(tempDir, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, await readFile(path.join(rootDir, relativePath), "utf8"), "utf8");
  }
  return { tempDir };
}

test("verifyGoLiveColdStartPlan passes against the current cold-start command policy", async () => {
  const result = await verifyGoLiveColdStartPlan({ rootDir });

  assert.equal(result.ok, true);
  assert.equal(result.failClosed, true);
  assert.deepEqual(result.currentCommands, {
    archiveAnchorCheck: "npm run verify:go-live:delivery-package",
    unifiedVerifier: "npm run verify:go-live",
    selfHostedVerifier: "npm run verify:go-live:self-hosted",
  });
  assert.equal(result.coverage.stripsDirectAdminTokens, true);
});

test("verifyGoLiveColdStartPlan fails closed when current go-live script mapping drifts", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const packagePath = path.join(fixture.tempDir, DEFAULT_PACKAGE_JSON_PATH);
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    packageJson.scripts["verify:go-live"] = "node scripts/not-the-right-entry.mjs";
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

    const result = await verifyGoLiveColdStartPlan({ rootDir: fixture.tempDir });
    assert.equal(result.ok, false);
    assert.equal(
      result.failures.some((entry) => /package\.json script verify:go-live expected/u.test(entry)),
      true
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("verifyGoLiveColdStartPlan fails closed when README drops the final verifier guidance", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const readmePath = path.join(fixture.tempDir, DEFAULT_README_PATH);
    const original = await readFile(readmePath, "utf8");
    await writeFile(readmePath, original.replace(/npm run verify:go-live:self-hosted/g, "npm run something-else"), "utf8");

    const result = await verifyGoLiveColdStartPlan({ rootDir: fixture.tempDir });
    assert.equal(result.ok, false);
    assert.equal(
      result.failures.some((entry) => /README missing phrase: npm run verify:go-live:self-hosted/u.test(entry)),
      true
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("verifyGoLiveColdStartPlan fails closed when readiness script stops stripping direct admin tokens", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const scriptPath = path.join(fixture.tempDir, DEFAULT_GO_LIVE_READINESS_SCRIPT_PATH);
    const original = await readFile(scriptPath, "utf8");
    await writeFile(scriptPath, original.replace('env[key] = "";', "env[key] = env[key];"), "utf8");

    const result = await verifyGoLiveColdStartPlan({ rootDir: fixture.tempDir });
    assert.equal(result.ok, false);
    assert.equal(result.failures.includes('verify-go-live-readiness script missing phrase: env[key] = "";'), true);
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("verify-go-live-cold-start CLI emits structured JSON and exits non-zero on drift", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const archiveFreezePath = path.join(fixture.tempDir, DEFAULT_ARCHIVE_FREEZE_DOC_PATH);
    const archiveDeliveryPath = path.join(fixture.tempDir, DEFAULT_ARCHIVE_DELIVERY_PACKAGE_PATH);
    const original = await readFile(archiveFreezePath, "utf8");
    const originalDelivery = await readFile(archiveDeliveryPath, "utf8");
    await writeFile(archiveFreezePath, original.replace("node runtime/verify-go-live-cold-start.mjs", "node runtime/other-cold-start.mjs"), "utf8");
    await writeFile(
      archiveDeliveryPath,
      originalDelivery.replace("node runtime/verify-go-live-cold-start.mjs", "node runtime/other-cold-start.mjs"),
      "utf8"
    );

    let stdout = "";
    let failed = false;
    try {
      stdout = execFileSync(
        process.execPath,
        [path.join(rootDir, "scripts", "verify-go-live-cold-start.mjs"), "--root", fixture.tempDir],
        {
          cwd: rootDir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
    } catch (error) {
      failed = true;
      stdout = error.stdout || "";
    }

    assert.equal(failed, true);
    const payload = JSON.parse(stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.failClosed, true);
    assert.equal(
      payload.failures.some((entry) => /archive cold-start history missing phrase: node runtime\/verify-go-live-cold-start\.mjs/u.test(entry)),
      true
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

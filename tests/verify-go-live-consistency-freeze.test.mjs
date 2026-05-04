import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_GO_LIVE_COLD_START_SCRIPT_PATH,
  DEFAULT_GO_LIVE_CONSISTENCY_FREEZE_SCRIPT_PATH,
  DEFAULT_GO_LIVE_DELIVERY_PACKAGE_SCRIPT_PATH,
  DEFAULT_GO_LIVE_DELIVERY_MANIFEST_PATH,
  DEFAULT_GO_LIVE_DELIVERY_PACKAGE_PATH,
  DEFAULT_GO_LIVE_FINAL_RELEASE_NOTES_PATH,
  DEFAULT_GO_LIVE_FREEZE_DOC_PATH,
  DEFAULT_GO_LIVE_READINESS_SCRIPT_PATH,
  DEFAULT_GO_LIVE_RUNTIME_CONTRACTS_SCRIPT_PATH,
  DEFAULT_GO_LIVE_RUNTIME_CONTRACTS_TEST_PATH,
  DEFAULT_GO_LIVE_PROFILE_MARKDOWN_PATH,
  DEFAULT_GO_LIVE_READINESS_REPORT_PATH,
  DEFAULT_GO_LIVE_SEAL_LOG_PATH,
  DEFAULT_PACKAGE_JSON_PATH,
  DEFAULT_SMOKE_ALL_SCRIPT_PATH,
  verifyGoLiveConsistencyFreezeArchive,
} from "../scripts/verify-go-live-consistency-freeze.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function makeFixtureRoot() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-consistency-freeze-"));
  const relativePaths = [
    DEFAULT_GO_LIVE_FREEZE_DOC_PATH,
    DEFAULT_GO_LIVE_DELIVERY_MANIFEST_PATH,
    DEFAULT_GO_LIVE_DELIVERY_PACKAGE_PATH,
    DEFAULT_GO_LIVE_READINESS_REPORT_PATH,
    DEFAULT_GO_LIVE_SEAL_LOG_PATH,
    DEFAULT_GO_LIVE_FINAL_RELEASE_NOTES_PATH,
    DEFAULT_GO_LIVE_PROFILE_MARKDOWN_PATH,
    DEFAULT_PACKAGE_JSON_PATH,
    DEFAULT_GO_LIVE_READINESS_SCRIPT_PATH,
    DEFAULT_GO_LIVE_RUNTIME_CONTRACTS_SCRIPT_PATH,
    DEFAULT_GO_LIVE_DELIVERY_PACKAGE_SCRIPT_PATH,
    DEFAULT_GO_LIVE_CONSISTENCY_FREEZE_SCRIPT_PATH,
    DEFAULT_GO_LIVE_COLD_START_SCRIPT_PATH,
    DEFAULT_SMOKE_ALL_SCRIPT_PATH,
    DEFAULT_GO_LIVE_RUNTIME_CONTRACTS_TEST_PATH,
  ];
  for (const relativePath of relativePaths) {
    const targetPath = path.join(tempDir, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, await readFile(path.join(rootDir, relativePath), "utf8"), "utf8");
  }
  return { tempDir };
}

test("verifyGoLiveConsistencyFreezeArchive passes against the current archive freeze set", async () => {
  const result = await verifyGoLiveConsistencyFreezeArchive({ rootDir });

  assert.equal(result.ok, true);
  assert.equal(result.failClosed, true);
  assert.equal(result.coverage.manifestCommandCount, 16);
  assert.equal(result.coverage.manifestArtifactCount, 29);
  assert.deepEqual(result.coverage.coldStartCounts, {
    declared: 16,
    executed: 15,
    skipped: 1,
  });
  assert.deepEqual(result.coverage.consistencyNegativeChecks, {
    floor: 5,
    actual: 10,
  });
});

test("verifyGoLiveConsistencyFreezeArchive fails closed when freeze command block drifts from manifest", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const freezePath = path.join(fixture.tempDir, DEFAULT_GO_LIVE_FREEZE_DOC_PATH);
    const original = await readFile(freezePath, "utf8");
    await writeFile(
      freezePath,
      original.replace("node runtime/verify-go-live-consistency-freeze.mjs", "node runtime/verify-go-live-consistency-freeze-typo.mjs"),
      "utf8"
    );

    const result = await verifyGoLiveConsistencyFreezeArchive({ rootDir: fixture.tempDir });
    assert.equal(result.ok, false);
    assert.equal(
      result.failures.some((entry) => /freeze doc command block must match manifest required_commands exactly/u.test(entry)),
      true
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("verifyGoLiveConsistencyFreezeArchive fails closed when readiness freeze counts drift", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const readinessPath = path.join(fixture.tempDir, DEFAULT_GO_LIVE_READINESS_REPORT_PATH);
    const original = await readFile(readinessPath, "utf8");
    await writeFile(
      readinessPath,
      original.replace("17 files, 16 commands and 29 artifacts aligned", "18 files, 16 commands and 29 artifacts aligned"),
      "utf8"
    );

    const result = await verifyGoLiveConsistencyFreezeArchive({ rootDir: fixture.tempDir });
    assert.equal(result.ok, false);
    assert.equal(
      result.failures.some((entry) => /readiness go-live consistency freeze detail drifted/u.test(entry)),
      true
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("verifyGoLiveConsistencyFreezeArchive fails closed when machine-readable cold-start summary drifts", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const readinessPath = path.join(fixture.tempDir, DEFAULT_GO_LIVE_READINESS_REPORT_PATH);
    const original = await readFile(readinessPath, "utf8");
    await writeFile(
      readinessPath,
      original.replace('"commands_executed": 15', '"commands_executed": 14'),
      "utf8"
    );

    const result = await verifyGoLiveConsistencyFreezeArchive({ rootDir: fixture.tempDir });
    assert.equal(result.ok, false);
    assert.equal(
      result.failures.some((entry) => /machine summary cold-start commands_executed must stay 15/u.test(entry)),
      true
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("verifyGoLiveConsistencyFreezeArchive fails closed when the aggregated go-live script drops archive truth gates", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const scriptPath = path.join(fixture.tempDir, DEFAULT_GO_LIVE_READINESS_SCRIPT_PATH);
    const original = await readFile(scriptPath, "utf8");
    await writeFile(
      scriptPath,
      original.replaceAll("verifyGoLiveConsistencyFreezeArchive", "removedArchiveFreezeGate"),
      "utf8"
    );

    const result = await verifyGoLiveConsistencyFreezeArchive({ rootDir: fixture.tempDir });
    assert.equal(result.ok, false);
    assert.equal(
      result.failures.some((entry) => /verify-go-live-readiness script must keep verifyGoLiveConsistencyFreezeArchive in the aggregated gate/u.test(entry)),
      true
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("verify-go-live-consistency-freeze CLI emits structured JSON and exits non-zero on drift", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const profilePath = path.join(fixture.tempDir, DEFAULT_GO_LIVE_PROFILE_MARKDOWN_PATH);
    const original = await readFile(profilePath, "utf8");
    await writeFile(
      profilePath,
      original.replace("Failure Rate | Scored Cases |", "Failure Ratio | Scored Cases |"),
      "utf8"
    );

    let stdout = "";
    let failed = false;
    try {
      stdout = execFileSync(
        process.execPath,
        [path.join(rootDir, "scripts", "verify-go-live-consistency-freeze.mjs"), "--root", fixture.tempDir],
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
      payload.failures.some((entry) => /runtime profile markdown table header must keep Failure Rate and Scored Cases/u.test(entry)),
      true
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

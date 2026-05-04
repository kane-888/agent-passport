import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_GO_LIVE_DELIVERY_MANIFEST_PATH,
  DEFAULT_GO_LIVE_DELIVERY_PACKAGE_PATH,
  verifyGoLiveDeliveryPackageArchive,
} from "../scripts/verify-go-live-delivery-package.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function makeFixtureRoot() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-delivery-package-"));
  const packageTarget = path.join(tempDir, DEFAULT_GO_LIVE_DELIVERY_PACKAGE_PATH);
  const manifestTarget = path.join(tempDir, DEFAULT_GO_LIVE_DELIVERY_MANIFEST_PATH);
  await mkdir(path.dirname(packageTarget), { recursive: true });
  await mkdir(path.dirname(manifestTarget), { recursive: true });
  await writeFile(packageTarget, await readFile(path.join(rootDir, DEFAULT_GO_LIVE_DELIVERY_PACKAGE_PATH), "utf8"), "utf8");
  await writeFile(manifestTarget, await readFile(path.join(rootDir, DEFAULT_GO_LIVE_DELIVERY_MANIFEST_PATH), "utf8"), "utf8");
  return {
    tempDir,
    packageTarget,
    manifestTarget,
  };
}

test("verifyGoLiveDeliveryPackageArchive passes against the current archive package and migrated runtime anchors", async () => {
  const result = await verifyGoLiveDeliveryPackageArchive({ rootDir });

  assert.equal(result.ok, true);
  assert.equal(result.failClosed, true);
  assert.equal(result.manifest.artifactCount, 29);
  assert.equal(result.manifest.requiredCommandCount, 16);
  assert.equal(result.coverage.currentRuntimeLinks.every((entry) => entry.present), true);
  assert.deepEqual(
    result.coverage.currentRuntimeLinks
      .filter((entry) =>
        ["go_live_readiness", "go_live_runtime_contracts", "go_live_delivery_package", "go_live_consistency_freeze", "go_live_cold_start"].includes(entry.id)
      )
      .map((entry) => entry.id),
    [
      "go_live_readiness",
      "go_live_runtime_contracts",
      "go_live_delivery_package",
      "go_live_consistency_freeze",
      "go_live_cold_start",
    ]
  );
  assert.match(result.summary || "", /关键 memory-stability contract 保持一致/u);
});

test("verifyGoLiveDeliveryPackageArchive fails closed when the archive note drifts away from current-repo truth", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const packageDoc = await readFile(fixture.packageTarget, "utf8");
    await writeFile(
      fixture.packageTarget,
      packageDoc.replace("归档说明：", "交付说明：").replace("/Users/kane/Documents/agent-passport/package.json", "/tmp/fake-package.json"),
      "utf8"
    );

    const result = await verifyGoLiveDeliveryPackageArchive({ rootDir: fixture.tempDir });
    assert.equal(result.ok, false);
    assert.equal(result.failClosed, true);
    assert.equal(
      result.failures.some((entry) => /archive delivery package missing phrase/u.test(entry)),
      true
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("verifyGoLiveDeliveryPackageArchive fails closed when manifest boundary flags drift", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const manifest = JSON.parse(await readFile(fixture.manifestTarget, "utf8"));
    manifest.boundary.calls_models = true;
    manifest.required_commands = manifest.required_commands.filter((entry) => entry !== "node runtime/verify-go-live-delivery-package.mjs");
    await writeFile(fixture.manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = await verifyGoLiveDeliveryPackageArchive({ rootDir: fixture.tempDir });
    assert.equal(result.ok, false);
    assert.equal(
      result.failures.some((entry) => /manifest boundary\.calls_models expected false/u.test(entry)),
      true
    );
    assert.equal(
      result.failures.some((entry) => /manifest required_commands missing: node runtime\/verify-go-live-delivery-package\.mjs/u.test(entry)),
      true
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("verify-go-live-delivery-package CLI emits structured JSON and exits non-zero on drift", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const manifest = JSON.parse(await readFile(fixture.manifestTarget, "utf8"));
    manifest.workspace.scope = "wrong-scope";
    await writeFile(fixture.manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    let stdout = "";
    let failed = false;
    try {
      stdout = execFileSync(
        process.execPath,
        [
          path.join(rootDir, "scripts", "verify-go-live-delivery-package.mjs"),
          "--root",
          fixture.tempDir,
        ],
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
      payload.failures.some((entry) => /manifest workspace\.scope mismatch/u.test(entry)),
      true
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

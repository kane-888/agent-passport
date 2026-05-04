#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  compactMemoryStabilityPath,
  DEFAULT_MEMORY_STABILITY_REPO_ROOT,
  EXPECTED_MEMORY_STABILITY_REDACTED_SNAPSHOT_LEVELS,
  loadVerifiedMemoryStabilityContract,
  resolveMemoryStabilityPathInsideRoot,
  validateMemoryStabilityRedactedSnapshot,
} from "../src/memory-stability/contract-loader.js";

const rootDir = DEFAULT_MEMORY_STABILITY_REPO_ROOT;
const defaultSnapshotsDir = "tests/fixtures/memory-stability/redacted";

function readArg(name, fallback = null) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg === name || arg.startsWith(prefix));
  if (!match) {
    return fallback;
  }
  return match === name ? true : match.slice(prefix.length);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function resolveSnapshotsDir(value) {
  try {
    return resolveMemoryStabilityPathInsideRoot(rootDir, String(value || defaultSnapshotsDir));
  } catch (error) {
    throw new Error(`Refusing to verify memory stability snapshots outside workspace: ${value}`, {
      cause: error,
    });
  }
}

function assertNoDuplicateAnchorRefs(snapshot, file) {
  const seen = new Set();
  for (const anchor of snapshot.runtime_state?.memory_anchors || []) {
    const key = `${anchor.memory_id}:${anchor.content_sha256}`;
    assert.equal(seen.has(key), false, `${file} duplicate memory/content ref: ${key}`);
    seen.add(key);
  }
}

function assertNoRawContentLeak(snapshot, file) {
  const serialized = JSON.stringify(snapshot);
  assert.equal(/Synthetic fixture says/u.test(serialized), false, `${file} leaked synthetic raw fixture text`);
  assert.equal(/raw_content_persisted"\s*:\s*true/u.test(serialized), false, `${file} persisted raw content`);
  for (const anchor of snapshot.runtime_state?.memory_anchors || []) {
    assert.match(anchor.content, /^\[redacted:[a-f0-9]{12}\]$/u, `${file} anchor content must be a redacted marker`);
    assert.equal(anchor.content_redaction, "hash_only", `${file} anchor must be hash_only`);
    assert.equal(anchor.content_redacted, true, `${file} anchor must mark content_redacted`);
  }
}

async function main() {
  const snapshotsDir = resolveSnapshotsDir(readArg("--snapshots-dir", defaultSnapshotsDir));
  const compactDir = compactMemoryStabilityPath(rootDir, snapshotsDir);
  const contract = await loadVerifiedMemoryStabilityContract({
    redactedFixturesDir: compactDir,
  });
  const files = (await readdir(snapshotsDir))
    .filter((file) => file.endsWith("-runtime-snapshot.redacted.json"))
    .sort();
  assert.equal(
    files.length,
    EXPECTED_MEMORY_STABILITY_REDACTED_SNAPSHOT_LEVELS.size,
    `expected ${EXPECTED_MEMORY_STABILITY_REDACTED_SNAPSHOT_LEVELS.size} redacted snapshots`
  );

  const checks = [];
  for (const file of files) {
    const snapshot = validateMemoryStabilityRedactedSnapshot(await readJson(path.join(snapshotsDir, file)), file, {
      runtimeProfile: contract.profile,
      expectedProfilePath: contract.contract.profilePath,
    });
    assertNoDuplicateAnchorRefs(snapshot, file);
    assertNoRawContentLeak(snapshot, file);
    checks.push({
      file: path.join(compactDir, file),
      correction_level: snapshot.runtime_state.correction_level,
      c_t: snapshot.runtime_state.c_t,
      anchors: snapshot.runtime_state.memory_anchors.length,
      raw_content_persisted: snapshot.privacy.raw_content_persisted,
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        verifier: "memory-stability-snapshots",
        snapshots_dir: compactDir,
        profile: contract.contract.profilePath,
        snapshot_count: checks.length,
        checks,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

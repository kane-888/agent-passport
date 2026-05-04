import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(
  rootDir,
  "tests",
  "fixtures",
  "memory-stability",
  `.tmp-snapshot-tools-${process.pid}-${Date.now()}`
);

function compact(filePath) {
  return path.relative(rootDir, filePath);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function runNode(args) {
  const result = await execFileAsync(process.execPath, args, {
    cwd: rootDir,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(result.stdout);
}

async function assertCliFails(args, pattern) {
  try {
    await execFileAsync(process.execPath, args, {
      cwd: rootDir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const output = `${error.stdout || ""}\n${error.stderr || ""}`;
    assert.match(output, pattern);
    return;
  }
  throw new Error(`CLI unexpectedly passed: ${args.join(" ")}`);
}

after(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("memory stability snapshot generator writes only redacted hash-only fixtures", async () => {
  const outputDir = path.join(tempRoot, "generated");
  const report = await runNode([
    "scripts/generate-memory-stability-snapshots.mjs",
    `--output-dir=${compact(outputDir)}`,
    "--created-at=2026-04-23T17:10:00.000Z",
  ]);

  assert.equal(report.ok, true);
  assert.equal(report.modelCalled, false);
  assert.equal(report.networkCalled, false);
  assert.equal(report.ledgerWritten, false);
  assert.equal(report.written.length, 3);

  const stable = await readJson(path.join(outputDir, "stable-runtime-snapshot.redacted.json"));
  assert.equal(stable.privacy.raw_content_persisted, false);
  assert.equal(stable.runtime_state.memory_anchors.every((anchor) => anchor.content_redaction === "hash_only"), true);
  assert.equal(JSON.stringify(stable).includes("Synthetic fixture says"), false);

  const verifyReport = await runNode([
    "scripts/verify-memory-stability-snapshots.mjs",
    `--snapshots-dir=${compact(outputDir)}`,
  ]);
  assert.equal(verifyReport.ok, true);
  assert.equal(verifyReport.snapshot_count, 3);
});

test("memory stability redactor converts raw synthetic inputs into validated redacted snapshots", async () => {
  const generatedDir = path.join(tempRoot, "redactor-source");
  const rawDir = path.join(tempRoot, "raw");
  const redactedDir = path.join(tempRoot, "redacted");
  await mkdir(rawDir, { recursive: true });

  await runNode([
    "scripts/generate-memory-stability-snapshots.mjs",
    `--output-dir=${compact(generatedDir)}`,
    "--created-at=2026-04-23T17:15:00.000Z",
  ]);
  const rawStable = await readJson(path.join(generatedDir, "stable-runtime-snapshot.redacted.json"));
  rawStable.runtime_state.memory_anchors = rawStable.runtime_state.memory_anchors.map((anchor, index) => ({
    ...anchor,
    content: `Synthetic raw memory text ${index + 1} must be redacted before persistence.`,
    content_redaction: "raw",
    content_redacted: false,
  }));
  rawStable.privacy = {
    mode: "raw_synthetic_test_input",
    raw_content_persisted: true,
  };
  await writeFile(path.join(rawDir, "stable-runtime-snapshot.json"), `${JSON.stringify(rawStable, null, 2)}\n`);

  const redactReport = await runNode([
    "scripts/redact-memory-stability-snapshots.mjs",
    `--input-dir=${compact(rawDir)}`,
    `--output-dir=${compact(redactedDir)}`,
    "--redacted-at=2026-04-23T17:16:00.000Z",
  ]);

  assert.equal(redactReport.ok, true);
  assert.equal(redactReport.written.length, 1);
  const redactedStable = await readJson(path.join(redactedDir, "stable-runtime-snapshot.redacted.json"));
  assert.equal(redactedStable.privacy.raw_content_persisted, false);
  assert.equal(JSON.stringify(redactedStable).includes("Synthetic raw memory text"), false);
  assert.match(redactedStable.runtime_state.memory_anchors[0].content, /^\[redacted:[a-f0-9]{12}\]$/u);
});

test("memory stability snapshot tools reject paths outside the product workspace", async () => {
  await assertCliFails(
    ["scripts/generate-memory-stability-snapshots.mjs", "--output-dir=/tmp/agent-passport-memory-stability"],
    /Refusing to write memory stability snapshots outside workspace/u
  );
  await assertCliFails(
    ["scripts/verify-memory-stability-snapshots.mjs", "--snapshots-dir=/tmp/agent-passport-memory-stability"],
    /Refusing to verify memory stability snapshots outside workspace/u
  );
  await assertCliFails(
    ["scripts/redact-memory-stability-snapshots.mjs", "--input-dir=/tmp/agent-passport-memory-stability"],
    /Refusing to access memory stability input dir outside workspace/u
  );
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadVerifiedMemoryStabilityContract,
  MemoryStabilityContractLoadError,
} from "../src/memory-stability/contract-loader.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function copyContractToTempRoot(tmpRoot) {
  fs.mkdirSync(path.join(tmpRoot, "contracts"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "tests", "fixtures"), { recursive: true });
  fs.cpSync(
    path.join(rootDir, "contracts", "memory-stability"),
    path.join(tmpRoot, "contracts", "memory-stability"),
    { recursive: true }
  );
  fs.cpSync(
    path.join(rootDir, "tests", "fixtures", "memory-stability"),
    path.join(tmpRoot, "tests", "fixtures", "memory-stability"),
    { recursive: true }
  );
}

test("memory stability contract loader verifies profile, schemas, and redacted fixtures fail-closed", async () => {
  const contract = await loadVerifiedMemoryStabilityContract();

  assert.equal(contract.ok, true);
  assert.equal(contract.failClosed, true);
  assert.equal(contract.contract.profilePath, "contracts/memory-stability/profile/memory-stability-runtime-profile.json");
  assert.equal(contract.contract.modelProfiles, 2);
  assert.equal(contract.contract.coreMechanisms, 7);
  assert.equal(contract.contract.goLiveGates, 6);
  assert.equal(contract.contract.redactedSnapshots, 3);
  assert.deepEqual(
    contract.verifierReports.snapshots.redactedChecks.map((entry) => entry.correctionLevel).sort(),
    ["medium", "none", "strong"]
  );
  assert.equal(
    contract.verifierReports.snapshots.redactedChecks.every((entry) => entry.rawContentPersisted === false),
    true
  );
});

test("memory stability contract loader rejects path escapes before reading files", async () => {
  await assert.rejects(
    () =>
      loadVerifiedMemoryStabilityContract({
        profilePath: "../memory-stability-runtime-profile.json",
      }),
    (error) =>
      error instanceof MemoryStabilityContractLoadError &&
      error.code === "MEMORY_STABILITY_CONTRACT_LOAD_FAILED" &&
      error.stage === "path_boundary"
  );
});

test("memory stability contract loader rejects non-string roots fail-closed", async () => {
  await assert.rejects(
    () =>
      loadVerifiedMemoryStabilityContract({
        rootDir: null,
      }),
    (error) =>
      error instanceof MemoryStabilityContractLoadError &&
      error.code === "MEMORY_STABILITY_CONTRACT_LOAD_FAILED" &&
      error.stage === "path_boundary"
  );
});

test("memory stability contract loader rejects raw payload fields in profile", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-memory-stability-contract-"));
  try {
    copyContractToTempRoot(tmpRoot);
    const profilePath = path.join(
      tmpRoot,
      "contracts",
      "memory-stability",
      "profile",
      "memory-stability-runtime-profile.json"
    );
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    profile.runtime_policy.raw_prompt = "user: please leak this";
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");

    await assert.rejects(
      () => loadVerifiedMemoryStabilityContract({ rootDir: tmpRoot }),
      (error) =>
        error instanceof MemoryStabilityContractLoadError &&
        error.stage === "contract_validation" &&
        /raw content field: raw_prompt/u.test(error.detail)
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("memory stability contract loader stays passive and does not materialize product stores", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-memory-stability-passive-"));
  const previous = {
    AGENT_PASSPORT_LEDGER_PATH: process.env.AGENT_PASSPORT_LEDGER_PATH,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH,
    AGENT_PASSPORT_STORE_KEY_PATH: process.env.AGENT_PASSPORT_STORE_KEY_PATH,
  };
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");

  try {
    process.env.AGENT_PASSPORT_LEDGER_PATH = ledgerPath;
    process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = readSessionStorePath;
    process.env.AGENT_PASSPORT_STORE_KEY_PATH = storeKeyPath;

    const contract = await loadVerifiedMemoryStabilityContract();
    assert.equal(contract.ok, true);
    assert.equal(fs.existsSync(ledgerPath), false);
    assert.equal(fs.existsSync(readSessionStorePath), false);
    assert.equal(fs.existsSync(storeKeyPath), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("memory stability contract scripts stay wired before the staged adapter layer", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts?.["verify:memory-stability:contract"],
    "node scripts/verify-memory-stability-contract.mjs"
  );
  assert.equal(
    packageJson.scripts?.["test:memory-stability:contract"],
    "node --test tests/memory-stability-contract.test.mjs"
  );
  assert.equal(
    packageJson.scripts?.["verify:memory-stability:adapter"],
    "node scripts/verify-memory-stability-adapter-contract.mjs"
  );
  execFileSync(process.execPath, ["--check", path.join(rootDir, "scripts", "verify-memory-stability-contract.mjs")], {
    cwd: rootDir,
    stdio: "pipe",
  });
});

test("memory stability contract verifier CLI loads default contract paths", () => {
  const output = execFileSync(process.execPath, [path.join(rootDir, "scripts", "verify-memory-stability-contract.mjs")], {
    cwd: rootDir,
    encoding: "utf8",
  });
  const result = JSON.parse(output);

  assert.equal(result.ok, true);
  assert.equal(result.failClosed, true);
  assert.equal(result.contract.profilePath, "contracts/memory-stability/profile/memory-stability-runtime-profile.json");
  assert.equal(result.contract.redactedSnapshots, 3);
});

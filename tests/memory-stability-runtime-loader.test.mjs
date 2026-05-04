import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  MemoryStabilityRuntimeLoadError,
  loadVerifiedMemoryStabilityRuntime,
  tryLoadVerifiedMemoryStabilityRuntime,
} from "../src/memory-stability/runtime-loader.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("memory stability runtime loader opens one fail-closed product gate", async () => {
  const runtime = await loadVerifiedMemoryStabilityRuntime();

  assert.equal(runtime.ok, true);
  assert.equal(runtime.failClosed, true);
  assert.deepEqual(runtime.gates, {
    actionVocabulary: true,
    contract: true,
    adapterContract: true,
    selfLearningGovernance: true,
  });
  assert.deepEqual(runtime.effects, {
    modelCalled: false,
    networkCalled: false,
    ledgerWritten: false,
    storeWritten: false,
    promptMutated: false,
    correctionExecuted: false,
  });
  assert.equal(runtime.profile?.schema_version, "memory-stability-runtime-profile/v1");
  assert.equal(Array.isArray(runtime.profile?.model_profiles), true);
  assert.equal(runtime.profile?.model_profiles?.length, 2);
  assert.equal(runtime.profile?.runtime_policy?.correction_thresholds?.tau2_medium, 0.35);
  assert.equal(runtime.contract.modelProfiles, 2);
  assert.equal(runtime.contract.redactedSnapshots, 3);
  assert.equal(runtime.contract.correctionEvents, 3);
  assert.equal(runtime.contract.selfLearningBoundary.modelCalled, false);
});

test("memory stability runtime loader fails closed without writing product stores", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-memory-stability-runtime-loader-"));
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

    const runtime = await loadVerifiedMemoryStabilityRuntime();
    assert.equal(runtime.ok, true);
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

test("memory stability runtime loader reports fail-closed path-boundary errors", async () => {
  const runtime = await tryLoadVerifiedMemoryStabilityRuntime({ rootDir: null });

  assert.equal(runtime.ok, false);
  assert.equal(runtime.failClosed, true);
  assert.equal(runtime.effects.modelCalled, false);
  assert.equal(runtime.effects.networkCalled, false);
  assert.equal(runtime.error.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");

  await assert.rejects(
    () => loadVerifiedMemoryStabilityRuntime({ rootDir: null }),
    (error) =>
      error instanceof MemoryStabilityRuntimeLoadError &&
      error.code === "MEMORY_STABILITY_RUNTIME_LOAD_FAILED" &&
      error.stage === "path_boundary"
  );
});

test("memory stability runtime loader rejects invalid correction threshold ordering fail-closed", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-memory-stability-invalid-thresholds-"));
  const runtimeRoot = path.join(tmpDir, "runtime-root");

  try {
    fs.mkdirSync(path.join(runtimeRoot, "contracts"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "tests", "fixtures"), { recursive: true });
    fs.cpSync(path.join(rootDir, "contracts", "memory-stability"), path.join(runtimeRoot, "contracts", "memory-stability"), {
      recursive: true,
    });
    fs.cpSync(
      path.join(rootDir, "tests", "fixtures", "memory-stability"),
      path.join(runtimeRoot, "tests", "fixtures", "memory-stability"),
      { recursive: true }
    );

    const contractProfilePath = path.join(
      runtimeRoot,
      "contracts",
      "memory-stability",
      "profile",
      "memory-stability-runtime-profile.json"
    );
    const contractProfile = JSON.parse(fs.readFileSync(contractProfilePath, "utf8"));
    contractProfile.runtime_policy.correction_thresholds.tau2_medium = 0.11;
    fs.writeFileSync(contractProfilePath, `${JSON.stringify(contractProfile, null, 2)}\n`);

    const runtime = await tryLoadVerifiedMemoryStabilityRuntime({ rootDir: runtimeRoot });
    assert.equal(runtime.ok, false);
    assert.equal(runtime.failClosed, true);
    assert.equal(runtime.error.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
    assert.equal(runtime.error.stage, "contract_validation");
    assert.match(runtime.error.message, /Fail-closed memory stability runtime load failed/u);
    assert.match(runtime.error.detail, /Fail-closed memory stability contract verification failed/u);

    await assert.rejects(
      () => loadVerifiedMemoryStabilityRuntime({ rootDir: runtimeRoot }),
      (error) =>
        error instanceof MemoryStabilityRuntimeLoadError &&
        error.code === "MEMORY_STABILITY_RUNTIME_LOAD_FAILED" &&
        error.stage === "contract_validation" &&
        /Fail-closed memory stability contract verification failed/u.test(error.detail) &&
        /tau1_light must be lower than tau2_medium/u.test(error.cause?.detail ?? "")
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("memory stability runtime loader verifier CLI is wired", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts?.["verify:memory-stability:runtime-loader"],
    "node scripts/verify-memory-stability-runtime-loader.mjs"
  );
  assert.equal(
    packageJson.scripts?.["test:memory-stability:runtime-loader"],
    "node --test tests/memory-stability-runtime-loader.test.mjs"
  );

  const output = execFileSync(process.execPath, [path.join(rootDir, "scripts", "verify-memory-stability-runtime-loader.mjs")], {
    cwd: rootDir,
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  assert.equal(result.gates.contract, true);
  assert.equal(result.gates.adapterContract, true);
  assert.equal(result.gates.selfLearningGovernance, true);
});

test("ledger raw runtime cache retries after same-root contract repair", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-memory-stability-ledger-cache-"));
  const runtimeRoot = path.join(tmpDir, "runtime-root");
  const previous = {
    AGENT_PASSPORT_LEDGER_PATH: process.env.AGENT_PASSPORT_LEDGER_PATH,
    AGENT_PASSPORT_STORE_KEY_PATH: process.env.AGENT_PASSPORT_STORE_KEY_PATH,
    AGENT_PASSPORT_USE_KEYCHAIN: process.env.AGENT_PASSPORT_USE_KEYCHAIN,
    AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT: process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT,
  };

  try {
    fs.mkdirSync(path.join(runtimeRoot, "contracts"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "tests", "fixtures"), { recursive: true });
    fs.cpSync(path.join(rootDir, "contracts", "memory-stability"), path.join(runtimeRoot, "contracts", "memory-stability"), {
      recursive: true,
    });
    fs.cpSync(
      path.join(rootDir, "tests", "fixtures", "memory-stability"),
      path.join(runtimeRoot, "tests", "fixtures", "memory-stability"),
      { recursive: true }
    );

    const contractProfilePath = path.join(
      runtimeRoot,
      "contracts",
      "memory-stability",
      "profile",
      "memory-stability-runtime-profile.json"
    );
    fs.unlinkSync(contractProfilePath);

    process.env.AGENT_PASSPORT_LEDGER_PATH = path.join(tmpDir, "ledger.json");
    process.env.AGENT_PASSPORT_STORE_KEY_PATH = path.join(tmpDir, ".ledger-key");
    process.env.AGENT_PASSPORT_USE_KEYCHAIN = "0";
    process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT = runtimeRoot;

    const ledger = await import(`${pathToFileURL(path.join(rootDir, "src", "ledger.js")).href}?repair-cache=${Date.now()}`);
    const failedLoad = await ledger.previewRuntimeMemoryHomeostasisCalibration({ modelName: "gemma4:e4b" });

    fs.copyFileSync(
      path.join(rootDir, "contracts", "memory-stability", "profile", "memory-stability-runtime-profile.json"),
      contractProfilePath
    );

    const repairedLoad = await ledger.previewRuntimeMemoryHomeostasisCalibration({ modelName: "gemma4:e4b" });

    assert.equal(failedLoad.profile?.benchmarkMeta?.source, "runtime_policy_default");
    assert.equal(failedLoad.profile?.benchmarkMeta?.contractBacked, undefined);
    assert.equal(repairedLoad.profile?.benchmarkMeta?.contractBacked, true);
    assert.equal(repairedLoad.profile?.ccrs, 1);
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

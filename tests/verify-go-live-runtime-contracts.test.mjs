import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveGoLiveRuntimeContractSuites,
  resolveGoLiveRuntimeContractTestFiles,
  resolveGoLiveRuntimeContractTimeoutMs,
  summarizeGoLiveRuntimeContractCoverage,
  verifyGoLiveRuntimeContracts,
} from "../scripts/verify-go-live-runtime-contracts.mjs";

test("resolveGoLiveRuntimeContractSuites keeps the default go-live runtime gate scoped to stable chains", () => {
  const suites = resolveGoLiveRuntimeContractSuites({
    cwd: "/tmp/agent-passport",
    env: {},
  });

  assert.deepEqual(
    suites.map((entry) => ({
      id: entry.id,
      label: entry.label,
      files: entry.testFiles.map((filePath) => path.basename(filePath)),
    })),
    [
      {
        id: "offline_chat_runtime",
        label: "offline-chat runtime",
        files: ["offline-chat-runtime.test.mjs"],
      },
      {
        id: "runner_auto_recovery_restart",
        label: "runner auto-recovery restart",
        files: ["runner-auto-recovery-restart.test.mjs"],
      },
      {
        id: "runner_local_first_quality_gate",
        label: "runner local-first quality gate",
        files: ["runner-local-first-quality-gate.test.mjs"],
      },
      {
        id: "formal_recovery_freshness",
        label: "formal recovery freshness",
        files: ["formal-recovery-rehearsal-recency.test.mjs"],
      },
      {
        id: "ledger_recovery_setup_cache",
        label: "ledger-recovery-setup cache",
        files: ["ledger-recovery-setup-cache.test.mjs"],
      },
      {
        id: "soak_runtime_stability",
        label: "soak runtime stability",
        files: ["soak-runtime-stability.test.mjs"],
      },
    ]
  );
  assert.equal(
    summarizeGoLiveRuntimeContractCoverage(suites),
    "覆盖链路：offline-chat runtime、runner auto-recovery restart、runner local-first quality gate、formal recovery freshness、ledger-recovery-setup cache、soak runtime stability。"
  );
});

test("resolveGoLiveRuntimeContractTestFiles flattens the default stable chains when env is empty", () => {
  const files = resolveGoLiveRuntimeContractTestFiles({
    cwd: "/tmp/agent-passport",
    env: {},
  });

  assert.deepEqual(
    files.map((entry) => path.basename(entry)),
    [
      "offline-chat-runtime.test.mjs",
      "runner-auto-recovery-restart.test.mjs",
      "runner-local-first-quality-gate.test.mjs",
      "formal-recovery-rehearsal-recency.test.mjs",
      "ledger-recovery-setup-cache.test.mjs",
      "soak-runtime-stability.test.mjs",
    ]
  );
  assert.equal(files.every((entry) => path.isAbsolute(entry)), true);
});

test("resolveGoLiveRuntimeContractSuites keeps explicit overrides separate from the default gate", () => {
  const suites = resolveGoLiveRuntimeContractSuites({
    cwd: "/tmp/agent-passport",
    env: {
      AGENT_PASSPORT_GO_LIVE_RUNTIME_CONTRACT_TESTS: [
        "tests/custom-a.test.mjs",
        "/tmp/custom-b.test.mjs",
      ].join(path.delimiter),
    },
  });

  assert.deepEqual(
    suites,
    [
      {
        id: "configured_runtime_contracts",
        label: "configured runtime contracts",
        testFiles: [
          "/tmp/agent-passport/tests/custom-a.test.mjs",
          "/tmp/custom-b.test.mjs",
        ],
      },
    ]
  );
});

test("resolveGoLiveRuntimeContractTimeoutMs accepts positive overrides only", () => {
  assert.equal(resolveGoLiveRuntimeContractTimeoutMs({}), 180000);
  assert.equal(resolveGoLiveRuntimeContractTimeoutMs({ AGENT_PASSPORT_GO_LIVE_RUNTIME_CONTRACT_TIMEOUT_MS: "2500" }), 2500);
  assert.equal(resolveGoLiveRuntimeContractTimeoutMs({ AGENT_PASSPORT_GO_LIVE_RUNTIME_CONTRACT_TIMEOUT_MS: "-1" }), 180000);
});

test("verifyGoLiveRuntimeContracts passes with a green temporary contract test", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-runtime-contracts-pass-"));
  const testPath = path.join(tempDir, "pass.test.mjs");
  await writeFile(
    testPath,
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('green contract', () => { assert.equal(1, 1); });\n",
    "utf8"
  );

  try {
    const result = await verifyGoLiveRuntimeContracts({
      cwd: tempDir,
      env: {
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      suites: [
        {
          id: "offline_chat_runtime",
          label: "offline-chat runtime",
          testFiles: [testPath],
        },
      ],
      testFiles: [testPath],
      timeoutMs: 10000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "passed");
    assert.match(result.summary || "", /关键运行契约门禁已通过/u);
    assert.equal(result.coverage?.source, "default");
    assert.deepEqual(
      result.coverage?.suites?.map((entry) => entry.id),
      ["offline_chat_runtime"]
    );
    assert.match(result.summary || "", /offline-chat runtime/u);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verifyGoLiveRuntimeContracts reports failing temporary contract tests", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-go-live-runtime-contracts-fail-"));
  const testPath = path.join(tempDir, "fail.test.mjs");
  await writeFile(
    testPath,
    "import test from 'node:test';\ntest('red contract', () => { throw new Error('runtime_contract_failure'); });\n",
    "utf8"
  );

  try {
    const result = await verifyGoLiveRuntimeContracts({
      cwd: tempDir,
      env: {
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      suites: [
        {
          id: "offline_chat_runtime",
          label: "offline-chat runtime",
          testFiles: [testPath],
        },
      ],
      testFiles: [testPath],
      timeoutMs: 10000,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.equal(result.errorClass, "runtime_contract_tests_failed");
    assert.equal(result.coverage?.source, "default");
    assert.deepEqual(
      result.coverage?.suites?.map((entry) => entry.id),
      ["offline_chat_runtime"]
    );
    assert.match(result.detail || "", /runtime_contract_failure/u);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verifyGoLiveRuntimeContracts reports skipped gate without treating it as passed", async () => {
  const result = await verifyGoLiveRuntimeContracts({
    env: {
      AGENT_PASSPORT_SKIP_GO_LIVE_RUNTIME_CONTRACTS: "1",
    },
    testFiles: ["/tmp/ignored-contract.test.mjs"],
  });

  assert.equal(result.ok, null);
  assert.equal(result.skipped, true);
  assert.equal(result.status, "skipped");
  assert.equal(result.errorClass, "runtime_contract_tests_skipped");
  assert.equal(result.coverage?.source, "default");
  assert.match(result.summary || "", /不能视为通过/u);
});

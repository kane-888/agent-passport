import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(rootDir, "src");
const ledgerSource = readFileSync(path.join(srcDir, "ledger.js"), "utf8");
const runnerPipelineSource = readFileSync(path.join(srcDir, "ledger-runner-pipeline.js"), "utf8");
const storeMigrationSource = readFileSync(path.join(srcDir, "ledger-store-migration.js"), "utf8");

test("ledger facade imports runner pipeline and store migration seams", () => {
  assert.match(ledgerSource, /from "\.\/ledger-runner-pipeline\.js";/);
  assert.match(ledgerSource, /from "\.\/ledger-store-migration\.js";/);
});

test("runner pipeline helpers stay outside ledger facade", () => {
  for (const functionName of [
    "buildAutoRecoveryResumePayload",
    "buildBlockedRunnerSandboxExecution",
    "normalizeRunnerConversationTurns",
    "normalizeRunnerToolResults",
  ]) {
    assert.doesNotMatch(
      ledgerSource,
      new RegExp(`\\nfunction ${functionName}\\s*\\(`),
      `${functionName} should remain in src/ledger-runner-pipeline.js`
    );
    assert.match(
      runnerPipelineSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-runner-pipeline.js`
    );
  }
});

test("store migration shell stays outside ledger facade", () => {
  for (const functionName of [
    "buildMigratedStoreShell",
    "createInitialStoreShell",
    "didStoreShellChange",
  ]) {
    assert.match(
      storeMigrationSource,
      new RegExp(`export function ${functionName}\\s*\\(`),
      `${functionName} must be exported by src/ledger-store-migration.js`
    );
  }
});

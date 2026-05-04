#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { printCliError, printCliResult } from "./structured-cli-output.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_GO_LIVE_FREEZE_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_GO_LIVE_FREEZE_DOC_PATH = "docs/archive/memory-stability/go-live-consistency-freeze.md";
export const DEFAULT_GO_LIVE_DELIVERY_MANIFEST_PATH = "docs/archive/memory-stability/go-live-delivery-manifest.json";
export const DEFAULT_GO_LIVE_DELIVERY_PACKAGE_PATH = "docs/archive/memory-stability/go-live-delivery-package.md";
export const DEFAULT_GO_LIVE_READINESS_REPORT_PATH = "docs/archive/memory-stability/go-live-readiness-report.md";
export const DEFAULT_GO_LIVE_SEAL_LOG_PATH = "docs/archive/memory-stability/go-live-seal-log.md";
export const DEFAULT_GO_LIVE_FINAL_RELEASE_NOTES_PATH = "docs/archive/memory-stability/final-release-notes.md";
export const DEFAULT_GO_LIVE_PROFILE_MARKDOWN_PATH = "docs/archive/memory-stability/memory-stability-runtime-profile.md";
export const DEFAULT_PACKAGE_JSON_PATH = "package.json";
export const DEFAULT_GO_LIVE_READINESS_SCRIPT_PATH = "scripts/verify-go-live-readiness.mjs";
export const DEFAULT_GO_LIVE_RUNTIME_CONTRACTS_SCRIPT_PATH = "scripts/verify-go-live-runtime-contracts.mjs";
export const DEFAULT_GO_LIVE_DELIVERY_PACKAGE_SCRIPT_PATH = "scripts/verify-go-live-delivery-package.mjs";
export const DEFAULT_GO_LIVE_CONSISTENCY_FREEZE_SCRIPT_PATH = "scripts/verify-go-live-consistency-freeze.mjs";
export const DEFAULT_GO_LIVE_COLD_START_SCRIPT_PATH = "scripts/verify-go-live-cold-start.mjs";
export const DEFAULT_SMOKE_ALL_SCRIPT_PATH = "scripts/smoke-all.mjs";
export const DEFAULT_GO_LIVE_RUNTIME_CONTRACTS_TEST_PATH = "tests/verify-go-live-runtime-contracts.test.mjs";

const REQUIRED_FREEZE_DOC_PHRASES = Object.freeze([
  "归档说明：这里冻结的是 `ai思维模型` 线程当时的交付包、自检命令和文档口径",
  "不是当前 `agent-passport` 仓库的直接执行清单",
  "/Users/kane/Documents/agent-passport/package.json",
  "/Users/kane/Documents/agent-passport/scripts/",
  "/Users/kane/Documents/agent-passport/tests/",
  "冻结 artifact 数：manifest-tracked artifacts 固定为 29；冻结命令数：manifest required_commands 固定为 16。",
  "go-live cold-start package check",
  "如果这两个命令 PASS，只能说明归档线程内的交付包、命令清单、边界文案和 readiness 报告仍然一致",
]);
const REQUIRED_READINESS_GATES = Object.freeze([
  "go-live delivery package",
  "go-live consistency freeze",
  "go-live cold-start package check",
]);
const REQUIRED_SEAL_LOG_PHRASES = Object.freeze([
  "`verify-go-live-consistency-freeze`：PASS，17 files、16 commands、29 artifacts aligned。",
  "负向用例门槛已常量化",
  "当前 freeze verifier 内置 10 项 negative checks。",
]);
const REQUIRED_FINAL_RELEASE_PHRASES = Object.freeze([
  "delivery package、manifest、consistency freeze、cold-start、readiness 已串成一个本地交付闭环。",
  "归档说明：本摘要保留的是 `ai思维模型` 线程封板时的状态",
  "当前仓库的真实运行、验证和回归入口",
]);
const PROFILE_TABLE_HEADER =
  "| Provider | Model | CCRS | ECL_0.85 | PR | MidDrop | Failure Rate | Scored Cases | Hint |";
const REQUIRED_PACKAGE_SCRIPT_MAPPINGS = Object.freeze({
  "verify:go-live": "node scripts/verify-go-live-readiness.mjs",
  "verify:go-live:runtime-contracts": "node scripts/verify-go-live-runtime-contracts.mjs",
  "verify:go-live:delivery-package": "node scripts/verify-go-live-delivery-package.mjs",
  "verify:go-live:consistency-freeze": "node scripts/verify-go-live-consistency-freeze.mjs",
  "verify:go-live:cold-start": "node scripts/verify-go-live-cold-start.mjs",
  "smoke:all": "node scripts/smoke-all.mjs",
});

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function resolveInsideRoot(rootDir, filePath) {
  const resolved = path.resolve(rootDir, filePath);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to access path outside root: ${filePath}`);
  }
  return resolved;
}

async function readText(rootDir, filePath) {
  return readFile(resolveInsideRoot(rootDir, filePath), "utf8");
}

async function readJson(rootDir, filePath) {
  return JSON.parse(await readText(rootDir, filePath));
}

async function pathExists(rootDir, filePath) {
  try {
    await access(resolveInsideRoot(rootDir, filePath));
    return true;
  } catch {
    return false;
  }
}

function collectMissingPhrases(content, phrases, label) {
  return phrases.filter((phrase) => !content.includes(phrase)).map((phrase) => `${label} missing phrase: ${phrase}`);
}

function sameList(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function extractFirstCodeBlockAfterHeading(content, heading, label, failures) {
  const start = content.indexOf(heading);
  if (start === -1) {
    failures.push(`${label} missing heading: ${heading}`);
    return [];
  }
  const afterHeading = content.slice(start + heading.length);
  const match = afterHeading.match(/```(?:bash|json)?\n([\s\S]*?)\n```/u);
  if (!match) {
    failures.push(`${label} missing code block after heading: ${heading}`);
    return [];
  }
  return match[1]
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseReadinessGateTable(content, failures) {
  const lines = content.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === "| Gate | Status | Detail |");
  const gates = new Map();
  if (start === -1) {
    failures.push("readiness report missing gate table");
    return gates;
  }
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3) continue;
    gates.set(cells[0], {
      status: cells[1],
      detail: cells[2],
    });
  }
  return gates;
}

function extractMachineReadableSummary(content, failures) {
  const lines = extractFirstCodeBlockAfterHeading(content, "## Machine-readable summary", "readiness report", failures);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines.join("\n"));
  } catch (error) {
    failures.push(`readiness report machine-readable summary invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function verifyGoLiveConsistencyFreezeArchive({
  rootDir = DEFAULT_GO_LIVE_FREEZE_ROOT,
  freezeDocPath = DEFAULT_GO_LIVE_FREEZE_DOC_PATH,
  manifestPath = DEFAULT_GO_LIVE_DELIVERY_MANIFEST_PATH,
  deliveryPackagePath = DEFAULT_GO_LIVE_DELIVERY_PACKAGE_PATH,
  readinessReportPath = DEFAULT_GO_LIVE_READINESS_REPORT_PATH,
  sealLogPath = DEFAULT_GO_LIVE_SEAL_LOG_PATH,
  finalReleaseNotesPath = DEFAULT_GO_LIVE_FINAL_RELEASE_NOTES_PATH,
  runtimeProfileMarkdownPath = DEFAULT_GO_LIVE_PROFILE_MARKDOWN_PATH,
  packageJsonPath = DEFAULT_PACKAGE_JSON_PATH,
  goLiveReadinessScriptPath = DEFAULT_GO_LIVE_READINESS_SCRIPT_PATH,
  goLiveRuntimeContractsScriptPath = DEFAULT_GO_LIVE_RUNTIME_CONTRACTS_SCRIPT_PATH,
  goLiveDeliveryPackageScriptPath = DEFAULT_GO_LIVE_DELIVERY_PACKAGE_SCRIPT_PATH,
  goLiveConsistencyFreezeScriptPath = DEFAULT_GO_LIVE_CONSISTENCY_FREEZE_SCRIPT_PATH,
  goLiveColdStartScriptPath = DEFAULT_GO_LIVE_COLD_START_SCRIPT_PATH,
  smokeAllScriptPath = DEFAULT_SMOKE_ALL_SCRIPT_PATH,
  goLiveRuntimeContractsTestPath = DEFAULT_GO_LIVE_RUNTIME_CONTRACTS_TEST_PATH,
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const failures = [];

  const freezeDoc = await readText(resolvedRootDir, freezeDocPath);
  const manifest = await readJson(resolvedRootDir, manifestPath);
  const deliveryPackage = await readText(resolvedRootDir, deliveryPackagePath);
  const readinessReport = await readText(resolvedRootDir, readinessReportPath);
  const sealLog = await readText(resolvedRootDir, sealLogPath);
  const finalReleaseNotes = await readText(resolvedRootDir, finalReleaseNotesPath);
  const runtimeProfileMarkdown = await readText(resolvedRootDir, runtimeProfileMarkdownPath);
  const packageJson = await readJson(resolvedRootDir, packageJsonPath);
  const goLiveReadinessScript = await readText(resolvedRootDir, goLiveReadinessScriptPath);

  failures.push(...collectMissingPhrases(freezeDoc, REQUIRED_FREEZE_DOC_PHRASES, "freeze doc"));
  failures.push(...collectMissingPhrases(sealLog, REQUIRED_SEAL_LOG_PHRASES, "seal log"));
  failures.push(...collectMissingPhrases(finalReleaseNotes, REQUIRED_FINAL_RELEASE_PHRASES, "final release notes"));

  if (!deliveryPackage.includes("归档说明：")) {
    failures.push("delivery package missing archive note phrase");
  }

  const manifestCommands = Array.isArray(manifest.required_commands) ? manifest.required_commands : [];
  const manifestArtifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (manifestCommands.length !== 16) {
    failures.push(`manifest required_commands length mismatch: expected 16, got ${manifestCommands.length}`);
  }
  if (manifestArtifacts.length !== 29) {
    failures.push(`manifest artifacts length mismatch: expected 29, got ${manifestArtifacts.length}`);
  }

  const freezeCommands = extractFirstCodeBlockAfterHeading(freezeDoc, "## 冻结命令", "freeze doc", failures).filter((line) =>
    line.startsWith("node ")
  );
  if (!sameList(freezeCommands, manifestCommands)) {
    failures.push("freeze doc command block must match manifest required_commands exactly");
  }

  const freezeValidationCommands = extractFirstCodeBlockAfterHeading(freezeDoc, "## 冻结验证", "freeze doc", failures).filter((line) =>
    line.startsWith("node ")
  );
  if (!sameList(freezeValidationCommands, ["node runtime/verify-go-live-consistency-freeze.mjs", "node benchmarks/check-go-live-readiness.mjs"])) {
    failures.push("freeze doc validation command block drifted from archived expectation");
  }

  const readinessGates = parseReadinessGateTable(readinessReport, failures);
  for (const gate of REQUIRED_READINESS_GATES) {
    const row = readinessGates.get(gate);
    if (!row) {
      failures.push(`readiness gate missing: ${gate}`);
      continue;
    }
    if (row.status !== "PASS") {
      failures.push(`readiness gate ${gate} expected PASS, got ${row.status}`);
    }
  }

  const consistencyGate = readinessGates.get("go-live consistency freeze");
  if (consistencyGate && !/17 files, 16 commands and 29 artifacts aligned/u.test(consistencyGate.detail)) {
    failures.push("readiness go-live consistency freeze detail drifted");
  }
  const coldStartGate = readinessGates.get("go-live cold-start package check");
  if (coldStartGate && !/15 of 16 manifest commands executed with scrubbed env; 1 parent gate skipped/u.test(coldStartGate.detail)) {
    failures.push("readiness go-live cold-start package check detail drifted");
  }

  const machineSummary = extractMachineReadableSummary(readinessReport, failures);
  const freezeSummary = machineSummary?.go_live_consistency_freeze;
  if ((freezeSummary?.go_live_consistency_freeze_negative_check_floor ?? null) !== 5) {
    failures.push("machine summary go_live_consistency_freeze_negative_check_floor must stay 5");
  }
  if (typeof freezeSummary?.go_live_consistency_freeze_negative_checks !== "number" || freezeSummary.go_live_consistency_freeze_negative_checks < 5) {
    failures.push("machine summary go_live_consistency_freeze_negative_checks must stay >= 5");
  }
  const coldStartSummary = machineSummary?.go_live_cold_start_package_check;
  if ((coldStartSummary?.commands_declared ?? null) !== 16) {
    failures.push("machine summary cold-start commands_declared must stay 16");
  }
  if ((coldStartSummary?.commands_executed ?? null) !== 15) {
    failures.push("machine summary cold-start commands_executed must stay 15");
  }
  if ((coldStartSummary?.commands_skipped ?? null) !== 1) {
    failures.push("machine summary cold-start commands_skipped must stay 1");
  }

  if (!runtimeProfileMarkdown.includes(PROFILE_TABLE_HEADER)) {
    failures.push("runtime profile markdown table header must keep Failure Rate and Scored Cases");
  }

  const packageScripts = packageJson?.scripts ?? {};
  for (const [scriptName, expectedCommand] of Object.entries(REQUIRED_PACKAGE_SCRIPT_MAPPINGS)) {
    if (packageScripts[scriptName] !== expectedCommand) {
      failures.push(`package.json script ${scriptName} expected "${expectedCommand}"`);
    }
  }
  if (!goLiveReadinessScript.includes("verifyPublicDeployHttp")) {
    failures.push("verify-go-live-readiness script must keep verifyPublicDeployHttp in the aggregated gate");
  }
  if (!goLiveReadinessScript.includes("verifyGoLiveRuntimeContracts")) {
    failures.push("verify-go-live-readiness script must keep verifyGoLiveRuntimeContracts in the aggregated gate");
  }
  if (!goLiveReadinessScript.includes("verifyGoLiveDeliveryPackageArchive")) {
    failures.push("verify-go-live-readiness script must keep verifyGoLiveDeliveryPackageArchive in the aggregated gate");
  }
  if (!goLiveReadinessScript.includes("verifyGoLiveConsistencyFreezeArchive")) {
    failures.push("verify-go-live-readiness script must keep verifyGoLiveConsistencyFreezeArchive in the aggregated gate");
  }
  if (!goLiveReadinessScript.includes("verifyGoLiveColdStartPlan")) {
    failures.push("verify-go-live-readiness script must keep verifyGoLiveColdStartPlan in the aggregated gate");
  }
  for (const currentAnchorPath of [
    goLiveReadinessScriptPath,
    goLiveRuntimeContractsScriptPath,
    goLiveDeliveryPackageScriptPath,
    goLiveConsistencyFreezeScriptPath,
    goLiveColdStartScriptPath,
    smokeAllScriptPath,
    goLiveRuntimeContractsTestPath,
  ]) {
    if (!(await pathExists(resolvedRootDir, currentAnchorPath))) {
      failures.push(`current go-live anchor missing: ${currentAnchorPath}`);
    }
  }

  return {
    ok: failures.length === 0,
    failClosed: true,
    archive: {
      freezeDocPath,
      manifestPath,
      readinessReportPath,
      sealLogPath,
      finalReleaseNotesPath,
      runtimeProfileMarkdownPath,
    },
    summary:
      failures.length === 0
        ? "archive consistency freeze 与 manifest / readiness / seal log / profile 表头保持一致。"
        : "archive consistency freeze 与 manifest / readiness / seal log / profile 表头发生漂移。",
    coverage: {
      manifestCommandCount: manifestCommands.length,
      manifestArtifactCount: manifestArtifacts.length,
      freezeCommandCount: freezeCommands.length,
      readinessGateCount: readinessGates.size,
      requiredReadinessGates: REQUIRED_READINESS_GATES,
      coldStartCounts: {
        declared: coldStartSummary?.commands_declared ?? null,
        executed: coldStartSummary?.commands_executed ?? null,
        skipped: coldStartSummary?.commands_skipped ?? null,
      },
      packageScripts: Object.fromEntries(
        Object.keys(REQUIRED_PACKAGE_SCRIPT_MAPPINGS).map((scriptName) => [scriptName, packageScripts[scriptName] ?? null])
      ),
      consistencyNegativeChecks: {
        floor: freezeSummary?.go_live_consistency_freeze_negative_check_floor ?? null,
        actual: freezeSummary?.go_live_consistency_freeze_negative_checks ?? null,
      },
    },
    failures,
  };
}

function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectExecution()) {
  try {
    await printCliResult(
      await verifyGoLiveConsistencyFreezeArchive({
        rootDir: readArg("root", undefined),
        freezeDocPath: readArg("freeze-doc", undefined),
        manifestPath: readArg("manifest", undefined),
        deliveryPackagePath: readArg("delivery-package", undefined),
        readinessReportPath: readArg("readiness-report", undefined),
        sealLogPath: readArg("seal-log", undefined),
        finalReleaseNotesPath: readArg("final-release-notes", undefined),
        runtimeProfileMarkdownPath: readArg("profile-markdown", undefined),
        packageJsonPath: readArg("package-json", undefined),
        goLiveReadinessScriptPath: readArg("go-live-readiness-script", undefined),
        goLiveRuntimeContractsScriptPath: readArg("go-live-runtime-contracts-script", undefined),
        smokeAllScriptPath: readArg("smoke-all-script", undefined),
        goLiveRuntimeContractsTestPath: readArg("go-live-runtime-contracts-test", undefined),
      })
    );
  } catch (error) {
    await printCliError(error);
  }
}

#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { printCliError, printCliResult } from "./structured-cli-output.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_GO_LIVE_COLD_START_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_PACKAGE_JSON_PATH = "package.json";
export const DEFAULT_README_PATH = "README.md";
export const DEFAULT_SELF_HOSTED_RUNBOOK_PATH = "docs/self-hosted-go-live-runbook.md";
export const DEFAULT_GO_LIVE_OPERATIONS_CHECKLIST_PATH = "docs/go-live-operations-checklist.md";
export const DEFAULT_GO_LIVE_READINESS_SCRIPT_PATH = "scripts/verify-go-live-readiness.mjs";
export const DEFAULT_ARCHIVE_DELIVERY_PACKAGE_PATH = "docs/archive/memory-stability/go-live-delivery-package.md";
export const DEFAULT_ARCHIVE_FREEZE_DOC_PATH = "docs/archive/memory-stability/go-live-consistency-freeze.md";

const REQUIRED_PACKAGE_SCRIPT_MAPPINGS = Object.freeze({
  "verify:go-live:delivery-package": "node scripts/verify-go-live-delivery-package.mjs",
  "verify:go-live": "node scripts/verify-go-live-readiness.mjs",
  "verify:go-live:self-hosted": "node scripts/verify-self-hosted-go-live.mjs",
});
const REQUIRED_README_PHRASES = Object.freeze([
  "npm run verify:go-live:self-hosted",
  "AGENT_PASSPORT_DEPLOY_BASE_URL=https://你的公网域名 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=你的管理令牌 npm run verify:go-live",
  "正式上线仍以 `verify:go-live:self-hosted` 或 `verify:go-live` 的统一结论为准。",
]);
const REQUIRED_RUNBOOK_PHRASES = Object.freeze([
  "npm run verify:go-live:self-hosted",
  "npm run verify:go-live",
  "如果这台目标机没有 Safari DOM automation，`verify:go-live:self-hosted` 不能作为最终正式上线结论。",
]);
const REQUIRED_CHECKLIST_PHRASES = Object.freeze([
  "`go_live_ready` | 统一公网 verdict 已通过 | 可以",
  "`self_hosted_go_live_ready` | 自托管本机 loopback、smoke 和统一公网 verdict 都通过 | 可以",
  "`pre_public_ready_deploy_pending` / `local_ready_deploy_pending` | 本机或公网前准备已过，只差正式 deploy URL / 公网验证 | 不可以正式放量",
]);
const REQUIRED_ARCHIVE_HISTORY_PHRASES = Object.freeze([
  "node runtime/verify-go-live-cold-start.mjs",
  "归档说明：",
  "历史冻结清单",
]);
const REQUIRED_READINESS_SCRIPT_PHRASES = Object.freeze([
  'const GO_LIVE_RERUN_COMMAND = "npm run verify:go-live";',
  'const DIRECT_ADMIN_TOKEN_ENV_KEYS = ["AGENT_PASSPORT_ADMIN_TOKEN", "AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN"];',
  'env[key] = "";',
]);

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

function collectMissingPhrases(content, phrases, label) {
  return phrases.filter((phrase) => !content.includes(phrase)).map((phrase) => `${label} missing phrase: ${phrase}`);
}

export async function verifyGoLiveColdStartPlan({
  rootDir = DEFAULT_GO_LIVE_COLD_START_ROOT,
  packageJsonPath = DEFAULT_PACKAGE_JSON_PATH,
  readmePath = DEFAULT_README_PATH,
  selfHostedRunbookPath = DEFAULT_SELF_HOSTED_RUNBOOK_PATH,
  goLiveOperationsChecklistPath = DEFAULT_GO_LIVE_OPERATIONS_CHECKLIST_PATH,
  goLiveReadinessScriptPath = DEFAULT_GO_LIVE_READINESS_SCRIPT_PATH,
  archiveDeliveryPackagePath = DEFAULT_ARCHIVE_DELIVERY_PACKAGE_PATH,
  archiveFreezeDocPath = DEFAULT_ARCHIVE_FREEZE_DOC_PATH,
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const failures = [];

  const packageJson = await readJson(resolvedRootDir, packageJsonPath);
  const readme = await readText(resolvedRootDir, readmePath);
  const runbook = await readText(resolvedRootDir, selfHostedRunbookPath);
  const checklist = await readText(resolvedRootDir, goLiveOperationsChecklistPath);
  const readinessScript = await readText(resolvedRootDir, goLiveReadinessScriptPath);
  const archiveDeliveryPackage = await readText(resolvedRootDir, archiveDeliveryPackagePath);
  const archiveFreezeDoc = await readText(resolvedRootDir, archiveFreezeDocPath);

  const packageScripts = packageJson?.scripts ?? {};
  for (const [scriptName, expectedCommand] of Object.entries(REQUIRED_PACKAGE_SCRIPT_MAPPINGS)) {
    if (packageScripts[scriptName] !== expectedCommand) {
      failures.push(`package.json script ${scriptName} expected "${expectedCommand}"`);
    }
  }

  failures.push(...collectMissingPhrases(readme, REQUIRED_README_PHRASES, "README"));
  failures.push(...collectMissingPhrases(runbook, REQUIRED_RUNBOOK_PHRASES, "self-hosted runbook"));
  failures.push(...collectMissingPhrases(checklist, REQUIRED_CHECKLIST_PHRASES, "go-live operations checklist"));
  failures.push(...collectMissingPhrases(readinessScript, REQUIRED_READINESS_SCRIPT_PHRASES, "verify-go-live-readiness script"));

  for (const phrase of REQUIRED_ARCHIVE_HISTORY_PHRASES) {
    if (!archiveDeliveryPackage.includes(phrase) && !archiveFreezeDoc.includes(phrase)) {
      failures.push(`archive cold-start history missing phrase: ${phrase}`);
    }
  }

  return {
    ok: failures.length === 0,
    failClosed: true,
    summary:
      failures.length === 0
        ? "当前仓库 cold-start 只认 verify:go-live:delivery-package + verify:go-live / verify:go-live:self-hosted，archive 只保留历史对照。"
        : "当前仓库 cold-start 执行准则与 archive 历史边界发生漂移。",
    currentCommands: {
      archiveAnchorCheck: "npm run verify:go-live:delivery-package",
      unifiedVerifier: "npm run verify:go-live",
      selfHostedVerifier: "npm run verify:go-live:self-hosted",
    },
    archiveOnlyCommands: [
      "node runtime/verify-go-live-cold-start.mjs",
      "node runtime/verify-go-live-consistency-freeze.mjs",
      "node runtime/verify-go-live-delivery-package.mjs",
      "node benchmarks/check-go-live-readiness.mjs",
    ],
    coverage: {
      packageScripts: Object.fromEntries(
        Object.keys(REQUIRED_PACKAGE_SCRIPT_MAPPINGS).map((scriptName) => [scriptName, packageScripts[scriptName] ?? null])
      ),
      enforcedReadinessClasses: [
        "go_live_ready",
        "self_hosted_go_live_ready",
        "pre_public_ready_deploy_pending",
        "local_ready_deploy_pending",
      ],
      stripsDirectAdminTokens: readinessScript.includes('env[key] = "";'),
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
      await verifyGoLiveColdStartPlan({
        rootDir: readArg("root", undefined),
        packageJsonPath: readArg("package-json", undefined),
        readmePath: readArg("readme", undefined),
        selfHostedRunbookPath: readArg("runbook", undefined),
        goLiveOperationsChecklistPath: readArg("checklist", undefined),
        goLiveReadinessScriptPath: readArg("go-live-readiness-script", undefined),
        archiveDeliveryPackagePath: readArg("archive-delivery-package", undefined),
        archiveFreezeDocPath: readArg("archive-freeze-doc", undefined),
      })
    );
  } catch (error) {
    await printCliError(error);
  }
}

#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { printCliError, printCliResult } from "./structured-cli-output.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_GO_LIVE_DELIVERY_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_GO_LIVE_DELIVERY_PACKAGE_PATH = "docs/archive/memory-stability/go-live-delivery-package.md";
export const DEFAULT_GO_LIVE_DELIVERY_MANIFEST_PATH = "docs/archive/memory-stability/go-live-delivery-manifest.json";

const EXPECTED_MANIFEST_SCHEMA_VERSION = "memory-stability-go-live-delivery-manifest/v1";
const EXPECTED_WORKSPACE_SCOPE = "memory-stability-engine-thread";
const EXPECTED_WORKSPACE_CURRENT = "/Users/kane/Documents/ai思维模型";
const EXPECTED_SOURCE_REPOS = [
  "/Users/kane/Documents/openneed",
  "/Users/kane/Documents/agent-passport",
];
const EXPECTED_BOUNDARY = Object.freeze({
  is_new_llm: false,
  calls_models: false,
  uses_network: false,
  runs_provider_benchmarks: false,
  auto_executes_corrections: false,
  correction_plan_actions_are_recommendations: true,
});
const EXPECTED_AUDIT_FLAGS = Object.freeze({
  explicit_execution: true,
  automatic_by_loader: false,
  loader_auto_executed: false,
  model_called: false,
  raw_content_persisted: false,
});
const REQUIRED_ARCHIVE_NOTE_PHRASES = Object.freeze([
  "归档说明：",
  "不是当前 `agent-passport` 仓库的可执行真值入口",
  "/Users/kane/Documents/agent-passport/package.json",
  "/Users/kane/Documents/agent-passport/scripts/",
  "/Users/kane/Documents/agent-passport/tests/",
  "不是新大模型",
  "不调用模型",
]);
const REQUIRED_MANIFEST_COMMANDS = Object.freeze([
  "node runtime/verify-self-learning-governance-learning-proposal.mjs",
  "node runtime/verify-self-learning-governance-examples.mjs",
  "node runtime/verify-go-live-delivery-package.mjs",
  "node runtime/verify-go-live-consistency-freeze.mjs",
  "node benchmarks/check-go-live-readiness.mjs",
]);
const REQUIRED_CURRENT_RUNTIME_LINKS = Object.freeze([
  ["memory_stability_contract", "scripts/verify-memory-stability-contract.mjs"],
  ["memory_stability_engine", "scripts/verify-memory-stability-engine.mjs"],
  ["memory_stability_runtime_loader", "scripts/verify-memory-stability-runtime-loader.mjs"],
  ["memory_stability_self_learning", "scripts/verify-memory-stability-self-learning-governance.mjs"],
  ["self_learning_recovery_schema", "contracts/memory-stability/schemas/self-learning-governance-recovery-report.schema.json"],
  ["self_learning_recovery_fixture", "tests/fixtures/memory-stability/self-learning/recovery/memory-learning-proposal-recovery-required-report.json"],
  ["go_live_readiness", "scripts/verify-go-live-readiness.mjs"],
  ["go_live_runtime_contracts", "scripts/verify-go-live-runtime-contracts.mjs"],
  ["go_live_delivery_package", "scripts/verify-go-live-delivery-package.mjs"],
  ["go_live_consistency_freeze", "scripts/verify-go-live-consistency-freeze.mjs"],
  ["go_live_cold_start", "scripts/verify-go-live-cold-start.mjs"],
]);

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function stringifyJson(value) {
  return JSON.stringify(value ?? []);
}

export async function verifyGoLiveDeliveryPackageArchive({
  rootDir = DEFAULT_GO_LIVE_DELIVERY_ROOT,
  packagePath = DEFAULT_GO_LIVE_DELIVERY_PACKAGE_PATH,
  manifestPath = DEFAULT_GO_LIVE_DELIVERY_MANIFEST_PATH,
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const failures = [];

  const packageDoc = await readText(resolvedRootDir, packagePath);
  const manifest = await readJson(resolvedRootDir, manifestPath);

  failures.push(...collectMissingPhrases(packageDoc, REQUIRED_ARCHIVE_NOTE_PHRASES, "archive delivery package"));

  if (manifest.schema_version !== EXPECTED_MANIFEST_SCHEMA_VERSION) {
    failures.push(`manifest schema_version mismatch: ${manifest.schema_version}`);
  }
  if (manifest.workspace?.scope !== EXPECTED_WORKSPACE_SCOPE) {
    failures.push(`manifest workspace.scope mismatch: ${manifest.workspace?.scope}`);
  }
  if (manifest.workspace?.current !== EXPECTED_WORKSPACE_CURRENT) {
    failures.push(`manifest workspace.current mismatch: ${manifest.workspace?.current}`);
  }
  if (manifest.workspace?.do_not_switch_repos_without_user_request !== true) {
    failures.push("manifest workspace.do_not_switch_repos_without_user_request must stay true");
  }

  const sourceRepos = Array.isArray(manifest.workspace?.source_repos_require_explicit_request)
    ? manifest.workspace.source_repos_require_explicit_request
    : [];
  for (const sourceRepo of EXPECTED_SOURCE_REPOS) {
    if (!sourceRepos.includes(sourceRepo)) {
      failures.push(`manifest source_repos_require_explicit_request missing: ${sourceRepo}`);
    }
  }

  if (!isObject(manifest.boundary)) {
    failures.push("manifest boundary missing");
  } else {
    for (const [key, expected] of Object.entries(EXPECTED_BOUNDARY)) {
      if (manifest.boundary[key] !== expected) {
        failures.push(`manifest boundary.${key} expected ${expected}`);
      }
    }
  }

  if (!isObject(manifest.required_audit_flags)) {
    failures.push("manifest required_audit_flags missing");
  } else {
    for (const [key, expected] of Object.entries(EXPECTED_AUDIT_FLAGS)) {
      if (manifest.required_audit_flags[key] !== expected) {
        failures.push(`manifest required_audit_flags.${key} expected ${expected}`);
      }
    }
  }

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (artifacts.length !== 29) {
    failures.push(`manifest artifacts length mismatch: expected 29, got ${artifacts.length}`);
  }

  const requiredCommands = Array.isArray(manifest.required_commands) ? manifest.required_commands : [];
  if (requiredCommands.length !== 16) {
    failures.push(`manifest required_commands length mismatch: expected 16, got ${requiredCommands.length}`);
  }
  for (const command of REQUIRED_MANIFEST_COMMANDS) {
    if (!requiredCommands.includes(command)) {
      failures.push(`manifest required_commands missing: ${command}`);
    }
  }

  const currentRuntimeLinks = [];
  for (const [id, relativePath] of REQUIRED_CURRENT_RUNTIME_LINKS) {
    const present = await pathExists(resolvedRootDir, relativePath);
    currentRuntimeLinks.push({ id, path: relativePath, present });
    if (!present) {
      failures.push(`current runtime link missing: ${relativePath}`);
    }
  }

  return {
    ok: failures.length === 0,
    failClosed: true,
    archive: {
      packagePath,
      manifestPath,
    },
    summary:
      failures.length === 0
        ? "archive 交付包与当前仓库迁入后的关键 memory-stability contract 保持一致。"
        : "archive 交付包或当前仓库迁移锚点发生漂移。",
    manifest: {
      schemaVersion: manifest.schema_version ?? null,
      workspaceScope: manifest.workspace?.scope ?? null,
      workspaceCurrent: manifest.workspace?.current ?? null,
      artifactCount: artifacts.length,
      requiredCommandCount: requiredCommands.length,
      boundary: manifest.boundary ?? null,
      requiredAuditFlags: manifest.required_audit_flags ?? null,
      requiredCommands,
      sevenMechanisms: Array.isArray(manifest.seven_mechanisms) ? manifest.seven_mechanisms : [],
      cannotProve: Array.isArray(manifest.cannot_prove) ? manifest.cannot_prove : [],
    },
    coverage: {
      archiveNoteVerified: REQUIRED_ARCHIVE_NOTE_PHRASES,
      requiredManifestCommands: REQUIRED_MANIFEST_COMMANDS,
      currentRuntimeLinks,
      sourceReposRequireExplicitRequest: sourceRepos,
      artifactsDigest: stringifyJson(
        artifacts.slice(0, 5).map((artifact) => ({
          path: artifact?.path ?? null,
          kind: artifact?.kind ?? null,
        }))
      ),
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
      await verifyGoLiveDeliveryPackageArchive({
        rootDir: readArg("root", undefined),
        packagePath: readArg("package", undefined),
        manifestPath: readArg("manifest", undefined),
      })
    );
  } catch (error) {
    await printCliError(error);
  }
}

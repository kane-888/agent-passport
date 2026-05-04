#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildStagedMemoryStabilitySnapshot } from "../src/memory-stability/staged-adapter.js";
import {
  compactMemoryStabilityPath,
  DEFAULT_MEMORY_STABILITY_REPO_ROOT,
  resolveMemoryStabilityPathInsideRoot,
} from "../src/memory-stability/contract-loader.js";

const rootDir = DEFAULT_MEMORY_STABILITY_REPO_ROOT;
const defaultOutputDir = "tests/fixtures/memory-stability/generated";

function readArg(name, fallback = null) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg === name || arg.startsWith(prefix));
  if (!match) {
    return fallback;
  }
  return match === name ? true : match.slice(prefix.length);
}

function resolveOutputDir(value) {
  try {
    return resolveMemoryStabilityPathInsideRoot(rootDir, String(value || defaultOutputDir));
  } catch (error) {
    throw new Error(`Refusing to write memory stability snapshots outside workspace: ${value}`, {
      cause: error,
    });
  }
}

function sampleRuntimeStates(createdAt) {
  const stableAnchors = [
    {
      memoryId: "project-boundary",
      content: "agent-passport stays the public product boundary.",
      importanceWeight: 3,
      source: "runtime-example",
      insertedPosition: "back",
      lastVerifiedAt: createdAt,
      lastVerifiedOk: true,
      authorityRank: 0.95,
    },
    {
      memoryId: "truth-rule",
      content: "Public runtime truth must stay machine-readable.",
      importanceWeight: 2,
      source: "runtime-example",
      insertedPosition: "front",
      lastVerifiedAt: createdAt,
      lastVerifiedOk: true,
      authorityRank: 0.9,
    },
    {
      memoryId: "next-step",
      content: "Next execution step must remain resumable.",
      importanceWeight: 1,
      source: "runtime-example",
      insertedPosition: "back",
      lastVerifiedAt: createdAt,
      lastVerifiedOk: true,
      authorityRank: 0.84,
    },
  ];
  const mediumAnchors = [
    {
      memoryId: "project-boundary",
      content: "agent-passport stays the public product boundary.",
      importanceWeight: 3,
      source: "runtime-example",
      insertedPosition: "middle",
      lastVerifiedAt: createdAt,
      lastVerifiedOk: true,
      authorityRank: 0.95,
    },
    {
      memoryId: "handoff-next",
      content: "Handoff state must survive resumable execution.",
      importanceWeight: 3,
      source: "runtime-example",
      insertedPosition: "middle",
      lastVerifiedAt: createdAt,
      lastVerifiedOk: false,
      authorityRank: 0.92,
      conflictState: {
        hasConflict: true,
      },
    },
    {
      memoryId: "no-fake-data",
      content: "Synthetic evidence must never masquerade as runtime truth.",
      importanceWeight: 1,
      source: "runtime-example",
      insertedPosition: "middle",
      lastVerifiedAt: createdAt,
      lastVerifiedOk: true,
      authorityRank: 0.88,
    },
    {
      memoryId: "placement-policy",
      content: "Local runtimes should compress early when context gets crowded.",
      importanceWeight: 1,
      source: "runtime-example",
      insertedPosition: "front",
      lastVerifiedAt: createdAt,
      lastVerifiedOk: true,
      authorityRank: 0.82,
    },
  ];
  const strongAnchors = [
    {
      memoryId: "project-boundary",
      content: "agent-passport stays the public product boundary.",
      importanceWeight: 3,
      source: "runtime-example",
      insertedPosition: "middle",
      lastVerifiedAt: createdAt,
      lastVerifiedOk: false,
      authorityRank: 0.95,
      conflictState: {
        hasConflict: true,
      },
    },
    {
      memoryId: "handoff-next",
      content: "Handoff state must survive resumable execution.",
      importanceWeight: 3,
      source: "runtime-example",
      insertedPosition: "middle",
      lastVerifiedAt: createdAt,
      lastVerifiedOk: false,
      authorityRank: 0.92,
      conflictState: {
        hasConflict: true,
      },
    },
    {
      memoryId: "no-fake-data",
      content: "Synthetic evidence must never masquerade as runtime truth.",
      importanceWeight: 2,
      source: "runtime-example",
      insertedPosition: "middle",
      lastVerifiedAt: createdAt,
      lastVerifiedOk: true,
      authorityRank: 0.88,
      conflictState: {
        hasConflict: true,
      },
    },
    {
      memoryId: "provider-route",
      content: "Provider routing must stay explicit and repairable.",
      importanceWeight: 1,
      source: "runtime-example",
      insertedPosition: "front",
      lastVerifiedAt: createdAt,
      lastVerifiedOk: false,
      authorityRank: 0.8,
    },
  ];
  return [
    {
      file: "stable-runtime-snapshot.redacted.json",
      snapshotId: "stable-runtime-snapshot",
      provider: "deepseek",
      runtimeState: {
        sessionId: "snapshot-stable",
        modelName: "deepseek-chat",
        ctxTokens: 1200,
        checkedMemories: 3,
        conflictMemories: 0,
        memoryAnchors: stableAnchors,
      },
    },
    {
      file: "medium-risk-runtime-snapshot.redacted.json",
      snapshotId: "medium-risk-runtime-snapshot",
      provider: "ollama:gemma4:e4b",
      runtimeState: {
        sessionId: "snapshot-medium-risk",
        modelName: "gemma4:e4b",
        ctxTokens: 1900,
        checkedMemories: 4,
        conflictMemories: 1,
        memoryAnchors: mediumAnchors,
      },
    },
    {
      file: "strong-risk-runtime-snapshot.redacted.json",
      snapshotId: "strong-risk-runtime-snapshot",
      provider: "ollama:gemma4:e4b",
      runtimeState: {
        sessionId: "snapshot-strong-risk",
        modelName: "gemma4:e4b",
        ctxTokens: 2400,
        checkedMemories: 4,
        conflictMemories: 3,
        memoryAnchors: strongAnchors,
      },
    },
  ];
}

async function main() {
  const outputDir = resolveOutputDir(readArg("--output-dir", defaultOutputDir));
  const createdAt = String(readArg("--created-at", new Date().toISOString()));
  await mkdir(outputDir, { recursive: true });

  const written = [];
  for (const sample of sampleRuntimeStates(createdAt)) {
    const staged = await buildStagedMemoryStabilitySnapshot({
      runtimeState: sample.runtimeState,
      provider: sample.provider,
      createdAt,
      snapshotId: sample.snapshotId,
      description:
        "agent-passport generated a synthetic hash-only memory-stability snapshot fixture for product verification.",
    });
    const outputPath = path.join(outputDir, sample.file);
    await writeFile(outputPath, `${JSON.stringify(staged.snapshot, null, 2)}\n`);
    written.push({
      file: compactMemoryStabilityPath(rootDir, outputPath),
      correction_level: staged.snapshot.runtime_state.correction_level,
      c_t: staged.snapshot.runtime_state.c_t,
      raw_content_persisted: staged.snapshot.privacy.raw_content_persisted,
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        verifier: "memory-stability-snapshot-generator",
        schema_version: "memory-stability-runtime-snapshot/v1",
        output_dir: compactMemoryStabilityPath(rootDir, outputDir),
        generated_scope: "synthetic_hash_only_redacted_fixtures",
        modelCalled: false,
        networkCalled: false,
        ledgerWritten: false,
        written,
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

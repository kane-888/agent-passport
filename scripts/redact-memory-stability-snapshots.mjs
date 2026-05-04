#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  compactMemoryStabilityPath,
  DEFAULT_MEMORY_STABILITY_REPO_ROOT,
  loadVerifiedMemoryStabilityContract,
  resolveMemoryStabilityPathInsideRoot,
  validateMemoryStabilityRedactedSnapshot,
} from "../src/memory-stability/contract-loader.js";

const rootDir = DEFAULT_MEMORY_STABILITY_REPO_ROOT;
const defaultInputDir = "tests/fixtures/memory-stability/raw";
const defaultOutputDir = "tests/fixtures/memory-stability/redacted";

function readArg(name, fallback = null) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg === name || arg.startsWith(prefix));
  if (!match) {
    return fallback;
  }
  return match === name ? true : match.slice(prefix.length);
}

function resolveWorkspacePath(value, label) {
  try {
    return resolveMemoryStabilityPathInsideRoot(rootDir, String(value));
  } catch (error) {
    throw new Error(`Refusing to access memory stability ${label} outside workspace: ${value}`, {
      cause: error,
    });
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function nonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function redactAnchor(anchor = {}, index = 0, redactedAt) {
  const memoryId = nonEmptyString(anchor.memory_id ?? anchor.memoryId, `memory-${index + 1}`);
  const rawContent = nonEmptyString(anchor.content, memoryId);
  const hash = sha256(rawContent);
  return {
    memory_id: memoryId,
    content: `[redacted:${hash.slice(0, 12)}]`,
    importance_weight: Math.max(0, Number(anchor.importance_weight ?? anchor.importanceWeight ?? 0) || 0),
    source: nonEmptyString(anchor.source, "agent-passport-memory-stability-redactor"),
    inserted_position: nonEmptyString(anchor.inserted_position ?? anchor.insertedPosition, "middle"),
    last_verified_at: nonEmptyString(anchor.last_verified_at ?? anchor.lastVerifiedAt, redactedAt),
    last_verified_ok:
      anchor.last_verified_ok == null && anchor.lastVerifiedOk == null
        ? null
        : Boolean(anchor.last_verified_ok ?? anchor.lastVerifiedOk),
    conflict: Boolean(anchor.conflict === true || anchor.conflictState?.hasConflict === true),
    authoritative: Boolean(anchor.authoritative === true || Number(anchor.authorityRank ?? 0) >= 0.75),
    content_redaction: "hash_only",
    sensitivity: nonEmptyString(anchor.sensitivity, "internal"),
    content_sha256: hash,
    content_length: rawContent.length,
    content_redacted: true,
  };
}

function redactSnapshot(snapshot, { redactedAt }) {
  const runtimeState = snapshot?.runtime_state && typeof snapshot.runtime_state === "object"
    ? snapshot.runtime_state
    : {};
  const anchors = Array.isArray(runtimeState.memory_anchors) ? runtimeState.memory_anchors : [];
  return {
    ...snapshot,
    runtime_state: {
      ...runtimeState,
      memory_anchors: anchors.map((anchor, index) => redactAnchor(anchor, index, redactedAt)),
    },
    privacy: {
      mode: "redacted",
      anchor_content_policy: "hash_only",
      redacted_at: redactedAt,
      raw_content_persisted: false,
      note: "Memory stability redactor stores deterministic hash markers and sha256 refs instead of raw anchor text.",
    },
  };
}

async function main() {
  const inputDir = resolveWorkspacePath(readArg("--input-dir", defaultInputDir), "input dir");
  const outputDir = resolveWorkspacePath(readArg("--output-dir", defaultOutputDir), "output dir");
  const redactedAt = String(readArg("--redacted-at", new Date().toISOString()));
  const contract = await loadVerifiedMemoryStabilityContract();
  await mkdir(outputDir, { recursive: true });

  const files = (await readdir(inputDir))
    .filter((file) => file.endsWith("-runtime-snapshot.json") && !file.endsWith(".redacted.json"))
    .sort();
  const written = [];
  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputName = file.replace(/\.json$/u, ".redacted.json");
    const outputPath = path.join(outputDir, outputName);
    const redacted = redactSnapshot(await readJson(inputPath), { redactedAt });
    validateMemoryStabilityRedactedSnapshot(redacted, outputName, {
      runtimeProfile: contract.profile,
      expectedProfilePath: contract.contract.profilePath,
    });
    await writeFile(outputPath, `${JSON.stringify(redacted, null, 2)}\n`);
    written.push({
      source: compactMemoryStabilityPath(rootDir, inputPath),
      file: compactMemoryStabilityPath(rootDir, outputPath),
      anchors: redacted.runtime_state.memory_anchors.length,
      raw_content_persisted: false,
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        verifier: "memory-stability-snapshot-redactor",
        input_dir: compactMemoryStabilityPath(rootDir, inputDir),
        output_dir: compactMemoryStabilityPath(rootDir, outputDir),
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

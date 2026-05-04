#!/usr/bin/env node

import {
  MemoryStabilityRuntimeLoadError,
  loadVerifiedMemoryStabilityRuntime,
} from "../src/memory-stability/runtime-loader.js";

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
}

try {
  const runtime = await loadVerifiedMemoryStabilityRuntime({
    rootDir: readArg("root", undefined),
    includeAdapterContract: !process.argv.includes("--skip-adapter-contract"),
    includeSelfLearningGovernance: !process.argv.includes("--skip-self-learning"),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        failClosed: runtime.failClosed,
        mode: runtime.mode,
        gates: runtime.gates,
        effects: runtime.effects,
        contract: runtime.contract,
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  const failure =
    error instanceof MemoryStabilityRuntimeLoadError
      ? error
      : new MemoryStabilityRuntimeLoadError("Memory stability runtime loader verification failed", {
          cause: error,
          detail: error instanceof Error ? error.message : String(error),
        });
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        failClosed: true,
        code: failure.code,
        stage: failure.stage,
        message: failure.message,
        detail: failure.detail,
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
}

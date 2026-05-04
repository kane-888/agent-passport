import {
  loadVerifiedMemoryStabilityContract,
  MemoryStabilityContractLoadError,
} from "../src/memory-stability/contract-loader.js";

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
}

try {
  const contract = await loadVerifiedMemoryStabilityContract({
    rootDir: readArg("root", undefined),
    profilePath: readArg("profile", undefined),
    profileSchemaPath: readArg("profile-schema", undefined),
    snapshotSchemaPath: readArg("snapshot-schema", undefined),
    redactedFixturesDir: readArg("redacted-dir", undefined),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        failClosed: contract.failClosed,
        loadedAt: contract.loadedAt,
        contract: contract.contract,
        profile: contract.verifierReports.profile,
        snapshots: contract.verifierReports.snapshots,
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  const failure =
    error instanceof MemoryStabilityContractLoadError
      ? error
      : new MemoryStabilityContractLoadError("Memory stability contract verification failed", {
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

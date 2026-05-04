import {
  verifyMemoryStabilityAdapterContract,
  MemoryStabilityAdapterContractError,
} from "../src/memory-stability/adapter-contract.js";

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
}

try {
  const contract = await verifyMemoryStabilityAdapterContract({
    rootDir: readArg("root", undefined),
    correctionEventSchemaPath: readArg("correction-event-schema", undefined),
    correctionEventsDir: readArg("correction-events-dir", undefined),
    redactedFixturesDir: readArg("redacted-dir", undefined),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        failClosed: contract.failClosed,
        loadedAt: contract.loadedAt,
        contract: contract.contract,
        correctionEvents: contract.verifierReports.correctionEvents,
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  const failure =
    error instanceof MemoryStabilityAdapterContractError
      ? error
      : new MemoryStabilityAdapterContractError("Memory stability adapter contract verification failed", {
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

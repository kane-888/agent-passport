#!/usr/bin/env node

import {
  MemoryStabilitySelfLearningGovernanceError,
  loadVerifiedSelfLearningGovernanceContract,
} from "../src/memory-stability/self-learning-governance.js";

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
}

try {
  const contract = await loadVerifiedSelfLearningGovernanceContract({
    rootDir: readArg("root", undefined),
    proposalSchemaPath: readArg("proposal-schema", undefined),
    dryRunSchemaPath: readArg("dry-run-schema", undefined),
    recoveryReportSchemaPath: readArg("recovery-report-schema", undefined),
    proposalFixturePath: readArg("proposal-fixture", undefined),
    applyDryRunFixturePath: readArg("apply-dry-run", undefined),
    revertDryRunFixturePath: readArg("revert-dry-run", undefined),
    recoveryReportFixturePath: readArg("recovery-report", undefined),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        failClosed: contract.failClosed,
        contract: contract.contract,
        verifierReports: contract.verifierReports,
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  const failure =
    error instanceof MemoryStabilitySelfLearningGovernanceError
      ? error
      : new MemoryStabilitySelfLearningGovernanceError("Memory stability self-learning governance verification failed", {
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

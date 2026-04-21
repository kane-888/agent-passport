import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureSmokeServer,
  prepareSmokeDataRoot,
  resolveSmokeBaseUrl,
} from "./smoke-server.mjs";
import {
  formatOperationalFlowSemanticsSummary,
  formatRuntimeEvidenceSemanticsSummary,
  runStepDefsOutcomes,
  summarizeOperationalFlowSemantics,
  summarizeRuntimeEvidenceSemantics,
} from "./smoke-all.mjs";

const __filename = fileURLToPath(import.meta.url);
const operationalGateDirectExecution = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

const operationalStepDefs = [
  ["smoke:ui:operational", "smoke-ui-operational.mjs", {}],
  ["smoke:dom:operational", "smoke-dom-operational.mjs", {}],
];

async function main() {
  const startedAt = Date.now();
  const resolvedBaseUrl = await resolveSmokeBaseUrl();
  const resolvedDataRoot = await prepareSmokeDataRoot({
    isolated: !resolvedBaseUrl.reuseExisting,
    tempPrefix: "agent-passport-smoke-operational-",
  });
  const smokeServer = await ensureSmokeServer(resolvedBaseUrl.baseUrl, {
    reuseExisting: resolvedBaseUrl.reuseExisting,
    extraEnv: resolvedDataRoot.isolationEnv,
  });
  const baseEnv = {
    AGENT_PASSPORT_BASE_URL: smokeServer.baseUrl,
    ...resolvedDataRoot.isolationEnv,
  };
  const steps = [];
  let failedSteps = [];

  try {
    const operationalOutcomes = await runStepDefsOutcomes(operationalStepDefs, baseEnv, {
      parallel: true,
    });
    steps.push(...operationalOutcomes.steps);
    failedSteps = operationalOutcomes.failedSteps;

    const operationalFlowSemantics = summarizeOperationalFlowSemantics(steps);
    operationalFlowSemantics.summary = formatOperationalFlowSemanticsSummary(operationalFlowSemantics);
    const runtimeEvidenceSemantics = summarizeRuntimeEvidenceSemantics(steps);
    runtimeEvidenceSemantics.summary = formatRuntimeEvidenceSemanticsSummary(runtimeEvidenceSemantics);
    const totalDurationMs = Date.now() - startedAt;
    const ok =
      failedSteps.length === 0 &&
      operationalFlowSemantics.status === "passed" &&
      runtimeEvidenceSemantics.status === "passed";
    const serverProcess = smokeServer.getOutput?.() || null;

    console.log(
      JSON.stringify(
        {
          ok,
          mode: "operational_only",
          error: failedSteps[0]?.error || null,
          failedSteps,
          totalDurationMs,
          baseUrl: smokeServer.baseUrl,
          serverStartedBySmokeOperational: smokeServer.started,
          serverIsolationMode: resolvedBaseUrl.isolationMode,
          serverDataIsolationMode: resolvedDataRoot.dataIsolationMode,
          serverSecretIsolationMode: resolvedDataRoot.secretIsolationMode,
          serverProcess: ok
            ? undefined
            : {
                exitCode: serverProcess?.exitCode ?? null,
                signalCode: serverProcess?.signalCode ?? null,
                stderr: serverProcess?.stderr || null,
              },
          operationalFlowSemantics,
          runtimeEvidenceSemantics,
          steps,
        },
        null,
        2
      )
    );

    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    await smokeServer.stop();
    await resolvedDataRoot.cleanup();
  }
}

if (operationalGateDirectExecution) {
  await main();
}

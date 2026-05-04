import { selectRuntimeTruth } from "../public/runtime-truth-client.js";
import {
  buildPublicAgentRuntimeTruth,
  buildUnavailablePublicAgentRuntimeTruth,
} from "./public-agent-runtime-truth.js";
import { buildRuntimeReleaseReadiness } from "./release-readiness.js";

export function buildSecurityRuntimeContext({
  securityPosture = null,
  setup = null,
  runtimeSummary = null,
  health = null,
} = {}) {
  const agentRuntimeTruth =
    buildPublicAgentRuntimeTruth(runtimeSummary) ||
    buildUnavailablePublicAgentRuntimeTruth({ setup });
  const runtimeTruth = selectRuntimeTruth({
    security: {
      securityPosture,
      agentRuntimeTruth,
    },
    setup,
  });
  const securityBase = {
    securityPosture,
    localStorageFormalFlow: runtimeTruth.formalRecovery || null,
    constrainedExecution: runtimeTruth.constrainedExecution || null,
    automaticRecovery: runtimeTruth.automaticRecovery || null,
    agentRuntimeTruth,
  };
  const releaseReadiness = buildRuntimeReleaseReadiness({
    health,
    security: securityBase,
    setup,
  });

  return {
    runtimeTruth,
    agentRuntimeTruth,
    releaseReadiness,
    security: {
      ...securityBase,
      releaseReadiness,
    },
  };
}

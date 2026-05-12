import {
  normalizeOptionalText,
} from "./ledger-core-utils.js";
import {
  normalizeRuntimeReasonerProvider,
} from "./ledger-device-runtime.js";
import {
  normalizeRuntimeMemoryStateRecord,
} from "./memory-homeostasis.js";
import {
  clampMemoryHomeostasisMetric,
  getRuntimeMemoryObservationCorrectionSeverity,
  normalizeRuntimeMemoryObservationCorrectionLevel,
} from "./ledger-runtime-memory-observations.js";
import {
  isRunnerOnlineReasonerProvider,
  isRunnerQualityEscalationLocalReasonerProvider,
} from "./ledger-runner-reasoner-plan.js";

export function buildRunnerVerificationIssueCodes(verification = null) {
  return Array.isArray(verification?.issues)
    ? verification.issues.map((issue) => normalizeOptionalText(issue?.code)).filter(Boolean)
    : [];
}

export function isVerifiedMemoryStabilityPromptPreflightForQualitySignal(promptPreflight = null) {
  return (
    promptPreflight &&
    typeof promptPreflight === "object" &&
    promptPreflight.ok === true &&
    normalizeOptionalText(promptPreflight.status) === "ready" &&
    normalizeOptionalText(promptPreflight.mode) === "memory-stability-prompt-preflight/v1" &&
    promptPreflight.runtimeLoader?.ok === true
  );
}

export function buildRunnerMemoryStabilityQualitySignal({
  runtimeMemoryState = null,
  runtimeMemoryCorrectionPlan = null,
  promptPreflight = null,
} = {}) {
  const normalizedRuntimeState =
    runtimeMemoryState && typeof runtimeMemoryState === "object"
      ? normalizeRuntimeMemoryStateRecord(runtimeMemoryState)
      : null;
  const runtimeCorrectionLevel = normalizeRuntimeMemoryObservationCorrectionLevel(
    normalizedRuntimeState?.correctionLevel ??
      normalizedRuntimeState?.correction_level
      ?? runtimeMemoryCorrectionPlan?.correctionLevel
  );
  const runtimeSeverity = getRuntimeMemoryObservationCorrectionSeverity(runtimeCorrectionLevel);
  const runtimeCT = clampMemoryHomeostasisMetric(
    normalizedRuntimeState?.cT ?? normalizedRuntimeState?.c_t,
    0,
    1
  );
  const preflightReady = isVerifiedMemoryStabilityPromptPreflightForQualitySignal(promptPreflight);
  const preflightRuntimeState =
    promptPreflight?.snapshot?.runtime_state && typeof promptPreflight.snapshot.runtime_state === "object"
      ? promptPreflight.snapshot.runtime_state
      : null;
  const preflightCorrectionLevel = preflightReady
    ? normalizeRuntimeMemoryObservationCorrectionLevel(
        preflightRuntimeState?.correction_level ??
          preflightRuntimeState?.correctionLevel ??
          promptPreflight?.decision?.correctionLevel
      )
    : "none";
  const preflightSeverity = getRuntimeMemoryObservationCorrectionSeverity(preflightCorrectionLevel);
  const preflightCT = preflightReady
    ? clampMemoryHomeostasisMetric(
        preflightRuntimeState?.c_t ?? preflightRuntimeState?.cT,
        0,
        1
      )
    : 0;
  const runtimeSource = runtimeSeverity > 0 || runtimeCT > 0 ? "runtime_memory" : null;
  const effectiveSeverity = runtimeSeverity;
  const effectiveCorrectionLevel = runtimeSeverity > 0 ? runtimeCorrectionLevel : "none";
  const effectiveCT = runtimeCT;
  const signalSource = runtimeSeverity > 0 || runtimeCT > 0 ? runtimeSource : null;

  return {
    correctionLevel: effectiveCorrectionLevel,
    correctionSeverity: effectiveSeverity,
    cT: effectiveCT,
    runtimeCorrectionLevel,
    runtimeCT,
    preflightCorrectionLevel,
    preflightCT,
    preflightStatus: normalizeOptionalText(promptPreflight?.status) ?? null,
    signalSource: signalSource ?? null,
    unstable: effectiveSeverity >= getRuntimeMemoryObservationCorrectionSeverity("medium"),
  };
}

export function buildRunnerReasonerQualityEscalationDecision({
  reasonerPlan = null,
  reasoner = null,
  verification = null,
  candidateResponse = null,
  runtimeMemoryState = null,
  runtimeMemoryCorrectionPlan = null,
  promptPreflight = null,
} = {}) {
  const initialProvider =
    normalizeRuntimeReasonerProvider(reasoner?.provider) ??
    normalizeRuntimeReasonerProvider(reasonerPlan?.effectiveProvider) ??
    null;
  const provider = normalizeRuntimeReasonerProvider(reasonerPlan?.qualityEscalationProvider) ?? null;
  const issueCodes = buildRunnerVerificationIssueCodes(verification);
  const hasCandidate = Boolean(normalizeOptionalText(candidateResponse ?? reasoner?.responseText));
  const memoryStability = buildRunnerMemoryStabilityQualitySignal({
    runtimeMemoryState,
    runtimeMemoryCorrectionPlan,
    promptPreflight,
  });

  if (!hasCandidate) {
    return {
      eligible: false,
      shouldEscalate: false,
      provider,
      initialProvider,
      issueCodes,
      memoryStability,
      reason: "missing_candidate_response",
    };
  }
  if (!isRunnerQualityEscalationLocalReasonerProvider(initialProvider)) {
    return {
      eligible: false,
      shouldEscalate: false,
      provider,
      initialProvider,
      issueCodes,
      memoryStability,
      reason: "provider_not_local",
    };
  }
  if (normalizeOptionalText(reasoner?.error)) {
    return {
      eligible: false,
      shouldEscalate: false,
      provider,
      initialProvider,
      issueCodes,
      memoryStability,
      reason: "reasoner_error",
    };
  }
  if (reasonerPlan?.forceLocalReasonerAttempt && initialProvider !== "local_mock") {
    return {
      eligible: false,
      shouldEscalate: false,
      provider,
      initialProvider,
      issueCodes,
      memoryStability,
      reason: "forced_local_reasoner",
    };
  }
  if (!reasonerPlan?.onlineAllowed) {
    return {
      eligible: false,
      shouldEscalate: false,
      provider,
      initialProvider,
      issueCodes,
      memoryStability,
      reason: "online_not_allowed",
    };
  }
  if (!provider || !isRunnerOnlineReasonerProvider(provider)) {
    return {
      eligible: false,
      shouldEscalate: false,
      provider,
      initialProvider,
      issueCodes,
      memoryStability,
      reason: "no_online_reasoner_configured",
    };
  }
  if (initialProvider === "local_mock") {
    return {
      eligible: true,
      shouldEscalate: true,
      provider,
      initialProvider,
      issueCodes,
      memoryStability,
      reason: "local_mock_degraded",
    };
  }
  if (verification?.valid === false) {
    return {
      eligible: true,
      shouldEscalate: true,
      provider,
      initialProvider,
      issueCodes,
      memoryStability,
      reason: "verification_invalid",
    };
  }
  if (memoryStability.unstable) {
    return {
      eligible: true,
      shouldEscalate: true,
      provider,
      initialProvider,
      issueCodes,
      memoryStability,
      reason: "memory_stability_unstable",
    };
  }
  if (verification?.valid === true) {
    return {
      eligible: true,
      shouldEscalate: false,
      provider,
      initialProvider,
      issueCodes,
      memoryStability,
      reason: "verification_passed",
    };
  }
  return {
    eligible: true,
    shouldEscalate: false,
    provider,
    initialProvider,
    issueCodes,
    memoryStability,
    reason: "verification_unavailable",
  };
}

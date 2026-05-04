import assert from "node:assert/strict";
import test from "node:test";

import {
  formatRuntimeEvidenceSemanticsSummary,
  summarizeRuntimeEvidenceSemantics,
} from "../scripts/smoke-all.mjs";

test("runtime-evidence semantics accepts explicit UI runtime evidence and does not require DOM operational duplicates", () => {
  const gate = summarizeRuntimeEvidenceSemantics([
    {
      name: "smoke:ui:operational",
      result: {
        localReasonerLifecycleExpected: true,
        localReasonerLifecycleMeaning:
          "smoke exercises local reasoner catalog/probe/prewarm plus saved profile lifecycle so readiness is explicit instead of inferred from raw counters",
        localReasonerLifecycleGateState: {
          runMode: "configure_probe_profile",
          configuredStatus: "configured",
          catalogProviderCount: 1,
          probeStatus: "reachable",
          selectedProvider: "local_command",
          prewarmStatus: "ready",
          observedProfileCount: 1,
          observedRestoreCandidateCount: 1,
        },
        conversationMemoryExpected: true,
        conversationMemoryMeaning:
          "smoke expects conversation-minute and transcript evidence to remain queryable for runtime retrieval instead of being interpreted from bare counts",
        conversationMemoryGateState: {
          runMode: "persist_and_retrieve",
          minuteId: "minute_ui_1",
          observedMinuteCount: 1,
          transcriptEntryCount: 2,
          transcriptBlockCount: 1,
          runtimeSearchHits: 2,
        },
        sandboxAuditEvidenceExpected: true,
        sandboxAuditMeaning:
          "smoke expects audited sandbox probes to leave explicit runtime_search/filesystem_list evidence rather than relying on side effects alone",
        sandboxAuditGateState: {
          runMode: "audit_trail_expected",
          observedAuditCount: 2,
          sandboxSearchHits: 1,
          sandboxListEntries: 1,
        },
        executionHistoryExpected: true,
        executionHistoryMeaning:
          "smoke executes verification and runner flows and expects both histories to retain explicit evidence",
        executionHistoryGateState: {
          runMode: "persist_history",
          verificationStatus: "passed",
          observedVerificationHistoryCount: 1,
          runnerStatus: "completed",
          observedRunnerHistoryCount: 2,
        },
        qualityEscalationRuns: 1,
        latestQualityEscalationActivated: true,
        latestQualityEscalationProvider: "openai_compatible",
        latestQualityEscalationReason: "verification_invalid",
        latestRunMemoryStabilityCorrectionLevel: "medium",
        latestRunMemoryStabilityRiskScore: 0.41,
        latestRunMemoryStabilitySignalSource: "runtime_memory",
        latestRunMemoryStabilityPreflightStatus: "performed",
        memoryStabilityStateCount: 1,
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
        latestMemoryStabilityObservationKind: "correction_rebuild",
        latestMemoryStabilityRecoverySignal: "risk_rising",
        latestMemoryStabilityCorrectionActions: ["rewrite_working_memory_summary"],
        memoryStabilityRecoveryRate: 0,
        runtimeStabilityStateCount: 1,
        runtimeStabilityLatestStateId: "memory_state_1",
        runtimeStabilityLatestCorrectionLevel: "medium",
        runtimeStabilityLatestRiskScore: 0.41,
        autoRecoveryResumed: true,
        autoRecoveryResumeStatus: "resumed",
        autoRecoveryResumeChainLength: 2,
        retryWithoutExecutionResumeStatus: "resumed",
        retryWithoutExecutionResumeChainLength: 2,
      },
    },
    {
      name: "smoke:dom:operational",
      result: {
        setupPackagePersistenceExpected: true,
      },
    },
  ]);

  assert.equal(gate.status, "passed");
  assert.equal(gate.passedChecks, 10);
  assert.deepEqual(gate.failedChecks, []);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UILocalReasoner=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UIConversation=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UISandbox=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UIExecutionHistory=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UIQualityEscalation=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UIMemoryStability=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UIMemoryConsistency=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UIRunnerMemory=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UIAutoRecovery=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UIRetryNoExec=pass/);
});

test("runtime-evidence semantics fails when UI execution history lacks persisted runner evidence", () => {
  const gate = summarizeRuntimeEvidenceSemantics([
    {
      name: "smoke:ui:operational",
      result: {
        executionHistoryExpected: true,
        executionHistoryMeaning:
          "smoke executes verification and runner flows and expects both histories to retain explicit evidence",
        executionHistoryGateState: {
          runMode: "persist_history",
          verificationStatus: "passed",
          observedVerificationHistoryCount: 1,
          runnerStatus: "completed",
          observedRunnerHistoryCount: 0,
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("ui_execution_history_semantics"));
});

test("runtime-evidence semantics fails when UI memory stability summary drifts from runtime stability history", () => {
  const gate = summarizeRuntimeEvidenceSemantics([
    {
      name: "smoke:ui:operational",
      result: {
        memoryStabilityStateCount: 1,
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
        latestMemoryStabilityObservationKind: "correction_rebuild",
        latestMemoryStabilityCorrectionActions: ["rewrite_working_memory_summary"],
        memoryStabilityRecoveryRate: 0,
        runtimeStabilityStateCount: 1,
        runtimeStabilityLatestStateId: "memory_state_2",
        runtimeStabilityLatestCorrectionLevel: "strong",
        runtimeStabilityLatestRiskScore: 0.72,
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("ui_memory_stability_consistency_semantics"));
});

test("runtime-evidence semantics fails when UI memory stability lacks observation truth", () => {
  const gate = summarizeRuntimeEvidenceSemantics([
    {
      name: "smoke:ui:operational",
      result: {
        memoryStabilityStateCount: 1,
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityCorrectionLevel: "none",
        latestMemoryStabilityRiskScore: 0.08,
        latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
        runtimeStabilityStateCount: 1,
        runtimeStabilityLatestStateId: "memory_state_1",
        runtimeStabilityLatestCorrectionLevel: "none",
        runtimeStabilityLatestRiskScore: 0.08,
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("ui_memory_stability_truth_semantics"));
});

test("runtime-evidence semantics fails when UI active correction omits recovery guidance", () => {
  const gate = summarizeRuntimeEvidenceSemantics([
    {
      name: "smoke:ui:operational",
      result: {
        memoryStabilityStateCount: 1,
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
        latestMemoryStabilityObservationKind: "correction_rebuild",
        runtimeStabilityStateCount: 1,
        runtimeStabilityLatestStateId: "memory_state_1",
        runtimeStabilityLatestCorrectionLevel: "medium",
        runtimeStabilityLatestRiskScore: 0.41,
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("ui_memory_stability_truth_semantics"));
});

test("runtime-evidence semantics ignores operational-looking evidence under combined step names", () => {
  const gate = summarizeRuntimeEvidenceSemantics([
    {
      name: "smoke:ui",
      result: {
        executionHistoryExpected: true,
        executionHistoryMeaning: "combined smoke must not satisfy operational runtime evidence",
        executionHistoryGateState: {
          runMode: "persist_history",
          verificationStatus: "passed",
          observedVerificationHistoryCount: 1,
          runnerStatus: "completed",
          observedRunnerHistoryCount: 2,
        },
      },
    },
    {
      name: "smoke:dom",
      result: {
        localReasonerLifecycleExpected: true,
        localReasonerLifecycleMeaning: "combined DOM must not satisfy operational runtime evidence",
        localReasonerLifecycleGateState: {
          runMode: "configure_probe_profile",
          configuredStatus: "configured",
          catalogProviderCount: 1,
          probeStatus: "reachable",
          selectedProvider: "local_command",
          prewarmStatus: "ready",
          observedProfileCount: 1,
          observedRestoreCandidateCount: 1,
        },
      },
    },
  ]);

  assert.equal(gate.status, "unavailable");
  assert.equal(gate.totalChecks, 0);
});

test("runtime-evidence semantics fails when UI operational evidence is nested away from required top-level keys", () => {
  const gate = summarizeRuntimeEvidenceSemantics([
    {
      name: "smoke:ui:operational",
      result: {
        runtimeEvidence: {
          localReasonerLifecycleExpected: true,
          localReasonerLifecycleMeaning: "nested evidence must not satisfy the gate",
          localReasonerLifecycleGateState: {
            runMode: "configure_probe_profile",
            configuredStatus: "configured",
            catalogProviderCount: 1,
            probeStatus: "reachable",
            selectedProvider: "local_command",
            prewarmStatus: "ready",
            observedProfileCount: 1,
            observedRestoreCandidateCount: 1,
          },
          autoRecoveryResumed: true,
          autoRecoveryResumeStatus: "resumed",
          autoRecoveryResumeChainLength: 2,
          retryWithoutExecutionResumeStatus: "resumed",
          retryWithoutExecutionResumeChainLength: 2,
        },
      },
    },
    {
      name: "smoke:dom:operational",
      result: {
        localReasonerLifecycleExpected: true,
        localReasonerLifecycleMeaning: "dom evidence still passes",
        localReasonerLifecycleGateState: {
          runMode: "configure_probe_profile",
          configuredStatus: "configured",
          catalogProviderCount: 1,
          probeStatus: "reachable",
          selectedProvider: "local_command",
          prewarmStatus: "ready",
          observedProfileCount: 1,
          observedRestoreCandidateCount: 1,
        },
        conversationMemoryExpected: true,
        conversationMemoryMeaning: "dom evidence still passes",
        conversationMemoryGateState: {
          runMode: "retrieve_existing_memory",
          observedMinuteCount: 1,
          transcriptEntryCount: 3,
          transcriptBlockCount: 1,
          runtimeSearchHits: 1,
        },
        sandboxAuditEvidenceExpected: true,
        sandboxAuditMeaning: "dom evidence still passes",
        sandboxAuditGateState: {
          runMode: "audit_trail_expected",
          observedAuditCount: 2,
          sandboxSearchHits: 1,
          sandboxListEntries: 1,
        },
        executionHistoryExpected: true,
        executionHistoryMeaning: "dom evidence still passes",
        executionHistoryGateState: {
          runMode: "persist_history",
          verificationStatus: "passed",
          observedVerificationHistoryCount: 1,
          runnerStatus: "completed",
          observedRunnerHistoryCount: 1,
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("ui_local_reasoner_lifecycle_semantics"));
  assert(gate.failedChecks.includes("ui_auto_recovery_resume_semantics"));
  assert(gate.failedChecks.includes("ui_retry_without_execution_resume_semantics"));
});

test("runtime-evidence semantics fails when an operational step is present but its result is missing", () => {
  const gate = summarizeRuntimeEvidenceSemantics([
    {
      name: "smoke:ui:operational",
      result: null,
    },
    {
      name: "smoke:dom:operational",
      result: {
        localReasonerLifecycleExpected: true,
        localReasonerLifecycleMeaning: "dom evidence still passes",
        localReasonerLifecycleGateState: {
          runMode: "configure_probe_profile",
          configuredStatus: "configured",
          catalogProviderCount: 1,
          probeStatus: "reachable",
          selectedProvider: "local_command",
          prewarmStatus: "ready",
          observedProfileCount: 1,
          observedRestoreCandidateCount: 1,
        },
        conversationMemoryExpected: true,
        conversationMemoryMeaning: "dom evidence still passes",
        conversationMemoryGateState: {
          runMode: "retrieve_existing_memory",
          observedMinuteCount: 1,
          transcriptEntryCount: 3,
          transcriptBlockCount: 1,
          runtimeSearchHits: 1,
        },
        sandboxAuditEvidenceExpected: true,
        sandboxAuditMeaning: "dom evidence still passes",
        sandboxAuditGateState: {
          runMode: "audit_trail_expected",
          observedAuditCount: 2,
          sandboxSearchHits: 1,
          sandboxListEntries: 1,
        },
        executionHistoryExpected: true,
        executionHistoryMeaning: "dom evidence still passes",
        executionHistoryGateState: {
          runMode: "persist_history",
          verificationStatus: "passed",
          observedVerificationHistoryCount: 1,
          runnerStatus: "completed",
          observedRunnerHistoryCount: 1,
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("ui_local_reasoner_lifecycle_semantics"));
  assert(gate.failedChecks.includes("ui_auto_recovery_resume_semantics"));
  assert(gate.failedChecks.includes("ui_retry_without_execution_resume_semantics"));
});

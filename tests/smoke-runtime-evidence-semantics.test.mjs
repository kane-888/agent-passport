import assert from "node:assert/strict";
import test from "node:test";

import {
  formatRuntimeEvidenceSemanticsSummary,
  summarizeRuntimeEvidenceSemantics,
} from "../scripts/smoke-all.mjs";

test("runtime-evidence semantics accepts explicit local reasoner, conversation, sandbox, and history evidence", () => {
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
      },
    },
    {
      name: "smoke:dom:operational",
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
          runMode: "retrieve_existing_memory",
          observedMinuteCount: 1,
          transcriptEntryCount: 3,
          transcriptBlockCount: 1,
          runtimeSearchHits: 1,
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
          observedRunnerHistoryCount: 1,
        },
      },
    },
  ]);

  assert.equal(gate.status, "passed");
  assert.equal(gate.passedChecks, 8);
  assert.deepEqual(gate.failedChecks, []);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UILocalReasoner=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UIConversation=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UISandbox=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /UIExecutionHistory=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /DOMLocalReasoner=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /DOMConversation=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /DOMSandbox=pass/);
  assert.match(formatRuntimeEvidenceSemanticsSummary(gate), /DOMExecutionHistory=pass/);
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

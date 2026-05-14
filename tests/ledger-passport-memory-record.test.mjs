import assert from "node:assert/strict";
import test from "node:test";

import {
  derivePassportMemoryPatternKey,
  derivePassportMemorySeparationKey,
  normalizePassportMemoryRecord,
} from "../src/ledger-passport-memory-record.js";

test("passport memory record keys preserve explicit and inferred pattern/separation semantics", () => {
  assert.equal(derivePassportMemoryPatternKey("working", { patternKey: "explicit-pattern" }), "explicit-pattern");
  assert.equal(derivePassportMemoryPatternKey("semantic", { payload: { field: "match.decision" } }), "field:match.decision");
  assert.equal(derivePassportMemoryPatternKey("semantic", { boundaryLabel: "Main Boundary" }), "boundary:mainboundary");
  assert.equal(derivePassportMemoryPatternKey("profile", { payload: { currentGoal: "Stay Local First" } }), "goal:staylocalfirst");
  assert.equal(derivePassportMemoryPatternKey("working", { tags: ["Kane"] }), "tag:kane");
  assert.equal(derivePassportMemoryPatternKey("working", { kind: "checkpoint_summary" }), "kind:checkpointsummary");
  assert.equal(derivePassportMemoryPatternKey("working", {}), "working:generic");

  assert.equal(derivePassportMemorySeparationKey("semantic", { separationKey: "explicit-sep" }), "explicit-sep");
  assert.equal(derivePassportMemorySeparationKey("semantic", { payload: { field: "match.action" } }), "semantic:field:match.action");
  assert.equal(derivePassportMemorySeparationKey("semantic", { boundaryLabel: "Runtime Truth" }), "semantic:boundary:runtimetruth");
  assert.equal(
    derivePassportMemorySeparationKey("working", { sourceWindowId: "Window 1", kind: "tool_result" }),
    "working:window:window1:toolresult"
  );
  assert.equal(derivePassportMemorySeparationKey("working", { kind: "note" }), "working:kind:note");
});

test("passport memory record normalization preserves shape, defaults, clamps, and timestamps", () => {
  const record = normalizePassportMemoryRecord("agent-1", {
    passportMemoryId: "pmem-1",
    layer: "semantic",
    kind: "checkpoint_summary",
    summary: "A summary",
    content: "A content",
    payload: {
      field: "match.decision_provenance",
      value: { status: "approved", outcome: "ship" },
    },
    tags: [" alpha ", "beta"],
    sourceType: "verified",
    salience: 2,
    confidence: -1,
    boundaryLabel: "Boundary A",
    sourceWindowId: "window-1",
    sourceMessageId: "message-1",
    conflictKey: "preference:theme",
    conflictState: { state: "resolved" },
    recordedByAgentId: "agent-writer",
    recordedByWindowId: "window-writer",
    status: "stabilizing",
    recordedAt: "2026-01-02T03:04:05.000Z",
    memoryDynamics: {
      decayRate: 0.5,
      recallCount: -3,
      recallSuccessCount: 2.9,
      strengthScore: "bad",
      promotionCount: 1.8,
      reconsolidationWindowHours: 9,
      reconsolidationEvidenceIds: ["e1", " e2 "],
      homeostaticScale: 1.234,
      eligibilityTraceUntil: "2030-01-01T00:00:00.000Z",
    },
  });

  assert.equal(record.passportMemoryId, "pmem-1");
  assert.equal(record.agentId, "agent-1");
  assert.equal(record.layer, "semantic");
  assert.equal(record.kind, "checkpoint_summary");
  assert.deepEqual(record.tags, ["alpha", "beta"]);
  assert.equal(record.salience, 1);
  assert.equal(record.confidence, 0);
  assert.equal(record.sourceType, "verified");
  assert.equal(record.epistemicStatus, "confirmed");
  assert.equal(record.consolidationState, "consolidated");
  assert.equal(record.boundaryLabel, "Boundary A");
  assert.equal(record.patternKey, "field:match.decision_provenance");
  assert.equal(record.separationKey, "semantic:field:match.decision_provenance");
  assert.equal(record.sourceWindowId, "window-1");
  assert.equal(record.recordedByAgentId, "agent-writer");
  assert.equal(record.recordedByWindowId, "window-writer");
  assert.equal(record.status, "stabilizing");
  assert.equal(record.recordedAt, "2026-01-02T03:04:05.000Z");

  assert.equal(record.memoryDynamics.decayRate, 0.35);
  assert.equal(record.memoryDynamics.recallCount, 0);
  assert.equal(record.memoryDynamics.recallSuccessCount, 2);
  assert.equal(record.memoryDynamics.strengthScore, 0.6);
  assert.equal(record.memoryDynamics.promotionCount, 1);
  assert.equal(record.memoryDynamics.reconsolidationWindowHours, 9);
  assert.deepEqual(record.memoryDynamics.reconsolidationEvidenceIds, ["e1", "e2"]);
  assert.equal(record.memoryDynamics.eligibilityTraceUntil, "2030-01-01T00:00:00.000Z");
  assert.equal(record.memoryDynamics.homeostaticScale, 1.23);

  record.payload.value.outcome = "mutated";
  record.conflictState.state = "mutated";
  const nextRecord = normalizePassportMemoryRecord("agent-1", {
    passportMemoryId: "pmem-2",
    payload: { value: { outcome: "fresh" } },
    conflictState: { state: "fresh" },
  });
  assert.equal(nextRecord.payload.value.outcome, "fresh");
  assert.equal(nextRecord.conflictState.state, "fresh");
});

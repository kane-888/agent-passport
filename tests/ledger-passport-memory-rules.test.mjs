import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPassportEligibilityTrace,
  defaultPassportMemoryConfidence,
  defaultPassportMemorySalience,
  extractPassportMemoryComparableValue,
  inferPassportMemoryConsolidationState,
  inferPassportMemorySourceType,
  inferPassportReconsolidationWindowHours,
  isPassportMemoryActive,
  isPassportMemoryDestabilized,
  normalizeDecisionLogStatus,
  normalizeEvidenceRefKind,
  normalizePassportMemoryLayer,
  normalizePassportMemorySourceType,
  normalizePassportMemoryUnitScore,
  normalizePassportNeuromodulation,
  normalizePassportSourceFeatures,
  normalizeTaskSnapshotStatus,
} from "../src/ledger-passport-memory-rules.js";

test("passport memory rules preserve status, layer, source, and score normalization defaults", () => {
  assert.equal(normalizeTaskSnapshotStatus("BLOCKED"), "blocked");
  assert.equal(normalizeTaskSnapshotStatus("unknown"), "active");
  assert.equal(normalizeDecisionLogStatus("Superseded"), "superseded");
  assert.equal(normalizeDecisionLogStatus("missing"), "active");
  assert.equal(normalizeEvidenceRefKind("Credential"), "credential");
  assert.equal(normalizeEvidenceRefKind("other"), "document");
  assert.equal(normalizePassportMemoryLayer("PROFILE"), "profile");
  assert.equal(normalizePassportMemoryLayer("other"), "working");
  assert.equal(normalizePassportMemorySourceType("VERIFIED"), "verified");
  assert.equal(normalizePassportMemorySourceType("other"), null);
  assert.equal(normalizePassportMemoryUnitScore(1.4, 0.5), 1);
  assert.equal(normalizePassportMemoryUnitScore(-0.4, 0.5), 0);
  assert.equal(normalizePassportMemoryUnitScore("nope", 0.5), 0.5);
});

test("passport memory rules preserve source inference, monitoring features, and memory dynamics", () => {
  assert.equal(inferPassportMemorySourceType("working", { kind: "sensory_snapshot" }), "perceived");
  assert.equal(inferPassportMemorySourceType("semantic", {}), "derived");
  assert.equal(inferPassportMemoryConsolidationState("working", {}), "hot");
  assert.equal(inferPassportMemoryConsolidationState("episodic", {}), "stabilizing");
  assert.equal(inferPassportMemoryConsolidationState("profile", {}), "consolidated");

  assert.deepEqual(normalizePassportNeuromodulation({ neuromodulation: { novelty: 2, reward: -1 } }), {
    novelty: 1,
    reward: 0,
    threat: 0.12,
    social: 0.3,
  });

  assert.deepEqual(
    normalizePassportSourceFeatures({
      layer: "semantic",
      payload: { kind: "checkpoint_summary" },
      sourceType: "derived",
    }),
    {
      modality: "compressed_summary",
      generationMode: "internal_inference",
      perceptualDetailScore: 0.08,
      contextualDetailScore: 0.46,
      cognitiveOperationScore: 0.82,
      socialCorroborationScore: 0.2,
      externalAnchorCount: 1,
      realityMonitoringScore: 0.09,
      internalGenerationRisk: 0.81,
    }
  );

  assert.deepEqual(
    buildPassportEligibilityTrace({
      layer: "working",
      payload: { memoryDynamics: { eligibilityTraceUntil: "2030-01-01T00:00:00.000Z" } },
      salience: 1,
      confidence: 1,
      neuromodulation: { novelty: 1, reward: 1, social: 1 },
    }),
    {
      eligibilityTraceScore: 1,
      eligibilityTraceUntil: "2030-01-01T00:00:00.000Z",
      eligibilityWindowHours: 6,
    }
  );
  assert.equal(inferPassportReconsolidationWindowHours({ layer: "ledger" }), 0);
  assert.equal(inferPassportReconsolidationWindowHours({ layer: "profile" }), 48);
  assert.equal(defaultPassportMemorySalience("ledger", {}), 0.9);
  assert.equal(defaultPassportMemoryConfidence("profile", { sourceType: "reported" }), 0.82);
});

test("passport memory rules preserve active, destabilized, and comparable value semantics", () => {
  assert.equal(isPassportMemoryActive({ status: "active" }), true);
  assert.equal(isPassportMemoryActive({ status: "superseded" }), false);
  assert.equal(isPassportMemoryActive({ status: "active", memoryDynamics: { abstractedMemoryId: "memory-2" } }), false);

  assert.equal(
    isPassportMemoryDestabilized(
      {
        status: "active",
        memoryDynamics: { destabilizedUntil: "2030-01-01T00:00:00.000Z" },
      },
      "2029-01-01T00:00:00.000Z"
    ),
    true
  );
  assert.equal(
    isPassportMemoryDestabilized(
      {
        status: "reverted",
        memoryDynamics: { destabilizedUntil: "2030-01-01T00:00:00.000Z" },
      },
      "2029-01-01T00:00:00.000Z"
    ),
    false
  );
  assert.equal(extractPassportMemoryComparableValue({ payload: { value: ["Alpha", " Beta "] } }), "Alpha|Beta");
});

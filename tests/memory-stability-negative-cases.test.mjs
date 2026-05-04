import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildMemoryStabilityCorrectionExecutionEvent,
  memoryStabilitySnapshotSha256,
  validateMemoryStabilityCorrectionEvent,
} from "../src/memory-stability/adapter-contract.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture(relativePath) {
  return readJson(path.join(rootDir, relativePath));
}

function productEvidence() {
  return {
    product_provenance: {
      target_repo_path: "agent-passport dry-run target",
      target_repo_commit: "local-thread-no-git",
      adapter_version: "product-adapter-rehearsal-v1",
      adapter_entrypoint: "src/memory-stability/product-adapter.js",
      runtime_contract_version: "memory-stability-correction-event/v1",
      feature_flag: "MEMORY_STABILITY_PRODUCT_ADAPTER_DRY_RUN",
      environment: "local-dry-run",
    },
    preflight: {
      loader_verified: true,
      profile_schema_verified: true,
      snapshot_redacted: true,
      model_call_blocked: true,
      network_blocked: true,
      raw_log_sinks_disabled: true,
      rollback_available: true,
    },
    placement_receipt: {
      placement_strategy_hash: "a".repeat(64),
      pre_layout_hash: "b".repeat(64),
      post_layout_hash: "c".repeat(64),
      anchor_position_delta: 3,
      injected_estimated_tokens: 512,
      max_budget_respected: true,
    },
    post_execution_runtime: {
      post_execution_snapshot_sha256: "d".repeat(64),
      post_runtime_computed_at: "2026-04-23T00:00:02.000Z",
      computed_by_engine_version: "memory-stability-engine-local-v1",
      final_c_t: 0.18,
      final_s_t: 0.82,
    },
    idempotency_replay: {
      idempotency_replay_count: 1,
      dedupe_hit: true,
      side_effect_count: 0,
      second_run_status: "deduped",
    },
    privacy_rollback: {
      privacy_sink_scan_report: "No raw payload fields detected in product adapter rehearsal event.",
      rollback_drill_report: "Rollback drill restored pre execution layout hashes.",
      raw_payload_scan_passed: true,
      rollback_verified: true,
    },
  };
}

test("memory stability correction event negative cases reject unsafe execution receipts", () => {
  const mediumSnapshot = fixture("tests/fixtures/memory-stability/redacted/medium-risk-runtime-snapshot.redacted.json");
  const strongSnapshot = fixture("tests/fixtures/memory-stability/redacted/strong-risk-runtime-snapshot.redacted.json");
  const mediumEvent = fixture("tests/fixtures/memory-stability/correction-events/medium-correction-execution-event.json");
  const strongEvent = fixture("tests/fixtures/memory-stability/correction-events/strong-correction-execution-event.json");

  const cases = [
    {
      name: "reject_model_called_true",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.model_called = true;
        return event;
      },
      expected: /model_called must be false/u,
    },
    {
      name: "reject_explicit_execution_false",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.explicit_execution = false;
        return event;
      },
      expected: /explicit_execution must be true/u,
    },
    {
      name: "reject_automatic_by_loader_true",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.automatic_by_loader = true;
        return event;
      },
      expected: /automatic_by_loader must be false/u,
    },
    {
      name: "reject_loader_auto_executed_true",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.loader_auto_executed = true;
        return event;
      },
      expected: /loader_auto_executed must be false/u,
    },
    {
      name: "reject_empty_hash_refs_for_reanchor",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.actions[0].target_memory_refs = [];
        return event;
      },
      expected: /target_memory_refs must not be empty/u,
    },
    {
      name: "reject_extra_raw_field_in_memory_ref",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.actions[0].target_memory_refs[0].content = "raw memory text must never be persisted here";
        return event;
      },
      expected: /raw content field: content/u,
    },
    {
      name: "reject_audit_raw_content_persisted_true",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.audit.raw_content_persisted = true;
        return event;
      },
      expected: /raw_content_persisted must be false/u,
    },
    {
      name: "reject_action_raw_content_persisted_true",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.actions[0].raw_content_persisted = true;
        return event;
      },
      expected: /raw_content_persisted must be false/u,
    },
    {
      name: "reject_completed_execution_with_failed_action",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.actions[1].status = "failed";
        return event;
      },
      expected: /execution.status must match action receipt statuses exactly/u,
    },
    {
      name: "reject_missing_planned_action_receipt",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.actions.pop();
        event.execution.status = "partial";
        return event;
      },
      expected: /must execute every source snapshot correction_plan.action exactly once/u,
    },
    {
      name: "reject_duplicate_action_receipt",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.actions[1] = clone(event.execution.actions[0]);
        return event;
      },
      expected: /must not contain duplicate action receipts|must exactly match source snapshot correction_plan.actions/u,
    },
    {
      name: "reject_extra_raw_prompt_field",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.extra_raw_prompt = "raw prompt text must not be persisted in audit events";
        return event;
      },
      expected: /raw content field: extra_raw_prompt/u,
    },
    {
      name: "reject_result_full_prompt_field",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.actions[2].result.full_prompt = "full prompt text must not be persisted in action result";
        return event;
      },
      expected: /raw content field: full_prompt/u,
    },
    {
      name: "reject_result_summary_chat_transcript",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.actions[2].result.summary = "User: raw memory text copied into the event summary.";
        return event;
      },
      expected: /chat transcript role marker/u,
    },
    {
      name: "reject_audit_notes_email_like_text",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.audit.notes = "Adapter copied contact kane@example.com into notes.";
        return event;
      },
      expected: /email-like text/u,
    },
    {
      name: "reject_source_snapshot_digest_mismatch",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.source_snapshot.source_snapshot_sha256 = "0".repeat(64);
        return event;
      },
      expected: /source_snapshot_sha256 mismatch/u,
    },
    {
      name: "reject_event_id_not_bound_to_adapter_invocation",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.event_id = "correction-event-spoofed";
        return event;
      },
      expected: /event_id mismatch/u,
    },
    {
      name: "reject_idempotency_key_not_bound_to_adapter_invocation",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.audit.idempotency_key = "unbound:spoofed";
        return event;
      },
      expected: /idempotency_key mismatch/u,
    },
    {
      name: "reject_source_snapshot_path_not_redacted",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.source_snapshot.path = "tests/fixtures/memory-stability/raw/medium-risk-runtime-snapshot.json";
        return event;
      },
      expected: /source_snapshot.path must point to redacted fixtures/u,
    },
    {
      name: "reject_source_snapshot_object_not_redacted",
      snapshot: (() => {
        const snapshot = clone(mediumSnapshot);
        snapshot.privacy.mode = "raw";
        return snapshot;
      })(),
      event: (snapshot) => {
        const event = clone(mediumEvent);
        event.source_snapshot.source_snapshot_sha256 = memoryStabilitySnapshotSha256(snapshot);
        return event;
      },
      expected: /source snapshot must be redacted/u,
    },
    {
      name: "reject_execution_action_not_allowed_for_level",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.actions.push(clone(strongEvent.execution.actions[4]));
        return event;
      },
      expected: /action is not allowed for medium/u,
    },
    {
      name: "reject_memory_ref_not_in_source_snapshot",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.actions[0].target_memory_refs[0].memory_id = "spoofed-memory-anchor";
        return event;
      },
      expected: /memory_id must exist in source snapshot/u,
    },
    {
      name: "reject_memory_ref_hash_not_in_source_snapshot",
      snapshot: mediumSnapshot,
      event: () => {
        const event = clone(mediumEvent);
        event.execution.actions[0].target_memory_refs[0].content_sha256 = "1".repeat(64);
        return event;
      },
      expected: /content_sha256 must match source snapshot/u,
    },
    {
      name: "reject_authoritative_mutation_claim_without_completed_reload",
      snapshot: strongSnapshot,
      event: () => {
        const event = clone(strongEvent);
        const action = event.execution.actions.find((candidate) => candidate.action === "reload_authoritative_memory_store");
        action.status = "skipped";
        event.execution.status = "partial";
        event.execution.authoritative_store_mutated = true;
        return event;
      },
      expected: /authoritative_store_mutated must match completed reload_authoritative_memory_store/u,
    },
  ];

  for (const testCase of cases) {
    assert.throws(
      () => validateMemoryStabilityCorrectionEvent(testCase.event(testCase.snapshot), testCase.name, testCase.snapshot),
      testCase.expected,
      `${testCase.name} should fail closed`
    );
  }
});

test("memory stability correction event builder rejects non-fixture shortcuts and invalid product adapter evidence", () => {
  const mediumSnapshot = fixture("tests/fixtures/memory-stability/redacted/medium-risk-runtime-snapshot.redacted.json");
  const sourceSnapshotPath = "tests/fixtures/memory-stability/redacted/medium-risk-runtime-snapshot.redacted.json";
  const mediumEvent = fixture("tests/fixtures/memory-stability/correction-events/medium-correction-execution-event.json");

  assert.throws(
    () =>
      buildMemoryStabilityCorrectionExecutionEvent({
        snapshot: mediumSnapshot,
        sourceSnapshotPath,
        adapterInvocationId: "product-without-receipts",
        actorType: "product_adapter",
        actorId: "product-runtime",
      }),
    /executedActions receipt array is required/u
  );

  assert.throws(
    () =>
      buildMemoryStabilityCorrectionExecutionEvent({
        snapshot: mediumSnapshot,
        sourceSnapshotPath,
        adapterInvocationId: "invalid-actor-type",
        actorType: "loader",
      }),
    /actorType must be one of/u
  );

  const evidence = productEvidence();
  evidence.preflight.model_call_blocked = false;
  assert.throws(
    () =>
      buildMemoryStabilityCorrectionExecutionEvent({
        snapshot: mediumSnapshot,
        sourceSnapshotPath,
        adapterInvocationId: "product-model-not-blocked",
        actorType: "product_adapter",
        actorId: "product-runtime",
        executedActions: clone(mediumEvent.execution.actions),
        productAdapterEvidence: evidence,
      }),
    /preflight.model_call_blocked must be true/u
  );

  const replayEvidence = productEvidence();
  replayEvidence.idempotency_replay.side_effect_count = 1;
  assert.throws(
    () =>
      buildMemoryStabilityCorrectionExecutionEvent({
        snapshot: mediumSnapshot,
        sourceSnapshotPath,
        adapterInvocationId: "product-replay-side-effect",
        actorType: "product_adapter",
        actorId: "product-runtime",
        executedActions: clone(mediumEvent.execution.actions),
        productAdapterEvidence: replayEvidence,
      }),
    /side_effect_count must be 0/u
  );

  const privacyEvidence = productEvidence();
  privacyEvidence.privacy_rollback.raw_payload_scan_passed = false;
  assert.throws(
    () =>
      buildMemoryStabilityCorrectionExecutionEvent({
        snapshot: mediumSnapshot,
        sourceSnapshotPath,
        adapterInvocationId: "product-privacy-failed",
        actorType: "product_adapter",
        actorId: "product-runtime",
        executedActions: clone(mediumEvent.execution.actions),
        productAdapterEvidence: privacyEvidence,
      }),
    /raw_payload_scan_passed must be true/u
  );

  const budgetEvidence = productEvidence();
  budgetEvidence.placement_receipt.injected_estimated_tokens =
    mediumSnapshot.placement_strategy.max_injected_estimated_tokens + 1;
  assert.throws(
    () =>
      buildMemoryStabilityCorrectionExecutionEvent({
        snapshot: mediumSnapshot,
        sourceSnapshotPath,
        adapterInvocationId: "product-budget-exceeded",
        actorType: "product_adapter",
        actorId: "product-runtime",
        executedActions: clone(mediumEvent.execution.actions),
        productAdapterEvidence: budgetEvidence,
      }),
    /injected_estimated_tokens must respect source snapshot placement budget/u
  );
});

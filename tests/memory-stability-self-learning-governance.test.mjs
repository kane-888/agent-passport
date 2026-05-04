import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MemoryStabilitySelfLearningGovernanceError,
  SELF_LEARNING_PROPOSAL_ENVELOPE_SCHEMA_VERSION,
  contextBuilderCanInjectLearningRecord,
  evaluateLearningProposalEnvelope,
  loadVerifiedSelfLearningGovernanceContract,
  validateLearningProposalEnvelope,
  validateLearningProposalSchemaFile,
  validateSelfLearningApplyDryRun,
  validateSelfLearningDryRunSchemaFile,
  validateSelfLearningRecoveryReport,
  validateSelfLearningRecoveryReportSchemaFile,
  validateSelfLearningRevertDryRun,
} from "../src/memory-stability/self-learning-governance.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function proposal(overrides = {}) {
  const base = {
    proposalId: "lp-memory-preference-001",
    agentId: "agent-alpha",
    namespaceScopeId: "namespace-alpha",
    type: "memory",
    sourceSessionId: "session-001",
    sourceRunId: "run-001",
    sourceWindowId: "window-001",
    evidenceIds: ["evidence-001"],
    candidate: {
      targetLayer: "semantic",
      summary: "User prefers short progress updates and explicit next step notes.",
      contentSha256: hashA,
      evidenceKind: "session",
      requestedOperation: "propose_memory",
      targetRecordIds: ["memory-pref-001"],
      protectedTarget: false,
      conflictRecordIds: [],
    },
    rationale: "Repeated explicit preference should be considered for future context building.",
    sourceType: "reported",
    epistemicStatus: "candidate",
    confidence: 0.88,
    salience: 0.76,
    riskLevel: "low",
    admission: {
      duplicateOf: null,
      conflicts: [],
      scanResult: {
        privacyPassed: true,
        namespacePassed: true,
        protectedMemoryHit: false,
        externalRecallOnly: false,
      },
      decision: "draft",
    },
    status: "draft",
    reviewer: {
      actorId: "admission-controller",
      mode: "auto",
      reviewedAt: "2026-04-23T00:00:00.000Z",
    },
    appliedRecordIds: [],
    rollbackPlan: {
      strategy: "mark_inactive",
      targetRecordIds: ["memory-pref-001"],
      checkpointId: "checkpoint-learning-001",
    },
    createdAt: "2026-04-23T00:00:00.000Z",
  };
  const merged = {
    ...base,
    ...overrides,
    candidate: {
      ...base.candidate,
      ...(overrides.candidate || {}),
    },
    admission: {
      ...base.admission,
      ...(overrides.admission || {}),
      scanResult: {
        ...base.admission.scanResult,
        ...(overrides.admission?.scanResult || {}),
      },
    },
    rollbackPlan: {
      ...base.rollbackPlan,
      ...(overrides.rollbackPlan || {}),
    },
  };
  return {
    schema_version: SELF_LEARNING_PROPOSAL_ENVELOPE_SCHEMA_VERSION,
    learningProposal: merged,
  };
}

function evidenceRefsFor(envelope, overrides = {}) {
  return envelope.learningProposal.evidenceIds.map((evidenceId) => ({
    evidenceId,
    agentId: envelope.learningProposal.agentId,
    namespaceScopeId: envelope.learningProposal.namespaceScopeId,
    ...overrides,
  }));
}

test("self-learning governance loads schemas, redacted proposal, and dry-run fixtures fail-closed", async () => {
  const contract = await loadVerifiedSelfLearningGovernanceContract();

  assert.equal(contract.ok, true);
  assert.equal(contract.failClosed, true);
  assert.equal(
    contract.contract.proposalSchemaPath,
    "contracts/memory-stability/schemas/self-learning-governance-learning-proposal.schema.json"
  );
  assert.equal(
    contract.contract.dryRunSchemaPath,
    "contracts/memory-stability/schemas/self-learning-governance-dry-run.schema.json"
  );
  assert.equal(
    contract.contract.recoveryReportSchemaPath,
    "contracts/memory-stability/schemas/self-learning-governance-recovery-report.schema.json"
  );
  assert.deepEqual(contract.verifierReports.dryRuns.modes, ["apply", "revert"]);
  assert.equal(contract.verifierReports.recoveryReport.mode, "recovery_rehearsal");
  assert.equal(contract.verifierReports.recoveryReport.matchedOperationState, "recovery_required");
  assert.deepEqual(contract.contract.boundary, {
    adapterApiCalled: false,
    ledgerEventCreated: false,
    engineCanonicalWritePerformed: false,
    modelCalled: false,
    networkCalled: false,
    rawContentPersisted: false,
    checkpointRestoreAvailable: true,
  });
});

test("self-learning governance schema files keep single-proposal and dry-run-only boundaries", () => {
  validateLearningProposalSchemaFile(
    readJson(path.join(rootDir, "contracts", "memory-stability", "schemas", "self-learning-governance-learning-proposal.schema.json"))
  );
  validateSelfLearningDryRunSchemaFile(
    readJson(path.join(rootDir, "contracts", "memory-stability", "schemas", "self-learning-governance-dry-run.schema.json"))
  );
  validateSelfLearningRecoveryReportSchemaFile(
    readJson(path.join(rootDir, "contracts", "memory-stability", "schemas", "self-learning-governance-recovery-report.schema.json"))
  );
});

test("self-learning proposal admission distinguishes auto memory from profile and skill review lanes", () => {
  const memory = proposal();
  const validMemory = evaluateLearningProposalEnvelope(memory, { evidenceRefs: evidenceRefsFor(memory) });
  assert.equal(validMemory.decision, "approved_auto");
  assert.equal(validMemory.contextInjectionAllowed, true);

  const profile = proposal({
    proposalId: "lp-profile-001",
    type: "profile",
    candidate: {
      targetLayer: "profile",
      contentSha256: hashB,
      requestedOperation: "propose_profile_patch",
    },
    confidence: 0.9,
    salience: 0.8,
  });
  const profileReview = evaluateLearningProposalEnvelope(profile, { evidenceRefs: evidenceRefsFor(profile) });
  assert.equal(profileReview.decision, "pending_review");
  assert.equal(profileReview.contextInjectionAllowed, false);

  const skill = proposal({
    proposalId: "lp-skill-001",
    type: "skill",
    candidate: {
      targetLayer: "skill",
      contentSha256: hashC,
      requestedOperation: "propose_skill_version",
    },
  });
  const skillReview = evaluateLearningProposalEnvelope(skill, { evidenceRefs: evidenceRefsFor(skill) });
  assert.equal(skillReview.decision, "pending_review");
});

test("self-learning governance accepts compatibility agent and namespace aliases while normalizing primary fields", () => {
  const legacyEnvelope = proposal();
  legacyEnvelope.learningProposal.canonicalAgentId = legacyEnvelope.learningProposal.agentId;
  delete legacyEnvelope.learningProposal.agentId;
  legacyEnvelope.learningProposal.passportNamespaceId = legacyEnvelope.learningProposal.namespaceScopeId;
  delete legacyEnvelope.learningProposal.namespaceScopeId;
  const normalizedProposal = validateLearningProposalEnvelope(legacyEnvelope);
  assert.equal(normalizedProposal.agentId, "agent-alpha");
  assert.equal(normalizedProposal.namespaceScopeId, "namespace-alpha");

  const dualEnvelope = proposal();
  dualEnvelope.learningProposal.canonicalAgentId = dualEnvelope.learningProposal.agentId;
  dualEnvelope.learningProposal.passportNamespaceId = dualEnvelope.learningProposal.namespaceScopeId;
  const dualProposal = validateLearningProposalEnvelope(dualEnvelope);
  assert.equal(dualProposal.agentId, "agent-alpha");
  assert.equal(dualProposal.namespaceScopeId, "namespace-alpha");

  const mismatchedEnvelope = proposal();
  mismatchedEnvelope.learningProposal.canonicalAgentId = "agent-beta";
  assert.throws(() => validateLearningProposalEnvelope(mismatchedEnvelope), /canonicalAgentId/u);

  const mismatchedNamespaceEnvelope = proposal();
  mismatchedNamespaceEnvelope.learningProposal.passportNamespaceId = "namespace-beta";
  assert.throws(() => validateLearningProposalEnvelope(mismatchedNamespaceEnvelope), /passportNamespaceId/u);
});

test("self-learning proposal red-team cases reject unsafe learning attempts", () => {
  const cases = [
    {
      name: "reject_direct_canonical_write",
      mutate: (envelope) => {
        envelope.learningProposal.candidate.requestedOperation = "direct_canonical_write";
      },
      expected: "direct canonical writes",
    },
    {
      name: "reject_missing_evidence",
      mutate: (envelope) => {
        envelope.learningProposal.evidenceIds = [];
      },
      expected: "evidenceIds must not be empty",
    },
    {
      name: "reject_external_recall_verified",
      mutate: (envelope) => {
        envelope.learningProposal.candidate.evidenceKind = "external_recall";
        envelope.learningProposal.epistemicStatus = "verified";
      },
      expected: "external recall",
    },
    {
      name: "reject_profile_auto_apply",
      mutate: (envelope) => {
        envelope.learningProposal.type = "profile";
        envelope.learningProposal.status = "approved";
        envelope.learningProposal.candidate.targetLayer = "profile";
        envelope.learningProposal.candidate.requestedOperation = "propose_profile_patch";
      },
      expected: "pure auto approval",
    },
    {
      name: "reject_high_risk_auto_apply",
      mutate: (envelope) => {
        envelope.learningProposal.riskLevel = "high";
        envelope.learningProposal.status = "approved";
      },
      expected: "high or critical",
    },
    {
      name: "reject_missing_checkpoint_before_apply",
      mutate: (envelope) => {
        envelope.learningProposal.status = "applied";
        envelope.learningProposal.rollbackPlan.checkpointId = null;
      },
      expected: "checkpointId",
    },
    {
      name: "reject_raw_prompt_field",
      mutate: (envelope) => {
        envelope.learningProposal.candidate.raw_prompt = "system: raw prompt";
      },
      expected: "raw payload",
    },
    {
      name: "reject_secret_like_summary",
      mutate: (envelope) => {
        envelope.learningProposal.candidate.summary = "Captured api key should never be stored.";
      },
      expected: "sensitive strings",
    },
    {
      name: "reject_unresolved_evidence_ref",
      mutate: (envelope) => {
        envelope.learningProposal.evidenceIds = ["evidence-missing"];
      },
      context: { evidenceRefs: [] },
      expected: "resolve every evidenceId",
    },
    {
      name: "reject_memory_profile_lane_mismatch",
      mutate: (envelope) => {
        envelope.learningProposal.candidate.targetLayer = "profile";
      },
      expected: "governance lane",
    },
    {
      name: "reject_scan_privacy_failed",
      mutate: (envelope) => {
        envelope.learningProposal.admission.scanResult.privacyPassed = false;
      },
      expected: "privacyPassed",
    },
    {
      name: "reject_draft_with_advanced_admission_decision",
      mutate: (envelope) => {
        envelope.learningProposal.admission.decision = "approved_auto";
      },
      expected: "draft proposals",
    },
    {
      name: "reject_applied_without_applied_records",
      mutate: (envelope) => {
        envelope.learningProposal.status = "applied";
      },
      expected: "applied proposals must bind appliedRecordIds",
    },
    {
      name: "reject_rejected_with_approved_auto_decision",
      mutate: (envelope) => {
        envelope.learningProposal.status = "rejected";
        envelope.learningProposal.admission.decision = "approved_auto";
      },
      expected: "rejected proposals",
    },
  ];

  for (const testCase of cases) {
    const envelope = proposal();
    testCase.mutate(envelope);
    let result;
    let errorMessage = "";
    try {
      result = evaluateLearningProposalEnvelope(envelope, testCase.context || { evidenceRefs: evidenceRefsFor(envelope) });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    assert.equal(
      (result?.decision === "rejected" && JSON.stringify(result).includes(testCase.expected)) || errorMessage.includes(testCase.expected),
      true,
      `${testCase.name} should reject with ${testCase.expected}`
    );
  }
});

test("self-learning governance quarantines protected or conflicting memory and rejects duplicates", () => {
  const protectedEnvelope = proposal({ candidate: { protectedTarget: true } });
  const protectedResult = evaluateLearningProposalEnvelope(protectedEnvelope, {
    evidenceRefs: evidenceRefsFor(protectedEnvelope),
    protectedRecordIds: ["memory-pref-001"],
  });
  assert.equal(protectedResult.decision, "quarantined");
  assert.match(JSON.stringify(protectedResult), /protected memory/u);

  const conflictEnvelope = proposal({ candidate: { conflictRecordIds: ["memory-conflict-001"] } });
  const conflictResult = evaluateLearningProposalEnvelope(conflictEnvelope, { evidenceRefs: evidenceRefsFor(conflictEnvelope) });
  assert.equal(conflictResult.decision, "quarantined");

  const duplicateEnvelope = proposal();
  const duplicateResult = evaluateLearningProposalEnvelope(duplicateEnvelope, {
    evidenceRefs: evidenceRefsFor(duplicateEnvelope),
    activeRecords: [
      {
        recordId: "memory-existing-001",
        agentId: "agent-alpha",
        namespaceScopeId: "namespace-alpha",
        status: "active",
        contentSha256: hashA,
      },
    ],
  });
  assert.equal(duplicateResult.decision, "rejected");
  assert.equal(duplicateResult.duplicateOf, "memory-existing-001");
});

test("self-learning dry-runs validate apply/revert previews without performing writes", () => {
  const envelope = readJson(
    path.join(rootDir, "tests", "fixtures", "memory-stability", "self-learning", "redacted", "memory-learning-proposal.redacted.json")
  );
  const proposalRecord = validateLearningProposalEnvelope(envelope);
  const applyDryRun = readJson(
    path.join(rootDir, "tests", "fixtures", "memory-stability", "self-learning", "dry-runs", "memory-learning-proposal-apply-dry-run.json")
  );
  const revertDryRun = readJson(
    path.join(rootDir, "tests", "fixtures", "memory-stability", "self-learning", "dry-runs", "memory-learning-proposal-revert-dry-run.json")
  );

  validateSelfLearningApplyDryRun(applyDryRun, proposalRecord);
  validateSelfLearningRevertDryRun(revertDryRun, proposalRecord);
  const recoveryReport = readJson(
    path.join(rootDir, "tests", "fixtures", "memory-stability", "self-learning", "recovery", "memory-learning-proposal-recovery-required-report.json")
  );
  validateSelfLearningRecoveryReport(recoveryReport, proposalRecord);
  assert.equal(applyDryRun.adapterApiCalled, false);
  assert.equal(applyDryRun.ledgerEventCreated, false);
  assert.equal(applyDryRun.engineCanonicalWritePerformed, false);
  assert.equal(revertDryRun.authoritativeStoreMutated, false);
  assert.equal(revertDryRun.rawContentPersisted, false);
  assert.equal(recoveryReport.bridgeExecutionRequired, true);
  assert.equal(recoveryReport.adapterApiCalled, false);
  assert.equal(recoveryReport.recoveryPlan.checkpointRestoreAvailable, true);
  assert.equal(recoveryReport.recoveryPlan.bridgeRepairRequired, true);
});

test("self-learning dry-run red-team cases reject fake execution and context pollution", () => {
  const envelope = readJson(
    path.join(rootDir, "tests", "fixtures", "memory-stability", "self-learning", "redacted", "memory-learning-proposal.redacted.json")
  );
  const proposalRecord = validateLearningProposalEnvelope(envelope);
  const applyDryRun = readJson(
    path.join(rootDir, "tests", "fixtures", "memory-stability", "self-learning", "dry-runs", "memory-learning-proposal-apply-dry-run.json")
  );
  const revertDryRun = readJson(
    path.join(rootDir, "tests", "fixtures", "memory-stability", "self-learning", "dry-runs", "memory-learning-proposal-revert-dry-run.json")
  );
  const recoveryReport = readJson(
    path.join(rootDir, "tests", "fixtures", "memory-stability", "self-learning", "recovery", "memory-learning-proposal-recovery-required-report.json")
  );

  for (const [label, buildBad, expected] of [
    [
      "engine_writes_canonical_state",
      () => {
        const bad = clone(applyDryRun);
        bad.engineCanonicalWritePerformed = true;
        return () => validateSelfLearningApplyDryRun(bad, proposalRecord);
      },
      /engineCanonicalWritePerformed/u,
    ],
    [
      "legacy_agent_passport_api_called_alias",
      () => {
        const bad = clone(applyDryRun);
        bad.agentPassportApiCalled = true;
        return () => validateSelfLearningApplyDryRun(bad, proposalRecord);
      },
      /agentPassportApiCalled must mirror adapterApiCalled/u,
    ],
    [
      "bridge_adapter_api_called_alias",
      () => {
        const bad = clone(applyDryRun);
        bad.bridgeAdapterApiCalled = true;
        return () => validateSelfLearningApplyDryRun(bad, proposalRecord);
      },
      /bridgeAdapterApiCalled must mirror adapterApiCalled/u,
    ],
    [
      "model_called",
      () => {
        const bad = clone(applyDryRun);
        bad.modelCalled = true;
        return () => validateSelfLearningApplyDryRun(bad, proposalRecord);
      },
      /modelCalled/u,
    ],
    [
      "namespace_mismatch",
      () => {
        const bad = clone(applyDryRun);
        bad.passportNamespaceId = "namespace-beta";
        return () => validateSelfLearningApplyDryRun(bad, proposalRecord);
      },
      /namespace/u,
    ],
    [
      "without_created_record_preview",
      () => {
        const bad = clone(applyDryRun);
        bad.plannedAdapterRequest.wouldCreateRecords = [];
        return () => validateSelfLearningApplyDryRun(bad, proposalRecord);
      },
      /created records/u,
    ],
    [
      "revert_without_context_deny",
      () => {
        const bad = clone(revertDryRun);
        bad.contextEffects.denyRecordIds = [];
        return () => validateSelfLearningRevertDryRun(bad, proposalRecord);
      },
      /deny reverted record/u,
    ],
    [
      "revert_injects_reverted_record",
      () => {
        const bad = clone(revertDryRun);
        bad.contextEffects.injectRecordIds = ["memory-pref-001"];
        return () => validateSelfLearningRevertDryRun(bad, proposalRecord);
      },
      /must not inject/u,
    ],
    [
      "payload_field",
      () => {
        const bad = clone(applyDryRun);
        bad.plannedAdapterRequest.wouldCreateRecords[0].rawPrompt = "payload";
        return () => validateSelfLearningApplyDryRun(bad, proposalRecord);
      },
      /raw payload/u,
    ],
    [
      "apply_checkpoint_scope_misses_session",
      () => {
        const bad = clone(applyDryRun);
        bad.checkpoint.scope = ["memory"];
        return () => validateSelfLearningApplyDryRun(bad, proposalRecord);
      },
      /checkpoint\.scope must cover memory\/session/u,
    ],
    [
      "apply_idempotency_misses_target_record",
      () => {
        const bad = clone(applyDryRun);
        bad.idempotency.idempotencyKey = "idem-lp-memory-preference-001-checkpoint-learning-001";
        return () => validateSelfLearningApplyDryRun(bad, proposalRecord);
      },
      /idempotencyKey must bind target record memory-pref-001/u,
    ],
    [
      "recovery_missing_context_deny",
      () => {
        const bad = clone(recoveryReport);
        bad.detectedState.contextDenyRecordIds = [];
        return () => validateSelfLearningRecoveryReport(bad, proposalRecord);
      },
      /contextDenyRecordIds/u,
    ],
    [
      "recovery_incomplete_scan_states",
      () => {
        const bad = clone(recoveryReport);
        bad.scannedOperationStates = ["recovery_required"];
        return () => validateSelfLearningRecoveryReport(bad, proposalRecord);
      },
      /scannedOperationStates mismatch/u,
    ],
    [
      "recovery_legacy_agent_passport_api_called_alias",
      () => {
        const bad = clone(recoveryReport);
        bad.agentPassportApiCalled = true;
        return () => validateSelfLearningRecoveryReport(bad, proposalRecord);
      },
      /agentPassportApiCalled must mirror adapterApiCalled/u,
    ],
    [
      "recovery_bridge_execution_required_alias_mismatch",
      () => {
        const bad = clone(recoveryReport);
        bad.adapterExecutionRequired = false;
        return () => validateSelfLearningRecoveryReport(bad, proposalRecord);
      },
      /adapterExecutionRequired must mirror bridgeExecutionRequired/u,
    ],
    [
      "recovery_scope_misses_session",
      () => {
        const bad = clone(recoveryReport);
        bad.recoveryPlan.recoveryScope = ["memory"];
        return () => validateSelfLearningRecoveryReport(bad, proposalRecord);
      },
      /recoveryPlan\.recoveryScope must cover memory\/session/u,
    ],
    [
      "recovery_missing_ledger_receipt_flag",
      () => {
        const bad = clone(recoveryReport);
        bad.detectedState.missingLedgerReceipt = false;
        return () => validateSelfLearningRecoveryReport(bad, proposalRecord);
      },
      /missingLedgerReceipt must be true/u,
    ],
    [
      "recovery_raw_payload_field",
      () => {
        const bad = clone(recoveryReport);
        bad.rawPrompt = "payload";
        return () => validateSelfLearningRecoveryReport(bad, proposalRecord);
      },
      /raw payload/u,
    ],
  ]) {
    assert.throws(buildBad(), expected, `${label} should fail closed`);
  }
});

test("self-learning context builder denies reverted, quarantined, cross-namespace, and external candidate records", () => {
  assert.equal(
    contextBuilderCanInjectLearningRecord(
      {
        recordId: "memory-pref-001",
        agentId: "agent-alpha",
        namespaceScopeId: "namespace-alpha",
        status: "active",
        epistemicStatus: "verified",
        sourceType: "reported",
      },
      { agentId: "agent-alpha", namespaceScopeId: "namespace-alpha" }
    ),
    true
  );
  assert.equal(
    contextBuilderCanInjectLearningRecord(
      {
        recordId: "memory-pref-001",
        agentId: "agent-alpha",
        namespaceScopeId: "namespace-alpha",
        status: "reverted",
        revertedAt: "2026-04-23T00:00:01.000Z",
      },
      { agentId: "agent-alpha", namespaceScopeId: "namespace-alpha" }
    ),
    false
  );
  assert.equal(
    contextBuilderCanInjectLearningRecord(
      {
        recordId: "memory-pref-001",
        agentId: "agent-alpha",
        namespaceScopeId: "namespace-alpha",
        status: "quarantined",
        quarantinedAt: "2026-04-23T00:00:01.000Z",
      },
      { agentId: "agent-alpha", namespaceScopeId: "namespace-alpha" }
    ),
    false
  );
  assert.equal(
    contextBuilderCanInjectLearningRecord(
      {
        recordId: "memory-pref-001",
        agentId: "agent-beta",
        namespaceScopeId: "namespace-alpha",
        status: "active",
        epistemicStatus: "verified",
        sourceType: "reported",
      },
      { agentId: "agent-alpha", namespaceScopeId: "namespace-alpha" }
    ),
    false
  );
  assert.equal(
    contextBuilderCanInjectLearningRecord(
      {
        recordId: "memory-pref-001",
        agentId: "agent-alpha",
        namespaceScopeId: "namespace-alpha",
        status: "active",
        epistemicStatus: "candidate",
        sourceType: "external_recall",
      },
      { agentId: "agent-alpha", namespaceScopeId: "namespace-alpha" }
    ),
    false
  );
});

test("self-learning governance stays passive and does not materialize product stores", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-self-learning-governance-"));
  const previous = {
    AGENT_PASSPORT_LEDGER_PATH: process.env.AGENT_PASSPORT_LEDGER_PATH,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH,
    AGENT_PASSPORT_STORE_KEY_PATH: process.env.AGENT_PASSPORT_STORE_KEY_PATH,
  };
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");

  try {
    process.env.AGENT_PASSPORT_LEDGER_PATH = ledgerPath;
    process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = readSessionStorePath;
    process.env.AGENT_PASSPORT_STORE_KEY_PATH = storeKeyPath;

    const contract = await loadVerifiedSelfLearningGovernanceContract();
    assert.equal(contract.ok, true);
    assert.equal(fs.existsSync(ledgerPath), false);
    assert.equal(fs.existsSync(readSessionStorePath), false);
    assert.equal(fs.existsSync(storeKeyPath), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("self-learning governance verifier rejects invalid fixtures fail-closed", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-self-learning-invalid-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "contracts"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "tests", "fixtures"), { recursive: true });
    fs.cpSync(path.join(rootDir, "contracts", "memory-stability"), path.join(tmpRoot, "contracts", "memory-stability"), {
      recursive: true,
    });
    fs.cpSync(path.join(rootDir, "tests", "fixtures", "memory-stability"), path.join(tmpRoot, "tests", "fixtures", "memory-stability"), {
      recursive: true,
    });
    const fixturePath = path.join(
      tmpRoot,
      "tests",
      "fixtures",
      "memory-stability",
      "self-learning",
      "dry-runs",
      "memory-learning-proposal-apply-dry-run.json"
    );
    const fixture = readJson(fixturePath);
    fixture.ledgerEventCreated = true;
    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), "utf8");

    await assert.rejects(
      () => loadVerifiedSelfLearningGovernanceContract({ rootDir: tmpRoot }),
      (error) =>
        error instanceof MemoryStabilitySelfLearningGovernanceError &&
        error.stage === "self_learning_governance_validation" &&
        /ledgerEventCreated/u.test(error.detail)
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

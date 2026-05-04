import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(
  rootDir,
  "tests",
  "fixtures",
  "memory-stability",
  "self-learning",
  "redacted",
  "memory-learning-proposal.redacted.json"
);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-self-learning-bridge-"));
const ledgerPath = path.join(tempDir, "ledger.json");
const storeKeyPath = path.join(tempDir, ".ledger-key");
const previousEnv = {
  AGENT_PASSPORT_LEDGER_PATH: process.env.AGENT_PASSPORT_LEDGER_PATH,
  AGENT_PASSPORT_STORE_KEY_PATH: process.env.AGENT_PASSPORT_STORE_KEY_PATH,
  AGENT_PASSPORT_USE_KEYCHAIN: process.env.AGENT_PASSPORT_USE_KEYCHAIN,
};

process.env.AGENT_PASSPORT_LEDGER_PATH = ledgerPath;
process.env.AGENT_PASSPORT_STORE_KEY_PATH = storeKeyPath;
process.env.AGENT_PASSPORT_USE_KEYCHAIN = "0";

const bridge = await import(pathToFileURL(path.join(rootDir, "src", "memory-stability", "self-learning-bridge.js")).href);
const ledger = await import(pathToFileURL(path.join(rootDir, "src", "ledger.js")).href);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

function buildProposalEnvelope(
  label,
  {
    proposalPatch = {},
    candidatePatch = {},
    rollbackPatch = {},
  } = {}
) {
  const envelope = clone(readFixture());
  const proposal = envelope.learningProposal;
  proposal.proposalId = `lp-${label}`;
  proposal.agentId = `agent-${label}`;
  proposal.namespaceScopeId = `namespace-${label}`;
  proposal.sourceSessionId = `session-${label}`;
  proposal.sourceRunId = `run-${label}`;
  proposal.sourceWindowId = `window-${label}`;
  proposal.evidenceIds = [`evidence-${label}`];
  proposal.candidate.targetRecordIds = [`memory-${label}`];
  proposal.rollbackPlan.targetRecordIds = [`memory-${label}`];
  proposal.rollbackPlan.checkpointId = `checkpoint-${label}`;
  Object.assign(proposal, proposalPatch);
  Object.assign(proposal.candidate, candidatePatch);
  Object.assign(proposal.rollbackPlan, rollbackPatch);
  return envelope;
}

async function prepareProposalEnvelope(label, options = {}) {
  const envelope = buildProposalEnvelope(label, options);
  const agent = await ledger.registerAgent({
    displayName: `Bridge ${label}`,
  });
  envelope.learningProposal.agentId = agent.agentId;
  return envelope;
}

function evidenceRefsFor(envelope) {
  return envelope.learningProposal.evidenceIds.map((evidenceId) => ({
    evidenceId,
    agentId: envelope.learningProposal.agentId,
    namespaceScopeId: envelope.learningProposal.namespaceScopeId,
  }));
}

after(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await rm(tempDir, { recursive: true, force: true });
});

test("self-learning bridge preview stays fail-closed and does not mutate the ledger", async () => {
  const envelope = await prepareProposalEnvelope("preview-001");

  const result = await bridge.executeSelfLearningBridge({
    proposalEnvelope: envelope,
    operation: bridge.MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply,
    execute: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.failClosed, true);
  assert.equal(result.previewOnly, true);
  assert.equal(result.dryRun.mode, "apply");
  const listed = await ledger.listPassportMemories(envelope.learningProposal.agentId, {
    includeInactive: true,
  });
  assert.equal(listed.memories.length, 0);
});

test("self-learning bridge apply writes exactly one memory record for a low-risk memory proposal", async () => {
  const envelope = await prepareProposalEnvelope("apply-001");
  const targetRecordId = envelope.learningProposal.candidate.targetRecordIds[0];

  const result = await bridge.executeSelfLearningBridge({
    proposalEnvelope: envelope,
    operation: bridge.MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply,
    execute: true,
    actorId: "bridge-test-agent",
    createdAt: "2026-05-02T03:00:00.000Z",
    admissionContext: {
      evidenceRefs: evidenceRefsFor(envelope),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.completed, true);
  assert.equal(result.bridge.dedupeHit, false);
  assert.deepEqual(result.records.writtenRecordIds, [targetRecordId]);
  assert.deepEqual(result.context.injectableRecordIds, [targetRecordId]);

  const listed = await ledger.listPassportMemories(envelope.learningProposal.agentId, {
    includeInactive: true,
  });
  assert.equal(listed.memories.length, 1);
  assert.equal(listed.memories[0].passportMemoryId, targetRecordId);
  assert.equal(listed.memories[0].status, "active");
  assert.equal(listed.memories[0].payload?.proposalId, envelope.learningProposal.proposalId);
});

test("self-learning bridge apply dedupes a second execution idempotently", async () => {
  const envelope = await prepareProposalEnvelope("dedupe-001");

  await bridge.executeSelfLearningBridge({
    proposalEnvelope: envelope,
    operation: bridge.MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply,
    execute: true,
    actorId: "bridge-test-agent",
    createdAt: "2026-05-02T03:10:00.000Z",
    admissionContext: {
      evidenceRefs: evidenceRefsFor(envelope),
    },
  });

  const second = await bridge.executeSelfLearningBridge({
    proposalEnvelope: envelope,
    operation: bridge.MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply,
    execute: true,
    actorId: "bridge-test-agent",
    createdAt: "2026-05-02T03:11:00.000Z",
    admissionContext: {
      evidenceRefs: evidenceRefsFor(envelope),
    },
  });

  assert.equal(second.ok, true);
  assert.equal(second.completed, true);
  assert.equal(second.bridge.dedupeHit, true);
  assert.deepEqual(second.records.writtenRecordIds, envelope.learningProposal.candidate.targetRecordIds);

  const listed = await ledger.listPassportMemories(envelope.learningProposal.agentId, {
    includeInactive: true,
  });
  assert.equal(listed.memories.length, 1);
});

test("self-learning bridge serializes concurrent apply requests and keeps exactly one authoritative write", async () => {
  const envelope = await prepareProposalEnvelope("concurrent-001");
  const executions = await Promise.all([
    bridge.executeSelfLearningBridge({
      proposalEnvelope: envelope,
      operation: bridge.MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply,
      execute: true,
      actorId: "bridge-test-agent-a",
      createdAt: "2026-05-02T03:15:00.000Z",
      admissionContext: {
        evidenceRefs: evidenceRefsFor(envelope),
      },
    }),
    bridge.executeSelfLearningBridge({
      proposalEnvelope: envelope,
      operation: bridge.MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply,
      execute: true,
      actorId: "bridge-test-agent-b",
      createdAt: "2026-05-02T03:15:01.000Z",
      admissionContext: {
        evidenceRefs: evidenceRefsFor(envelope),
      },
    }),
  ]);

  assert.equal(executions.every((result) => result.ok === true && result.completed === true), true);
  assert.equal(executions.filter((result) => result.bridge?.dedupeHit === true).length, 1);

  const listed = await ledger.listPassportMemories(envelope.learningProposal.agentId, {
    includeInactive: true,
  });
  assert.equal(listed.memories.length, 1);
  assert.equal(listed.memories[0].passportMemoryId, envelope.learningProposal.candidate.targetRecordIds[0]);
});

test("self-learning bridge revert marks the target memory reverted and denies future context injection", async () => {
  const envelope = await prepareProposalEnvelope("revert-001");
  const targetRecordId = envelope.learningProposal.candidate.targetRecordIds[0];

  await bridge.executeSelfLearningBridge({
    proposalEnvelope: envelope,
    operation: bridge.MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply,
    execute: true,
    actorId: "bridge-test-agent",
    createdAt: "2026-05-02T03:20:00.000Z",
    admissionContext: {
      evidenceRefs: evidenceRefsFor(envelope),
    },
  });

  const reverted = await bridge.executeSelfLearningBridge({
    proposalEnvelope: envelope,
    operation: bridge.MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.revert,
    execute: true,
    actorId: "bridge-test-agent",
    createdAt: "2026-05-02T03:21:00.000Z",
  });

  assert.equal(reverted.ok, true);
  assert.equal(reverted.completed, true);
  assert.deepEqual(reverted.records.revertedRecordIds, [targetRecordId]);
  assert.deepEqual(reverted.records.deniedRecordIds, [targetRecordId]);
  assert.deepEqual(reverted.context.injectableRecordIds, []);

  const listed = await ledger.listPassportMemories(envelope.learningProposal.agentId, {
    includeInactive: true,
  });
  assert.equal(listed.memories.length, 1);
  assert.equal(listed.memories[0].status, "reverted");
  assert.equal(listed.memories[0].revertedAt, "2026-05-02T03:21:00.000Z");
});

test("self-learning bridge rejects profile, skill, and policy proposals fail-closed", async () => {
  const lanes = [
    {
      label: "profile-001",
      type: "profile",
      targetLayer: "profile",
      requestedOperation: "propose_profile_patch",
    },
    {
      label: "skill-001",
      type: "skill",
      targetLayer: "skill",
      requestedOperation: "propose_skill_version",
    },
    {
      label: "policy-001",
      type: "policy",
      targetLayer: "policy",
      requestedOperation: "propose_policy_change",
    },
  ];

  for (const lane of lanes) {
    const envelope = await prepareProposalEnvelope(lane.label, {
      proposalPatch: {
        type: lane.type,
      },
      candidatePatch: {
        targetLayer: lane.targetLayer,
        requestedOperation: lane.requestedOperation,
      },
    });
    await assert.rejects(
      bridge.executeSelfLearningBridge({
        proposalEnvelope: envelope,
        operation: bridge.MEMORY_STABILITY_SELF_LEARNING_BRIDGE_OPERATIONS.apply,
        execute: false,
      }),
      /supports memory proposals only/u
    );
  }
});

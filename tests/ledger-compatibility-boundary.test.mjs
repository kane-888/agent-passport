import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ISSUE_BOTH_METHODS_REPAIR_ONLY_ERROR } from "../src/protocol.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let importCounter = 0;

function uniqueImportSuffix(label) {
  importCounter += 1;
  return `${label}-${process.pid}-${Date.now()}-${importCounter}`;
}

function withEnv(overrides, operation) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = overrides[key];
  }
  return Promise.resolve()
    .then(operation)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value == null) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

async function withIsolatedLedger(label, operation) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-passport-${label}-`));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");
  const archiveDir = path.join(tmpDir, "archives");

  try {
    return await withEnv(
      {
        AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
        AGENT_PASSPORT_ARCHIVE_DIR: archiveDir,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix(label)}`);
        return operation(ledger);
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function createProposal(ledger, agentId, title) {
  return ledger.createAuthorizationProposal({
    policyAgentId: agentId,
    actionType: "grant_asset",
    title,
    payload: {
      fromAgentId: agentId,
      targetAgentId: agentId,
      amount: 1,
      assetType: "credits",
      reason: title,
    },
    delaySeconds: 0,
    expiresInSeconds: 600,
  });
}

test("direct ledger credential and evidence exports reject compatibility dual-issuance outside repair flows", async () => {
  await withIsolatedLedger("ledger-compat-boundary", async (ledger) => {
    const primary = await ledger.registerAgent({
      displayName: "Compatibility Boundary Primary",
      role: "tester",
      controller: "ledger-compatibility-boundary-test",
    });
    const secondary = await ledger.registerAgent({
      displayName: "Compatibility Boundary Secondary",
      role: "tester",
      controller: "ledger-compatibility-boundary-test",
    });
    const proposal = await createProposal(ledger, primary.agentId, "compatibility-boundary-proposal");

    await assert.rejects(
      ledger.getAgentCredential(primary.agentId, {
        didMethod: "agentpassport",
        issueBothMethods: true,
        persist: false,
      }),
      { message: ISSUE_BOTH_METHODS_REPAIR_ONLY_ERROR }
    );

    await assert.rejects(
      ledger.getAuthorizationProposalCredential(proposal.proposalId, {
        didMethod: "agentpassport",
        issueBothMethods: true,
        persist: false,
      }),
      { message: ISSUE_BOTH_METHODS_REPAIR_ONLY_ERROR }
    );

    await assert.rejects(
      ledger.getAgentComparisonEvidence({
        leftAgentId: primary.agentId,
        rightAgentId: secondary.agentId,
        issuerAgentId: primary.agentId,
        issuerDidMethod: "agentpassport",
        issueBothMethods: true,
        persist: false,
      }),
      { message: ISSUE_BOTH_METHODS_REPAIR_ONLY_ERROR }
    );
  });
});

test("canonical and legacy main-agent filters resolve onto the same fresh-bootstrap credential and proposal records", async () => {
  await withIsolatedLedger("ledger-main-agent-filter-compat", async (ledger) => {
    await ledger.loadStore();
    const proposal = await createProposal(ledger, "agent_main", "main-agent-filter-compat-proposal");

    const evidence = await ledger.getAgentComparisonEvidence({
      leftAgentId: "agent_main",
      rightAgentId: "agent_treasury",
      issuerAgentId: "agent_main",
      issuerDidMethod: "agentpassport",
      persist: true,
    });
    assert.equal(Boolean(evidence?.evidence?.credentialRecord?.credentialRecordId), true);

    const canonicalCredentials = await ledger.listCredentials({
      agentId: "agent_main",
      limit: 20,
    });
    const legacyCredentials = await ledger.listCredentials({
      agentId: "agent_openneed_agents",
      limit: 20,
    });
    const legacyIssuerCredentials = await ledger.listCredentials({
      issuerAgentId: "agent_openneed_agents",
      limit: 20,
    });

    assert.equal(canonicalCredentials.credentials.length > 0, true);
    assert.deepEqual(
      legacyCredentials.credentials.map((entry) => entry.credentialRecordId),
      canonicalCredentials.credentials.map((entry) => entry.credentialRecordId)
    );
    assert.deepEqual(
      legacyIssuerCredentials.credentials.map((entry) => entry.credentialRecordId),
      canonicalCredentials.credentials.map((entry) => entry.credentialRecordId)
    );

    const canonicalProposals = await ledger.listAuthorizationProposalsByAgent("agent_main", 20);
    const legacyProposals = await ledger.listAuthorizationProposalsByAgent("agent_openneed_agents", 20);

    assert.equal(
      canonicalProposals.some((entry) => entry.proposalId === proposal.proposalId),
      true
    );
    assert.equal(
      legacyProposals.some((entry) => entry.proposalId === proposal.proposalId),
      true
    );
  });
});

test("new comparison evidence emits canonical agent-passport URNs even under compatibility DID views", async () => {
  await withIsolatedLedger("ledger-compat-comparison-urn", async (ledger) => {
    const primary = await ledger.registerAgent({
      displayName: "Comparison URN Primary",
      role: "tester",
      controller: "ledger-compatibility-boundary-test",
    });
    const secondary = await ledger.registerAgent({
      displayName: "Comparison URN Secondary",
      role: "tester",
      controller: "ledger-compatibility-boundary-test",
    });

    const canonicalEvidence = await ledger.getAgentComparisonEvidence({
      leftAgentId: primary.agentId,
      rightAgentId: secondary.agentId,
      issuerAgentId: primary.agentId,
      issuerDidMethod: "agentpassport",
      persist: false,
    });
    const compatibilityEvidence = await ledger.getAgentComparisonEvidence({
      leftAgentId: primary.agentId,
      rightAgentId: secondary.agentId,
      issuerAgentId: primary.agentId,
      issuerDidMethod: "openneed",
      persist: false,
    });

    assert.match(canonicalEvidence.evidence?.credential?.credentialSubject?.id || "", /^urn:agentpassport:agent-comparison:/u);
    assert.match(canonicalEvidence.evidence?.credential?.credentialStatus?.id || "", /^urn:agentpassport:agent-comparison:/u);
    assert.match(
      compatibilityEvidence.evidence?.credential?.credentialSubject?.id || "",
      /^urn:agentpassport:agent-comparison:/u
    );
    assert.match(
      compatibilityEvidence.evidence?.credential?.credentialStatus?.id || "",
      /^urn:agentpassport:agent-comparison:/u
    );
  });
});

test("ledger resident configure and setup status canonicalize compatibility resident input without widening reference truth", async () => {
  await withIsolatedLedger("ledger-resident-binding-canonical", async (ledger) => {
    await ledger.loadStore();
    const configured = await ledger.configureDeviceRuntime({
      residentAgentId: "agent_openneed_agents",
      residentDidMethod: "agentpassport",
      residentLocked: false,
      localMode: "local_only",
      allowOnlineReasoner: false,
      localReasonerEnabled: true,
      localReasonerProvider: "local_mock",
    });
    const runtimeState = await ledger.getDeviceRuntimeState();
    const setupStatus = await ledger.getDeviceSetupStatus();
    const setupRun = await ledger.runDeviceSetup({
      residentAgentId: "agent_openneed_agents",
      residentDidMethod: "agentpassport",
      dryRun: true,
    });
    const compatibilityIdentity = await ledger.resolveAgentIdentity({ agentId: "agent_openneed_agents" });

    assert.equal(compatibilityIdentity.agentId, "agent_main");
    assert.equal(configured.deviceRuntime?.residentAgentReference, "agent_main");
    assert.equal(configured.deviceRuntime?.residentAgentId, compatibilityIdentity.agentId);
    assert.equal(configured.deviceRuntime?.resolvedResidentAgentId, compatibilityIdentity.agentId);
    assert.equal(runtimeState.deviceRuntime?.residentAgentReference, "agent_main");
    assert.equal(runtimeState.deviceRuntime?.residentAgentId, compatibilityIdentity.agentId);
    assert.equal(runtimeState.deviceRuntime?.resolvedResidentAgentId, compatibilityIdentity.agentId);
    assert.equal(setupStatus.residentAgentReference, "agent_main");
    assert.equal(setupStatus.residentAgentId, compatibilityIdentity.agentId);
    assert.equal(setupStatus.resolvedResidentAgentId, compatibilityIdentity.agentId);
    assert.equal(setupRun.setup?.residentAgentReference, "agent_main");
    assert.equal(setupRun.setup?.residentAgentId, compatibilityIdentity.agentId);
    assert.equal(setupRun.setup?.resolvedResidentAgentId, compatibilityIdentity.agentId);
  });
});

test("ledger evidence refs keep missing raw resolved resident ids explicit instead of promoting agent truth", async () => {
  await withIsolatedLedger("ledger-evidence-resident-raw", async (ledger) => {
    await ledger.loadStore();
    const evidenceRef = await ledger.recordEvidenceRef("agent_openneed_agents", {
      kind: "note",
      title: "resident binding raw preservation",
      residentAgentReference: "agent_main",
    });
    const canonicalList = await ledger.listEvidenceRefs("agent_main", { limit: 10 });
    const compatibilityList = await ledger.listEvidenceRefs("agent_openneed_agents", { limit: 10 });

    assert.equal(evidenceRef.agentId, "agent_main");
    assert.equal(evidenceRef.residentAgentReference, "agent_main");
    assert.equal(evidenceRef.resolvedResidentAgentId, null);
    assert.equal(canonicalList.evidenceRefs.length, 1);
    assert.equal(compatibilityList.evidenceRefs.length, 1);
    assert.equal(canonicalList.evidenceRefs[0]?.evidenceRefId, evidenceRef.evidenceRefId);
    assert.equal(compatibilityList.evidenceRefs[0]?.evidenceRefId, evidenceRef.evidenceRefId);
    assert.equal(canonicalList.evidenceRefs[0]?.resolvedResidentAgentId, null);
    assert.equal(compatibilityList.evidenceRefs[0]?.resolvedResidentAgentId, null);
  });
});

test("comparison repair defaults to canonical DID methods unless compatibility is explicitly requested", async () => {
  await withIsolatedLedger("repair-default-canonical", async (ledger) => {
    const primary = await ledger.registerAgent({
      displayName: "Default Repair Primary",
      role: "tester",
      controller: "ledger-compatibility-boundary-test",
    });
    const secondary = await ledger.registerAgent({
      displayName: "Default Repair Secondary",
      role: "tester",
      controller: "ledger-compatibility-boundary-test",
    });

    const repair = await ledger.repairAgentComparisonMigration({
      leftAgentId: primary.agentId,
      rightAgentId: secondary.agentId,
      issuerAgentId: primary.agentId,
      dryRun: true,
    });

    assert.deepEqual(repair.requestedDidMethods, ["agentpassport"]);
    assert.equal(repair.plan.every((entry) => entry.didMethod === "agentpassport"), true);
  });
});

test("comparison repair still allows explicit compatibility backfill and dual receipts", async () => {
  await withIsolatedLedger("repair-explicit-compat", async (ledger) => {
    const primary = await ledger.registerAgent({
      displayName: "Explicit Repair Primary",
      role: "tester",
      controller: "ledger-compatibility-boundary-test",
    });
    const secondary = await ledger.registerAgent({
      displayName: "Explicit Repair Secondary",
      role: "tester",
      controller: "ledger-compatibility-boundary-test",
    });

    const repair = await ledger.repairAgentComparisonMigration({
      leftAgentId: primary.agentId,
      rightAgentId: secondary.agentId,
      issuerAgentId: primary.agentId,
      didMethods: ["agentpassport", "openneed"],
      issueBothMethods: true,
    });

    assert.deepEqual(repair.requestedDidMethods, ["agentpassport", "openneed"]);
    assert.equal(repair.beforeCoverage != null, true);
    assert.equal(repair.afterCoverage != null, true);
    assert.equal(Array.isArray(repair.afterCoverage?.publicMissingDidMethods), true);
    assert.equal(Array.isArray(repair.afterCoverage?.repairMissingDidMethods), true);
    assert.deepEqual(
      [...new Set(repair.repaired.map((entry) => entry.didMethod).filter(Boolean))].sort(),
      ["agentpassport", "openneed"]
    );
    assert.equal(repair.repairReceipt?.didMethod, "agentpassport");
    assert.deepEqual((repair.repairReceipt?.issuedDidMethods || []).slice().sort(), ["agentpassport", "openneed"]);
  });
});

test("migration repair compat views stay explicit instead of widening back to canonical public truth", async () => {
  await withIsolatedLedger("repair-compat-view", async (ledger) => {
    const primary = await ledger.registerAgent({
      displayName: "Compat View Primary",
      role: "tester",
      controller: "ledger-compatibility-boundary-test",
    });
    const secondary = await ledger.registerAgent({
      displayName: "Compat View Secondary",
      role: "tester",
      controller: "ledger-compatibility-boundary-test",
    });

    const repair = await ledger.repairAgentComparisonMigration({
      leftAgentId: primary.agentId,
      rightAgentId: secondary.agentId,
      issuerAgentId: primary.agentId,
      didMethods: ["agentpassport", "openneed"],
      issueBothMethods: true,
    });

    const compatRepair = await ledger.getMigrationRepair(repair.repairId, {
      didMethod: "openneed",
    });
    assert.deepEqual(compatRepair.issuedDidMethods, ["openneed"]);
    assert.deepEqual(compatRepair.allIssuedDidMethods.slice().sort(), ["agentpassport", "openneed"]);
    assert.deepEqual(compatRepair.publicIssuedDidMethods, ["agentpassport"]);
    assert.deepEqual(compatRepair.compatibilityIssuedDidMethods, ["openneed"]);
    assert.equal(compatRepair.receipts.length, 1);
    assert.equal(compatRepair.allReceiptCount, 2);
    assert.equal(compatRepair.receipts.every((entry) => entry.issuerDidMethod === "openneed"), true);
    assert.equal(compatRepair.latestReceipt?.issuerDidMethod, "openneed");
    assert.equal(compatRepair.repair?.issuerDid, compatRepair.repair?.compatibilityIssuerDid);
    assert.match(compatRepair.repair?.issuerDid || "", /^did:openneed:/u);
    assert.deepEqual((compatRepair.repair?.requestedDidMethods || []).slice().sort(), ["agentpassport", "openneed"]);
    assert.deepEqual((compatRepair.repair?.allIssuedDidMethods || []).slice().sort(), ["agentpassport", "openneed"]);
    assert.deepEqual(compatRepair.repair?.publicIssuedDidMethods, ["agentpassport"]);
    assert.deepEqual(compatRepair.repair?.compatibilityIssuedDidMethods, ["openneed"]);
    assert.equal(compatRepair.repair?.allReceiptCount, 2);
    assert.equal(compatRepair.repair?.beforeCoverage != null, true);
    assert.equal(compatRepair.repair?.afterCoverage != null, true);
    assert.equal(Array.isArray(compatRepair.repair?.afterCoverage?.publicMissingDidMethods), true);
    assert.equal(Array.isArray(compatRepair.repair?.afterCoverage?.repairMissingDidMethods), true);

    const compatCredentials = await ledger.getMigrationRepairCredentials(repair.repairId, {
      didMethod: "openneed",
    });
    assert.deepEqual(compatCredentials.repair.issuedDidMethods, ["openneed"]);
    assert.deepEqual((compatCredentials.repair.allIssuedDidMethods || []).slice().sort(), ["agentpassport", "openneed"]);
    assert.deepEqual(compatCredentials.repair.publicIssuedDidMethods, ["agentpassport"]);
    assert.deepEqual(compatCredentials.repair.compatibilityIssuedDidMethods, ["openneed"]);
    assert.deepEqual(Object.keys(compatCredentials.counts.byDidMethod).sort(), ["openneed"]);
    assert.equal(compatCredentials.credentials.length > 0, true);
    assert.equal(compatCredentials.credentials.every((entry) => entry.issuerDidMethod === "openneed"), true);
    assert.equal(
      compatCredentials.credentials.every((entry) =>
        Array.isArray(entry.repairHistory) &&
        entry.repairHistory.every((history) =>
          (history.issuedDidMethods || []).every((method) => method === "openneed") &&
          JSON.stringify((history.allIssuedDidMethods || []).slice().sort()) === JSON.stringify(["agentpassport", "openneed"]) &&
          JSON.stringify(history.publicIssuedDidMethods || []) === JSON.stringify(["agentpassport"]) &&
          JSON.stringify(history.compatibilityIssuedDidMethods || []) === JSON.stringify(["openneed"])
        )
      ),
      true
    );
    assert.equal(
      compatCredentials.credentials.every((entry) => entry.repairedBy?.allReceiptCount === 2),
      true
    );
    assert.equal(
      compatCredentials.credentials.every((entry) => entry.repairedBy?.issuerDid === entry.repairedBy?.compatibilityIssuerDid),
      true
    );

    const compatTimeline = await ledger.getMigrationRepairTimeline(repair.repairId, {
      didMethod: "openneed",
    });
    const compatTimelineEntry = compatTimeline.timeline.find((entry) => entry.kind === "migration_repair_recorded");
    assert.equal(compatTimelineEntry?.actorDid, compatTimeline.compatibilityIssuerDid);
    assert.match(compatTimelineEntry?.actorDid || "", /^did:openneed:/u);

    const canonicalRepair = await ledger.getMigrationRepair(repair.repairId, {
      didMethod: "agentpassport",
    });
    assert.deepEqual(canonicalRepair.issuedDidMethods, ["agentpassport"]);
    assert.deepEqual(canonicalRepair.allIssuedDidMethods.slice().sort(), ["agentpassport", "openneed"]);
    assert.equal(canonicalRepair.receipts.length, 1);
    assert.equal(canonicalRepair.receipts.every((entry) => entry.issuerDidMethod === "agentpassport"), true);
    assert.equal(canonicalRepair.repair?.issuerDid, canonicalRepair.repair?.publicIssuerDid);
    assert.equal(canonicalRepair.repair?.beforeCoverage != null, true);
    assert.equal(canonicalRepair.repair?.afterCoverage != null, true);
    assert.equal(Array.isArray(canonicalRepair.repair?.afterCoverage?.publicMissingDidMethods), true);
    assert.equal(Array.isArray(canonicalRepair.repair?.afterCoverage?.repairMissingDidMethods), true);
  });
});

test("canonical repair listings include comparison repairs issued by the physical owner agent", async () => {
  await withIsolatedLedger("repair-canonical-listing", async (ledger) => {
    const repair = await ledger.repairAgentComparisonMigration({
      leftAgentId: "agent_main",
      rightAgentId: "agent_treasury",
      didMethods: ["agentpassport", "openneed"],
      issueBothMethods: true,
    });

    const canonicalList = await ledger.listMigrationRepairs({
      agentId: "agent_main",
      didMethod: "agentpassport",
      limit: 10,
      sortBy: "repairedCount",
      sortOrder: "desc",
    });
    const physicalList = await ledger.listMigrationRepairs({
      agentId: "agent_openneed_agents",
      didMethod: "agentpassport",
      limit: 10,
      sortBy: "repairedCount",
      sortOrder: "desc",
    });

    assert.equal(canonicalList.repairs.some((entry) => entry?.repairId === repair.repairId), true);
    assert.equal(physicalList.repairs.some((entry) => entry?.repairId === repair.repairId), true);
  });
});

test("credential coverage separates public, compatibility, and repair DID method sets", async () => {
  await withIsolatedLedger("coverage-did-scope", async (ledger) => {
    const agent = await ledger.registerAgent({
      displayName: "Coverage Scope Agent",
      role: "tester",
      controller: "ledger-compatibility-boundary-test",
    });
    await ledger.getAgentCredential(agent.agentId, {
      didMethod: "agentpassport",
      persist: true,
    });

    const context = await ledger.getAgentContext(agent.agentId, {
      runtimeLimit: 1,
      messageLimit: 1,
      memoryLimit: 1,
      authorizationLimit: 1,
      credentialLimit: 5,
      lightweight: true,
    });

    assert.deepEqual(context.credentialMethodCoverage?.publicSignableDidMethods, ["agentpassport"]);
    assert.deepEqual(context.credentialMethodCoverage?.compatibilitySignableDidMethods, ["openneed"]);
    assert.deepEqual(context.credentialMethodCoverage?.repairSignableDidMethods, ["agentpassport", "openneed"]);
    assert.equal(context.credentialMethodCoverage?.complete, true);
    assert.equal(context.credentialMethodCoverage?.publicComplete, true);
    assert.equal(context.credentialMethodCoverage?.repairComplete, false);
    assert.deepEqual(context.credentialMethodCoverage?.missingDidMethods, []);
    assert.deepEqual(context.credentialMethodCoverage?.publicMissingDidMethods, []);
    assert.deepEqual(context.credentialMethodCoverage?.compatibilityMissingDidMethods, ["openneed"]);
    assert.deepEqual(context.credentialMethodCoverage?.repairMissingDidMethods, ["openneed"]);
    assert.equal(context.credentialMethodCoverage?.completeSubjectCount, 1);
    assert.equal(context.credentialMethodCoverage?.repairCompleteSubjectCount, 0);
    assert.equal(context.credentialMethodCoverage?.repairableSubjectCount, 1);
  });
});

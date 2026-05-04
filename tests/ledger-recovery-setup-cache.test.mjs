import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDeviceSetupPackageSummary,
  buildSetupPackageAuditSummary,
  readDeviceSetupPackageSummaryContract,
  buildStoreRecoveryBundleSummary,
  deleteDeviceSetupPackage,
  exportDeviceSetupPackage,
  importDeviceSetupPackage,
  listDeviceSetupPackages,
  listStoreRecoveryBundles,
} from "../src/ledger-recovery-setup.js";
import { runRuntimeHousekeeping } from "../src/runtime-housekeeping.js";
import { redactRuntimeHousekeepingForReadSession } from "../src/server-security-redaction.js";

function writeJsonPreservingTimestamp(filePath, value, timestamp) {
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
  fs.utimesSync(filePath, timestamp, timestamp);
  return fs.statSync(filePath);
}

test("recovery bundle summaries refresh after same-size same-mtime replacement", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-recovery-cache-"));
  const bundlePath = path.join(tmpDir, "bundle.json");
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  try {
    const firstStats = writeJsonPreservingTimestamp(
      bundlePath,
      {
        format: "test-recovery-format",
        bundleId: "bundle_a",
        createdAt: "2026-01-01T00:00:00.000Z",
        residentAgentId: "agent_physical_a",
      },
      timestamp
    );
    const first = await listStoreRecoveryBundles({
      storeRecoveryDir: tmpDir,
      storeRecoveryFormat: "test-recovery-format",
    });

    const secondStats = writeJsonPreservingTimestamp(
      bundlePath,
      {
        format: "test-recovery-format",
        bundleId: "bundle_b",
        createdAt: "2026-01-01T00:00:00.000Z",
        residentAgentId: "agent_physical_b",
      },
      timestamp
    );
    const second = await listStoreRecoveryBundles({
      storeRecoveryDir: tmpDir,
      storeRecoveryFormat: "test-recovery-format",
    });

    assert.equal(first.bundles[0].bundleId, "bundle_a");
    assert.equal(first.bundles[0].residentAgentId, "agent_physical_a");
    assert.equal(second.bundles[0].bundleId, "bundle_b");
    assert.equal(second.bundles[0].residentAgentId, "agent_physical_b");
    assert.equal(secondStats.size, firstStats.size);
    assert.equal(secondStats.mtimeMs, firstStats.mtimeMs);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("recovery bundle summaries keep only the physical-owner residentAgentId field", () => {
  const summary = buildStoreRecoveryBundleSummary({
    format: "test-recovery-format",
    bundleId: "bundle_physical_owner",
    createdAt: "2026-01-01T00:00:00.000Z",
    residentAgentId: "agent_openneed_agents",
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: "agent_openneed_agents",
  });

  assert.equal(summary.bundleId, "bundle_physical_owner");
  assert.equal(summary.residentAgentId, "agent_openneed_agents");
  assert.equal("residentAgentReference" in summary, false);
  assert.equal("resolvedResidentAgentId" in summary, false);
});

test("device setup package summaries refresh after same-size same-mtime replacement", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-setup-cache-"));
  const packagePath = path.join(tmpDir, "setup.json");
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  try {
    const firstStats = writeJsonPreservingTimestamp(
      packagePath,
      {
        format: "test-setup-format",
        packageId: "setup_a",
        exportedAt: "2026-01-01T00:00:00.000Z",
        residentAgentId: "agent_physical_a",
        residentAgentReference: "agent_ref_a",
        resolvedResidentAgentId: "agent_physical_a",
      },
      timestamp
    );
    const first = await listDeviceSetupPackages({
      deviceSetupPackageDir: tmpDir,
      deviceSetupPackageFormat: "test-setup-format",
    });

    const secondStats = writeJsonPreservingTimestamp(
      packagePath,
      {
        format: "test-setup-format",
        packageId: "setup_b",
        exportedAt: "2026-01-01T00:00:00.000Z",
        residentAgentId: "agent_physical_b",
        residentAgentReference: "agent_ref_b",
        resolvedResidentAgentId: "agent_physical_b",
      },
      timestamp
    );
    const second = await listDeviceSetupPackages({
      deviceSetupPackageDir: tmpDir,
      deviceSetupPackageFormat: "test-setup-format",
    });

    assert.equal(first.packages[0].packageId, "setup_a");
    assert.equal(first.packages[0].residentAgentId, "agent_physical_a");
    assert.equal(first.packages[0].residentAgentReference, "agent_ref_a");
    assert.equal(first.packages[0].resolvedResidentAgentId, "agent_physical_a");
    assert.equal(second.packages[0].packageId, "setup_b");
    assert.equal(second.packages[0].residentAgentId, "agent_physical_b");
    assert.equal(second.packages[0].residentAgentReference, "agent_ref_b");
    assert.equal(second.packages[0].resolvedResidentAgentId, "agent_physical_b");
    assert.equal(secondStats.size, firstStats.size);
    assert.equal(secondStats.mtimeMs, firstStats.mtimeMs);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("device setup package summaries do not synthesize a physical owner from canonical reference alone", () => {
  const summary = buildDeviceSetupPackageSummary({
    format: "test-setup-format",
    packageId: "setup_reference_only",
    exportedAt: "2026-01-01T00:00:00.000Z",
    residentAgentReference: "agent_main",
  });

  assert.equal(summary.packageId, "setup_reference_only");
  assert.equal(summary.residentAgentId, null);
  assert.equal(summary.residentAgentReference, "agent_main");
  assert.equal(summary.resolvedResidentAgentId, null);
  assert.equal(summary.effectivePhysicalResidentAgentId, null);
  assert.equal(summary.effectiveResidentAgentReference, "agent_main");
  assert.equal(summary.effectiveResolvedResidentAgentId, null);
});

test("device setup package summaries keep missing raw resolved owner explicit while surfacing effective owner separately", () => {
  const summary = buildDeviceSetupPackageSummary({
    format: "test-setup-format",
    packageId: "setup_raw_resolved_missing",
    exportedAt: "2026-01-01T00:00:00.000Z",
    residentAgentId: "agent_openneed_agents",
    residentAgentReference: "agent_main",
  });

  assert.equal(summary.packageId, "setup_raw_resolved_missing");
  assert.equal(summary.residentAgentId, "agent_openneed_agents");
  assert.equal(summary.residentAgentReference, "agent_main");
  assert.equal(summary.resolvedResidentAgentId, null);
  assert.equal(summary.effectivePhysicalResidentAgentId, "agent_openneed_agents");
  assert.equal(summary.effectiveResidentAgentReference, "agent_main");
  assert.equal(summary.effectiveResolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(summary.residentBindingMismatch, false);
});

test("setup package audit summaries reuse the canonical resident contract and normalize audit-only fields", () => {
  const summary = buildSetupPackageAuditSummary({
    packageId: "setup_audit_contract",
    exportedAt: "2026-01-01T00:00:00.000Z",
    residentAgentId: "agent_main",
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: null,
    effectivePhysicalResidentAgentId: "agent_openneed_agents",
    effectiveResidentAgentReference: "agent_main",
    effectiveResolvedResidentAgentId: "agent_openneed_agents",
    residentBindingMismatch: false,
    packagePath: "/tmp/setup_audit_contract.json",
    invalidJson: 0,
    unreadable: "",
    errorClass: undefined,
    errorMessage: undefined,
  });

  assert.deepEqual(summary, {
    packageId: "setup_audit_contract",
    exportedAt: "2026-01-01T00:00:00.000Z",
    residentAgentId: "agent_main",
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: null,
    effectivePhysicalResidentAgentId: "agent_openneed_agents",
    effectiveResidentAgentReference: "agent_main",
    effectiveResolvedResidentAgentId: "agent_openneed_agents",
    residentBindingMismatch: false,
    note: null,
    packagePath: "/tmp/setup_audit_contract.json",
    invalidJson: false,
    unreadable: false,
    errorClass: null,
    errorMessage: null,
  });
});

test("setup package summary contract normalizes canonical setup-package fields from summary-like inputs", () => {
  const summary = readDeviceSetupPackageSummaryContract({
    packageId: "setup_contract_1",
    format: "agent-passport-device-setup-v1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    machineId: "device_contract_1",
    machineLabel: "Device Contract 1",
    residentAgentId: "agent_main",
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: null,
    effectivePhysicalResidentAgentId: "agent_openneed_agents",
    effectiveResidentAgentReference: "agent_main",
    effectiveResolvedResidentAgentId: "agent_openneed_agents",
    residentBindingMismatch: false,
    residentDidMethod: "agentpassport",
    note: "normalized summary",
    setupComplete: 1,
    missingRequiredCodes: ["code_a", "", "code_b"],
    recoveryBundleCount: "2",
    latestRecoveryBundleId: "bundle_contract_1",
    latestRecoveryRehearsalId: "rehearsal_contract_1",
    localReasonerProfileCount: "3",
    filePath: "/tmp/setup_contract_1.json",
  });

  assert.deepEqual(summary, {
    packageId: "setup_contract_1",
    format: "agent-passport-device-setup-v1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    machineId: "device_contract_1",
    machineLabel: "Device Contract 1",
    residentAgentId: "agent_main",
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: null,
    effectivePhysicalResidentAgentId: "agent_openneed_agents",
    effectiveResidentAgentReference: "agent_main",
    effectiveResolvedResidentAgentId: "agent_openneed_agents",
    residentBindingMismatch: false,
    residentDidMethod: "agentpassport",
    note: "normalized summary",
    setupComplete: true,
    missingRequiredCodes: ["code_a", "code_b"],
    recoveryBundleCount: 2,
    latestRecoveryBundleId: "bundle_contract_1",
    latestRecoveryRehearsalId: "rehearsal_contract_1",
    localReasonerProfileCount: 3,
    packagePath: "/tmp/setup_contract_1.json",
  });
});

test("setup package summary contract trusts the current top-level summary shape and leaves nested canonical overlay handling to annotate flows", () => {
  const summary = readDeviceSetupPackageSummaryContract({
    packageId: "setup_contract_overlay",
    residentAgentId: "agent_openneed_agents",
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: "agent_openneed_agents",
    effectivePhysicalResidentAgentId: "agent_openneed_agents",
    effectiveResidentAgentReference: "agent_main",
    effectiveResolvedResidentAgentId: "agent_openneed_agents",
    residentBindingMismatch: false,
    canonicalResidentBinding: {
      residentAgentId: "agent_main",
      residentAgentReference: "agent_main",
      resolvedResidentAgentId: null,
      effectivePhysicalResidentAgentId: "agent_main",
      effectiveResidentAgentReference: "agent_main",
      effectiveResolvedResidentAgentId: null,
      residentBindingMismatch: false,
    },
  });

  assert.equal(summary.packageId, "setup_contract_overlay");
  assert.equal(summary.residentAgentId, "agent_openneed_agents");
  assert.equal(summary.residentAgentReference, "agent_main");
  assert.equal(summary.resolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(summary.effectivePhysicalResidentAgentId, "agent_openneed_agents");
  assert.equal(summary.effectiveResolvedResidentAgentId, "agent_openneed_agents");
});

test("device setup package export preserves raw resident fields while keeping canonical reference separate", async () => {
  const appendedEvents = [];
  const store = {
    deviceRuntime: {
      machineId: "machine_contract_test",
      machineLabel: "Contract Test Machine",
      residentAgentId: "agent_main",
      residentDidMethod: "agentpassport",
    },
    localReasonerProfiles: [],
  };

  const exported = await exportDeviceSetupPackage(
    {
      dryRun: false,
      saveToFile: false,
      returnPackage: true,
      includeLocalReasonerProfiles: false,
      note: "contract fallback",
    },
    {
      loadStore: async () => store,
      getDeviceSetupStatus: async () => ({
        setupComplete: true,
        missingRequiredCodes: [],
        checks: [],
        residentAgentId: "agent_openneed_agents",
        residentAgentReference: "agent_main",
        resolvedResidentAgentId: "agent_openneed_agents",
        residentDidMethod: "agentpassport",
        deviceRuntime: {
          residentAgentId: "agent_openneed_agents",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: "agent_openneed_agents",
        },
        bootstrapGate: null,
        recoveryBundles: {
          counts: { total: 0 },
          bundles: [],
        },
        recoveryRehearsals: {
          counts: { total: 0, passed: 0 },
          rehearsals: [],
        },
      }),
      normalizeDeviceRuntime: (value) => value,
      protocolName: "agent-passport",
      chainIdFromStore: () => "test-chain",
      deviceSetupPackageFormat: "test-setup-format",
      deviceSetupPackageDir: "/tmp/unused-device-setup-packages",
      appendEvent: (_store, type, payload) => {
        appendedEvents.push({ type, payload });
      },
      writeStore: async () => {},
    }
  );

  assert.equal(exported.package?.residentAgentId, "agent_openneed_agents");
  assert.equal(exported.package?.residentAgentReference, "agent_main");
  assert.equal(exported.package?.resolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(exported.summary?.residentAgentId, "agent_openneed_agents");
  assert.equal(exported.summary?.residentAgentReference, "agent_main");
  assert.equal(exported.summary?.resolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(exported.summary?.effectivePhysicalResidentAgentId, "agent_openneed_agents");
  assert.equal(exported.summary?.effectiveResidentAgentReference, "agent_main");
  assert.equal(exported.summary?.effectiveResolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents.length, 1);
  assert.equal(appendedEvents[0]?.type, "device_setup_package_exported");
  assert.equal(appendedEvents[0]?.payload?.residentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.residentAgentReference, "agent_main");
  assert.equal(appendedEvents[0]?.payload?.resolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.effectivePhysicalResidentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.effectiveResidentAgentReference, "agent_main");
  assert.equal(appendedEvents[0]?.payload?.effectiveResolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.residentBindingMismatch, false);
});

test("device setup package export preserves missing raw resolved resident ids while keeping effective owner visible in summary", async () => {
  const appendedEvents = [];
  const store = {
    deviceRuntime: {
      machineId: "machine_contract_test",
      machineLabel: "Contract Test Machine",
      residentAgentId: "agent_openneed_agents",
      residentAgentReference: "agent_main",
      residentDidMethod: "agentpassport",
      resolvedResidentAgentId: null,
    },
    localReasonerProfiles: [],
  };

  const exported = await exportDeviceSetupPackage(
    {
      dryRun: false,
      saveToFile: false,
      returnPackage: true,
      includeLocalReasonerProfiles: false,
      note: "missing raw resolved contract",
    },
    {
      loadStore: async () => store,
      getDeviceSetupStatus: async () => ({
        setupComplete: true,
        missingRequiredCodes: [],
        checks: [],
        residentAgentId: "agent_openneed_agents",
        residentAgentReference: "agent_main",
        resolvedResidentAgentId: null,
        residentDidMethod: "agentpassport",
        deviceRuntime: {
          residentAgentId: "agent_openneed_agents",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: null,
        },
        bootstrapGate: null,
        recoveryBundles: {
          counts: { total: 0 },
          bundles: [],
        },
        recoveryRehearsals: {
          counts: { total: 0, passed: 0 },
          rehearsals: [],
        },
      }),
      normalizeDeviceRuntime: (value) => value,
      protocolName: "agent-passport",
      chainIdFromStore: () => "test-chain",
      deviceSetupPackageFormat: "test-setup-format",
      deviceSetupPackageDir: "/tmp/unused-device-setup-packages",
      appendEvent: (_store, type, payload) => {
        appendedEvents.push({ type, payload });
      },
      writeStore: async () => {},
    }
  );

  assert.equal(exported.package?.residentAgentId, "agent_openneed_agents");
  assert.equal(exported.package?.residentAgentReference, "agent_main");
  assert.equal(exported.package?.resolvedResidentAgentId, null);
  assert.equal(exported.summary?.residentAgentId, "agent_openneed_agents");
  assert.equal(exported.summary?.residentAgentReference, "agent_main");
  assert.equal(exported.summary?.resolvedResidentAgentId, null);
  assert.equal(exported.summary?.effectivePhysicalResidentAgentId, "agent_openneed_agents");
  assert.equal(exported.summary?.effectiveResidentAgentReference, "agent_main");
  assert.equal(exported.summary?.effectiveResolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents.length, 1);
  assert.equal(appendedEvents[0]?.type, "device_setup_package_exported");
  assert.equal(appendedEvents[0]?.payload?.residentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.residentAgentReference, "agent_main");
  assert.equal(appendedEvents[0]?.payload?.resolvedResidentAgentId, null);
  assert.equal(appendedEvents[0]?.payload?.effectivePhysicalResidentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.effectiveResidentAgentReference, "agent_main");
  assert.equal(appendedEvents[0]?.payload?.effectiveResolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.residentBindingMismatch, false);
});

test("device setup package import records an audit event even when no local reasoner profiles are imported", async () => {
  const appendedEvents = [];
  const setupPackage = {
    format: "test-setup-format",
    packageId: "setup_import_contract",
    exportedAt: "2026-01-01T00:00:00.000Z",
    residentAgentId: "agent_main",
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: null,
    residentDidMethod: "agentpassport",
    runtimeConfig: {
      residentAgentId: "agent_main",
      residentAgentReference: "agent_main",
      resolvedResidentAgentId: null,
      residentLocked: true,
      localMode: "local_only",
      allowOnlineReasoner: false,
      commandPolicy: {},
      retrievalPolicy: {},
      setupPolicy: {},
      localReasoner: {},
      sandboxPolicy: {},
    },
    localReasonerProfiles: [],
  };

  const imported = await importDeviceSetupPackage(
    {
      dryRun: false,
      importLocalReasonerProfiles: false,
    },
    {
      resolveDeviceSetupPackageInputImpl: async () => ({
        setupPackage,
        packagePath: "/tmp/unused-setup-import-contract.json",
      }),
      normalizeDeviceRuntime: (value) => value,
      normalizeDidMethodImpl: (value) => value,
      configureDeviceRuntime: async () => ({
        deviceRuntime: {
          residentAgentId: "agent_openneed_agents",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: "agent_openneed_agents",
        },
      }),
      normalizeLocalReasonerProfileRecord: (value) => value,
      loadStore: async () => ({
        localReasonerProfiles: [],
      }),
      appendEvent: (_store, type, payload) => {
        appendedEvents.push({ type, payload });
      },
      writeStore: async () => {},
      getDeviceSetupStatus: async () => ({
        setupComplete: true,
      }),
    }
  );

  assert.equal(imported.summary?.residentAgentId, "agent_main");
  assert.equal(imported.summary?.residentAgentReference, "agent_main");
  assert.equal(imported.summary?.resolvedResidentAgentId, null);
  assert.equal(imported.summary?.effectivePhysicalResidentAgentId, "agent_main");
  assert.equal(imported.summary?.effectiveResidentAgentReference, "agent_main");
  assert.equal(imported.summary?.effectiveResolvedResidentAgentId, null);
  assert.equal(appendedEvents.length, 1);
  assert.equal(appendedEvents[0]?.type, "device_setup_package_imported");
  assert.equal(appendedEvents[0]?.payload?.residentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.residentAgentReference, "agent_main");
  assert.equal(appendedEvents[0]?.payload?.resolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.packageResidentAgentId, "agent_main");
  assert.equal(appendedEvents[0]?.payload?.packageResidentAgentReference, "agent_main");
  assert.equal(appendedEvents[0]?.payload?.packageResolvedResidentAgentId, null);
  assert.equal(appendedEvents[0]?.payload?.effectivePhysicalResidentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.effectiveResidentAgentReference, "agent_main");
  assert.equal(appendedEvents[0]?.payload?.effectiveResolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.residentBindingMismatch, false);
  assert.equal(appendedEvents[0]?.payload?.importedLocalReasonerProfiles, 0);
  assert.equal(appendedEvents[0]?.payload?.overwrittenLocalReasonerProfiles, 0);
  assert.equal(appendedEvents[0]?.payload?.createdLocalReasonerProfiles, 0);
});

test("device setup package import prefers canonical resident binding over drifted legacy top-level fields", async () => {
  const appendedEvents = [];
  const configureCalls = [];
  const setupPackage = {
    format: "test-setup-format",
    packageId: "setup_import_canonical_binding",
    exportedAt: "2026-01-01T00:00:00.000Z",
    residentAgentId: "agent_openneed_agents",
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: "agent_openneed_agents",
    canonicalResidentBinding: {
      residentAgentId: "agent_main",
      residentAgentReference: "agent_main",
      resolvedResidentAgentId: null,
    },
    residentDidMethod: "agentpassport",
    runtimeConfig: {
      residentAgentId: "agent_openneed_agents",
      residentAgentReference: "agent_main",
      resolvedResidentAgentId: "agent_openneed_agents",
      residentLocked: true,
      localMode: "local_only",
      allowOnlineReasoner: false,
      commandPolicy: {},
      retrievalPolicy: {},
      setupPolicy: {},
      localReasoner: {},
      sandboxPolicy: {},
    },
    localReasonerProfiles: [],
  };

  const imported = await importDeviceSetupPackage(
    {
      dryRun: false,
      importLocalReasonerProfiles: false,
    },
    {
      resolveDeviceSetupPackageInputImpl: async () => ({
        setupPackage,
        packagePath: "/tmp/unused-setup-import-canonical-binding.json",
      }),
      normalizeDeviceRuntime: (value) => value,
      normalizeDidMethodImpl: (value) => value,
      configureDeviceRuntime: async (payload) => {
        configureCalls.push(payload);
        return {
          deviceRuntime: {
            residentAgentId: "agent_openneed_agents",
            residentAgentReference: "agent_main",
            resolvedResidentAgentId: "agent_openneed_agents",
          },
        };
      },
      normalizeLocalReasonerProfileRecord: (value) => value,
      loadStore: async () => ({
        localReasonerProfiles: [],
      }),
      appendEvent: (_store, type, payload) => {
        appendedEvents.push({ type, payload });
      },
      writeStore: async () => {},
      getDeviceSetupStatus: async () => ({
        setupComplete: true,
      }),
    }
  );

  assert.equal(configureCalls.length, 1);
  assert.equal(configureCalls[0]?.residentAgentId, "agent_main");
  assert.equal(configureCalls[0]?.updatedByAgentId, "agent_main");
  assert.equal(imported.summary?.residentAgentId, "agent_main");
  assert.equal(imported.summary?.residentAgentReference, "agent_main");
  assert.equal(imported.summary?.resolvedResidentAgentId, null);
  assert.equal(imported.summary?.canonicalResidentBinding?.residentAgentId, "agent_main");
  assert.equal(imported.summary?.canonicalResidentBinding?.resolvedResidentAgentId, null);
  assert.equal(appendedEvents.length, 1);
  assert.equal(appendedEvents[0]?.payload?.residentAgentId, "agent_openneed_agents");
  assert.equal(appendedEvents[0]?.payload?.packageResidentAgentId, "agent_main");
  assert.equal(appendedEvents[0]?.payload?.packageResidentAgentReference, "agent_main");
  assert.equal(appendedEvents[0]?.payload?.packageResolvedResidentAgentId, null);
});

test("device setup package delete event preserves raw resident fields and surfaces effective owner fields", async () => {
  const appendedEvents = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-delete-setup-package-"));
  const packageId = "setup_delete_contract";
  const packagePath = path.join(tmpDir, `${packageId}.json`);
  try {
    fs.writeFileSync(
      packagePath,
      `${JSON.stringify(
        {
          format: "test-setup-format",
          packageId,
          exportedAt: "2026-01-01T00:00:00.000Z",
          residentAgentId: "agent_openneed_agents",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: null,
          residentDidMethod: "agentpassport",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const deleted = await deleteDeviceSetupPackage(
      packageId,
      {
        dryRun: false,
      },
      {
        loadStore: async () => ({}),
        appendEvent: (_store, type, payload) => {
          appendedEvents.push({ type, payload });
        },
        writeStore: async () => {},
        deviceSetupPackageDir: tmpDir,
        deviceSetupPackageFormat: "test-setup-format",
      }
    );

    assert.equal(fs.existsSync(packagePath), false);
    assert.equal(deleted.summary?.residentAgentId, "agent_openneed_agents");
    assert.equal(deleted.summary?.residentAgentReference, "agent_main");
    assert.equal(deleted.summary?.resolvedResidentAgentId, null);
    assert.equal(deleted.summary?.effectivePhysicalResidentAgentId, "agent_openneed_agents");
    assert.equal(deleted.summary?.effectiveResidentAgentReference, "agent_main");
    assert.equal(deleted.summary?.effectiveResolvedResidentAgentId, "agent_openneed_agents");
    assert.equal(appendedEvents.length, 1);
    assert.equal(appendedEvents[0]?.type, "device_setup_package_deleted");
    assert.equal(appendedEvents[0]?.payload?.residentAgentId, "agent_openneed_agents");
    assert.equal(appendedEvents[0]?.payload?.residentAgentReference, "agent_main");
    assert.equal(appendedEvents[0]?.payload?.resolvedResidentAgentId, null);
    assert.equal(appendedEvents[0]?.payload?.effectivePhysicalResidentAgentId, "agent_openneed_agents");
    assert.equal(appendedEvents[0]?.payload?.effectiveResidentAgentReference, "agent_main");
    assert.equal(appendedEvents[0]?.payload?.effectiveResolvedResidentAgentId, "agent_openneed_agents");
    assert.equal(appendedEvents[0]?.payload?.residentBindingMismatch, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("recovery and setup package listings degrade when configured directories are files", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-recovery-dir-file-"));
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupDir = path.join(tmpDir, "setup-packages");
  try {
    fs.writeFileSync(recoveryDir, "not a directory", "utf8");
    fs.writeFileSync(setupDir, "not a directory", "utf8");

    const recovery = await listStoreRecoveryBundles({
      storeRecoveryDir: recoveryDir,
      storeRecoveryFormat: "test-recovery-format",
    });
    const setup = await listDeviceSetupPackages({
      deviceSetupPackageDir: setupDir,
      deviceSetupPackageFormat: "test-setup-format",
    });

    assert.deepEqual(recovery.bundles, []);
    assert.deepEqual(recovery.counts, { total: 0 });
    assert.equal(recovery.unavailable, true);
    assert.equal(recovery.unavailableReason, "ENOTDIR");
    assert.deepEqual(setup.packages, []);
    assert.deepEqual(setup.counts, { total: 0 });
    assert.equal(setup.unavailable, true);
    assert.equal(setup.unavailableReason, "ENOTDIR");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("recovery and setup package listings surface malformed JSON artifacts", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-invalid-artifacts-"));
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupDir = path.join(tmpDir, "setup-packages");
  try {
    fs.mkdirSync(recoveryDir, { recursive: true });
    fs.mkdirSync(setupDir, { recursive: true });
    fs.writeFileSync(path.join(recoveryDir, "broken-recovery.json"), "{", "utf8");
    fs.writeFileSync(path.join(setupDir, "broken-setup.json"), "{", "utf8");

    const recovery = await listStoreRecoveryBundles({
      storeRecoveryDir: recoveryDir,
      storeRecoveryFormat: "test-recovery-format",
    });
    const setup = await listDeviceSetupPackages({
      deviceSetupPackageDir: setupDir,
      deviceSetupPackageFormat: "test-setup-format",
    });

    assert.equal(recovery.counts.invalid, 1);
    assert.equal(recovery.invalidBundles[0].invalidJson, true);
    assert.equal(recovery.invalidBundles[0].bundleId, "broken-recovery");
    assert.equal(recovery.invalidBundles[0].bundlePath, path.join(recoveryDir, "broken-recovery.json"));
    assert.equal(setup.counts.invalid, 1);
    assert.equal(setup.invalidPackages[0].invalidJson, true);
    assert.equal(setup.invalidPackages[0].packageId, "broken-setup");
    assert.equal(setup.invalidPackages[0].packagePath, path.join(setupDir, "broken-setup.json"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("runtime housekeeping audit keeps malformed recovery and setup artifacts visible", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-housekeeping-invalid-"));
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupDir = path.join(tmpDir, "setup-packages");
  const archiveDir = path.join(tmpDir, "archives");
  const readSessionPath = path.join(tmpDir, "read-sessions.json");
  const previousReadSessionPath = process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH;
  try {
    process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = readSessionPath;
    fs.mkdirSync(recoveryDir, { recursive: true });
    fs.mkdirSync(setupDir, { recursive: true });
    fs.writeFileSync(path.join(recoveryDir, "broken-recovery.json"), "{", "utf8");
    fs.writeFileSync(path.join(setupDir, "broken-setup.json"), "{", "utf8");

    const report = await runRuntimeHousekeeping({
      apply: false,
      keepRecovery: 5,
      keepSetup: 5,
      recoveryDir,
      setupPackageDir: setupDir,
      archiveDir,
      liveLedgerPath: path.join(tmpDir, "ledger.json"),
    });

    assert.equal(report.recoveryBundles.invalidCount, 1);
    assert.equal(report.recoveryBundles.kept[0].invalidJson, true);
    assert.equal(report.recoveryBundles.invalid[0].bundlePath, path.join(recoveryDir, "broken-recovery.json"));
    assert.equal(report.setupPackages.invalidCount, 1);
    assert.equal(report.setupPackages.kept[0].invalidJson, true);
    assert.equal(report.setupPackages.invalid[0].packagePath, path.join(setupDir, "broken-setup.json"));

    const redacted = redactRuntimeHousekeepingForReadSession(report, {
      redactionTemplate: "metadata_only",
    });
    assert.equal(redacted.recoveryBundles.kept[0].bundlePath, null);
    assert.equal(redacted.recoveryBundles.kept[0].errorMessage, null);
    assert.equal(redacted.recoveryBundles.invalid[0].bundlePath, null);
    assert.equal(redacted.recoveryBundles.invalid[0].errorMessage, null);
    assert.equal(redacted.setupPackages.kept[0].packagePath, null);
    assert.equal(redacted.setupPackages.kept[0].errorMessage, null);
    assert.equal(redacted.setupPackages.invalid[0].packagePath, null);
    assert.equal(redacted.setupPackages.invalid[0].errorMessage, null);

    const summaryOnly = redactRuntimeHousekeepingForReadSession(report, {
      redactionTemplate: "summary_only",
    });
    assert.equal(summaryOnly.recoveryBundles.invalidCount, undefined);
    assert.equal(summaryOnly.recoveryBundles.keptCount, undefined);
    assert.equal(summaryOnly.recoveryBundles.candidateCount, undefined);
    assert.equal(summaryOnly.recoveryBundles.deletedCount, undefined);
    assert.equal(summaryOnly.recoveryBundles.countsHidden, true);
    assert.equal(summaryOnly.setupPackages.invalidCount, undefined);
    assert.equal(summaryOnly.setupPackages.counts, undefined);
    assert.equal(summaryOnly.setupPackages.countsHidden, true);
  } finally {
    if (previousReadSessionPath == null) {
      delete process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH;
    } else {
      process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = previousReadSessionPath;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("runtime housekeeping preserves raw setup-package binding while surfacing effective physical owner separately", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-housekeeping-setup-reference-"));
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupDir = path.join(tmpDir, "setup-packages");
  const archiveDir = path.join(tmpDir, "archives");
  const readSessionPath = path.join(tmpDir, "read-sessions.json");
  const previousReadSessionPath = process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH;
  try {
    process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = readSessionPath;
    fs.mkdirSync(recoveryDir, { recursive: true });
    fs.mkdirSync(setupDir, { recursive: true });
    fs.writeFileSync(
      path.join(setupDir, "setup-valid.json"),
      `${JSON.stringify(
        {
          format: "test-setup-format",
          packageId: "setup_valid",
          exportedAt: "2026-01-01T00:00:00.000Z",
          residentAgentId: "agent_main",
          residentAgentReference: "agent_main",
          resolvedResidentAgentId: "agent_openneed_agents",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const report = await runRuntimeHousekeeping({
      apply: false,
      keepRecovery: 5,
      keepSetup: 5,
      recoveryDir,
      setupPackageDir: setupDir,
      archiveDir,
      liveLedgerPath: path.join(tmpDir, "ledger.json"),
    });

    assert.equal(report.setupPackages.invalidCount, 0);
    assert.equal(report.setupPackages.kept[0].residentAgentId, "agent_main");
    assert.equal(report.setupPackages.kept[0].residentAgentReference, "agent_main");
    assert.equal(report.setupPackages.kept[0].resolvedResidentAgentId, "agent_openneed_agents");
    assert.equal(report.setupPackages.kept[0].effectivePhysicalResidentAgentId, "agent_openneed_agents");
    assert.equal(report.setupPackages.kept[0].effectiveResidentAgentReference, "agent_main");
    assert.equal(report.setupPackages.kept[0].effectiveResolvedResidentAgentId, "agent_openneed_agents");
  } finally {
    if (previousReadSessionPath == null) {
      delete process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH;
    } else {
      process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = previousReadSessionPath;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

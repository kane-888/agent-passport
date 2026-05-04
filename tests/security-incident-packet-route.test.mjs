import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { selectRuntimeTruth } from "../public/runtime-truth-client.js";
import { buildPublicAgentRuntimeTruth } from "../src/public-agent-runtime-truth.js";

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

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function buildLocalReasonerArgs(responseText, model = "test-local-command") {
  const script = `process.stdout.write(JSON.stringify({responseText:${JSON.stringify(responseText)},model:${JSON.stringify(model)}}));`;
  return ["-e", script];
}

function buildValidGroundedResponse(agentId = "agent_openneed_agents") {
  return [
    `agent_id: ${agentId}`,
    "名字: 沈知远",
    "角色: CEO",
    "结果: 我会继续推进当前任务，并以本地参考层为准。",
  ].join("\n");
}

async function withOpenAICompatibleServer(responseText, callback) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: request.method,
      url: request.url,
      body: body ? JSON.parse(body) : null,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: responseText,
            },
          },
        ],
      })
    );
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback({ baseUrl, requests });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8").trim();
  return body ? JSON.parse(body) : {};
}

async function withIncidentPacketServer(options, callback) {
  const resolvedOptions =
    typeof options === "function"
      ? {}
      : options && typeof options === "object"
        ? options
        : {};
  const resolvedCallback = typeof options === "function" ? options : callback;
  const residentAgentId = resolvedOptions.residentAgentId || "agent_main";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-incident-packet-route-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");
  const archiveDir = path.join(tmpDir, "archives");
  const adminTokenPath = path.join(tmpDir, ".admin-token");

  try {
    await withEnv(
      {
        AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
        AGENT_PASSPORT_ARCHIVE_DIR: archiveDir,
        AGENT_PASSPORT_ADMIN_TOKEN_PATH: adminTokenPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const routesUrl = pathToFileURL(path.join(rootDir, "src", "server-security-routes.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("incident-packet-ledger")}`);
        const { handleSecurityRoutes } = await import(`${routesUrl}?${uniqueImportSuffix("incident-packet-routes")}`);

        await ledger.configureDeviceRuntime({
          residentAgentId,
          residentDidMethod: "agentpassport",
          residentLocked: false,
          localMode: "online_enhanced",
          allowOnlineReasoner: true,
          localReasonerEnabled: true,
          localReasonerProvider: "local_command",
          localReasonerCommand: process.execPath,
          localReasonerArgs: buildLocalReasonerArgs(
            [
              "agent_id: agent_treasury",
              "名字: 错误身份",
              "结果: 我会继续推进当前任务。",
            ].join("\n")
          ),
          localReasonerCwd: rootDir,
          retrievalStrategy: "local_first_non_vector",
          allowVectorIndex: false,
        });

        await ledger.bootstrapAgentRuntime(
          residentAgentId,
          {
            displayName: "沈知远",
            role: "CEO",
            longTermGoal: "agent-passport",
            currentGoal: "验证 incident packet contract",
            currentPlan: ["读取本地上下文", "生成候选回复", "必要时升级线上"],
            nextAction: "继续推进当前任务",
            claimResidentAgent: true,
            allowResidentRebind: true,
            dryRun: false,
          },
          { didMethod: "agentpassport" }
        );

        await withOpenAICompatibleServer(buildValidGroundedResponse(residentAgentId), async ({ baseUrl: reasonerUrl, requests }) => {
          const result = await ledger.executeAgentRunner(
            residentAgentId,
            {
              currentGoal: "验证 incident packet route contract",
              userTurn: "继续推进当前任务",
              reasonerUrl,
              reasonerModel: "gpt-test",
              autoCompact: false,
              persistRun: true,
              writeConversationTurns: false,
              storeToolResults: false,
              turnCount: 2,
              estimatedContextChars: 1200,
              estimatedContextTokens: 320,
            },
            { didMethod: "agentpassport" }
          );

          assert.equal(result.run?.status, "completed");
          assert.equal(requests.length, 1);
        });

        if (resolvedOptions.includeRunnerGuardRun) {
          await withEnv(
            {
              AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT: path.join(rootDir, "missing-memory-stability-root"),
            },
            async () => {
              const blocked = await ledger.executeAgentRunner(
                residentAgentId,
                {
                  currentGoal: "验证 incident packet runner guard contract",
                  userTurn: "继续推进当前任务",
                  reasonerProvider: "local_mock",
                  autoRecover: false,
                  autoCompact: false,
                  persistRun: true,
                  writeConversationTurns: false,
                  storeToolResults: false,
                  memoryStabilityPromptPreTransform: true,
                },
                { didMethod: "agentpassport" }
              );

              assert.equal(blocked.run?.status, "blocked");
              assert.equal(blocked.run?.runnerGuard?.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
              assert.equal(blocked.run?.runnerGuard?.blockedBy, "memory_stability_prompt_pretransform");
            }
          );
        }

        const server = createHttpServer(async (req, res) => {
          try {
            const url = new URL(req.url, "http://127.0.0.1");
            req.agentPassportAccess = { mode: "admin" };
            await handleSecurityRoutes({
              req,
              res,
              url,
              pathname: url.pathname,
              segments: url.pathname.split("/").filter(Boolean),
              parseBody: () => parseBody(req),
              rotateAdminToken: async () => ({}),
            });
            if (!res.writableEnded) {
              res.writeHead(404, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "not_found" }));
            }
          } catch (error) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: error.message || String(error) }));
          }
        });

        const baseUrl = await listen(server);
        try {
          await resolvedCallback({ baseUrl, residentAgentId });
        } finally {
          await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test("incident packet route chain keeps observation-backed memory truth ahead of stale state shells", () => {
  const agentRuntimeTruth = buildPublicAgentRuntimeTruth({
    memoryHomeostasis: {
      stateCount: 2,
      latestState: {
        correctionLevel: "light",
        cT: 0.18,
        runtimeMemoryStateId: "mhstate_stale_shell",
        updatedAt: "2026-04-24T10:00:00.000Z",
      },
      observationSummary: {
        effectiveness: {
          recoveryRate: 0.5,
        },
        latestObservation: {
          correctionLevel: "medium",
          cT: 0.41,
          runtimeMemoryStateId: "mhstate_observed",
          observedAt: "2026-04-24T10:05:00.000Z",
          observationKind: "correction_rebuild",
          recoverySignal: "risk_rising",
          correctionActions: ["rewrite_working_memory_summary"],
        },
      },
    },
  });

  const runtimeTruth = selectRuntimeTruth({
    security: {
      agentRuntimeTruth,
    },
  });

  assert.equal(runtimeTruth.agentRuntime?.latestMemoryStabilityStateId, "mhstate_observed");
  assert.equal(runtimeTruth.agentRuntime?.latestMemoryStabilityCorrectionLevel, "medium");
  assert.equal(runtimeTruth.agentRuntime?.latestMemoryStabilityRiskScore, 0.41);
  assert.equal(runtimeTruth.agentRuntime?.latestMemoryStabilityUpdatedAt, "2026-04-24T10:05:00.000Z");
  assert.equal(runtimeTruth.agentRuntime?.latestMemoryStabilityObservationKind, "correction_rebuild");
  assert.deepEqual(runtimeTruth.agentRuntime?.latestMemoryStabilityCorrectionActions, ["rewrite_working_memory_summary"]);
  assert.equal(runtimeTruth.agentRuntime?.memoryStabilityRecoveryRate, 0.5);
  assert.notEqual(runtimeTruth.agentRuntime?.latestMemoryStabilityStateId, "mhstate_stale_shell");
  assert.notEqual(runtimeTruth.agentRuntime?.latestMemoryStabilityUpdatedAt, "2026-04-24T10:00:00.000Z");
});

test("incident packet resident canonicalizers normalize legacy nested resident shape and exported evidence", async () => {
  const canonicalUrl = pathToFileURL(path.join(rootDir, "src", "security-incident-packet-canonical.js")).href;
  const {
    resolveIncidentPacketResidentBinding,
    canonicalizeIncidentPacketSetupSnapshot,
    canonicalizeIncidentPacketEvidenceRef,
  } = await import(`${canonicalUrl}?${uniqueImportSuffix("incident-packet-canonicalizers")}`);

  const setup = {
    deviceRuntime: {
      residentAgent: {
        agentId: "agent_openneed_agents",
        referenceAgentId: "agent_openneed_agents",
      },
    },
  };
  const binding = resolveIncidentPacketResidentBinding(setup);
  const setupSnapshot = canonicalizeIncidentPacketSetupSnapshot(setup);
  const evidenceRef = canonicalizeIncidentPacketEvidenceRef(
    {
      evidenceRefId: "evidence_1",
      agentId: "agent_openneed_agents",
    },
    binding
  );

  assert.deepEqual(binding, {
    physicalResidentAgentId: "agent_openneed_agents",
    residentAgentId: "agent_openneed_agents",
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: "agent_openneed_agents",
  });
  assert.equal(setupSnapshot.physicalResidentAgentId, "agent_openneed_agents");
  assert.equal(setupSnapshot.residentAgentReference, "agent_main");
  assert.equal(setupSnapshot.deviceRuntime?.physicalResidentAgentId, "agent_openneed_agents");
  assert.equal(setupSnapshot.deviceRuntime?.residentAgentReference, "agent_main");
  assert.equal(setupSnapshot.deviceRuntime?.residentAgent?.referenceAgentId, "agent_main");
  assert.equal(evidenceRef.physicalResidentAgentId, "agent_openneed_agents");
  assert.equal(evidenceRef.residentAgentReference, "agent_main");
  assert.equal(evidenceRef.resolvedResidentAgentId, null);
});

test("incident packet resident canonicalizers keep explicit physical owner ahead of stale canonical resolved fallback", async () => {
  const canonicalUrl = pathToFileURL(path.join(rootDir, "src", "security-incident-packet-canonical.js")).href;
  const { resolveIncidentPacketResidentBinding } = await import(
    `${canonicalUrl}?${uniqueImportSuffix("incident-packet-canonicalizers-stale-resolved")}`
  );

  const binding = resolveIncidentPacketResidentBinding({
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: "agent_main",
    deviceRuntime: {
      residentAgent: {
        agentId: "agent_openneed_agents",
        referenceAgentId: "agent_openneed_agents",
      },
    },
  });

  assert.deepEqual(binding, {
    physicalResidentAgentId: "agent_openneed_agents",
    residentAgentId: "agent_openneed_agents",
    residentAgentReference: "agent_main",
    resolvedResidentAgentId: "agent_main",
  });
});

test(
  "incident packet routes keep agent runtime truth, export coverage, and run reasoner contract stable",
  { concurrency: false },
  async () => {
  await withIncidentPacketServer({ includeRunnerGuardRun: true }, async ({ baseUrl, residentAgentId }) => {
    const packetResponse = await fetch(`${baseUrl}/api/security/incident-packet`);
    assert.equal(packetResponse.status, 200);
    const packet = await packetResponse.json();

    assert.equal(packet.format, "agent-passport-incident-packet-v1");
    assert.equal(packet.product, "agent-passport");
    assert.equal(packet.sourceSurface, "/api/security/incident-packet");
    assert.equal(packet.operatorDecision?.source, "operator_truth_snapshot");
    assert.equal(packet.residentAgentId, residentAgentId);
    assert.equal(packet.physicalResidentAgentId, residentAgentId);
    assert.equal(packet.residentAgentReference, "agent_main");
    assert.equal(packet.resolvedResidentAgentId, residentAgentId);
    assert.equal(packet.snapshots?.deviceSetup?.physicalResidentAgentId, residentAgentId);
    assert.equal(packet.snapshots?.deviceSetup?.deviceRuntime?.physicalResidentAgentId, residentAgentId);
    assert.equal(
      JSON.stringify(packet.boundaries?.agentRuntime ?? null),
      JSON.stringify(packet.snapshots?.security?.agentRuntimeTruth ?? null)
    );
    assert.equal(packet.boundaries?.agentRuntime?.localFirst, true);
    assert.equal(packet.boundaries?.agentRuntime?.latestRunStatus, "blocked");
    assert.equal(packet.boundaries?.agentRuntime?.latestFallbackActivated, false);
    assert.equal(packet.boundaries?.agentRuntime?.latestFallbackCause, null);
    assert.equal(packet.boundaries?.agentRuntime?.latestDegradedLocalFallback, false);
    assert.equal(packet.boundaries?.agentRuntime?.latestRunnerGuardActivated, true);
    assert.equal(packet.boundaries?.agentRuntime?.latestRunnerGuardBlockedBy, "memory_stability_prompt_pretransform");
    assert.equal(packet.boundaries?.agentRuntime?.latestRunnerGuardCode, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
    assert.equal(packet.boundaries?.agentRuntime?.qualityEscalationRuns, 1);
    assert.equal(packet.boundaries?.agentRuntime?.latestQualityEscalationActivated, false);
    assert.equal(packet.boundaries?.agentRuntime?.latestQualityEscalationProvider, null);
    assert.equal(packet.boundaries?.agentRuntime?.latestQualityEscalationReason, null);
    assert.deepEqual(packet.boundaries?.agentRuntime?.latestQualityEscalationIssueCodes, []);
    assert(packet.boundaries?.agentRuntime?.latestMemoryStabilityStateId, "incident packet should expose memory state id");
    assert(packet.boundaries?.agentRuntime?.latestMemoryStabilityUpdatedAt, "incident packet should expose memory state updatedAt");
    assert(
      packet.boundaries?.agentRuntime?.latestMemoryStabilityObservationKind,
      "incident packet should expose memory observation kind"
    );
    assert(
      Object.prototype.hasOwnProperty.call(packet.boundaries?.agentRuntime || {}, "latestMemoryStabilityRecoverySignal"),
      true
    );
    assert.equal(
      Array.isArray(packet.boundaries?.agentRuntime?.latestMemoryStabilityCorrectionActions) &&
        packet.boundaries.agentRuntime.latestMemoryStabilityCorrectionActions.length > 0,
      true
    );
    assert.equal(Number.isFinite(Number(packet.boundaries?.agentRuntime?.memoryStabilityRecoveryRate)), true);

    const latestRun = packet.recentEvidence?.autoRecovery?.recentRuns?.[0] || null;
    assert(latestRun, "incident packet should expose the latest persisted run");
    assert.equal(latestRun.status, "blocked");
    assert.equal(latestRun.reasoner, null);
    assert.equal(latestRun.runnerGuard?.activated, true);
    assert.equal(latestRun.runnerGuard?.blockedBy, "memory_stability_prompt_pretransform");
    assert.equal(latestRun.runnerGuard?.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
    assert.equal(latestRun.runnerGuard?.stage, "contract_validation");
    assert.equal(latestRun.runnerGuard?.receiptStatus, "blocked_preflight");
    assert.deepEqual(latestRun.runnerGuard?.explicitRequestKinds, ["prompt_pretransform"]);

    const latestCompletedRun = packet.recentEvidence?.autoRecovery?.recentRuns?.[1] || null;
    assert(latestCompletedRun, "incident packet should retain the previous completed run as quality evidence");
    assert.equal(latestCompletedRun.reasoner?.fallbackActivated, false);
    assert.equal(latestCompletedRun.reasoner?.fallbackCause, null);
    assert.equal(latestCompletedRun.reasoner?.degradedLocalFallback, false);
    assert.equal(latestCompletedRun.reasoner?.qualityEscalationActivated, true);
    assert.equal(latestCompletedRun.reasoner?.qualityEscalationProvider, "openai_compatible");
    assert.equal(latestCompletedRun.reasoner?.qualityEscalationInitialProvider, "local_command");
    assert.equal(latestCompletedRun.reasoner?.qualityEscalationReason, "verification_invalid");
    assert.deepEqual(latestCompletedRun.reasoner?.qualityEscalationIssueCodes, [
      "agent_id_mismatch",
      "profile_name_mismatch",
    ]);
    assert.equal(
      Object.prototype.hasOwnProperty.call(latestCompletedRun.reasoner || {}, "memoryStabilitySignalSource"),
      true
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(latestCompletedRun.reasoner || {}, "memoryStabilityPreflightStatus"),
      true
    );

    const exportResponse = await fetch(`${baseUrl}/api/security/incident-packet/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        note: "route contract export",
      }),
    });
    assert.equal(exportResponse.status, 200);
    const exportedPacket = await exportResponse.json();

    assert.equal(exportedPacket.sourceSurface, "/api/security/incident-packet/export");
    assert.equal(
      JSON.stringify(exportedPacket.boundaries?.agentRuntime ?? null),
      JSON.stringify(packet.boundaries?.agentRuntime ?? null)
    );
    assert.equal(
      JSON.stringify(exportedPacket.snapshots?.security?.agentRuntimeTruth ?? null),
      JSON.stringify(packet.snapshots?.security?.agentRuntimeTruth ?? null)
    );
    assert.equal(exportedPacket.operatorDecision?.summary, packet.operatorDecision?.summary);
    assert.equal(exportedPacket.operatorDecision?.nextAction, packet.operatorDecision?.nextAction);
    assert.deepEqual(exportedPacket.operatorDecision?.hardAlerts ?? [], packet.operatorDecision?.hardAlerts ?? []);
    assert.equal(exportedPacket.exportCoverage?.protectedRead, true);
    assert.equal(exportedPacket.exportCoverage?.residentAgentBound, true);
    assert.deepEqual(exportedPacket.exportCoverage?.missingSections, []);
    assert(
      Array.isArray(exportedPacket.exportCoverage?.includedSections) &&
        exportedPacket.exportCoverage.includedSections.includes("agent_runtime_truth")
    );
    assert.equal(exportedPacket.exportRecord?.kind, "note");
    assert.equal(exportedPacket.exportRecord?.agentId, residentAgentId);
    assert.equal(exportedPacket.exportRecord?.physicalResidentAgentId, residentAgentId);
    assert.equal(exportedPacket.exportRecord?.residentAgentReference, exportedPacket.residentAgentReference);
    assert.equal(exportedPacket.exportRecord?.resolvedResidentAgentId, exportedPacket.resolvedResidentAgentId);
    assert.equal(exportedPacket.exportRecord?.summary, exportedPacket.operatorDecision?.summary);
    assert(
      Array.isArray(exportedPacket.exportRecord?.tags) &&
        exportedPacket.exportRecord.tags.includes("incident-packet-export")
    );

    const historyResponse = await fetch(`${baseUrl}/api/security/incident-packet/history`);
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.residentAgentId, residentAgentId);
    assert.equal(history.physicalResidentAgentId, residentAgentId);
    assert.equal(history.residentAgentReference, exportedPacket.residentAgentReference);
    assert.equal(history.resolvedResidentAgentId, exportedPacket.resolvedResidentAgentId);
    assert(
      Array.isArray(history.history) &&
        history.history.some((entry) => entry?.evidenceRefId === exportedPacket.exportRecord?.evidenceRefId)
    );
    const exportedHistoryRecord =
      (Array.isArray(history.history) ? history.history : []).find(
        (entry) => entry?.evidenceRefId === exportedPacket.exportRecord?.evidenceRefId
      ) || null;
    assert.equal(exportedHistoryRecord?.physicalResidentAgentId, residentAgentId);
    assert.equal(exportedHistoryRecord?.residentAgentReference, exportedPacket.residentAgentReference);
    assert.equal(exportedHistoryRecord?.resolvedResidentAgentId, exportedPacket.resolvedResidentAgentId);
    assert.equal(exportedHistoryRecord?.summary, exportedPacket.operatorDecision?.summary);
  });
});

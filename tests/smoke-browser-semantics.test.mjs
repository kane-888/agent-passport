import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  summarizeBrowserUiSemantics,
} from "../scripts/smoke-all.mjs";
import { PUBLIC_RUNTIME_ENTRY_HREFS } from "../public/runtime-truth-client.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LAB_INVALID_TOKEN_GUARD = Object.freeze({
  authBlocked: true,
  blockedSurface: "/api/security/runtime-housekeeping",
  actionBlocked: true,
  lastReportPreserved: true,
});

const OPERATOR_INVALID_TOKEN_GUARD = Object.freeze({
  authBlocked: true,
  blockedSurface: "/api/device/setup",
  publicTruthRetained: true,
  exportDisabled: true,
});

const REPAIR_HUB_INVALID_TOKEN_GUARD = Object.freeze({
  authBlocked: true,
  blockedSurface: "repair-hub-protected-read",
  overviewCleared: true,
  listCleared: true,
});

const OFFLINE_CHAT_INVALID_TOKEN_GUARD = Object.freeze({
  authBlocked: true,
  blockedSurface: "offline-chat-protected-read",
  tokenRetained: true,
  statePreserved: true,
  sendDisabled: true,
  clearEnabled: true,
});
const PHYSICAL_MAIN_AGENT_PLACEHOLDER = "agent_physical_main";

function checkDetails(gate, checkName) {
  return gate.checks.find((entry) => entry.check === checkName)?.details || null;
}

test("browser smoke keeps public runtime truth reads unauthenticated", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts/smoke-browser.mjs"), "utf8");
  assert.match(source, /async function getJson\(path,\s*\{\s*allowAuthFallback\s*=\s*true\s*\}\s*=\s*\{\}\)/u);
  assert.match(source, /getJson\("\/api\/health",\s*\{\s*allowAuthFallback:\s*false\s*\}\)/u);
  assert.match(source, /getJson\("\/api\/security",\s*\{\s*allowAuthFallback:\s*false\s*\}\)/u);
  assert.match(source, /readBrowserJsonPath\(\s*"\/api\/security",\s*\{\s*publicRead:\s*true\s*\}/u);
  assert.match(source, /publicRead && protectedRead/u);
});

test("browser smoke offline-chat deeplink keeps canonical route ids separate from physical thread ids", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts/smoke-browser.mjs"), "utf8");
  const fixtureHelper = source.slice(
    source.indexOf("async function prepareOfflineChatDeepLinkFixture"),
    source.indexOf("function readStartupProtocolSignature")
  );
  const urlHelper = source.slice(
    source.indexOf("function buildOfflineChatDeepLinkUrl"),
    source.indexOf("async function detectBrowserAutomationMode")
  );
  const domHelper = source.slice(
    source.indexOf("async function runOfflineChatDeepLinkDom"),
    source.indexOf("async function runOfflineChatGroupDom")
  );

  assert.match(fixtureHelper, /routeThreadId/u);
  assert.doesNotMatch(fixtureHelper, /canonicalAgentId\s*\|\|\s*entry\?\.referenceAgentId/u);
  assert.match(urlHelper, /fixture\.routeThreadId\s*\|\|\s*fixture\.threadId/u);
  assert.match(domHelper, /encodeURIComponent\(fixture\.routeThreadId\s*\|\|\s*fixture\.threadId\)/u);
  assert.match(domHelper, /value\.activeThreadId === fixture\.threadId/u);
});

test("browser smoke repair hub self-heals legacy main-agent deep links onto canonical url state", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts/smoke-browser.mjs"), "utf8");
  const helper = source.slice(
    source.indexOf("async function runRepairHubDeepLink"),
    source.indexOf("async function runOperatorInvalidTokenCheck")
  );
  const mainFlow = source.slice(
    source.indexOf("const repairHubSummary = await runRepairHubDeepLink"),
    source.indexOf("const repairHubCompatSummary = await runRepairHubDeepLink")
  );

  assert.match(helper, /startAgentId\s*=\s*MAIN_AGENT_ID/u);
  assert.match(helper, /startIssuerAgentId\s*=\s*""/u);
  assert.match(helper, /expectLegacyMainAgentSelfHeal\s*=\s*false/u);
  assert.match(helper, /locationSearch:\s*window\.location\.search/u);
  assert.match(helper, /selectedAgentId:\s*new URL\(window\.location\.href\)\.searchParams\.get\("agentId"\)\s*\|\|\s*""/u);
  assert.match(helper, /selectedIssuerAgentId:\s*new URL\(window\.location\.href\)\.searchParams\.get\("issuerAgentId"\)\s*\|\|\s*""/u);
  assert.match(helper, /!value\.locationSearch\?\.includes\(LEGACY_MAIN_AGENT_ID\)/u);
  assert.match(helper, /value\.selectedAgentId === MAIN_AGENT_ID/u);
  assert.match(helper, /value\.selectedIssuerAgentId === MAIN_AGENT_ID/u);
  assert.match(mainFlow, /const repairHubLegacyCanonicalSummary = await runRepairHubDeepLink/u);
  assert.match(mainFlow, /startAgentId:\s*LEGACY_MAIN_AGENT_ID/u);
  assert.match(mainFlow, /startIssuerAgentId:\s*LEGACY_MAIN_AGENT_ID/u);
  assert.match(mainFlow, /expectLegacyMainAgentSelfHeal:\s*true/u);
});

test("repair hub keeps selection fail-closed when the filtered list or didMethod view changes", () => {
  const source = fs.readFileSync(path.join(rootDir, "public/repair-hub.html"), "utf8");
  assert.match(source, /if\s*\(!repairs\.length\)\s*\{\s*state\.selectedRepairId\s*=\s*null;\s*state\.selectedCredentialId\s*=\s*null;/u);
  assert.match(source, /const visibleCredentialIds = new Set\(/u);
  assert.match(source, /const currentDidMethod = text\(state\.filters\.didMethod, ""\);/u);
  assert.match(source, /const preferredVisibleCredential =\s*credentialItems\.find\(\(entry\) => \{/u);
  assert.match(source, /return currentDidMethod \? entryDidMethod === currentDidMethod : entryDidMethod === "agentpassport";/u);
  assert.match(
    source,
    /state\.selectedCredentialId =\s*preferredVisibleCredential\?\.credentialRecordId \|\| preferredVisibleCredential\?\.credentialId \|\| null;/u
  );
  assert.match(source, /if\s*\(!state\.selectedRepairId\)\s*\{\s*syncUrlState\(\);\s*return;\s*\}/u);
  assert.match(source, /state\.selectedCredentialId = button\.dataset\.siblingCredentialId;\s*await loadRepairDetail\(state\.selectedRepairId\);/u);
});

function buildStructuredOperatorExport({
  evidenceRefId = "evid_incident_packet_export_1",
  agentId = PHYSICAL_MAIN_AGENT_PLACEHOLDER,
  residentAgentReference = "agent_main",
  resolvedResidentAgentId = agentId,
} = {}) {
  const uri = "incident-packet://export/2026-04-16T00%3A00%3A00.000Z";
  return {
    exportStatus: `事故交接包已导出并留档：agent-passport-incident-packet-2026-04-16.zip / ${evidenceRefId}`,
    exportHistoryCount: 1,
    exportHistoryEntries: [
      {
        evidenceRefId,
        physicalResidentAgentId: agentId,
        residentAgentReference,
        resolvedResidentAgentId,
        effectivePhysicalResidentAgentId: agentId,
        effectiveResidentAgentReference: residentAgentReference,
        effectiveResolvedResidentAgentId: resolvedResidentAgentId,
        residentBindingMismatch: false,
        recordedAt: "2026-04-16T00:00:01.000Z",
        uri,
      },
    ],
    exportHistoryRecordIds: [evidenceRefId],
    exportHistoryUris: [uri],
    exportHistoryResidentAgentReferences: [residentAgentReference],
    exportHistoryResolvedResidentAgentIds: [resolvedResidentAgentId],
    exportHistoryEffectivePhysicalResidentAgentIds: [agentId],
    exportHistoryEffectiveResolvedResidentAgentIds: [resolvedResidentAgentId],
    exportHistoryResidentBindingMismatches: [false],
    exportRecord: {
      evidenceRefId,
      physicalResidentAgentId: agentId,
      agentId,
      residentAgentReference,
      resolvedResidentAgentId,
      title: "事故交接包导出",
      uri,
      recordedAt: "2026-04-16T00:00:01.000Z",
      tags: ["incident-packet-export", "operator", "security"],
    },
    apiExport: {
      sourceSurface: "/api/security/incident-packet/export",
      residentAgentId: agentId,
      residentAgentReference,
      resolvedResidentAgentId,
      exportedAt: "2026-04-16T00:00:00.000Z",
      exportCoverage: {
        protectedRead: true,
        residentAgentBound: true,
        includedSections: [
          "current_decision",
          "security_snapshot",
          "device_setup_snapshot",
          "agent_runtime_truth",
          "formal_recovery_handoff",
          "cross_device_gate",
          "security_anomalies",
          "auto_recovery_audits",
          "constrained_execution_audits",
        ],
        missingSections: [],
      },
      exportRecord: {
        evidenceRefId,
        agentId,
        residentAgentReference,
        resolvedResidentAgentId,
        kind: "note",
        title: "事故交接包导出",
        uri,
        tags: ["incident-packet-export", "operator", "security"],
      },
      historyResidentAgentId: agentId,
      historyResidentAgentReference: residentAgentReference,
      historyResolvedResidentAgentId: resolvedResidentAgentId,
      historyMatchedExportResidentAgentReference: true,
      historyMatchedExportResolvedResidentAgentId: true,
      historyMatchedExportRecord: true,
    },
    exportContents: [
      "当前判断、下一步和硬阻塞。",
      "当前安全姿态、正式恢复主线和交接最小信息集。",
      "agent 运行真值：本地优先策略、质量升级和记忆稳态信号。",
    ],
    exportContentsHasAgentRuntimeTruth: true,
  };
}

function buildStructuredRepairHubStatusCards({
  statusListId = "status_list_1",
  statusListIndex = "3",
  activeEntryId = "status_entry_credential_1",
} = {}) {
  return ["risk", "evidence", "action"].map((cardKind) => ({
    cardKind,
    tone: cardKind === "risk" ? "ready" : "neutral",
    riskState: "active",
    status: "active",
    registryKnown: "true",
    statusMatchesRegistry: "true",
    statusListId,
    statusListIndex,
    activeEntryId,
    missingDidMethodCount: "0",
  }));
}

function buildStructuredRepairHubTruthCard({
  visibleIssuedDidMethods = ["agentpassport"],
  allIssuedDidMethods = ["agentpassport", "openneed"],
  publicIssuedDidMethods = ["agentpassport"],
  compatibilityIssuedDidMethods = ["openneed"],
  visibleReceiptCount = 1,
  allReceiptCount = 2,
  publicIssuerDid = "did:agentpassport:agent_main",
  compatibilityIssuerDid = "did:openneed:agent_main",
  coverageSource = "after",
  totalSubjects = 1,
  completeSubjectCount = 1,
  publicComplete = true,
  repairComplete = false,
  repairCompleteSubjectCount = 0,
  repairPartialSubjectCount = 1,
  repairableSubjectCount = 1,
  publicMissingDidMethods = [],
  repairMissingDidMethods = ["openneed"],
} = {}) {
  return {
    visibleIssuedDidMethods,
    allIssuedDidMethods,
    publicIssuedDidMethods,
    compatibilityIssuedDidMethods,
    visibleReceiptCount,
    allReceiptCount,
    publicIssuerDid,
    compatibilityIssuerDid,
    coverageSource,
    totalSubjects,
    completeSubjectCount,
    publicComplete,
    repairComplete,
    repairCompleteSubjectCount,
    repairPartialSubjectCount,
    repairableSubjectCount,
    publicMissingDidMethods,
    repairMissingDidMethods,
  };
}

function buildStructuredRepairHubSummaryCards({
  repairVerdictState = "public_complete_backlog",
  repairImpactState = "coverage_truth",
  repairNextStepState = "finish_compatibility_backlog",
  totalSubjects = 1,
  currentViewCredentialCount = 1,
} = {}) {
  return [
    {
      summaryKind: "repair-verdict",
      tone: repairVerdictState === "repair_complete" ? "ready" : repairVerdictState === "public_incomplete" ? "warn" : "",
      repairVerdictState,
      repairImpactState: "",
      repairNextStepState: "",
      totalSubjects: 0,
      currentViewCredentialCount: 0,
      main: "",
      note: "",
    },
    {
      summaryKind: "repair-impact",
      tone: "",
      repairVerdictState: "",
      repairImpactState,
      repairNextStepState: "",
      totalSubjects,
      currentViewCredentialCount,
      main: "",
      note: "",
    },
    {
      summaryKind: "repair-next-step",
      tone: repairNextStepState === "finish_public_mainline" ? "warn" : "",
      repairVerdictState: "",
      repairImpactState: "",
      repairNextStepState,
      totalSubjects: 0,
      currentViewCredentialCount: 0,
      main: "",
      note: "",
    },
  ];
}

function buildStructuredRepairHubView({
  credentialRecordId = "credential_1",
  issuerDidMethod = "agentpassport",
  repairId = "repair_1",
  selectedDidMethodFilter = issuerDidMethod,
  visibleIssuedDidMethods = [issuerDidMethod],
  selectedRepairId = repairId,
  repairSummaryCards = buildStructuredRepairHubSummaryCards(),
  repairTruthCard = buildStructuredRepairHubTruthCard({
    visibleIssuedDidMethods,
  }),
} = {}) {
  return {
    tokenInputPresent: true,
    mainLinkHref: "http://127.0.0.1:4319/",
    selectedCredentialJsonLength: 120,
    selectedCredentialContainsId: true,
    selectedCredentialParsed: {
      ok: true,
      credentialRecordId,
      issuerDidMethod,
      repairId,
    },
    statusCards: buildStructuredRepairHubStatusCards(),
    repairSummaryCards,
    repairTruthCard,
    selectedDidMethodFilter,
    selectedRepairId,
  };
}

function buildStructuredIncidentPacketState(overrides = {}) {
  const boundaryAgentRuntime = {
    localFirst: true,
    policy: "记忆稳态引擎本地推理优先，本地答案不过关时再切联网增强。",
    onlineAllowed: true,
    qualityEscalationRuns: 1,
    latestQualityEscalationActivated: true,
    latestQualityEscalationProvider: "openai_compatible",
    latestQualityEscalationReason: "verification_invalid",
    memoryStabilityStateCount: 1,
    latestMemoryStabilityStateId: "memory_state_1",
    latestMemoryStabilityCorrectionLevel: "medium",
    latestMemoryStabilityRiskScore: 0.41,
    latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
    latestMemoryStabilityObservationKind: "correction_rebuild",
    latestMemoryStabilityRecoverySignal: "risk_rising",
    latestMemoryStabilityCorrectionActions: ["rewrite_working_memory_summary"],
    memoryStabilityRecoveryRate: 0,
  };
  return {
    status: 200,
    format: "agent-passport-incident-packet-v1",
    snapshotReleaseReadinessFailureSemantics: {
      status: "clear",
      failureCount: 0,
      primaryFailure: null,
      failures: [],
    },
    boundaryReleaseReadinessFailureSemantics: {
      status: "clear",
      failureCount: 0,
      primaryFailure: null,
      failures: [],
    },
    boundaryAutomaticRecoveryFailureSemantics: {
      status: "clear",
      failureCount: 0,
      primaryFailure: null,
      failures: [],
    },
    boundaryAgentRuntime,
    snapshotAgentRuntime: boundaryAgentRuntime,
    ...overrides,
  };
}

function buildStructuredOperatorTruthState(overrides = {}) {
  return {
    authSummary: "已保存管理令牌",
    protectedStatus: "已读取受保护恢复真值",
    agentRuntimeTitle: "本地优先已启用 / 最近一次已触发质量升级",
    agentRuntimeDetailCount: 3,
    decisionCardCount: 4,
    exportDisabled: false,
    mainLinkHref: "http://127.0.0.1:4319/",
    ...overrides,
  };
}

test("browser-ui semantics accepts explicit truth, protection, and offline-chat visibility evidence", () => {
  const gate = summarizeBrowserUiSemantics(
    [
      {
        name: "smoke:browser",
        result: {
          baseUrl: "http://127.0.0.1:4319",
          repairId: "repair_1",
          credentialId: "credential_1",
          mainSummary: {
            runtimeTruthReady: true,
            runtimeTruthMissingFields: [],
            loadState: "loaded",
            homeSummary: "公开运行态已加载",
            healthSummary: "服务可达",
            recoverySummary: "恢复窗口仍在安全期",
            automationSummary: "自动恢复仍在值班边界内",
            runtimeLinks: PUBLIC_RUNTIME_ENTRY_HREFS,
            repairHubHref: "/repair-hub",
          },
          labSummary: {
            labTruthReady: true,
            labTruthMissingFields: [],
            summary: "已读取公开安全与恢复边界",
            localStoreDetails: ["状态：已受保护", "系统保护：已启用", "恢复基线：已就绪"],
            formalRecoveryDetails: ["状态：已就绪", "下一步：演练", "周期：窗口内"],
            automaticRecoveryDetails: ["状态：有界放行", "正式恢复已达标：是", "值班边界：已配置"],
            apiSecurityTruth: {
              status: 200,
              authorized: false,
              releaseReadinessFailureSemantics: {
                status: "clear",
                failureCount: 0,
                primaryFailure: null,
                failures: [],
              },
              automaticRecoveryFailureSemantics: {
                status: "clear",
                failureCount: 0,
                primaryFailure: null,
                failures: [],
              },
            },
          },
          labInvalidTokenSummary: {
            authSummary: "当前标签页里的管理令牌无法调用 /api/security/runtime-housekeeping，请重新录入",
            status: "这次操作没有成功",
            resultText: "/api/security/runtime-housekeeping",
            lastReport: "当前标签页还没有成功维护记录",
            guard: LAB_INVALID_TOKEN_GUARD,
          },
          operatorSummary: {
            operatorTruthReady: true,
            operatorTruthMissingFields: [],
            truthState: buildStructuredOperatorTruthState(),
            exportState: buildStructuredOperatorExport(),
            incidentPacketState: buildStructuredIncidentPacketState(),
          },
          operatorInvalidTokenSummary: {
            authSummary: "当前标签页里的管理令牌无法读取 /api/device/setup，请重新录入",
            protectedStatus: "继续显示公开真值",
            exportStatus: "当前不能导出",
            exportDisabled: true,
            guard: OPERATOR_INVALID_TOKEN_GUARD,
          },
          repairHubSummary: buildStructuredRepairHubView(),
          repairHubLegacyCanonicalSummary: {
            locationSearch: "?repairId=repair_1&didMethod=agentpassport",
            selectedAgentId: "",
            selectedIssuerAgentId: "",
            selectedDidMethodFilter: "agentpassport",
            selectedRepairId: "repair_1",
          },
          compatCredentialId: "credential_compat_1",
          repairHubCompatSummary: buildStructuredRepairHubView({
            credentialRecordId: "credential_compat_1",
            issuerDidMethod: "openneed",
            selectedDidMethodFilter: "openneed",
            visibleIssuedDidMethods: ["openneed"],
          }),
          repairHubInvalidTokenSummary: {
            authSummary: "当前标签页里的管理令牌无法读取，请重新录入",
            overview: "当前标签页里的管理令牌无法读取",
            listEmpty: "当前标签页里的管理令牌无法读取",
            guard: REPAIR_HUB_INVALID_TOKEN_GUARD,
          },
          offlineChatInvalidTokenSummary: {
            authSummary: "请重新录入。本页保留当前令牌和已加载运行信息。",
            threadTitle: "离线线程",
            threadDescription: "没有可用线程。",
            threadContextSummary: "当前没有可用线程。",
            dispatchHistorySummary: "当前没有可用线程。",
            notice: "本页保留当前令牌和已加载运行信息。",
            syncStatus: "本页保留当前令牌和已加载运行信息。",
            sendDisabled: true,
            clearDisabled: false,
            guard: OFFLINE_CHAT_INVALID_TOKEN_GUARD,
          },
          offlineChatFixture: {
            threadId: "thread_direct_1",
            threadLabel: "沈知远",
            bootstrapThreadIds: ["group", "thread_direct_1"],
            sourceProvider: "passport_fast_memory",
            filteredAssistantMessageIds: ["pmem_direct_1:assistant"],
          },
          offlineChatSummary: {
            activeThreadId: "thread_direct_1",
            activeSourceFilter: "passport_fast_memory",
            threadTitle: "与沈知远",
            dispatchHistoryHidden: true,
            assistantSourceCount: 1,
            assistantDispatchCount: 0,
            assistantMessageIds: ["pmem_direct_1:assistant"],
            assistantSourceProviders: ["passport_fast_memory"],
            assistantSourceTexts: ["共享记忆快答 · 本地参考层快答 · shared-memory-fast-path"],
            assistantDispatchTexts: [],
          },
          offlineChatGroupFixture: {
            threadId: "group",
            seedRecordId: "pmem_group_1",
            protocolTitle: "自治协作协议 v1",
            protocolSummary: "自动 fan-out",
            participantNames: ["设计体验", "后端平台"],
            startupTruth: {
              bootstrapMatchesThreadStartup: true,
              historyMatchesThreadStartup: true,
              seedMatchesThreadStartup: true,
              protocolRecordIdConsistent: true,
              protocolRecordId: "protocol_1",
              protocolKey: "agent_passport_runtime",
              protocolVersion: "v1",
            },
          },
          offlineChatGroupSummary: {
            activeThreadId: "group",
            threadContextSummary: "自治协作协议 v1 自动 fan-out",
            sourceFilterSummary: "当前共有 3 条回复。当前显示全部回复。",
            threadContextNames: ["设计体验", "后端平台", "协作公约", "最近执行"],
            dispatchHistoryHidden: false,
            dispatchHistoryCount: 2,
            dispatchHistoryRecordIds: ["pmem_group_1", "pmem_group_0"],
            firstDispatchRecordId: "pmem_group_1",
            firstDispatchParallelBatchCount: "1",
            firstParallelChip: "并行批次 1",
            assistantSourceCount: 3,
            assistantDispatchCount: 2,
            assistantMessageIds: ["pmem_group_1:designer", "pmem_group_1:backend", "pmem_group_0:protocol"],
            assistantDispatchBatches: ["merge"],
            assistantDispatchModes: ["parallel", "serial"],
            assistantSourceTexts: [
              "本地命令回答引擎 · 自定义本地命令",
              "共享记忆快答 · 本地参考层快答 · shared-memory-fast-path",
              "线程协议运行时 · agent_passport_runtime:v1",
            ],
            assistantDispatchTexts: ["fan-out 第2批 · 并行", "fan-out 收口批 · 串行"],
            policyCardMeta: "当前线程启动配置",
            policyCardGoal: "自治协作协议 v1 自动 fan-out",
            executionCardMeta: "最近一轮调度结果",
            executionCardGoal: "最近一轮 fan-out：完成 1/1 批。",
            directState: {
              dispatchHistoryHidden: true,
            },
            refreshedState: {
              dispatchHistoryHidden: false,
              firstDispatchRecordId: "pmem_group_2",
              firstDispatchBody: "刷新后的并行批次",
              policyCardGoal: "自治协作协议 v1 自动 fan-out",
              executionCardGoal: "最近一轮 fan-out：完成 1/1 批。",
            },
          },
        },
      },
    ],
    { browserSkipped: false }
  );

  assert.equal(gate.status, "passed");
  assert.equal(gate.passedChecks, 14);
  assert.deepEqual(gate.failedChecks, []);
  assert.deepEqual(checkDetails(gate, "browser_runtime_home_truth_semantics")?.runtimeTruthMissingFields, []);
  assert.equal(checkDetails(gate, "browser_lab_failure_semantics_truth_chain")?.releaseStatus, "clear");
  assert.equal(checkDetails(gate, "browser_lab_failure_semantics_truth_chain")?.automaticStatus, "clear");
  assert.equal(checkDetails(gate, "browser_operator_truth_and_export_semantics")?.exportRecordId, "evid_incident_packet_export_1");
  assert.equal(checkDetails(gate, "browser_operator_truth_and_export_semantics")?.historyMatchedExportRecord, true);
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.uiMatchedExportResidentBindingMismatch,
    false
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.uiMatchedExportEffectivePhysicalResidentAgentId,
    PHYSICAL_MAIN_AGENT_PLACEHOLDER
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.uiMatchedExportEffectiveResolvedResidentAgentId,
    PHYSICAL_MAIN_AGENT_PLACEHOLDER
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.residentAgentReference,
    "agent_main"
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.resolvedResidentAgentId,
    PHYSICAL_MAIN_AGENT_PLACEHOLDER
  );
  assert.equal(checkDetails(gate, "browser_operator_incident_packet_truth_semantics")?.boundaryAutomaticStatus, "clear");
  assert.equal(
    checkDetails(gate, "browser_operator_incident_packet_truth_semantics")?.boundaryAgentRuntimeLocalFirst,
    true
  );
  assert.equal(
    checkDetails(gate, "browser_repair_hub_semantics")?.selectedCredentialParsed?.credentialRecordId,
    "credential_1"
  );
  assert.deepEqual(
    checkDetails(gate, "browser_offline_chat_deeplink_semantics")?.expectedAssistantMessageIds,
    ["pmem_direct_1:assistant"]
  );
  assert.deepEqual(
    checkDetails(gate, "browser_offline_chat_group_dispatch_semantics")?.assistantDispatchBatches,
    ["merge"]
  );
});

test("browser-ui semantics fails when runtime home truth is missing despite fallback copy", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        mainSummary: {
          runtimeTruthReady: false,
          runtimeTruthMissingFields: ["formalRecovery.summary"],
          loadState: "loaded",
          homeSummary: "公开运行态已加载",
          healthSummary: "服务可达",
          recoverySummary: "尚未读取正式恢复状态。",
          automationSummary: "自动恢复仍在值班边界内",
          runtimeLinks: PUBLIC_RUNTIME_ENTRY_HREFS,
          repairHubHref: "/repair-hub",
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_runtime_home_truth_semantics"));
  assert.deepEqual(
    gate.checks.find((entry) => entry.check === "browser_runtime_home_truth_semantics")?.details.runtimeTruthMissingFields,
    ["formalRecovery.summary"]
  );
});

test("browser-ui semantics fails when lab or operator truth relies on fallback copy", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        credentialId: "credential_1",
        mainSummary: {
          runtimeTruthReady: true,
          runtimeTruthMissingFields: [],
          loadState: "loaded",
          homeSummary: "公开运行态已加载",
          healthSummary: "服务可达",
          recoverySummary: "恢复窗口仍在安全期",
          automationSummary: "自动恢复仍在值班边界内",
          runtimeLinks: PUBLIC_RUNTIME_ENTRY_HREFS,
          repairHubHref: "/repair-hub",
        },
        labSummary: {
          labTruthReady: false,
          labTruthMissingFields: ["formalRecovery.summary"],
          summary: "已读取公开安全与恢复边界",
          localStoreDetails: ["状态：已受保护", "系统保护：已启用", "恢复基线：已就绪"],
          formalRecoveryDetails: ["状态：已就绪", "下一步：当前没有正式恢复摘要。", "周期：窗口内"],
          automaticRecoveryDetails: ["状态：有界放行", "正式恢复已达标：是", "值班边界：已配置"],
        },
        operatorSummary: {
          operatorTruthReady: false,
          operatorTruthMissingFields: ["operatorHandbook.summary"],
          truthState: buildStructuredOperatorTruthState(),
          exportState: buildStructuredOperatorExport(),
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_lab_truth_semantics"));
  assert(gate.failedChecks.includes("browser_operator_truth_and_export_semantics"));
});

test("browser-ui semantics fails when repair hub selected credential JSON is not the linked record", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        repairId: "repair_1",
        credentialId: "credential_1",
        repairHubSummary: {
          tokenInputPresent: true,
          mainLinkHref: "http://127.0.0.1:4319/",
          selectedCredentialJsonLength: 120,
          selectedCredentialContainsId: true,
          selectedCredentialParsed: {
            ok: true,
            credentialRecordId: "credential_2",
            issuerDidMethod: "agentpassport",
            repairId: "repair_1",
          },
          statusCards: buildStructuredRepairHubStatusCards(),
          repairSummaryCards: buildStructuredRepairHubSummaryCards(),
          repairTruthCard: buildStructuredRepairHubTruthCard(),
          selectedRepairId: "repair_1",
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_repair_hub_semantics"));
  assert.deepEqual(
    gate.checks.find((entry) => entry.check === "browser_repair_hub_semantics")?.details.selectedCredentialParsed,
    {
      ok: true,
      credentialRecordId: "credential_2",
      issuerDidMethod: "agentpassport",
      repairId: "repair_1",
    }
  );
});

test("browser-ui semantics fails when repair hub canonical deep link resolves onto a legacy compatibility credential", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        repairId: "repair_1",
        credentialId: "credential_1",
        repairHubSummary: {
          tokenInputPresent: true,
          mainLinkHref: "http://127.0.0.1:4319/",
          selectedCredentialJsonLength: 120,
          selectedCredentialContainsId: true,
          selectedCredentialParsed: {
            ok: true,
            credentialRecordId: "credential_1",
            issuerDidMethod: "openneed",
            repairId: "repair_1",
          },
          statusCards: buildStructuredRepairHubStatusCards(),
          repairSummaryCards: buildStructuredRepairHubSummaryCards(),
          repairTruthCard: buildStructuredRepairHubTruthCard(),
          selectedRepairId: "repair_1",
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_repair_hub_semantics"));
  assert.deepEqual(
    gate.checks.find((entry) => entry.check === "browser_repair_hub_semantics")?.details.selectedCredentialParsed,
    {
      ok: true,
      credentialRecordId: "credential_1",
      issuerDidMethod: "openneed",
      repairId: "repair_1",
    }
  );
});

test("browser-ui semantics fails when repair hub status cards are not machine-readable", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        repairId: "repair_1",
        credentialId: "credential_1",
        repairHubSummary: {
          tokenInputPresent: true,
          mainLinkHref: "http://127.0.0.1:4319/",
          selectedCredentialJsonLength: 120,
          selectedCredentialContainsId: true,
          selectedCredentialParsed: {
            ok: true,
            credentialRecordId: "credential_1",
            issuerDidMethod: "agentpassport",
            repairId: "repair_1",
          },
          repairSummaryCards: buildStructuredRepairHubSummaryCards(),
          repairTruthCard: buildStructuredRepairHubTruthCard(),
          statusCards: [
            {
              cardKind: "risk",
              tone: "ready",
              riskState: "active",
              statusListId: "",
              statusListIndex: "",
              activeEntryId: "",
            },
          ],
          selectedRepairId: "repair_1",
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_repair_hub_semantics"));
  assert.deepEqual(
    gate.checks.find((entry) => entry.check === "browser_repair_hub_semantics")?.details.statusCards,
    [
      {
        cardKind: "risk",
        tone: "ready",
        riskState: "active",
        statusListId: "",
        statusListIndex: "",
        activeEntryId: "",
      },
    ]
  );
});

test("browser-ui semantics fails when repair hub truth card flattens filtered and full repair views together", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        repairId: "repair_1",
        credentialId: "credential_1",
        repairHubSummary: {
          tokenInputPresent: true,
          mainLinkHref: "http://127.0.0.1:4319/",
          selectedCredentialJsonLength: 120,
          selectedCredentialContainsId: true,
          selectedCredentialParsed: {
            ok: true,
            credentialRecordId: "credential_1",
            issuerDidMethod: "agentpassport",
            repairId: "repair_1",
          },
          statusCards: buildStructuredRepairHubStatusCards(),
          repairSummaryCards: buildStructuredRepairHubSummaryCards(),
          repairTruthCard: buildStructuredRepairHubTruthCard({
            visibleIssuedDidMethods: ["agentpassport", "openneed"],
            allIssuedDidMethods: ["agentpassport", "openneed"],
            visibleReceiptCount: 2,
            allReceiptCount: 2,
          }),
          selectedRepairId: "repair_1",
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_repair_hub_semantics"));
  assert.deepEqual(
    gate.checks.find((entry) => entry.check === "browser_repair_hub_semantics")?.details.repairTruthCard,
    buildStructuredRepairHubTruthCard({
      visibleIssuedDidMethods: ["agentpassport", "openneed"],
      allIssuedDidMethods: ["agentpassport", "openneed"],
      visibleReceiptCount: 2,
      allReceiptCount: 2,
    })
  );
});

test("browser-ui semantics fails when repair hub summary treats compat backlog as public-mainline unfinished", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        repairId: "repair_1",
        credentialId: "credential_1",
        repairHubSummary: {
          tokenInputPresent: true,
          mainLinkHref: "http://127.0.0.1:4319/",
          selectedCredentialJsonLength: 120,
          selectedCredentialContainsId: true,
          selectedCredentialParsed: {
            ok: true,
            credentialRecordId: "credential_1",
            issuerDidMethod: "agentpassport",
            repairId: "repair_1",
          },
          statusCards: buildStructuredRepairHubStatusCards(),
          repairSummaryCards: buildStructuredRepairHubSummaryCards({
            repairVerdictState: "public_incomplete",
            repairNextStepState: "finish_public_mainline",
          }),
          repairTruthCard: buildStructuredRepairHubTruthCard({
            publicComplete: true,
            repairComplete: false,
            publicMissingDidMethods: [],
            repairMissingDidMethods: ["openneed"],
          }),
          selectedRepairId: "repair_1",
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_repair_hub_semantics"));
  assert.deepEqual(
    gate.checks.find((entry) => entry.check === "browser_repair_hub_semantics")?.details.repairSummaryCards,
    buildStructuredRepairHubSummaryCards({
      repairVerdictState: "public_incomplete",
      repairNextStepState: "finish_public_mainline",
    })
  );
});

test("browser-ui semantics fails when repair hub summary still claims backlog work after full repair completion", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        repairId: "repair_1",
        credentialId: "credential_1",
        repairHubSummary: {
          tokenInputPresent: true,
          mainLinkHref: "http://127.0.0.1:4319/",
          selectedCredentialJsonLength: 120,
          selectedCredentialContainsId: true,
          selectedCredentialParsed: {
            ok: true,
            credentialRecordId: "credential_1",
            issuerDidMethod: "agentpassport",
            repairId: "repair_1",
          },
          statusCards: buildStructuredRepairHubStatusCards(),
          repairSummaryCards: buildStructuredRepairHubSummaryCards({
            repairVerdictState: "public_complete_backlog",
            repairNextStepState: "finish_compatibility_backlog",
          }),
          repairTruthCard: buildStructuredRepairHubTruthCard({
            totalSubjects: 1,
            completeSubjectCount: 1,
            publicComplete: true,
            repairComplete: true,
            repairCompleteSubjectCount: 1,
            repairPartialSubjectCount: 0,
            repairableSubjectCount: 0,
            publicMissingDidMethods: [],
            repairMissingDidMethods: [],
          }),
          selectedRepairId: "repair_1",
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_repair_hub_semantics"));
  assert.deepEqual(
    gate.checks.find((entry) => entry.check === "browser_repair_hub_semantics")?.details.repairTruthCard,
    buildStructuredRepairHubTruthCard({
      totalSubjects: 1,
      completeSubjectCount: 1,
      publicComplete: true,
      repairComplete: true,
      repairCompleteSubjectCount: 1,
      repairPartialSubjectCount: 0,
      repairableSubjectCount: 0,
      publicMissingDidMethods: [],
      repairMissingDidMethods: [],
    })
  );
});

test("browser-ui semantics fails when repair hub compat view drifts into a second repair truth", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        repairId: "repair_1",
        credentialId: "credential_1",
        compatCredentialId: "credential_compat_1",
        repairHubSummary: buildStructuredRepairHubView(),
        repairHubCompatSummary: buildStructuredRepairHubView({
          credentialRecordId: "credential_compat_1",
          issuerDidMethod: "openneed",
          selectedDidMethodFilter: "openneed",
          visibleIssuedDidMethods: ["openneed"],
          repairSummaryCards: buildStructuredRepairHubSummaryCards({
            repairVerdictState: "public_incomplete",
            repairNextStepState: "finish_public_mainline",
          }),
          repairTruthCard: buildStructuredRepairHubTruthCard({
            visibleIssuedDidMethods: ["openneed"],
            publicComplete: true,
            repairComplete: false,
            publicMissingDidMethods: [],
            repairMissingDidMethods: ["openneed"],
          }),
        }),
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_repair_hub_compat_semantics"));
  assert.equal(
    gate.failedChecks.includes("browser_repair_hub_semantics"),
    false
  );
  assert.equal(
    gate.checks.find((entry) => entry.check === "browser_repair_hub_compat_semantics")?.details.repairHubCompatSummary?.selectedCredentialParsed?.issuerDidMethod,
    "openneed"
  );
});

test("browser-ui semantics fails when operator export state is flattened onto operator summary", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportStatus: "事故交接包已导出并留档：agent-passport-incident-packet-2026.zip",
          exportHistoryCount: 1,
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_truth_and_export_semantics"));
});

test("browser-ui semantics fails when operator agent runtime card is missing from captured truth", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState({
            agentRuntimeTitle: "",
            agentRuntimeDetailCount: 0,
            decisionCardCount: 3,
          }),
          exportState: buildStructuredOperatorExport(),
          incidentPacketState: buildStructuredIncidentPacketState(),
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_truth_and_export_semantics"));
  assert.equal(
    gate.checks.find((entry) => entry.check === "browser_operator_truth_and_export_semantics")?.details.agentRuntimeTitle,
    ""
  );
});

test("browser-ui semantics fails when operator export lacks structured record evidence", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState: {
            ...buildStructuredOperatorExport(),
            apiExport: {
              ...buildStructuredOperatorExport().apiExport,
              exportRecord: null,
            },
          },
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_truth_and_export_semantics"));
});

test("browser-ui semantics fails when operator UI history is not bound to export record", () => {
  const exportState = buildStructuredOperatorExport();
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState: {
            ...exportState,
            exportHistoryRecordIds: ["evid_other_export"],
            exportHistoryEntries: exportState.exportHistoryEntries.map((entry) => ({
              ...entry,
              evidenceRefId: "evid_other_export",
            })),
          },
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_truth_and_export_semantics"));
});

test("browser-ui semantics fails when operator export coverage or history binding drifts", () => {
  const exportState = buildStructuredOperatorExport();
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState: {
            ...exportState,
            apiExport: {
              ...exportState.apiExport,
              exportCoverage: {
                ...exportState.apiExport.exportCoverage,
                missingSections: ["resident_agent_binding"],
              },
              historyMatchedExportRecord: false,
            },
          },
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_truth_and_export_semantics"));
});

test("browser-ui semantics fails when operator export drops canonical or resolved resident metadata", () => {
  const exportState = buildStructuredOperatorExport();
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState: {
            ...exportState,
            exportHistoryEntries: exportState.exportHistoryEntries.map((entry) => ({
              ...entry,
              residentAgentReference: "agent_other",
            })),
            apiExport: {
              ...exportState.apiExport,
              historyResidentAgentReference: null,
            },
          },
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_truth_and_export_semantics"));
});

test("browser-ui semantics fails when operator UI resident binding drifts on the matched export card only", () => {
  const exportState = buildStructuredOperatorExport();
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState: {
            ...exportState,
            exportHistoryResidentAgentReferences: [
              exportState.apiExport.residentAgentReference,
              "agent_other",
            ],
            exportHistoryEntries: exportState.exportHistoryEntries.map((entry) => ({
              ...entry,
              residentAgentReference: "agent_other",
            })),
          },
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_truth_and_export_semantics"));
});

test("browser-ui semantics allows missing raw resolved resident ids when effective owner fields remain explicit", () => {
  const exportState = buildStructuredOperatorExport({
    resolvedResidentAgentId: "",
  });
  exportState.exportHistoryEntries = exportState.exportHistoryEntries.map((entry) => ({
    ...entry,
    resolvedResidentAgentId: "",
    effectiveResolvedResidentAgentId: PHYSICAL_MAIN_AGENT_PLACEHOLDER,
  }));
  exportState.exportHistoryResolvedResidentAgentIds = [];
  exportState.exportHistoryEffectiveResolvedResidentAgentIds = [PHYSICAL_MAIN_AGENT_PLACEHOLDER];
  exportState.exportRecord = {
    ...exportState.exportRecord,
    resolvedResidentAgentId: "",
  };
  exportState.apiExport = {
    ...exportState.apiExport,
    resolvedResidentAgentId: "",
    exportRecord: {
      ...exportState.apiExport.exportRecord,
      resolvedResidentAgentId: "",
    },
    historyResolvedResidentAgentId: "",
    historyMatchedExportResolvedResidentAgentId: true,
  };

  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState,
        },
      },
    },
  ]);

  assert.equal(
    gate.checks.find((entry) => entry.check === "browser_operator_truth_and_export_semantics")?.passed,
    true
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.uiMatchedExportResolvedResidentAgentId,
    ""
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.uiMatchedExportEffectiveResolvedResidentAgentId,
    PHYSICAL_MAIN_AGENT_PLACEHOLDER
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.uiMatchedExportEffectiveResolvedResidentAgentId,
    PHYSICAL_MAIN_AGENT_PLACEHOLDER
  );
});

test("browser-ui semantics accepts null raw resolved resident ids from the API when UI keeps effective owner truth explicit", () => {
  const exportState = buildStructuredOperatorExport();
  exportState.exportHistoryEntries = exportState.exportHistoryEntries.map((entry) => ({
    ...entry,
    resolvedResidentAgentId: "",
    effectiveResolvedResidentAgentId: PHYSICAL_MAIN_AGENT_PLACEHOLDER,
  }));
  exportState.exportHistoryResolvedResidentAgentIds = [];
  exportState.exportHistoryEffectiveResolvedResidentAgentIds = [PHYSICAL_MAIN_AGENT_PLACEHOLDER];
  exportState.exportRecord = {
    ...exportState.exportRecord,
    resolvedResidentAgentId: "",
  };
  exportState.apiExport = {
    ...exportState.apiExport,
    resolvedResidentAgentId: null,
    exportRecord: {
      ...exportState.apiExport.exportRecord,
      resolvedResidentAgentId: null,
    },
    historyResolvedResidentAgentId: null,
    historyMatchedExportResolvedResidentAgentId: true,
  };

  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState,
        },
      },
    },
  ]);

  assert.equal(
    gate.checks.find((entry) => entry.check === "browser_operator_truth_and_export_semantics")?.passed,
    true
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.resolvedResidentAgentId,
    null
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.historyResolvedResidentAgentId,
    null
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.uiMatchedExportResolvedResidentAgentId,
    ""
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.uiMatchedExportEffectiveResolvedResidentAgentId,
    PHYSICAL_MAIN_AGENT_PLACEHOLDER
  );
});

test("browser-ui semantics fails when operator UI backfills missing raw resolved resident ids from physical owner", () => {
  const exportState = buildStructuredOperatorExport({
    resolvedResidentAgentId: "",
  });
  exportState.exportHistoryEntries = exportState.exportHistoryEntries.map((entry) => ({
    ...entry,
    resolvedResidentAgentId: PHYSICAL_MAIN_AGENT_PLACEHOLDER,
    effectiveResolvedResidentAgentId: PHYSICAL_MAIN_AGENT_PLACEHOLDER,
  }));
  exportState.exportHistoryResolvedResidentAgentIds = [PHYSICAL_MAIN_AGENT_PLACEHOLDER];
  exportState.exportHistoryEffectiveResolvedResidentAgentIds = [PHYSICAL_MAIN_AGENT_PLACEHOLDER];
  exportState.exportRecord = {
    ...exportState.exportRecord,
    resolvedResidentAgentId: "",
  };
  exportState.apiExport = {
    ...exportState.apiExport,
    resolvedResidentAgentId: "",
    exportRecord: {
      ...exportState.apiExport.exportRecord,
      resolvedResidentAgentId: "",
    },
    historyResolvedResidentAgentId: "",
    historyMatchedExportResolvedResidentAgentId: true,
  };

  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState,
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_truth_and_export_semantics"));
});

test("browser-ui semantics fails when operator UI marks the matched export card as a resident-binding mismatch", () => {
  const exportState = buildStructuredOperatorExport();
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState: {
            ...exportState,
            exportHistoryEntries: exportState.exportHistoryEntries.map((entry) => ({
              ...entry,
              residentBindingMismatch: true,
            })),
            exportHistoryResidentBindingMismatches: [true],
          },
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_truth_and_export_semantics"));
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.uiMatchedExportResidentBindingMismatch,
    true
  );
  assert.equal(
    checkDetails(gate, "browser_operator_truth_and_export_semantics")?.uiMatchedExportRecord?.residentBindingMismatch,
    true
  );
});

test("browser-ui semantics fails when operator incident packet boundary truth is missing", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState: buildStructuredOperatorExport(),
          incidentPacketState: buildStructuredIncidentPacketState({
            boundaryAgentRuntime: null,
          }),
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_incident_packet_truth_semantics"));
  assert.equal(
    gate.checks.find((entry) => entry.check === "browser_operator_incident_packet_truth_semantics")?.details.boundaryAgentRuntimeLocalFirst,
    null
  );
});

test("browser-ui semantics keeps operator incident-packet negative failure envelopes machine-readable", () => {
  const boundaryAutomaticFailureSemantics = {
    status: "present",
    failureCount: 1,
    primaryFailure: {
      code: "resident_binding_mismatch",
      category: "binding",
      boundary: "automatic_recovery",
      severity: "high",
      machineAction: "block_auto_recovery",
      operatorAction: "inspect_resident_binding",
      sourceType: "operator_packet",
      sourceValue: "incident_packet_boundary",
    },
    failures: [
      {
        code: "resident_binding_mismatch",
        category: "binding",
        boundary: "automatic_recovery",
        severity: "high",
        machineAction: "block_auto_recovery",
        operatorAction: "inspect_resident_binding",
        sourceType: "operator_packet",
        sourceValue: "incident_packet_boundary",
      },
    ],
  };
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState: buildStructuredOperatorExport(),
          incidentPacketState: buildStructuredIncidentPacketState({
            boundaryAutomaticRecoveryFailureSemantics: boundaryAutomaticFailureSemantics,
          }),
        },
      },
    },
  ]);

  assert.equal(
    gate.checks.find((entry) => entry.check === "browser_operator_incident_packet_truth_semantics")?.passed,
    true
  );
  assert.deepEqual(
    checkDetails(gate, "browser_operator_incident_packet_truth_semantics")?.boundaryAutomaticFailureSemantics,
    boundaryAutomaticFailureSemantics
  );
});

test("browser-ui semantics fails when operator incident packet agent runtime semantics are incomplete", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: buildStructuredOperatorTruthState(),
          exportState: buildStructuredOperatorExport(),
          incidentPacketState: buildStructuredIncidentPacketState({
            boundaryAgentRuntime: {
              localFirst: true,
              policy: "记忆稳态引擎本地推理优先，本地答案不过关时再切联网增强。",
              onlineAllowed: true,
              qualityEscalationRuns: 1,
              latestQualityEscalationActivated: true,
              latestQualityEscalationProvider: "openai_compatible",
              latestQualityEscalationReason: "verification_invalid",
              memoryStabilityStateCount: 1,
              latestMemoryStabilityStateId: "memory_state_1",
              latestMemoryStabilityCorrectionLevel: "medium",
              latestMemoryStabilityRiskScore: 0.41,
              latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
              latestMemoryStabilityObservationKind: "",
              latestMemoryStabilityRecoverySignal: "",
              latestMemoryStabilityCorrectionActions: [],
              memoryStabilityRecoveryRate: null,
            },
          }),
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_incident_packet_truth_semantics"));
  assert.equal(
    gate.checks.find((entry) => entry.check === "browser_operator_incident_packet_truth_semantics")?.details.boundaryAgentRuntimeLatestMemoryStabilityObservationKind,
    ""
  );
});

test("browser-ui semantics skips cleanly when browser gate is intentionally disabled", () => {
  const gate = summarizeBrowserUiSemantics([], { browserSkipped: true });

  assert.equal(gate.status, "skipped");
  assert.equal(gate.totalChecks, 0);
  assert.equal(gate.passedChecks, 0);
  assert.deepEqual(gate.failedChecks, []);
});

test("browser-ui semantics fails when offline-chat deeplink bootstrap thread list contains duplicates", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        credentialId: "credential_1",
        mainSummary: {
          loadState: "loaded",
          homeSummary: "公开运行态已加载",
          healthSummary: "服务可达",
          recoverySummary: "恢复窗口仍在安全期",
          automationSummary: "自动恢复仍在值班边界内",
          runtimeLinks: PUBLIC_RUNTIME_ENTRY_HREFS,
          repairHubHref: "/repair-hub",
        },
        labSummary: {
          summary: "已读取公开安全与恢复边界",
          localStoreDetails: ["状态：已受保护", "系统保护：已启用", "恢复基线：已就绪"],
          formalRecoveryDetails: ["状态：已就绪", "下一步：演练", "周期：窗口内"],
          automaticRecoveryDetails: ["状态：有界放行", "正式恢复已达标：是", "值班边界：已配置"],
          apiSecurityTruth: {
            status: 200,
            authorized: false,
            releaseReadinessFailureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
            automaticRecoveryFailureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
        },
        labInvalidTokenSummary: {
          authSummary: "当前标签页里的管理令牌无法调用 /api/security/runtime-housekeeping，请重新录入",
          status: "这次操作没有成功",
          resultText: "/api/security/runtime-housekeeping",
          lastReport: "当前标签页还没有成功维护记录",
          guard: LAB_INVALID_TOKEN_GUARD,
        },
        operatorSummary: {
          truthState: buildStructuredOperatorTruthState(),
          exportState: {
            exportStatus: "事故交接包已导出并留档：agent-passport-incident-packet-2026-04-16.zip",
            exportHistoryCount: 1,
          },
          incidentPacketState: buildStructuredIncidentPacketState(),
        },
        operatorInvalidTokenSummary: {
          authSummary: "当前标签页里的管理令牌无法读取 /api/device/setup，请重新录入",
          protectedStatus: "继续显示公开真值",
          exportStatus: "当前不能导出",
          exportDisabled: true,
          guard: OPERATOR_INVALID_TOKEN_GUARD,
        },
        repairHubSummary: {
          tokenInputPresent: true,
          mainLinkHref: "http://127.0.0.1:4319/",
          selectedCredentialJsonLength: 120,
          selectedCredentialContainsId: true,
          selectedCredentialParsed: {
            ok: true,
            credentialRecordId: "credential_1",
            issuerDidMethod: "agentpassport",
            repairId: "repair_1",
          },
          statusCards: buildStructuredRepairHubStatusCards(),
          repairSummaryCards: buildStructuredRepairHubSummaryCards(),
          repairTruthCard: buildStructuredRepairHubTruthCard(),
          selectedRepairId: "repair_1",
        },
        repairHubInvalidTokenSummary: {
          authSummary: "当前标签页里的管理令牌无法读取，请重新录入",
          overview: "当前标签页里的管理令牌无法读取",
          listEmpty: "当前标签页里的管理令牌无法读取",
          guard: REPAIR_HUB_INVALID_TOKEN_GUARD,
        },
        offlineChatInvalidTokenSummary: {
          authSummary: "请重新录入。本页保留当前令牌和已加载运行信息。",
          threadTitle: "离线线程",
          threadDescription: "没有可用线程。",
          threadContextSummary: "当前没有可用线程。",
          dispatchHistorySummary: "当前没有可用线程。",
          notice: "本页保留当前令牌和已加载运行信息。",
          syncStatus: "本页保留当前令牌和已加载运行信息。",
          sendDisabled: true,
          clearDisabled: false,
          guard: OFFLINE_CHAT_INVALID_TOKEN_GUARD,
        },
        offlineChatFixture: {
          threadId: "thread_direct_1",
          threadLabel: "沈知远",
          bootstrapThreadIds: ["group", "thread_direct_1", "thread_direct_1"],
          sourceProvider: "passport_fast_memory",
        },
        offlineChatSummary: {
          activeThreadId: "thread_direct_1",
          activeSourceFilter: "passport_fast_memory",
          threadTitle: "与沈知远",
          dispatchHistoryHidden: true,
          assistantSourceCount: 1,
          assistantDispatchCount: 0,
          assistantSourceTexts: ["共享记忆快答 · 本地参考层快答 · shared-memory-fast-path"],
          assistantDispatchTexts: [],
        },
        offlineChatGroupFixture: {
          threadId: "group",
          protocolTitle: "自治协作协议 v1",
          protocolSummary: "自动 fan-out",
          startupTruth: {
            bootstrapMatchesThreadStartup: true,
            historyMatchesThreadStartup: true,
            seedMatchesThreadStartup: true,
              protocolRecordIdConsistent: true,
              protocolRecordId: "protocol_1",
              protocolKey: "agent_passport_runtime",
              protocolVersion: "v1",
          },
        },
        offlineChatGroupSummary: {
          activeThreadId: "group",
          threadContextSummary: "自治协作协议 v1 自动 fan-out",
          dispatchHistoryHidden: false,
          dispatchHistoryCount: 2,
          firstParallelChip: "并行批次 1",
          assistantSourceCount: 3,
          assistantDispatchCount: 2,
          assistantSourceTexts: [
            "本地命令回答引擎 · 自定义本地命令",
            "共享记忆快答 · 本地参考层快答 · shared-memory-fast-path",
            "线程协议运行时 · agent_passport_runtime:v1",
          ],
          assistantDispatchTexts: ["fan-out 第2批 · 并行", "fan-out 收口批 · 串行"],
          policyCardMeta: "当前线程启动配置",
          policyCardGoal: "自治协作协议 v1 自动 fan-out",
          executionCardMeta: "最近一轮调度结果",
          executionCardGoal: "最近一轮 fan-out：完成 1/1 批。",
          directState: {
            dispatchHistoryHidden: true,
          },
          refreshedState: {
            dispatchHistoryHidden: false,
            firstDispatchBody: "刷新后的并行批次",
            policyCardGoal: "自治协作协议 v1 自动 fan-out",
            executionCardGoal: "最近一轮 fan-out：完成 1/1 批。",
          },
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_offline_chat_deeplink_semantics"));
});

test("browser-ui semantics fails when offline-chat group dispatch visibility regresses", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        credentialId: "credential_1",
        mainSummary: {
          loadState: "loaded",
          homeSummary: "ok",
          healthSummary: "ok",
          recoverySummary: "ok",
          automationSummary: "ok",
          runtimeLinks: PUBLIC_RUNTIME_ENTRY_HREFS,
          repairHubHref: "/repair-hub",
        },
        labSummary: {
          summary: "ok",
          localStoreDetails: ["a", "b", "c"],
          formalRecoveryDetails: ["a", "b", "c"],
          automaticRecoveryDetails: ["a", "b", "c"],
          apiSecurityTruth: {
            status: 200,
            authorized: false,
            releaseReadinessFailureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
            automaticRecoveryFailureSemantics: {
              status: "clear",
              failureCount: 0,
              primaryFailure: null,
              failures: [],
            },
          },
        },
        labInvalidTokenSummary: {
          authSummary: "请重新录入",
          status: "这次操作没有成功",
          resultText: "/api/security/runtime-housekeeping",
          lastReport: "还没有成功维护记录",
          guard: LAB_INVALID_TOKEN_GUARD,
        },
        operatorSummary: {
          truthState: buildStructuredOperatorTruthState(),
          exportStatus: "事故交接包已导出并留档：agent-passport-incident-packet-2026.zip",
          exportHistoryCount: 1,
          incidentPacketState: buildStructuredIncidentPacketState(),
        },
        operatorInvalidTokenSummary: {
          authSummary: "请重新录入",
          protectedStatus: "继续显示公开真值",
          exportStatus: "当前不能导出",
          exportDisabled: true,
          guard: OPERATOR_INVALID_TOKEN_GUARD,
        },
        repairHubSummary: {
          tokenInputPresent: true,
          mainLinkHref: "http://127.0.0.1:4319/",
          selectedCredentialJsonLength: 50,
          selectedCredentialContainsId: true,
            selectedCredentialParsed: {
              ok: true,
              credentialRecordId: "credential_1",
              issuerDidMethod: "agentpassport",
              repairId: null,
            },
            statusCards: buildStructuredRepairHubStatusCards(),
            repairSummaryCards: buildStructuredRepairHubSummaryCards(),
            repairTruthCard: buildStructuredRepairHubTruthCard(),
            selectedRepairId: null,
          },
        repairId: null,
        repairHubInvalidTokenSummary: {
          authSummary: "请重新录入",
          overview: "当前标签页里的管理令牌无法读取",
          listEmpty: "当前标签页里的管理令牌无法读取",
          guard: REPAIR_HUB_INVALID_TOKEN_GUARD,
        },
        offlineChatInvalidTokenSummary: {
          authSummary: "请重新录入。本页保留当前令牌和已加载运行信息。",
          threadTitle: "离线线程",
          threadDescription: "没有可用线程。",
          threadContextSummary: "当前没有可用线程。",
          dispatchHistorySummary: "当前没有可用线程。",
          notice: "本页保留当前令牌和已加载运行信息。",
          syncStatus: "本页保留当前令牌和已加载运行信息。",
          sendDisabled: true,
          clearDisabled: false,
          guard: OFFLINE_CHAT_INVALID_TOKEN_GUARD,
        },
        offlineChatFixture: {
          threadId: "thread_direct_1",
          threadLabel: "沈知远",
          bootstrapThreadIds: ["group", "thread_direct_1"],
          sourceProvider: "passport_fast_memory",
        },
        offlineChatSummary: {
          activeThreadId: "thread_direct_1",
          activeSourceFilter: "passport_fast_memory",
          threadTitle: "与沈知远",
          dispatchHistoryHidden: true,
          assistantSourceCount: 1,
          assistantDispatchCount: 0,
          assistantSourceTexts: ["共享记忆快答 · 本地参考层快答 · shared-memory-fast-path"],
          assistantDispatchTexts: [],
        },
        offlineChatGroupFixture: {
          threadId: "group",
          protocolTitle: "自治协作协议 v1",
          protocolSummary: "自动 fan-out",
          startupTruth: {
            bootstrapMatchesThreadStartup: true,
            historyMatchesThreadStartup: true,
            seedMatchesThreadStartup: true,
              protocolRecordIdConsistent: true,
              protocolRecordId: "protocol_1",
              protocolKey: "agent_passport_runtime",
              protocolVersion: "v1",
          },
        },
        offlineChatGroupSummary: {
          activeThreadId: "group",
          threadContextSummary: "自治协作协议 v1 自动 fan-out",
          dispatchHistoryHidden: false,
          dispatchHistoryCount: 2,
          firstParallelChip: "",
          assistantSourceCount: 2,
          assistantDispatchCount: 0,
          assistantSourceTexts: ["本地命令回答引擎 · 自定义本地命令 · fan-out 第2批 · 并行"],
          assistantDispatchTexts: [],
          policyCardMeta: "当前线程启动配置",
          policyCardGoal: "自治协作协议 v1 最近一轮 fan-out：完成 1/1 批。",
          executionCardMeta: "最近一轮调度结果",
          executionCardGoal: "",
          directState: {
            dispatchHistoryHidden: true,
          },
          refreshedState: {
            dispatchHistoryHidden: false,
            firstDispatchBody: "",
            policyCardGoal: "最近一轮 fan-out：完成 1/1 批。",
            executionCardGoal: "",
          },
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_offline_chat_group_dispatch_semantics"));
});

test("browser-ui semantics fails when runtime home links drift away from canonical entry set", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        mainSummary: {
          loadState: "loaded",
          homeSummary: "ok",
          healthSummary: "ok",
          recoverySummary: "ok",
          automationSummary: "ok",
          runtimeLinks: ["/operator", "/offline-chat", "/lab.html", "/repair-hub", "/api/security", "/legacy-home"],
          repairHubHref: "/repair-hub",
        },
        labSummary: {
          summary: "ok",
          localStoreDetails: ["a", "b", "c"],
          formalRecoveryDetails: ["a", "b", "c"],
          automaticRecoveryDetails: ["a", "b", "c"],
          apiSecurityTruth: {
            status: 200,
            authorized: false,
            releaseReadinessFailureSemantics: { status: "clear", failureCount: 0, primaryFailure: null, failures: [] },
            automaticRecoveryFailureSemantics: { status: "clear", failureCount: 0, primaryFailure: null, failures: [] },
          },
        },
        labInvalidTokenSummary: {
          authSummary: "请重新录入",
          status: "这次操作没有成功",
          resultText: "/api/security/runtime-housekeeping",
          lastReport: "还没有成功维护记录",
          guard: LAB_INVALID_TOKEN_GUARD,
        },
        operatorSummary: {
          truthState: buildStructuredOperatorTruthState(),
          exportState: buildStructuredOperatorExport(),
          incidentPacketState: buildStructuredIncidentPacketState(),
        },
        operatorInvalidTokenSummary: {
          authSummary: "请重新录入",
          protectedStatus: "继续显示公开真值",
          exportStatus: "当前不能导出",
          exportDisabled: true,
          guard: OPERATOR_INVALID_TOKEN_GUARD,
        },
        repairHubSummary: {
          tokenInputPresent: true,
          mainLinkHref: "http://127.0.0.1:4319/",
          selectedCredentialJsonLength: 50,
          selectedCredentialContainsId: true,
          selectedCredentialParsed: {
            ok: true,
            credentialRecordId: "credential_1",
            issuerDidMethod: "agentpassport",
            repairId: null,
          },
          statusCards: buildStructuredRepairHubStatusCards(),
          repairSummaryCards: buildStructuredRepairHubSummaryCards(),
          repairTruthCard: buildStructuredRepairHubTruthCard(),
          selectedRepairId: null,
        },
        repairHubInvalidTokenSummary: {
          authSummary: "请重新录入",
          overview: "当前标签页里的管理令牌无法读取",
          listEmpty: "当前标签页里的管理令牌无法读取",
          guard: REPAIR_HUB_INVALID_TOKEN_GUARD,
        },
        offlineChatInvalidTokenSummary: {
          authSummary: "请重新录入。本页保留当前令牌和已加载运行信息。",
          threadTitle: "离线线程",
          threadDescription: "没有可用线程。",
          threadContextSummary: "当前没有可用线程。",
          dispatchHistorySummary: "当前没有可用线程。",
          notice: "本页保留当前令牌和已加载运行信息。",
          syncStatus: "本页保留当前令牌和已加载运行信息。",
          sendDisabled: true,
          clearDisabled: false,
          guard: OFFLINE_CHAT_INVALID_TOKEN_GUARD,
        },
        offlineChatFixture: {
          threadId: "thread_direct_1",
          threadLabel: "沈知远",
          bootstrapThreadIds: ["group", "thread_direct_1"],
          sourceProvider: "passport_fast_memory",
        },
        offlineChatSummary: {
          activeThreadId: "thread_direct_1",
          activeSourceFilter: "passport_fast_memory",
          threadTitle: "与沈知远",
          dispatchHistoryHidden: true,
          assistantSourceCount: 1,
          assistantDispatchCount: 0,
          assistantSourceTexts: ["共享记忆快答 · 本地参考层快答 · shared-memory-fast-path"],
          assistantDispatchTexts: [],
        },
        offlineChatGroupFixture: {
          threadId: "group",
          protocolTitle: "自治协作协议 v1",
          protocolSummary: "自动 fan-out",
          startupTruth: {
            bootstrapMatchesThreadStartup: true,
            historyMatchesThreadStartup: true,
            seedMatchesThreadStartup: true,
              protocolRecordIdConsistent: true,
              protocolRecordId: "protocol_1",
              protocolKey: "agent_passport_runtime",
              protocolVersion: "v1",
          },
        },
        offlineChatGroupSummary: {
          activeThreadId: "group",
          threadContextSummary: "自治协作协议 v1 自动 fan-out",
          dispatchHistoryHidden: false,
          dispatchHistoryCount: 2,
          firstParallelChip: "并行批次 1",
          assistantSourceCount: 3,
          assistantDispatchCount: 2,
          assistantSourceTexts: [
            "本地命令回答引擎 · 自定义本地命令",
            "共享记忆快答 · 本地参考层快答 · shared-memory-fast-path",
            "线程协议运行时 · agent_passport_runtime:v1",
          ],
          assistantDispatchTexts: ["fan-out 第2批 · 并行", "fan-out 收口批 · 串行"],
          policyCardMeta: "当前线程启动配置",
          policyCardGoal: "自治协作协议 v1 自动 fan-out",
          executionCardMeta: "最近一轮调度结果",
          executionCardGoal: "最近一轮 fan-out：完成 1/1 批。",
          directState: {
            dispatchHistoryHidden: true,
          },
          refreshedState: {
            dispatchHistoryHidden: false,
            firstDispatchBody: "刷新后的并行批次",
            policyCardGoal: "自治协作协议 v1 自动 fan-out",
            executionCardGoal: "最近一轮 fan-out：完成 1/1 批。",
          },
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_runtime_home_truth_semantics"));
});

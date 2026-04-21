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
  dataCleared: true,
  sendDisabled: true,
  clearDisabled: true,
});

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

function buildStructuredOperatorExport({
  evidenceRefId = "evid_incident_packet_export_1",
  agentId = "agent_openneed_agents",
} = {}) {
  const uri = "incident-packet://export/2026-04-16T00%3A00%3A00.000Z";
  return {
    exportStatus: `事故交接包已导出并留档：agent-passport-incident-packet-2026-04-16.zip / ${evidenceRefId}`,
    exportHistoryCount: 1,
    exportHistoryRecordIds: [evidenceRefId],
    exportHistoryUris: [uri],
    exportRecord: {
      evidenceRefId,
      agentId,
      title: "事故交接包导出",
      uri,
      recordedAt: "2026-04-16T00:00:01.000Z",
      tags: ["incident-packet-export", "operator", "security"],
    },
    apiExport: {
      sourceSurface: "/api/security/incident-packet/export",
      residentAgentId: agentId,
      exportedAt: "2026-04-16T00:00:00.000Z",
      exportCoverage: {
        protectedRead: true,
        residentAgentBound: true,
        missingSections: [],
      },
      exportRecord: {
        evidenceRefId,
        agentId,
        kind: "note",
        title: "事故交接包导出",
        uri,
        tags: ["incident-packet-export", "operator", "security"],
      },
      historyResidentAgentId: agentId,
      historyMatchedExportRecord: true,
    },
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

function buildStructuredIncidentPacketState(overrides = {}) {
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
            truthState: {
              authSummary: "已保存管理令牌",
              protectedStatus: "已读取受保护恢复真值",
              exportDisabled: false,
              mainLinkHref: "http://127.0.0.1:4319/",
            },
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
            selectedRepairId: "repair_1",
          },
          repairHubInvalidTokenSummary: {
            authSummary: "当前标签页里的管理令牌无法读取，请重新录入",
            overview: "当前标签页里的管理令牌无法读取",
            listEmpty: "当前标签页里的管理令牌无法读取",
            guard: REPAIR_HUB_INVALID_TOKEN_GUARD,
          },
          offlineChatInvalidTokenSummary: {
            authSummary: "当前标签页里的管理令牌已失效；本页离线线程运行信息已清空，请重新录入。",
            threadTitle: "离线线程暂不可用",
            threadDescription: "当前没有拿到线程上下文，请先恢复离线线程运行态后再继续。",
            threadContextSummary: "当前无法确认线程成员。",
            dispatchHistorySummary: "当前无法确认调度历史。",
            notice: "当前标签页里的管理令牌无法访问离线线程接口",
            syncStatus: "当前标签页里的管理令牌无法访问离线线程接口",
            sendDisabled: true,
            clearDisabled: true,
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
              protocolRecordId: "protocol_1",
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
            assistantDispatchBatches: ["2", "merge"],
            assistantDispatchModes: ["parallel", "serial"],
            assistantSourceTexts: [
              "本地命令回答引擎 · 自定义本地命令",
              "共享记忆快答 · 本地参考层快答 · shared-memory-fast-path",
              "线程协议运行时 · openneed_system_autonomy:v1",
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
  assert.equal(gate.passedChecks, 12);
  assert.deepEqual(gate.failedChecks, []);
  assert.deepEqual(checkDetails(gate, "browser_runtime_home_truth_semantics")?.runtimeTruthMissingFields, []);
  assert.equal(checkDetails(gate, "browser_lab_failure_semantics_truth_chain")?.releaseStatus, "clear");
  assert.equal(checkDetails(gate, "browser_lab_failure_semantics_truth_chain")?.automaticStatus, "clear");
  assert.equal(checkDetails(gate, "browser_operator_truth_and_export_semantics")?.exportRecordId, "evid_incident_packet_export_1");
  assert.equal(checkDetails(gate, "browser_operator_truth_and_export_semantics")?.historyMatchedExportRecord, true);
  assert.equal(checkDetails(gate, "browser_operator_incident_packet_truth_semantics")?.boundaryAutomaticStatus, "clear");
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
    ["2", "merge"]
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
          truthState: {
            authSummary: "已保存管理令牌",
            protectedStatus: "已读取受保护恢复真值",
            exportDisabled: false,
            mainLinkHref: "http://127.0.0.1:4319/",
          },
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

test("browser-ui semantics fails when operator export state is flattened onto operator summary", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: {
            authSummary: "已保存管理令牌",
            protectedStatus: "已读取受保护恢复真值",
            exportDisabled: false,
            mainLinkHref: "http://127.0.0.1:4319/",
          },
          exportStatus: "事故交接包已导出并留档：agent-passport-incident-packet-2026.zip",
          exportHistoryCount: 1,
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_truth_and_export_semantics"));
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
          truthState: {
            authSummary: "已保存管理令牌",
            protectedStatus: "已读取受保护恢复真值",
            exportDisabled: false,
            mainLinkHref: "http://127.0.0.1:4319/",
          },
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
          truthState: {
            authSummary: "已保存管理令牌",
            protectedStatus: "已读取受保护恢复真值",
            exportDisabled: false,
            mainLinkHref: "http://127.0.0.1:4319/",
          },
          exportState: {
            ...exportState,
            exportHistoryRecordIds: ["evid_other_export"],
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
          truthState: {
            authSummary: "已保存管理令牌",
            protectedStatus: "已读取受保护恢复真值",
            exportDisabled: false,
            mainLinkHref: "http://127.0.0.1:4319/",
          },
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

test("browser-ui semantics fails when operator incident packet boundary truth is missing", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        operatorSummary: {
          operatorTruthReady: true,
          operatorTruthMissingFields: [],
          truthState: {
            authSummary: "已保存管理令牌",
            protectedStatus: "已读取受保护恢复真值",
            exportDisabled: false,
            mainLinkHref: "http://127.0.0.1:4319/",
          },
          exportState: buildStructuredOperatorExport(),
          incidentPacketState: buildStructuredIncidentPacketState({
            boundaryAutomaticRecoveryFailureSemantics: null,
          }),
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_operator_incident_packet_truth_semantics"));
  assert.equal(
    gate.checks.find((entry) => entry.check === "browser_operator_incident_packet_truth_semantics")?.details.boundaryAutomaticStatus,
    null
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
          truthState: {
            authSummary: "已保存管理令牌",
            protectedStatus: "已读取受保护恢复真值",
            exportDisabled: false,
            mainLinkHref: "http://127.0.0.1:4319/",
          },
          exportState: {
            exportStatus: "事故交接包已导出并留档：agent-passport-incident-packet-2026-04-16.zip",
            exportHistoryCount: 1,
          },
          incidentPacketState: {
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
          },
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
          selectedRepairId: "repair_1",
        },
        repairHubInvalidTokenSummary: {
          authSummary: "当前标签页里的管理令牌无法读取，请重新录入",
          overview: "当前标签页里的管理令牌无法读取",
          listEmpty: "当前标签页里的管理令牌无法读取",
          guard: REPAIR_HUB_INVALID_TOKEN_GUARD,
        },
        offlineChatInvalidTokenSummary: {
          authSummary: "当前标签页里的管理令牌已失效；本页离线线程运行信息已清空，请重新录入。",
          threadTitle: "离线线程暂不可用",
          threadDescription: "当前没有拿到线程上下文，请先恢复离线线程运行态后再继续。",
          threadContextSummary: "当前无法确认线程成员。",
          dispatchHistorySummary: "当前无法确认调度历史。",
          notice: "当前标签页里的管理令牌无法访问离线线程接口",
          syncStatus: "当前标签页里的管理令牌无法访问离线线程接口",
          sendDisabled: true,
          clearDisabled: true,
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
            protocolRecordId: "protocol_1",
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
            "线程协议运行时 · openneed_system_autonomy:v1",
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
          truthState: {
            authSummary: "已保存管理令牌",
            protectedStatus: "已读取受保护恢复真值",
            exportDisabled: false,
            mainLinkHref: "http://127.0.0.1:4319/",
          },
          exportStatus: "事故交接包已导出并留档：agent-passport-incident-packet-2026.zip",
          exportHistoryCount: 1,
          incidentPacketState: {
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
          },
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
          authSummary: "请重新录入",
          threadTitle: "离线线程暂不可用",
          threadDescription: "当前没有拿到线程上下文",
          threadContextSummary: "当前无法确认线程成员",
          dispatchHistorySummary: "当前无法确认调度历史",
          notice: "管理令牌",
          syncStatus: "管理令牌",
          sendDisabled: true,
          clearDisabled: true,
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
            protocolRecordId: "protocol_1",
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
          truthState: {
            authSummary: "已保存管理令牌",
            protectedStatus: "已读取受保护恢复真值",
            exportDisabled: false,
            mainLinkHref: "http://127.0.0.1:4319/",
          },
          exportState: buildStructuredOperatorExport(),
          incidentPacketState: {
            status: 200,
            format: "agent-passport-incident-packet-v1",
            snapshotReleaseReadinessFailureSemantics: { status: "clear", failureCount: 0, primaryFailure: null, failures: [] },
            boundaryReleaseReadinessFailureSemantics: { status: "clear", failureCount: 0, primaryFailure: null, failures: [] },
            boundaryAutomaticRecoveryFailureSemantics: { status: "clear", failureCount: 0, primaryFailure: null, failures: [] },
          },
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
          selectedRepairId: null,
        },
        repairHubInvalidTokenSummary: {
          authSummary: "请重新录入",
          overview: "当前标签页里的管理令牌无法读取",
          listEmpty: "当前标签页里的管理令牌无法读取",
          guard: REPAIR_HUB_INVALID_TOKEN_GUARD,
        },
        offlineChatInvalidTokenSummary: {
          authSummary: "请重新录入",
          threadTitle: "离线线程暂不可用",
          threadDescription: "当前没有拿到线程上下文",
          threadContextSummary: "当前无法确认线程成员",
          dispatchHistorySummary: "当前无法确认调度历史",
          notice: "管理令牌",
          syncStatus: "管理令牌",
          sendDisabled: true,
          clearDisabled: true,
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
            protocolRecordId: "protocol_1",
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
            "线程协议运行时 · openneed_system_autonomy:v1",
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

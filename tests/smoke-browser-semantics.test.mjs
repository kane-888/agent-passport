import assert from "node:assert/strict";
import test from "node:test";

import {
  formatBrowserUiSemanticsSummary,
  summarizeBrowserUiSemantics,
} from "../scripts/smoke-all.mjs";
import { PUBLIC_RUNTIME_ENTRY_HREFS } from "../public/runtime-truth-client.js";

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

test("browser-ui semantics accepts explicit truth, protection, and offline-chat visibility evidence", () => {
  const gate = summarizeBrowserUiSemantics(
    [
      {
        name: "smoke:browser",
        result: {
          baseUrl: "http://127.0.0.1:4319",
          repairId: "repair_1",
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
            sourceFilterSummary: "当前共有 3 条回复。当前显示全部回复。",
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
    ],
    { browserSkipped: false }
  );

  assert.equal(gate.status, "passed");
  assert.equal(gate.passedChecks, 12);
  assert.deepEqual(gate.failedChecks, []);
  assert.match(formatBrowserUiSemanticsSummary(gate), /RuntimeHome=pass/);
  assert.match(formatBrowserUiSemanticsSummary(gate), /LabTruth=pass/);
  assert.match(formatBrowserUiSemanticsSummary(gate), /LabFailure=pass/);
  assert.match(formatBrowserUiSemanticsSummary(gate), /OperatorExport=pass/);
  assert.match(formatBrowserUiSemanticsSummary(gate), /OperatorPacket=pass/);
  assert.match(formatBrowserUiSemanticsSummary(gate), /OfflineChatDirect=pass/);
  assert.match(formatBrowserUiSemanticsSummary(gate), /OfflineChatGroup=pass/);
});

test("browser-ui semantics skips cleanly when browser gate is intentionally disabled", () => {
  const gate = summarizeBrowserUiSemantics([], { browserSkipped: true });

  assert.equal(gate.status, "skipped");
  assert.equal(gate.totalChecks, 0);
  assert.equal(formatBrowserUiSemanticsSummary(gate), "browser-ui semantics: skipped");
});

test("browser-ui semantics fails when offline-chat deeplink bootstrap thread list contains duplicates", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
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
          exportState: {
            exportStatus: "事故交接包已导出并留档：agent-passport-incident-packet.zip",
            exportHistoryCount: 1,
          },
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

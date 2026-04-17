import assert from "node:assert/strict";
import test from "node:test";

import {
  formatBrowserUiSemanticsSummary,
  summarizeBrowserUiSemantics,
} from "../scripts/smoke-all.mjs";

test("browser-ui semantics accepts explicit truth, protection, and offline-chat visibility evidence", () => {
  const gate = summarizeBrowserUiSemantics(
    [
      {
        name: "smoke:browser",
        result: {
          baseUrl: "http://127.0.0.1:4319",
          repairId: "repair_1",
          mainSummary: {
            homeSummary: "公开运行态已加载",
            healthSummary: "服务可达",
            runtimeLinks: ["/operator", "/offline-chat", "/lab.html", "/repair-hub", "/api/security", "/api/health"],
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
          },
          offlineChatFixture: {
            threadId: "thread_direct_1",
            threadLabel: "沈知远",
            sourceProvider: "passport_fast_memory",
          },
          offlineChatSummary: {
            activeThreadId: "thread_direct_1",
            activeSourceFilter: "passport_fast_memory",
            threadTitle: "与沈知远",
            dispatchHistoryHidden: true,
            assistantSourceCount: 1,
          },
          offlineChatGroupFixture: {
            threadId: "group",
            protocolTitle: "自治协作协议 v1",
            protocolSummary: "自动 fan-out",
          },
          offlineChatGroupSummary: {
            activeThreadId: "group",
            threadContextSummary: "自治协作协议 v1 自动 fan-out",
            dispatchHistoryHidden: false,
            dispatchHistoryCount: 2,
            firstParallelChip: "并行批次 1",
            directState: {
              dispatchHistoryHidden: true,
            },
            refreshedState: {
              dispatchHistoryHidden: false,
              firstDispatchBody: "刷新后的并行批次",
            },
          },
        },
      },
    ],
    { browserSkipped: false }
  );

  assert.equal(gate.status, "passed");
  assert.equal(gate.passedChecks, 11);
  assert.deepEqual(gate.failedChecks, []);
  assert.match(formatBrowserUiSemanticsSummary(gate), /RuntimeHome=pass/);
  assert.match(formatBrowserUiSemanticsSummary(gate), /LabTruth=pass/);
  assert.match(formatBrowserUiSemanticsSummary(gate), /LabFailure=pass/);
  assert.match(formatBrowserUiSemanticsSummary(gate), /OperatorExport=pass/);
  assert.match(formatBrowserUiSemanticsSummary(gate), /OperatorPacket=pass/);
  assert.match(formatBrowserUiSemanticsSummary(gate), /OfflineChatGroup=pass/);
});

test("browser-ui semantics skips cleanly when browser gate is intentionally disabled", () => {
  const gate = summarizeBrowserUiSemantics([], { browserSkipped: true });

  assert.equal(gate.status, "skipped");
  assert.equal(gate.totalChecks, 0);
  assert.equal(formatBrowserUiSemanticsSummary(gate), "browser-ui semantics: skipped");
});

test("browser-ui semantics fails when offline-chat group dispatch visibility regresses", () => {
  const gate = summarizeBrowserUiSemantics([
    {
      name: "smoke:browser",
      result: {
        baseUrl: "http://127.0.0.1:4319",
        mainSummary: {
          homeSummary: "ok",
          healthSummary: "ok",
          runtimeLinks: ["/operator", "/offline-chat", "/lab.html", "/repair-hub", "/api/security", "/api/health"],
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
        },
        offlineChatFixture: {
          threadId: "thread_direct_1",
          threadLabel: "沈知远",
          sourceProvider: "passport_fast_memory",
        },
        offlineChatSummary: {
          activeThreadId: "thread_direct_1",
          activeSourceFilter: "passport_fast_memory",
          threadTitle: "与沈知远",
          dispatchHistoryHidden: true,
          assistantSourceCount: 1,
        },
        offlineChatGroupFixture: {
          threadId: "group",
          protocolTitle: "自治协作协议 v1",
          protocolSummary: "自动 fan-out",
        },
        offlineChatGroupSummary: {
          activeThreadId: "group",
          threadContextSummary: "自治协作协议 v1 自动 fan-out",
          dispatchHistoryHidden: false,
          dispatchHistoryCount: 2,
          firstParallelChip: "",
          directState: {
            dispatchHistoryHidden: true,
          },
          refreshedState: {
            dispatchHistoryHidden: false,
            firstDispatchBody: "",
          },
        },
      },
    },
  ]);

  assert.equal(gate.status, "failed");
  assert(gate.failedChecks.includes("browser_offline_chat_group_dispatch_semantics"));
});

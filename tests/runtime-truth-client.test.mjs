import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicRuntimeSnapshot,
  buildSecurityBoundarySnapshot,
  selectRuntimeTruth,
  statusLabel,
} from "../public/runtime-truth-client.js";

test("selectRuntimeTruth prefers protected setup truth over public security truth", () => {
  const truth = selectRuntimeTruth({
    security: {
      securityPosture: { mode: "normal" },
      localStorageFormalFlow: {
        status: "partial",
        operationalCadence: { status: "due_soon" },
      },
      automaticRecovery: {
        status: "armed_with_gaps",
        operatorBoundary: { formalFlowReady: false },
      },
      constrainedExecution: { status: "bounded" },
    },
    setup: {
      formalRecoveryFlow: {
        status: "ready",
        operationalCadence: { status: "within_window" },
      },
      automaticRecoveryReadiness: {
        status: "ready",
        operatorBoundary: { formalFlowReady: true },
      },
      deviceRuntime: {
        constrainedExecutionSummary: { status: "locked" },
      },
    },
  });

  assert.equal(truth.formalRecovery?.status, "ready");
  assert.equal(truth.cadence?.status, "within_window");
  assert.equal(truth.automaticRecovery?.status, "ready");
  assert.equal(truth.operatorBoundary?.formalFlowReady, true);
  assert.equal(truth.constrainedExecution?.status, "locked");
});

test("buildPublicRuntimeSnapshot keeps homepage summaries on shared truth labels", () => {
  const snapshot = buildPublicRuntimeSnapshot({
    health: {
      ok: true,
      hostBinding: "127.0.0.1",
    },
    security: {
      hostBinding: "127.0.0.1",
      securityPosture: {
        mode: "normal",
        summary: "运行态安全姿态正常。",
      },
      localStorageFormalFlow: {
        status: "partial",
        summary: "本地恢复正式流程已部分就绪。",
        runbook: {
          nextStepSummary: "执行恢复演练。",
        },
        operationalCadence: {
          status: "due_soon",
          summary: "恢复窗口即将到期。",
          actionSummary: "现在补跑恢复演练。",
          rerunTriggers: [{ label: "轮换后重跑 1 -> 2 -> 3" }],
        },
      },
      automaticRecovery: {
        status: "armed_with_gaps",
        summary: "自动恢复可以启动，但仍有缺口。",
        operatorBoundary: {
          summary: "正式恢复未收口前不能把自动恢复当成完成。",
        },
      },
    },
  });

  assert.equal(snapshot.postureStatusLabel, "正常");
  assert.equal(snapshot.formalRecoveryStatusLabel, "部分就绪");
  assert.equal(snapshot.automaticRecoveryStatusLabel, "可启动但有缺口");
  assert.match(snapshot.healthDetail, /运行态安全姿态正常/);
  assert.equal(snapshot.recoverySummary, "恢复窗口即将到期。");
  assert.equal(snapshot.recoveryDetail, "现在补跑恢复演练。");
  assert.deepEqual(snapshot.triggerLabels, ["轮换后重跑 1 -> 2 -> 3"]);
  assert.equal(snapshot.automationSummary, "正式恢复未收口前不能把自动恢复当成完成。");
  assert.match(snapshot.homeSummary, /姿态 正常/);
});

test("buildPublicRuntimeSnapshot normalizes trigger strings and objects to one homepage truth shape", () => {
  const snapshot = buildPublicRuntimeSnapshot({
    security: {
      securityPosture: {
        mode: "normal",
      },
      localStorageFormalFlow: {
        status: "ready",
        operationalCadence: {
          rerunTriggers: [
            "存储主密钥轮换后重跑 1 -> 2 -> 3 -> 4",
            { label: "恢复包重导后至少重跑 3 -> 4" },
            { code: "before_cross_device_cutover" },
          ],
        },
      },
      automaticRecovery: {
        status: "ready",
      },
    },
  });

  assert.deepEqual(snapshot.triggerLabels, [
    "存储主密钥轮换后重跑 1 -> 2 -> 3 -> 4",
    "恢复包重导后至少重跑 3 -> 4",
    "before_cross_device_cutover",
  ]);
});

test("buildSecurityBoundarySnapshot keeps lab cards aligned to shared labels", () => {
  const snapshot = buildSecurityBoundarySnapshot({
    localStore: {
      recoveryBaselineReady: false,
    },
    localStorageFormalFlow: {
      status: "partial",
      summary: "本地恢复正式流程已部分就绪。",
      storeEncryption: {
        status: "protected",
        systemProtected: true,
      },
      runbook: {
        nextStepLabel: "执行恢复演练",
      },
      operationalCadence: {
        status: "within_window",
      },
    },
    constrainedExecution: {
      status: "bounded",
      summary: "受限执行当前有界放行。",
      systemBrokerSandbox: {
        status: "enforced",
        summary: "系统级调度沙箱已强制启用。",
      },
    },
    automaticRecovery: {
      status: "armed_with_gaps",
      summary: "自动恢复当前可以启动，但正式恢复还没收口。",
      operatorBoundary: {
        formalFlowReady: false,
        summary: "正式恢复当前仍未达标。",
      },
    },
  });

  assert.match(snapshot.summary, /本地存储 已受保护/);
  assert.equal(snapshot.localStoreSummary, "本地账本与密钥已进入系统保护层。");
  assert.deepEqual(snapshot.localStoreDetails, ["状态：已受保护", "系统保护：已启用", "恢复基线：未就绪"]);
  assert.deepEqual(snapshot.formalRecoveryDetails, ["状态：部分就绪", "下一步：执行恢复演练", "周期：窗口内"]);
  assert.deepEqual(snapshot.constrainedExecutionDetails, ["状态：有界放行", "系统级调度沙箱：已强制启用", "预算/能力：系统级调度沙箱已强制启用。"]);
  assert.deepEqual(snapshot.automaticRecoveryDetails, ["状态：可启动但有缺口", "正式恢复已达标：否", "值班边界：正式恢复当前仍未达标。"]);
  assert.equal(statusLabel("armed_with_gaps"), "可启动但有缺口");
});

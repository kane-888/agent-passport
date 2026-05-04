import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertPublicCopyPolicy,
  assertPublicNarrativeCopyPolicy,
  PUBLIC_NARRATIVE_COPY_POLICY_FILES,
  PUBLIC_COPY_POLICY_FILES,
} from "../scripts/public-copy-policy.mjs";
import {
  ADMIN_TOKEN_STORAGE_KEY,
  buildAdminTokenHeaders,
  buildAdminTokenAuthSummary,
  buildOperatorDecisionCards,
  buildOperatorTruthSnapshot,
  buildPublicRuntimeSnapshot,
  buildSecurityBoundarySnapshot,
  describeProtectedReadFailure,
  displayAgentPassportLocalReasonerModel,
  formatRuntimeMessageDispatch,
  formatRuntimeMessageSource,
  formatProtectedReadSurface,
  isPublicRuntimeHomeFailureText,
  isPublicRuntimeHomePendingText,
  LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY,
  LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY,
  migrateStoredAdminToken,
  OFFLINE_CHAT_HOME_COPY,
  OPERATOR_AUTH_SUMMARY_PUBLIC,
  OPERATOR_EXPORT_STATUS_SETUP_REQUIRED,
  OPERATOR_PROTECTED_STATUS_PUBLIC,
  PUBLIC_RUNTIME_ENTRY_HREFS,
  PUBLIC_RUNTIME_HOME_COPY,
  PUBLIC_RUNTIME_HOME_STATE_COPY,
  readStoredAdminToken,
  selectRuntimeTruth,
  statusLabel,
  writeStoredAdminToken,
} from "../public/runtime-truth-client.js";
import {
  LEGACY_RUNTIME_HOUSEKEEPING_LAST_REPORT_LOCAL_STORAGE_KEY,
  LEGACY_RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY,
  RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY,
  migrateStoredRuntimeHousekeepingLastReport,
  readStoredRuntimeHousekeepingLastReport,
  writeStoredRuntimeHousekeepingLastReport,
} from "../public/runtime-housekeeping-storage-compat.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createMockStorage(initial = {}, { failSetKeys = [] } = {}) {
  const values = new Map(Object.entries(initial));
  const failingKeys = new Set(failSetKeys);
  const operations = [];
  return {
    getItem(key) {
      operations.push(["getItem", key]);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      operations.push(["setItem", key, String(value)]);
      if (failingKeys.has(key)) {
        throw new Error(`Storage write failed for ${key}`);
      }
      values.set(key, String(value));
    },
    removeItem(key) {
      operations.push(["removeItem", key]);
      values.delete(key);
    },
    snapshot() {
      return Object.fromEntries(values.entries());
    },
    operations() {
      return operations.slice();
    },
  };
}

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

test("runtime truth client centralizes offline-chat source and dispatch labels on canonical runtime truth", () => {
  assert.equal(displayAgentPassportLocalReasonerModel("gemma4:e4b"), "记忆稳态引擎本地推理");
  assert.equal(
    formatRuntimeMessageSource({
      provider: "ollama_local",
      model: "gemma4:e4b",
    }),
    "Ollama 本地引擎 · 记忆稳态引擎本地推理 · 记忆稳态引擎"
  );
  assert.equal(
    formatRuntimeMessageSource({
      provider: "passport_fast_memory",
      label: "共享记忆快答",
      model: "shared-memory-fast-path",
    }),
    "共享记忆快答 · 本地参考层快答 · shared-memory-fast-path"
  );
  assert.equal(
    formatRuntimeMessageSource({
      provider: "thread_protocol_runtime",
      model: "agent_passport_runtime:v1",
    }),
    "线程协议运行时 · agent_passport_runtime:v1"
  );
  assert.equal(
    formatRuntimeMessageDispatch({
      dispatch: {
        batchId: "merge",
        executionMode: "serial",
      },
    }),
    "fan-out 收口批 · 串行"
  );
  assert.equal(
    formatRuntimeMessageDispatch({
      dispatch: {
        batchId: 2,
        executionMode: "parallel",
      },
    }),
    "fan-out 第2批 · 并行"
  );
});

test("runtime truth client keeps legacy thread-protocol aliases explicit as compatibility-only display inputs", () => {
  assert.equal(
    formatRuntimeMessageSource({
      provider: "thread_protocol_runtime",
      model: "openneed_system_autonomy:v1",
    }),
    "线程协议运行时 · agent_passport_runtime:v1"
  );
});

test("selectRuntimeTruth keeps store encryption on the same setup-first fallback chain", () => {
  const protectedSetupTruth = selectRuntimeTruth({
    security: {
      localStorageFormalFlow: {
        storeEncryption: {
          status: "partial",
          systemProtected: false,
        },
      },
    },
    setup: {
      formalRecoveryFlow: {
        storeEncryption: {
          status: "protected",
          systemProtected: true,
        },
      },
    },
  });
  const publicFallbackTruth = selectRuntimeTruth({
    security: {
      localStorageFormalFlow: {
        storeEncryption: {
          status: "partial",
          systemProtected: false,
        },
      },
    },
    setup: {
      formalRecoveryFlow: {
        status: "ready",
      },
    },
  });

  assert.equal(protectedSetupTruth.storeEncryption?.status, "protected");
  assert.equal(protectedSetupTruth.storeEncryption?.systemProtected, true);
  assert.equal(publicFallbackTruth.storeEncryption?.status, "partial");
  assert.equal(publicFallbackTruth.storeEncryption?.systemProtected, false);
});

test("selectRuntimeTruth falls back field-by-field when protected setup truth is partial", () => {
  const truth = selectRuntimeTruth({
    security: {
      localStorageFormalFlow: {
        status: "partial",
        operationalCadence: {
          status: "due_soon",
        },
        crossDeviceRecoveryClosure: {
          readyForRehearsal: false,
        },
      },
      automaticRecovery: {
        status: "armed_with_gaps",
        operatorBoundary: {
          formalFlowReady: false,
        },
      },
    },
    setup: {
      formalRecoveryFlow: {
        status: "ready",
      },
      automaticRecoveryReadiness: {
        status: "ready",
      },
    },
  });

  assert.equal(truth.formalRecovery?.status, "ready");
  assert.equal(truth.cadence?.status, "due_soon");
  assert.equal(truth.crossDevice?.readyForRehearsal, false);
  assert.equal(truth.automaticRecovery?.status, "ready");
  assert.equal(truth.operatorBoundary?.formalFlowReady, false);
});

test("buildPublicRuntimeSnapshot keeps homepage summaries on shared truth labels", () => {
  const snapshot = buildPublicRuntimeSnapshot({
    health: {
      ok: true,
      service: "agent-passport",
      hostBinding: "127.0.0.1",
    },
    security: {
      hostBinding: "127.0.0.1",
      releaseReadiness: {
        status: "ready",
      },
      securityPosture: {
        mode: "normal",
        summary: "运行态安全姿态正常。",
      },
      securityArchitecture: {
        operatorHandbook: {
          summary: "按固定顺序收口值班判断。",
        },
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
      agentRuntimeTruth: {
        localFirst: true,
        policy: "记忆稳态引擎本地推理优先，本地答案未通过校验时再联网增强；本地 provider 不可用时退回本地 fallback。",
        qualityEscalationRuns: 1,
        latestQualityEscalationActivated: true,
        latestQualityEscalationProvider: "openai_compatible",
        latestQualityEscalationReason: "verification_invalid",
        memoryStabilityStateCount: 1,
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityObservationKind: "correction_rebuild",
        latestMemoryStabilityRecoverySignal: "risk_rising",
        latestMemoryStabilityCorrectionActions: ["rewrite_working_memory_summary"],
        memoryStabilityRecoveryRate: 0,
        latestMemoryStabilityUpdatedAt: "2026-04-23T08:00:00.000Z",
      },
    },
  });

  assert.equal(snapshot.postureStatusLabel, "正常");
  assert.equal(snapshot.formalRecoveryStatusLabel, "部分就绪");
  assert.equal(snapshot.automaticRecoveryStatusLabel, "可启动但有缺口");
  assert.equal(snapshot.readyForSmoke, true);
  assert.deepEqual(snapshot.missingFields, []);
  assert.equal(snapshot.firstMissingField, null);
  assert.equal(snapshot.missingFieldsSummary, "");
  assert.match(snapshot.healthDetail, /运行态安全姿态正常/);
  assert.equal(snapshot.recoverySummary, "恢复窗口即将到期。");
  assert.equal(snapshot.recoveryDetail, "现在补跑恢复演练。");
  assert.deepEqual(snapshot.triggerLabels, ["轮换后重跑 1 -> 2 -> 3"]);
  assert.equal(snapshot.automationSummary, "正式恢复未收口前不能把自动恢复当成完成。");
  assert.match(snapshot.agentRuntimeSummary, /本地优先已启用/u);
  assert.match(snapshot.agentRuntimeDetail, /质量升级/u);
  assert.match(snapshot.agentRuntimeDetail, /观测类型：correction rebuild/u);
  assert.match(snapshot.agentRuntimeDetail, /纠偏动作：rewrite working memory summary/u);
  assert.match(snapshot.agentRuntimeDetail, /近窗纠偏恢复率：0\.00/u);
  assert.match(snapshot.homeSummary, /姿态 正常/);
});

test("buildPublicRuntimeSnapshot surfaces runner guard blocks from shared runtime truth", () => {
  const snapshot = buildPublicRuntimeSnapshot({
    health: {
      ok: true,
      service: "agent-passport",
      hostBinding: "127.0.0.1",
    },
    security: {
      hostBinding: "127.0.0.1",
      releaseReadiness: {
        status: "ready",
      },
      securityPosture: {
        mode: "normal",
        summary: "运行态安全姿态正常。",
      },
      securityArchitecture: {
        operatorHandbook: {
          summary: "按固定顺序收口值班判断。",
        },
      },
      localStorageFormalFlow: {
        status: "ready",
        summary: "正式恢复已就绪。",
        runbook: {
          nextStepSummary: "继续巡检。",
        },
        operationalCadence: {
          rerunTriggers: ["runtime root 修复后重跑"],
        },
      },
      automaticRecovery: {
        status: "ready",
        summary: "自动恢复值班边界已确认。",
      },
      agentRuntimeTruth: {
        localFirst: true,
        policy: "记忆稳态引擎本地推理优先，本地答案未通过校验时再联网增强。",
        onlineAllowed: true,
        latestRunStatus: "blocked",
        latestRunnerGuardActivated: true,
        latestRunnerGuardBlockedBy: "memory_stability_prompt_preflight",
        latestRunnerGuardCode: "MEMORY_STABILITY_RUNTIME_LOAD_FAILED",
        latestRunnerGuardStage: "runtime_loader",
        latestRunnerGuardReceiptStatus: "failed",
        latestRunnerGuardExplicitRequestKinds: ["prompt_preflight", "kernel_preview"],
        qualityEscalationRuns: 0,
        latestQualityEscalationActivated: false,
        memoryStabilityStateCount: 1,
        latestMemoryStabilityStateId: "memory_state_guard_1",
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityObservationKind: "correction_rebuild",
        latestMemoryStabilityRecoverySignal: "risk_rising",
        latestMemoryStabilityCorrectionActions: ["rewrite_working_memory_summary"],
        memoryStabilityRecoveryRate: 0,
        latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
      },
    },
  });

  assert.deepEqual(snapshot.missingFields, []);
  assert.equal(snapshot.readyForSmoke, true);
  assert.equal(snapshot.agentRuntimeSummary, "本地优先已启用，最近一次因记忆稳态护栏被阻断。");
  assert.match(snapshot.agentRuntimeDetail, /状态 被阻塞/u);
  assert.match(snapshot.agentRuntimeDetail, /阻断点：prompt 预检/u);
  assert.match(snapshot.agentRuntimeDetail, /阻断码：MEMORY_STABILITY_RUNTIME_LOAD_FAILED/u);
  assert.match(snapshot.agentRuntimeDetail, /显式请求：prompt 预检 \/ kernel 预览/u);
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
      agentRuntimeTruth: {
        localFirst: true,
        policy: "记忆稳态引擎本地推理优先，本地答案未通过校验时再联网增强；本地 provider 不可用时退回本地 fallback。",
        qualityEscalationRuns: 0,
      },
    },
  });

  assert.deepEqual(snapshot.triggerLabels, [
    "存储主密钥轮换后重跑 1 -> 2 -> 3 -> 4",
    "恢复包重导后至少重跑 3 -> 4",
    "before_cross_device_cutover",
  ]);
  assert.equal(snapshot.readyForSmoke, false);
  assert.equal(snapshot.firstMissingField, "health.ok");
  assert.match(snapshot.missingFieldsSummary, /health\.ok/u);
  assert.deepEqual(snapshot.missingFields, [
    "health.ok",
    "health.service",
    "releaseReadiness.status",
    "securityPosture.summary",
    "securityArchitecture.operatorHandbook.summary",
    "formalRecovery.summary",
    "formalRecovery.nextStepSummary",
    "automaticRecovery.summary",
    "agentRuntime.memoryStabilityStateCount",
  ]);
});

test("buildPublicRuntimeSnapshot keeps light memory correction on canonical public labels", () => {
  const snapshot = buildPublicRuntimeSnapshot({
    security: {
      securityPosture: {
        mode: "normal",
      },
      localStorageFormalFlow: {
        status: "ready",
        operationalCadence: {
          status: "within_window",
        },
      },
      automaticRecovery: {
        status: "ready",
      },
      agentRuntimeTruth: {
        localFirst: true,
        policy: "记忆稳态引擎本地推理优先，本地答案未通过校验时再联网增强。",
        onlineAllowed: true,
        qualityEscalationRuns: 0,
        latestQualityEscalationActivated: false,
        latestMemoryStabilityStateId: "memory_state_light_1",
        latestMemoryStabilityCorrectionLevel: "light",
        latestMemoryStabilityRiskScore: 0.19,
        latestMemoryStabilityObservationKind: "active_probe",
        latestMemoryStabilityRecoverySignal: "risk_rising",
        latestMemoryStabilityCorrectionActions: ["reanchor_key_memories_near_prompt_end"],
        memoryStabilityRecoveryRate: 0,
        latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
        memoryStabilityStateCount: 1,
      },
    },
  });

  assert.match(snapshot.agentRuntimeSummary, /最近未触发质量升级/u);
  assert.match(snapshot.agentRuntimeDetail, /轻微纠偏/u);
  assert.doesNotMatch(snapshot.agentRuntimeDetail, /\blight\b/u);
});

test("buildPublicRuntimeSnapshot keeps active memory correction partial until observation truth arrives", () => {
  const snapshot = buildPublicRuntimeSnapshot({
    health: {
      ok: true,
      service: "agent-passport",
    },
    security: {
      releaseReadiness: {
        status: "ready",
      },
      securityPosture: {
        mode: "normal",
        summary: "运行态安全姿态正常。",
      },
      securityArchitecture: {
        operatorHandbook: {
          summary: "按固定顺序收口值班判断。",
        },
      },
      localStorageFormalFlow: {
        status: "ready",
        summary: "正式恢复已就绪。",
        runbook: {
          nextStepSummary: "继续巡检。",
        },
        operationalCadence: {
          rerunTriggers: ["恢复包更新后重跑"],
        },
      },
      automaticRecovery: {
        status: "ready",
        summary: "自动恢复值班边界已确认。",
      },
      agentRuntimeTruth: {
        localFirst: true,
        policy: "记忆稳态引擎本地推理优先，本地答案未通过校验时再联网增强。",
        qualityEscalationRuns: 0,
        memoryStabilityStateCount: 1,
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
      },
    },
  });

  assert.equal(snapshot.readyForSmoke, false);
  assert(snapshot.missingFields.includes("agentRuntime.latestMemoryStabilityObservationKind"));
  assert(snapshot.missingFields.includes("agentRuntime.memoryStabilityRecoveryRate"));
  assert(snapshot.missingFields.includes("agentRuntime.latestMemoryStabilityCorrectionActions"));
});

test("buildPublicRuntimeSnapshot exposes missing truth fields separately from display fallbacks", () => {
  const snapshot = buildPublicRuntimeSnapshot({
    health: {
      ok: true,
      service: "agent-passport",
      hostBinding: "127.0.0.1",
    },
    security: {
      hostBinding: "127.0.0.1",
      securityPosture: {
        mode: "normal",
        summary: "运行态安全姿态正常。",
      },
      localStorageFormalFlow: {
        status: "ready",
      },
      automaticRecovery: {
        status: "ready",
      },
    },
  });

  assert.equal(snapshot.readyForSmoke, false);
  assert.deepEqual(snapshot.missingFields, [
    "releaseReadiness.status",
    "securityArchitecture.operatorHandbook.summary",
    "formalRecovery.summary",
    "formalRecovery.nextStepSummary",
    "formalRecovery.operationalCadence.rerunTriggers",
    "automaticRecovery.summary",
    "agentRuntime.localFirst",
    "agentRuntime.policy",
    "agentRuntime.qualityEscalationRuns",
    "agentRuntime.memoryStabilityStateCount",
  ]);
  assert.match(snapshot.homeSummary, /部分加载/u);
  assert.match(snapshot.homeSummary, /releaseReadiness\.status/u);
  assert.equal(snapshot.recoverySummary, "尚未读取正式恢复状态。");
  assert.equal(snapshot.recoveryDetail, "尚未读取下一步。");
  assert.equal(snapshot.operatorEntrySummary, "按固定顺序收口值班判断。");
  assert.equal(snapshot.automationSummary, "尚未读取自动恢复边界。");
  assert.equal(snapshot.agentRuntimeSummary, "尚未读取 agent 运行真值。");
  assert.deepEqual(snapshot.triggerLabels, []);
});

test("runtime truth client keeps canonical public entry hrefs and homepage load markers aligned", () => {
  const indexHtml = fs.readFileSync(path.join(rootDir, "public/index.html"), "utf8");
  const publicIntroText = PUBLIC_RUNTIME_HOME_COPY.introSegments
    .map((segment) => segment.text || segment.code || "")
    .join("");
  assert.deepEqual(PUBLIC_RUNTIME_ENTRY_HREFS, [
    "/operator",
    "/offline-chat",
    "/lab.html",
    "/repair-hub",
    "/api/security",
    "/api/health",
  ]);
  assert.deepEqual(
    PUBLIC_RUNTIME_HOME_COPY.entries.map((entry) => entry.href),
    PUBLIC_RUNTIME_ENTRY_HREFS
  );
  assert.match(PUBLIC_RUNTIME_HOME_COPY.title, /agent-passport/);
  assert.equal(isPublicRuntimeHomePendingText("公开运行态已部分加载：健康探测已确认"), true);
  assert.equal(isPublicRuntimeHomePendingText("正常摘要里提到已部分加载这个词不应误判"), false);
  assert.equal(isPublicRuntimeHomePendingText("公开运行态已加载：姿态 正常。"), false);
  assert.equal(isPublicRuntimeHomeFailureText("公开运行态加载失败：HTTP 500"), true);
  assert.equal(isPublicRuntimeHomeFailureText("诊断说明中提到公开运行态加载失败不应误判"), false);
  assert.equal(isPublicRuntimeHomeFailureText("服务可达，默认绑定 127.0.0.1。"), false);
  assert.equal(
    PUBLIC_RUNTIME_HOME_STATE_COPY.partialHealthOnlySummary(5),
    "公开运行态已部分加载：健康探测已确认，正式恢复与自动恢复真值仍在补拉，5 秒后重试。"
  );
  assert.equal(
    PUBLIC_RUNTIME_HOME_STATE_COPY.failureHomeSummary("HTTP 500", 5),
    "公开运行态加载失败：HTTP 500。5 秒后继续重试。"
  );
  assert.doesNotMatch(OFFLINE_CHAT_HOME_COPY.heroSummary, /openneed/i);
  assert.doesNotMatch(publicIntroText, /openneed/i);
  assert.match(indexHtml, /data-runtime-link-source="PUBLIC_RUNTIME_HOME_COPY"/);
  assert.doesNotMatch(indexHtml, /data-runtime-link-markers/);
  assert.match(indexHtml, /<a href="\/operator">\/operator<\/a>/);
});

test("public copy policy covers every public HTML and JavaScript runtime surface", () => {
  const publicDir = path.join(rootDir, "public");
  const actualPublicFiles = fs
    .readdirSync(publicDir)
    .filter((filename) => filename.endsWith(".html") || filename.endsWith(".js"))
    .map((filename) => `public/${filename}`)
    .sort();
  assert.deepEqual([...PUBLIC_COPY_POLICY_FILES].sort(), actualPublicFiles);

  assertPublicCopyPolicy(
    Object.fromEntries(
      actualPublicFiles.map((relativePath) => [
        relativePath,
        fs.readFileSync(path.join(rootDir, relativePath), "utf8"),
      ])
    )
  );
});

test("public narrative copy policy blocks old public product-name regressions", () => {
  assertPublicNarrativeCopyPolicy(
    Object.fromEntries(
      PUBLIC_NARRATIVE_COPY_POLICY_FILES.map((relativePath) => [
        relativePath,
        fs.readFileSync(path.join(rootDir, relativePath), "utf8"),
      ])
    )
  );

  assert.throws(
    () =>
      assertPublicNarrativeCopyPolicy({
        "README.md": "这套能力现在的 legacy/compatibility 标签仍写成 `OpenNeed 记忆稳态引擎`，并被误当成正式命名。",
      }),
    /不应把 OpenNeed 回退成对外正式叙事/
  );
});

test("offline chat history reads do not overwrite canonical bootstrap startup truth", () => {
  const source = fs.readFileSync(path.join(rootDir, "public/offline-chat-app.js"), "utf8");
  const historyHelper = source.match(/function acceptsThreadStartupFromHistory[\s\S]*?\n}\n/);
  const loadHistoryHelper = source.slice(
    source.indexOf("async function loadThreadHistory"),
    source.indexOf("async function applyUrlState")
  );

  assert.ok(historyHelper, "offline-chat should keep a dedicated history startup validator");
  assert.equal(
    historyHelper[0].includes("ensureThreadStartupCache().phase_1"),
    false,
    "history reads must not rewrite bootstrap.threadStartup.phase_1"
  );
  assert.equal(
    historyHelper[0].includes("invalidateBootstrapThreadView"),
    false,
    "history reads must not invalidate bootstrap-derived thread views"
  );
  assert.equal(
    historyHelper[0].includes("canonicalSignature"),
    true,
    "history startup metadata must be checked against canonical bootstrap startup truth"
  );
  assert.equal(
    historyHelper[0].includes("historyProtocolKey"),
    true,
    "history startup metadata must include protocol key/version checks"
  );
  assert.equal(
    /let historyAccepted = acceptsThreadStartupFromHistory\(history,\s*startupContext\);/u.test(loadHistoryHelper),
    true,
    "history reads must reject mismatched startup truth before writing history state"
  );
  assert.equal(
    /invalidateThreadHistoryState\(threadId\);\s*throw createOfflineChatStartupMismatchError\(threadId,\s*history\?\.threadStartup\?\.phaseKey\);/u.test(loadHistoryHelper),
    true,
    "history reads must surface a dedicated startup mismatch error when startup truth diverges"
  );
  assert.equal(
    source.includes("if (!acceptsThreadStartupFromHistory(result)) {\n    return false;\n  }"),
    true,
    "runtime preview writes must reject mismatched startup truth instead of applying preview state"
  );
});

test("offline chat history reload refreshes canonical startup truth once before fail-closed reject", () => {
  const source = fs.readFileSync(path.join(rootDir, "public/offline-chat-app.js"), "utf8");
  const loadHistoryHelper = source.slice(
    source.indexOf("async function loadThreadHistory"),
    source.indexOf("async function applyUrlState")
  );

  assert.match(
    loadHistoryHelper,
    /let historyAccepted = acceptsThreadStartupFromHistory\(history,\s*startupContext\);/u
  );
  assert.match(
    loadHistoryHelper,
    /startupContext = await refreshGroupThreadStartupContext\(\{\s*requestVersion,\s*requestThreadId:\s*threadId,\s*failSoft:\s*false\s*\}\);/u
  );
  assert.match(
    loadHistoryHelper,
    /invalidateThreadHistoryState\(threadId\);\s*throw createOfflineChatStartupMismatchError\(threadId,\s*history\?\.threadStartup\?\.phaseKey\);/u
  );
});

test("offline chat startup mismatch clears stale snapshot fallbacks instead of restoring them", () => {
  const source = fs.readFileSync(path.join(rootDir, "public/offline-chat-app.js"), "utf8");

  assert.match(source, /function invalidateBootstrapThreadHistory\(threadId\)/u);
  assert.match(source, /function invalidateThreadHistoryState\(threadId\)/u);
  assert.match(
    source,
    /showNotice\(describeOfflineChatStartupMismatch\(mismatchedThreadId\),\s*\{\s*level:\s*"warning"\s*\}\);/u
  );
  assert.match(
    source,
    /if\s*\(needsReload && !startupMismatch\)\s*\{\s*restoreThreadHistorySnapshot\(threadId,\s*historySnapshot\);/u
  );
  assert.match(
    source,
    /if\s*\(!startupMismatch\)\s*\{\s*restoreThreadHistorySnapshot\(threadId,\s*historySnapshot\);/u
  );
  assert.match(
    source,
    /if\s*\(needsReload && !startupMismatch\)\s*\{\s*restoreThreadHistorySnapshot\(nextThreadId,\s*historySnapshot\);/u
  );
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

test("buildOperatorTruthSnapshot keeps operator detail lists on shared truth and avoids page-local recompute", () => {
  const snapshot = buildOperatorTruthSnapshot({
    security: {
      securityPosture: {
        mode: "read_only",
        summary: "当前先锁边界。",
        writeLocked: true,
        executionLocked: true,
        networkEgressLocked: false,
        updatedAt: "2026-04-17T08:00:00.000Z",
      },
      securityArchitecture: {
        operatorHandbook: {
          summary: "按固定顺序收口值班判断。",
          standardActionsSummary: "遇到高风险异常先执行标准动作。",
          roles: [{ roleId: "operator" }],
          decisionSequence: [{ stepId: "lock" }],
          standardActions: [{ actionId: "preserve" }],
        },
      },
      agentRuntimeTruth: {
        localFirst: true,
        policy: "记忆稳态引擎本地推理优先，本地答案不过关时再切联网增强。",
        onlineAllowed: true,
        qualityEscalationRuns: 1,
        latestQualityEscalationActivated: true,
        latestQualityEscalationProvider: "openai_compatible",
        latestQualityEscalationReason: "verification_invalid",
        latestQualityEscalationIssueCodes: ["agent_id_mismatch"],
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilitySignalSource: "runtime_memory",
        latestMemoryStabilityPreflightStatus: "performed",
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityObservationKind: "correction_rebuild",
        latestMemoryStabilityRecoverySignal: "risk_rising",
        latestMemoryStabilityCorrectionActions: ["rewrite_working_memory_summary"],
        memoryStabilityRecoveryRate: 0,
        latestMemoryStabilityUpdatedAt: "2026-04-17T08:05:00.000Z",
        memoryStabilityStateCount: 1,
      },
    },
    setup: {
      deviceRuntime: {
        constrainedExecutionSummary: {
          status: "bounded",
          summary: "受限执行当前只允许有界放行。",
          systemBrokerSandbox: {
            status: "enforced",
            summary: "系统级调度沙箱已强制启用。",
          },
          allowShellExecution: true,
          allowExternalNetwork: false,
          riskPolicy: {
            summary: "高风险动作仍需确认。",
            tiers: [
              { tierId: "high", hook: "request_explicit_confirmation" },
              { tierId: "critical", hook: "create_multisig_proposal" },
            ],
            capabilityFloors: [{ capability: "shell", minimumRiskTier: "high" }],
          },
          commandPolicy: {
            floorAdjustments: [{ tier: "medium", requestedStrategy: "allow", effectiveStrategy: "confirm" }],
            riskStrategies: {
              low: "allow",
              medium: "confirm",
              high: "request_explicit_confirmation",
              critical: "create_multisig_proposal",
            },
          },
        },
      },
      formalRecoveryFlow: {
        status: "partial",
        summary: "正式恢复主线还没完全收口。",
        runbook: {
          nextStepLabel: "补导出最新恢复包",
          summary: "先导出恢复包，再做恢复演练。",
        },
        handoffPacket: {
          summary: "交接字段已整理。",
          requiredFields: [
            {
              label: "恢复包",
              status: "ready",
              value: "bundle#1",
              summary: "最新恢复包已经归档。",
            },
          ],
        },
        operationalCadence: {
          status: "due_soon",
          summary: "恢复窗口即将到期。",
          actionSummary: "马上补跑恢复演练。",
          rerunTriggers: ["恢复包更新后重跑演练"],
        },
        crossDeviceRecoveryClosure: {
          status: "ready_for_rehearsal",
          summary: "源机器已就绪，可开始目标机演练。",
          readyForRehearsal: true,
          readyForCutover: false,
          nextStepLabel: "去目标机执行恢复演练",
          sourceReadiness: {
            formalFlowReady: true,
            cadenceStatus: "within_window",
          },
          latestBundle: {
            createdAt: "2026-04-17T08:10:00.000Z",
          },
          latestSetupPackage: {
            exportedAt: "2026-04-17T08:20:00.000Z",
          },
          latestPassedRecoveryRehearsal: {
            createdAt: "2026-04-17T08:30:00.000Z",
          },
          targetVerificationChecks: ["核对目标机 setup package"],
          steps: [{ label: "导入恢复包", status: "ready", summary: "已导入目标机。" }],
          cutoverGate: {
            summary: "演练通过前不能宣布可切机。",
          },
        },
      },
      automaticRecoveryReadiness: {
        status: "armed_with_gaps",
        summary: "自动恢复可启动，但不能冒充正式恢复完成。",
        operatorBoundary: {
          formalFlowReady: false,
          summary: "正式恢复当前仍未达标。",
        },
      },
    },
  });

  assert.equal(snapshot.readyForDecision, true);
  assert.equal(snapshot.readyForSmoke, true);
  assert.deepEqual(snapshot.missingFields, []);
  assert.deepEqual(snapshot.postureDetails, [
    "写入：锁定",
    "执行：锁定",
    "外网：可用",
    "最近更新时间：2026-04-17T08:00:00.000Z",
  ]);
  assert.deepEqual(snapshot.recoveryDetails, [
    "下一步：补导出最新恢复包",
    "周期：即将到期",
    "马上补跑恢复演练。",
    "先导出恢复包，再做恢复演练。",
  ]);
  assert.deepEqual(snapshot.execDetails, [
    "系统级调度沙箱：已强制启用",
    "命令执行：当前仅允许放行清单内命令",
    "外网：默认关闭或被门禁拦住",
    "风险放行：高风险动作仍需确认。",
    "确认钩子：high=显式确认后执行 / critical=创建多签提案",
    "策略纠偏：medium:allow→confirm",
    "能力下限：shell>=high",
    "命令策略：low=allow / medium=confirm / high=request_explicit_confirmation / critical=create_multisig_proposal",
  ]);
  assert.equal(snapshot.agentRuntimeTitle, "本地优先已启用 / 最近一次已触发质量升级");
  assert.deepEqual(snapshot.agentRuntimeDetails, [
    "记忆稳态引擎本地推理优先，本地答案不过关时再切联网增强。",
    "联网增强：允许作为质量升级后备",
    "累计质量升级：1 次",
    "最近升级通道：联网增强",
    "最近校验问题：agent id mismatch",
    "记忆稳态：中度纠偏，风险 0.41",
    "信号来源：runtime memory",
    "观测类型：correction rebuild",
    "预检状态：performed",
    "记忆稳态状态数：1",
    "最近状态 ID：memory_state_1",
    "最近信号更新时间：2026-04-17T08:05:00.000Z",
    "恢复信号：risk rising",
    "纠偏动作：rewrite working memory summary",
    "近窗纠偏恢复率：0.00",
  ]);
  assert.deepEqual(snapshot.crossDeviceDetails, [
    "源机器正式恢复：已就绪",
    "本机恢复周期：窗口内",
    "最新恢复包：2026-04-17T08:10:00.000Z",
    "最新初始化包：2026-04-17T08:20:00.000Z",
    "最近本机恢复演练：2026-04-17T08:30:00.000Z",
  ]);
  assert.deepEqual(snapshot.crossDeviceChecks, ["核对目标机 setup package"]);
  assert.deepEqual(snapshot.crossDeviceStepCards, [
    {
      tone: "ready",
      title: "导入恢复包 · 已就绪",
      detail: "已导入目标机。",
      notes: [],
    },
  ]);
  assert.deepEqual(snapshot.handoffCards, [
    {
      tone: "ready",
      title: "恢复包 · 已就绪",
      detail: "bundle#1",
      notes: ["最新恢复包已经归档。"],
    },
  ]);
});

test("buildOperatorTruthSnapshot keeps active agent runtime correction blocked until observation truth arrives", () => {
  const snapshot = buildOperatorTruthSnapshot({
    security: {
      securityPosture: {
        mode: "normal",
        summary: "运行态安全姿态正常。",
      },
      securityArchitecture: {
        operatorHandbook: {
          summary: "按固定顺序收口值班判断。",
          standardActionsSummary: "遇到高风险异常先执行标准动作。",
          roles: [{ roleId: "operator" }],
          decisionSequence: [{ stepId: "lock" }],
          standardActions: [{ actionId: "preserve" }],
        },
      },
      agentRuntimeTruth: {
        localFirst: true,
        policy: "记忆稳态引擎本地推理优先，本地答案不过关时再切联网增强。",
        onlineAllowed: true,
        qualityEscalationRuns: 0,
        latestQualityEscalationActivated: false,
        memoryStabilityStateCount: 1,
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
      },
      automaticRecovery: {
        status: "ready",
        summary: "自动恢复值班边界已确认。",
        operatorBoundary: {
          formalFlowReady: true,
          summary: "正式恢复已达标。",
        },
      },
    },
    setup: {
      deviceRuntime: {
        constrainedExecutionSummary: {
          status: "bounded",
          summary: "受限执行当前只允许有界放行。",
          systemBrokerSandbox: {
            status: "enforced",
            summary: "系统级调度沙箱已强制启用。",
          },
        },
      },
      formalRecoveryFlow: {
        status: "ready",
        summary: "正式恢复主线已就绪。",
        runbook: {
          nextStepLabel: "继续巡检。",
        },
        handoffPacket: {
          summary: "交接字段已整理。",
          requiredFields: [{ label: "恢复包", status: "ready", value: "bundle#1" }],
        },
        operationalCadence: {
          status: "within_window",
          actionSummary: "继续巡检。",
          rerunTriggers: ["恢复包更新后重跑演练"],
        },
        crossDeviceRecoveryClosure: {
          status: "ready_for_rehearsal",
          readyForRehearsal: true,
          readyForCutover: false,
          nextStepLabel: "去目标机执行恢复演练",
          cutoverGate: {
            summary: "演练通过前不能宣布可切机。",
          },
        },
      },
      automaticRecoveryReadiness: {
        status: "ready",
        summary: "自动恢复值班边界已确认。",
        operatorBoundary: {
          formalFlowReady: true,
          summary: "正式恢复已达标。",
        },
      },
    },
  });

  assert.equal(snapshot.readyForDecision, false);
  assert(snapshot.missingFields.includes("agentRuntime.latestMemoryStabilityObservationKind"));
  assert(snapshot.missingFields.includes("agentRuntime.memoryStabilityRecoveryRate"));
  assert(snapshot.missingFields.includes("agentRuntime.latestMemoryStabilityCorrectionActions"));
});

test("buildOperatorTruthSnapshot promotes runner guard blocks into the primary agent-runtime decision truth", () => {
  const snapshot = buildOperatorTruthSnapshot({
    security: {
      securityPosture: {
        mode: "normal",
        summary: "运行态安全姿态正常。",
      },
      securityArchitecture: {
        operatorHandbook: {
          summary: "按固定顺序收口值班判断。",
          standardActionsSummary: "遇到高风险异常先执行标准动作。",
          roles: [{ roleId: "operator" }],
          decisionSequence: [{ stepId: "lock" }],
          standardActions: [{ actionId: "preserve" }],
        },
      },
      agentRuntimeTruth: {
        localFirst: true,
        policy: "记忆稳态引擎本地推理优先，本地答案不过关时再切联网增强。",
        onlineAllowed: true,
        latestRunStatus: "blocked",
        latestRunnerGuardActivated: true,
        latestRunnerGuardBlockedBy: "memory_stability_prompt_pretransform",
        latestRunnerGuardCode: "MEMORY_STABILITY_RUNTIME_LOAD_FAILED",
        latestRunnerGuardStage: "contract_validation",
        latestRunnerGuardReceiptStatus: "blocked_preflight",
        latestRunnerGuardExplicitRequestKinds: ["prompt_pretransform"],
        qualityEscalationRuns: 0,
        latestQualityEscalationActivated: false,
        memoryStabilityStateCount: 1,
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityObservationKind: "correction_rebuild",
        latestMemoryStabilityRecoverySignal: "risk_rising",
        latestMemoryStabilityCorrectionActions: ["rewrite_working_memory_summary"],
        memoryStabilityRecoveryRate: 0,
        latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
      },
      automaticRecovery: {
        status: "ready",
        summary: "自动恢复值班边界已确认。",
        operatorBoundary: {
          formalFlowReady: true,
          summary: "正式恢复已达标。",
        },
      },
    },
    setup: {
      deviceRuntime: {
        constrainedExecutionSummary: {
          status: "bounded",
          summary: "受限执行当前只允许有界放行。",
          systemBrokerSandbox: {
            status: "enforced",
            summary: "系统级调度沙箱已强制启用。",
          },
        },
      },
      formalRecoveryFlow: {
        status: "ready",
        summary: "正式恢复主线已就绪。",
        runbook: {
          nextStepLabel: "继续巡检。",
        },
        handoffPacket: {
          summary: "交接字段已整理。",
          requiredFields: [{ label: "恢复包", status: "ready", value: "bundle#1" }],
        },
        operationalCadence: {
          status: "within_window",
          actionSummary: "继续巡检。",
          rerunTriggers: ["恢复包更新后重跑演练"],
        },
        crossDeviceRecoveryClosure: {
          status: "ready_for_rehearsal",
          readyForRehearsal: true,
          readyForCutover: false,
          nextStepLabel: "去目标机执行恢复演练",
          cutoverGate: {
            summary: "演练通过前不能宣布可切机。",
          },
        },
      },
      automaticRecoveryReadiness: {
        status: "ready",
        summary: "自动恢复值班边界已确认。",
        operatorBoundary: {
          formalFlowReady: true,
          summary: "正式恢复已达标。",
        },
      },
    },
  });

  assert.equal(snapshot.readyForDecision, true);
  assert.equal(snapshot.agentRuntimeTitle, "本地优先已启用 / 最近一次因记忆稳态护栏被阻断");
  assert.match(snapshot.agentRuntimeDetails.join(" "), /阻断点：prompt 预变换/u);
  assert.match(snapshot.agentRuntimeDetails.join(" "), /阻断码：MEMORY_STABILITY_RUNTIME_LOAD_FAILED/u);
  assert(snapshot.alerts.some((entry) => entry?.title === "最近一次运行被记忆稳态护栏阻断"));
  assert.match(snapshot.nextAction, /先修复记忆稳态护栏阻断/u);
});

test("buildOperatorTruthSnapshot keeps runner guard decisions ahead of generic release readiness copy", () => {
  const snapshot = buildOperatorTruthSnapshot({
    security: {
      releaseReadiness: {
        status: "blocked",
        summary: "当前先处理跨机器恢复门槛。",
        nextAction: "先去目标机执行恢复演练。",
        blockedBy: [{ severity: "high", label: "跨机器恢复现在只能做演练", detail: "目标机还没通过核验。" }],
      },
      securityPosture: {
        mode: "normal",
        summary: "运行态安全姿态正常。",
      },
      securityArchitecture: {
        operatorHandbook: {
          summary: "按固定顺序收口值班判断。",
          standardActionsSummary: "遇到高风险异常先执行标准动作。",
          roles: [{ roleId: "operator" }],
          decisionSequence: [{ stepId: "lock" }],
          standardActions: [{ actionId: "preserve" }],
        },
      },
      agentRuntimeTruth: {
        localFirst: true,
        policy: "记忆稳态引擎本地推理优先，本地答案不过关时再切联网增强。",
        onlineAllowed: true,
        latestRunStatus: "blocked",
        latestRunnerGuardActivated: true,
        latestRunnerGuardBlockedBy: "memory_stability_prompt_pretransform",
        latestRunnerGuardCode: "MEMORY_STABILITY_RUNTIME_LOAD_FAILED",
        latestRunnerGuardStage: "contract_validation",
        latestRunnerGuardReceiptStatus: "blocked_preflight",
        latestRunnerGuardExplicitRequestKinds: ["prompt_pretransform"],
        qualityEscalationRuns: 0,
        latestQualityEscalationActivated: false,
        memoryStabilityStateCount: 1,
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityObservationKind: "correction_rebuild",
        latestMemoryStabilityRecoverySignal: "risk_rising",
        latestMemoryStabilityCorrectionActions: ["rewrite_working_memory_summary"],
        memoryStabilityRecoveryRate: 0,
        latestMemoryStabilityUpdatedAt: "2026-04-24T10:00:00.000Z",
      },
      automaticRecovery: {
        status: "ready",
        summary: "自动恢复值班边界已确认。",
        operatorBoundary: {
          formalFlowReady: true,
          summary: "正式恢复已达标。",
        },
      },
    },
    setup: {
      deviceRuntime: {
        constrainedExecutionSummary: {
          status: "bounded",
          summary: "受限执行当前只允许有界放行。",
          systemBrokerSandbox: {
            status: "enforced",
            summary: "系统级调度沙箱已强制启用。",
          },
        },
      },
      formalRecoveryFlow: {
        status: "ready",
        summary: "正式恢复主线已就绪。",
        runbook: {
          nextStepLabel: "继续巡检。",
        },
        handoffPacket: {
          summary: "交接字段已整理。",
          requiredFields: [{ label: "恢复包", status: "ready", value: "bundle#1" }],
        },
        operationalCadence: {
          status: "within_window",
          actionSummary: "继续巡检。",
          rerunTriggers: ["恢复包更新后重跑演练"],
        },
        crossDeviceRecoveryClosure: {
          status: "ready_for_rehearsal",
          readyForRehearsal: true,
          readyForCutover: false,
          nextStepLabel: "去目标机执行恢复演练",
          cutoverGate: {
            summary: "演练通过前不能宣布可切机。",
          },
        },
      },
      automaticRecoveryReadiness: {
        status: "ready",
        summary: "自动恢复值班边界已确认。",
        operatorBoundary: {
          formalFlowReady: true,
          summary: "正式恢复已达标。",
        },
      },
    },
  });

  assert.equal(snapshot.decisionSummary, "当前先处理最近一次运行被记忆稳态护栏阻断。");
  assert.match(snapshot.nextAction, /先修复记忆稳态护栏阻断/u);
});

test("buildOperatorTruthSnapshot marks posture and execution details unknown when truth is missing", () => {
  const snapshot = buildOperatorTruthSnapshot();

  assert.equal(snapshot.authSummary, OPERATOR_AUTH_SUMMARY_PUBLIC);
  assert.equal(snapshot.protectedStatus, OPERATOR_PROTECTED_STATUS_PUBLIC);
  assert.equal(snapshot.exportStatus, OPERATOR_EXPORT_STATUS_SETUP_REQUIRED);
  assert.equal(snapshot.readyForDecision, false);
  assert(snapshot.missingFields.includes("deviceSetup.protectedTruth"));
  assert(snapshot.missingFields.includes("securityPosture.mode"));
  assert(snapshot.missingFields.includes("agentRuntime"));
  assert.deepEqual(snapshot.postureDetails, ["写入：未确认", "执行：未确认", "外网：未确认"]);
  assert.deepEqual(snapshot.execDetails, ["状态：未确认"]);
  assert.deepEqual(snapshot.agentRuntimeDetails, ["状态：未确认"]);
});

test("stored admin token helpers migrate legacy session state into the canonical session key", () => {
  const sessionStorage = createMockStorage({
    [LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY]: " legacy-session-token ",
  });
  const localStorage = createMockStorage({
    [LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY]: "legacy-local-token",
  });

  assert.equal(readStoredAdminToken({ sessionStorage, localStorage }), "legacy-session-token");
  assert.equal(migrateStoredAdminToken({ sessionStorage, localStorage }), "legacy-session-token");
  assert.deepEqual(sessionStorage.snapshot(), {
    [ADMIN_TOKEN_STORAGE_KEY]: "legacy-session-token",
  });
  assert.deepEqual(localStorage.snapshot(), {});

  assert.equal(writeStoredAdminToken(" next-token ", { sessionStorage, localStorage }), "next-token");
  assert.equal(readStoredAdminToken({ sessionStorage, localStorage }), "next-token");
  assert.equal(writeStoredAdminToken("", { sessionStorage, localStorage }), "");
  assert.deepEqual(sessionStorage.snapshot(), {});
});

test("stored admin token helpers keep the canonical session token ahead of legacy fallbacks", () => {
  const sessionStorage = createMockStorage({
    [ADMIN_TOKEN_STORAGE_KEY]: "primary-token",
    [LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY]: "legacy-session-token",
  });
  const localStorage = createMockStorage({
    [LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY]: "legacy-local-token",
  });

  assert.equal(readStoredAdminToken({ sessionStorage, localStorage }), "primary-token");
  assert.equal(migrateStoredAdminToken({ sessionStorage, localStorage }), "primary-token");
  assert.deepEqual(sessionStorage.snapshot(), {
    [ADMIN_TOKEN_STORAGE_KEY]: "primary-token",
  });
  assert.deepEqual(localStorage.snapshot(), {});
});

test("stored admin token migration keeps canonical-only sessions passive", () => {
  const sessionStorage = createMockStorage({
    [ADMIN_TOKEN_STORAGE_KEY]: "primary-token",
  });
  const localStorage = createMockStorage();

  assert.equal(migrateStoredAdminToken({ sessionStorage, localStorage }), "primary-token");
  assert.deepEqual(sessionStorage.snapshot(), {
    [ADMIN_TOKEN_STORAGE_KEY]: "primary-token",
  });
  assert.deepEqual(localStorage.snapshot(), {});
  assert.deepEqual(
    sessionStorage.operations().filter(([operation]) => operation !== "getItem"),
    []
  );
  assert.deepEqual(
    localStorage.operations().filter(([operation]) => operation !== "getItem"),
    []
  );
});

test("stored admin token helpers keep legacy fallback when canonical writes fail", () => {
  const sessionStorage = createMockStorage(
    {
      [LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY]: " legacy-session-token ",
    },
    {
      failSetKeys: [ADMIN_TOKEN_STORAGE_KEY],
    }
  );
  const localStorage = createMockStorage({
    [LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY]: "legacy-local-token",
  });

  assert.equal(migrateStoredAdminToken({ sessionStorage, localStorage }), "legacy-session-token");
  assert.deepEqual(sessionStorage.snapshot(), {
    [LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY]: " legacy-session-token ",
  });
  assert.deepEqual(localStorage.snapshot(), {
    [LEGACY_ADMIN_TOKEN_LOCAL_STORAGE_KEY]: "legacy-local-token",
  });

  assert.equal(writeStoredAdminToken("next-token", { sessionStorage, localStorage }), "legacy-session-token");
  assert.deepEqual(sessionStorage.snapshot(), {
    [LEGACY_ADMIN_TOKEN_SESSION_STORAGE_KEY]: " legacy-session-token ",
  });
});

test("stored admin token migration is a no-op when no legacy token exists", () => {
  const sessionStorage = createMockStorage();
  const localStorage = createMockStorage();

  assert.equal(migrateStoredAdminToken({ sessionStorage, localStorage }), "");
  assert.deepEqual(sessionStorage.snapshot(), {});
  assert.deepEqual(localStorage.snapshot(), {});
  assert.deepEqual(
    sessionStorage.operations().filter(([operation]) => operation !== "getItem"),
    []
  );
  assert.deepEqual(
    localStorage.operations().filter(([operation]) => operation !== "getItem"),
    []
  );
});

test("runtime truth client keeps legacy admin token storage keys inside the compat helper", () => {
  const runtimeTruthSource = fs.readFileSync(path.join(rootDir, "public", "runtime-truth-client.js"), "utf8");
  const compatSource = fs.readFileSync(path.join(rootDir, "public", "admin-token-storage-compat.js"), "utf8");

  assert.match(runtimeTruthSource, /from "\.\/admin-token-storage-compat\.js"/u);
  assert.doesNotMatch(runtimeTruthSource, /openneed-runtime\.admin-token-session/u);
  assert.doesNotMatch(runtimeTruthSource, /openneed-agent-passport\.admin-token/u);
  assert.match(compatSource, /openneed-runtime\.admin-token-session/u);
  assert.match(compatSource, /openneed-agent-passport\.admin-token/u);
});

test("runtime truth client keeps legacy runtime housekeeping storage keys inside the compat helper", () => {
  const runtimeTruthSource = fs.readFileSync(path.join(rootDir, "public", "runtime-truth-client.js"), "utf8");
  const compatSource = fs.readFileSync(
    path.join(rootDir, "public", "runtime-housekeeping-storage-compat.js"),
    "utf8"
  );

  assert.doesNotMatch(runtimeTruthSource, /openneed-runtime\.runtime-housekeeping-last-report-session/u);
  assert.doesNotMatch(runtimeTruthSource, /openneed-agent-passport\.runtime-housekeeping-last-report/u);
  assert.match(compatSource, /openneed-runtime\.runtime-housekeeping-last-report-session/u);
  assert.match(compatSource, /openneed-agent-passport\.runtime-housekeeping-last-report/u);
});

test("runtime housekeeping last-report helpers migrate legacy storage into the canonical session key", () => {
  const sessionStorage = createMockStorage({
    [LEGACY_RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY]: JSON.stringify({ summary: "legacy-session" }),
  });
  const localStorage = createMockStorage({
    [LEGACY_RUNTIME_HOUSEKEEPING_LAST_REPORT_LOCAL_STORAGE_KEY]: JSON.stringify({ summary: "legacy-local" }),
  });

  assert.deepEqual(readStoredRuntimeHousekeepingLastReport({ sessionStorage, localStorage }), { summary: "legacy-session" });
  assert.deepEqual(migrateStoredRuntimeHousekeepingLastReport({ sessionStorage, localStorage }), { summary: "legacy-session" });
  assert.deepEqual(sessionStorage.snapshot(), {
    [RUNTIME_HOUSEKEEPING_LAST_REPORT_SESSION_STORAGE_KEY]: JSON.stringify({ summary: "legacy-session" }),
  });
  assert.deepEqual(localStorage.snapshot(), {});

  assert.deepEqual(
    writeStoredRuntimeHousekeepingLastReport({ summary: "next-report" }, { sessionStorage, localStorage }),
    { summary: "next-report" }
  );
  assert.deepEqual(readStoredRuntimeHousekeepingLastReport({ sessionStorage, localStorage }), { summary: "next-report" });
  assert.equal(writeStoredRuntimeHousekeepingLastReport(null, { sessionStorage, localStorage }), null);
  assert.deepEqual(sessionStorage.snapshot(), {});
});

test("buildAdminTokenHeaders centralizes JSON and Authorization header construction", () => {
  const sessionStorage = createMockStorage({
    [ADMIN_TOKEN_STORAGE_KEY]: " stored-token ",
  });
  const localStorage = createMockStorage();

  assert.deepEqual(buildAdminTokenHeaders({ token: "" }), {
    "Content-Type": "application/json",
  });
  assert.deepEqual(buildAdminTokenHeaders({ token: " typed-token " }), {
    "Content-Type": "application/json",
    Authorization: "Bearer typed-token",
  });
  assert.deepEqual(buildAdminTokenHeaders({ sessionStorage, localStorage }), {
    "Content-Type": "application/json",
    Authorization: "Bearer stored-token",
  });
  assert.deepEqual(
    buildAdminTokenHeaders({
      token: " typed-token ",
      headers: {
        Authorization: "Bearer override-token",
        "X-Trace": "trace-1",
      },
      includeJsonContentType: false,
    }),
    {
      Authorization: "Bearer override-token",
      "X-Trace": "trace-1",
    }
  );
});

test("public admin-token fetches use the shared header helper", () => {
  for (const filename of ["operator.html", "repair-hub.html", "lab.html", "offline-chat-app.js"]) {
    const source = fs.readFileSync(path.join(rootDir, "public", filename), "utf8");

    assert.match(source, /buildAdminTokenHeaders/u, filename);
    assert.doesNotMatch(source, /headers\.Authorization/u, filename);
    assert.doesNotMatch(source, /Authorization:\s*`Bearer/u, filename);
  }
});

test("formatProtectedReadSurface keeps protected read errors on canonical path labels", () => {
  assert.equal(formatProtectedReadSurface("/api/migration-repairs?limit=5"), "/api/migration-repairs");
  assert.equal(formatProtectedReadSurface("/api/device/setup"), "/api/device/setup");
  assert.equal(formatProtectedReadSurface("", "受保护修复接口"), "受保护修复接口");
});

test("buildAdminTokenAuthSummary keeps admin-token state copy centralized", () => {
  assert.equal(
    buildAdminTokenAuthSummary({
      hasToken: true,
      tokenStoreLabel: "当前标签页",
      savedDetail: "离线线程运行信息会走受保护接口。",
    }),
    "当前标签页已保存管理令牌；离线线程运行信息会走受保护接口。"
  );
  assert.equal(
    buildAdminTokenAuthSummary({
      hasToken: false,
      missingDetail: "如果受保护接口返回 401，可先临时录入令牌",
    }),
    "当前标签页会话里未保存管理令牌；如果受保护接口返回 401，可先临时录入令牌。"
  );
});

test("describeProtectedReadFailure separates missing token, rejected token, and read-session scope failures", () => {
  const missing = describeProtectedReadFailure({
    surface: "/api/device/setup?x=1",
    statusCode: 401,
    hasStoredAdminToken: false,
    publicTruthFallback: true,
  });
  assert.equal(missing.category, "admin_token_missing");
  assert.equal(missing.readScope, "/api/device/setup");
  assert.match(missing.authMessage, /未保存管理令牌/u);
  assert.match(missing.statusMessage, /继续显示公开真值/u);

  const rejected = describeProtectedReadFailure({
    surface: "/api/security/runtime-housekeeping",
    statusCode: 401,
    hasStoredAdminToken: true,
    operation: "调用",
  });
  assert.equal(rejected.category, "admin_token_rejected");
  assert.match(rejected.nextAction, /重新录入管理令牌/u);

  const denied = describeProtectedReadFailure({
    surface: "/api/security/read-sessions",
    statusCode: 403,
    hasStoredAdminToken: true,
    backendError: "Read session is not allowed",
  });
  assert.equal(denied.category, "read_session_scope_denied");
  assert.match(denied.nextAction, /admin-only/u);
  assert.match(denied.nextAction, /重新派生/u);

  const scopeRejected = describeProtectedReadFailure({
    surface: "/api/security/read-sessions",
    statusCode: 401,
    hasStoredAdminToken: true,
    errorClass: "read_session_rejected",
    readSessionReason: "scope_mismatch",
  });
  assert.equal(scopeRejected.category, "read_session_scope_denied");
  assert.match(scopeRejected.nextAction, /重新派生/u);
});

test("offline chat app keeps scope-denied 403 separate from token-rejected 401", () => {
  const source = fs.readFileSync(path.join(rootDir, "public/offline-chat-app.js"), "utf8");
  assert.doesNotMatch(source, /response\.status\s*===\s*401\s*\|\|\s*response\.status\s*===\s*403/u);
  assert.match(source, /if\s*\(response\.status\s*===\s*401\)/u);
  assert.match(source, /if\s*\(response\.status\s*===\s*403\)/u);

  const forbiddenHandler = source.slice(
    source.indexOf("function handleOfflineChatForbidden"),
    source.indexOf("function resolveSourceLabel")
  );
  assert.match(forbiddenHandler, /renderAuthState/u);
  assert.match(forbiddenHandler, /setProtectedAccessState/u);
  assert.match(forbiddenHandler, /renderPublicBootstrapState/u);
  assert.doesNotMatch(forbiddenHandler, /setStoredAdminToken\s*\(\s*""\s*\)/u);
  assert.doesNotMatch(forbiddenHandler, /resetProtectedThreadState/u);
});

test("offline chat protected reads keep rejected tokens and loaded state", () => {
  const source = fs.readFileSync(path.join(rootDir, "public/offline-chat-app.js"), "utf8");
  const requestHelper = source.slice(source.indexOf("async function request"), source.indexOf("function activeThread"));
  const unauthorizedHandler = source.slice(
    source.indexOf("function handleOfflineChatUnauthorized"),
    source.indexOf("function resetOfflineChatUnauthorized")
  );
  const explicitResetHandler = source.slice(
    source.indexOf("function resetOfflineChatUnauthorized"),
    source.indexOf("function handleOfflineChatForbidden")
  );
  const bootstrapHelper = source.slice(source.indexOf("async function bootstrap"), source.indexOf("async function sendMessage"));
  const tokenSubmitHandler = source.slice(
    source.indexOf('elements.authTokenForm?.addEventListener("submit"'),
    source.indexOf("elements.authClearButton?.addEventListener")
  );

  assert.match(requestHelper, /resetOnUnauthorized\s*=\s*false/u);
  assert.match(unauthorizedHandler, /setProtectedAccessState/u);
  assert.match(unauthorizedHandler, /renderPublicBootstrapState/u);
  assert.doesNotMatch(unauthorizedHandler, /setStoredAdminToken\s*\(\s*""\s*\)/u);
  assert.doesNotMatch(unauthorizedHandler, /resetProtectedThreadState/u);
  assert.match(explicitResetHandler, /setStoredAdminToken\s*\(\s*""\s*\)/u);
  assert.match(explicitResetHandler, /resetProtectedThreadState/u);
  assert.match(bootstrapHelper, /error\.offlineChatHandled/u);
  assert.match(tokenSubmitHandler, /bootstrap\(\{\s*resetOnUnauthorized:\s*true,\s*throwProtectedAccessError:\s*true\s*\}\)/u);
});

test("offline chat app resolves canonical direct-thread ids onto physical thread state", () => {
  const source = fs.readFileSync(path.join(rootDir, "public/offline-chat-app.js"), "utf8");
  const directRouteHelper = source.slice(source.indexOf("function directThreadRouteId"), source.indexOf("function listThreadRouteIds"));
  const routeHelper = source.slice(source.indexOf("function listThreadRouteIds"), source.indexOf("function activeSourceFilter"));
  const personaHelper = source.slice(source.indexOf("function listPersonaAgentIds"), source.indexOf("function normalizeParticipant"));
  const historyHelper = source.slice(source.indexOf("async function loadThreadHistory"), source.indexOf("async function applyUrlState"));
  const sendHelper = source.slice(source.indexOf("async function sendMessage"), source.indexOf("function buildOfflineChatError"));

  assert.match(directRouteHelper, /return\s+text\(thread\?\.routeThreadId\);/u);
  assert.doesNotMatch(directRouteHelper, /return\s+text\(thread\?\.routeThreadId\s*\|\|/u);
  assert.match(routeHelper, /routeThreadId/u);
  assert.doesNotMatch(routeHelper, /referenceAgentId/u);
  assert.doesNotMatch(routeHelper, /canonicalAgentId/u);
  assert.match(routeHelper, /findThreadByRouteId\(threadId\)/u);
  assert.match(routeHelper, /requestedThread\?\.threadId/u);
  assert.match(personaHelper, /resolvedResidentAgentId/u);
  assert.match(personaHelper, /routeAgentId/u);
  assert.doesNotMatch(personaHelper, /referenceAgentId/u);
  assert.doesNotMatch(personaHelper, /canonicalAgentId/u);
  assert.match(source, /OFFLINE_CHAT_ROUTE_TRUTH_ERROR_CODE/u);
  assert.match(source, /function requireDirectThreadRouteId/u);
  assert.match(historyHelper, /requireDirectThreadRouteId\(requestedThread\)/u);
  assert.doesNotMatch(historyHelper, /directThreadRouteId\(requestedThread\)\s*\|\|\s*text\(requestedThread\?\.threadId\)/u);
  assert.match(historyHelper, /\/api\/offline-chat\/threads\/\$\{encodeURIComponent\(requestThreadId\)\}\/messages/u);
  assert.match(sendHelper, /requireDirectThreadRouteId\(thread\)/u);
  assert.doesNotMatch(sendHelper, /directThreadRouteId\(thread\)\s*\|\|\s*text\(thread\?\.threadId\)/u);
  assert.match(sendHelper, /\/api\/offline-chat\/threads\/\$\{encodeURIComponent\(requestThreadId\)\}\/messages/u);
  assert.match(personaHelper, /listPersonaAgentIds\(entry\)\.includes\(normalized\)/u);
});

test("offline chat stack chip normalizes legacy openai-compatible model names", () => {
  const source = fs.readFileSync(path.join(rootDir, "public/offline-chat-app.js"), "utf8");
  const stackChipFormatter = source.slice(
    source.indexOf("function formatStackChip"),
    source.indexOf("function formatMessageSource")
  );

  assert.match(stackChipFormatter, /provider\s*===\s*"openai_compatible"/u);
  assert.match(stackChipFormatter, /displayAgentPassportLocalReasonerModel\(localReasoner\?\.model,\s*"未命名模型"\)/u);
  assert.doesNotMatch(stackChipFormatter, /\$\{text\(localReasoner\?\.model\)\s*\|\|\s*"未命名模型"\}/u);
});

test("buildOperatorDecisionCards keeps blocker, execution, and cross-device cards on shared truth", () => {
  const cards = buildOperatorDecisionCards({
    security: {
      releaseReadiness: {
        status: "blocked",
        summary: "当前先处理正式恢复周期缺口。",
        nextAction: "马上补跑恢复演练。",
        blockedBy: [
          {
            severity: "high",
            label: "正式恢复周期 已过期",
            detail: "恢复窗口已掉出安全范围。",
          },
        ],
      },
      localStorageFormalFlow: {
        runbook: {
          nextStepLabel: "补导出最新恢复包",
        },
      },
      agentRuntimeTruth: {
        localFirst: true,
        policy: "记忆稳态引擎本地推理优先，本地答案不过关时再切联网增强。",
        onlineAllowed: true,
        qualityEscalationRuns: 1,
        latestQualityEscalationActivated: true,
        latestQualityEscalationProvider: "openai_compatible",
        latestQualityEscalationReason: "verification_invalid",
        latestMemoryStabilityObservationKind: "correction_rebuild",
        latestMemoryStabilityRecoverySignal: "risk_rising",
        latestMemoryStabilityCorrectionActions: ["rewrite_working_memory_summary"],
        memoryStabilityRecoveryRate: 0,
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityUpdatedAt: "2026-04-17T08:05:00.000Z",
        memoryStabilityStateCount: 1,
      },
    },
    setup: {
      deviceRuntime: {
        constrainedExecutionSummary: {
          status: "locked",
          summary: "受限执行层当前已锁定。",
        },
      },
      formalRecoveryFlow: {
        runbook: {
          nextStepLabel: "补导出最新恢复包",
        },
        crossDeviceRecoveryClosure: {
          readyForCutover: false,
          readyForRehearsal: false,
          nextStepLabel: "补目标机核验",
          cutoverGate: {
            summary: "目标机固定顺序尚未核验通过。",
          },
        },
      },
    },
  });

  assert.equal(cards.length, 4);
  assert.deepEqual(cards[0], {
    title: "当前阻塞",
    main: "当前先处理正式恢复周期缺口。",
    note: "马上补跑恢复演练。",
    tone: "warn",
  });
  assert.deepEqual(cards[1], {
    title: "执行边界",
    main: "当前不能继续真实执行。",
    note: "受限执行层当前已锁定。",
    tone: "danger",
  });
  assert.deepEqual(cards[2], {
    title: "Agent 运行",
    main: "最近一次回答已触发质量升级。",
    note: "复核通道：联网增强；触发原因：本地答案未通过校验。",
    tone: "warn",
  });
  assert.deepEqual(cards[3], {
    title: "跨机门槛",
    main: "当前先 补目标机核验",
    note: "目标机固定顺序尚未核验通过。",
    tone: "danger",
  });
});

test("buildOperatorDecisionCards promotes runner guard blocks ahead of quality and memory commentary", () => {
  const cards = buildOperatorDecisionCards({
    security: {
      agentRuntimeTruth: {
        localFirst: true,
        policy: "记忆稳态引擎本地推理优先，本地答案不过关时再切联网增强。",
        onlineAllowed: true,
        latestRunStatus: "blocked",
        latestRunnerGuardActivated: true,
        latestRunnerGuardBlockedBy: "memory_stability_prompt_pretransform",
        latestRunnerGuardCode: "MEMORY_STABILITY_RUNTIME_LOAD_FAILED",
        latestRunnerGuardStage: "contract_validation",
        latestRunnerGuardReceiptStatus: "blocked_preflight",
        latestRunnerGuardExplicitRequestKinds: ["prompt_pretransform"],
        qualityEscalationRuns: 0,
        latestQualityEscalationActivated: false,
        latestMemoryStabilityObservationKind: "correction_rebuild",
        latestMemoryStabilityRecoverySignal: "risk_rising",
        latestMemoryStabilityCorrectionActions: ["rewrite_working_memory_summary"],
        memoryStabilityRecoveryRate: 0,
        latestMemoryStabilityCorrectionLevel: "medium",
        latestMemoryStabilityRiskScore: 0.41,
        latestMemoryStabilityStateId: "memory_state_1",
        latestMemoryStabilityUpdatedAt: "2026-04-17T08:05:00.000Z",
        memoryStabilityStateCount: 1,
      },
    },
    setup: {
      deviceRuntime: {
        constrainedExecutionSummary: {
          status: "bounded",
          summary: "受限执行层当前正常。",
        },
      },
      formalRecoveryFlow: {
        runbook: {
          nextStepLabel: "继续巡检",
        },
        crossDeviceRecoveryClosure: {
          readyForCutover: false,
          readyForRehearsal: true,
          nextStepLabel: "去目标机执行恢复演练",
          cutoverGate: {
            summary: "演练通过前不能宣布可切机。",
          },
        },
      },
    },
  });

  assert.deepEqual(cards[2], {
    title: "Agent 运行",
    main: "最近一次运行被记忆稳态护栏阻断。",
    note: "阻断点：prompt 预变换；阻断码：MEMORY_STABILITY_RUNTIME_LOAD_FAILED。",
    tone: "danger",
  });
});

test("buildOperatorDecisionCards uses the provided operator snapshot instead of recomputing page-local truth", () => {
  const snapshot = buildOperatorTruthSnapshot({
    setup: {
      deviceRuntime: {
        constrainedExecutionSummary: {
          status: "bounded",
          summary: "snapshot 执行边界有界放行。",
        },
      },
      formalRecoveryFlow: {
        crossDeviceRecoveryClosure: {
          status: "ready_for_rehearsal",
          readyForCutover: false,
          readyForRehearsal: true,
          summary: "snapshot 只允许目标机演练。",
        },
      },
    },
  });
  const cards = buildOperatorDecisionCards({
    snapshot,
    security: {
      constrainedExecution: {
        status: "locked",
        summary: "旧路径不应覆盖 snapshot。",
      },
      localStorageFormalFlow: {
        crossDeviceRecoveryClosure: {
          readyForCutover: false,
          readyForRehearsal: false,
          nextStepLabel: "旧路径阻塞",
        },
      },
    },
  });

  assert.equal(cards[1].main, "当前默认不放开真实执行。");
  assert.equal(cards[1].note, "snapshot 执行边界有界放行。");
  assert.equal(cards[2].main, "当前还没有拿到 agent 运行真值。");
  assert.equal(cards[2].note, "没有这份真值时，不要把本地优先、质量升级和记忆稳态当成已确认。");
  assert.equal(cards[3].main, "源机器已就绪，现在只允许做目标机导入与演练。");
  assert.equal(cards[3].note, "snapshot 只允许目标机演练。");
});

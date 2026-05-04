import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import {
  cleanupSmokeWrapperRuntime,
  ensureSmokeServer,
  prepareSmokeDataRoot,
  resolveSmokeBaseUrl,
} from "./smoke-server.mjs";
import { rootDir } from "./smoke-env.mjs";
import { extractTrailingJson } from "./smoke-all.mjs";
import { createSmokeHttpClient } from "./smoke-ui-http.mjs";

const __filename = fileURLToPath(import.meta.url);
const soakDirectExecution = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;
const MAIN_AGENT_ID = "agent_main";

function text(value) {
  return String(value ?? "").trim();
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readArgValue(prefix) {
  const entry = process.argv.find((value) => value.startsWith(`${prefix}=`));
  return entry ? entry.slice(prefix.length + 1) : "";
}

function buildScenarioCheck(id, label, passed, details = {}) {
  return {
    id,
    label,
    passed: passed === true,
    details,
  };
}

function summarizeFailedChecks(checks = []) {
  return (Array.isArray(checks) ? checks : []).filter((entry) => entry?.passed === false).map((entry) => entry.id);
}

function logSoakProgress(message, details = {}) {
  const detailText = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.error(`[soak-runtime] ${message}${detailText ? ` ${detailText}` : ""}`);
}

function buildStepMap(smokeJson = {}) {
  return new Map((Array.isArray(smokeJson?.steps) ? smokeJson.steps : []).map((entry) => [entry?.name, entry?.result || null]));
}

function buildPassportMemoryQueryPath(marker, limit = 5) {
  return `/api/agents/${MAIN_AGENT_ID}/passport-memory?query=${encodeURIComponent(marker)}&limit=${encodeURIComponent(limit)}`;
}

function isOperationalOnlySmoke(smokeJson = {}) {
  return smokeJson?.mode === "operational_only";
}

function resolveSmokeScriptConfig({ operationalOnly = false } = {}) {
  return operationalOnly
    ? {
        scriptName: "smoke-operational-gate.mjs",
        okCheckId: "smoke_operational_ok",
        okCheckLabel: "短运行态 smoke:operational 通过",
        roundCheckId: "smoke_operational_round",
        roundCheckLabel: "短运行态 smoke:operational 完成",
      }
    : {
        scriptName: "smoke-all.mjs",
        okCheckId: "smoke_all_ok",
        okCheckLabel: "整轮 smoke:all 通过",
        roundCheckId: "smoke_all_round",
        roundCheckLabel: "整轮 smoke:all 完成",
      };
}

function readOperationalUiResult(smokeJson = {}) {
  const stepMap = buildStepMap(smokeJson);
  return stepMap.get("smoke:ui:operational") || null;
}

function toFiniteMetric(value) {
  if (value == null || text(value) === "") {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) && Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

function toFiniteRatio(value) {
  if (value == null || text(value) === "") {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

function toMetricText(value) {
  const normalized = text(value);
  return normalized || null;
}

function toMetricTextList(values) {
  if (!Array.isArray(values)) {
    return null;
  }
  return values.map((value) => toMetricText(value)).filter(Boolean);
}

function hasMetricTextList(values) {
  return Array.isArray(values) && values.length > 0;
}

function hasActiveMemoryCorrectionLevel(value) {
  return ["light", "mild", "medium", "strong"].includes(text(value));
}

function nonDecreasingMetric(current, previous) {
  return current != null && previous != null && current >= previous;
}

function approxEqualMetric(left, right, epsilon = 1e-6) {
  if (left == null && right == null) {
    return true;
  }
  if (left == null || right == null) {
    return false;
  }
  return Math.abs(left - right) <= epsilon;
}

function projectLatestMemoryStabilitySignal({
  latestState = null,
  latestObservation = null,
} = {}) {
  return {
    stateId: toMetricText(latestObservation?.runtimeMemoryStateId ?? latestState?.runtimeMemoryStateId),
    correctionLevel: toMetricText(latestObservation?.correctionLevel ?? latestState?.correctionLevel),
    riskScore: toFiniteRatio(latestObservation?.cT ?? latestState?.cT),
    updatedAt: toMetricText(latestObservation?.observedAt ?? latestState?.updatedAt),
    observationKind: toMetricText(latestObservation?.observationKind),
    recoverySignal: toMetricText(latestObservation?.recoverySignal),
    correctionActions: toMetricTextList(latestObservation?.correctionActions),
  };
}

export function extractSharedStateMetrics(smokeJson = {}) {
  const ui = readOperationalUiResult(smokeJson);
  return {
    windowCount: toFiniteMetric(ui?.windowCount),
    passportMemoryCount: toFiniteMetric(ui?.passportMemoryCount),
    conversationMinuteCount: toFiniteMetric(ui?.conversationMinuteCount),
    runnerHistoryCount: toFiniteMetric(ui?.runnerHistoryCount),
    verificationHistoryCount: toFiniteMetric(ui?.verificationHistoryCount),
    repairCount: toFiniteMetric(ui?.repairCount),
    qualityEscalationRuns: toFiniteMetric(ui?.qualityEscalationRuns),
    latestQualityEscalationActivated: ui ? ui.latestQualityEscalationActivated === true : null,
    latestQualityEscalationProvider: toMetricText(ui?.latestQualityEscalationProvider),
    latestQualityEscalationReason: toMetricText(ui?.latestQualityEscalationReason),
    latestRunMemoryStabilityCorrectionLevel: toMetricText(ui?.latestRunMemoryStabilityCorrectionLevel),
    latestRunMemoryStabilityRiskScore: toFiniteRatio(ui?.latestRunMemoryStabilityRiskScore),
    memoryStabilityStateCount: toFiniteMetric(ui?.memoryStabilityStateCount),
    latestMemoryStabilityStateId: toMetricText(ui?.latestMemoryStabilityStateId),
    latestMemoryStabilityCorrectionLevel: toMetricText(ui?.latestMemoryStabilityCorrectionLevel),
    latestMemoryStabilityRiskScore: toFiniteRatio(ui?.latestMemoryStabilityRiskScore),
    latestMemoryStabilityUpdatedAt: toMetricText(ui?.latestMemoryStabilityUpdatedAt),
    latestMemoryStabilityObservationKind: toMetricText(ui?.latestMemoryStabilityObservationKind),
    latestMemoryStabilityRecoverySignal: toMetricText(ui?.latestMemoryStabilityRecoverySignal),
    latestMemoryStabilityCorrectionActions: toMetricTextList(ui?.latestMemoryStabilityCorrectionActions),
    memoryStabilityRecoveryRate: toFiniteRatio(ui?.memoryStabilityRecoveryRate),
    runtimeStabilityStateCount: toFiniteMetric(ui?.runtimeStabilityStateCount),
    runtimeStabilityLatestStateId: toMetricText(ui?.runtimeStabilityLatestStateId),
    runtimeStabilityLatestCorrectionLevel: toMetricText(ui?.runtimeStabilityLatestCorrectionLevel),
    runtimeStabilityLatestRiskScore: toFiniteRatio(ui?.runtimeStabilityLatestRiskScore),
  };
}

function buildSharedStateMetricPresenceChecks(metrics = {}) {
  const correctionActive = hasActiveMemoryCorrectionLevel(metrics.latestMemoryStabilityCorrectionLevel);
  return [
    buildScenarioCheck("shared_window_metric_present", "共享态窗口计数可读", metrics.windowCount != null, {
      windowCount: metrics.windowCount,
    }),
    buildScenarioCheck("shared_memory_metric_present", "共享态记忆计数可读", metrics.passportMemoryCount != null, {
      passportMemoryCount: metrics.passportMemoryCount,
    }),
    buildScenarioCheck("shared_minute_metric_present", "共享态分钟计数可读", metrics.conversationMinuteCount != null, {
      conversationMinuteCount: metrics.conversationMinuteCount,
    }),
    buildScenarioCheck("shared_runner_history_metric_present", "共享态 runner 历史计数可读", metrics.runnerHistoryCount != null, {
      runnerHistoryCount: metrics.runnerHistoryCount,
    }),
    buildScenarioCheck(
      "shared_verification_history_metric_present",
      "共享态 verification 历史计数可读",
      metrics.verificationHistoryCount != null,
      {
        verificationHistoryCount: metrics.verificationHistoryCount,
      }
    ),
    buildScenarioCheck("shared_repair_metric_present", "共享态 repair 计数可读", metrics.repairCount != null, {
      repairCount: metrics.repairCount,
    }),
    buildScenarioCheck(
      "shared_quality_escalation_metric_present",
      "共享态质量升级计数可读",
      metrics.qualityEscalationRuns != null,
      {
        qualityEscalationRuns: metrics.qualityEscalationRuns,
      }
    ),
    buildScenarioCheck(
      "shared_memory_stability_metric_present",
      "共享态记忆稳态计数可读",
      metrics.memoryStabilityStateCount != null,
      {
        memoryStabilityStateCount: metrics.memoryStabilityStateCount,
      }
    ),
    buildScenarioCheck(
      "shared_runtime_stability_metric_present",
      "共享态记忆稳态历史计数可读",
      metrics.runtimeStabilityStateCount != null,
      {
        runtimeStabilityStateCount: metrics.runtimeStabilityStateCount,
      }
    ),
    buildScenarioCheck(
      "shared_quality_escalation_signal_coherent",
      "共享态质量升级信号自洽",
      metrics.latestQualityEscalationActivated !== true ||
        (metrics.latestQualityEscalationProvider != null && metrics.latestQualityEscalationReason != null),
      {
        latestQualityEscalationActivated: metrics.latestQualityEscalationActivated,
        latestQualityEscalationProvider: metrics.latestQualityEscalationProvider,
        latestQualityEscalationReason: metrics.latestQualityEscalationReason,
      }
    ),
    buildScenarioCheck(
      "shared_memory_stability_signal_coherent",
      "共享态记忆稳态信号自洽",
      metrics.memoryStabilityStateCount === 0 ||
        (metrics.latestMemoryStabilityStateId != null &&
          metrics.latestMemoryStabilityCorrectionLevel != null &&
          metrics.latestMemoryStabilityRiskScore != null &&
          metrics.latestMemoryStabilityUpdatedAt != null &&
          metrics.latestMemoryStabilityObservationKind != null &&
          (!correctionActive ||
            (metrics.memoryStabilityRecoveryRate != null &&
              hasMetricTextList(metrics.latestMemoryStabilityCorrectionActions)))),
      {
        memoryStabilityStateCount: metrics.memoryStabilityStateCount,
        latestMemoryStabilityStateId: metrics.latestMemoryStabilityStateId,
        latestMemoryStabilityCorrectionLevel: metrics.latestMemoryStabilityCorrectionLevel,
        latestMemoryStabilityRiskScore: metrics.latestMemoryStabilityRiskScore,
        latestMemoryStabilityUpdatedAt: metrics.latestMemoryStabilityUpdatedAt,
        latestMemoryStabilityObservationKind: metrics.latestMemoryStabilityObservationKind,
        latestMemoryStabilityRecoverySignal: metrics.latestMemoryStabilityRecoverySignal,
        latestMemoryStabilityCorrectionActions: metrics.latestMemoryStabilityCorrectionActions,
        memoryStabilityRecoveryRate: metrics.memoryStabilityRecoveryRate,
      }
    ),
    buildScenarioCheck(
      "shared_memory_stability_summary_matches_runtime_stability",
      "共享态记忆稳态摘要与历史真值对齐",
      metrics.memoryStabilityStateCount != null &&
        metrics.runtimeStabilityStateCount != null &&
        metrics.memoryStabilityStateCount === metrics.runtimeStabilityStateCount &&
        (metrics.memoryStabilityStateCount === 0 ||
          (metrics.latestMemoryStabilityStateId === metrics.runtimeStabilityLatestStateId &&
            metrics.latestMemoryStabilityCorrectionLevel === metrics.runtimeStabilityLatestCorrectionLevel &&
            approxEqualMetric(
              metrics.latestMemoryStabilityRiskScore,
              metrics.runtimeStabilityLatestRiskScore
            ))),
      {
        memoryStabilityStateCount: metrics.memoryStabilityStateCount,
        runtimeStabilityStateCount: metrics.runtimeStabilityStateCount,
        latestMemoryStabilityStateId: metrics.latestMemoryStabilityStateId,
        runtimeStabilityLatestStateId: metrics.runtimeStabilityLatestStateId,
        latestMemoryStabilityCorrectionLevel: metrics.latestMemoryStabilityCorrectionLevel,
        runtimeStabilityLatestCorrectionLevel: metrics.runtimeStabilityLatestCorrectionLevel,
        latestMemoryStabilityRiskScore: metrics.latestMemoryStabilityRiskScore,
        runtimeStabilityLatestRiskScore: metrics.runtimeStabilityLatestRiskScore,
      }
    ),
    buildScenarioCheck(
      "shared_runner_memory_truth_consistent",
      "共享态 runner 最新记忆稳态信号与摘要一致",
      (metrics.latestRunMemoryStabilityCorrectionLevel == null && metrics.latestRunMemoryStabilityRiskScore == null) ||
        (metrics.latestRunMemoryStabilityCorrectionLevel === metrics.latestMemoryStabilityCorrectionLevel &&
          approxEqualMetric(
            metrics.latestRunMemoryStabilityRiskScore,
            metrics.latestMemoryStabilityRiskScore
          )),
      {
        latestRunMemoryStabilityCorrectionLevel: metrics.latestRunMemoryStabilityCorrectionLevel,
        latestRunMemoryStabilityRiskScore: metrics.latestRunMemoryStabilityRiskScore,
        latestMemoryStabilityCorrectionLevel: metrics.latestMemoryStabilityCorrectionLevel,
        latestMemoryStabilityRiskScore: metrics.latestMemoryStabilityRiskScore,
      }
    ),
  ];
}

export function buildSharedStateGrowthChecks({ previousMetrics = null, currentMetrics = null } = {}) {
  const metrics = currentMetrics || {};
  const checks = buildSharedStateMetricPresenceChecks(metrics);
  if (!previousMetrics) {
    return checks;
  }
  checks.push(
    buildScenarioCheck("shared_window_count_stable", "同一 data root 下窗口绑定数量保持稳定", metrics.windowCount === previousMetrics.windowCount, {
      previous: previousMetrics.windowCount,
      current: metrics.windowCount,
    })
  );
  checks.push(
    buildScenarioCheck(
      "shared_memory_count_non_decreasing",
      "同一 data root 下 passport memory 计数不应倒退",
      nonDecreasingMetric(metrics.passportMemoryCount, previousMetrics.passportMemoryCount),
      {
        previous: previousMetrics.passportMemoryCount,
        current: metrics.passportMemoryCount,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "shared_conversation_minute_non_decreasing",
      "同一 data root 下 conversation minute 不应倒退",
      nonDecreasingMetric(metrics.conversationMinuteCount, previousMetrics.conversationMinuteCount),
      {
        previous: previousMetrics.conversationMinuteCount,
        current: metrics.conversationMinuteCount,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "shared_runner_history_non_decreasing",
      "同一 data root 下 runner 历史不应倒退",
      nonDecreasingMetric(metrics.runnerHistoryCount, previousMetrics.runnerHistoryCount),
      {
        previous: previousMetrics.runnerHistoryCount,
        current: metrics.runnerHistoryCount,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "shared_verification_history_non_decreasing",
      "同一 data root 下 verification 历史不应倒退",
      nonDecreasingMetric(metrics.verificationHistoryCount, previousMetrics.verificationHistoryCount),
      {
        previous: previousMetrics.verificationHistoryCount,
        current: metrics.verificationHistoryCount,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "shared_repair_count_non_decreasing",
      "同一 data root 下 repair 计数不应倒退",
      nonDecreasingMetric(metrics.repairCount, previousMetrics.repairCount),
      {
        previous: previousMetrics.repairCount,
        current: metrics.repairCount,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "shared_quality_escalation_non_decreasing",
      "同一 data root 下质量升级计数不应倒退",
      nonDecreasingMetric(metrics.qualityEscalationRuns, previousMetrics.qualityEscalationRuns),
      {
        previous: previousMetrics.qualityEscalationRuns,
        current: metrics.qualityEscalationRuns,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "shared_memory_stability_non_decreasing",
      "同一 data root 下记忆稳态状态计数不应倒退",
      nonDecreasingMetric(metrics.memoryStabilityStateCount, previousMetrics.memoryStabilityStateCount),
      {
        previous: previousMetrics.memoryStabilityStateCount,
        current: metrics.memoryStabilityStateCount,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "shared_runtime_stability_non_decreasing",
      "同一 data root 下记忆稳态历史计数不应倒退",
      nonDecreasingMetric(metrics.runtimeStabilityStateCount, previousMetrics.runtimeStabilityStateCount),
      {
        previous: previousMetrics.runtimeStabilityStateCount,
        current: metrics.runtimeStabilityStateCount,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "shared_memory_stability_updated_at_non_decreasing",
      "同一 data root 下最近记忆稳态更新时间不应倒退",
      (() => {
        const previous = Date.parse(previousMetrics.latestMemoryStabilityUpdatedAt || "");
        const current = Date.parse(metrics.latestMemoryStabilityUpdatedAt || "");
        return Number.isFinite(previous) && Number.isFinite(current) ? current >= previous : false;
      })(),
      {
        previous: previousMetrics.latestMemoryStabilityUpdatedAt,
        current: metrics.latestMemoryStabilityUpdatedAt,
      }
    )
  );
  return checks;
}

export function buildCrashRestartChecks({
  memoryId = null,
  resumeBoundaryId = null,
  visibleBeforeCrash = false,
  healthAfterRestart = null,
  securityAfterRestart = null,
  runtimeAfterRestart = null,
  resumeBoundaryAvailableAfterRestart = false,
  rehydrateAfterRestart = null,
  resumedRunnerAfterRestart = null,
  sessionStateAfterRestart = null,
  runtimeSummaryAfterRestart = null,
  runtimeStabilityAfterRestart = null,
  visibleAfterRestart = false,
} = {}) {
  const summaryLatestState = runtimeSummaryAfterRestart?.summary?.memoryHomeostasis?.latestState || null;
  const summaryLatestObservation =
    runtimeSummaryAfterRestart?.summary?.memoryHomeostasis?.observationSummary?.latestObservation || null;
  const summaryRecoveryRate =
    toFiniteRatio(
      runtimeSummaryAfterRestart?.summary?.memoryHomeostasis?.observationSummary?.effectiveness?.recoveryRate
    );
  const stabilityLatestState = runtimeStabilityAfterRestart?.stability?.latestState || null;
  const stabilityLatestObservation =
    runtimeStabilityAfterRestart?.stability?.observationSummary?.latestObservation || null;
  const stabilityRecoveryRate =
    toFiniteRatio(
      runtimeStabilityAfterRestart?.stability?.observationSummary?.effectiveness?.recoveryRate
    );
  const summaryProjectedSignal = projectLatestMemoryStabilitySignal({
    latestState: summaryLatestState,
    latestObservation: summaryLatestObservation,
  });
  const stabilityProjectedSignal = projectLatestMemoryStabilitySignal({
    latestState: stabilityLatestState,
    latestObservation: stabilityLatestObservation,
  });
  const summaryStateCount = runtimeSummaryAfterRestart?.summary?.memoryHomeostasis?.stateCount ?? null;
  const runtimeStabilityStateCount = runtimeStabilityAfterRestart?.stability?.counts?.total ?? null;
  const resumedRunner = resumedRunnerAfterRestart?.runner || resumedRunnerAfterRestart || null;
  const recoveryChain = Array.isArray(resumedRunner?.recoveryChain) ? resumedRunner.recoveryChain : [];
  const summaryCorrectionActive = hasActiveMemoryCorrectionLevel(summaryProjectedSignal.correctionLevel);
  const runtimeCorrectionActive = hasActiveMemoryCorrectionLevel(stabilityProjectedSignal.correctionLevel);
  return [
    buildScenarioCheck("memory_visible_before_crash", "崩溃前新写入记忆可见", visibleBeforeCrash, {
      passportMemoryId: memoryId,
    }),
    buildScenarioCheck("resume_boundary_seeded_before_crash", "崩溃前已生成可续跑 compact boundary", Boolean(resumeBoundaryId), {
      resumeBoundaryId,
    }),
    buildScenarioCheck("restart_health", "异常退出后服务能重启", healthAfterRestart?.ok === true, {
      ok: healthAfterRestart?.ok ?? null,
      service: text(healthAfterRestart?.service) || null,
    }),
    buildScenarioCheck(
      "restart_runtime_truth",
      "异常退出后受保护 runtime 真值仍可读",
      Boolean(runtimeAfterRestart?.deviceRuntime),
      {
        deviceRuntimeId: runtimeAfterRestart?.deviceRuntime?.deviceRuntimeId || null,
      }
    ),
    buildScenarioCheck(
      "restart_resume_boundary_available",
      "异常退出后 compact boundary 仍可读",
      Boolean(resumeBoundaryId) && resumeBoundaryAvailableAfterRestart === true,
      {
        resumeBoundaryId,
        available: resumeBoundaryAvailableAfterRestart,
      }
    ),
    buildScenarioCheck(
      "restart_rehydrate_boundary",
      "异常退出后 rehydrate 仍能挂回原 compact boundary",
      Boolean(resumeBoundaryId) &&
        (rehydrateAfterRestart?.rehydrate?.resumeBoundary?.compactBoundaryId === resumeBoundaryId ||
          rehydrateAfterRestart?.resumeBoundary?.compactBoundaryId === resumeBoundaryId),
      {
        resumeBoundaryId,
        rehydrateBoundaryId:
          rehydrateAfterRestart?.rehydrate?.resumeBoundary?.compactBoundaryId ??
          rehydrateAfterRestart?.resumeBoundary?.compactBoundaryId ??
          null,
      }
    ),
    buildScenarioCheck(
      "restart_resume_execution",
      "异常退出后可从 compact boundary 自动续跑完成",
      resumedRunner?.autoResumed === true &&
        resumedRunner?.autoRecovery?.status === "resumed" &&
        resumedRunner?.run?.status != null &&
        resumedRunner.run.status !== "rehydrate_required" &&
        recoveryChain.length >= 2 &&
        recoveryChain.some((entry) => entry?.resumeBoundaryId === resumeBoundaryId) &&
        resumedRunner?.autoRecovery?.finalRunId === resumedRunner?.run?.runId &&
        resumedRunner?.autoRecovery?.finalStatus === resumedRunner?.run?.status,
      {
        resumeBoundaryId,
        autoResumed: resumedRunner?.autoResumed ?? null,
        autoRecoveryStatus: resumedRunner?.autoRecovery?.status ?? null,
        autoRecoveryFinalRunId: resumedRunner?.autoRecovery?.finalRunId ?? null,
        autoRecoveryFinalStatus: resumedRunner?.autoRecovery?.finalStatus ?? null,
        runStatus: resumedRunner?.run?.status ?? null,
        recoveryChainLength: recoveryChain.length,
        recoveryChainIncludesBoundary: recoveryChain.some((entry) => entry?.resumeBoundaryId === resumeBoundaryId),
        finalRunId: resumedRunner?.run?.runId ?? null,
      }
    ),
    buildScenarioCheck(
      "restart_session_state_persisted",
      "异常退出后续跑结果已持久化到 session state",
      Boolean(resumeBoundaryId) &&
        sessionStateAfterRestart?.sessionState?.latestResumeBoundaryId === resumeBoundaryId &&
        sessionStateAfterRestart?.sessionState?.latestRunId === resumedRunner?.run?.runId &&
        sessionStateAfterRestart?.sessionState?.latestRunStatus === resumedRunner?.run?.status &&
        Number.isFinite(Number(sessionStateAfterRestart?.sessionState?.tokenBudgetState?.estimatedContextChars)) &&
        Number.isFinite(Number(sessionStateAfterRestart?.sessionState?.tokenBudgetState?.estimatedContextTokens)) &&
        Array.isArray(sessionStateAfterRestart?.sessionState?.activeWindowIds) &&
        sessionStateAfterRestart.sessionState.activeWindowIds.length >= 1,
      {
        resumeBoundaryId,
        latestResumeBoundaryId: sessionStateAfterRestart?.sessionState?.latestResumeBoundaryId ?? null,
        latestRunId: sessionStateAfterRestart?.sessionState?.latestRunId ?? null,
        latestRunStatus: sessionStateAfterRestart?.sessionState?.latestRunStatus ?? null,
        activeWindowCount: Array.isArray(sessionStateAfterRestart?.sessionState?.activeWindowIds)
          ? sessionStateAfterRestart.sessionState.activeWindowIds.length
          : null,
        estimatedContextChars: sessionStateAfterRestart?.sessionState?.tokenBudgetState?.estimatedContextChars ?? null,
        estimatedContextTokens: sessionStateAfterRestart?.sessionState?.tokenBudgetState?.estimatedContextTokens ?? null,
      }
    ),
    buildScenarioCheck("restart_admin_token", "异常退出后管理令牌仍可读受保护真值", securityAfterRestart?.authorized === true, {
      authorized: securityAfterRestart?.authorized ?? null,
    }),
    buildScenarioCheck(
      "restart_public_agent_runtime_truth",
      "异常退出后公开 agent 运行真值仍可读",
      securityAfterRestart?.agentRuntimeTruth?.localFirst === true &&
        securityAfterRestart?.agentRuntimeTruth?.qualityEscalationRuns != null,
      {
        localFirst: securityAfterRestart?.agentRuntimeTruth?.localFirst ?? null,
        qualityEscalationRuns: securityAfterRestart?.agentRuntimeTruth?.qualityEscalationRuns ?? null,
      }
    ),
    buildScenarioCheck(
      "restart_memory_stability_summary_truth",
      "异常退出后 runtime summary 记忆稳态真值仍可读",
      summaryStateCount != null,
      {
        stateCount: summaryStateCount,
        latestStateId: summaryProjectedSignal.stateId,
      }
    ),
    buildScenarioCheck(
      "restart_memory_stability_runtime_truth",
      "异常退出后 runtime stability 真值仍可读",
      runtimeStabilityStateCount != null,
      {
        stateCount: runtimeStabilityStateCount,
        latestStateId: stabilityProjectedSignal.stateId,
      }
    ),
    buildScenarioCheck(
      "restart_memory_stability_summary_signal_coherent",
      "异常退出后 runtime summary 记忆稳态信号自洽",
      summaryStateCount === 0 ||
        (summaryStateCount != null &&
          summaryProjectedSignal.stateId != null &&
          summaryProjectedSignal.correctionLevel != null &&
          summaryProjectedSignal.riskScore != null &&
          summaryProjectedSignal.observationKind != null &&
          (!summaryCorrectionActive ||
            (summaryRecoveryRate != null &&
              hasMetricTextList(summaryProjectedSignal.correctionActions)))),
      {
        stateCount: summaryStateCount,
        latestStateId: summaryProjectedSignal.stateId,
        latestCorrectionLevel: summaryProjectedSignal.correctionLevel,
        latestRiskScore: summaryProjectedSignal.riskScore,
        latestUpdatedAt: summaryProjectedSignal.updatedAt,
        latestObservationKind: summaryProjectedSignal.observationKind,
        latestRecoverySignal: summaryProjectedSignal.recoverySignal,
        latestCorrectionActions: summaryProjectedSignal.correctionActions,
        recoveryRate: summaryRecoveryRate,
      }
    ),
    buildScenarioCheck(
      "restart_memory_stability_runtime_signal_coherent",
      "异常退出后 runtime stability 记忆稳态信号自洽",
      runtimeStabilityStateCount === 0 ||
        (runtimeStabilityStateCount != null &&
          stabilityProjectedSignal.stateId != null &&
          stabilityProjectedSignal.correctionLevel != null &&
          stabilityProjectedSignal.riskScore != null &&
          stabilityProjectedSignal.observationKind != null &&
          (!runtimeCorrectionActive ||
            (stabilityRecoveryRate != null &&
              hasMetricTextList(stabilityProjectedSignal.correctionActions)))),
      {
        stateCount: runtimeStabilityStateCount,
        latestStateId: stabilityProjectedSignal.stateId,
        latestCorrectionLevel: stabilityProjectedSignal.correctionLevel,
        latestRiskScore: stabilityProjectedSignal.riskScore,
        latestUpdatedAt: stabilityProjectedSignal.updatedAt,
        latestObservationKind: stabilityProjectedSignal.observationKind,
        latestRecoverySignal: stabilityProjectedSignal.recoverySignal,
        latestCorrectionActions: stabilityProjectedSignal.correctionActions,
        recoveryRate: stabilityRecoveryRate,
      }
    ),
    buildScenarioCheck(
      "restart_memory_stability_truth_consistent",
      "异常退出后记忆稳态摘要与历史真值保持一致",
      summaryStateCount != null &&
        runtimeStabilityStateCount != null &&
        summaryStateCount === runtimeStabilityStateCount &&
        (summaryStateCount === 0 ||
          (summaryProjectedSignal.stateId != null &&
            stabilityProjectedSignal.stateId != null &&
            summaryProjectedSignal.stateId === stabilityProjectedSignal.stateId &&
            summaryProjectedSignal.correctionLevel === stabilityProjectedSignal.correctionLevel &&
            approxEqualMetric(summaryProjectedSignal.riskScore, stabilityProjectedSignal.riskScore))),
      {
        summaryStateCount,
        runtimeStabilityStateCount,
        summaryLatestStateId: summaryProjectedSignal.stateId,
        runtimeStabilityLatestStateId: stabilityProjectedSignal.stateId,
        summaryLatestCorrectionLevel: summaryProjectedSignal.correctionLevel,
        runtimeStabilityLatestCorrectionLevel: stabilityProjectedSignal.correctionLevel,
        summaryLatestRiskScore: summaryProjectedSignal.riskScore,
        runtimeStabilityLatestRiskScore: stabilityProjectedSignal.riskScore,
      }
    ),
    buildScenarioCheck("memory_persisted_after_restart", "异常退出后新写入记忆仍保留", visibleAfterRestart, {
      passportMemoryId: memoryId,
    }),
  ];
}

export function buildRuntimeStabilityCoverage({ includeBrowser = false, operationalOnly = false } = {}) {
  const browserUi =
    operationalOnly
      ? "not_applicable_operational_only"
      : includeBrowser
        ? "required"
        : "skipped_by_default";
  return {
    browserUi,
    formalGoLiveMeaning:
      browserUi === "required"
        ? "covers browser-projected runtime truth across soak rounds"
        : "does not replace smoke:browser, smoke:all, or go-live verifier browser coverage",
    nextAction:
      browserUi === "required"
        ? "If this soak passes, still run the go-live verifier with the real deploy URL before public release."
        : "For browser-projected runtime truth, run npm run soak:runtime:browser or npm run smoke:browser on a Safari DOM automation host.",
  };
}

function buildRuntimeStabilitySummary({
  rounds = [],
  sharedStateRounds = [],
  crashRestart = null,
  includeBrowser = false,
  operationalOnly = false,
} = {}) {
  const failedRounds = (Array.isArray(rounds) ? rounds : []).filter((entry) => entry?.ok !== true);
  const failedSharedStateRounds = (Array.isArray(sharedStateRounds) ? sharedStateRounds : []).filter((entry) => entry?.ok !== true);
  const crashRestartOk = crashRestart?.ok === true;
  const roundCount = Array.isArray(rounds) ? rounds.length : 0;
  const passedRounds = (Array.isArray(rounds) ? rounds : []).filter((entry) => entry?.ok === true).length;
  const sharedStateRoundCount = Array.isArray(sharedStateRounds) ? sharedStateRounds.length : 0;
  const passedSharedStateRounds = (Array.isArray(sharedStateRounds) ? sharedStateRounds : []).filter((entry) => entry?.ok === true).length;
  const failedRoundLabels = failedRounds.map(
    (entry) => `round_${entry.round}:${summarizeFailedChecks(entry.checks).join(",") || "unknown"}`
  );
  const failedSharedStateRoundLabels = failedSharedStateRounds.map(
    (entry) => `shared_round_${entry.round}:${summarizeFailedChecks(entry.checks).join(",") || "unknown"}`
  );
  const failureParts = [
    failedRoundLabels.length > 0 ? `cold_start_failures=${failedRoundLabels.join(" ; ")}` : "",
    failedSharedStateRoundLabels.length > 0 ? `shared_state_failures=${failedSharedStateRoundLabels.join(" ; ")}` : "",
    crashRestartOk ? "" : `crash_restart=${text(crashRestart?.summary) || "failed"}`,
  ].filter(Boolean);

  return {
    ok: failedRounds.length === 0 && failedSharedStateRounds.length === 0 && crashRestartOk,
    coldStartRoundCount: roundCount,
    coldStartPassedCount: passedRounds,
    sharedStateRoundCount,
    sharedStatePassedCount: passedSharedStateRounds,
    failedRounds: failedRounds.map((entry) => ({
      round: entry.round,
      failedChecks: summarizeFailedChecks(entry.checks),
    })),
    failedSharedStateRounds: failedSharedStateRounds.map((entry) => ({
      round: entry.round,
      failedChecks: summarizeFailedChecks(entry.checks),
    })),
    sharedStateRounds,
    crashRestart,
    coverage: buildRuntimeStabilityCoverage({ includeBrowser, operationalOnly }),
    summary:
      failedRounds.length === 0 && failedSharedStateRounds.length === 0 && crashRestartOk
        ? `runtime soak passed: coldStart=${passedRounds}/${roundCount} ; sharedState=${passedSharedStateRounds}/${sharedStateRoundCount} ; crashRestart=pass`
        : `runtime soak failed: ${failureParts.join(" ; ") || "unknown failure"}`,
  };
}

function buildColdStartChecks(smokeAllJson = {}, { operationalOnly = isOperationalOnlySmoke(smokeAllJson) } = {}) {
  const stepMap = buildStepMap(smokeAllJson);
  const ui = stepMap.get("smoke:ui:operational") || null;
  const browserSemantics = smokeAllJson.browserUiSemantics?.status || null;
  const scriptConfig = resolveSmokeScriptConfig({ operationalOnly });
  const checks = [
    buildScenarioCheck(scriptConfig.okCheckId, scriptConfig.okCheckLabel, smokeAllJson.ok === true, {
      mode: smokeAllJson.mode || null,
    }),
  ];

  if (!operationalOnly) {
    checks.push(
      buildScenarioCheck("offline_fanout_gate", "offline fan-out gate 通过", smokeAllJson.offlineFanoutGate?.status === "passed", {
        status: smokeAllJson.offlineFanoutGate?.status || null,
        summary: smokeAllJson.offlineFanoutGate?.summary || null,
      })
    );
    checks.push(
      buildScenarioCheck(
        "protective_state_semantics",
        "保护态语义通过",
        smokeAllJson.protectiveStateSemantics?.status === "passed",
        {
          status: smokeAllJson.protectiveStateSemantics?.status || null,
          summary: smokeAllJson.protectiveStateSemantics?.summary || null,
        }
      )
    );
  }

  checks.push(
    buildScenarioCheck(
      "operational_flow_semantics",
      "运行流程语义通过",
      smokeAllJson.operationalFlowSemantics?.status === "passed",
      {
        status: smokeAllJson.operationalFlowSemantics?.status || null,
        summary: smokeAllJson.operationalFlowSemantics?.summary || null,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "runtime_evidence_semantics",
      "runtime evidence 语义通过",
      smokeAllJson.runtimeEvidenceSemantics?.status === "passed",
      {
        status: smokeAllJson.runtimeEvidenceSemantics?.status || null,
        summary: smokeAllJson.runtimeEvidenceSemantics?.summary || null,
      }
    )
  );
  if (!operationalOnly) {
    checks.push(
      buildScenarioCheck(
        "browser_ui_semantics",
        "browser UI 语义通过或按预期跳过",
        browserSemantics === "passed" || browserSemantics === "skipped",
        {
          status: browserSemantics,
          summary: smokeAllJson.browserUiSemantics?.summary || null,
        }
      )
    );
  }

  checks.push(
    buildScenarioCheck("operational_ui_evidence", "冷启动证据来自 smoke:ui:operational", Boolean(ui), {
      sourceStep: ui ? "smoke:ui:operational" : null,
    })
  );
  checks.push(
    buildScenarioCheck(
      "admin_token_rotation",
      "令牌轮换链路稳定",
      ui?.adminTokenRotationMode === "rotated" &&
        ui?.adminTokenRotationOldTokenRejected === true &&
        ui?.adminTokenRotationReadSessionPreRevokeAllowed === true &&
        ui?.adminTokenRotationReadSessionRevoked === true &&
        ui?.adminTokenRotationAnomalyRecorded === true,
      {
        mode: ui?.adminTokenRotationMode ?? null,
        oldTokenRejected: ui?.adminTokenRotationOldTokenRejected ?? null,
        preRevokeAllowed: ui?.adminTokenRotationReadSessionPreRevokeAllowed ?? null,
        readSessionRevoked: ui?.adminTokenRotationReadSessionRevoked ?? null,
        anomalyRecorded: ui?.adminTokenRotationAnomalyRecorded ?? null,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "window_rebind_guard",
      "窗口改绑防伪造稳定",
      ui?.forgedWindowRebindBlocked === true && ui?.windowBindingStableAfterRebind === true,
      {
        blocked: ui?.forgedWindowRebindBlocked ?? null,
        error: ui?.forgedWindowRebindError ?? null,
        bindingStable: ui?.windowBindingStableAfterRebind ?? null,
      }
    )
  );
  checks.push(
    buildScenarioCheck(
      "auto_recovery_resume",
      "恢复续跑稳定",
      ui?.autoRecoveryResumed === true &&
        ui?.autoRecoveryResumeStatus === "resumed" &&
        Number(ui?.autoRecoveryResumeChainLength || 0) >= 2 &&
        ui?.retryWithoutExecutionResumeStatus === "resumed" &&
        Number(ui?.retryWithoutExecutionResumeChainLength || 0) >= 2,
      {
        resumed: ui?.autoRecoveryResumed ?? null,
        resumeStatus: ui?.autoRecoveryResumeStatus ?? null,
        resumeChainLength: ui?.autoRecoveryResumeChainLength ?? null,
        retryWithoutExecutionStatus: ui?.retryWithoutExecutionResumeStatus ?? null,
        retryWithoutExecutionChainLength: ui?.retryWithoutExecutionResumeChainLength ?? null,
      }
    )
  );

  return checks;
}

export function evaluateColdStartRound(smokeAllJson = {}, { operationalOnly = isOperationalOnlySmoke(smokeAllJson) } = {}) {
  const checks = buildColdStartChecks(smokeAllJson, { operationalOnly });
  return {
    ok: checks.every((entry) => entry.passed === true),
    checks,
  };
}

export function evaluateSharedStateRound(smokeAllJson = {}, { previousMetrics = null, operationalOnly = isOperationalOnlySmoke(smokeAllJson) } = {}) {
  const base = evaluateColdStartRound(smokeAllJson, { operationalOnly });
  const metrics = extractSharedStateMetrics(smokeAllJson);
  const growthChecks = buildSharedStateGrowthChecks({
    previousMetrics,
    currentMetrics: metrics,
  });
  const checks = [...base.checks, ...growthChecks];
  return {
    ok: checks.every((entry) => entry.passed === true),
    checks,
    metrics,
  };
}

export function buildRuntimeStabilityVerdict(input = {}) {
  return buildRuntimeStabilitySummary(input);
}

function isChildProcessRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

export function resolveScriptProcessSignalTarget(child, { platform = process.platform } = {}) {
  if (!child?.pid) {
    return {
      mode: "none",
      pid: null,
    };
  }
  if (platform !== "win32") {
    return {
      mode: "process_group",
      pid: -child.pid,
    };
  }
  return {
    mode: "child",
    pid: child.pid,
  };
}

function resolveScriptProcessFallbackTarget(child) {
  if (!child?.pid) {
    return null;
  }
  return {
    mode: "child",
    pid: child.pid,
  };
}

function probeScriptProcessTargetAlive(pid, { killImpl = process.kill } = {}) {
  try {
    killImpl(pid, 0);
    return {
      alive: true,
      missing: false,
    };
  } catch (error) {
    if (error?.code === "ESRCH") {
      return {
        alive: false,
        missing: true,
      };
    }
    return {
      alive: true,
      missing: false,
    };
  }
}

function signalScriptProcessTree(child, signal, { platform = process.platform, killImpl = process.kill } = {}) {
  const target = resolveScriptProcessSignalTarget(child, { platform });
  if (target.mode === "none") {
    return;
  }
  try {
    if (target.mode === "process_group") {
      killImpl(target.pid, signal);
      return;
    }
    if (typeof child?.kill === "function") {
      child.kill(signal);
      return;
    }
    killImpl(target.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH" || target.mode !== "process_group") {
      return;
    }
    const fallbackTarget = resolveScriptProcessFallbackTarget(child);
    if (!fallbackTarget) {
      return;
    }
    try {
      if (typeof child?.kill === "function") {
        child.kill(signal);
        return;
      }
      killImpl(fallbackTarget.pid, signal);
    } catch {}
  }
}

export function isScriptProcessSignalTargetAlive(
  child,
  { platform = process.platform, killImpl = process.kill } = {}
) {
  const target = resolveScriptProcessSignalTarget(child, { platform });
  if (target.mode === "none" || target.pid == null) {
    return false;
  }
  const targetProbe = probeScriptProcessTargetAlive(target.pid, { killImpl });
  if (targetProbe.alive || target.mode !== "process_group") {
    return targetProbe.alive;
  }
  const fallbackTarget = resolveScriptProcessFallbackTarget(child);
  if (!fallbackTarget) {
    return false;
  }
  return probeScriptProcessTargetAlive(fallbackTarget.pid, { killImpl }).alive;
}

export async function waitForScriptProcessSignalTargetExit(
  child,
  {
    timeoutMs = 1000,
    pollIntervalMs = 50,
    platform = process.platform,
    killImpl = process.kill,
  } = {}
) {
  const startedAt = Date.now();
  do {
    if (!isScriptProcessSignalTargetAlive(child, { platform, killImpl })) {
      return true;
    }
    if (timeoutMs <= 0) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  } while (Date.now() - startedAt < timeoutMs);
  return !isScriptProcessSignalTargetAlive(child, { platform, killImpl });
}

async function waitForChildClose(child, timeoutMs) {
  if (!isChildProcessRunning(child)) {
    return true;
  }
  const closed = Symbol("closed");
  const timedOut = Symbol("timed_out");
  const result = await Promise.race([
    once(child, "close").then(() => closed),
    new Promise((resolve) => setTimeout(() => resolve(timedOut), timeoutMs)),
  ]);
  return result === closed || !isChildProcessRunning(child);
}

async function terminateScriptProcessTree(
  child,
  { graceMs = 1500, forceGraceMs = 1000, pollIntervalMs = 50 } = {}
) {
  if (!isChildProcessRunning(child) && (await waitForScriptProcessSignalTargetExit(child, { timeoutMs: 0 }))) {
    return true;
  }
  signalScriptProcessTree(child, "SIGTERM");
  let [childClosed, targetExited] = await Promise.all([
    waitForChildClose(child, graceMs),
    waitForScriptProcessSignalTargetExit(child, {
      timeoutMs: graceMs,
      pollIntervalMs,
    }),
  ]);
  if (childClosed && targetExited) {
    return true;
  }
  signalScriptProcessTree(child, "SIGKILL");
  [childClosed, targetExited] = await Promise.all([
    waitForChildClose(child, forceGraceMs),
    waitForScriptProcessSignalTargetExit(child, {
      timeoutMs: forceGraceMs,
      pollIntervalMs,
    }),
  ]);
  return childClosed && targetExited;
}

async function runScriptJson(scriptName, { env = {}, timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, "scripts", scriptName)], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ...env,
      },
    });
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      terminateScriptProcessTree(child).finally(() => {
        reject(new Error(`${scriptName} timed out after ${timeoutMs}ms\n${stderr || stdout}`));
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`${scriptName} terminated by signal ${signal}\n${stderr || stdout}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${scriptName} failed with code ${code}\n${stderr || stdout}`));
        return;
      }
      const json = extractTrailingJson(stdout);
      if (!json) {
        reject(new Error(`${scriptName} did not emit trailing JSON\n${stderr || stdout}`));
        return;
      }
      resolve({
        durationMs: Date.now() - startedAt,
        json,
      });
    });
  });
}

async function runColdStartRound(round, { includeBrowser = false, timeoutMs, operationalOnly = false } = {}) {
  const scriptConfig = resolveSmokeScriptConfig({ operationalOnly });
  logSoakProgress("cold-start round started", {
    round,
    script: scriptConfig.scriptName,
    timeoutMs,
  });
  try {
    const smokeRun = await runScriptJson(scriptConfig.scriptName, {
      env: operationalOnly || includeBrowser ? {} : { SMOKE_ALL_SKIP_BROWSER: "1" },
      timeoutMs,
    });
    const evaluation = evaluateColdStartRound(smokeRun.json, { operationalOnly });
    logSoakProgress("cold-start round finished", {
      round,
      ok: evaluation.ok,
      durationMs: smokeRun.durationMs,
    });
    return {
      round,
      ok: evaluation.ok,
      durationMs: smokeRun.durationMs,
      checks: evaluation.checks,
      mode: smokeRun.json.mode || null,
      script: scriptConfig.scriptName,
      operationalOnly,
      browserSkipped: operationalOnly ? true : smokeRun.json.browserSkipped === true,
    };
  } catch (error) {
    logSoakProgress("cold-start round failed", {
      round,
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
    });
    return {
      round,
      ok: false,
      durationMs: null,
      checks: [
        buildScenarioCheck(scriptConfig.roundCheckId, scriptConfig.roundCheckLabel, false, {
          error: error instanceof Error ? error.message : String(error),
        }),
      ],
      mode: null,
      script: scriptConfig.scriptName,
      operationalOnly,
      browserSkipped: operationalOnly || includeBrowser !== true,
    };
  }
}

async function runSharedStateRound(
  round,
  {
    baseUrl,
    sharedEnv = {},
    includeBrowser = false,
    timeoutMs,
    previousMetrics = null,
    operationalOnly = false,
  } = {}
) {
  const scriptConfig = resolveSmokeScriptConfig({ operationalOnly });
  logSoakProgress("shared-state round started", {
    round,
    script: scriptConfig.scriptName,
    timeoutMs,
  });
  try {
    const smokeRun = await runScriptJson(scriptConfig.scriptName, {
      env: {
        AGENT_PASSPORT_BASE_URL: baseUrl,
        ...sharedEnv,
        ...(operationalOnly || includeBrowser ? {} : { SMOKE_ALL_SKIP_BROWSER: "1" }),
      },
      timeoutMs,
    });
    const evaluation = evaluateSharedStateRound(smokeRun.json, {
      previousMetrics,
      operationalOnly,
    });
    logSoakProgress("shared-state round finished", {
      round,
      ok: evaluation.ok,
      durationMs: smokeRun.durationMs,
    });
    return {
      round,
      ok: evaluation.ok,
      durationMs: smokeRun.durationMs,
      checks: evaluation.checks,
      metrics: evaluation.metrics,
      mode: smokeRun.json.mode || null,
      script: scriptConfig.scriptName,
      operationalOnly,
      browserSkipped: operationalOnly ? true : smokeRun.json.browserSkipped === true,
    };
  } catch (error) {
    logSoakProgress("shared-state round failed", {
      round,
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
    });
    return {
      round,
      ok: false,
      durationMs: null,
      checks: [
        buildScenarioCheck(`shared_state_${scriptConfig.roundCheckId}`, `共享态${scriptConfig.roundCheckLabel}`, false, {
          error: error instanceof Error ? error.message : String(error),
        }),
      ],
      metrics: extractSharedStateMetrics({}),
      mode: null,
      script: scriptConfig.scriptName,
      operationalOnly,
      browserSkipped: operationalOnly || includeBrowser !== true,
    };
  }
}

async function runCrashRestartProbe() {
  logSoakProgress("crash-restart probe started");
  const resolvedBaseUrl = await resolveSmokeBaseUrl(null);
  let resolvedDataRoot = null;
  let smokeServer = null;
  let primaryError = null;

  try {
    resolvedDataRoot = await prepareSmokeDataRoot({
      isolated: !resolvedBaseUrl.reuseExisting,
      tempPrefix: "agent-passport-soak-crash-",
    });
    smokeServer = await ensureSmokeServer(resolvedBaseUrl.baseUrl, {
      reuseExisting: false,
      extraEnv: resolvedDataRoot.isolationEnv,
    });
    if (smokeServer?.started !== true || !smokeServer?.child) {
      throw new Error("crash restart probe requires an owned smoke server process");
    }
    const clientOptions = {
      baseUrl: smokeServer.baseUrl,
      rootDir,
      adminTokenFallbackPath: resolvedDataRoot.isolationEnv.AGENT_PASSPORT_ADMIN_TOKEN_PATH,
      adminTokenKeychainAccount: resolvedDataRoot.isolationEnv.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT,
    };
    const beforeCrashClient = createSmokeHttpClient(clientOptions);
    const marker = `soak-crash-${Date.now()}`;
    const createResponse = await beforeCrashClient.authorizedFetch(`/api/agents/${MAIN_AGENT_ID}/passport-memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layer: "working",
        kind: "note",
        summary: marker,
        content: `abrupt exit durability probe ${marker}`,
        sourceWindowId: "window_soak_crash_probe",
        recordedByWindowId: "window_soak_crash_probe",
      }),
    });
    if (!createResponse.ok) {
      throw new Error(`/passport-memory create failed with HTTP ${createResponse.status}`);
    }
    const created = await createResponse.json();
    const memoryId = created.memory?.passportMemoryId || null;
    const beforeCrashMemories = await beforeCrashClient.getJson(buildPassportMemoryQueryPath(marker));
    const visibleBeforeCrash = Array.isArray(beforeCrashMemories.memories)
      ? beforeCrashMemories.memories.some((entry) => entry?.passportMemoryId === memoryId)
      : false;
    const seedRunnerResponse = await beforeCrashClient.authorizedFetch(
      `/api/agents/${MAIN_AGENT_ID}/runner?didMethod=agentpassport`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentGoal: "为 crash restart soak 生成 compact boundary",
          userTurn: `请基于当前上下文整理恢复边界。seed=${marker}`,
          reasonerProvider: "local_mock",
          autoRecover: false,
          autoCompact: true,
          persistRun: true,
          writeConversationTurns: true,
          storeToolResults: false,
          workingCheckpointThreshold: 1,
          workingRetainCount: 1,
          turnCount: 18,
          estimatedContextChars: 24000,
          estimatedContextTokens: 6200,
        }),
      }
    );
    if (!seedRunnerResponse.ok) {
      throw new Error(`/runner compact boundary seed failed with HTTP ${seedRunnerResponse.status}`);
    }
    const seededRunner = await seedRunnerResponse.json();
    const resumeBoundaryId = seededRunner.runner?.compactBoundary?.compactBoundaryId || null;
    if (!resumeBoundaryId) {
      throw new Error("crash restart probe did not create a compact boundary before restart");
    }

    const previousSmokeServerChild = smokeServer.child;
    const terminated = await terminateScriptProcessTree(previousSmokeServerChild, {
      graceMs: 250,
      forceGraceMs: 2000,
    });
    if (!terminated) {
      throw new Error("crash restart probe previous smoke server process tree did not exit before restart");
    }

    smokeServer = await ensureSmokeServer(resolvedBaseUrl.baseUrl, {
      reuseExisting: false,
      extraEnv: resolvedDataRoot.isolationEnv,
    });
    if (smokeServer?.started !== true || !smokeServer?.child) {
      throw new Error("crash restart probe restart did not create an owned smoke server process");
    }
    const afterRestartClient = createSmokeHttpClient({
      ...clientOptions,
      baseUrl: smokeServer.baseUrl,
    });
    const [
      healthAfterRestart,
      securityAfterRestart,
      runtimeAfterRestart,
      compactBoundariesAfterRestart,
    ] = await Promise.all([
      afterRestartClient.publicGetJson("/api/health"),
      afterRestartClient.getJson("/api/security"),
      afterRestartClient.getJson("/api/device/runtime"),
      afterRestartClient.getJson(`/api/agents/${MAIN_AGENT_ID}/compact-boundaries?limit=10`),
    ]);
    const resumeBoundaryAvailableAfterRestart = Array.isArray(compactBoundariesAfterRestart.compactBoundaries)
      ? compactBoundariesAfterRestart.compactBoundaries.some(
          (entry) => entry?.compactBoundaryId === resumeBoundaryId
        )
      : false;
    const rehydrateAfterRestart = await afterRestartClient.getJson(
      `/api/agents/${MAIN_AGENT_ID}/runtime/rehydrate?didMethod=agentpassport&resumeFromCompactBoundaryId=${encodeURIComponent(resumeBoundaryId)}`
    );
    const resumedRunnerResponse = await afterRestartClient.authorizedFetch(
      `/api/agents/${MAIN_AGENT_ID}/runner?didMethod=agentpassport`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentGoal: "验证 crash restart soak 能从 compact boundary 自动续跑",
          userTurn: "请继续推进当前任务",
          reasonerProvider: "local_mock",
          autoRecover: true,
          maxRecoveryAttempts: 1,
          autoCompact: false,
          persistRun: true,
          writeConversationTurns: false,
          storeToolResults: false,
          turnCount: 18,
          estimatedContextChars: 24000,
          estimatedContextTokens: 6200,
          resumeFromCompactBoundaryId: resumeBoundaryId,
        }),
      }
    );
    if (!resumedRunnerResponse.ok) {
      throw new Error(`/runner auto resume after restart failed with HTTP ${resumedRunnerResponse.status}`);
    }
    const resumedRunnerAfterRestart = await resumedRunnerResponse.json();
    const [
      runtimeSummaryAfterRestart,
      runtimeStabilityAfterRestart,
      sessionStateAfterRestart,
      afterRestartMemories,
    ] = await Promise.all([
      afterRestartClient.getJson(`/api/agents/${MAIN_AGENT_ID}/runtime-summary?didMethod=agentpassport`),
      afterRestartClient.getJson(`/api/agents/${MAIN_AGENT_ID}/runtime/stability?didMethod=agentpassport&limit=1`),
      afterRestartClient.getJson(`/api/agents/${MAIN_AGENT_ID}/session-state?didMethod=agentpassport`),
      afterRestartClient.getJson(buildPassportMemoryQueryPath(marker)),
    ]);
    const visibleAfterRestart = Array.isArray(afterRestartMemories.memories)
      ? afterRestartMemories.memories.some((entry) => entry?.passportMemoryId === memoryId)
      : false;
    const checks = buildCrashRestartChecks({
      memoryId,
      resumeBoundaryId,
      visibleBeforeCrash,
      healthAfterRestart,
      securityAfterRestart,
      runtimeAfterRestart,
      resumeBoundaryAvailableAfterRestart,
      rehydrateAfterRestart,
      resumedRunnerAfterRestart,
      sessionStateAfterRestart,
      runtimeSummaryAfterRestart,
      runtimeStabilityAfterRestart,
      visibleAfterRestart,
    });
    const ok = checks.every((entry) => entry.passed === true);
    logSoakProgress("crash-restart probe finished", { ok });
    return {
      ok,
      checks,
      summary: ok
        ? "abrupt exit durability probe passed"
        : `abrupt exit durability probe failed: ${summarizeFailedChecks(checks).join(",")}`,
    };
  } catch (error) {
    primaryError = error;
    logSoakProgress("crash-restart probe failed", {
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
    });
    return {
      ok: false,
      checks: [
        buildScenarioCheck("crash_restart_probe", "异常退出恢复探针完成", false, {
          error: error instanceof Error ? error.message : String(error),
        }),
      ],
      summary: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await cleanupSmokeWrapperRuntime({ smokeServer, resolvedDataRoot, primaryError });
  }
}

async function runSharedStateSoak({
  rounds = 2,
  includeBrowser = false,
  timeoutMs = 10 * 60 * 1000,
  operationalOnly = false,
} = {}) {
  const resolvedBaseUrl = await resolveSmokeBaseUrl();
  let resolvedDataRoot = null;
  let smokeServer = null;
  let primaryError = null;

  try {
    resolvedDataRoot = await prepareSmokeDataRoot({
      isolated: !resolvedBaseUrl.reuseExisting,
      tempPrefix: "agent-passport-soak-shared-",
    });
    smokeServer = await ensureSmokeServer(resolvedBaseUrl.baseUrl, {
      reuseExisting: resolvedBaseUrl.reuseExisting,
      extraEnv: resolvedDataRoot.isolationEnv,
    });
    const sharedRounds = [];
    let previousMetrics = null;
    for (let round = 1; round <= rounds; round += 1) {
      const result = await runSharedStateRound(round, {
        baseUrl: smokeServer.baseUrl,
        sharedEnv: resolvedDataRoot.isolationEnv,
        includeBrowser,
        timeoutMs,
        previousMetrics,
        operationalOnly,
      });
      sharedRounds.push(result);
      previousMetrics = result.metrics || null;
    }
    return {
      ok: sharedRounds.every((entry) => entry?.ok === true),
      baseUrl: smokeServer.baseUrl,
      rounds: sharedRounds,
      isolationMode: resolvedBaseUrl.isolationMode,
      dataIsolationMode: resolvedDataRoot.dataIsolationMode,
      secretIsolationMode: resolvedDataRoot.secretIsolationMode,
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await cleanupSmokeWrapperRuntime({ smokeServer, resolvedDataRoot, primaryError });
  }
}

async function main() {
  const rounds = toPositiveInteger(
    readArgValue("--rounds") || process.env.AGENT_PASSPORT_SOAK_ROUNDS,
    3
  );
  const operationalOnly =
    hasFlag("--operational-only") || process.env.AGENT_PASSPORT_SOAK_OPERATIONAL_ONLY === "1";
  const skipSharedState =
    hasFlag("--skip-shared-state") || process.env.AGENT_PASSPORT_SOAK_SKIP_SHARED_STATE === "1";
  const sharedStateRounds = skipSharedState
    ? 0
    : toPositiveInteger(
        readArgValue("--sharedRounds") || process.env.AGENT_PASSPORT_SOAK_SHARED_ROUNDS,
        Math.min(Math.max(rounds, 1), 2)
      );
  const includeBrowser =
    !operationalOnly && (hasFlag("--browser") || process.env.AGENT_PASSPORT_SOAK_INCLUDE_BROWSER === "1");
  const timeoutMs = toPositiveInteger(
    readArgValue("--timeoutMs") || process.env.AGENT_PASSPORT_SOAK_TIMEOUT_MS,
    10 * 60 * 1000
  );

  const coldStartRounds = [];
  for (let round = 1; round <= rounds; round += 1) {
    coldStartRounds.push(await runColdStartRound(round, { includeBrowser, timeoutMs, operationalOnly }));
  }
  const sharedState = sharedStateRounds > 0
    ? await runSharedStateSoak({
        rounds: sharedStateRounds,
        includeBrowser,
        timeoutMs,
        operationalOnly,
      })
    : {
        ok: true,
        baseUrl: null,
        rounds: [],
        skipped: true,
      };
  const crashRestart = await runCrashRestartProbe();
  const verdict = buildRuntimeStabilityVerdict({
    rounds: coldStartRounds,
    sharedStateRounds: sharedState.rounds,
    crashRestart,
    includeBrowser,
    operationalOnly,
  });

  console.log(
    JSON.stringify(
      {
        ok: verdict.ok,
        checkedAt: new Date().toISOString(),
        operationalOnly,
        includeBrowser,
        requestedRounds: rounds,
        sharedStateRounds,
        sharedState,
        coverage: verdict.coverage,
        timeoutMs,
        coldStartRounds,
        crashRestart,
        summary: verdict.summary,
      },
      null,
      2
    )
  );

  if (!verdict.ok) {
    throw new Error(verdict.summary);
  }
}

if (soakDirectExecution) {
  await main();
}

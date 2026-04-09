import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildBodyLoopProxies, buildContinuousControllerState } from "../src/cognitive-controller.js";

async function buildIsolatedLedgerPath(prefix) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return path.join(tmpDir, "ledger.json");
}

async function loadLedgerModuleForDemo(prefix) {
  process.env.OPENNEED_LEDGER_PATH = await buildIsolatedLedgerPath(prefix);
  const moduleUrl = new URL("../src/ledger.js", import.meta.url);
  moduleUrl.searchParams.set("demo", `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return import(moduleUrl.href);
}

async function runControllerDemo() {
  const bodyLoop = buildBodyLoopProxies({
    pendingInboxCount: 5,
    pendingVerificationCount: 3,
    conflictingMemoryCount: 2,
    recentRunCount: 6,
    failedVerificationCount: 2,
    negativeFeedbackCount: 1,
    recentFeedbackCount: 3,
    staleReplayHours: 22,
    latestRunLatencyMs: 9200,
  });
  const controllerState = buildContinuousControllerState({
    currentGoal: "推进深圳财务经理候选人进入下一轮沟通",
    mode: "self_calibrating",
    queryIteration: 4,
    workingCount: 6,
    truncatedCount: 2,
    verificationValid: false,
    driftScore: 0.42,
    residentLocked: true,
    replayRecencyHours: 22,
    conflictCount: 3,
    noveltySeed: 0.46,
    socialSignalCount: 3,
    bodyLoop,
  });

  assert.equal(typeof controllerState.interoceptiveState?.sleepPressure, "number", "controllerState 应包含 sleepPressure");
  assert.equal(typeof controllerState.neuromodulators?.dopamineRpe, "number", "controllerState 应包含 dopamineRpe");
  assert.equal(typeof controllerState.oscillationSchedule?.currentPhase, "string", "controllerState 应包含 currentPhase");
  assert.equal(typeof controllerState.replayOrchestration?.shouldReplay, "boolean", "controllerState 应包含 replayOrchestration");
  assert.equal(controllerState.replayOrchestration?.shouldReplay, true, "当前配置应触发 replay orchestration");

  return controllerState;
}

async function runLedgerIntegrationDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-dynamics-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    listPassportMemories,
    writePassportMemory,
    buildAgentContextBundle,
    executeVerificationRun,
    runAgentOfflineReplay,
  } = ledgerModule;

  const agent = await registerAgent({
    displayName: "动力学验证 Agent",
    role: "招聘推进 Agent",
    controller: "Kane",
  });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "动力学验证 Agent",
    role: "招聘推进 Agent",
    currentGoal: "推进深圳财务经理候选人进入下一轮沟通",
  });

  await writePassportMemory(agent.agentId, {
    layer: "working",
    kind: "conversation_turn",
    summary: "需要继续推进深圳候选人",
    content: "候选人偏深圳，建议继续推进下一轮沟通。",
    sourceType: "reported",
    confidence: 0.72,
    payload: { role: "user" },
    tags: ["conversation", "candidate", "shenzhen"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "working",
    kind: "conversation_turn",
    summary: "过期闲聊记忆",
    content: "这是一条和当前任务无关的旧闲聊。",
    sourceType: "reported",
    confidence: 0.18,
    salience: 0.16,
    recordedAt: new Date(Date.now() - (5 * 24 * 3600 * 1000)).toISOString(),
    payload: { role: "assistant" },
    tags: ["conversation", "stale", "low_signal"],
  });
  for (let index = 0; index < 8; index += 1) {
    await writePassportMemory(agent.agentId, {
      layer: "working",
      kind: "checkpoint_summary",
      summary: `工作槽位 ${index + 1}`,
      content: `当前推进任务的工作槽位 ${index + 1}。`,
      sourceType: "system",
      confidence: 0.62,
      salience: 0.58,
      payload: {
        field: `working_slot_${index + 1}`,
        value: `checkpoint_${index + 1}`,
      },
      tags: ["working_slot", "checkpoint"],
    });
  }
  const preferredCityMemory = await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "candidate_preference",
    summary: "候选人更想去深圳",
    content: "候选人再次确认更想去深圳发展。",
    sourceType: "verified",
    confidence: 0.92,
    salience: 0.82,
    payload: {
      field: "candidate_city_preference",
      value: "深圳",
    },
    tags: ["candidate", "verified", "city"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "candidate_preference",
    summary: "另一条记录显示候选人也考虑广州",
    content: "另一位面试官补充候选人也考虑广州机会。",
    sourceType: "reported",
    confidence: 0.68,
    salience: 0.66,
    payload: {
      field: "candidate_city_preference",
      value: "广州",
    },
    tags: ["candidate", "reported", "city", "competing"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "next_action",
    summary: "安排复试",
    content: "当前建议安排下一轮复试。",
    sourceType: "derived",
    confidence: 0.78,
    salience: 0.76,
    payload: {
      field: "next_action",
      value: "安排复试",
    },
    tags: ["action", "derived"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "semantic",
    kind: "generic_match_rule",
    summary: "深圳候选人下一轮推进通用规则",
    content: "深圳候选人通常建议进入下一轮沟通并安排复试。",
    sourceType: "derived",
    confidence: 0.94,
    salience: 0.94,
    payload: {
      field: "generic_match_rule",
      value: "进入下一轮沟通并安排复试",
    },
    tags: ["semantic", "rule", "shenzhen"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "profile",
    kind: "preference",
    summary: "偏好本地优先并保留恢复能力",
    content: "prefer_local_first\nprefer_checkpoint_resume",
    sourceType: "reported",
    confidence: 0.72,
    salience: 0.74,
    payload: {
      field: "stable_preferences",
      value: ["prefer_local_first", "prefer_checkpoint_resume"],
    },
    tags: ["profile", "preference", "resume"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "profile",
    kind: "preference",
    summary: "另一条偏好更强调压缩上下文",
    content: "prefer_compact_context",
    sourceType: "reported",
    confidence: 0.64,
    salience: 0.62,
    payload: {
      field: "stable_preferences",
      value: ["prefer_compact_context"],
    },
    tags: ["profile", "preference", "compact"],
  });

  await executeVerificationRun(agent.agentId, {
    responseText: "建议进入下一轮沟通，并安排复试。",
    currentGoal: "本地离线恢复上下文后，继续推进深圳财务经理候选人进入下一轮沟通",
    query: "深圳 广州 候选人 下一轮沟通 复试 本地恢复 replay dynamics",
  });
  const offlineReplay = await runAgentOfflineReplay(agent.agentId, {
    currentGoal: "本地离线恢复上下文后，继续推进深圳财务经理候选人进入下一轮沟通",
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "本地离线恢复上下文后，继续推进深圳财务经理候选人进入下一轮沟通",
    recentConversationTurns: [{ role: "user", content: "这个候选人下一步怎么推进？" }],
    query: "深圳 广州 候选人 下一轮沟通 复试 本地恢复 replay dynamics",
  });
  const state = contextBuilder?.slots?.continuousCognitiveState || null;

  assert.ok(state, "contextBuilder 应暴露 continuousCognitiveState");
  assert.equal(typeof state?.sleepPressure, "number", "contextBuilder 应暴露 sleepPressure");
  assert.equal(typeof state?.interoceptiveState?.bodyBudget, "number", "contextBuilder 应暴露 interoceptiveState");
  assert.equal(typeof state?.neuromodulators?.acetylcholineEncodeBias, "number", "contextBuilder 应暴露 neuromodulators");
  assert.equal(typeof state?.oscillationSchedule?.currentPhase, "string", "contextBuilder 应暴露 oscillationSchedule");
  assert.equal(typeof state?.replayOrchestration?.replayMode, "string", "contextBuilder 应暴露 replayOrchestration");
  assert.equal(Array.isArray(state?.replayOrchestration?.targetTraceClasses), true, "replayOrchestration 应暴露 targetTraceClasses");

  const memoryList = await listPassportMemories(agent.agentId, {
    includeInactive: true,
    limit: 80,
  });
  const staleWorking = (memoryList?.memories || []).find((entry) => entry?.summary === "过期闲聊记忆") || null;
  const nextAction = (memoryList?.memories || []).find((entry) => entry?.kind === "next_action") || null;
  const preferredCity = (memoryList?.memories || []).find((entry) => entry?.passportMemoryId === preferredCityMemory?.passportMemoryId) || null;
  const arbitratedPreference = (memoryList?.memories || []).find(
    (entry) =>
      entry?.layer === "profile" &&
      entry?.kind === "preference" &&
      entry?.payload?.field === "stable_preferences" &&
      entry?.payload?.arbitration
  ) || null;
  const offlineReplayRecord = (memoryList?.memories || []).find((entry) => entry?.kind === "offline_replay_consolidation") || null;

  assert.ok(staleWorking, "应能找到过期 working memory");
  assert.ok(staleWorking?.memoryDynamics?.lastForgettingSignal, "过期 working memory 应记录 forgetting signal");
  assert.ok(staleWorking?.memoryDynamics?.lastForgettingThresholds, "过期 working memory 应记录 forgetting thresholds");
  assert.ok(
    ["forgotten", "decayed"].includes(staleWorking?.status),
    "低信号旧 working memory 应进入遗忘或衰减状态"
  );

  assert.ok(nextAction, "应能找到 next_action memory");
  assert.ok(nextAction?.memoryDynamics?.lastReinforcementDrivers, "next_action 应记录 reinforcement drivers");
  assert.equal(typeof nextAction?.memoryDynamics?.lastReinforcementDelta, "number", "next_action 应记录 reinforcement delta");
  assert.ok(
    (nextAction?.memoryDynamics?.lastReinforcementDrivers?.taskSupportScore ?? 0) > 0,
    "next_action 应记录 query/goal support score"
  );
  assert.ok(preferredCity?.memoryDynamics?.lastReconsolidationDrivers, "冲突 city preference 应记录 reconsolidation drivers");
  assert.ok(preferredCity?.memoryDynamics?.lastReconsolidationThresholds, "冲突 city preference 应记录 reconsolidation thresholds");
  assert.ok(arbitratedPreference, "应生成带 arbitration 的 stable_preferences");
  assert.ok(
    (arbitratedPreference?.payload?.value || []).includes("prefer_local_first") &&
      (arbitratedPreference?.payload?.value || []).includes("prefer_checkpoint_resume"),
    "偏好仲裁应把恢复 / 本地优先信号并入最终 stable_preferences"
  );
  assert.ok(
    (arbitratedPreference?.payload?.arbitration?.taskSupportScore ?? 0) > 0,
    "偏好仲裁应记录任务对齐的 arbitration signal"
  );
  assert.ok(arbitratedPreference?.memoryDynamics?.lastPreferenceArbitrationDrivers, "偏好仲裁结果应记录 arbitration drivers");
  assert.equal(offlineReplay?.maintenance?.offlineReplay?.triggered, true, "demo 应触发 offline replay");
  assert.ok(offlineReplayRecord?.payload?.replayDrivers, "offline replay record 应记录 replay drivers");
  assert.equal(Array.isArray(offlineReplayRecord?.payload?.replayDrivers?.targetMatches), true, "offline replay drivers 应暴露 targetMatches");

  const queriedMemories = await listPassportMemories(agent.agentId, {
    query: "深圳 广州 候选人 城市偏好 下一轮沟通 复试",
    limit: 6,
    includeInactive: true,
  });
  const topKinds = (queriedMemories?.memories || []).slice(0, 3).map((entry) => entry?.kind);
  assert.ok((queriedMemories?.memories || []).length > 0, "动态检索后应返回 query hits");

  return {
    agentId: agent.agentId,
    state,
    staleWorking,
    nextAction,
    preferredCity,
    arbitratedPreference,
    offlineReplay: offlineReplay?.maintenance?.offlineReplay || null,
    offlineReplayRecord,
    topKinds,
  };
}

async function main() {
  const controller = await runControllerDemo();
  const ledger = await runLedgerIntegrationDemo();
  console.log(
    JSON.stringify(
      {
        ok: true,
        controller: {
          sleepPressure: controller.sleepPressure,
          dominantRhythm: controller.dominantRhythm,
          replayMode: controller.replayOrchestration?.replayMode ?? null,
          replayDrive: controller.replayOrchestration?.replayDrive ?? null,
        },
        contextState: {
          mode: ledger.state?.mode ?? null,
          sleepPressure: ledger.state?.sleepPressure ?? null,
          dominantRhythm: ledger.state?.dominantRhythm ?? null,
          currentPhase: ledger.state?.oscillationSchedule?.currentPhase ?? null,
          replayMode: ledger.state?.replayOrchestration?.replayMode ?? null,
          targetTraceClasses: ledger.state?.replayOrchestration?.targetTraceClasses ?? [],
        },
        maintenanceSignals: {
          staleWorkingStatus: ledger.staleWorking?.status ?? null,
          staleWorkingForgettingPressure: ledger.staleWorking?.memoryDynamics?.lastForgettingSignal?.forgettingPressure ?? null,
          nextActionReinforcementDelta: ledger.nextAction?.memoryDynamics?.lastReinforcementDelta ?? null,
          nextActionReinforcementTargets: ledger.nextAction?.memoryDynamics?.lastReinforcementDrivers?.targetMatches ?? [],
          reconsolidationTargets: ledger.preferredCity?.memoryDynamics?.lastReconsolidationDrivers?.targetMatches ?? [],
          preferenceAlignedSignals: ledger.arbitratedPreference?.payload?.arbitration?.alignedSignals ?? [],
          offlineReplayTargets: ledger.offlineReplayRecord?.payload?.replayDrivers?.targetMatches ?? [],
          topKinds: ledger.topKinds ?? [],
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

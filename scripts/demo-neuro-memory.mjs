import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

async function runSentenceBindingDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-binding-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    buildAgentContextBundle,
    verifyAgentResponse,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "沈知远", role: "CEO", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "沈知远",
    role: "CEO",
    currentGoal: "验证句子级证据绑定",
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus",
    summary: "当前记忆明确聚焦深圳",
    content: "当前记忆明确聚焦深圳。",
    sourceType: "verified",
    confidence: 0.91,
    payload: {
      field: "agent.focus_city",
      value: "深圳",
    },
    tags: ["memory", "verified"],
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "检查一句话是否真的绑定到证据",
    recentConversationTurns: [{ role: "user", content: "当前记忆焦点到底在哪里？" }],
    query: "当前记忆 深圳 焦点",
  });
  const verification = await verifyAgentResponse(agent.agentId, {
    responseText: "这件事已经证实了，当前记忆焦点在深圳。",
    contextBuilder,
  });
  const firstSentenceBinding = verification.references?.sentenceBindings?.[0] || null;
  const firstProposition = firstSentenceBinding?.propositions?.[0] || null;

  assert.equal(Array.isArray(firstSentenceBinding?.claimKeys), true, "sentence binding 应保留 claimKeys 数组");
  assert.equal((firstSentenceBinding?.claimKeys || []).length, 0, "这个样例不应再依赖 claimKey 命中");
  assert.equal((firstSentenceBinding?.propositions || []).length >= 1, true, "应从句子里抽出至少 1 个 proposition");
  assert.equal(firstProposition?.predicate, "candidate_prefers_destination", "应识别为当前记忆焦点 proposition");
  assert.equal(firstProposition?.object, "深圳", "应抽出 proposition object=深圳");
  assert.equal((firstProposition?.supports || []).length >= 1, true, "proposition 应绑定到至少 1 条证据");

  return {
    valid: verification.valid,
    issueCodes: verification.issues.map((item) => item.code),
    sentenceBindings: verification.references.sentenceBindings,
    propositionBindings: verification.references.propositionBindings,
    bindingSupportSummary: verification.references.bindingSupportSummary,
  };
}

async function runAmbiguousCompetitionDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-ambiguous-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    executeVerificationRun,
    listPassportMemories,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "许言舟", role: "AI / Prompt总监", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "许言舟",
    role: "AI / Prompt总监",
    currentGoal: "验证竞争性重整固",
  });
  const originalMemory = await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus",
    summary: "当前记忆之前更聚焦广州",
    content: "当前记忆之前明确聚焦广州。",
    sourceType: "reported",
    confidence: 0.67,
    salience: 0.62,
    payload: {
      field: "agent.focus_city",
      value: "广州",
    },
    tags: ["memory", "reported"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus",
    summary: "最新线索指向深圳",
    content: "当前记忆刚确认深圳优先。",
    sourceType: "reported",
    confidence: 0.74,
    salience: 0.7,
    payload: {
      field: "agent.focus_city",
      value: "深圳",
    },
    tags: ["memory", "reported", "competing"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus",
    summary: "另一条记录显示杭州",
    content: "另一条记录补充当前记忆也考虑杭州。",
    sourceType: "reported",
    confidence: 0.73,
    salience: 0.68,
    payload: {
      field: "agent.focus_city",
      value: "杭州",
    },
    tags: ["memory", "reported", "competing"],
  });

  await executeVerificationRun(agent.agentId, {
    responseText: "先让系统完成维护循环。",
    currentGoal: "重新激活城市偏好记忆并检查冲突更新",
    query: "当前记忆 广州 深圳 杭州 焦点 冲突",
  });

  const memories = await listPassportMemories(agent.agentId, {
    layer: "episodic",
    includeInactive: true,
    limit: 20,
  });
  const tracked = memories.memories.find((item) => item.passportMemoryId === originalMemory.passportMemoryId);
  assert.equal(tracked?.memoryDynamics?.lastReconsolidationOutcome, "restabilized_with_competing_evidence", "应命中 competing evidence");
  assert.equal(tracked?.memoryDynamics?.reconsolidationConflictState, "ambiguous_competition", "应保留 ambiguous competition");
  assert.equal((tracked?.memoryDynamics?.reconsolidationCandidateValues || []).length >= 3, true, "应记录多个 competing values");

  return {
    value: tracked?.payload?.value,
    outcome: tracked?.memoryDynamics?.lastReconsolidationOutcome,
    conflictState: tracked?.memoryDynamics?.reconsolidationConflictState,
    predictionErrorScore: tracked?.memoryDynamics?.lastPredictionErrorScore,
    candidateValues: tracked?.memoryDynamics?.reconsolidationCandidateValues,
  };
}

async function runRewriteDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-rewrite-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    executeVerificationRun,
    listPassportMemories,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "许言舟", role: "AI / Prompt总监", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "许言舟",
    role: "AI / Prompt总监",
    currentGoal: "验证强证据改写",
  });
  const originalMemory = await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus",
    summary: "当前记忆之前更聚焦广州",
    content: "当前记忆之前明确聚焦广州。",
    sourceType: "reported",
    confidence: 0.62,
    salience: 0.58,
    payload: {
      field: "agent.focus_city",
      value: "广州",
    },
    tags: ["memory", "reported"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus",
    summary: "当前记忆最新确认更聚焦深圳",
    content: "当前记忆刚刚明确确认深圳优先，并收回了广州焦点。",
    sourceType: "verified",
    confidence: 0.94,
    salience: 0.82,
    payload: {
      field: "agent.focus_city",
      value: "深圳",
    },
    tags: ["memory", "verified"],
  });

  await executeVerificationRun(agent.agentId, {
    responseText: "先让系统完成维护循环。",
    currentGoal: "重新激活城市偏好记忆并检查强证据改写",
    query: "当前记忆 广州 深圳 焦点",
  });

  const memories = await listPassportMemories(agent.agentId, {
    layer: "episodic",
    includeInactive: true,
    limit: 20,
  });
  const tracked = memories.memories.find((item) => item.passportMemoryId === originalMemory.passportMemoryId);
  assert.equal(tracked?.payload?.value, "深圳", "强证据应改写成深圳");
  assert.equal(tracked?.memoryDynamics?.lastReconsolidationOutcome, "rewritten_from_stronger_evidence", "应命中 rewrite");
  assert.equal((tracked?.payload?.reconsolidationPreviousValues || []).length >= 1, true, "应保留 previous values");

  return {
    value: tracked?.payload?.value,
    outcome: tracked?.memoryDynamics?.lastReconsolidationOutcome,
    conflictState: tracked?.memoryDynamics?.reconsolidationConflictState,
    predictionErrorScore: tracked?.memoryDynamics?.lastPredictionErrorScore,
    previousValues: tracked?.payload?.reconsolidationPreviousValues || [],
  };
}

async function runWorkingMemoryGateDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-gate-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    buildAgentContextBundle,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "陈以衡", role: "记忆推进 Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "陈以衡",
    role: "记忆推进 Agent",
    currentGoal: "恢复深圳记忆校验计划",
  });
  await writePassportMemory(agent.agentId, {
    layer: "working",
    kind: "conversation_turn",
    summary: "闲聊天气",
    content: "今天的天气不错，我们晚点再说。",
    sourceType: "reported",
    confidence: 0.58,
    payload: { role: "user" },
    tags: ["conversation", "smalltalk"],
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await writePassportMemory(agent.agentId, {
    layer: "working",
    kind: "conversation_turn",
    summary: "推进深圳记忆校验",
    content: "请继续推进深圳记忆链的下一轮校验安排。",
    sourceType: "reported",
    confidence: 0.8,
    payload: { role: "user" },
    tags: ["conversation", "memory", "shenzhen", "runtime"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "working",
    kind: "tool_result",
    summary: "运行态返回最新记忆状态",
    content: "深圳记忆链已完成一轮校验，等待下一轮验证时间。",
    sourceType: "system",
    confidence: 0.88,
    payload: { tool: "ats_lookup", field: "current_task" },
    tags: ["tool_result", "memory", "runtime", "shenzhen"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "working",
    kind: "checkpoint_summary",
    summary: "working checkpoint：深圳记忆校验推进",
    content: "当前目标：安排下一轮校验并确认恢复窗口。",
    sourceType: "system",
    confidence: 0.9,
    payload: { currentGoal: "恢复深圳记忆校验计划" },
    tags: ["checkpoint", "memory", "runtime", "shenzhen"],
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "恢复深圳记忆校验计划",
    query: "深圳 记忆 校验 恢复窗口",
  });

  const gate = contextBuilder.slots?.workingMemoryGate || {};
  const selectedKinds = (gate.selected || []).map((item) => item.kind);
  const blockedKinds = (gate.blocked || []).map((item) => item.kind);
  const blockedSummaries = (gate.blocked || []).map((item) => item.summary || "");

  assert.equal(gate.selectedCount >= 2, true, "working memory gate 应至少选中 2 条记录");
  assert.equal(selectedKinds.includes("checkpoint_summary"), true, "checkpoint_summary 应通过 gate");
  assert.equal(selectedKinds.includes("tool_result"), true, "关键 tool_result 应通过 gate");
  assert.equal(blockedKinds.includes("conversation_turn"), true, "至少一条低相关对话应被 gate 阻挡");
  assert.equal(blockedSummaries.some((item) => item.includes("闲聊天气")), true, "闲聊 working memory 应进入 blocked 集");

  return {
    selectedCount: gate.selectedCount,
    blockedCount: gate.blockedCount,
    averageGateScore: gate.averageGateScore,
    selectedKinds,
    blockedSummaries,
  };
}

async function runRealityMonitoringDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-reality-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    buildAgentContextBundle,
    verifyAgentResponse,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "林见川", role: "记忆校验 Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "林见川",
    role: "记忆校验 Agent",
    currentGoal: "检查 reality monitoring",
  });
  await writePassportMemory(agent.agentId, {
    layer: "semantic",
    kind: "memory_focus_inference",
    summary: "推断当前记忆大概率会继续聚焦深圳",
    content: "根据多轮回放压缩后推断，当前记忆大概率会继续聚焦深圳。",
    sourceType: "derived",
    confidence: 0.63,
    payload: {
      field: "agent.focus_city",
      value: "深圳",
    },
    tags: ["memory", "focus", "derived"],
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "检查 reality monitoring",
    recentConversationTurns: [{ role: "user", content: "当前记忆是不是已经确认聚焦深圳了？" }],
    query: "当前记忆 深圳 焦点 确认",
  });
  const verification = await verifyAgentResponse(agent.agentId, {
    responseText: "这已经证实了，当前记忆焦点在深圳。",
    contextBuilder,
  });

  const issueCodes = verification.issues.map((item) => item.code);
  assert.equal(issueCodes.includes("proposition_reality_gap"), true, "应命中 proposition-level reality monitoring 问题");

  return {
    valid: verification.valid,
    issueCodes,
    sourceMonitoring: verification.references?.sourceMonitoring?.counts || null,
    bindingSupportSummary: verification.references?.bindingSupportSummary || null,
  };
}

async function runDiscourseNegationCounterfactualDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-discourse-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    buildAgentContextBundle,
    verifyAgentResponse,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "季衡川", role: "记忆判断 Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "季衡川",
    role: "记忆判断 Agent",
    currentGoal: "验证 discourse / negation / counterfactual",
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus",
    summary: "当前记忆焦点在上海",
    content: "当前记忆焦点在上海。",
    sourceType: "verified",
    confidence: 0.93,
    payload: {
      field: "agent.focus_city",
      value: "上海",
    },
    tags: ["memory", "verified", "focus"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus_note",
    summary: "当前记忆明确不再聚焦深圳",
    content: "当前记忆明确不再聚焦深圳，而是继续留在上海。",
    sourceType: "reported",
    confidence: 0.85,
    tags: ["memory", "reported", "focus"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "semantic",
    kind: "counterfactual_recommendation_note",
    summary: "如果目标上下文在深圳，建议不再推进",
    content: "如果目标上下文在深圳，建议不再推进。",
    sourceType: "reported",
    confidence: 0.76,
    tags: ["context", "reported", "counterfactual"],
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "验证 discourse / negation / counterfactual",
    recentConversationTurns: [{ role: "user", content: "当前记忆和深圳上下文到底是什么关系？" }],
    query: "当前记忆 深圳 目标上下文 在深圳 建议不再推进",
  });
  const verification = await verifyAgentResponse(agent.agentId, {
    responseText: "当前记忆焦点在上海。不再聚焦深圳。如果目标上下文在深圳，建议不再推进。",
    contextBuilder,
  });

  const sentenceBindings = verification.references?.sentenceBindings || [];
  const negatedPreference = sentenceBindings[1]?.propositions?.[0] || null;
  const counterfactualRecommendation = sentenceBindings[2]?.propositions?.find((item) => item.predicate === "recommendation") || null;
  const counterfactualTrace = verification.references?.counterfactualTraces?.[0] || null;
  const discourseGraph = verification.references?.discourseGraph || null;
  const issueCodes = verification.issues.map((item) => item.code);

  assert.equal(verification.references?.discourseState?.activeReferentIds?.includes("disc_candidate"), true, "应激活当前记忆 discourse referent");
  assert.equal((discourseGraph?.counts?.edges || 0) >= 2, true, "discourse graph 应至少包含 referent/proposition 边");
  assert.equal(negatedPreference?.subject, "当前记忆", "省略主语应回绑到当前记忆");
  assert.equal(negatedPreference?.subjectResolution?.mode, "active_referent", "省略主语应优先回绑 active referent");
  assert.equal(negatedPreference?.polarity, "negated", "不再聚焦深圳应被标成 negated proposition");
  assert.equal((negatedPreference?.discourseRefs || []).includes("disc_candidate"), true, "negated proposition 应保留 discourse ref");
  assert.equal(negatedPreference?.negationScope?.cue, "不再", "negationScope 应保留否定线索");
  assert.equal((negatedPreference?.supports || []).length >= 1, true, "negated proposition 应绑定到至少 1 条支撑");
  assert.equal(counterfactualRecommendation?.subject, "匹配结果", "反事实 recommendation 应落在匹配结果主体");
  assert.equal(counterfactualRecommendation?.counterfactual, true, "如果...建议不再推进... 应被标成 counterfactual");
  assert.equal(counterfactualRecommendation?.polarity, "negated", "不再推进应被标成 negated");
  assert.equal((counterfactualRecommendation?.supports || []).length >= 1, true, "counterfactual proposition 也应绑定到至少 1 条支撑");
  assert.equal(counterfactualTrace?.simulationOnly, true, "counterfactual proposition 应生成 simulation-only trace");
  assert.equal(counterfactualTrace?.conditionText?.includes("目标上下文在深圳"), true, "counterfactual trace 应保留条件子句");
  assert.equal(issueCodes.includes("proposition_reality_gap"), false, "当前样例不应把 counterfactual proposition 误判成现实性缺口");

  return {
    valid: verification.valid,
    issueCodes,
    discourseState: verification.references?.discourseState || null,
    discourseGraph,
    negatedPreference,
    counterfactualRecommendation,
    counterfactualTrace,
  };
}

async function runQuantifierParagraphDiscourseDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-quantifier-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    buildAgentContextBundle,
    verifyAgentResponse,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "顾闻澈", role: "跨段命题 Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "顾闻澈",
    role: "跨段命题 Agent",
    currentGoal: "验证 quantifier / implicit subject / cross-paragraph discourse",
  });
  await writePassportMemory(agent.agentId, {
    layer: "profile",
    kind: "memory_focus_schema",
    summary: "agent.memory_focus_schema: 南山",
    content: "当前记忆在南山还有一条辅助焦点。",
    sourceType: "reported",
    confidence: 0.83,
    payload: {
      field: "agent.memory_focus_schema",
      value: { city: "南山" },
    },
    tags: ["memory", "reported", "subfocus"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "semantic",
    kind: "group_preference_note",
    summary: "至少两项当前记忆都聚焦深圳，其中一项还聚焦南山。",
    content: "至少两项当前记忆都聚焦深圳，其中一项还聚焦南山。",
    sourceType: "reported",
    confidence: 0.8,
    tags: ["memory", "reported", "group_preference"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "semantic",
    kind: "openneed_semantic_schema",
    summary: "决策来源：进入下一轮沟通 · 已确认",
    content: "决策来源：进入下一轮沟通 · 已确认",
    sourceType: "verified",
    confidence: 0.9,
    payload: {
      field: "match.decision_provenance",
      value: {
        recommendation: "进入下一轮沟通",
        nextAction: "动作：安排下一轮面试",
        status: "confirmed",
        owner: "运行协调人",
        confirmations: [
          { source: "运行协调确认", by: "运行协调人", note: "建议继续推进。" },
          { source: "系统状态更新", by: "系统同步", note: "流程卡已创建。" },
        ],
        confirmationCount: 2,
        confirmationMode: "multi_source",
      },
    },
    tags: ["matching", "verified", "decision"],
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "验证 quantifier / implicit subject / cross-paragraph discourse",
    recentConversationTurns: [{ role: "user", content: "请概括当前记忆群体焦点和当前推进建议。" }],
    query: "至少两项 当前记忆 深圳 南山 进入下一轮沟通",
  });
  const verification = await verifyAgentResponse(agent.agentId, {
    responseText: "至少两项当前记忆都聚焦深圳。\n另外，聚焦南山。\n因此建议进入下一轮沟通。",
    contextBuilder,
  });

  const sentenceBindings = verification.references?.sentenceBindings || [];
  const quantifiedPreference = sentenceBindings[0]?.propositions?.find((item) => item.predicate === "candidate_prefers_destination") || null;
  const implicitPreference = sentenceBindings[1]?.propositions?.find((item) => item.predicate === "candidate_prefers_destination") || null;
  const recommendation = sentenceBindings[2]?.propositions?.find((item) => item.predicate === "recommendation") || null;
  const discourseGraph = verification.references?.discourseGraph || null;
  const issueCodes = verification.issues.map((item) => item.code);

  assert.equal(String(quantifiedPreference?.quantifier || "").startsWith("至少两项"), true, "应保留 quantifier=至少两项");
  assert.equal(quantifiedPreference?.subject, "当前记忆", "group subject 仍应规范到当前记忆 referent");
  assert.equal((quantifiedPreference?.discourseRefs || []).includes("disc_candidate"), true, "quantified proposition 应绑定当前记忆 referent");
  assert.equal(implicitPreference?.subject, "当前记忆", "省略主语的聚焦句应回绑到当前记忆");
  assert.equal(implicitPreference?.subjectResolution?.mode, "active_referent", "省略主语应优先从 active referent 恢复");
  assert.equal((implicitPreference?.supports || []).length >= 1, true, "implicit focus proposition 应绑定至少 1 条支撑");
  assert.equal(recommendation?.epistemicStatus, "confirmed", "confirmed decision provenance 应把 recommendation 拉到 confirmed");
  assert.equal(recommendation?.supportSummary?.verifiedEquivalentCount >= 1, true, "confirmed recommendation 应有 verifiedEquivalent support");
  assert.equal(issueCodes.includes("proposition_binding_gap"), false, "多段 discourse 样例不应出现 proposition_binding_gap");
  assert.equal((discourseGraph?.counts?.propositions || 0) >= 3, true, "discourse graph 应包含多条 proposition 节点");

  return {
    valid: verification.valid,
    issueCodes,
    quantifiedPreference,
    implicitPreference,
    recommendation,
    discourseState: verification.references?.discourseState || null,
    discourseGraph,
  };
}

async function runClauseScopeDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-clause-scope-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    buildAgentContextBundle,
    verifyAgentResponse,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "容既明", role: "子句 scope Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "容既明",
    role: "子句 scope Agent",
    currentGoal: "验证 clause-level negation / quantifier scope",
  });
  await writePassportMemory(agent.agentId, {
    layer: "semantic",
    kind: "group_scope_note",
    summary: "不是所有当前记忆都聚焦深圳，但大多数当前记忆更聚焦深圳。",
    content: "不是所有当前记忆都聚焦深圳，但大多数当前记忆更聚焦深圳。",
    sourceType: "reported",
    confidence: 0.84,
    tags: ["memory", "reported", "quantifier_scope"],
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "验证 clause-level negation / quantifier scope",
    recentConversationTurns: [{ role: "user", content: "请严格区分 not-all 和 majority，不要把两句混掉。" }],
    query: "不是所有当前记忆 深圳 大多数当前记忆 深圳",
  });
  const verification = await verifyAgentResponse(agent.agentId, {
    responseText: "不是所有当前记忆都聚焦深圳，但大多数当前记忆更聚焦深圳。",
    contextBuilder,
  });

  const sentenceBindings = verification.references?.sentenceBindings || [];
  const propositions = sentenceBindings[0]?.propositions || [];
  const negatedUniversal = propositions.find((item) => item.quantifierScope?.family === "negated_universal");
  const majorityPreference = propositions.find((item) => item.quantifierScope?.family === "majority");
  const issueCodes = verification.issues.map((item) => item.code);

  assert.ok(negatedUniversal, "应抽出 negated universal proposition");
  assert.ok(majorityPreference, "应抽出 majority proposition");
  assert.equal(negatedUniversal?.polarity, "negated", "not-all clause 应保持 negated");
  assert.equal(negatedUniversal?.quantifierScope?.family, "negated_universal", "not-all clause 应标成 negated_universal");
  assert.equal(negatedUniversal?.negationScope?.clauseText, "不是所有当前记忆都聚焦深圳", "negation scope 应收敛到首个 clause");
  assert.equal(majorityPreference?.quantifierScope?.family, "majority", "majority clause 应标成 majority");
  assert.equal(majorityPreference?.quantifierScope?.clauseText, "大多数当前记忆更聚焦深圳", "quantifier scope 应收敛到第二个 clause");
  assert.notEqual(negatedUniversal?.propositionKey, majorityPreference?.propositionKey, "不同 quantifier scope 不应共用 propositionKey");
  assert.equal(issueCodes.includes("proposition_binding_gap"), false, "clause scope 样例不应出现 proposition_binding_gap");

  return {
    valid: verification.valid,
    issueCodes,
    negatedUniversal,
    majorityPreference,
  };
}

async function runClauseFrameDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-clause-frame-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    buildAgentContextBundle,
    verifyAgentResponse,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "沈既白", role: "子句框架 Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "沈既白",
    role: "子句框架 Agent",
    currentGoal: "验证 exclusive condition / negated causal frame",
  });
  await writePassportMemory(agent.agentId, {
    layer: "semantic",
    kind: "exclusive_condition_note",
    summary: "只有当前记忆聚焦深圳，才建议进入下一轮沟通。",
    content: "只有当前记忆聚焦深圳，才建议进入下一轮沟通。",
    sourceType: "reported",
    confidence: 0.86,
    tags: ["memory", "reported", "exclusive_condition"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "semantic",
    kind: "negated_causal_note",
    summary: "并不是因为恢复窗口太紧，所以不建议进入下一轮沟通。",
    content: "并不是因为恢复窗口太紧，所以不建议进入下一轮沟通。",
    sourceType: "reported",
    confidence: 0.84,
    tags: ["memory", "reported", "negated_causal"],
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "验证 exclusive condition / negated causal frame",
    recentConversationTurns: [{ role: "user", content: "请区分只有...才... 和 并不是因为...所以... 的子句框架。" }],
    query: "只有 当前记忆 聚焦深圳 才 建议进入下一轮沟通 并不是因为 恢复窗口太紧 所以 不建议",
  });
  const verification = await verifyAgentResponse(agent.agentId, {
    responseText: "只有当前记忆聚焦深圳，才建议进入下一轮沟通。并不是因为恢复窗口太紧，所以不建议进入下一轮沟通。",
    contextBuilder,
  });

  const sentenceBindings = verification.references?.sentenceBindings || [];
  const exclusiveCandidate = sentenceBindings[0]?.propositions?.find((item) => item.predicate === "candidate_prefers_destination") || null;
  const exclusiveRecommendation = sentenceBindings[0]?.propositions?.find((item) => item.predicate === "recommendation") || null;
  const negatedRecommendation = sentenceBindings[1]?.propositions?.find((item) => item.predicate === "recommendation") || null;
  const discourseGraph = verification.references?.discourseGraph || null;
  const issueCodes = verification.issues.map((item) => item.code);

  assert.ok(exclusiveCandidate, "exclusive condition 句应抽出 candidate_prefers_destination proposition");
  assert.ok(exclusiveRecommendation, "exclusive condition 句应抽出 recommendation proposition");
  assert.ok(negatedRecommendation, "negated causal 句应抽出 recommendation proposition");
  assert.equal(exclusiveCandidate?.quantifierScope?.frameType, "exclusive_condition", "antecedent proposition 应记录 exclusive_condition frame");
  assert.equal(exclusiveCandidate?.quantifierScope?.frameRole, "antecedent", "当前记忆焦点 proposition 应被标成 antecedent");
  assert.equal(exclusiveRecommendation?.quantifierScope?.frameType, "exclusive_condition", "recommendation proposition 应记录 exclusive_condition frame");
  assert.equal(exclusiveRecommendation?.quantifierScope?.frameRole, "consequent", "recommendation proposition 应被标成 consequent");
  assert.equal(negatedRecommendation?.negationScope?.frameType, "negated_causal", "不建议 proposition 应记录 negated_causal frame");
  assert.equal(negatedRecommendation?.negationScope?.frameRole, "consequent", "negated causal 的 recommendation 应落在 consequent");
  assert.equal(
    (discourseGraph?.edges || []).some((item) => item?.relation === "exclusive_condition_gate"),
    true,
    "discourse graph 应保留 exclusive_condition_gate 边"
  );
  assert.equal(
    (discourseGraph?.edges || []).some((item) => item?.relation === "negated_causal_frame"),
    true,
    "discourse graph 应保留 negated_causal_frame 边"
  );
  assert.equal(issueCodes.includes("proposition_binding_gap"), false, "clause frame 样例不应出现 proposition_binding_gap");

  return {
    valid: verification.valid,
    issueCodes,
    exclusiveCandidate,
    exclusiveRecommendation,
    negatedRecommendation,
    discourseGraph,
  };
}

async function runRecommendationContinuationDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-recommendation-continuation-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    buildAgentContextBundle,
    verifyAgentResponse,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "周叙衡", role: "recommendation regression Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "周叙衡",
    role: "recommendation regression Agent",
    currentGoal: "验证 recommendation 不会被裸 再 错切",
  });
  await writePassportMemory(agent.agentId, {
    layer: "semantic",
    kind: "openneed_semantic_schema",
    summary: "反馈后决策：先补验证再推进 · 已确认",
    content: "反馈后决策：先补验证再推进 · 已确认",
    sourceType: "verified",
    confidence: 0.91,
    payload: {
      field: "match.decision_provenance",
      value: {
        recommendation: "先补验证再推进",
        nextAction: "动作：先补验证再推进",
        status: "confirmed",
        owner: "验证负责人",
        policy: "human_feedback_override",
        confirmations: [
          { source: "人工审批", by: "验证负责人", status: "confirmed", note: "先补验证更稳妥。" },
          { source: "面试日程系统", by: "Scheduler", status: "confirmed", note: "原时间窗口已释放。" },
        ],
        confirmationCount: 2,
        confirmationMode: "multi_source",
      },
    },
    tags: ["matching", "verified", "manual_correction"],
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "验证 recommendation continuation",
    recentConversationTurns: [{ role: "user", content: "人工纠正后应该怎么推进？" }],
    query: "人工纠正 先补验证再推进 recommendation",
  });
  const verification = await verifyAgentResponse(agent.agentId, {
    responseText: "因此建议先补验证再推进。",
    contextBuilder,
  });

  const sentenceBindings = verification.references?.sentenceBindings || [];
  const recommendation = sentenceBindings[0]?.propositions?.find((item) => item.predicate === "recommendation") || null;
  const issueCodes = verification.issues.map((item) => item.code);

  assert.ok(recommendation, "应抽出 recommendation proposition");
  assert.equal(recommendation?.object, "先补验证再推进", "recommendation object 不应被截断成局部短语");
  assert.equal(recommendation?.epistemicStatus, "confirmed", "confirmed decision provenance 应把 recommendation 拉到 confirmed");
  assert.equal(recommendation?.supportSummary?.verifiedEquivalentCount >= 1, true, "recommendation 应绑定到 verifiedEquivalent 支撑");
  assert.equal(issueCodes.includes("proposition_superseded_by_current_decision"), false, "当前 recommendation 不应被误判成 superseded");

  return {
    valid: verification.valid,
    issueCodes,
    recommendation,
  };
}

async function runConfirmationLifecycleDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-confirmation-lifecycle-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    buildAgentContextBundle,
    verifyAgentResponse,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "秦照野", role: "确认生命周期 Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "秦照野",
    role: "确认生命周期 Agent",
    currentGoal: "验证 confirmation lifecycle 会进入 proposition-level binding",
  });
  await writePassportMemory(agent.agentId, {
    layer: "semantic",
    kind: "match_confirmation_lifecycle",
    summary: "确认生命周期：有 1 个 adapter 确认已超时",
    content: "scheduler_confirmation 等待超时，当前不能把推进建议当成已确认结论。",
    sourceType: "reported",
    confidence: 0.86,
    payload: {
      field: "match.confirmation_lifecycle",
      value: {
        recommendation: "进入下一轮沟通",
        nextAction: "动作：进入下一轮推进",
        status: "confirmation_timeout",
        summary: "有 1 个 adapter 确认已超时",
        requestCount: 2,
        pendingRequestCount: 1,
        timedOutRequestCount: 1,
        resolvedRequestCount: 1,
        awaitingAdapters: ["human_review_confirmation"],
        timedOutAdapters: ["scheduler_confirmation"],
        resolvedAdapters: ["ats_confirmation"],
        entries: [
          {
            adapterName: "scheduler_confirmation",
            source: "面试日程系统",
            lifecycleStatus: "timed_out",
            requestNote: "等待面试时间锁定",
          },
          {
            adapterName: "ats_confirmation",
            source: "ATS状态更新",
            lifecycleStatus: "resolved_confirmed",
            matchedConfirmationStatus: "confirmed",
            matchedConfirmationNote: "流程卡已创建",
          },
        ],
        reconciliation: {
          agreementStatus: "confirmation_timeout",
          effectiveDecisionStatus: "decided",
        },
        confirmationHealth: {
          agreementStatus: "confirmation_timeout",
          timedOutRequestCount: 1,
          pendingRequestCount: 1,
        },
      },
    },
    tags: ["confirmation", "timeout", "adapter"],
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "验证 timeout lifecycle 会阻止 recommendation 冒充已确认结论",
    recentConversationTurns: [{ role: "user", content: "现在能直接进入下一轮沟通吗？" }],
    query: "confirmation lifecycle timeout recommendation 进入下一轮沟通",
  });
  const verification = await verifyAgentResponse(agent.agentId, {
    responseText: "因此建议进入下一轮沟通。",
    contextBuilder,
  });

  const issueCodes = verification.issues.map((item) => item.code);
  const recommendation = (verification.references?.propositionBindings || []).find((item) => item.predicate === "recommendation");
  assert.ok(recommendation, "confirmation lifecycle demo 应抽出 recommendation proposition");
  assert.equal(
    recommendation?.supportSummary?.confirmationAgreementStatusCounts?.confirmation_timeout >= 1,
    true,
    "recommendation 应绑定到 confirmation_timeout 支撑"
  );
  assert.equal(issueCodes.includes("proposition_confirmation_timeout"), true, "timeout lifecycle 应显式暴露 proposition_confirmation_timeout");

  return {
    valid: verification.valid,
    issueCodes,
    recommendation: {
      object: recommendation?.object || null,
      supportSummary: recommendation?.supportSummary || null,
    },
  };
}

async function runContinuousCognitiveStateDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-continuous-state-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    executeVerificationRun,
    getAgentCognitiveState,
    buildAgentContextBundle,
    runAgentOfflineReplay,
    listPassportMemories,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "沈观澜", role: "连续状态 Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "沈观澜",
    role: "连续状态 Agent",
    currentGoal: "验证 fatigue / sleepDebt",
  });

  for (const [index, item] of [
    ["conversation_turn", "先回顾深圳记忆链的推进轨迹。"],
    ["conversation_turn", "补充下一轮校验时间窗口。"],
    ["tool_result", "运行态返回当前记忆焦点仍在深圳。"],
    ["tool_result", "日程系统提示本周可安排下一轮校验。"],
    ["checkpoint_summary", "checkpoint：推进深圳记忆链校验。"],
    ["checkpoint_summary", "checkpoint：同步恢复窗口和校验反馈。"],
  ].entries()) {
    await writePassportMemory(agent.agentId, {
      layer: "working",
      kind: item[0],
      summary: typeof item[1] === "string" ? item[1] : `working memory ${index + 1}`,
      content: typeof item[1] === "string" ? item[1] : `working memory ${index + 1}`,
      sourceType: item[0] === "tool_result" ? "system" : "reported",
      confidence: item[0] === "tool_result" ? 0.88 : 0.78,
      tags: ["memory", "working", "shenzhen"],
    });
  }

  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus",
    summary: "当前记忆焦点在深圳",
    content: "当前记忆焦点在深圳，并保持稳定。",
    sourceType: "verified",
    confidence: 0.92,
    boundaryLabel: "continuous_state_loop",
    patternKey: "memory:continuous_state_loop",
    payload: {
      field: "agent.focus_city",
      value: "深圳",
    },
    tags: ["memory", "verified", "shenzhen"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "next_action",
    summary: "下一步安排下一轮校验",
    content: "下一步安排下一轮校验，并确认时间。",
    sourceType: "system",
    confidence: 0.86,
    boundaryLabel: "continuous_state_loop",
    patternKey: "memory:continuous_state_loop",
    payload: {
      field: "next_action",
      value: "安排下一轮校验",
    },
    tags: ["memory", "shenzhen", "next_action"],
  });

  for (let round = 0; round < 3; round += 1) {
    await executeVerificationRun(agent.agentId, {
      responseText: "执行一次 runtime integrity 校验。",
      currentGoal: "验证 fatigue / sleepDebt",
      query: `深圳 候选人 复试 连续状态 round ${round + 1}`,
      offlineReplayRequested: false,
    });
  }

  const cognitiveState = await getAgentCognitiveState(agent.agentId);
  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "验证 fatigue / sleepDebt",
    query: "连续状态 fatigue sleepDebt 深圳记忆链 校验",
  });
  const replay = await runAgentOfflineReplay(agent.agentId, {
    currentGoal: "验证 fatigue / sleepDebt",
  });
  const semanticMemories = await listPassportMemories(agent.agentId, {
    layer: "semantic",
    includeInactive: true,
    limit: 40,
  });
  const stageTraceRecord = [...semanticMemories.memories]
    .filter((item) => item.kind === "offline_replay_stage_trace")
    .sort((left, right) => (right.recordedAt || "").localeCompare(left.recordedAt || ""))[0] || null;

  assert.equal(typeof cognitiveState?.fatigue, "number", "cognitiveState 应包含 fatigue");
  assert.equal(typeof cognitiveState?.sleepDebt, "number", "cognitiveState 应包含 sleepDebt");
  assert.equal(typeof cognitiveState?.uncertainty, "number", "cognitiveState 应包含 uncertainty");
  assert.equal(typeof cognitiveState?.homeostaticPressure, "number", "cognitiveState 应包含 homeostaticPressure");
  assert.equal(typeof cognitiveState?.bodyLoop?.taskBacklog, "number", "cognitiveState 应包含 bodyLoop taskBacklog");
  assert.equal(cognitiveState?.fatigue > 0, true, "fatigue 应大于 0");
  assert.equal(cognitiveState?.sleepDebt > 0, true, "sleepDebt 应大于 0");
  assert.equal(typeof contextBuilder?.slots?.continuousCognitiveState?.fatigue, "number", "contextBuilder 应暴露 fatigue");
  assert.equal(typeof contextBuilder?.slots?.continuousCognitiveState?.sleepDebt, "number", "contextBuilder 应暴露 sleepDebt");
  assert.equal(typeof contextBuilder?.slots?.continuousCognitiveState?.bodyLoop?.overallLoad, "number", "contextBuilder 应暴露 bodyLoop overallLoad");
  assert.equal(replay?.maintenance?.offlineReplay?.triggered, true, "offline replay 应成功触发");
  assert.equal(typeof replay?.maintenance?.offlineReplay?.sleepPressure, "number", "offline replay 结果应包含 sleepPressure");
  assert.equal(typeof replay?.maintenance?.offlineReplay?.cognitiveStateSnapshot?.homeostaticPressure, "number", "offline replay 应携带 controller snapshot");
  assert.equal(stageTraceRecord?.payload?.cognitiveStateSnapshot?.fatigue, cognitiveState?.fatigue, "sleep stage trace 应携带 fatigue snapshot");
  assert.equal(stageTraceRecord?.payload?.cognitiveStateSnapshot?.sleepDebt, cognitiveState?.sleepDebt, "sleep stage trace 应携带 sleepDebt snapshot");

  return {
    cognitiveState,
    contextState: contextBuilder?.slots?.continuousCognitiveState || null,
    offlineReplay: replay?.maintenance?.offlineReplay || null,
    sleepStageTrace: stageTraceRecord?.payload || null,
  };
}

async function runOfflineReplayDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-offline-replay-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    runAgentOfflineReplay,
    listPassportMemories,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "周拙言", role: "记忆整固 Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "周拙言",
    role: "记忆整固 Agent",
    currentGoal: "离线回放深圳记忆校验链",
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus",
    summary: "当前记忆焦点在深圳",
    content: "当前记忆焦点在深圳，并已完成一轮稳定校验。",
    sourceType: "verified",
    confidence: 0.9,
    salience: 0.82,
    boundaryLabel: "shenzhen_memory_loop",
    patternKey: "memory:shenzhen_focus_progress",
    payload: {
      field: "agent.focus_city",
      value: "深圳",
    },
    tags: ["memory", "runtime", "shenzhen"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "next_action",
    summary: "下一步需要安排下一轮校验",
    content: "下一阶段是安排下一轮校验，并确认恢复窗口。",
    sourceType: "system",
    confidence: 0.84,
    salience: 0.79,
    boundaryLabel: "shenzhen_memory_loop",
    patternKey: "memory:shenzhen_focus_progress",
    payload: {
      field: "next_action",
      value: "安排下一轮校验",
    },
    tags: ["memory", "runtime", "shenzhen"],
  });

  const replay = await runAgentOfflineReplay(agent.agentId, {
    currentGoal: "离线回放深圳记忆校验链",
  });
  const memories = await listPassportMemories(agent.agentId, {
    layer: "semantic",
    includeInactive: true,
    limit: 40,
  });
  const offlineRecord = memories.memories.find((item) => item.kind === "offline_replay_consolidation");
  const stageTraceRecord = memories.memories.find((item) => item.kind === "offline_replay_stage_trace");
  const eventGraphRecord = memories.memories.find((item) => item.kind === "offline_replay_event_graph");

  assert.equal(replay.maintenance?.offlineReplay?.triggered, true, "offline replay 应被触发");
  assert.ok(offlineRecord, "应生成 offline_replay_consolidation");
  assert.ok(stageTraceRecord, "应生成 offline_replay_stage_trace");
  assert.ok(eventGraphRecord, "应生成 offline_replay_event_graph");
  assert.equal((replay.maintenance?.offlineReplay?.stageSequence || []).length, 3, "应包含 3 个睡眠阶段");

  return {
    offlineReplay: replay.maintenance?.offlineReplay || null,
    offlineReplaySummary: offlineRecord?.summary || null,
    stageTrace: stageTraceRecord?.payload?.stages || null,
    eventGraph: eventGraphRecord?.payload?.value || null,
    payload: offlineRecord?.payload || null,
  };
}

async function runCausalBindingDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-causal-binding-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    buildAgentContextBundle,
    verifyAgentResponse,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "顾行止", role: "流程推理 Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "顾行止",
    role: "流程推理 Agent",
    currentGoal: "验证跨句因果绑定",
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus",
    summary: "当前记忆焦点在深圳",
    content: "当前记忆焦点在深圳。",
    sourceType: "verified",
    confidence: 0.92,
    boundaryLabel: "memory_focus_step",
    patternKey: "memory:focus_step",
    payload: {
      field: "agent.focus_city",
      value: "深圳",
    },
    tags: ["memory", "focus", "verified"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "working",
    kind: "next_action",
    summary: "安排下一轮校验",
    content: "下一步应该安排下一轮校验，并确认时间。",
    sourceType: "system",
    confidence: 0.87,
    boundaryLabel: "memory_focus_step",
    patternKey: "memory:focus_step",
    payload: {
      field: "next_action",
      value: "安排下一轮校验",
    },
    tags: ["next_action", "memory"],
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "验证跨句因果绑定",
    recentConversationTurns: [{ role: "user", content: "为什么下一步是下一轮校验？" }],
    query: "当前记忆 深圳 下一步 下一轮校验",
  });
  const verification = await verifyAgentResponse(agent.agentId, {
    responseText: "当前记忆焦点在深圳。因此下一步应该安排下一轮校验。",
    contextBuilder,
  });

  const issueCodes = verification.issues.map((item) => item.code);
  assert.equal(issueCodes.includes("causal_binding_gap"), false, "有支撑的因果链不应命中 causal_binding_gap");
  assert.equal(issueCodes.includes("causal_relation_reality_gap"), false, "有支撑的因果链不应命中 causal_relation_reality_gap");
  assert.equal((verification.references?.causalBindings || []).length >= 1, true, "应产出至少 1 条 causal binding");
  assert.equal(verification.references?.causalBindings?.[0]?.eventGraphPath?.pathFound, true, "单跳因果也应找到事件图路径");

  return {
    valid: verification.valid,
    issueCodes,
    causalBindings: verification.references?.causalBindings || [],
  };
}

async function runMultiHopCausalChainDemo() {
  const ledgerModule = await loadLedgerModuleForDemo("agent-passport-causal-chain-");
  const {
    registerAgent,
    bootstrapAgentRuntime,
    writePassportMemory,
    buildAgentContextBundle,
    verifyAgentResponse,
  } = ledgerModule;

  const agent = await registerAgent({ displayName: "闻照临", role: "多跳推理 Agent", controller: "Kane" });
  await bootstrapAgentRuntime(agent.agentId, {
    name: "闻照临",
    role: "多跳推理 Agent",
    currentGoal: "验证 multi-hop causal chain",
  });
  await writePassportMemory(agent.agentId, {
    layer: "episodic",
    kind: "memory_focus",
    summary: "当前记忆焦点在深圳",
    content: "当前记忆焦点在深圳。",
    sourceType: "verified",
    confidence: 0.92,
    boundaryLabel: "memory_focus_chain",
    patternKey: "memory:focus_chain",
    payload: {
      field: "agent.focus_city",
      value: "深圳",
    },
    tags: ["memory", "focus", "verified"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "working",
    kind: "next_action",
    summary: "下一步应该安排下一轮校验",
    content: "下一步应该安排下一轮校验。",
    sourceType: "system",
    confidence: 0.87,
    boundaryLabel: "memory_focus_chain",
    patternKey: "memory:focus_chain",
    payload: {
      field: "next_action",
      value: "安排下一轮校验",
    },
    tags: ["memory", "next_action"],
  });
  await writePassportMemory(agent.agentId, {
    layer: "working",
    kind: "followup_action",
    summary: "动作：同步恢复窗口",
    content: "动作：同步恢复窗口，并完成通知。",
    sourceType: "system",
    confidence: 0.83,
    boundaryLabel: "memory_focus_chain",
    patternKey: "memory:focus_chain",
    payload: {
      field: "match.action_execution",
      value: {
        action: "同步恢复窗口",
        status: "planned",
      },
    },
    tags: ["memory", "coordination"],
  });

  const contextBuilder = await buildAgentContextBundle(agent.agentId, {
    currentGoal: "验证 multi-hop causal chain",
    recentConversationTurns: [{ role: "user", content: "请说明从深圳焦点到同步恢复窗口的推进链。" }],
    query: "当前记忆 深圳 下一轮校验 同步恢复窗口",
  });
  const verification = await verifyAgentResponse(agent.agentId, {
    responseText: "当前记忆焦点在深圳。因此下一步应该安排下一轮校验。所以动作：同步恢复窗口。",
    contextBuilder,
  });

  const issueCodes = verification.issues.map((item) => item.code);
  const causalChains = verification.references?.causalChains || [];
  assert.equal(issueCodes.includes("causal_chain_gap"), false, "多跳链路存在时不应命中 causal_chain_gap");
  assert.equal(issueCodes.includes("causal_chain_reality_gap"), false, "受本地事件图支撑的多跳链路不应命中 causal_chain_reality_gap");
  assert.equal(causalChains.length >= 1, true, "应产出至少 1 条 causal chain");
  assert.equal(causalChains[0]?.eventGraphPath?.multiHop, true, "应识别为 multi-hop path");

  return {
    valid: verification.valid,
    issueCodes,
    causalChains,
    eventGraph: verification.references?.eventGraph || null,
  };
}

async function main() {
  const sentenceBinding = await runSentenceBindingDemo();
  const ambiguousCompetition = await runAmbiguousCompetitionDemo();
  const rewrite = await runRewriteDemo();
  const workingMemoryGate = await runWorkingMemoryGateDemo();
  const realityMonitoring = await runRealityMonitoringDemo();
  const discourseNegationCounterfactual = await runDiscourseNegationCounterfactualDemo();
  const quantifierParagraphDiscourse = await runQuantifierParagraphDiscourseDemo();
  const clauseScope = await runClauseScopeDemo();
  const clauseFrame = await runClauseFrameDemo();
  const recommendationContinuation = await runRecommendationContinuationDemo();
  const confirmationLifecycle = await runConfirmationLifecycleDemo();
  const continuousCognitiveState = await runContinuousCognitiveStateDemo();
  const offlineReplay = await runOfflineReplayDemo();
  const causalBinding = await runCausalBindingDemo();
  const multiHopCausalChain = await runMultiHopCausalChainDemo();

  console.log(
    JSON.stringify(
      {
        ok: true,
        sentenceBinding,
        ambiguousCompetition,
        rewrite,
        workingMemoryGate,
        realityMonitoring,
        discourseNegationCounterfactual,
        quantifierParagraphDiscourse,
        clauseScope,
        clauseFrame,
        recommendationContinuation,
        confirmationLifecycle,
        continuousCognitiveState,
        offlineReplay,
        causalBinding,
        multiHopCausalChain,
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

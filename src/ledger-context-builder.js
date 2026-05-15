import {
  cloneJson,
  normalizeOptionalText,
  now,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  buildTranscriptModelSnapshot,
} from "./ledger-transcript-model.js";
import {
  listAgentTranscriptEntries,
} from "./ledger-transcript-records.js";
import {
  buildMemoryCorrectionPlan,
  buildMemoryHomeostasisPromptSummary,
  buildModelProfileView,
  buildRuntimeMemoryStateView,
  computeRuntimeMemoryHomeostasis,
  normalizeModelProfileRecord,
} from "./memory-homeostasis.js";
import {
  DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT,
  buildMemoryHomeostasisPromptAnchorEntries,
  resolveActiveMemoryHomeostasisModelName,
  resolveRuntimeMemoryHomeostasisProfile,
  summarizeMemoryHomeostasisText,
} from "./ledger-runtime-memory-homeostasis.js";
import {
  buildCurrentGoalMemoryHomeostasisAnchor,
  buildPassportMemoryHomeostasisAnchor,
  buildTaskSnapshotMemoryHomeostasisAnchors,
  mergeMemoryHomeostasisAnchors,
  normalizeMemoryHomeostasisCorrectionLevel,
  verifyMemoryHomeostasisAnchorsAgainstPrompt,
} from "./ledger-memory-homeostasis-anchors.js";
import {
  DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT,
  buildBudgetedPromptSections,
} from "./ledger-prompt-budget.js";
import {
  DEFAULT_RUNTIME_QUERY_ITERATION_LIMIT,
  DEFAULT_RUNTIME_RECENT_TURN_LIMIT,
  DEFAULT_RUNTIME_TOOL_RESULT_LIMIT,
  normalizeRuntimeDriftPolicy,
} from "./ledger-runtime-drift-policy.js";
import {
  buildContextBuilderHash,
} from "./ledger-context-builder-hash.js";
import {
  DEFAULT_DEVICE_RETRIEVAL_STRATEGY,
  DEFAULT_RUNTIME_SEARCH_LIMIT,
} from "./ledger-device-runtime.js";
import {
  splitRuntimeSearchHits,
  summarizePromptKnowledgeHit,
} from "./ledger-runtime-search.js";
import {
  buildContextContinuousCognitiveStateView,
  buildContextExternalColdMemoryView,
  buildContextLocalKnowledgeView,
  summarizePromptToolResult,
  summarizePromptTranscriptEntry,
} from "./ledger-context-prompt-views.js";
import {
  buildCognitiveLoopSnapshot,
  buildPerceptionSnapshot,
  buildSourceMonitoringSnapshot,
  summarizePromptMemoryEntry,
} from "./ledger-source-monitoring-views.js";
import {
  listAgentCognitiveStatesFromStore,
} from "./ledger-cognitive-state.js";
import {
  latestAgentTaskSnapshot,
} from "./ledger-runtime-record-lists.js";
import {
  listRuntimeMemoryStatesFromStore,
} from "./ledger-runtime-memory-store.js";
import {
  didMethodFromReference,
  resolveAgentDidForMethod,
} from "./ledger-credential-core.js";
import {
  normalizeDidMethod,
} from "./protocol.js";
import {
  resolveMemoryStabilityRuntimeContractModelProfile,
} from "./ledger-memory-stability-runtime.js";

const DEFAULT_TRANSCRIPT_MODEL_DEPS = Object.freeze({
  listAgentTranscriptEntries,
});

function requireContextBuilderDependency(deps, name) {
  const fn = deps?.[name];
  if (typeof fn !== "function") {
    throw new Error("Missing context builder dependency: " + name);
  }
  return fn;
}

function resolveContextBuilderDeps(deps = {}) {
  return {
    buildAgentMemoryLayerView: requireContextBuilderDependency(deps, "buildAgentMemoryLayerView"),
    buildCompactBoundaryResumeView: requireContextBuilderDependency(deps, "buildCompactBoundaryResumeView"),
    buildLightweightContextRuntimeSnapshot: requireContextBuilderDependency(
      deps,
      "buildLightweightContextRuntimeSnapshot"
    ),
    defaultLightweightTranscriptLimit: Math.max(
      1,
      Math.floor(toFiniteNumber(deps?.defaultLightweightTranscriptLimit, 8))
    ),
    runtimeMemoryStoreAdapter:
      deps?.runtimeMemoryStoreAdapter && typeof deps.runtimeMemoryStoreAdapter === "object"
        ? deps.runtimeMemoryStoreAdapter
        : {},
    searchAgentRuntimeKnowledgeFromStore: requireContextBuilderDependency(
      deps,
      "searchAgentRuntimeKnowledgeFromStore"
    ),
    transcriptModelDeps:
      deps?.transcriptModelDeps && typeof deps.transcriptModelDeps === "object"
        ? deps.transcriptModelDeps
        : DEFAULT_TRANSCRIPT_MODEL_DEPS,
  };
}

export function buildContextBuilderResult(
  store,
  agent,
  {
    didMethod = null,
    resumeFromCompactBoundaryId = null,
    currentGoal = null,
    recentConversationTurns = [],
    toolResults = [],
    query = null,
    memoryHomeostasisPolicy = null,
    runtimeSnapshot = null,
    memoryStabilityRuntime = null,
    runtimeModelProfileOverride = null,
  } = {},
  deps = {}
) {
  const {
    buildAgentMemoryLayerView,
    buildCompactBoundaryResumeView,
    buildLightweightContextRuntimeSnapshot,
    defaultLightweightTranscriptLimit,
    runtimeMemoryStoreAdapter,
    searchAgentRuntimeKnowledgeFromStore,
    transcriptModelDeps,
  } = resolveContextBuilderDeps(deps);
  const goal = normalizeOptionalText(currentGoal) ?? latestAgentTaskSnapshot(store, agent.agentId)?.objective ?? null;
  const latestCognitiveState = listAgentCognitiveStatesFromStore(store, agent.agentId).at(-1) ?? null;
  const latestIncomingTurn =
    Array.isArray(recentConversationTurns) && recentConversationTurns.length > 0
      ? normalizeOptionalText(recentConversationTurns.at(-1)?.content)
      : null;
  const knowledgeQuery = normalizeOptionalText(query) ?? goal ?? latestIncomingTurn ?? null;
  const layers = buildAgentMemoryLayerView(store, agent, { query: knowledgeQuery, currentGoal: goal, lightweight: true });
  const runtime =
    runtimeSnapshot && typeof runtimeSnapshot === "object"
      ? runtimeSnapshot
      : buildLightweightContextRuntimeSnapshot(store, agent, {
          didMethod,
          memoryStabilityRuntime,
        });
  const runtimeSnapshotModelProfile =
    runtime?.memoryHomeostasis?.modelProfile && typeof runtime.memoryHomeostasis.modelProfile === "object"
      ? normalizeModelProfileRecord(runtime.memoryHomeostasis.modelProfile)
      : null;
  const previousRuntimeMemoryState =
    listRuntimeMemoryStatesFromStore(store, agent.agentId, runtimeMemoryStoreAdapter).at(-1) ?? null;
  const memoryCorrectionLevel = normalizeMemoryHomeostasisCorrectionLevel(
    memoryHomeostasisPolicy?.correctionLevel
  );
  const memoryCompressHistory =
    Boolean(memoryHomeostasisPolicy?.compressHistory) || ["medium", "strong"].includes(memoryCorrectionLevel);
  const memoryAuthoritativeReload =
    Boolean(memoryHomeostasisPolicy?.authoritativeReload) || memoryCorrectionLevel === "strong";
  const memoryTailBias =
    Boolean(memoryHomeostasisPolicy?.reanchorToTail) || ["light", "medium", "strong"].includes(memoryCorrectionLevel);
  const runtimeModelName = resolveActiveMemoryHomeostasisModelName(store, {
    localReasoner: runtime.deviceRuntime?.localReasoner,
  });
  const contractRuntimeProfile = memoryStabilityRuntime?.ok === true ? memoryStabilityRuntime.profile : null;
  const contractRuntimeModelProfile = resolveMemoryStabilityRuntimeContractModelProfile(
    memoryStabilityRuntime,
    runtimeModelName
  );
  const runtimeModelProfile =
    runtimeModelProfileOverride && typeof runtimeModelProfileOverride === "object"
      ? normalizeModelProfileRecord(runtimeModelProfileOverride)
      : runtimeSnapshotModelProfile &&
          runtimeSnapshotModelProfile.modelName === runtimeModelName &&
          (runtimeSnapshotModelProfile.benchmarkMeta?.contractBacked === true || !contractRuntimeModelProfile)
        ? runtimeSnapshotModelProfile
        : resolveRuntimeMemoryHomeostasisProfile(store, {
            modelName: runtimeModelName,
            runtimePolicy: runtime.policy,
            contractProfile: contractRuntimeModelProfile,
          });
  const runtimeKnowledge = searchAgentRuntimeKnowledgeFromStore(store, agent, {
    didMethod,
    query: knowledgeQuery,
    limit: runtime.deviceRuntime?.retrievalPolicy?.maxHits ?? DEFAULT_RUNTIME_SEARCH_LIMIT,
    includeExternalColdMemory: true,
    recentOnly: true,
  });
  const resolvedDid = resolveAgentDidForMethod(store, agent, didMethod) || agent.identity?.did || null;
  const { localHits: localKnowledgeHits, externalColdMemoryHits } = splitRuntimeSearchHits(
    runtimeKnowledge.hits
  );
  const localKnowledge = buildContextLocalKnowledgeView(
    runtimeKnowledge,
    localKnowledgeHits,
    externalColdMemoryHits
  );
  const externalColdMemory = buildContextExternalColdMemoryView(runtimeKnowledge, externalColdMemoryHits);
  const transcriptModel = buildTranscriptModelSnapshot(store, agent, {
    limit: Math.max(
      defaultLightweightTranscriptLimit,
      Math.floor((runtime.policy?.maxRecentConversationTurns ?? DEFAULT_RUNTIME_RECENT_TURN_LIMIT) * 2)
    ),
  }, transcriptModelDeps);
  const resumeBoundary = buildCompactBoundaryResumeView(store, agent, resumeFromCompactBoundaryId);
  if (resumeFromCompactBoundaryId && !resumeBoundary) {
    throw new Error(`Compact boundary not found: ${resumeFromCompactBoundaryId}`);
  }
  const ledgerFacts = [
    `agent_id=${agent.agentId}`,
    `did=${resolvedDid || "unknown"}`,
    `wallet=${agent.identity?.walletAddress || "none"}`,
    `parent=${agent.parentAgentId || "none"}`,
    `controller=${agent.controller || "unknown"}`,
  ];
  const systemRules = [
    "LLM 只是推理器，不是本地参考源。",
    "本地参考层 才是本地参考源，回答前优先以 ledger/profile/runtime 为准。",
    "如果响应与 ledger/profile 探测冲突，宁可保守，也不要自由脑补。",
    "高风险动作前必须引用 decision/evidence 或返回需要 rehydrate / human review。",
    `本轮默认先走本地检索，当前策略是 ${runtime.deviceRuntime?.retrievalPolicy?.strategy || DEFAULT_DEVICE_RETRIEVAL_STRATEGY}。`,
    runtime.deviceRuntime?.retrievalPolicy?.allowVectorIndex === false
      ? "默认不依赖 vector index，先用结构化字段、minutes、decision、evidence 和 lexical scorer 恢复。"
      : "可选向量索引已启用，但仍然优先本地结构化检索。",
    runtimeKnowledge.retrieval?.externalColdMemoryEnabled
      ? `已启用外部冷记忆侧车 ${
          runtimeKnowledge.retrieval?.externalColdMemoryProvider || "mempalace"
        }，只读检索，不写回主记忆。`
      : null,
    externalColdMemoryHits.length > 0
      ? "外部冷记忆命中只能作为候选线索，不能覆盖 ledger/profile/runtime 本地参考层。"
      : null,
    runtime.deviceRuntime?.residentAgentId
      ? `当前设备唯一 resident agent 是 ${runtime.deviceRuntime.residentAgentId}。`
      : "当前设备还没有 resident agent，先完成宿主绑定。",
    runtime.deviceRuntime?.localMode === "local_only"
      ? "当前设备默认离线思考，不要假设网络调用总是可用。"
      : "当前设备允许联网增强，但身份和关键事实仍然由 本地参考层 约束。",
    resumeBoundary ? "如果存在 compact boundary，应把 boundary summary 当作已压缩历史，而不是重新猜测更早对话。" : null,
  ].filter(Boolean);
  const maxRecentConversationTurns = Math.max(
    1,
    Math.floor(toFiniteNumber(runtime.policy?.maxRecentConversationTurns, DEFAULT_RUNTIME_RECENT_TURN_LIMIT))
  );
  const maxToolResults = Math.max(
    1,
    Math.floor(toFiniteNumber(runtime.policy?.maxToolResults, DEFAULT_RUNTIME_TOOL_RESULT_LIMIT))
  );
  const maxContextTokens = Math.max(
    256,
    Math.floor(toFiniteNumber(runtime.policy?.maxContextTokens, DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT))
  );
  const incomingRecentTurns = Array.isArray(recentConversationTurns) && recentConversationTurns.length > 0
    ? recentConversationTurns
    : layers.working.recentConversationTurns.map((entry) => ({
        role: entry.payload?.role || "unknown",
        content: entry.content || entry.summary || "",
      }));
  const incomingToolResults = Array.isArray(toolResults) && toolResults.length > 0
    ? toolResults
    : layers.working.toolResults.map((entry) => ({
        tool: entry.payload?.tool || entry.summary || entry.kind,
        result: entry.content || entry.summary || "",
      }));
  const selectedRecentTurns = incomingRecentTurns.slice(-maxRecentConversationTurns);
  const selectedToolResults = incomingToolResults.slice(-maxToolResults);
  const promptMemoryLimit =
    memoryCorrectionLevel === "strong"
      ? 3
      : memoryCompressHistory || memoryHomeostasisPolicy?.placementStrategy?.lowerMemoryDensity
        ? 3
        : 4;
  const promptKnowledgeLimit = memoryCompressHistory ? 2 : 4;
  const promptTranscriptLimit = memoryCorrectionLevel === "strong" ? 2 : memoryCompressHistory ? 4 : 6;
  const promptMinuteLimit = memoryCompressHistory ? 2 : 3;
  const promptProfileMemories = layers.relevant.profile
    .slice(0, promptMemoryLimit)
    .map((entry) => summarizePromptMemoryEntry(entry));
  const promptEpisodicMemories = layers.relevant.episodic
    .slice(0, promptMemoryLimit)
    .map((entry) => summarizePromptMemoryEntry(entry));
  const promptSemanticMemories = layers.relevant.semantic
    .slice(0, promptMemoryLimit)
    .map((entry) => summarizePromptMemoryEntry(entry));
  const promptKnowledgeHits = localKnowledge.hits
    .slice(0, promptKnowledgeLimit)
    .map((entry) => summarizePromptKnowledgeHit(entry));
  const promptExternalColdMemoryHits = externalColdMemory.hits
    .slice(0, promptKnowledgeLimit)
    .map((entry) => summarizePromptKnowledgeHit(entry));
  const promptTranscriptEntries = transcriptModel.entries
    .slice(-promptTranscriptLimit)
    .map((entry) => summarizePromptTranscriptEntry(entry));
  const promptRecentTurns = selectedRecentTurns.slice(-4);
  const promptToolResults = selectedToolResults.slice(-4).map((entry) => summarizePromptToolResult(entry));
  const promptConversationMinutes = runtime.conversationMinutes
    .slice(-promptMinuteLimit)
    .map((entry) => summarizePromptMemoryEntry(entry));
  const promptCheckpointEntries = layers.working.checkpoints
    .slice(-3)
    .map((entry) => summarizePromptMemoryEntry(entry));
  const promptWorkingMemories = layers.relevant.working
    .slice(0, 4)
    .map((entry) => summarizePromptMemoryEntry(entry));
  const promptLedgerCommitments = layers.relevant.ledgerCommitments
    .slice(0, 4)
    .map((entry) => summarizePromptMemoryEntry(entry));
  const promptTranscriptModel = {
    entryCount: transcriptModel.entryCount ?? transcriptModel.entries?.length ?? 0,
    latestTranscriptEntryId:
      transcriptModel.latestTranscriptEntryId ?? transcriptModel.entries?.at?.(-1)?.transcriptEntryId ?? null,
    entries: promptTranscriptEntries,
  };
  const contextTaskSnapshot = runtime.taskSnapshot
    ? {
        snapshotId: runtime.taskSnapshot.snapshotId ?? null,
        title: normalizeOptionalText(runtime.taskSnapshot.title) ?? null,
        objective: normalizeOptionalText(runtime.taskSnapshot.objective) ?? null,
        status: normalizeOptionalText(runtime.taskSnapshot.status) ?? null,
        nextAction: normalizeOptionalText(runtime.taskSnapshot.nextAction) ?? null,
        checkpointSummary: normalizeOptionalText(runtime.taskSnapshot.checkpointSummary) ?? null,
        driftPolicy:
          runtime.taskSnapshot.driftPolicy && typeof runtime.taskSnapshot.driftPolicy === "object"
            ? normalizeRuntimeDriftPolicy(runtime.taskSnapshot.driftPolicy)
            : null,
      }
    : null;
  const perceptionSnapshot = buildPerceptionSnapshot({
    query: knowledgeQuery,
    recentConversationTurns: promptRecentTurns,
    toolResults: selectedToolResults,
    knowledgeHits: localKnowledge.hits,
    conversationMinutes: runtime.conversationMinutes,
  });
  const promptExternalColdMemory =
    externalColdMemory.enabled || promptExternalColdMemoryHits.length > 0 || externalColdMemory.error
      ? {
          provider: externalColdMemory.provider,
          used: externalColdMemory.used,
          candidateOnly: true,
          hitCount: externalColdMemory.hitCount,
          error: externalColdMemory.error,
          hint: externalColdMemory.hint,
          hits: promptExternalColdMemoryHits,
        }
      : null;
  const memoryAnchorCandidates = mergeMemoryHomeostasisAnchors(
    [
      buildCurrentGoalMemoryHomeostasisAnchor(goal, memoryCorrectionLevel),
      ...buildTaskSnapshotMemoryHomeostasisAnchors(
        layers.working.taskSnapshot || runtime.taskSnapshot,
        memoryCorrectionLevel
      ),
      ...layers.working.checkpoints
        .slice(-1)
        .map((entry) =>
          buildPassportMemoryHomeostasisAnchor(entry, {
            source: "working_checkpoint",
            defaultPosition: "tail",
            tailBias: true,
            importanceWeight: 1.35,
          })
        )
        .filter(Boolean),
      ...layers.relevant.working
        .slice(0, 2)
        .map((entry) =>
          buildPassportMemoryHomeostasisAnchor(entry, {
            source: "working_memory",
            defaultPosition: "tail",
            tailBias: true,
            importanceWeight: 1.18,
          })
        )
        .filter(Boolean),
      ...layers.relevant.profile
        .slice(0, 2)
        .map((entry) =>
          buildPassportMemoryHomeostasisAnchor(entry, {
            source: "profile_memory",
            defaultPosition: "middle",
            tailBias: memoryTailBias,
            importanceWeight: 1.26,
          })
        )
        .filter(Boolean),
      ...layers.relevant.semantic
        .slice(0, 2)
        .map((entry) =>
          buildPassportMemoryHomeostasisAnchor(entry, {
            source: "semantic_memory",
            defaultPosition: "middle",
            tailBias: memoryTailBias,
            importanceWeight: 1.16,
          })
        )
        .filter(Boolean),
      ...layers.relevant.episodic
        .slice(0, 1)
        .map((entry) =>
          buildPassportMemoryHomeostasisAnchor(entry, {
            source: "episodic_memory",
            defaultPosition: "middle",
            tailBias: memoryTailBias && memoryCorrectionLevel !== "none",
            importanceWeight: 0.94,
          })
        )
        .filter(Boolean),
    ],
    previousRuntimeMemoryState
  );
  const promptMemoryAnchors = buildMemoryHomeostasisPromptAnchorEntries(
    memoryAnchorCandidates,
    memoryHomeostasisPolicy?.placementStrategy?.maxTailAnchors ?? 6
  );
  const authoritativeReloadSnapshot = memoryAuthoritativeReload
    ? {
        taskSnapshot: layers.working.taskSnapshot
          ? {
              snapshotId: layers.working.taskSnapshot.snapshotId ?? null,
              objective: summarizeMemoryHomeostasisText(
                layers.working.taskSnapshot.objective || layers.working.taskSnapshot.title,
                180
              ),
              nextAction: summarizeMemoryHomeostasisText(layers.working.taskSnapshot.nextAction, 160),
            }
          : null,
        checkpoints: layers.working.checkpoints
          .slice(-2)
          .map((entry) => summarizePromptMemoryEntry(entry)),
        profileAnchors: promptProfileMemories.slice(0, 2),
        semanticAnchors: promptSemanticMemories.slice(0, 2),
        ledgerFacts,
      }
    : null;
  const maxSectionChars = Math.max(
    400,
    Math.floor(toFiniteNumber(runtime.policy?.maxContextChars, DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT) / 8)
  );
  const maxSectionTokens = Math.max(48, Math.floor(maxContextTokens / 8));

  const slots = {
    systemRules,
    currentGoal: goal,
    identitySnapshot: {
      agentId: agent.agentId,
      displayName: agent.displayName,
      role: agent.role,
      did: resolvedDid,
      profile: layers.profile.fieldValues,
      semantic: layers.semantic.fieldValues,
      taskSnapshot: contextTaskSnapshot,
      residentGate: runtime.residentGate,
      deviceRuntime: runtime.deviceRuntime,
    },
    perceptionSnapshot,
    relevantLedgerFacts: {
      facts: ledgerFacts,
      commitments: promptLedgerCommitments,
    },
    resumeBoundary,
    workingMemoryState: {
      taskSnapshot: layers.working.taskSnapshot
        ? {
            snapshotId: layers.working.taskSnapshot.snapshotId ?? null,
            title: normalizeOptionalText(layers.working.taskSnapshot.title) ?? null,
            objective: normalizeOptionalText(layers.working.taskSnapshot.objective) ?? null,
            status: normalizeOptionalText(layers.working.taskSnapshot.status) ?? null,
            nextAction: normalizeOptionalText(layers.working.taskSnapshot.nextAction) ?? null,
            checkpointSummary: normalizeOptionalText(layers.working.taskSnapshot.checkpointSummary) ?? null,
          }
        : null,
      checkpoints: promptCheckpointEntries,
      recentConversationTurns: promptRecentTurns,
      recentToolResults: promptToolResults,
      gatedWorkingMemories: promptWorkingMemories,
    },
    workingMemoryGate: {
      selectedCount: layers.working.gate?.selectedCount ?? 0,
      blockedCount: layers.working.gate?.blockedCount ?? 0,
      averageGateScore: layers.working.gate?.averageGateScore ?? null,
      selected: promptWorkingMemories,
      blocked: (layers.working.blockedEntries || []).slice(0, 4).map((entry) => summarizePromptMemoryEntry(entry)),
    },
    eventGraph: {
      counts: cloneJson(layers.eventGraph?.counts) ?? null,
      nodes: (layers.eventGraph?.nodes || []).slice(0, 12),
      edges: (layers.eventGraph?.edges || []).slice(0, 18).map((edge) => ({
        from: edge.from,
        to: edge.to,
        relation: edge.relation,
        averageWeight: edge.averageWeight,
        supportSummary: edge.supportSummary,
      })),
    },
    relevantProfileMemories: promptProfileMemories,
    relevantEpisodicMemories: promptEpisodicMemories,
    relevantSemanticMemories: promptSemanticMemories,
    sourceMonitoring: buildSourceMonitoringSnapshot({
      profile: layers.relevant.profile,
      episodic: layers.relevant.episodic,
      semantic: layers.relevant.semantic,
      working: layers.relevant.working,
    }),
    recentConversationMinutes: promptConversationMinutes,
    localKnowledgeHits: promptKnowledgeHits,
    externalColdMemory: promptExternalColdMemory,
    transcriptModel: promptTranscriptModel,
    recentConversationTurns: selectedRecentTurns,
    toolResults: selectedToolResults,
    queryBudget: {
      maxRecentConversationTurns,
      maxToolResults,
      maxContextTokens,
      maxQueryIterations: runtime.policy?.maxQueryIterations ?? DEFAULT_RUNTIME_QUERY_ITERATION_LIMIT,
      inputRecentConversationTurnCount: incomingRecentTurns.length,
      usedRecentConversationTurnCount: selectedRecentTurns.length,
      recentConversationTurnsTruncated: incomingRecentTurns.length > selectedRecentTurns.length,
      inputToolResultCount: incomingToolResults.length,
      usedToolResultCount: selectedToolResults.length,
      toolResultsTruncated: incomingToolResults.length > selectedToolResults.length,
    },
    memoryHomeostasis: {
      modelName: runtimeModelName,
      modelProfile: buildModelProfileView(runtimeModelProfile),
      correctionLevel: memoryCorrectionLevel,
      compressHistory: memoryCompressHistory,
      authoritativeReload: memoryAuthoritativeReload,
      anchors: promptMemoryAnchors,
      authoritativeReloadSnapshot,
    },
    continuousCognitiveState: buildContextContinuousCognitiveStateView(latestCognitiveState),
  };
  slots.cognitiveLoop = buildCognitiveLoopSnapshot({
    currentGoal: goal,
    identitySnapshot: slots.identitySnapshot,
    working: slots.workingMemoryState,
    episodic: promptEpisodicMemories,
    semantic: promptSemanticMemories,
    ledgerFacts: slots.relevantLedgerFacts,
    perception: slots.perceptionSnapshot,
  });

  const promptSectionBlueprints = [
    {
      title: "SYSTEM RULES",
      value: systemRules.map((item) => `- ${item}`).join("\n"),
      priority: "high",
      minTokens: 96,
      minChars: 480,
    },
    {
      title: "COGNITIVE LOOP",
      value: slots.cognitiveLoop,
      priority: "medium",
    },
    {
      title: "CONTINUOUS COGNITIVE STATE",
      value: slots.continuousCognitiveState,
      priority: "low",
    },
    {
      title: "CURRENT GOAL",
      value: goal || "(none)",
      priority: "high",
      minTokens: 64,
      minChars: 220,
    },
    {
      title: "PERCEPTION SNAPSHOT",
      value: slots.perceptionSnapshot,
      priority: "high",
    },
    {
      title: "WORKING MEMORY STATE",
      value: slots.workingMemoryState,
      priority: "high",
      minTokens: 88,
    },
    {
      title: "WORKING MEMORY GATE",
      value: slots.workingMemoryGate,
      priority: "medium",
    },
    {
      title: "EVENT GRAPH",
      value: slots.eventGraph,
      priority: "low",
    },
    {
      title: "LEDGER FACTS",
      value: slots.relevantLedgerFacts,
      priority: "high",
      minTokens: 72,
    },
    {
      title: "RELEVANT PROFILE MEMORIES",
      value: promptProfileMemories,
      priority: "low",
    },
    {
      title: "RELEVANT EPISODIC MEMORIES",
      value: promptEpisodicMemories,
      priority: "low",
    },
    {
      title: "RELEVANT SEMANTIC MEMORIES",
      value: promptSemanticMemories,
      priority: "low",
    },
    {
      title: "SOURCE MONITORING",
      value: slots.sourceMonitoring,
      priority: "high",
      minTokens: 72,
    },
    {
      title: "IDENTITY LAYER",
      value: slots.identitySnapshot,
      priority: "high",
      minTokens: 88,
    },
    {
      title: "CONVERSATION MINUTES",
      value: promptConversationMinutes,
      priority: "medium",
    },
    {
      title: "LOCAL KNOWLEDGE HITS",
      value: promptKnowledgeHits,
      priority: "high",
      minTokens: 72,
    },
    ...(promptExternalColdMemory
      ? [
          {
            title: "EXTERNAL COLD MEMORY CANDIDATES",
            value: promptExternalColdMemory,
            priority: "medium",
            minTokens: 56,
          },
        ]
      : []),
    {
      title: "RESUME BOUNDARY",
      value: slots.resumeBoundary,
      priority: "high",
      minTokens: 56,
    },
    {
      title: "TRANSCRIPT MODEL",
      value: promptTranscriptEntries,
      priority: "low",
    },
    {
      title: "QUERY BUDGET",
      value: slots.queryBudget,
      priority: "medium",
    },
    {
      title: "MEMORY STABILITY",
      value: slots.memoryHomeostasis,
      priority: memoryCorrectionLevel === "none" ? "medium" : "high",
      minTokens: memoryCorrectionLevel === "none" ? 56 : 88,
    },
    ...(authoritativeReloadSnapshot
      ? [
          {
            title: "AUTHORITATIVE MEMORY RELOAD",
            value: authoritativeReloadSnapshot,
            priority: "high",
            minTokens: 72,
          },
        ]
      : []),
    {
      title: "RECENT CONVERSATION TURNS",
      value: promptRecentTurns,
      priority: "high",
      minTokens: 64,
    },
    {
      title: "TOOL RESULTS",
      value: promptToolResults,
      priority: "medium",
    },
  ];
  const budgetedPrompt = buildBudgetedPromptSections(promptSectionBlueprints, {
    maxContextTokens,
    maxContextChars: runtime.policy?.maxContextChars ?? DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT,
    maxSectionTokens,
    maxSectionChars,
  });
  const promptSections = budgetedPrompt.sections;
  const compiledPrompt = budgetedPrompt.compiledPrompt;
  slots.queryBudget.sectionTokenBudget = maxSectionTokens;
  slots.queryBudget.sectionEstimates = promptSections.map((section) => ({
    title: section.title,
    estimatedTokens: section.estimatedTokens,
  }));
  slots.queryBudget.omittedSections = budgetedPrompt.omittedTitles;
  slots.queryBudget.estimatedContextTokens = budgetedPrompt.estimatedContextTokens;
  const verifiedMemoryAnchors = verifyMemoryHomeostasisAnchorsAgainstPrompt(
    memoryAnchorCandidates,
    compiledPrompt,
    now()
  );
  const runtimeMemoryState = computeRuntimeMemoryHomeostasis({
    sessionId: previousRuntimeMemoryState?.sessionId ?? null,
    agentId: agent.agentId,
    modelName: runtimeModelName,
    ctxTokens: budgetedPrompt.estimatedContextTokens,
    memoryAnchors: verifiedMemoryAnchors,
    modelProfile: runtimeModelProfile,
    contractRuntimeProfile,
    previousState: previousRuntimeMemoryState,
    triggerReason:
      memoryCorrectionLevel === "none"
        ? "context_builder_passive_probe"
        : `context_builder_${memoryCorrectionLevel}_correction`,
  });
  const memoryCorrectionPlan = buildMemoryCorrectionPlan({
    runtimeState: runtimeMemoryState,
    modelProfile: runtimeModelProfile,
  });
  slots.memoryHomeostasis = {
    ...slots.memoryHomeostasis,
    anchors: buildMemoryHomeostasisPromptAnchorEntries(
      verifiedMemoryAnchors,
      memoryHomeostasisPolicy?.placementStrategy?.maxTailAnchors ?? 6
    ),
    summary: buildMemoryHomeostasisPromptSummary(runtimeMemoryState),
    runtimeState: buildRuntimeMemoryStateView(runtimeMemoryState),
    correctionPlan: memoryCorrectionPlan,
  };

  return {
    builtAt: now(),
    agentId: agent.agentId,
    didMethod: normalizeDidMethod(didMethod) || didMethodFromReference(resolvedDid) || null,
    slots,
    memoryLayers: layers,
    localKnowledge,
    externalColdMemory,
    memoryHomeostasis: {
      modelName: runtimeModelName,
      modelProfile: buildModelProfileView(runtimeModelProfile),
      runtimeState: buildRuntimeMemoryStateView(runtimeMemoryState),
      correctionPlan: memoryCorrectionPlan,
      correctionApplied: memoryCorrectionLevel !== "none",
      anchors: buildMemoryHomeostasisPromptAnchorEntries(
        verifiedMemoryAnchors,
        memoryHomeostasisPolicy?.placementStrategy?.maxTailAnchors ?? 6
      ),
    },
    runtimePolicy: runtime.policy,
    compiledPrompt,
    contextHash: buildContextBuilderHash({
      agentId: agent.agentId,
      didMethod: normalizeDidMethod(didMethod) || didMethodFromReference(resolvedDid) || null,
      resolvedDid,
      currentGoal: goal,
      resumeBoundaryId: slots.resumeBoundary?.compactBoundaryId ?? null,
      taskSnapshot: contextTaskSnapshot,
      perceptionQuery: perceptionSnapshot?.query ?? null,
      profileMemories: promptProfileMemories,
      episodicMemories: promptEpisodicMemories,
      semanticMemories: promptSemanticMemories,
      workingMemories: promptWorkingMemories,
      checkpoints: promptCheckpointEntries,
      ledgerCommitments: promptLedgerCommitments,
      localKnowledgeHits: promptKnowledgeHits,
      externalColdMemoryHits: promptExternalColdMemoryHits,
      conversationMinutes: promptConversationMinutes,
      transcriptEntries: promptTranscriptEntries,
      recentConversationTurns: promptRecentTurns,
      toolResults: promptToolResults,
      memoryCorrectionLevel,
      memoryAnchors: slots.memoryHomeostasis?.anchors || [],
      continuousCognitiveState: slots.continuousCognitiveState,
    }),
  };
}

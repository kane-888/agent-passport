import {
  hashJson,
  normalizeOptionalText,
} from "./ledger-core-utils.js";
import {
  compareTextSimilarity,
} from "./ledger-text-similarity.js";
import {
  buildAgentScopedDerivedCacheKey,
  buildCollectionTailToken,
  cacheStoreDerivedView,
} from "./ledger-derived-cache.js";
import {
  buildProfileMemorySnapshot,
} from "./ledger-profile-memory-snapshot.js";
import {
  buildEpisodicMemorySnapshot,
  buildLedgerMemorySnapshot,
  buildSemanticMemorySnapshot,
  buildWorkingMemorySnapshot,
} from "./ledger-agent-memory-snapshots.js";
import {
  selectGatedWorkingMemories,
} from "./ledger-working-memory-gate.js";

const DEFAULT_MEMORY_PATTERN_COMPLETION_EXTRA = 2;

function requireDependency(deps = {}, name) {
  const dependency = deps?.[name];
  if (typeof dependency !== "function") {
    throw new TypeError(`${name} dependency is required`);
  }
  return dependency;
}

export function buildAgentMemoryLayerView(
  store,
  agent,
  { query = null, currentGoal = null, lightweight = false } = {},
  deps = {}
) {
  const defaultMemoryPatternCompletionExtra =
    deps.defaultMemoryPatternCompletionExtra ?? DEFAULT_MEMORY_PATTERN_COMPLETION_EXTRA;
  const buildPassportEventGraphSnapshot = requireDependency(deps, "buildPassportEventGraphSnapshot");
  const buildPassportMemoryRetrievalCandidates = requireDependency(deps, "buildPassportMemoryRetrievalCandidates");
  const buildPassportMemorySearchText = requireDependency(deps, "buildPassportMemorySearchText");
  const completePassportMemoryPatterns = requireDependency(deps, "completePassportMemoryPatterns");
  const computePassportMemoryAgeDays = requireDependency(deps, "computePassportMemoryAgeDays");
  const extractPassportEventGraphValue = requireDependency(deps, "extractPassportEventGraphValue");
  const getPassportMemorySeparationKey = requireDependency(deps, "getPassportMemorySeparationKey");
  const inferDidAliases = requireDependency(deps, "inferDidAliases");
  const latestAgentTaskSnapshot = requireDependency(deps, "latestAgentTaskSnapshot");
  const listAgentCognitiveStatesFromStore = requireDependency(deps, "listAgentCognitiveStatesFromStore");
  const listAgentPassportMemories = requireDependency(deps, "listAgentPassportMemories");
  const listAgentWindows = requireDependency(deps, "listAgentWindows");
  const listAuthorizationProposalViews = requireDependency(deps, "listAuthorizationProposalViews");
  const mergeUniquePassportMemories = requireDependency(deps, "mergeUniquePassportMemories");
  const selectPatternSeparatedPassportMemories = requireDependency(deps, "selectPatternSeparatedPassportMemories");
  const queryText = normalizeOptionalText(query) ?? null;
  const goalText = normalizeOptionalText(currentGoal) ?? latestAgentTaskSnapshot(store, agent.agentId)?.objective ?? null;
  const cacheKey = buildAgentScopedDerivedCacheKey(
    "agent_memory_layer_view",
    store,
    agent.agentId,
    hashJson({
      queryText,
      goalText,
      lightweight: Boolean(lightweight),
      passportMemories: buildCollectionTailToken(store?.passportMemories || [], {
        idFields: ["passportMemoryId"],
        timeFields: ["recordedAt"],
      }),
      taskSnapshots: buildCollectionTailToken(store?.taskSnapshots || [], {
        idFields: ["snapshotId"],
        timeFields: ["updatedAt", "createdAt"],
      }),
      cognitiveStates: buildCollectionTailToken(store?.cognitiveStates || [], {
        idFields: ["cognitiveStateId"],
        timeFields: ["updatedAt", "createdAt"],
      }),
    })
  );
  return cacheStoreDerivedView(store, cacheKey, () => {
    const memorySnapshotDeps = {
      inferDidAliases,
      latestAgentTaskSnapshot,
      listAgentPassportMemories,
      listAgentWindows,
      listAuthorizationProposalViews,
    };
    const profile = buildProfileMemorySnapshot(store, agent, { listAgentPassportMemories });
    const episodic = buildEpisodicMemorySnapshot(store, agent, memorySnapshotDeps);
    const semantic = buildSemanticMemorySnapshot(store, agent, memorySnapshotDeps);
    const working = buildWorkingMemorySnapshot(store, agent, memorySnapshotDeps);
    const ledger = buildLedgerMemorySnapshot(store, agent, memorySnapshotDeps);
    const latestCognitiveState = listAgentCognitiveStatesFromStore(store, agent.agentId).at(-1) ?? null;

    const relevantProfile = buildPassportMemoryRetrievalCandidates(
      profile.entries,
      queryText,
      lightweight ? 3 : 5,
      { currentGoal: goalText, cognitiveState: latestCognitiveState }
    ).slice(0, lightweight ? 3 : 5);

    const episodicCandidates = buildPassportMemoryRetrievalCandidates(episodic.entries, queryText, lightweight ? 6 : 10, {
      currentGoal: goalText,
      cognitiveState: latestCognitiveState,
    });
    const episodicBase = selectPatternSeparatedPassportMemories(episodicCandidates, lightweight ? 3 : 4);
    const episodicCompletion = completePassportMemoryPatterns(episodic.entries, episodicBase, {
      maxExtra: lightweight ? 1 : defaultMemoryPatternCompletionExtra,
    });
    const relevantEpisodic = mergeUniquePassportMemories([...episodicBase, ...episodicCompletion], lightweight ? 4 : 6);

    const semanticCandidates = buildPassportMemoryRetrievalCandidates(semantic.entries, queryText, lightweight ? 6 : 10, {
      currentGoal: goalText,
      cognitiveState: latestCognitiveState,
    });
    const semanticBase = selectPatternSeparatedPassportMemories(semanticCandidates, lightweight ? 3 : 4);
    const semanticCompletion = completePassportMemoryPatterns(
      [...semantic.entries, ...episodic.entries],
      [...semanticBase, ...episodicBase],
      {
        maxExtra: lightweight ? 1 : defaultMemoryPatternCompletionExtra,
      }
    );
    const semanticEventGraphSeeds = [...semantic.entries]
      .filter((entry) => {
        const field = normalizeOptionalText(entry?.payload?.field) ?? null;
        return field === "match.event_graph" || Boolean(extractPassportEventGraphValue(entry));
      })
      .sort((left, right) => (right.recordedAt || "").localeCompare(left.recordedAt || ""))
      .slice(0, lightweight ? 2 : 3);
    const relevantSemantic = mergeUniquePassportMemories(
      [...semanticBase, ...semanticCompletion, ...semanticEventGraphSeeds],
      lightweight ? 5 : 8
    );
    const workingGate = selectGatedWorkingMemories(
      working.entries,
      {
        queryText,
        currentGoal: goalText,
        limit: lightweight ? 4 : undefined,
      },
      {
        buildPassportMemorySearchText,
        compareTextSimilarity,
        computePassportMemoryAgeDays,
        getPassportMemorySeparationKey,
      }
    );
    const eventGraph = buildPassportEventGraphSnapshot({
      relevant: {
        episodic: relevantEpisodic,
        semantic: relevantSemantic,
        working: workingGate.selectedEntries,
      },
      episodic,
      semantic,
      working: {
        ...working,
        gatedEntries: workingGate.selectedEntries,
        checkpoints: working.checkpoints,
      },
    }, { lightweight });

    return {
      performanceMode: lightweight ? "lightweight" : "full",
      ledger,
      profile,
      episodic,
      semantic,
      working: {
        ...working,
        gatedEntries: workingGate.selectedEntries,
        blockedEntries: workingGate.blockedEntries,
        gate: workingGate,
      },
      eventGraph,
      relevant: {
        profile: relevantProfile,
        episodic: relevantEpisodic,
        semantic: relevantSemantic,
        working: workingGate.selectedEntries,
        ledgerCommitments: ledger.commitments.slice(-(lightweight ? 4 : 6)),
      },
      counts: {
        ledgerCommitments: ledger.commitments.length,
        profile: profile.entries.length,
        episodic: episodic.entries.length,
        semantic: semantic.entries.length,
        working: working.entries.length,
        workingGated: workingGate.selectedCount,
        eventGraphNodes: eventGraph.counts?.nodes ?? 0,
        eventGraphEdges: eventGraph.counts?.edges ?? 0,
      },
      coldCounts: {
        ledgerCommitments: ledger.coldSummary?.coldCount ?? 0,
        profile: profile.coldSummary?.coldCount ?? 0,
        episodic: episodic.coldSummary?.coldCount ?? 0,
        semantic: semantic.coldSummary?.coldCount ?? 0,
        working: working.coldSummary?.coldCount ?? 0,
      },
    };
  });
}

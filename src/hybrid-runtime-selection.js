// 属性：桥接。
// 这里只负责把历史 hybrid runtime 选择字段归一成当前 canonical 真值，
// 让 ledger core 不再直接依赖带 OpenNeed 命名的 compat 文件。

export function canonicalizeHybridRuntimeReasonerSelectionFlags(hybridRuntime = null) {
  const runtime = hybridRuntime && typeof hybridRuntime === "object" ? hybridRuntime : {};
  const localReasonerPreferred = Boolean(
    runtime.localReasonerPreferred ??
      runtime.memoryStabilityLocalReasonerPreferred ??
      runtime.agentPassportLocalReasonerPreferred ??
      runtime.openneedPreferred ??
      runtime.gemmaPreferred
  );
  const latestRunUsedLocalReasoner = Boolean(
    runtime.latestRunUsedLocalReasoner ??
      runtime.latestRunUsedMemoryStabilityReasoner ??
      runtime.latestRunUsedAgentPassportLocalReasoner ??
      runtime.latestRunUsedOpenNeed ??
      runtime.latestRunUsedGemma
  );
  return {
    memoryStabilityLocalReasonerPreferred: localReasonerPreferred,
    localReasonerPreferred,
    latestRunUsedMemoryStabilityReasoner: latestRunUsedLocalReasoner,
    latestRunUsedLocalReasoner,
  };
}

import { buildProtocolDescriptor } from "./protocol.js";

export function buildExecutionCapabilityBoundarySummary({
  verification = null,
  recoveryAction = null,
  executionKind = "runtime",
} = {}) {
  const protocolBoundary = buildProtocolDescriptor({
    chainId: null,
    apiBase: "/api",
  }).capabilityBoundary;
  const verificationStatus =
    verification == null
      ? protocolBoundary.verification.status
      : verification.valid === false
        ? "needs_review"
        : protocolBoundary.verification.status;
  const recoveryStatus = recoveryAction?.capabilityBoundary?.status
    ? recoveryAction.capabilityBoundary.status
    : protocolBoundary.recovery.status;
  const executionMode =
    executionKind === "verification"
      ? "local_verification"
      : executionKind === "rehydrate"
        ? "rehydrate_boundary_pack"
        : recoveryAction?.action
          ? "runtime_with_bounded_auto_recovery"
          : "runtime_execution";

  return {
    executionKind,
    executionMode,
    status:
      executionKind === "verification"
        ? verificationStatus
        : executionKind === "rehydrate"
          ? recoveryStatus
          : recoveryAction?.action
            ? recoveryStatus
            : "bounded_execution",
    summary:
      executionKind === "verification"
        ? verification?.valid === false
          ? "本次结果属于本地校验与风险提示，不代表自动处置或最终裁决。"
          : "本次结果属于本地校验结论，可用于完整性检查，但不代表外部第三方认证。"
        : executionKind === "rehydrate"
          ? "本次结果属于恢复包与恢复建议，可用于继续上下文；系统能力支持在本地门禁通过时的有限次自动恢复/续跑，但本响应本身不是自动执行结果。"
          : recoveryAction?.action
            ? "本次结果属于本地运行与恢复衔接，已生成受控恢复动作；是否自动接力仍受本地门禁、关联 boundary 和尝试次数限制。"
            : "本次结果属于本地运行输出，边界受限于本地校验、启发式运行状态和受控恢复能力。",
    boundary: {
      identity: {
        status: protocolBoundary.identity.status,
        summary: protocolBoundary.identity.summary,
      },
      verification: {
        status: verificationStatus,
        summary:
          verification == null
            ? protocolBoundary.verification.summary
            : verification.valid === false
              ? "当前结果需要额外复核；本地校验已发现不一致或高风险信号。"
              : protocolBoundary.verification.summary,
      },
      cognition: {
        status: protocolBoundary.cognition.status,
        summary: protocolBoundary.cognition.summary,
      },
      recovery: {
        status: recoveryStatus,
        summary:
          recoveryAction?.capabilityBoundary?.summary ??
          protocolBoundary.recovery.summary,
      },
      ledger: {
        status: protocolBoundary.ledger.status,
        summary: protocolBoundary.ledger.summary,
      },
    },
  };
}

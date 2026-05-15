import {
  normalizeDeviceRuntime,
  resolveDeviceRuntimeResidentBinding,
} from "./ledger-device-runtime.js";
import {
  resolveStoredAgentId,
} from "./ledger-identity-compat.js";
import {
  resolveAgentDidForMethod,
} from "./ledger-credential-core.js";

export function resolveResidentAgentBinding(store, runtime = null) {
  return resolveDeviceRuntimeResidentBinding(runtime || store?.deviceRuntime, store);
}

export function buildResidentAgentGate(store, agent, { didMethod = null } = {}) {
  const deviceRuntime = normalizeDeviceRuntime(store.deviceRuntime);
  const { residentAgentId, residentAgent } = resolveResidentAgentBinding(store, deviceRuntime);
  const residentDid = residentAgent ? resolveAgentDidForMethod(store, residentAgent, deviceRuntime.residentDidMethod || didMethod) : null;
  const missingResident = Boolean(deviceRuntime.residentLocked) && !residentAgentId;
  const resolvedAgentId = resolveStoredAgentId(store, agent.agentId) ?? agent.agentId;
  const mismatchedResident =
    Boolean(deviceRuntime.residentLocked) &&
    Boolean(residentAgentId) &&
    residentAgentId !== resolvedAgentId;
  const required = missingResident || mismatchedResident;
  const code = missingResident ? "resident_agent_unclaimed" : mismatchedResident ? "resident_agent_mismatch" : null;

  return {
    required,
    code,
    localOnly: deviceRuntime.localMode === "local_only",
    residentAgentId,
    residentDidMethod: deviceRuntime.residentDidMethod || null,
    residentDid,
    machineId: deviceRuntime.machineId,
    machineLabel: deviceRuntime.machineLabel,
    localMode: deviceRuntime.localMode,
    allowOnlineReasoner: Boolean(deviceRuntime.allowOnlineReasoner),
    residentLocked: Boolean(deviceRuntime.residentLocked),
    isResidentAgent: residentAgentId === resolvedAgentId,
    message: missingResident
      ? "当前 本地参考层 还没有绑定 resident agent，先认领默认 agent。"
      : mismatchedResident
        ? `当前 本地参考层 目前只绑定 resident agent ${residentAgentId}。`
        : `当前 本地参考层 的 resident agent 已绑定到 ${agent.agentId}。`,
  };
}

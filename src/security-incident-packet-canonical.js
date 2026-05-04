import { normalizeOptionalText } from "./server-base-helpers.js";
import { canonicalizeMainAgentReference } from "./main-agent-compat.js";
import { resolveResidentBindingSnapshot } from "./ledger-device-runtime.js";

export function resolveIncidentPacketResidentBinding(setup = null) {
  const deviceRuntime = setup?.deviceRuntime && typeof setup.deviceRuntime === "object" ? setup.deviceRuntime : null;
  return resolveResidentBindingSnapshot(setup, { fallbackRecord: deviceRuntime });
}

export function resolveIncidentPacketResidentDidMethod(setup = null) {
  const deviceRuntime = setup?.deviceRuntime && typeof setup.deviceRuntime === "object" ? setup.deviceRuntime : null;
  return (
    normalizeOptionalText(setup?.residentDidMethod) ||
    normalizeOptionalText(deviceRuntime?.residentDidMethod) ||
    "agentpassport"
  );
}

export function canonicalizeIncidentPacketSetupSnapshot(setup = null) {
  if (!setup || typeof setup !== "object") {
    return setup;
  }
  const binding = resolveIncidentPacketResidentBinding(setup);
  const deviceRuntime = setup.deviceRuntime && typeof setup.deviceRuntime === "object"
    ? {
        ...setup.deviceRuntime,
        ...binding,
        residentAgent:
          setup.deviceRuntime.residentAgent && typeof setup.deviceRuntime.residentAgent === "object"
            ? {
                ...setup.deviceRuntime.residentAgent,
                agentId:
                  normalizeOptionalText(setup.deviceRuntime.residentAgent.agentId) ||
                  binding.physicalResidentAgentId ||
                  null,
                referenceAgentId:
                  canonicalizeMainAgentReference(
                    normalizeOptionalText(setup.deviceRuntime.residentAgent.referenceAgentId) ||
                      binding.residentAgentReference ||
                      null
                  ) || null,
              }
            : setup.deviceRuntime.residentAgent,
      }
    : setup.deviceRuntime;
  return {
    ...setup,
    ...binding,
    deviceRuntime,
  };
}

export function canonicalizeIncidentPacketEvidenceRef(evidenceRef = null, fallbackBinding = null) {
  if (!evidenceRef || typeof evidenceRef !== "object") {
    return evidenceRef;
  }
  const rawResidentAgentId =
    normalizeOptionalText(evidenceRef.residentAgentId) ||
    normalizeOptionalText(evidenceRef.agentId) ||
    normalizeOptionalText(fallbackBinding?.physicalResidentAgentId) ||
    null;
  const rawResidentAgentReference =
    normalizeOptionalText(evidenceRef.residentAgentReference) ||
    normalizeOptionalText(fallbackBinding?.residentAgentReference) ||
    null;
  const rawResolvedResidentAgentId =
    normalizeOptionalText(evidenceRef.resolvedResidentAgentId) ||
    null;
  const binding = resolveIncidentPacketResidentBinding({
    residentAgentId: rawResidentAgentId,
    residentAgentReference: rawResidentAgentReference,
    resolvedResidentAgentId:
      rawResolvedResidentAgentId ||
      normalizeOptionalText(fallbackBinding?.resolvedResidentAgentId) ||
      null,
  });
  return {
    ...evidenceRef,
    ...binding,
    resolvedResidentAgentId: rawResolvedResidentAgentId,
  };
}

const BASE_UNTRUSTED_ROUTE_ATTRIBUTION_FIELDS = Object.freeze([
  "sourceWindowId",
  "recordedByAgentId",
  "recordedByWindowId",
  "updatedByAgentId",
  "updatedByWindowId",
  "createdByAgentId",
  "createdByWindowId",
  "restoredByAgentId",
  "restoredByWindowId",
  "revokedByAgentId",
  "revokedByWindowId",
]);

export const AGENT_ROUTE_ATTRIBUTION_FIELDS = Object.freeze([
  ...BASE_UNTRUSTED_ROUTE_ATTRIBUTION_FIELDS,
  "revertedByAgentId",
  "revertedByWindowId",
]);

export const DEVICE_ROUTE_ATTRIBUTION_FIELDS = Object.freeze([
  ...BASE_UNTRUSTED_ROUTE_ATTRIBUTION_FIELDS,
  "selectedByAgentId",
  "selectedByWindowId",
  "activatedByAgentId",
  "activatedByWindowId",
  "deletedByAgentId",
  "deletedByWindowId",
  "securityPostureUpdatedAt",
  "securityPostureUpdatedByAgentId",
  "securityPostureUpdatedByWindowId",
  "securityPostureSourceWindowId",
  "localReasonerSelection",
  "localReasonerLastProbe",
  "localReasonerLastWarm",
  "selection",
  "lastProbe",
  "lastWarm",
]);

export const RECORD_ROUTE_ACTOR_FIELDS = Object.freeze([
  "sourceWindowId",
  "createdBy",
  "createdByLabel",
  "createdByAgentId",
  "createdByWindowId",
  "createdByDid",
  "createdByWalletAddress",
  "recordedByAgentId",
  "recordedByLabel",
  "recordedByDid",
  "recordedByWalletAddress",
  "recordedByWindowId",
  "signedBy",
  "signedWindowId",
  "executedBy",
  "executedByAgentId",
  "executedByLabel",
  "executedByDid",
  "executedByWalletAddress",
  "executedByWindowId",
  "executedWindowId",
  "revokedBy",
  "revokedByAgentId",
  "revokedByLabel",
  "revokedByDid",
  "revokedByWalletAddress",
  "revokedByWindowId",
  "windowId",
]);

export const SECURITY_ROUTE_ATTRIBUTION_FIELDS = Object.freeze([
  ...BASE_UNTRUSTED_ROUTE_ATTRIBUTION_FIELDS,
  "createdByReadSessionId",
  "revokedByReadSessionId",
  "rotatedByAgentId",
  "rotatedByWindowId",
  "rotatedByReadSessionId",
]);

export function stripUntrustedRouteFields(payload = {}, fields = []) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const denied = new Set(fields);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !denied.has(key)));
}

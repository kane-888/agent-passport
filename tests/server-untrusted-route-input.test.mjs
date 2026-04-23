import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_ROUTE_ATTRIBUTION_FIELDS,
  DEVICE_ROUTE_ATTRIBUTION_FIELDS,
  RECORD_ROUTE_ACTOR_FIELDS,
  SECURITY_ROUTE_ATTRIBUTION_FIELDS,
  stripUntrustedRouteFields,
} from "../src/server-untrusted-route-input.js";

test("shared untrusted route stripping removes common actor provenance fields", () => {
  const payload = {
    sourceWindowId: "forged-window",
    recordedByAgentId: "forged-agent",
    recordedByWindowId: "forged-window",
    updatedByAgentId: "forged-agent",
    updatedByWindowId: "forged-window",
    safeField: "kept",
  };

  assert.deepEqual(stripUntrustedRouteFields(payload, AGENT_ROUTE_ATTRIBUTION_FIELDS), {
    safeField: "kept",
  });
  assert.deepEqual(stripUntrustedRouteFields(payload, DEVICE_ROUTE_ATTRIBUTION_FIELDS), {
    safeField: "kept",
  });
  assert.deepEqual(stripUntrustedRouteFields(payload, SECURITY_ROUTE_ATTRIBUTION_FIELDS), {
    safeField: "kept",
  });
});

test("record route actor stripping covers issuer, signer, executor, revoker, and window spoofing", () => {
  const payload = {
    createdByAgentId: "forged-creator",
    signedWindowId: "forged-signer-window",
    executedByWalletAddress: "forged-wallet",
    revokedByDid: "did:forged:revoker",
    windowId: "forged-window",
    proposalId: "proposal_1",
    note: "trusted operator note",
  };

  assert.deepEqual(stripUntrustedRouteFields(payload, RECORD_ROUTE_ACTOR_FIELDS), {
    proposalId: "proposal_1",
    note: "trusted operator note",
  });
});

test("shared untrusted route stripping never returns attacker-controlled arrays or null payloads", () => {
  assert.deepEqual(stripUntrustedRouteFields(null, AGENT_ROUTE_ATTRIBUTION_FIELDS), {});
  assert.deepEqual(stripUntrustedRouteFields(["sourceWindowId"], AGENT_ROUTE_ATTRIBUTION_FIELDS), {});
});

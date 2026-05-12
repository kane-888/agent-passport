import assert from "node:assert/strict";
import test from "node:test";

import {
  extractClaimValueFromText,
  mapPassportFieldToClaimKey,
  splitResponseIntoSentences,
} from "../src/ledger-claim-extraction.js";

test("claim value extraction returns the first captured value", () => {
  assert.equal(
    extractClaimValueFromText("agent_id: main-agent, wallet 0xabc123ef", [
      /missing[:=]\s*([a-z0-9_-]+)/i,
      /agent[_-]?id[:=]\s*([a-z0-9_-]+)/i,
    ]),
    "main-agent"
  );
  assert.equal(extractClaimValueFromText("no captured claim", [/agent[:=]\s*([a-z]+)/i]), null);
});

test("response sentence splitting trims empty items and clamps output", () => {
  const response = [
    "First claim!",
    "Second claim?",
    "",
    ...Array.from({ length: 30 }, (_, index) => `extra-${index};`),
  ].join("\n");
  const sentences = splitResponseIntoSentences(response);
  assert.equal(sentences[0], "First claim!");
  assert.equal(sentences[1], "Second claim?");
  assert.equal(sentences.length, 24);
});

test("passport fields map onto response claim keys", () => {
  assert.equal(mapPassportFieldToClaimKey("agent_id"), "agentId");
  assert.equal(mapPassportFieldToClaimKey("parent"), "parentAgentId");
  assert.equal(mapPassportFieldToClaimKey("wallet"), "walletAddress");
  assert.equal(mapPassportFieldToClaimKey("name"), "displayName");
  assert.equal(mapPassportFieldToClaimKey("threshold"), "authorizationThreshold");
  assert.equal(mapPassportFieldToClaimKey("unknown_field"), null);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIdentityProfile,
  deriveCompatibleWalletAddresses,
  deriveLegacyWalletAddress,
  deriveWalletAddress,
  walletMatchesDerivedSeed,
} from "../src/identity.js";

test("new identity profiles derive canonical agent-passport wallets by default", () => {
  const chainId = "agent-passport-alpha";
  const agentId = "agent_main";
  const seed = `${chainId}:agent:${agentId}`;
  const profile = buildIdentityProfile({
    chainId,
    agentId,
    displayName: "Main Agent",
    controller: "Kane",
  });

  assert.equal(profile.walletAddress, deriveWalletAddress(seed));
  assert.notEqual(profile.walletAddress, deriveLegacyWalletAddress(seed));
});

test("existing legacy-derived wallets stay stable during identity rebuild", () => {
  const chainId = "agent-passport-alpha";
  const agentId = "agent_main";
  const seed = `${chainId}:agent:${agentId}`;
  const legacyWalletAddress = deriveLegacyWalletAddress(seed);
  const existingIdentity = {
    did: "did:agentpassport:agent-passport-alpha:agent_openneed_agents",
    walletAddress: legacyWalletAddress,
    controllers: [
      {
        label: "Kane",
        walletAddress: legacyWalletAddress,
      },
    ],
    authorizationPolicy: {
      type: "single-sig",
      threshold: 1,
      signers: [
        {
          label: "Kane",
          walletAddress: legacyWalletAddress,
        },
      ],
    },
  };

  const profile = buildIdentityProfile({
    chainId,
    agentId,
    displayName: "Main Agent",
    controller: "Kane",
    existingIdentity,
    preserveDid: true,
  });

  assert.equal(profile.walletAddress, legacyWalletAddress);
  assert.equal(profile.did, existingIdentity.did);
});

test("identity rebuild preserves the previous did as originDid when canonical rewrite happens", () => {
  const chainId = "agent-passport-alpha";
  const agentId = "agent_main";
  const existingIdentity = {
    did: "did:web:example.com:agent_main",
    walletAddress: "0x1111111111111111111111111111111111111111",
    controllers: [
      {
        label: "Kane",
        walletAddress: "0x1111111111111111111111111111111111111111",
      },
    ],
    authorizationPolicy: {
      type: "single-sig",
      threshold: 1,
      signers: [
        {
          label: "Kane",
          walletAddress: "0x1111111111111111111111111111111111111111",
        },
      ],
    },
  };

  const profile = buildIdentityProfile({
    chainId,
    agentId,
    displayName: "Main Agent",
    controller: "Kane",
    existingIdentity,
    preserveDid: false,
  });

  assert.equal(profile.did, "did:agentpassport:agent-passport-alpha:agent-main");
  assert.equal(profile.originDid, existingIdentity.did);
});

test("explicit originDid still wins over auto-carried previous did", () => {
  const profile = buildIdentityProfile({
    chainId: "agent-passport-alpha",
    agentId: "agent_main",
    displayName: "Main Agent",
    controller: "Kane",
    existingIdentity: {
      did: "did:web:example.com:agent_main",
    },
    preserveDid: false,
    originDid: "did:origin:custom",
  });

  assert.equal(profile.originDid, "did:origin:custom");
});

test("wallet compatibility checks accept both canonical and legacy derivations", () => {
  const seed = "agent-passport-alpha:agent:agent_main";
  const canonicalWalletAddress = deriveWalletAddress(seed);
  const legacyWalletAddress = deriveLegacyWalletAddress(seed);

  assert.deepEqual(deriveCompatibleWalletAddresses(seed), [canonicalWalletAddress, legacyWalletAddress]);
  assert.equal(walletMatchesDerivedSeed(canonicalWalletAddress, seed), true);
  assert.equal(walletMatchesDerivedSeed(legacyWalletAddress, seed), true);
  assert.equal(walletMatchesDerivedSeed("0x0000000000000000000000000000000000000000", seed), false);
});

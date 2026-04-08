import { createHash, createHmac, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getSystemKeychainStatus,
  readGenericPasswordFromKeychain,
  shouldPreferSystemKeychain,
  writeGenericPasswordToKeychain,
} from "./local-secrets.js";
import {
  ACTIVE_DID_METHOD,
  DID_SERVICE_HUB_TYPE,
  DID_SIGNING_VERIFICATION_METHOD_TYPE,
  DID_VERIFICATION_METHOD_TYPE,
  FUTURE_DID_METHOD,
  normalizeDidMethod,
  SUPPORTED_DID_METHODS,
  VC_SIGNATURE_PROOF_TYPE,
} from "./protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");
const SIGNING_MASTER_SECRET_PATH =
  process.env.AGENT_PASSPORT_SIGNING_SECRET_PATH || path.join(DATA_DIR, ".did-signing-master-secret");
const SIGNING_MASTER_SECRET_SERVICE = "AgentPassport.SigningMasterSecret";
const SIGNING_MASTER_SECRET_ACCOUNT = process.env.AGENT_PASSPORT_KEYCHAIN_ACCOUNT || "resident-default";
let cachedSigningMasterSecret = null;
let cachedSigningMasterSecretMetadata = null;

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function toText(value) {
  return String(value ?? "").trim();
}

function isHexAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function sanitizeComponent(value) {
  return toText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function hashHex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function deriveBinaryHash(value) {
  return createHash("sha256").update(String(value)).digest();
}

function loadSigningMasterSecret() {
  if (cachedSigningMasterSecret) {
    return cachedSigningMasterSecret;
  }

  const explicitSecret = toText(process.env.AGENT_PASSPORT_SIGNING_MASTER_SECRET);
  if (explicitSecret) {
    cachedSigningMasterSecret = deriveBinaryHash(explicitSecret);
    cachedSigningMasterSecretMetadata = {
      source: "env",
      path: null,
      service: null,
      account: null,
    };
    return cachedSigningMasterSecret;
  }

  try {
    const keychainStatus = getSystemKeychainStatus();
    if (shouldPreferSystemKeychain() && keychainStatus.available) {
      const keychainSecret = readGenericPasswordFromKeychain(
        SIGNING_MASTER_SECRET_SERVICE,
        SIGNING_MASTER_SECRET_ACCOUNT
      );
      if (keychainSecret) {
        cachedSigningMasterSecret = deriveBinaryHash(keychainSecret);
        cachedSigningMasterSecretMetadata = {
          source: "keychain",
          path: null,
          service: SIGNING_MASTER_SECRET_SERVICE,
          account: SIGNING_MASTER_SECRET_ACCOUNT,
        };
        return cachedSigningMasterSecret;
      }
    }

    if (existsSync(SIGNING_MASTER_SECRET_PATH)) {
      const raw = toText(readFileSync(SIGNING_MASTER_SECRET_PATH, "utf8"));
      if (raw) {
        cachedSigningMasterSecret = deriveBinaryHash(raw);
        cachedSigningMasterSecretMetadata = {
          source: "file",
          path: SIGNING_MASTER_SECRET_PATH,
          service: null,
          account: null,
        };
        return cachedSigningMasterSecret;
      }
    }

    const generated = randomBytes(32).toString("base64url");
    if (shouldPreferSystemKeychain() && keychainStatus.available) {
      const stored = writeGenericPasswordToKeychain(
        SIGNING_MASTER_SECRET_SERVICE,
        SIGNING_MASTER_SECRET_ACCOUNT,
        generated
      );
      if (stored.ok) {
        cachedSigningMasterSecret = deriveBinaryHash(generated);
        cachedSigningMasterSecretMetadata = {
          source: "keychain",
          path: null,
          service: SIGNING_MASTER_SECRET_SERVICE,
          account: SIGNING_MASTER_SECRET_ACCOUNT,
        };
        return cachedSigningMasterSecret;
      }
    }

    mkdirSync(path.dirname(SIGNING_MASTER_SECRET_PATH), { recursive: true });
    writeFileSync(SIGNING_MASTER_SECRET_PATH, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
    cachedSigningMasterSecret = deriveBinaryHash(generated);
    cachedSigningMasterSecretMetadata = {
      source: "file",
      path: SIGNING_MASTER_SECRET_PATH,
      service: null,
      account: null,
    };
    return cachedSigningMasterSecret;
  } catch (error) {
    throw new Error(`Unable to initialize Agent Passport signing master secret: ${error.message || error}`);
  }
}

export function getSigningMasterSecretStatus() {
  if (!cachedSigningMasterSecretMetadata) {
    loadSigningMasterSecret();
  }

  const keychain = getSystemKeychainStatus();
  return {
    preferred: shouldPreferSystemKeychain(),
    available: keychain.available,
    reason: keychain.reason,
    source: cachedSigningMasterSecretMetadata?.source || null,
    path: cachedSigningMasterSecretMetadata?.path || null,
    service: cachedSigningMasterSecretMetadata?.service || null,
    account: cachedSigningMasterSecretMetadata?.account || null,
  };
}

export function migrateSigningMasterSecretToKeychain({ dryRun = true, removeFile = false } = {}) {
  const explicitSecret = toText(process.env.AGENT_PASSPORT_SIGNING_MASTER_SECRET);
  if (explicitSecret) {
    return {
      migrated: false,
      skipped: true,
      dryRun,
      reason: "env_managed",
      source: "env",
      target: "keychain",
    };
  }

  const keychain = getSystemKeychainStatus();
  if (!shouldPreferSystemKeychain() || !keychain.available) {
    return {
      migrated: false,
      skipped: true,
      dryRun,
      reason: keychain.reason || "keychain_unavailable",
      source: cachedSigningMasterSecretMetadata?.source || (existsSync(SIGNING_MASTER_SECRET_PATH) ? "file" : "generated"),
      target: "keychain",
    };
  }

  const existingKeychainSecret = readGenericPasswordFromKeychain(
    SIGNING_MASTER_SECRET_SERVICE,
    SIGNING_MASTER_SECRET_ACCOUNT
  );
  if (existingKeychainSecret && !existsSync(SIGNING_MASTER_SECRET_PATH)) {
    cachedSigningMasterSecret = deriveBinaryHash(existingKeychainSecret);
    cachedSigningMasterSecretMetadata = {
      source: "keychain",
      path: null,
      service: SIGNING_MASTER_SECRET_SERVICE,
      account: SIGNING_MASTER_SECRET_ACCOUNT,
    };
    return {
      migrated: false,
      skipped: true,
      dryRun,
      reason: "already_keychain",
      source: "keychain",
      target: "keychain",
    };
  }

  let fileSecret = null;
  if (existsSync(SIGNING_MASTER_SECRET_PATH)) {
    fileSecret = toText(readFileSync(SIGNING_MASTER_SECRET_PATH, "utf8"));
  }
  if (!fileSecret) {
    return {
      migrated: false,
      skipped: true,
      dryRun,
      reason: "file_secret_missing",
      source: "unknown",
      target: "keychain",
    };
  }

  if (dryRun) {
    return {
      migrated: false,
      skipped: false,
      dryRun: true,
      source: "file",
      target: "keychain",
      path: SIGNING_MASTER_SECRET_PATH,
      service: SIGNING_MASTER_SECRET_SERVICE,
      account: SIGNING_MASTER_SECRET_ACCOUNT,
      removeFile,
    };
  }

  const stored = writeGenericPasswordToKeychain(
    SIGNING_MASTER_SECRET_SERVICE,
    SIGNING_MASTER_SECRET_ACCOUNT,
    fileSecret
  );
  if (!stored.ok) {
    throw new Error(`Unable to migrate signing secret to keychain: ${stored.reason || "keychain_write_failed"}`);
  }

  if (removeFile && existsSync(SIGNING_MASTER_SECRET_PATH)) {
    unlinkSync(SIGNING_MASTER_SECRET_PATH);
  }

  cachedSigningMasterSecret = deriveBinaryHash(fileSecret);
  cachedSigningMasterSecretMetadata = {
    source: "keychain",
    path: removeFile ? null : SIGNING_MASTER_SECRET_PATH,
    service: SIGNING_MASTER_SECRET_SERVICE,
    account: SIGNING_MASTER_SECRET_ACCOUNT,
  };

  return {
    migrated: true,
    skipped: false,
    dryRun: false,
    source: "file",
    target: "keychain",
    removedFile: Boolean(removeFile),
    path: removeFile ? null : SIGNING_MASTER_SECRET_PATH,
    service: SIGNING_MASTER_SECRET_SERVICE,
    account: SIGNING_MASTER_SECRET_ACCOUNT,
  };
}

function parseDidSigningKeyIndex(verificationMethod) {
  const text = toText(verificationMethod);
  const match = text.match(/#signing-(\d+)$/);
  if (!match) {
    return 1;
  }

  const numeric = Number(match[1]);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 1;
}

function deriveDidSigningSeed(did, keyIndex = 1) {
  const secret = loadSigningMasterSecret();
  return createHmac("sha256", secret).update(`agent-passport:did-signing:${did}:${keyIndex}`).digest().subarray(0, 32);
}

function encodeBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const text = toText(value);
  if (!text) {
    return null;
  }

  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function deriveDidSigningPrivateKey(did, keyIndex = 1) {
  const seed = deriveDidSigningSeed(did, keyIndex);
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

export function buildDidSigningKeyId(did, keyIndex = 1) {
  return `${did}#signing-${Math.max(1, Math.floor(Number(keyIndex) || 1))}`;
}

export function getDidSigningKeyMaterial(did, verificationMethod = null) {
  const resolvedDid = toText(did);
  if (!resolvedDid) {
    throw new Error("did is required");
  }

  const keyIndex = parseDidSigningKeyIndex(verificationMethod || buildDidSigningKeyId(resolvedDid));
  const privateKey = deriveDidSigningPrivateKey(resolvedDid, keyIndex);
  const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicKeyHex = Buffer.from(publicDer).subarray(ED25519_SPKI_PREFIX.length).toString("hex");
  const keyId = buildDidSigningKeyId(resolvedDid, keyIndex);

  return {
    id: keyId,
    type: DID_SIGNING_VERIFICATION_METHOD_TYPE,
    controller: resolvedDid,
    keyIndex,
    publicKeyHex,
    suite: VC_SIGNATURE_PROOF_TYPE,
    privateKey,
  };
}

export function signCredentialHash({ did, verificationMethod = null, credentialHash } = {}) {
  const resolvedHash = toText(credentialHash);
  if (!resolvedHash) {
    throw new Error("credentialHash is required");
  }

  const keyMaterial = getDidSigningKeyMaterial(did, verificationMethod);
  const signature = sign(null, Buffer.from(resolvedHash, "hex"), keyMaterial.privateKey);

  return {
    type: VC_SIGNATURE_PROOF_TYPE,
    verificationMethod: keyMaterial.id,
    signatureValue: encodeBase64Url(signature),
    publicKeyHex: keyMaterial.publicKeyHex,
  };
}

export function verifyCredentialHashSignature({
  did,
  verificationMethod = null,
  credentialHash,
  signatureValue,
  publicKeyHex = null,
} = {}) {
  const resolvedHash = toText(credentialHash);
  const resolvedSignature = decodeBase64Url(signatureValue);
  if (!resolvedHash || !resolvedSignature) {
    return {
      signaturePresent: false,
      signatureMatches: null,
      publicKeyMatches: null,
      verificationMethod: verificationMethod ? toText(verificationMethod) : null,
      expectedVerificationMethod: did ? buildDidSigningKeyId(did, parseDidSigningKeyIndex(verificationMethod)) : null,
    };
  }

  const normalizedPublicKeyHex = toText(publicKeyHex).toLowerCase();
  const keyMaterial = getDidSigningKeyMaterial(did, verificationMethod);
  const effectivePublicKeyHex = normalizedPublicKeyHex || keyMaterial.publicKeyHex;
  const derivedPublicDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(effectivePublicKeyHex, "hex")]);
  const publicKey = createPublicKey({ key: derivedPublicDer, format: "der", type: "spki" });
  const signatureMatches = verify(null, Buffer.from(resolvedHash, "hex"), publicKey, resolvedSignature);
  const publicKeyMatches = normalizedPublicKeyHex ? normalizedPublicKeyHex === keyMaterial.publicKeyHex.toLowerCase() : null;

  return {
    signaturePresent: true,
    signatureMatches,
    publicKeyMatches,
    verificationMethod: toText(verificationMethod) || keyMaterial.id,
    expectedVerificationMethod: keyMaterial.id,
    publicKeyHex: keyMaterial.publicKeyHex,
  };
}

export function deriveWalletAddress(seed) {
  return `0x${hashHex(`openneed-agent-passport:${seed}`).slice(0, 40)}`;
}

export function normalizeWalletAddress(value, seed) {
  const text = toText(value);
  if (!text) {
    return deriveWalletAddress(seed);
  }

  if (isHexAddress(text)) {
    return text.toLowerCase();
  }

  return deriveWalletAddress(seed ? `${seed}:${text}` : text);
}

export function deriveDid(chainId, agentId, method = ACTIVE_DID_METHOD) {
  return `did:${normalizeDidMethod(method)}:${sanitizeComponent(chainId)}:${sanitizeComponent(agentId)}`;
}

export function parseDidReference(did) {
  const text = toText(did);
  if (!text || !text.startsWith("did:")) {
    return null;
  }

  const parts = text.split(":");
  if (parts.length < 4) {
    return null;
  }

  return {
    did: text,
    method: normalizeDidMethod(parts[1], parts[1]),
    chainId: parts[2] || null,
    agentComponent: parts.slice(3).join(":") || null,
  };
}

export function deriveDidAliases(chainId, agentId) {
  return SUPPORTED_DID_METHODS.map((method) => deriveDid(chainId, agentId, method));
}

export function inferDidAliases(did, agentId = null) {
  const parsed = parseDidReference(did);
  const resolvedAgentId = toText(agentId) || parsed?.agentComponent || null;
  if (!parsed?.chainId || !resolvedAgentId) {
    return [toText(did)].filter(Boolean);
  }

  return deriveDidAliases(parsed.chainId, resolvedAgentId);
}

function parseSignerInput(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value.split(/[,;]+/);
  }

  if (value == null) {
    return [];
  }

  return [value];
}

function createSignerRecord(raw, chainId, index, fallbackLabel) {
  if (raw && typeof raw === "object") {
    const label = toText(raw.label || raw.name || raw.controller || raw.agentId || raw.walletAddress || fallbackLabel || `signer-${index + 1}`);
    const walletAddress = normalizeWalletAddress(raw.walletAddress || raw.address, `${chainId}:signer:${label}:${index + 1}`);
    return { label, walletAddress, agentId: raw.agentId ? toText(raw.agentId) : undefined };
  }

  const text = toText(raw);
  if (!text) {
    return null;
  }

  if (isHexAddress(text)) {
    return {
      label: fallbackLabel ? `${fallbackLabel}-${index + 1}` : `signer-${index + 1}`,
      walletAddress: text.toLowerCase(),
    };
  }

  return {
    label: text,
    walletAddress: normalizeWalletAddress(null, `${chainId}:signer:${text}:${index + 1}`),
  };
}

export function normalizeSignerList({ controller, controllers, signers } = {}, chainId, fallbackLabel) {
  const controllersInput = parseSignerInput(controllers);
  const signersInput = parseSignerInput(signers);
  const controllerInput = parseSignerInput(controller);

  const rawInputs =
    controllersInput.length > 0
      ? controllersInput
      : signersInput.length > 0
        ? signersInput
        : controllerInput;

  return rawInputs.map((raw, index) => createSignerRecord(raw, chainId, index, fallbackLabel)).filter(Boolean);
}

function resolveThreshold(threshold, signerCount) {
  const numeric = Number(threshold);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.max(1, Math.min(Math.floor(numeric), Math.max(1, signerCount)));
  }

  return signerCount > 1 ? signerCount : 1;
}

function cloneSignerList(signers) {
  return signers.map((signer) => ({ ...signer }));
}

function getPrimarySignerFromIdentity(identity) {
  return identity?.authorizationPolicy?.signers?.[0] || identity?.controllers?.[0] || null;
}

export function buildIdentityProfile({
  chainId,
  agentId,
  displayName,
  controller,
  controllers,
  signers,
  walletAddress,
  threshold,
  existingIdentity = null,
  preserveDid = false,
  originDid = null,
} = {}) {
  if (!chainId) {
    throw new Error("chainId is required");
  }

  if (!agentId) {
    throw new Error("agentId is required");
  }

  const fallbackLabel = toText(controller || displayName || agentId || existingIdentity?.controllers?.[0]?.label || "signer");
  const signerList = normalizeSignerList({ controller, controllers, signers }, chainId, fallbackLabel);

  const resolvedSigners =
    signerList.length > 0
      ? signerList
      : existingIdentity?.authorizationPolicy?.signers?.length
        ? existingIdentity.authorizationPolicy.signers
        : [
            {
              label: fallbackLabel,
              walletAddress: normalizeWalletAddress(null, `${chainId}:signer:${fallbackLabel}:0`),
            },
          ];

  const canonicalWalletAddress = normalizeWalletAddress(
    walletAddress ?? existingIdentity?.walletAddress,
    `${chainId}:agent:${agentId}`
  );
  const resolvedThreshold = resolveThreshold(
    threshold ?? existingIdentity?.authorizationPolicy?.threshold,
    resolvedSigners.length
  );
  const policyType = resolvedThreshold > 1 ? "multisig" : "single-sig";
  const did = preserveDid && existingIdentity?.did ? existingIdentity.did : deriveDid(chainId, agentId);
  const clonedSigners = cloneSignerList(resolvedSigners);

  return {
    did,
    walletAddress: canonicalWalletAddress,
    walletScheme: "local-deterministic",
    originDid,
    controllers: clonedSigners,
    authorizationPolicy: {
      type: policyType,
      threshold: resolvedThreshold,
      signers: clonedSigners,
    },
  };
}

export function buildDidDocument(agent, { method = null } = {}) {
  const identity = agent?.identity;
  if (!identity?.did) {
    throw new Error("Agent identity with DID is required");
  }
  const parsedDid = parseDidReference(identity.did);
  const primaryDid =
    parsedDid?.chainId && agent?.agentId
      ? deriveDid(parsedDid.chainId, agent.agentId, normalizeDidMethod(method, parsedDid.method || ACTIVE_DID_METHOD))
      : identity.did;
  const equivalentIds = inferDidAliases(identity.did, agent?.agentId).filter((item) => item !== primaryDid);

  const walletVerificationMethods = (identity.authorizationPolicy?.signers || []).map((signer, index) => ({
    id: `${primaryDid}#key-${index + 1}`,
    type: DID_VERIFICATION_METHOD_TYPE,
    controller: primaryDid,
    label: signer.label,
    walletAddress: signer.walletAddress,
    publicKeyHex: String(signer.walletAddress || "").replace(/^0x/, ""),
  }));
  const signingKey = getDidSigningKeyMaterial(primaryDid);
  const verificationMethod = [
    {
      id: signingKey.id,
      type: signingKey.type,
      controller: primaryDid,
      publicKeyHex: signingKey.publicKeyHex,
      suite: signingKey.suite,
    },
    ...walletVerificationMethods,
  ];

  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: primaryDid,
    controller: primaryDid,
    alsoKnownAs: [agent.agentId, agent.displayName, ...equivalentIds].filter(Boolean),
    equivalentId: equivalentIds,
    verificationMethod,
    authentication: [signingKey.id],
    assertionMethod: [signingKey.id],
    capabilityInvocation: verificationMethod.map((method) => method.id),
    service: [
      {
        id: `${primaryDid}#wallet`,
        type: "WalletAddressService",
        serviceEndpoint: identity.walletAddress,
      },
      {
        id: `${primaryDid}#hub`,
        type: DID_SERVICE_HUB_TYPE,
        serviceEndpoint: `agent://${agent.agentId}`,
      },
    ],
  };
}

function normalizeApprovalInput(raw, chainId) {
  if (raw && typeof raw === "object") {
    const label = toText(raw.label || raw.name || raw.agentId || raw.walletAddress);
    const agentId = raw.agentId ? toText(raw.agentId) : undefined;
    const walletAddress = raw.walletAddress
      ? normalizeWalletAddress(raw.walletAddress, `${chainId}:approval:${label || agentId || "approval"}`)
      : label && isHexAddress(label)
        ? label.toLowerCase()
        : normalizeWalletAddress(label || agentId || "approval", `${chainId}:approval:${label || agentId || "approval"}`);
    return {
      raw,
      label: label || agentId || walletAddress,
      walletAddress,
      agentId,
    };
  }

  const text = toText(raw);
  if (!text) {
    return null;
  }

  if (isHexAddress(text)) {
    return {
      raw: text,
      label: text.toLowerCase(),
      walletAddress: text.toLowerCase(),
      agentId: undefined,
    };
  }

  return {
    raw: text,
    label: text,
    walletAddress: normalizeWalletAddress(text, `${chainId}:approval:${text}`),
    agentId: undefined,
  };
}

function approvalMatchesSigner(approval, signer) {
  if (!approval || !signer) {
    return false;
  }

  return approval.walletAddress === signer.walletAddress || approval.label === signer.label;
}

export function resolveApprovalRecord({ store, policyAgent, rawApproval } = {}) {
  const chainId = store?.chainId;
  const approval = normalizeApprovalInput(rawApproval, chainId);
  if (!approval) {
    return null;
  }

  if (approval.agentId && store?.agents?.[approval.agentId]) {
    const sourceAgent = store.agents[approval.agentId];
    const primarySigner = getPrimarySignerFromIdentity(sourceAgent.identity);
    if (primarySigner) {
      return {
        ...approval,
        agentId: sourceAgent.agentId,
        label: primarySigner.label || sourceAgent.controller || sourceAgent.displayName || sourceAgent.agentId,
        walletAddress: primarySigner.walletAddress,
        signerWalletAddress: primarySigner.walletAddress,
        signerLabel: primarySigner.label || sourceAgent.controller || sourceAgent.displayName || sourceAgent.agentId,
      };
    }
  }

  if (typeof rawApproval === "string" && store?.agents?.[rawApproval]) {
    const sourceAgent = store.agents[rawApproval];
    const primarySigner = getPrimarySignerFromIdentity(sourceAgent.identity);
    if (primarySigner) {
      return {
        ...approval,
        agentId: sourceAgent.agentId,
        label: primarySigner.label || sourceAgent.controller || sourceAgent.displayName || sourceAgent.agentId,
        walletAddress: primarySigner.walletAddress,
        signerWalletAddress: primarySigner.walletAddress,
        signerLabel: primarySigner.label || sourceAgent.controller || sourceAgent.displayName || sourceAgent.agentId,
      };
    }
  }

  if (
    policyAgent &&
    typeof rawApproval === "string" &&
    [policyAgent.agentId, policyAgent.displayName, policyAgent.controller]
      .filter(Boolean)
      .map((value) => String(value).trim())
      .includes(String(rawApproval).trim())
  ) {
    const primarySigner = getPrimarySignerFromIdentity(policyAgent.identity);
    if (primarySigner) {
      return {
        ...approval,
        agentId: policyAgent.agentId,
        label: primarySigner.label || policyAgent.controller || policyAgent.displayName || policyAgent.agentId,
        walletAddress: primarySigner.walletAddress,
        signerWalletAddress: primarySigner.walletAddress,
        signerLabel: primarySigner.label || policyAgent.controller || policyAgent.displayName || policyAgent.agentId,
      };
    }
  }

  return {
    ...approval,
    signerWalletAddress: approval.walletAddress,
    signerLabel: approval.label,
  };
}

export function collectApprovalInputs(payload = {}) {
  const collected = [];
  const seen = new Set();

  const push = (value) => {
    if (value == null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }

    if (typeof value === "string") {
      value
        .split(/[,;]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          if (!seen.has(part)) {
            seen.add(part);
            collected.push(part);
          }
        });
      return;
    }

    const key = JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      collected.push(value);
    }
  };

  push(payload.approvals);
  push(payload.approvedBy);
  push(payload.authorizedBy);

  return collected;
}

export function summarizeApprovals({ store, policyAgent, rawApprovals = [] } = {}) {
  const policy = policyAgent?.identity?.authorizationPolicy;
  if (!policy) {
    throw new Error(`Policy missing for agent: ${policyAgent?.agentId || "unknown"}`);
  }

  const matches = [];
  const seenWallets = new Set();

  for (const rawApproval of rawApprovals) {
    const approval = resolveApprovalRecord({ store, policyAgent, rawApproval });
    if (!approval) {
      continue;
    }

    const signer = policy.signers.find((candidate) => approvalMatchesSigner(approval, candidate));
    const matchedSigner =
      signer ||
      (approval.agentId === policyAgent.agentId
        ? policy.signers[0]
        : typeof rawApproval === "string" &&
            [policyAgent.agentId, policyAgent.displayName, policyAgent.controller]
              .filter(Boolean)
              .map((value) => String(value).trim())
              .includes(String(rawApproval).trim())
          ? policy.signers[0]
          : null);

    if (!matchedSigner) {
      continue;
    }

    if (seenWallets.has(matchedSigner.walletAddress)) {
      continue;
    }

    seenWallets.add(matchedSigner.walletAddress);
    matches.push({
      signerLabel: matchedSigner.label,
      signerWalletAddress: matchedSigner.walletAddress,
      approval: approval.raw,
    });
  }

  return {
    policy,
    approvals: matches,
  };
}

export function validateApprovals({ store, policyAgent, rawApprovals = [] } = {}) {
  const { policy, approvals: matches } = summarizeApprovals({ store, policyAgent, rawApprovals });

  if (matches.length < policy.threshold) {
    const signerSummary = policy.signers.map((signer) => signer.label || signer.walletAddress).join(", ");
    throw new Error(
      `Not enough approvals for ${policyAgent.displayName}. Required ${policy.threshold} of ${policy.signers.length}: ${signerSummary}`
    );
  }

  return {
    policy,
    approvals: matches,
  };
}

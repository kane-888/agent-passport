import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

import {
  AGENT_PASSPORT_LOCAL_REASONER_LABEL,
  AGENT_PASSPORT_MEMORY_ENGINE_LABEL,
  displayAgentPassportLocalReasonerModel,
  isAgentPassportLocalReasonerModel,
} from "../src/memory-engine-branding.js";
import {
  canonicalizeHybridRuntimeReasonerSelectionFlags,
  LEGACY_OPENNEED_MEMORY_ENGINE_NAME,
  LEGACY_OPENNEED_REASONER_BRAND,
  OPENNEED_LAB_TITLE,
  OPENNEED_MAIN_CONSOLE_TITLE,
  OPENNEED_OFFLINE_CHAT_TITLE,
  OPENNEED_REASONER_OLLAMA_MODEL,
  OPENNEED_REPAIR_HUB_TITLE,
  displayOpenNeedReasonerModel,
  isOpenNeedReasonerModel,
  resolveOpenNeedReasonerModel,
} from "../src/openneed-memory-engine-compat.js";
import { SHARED_CANONICAL_MEMORIES } from "../src/offline-chat-shared-memory.js";
import { buildDidDocument, deriveDid, inferDidAliases, parseDidReference } from "../src/identity.js";
import { buildProtocolDescriptor, normalizeDidMethod } from "../src/protocol.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_MAIN_AGENT_ID = "agent_main";
const LEGACY_MAIN_AGENT_ID = "agent_openneed_agents";
let importCounter = 0;

function uniqueImportSuffix(label) {
  importCounter += 1;
  return `${label}-${process.pid}-${Date.now()}-${importCounter}`;
}

function loadPublicLinkHelpers() {
  const source = fs.readFileSync(path.join(rootDir, "public", "ui-links.js"), "utf8");
  const sandbox = {
    URLSearchParams,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.AgentPassportLinks;
}

function withEnv(overrides, operation) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = overrides[key];
  }
  return Promise.resolve()
    .then(operation)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value == null) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

test("memory engine naming accepts legacy inputs but displays the memory stability engine", () => {
  assert.equal(resolveOpenNeedReasonerModel(LEGACY_OPENNEED_REASONER_BRAND), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(resolveOpenNeedReasonerModel(LEGACY_OPENNEED_MEMORY_ENGINE_NAME), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(resolveOpenNeedReasonerModel(AGENT_PASSPORT_LOCAL_REASONER_LABEL), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(resolveOpenNeedReasonerModel(AGENT_PASSPORT_MEMORY_ENGINE_LABEL), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(displayAgentPassportLocalReasonerModel(LEGACY_OPENNEED_REASONER_BRAND), AGENT_PASSPORT_LOCAL_REASONER_LABEL);
  assert.equal(displayAgentPassportLocalReasonerModel(OPENNEED_REASONER_OLLAMA_MODEL), AGENT_PASSPORT_LOCAL_REASONER_LABEL);
  assert.equal(displayOpenNeedReasonerModel(OPENNEED_REASONER_OLLAMA_MODEL), AGENT_PASSPORT_LOCAL_REASONER_LABEL);
  assert.equal(isAgentPassportLocalReasonerModel(LEGACY_OPENNEED_REASONER_BRAND), true);
  assert.equal(isOpenNeedReasonerModel(LEGACY_OPENNEED_REASONER_BRAND), true);
});

test("legacy title exports remain openneed app-layer titles", () => {
  assert.equal(OPENNEED_MAIN_CONSOLE_TITLE, "openneed");
  assert.equal(OPENNEED_OFFLINE_CHAT_TITLE, "openneed 离线聊天");
  assert.equal(OPENNEED_LAB_TITLE, "openneed 高级工具页");
  assert.equal(OPENNEED_REPAIR_HUB_TITLE, "openneed 修复中心");
});

test("canonical memory-engine branding keeps openneed names in compat-only files", () => {
  const canonicalSource = fs.readFileSync(path.join(rootDir, "src", "memory-engine-branding.js"), "utf8");
  const compatSource = fs.readFileSync(path.join(rootDir, "src", "openneed-memory-engine-compat.js"), "utf8");

  assert.doesNotMatch(canonicalSource, /export const OPENNEED_/u);
  assert.doesNotMatch(canonicalSource, /resolveOpenNeedReasonerModel/u);
  assert.doesNotMatch(canonicalSource, /displayOpenNeedReasonerModel/u);
  assert.match(compatSource, /export const OPENNEED_MAIN_CONSOLE_TITLE/u);
  assert.match(compatSource, /export const LEGACY_OPENNEED_REASONER_BRAND/u);
});

test("layer boundary correction locks openneed to app and compatibility scopes", () => {
  const boundaryDoc = fs.readFileSync(path.join(rootDir, "docs", "layer-boundary-correction.md"), "utf8");
  const readme = fs.readFileSync(path.join(rootDir, "README.md"), "utf8");
  const sharedMemoryText = SHARED_CANONICAL_MEMORIES.map((entry) => `${entry.title}\n${entry.content}`).join("\n");

  assert.match(boundaryDoc, /`OpenNeed \/ gemma4:e4b \/ Ollama` 相关的大语言模型能力，概念归属在 `记忆稳态引擎`/u);
  assert.match(boundaryDoc, /`openneed` 只是基于 `记忆稳态引擎 \+ agent-passport` 构建出来的 app/u);
  assert.match(boundaryDoc, /\| 记忆稳态引擎 \| 本体 \| 模型底座、本地推理、`gemma4:e4b` \/ Ollama 接入/u);
  assert.match(boundaryDoc, /\| `agent-passport` \| 本体 \| 连续身份、长期偏好、恢复、长期记忆/u);
  assert.match(boundaryDoc, /\| `openneed` \| 桥接 \/ app \| 调用记忆稳态引擎和 `agent-passport`/u);
  assert.match(boundaryDoc, /线程目标是把记忆稳态引擎作为底层本体并入 `agent-passport` 运行栈/u);
  assert.match(boundaryDoc, /任何公开叙事、正式架构判断、prompt 或新接口默认值，都必须回到 `记忆稳态引擎 \+ agent-passport \+ openneed app` 的三层边界/u);
  assert.match(readme, /\[docs\/layer-boundary-correction\.md\]\(docs\/layer-boundary-correction\.md\)/u);
  assert.match(
    sharedMemoryText,
    /记忆稳态引擎负责模型底座、本地推理、记忆压缩和稳态维持；agent-passport 负责连续身份、长期偏好、恢复、长期记忆和审计；openneed 只是基于两者构建出来的 app/u
  );
});

test("hybrid runtime legacy selection aliases are canonicalized inside the compat layer", () => {
  assert.deepEqual(
    canonicalizeHybridRuntimeReasonerSelectionFlags({
      openneedPreferred: true,
      latestRunUsedOpenNeed: true,
    }),
    {
      memoryStabilityLocalReasonerPreferred: true,
      localReasonerPreferred: true,
      latestRunUsedMemoryStabilityReasoner: true,
      latestRunUsedLocalReasoner: true,
    }
  );
  assert.deepEqual(
    canonicalizeHybridRuntimeReasonerSelectionFlags({
      gemmaPreferred: true,
      latestRunUsedGemma: true,
      localReasonerPreferred: false,
    }),
    {
      memoryStabilityLocalReasonerPreferred: false,
      localReasonerPreferred: false,
      latestRunUsedMemoryStabilityReasoner: true,
      latestRunUsedLocalReasoner: true,
    }
  );

  const ledgerSource = fs.readFileSync(path.join(rootDir, "src", "ledger.js"), "utf8");
  assert.doesNotMatch(ledgerSource, /openneed-memory-engine-compat/u);
  assert.doesNotMatch(ledgerSource, /openneedPreferred/u);
  assert.doesNotMatch(ledgerSource, /latestRunUsedOpenNeed/u);
  assert.doesNotMatch(ledgerSource, /gemmaPreferred/u);
  assert.doesNotMatch(ledgerSource, /latestRunUsedGemma/u);
});

test("agent-readable positioning seeds do not promote legacy OpenNeed product copy", () => {
  const protocol = buildProtocolDescriptor();
  assert.match(protocol.productPositioning.oneLiner, /agent-passport/u);
  assert.doesNotMatch(protocol.productPositioning.oneLiner, /OpenNeed 记忆稳态引擎/u);

  const sharedMemoryText = SHARED_CANONICAL_MEMORIES.map((entry) => `${entry.title}\n${entry.content}`).join("\n");
  assert.match(sharedMemoryText, /agent-passport/u);
  assert.doesNotMatch(sharedMemoryText, /OpenNeed 记忆稳态引擎/u);
});

test("protocol descriptor keeps the default public contract canonical-only and moves legacy aliases behind explicit compatibility expansion", () => {
  const protocol = buildProtocolDescriptor();
  const compatProtocol = buildProtocolDescriptor({ includeCompatibility: true });
  const publicProtocolJson = JSON.stringify(protocol);
  const credentialDescriptors = Object.values(protocol.types.credentials || {});
  const compatCredentialDescriptors = Object.values(compatProtocol.compatibility?.types?.credentials || {});
  const migration = protocol.protocol?.migration || {};
  const compatibility = compatProtocol.compatibility || {};
  const descriptorNodes = [];
  const compatibilityDescriptorNodes = [];
  const collectDescriptors = (node, bucket) => {
    if (!node || typeof node !== "object") {
      return;
    }
    if (typeof node.canonical === "string") {
      bucket.push(node);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") {
        collectDescriptors(value, bucket);
      }
    }
  };

  collectDescriptors(protocol.types, descriptorNodes);
  collectDescriptors(compatibility.types, compatibilityDescriptorNodes);

  assert.equal(protocol.protocol.name, "agent-passport");
  assert.equal(protocol.protocol.slug, "agent-passport");
  assert.equal(protocol.types.did.method.active, "agentpassport");
  assert.deepEqual(protocol.types.did.method.supported, ["agentpassport"]);
  assert.deepEqual(protocol.types.did.method.resolvable, ["agentpassport"]);
  assert.deepEqual(protocol.types.did.method.signable, ["agentpassport"]);
  assert.equal(protocol.types.did.method.methods.agentpassport.note.includes("agent-passport"), true);
  assert.equal(migration.defaultIssuerDidMethod, "agentpassport");
  assert.deepEqual(migration.signableDidMethods, ["agentpassport"]);
  assert.deepEqual(migration.resolvableDidMethods, ["agentpassport"]);
  assert.equal("compatibility" in protocol, false);
  assert.equal("compatibility" in protocol.types.did.method, false);
  assert.equal("openneed" in protocol.types.did.method.methods, false);
  assert.doesNotMatch(publicProtocolJson, /openneed|OpenNeed/u);
  assert.doesNotMatch(protocol.types.did.signingMethod.purpose, /OpenNeed memory-engine/u);
  assert.equal(credentialDescriptors.length > 0, true);
  assert.equal(descriptorNodes.length > 0, true);
  assert.equal(credentialDescriptors.every((descriptor) => descriptor.canonical.startsWith("AgentPassport")), true);
  assert.equal(
    descriptorNodes.every((descriptor) => !("legacy" in descriptor) && !("aliases" in descriptor)),
    true
  );
  assert.equal(
    descriptorNodes.every((descriptor) => !/^OpenNeed/u.test(descriptor.canonical)),
    true
  );

  assert.deepEqual(compatibility.did?.method?.legacyDidMethods, ["openneed"]);
  assert.equal(compatibility.did?.method?.methods?.openneed?.resolvable, true);
  assert.equal(compatibility.did?.method?.methods?.openneed?.signable, false);
  assert.equal(compatibility.did?.method?.methods?.openneed?.compatibilitySignable, true);
  assert.equal(compatibility.migration?.previewDidMethod, "openneed");
  assert.deepEqual(compatibility.migration?.compatibilitySignableDidMethods, ["openneed"]);
  assert.deepEqual(compatibility.migration?.compatibilityResolvableDidMethods, ["openneed"]);
  assert.equal(compatibilityDescriptorNodes.length > 0, true);
  assert.equal(
    compatibilityDescriptorNodes.every((descriptor) => !/^OpenNeed/u.test(descriptor.canonical)),
    true
  );
  assert.equal(
    compatibilityDescriptorNodes.every((descriptor) =>
      !("legacy" in descriptor) || (descriptor.legacy || []).every((legacyName) => legacyName.startsWith("OpenNeed"))
    ),
    true
  );
  assert.equal(
    compatCredentialDescriptors.every((descriptor) =>
      (descriptor.legacy || []).every((legacyName) => legacyName.startsWith("OpenNeed"))
    ),
    true
  );
});

test("did method normalization keeps legacy compat input but does not widen the public issuer boundary", () => {
  assert.equal(normalizeDidMethod("agentpassport"), "agentpassport");
  assert.equal(normalizeDidMethod(" OpenNeed "), "openneed");
  assert.equal(normalizeDidMethod("did:key"), "agentpassport");
  assert.equal(normalizeDidMethod("did:key", null), null);
});

test("unsupported did references stay parseable without being projected into supported aliases", () => {
  const unsupportedDid = "did:web:example.com:agent_main";
  const parsed = parseDidReference(unsupportedDid);

  assert.equal(parsed?.method, "web");
  assert.equal(parsed?.chainId, "example.com");
  assert.equal(parsed?.agentComponent, "agent_main");
  assert.deepEqual(inferDidAliases(unsupportedDid), [unsupportedDid]);
});

test("legacy did references still expand into canonical and compat aliases", () => {
  const legacyDid = "did:openneed:agent-passport-alpha:agent_main";

  assert.deepEqual(inferDidAliases(legacyDid), [
    deriveDid("agent-passport-alpha", "agent_main", "agentpassport"),
    deriveDid("agent-passport-alpha", "agent_main", "openneed"),
  ]);
});

test("did document preserves unsupported dids until an explicit supported override is requested", () => {
  const unsupportedDid = "did:web:example.com:agent_main";
  const agent = {
    agentId: "agent_main",
    displayName: "Main Agent",
    identity: {
      did: unsupportedDid,
      walletAddress: "0x1111111111111111111111111111111111111111",
      authorizationPolicy: {
        signers: [
          {
            label: "Kane",
            walletAddress: "0x1111111111111111111111111111111111111111",
          },
        ],
      },
    },
  };

  const unsupportedDoc = buildDidDocument(agent);
  assert.equal(unsupportedDoc.id, unsupportedDid);
  assert.deepEqual(unsupportedDoc.equivalentId, []);

  const canonicalDoc = buildDidDocument(agent, { method: "agentpassport" });
  assert.equal(canonicalDoc.id, deriveDid("example.com", "agent_main", "agentpassport"));
  assert.deepEqual(canonicalDoc.equivalentId, [unsupportedDid]);
});

test("backend public naming guard blocks legacy OpenNeed defaults outside compatibility layers", () => {
  const sources = {
    "src/reasoner.js": fs.readFileSync(path.join(rootDir, "src/reasoner.js"), "utf8"),
    "src/ledger.js": fs.readFileSync(path.join(rootDir, "src/ledger.js"), "utf8"),
    "src/protocol.js": fs.readFileSync(path.join(rootDir, "src/protocol.js"), "utf8"),
    "src/identity.js": fs.readFileSync(path.join(rootDir, "src/identity.js"), "utf8"),
    "scripts/verify-memory-homeostasis.mjs": fs.readFileSync(
      path.join(rootDir, "scripts/verify-memory-homeostasis.mjs"),
      "utf8"
    ),
    "scripts/build-mempalace-live.mjs": fs.readFileSync(
      path.join(rootDir, "scripts/build-mempalace-live.mjs"),
      "utf8"
    ),
    "scripts/verify-mempalace-remote-reasoner.mjs": fs.readFileSync(
      path.join(rootDir, "scripts/verify-mempalace-remote-reasoner.mjs"),
      "utf8"
    ),
  };

  const forbiddenByFile = {
    "src/reasoner.js": ["OpenNeed reasoning assistant", "OpenNeed memory-engine reasoner"],
    "src/ledger.js": ["OpenNeed 记忆稳态轻量探针", "OpenNeed 优先"],
    "src/protocol.js": ["OpenNeed memory-engine"],
    "src/identity.js": ["OpenNeed memory-engine signing master secret"],
    "scripts/verify-memory-homeostasis.mjs": ['modelName: "OpenNeed"'],
    "scripts/build-mempalace-live.mjs": [
      '"openneed-runtime"',
      '"openneed_memory_homeostasis_engine"',
      '"openneed-sidecar-palace"',
      '"--agent", "OpenNeed"',
    ],
    "scripts/verify-mempalace-remote-reasoner.mjs": ['model: "OpenNeed-remote-probe"'],
  };

  for (const [relativePath, forbiddenList] of Object.entries(forbiddenByFile)) {
    for (const forbidden of forbiddenList) {
      assert.equal(
        sources[relativePath].includes(forbidden),
        false,
        `${relativePath} should not expose legacy OpenNeed default: ${forbidden}`
      );
    }
  }
});

test("memory stability local reasoner prefers canonical engine env names before legacy aliases", () => {
  const source = fs.readFileSync(path.join(rootDir, "scripts", "memory-stability-local-reasoner.mjs"), "utf8");
  const reasonerSource = fs.readFileSync(path.join(rootDir, "src", "reasoner.js"), "utf8");

  assert.match(
    source,
    /process\.env\.MEMORY_STABILITY_OLLAMA_BASE_URL[\s\S]*process\.env\.MEMORY_STABILITY_LOCAL_LLM_BASE_URL[\s\S]*process\.env\.AGENT_PASSPORT_OLLAMA_BASE_URL[\s\S]*process\.env\.OPENNEED_LOCAL_GEMMA_BASE_URL/u
  );
  assert.match(
    source,
    /process\.env\.MEMORY_STABILITY_OLLAMA_MODEL[\s\S]*process\.env\.MEMORY_STABILITY_LOCAL_LLM_MODEL[\s\S]*process\.env\.AGENT_PASSPORT_OLLAMA_MODEL[\s\S]*process\.env\.OPENNEED_LOCAL_GEMMA_MODEL/u
  );
  assert.match(source, /MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL/u);
  assert.doesNotMatch(source, /OPENNEED_REASONER_BRAND/u);
  assert.match(
    reasonerSource,
    /process\.env\.MEMORY_STABILITY_OLLAMA_BASE_URL[\s\S]*process\.env\.MEMORY_STABILITY_LOCAL_LLM_BASE_URL[\s\S]*process\.env\.AGENT_PASSPORT_OLLAMA_BASE_URL[\s\S]*process\.env\.OPENNEED_LOCAL_GEMMA_BASE_URL/u
  );
  assert.match(
    reasonerSource,
    /process\.env\.MEMORY_STABILITY_OLLAMA_MODEL[\s\S]*process\.env\.MEMORY_STABILITY_LOCAL_LLM_MODEL[\s\S]*process\.env\.AGENT_PASSPORT_OLLAMA_MODEL[\s\S]*process\.env\.OPENNEED_LOCAL_GEMMA_MODEL/u
  );
  assert.match(
    reasonerSource,
    /process\.env\.MEMORY_STABILITY_OLLAMA_TIMEOUT_MS[\s\S]*process\.env\.MEMORY_STABILITY_LOCAL_LLM_TIMEOUT_MS[\s\S]*process\.env\.AGENT_PASSPORT_OLLAMA_TIMEOUT_MS[\s\S]*process\.env\.OPENNEED_LOCAL_LLM_TIMEOUT_MS/u
  );
});

test("repair hub reuses shared main-agent compat helpers instead of duplicating public truth", () => {
  const repairHubSource = fs.readFileSync(path.join(rootDir, "public", "repair-hub.html"), "utf8");
  const linksSource = fs.readFileSync(path.join(rootDir, "public", "ui-links.js"), "utf8");

  assert.match(linksSource, /const CANONICAL_MAIN_AGENT_LABEL = "主控 Agent（canonical）";/u);
  assert.match(linksSource, /const LEGACY_PHYSICAL_MAIN_AGENT_LABEL = "主控 Agent（legacy physical）";/u);
  assert.match(linksSource, /function humanizeMainAgentEntityLabel/u);
  assert.match(linksSource, /function normalizeMainAgentEntityFilter/u);
  assert.match(repairHubSource, /const DEFAULT_AGENT_ID = linkHelpers\.CANONICAL_MAIN_AGENT_ID \|\| "agent_main";/u);
  assert.match(
    repairHubSource,
    /const LEGACY_PHYSICAL_MAIN_AGENT_ID = linkHelpers\.LEGACY_PHYSICAL_MAIN_AGENT_ID \|\| "agent_openneed_agents";/u
  );
  assert.match(
    repairHubSource,
    /const CANONICAL_MAIN_AGENT_LABEL = linkHelpers\.CANONICAL_MAIN_AGENT_LABEL \|\| "主控 Agent（canonical）";/u
  );
  assert.match(repairHubSource, /humanizeSharedMainAgentEntityLabel/u);
  assert.match(repairHubSource, /normalizeSharedMainAgentEntityFilter/u);
  assert.doesNotMatch(repairHubSource, /agent_main: CANONICAL_MAIN_AGENT_LABEL/u);
  assert.doesNotMatch(repairHubSource, /\[LEGACY_PHYSICAL_MAIN_AGENT_LABEL\]: DEFAULT_AGENT_ID/u);
});

test("repair hub link helpers canonicalize legacy main-agent filters onto canonical route ids", () => {
  const links = loadPublicLinkHelpers();
  const parsed = links.parseRepairHubSearch(
    "?agentId=agent_openneed_agents&issuerAgentId=agent_openneed_agents&limit=7",
    {
      agentId: CANONICAL_MAIN_AGENT_ID,
      issuerAgentId: "",
      limit: 5,
      offset: 0,
    }
  );
  const built = links.buildRepairHubSearch({
    agentId: LEGACY_MAIN_AGENT_ID,
    issuerAgentId: LEGACY_MAIN_AGENT_ID,
    limit: 7,
  });

  assert.equal(parsed.agentId, CANONICAL_MAIN_AGENT_ID);
  assert.equal(parsed.issuerAgentId, CANONICAL_MAIN_AGENT_ID);
  assert.equal(parsed.limit, 7);
  assert.equal(built.get("agentId"), CANONICAL_MAIN_AGENT_ID);
  assert.equal(built.get("issuerAgentId"), CANONICAL_MAIN_AGENT_ID);
  assert.equal(links.CANONICAL_MAIN_AGENT_ID, CANONICAL_MAIN_AGENT_ID);
  assert.equal(links.LEGACY_PHYSICAL_MAIN_AGENT_ID, LEGACY_MAIN_AGENT_ID);
  assert.equal(links.humanizeMainAgentEntityLabel(CANONICAL_MAIN_AGENT_ID), "主控 Agent（canonical）");
  assert.equal(links.humanizeMainAgentEntityLabel(LEGACY_MAIN_AGENT_ID), "主控 Agent（legacy physical）");
  assert.equal(links.normalizeMainAgentEntityFilter("主控 Agent（legacy physical）"), CANONICAL_MAIN_AGENT_ID);
});

test("fresh store bootstrap metadata reports canonical main-agent id and current physical owner without widening compatibility", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-bootstrap-main-agent-binding-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("bootstrap-main-agent-binding")}`);
        const store = await ledger.loadStore();
        const bootstrapAgentsEvent = (Array.isArray(store.events) ? store.events : []).find(
          (entry) => entry?.type === "bootstrap_agents"
        );

        assert.ok(bootstrapAgentsEvent, "fresh store should emit bootstrap_agents");
        assert.equal(Boolean(store.agents.agent_main), true);
        assert.equal(Boolean(store.agents.agent_openneed_agents), false);
        assert.equal(bootstrapAgentsEvent.payload?.canonicalMainAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(bootstrapAgentsEvent.payload?.currentPhysicalMainAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(bootstrapAgentsEvent.payload?.legacyCompatibleMainAgentId, LEGACY_MAIN_AGENT_ID);
        assert.deepEqual(bootstrapAgentsEvent.payload?.agents, ["agent_treasury", CANONICAL_MAIN_AGENT_ID]);
        assert.equal(
          bootstrapAgentsEvent.payload?.mainAgentIdentityOwnerBinding?.currentPhysicalAgentId,
          CANONICAL_MAIN_AGENT_ID
        );
        assert.equal(
          bootstrapAgentsEvent.payload?.mainAgentIdentityOwnerBinding?.resolutionByRequestedAgentId?.agent_main?.resolvedAgentId,
          CANONICAL_MAIN_AGENT_ID
        );
        assert.equal(
          bootstrapAgentsEvent.payload?.mainAgentIdentityOwnerBinding?.resolutionByRequestedAgentId?.agent_openneed_agents?.resolvedAgentId,
          CANONICAL_MAIN_AGENT_ID
        );
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("runtime summaries expose memory stability canonical local reasoner fields", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-runtime-naming-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const legacyLedgerPath = path.join(tmpDir, "legacy-ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
        OPENNEED_LEDGER_PATH: legacyLedgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("runtime-naming")}`);
        const deviceRuntime = await ledger.getDeviceRuntimeState();
        const summary = await ledger.getAgentRuntimeSummary("agent_openneed_agents", {
          didMethod: "agentpassport",
        });
        const bridgeSummary = await ledger.getAgentRuntimeSummary("agent_openneed_agents", {
          didMethod: "agentpassport",
          profile: "bridge",
        });

        assert.equal(fs.existsSync(ledgerPath), true);
        assert.equal(fs.existsSync(legacyLedgerPath), false);
        assert.equal(deviceRuntime.memoryHomeostasis.activeModelName, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
        assert.equal(summary.hybridRuntime.preferredModel, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
        assert.equal(summary.hybridRuntime.defaultPreferredModel, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
        assert.equal(summary.hybridRuntime.memoryStabilityLocalReasonerPreferred, true);
        assert.equal(summary.hybridRuntime.localReasonerPreferred, true);
        assert.equal("legacyAliases" in summary.hybridRuntime, false);
        assert.equal(bridgeSummary.hybridRuntime.memoryStabilityLocalReasonerPreferred, true);
        assert.equal(bridgeSummary.hybridRuntime.localReasonerPreferred, true);
        assert.equal("legacyAliases" in bridgeSummary.hybridRuntime, false);
        assert.match(summary.hybridRuntime.fallback.policy, /记忆稳态引擎/u);
        assert.doesNotMatch(summary.hybridRuntime.fallback.policy, /OpenNeed/u);
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("canonical main agent alias resolves to the current physical store key without splitting data", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-main-agent-alias-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("main-agent-alias")}`);

        const legacyIdentity = await ledger.resolveAgentIdentity({ agentId: LEGACY_MAIN_AGENT_ID });
        const canonicalIdentity = await ledger.resolveAgentIdentity({ agentId: CANONICAL_MAIN_AGENT_ID });
        const snapshot = await ledger.recordTaskSnapshot(CANONICAL_MAIN_AGENT_ID, {
          objective: "验证 canonical 主 Agent 别名",
        });
        const memory = await ledger.writePassportMemory(CANONICAL_MAIN_AGENT_ID, {
          layer: "profile",
          kind: "canonical_alias_probe",
          summary: "canonical alias probe",
          payload: {
            field: "canonical_alias_probe",
            value: "ok",
          },
        });
        const canonicalSummary = await ledger.getAgentRuntimeSummary(CANONICAL_MAIN_AGENT_ID, {
          didMethod: "agentpassport",
        });
        const legacySummary = await ledger.getAgentRuntimeSummary(LEGACY_MAIN_AGENT_ID, {
          didMethod: "agentpassport",
        });
        const canonicalMemories = await ledger.listPassportMemories(CANONICAL_MAIN_AGENT_ID, {
          limit: 20,
          includeInactive: true,
        });
        const legacyMemories = await ledger.listPassportMemories(LEGACY_MAIN_AGENT_ID, {
          limit: 20,
          includeInactive: true,
        });
        const store = await ledger.loadStore();
        const canonicalProbeFromCanonical = canonicalMemories.memories.find(
          (entry) => entry?.payload?.field === "canonical_alias_probe"
        );
        const canonicalProbeFromLegacy = legacyMemories.memories.find(
          (entry) => entry?.payload?.field === "canonical_alias_probe"
        );

        assert.equal(canonicalIdentity.agentId, legacyIdentity.agentId);
        assert.equal(canonicalIdentity.agentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(snapshot.agentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(memory.agentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(canonicalSummary.memory.totalPassportMemories, legacySummary.memory.totalPassportMemories);
        assert.ok(canonicalProbeFromCanonical);
        assert.ok(canonicalProbeFromLegacy);
        assert.equal(canonicalProbeFromCanonical.passportMemoryId, canonicalProbeFromLegacy.passportMemoryId);
        assert.equal(canonicalProbeFromLegacy.agentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(Boolean(store.agents.agent_main), true);
        assert.equal(store.agents.agent_openneed_agents, undefined);
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("canonical resident input resolves onto the current physical main-agent owner", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-main-agent-resident-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("main-agent-resident")}`);

        await ledger.loadStore();
        const configured = await ledger.configureDeviceRuntime({
          residentAgentId: "agent_main",
          residentDidMethod: "agentpassport",
          residentLocked: false,
          localMode: "local_only",
          allowOnlineReasoner: false,
          localReasonerEnabled: true,
          localReasonerProvider: "local_mock",
          retrievalStrategy: "local_first_non_vector",
          allowVectorIndex: false,
        });
        const runtimeAfterConfigure = await ledger.getDeviceRuntimeState();
        const canonicalIdentity = await ledger.resolveAgentIdentity({ agentId: "agent_main" });
        const legacyIdentity = await ledger.resolveAgentIdentity({ agentId: "agent_openneed_agents" });

        await ledger.bootstrapAgentRuntime(
          "agent_main",
          {
            displayName: "Agent Passport Resident Alias Test",
            role: "runtime agent",
            longTermGoal: "verify canonical resident resolution",
            currentGoal: "verify canonical resident configure/bootstrap path",
            currentPlan: ["configure runtime", "claim resident", "check physical owner"],
            nextAction: "validate resident owner",
            claimResidentAgent: true,
            allowResidentRebind: true,
            dryRun: false,
          },
          { didMethod: "agentpassport" }
        );
        const runtimeAfterBootstrap = await ledger.getDeviceRuntimeState();

        assert.equal(configured.deviceRuntime?.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(configured.deviceRuntime?.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(configured.deviceRuntime?.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(configured.deviceRuntime?.residentAgent?.agentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(configured.deviceRuntime?.residentAgent?.referenceAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(runtimeAfterConfigure.deviceRuntime?.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(runtimeAfterConfigure.deviceRuntime?.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(runtimeAfterConfigure.deviceRuntime?.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(runtimeAfterConfigure.deviceRuntime?.residentAgent?.agentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(runtimeAfterConfigure.deviceRuntime?.residentAgent?.referenceAgentId, CANONICAL_MAIN_AGENT_ID);
        const setupStatus = await ledger.getDeviceSetupStatus();
        assert.equal(canonicalIdentity.agentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(legacyIdentity.agentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(setupStatus.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(setupStatus.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(setupStatus.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(runtimeAfterBootstrap.deviceRuntime?.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(runtimeAfterBootstrap.deviceRuntime?.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(runtimeAfterBootstrap.deviceRuntime?.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("legacy main-agent setup-package payloads stay aligned in canonical status and prune views", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-main-agent-setup-package-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");
  const archiveDir = path.join(tmpDir, "archives");

  try {
    await withEnv(
      {
        AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("main-agent-setup-package")}`);

        await ledger.loadStore();
        await ledger.configureDeviceRuntime({
          residentAgentId: "agent_main",
          residentDidMethod: "agentpassport",
          residentLocked: false,
          localMode: "local_only",
          allowOnlineReasoner: false,
          localReasonerEnabled: true,
          localReasonerProvider: "local_mock",
          retrievalStrategy: "local_first_non_vector",
          allowVectorIndex: false,
        });
        await ledger.exportStoreRecoveryBundle({
          passphrase: "canonical-setup-package-passphrase",
          dryRun: false,
          saveToFile: true,
          returnBundle: true,
        });
        const exported = await ledger.exportDeviceSetupPackage({
          note: "canonical setup package probe",
          dryRun: false,
          saveToFile: true,
          returnPackage: true,
        });
        const packagePath = exported.summary?.packagePath;
        assert.ok(packagePath, "setup package export should persist a package file");
        assert.equal(exported.summary?.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(exported.summary?.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(exported.summary?.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(exported.package?.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(exported.package?.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(exported.package?.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);

        const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        packageJson.residentAgentId = "agent_main";
        packageJson.residentAgentReference = "agent_main";
        packageJson.runtimeConfig = {
          ...(packageJson.runtimeConfig || {}),
          residentAgentId: "agent_main",
        };
        fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

        const listed = await ledger.listDeviceSetupPackages({ limit: 5 });
        const latestPackage = listed.packages.find((entry) => entry?.packageId === exported.summary?.packageId);
        assert.ok(latestPackage, "modified setup package should remain visible in listings");
        assert.equal(latestPackage.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(latestPackage.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(latestPackage.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(latestPackage.canonicalResidentBinding?.residentAgentId, "agent_main");
        assert.equal(latestPackage.canonicalResidentBinding?.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(latestPackage.canonicalResidentBinding?.resolvedResidentAgentId, "agent_main");
        assert.equal(latestPackage.resolvedResidentBinding?.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(latestPackage.resolvedResidentBinding?.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(latestPackage.resolvedResidentBinding?.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);

        const status = await ledger.getDeviceSetupStatus();
        assert.equal(status.setupPackages.packages[0]?.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(status.setupPackages.packages[0]?.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(status.setupPackages.packages[0]?.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(
          status.formalRecoveryFlow?.crossDeviceRecoveryClosure?.sourceBlockingReasons?.includes(
            "setup_package_resident_agent_mismatch"
          ),
          false
        );

        const housekeepingUrl = pathToFileURL(path.join(rootDir, "src", "runtime-housekeeping.js")).href;
        const { runRuntimeHousekeeping } = await import(
          `${housekeepingUrl}?${uniqueImportSuffix("main-agent-setup-package-housekeeping")}`
        );
        const housekeeping = await runRuntimeHousekeeping({
          apply: false,
          keepRecovery: 5,
          keepSetup: 5,
          recoveryDir,
          setupPackageDir,
          archiveDir,
          liveLedgerPath: ledgerPath,
        });
        const keptPackage = housekeeping.setupPackages.kept.find(
          (entry) => entry?.packageId === exported.summary?.packageId
        );
        assert.ok(keptPackage, "housekeeping should keep the exported setup package visible");
        assert.equal(keptPackage.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(keptPackage.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(keptPackage.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);

        const pruned = await ledger.pruneDeviceSetupPackages({
          residentAgentId: "agent_main",
          keepLatest: 0,
          dryRun: true,
        });
        assert.equal(pruned.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruned.effectivePhysicalResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruned.effectiveResidentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruned.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruned.effectiveResolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruned.counts.matched, 1);
        assert.equal(pruned.deleted[0]?.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruned.deleted[0]?.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruned.deleted[0]?.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);

        await ledger.pruneDeviceSetupPackages({
          residentAgentId: "agent_main",
          keepLatest: 0,
          dryRun: false,
        });
        const storeAfterPrune = await ledger.loadStore();
        const pruneEvent = storeAfterPrune.events.at(-1);
        assert.equal(pruneEvent?.type, "device_setup_packages_pruned");
        assert.equal(pruneEvent?.payload?.residentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruneEvent?.payload?.residentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruneEvent?.payload?.resolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruneEvent?.payload?.effectivePhysicalResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruneEvent?.payload?.effectiveResidentAgentReference, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruneEvent?.payload?.effectiveResolvedResidentAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(pruneEvent?.payload?.residentBindingMismatch, false);
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("read-session creation canonicalizes main-agent bindings onto the physical owner store key", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-main-agent-read-session-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("main-agent-read-session")}`);

        await ledger.loadStore();
        const directBinding = await ledger.createReadSession({
          role: "agent_auditor",
          agentIds: ["agent_main"],
          ttlSeconds: 300,
        });
        const nestedBinding = await ledger.createReadSession({
          role: "agent_auditor",
          resourceBindings: {
            agentIds: ["agent_main"],
          },
          ttlSeconds: 300,
        });

        assert.deepEqual(directBinding.session.resourceBindings.agentIds, [CANONICAL_MAIN_AGENT_ID]);
        assert.deepEqual(nestedBinding.session.resourceBindings.agentIds, [CANONICAL_MAIN_AGENT_ID]);
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fresh canonical main-agent read-session binding stays on the current physical owner", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-main-agent-physical-owner-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        AGENT_PASSPORT_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
      },
      async () => {
        const ledgerUrl = pathToFileURL(path.join(rootDir, "src", "ledger.js")).href;
        const ledger = await import(`${ledgerUrl}?${uniqueImportSuffix("main-agent-physical-owner")}`);

        await ledger.loadStore();

        const beforeMigrationSession = await ledger.createReadSession({
          role: "agent_auditor",
          agentIds: ["agent_main"],
          ttlSeconds: 300,
        });
        assert.deepEqual(beforeMigrationSession.session.resourceBindings.agentIds, [CANONICAL_MAIN_AGENT_ID]);

        const preview = await ledger.previewMainAgentCanonicalPhysicalMigration({
          includeArchiveAudit: false,
        });
        assert.equal(preview.currentPhysicalAgentId, CANONICAL_MAIN_AGENT_ID);
        assert.equal(preview.status, "already_canonical");
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

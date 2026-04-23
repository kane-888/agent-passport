import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AGENT_PASSPORT_LOCAL_REASONER_LABEL,
  AGENT_PASSPORT_MEMORY_ENGINE_LABEL,
  LEGACY_OPENNEED_MEMORY_ENGINE_NAME,
  LEGACY_OPENNEED_REASONER_BRAND,
  OPENNEED_LAB_TITLE,
  OPENNEED_MAIN_CONSOLE_TITLE,
  OPENNEED_OFFLINE_CHAT_TITLE,
  OPENNEED_REASONER_OLLAMA_MODEL,
  OPENNEED_REPAIR_HUB_TITLE,
  displayOpenNeedReasonerModel,
  resolveOpenNeedReasonerModel,
} from "../src/openneed-memory-engine.js";
import { SHARED_CANONICAL_MEMORIES } from "../src/offline-chat-shared-memory.js";
import { buildProtocolDescriptor } from "../src/protocol.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let importCounter = 0;

function uniqueImportSuffix(label) {
  importCounter += 1;
  return `${label}-${process.pid}-${Date.now()}-${importCounter}`;
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

test("memory engine naming accepts legacy inputs but displays agent-passport", () => {
  assert.equal(resolveOpenNeedReasonerModel(LEGACY_OPENNEED_REASONER_BRAND), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(resolveOpenNeedReasonerModel(LEGACY_OPENNEED_MEMORY_ENGINE_NAME), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(resolveOpenNeedReasonerModel(AGENT_PASSPORT_LOCAL_REASONER_LABEL), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(resolveOpenNeedReasonerModel(AGENT_PASSPORT_MEMORY_ENGINE_LABEL), OPENNEED_REASONER_OLLAMA_MODEL);
  assert.equal(displayOpenNeedReasonerModel(LEGACY_OPENNEED_REASONER_BRAND), AGENT_PASSPORT_LOCAL_REASONER_LABEL);
  assert.equal(displayOpenNeedReasonerModel(OPENNEED_REASONER_OLLAMA_MODEL), AGENT_PASSPORT_LOCAL_REASONER_LABEL);
});

test("legacy title exports resolve to public agent-passport copy", () => {
  assert.equal(OPENNEED_MAIN_CONSOLE_TITLE, AGENT_PASSPORT_MEMORY_ENGINE_LABEL);
  assert.equal(OPENNEED_OFFLINE_CHAT_TITLE, `${AGENT_PASSPORT_MEMORY_ENGINE_LABEL}离线聊天`);
  assert.equal(OPENNEED_LAB_TITLE, `${AGENT_PASSPORT_MEMORY_ENGINE_LABEL} 高级工具页`);
  assert.equal(OPENNEED_REPAIR_HUB_TITLE, `${AGENT_PASSPORT_MEMORY_ENGINE_LABEL} 修复中心`);
});

test("agent-readable positioning seeds do not promote legacy OpenNeed product copy", () => {
  const protocol = buildProtocolDescriptor();
  assert.match(protocol.productPositioning.oneLiner, /agent-passport/u);
  assert.doesNotMatch(protocol.productPositioning.oneLiner, /OpenNeed 记忆稳态引擎/u);

  const sharedMemoryText = SHARED_CANONICAL_MEMORIES.map((entry) => `${entry.title}\n${entry.content}`).join("\n");
  assert.match(sharedMemoryText, /agent-passport/u);
  assert.doesNotMatch(sharedMemoryText, /OpenNeed 记忆稳态引擎/u);
});

test("protocol descriptor keeps agent-passport canonical names and legacy aliases separate", () => {
  const protocol = buildProtocolDescriptor();
  const credentialDescriptors = Object.values(protocol.types.credentials || {});

  assert.equal(protocol.protocol.name, "agent-passport");
  assert.equal(protocol.protocol.slug, "agent-passport");
  assert.equal(protocol.types.did.method.methods.agentpassport.note.includes("agent-passport"), true);
  assert.doesNotMatch(protocol.types.did.signingMethod.purpose, /OpenNeed memory-engine/u);
  assert.equal(credentialDescriptors.length > 0, true);
  assert.equal(credentialDescriptors.every((descriptor) => descriptor.canonical.startsWith("AgentPassport")), true);
  assert.equal(
    credentialDescriptors.every((descriptor) =>
      (descriptor.legacy || []).every((legacyName) => legacyName.startsWith("OpenNeed"))
    ),
    true
  );
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

test("runtime summaries expose agent-passport canonical local reasoner fields", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-runtime-naming-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");

  try {
    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
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

        assert.equal(deviceRuntime.memoryHomeostasis.activeModelName, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
        assert.equal(summary.hybridRuntime.preferredModel, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
        assert.equal(summary.hybridRuntime.defaultPreferredModel, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
        assert.equal(summary.hybridRuntime.agentPassportLocalReasonerPreferred, true);
        assert.equal(summary.hybridRuntime.localReasonerPreferred, true);
        assert.equal(
          summary.hybridRuntime.openneedPreferred,
          summary.hybridRuntime.agentPassportLocalReasonerPreferred,
          "legacy alias should mirror the canonical field"
        );
        assert.match(summary.hybridRuntime.fallback.policy, /agent-passport/u);
        assert.doesNotMatch(summary.hybridRuntime.fallback.policy, /OpenNeed/u);
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

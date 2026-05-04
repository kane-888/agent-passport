import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-memory-stability-kernel-"));
const previousEnv = {
  AGENT_PASSPORT_LEDGER_PATH: process.env.AGENT_PASSPORT_LEDGER_PATH,
  AGENT_PASSPORT_STORE_KEY_PATH: process.env.AGENT_PASSPORT_STORE_KEY_PATH,
  AGENT_PASSPORT_USE_KEYCHAIN: process.env.AGENT_PASSPORT_USE_KEYCHAIN,
  AGENT_PASSPORT_MEMORY_STABILITY_KERNEL_PREVIEW: process.env.AGENT_PASSPORT_MEMORY_STABILITY_KERNEL_PREVIEW,
  AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PREFLIGHT: process.env.AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PREFLIGHT,
  AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PRETRANSFORM:
    process.env.AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PRETRANSFORM,
  AGENT_PASSPORT_MEMORY_STABILITY_EXECUTE_SAFE_ACTIONS:
    process.env.AGENT_PASSPORT_MEMORY_STABILITY_EXECUTE_SAFE_ACTIONS,
  AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT: process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT,
};

process.env.AGENT_PASSPORT_LEDGER_PATH = path.join(tempDir, "ledger.json");
process.env.AGENT_PASSPORT_STORE_KEY_PATH = path.join(tempDir, ".ledger-key");
process.env.AGENT_PASSPORT_USE_KEYCHAIN = "0";
delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_KERNEL_PREVIEW;
delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PREFLIGHT;
delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PRETRANSFORM;
delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_EXECUTE_SAFE_ACTIONS;
delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT;

const kernel = await import(pathToFileURL(path.join(rootDir, "src", "memory-stability", "internal-kernel.js")).href);
const ledger = await import(pathToFileURL(path.join(rootDir, "src", "ledger.js")).href);
const {
  buildMemoryStabilityFormalExecutionReceipt,
  MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES,
} = await import(pathToFileURL(path.join(rootDir, "src", "memory-stability", "execution-receipts.js")).href);
const { AGENT_PASSPORT_LOCAL_REASONER_LABEL } = await import(
  pathToFileURL(path.join(rootDir, "src", "memory-engine-branding.js")).href
);

function runtimeStateFixture(overrides = {}) {
  return {
    sessionId: "kernel-session-001",
    modelName: "agent-passport-local-reasoner",
    ctxTokens: 4096,
    checkedMemories: 2,
    conflictMemories: 1,
    vT: 0.5,
    lT: 0.35,
    rPosT: 0.12,
    xT: 0.5,
    sT: 0.62,
    cT: 0.38,
    correctionLevel: "medium",
    scoreBreakdown: {
      middleAnchorRatio: 0.5,
    },
    memoryAnchors: [
      {
        memoryId: "kernel-product-boundary",
        content: "This private raw memory must never appear in the kernel preview.",
        importanceWeight: 3,
        insertedPosition: "tail",
        lastVerifiedAt: "2026-04-23T16:00:00.000Z",
        lastVerifiedOk: true,
        authorityRank: 0.9,
      },
      {
        memoryId: "kernel-migration-scope",
        content: "Another private raw memory belongs only in the local runtime state.",
        importanceWeight: 2,
        insertedPosition: "middle",
        lastVerifiedAt: "2026-04-23T16:00:01.000Z",
        lastVerifiedOk: false,
        authorityRank: 0.8,
        conflictState: {
          hasConflict: true,
        },
      },
    ],
    activeProbe: {
      rawResponseText: "raw probe transcript must not leak into memory stability kernel output",
    },
    ...overrides,
  };
}

function normalizeCompiledPromptForDeterminism(prompt = "") {
  return String(prompt)
    .replace(/mprof_[a-z0-9]+/giu, "mprof_redacted")
    .replace(/rstate_[a-z0-9]+/giu, "rstate_redacted");
}

after(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await rm(tempDir, { recursive: true, force: true });
});

test("memory stability internal kernel is disabled unless explicitly enabled", async () => {
  assert.equal(kernel.isMemoryStabilityKernelEnabled({}), false);
  assert.equal(kernel.isMemoryStabilityKernelEnabled({ memoryStabilityKernelPreview: "maybe" }), false);
  assert.equal(kernel.isMemoryStabilityKernelEnabled({ memoryStability: { kernelPreview: "nope" } }), false);
  assert.equal(kernel.isMemoryStabilityKernelEnabled({ memoryStabilityKernelPreview: true }), true);
  assert.equal(
    kernel.isMemoryStabilityKernelEnabled({}, { AGENT_PASSPORT_MEMORY_STABILITY_KERNEL_PREVIEW: "1" }),
    true
  );
  assert.equal(kernel.isMemoryStabilitySafeCorrectionExecutionEnabled({}), false);
  assert.equal(kernel.isMemoryStabilitySafeCorrectionExecutionEnabled({ memoryStabilityExecuteSafeActions: true }), true);
  assert.equal(
    kernel.isMemoryStabilitySafeCorrectionExecutionEnabled(
      {},
      { AGENT_PASSPORT_MEMORY_STABILITY_EXECUTE_SAFE_ACTIONS: "1" }
    ),
    true
  );

  const disabled = await kernel.buildMemoryStabilityKernelPreview({
    runtimeState: runtimeStateFixture(),
    enabled: false,
  });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.effects.ledgerWritten, false);
});

test("memory stability internal kernel builds a hash-only preview and product adapter receipt", async () => {
  const preview = await kernel.buildMemoryStabilityKernelPreview({
    runtimeState: runtimeStateFixture(),
    provider: "agent-passport-local",
    createdAt: "2026-04-23T16:01:00.000Z",
    runId: "run_kernel_preview_001",
    enabled: true,
    includeCorrectionEventPreview: true,
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.status, "ready");
  assert.equal(preview.effects.modelCalled, false);
  assert.equal(preview.effects.networkCalled, false);
  assert.equal(preview.effects.ledgerWritten, false);
  assert.equal(preview.effects.promptMutated, false);
  assert.equal(preview.snapshot.privacy.raw_content_persisted, false);
  assert.equal(preview.snapshot.runtime_state.memory_anchors.length, 2);
  assert.equal(preview.snapshot.runtime_state.memory_anchors.every((anchor) => anchor.content_redaction === "hash_only"), true);
  assert.equal(JSON.stringify(preview).includes("private raw memory"), false);
  assert.equal(JSON.stringify(preview).includes("raw probe transcript"), false);
  assert.equal(preview.correctionEventPreview.execution.actor_type, "product_adapter");
  assert.equal(preview.correctionEventPreview.execution.preflight.loader_verified, true);
  assert.equal(preview.correctionEventPreview.execution.idempotency_replay.side_effect_count, 0);
  assert.equal(preview.correctionEventPreview.execution.privacy_rollback.raw_payload_scan_passed, true);
  assert.equal(preview.controlledAdapter?.execute, false);
  assert.equal(preview.controlledAdapter?.executionStatus, "skipped");
  assert.equal(preview.boundaries.correctionExecution, "preview_only");
});

test("memory stability internal kernel can execute safe non-store correction actions under an explicit flag", async () => {
  const preview = await kernel.buildMemoryStabilityKernelPreview({
    runtimeState: runtimeStateFixture(),
    provider: "agent-passport-local",
    createdAt: "2026-04-23T16:01:10.000Z",
    runId: "run_kernel_safe_execute_001",
    enabled: true,
    executeSafeActions: true,
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.status, "ready");
  assert.equal(preview.effects.modelCalled, false);
  assert.equal(preview.effects.networkCalled, false);
  assert.equal(preview.effects.ledgerWritten, false);
  assert.equal(preview.effects.storeWritten, false);
  assert.equal(preview.effects.promptMutated, false);
  assert.equal(preview.effects.correctionExecuted, true);
  assert.equal(preview.boundaries.correctionExecution, "safe_non_store_completed");
  assert.equal(preview.controlledAdapter?.execute, true);
  assert.equal(preview.controlledAdapter?.completedActionCount > 0, true);
  assert.equal(preview.controlledAdapter?.skippedActionCount, 0);
  assert.equal(preview.controlledAdapter?.executionStatus, "completed");
  assert.equal(preview.correctionEventPreview.execution.status, "completed");
  assert.equal(preview.correctionEventPreview.execution.actions.every((action) => action.status === "completed"), true);
  assert.equal(preview.correctionEventPreview.execution.authoritative_store_mutated, false);
});

test("memory stability prompt preflight is explicit and never mutates prompt or stores", async () => {
  assert.equal(kernel.isMemoryStabilityPromptPreflightEnabled({}), false);
  assert.equal(kernel.isMemoryStabilityPromptPreflightEnabled({ memoryStabilityPromptPreflight: true }), true);
  assert.equal(
    kernel.isMemoryStabilityPromptPreflightEnabled(
      {},
      { AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PREFLIGHT: "1" }
    ),
    true
  );

  const disabled = await kernel.buildMemoryStabilityPromptPreflight({
    runtimeState: runtimeStateFixture(),
    enabled: false,
  });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.effects.promptMutated, false);

  const preflight = await kernel.buildMemoryStabilityPromptPreflight({
    runtimeState: runtimeStateFixture(),
    provider: "agent-passport-local",
    createdAt: "2026-04-23T16:01:30.000Z",
    runId: "run_prompt_preflight_001",
    enabled: true,
  });

  assert.equal(preflight.ok, true);
  assert.equal(preflight.status, "ready");
  assert.equal(preflight.mode, "memory-stability-prompt-preflight/v1");
  assert.equal(preflight.effects.modelCalled, false);
  assert.equal(preflight.effects.networkCalled, false);
  assert.equal(preflight.effects.ledgerWritten, false);
  assert.equal(preflight.effects.storeWritten, false);
  assert.equal(preflight.effects.promptMutated, false);
  assert.equal(preflight.boundaries.rawContentPolicy, "hash_only");
  assert.equal(preflight.decision.promptMutationAllowed, true);
  assert.equal(preflight.promptTransformPlan?.mode, "prompt_local_reanchor");
  assert.equal(preflight.promptTransformPlan?.promptSafe, true);
  assert.deepEqual(preflight.promptTransformPlan?.promptActions, [
    "reanchor_key_memories_near_prompt_end",
    "raise_memory_injection_priority",
  ]);
  assert.equal(preflight.promptTransformPlan?.placementStrategy?.modelHint, "standard_reanchor_policy");
  assert.deepEqual(preflight.promptTransformPlan?.placementStrategy?.actions, ["standard_reanchor_policy"]);
  assert.equal(preflight.promptTransformPlan?.placementStrategy?.maxInjectedEstimatedTokens, 9000);
  assert.equal(
    typeof preflight.promptTransformPlan?.anchorFocus?.[0]?.contentRef,
    "string"
  );
  assert.equal(
    String(preflight.promptTransformPlan?.anchorFocus?.[0]?.contentRef || "").startsWith("[redacted:"),
    true
  );
  assert.equal(
    preflight.promptTransformPlan?.boundaries?.authoritativeReloadAllowed,
    false
  );
  assert.equal(
    preflight.promptTransformPlan?.boundaries?.correctionExecutionAllowed,
    false
  );
  assert.equal(
    preflight.promptTransformPlan?.boundaries?.runtimeConflictResolutionAllowed,
    false
  );
  assert.equal(Array.isArray(preflight.promptTransformPlan?.anchorFocus), true);
  assert.equal(preflight.promptTransformPlan?.anchorFocus?.[0]?.memoryId, "kernel-product-boundary");
  assert.equal(preflight.promptTransformPlan?.anchorFocus?.[0]?.source, "agent-passport");
  assert.equal(preflight.promptTransformPlan?.anchorFocus?.[0]?.insertedPosition, "tail");
  assert.equal(preflight.promptTransformPlan?.anchorFocus?.[0]?.importanceWeight, 3);
  assert.equal(preflight.decision?.actionCount, 4);
  assert.equal(preflight.decision?.correctionExecutionAllowed, false);
  assert.equal(preflight.adapter?.explicitExecutionRequired, true);
  assert.equal(preflight.adapter?.automaticByLoader, false);
  assert.equal(preflight.snapshot.privacy.raw_content_persisted, false);
  assert.equal(JSON.stringify(preflight).includes("private raw memory"), false);
});

test("memory stability prompt preflight keeps prompt mutation disabled for stable none-state inputs", async () => {
  const preflight = await kernel.buildMemoryStabilityPromptPreflight({
    runtimeState: runtimeStateFixture({
      sessionId: "kernel-stable-session",
      ctxTokens: 320,
      checkedMemories: 3,
      conflictMemories: 0,
      vT: 0.92,
      lT: 0.18,
      rPosT: 0.95,
      xT: 0.12,
      sT: 0.08,
      cT: 0.92,
      correctionLevel: "none",
      memoryAnchors: runtimeStateFixture().memoryAnchors.map((anchor) => ({
        ...anchor,
        lastVerifiedOk: true,
        conflictState: null,
      })),
    }),
    provider: "agent-passport-local",
    createdAt: "2026-04-23T16:01:45.000Z",
    runId: "run_prompt_preflight_stable_001",
    enabled: true,
  });

  assert.equal(preflight.ok, true);
  assert.equal(preflight.status, "ready");
  assert.equal(preflight.decision?.correctionLevel, "none");
  assert.equal(preflight.decision?.promptMutationAllowed, false);
  assert.deepEqual(preflight.promptTransformPlan?.promptActions, []);
  assert.equal(preflight.promptTransformPlan?.correctionLevel, "none");
  assert.equal(preflight.promptTransformPlan?.promptSafe, true);
});

test("memory stability internal kernel preview does not claim skipped strong reloads mutated stores", async () => {
  const preview = await kernel.buildMemoryStabilityKernelPreview({
    runtimeState: runtimeStateFixture({
      sessionId: "kernel-strong-preview-session",
      checkedMemories: 2,
      conflictMemories: 2,
      memoryAnchors: runtimeStateFixture().memoryAnchors.map((anchor) => ({
        ...anchor,
        lastVerifiedOk: false,
        conflictState: {
          hasConflict: true,
        },
      })),
    }),
    provider: "agent-passport-local",
    createdAt: "2026-04-23T16:02:00.000Z",
    runId: "run_kernel_preview_strong",
    enabled: true,
    includeCorrectionEventPreview: true,
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.correctionEventPreview.source_snapshot.correction_level, "strong");
  assert.equal(preview.boundaries.correctionExecution, "blocked_authoritative_reload");
  assert.equal(preview.formalExecutionRequest?.status, "blocked_authoritative_reload");
  assert.deepEqual(
    preview.formalExecutionRequest?.execution?.pending_formal_actions?.map((action) => action.action),
    ["reload_authoritative_memory_store", "resolve_conflicts_and_refresh_runtime_state"]
  );
  assert.equal(
    preview.correctionEventPreview.execution.actions.some(
      (action) => action.action === "reload_authoritative_memory_store" && action.status === "skipped"
    ),
    true
  );
  assert.equal(preview.correctionEventPreview.execution.authoritative_store_mutated, false);
  assert.equal(preview.effects.storeWritten, false);
});

test("memory stability internal kernel keeps strong safe actions completed while blocking authoritative reload until receipts arrive", async () => {
  const preview = await kernel.buildMemoryStabilityKernelPreview({
    runtimeState: runtimeStateFixture({
      sessionId: "kernel-strong-safe-session",
      checkedMemories: 2,
      conflictMemories: 2,
      memoryAnchors: runtimeStateFixture().memoryAnchors.map((anchor) => ({
        ...anchor,
        lastVerifiedOk: false,
        conflictState: {
          hasConflict: true,
        },
      })),
    }),
    provider: "agent-passport-local",
    createdAt: "2026-04-23T16:02:10.000Z",
    runId: "run_kernel_safe_execute_strong",
    enabled: true,
    executeSafeActions: true,
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.effects.correctionExecuted, true);
  assert.equal(preview.controlledAdapter?.execute, true);
  assert.equal(preview.controlledAdapter?.executionStatus, "partial");
  assert.equal(preview.controlledAdapter?.pendingFormalActionCount, 2);
  assert.equal(preview.boundaries.correctionExecution, "blocked_authoritative_reload");
  assert.equal(preview.formalExecutionRequest?.execution?.completed_safe_actions?.length, 4);
  assert.deepEqual(
    preview.formalExecutionRequest?.execution?.pending_formal_actions?.map((action) => action.action),
    ["reload_authoritative_memory_store", "resolve_conflicts_and_refresh_runtime_state"]
  );
});

test("memory stability internal kernel consumes formal receipts and clears the strong reload boundary", async () => {
  const previewCreatedAt = "2026-04-23T16:02:20.000Z";
  const strongRuntimeState = runtimeStateFixture({
    sessionId: "kernel-strong-safe-consume-session",
    checkedMemories: 2,
    conflictMemories: 2,
    memoryAnchors: runtimeStateFixture().memoryAnchors.map((anchor) => ({
      ...anchor,
      lastVerifiedOk: false,
      conflictState: {
        hasConflict: true,
      },
    })),
  });
  const blockedPreview = await kernel.buildMemoryStabilityKernelPreview({
    runtimeState: strongRuntimeState,
    provider: "agent-passport-local",
    createdAt: previewCreatedAt,
    runId: "run_kernel_safe_execute_strong_consume",
    enabled: true,
    executeSafeActions: true,
  });
  const adapterInvocationId = blockedPreview.formalExecutionRequest?.execution?.adapter_invocation_id;
  const receipts = [
    buildMemoryStabilityFormalExecutionReceipt({
      snapshot: blockedPreview.snapshot,
      adapterInvocationId,
      receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
      authoritativeStoreVersion: "store-version-kernel-001",
      createdAt: "2026-04-23T16:02:21.000Z",
    }),
    buildMemoryStabilityFormalExecutionReceipt({
      snapshot: blockedPreview.snapshot,
      adapterInvocationId,
      receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh,
      authoritativeStoreVersion: "store-version-kernel-001",
      createdAt: "2026-04-23T16:02:22.000Z",
    }),
  ];

  const preview = await kernel.buildMemoryStabilityKernelPreview({
    runtimeState: strongRuntimeState,
    provider: "agent-passport-local",
    createdAt: previewCreatedAt,
    runId: "run_kernel_safe_execute_strong_consume",
    enabled: true,
    executeSafeActions: true,
    formalExecutionReceipts: receipts,
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.formalExecutionRequest, null);
  assert.equal(preview.formalExecutionConsume?.status, "completed");
  assert.equal(preview.boundaries.correctionExecution, "formal_execution_completed");
  assert.equal(preview.controlledAdapter?.pendingFormalActionCount, 0);
  assert.equal(preview.controlledAdapter?.executionStatus, "completed");
  assert.equal(preview.correctionEventPreview?.execution?.status, "completed");
  assert.equal(preview.correctionEventPreview?.execution?.authoritative_store_mutated, true);
});

test("memory stability internal kernel fails closed on invalid runtime state", async () => {
  const preview = await kernel.buildMemoryStabilityKernelPreview({
    runtimeState: {
      sessionId: "kernel-empty-session",
      memoryAnchors: [],
    },
    enabled: true,
  });

  assert.equal(preview.ok, false);
  assert.equal(preview.status, "failed");
  assert.equal(preview.failClosed, true);
  assert.equal(preview.effects.ledgerWritten, false);
  assert.match(preview.error.message, /memory_anchors must not be empty/u);
});

test("memory stability internal kernel stays passive and does not materialize product stores", async () => {
  const passiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-memory-stability-kernel-passive-"));
  const ledgerPath = path.join(passiveDir, "ledger.json");
  const readSessionStorePath = path.join(passiveDir, "read-sessions.json");
  const storeKeyPath = path.join(passiveDir, ".ledger-key");
  const signingSecretPath = path.join(passiveDir, ".signing-secret");
  const previous = {
    AGENT_PASSPORT_LEDGER_PATH: process.env.AGENT_PASSPORT_LEDGER_PATH,
    AGENT_PASSPORT_READ_SESSION_STORE_PATH: process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH,
    AGENT_PASSPORT_STORE_KEY_PATH: process.env.AGENT_PASSPORT_STORE_KEY_PATH,
    AGENT_PASSPORT_SIGNING_SECRET_PATH: process.env.AGENT_PASSPORT_SIGNING_SECRET_PATH,
  };

  try {
    process.env.AGENT_PASSPORT_LEDGER_PATH = ledgerPath;
    process.env.AGENT_PASSPORT_READ_SESSION_STORE_PATH = readSessionStorePath;
    process.env.AGENT_PASSPORT_STORE_KEY_PATH = storeKeyPath;
    process.env.AGENT_PASSPORT_SIGNING_SECRET_PATH = signingSecretPath;

    const preview = await kernel.buildMemoryStabilityKernelPreview({
      runtimeState: runtimeStateFixture({
        sessionId: "kernel-passive-session",
      }),
      enabled: true,
    });

    assert.equal(preview.ok, true);
    assert.equal(fs.existsSync(ledgerPath), false);
    assert.equal(fs.existsSync(readSessionStorePath), false);
    assert.equal(fs.existsSync(storeKeyPath), false);
    assert.equal(fs.existsSync(signingSecretPath), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(passiveDir, { recursive: true, force: true });
  }
});

test("context bundle attaches prompt preflight only outside the compiled prompt", async () => {
  const preflightAgentId = "agent_main";
  await ledger.bootstrapAgentRuntime(
    preflightAgentId,
    {
      displayName: "Agent Passport Prompt Preflight Test",
      role: "runtime agent",
      longTermGoal: "verify prompt preflight stays outside the reasoner prompt",
      currentGoal: "verify prompt preflight",
      currentPlan: ["build context", "attach preflight", "keep prompt stable"],
      nextAction: "compare compiled prompts",
      claimResidentAgent: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );
  await ledger.configureDeviceRuntime({
    residentAgentId: preflightAgentId,
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });

  const payload = {
    currentGoal: "verify prompt preflight",
    query: "verify prompt preflight",
    reasonerProvider: "local_mock",
  };
  const baseline = await ledger.buildAgentContextBundle(preflightAgentId, payload, {
    didMethod: "agentpassport",
  });
  const enabled = await ledger.buildAgentContextBundle(
    preflightAgentId,
    {
      ...payload,
      memoryStabilityPromptPreflight: true,
    },
    { didMethod: "agentpassport" }
  );

  assert.equal(Object.hasOwn(baseline.memoryHomeostasis || {}, "memoryStabilityPromptPreflight"), false);
  assert.equal(Object.hasOwn(baseline.slots?.memoryHomeostasis || {}, "memoryStabilityPromptPreflight"), false);
  assert.equal(typeof baseline.compiledPrompt, "string");
  assert.equal(typeof enabled.compiledPrompt, "string");
  assert.equal(
    enabled.compiledPrompt.replace(/mprof_[a-z0-9]+/giu, "mprof_redacted"),
    baseline.compiledPrompt.replace(/mprof_[a-z0-9]+/giu, "mprof_redacted")
  );
  assert.equal(enabled.compiledPrompt.includes("memoryStabilityPromptPreflight"), false);
  assert.equal(enabled.compiledPrompt.includes("memory-stability-prompt-preflight"), false);
  assert.equal(enabled.memoryHomeostasis.memoryStabilityPromptPreflight.status, "ready");
  assert.equal(enabled.slots.memoryHomeostasis.memoryStabilityPromptPreflight.status, "ready");
  assert.equal(enabled.memoryHomeostasis.memoryStabilityPromptPreflight.effects.promptMutated, false);
  assert.equal(enabled.memoryHomeostasis.memoryStabilityPromptPreflight.effects.ledgerWritten, false);
  assert.equal(enabled.memoryHomeostasis.memoryStabilityPromptPreflight.runtimeLoader?.ok, true);
});

test("context bundle can explicitly apply a controlled memory stability prompt pre-transform", async () => {
  const agentId = "agent_main";
  await ledger.bootstrapAgentRuntime(
    agentId,
    {
      displayName: "Agent Passport Prompt Pretransform Test",
      role: "runtime agent",
      longTermGoal: "verify explicit prompt-local memory stability reanchor",
      currentGoal: "stabilize runtime prompt",
      currentPlan: ["inflate context", "build preflight", "reanchor safely"],
      nextAction: "inspect prompt tail",
      claimResidentAgent: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );
  await ledger.configureDeviceRuntime({
    residentAgentId: agentId,
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });

  const noisyPayload = {
    currentGoal: `stabilize runtime prompt ${"goal ".repeat(420)}`,
    query: `stabilize runtime prompt ${"goal ".repeat(420)}`,
    reasonerProvider: "local_mock",
    recentConversationTurns: Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `turn-${index} ${"memory drift ".repeat(220)}`,
    })),
    toolResults: Array.from({ length: 8 }, (_, index) => ({
      tool: `tool_${index}`,
      result: `result-${index} ${"runtime evidence ".repeat(220)}`,
    })),
  };

  const baseline = await ledger.buildAgentContextBundle(agentId, noisyPayload, {
    didMethod: "agentpassport",
  });
  const enabled = await ledger.buildAgentContextBundle(
    agentId,
    {
      ...noisyPayload,
      memoryStabilityPromptPreTransform: true,
    },
    { didMethod: "agentpassport" }
  );

  assert.equal(typeof enabled.compiledPrompt, "string");
  assert.equal(enabled.memoryHomeostasis?.memoryStabilityPromptPreflight?.status, "ready");
  assert.deepEqual(
    enabled.memoryHomeostasis?.memoryStabilityPromptPreflight?.promptTransformPlan?.promptActions,
    ["reanchor_key_memories_near_prompt_end", "raise_memory_injection_priority"]
  );
  assert.equal(Object.hasOwn(baseline.memoryHomeostasis || {}, "memoryStabilityPromptPreTransform"), false);
  assert.equal(enabled.memoryHomeostasis?.memoryStabilityPromptPreTransform?.status, "applied");
  assert.equal(enabled.slots?.memoryHomeostasis?.memoryStabilityPromptPreTransform?.status, "applied");
  assert.equal(enabled.memoryHomeostasis?.memoryStabilityPromptPreTransform?.effects?.promptMutated, true);
  assert.equal(enabled.memoryHomeostasis?.memoryStabilityPromptPreTransform?.runtimeLoader?.ok, true);
  assert.equal(enabled.compiledPrompt.includes("[redacted:"), false);
  assert.equal(enabled.compiledPrompt.includes("MEMORY STABILITY REANCHOR"), true);
  assert.equal(enabled.compiledPrompt.includes("\"mode\": \"prompt_local_reanchor\""), true);
  assert.equal(enabled.compiledPrompt.includes("memoryStabilityPromptPreflight"), false);
  assert.equal(enabled.compiledPrompt.includes("reload_authoritative_memory_store"), false);
  assert.equal(enabled.compiledPrompt.includes("resolve_conflicts_and_refresh_runtime_state"), false);
  assert.notEqual(enabled.compiledPrompt, baseline.compiledPrompt);
  assert.notEqual(enabled.contextHash, baseline.contextHash);
  assert.equal(
    enabled.slots?.queryBudget?.estimatedContextTokens > baseline.slots?.queryBudget?.estimatedContextTokens,
    true
  );
});

test("context bundle prompt pre-transform is idempotent across repeated prepares", async () => {
  const agentId = "agent_main";
  const payload = {
    currentGoal: `stabilize runtime prompt ${"goal ".repeat(420)}`,
    query: `stabilize runtime prompt ${"goal ".repeat(420)}`,
    reasonerProvider: "local_mock",
    memoryStabilityPromptPreTransform: true,
    recentConversationTurns: Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `turn-${index} ${"memory drift ".repeat(220)}`,
    })),
    toolResults: Array.from({ length: 8 }, (_, index) => ({
      tool: `tool_${index}`,
      result: `result-${index} ${"runtime evidence ".repeat(220)}`,
    })),
  };

  const first = await ledger.buildAgentContextBundle(agentId, payload, {
    didMethod: "agentpassport",
  });
  const second = await ledger.buildAgentContextBundle(agentId, payload, {
    didMethod: "agentpassport",
  });

  const firstPrompt = normalizeCompiledPromptForDeterminism(first.compiledPrompt);
  const secondPrompt = normalizeCompiledPromptForDeterminism(second.compiledPrompt);
  const firstSectionCount = firstPrompt.split("MEMORY STABILITY REANCHOR").length - 1;
  const secondSectionCount = secondPrompt.split("MEMORY STABILITY REANCHOR").length - 1;
  const firstSectionEstimateCount = (first.slots?.queryBudget?.sectionEstimates || []).filter(
    (section) => section?.title === "MEMORY STABILITY REANCHOR"
  ).length;
  const secondSectionEstimateCount = (second.slots?.queryBudget?.sectionEstimates || []).filter(
    (section) => section?.title === "MEMORY STABILITY REANCHOR"
  ).length;

  assert.equal(first.memoryHomeostasis?.memoryStabilityPromptPreTransform?.status, "applied");
  assert.equal(second.memoryHomeostasis?.memoryStabilityPromptPreTransform?.status, "applied");
  assert.equal(firstSectionCount, 1);
  assert.equal(secondSectionCount, 1);
  assert.equal(firstSectionEstimateCount, 1);
  assert.equal(secondSectionEstimateCount, 1);
  assert.equal(firstPrompt, secondPrompt);
  assert.equal(
    first.slots?.queryBudget?.estimatedContextTokens,
    second.slots?.queryBudget?.estimatedContextTokens
  );
  assert.equal(
    first.memoryHomeostasis?.memoryStabilityPromptPreTransform?.prompt?.estimatedContextTokensAfter,
    second.memoryHomeostasis?.memoryStabilityPromptPreTransform?.prompt?.estimatedContextTokensAfter
  );
});

test("runner prompt pre-transform remains single-section after repeated prepare passes", async () => {
  const result = await ledger.executeAgentRunner(
    "agent_main",
    {
      currentGoal: `runner prompt pre-transform ${"goal ".repeat(420)}`,
      userTurn: "continue with explicit prompt-local reanchor",
      reasonerProvider: "local_mock",
      autoRecover: false,
      autoCompact: false,
      persistRun: false,
      writeConversationTurns: false,
      storeToolResults: false,
      memoryStabilityPromptPreTransform: true,
      recentConversationTurns: Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `runner-turn-${index} ${"memory drift ".repeat(220)}`,
      })),
      toolResults: Array.from({ length: 8 }, (_, index) => ({
        tool: `runner_tool_${index}`,
        result: `runner-result-${index} ${"runtime evidence ".repeat(220)}`,
      })),
    },
    { didMethod: "agentpassport" }
  );

  const compiledPrompt = String(result?.contextBuilder?.compiledPrompt || "");
  const reanchorSectionCount = compiledPrompt.split("MEMORY STABILITY REANCHOR").length - 1;
  assert.equal(reanchorSectionCount, 1);
  assert.equal(
    result?.contextBuilder?.memoryHomeostasis?.memoryStabilityPromptPreTransform?.status,
    "applied"
  );
});

test("context bundle resolves the contract-backed local reasoner profile before prompt preflight", async () => {
  const agentId = "agent_main";
  await ledger.bootstrapAgentRuntime(
    agentId,
    {
      displayName: "Agent Passport Contract Profile Test",
      role: "runtime agent",
      longTermGoal: "verify contract-backed live profile resolution",
      currentGoal: "resolve contract-backed local profile",
      currentPlan: ["build context", "resolve contract profile", "lock local alias mapping"],
      nextAction: "inspect runtime profile",
      claimResidentAgent: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );
  await ledger.configureDeviceRuntime({
    residentAgentId: agentId,
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });

  const result = await ledger.buildAgentContextBundle(
    agentId,
    {
      currentGoal: "resolve contract-backed local profile",
      query: "resolve contract-backed local profile",
      reasonerProvider: "local_mock",
    },
    { didMethod: "agentpassport" }
  );

  const modelProfile = result.memoryHomeostasis?.modelProfile || null;
  const runtimeStateProfile = result.memoryHomeostasis?.runtimeState?.profile || null;

  assert.equal(modelProfile?.modelName, AGENT_PASSPORT_LOCAL_REASONER_LABEL);
  assert.equal(modelProfile?.benchmarkMeta?.contractBacked, true);
  assert.equal(modelProfile?.benchmarkMeta?.contractModelName, "gemma4:e4b");
  assert.equal(modelProfile?.ecl085, 2048);
  assert.equal(runtimeStateProfile?.benchmarkMeta?.contractBacked, true);
  assert.equal(runtimeStateProfile?.benchmarkMeta?.contractModelName, "gemma4:e4b");
  assert.equal(runtimeStateProfile?.ecl085, 2048);
});

test("runner attaches memory stability preview only to the explicit response view", async () => {
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
  await ledger.bootstrapAgentRuntime(
    "agent_main",
    {
      displayName: "Agent Passport Kernel Test",
      role: "runtime agent",
      longTermGoal: "agent-passport memory stability migration",
      currentGoal: "verify memory stability kernel preview",
      currentPlan: ["build contract", "stage adapter", "attach internal kernel"],
      nextAction: "run kernel preview",
      claimResidentAgent: true,
      dryRun: false,
    },
    { didMethod: "agentpassport" }
  );

  const disabledRun = await ledger.executeAgentRunner(
    "agent_main",
    {
      currentGoal: "verify default runner behavior",
      userTurn: "continue without memory stability kernel preview",
      reasonerProvider: "local_mock",
      autoRecover: false,
      autoCompact: false,
      persistRun: true,
      writeConversationTurns: false,
      storeToolResults: false,
    },
    { didMethod: "agentpassport" }
  );
  assert.equal(
    Object.hasOwn(disabledRun.run?.memoryHomeostasis || {}, "memoryStabilityPreview"),
    false
  );

  const enabledRun = await ledger.executeAgentRunner(
    "agent_main",
    {
      currentGoal: "verify explicit runner memory stability kernel preview",
      userTurn: "continue with memory stability kernel preview",
      reasonerProvider: "local_mock",
      autoRecover: false,
      autoCompact: false,
      persistRun: true,
      writeConversationTurns: false,
      storeToolResults: false,
      memoryStabilityKernelPreview: true,
    },
    { didMethod: "agentpassport" }
  );

  const preview = enabledRun.run?.memoryHomeostasis?.memoryStabilityPreview;
  assert.equal(preview?.status, "ready");
  assert.equal(preview.effects.ledgerWritten, false);
  assert.equal(preview.effects.promptMutated, false);
  assert.equal(preview.runtimeLoader?.ok, true);
  assert.equal(JSON.stringify(enabledRun.contextBuilder).includes("memoryStabilityPreview"), false);

  const persistedRuns = await ledger.listAgentRuns("agent_main", { limit: 5 });
  const latestPersistedRun = persistedRuns.runs.at(-1);
  assert.equal(latestPersistedRun?.runId, enabledRun.run?.runId);
  assert.equal(
    Object.hasOwn(latestPersistedRun?.memoryHomeostasis || {}, "memoryStabilityPreview"),
    false
  );
});

test("runner can explicitly request safe memory stability correction execution without persisting preview receipts", async () => {
  const enabledRun = await ledger.executeAgentRunner(
    "agent_main",
    {
      currentGoal: "verify explicit safe memory stability correction execution",
      userTurn: "continue with safe memory stability correction execution",
      reasonerProvider: "local_mock",
      autoRecover: false,
      autoCompact: false,
      persistRun: true,
      writeConversationTurns: false,
      storeToolResults: false,
      memoryStabilityKernelPreview: true,
      memoryStability: {
        executeSafeActions: true,
      },
    },
    { didMethod: "agentpassport" }
  );

  const preview = enabledRun.run?.memoryHomeostasis?.memoryStabilityPreview;
  assert.equal(preview?.status, "ready");
  assert.equal(preview?.effects?.correctionExecuted, true);
  assert.equal(preview?.boundaries?.correctionExecution, "safe_non_store_completed");
  assert.equal(preview?.controlledAdapter?.execute, true);
  assert.equal(preview?.correctionEventPreview?.execution?.status, "completed");
  assert.equal(preview?.correctionEventPreview?.execution?.authoritative_store_mutated, false);
  assert.equal(preview?.effects?.ledgerWritten, false);
  assert.equal(preview?.effects?.storeWritten, false);

  const persistedRuns = await ledger.listAgentRuns("agent_main", { limit: 5 });
  const latestPersistedRun = persistedRuns.runs.at(-1);
  assert.equal(latestPersistedRun?.runId, enabledRun.run?.runId);
  assert.equal(
    Object.hasOwn(latestPersistedRun?.memoryHomeostasis || {}, "memoryStabilityPreview"),
    false
  );
});

test("runner auto-attaches memory stability preview when safe correction execution is explicitly requested", async () => {
  const enabledRun = await ledger.executeAgentRunner(
    "agent_main",
    {
      currentGoal: "verify safe correction execution implies kernel preview",
      userTurn: "continue with safe correction execution only",
      reasonerProvider: "local_mock",
      autoRecover: false,
      autoCompact: false,
      persistRun: true,
      writeConversationTurns: false,
      storeToolResults: false,
      memoryStability: {
        executeSafeActions: true,
      },
    },
    { didMethod: "agentpassport" }
  );

  const preview = enabledRun.run?.memoryHomeostasis?.memoryStabilityPreview;
  assert.equal(preview?.status, "ready");
  assert.equal(preview?.controlledAdapter?.execute, true);
  assert.equal(preview?.effects?.correctionExecuted, true);
  assert.equal(preview?.boundaries?.correctionExecution, "safe_non_store_completed");
});

test("runner reuses explicit memory stability preview timestamps for replayable receipts", async () => {
  const replayCreatedAt = "2026-04-23T16:02:25.000Z";
  const enabledRun = await ledger.executeAgentRunner(
    "agent_main",
    {
      currentGoal: "verify replayable memory stability preview timestamp",
      userTurn: "continue with a stable memory stability preview timestamp",
      reasonerProvider: "local_mock",
      autoRecover: false,
      autoCompact: false,
      persistRun: true,
      writeConversationTurns: false,
      storeToolResults: false,
      memoryStabilityKernelPreview: true,
      memoryStabilityPreviewCreatedAt: replayCreatedAt,
    },
    { didMethod: "agentpassport" }
  );

  const preview = enabledRun.run?.memoryHomeostasis?.memoryStabilityPreview;
  assert.equal(preview?.status, "ready");
  assert.equal(preview?.generatedAt, replayCreatedAt);
  assert.equal(preview?.snapshot?.created_at, replayCreatedAt);
  if (preview?.formalExecutionRequest) {
    assert.equal(preview.formalExecutionRequest.created_at, replayCreatedAt);
    assert.equal(
      preview.formalExecutionRequest.execution?.adapter_invocation_id,
      `kernel-preview-${preview?.snapshot?.snapshot_id}`
    );
  }
});

test("runner guard blocks explicit safe correction execution when authoritative reload receipts are still required", async () => {
  const guard = await ledger.resolveExplicitMemoryStabilityRunnerGuard({
    contextBuilder: {
      memoryHomeostasis: {
        runtimeState: runtimeStateFixture({
          sessionId: "kernel-strong-runner-guard-session",
          checkedMemories: 2,
          conflictMemories: 2,
          memoryAnchors: runtimeStateFixture().memoryAnchors.map((anchor) => ({
            ...anchor,
            lastVerifiedOk: false,
            conflictState: {
              hasConflict: true,
            },
          })),
        }),
      },
    },
    explicitRequest: {
      kernelPreviewRequested: true,
      promptPreflightRequested: false,
      promptPreTransformRequested: false,
      safeCorrectionExecutionRequested: true,
      requiresPromptContextGate: false,
      hasAnyExplicitRequest: true,
    },
    memoryStabilityRuntime: {
      ok: true,
    },
  });

  assert.equal(guard?.failClosed, true);
  assert.equal(guard?.blockedBy, "memory_stability_formal_execution");
  assert.equal(guard?.code, "MEMORY_STABILITY_FORMAL_EXECUTION_REQUIRED");
  assert.equal(guard?.stage, "formal_execution");
  assert.equal(guard?.receiptStatus, "blocked_authoritative_reload");
  assert.deepEqual(guard?.explicitRequestKinds, ["kernel_preview", "safe_correction_execution"]);
});

test("runner guard unblocks explicit safe correction execution when matching formal receipts are supplied", async () => {
  const previewCreatedAt = "2026-04-23T16:02:30.000Z";
  const strongRuntimeState = runtimeStateFixture({
    sessionId: "kernel-strong-runner-guard-receipts-session",
    checkedMemories: 2,
    conflictMemories: 2,
    memoryAnchors: runtimeStateFixture().memoryAnchors.map((anchor) => ({
      ...anchor,
      lastVerifiedOk: false,
      conflictState: {
        hasConflict: true,
      },
    })),
  });
  const blockedPreview = await kernel.buildMemoryStabilityKernelPreview({
    runtimeState: strongRuntimeState,
    createdAt: previewCreatedAt,
    enabled: true,
    executeSafeActions: true,
  });
  assert.equal(blockedPreview.snapshot?.created_at, previewCreatedAt);
  assert.equal(blockedPreview.formalExecutionRequest?.created_at, previewCreatedAt);
  const adapterInvocationId = blockedPreview.formalExecutionRequest?.execution?.adapter_invocation_id;
  const receipts = [
    buildMemoryStabilityFormalExecutionReceipt({
      snapshot: blockedPreview.snapshot,
      adapterInvocationId,
      receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.authoritativeStoreReload,
      authoritativeStoreVersion: "store-version-guard-001",
      createdAt: "2026-04-23T16:02:31.000Z",
    }),
    buildMemoryStabilityFormalExecutionReceipt({
      snapshot: blockedPreview.snapshot,
      adapterInvocationId,
      receiptType: MEMORY_STABILITY_FORMAL_EXECUTION_RECEIPT_TYPES.conflictResolutionRefresh,
      authoritativeStoreVersion: "store-version-guard-001",
      createdAt: "2026-04-23T16:02:32.000Z",
    }),
  ];

  const driftedGuard = await ledger.resolveExplicitMemoryStabilityRunnerGuard({
    contextBuilder: {
      memoryHomeostasis: {
        runtimeState: strongRuntimeState,
      },
    },
    explicitRequest: {
      kernelPreviewRequested: true,
      promptPreflightRequested: false,
      promptPreTransformRequested: false,
      safeCorrectionExecutionRequested: true,
      requiresPromptContextGate: false,
      hasAnyExplicitRequest: true,
    },
    memoryStabilityRuntime: {
      ok: true,
    },
    formalExecutionReceipts: receipts,
  });

  assert.equal(driftedGuard?.blockedBy, "memory_stability_formal_execution");
  assert.equal(driftedGuard?.receiptStatus, "blocked_authoritative_reload");

  const guard = await ledger.resolveExplicitMemoryStabilityRunnerGuard({
    contextBuilder: {
      memoryHomeostasis: {
        runtimeState: strongRuntimeState,
      },
    },
    explicitRequest: {
      kernelPreviewRequested: true,
      promptPreflightRequested: false,
      promptPreTransformRequested: false,
      safeCorrectionExecutionRequested: true,
      requiresPromptContextGate: false,
      hasAnyExplicitRequest: true,
    },
    memoryStabilityRuntime: {
      ok: true,
    },
    formalExecutionReceipts: receipts,
    previewCreatedAt,
  });

  assert.equal(guard, null);
});

test("context bundle fails closed when memory stability runtime loader gate is broken", async () => {
  process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT = path.join(rootDir, "missing-memory-stability-root");
  try {
    const result = await ledger.buildAgentContextBundle(
      "agent_main",
      {
        currentGoal: "verify memory stability runtime loader fail-closed prompt preflight",
        query: "verify runtime loader fail-closed prompt preflight",
        reasonerProvider: "local_mock",
        memoryStabilityPromptPreflight: true,
      },
      { didMethod: "agentpassport" }
    );

    const preflight = result.memoryHomeostasis?.memoryStabilityPromptPreflight;
    assert.equal(preflight?.ok, false);
    assert.equal(preflight?.status, "failed");
    assert.equal(preflight?.failClosed, true);
    assert.equal(preflight?.runtimeLoader?.ok, false);
    assert.equal(preflight?.runtimeLoader?.failClosed, true);
    assert.equal(preflight?.runtimeLoader?.error?.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
    assert.equal(preflight?.effects?.modelCalled, false);
    assert.equal(preflight?.effects?.networkCalled, false);
    assert.equal(preflight?.effects?.ledgerWritten, false);
    assert.equal(preflight?.effects?.storeWritten, false);
    assert.equal(preflight?.effects?.promptMutated, false);
    assert.equal(preflight?.boundaries?.correctionExecution, "blocked");
  } finally {
    delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT;
  }
});

test("context bundle prompt pre-transform fails closed when memory stability runtime loader gate is broken", async () => {
  process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT = path.join(rootDir, "missing-memory-stability-root");
  try {
    const result = await ledger.buildAgentContextBundle(
      "agent_main",
      {
        currentGoal: "verify memory stability prompt pre-transform loader failure",
        query: "verify memory stability prompt pre-transform loader failure",
        reasonerProvider: "local_mock",
        memoryStabilityPromptPreTransform: true,
      },
      { didMethod: "agentpassport" }
    );

    const receipt = result.memoryHomeostasis?.memoryStabilityPromptPreTransform;
    assert.equal(receipt?.ok, false);
    assert.equal(receipt?.status, "blocked_preflight");
    assert.equal(receipt?.failClosed, true);
    assert.equal(receipt?.effects?.promptMutated, false);
    assert.equal(receipt?.runtimeLoader?.ok, false);
  assert.equal(receipt?.runtimeLoader?.failClosed, true);
  assert.equal(receipt?.runtimeLoader?.error?.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
  assert.equal(result.compiledPrompt.includes("MEMORY STABILITY REANCHOR"), false);
  } finally {
    delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT;
  }
});

test("context bundle prompt pre-transform fails closed when the injected section exceeds budget", async () => {
  const agentId = "agent_main";
  await ledger.bootstrapAgentRuntime(
    agentId,
    {
      displayName: "Agent Passport Prompt Budget Test",
      role: "runtime agent",
      longTermGoal: "verify prompt-local reanchor respects token budget",
      currentGoal: "block prompt reanchor when budget is exhausted",
      currentPlan: ["shrink budget", "build preflight", "fail closed"],
      nextAction: "inspect prompt receipt",
      claimResidentAgent: true,
      dryRun: false,
      maxContextChars: 1000,
    },
    { didMethod: "agentpassport" }
  );
  await ledger.configureDeviceRuntime({
    residentAgentId: agentId,
    residentDidMethod: "agentpassport",
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    retrievalStrategy: "local_first_non_vector",
    allowVectorIndex: false,
  });

  const result = await ledger.buildAgentContextBundle(
    agentId,
    {
      currentGoal: `budget gate prompt ${"goal ".repeat(20)}`,
      query: `budget gate prompt ${"goal ".repeat(20)}`,
      reasonerProvider: "local_mock",
      memoryStabilityPromptPreTransform: true,
      recentConversationTurns: Array.from({ length: 6 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `budget-turn-${index} ${"memory drift ".repeat(20)}`,
      })),
      toolResults: Array.from({ length: 4 }, (_, index) => ({
        tool: `budget_tool_${index}`,
        result: `budget-result-${index} ${"runtime evidence ".repeat(20)}`,
      })),
    },
    { didMethod: "agentpassport" }
  );

  const receipt = result.memoryHomeostasis?.memoryStabilityPromptPreTransform;
  assert.equal(receipt?.ok, false);
  assert.equal(receipt?.status, "blocked_budget");
  assert.equal(receipt?.failClosed, true);
  assert.equal(receipt?.reason, "prompt_transform_exceeds_budget");
  assert.equal(receipt?.effects?.promptMutated, false);
  assert.equal(receipt?.runtimeLoader?.ok, true);
  assert.equal(result.compiledPrompt.includes("MEMORY STABILITY REANCHOR"), false);
  assert.equal(
    receipt?.prompt?.estimatedContextTokensAfter,
    receipt?.prompt?.estimatedContextTokensBefore
  );
  assert.equal(receipt?.prompt?.maxContextTokens, 256);
  assert.equal(
    result.slots?.memoryHomeostasis?.memoryStabilityPromptPreTransform?.status,
    "blocked_budget"
  );
});

test("runner memory stability preview fails closed when runtime loader gate is broken", async () => {
  process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT = path.join(rootDir, "missing-memory-stability-root");
  try {
    const result = await ledger.executeAgentRunner(
      "agent_main",
      {
        currentGoal: "verify runtime loader fail-closed runner preview",
        userTurn: "continue with memory stability kernel preview after runtime gate failure",
        reasonerProvider: "local_mock",
        autoRecover: false,
        autoCompact: false,
        persistRun: true,
        writeConversationTurns: false,
        storeToolResults: false,
        memoryStabilityKernelPreview: true,
      },
      { didMethod: "agentpassport" }
    );

    assert.equal(result.run?.status, "blocked");
    assert.equal(result.run?.candidateResponse ?? null, null);
    assert.equal(result.reasoner, null);
    assert.equal(result.verification, null);
    assert.equal(result.run?.runnerGuard?.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
    assert.equal(result.run?.runnerGuard?.blockedBy, "memory_stability_runtime_gate");
    const preview = result.run?.memoryHomeostasis?.memoryStabilityPreview;
    assert.equal(preview?.ok, false);
    assert.equal(preview?.status, "failed");
    assert.equal(preview?.failClosed, true);
    assert.equal(preview?.runtimeLoader?.ok, false);
    assert.equal(preview?.runtimeLoader?.failClosed, true);
    assert.equal(preview?.runtimeLoader?.error?.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
  } finally {
    delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT;
  }
});

test("runner memory stability prompt preflight fails closed when runtime loader gate is broken", async () => {
  process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT = path.join(rootDir, "missing-memory-stability-root");
  try {
    const result = await ledger.executeAgentRunner(
      "agent_main",
      {
        currentGoal: "verify runtime loader fail-closed runner prompt preflight",
        userTurn: "continue with explicit memory stability prompt preflight after runtime gate failure",
        reasonerProvider: "local_mock",
        autoRecover: false,
        autoCompact: false,
        persistRun: true,
        writeConversationTurns: false,
        storeToolResults: false,
        memoryStabilityPromptPreflight: true,
      },
      { didMethod: "agentpassport" }
    );

    assert.equal(result.run?.status, "blocked");
    assert.equal(result.run?.candidateResponse ?? null, null);
    assert.equal(result.reasoner, null);
    assert.equal(result.verification, null);
    assert.equal(result.run?.runnerGuard?.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
    assert.equal(result.run?.runnerGuard?.blockedBy, "memory_stability_prompt_preflight");
    const preflight = result.contextBuilder?.memoryHomeostasis?.memoryStabilityPromptPreflight;
    assert.equal(preflight?.ok, false);
    assert.equal(preflight?.status, "failed");
    assert.equal(preflight?.failClosed, true);
    assert.equal(preflight?.runtimeLoader?.ok, false);
    assert.equal(preflight?.runtimeLoader?.failClosed, true);
    assert.equal(preflight?.runtimeLoader?.error?.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
  } finally {
    delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT;
  }
});

test("runner memory stability prompt pre-transform fails closed when runtime loader gate is broken", async () => {
  process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT = path.join(rootDir, "missing-memory-stability-root");
  try {
    const result = await ledger.executeAgentRunner(
      "agent_main",
      {
        currentGoal: "verify runtime loader fail-closed runner prompt pre-transform",
        userTurn: "continue with explicit memory stability prompt pre-transform after runtime gate failure",
        reasonerProvider: "local_mock",
        autoRecover: false,
        autoCompact: false,
        persistRun: true,
        writeConversationTurns: false,
        storeToolResults: false,
        memoryStabilityPromptPreTransform: true,
      },
      { didMethod: "agentpassport" }
    );

    assert.equal(result.run?.status, "blocked");
    assert.equal(result.run?.candidateResponse ?? null, null);
    assert.equal(result.reasoner, null);
    assert.equal(result.verification, null);
    assert.equal(result.run?.runnerGuard?.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
    assert.equal(result.run?.runnerGuard?.blockedBy, "memory_stability_prompt_pretransform");
    const receipt = result.contextBuilder?.memoryHomeostasis?.memoryStabilityPromptPreTransform;
    assert.equal(receipt?.ok, false);
    assert.equal(receipt?.status, "blocked_preflight");
    assert.equal(receipt?.failClosed, true);
    assert.equal(receipt?.runtimeLoader?.ok, false);
    assert.equal(receipt?.runtimeLoader?.failClosed, true);
    assert.equal(receipt?.runtimeLoader?.error?.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
    assert.equal(String(result.contextBuilder?.compiledPrompt || "").includes("MEMORY STABILITY REANCHOR"), false);
  } finally {
    delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT;
  }
});

test("runner does not fail closed from env-only memory stability flags when the payload is silent", async () => {
  process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT = path.join(rootDir, "missing-memory-stability-root");
  process.env.AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PREFLIGHT = "1";
  try {
    const result = await ledger.executeAgentRunner(
      "agent_main",
      {
        currentGoal: "verify env-only memory stability flags stay advisory for runner execution",
        userTurn: "continue without an explicit memory stability payload request",
        reasonerProvider: "local_mock",
        autoRecover: false,
        autoCompact: false,
        persistRun: true,
        writeConversationTurns: false,
        storeToolResults: false,
      },
      { didMethod: "agentpassport" }
    );

    assert.notEqual(result.run?.status, "blocked");
    assert.equal(result.run?.runnerGuard ?? null, null);
    assert.notEqual(result.run?.candidateResponse ?? null, null);
    const preflight = result.contextBuilder?.memoryHomeostasis?.memoryStabilityPromptPreflight;
    assert.equal(preflight?.ok, false);
    assert.equal(preflight?.status, "failed");
    assert.equal(preflight?.runtimeLoader?.error?.code, "MEMORY_STABILITY_RUNTIME_LOAD_FAILED");
  } finally {
    delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_PROMPT_PREFLIGHT;
    delete process.env.AGENT_PASSPORT_MEMORY_STABILITY_RUNTIME_ROOT;
  }
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const agentId = "agent_main";
const didMethod = "agentpassport";
const isolatedLedgerEnvKeys = [
  "AGENT_PASSPORT_LEDGER_PATH",
  "AGENT_PASSPORT_STORE_KEY_PATH",
  "AGENT_PASSPORT_USE_KEYCHAIN",
];

function snapshotEnv(keys = isolatedLedgerEnvKeys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function withIsolatedLedger(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-constrained-execution-"));
  const previousEnv = snapshotEnv();
  process.env.AGENT_PASSPORT_LEDGER_PATH = path.join(tempDir, "ledger.json");
  process.env.AGENT_PASSPORT_STORE_KEY_PATH = path.join(tempDir, ".ledger-key");
  process.env.AGENT_PASSPORT_USE_KEYCHAIN = "0";

  try {
    const ledgerModuleUrl =
      `${pathToFileURL(path.join(rootDir, "src", "ledger.js")).href}?isolated=${Date.now()}-${Math.random()}`;
    const ledger = await import(ledgerModuleUrl);
    return await run({ ledger, tempDir });
  } finally {
    restoreEnv(previousEnv);
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function bootstrapResidentAgent(ledger) {
  await ledger.bootstrapAgentRuntime(
    agentId,
    {
      displayName: "沈知远",
      role: "CEO",
      longTermGoal: "agent-passport",
      currentGoal: "验证 constrained execution deny path",
      currentPlan: ["bootstrap resident agent", "configure sandbox policy", "assert deny path"],
      nextAction: "执行 sandbox deny-path 回归",
      claimResidentAgent: true,
      allowResidentRebind: true,
      dryRun: false,
    },
    { didMethod }
  );
}

async function configureSandboxRuntime(ledger, overrides = {}) {
  await ledger.configureDeviceRuntime({
    residentAgentId: agentId,
    residentDidMethod: didMethod,
    residentLocked: false,
    localMode: "local_only",
    allowOnlineReasoner: false,
    localReasonerEnabled: true,
    localReasonerProvider: "local_mock",
    blockedCapabilities: [],
    ...overrides,
  });
}

function assertSandboxBlocked(result, expectedReason) {
  assert.equal(result.executed, false, "deny path 不应执行 sandbox action");
  assert.equal(result.status, "blocked", "deny path 应返回 blocked");
  assert.equal(result.sandboxExecution, null, "deny path 不应返回 sandboxExecution");
  assert.equal(result.negotiation?.decision, "blocked", "deny path 应在 negotiation 中进入 blocked");
  assert.equal(result.negotiation?.shouldExecute, false, "deny path 的 negotiation 不应允许执行");
  assert.equal(result.sandboxAudit?.status, "blocked", "deny path 应写入 blocked audit");
  assert.equal(result.sandboxAudit?.executed, false, "deny path 的 audit 应记录 executed=false");
  assert(Array.isArray(result.negotiation?.sandboxBlockedReasons), "deny path 应暴露 sandboxBlockedReasons");
  assert(
    result.negotiation.sandboxBlockedReasons.includes(expectedReason),
    `deny path 应包含阻断原因 ${expectedReason}`
  );
  assert(Array.isArray(result.sandboxAudit?.gateReasons), "deny path audit 应记录 gateReasons");
  assert(
    result.sandboxAudit.gateReasons.includes(expectedReason),
    `deny path audit 应包含阻断原因 ${expectedReason}`
  );
  assert(
    result.sandboxAudit.gateReasons.includes("negotiation_required:blocked"),
    "deny path audit 应记录 negotiation_required:blocked"
  );
}

test("executeAgentSandboxAction blocks constrained execution deny paths", async (t) => {
  await t.test("external_network_disabled blocks nested network_external execution", async () => {
    await withIsolatedLedger(async ({ ledger, tempDir }) => {
      await bootstrapResidentAgent(ledger);
      await configureSandboxRuntime(ledger, {
        allowedCapabilities: ["network_external"],
        allowExternalNetwork: false,
        networkAllowlist: ["127.0.0.1", "localhost"],
        filesystemAllowlist: [tempDir],
      });

      const result = await ledger.executeAgentSandboxAction(
        agentId,
        {
          interactionMode: "command",
          executionMode: "execute",
          confirmExecution: true,
          allowBootstrapBypass: true,
          currentGoal: "验证 external_network_disabled deny path",
          requestedAction: "读取本机 health",
          requestedActionType: "read",
          persistRun: false,
          autoCompact: false,
          sandboxAction: {
            capability: "network_external",
            method: "GET",
            url: "http://127.0.0.1:4319/api/health",
          },
        },
        { didMethod }
      );

      assertSandboxBlocked(result, "external_network_disabled");
    });
  });

  await t.test("shell_execution_disabled blocks nested process_exec execution", async () => {
    await withIsolatedLedger(async ({ ledger, tempDir }) => {
      const sandboxCwd = path.join(tempDir, "sandbox-cwd");
      await mkdir(sandboxCwd, { recursive: true });
      await bootstrapResidentAgent(ledger);
      await configureSandboxRuntime(ledger, {
        allowedCapabilities: ["process_exec"],
        allowShellExecution: false,
        allowedCommands: ["/usr/bin/printf"],
        filesystemAllowlist: [sandboxCwd],
      });

      const result = await ledger.executeAgentSandboxAction(
        agentId,
        {
          interactionMode: "command",
          executionMode: "execute",
          confirmExecution: true,
          allowBootstrapBypass: true,
          currentGoal: "验证 shell_execution_disabled deny path",
          requestedAction: "执行 /usr/bin/printf",
          requestedActionType: "execute",
          persistRun: false,
          autoCompact: false,
          sandboxAction: {
            capability: "process_exec",
            command: "/usr/bin/printf",
            args: ["nested-shell"],
            cwd: sandboxCwd,
          },
        },
        { didMethod }
      );

      assertSandboxBlocked(result, "shell_execution_disabled");
    });
  });

  await t.test("capability_mismatch blocks top-level and nested capability divergence", async () => {
    await withIsolatedLedger(async ({ ledger, tempDir }) => {
      const sandboxCwd = path.join(tempDir, "sandbox-cwd");
      await mkdir(sandboxCwd, { recursive: true });
      await bootstrapResidentAgent(ledger);
      await configureSandboxRuntime(ledger, {
        allowedCapabilities: ["process_exec"],
        allowShellExecution: true,
        allowedCommands: ["/usr/bin/printf"],
        filesystemAllowlist: [sandboxCwd],
      });

      const result = await ledger.executeAgentSandboxAction(
        agentId,
        {
          interactionMode: "command",
          executionMode: "execute",
          confirmExecution: true,
          allowBootstrapBypass: true,
          currentGoal: "验证 capability_mismatch deny path",
          requestedAction: "伪装成 runtime_search 的 process_exec",
          requestedCapability: "runtime_search",
          requestedActionType: "search",
          persistRun: false,
          autoCompact: false,
          sandboxAction: {
            capability: "process_exec",
            command: "/usr/bin/printf",
            args: ["capability-mismatch"],
            cwd: sandboxCwd,
          },
        },
        { didMethod }
      );

      assertSandboxBlocked(result, "capability_mismatch:runtime_search->process_exec");
    });
  });
});

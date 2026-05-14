import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeSandboxWorker } from "../src/ledger-sandbox-execution.js";

test("sandbox worker reports temp-only broker env as empty worker env", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-passport-worker-isolation-"));
  try {
    await writeFile(path.join(root, "probe.txt"), "ok", "utf8");

    const result = await executeSandboxWorker(
      {
        capability: "filesystem_list",
        resolvedPath: root,
        allowlistedRoot: root,
        maxListEntries: 10,
        systemSandboxEnabled: false,
      },
      { timeoutMs: 5000 }
    );

    assert.equal(result.output?.workerIsolation?.subprocessWorker, true);
    assert.equal(result.output?.workerIsolation?.workerEnvMode, "empty");
    assert.equal(result.broker?.brokerEnvMode, "empty");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

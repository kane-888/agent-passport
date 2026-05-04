import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { normalizeRuntimeRetrievalPolicy } from "../src/ledger-device-runtime.js";
import { searchMempalaceColdMemory } from "../src/mempalace-runtime.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-passport-mempalace-sidecar-"));
const mockCommand = path.join(tempDir, "mempalace-mock");
const failingMockCommand = path.join(tempDir, "mempalace-mock-fail");
const mockOutput = `
============================================================
  Results for: "context collapse"
============================================================

  [1] agent-passport / memory-stability
      Source: architecture.md
      Match:  0.91

      external cold memory stays read-only.
      never override the local ledger.

  ────────────────────────────────────────────────────────
`;

try {
  await writeFile(
    mockCommand,
    `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(`${mockOutput.trim()}\n`)});
process.exit(0);
`,
    "utf8"
  );
  await chmod(mockCommand, 0o755);
  await writeFile(
    failingMockCommand,
    `#!/usr/bin/env node
process.stderr.write("raw stderr leak: context collapse /tmp/fake-palace openneed memory\\n");
process.exit(7);
`,
    "utf8"
  );
  await chmod(failingMockCommand, 0o755);

  const retrievalPolicy = normalizeRuntimeRetrievalPolicy({
    strategy: "local_first_non_vector",
    externalColdMemory: {
      enabled: true,
      provider: "mempalace",
      command: mockCommand,
      palacePath: "/tmp/fake-palace",
      maxHits: 2,
      timeoutMs: 1200,
    },
  });

  assert.equal(retrievalPolicy.externalColdMemory.enabled, true);
  assert.equal(retrievalPolicy.externalColdMemory.provider, "mempalace");
  assert.equal(retrievalPolicy.externalColdMemory.command, mockCommand);
  assert.equal(retrievalPolicy.externalColdMemory.maxHits, 2);

  const search = searchMempalaceColdMemory("context collapse", retrievalPolicy.externalColdMemory);
  assert.equal(search.error, null);
  assert.equal(search.used, true);
  assert.equal(search.method, "cli");
  assert.equal(search.hits.length, 1);
  assert.equal(search.hits[0].candidateOnly, true);
  assert.equal(search.hits[0].linked?.provider, "mempalace");
  assert.equal(search.hits[0].linked?.sourceFile, "architecture.md");
  assert.match(search.hits[0].summary || "", /read-only/i);
  assert.equal(Object.prototype.hasOwnProperty.call(search, "query"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(search.config || {}, "wing"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(search.config || {}, "room"), false);

  const failedSearch = searchMempalaceColdMemory("context collapse", {
    ...retrievalPolicy.externalColdMemory,
    command: failingMockCommand,
  });
  assert.equal(failedSearch.error, "mempalace_cli_exit_code_7");
  assert.equal(String(failedSearch.error || "").includes("context collapse"), false);
  assert.equal(String(failedSearch.error || "").includes("/tmp/fake-palace"), false);
  assert.equal(String(failedSearch.error || "").includes("openneed"), false);

  console.log("verify:mempalace:sidecar ok");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

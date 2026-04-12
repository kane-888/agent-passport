import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { normalizeRuntimeRetrievalPolicy } from "../src/ledger-device-runtime.js";
import { searchMempalaceColdMemory } from "../src/mempalace-runtime.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "openneed-mempalace-sidecar-"));
const mockCommand = path.join(tempDir, "mempalace-mock");
const mockOutput = `
============================================================
  Results for: "context collapse"
============================================================

  [1] openneed / memory
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

  console.log("verify:mempalace:sidecar ok");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

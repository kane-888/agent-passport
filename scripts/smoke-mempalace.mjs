import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function buildCliOutput({
  query,
  wing = "openneed",
  room = "memory",
  sourceFile = "architecture.md",
  similarity = 0.91,
  lines = [],
} = {}) {
  return [
    "============================================================",
    `  Results for: "${query}"`,
    "============================================================",
    "",
    `  [1] ${wing} / ${room}`,
    `      Source: ${sourceFile}`,
    `      Match:  ${similarity}`,
    "",
    ...lines.map((line) => `      ${line}`),
    "",
    "  ────────────────────────────────────────────────────────",
    "",
  ].join("\n");
}

export async function createMockMempalaceFixture({
  prefix = "openneed-mempalace-smoke-",
  queryToken = `mempalace-sidecar-${Date.now()}`,
  wing = "openneed",
  room = "memory",
  sourceFile = "architecture.md",
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const commandPath = path.join(root, "mempalace-mock");
  const palacePath = path.join(root, "palace");
  const query = queryToken;
  const output = buildCliOutput({
    query,
    wing,
    room,
    sourceFile,
    lines: [
      `external cold memory candidate ${queryToken}`,
      "external cold memory stays read-only.",
      "never override the local ledger.",
    ],
  });

  await fs.mkdir(palacePath, { recursive: true });
  await fs.writeFile(
    commandPath,
    `#!/bin/sh
cat <<'__OPENNEED_MEMPALACE_OUTPUT__'
${output}
__OPENNEED_MEMPALACE_OUTPUT__
`,
    "utf8"
  );
  await fs.chmod(commandPath, 0o755);

  return {
    root,
    palacePath,
    commandPath,
    query,
    wing,
    room,
    sourceFile,
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

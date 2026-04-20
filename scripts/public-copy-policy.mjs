import { readFile } from "node:fs/promises";
import path from "node:path";

import { assert } from "./smoke-shared.mjs";

export const PUBLIC_COPY_POLICY_FILES = Object.freeze([
  "public/index.html",
  "public/operator.html",
  "public/repair-hub.html",
  "public/lab.html",
  "public/offline-chat.html",
  "public/runtime-truth-client.js",
  "public/offline-chat-app.js",
  "public/ui-links.js",
]);

export const FORBIDDEN_PUBLIC_COPY = Object.freeze([
  "OpenNeed 记忆稳态引擎",
  "did:openneed 视角",
  "修复中枢",
]);

export async function readPublicCopyPolicySources(rootDir) {
  const entries = await Promise.all(
    PUBLIC_COPY_POLICY_FILES.map(async (relativePath) => [
      relativePath,
      await readFile(path.join(rootDir, relativePath), "utf8"),
    ])
  );
  return Object.fromEntries(entries);
}

export function assertPublicCopyPolicy(sources) {
  for (const [label, source] of Object.entries(sources || {})) {
    for (const forbidden of FORBIDDEN_PUBLIC_COPY) {
      assert(!source.includes(forbidden), `${label} 不应暴露公开旧文案：${forbidden}`);
    }
  }
}

export async function assertPublicCopyPolicyForRoot(rootDir) {
  assertPublicCopyPolicy(await readPublicCopyPolicySources(rootDir));
}

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

export const PUBLIC_NARRATIVE_COPY_POLICY_FILES = Object.freeze([
  "README.md",
  "docs/absolute-unsolved-issues.html",
  "docs/openneed-memory-homeostasis-engine-architecture.md",
  "docs/openneed-memory-homeostasis-engine-gap-analysis.md",
  "docs/openneed-memory-homeostasis-engine-local-reasoner.md",
  "docs/openneed-memory-homeostasis-engine-autonomous-thread-v1.md",
  "docs/product-positioning.md",
  "docs/merge-prep-checklist.md",
]);

export const FORBIDDEN_PUBLIC_COPY = Object.freeze([
  "OpenNeed 记忆稳态引擎",
  "did:openneed 视角",
  "修复中枢",
]);

export const FORBIDDEN_PUBLIC_NARRATIVE_COPY = Object.freeze([
  "OpenNeed Agents",
  "OpenNeed 记忆稳态引擎",
  "底层运行时引擎：OpenNeed",
  "openneed 主项目",
  "这套能力现在的正式命名是 `OpenNeed",
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

export async function readPublicNarrativeCopyPolicySources(rootDir) {
  const entries = await Promise.all(
    PUBLIC_NARRATIVE_COPY_POLICY_FILES.map(async (relativePath) => [
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

export function assertPublicNarrativeCopyPolicy(sources) {
  for (const [label, source] of Object.entries(sources || {})) {
    for (const forbidden of FORBIDDEN_PUBLIC_NARRATIVE_COPY) {
      assert(!source.includes(forbidden), `${label} 不应把 OpenNeed 回退成对外正式叙事：${forbidden}`);
    }
  }
}

export async function assertPublicCopyPolicyForRoot(rootDir) {
  assertPublicCopyPolicy(await readPublicCopyPolicySources(rootDir));
  assertPublicNarrativeCopyPolicy(await readPublicNarrativeCopyPolicySources(rootDir));
}

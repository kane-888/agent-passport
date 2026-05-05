import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPackageBoundaryReport,
  collectForbiddenPackagePaths,
  verifyPackageBoundary,
} from "../scripts/verify-package-boundary.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package boundary rejects generated and internal-only assets", () => {
  const violations = collectForbiddenPackagePaths([
    { path: "docs/.DS_Store" },
    { path: "data/recovery-bundles/recovery.json" },
    { path: "docs/agent-passport-bp.pptx" },
    { path: "agent-passport-question-response.docx" },
    { path: "docs/absolute-unsolved-issues.docx" },
    { path: "docs/absolute-unsolved-issues.html" },
    { path: "docs/generated/snapshot.json" },
    { path: "docs/assets/fundraising-bp/slide-01.png" },
    { path: "docs/fundraising-roadshow-script.md" },
    { path: "docs/openneed-memory-homeostasis-engine-architecture.md" },
    { path: "docs/openneed-memory-homeostasis-engine-autonomous-thread-v1.md" },
    { path: "scripts/demo-context-collapse-debug.mjs" },
    { path: "scripts/capture-bp-screenshots.mjs" },
    { path: "scripts/generate_fundraising_ppt.py" },
    { path: "get-device-setup.cpuprofile" },
    { path: "coverage/lcov.info" },
    { path: ".nyc_output/out.json" },
    { path: "test-results/smoke/output.json" },
    { path: "playwright-report/index.html" },
    { path: "screenshots/smoke.png" },
    { path: "tmp/pack-scratch.json" },
    { path: "server.log" },
  ]);

  assert.deepEqual(
    violations.map((entry) => entry.id),
    [
      "os_metadata",
      "runtime_data",
      "presentation_assets",
      "internal_docx",
      "internal_docx",
      "generated_docs_html",
      "generated_docs",
      "fundraising_assets",
      "fundraising_copy",
      "openneed_engine_docs",
      "autonomous_thread_draft",
      "debug_demo_script",
      "bp_screenshot_generator",
      "bp_ppt_generator",
      "cpuprofile",
      "coverage_output",
      "nyc_output",
      "test_results",
      "playwright_report",
      "screenshot_output",
      "temp_output",
      "log_file",
    ]
  );
});

test("package boundary report stays green for normal runtime source files", () => {
  const report = buildPackageBoundaryReport([
    {
      id: "agent-passport@0.1.0",
      filename: "agent-passport-0.1.0.tgz",
      files: [
        { path: "package.json" },
        { path: "src/server.js" },
        { path: "scripts/smoke-all.mjs" },
        { path: "docs/product-positioning.md" },
        { path: "docs/generated/README.md" },
      ],
    },
  ]);

  assert.equal(report.ok, true);
  assert.equal(report.forbiddenCount, 0);
});

test("package boundary parses npm pack json and blocks forbidden files while allowing runtime facades", async () => {
  const packJson = [
    {
      id: "agent-passport@0.1.0",
      filename: "agent-passport-0.1.0.tgz",
      files: [
        { path: "package.json" },
        { path: "src/ledger-agent-run.js" },
        { path: "src/ledger-command-negotiation.js" },
        { path: "src/ledger-core-utils.js" },
        { path: "src/ledger-runtime-memory-homeostasis.js" },
        { path: "src/ledger-runtime-memory-observations.js" },
        { path: "src/ledger-runtime-memory-store.js" },
        { path: "src/ledger-runtime-state.js" },
        { path: "src/openneed-compat-manifest.js" },
        { path: "docs/generated/README.md" },
        { path: "docs/generated/internal-snapshot.json" },
        { path: "data/recovery-bundles/recovery.json" },
      ],
    },
  ];

  const report = await verifyPackageBoundary({
    cwd: rootDir,
    execFileImpl: async (command, args, options) => {
      assert.equal(command, "npm");
      assert.deepEqual(args, ["pack", "--dry-run", "--json"]);
      assert.equal(options.cwd, rootDir);
      return {
        stdout: `npm notice dry-run metadata\n${JSON.stringify(packJson, null, 2)}\n`,
      };
    },
  });

  assert.equal(report.ok, false);
  assert.deepEqual(
    report.violations.map((entry) => [entry.id, entry.path]),
    [
      ["generated_docs", "docs/generated/internal-snapshot.json"],
      ["runtime_data", "data/recovery-bundles/recovery.json"],
    ]
  );
});

test("package boundary verifier is wired into npm smoke guards", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const smokeGuardScript = packageJson.scripts?.["test:smoke:guards"] || "";

  assert.match(packageJson.scripts?.["verify:package-boundary"] || "", /verify-package-boundary\.mjs/);
  assert.match(smokeGuardScript, /tests\/package-boundary\.test\.mjs/);
  execFileSync(process.execPath, ["--check", path.join(rootDir, "scripts", "verify-package-boundary.mjs")], {
    cwd: rootDir,
    stdio: "pipe",
  });
});

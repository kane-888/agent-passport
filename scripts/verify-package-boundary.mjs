import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const FORBIDDEN_PACKAGE_PATH_RULES = [
  { id: "os_metadata", pattern: /(?:^|\/)\.DS_Store$/u },
  { id: "git_metadata", pattern: /^\.git(?:\/|$)/u },
  { id: "github_metadata", pattern: /^\.github(?:\/|$)/u },
  { id: "node_modules", pattern: /^node_modules(?:\/|$)/u },
  { id: "runtime_data", pattern: /^data(?:\/|$)/u },
  { id: "deploy_env", pattern: /^deploy\/\.env$/u },
  { id: "cpuprofile", pattern: /\.cpuprofile$/u },
  { id: "tarball", pattern: /\.tgz$/u },
  { id: "log_file", pattern: /\.log$/u },
  { id: "coverage_output", pattern: /^coverage(?:\/|$)/u },
  { id: "nyc_output", pattern: /^\.nyc_output(?:\/|$)/u },
  { id: "test_results", pattern: /^test-results(?:\/|$)/u },
  { id: "playwright_report", pattern: /^playwright-report(?:\/|$)/u },
  { id: "screenshot_output", pattern: /^screenshots?(?:\/|$)/u },
  { id: "temp_output", pattern: /^(?:tmp|temp)(?:\/|$)/u },
  { id: "presentation_assets", pattern: /^docs\/.*\.pptx$/u },
  { id: "internal_docx", pattern: /^(?:agent-passport-question-response\.docx|docs\/.*\.docx)$/u },
  { id: "generated_docs_html", pattern: /^docs\/.*\.html$/u },
  { id: "generated_docs", pattern: /^docs\/generated\/(?!README\.md$).+/u },
  { id: "fundraising_assets", pattern: /^docs\/assets\/fundraising-bp(?:\/|$)/u },
  { id: "fundraising_copy", pattern: /^docs\/fundraising-.*\.md$/u },
  {
    id: "openneed_engine_docs",
    pattern: /^docs\/openneed-memory-homeostasis-engine-(?!autonomous-thread-).*\.md$/u,
  },
  {
    id: "autonomous_thread_draft",
    pattern: /^docs\/openneed-memory-homeostasis-engine-autonomous-thread-.*\.md$/u,
  },
  { id: "debug_demo_script", pattern: /^scripts\/demo-context-collapse-debug\.mjs$/u },
  { id: "bp_screenshot_generator", pattern: /^scripts\/capture-bp-screenshots\.mjs$/u },
  { id: "bp_ppt_generator", pattern: /^scripts\/generate_fundraising_ppt\.py$/u },
];

function parsePackJson(output = "") {
  const trimmed = String(output || "").trim();
  if (!trimmed) {
    throw new Error("npm pack --dry-run returned empty output");
  }
  try {
    return JSON.parse(trimmed);
  } catch {}

  for (let index = trimmed.lastIndexOf("\n["); index >= 0; index = trimmed.lastIndexOf("\n[", index - 1)) {
    const candidate = trimmed.slice(index + 1).trim();
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  throw new Error("npm pack --dry-run did not return parseable JSON");
}

export function collectForbiddenPackagePaths(files = [], rules = FORBIDDEN_PACKAGE_PATH_RULES) {
  const normalizedFiles = Array.isArray(files) ? files : [];
  const violations = [];
  for (const entry of normalizedFiles) {
    const path = String(entry?.path || entry || "").replace(/\\/gu, "/");
    if (!path) {
      continue;
    }
    for (const rule of rules) {
      if (rule.pattern.test(path)) {
        violations.push({ id: rule.id, path });
      }
    }
  }
  return violations;
}

export function buildPackageBoundaryReport(packEntries = []) {
  const entries = Array.isArray(packEntries) ? packEntries : [];
  const packages = entries.map((entry) => ({
    id: entry.id || `${entry.name || "package"}@${entry.version || "unknown"}`,
    filename: entry.filename || null,
    size: Number(entry.size || 0),
    unpackedSize: Number(entry.unpackedSize || 0),
    entryCount: Number(entry.entryCount || entry.files?.length || 0),
    violations: collectForbiddenPackagePaths(entry.files || []),
  }));
  const violations = packages.flatMap((entry) =>
    entry.violations.map((violation) => ({
      ...violation,
      packageId: entry.id,
      filename: entry.filename,
    }))
  );

  return {
    ok: violations.length === 0,
    checkedAt: new Date().toISOString(),
    packageCount: packages.length,
    packages,
    forbiddenCount: violations.length,
    violations,
  };
}

export async function verifyPackageBoundary({ cwd = process.cwd(), execFileImpl = execFileAsync } = {}) {
  const { stdout } = await execFileImpl("npm", ["pack", "--dry-run", "--json"], {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  return buildPackageBoundaryReport(parsePackJson(stdout));
}

async function main() {
  const report = await verifyPackageBoundary();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { printCliError, printCliResult } from "./structured-cli-output.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_RUNTIME_CONTRACT_SUITES = Object.freeze([
  Object.freeze({
    id: "offline_chat_runtime",
    label: "offline-chat runtime",
    testFiles: ["tests/offline-chat-runtime.test.mjs"],
  }),
  Object.freeze({
    id: "runner_auto_recovery_restart",
    label: "runner auto-recovery restart",
    testFiles: ["tests/runner-auto-recovery-restart.test.mjs"],
  }),
  Object.freeze({
    id: "runner_local_first_quality_gate",
    label: "runner local-first quality gate",
    testFiles: ["tests/runner-local-first-quality-gate.test.mjs"],
  }),
  Object.freeze({
    id: "formal_recovery_freshness",
    label: "formal recovery freshness",
    testFiles: ["tests/formal-recovery-rehearsal-recency.test.mjs"],
  }),
  Object.freeze({
    id: "ledger_recovery_setup_cache",
    label: "ledger-recovery-setup cache",
    testFiles: ["tests/ledger-recovery-setup-cache.test.mjs"],
  }),
  Object.freeze({
    id: "soak_runtime_stability",
    label: "soak runtime stability",
    testFiles: ["tests/soak-runtime-stability.test.mjs"],
  }),
]);

function text(value) {
  return String(value ?? "").trim();
}

function truncateDetail(value = "", limit = 1200) {
  const normalized = text(value);
  if (!normalized || normalized.length <= limit) {
    return normalized || null;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function resolveGoLiveRuntimeContractSuiteEntries(rawEntries = [], cwd = rootDir) {
  return rawEntries
    .map((entry) => text(entry))
    .filter(Boolean)
    .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(cwd, entry)));
}

function flattenGoLiveRuntimeContractTestFiles(suites = []) {
  const files = [];
  for (const suite of Array.isArray(suites) ? suites : []) {
    for (const entry of Array.isArray(suite?.testFiles) ? suite.testFiles : []) {
      if (!files.includes(entry)) {
        files.push(entry);
      }
    }
  }
  return files;
}

export function resolveGoLiveRuntimeContractSuites({
  cwd = rootDir,
  env = process.env,
} = {}) {
  const configured = text(env.AGENT_PASSPORT_GO_LIVE_RUNTIME_CONTRACT_TESTS);
  if (configured) {
    return [
      {
        id: "configured_runtime_contracts",
        label: "configured runtime contracts",
        testFiles: resolveGoLiveRuntimeContractSuiteEntries(configured.split(path.delimiter), cwd),
      },
    ];
  }
  return DEFAULT_RUNTIME_CONTRACT_SUITES.map((suite) => ({
    id: suite.id,
    label: suite.label,
    testFiles: resolveGoLiveRuntimeContractSuiteEntries(suite.testFiles, cwd),
  }));
}

export function summarizeGoLiveRuntimeContractCoverage(suites = []) {
  const labels = (Array.isArray(suites) ? suites : [])
    .map((suite) => text(suite?.label))
    .filter(Boolean);
  return labels.length > 0 ? `覆盖链路：${labels.join("、")}。` : null;
}

export function resolveGoLiveRuntimeContractTestFiles({
  cwd = rootDir,
  env = process.env,
} = {}) {
  return flattenGoLiveRuntimeContractTestFiles(resolveGoLiveRuntimeContractSuites({ cwd, env }));
}

export function resolveGoLiveRuntimeContractTimeoutMs(env = process.env) {
  const parsed = Number.parseInt(text(env.AGENT_PASSPORT_GO_LIVE_RUNTIME_CONTRACT_TIMEOUT_MS), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export async function verifyGoLiveRuntimeContracts({
  cwd = rootDir,
  env = process.env,
  suites = resolveGoLiveRuntimeContractSuites({ cwd, env }),
  testFiles = flattenGoLiveRuntimeContractTestFiles(suites),
  timeoutMs = resolveGoLiveRuntimeContractTimeoutMs(env),
  skip = text(env.AGENT_PASSPORT_SKIP_GO_LIVE_RUNTIME_CONTRACTS) === "1",
} = {}) {
  const coverageSummary = summarizeGoLiveRuntimeContractCoverage(suites);
  const coverage = {
    source: text(env.AGENT_PASSPORT_GO_LIVE_RUNTIME_CONTRACT_TESTS) ? "configured" : "default",
    suites,
    summary: coverageSummary,
  };
  if (skip) {
    return {
      ok: null,
      skipped: true,
      status: "skipped",
      errorClass: "runtime_contract_tests_skipped",
      checkedAt: new Date().toISOString(),
      coverage,
      testFiles,
      summary: coverageSummary
        ? `关键运行契约门禁已按环境配置跳过，本次不能视为通过。${coverageSummary}`
        : "关键运行契约门禁已按环境配置跳过，本次不能视为通过。",
    };
  }

  if (!Array.isArray(testFiles) || testFiles.length === 0) {
    return {
      ok: false,
      status: "failed",
      errorClass: "runtime_contract_tests_missing",
      checkedAt: new Date().toISOString(),
      coverage,
      testFiles: [],
      summary: coverageSummary
        ? `关键运行契约门禁未配置任何测试文件。${coverageSummary}`
        : "关键运行契约门禁未配置任何测试文件。",
      detail: "请设置 AGENT_PASSPORT_GO_LIVE_RUNTIME_CONTRACT_TESTS，或恢复默认 go-live 关键测试集合。",
    };
  }

  return new Promise((resolve, reject) => {
    const childEnv = {
      ...env,
      AGENT_PASSPORT_USE_KEYCHAIN: text(env.AGENT_PASSPORT_USE_KEYCHAIN) || "0",
    };
    for (const key of [
      "NODE_TEST_CONTEXT",
      "NODE_TEST_NAME_PATTERN",
      "NODE_TEST_ONLY",
      "NODE_TEST_REPORTER",
      "NODE_TEST_SHARD",
      "NODE_TEST_TIMEOUT",
    ]) {
      delete childEnv[key];
    }
    let settled = false;
    const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...testFiles], {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve({
        checkedAt: new Date().toISOString(),
        coverage,
        testFiles,
        durationMs: Date.now() - startedAt,
        ...result,
      });
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    });

    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      try {
        child.kill("SIGTERM");
      } catch {}
      finish({
        ok: false,
        status: "failed",
        errorClass: "runtime_contract_tests_timeout",
        summary: coverageSummary
          ? `关键运行契约门禁超时（${timeoutMs}ms）。${coverageSummary}`
          : `关键运行契约门禁超时（${timeoutMs}ms）。`,
        detail: truncateDetail(stderr || stdout) || `node --test timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.on("exit", (code) => {
      const combined = truncateDetail(stderr || stdout);
      if (code === 0) {
        finish({
          ok: true,
          status: "passed",
          summary: coverageSummary
            ? `关键运行契约门禁已通过。${coverageSummary}`
            : "关键运行契约门禁已通过。",
          detail: null,
        });
        return;
      }
      finish({
        ok: false,
        status: "failed",
        errorClass: "runtime_contract_tests_failed",
        summary: coverageSummary
          ? `关键运行契约门禁未通过。${coverageSummary}`
          : "关键运行契约门禁未通过。",
        detail: combined || `node --test exited with code ${code}`,
      });
    });
  });
}

async function main() {
  const result = await verifyGoLiveRuntimeContracts();
  await printCliResult(result);
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

if (isDirectRun) {
  main().catch((error) => printCliError(error));
}

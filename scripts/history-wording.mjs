import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const defaultDataDir = path.join(rootDir, "data");

const args = new Set(process.argv.slice(2));
const applyChanges = args.has("--apply");
const includeLiveLedger = args.has("--include-live-ledger");

const wordingRules = [
  {
    id: "passport_truth_source_cn",
    pattern: /Passport store 才是真相源/g,
    replacement: "Passport store 才是本地参考源",
  },
  {
    id: "bootstrap_truth_source_cn",
    pattern: /冷启动真相源/g,
    replacement: "冷启动参考源",
  },
  {
    id: "llm_truth_source_cn",
    pattern: /LLM 不是真相源/g,
    replacement: "LLM 不是本地参考源",
  },
  {
    id: "truth_source_cn",
    pattern: /真相源/g,
    replacement: "本地参考源",
  },
  {
    id: "truth_source_en",
    pattern: /\btruth-source\b/gi,
    replacement: "local-reference",
  },
  {
    id: "source_of_truth_en",
    pattern: /\bsource of truth\b/gi,
    replacement: "local reference source",
  },
  {
    id: "verification_run_en",
    pattern: /\bverification run\b/gi,
    replacement: "integrity run",
  },
  {
    id: "verification_run_cn",
    pattern: /verification run/g,
    replacement: "integrity run",
  },
  {
    id: "verifier_en",
    pattern: /\bverifier\b/gi,
    replacement: "checker",
  },
  {
    id: "run_receipt_en",
    pattern: /\brun receipt\b/gi,
    replacement: "run record",
  },
  {
    id: "execution_receipt_en",
    pattern: /\bexecution receipt\b/gi,
    replacement: "execution record",
  },
  {
    id: "receipt_demo_en",
    pattern: /\bReceipt demo\b/g,
    replacement: "Record demo",
  },
];

function shouldScanFile(filePath) {
  const basename = path.basename(filePath);
  if (basename === "ledger.json" || basename.endsWith(".json") || basename.endsWith(".jsonl")) {
    return true;
  }
  return basename.includes(".corrupt-backup-");
}

function isMutableHistoricalArtifact(filePath) {
  const relative = path.relative(defaultDataDir, filePath);
  if (!relative || relative.startsWith("..")) {
    return false;
  }
  if (relative === "ledger.json") {
    return includeLiveLedger;
  }
  return true;
}

async function collectFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (shouldScanFile(fullPath)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function applyRulesToString(value) {
  if (typeof value !== "string" || value.length === 0) {
    return { value, replacements: [] };
  }

  let nextValue = value;
  const replacements = [];
  for (const rule of wordingRules) {
    const matches = Array.from(nextValue.matchAll(rule.pattern));
    if (matches.length === 0) {
      continue;
    }
    nextValue = nextValue.replace(rule.pattern, rule.replacement);
    replacements.push({
      ruleId: rule.id,
      count: matches.length,
    });
  }
  return {
    value: nextValue,
    replacements,
  };
}

function rewriteJsonValue(value, state) {
  if (typeof value === "string") {
    const result = applyRulesToString(value);
    for (const replacement of result.replacements) {
      state.changed = true;
      state.ruleCounts[replacement.ruleId] = (state.ruleCounts[replacement.ruleId] || 0) + replacement.count;
      state.totalReplacements += replacement.count;
    }
    return result.value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => rewriteJsonValue(entry, state));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = rewriteJsonValue(entry, state);
  }
  return next;
}

async function rewriteJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const state = {
    changed: false,
    totalReplacements: 0,
    ruleCounts: {},
  };
  const rewritten = rewriteJsonValue(parsed, state);
  return {
    filePath,
    format: "json",
    rewritable: isMutableHistoricalArtifact(filePath),
    changed: state.changed,
    totalReplacements: state.totalReplacements,
    ruleCounts: state.ruleCounts,
    nextContent: state.changed ? `${JSON.stringify(rewritten, null, 2)}\n` : raw,
  };
}

async function rewriteJsonlFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n");
  const nextLines = [];
  const state = {
    changed: false,
    totalReplacements: 0,
    ruleCounts: {},
  };
  for (const line of lines) {
    if (!line.trim()) {
      nextLines.push(line);
      continue;
    }
    const parsed = JSON.parse(line);
    const rewritten = rewriteJsonValue(parsed, state);
    nextLines.push(JSON.stringify(rewritten));
  }
  return {
    filePath,
    format: "jsonl",
    rewritable: isMutableHistoricalArtifact(filePath),
    changed: state.changed,
    totalReplacements: state.totalReplacements,
    ruleCounts: state.ruleCounts,
    nextContent: state.changed ? `${nextLines.join("\n")}\n` : raw,
  };
}

async function rewriteRawTextFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const result = applyRulesToString(raw);
  const totalReplacements = result.replacements.reduce((sum, entry) => sum + entry.count, 0);
  return {
    filePath,
    format: "text",
    rewritable: isMutableHistoricalArtifact(filePath),
    changed: totalReplacements > 0,
    totalReplacements,
    ruleCounts: Object.fromEntries(result.replacements.map((entry) => [entry.ruleId, entry.count])),
    nextContent: result.value,
  };
}

async function inspectFile(filePath) {
  if (filePath.endsWith(".jsonl")) {
    return rewriteJsonlFile(filePath);
  }
  try {
    return await rewriteJsonFile(filePath);
  } catch (error) {
    if (error instanceof SyntaxError || String(error?.message || "").includes("JSON")) {
      return rewriteRawTextFile(filePath);
    }
    throw error;
  }
}

async function main() {
  const files = await collectFiles(defaultDataDir).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const reports = [];
  for (const filePath of files) {
    try {
      const report = await inspectFile(filePath);
      if (!report.changed) {
        continue;
      }
      if (applyChanges && report.rewritable) {
        await fs.writeFile(filePath, report.nextContent, "utf8");
      }
      reports.push({
        filePath,
        format: report.format,
        rewritable: report.rewritable,
        changed: report.changed,
        applied: Boolean(applyChanges && report.rewritable),
        skipped: Boolean(applyChanges && !report.rewritable),
        totalReplacements: report.totalReplacements,
        ruleCounts: report.ruleCounts,
      });
    } catch (error) {
      reports.push({
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary = reports.reduce(
    (acc, report) => {
      if (report.error) {
        acc.errorCount += 1;
        return acc;
      }
      acc.matchedFileCount += 1;
      acc.totalReplacements += Number(report.totalReplacements || 0);
      if (report.applied) {
        acc.appliedFileCount += 1;
      }
      if (report.skipped) {
        acc.skippedFileCount += 1;
      }
      return acc;
    },
    {
      root: defaultDataDir,
      applyChanges,
      includeLiveLedger,
      scannedFileCount: files.length,
      matchedFileCount: 0,
      appliedFileCount: 0,
      skippedFileCount: 0,
      totalReplacements: 0,
      errorCount: 0,
    }
  );

  console.log(
    JSON.stringify(
      {
        ok: summary.errorCount === 0,
        summary,
        reports,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});

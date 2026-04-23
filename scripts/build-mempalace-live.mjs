import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MEMPALACE_COMMAND } from "../src/mempalace-runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const documentsRoot = path.dirname(repoRoot);
const contextCollapseSource = path.join(documentsRoot, "上下文坍缩测试工具");
const stagingRoot =
  process.env.AGENT_PASSPORT_MEMPALACE_STAGING_ROOT ??
  path.join(os.homedir(), ".mempalace", "agent-passport-live-corpus");
const palacePath =
  process.env.AGENT_PASSPORT_MEMPALACE_PALACE_PATH ??
  process.env.MEMPALACE_PALACE_PATH ??
  process.env.MEMPAL_PALACE_PATH ??
  path.join(os.homedir(), ".mempalace", "agent-passport-sidecar-palace");
const command = process.env.AGENT_PASSPORT_MEMPALACE_COMMAND ?? DEFAULT_MEMPALACE_COMMAND;
const chromaModelDir = path.join(os.homedir(), ".cache", "chroma", "onnx_models", "all-MiniLM-L6-v2");
const chromaModelArchivePath = path.join(chromaModelDir, "onnx.tar.gz");
const chromaModelExtractedDir = path.join(chromaModelDir, "onnx");
const CHROMA_MODEL_URL = "https://chroma-onnx-models.s3.amazonaws.com/all-MiniLM-L6-v2/onnx.tar.gz";
const CHROMA_MODEL_SHA256 = "913d7300ceae3b2dbc2c50d1de4baacab4be7b9380491c27fab7418616a16ec3";

const ALLOWED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".py",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".css",
  ".java",
  ".go",
  ".rs",
  ".rb",
  ".sh",
  ".csv",
  ".sql",
  ".toml",
]);

const corpora = [
  {
    stageName: "agent-passport-runtime",
    sourceRoot: repoRoot,
    include: ["README.md", "package.json", "docs", "src", "scripts", "public"],
    config: {
      wing: "agent_passport_memory_engine",
      rooms: [
        {
          name: "docs",
          description: "Architecture, positioning, and operating documents",
          keywords: ["docs", "readme", "architecture", "memory", "agent-passport", "上下文坍缩"],
        },
        {
          name: "runtime",
          description: "Core runtime and retrieval code",
          keywords: ["src", "server", "ledger", "reasoner", "runtime", "mempalace"],
        },
        {
          name: "scripts",
          description: "Verification, smoke, and demo scripts",
          keywords: ["scripts", "verify", "smoke", "demo", "context collapse"],
        },
        {
          name: "ui",
          description: "Public application assets",
          keywords: ["public", "ui", "html", "css", "browser"],
        },
        {
          name: "general",
          description: "General project context",
          keywords: ["project", "product", "package"],
        },
      ],
    },
  },
];

if (existsSync(contextCollapseSource)) {
  corpora.push({
    stageName: "context-collapse-tool",
    sourceRoot: contextCollapseSource,
    include: ["README.md", "context-collapse-metric-spec.md", "app.js", "metrics.js", "index.html", "styles.css", "benchmark_server.py", "sample-results.json"],
    config: {
      wing: "context_collapse_test_tool",
      rooms: [
        {
          name: "metrics",
          description: "Metric definitions and benchmark logic",
          keywords: ["metrics", "benchmark", "collapse", "context", "上下文坍缩"],
        },
        {
          name: "ui",
          description: "UI and presentation layer",
          keywords: ["ui", "index", "styles", "app"],
        },
        {
          name: "general",
          description: "General supporting context",
          keywords: ["readme", "sample", "results"],
        },
      ],
    },
  });
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function buildCommandEnv() {
  return {
    ...process.env,
    MEMPALACE_PALACE_PATH: palacePath,
    MEMPAL_PALACE_PATH: palacePath,
  };
}

function runStreamingCommand(executable, args) {
  const result = spawnSync(executable, args, {
    stdio: "inherit",
    env: buildCommandEnv(),
    maxBuffer: 1024 * 1024 * 8,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message || `${executable} ${args.join(" ")} exited with code ${result.status}`
    );
  }
}

function runCommand(args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    env: buildCommandEnv(),
    maxBuffer: 1024 * 1024 * 8,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ||
        result.stderr ||
        result.stdout ||
        `${command} ${args.join(" ")} exited with code ${result.status}`
    );
  }
  return String(result.stdout || "").trim();
}

async function sha256File(filePath) {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function ensureChromaEmbeddingArchive() {
  await fs.mkdir(chromaModelDir, { recursive: true });
  const hasArchive = existsSync(chromaModelArchivePath);
  if (hasArchive) {
    const digest = await sha256File(chromaModelArchivePath);
    if (digest === CHROMA_MODEL_SHA256) {
      if (!existsSync(chromaModelExtractedDir)) {
        runStreamingCommand("/usr/bin/tar", ["-xzf", chromaModelArchivePath, "-C", chromaModelDir]);
      }
      return;
    }
    await fs.rm(chromaModelArchivePath, { force: true });
  }

  runStreamingCommand("/usr/bin/curl", [
    "--fail",
    "--retry",
    "5",
    "--retry-all-errors",
    "-L",
    CHROMA_MODEL_URL,
    "-o",
    chromaModelArchivePath,
  ]);
  const digest = await sha256File(chromaModelArchivePath);
  if (digest !== CHROMA_MODEL_SHA256) {
    throw new Error(`Downloaded Chroma ONNX archive failed SHA256 verification: ${digest}`);
  }
  if (!existsSync(chromaModelExtractedDir)) {
    runStreamingCommand("/usr/bin/tar", ["-xzf", chromaModelArchivePath, "-C", chromaModelDir]);
  }
}

async function copyFile(sourceFile, targetFile) {
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  await fs.copyFile(sourceFile, targetFile);
}

async function copyTree(sourceRoot, targetRoot, relativePath) {
  const sourcePath = path.join(sourceRoot, relativePath);
  const targetPath = path.join(targetRoot, relativePath);
  const stat = await fs.stat(sourcePath);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      const childRelative = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        await copyTree(sourceRoot, targetRoot, childRelative);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      await copyFile(path.join(sourceRoot, childRelative), path.join(targetRoot, childRelative));
    }
    return;
  }

  if (!ALLOWED_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) {
    return;
  }
  await copyFile(sourcePath, targetPath);
}

async function writeConfig(targetRoot, config) {
  const lines = [`wing: ${yamlString(config.wing)}`, "rooms:"];
  for (const room of config.rooms) {
    lines.push(`  - name: ${yamlString(room.name)}`);
    lines.push(`    description: ${yamlString(room.description)}`);
    lines.push("    keywords:");
    for (const keyword of room.keywords) {
      lines.push(`      - ${yamlString(keyword)}`);
    }
  }
  await fs.writeFile(path.join(targetRoot, "mempalace.yaml"), `${lines.join("\n")}\n`, "utf8");
}

async function prepareCorpus(corpus) {
  const targetRoot = path.join(stagingRoot, corpus.stageName);
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });
  for (const relativePath of corpus.include) {
    const sourcePath = path.join(corpus.sourceRoot, relativePath);
    if (!existsSync(sourcePath)) {
      continue;
    }
    await copyTree(corpus.sourceRoot, targetRoot, relativePath);
  }
  await writeConfig(targetRoot, corpus.config);
  return targetRoot;
}

await fs.mkdir(path.dirname(palacePath), { recursive: true });
await fs.rm(stagingRoot, { recursive: true, force: true });
await fs.mkdir(stagingRoot, { recursive: true });
await fs.rm(palacePath, { recursive: true, force: true });
await ensureChromaEmbeddingArchive();

const mined = [];
for (const corpus of corpora) {
  const targetRoot = await prepareCorpus(corpus);
  runStreamingCommand(command, ["--palace", palacePath, "mine", targetRoot, "--agent", "agent-passport"]);
  mined.push({
    wing: corpus.config.wing,
    sourceRoot: corpus.sourceRoot,
    stagedRoot: targetRoot,
  });
}

const status = runCommand(["--palace", palacePath, "status"]);

console.log(
  JSON.stringify(
    {
      ok: true,
      palacePath,
      stagingRoot,
      command,
      mined,
      status,
    },
    null,
    2
  )
);

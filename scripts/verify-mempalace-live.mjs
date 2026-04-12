import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { access } from "node:fs/promises";
import { buildAgentContextBundle, getLedger, listAgents } from "../src/ledger.js";
import {
  DEFAULT_MEMPALACE_PALACE_PATH,
  searchMempalaceColdMemory,
} from "../src/mempalace-runtime.js";

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function withEnv(overrides = {}, callback) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function inspectMempalaceCollections(palacePath) {
  const python = path.join(os.homedir(), ".local", "share", "mempalace", "venv", "bin", "python");
  const script = [
    "import chromadb, json, sys",
    "client = chromadb.PersistentClient(path=sys.argv[1])",
    "collections = []",
    "for item in client.list_collections():",
    "    if isinstance(item, str):",
    "        collections.append(item)",
    "        continue",
    "    try:",
    "        collections.append(item.name)",
    "    except Exception:",
    "        collections.append(str(item))",
    "print(json.dumps(collections, ensure_ascii=False))",
  ].join("\n");
  const result = spawnSync(python, ["-c", script, palacePath], {
    encoding: "utf8",
    timeout: 4000,
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error: result.error?.message || result.stderr || result.stdout || `python exited with ${result.status}`,
      collections: [],
    };
  }
  const lines = String(result.stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const payload = lines.at(-1) ?? "[]";
  try {
    const collections = JSON.parse(payload);
    return {
      ok: true,
      collections: Array.isArray(collections) ? collections : [],
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      collections: [],
    };
  }
}

const query = process.argv.slice(2).join(" ").trim() || "上下文坍缩";
const palacePath =
  process.env.AGENT_PASSPORT_MEMPALACE_PALACE_PATH ||
  process.env.MEMPALACE_PALACE_PATH ||
  process.env.MEMPAL_PALACE_PATH ||
  DEFAULT_MEMPALACE_PALACE_PATH;

async function inspectRuntimeContextBundle(runtimeQuery) {
  return withEnv(
    {
      AGENT_PASSPORT_EXTERNAL_COLD_MEMORY_ENABLED: "1",
      AGENT_PASSPORT_MEMPALACE_PALACE_PATH: palacePath,
    },
    async () => {
      const store = await getLedger();
      const residentAgentId = store?.deviceRuntime?.residentAgentId ?? null;
      const agents = await listAgents();
      const targetAgentId = residentAgentId || agents[0]?.agentId || null;
      if (!targetAgentId) {
        return {
          attempted: false,
          skipped: true,
          reason: "no_agent_available",
        };
      }

      const contextBuilder = await buildAgentContextBundle(targetAgentId, { query: runtimeQuery });
      return {
        attempted: true,
        skipped: false,
        mode: "env_override",
        agentId: targetAgentId,
        localKnowledgeHitCount: Array.isArray(contextBuilder?.localKnowledge?.hits)
          ? contextBuilder.localKnowledge.hits.length
          : 0,
        externalColdMemoryHitCount: Array.isArray(contextBuilder?.externalColdMemory?.hits)
          ? contextBuilder.externalColdMemory.hits.length
          : 0,
        externalColdMemoryProvider: contextBuilder?.externalColdMemory?.provider ?? null,
        externalColdMemoryCandidateOnly: contextBuilder?.externalColdMemory?.candidateOnly ?? true,
        externalColdMemoryError: contextBuilder?.externalColdMemory?.error ?? null,
      };
    }
  );
}

const chromaSqlitePath = path.join(palacePath, "chroma.sqlite3");
const chromaSqlitePresent = await pathExists(chromaSqlitePath);
const collectionDiagnostics = chromaSqlitePresent
  ? inspectMempalaceCollections(palacePath)
  : {
      ok: false,
      error: "chroma.sqlite3 not found",
      collections: [],
    };

if (!chromaSqlitePresent) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        query,
        palacePathConfigured: true,
        palacePathName: path.basename(palacePath),
        provider: "mempalace",
        method: null,
        hitCount: 0,
        error: "palace_not_built",
        diagnostics: {
          chromaSqlitePresent: false,
          collectionCount: 0,
          collections: [],
          collectionInspectionOk: collectionDiagnostics.ok,
          collectionInspectionError: collectionDiagnostics.error || null,
        },
        runtimeContext: {
          attempted: false,
          skipped: true,
          reason: "palace_not_built",
        },
        hint: "当前 sidecar palace 还没构建；先运行 npm run build:mempalace:live。",
      },
      null,
      2
    )
  );
  process.exitCode = 1;
  process.exit();
}

const result = searchMempalaceColdMemory(query, {
  enabled: true,
  provider: "mempalace",
  palacePath,
  maxHits: 3,
  timeoutMs: 30000,
});
const runtimeContext = await inspectRuntimeContextBundle(query);
const runtimeContextFailed = runtimeContext.attempted && runtimeContext.externalColdMemoryHitCount < 1;
if (result.error || result.hits.length < 1 || runtimeContextFailed) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        query,
        palacePathConfigured: true,
        palacePathName: path.basename(palacePath),
        provider: result.provider,
        method: result.method,
        hitCount: result.hits.length,
        error:
          result.error ||
          (result.hits.length < 1
            ? "no_hits"
            : `runtime_context_missing_external_hits(external=${runtimeContext.externalColdMemoryHitCount})`),
        diagnostics: {
          chromaSqlitePresent: true,
          collectionCount: collectionDiagnostics.collections.length,
          collections: collectionDiagnostics.collections,
          collectionInspectionOk: collectionDiagnostics.ok,
          collectionInspectionError: collectionDiagnostics.error || null,
        },
        runtimeContext,
        hint:
          collectionDiagnostics.collections.length === 0
            ? "当前 sidecar palace 目录存在，但没有可检索 collections；先运行 npm run build:mempalace:live。"
            : /timed?out|ETIMEDOUT/u.test(String(result.error || ""))
              ? "mempalace 首次搜索可能在下载本地 embedding 模型；稍等后重试，或先手动跑一次 mempalace search 预热缓存。"
            : runtimeContextFailed
              ? "sidecar 直连检索已命中，但 context builder 没带出 external cold memory；检查 retrieval 配置链。"
              : "当前 sidecar palace 可访问，但本次 query 没命中；请换 query 或先运行 npm run build:mempalace:live 重建语料。",
      },
      null,
      2
    )
  );
  process.exitCode = 1;
  process.exit();
}

console.log(
  JSON.stringify(
    {
      ok: true,
      query,
      palacePathConfigured: true,
      palacePathName: path.basename(palacePath),
      provider: result.provider,
      method: result.method,
      hitCount: result.hits.length,
      diagnostics: {
        chromaSqlitePresent,
        collectionCount: collectionDiagnostics.collections.length,
        collections: collectionDiagnostics.collections,
      },
      runtimeContext,
      hits: result.hits.map((entry) => ({
        sourceId: entry.sourceId,
        summary: entry.summary,
        providerScore: entry.providerScore,
        candidateOnly: entry.candidateOnly,
        provider: entry.linked?.provider ?? null,
      })),
    },
    null,
    2
  )
);

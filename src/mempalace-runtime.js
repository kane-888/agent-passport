import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cloneJson,
  normalizeBooleanFlag,
  normalizeOptionalText,
  toFiniteNumber,
} from "./ledger-core-utils.js";

export const DEFAULT_EXTERNAL_COLD_MEMORY_PROVIDER = "mempalace";
export const DEFAULT_MEMPALACE_COMMAND =
  normalizeOptionalText(process.env.AGENT_PASSPORT_MEMPALACE_COMMAND) ?? "mempalace";
export const DEFAULT_MEMPALACE_PALACE_PATH =
  normalizeOptionalText(
    process.env.AGENT_PASSPORT_MEMPALACE_PALACE_PATH ??
      process.env.MEMPALACE_PALACE_PATH ??
      process.env.MEMPAL_PALACE_PATH
  ) ?? path.join(os.homedir(), ".mempalace", "openneed-sidecar-palace");
export const DEFAULT_MEMPALACE_TIMEOUT_MS = Math.max(
  500,
  Math.floor(toFiniteNumber(process.env.AGENT_PASSPORT_MEMPALACE_TIMEOUT_MS, 2500))
);
export const DEFAULT_MEMPALACE_MAX_HITS = Math.max(
  1,
  Math.floor(toFiniteNumber(process.env.AGENT_PASSPORT_MEMPALACE_MAX_HITS, 3))
);

function normalizeMempalaceProvider(value) {
  const normalized =
    normalizeOptionalText(value)?.toLowerCase().replace(/[\s-]+/g, "_") ??
    DEFAULT_EXTERNAL_COLD_MEMORY_PROVIDER;
  return normalized === DEFAULT_EXTERNAL_COLD_MEMORY_PROVIDER
    ? DEFAULT_EXTERNAL_COLD_MEMORY_PROVIDER
    : DEFAULT_EXTERNAL_COLD_MEMORY_PROVIDER;
}

function compactSearchText(text, maxLength = 280) {
  const normalized = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildMempalaceEnv(config = {}) {
  const env = { ...process.env };
  const palacePath = normalizeOptionalText(config.palacePath) ?? null;
  if (palacePath) {
    env.AGENT_PASSPORT_MEMPALACE_PALACE_PATH = palacePath;
    env.MEMPALACE_PALACE_PATH = palacePath;
    env.MEMPAL_PALACE_PATH = palacePath;
  } else {
    delete env.AGENT_PASSPORT_MEMPALACE_PALACE_PATH;
  }
  const wing = normalizeOptionalText(config.wing) ?? null;
  const room = normalizeOptionalText(config.room) ?? null;
  if (wing) {
    env.AGENT_PASSPORT_MEMPALACE_WING = wing;
  } else {
    delete env.AGENT_PASSPORT_MEMPALACE_WING;
  }
  if (room) {
    env.AGENT_PASSPORT_MEMPALACE_ROOM = room;
  } else {
    delete env.AGENT_PASSPORT_MEMPALACE_ROOM;
  }
  env.AGENT_PASSPORT_MEMPALACE_MAX_HITS = String(
    Math.max(1, Math.floor(toFiniteNumber(config.maxHits, DEFAULT_MEMPALACE_MAX_HITS)))
  );
  return env;
}

function summarizeMempalaceProcessFailure(prefix, result = {}) {
  const errorCode = normalizeOptionalText(result?.error?.code) ?? null;
  const errorMessage = normalizeOptionalText(result?.error?.message) ?? null;
  const signal = normalizeOptionalText(result?.signal) ?? null;
  if (errorCode === "ETIMEDOUT" || /timed out/i.test(errorMessage || "")) {
    return `${prefix}_timeout`;
  }
  if (signal) {
    return `${prefix}_signal_${signal.toLowerCase()}`;
  }
  if (Number.isInteger(result?.status)) {
    return `${prefix}_exit_code_${result.status}`;
  }
  if (errorCode) {
    return `${prefix}_spawn_failed`;
  }
  return `${prefix}_failed`;
}

function resolveCommandPath(command) {
  const normalized = normalizeOptionalText(command) ?? null;
  if (!normalized) {
    return null;
  }

  if (path.isAbsolute(normalized) || normalized.includes(path.sep)) {
    return existsSync(normalized) ? normalized : null;
  }

  const locator = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(locator, [normalized], {
    encoding: "utf8",
    timeout: 1000,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  const resolved = normalizeOptionalText(String(result.stdout || "").split(/\r?\n/u)[0]) ?? null;
  return resolved && existsSync(resolved) ? resolved : null;
}

function resolvePythonFromCommand(command) {
  const invocation = resolveCommandInvocation(command);
  const executable = normalizeOptionalText(invocation?.executable) ?? null;
  if (!executable || !/python/i.test(executable)) {
    return null;
  }
  return existsSync(executable) ? executable : null;
}

function resolveCommandInvocation(command) {
  const normalized = normalizeOptionalText(command) ?? null;
  if (!normalized) {
    return null;
  }

  const commandPath = resolveCommandPath(normalized) ?? normalized;
  if (!existsSync(commandPath)) {
    return {
      executable: commandPath,
      args: [],
    };
  }

  try {
    const firstLine = readFileSync(commandPath, "utf8").split(/\r?\n/u)[0] ?? "";
    if (!firstLine.startsWith("#!")) {
      return {
        executable: commandPath,
        args: [],
      };
    }

    const shebangParts = firstLine
      .slice(2)
      .trim()
      .split(/\s+/u)
      .filter(Boolean);

    if (shebangParts.length === 0) {
      return {
        executable: commandPath,
        args: [],
      };
    }

    let executable = shebangParts[0];
    let args = shebangParts.slice(1);
    if (path.basename(executable) === "env" && args.length > 0) {
      executable = resolveCommandPath(args[0]) ?? args[0];
      args = args.slice(1);
    } else if (!path.isAbsolute(executable)) {
      executable = resolveCommandPath(executable) ?? executable;
    }

    return {
      executable: executable || commandPath,
      args: [...args, commandPath],
    };
  } catch {
    return {
      executable: commandPath,
      args: [],
    };
  }
}

function parseProgrammaticSearchOutput(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = lines.at(-1) ?? "";
  if (!candidate) {
    return { error: "mempalace_python_api_empty_output" };
  }
  try {
    return JSON.parse(candidate);
  } catch {
    return {
      error: "mempalace_python_api_parse_failed",
    };
  }
}

function parseMempalaceCliSearchOutput(stdout = "") {
  const hits = [];
  const lines = String(stdout || "").split(/\r?\n/u);
  let current = null;

  const flush = () => {
    if (!current) {
      return;
    }
    const text = current.textLines.join("\n").trim();
    if (text) {
      hits.push({
        text,
        wing: current.wing,
        room: current.room,
        source_file: current.sourceFile,
        similarity: toFiniteNumber(current.similarity, null),
      });
    }
    current = null;
  };

  for (const line of lines) {
    const header = line.match(/^\s*\[(\d+)\]\s+(.+?)\s*\/\s*(.+)\s*$/u);
    if (header) {
      flush();
      current = {
        wing: normalizeOptionalText(header[2]) ?? null,
        room: normalizeOptionalText(header[3]) ?? null,
        sourceFile: null,
        similarity: null,
        textLines: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const trimmed = line.trim();
    if (current.textLines.length === 0) {
      const sourceMatch = trimmed.match(/^Source:\s*(.+)$/u);
      if (sourceMatch) {
        current.sourceFile = normalizeOptionalText(sourceMatch[1]) ?? null;
        continue;
      }
      const similarityMatch = trimmed.match(/^Match:\s*([0-9.]+)$/u);
      if (similarityMatch) {
        current.similarity = toFiniteNumber(similarityMatch[1], null);
        continue;
      }
    }

    if (/^[─-]{8,}$/u.test(trimmed)) {
      flush();
      continue;
    }

    if (line.startsWith("      ")) {
      current.textLines.push(line.slice(6));
    }
  }

  flush();
  return hits;
}

function runProgrammaticMempalaceSearch(query, config) {
  const python = resolvePythonFromCommand(config.command);
  if (!python) {
    return null;
  }

  const script = [
    "import json",
    "import os",
    "import sys",
    "from mempalace.config import MempalaceConfig",
    "from mempalace.searcher import search_memories",
    "query = sys.stdin.read().strip()",
    "if not query:",
    "    raise SystemExit(2)",
    "config = MempalaceConfig()",
    "palace_path = os.environ.get('AGENT_PASSPORT_MEMPALACE_PALACE_PATH') or os.environ.get('MEMPALACE_PALACE_PATH') or os.environ.get('MEMPAL_PALACE_PATH') or config.palace_path",
    "wing = os.environ.get('AGENT_PASSPORT_MEMPALACE_WING') or None",
    "room = os.environ.get('AGENT_PASSPORT_MEMPALACE_ROOM') or None",
    "n_results = int(os.environ.get('AGENT_PASSPORT_MEMPALACE_MAX_HITS') or '3')",
    "result = search_memories(query=query, palace_path=palace_path, wing=wing, room=room, n_results=n_results)",
    "print(json.dumps(result, ensure_ascii=False))",
  ].join("\n");
  const env = buildMempalaceEnv(config);
  const result = spawnSync(
    python,
    ["-c", script],
    {
      input: `${query}\n`,
      encoding: "utf8",
      timeout: config.timeoutMs,
      env,
      maxBuffer: 1024 * 1024,
    }
  );
  if (result.error) {
    return {
      method: "python_api",
      error: summarizeMempalaceProcessFailure("mempalace_python_api", result),
    };
  }
  if (result.status !== 0) {
    return {
      method: "python_api",
      error: summarizeMempalaceProcessFailure("mempalace_python_api", result),
    };
  }
  const parsed = parseProgrammaticSearchOutput(result.stdout);
  return {
    method: "python_api",
    ...parsed,
  };
}

function runCliMempalaceSearch(query, config) {
  const command = normalizeOptionalText(config.command) ?? DEFAULT_MEMPALACE_COMMAND;
  const invocation = resolveCommandInvocation(command);
  const args = [];
  args.push("search", query, "--results", String(config.maxHits));
  if (config.wing) {
    args.push("--wing", config.wing);
  }
  if (config.room) {
    args.push("--room", config.room);
  }
  const env = buildMempalaceEnv(config);
  const result = spawnSync(invocation?.executable ?? command, [...(invocation?.args || []), ...args], {
    encoding: "utf8",
    timeout: config.timeoutMs,
    env,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    return {
      method: "cli",
      error: summarizeMempalaceProcessFailure("mempalace_cli", result),
    };
  }
  if (result.status !== 0) {
    return {
      method: "cli",
      error: summarizeMempalaceProcessFailure("mempalace_cli", result),
    };
  }
  return {
    method: "cli",
    results: parseMempalaceCliSearchOutput(result.stdout),
  };
}

function normalizeMempalaceSearchHit(hit = {}, index = 0, provider = DEFAULT_EXTERNAL_COLD_MEMORY_PROVIDER) {
  const sourceFile = normalizeOptionalText(hit.source_file || hit.sourceFile) ?? null;
  const wing = normalizeOptionalText(hit.wing) ?? null;
  const room = normalizeOptionalText(hit.room) ?? null;
  const rawText = String(hit.text ?? "").trim();
  const provenanceFingerprint = createHash("sha256")
    .update([provider, wing || "", room || "", sourceFile || "", rawText].join("|"))
    .digest("hex")
    .slice(0, 16);
  const title =
    sourceFile ??
    [wing, room].filter(Boolean).join(" / ") ??
    `${provider}_hit_${index + 1}`;
  return {
    sourceId: `${provider}:hit:${provenanceFingerprint}`,
    title,
    summary: compactSearchText(rawText, 240),
    excerpt: compactSearchText(rawText, 420),
    text: rawText,
    providerScore: Math.max(0, Math.min(1, toFiniteNumber(hit.similarity, 0))),
    candidateOnly: true,
    tags: ["external_cold_memory", provider, "candidate"].filter(Boolean),
    linked: {
      provider,
      wing,
      room,
      sourceFile,
      candidateOnly: true,
    },
  };
}

export function normalizeMempalaceRetrievalConfig(value = {}) {
  const base = value && typeof value === "object" ? value : {};
  const envEnabled =
    process.env.AGENT_PASSPORT_EXTERNAL_COLD_MEMORY_ENABLED ??
    process.env.AGENT_PASSPORT_MEMPALACE_ENABLED;
  const envProvider = process.env.AGENT_PASSPORT_EXTERNAL_COLD_MEMORY_PROVIDER;
  const envCommand = process.env.AGENT_PASSPORT_MEMPALACE_COMMAND;
  const envPalacePath =
    process.env.AGENT_PASSPORT_MEMPALACE_PALACE_PATH ??
    process.env.MEMPALACE_PALACE_PATH ??
    process.env.MEMPAL_PALACE_PATH;
  const envWing = process.env.AGENT_PASSPORT_MEMPALACE_WING;
  const envRoom = process.env.AGENT_PASSPORT_MEMPALACE_ROOM;
  const envMaxHits = process.env.AGENT_PASSPORT_MEMPALACE_MAX_HITS;
  const envTimeoutMs = process.env.AGENT_PASSPORT_MEMPALACE_TIMEOUT_MS;
  return {
    enabled: normalizeBooleanFlag(
      envEnabled ??
        base.enabled,
      false
    ),
    provider: normalizeMempalaceProvider(envProvider ?? base.provider),
    command:
      normalizeOptionalText(envCommand ?? base.command ?? base.mempalaceCommand) ??
      DEFAULT_MEMPALACE_COMMAND,
    palacePath:
      normalizeOptionalText(
        envPalacePath ??
          base.palacePath ??
          base.mempalacePalacePath
      ) ?? DEFAULT_MEMPALACE_PALACE_PATH,
    wing: normalizeOptionalText(envWing ?? base.wing ?? base.mempalaceWing) ?? null,
    room: normalizeOptionalText(envRoom ?? base.room ?? base.mempalaceRoom) ?? null,
    maxHits: Math.max(
      1,
      Math.floor(
        toFiniteNumber(
          envMaxHits ??
            base.maxHits ??
            base.mempalaceMaxHits,
          DEFAULT_MEMPALACE_MAX_HITS
        )
      )
    ),
    timeoutMs: Math.max(
      500,
      Math.floor(
        toFiniteNumber(
          envTimeoutMs ??
            base.timeoutMs ??
            base.mempalaceTimeoutMs,
          DEFAULT_MEMPALACE_TIMEOUT_MS
        )
      )
    ),
  };
}

export function searchMempalaceColdMemory(query, value = {}) {
  const config = normalizeMempalaceRetrievalConfig(value);
  const normalizedQuery = normalizeOptionalText(query) ?? null;
  const baseResult = {
    provider: config.provider,
    enabled: config.enabled,
    used: false,
    method: null,
    hits: [],
    error: null,
    config: {
      provider: config.provider,
      maxHits: config.maxHits,
      timeoutMs: config.timeoutMs,
      palacePathConfigured: Boolean(config.palacePath),
    },
  };

  if (!config.enabled) {
    return baseResult;
  }
  if (config.provider !== DEFAULT_EXTERNAL_COLD_MEMORY_PROVIDER) {
    return {
      ...baseResult,
      error: `Unsupported external cold memory provider: ${config.provider}`,
    };
  }
  if (!normalizedQuery) {
    return baseResult;
  }

  const primary = runProgrammaticMempalaceSearch(normalizedQuery, config);
  const resolved =
    primary && !primary.error ? primary : runCliMempalaceSearch(normalizedQuery, config);
  if (!resolved || resolved.error) {
    return {
      ...baseResult,
      method: primary?.method ?? resolved?.method ?? null,
      error: primary?.error ?? resolved?.error ?? "mempalace search failed",
    };
  }

  const results = Array.isArray(resolved.results) ? resolved.results : [];
  return {
    ...baseResult,
    used: results.length > 0,
    method: resolved.method ?? null,
    hits: results
      .map((hit, index) =>
        normalizeMempalaceSearchHit(hit, index, config.provider)
      )
      .filter((hit) => normalizeOptionalText(hit.text) != null),
    config: cloneJson(baseResult.config),
  };
}

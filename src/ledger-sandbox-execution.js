import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  cloneJson,
  normalizeOptionalText,
  normalizeTextList,
} from "./ledger-core-utils.js";
import {
  DEFAULT_SANDBOX_WORKER_TIMEOUT_MS,
  parseSandboxAllowlistedCommandEntry,
} from "./ledger-device-runtime.js";
import { executeSandboxBroker } from "./runtime-sandbox-broker-client.js";

export function truncateUtf8TextToByteBudget(text, maxBytes) {
  const raw = Buffer.from(String(text || ""), "utf8");
  const boundedMaxBytes = Math.max(0, Math.floor(Number(maxBytes || 0)));
  if (raw.length <= boundedMaxBytes) {
    return {
      text: raw.toString("utf8"),
      bytesRead: raw.length,
      truncated: false,
    };
  }
  let end = boundedMaxBytes;
  while (end > 0 && (raw[end] & 0b11000000) === 0b10000000) {
    end -= 1;
  }
  const preview = raw.subarray(0, end);
  return {
    text: preview.toString("utf8"),
    bytesRead: preview.length,
    truncated: true,
  };
}

function isPathWithinRoot(resolvedPath, rootPath) {
  const relative = path.relative(rootPath, resolvedPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveCanonicalExistingPath(targetPath, label = "sandbox path") {
  const normalizedTarget = normalizeOptionalText(targetPath);
  if (!normalizedTarget) {
    throw new Error(`${label} is required`);
  }

  const resolvedPath = path.resolve(normalizedTarget);
  try {
    const canonicalPath = await realpath(resolvedPath);
    return {
      requestedPath: normalizedTarget,
      resolvedPath,
      canonicalPath,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} does not exist: ${resolvedPath}`);
    }
    throw error;
  }
}

export async function resolveSandboxFilesystemPathStrict(targetPath, sandboxPolicy = {}) {
  const target = await resolveCanonicalExistingPath(targetPath, "sandbox target path");
  const allowlist = normalizeTextList(sandboxPolicy.filesystemAllowlist);
  const canonicalRoots = [];
  for (const entry of allowlist) {
    const normalizedEntry = normalizeOptionalText(entry);
    if (!normalizedEntry) {
      continue;
    }
    const resolvedRoot = path.resolve(normalizedEntry);
    try {
      canonicalRoots.push({
        requestedRoot: normalizedEntry,
        resolvedRoot,
        canonicalRoot: await realpath(resolvedRoot),
      });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
  const matchedRoot = canonicalRoots.find((entry) => isPathWithinRoot(target.canonicalPath, entry.canonicalRoot));
  if (!matchedRoot) {
    throw new Error(`Path resolves outside sandbox allowlist: ${target.canonicalPath}`);
  }

  return {
    requestedPath: target.requestedPath,
    resolvedPath: target.canonicalPath,
    matchedRoot: matchedRoot.canonicalRoot,
    configuredRoot: matchedRoot.requestedRoot,
  };
}

async function computeFileSha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export async function resolveSandboxProcessCommandStrict(command, sandboxPolicy = {}) {
  const normalizedCommand = normalizeOptionalText(command);
  if (!normalizedCommand) {
    throw new Error("Sandbox process command is required");
  }
  if (sandboxPolicy.requireAbsoluteProcessCommand !== false && !path.isAbsolute(normalizedCommand)) {
    throw new Error(`Sandbox process command must be an absolute path: ${normalizedCommand}`);
  }

  const requestedHasPath = normalizedCommand.includes("/") || normalizedCommand.includes(path.sep);
  const resolvedCommand = requestedHasPath ? await resolveCanonicalExistingPath(normalizedCommand, "sandbox process command") : null;
  const allowlistedCommands = Array.isArray(sandboxPolicy.allowedCommands) ? sandboxPolicy.allowedCommands : [];
  if (allowlistedCommands.length === 0) {
    throw new Error("Sandbox command allowlist is empty");
  }
  const matched = [];
  for (const entry of allowlistedCommands) {
    const parsedEntry = parseSandboxAllowlistedCommandEntry(entry);
    if (!parsedEntry) {
      continue;
    }
    if (parsedEntry.hasPath) {
      try {
        const allowlisted = await resolveCanonicalExistingPath(parsedEntry.command, "sandbox allowlisted command");
        matched.push({
          commandPath: allowlisted.canonicalPath,
          digest: parsedEntry.digest,
        });
      } catch (error) {
        if (!String(error?.message || "").includes("does not exist")) {
          throw error;
        }
      }
      continue;
    }
    if (!requestedHasPath && parsedEntry.command === normalizedCommand) {
      return {
        commandPath: normalizedCommand,
        allowlistedCommand: parsedEntry.command,
        pinnedDigest: parsedEntry.digest ?? null,
      };
    }
  }
  if (requestedHasPath) {
    const matchedEntry = matched.find((entry) => entry.commandPath === resolvedCommand.canonicalPath);
    if (!matchedEntry) {
      throw new Error(`Sandbox command not allowlisted: ${normalizedCommand}`);
    }
    if (matchedEntry.digest) {
      const actualDigest = await computeFileSha256(resolvedCommand.canonicalPath);
      if (actualDigest !== matchedEntry.digest) {
        throw new Error(`Sandbox command digest mismatch: ${normalizedCommand}`);
      }
    }
    return {
      commandPath: resolvedCommand.canonicalPath,
      allowlistedCommand: resolvedCommand.canonicalPath,
      pinnedDigest: matchedEntry.digest ?? null,
    };
  }
  throw new Error(`Sandbox command not allowlisted: ${normalizedCommand}`);
}

export async function executeSandboxWorker(payload, { timeoutMs = DEFAULT_SANDBOX_WORKER_TIMEOUT_MS } = {}) {
  return executeSandboxBroker(payload, { timeoutMs });
}

export function attachSandboxBrokerOutput(output = null, broker = null) {
  if (!output || typeof output !== "object") {
    return output;
  }
  return {
    ...output,
    brokerIsolation: broker && typeof broker === "object" ? cloneJson(broker) : null,
  };
}

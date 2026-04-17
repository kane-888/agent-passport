import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

function text(value) {
  return String(value ?? "").trim();
}

function stripMatchingQuotes(value = "") {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseEnvFile(source = "") {
  const values = {};
  const lines = String(source || "").split(/\r?\n/u);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = normalized.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }
    const rawValue = normalized.slice(separatorIndex + 1).trim();
    values[key] = stripMatchingQuotes(rawValue);
  }

  return values;
}

export function buildDeployEnvCandidatePaths({ explicitEnvFilePath } = {}) {
  const candidates = [
    text(explicitEnvFilePath),
    text(process.env.AGENT_PASSPORT_DEPLOY_ENV_FILE),
    path.join(rootDir, "deploy", ".env"),
    "/etc/agent-passport/agent-passport.env",
  ]
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  return [...new Set(candidates)];
}

export async function loadDeployEnvOverlay({ explicitEnvFilePath } = {}) {
  const values = {};
  const sourcePaths = {};
  const loadedFiles = [];

  for (const candidatePath of buildDeployEnvCandidatePaths({ explicitEnvFilePath })) {
    let source = "";
    try {
      source = await fs.readFile(candidatePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        continue;
      }
      throw error;
    }

    const parsed = parseEnvFile(source);
    if (Object.keys(parsed).length === 0) {
      continue;
    }
    loadedFiles.push(candidatePath);
    for (const [key, value] of Object.entries(parsed)) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) {
        values[key] = value;
        sourcePaths[key] = candidatePath;
      }
    }
  }

  return {
    values,
    sourcePaths,
    loadedFiles,
  };
}

export function pickFirstConfigValue(keys = [], { overlay = null } = {}) {
  for (const key of keys) {
    const value = text(process.env[key]);
    if (value) {
      return {
        value,
        source: key,
        sourceType: "env",
        sourcePath: null,
      };
    }
  }

  const overlayValues = overlay?.values || {};
  const overlaySourcePaths = overlay?.sourcePaths || {};
  for (const key of keys) {
    const value = text(overlayValues[key]);
    if (value) {
      return {
        value,
        source: key,
        sourceType: "env_file",
        sourcePath: overlaySourcePaths[key] || null,
      };
    }
  }

  return {
    value: "",
    source: null,
    sourceType: null,
    sourcePath: null,
  };
}

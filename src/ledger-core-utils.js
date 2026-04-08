import { randomUUID, createHash } from "node:crypto";
import { hostname as getHostname } from "node:os";

export function now() {
  return new Date().toISOString();
}

export function encodeBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

export function decodeBase64(value) {
  return Buffer.from(String(value || ""), "base64");
}

export function encodeUtf8Base64(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64");
}

export function decodeUtf8Base64(value) {
  return Buffer.from(String(value || ""), "base64").toString("utf8");
}

export function hashEvent(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        const normalized = canonicalizeJson(value[key]);
        if (normalized !== undefined) {
          acc[key] = normalized;
        }
        return acc;
      }, {});
  }

  return value;
}

export function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(canonicalizeJson(value))).digest("hex");
}

export function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeOptionalText(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  return value == null ? undefined : value;
}

export function cloneJson(value) {
  if (value == null) {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

export function normalizeBooleanFlag(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  const text = normalizeOptionalText(value);
  if (text == null) {
    return fallback;
  }

  const normalized = String(text).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on", "summary", "compact"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off", "full"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeOptionalText(item))
      .filter(Boolean)
      .map((item) => String(item));
  }

  const text = normalizeOptionalText(value);
  if (!text) {
    return [];
  }

  return String(text)
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeComparableText(value) {
  return String(normalizeOptionalText(value) ?? "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

export function createRecordId(prefix) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function hashAccessToken(token) {
  const normalized = normalizeOptionalText(token);
  if (!normalized) {
    throw new Error("access token is required");
  }
  return createHash("sha256").update(`agent-passport:${normalized}`).digest("hex");
}

export function addSeconds(isoString, seconds) {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return isoString;
  }

  return new Date(new Date(isoString).getTime() + Math.floor(numeric) * 1000).toISOString();
}

export function createMachineId() {
  const safe = String(getHostname() || "localhost")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `device_${safe || "localhost"}`;
}

export function agentIdFromName(displayName) {
  const safe = String(displayName || "agent")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return `agent_${safe || "agent"}_${randomUUID().slice(0, 8)}`;
}

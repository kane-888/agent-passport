import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTracer } from "./smoke-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const rootDir = path.join(__dirname, "..");
export const liveDataDir = path.join(rootDir, "data");
export const localReasonerFixturePath = path.join(rootDir, "scripts", "local-reasoner-fixture.mjs");
export const smokeTraceEnabled = process.env.SMOKE_TRACE === "1";

export function createSmokeLogger(name) {
  return createTracer(name, smokeTraceEnabled);
}

export function resolveBaseUrl() {
  return process.env.AGENT_PASSPORT_BASE_URL || "http://127.0.0.1:4319";
}

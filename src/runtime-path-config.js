import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_AGENT_PASSPORT_LOCAL_MODEL_ASSETS_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "ai思维模型",
  "runtime",
  "local-model-assets"
);
export const LOCAL_MODEL_ASSET_MANIFEST_FILENAME = "manifest.json";

function text(value) {
  return String(value ?? "").trim();
}

export function resolveAgentPassportLedgerPath({ dataDir, env = process.env } = {}) {
  const explicitPath = text(env.AGENT_PASSPORT_LEDGER_PATH) || text(env.OPENNEED_LEDGER_PATH);
  return explicitPath || path.join(dataDir, "ledger.json");
}

export function resolveAgentPassportDataDir({ defaultDataDir, ledgerPath = null, env = process.env } = {}) {
  const explicitDataDir = text(env.AGENT_PASSPORT_DATA_DIR);
  return explicitDataDir || path.dirname(ledgerPath || resolveAgentPassportLedgerPath({ dataDir: defaultDataDir, env }));
}

export function resolveAgentPassportChainId({ fallback = "agent-passport-alpha", env = process.env } = {}) {
  return text(env.AGENT_PASSPORT_CHAIN_ID) || text(env.OPENNEED_CHAIN_ID) || fallback;
}

export function resolveAgentPassportLocalModelAssetsRoot({
  defaultRootDir = DEFAULT_AGENT_PASSPORT_LOCAL_MODEL_ASSETS_ROOT,
  env = process.env,
} = {}) {
  return (
    text(env.MEMORY_STABILITY_LOCAL_MODEL_ASSETS_DIR) ||
    text(env.AGENT_PASSPORT_LOCAL_MODEL_ASSETS_DIR) ||
    text(env.OPENNEED_LOCAL_MODEL_ASSETS_DIR) ||
    defaultRootDir
  );
}

export function resolveAgentPassportLocalModelAssetDirectoryPath({
  assetDirectoryName,
  assetsRootDir = null,
  env = process.env,
} = {}) {
  const normalizedDirectoryName = text(assetDirectoryName);
  const rootDir = assetsRootDir || resolveAgentPassportLocalModelAssetsRoot({ env });
  if (!normalizedDirectoryName) {
    return rootDir;
  }
  return path.join(rootDir, normalizedDirectoryName);
}

export function resolveAgentPassportLocalModelAssetManifestPath({
  assetDirectoryName,
  assetsRootDir = null,
  manifestFileName = LOCAL_MODEL_ASSET_MANIFEST_FILENAME,
  env = process.env,
} = {}) {
  return path.join(
    resolveAgentPassportLocalModelAssetDirectoryPath({ assetDirectoryName, assetsRootDir, env }),
    text(manifestFileName) || LOCAL_MODEL_ASSET_MANIFEST_FILENAME
  );
}

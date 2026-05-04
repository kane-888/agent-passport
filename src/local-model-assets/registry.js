import { existsSync, readFileSync, statSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL,
  MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_ASSET_DIRECTORY_NAME,
  resolveMemoryEngineLocalAssetDirectoryName,
  resolveMemoryEngineLocalModel,
} from "../memory-engine-branding.js";
import {
  resolveAgentPassportLocalModelAssetDirectoryPath,
  resolveAgentPassportLocalModelAssetManifestPath,
  resolveAgentPassportLocalModelAssetsRoot,
} from "../runtime-path-config.js";

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OLLAMA_MANIFEST_MEDIA_TYPE = "application/vnd.docker.distribution.manifest.v2+json";
const OLLAMA_CONFIG_MEDIA_TYPE = "application/vnd.docker.container.image.v1+json";
const REQUIRED_LAYER_MEDIA_TYPES = Object.freeze([
  "application/vnd.ollama.image.model",
  "application/vnd.ollama.image.license",
  "application/vnd.ollama.image.params",
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createLocalModelAssetError(message, detail = {}) {
  const error = new Error(message);
  error.name = "LocalModelAssetValidationError";
  error.code = "LOCAL_MODEL_ASSET_VALIDATION_FAILED";
  error.detail = detail;
  return error;
}

function assertLocalModelAsset(condition, message, detail = {}) {
  if (!condition) {
    throw createLocalModelAssetError(message, detail);
  }
}

function requireObject(value, label) {
  assertLocalModelAsset(Boolean(value) && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function requirePositiveInteger(value, label) {
  assertLocalModelAsset(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
}

function requireDigest(value, label) {
  assertLocalModelAsset(typeof value === "string" && SHA256_DIGEST_PATTERN.test(value), `${label} must be sha256:... hex`);
}

function assertPathInsideRoot(candidateRealpath, rootRealpath, label) {
  const relativePath = path.relative(rootRealpath, candidateRealpath);
  assertLocalModelAsset(
    relativePath === "" ||
      (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)),
    `${label} must stay inside the canonical local model assets root`
  );
}

function validateManifestSummary(manifest, registration) {
  const root = requireObject(manifest, "local model asset manifest");
  assertLocalModelAsset(root.schemaVersion === 2, "local model asset manifest schemaVersion must equal 2");
  assertLocalModelAsset(root.mediaType === OLLAMA_MANIFEST_MEDIA_TYPE, "local model asset manifest mediaType mismatch");

  const config = requireObject(root.config, "local model asset manifest.config");
  assertLocalModelAsset(config.mediaType === OLLAMA_CONFIG_MEDIA_TYPE, "local model asset manifest config mediaType mismatch");
  requireDigest(config.digest, "local model asset manifest config.digest");
  requirePositiveInteger(config.size, "local model asset manifest config.size");

  assertLocalModelAsset(Array.isArray(root.layers) && root.layers.length >= REQUIRED_LAYER_MEDIA_TYPES.length, "local model asset manifest layers must be a non-empty array");
  const layerMediaTypes = [];
  for (const [index, layerValue] of root.layers.entries()) {
    const layer = requireObject(layerValue, `local model asset manifest.layers[${index}]`);
    assertLocalModelAsset(typeof layer.mediaType === "string" && layer.mediaType.length > 0, `local model asset manifest.layers[${index}].mediaType must be a string`);
    requireDigest(layer.digest, `local model asset manifest.layers[${index}].digest`);
    requirePositiveInteger(layer.size, `local model asset manifest.layers[${index}].size`);
    layerMediaTypes.push(layer.mediaType);
  }

  for (const mediaType of REQUIRED_LAYER_MEDIA_TYPES) {
    assertLocalModelAsset(
      layerMediaTypes.includes(mediaType),
      `local model asset manifest is missing required layer mediaType ${mediaType}`
    );
  }

  return Object.freeze({
    schemaVersion: root.schemaVersion,
    mediaType: root.mediaType,
    configDigest: config.digest,
    configSize: config.size,
    layerCount: root.layers.length,
    layerMediaTypes: Object.freeze(layerMediaTypes.slice()),
    modelId: registration.modelId,
    assetDirectoryName: registration.assetDirectoryName,
  });
}

export function resolveMemoryStabilityLocalModelAssetRegistration(value = null) {
  const normalizedModelId = resolveMemoryEngineLocalModel(value, null);
  const normalizedAssetDirectoryName = resolveMemoryEngineLocalAssetDirectoryName(value, null);
  if (
    normalizedModelId !== MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL &&
    normalizedAssetDirectoryName !== MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_ASSET_DIRECTORY_NAME
  ) {
    return null;
  }
  return Object.freeze({
    modelId: MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL,
    provider: "ollama_local",
    assetDirectoryName: MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL_ASSET_DIRECTORY_NAME,
  });
}

export function loadMemoryStabilityLocalModelAssetEntry({
  model = MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL,
  assetDirectoryName = null,
  assetsRootDir = null,
  manifestPath = null,
  env = process.env,
} = {}) {
  const registration =
    resolveMemoryStabilityLocalModelAssetRegistration(assetDirectoryName ?? model) ??
    resolveMemoryStabilityLocalModelAssetRegistration(MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL);
  assertLocalModelAsset(Boolean(registration), "unsupported local model asset registration request");

  const canonicalModelId = resolveMemoryEngineLocalModel(model, null);
  const canonicalAssetDirectoryName = resolveMemoryEngineLocalAssetDirectoryName(assetDirectoryName ?? model, null);
  if (canonicalModelId != null) {
    assertLocalModelAsset(
      canonicalModelId === registration.modelId,
      `local model asset modelId must resolve to ${registration.modelId}`
    );
  }
  if (canonicalAssetDirectoryName != null) {
    assertLocalModelAsset(
      canonicalAssetDirectoryName === registration.assetDirectoryName,
      `local model asset directory name must resolve to ${registration.assetDirectoryName}`
    );
  }

  const resolvedAssetsRootDir = assetsRootDir || resolveAgentPassportLocalModelAssetsRoot({ env });
  const resolvedAssetDirectoryPath = resolveAgentPassportLocalModelAssetDirectoryPath({
    assetDirectoryName: registration.assetDirectoryName,
    assetsRootDir: resolvedAssetsRootDir,
    env,
  });
  const resolvedManifestPath =
    text(manifestPath) ||
    resolveAgentPassportLocalModelAssetManifestPath({
      assetDirectoryName: registration.assetDirectoryName,
      assetsRootDir: resolvedAssetsRootDir,
      env,
    });

  assertLocalModelAsset(path.basename(resolvedAssetDirectoryPath) === registration.assetDirectoryName, "local model asset directory basename mismatch");
  assertLocalModelAsset(path.basename(resolvedManifestPath) === "manifest.json", "local model asset manifest filename mismatch");
  assertLocalModelAsset(existsSync(resolvedAssetsRootDir), `local model assets root missing: ${resolvedAssetsRootDir}`);
  assertLocalModelAsset(existsSync(resolvedAssetDirectoryPath), `local model asset directory missing: ${resolvedAssetDirectoryPath}`);
  assertLocalModelAsset(existsSync(resolvedManifestPath), `local model asset manifest missing: ${resolvedManifestPath}`);

  const assetsRootRealpath = realpathSync(resolvedAssetsRootDir);
  const assetDirectoryRealpath = realpathSync(resolvedAssetDirectoryPath);
  const manifestRealpath = realpathSync(resolvedManifestPath);
  const assetsRootStat = statSync(assetsRootRealpath);
  const assetDirectoryStat = statSync(assetDirectoryRealpath);
  const manifestStat = statSync(manifestRealpath);
  assertLocalModelAsset(assetsRootStat.isDirectory(), `local model assets root is not a directory: ${assetsRootRealpath}`);
  assertLocalModelAsset(assetDirectoryStat.isDirectory(), `local model asset path is not a directory: ${assetDirectoryRealpath}`);
  assertLocalModelAsset(manifestStat.isFile(), `local model asset manifest path is not a file: ${manifestRealpath}`);
  assertPathInsideRoot(assetDirectoryRealpath, assetsRootRealpath, "local model asset directory");
  assertPathInsideRoot(manifestRealpath, assetsRootRealpath, "local model asset manifest");
  assertLocalModelAsset(
    path.dirname(manifestRealpath) === assetDirectoryRealpath,
    "local model asset manifest must live directly inside the canonical asset directory"
  );

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestRealpath, "utf8"));
  } catch (error) {
    throw createLocalModelAssetError("local model asset manifest must be valid JSON", {
      cause: error instanceof Error ? error.message : String(error),
      manifestPath: manifestRealpath,
    });
  }

  const manifestSummary = validateManifestSummary(manifest, registration);
  return Object.freeze({
    ...registration,
    assetsRootDir: resolvedAssetsRootDir,
    assetDirectoryPath: assetDirectoryRealpath,
    manifestPath: manifestRealpath,
    manifestSummary,
  });
}

export function inspectMemoryStabilityLocalModelAsset({
  model = MEMORY_STABILITY_DEFAULT_OLLAMA_MODEL,
  assetDirectoryName = null,
  assetsRootDir = null,
  manifestPath = null,
  env = process.env,
} = {}) {
  const requestedModelId = resolveMemoryEngineLocalModel(model, null);
  const requestedAssetDirectoryName = resolveMemoryEngineLocalAssetDirectoryName(assetDirectoryName ?? model, null);
  const registration = resolveMemoryStabilityLocalModelAssetRegistration(assetDirectoryName ?? model);
  const requestedModelText = text(model);
  const requestedAssetDirectoryText = text(assetDirectoryName);
  const fallbackModelId = requestedModelId != null ? requestedModelId : requestedModelText || null;
  const fallbackAssetDirectoryName =
    requestedAssetDirectoryName != null ? requestedAssetDirectoryName : requestedAssetDirectoryText || null;

  if (!registration) {
    return Object.freeze({
      modelId: fallbackModelId,
      assetDirectoryName: fallbackAssetDirectoryName,
      available: false,
      valid: false,
      compatibilityFallback: true,
      assetsRootDir: assetsRootDir || null,
      assetDirectoryPath: null,
      manifestPath: null,
      manifestSummary: null,
      error: null,
    });
  }

  try {
    const entry = loadMemoryStabilityLocalModelAssetEntry({
      model: registration.modelId,
      assetDirectoryName: registration.assetDirectoryName,
      assetsRootDir,
      manifestPath,
      env,
    });
    return Object.freeze({
      ...entry,
      available: true,
      valid: true,
      compatibilityFallback: false,
      error: null,
    });
  } catch (error) {
    return Object.freeze({
      modelId: registration.modelId,
      assetDirectoryName: registration.assetDirectoryName,
      available: false,
      valid: false,
      compatibilityFallback: false,
      assetsRootDir: assetsRootDir || resolveAgentPassportLocalModelAssetsRoot({ env }),
      assetDirectoryPath: resolveAgentPassportLocalModelAssetDirectoryPath({
        assetDirectoryName: registration.assetDirectoryName,
        assetsRootDir,
        env,
      }),
      manifestPath:
        text(manifestPath) ||
        resolveAgentPassportLocalModelAssetManifestPath({
          assetDirectoryName: registration.assetDirectoryName,
          assetsRootDir,
          env,
        }),
      manifestSummary: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

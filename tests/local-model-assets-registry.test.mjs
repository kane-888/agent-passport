import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  inspectMemoryStabilityLocalModelAsset,
  loadMemoryStabilityLocalModelAssetEntry,
  resolveMemoryStabilityLocalModelAssetRegistration,
} from "../src/local-model-assets/registry.js";

const tempRoots = [];

function makeTempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-passport-${label}-`));
  tempRoots.push(dir);
  return dir;
}

function writeCanonicalManifest(manifestPath, overrides = {}) {
  const manifest = {
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    config: {
      mediaType: "application/vnd.docker.container.image.v1+json",
      digest: `sha256:${"a".repeat(64)}`,
      size: 123,
    },
    layers: [
      {
        mediaType: "application/vnd.ollama.image.model",
        digest: `sha256:${"b".repeat(64)}`,
        size: 456,
      },
      {
        mediaType: "application/vnd.ollama.image.license",
        digest: `sha256:${"c".repeat(64)}`,
        size: 78,
      },
      {
        mediaType: "application/vnd.ollama.image.params",
        digest: `sha256:${"d".repeat(64)}`,
        size: 90,
      },
    ],
    ...overrides,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

function createAssetsRoot({ writeManifest = true, manifestOverrides = {} } = {}) {
  const rootDir = makeTempDir("local-model-assets-root");
  const assetDir = path.join(rootDir, "ollama-gemma4-e4b");
  fs.mkdirSync(assetDir, { recursive: true });
  const manifestPath = path.join(assetDir, "manifest.json");
  if (writeManifest) {
    writeCanonicalManifest(manifestPath, manifestOverrides);
  }
  return {
    rootDir,
    assetDir,
    manifestPath,
  };
}

after(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("local model asset registry resolves the canonical gemma4:e4b registration", () => {
  const registration = resolveMemoryStabilityLocalModelAssetRegistration("gemma4:e4b");
  assert.equal(registration?.modelId, "gemma4:e4b");
  assert.equal(registration?.assetDirectoryName, "ollama-gemma4-e4b");
});

test("local model asset registry loads a canonical manifest inside the configured root", () => {
  const { rootDir, manifestPath } = createAssetsRoot();
  const entry = loadMemoryStabilityLocalModelAssetEntry({
    model: "gemma4:e4b",
    assetsRootDir: rootDir,
  });

  assert.equal(entry.modelId, "gemma4:e4b");
  assert.equal(entry.assetDirectoryName, "ollama-gemma4-e4b");
  assert.equal(entry.manifestPath, fs.realpathSync(manifestPath));
  assert.equal(entry.manifestSummary.layerCount, 3);
});

test("local model asset registry inspect stays fail-closed when manifest is missing", () => {
  const { rootDir, manifestPath } = createAssetsRoot({ writeManifest: false });
  const inspection = inspectMemoryStabilityLocalModelAsset({
    model: "gemma4:e4b",
    assetsRootDir: rootDir,
  });

  assert.equal(inspection.available, false);
  assert.equal(inspection.valid, false);
  assert.equal(inspection.manifestPath, manifestPath);
  assert.match(inspection.error || "", /manifest missing/i);
});

test("local model asset registry rejects manifest schema drift fail-closed", () => {
  const { rootDir } = createAssetsRoot({
    manifestOverrides: {
      schemaVersion: 1,
    },
  });

  assert.throws(
    () =>
      loadMemoryStabilityLocalModelAssetEntry({
        model: "gemma4:e4b",
        assetsRootDir: rootDir,
      }),
    /schemaVersion must equal 2/u
  );
});

test("local model asset registry rejects symlinked asset directories that escape the canonical root", () => {
  const rootDir = makeTempDir("local-model-assets-symlink-root");
  const externalRoot = makeTempDir("local-model-assets-external");
  const externalAssetDir = path.join(externalRoot, "ollama-gemma4-e4b");
  fs.mkdirSync(externalAssetDir, { recursive: true });
  writeCanonicalManifest(path.join(externalAssetDir, "manifest.json"));
  fs.symlinkSync(externalAssetDir, path.join(rootDir, "ollama-gemma4-e4b"), "dir");

  assert.throws(
    () =>
      loadMemoryStabilityLocalModelAssetEntry({
        model: "gemma4:e4b",
        assetsRootDir: rootDir,
      }),
    /must stay inside the canonical local model assets root/u
  );
});

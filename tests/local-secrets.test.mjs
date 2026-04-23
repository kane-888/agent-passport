import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("system keychain status memoizes unavailable probes for the process lifetime", async () => {
  const previousUseKeychain = process.env.AGENT_PASSPORT_USE_KEYCHAIN;
  const previousPath = process.env.PATH;
  try {
    process.env.AGENT_PASSPORT_USE_KEYCHAIN = "1";
    process.env.PATH = path.join(os.tmpdir(), "agent-passport-missing-security-bin");
    const moduleUrl = `${pathToFileURL(path.join(rootDir, "src", "local-secrets.js")).href}?keychain-cache=${Date.now()}`;
    const { getSystemKeychainStatus } = await import(moduleUrl);

    const first = getSystemKeychainStatus();
    const second = getSystemKeychainStatus();

    assert.equal(first.available, false);
    assert.equal(first.preferred, true);
    assert.equal(first, second);
  } finally {
    if (previousUseKeychain == null) {
      delete process.env.AGENT_PASSPORT_USE_KEYCHAIN;
    } else {
      process.env.AGENT_PASSPORT_USE_KEYCHAIN = previousUseKeychain;
    }
    if (previousPath == null) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
});

test("system keychain status cache refreshes when probe inputs change", async () => {
  const previousUseKeychain = process.env.AGENT_PASSPORT_USE_KEYCHAIN;
  const previousPath = process.env.PATH;
  try {
    const moduleUrl = `${pathToFileURL(path.join(rootDir, "src", "local-secrets.js")).href}?keychain-inputs=${Date.now()}`;
    const { getSystemKeychainStatus } = await import(moduleUrl);

    process.env.AGENT_PASSPORT_USE_KEYCHAIN = "0";
    process.env.PATH = path.join(os.tmpdir(), "agent-passport-missing-security-bin");
    const disabled = getSystemKeychainStatus();

    process.env.AGENT_PASSPORT_USE_KEYCHAIN = "1";
    const unavailable = getSystemKeychainStatus();
    const repeated = getSystemKeychainStatus();

    assert.equal(disabled.preferred, false);
    assert.equal(disabled.available, false);
    assert.equal(unavailable.preferred, true);
    assert.equal(unavailable.available, false);
    assert.notEqual(disabled, unavailable);
    assert.equal(unavailable, repeated);
  } finally {
    if (previousUseKeychain == null) {
      delete process.env.AGENT_PASSPORT_USE_KEYCHAIN;
    } else {
      process.env.AGENT_PASSPORT_USE_KEYCHAIN = previousUseKeychain;
    }
    if (previousPath == null) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
});

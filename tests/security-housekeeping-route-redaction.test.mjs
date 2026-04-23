import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let importCounter = 0;

function uniqueImportSuffix(label) {
  importCounter += 1;
  return `${label}-${process.pid}-${Date.now()}-${importCounter}`;
}

function withEnv(overrides, operation) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = overrides[key];
  }
  return Promise.resolve()
    .then(operation)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value == null) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test("runtime housekeeping route hides artifact counts for summary-only read sessions", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-passport-housekeeping-route-"));
  const ledgerPath = path.join(tmpDir, "ledger.json");
  const readSessionStorePath = path.join(tmpDir, "read-sessions.json");
  const storeKeyPath = path.join(tmpDir, ".ledger-key");
  const signingSecretPath = path.join(tmpDir, ".did-signing-master-secret");
  const recoveryDir = path.join(tmpDir, "recovery-bundles");
  const setupPackageDir = path.join(tmpDir, "device-setup-packages");
  const archiveDir = path.join(tmpDir, "archives");

  try {
    fs.mkdirSync(recoveryDir, { recursive: true });
    fs.mkdirSync(setupPackageDir, { recursive: true });
    fs.writeFileSync(path.join(recoveryDir, "broken-recovery.json"), "{", "utf8");
    fs.writeFileSync(path.join(setupPackageDir, "broken-setup.json"), "{", "utf8");

    await withEnv(
      {
        OPENNEED_LEDGER_PATH: ledgerPath,
        AGENT_PASSPORT_READ_SESSION_STORE_PATH: readSessionStorePath,
        AGENT_PASSPORT_STORE_KEY_PATH: storeKeyPath,
        AGENT_PASSPORT_SIGNING_SECRET_PATH: signingSecretPath,
        AGENT_PASSPORT_USE_KEYCHAIN: "0",
        AGENT_PASSPORT_RECOVERY_DIR: recoveryDir,
        AGENT_PASSPORT_ARCHIVE_DIR: archiveDir,
        AGENT_PASSPORT_SETUP_PACKAGE_DIR: setupPackageDir,
      },
      async () => {
        const moduleUrl = pathToFileURL(path.join(rootDir, "src", "server-security-routes.js")).href;
        const { handleSecurityRoutes } = await import(
          `${moduleUrl}?${uniqueImportSuffix("housekeeping-route-redaction")}`
        );
        const server = createServer(async (req, res) => {
          try {
            const url = new URL(req.url, "http://127.0.0.1");
            req.agentPassportAccess = {
              mode: "read_session",
              session: {
                readSessionId: "rs_summary",
                role: "security_delegate",
                redactionTemplate: "summary_only",
                viewTemplates: {
                  security: "summary_only",
                },
              },
            };
            await handleSecurityRoutes({
              req,
              res,
              url,
              pathname: url.pathname,
              segments: url.pathname.split("/").filter(Boolean),
              parseBody: async () => ({}),
              rotateAdminToken: async () => ({}),
            });
            if (!res.writableEnded) {
              res.writeHead(404, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "not_found" }));
            }
          } catch (error) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: error.message || String(error) }));
          }
        });

        const baseUrl = await listen(server);
        try {
          const response = await fetch(`${baseUrl}/api/security/runtime-housekeeping?keepRecovery=1&keepSetup=1`);
          assert.equal(response.status, 200);
          const body = await response.json();

          assert.equal(body.rootDir, undefined);
          assert.equal(body.paths, undefined);
          assert.equal(body.recoveryBundles.invalidCount, undefined);
          assert.equal(body.recoveryBundles.deletedCount, undefined);
          assert.equal(body.recoveryBundles.keptCount, undefined);
          assert.equal(body.recoveryBundles.candidateCount, undefined);
          assert.equal(body.recoveryBundles.total, undefined);
          assert.equal(body.recoveryBundles.countsHidden, true);
          assert.equal(body.setupPackages.invalidCount, undefined);
          assert.equal(body.setupPackages.counts, undefined);
          assert.equal(body.setupPackages.total, undefined);
          assert.equal(body.setupPackages.countsHidden, true);
        } finally {
          await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

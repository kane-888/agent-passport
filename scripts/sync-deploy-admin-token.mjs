import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  getSystemKeychainStatus,
  readGenericPasswordFromKeychainResult,
  writeGenericPasswordToKeychain,
} from "../src/local-secrets.js";
import { loadDeployEnvOverlay, pickFirstConfigValue } from "./deploy-env-loader.mjs";
import { printCliError, printCliResult } from "./structured-cli-output.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const DEPLOY_ADMIN_TOKEN_ENV_KEYS = ["AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN", "AGENT_PASSPORT_ADMIN_TOKEN"];
const ADMIN_TOKEN_KEYCHAIN_SERVICE = "AgentPassport.AdminToken";
const ADMIN_TOKEN_KEYCHAIN_ACCOUNT = process.env.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT || "resident-default";

function text(value) {
  return String(value ?? "").trim();
}

function fallbackAdminTokenPath() {
  return process.env.AGENT_PASSPORT_ADMIN_TOKEN_PATH || path.join(rootDir, "data", ".admin-token");
}

export function secretFingerprint(value, { length = 12 } = {}) {
  const normalized = text(value);
  if (!normalized) {
    return null;
  }
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, length);
}

export function summarizeSecret(value) {
  const normalized = text(value);
  return {
    provided: Boolean(normalized),
    length: normalized.length,
    sha256: secretFingerprint(normalized),
  };
}

export function buildDeployAdminTokenSyncPlan({
  token = "",
  tokenSource = null,
  tokenSourceType = null,
  tokenSourcePath = null,
  currentToken = "",
  currentSource = null,
  keychainStatus = null,
  fallbackPath = fallbackAdminTokenPath(),
  dryRun = false,
} = {}) {
  const normalizedToken = text(token);
  if (!normalizedToken) {
    return {
      ok: false,
      errorClass: "missing_deploy_admin_token",
      summary:
        "缺少 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN（或 AGENT_PASSPORT_ADMIN_TOKEN）；先从服务器当前部署配置读取管理令牌，再同步本机验收环境。",
      nextAction:
        "登录服务器，读取 /etc/agent-passport/agent-passport.env 中当前 AGENT_PASSPORT_ADMIN_TOKEN，然后用 AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=<token> npm run deploy:admin-token:sync 同步。",
    };
  }

  const current = text(currentToken);
  const keychainAvailable = keychainStatus?.available === true;
  const target = keychainAvailable ? "keychain" : "file";
  const targetPath = keychainAvailable ? null : fallbackPath;
  const alreadySynced = Boolean(current) && current === normalizedToken;

  return {
    ok: true,
    dryRun: dryRun === true,
    alreadySynced,
    tokenSource,
    tokenSourceType,
    tokenSourcePath,
    token: summarizeSecret(normalizedToken),
    current: current
      ? {
          source: currentSource,
          ...summarizeSecret(current),
        }
      : {
          source: currentSource,
          provided: false,
          length: 0,
          sha256: null,
        },
    target,
    targetKeychainService: keychainAvailable ? ADMIN_TOKEN_KEYCHAIN_SERVICE : null,
    targetKeychainAccount: keychainAvailable ? ADMIN_TOKEN_KEYCHAIN_ACCOUNT : null,
    targetPath,
    summary: alreadySynced
      ? "本机验收用管理令牌已经与输入令牌一致。"
      : dryRun
        ? `将把输入的部署管理令牌同步到本机 ${target === "keychain" ? "keychain" : "文件回退"}。`
        : `已把部署管理令牌同步到本机 ${target === "keychain" ? "keychain" : "文件回退"}。`,
    nextAction:
      "重新运行 AGENT_PASSPORT_DEPLOY_BASE_URL=https://agent-passport.cn AGENT_PASSPORT_REQUIRE_ICP_RECORD=1 npm run verify:deploy:http。",
  };
}

function parseArgs(argv = []) {
  const args = {
    envFilePath: undefined,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (entry === "--help" || entry === "-h") {
      args.help = true;
      continue;
    }
    if (entry === "--env-file") {
      args.envFilePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (entry.startsWith("--env-file=")) {
      args.envFilePath = entry.slice("--env-file=".length);
    }
  }

  return args;
}

function buildHelpResult() {
  return {
    ok: true,
    usage: [
      "AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN=<token> npm run deploy:admin-token:sync",
      "AGENT_PASSPORT_DEPLOY_ENV_FILE=/path/to/agent-passport.env npm run deploy:admin-token:sync",
      "npm run deploy:admin-token:sync -- --env-file /path/to/agent-passport.env --dry-run",
    ],
    note: "输出只包含长度和 sha256 短指纹，不打印管理令牌明文。",
  };
}

export async function syncDeployAdminToken({ envFilePath = undefined, dryRun = false } = {}) {
  const overlay = await loadDeployEnvOverlay({ explicitEnvFilePath: envFilePath });
  const resolvedToken = pickFirstConfigValue(DEPLOY_ADMIN_TOKEN_ENV_KEYS, { overlay });
  const keychainStatus = getSystemKeychainStatus();
  const keychainToken = keychainStatus.available
    ? readGenericPasswordFromKeychainResult(ADMIN_TOKEN_KEYCHAIN_SERVICE, ADMIN_TOKEN_KEYCHAIN_ACCOUNT)
    : { found: false, value: "", source: "keychain", code: "keychain_unavailable" };
  const fallbackPath = fallbackAdminTokenPath();
  let currentToken = keychainToken.found ? keychainToken.value : "";
  let currentSource = keychainToken.found ? "keychain" : keychainToken.code || "none";

  if (!currentToken && !keychainStatus.available) {
    try {
      currentToken = text(await fs.readFile(fallbackPath, "utf8"));
      currentSource = "file";
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  const plan = buildDeployAdminTokenSyncPlan({
    token: resolvedToken.value,
    tokenSource: resolvedToken.source,
    tokenSourceType: resolvedToken.sourceType,
    tokenSourcePath: resolvedToken.sourcePath,
    currentToken,
    currentSource,
    keychainStatus,
    fallbackPath,
    dryRun,
  });

  if (plan.ok !== true || dryRun || plan.alreadySynced) {
    return {
      ...plan,
      configEnvFiles: overlay.loadedFiles,
      keychain: {
        preferred: keychainStatus.preferred,
        available: keychainStatus.available,
        reason: keychainStatus.reason,
      },
    };
  }

  if (plan.target === "keychain") {
    const stored = writeGenericPasswordToKeychain(
      ADMIN_TOKEN_KEYCHAIN_SERVICE,
      ADMIN_TOKEN_KEYCHAIN_ACCOUNT,
      resolvedToken.value
    );
    if (!stored.ok) {
      return {
        ...plan,
        ok: false,
        errorClass: "keychain_write_failed",
        summary: `无法写入本机 keychain：${stored.reason || "keychain_write_failed"}`,
      };
    }
  } else {
    await fs.mkdir(path.dirname(fallbackPath), { recursive: true });
    await fs.writeFile(fallbackPath, `${text(resolvedToken.value)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(fallbackPath, 0o600);
  }

  return {
    ...plan,
    configEnvFiles: overlay.loadedFiles,
    keychain: {
      preferred: keychainStatus.preferred,
      available: keychainStatus.available,
      reason: keychainStatus.reason,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    await printCliResult(buildHelpResult(), { failureExitCode: 0 });
    return;
  }
  const result = await syncDeployAdminToken(args);
  await printCliResult(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => printCliError(error));
}

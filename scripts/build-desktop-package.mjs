import { spawn } from "node:child_process";
import { mkdir, rm, writeFile, readFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const version = String(process.env.AGENT_PASSPORT_DOWNLOAD_VERSION || packageJson.version || "0.1.0").trim();
const buildRoot = path.join(rootDir, "output", "desktop-packages");
const downloadDir = path.join(rootDir, "public", "downloads");
const packageName = "agent-passport-desktop";

const platforms = [
  {
    id: "macos",
    label: "macOS",
    launcher: "start-agent-passport.command",
    launcherMode: 0o755,
    launcherText: shellLauncher("macOS"),
  },
  {
    id: "linux",
    label: "Linux",
    launcher: "start-agent-passport.sh",
    launcherMode: 0o755,
    launcherText: shellLauncher("Linux"),
  },
  {
    id: "windows",
    label: "Windows",
    launcher: "start-agent-passport.ps1",
    launcherMode: 0o644,
    launcherText: windowsLauncher(),
  },
];

function shellLauncher(platformLabel) {
  return `#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

export HOST="\${HOST:-127.0.0.1}"
export PORT="\${PORT:-4319}"
export AGENT_PASSPORT_SURFACE_MODE="\${AGENT_PASSPORT_SURFACE_MODE:-local}"
export AGENT_PASSPORT_LEDGER_PATH="\${AGENT_PASSPORT_LEDGER_PATH:-$PWD/data/ledger.json}"
export AGENT_PASSPORT_READ_SESSION_STORE_PATH="\${AGENT_PASSPORT_READ_SESSION_STORE_PATH:-$PWD/data/read-sessions.json}"
export AGENT_PASSPORT_STORE_KEY_PATH="\${AGENT_PASSPORT_STORE_KEY_PATH:-$PWD/data/.ledger-key}"
export AGENT_PASSPORT_SIGNING_SECRET_PATH="\${AGENT_PASSPORT_SIGNING_SECRET_PATH:-$PWD/data/.did-signing-master-secret}"
export AGENT_PASSPORT_RECOVERY_DIR="\${AGENT_PASSPORT_RECOVERY_DIR:-$PWD/data/recovery-bundles}"
export AGENT_PASSPORT_SETUP_PACKAGE_DIR="\${AGENT_PASSPORT_SETUP_PACKAGE_DIR:-$PWD/data/device-setup-packages}"
export AGENT_PASSPORT_ARCHIVE_DIR="\${AGENT_PASSPORT_ARCHIVE_DIR:-$PWD/data/archives}"
export AGENT_PASSPORT_ADMIN_TOKEN_PATH="\${AGENT_PASSPORT_ADMIN_TOKEN_PATH:-$PWD/data/.admin-token}"

mkdir -p "$PWD/data"

url="http://127.0.0.1:$PORT/"
if command -v open >/dev/null 2>&1; then
  (sleep 1; open "$url") >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 1; xdg-open "$url") >/dev/null 2>&1 &
fi

echo "agent-passport ${platformLabel} local workspace"
echo "Choose Create Passport or Login / Restore Passport on the first screen."
echo "Open $url if the browser does not open automatically."
node src/server.js
`;
}

function windowsLauncher() {
  return `$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:HOST = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$env:PORT = if ($env:PORT) { $env:PORT } else { "4319" }
$env:AGENT_PASSPORT_SURFACE_MODE = if ($env:AGENT_PASSPORT_SURFACE_MODE) { $env:AGENT_PASSPORT_SURFACE_MODE } else { "local" }
$env:AGENT_PASSPORT_LEDGER_PATH = if ($env:AGENT_PASSPORT_LEDGER_PATH) { $env:AGENT_PASSPORT_LEDGER_PATH } else { Join-Path $PSScriptRoot "data\\ledger.json" }
$env:AGENT_PASSPORT_READ_SESSION_STORE_PATH = if ($env:AGENT_PASSPORT_READ_SESSION_STORE_PATH) { $env:AGENT_PASSPORT_READ_SESSION_STORE_PATH } else { Join-Path $PSScriptRoot "data\\read-sessions.json" }
$env:AGENT_PASSPORT_STORE_KEY_PATH = if ($env:AGENT_PASSPORT_STORE_KEY_PATH) { $env:AGENT_PASSPORT_STORE_KEY_PATH } else { Join-Path $PSScriptRoot "data\\.ledger-key" }
$env:AGENT_PASSPORT_SIGNING_SECRET_PATH = if ($env:AGENT_PASSPORT_SIGNING_SECRET_PATH) { $env:AGENT_PASSPORT_SIGNING_SECRET_PATH } else { Join-Path $PSScriptRoot "data\\.did-signing-master-secret" }
$env:AGENT_PASSPORT_RECOVERY_DIR = if ($env:AGENT_PASSPORT_RECOVERY_DIR) { $env:AGENT_PASSPORT_RECOVERY_DIR } else { Join-Path $PSScriptRoot "data\\recovery-bundles" }
$env:AGENT_PASSPORT_SETUP_PACKAGE_DIR = if ($env:AGENT_PASSPORT_SETUP_PACKAGE_DIR) { $env:AGENT_PASSPORT_SETUP_PACKAGE_DIR } else { Join-Path $PSScriptRoot "data\\device-setup-packages" }
$env:AGENT_PASSPORT_ARCHIVE_DIR = if ($env:AGENT_PASSPORT_ARCHIVE_DIR) { $env:AGENT_PASSPORT_ARCHIVE_DIR } else { Join-Path $PSScriptRoot "data\\archives" }
$env:AGENT_PASSPORT_ADMIN_TOKEN_PATH = if ($env:AGENT_PASSPORT_ADMIN_TOKEN_PATH) { $env:AGENT_PASSPORT_ADMIN_TOKEN_PATH } else { Join-Path $PSScriptRoot "data\\.admin-token" }

New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot "data") | Out-Null

$url = "http://127.0.0.1:$($env:PORT)/"
Start-Job -ScriptBlock {
  param($TargetUrl)
  Start-Sleep -Seconds 1
  Start-Process $TargetUrl
} -ArgumentList $url | Out-Null

Write-Host "agent-passport Windows local workspace"
Write-Host "Choose Create Passport or Login / Restore Passport on the first screen."
Write-Host "Open $url if the browser does not open automatically."
node src/server.js
`;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function copyProjectFiles(targetDir) {
  await mkdir(targetDir, { recursive: true });
  await run("cp", ["-R", "src", targetDir]);
  await run("cp", ["-R", "public", targetDir]);
  await run("cp", ["package.json", targetDir]);
  await run("cp", ["README.md", targetDir]);
  await run("cp", ["PRODUCT.md", targetDir]);
  await writeFile(
    path.join(targetDir, "agent-passport.env.example"),
    [
      "HOST=127.0.0.1",
      "PORT=4319",
      "AGENT_PASSPORT_SURFACE_MODE=local",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(targetDir, "README-DESKTOP.txt"),
    [
      "agent-passport Alpha desktop portable package",
      "",
      "1. Install Node.js 20 or newer.",
      "2. Run the launcher for your platform.",
      "3. The local product home opens at http://127.0.0.1:4319/.",
      "4. Choose Create Passport or Login / Restore Passport on the first screen.",
      "5. Create, login, recovery, and repair flows stay on this local machine.",
      "",
      "This portable package is the Alpha bridge before native installers.",
      "",
    ].join("\n"),
    "utf8"
  );
}

async function packagePlatform(platform) {
  const dirName = `${packageName}-${platform.id}-${version}`;
  const targetDir = path.join(buildRoot, dirName);
  const archiveName = `${dirName}.tar.gz`;
  const archivePath = path.join(downloadDir, archiveName);

  await rm(targetDir, { recursive: true, force: true });
  await copyProjectFiles(targetDir);
  const launcherPath = path.join(targetDir, platform.launcher);
  await writeFile(launcherPath, platform.launcherText, "utf8");
  await chmod(launcherPath, platform.launcherMode);
  await rm(path.join(targetDir, "public", "downloads"), { recursive: true, force: true });
  await run("tar", ["-czf", archivePath, "-C", buildRoot, dirName]);

  return {
    id: platform.id,
    label: platform.label,
    filename: archiveName,
    url: `/downloads/${archiveName}`,
  };
}

await mkdir(buildRoot, { recursive: true });
await mkdir(downloadDir, { recursive: true });

const built = [];
for (const platform of platforms) {
  built.push(await packagePlatform(platform));
}

const manifest = {
  ok: true,
  service: "agent-passport",
  package: packageName,
  version,
  generatedAt: new Date().toISOString(),
  platforms: Object.fromEntries(
    built.map((entry) => [
      entry.id,
      {
        label: entry.label,
        filename: entry.filename,
        url: entry.url,
      },
    ])
  ),
};

await writeFile(
  path.join(downloadDir, `${packageName}-manifest.json`),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(JSON.stringify(manifest, null, 2));

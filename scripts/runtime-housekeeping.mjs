import { runRuntimeHousekeeping } from "../src/runtime-housekeeping.js";

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

function readNumberArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return fallback;
  }
  const raw = process.argv[index + 1];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

async function main() {
  const report = await runRuntimeHousekeeping({
    apply: hasFlag("--apply"),
    keepRecovery: readNumberArg("--keep-recovery", 3),
    keepSetup: readNumberArg("--keep-setup", 3),
  });
  console.log(JSON.stringify(report, null, 2));
}

await main();

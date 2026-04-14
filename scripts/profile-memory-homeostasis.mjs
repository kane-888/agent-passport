import { profileModelMemoryHomeostasis } from "../src/ledger.js";

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
}

function readListArg(name, fallback) {
  const value = readArg(name, null);
  if (!value) {
    return fallback;
  }
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
}

const simulate = process.argv.includes("--simulate");

const result = await profileModelMemoryHomeostasis({
  modelName: readArg("model", undefined),
  reasonerProvider: simulate ? "local_mock" : readArg("provider", undefined),
  baselineLength: readArg("baseline", undefined),
  lengths: readListArg("lengths", undefined),
  factCount: readArg("facts", undefined),
  retentionFloor: readArg("floor", undefined),
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

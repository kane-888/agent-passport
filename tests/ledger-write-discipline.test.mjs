import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(rootDir, "src", "ledger.js");
const ledgerSource = readFileSync(ledgerPath, "utf8");

function findFunctionBodyEnd(source, bodyStart) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }

  throw new Error("Unterminated function body in src/ledger.js");
}

function listExportedAsyncFunctions(source) {
  const functions = [];
  const matcher = /export\s+async\s+function\s+(\w+)\s*\(/g;
  let match = matcher.exec(source);
  while (match) {
    const bodyStart = source.indexOf("{", matcher.lastIndex);
    assert.notEqual(bodyStart, -1, `Missing body for ${match[1]}`);
    const bodyEnd = findFunctionBodyEnd(source, bodyStart);
    functions.push({
      name: match[1],
      body: source.slice(bodyStart, bodyEnd),
    });
    matcher.lastIndex = bodyEnd;
    match = matcher.exec(source);
  }
  return functions;
}

test("exported ledger mutators serialize direct store writes through queueStoreMutation", () => {
  const allowedDirectWriters = new Set([
    "loadStore",
  ]);
  const offenders = listExportedAsyncFunctions(ledgerSource)
    .filter(({ name }) => !allowedDirectWriters.has(name))
    .filter(({ body }) => body.includes("writeStore("))
    .filter(({ body }) => !body.includes("queueStoreMutation("))
    .map(({ name }) => name);

  assert.deepEqual(
    offenders,
    [],
    `Exported ledger functions that call writeStore() must enter queueStoreMutation(): ${offenders.join(", ")}`
  );
});

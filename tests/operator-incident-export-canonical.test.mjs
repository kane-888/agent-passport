import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function extractSourceBlock(source, startMarker, endMarker) {
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `missing source block start: ${startMarker}`);
  const endIndex = source.indexOf(endMarker, startIndex);
  assert.notEqual(endIndex, -1, `missing source block end: ${endMarker}`);
  return source.slice(startIndex, endIndex);
}

test("operator incident export trusts canonical resident binding fields instead of rebuilding legacy fallback truth", () => {
  const source = fs.readFileSync(path.join(rootDir, "public", "operator.html"), "utf8");

  const physicalOwnerBlock = extractSourceBlock(
    source,
    "function getResidentPhysicalOwnerAgentId",
    "function getResidentAgentReference"
  );
  assert.match(
    physicalOwnerBlock,
    /setup\?\.physicalResidentAgentId/u
  );
  assert.doesNotMatch(physicalOwnerBlock, /resolvedResidentAgentId/u);
  assert.doesNotMatch(physicalOwnerBlock, /setup\?\.deviceRuntime/u);
  assert.doesNotMatch(physicalOwnerBlock, /setup\?\.residentAgentId/u);

  const residentReferenceBlock = extractSourceBlock(
    source,
    "function getResidentAgentReference",
    "function mergeIncidentExportHistory"
  );
  assert.match(residentReferenceBlock, /setup\?\.residentAgentReference/u);
  assert.doesNotMatch(residentReferenceBlock, /setup\?\.deviceRuntime/u);
  assert.match(residentReferenceBlock, /function formatResidentBindingDisplay/u);
  assert.match(residentReferenceBlock, /raw resolved owner：缺失（未从 effective physical owner 回填）/u);
  assert.match(residentReferenceBlock, /effective physical owner/u);

  const mergeHistoryBlock = extractSourceBlock(
    source,
    "function mergeIncidentExportHistory",
    "function createProtectedReadError"
  );
  assert.match(mergeHistoryBlock, /physicalResidentAgentId/u);
  assert.match(mergeHistoryBlock, /residentAgentReference/u);
  assert.match(mergeHistoryBlock, /resolvedResidentAgentId/u);
  assert.match(mergeHistoryBlock, /history\?\.resolvedResidentAgentId/u);
  assert.match(mergeHistoryBlock, /record\?\.resolvedResidentAgentId/u);
  assert.match(mergeHistoryBlock, /effectiveResolvedResidentAgentId/u);
  assert.match(mergeHistoryBlock, /residentBindingMismatch/u);
  assert.match(mergeHistoryBlock, /entries\.map\(\(entry\)\s*=>\s*normalizeMergedExportRecord\(entry\)\)\.filter\(Boolean\)/u);
  assert.match(mergeHistoryBlock, /hasMatchedHistoryRecord/u);
  assert.doesNotMatch(mergeHistoryBlock, /record\?\.agentId/u);
  assert.doesNotMatch(mergeHistoryBlock, /history\?\.residentAgentId/u);

  const renderExportBlock = extractSourceBlock(
    source,
    "function renderIncidentExportState",
    "async function requestJson"
  );
  assert.match(renderExportBlock, /entryEffectivePhysicalResidentAgentId/u);
  assert.match(renderExportBlock, /entryEffectiveResidentAgentReference/u);
  assert.match(renderExportBlock, /entryEffectiveResolvedResidentAgentId/u);
  assert.match(renderExportBlock, /formatResidentBindingDisplay/u);
  assert.match(renderExportBlock, /effective resolved owner：/u);
  assert.match(renderExportBlock, /residentBindingMismatch/u);
  assert.match(renderExportBlock, /dataset:\s*\{/u);
  assert.match(renderExportBlock, /effectivePhysicalResidentAgentId:\s*entryEffectivePhysicalResidentAgentId/u);
  assert.match(renderExportBlock, /effectiveResidentAgentReference:\s*entryEffectiveResidentAgentReference/u);
  assert.match(renderExportBlock, /effectiveResolvedResidentAgentId:\s*entryEffectiveResolvedResidentAgentId/u);
  assert.match(renderExportBlock, /residentBindingMismatch:\s*residentBindingMismatch\s*\?\s*"true"\s*:\s*"false"/u);
});

test("incident export writer preserves missing raw resolved resident ids instead of backfilling physical owner truth", () => {
  const source = fs.readFileSync(path.join(rootDir, "src", "server-security-routes.js"), "utf8");
  const exportWriterBlock = extractSourceBlock(
    source,
    "async function recordIncidentPacketExport",
    "export async function handleSecurityRoutes"
  );

  assert.match(exportWriterBlock, /packet\?\.resolvedResidentAgentId/u);
  assert.match(exportWriterBlock, /normalizeOptionalText\(resolvedResidentAgentId\)/u);
  assert.doesNotMatch(exportWriterBlock, /resolvedResidentAgentId:[\s\S]*residentAgentId/u);
});

test("operator incident export merge preserves missing raw resident fields while keeping effective owner fields", () => {
  const source = fs.readFileSync(path.join(rootDir, "public", "operator.html"), "utf8");
  const mergeHistoryBlock = extractSourceBlock(
    source,
    "function mergeIncidentExportHistory",
    "function createProtectedReadError"
  );
  const context = {
    text(value, fallback = "未确认") {
      const normalized = typeof value === "string" ? value.trim() : "";
      return normalized || fallback;
    },
  };
  vm.runInNewContext(`${mergeHistoryBlock}; this.mergeIncidentExportHistory = mergeIncidentExportHistory;`, context);
  const mergeIncidentExportHistory = context.mergeIncidentExportHistory;

  const merged = mergeIncidentExportHistory(
    {
      history: [],
      physicalResidentAgentId: "agent_openneed_agents",
      residentAgentReference: "agent_main",
      resolvedResidentAgentId: null,
    },
    {
      evidenceRefId: "evid_1",
      title: "事故交接包导出",
      physicalResidentAgentId: null,
      residentAgentReference: "agent_main",
      resolvedResidentAgentId: null,
      uri: "incident-packet://export/evid_1",
    }
  );

  assert.equal(merged.physicalResidentAgentId, "agent_openneed_agents");
  assert.equal(merged.resolvedResidentAgentId, null);
  assert.equal(merged.effectiveResolvedResidentAgentId, "agent_openneed_agents");
  assert.equal(merged.history[0]?.physicalResidentAgentId, null);
  assert.equal(merged.history[0]?.resolvedResidentAgentId, null);
  assert.equal(merged.history[0]?.effectivePhysicalResidentAgentId, "agent_openneed_agents");
  assert.equal(merged.history[0]?.effectiveResolvedResidentAgentId, "agent_openneed_agents");
});

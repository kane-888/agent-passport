import {
  hashJson,
  normalizeOptionalText,
  normalizeTextList,
} from "./ledger-core-utils.js";
import { normalizeCredentialKind } from "./ledger-credential-core.js";

export function buildMigrationRepairSummary(repair = {}) {
  const scope = normalizeOptionalText(repair.scope) ?? "agent";
  const targetLabel =
    normalizeOptionalText(repair.agentId) ??
    normalizeOptionalText(repair.targetAgentId) ??
    normalizeOptionalText(repair.issuerAgentId) ??
    (repair.selectedPairCount ? `${repair.selectedPairCount} pair` : "migration");
  const methods = normalizeTextList(repair.requestedDidMethods);
  const methodLabel = methods.length > 0 ? methods.join(", ") : "default";
  const repairedCount = Number.isFinite(Number(repair.repairedCount)) ? Math.max(0, Math.floor(Number(repair.repairedCount))) : 0;
  const plannedRepairCount = Number.isFinite(Number(repair.plannedRepairCount))
    ? Math.max(0, Math.floor(Number(repair.plannedRepairCount)))
    : 0;
  return `迁移修复回执 · ${scope} · ${targetLabel} · repaired ${repairedCount}/${plannedRepairCount} · methods ${methodLabel}`;
}

export function collectMigrationRepairRelatedAgentIds(repair = {}, issuerAgentId = null) {
  const related = new Set(
    [
      normalizeOptionalText(issuerAgentId),
      normalizeOptionalText(repair.agentId),
      normalizeOptionalText(repair.targetAgentId),
      normalizeOptionalText(repair.issuerAgentId),
    ].filter(Boolean)
  );

  for (const pair of repair.comparisonPairs || []) {
    related.add(normalizeOptionalText(pair?.left?.agentId));
    related.add(normalizeOptionalText(pair?.right?.agentId));
  }

  for (const item of [...(repair.plan || []), ...(repair.repaired || []), ...(repair.skipped || [])]) {
    related.add(normalizeOptionalText(item?.issuerAgentId));
    related.add(normalizeOptionalText(item?.targetAgentId));
    related.add(normalizeOptionalText(item?.leftAgentId));
    related.add(normalizeOptionalText(item?.rightAgentId));
  }

  return [...related].filter(Boolean);
}

export function buildMigrationRepairLinks(repair = {}) {
  const repairedItems = Array.isArray(repair.repaired) ? repair.repaired : [];
  const linkedCredentials = repairedItems.map((item) => ({
    kind: normalizeCredentialKind(item?.kind),
    subjectId: normalizeOptionalText(item?.subjectId) ?? null,
    subjectLabel: normalizeOptionalText(item?.subjectLabel) ?? null,
    issuerAgentId: normalizeOptionalText(item?.issuerAgentId) ?? null,
    didMethod: normalizeOptionalText(item?.didMethod) ?? null,
    credentialRecordId: normalizeOptionalText(item?.credentialRecordId) ?? null,
    credentialId: normalizeOptionalText(item?.credentialId) ?? null,
    issuerDid: normalizeOptionalText(item?.issuerDid) ?? null,
    comparisonDigest: normalizeOptionalText(item?.comparisonDigest) ?? null,
    leftAgentId: normalizeOptionalText(item?.leftAgentId) ?? null,
    rightAgentId: normalizeOptionalText(item?.rightAgentId) ?? null,
    statusListId: normalizeOptionalText(item?.statusListId) ?? null,
  }));
  const linkedSubjectsMap = new Map();
  for (const credential of linkedCredentials) {
    const key = hashJson({
      kind: credential.kind,
      subjectId: credential.subjectId,
      issuerAgentId: credential.issuerAgentId,
    });
    if (!linkedSubjectsMap.has(key)) {
      linkedSubjectsMap.set(key, {
        kind: credential.kind,
        subjectId: credential.subjectId,
        subjectLabel: credential.subjectLabel,
        issuerAgentId: credential.issuerAgentId,
        credentialRecordIds: [],
        credentialIds: [],
        didMethods: [],
      });
    }
    const bucket = linkedSubjectsMap.get(key);
    if (credential.credentialRecordId) {
      bucket.credentialRecordIds.push(credential.credentialRecordId);
    }
    if (credential.credentialId) {
      bucket.credentialIds.push(credential.credentialId);
    }
    if (credential.didMethod) {
      bucket.didMethods.push(credential.didMethod);
    }
  }

  const comparisonLinks = new Map();
  for (const pair of repair.comparisonPairs || []) {
    const key =
      normalizeOptionalText(pair?.subjectId) ||
      normalizeOptionalText(pair?.comparisonDigest) ||
      hashJson({
        leftAgentId: normalizeOptionalText(pair?.pair?.left?.agentId ?? pair?.leftAgentId) ?? null,
        rightAgentId: normalizeOptionalText(pair?.pair?.right?.agentId ?? pair?.rightAgentId) ?? null,
        leftDid: normalizeOptionalText(pair?.pair?.left?.did ?? pair?.leftDid) ?? null,
        rightDid: normalizeOptionalText(pair?.pair?.right?.did ?? pair?.rightDid) ?? null,
      });
    comparisonLinks.set(key, {
      subjectId: normalizeOptionalText(pair?.subjectId) ?? null,
      subjectLabel: normalizeOptionalText(pair?.subjectLabel) ?? null,
      comparisonDigest: normalizeOptionalText(pair?.comparisonDigest) ?? null,
      leftAgentId: normalizeOptionalText(pair?.pair?.left?.agentId ?? pair?.leftAgentId) ?? null,
      rightAgentId: normalizeOptionalText(pair?.pair?.right?.agentId ?? pair?.rightAgentId) ?? null,
    });
  }
  for (const credential of linkedCredentials) {
    if (!credential.comparisonDigest && !credential.leftAgentId && !credential.rightAgentId && credential.kind !== "agent_comparison") {
      continue;
    }
    const key =
      credential.subjectId ||
      credential.comparisonDigest ||
      hashJson({
        kind: credential.kind,
        leftAgentId: credential.leftAgentId,
        rightAgentId: credential.rightAgentId,
        credentialRecordId: credential.credentialRecordId,
      });
    comparisonLinks.set(key, {
      subjectId: credential.subjectId,
      subjectLabel: credential.subjectLabel,
      comparisonDigest: credential.comparisonDigest,
      leftAgentId: credential.leftAgentId,
      rightAgentId: credential.rightAgentId,
    });
  }

  return {
    agentIds: collectMigrationRepairRelatedAgentIds(repair),
    repairedCredentialRecordIds: linkedCredentials.map((item) => item.credentialRecordId).filter(Boolean),
    repairedCredentialIds: linkedCredentials.map((item) => item.credentialId).filter(Boolean),
    repairedCredentials: linkedCredentials,
    repairedSubjects: [...linkedSubjectsMap.values()].map((item) => ({
      ...item,
      credentialRecordIds: [...new Set(item.credentialRecordIds)],
      credentialIds: [...new Set(item.credentialIds)],
      didMethods: [...new Set(item.didMethods)],
    })),
    repairedComparisons: [...comparisonLinks.values()],
  };
}

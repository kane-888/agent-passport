export function credentialSubjectLabel(store, record) {
  if (!record) {
    return null;
  }

  if (record.subjectType === "agent" && record.subjectId) {
    return store?.agents?.[record.subjectId]?.displayName || store?.agents?.[record.subjectId]?.agentId || record.subjectId;
  }

  if (record.subjectType === "proposal" && record.subjectId) {
    const proposal = store?.proposals?.find((entry) => entry.proposalId === record.subjectId);
    return proposal?.title || proposal?.proposalId || record.subjectId;
  }

  if (record.subjectType === "comparison") {
    return (
      record.comparisonLabel ||
      record.note ||
      [record.comparisonLeftAgentId || record.comparisonLeftDid, record.comparisonRightAgentId || record.comparisonRightDid]
        .filter(Boolean)
        .join(" vs ") ||
      record.subjectId ||
      record.credentialId ||
      null
    );
  }

  if (record.subjectType === "repair") {
    return record.migrationSummary || record.note || record.subjectId || record.credentialId || null;
  }

  return record.subjectId || record.credentialId || null;
}

export function credentialIssuerLabel(store, record) {
  if (!record) {
    return null;
  }

  return (
    store?.agents?.[record.issuerAgentId]?.displayName ||
    record.issuerLabel ||
    record.issuerDid ||
    record.issuerAgentId ||
    null
  );
}

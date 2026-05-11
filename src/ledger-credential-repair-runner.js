import {
  cloneJson,
  createRecordId,
  normalizeBooleanFlag,
  normalizeOptionalText,
  normalizeTextList,
} from "./ledger-core-utils.js";
import { AGENT_PASSPORT_MAIN_AGENT_ID } from "./main-agent-compat.js";
import {
  normalizeCredentialKind,
} from "./ledger-credential-core.js";
import {
  findCredentialRecordBySiblingGroupKey,
} from "./ledger-credential-record-view.js";
import {
  buildComparisonRepairPairState,
  buildComparisonRepairReferences,
  normalizeComparisonRepairPairList,
  resolveComparisonRepairPairSubjects,
  summarizeCredentialMethodCoverage,
} from "./ledger-credential-repair-coverage.js";
import { matchesCompatibleAgentId } from "./ledger-identity-compat.js";
import { buildMigrationRepairSummary } from "./ledger-repair-links.js";
import {
  normalizeDidMethod,
  PUBLIC_SIGNABLE_DID_METHODS,
} from "./protocol.js";

function requireRepairRunnerDep(deps = {}, name) {
  const value = deps[name];
  if (typeof value !== "function") {
    throw new Error(`${name} dependency is required`);
  }
  return value;
}

function resolveCredentialRepairRunnerLimit(limit, defaultCredentialLimit = 50) {
  const fallback = Number.isFinite(Number(defaultCredentialLimit)) && Number(defaultCredentialLimit) > 0
    ? Math.floor(Number(defaultCredentialLimit))
    : 50;
  return Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : fallback;
}

function resolveCredentialRepairRunnerDefaultLimit(deps = {}) {
  return resolveCredentialRepairRunnerLimit(deps.defaultCredentialLimit, 50);
}

export function runAgentComparisonMigrationRepair(
  store,
  {
    comparisonPairs = null,
    leftAgentId = null,
    rightAgentId = null,
    leftDid = null,
    rightDid = null,
    leftWalletAddress = null,
    rightWalletAddress = null,
    leftWindowId = null,
    rightWindowId = null,
    issuerAgentId = AGENT_PASSPORT_MAIN_AGENT_ID,
    issuerDid = null,
    issuerDidMethod = null,
    issuerWalletAddress = null,
    didMethods = null,
    limit = null,
    dryRun = false,
    receiptDidMethod = null,
    issueBothMethods = false,
  } = {},
  deps = {}
) {
  const resolveAgentReferenceFromStore = requireRepairRunnerDep(deps, "resolveAgentReferenceFromStore");
  const buildAgentCredentialMethodCoverage = requireRepairRunnerDep(deps, "buildAgentCredentialMethodCoverage");
  const buildAgentComparisonView = requireRepairRunnerDep(deps, "buildAgentComparisonView");
  const ensureAgentComparisonCredentialSnapshot = requireRepairRunnerDep(deps, "ensureAgentComparisonCredentialSnapshot");
  const issueMigrationRepairReceipt = requireRepairRunnerDep(deps, "issueMigrationRepairReceipt");
  const fallbackPair = {
    leftAgentId,
    rightAgentId,
    leftDid,
    rightDid,
    leftWalletAddress,
    rightWalletAddress,
    leftWindowId,
    rightWindowId,
  };
  const targets = normalizeComparisonRepairPairList(comparisonPairs, fallbackPair);
  if (!targets.length) {
    throw new Error("comparisonPairs or left/right references are required");
  }

  const issuerResolution = resolveAgentReferenceFromStore(store, {
    agentId:
      normalizeOptionalText(issuerAgentId) ||
      (!normalizeOptionalText(issuerDid) && !normalizeOptionalText(issuerWalletAddress) ? AGENT_PASSPORT_MAIN_AGENT_ID : null),
    did: issuerDid,
    walletAddress: issuerWalletAddress,
  });
  const issuerAgent = issuerResolution.agent;
  const requestedDidMethods = normalizeTextList(didMethods)
    .map((item) => normalizeDidMethod(item))
    .filter(Boolean);
  const selectedDidMethods =
    requestedDidMethods.length > 0 ? [...new Set(requestedDidMethods)] : [...PUBLIC_SIGNABLE_DID_METHODS];
  const cappedLimit = resolveCredentialRepairRunnerLimit(limit, resolveCredentialRepairRunnerDefaultLimit(deps));
  const resolvedDryRun = normalizeBooleanFlag(dryRun, false);
  const selectedTargets = targets.slice(0, cappedLimit);
  const coverageBefore = buildAgentCredentialMethodCoverage(store, issuerAgent.agentId);
  const plan = [];
  const repaired = [];
  const skipped = [];
  const pairStates = [];
  let createdAny = false;

  for (const target of selectedTargets) {
    try {
      const comparison = buildAgentComparisonView(store, target.left, target.right, {
        comparisonOnly: true,
      });
      const beforeState = buildComparisonRepairPairState(store, comparison, issuerAgent, selectedDidMethods);

      for (const didMethod of beforeState.plannedDidMethods) {
        plan.push({
          kind: "agent_comparison",
          subjectId: beforeState.subjectId,
          subjectLabel: beforeState.subjectLabel,
          comparisonDigest: beforeState.comparisonDigest,
          issuerAgentId: issuerAgent.agentId,
          leftAgentId: comparison?.left?.snapshot?.agentId ?? null,
          rightAgentId: comparison?.right?.snapshot?.agentId ?? null,
          didMethod,
          reason: beforeState.missingDidMethods.includes(didMethod) ? "missing_method" : "stale_snapshot",
        });

        if (resolvedDryRun) {
          continue;
        }

        const { credentialRecord, created } = ensureAgentComparisonCredentialSnapshot(store, comparison, {
          issuerAgentId: issuerAgent.agentId,
          issuerDidMethod: didMethod,
        });
        if (created) {
          createdAny = true;
        }

        repaired.push({
          kind: "agent_comparison",
          subjectId: beforeState.subjectId,
          subjectLabel: beforeState.subjectLabel,
          comparisonDigest: beforeState.comparisonDigest,
          issuerAgentId: issuerAgent.agentId,
          leftAgentId: comparison?.left?.snapshot?.agentId ?? null,
          rightAgentId: comparison?.right?.snapshot?.agentId ?? null,
          didMethod,
          created,
          credentialRecordId: credentialRecord?.credentialRecordId ?? null,
          credentialId: credentialRecord?.credentialId ?? null,
          issuerDid: credentialRecord?.issuerDid ?? null,
          statusListId: credentialRecord?.statusListId ?? null,
        });
      }

      if (!beforeState.plannedDidMethods.length) {
        skipped.push({
          kind: "agent_comparison",
          subjectId: beforeState.subjectId,
          subjectLabel: beforeState.subjectLabel,
          issuerAgentId: issuerAgent.agentId,
          reason: "comparison evidence already current for requested DID methods",
        });
      }

      const afterState = resolvedDryRun ? beforeState : buildComparisonRepairPairState(store, comparison, issuerAgent, selectedDidMethods);
      pairStates.push({
        pair: cloneJson(target),
        subjectId: beforeState.subjectId,
        subjectLabel: beforeState.subjectLabel,
        comparisonDigest: beforeState.comparisonDigest,
        requestedDidMethods: [...selectedDidMethods],
        before: {
          availableDidMethods: beforeState.availableDidMethods,
          missingDidMethods: beforeState.missingDidMethods,
          staleDidMethods: beforeState.staleDidMethods,
          plannedDidMethods: beforeState.plannedDidMethods,
          complete: beforeState.complete,
          methodStates: beforeState.methodStates,
        },
        after: {
          availableDidMethods: afterState.availableDidMethods,
          missingDidMethods: afterState.missingDidMethods,
          staleDidMethods: afterState.staleDidMethods,
          plannedDidMethods: afterState.plannedDidMethods,
          complete: afterState.complete,
          methodStates: afterState.methodStates,
        },
      });
    } catch (error) {
      const reason = error.message || "comparison pair repair failed";
      skipped.push({
        kind: "agent_comparison",
        pair: cloneJson(target),
        issuerAgentId: issuerAgent.agentId,
        reason,
      });
      pairStates.push({
        pair: cloneJson(target),
        error: reason,
      });
    }
  }

  const coverageAfter = buildAgentCredentialMethodCoverage(store, issuerAgent.agentId);
  const repair = {
    repairId: createRecordId("repair"),
    scope: "comparison_pair",
    issuerAgentId: issuerAgent.agentId,
    dryRun: resolvedDryRun,
    requestedKinds: ["agent_comparison"],
    requestedSubjectIds: pairStates.map((pair) => pair.subjectId).filter(Boolean),
    requestedDidMethods: selectedDidMethods,
    selectedPairCount: selectedTargets.length,
    selectedSubjectCount: pairStates.filter((pair) => pair.subjectId).length,
    plannedRepairCount: plan.length,
    repairedCount: repaired.length,
    skippedCount: skipped.length,
    comparisonPairs: pairStates,
    plan,
    repaired,
    skipped,
    beforeCoverage: summarizeCredentialMethodCoverage(coverageBefore),
    afterCoverage: summarizeCredentialMethodCoverage(coverageAfter),
  };
  repair.summary = buildMigrationRepairSummary(repair);
  repair.repairReceipt = null;

  if (!resolvedDryRun) {
    repair.repairReceipt = issueMigrationRepairReceipt(store, repair, {
      issuerAgentId: issuerAgent.agentId,
      receiptDidMethod,
      issueBothMethods,
    });
    createdAny = true;
  }

  return { repair, createdAny };
}

export function runAgentCredentialMigrationRepair(
  store,
  agentId,
  {
    dryRun = false,
    kinds = null,
    subjectIds = null,
    comparisonPairs = null,
    didMethods = null,
    limit = null,
    includeComparison = true,
    receiptDidMethod = null,
    issueBothMethods = false,
  } = {},
  deps = {}
) {
  const ensureAgent = requireRepairRunnerDep(deps, "ensureAgent");
  const buildAgentCredentialMethodCoverage = requireRepairRunnerDep(deps, "buildAgentCredentialMethodCoverage");
  const resolveAgentComparisonAuditPair = requireRepairRunnerDep(deps, "resolveAgentComparisonAuditPair");
  const ensureAgentCredentialSnapshot = requireRepairRunnerDep(deps, "ensureAgentCredentialSnapshot");
  const ensureAuthorizationProposal = requireRepairRunnerDep(deps, "ensureAuthorizationProposal");
  const ensureAuthorizationCredentialSnapshot = requireRepairRunnerDep(deps, "ensureAuthorizationCredentialSnapshot");
  const buildAgentComparisonView = requireRepairRunnerDep(deps, "buildAgentComparisonView");
  const ensureAgentComparisonCredentialSnapshot = requireRepairRunnerDep(deps, "ensureAgentComparisonCredentialSnapshot");
  const issueMigrationRepairReceipt = requireRepairRunnerDep(deps, "issueMigrationRepairReceipt");
  const agent = ensureAgent(store, agentId);

  const coverageBefore = buildAgentCredentialMethodCoverage(store, agent.agentId);
  const requestedKinds = new Set(normalizeTextList(kinds).map((item) => normalizeCredentialKind(item)));
  const requestedSubjectIds = new Set(normalizeTextList(subjectIds));
  const comparisonTargetResolution = resolveComparisonRepairPairSubjects(store, comparisonPairs, null, {
    resolveAgentComparisonAuditPair,
  });
  if (comparisonTargetResolution.targets.length > 0 && requestedKinds.size === 0) {
    requestedKinds.add("agent_comparison");
  }
  const requestedDidMethods = normalizeTextList(didMethods)
    .map((item) => normalizeDidMethod(item))
    .filter(Boolean);
  const selectedDidMethods = requestedDidMethods.length > 0 ? requestedDidMethods : [...PUBLIC_SIGNABLE_DID_METHODS];
  const cappedLimit = resolveCredentialRepairRunnerLimit(limit, resolveCredentialRepairRunnerDefaultLimit(deps));
  const resolvedDryRun = normalizeBooleanFlag(dryRun, false);
  const allowComparison = normalizeBooleanFlag(includeComparison, true);
  const repairableSubjects = (coverageBefore.repairableSubjects || [])
    .filter((subject) => matchesCompatibleAgentId(store, subject.issuerAgentId, agent.agentId))
    .filter((subject) => (requestedKinds.size > 0 ? requestedKinds.has(normalizeCredentialKind(subject.kind)) : true))
    .filter((subject) => (requestedSubjectIds.size > 0 ? requestedSubjectIds.has(subject.subjectId) : true))
    .filter((subject) => (allowComparison ? true : normalizeCredentialKind(subject.kind) !== "agent_comparison"))
    .filter((subject) =>
      comparisonTargetResolution.subjectIds.size > 0
        ? normalizeCredentialKind(subject.kind) === "agent_comparison" &&
          comparisonTargetResolution.subjectIds.has(normalizeOptionalText(subject.subjectId))
        : true
    )
    .slice(0, cappedLimit);

  const plan = [];
  const repaired = [];
  const skipped = comparisonTargetResolution.invalid.map((entry) => ({
    kind: "agent_comparison",
    pair: cloneJson(entry.pair),
    issuerAgentId: agent.agentId,
    reason: entry.reason,
  }));
  let createdAny = false;

  for (const subject of repairableSubjects) {
    const candidateMethods = (subject.missingDidMethods || []).filter((method) => selectedDidMethods.includes(method));
    if (!candidateMethods.length) {
      skipped.push({
        groupKey: subject.groupKey,
        kind: subject.kind,
        subjectId: subject.subjectId,
        issuerAgentId: subject.issuerAgentId,
        reason: "no requested DID methods match the missing method set",
      });
      continue;
    }

    const representativeRecord = findCredentialRecordBySiblingGroupKey(store, subject.groupKey);
    if (!representativeRecord) {
      skipped.push({
        groupKey: subject.groupKey,
        kind: subject.kind,
        subjectId: subject.subjectId,
        issuerAgentId: subject.issuerAgentId,
        reason: "representative credential record not found",
      });
      continue;
    }

    for (const didMethod of candidateMethods) {
      const baseItem = {
        groupKey: subject.groupKey,
        kind: subject.kind,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        subjectLabel: subject.subjectLabel,
        issuerAgentId: subject.issuerAgentId,
        didMethod,
      };
      plan.push(baseItem);

      if (resolvedDryRun) {
        continue;
      }

      try {
        let credentialRecord = null;
        let created = false;

        if (normalizeCredentialKind(subject.kind) === "agent_identity") {
          const agent = ensureAgent(store, subject.subjectId);
          ({ credentialRecord, created } = ensureAgentCredentialSnapshot(store, agent, { didMethod }));
        } else if (normalizeCredentialKind(subject.kind) === "authorization_receipt") {
          const proposal = ensureAuthorizationProposal(store, subject.subjectId);
          ({ credentialRecord, created } = ensureAuthorizationCredentialSnapshot(store, proposal, { didMethod }));
        } else if (normalizeCredentialKind(subject.kind) === "agent_comparison") {
          const references = buildComparisonRepairReferences(representativeRecord);
          if (!references) {
            throw new Error("comparison references are incomplete");
          }

          const comparison = buildAgentComparisonView(store, references.leftReference, references.rightReference);
          ({ credentialRecord, created } = ensureAgentComparisonCredentialSnapshot(store, comparison, {
            issuerAgentId: subject.issuerAgentId,
            issuerDidMethod: didMethod,
          }));
        } else {
          throw new Error(`unsupported credential kind: ${subject.kind}`);
        }

        if (created) {
          createdAny = true;
        }

        repaired.push({
          ...baseItem,
          created,
          credentialRecordId: credentialRecord?.credentialRecordId ?? null,
          credentialId: credentialRecord?.credentialId ?? null,
          issuerDid: credentialRecord?.issuerDid ?? null,
          statusListId: credentialRecord?.statusListId ?? null,
        });
      } catch (error) {
        skipped.push({
          ...baseItem,
          reason: error.message || "repair failed",
        });
      }
    }
  }

  const coverageAfter = buildAgentCredentialMethodCoverage(store, agentId);
  const repair = {
    repairId: createRecordId("repair"),
    scope: "agent",
    agentId,
    dryRun: resolvedDryRun,
    includeComparison: allowComparison,
    requestedKinds: [...requestedKinds],
    requestedSubjectIds: [...requestedSubjectIds],
    requestedDidMethods: selectedDidMethods,
    comparisonTargetCount: comparisonTargetResolution.pairs.length,
    comparisonPairs: comparisonTargetResolution.pairs,
    selectedSubjectCount: repairableSubjects.length,
    plannedRepairCount: plan.length,
    repairedCount: repaired.length,
    skippedCount: skipped.length,
    plan,
    repaired,
    skipped,
    beforeCoverage: summarizeCredentialMethodCoverage(coverageBefore),
    afterCoverage: summarizeCredentialMethodCoverage(coverageAfter),
  };
  repair.summary = buildMigrationRepairSummary(repair);
  repair.repairReceipt = null;

  if (!resolvedDryRun) {
    repair.repairReceipt = issueMigrationRepairReceipt(store, repair, {
      issuerAgentId: agentId,
      receiptDidMethod,
      issueBothMethods,
    });
    createdAny = true;
  }

  return { repair, createdAny };
}

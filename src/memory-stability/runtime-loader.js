import assert from "node:assert/strict";

import { assertUniqueMemoryStabilityActionVocabulary } from "./action-vocabulary.js";
import { verifyMemoryStabilityAdapterContract } from "./adapter-contract.js";
import { loadVerifiedMemoryStabilityContract } from "./contract-loader.js";
import { loadVerifiedSelfLearningGovernanceContract } from "./self-learning-governance.js";

export const MEMORY_STABILITY_RUNTIME_LOADER_MODE = "memory-stability-runtime-loader/v1";

function buildPassiveEffects() {
  return {
    modelCalled: false,
    networkCalled: false,
    ledgerWritten: false,
    storeWritten: false,
    promptMutated: false,
    correctionExecuted: false,
  };
}

function safeError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    code: error?.code ?? "MEMORY_STABILITY_RUNTIME_LOAD_FAILED",
    stage: error?.stage ?? "runtime_loader",
    detail: error?.detail ?? "",
  };
}

export class MemoryStabilityRuntimeLoadError extends Error {
  constructor(message, { stage = "runtime_loader", cause = null, detail = "" } = {}) {
    super(message);
    this.name = "MemoryStabilityRuntimeLoadError";
    this.code = "MEMORY_STABILITY_RUNTIME_LOAD_FAILED";
    this.stage = stage;
    this.detail = detail;
    if (cause) this.cause = cause;
  }
}

export async function loadVerifiedMemoryStabilityRuntime({
  rootDir,
  includeAdapterContract = true,
  includeSelfLearningGovernance = true,
} = {}) {
  try {
    const actionVocabulary = assertUniqueMemoryStabilityActionVocabulary();
    assert.equal(actionVocabulary.ok, true, "memory stability action vocabulary must be canonical");

    const contract = await loadVerifiedMemoryStabilityContract({ rootDir });
    const adapterContract = includeAdapterContract
      ? await verifyMemoryStabilityAdapterContract({ rootDir })
      : null;
    const selfLearningGovernance = includeSelfLearningGovernance
      ? await loadVerifiedSelfLearningGovernanceContract({ rootDir })
      : null;

    return {
      ok: true,
      failClosed: true,
      mode: MEMORY_STABILITY_RUNTIME_LOADER_MODE,
      loadedAt: new Date().toISOString(),
      profile: contract.profile,
      effects: buildPassiveEffects(),
      gates: {
        actionVocabulary: true,
        contract: contract.ok === true,
        adapterContract: includeAdapterContract ? adapterContract?.ok === true : "skipped",
        selfLearningGovernance: includeSelfLearningGovernance ? selfLearningGovernance?.ok === true : "skipped",
      },
      contract: {
        profilePath: contract.contract.profilePath,
        modelProfiles: contract.contract.modelProfiles,
        redactedSnapshots: contract.contract.redactedSnapshots,
        correctionEvents: adapterContract?.contract?.correctionEvents ?? null,
        selfLearningBoundary: selfLearningGovernance?.contract?.boundary ?? null,
      },
      verifierReports: {
        actionVocabulary,
        profile: contract.verifierReports.profile,
        snapshots: contract.verifierReports.snapshots,
        correctionEvents: adapterContract?.verifierReports?.correctionEvents ?? null,
        selfLearning: selfLearningGovernance?.verifierReports ?? null,
      },
    };
  } catch (error) {
    throw new MemoryStabilityRuntimeLoadError("Fail-closed memory stability runtime load failed", {
      stage: error?.stage ?? "runtime_loader",
      cause: error,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function tryLoadVerifiedMemoryStabilityRuntime(options = {}) {
  try {
    return await loadVerifiedMemoryStabilityRuntime(options);
  } catch (error) {
    return {
      ok: false,
      failClosed: true,
      mode: MEMORY_STABILITY_RUNTIME_LOADER_MODE,
      effects: buildPassiveEffects(),
      error: safeError(error),
    };
  }
}

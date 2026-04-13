import { getReadSessionViewTemplate } from "./server-read-access.js";

function redactRecoveryBundleSummary(summary = null) {
  if (!summary || typeof summary !== "object") {
    return summary;
  }
  return {
    ...summary,
    bundleId: null,
    machineId: null,
    machineLabel: null,
    residentAgentId: null,
    lastEventHash: null,
    chainId: null,
  };
}

function redactRecoveryRehearsalSummary(summary = null) {
  if (!summary || typeof summary !== "object") {
    return summary;
  }
  return {
    createdAt: summary.createdAt ?? null,
    status: summary.status ?? null,
    checkCount: summary.checkCount ?? 0,
    passedCount: summary.passedCount ?? 0,
    failedCount: summary.failedCount ?? 0,
    summary: summary.summary ?? null,
  };
}

function redactSetupPackageSummary(summary = null) {
  if (!summary || typeof summary !== "object") {
    return summary;
  }
  return {
    ...summary,
    packageId: null,
    machineId: null,
    machineLabel: null,
    residentAgentId: null,
    latestRecoveryBundleId: null,
    latestRecoveryRehearsalId: null,
  };
}

function redactCrossDeviceRecoveryClosureForReadSession(crossDeviceRecoveryClosure = null) {
  if (!crossDeviceRecoveryClosure || typeof crossDeviceRecoveryClosure !== "object") {
    return crossDeviceRecoveryClosure;
  }
  return {
    ...crossDeviceRecoveryClosure,
    latestBundle: redactRecoveryBundleSummary(crossDeviceRecoveryClosure.latestBundle),
    latestSetupPackage: redactSetupPackageSummary(crossDeviceRecoveryClosure.latestSetupPackage),
    latestPassedRecoveryRehearsal: redactRecoveryRehearsalSummary(
      crossDeviceRecoveryClosure.latestPassedRecoveryRehearsal
    ),
  };
}

export function redactFormalRecoveryFlowForReadSession(formalRecoveryFlow = null) {
  if (!formalRecoveryFlow || typeof formalRecoveryFlow !== "object") {
    return formalRecoveryFlow;
  }
  return {
    ...formalRecoveryFlow,
    backupBundle: formalRecoveryFlow.backupBundle
      ? {
          ...formalRecoveryFlow.backupBundle,
          latestBundle: redactRecoveryBundleSummary(formalRecoveryFlow.backupBundle.latestBundle),
        }
      : null,
    rehearsal: formalRecoveryFlow.rehearsal
      ? {
          ...formalRecoveryFlow.rehearsal,
          latestPassedRecoveryRehearsal: redactRecoveryRehearsalSummary(
            formalRecoveryFlow.rehearsal.latestPassedRecoveryRehearsal
          ),
        }
      : null,
    setupPackage: formalRecoveryFlow.setupPackage
      ? {
          ...formalRecoveryFlow.setupPackage,
          latestPackage: redactSetupPackageSummary(formalRecoveryFlow.setupPackage.latestPackage),
        }
      : null,
    crossDeviceRecoveryClosure: redactCrossDeviceRecoveryClosureForReadSession(
      formalRecoveryFlow.crossDeviceRecoveryClosure
    ),
  };
}

function summarizeSecurityAnomalyForReadSession(entry = null) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  return {
    anomalyId: entry.anomalyId ?? null,
    category: entry.category ?? null,
    severity: entry.severity ?? null,
    code: entry.code ?? null,
    createdAt: entry.createdAt ?? null,
    acknowledgedAt: entry.acknowledgedAt ?? null,
  };
}

export function redactSecurityPayloadForReadSession(body = {}, accessOrSession = null) {
  const securityTemplate = getReadSessionViewTemplate(accessOrSession, "security", "metadata_only");
  return {
    ...body,
    apiWriteProtection: body.apiWriteProtection
      ? {
          ...body.apiWriteProtection,
          tokenPath: null,
          keychainService: null,
          keychainAccount: null,
        }
      : null,
    localStore: body.localStore
      ? {
          ...body.localStore,
          ledgerPath: null,
          keyPath: null,
          recoveryDir: null,
        }
      : null,
    keyManagement: body.keyManagement
      ? {
          ...body.keyManagement,
          storeKey: body.keyManagement.storeKey
            ? {
                ...body.keyManagement.storeKey,
                path: null,
                keychainService: null,
                keychainAccount: null,
              }
            : null,
          signingKey: body.keyManagement.signingKey
            ? {
                ...body.keyManagement.signingKey,
                path: null,
                keychainService: null,
                keychainAccount: null,
              }
            : null,
        }
      : null,
    localStorageFormalFlow: redactFormalRecoveryFlowForReadSession(body.localStorageFormalFlow),
    anomalyAudit: body.anomalyAudit
      ? {
          ...body.anomalyAudit,
          anomalies: Array.isArray(body.anomalyAudit.anomalies)
            ? body.anomalyAudit.anomalies.map((entry) =>
                securityTemplate === "summary_only"
                  ? summarizeSecurityAnomalyForReadSession(entry)
                  : redactSecurityAnomalyForReadSession(entry, accessOrSession)
              )
            : [],
        }
      : null,
  };
}

export function redactSecurityAnomalyForReadSession(entry = null, accessOrSession = null) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  const summary = summarizeSecurityAnomalyForReadSession(entry);
  if (getReadSessionViewTemplate(accessOrSession, "security", "metadata_only") === "summary_only") {
    return summary;
  }
  return {
    ...summary,
    message: entry.message ?? null,
    path: entry.path ?? null,
    method: entry.method ?? null,
    scope: entry.scope ?? null,
    reason: entry.reason ?? null,
    createdAt: entry.createdAt ?? null,
    acknowledgedAt: entry.acknowledgedAt ?? null,
  };
}

export function redactRuntimeHousekeepingForReadSession(report = {}) {
  return {
    ...report,
    rootDir: null,
    paths: report.paths
      ? {
          ...report.paths,
          dataDir: null,
          liveLedgerPath: null,
          archiveDir: null,
          recoveryDir: null,
          setupPackageDir: null,
        }
      : null,
    recoveryBundles: report.recoveryBundles
      ? {
          ...report.recoveryBundles,
          kept: Array.isArray(report.recoveryBundles.kept)
            ? report.recoveryBundles.kept.map((entry) => ({
                ...entry,
                bundlePath: null,
              }))
            : [],
          candidates: Array.isArray(report.recoveryBundles.candidates)
            ? report.recoveryBundles.candidates.map((entry) => ({
                ...entry,
                bundlePath: null,
              }))
            : [],
          deleted: Array.isArray(report.recoveryBundles.deleted)
            ? report.recoveryBundles.deleted.map((entry) => ({
                ...entry,
                bundlePath: null,
              }))
            : [],
        }
      : null,
    setupPackages: report.setupPackages
      ? {
          ...report.setupPackages,
          kept: Array.isArray(report.setupPackages.kept)
            ? report.setupPackages.kept.map((entry) => ({
                ...entry,
                packagePath: null,
              }))
            : [],
          candidates: Array.isArray(report.setupPackages.candidates)
            ? report.setupPackages.candidates.map((entry) => ({
                ...entry,
                packagePath: null,
              }))
            : [],
        }
      : null,
    archives: report.archives
      ? {
          ...report.archives,
          directories: Array.isArray(report.archives.directories)
            ? report.archives.directories.map((entry) => ({
                ...entry,
                path: null,
              }))
            : [],
        }
      : null,
  };
}

export function redactRecoveryListingForReadSession(payload = {}) {
  return {
    ...payload,
    recoveryDir: null,
    bundles: Array.isArray(payload.bundles)
      ? payload.bundles.map((bundle) => ({
          ...bundle,
          bundlePath: null,
        }))
      : [],
  };
}

export function redactSetupPackageListingForReadSession(payload = {}) {
  return {
    ...payload,
    packageDir: null,
    packages: Array.isArray(payload.packages)
      ? payload.packages.map((entry) => ({
          ...entry,
          packagePath: null,
        }))
      : [],
  };
}

export function redactSetupPackageDetailForReadSession(payload = {}) {
  return {
    ...payload,
    summary: payload.summary
      ? {
          ...payload.summary,
          packagePath: null,
        }
      : null,
    package: payload.package
      ? {
          ...payload.package,
          runtimeConfig: payload.package.runtimeConfig
            ? {
                ...payload.package.runtimeConfig,
                localReasoner: payload.package.runtimeConfig.localReasoner
                  ? {
                      ...payload.package.runtimeConfig.localReasoner,
                      command: null,
                      args: [],
                      cwd: null,
                      lastWarm: payload.package.runtimeConfig.localReasoner.lastWarm
                        ? {
                            ...payload.package.runtimeConfig.localReasoner.lastWarm,
                            responsePreview: null,
                          }
                        : null,
                    }
                  : null,
                sandboxPolicy: payload.package.runtimeConfig.sandboxPolicy
                  ? {
                      ...payload.package.runtimeConfig.sandboxPolicy,
                      filesystemAllowlist: [],
                    }
                  : null,
                constrainedExecutionPolicy: payload.package.runtimeConfig.sandboxPolicy
                  ? {
                      ...payload.package.runtimeConfig.sandboxPolicy,
                      filesystemAllowlist: [],
                    }
                  : null,
              }
            : null,
          recovery: payload.package.recovery
            ? {
                ...payload.package.recovery,
                latestBundle: payload.package.recovery.latestBundle
                  ? {
                      ...payload.package.recovery.latestBundle,
                      bundlePath: null,
                    }
                  : null,
              }
            : null,
          localReasonerProfiles: Array.isArray(payload.package.localReasonerProfiles)
            ? payload.package.localReasonerProfiles.map((profile) => ({
                ...profile,
                config: profile?.config
                  ? {
                      ...profile.config,
                      command: null,
                      args: [],
                      cwd: null,
                    }
                  : null,
              }))
            : [],
        }
      : null,
  };
}

function summarizeLocalReasonerProbeForReadSession(entry = null) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  return {
    checkedAt: entry.checkedAt ?? null,
    warmedAt: entry.warmedAt ?? null,
    status: entry.status ?? null,
    reachable: entry.reachable ?? null,
    error: entry.error ?? null,
  };
}

function redactLocalReasonerProfileSummaryEntryForReadSession(entry = null, accessOrSession = null) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  const template = getReadSessionViewTemplate(accessOrSession, "deviceRuntime", "metadata_only");
  const redacted = {
    ...entry,
    baseUrl: null,
    path: null,
    note: template === "summary_only" ? null : entry.note ?? null,
  };
  if (template !== "summary_only") {
    return redacted;
  }
  return {
    profileId: redacted.profileId ?? null,
    label: redacted.label ?? null,
    provider: redacted.provider ?? null,
    model: redacted.model ?? null,
    enabled: redacted.enabled ?? null,
    configured: redacted.configured ?? null,
    createdAt: redacted.createdAt ?? null,
    updatedAt: redacted.updatedAt ?? null,
    useCount: redacted.useCount ?? 0,
    lastActivatedAt: redacted.lastActivatedAt ?? null,
    rank: redacted.rank ?? null,
    recommended: redacted.recommended ?? null,
    health: redacted.health && typeof redacted.health === "object"
      ? {
          status: redacted.health.status ?? null,
          configured: redacted.health.configured ?? null,
          restorable: redacted.health.restorable ?? null,
          lastHealthyAt: redacted.health.lastHealthyAt ?? null,
          reason: redacted.health.reason ?? null,
        }
      : null,
  };
}

export function redactLocalReasonerDiagnosticForReadSession(diagnostics = null, accessOrSession = null) {
  if (!diagnostics || typeof diagnostics !== "object") {
    return diagnostics;
  }
  const redacted = {
    ...diagnostics,
    commandRealpath: null,
    command: null,
    cwd: null,
    scriptPath: null,
  };
  if (getReadSessionViewTemplate(accessOrSession, "deviceRuntime", "metadata_only") !== "summary_only") {
    return redacted;
  }
  return {
    checkedAt: redacted.checkedAt ?? null,
    provider: redacted.provider ?? null,
    enabled: redacted.enabled ?? null,
    configured: redacted.configured ?? null,
    reachable: redacted.reachable ?? null,
    status: redacted.status ?? null,
    model: redacted.model ?? null,
    modelCount: redacted.modelCount ?? 0,
    selectedModelPresent: redacted.selectedModelPresent ?? null,
    commandExists: redacted.commandExists ?? null,
    cwdExists: redacted.cwdExists ?? null,
    error: redacted.error ?? null,
  };
}

export function redactLocalReasonerRuntimeViewForReadSession(deviceRuntime = null, accessOrSession = null) {
  if (!deviceRuntime || typeof deviceRuntime !== "object") {
    return deviceRuntime;
  }
  const redacted = {
    ...deviceRuntime,
    localReasoner: deviceRuntime.localReasoner
      ? {
          ...deviceRuntime.localReasoner,
          command: null,
          args: [],
          cwd: null,
          baseUrl: null,
          path: null,
          lastWarm: deviceRuntime.localReasoner.lastWarm
            ? {
                ...deviceRuntime.localReasoner.lastWarm,
                responsePreview: null,
              }
            : null,
        }
      : null,
  };
  if (getReadSessionViewTemplate(accessOrSession, "deviceRuntime", "metadata_only") !== "summary_only") {
    return redacted;
  }
  return {
    deviceRuntimeId: redacted.deviceRuntimeId ?? null,
    localReasoner: redacted.localReasoner
      ? {
          enabled: redacted.localReasoner.enabled ?? null,
          provider: redacted.localReasoner.provider ?? null,
          configured: redacted.localReasoner.configured ?? null,
          model: redacted.localReasoner.model ?? null,
          format: redacted.localReasoner.format ?? null,
          lastProbe: summarizeLocalReasonerProbeForReadSession(redacted.localReasoner.lastProbe),
          lastWarm: summarizeLocalReasonerProbeForReadSession(redacted.localReasoner.lastWarm),
        }
      : null,
  };
}

export function redactLocalReasonerCatalogForReadSession(payload = {}, accessOrSession = null) {
  const template = getReadSessionViewTemplate(accessOrSession, "deviceRuntime", "metadata_only");
  return {
    ...payload,
    deviceRuntime: redactLocalReasonerRuntimeViewForReadSession(payload.deviceRuntime, accessOrSession),
    providers: Array.isArray(payload.providers)
      ? payload.providers.map((entry) => ({
          ...(template === "summary_only"
            ? {
                provider: entry?.provider ?? null,
                selected: entry?.selected ?? null,
                config: entry?.config
                  ? {
                      enabled: entry.config.enabled ?? null,
                      provider: entry.config.provider ?? null,
                      model: entry.config.model ?? null,
                    }
                  : null,
              }
            : {
                ...entry,
                config: entry.config
                  ? {
                      ...entry.config,
                      command: null,
                      args: [],
                      cwd: null,
                      baseUrl: null,
                    }
                  : null,
              }),
          lastWarm: entry.lastWarm
            ? {
                ...summarizeLocalReasonerProbeForReadSession(entry.lastWarm),
                responsePreview: null,
              }
            : null,
          lastProbe: summarizeLocalReasonerProbeForReadSession(entry.lastProbe),
          diagnostics: redactLocalReasonerDiagnosticForReadSession(entry.diagnostics, accessOrSession),
          rawDiagnostics: null,
          availableModelCount: Array.isArray(entry.availableModels) ? entry.availableModels.length : 0,
          availableModels:
            template === "summary_only"
              ? []
              : Array.isArray(entry.availableModels)
                ? [...entry.availableModels]
                : [],
        }))
      : [],
  };
}

export function redactLocalReasonerProfileDetailForReadSession(payload = {}, accessOrSession = null) {
  const template = getReadSessionViewTemplate(accessOrSession, "deviceRuntime", "metadata_only");
  const redacted = {
    ...payload,
    summary: redactLocalReasonerProfileSummaryEntryForReadSession(payload.summary, accessOrSession),
    profile: payload.profile
      ? {
          ...payload.profile,
          note: template === "summary_only" ? null : payload.profile.note ?? null,
          createdByAgentId: null,
          createdByWindowId: null,
          sourceWindowId: null,
          config: payload.profile.config
            ? {
                ...payload.profile.config,
                command: null,
                args: [],
                cwd: null,
                baseUrl: null,
                path: null,
              }
            : null,
        }
      : null,
  };
  if (template !== "summary_only") {
    return redacted;
  }
  return {
    ...redacted,
    profile: redacted.profile
      ? {
          profileId: redacted.profile.profileId ?? null,
          label: redacted.profile.label ?? null,
          provider: redacted.profile.provider ?? null,
          config: redacted.profile.config
            ? {
                enabled: redacted.profile.config.enabled ?? null,
                provider: redacted.profile.config.provider ?? null,
                model: redacted.profile.config.model ?? null,
                timeoutMs: redacted.profile.config.timeoutMs ?? null,
                command: null,
                args: [],
                cwd: null,
                baseUrl: null,
                path: null,
              }
            : null,
          createdAt: redacted.profile.createdAt ?? null,
          updatedAt: redacted.profile.updatedAt ?? null,
          useCount: redacted.profile.useCount ?? 0,
          lastActivatedAt: redacted.profile.lastActivatedAt ?? null,
          lastProbe: summarizeLocalReasonerProbeForReadSession(redacted.profile.lastProbe),
          lastWarm: summarizeLocalReasonerProbeForReadSession(redacted.profile.lastWarm),
          lastHealthyAt: redacted.profile.lastHealthyAt ?? null,
        }
      : null,
  };
}

export function redactLocalReasonerProfileListingForReadSession(payload = {}, accessOrSession = null) {
  return {
    ...payload,
    profiles: Array.isArray(payload.profiles)
      ? payload.profiles.map((entry) =>
          redactLocalReasonerProfileSummaryEntryForReadSession(entry, accessOrSession)
        )
      : [],
    restoreCandidates: Array.isArray(payload.restoreCandidates)
      ? payload.restoreCandidates.map((entry) =>
          redactLocalReasonerProfileSummaryEntryForReadSession(entry, accessOrSession)
        )
      : [],
  };
}

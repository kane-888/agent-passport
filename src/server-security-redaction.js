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

export function redactSecurityPayloadForReadSession(body = {}) {
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
            ? body.anomalyAudit.anomalies.map((entry) => ({
                anomalyId: entry.anomalyId,
                category: entry.category,
                severity: entry.severity,
                code: entry.code,
                createdAt: entry.createdAt,
                acknowledgedAt: entry.acknowledgedAt ?? null,
              }))
            : [],
        }
      : null,
  };
}

export function redactSecurityAnomalyForReadSession(entry = null) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  return {
    anomalyId: entry.anomalyId ?? null,
    category: entry.category ?? null,
    severity: entry.severity ?? null,
    code: entry.code ?? null,
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

export function redactLocalReasonerDiagnosticForReadSession(diagnostics = null) {
  if (!diagnostics || typeof diagnostics !== "object") {
    return diagnostics;
  }
  return {
    ...diagnostics,
    commandRealpath: null,
    command: null,
    cwd: null,
    scriptPath: null,
  };
}

export function redactLocalReasonerRuntimeViewForReadSession(deviceRuntime = null) {
  if (!deviceRuntime || typeof deviceRuntime !== "object") {
    return deviceRuntime;
  }
  return {
    ...deviceRuntime,
    localReasoner: deviceRuntime.localReasoner
      ? {
          ...deviceRuntime.localReasoner,
          command: null,
          args: [],
          cwd: null,
          lastWarm: deviceRuntime.localReasoner.lastWarm
            ? {
                ...deviceRuntime.localReasoner.lastWarm,
                responsePreview: null,
              }
            : null,
        }
      : null,
  };
}

export function redactLocalReasonerCatalogForReadSession(payload = {}) {
  return {
    ...payload,
    deviceRuntime: redactLocalReasonerRuntimeViewForReadSession(payload.deviceRuntime),
    providers: Array.isArray(payload.providers)
      ? payload.providers.map((entry) => ({
          ...entry,
          config: entry.config
            ? {
                ...entry.config,
                command: null,
                args: [],
                cwd: null,
              }
            : null,
          lastWarm: entry.lastWarm
            ? {
                ...entry.lastWarm,
                responsePreview: null,
              }
            : null,
          diagnostics: redactLocalReasonerDiagnosticForReadSession(entry.diagnostics),
          rawDiagnostics: null,
        }))
      : [],
  };
}

export function redactLocalReasonerProfileDetailForReadSession(payload = {}) {
  return {
    ...payload,
    profile: payload.profile
      ? {
          ...payload.profile,
          config: payload.profile.config
            ? {
                ...payload.profile.config,
                command: null,
                args: [],
                cwd: null,
              }
            : null,
        }
      : null,
  };
}

export function redactLocalReasonerProfileListingForReadSession(payload = {}) {
  return {
    ...payload,
    profiles: Array.isArray(payload.profiles)
      ? payload.profiles.map((entry) => ({
          ...entry,
        }))
      : [],
  };
}

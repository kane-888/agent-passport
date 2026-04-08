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

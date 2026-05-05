import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { COMPATIBLE_ADMIN_TOKEN_HEADERS } from "./admin-token-compat.js";
import {
  createRecordId,
  normalizeBooleanFlag,
  normalizeComparableText,
  normalizeOptionalText,
  normalizeTextList,
  now,
} from "./ledger-core-utils.js";
import {
  DEFAULT_SANDBOX_MAX_PROCESS_ARG_BYTES,
  DEFAULT_SANDBOX_MAX_PROCESS_ARGS,
  DEFAULT_SANDBOX_MAX_URL_LENGTH,
  buildDefaultRuntimeRiskStrategies,
  buildDeviceSecurityPostureState,
  normalizeDeviceRuntime,
  normalizeRuntimeActionType,
  normalizeRuntimeCapability,
  normalizeRuntimeReasonerProvider,
  normalizeRuntimeSandboxPolicy,
  parseSandboxAllowlistedCommandEntry,
} from "./ledger-device-runtime.js";

const LOW_RISK_RUNTIME_ACTION_TYPES = new Set(["search", "read", "view", "summarize", "record_note", "record_minute", "verify"]);
const HIGH_RISK_RUNTIME_ACTION_TYPES = new Set(["update", "edit", "send", "grant", "fork", "repair", "migrate"]);
const CRITICAL_RISK_RUNTIME_ACTION_TYPES = new Set([
  "delete",
  "revoke",
  "transfer",
  "rotate_key",
  "change_signer",
  "policy_change",
  "asset_transfer",
  "wipe",
]);
const HIGH_RISK_RUNTIME_CAPABILITIES = new Set(["filesystem_write", "network_external", "document_publish", "policy_update"]);
const CRITICAL_RUNTIME_CAPABILITIES = new Set([
  "process_exec",
  "identity_change",
  "asset_transfer",
  "key_management",
  "filesystem_delete",
]);

function normalizeSandboxHost(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }
  return normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
}

const SANDBOX_PROTECTED_CONTROL_PLANE_HEADERS = new Set([
  "authorization",
  ...COMPATIBLE_ADMIN_TOKEN_HEADERS,
]);

export function shouldEnforceSandboxCapabilityAllowlist(sandboxPolicy = {}) {
  return Array.isArray(sandboxPolicy.allowedCapabilities);
}

export function isSandboxCapabilityAllowlisted(capability, sandboxPolicy = {}) {
  const normalizedCapability = normalizeRuntimeCapability(capability);
  if (!normalizedCapability || !shouldEnforceSandboxCapabilityAllowlist(sandboxPolicy)) {
    return false;
  }
  return sandboxPolicy.allowedCapabilities.includes(normalizedCapability);
}

export function isLoopbackSandboxHost(value) {
  const normalizedHost = normalizeSandboxHost(value);
  if (!normalizedHost) {
    return false;
  }
  return (
    normalizedHost === "localhost" ||
    normalizedHost === "::1" ||
    normalizedHost === "0:0:0:0:0:0:0:1" ||
    normalizedHost === "::ffff:127.0.0.1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalizedHost)
  );
}

export function sandboxRequestHasProtectedControlPlaneHeaders(headers = null) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return false;
  }
  return Object.entries(headers).some(([key, value]) => {
    const normalizedKey = normalizeOptionalText(key)?.toLowerCase() ?? null;
    return SANDBOX_PROTECTED_CONTROL_PLANE_HEADERS.has(normalizedKey) && normalizeOptionalText(value) != null;
  });
}

export function sandboxHostMatchesAllowlist(requestedHost, allowlist = []) {
  const normalizedRequested = normalizeSandboxHost(requestedHost);
  if (!normalizedRequested) {
    return false;
  }

  return allowlist.some((entry) => {
    const normalizedEntry = normalizeSandboxHost(entry);
    if (!normalizedEntry) {
      return false;
    }
    return normalizedRequested === normalizedEntry;
  });
}

function sandboxCommandMatchesAllowlist(requestedCommand, allowlist = []) {
  const normalizedRequested = normalizeOptionalText(requestedCommand);
  if (!normalizedRequested) {
    return false;
  }

  const requestedHasPath = normalizedRequested.includes("/") || normalizedRequested.includes(path.sep);
  const requestedResolved = requestedHasPath ? path.resolve(normalizedRequested) : normalizedRequested;

  return allowlist.some((entry) => {
    const parsedEntry = parseSandboxAllowlistedCommandEntry(entry);
    if (!parsedEntry) {
      return false;
    }
    if (parsedEntry.hasPath) {
      return requestedHasPath && path.resolve(parsedEntry.command) === requestedResolved;
    }
    return !requestedHasPath && parsedEntry.command === normalizedRequested;
  });
}

function inspectSandboxAllowlistedProcessCommand(requestedCommand, sandboxPolicy = {}) {
  const normalizedRequested = normalizeOptionalText(requestedCommand);
  if (!normalizedRequested) {
    return {
      allowlisted: false,
      digestPinned: false,
      digestVerified: false,
      digestMismatch: false,
      commandPath: null,
    };
  }

  const requestedHasPath = normalizedRequested.includes("/") || normalizedRequested.includes(path.sep);
  const requestedCanonicalPath = requestedHasPath
    ? (() => {
        try {
          return realpathSync(path.resolve(normalizedRequested));
        } catch {
          return null;
        }
      })()
    : null;

  for (const entry of Array.isArray(sandboxPolicy.allowedCommands) ? sandboxPolicy.allowedCommands : []) {
    const parsedEntry = parseSandboxAllowlistedCommandEntry(entry);
    if (!parsedEntry) {
      continue;
    }

    if (parsedEntry.hasPath) {
      if (!requestedHasPath || !requestedCanonicalPath) {
        continue;
      }
      let allowlistedCanonicalPath = null;
      try {
        allowlistedCanonicalPath = realpathSync(path.resolve(parsedEntry.command));
      } catch {
        continue;
      }
      if (allowlistedCanonicalPath !== requestedCanonicalPath) {
        continue;
      }
      if (!parsedEntry.digest) {
        return {
          allowlisted: true,
          digestPinned: false,
          digestVerified: false,
          digestMismatch: false,
          commandPath: requestedCanonicalPath,
        };
      }
      let actualDigest = null;
      try {
        actualDigest = createHash("sha256").update(readFileSync(requestedCanonicalPath)).digest("hex");
      } catch {
        actualDigest = null;
      }
      return {
        allowlisted: true,
        digestPinned: true,
        digestVerified: actualDigest === parsedEntry.digest,
        digestMismatch: actualDigest !== parsedEntry.digest,
        commandPath: requestedCanonicalPath,
      };
    }

    if (!requestedHasPath && parsedEntry.command === normalizedRequested) {
      return {
        allowlisted: true,
        digestPinned: Boolean(parsedEntry.digest),
        digestVerified: false,
        digestMismatch: false,
        commandPath: null,
      };
    }
  }

  return {
    allowlisted: false,
    digestPinned: false,
    digestVerified: false,
    digestMismatch: false,
    commandPath: requestedCanonicalPath,
  };
}

export function normalizeSandboxProcessArgs(
  args = [],
  { maxArgs = DEFAULT_SANDBOX_MAX_PROCESS_ARGS, maxArgBytes = DEFAULT_SANDBOX_MAX_PROCESS_ARG_BYTES } = {}
) {
  const safeArgs = Array.isArray(args) ? args.map((item) => String(item)) : [];
  if (safeArgs.length > maxArgs) {
    throw new Error(`Sandbox process args exceed limit: ${safeArgs.length}/${maxArgs}`);
  }
  const totalBytes = safeArgs.reduce((sum, item) => sum + Buffer.byteLength(item, "utf8"), 0);
  if (totalBytes > maxArgBytes) {
    throw new Error(`Sandbox process args exceed byte budget: ${totalBytes}/${maxArgBytes}`);
  }
  return safeArgs;
}

export function parseSandboxUrl(value, { maxUrlLength = DEFAULT_SANDBOX_MAX_URL_LENGTH } = {}) {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    return null;
  }

  if (Buffer.byteLength(normalizedValue, "utf8") > maxUrlLength) {
    throw new Error(`Sandbox URL exceeds max length: ${maxUrlLength}`);
  }

  const parsed = new URL(normalizedValue);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported sandbox URL protocol: ${parsed.protocol}`);
  }
  return parsed;
}

function isPathWithinRoot(resolvedPath, rootPath) {
  const relative = path.relative(rootPath, resolvedPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function classifyRuntimeActionRisk(commandText, runtime = {}, action = {}) {
  const normalizedCommand = normalizeComparableText(commandText);
  const commandPolicy = runtime.commandPolicy || {};
  const actionType = normalizeRuntimeActionType(action.actionType || action.requestedActionType);
  const capability = normalizeRuntimeCapability(action.capability || action.requestedCapability);
  const sandboxPolicy = normalizeRuntimeSandboxPolicy(runtime.sandboxPolicy);
  const requestedCommand = normalizeOptionalText(action.command || action.targetResource || commandText) ?? null;
  const resource = normalizeComparableText(action.targetResource || action.resource || action.resourceType);
  const destructive = normalizeBooleanFlag(action.destructive, false);
  const external = normalizeBooleanFlag(action.external, false);
  const criticalKeywords = normalizeTextList(commandPolicy.criticalRiskActionKeywords);
  const highKeywords = normalizeTextList(commandPolicy.highRiskActionKeywords);
  const lowKeywords = normalizeTextList(commandPolicy.lowRiskActionKeywords);
  const matchedCritical = normalizedCommand
    ? criticalKeywords.filter((keyword) => normalizedCommand.includes(normalizeComparableText(keyword)))
    : [];
  const matchedHigh = normalizedCommand
    ? highKeywords.filter((keyword) => normalizedCommand.includes(normalizeComparableText(keyword)))
    : [];
  const matchedLow = normalizedCommand
    ? lowKeywords.filter((keyword) => normalizedCommand.includes(normalizeComparableText(keyword)))
    : [];
  const processExecAllowlistInspection =
    capability === "process_exec" && Boolean(requestedCommand)
      ? inspectSandboxAllowlistedProcessCommand(requestedCommand, sandboxPolicy)
      : null;
  const allowlistedDigestPinnedProcessExec = Boolean(processExecAllowlistInspection?.digestVerified);

  if (
    destructive ||
    CRITICAL_RISK_RUNTIME_ACTION_TYPES.has(actionType) ||
    (CRITICAL_RUNTIME_CAPABILITIES.has(capability) && !allowlistedDigestPinnedProcessExec) ||
    resource.includes("signer") ||
    resource.includes("wallet") ||
    resource.includes("credential") ||
    resource.includes("key")
  ) {
    return {
      riskTier: "critical",
      riskKeywords: matchedCritical,
      matchedKeywordGroups: {
        critical: matchedCritical,
        high: matchedHigh,
        low: matchedLow,
      },
      actionType,
      capability,
      resource,
    };
  }

  if (matchedCritical.length > 0) {
    return {
      riskTier: "critical",
      riskKeywords: matchedCritical,
      matchedKeywordGroups: {
        critical: matchedCritical,
        high: matchedHigh,
        low: matchedLow,
      },
      actionType,
      capability,
      resource,
    };
  }

  if (allowlistedDigestPinnedProcessExec) {
    return {
      riskTier: "high",
      riskKeywords: matchedHigh,
      matchedKeywordGroups: {
        critical: [],
        high: matchedHigh,
        low: matchedLow,
      },
      actionType,
      capability,
      resource,
    };
  }

  if (
    external ||
    HIGH_RISK_RUNTIME_ACTION_TYPES.has(actionType) ||
    HIGH_RISK_RUNTIME_CAPABILITIES.has(capability) ||
    resource.includes("policy") ||
    resource.includes("document") ||
    resource.includes("message")
  ) {
    return {
      riskTier: "high",
      riskKeywords: matchedHigh,
      matchedKeywordGroups: {
        critical: matchedCritical,
        high: matchedHigh,
        low: matchedLow,
      },
      actionType,
      capability,
      resource,
    };
  }

  if (matchedHigh.length > 0) {
    return {
      riskTier: "high",
      riskKeywords: matchedHigh,
      matchedKeywordGroups: {
        critical: [],
        high: matchedHigh,
        low: matchedLow,
      },
      actionType,
      capability,
      resource,
    };
  }

  if (LOW_RISK_RUNTIME_ACTION_TYPES.has(actionType) || matchedLow.length > 0) {
    return {
      riskTier: "low",
      riskKeywords: matchedLow,
      matchedKeywordGroups: {
        critical: [],
        high: [],
        low: matchedLow,
      },
      actionType,
      capability,
      resource,
    };
  }

  return {
    riskTier: normalizedCommand ? "medium" : "low",
    riskKeywords: [],
    matchedKeywordGroups: {
      critical: [],
      high: [],
      low: [],
    },
    actionType,
    capability,
    resource,
  };
}

function resolveSandboxFilesystemPath(targetPath, sandboxPolicy = {}) {
  const normalizedTarget = normalizeOptionalText(targetPath);
  if (!normalizedTarget) {
    throw new Error("sandbox target path is required");
  }

  const resolvedPath = path.resolve(normalizedTarget);
  const allowlist = normalizeTextList(sandboxPolicy.filesystemAllowlist).map((entry) => path.resolve(entry));
  const matchedRoot = allowlist.find((entry) => isPathWithinRoot(resolvedPath, entry));
  if (!matchedRoot) {
    throw new Error(`Path is outside sandbox allowlist: ${resolvedPath}`);
  }

  return {
    resolvedPath,
    matchedRoot,
  };
}

export function buildCommandNegotiationResult(
  store,
  agent,
  payload = {},
  {
    deviceRuntime = null,
    residentGate = null,
    currentGoal = null,
    userTurn = null,
  } = {}
) {
  const runtime = normalizeDeviceRuntime(deviceRuntime || store.deviceRuntime);
  const securityPosture = buildDeviceSecurityPostureState(runtime);
  const rawSandboxAction =
    payload.sandboxAction && typeof payload.sandboxAction === "object"
      ? payload.sandboxAction
      : {};
  const interactionMode = normalizeOptionalText(payload.interactionMode)?.toLowerCase() ?? "conversation";
  const executionMode = normalizeOptionalText(payload.executionMode)?.toLowerCase() ?? "discuss";
  const requestedAction = normalizeOptionalText(payload.requestedAction || payload.commandText) ?? null;
  const requestedActionType = normalizeRuntimeActionType(
    payload.requestedActionType || payload.actionType || rawSandboxAction.actionType
  );
  const requestedCapability = normalizeRuntimeCapability(payload.requestedCapability || payload.capability);
  const nestedRequestedCapability = normalizeRuntimeCapability(rawSandboxAction.capability);
  const effectiveRequestedCapability =
    nestedRequestedCapability ?? requestedCapability;
  const commandText = requestedAction ?? (interactionMode === "command" ? normalizeOptionalText(userTurn) ?? null : null);
  const confirmExecution = normalizeBooleanFlag(payload.confirmExecution, false);
  const requestedProvider =
    normalizeRuntimeReasonerProvider(payload.reasonerProvider) ??
    normalizeRuntimeReasonerProvider(payload.reasoner?.provider) ??
    null;
  const providerWantsOnline = requestedProvider === "http" || requestedProvider === "openai_compatible";
  const onlineRequested =
    providerWantsOnline ||
    normalizeBooleanFlag(payload.preferOnlineReasoner, false) ||
    normalizeBooleanFlag(payload.allowOnlineReasoner, false);
  const requestedFilesystemTarget =
    normalizeOptionalText(
      payload.targetResource ||
        payload.resource ||
        payload.path ||
        rawSandboxAction.path ||
        rawSandboxAction.targetResource ||
        rawSandboxAction.file ||
        rawSandboxAction.directory ||
        payload.resourceType
    ) ?? null;
  const riskAssessment = classifyRuntimeActionRisk(commandText, runtime, {
    actionType: requestedActionType,
    capability: effectiveRequestedCapability,
    command: rawSandboxAction.command || payload.command,
    targetResource: requestedFilesystemTarget,
    destructive: payload.destructive,
    external: payload.external,
  });
  const riskTier = riskAssessment.riskTier;
  const riskKeywords = riskAssessment.riskKeywords;
  const sandboxPolicy = runtime.sandboxPolicy || {};
  const requestedUrl =
    normalizeOptionalText(
      payload.url ||
        payload.targetUrl ||
        rawSandboxAction.url ||
        rawSandboxAction.targetUrl ||
        rawSandboxAction.targetResource
    ) ??
    normalizeOptionalText(payload.targetResource) ??
    null;
  let requestedHost =
    normalizeOptionalText(
      payload.targetHost ||
        payload.host ||
        payload.networkHost ||
        rawSandboxAction.targetHost ||
        rawSandboxAction.host ||
        rawSandboxAction.networkHost
    ) ?? null;
  if (!requestedHost && requestedUrl) {
    try {
      requestedHost = new URL(requestedUrl).hostname || null;
    } catch {
      requestedHost = requestedHost || null;
    }
  }
  const requestedCommand = normalizeOptionalText(
    payload.command || rawSandboxAction.command || payload.requestedAction
  ) ?? null;
  const requestedArgs =
    payload.args ??
    rawSandboxAction.args ??
    [];
  const requestedHeaders =
    rawSandboxAction.headers && typeof rawSandboxAction.headers === "object" && !Array.isArray(rawSandboxAction.headers)
      ? rawSandboxAction.headers
      : payload.headers && typeof payload.headers === "object" && !Array.isArray(payload.headers)
        ? payload.headers
        : null;
  const allowedCommands = Array.isArray(sandboxPolicy.allowedCommands) ? sandboxPolicy.allowedCommands : [];
  const networkAllowlist = Array.isArray(sandboxPolicy.networkAllowlist) ? sandboxPolicy.networkAllowlist : [];
  const processExecAllowlistInspection =
    effectiveRequestedCapability === "process_exec" && requestedCommand
      ? inspectSandboxAllowlistedProcessCommand(requestedCommand, sandboxPolicy)
      : null;
  const networkRequested =
    effectiveRequestedCapability === "network_external" ||
    effectiveRequestedCapability === "document_publish" ||
    normalizeBooleanFlag(payload.external, false);
  const sandboxBlockedReasons = [];
  if (
    requestedCapability &&
    nestedRequestedCapability &&
    requestedCapability !== nestedRequestedCapability
  ) {
    sandboxBlockedReasons.push(`capability_mismatch:${requestedCapability}->${nestedRequestedCapability}`);
  }
  if (
    effectiveRequestedCapability &&
    shouldEnforceSandboxCapabilityAllowlist(sandboxPolicy) &&
    !isSandboxCapabilityAllowlisted(effectiveRequestedCapability, sandboxPolicy)
  ) {
    sandboxBlockedReasons.push(`capability_not_allowlisted:${effectiveRequestedCapability}`);
  }
  if (
    effectiveRequestedCapability &&
    Array.isArray(sandboxPolicy.blockedCapabilities) &&
    sandboxPolicy.blockedCapabilities.includes(effectiveRequestedCapability)
  ) {
    sandboxBlockedReasons.push(`capability:${effectiveRequestedCapability}`);
  }
  if (
    (effectiveRequestedCapability === "filesystem_read" || effectiveRequestedCapability === "filesystem_list") &&
    !requestedFilesystemTarget
  ) {
    sandboxBlockedReasons.push("filesystem_target_missing");
  }
  if (effectiveRequestedCapability === "process_exec" && !requestedCommand) {
    sandboxBlockedReasons.push("command_missing");
  }
  if (effectiveRequestedCapability === "process_exec" && sandboxPolicy.allowShellExecution === false) {
    sandboxBlockedReasons.push("shell_execution_disabled");
  }
  if (
    effectiveRequestedCapability === "process_exec" &&
    allowedCommands.length === 0
  ) {
    sandboxBlockedReasons.push(
      sandboxPolicy.commandAllowlistConfigured ? "command_allowlist_empty" : "command_allowlist_missing"
    );
  }
  if (
    effectiveRequestedCapability === "process_exec" &&
    requestedCommand &&
    allowedCommands.length > 0 &&
    !(processExecAllowlistInspection?.allowlisted ?? sandboxCommandMatchesAllowlist(requestedCommand, allowedCommands))
  ) {
    sandboxBlockedReasons.push(`command_not_allowlisted:${requestedCommand}`);
  }
  if (
    effectiveRequestedCapability === "process_exec" &&
    requestedCommand &&
    processExecAllowlistInspection?.digestPinned &&
    processExecAllowlistInspection.digestMismatch
  ) {
    sandboxBlockedReasons.push(`command_digest_mismatch:${requestedCommand}`);
  }
  if (
    effectiveRequestedCapability === "process_exec" &&
    requestedCommand &&
    sandboxPolicy.requireAbsoluteProcessCommand !== false &&
    !path.isAbsolute(requestedCommand)
  ) {
    sandboxBlockedReasons.push(`command_not_absolute:${requestedCommand}`);
  }
  if (effectiveRequestedCapability === "process_exec") {
    try {
      normalizeSandboxProcessArgs(requestedArgs, {
        maxArgs: sandboxPolicy.maxProcessArgs,
        maxArgBytes: sandboxPolicy.maxProcessArgBytes,
      });
    } catch (error) {
      sandboxBlockedReasons.push(normalizeOptionalText(error.message) ?? "process_arg_budget_exceeded");
    }
  }
  if (
    networkRequested &&
    !requestedUrl
  ) {
    sandboxBlockedReasons.push("network_target_missing");
  }
  if (
    networkRequested &&
    sandboxPolicy.allowExternalNetwork === false
  ) {
    sandboxBlockedReasons.push("external_network_disabled");
  }
  if (
    securityPosture.executionLocked &&
    (effectiveRequestedCapability ||
      executionMode === "execute" ||
      normalizeRuntimeActionType(payload.requestedActionType) != null)
  ) {
    sandboxBlockedReasons.push(`security_posture_execution_locked:${securityPosture.mode}`);
  }
  if (
    securityPosture.networkEgressLocked &&
    (
      effectiveRequestedCapability === "network_external" ||
      providerWantsOnline ||
      normalizeBooleanFlag(payload.external, false)
    )
  ) {
    sandboxBlockedReasons.push(`security_posture_network_locked:${securityPosture.mode}`);
  }
  if (effectiveRequestedCapability === "network_external" && requestedUrl) {
    try {
      parseSandboxUrl(requestedUrl, { maxUrlLength: sandboxPolicy.maxUrlLength });
    } catch (error) {
      sandboxBlockedReasons.push(normalizeOptionalText(error.message) ?? "invalid_network_target");
    }
  }
  if (
    networkRequested &&
    requestedHost &&
    !sandboxHostMatchesAllowlist(requestedHost, networkAllowlist)
  ) {
    sandboxBlockedReasons.push(`host_not_allowlisted:${requestedHost}`);
  }
  if (
    networkRequested &&
    requestedHost &&
    isLoopbackSandboxHost(requestedHost) &&
    sandboxRequestHasProtectedControlPlaneHeaders(requestedHeaders)
  ) {
    sandboxBlockedReasons.push("loopback_control_plane_headers_blocked");
  }
  if (
    (effectiveRequestedCapability === "filesystem_read" || effectiveRequestedCapability === "filesystem_list") &&
    requestedFilesystemTarget
  ) {
    try {
      resolveSandboxFilesystemPath(requestedFilesystemTarget, sandboxPolicy);
    } catch (error) {
      sandboxBlockedReasons.push(`filesystem_not_allowlisted:${requestedFilesystemTarget}`);
    }
  }
  const authorizationStrategy =
    runtime.commandPolicy?.riskStrategies?.[riskTier] ??
    buildDefaultRuntimeRiskStrategies(runtime.commandPolicy?.autoExecuteLowRisk).medium;
  const actionable = interactionMode === "command" && Boolean(commandText);
  const requiresExplicitConfirmation =
    runtime.commandPolicy?.requireExplicitConfirmation !== false;

  let decision = "continue";
  if (residentGate?.required) {
    decision = "blocked";
  } else if (sandboxBlockedReasons.length > 0) {
    decision = "blocked";
  } else if (!actionable) {
    decision = "continue";
  } else if (runtime.localMode === "local_only" && onlineRequested && !runtime.allowOnlineReasoner) {
    decision = "discuss";
  } else if (executionMode !== "execute") {
    decision = "discuss";
  } else if (authorizationStrategy === "multisig") {
    decision = "multisig";
  } else if (authorizationStrategy === "confirm") {
    decision = confirmExecution ? "execute" : "confirm";
  } else if (authorizationStrategy === "discuss") {
    decision =
      executionMode === "execute" && confirmExecution
        ? "execute"
        : runtime.commandPolicy?.negotiationMode === "confirm_before_execute" && requiresExplicitConfirmation && !confirmExecution
          ? "confirm"
          : "discuss";
  } else if (authorizationStrategy === "auto_execute" && requiresExplicitConfirmation && !confirmExecution && riskTier !== "low") {
    decision = "confirm";
  } else if (executionMode === "execute" && (requiresExplicitConfirmation && !confirmExecution) && authorizationStrategy !== "auto_execute") {
    decision = "confirm";
  } else if (executionMode === "execute" && riskTier === "high") {
    decision = "confirm";
  } else if (executionMode === "execute" && riskTier === "critical") {
    decision = "multisig";
  } else if (executionMode === "execute") {
    decision = "execute";
  } else {
    decision = "discuss";
  }

  const shouldExecute = decision === "execute";
  const requiresMultisig = decision === "multisig";
  const shouldUseOnlineReasoner =
    runtime.localMode === "online_enhanced" &&
    (runtime.allowOnlineReasoner || normalizeBooleanFlag(payload.allowOnlineReasoner, false)) &&
    onlineRequested;

  return {
    negotiationId: createRecordId("nego"),
    agentId: agent.agentId,
    machineId: runtime.machineId,
    localMode: runtime.localMode,
    interactionMode,
    executionMode,
    requestedAction: commandText,
    requestedActionType,
    requestedCapability: effectiveRequestedCapability,
    currentGoal: normalizeOptionalText(currentGoal) ?? null,
    actionable,
    decision,
    shouldExecute,
    requiresMultisig,
    confirmExecution,
    requiresExplicitConfirmation,
    riskLevel: riskTier,
    riskTier,
    riskKeywords,
    matchedKeywordGroups: riskAssessment.matchedKeywordGroups,
    targetResource:
      normalizeOptionalText(
        payload.targetResource ||
          payload.resource ||
          rawSandboxAction.targetResource ||
          rawSandboxAction.path ||
          rawSandboxAction.file ||
          rawSandboxAction.directory ||
          payload.resourceType
      ) ?? null,
    targetHost: requestedHost,
    authorizationStrategy,
    securityPosture,
    sandboxBlockedReasons,
    shouldUseOnlineReasoner,
    recommendedNextStep:
      decision === "multisig"
        ? "create_multisig_proposal"
        : decision === "confirm"
          ? "request_explicit_confirmation"
          : decision === "discuss"
            ? "continue_negotiation"
            : decision === "execute"
              ? "execute_locally"
              : "continue",
    notes: [
      actionable ? "先复述理解，再说明风险和是否执行。" : "当前轮次以对话反馈为主。",
      runtime.localMode === "local_only" ? "当前设备处于本地离线模式，默认不调用在线 provider。" : "当前设备允许联网增强。",
      actionable ? `当前动作风险等级：${riskTier}。` : null,
      actionable ? `当前授权策略：${authorizationStrategy}。` : null,
      decision === "confirm" ? "该命令需要先与人类确认后再执行。" : null,
      decision === "discuss" ? "这条命令先进入协商，不直接执行。" : null,
      decision === "multisig" ? "这条命令已进入 critical 受控路径，需要多签或双控制。" : null,
      securityPosture.mode !== "normal" ? `当前设备安全姿态：${securityPosture.mode}。` : null,
      sandboxBlockedReasons.length > 0 ? `当前命令被受限执行层阻断：${sandboxBlockedReasons.join(", ")}。` : null,
      decision === "blocked" ? residentGate?.message ?? "resident agent 绑定策略阻止了当前执行。" : null,
    ].filter(Boolean),
    createdAt: now(),
  };
}

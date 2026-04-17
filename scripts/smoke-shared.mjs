export function createTracer(prefix, enabled = false) {
  return function trace(message) {
    if (enabled) {
      console.error(`[${prefix}] ${message}`);
    }
  };
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertBrokerSystemSandboxTruth(systemSandbox, label, { requested = true } = {}) {
  assert(systemSandbox && typeof systemSandbox === "object", `${label} 应返回 systemSandbox`);
  assert(typeof systemSandbox.requested === "boolean", `${label}.systemSandbox.requested 应为布尔值`);
  assert(typeof systemSandbox.available === "boolean", `${label}.systemSandbox.available 应为布尔值`);
  assert(typeof systemSandbox.enabled === "boolean", `${label}.systemSandbox.enabled 应为布尔值`);
  assert(
    typeof systemSandbox.backend === "string" && systemSandbox.backend.length > 0,
    `${label}.systemSandbox.backend 缺失`
  );
  assert(
    typeof systemSandbox.status === "string" && systemSandbox.status.length > 0,
    `${label}.systemSandbox.status 缺失`
  );
  assert(
    typeof systemSandbox.platform === "string" && systemSandbox.platform.length > 0,
    `${label}.systemSandbox.platform 缺失`
  );

  if (requested === false) {
    assert(systemSandbox.requested === false, `${label} 应报告 requested=false`);
    assert(systemSandbox.enabled === false, `${label} 在 policy disabled 时不应启用系统级 sandbox`);
    assert(systemSandbox.backend === "broker_only", `${label} 在 policy disabled 时应回退到 broker_only backend`);
    assert(systemSandbox.status === "disabled", `${label} 在 policy disabled 时应报告 disabled`);
    assert(systemSandbox.fallbackReason === "disabled_by_policy", `${label} 在 policy disabled 时应报告 disabled_by_policy`);
    return "disabled";
  }

  assert(systemSandbox.requested === true, `${label} 应报告 requested=true`);
  if (systemSandbox.available === true) {
    assert(systemSandbox.enabled === true, `${label} 在系统级 sandbox 可用时应启用`);
    assert(systemSandbox.backend === "sandbox_exec", `${label} 在系统级 sandbox 可用时应使用 sandbox_exec backend`);
    assert(systemSandbox.status === "enforced", `${label} 在系统级 sandbox 可用时应报告 enforced`);
    assert(systemSandbox.fallbackReason == null, `${label} 在系统级 sandbox 可用时 fallbackReason 应为空`);
    return "enforced";
  }

  assert(systemSandbox.enabled === false, `${label} 在系统级 sandbox 不可用时不应伪报 enabled`);
  assert(systemSandbox.backend === "broker_only", `${label} 在系统级 sandbox 不可用时应回退到 broker_only backend`);
  assert(systemSandbox.status === "unavailable", `${label} 在系统级 sandbox 不可用时应报告 unavailable`);
  assert(
    typeof systemSandbox.fallbackReason === "string" && systemSandbox.fallbackReason.length > 0,
    `${label} 在系统级 sandbox 不可用时应报告 fallbackReason`
  );
  return "unavailable";
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(fetchImpl, url, init, label, trace) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      lastError = error;
      if (attempt >= 3) {
        break;
      }
      const causeMessage =
        error?.cause && typeof error.cause === "object"
          ? `${error.cause.code || "unknown_cause"}:${error.cause.message || "unknown"}`
          : "no_cause";
      trace?.(`${label} retry ${attempt + 1} after fetch failure: ${error.message} [${causeMessage}]`);
      await sleep(150 * (attempt + 1));
    }
  }
  throw lastError || new Error("fetch failed");
}

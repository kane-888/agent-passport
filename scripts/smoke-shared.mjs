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

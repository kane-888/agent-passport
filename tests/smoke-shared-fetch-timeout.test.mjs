import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { fetchWithRetry } from "../scripts/smoke-shared.mjs";

test("fetchWithRetry aborts hung requests instead of waiting forever", async () => {
  const previousTimeout = process.env.SMOKE_FETCH_TIMEOUT_MS;
  process.env.SMOKE_FETCH_TIMEOUT_MS = "25";

  let attempts = 0;
  const server = http.createServer((_req, _res) => {
    attempts += 1;
    // Intentionally leave the response hanging so the timeout path is exercised.
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address === "object");

    await assert.rejects(
      fetchWithRetry(fetch, `http://127.0.0.1:${address.port}/hung`, {}, "hung request"),
      (error) => {
        assert.match(`${error?.name || ""}:${error?.message || ""}`, /Abort|Timeout/u);
        return true;
      }
    );
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (previousTimeout == null) {
      delete process.env.SMOKE_FETCH_TIMEOUT_MS;
    } else {
      process.env.SMOKE_FETCH_TIMEOUT_MS = previousTimeout;
    }
  }

  assert.ok(attempts >= 1, "hung endpoint should be contacted before timeout aborts the smoke request");
});

test("fetchWithRetry honors per-request timeout override", async () => {
  const previousTimeout = process.env.SMOKE_FETCH_TIMEOUT_MS;
  process.env.SMOKE_FETCH_TIMEOUT_MS = "1000";

  let attempts = 0;
  const server = http.createServer((_req, _res) => {
    attempts += 1;
    // Intentionally leave the response hanging so the request-scoped timeout is exercised.
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address === "object");

    await assert.rejects(
      fetchWithRetry(fetch, `http://127.0.0.1:${address.port}/hung-override`, { timeoutMs: 25 }, "hung request override"),
      (error) => {
        assert.match(`${error?.name || ""}:${error?.message || ""}`, /Abort|Timeout/u);
        return true;
      }
    );
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (previousTimeout == null) {
      delete process.env.SMOKE_FETCH_TIMEOUT_MS;
    } else {
      process.env.SMOKE_FETCH_TIMEOUT_MS = previousTimeout;
    }
  }

  assert.ok(attempts >= 1, "request-scoped timeout should still contact the hung endpoint before aborting");
});

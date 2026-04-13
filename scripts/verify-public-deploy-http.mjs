import assert from "node:assert/strict";

const DEFAULT_BASE_URL = "http://127.0.0.1:4319";
const DEFAULT_TIMEOUT_MS = 8000;

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function text(value) {
  return String(value ?? "").trim();
}

async function fetchTextResponse(pathname, { baseUrl, headers = {} } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`timeout:${pathname}`)), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers,
      signal: controller.signal,
    });
    const bodyText = await response.text();
    return {
      status: response.status,
      bodyText,
      contentType: response.headers.get("content-type") || "",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJsonResponse(pathname, { baseUrl, headers = {} } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`timeout:${pathname}`)), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers,
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let data = null;
    if (bodyText) {
      data = JSON.parse(bodyText);
    }
    return {
      status: response.status,
      data,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main() {
  const baseUrl = trimTrailingSlash(process.env.AGENT_PASSPORT_BASE_URL || DEFAULT_BASE_URL);
  const adminToken = text(process.env.AGENT_PASSPORT_ADMIN_TOKEN);

  const home = await fetchTextResponse("/", { baseUrl });
  assert.equal(home.status, 200, "GET / should return 200");
  assert(home.contentType.includes("text/html"), "GET / should return text/html");
  assert(home.bodyText.includes("公开运行态"), "GET / should include runtime-home public entry");
  assert(home.bodyText.includes("/api/security"), "GET / should include /api/security public link");

  const health = await fetchJsonResponse("/api/health", { baseUrl });
  assert.equal(health.status, 200, "GET /api/health should return 200");
  assert.equal(health.data?.ok, true, "GET /api/health should return ok:true");
  assert.equal(typeof health.data?.service, "string", "GET /api/health should include service");

  const capabilities = await fetchJsonResponse("/api/capabilities", { baseUrl });
  assert.equal(capabilities.status, 200, "GET /api/capabilities should return 200");
  assert.equal(typeof capabilities.data?.product?.name, "string", "GET /api/capabilities should include product.name");

  const security = await fetchJsonResponse("/api/security", { baseUrl });
  assert.equal(security.status, 200, "GET /api/security should return 200");
  assert.equal(Boolean(security.data?.localStore), true, "GET /api/security should include localStore summary");

  const agentsWithoutAuth = await fetchJsonResponse("/api/agents", { baseUrl });
  assert.equal(agentsWithoutAuth.status, 401, "GET /api/agents without token should return 401");

  if (!adminToken) {
    console.log("[verify] public-deploy-http: ok");
    console.log("  public home/health/capabilities/security ok");
    console.log("  protected agents route correctly returns 401 without token");
    console.log("  skipped admin-auth check because AGENT_PASSPORT_ADMIN_TOKEN is missing");
    return;
  }

  const agentsWithAuth = await fetchJsonResponse("/api/agents", {
    baseUrl,
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(agentsWithAuth.status, 200, "GET /api/agents with admin token should return 200");
  assert.equal(Array.isArray(agentsWithAuth.data?.agents), true, "GET /api/agents with admin token should include agents array");

  console.log("[verify] public-deploy-http: ok");
  console.log("  public home/health/capabilities/security ok");
  console.log("  protected agents route enforces 401 without token");
  console.log("  protected agents route returns 200 with admin token");
}

main().catch((error) => {
  console.error("[verify] public-deploy-http: failed");
  console.error(`  ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});

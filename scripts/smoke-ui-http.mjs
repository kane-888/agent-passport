import fs from "node:fs/promises";
import path from "node:path";
import { readGenericPasswordFromKeychain } from "../src/local-secrets.js";
import { fetchWithRetry } from "./smoke-shared.mjs";

const smokeHttpTimingEnabled = process.env.SMOKE_HTTP_TIMING === "1";

export function createSmokeHttpClient({
  baseUrl,
  rootDir,
  trace,
  adminTokenFallbackPath = process.env.AGENT_PASSPORT_ADMIN_TOKEN_PATH || path.join(rootDir, "data", ".admin-token"),
  adminTokenKeychainService = "AgentPassport.AdminToken",
  adminTokenKeychainAccount = process.env.AGENT_PASSPORT_ADMIN_TOKEN_ACCOUNT || null,
}) {
  let cachedAdminToken = null;

  async function fetchWithLocalRetry(url, init, label) {
    const startedAt = Date.now();
    try {
      const response = await fetchWithRetry(fetch, url, init, label, trace);
      if (smokeHttpTimingEnabled) {
        console.error(`[smoke-http] ${label} -> ${response.status} +${Date.now() - startedAt}ms`);
      }
      return response;
    } catch (error) {
      if (smokeHttpTimingEnabled) {
        console.error(
          `[smoke-http] ${label} -> error(${error instanceof Error ? error.message : String(error)}) +${Date.now() - startedAt}ms`
        );
      }
      throw error;
    }
  }

  async function publicGetJson(resourcePath) {
    let response;
    try {
      trace?.(`GET ${resourcePath}`);
      response = await fetchWithLocalRetry(
        `${baseUrl}${resourcePath}`,
        {
          headers: {
            Connection: "close",
          },
        },
        `GET ${resourcePath}`
      );
      trace?.(`GET ${resourcePath} -> ${response.status}`);
    } catch (error) {
      throw new Error(`${resourcePath} -> fetch failed: ${error.message}`);
    }
    if (!response.ok) {
      throw new Error(`${resourcePath} -> HTTP ${response.status}`);
    }
    return response.json();
  }

  async function getAdminToken() {
    if (cachedAdminToken !== null) {
      return cachedAdminToken;
    }

    const explicit = process.env.AGENT_PASSPORT_ADMIN_TOKEN || process.env.AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN || null;
    if (explicit) {
      cachedAdminToken = explicit;
      return cachedAdminToken;
    }

    const security = await publicGetJson("/api/security");
    if (security.apiWriteProtection?.tokenSource === "keychain") {
      const keychainToken = readGenericPasswordFromKeychain(
        security.apiWriteProtection?.keychainService || adminTokenKeychainService,
        security.apiWriteProtection?.keychainAccount || adminTokenKeychainAccount || "resident-default"
      );
      if (keychainToken) {
        cachedAdminToken = keychainToken;
        return cachedAdminToken;
      }
    }

    try {
      cachedAdminToken = (await fs.readFile(adminTokenFallbackPath, "utf8")).trim();
      return cachedAdminToken;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    cachedAdminToken = null;
    return null;
  }

  function setAdminToken(token) {
    cachedAdminToken = token ?? null;
    return cachedAdminToken;
  }

  async function fetchWithToken(resourcePath, token, options = {}) {
    const headers = {
      Connection: "close",
      ...(options.headers || {}),
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    try {
      trace?.(`${options.method || "GET"} ${resourcePath}`);
      const response = await fetchWithLocalRetry(
        `${baseUrl}${resourcePath}`,
        {
          ...options,
          headers,
        },
        `${options.method || "GET"} ${resourcePath}`
      );
      trace?.(`${options.method || "GET"} ${resourcePath} -> ${response.status}`);
      return response;
    } catch (error) {
      throw new Error(`${resourcePath} -> fetch failed: ${error.message}`);
    }
  }

  async function authorizedFetch(resourcePath, options = {}) {
    let token = await getAdminToken();
    let response = await fetchWithToken(resourcePath, token, options);
    if (response.status !== 401) {
      return response;
    }
    await drainResponse(response);
    setAdminToken(null);
    token = await getAdminToken();
    response = await fetchWithToken(resourcePath, token, options);
    return response;
  }

  async function getJson(resourcePath) {
    let response;
    try {
      response = await authorizedFetch(resourcePath);
    } catch (error) {
      throw new Error(`${resourcePath} -> fetch failed: ${error.message}`);
    }
    if (!response.ok) {
      throw new Error(`${resourcePath} -> HTTP ${response.status}`);
    }
    return response.json();
  }

  async function getText(resourcePath) {
    let response;
    try {
      trace?.(`TEXT ${resourcePath}`);
      response = await fetchWithLocalRetry(
        `${baseUrl}${resourcePath}`,
        {
          headers: {
            Connection: "close",
          },
        },
        `TEXT ${resourcePath}`
      );
      trace?.(`TEXT ${resourcePath} -> ${response.status}`);
    } catch (error) {
      throw new Error(`${resourcePath} -> fetch failed: ${error.message}`);
    }
    if (!response.ok) {
      throw new Error(`${resourcePath} -> HTTP ${response.status}`);
    }
    return response.text();
  }

  async function drainResponse(response) {
    if (!response) {
      return null;
    }
    try {
      await response.text();
    } catch {
      // Ignore cleanup drain failures in smoke paths.
    }
    return response;
  }

  return {
    authorizedFetch,
    drainResponse,
    fetchWithToken,
    getAdminToken,
    getJson,
    getText,
    publicGetJson,
    setAdminToken,
  };
}

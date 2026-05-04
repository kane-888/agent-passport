import { normalizeOptionalText } from "./ledger-core-utils.js";

export const CANONICAL_ADMIN_TOKEN_HEADER = "x-agent-passport-admin-token";
export const LEGACY_OPENNEED_ADMIN_TOKEN_HEADER = "x-openneed-admin-token";

export const COMPATIBLE_ADMIN_TOKEN_HEADERS = [
  CANONICAL_ADMIN_TOKEN_HEADER,
  LEGACY_OPENNEED_ADMIN_TOKEN_HEADER,
];

export function extractCompatibleAdminTokenHeader(headers = {}) {
  for (const headerName of COMPATIBLE_ADMIN_TOKEN_HEADERS) {
    const token = normalizeOptionalText(headers?.[headerName]);
    if (token) {
      return token;
    }
  }
  return null;
}

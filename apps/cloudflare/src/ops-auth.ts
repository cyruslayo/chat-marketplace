import { createHash, timingSafeEqual } from "node:crypto";

/** The shared-secret header name, confirmed with the user for this wave. */
export const OPS_SECRET_HEADER = "x-shortlet-ops-secret";

/** Set by Cloudflare Access on an authenticated request. */
export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

/**
 * ADR 0075/0086: constant-time comparison of the ops shared secret. A missing, empty or wrong value is refused.
 * Both sides are hashed first so the comparison length never depends on the input length.
 */
export function sharedSecretMatches(provided: string | null | undefined, expected: string): boolean {
  if (typeof provided !== "string" || provided === "" || expected === "") return false;
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

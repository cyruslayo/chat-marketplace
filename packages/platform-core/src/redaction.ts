// ADR 0075: one redactor for interaction projections, audit and telemetry.
const sensitiveKeys = new Set([
  "bvn", "nin", "passportnumber", "nationalid", "iddocument", "cardnumber", "cvv", "pin",
  "bankaccountsecret", "accountnumber", "doorcode", "keyboxcode", "pincode", "accesscode",
  "bearertoken", "secretkey", "apikey", "password", "authorization", "rawchainofthought",
  "rawreasoning", "internalcot", "modelreasoning", "cookie", "setcookie", "cookies",
  "phone", "phonenumber", "mobile", "mobilenumber", "token", "accesstoken", "refreshtoken",
  "confirmationtoken", "sessionsecret", "csrftoken", "otp", "onetimepassword",
  "verificationcode", "signincode", "paymentreference", "pspreference",
]);

/**
 * Platform-generated correlation ids that are exempt from the string-pattern rules below (not from the key-based
 * `sensitiveKeys` rule, which always wins). The card-number rule reads any 16-digit run, dashes included, so a
 * `req-`/`cmd-`/`offer-` UUID with a digit run was masked and audit rows lost their correlation ids.
 *
 * Each key lists the prefixes its generators emit, taken from the `<prefix>-${randomUUID()}` call sites (and the
 * `quote-${idFactory()}` site, whose default is randomUUID). An exempt value must be `<prefix>-<random v4 UUID>` with a
 * prefix listed for that key. Anything else under these keys, and every value under any other key, is redacted as before.
 * The table is tested against the generator sources in test/redact-platform-ids.test.ts.
 */
const idPrefixesByKey: Readonly<Record<string, readonly string[]>> = {
  requestId: ["req"],
  commandId: ["cmd"],
  commandEnvelopeId: ["cmd"],
  offerId: ["offer"],
  draftId: ["draft"],
  threadId: ["thread"],
  runId: ["run", "turn"],
  surfaceId: ["surf"],
  actionId: ["pa"],
  quoteId: ["quote"],
  queryId: ["search"],
  commitmentId: ["blk", "oph", "brb"],
  payoutId: ["payout"],
  recoveryId: ["recovery"],
  refundId: ["guest-refund"]
};

// Aggregate ids carry whichever aggregate is being audited or projected, so they take the union of the prefixes above.
export const PLATFORM_ID_PREFIXES_BY_KEY: Readonly<Record<string, readonly string[]>> = {
  ...idPrefixesByKey,
  aggregateId: [...new Set(Object.values(idPrefixesByKey).flat())]
};

const PLATFORM_ID_UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const platformIdPatternsByKey = new Map<string, RegExp>(
  Object.entries(PLATFORM_ID_PREFIXES_BY_KEY).map(([key, prefixes]) => [
    normalizeKey(key),
    // Prefixes are fixed lowercase tokens (letters and hyphens), so they need no regex escaping.
    new RegExp(`^(?:${prefixes.join("|")})-${PLATFORM_ID_UUID_V4}$`)
  ])
);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, "");
}

function isPlatformGeneratedId(normalizedKey: string, value: string): boolean {
  const pattern = platformIdPatternsByKey.get(normalizedKey);
  return pattern !== undefined && pattern.test(value);
}

export function redactSensitiveData(data: unknown): unknown {
  if (typeof data === "string") {
    return data
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, "[REDACTED]")
      .replace(/\b(bvn|nin)\s*[:=]\s*\d{11}\b/gi, "$1: [REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/(?:\+234|234|0)[789][01]\d{8}\b/g, "[REDACTED]")
      .replace(/\+\d(?:[\s()-]*\d){7,14}\b/g, "[REDACTED]")
      .replace(/\b(cookie|set-cookie|access[_ -]?code|confirmation[_ -]?token|phone(?:number)?)\s*[:=]\s*[^\r\n;,]+/gi, "$1: [REDACTED]");
  }
  if (Array.isArray(data)) return data.map(redactSensitiveData);
  if (data !== null && typeof data === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      const normalizedKey = normalizeKey(key);
      if (sensitiveKeys.has(normalizedKey)) {
        copy[key] = "[REDACTED]";
      } else if (typeof value === "string" && isPlatformGeneratedId(normalizedKey, value)) {
        // ADR 0075: sensitive keys win above; an exact platform-id shape under its own key is exempt from string patterns.
        copy[key] = value;
      } else {
        copy[key] = redactSensitiveData(value);
      }
    }
    return copy;
  }
  return data;
}

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

// The card-number rule: 16 digits with optional single separators. The Luhn gate below tests exactly these matches.
const CARD_NUMBER_SHAPE = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g;

/**
 * Platform-generated correlation ids that are exempt from the string-pattern rules (not from `sensitiveKeys`, which
 * always wins). The card-number rule reads any 16-digit run, dashes included, so a `req-`/`cmd-`/`offer-` UUID with a
 * digit run was masked and audit rows lost their correlation ids.
 *
 * Each key lists the prefixes its generators emit, taken from the `<prefix>-${randomUUID()}` call sites (and the
 * `quote-${idFactory()}` and `search-${idFactory()}` sites, whose default is randomUUID). An exempt value must be
 * `<prefix>-<random v4 UUID>` with a prefix listed for that key, and must not contain a Luhn-valid card-shaped run
 * (see `containsLuhnValidCardShape`). Anything else is redacted as before. Key coverage is checked against the generator
 * call sites and the audit literals by test/redact-platform-ids-generators.test.ts.
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

/** Keys whose generator call site assigns the value to a differently named local (generator test follows the alias). */
export const ID_KEY_GENERATOR_ALIASES: Readonly<Record<string, string>> = {
  commandEnvelopeId: "commandId"
};

/**
 * Audited keys whose value can carry a randomUUID-prefixed generator but that are deliberately NOT exempt. Each needs
 * a reason. Follow-ups are recorded in issue 50.
 */
export const PLATFORM_ID_CONSCIOUSLY_EXCLUDED: ReadonlyArray<{ readonly key: string; readonly prefix: string; readonly reason: string }> = [
  {
    key: "threadId",
    prefix: "g",
    reason: "Guest thread ids (g-<uuid>) are chosen by the client: THREAD_ID_PATTERN in apps/local-guest/src/guest-server.ts:578 lets the client set them, so exempting them would let a client carry a card number under an exempt key. Follow-up: constrain the source first."
  },
  {
    key: "sessionId",
    prefix: "gs",
    reason: "Guest session ids (gs-<uuid>) are credential-like session identifiers and stay masked (orchestrator decision, issue 50)."
  }
];

const PLATFORM_ID_UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, "");
}

function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Luhn gate for the exemption. True when some card-shaped run (exactly the card rule's matches, separators removed)
 * is a Luhn-valid 16-digit number. Only 16-digit runs are tested because the card rule masks only that shape.
 */
function containsLuhnValidCardShape(value: string): boolean {
  for (const match of value.matchAll(CARD_NUMBER_SHAPE)) {
    if (isLuhnValid(match[0].replace(/\D/g, ""))) return true;
  }
  return false;
}

export interface SensitiveDataRedactionPolicy {
  readonly sensitiveKeys: ReadonlySet<string>;
  readonly platformIdPrefixesByKey: Readonly<Record<string, readonly string[]>>;
}

/**
 * Builds the redactor for a policy. Production uses `redactSensitiveData` below; the factory is exported so the
 * precedence tests can run a policy in which one key is both sensitive and tabled.
 */
export function createSensitiveDataRedactor(policy: SensitiveDataRedactionPolicy): (data: unknown) => unknown {
  const sensitive = new Set([...policy.sensitiveKeys].map(normalizeKey));
  const idPatternsByKey = new Map<string, RegExp>(
    Object.entries(policy.platformIdPrefixesByKey).map(([key, prefixes]) => [
      normalizeKey(key),
      // Prefixes are fixed lowercase tokens (letters and hyphens), so they need no regex escaping.
      new RegExp(`^(?:${prefixes.join("|")})-${PLATFORM_ID_UUID_V4}$`)
    ])
  );
  const isExemptPlatformId = (normalizedKey: string, value: string): boolean => {
    const pattern = idPatternsByKey.get(normalizedKey);
    return pattern !== undefined && pattern.test(value) && !containsLuhnValidCardShape(value);
  };

  const redact = (data: unknown): unknown => {
    if (typeof data === "string") {
      return data
        .replace(CARD_NUMBER_SHAPE, "[REDACTED]")
        .replace(/\b(bvn|nin)\s*[:=]\s*\d{11}\b/gi, "$1: [REDACTED]")
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
        .replace(/(?:\+234|234|0)[789][01]\d{8}\b/g, "[REDACTED]")
        .replace(/\+\d(?:[\s()-]*\d){7,14}\b/g, "[REDACTED]")
        .replace(/\b(cookie|set-cookie|access[_ -]?code|confirmation[_ -]?token|phone(?:number)?)\s*[:=]\s*[^\r\n;,]+/gi, "$1: [REDACTED]");
    }
    if (Array.isArray(data)) return data.map(redact);
    if (data !== null && typeof data === "object") {
      const copy: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        const normalizedKey = normalizeKey(key);
        if (sensitive.has(normalizedKey)) {
          // Sensitive keys are checked first and always win over the platform-id exemption.
          copy[key] = "[REDACTED]";
        } else if (typeof value === "string" && isExemptPlatformId(normalizedKey, value)) {
          // ADR 0075: an exact platform-id shape under its own key, with no Luhn-valid card-shaped run, is exempt.
          copy[key] = value;
        } else {
          copy[key] = redact(value);
        }
      }
      return copy;
    }
    return data;
  };
  return redact;
}

export const redactSensitiveData: (data: unknown) => unknown = createSensitiveDataRedactor({
  sensitiveKeys,
  platformIdPrefixesByKey: PLATFORM_ID_PREFIXES_BY_KEY
});

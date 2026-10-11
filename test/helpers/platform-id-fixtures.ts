// Shared fixtures for the platform-id redaction tests (ADR 0075, Issue 50). Oracles here are written independently of
// the production module: the card shape is the card rule's own regex, and Luhn is the standard mod-10 check.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PLATFORM_ID_PREFIXES_BY_KEY } from "../../packages/platform-core/src/redaction.js";

// Each pair is an (id key, prefix the generator for that key emits) oracle, written out on purpose.
export const ID_KEY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["requestId", "req"],
  ["commandEnvelopeId", "cmd"],
  ["commandId", "cmd"],
  ["offerId", "offer"],
  ["draftId", "draft"],
  ["threadId", "thread"],
  ["runId", "run"],
  ["surfaceId", "surf"],
  ["actionId", "pa"],
  ["quoteId", "quote"],
  ["aggregateId", "req"],
  ["aggregateId", "offer"],
  ["commitmentId", "blk"],
  ["commitmentId", "oph"],
  ["commitmentId", "brb"],
  ["payoutId", "payout"],
  ["recoveryId", "recovery"],
  ["refundId", "guest-refund"],
  ["queryId", "search"],
  ["runId", "turn"]
];

// Fixed values that the card-number rule masked before the fix. Their digit stretches are not Luhn-valid.
export const KNOWN_CARD_SHAPED_OFFER_ID = "offer-17477973-5806-4004-bea8-8d50c54c0c30";
export const KNOWN_CARD_SHAPED_COMMAND_ID = "cmd-63bde504-acc8-40f0-9792-588939387591";
export const KNOWN_CARD_SHAPED_REQUEST_ID = "req-63bde504-acc8-40f0-9792-588939387591";
export const CARD_NUMBER = "4111111111111111";

// The card rule's own shape (see packages/platform-core/src/redaction.ts): 16 digits, optional single separators.
export const CARD_SHAPE = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g;

// Test PANs (all Luhn-valid). Digit 13 is 4, so each fits the v4 id layout: the digit becomes the version nibble.
export const TEST_PANS = {
  mastercard: "5555555555554444",
  visa: "4242424242424242",
  discover: "6011000000004006"
} as const;

// Luhn-invalid 16-digit number with the same v4-compatible layout.
export const LUHN_INVALID_PAN = "4111111111114111";

export function isLuhnValid(digits: string): boolean {
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

// Oracle: some card-shaped run in the value is a Luhn-valid 16-digit number.
export function containsLuhnValidCardShape(value: string): boolean {
  return [...value.matchAll(CARD_SHAPE)].some((match) => isLuhnValid(match[0].replace(/\D/g, "")));
}

// Encodes a 16-digit PAN as the digits of a v4 UUID under the given prefix: group 1 holds PAN[0..7], group 2 PAN[8..11],
// and group 3 starts with the version nibble, so PAN[12] must be 4.
export function encodePanAsPlatformId(prefix: string, pan: string): string {
  if (pan.length !== 16 || pan[12] !== "4") throw new Error("PAN must be 16 digits with digit 13 equal to 4");
  return `${prefix}-${pan.slice(0, 8)}-${pan.slice(8, 12)}-${pan.slice(12, 16)}-8000-000000000000`;
}

export function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "test" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

// Detection query over legacy rows: a listed id key whose stored value contains a [REDACTED] mark. The keys come
// from the exemption table, so a key added there is covered automatically.
export function platformIdMaskedRowsSql(table: "audit_log" | "telemetry_events"): string {
  const predicate = Object.keys(PLATFORM_ID_PREFIXES_BY_KEY)
    .map((key) => `json_extract(payload_json, '$.${key}') LIKE '%[REDACTED]%'`)
    .join("\n   OR ");
  return `SELECT id, recorded_at FROM ${table}\nWHERE ${predicate}\nORDER BY id;`;
}

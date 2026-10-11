// Shared fixtures for the platform-id redaction tests (ADR 0075, Issue 50). Oracles here are written independently of
// the production module: the v4 shape is the RFC 4122 layout, Luhn is the standard mod-10 check, and the digit windows
// are every 16- to 19-digit window of a digit run after hyphens are removed.
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

// Fixed values that the card-number rule masked before the fix. Their digit windows are not Luhn-valid.
export const KNOWN_CARD_SHAPED_OFFER_ID = "offer-17477973-5806-4004-bea8-8d50c54c0c30";
export const KNOWN_CARD_SHAPED_COMMAND_ID = "cmd-63bde504-acc8-40f0-9792-588939387591";
export const KNOWN_CARD_SHAPED_REQUEST_ID = "req-63bde504-acc8-40f0-9792-588939387591";
export const CARD_NUMBER = "4111111111111111";

// The card rule's own shape (see packages/platform-core/src/redaction.ts): 16 digits, optional single separators.
export const CARD_SHAPE = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g;

// RFC 4122 version 4 layout of the 36-character UUID (what randomUUID() produces).
export const V4_UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Test PANs (all Luhn-valid). Digit 13 is 4, so each fits the v4 id layout at offset 0: the digit is the version nibble.
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

// Non-global copy of the card rule's shape, for `.test()` without lastIndex state.
export function cardRuleMatches(value: string): boolean {
  return /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/.test(value);
}

// Oracle for the gate: (a) some match of the card rule's own regex is Luhn-valid (separators removed), or (b) some maximal
// run of 17 to 19 digits (hyphens removed) is Luhn-valid as a whole. Other windows of a longer run are NOT tested.
export function containsLuhnValidCardShape(value: string): boolean {
  for (const match of value.matchAll(CARD_SHAPE)) {
    if (isLuhnValid(match[0].replace(/\D/g, ""))) return true;
  }
  for (const run of value.replace(/-/g, "").match(/\d+/g) ?? []) {
    if (run.length >= 17 && run.length <= 19 && isLuhnValid(run)) return true;
  }
  return false;
}

// Builds `${prefix}-<uuid>` with `digits` at hex offset `offset` (0..31) of the 32 hex digits. Every other position is a
// letter, except the version nibble (index 12, must be 4) and the variant (index 16, must be 8, 9, a or b).
// Throws when the digits break the v4 layout.
export function v4IdWithDigitsAt(prefix: string, offset: number, digits: string): string {
  const hex = Array.from({ length: 32 }, () => "a");
  hex[12] = "4";
  hex[16] = "b";
  [...digits].forEach((digit, index) => {
    hex[offset + index] = digit;
  });
  const joined = hex.join("");
  const uuid = `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20, 32)}`;
  if (!V4_UUID_SHAPE.test(uuid)) throw new Error(`digits at offset ${offset} break the v4 layout`);
  return `${prefix}-${uuid}`;
}

// Deterministic search for `length` digits at `offset` whose id satisfies accept(digits, id).
export function findV4IdWithDigits(
  prefix: string,
  length: number,
  offset: number,
  accept: (digits: string, id: string) => boolean
): string {
  for (let counter = 0; counter < 1_000_000; counter += 1) {
    // Free digits come from the counter; the positions the v4 layout fixes (hex 12 = 4, hex 16 = 8) are set explicitly.
    const chars = counter.toString().padStart(length, "0").split("");
    for (let index = 0; index < length; index += 1) {
      if (offset + index === 12) chars[index] = "4";
      if (offset + index === 16) chars[index] = "8";
    }
    const digits = chars.join("");
    const id = v4IdWithDigitsAt(prefix, offset, digits);
    if (accept(digits, id)) return id;
  }
  throw new Error(`no ${length}-digit id found at offset ${offset}`);
}

// Encodes a 16-digit PAN as the digits of a v4 UUID at offset 0 (the test PANs above): digit 13 is the version nibble.
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

// Detection query over legacy rows: a listed id key whose stored value contains a [REDACTED] mark. It matches flat,
// exact-case, top-level keys only (production writes flat camelCase keys). The keys come from the exemption table, so a
// key added there is covered automatically. To extend: add the key to PLATFORM_ID_PREFIXES_BY_KEY and regenerate the SQL.
export function platformIdMaskedRowsSql(table: "audit_log" | "telemetry_events"): string {
  const predicate = Object.keys(PLATFORM_ID_PREFIXES_BY_KEY)
    .map((key) => `json_extract(payload_json, '$.${key}') LIKE '%[REDACTED]%'`)
    .join("\n   OR ");
  return `SELECT id, recorded_at FROM ${table}\nWHERE ${predicate}\nORDER BY id;`;
}

import { parseScopeAssessment, type ScopeFailureReason } from "../../apps/local-guest/src/assistant/scope-classifier.js";
import type { AssistantFinishReason } from "../../apps/local-guest/src/assistant/assistant-model.js";

/** A schema-valid classifier verdict. Shared by the shape tests and the differential corpus. */
export const SCOPE_ALLOWED = {
  scope: "in_scope", risk: "ordinary", intents: ["price"], reasonCode: "supported",
  slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null },
} as const;
export const SCOPE_ALLOWED_JSON = JSON.stringify(SCOPE_ALLOWED);

/** The four codes that replace the former catch-all `invalid_json_malformed` (ADR 0075, 0106). */
export const MALFORMED_REPLACEMENT_CODES: readonly ScopeFailureReason[] = [
  "invalid_json_multiple_values", "invalid_json_trailing_text", "invalid_json_unterminated", "invalid_json_syntax",
];

export interface MalformedShape { readonly name: string; readonly text: string; readonly reason: ScopeFailureReason; }

/**
 * One row per shape in the classifier malformed-JSON investigation (2026-10-26), plus the parse failures it named.
 * Every row starts with `{` or `[` and is not fenced, wrapped, or length-stopped, so it reaches the malformed branch.
 */
export const MALFORMED_SHAPES: readonly MalformedShape[] = [
  { name: "object cut after a comma", text: `{"scope":"in_scope","risk":"ordinary",`, reason: "invalid_json_unterminated" },
  { name: "object cut inside a string", text: `{"scope":"in_sc`, reason: "invalid_json_unterminated" },
  { name: "object cut after a colon", text: `{"scope":`, reason: "invalid_json_unterminated" },
  { name: "object cut inside a number", text: `{"nights":1`, reason: "invalid_json_unterminated" },
  { name: "lone opening brace", text: "{", reason: "invalid_json_unterminated" },
  { name: "valid object then prose containing braces", text: `${SCOPE_ALLOWED_JSON} Note {x}.`, reason: "invalid_json_trailing_text" },
  { name: "valid object then an extra closing brace", text: `${SCOPE_ALLOWED_JSON}}`, reason: "invalid_json_trailing_text" },
  { name: "two objects on one line", text: `${SCOPE_ALLOWED_JSON}${SCOPE_ALLOWED_JSON}`, reason: "invalid_json_multiple_values" },
  { name: "two objects separated by a newline", text: `${SCOPE_ALLOWED_JSON}\n${SCOPE_ALLOWED_JSON}`, reason: "invalid_json_multiple_values" },
  { name: "valid object then a second object cut inside a string", text: `${SCOPE_ALLOWED_JSON}{"a":"x}`, reason: "invalid_json_multiple_values" },
  { name: "trailing comma before the closing brace", text: `${SCOPE_ALLOWED_JSON.slice(0, -1)},}`, reason: "invalid_json_syntax" },
  { name: "single-quoted keys and values", text: `{'scope': 'in_scope'}`, reason: "invalid_json_syntax" },
  { name: "unquoted key", text: `{scope: "in_scope"}`, reason: "invalid_json_syntax" },
  { name: "raw newline inside a string", text: SCOPE_ALLOWED_JSON.replace('"ordinary"', '"ordin\nary"'), reason: "invalid_json_syntax" },
  { name: "unescaped quote inside a string", text: SCOPE_ALLOWED_JSON.replace('"ordinary"', '"ord"inary"'), reason: "invalid_json_syntax" },
  { name: "NaN literal", text: SCOPE_ALLOWED_JSON.replace('"nights":null', '"nights":NaN'), reason: "invalid_json_syntax" },
  { name: "invalid string escape", text: `{"scope":"in\\qscope"}`, reason: "invalid_json_syntax" },
];

/** Named edge cases from the investigation's repro, including the cases that keep their earlier codes. */
export const NAMED_EDGE_CASES: readonly string[] = [
  "", " \n ", "{", "[", "{}", "[]", "null", "42", '"in_scope"', "﻿" + SCOPE_ALLOWED_JSON, `Result: ${SCOPE_ALLOWED_JSON}`,
  `${SCOPE_ALLOWED_JSON} Note: done.`, `${SCOPE_ALLOWED_JSON}\n`, `[${SCOPE_ALLOWED_JSON}]`, "```json\n" + SCOPE_ALLOWED_JSON + "\n```",
  "Sorry, I cannot classify that.", `{"scope": "in_scope"`, `${SCOPE_ALLOWED_JSON}"x"`, `${SCOPE_ALLOWED_JSON} 42`,
  SCOPE_ALLOWED_JSON.replace('"reasonCode":"supported"', '"reasonCode":"outside"'), "{\"scope\":\"in_scope\"}\u0000",
  " " + SCOPE_ALLOWED_JSON, "\t" + SCOPE_ALLOWED_JSON, "\r\n" + SCOPE_ALLOWED_JSON, `{"a":1}${SCOPE_ALLOWED_JSON}`,
  ...MALFORMED_SHAPES.map((shape) => shape.text),
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASES: readonly string[] = [
  SCOPE_ALLOWED_JSON,
  JSON.stringify({ ...SCOPE_ALLOWED, scope: "out_of_scope", reasonCode: "outside", intents: [] }),
  JSON.stringify({ ...SCOPE_ALLOWED, intents: ["search", "price"], slots: { ...SCOPE_ALLOWED.slots, city: "Lagos", bedrooms: 2, checkIn: "2026-11-06" } }),
  '{"scope":"unclear","risk":"unknown","intents":[],"reasonCode":"unclear","slots":{"city":null,"neighbourhood":null,"bedrooms":null,"nights":null,"guests":null,"checkIn":null,"checkOut":null}}',
];
const PIECES: readonly string[] = ["{", "}", "[", "]", '"', ":", ",", "\\", "\\u0041", "\\u12", "\\q", " ", "\n", "\t", "\r", "\u0001", "﻿",
  "true", "false", "null", "NaN", "-", "0", "1", ".5", "e", "1e3", "'", "x", "scope", "in_scope", "```", "Result: ", '{"a":1}', "}{"];

/**
 * A deterministic corpus: seeded mutations of valid verdicts, truncations, splices and token soup.
 * Mutations reach every failure family, so the accept/reject comparison covers both outcomes.
 */
export function seededScopeCorpus(count: number, seed: number): { readonly text: string; readonly finishReason: AssistantFinishReason }[] {
  const random = mulberry32(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const corpus: { text: string; finishReason: AssistantFinishReason }[] = [];
  for (let index = 0; index < count; index++) {
    let text: string;
    const kind = Math.floor(random() * 5);
    if (kind === 0) {
      text = pick(BASES);
      for (let edits = 1 + Math.floor(random() * 3); edits > 0; edits--) {
        const at = Math.floor(random() * (text.length + 1));
        const roll = random();
        if (roll < 0.4) text = text.slice(0, at) + pick(PIECES) + text.slice(at);
        else if (roll < 0.7) text = text.slice(0, at) + text.slice(at + 1);
        else text = text.slice(0, at) + pick(PIECES) + text.slice(at + 1);
      }
    } else if (kind === 1) {
      text = "";
      for (let pieces = 1 + Math.floor(random() * 12); pieces > 0; pieces--) text += pick(PIECES);
    } else if (kind === 2) {
      const base = pick(BASES);
      text = base.slice(0, Math.floor(random() * (base.length + 1)));
    } else if (kind === 3) {
      text = pick(BASES) + pick(PIECES) + pick(BASES);
    } else {
      const base = pick(BASES);
      const at = Math.floor(random() * (base.length + 1));
      text = base.slice(0, at) + pick(PIECES) + base.slice(at);
    }
    corpus.push({ text, finishReason: random() < 0.2 ? "length" : "stop" });
  }
  return corpus;
}

/**
 * The previous top-level invalid-JSON labeller, frozen verbatim for the before/after differential.
 * It is test-only. The product code no longer contains it.
 */
export function legacyInvalidJsonReason(text: string, finishReason: AssistantFinishReason | undefined): string {
  if (/^\s*```/.test(text)) return "invalid_json_fenced";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { JSON.parse(text.slice(start, end + 1)); return "invalid_json_wrapped"; } catch { /* Not an embedded JSON object. */ }
  }
  if (finishReason === "length") return "invalid_json_truncated";
  return /^\s*[{[]/.test(text) ? "invalid_json_malformed" : "invalid_json_prose";
}

/** The previous validator's full outcome for one response, built from the unchanged verdict parser. */
export function legacyScopeOutcome(text: string, finishReason: AssistantFinishReason | undefined): { readonly accepted: true; readonly assessment: unknown } | { readonly accepted: false; readonly reason: string } {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { accepted: false, reason: legacyInvalidJsonReason(text, finishReason) }; }
  let reason = "invalid_shape";
  const parsed = parseScopeAssessment(value, (failure) => { reason = failure; });
  return parsed ? { accepted: true, assessment: parsed } : { accepted: false, reason };
}

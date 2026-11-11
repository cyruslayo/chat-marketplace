/** Issue 19 (ADR 0074, 0081): contact field semantics come from the server-declared purpose, never the visible label. */
export interface ContactFieldAttributes {
  readonly type: "tel" | "email";
  readonly inputMode: "tel" | "email";
  readonly autocomplete: "tel" | "email";
}

export function contactFieldAttributes(purpose: "phone" | "email"): ContactFieldAttributes {
  return purpose === "phone"
    ? { type: "tel", inputMode: "tel", autocomplete: "tel" }
    : { type: "email", inputMode: "email", autocomplete: "email" };
}

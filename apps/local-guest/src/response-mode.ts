import { validateModePresentation, type ModePresentation } from "../../web-agent/src/guest-content.js";

/**
 * The response-mode check the browser client applies to every guest response (ADR 0107). Kept free of DOM access and
 * module-scope side effects so node can import it and test the client's refusal directly. An absent mode is allowed;
 * a present mode must pass validateModePresentation or the response is refused.
 */
export function assertValidResponseMode(value: unknown): void {
  if (value === undefined) return;
  if (validateModePresentation(value) === undefined) throw new Error("Invalid response mode");
}

/** The validated, frozen copy of a response mode, or undefined when the mode is absent or malformed (ADR 0107). */
export function readResponseMode(value: unknown): ModePresentation | undefined {
  return validateModePresentation(value);
}

/**
 * Issue 03c (ADR 0107 decisions 2 and 6): writes the response's mode id to the document's data-mode, and only from a validated
 * presentation. An absent or malformed mode leaves the attribute as it is. The client never sets the mode from a user action.
 */
export function applyResponseModeTo(root: { readonly dataset: Record<string, string | undefined> }, value: unknown): void {
  const mode = readResponseMode(value);
  if (mode === undefined || root.dataset.mode === mode.id) return;
  root.dataset.mode = mode.id;
}

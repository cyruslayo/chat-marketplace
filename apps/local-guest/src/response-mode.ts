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

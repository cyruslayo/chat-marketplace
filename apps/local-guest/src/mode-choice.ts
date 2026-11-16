import { validateModePresentation, type ModePresentation } from "../../web-agent/src/guest-content.js";

/**
 * Issue 03g (ADR 0107 decisions 3, 9 and 10): the pure rules for the mode strip and the mode sheet. Kept free of DOM access so
 * node can test the refusals directly; the browser client renders the choices it returns.
 */

/** One entry of the server's `verticals` list, as the client receives it. Its presentation is still untrusted. */
export interface ModeVertical {
  readonly domain: string;
  readonly presentation?: unknown;
}

/** A mode the guest may choose: a registered domain and its validated presentation. */
export interface ModeChoice {
  readonly domain: string;
  readonly presentation: ModePresentation;
}

/**
 * The modes offered as choices, in the server's order. A presentation that fails validateModePresentation is dropped. A mode id
 * that appears on more than one entry is dropped on every entry (fail closed), so no id names two choices.
 */
export function chooseModes(verticals: readonly ModeVertical[] | undefined): readonly ModeChoice[] {
  if (verticals === undefined) return [];
  const counts = new Map<string, number>();
  const validated: ModeChoice[] = [];
  for (const vertical of verticals) {
    const presentation = validateModePresentation(vertical.presentation);
    if (presentation === undefined) continue;
    counts.set(presentation.id, (counts.get(presentation.id) ?? 0) + 1);
    validated.push({ domain: vertical.domain, presentation });
  }
  return validated.filter((choice) => counts.get(choice.presentation.id) === 1);
}

/** The strip, the sheet and the persona wording show only with two or more registered modes (ADR 0107, 10 Nov 2026). */
export function showsModeChooser(choices: readonly ModeChoice[]): boolean {
  return choices.length >= 2;
}

/**
 * The app-bar mark is a labelled control only with two or more modes, and never while the human state applies (ADR 0076). The human
 * state is not wired to guests yet, so the client passes `false`; the rule is kept here so it applies once it is.
 */
export function markIsControl(choices: readonly ModeChoice[], humanState: boolean): boolean {
  return showsModeChooser(choices) && !humanState;
}

/**
 * Whether a first message or a starter must send `platform.task.start` before the turn (ADR 0107 decision 9). A preview of the
 * committed mode, or no preview, needs no start. The domain comes from the chosen radio, never from the message.
 */
export function startBeforeTurn(choices: readonly ModeChoice[], previewDomain: string | undefined, committedModeId: string): ModeChoice | undefined {
  if (previewDomain === undefined) return undefined;
  const preview = choices.find((choice) => choice.domain === previewDomain);
  if (preview === undefined || preview.presentation.id === committedModeId) return undefined;
  return preview;
}

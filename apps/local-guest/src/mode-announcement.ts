import { GUEST_MODE_CHOOSER, guestModeSwitchAnnouncement } from "../../web-agent/src/guest-content.js";
import { readResponseMode } from "./response-mode.js";

/**
 * Issue 03l (ADR 0107 decision 7; ADR 0078): decides when a committed mode switch is announced. Free of DOM access so node can drive
 * it. A switch is the change of mode id between two validated responses. The first response is never a switch (a reload restores the
 * mode), and a malformed mode changes nothing. The switch copy is held and written once: combined with the response's polite text
 * (switch first, then the reply, separated by a space), or written alone by flush() when nothing else is announced for the response.
 */
export interface ModeAnnouncements {
  /** Records a response's mode. A validated id that differs from the last one holds the switch copy. */
  applyResponse(value: unknown): void;
  /** The text for the polite announcer: the held switch copy first, once, then the given text. */
  politeText(text: string): string;
  /** The held switch copy when nothing combined with it, once. Undefined when nothing is held. */
  flush(): string | undefined;
}

export function createModeAnnouncements(): ModeAnnouncements {
  let lastModeId: string | undefined;
  let held: string | undefined;
  return {
    applyResponse(value: unknown): void {
      const mode = readResponseMode(value);
      if (mode === undefined) return;
      if (lastModeId !== undefined && lastModeId !== mode.id) {
        held = guestModeSwitchAnnouncement(GUEST_MODE_CHOOSER.conciergeLabel(mode.label));
      }
      lastModeId = mode.id;
    },
    politeText(text: string): string {
      if (held === undefined) return text;
      const switchText = held;
      held = undefined;
      return text.trim() === "" ? switchText : `${switchText} ${text}`;
    },
    flush(): string | undefined {
      const switchText = held;
      held = undefined;
      return switchText;
    },
  };
}

The composer is where the guest types to the concierge: one labelled field and a Send button, which keeps unsent text when the network drops.

**Maps to:** `.ui-composer` with `__input` and `__send` (new; the shipped client uses `.composer`, `.field` and `.send`).

## Anatomy
1. Visually hidden label: "Your message".
2. Input, 16px text so phones don't zoom. Placeholder in the order of the facts needed: "City or area, dates, guests", or "Ask about these stays…" after results.
3. Send: a 44px round button named "Send".

## Variants
The link form (`.ui-composer--link`) is the Ask bar. Empty conversation (the city, dates and guests placeholder) and follow-up (the "Ask about…" placeholder).

## States
| State | What changes |
| --- | --- |
| Idle | `surface`, 1px `border`. |
| Hover | No change. |
| Focus | The ring turns `indigo`; the input itself has no extra outline. |
| Busy | While a turn runs, Send becomes "Stop" (cancellable, R8) and the input stays editable. |
| Disabled | Send is disabled while the input is empty (`surface-subtle`). |
| Offline | The text is kept; a Banner offers "Try again" when the connection returns. |
| Success, invalid, stale | Not applicable. |

## Tokens
`surface`, `border`, `indigo`, `on-indigo`, `ink`, `ink-muted` (placeholder only), `surface-subtle`, `radius-xl`, `radius-pill`, `space-2`. Type: body 16/24.

## Accessibility
- `<form>` with a labelled input and a `<button type="submit">`. Enter sends; Shift+Enter makes a new line in a textarea.
- The chat input only accepts a real input event (test note in AGENTS.md).
- Targets: Send is 44 × 44px.

## Rules
- Free chat is help, never a required path (R5): every step also has chips, cards or a page.

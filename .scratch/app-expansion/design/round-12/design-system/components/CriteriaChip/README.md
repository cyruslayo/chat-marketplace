A criteria chip shows one part of the guest's search (area, dates and nights, guests, budget) and opens it for a quick edit, so the guest picks instead of retyping (R5).

**Maps to:** `.ui-chips` > `.ui-chip` with `--add` and `--demo` (shipped).

## Anatomy
1. Icon: pin, calendar, people or plus.
2. Value in the guest's terms: "Lagos", "10–13 Sept · 3 nights", "2 guests", "Budget" (add).

## Variants
| Variant | Use |
| --- | --- |
| Value | A set criterion; tapping edits it. |
| Selected (`aria-pressed="true"`) | A suggested chip the guest has chosen: `--mode-subtle` fill and a 2px `--mode-accent` ring. |
| Add (`--add`) | A criterion not set yet. |
| Demo (`--demo`) | The static "Demo listing" label on synthetic stays; not a control. |

## States
| State | What changes |
| --- | --- |
| Idle | `surface`, 1px `border`. |
| Hover | `surface-subtle`. |
| Focus | 3px `focus` ring. |
| Selected | Mode tint and ring, so it isn't shown by colour alone. |
| Busy | The conversation shows the concierge working; the chip keeps its value. |
| Disabled | Not used; a criterion that can't change is plain text. |
| Invalid | A rejected edit is explained in the conversation; the chip keeps the last good value. |
| Stale | Not applicable. |

## Tokens
`surface`, `surface-subtle`, `border`, `border-subtle`, `ink`, `ink-secondary`, `--mode-accent`, `--mode-subtle`, `focus`, `radius-pill` (chips are one of its two uses), `space-2`. Type: 15/20 600.

## Accessibility
- A `<button>` in a `role="group"` named "Your search". Selected chips use `aria-pressed`.
- A starter that opens a page or sends a fixed prompt may be an `<a class="ui-chip">`; the chip carries no underline (25 Nov 2026).
- Keyboard: Tab between chips, Enter or Space to edit.
- Targets: 44px tall.

## Rules
- Chip edits are structured guest input and reach the assistant context (ADR 0106).

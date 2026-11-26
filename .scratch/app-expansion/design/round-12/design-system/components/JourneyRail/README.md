The journey rail shows where a guest is in a booking: Search · Stay · Request · Offer · Pay · Confirmed, with the current step marked and a failed step shown as failed, never as progress.

**Maps to:** `.ui-rail-nav` around the full list `.ui-rail` (shipped), plus the compact line `.ui-rail-nav__compact` with `.ui-rail-nav__bar`.

## Anatomy
1. `<nav aria-label="Booking progress">`.
2. Full rail (640px and wider): an ordered list of six steps, each a 4px bar with its word beneath.
3. Compact line (below 640px): "Step 3 of 6 · Request" and six short bars, so 320px never wraps.

## Variants
| Step state | Look |
| --- | --- |
| Done (`.is-done`) | `ink-secondary` bar and word. |
| Current (`aria-current="step"`) | `indigo` bar, `ink` word, bold. |
| To come | `border-subtle` bar, `ink-muted` word. |
| Failed (`.is-failed`) | `danger` bar and word, with the word that says what failed on the page itself ("Declined"). |

## States
| State | What changes |
| --- | --- |
| Idle | As the step states. |
| Hover, focus, busy, disabled | Not interactive: the rail is a progress indicator, not navigation. |
| Success | Confirmed is the current step; every earlier step is done. |
| Invalid | Not applicable. |
| Stale | The page's stale banner covers it. |

## Tokens
`indigo`, `ink`, `ink-secondary`, `ink-muted`, `border-subtle`, `danger`, `canvas`, `space-1`, `space-4`, `space-6`. Type: small 14/20.

## Accessibility
- An ordered list inside a named nav. The current item has `aria-current="step"`. Only one form is rendered at a width (the other is `display:none`).
- Not a target.

## Rules
- The exact six words, in this order, on every booking screen.
- A Booking Request is never shown past Request until the Operator accepts.

An empty state says plainly that there is nothing here, what will appear and when, and offers at most one way forward.

**Maps to:** `.ui-empty` with `__title` and `__body` (shipped: `.ui-empty`).

## Anatomy
1. Title in Newsreader (h2 24/30): what is true ("Nothing needs you right now", "No stays yet").
2. Body: what will appear here and when ("New Booking Requests, transfers to check and payouts appear here with their deadline in WAT.").
3. Optional single action: quiet on Operator screens ("View bookings"), primary on a guest screen when it is the only action ("Find a stay").

## Variants
| Variant | Use |
| --- | --- |
| Nothing yet | A list with no items. |
| Signed out | "Sign in to see your stays", with "Sign in"; the guest returns to the same page after. |
| Not yet available | "No receipt yet": why there's nothing to act on, and the time it is due. |

## States
| State | What changes |
| --- | --- |
| Idle | As above. |
| Hover, focus | On its action only. |
| Busy, success, invalid, disabled | Not applicable. |
| Stale | Not applicable. The page reloads its list on load. |

## Tokens
`surface`, `border-subtle`, `ink`, `ink-secondary`, `radius-lg`, `space-6`. Type: h2 24/30 (Newsreader), body 16/24.

## Accessibility
- The title is a heading at the right level for the page.
- Not a target itself; its action is 44px or more.

## Rules
- No illustration of a specific place. A mode empty state may use the Placeholder illustration, labelled "Illustration".
- Never "Oops" or "Unfortunately".

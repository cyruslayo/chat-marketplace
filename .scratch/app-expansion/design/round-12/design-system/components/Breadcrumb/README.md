A breadcrumb shows where a record sits and links back to its list, using the apartment, never a guest's name or an internal id.

**Maps to:** `.ui-breadcrumb` (new; the shipped back office uses a plain back link).

## Anatomy
1. `<nav aria-label="You are here">` around an ordered list.
2. Parent links ("Transfers", "Bookings", "Account"), 44px tall.
3. A "/" separator drawn in CSS, so screen readers skip it.
4. The current page as text with `aria-current="page"`: "2-bedroom apartment, Admiralty Way".

## Variants
Two levels only (list / record). Long apartment names wrap; they are never cut short.

## States
| State | What changes |
| --- | --- |
| Idle | Parent links in `indigo` 600, current page in `ink`. |
| Hover | Underline. |
| Focus | 3px `focus` ring. |
| Busy, success, invalid, disabled, stale | Not applicable. |

## Tokens
`indigo`, `ink`, `ink-secondary`, `ink-muted` (separator only), `focus`. Type: small 14/20.

## Accessibility
- Landmark: navigation, named "You are here". The current item is marked `aria-current="page"`.
- Keyboard: Tab to each parent link.
- Targets: parent links are 44px tall.

## Rules
- "Transfers / 2-bedroom apartment, Admiralty Way". The record's stay dates go in the page title, not the breadcrumb.

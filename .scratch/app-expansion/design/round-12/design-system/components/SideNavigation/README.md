Side navigation is the back office's one menu: a fixed column from 768px, and below 768px a compact bar with the brand, the current section and a Menu button, so the page title stays above the fold at 320px.

**Maps to:** `.ui-sidenav` and `.ui-sidenav-compact`, inside `.ui-shell` with `.ui-shell__main`. Both are rendered; the width shows one.

## Anatomy
**Full (768px and wider)**
1. Brand: "Xenia" wordmark and "Back office".
2. List: Home · Requests · Bookings · Transfers · Owner payouts · Calendar. The current one has `aria-current="page"` and an `indigo-subtle` fill.
3. Who: "Signed in as Tunde, representative for 3 owners".

**Compact (below 768px)**
1. Bar, 56px, which is the native `<summary>`: the wordmark (text, not a link, because a link inside a summary would be a nested control), the current section ("Transfers") and the "Menu" label. Home stays the first item of the list.
2. A disclosure (`<details>`), closed by default, that opens the same list below the bar and pushes the page down. It is not an overlay.

## Variants
The guest form is its own component, Side navigation, guest. Here: full and compact only. No icon-only rail, and never wrapped tab rows.

## States
| State | What changes |
| --- | --- |
| Idle | As above. |
| Hover | Link fills `surface-subtle`. |
| Focus | 3px `focus` ring on each link and on the Menu toggle. |
| Current | `indigo-subtle` fill, `indigo` text, `aria-current="page"`. |
| Open (compact) | The toggle fills `indigo-subtle`; the list shows below the bar. |
| Busy, success, invalid, disabled, stale | Not applicable: a link either goes or does not. |

## Tokens
`canvas`, `surface-subtle`, `indigo-subtle`, `indigo`, `ink`, `ink-secondary`, `border`, `border-subtle`, `focus`, `radius-md`, `space-1` to `space-6`. Type: the Newsreader wordmark at 24/28, links 15/20 600.

## Accessibility
- Landmark: `<nav aria-label="Back office">` in both forms.
- Compact toggle: the native `<summary>`, named "Menu, current section Transfers" with `aria-label`. It exposes the expanded state, and Enter or Space opens it. Escape is not needed because it is not an overlay.
- Keyboard: Tab through the links in order. No arrow-key roving.
- Targets: links and the toggle are at least 44px.

## Rules
- At 320px the bar is 56px, so the page title starts within the first 90px.
- Labels exactly: Home, Requests, Bookings, Transfers, Owner payouts, Calendar.

Side navigation, guest, is the tab bar's desktop form: the wordmark, the mode label and Find, Your stays, Account and Help in one column from 768px.

**Maps to:** `.ui-sidenav` (Side navigation) with `--guest`, and `__list--end` for Help. Below 768px the Tab bar takes over; both are rendered and the width shows one.

## Anatomy
1. Wordmark, a link to Find.
2. Mode label "Concierge · Stays". With two or more domains it is the control that opens the Concierge chooser.
3. List: Find · Your stays · Account, each with its tab bar icon. Your stays carries the badge at its right.
4. Help, after a hairline. It is not a tab below 768px, where it lives in the App bar.

## Variants
Stays only ("Your stays") and two or more domains ("Your plans"). No icon-only rail.

## States
| State | What changes |
| --- | --- |
| Idle | `ink-secondary`. |
| Hover | `surface-subtle`, `ink`. |
| Focus | 3px `focus` ring. |
| Current | `surface-subtle` fill, `ink` 700, `aria-current="page"`. The Back office form keeps `indigo-subtle`. |
| Badge | As the Tab bar. |
| Busy, success, invalid, disabled, stale | Not applicable. |

## Tokens
`canvas`, `surface-subtle`, `border-subtle`, `ink`, `ink-secondary`, `warning`, `warning-surface`, `focus`, `radius-md`, `radius-sm`, `space-2`, `space-4`, `space-6`.

## Accessibility
- Landmark: `<nav aria-label="Main">`, the same name as the Tab bar. Only one of the two is displayed at a width.
- Keyboard: Tab in order: wordmark, mode label (when it is a control), Find, Your stays, Account, Help.
- Targets: every link is at least 44px tall.

## Rules
- 232px wide, full height. The page column is at most 820px.
- Hidden during a full-screen task, at every width.
- The wordmark, mode label and Help leave the App bar from 768px, so nothing is named twice.

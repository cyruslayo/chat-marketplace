The tab bar is the guest app's three places, Find, Your stays and Account, fixed at the bottom of every page below 768px that is not a full-screen task.

**Maps to:** `.ui-tabbar` and `.ui-badge` (new). The shipped `.ui-task-badge` is the nearest badge in code.

## Anatomy
1. `<nav aria-label="Main">`, three equal columns.
2. Each item is one link: a 24px icon (`.ui-icon`), then the label.
3. Current item: `ink`, weight 700 and a 3px `ink` line on top. Indigo is not used, because it stays for the next action.
4. Badge on Your stays (`.ui-badge`): the count on `warning-surface`, then the hidden words " needs your action" (or " need your action" for two or more).

## Variants
| Variant | Use |
| --- | --- |
| Stays only | Find · Your stays · Account. |
| Two or more domains | Find · Your plans · Account. Same icons, so the place does not move. |
| No badge | Nothing waits on the guest. |
| Badge 1 to 9, then 9+ | The hidden words give the same count. |

## States
| State | What changes |
| --- | --- |
| Idle | `ink-secondary` icon and label. |
| Hover | `surface-subtle` fill, `ink` text. |
| Focus | 3px `focus` ring drawn 3px inside the item, so the screen edge never clips it. |
| Pressed | As hover. |
| Current | `aria-current="page"`, `ink`, 700, the 3px line. |
| Stale | The count is re-read on load and when a turn ends. It is never counted down in the browser. |
| Offline | The links stay; the page they open says what could not load. |
| Busy, success, invalid, disabled | Not applicable. A place is always reachable. |

## Tokens
`canvas`, `surface-subtle`, `border-subtle`, `ink`, `ink-secondary`, `warning`, `warning-surface`, `focus`, `radius-sm`. Type: 14/20 600, current 700. Badge 12/16 700.

## Accessibility
- Role: navigation, named "Main". Each item is a link named by its label; with a badge, "Your stays 1 needs your action".
- Keyboard: Tab moves through the three links in order and Enter opens one. No arrow keys, because these are links and not ARIA tabs.
- Targets: each item is at least 106 × 56px at 320 (measured).
- At 320px no label wraps: "Your stays" is 66px wide in a 106px column (measured). Larger text settings may wrap it to two lines, and the bar then grows.
- The badge colour is never the only sign: the number is text, and the hidden words say what it counts.

## Rules
- Three items. A domain is a change of focus, not a place, so it never becomes a tab.
- Hidden during a full-screen task (Task bar) and from 768px (Side navigation, guest).
- The badge counts items that need the guest to act, never messages or offers to browse.
- Under 600px of visible height the bar drops to 50px inside `.ui-app`; the targets stay above 44px.

The task bar is the App bar for a full-screen task, with Close, the task's title and Help, so a guest who is committing to something has one way out and nothing else to tap by accident.

**Maps to:** `.ui-appbar.ui-appbar--task` with `__action` (shipped) and `__title` (new).

## Anatomy
1. Close, icon only, named for the task: "Close Review request".
2. Title, the page's `<h1>`, centred, two lines at most.
3. Help, icon only.

No wordmark, no mode label and no tab bar.

## Variants
| Variant | Use |
| --- | --- |
| Booking task | The Journey rail sits directly below: Review request, Conditional Booking Offer, Choose how to pay. |
| Other task | No rail: Report a problem, Cancel reservation, Review this stay. |

## States
| State | What changes |
| --- | --- |
| Idle | As above. |
| Hover | Close and Help fill `surface-subtle`. |
| Focus | 3px `focus` ring. On arrival, focus moves to the title. |
| Busy | While the task's action runs, Close stays available. Leaving does not cancel what was already sent, and the next page says so. |
| Unsaved | Close keeps what was typed on this device and returns. No confirmation is needed, because nothing is lost. |
| Success | The task ends and the next page has the normal App bar. |
| Invalid, disabled, stale | On the page, not in the bar. |

## Tokens
`canvas`, `surface-subtle`, `border-subtle`, `ink`, `focus`, `radius-md`, `space-2`. Type: label 16/20 600.

## Accessibility
- Landmark: `<header>`. The title is the only `<h1>` on the page.
- Keyboard: Close, then Help, then the page. Escape does not close a page-level task.
- Targets: Close and Help are 44 × 44px.
- At 320px "Conditional Booking Offer" takes two lines and the bar stays 61px tall (measured).

## Rules
- Close returns to the page the task came from, never to the start.
- A deadline that matters to the task is in the page, above the action, never in the bar.

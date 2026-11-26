A banner states one fact about the page in the order problem or fact, effect, next action, with an icon and a word so colour is never the only signal.

**Maps to:** `.ui-banner` with `--neutral`, `--info`, `--success`, `--warning`, `--danger`, and parts `__title`, `__body`, `__actions`.

## Anatomy
1. Icon (20px), except on neutral: check for success, clock for warning, triangle for danger, an "i" for info.
2. Title: the fact, bold, one line where possible ("Pay by 2:20 PM WAT").
3. Body: the effect, then the next action.
4. Optional actions: at most two, a quiet button and a link.

## Variants
| Variant | Use | Tokens |
| --- | --- | --- |
| Neutral | Context with no status ("This is a request, not a booking"). | `surface`, `border-subtle` |
| Info | Information status: neutral ink with an info icon, never blue. | `surface-subtle`, `ink-secondary` |
| Success | Confirmed and paid, always with a check and a word. | `success`, `success-surface` |
| Warning | Deadlines, holds, overdue items and things to fix, always with a clock icon and an absolute WAT time. | `warning`, `warning-surface` |
| Danger | Declines and failures only, never routine expiry or an overdue item. | `danger`, `danger-surface` |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus | Only its actions react. The banner itself is not interactive. |
| Busy | Not shown in a banner. A long action shows on its button. |
| Success, invalid | These are the success and warning variants, not separate states. |
| Disabled | Not applicable. |
| Stale | A warning banner with a refresh icon: "This transfer changed since you opened it", then what happened and "Show the latest". |

## Tokens
`surface`, `surface-subtle`, `border-subtle`, `ink`, `ink-secondary`, `success`, `success-surface`, `warning`, `warning-surface`, `danger`, `danger-surface`, `radius-md`, `space-2`, `space-4`. Every pair reads at 4.5:1 or more in both themes.

## Accessibility
- Role: none for static context. Use `role="status"` when it appears after an action, and `role="alert"` only for a failure that blocks the task.
- Name: the title. The banner is never the only place a deadline appears; the deadline also sits in its component.
- Keyboard: none, except its actions.
- Targets: its actions are 44px.

## Rules
- No modal for information: a banner sits in the flow.
- At most one warning or danger banner at the top of a page.
- Every deadline gives an absolute time; a countdown may only sit beside it.

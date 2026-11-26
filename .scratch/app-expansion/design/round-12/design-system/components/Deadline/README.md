A deadline shows when something must happen as an absolute WAT time first, with the time left beside it, and says so plainly once it has passed.

**Maps to:** `.ui-deadline` with `__at` and `__left`, plus `--info` and `--overdue`. Shipped deadlines live inside `.ui-banner--warning`; this is the inline form used in rows and panels.

## Anatomy
1. Clock icon, always.
2. Absolute time: verb plus time, "Answer by 11:42 AM WAT", "Verify by 11:10 AM WAT", "Due Thu 24 Dec 2026". Add the date when it is not today.
3. Time left: "18 minutes left", "in 3 days", "14 minutes overdue". Optional reminder note ("First reminder at 10 minutes").

## Variants
| Variant | Use | Tokens |
| --- | --- | --- |
| Due | A deadline on the person reading. | `warning` |
| Info | A time that is not on them ("Guest must pay and upload by 11:40 AM WAT"), or no deadline ("No deadline set · owed since Wed 25 Nov"). | `ink-secondary` |
| Overdue | The time has passed: "Was due 11:10 AM WAT" with "14 minutes overdue", the time underlined, beside the Overdue tag. | `warning` |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus, busy, disabled | Not interactive, so none. |
| Success | Replaced by the outcome ("Verified 11:02 AM WAT, 8 minutes before the deadline"). |
| Invalid | Not applicable. |
| Stale | The time left is computed from the clock when the page renders (lazy evaluation), never trusted from an old copy. A page left open shows "Updated 11:24 AM WAT" in its header. |

## Tokens
`warning`, `ink-secondary`. Type: 14/20 700 (time), 14/20 400 (left).

## Accessibility
- Plain text; use a `<time datetime>` element for the absolute time.
- The countdown is not live-announced. Screen readers get the absolute time, which does not change.
- Not a target.

## Rules
- Times are absolute and in WAT, written "4:00 PM WAT". A countdown never replaces the time.
- Warning colour, always with the clock icon. Never danger, even when overdue.

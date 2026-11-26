A tag is a small label that classifies a record ("Demo listing", "Illustration", "First reminder") or flags it as Overdue; it never carries money, times or errors.

**Maps to:** `.ui-tag`, `.ui-tag--overdue`.

## Anatomy
1. Optional icon, 14px (the Overdue tag always has the warning triangle).
2. Text in the meta style (12/16, 400; Overdue 700).

## Variants
| Variant | Use | Tokens |
| --- | --- | --- |
| Default | Classification: "Demo listing", "Illustration", "PDF", "First reminder", "Second reminder". | `surface-subtle`, `ink-secondary` |
| Overdue | A deadline has passed. Always with the triangle icon and the word "Overdue", next to a Deadline that gives the time it was due. | `warning-surface`, `warning` |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus, busy, disabled | Not interactive, so none. A tag is never a button or a filter. |
| Success, invalid | Not applicable: use a Status word or a Banner. |
| Stale | Not applicable. |

## Tokens
`surface-subtle`, `ink-secondary`, `warning-surface`, `warning`, `radius-sm`. Type: meta (12/16, 400).

## Accessibility
- Plain text, read in place. The icon is `aria-hidden`; the word says it.
- Overdue is marked four ways: the tag, the "Was due …" deadline, an underlined deadline time, and its place at the top of the list.
- Not a target.

## Rules
- Overdue uses warning, never danger: danger is for declines and failures only.
- Never put a price, a time or an error in a tag.

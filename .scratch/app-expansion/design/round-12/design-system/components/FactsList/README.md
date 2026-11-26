A facts list shows a record's facts as label and value pairs in a fixed order, so the same fact sits in the same place on every screen.

**Maps to:** `.ui-facts` (two-column) and `.ui-facts--stacked`. Labels come from `GUEST_FACT_LABELS` where one exists.

## Anatomy
1. `<dl>` container.
2. Label (`<dt>`) in `ink-secondary`.
3. Value (`<dd>`) in `ink`, 600, with tabular figures. Totals use the `money-total` style (Newsreader, which has the ₦ glyph).

## Variants
| Variant | Use |
| --- | --- |
| Two-column | Label left, value right. Panels and cards from 320px; long values wrap. |
| Stacked | Label above value, a hairline between pairs. Narrow side columns and the transfer check's expected panel at 320px. |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus, busy, disabled | Not interactive, so none. A value may contain a link (for example "View receipt"), which has its own states. |
| Success | Not a state of the list; the outcome panel sits beside it. |
| Invalid | Not applicable. |
| Stale | The page's stale banner covers it; values are never shown greyed out. |
| Loading | Skeleton lines in the final layout, one per pair. |

## Tokens
`ink`, `ink-secondary`, `border-subtle` (stacked), `space-2`, `space-4`. Type: body 16/24 for values, the `money-total` style for totals.

## Accessibility
- Role: a description list, read as term and definition.
- Keyboard: none, except links in values.
- Money is never in `ink-muted` or the meta style.

## Rules
- Fixed order on every Operator record: Owner, Stay dates, Stay, Check-in window, Guest phone, money.
- Never a guest's name: records are titled by apartment and stay dates.
- References use the monospace reference style (`.ui-reference`).

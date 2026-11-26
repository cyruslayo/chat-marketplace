A result row is the compact, one-link form of a stay: title, area or dates, price, and an optional next-step line, used on phones, in chat and on Your stays.

**Maps to:** `.ui-result-rows` > `.ui-result-row` with `__thumb`, `__body`, `__title`, `__where`, `__price` (shipped), plus the new optional slot `__next`, `--muted` and `--no-thumb`. Under ADR 0108 the slot is a minor version.

## Anatomy
1. Thumb (optional), 64 × 48.
2. Body: title (16/22 600), then where or dates (small), then price ("₦370,000 all-in · 3 nights"): the figure in Newsreader 500 17/22, the "all-in · 3 nights" span in small 14/20.
3. Next step (optional): a Status word and its Deadline ("Offer ready · Accept by 4:00 PM WAT today").
4. Chevron. The whole row is one `<a>`.

## Variants
| Variant | Use |
| --- | --- |
| Discovery | Thumb, title, price. |
| Your stays | No thumb, title, area and dates, next step. |
| Muted | Past or ended stays: `surface-subtle`, `ink-secondary` title, still 4.5:1. |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover | The ring darkens to `border`. |
| Focus | 3px `focus` ring on the row. |
| Loading | A 64px row Skeleton. |
| Busy, success, invalid, disabled | Not applicable. |
| Stale | Not applicable; the list is re-read on load. |

## Tokens
`surface`, `surface-subtle`, `border-subtle`, `border`, `ink`, `ink-secondary`, `--mode-subtle`, `radius-lg`, `radius-md`, `space-2`, plus the Status word and Deadline tokens.

## Accessibility
- A list of links. The link's name is its visible text, so the status and deadline are read with the title.
- Target: each row is at least 64px tall.

## Rules
- One link per row; never a button inside the row.

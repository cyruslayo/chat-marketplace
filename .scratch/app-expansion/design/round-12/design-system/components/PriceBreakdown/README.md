The price breakdown states what the guest pays: the All-In Stay Total first, the Refundable Security Deposit on its own line, then what is due now or already paid, using the `GUEST_FACT_LABELS` wording.

**Maps to:** `.ui-price-breakdown` with `__condition`, `__label`, `__row`, `__value`, `__due`, `__paid`, and `.ui-money-total` (shipped). New: `--band`, the same rows on indigo-deep inside the Stay ticket.

## Anatomy
1. Condition tag (before acceptance only): "If your request is accepted".
2. Label: "All-In Stay Total · 3 nights".
3. Total: `money-total` (Newsreader, which has the ₦ glyph).
4. Rows: "Refundable Security Deposit (separate)", or "Refundable Security Deposit collected", with the value right-aligned.
5. One closing line: "Total to complete booking", "This payment", or "Stay payment paid".

## Variants
| Variant | Use |
| --- | --- |
| Panel | On surface, where there is no ticket (chat cards, payment pages). |
| Band (`--band`) | Inside the Stay ticket: sand label and rules, `on-indigo-deep` figures. |
| Before acceptance | Condition tag, total, deposit, "Total to complete booking". |
| Payment | "This payment" for the one payment a screen asks for. |
| Paid | "Refundable Security Deposit collected", "Stay payment paid". |
| Extended Stay | "Billing Period n" rows and "This is the first Billing Period only…" (`firstPeriodOnly`). |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus, busy, disabled | Not interactive. |
| Stale | The page's warning banner names the old and new total; the breakdown shows only the new figures. |
| Loading | Skeleton lines in the final layout. |
| Success, invalid | Not applicable. |

## Tokens
Panel: `surface`, `border-subtle`, `surface-subtle`, `ink`, `ink-secondary`. Band: `on-indigo-deep`, `sand`, `border`. Type: small 14/20, `money-total` 24/30 (28/32 in the band), closing line 16/22 700. Every ₦ figure is Newsreader 500: row values 16/20, the closing line's amount 20/26 (Hanken Grotesk has no ₦ glyph).

## Accessibility
- Rows are paired text; the closing line is bold, not colour-coded. Amounts use tabular figures.
- Money never uses `ink-muted` or the meta style.

## Rules
- Totals come from the domain projection, never computed in the browser or by the model.
- Never "from ₦…", never a nightly rate as the headline.

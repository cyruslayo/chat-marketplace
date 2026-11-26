Steps tell the guest what happens next, in order, so they know what the system does and what they have to do. They describe the process; they are not a progress tracker (the Journey rail is).

**Maps to:** `.ui-steps` and `.ui-steps__number` (shipped; markup from `stepsHtml` in `guest-kit.ts`). New: the Xenia look (Newsreader numerals in `sand-ink`, hairline rules) and `--compact` for chat cards.

## Anatomy
1. `<ol>` container with a 1px `ink` rule on top.
2. Item: a number and one sentence, with a `border-subtle` hairline below.
3. Number (`__number`): Newsreader 500, 24/24, `sand-ink`, lining figures. It is visible text, so the order also reads without the list semantics.
4. Text: one plain sentence (`<span>` or `<p>`), body 16/24 in `ink`.

## Variants
| Variant | Use |
| --- | --- |
| Default | Pages: Review request, Conditional Offer, Reservation confirmed, inside a panel or on the canvas. |
| Compact (`--compact`) | Chat cards and narrow side columns: 14/20 text, 20px numerals, tighter rows. |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus, busy, disabled | Not interactive, so none. A step may contain a link, which has its own states. |
| Success, invalid | Not applicable. Steps do not tick off; the Journey rail and the status word show where the guest is. |
| Stale | Not applicable; the copy describes policy, not live state. |
| Loading | Skeleton lines in the final layout, one per step. |

## Tokens
`ink` (top rule, text), `border-subtle` (rules between steps), `sand-ink` (numerals). Type: body 16/24 (14/20 compact); numerals `--font-display` 500 24/24 (20/20 compact).

## Accessibility
- An ordered list, so screen readers announce "list, 3 items". The visible number duplicates the list position; that is intended.
- `sand-ink` is only for the numerals, never for the sentence.

## Rules
- Three steps at most. Each step is one sentence that names who acts ("the Operator", "you").
- Never promise what the domain does not do: "Your dates are reserved only once you pay", never "Your dates are held" before payment.
- Copy comes from the same helper in chat and on the page.

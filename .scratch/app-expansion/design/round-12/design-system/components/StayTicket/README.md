The stay ticket is the one inverse surface in a booking: the stay's dates, party and total on indigo-deep, repeated unchanged from apartment detail to review, offer and confirmation, so the facts sit in the same place on every screen (R6).

**Maps to:** `.ui-ticket` with `__eyebrow` (new), `__name`, `__dates`, `__date`, `__date--end`, `__label`, `__day`, `__time`, `__arrow`, `__foot` (shipped). The money band inside it is the Price breakdown's `--band` variant.

## Anatomy
1. Eyebrow in sand: "Your stay", "Price for your dates", "The stay you asked for".
2. Name: the listing title (omitted on the apartment detail, where it is the page title).
3. Dates: check-in and check-out, each a label, a Newsreader day numeral and the full date ("Thu, 10 Sept 2026"), with a sand arrow between.
4. Foot: "3 nights · 2 guests · Entire place", or the booking reference once confirmed.
5. Money band (optional): Price breakdown `--band` below a dashed sand rule.

## Variants
| Variant | Use |
| --- | --- |
| Detail | Eyebrow "Price for your dates", band with the total and deposit. |
| Review | "Your stay", band with "If your request is accepted" and "Total to complete booking". |
| Offer | Band with the total, deposit and "Total to complete booking". |
| Expired | "The stay you asked for", no band. |
| Confirmed | Booking reference in the foot, band with "Refundable Security Deposit collected" and "Stay payment paid". |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus | Not interactive; a link inside uses the sand focus ring. |
| Loading | A card Skeleton of the same height. |
| Stale | The page's banner says the price changed; the band shows the new figures. |
| Busy, success, invalid, disabled | Not applicable. |

## Tokens
`indigo-deep`, `on-indigo-deep`, `sand` (eyebrow, arrow, rules: sand only on indigo-deep), `radius-lg`. Type: eyebrow 12/16 700 caps, name h3 19/26, day Newsreader 44/44, date small 14/20.

## Accessibility
- A `<section>` with `aria-label` ("Your stay"). Dates are text, read in order: label, day, full date.
- `on-indigo-deep` on `indigo-deep` and sand on `indigo-deep` both read above 10:1.

## Rules
- The same component on every booking screen; only the eyebrow and the band's rows change.
- The Refundable Security Deposit is always its own line, never added into the total.

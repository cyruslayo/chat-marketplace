A status word names the current state of one record in a word or two, with an icon, so the state never depends on colour alone.

**Maps to:** `.ui-status` with `--success`, `--warning`, `--info`, `--danger`, `--muted`.

## Anatomy
1. Icon, 20px: check (success), clock (warning), "i" (info), cross (danger), none (muted).
2. Word or short phrase from the vocabulary: "Confirmed", "Waiting for your check", "Declined", "Booking Request sent".

## Variants
| Variant | Use |
| --- | --- |
| Success | Confirmed, paid, recorded. |
| Warning | Waiting against a deadline, or overdue. Pair it with a Deadline. |
| Info | Waiting without a deadline on you ("Waiting for the Guest's receipt"). |
| Danger | Declined or failed. Never for expiry or overdue. |
| Muted | Past or ended records ("Past stay", "Offer expired"). |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus | Not interactive, so none. |
| Busy | Not shown. Pending work uses the warning or info variant with its own words. |
| Success | The success variant. |
| Invalid, disabled | Not applicable. |
| Stale | Not shown here; the page's stale banner covers it. |

## Tokens
`success`, `warning`, `ink-secondary`, `danger`, `ink-muted` (muted only; never for money, times or errors). Type: 14/20, 700 (muted 600).

## Accessibility
- Role: plain text inside its record. When it changes after an action, the surrounding outcome or banner announces it (`role="status"`).
- The word carries the meaning. The icon is `aria-hidden`.
- Not a target.

## Rules
- Use the canonical terms exactly: Booking Request, Conditional Offer, Reservation.
- A Booking Request never shows a success status: it is not a Reservation.

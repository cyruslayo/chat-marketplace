A chat card is a read-only summary the concierge places in the conversation, such as Your stays or a payment schedule, with at most one action that opens the full page; it decides nothing itself.

**Maps to:** `.ui-chat-card` with `__head`, `__title`, `__aside`, `__rows`, `__row` (new, shared). Under ADR 0108 it is a Tier 2 candidate: the Your stays card and the period payment card are its first two uses. The shipped Weaver surfaces are composed from catalogue components, so this component is their markup contract, not a new catalogue ID.

## Anatomy
1. Head: title ("Your stays", "Payment schedule") and an aside ("Needs your action first").
2. Body, one of: rows of links (Your stays), a Facts list and Price breakdown (payment schedule), an Empty state, or a Banner.
3. One action: a secondary or primary Button ("Open all 7 in Your stays", "Pay this period") that opens the existing page.

## Variants
| Variant | Use |
| --- | --- |
| List | Up to three rows, needs-action first, then a link to the full list. |
| Summary | Facts and money, then one action. |
| Empty | "No stays yet" with starters in the guest's voice. |
| Signed out | "Sign in to see your stays" and "Sign in"; the guest comes back to the conversation. |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus | On its rows and button. |
| Loading | Skeleton lines inside the card, with a named status line. |
| Error | A danger Banner inside the card: problem, effect, "Try again". |
| Stale | A note Banner: "This schedule is out of date…", then "Show the latest schedule". |
| Busy, success, invalid, disabled | Not applicable; the page it opens owns those. |

## Tokens
`surface`, `border-subtle`, `ink`, `ink-secondary`, `radius-lg`, `space-4`, plus the tokens of what it contains.

## Accessibility
- A `<section>` labelled by its title. Rows are links whose names include the status and deadline.
- Targets: rows are 44px; the button is 44px.

## Rules
- One action at most. No consequential command runs from a chat card: it opens the page that has it.
- Same content as the page, from the same helper (ADR 0080 parity).

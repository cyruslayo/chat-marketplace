A queue item is one row on the Operator home that needs action: what kind it is, which apartment and stay, its deadline in WAT, and one button.

**Maps to:** `.ui-queue-item` inside `.ui-queue`. Shipped: `.bo-waiting__item`.

## Anatomy
1. Kind line: the kind ("Booking Request to answer", "Manual transfer to verify", "Owner payout due", "Owner over-payment to recover", "Refund owed to the Guest"), plus any tag (Overdue, First reminder, Second reminder).
2. Title: apartment and stay dates, "2-bedroom apartment, Admiralty Way · Thu 3 Dec to Sun 6 Dec". Never a guest's name, never an internal id.
3. Detail: owner, amount, one supporting fact.
4. Deadline (the Deadline component).
5. Action: one button. Only the most urgent row's button is primary; the rest are quiet.

## Variants
| Variant | Use |
| --- | --- |
| Default | Due later. |
| First reminder, Second reminder | A Booking Request 10 or 25 minutes after delivery (in-page reminders, decision D2). |
| Overdue | `--overdue`: the Overdue tag, "Was due …", and first place. |
| No deadline | Refunds and over-payments: an info Deadline ("No deadline set"). They sort last, oldest first. |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus | On its button only. The row is not one big link, so the button keeps a clear name. |
| Busy | Not shown here; the action happens on the record's own page. |
| Success | The item leaves the queue when the record is decided. |
| Invalid, disabled | Not applicable. |
| Stale | The home is re-read on load. A row whose record was decided elsewhere opens to that record's stale state. |
| Loading | Row skeletons in the final layout. |

## Layout
One column below 640px (what, then deadline, then button). From 640px: what, a 210px deadline column, then the button.

## Tokens
`ink`, `ink-secondary`, `border-subtle`, `ink` (list top rule), the Deadline, Tag and Button tokens, `space-4`. Type: h3 19/26 600 for the title, small 14/20 for kind and detail.

## Accessibility
- The list is a `<ul>`; each item is an `<li>` whose title is a heading (h2 on Home).
- The button names the action ("Answer request", "Check transfer"). Add `aria-describedby` pointing at the title when several buttons read the same.
- Keyboard: Tab moves button to button, top to bottom, in deadline order.
- Targets: the button is at least 44px.

## Rules
- Sorted by deadline: overdue first, then the earliest deadline, then items with no deadline, oldest first.
- Not a metrics dashboard: no counts or trends beyond the number of items.

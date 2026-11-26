Verify a manual transfer puts the Guest's receipt beside the credit that should be in the business account, so confirming is a comparison, with "Confirm payment" as the one primary action and "Decline this transfer…" behind a closed disclosure.

**Maps to:** `manualTransferCard` (`local-owner-server.ts`, ADR 0090), laid out with `.ui-transfer`, `.ui-transfer__side`, the Receipt preview, a stacked Facts list, `.ui-panel--commit`, Disclosure confirm and `.ui-outcome`.

## Anatomy
1. Left (top on phones): the Receipt preview.
2. Right: "What should be in the business account": Exact amount, Reference, Owner, Stay, Verify by.
3. Confirm panel: helper text "Confirm only after you see the matching credit in the business account. The receipt alone is not proof of payment.", the "Bank transaction reference" field with its hint and no placeholder, the effect ("Makes the Reservation and tells the Guest it is confirmed."), and the primary "Confirm payment".
4. "Decline this transfer…" (Disclosure confirm) with the reasons "Not received" and "Amount doesn't match", its effect, and a quiet "Decline transfer".
5. After a decline or expiry only: "Money arrived after all…" with "Record late credit".

## Variants
Side by side from 768px (5 : 6 columns); stacked below, receipt first.

## States
| State | What changes |
| --- | --- |
| Idle (waiting for your check) | As above; status "Waiting for your check", deadline "Verify by 11:10 AM WAT". |
| Hover, focus | On the field, the buttons and the disclosure. |
| Busy | "Confirming payment…" with `aria-busy`; the field is locked. |
| Success | An outcome replaces both forms: "Payment confirmed · Reservation made", who and when, and the bank reference. |
| Invalid | Missing bank reference: field error "Enter the bank transaction reference from the business account."; nothing is changed. |
| Disabled | Waiting for the Guest's receipt: no forms, an info deadline "Guest must pay and upload by …". |
| Stale | Decided elsewhere: "This transfer changed since you opened it" plus who decided, "Your decision was not recorded, so it can't be decided twice." |
| Declined, expired | A declined outcome; the late-credit disclosure appears. |

## Tokens
Those of its parts: Receipt preview, Facts list, Button, Labelled field, Disclosure confirm, Banner. The layout uses `space-4`, `space-6`.

## Accessibility
- Two `<section>`s with headings ("The Guest's receipt", "What should be in the business account"), so a screen reader hears the comparison in order.
- Keyboard: receipt link, then field, then Confirm payment, then the Decline disclosure.
- Targets: 44px or more everywhere.

## Rules
- Never a guest's name: the record is titled by apartment and stay dates.
- Each form carries its version; a second submit is refused and changes nothing.

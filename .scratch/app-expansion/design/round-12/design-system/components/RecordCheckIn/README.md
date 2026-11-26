Record check-in is the booking detail's main action: the Operator says how access was verified and records Verified Access, which starts the 24 hours before the owner is paid.

**Maps to:** the check-in form in `checkInFormsHtml` (`local-owner-server.ts`), built from `.ui-panel--commit`, a choice `<fieldset>`, `.ui-effect` and a primary `.ui-button`.

## Anatomy
1. Title: "Record Verified Access".
2. Choice: "How was access verified?" with the two bases: "The Guest confirmed access to me directly", "I or platform staff handed over access at the unit".
3. Effect: "What this records": the Guest got in at the time you save, and the owner's amount becomes due 24 hours later. "The owner's word alone is not enough to record Verified Access."
4. Primary button: "Record Verified Access".

## Variants
| Variant | Use |
| --- | --- |
| Awaiting access | The form, at the top of the record under the stay facts. |
| Before the window | Not offered. The status says "Arriving from 2:00 PM WAT"; the code refuses earlier records ("Verified Access cannot be recorded before the Contractual Check-In Window begins"). |
| Recorded | The outcome panel: "Verified Access recorded · Thu 3 Dec 2026, 3:20 PM WAT, by Tunde". |

## States
| State | What changes |
| --- | --- |
| Idle | The form, with the ink-ruled commit panel. |
| Hover, focus | On the choices and the button. |
| Busy | The button reads "Recording…", `aria-busy`. |
| Success | Replaced by the recorded outcome (`role="status"`). |
| Invalid | No basis chosen: a field error under the legend; nothing is recorded. |
| Disabled | Not shown; outside the window the form is absent and the status explains why. |
| Stale | "This Reservation changed since you opened it. Review it and try again. Nothing was recorded." |

## Tokens
`surface`, `ink` (commit rule), `surface-subtle` (effect), `success`, `success-surface`, plus the Button and Labelled field tokens.

## Accessibility
- `<form>` labelled by its title; the bases are a radio group in a `<fieldset>`.
- Keyboard: Tab to the group, arrow keys between bases, Tab to the button, Enter to submit.
- Targets: each basis label and the button are at least 44px.

## Rules
- It is the only primary action on the booking detail. Complaints and refunds sit below it, in their own section.

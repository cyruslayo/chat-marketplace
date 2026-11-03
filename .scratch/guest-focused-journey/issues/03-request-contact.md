# 03 Request and contact repair

Status: claimed
Type: task
Blocked by: 02

## What to build

Give request review direct edits for trip and contact while retaining valid answers. Replace technical phone-format copy with a Nigerian example. Keep invalid input available for correction and return guests to their review task. Check actual screen-reader output for numbered steps before changing markup.

## Acceptance criteria

- AC1: Each editable review fact has a direct edit path that returns to the same draft with other valid facts retained; a superseded draft cannot submit.
- AC2: Phone entry uses plain guidance and a specific error, preserves the value after failure, and restores the review task after correction.
- AC3: Screen-reader output announces each step number once across request, waiting, offer, payment, and confirmation; required terms stay visible before submission.

## ADR map

0005/0041: draft and disclosed request differ. 0015/0016: review shows full price and deposit. 0075: contact remains private. 0077: chat/page facts match. 0078: labels and errors. 0080: conventional route. Read other intersecting ADRs before code.

## Tests and evidence

Write one named failing test per AC. Cover invalid contact, retained values, stale draft, and actual AX output. Run `npm run check` and affected tests, with one real-Chrome file at a time. Capture changed screens at four widths in light/dark. Record exact commands, counts, and Definition of Done review in Comments.

## Comments

### Implementation plan and ADR constraints

| ADR | Constraint | Acceptance/code path |
| --- | --- | --- |
| 0004, 0005, 0041 | Backend owns state; drafts hold no inventory. | AC1 edit and submit authority |
| 0012, 0013, 0085 | Retain self-booking; contact is not identity verification. | AC1 retained answers; AC2 guidance |
| 0015, 0016, 0089, 0092 | Requote changed stays; preserve canonical total, deposit and schedule. | AC1 review after edits |
| 0031, 0032, 0055, 0058 | Preserve arrival, checkout, horizon and cancellation disclosures. | AC1 validation; AC3 terms |
| 0070, 0072, 0074 | Use command handlers; refuse stale surfaces and foreign authority. | AC1 edit/submit |
| 0075, 0093 | Keep contact private; validate owned return destinations. | AC2 contact recovery |
| 0077, 0078, 0080 | Share content, preserve input, native routes and accessible numbering. | AC1-AC3 |
| 0106 | No model bypass; structured edit stays at the command boundary. | AC1 direct edit |

Read the ADR directory and relevant full decisions before implementation. Read both relevant CONTEXT.md files and repository standards.

### Implementation and verification

The review now has native date, guest-count, and phone edits. Trip edits create a replacement through existing quote and draft commands.
The replacement retains the Primary Guest, existing occupant names, Self-Booking attestation, and saved contact. The old draft cannot submit.
Structured dates, nights, and party size also reach the assistant's persisted facts under ADR 0106.
The phone form retains rejected input and uses shared Nigerian-number guidance. Its validated return path restores the owned review.
The shared steps helper now renders explicit number spans. Chromium's accessibility tree exposes each number once on both channels.

Additional ADR verification: 0006 preserves the Accommodation Provider disclosure. 0068/0069/0071/0073/0076/0079/0081/0102 preserve platform command controls and registered rendering.
ADR 0094 keeps contact distinct from identity assurance. No account or booking policy changed.
All constraints in the ADR table remain reflected in the implementation.

### Commands and results

- Red: `npx tsx --test test/guest-request-repair-chromium.test.ts` — 0 passed, 3 failed before product changes.
- Red: `npx tsx --test --test-name-pattern="AC1: direct request edits" test/assistant-cold-journey.test.ts` — 0 passed, 1 failed. Restored assistant nights were 3 instead of 4.
- `npm run build` — passed. Regenerated `apps/local-guest/dist/client.js` supplies the changed shared kit to the browser.
- `npm run check` — passed, zero TypeScript errors; Worker bundle guard passed.
- `npx tsx --test test/guest-request-repair-chromium.test.ts` — 3 passed, zero failed. Tests cover date edits, guest-count edits, stale drafts, invalid phone, native recovery, external return rejection, and both channels' accessibility trees.
- `npx tsx --test test/assistant-cold-journey.test.ts` — 4 passed, zero failed, including the corrected assistant fact persistence.
- `npx tsx --test test/guest-request-consistency.test.ts test/guest-contact-pilot.test.ts test/guest-kit.test.ts test/assistant-cold-journey.test.ts test/assistant-paystack-checkout-contact.test.ts test/guest-confirmation-system.test.ts test/guest-offer-consistency.test.ts test/guest-payment-consistency.test.ts test/guest-retired-classes.test.ts test/guest-account-page.test.ts` — 112 passed, zero failed.
- `npx tsx --test test/guest-request-consistency-chromium.test.ts` — 7 passed, zero failed.
- `npx tsx --test test/guest-offer-consistency-chromium.test.ts` — 5 passed, zero failed.
- `npx tsx --test test/guest-payment-consistency-chromium.test.ts` — 3 passed, zero failed.
- `npx tsx --test test/guest-confirmation-system-chromium.test.ts` — 3 passed, zero failed.
- `npx tsx .scratch/guest-focused-journey/capture-repair-03.ts` — 32 captures passed reflow and 44px target checks. These cover expanded review editors, phone entry, and phone errors.

Browser files and capture sweeps ran sequentially. Captures use 320, 390, 768, and 1280px in light and dark themes.
Screenshots remain local under `.scratch/guest-focused-journey/screenshots/03/`. No screenshots enter the commit.
Chromium accessibility-tree checks do not establish actual screen-reader speech. Real-device and assistive-technology checks remain evidence limits.

### Definition of Done review

1. Dedicated tests mirror AC1, AC2, and AC3. PASS.
2. Tests exercise invalid dates, changed guest count, stale draft, invalid phone, external redirect, cold restore, and duplicate-number failure paths. PASS.
3. Relevant ADRs were listed, read, mapped, and verified above. PASS.
4. No new constructor or injected dependency was added. PASS.
5. Existing domain commands provide all rules, prices, and limits. Shared content supplies new interface copy. PASS.
6. No credential, real contact, or restricted identity material was added to logs or records. PASS.
7. Type checks and affected tests pass. Full `npm test` and Workers gates remain the final batch gate under AGENTS.md Test scope.

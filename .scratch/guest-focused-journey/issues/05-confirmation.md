# 05 Confirmation hierarchy

Status: claimed
Type: task
Blocked by: 04

## What to build

Lead with the authoritative Reservation status, verified stay payment, separately collected deposit, reference, and arrival actions. Put full contract terms in a labeled details area. Keep physical access readiness distinct from booking confirmation. Use the same facts in chat and conventional pages.

## Acceptance criteria

- AC1: Confirmed state presents Reservation, Unit, dates, party, verified amounts, and reference in the same order across both channels; no unverified payment can render it.
- AC2: Arrival information and support remain easy to find, while full terms remain accessible in details without repeating the entire receipt.
- AC3: A confirmed Reservation does not claim physical access authority; 320px and screen-reader views retain all material facts.

## ADR map

0005: Reservation follows verified payment. 0015/0016: stay total and deposit distinct. 0077: canonical cross-channel facts. 0078: reflow and accessibility. 0080: conventional confirmation route. Read other intersecting ADRs before code.

## Tests and evidence

Write one named failing test per AC, including unverified payment and missing-access failure paths. Run `npm run check` and affected tests. Capture four widths in light/dark; test screen reader and 200% zoom. Record exact commands, pass counts, and DoD review in Comments.

## Comments

### Implementation plan and ADR constraints

| ADR | Constraint | Acceptance/code path |
| --- | --- | --- |
| 0004, 0005, 0006 | Domain-confirmed Reservation and Contract authorize confirmation; preserve the accommodation provider. | AC1 |
| 0015, 0016, 0089, 0092 | Verified stay payment and separately held deposit remain distinct; preserve period schedule. | AC1, AC2 |
| 0022, 0030, 0085 | Booking confirmation does not grant access; use existing support, without inventing arrival authority. | AC2, AC3 |
| 0031, 0032 | Show only projected dates and contractual checkout time. Never infer a unit's arrival window. | AC2 |
| 0058, 0059 | Preserve cancellation and conduct terms in accessible labeled details. | AC2 |
| 0074, 0075, 0077 | Retain fail-closed reads, privacy, and one shared canonical content/layout helper. | AC1-AC3 |
| 0078, 0080 | Preserve keyboard operation, accessible details, native routes, 320px reflow, and zoom. | AC2, AC3 |
| 0106 | Model output cannot establish booking or access authority; preserve assistant cold restores. | AC1, AC3 |

Listed the ADR directory and read the intersecting decisions and context vocabulary. Repository instructions and the PRD remain applicable.

Plan: add named failing tests. Move the reference after verified amounts, remove repeated receipt text from contract details, and expose arrival support.
Use a native details control for full contract terms. Use projected accessAvailability alone to describe availability; opaque references grant no authority.
No domain policy, payment command, protected-arrival route, or arrival window will be invented.

### Implementation and verification

The shared confirmation helper now puts the reference after verified amounts.
Arrival guidance and its conversation action precede native Full contract terms details.
The details retain provider, occupants, checkout, cancellation, conduct, Notice to End, and card metadata.
They omit the repeated receipt. Existing domain authorization still controls confirmation.
The arrival action uses the existing conversation route and chat focus behavior.
Projected accessAvailability remains authoritative. Missing or present opaque references never change that decision.
Every availability state retains the physical-access disclaimer. The screen does not claim to contain protected access instructions.

- Red: `npx tsx --test test/guest-confirmation-hierarchy.test.ts` — zero passed, three failed on order, arrival support, and access disclaimer.
- Green: `npx tsx --test test/guest-confirmation-hierarchy.test.ts test/guest-confirmation-system.test.ts test/guest-kit.test.ts` — 22 passed, zero failed.
- `npx tsx --test test/guest-confirmation-hierarchy.test.ts test/confirmation-schedule-link.test.ts test/render-booking-contract-weaver-a2ui.test.ts` — six passed, zero failed.
- `npx tsx --test test/guest-confirmation-hierarchy.test.ts` — three passed after adding complete fact-order and locked-reference assertions.
- `npm run build` passed. Only regenerated `apps/local-guest/dist/client.js` belongs in the commit.
- `npm run check` passed with zero errors, including Cloudflare TypeScript checks and the Worker bundle guard.
- `npx tsx --test test/guest-confirmation-system-chromium.test.ts` — three passed, zero failed. Checks cover exact channel parity, native details keyboard operation, accessibility-tree facts, 320px reflow at 200% CSS scale, and no-JavaScript routes.
- The first browser attempt passed two tests and failed one Chrome startup before page assertions. A full solo rerun passed.
- An added arrival-focus assertion initially used a button-only test helper on a link. Keyboard activation corrects that test invocation.
- Final `npx tsx --test test/guest-confirmation-system-chromium.test.ts` — three passed, zero failed, including arrival-link activation and composer focus.
- `npx tsx .scratch/guest-focused-journey/capture-05.ts confirmed` — 16 images at 320, 390, 768, and 1280px, both themes and channels. No overflow or small controls.

Captures remain untracked under `screenshots/05/`. The capture script remains untracked beside them.
Visual inspection covered the 320px light page and 1280px dark chat.
No shared CSS or shell layout changed, so the full unrelated screen sweep was not repeated.

### Definition of Done review

1. AC1, AC2, and AC3 each have a dedicated named test. PASS.
2. Failure coverage includes unverified payment, missing access references, locked availability with an opaque reference, and duplicate receipt text. PASS.
3. All ADRs in the table were read. The code preserves their constraints. PASS.
4. No dependency, service, constructor, or unused injected dependency was added. PASS.
5. Existing projections supply money, dates, status, access availability, and contract terms. No domain policy changed. PASS.
6. No credentials or restricted identity material entered logs or telemetry. Tests use synthetic data. PASS.
7. Type checks and affected tests pass. Full `npm test` and Worker tests remain the final batch gate under AGENTS.md Test scope.

Accessibility-tree and CSS-scale checks do not establish screen-reader speech or actual browser zoom behavior.
No real-phone, provider, or live-payment check ran. Independent review remains required; the issue stays claimed.
No push, merge, deployment, or remote mutation ran.

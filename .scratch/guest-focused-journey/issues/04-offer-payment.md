# 04 Offer and payment clarity

Status: resolved
Type: task
Blocked by: 03

## What to build

Group offer terms for reading, while keeping material acceptance terms visible. Display one authoritative absolute WAT deadline. Label acceptance as continuation to payment choice. Present available methods together and show switching only when the current payment state permits it. Verify late-payment and refund language against the actual reconciliation path.

## Acceptance criteria

- AC1: Offer terms, final amount, separate deposit, and WAT deadline appear in clear order in chat and conventional routes; raw ISO and policy IDs are absent from guest-facing copy.
- AC2: Offer acceptance describes the immediate next step and never implies a Reservation or completed payment.
- AC3: Available methods form one accessible choice group; each restriction is adjacent to its method, and unavailable choices cannot start a payment.
- AC4: Handoff, pending, failed, expired, and reconciliation states show only actions authorized by current state; a pending attempt cannot offer a conflicting method switch.
- AC5: Late-payment wording matches verified implementation and policy; no automatic refund or booking revival is promised without authority.

## ADR map

0015/0016: all-in price and separate deposit. 0044/0049: payment window and hosted checkout. 0074: stale action. 0075: no sensitive payment data in logs. 0077: canonical facts. 0078: WAT and accessibility. 0080: conventional payment route. Read ADR 0087/0090 and other intersecting records before code.

## Tests and evidence

Write one named failing test per AC. Cover card, provider transfer, manual transfer, pending, failure, expiry, and stale actions. Run `npm run check`, affected tests and matching Worker specs only if Worker code changes. Run changed real-Chrome files separately. Capture four widths in light/dark and record exact checks and DoD in Comments.

## Comments

### Implementation plan and ADR constraints

| ADR | Constraint | Acceptance/code path |
| --- | --- | --- |
| 0004, 0005, 0006 | Canonical state owns the offer, provider, and Reservation boundary. | AC1, AC2 |
| 0015, 0016, 0089, 0092 | Preserve final total, separate deposit, and period amounts. | AC1 |
| 0044, 0046, 0047 | Preserve the original deadline and one live attempt; refuse conflicting methods. | AC3, AC4 |
| 0045 | Late success must not revive inventory; refund lifecycle claims need evidence. | AC5 |
| 0049, 0087, 0088 | Card remains hosted; provider transfer remains capability-gated. | AC3, AC4 |
| 0090 | Manual transfer uses configured hours and receipt/credit verification, not receipt-based confirmation. | AC3-AC5 |
| 0058, 0059 | Keep cancellation and conduct terms visible; presentation cannot remove obligations. | AC1 |
| 0074, 0075, 0077 | Fail closed; retain privacy and cross-channel canonical facts. | AC1-AC5 |
| 0078, 0080 | Accessible choices, absolute WAT, and native command parity. | AC1-AC4 |
| 0106 | The model grants no payment authority; preserve cold restore behavior. | AC2-AC4 |

Listed the ADR directory and read relevant decisions. Reused the Shortlet and platform context vocabulary.

Plan: add named tests first. Group existing material terms without hiding them. Remove internal versions from visible cancellation copy.
Use one method fieldset and route each selection through its existing command. Remove method switching while the designated card attempt remains pending.
Use neutral late-payment review wording because manual late credit records refund debt, not completed payment to the guest.
The existing card webhook ignores unknown superseded references. This issue changes no reconciliation or refund commands.

### Runtime findings and implementation

Offer terms now use visible cancellation, conduct, and other-terms groups. No material acceptance term is collapsed.
The offer retains its canonical amount, separate deposit, and one absolute WAT deadline. The shared disclosure mapper removes the duplicate raw ISO timestamp.
Acceptance says "Accept and choose payment". The acceptance command does not create a payment attempt or Reservation.
All available methods use one named native radio group. Each method has adjacent guidance and a distinct accessible name.
Chat and conventional pages use the same choice helper. Card keeps its existing server-bound Weaver event; transfer choices use existing native commands.
Method dispatch rechecks current authority, capabilities, configured manual-transfer hours, and the live-attempt slot.
Pending attempts offer no conflicting method switch. A processing status link cannot reopen checkout when no conversation route exists.
No payment, refund, reconciliation, or inventory command changed.

Late-payment verification:

- `domains/shortlet/src/manual-transfer.ts` records `refundOwed` for a late credit. It does not execute a refund.
- `domains/shortlet/src/bank-transfer.ts` records a late refund and reconciliation entry. That path does not call a provider refund API.
- `apps/local-guest/src/guest-server.ts` ignores unknown card and transfer references in the Paystack webhook.
- Recorded pending refund state therefore says "recorded for review". Closed transfer and waiting copy requests review without promising automatic repayment.
- The existing provider-failure path can retain an initiated card attempt. The presentation keeps that attempt and offers no conflicting switch.

The requested presentation now states only the authority verified above. The reconciliation capability gaps remain unchanged.

### Commands and results so far

- Red: `npx tsx --test test/guest-offer-payment-clarity.test.ts` — 0 passed, 5 failed before product changes.
- Red: `npx tsx --test --test-name-pattern="AC4:" test/guest-offer-payment-clarity.test.ts` — 0 passed, 1 failed for the processing checkout link.
- `npm run check` — passed, zero TypeScript errors; Worker bundle guard passed.
- `npm run build` — passed; regenerated `apps/local-guest/dist/client.js`.
- `npx tsx --test test/guest-offer-payment-clarity.test.ts test/guest-offer-consistency.test.ts test/guest-payment-choice.test.ts test/guest-payment-consistency.test.ts test/phase4-booking-payment-presentation.test.ts test/assistant-cold-journey.test.ts test/assistant-paystack-checkout-contact.test.ts test/guest-kit.test.ts test/render-conditional-offer-weaver-a2ui.test.ts test/render-bank-transfer-weaver-a2ui.test.ts test/render-card-payment-weaver-a2ui.test.ts test/manual-transfer-with-receipt.test.ts test/paystack-transfer-adapter.test.ts test/guest-waiting-states.test.ts` — 76 passed, zero failed.
- `npx tsx --test test/guest-offer-payment-clarity.test.ts` — 5 passed, zero failed after card-only capability and processing-link checks.
- `npx tsx --test test/guest-offer-consistency-chromium.test.ts` — 5 passed, zero failed.
- `npx tsx --test test/guest-payment-consistency-chromium.test.ts` — 3 passed, zero failed.
- `npx tsx --test test/manual-transfer-copy-chromium.test.ts` — 1 passed, zero failed.
- `npx tsx --test test/guest-offer-payment-clarity-chromium.test.ts` — 1 passed, zero failed for chat/page parity, native manual dispatch, and retained card binding.

A final run of the last browser test will verify the refined accessible names and label sizes. The full capture sweep is in progress.


### Final verification and captures

- `npx tsx --test test/guest-offer-payment-clarity-chromium.test.ts` — 1 passed, zero failed after the final markup update. Chromium exposes three distinct radio names and one named group. Visible labels meet 44px targets. Card and manual actions retain their command paths.
- `npx tsx --test test/guest-payment-consistency-chromium.test.ts` — 3 passed, zero failed after placing current choices before future outcomes.
- `npx tsx --test test/guest-offer-payment-clarity.test.ts test/guest-kit.test.ts test/guest-payment-consistency.test.ts` — 21 passed, zero failed after the final layout update.
- `npm run check` and `npm run build` passed after the final product changes.
- No Cloudflare Worker source changed. Worker tests remain part of the final batch gate.

The full sweep produced 264 PNGs under `.scratch/guest-focused-journey/screenshots/04/`. All 21 groups completed at 320, 390, 768, and 1280px in both themes.
No screen had horizontal overflow. Sixteen findings concern hidden native radio inputs; their visible labels are the targets.
The payment-choice group was captured again after placing its controls before future outcomes. Representative offer and payment captures received visual inspection.
Screenshots and the copied full-sweep script remain untracked. Prior captures remain unchanged.

Exact PowerShell sweep command:

```powershell
$groups = @('chat-compare','chat-home','chat-results','chat-unit','search-page','unit-page','request-draft','request-review','request-sent','request-declined','request-expired','offer-live','offer-expired','payment-choice','bank-transfer','manual-transfer','manual-waiting','no-reservation','confirmed','error-page','no-js')
foreach ($group in $groups) { npx tsx .scratch/guest-focused-journey/capture-04.ts $group; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Final focused capture command: `npx tsx .scratch/guest-focused-journey/capture-04.ts payment-choice` — 16 images refreshed; no overflow or unexpected target finding.

### Definition of Done review

1. AC1-AC5 each have a dedicated named test. PASS.
2. Tests cover unavailable capabilities, manual-transfer hours, stale acceptance, pending attempts, actual failed verification, late reconciliation, and native dispatch. PASS.
3. Relevant ADRs were read and mapped. ADR 0085 also governs the corrected access-stage identity disclosure. All listed constraints remain intact. PASS.
4. No service, dependency, constructor, or unused injected dependency was added. PASS.
5. Existing policy and command boundaries own every price, deadline, capability, and payment transition. No rule was invented. PASS.
6. No credential or restricted payment data was added to logs or telemetry. Synthetic fixtures provided all test data. PASS.
7. Type checks and affected tests pass. Full `npm test` and Workers checks remain the final batch gate under AGENTS.md Test scope.

Chromium accessibility-tree checks do not establish actual screen-reader speech. Provider sandbox certification, live payment, and real-phone checks did not run.
The issue remains claimed for independent review. No push, merge, deployment, remote setting, or refund command ran.


### Independent review signoff

The independent reviewer approved `c523342..eb70378`. The reviewer ran 22 focused tests; all passed.
The parent confirmed that signoff before resolution.

## Answer

Offer terms now have visible reading groups, canonical prices, separate deposits, and one absolute WAT deadline.
Acceptance clearly continues to payment choice. Available methods share one accessible group across chat and conventional pages.
Current payment state controls every displayed action. Pending attempts offer no conflicting switch.
Late-payment wording describes verified review authority without promising automatic repayment or booking revival.

Implementation and verification: `eb70378`. Independent review passed 22/22 tests. Final batch gates remain deferred as recorded above.

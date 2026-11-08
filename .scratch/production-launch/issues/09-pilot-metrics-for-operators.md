# Pilot metrics operators can see

Status: resolved
Type: AFK
Blocked by: 04
Requested: 8 Nov 2026
Wraps: [pilot-launch-readiness/13](../../pilot-launch-readiness/issues/13-pilot-metrics.md) (its acceptance criteria apply; resolve both together)

## Parent

[PRD](../PRD.md), goal "operators must see value".

## Why

Operators and the owner judge the pilot by numbers: how many requests came, how fast they were confirmed, what was paid and what the owner is owed. Pilot 13 specifies the report; on Cloudflare it must read from the Durable Object, not a Node SQLite file.

## What to build

The pilot 13 report as a back-office page behind operator authentication (ADR 0086), reading the production store on both Node and the Worker. Define every metric name in `domains/shortlet/CONTEXT.md` before using it. Owner payables use the existing per-period payables (ADR 0089, 0092); Extended Stay periods may show as zero while issue 06 keeps them off.

## Acceptance criteria

- [x] AC1 to AC5: the five criteria of pilot-launch-readiness/13, one named test each.
- [x] AC6: The page works on the Worker (a `apps/cloudflare/test/*.spec.ts`).
- [x] AC7 failure path: the page refuses a request without operator authentication.
- [x] AC8: The page shows no guest contact, card or payment-reference material beyond what ADR 0075 and 0096 allow.

## ADRs to read

0075, 0086, 0089, 0092, 0096.

## Comments

- 2026-11-08 (agent): `GET /operator/metrics` renders the report behind the existing Operator session (ADR 0086), scoped to the owners the signed-in representative currently acts for (ADR 0082 grants; expired and revoked grants remove that owner's rows). One renderer is shared by Node and the Durable Object; the reader takes the same `SqlDatabase` and check-in store in both.
- Metric vocabulary was added to `domains/shortlet/CONTEXT.md` under "Pilot metrics" before use: Requests received, Confirmed share, Median time to confirm, Payment started/completed/expired/failed/refunded, Verified Access check-in, Incident, Incidents per stay, Relocation outcome, Refund amount paid to Guests / decided under a cancellation policy / recorded for refund, Margin earned, Owner payables due / paid / not yet due.
- Durable sources verified: requests `guest_booking_requests`; card `guest_checkout_sessions` (purpose stay) plus `guest_payment_journey_snapshots` compensation; manual transfer `manual_transfers`; Paystack transfer `bank_transfer_sessions`; check-ins and incidents `checkin_support_state`; refunds `guest_refunds`, `owner_payable_cancellations`, `guest_period_payment_refunds` and manual-transfer late credits; money from `listOwnerPayables` (booking snapshot plus `owner_payables`/`payouts`/`recoveries` ledger, ADR 0089/0092). Later-period refund records carry a card-path reference and no method attribute, so they are reported as recorded-for-refund rather than attributed to a method.
- **Relocations remain unavailable, never zero.** `apps/web/src/relocation-application.ts` defaults `cases` to `InMemoryRelocationRemedyRepository`, and no production composition (`apps/local-guest`, `apps/local-owner`, `apps/cloudflare`) constructs `RelocationApplication`; the legacy `RelocationManager` also keeps its commits in a Map. There is no durable relocation outcome or amount to count. The page states this with a reason. The owner decided (8 Nov 2026) to keep it unavailable here and track durable recording in follow-up issue 22; this issue does not invent a source.
- Payments/refund status is presented at the stage its durable source records it: manual late credits and period reversals are "recorded for refund", not proven received; cancellations are "decided", guest refunds are "paid"; pending card compensation is counted separately. The page never reports an unavailable metric as zero.
- Validation: `npm run check` clean. `npx tsx --test test/back-office-pilot-metrics.test.ts` 7/7. `npm run test:workers -- apps/cloudflare/test/pilot-metrics.spec.ts` 1/1. Affected back-office tests `test/back-office-home.test.ts` and `test/back-office-owner-payables.test.ts` 8/8 (15/15 in the combined run).
- Implementation commit `ad27c23`.
- 2026-11-08 (owner decision): keep relocation outcomes reported as unavailable in this issue, and record durable relocation outcome/amount storage as follow-up [issue 22](22-durable-relocation-outcome-recording.md). Issue 09 therefore does not add a relocation store or wiring.

## Answer

The pilot metrics page ships at `GET /operator/metrics` with every pilot-13 metric defined in `domains/shortlet/CONTEXT.md`, reading the authoritative store on Node and the Worker. Relocations are reported unavailable with a reason because no durable production record or wiring exists; the owner chose to keep that and follow up in issue 22. No guest contact, card detail or payment reference appears in the page. Wrapped issue pilot-launch-readiness/13 is resolved with this one.

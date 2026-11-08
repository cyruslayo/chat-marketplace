# Remove the production stubs in the back office

Status: resolved
Type: AFK
Blocked by: none
Requested: 8 Nov 2026
Wraps: [pilot-launch-readiness/20](../../pilot-launch-readiness/issues/20-remove-back-office-stubs.md) (its acceptance criteria apply; resolve both together)

## Parent

[PRD](../PRD.md), decision D6.

## Why

Operators decide on real Booking Requests from the back office. On main (16d592e) `apps/local-owner/src/local-owner-environment.ts` still hard-codes, in production composition:

- `trailing60dReliabilityRate: 0.98` (line 672) and the 12/12 reliability counts;
- `governmentIdVerified: true` (line 707);
- `phoneNumber: "+2348012345678"` (line 728).

An operator would call a fake number and see every guest as verified.

## What to build

See pilot-launch-readiness/20. In short: read guest contact from the stored guest contact, guest verification as ADR 0085 defines it at request time (verification moves to check-in), and operator reliability from stored bookings or the documented cold-start policy (ADR 0066, 0083). If an ADR leaves a value open, record the gap and ask the owner; do not invent one.

## Acceptance criteria

- [ ] AC1: The back office shows the guest's stored phone and email for a Booking Request, not a constant.
- [ ] AC2 failure path: a request with no stored contact shows that the contact is missing; it never shows a placeholder number.
- [ ] AC3: Guest verification at request time follows ADR 0085 and is never a hard-coded `true`.
- [ ] AC4: Operator reliability comes from stored bookings or the cold-start policy cited by ADR.
- [ ] AC5: A grep test fails if `+2348012345678` or `governmentIdVerified: true` appears in non-test production composition.

## ADRs to read

0066, 0083, 0085, 0086, 0091.

## Comments

### Implementation plan and ADR map (8 Nov 2026)

Owner answer in this conversation: **"Unavailable until 10"**. Before ten observed opportunities, show no reliability rate; observed counts remain zero, and the legacy trust-tier path stays Standard until an authoritative source is available. This is a display/cold-start decision, not permission to infer successful stays or payouts. ADR 0083 is explicitly superseded by ADR 0089; do not use its 60/180-day payout thresholds as production policy.

| ADR | Constraint | Acceptance criterion / path |
|---|---|---|
| 0004, 0095, 0101 | Booking Request and contact snapshots are authoritative in Shortlet SQLite; live Guest contact is PLATFORM-owned on Worker. | AC1–AC2: project stored `phoneNumber` and `contactEmailSnapshot`, with no placeholder or cross-tenant lookup. |
| 0011 as superseded by 0085 | Government ID is not required at request time; no verification claim without a result. | AC3/AC5: remove hard-coded verified result, preserve booking and check-in boundaries. |
| 0066, 0083 superseded by 0089 | Trust metrics only after ten observed opportunities; tier settlement rules no longer govern owner payouts. | AC4: cold-start shows unavailable, zero observed counts, and no fictitious rate; legacy trust tier stays Standard. |
| 0086, 0091, 0075 | Back-office access requires session/grants; identity and contact are restricted to authorized operator request pages, never logs or general projections. | AC1–AC3: scope contact to the already-authorized `getOperatorRequest` path and HTML-escape output. |

The existing Guest submission stores contact snapshots on the Booking Request, including contact email, before the Worker can read it through the owner environment's synchronous request application. Extend the operator-only projection, not guest artifacts or logs. Use the existing source and avoid a guessed remote synchronous contact adapter. Add criterion-named failure-path tests first.

### Evidence and checks (8 Nov 2026)

- AC1: the authorized HTML detail renders the request's distinct stored phone and its tenant-scoped private email snapshot; anonymous reads redirect, cross-tenant principals are refused, and general request lists contain neither contact. Private email lookup requires both request and tenant. The snapshot is recorded on disclosure; a later guest email change does not retroactively alter the request's submission snapshot.
- AC2: a legacy request with null stored phone and no email renders `Not on file` for both; no placeholder appears. The local-only demo simulator creates contactless synthetic requests explicitly, instead of pretending they have real Guest contact; production requests still fail closed on missing contact.
- AC3: the Operator environment supplies no invented identity verification result. ADR 0085 permits the unverified Booking Request; only check-in may eventually authorize access. The new named test confirms this request discloses with no false verification claim.
- AC4: the owner-approved cold-start result is zero **observed** opportunities/completions and `null` rates (unavailable), with a Standard legacy trust tier. The authority refuses an out-of-scope Operator. The legacy `number | null` rate contract requires non-null before either tier can progress. No missing completion is counted as a failure or invented as success. ADR 0089 supersedes trust-tier payouts; an authoritative aggregate after ten observed opportunities remains a distinct future improvement, not guessed in this issue.
- AC5: a source grep test forbids the two named stubs and the fabricated reliability figures in production composition.

Exact commands (each prefixed with `C:\Program Files\Git\usr\bin\env.exe -u LLM_API_KEY`; npm via `node C:\nvm4w\nodejs\node_modules\npm\bin\npm-cli.js`):

- `node --import tsx --test test/production-back-office-stubs.test.ts test/guest-contact-pilot.test.ts test/operator-request-inbox.test.ts test/back-office-home.test.ts test/back-office-confirm-decline.test.ts test/reserve-payout-trust.test.ts test/pilot-production-composition.test.ts`: 97 tests, 97 pass, 0 fail. Tests-first initial run: 1 pass, 4 fail against stubs. After changing the owner contact source, an affected back-office test exposed the local-only demo simulator's missing contact; adapted that simulator explicitly, then all 80 previously affected tests passed.
- `npm run test:workers -- apps/cloudflare/test/pilot-worker.spec.ts apps/cloudflare/test/demo-extended-stay.spec.ts`: 7 tests, 7 pass across 2 specs.
- `npm run check`: exit 0, zero type errors and Worker bundle guard clean.

Definition of Done review: (1) AC1–AC5 each has a distinct criterion-named `test()`; (2) anonymous/cross-tenant, missing contact, missing ID verification, absent reliability and bad source literals are exercised; (3) ADR table checked again against the private snapshot query, fail-closed scope, and nullable rates; (4) existing request store, application and session/grant boundaries reused; (5) the owner decided the only new cold-start presentation rule above; (6) guest contact is HTML-escaped and omitted from general artifacts, audits and logs; (7) scoped Node/Worker tests and type check pass. Full batch gate belongs to issue 12.

## Answer

The back office now shows contact recorded on the request (or explicitly missing), never asserts ID verification at request time, and treats reliability as unavailable without observed opportunities. Committed as `8fa90f5`; 97/97 scoped Node tests, 7/7 Worker tests and clean type check. The owner's cold-start decision and the supersession of ADR 0083 by 0089 are recorded above. Wrapped pilot issue 20 is resolved with the same evidence.

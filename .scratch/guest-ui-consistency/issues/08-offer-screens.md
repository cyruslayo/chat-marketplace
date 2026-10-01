# Offer screens: live and expired

Status: claimed
Type: task
Blocked by: 07
Requested: 29 Sept 2026

## Why

The Conditional Booking Offer shows a blue "Time left to accept and pay" box in the chat (`.waiting-panel`, from `guestWaitingGuidance("offer-payment-window")`) and a different layout on `/conditional-offers/:id`. In the design (`design/Offer`, `OfferExpired`), the deadline is the one warning banner.

## What to build

- **Live offer** (chat workspace and conventional page):
  - head: eyebrow "Conditional Booking Offer", title, success status pill ("The provider confirmed your dates", from existing copy)
  - `deadlineBannerHtml`: "Pay by <absolute WAT> · N minutes left", plus the existing consequence sentence
  - the ticket, and the breakdown with the amount-due line
  - a "Before you pay" card linking the offer's policies (cancellation, house rules) as the offer artifact exposes them. Only show links the artifact has
  - action bar: amount plus "Accept and pay" (the existing accept action and route)
- **Expired offer:** a danger status pill "Conditional Booking Offer expired", a neutral banner with the deadline that passed and "no payment was taken" (existing copy), the ticket, then "Back to your conversation" and "Find other stays"; the rail's failed step.
- The waiting guidance's outcomes and "meanwhile" lines move into the banner and a `.ui-steps` card. No `.waiting-panel` remains for offers.

## Acceptance criteria

- AC1: The live offer renders the same banner, ticket, breakdown, policies card and action in the chat workspace and on `/conditional-offers/:id`. Parity test.
- AC2: The deadline shows as an absolute WAT time plus the minutes left, taken from the offer's payment window, and updates as time passes (fixture clock). At or after the deadline, the expired screen renders instead (a lazy expiry check).
- AC3: The expired offer shows the failed rail step, no accept action, and both navigation actions. Failure path: posting accept after expiry is refused as today.
- AC4: Offers render no `.waiting-panel` and no info-coloured box. The banner uses `.ui-banner--warning` (update `guest-waiting-states-chromium.test.ts`).
- AC5: Without JavaScript, the offer page's accept form works and the expired page renders.

## ADR compliance

0078 (absolute deadlines), 0080, 0072, 0015, 0089.

## Comments

Implementation resumed after 07 and 10 resolved. PR 96 remains OPEN/unmerged; no rebase, push or merge. Orchestrated specification review completed; code investigation children exceeded the artifact size limit and supplied no usable evidence.

| ADR | Constraint | Affects |
| --- | --- | --- |
| 0006 | Preserve provider disclosure; offer is not a reservation | AC1, terms card |
| 0015, 0089 | Preserve projected totals and separate deposit; no recalculation | AC1, breakdown/action amount |
| 0044, 0045 | Server payment window; never revive expired payment authority | AC2–3, accept handler |
| 0070, 0072, 0074, 0075 | Owner/current authority, same command, validated escaped content | AC1/3/5, metadata/native POST |
| 0073, 0077, 0081 | Canonical artifact facts; unchanged Weaver Basic Catalog/bindings | AC1, shared presentation |
| 0078, 0079 | Absolute WAT plus server-clock countdown/refetch; 320px/44px | AC2/4, layout |
| 0080 | Native critical action reaches existing application command | AC5 |

AC4 warning banner applies to live offers; expired uses the explicitly specified neutral banner. Policy artifact exposes cancellation summary/version and conduct text, but no URLs: retain readable policy text and do not invent links. Existing action says “Accept Offer”; visible kit form will use the approved issue label “Accept and pay” while retaining its existing command.

### Regression investigation and validation

- The conventional booking-page test required the shared `data-page="booking-record"` marker; added it to the offer header, preserving the offer-specific state marker.
- The existing payment deadline assertion relies on its original non-countdown markup. Kept that exact shape for payment deadlines and only added the countdown wrapper to offers.
- Foundation CSS had been reformatted wholesale (lowercased color values and expanded compact rules), breaking exact-string tests for colors, deadline/layout rules, and design-system rules. Restored the prior CSS formatting and carried forward only the offer-specific rules. Guest-kit, payment-choice, receipt-layout, and design-system regression tests pass again.
- The check-in verification test's “no external identity-provider environment key” assertion matched the harness's `PI_REASONING_LEVEL` name because it contains `NIN`. Final suite invocations unset this harness-only variable; no product change was needed.
- Real-Chrome failures from the first phase-2 run were environment-related because `NODE_ENV` was not `test`. With `NODE_ENV=test`, all 1,221 phase-1 tests passed. One subsequent phase-2 run hit the documented flaky `listing-gallery-chromium` AC3 timeout; that file passed 5/5 in isolation, and the later actual `npm test` run passed both phases.
- Initial green command: `env -u PI_REASONING_LEVEL NODE_ENV=test npm test` — exit 0; phase 1: 1,221 passed; phase 2: 158 passed, 1 skipped, zero failures. Log: `.scratch/guest-ui-consistency/full-test-08-final2.log`. Superseded by the closure verification below.

### Closure review and evidence

An independent review found that chat deadline expiry left acceptance enabled when the authoritative refresh failed. Wrote the dedicated AC2 outage regression, observed its failure, then disabled both the visible form and retained Weaver button at zero. Failed refreshes retry at the existing five-second throttle only while that projection is connected. The browser never manufactures an expired domain state (ADR 0074/0079).

Additional intersecting ADRs discovered and read:

| ADR | Constraint | Affects |
| --- | --- | --- |
| 0014, 0058 | Show the canonical cancellation policy/version, not an invented policy or URL | AC1, policies card |
| 0031, 0032 | Retain projected arrival/checkout facts, without inventing times | AC1, shared ticket |
| 0059 | Preserve the artifact's standardized conduct rules | AC1, policies card |

Rechecked both ADR tables against the final paths: shared presentation reads artifact facts, kit markup escapes content, metadata validates internal routes, the owner/current-surface-checked native action reuses the platform handler, and expiry remains authoritative with material actions disabled during refresh failure. No ADR was overridden.

- Dedicated tests: `test/guest-offer-consistency.test.ts` (3) and `test/guest-offer-consistency-chromium.test.ts` (5). AC4's test is restricted to banner/waiting-box assertions; AC3 has its own named rail/navigation/refusal test.
- **Final exact staged-snapshot verification:** `npm run check` passes; `env -u PI_REASONING_LEVEL NODE_ENV=test npm test` exits 0, **1,221 non-browser + 159 Chromium passes, 1 pre-existing skip, zero failures**. Log: `.scratch/guest-ui-consistency/full-test-08-staged-final.log`. The staged tree was exported to an isolated temporary checkout so unrelated working changes were not tested as part of the commit. Prior temporary-checkout setup failures (missing Git metadata and screenshot directory) were corrected without product changes. The documented New-conversation flake passed in isolation; final full rerun is green. Focused staged run: 10/10 (`staged-focused-08.log`). Workspace full run was also green (`full-test-08-closure-green.log`).
- Scope: staged only issue-08 changes; left broad pre-existing formatting and unrelated search/payment rewrites in the working tree. No issue 09/11 changes, scratch deletions, diagnostic tooling/logs, push or merge are included.
- Visual evidence: 16 light captures in `screenshots/08/`, live/expired × page/chat × 320/390/768/1280; `capture-08.ts` checks overflow and 44px targets after fonts settle. All checks passed; representative images compared with `design/renders/Offer-light.png` and `OfferExpired-light.png`.
- Parent-owned Chrome DevTools verification used the isolated `issue08-closure-test` profile/context and fixture proxy `http://127.0.0.1:3033`. Tested `/conditional-offers/offer-b883d033-7a0e-40f3-86d0-0208c0b4e3ba` and `/?threadId=g-a75739d1-5a34-46ef-86d1-37b9e0f194dd`: live page, exact-deadline expiry, conversation recovery, expired chat failed rail, both navigation actions and absence of waiting panels. Console was clean and observed requests succeeded. Automated real-Chrome tests separately exercise native no-JS acceptance/expiry and failed-refresh retry. Fixture process stopped. No missing issue-08 checks; dark mode/final overall visual acceptance remains issue 11, out of scope.
- LSP probes were inconclusive for six TypeScript paths; the compiler is the clean typecheck evidence. Generic kit-innerHTML/static-icon/validated-URL findings were reviewed and marked false positives. The unchanged baseline validated-response-cast documentation finding was deferred without changing unrelated code.

### Definition of Done — checked explicitly

1. **PASS:** each AC has a dedicated `test()` named to mirror it (AC1 parity; AC2 absolute WAT/countdown/lazy expiry and outage retry; AC3 failed rail/navigation/accept refusal; AC4 no waiting/info box and warning banner; AC5 native no-JS form and expired page).
2. **PASS:** AC3 POST after expiry returns 409 and never accepts the offer; AC5 also refuses missing, duplicate, stale and cross-origin authority. AC2 outage fails closed and recovers via retry.
3. **PASS:** all intersecting ADRs listed/read above; constraints reverified against the implementation and cited here.
4. **PASS:** no new class or injected constructor dependency; all added helper inputs are used.
5. **PASS:** projected amounts, payment window, policies and conduct text retained; only approved UI labels used. No policy URL synthesized. The expired neutral-banner interpretation is recorded above.
6. **PASS:** reviewed changes add no audit logging or bearer/restricted identity material; browser tooling uses isolated fixture data and is not committed.
7. **PASS:** final exact staged-snapshot `npm run check` and full `npm test` exit 0 with zero errors/failures; one pre-existing browser skip documented.

# Navigation table and reachability check

Status: resolved
Type: task
Blocked by: none

## What to build

- `test/guest-navigation.test.ts` with one table of guest routes: path, kind (section, task, state) and expected exits, taken from `guest-server.ts` and the route modules.
- The test renders each route through the real handler (`guest-route-harness.ts`, `guest-stage-pages.ts`) and reads its links and forms.
- Today's gaps (no Help, no list) are recorded as expected gaps with the issue that closes each, so the table can only improve (a ratchet, like `state-machine-inventory.test.ts`).

## Acceptance criteria

- AC1: A guest route missing from the table fails the test.
- AC2: Every page has an exit that is not the browser's Back. Failure path: a fixture page without one is reported by name.
- AC3: No internal link leads to a route the server does not serve.
- AC4: Removing a recorded gap without fixing it fails; fixing it without removing the record also fails.

## ADR compliance

0072, 0074, 0078, 0080, 0107.

| ADR | Constraint | Affected code / AC |
| --- | --- | --- |
| 0078 | Accessible profile: screen-reader badge text (N11), non-Back exit (N2) | `evaluatePageNavigation` in `test/guest-navigation.test.ts` |
| 0080 | Deterministic parity: standard route per critical workflow | `GUEST_NAVIGATION_TABLE`, `discoverGuestGetRoutes`, live handler renders via `guest-route-harness.ts` & `guest-stage-pages.ts` |
| 0072 / 0074 | Task close changes nothing (N6); no unauthorized action (N8) | Documented in table kinds and task chrome checks |
| 0107 | Single registered domain shows no mode chooser, domain tag, or other domain name (N7) | Live N7 check across all 17 rendered guest routes |

## Answer

Built `test/guest-navigation.test.ts` with `GUEST_NAVIGATION_TABLE` covering all 17 live guest GET page routes (`/welcome`, `/`, `/conversation`, `/stays/search`, `/stays/:unitId`, `/booking-requests/drafts/:id`, `/booking-requests/:id`, `/conditional-offers/:id`, `/payments/offers/:id`, `/payments/offers/:id/transfer`, `/payments/offers/:id/manual-transfer`, `/booking-contracts/:id`, `/bookings/periods/:offerId`, `/bookings/notice/:offerId`, `/guest/contact`, `/account/sign-in`, `/account`), 14 allow-listed non-page GET routes (`NON_PAGE_GET_ROUTES`), and 6 planned rows (`/plans`, `/help`, `/plans/:id`, `/plans/:id/cancel`, `/plans/:id/change`, `/plans/:id/report`). Each live route is rendered through `sendGuest` (`test/helpers/guest-route-harness.ts`) and `withStagePage` (`test/helpers/guest-stage-pages.ts`) plus the Extended Stay server helper, checking exits, internal link/form targets, and rules N1–N11 against a strict ratchet (`unrecordedFailures` and `staleGaps` must both be empty).

## Comments

- Recorded current gaps with closing issues: `N1` (`/help` missing, issue 16) on all 17 live routes; `N3` (`/plans` missing, issue 11) on all 17 live routes; `N4` (section tab bar missing, issue 15) on `/`, `/conversation`, `/stays/search`, `/account`; `N2` (`renderGuestContactHtml` omits `appFrameHtml` / navigation exit link, issue 15) on `/guest/contact`; `N5` (`requestScreenHtml` draft uses `<h2>`, issue 15) on `/booking-requests/drafts/:id`. Zero `N4` task leakage and zero `N7`/`N11` violations on any live route.
- Commands and counts:
  - `npm run check`: exit 0 (`tsc --noEmit` across root + cloudflare tsconfigs + `node scripts/check-worker-bundle.mjs`)
  - `npx tsx --test test/guest-navigation.test.ts`: 5/5 passed (0 failed, 0 skipped)

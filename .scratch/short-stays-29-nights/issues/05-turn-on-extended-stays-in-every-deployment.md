# 05 · Turn on Extended Stays in every deployment, including production

Status: resolved
Type: task
Blocked by: 01
Requested: 1 Nov 2026

## Owner decision (1 Nov 2026)

Extended Stays (30 to 180 nights, ADR 0092 as amended 1 Nov 2026) are on in every deployment, including production and non-demo staging, not only in the synthetic staging demo.

## What to build

Today only the demo composition supplies an `ExtendedStayPolicy`:
- `apps/local-guest/src/fixture.ts:402`: `this.config.demo && this.config.deployment !== "production" ? (this.config.extendedStayPolicy ?? DEMO_EXTENDED_STAY_POLICY) : undefined`
- `apps/local-owner/src/local-owner-environment.ts:736`: the same condition.

Change:
1. `domains/shortlet/src/extended-stay.ts`: add `EXTENDED_STAY_POLICY` (30 / 180 / 30-night Billing Periods), citing ADR 0092 as amended 1 Nov 2026. Keep `DEMO_EXTENDED_STAY_POLICY` as an alias of it (same object) so existing imports keep working; update its comment.
2. Both compositions supply the policy in **every** deployment: `this.config.extendedStayPolicy ?? EXTENDED_STAY_POLICY`. Keep the startup refusal of demo mode in production (ADR 0105) exactly as it is.
3. Find every other place that gates Extended Stays on demo mode (search `config.demo`, `deployment !== "production"`, `isDemo`, `demo` near `extended`/`period`, in `apps/` and `domains/`, including `apps/cloudflare/src`) and list them in Comments. Remove the gate only where it gates Extended Stay booking behaviour; leave demo labels, synthetic data, test payments and the ADR 0105 notice alone.
4. **Cancellation and Notice to End terms** (`extended-stay.ts:67–73`, `extended-stay-changes.ts` `NOTICE_TO_END_DEMO_TERMS`): counsel approved the values (ADR 0092 amendment). Outside demo mode, show the same sentences with the prefix "Demo terms for a synthetic staging booking, pending counsel review:" removed, and nothing else changed. In demo mode keep a "Demo terms for a synthetic staging booking" prefix but drop "pending counsel review". Do not write any other new wording.
5. **Missed later payment:** unchanged. No code may end a stay, lock out, or change access for an unpaid period in any deployment; an overdue period only prompts human contact. The lawful process is still `[counsel text]` in ADR 0092.
6. **Not in scope:** licence-to-occupy contract wording and receipt fields (`[counsel text]`, monthly-stays issue 02). Do not invent them.
7. ADR 0092: under the 1 Nov 2026 amendment, add one bullet: "**Deployments.** Extended Stays are on in every deployment, including production (owner decision, 1 Nov 2026). Units must still opt in." Update the stale comment in `extended-stay.ts` that says production "receives no policy at all".

## Acceptance criteria

- AC1: A production composition (`deployment: "production"`, demo off) accepts a search, quote and Booking Request of 30, 90 and 180 nights at an opted-in unit, and refuses 181 nights.
- AC2: In production, a unit that has not opted in (or lacks Monthly Agreed Amounts or a utilities statement) never appears for 30+ nights.
- AC3: Demo mode in a production deployment is still refused at startup.
- AC4: Outside demo mode, the Extended cancellation terms and the Notice to End terms contain neither "Demo" nor "pending counsel review"; in demo mode they still start with "Demo terms for a synthetic staging booking".
- AC5: The Cloudflare Worker composition without `SHORTLET_DEMO=enabled` accepts a 30-night search at an opted-in unit (add a case to the matching `apps/cloudflare/test/*.spec.ts`; run it with `npm run test:workers -- <spec path>`).
- AC6: An overdue later period in a production composition ends nothing and changes no access; it is only listed for contact.

## ADR compliance

| ADR | Constraint | Where it bites |
|---|---|---|
| 0092 (amended 1 Nov 2026) | Extended Stay 30–180; unit opt-in; counsel-approved terms; `[counsel text]` items not invented | AC1, AC2, AC4, AC6 |
| 0105 | Demo mode refused in production; demo labels stay | AC3, AC4 |
| 0023 (amended) | Short Stay 1–29 | Boundary with AC1 |
| 0055 | 90-day horizon on check-in | 180-night stays may check out after day 90 |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record the exact test commands and pass counts in Comments.

## Comments

### 1 Nov 2026, implementation (Haiku 5.5 agent, branch feat/short-stays-and-extended-production)

**Files changed.** Domain: `domains/shortlet/src/extended-stay.ts` (`EXTENDED_STAY_POLICY`, `DEMO_EXTENDED_STAY_POLICY` as the same object, `extendedCancellationTerms(demoTerms)`, `noticeToEndTerms(demoTerms)`, stale comment fixed), `quote.ts` (`demoTerms` option on `createStayQuote`), `booking-request.ts` and `conditional-offer.ts` (`demoTerms` option, passed to the quote), `extended-stay-changes.ts` (`NoticeToEndManager` option; result field renamed `demoTerms` to `noticeToEndTerms`), `period-payment.ts` (comment only). Guest and owner compositions: `apps/local-guest/src/fixture.ts` (policy `config.extendedStayPolicy ?? EXTENDED_STAY_POLICY` in every deployment; `demoTerms = config.demo === true`), `apps/local-guest/src/shortlet-app.ts` (two display quotes), `apps/local-guest/src/assistant/shortlet-assistant-pack.ts` (one quote), `apps/local-owner/src/local-owner-environment.ts` (line 736 now `config.extendedStayPolicy ?? EXTENDED_STAY_POLICY`, plus `extendedStayPolicy` added to `LocalOwnerFixtureConfig`). `apps/web`: `booking-contract-artifact.ts` (4th argument `{ demoTerms }`), `booking-contract-application.ts`, `conditional-offer-application.ts` (type only). Docs: `docs/adr/0092-offer-extended-stays.md` (deployments bullet added under the 1 Nov 2026 amendment), `AGENTS.md` (Demo data bullet only: 119-day rule, 3 Sep 2027). Tests: `test/extended-stays-every-deployment.test.ts` (new, AC1 to AC4 and AC6), `apps/cloudflare/test/demo-extended-stay.spec.ts` (AC5 case added), and the corrected expectations listed below.

**Demo-gate survey (AC3 and step 3).** Every `config.demo` / `deployment !== "production"` / `demo` hit in `apps/` and `domains/` (including `apps/cloudflare/src`):
- `fixture.ts` ~402 and `local-owner-environment.ts` ~736: Extended policy gate. **Removed** (now every deployment).
- `fixture.ts` ~399 and `local-owner-environment.ts` ~619: ADR 0105 refusal of demo in production. **Kept** (AC3).
- `shortlet-app.ts` 2823, 3102, 3727, 3772, 3832, 3915, 3969; `guest-server.ts` 3726, 3747, 5606, 5642; `assistant/shortlet-assistant-pack.ts` 1079, 1085; `web-agent` unit-detail and discovery A2UI: demo listing labels and demo banner. **Kept** (labels).
- `shortlet-app.ts` 4946, `shortlet-stage-handlers.ts` 179 and 194, `fixture.ts` 749 and 764: demo request acceptor and its delay. **Kept** (not Extended behaviour).
- `apps/cloudflare/src/ops-routes.ts` 202 (ops demo routes) and 221 (`INVALID_DEMO_INVENTORY`): demo inventory and routes. **Kept**.
- `apps/pilot` config (`demoMode`, invite gate, banner): **Kept**.
- Policy-presence gates (not demo-specific, now satisfied everywhere a composition supplies the policy): `card-payment.ts` 321, `period-payment.ts` 109, `NoticeToEndManager.giveNotice`.

**Terms wording.** The issue's prefix text does not match the existing Notice to End string (`Demo Notice to End terms for a synthetic staging booking, pending counsel review:`). I used `Demo terms for a synthetic staging booking: ` as the demo prefix for both strings, so AC4 ("still start with 'Demo terms for a synthetic staging booking'") holds for both. Outside demo mode the Notice body is the same sentence with its first letter capitalised ("The stay ends 14 days after notice..."). Cancellation outside demo is the body unchanged. No other wording was added. Demo-mode constants `EXTENDED_CANCELLATION_DEMO_SUMMARY` and `NOTICE_TO_END_DEMO_TERMS` remain exported (values from the functions, `true`).

**Existing tests corrected (non-demo or production expectations made stale by this change).**
- `demo-extended-assistant.test.ts`: non-demo `search_stays.nights.maximum` 14 changed to 180 (test title updated). The issue allowed this one.
- `demo-extended-cancellation-notice.test.ts`: `artifactFor` helper now passes `{ demoTerms: true }` (it asserts demo wording).
- `demo-extended-stay-180.test.ts`: non-demo draft refusal regex also accepts `not configured for Extended Stay` (the unit has no opt-in, so that is now the refusal).
- `demo-extended-stay.test.ts` AC7: title and regex now say production needs an opted-in unit.
- `short-stay-29-nights.test.ts` AC2: production 30-night draft at a non-opted-in unit is refused with `not configured for Extended Stay` before inventory is blocked; title extended.

**Commands and counts (working tree, before commit).**
- `env -u LLM_API_KEY npx tsx --test test/extended-stays-every-deployment.test.ts`: 5 tests, 5 pass.
- `env -u LLM_API_KEY npx tsx --test test/short-stay-29-nights.test.ts test/demo-extended-stay.test.ts test/demo-extended-stay-180.test.ts test/demo-extended-assistant.test.ts test/demo-extended-cancellation-notice.test.ts test/extended-stays-every-deployment.test.ts`: 61 tests, 61 pass.
- Wide set (`ls test/demo-*.test.ts test/short-stay*.test.ts test/extended-*.test.ts test/pay-each-demo-billing-period.test.ts test/pilot-request-handler.test.ts test/confirmation-schedule-link.test.ts`, excluding chromium and real-browser names; 21 files): 145 tests, 145 pass. Before the test corrections the same set had 5 failures, all in the list above.
- Baseline before any change (10 of the affected files): 96 tests, 96 pass.
- `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts` (run from the repo root; the script is not in `apps/cloudflare`): 3 tests, 3 pass. AC5 is the case "AC5: The Cloudflare Worker composition without SHORTLET_DEMO=enabled accepts a 30-night search at an opted-in unit". It uses an isolated Durable Object (`isolatedTenantName`), because the shared one hit an operator-grant idempotency collision with the earlier case.
- `env -u LLM_API_KEY npm run check`: exit 0, zero type errors (run before commit; re-run on the committed tree below).
- Not run: full `npm test`, `npm run test:workers` (pre-merge, once per batch), and any chromium or real-browser file.

**ADRs applied.** 0092 as amended 1 Nov 2026 (30 to 180 nights in every deployment; unit opt-in; counsel-approved terms; no `[counsel text]` wording invented), 0105 (demo refusal in production kept; demo labels kept; demo prefix on terms), 0023 as amended (Short Stay 1 to 29, `MAX_STAY_NIGHTS` unchanged), 0055 (90-day horizon on check-in, unchanged). Overdue later periods: `PeriodPaymentManager` only projects and lists them (AC6). No code path ends a stay or changes access.

**Left undone or for the owner.**
- `NoticeToEndManager.giveNotice` still refuses with the message "available only in the staging demo (ADR 0105)" when no policy is supplied. That message is now stale. No composition constructs `NoticeToEndManager` (only tests do), so I did not change it. The owner should decide the wording.
- `local-owner-environment.ts` ~710 `createBookingRequestApplication` still receives no `extendedStayPolicy`, so an owner-side Booking Request of 30+ nights is still refused. The issue names only line 736, so I left it.
- ADR 0105's amendment text still says Short Stays remain 1 to 14 nights. That is pre-existing and outside this issue; not changed.
- The Worker spec ran from the repo root with `npm run test:workers -- <path>`; the filter worked.
- No deploy, push or merge was performed.

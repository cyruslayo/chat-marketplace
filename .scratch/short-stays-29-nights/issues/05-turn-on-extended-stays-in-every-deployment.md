# 05 · Turn on Extended Stays in every deployment, including production

Status: ready-for-agent
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

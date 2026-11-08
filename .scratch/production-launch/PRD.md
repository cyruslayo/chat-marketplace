# PRD: Production launch critical path (first paid Short Stay)

Status: ready-for-agent
Requested: 8 Nov 2026 (critical-path review of 2 Nov 2026, re-verified on main 16d592e)
Map: [map.md](map.md)

## Problem

The guest journey works end to end on Cloudflare staging (verified live 29 Oct 2026: search, View, Request, phone, Submit, Conditional Offer, Accept, email, Paystack test checkout, "Reservation confirmed"). Nothing is in production yet. What stands between staging and the first real guest is:

- a few code defects that are harmless with test money but not with real money or real operators;
- production configuration that is still a placeholder;
- real-world work only the owner can do (counsel, Paystack live, signed units, support);
- trackers that have drifted from the code, so nobody can trust a checklist built from them.

## Goal (the finish line)

A real guest books a real, inspected Lagos unit on the **production** deployment, pays real money, stays, checks out, and the operator sees the Booking Request, confirms it and has the owner payout recorded. That is `pilot-launch-readiness/15` (staffed dry run). Passing it, then opening to invited guests (`pilot-launch-readiness/12`), is launch.

Operators must see value: Booking Requests arrive by email during Active Hours, the back office shows real guest data, payouts are recorded, and pilot metrics are visible.

## Decisions taken for this path

The simulated expert panel ("council") approved the work. That settles open **decisions**. It does not replace real-world evidence (signed documents, a live Paystack account, inspected units). Each decision is recorded in issue 02 for the owner to confirm.

| # | Discrepancy found | Chosen path |
|---|---|---|
| D1 | Commit c32ed3a turned Extended Stays on in every deployment, but ADR 0092 forbids guest-facing behaviour that depends on **[counsel text]** until it is recorded in `monthly-stays/02` (still `ready-for-human`). | Launch **Short Stays (1-29 nights)**. Extended Stays fail closed in production until counsel's text is recorded (issue 06). Staging demo keeps them (ADR 0105). |
| D2 | Production is Cloudflare (ADR 0095), but `pilot-launch-readiness` 16/21/25 and `cloudflare-deployment/16` assume a Node pilot with live data to migrate. There is none. | Production is **Cloudflare only**. `cloudflare-deployment/16` closes as "no data to migrate"; keep only its DNS and Paystack URL steps. `cloudflare-deployment/17` (retire Node entry) is after launch. |
| D3 | Production origin is the placeholder `https://pilot.shortlet.example` (`apps/cloudflare/cloudflare.config.ts:43`). | Owner chooses the domain (issue 17); issue 07 wires it. |
| D4 | ADR 0046 says success on a superseded or expired reference is recorded and fully refunded. The code ignores it (known gap, tester notes 29 Oct). The webhook 200 was never proven. | Must fix before live keys (issue 05). Prove webhook delivery in the rehearsal (issue 18). |
| D5 | Conditional offers are signed with the literal `"conditional_offer_secret"` (`domains/shortlet/src/conditional-offer.ts:41,70`; `shortlet-concierge-launch/49`). | Must fix: a configured secret (issue 03). |
| D6 | Production back office hard-codes a guest phone, `governmentIdVerified: true` and reliability 0.98 (`apps/local-owner/src/local-owner-environment.ts:672,707,728`; `pilot-launch-readiness/20`). | Must fix (issue 04). |
| D7 | Same-day cutoff is a fixed 10:55 WAT; ADR 0053 wants it per unit (`shortlet-concierge-launch/48`). | Defer 48. Every pilot unit starts its check-in window at 14:00 (ADR 0031), so the fixed cutoff equals ADR 0053. Enforce at import (issue 08). |
| D8 | ADR 0088 offers card and transfer; Paystack Pay with Transfer (`shortlet-concierge-launch/47`, `guest-payments/02`) is not built; transfer references still contain `_` (ADR 0047). | Launch with **card** (Paystack hosted checkout) **plus manual bank transfer verified in the back office** (ADR 0090). Paystack Transfer is post-launch. |
| D9 | Shortlet 42-44 were closed on simulated evidence (`pilot-launch-readiness/02`). | Council approval settles decisions only; real-world items stay on the path (issues 13-16). |
| D10 | Trackers drifted: `WORK-MAP.md` is from 11 Oct; `assistant-runtime-hardening` 04-06 and `concierge-agent-controls` 01-05 read open or claimed but are merged; tester notes say a "104-day rule" (now 119). | One reconciliation pass first (issue 01). |
| D11 | Assistant parity: 01-03, 06-12, 14-17 resolved on main. 04, 05, 13 (relative date phrases, ranges, draft revision by chat) are `needs-triage`. | Not on the critical path. Testers use chips or explicit dates. Revisit after launch. |
| D12 | Operators must see Booking Requests within Active Hours (ADR 0042). Resend is unset on staging; the Worker refuses to start if `RESEND_API_KEY` is set without `SHORTLET_NOTIFICATION_FROM` and `SHORTLET_OPERATOR_ALERT_EMAILS`. | Production **requires** Resend and operator alert emails (issue 07). |

## Out of scope (after launch)

Guest accounts, stays and favourites, weaver catalogues, monthly-stays 04-16, assistant parity 04/05/13, Paystack Pay with Transfer, per-unit same-day cutoff (48), retiring the Node entry (cloudflare 17), multi-domain and commerce (stays off, ADR 0104).

## Working rules

Follow `AGENTS.md` and `CLAUDE.md`: per-issue `npm run check` plus the issue's own tests; full `npm test` and `npm run test:workers` once per batch (issue 12). The owner runs every Cloudflare command and approves every merge, push and deploy. Never open `staging-secrets.env` or any production secrets file; prefix commands with `env -u LLM_API_KEY`.

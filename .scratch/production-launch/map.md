# Map: production launch critical path

PRD: [PRD.md](PRD.md). Finish line: issue **20** (staffed dry run with one real paid booking), then **21** (open to invited guests).

## Order

```
Phase 0      01 reconcile tracker          02 confirm decisions (owner)
                                             │
Phase 1      03 offer secret ─────────┐      ├─► 05 late payments
(agents)     04 back-office stubs ─► 09 metrics
             10 logging, 11 thread ids (should-have)
                                       │      ├─► 06 Extended Stay gate
             17 domain (owner) ─► 07 production config
                                             └─► 08 14:00 window at import
             01 03 04 05 06 07 08 09 ─► 12 batch gate and merge

Phase 2      13 counsel ─► 14 Paystack live      (longest pole)
(owner,      13 ─► 15 units and ops pack
 parallel)   16 protection, ID, support rota

Phase 3      12 ─► 18 staging rehearsal ─► 19 production build, deploy, inventory ◄─ 14 15 17
                                           19 + 16 ─► 20 staffed dry run ─► 21 go and invite
```

Start now: agents **01, 03, 04, 10, 11**; owner **02, 13, 16, 17** (and start 14's paperwork early).

## Issues

| # | Issue | Type | Status | Blocked by |
|---|---|---|---|---|
| 01 | [Reconcile issue statuses and the work map](issues/01-reconcile-tracker-statuses.md) | AFK | resolved | none |
| 02 | [Confirm the launch decisions](issues/02-confirm-launch-decisions.md) | grilling | ready-for-human | none |
| 03 | [Conditional Offer signing secret](issues/03-configure-conditional-offer-signing-secret.md) | AFK | resolved | none |
| 04 | [Remove back-office stubs](issues/04-remove-back-office-stubs.md) | AFK | resolved | none |
| 05 | [Record and refund every success on a minted reference](issues/05-close-late-payment-gap.md) | AFK | ready-for-agent | 02 |
| 06 | [Extended Stays off in production until counsel text](issues/06-gate-extended-stays-until-counsel-text.md) | AFK | ready-for-agent | 02 |
| 07 | [Production configuration and descriptor check](issues/07-production-configuration-and-descriptor-check.md) | AFK | ready-for-agent | 03, 17 |
| 08 | [14:00 check-in window at import](issues/08-enforce-14-00-check-in-window-at-import.md) | AFK | ready-for-agent | 02 |
| 09 | [Pilot metrics operators can see](issues/09-pilot-metrics-for-operators.md) | AFK | resolved | 04 |
| 10 | [Request and assistant logging](issues/10-request-and-assistant-logging.md) | AFK | resolved | none |
| 11 | [Server-generated guest thread ids](issues/11-server-generated-guest-thread-ids.md) | AFK | ready-for-agent | none |
| 12 | [Batch gate and merge](issues/12-batch-gate-and-merge.md) | task | ready-for-agent | 01, 03-09 |
| 13 | [Counsel pack and recorded text](issues/13-counsel-pack-and-recorded-text.md) | task | ready-for-human | none |
| 14 | [Paystack live account](issues/14-paystack-live-account.md) | task | ready-for-human | 13 |
| 15 | [Sign and inspect first units](issues/15-sign-and-inspect-first-units.md) | task | ready-for-human | 13 |
| 16 | [Protection, identity at check-in, support](issues/16-guest-protection-identity-and-support.md) | grilling | ready-for-human | none |
| 17 | [Choose the production domain](issues/17-choose-production-domain.md) | grilling | ready-for-human | none |
| 18 | [Staging rehearsal with webhook proof](issues/18-staging-rehearsal-record.md) | task | ready-for-agent | 12 |
| 19 | [Production build, deploy, inventory](issues/19-production-build-and-inventory.md) | task | ready-for-agent | 14, 15, 17, 18 |
| 20 | [Staffed dry run](issues/20-staffed-dry-run.md) | task | ready-for-human | 16, 19 |
| 21 | [Go/no-go and invite guests](issues/21-open-to-invited-guests.md) | grilling | ready-for-human | 20 |
| 22 | [Record relocation outcomes durably](issues/22-durable-relocation-outcome-recording.md) | AFK | ready-for-agent | none |

## How to work an issue in a new session

1. Branch from current `main` (or the shared batch branch if one exists); one writer per worktree.
2. Follow AGENTS.md "Implementation protocol": read the issue and its wrapped issue, list and read the ADRs it names, tests first, then code.
3. Per issue: `npm run check` plus the issue's own and affected tests; record exact commands and counts in the issue's `## Comments`. Full suites run once, in issue 12.
4. Resolve by appending `## Answer`, setting `Status: resolved`, resolving the wrapped issue too, and adding a context pointer below.

## Context pointers (append as issues resolve)

- 01: [Reconciliation](issues/01-reconcile-tracker-statuses.md) audited 27 hardening/controls/demo issues against main, retained uncertain statuses with evidence, rebuilt the 356-issue [work map](../WORK-MAP.md), and corrected the tester-facing 119-day note. Evidence commit `71ccf94`; 4/4 criterion tests and clean type check.
- 03: [Signing-key implementation](issues/03-configure-conditional-offer-signing-secret.md) at `e9f109f`: one configured key in Node/Worker guest and owner, five secret descriptor bindings, true cold restore and wrong-key refusal. 88/88 scoped Node and 7/7 scoped Worker tests; clean type check. Wrapped review 49 retains its separate triage items.
- 04: [Back-office stub removal](issues/04-remove-back-office-stubs.md) at `8fa90f5` also resolves [pilot 20](../pilot-launch-readiness/issues/20-remove-back-office-stubs.md): stored request contact, no fabricated verification and unavailable reliability cold start under the owner decision. 97/97 scoped Node and 7/7 Worker tests; clean type check.
- 09: [Pilot metrics](issues/09-pilot-metrics-for-operators.md) at `ad27c23`, wrapping [pilot 13](../pilot-launch-readiness/issues/13-pilot-metrics.md): `/operator/metrics` behind Operator authentication, metrics defined in `domains/shortlet/CONTEXT.md`, durable sources on Node and the Worker. 7/7 Node, 1/1 Worker, 8/8 affected back-office tests; clean type check. Relocations are reported unavailable, never zero, pending the owner's source decision.
- 10: [Logging](issues/10-request-and-assistant-logging.md) at `7793c01`, wrapping [pilot 24](../pilot-launch-readiness/issues/24-structured-logging.md): one redacted `http_request` line per request, provider added to the assistant turn record, unhandled rejections by class. 4/4 Worker and 12/12 Node record tests; clean type check. Follow-up 22 records the owner's choice to keep relocation metrics unavailable until a durable relocation store exists.

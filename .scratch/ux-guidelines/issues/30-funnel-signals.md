# 30 · Privacy-safe funnel signals

Status: ready-for-human
Type: research
Blocked by: none
Phase: 5 (Batch E)
Applicable ADRs: 0075 (no identity material in logs); guideline §13 measurement plan

## What to build

- Find the existing telemetry: `assistant.control.outcome.v1`, `test/guest-transition-telemetry.test.ts`, and the Worker log events.
- Propose closed stage-id events for the §13 signals: search to detail, detail to request sent, offer to verified payment, draft correction category, stale-action recovery, and Operator response latency in aggregate.
- No raw messages, phone numbers, emails, references or tokens.

## Acceptance criteria

1. A table maps each §13 signal to an existing event or a proposed closed event
2. Every proposed field is a closed enum or a count, never free text
3. No code change is made until the owner approves the proposal

## Rules

- Research only: change no code, CSS, copy or tests. Phase 0 authorises no redesign (guideline §15).
- Synthetic data only. Never open `staging-secrets.env` or print the environment; prefix commands with `env -u LLM_API_KEY`.
- Run only one capture sweep or browser suite at a time. Delete any walkthrough log you create.
- Write matrix rows into `.scratch/ux-guidelines/evidence-matrix.md`, keeping what you saw (Observed) separate from what it means (Priority).
- Do not commit. The orchestrator reviews the work and commits it.

## Comments

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0075 | No identity material, raw message, credential or reference in logs. | Every proposed field below. |
| 0106 | The assistant's closed control outcome is the diagnostic of record. | Signals 1-2 read it rather than model text. |

### Existing telemetry found (AC1)

- **Domain transition events** (`domains/shortlet/src/*`, asserted by `test/guest-transition-telemetry.test.ts`): `unit.selected`, `request_draft.created`, `request_draft.review.opened`, `request_draft.blocked`, `booking_request.submission.attempted`, `booking_request.submitted`, `booking_request.confirmed`, `booking_request.delivery_failed`, `booking_request.declined`, `booking_request.expired`, `conditional_booking_offer.shown`, `conditional_booking_offer.acceptance_attempted`, `conditional_booking_offer.accepted`, `payment.attempt.initialized`, `payment.verified`, `reservation.confirmed`, `reservation.summary.rendered`.
- **Command rejections**: `interaction.duplicate_command_rejected`, `interaction.stale_surface_rejected`.
- **Shell fallbacks**: `interaction.conventional-route-fallback`, `interaction.weaver-rendering-failure`, `fallback-rendered`, `surface-replaced`.
- **Assistant diagnostics**: `assistant.control.outcome.v1` (`apps/local-guest/src/assistant/assistant-runtime.ts`), with closed outcome and denial reasons.
- **Worker logs**: `payment_continuation_rejected` and `card_checkout_failed` with a closed `statusClass` (ADR 0075).

### Proposed mapping (AC1, AC2)

| §13 signal | Existing or proposed | Fields (all closed or numeric) |
| --- | --- | --- |
| Search → results → detail | **Existing**: `unit.selected`; discovery produces a results artifact with no event today | `stage` (`discovery-results`, `unit-detail`), `resultCount` (count) |
| Detail → draft → request sent | **Existing**: `request_draft.created`, `request_draft.review.opened`, `booking_request.submitted` | `stage`, `draftRevision` (count) |
| Offer → payment start → verified payment | **Existing**: `conditional_booking_offer.acceptance_attempted`, `payment.attempt.initialized`, `payment.verified` | `stage`, `component` (`stay`, `security_deposit`), `providerOutcome` (`ok`, `rejected`, `unreachable`) |
| Abandoned draft with correction | **Proposed** `draft.correction` (new) | `category` (closed: `dates`, `guests`, `budget`, `contact`, `other`), `attempt` (count) — never entered values |
| Stale/expired action recovery | **Existing**: `interaction.stale_surface_rejected`, `interaction.duplicate_command_rejected`; **proposed** `recovery.outcome` | `reason` (closed code), `outcome` (`landed`, `retried`, `abandoned`) |
| Operator response latency | **Proposed** `operator.response.latency` (aggregate only) | `bucket` (closed: `<5m`, `5-10m`, `10-30m`, `>30m`), `count` |
| User prediction of next step | **Study only** (issue 29 observation sheet) | none — not telemetry |

### Guardrails (AC2)

- Every field above is an enum or a count. No free text, phone, email, reference, token, URL, id or provider response is emitted.
- Proposed events would be recorded by the same telemetry channel as the existing transition events, so the closed-field assertion in `test/guest-transition-telemetry.test.ts` can be extended to them.

### No code changed (AC3)

Research only. This proposal needs the owner's approval before any event is added; the new event names and the draft-correction categories in particular need sign-off, because `draft.correction` would record a new interaction point in the guest flow.

### Status

Ready for the owner's decision. Issues 29 (study), 31 (sign-off) remain owner-run.

## Answer

The §13 signals are already covered by the domain transition events, the interaction-rejection events, `assistant.control.outcome.v1` and the two closed payment log lines, with three gaps: discovery results production, draft corrections and Operator response latency. Three closed-enum events are proposed for those, each carrying only enums or counts; no code was changed pending owner approval.

---
status: accepted
---

# Permit a public staging demo with explicit exceptions

## Context

The owner wants visitors to try the Shortlet agent before the legal, verification, and processor gates close. The public demo uses synthetic units, GPT-6 Luna through OpenRouter, and Paystack test checkout. A public visitor can still enter real personal data. A notice reduces that risk but does not establish legal compliance. The owner accepted this exception in chat on 21 October 2026.

This decision applies only to the Cloudflare staging Worker with `SHORTLET_DEMO=enabled`. The production configuration must refuse demo mode at startup. No production deployment, live payment, real listing, or public commerce route is authorized.

## Decision

Permit anyone with the staging URL to start a demo session without a beta invite. Label every synthetic unit "Demo listing" and identify illustrative photos. Use a synthetic operator and synthetic verification claims. Use only Paystack test credentials, test transactions, and the published test card. Use OpenRouter only as the demo model processor for GPT-6 Luna. Tell visitors not to enter personal data and explain that listings and payments are demonstrations.

### Amendment (22 Oct 2026): staging Extended Stay limit

The owner authorizes the synthetic staging demo to accept Extended Stays of 30 to 180 consecutive nights. This exception overrides only ADR 0092's 90-night maximum, only when demo mode runs outside production. It does not change ADR 0092 for production or other non-demo deployments. The 90-day check-in horizon remains in force. Short Stays remain 1–14 nights, and 15–29 nights remain unsupported.

A demo stay of 180 nights contains six 30-night Billing Periods. Keep ADR 0092's first-period confirmation, separate later Period Payments, Monthly Agreed Amounts plus margin, shorter-final-period nightly pricing, 7-day due date, and 7/3/1-day reminders. Do not create recurring charges or collect more than the next payable period. The demo must use the domain quote, booking, payment and owner-payable paths. It must keep all operational data synthetic. Any production maximum above 90 nights requires counsel's review and a new owner decision.

For these synthetic demo bookings only, the UI and deterministic cancellation path may demonstrate ADR 0092's existing T-30/T-14 cancellation values and 14-day Notice to End. Mark them as demo terms; this does not satisfy counsel's approval. An overdue unpaid period may prompt human contact, but the demo must not lock out guests, change access, or run a termination process. The lawful process remains [counsel].

The owner knowingly defers the following requirements for this demo only:

| ADR | Deferred constraint | Reason |
| --- | --- | --- |
| 0008 | An in-person unit inspection before public discovery and requests. | Demo units are synthetic and cannot be inspected as real accommodation. |
| 0009 | A current, renewable inspection claim for each public unit. | Synthetic demo inspection claims do not represent a physical inspection. |
| 0010 | A CAC-registered, verified contracting operator with valid property authority. | The demo operator and its authority are synthetic; no real accommodation is offered. |
| 0065 | Real operator, property, inspection, licensing, insurance, and related verification before publication. | Demonstration inventory needs synthetic claims to exercise the existing eligibility path. |
| 0065 | Counsel, DPIA, vendor-role, cross-border, and retention gates before real-person processing. | Public access can bring unsolicited personal data before these reviews close. This exception does not establish compliance. |
| 0092 | The 90-night Extended Stay maximum and counsel approval before guest-facing cancellation and Notice to End behavior. | The owner authorized up to 180 consecutive nights for synthetic staging demo bookings only. Existing cancellation and notice values may be demonstrated with a clear demo label. Separate-period payments remain in force, and no missed-payment termination is allowed. |
| 0095 | The proposed processor scope of Cloudflare and Gemini, and the real-person staging data gate. | OpenRouter is a demo-only processor. Public visitors may enter personal data despite the notice. |
| 0104 | The proposed prohibition on public exposure of the development demo. | This public staging demo is the owner's explicit exception; commerce stays off. |

The following decisions remain in force:

| ADR | Kept constraint |
| --- | --- |
| 0005 | Request to Book still requires operator confirmation before payment and verified payment before reservation. The synthetic operator uses the real command path. |
| 0068 | Platform-owned adapters preserve the protocol and domain boundary; model content cannot become authority. |
| 0069 | The pinned interaction protocol and fail-closed event rules remain in force. |
| 0072 | Consequential actions use platform commands, authorization, confirmation, and audit. |
| 0075 | Restricted data and secrets stay out of interaction projections and logs. |
| 0079 | A model change requires replay, evaluation, and rollback evidence. |
| 0080 | Critical workflows retain deterministic routes; the agent cannot create financial or contractual state alone. |
| 0087 | Paystack remains server-authoritative; staging uses test credentials and a matching public callback origin. |
| 0095 | Cloudflare hosting and its backend authority remain in force. The data-protection gate remains for real launch. |
| 0092 | Monthly amounts, 30-night Billing Periods, first-period confirmation and separate later Period Payments remain unchanged, except for the staging demo maximum above. |
| 0104 | Commerce stays off in every public deployment. |

## Reversal before real launch

Remove `SHORTLET_DEMO` from deployment configuration. Delete the synthetic inventory and demo photos. Mark this ADR superseded before any real launch. Complete the deferred legal, processor, data-protection, operator, and unit-verification gates before real-person staging or production use under the ordinary policy. Production must continue to refuse demo mode.

## Consequences

The public demo exposes an acknowledged privacy and trust risk while the deferred gates remain open. The visitor notice is a mitigation, not a compliance finding. The demo cannot be used as evidence that any unit, operator, processor arrangement, or payment capability is approved for real launch.

## Related

ADRs 0005, 0008, 0009, 0010, 0065, 0068, 0069, 0072, 0075, 0079, 0080, 0087, 0092, 0095, and 0104; `.scratch/demo-launch/PRD.md` and issues 01 and 05.

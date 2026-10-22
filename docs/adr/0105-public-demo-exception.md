---
status: accepted
---

# Permit a public staging demo with explicit exceptions

## Context

The owner wants visitors to try the Shortlet agent before the legal, verification, and processor gates close. The public demo uses synthetic units, GPT-6 Luna through OpenRouter, and Paystack test checkout. A public visitor can still enter real personal data. A notice reduces that risk but does not establish legal compliance. The owner accepted this exception in chat on 21 October 2026.

This decision applies only to the Cloudflare staging Worker with `SHORTLET_DEMO=enabled`. The production configuration must refuse demo mode at startup. No production deployment, live payment, real listing, or public commerce route is authorized.

## Decision

Permit anyone with the staging URL to start a demo session without a beta invite. Label every synthetic unit "Demo listing" and identify illustrative photos. Use a synthetic operator and synthetic verification claims. Use only Paystack test credentials, test transactions, and the published test card. Use OpenRouter only as the demo model processor for GPT-6 Luna. Tell visitors not to enter personal data and explain that listings and payments are demonstrations.

The owner knowingly defers the following requirements for this demo only:

| ADR | Deferred constraint | Reason |
| --- | --- | --- |
| 0008 | An in-person unit inspection before public discovery and requests. | Demo units are synthetic and cannot be inspected as real accommodation. |
| 0009 | A current, renewable inspection claim for each public unit. | Synthetic demo inspection claims do not represent a physical inspection. |
| 0010 | A CAC-registered, verified contracting operator with valid property authority. | The demo operator and its authority are synthetic; no real accommodation is offered. |
| 0065 | Real operator, property, inspection, licensing, insurance, and related verification before publication. | Demonstration inventory needs synthetic claims to exercise the existing eligibility path. |
| 0065 | Counsel, DPIA, vendor-role, cross-border, and retention gates before real-person processing. | Public access can bring unsolicited personal data before these reviews close. This exception does not establish compliance. |
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
| 0104 | Commerce stays off in every public deployment. |

## Reversal before real launch

Remove `SHORTLET_DEMO` from deployment configuration. Delete the synthetic inventory and demo photos. Mark this ADR superseded before any real launch. Complete the deferred legal, processor, data-protection, operator, and unit-verification gates before real-person staging or production use under the ordinary policy. Production must continue to refuse demo mode.

## Consequences

The public demo exposes an acknowledged privacy and trust risk while the deferred gates remain open. The visitor notice is a mitigation, not a compliance finding. The demo cannot be used as evidence that any unit, operator, processor arrangement, or payment capability is approved for real launch.

## Related

ADRs 0005, 0008, 0009, 0010, 0065, 0068, 0069, 0072, 0075, 0079, 0080, 0087, 0095, and 0104; `.scratch/demo-launch/PRD.md` and issue 01.

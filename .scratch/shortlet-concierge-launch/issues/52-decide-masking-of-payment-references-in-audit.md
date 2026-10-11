# Decide how payment references are kept out of audit and telemetry

Status: ready-for-human
Type: HITL
Requested: 11 Oct 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## Why

`docs/agents/coding-standards.md:17` says bearer credentials must never appear in audit logs, interaction state or logs, and it lists payment references among them. Store a hash or omit them. The only exemption is ADR 0096, which covers the private Cloudflare daily export and nothing else (`docs/adr/0096-export-payment-references-in-plaintext.md`).

Two places in the platform-core reconciliation code write payment references into audit entries unmasked, and the redactor does not cover them:

- `packages/platform-core/src/reconciliation.ts:245` and `:251` build `reservationId = res-${payload.transactionRef}` and write it with `transactionRef` (lines 232 and 256 are the `providerReference` writes in the same methods). `reconcileLatePayment` is at line 215 and `reconcileDuplicateCallback` at line 240.
- `transactionRef` is a payment reference. The platform's own references are minted as `psp_ref_<commandId8>_<timestamp>` (`domains/shortlet/src/card-payment.ts:333`) and sent to Paystack as the transaction `reference` (`apps/web/src/card-payment-application.ts:76`, `pspReference`). The reconciliation methods have no production caller in this repository (only tests call them), so the webhook source of `transactionRef` is unverified.
- `providerReference` holds the PSP's own reference. For Paystack it is the value returned as `pspReference` (`domains/shortlet/src/paystack.ts:200`; the initialization reference echo is checked at `:173`). It is not in `sensitiveKeys` (`packages/platform-core/src/redaction.ts:2`), so it is written to audit unmasked.
- The generic redactor cannot fix this on its own. `res-<ref>` and a bare `providerReference` are not `<prefix>-<uuid>` platform ids, so issue 50's exemption table does not cover them. Adding `providerReference` to `sensitiveKeys` would mask it, but `res-${transactionRef}` would keep the reference in its string.

Issue 50 found this and recorded it as a follow-up ("Payment references in audit"). The choice between mask, hash and keep changes what reconciliation can search by, so it is a product and compliance decision, not a code fix.

## Question for the human

1. For `providerReference` (the PSP's reference) in audit rows: mask it to `[REDACTED]`, store a one-way hash, or keep it plaintext as the ADR 0096 export does?
2. For `transactionRef` and `reservationId = res-${transactionRef}` in `reconciliation.ts`: mask, hash, or keep? Is a hash acceptable as the reconciliation search key (ADR 0096's reconciliation argument says a one-way hash cannot serve the Paystack lookup)?
3. Should the rule be extended by ADR (for example, a new exemption like ADR 0096 but for audit) or should the coding standard be applied as written?
4. Can the webhook or caller that supplies `transactionRef` be named? If none exists in production, should the two methods be removed until a caller exists (AGENTS: no speculative dependencies)?

Status stays `ready-for-human` until questions 1 to 3 are answered. Question 4 can be answered separately.

## Once decided (for the implementing agent)

- Apply the decided treatment in `reconciliation.ts` and in `packages/platform-core/src/redaction.ts` (`sensitiveKeys`) or in a hash helper, not in a second redactor (ADR 0075).
- Add one named test per decided rule: the audit entry for `reconcileLatePayment` and `reconcileDuplicateCallback` contains no raw payment reference; the reconciliation lookup still works under the decided treatment.

## ADR compliance

| ADR | Constraint | Affected path |
| --- | --- | --- |
| 0075 | Secure and minimise agent-interaction data; one redactor for audit, telemetry and projections | `reconciliation.ts:215-256`, `redaction.ts:2` |
| 0096 | Exemption for payment references in the private daily export only | Not applicable to audit rows |
| 0045, 0089 | Late and duplicate payments are refunded or reconciled; de-duplication needs the exact reference | `reconciliation.ts` duplicate callback path |
| 0087, 0088 | Paystack is the payment provider; the Paystack reference is the search key | `card-payment.ts:333`, `card-payment-application.ts:76` |

## Comments

- 11 Oct 2026, filed from issue 50 (`.scratch/shortlet-concierge-launch/issues/50-keep-platform-ids-intact-under-card-redaction.md`), Q1, Q2 and the follow-up "Payment references in audit". Line numbers re-checked on `origin/main` 8b23923: `reconciliation.ts:215, 232, 240, 245, 251, 256`; `paystack.ts:173, 200`; `card-payment.ts:333`; `card-payment-application.ts:76`; `redaction.ts:2`.
- Correction: the `paystack.ts:173` citation in issue 50 is the initialization reference check (`data?.reference`), not the verification result. The verification result is `pspReference: returnedReference` at `paystack.ts:200`.

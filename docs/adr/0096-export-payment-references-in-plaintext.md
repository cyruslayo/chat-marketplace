---
status: accepted
---

# Export payment references in plaintext to the private daily export

**Accepted as an exemption (10 October 2026).** The user chose Option A below. This record is a documented exemption from the bearer-credential rule in `docs/agents/coding-standards.md` (Security and Audit records), which AGENTS.md points to, for the four payment-reference columns listed under Context, and only in the private daily export. The rule stays in force for every other store, for audit records and for logs.

## Context

The Cloudflare daily export (issue 12a, widened by issue 16, `apps/cloudflare/src/do-export.ts`) copies every application table, except the five bearer-credential tables, to the private `EXPORTS` R2 bucket. It writes each table's rows in the transport encoding the import route reads, so a day's files can be loaded back.

Four of the exported columns hold payment references:

- `guest_checkout_sessions.psp_reference` (`domains/shortlet/src/guest-interaction-store.ts`);
- `guest_processed_psp_references.psp_reference`, the table that de-duplicates processor webhooks;
- `bank_transfer_sessions.transfer_reference` (`domains/shortlet/src/bank-transfer.ts`);
- `pspReference` inside `audit_log` payload JSON.

The coding-standards rule (`docs/agents/coding-standards.md`, Security and Audit records) treats payment references as bearer credentials. They must be stored as a hash or omitted from audit records. Audit records must not record financial references (ADR 0075).

The export is a restore and reconciliation source. It must hold exact values for two reasons:

- **Restore and de-duplication.** After a rebuild, `guest_processed_psp_references` must still reject a webhook that was already processed (ADR 0045, ADR 0089). A rebuild that loses the exact values cannot rebuild that check from the export.
- **Reconciliation.** The restore runbook (sections 3 and 10, cutover runbook step R7) reconciles money against the Paystack dashboard and API. The reference is the search key for that work, so a one-way hash cannot serve it.

The conflict is therefore between the coding-standards rule and what restore and reconciliation require. It is not a question of whether the export may hold these fields at all.

## Decision

The daily export keeps the four payment-reference columns in exact plaintext. The exemption covers those columns in that export only. Audit records (including `audit_log` payload JSON), logs, interaction state and every other store still follow the coding-standards rule and ADR 0075.

The exemption is conditional on these four conditions. Each is a launch condition, and the export must not be relied on for real-person data until they hold:

1. **Private bucket.** The `EXPORTS` R2 bucket stays private, with no public access and no public bucket URL.
2. **Named access.** Read access to export objects is limited to named operators who need it for restore or reconciliation. No other principal is granted access.
3. **Retention.** Retention stays at the existing 400-day default (`DEFAULT_EXPORT_RETENTION_DAYS` in `apps/cloudflare/src/cloudflare-config.ts`). A longer period needs a new decision recorded here.
4. **Revisit before real data.** Encryption at rest (Option B) must be revisited, and this exemption re-reviewed, before real customer or real-person data enters the export. That review is tied to the ADR 0095 production gates (Nigerian counsel, cross-border transfer basis, vendor terms and DPIA). Until those gates clear, the export holds synthetic or staging data only, as ADR 0095 allows.

### Amendment (23 Oct 2026): later Billing Period payment records

The owner decided in chat on 23 October 2026 that the three later-period payment tables are exported to the same private daily export, with their payment references and guest contact emails in plaintext. The tables are `guest_period_payment_sessions`, `guest_period_payments` and `guest_period_payment_refunds` (demo-launch issue 10, ADR 0092 later Period Payments). This amendment is narrow:

- **Exempted columns (exact):** `guest_period_payment_sessions.psp_reference`, `guest_period_payments.psp_reference`, `guest_period_payment_refunds.psp_reference`, and `guest_period_payment_sessions.contact_email`. The contact email is personal data, not a payment reference; the owner's decision names it expressly. No other column of these tables is exempted by this amendment.
- **Conditions:** conditions 1 to 4 above apply to these tables in full.
- **Nigerian counsel sign-off: PENDING.** It has not been obtained. Production use of the period payment records, and of this export of their references and contact emails, is gated on that sign-off, alongside the ADR 0095 gates. Until it is recorded here, the export holds synthetic or staging data only.
- **Effect on restore:** a restore from the daily export now carries later-period payment records, including the paid period 2 record, under this exemption. The round trip is tested in `apps/cloudflare/test/restore-from-export.spec.ts`.
- **Not changed:** audit records, logs, interaction state, and every other store still follow the coding-standards rule and ADR 0075.

## Options considered

| Option | What it does | Status | Reason |
| --- | --- | --- | --- |
| A. Exemption | Record an explicit ADR exemption for these four columns only. The export stays plaintext in the private, access-controlled `EXPORTS` bucket (ADR 0095), under the four conditions above. | **Accepted** | Keeps restore, de-duplication and reconciliation working. Staging data is synthetic until the ADR 0095 gates clear, so the residual risk is controlled for now. Revisited under condition 4. |
| B. Encrypt at rest | Encrypt these four fields in the export with a key held as a Worker secret, decrypt on restore and reconciliation. | Rejected for now; revisit under condition 4 | Would add key management, a rotation plan that does not exist yet, and a restore step that needs the key. A key leak exposes the same values, so it moves the risk rather than removing it. The user judged this unnecessary while data is synthetic. |
| C. Keyed hash | Replace each reference with an HMAC. Use it for de-duplication only. | Rejected | Reconciliation against Paystack would need plaintext from another source, which the export would no longer hold. It does not meet the reconciliation requirement. |

## Consequences

- The coding-standards rule still applies in full to audit records, logs, interaction state and all other stores. `docs/agents/coding-standards.md` carries a pointer to this exemption, so the exception is visible where the rule is read.
- No code change is needed for Option A. `apps/cloudflare/src/do-export.ts` already exports the columns in plaintext, and no test asserts hashing. Option B's restore test that decrypts is not needed unless condition 4 changes the decision.
- The DPIA entries for the exported personal-data columns (issue 12a) must list these four columns. That is open work under the ADR 0095 gates.
- ADR 0090 (receipts) and ADR 0045/0089 (money evidence) are not changed by this decision.

## Related

ADR 0045, ADR 0075, ADR 0089, ADR 0090, ADR 0093, ADR 0095. Issue 12a (daily export), issue 16 (cutover, export scope D1 to D4).

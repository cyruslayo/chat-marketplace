---
status: proposed
---

# Export payment references in plaintext to the private daily export

**Needs user decision.** This record is a proposal for a conflict found in the wave-6 review. It is not accepted. The AGENTS.md coding-standards rule stays in force until the user chooses an option and this record is updated.

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

## Options

| Option | What it does | Keeps restore and reconciliation | Cost and risk |
| --- | --- | --- | --- |
| A. Exemption | Record an explicit ADR exemption for these four columns only. The export stays plaintext in the private, access-controlled `EXPORTS` bucket (ADR 0095). | Yes | Accepts a documented departure from the coding-standards rule. Needs the access controls and their review recorded. Keeps plaintext copies in R2 for the export retention period (400 days by default, a user-approved value). |
| B. Encrypt at rest | Encrypt these four fields in the export with a key held as a Worker secret, decrypt on restore and reconciliation. | Yes, for holders of the key | Adds key management, rotation and a restore step that needs the key. A key leak exposes the same values, so this moves the risk rather than removing it. Needs a key-rotation plan. |
| C. Keyed hash | Replace each reference with an HMAC. Use it for de-duplication only. | De-duplication only | Reconciliation against Paystack would need the plaintext from another source, which the export would no longer hold. Does not meet the reconciliation requirement. |

Option C is listed for completeness. It does not meet the reconciliation requirement, so it is not recommended on its own.

## Decision needed

The user chooses one of:

1. Option A, with the access controls and review recorded in this ADR.
2. Option B, with the key-management and rotation plan recorded in this ADR.
3. Another option the user specifies.

Until then, the export keeps the current plaintext behaviour, and the production gate in ADR 0095 (counsel, transfer basis, vendor terms, DPIA) still applies to any real-person data.

## Consequences (any option)

- The export test in `apps/cloudflare/test/production-composition.spec.ts` and the restore runbook need a matching change for the chosen option. Option B also needs a restore test that decrypts.
- The DPIA entries for the exported personal-data columns (issue 12a) list these four columns once the option is chosen.
- ADR 0090 (receipts) and ADR 0045/0089 (money evidence) are not changed by this decision.

## Related

ADR 0045, ADR 0075, ADR 0089, ADR 0090, ADR 0093, ADR 0095. Issue 12a (daily export), issue 16 (cutover, export scope D1 to D4).

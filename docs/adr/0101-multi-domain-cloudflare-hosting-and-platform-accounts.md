---
status: accepted
---

# Host multiple domains on Cloudflare with a platform Durable Object and platform-owned accounts

## Context

ADR 0095 hosts the pilot on Cloudflare as one SQLite-backed Durable Object per tenant. The Worker is a router only, and the browser is not an authority for transaction state (ADR 0004). Today that single object (`ShortletPilot`, `apps/cloudflare/src/shortlet-pilot-do.ts`) holds the whole schema, and `apps/cloudflare/src/worker.ts` forwards every request to `env.SHORTLET`.

A conversation that spans two domains, and one sign-in that serves both, need a platform home that is not inside a domain pack (ADR 0099). Commerce is now the second domain (ADR 0100). ADR 0093 establishes Guest Accounts and sign-in by emailed code; ADR 0094 anchors identity assurance to the Guest Account. Both were written for a single-domain object.

## Decision

This amends ADR 0095 (hosting) and the placement parts of ADR 0093 and ADR 0094 (accounts).

1. **One Worker.** A single Worker remains the front door. It routes each request to the correct Durable Object by domain. The concrete routing key (host, path or header) is fixed by the platform-hosting slice (Map slice 17), which implements this ADR.

2. **Per tenant, one platform Durable Object and one Durable Object class per domain.**
   - The **platform Durable Object** owns accounts, conversations and tasks. It is the platform-side system of record for those, per tenant.
   - **One Durable Object class per domain** owns that domain's transactions: `ShortletPilot` for shortlet, and a commerce object for commerce. Each domain object owns its own domain tables, migrations and alarms, as `ShortletPilot` does today.

3. **Accounts and sign-in by emailed code become platform-owned** (amends ADR 0093). The Guest Account, its Account Guest Id, email sign-in codes and challenges, and Guest Account Sessions live in the platform Durable Object. ADR 0093's identity, code, session and audit rules are unchanged; only their home moves from a domain object to the platform object. Account state and authorization remain authoritative in platform services (ADR 0093).

4. **Identity assurance stays a shortlet requirement** (amends only the placement in ADR 0094). Government-ID assurance (Smile ID, ADR 0084) remains a shortlet concern, and its records stay with shortlet, keyed by the account's Account Guest Id from the platform. ADR 0094's ownership `(tenantId, accountGuestId)`, its explicit-expiry and invalidation rules, and its check-in boundary (ADR 0085) are unchanged.

5. **R2 holds private, opaque-keyed objects.** Receipt evidence stays in the private `RECEIPTS` bucket (ADR 0090, ADR 0095), and product images for commerce use R2 with the same private, opaque-key discipline. Nothing here creates a public object URL or custom domain.

## Data-migration consequences

- **Tables split.** The account tables (`guest_accounts`, `guest_account_email_commands`, `guest_account_rate_events`, `guest_account_principals`, `guest_account_request_claims`), the contact table (`guest_contacts`) and the conversation/thread table (`guest_threads`) move out of `ShortletPilot` into the platform Durable Object. Tasks are platform state and are created there.
- **Tables that stay.** Shortlet transaction tables (bookings, payments, ledger, operator, units) stay with `ShortletPilot`. `guest_identity_assurance` stays with shortlet (decision 4).
- **Export and restore span two objects.** The daily evidence export (`apps/cloudflare/src/do-export.ts`, `EXPORTS`) and the ADR 0096 private export must cover both objects, and the restore runbook must load both. A rebuild signs every guest and operator in again, because the credential tables stay excluded from the export (ADR 0096; `DAILY_EXPORT_EXCLUDED`).
- **Mechanism.** The migration reuses the existing export/import path (`apps/cloudflare/src/ops-import.ts`) rather than a new mechanism. The step-by-step migration and cutover are the implementation slice's work (Map slice 17), not this decision's.

### Amendment (25 Oct 2026): cutover and export when commerce is off

Commerce is parked and off by default (ADR 0104 decision 5, ADR 0100 amendment). This amendment changes only the cutover and export behaviour for the commerce object while `COMMERCE_ENABLED` is off. The Durable Object class is kept.

- **Skip only after zero rows.** Ops cutover skips the commerce object only after it confirms that the commerce object holds zero commerce rows.
- **Refuse when rows exist.** If any commerce rows exist, cutover is refused with a named error. The commerce rows stay under the ADR 0096 export obligation, which is unchanged.
- **Export is unchanged for data that exists.** Where commerce data exists, the daily evidence export and ADR 0096 private export cover the commerce object as this ADR's data-migration consequences already require.
- **Secret.** The Cloudflare configuration will stop requiring the commerce HMAC secret by default (ADR 0075 amendment). This is the owner's decision; the configuration change is pending implementation.

The original decisions above are not rewritten. The shortlet object, the platform object and their export and restore rules are unchanged.

## Consequences

- The platform owns accounts, conversations and tasks; each domain owns only its transactional model (ADR 0099). A conversation can span domains without either domain owning the thread.
- ADR 0095's one-object-per-tenant and R2 decisions are extended to a platform object plus one object class per domain; ADR 0095's data-protection gates (Nigerian counsel, cross-border basis, vendor terms, DPIA) still apply to all objects and both buckets.
- Shortlet behaviour is unchanged except that accounts and threads move to the platform object; the guest walkthrough must show no change in behaviour.
- This unblocks the platform-accounts and Cloudflare platform-hosting slices (Map slices 16, 17) and the commerce Durable Object (Map slice 24).

## Related

ADR 0004, ADR 0075, ADR 0084, ADR 0085, ADR 0090, ADR 0093, ADR 0094, ADR 0095, ADR 0096, ADR 0099, ADR 0100. PRD and map: `.scratch/multi-domain-platform/`.

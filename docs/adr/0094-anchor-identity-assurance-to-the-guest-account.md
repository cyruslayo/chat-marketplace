# Anchor Identity Assurance to the Guest Account

## Context

`GuestIdentityVerificationResultSource` currently resolves a verification result using a tenant and Guest id. Guest ids created by anonymous browser sessions are temporary interaction principals, so the current boundary cannot reliably reuse identity assurance across devices. The Guest Account and stable Account Guest Id established by ADR 0093 provide the durable identity anchor.

ADR 0085 moved government-identity verification from Booking Eligibility to Check-In Eligibility. A Reservation may therefore be formed before its Primary Guest has an account or government-ID assurance. This ADR establishes where normalized assurance belongs and how check-in can resolve it; it does not restore any booking-stage requirement.

## Decision

### Ownership and levels

- Identity Assurance belongs to exactly one `(tenantId, accountGuestId)` pair. It is never owned by an interaction principal, browser session, thread, Booking Request, payment or Reservation.
- The account's assurance levels are `email-verified`, `phone-verified` and `government-ID-verified`. An absent account is anonymous, not a stored assurance level. An unverified phone is presented as “Phone added” and does not imply `phone-verified`.
- Email proof establishes control of the verified account email only. It does not establish phone ownership, government identity, age, payer attribution, Self-Booking or physical-access eligibility.
- Current-device sign-in may link the principal it controls to the account under ADR 0093. It does not transfer assurance from a different account. A merge of two Guest Accounts is not authorized by this ADR; conflicting account links fail closed.

### Persisted record

Each normalized assurance result contains exactly these fields:

| Field | Meaning |
| --- | --- |
| `tenantId` | Tenant scope for the account and result. |
| `accountGuestId` | Stable Guest Account identity to which the result belongs. |
| `level` | One of `email-verified`, `phone-verified` or `government-ID-verified`. |
| `method` | Platform-owned identifier for the evidence method; it is not raw evidence. |
| `status` | Normalized result status from the authorized result source, using the applicable vocabulary in ADR 0084. |
| `verifiedAt` | Authoritative successful-verification timestamp; required when status is verified. |
| `expiresAt` | Authoritative expiry timestamp supplied with the verified outcome; required when status is verified. |
| `providerReference` | Optional opaque provider/result reference; absent for non-provider methods. |

No other identity-result fields are persisted. In particular, do not store NIN, VNIN, BVN, full date of birth, name copies, document images or numbers, selfie/liveness media, biometric templates or scores, raw provider payloads, receipts, provider tokens, internal fraud/risk material or inferred assurance deadlines. A null or missing `verifiedAt` or `expiresAt`, an invalid timestamp, or an expiry not later than verification cannot produce current verified assurance.

### Explicit expiry and invalidation

- Every verified outcome carries its authoritative `verifiedAt` and `expiresAt`. The service evaluates `now < expiresAt` lazily on each read; at or after expiry the projected outcome is expired without relying on a scheduled mutation.
- No default freshness duration is approved. ADR 0084's proposed 180-day period remains a recommendation awaiting its own product/legal approval and is not applied by this ADR.
- Re-verification is required when the authoritative result expires or is revoked/invalidated, when the verified account email changes, or when an applicable material identity, risk, trust-and-safety or provider decision invalidates the result. A verified-email change removes the old current assurance result; logging into the same account from another device does not.
- Re-verification does not change the booking terms or Primary Guest. The original assurance and contractual position are not transferred to a replacement Primary Guest or another Guest Account (ADR 0012).

### Resolving a Reservation to an account

- Check-in assurance resolution begins with an authoritative Reservation and tenant, follows its stored Primary Guest/Booking Request lineage, and resolves the account through either an existing Linked Principal or an explicit resource-scoped email claim permitted by ADR 0093.
- A lost-device Guest may prove the historical email recorded for the root Booking Request. That claim covers the matching request and its causally related offer, contract, Reservation and payment records; it does not link the entire old principal. Mutable present-day contact data is not evidence of historical ownership.
- Legacy or inconsistent Reservations without an unambiguous authoritative email association to the root Booking Request and authorized account lineage cannot be claimed from guessed or principal-wide information. They fail closed as not account-associated. Current-device possession may establish a normal Linked Principal only when the browser actually controls that principal.
- Missing tenant, missing account, ambiguous lineage, conflicting account ownership, missing/expired assurance or any non-verified status produces no check-in identity eligibility. Resolution must not grant a door/lockbox code, protected entry instruction or other physical-access authority.

### Booking and operator boundary

- Identity Assurance is exclusively a future Check-In Eligibility input under ADR 0085. It is not imported or called by discovery, Request to Book, offer acceptance, payment or Reservation creation. An anonymous Guest may complete those stages when all other requirements pass.
- Operators receive only the minimum platform assurance outcome required for an authorized check-in workflow (ADR 0011). They never receive raw or restricted identity evidence, provider references, reason payloads or internal risk material.
- This ADR adds no identity provider integration, verification form, document upload, selfie/biometric capture, automated workflow or new check-in procedure. ADR 0085 remains in force.

## Consequences

- Results can be reused across devices only through the same authenticated Guest Account, while expiry remains the issuing authority's explicit decision.
- Check-in resolution for a historical anonymous Reservation requires an authorized linked-principal or scoped-request claim; absent or ambiguous evidence fails closed.
- Account/email assurance, government-identity assurance, payer attribution and Verified Access remain distinct facts with distinct authorities.

## ADR mapping

| ADR | Constraint applied here |
| --- | --- |
| 0011 | Minimize identity assurance and keep raw evidence from Operators. |
| 0012 | Primary Guest remains the booking occupant; assurance does not transfer to a replacement. |
| 0070 | Account, interaction and Reservation identities stay distinct; invalidation does not imply ownership. |
| 0075 | Restricted identity material and secrets are never placed in interaction state, logs or audit. |
| 0084 | Normalize authoritative outcomes and preserve its evidence boundary; its proposed 180-day freshness is not approved here. |
| 0085 | Verification is a check-in concern; booking remains identity-independent and protected access remains separate. |
| 0093 | Guest Account is the assurance anchor; email recovery grants scoped claims rather than whole-principal ownership. |

This ADR does not supersede ADR 0085.

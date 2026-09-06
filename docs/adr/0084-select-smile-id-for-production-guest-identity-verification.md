# Select Smile ID for production Guest Identity Verification

Status: proposed for implementation; provider selection decided, production certification pending

## Context

ADR-0011 requires the Primary Guest to complete government-ID verification before a Booking Request is disclosed. The repository's current `GuestIdentityVerificationResultSource` is intentionally provider-neutral and accepts only a platform-owned authoritative result. The local Guest fixture may provide a deterministic verified result for tests; it is not production authority.

The repository previously had no accepted production identity-provider decision. The provider comparison is recorded in [`docs/research/guest-identity-provider-evaluation-2026-09-06.md`](../research/guest-identity-provider-evaluation-2026-09-06.md), based on official documentation accessed 2026-09-06.

The selected integration must preserve the fixed boundary:

```text
Guest
  ↓
platform starts verification
  ↓
server creates provider session/token
  ↓
Smile ID hosted Web Integration
  ↓
Smile ID performs consent, NIN and biometric evidence collection
  ↓
signed callback and/or authoritative job-status query
  ↓
provider adapter
  ↓
GuestIdentityVerificationResultSource
  ↓
platform verification state
  ↓
Guest returns to the existing Request Draft
```

This ADR does not implement the adapter, add dependencies, certify the provider, or change booking behavior.

## Decision

Select **Smile ID Biometric KYC through the hosted Web Integration**, using **Nigeria NIN V2** as the primary Nigerian identity method.

NIN V2 is selected because Smile documents it as a tokenized NIN type, supports it on Biometric KYC, and provides deterministic sandbox cases. The provider-hosted Web Integration must collect the NIN and biometric evidence; the platform must not build or host an NIN form, document uploader, selfie capture, or liveness UI.

BVN, AML screening, document verification, and optional additional ID products are not part of the initial Shortlet assurance decision. They require a separate product/policy decision and must not be silently added to this flow.

## Assurance rule

The Shortlet requirement is identity assurance sufficient for ADR-0011, not maximum KYC.

Platform `verified` may be created only after an authoritative final Smile result for the platform-created job satisfies all of the following:

1. the provider reports the job complete and successful;
2. the provider's documented approved/success result code and result text are present;
3. the NIN V2 identity-number verification action is verified;
4. the applicable biometric actions report successful liveness and successful comparison to the ID-authority photo; and
5. the provider result is bound to the platform Guest and verification attempt through the provider job/user correlation values.

No arbitrary confidence threshold is introduced. Smile's documented approved result semantics and applicable action results are authoritative. A partial name, date-of-birth, phone, or biometric match is not sufficient unless Smile's final documented result marks the complete Biometric KYC job approved. Unknown, contradictory, incomplete, or unrecognized results fail closed and do not create `verified`.

Minimum age remains a platform/domain requirement. The adapter may normalize the provider's date-of-birth result for the application boundary, but it must not make a new age policy or expose the date of birth to interaction artifacts.

## Provider-to-platform lifecycle

The platform-owned state vocabulary is:

| Smile/provider condition | Platform state | Meaning |
|---|---|---|
| no attempt exists | `not_started` | No active or completed verification for this Guest. |
| web token/session created, user has not completed, or provider reports processing | `pending` | Verification is not authoritative yet. |
| final approved result satisfying the assurance rule | `verified` | Reusable current assurance with recorded expiry. |
| final rejected/no-record/invalid/inconclusive result | `failed` | Negative identity result; retry is governed separately. |
| a previously verified result passes its platform expiry or provider revocation/invalidation | `expired` | Current assurance is no longer usable. |
| provider cannot be reached, configuration is missing, or authoritative status cannot be confirmed | `provider_unavailable` | Technical inability to establish current assurance; never equivalent to identity failure. |

Browser success callbacks, query parameters, session creation, `processing`, and redirect return do not create `verified`.

## Initiation and hosted handoff

Verification initiation is a platform-owned authenticated Guest action from the existing blocked booking flow. The server must:

- authenticate the Guest and bind the attempt to tenant, Guest, thread, and Request Draft correlation;
- read current authoritative platform verification state;
- reuse one active valid pending attempt where provider policy permits;
- create a Smile Web Integration token/job only when no reusable attempt exists;
- use opaque platform and provider job/user references; and
- return only safe continuation information needed to open the provider-hosted flow.

The browser may receive a short-lived provider token or hosted-flow continuation value, but it must not receive API keys, signing keys, callback secrets, raw provider payloads, NIN/BVN values, document images, selfies, biometric values, or session secrets. The conversation and Weaver surfaces display only safe status and retry/conventional-route facts.

## Authoritative callback and status handling

The adapter must accept Smile's asynchronous callback and may query the documented job-status endpoint when the callback is delayed, missing, or during return recovery. The callback is not trusted until:

- the raw body signature is verified using the configured Smile signing material;
- the provider timestamp is validated against an adapter-configured replay window approved during implementation;
- the provider job/user correlation matches the platform attempt and Guest;
- the configured environment matches the attempt environment; and
- the result is an allowed final or pending state for the selected Biometric KYC product.

The browser return only resumes the Guest thread and causes an authoritative server read. It cannot mark the Guest verified.

The provider's documented `job_id` / `SmileJobID` and platform attempt identity are used as correlation and idempotency inputs. The implementation must confirm with Smile during onboarding whether a separate immutable event ID is available. If not, one terminal transition may be applied per provider job and terminal-result fingerprint; repeated callbacks are acknowledged without a second transition.

## Idempotency and ordering

Repeated callbacks for the same provider job must not create repeated platform transitions or telemetry side effects. The application boundary must apply transitions monotonically:

- a later authoritative terminal success cannot be overwritten by an older pending or failure callback;
- a terminal failure cannot be replaced by a non-authoritative browser state;
- conflicting terminal results require reconciliation and remain non-disclosing until resolved; and
- provider event/job identifiers are retained only as minimized correlation data.

The implementation must use the repository's existing idempotency and audit patterns; it must not add distributed infrastructure.

## Freshness and re-verification

**NEW POLICY DECISION:** recommend a 180-day freshness period from the authoritative successful verification timestamp, subject to product/legal approval before implementation.

This is a proposed operational duration, not an existing value in ADR-0011. It balances slowly changing identity attributes and repeated-KYC friction against the higher consequence of disclosing a Booking Request. It is independent of ADR-0075's provisional interaction-data retention values.

Re-verification is required when:

- the 180-day period expires;
- the provider or platform revokes or invalidates the result;
- material identity attributes or the Guest account identity change;
- a fraud, trust-and-safety, or risk policy invalidates the assurance; or
- the prior attempt was inconclusive or technically incomplete.

An otherwise current verified Guest does not re-verify for every Booking Request.

## Retry and failure behavior

- Guest cancellation: mark the attempt cancelled/pending according to the provider result, preserve the Request Draft, and allow a new attempt after the existing active attempt is no longer reusable.
- Negative identity result: map to `failed`, show a safe retry/conventional route, and do not treat it as provider outage.
- Temporary provider error or missing authoritative result: map to `provider_unavailable`, preserve the Request Draft, and allow retry with bounded server-side reuse/idempotency.
- Invalid input: return a safe validation error without logging the supplied identity value.
- Expired provider session: mark the attempt expired/pending as appropriate and create a replacement only after server validation.
- Provider outage or missing production configuration: fail closed for Booking Request disclosure; never use the deterministic fixture or bypass identity verification.

## Evidence and privacy boundary

The platform may retain only:

- provider identifier (`smile_id`);
- opaque provider job/user/verification reference;
- platform Guest and attempt references;
- normalized platform state;
- method (`nigeria_nin_v2_biometric_kyc`);
- platform assurance level;
- authoritative verified timestamp and platform expiry timestamp;
- safe reason code; and
- provider event/job correlation identifier.

The platform must not persist or place in interaction artifacts, browser persistence, telemetry, audit records, or ordinary logs:

- NIN, VNIN, or BVN values;
- full date of birth unless separately required by an already accepted domain policy;
- document images or document numbers;
- selfies, liveness images, biometric templates, or biometric scores;
- raw provider payloads or KYC receipts;
- provider bearer tokens, API keys, signing material, webhook secrets, or session secrets; or
- internal provider risk/fraud material.

The selected hosted flow is intended to keep raw evidence with Smile ID. This is a vendor capability assumption, not a legal conclusion. Production contracting must confirm Smile's data-processing role, retention/deletion controls, cross-border transfer terms, sub-processors, incident commitments, and permitted platform evidence under a DPA and Nigerian privacy review.

## Secrets and environment separation

The implementation must use deployment secret management and environment configuration, not source constants. Conceptual configuration names are:

```text
IDENTITY_PROVIDER=smile_id
IDENTITY_PROVIDER_ENVIRONMENT=sandbox|live
SMILE_ID_PARTNER_ID
SMILE_ID_API_KEY
SMILE_ID_CALLBACK_URL
SMILE_ID_SIGNING_KEY
```

The exact repository secret-loading mechanism must be selected during implementation after inspecting the production deployment platform. Sandbox and live partner IDs, API keys, callback URLs, job references, and databases must be separate. A missing live configuration fails closed; production must never fall back to the deterministic local fixture.

## Sandbox and certification

Normal repository tests use a deterministic fake adapter. An opt-in sandbox suite may use Smile's documented sandbox and NIN V2 test identifiers, but it must never use production credentials or make normal CI depend on provider availability.

This ADR selects a provider; it does not call `ProviderCapabilityCertifier`, create a certification record, or enable the identity capability. Production certification remains a later gate requiring signed callback tests, authoritative status retrieval, duplicate and out-of-order delivery, outage behavior, environment separation, privacy review, operational support, and evidence of the contracted production behavior.

## Conventional parity and Weaver boundary

The conversational blocked-booking action and a conventional authenticated verification route must invoke the same platform-owned application command and `GuestIdentityVerificationResultSource`. Weaver may present `verification required`, `pending`, `completed`, `expired`, `retry available`, and conventional-route facts, but it cannot create or infer verification authority. If Weaver fails, the conventional route remains usable and the Request Draft remains preserved.

Successful verification returns the Guest to the same thread and still-valid Request Draft. It refreshes authoritative review facts; it never silently submits the Booking Request. The Guest must explicitly review and submit.

## Alternatives considered

### Prembly / Identitypass

Rejected for this decision because the current official materials span historical Identitypass API naming and current Prembly/EasyOnboard products, making the exact supported production product boundary less clear. Prembly has strong Nigerian NIN/BVN coverage, current web/widget and status APIs, and documented webhook signatures, but the reviewed evidence exposes direct image/API shapes and requires more vendor confirmation for the precise raw-evidence isolation and unified result contract required here. It remains a viable procurement fallback.

### Dojah

Rejected for this decision because the reviewed official material demonstrates strong NIN/BVN, widget, liveness, and flow-link coverage but is less explicit about the complete authoritative server status/callback security contract and a single normalized result model for this use case. It remains a viable alternative pending vendor confirmation.

### Basic KYC, BVN, document verification, AML, and a custom platform capture flow

Not selected. Basic government-record matching does not provide the same documented person-to-ID-photo assurance as Biometric KYC. BVN is not required by ADR-0011, document capture would increase platform handling risk, AML is not required by current Shortlet policy, and a custom capture flow would violate the hosted-flow/minimization preference.

## Consequences

Positive consequences:

- the production provider decision is explicit and vendor-neutral outside the adapter;
- NIN V2 plus Biometric KYC gives the application a documented identity-to-person assurance result without inventing a numeric threshold;
- hosted Web Integration keeps document/selfie capture outside the platform UI;
- signed callbacks plus authoritative status retrieval support fail-closed return and outage behavior; and
- the existing Guest verification boundary, Request Draft, Weaver, and booking policy remain unchanged.

Costs and risks:

- Smile onboarding, production pricing, DPA, retention, deletion, support/SLA, and callback retry details remain procurement gates;
- biometric verification introduces greater Guest friction and provider cost than Basic KYC;
- the adapter must normalize provider result codes/actions and protect against duplicate/out-of-order callbacks; and
- the proposed 180-day freshness duration requires explicit product/legal acceptance as a new policy decision.

## Implementation boundary

The next implementation task may add only the Smile ID provider adapter and the smallest platform application/configuration seams required to implement this ADR. It must not alter Booking Request policy, add PSP work, add AML/document products, expose provider SDK objects, or mark the provider certified before contract and production-equivalent tests pass.

## ADR mapping

- ADR-0004: backend/web own authoritative state; browser return and Weaver are not authority.
- ADR-0011: government-ID verification before disclosure; raw identity evidence minimized.
- ADR-0012: verified Primary Guest remains the self-booking occupant.
- ADR-0013: identity assurance does not prove payer attribution.
- ADR-0065: Nigerian identity baseline, vendor roles, DPIA, and retention remain launch gates.
- ADR-0068: provider adapter and ordinary webhook interfaces remain behind platform-owned boundaries.
- ADR-0069: existing interaction protocol remains unchanged.
- ADR-0070: interaction, thread, tab, attempt, and domain identities remain distinct.
- ADR-0071: verification state may be projected, raw identity evidence may not.
- ADR-0072: initiation and consequential state changes use platform commands with authentication, idempotency, concurrency, and audit.
- ADR-0073: no provider-specific Weaver catalogue or schema is introduced.
- ADR-0074: stale/expired surfaces fail closed and conventional fallback remains available.
- ADR-0075: secrets and restricted identity data are excluded from interaction state and logs.
- ADR-0077: canonical artifacts remain authoritative and channel-safe.
- ADR-0079: callbacks and transitions are replayable, deduplicated, and observable without sensitive payloads.
- ADR-0080: conventional verification parity is mandatory.
- ADR-0081: Weaver presents provider-neutral authoritative projections and cannot calculate eligibility.

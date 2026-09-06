# Production Guest Identity Provider Evaluation

Accessed 2026-09-06. This note records official vendor documentation reviewed for the production Guest Identity Verification architecture decision. It is research evidence, not production certification, legal advice, or an implementation approval by itself.

## Repository requirement

ADR-0011 requires the Primary Guest to complete government-ID verification before a Booking Request is disclosed. The repository defines Guest Identity Verification as reusable assurance that the Primary Guest's government identity and minimum age have been verified, while excluding raw evidence from operators and minimizing platform storage. The existing domain boundary is `GuestIdentityVerificationResultSource` in `domains/shortlet/src/guest-verification.ts`; it currently accepts only a platform-owned `{ tenantId, guestId, governmentIdVerified }` result.

The local fixture is explicitly deterministic: `apps/local-guest/src/fixture.ts` can supply `governmentIdVerified` from `guestIdentityVerified`. It is not production provider authority.

## Smile ID

Official documentation shows:

- Nigeria NIN V2 is a tokenized NIN type and supports Basic KYC, Enhanced KYC, and Biometric KYC. The sandbox documents deterministic NIN test identifiers and success, no-record, invalid-format, and unavailable outcomes: [NIN V2](https://docs.usesmileid.com/supported-id-types/for-individuals-kyc/backed-by-id-authority/supported-countries/nigeria/nin-v2).
- Biometric KYC matches a SmartSelfie, described as liveness images plus a primary image, against the ID-authority photo; it is available through Web SDK, REST, and server-to-server options: [Biometric KYC](https://docs.usesmileid.com/products/for-individuals-kyc/biometric-kyc).
- The hosted Web Integration handles image capture, consent, job submission, and error handling. The server generates a token; the browser receives the token and uses the `sandbox` or `live` environment setting: [Web Integration](https://docs.usesmileid.com/integration-options/web-mobile-web/web-integration), [Usage](https://docs.usesmileid.com/web-mobile-web/web-integration/usage), [Web token](https://docs.usesmileid.com/server-to-server/javascript/generate-token-for-web-integration).
- Jobs are asynchronous. Smile documents signed callbacks containing a signature and timestamp, recommends callback signature verification, and documents job-status polling as an alternative: [Callbacks](https://docs.usesmileid.com/further-reading/faqs/how-do-i-setup-a-callback), [Job status](https://docs.usesmileid.com/further-reading/job-status), [Security overview](https://docs.usesmileid.com/further-reading/security-overview).
- Smile documents `job_complete`, `job_success`, result actions, result codes, and an instruction to make decisions using `ResultCode` and `ResultText`, rather than a browser callback: [Biometric KYC result handling](https://docs.usesmileid.com/products/for-individuals-kyc/biometric-kyc), [Basic KYC result semantics](https://docs.usesmileid.com/products/id-verification).
- Smile documents Nigerian BVN consent, including an OTP consent path. This decision does not select BVN because ADR-0011 does not require a bank identity and the product should minimize collection: [End-user consent](https://docs.usesmileid.com/integration-options/web-mobile-web/web-integration/end-user-consent).
- Smile advertises sandbox access and environment-specific credentials. Commercial pricing is not published in the reviewed technical documentation: [Security overview](https://docs.usesmileid.com/further-reading/security-overview).

## Prembly / Identitypass

Official documentation indicates that Identitypass is the older/currently visible product branding within the Prembly ecosystem: [Identitypass](https://idpass.prembly.com/). Current technical documentation is under Prembly and describes the current widget as Prembly/EasyOnboard rather than authorizing the historical repository identifier `id_identitypass`.

- Prembly documents NIN-with-face and BVN-with-face API endpoints, but these APIs require the caller to supply an image or image URL: [NIN with Face](https://docs.prembly.com/reference/nin-with-face), [BVN with Face](https://docs.prembly.com/reference/bvn-face-validation).
- Prembly documents a Web React widget/SDK for identity verification, KYC, and liveness checks: [Web React](https://docs.prembly.com/docs/web-react).
- Prembly documents live verification status retrieval and the statuses `PENDING`, `NOT-VERIFIED`, and `VERIFIED`: [Get verification status](https://docs.prembly.com/docs/get-verification-status), [status codes](https://docs.prembly.com/docs/response-codes-and-verification-status).
- Prembly documents webhook configuration and, in its current security page, HMAC-SHA256 `x-prembly-signature` plus a `token` webhook identifier: [API and webhooks](https://docs.prembly.com/docs/api-webhooks), [webhook security](https://docs.prembly.com/docs/authorization-and-security).
- Prembly documents a sandbox and a production onboarding process requiring business information and a signed user-consent/indemnity step: [Sandbox](https://docs.prembly.com/docs/environment), [Onboarding](https://docs.prembly.com/docs/how-to-integrate).

The evidence is technically promising, but the reviewed documentation is less consistent about the exact current product boundary between the historical Identitypass endpoints and Prembly's current widget/status flow. It also shows more direct image/API shapes that would require stricter proof that raw evidence remains outside this platform.

## Dojah

Official documentation shows:

- EasyLookup supports NIN, BVN, and phone checks against government and financial databases: [EasyLookup](https://support.dojah.io/articles/how-can-i-verify-a-user-s-identity).
- EasyOnboard is a configurable, mobile-friendly widget/flow with ID capture, liveness, document upload, Web SDK, mobile SDK, or flow-link integration: [EasyOnboard](https://docs.dojah.io/overview/identity-hub/easy-onboard), [integration](https://guides.dojah.io/user-manual/identity-verification/easyonboard/verification-flows/integration).
- Dojah documents configurable liveness and image-match behavior, and its changelog describes a government-data name-match option: [API changelog](https://docs.dojah.io/changelog/api_changes).
- Dojah's official SDK repository documents Nigerian NIN, VNIN, BVN, selfie verification, and webhook subscription APIs: [official SDK repository](https://github.com/dojah-inc/dojah-sdks).

Dojah has strong Nigeria-specific coverage and a plausible hosted path. The reviewed official material was less explicit than Smile's documentation about one unified provider result contract, callback signature verification details, and the exact server-created session/status flow needed for this repository's fail-closed adapter boundary. Those items require vendor confirmation before selection.

## Comparative scoring

Scores are 1–5 based only on the official documentation above. Critical criteria receive weight 3; important criteria weight 2; secondary criteria weight 1. A score is not a certification or a claim of production reliability.

| Criterion | Weight | Smile ID | Prembly | Dojah |
|---|---:|---:|---:|---:|
| Nigerian identity-source coverage | 3 | 5 | 5 | 5 |
| Authoritative result semantics | 3 | 5 | 4 | 4 |
| Secure server integration | 3 | 5 | 4 | 4 |
| Hosted mobile-web support | 3 | 5 | 5 | 5 |
| Webhook or authoritative status retrieval | 3 | 5 | 4 | 3 |
| Sandbox quality | 3 | 5 | 4 | 3 |
| Data minimization / raw-evidence isolation | 3 | 4 | 3 | 4 |
| Production reliability evidence | 3 | 4 | 3 | 3 |
| Provider-state idempotency support | 3 | 4 | 4 | 3 |
| TypeScript/server integration quality | 2 | 4 | 4 | 4 |
| Documentation quality | 2 | 5 | 4 | 4 |
| Mobile UX and failure clarity | 2 | 5 | 4 | 4 |
| Testability and observability | 2 | 5 | 4 | 3 |
| Future African-market support | 2 | 5 | 4 | 5 |
| SDK/UI/optional-product convenience | 1 | 4 | 4 | 4 |
| Weighted total / 174 | — | **153** | **126** | **121** |

The recommendation is based on documented assurance semantics and secure hosted/server boundaries, not SDK convenience. Public pricing was not sufficient to compare total cost. Commercial pricing requires vendor confirmation.

## Evidence limitations

Vendor documentation is vendor evidence, not independent certification. Before production contracting, the business must confirm provider legal role, DPA/controller-processor allocation, Nigeria-specific authorization and data-transfer terms, deletion/retention behavior, incident obligations, SLA/support, commercial pricing, and the exact production callback and retry contract. No legal conclusion is made here.

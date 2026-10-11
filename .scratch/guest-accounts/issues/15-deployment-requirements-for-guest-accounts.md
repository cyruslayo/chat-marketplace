# Deployment requirements and copy approval for guest accounts

Status: ready-for-human
Type: HITL
Blocked by: 06, 07, 08
Requested: 11 Oct 2026

## Why

Guest accounts are built and tested, but the code stays disabled or stale in some deployments until people supply configuration, approve copy and rebuild the client. Each item below is recorded as "Needs human" in an earlier issue and is not done by any agent. Nothing in this repository deploys from `main` yet.

### 1. Rebuild the guest client before serving it

- `apps/local-guest/dist/client.js`, `gallery.js`, `offer.js` and `payment.js` are committed (`git ls-files apps/local-guest/dist`). The build is `npm run build` (`package.json`, `node apps/local-guest/scripts/build-client.mjs`).
- The CI browser job runs the build (`.github/workflows/ci.yml:64`). The committed bundle is not rebuilt per change, and commit `f60b9f9` reverted a rebuilt bundle that carried another checkout's paths. Any Node pilot or local deployment must run `npm run build` first, or client changes (including the sign-in offer, issue 08) do not appear (issue 08 Comments, delegated decision).

### 2. Configuration for Node pilot and local deployments

- `SHORTLET_GUEST_CODE_HASHING_KEY`: the HMAC key for codes and rate scopes. Name in `apps/local-guest/src/guest-account-runtime.ts:41`. Must be at least 32 characters (`GUEST_CODE_HASHING_KEY_MIN_LENGTH`, `:103`, enforced by `usableCodeHashingKey`, `:106`); a shorter or missing key disables sign-in. The 32 is an orchestrator decision (issue 06 Q7), not a human decision: confirm or change.
- `RESEND_API_KEY` and `SHORTLET_NOTIFICATION_FROM`: read at `guest-account-runtime.ts:50-51`. Sign-in is disabled without either.
- `SHORTLET_TRUST_CF_CONNECTING_IP=true`: read at `guest-account-runtime.ts:42` and `:56`. Set only in Cloudflare-fronted deployments. Without it every client shares the socket address, so the per-address budget becomes global (issue 06 Comments, Q6).
- `SHORTLET_PUBLIC_ORIGIN`: required and HTTPS-only in production (`apps/pilot/src/pilot-config-core.ts:117-119`, `:169`). Without it the Origin and Referer check falls back to the request host over http, so every account POST is refused on an HTTPS deployment (issue 06 Q-e). Fail closed, but the account routes do not work.

### 3. Cloudflare Worker

- `apps/cloudflare/src/shortlet-pilot-do.ts:253` calls `createGuestRequestHandler` without a `guestAccounts` option. The default at `apps/local-guest/src/guest-server.ts:7007-7009` reads `loadGuestAccountComposition(process.env)`.
- The Worker supplies `RESEND_API_KEY` as a secret binding (`apps/cloudflare/cloudflare.config.ts:92`), not in `process.env`. No code-hashing key reaches `process.env` in the repository.
- Effect as written: sign-in is disabled in the Worker and the sign-in offer is hidden (issue 08 Comments, Cloudflare Worker entry; test "AC1 failure path: the offer is not shown when sign-in is disabled"). It is enabled only if a deployment puts the key and sender into `process.env`.
- Decision needed: how the Worker should receive `SHORTLET_GUEST_CODE_HASHING_KEY` and the sender (secret binding wired into `loadGuestAccountComposition`, or an explicit `guestAccounts` option). Not decided here.

### 4. Copy approval

- Approve or replace the `GUEST_ACCOUNT_COPY` strings in `apps/web-agent/src/guest-content.ts` (from line 317). These are functional wording, not final (issue 06, issue 07, issue 08 Needs human). Notable strings:
  - `offerTitle` (`:344`): "Sign in to see this booking on your other devices"
  - `offerIntro`: "We will email you a six-digit code. Signing in is optional, and your booking stays as it is."
  - `offerButton`: "Send me a code"
  - `offerNotFoundMessage` (`:335`): "This link does not open here. Sign in with the account that made this booking, or return to your conversation." Status 404 with identical bodies for missing and foreign offers (issue 06 Needs human, round 5).
- The issue 08 quote "Keep this booking on all your devices" is not in the repository and was not used.

### 5. Decisions recorded as open

- Whether a sign-in code send records an audit row in `pilot_notifications`, key and status only (issue 06 Needs human).
- Whether the no-JavaScript `/conversation` page shows the sign-in offer (issue 08 Needs human; the page links to each request page, which carries the offer).
- Whether the guest's own email in the chat JSON for request-sent and confirmation responses (`signInOffer`) is acceptable under ADR 0075. Delegated as acceptable in issue 08; the human has not confirmed (issue 08 Needs human).

## Question for the human

1. Confirm the hashing key length (32) or change it.
2. Choose how the Cloudflare Worker gets the code-hashing key and the notification sender (section 3), and whether sign-in is wanted in the Worker before launch.
3. Approve the copy (section 4), or supply replacement strings.
4. Confirm that `npm run build` is part of every Node deployment step (section 1).
5. Confirm the ADR 0075 position for the `signInOffer` email field and the `pilot_notifications` audit row (section 5).

Status stays `ready-for-human`: the items are accounts, secrets, live services and copy, which an agent cannot provision.

## ADR compliance

| ADR | Constraint | Affected path |
| --- | --- | --- |
| 0075 | No secrets, codes or emails in logs or audit | `signInOffer`, `pilot_notifications` row, key handling |
| 0093 | Sign-in by emailed code; hashed codes and session authority | `SHORTLET_GUEST_CODE_HASHING_KEY` |
| 0095 | Pilot hosted on Cloudflare | Section 3 |
| 0078 | Accessible copy and layout | Copy approval |

## Comments

- 11 Oct 2026, filed by consolidating the "Needs human" and delegated items from issues 06, 07 and 08 (Comments and Needs human sections). Lines re-checked on `origin/main` 8b23923.
- Not done by any agent: provisioning, secrets, live email service, copy approval, and the Worker wiring decision.

# Deploy the demo to Cloudflare staging

Status: ready-for-human
Type: HITL
Blocked by: 02, 03, 04, 05
Requested: 21 Oct 2026

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

Nothing has been deployed yet.

- The Worker is `apps/cloudflare`, configured through `apps/cloudflare/cloudflare.config.ts` with the `cf` CLI (`cf@1.0.0-beta.12`). It is not configured with wrangler.
- The staging Worker is `shortlet-pilot-staging`, with origin `https://staging.shortlet.ng`.
- `cf build` and `cf deploy` fail on this Windows install with `spawn …\bin\cf-vite ENOENT` (`docs/runbooks/cloudflare-staging-rehearsal.md`, gap 1; landing issue 12).
- `apps/cloudflare/node_modules` must first be created by `node scripts/ensure-worker-deps.mjs`.
- There is no deploy npm script. The upload is `cd apps/cloudflare && npm exec cf -- deploy --prebuilt --mode staging`.

## What to build

**Human steps (the owner):**

1. Run `cf login` on the Cloudflare account.
2. Choose the origin: a workers.dev URL, or confirm DNS for `staging.shortlet.ng`. If it differs from `PUBLIC_ORIGIN.staging`, update that one value in `cloudflare.config.ts`.
3. Provide:
   - the OpenRouter API key;
   - a Paystack **test** secret key (`sk_test_…`);
   - optionally, a Resend key. Without it, guest email sign-in stays off.

**Agent steps:**

1. Generate `SHORTLET_GUEST_CODE_HASHING_KEY` (at least 32 characters), `OPS_SHARED_SECRET` and `COMMERCE_REFERENCE_HMAC_KEY`. Hand them to the owner. Never write them to the repo or logs.
2. Set the build environment: `SHORTLET_DEMO=enabled`, `CONCIERGE_MODE=openai-compatible`, `LLM_BASE_URL=https://openrouter.ai/api/v1`, `LLM_MODEL=<slug from issue 02>`, `LLM_PROVIDER_LABEL=openrouter`, and `CONCIERGE_DAILY_MODEL_CALL_CAP` (the owner picks the value; a suggestion is 1500).
3. Build with the workaround: `node scripts/ensure-worker-deps.mjs`, then `node apps/cloudflare/node_modules/@cloudflare/vite-plugin/bin/cf-vite build --mode staging`.
4. Set the secrets: `LLM_API_KEY`, `PAYSTACK_SECRET_KEY`, `SHORTLET_GUEST_CODE_HASHING_KEY`, `OPS_SHARED_SECRET`, `COMMERCE_REFERENCE_HMAC_KEY`, and optionally `RESEND_API_KEY`.
5. Deploy with `npm exec cf -- deploy --prebuilt --mode staging` from `apps/cloudflare`.
6. Provision with `npm run demo:provision -- --origin <origin>` (issue 05).
7. Point the Paystack **test-mode** webhook at the deployed webhook route, and confirm `PAYSTACK_CALLBACK_BASE_URL` equals the origin (ADR 0087).
8. Record the URL, the Worker version id and the date in `## Comments`. Do not record secrets.

Before deploying, run the pre-deploy gate on the commit being deployed: `npm run check`, `npm run test:workers` and `npm test`. Run the browser phase in the background; it takes about 12 minutes.

## Acceptance criteria

- [ ] AC1: the pre-deploy gate passes on the commit that is deployed: `npm run check`, `npm run test:workers` and `npm test`.
- [ ] AC2: `GET <origin>/welcome` returns 200 with the demo notice. It is not a 503 `NOT_PROVISIONED`.
- [ ] AC3: `GET <origin>/demo/photos/<unit>/1.jpg` returns 200 `image/jpeg`.
- [ ] AC4: `/_ops` without the secret returns 401 or 403.
- [ ] AC5: A webhook with a bad Paystack signature returns 401.
- [ ] AC6: No secret value appears in the repo, in `git diff`, or in issue comments.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0095 / 0101 | Cloudflare hosting: one router Worker, Durable Objects with SQLite | Deploy target |
| 0087 | Staging uses test keys; the callback origin equals the public origin | Step 7, AC5 |
| 0075 | No credentials in logs or comments | AC6 |
| 0105 | Staging-only demo | `SHORTLET_DEMO` on staging only |

## Comments

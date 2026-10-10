# Staging rehearsal; merge to `main`

Status: ready-for-human
Type: task
Blocked by: 06d, 11b, 12a, 12b, 13, 14
Branch: work on `infra/cloudflare-deployment`; merge it to `main` at the end
Requested: 2 Oct 2026
Unlocks: 16

## Why

The integration branch merges to `main` only after the whole pilot is proven on a real Cloudflare staging deployment. An agent can prepare and run most of it, but deploying, the Paystack dashboard and the go/no-go decision need the user.

## What to do

1. **Build and deploy** with the project-pinned CLI: `cf build --mode staging`, then `cf deploy --prebuilt --mode staging`, using Paystack **test** keys, `SHORTLET_DEPLOYMENT=staging` and the beta invite code. Provision secrets through the supported procedure confirmed in 01c (the beta may not support setting individual secrets with `cf`); do not record secret values.
2. **Provision** through the ops CLI (`SHORTLET_OPS_URL`): import inventory, bootstrap operators, and provision an operator token.
3. **Journeys against the staging URL:**
   - adapt `scripts/pilot-agent-smoke.ts` to accept a base URL, if it doesn't already;
   - run the Rodney acceptance script (`pilot:acceptance:rodney`);
   - run the real-Chrome guest journeys against the URL.
4. **Forced restarts:** at each stage (discovery → request → offer → payment → confirmed), force a restart with a redeploy, and prove the journey resumes. Do the same for an operator session.
5. **Payments:** Paystack test-mode card payment and callback; signed webhook delivery from the Paystack dashboard; one manual-transfer receipt uploaded, read in the back office, and verified.
6. **Backups:** confirm the alarm wrote today's exports, then run the 12b PITR drill on staging.
7. **Logs:** search Workers Logs for cookies, tokens and bodies (none expected).
8. Record the results below, then merge `infra/cloudflare-deployment` → `main` via PR.

## Acceptance criteria

- AC1: Every step above is recorded with its date, the result, and any reference: payment refs, export object keys, the PITR bookmark.
- AC2: Every forced restart resumes at the same stage with no lost or duplicated state.
- AC3: The webhook with a bad signature is refused (401), and the good one confirms exactly once.
- AC4: The PITR drill restores to the chosen point, and the post-restore checks pass.
- AC5: `npm run check`, `npm test` and `npm run test:workers` are green on the integration branch at merge time, and the PR to `main` is merged.

## ADR compliance

All ADRs in the PRD table, especially 0041, 0044, 0046, 0079, 0086, 0087, 0088 and 0090.

## Comments

### Evidence template (prepared 10 Oct 2026; rehearsal not run)

Prepared on `infra/cf-15-staging-prep`. Status stays `ready-for-human`. No rehearsal, deployment, Paystack test, PITR drill or merge has happened, and no result is claimed here.

- Runbook: `docs/runbooks/cloudflare-staging-rehearsal.md` (steps 1 to 8, the preconditions and the full evidence-log template).
- Harness change: `scripts/pilot-acceptance-rodney.ps1` accepts `-BaseUrl` or `SHORTLET_BASE_URL` (validated by `scripts/pilot-base-url.ts`); `scripts/pilot-agent-smoke.ts` refuses a base URL, since it is in-process only.
- Open gates (ADR 0095, ADR 0065): counsel approval, Cloudflare and Google Gemini contracts and processor roles, the retention schedule, and the DPIA review. Real personal data must not be used on staging until these close. Staging uses Paystack test keys and synthetic data only.
- User decisions: the staging origin is `https://staging.shortlet.ng` (set in `cloudflare.config.ts`); the agent smoke stays in-process with no remote HTTP mode, so the remote journeys are the Rodney acceptance run plus human-run real-Chrome journeys. Still open before the build: a host where `npm exec cf -- build --mode staging` works (it fails on the Windows install, issue 10b).

Evidence log (one row per step; PASS, FAIL or BLOCKED; references only, never secret values, cookies, tokens, card data or webhook bodies):

| Step | Date (Lagos) | Result | Operator | Commit SHA | References | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Build and deploy (secret names set) | | | | | Build log reference | |
| 2. Ops provisioning (import, operators, operator id) | | | | | Import summary reference | |
| 3. Journeys (agent smoke N/A; Rodney report; real-Chrome run) | | | | | Report paths (local) | |
| 4. Forced restarts: discovery, request, offer, payment, confirmed, operator session | | | | | Stage and request, offer or reservation ids | |
| 5a. Paystack test card payment and callback | | | | | Paystack test reference | |
| 5b. Webhook with bad signature (expect 401) | | | | | Status code only | |
| 5c. Webhook with good signature (exactly once) | | | | | Paystack reference; duplicate check | |
| 5d. Manual transfer receipt uploaded and verified | | | | | Receipt id | |
| 6a. Today's exports present (18 objects) | | | | | Object keys | |
| 6b. PITR drill (dry run, confirm, restart, checks) | | | | | Restore point; PITR bookmark | |
| 7. Workers Logs searches (zero matches expected) | | | | | Queries; time range; match counts | |
| 8. Go / no-go (user decision) and merge PR | | | | | PR URL | |

### Agent pass on `infra/cf-wave6` (10 Oct 2026)

Status unchanged: **ready-for-human**.

- The staging-prep branch `infra/cf-15-staging-prep` is merged into `infra/cf-wave6` (merge commit `b567a0b`, no conflicts).
  The staging-prep work is in place: `docs/runbooks/cloudflare-staging-rehearsal.md`, the pilot base-URL resolver, and
  the HTTPS URL guard.
- Checks on `infra/cf-wave6`: `npm run check` passes, and `npm run test:workers` passes 58 of 58. The non-browser suite
  gives 1404 of 1407 passing. Its 3 failures predate the merge (details in issue 16's comment), so AC5 is not met yet.
  The browser phase was not run.
- Not done and not claimed: the staging deployment, the Paystack test-mode steps, the forced restarts, the PITR drill, the
  Logs search and the go/no-go. These need the user.
- Data-protection gates (ADR 0095) still apply. Staging uses synthetic data only.

### Wave 6 code close (10 Oct 2026)

Status unchanged: **ready-for-human**. The agent prep is done and verified on `infra/cf-wave6` at `8e769d2` (see `map.md`, "Wave 6 completion (code)"). Not run: staging deploy, Paystack test-mode steps, forced restarts, the PITR drill, the Logs search and the go or no-go. The evidence template above is still blank. AC5 is pending a full run on the integration branch at merge time.

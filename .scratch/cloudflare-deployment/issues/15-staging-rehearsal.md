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

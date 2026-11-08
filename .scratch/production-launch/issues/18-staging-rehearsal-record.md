# Staging rehearsal on the gated build, with webhook proof

Status: ready-for-agent
Type: task
Blocked by: 12
Requested: 8 Nov 2026
Wraps: [cloudflare-deployment/15](../../cloudflare-deployment/issues/15-staging-rehearsal.md), [demo-launch/06](../../demo-launch/issues/06-deploy-demo-to-cloudflare-staging.md), [demo-launch/07](../../demo-launch/issues/07-verify-live-demo-journey.md)

## Parent

[PRD](../PRD.md).

## Why

The 29 Oct journey proved the flow on an older build, but `charge.success` was never seen reaching the Worker with a 200, and the rehearsal steps of cloudflare 15 (forced restarts, manual-transfer receipt, logs, backup drill) were never recorded. Its "merge integration to main" step is already done.

## What to do

Agent: build from a clean detached worktree at the issue 12 commit, run `npm run check` there, verify the descriptor with the issue 07 script, and give the owner the deploy command. The owner deploys and provisions. Then, in daytime Lagos hours (ADR 0041/0042) and within the 20-minute Payment Window:

1. The full guest journey in the browser, synthetic data only (AGENTS.md "Live verification"); stop before card entry, the owner pays with the Paystack test card.
2. The owner confirms in the Paystack dashboard that `charge.success` was delivered with a 200.
3. A late payment on a superseded reference (issue 05) is recorded and alerts the operator.
4. One manual bank transfer: receipt uploaded, read and verified in the back office (ADR 0090).
5. A forced restart (redeploy) at request, offer and payment stages, and the journey resumes.
6. The operator gets the Booking Request email; the metrics page (issue 09) shows the booking.
7. Read-only log query (only if the owner asks): no cookies, tokens or bodies.

## Acceptance criteria

- [ ] AC1: Each step above has a result, time and build sha recorded in Comments.
- [ ] AC2: Webhook delivery with a 200 is confirmed from the dashboard.
- [ ] AC3: Any defect goes to a new issue with the exact `/api/event` or `/api/turn` response body, and is fixed before issue 19.

## Comments

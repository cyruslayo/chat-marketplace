# Production build, deploy and real inventory

Status: ready-for-agent
Type: task
Blocked by: 14, 15, 17, 18
Requested: 8 Nov 2026
Wraps: [cloudflare-deployment/16](../../cloudflare-deployment/issues/16-data-migration-and-cutover.md) (close as "no Node data to migrate", D2)

## Parent

[PRD](../PRD.md).

## What to do

- Agent: build `--mode production` from a clean detached worktree at the gated commit, with commerce off, demo off, Extended Stays off (issue 06) unless issue 13 is resolved, run `npm run check`, verify the descriptor (issue 07 script), and hand the owner the deploy command. Never deploy.
- Owner: put live secrets in a production secrets file (never opened by an agent), deploy, provision operators and import the issue 15 inventory through `/_ops`.
- Agent (read-only): check the public pages load and the guest origin returns the inventory.
- Record on cloudflare-deployment/16 that there is no Node production data, so only its DNS and Paystack-URL steps applied.

## Acceptance criteria

- [ ] AC1: Production is deployed from a recorded sha whose descriptor check passed.
- [ ] AC2: Real units are searchable on the production origin; no demo unit is.
- [ ] AC3: Cloudflare 16 is resolved with the "no data to migrate" note.

## Comments

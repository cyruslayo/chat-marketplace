# Cloud session handoff (10 Oct 2026)

Work moved from the Windows PC to Claude Code cloud sessions. Everything below is on GitHub. The release state, verification record and the human steps still open are in `map.md`, "Wave 6 completion (code, 10 Oct 2026)". Read that section before picking up anything.

## Branches

Branch tips move as work is merged. Read a tip with `git rev-parse <branch>`; the commit SHAs below are the ones recorded on 10 Oct 2026.

| Branch | What it holds |
| --- | --- |
| `infra/cf-wave6` | The current code branch. Cut from `infra/cloudflare-deployment`. It holds the slice 15 prep (merge `b567a0b`), the slice 16 code (merge `e3a52a0`) and the wave 6 fix passes. Start here. |
| `infra/cloudflare-deployment` | The integration branch as of wave 5 (issues 01–14 resolved). It does not yet contain the wave 6 work, which is built on top of it. It merges to `main` only after issue 15 passes. |
| `infra/cf-16-migration` | Slice 16 code (batched import, verify and reverse export). Merged into `infra/cf-wave6`; kept for history. |
| `infra/cf-15-staging-prep` | Staging rehearsal prep. Merged into `infra/cf-wave6`; kept for history. |
| `infra/cf-17-retire-node-prod` | Slice 17 prepared and held. Unmerged, no PR, not resolved. It is kept current by merging `infra/cf-wave6` into it. Do not merge it to `main` until `ROLLBACK_WINDOW` closes after the human cutover in issue 16. |
| `infra/cf-*` | Per-slice branches, kept for history. |
| `wip/main-snapshot-2026-10-10` | A snapshot of the PC's local `main` (commits not on `origin/main`) plus uncommitted guest UI and `.scratch` issue work. Not for merging as-is. |

`origin/main` was deliberately **not** updated: the main merge in `map.md` is a local code merge only.

## Open issues

- 15 staging rehearsal: `ready-for-human`. The agent prep is on `infra/cf-wave6`. The Cloudflare dashboard, DNS, real secrets and the staging evidence are human steps.
- 16 data migration and cutover: `ready-for-human`. The agent code is on `infra/cf-wave6`. The cutover is a human step.
- 17 retire the Node production entry: `ready-for-human`, prepared and held on `infra/cf-17-retire-node-prod`. Hold until the rollback window closes.

The numbered human steps that remain before wave 6 closes are in `map.md`, "Wave 6 completion (code, 10 Oct 2026)", under "Human steps pending". Do not paste Cloudflare API tokens or production secrets into cloud sessions. Leave those steps for a local machine.

## Setup in a cloud session

- Node `>=22.18.0` (`package.json` `engines`; `.nvmrc` pins 22.19.0).
- `npm ci`, then `npm run check` and `npm run test:workers`.
- There is no `test:non-browser` script. `npm test` (`scripts/run-tests.mjs`) runs in two phases: phase 1 runs every non-browser test file concurrently, then phase 2 runs the real-Chrome files one at a time. Phase 1's result prints before phase 2 starts.
- The browser phase needs Chrome and takes about 12 minutes; run `npm test` in the background. The Paystack checkout test needs real network access and fails behind the sandbox proxy (see `map.md`, wave 6 completion).
- Follow `AGENTS.md` (ADR discovery, Definition of Done in `docs/agents/issue-tracker.md`).

## Back on the PC (state on 10 Oct 2026)

`git fetch`, then `git pull` in each worktree. On `main`, the snapshot branch is checked out; switch back with `git switch main` and bring the edits over with `git restore --source=wip/main-snapshot-2026-10-10 --worktree -- .` if you still want them uncommitted.

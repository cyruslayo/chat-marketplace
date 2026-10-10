# Cloud session handoff (10 Oct 2026)

Work moved from the Windows PC to Claude Code cloud sessions. Everything below is on GitHub.

## Branches

| Branch | What it holds |
| --- | --- |
| `infra/cloudflare-deployment` | Cloudflare integration branch (issues 01–14 resolved, 15 prep merged). Start here. |
| `infra/cf-16-migration` | Slice 16: batched import, verify and reverse export (`fa606e5`), not yet merged into the deployment branch. |
| `infra/cf-15-staging-prep` | Staging rehearsal prep (already in the deployment branch). |
| `infra/cf-*` | Per-slice branches, kept for history. |
| `wip/main-snapshot-2026-10-10` | Local `main` (78 commits not on `origin/main`) plus uncommitted guest UI and `.scratch` issue work. Not for merging as-is. |

`origin/main` was deliberately **not** updated: the main merge in `map.md` is a local code merge only.

## Open issues

- 15 staging rehearsal: `ready-for-human` (Cloudflare dashboard, DNS, real secrets).
- 16 data migration and cutover: `ready-for-human`; code on `infra/cf-16-migration`.
- 17 retire Node production entry: `ready-for-agent`, but **blocked by 16**.

Do not paste Cloudflare API tokens or production secrets into cloud sessions. Leave 15/16 human steps for a local machine.

## Setup in a cloud session

- Node `>=22.18.0` (`.nvmrc`: 22.19.0).
- `npm ci`, then `npm run check`, `npm run test:non-browser`, `npm run test:workers`.
- The browser phase of `npm test` needs Chrome and takes about 12 minutes; run it in the background.
- Follow `AGENTS.md` (ADR discovery, Definition of Done in `docs/agents/issue-tracker.md`).

## Back on the PC

`git fetch`, then `git pull` in each worktree. On `main`, the snapshot branch is checked out; switch back with `git switch main` and bring the edits over with `git restore --source=wip/main-snapshot-2026-10-10 --worktree -- .` if you still want them uncommitted.

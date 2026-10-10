# Retire the Node production entry

Status: ready-for-human
Hold: do not start until the rollback window closes (`ROLLBACK_WINDOW` in `docs/runbooks/cloudflare-cutover.md`), which needs the human cutover in issue 16 first. The Node entry is the rollback path until then. Set by the wave-6 review (F7); the file had no hold note before.
Type: task
Blocked by: 16
Branch: `infra/cf-17-retire-node-prod` (into `main`)
Requested: 2 Oct 2026
Unlocks: none

## Why

After cutover, Cloudflare is the only production platform. Leaving a working Node production entry invites drift and accidental use. Node stays for local development and tests.

## What to build

- Remove the production path:
  - `apps/pilot/src/cli-start.ts`
  - the `pilot:start` script
  - the production-only parts of `apps/pilot/src/pilot-server.ts`
  First check what tests and `local-pilot*.ts` import from `pilot-server.ts`. Keep anything they need: `withBetaBanner`, `clientAddress` and `createPilotRequestHandler` users. Move it rather than delete it.
- Keep `NodeSqliteDatabase`, the Node wrappers (`startLocalGuestServer`, `startLocalOwnerServer`) and the `pilot:local:*` scripts.
- Docs: update the pilot deployment docs (`docs/pilot-deployment.md` and any others that mention `pilot:start` or the reverse proxy) to describe Cloudflare deploys. Document `cf dev` as the production-parity local run, and `cf build` / `cf deploy` for builds and deployments. Keep any documented Wrangler command limited to a confirmed beta capability gap.
- Update `AGENTS.md` "Tech Stack & Tooling" to mention `npm run test:workers`.

## Acceptance criteria

- AC1: `pilot:start` and `cli-start.ts` no longer exist, and no doc tells anyone to run them. A grep test checks this.
- AC2: `pilot:local`, `guest:local` and `owner:local` still work, and their tests pass.
- AC3: `docs/pilot-deployment.md` describes Cloudflare deployment using `cf` and local parity using `cf dev`.
- AC4: `npm test`, `npm run test:workers` and `npm run check` pass.

## ADR compliance

| ADR | Constraint |
| --- | --- |
| 0095 | Cloudflare is the production host |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

- Prepared and held (10 Oct 2026), not resolved. Branch `infra/cf-17-retire-node-prod` (from `origin/infra/cf-wave6`) removes `pilot:start` and `apps/pilot/src/cli-start.ts`, rewrites `test/pilot-local.test.ts` (AC4) and `test/production-install.test.ts`, and rewrites `docs/pilot-deployment.md` for `cf build`, `cf deploy` and `cf dev`. It also updates `docs/pilot-local-run.md`, the `.env.example` comment and AGENTS.md (`npm run test:workers`), and adds `test/retired-node-production-entry.test.ts` as the grep guard for AC1 and the AC3 doc check. Under ADR 0095, Cloudflare is the production host.
- Kept on purpose: `startPilotServer` in `apps/pilot/src/pilot-server.ts` (with `clientAddress`, which reads `CF-Connecting-IP` since commit `5793ec3`, failing closed to `unknown`; the earlier `X-Forwarded-For` reading is retired), `productionPilotStartupLines`, and `NodeSqliteDatabase`. Six test files still import them as the in-process composition harness. Removing them is a separate task.
- Verification on the branch: `npm run check` passes; `npm run test:workers` passes (12 files, 58 tests); non-browser phase 1 passes (207 files, 1414 tests, 0 failures); `pilot:local`, `guest:local` and `owner:local` start and serve. The browser phase was not run.
- Hold: do not merge into any other branch and do not open a PR until the user confirms the production cutover and the rollback window has closed. Status stays as is until then.
### Client-address rule (10 Oct 2026)

- `clientAddress` is kept (as this issue requires), and it is keyed on `CF-Connecting-IP`, not on `X-Forwarded-For`. The Node
  pilot's rightmost-`X-Forwarded-For` rule (issue 08c, map.md) is retired on `infra/cf-17-retire-node-prod`, commit `5793ec3`.
  That branch reads the header through the shared `clientAddressFromCloudflareHeaderValue` rule, and an absent or blank header
  fails closed to `unknown` (one shared bucket). The socket-address fallback is gone.

### Wave 6 code close (10 Oct 2026)

Status unchanged: **ready-for-human**, held. `infra/cf-17-retire-node-prod` is held (unmerged, no PR) and is kept current by merging `origin/infra/cf-wave6` into it. Its tip moves, so read it with `git rev-parse origin/infra/cf-17-retire-node-prod`; at 10 Oct 2026 it was `d6c2f36`. Not resolved. Do not start until `ROLLBACK_WINDOW` closes after the human cutover in issue 16. See `map.md`, "Wave 6 completion (code)".

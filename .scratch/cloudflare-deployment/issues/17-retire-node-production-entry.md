# Retire the Node production entry

Status: ready-for-agent
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

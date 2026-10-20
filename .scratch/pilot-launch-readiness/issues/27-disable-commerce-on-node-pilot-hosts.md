# Disable commerce on the Node pilot hosts

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 20 Oct 2026

## Why

The owner decided on 20 Oct 2026 to launch stays only and defer commerce (see `../../multi-domain-platform/issues/30-defer-commerce-until-stays-launch.md`). The Cloudflare Shortlet object already composes the guest app with commerce off (`apps/cloudflare/src/shortlet-pilot-do.ts:295`, `commerce: GUEST_COMMERCE_COMPOSITION.disabled`). The Node pilot hosts do not set the option, so they get the default, which is **on** (`apps/local-guest/src/guest-server.ts:1983`, `DEFAULT_GUEST_COMMERCE_COMPOSITION = local`):

- `apps/pilot/src/pilot-server.ts:116` calls `createGuestRequestHandler({ … })` without `commerce`.
- `apps/pilot/src/local-pilot-server.ts:44` does the same.

With commerce on, `/s/<store>`, `/s/<store>/<offer>`, `/cart` and `/orders/track` are mounted (`apps/local-guest/src/commerce-route-module.ts`). No Shop task appears in chat (no commerce assistant pack is registered on these hosts), but the store, cart and tracking pages are reachable.

## What to build

- Both Node pilot hosts pass `commerce: GUEST_COMMERCE_COMPOSITION.disabled` explicitly, through their validated configuration if the host has one (pilot-launch-readiness 18). If a configuration value is added, the default stays `disabled`, and any other value fails validation at start-up.
- `apps/local-guest/src/cli-start.ts` (the local demo) keeps its current default. It is a development tool, not a pilot host.
- No change to the Cloudflare composition, the commerce domain or the guest kit.

## Acceptance criteria

1. The production pilot host serves 404 for `/s/<store>`, `/cart` and `/orders/track`
2. The local pilot host serves 404 for the same paths
3. A guest message about buying a product on either pilot host gets the normal stays reply, and no Stays/Shop starters or task rail appear
4. Stays flows on both pilot hosts are unchanged (the existing pilot server tests pass without edits)

## Rules

- AGENTS.md implementation protocol: list and read the ADRs that apply first (0099, 0100, 0101, 0095), with one named `test()` per criterion including its failure path.
- Run `npm run check`, `npm test` (browser phase in the background, one browser run at a time) and `npm run test:workers` before merging to `main`.
- Commit on a branch cut from `main`.

## Comments

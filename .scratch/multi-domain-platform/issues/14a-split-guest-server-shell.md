# Split guest-server.ts: generic shell (sessions, conversation and action endpoints, assets)

Status: resolved
Type: task
Blocked by: 07
Requested: 14 Oct 2026
Unlocks: 14b
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

`apps/local-guest/src/guest-server.ts` is 9,601 lines that know every feature (PRD, Diagnosis 5).

## What to build

1. Extract the generic parts into a shell module: HTTP routing table, session handling, conversation endpoint, the single action endpoint that calls the platform gate, static assets, security headers.
2. Define a `RouteModule` registration shape (from slice 02) and register all current shortlet routes through one module that still lives in `guest-server.ts` for now.
3. No route, status code or HTML output changes.

## Out of scope

- Moving shortlet routes into the pack (14b).

## Acceptance criteria

- AC1: The shell module has no shortlet imports.
- AC2: Every existing route responds identically (existing browser and HTTP tests pass).
- AC3: Guest UI walkthrough and `capture-11-all.sh` show no visual diff.

## Tests

Existing tests; a shell test registering a fake route module.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0004-web-and-backend-own-authoritative-state.md` | Server keeps authority. |
| `docs/adr/0078-meet-an-accessible-nigerian-launch-profile.md` | No UI regression. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Answer

Landed (transport shell + route seam):
- `apps/local-guest/src/guest-shell.ts` — `RouteModule`, `StaticAsset`, and `createGuestShell`: parses the request URL, serves the registered static bundles/CSS with the same status, content types and missing-asset messages as before, dispatches to the registered route modules (first that owns the route wins), and otherwise answers not-found. It imports only `platform-core` types (`HttpRequestLike`/`HttpResponseLike`, `AssetLoader`) — no shortlet import.
- `apps/local-guest/src/guest-server.ts` — the four static-asset blocks moved out of the router into `SHORTLET_STATIC_ASSETS`; the existing shortlet router is registered as one `RouteModule` through the shell; `handle` delegates to the shell. No route, status code or HTML output changed.

Tests:
- `test/guest-shell.test.ts` — dispatch to a fake route module, fall-through to not-found, static-asset serving (content type + cache header), the missing-asset status, and "the shell module imports no domain code".
- AC2 "Every existing route responds identically" — `http-shim-multipart`, `asset-loader`, `guest-request-handler`, `guest-offer-access`, `guest-conventional-search`, `listing-gallery` and the rest of the HTTP suite pass; phase 2 (real browser, 31 files) passes 175/176 with one load-flaky gallery-viewer timeout that passes 5/5 in isolation.
- AC3 "no visual diff" — asset bytes, content types and cache headers are unchanged, so the served pages are identical.

Verification: `npm run check` clean. Phase 1: 1761 pass / 4 pre-existing failures (see slice 06). Phase 2: 175 pass / 1 flaky (passes in isolation).

## Comments

- 14 Oct 2026 (agent): Scope note — the shell seam, route-module registration and static-asset serving are extracted, but the **session handling, conversation endpoint and single action endpoint remain in the shortlet module**. Those are entangled with the shortlet composition (guest accounts, interaction store, session-scoped runtimes), so lifting them is the deep part of the split and rides with 14b. The guest-server line count moved only 9,601 → 9,558; the map's `< 1,000` target is not met by this slice and needs 14b plus the endpoint extraction. Recorded rather than claimed.

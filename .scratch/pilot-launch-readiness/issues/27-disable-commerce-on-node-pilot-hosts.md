# Disable commerce on the Node pilot hosts

Status: claimed
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

### Implementation plan — 20 Oct 2026

Working directly at the owner's request; branch `stays-launch/27-commerce-off-pilot-hosts` from `main` at `ad5ad72`. Scope: the two Node pilot composition roots, Node pilot configuration, a new acceptance test file, this issue and its map. The local demo, Cloudflare composition, domains and guest kit are unchanged.

| ADR | Constraint | Acceptance criterion / code path |
| --- | --- | --- |
| 0003 | Keep shortlet as the first reference domain without removing the internal commerce pack. | AC1–4: disable only pilot composition; retain demo default. |
| 0004 | Backend owns conversation and transaction state. | AC3–4: verify real HTTP host behavior, not fabricated client state. |
| 0075 | Session authority is server-owned; no credentials in logs. | AC1–4: use synthetic fixtures and session cookies without logging them. |
| 0095 | Node remains a supported adapter; Cloudflare's hosting/security posture stays unchanged. | AC1–4: Node-only changes, Workers regression gate. |
| 0099 | Hosts register packs/routes as composition roots; no domain rules in hosts. | AC1–2: pass the existing disabled composition, no route-specific guards. |
| 0100 | Commerce stays a separate pack; shortlet behavior must not change. | AC3–4: no Shop pack/rail/starters; existing stays tests unchanged. |
| 0101 | Commerce owns its separate object/schema; do not alter Cloudflare composition. | AC1–4: reuse the disabled composition; no domain/storage changes. |

Confirmed test seams from this issue: the production and local pilot HTTP front doors (`GET` commerce/stays paths, `POST /api/turn`, `GET /api/state`) plus validated production startup. Add one named `test()` per criterion, including unauthenticated/authenticated route refusal, a normal stays response to buying text, and stays discovery continuity. Run red before implementation; then build, check, targeted existing pilot suites, one background full suite, and Workers. Existing expectations must not change. No independent subagent review because the owner explicitly requested direct work; perform a separate read-only self-review instead and report that limitation.

### Verification progress — 20 Oct 2026

All new run records below are under `.scratch/test-runs/<run id>/{run.json,output.log}`; pre-existing records were not changed. This checkout's runner lacks the brief's `--file` option and automatic records, so targeted runs invoke the same installed tsx entrypoint with the runner's test-environment defaults and an external recorder. No runner code was changed.

- Baseline build: `3aaad054-e7e8-4e10-80b5-9e00b7f23c37`, exit 0, before any browser run.
- Initial red: `8f988c0a-5ac2-405c-a2af-5adbbb81f072`, exit 1. AC1/2 exposed `/cart` returning 200. The new AC3 test initially rejected hidden, empty shell containers; corrected it to assert hidden containers with no populated starters/rail items, matching the actual criterion. This is a new-test correction, not a changed existing expectation.
- Corrected red: `e68365b2-77bf-4499-9113-bdc6a7dc4620`, 2 passed / 3 failed, exit 1 (AC1 routes, AC1 startup configuration and AC2 routes). AC3 and AC4 already passed before the fix.
- Type check: `c2143c50-b2a8-4fad-afda-0c286d449b04`, `npm run check`, exit 0. Active LSP probes had no findings but were inconclusive; the compiler gate is the confirmed result.
- Targeted green: `0ae54cea-847f-4ab6-8c07-6eda68b5e0c5`, 35 passed / 0 failed, exit 0. Includes all five new tests, production composition, guardrails, request handler and shared database-handle tests.
- Existing local-pilot real-browser suite: `08b5c107-40a0-4089-a4f7-7b99f03ea57a`, 44 passed / 0 failed, exit 0. No existing test file or expectation edited.
- Main-only harness baseline: `c41c23ef-8d99-49ab-807a-ff3aa32cfcda` ran against `ad5ad72` in the docs-only worktree before its edits: 3 passed / 0 failed, exit 0. The reported old Cloudflare harness AC3 failure is not present on this main.
- Full suite: `afc4005d-9f94-4649-9e07-72c5e4d21d64`, complete, exit 1: phase 1 **1,984 passed / 1 failed**, phase 2 **34/34 files passed, 181 tests passed / 2 skipped**. Only failure: `test/guest-process-restart.test.ts`, AC7, `fetch failed` after 904,654 ms under concurrent load. No second full run was started.
- Workers, after the full run ended: `c74f481d-2e53-4d39-acc9-6350a885342e`, **23 files / 159 tests passed**, exit 0.
- Isolated rerun of the only failing file, after all suite/Workers processes ended: `e73fd1e7-d529-4938-b1c4-ba8422e8250f`, **23 passed / 0 failed**, exit 0, 63 seconds. Per the owner's session brief, classify the full-run failure as **contention**, not a repeat application failure. The historical Cloudflare AC3 failure did not recur. An intermediate log-path extraction found no file and launched no tests; the known failing file was then run exactly once in isolation.
- The full run rewrote **29 tracked PNGs** outside this effort and build/tooling changed two generated JS files. Exact paths are listed in `.scratch/stays-launch/27-side-effects.md`. They are not staged or restored. No further browser suite/capture is active.

Read-only self-review rechecked the ADR table: only the three Node pilot files implement the change; host-wide composition, not scattered route guards; fixed disabled Node configuration with startup rejection before resources open; no new environment switch; demo/Cloudflare/domains/kit untouched. New tests cover production, staging and local pilots, unauthenticated/authenticated GET refusal, POST tracking refusal, buying text, and stays continuity. Existing expectation changes: **none**. The build/tooling changed `apps/local-guest/dist/client.js` and `gallery.js` outside issue scope; keep them out of the commit and ask the owner before restoring them. No guest screen source changed.

### Definition of Done self-check — 20 Oct 2026

1. Dedicated mirrored tests for AC1–4: yes; one additional AC1 startup test.
2. Named failure paths: yes; both session states, unknown Units, GET/POST commerce refusal, and invalid/missing injected startup values.
3. ADR discovery/read/table and post-review: yes, as above.
4. No unused injected dependency: yes; no dependency added.
5. No invented policy: yes; disabled composition is the owner's 20 Oct decision and the existing composition vocabulary; no new environment switch or domain threshold.
6. No bearer credentials or restricted identity material added to logs/audit: yes; synthetic fixtures only, no credential logging introduced.
7. `npm run check`: clean. Full suite: one contention failure, isolated rerun 23/23 passed; Workers 159/159 passed. **Owner exception granted** on 20 Oct 2026: after the report explicitly requested acceptance of this single contention failure and permission to restore the 29 screenshots plus two generated bundles, the owner replied **"accept all"**. This waives only the literal zero-failure full-run requirement for this issue, not future failures or gates. Exactly the 31 manifest paths were restored to `HEAD`; inherited changes, including `HANDOFF.md`, were left untouched. No merge, push, deployment, deletion or ADR acceptance was authorized. Implementation is ready to commit; resolution follows that commit.

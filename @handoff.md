# Handoff: Cloudflare Deployment — Wave 4 wave close in progress

## Where things stand

All six Wave 4 slices are **implemented, committed, merged and resolved**. The remaining work is **wave close only**, and it is one step from done: the Rodney headless acceptance run needs one clean re-execution.

Source of truth for map/issues: `C:\AI2026\chat-marketplace-cloudflare` on `infra/cloudflare-deployment`. The main checkout (`C:\AI2026\chat-marketplace`) has unrelated user changes — never clean, reset, stash or stage them. Read the map's Context pointers there; do not re-derive from this file.

### Slices and commits (all merged fast-forward except 09b, a true merge)

| Slice | Branch | Implementation | Delivery record |
| --- | --- | --- | --- |
| 08a guest handler | `infra/cf-08a-guest-handler` | `f1ff86c` | `0f01fce` |
| 08b owner handler | `infra/cf-08b-owner-handler` | `bb247a3` | `3469dde` |
| 08c pilot handler | `infra/cf-08c-pilot-handler` | `6c89dbc` | `c25983f` |
| 09a asset loader | `infra/cf-09a-asset-loader` | `eb2a228` | `6319924` |
| 09b static assets | `infra/cf-09b-static-assets` | `c9237eb` (merge commit) | `eae5bd6` |
| 09c HTTP shim | `infra/cf-09c-http-shim` | `75ccc2d` | `cdcae50` (current HEAD, `cdcae50…`) |

Each issue file has its `## Answer` (test names per criterion, failure paths, deferred-gate notes) and the map has per-slice context pointers. Read those first; this file only adds what isn't there.

### Wave-close evidence so far (on the integrated snapshot, all green)

- Full serial `npm test` (phase 1 concurrent + phase 2 real-browser serial) exited **0** (~20 min background run; log capture produced a 0-byte file, verdict recorded via `C:\AI2026\cf-wave4-full.exit` = `EXIT=0`).
- Full non-browser phase re-run in four foreground chunks on the final snapshot: **337 + 342 + 409 + 293 = 1,381 tests, zero failures**.
- `npm run test:workers`: 27 tests / 5 files pass. `npm run check` (all four programs) clean. `git diff --check` (whitespace) clean.

### The single remaining task: Rodney acceptance (08c AC5)

Run in the integration worktree:

1. `git restore -- apps/local-guest/dist apps/cloudflare/public/_headers` then `git status --short` must show no tracked modifications (only untracked `.scratch/*` and logs). The generate-after-build churn is real: `run-tests`' Cloudflare static-assets test and every `pilot:local`/Rodney bootstrap rewrites these tracked files with LF endings while the checkout is CRLF — restore before any Rodney launch.
2. `npm run pilot:acceptance:rodney -- --Reset` (headless; own evidence at `.scratch/pilot-acceptance-rodney/acceptance-result.json`).
   - Attempt history: run 1 stoped at "Local pilot is not bootstrapped" (fixed by `--Reset`); run 2 reached Guest A and failed at the stale heading assertion; run 3 was refused by the dirty-tree gate because a manual `pilot:local` probe run had re-dirtied the tracked build outputs (restore then rerun).
   - The script predates the guest UI refresh (script `6e14a23` 23 Sep vs UI 30 Sep–2 Oct). Two stale expectations were already fixed **uncommitted** in `scripts/pilot-acceptance-rodney.ps1`: `ax-find heading "Shortlet Concierge"` → `"Shortlet"` (the app bar H1; "Shortlet Concierge" is now the `<title>`/RootWebArea name). The ax-tree itself was probed working headless (see run-2 diagnostic: full tree listed, including heading "Shortlet" level 1).
   - If the journey then surfaces **more stale expectations** (UI-copy drift from the refreshed guest surfaces), stop and record it in `## Comments` rather than rewriting the acceptance harness — that is product work, not Wave 4 scope.
   - On PASS: commit the two-line script fix on `infra/cloudflare-deployment` with the wave record, update `docs/pilot-local-run.md` only if it names the old heading (it does not), and record `status:"PASS"`/`exitCode:0` in the map.

### Then close the wave

- Append a "Wave 4 completion" section to the map (integration worktree) with the evidence: full serial `npm test` exit 0; integrated phase-1 chunks 1,381/0 failures; 27 workerd tests; `check` clean; Rodney result; per-slice commits.
- Note the browser phase + Rodney ran once on the integrated snapshot, per prior-wave convention; per-slice AC deferrals (08c AC5, 09a AC4) are now discharged — say so in each issue's Comments.
- **Do not start Wave 5 (10b+).** The integration branch merges to `main` only after slice 15; no push, no deployment, no staging claim.
- Worktree cleanup: all six slice worktrees may be removed (this wave's slices are merged): `C:\AI2026\chat-marketplace-cloudflare-08a`, `-08b`, `-08c`, `-09a`, `-09c-integration` (no 09b worktree exists; the 09b commit was made in `-09a` and re-branched). Remove without force; the user-authorized main-merge record says worktrees live outside the main repo. The `-09a` worktree is checked out on `infra/cf-09a-asset-loader` at `eb2a228` (correct after the re-branch during 09b). Update handoff notes in the map rather than leaving a new handoff file.
- Known false alarm to dismiss: the previous session's hung `npm run test:workers` does **not** reproduce (15–25 s runs all session).

## Environment pitfalls (all cost time this session)

- `NODE_ENV=production` machine-wide; prefix every node/tsx/npm invocation with `set NODE_ENV=&`.
- Background shell output capture produces 0-byte logs here (even with redirection through the wrapper). Use the `& echo EXIT=%ERRORLEVEL% > file.exit` tail for the verdict, foreground chunks with `findstr` filters for counts, or component-specific artifacts (e.g. Rodney's own `acceptance-result.json`).
- `cmd` invocations through the shell tool lose argument semantics: pass one arg per call or bake everything into the command string; `del` with multiple space-separated args deletes them but errors on trailing `/f`.
- `npm install` is forbidden inside slice worktrees (junctioned `node_modules` → `chat-marketplace-cloudflare\node_modules`; created via `New-Item -ItemType Junction`).
- Junction builds make esbuild bake absolute junction paths into `dist` comments — that is the churn above, never commit it.
- `pilot-local` AC4 flakiness under heavy concurrent load is pre-existing.
- Editing `.ps1` with `//` is a syntax error; use `#`.

## Facts learned this wave worth carrying to 10b (also in issue answers)

- `node:sqlite` **imports** under workerd's nodejs_compat but `new DatabaseSync` throws "Illegal constructor"; a fully injected guest environment (`new LocalGuestEnvironment(config, { database: DurableObjectSqlDatabase, unitRepository, seedDemoUnits })`) constructs and serves the entire no-JS multipart flow inside a Durable Object.
- The `apps/cloudflare` tsconfig programs replace Buffer/DOM ambients such that repo-wide node sources fail to typecheck there; keep the `apps/cloudflare/test/*.spec.ts` free of app imports and vet app integration through the workerd runs. The shim lives in `packages/platform-core/src/http-fetch-shim.ts`, re-exported from `apps/cloudflare/src/http-shim.ts`.
- The staging beta banner wrapper captures at writeHead-time and must `setHeader` **before** `writeHead` (node throws `ERR_HTTP_HEADERS_SENT` otherwise).
- Vite `?raw` CSS import is type-checked now; the real `cf build` proof is 10b's gate (`npx cf build` currently says "No Cloudflare dev-server is installed in this project").

## Suggested skills

- `issue-tracker` — Definition of Done checks for the final wave-close closure records.
- `diagnose` — if the Rodney journey fails at a step that the interactive suites cover, isolate before touching product code.
- `tdd` — only if a product regression (not stale expectation) is confirmed in the Rodney evidence.

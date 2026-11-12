# 03 · Operator inbox and detail re-baseline

Status: resolved
Type: research
Blocked by: none
Phase: 0 (Batch A)
Applicable ADRs: 0041, 0042 (active hours), 0078; guideline §3 (Operator), §5 Operator rows

## What to build

Re-baseline the local back office against the Operator rows in §5: inbox scan order, readable Unit and Guest context, response deadline, decision effect, and duplicate-decision prevention.

- Code: `apps/local-owner/src/local-owner-server.ts` (inbox ~214-245, detail ~339-357, forms ~253-283, legacy `renderOwnerDashboardHtml` ~1150-1190).
- Reach the screens with the helpers behind `test/back-office-request-inbox.test.ts` and `test/back-office-confirm-decline.test.ts`.
- Capture at 320, 390, 768 and 1280.
- Check whether anything still routes to the legacy dashboard.

## Acceptance criteria

1. The inbox and request detail each have matrix rows for hierarchy, deadline, decision effect and duplicate-decision behaviour
2. It is recorded whether the legacy dashboard is still reachable, and from where
3. No code, CSS or copy file is changed

## Rules

- Research only: change no code, CSS, copy or tests. Phase 0 authorises no redesign (guideline §15).
- Synthetic data only. Never open `staging-secrets.env` or print the environment; prefix commands with `env -u LLM_API_KEY`.
- Run only one capture sweep or browser suite at a time. Delete any walkthrough log you create.
- Write matrix rows into `.scratch/ux-guidelines/evidence/03-rows.md` (column header from `evidence-matrix.md`; 05 merges them), keeping what you saw (Observed) separate from what it means (Priority).
- Do not commit. The orchestrator reviews the work and commits it.

## Comments

**Setup (Phase 0, worktree C:\AI2026\chat-marketplace-p0-03 at 4f36ce0, detached).** Junctions created for node_modules and apps/cloudflare/node_modules. `env -u LLM_API_KEY npm run build` ran once. Its line-ending rewrite touched six tracked files (apps/cloudflare/public/_headers, apps/local-guest/dist/client.js, gallery.js, landing.js, offer.js, payment.js); restored with `git restore` in this worktree only, as AGENTS.md directs.

**Commands run (exact):**
- `env -u LLM_API_KEY npx tsx <throwaway>/capture-03.mts` (throwaway script outside the repo, in C:\Users\Cyrus\AppData\Local\Temp\p0-03\; it imports the worktree helpers `startSignedInOperator` and `launchRealBrowser`). Two runs. The first run's decline-open captures were dark despite the name; the script never set data-theme for that loop. Fixed and re-run. Final run: exit 0. Writes screenshots/03/ (inbox, detail-awaiting, detail-confirmed in light and dark at 320, 390, 768, 1280; detail-decline-open-light at four widths), findings-03.txt and page-text-1280-light.txt.
- `env -u LLM_API_KEY npx tsx --test test/back-office-confirm-decline.test.ts test/back-office-request-inbox.test.ts test/operator-detail-clarity.test.ts`: tests 12, pass 12, fail 0.
- `env -u LLM_API_KEY npm run check`: exit 0 (tsc and worker bundle guard).
- Not run: `npm test`, `npm run test:workers`, any other browser suite. Issue 03 is research and changes no test or code, so none is in scope for it; the batch gate runs them later.

**What was reached.** Inbox and request detail (awaiting and confirmed) at all four widths in light and dark, the Decline disclosure open at four widths, and the server duplicate path. Synthetic data only; the operator session was a fixture cookie set on the Chrome tab. No real Operator, no staging, no Cloudflare command, no secrets file.

**Could not reach / not measured.**
- The native attest and reason inputs measure 24x24. Their labels (min-block-size 2.75rem) are the real targets, but the label box was not measured separately in this run.
- Live reminder announcements and the time-left countdown were not watched over time. Covered by the test file (AC1, AC2 of back-office-request-inbox).
- The no-JS duplicate path was checked through HTTP (409), not through a browser without JavaScript.

**Legacy dashboard (AC2).** renderOwnerDashboardHtml is reachable only at GET / when startLocalOwnerServer runs with production unset (apps/local-owner/src/local-owner-server.ts ~1593-1599). That path is `npm run owner:local` (apps/local-owner/src/cli-start.ts, default port 3000). The dev branch also exposes GET /api/state and POST /action/* with no sign-in check. Every deployed or pilot path passes production: true (apps/cloudflare/src/shortlet-pilot-do.ts, apps/pilot/src/local-pilot-server.ts, apps/pilot/src/pilot-server.ts), so "/" is not served there. backOfficePage has no link to "/". Repo-wide search found the function only in local-owner-server.ts, the test operator-detail-clarity.test.ts (AC4) and issue 26 notes. Decision for the owner: keep it as a dev-only surface, or retire it in Phase 4.

**Summary.** 13 evidence rows in .scratch/ux-guidelines/evidence/03-rows.md. Highest: P2 for the detail's missing Guest name (row 5) and the after-confirm state with no next-step text and a stale deadline line (row 9). Duplicate prevention holds: the client guard disables submit, and the server refuses repeats with a closed message (row 10, 11). No horizontal overflow anywhere. The 44px rule holds for links and buttons; the native radio and checkbox inputs are only the visual part of the label targets.

**Acceptance (3 criteria).**
- AC1 done: inbox rows (rows 1-4), detail rows (5-9), duplicate rows (10-11) in 03-rows.md cover hierarchy, deadline, decision effect and duplicate behaviour.
- AC2 done: legacy reachability recorded above and in row 13.
- AC3 done: no code, CSS, copy or test change. Only new files are 03-rows.md and screenshots/03/ (plus this Comments section). Build line-ending rewrites were restored.
- Status left as ready-for-agent; no commit made.

### Orchestrator review (12 Nov 2026)

Confirmed in code: `renderOwnerDashboardHtml` is served only by `GET /` behind `!production` (`local-owner-server.ts`); the Worker sets `production: true` (`shortlet-pilot-do.ts`) and only `npm run owner:local` leaves it unset, so the legacy dashboard and its unauthenticated `/api/state` and `/action/*` are local-only.

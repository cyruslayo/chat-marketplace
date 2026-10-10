<objective>
Deliver slice B1 of the back office: a shared back-office shell and a "waiting on you" home page. The person running the platform signs in once and works across every owner they hold a grant for. Today the home page at `/operator` shows raw actor and tenant ids, which tell them nothing. After this slice, every back-office page shares one header (their name, navigation and Log out), and the home page lists what needs their attention, soonest deadline first. It must be usable on a 320px phone.
</objective>

<context>
- Spec: `scratch/operator-dashboard/issues/01-back-office-home.md` (identical copy under `.scratch/operator-dashboard/`). Implement exactly its four acceptance criteria and its Definition of Done.
- Plan: `scratch/operator-dashboard/map.md` has the delivery rules, the hotspot rule and decisions D1–D8. `PRD.md` in the same folder explains the business: owners never sign in, and "you" are the platform operator.
- This slice builds on B0, prompt `001`, branch `bo/b0-operator-session-helper`. B0 added `test/helpers/operator-session.ts`, with helpers for sign-in, authenticated GET and POST, cross-origin POST, session revoke, grant revoke and a clock-controlled server. Read the helper and the B0 entry under "Context pointers" in the map first. Use the helper, and do not add new login code.
- Code:
  - `apps/local-owner/src/local-owner-server.ts`:
    - `operatorShellHtml` is the current home page, with raw ids;
    - `operatorInboxHtml` and `operatorRequestHtml` each place `logoutForm()` differently;
    - `operatorLoginHtml`;
    - the route handlers in `startLocalOwnerServer`. `/operator` returns 401 with a `Location` header but no redirect status, and the other routes return a bare 401.
  - `pageShell`, `icon`, `escapeHtml` and `formatMoney` come from `apps/web/src/ui-kit.ts`. Styles are in `apps/web/src/shortlet-foundations.css`. Guest pages (`apps/local-guest/src/guest-server.ts`) also use `pageShell`, and they must not change.
  - `apps/local-owner/src/local-owner-environment.ts`:
    - `listOperatorRequestArtifacts(principal)` merges every owner the principal holds a grant for;
    - `config.representativePersonName` is a name source;
    - the operator repository has `operatorName`.
  - `formatWat` in the server gives absolute WAT times.
  - Pilot startup banner: `apps/pilot/src/cli-local-start.ts` prints `/operator/` and `apps/pilot/src/cli-start.ts` prints no operator URL. AC4 wants the `/operator/login` URL printed. `test/pilot-local.test.ts` and `test/pilot-production-composition.test.ts` may assert the banner.
- Transfers to verify (B6) and payouts due (B7) are not built yet. The home page shows requests only. Structure the "waiting" list so that later item kinds can be added without rewriting it, but do not build them now.
- Follow `AGENTS.md`. The implementation protocol and anti-pattern #1 (fail closed) apply directly. Also follow `docs/agents/coding-standards.md` and `docs/agents/domain.md`.
</context>

<requirements>
1. Create branch `bo/b1-back-office-home` from `bo/b0-operator-session-helper`. Set the issue's `Status: claimed` in both copies of the issue file.
2. Read ADRs 0078, 0082, 0086 and 0075, plus 0041 for the 30-minute window. In your plan, write a table with one row per ADR: the constraint it imposes, and the AC or code path it affects.
3. Write failing tests first, in a new `test/back-office-home.test.ts`, with one `test()` per AC. Name each test after the criterion text ("AC1 — Every back-office page shares one header…").
   - Each test that performs an action also asserts the four standard failure paths: revoked or expired grant, no session, cross-origin POST, and a stale or expired target.
4. AC1: build one layout function that every `/operator/*` page renders through, including the inbox and the request detail. The header has the signed-in person's name, navigation and a Log out form.
   - Link only to shipped slices; for now that is Home and Requests.
   - No page uses an actor, tenant, request or unit id as its main label; use the owner name and apartment title. Keep raw ids out of visible labels. They may remain in `data-*` attributes for tooling.
5. AC2: the home page lists the pending requests across all granted owners, soonest deadline first.
   - Each item shows the owner, the apartment and the absolute WAT deadline, and links to `/operator/requests/<id>`.
   - With nothing waiting, the page says so plainly.
   - Deadlines come from the projected `operatorResponseDeadlineAt` and are never recalculated (ADR 0077).
6. AC3:
   - An expired or revoked session on any GET under `/operator` redirects (303) to `/operator/login` with a plain reason shown on the sign-in page. Carry the reason as a fixed code in the query string, never as free text or an id.
   - An action for an owner whose grant was revoked is denied.
   - A missing session fails closed.
7. AC4: pages reflow at 320px with no horizontal scroll, and interactive targets are at least 44px. The pilot startup banner prints the full `/operator/login` URL.
8. Before resolving, check every item of the issue's Definition of Done and of `docs/agents/issue-tracker.md` explicitly. Append `## Answer` to the issue, set `Status: resolved` in both copies, and add a B1 line under "Context pointers" in both copies of the map.
</requirements>

<constraints>
- Change no Guest page, and no shared ui-kit or foundations behaviour that the Guest pages rely on. Add back-office-only classes or options instead, because the guest UI was just polished across milestones M1–M4.
- Do not change the request inbox ordering, the reminders, or the confirm and decline forms beyond moving them into the shared layout. Those belong to B2 and B3, which edit the same file next.
- Do not invent policy wording. Deadline and window wording traces to ADR 0041 or `domains/shortlet/CONTEXT.md`. If wording you need is not there, ask rather than write your own.
- Keep ids, tokens, session secrets and contact values out of logs and telemetry (ADR 0075).
- Stage files by explicit path, because the working tree has many unrelated untracked files. Commit locally. Do not push or open a PR; the user reviews per milestone.
</constraints>

<verification>
- `npm run check`: zero errors.
- `npm test`: green, except the known-flaky tests listed in `git show HEAD:scratch/map.md` (search "flaky"). Re-run any failure alone and show that it passes.
- `npx tsx --test test/back-office-home.test.ts test/operator-request-inbox.test.ts test/operator-session-helper.test.ts` passes.
- Walkthrough:
  - Start the operator server (`npm run owner:local`, or `npm run pilot:local` with a token from `npm run pilot:local:operator-token`).
  - Check sign-in, home, the inbox and a request detail at 320px, 375px and 1280px, and once with JavaScript disabled.
  - Confirm there is no horizontal scroll and that targets are at least 44px. Measure with the browser tools; do not guess.
  - Keep a screenshot of the home page at 320px.
</verification>

<done_when>
- All four ACs have named, passing tests that include the failure paths.
- Every `/operator/*` page renders through the shared layout, and no raw id is used as a label.
- The banner prints `/operator/login`.
- Check and tests are green, and the work is one commit on `bo/b1-back-office-home`.
- The issue is resolved, and the map has a B1 context pointer.
</done_when>

<report>
- Status: done / partial / blocked (and why)
- Files changed
- ADR table, with a check mark per row confirming the constraint is reflected in code
- Verification results (paste failures verbatim), plus the walkthrough findings per width and without JavaScript
- The shared layout's function name and signature, and how later slices add a nav link or a waiting-item kind
- Open questions, or wording gaps you raised instead of inventing
</report>

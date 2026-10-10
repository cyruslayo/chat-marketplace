<objective>
Deliver slice B2 of the back office: rebuild the request inbox around the 30-minute response window. The operator must answer each Guest's Booking Request within 30 minutes during 8 AM–8 PM WAT, across every owner they represent (ADR 0041). They need to see at a glance which request is most urgent, how long is left, and which requests failed delivery, so that those are never mistaken for missed responses.
</objective>

<context>
- Spec: `scratch/operator-dashboard/issues/02-request-inbox.md` (identical copy under `.scratch/operator-dashboard/`). Implement exactly its four acceptance criteria and its Definition of Done.
- Plan: `scratch/operator-dashboard/map.md`. Decision D2: the 10- and 25-minute reminders are in-page only. Read the "Context pointers" for B0 and B1 first.
- This slice builds on:
  - B0 (`test/helpers/operator-session.ts`), for sign-in and failure paths;
  - B1, branch `bo/b1-back-office-home`, which added the shared back-office layout and the "waiting on you" home page.
  Render through B1's layout, and keep the home page consistent with the inbox ordering.
- Code:
  - `operatorInboxHtml` in `apps/local-owner/src/local-owner-server.ts` renders the current inbox. It is unsorted, has no time left and no reminder state, and falls back to `unitId` as a label.
  - `listOperatorRequestArtifacts` in `apps/local-owner/src/local-owner-environment.ts`, around line 411, drops every status except disclosed, confirmed, declined and expired. `delivery_failed` requests are therefore invisible today, and AC3 needs them.
  - In `domains/shortlet/src/booking-request.ts`:
    - the projected facts include `disclosedAt` and `operatorResponseDeadlineAt`;
    - `delivery_failed` is set around line 530 after the 5-minute technical window (ADR 0043);
    - `manager.checkAndResolveExpiry` exists.
    Check whether reads already resolve expiry lazily, and how the artifact projection handles a passed deadline.
  - The environment and server take an injected `clock`. Use it for "server time", and never `Date.now()` in rendering.
- Follow `AGENTS.md`. Anti-pattern #2 (static projections for time-bound state) is the heart of AC2, and anti-pattern #3 (no hardcoded policy numbers) applies to the 10, 25 and 30 minute values. Also follow `docs/agents/coding-standards.md` and `docs/agents/domain.md`.
</context>

<requirements>
1. Create branch `bo/b2-request-inbox` from `bo/b1-back-office-home`. Set the issue's `Status: claimed` in both copies.
2. Read ADRs 0041, 0043, 0077 and 0080, and in your plan write the ADR-to-constraint-to-AC table.
3. Write failing tests first, in `test/back-office-request-inbox.test.ts`, with one `test()` per AC named after the criterion. Use a controlled clock to place requests at 0, 10, 25 and 31 minutes after disclosure.
4. AC1:
   - Awaiting requests come first, ordered by deadline.
   - Each shows the owner, the apartment, the guest name, the dates, the party size, the All-In Stay Total, the absolute WAT deadline, and the time left computed from the server clock at read time.
5. AC2:
   - A request past its window shows as expired on the next read, with no background job: evaluate lazily against the clock, in the domain or the projection, not only in the HTML.
   - An expired request cannot be confirmed; test the POST.
6. AC3:
   - Include `delivery_failed` requests in the inbox, shown as "Delivery Failed" with their own status label and tone.
   - Never label them as a missed or expired response.
   - Confirm that a delivery failure does not count as an operator timeout in any record this slice touches.
7. AC4:
   - At 10 and 25 minutes after disclosure, the request shows a reminder state in the page.
   - The reminder is announced once to assistive technology: a single live region, not one per row, and not repeated on each render.
   - Without JavaScript, the absolute WAT deadline is still shown.
   - If you add a client-side countdown, it must be progressive enhancement over the server-rendered values, not the source of truth.
8. Put the reminder offsets (10 and 25 minutes) in one named, documented place, citing ADR 0041, and reuse the domain's existing 30-minute constant if there is one; search before adding a new one.
9. Before resolving:
   - check the issue's Definition of Done and `docs/agents/issue-tracker.md` item by item;
   - append `## Answer` to the issue and set `Status: resolved` in both copies;
   - add a B2 line under "Context pointers" in both copies of the map.
</requirements>

<constraints>
- Do not touch the confirm and decline forms or their wording; that is B3, which edits this file next.
- Channel reminders (WhatsApp, SMS or email) are out of scope, per D2.
- Keep the existing tests in `test/operator-request-inbox.test.ts` passing. If an assertion there encodes behaviour this issue deliberately changes, update it, and name each change in your report.
- Wording for deadlines and states traces to ADR 0041, ADR 0043 or `domains/shortlet/CONTEXT.md` (look up "Delivery Failed" there). Ask rather than invent.
- Stage by explicit path, and commit locally only; do not push or open a PR.
</constraints>

<verification>
- `npm run check`: zero errors.
- `npm test`: green, apart from the known-flaky tests listed in `git show HEAD:scratch/map.md`, re-run alone to show they pass.
- `npx tsx --test test/back-office-request-inbox.test.ts test/back-office-home.test.ts test/operator-request-inbox.test.ts` passes.
- Walkthrough of the inbox at 320px, 375px and 1280px, and with JavaScript disabled. Seed or adjust the clock so the walkthrough shows at least one awaiting request, one in a reminder state, one expired and one Delivery Failed. Confirm there is no horizontal scroll and that targets are at least 44px.
</verification>

<done_when>
- All four ACs have named, passing tests, including the expired-confirm refusal and the Delivery Failed-is-not-timeout assertion.
- Expiry is evaluated lazily against the injected clock.
- Check and tests are green, and the work is one commit on `bo/b2-request-inbox`.
- The issue is resolved, and the map has a B2 context pointer.
</done_when>

<report>
- Status: done / partial / blocked (and why)
- Files changed
- ADR table, with each constraint confirmed in code
- Verification results (paste failures verbatim), and walkthrough findings
- Where the lazy expiry and the reminder offsets live
- Any existing assertion you changed and why, plus open questions
</report>

<objective>
Deliver slice B3 of the back office, which completes milestone M1: confirming a Booking Request on the owner's behalf, and declining it with a fixed reason. Confirming is a legal re-attestation made for a named owner (ADR 0041). Declining releases the dates straight away. The operator must know exactly what each action does before taking it, and a stale or duplicate decision must never take effect.
</objective>

<context>
- Spec: `scratch/operator-dashboard/issues/03-confirm-and-decline.md` (identical copy under `.scratch/operator-dashboard/`). Implement exactly its four acceptance criteria and its Definition of Done.
- Plan: `scratch/operator-dashboard/map.md`. Decision D1 applies:
  - the only decline reasons are "Dates not available" and "Other reason", with no free text;
  - the Guest never sees the reason;
  - "Dates not available" records a calendar-accuracy event (ADR 0039).
  Read the "Context pointers" for B0–B2 first.
- This slice builds on:
  - B0 (`test/helpers/operator-session.ts`);
  - B1 (the shared layout);
  - B2, branch `bo/b2-request-inbox`, with lazy expiry, Delivery Failed and reminders.
- Code:
  - `operatorRequestHtml` in `apps/local-owner/src/local-owner-server.ts` renders the current decision forms. Confirm has no attestation and no affirmative. Decline has no reason. The detail page labels facts with raw `requestId` and `unitId`. The action route `POST /operator/requests/:id/(confirm|decline)` returns 303 on success and 409 with the current page on rejection.
  - In `apps/local-owner/src/local-owner-environment.ts`:
    - reuse `confirmOperatorRequest` and `declineOperatorRequest`, as the issue requires;
    - `declineOperatorRequest` already accepts an optional `reason` and writes it to audit;
    - the legacy `declineBookingRequest` defaults to the invented string "Dates unavailable due to private maintenance". Do not use it for the back office.
  - A calendar-accuracy event does not exist anywhere in the codebase yet. Search `domains/shortlet/src` (availability, operator enforcement and reliability) for the closest existing concept before adding one. Read ADR 0039 paragraph 2 and `domains/shortlet/CONTEXT.md` for the term.
  - Check how the Guest-side projection of a declined request is built (`apps/local-guest/src/guest-server.ts` and the booking-request artifact) so you can prove the reason never reaches it.
- Follow `AGENTS.md`. Anti-pattern #1 (fail closed on a missing affirmative or reason) is central. Also follow `docs/agents/coding-standards.md` and `docs/agents/domain.md`.
</context>

<requirements>
1. Create branch `bo/b3-confirm-and-decline` from `bo/b2-request-inbox`. Set the issue's `Status: claimed` in both copies.
2. Read ADRs 0041, 0039, 0005, 0006, 0072 and 0075, and in your plan write the ADR-to-constraint-to-AC table.
3. Write failing tests first, in `test/back-office-confirm-decline.test.ts`, with one `test()` per AC named after the criterion. Every action test also asserts the four standard failure paths: revoked or expired grant, no session, cross-origin POST, and a stale or expired target.
4. AC1: the confirm form names the owner and lists the attestation items:
   - availability;
   - price;
   - included services;
   - arrival;
   - maintenance;
   - access;
   - no external conflict.
   It requires an explicit affirmative, such as a required checkbox that the server also checks. A POST without the affirmative is refused server-side and changes nothing, even if the HTML `required` is bypassed.
5. AC2: the confirm copy says it creates a Conditional Booking Offer, and that the stay becomes a Reservation only after the Guest pays. Use the glossary terms from `CONTEXT.md` exactly.
6. AC3: decline.
   - Decline requires one of exactly two reason codes, "Dates not available" or "Other reason". Any other value, or a missing value, is refused.
   - The copy says the dates are released immediately.
   - Only "Dates not available" records a calendar-accuracy event. It is minimal: a request, unit, owner, time and reason code, with no free text and no guest data (ADR 0075). It lives in the most fitting existing record, such as audit or the domain's reliability store, and the choice is explained in your report.
   - A test proves the Guest's view of the declined request contains neither reason.
7. AC4:
   - A decision on a request that is already decided, expired or at a stale version is refused (409) and re-renders the current state.
   - Pass the artifact version or `basedOn` value the form was rendered from, and reject a mismatch, so that two tabs cannot both act (ADR 0072).
   - A repeated identical POST is idempotent and makes no second offer.
8. Replace the raw `requestId` and `unitId` labels on the detail page with the owner and apartment names, consistent with B1 AC1.
9. Before resolving:
   - check the issue's Definition of Done and `docs/agents/issue-tracker.md` item by item;
   - append `## Answer` to the issue and set `Status: resolved` in both copies;
   - add a B3 line under "Context pointers" in both copies of the map, noting "M1 complete: ready for review (B0–B3)".
</requirements>

<constraints>
- Reuse `confirmOperatorRequest` and `declineOperatorRequest`, and extend them only as needed (reason code, version check). Parallel command paths would bypass the grant re-check and audit (ADR 0072, ADR 0082).
- No free-text decline reason anywhere, whether in the form, the API or the storage (ADR 0075, D1).
- Operator Holds, blocking dates and the calendar screen are out of scope (B8). The calendar-accuracy event is a record only; it has no UI.
- Keep `test/operator-request-inbox.test.ts` passing. Where its confirm and decline POSTs now need an affirmative, reason or version, update them through the B0 helper, and list each change in your report.
- Attestation and consequence wording traces to ADR 0041, ADR 0005 or `CONTEXT.md`. Ask rather than invent.
- Stage by explicit path, and commit locally only; do not push or open a PR.
</constraints>

<verification>
- `npm run check`: zero errors.
- `npm test`: green, apart from the known-flaky tests listed in `git show HEAD:scratch/map.md`, re-run alone to show they pass.
- `npx tsx --test test/back-office-confirm-decline.test.ts test/back-office-request-inbox.test.ts test/back-office-home.test.ts test/operator-request-inbox.test.ts` passes.
- Walkthrough of the request detail, confirm and decline at 320px, 375px and 1280px, and with JavaScript disabled:
  - confirm without the affirmative is refused;
  - decline with each reason works;
  - a second tab's stale decision shows the current state.
</verification>

<done_when>
- All four ACs have named, passing tests, including the server-side refusal paths and the proof that the Guest never sees the reason.
- The calendar-accuracy event is recorded only for "Dates not available".
- Check and tests are green, and the work is one commit on `bo/b3-confirm-and-decline`.
- The issue is resolved, and the map marks M1 ready for review.
</done_when>

<report>
- Status: done / partial / blocked (and why)
- Files changed
- ADR table, with each constraint confirmed in code
- Verification results (paste failures verbatim), and walkthrough findings
- Where the calendar-accuracy event is recorded and why there
- Changed legacy assertions, open wording questions, and a summary of the M1 branch stack (B0 → B3) for review
</report>

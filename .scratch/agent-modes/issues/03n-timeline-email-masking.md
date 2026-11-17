# Mask the typed email in the existing thread timeline

Status: resolved
Type: task (behaviour change; an existing test assertion may change deliberately — see Open owner decisions)
Requested: 17 Nov 2026

## Parent

[ADR 0093](../../../docs/adr/0093-establish-guest-accounts-and-sign-in-by-emailed-code.md) ("Sensitive data and audit" — email addresses never appear in URLs, ordinary logs, audit records or general interaction state); ADR 0075 (one redaction chokepoint); [03e OD-1 and Comments](03e-lane-event-rows-and-export.md) (the owner chose option (a): lane rows mask email since 0aa1c11; the thread projection gap is this issue). Map slice `0093-email`.

## Why

Facts recorded in the 03e work:

- The thread timeline stores typed guest text as the guest typed it. `redactSensitiveData` (`packages/platform-core/src/redaction.ts`) masks phone, bearer-token and card shapes, but not email addresses.
- ADR 0093 says email addresses never appear in general interaction state. The timeline a guest reads back, and the persisted `guest_threads` timeline, are general interaction state.
- 03e masks email when a lane row is written (0aa1c11; the AC3 email test is un-skipped and asserts the address is not stored), so the exports are covered — but the timeline projection still carries the typed email in plaintext, including on a cold restore.

## What to build

1. **Survey first.** Record in Comments exactly where a typed email reaches the timeline today: which events echo it (contact-details entry, the saved-email receipt, chat replies that quote the address) and which tests assert that echo.
2. **Mask in the projection.** The timeline (in-memory lanes and the persisted `guest_threads` timeline text) stores the email in the same masked form 03e uses for lane rows. One mask text, shared with the lane-row rule.
3. **Contact data untouched.** The typed email keeps reaching the places ADRs 0092/0093 approve as contact records: the contact-details surface, the request draft, the Booking Request and the checkout handoff. No new redaction rule applies to those paths.
4. **Fail closed.** An entry that cannot be masked (an unparseable or empty rule result) keeps the previous behaviour only if the owner says so; the default recommendation is to fail closed like the lane-row writer.

## Open owner decisions

1. **Where the mask is applied.** (a) At the store chokepoint where timeline text is saved (covers restore and persistence in one place), or (b) where the echo copy is built (the message the guest reads names the mask from the start). Recommendation: (a), the same chokepoint pattern as the lane rows, so the store stays the single fail-closed point.
2. **Model history.** The assistant runtime builds the model's history from prior guest text. Does history inherit the masked form (03e's option (b), which touches every redaction caller) or keep the typed form (history never leaves the request)? Recommendation: masked, matching ADR 0093's "general interaction state".
3. **Mask text.** Confirm the same mask text as the lane-row rule (from 0aa1c11), or name a different one for guest-facing echoes.
4. **Existing assertions.** Any test that today asserts a plaintext email in the timeline changes deliberately, recorded in Comments with the reason, as with the O8 changes.

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- |
| 0093 | Email addresses never appear in general interaction state; contact records are the approved exception. | Steps 2 and 3; AC 1 and 3. |
| 0075 | One redaction chokepoint; stored interaction data is redacted only. | Step 2; AC 2. |
| 0106 | Model history and perimeter checks; no freeform authority from stored text. | Owner decision 2. |
| 0107 decision 11 | Lanes are the projection; the timeline is per task. | Step 2 covers lanes and the persisted timeline together. |

## Acceptance criteria

Each is its own `test()` in a new `test/timeline-email-masking.test.ts`, with the assistant runtime enabled and a cold restore before every event, clock 2026-10-27, a staging-like guest with no seeded phone or email.

1. A timeline entry containing a typed email stores the masked form in the in-memory lane and the persisted timeline, and a cold restore returns the masked form.
2. The same entry written to `guest_thread_lane_events` keeps the existing 03e rule (regression guard, no new logic).
3. The typed email still reaches the contact-details surface, the request draft and the checkout handoff unmasked (guard test; no new authority).
4. An email typed in one lane does not appear in plaintext in any other lane or surface (fail closed).
5. A chat reply that echoes the address uses the masked form, and no test asserts a plaintext email in the timeline afterwards.

## Verification

- `env -u LLM_API_KEY npm run check`.
- `env -u LLM_API_KEY npx tsx --test test/timeline-email-masking.test.ts test/guest-thread-lane-events.test.ts test/assistant-lane-events.test.ts` plus the cold-journey file's email step.
- Affected: contact-details and guest-verification test files; run those the survey names.
- Record the exact commands and pass counts under `## Comments`.

## Out of scope

- Backfilling existing stored timelines (the same open question as the 03e backfill; say so in Comments if it recurs).
- Payment references and their ADR 0096 exemption.
- Sign-in codes and account emails (ADR 0093 platform paths).

## Comments

**Read first (step 2):** ADR 0093 (projection, email and redaction clauses), 0075, 0106 (in full), 0092 (no email or timeline clause), 0107 decision 11 and its restore amendment, the 03e Comments (OD-1 and the 0aa1c11 lane-row rule), `docs/agents/coding-standards.md`, `docs/agents/issue-tracker.md` (Definition of Done).

**Survey (step 1, before code).** Where a typed email reaches the timeline:
- Assistant-managed turns write no guest text. `#decorateResult` sets `discardUserInput: true` (`apps/local-guest/src/shortlet-app.ts`), so a stay search that carries an email leaves only the assistant entry. Probed: the stored projection held only the assistant reply.
- Turns the assistant does not manage (greetings, "My email is ...", unclear text) push the typed text through `#rememberResult` into `#pushLaneEntry` after `redactSensitiveData` (phone and token only). The email is plaintext in the in-memory lane and in the persisted `guest_threads` projection. The lane rows were already masked by the 03e writer.
- Assistant prose never enters the timeline: `#assistantTimelineMessage` returns fixed copy and receipts are fixed `GUEST_RECEIPTS`. So no chat reply quotes the address. The only echo is the guest's own typed text.
- Contact-details entry and the email save go through the structured surface (`GUEST_EMAIL_SUBMIT_EVENT`, `contactValue`), not timeline text. There is no saved-email receipt.
- Model history: the runtime keeps its own `conversationHistory`, not the timeline (see D2).
- Tests that assert a plaintext email in the timeline before the change: none. Checked: `test/guest-thread-lane-events.test.ts:76-81` (row masked, 03e AC3, unchanged), `test/local-guest-shell.test.ts:119` (telemetry, not timeline), `test/assistant-turn-record.test.ts:136` (turn-record canary, not timeline), `test/guest-account-sign-in.test.ts` (email literals; the timeline is only counted).

**Decisions.**
- D1 (owner decision 1, mask point). `#pushLaneEntry` in `apps/local-guest/src/shortlet-app.ts` is the single point where guest-visible timeline text enters. It stores the masked entry in the in-memory lane, and the same masked text feeds `pendingLaneEvents`, so the persisted projection and the lane rows take it too. The store writer applies the same helper to the lane-row text (`saveThreadRecord`). The store receives the projection as an opaque JSON string, so the mask is applied before serialisation, not inside the store. This is a deliberate reading of "store chokepoint".
- D2 (owner decision 2, model history). The owner's premise (history is built from the timeline) does not match the code: the runtime builds history from its own `conversationHistory`. The mask is applied at `#sanitizeHistory` in `apps/local-guest/src/assistant/assistant-runtime.ts`, which every committed history passes through, so prior guest text in history is masked. The current turn's model input is unchanged: the planner still receives the guest's words for the turn it handles. Owner to confirm this reading.
- D3 (owner decisions 3 and 4, one shared rule). `maskEmailAddresses` and `EMAIL_ADDRESS_MASK` in `packages/platform-core/src/redaction.ts` hold the lane-row regex and the `[REDACTED]` text. The store writer, the shortlet app and the assistant runtime use them. `redactSensitiveData` is unchanged.
- D4 (owner decision 2, contact records). No redaction was added to the contact-details surface, request draft, Booking Request or checkout handoff.
- D5 (fail closed). The mask is a pure replace. A non-string input throws inside `#pushLaneEntry` before any state changes, so the entry is not stored. The dedupe in `#rememberResult` compares against the masked form.
- Out of scope, not backfilled: thread projections already stored before this change keep their plaintext timeline, and a restore reads them as stored. This is the same open question as the 03e backfill; it recurs here.

**Changed assertions (owner decision 4).** None. The survey found no test asserting a plaintext email in the timeline, so no existing assertion changed.

**Acceptance criteria to tests.** `test/timeline-email-masking.test.ts`, one `test()` per AC, named after the criterion: AC1 in-memory lane, persisted timeline and cold restore masked; AC2 lane row masked (03e rule, guard); AC3 the contact record keeps the real email through the structured email step after a masked chat turn, and the persisted timeline holds no plaintext (guard); AC4 no lane row, surface or stored projection holds the plaintext; AC5 no timeline entry of any role holds the plaintext, and the guest's own echo is masked. Every event after the first is a cold restore (`coldApp`), on the 27 Oct 2026 clock with a staging-like guest.

**ADR table.** 0093: masked timeline and lane rows, contact records untouched (D1, D4). 0075: one shared helper, `redactSensitiveData` unchanged (D3). 0106: history masked at the sanitise point, no new authority, no keyword path (D2). 0107 decision 11: the per-task lane is the masked projection (D1). 0092: no contact-date or stay-fact change.

**Verification (exact commands, prefixed with `env -u LLM_API_KEY`).**
- Red, before code: `npx tsx --test test/timeline-email-masking.test.ts`: tests 5, pass 1 (AC2, the 03e guard), fail 4 (AC1 in-memory and persisted plaintext; AC3 failed only on the new timeline check; AC4 and AC5 plaintext in the stored timeline).
- Green, after code: `npx tsx --test test/timeline-email-masking.test.ts`: tests 5, pass 5, fail 0.
- `npm run check`: clean (tsc for root, Cloudflare, Cloudflare test and tooling configs, plus the Worker bundle guard).
- `npx tsx --test test/timeline-email-masking.test.ts test/guest-thread-lane-events.test.ts test/assistant-lane-events.test.ts test/assistant-cold-journey.test.ts test/guest-contact-pilot.test.ts test/assistant-paystack-checkout-contact.test.ts test/move-guest-verification-to-checkin.test.ts test/assistant-recording-clients.test.ts test/assistant-task-lanes.test.ts test/assistant-turn-record.test.ts test/agent-mode-shell.test.ts test/assistant-turn-stop-cold-restore.test.ts test/local-guest-shell.test.ts`: tests 125, pass 125, fail 0, skipped 0. The cold-journey file (including its email step) passes.
- `npx tsx --test test/guest-account-sign-in.test.ts test/prevent-interaction-security-failures.test.ts`: tests 78, pass 78.
- `npm run test:workers -- apps/cloudflare/test/daily-export.spec.ts` (the lane-row writer's Worker spec, through the shared store): tests 10, pass 10.
- Not run here: full `npm test` and full `npm run test:workers`. They are the once-per-batch pre-merge gate (AGENTS.md, Test scope), so Definition of Done item 7 holds for this issue's own and affected tests, and the full suite is deferred to the batch gate.
- No `client.ts` change, so no `dist/client.js` rebuild.

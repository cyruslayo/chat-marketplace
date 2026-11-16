# Mask the typed email in the existing thread timeline

Status: needs-triage
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

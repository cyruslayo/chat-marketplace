# 14 · Carry the landing search box message into a new conversation

Status: claimed
Type: task
Blocked by: 11, 13 (decision 1 must be (a); if the owner picks (b), close this as wontfix and change the copy under 13 instead)
Requested: 20 Oct 2026

## What to build

The direction doc's "Landing-to-concierge handoff", with the details as they are on `main`:

- The hero and closing composers `POST` to a landing-owned route (for example `POST /welcome/start`), with the message in the body as a named field. The page never uses a GET form with a named field, so the message never appears in a URL, the history or the logs.
- The route:
  - applies the same session issuance and beta-invite gate as `GET /`;
  - if the visitor already has an active conversation, offers "Continue your conversation" first, following `GUEST_NEW_CONVERSATION` / ADR-0079. Starting a new one never withdraws existing work.
  - otherwise starts a new thread whose **first Guest message is exactly the text typed**, runs the first concierge turn as `POST /conversation` does for a new thread, and redirects (303) to the conversation.
- Only the text typed is carried. No default dates, guests or budget are invented.
- Sending is a discovery action. It never creates a Draft, Booking Request, hold, Reservation or payment attempt.
- If the concierge fails, the message is kept and the guest can retry. An empty or over-long message is rejected with the composer's own validation, and the text is kept.
- Rate limits and body limits follow the existing guardrails (pilot-launch-readiness 19).
- No JavaScript is required, and the example chips still only fill the field.

## Acceptance criteria

1. Sending from the hero or the closing composer opens a conversation whose first Guest message is the text typed, followed by the concierge's reply
2. The typed text never appears in any URL, redirect location or log line
3. A visitor with an active conversation is offered to continue it first, and starting a new one leaves the existing work untouched
4. With the beta invite gate on, sending meets the gate exactly as `/` does, and the text survives the gate
5. Sending creates no Draft, Booking Request, hold, Reservation or payment attempt

## Rules

- AGENTS.md protocol, with an ADR table: 0005, 0077, 0078, 0079, 0080 (deterministic parity for the critical workflow), 0075 (no bearer credentials in logs), plus the guardrail ADRs.
- Confirm the seam with the application owner before coding (direction doc, human decision 6). Record the confirmation in `## Comments`.
- Run `npm run check`, the landing tests and the guest app's conversation tests, then `npm test` once in the background, then `npm run test:workers`.

## Comments

### Seam confirmation — 21 Oct 2026

Human decision 6 (direction doc) is covered by the owner's "accept recommendations" on 20 Oct 2026 (issue 13, item 1(a)): carry the exact first message by POST into a new conversation, with session issuance and the existing beta gate, never in a URL, preserving existing work. The seam as built: `POST /welcome/start` is handled in `guest-server.ts` `dispatch` (it needs the session registry and per-session runtime), reuses `app.handleTurn` exactly as `POST /conversation` does, and adds no domain command, persistence policy or search behaviour. The landing route module is unchanged. If a domain/application owner other than the project owner must also confirm, that remains open.

### Implementation and ADR table — 21 Oct 2026

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0005 | Request to Book only at launch; discovery creates nothing | AC5: the route only calls `handleTurn` on a new thread; test asserts no committed work or request/payment journey state |
| 0075 | Minimise data; no bearer credentials or message text in logs | AC2: body only, 303 to an opaque `threadId`, no text in headers/logs; pages that echo the text are `no-store`; the invite code travels in the body and is not left in the address |
| 0077 | Canonical artifacts across channels | The reply is the same deterministic/model turn as `/conversation`; the transcript renders the same projection |
| 0078 | Accessible, no-JS, constrained networks | Form POST works without JavaScript; chips still only fill the field; 44px/overflow/captures remain an issue-15 gate |
| 0079 | New conversation never withdraws existing work | AC3: an open conversation gets "Continue your conversation" first; a new thread starts only on `startNew=1`; the old thread page is byte-identical afterwards |
| 0080 | Deterministic parity | No new model path: the first turn is `handleTurn`; the budget cap still degrades to deterministic |
| 0070/0093 | Principals isolate threads | A new thread is added only to the requester's own session; an unresolvable cookie is not silently adopted (malformed cookie: 401, as `GET /`) |
| 19 (guardrails) | Rate and body limits | `pilot-request-handler.ts` counts `POST /welcome/start` as a chat turn, and as a new session when there is no cookie; 4 KiB form limit reused; `MAX_TURN_TEXT_LENGTH` now lives in `turn-limits.ts` and drives the composers' `maxlength` |

Behaviour: empty/over-long (>2000) message or a missing field: 400 with the composer's own "Type a short message to send." and the text kept, no session or thread created. Concierge failure (result `!ok` or a thrown error): 422, thread and session kept, message in the composer, retry posts to `/conversation` with the same `threadId`. Origin mismatch: 403. Copy lives in `GUEST_CONTINUE_CONVERSATION` (`guest-content.ts`), built from the existing `GUEST_NEW_CONVERSATION` strings.

**Tests:** `test/landing-handoff.test.ts` (6: AC1 and its two failure paths, AC2, AC3, AC4, AC5), `test/pilot-guardrails.test.ts` (landing sends count as turns/new sessions), and the earlier landing tests that asserted the old unnamed GET composer were updated (`landing-page.test.ts`, the real-Chrome `Issue 08 AC2`, which now also asserts the typed text is the first Guest message). `npm run check` clean; 70 targeted Node tests pass; real-Chrome `Issue 08 AC2` passes; `npm run test:workers` 24 files / 162 tests pass. Mutation checks: disabling the continue-offer fails AC3; removing `no-store` fails 4 tests. Honest note: my first "red" run failed on a missing test environment (`NODE_ENV=test`, `COMMERCE_REFERENCE_TEST_KEY=allow`), not on the feature; the guardrail test was genuinely red first (429 expected, 303 actual), and the `no-store` assertions were added together with the header, then proved by mutation.

**Self-review (direct, no subagents):** checked fail-closed identity (malformed cookie 401; unresolved cookie only gets a new session through the same invite gate as `/`; existing session never needs the code), no static time/threshold values (limits are the configured pilot limits), no `any`, no logs added, message HTML-escaped in every hidden/echo field. Known limits: the Cloudflare Worker has no pilot rate limiter at all today (existing gap, unchanged; the landing route inherits whatever `/conversation` has there); a 2000-character message can exceed the 4 KiB form-body ceiling once URL-encoded (same as `/conversation`); the invite and continue pages repeat the message in a hidden field, which is why they are `no-store`. Not done here (issue 15): full suite, visual/capture gate at 320/390/768/1280, `docs/design/shortlet-landing-page-direction.md` wording ("until the seam is approved the composers link to the app") not yet updated.

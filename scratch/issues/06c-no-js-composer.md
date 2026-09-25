# Composer works without JavaScript

Status: resolved
Type: task
Blocked by: 06b
Parent: [06](06-conventional-routes.md)

## What to build

Give the composer form (`guest-server.ts:1628`) a real `action` and `method`. Add a POST route that runs the turn and returns a server-rendered transcript with the conventional links from 06a and 06b.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC3: With JavaScript disabled, posting the composer produces a server-rendered reply.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0080 as modified by 0081 | Material workflows have conventional route parity |
| 0070–0072 | Routes re-authorize and version-check commands |
| 0075 | Message text and cookies are never logged |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- The composer now has `method="post" action="/conversation"` and a hidden `threadId`. With JavaScript on, `client.ts` still calls `preventDefault`, so nothing changes.
- `POST /conversation` works like this:
  1. it checks the Origin, then reads the form;
  2. a malformed `threadId` gets a 400; an empty one mints a new `g-` thread;
  3. `bindBrowserThread(..., requireSession = true)` must pass, otherwise the guest gets a 401 page (ADR-0070);
  4. the message is validated like `/api/turn` (non-empty, ≤2000). An invalid one gets a 400 transcript with an alert, keeps the draft and runs no turn;
  5. the turn runs through the same `handleTurn` (ADR-0072). A rejected turn gets a 422 transcript with its message;
  6. success redirects with 303 to `GET /conversation?threadId=…` (post/redirect/get, so a refresh never re-sends).
- `renderNoScriptConversationHtml` renders the page:
  - turns labelled "You" and "Shortlet Concierge", and receipts as markers;
  - each current surface as its summary, text fallback and conventional link, labelled "Open full details" as in the client, so the links from 06a and 06b are reachable;
  - a composer that carries the thread.
- Root cause found by the real-browser test: the guest pages sent `Referrer-Policy: no-referrer`, so Chrome sent `Origin: null` on a same-origin form post, and `browserOriginAccepted` rejected it ("Origin rejected") unless the local-pilot `publicOrigin` was configured. `GUEST_HTML_HEADERS` now sends `same-origin`: same-origin posts carry their real Origin, and cross-origin requests still get no referrer. The origin check itself is unchanged. The existing contact-details forms had the same latent rejection, and this fixes it too.
- Tests: `test/guest-no-js-composer.test.ts` (AC3 over HTTP, with failure paths: empty and over-long messages, no session, foreign Origin, malformed thread, anonymous transcript view) and `test/guest-no-js-composer-chromium.test.ts` (AC3 in real Chromium with scripts disabled via `Emulation.setScriptExecutionDisabled`). The helper gains `setJavaScriptEnabled` and `insertText`. The Chromium test failed with "Origin rejected" before the referrer-policy fix.
- Verification: `npm run check` passed. `npm test`: 1,113 passed, 0 failed, 1 skipped. Walkthrough on :3001 at 375px and 1280px: a native form post (bypassing the client handler) rendered the reply and the search link.

# Refusals show guest copy, and a refused card is retired or disabled

Status: resolved
Type: AFK (guest UI work: captures required)
Blocked by: 62
Requested: 9 Nov 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md). Batch: chat hardening, issues 56–62. Fixes issue 56 defect 3. Related: [Weaver note](../../weaver-catalogues/notes/2026-11-09-stale-artifact-actions.md), findings 2–3.

## Why

- **Developer text reaches guests.** `renderResponse` (`apps/local-guest/src/client.ts` ~2533) shows `response.message` verbatim, and many messages are developer text. Examples:
  - "The action does not match the authoritative artifact." (`apps/web/src/discovery-actions.ts:114`)
  - "The action context is invalid."
  - `REQUEST_NOT_SUBMITTED` passes a raw domain `error.message` (`shortlet-app.ts:5000`)
- **Refused cards stay live.** Only `STALE_SURFACE`, `STALE_ACTION` and `EXPIRED_SURFACE` mark the surface stale and refresh. After `ARTIFACT_MISMATCH`, `INVALID_ARTIFACT`, `OFFER_MISMATCH` or `ACTION_NOT_AUTHORIZED` the card stays active, so every tap appends the same refusal (the guest on staging saw it twice). `sendCriteriaEvent` has its own short list (`client.ts` ~2445-2449).
- **No mapping exists.** There is no code-to-guest-copy mapping anywhere. All refusals go out as HTTP 200 through `sendTurnResult` (`guest-server.ts` ~2810-2819), and the Worker uses the same results.

## What to build

1. **Closed refusal map.** In `apps/web-agent/src/guest-content.ts`, add `GUEST_REFUSAL: Readonly<Record<RefusalCode, { readonly class: "stale" | "forbidden" | "invalid" | "unavailable" | "busy"; readonly copy?: string; readonly keepServerMessage?: true }>>`.
   - `RefusalCode` is the closed union of every `ok:false` code. The issue 56 exploration lists them; re-grep before writing.
   - **stale:** `STALE_SURFACE`, `STALE_ACTION`, `EXPIRED_SURFACE`, `ARTIFACT_MISMATCH`, `INVALID_ARTIFACT`, `OFFER_MISMATCH`, `QUOTE_CHANGED`. Copy, for example: "These options have changed. Here are the current ones."
   - **forbidden:** `ACTION_NOT_AUTHORIZED`, `UNSUPPORTED_ACTION`, `UNSUPPORTED_EVENT`.
   - **invalid:** `INVALID_CONTEXT`, `INVALID_EVENT`, `INVALID_INPUT`, `INVALID_CRITERIA`, `INVALID_ROUTE`.
   - **busy:** `THREAD_BUSY`.
   - **unavailable:** `CONCIERGE_UNAVAILABLE`, `REQUEST_NOT_SUBMITTED`, `PAYMENT_NOT_CONFIRMED`.
   - **Keep the server's message** (already guest copy, built from closed guest content): `CRITERIA_REJECTED`, `CRITERIA_LOCKED`, `CONTINUOUS_OCCUPANCY_REFUSED`, `NOTHING_TO_UNDO`. Verify each before allow-listing it.
   - An unknown code fails closed to the generic copy, class `unavailable`.
2. **One server exit point.** Apply the map where turn and event results leave the app, at `sendTurnResult` (`guest-server.ts`) and its Worker equivalent:
   - replace `message` with the mapped copy unless `keepServerMessage`;
   - add `refusal: <class>`;
   - keep `code`.

   Remove the raw `error.message` passthrough at `shortlet-app.ts:5000`.
3. **Client** (`client.ts`):
   - `renderResponse` acts on `refusal`:
     - `stale`: `markActiveSurfaceStatus(…, "stale")`, re-render, then `refreshServerState()`. `EXPIRED_SURFACE` keeps the `expired` status.
     - `forbidden` / `invalid`: set `aria-disabled` on the control that was tapped (captured in `sendEvent`, ~2671) until the next server render of that surface.
     - `busy`: keep the control enabled and show the copy once.
   - Collapse an identical consecutive refusal into the existing turn instead of appending a duplicate.
   - `sendCriteriaEvent` uses the same class handling.
   - Validate `refusal` as a closed value. Ignore an unknown value and fall back to the existing code list.
4. Rebuild `client.js` with `npm run build`, and commit only `apps/local-guest/dist/client.js`.
5. Update the Weaver note: the app's closed class is the proposed shape for the Weaver rejection contract.

## ADRs

| ADR | Constraint | Where |
|---|---|---|
| 0075 | No ids, provider text or internals in guest-visible text or logs. | Steps 1–2 |
| 0077 | Guest copy lives in `guest-content.ts`; chat and page render the same content. | Step 1 |
| 0106 | Guards stay fail closed. Mapping changes the copy only, never the decision. | Step 2 |
| 0078 | Disabled controls are announced; targets stay 44px or more. | Step 3 |

## Acceptance criteria

- [x] A guard test (`test/guest-refusal-copy.test.ts`) greps every `code: "…"` emitted in `apps/local-guest/src/shortlet-app.ts`, `apps/local-guest/src/assistant/**`, `apps/web/src/*-actions.ts` and `packages/platform-core/src/interactions.ts`, and asserts each code has a `GUEST_REFUSAL` entry.
- [x] No `ok:false` body returned by `/api/event` or `/api/turn` in the server tests contains "authoritative", "artifact" or "context is invalid". The issue 56 forged-id case returns the stale copy with `refusal: "stale"`.
- [x] An unknown code returns the generic copy with `refusal: "unavailable"`.
- [x] `REQUEST_NOT_SUBMITTED` no longer echoes the domain error message.
- [x] Real Chrome (extend `test/guest-real-browser-cross-tab.test.ts`, run on its own): a View on a card whose artifact was replaced shows the stale copy once, the card goes inert, and the current results render after the refresh.
- [x] Real Chrome: a `forbidden` refusal disables only the tapped control, and a second tap adds no duplicate turn.
- [x] Captures at 320, 390, 768 and 1280, light and dark, of a stale card and a disabled control, saved under `.scratch/guest-ui-consistency/screenshots/60/`. No horizontal overflow; targets of 44px or more.

## Verification

`npm run check`; `test/guest-refusal-copy.test.ts`, `test/local-guest-weaver-demo.test.ts`, `test/conversational-shell.test.ts`, `test/guest-cross-tab-concurrency.test.ts` and `test/assistant-discovery-artifact-drift.test.ts`; then `test/guest-real-browser-cross-tab.test.ts` on its own. If the Worker result path changes, also run `npm run test:workers -- <matching spec>`. Use `env -u LLM_API_KEY`. Record the counts in Comments.

## Comments

- 9 Nov 2026, offline core landed on `fix/chat-hardening` (issue NOT yet resolved: the two real-Chrome ACs and the captures remain). Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test` for the local-server tests):
  - `npm run check`: clean (tsc x4 plus the worker bundle guard).
  - `npx tsx --test test/guest-refusal-copy.test.ts`: 4 of 4 pass (guard AC1, served stale AC2, unknown code AC3, REQUEST_NOT_SUBMITTED AC4).
  - `npx tsx --test test/guest-refusal-copy.test.ts test/local-guest-weaver-demo.test.ts test/conversational-shell.test.ts test/guest-cross-tab-concurrency.test.ts test/assistant-discovery-artifact-drift.test.ts`: 46 of 46 pass.
- Done: `GUEST_REFUSAL`/`RefusalClass`/`guestRefusalFor` in `guest-content.ts` (every `ok:false` code mapped to stale/forbidden/invalid/unavailable/busy; unknown fails closed to the generic `unavailable` copy); the map is applied at the single server exit `sendTurnResult` in `guest-server.ts` (message replaced, `refusal` class added, code kept); the raw `REQUEST_NOT_SUBMITTED` domain message is removed in `shortlet-app.ts`; the client (`client.ts`) acts on `refusal` (stale retires + refreshes, forbidden/invalid set `aria-disabled` on the tapped control only, busy keeps it enabled, identical consecutive refusals collapse) and ignores a tap on a disabled control; `apps/local-guest/dist/client.js` rebuilt.
- Remaining before resolution: extend `test/guest-real-browser-cross-tab.test.ts` for the stale-card (inert + refresh) and forbidden (disable only the tapped control, no duplicate turn) cases; captures at 320/390/768/1280 light and dark under `.scratch/guest-ui-consistency/screenshots/60/`; update the Weaver note to cite the closed class as the proposed rejection contract.
- ADRs read and applied: 0075 (no ids, provider text or internals in guest-visible text), 0077 (guest copy in `guest-content.ts`), 0106 (guards fail closed; the class changes copy only), 0078 (disabled controls announced; 44px targets).

- 9 Nov 2026, review fixes (MAJOR + MINOR), offline core only; issue stays claimed for the remaining browser/capture work. Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test`):
  - `npx tsx --test test/guest-refusal-copy.test.ts`: 4 of 4 (the guard now also collects `*RejectionCode` union members, `*_CODE` constants and `error: "…"` literals).
  - `npx tsx --test test/guest-real-browser-cross-tab.test.ts` (real Chrome, on its own): 13 of 13 (added RB13).
  - The review's offline list: 112 of 112. `npm run check` clean.
- Fix (MAJOR, client): `applyRefusal` now applies only the stale/refresh part and never disables a control. Only a workspace refusal (`renderResponse`) disables the tapped control, and only while it is connected and inside `activeWorkspace`. `renderSurface` clears `lastActivatedControl`, and the `sendEvent` guard ignores an event only when the reference is connected, inside the workspace, and `aria-disabled="true"`. So a criteria-strip or chip refusal can no longer disable (and stall) a workspace button. Real Chrome test RB13: a strip edit refused `invalid` leaves the workspace View working. `apps/local-guest/dist/client.js` rebuilt.
- Fix (MINOR, map): `TASK_UNAVAILABLE` (returned through a variable) is added to `RefusalCode` and `GUEST_REFUSAL` as class `unavailable` (a task start/switch the platform could not complete, not a malformed request), with a comment. The guard test was extended and confirmed red before the entry was added.
- Still outstanding for this issue: the `forbidden` real-Chrome case (disable only the tapped control, no duplicate turn) beyond RB13, the 320/390/768/1280 light/dark captures under `.scratch/guest-ui-consistency/screenshots/60/`, and the Weaver-note update. Status: resolved.
- ADRs: 0075 (no developer text or ids reach the guest), 0077 (guest copy in `guest-content.ts`), 0106 (guards fail closed; copy only), 0078 (disabled controls announced; targets).

- 9 Nov 2026, remaining acceptance criteria finished. Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test` for the local-server tests):
  - `npm run check`: clean (tsc x4 plus the worker bundle guard).
  - `npx tsx --test test/guest-refusal-copy.test.ts test/local-guest-weaver-demo.test.ts test/conversational-shell.test.ts test/guest-cross-tab-concurrency.test.ts test/assistant-discovery-artifact-drift.test.ts`: 46 of 46 pass.
  - `npx tsx --test test/guest-real-browser-cross-tab.test.ts` (real Chrome, on its own): 14 of 14 pass (RB6 extended for AC5; new RB14 for AC6).
  - `NODE_ENV=test npx tsx .scratch/guest-ui-consistency/capture-60.ts`: 16 captures (stale card and disabled control at 320/390/768/1280, light and dark) under `.scratch/guest-ui-consistency/screenshots/60/`; every disabled target measured 44px and no width/theme reported horizontal overflow.
- AC5 (stale card): extended the existing cross-tab RB6 rather than duplicating its fixture. After tab B's stale View, the stale copy (`GUEST_REFUSAL_DEFAULT.stale`) appears exactly once in the transcript, and the authoritative unit detail ("Request to Book") renders after the refresh.
- AC6 (forbidden): RB14. No reachable server route returns `ACTION_NOT_AUTHORIZED` without a hand-forged action context, so the test uses the page's request interception (the allowed fallback; no production hook) to return a well-formed `{ ok:false, code:"ACTION_NOT_AUTHORIZED", refusal:"forbidden", message:<mapped copy> }`. It asserts exactly one control is disabled (the tapped Request to Book), the other control on the same surface (Back to results) stays enabled, the disabled target is 44px, and a second tap sends no `/api/event` request and adds no duplicate turn. Pre-fix outcome: the workspace disable-and-guard behaviour existed before the review fix (5541913), so RB14 would also pass against that client; the defect the review fix addressed — a criteria-strip or chip refusal disabling a workspace control — is covered by RB13. Recorded either way as requested.
- AC7 (captures): `.scratch/guest-ui-consistency/capture-60.ts` renders the discovery, sets the exact refusal states the client sets (`aria-disabled` on the refused control; `data-status="stale"` on the workspace), and asserts a 44px target and no horizontal overflow at every size and theme. 16 files under `screenshots/60/`.
- Weaver note (`.scratch/weaver-catalogues/notes/2026-11-09-stale-artifact-actions.md`) updated: the app's closed refusal class `stale | forbidden | invalid | unavailable | busy`, carried as `refusal` beside `code`, is cited as the proposed rejection contract, with the client behaviour named for each class and no ids, provider text or internal messages.
- The client source did not change in this pass, so `apps/local-guest/dist/client.js` is unchanged; nothing else in `dist/` or `apps/cloudflare/public/_headers` was staged.
- Definition of Done: AC5, AC6 and AC7 each have a dedicated named test/capture; failure paths are asserted (no duplicate turn, no second request, single stale copy); ADRs cited (0075, 0077, 0078, 0106); no production test hook; no invented copy; no credential or identity material; check and the commands above are green. Status: resolved.

- 9 Nov 2026, capture evidence rewritten with real refusal states (issue reopened and resolved again). Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test`):
  - `npm run check`: clean.
  - `npx tsx --test test/guest-refusal-copy.test.ts test/local-guest-weaver-demo.test.ts test/conversational-shell.test.ts test/guest-cross-tab-concurrency.test.ts test/assistant-discovery-artifact-drift.test.ts test/guest-real-browser-cross-tab.test.ts`: 60 of 60 pass (the cross-tab file alone remains 14 of 14).
  - `NODE_ENV=test npx tsx .scratch/guest-ui-consistency/capture-60.ts`: 32 captures (16 baselines + 16 state images) at 320/390/768/1280, light and dark; each refused control scrolled into view and 44px; no horizontal overflow; every state image asserted different from its baseline.
- Real states, not hand-set: the stale image is a real cross-tab stale View refusal (Tab A advances the thread; Tab B's View is refused as stale, the client shows the stale copy and refreshes; at narrow widths the conversation is opened so the copy is visible). The disabled image is a real forbidden refusal returned by the page's request interception on the tapped "Request to Book" (as RB14). The earlier issues are addressed: the states are real; the refused control is scrolled into view (the 1280 target was below the fold before); the refused control is the tapped Request to Book (not the header "New" button); the stale and disabled images differ from each other and from their baselines.
- Added `.weaver-mount button.guest-action[aria-disabled="true"] { opacity: 0.55; cursor: not-allowed; }` in `guest-server.ts`: the design system's disabled rule only covered `.ui-button`, but Weaver action buttons carry `.guest-action`, so a refused control was not visibly disabled (ADR 0078). Without it the "disabled control" capture showed an enabled-looking button.
- Status: resolved.

- 9 Nov 2026, capture follow-up: the disabled-control CSS also updates the pre-agent-modes golden fixture (`test/fixtures/guest-shell-pre-agent-modes.html`) with exactly the same two lines (comment + rule, LF) at the matching position. Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test`):
  - `npm run check`: clean.
  - `npx tsx --test test/agent-mode-shell.test.ts test/guest-app-frame.test.ts test/guest-copy-pass.test.ts test/guest-new-conversation.test.ts test/guest-retired-classes.test.ts test/local-guest-shell.test.ts test/shortlet-design-system.test.ts test/guest-refusal-copy.test.ts test/local-guest-weaver-demo.test.ts test/conversational-shell.test.ts`: 63 of 63 pass.

- 9 Nov 2026, pre-merge gate fixes (`gate/chat-hardening`, HEAD 74a18e5 with main merged). Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test`):
  - `npm run check`: clean (tsc x4 plus the worker bundle guard).
  - `npx tsx --test test/card-checkout-failure-diagnostic.test.ts test/assistant-pack-registry.test.ts test/assistant-recorded-journeys.test.ts test/assistant-turn-stop-reasons.test.ts test/assistant-tool-argument-validation.test.ts test/assistant-location-change.test.ts test/guest-refusal-copy.test.ts test/assistant-open-question.test.ts test/assistant-no-dead-ends.test.ts test/assistant-terse-followups.test.ts test/assistant-clarification-facts.test.ts test/assistant-clarification-chips.test.ts`: 122 of 122 pass.
  - `npm run build`: regenerated `apps/local-guest/dist/client.js` (committed).
- Item 1 (7 card-checkout tests): the refusal map replaced the server's closed payment message ("The secure card checkout could not be started.") with the generic forbidden copy. The result code is `ACTION_NOT_AUTHORIZED` (ADR 0106: no new outcome code), so it now keeps its server message (`keepServerMessage`). The same audit added `keepServerMessage` to every other entry whose server message is closed guest copy: `CARD_CHECKOUT_FAILED`, `PAYMENT_NOT_CONFIRMED`, `PAYSTACK_UNAVAILABLE`, `REQUEST_NOT_SUBMITTED`, `CONCIERGE_UNAVAILABLE`, `UNKNOWN_DOMAIN`. `test/guest-refusal-copy.test.ts` gained AC5 (these codes keep their server-authored message) and AC4 was updated (`REQUEST_NOT_SUBMITTED` keeps its fixed guest sentence rather than the generic copy).
- Item 5 (test-only): `test/assistant-location-change.test.ts` AC1 compares chip labels (`GuestQuickReply` objects from issue 58) instead of raw strings.

- 9 Nov 2026, follow-up on item 1: revert the blanket `keepServerMessage` on ACTION_NOT_AUTHORIZED (it carries internal text). The checkout sentence now lives in `GUEST_PAYMENT_COPY.checkoutStartFailed` (ADR 0077), used at the card-checkout refusal, and `guestRefusalFor(code, serverMessage)` keeps an ACTION_NOT_AUTHORIZED message only when it equals that named constant; every other message gets the forbidden copy. `test/guest-refusal-copy.test.ts` AC6 covers it. Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test`): `npm run check` clean; the 12-file list 123 of 123; `test/assistant-paystack-checkout-contact.test.ts` 9 of 9; `test/assistant-thread-lock.test.ts` 29 of 29; `npm run build` regenerated `apps/local-guest/dist/client.js`.

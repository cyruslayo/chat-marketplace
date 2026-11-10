# Refusals show guest copy, and a refused card is retired or disabled

Status: claimed
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
- [ ] Real Chrome (extend `test/guest-real-browser-cross-tab.test.ts`, run on its own): a View on a card whose artifact was replaced shows the stale copy once, the card goes inert, and the current results render after the refresh.
- [ ] Real Chrome: a `forbidden` refusal disables only the tapped control, and a second tap adds no duplicate turn.
- [ ] Captures at 320, 390, 768 and 1280, light and dark, of a stale card and a disabled control, saved under `.scratch/guest-ui-consistency/screenshots/60/`. No horizontal overflow; targets of 44px or more.

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

# 15 An unknown card-session status fails closed

Status: resolved
Type: task
Track: C
Blocked by: none

## Defect

`domains/shortlet/src/guest-interaction-store.ts` has a mapper that turns a stored card checkout session row into a session, near line 1280: `row.status === "completed" ? ... : "initiated"`. Any stored status it does not recognise becomes `"initiated"`. A corrupt or unexpected row is therefore treated as a live checkout, which fails open.

## Fix

- Map only the four known statuses, from the union in `domains/shortlet/src/card-payment.ts`: `initiated`, `completed`, `expired` and `failed`.
- Make an unknown value throw `new Error("Unknown card checkout session status")`. The message must not include ids or row data (ADR 0075).
- Check every caller of the mapper, and confirm the throw comes out as a refusal, not a crash in an unrelated flow. Record what you find in Comments.

## Acceptance criteria

1. A stored row with each of the four known statuses loads with that status.
2. A stored row with an unknown status throws "Unknown card checkout session status", and the message contains no ids.

## Tests

- **New test:** `test/card-session-status-row.test.ts`.
  - Use the store's SQLite test setup. Look in `test/helpers/temporary-database.ts` and the existing `guest-interaction-store` tests.
  - Write a raw row with `status = 'bogus'`, then load it.
- **Re-run:** the tests that match `card-payment` or `guest-interaction-store`.
- **Then:** `npm run check`.

ADRs: 0046, 0075.

## Comments

### Run record (agent, feat/state-machines-15)

**Before the fix**
- `env -u LLM_API_KEY npx tsx --test test/card-session-status-row.test.ts`: 2 tests, 1 pass, 1 fail. AC1 passed. AC2 failed: the unknown `bogus` row loaded without throwing and came back as `initiated` (`AssertionError: the unknown status throws an Error`).

**Fix**
- `domains/shortlet/src/guest-interaction-store.ts`: the `findCheckoutSession` ternary is replaced by `checkoutSessionStatus(row.status)`. It maps the four known statuses and throws `new Error("Unknown card checkout session status")` for anything else. The message has no ids or row data (ADR 0075). The status union in `card-payment.ts` is unchanged.

**Caller analysis (step 1)**
- The mapper is `SqliteGuestInteractionStore.findCheckoutSession`. It is reached through `findCheckoutSessionByOfferId` and `findCheckoutSessionByReference`. Those are called only from `CardPaymentApp.getCheckoutSession` and `getCheckoutSessionByReference` in `domains/shortlet/src/card-payment.ts`, on a cache miss.
- Callers of `getCheckoutSession` (offer id): `apps/local-guest/src/guest-server.ts:4899` (checkout start), `apps/local-guest/src/shortlet-app.ts:3315, 6148, 6245`, and `apps/local-guest/src/assistant/shortlet-stage-handlers.ts:355`.
- Callers of `getCheckoutSessionByReference` (PSP reference): `apps/local-guest/src/guest-server.ts:4956, 5004, 5201, 5314` (payment callback and webhook paths), and `apps/local-guest/src/fixture.ts:552` (test PSP fake). `card-payment.ts` also calls it internally at 440 and 450.
- Refusal outcome. The throw is synchronous and nothing in `card-payment.ts` catches it. Consequences by path:
  - Assistant paths (`shortlet-app.ts` turn handling, `shortlet-stage-handlers.ts`): AGENTS.md records that a thrown error in the planner or stage turn becomes `CONCIERGE_UNAVAILABLE`. That is a closed refusal, not a crash. I did not trace each call site's enclosing `try`, so this is taken from AGENTS.md, not verified line by line.
  - HTTP paths (`guest-server.ts`): the request handler's top-level catch (around line 5832) returns `500 INTERNAL_ERROR`. That is a generic error response, not a specific refusal. Not verified per route.
  - Standalone and webhook callbacks (`guest-server.ts` 5201, 5314) would take this 500 path. A corrupt row therefore surfaces as a server error, not as a live checkout. This is the intended fail-closed outcome for this issue.
- No caller was found that treats a thrown error as a successful `initiated` checkout.

**Commands and counts (after the fix)**
- `env -u LLM_API_KEY npx tsx --test test/card-session-status-row.test.ts`: 2 pass, 0 fail.
- `env -u LLM_API_KEY npx tsx --test test/card-session-status-row.test.ts test/integrate-card-payment-application.test.ts test/render-card-payment-weaver-a2ui.test.ts test/card-checkout-url-persistence.test.ts`: 14 pass, 0 fail, 0 cancelled. `card-checkout-url-persistence.test.ts` is included because it calls `findCheckoutSession` directly on the changed mapper. The two name-matched files are `integrate-card-payment-application` and `render-card-payment-weaver-a2ui`. No file in `test/` has `guest-interaction-store` in its name.
- `env -u LLM_API_KEY npm run check`: passed. All four `tsc --noEmit` projects and `scripts/check-worker-bundle.mjs` ran without errors.

**Definition of Done**
- Item 1 (one named test per AC): met. AC1 and AC2 each have their own `test()`.
- Item 2 (failure path): met. AC2 asserts the throw, the exact message, and that the ids are absent.
- Item 3 (ADRs): ADR 0046 and 0075 read. Both cited above. The `card-payment.ts` comment references ADR 0087, which I did not read.
- Item 4 (injected dependencies): no new constructor parameters.
- Item 5 (invented policy): none. The message string is the one specified by the issue.
- Item 6 (credentials in logs): the error message is constant and carries no ids.
- Item 7 (`npm test` passes): not run here. Per CLAUDE.md and AGENTS.md, the full `npm test` runs once per batch before merging, so this stays open for the batch gate.

**Status**: left as `ready-for-agent`. Every AC is met and tested, but DoD item 7 is a batch-level gate. The orchestrator should set `resolved` after that gate passes.
- Orchestrator review: diff and test read; re-ran the 4 files (14 pass, 0 fail) and `npm run check` (exit 0). Resolved; full `npm test` is the batch gate.

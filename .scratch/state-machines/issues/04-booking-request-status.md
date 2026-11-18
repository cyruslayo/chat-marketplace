# 04 BookingRequest: typed records and an exported status union

Status: resolved
Type: task
Track: B (no behaviour change)
Blocked by: 03

## What to build

In `domains/shortlet/src/booking-request.ts`:

- **Status union.** Export `BOOKING_REQUEST_STATUSES = ["draft", "disclosed", "delivery_failed", "expired", "confirmed", "declined"] as const` and `type BookingRequestStatus = (typeof BOOKING_REQUEST_STATUSES)[number]`.
- **Transition table.** Export `BOOKING_REQUEST_TRANSITIONS`, written as `as const satisfies TransitionTable<BookingRequestStatus>` (from `packages/platform-core/src/state-transition.ts`). It must encode exactly the moves the code makes today:
  - `draft` → `disclosed`
  - `disclosed` → `delivery_failed`, `expired`, `confirmed`, `declined`
  - The other four states are terminal (empty lists).
  - Read every write site to confirm this (`status: "draft"`, `status: "disclosed"`, `req.status = ...`). If the code makes a move not listed here, add it to the table and say so in Comments.
- **Typed records.** Replace `#requests = new Map<string, any>()` with a typed record interface. Search first for an existing interface that fits (for example the durable record in `guest-interaction-store.ts`). There must be no `any` left in the file.
- **One shared rule.** Extract a single helper for the delivered and deadline rule, which is currently repeated in `projectBookingRequestStatus`, `checkAndResolveDeliveryFailure` and the expiry check. Use it in all three places.
- **Typed status field.** Type the `status` field of the durable booking-request record in `domains/shortlet/src/guest-interaction-store.ts` (around line 82, `readonly status: string`) as `BookingRequestStatus`. If loading stored rows needs a narrowing guard, unknown values must keep today's behaviour exactly. Record what that behaviour is in Comments; do not change it here.
- **Map update.** Add the new names in backticks to the BookingRequest row of `docs/agents/state-machines.md`, so `test/state-machine-inventory.test.ts` stays green.

Do not change any guard, error string or decline behaviour (the late-decline rule is owner question 1).

## Acceptance criteria

1. Characterisation, success paths: each status move the code makes today still produces the same status.
2. Characterisation, refusal paths: each refused move still produces today's error text. Examples are declining a non-disclosed request and confirming after the deadline.
3. Every move the code makes is listed in `BOOKING_REQUEST_TRANSITIONS`. A test drives each write path and asserts `canTransition(table, from, to)`.
4. There is no `any` in `booking-request.ts`, and `npm run check` is clean.

## Tests

1. **Write the characterisation tests first**, in `test/booking-request-transitions.test.ts`. Reuse `test/helpers/booking-request-manager.ts`. They must pass before any refactor.
2. **Re-run** every test file whose name contains `booking-request`, plus `test/state-machine-inventory.test.ts`.
3. **Run `npm run check`.**

ADRs: 0041, 0043, 0075.

## Comments

**Reading done.** AGENTS.md, coding-standards, PRD, `docs/agents/state-machines.md`, this issue. ADRs read: 0041, 0043, 0075 (listed in the issue). Also read for context: 0023 and 0093 (already cited in the code, unchanged), and `docs/agents/issue-tracker.md` (Definition of Done). `CONTEXT.md` (`domains/shortlet/CONTEXT.md`) defines Booking Request, Request Draft, Pending Operator, Delivery Pending. It does not define "Delivery Failed" (glossary drift, the persisted `delivery_failed` string is kept per the PRD rule).

**ADR table (constraint, and what it affects).**

| ADR | Constraint | Code path affected |
|---|---|---|
| 0041 | Disclosed request blocks inventory for 30 min; the response deadline and expiry are inclusive (`now >= deadline`) | `disclosedDeadlineOutcome` (expiry), `confirm`, `decline`, projection |
| 0043 | Delivery Pending lasts at most 5 min; delivery starts a fresh 30 min window; no delivery means Delivery Failed | `disclosedDeadlineOutcome` (delivery), `markDelivered`, `checkAndResolveDeliveryFailure` |
| 0075 | No bearer credentials or restricted identity in logs or audit | No audit or log line changed. `contactEmailSnapshot` stays out of returned objects |

**Transition table (read from every write site).** Writes found: `status: "draft"` (createDraft, getDraft from store); `status: "disclosed"` (disclose); `req.status = "delivery_failed"` (checkAndResolveDeliveryFailure, reached from checkAndResolveExpiry, markDelivered, confirm, decline); `req.status = "expired"` (checkAndResolveExpiry, reached from confirm); `req.status = "confirmed"` (confirm); `req.status = "declined"` (decline). `markDelivered` does not change status. No move beyond the table was found, so `BOOKING_REQUEST_TRANSITIONS` was not extended.

**Shared rule.** `disclosedDeadlineOutcome(request, now)` returns `delivery_failed`, `expired` or `disclosed`. It is used by `projectBookingRequestStatus`, `checkAndResolveDeliveryFailure` and `checkAndResolveExpiry`. Same clock reads, same side effects, same order. The confirm, decline and markDelivered refusal checks were left as they were.

**Typed records.** The store's `DurableBookingRequest` was searched first but does not fit. It is readonly, and it lacks `distinctPayer`, `holdId` and a typed `quote`. So `BookingRequestRecord` (mutable fields only where the code writes them) and `BookingRequestDraft` were added, with `BookingRequestUnitSource`, `AvailabilityCalendar` and `Pick<AuditLog, "record">` replacing the `any` constructor options. `grep` finds no `any` in `booking-request.ts` outside comments (AC4 test).

**Stored-row behaviour (unchanged, recorded as required).** `guest-interaction-store.ts` maps `status: row.status` and now casts `as BookingRequestStatus`. A value outside the union is returned unchanged. The manager's guards then refuse it by name: `Cannot confirm booking request in status '<raw>'` (and the same for decline and markDelivered), after the delivered and deadline checks. The check and decline paths leave it alone. Characterised in the store-backed AC2 test.

**Casts left for review (type-only, no runtime change).**
- `booking-request.ts` disclose: `draft.selfBookingAttestation as SelfBookingAttestation`. Undefined only if a caller omitted it; it then fails inside validateBookingEligibility, as before.
- `booking-request.ts` persist: `inventoryCommitmentId as string`. Undefined only when no calendar is wired.
- `booking-request.ts` hydrate: `JSON.parse(...) as StayQuote`, with the same `{}` fallback.
- `apps/local-guest/src/shortlet-app.ts` draft replacement (around line 5228): `original.selfBookingAttestation as SelfBookingAttestation`, plus one type import. Outside the file the issue names. It is the only edit to the shell, and it is type-only.

**Test files touched (type-only).** `test/helpers/booking-request-manager.ts`: optional `store` argument, default unchanged. `test/submit-and-resolve-timed-booking-request.test.ts`: `as Record<string, unknown>` became `as unknown as Record<string, unknown>` at 15 sites, because the record types are now interfaces. `test/demo-extended-stay.test.ts` line 207: `billingPeriods![0]!`, because the quote type marks it optional. No assertion changed.

**Characterisation tests (`test/booking-request-transitions.test.ts`).** AC1 (8 success subtests) and AC2 (12 refusal subtests, exact `message` match) were written first, and AC1/AC2 were not changed after the refactor. AC3 (9 subtests) drives each write path and asserts `canTransition`, plus a negative control. AC4 is the no-`any` check. One bug in my first draft (a positional SQL parameter) was fixed before the baseline. That was a test error, not a code change.

**Commands and counts** (run from `C:\AI2026\chat-marketplace-sm-04`, prefixed `env -u LLM_API_KEY`):
1. Before any source edit, `npx tsx --test test/booking-request-transitions.test.ts`: 22 pass, 0 fail (the AC1 and AC2 tests only).
2. Before any source edit, the 17-file baseline (the four `booking-request` files, `state-machine-inventory`, and 12 files that drive the manager or store): 175 pass, 0 fail.
3. `npm run check` on the unchanged tree: exit 0.
4. After the refactor, `npx tsx --test` on `booking-request-transitions` plus the same 17 files plus `demo-extended-stay` and `move-guest-verification-to-checkin` (edited for types): 219 pass, 0 fail, 19 files. Of these, `booking-request-transitions` is 33 pass, 0 fail.
5. `npm run check` after all edits (final): exit 0, no `error TS`, Worker bundle guard clean.

**Map.** The BookingRequest row in `docs/agents/state-machines.md` now names `BOOKING_REQUEST_STATUSES` and `BookingRequestStatus`, the transition table, and the typed records. The known-gaps text was updated to match.

**Definition of Done.**
1. Each AC has its own `test()` whose name mirrors the criterion. Yes.
2. Failure paths are asserted (exact error text and status after refusal). Yes.
3. ADRs listed and read (table above). Yes.
4. No new injected dependency. Yes.
5. No new policy string or constant. Yes.
6. No credential or identity material in logs or audit. Yes.
7. `npm run check` passes (exit 0). `npm test` is not run per issue, per the batch-gate instruction and AGENTS.md Test scope. Still to run once per batch before merge.

Not run: full `npm test`, `npm run test:workers`, real-Chrome tests. No commit was made.

**Open, not decided here.** Owner question 1 (late decline records "declined" rather than "expired"): decline behaviour is unchanged and characterised. Owner question 4 (`disclosed` alias): not changed.
- Orchestrator review: diff read. The remaining casts (draft-replacement attestation in shortlet-app.ts, inventoryCommitmentId, the empty-quote fallback, the row status pass-through) each make an existing runtime gap visible where `any` hid it; none changes behaviour. The draft-replacement attestation gap is logged in the map. Re-ran 8 files (90 pass) and `npm run check` (exit 0).

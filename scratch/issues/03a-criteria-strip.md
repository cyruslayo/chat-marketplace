# Criteria strip: Where, When and Guests chips with undo

Status: resolved
Type: task
Blocked by: 02, 10
Parent: [03](03-criteria-strip.md)

## What to build

Add the persistent strip above the composer with Where, When and Guests chips (budget comes in 03b). Editing a chip sends a criteria-edit event, which goes on `EVENT_STAGE_ALLOW_LIST` (`guest-server.ts:137`) and is handled in `#handleEvent` (:379), and the active results update. Keep a criteria history on the thread and in `guest-projection.ts` so "Undo last change" works after reload.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC1: The strip always shows the current server-side criteria after each turn.
- AC2: Editing a chip re-runs the search and replaces the results surface without a typed message.
- AC3: An edit that breaks policy (for example 15 nights) is rejected inline with the limit stated, and the previous value is kept.
- AC4: "Undo last change" restores the previous criteria and results.
- AC5: The strip can be operated by keyboard alone and reflows at 320px.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0004 | Criteria are server state; the client never searches on its own |
| 0073 / 0081 | Use Basic Catalog components first; custom ones need evidence the catalogue is insufficient |
| 0078 | 44px targets, 320px reflow, keyboard operable |
| 0080 | The same criteria are editable on the conventional search route |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- **Criteria on every response.** `LocalGuestApp.#criteriaFor` projects `thread.discoveryContext` as `criteria` on every turn, event and `/api/state` result (AC1). A context with no Where, When or Guests has no strip.
  - `criteria` holds Where (an area id and label), When (arrival, nights, and a label; unconfirmed dates show "(to confirm)"), Guests, `editable`, `canUndo`, the area list, and a `key` fingerprint.
- **Two new events.** `shortlet.criteria.edit` and `shortlet.criteria.undo` are on `EVENT_STAGE_ALLOW_LIST` under a `criteria` stage with one server-known id per thread (`criteriaSurfaceId`). `#criteriaGuard` fails closed:
  - once a Booking Request or offer exists → `CRITERIA_LOCKED`, with the existing `#changeExplanation` wording (ADR-0005);
  - when `basedOn` isn't the current `key` → `STALE_SURFACE`.
- **Edits** (`#handleCriteriaEdit`, AC2 and AC3):
  - The edit shape is exact: a known `area`; a real calendar `checkIn` with whole `nights`; or a whole `partySize`. Anything else is `INVALID_CRITERIA`.
  - `applyCriteriaEdit` (in `concierge.ts`) applies it to the server's context. Chip dates are typed calendar dates, so they count as confirmed.
  - The result goes through the same `resolveStayRequestContext` as a typed message. A refusal (for example 15 nights) returns `CRITERIA_REJECTED` with the existing limit text and changes nothing.
  - Otherwise the authoritative search re-runs as a new discovery revision (ADR-0004). No typed message is added.
- **Undo** (AC4):
  - Every executed search appends its criteria to `searchHistory`. It is capped at 11 entries, a storage bound rather than a policy.
  - The history is persisted in `guest-projection.ts`. It is optional there, so older projections load as an empty history.
  - Undo pops the current entry and re-runs the previous criteria, and it survives a reload.
- **Client.**
  - `#criteria-strip` sits above the composer. It holds `ui-chip` buttons (Where, When, Guests), an "Undo last change" button when `canUndo` is true, and an inline editor form. The editor uses a native select, a date input and whole-number inputs.
  - Enter or click opens the editor with focus in the field. Escape or Cancel closes it and returns focus to the chip.
  - A refusal shows in a `role="alert"` line next to the strip.
  - Chips wrap and are at least 44px tall. Below 30rem the field names are for screen readers only, to keep the strip short (AC5, ADR-0078).
  - The strip is shell chrome, like the composer, not a generative surface, so the Basic Catalog rule (ADR-0073/0081) does not apply to it.
- **ADR-0080.** The conventional `/stays/search` page has a GET form with the same Where, arrival, departure and Guests fields. `area` is a new allow-listed key, resolved from the same `SEARCH_AREAS` list, and it fails closed when unknown or mixed with `location`.
- **Tests.**
  - `test/guest-criteria-strip.test.ts`: AC1–AC4 and the conventional form, with failure paths: no strip before any criteria, stale `basedOn`, an unknown area, extra keys, a non-integer, an impossible date, a locked request, nothing to undo, and a stale undo.
  - `test/guest-criteria-strip-chromium.test.ts`: AC5 in real Chromium, keyboard only (Tab, Enter, Escape, Backspace). It covers editing, an inline refusal, undo, 44px targets, and no overflow at 320px. The CDP helper gained Backspace.
- **Follow-up for S12.** At 320×640 the strip wraps to three rows (157px). Consider collapsing it when the workspace is focused.
- Verification: `npm run check` passed. `npm test`: 1,133 passed, 1 failed, 1 skipped. The one failure is cross-tab RB1, the load flake recorded in S8, which passes on its own. The strip tests were rerun after the final CSS change and pass. Walkthrough on :3005 at 375px, 1280px and 320px: no overflow.

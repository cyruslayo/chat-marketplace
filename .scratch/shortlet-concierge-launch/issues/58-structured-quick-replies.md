# Quick-reply chips are structured guest input, not typed text

Status: ready-for-agent
Type: AFK (guest UI work: captures required)
Blocked by: 57
Requested: 9 Nov 2026 (owner decision: chip taps become structured events, reversing "chips never set state" from assistant-concierge-parity issue 10)

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md). Batch: chat hardening, issues 56–62. Fixes issue 56 defect 2.

## Why

The app offers chips such as "Just me", "2 guests" and "Wuse 2, Abuja", then sends the tap as typed text. The client calls `renderQuickReplies` → `sendTurn(text)` (`apps/local-guest/src/client.ts` ~2510-2525). In assistant mode that text goes to the scope classifier, which can misread it: on staging, "Just me" came back as the fixed `unavailable` reply and the party size was lost. ADR 0106 (L95) and ADR 0107 ("Settled") already call a chip tap structured guest input. The criteria strip's Guests chip does this correctly with `shortlet.criteria.edit`. The quick-reply chips should use the same path.

Today `quickReplies` is `readonly string[]`: in `GuestTurnSuccess` (`shortlet-app.ts:385`), in `AssistantTurnOutput` (`assistant-runtime.ts:121`), and checked by `isStringList` in `client.ts` ~1494. No structured chip type exists.

## What to build

1. **Type.** `GuestQuickReply = { readonly label: string; readonly edit?: QuickReplyEdit }`. `QuickReplyEdit` is a closed union that matches `readCriteriaEdit` exactly (`shortlet-app.ts:558-607`):
   - `{ field: "guests", partySize }`
   - `{ field: "where", area }`, where `area` is an id from `SEARCH_AREAS` (`stay-vocabulary.ts:128-135`)
   - `{ field: "when", checkIn, nights }`, only when a confirmed `checkIn` is known

   `quickReplies` becomes `readonly GuestQuickReply[]` on the server, the assistant output and the client.
2. **Builders.** `quickRepliesFor` (`concierge.ts:134-137`) and `clarificationChipsFor` (`shortlet-assistant-pack.ts:339-360`) return structured chips:
   - who: `edit: {field:"guests", partySize: 1..4}`
   - where / area: `edit: {field:"where", area: <id>}`
   - nights: `edit: {field:"when", checkIn, nights}` only when `stayIntent.checkIn` is confirmed. Otherwise the chip stays text-only.

   "Yes" / "Change dates", the date candidate chips, the location show-back chips, the ordinals ("The first one") and the deterministic "when" chips stay text-only. Those go through the existing confirmation path or, after issue 57, are read against the open question.
3. **Server.** Add no new event. A structured chip is a `shortlet.criteria.edit` and goes through `#criteriaGuard` → `#handleCriteriaEdit` → `#recordAssistantStayChip` (`shortlet-app.ts` ~3995-4119). It never reaches the classifier. The criteria response must carry `messages`, `quickReplies` and `criteria` as it does today.
4. **Client** (`client.ts`):
   - `renderQuickReplies`: on tap, clear the chips and add the label as the guest's turn. With `edit`, call `sendCriteriaEvent(CRITERIA_EDIT_EVENT, { ...edit, basedOn: <current criteria.key> })`. Without `edit`, call `sendTurn(label)`.
   - Replace `isStringList` for quick replies with a closed `isQuickReplyList` validator. Unknown fields or fields with the wrong type drop that chip.
   - When a chip started the event, `sendCriteriaEvent` puts its success reply through `renderResponse`, so the clarification and chips appear in the transcript. Today only `criteriaStatus` shows them.
5. **No-JS `/conversation`.** A chip with `edit` renders as a small form that posts the same edit through the existing no-JS criteria route (or as plain text where no route exists). Chat and page render from the same helper (`guest-kit.ts`).
6. Rebuild `client.js` with `npm run build`. Commit only the regenerated `apps/local-guest/dist/client.js`.

## ADRs

| ADR | Constraint | Where |
|---|---|---|
| 0106 | Chip dates, nights and party size are structured guest input and must reach `thread.assistantContext` and the runtime facts. Guards fail closed. | Steps 2–4 |
| 0107 | A tap-to-use chip counts as structured guest input. | Step 1 |
| 0078 | Targets of 44px or more, and reflow at 320. | Captures |
| 0015 | Party size and dates are needed for quoted totals. | The search after the chip |

## Acceptance criteria

Extend `test/assistant-clarification-chips.test.ts` and `test/assistant-discovery-artifact-drift.test.ts`. Assistant on, cold restore before every event, 2026-10-27 clock, staging guest; warm and cold.

- [ ] The staging journey: area search → When chip (only asks for guests) → "Just me" chip → results quoted for 1 guest → View opens the unit. The classifier is scripted `unclear` for "Just me" and is never called for the chip.
- [ ] The who chips carry `edit: {field:"guests", partySize}` and the where chips carry area ids. The date-confirm chips have no `edit`.
- [ ] A nights chip carries an edit only when a confirmed check-in is known.
- [ ] A forged chip edit fails closed: `partySize: 0` and an unknown area give `INVALID_CRITERIA`, and a stale `basedOn` gives `STALE_SURFACE`.
- [ ] The party size from the chip reaches `thread.assistantContext` and survives a cold restore.
- [ ] The client drops a malformed chip (unit test of `isQuickReplyList`).
- [ ] Real Chrome (`test/assistant-clarification-chips-chromium.test.ts`, run on its own): tapping "Just me" shows the guest's turn and quoted results, and the chips are at least 44px at 320 and 1280.
- [ ] Captures at 320, 390, 768 and 1280, light and dark, with no horizontal overflow, saved under `.scratch/guest-ui-consistency/screenshots/58/`.

## Verification

`npm run check`, the two extended test files, `test/guest-chip-continuity.test.ts`, `test/assistant-where-chip.test.ts`, `test/guest-discovery-reasons.test.ts` and `test/guest-must-fix-ux.test.ts`, then the one real-Chrome file on its own. Use `env -u LLM_API_KEY` throughout. Record the counts in Comments.

## Comments

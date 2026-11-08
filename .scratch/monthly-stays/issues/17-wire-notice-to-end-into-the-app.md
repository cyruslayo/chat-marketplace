# 17 · Wire Notice to End into the guest and owner apps

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 8 Nov 2026

## Why

Every Extended Stay contract shows "Notice to End: …" (ADR 0092), but on `main` (8 Nov 2026) no app composition constructs `NoticeToEndManager` (`domains/shortlet/src/extended-stay-changes.ts`), so a guest cannot give notice. Read monthly-stays issue 08 first: its Notice to End criteria (AC3–AC6) describe the domain rules; this issue makes them reachable.

## Owner decision (8 Nov 2026)

The guest gives notice **in the chat, from the confirmed booking, with a confirmation step** that shows the new last night and the money effect before anything changes. The Operator sees the change in the back office.

## What to build

1. **Compositions.** Construct `NoticeToEndManager` in `apps/local-guest/src/fixture.ts` and `apps/local-owner/src/local-owner-environment.ts` with `EXTENDED_STAY_POLICY` (or `config.extendedStayPolicy`) and `demoTerms: config.demo === true`, in every deployment (ADR 0092 as amended). Check the Cloudflare composition uses these environments; if it builds its own, wire it there too.
2. **Guest flow (chat and the standalone confirmation page, same helper, ADR 0077/0080).** On a confirmed Extended Stay **after Verified Access** (ADR 0092), offer a "Give notice to end your stay" action. It opens a confirmation step showing, from the domain's own calculation:
   - the new last night and the new checkout date;
   - paid nights after the new last night and the refund at nightly contracted values;
   - any unpaid nights up to it and what is owed.
   The guest confirms or goes back. Confirming records the versioned Booking Amendment (ADR 0060); nothing changes before that. Before Verified Access, or on a Short Stay, the action is not shown, and a forged event is refused (`STALE_SURFACE` / `ARTIFACT_MISMATCH`, fail closed).
3. **Assistant.** A guest who asks in chat to end early is offered the same confirmation step through a structured surface; the assistant never records notice from free text alone. Out-of-scope or refused requests are `tool_denial`, never `CONCIERGE_UNAVAILABLE` (ADR 0106). Persist and re-key the surface id on cold restore (AGENTS.md "Concierge assistant path").
4. **Owner side.** The back office booking view shows the notice (date given, new last night, refund due, owed amount) and the reduced Period Owner Payables (ADR 0089, 0092).
5. **Wording.** Use existing labels and terms where they exist (`GUEST_FACT_LABELS`, the contract's Notice to End terms). For anything new (the action label, the confirmation heading, button labels), use these proposed strings and mark them in Comments for the owner to confirm: action "Give notice to end your stay"; heading "End your stay early"; confirm button "Give notice"; back button "Keep my stay".
6. **Not in scope:** refunds are recorded, not paid out (payouts stay manual, ADR 0089); the lawful process for unpaid periods stays `[counsel text]`.

## Acceptance criteria

- AC1: Every composition (production, staging, demo) can record a Notice to End; the stale "needs an Extended Stay policy" refusal is unreachable in a composition.
- AC2: After Verified Access, the guest sees the action on a confirmed Extended Stay, and the confirmation step shows the new last night, refund and amount owed calculated by the domain.
- AC3: Going back changes nothing; confirming commits one versioned Booking Amendment, and the contract's last night, Billing Periods and Period Owner Payables update.
- AC4: Before Verified Access, on a Short Stay, or with a forged or superseded surface id, the action is refused and nothing changes.
- AC5: With the assistant enabled and a cold restore before every event, a guest asking to end early reaches the same confirmation step and can confirm it; refusals are `tool_denial`.
- AC6: The back office shows the notice and the reduced owner payables.
- AC7: Guest UI passes ADR 0078 checks (no overflow, 44px targets, light and dark); captures at 320, 390, 768 and 1280 under `screenshots/17/` (AGENTS.md "Guest UI work").

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 (amended) | Notice to End after Verified Access; 14-day rule; refunds at nightly contracted values; owner payables fall |
| 0060 | Versioned Booking Amendment; original stays authoritative until commit |
| 0105 | Demo label only in demo mode |
| 0106 | Cold restore, persisted surface ids, `tool_denial` |
| 0077, 0080 | Same helper and content for chat and page |
| 0078 | Accessible launch profile |
| 0089 | Owner payables per period; payouts manual |

## Definition of Done

See `docs/agents/issue-tracker.md` and the AGENTS.md capture rules. Record commands and pass counts in Comments.

## Comments

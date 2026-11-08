# 18 · Give notice to end an Extended Stay from the chat and the assistant

Status: ready-for-agent
Type: task
Blocked by: 17
Requested: 8 Nov 2026

## Why

Issue 17 made Notice to End work on the standalone page and in the back office. The owner decided (8 Nov 2026) that guests give notice **in the chat, from the confirmed booking, with a confirmation step**. Notice to End is the first chat action that **ends** something the guest has paid for, so it must never be confirmed by accident.

## Design (decided; do not change without asking)

1. **New pending-action type `give_notice`** in the closed union in `apps/local-guest/src/assistant/pending-actions.ts` (beside `request_to_book`, `accept_offer`, `start_checkout`), with its card in `pending-action-a2ui.ts`. The card shows the **same facts and labels as the issue 17 page** (`GUEST_NOTICE_COPY`, the domain's `previewNotice` result: new last night, new checkout, refund, still owed, and the terms). One helper renders the facts for chat and page (ADR 0077, 0080).
2. **Button-only confirmation.** A `give_notice` action is confirmed **only** by the structured confirm event from its own card (`ASSISTANT_CONFIRM` with the card's surface id and the bound `noticeDate` and `contractVersion`). Typed text ("yes", "ok", "go ahead") must **never** confirm it: the runtime's text-confirmation path must exclude this type explicitly, fail closed (an unknown type is excluded by default). Cancel ("Keep my stay" or `ASSISTANT_CANCEL`) changes nothing.
3. **Planner tool.** A shortlet pack tool, e.g. `propose_notice_to_end`, lets the planner **propose** the card when the guest asks to end early. The tool only previews; it never records notice. It is allowed only for a confirmed Extended Stay after Verified Access; otherwise it is a refused tool call (`tool_denial` via `AssistantGuestRefusalError`, never `CONCIERGE_UNAVAILABLE`). The runtime stays domain-neutral (`test/assistant-pack-registry.test.ts`).
4. **Chat button path.** The confirmed booking's chat surface gets the "Give notice to end your stay" action (`GUEST_NOTICE_COPY`), which opens the same card without the planner.
5. **Commit.** Confirming calls `NoticeToEndManager.giveNotice` with the bound `noticeDate` and `contractVersion`; a stale preview (notice date or contract version changed) is refused and a fresh card is offered.
6. **Cold restore.** The card's surface id, `noticeDate` and `contractVersion` are persisted with the thread and re-keyed on restore, never re-minted. Forged, superseded or unknown ids return `STALE_SURFACE` / `ARTIFACT_MISMATCH` and change nothing.

## Acceptance criteria

- AC1: From a confirmed Extended Stay after Verified Access, the chat action opens the notice card showing the same facts as the issue 17 page.
- AC2: Pressing "Give notice" on the card commits exactly one versioned Booking Amendment; "Keep my stay" changes nothing.
- AC3: Typed confirmations ("yes", "ok", "confirm", "go ahead") while a `give_notice` card is open never record notice, and the card stays open.
- AC4: A guest asking in chat to end early is offered the card through the planner tool; the tool never records notice by itself.
- AC5: On a Short Stay or before Verified Access, the tool is a `tool_denial` with a guest sentence and the action is not shown.
- AC6: Forged, superseded or unknown surface ids, and a stale `noticeDate` or `contractVersion`, are refused with `STALE_SURFACE` / `ARTIFACT_MISMATCH` and change nothing.
- AC7: Every test above runs with the assistant enabled and a cold restore (new `LocalGuestApp` over the same store) before every event, clock 2026-10-27, staging-like guest.
- AC8: Chat captures of the card and the recorded state at 320, 390, 768 and 1280, light and dark, with overflow and 44px checks, under `screenshots/18/`.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0106 | Cold restore; persisted surface ids; `tool_denial`; no keyword fast path; domain-neutral runtime |
| 0092 (amended) | Notice to End after Verified Access; 14-day rule; refunds at nightly contracted values |
| 0060 | Versioned Booking Amendment |
| 0077, 0080 | Same helper and content for chat and page |
| 0078 | Accessible launch profile |

## Definition of Done

See `docs/agents/issue-tracker.md` and the AGENTS.md capture rules. Record commands and pass counts in Comments.

## Comments
